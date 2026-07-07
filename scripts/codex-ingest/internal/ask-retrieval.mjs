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
  describeStockDailySqlSource,
  getStockDailyPgConfig,
  hasUsableStockDailyPgConfig,
  isBrainQuestion,
  isFactsQuestion,
  isRawNewsQuestion,
  isStockDailyQuestion,
  isTopicMarketValidationQuestion,
  isTradeReviewQuestion,
  parseAskSourcesOption,
  redactPgConfig,
  stockDailyPgConfigUnavailableReason,
} from "./ask-market.mjs"

import {
  ASK_DEFAULT_SOURCE_K,
  ASK_DEFAULT_TOP_FACTS,
  ASK_DEFAULT_TOP_RAW,
  ASK_DEFAULT_TOP_WIKI,
  ASK_FACTS_EXCERPT_CHARS,
  ASK_NAVIGATION_PATHS,
  ASK_SOURCE_IDS,
  DEFAULT_PROJECT_PATH,
  RETRIEVAL_MODES,
  TEMPORAL_FACTS_RELATIVE_PATH,
  TEXT_EXTENSIONS,
  filterRawFilesByQueryPolicy,
  isReservedWikiPath,
  jsonLineSearchText,
  listFilesRecursive,
  normalizePath,
  parseJsonObjectFromModelText,
  parsePositiveInteger,
  projectRelative,
  readIfExists,
  requestCodexExecText,
  requestResponsesText,
  safeErrorMessage,
} from "./core.mjs"

import {
  boostRawResultsByWikiStructure,
  excerptForPrompt,
  getRecencyBoost,
  isTemporalFactRecord,
  normalizeTemporalFactStatus,
  readTemporalFactEntries,
  scoreFile,
  sortSearchResults,
  tokenMatchScore,
  tokenizeQuery,
} from "./knowledge.mjs"

export function buildBaseAskSources(projectPath, options = {}) {
  const stockDailyConfig = getStockDailyPgConfig(process.env, options)
  const hasStockDailyConfig = hasUsableStockDailyPgConfig(stockDailyConfig)
  return [
    {
      id: "wiki_pages",
      label: "Wiki Pages",
      kind: "text",
      nativeLanguage: "free-text",
      available: true,
      descriptor: "Schema v1 Markdown wiki pages under wiki/**/*.md; rich frontmatter, titles, aliases, tags, related links, and page body.",
    },
    {
      id: "raw_text",
      label: "Raw Text",
      kind: "text",
      nativeLanguage: "free-text",
      available: true,
      descriptor: "Immutable source material under raw/**, including daily reviews, WeChat sentiment, research/news, meeting clues, and trade materials.",
    },
    {
      id: "wiki_graph",
      label: "Wiki Graph",
      kind: "graph",
      nativeLanguage: "bounded graph traversal",
      available: true,
      descriptor: "Local wiki graph from .llm-wiki/graph.json when present, otherwise wikilinks and shared sources derived from wiki pages.",
    },
    {
      id: "facts_jsonl",
      label: "Facts JSONL",
      kind: "jsonl",
      nativeLanguage: "JSONL filter/search",
      available: true,
      descriptor: "Structured fact files under data/facts/*.jsonl, including observations and cases.",
    },
    {
      id: "brain_memory",
      label: "Brain Memory",
      kind: "jsonl",
      nativeLanguage: "JSONL memory filter/search",
      available: true,
      descriptor: "Long-term MPA memory under data/brain/*.jsonl, including active threads, corrections, validations, guardrails, preferences, and self-training events.",
    },
    {
      id: "stock_daily_sql",
      label: "Stock Daily SQL",
      kind: "sql",
      nativeLanguage: "PostgreSQL SELECT",
      available: Boolean(options.stockDailyExecutor || options.stockDailyColumns || hasStockDailyConfig),
      descriptor: "Read-only PostgreSQL stock daily source configured by PG_SHIHAO_* or PG_SHIHAO_CONFIG_PATH; daily OHLCV/amount style stock price data.",
      config: redactPgConfig(stockDailyConfig),
      unavailableReason: hasStockDailyConfig || options.stockDailyExecutor || options.stockDailyColumns ? null : stockDailyPgConfigUnavailableReason(stockDailyConfig),
    },
  ]
}

export async function buildAskSourceRegistry(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const query = String(options.query ?? "")
  const sources = buildBaseAskSources(projectPath, options)
  const stockSource = sources.find((source) => source.id === "stock_daily_sql")
  const shouldDescribeStockDaily =
    options.stockDailyColumns ||
    options.stockDailyExecutor ||
    ((isStockDailyQuestion(query) || (options.agentic && isTopicMarketValidationQuestion(query))) && hasUsableStockDailyPgConfig(getStockDailyPgConfig(process.env, options)))
  if (stockSource && shouldDescribeStockDaily) {
    const descriptor = await describeStockDailySqlSource(options)
    stockSource.available = descriptor.ok || Boolean(options.stockDailyExecutor)
    stockSource.columns = descriptor.columns
    stockSource.config = descriptor.config
    stockSource.unavailableReason = descriptor.ok || options.stockDailyExecutor ? null : descriptor.error
    stockSource.descriptor = `${stockSource.descriptor} Columns: ${descriptor.columns.all.slice(0, 40).join(", ") || "unavailable"}.`
  }
  return { projectPath, sources }
}

export function rankAskSourcesByRules(query, sources, options = {}) {
  const stockIntent = isStockDailyQuestion(query)
  const topicMarketIntent = isTopicMarketValidationQuestion(query)
  const tradeIntent = isTradeReviewQuestion(query)
  const factsIntent = isFactsQuestion(query)
  const brainIntent = isBrainQuestion(query)
  const rawIntent = isRawNewsQuestion(query)
  return sources.map((source) => {
    let score = 1
    let required = false
    const reasons = []
    if (source.id === "wiki_pages") {
      score += 8
      reasons.push("default wiki semantic source")
      if (!stockIntent) {
        required = true
        reasons.push("default compiled wiki source")
      }
      if (tradeIntent) {
        score += 15
        required = true
        reasons.push("trade review/error/pattern query")
      }
    }
    if (source.id === "raw_text") {
      score += 7
      reasons.push("default raw evidence source")
      if (tradeIntent || rawIntent) {
        score += 14
        required = true
        reasons.push("recent/review/news/source-material query")
      }
    }
    if (source.id === "wiki_graph") {
      score += 5
      reasons.push("default bounded relation expansion")
      if (!stockIntent) {
        required = true
        reasons.push("default graph expansion after wiki hits")
      }
      if (tradeIntent || /关联|关系|相关|链路|图谱|扩展/.test(query)) {
        score += 13
        required = true
        reasons.push("relationship or error/pattern expansion query")
      }
    }
    if (source.id === "facts_jsonl") {
      score += 2
      if (factsIntent) {
        score += 15
        required = true
        reasons.push("facts/cases/observations query")
      }
    }
    if (source.id === "brain_memory") {
      score += 4
      reasons.push("default long-term memory and correction source")
      if (!stockIntent || tradeIntent || factsIntent || brainIntent) {
        score += brainIntent ? 16 : 6
        required = true
        reasons.push("MPA memory/correction/validation recall")
      }
    }
    if (source.id === "stock_daily_sql") {
      if (stockIntent) {
        score += 30
        required = true
        reasons.push("price/volume/trading-day query")
      } else if (options.agentic && topicMarketIntent) {
        score += 18
        required = true
        reasons.push("agentic theme question needs candidate-stock market validation")
      }
    }
    if (!source.available && source.id !== "stock_daily_sql") score -= 100
    return { sourceId: source.id, score, required, reasons }
  })
}

export function buildSourceRoutingPrompt({ query, sources, sourceK }) {
  const rows = sources.map((source) => ({
    id: source.id,
    label: source.label,
    kind: source.kind,
    nativeLanguage: source.nativeLanguage,
    available: source.available,
    descriptor: source.descriptor,
    unavailableReason: source.unavailableReason,
  }))
  return [
    "# Ask Source Routing",
    "",
    `question: ${query}`,
    `max_sources: ${sourceK}`,
    "",
    "Select the most useful sources for answering the question. Return only JSON:",
    '{"source_ids":["wiki_pages","raw_text"],"rationale":{"wiki_pages":"..."}}',
    "",
    "Registered sources:",
    "```json",
    JSON.stringify(rows, null, 2),
    "```",
  ].join("\n")
}

export async function rankAskSourcesWithLlm({ query, sources, sourceK, options }) {
  const provider = options.provider ?? "codex"
  const prompt = buildSourceRoutingPrompt({ query, sources, sourceK })
  const instructions = "You are a source router for a trading knowledge-base retrieval CLI. Return only the requested JSON object."
  let text
  if (options.requestSourceRoutingText) {
    text = await options.requestSourceRoutingText({ stage: "ask-source-routing", prompt, instructions, sources, query, sourceK })
  } else if (provider === "codex") {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "trading-wiki-source-router-"))
    const outputPath = path.join(tmpDir, "sources.json")
    try {
      text = await requestCodexExecText({
        stage: "ask-source-routing",
        prompt,
        instructions,
        model: options.model,
        prepared: { projectPath: normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH) },
        outputPath,
        codexBin: options.codexBin,
        codexProfile: options.codexProfile,
        codexProfileV2: options.codexProfileV2,
        codexTimeoutMs: options.codexTimeoutMs,
      })
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    }
  } else if (provider === "openai") {
    const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY
    const model = options.model ?? process.env.OPENAI_MODEL
    if (!apiKey || !model) return { sourceIds: [], rationale: {}, warning: "OpenAI source routing skipped because api key/model is missing" }
    text = await requestResponsesText({
      apiKey,
      endpoint: options.endpoint,
      model,
      prompt,
      instructions,
      reasoningEffort: options.reasoningEffort ?? "low",
    })
  } else {
    return { sourceIds: [], rationale: {}, warning: `Unsupported source routing provider: ${provider}` }
  }
  const parsed = parseJsonObjectFromModelText(text)
  const sourceIds = Array.isArray(parsed.source_ids) ? parsed.source_ids.filter((id) => ASK_SOURCE_IDS.includes(id)) : []
  return { sourceIds, rationale: parsed.rationale && typeof parsed.rationale === "object" ? parsed.rationale : {}, warning: null }
}

export async function selectAskSources(options = {}) {
  const query = String(options.query ?? "").trim()
  const sourceK = parsePositiveInteger(options.sourceK, ASK_DEFAULT_SOURCE_K)
  const registry = await buildAskSourceRegistry(options)
  const rules = rankAskSourcesByRules(query, registry.sources, options)
  const sourceById = new Map(registry.sources.map((source) => [source.id, source]))
  const explicit = parseAskSourcesOption(options.sources)
  const warnings = []
  let llmRanking = { sourceIds: [], rationale: {}, warning: null }

  if (explicit) {
    const selectedSources = explicit.map((id) => ({ ...sourceById.get(id), routeReason: "explicit --sources" })).filter(Boolean)
    return { registry, selectedSources, route: { mode: "explicit", sourceK, rules, llmRanking, warnings } }
  }

  const shouldUseLlm = options.useLlmSourceRouting !== false && ["codex", "openai"].includes(options.provider ?? "")
  if (shouldUseLlm) {
    try {
      llmRanking = await rankAskSourcesWithLlm({ query, sources: registry.sources, sourceK, options })
      if (llmRanking.warning) warnings.push(llmRanking.warning)
    } catch (err) {
      warnings.push(`LLM source routing failed; using rules fallback: ${safeErrorMessage(err)}`)
    }
  }

  const ruleRanked = [...rules].sort((a, b) => b.score - a.score || a.sourceId.localeCompare(b.sourceId))
  const requiredIds = ruleRanked.filter((item) => item.required).map((item) => item.sourceId)
  const selectedIds = []
  const add = (id) => {
    if (!sourceById.has(id) || selectedIds.includes(id)) return
    selectedIds.push(id)
  }
  requiredIds.forEach(add)
  const targetSourceCount = Math.max(sourceK, requiredIds.length)
  llmRanking.sourceIds.forEach((id) => {
    if (selectedIds.length < targetSourceCount) add(id)
  })
  ruleRanked.forEach((item) => {
    if (selectedIds.length < targetSourceCount) add(item.sourceId)
  })
  if (selectedIds.length === 0) ["wiki_pages", "raw_text", "wiki_graph"].forEach(add)

  const ruleById = new Map(rules.map((rule) => [rule.sourceId, rule]))
  const selectedSources = selectedIds.map((id) => {
    const source = sourceById.get(id)
    const rule = ruleById.get(id)
    return {
      ...source,
      ruleScore: rule?.score ?? 0,
      routeReason: llmRanking.sourceIds.includes(id) ? llmRanking.rationale?.[id] ?? "LLM selected" : rule?.reasons?.join("; ") ?? "rules fallback",
    }
  })
  return {
    registry,
    selectedSources,
    route: {
      mode: shouldUseLlm && llmRanking.sourceIds.length > 0 ? "llm+rules" : "rules",
      sourceK,
      rules,
      llmRanking,
      warnings,
    },
  }
}

export async function scoreAskFile({ filePath, projectPath, tokens, query, isRaw }) {
  const scored = await scoreFile({
    filePath,
    projectPath,
    sourcePath: null,
    tokens,
    query,
    isRaw,
    mode: RETRIEVAL_MODES.ASK,
  })
  if (!scored) return null
  return scored
}

export async function searchAskCandidates(projectPath, query, options = {}) {
  const pp = normalizePath(projectPath)
  const tokens = tokenizeQuery(query)
  const effectiveTokens = tokens.length > 0 ? tokens : [query.trim().toLowerCase()]
  const topWiki = parsePositiveInteger(options.topWiki, ASK_DEFAULT_TOP_WIKI)
  const topRaw = parsePositiveInteger(options.topRaw, ASK_DEFAULT_TOP_RAW)

  const [wikiFiles, rawFiles] = await Promise.all([
    listFilesRecursive(path.join(pp, "wiki"), {
      extensions: new Set([".md"]),
      excludeDirNames: new Set([".git", ".conflicts", "scripts"]),
    }),
    listFilesRecursive(path.join(pp, "raw"), {
      extensions: TEXT_EXTENSIONS,
      excludeDirNames: new Set([".git", ".llm-wiki", ".obsidian", "scripts", "templates", "archive", "assets"]),
      maxBytes: options.maxRawBytes ?? null,
      preferRecent: true,
      maxFiles: options.rawScanLimit ?? 320,
    }),
  ])
  const policyRawFiles = filterRawFilesByQueryPolicy(rawFiles, query, { ...options, mode: RETRIEVAL_MODES.ASK })

  const navigation = []
  for (const relativePath of ASK_NAVIGATION_PATHS) {
    const filePath = path.join(pp, relativePath)
    const scored = await scoreAskFile({ filePath, projectPath: pp, tokens: effectiveTokens, query, isRaw: false })
    if (scored) navigation.push({ ...scored, navigation: true })
  }

  const wikiResults = []
  for (const filePath of wikiFiles) {
    const relativePath = projectRelative(pp, filePath)
    if (isReservedWikiPath(relativePath)) continue
    const scored = await scoreAskFile({ filePath, projectPath: pp, tokens: effectiveTokens, query, isRaw: false })
    if (scored) wikiResults.push(scored)
  }

  const rawResults = []
  for (const filePath of policyRawFiles) {
    const scored = await scoreAskFile({ filePath, projectPath: pp, tokens: effectiveTokens, query, isRaw: true })
    if (scored) rawResults.push(scored)
  }
  boostRawResultsByWikiStructure(rawResults, sortSearchResults([...wikiResults]))

  return {
    retrievalMode: RETRIEVAL_MODES.ASK,
    query,
    projectPath: pp,
    tokens: effectiveTokens,
    navigation: sortSearchResults(navigation),
    wikiResults: sortSearchResults(wikiResults).slice(0, topWiki),
    rawResults: sortSearchResults(rawResults).slice(0, topRaw),
    counts: {
      wikiFiles: wikiFiles.length,
      rawFiles: policyRawFiles.length,
      wikiMatches: wikiResults.length,
      rawMatches: rawResults.length,
    },
  }
}

export function buildFactSearchResult({ relativePath, lineNumber, parsed, score, temporalStatus = null, statusReason = null }) {
  const title =
    (parsed && typeof parsed === "object" && !Array.isArray(parsed) && (parsed.title ?? parsed.name ?? parsed.subject ?? parsed.claim ?? parsed.id ?? parsed.date ?? parsed.created_at)) ||
    `${path.basename(relativePath)}:${lineNumber}`
  return {
    sourceId: "facts_jsonl",
    path: `facts:${relativePath}:${lineNumber}`,
    title: String(title),
    score,
    type: temporalStatus ? `TEMPORAL_${temporalStatus.toUpperCase()}` : "JSONL",
    temporalStatus,
    statusReason,
    nativeQuery: `JSONL token filter over ${relativePath}`,
    excerpt: excerptForPrompt(typeof parsed === "string" ? parsed : JSON.stringify(parsed, null, 2), ASK_FACTS_EXCERPT_CHARS),
    value: parsed,
  }
}

export async function searchAskFactsSplit(projectPath, query, tokens, options = {}) {
  const pp = normalizePath(projectPath)
  const topFacts = parsePositiveInteger(options.topFacts, ASK_DEFAULT_TOP_FACTS)
  const includeInvalidated = Boolean(options.includeInvalidated)
  const files = await listFilesRecursive(path.join(pp, "data", "facts"), {
    extensions: new Set([".jsonl"]),
    excludeDirNames: new Set([".git", "node_modules"]),
    maxBytes: options.maxFactsBytes ?? 1024 * 1024 * 5,
  }).catch(() => [])
  const activeResults = []
  const invalidatedResults = []
  for (const filePath of files) {
    const relativePath = projectRelative(pp, filePath)
    if (relativePath === TEMPORAL_FACTS_RELATIVE_PATH) {
      const entries = await readTemporalFactEntries(pp)
      for (const entry of entries) {
        const parsed = entry.value
        const searchText = `${relativePath}\n${jsonLineSearchText(parsed)}`
        const score = tokenMatchScore(searchText, tokens) + getRecencyBoost(`${relativePath}:${entry.line}`, query)
        if (score <= 0) continue
        const inactive = entry.status !== "active"
        if (inactive && !includeInvalidated) continue
        const result = buildFactSearchResult({
          relativePath,
          lineNumber: entry.line,
          parsed,
          score: score + (inactive ? 1 : 3),
          temporalStatus: entry.status,
          statusReason: entry.statusReason,
        })
        if (inactive) invalidatedResults.push(result)
        else activeResults.push(result)
      }
      continue
    }
    const raw = await readIfExists(filePath)
    if (!raw.trim()) continue
    const lines = raw.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim()
      if (!line) continue
      let parsed
      try {
        parsed = JSON.parse(line)
      } catch {
        parsed = line
      }
      const searchText = `${relativePath}\n${jsonLineSearchText(parsed)}`
      const score = tokenMatchScore(searchText, tokens) + getRecencyBoost(`${relativePath}:${i + 1}`, query)
      if (score <= 0) continue
      if (isTemporalFactRecord(parsed)) {
        const status = normalizeTemporalFactStatus(parsed.status)
        if (status !== "active" && !includeInvalidated) continue
        const result = buildFactSearchResult({
          relativePath,
          lineNumber: i + 1,
          parsed,
          score: score + (status === "active" ? 3 : 1),
          temporalStatus: status,
          statusReason: null,
        })
        if (status === "active") activeResults.push(result)
        else invalidatedResults.push(result)
      } else {
        activeResults.push(buildFactSearchResult({
          relativePath,
          lineNumber: i + 1,
          parsed,
          score: score + 3,
        }))
      }
    }
  }
  return {
    active: sortSearchResults(activeResults).slice(0, topFacts),
    invalidated: sortSearchResults(invalidatedResults).slice(0, topFacts),
  }
}

export async function searchAskFacts(projectPath, query, tokens, options = {}) {
  const results = await searchAskFactsSplit(projectPath, query, tokens, options)
  return results.active
}
