import fs from "node:fs/promises"
import https from "node:https"
import os from "node:os"
import path from "node:path"
import vm from "node:vm"
import { createHash } from "node:crypto"
import { execFile, execFileSync, spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { parse as parseYaml, stringify as stringifyYaml } from "yaml"
import { promisify } from "node:util"
import { readFileSync } from "node:fs"

import {
  buildAskMarketValidation,
  isTopicMarketValidationQuestion,
  searchAskStockDaily,
  searchAskTopicStockDaily,
} from "./ask-market.mjs"

import {
  searchAskCandidates,
  searchAskFactsSplit,
  selectAskSources,
} from "./ask-retrieval.mjs"

import {
  listActiveSelfQuestionPolicies,
  searchAskBrain,
} from "./brain-memory.mjs"

import {
  AGENT_RUNS_ROOT,
  ASK_CONTEXT_TOKEN_CHAR_RATIO,
  ASK_DEFAULT_GRAPH_DEPTH,
  ASK_DEFAULT_GRAPH_NEIGHBORS,
  ASK_GRAPH_EXCERPT_CHARS,
  ASK_LEDGER_EXCERPT_CHARS,
  ASK_MAX_GRAPH_DEPTH,
  ASK_NAV_EXCERPT_CHARS,
  ASK_RAW_EXCERPT_CHARS,
  ASK_ROLE_EVIDENCE_EXCERPT_CHARS,
  ASK_ROLE_MARKET_EXCERPT_CHARS,
  ASK_WIKI_EXCERPT_CHARS,
  DEFAULT_AGENT_CONCURRENCY,
  DEFAULT_PROJECT_PATH,
  RETRIEVAL_MODES,
  ensureDirectory,
  exists,
  isReservedWikiPath,
  listFilesRecursive,
  mapWithConcurrency,
  normalizePath,
  nowLocalTimestamp,
  parsePositiveInteger,
  pathToTitle,
  projectRelative,
  readIfExists,
  requestCodexExecText,
  requestResponsesText,
  requestOpenAICompatibleText,
  safeErrorMessage,
  sanitizeArtifactName,
  toPosixPath,
  writeJson,
} from "./core.mjs"

import {
  buildEvidenceExcerpt,
  buildSnippet,
  excerptForPrompt,
  extractTitle,
  extractWikilinkTargets,
  inferTypeFromPath,
  isWeakSourceReference,
  normalizeTypeAlias,
  normalizeWikilinkTarget,
  parseFrontmatter,
  resolveGraphTarget,
  tokenMatchScore,
  topicCoverageBonus,
  wikiRelativePathToNodeId,
} from "./knowledge.mjs"

export function ensureGraphNodeEdgeMaps(node) {
  if (!node.outLinks) node.outLinks = new Set()
  if (!node.inLinks) node.inLinks = new Set()
  if (!node.outEdgeTypes) node.outEdgeTypes = new Map()
  if (!node.inEdgeTypes) node.inEdgeTypes = new Map()
}

export function addAskGraphEdge(nodes, sourceId, targetId, type = "link") {
  const source = nodes.get(sourceId)
  const target = nodes.get(targetId)
  if (!source || !target || sourceId === targetId) return
  ensureGraphNodeEdgeMaps(source)
  ensureGraphNodeEdgeMaps(target)
  source.outLinks.add(targetId)
  target.inLinks.add(sourceId)
  if (!source.outEdgeTypes.has(targetId)) source.outEdgeTypes.set(targetId, new Set())
  if (!target.inEdgeTypes.has(sourceId)) target.inEdgeTypes.set(sourceId, new Set())
  source.outEdgeTypes.get(targetId).add(type || "link")
  target.inEdgeTypes.get(sourceId).add(type || "link")
}

export async function buildAskGraphFromGraphJson(projectPath) {
  const graphPath = path.join(projectPath, ".llm-wiki", "graph.json")
  const raw = await readIfExists(graphPath)
  if (!raw.trim()) return null
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) return null
  const nodes = new Map()
  for (const rawNode of parsed.nodes) {
    const id = String(rawNode.id ?? wikiRelativePathToNodeId(rawNode.path ?? "") ?? "").trim()
    if (!id) continue
    const relativePath = rawNode.path ? toPosixPath(String(rawNode.path)) : `wiki/${id}.md`
    const node = {
      id,
      path: relativePath,
      title: String(rawNode.label ?? rawNode.title ?? pathToTitle(relativePath)),
      type: normalizeTypeAlias(rawNode.type) ?? rawNode.type ?? inferTypeFromPath(relativePath),
      sources: Array.isArray(rawNode.sources) ? rawNode.sources.map((item) => String(item)).filter((item) => !isWeakSourceReference(item)) : [],
      rawLinks: [],
      outLinks: new Set(),
      inLinks: new Set(),
      outEdgeTypes: new Map(),
      inEdgeTypes: new Map(),
    }
    nodes.set(id, node)
  }
  for (const edge of parsed.edges) {
    const source = String(edge.source ?? "").trim()
    const target = String(edge.target ?? "").trim()
    addAskGraphEdge(nodes, source, target, String(edge.type ?? "link"))
  }
  return { nodes, graphSource: ".llm-wiki/graph.json" }
}

export async function buildAskGraphFromWiki(projectPath) {
  const pp = normalizePath(projectPath)
  const files = await listFilesRecursive(path.join(pp, "wiki"), {
    extensions: new Set([".md"]),
    excludeDirNames: new Set([".git", ".conflicts", "scripts"]),
  })
  const nodes = new Map()
  const basenameIndex = new Map()

  for (const filePath of files) {
    const relativePath = projectRelative(pp, filePath)
    const id = wikiRelativePathToNodeId(relativePath)
    if (!id) continue
    const content = await readIfExists(filePath)
    if (!content.trim()) continue
    const { fm } = parseFrontmatter(content)
    const sources = Array.isArray(fm.sources) ? fm.sources.map((item) => String(item).trim()).filter((item) => !isWeakSourceReference(item)) : []
    const relatedLinks = Array.isArray(fm.related) ? fm.related.map((item) => normalizeWikilinkTarget(item)).filter(Boolean) : []
    const node = {
      id,
      path: relativePath,
      title: extractTitle(content, filePath),
      type: normalizeTypeAlias(fm.type) ?? inferTypeFromPath(relativePath),
      sources,
      rawLinks: [...new Set([...relatedLinks, ...extractWikilinkTargets(content)])],
      outLinks: new Set(),
      inLinks: new Set(),
      outEdgeTypes: new Map(),
      inEdgeTypes: new Map(),
    }
    nodes.set(id, node)
    const basename = id.includes("/") ? id.split("/").pop() : id
    if (!basenameIndex.has(basename)) basenameIndex.set(basename, [])
    basenameIndex.get(basename).push(id)
  }

  const nodeIds = new Set(nodes.keys())
  for (const node of nodes.values()) {
    for (const rawLink of node.rawLinks) {
      const target = resolveGraphTarget(rawLink, nodeIds, basenameIndex)
      if (!target || target === node.id) continue
      addAskGraphEdge(nodes, node.id, target, "wikilink")
    }
  }

  return { nodes, graphSource: "wiki-wikilinks" }
}

export async function buildAskGraph(projectPath) {
  const [graphJson, wikiGraph] = await Promise.all([
    buildAskGraphFromGraphJson(projectPath),
    buildAskGraphFromWiki(projectPath),
  ])
  if (!graphJson) return wikiGraph
  if (!wikiGraph) return graphJson
  return mergeAskGraphs(graphJson, wikiGraph)
}

export function mergeEdgeTypeMap(target, source) {
  for (const [id, types] of source ?? []) {
    if (!target.has(id)) target.set(id, new Set())
    for (const type of types) target.get(id).add(type)
  }
}

export function mergeAskGraphs(base, overlay) {
  for (const [id, overlayNode] of overlay.nodes) {
    const node = base.nodes.get(id)
    if (!node) {
      base.nodes.set(id, overlayNode)
      continue
    }
    node.path = node.path || overlayNode.path
    node.title = overlayNode.title || node.title
    node.type = normalizeTypeAlias(node.type) ?? normalizeTypeAlias(overlayNode.type) ?? overlayNode.type ?? node.type
    node.sources = [...new Set([...(node.sources ?? []), ...(overlayNode.sources ?? [])])]
    node.rawLinks = [...new Set([...(node.rawLinks ?? []), ...(overlayNode.rawLinks ?? [])])]
    ensureGraphNodeEdgeMaps(node)
    ensureGraphNodeEdgeMaps(overlayNode)
    for (const out of overlayNode.outLinks ?? []) node.outLinks.add(out)
    for (const incoming of overlayNode.inLinks ?? []) node.inLinks.add(incoming)
    mergeEdgeTypeMap(node.outEdgeTypes, overlayNode.outEdgeTypes)
    mergeEdgeTypeMap(node.inEdgeTypes, overlayNode.inEdgeTypes)
  }
  return { nodes: base.nodes, graphSource: `${base.graphSource}+${overlay.graphSource}` }
}

export const ASK_MULTI_HOP_QUERY_REGEX =
  /产业链|上下游|传导|受益方向|受益|关联|关系|链路|链条|图谱|扩展|扩散|映射|供应链|供应商|客户|配套|生态|间接/

export function resolveAskGraphDepth(query, rawDepth) {
  const text = String(rawDepth ?? "").trim().toLowerCase()
  if (!text || text === "auto") return ASK_MULTI_HOP_QUERY_REGEX.test(query) ? 2 : ASK_DEFAULT_GRAPH_DEPTH
  const parsed = Number.parseInt(text, 10)
  if (!Number.isFinite(parsed)) return ASK_DEFAULT_GRAPH_DEPTH
  return Math.max(0, Math.min(parsed, ASK_MAX_GRAPH_DEPTH))
}

export function graphNodeDegree(node) {
  return (node?.outLinks?.size ?? 0) + (node?.inLinks?.size ?? 0)
}

export function graphHopDecay(hop) {
  if (hop <= 1) return 1
  return 0.45 ** (hop - 1)
}

export function graphNodeRelevanceScore(node, tokens) {
  if (!node) return 0
  const text = [
    node.title,
    node.path,
    node.type,
    ...(node.sources ?? []),
  ].filter(Boolean).join(" ")
  return tokenMatchScore(text, tokens) + topicCoverageBonus(text, tokens)
}

export function shouldKeepGraphHop(node, tokens, hop) {
  if (hop <= 1) return true
  if (!node || isReservedWikiPath(node.path) || node.path.startsWith("wiki/sources/")) return false
  return graphNodeRelevanceScore(node, tokens) > 0
}

export async function expandAskGraph(projectPath, wikiResults, options = {}) {
  const limit = parsePositiveInteger(options.graphNeighbors, ASK_DEFAULT_GRAPH_NEIGHBORS)
  const graphDepth = resolveAskGraphDepth(options.query ?? "", options.graphDepth)
  if (limit <= 0 || graphDepth <= 0 || wikiResults.length === 0) return []
  const graph = await buildAskGraph(projectPath)
  const selectedPaths = new Set(wikiResults.map((item) => item.path))
  const expansions = new Map()

  function addExpansion({ id, score, reason, from, hop = 1, pathTrace = [], relationType = "link" }) {
    const node = graph.nodes.get(id)
    if (!node || selectedPaths.has(node.path) || isReservedWikiPath(node.path) || node.path.startsWith("wiki/sources/")) return
    const existing = expansions.get(node.path) ?? {
      path: node.path,
      title: node.title,
      type: node.type,
      score: 0,
      graphScore: 0,
      reasons: [],
      from: [],
      hop,
      pathTrace,
      relationType,
      snippet: "",
    }
    existing.graphScore += score
    existing.score = Math.max(existing.score, score)
    if (hop < (existing.hop ?? Number.POSITIVE_INFINITY)) {
      existing.hop = hop
      existing.pathTrace = pathTrace
      existing.relationType = relationType
    }
    if (!existing.reasons.includes(reason)) existing.reasons.push(reason)
    if (!existing.from.includes(from)) existing.from.push(from)
    expansions.set(node.path, existing)
  }

  for (const result of wikiResults) {
    const sourceId = wikiRelativePathToNodeId(result.path)
    const sourceNode = sourceId ? graph.nodes.get(sourceId) : null
    if (!sourceNode) continue

    const visited = new Set([sourceNode.id])
    let frontier = [{ node: sourceNode, hop: 0, pathTrace: [result.path] }]
    while (frontier.length > 0) {
      const nextFrontier = []
      for (const current of frontier) {
        if (current.hop >= graphDepth) continue
        if (current.hop >= 1 && graphNodeDegree(current.node) > 40) continue
        const nextHop = current.hop + 1
        const edges = [
          ...[...(current.node.outLinks ?? [])].map((id) => ({
            id,
            direction: "out",
            edgeTypes: [...(current.node.outEdgeTypes?.get(id) ?? ["link"])],
            baseScore: 8 + result.score * 0.05,
          })),
          ...[...(current.node.inLinks ?? [])].map((id) => ({
            id,
            direction: "in",
            edgeTypes: [...(current.node.inEdgeTypes?.get(id) ?? ["link"])],
            baseScore: 7 + result.score * 0.04,
          })),
        ]

        for (const edge of edges) {
          const targetNode = graph.nodes.get(edge.id)
          if (!targetNode || visited.has(edge.id) || targetNode.id === sourceNode.id || selectedPaths.has(targetNode.path)) continue
          if (!shouldKeepGraphHop(targetNode, options.tokens ?? [], nextHop)) continue
          visited.add(edge.id)
          const score = edge.baseScore * graphHopDecay(nextHop) + (nextHop > 1 ? Math.min(4, graphNodeRelevanceScore(targetNode, options.tokens ?? []) * 0.35) : 0)
          const pathTrace = [...current.pathTrace, targetNode.path]
          const relation = edge.direction === "out"
            ? `linked from ${current.node.path} (${edge.edgeTypes.join("/")})`
            : `links to ${current.node.path} (${edge.edgeTypes.join("/")})`
          addExpansion({
            id: edge.id,
            score,
            reason: nextHop === 1 ? relation : `hop ${nextHop} via ${current.node.path}: ${relation}`,
            from: result.path,
            hop: nextHop,
            pathTrace,
            relationType: edge.direction === "out" ? "out-link" : "in-link",
          })
          if (nextHop < graphDepth) nextFrontier.push({ node: targetNode, hop: nextHop, pathTrace })
        }
      }
      frontier = nextFrontier
    }

    if (sourceNode.sources.length > 0) {
      const sourceSet = new Set(sourceNode.sources)
      for (const node of graph.nodes.values()) {
        if (node.id === sourceNode.id || isReservedWikiPath(node.path)) continue
        const shared = node.sources.filter((source) => sourceSet.has(source))
        if (shared.length === 0) continue
        addExpansion({
          id: node.id,
          score: 4 + shared.length * 2 + result.score * 0.02,
          reason: `shared source: ${shared.slice(0, 3).join(", ")}`,
          from: result.path,
          hop: 1,
          pathTrace: [result.path, node.path],
          relationType: "shared-source",
        })
      }
    }
  }

  const items = [...expansions.values()]
    .sort((a, b) => b.graphScore - a.graphScore || a.path.localeCompare(b.path))
    .slice(0, limit)

  for (const item of items) {
    const content = await readIfExists(path.join(projectPath, item.path))
    item.snippet = buildSnippet(content, options.tokens ?? [], 220)
  }
  return items
}

export async function addAskReferences(projectPath, items, prefix, tokens, maxChars) {
  const out = []
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const content = await readIfExists(path.join(projectPath, item.path))
    out.push({
      ...item,
      ref: `${prefix}${i + 1}`,
      excerpt: content ? buildEvidenceExcerpt(content, tokens, maxChars) : "",
    })
  }
  return out
}

export function addPrebuiltAskReferences(items, prefix) {
  return items.map((item, i) => ({
    ...item,
    ref: `${prefix}${i + 1}`,
    excerpt: item.excerpt || item.snippet || "",
  }))
}

export function formatAskSourceRoutingSection(context) {
  const rows = ["## Source Routing"]
  rows.push("", `- mode: ${context.sourceRouting.route.mode}`, `- source_k: ${context.sourceRouting.route.sourceK}`)
  if (context.sourceRouting.route.warnings.length > 0) {
    rows.push(`- warnings: ${context.sourceRouting.route.warnings.join(" | ")}`)
  }
  rows.push("")
  for (const source of context.sourceRouting.selectedSources) {
    rows.push(
      `- ${source.id}: ${source.available ? "available" : "unavailable"}; native=${source.nativeLanguage}; reason=${source.routeReason || "selected"}${
        source.unavailableReason ? `; unavailable_reason=${source.unavailableReason}` : ""
      }`,
    )
  }
  if (context.retrievalWarnings.length > 0) {
    rows.push("", "## Retrieval Warnings", "", ...context.retrievalWarnings.map((warning) => `- ${warning}`))
  }
  return rows.join("\n")
}

export function formatAskNativeQueriesSection(nativeQueries) {
  if (nativeQueries.length === 0) return "## Native Queries\n\n- none"
  const rows = ["## Native Queries"]
  for (const query of nativeQueries) {
    rows.push("", `### ${query.sourceId}`, `- language: ${query.language}`, `- query: ${query.summary}`)
    if (query.status) rows.push(`- status: ${query.status}`)
  }
  return rows.join("\n")
}

export function formatAskEvidenceSection(title, items) {
  if (items.length === 0) return `## ${title}\n\n- none`
  const rows = [`## ${title}`]
  for (const item of items) {
    rows.push(
      "",
      `### [${item.ref}] ${item.title} (${item.path})`,
      `- score: ${Math.round(item.score * 100) / 100}`,
      item.sourceId ? `- source: ${item.sourceId}` : "",
      item.type ? `- type: ${item.type}` : "",
      item.raw ? "- kind: raw" : "",
      item.nativeQuery ? `- native_query: ${item.nativeQuery}` : "",
      item.hop ? `- graph_hop: ${item.hop}` : "",
      item.pathTrace?.length ? `- path_trace: ${item.pathTrace.join(" -> ")}` : "",
      item.reasons?.length ? `- graph_reason: ${item.reasons.join("; ")}` : "",
      "",
      item.excerpt || item.snippet || "(no excerpt)",
    )
  }
  return rows.filter((line) => line !== "").join("\n")
}

export function formatAskMarketValidationSection(marketValidation) {
  if (!marketValidation) return "## Market Validation\n\n- none"
  const rows = ["## Market Validation"]
  rows.push(
    "",
    `- source: ${marketValidation.sourceId}`,
    `- status: ${marketValidation.status}`,
    `- verdict: ${marketValidation.verdict}`,
    `- reason: ${marketValidation.reason ?? "none"}`,
  )
  if (marketValidation.stockName || marketValidation.stockCode) {
    rows.push(`- stock: ${[marketValidation.stockName, marketValidation.stockCode].filter(Boolean).join(" ")}`)
  }
  if (marketValidation.scope) rows.push(`- scope: ${marketValidation.scope}`)
  if (marketValidation.theme) rows.push(`- theme: ${marketValidation.theme.label} (${marketValidation.theme.id})`)
  if (marketValidation.segmentConfigStatus) rows.push(`- segment_config: ${marketValidation.segmentConfigStatus}`)
  if (marketValidation.segmentConfigWarning) rows.push(`- segment_config_warning: ${marketValidation.segmentConfigWarning}`)
  if (marketValidation.candidateCount != null) rows.push(`- candidate_count: ${marketValidation.candidateCount}`)
  if (marketValidation.segmentCount != null) rows.push(`- segment_count: ${marketValidation.segmentCount}`)
  if (marketValidation.representedSegmentCount != null) rows.push(`- represented_segment_count: ${marketValidation.representedSegmentCount}`)
  if (marketValidation.missingSegments?.length) rows.push(`- missing_segments: ${marketValidation.missingSegments.join(" / ")}`)
  if (marketValidation.firstDate || marketValidation.lastDate) {
    rows.push(`- window: ${marketValidation.firstDate ?? "?"} -> ${marketValidation.lastDate ?? "?"}; rows=${marketValidation.rowCount}; lookbackDays=${marketValidation.lookbackDays ?? "unknown"}`)
  }
  if (marketValidation.periodReturnPct != null) rows.push(`- period_return_pct: ${marketValidation.periodReturnPct}`)
  if (marketValidation.returnSource) rows.push(`- return_source: ${marketValidation.returnSource}`)
  if (marketValidation.crossCheckStatus) {
    rows.push(`- cross_check: ${marketValidation.crossCheckStatus}; ${marketValidation.crossCheckReason ?? "none"}`)
  }
  if (marketValidation.sqlPeriodReturnPct != null || marketValidation.externalPeriodReturnPct != null) {
    rows.push(`- return_cross_check: sql=${marketValidation.sqlPeriodReturnPct ?? "?"}; external=${marketValidation.externalPeriodReturnPct ?? "?"}`)
  }
  if (marketValidation.firstClose != null || marketValidation.lastClose != null) {
    rows.push(`- close: first=${marketValidation.firstClose ?? "?"}; last=${marketValidation.lastClose ?? "?"}`)
  }
  if (marketValidation.lastVolumeVsAvg != null) {
    rows.push(`- volume: last=${marketValidation.lastVolume ?? "?"}; avg=${marketValidation.avgVolume ?? "?"}; last_vs_avg=${marketValidation.lastVolumeVsAvg}`)
  }
  if (marketValidation.lastAmount != null || marketValidation.avgAmount != null) {
    rows.push(`- amount: last=${marketValidation.lastAmount ?? "?"}; avg=${marketValidation.avgAmount ?? "?"}`)
  }
  if (marketValidation.segmentPools?.length) {
    rows.push("", "### Segment Candidate Pools")
    for (const pool of marketValidation.segmentPools) {
      rows.push(`- ${pool.label} (${pool.id}):`)
      if (!pool.candidates?.length) {
        rows.push("  - none")
        continue
      }
      for (const candidate of pool.candidates) {
        const crossCheckText = candidate.crossCheckStatus
          ? `; cross_check=${candidate.crossCheckStatus}; sql_return=${candidate.sqlPeriodReturnPct ?? "NA"}; external_return=${candidate.externalPeriodReturnPct ?? "NA"}`
          : ""
        rows.push(
          `  - ${[candidate.stockName, candidate.stockCode].filter(Boolean).join(" ")}: status=${candidate.status}; verdict=${candidate.verdict}; rows=${candidate.rowCount ?? 0}; return_pct=${candidate.periodReturnPct ?? "NA"}; return_source=${candidate.returnSource ?? "NA"}${crossCheckText}; last_volume_vs_avg=${candidate.lastVolumeVsAvg ?? "NA"}`,
        )
      }
      for (const candidate of pool.excludedCandidates ?? []) {
        rows.push(
          `  - excluded ${[candidate.stockName, candidate.stockCode].filter(Boolean).join(" ")}: reason=${candidate.reason}`,
        )
      }
    }
  }
  if (marketValidation.candidates?.length) {
    rows.push("", "### Candidate Stocks")
    for (const candidate of marketValidation.candidates) {
      const segmentText = candidate.segments?.length ? `; segments=${candidate.segments.join("/")}` : ""
      const crossCheckText = candidate.crossCheckStatus
        ? `; cross_check=${candidate.crossCheckStatus}; sql_return=${candidate.sqlPeriodReturnPct ?? "NA"}; external_return=${candidate.externalPeriodReturnPct ?? "NA"}`
        : ""
      rows.push(
        `- ${[candidate.stockName, candidate.stockCode].filter(Boolean).join(" ")}: status=${candidate.status}; verdict=${candidate.verdict}; window=${candidate.firstDate ?? "?"}->${candidate.lastDate ?? "?"}; rows=${candidate.rowCount ?? 0}; return_pct=${candidate.periodReturnPct ?? "NA"}; return_source=${candidate.returnSource ?? "NA"}${crossCheckText}; last_volume_vs_avg=${candidate.lastVolumeVsAvg ?? "NA"}; last_amount=${candidate.lastAmount ?? "NA"}${segmentText}`,
      )
      if (candidate.reason) rows.push(`  reason: ${candidate.reason}`)
      if (candidate.candidateReasons?.length) rows.push(`  matched_by: ${candidate.candidateReasons.slice(0, 4).join("; ")}`)
    }
  }
  if (marketValidation.refs?.length) rows.push(`- refs: ${marketValidation.refs.slice(0, 12).join(", ")}`)
  return rows.join("\n")
}

export function estimateAskPromptTokens(text) {
  return Math.ceil(String(text ?? "").length / ASK_CONTEXT_TOKEN_CHAR_RATIO)
}

export function promptTextMetrics(text) {
  const raw = String(text ?? "")
  return {
    chars: raw.length,
    approxTokens: estimateAskPromptTokens(raw),
  }
}

export function askContextSourceCounts(context) {
  return {
    navigation: context.navigation?.length ?? 0,
    wiki: context.wikiResults?.length ?? 0,
    raw: context.rawResults?.length ?? 0,
    graph: context.graphExpansions?.length ?? 0,
    facts: context.factsResults?.length ?? 0,
    invalidatedFacts: context.invalidatedFactsResults?.length ?? 0,
    brain: context.brainResults?.length ?? 0,
    stockDaily: context.stockDailyResults?.length ?? 0,
    segmentPools: context.marketValidation?.segmentPools?.length ?? 0,
    marketCandidates: context.marketValidation?.candidates?.length ?? 0,
    activePolicies: context.activePolicies?.length ?? 0,
  }
}

export function buildAskContextMetrics(context) {
  const promptMetrics = promptTextMetrics(context.prompt)
  return {
    prompt: promptMetrics,
    sourceCounts: askContextSourceCounts(context),
    sqlRows: context.counts?.sqlRows ?? 0,
    fullCopyAgenticApproxTokens: promptMetrics.approxTokens * (AGENTIC_ASK_ROLES.length + 1),
  }
}

export function formatAskContextMetricsSection(metrics) {
  if (!metrics) return "## Context Metrics\n\n- none"
  const rows = ["## Context Metrics", ""]
  rows.push(`- prompt_chars: ${metrics.prompt?.chars ?? 0}`)
  rows.push(`- approx_tokens: ${metrics.prompt?.approxTokens ?? 0}`)
  rows.push(`- full_copy_agentic_approx_tokens: ${metrics.fullCopyAgenticApproxTokens ?? 0}`)
  if (metrics.sourceCounts) {
    rows.push(`- source_counts: ${Object.entries(metrics.sourceCounts).map(([key, value]) => `${key}=${value}`).join("; ")}`)
  }
  return rows.join("\n")
}

export function askEvidenceRefLine(item, excerptChars = ASK_LEDGER_EXCERPT_CHARS) {
  const bits = [
    `[${item.ref}] ${item.title ?? "(untitled)"}`,
    item.path ? `path=${item.path}` : "",
    item.sourceId ? `source=${item.sourceId}` : "",
    item.type ? `type=${item.type}` : "",
    Number.isFinite(item.score) ? `score=${Math.round(item.score * 100) / 100}` : "",
    item.nativeQuery ? `native=${item.nativeQuery}` : "",
  ].filter(Boolean)
  const excerpt = excerptForPrompt(item.excerpt || item.snippet || "", excerptChars)
  return `- ${bits.join("; ")}${excerpt ? `\n  excerpt: ${excerpt}` : ""}`
}

export function formatAskEvidenceSectionCompact(title, items, options = {}) {
  const limit = parsePositiveInteger(options.limit, items.length)
  const excerptChars = parsePositiveInteger(options.excerptChars, ASK_LEDGER_EXCERPT_CHARS)
  const selected = items.slice(0, limit)
  if (selected.length === 0) return `## ${title}\n\n- none`
  return [`## ${title}`, "", ...selected.map((item) => askEvidenceRefLine(item, excerptChars))].join("\n")
}

export function buildAskEvidenceLedger(context, options = {}) {
  const excerptChars = parsePositiveInteger(options.excerptChars, ASK_LEDGER_EXCERPT_CHARS)
  const limits = {
    navigation: parsePositiveInteger(options.navigationLimit, 2),
    wiki: parsePositiveInteger(options.wikiLimit, 8),
    raw: parsePositiveInteger(options.rawLimit, 5),
    graph: parsePositiveInteger(options.graphLimit, 5),
    facts: parsePositiveInteger(options.factsLimit, 6),
    invalidatedFacts: parsePositiveInteger(options.invalidatedFactsLimit, 6),
    brain: parsePositiveInteger(options.brainLimit, 4),
    stockDaily: parsePositiveInteger(options.stockDailyLimit, 0),
  }
  return [
    "## Evidence Ledger",
    "",
    formatAskEvidenceSectionCompact("Navigation Seeds", context.navigation ?? [], { limit: limits.navigation, excerptChars }),
    "",
    formatAskEvidenceSectionCompact("Wiki Hits", context.wikiResults ?? [], { limit: limits.wiki, excerptChars }),
    "",
    formatAskEvidenceSectionCompact("Raw Hits", context.rawResults ?? [], { limit: limits.raw, excerptChars }),
    "",
    formatAskEvidenceSectionCompact("Graph Expansion", context.graphExpansions ?? [], { limit: limits.graph, excerptChars }),
    "",
    formatAskEvidenceSectionCompact("Facts JSONL Hits", context.factsResults ?? [], { limit: limits.facts, excerptChars }),
    "",
    formatAskEvidenceSectionCompact("Invalidated/Superseded Temporal Facts", context.invalidatedFactsResults ?? [], { limit: limits.invalidatedFacts, excerptChars }),
    "",
    formatAskEvidenceSectionCompact("Brain Memory Hits", context.brainResults ?? [], { limit: limits.brain, excerptChars }),
    "",
    formatAskActivePolicySection(context.activePolicies ?? []),
    limits.stockDaily > 0 ? "" : null,
    limits.stockDaily > 0 ? formatAskEvidenceSectionCompact("Stock Daily SQL Hits", context.stockDailyResults ?? [], { limit: limits.stockDaily, excerptChars }) : null,
  ].filter(Boolean).join("\n")
}

export function buildAskContextIntro(context, title = "# Trading Wiki Ask Context") {
  return [
    title,
    "",
    `question: ${context.query}`,
    `projectPath: ${context.projectPath}`,
    `generatedAt: ${context.generatedAt}`,
    `retrieval: wikiMatches=${context.counts.wikiMatches}, rawMatches=${context.counts.rawMatches}, factsMatches=${context.counts.factsMatches}, invalidatedFactsMatches=${context.counts.invalidatedFactsMatches}, brainMatches=${context.counts.brainMatches}, sqlRows=${context.counts.sqlRows}, wikiFiles=${context.counts.wikiFiles}, rawFiles=${context.counts.rawFiles}`,
    `tokens: ${context.tokens.slice(0, 80).join(", ")}`,
  ].join("\n")
}

export function buildAskPromptInstructions() {
  return [
    "请基于下面提供的知识库上下文回答用户问题。不要假装看过未提供的材料；证据不足时明确写不足。",
    "回答固定使用这些章节：结论、证据链、分歧/反证、后续验证、交易含义、引用来源。",
    "每条关键判断都要标注来源编号，例如 [W1]、[R2]、[G1]、[F1]、[M1]、[S1]；引用来源章节列出编号与 wiki/raw/graph/facts/brain/sql 路径。",
    "Invalidated/Superseded Temporal Facts 只能作为历史版本、反证或矛盾来源，不能当作当前有效事实；如果与 [F] 当前事实冲突，要写入分歧/反证。",
    "Brain Memory 是长期纠错/偏好/验证记忆，只能作为先验和卫语句，不能替代当前证据；如果记忆与当前证据冲突，要写入分歧/反证。",
    "如果 Market Validation 有内容，只能把它当作只读市场验证摘要：有明确方向时可写验证通过/验证失败/待继续观察；没有明确方向时写待继续观察，不要把价格表现硬解释成基本面结论。",
  ].join("\n")
}

export function compactAskActivePolicy(policy = {}) {
  return {
    policyId: policy.policyId ?? policy.id ?? null,
    scope: policy.scope ?? null,
    rule: policy.rule ?? null,
    trigger: policy.trigger ?? null,
    evidenceGap: policy.evidenceGap ?? null,
    sourceProposalId: policy.sourceProposalId ?? null,
    regressionQuestions: Array.isArray(policy.regressionQuestions) ? policy.regressionQuestions.slice(0, 5) : [],
    regressionAssertions: policy.regressionAssertions ?? null,
    promptGuardrails: Array.isArray(policy.promptGuardrails) ? policy.promptGuardrails.slice(0, 5) : [],
    revision: policy.revision ?? null,
    approvedAt: policy.approvedAt ?? policy.createdAt ?? null,
  }
}

export function formatAskActivePolicySection(activePolicies = []) {
  const policies = Array.isArray(activePolicies) ? activePolicies.filter(Boolean) : []
  if (policies.length === 0) return ""
  return [
    "## Active Trading AI Policies",
    "",
    "These approved policies are answer guardrails. If retrieved evidence is missing for a policy requirement, disclose the gap and reduce confidence instead of giving a high-confidence conclusion.",
    "",
    "```json",
    JSON.stringify(policies, null, 2),
    "```",
  ].join("\n")
}

export function buildAgenticAskRoleContext(context, role) {
  const common = [
    buildAskContextIntro(context, `# Agentic Ask Context: ${role.id}`),
    "",
    formatAskContextMetricsSection(context.contextMetrics),
    "",
    formatAskSourceRoutingSection(context),
  ]
  if (role.id === "market-validator") {
    return [
      ...common,
      "",
      formatAskNativeQueriesSection(context.nativeQueries.filter((query) => query.sourceId === "stock_daily_sql")),
      "",
      formatAskMarketValidationSection(context.marketValidation),
      "",
      formatAskEvidenceSectionCompact("Stock Daily SQL Hits", context.stockDailyResults ?? [], { limit: 24, excerptChars: ASK_ROLE_MARKET_EXCERPT_CHARS }),
    ].join("\n")
  }
  if (role.id === "counterevidence-auditor") {
    return [
      ...common,
      "",
      buildAskEvidenceLedger(context, {
        wikiLimit: 4,
        rawLimit: 3,
        graphLimit: 4,
        factsLimit: 6,
        invalidatedFactsLimit: 8,
        brainLimit: 6,
        excerptChars: ASK_LEDGER_EXCERPT_CHARS,
      }),
      "",
      formatAskMarketValidationSection(context.marketValidation),
    ].join("\n")
  }
  if (role.id === "strategy-mapper") {
    return [
      ...common,
      "",
      buildAskEvidenceLedger(context, {
        wikiLimit: 5,
        rawLimit: 3,
        graphLimit: 3,
        factsLimit: 4,
        invalidatedFactsLimit: 3,
        brainLimit: 5,
        stockDailyLimit: 0,
        excerptChars: ASK_LEDGER_EXCERPT_CHARS,
      }),
      "",
      formatAskMarketValidationSection(context.marketValidation),
    ].join("\n")
  }
  return [
    ...common,
    "",
    formatAskNativeQueriesSection(context.nativeQueries),
    "",
    formatAskEvidenceSectionCompact("Navigation Seeds", context.navigation ?? [], { limit: 2, excerptChars: ASK_ROLE_EVIDENCE_EXCERPT_CHARS }),
    "",
    formatAskEvidenceSectionCompact("Wiki Hits", context.wikiResults ?? [], { limit: 8, excerptChars: ASK_ROLE_EVIDENCE_EXCERPT_CHARS }),
    "",
    formatAskEvidenceSectionCompact("Raw Hits", context.rawResults ?? [], { limit: 5, excerptChars: ASK_ROLE_EVIDENCE_EXCERPT_CHARS }),
    "",
    formatAskEvidenceSectionCompact("Graph Expansion", context.graphExpansions ?? [], { limit: 4, excerptChars: ASK_LEDGER_EXCERPT_CHARS }),
    "",
    formatAskEvidenceSectionCompact("Facts JSONL Hits", context.factsResults ?? [], { limit: 4, excerptChars: ASK_LEDGER_EXCERPT_CHARS }),
    "",
    formatAskMarketValidationSection(context.marketValidation),
  ].join("\n")
}

export function buildAskPrompt(context) {
  return [
    buildAskContextIntro(context),
    "",
    buildAskPromptInstructions(),
    "",
    formatAskSourceRoutingSection(context),
    "",
    formatAskNativeQueriesSection(context.nativeQueries),
    "",
    formatAskEvidenceSection("Navigation Seeds", context.navigation),
    "",
    formatAskEvidenceSection("Wiki Hits", context.wikiResults),
    "",
    formatAskEvidenceSection("Raw Hits", context.rawResults),
    "",
    formatAskEvidenceSection("Graph Expansion", context.graphExpansions),
    "",
    formatAskEvidenceSection("Facts JSONL Hits", context.factsResults),
    "",
    formatAskEvidenceSection("Invalidated/Superseded Temporal Facts", context.invalidatedFactsResults),
    "",
    formatAskEvidenceSection("Brain Memory Hits", context.brainResults),
    "",
    formatAskActivePolicySection(context.activePolicies),
    "",
    formatAskMarketValidationSection(context.marketValidation),
    "",
    formatAskEvidenceSection("Stock Daily SQL Hits", context.stockDailyResults),
  ].join("\n")
}

export function askInstructions() {
  return [
    "你是一个交易复盘知识库问答助手。",
    "你必须基于提供的 wiki/raw/graph/facts/sql 检索上下文回答，不能把常识或猜测伪装成知识库证据。",
    "输出必须包含且只包含这些 Markdown 章节：结论、证据链、分歧/反证、后续验证、交易含义、引用来源。",
    "每个重要结论都要带来源编号；如果某个问题在上下文中证据不足，要明确指出缺口和需要继续检索的方向。",
    "Graph Expansion 中 graph_hop>=2 的内容只能作为关系扩展线索，必须结合 wiki/raw/facts/sql 证据后才能写成较强结论。",
    "Invalidated/Superseded Temporal Facts 只能用于历史脉络、反证和矛盾解释，不能作为当前结论的主证据。",
    "Brain Memory 只代表长期记忆、用户纠错、偏好或卫语句；它能改变回答优先级，但不能单独证明市场事实。",
    "涉及股票日线验证时，优先使用 Market Validation 和 Stock Daily SQL Hits；不能把只读验证结果默认写入 wiki 或 facts。",
  ].join("\n")
}

export const AGENTIC_ASK_ROLES = Object.freeze([
  {
    id: "evidence-researcher",
    label: "证据研究",
    mission: "从 wiki/raw/graph/facts/brain/sql 上下文中提炼最强证据、来源编号、交易假设和仍缺失的关键证据。",
    output: "输出 Markdown，必须包含：核心证据、可验证假设、来源引用、证据缺口。",
  },
  {
    id: "counterevidence-auditor",
    label: "反证审计",
    mission: "专门寻找过期事实、反证、证据等级不足、语义相近但交易上不适用的材料，以及可能导致追高/误判的逻辑跳跃。",
    output: "输出 Markdown，必须包含：反证清单、证据降权理由、不可下结论区域、需要继续核实的点。",
  },
  {
    id: "market-validator",
    label: "市场验证",
    mission: "优先使用 Market Validation 和 Stock Daily SQL Hits 判断假设是否已经被量价验证、是否只是叙事、是否存在价格背离。",
    output: "输出 Markdown，必须包含：量价验证、窗口判断、验证状态、不能从价格推出的结论。",
  },
  {
    id: "strategy-mapper",
    label: "交易策略",
    mission: "把证据和反证转成观察、低吸条件、禁买条件、失效条件、后续验证清单；不输出真实下单指令。",
    output: "输出 Markdown，必须包含：观察池、触发条件、禁买/降权条件、复盘问题。",
  },
])

export function agenticAskInstructions(role) {
  return [
    `你是 Trading Review Wiki 多智能体框架中的「${role.label}」agent。`,
    role.mission,
    "你只能使用提供的检索上下文，不得假装看过未提供的材料。",
    "所有关键判断都要带来源编号，例如 [W1]、[R2]、[G1]、[F1]、[M1]、[S1]。",
    "遇到证据不足、反证、过期事实或无法验证的问题，要直接写清楚。",
    "不要写入文件，不要输出真实交易指令，不要把模拟或研究结论说成确定收益。",
    role.output,
  ].join("\n")
}

export function buildAgenticAskRolePrompt(context, role) {
  return [
    "# Agentic Ask Role Run",
    "",
    `role: ${role.id}`,
    `roleLabel: ${role.label}`,
    `question: ${context.query}`,
    "",
    "请只完成你的角色职责；不要替裁判员给最终综合答案。",
    "",
    buildAgenticAskRoleContext(context, role),
  ].join("\n")
}

export function buildAgenticAskAdjudicatorPrompt(context, agentResults) {
  const statusRows = agentResults.map((result) => {
    const base = `- ${result.role}: ${result.status}; durationMs=${result.durationMs ?? "unknown"}`
    return result.error ? `${base}; error=${result.error}` : base
  })
  const outputRows = agentResults.map((result) => [
    `## Agent: ${result.role}`,
    "",
    `status: ${result.status}`,
    result.error ? `error: ${result.error}` : "",
    "",
    result.output?.trim() || "(no output)",
  ].filter(Boolean).join("\n"))

  return [
    "# Agentic Ask Adjudication",
    "",
    `question: ${context.query}`,
    "",
    "你是裁判员 agent。请基于压缩证据账本、Market Validation 和各角色输出生成最终答案。",
    "最终答案必须仍然只包含这些 Markdown 章节：结论、证据链、分歧/反证、后续验证、交易含义、引用来源。",
    "如果有角色失败，必须在「分歧/反证」或「后续验证」中明确标注失败角色、影响和需要补的证据。",
    "不要新增其他章节；不要写入文件；不要输出真实交易指令。",
    "",
    "## Agent Run Status",
    "",
    ...statusRows,
    "",
    "## Agent Outputs",
    "",
    ...outputRows,
    "",
    "## Compiled Evidence Context",
    "",
    buildAskContextIntro(context, "# Compiled Retrieval Context"),
    "",
    formatAskContextMetricsSection(context.contextMetrics),
    "",
    formatAskNativeQueriesSection(context.nativeQueries),
    "",
    buildAskEvidenceLedger(context, {
      wikiLimit: 8,
      rawLimit: 5,
      graphLimit: 5,
      factsLimit: 6,
      invalidatedFactsLimit: 6,
      brainLimit: 4,
      stockDailyLimit: 4,
      excerptChars: ASK_LEDGER_EXCERPT_CHARS,
    }),
    "",
    formatAskMarketValidationSection(context.marketValidation),
  ].join("\n")
}

export function compactAgentOutputSummary(output) {
  return String(output ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 6)
    .join("\n")
    .slice(0, 1200)
}

export function askSourceRefsForManifest(context) {
  const collect = (items) => items.map((item) => ({
    ref: item.ref,
    path: item.path,
    title: item.title,
    type: item.type,
    sourceId: item.sourceId,
  }))
  return {
    navigation: collect(context.navigation),
    wiki: collect(context.wikiResults),
    raw: collect(context.rawResults),
    graph: collect(context.graphExpansions),
    facts: collect(context.factsResults),
    invalidatedFacts: collect(context.invalidatedFactsResults),
    brain: collect(context.brainResults),
    activePolicies: (context.activePolicies ?? []).map((policy) => ({
      policyId: policy.policyId,
      scope: policy.scope,
      rule: policy.rule,
      evidenceGap: policy.evidenceGap,
      sourceProposalId: policy.sourceProposalId,
    })),
    stockDaily: collect(context.stockDailyResults),
  }
}

export async function nextAgentRunDir(projectPath, generatedAt, mode = "ask") {
  const stamp = String(generatedAt ?? nowLocalTimestamp()).replace(/[-: ]/g, "").slice(0, 14)
  const root = path.join(projectPath, AGENT_RUNS_ROOT)
  const base = `${stamp}-${sanitizeArtifactName(mode)}`
  for (let i = 0; i < 100; i++) {
    const runId = i === 0 ? base : `${base}-${i + 1}`
    const runDir = path.join(root, runId)
    if (!(await exists(runDir))) return { runId, runDir }
  }
  throw new Error(`Unable to allocate agent run directory under ${root}`)
}

export async function requestAgenticText({ stage, role, prompt, instructions, context, agentResults = [], options, outputPath }) {
  const provider = options.provider ?? "codex"
  const model = options.model ?? (provider === "openai" ? process.env.OPENAI_MODEL : process.env.CODEX_MODEL)
  if (options.requestAgentText) {
    return options.requestAgentText({
      stage,
      role,
      prompt,
      instructions,
      context,
      agentResults,
      provider,
      model,
    })
  }
  if (provider === "codex") {
    return requestCodexExecText({
      stage,
      prompt,
      instructions,
      model,
      prepared: { projectPath: context.projectPath },
      outputPath,
      codexBin: options.codexBin,
      codexProfile: options.codexProfile,
      codexProfileV2: options.codexProfileV2,
      codexTimeoutMs: options.agentTimeoutMs ?? options.codexTimeoutMs,
    })
  }
  if (provider === "openai") {
    const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY
    if (!apiKey) throw new Error("Missing OpenAI API key. Pass --api-key or set OPENAI_API_KEY, or use --provider codex.")
    if (!model) throw new Error("Missing model. Pass --model or set OPENAI_MODEL.")

    const useResponsesApi = options.useResponsesApi ?? (options.endpoint ? /openai\.com$/i.test(String(options.endpoint)) : true)
    if (useResponsesApi) {
      return requestResponsesText({
        apiKey,
        endpoint: options.endpoint,
        model,
        prompt,
        instructions,
        reasoningEffort: options.reasoningEffort ?? "medium",
        timeoutMs: options.agentTimeoutMs,
      })
    }

    return requestOpenAICompatibleText({
      apiKey,
      endpoint: options.endpoint,
      model,
      prompt,
      instructions,
      reasoningEffort: options.reasoningEffort ?? "medium",
      timeoutMs: options.agentTimeoutMs,
    })
  }
  throw new Error(`Unsupported ask provider: ${provider}`)
}

export function buildAgenticPromptMetrics(context, agentResults, adjudicatorPromptMetrics = null) {
  const rolePrompts = agentResults.map((result) => ({
    role: result.role,
    status: result.status,
    ...(result.promptMetrics ?? { chars: 0, approxTokens: 0 }),
  }))
  const roleApproxTokens = rolePrompts.reduce((sum, item) => sum + (item.approxTokens ?? 0), 0)
  const totalApproxTokens = roleApproxTokens + (adjudicatorPromptMetrics?.approxTokens ?? 0)
  return {
    fullPrompt: context.contextMetrics?.prompt ?? promptTextMetrics(context.prompt),
    fullCopyAgenticApproxTokens: context.contextMetrics?.fullCopyAgenticApproxTokens ?? null,
    rolePrompts,
    roleApproxTokens,
    adjudicatorPrompt: adjudicatorPromptMetrics,
    totalApproxTokens,
  }
}

export async function writeAgenticAskArtifacts({ context, runId, runDir, provider, model, concurrency, status, agentResults, answer, error, adjudicatorPromptMetrics = null }) {
  const agentsDir = path.join(runDir, "agents")
  await ensureDirectory(agentsDir)
  const roles = []
  for (const result of agentResults) {
    let outputPath = null
    if (result.output?.trim()) {
      outputPath = path.join(agentsDir, `${sanitizeArtifactName(result.role)}.md`)
      await fs.writeFile(outputPath, result.output, "utf8")
    }
    roles.push({
      role: result.role,
      label: result.label,
      status: result.status,
      startedAt: result.startedAt,
      finishedAt: result.finishedAt,
      durationMs: result.durationMs,
      promptMetrics: result.promptMetrics ?? null,
      summary: compactAgentOutputSummary(result.output),
      outputPath: outputPath ? projectRelative(context.projectPath, outputPath) : null,
      error: result.error ?? null,
    })
  }
  let finalPath = null
  if (answer?.trim()) {
    finalPath = path.join(runDir, "final.md")
    await fs.writeFile(finalPath, answer, "utf8")
  }
  const manifest = {
    schema: "agent-run-manifest-v1",
    runId,
    mode: "ask",
    status,
    query: context.query,
    projectPath: context.projectPath,
    generatedAt: context.generatedAt,
    provider,
    model: model ?? null,
    concurrency,
    contextMetrics: context.contextMetrics ?? null,
    promptMetrics: buildAgenticPromptMetrics(context, agentResults, adjudicatorPromptMetrics),
    timing: {
      startedAt: roles.map((role) => role.startedAt).filter(Boolean).sort()[0] ?? null,
      finishedAt: nowLocalTimestamp(),
    },
    sourceRefs: askSourceRefsForManifest(context),
    roles,
    finalPath: finalPath ? projectRelative(context.projectPath, finalPath) : null,
    error: error ?? null,
  }
  const manifestPath = path.join(runDir, "manifest.json")
  await writeJson(manifestPath, manifest)
  return {
    runId,
    runDir,
    relativeRunDir: projectRelative(context.projectPath, runDir),
    manifestPath,
    relativeManifestPath: projectRelative(context.projectPath, manifestPath),
    finalPath,
    relativeFinalPath: finalPath ? projectRelative(context.projectPath, finalPath) : null,
    roles,
  }
}

export async function runAgenticAsk(options = {}) {
  const context = options.context
  if (!context) throw new Error("Missing agentic ask context")
  const provider = options.provider ?? "codex"
  const model = options.model ?? (provider === "openai" ? process.env.OPENAI_MODEL : process.env.CODEX_MODEL)
  const concurrency = parsePositiveInteger(options.agentConcurrency, DEFAULT_AGENT_CONCURRENCY)
  const artifactsEnabled = options.agentArtifacts !== false
  const artifactTarget = artifactsEnabled ? await nextAgentRunDir(context.projectPath, context.generatedAt, "ask") : { runId: null, runDir: null }
  const tmpDir = artifactsEnabled ? null : await fs.mkdtemp(path.join(os.tmpdir(), "trading-wiki-agentic-ask-"))
  const outputDir = artifactsEnabled ? path.join(artifactTarget.runDir, "agents") : tmpDir
  await ensureDirectory(outputDir)

  const agentResults = await mapWithConcurrency(AGENTIC_ASK_ROLES, concurrency, async (role) => {
    const startedAt = nowLocalTimestamp()
    const startedMs = Date.now()
    const outputPath = path.join(outputDir, `${sanitizeArtifactName(role.id)}.md`)
    const rolePrompt = buildAgenticAskRolePrompt(context, role)
    const promptMetrics = promptTextMetrics(rolePrompt)
    try {
      const output = await requestAgenticText({
        stage: `ask-agent-${role.id}`,
        role: role.id,
        prompt: rolePrompt,
        instructions: agenticAskInstructions(role),
        context,
        options,
        outputPath,
      })
      return {
        role: role.id,
        label: role.label,
        status: "ok",
        startedAt,
        finishedAt: nowLocalTimestamp(),
        durationMs: Date.now() - startedMs,
        promptMetrics,
        output,
      }
    } catch (err) {
      return {
        role: role.id,
        label: role.label,
        status: "failed",
        startedAt,
        finishedAt: nowLocalTimestamp(),
        durationMs: Date.now() - startedMs,
        promptMetrics,
        output: "",
        error: safeErrorMessage(err),
      }
    }
  })

  const successfulAgents = agentResults.filter((result) => result.status === "ok")
  if (successfulAgents.length === 0) {
    const error = "All agentic ask roles failed; adjudicator skipped."
    let artifact = null
    if (artifactsEnabled) {
      artifact = await writeAgenticAskArtifacts({
        context,
        runId: artifactTarget.runId,
        runDir: artifactTarget.runDir,
        provider,
        model,
        concurrency,
        status: "failed",
        agentResults,
        answer: "",
        error,
        adjudicatorPromptMetrics: null,
      })
    }
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    const failure = new Error(error)
    failure.agentRun = { runId: artifactTarget.runId, status: "failed", artifact, roles: agentResults, promptMetrics: buildAgenticPromptMetrics(context, agentResults, null) }
    throw failure
  }

  try {
    const adjudicatorPrompt = buildAgenticAskAdjudicatorPrompt(context, agentResults)
    const adjudicatorPromptMetrics = promptTextMetrics(adjudicatorPrompt)
    const answer = await requestAgenticText({
      stage: "ask-adjudicator",
      role: "adjudicator",
      prompt: adjudicatorPrompt,
      instructions: [
        "你是 Trading Review Wiki 多智能体问答框架的裁判员。",
        "必须综合成功 agent 的输出，并明确披露失败 agent 的影响。",
        askInstructions(),
      ].join("\n"),
      context,
      agentResults,
      options,
      outputPath: artifactsEnabled ? path.join(artifactTarget.runDir, "final.md") : path.join(outputDir, "final.md"),
    })
    const status = agentResults.some((result) => result.status === "failed") ? "ok_with_failures" : "ok"
    const artifact = artifactsEnabled ? await writeAgenticAskArtifacts({
      context,
      runId: artifactTarget.runId,
      runDir: artifactTarget.runDir,
      provider,
      model,
      concurrency,
      status,
      agentResults,
      answer,
      error: null,
      adjudicatorPromptMetrics,
    }) : null
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    return { answer, agentRun: { runId: artifactTarget.runId, status, artifact, roles: agentResults, concurrency, promptMetrics: buildAgenticPromptMetrics(context, agentResults, adjudicatorPromptMetrics) } }
  } catch (err) {
    const error = `Agentic ask adjudicator failed: ${safeErrorMessage(err)}`
    let artifact = null
    if (artifactsEnabled) {
      artifact = await writeAgenticAskArtifacts({
        context,
        runId: artifactTarget.runId,
        runDir: artifactTarget.runDir,
        provider,
        model,
        concurrency,
        status: "failed",
        agentResults,
        answer: "",
        error,
        adjudicatorPromptMetrics: null,
      })
    }
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    const failure = new Error(error)
    failure.agentRun = { runId: artifactTarget.runId, status: "failed", artifact, roles: agentResults, promptMetrics: buildAgenticPromptMetrics(context, agentResults, null) }
    throw failure
  }
}

export async function buildAskRetrievalContext(options = {}) {
  const query = String(options.query ?? "").trim()
  if (!query) throw new Error("Missing ask query")
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const sourceRouting = await selectAskSources({ ...options, query, projectPath })
  const selectedSourceIds = new Set(sourceRouting.selectedSources.map((source) => source.id))
  const retrieved = await searchAskCandidates(projectPath, query, options)
  const wikiSeedsForGraph = retrieved.wikiResults
  const wikiCandidates = selectedSourceIds.has("wiki_pages") ? retrieved.wikiResults : []
  const rawCandidates = selectedSourceIds.has("raw_text") ? retrieved.rawResults : []
  const graphExpansions = selectedSourceIds.has("wiki_graph") ? await expandAskGraph(projectPath, wikiSeedsForGraph, {
    graphNeighbors: options.graphNeighbors,
    graphDepth: options.graphDepth,
    query,
    tokens: retrieved.tokens,
  }) : []
  const factsSearch = selectedSourceIds.has("facts_jsonl") ? await searchAskFactsSplit(projectPath, query, retrieved.tokens, options) : { active: [], invalidated: [] }
  const factsCandidates = factsSearch.active
  const invalidatedFactsCandidates = factsSearch.invalidated
  const brainCandidates = selectedSourceIds.has("brain_memory") ? await searchAskBrain(projectPath, query, retrieved.tokens, options) : []
  const activePolicyRegistry = await listActiveSelfQuestionPolicies({ projectPath })
  const activePolicies = activePolicyRegistry.policies.map(compactAskActivePolicy)
  const stockDaily = selectedSourceIds.has("stock_daily_sql") ? await searchAskStockDaily(projectPath, query, options) : {
    status: "skipped",
    intent: null,
    descriptor: null,
    nativeQuery: null,
    results: [],
    warning: null,
  }

  const [navigation, wikiResults, rawResults, graphResults] = await Promise.all([
    addAskReferences(projectPath, retrieved.navigation, "N", retrieved.tokens, ASK_NAV_EXCERPT_CHARS),
    addAskReferences(projectPath, wikiCandidates, "W", retrieved.tokens, ASK_WIKI_EXCERPT_CHARS),
    addAskReferences(projectPath, rawCandidates, "R", retrieved.tokens, ASK_RAW_EXCERPT_CHARS),
    addAskReferences(projectPath, graphExpansions, "G", retrieved.tokens, ASK_GRAPH_EXCERPT_CHARS),
  ])
  const factsResults = addPrebuiltAskReferences(factsCandidates, "F")
  const invalidatedFactsResults = addPrebuiltAskReferences(invalidatedFactsCandidates, "FH")
  const brainResults = addPrebuiltAskReferences(brainCandidates, "M")
  const shouldRunTopicStockDaily =
    selectedSourceIds.has("stock_daily_sql") &&
    options.topicMarketValidation !== false &&
    (options.agentic || isTopicMarketValidationQuestion(query)) &&
    stockDaily.status !== "ok"
  const topicStockDaily = shouldRunTopicStockDaily
    ? await searchAskTopicStockDaily(projectPath, query, {
        ...options,
        stockDailyDescriptor: stockDaily.descriptor,
        evidenceItems: [
          ...navigation,
          ...wikiResults,
          ...rawResults,
          ...graphResults,
          ...factsResults,
          ...brainResults,
        ],
      })
    : null
  const stockDailyResults = addPrebuiltAskReferences([
    ...stockDaily.results,
    ...(topicStockDaily?.results ?? []),
  ], "S")
  const marketValidation = buildAskMarketValidation(stockDaily, topicStockDaily, query)
  const retrievalWarnings = [
    ...sourceRouting.route.warnings,
    stockDaily.warning,
    stockDaily.marketCrossCheck?.warning,
    topicStockDaily?.warning,
    topicStockDaily?.segmentConfigWarning,
  ].filter(Boolean)
  const nativeQueries = [
    selectedSourceIds.has("wiki_pages") ? { sourceId: "wiki_pages", language: "free-text", summary: query, status: "ok" } : null,
    selectedSourceIds.has("raw_text") ? { sourceId: "raw_text", language: "free-text", summary: query, status: "ok" } : null,
    selectedSourceIds.has("wiki_graph") ? { sourceId: "wiki_graph", language: "bounded graph traversal", summary: `seed wiki hits=${wikiSeedsForGraph.length}, graph_neighbors=${parsePositiveInteger(options.graphNeighbors, ASK_DEFAULT_GRAPH_NEIGHBORS)}, graph_depth=${resolveAskGraphDepth(query, options.graphDepth)}`, status: "ok" } : null,
    selectedSourceIds.has("facts_jsonl") ? { sourceId: "facts_jsonl", language: "JSONL token filter", summary: query, status: "ok" } : null,
    selectedSourceIds.has("brain_memory") ? { sourceId: "brain_memory", language: "JSONL memory filter", summary: query, status: "ok" } : null,
    selectedSourceIds.has("stock_daily_sql")
      ? {
          sourceId: "stock_daily_sql",
          language: "SQL",
          summary: topicStockDaily?.nativeQueries?.length
            ? `topic candidates: ${topicStockDaily.nativeQueries.map((item) => `${item.stockName ?? item.stockCode}: ${item.summary}`).join(" | ")}`
            : stockDaily.nativeQuery?.summary ?? stockDaily.warning ?? "not executed",
          status: topicStockDaily?.status ?? stockDaily.status,
        }
      : null,
  ].filter(Boolean)

  const context = {
    query,
    projectPath,
    generatedAt: nowLocalTimestamp(),
    retrievalMode: RETRIEVAL_MODES.ASK,
    tokens: retrieved.tokens,
    counts: {
      ...retrieved.counts,
      wikiMatches: wikiCandidates.length,
      rawMatches: rawCandidates.length,
      graphMatches: graphExpansions.length,
      factsMatches: factsCandidates.length,
      invalidatedFactsMatches: invalidatedFactsCandidates.length,
      brainMatches: brainCandidates.length,
      activePolicies: activePolicies.length,
      sqlRows: stockDaily.results.length + (topicStockDaily?.rowCount ?? 0),
    },
    sourceRouting,
    selectedSources: sourceRouting.selectedSources,
    nativeQueries,
    retrievalWarnings,
    navigation,
    wikiResults,
    rawResults,
    graphExpansions: graphResults,
    factsResults,
    invalidatedFactsResults,
    brainResults,
    activePolicies,
    stockDailyResults,
    stockDaily,
    topicStockDaily,
    marketValidation,
  }
  const prompt = buildAskPrompt(context)
  const contextWithPrompt = { ...context, prompt }
  return { ...contextWithPrompt, contextMetrics: buildAskContextMetrics(contextWithPrompt) }
}

export async function askWiki(options = {}) {
  const provider = options.provider ?? "codex"
  const context = await buildAskRetrievalContext({ ...options, provider })
  if (options.showContext) return { ...context, answer: null }

  if (options.agentic) {
    const result = await runAgenticAsk({ ...options, provider, context })
    return { ...context, answer: result.answer, agentRun: result.agentRun }
  }

  if (provider === "codex") {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "trading-wiki-ask-"))
    const outputPath = path.join(tmpDir, "answer.md")
    try {
      const answer = await requestCodexExecText({
        stage: "ask",
        prompt: context.prompt,
        instructions: askInstructions(),
        model: options.model,
        prepared: { projectPath: context.projectPath },
        outputPath,
        codexBin: options.codexBin,
        codexProfile: options.codexProfile,
        codexProfileV2: options.codexProfileV2,
        codexTimeoutMs: options.codexTimeoutMs,
      })
      return { ...context, answer }
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    }
  }

  if (provider === "openai") {
    const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY
    const model = options.model ?? process.env.OPENAI_MODEL
    if (!apiKey) throw new Error("Missing OpenAI API key. Pass --api-key or set OPENAI_API_KEY, or use --provider codex.")
    if (!model) throw new Error("Missing model. Pass --model or set OPENAI_MODEL.")
    const answer = await requestResponsesText({
      apiKey,
      endpoint: options.endpoint,
      model,
      prompt: context.prompt,
      instructions: askInstructions(),
      reasoningEffort: options.reasoningEffort ?? "medium",
    })
    return { ...context, answer }
  }

  throw new Error(`Unsupported ask provider: ${provider}`)
}

export function normalizeEvalList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean)
  return String(value ?? "")
    .split(/[,，\n|]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

export function normalizeEvalPath(value) {
  return toPosixPath(String(value ?? ""))
    .trim()
    .replace(/^\/+/, "")
    .replace(/\.md$/i, ".md")
}

export function askEvalPathMatches(actual, expected) {
  const a = normalizeEvalPath(actual)
  const e = normalizeEvalPath(expected)
  if (!a || !e) return false
  if (a === e) return true
  const noExtA = a.replace(/\.md$/i, "")
  const noExtE = e.replace(/\.md$/i, "")
  return noExtA === noExtE || a.endsWith(`/${e}`) || noExtA.endsWith(`/${noExtE}`)
}

export function isNoisyRawPath(relativePath) {
  return /(?:^|\/)raw\/(?:微信聊天|openclaw数据)(?:\/|$)/.test(toPosixPath(relativePath))
}

export function clampScore(value) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

export function evaluateAskRetrievalCase(context, expectations = {}) {
  const expectedPaths = normalizeEvalList(expectations.expectedPaths ?? expectations.expectPaths ?? expectations.expect)
  const hits = [
    ...context.wikiResults.map((item) => ({ ...item, bucket: "wiki" })),
    ...context.rawResults.map((item) => ({ ...item, bucket: "raw" })),
    ...context.graphExpansions.map((item) => ({ ...item, bucket: "graph" })),
    ...context.factsResults.map((item) => ({ ...item, bucket: "facts" })),
    ...context.brainResults.map((item) => ({ ...item, bucket: "brain" })),
    ...context.stockDailyResults.map((item) => ({ ...item, bucket: "stock_daily" })),
  ]
  const matchedExpectedPaths = expectedPaths.filter((expected) => hits.some((hit) => askEvalPathMatches(hit.path, expected)))
  const recallScore = expectedPaths.length > 0 ? clampScore((matchedExpectedPaths.length / expectedPaths.length) * 100) : null

  const topHits = hits.slice(0, 10)
  const relevanceScore = topHits.length > 0
    ? clampScore((topHits.filter((hit) => hit.score > 0).length / topHits.length) * 100)
    : 0

  const selected = context.selectedSources.filter((source) => source.available)
  const sourceHitCounts = {
    wiki_pages: context.wikiResults.length,
    raw_text: context.rawResults.length,
    wiki_graph: context.graphExpansions.length,
    facts_jsonl: context.factsResults.length,
    brain_memory: context.brainResults.length,
    stock_daily_sql: context.stockDailyResults.length,
  }
  const evidenceCoverageScore = selected.length > 0
    ? clampScore((selected.filter((source) => (sourceHitCounts[source.id] ?? 0) > 0).length / selected.length) * 100)
    : 0

  const rawNoiseRate = context.rawResults.length > 0
    ? context.rawResults.filter((item) => isNoisyRawPath(item.path) && !item.structuredSourceMatch?.length).length / context.rawResults.length
    : 0
  const rawNoiseScore = clampScore((1 - rawNoiseRate) * 100)

  const structuredWikiHits = context.wikiResults.filter((item) => {
    const matches = item.frontmatterMatches ?? []
    return matches.length > 0 || item.frontmatterMatch || item.frontmatterSources?.length || item.frontmatterRelated?.length || item.frontmatterTags?.length
  })
  const structureFieldCoverageScore = context.wikiResults.length > 0
    ? clampScore((structuredWikiHits.length / context.wikiResults.length) * 100)
    : 0

  const recallComponent = recallScore == null ? relevanceScore : recallScore
  const overallScore = clampScore(
    recallComponent * 0.35 +
      relevanceScore * 0.2 +
      evidenceCoverageScore * 0.2 +
      structureFieldCoverageScore * 0.15 +
      rawNoiseScore * 0.1,
  )

  return {
    expectedPaths,
    matchedExpectedPaths,
    missedExpectedPaths: expectedPaths.filter((expected) => !matchedExpectedPaths.includes(expected)),
    topHits: hits.slice(0, 12).map(({ bucket, path, title, score }) => ({ bucket, path, title, score })),
    sourceHitCounts,
    metrics: {
      recall: recallScore,
      relevance: relevanceScore,
      evidenceCoverage: evidenceCoverageScore,
      rawNoise: rawNoiseScore,
      structureFieldCoverage: structureFieldCoverageScore,
      overall: overallScore,
    },
  }
}

export function normalizeAskEvalCases(options) {
  if (Array.isArray(options.cases) && options.cases.length > 0) return options.cases
  return [
    {
      id: "default",
      query:
        options.query ??
        "最近一个月物理AI/具身智能/机器人方向，A股投资应该优先看哪些产业链环节和标的？请区分已有知识库反复验证的证据、仍偏叙事的环节，以及交易上要验证的量价/订单/客户节点。",
      expectedPaths: options.expectedPaths ?? options.expectPaths ?? options.expect,
    },
  ]
}

export async function runAskEval(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const cases = []
  for (const [index, rawCase] of normalizeAskEvalCases(options).entries()) {
    const query = String(rawCase.query ?? "").trim()
    if (!query) throw new Error("Ask eval case is missing query")
    const context = await buildAskRetrievalContext({
      ...options,
      ...rawCase,
      projectPath,
      query,
      provider: options.provider ?? "codex",
      showContext: true,
    })
    const evaluation = evaluateAskRetrievalCase(context, rawCase)
    cases.push({
      id: rawCase.id ?? `case-${index + 1}`,
      query,
      retrievalMode: context.retrievalMode,
      selectedSources: context.selectedSources.map((source) => source.id),
      counts: context.counts,
      ...evaluation,
    })
  }

  const aggregate = {
    cases: cases.length,
    recall: clampScore(cases.reduce((sum, item) => sum + (item.metrics.recall ?? item.metrics.relevance), 0) / Math.max(1, cases.length)),
    relevance: clampScore(cases.reduce((sum, item) => sum + item.metrics.relevance, 0) / Math.max(1, cases.length)),
    evidenceCoverage: clampScore(cases.reduce((sum, item) => sum + item.metrics.evidenceCoverage, 0) / Math.max(1, cases.length)),
    rawNoise: clampScore(cases.reduce((sum, item) => sum + item.metrics.rawNoise, 0) / Math.max(1, cases.length)),
    structureFieldCoverage: clampScore(cases.reduce((sum, item) => sum + item.metrics.structureFieldCoverage, 0) / Math.max(1, cases.length)),
    overall: clampScore(cases.reduce((sum, item) => sum + item.metrics.overall, 0) / Math.max(1, cases.length)),
  }

  const result = {
    mode: "ask-eval",
    generatedAt: nowLocalTimestamp(),
    projectPath,
    retrievalMode: RETRIEVAL_MODES.ASK,
    aggregate,
    cases,
  }

  if (options.write) {
    const fileStamp = result.generatedAt.replace(/[-: ]/g, "").slice(0, 14)
    const outputPath = path.join(projectPath, ".llm-wiki", "eval", `ask-eval-${fileStamp}.json`)
    await writeJson(outputPath, result)
    return { ...result, outputPath, relativePath: projectRelative(projectPath, outputPath) }
  }

  return result
}
