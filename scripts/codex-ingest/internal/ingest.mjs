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
  CONFIDENCE,
  DEFAULT_PROJECT_PATH,
  DEFAULT_SOURCE_SHARD_CONCURRENCY,
  INGEST_SEGMENT_DEFAULT_MAX,
  MANIFEST_SCHEMA,
  PAGE_BODY_LINE_SOFT_LIMIT,
  REPORT_ROOT,
  SOURCE_MAINLINE_INDEX_END,
  SOURCE_MAINLINE_INDEX_START,
  TEMPORAL_FACTS_RELATIVE_PATH,
  TEMPORAL_FACT_EVIDENCE_LEVELS,
  TEMPORAL_FACT_PREDICATES,
  TEMPORAL_FACT_SOURCE_KINDS,
  TEMPORAL_FACT_STATUSES,
  WIKI_STATUS,
  WIKI_TYPES,
  appendJsonl,
  assertSafeWikiPath,
  dailyLogPathFromTimestamp,
  defaultConvertedSourcePath,
  ensureDirectory,
  execFileAsync,
  exists,
  isConvertibleSourcePath,
  isLogPath,
  isReservedWikiPath,
  isTextSourcePath,
  listFilesRecursive,
  makeReportId,
  mapWithConcurrency,
  normalizePath,
  nowLocalTimestamp,
  parsePositiveInteger,
  pathToTitle,
  projectRelative,
  readIfExists,
  readTextFile,
  requestCodexExecText,
  requestResponsesText,
  shortHash,
  writeJson,
} from "./core.mjs"

import {
  applyConceptGovernanceToNormalizedPlan,
  buildMethodologyContext,
  buildSourceShardingPlan,
  buildTemporalFactContext,
  compactSourceContentForPrompt,
  extractTitle,
  extractWechatMainlineIndex,
  formatConceptGovernanceContextMarkdown,
  inferTypeFromPath,
  normalizeManifestFactWrites,
  normalizeTypeAlias,
  parseFrontmatter,
  planTemporalFactWrites,
  searchCandidatePages,
  validatePreserveLargeHousekeepingPage,
  validateTemporalFactPlan,
  validateWikiContent,
  writeTemporalFactsIndex,
} from "./knowledge.mjs"
import { maybeSyncApplyReportToSag } from "./sag-sync.mjs"
import {
  buildSectionOutline,
  parseSectionPatchOpsFromModelText,
  resolvePagePatchContent,
  resolvePageWriteMode,
} from "./ingest-page-patch.mjs"
import {
  JUDGMENTS_RELATIVE_PATH,
  JUDGMENT_KINDS,
  JUDGMENT_STATUSES,
  normalizeManifestJudgmentWrites,
  planJudgmentWrites,
  validateJudgmentPlan,
  writeJudgmentsIndex,
} from "./judgments.mjs"
import { applyEmbeddingRoutingToCandidates, isEmbeddingIndexedPath, maybeRefreshWikiEmbeddingIndex } from "./embeddings.mjs"

export async function collectWikiDirs(projectPath) {
  try {
    const entries = await fs.readdir(path.join(projectPath, "wiki"), { withFileTypes: true })
    return entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => `wiki/${entry.name}/`)
      .sort()
  } catch {
    return []
  }
}

export async function gitDirtyStatus(projectPath) {
  try {
    const { stdout } = await execFileAsync("git", ["-C", projectPath, "status", "--short"], {
      maxBuffer: 1024 * 1024 * 4,
    })
    return stdout.trim().split(/\r?\n/).filter(Boolean)
  } catch (err) {
    return [`git status unavailable: ${err instanceof Error ? err.message : String(err)}`]
  }
}

export function buildContextMarkdown({
  projectPath,
  sourcePath,
  sourceRelativePath,
  sourceHash,
  sourceContent,
  schema,
  purpose,
  index,
  overview,
  wikiDirs,
  candidates,
  temporalFactContext,
  conceptGovernance,
  methodologyContext,
  createdAt,
}) {
  const candidateLines = candidates.wikiCandidates
    .slice(0, 20)
    .map(
      (item, i) =>
        `${i + 1}. ${item.path} | score=${item.score} | type=${item.type} | title=${item.title}\n   ${item.snippet}`,
    )
    .join("\n")

  const rawLines = candidates.rawCandidates
    .slice(0, 12)
    .map((item, i) => `${i + 1}. ${item.path} | score=${item.score} | title=${item.title}\n   ${item.snippet}`)
    .join("\n")
  const segmentLines = segmentCandidateSummary(candidates.segments ?? [])

  return [
    "# Codex Text Ingest Context",
    "",
    "Use this context to produce an application-grade ingest manifest. This is not a summary-only task.",
    "",
    "## Critical Rules",
    "- Read the source as the primary evidence and preserve its operational meaning.",
    "- Put wiki/page/log changes only in `writes`; put temporal facts only in `factWrites`.",
    "- `writes` may write only `wiki/**`, `wiki/index.md`, `wiki/overview.md`, and daily logs in `wiki/logs/`.",
    `- \`factWrites\` may write only \`${TEMPORAL_FACTS_RELATIVE_PATH}\` and must never be mixed into \`writes\`.`,
    "- Never modify `raw/**`.",
    "- Stock-page boundary: `wiki/股票/**` is for company profile, industry position, catalysts, fundamentals/news, validation framework, risks, and source links; do not record user trade execution data there.",
    "- User trade execution data means buy/sell actions, fills, prices, quantities, position size, holdings ledger, P&L, settlement rows, or trade-journal details. Keep those in raw sources, summaries, strategy/error reviews, or brain/facts when appropriate; stock pages may link to reviews but must not copy execution details.",
    "- For updates, preserve existing page knowledge and merge the new source as additional evidence.",
    "- Use full-path wikilinks like `[[概念/XXX]]`.",
    "- Keep `related` frontmatter synchronized with `## 相关页面`.",
    "- Do not create deprecated directories such as `wiki/市场环境/` or `wiki/进化/`.",
    "- If a candidate page is relevant, update it instead of creating a duplicate.",
    "",
    "## Expected Manifest Shape",
    "```json",
    JSON.stringify(
      {
        $schema: MANIFEST_SCHEMA,
        projectPath,
        sourcePath,
        sourceRelativePath,
        sourceHash,
        writes: [
          {
            action: "update",
            path: "wiki/概念/示例.md",
            content: "FULL UPDATED FILE CONTENT",
          },
          {
            action: "append",
            path: dailyLogPathFromTimestamp(createdAt),
            content: "## [YYYY-MM-DD] ingest | source-name.md\\n- ...",
          },
        ],
        factWrites: [
          {
            path: TEMPORAL_FACTS_RELATIVE_PATH,
            subject: "规范实体名",
            predicate: "HAS_CATALYST",
            object: "事件或事实对象",
            claim: "一句话事实",
            status: "active",
            evidenceLevel: "A|B|C|D",
            sourceKind: "official_announcement|broker_research|expert_meeting|media_report|social_chat|market_price",
            validAt: "YYYY-MM-DD",
            sourceDate: "YYYY-MM-DD",
            sourcePath: sourceRelativePath,
            sourceHash,
            wikiPath: "wiki/股票/示例.md",
            supersedes: [],
          },
        ],
      },
      null,
      2,
    ),
    "```",
    "",
    "## Project",
    `- projectPath: ${projectPath}`,
    `- sourcePath: ${sourcePath}`,
    `- sourceRelativePath: ${sourceRelativePath}`,
    `- sourceHash: ${sourceHash}`,
    `- createdAt: ${createdAt}`,
    `- wikiDirs: ${wikiDirs.join(", ") || "(none)"}`,
    "",
    "## Source Content",
    "```markdown",
    sourceContent,
    "```",
    "",
    "## Candidate Wiki Pages",
    candidateLines || "(no candidates found)",
    "",
    "## Related Raw Text Candidates",
    rawLines || "(no related raw text candidates found)",
    "",
    "## Segment Candidate Groups",
    segmentLines,
    "",
    formatConceptGovernanceContextMarkdown(conceptGovernance),
    "",
    formatTemporalFactContextMarkdown(temporalFactContext, { includeSegments: true }),
    "",
    ...(methodologyContext?.markdown ? [methodologyContext.markdown, ""] : []),
    "## schema.md",
    "```markdown",
    schema || "(missing schema.md)",
    "```",
    "",
    "## purpose.md",
    "```markdown",
    purpose || "(missing purpose.md)",
    "```",
    "",
    "## wiki/index.md",
    "```markdown",
    index || "(missing wiki/index.md)",
    "```",
    "",
    "## wiki/overview.md",
    "```markdown",
    overview || "(missing wiki/overview.md)",
    "```",
  ].join("\n")
}

export function buildDryRunMarkdown({ sourceRelativePath, sourceHash, reportDir, candidates, conceptGovernance, dirtyStatus }) {
  const wikiRows = candidates.wikiCandidates
    .slice(0, 20)
    .map((item) => `- ${item.path} — score ${item.score}; ${item.snippet}`)
    .join("\n")
  const rawRows = candidates.rawCandidates
    .slice(0, 10)
    .map((item) => `- ${item.path} — score ${item.score}; ${item.snippet}`)
    .join("\n")
  const segmentRows = (candidates.segments ?? [])
    .slice(0, INGEST_SEGMENT_DEFAULT_MAX)
    .map((segment) => {
      const topWiki = (segment.wikiCandidates ?? [])
        .slice(0, 5)
        .map((item) => `  - ${item.path} — score ${item.score}; ${item.snippet}`)
        .join("\n")
      return [`- ${segment.id} ${segment.title}${segment.heat ? `｜热度：${segment.heat}` : ""}｜lines ${segment.lineStart}-${segment.lineEnd}`, `  preview: ${segment.textPreview}`, topWiki || "  - no wiki candidates"].join("\n")
    })
    .join("\n")
  const dirtyRows = dirtyStatus.length > 0 ? dirtyStatus.map((line) => `- ${line}`).join("\n") : "- clean"

  return [
    "# Codex Ingest Prepare Report",
    "",
    `- source: ${sourceRelativePath}`,
    `- sourceHash: ${sourceHash}`,
    `- reportDir: ${reportDir}`,
    "",
    "## Candidate Wiki Pages",
    wikiRows || "- none",
    "",
    "## Related Raw Candidates",
    rawRows || "- none",
    "",
    "## Segment Candidate Groups",
    segmentRows || "- none",
    "",
    "## Concept Governance",
    formatConceptGovernanceContextMarkdown(conceptGovernance).replace(/^## Concept Governance\n\n/, ""),
    "",
    "## Temporal Fact Context",
    "- See context.md and candidate-pages.json for entity candidates, related temporal facts, and segment fact seeds.",
    "",
    "## Git Dirty Status",
    dirtyRows,
    "",
    "## Next Step",
    "Fill `changes.template.json` as `changes.json`, then run:",
    "",
    "```sh",
    "npm run codex:ingest -- apply --manifest <changes.json>",
    "npm run codex:ingest -- apply --manifest <changes.json> --write",
    "```",
  ].join("\n")
}

export async function prepareIngest(options) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const sourcePath = normalizePath(options.sourcePath)
  if (!isTextSourcePath(sourcePath)) {
    const hint = isConvertibleSourcePath(sourcePath)
      ? ` Run convert-source first, then ingest the generated ${path.basename(defaultConvertedSourcePath(sourcePath))} sidecar.`
      : ""
    throw new Error(`Unsupported source type for text ingest: ${sourcePath}.${hint}`)
  }

  const fullSourceContent = await readTextFile(sourcePath)
  const sourceHash = shortHash(fullSourceContent)
  const sourceRelativePath = projectRelative(projectPath, sourcePath)
  const sourceContent = compactSourceContentForPrompt(fullSourceContent, sourcePath, sourceHash)
  const sourceSharding = buildSourceShardingPlan({
    sourceContent: fullSourceContent,
    sourcePath,
    sourceRelativePath,
    sourceHash,
    options: {
      sourceSharding: options.sourceSharding,
      sourceRetention: options.sourceRetention,
      maxShardChars: options.maxShardChars,
      shardConcurrency: options.shardConcurrency,
    },
  })
  const createdAt = nowLocalTimestamp()

  const dailyLogPath = dailyLogPathFromTimestamp(createdAt)
  const [schema, purpose, index, overview, log, dailyLog, wikiDirs, dirtyStatus, candidates, methodologyContext] = await Promise.all([
    readIfExists(options.schemaPath ? normalizePath(options.schemaPath) : path.join(projectPath, "schema.md")),
    readIfExists(path.join(projectPath, "purpose.md")),
    readIfExists(path.join(projectPath, "wiki/index.md")),
    readIfExists(path.join(projectPath, "wiki/overview.md")),
    readIfExists(path.join(projectPath, "wiki/log.md")),
    readIfExists(path.join(projectPath, dailyLogPath)),
    collectWikiDirs(projectPath),
    gitDirtyStatus(projectPath),
    searchCandidatePages(projectPath, sourcePath, fullSourceContent, options.search ?? {}),
    buildMethodologyContext(projectPath, options.methodologyContext ?? options.methodology ?? {}),
  ])
  let embeddingRouting = null
  if (options.embeddingRouting) {
    embeddingRouting = await applyEmbeddingRoutingToCandidates({
      projectPath,
      sourcePath,
      sourceContent: fullSourceContent,
      candidates,
      options,
      onProgress: options.onProgress,
    })
  }
  const temporalFactContext = await buildTemporalFactContext({
    projectPath,
    sourcePath,
    sourceContent: fullSourceContent,
    candidates,
    options: options.temporalFacts ?? {},
  })
  const conceptGovernance = candidates.conceptGovernance ?? {
    configPath: null,
    counts: {},
    warnings: [],
    candidateHints: [],
  }

  const reportId = options.reportId ?? makeReportId(sourcePath)
  const reportDir = path.join(projectPath, REPORT_ROOT, reportId)
  const manifestTemplate = {
    $schema: MANIFEST_SCHEMA,
    mode: "dry-run",
    generatedBy: "codex-ingest prepare",
    createdAt,
    projectPath,
    sourcePath,
    sourceRelativePath,
    sourceHash,
    factWrites: [],
    writes: [],
  }

  const contextMarkdown = buildContextMarkdown({
    projectPath,
    sourcePath,
    sourceRelativePath,
    sourceHash,
    sourceContent,
    schema,
    purpose,
    index,
    overview,
    wikiDirs,
    candidates,
    temporalFactContext,
    conceptGovernance,
    methodologyContext,
    createdAt,
  })

  const dryRunMarkdown = buildDryRunMarkdown({
    sourceRelativePath,
    sourceHash,
    reportDir,
    candidates,
    conceptGovernance,
    dirtyStatus,
  })

  if (!options.noReport) {
    await ensureDirectory(reportDir)
    await fs.writeFile(path.join(reportDir, "context.md"), contextMarkdown, "utf8")
    await writeJson(path.join(reportDir, "candidate-pages.json"), {
      source: sourceRelativePath,
      sourceHash,
      tokens: candidates.tokens,
      wikiCandidates: candidates.wikiCandidates,
      rawCandidates: candidates.rawCandidates,
      segments: candidates.segments ?? [],
      embeddingRouting,
      temporalFactContext,
      conceptGovernance,
    })
    await writeJson(path.join(reportDir, "source-mainline-index.json"), sourceSharding.mainlineIndex)
    await writeJson(path.join(reportDir, "shards.json"), {
      enabled: sourceSharding.enabled,
      mode: sourceSharding.mode,
      reason: sourceSharding.reason,
      retentionMode: sourceSharding.retentionMode,
      maxShardChars: sourceSharding.maxShardChars,
      shardConcurrency: sourceSharding.shardConcurrency,
      warnings: sourceSharding.warnings,
      counts: {
        windows: sourceSharding.mainlineIndex.counts.windows,
        mainlines: sourceSharding.mainlineIndex.counts.mainlines,
        shards: sourceSharding.shards.length,
      },
      shards: sourceSharding.shards.map((shard) => ({
        id: shard.id,
        index: shard.index,
        windowIds: shard.windowIds,
        windowTimes: shard.windowTimes,
        lineStart: shard.lineStart,
        lineEnd: shard.lineEnd,
        chars: shard.chars,
        compactedWindows: shard.compactedWindows,
      })),
    })
    await writeJson(path.join(reportDir, "methodology-context.json"), methodologyContext)
    await writeJson(path.join(reportDir, "changes.template.json"), manifestTemplate)
    await fs.writeFile(path.join(reportDir, "dry-run.md"), dryRunMarkdown, "utf8")
  }

  return {
    projectPath,
    sourcePath,
    sourceRelativePath,
    sourceHash,
    fullSourceContent,
    sourceContent,
    sourceSharding,
    sourceMainlineIndex: sourceSharding.mainlineIndex,
    schema,
    purpose,
    index,
    overview,
    log,
    dailyLog,
    dailyLogPath,
    wikiDirs,
    createdAt,
    reportDir,
    contextMarkdown,
    dryRunMarkdown,
    manifestTemplate,
    candidates,
    embeddingRouting,
    temporalFactContext,
    conceptGovernance,
    methodologyContext,
    dirtyStatus,
  }
}

export function cleanBlockPath(raw) {
  let p = raw.trim()
  const pairs = [["**", "**"], ["`", "`"], ["<", ">"], ['"', '"'], ["'", "'"]]
  let changed = true
  while (changed) {
    changed = false
    for (const [left, right] of pairs) {
      if (p.startsWith(left) && p.endsWith(right) && p.length > left.length + right.length) {
        p = p.slice(left.length, p.length - right.length).trim()
        changed = true
      }
    }
  }
  return p
}

export function parseFileBlocks(text) {
  const fencedRegex = /^(`{3,})FILE:?\s*(.+?)\s*\r?\n([\s\S]*?)^\1\s*$/gm
  const fencedBlocks = []
  let fencedMatch
  while ((fencedMatch = fencedRegex.exec(text)) !== null) {
    const filePath = cleanBlockPath(fencedMatch[2])
    if (filePath) fencedBlocks.push({ path: filePath, content: fencedMatch[3].replace(/\r?\n$/, "") })
  }
  if (fencedBlocks.length > 0) return fencedBlocks

  const startRegex = /-{2,}\s*FILE:\s*(.+?)\s*-{2,}\r?\n/g
  const starts = []
  let match
  while ((match = startRegex.exec(text)) !== null) {
    const filePath = cleanBlockPath(match[1])
    if (filePath) starts.push({ path: filePath, markerStart: match.index, contentStart: match.index + match[0].length })
  }
  const blocks = []
  const endRegex = /-{2,}\s*END\s+FILE\s*-{2,}/i
  for (let i = 0; i < starts.length; i++) {
    const { path: blockPath, contentStart } = starts[i]
    const sliceEnd = i + 1 < starts.length ? starts[i + 1].markerStart : text.length
    const segment = text.slice(contentStart, sliceEnd)
    const endMatch = endRegex.exec(segment)
    const content = endMatch ? segment.slice(0, endMatch.index).replace(/\r?\n$/, "") : segment.replace(/\r?\n$/, "")
    blocks.push({ path: blockPath, content })
  }
  return blocks
}

export function parseManifestFromModelText(text, baseManifest) {
  const fencedJson = text.match(/```json\s*\n([\s\S]*?)```/i)
  const rawJson = fencedJson?.[1] ?? text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)
  try {
    const parsed = JSON.parse(rawJson)
    if (parsed && Array.isArray(parsed.writes)) return { ...baseManifest, ...parsed }
  } catch {
    // Fall through to FILE block parsing.
  }
  const blocks = parseFileBlocks(text)
  if (blocks.length === 0) {
    throw new Error("Model output did not contain a manifest JSON object or FILE blocks")
  }
  return {
    ...baseManifest,
    writes: blocks.map((block) => ({
      action: isLogPath(block.path) ? "append" : "update",
      path: block.path,
      content: block.content,
    })),
  }
}

export function parsePlanFromModelText(text) {
  const fencedJson = text.match(/```json\s*\n([\s\S]*?)```/i)
  const rawJson = fencedJson?.[1] ?? text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)
  const parsed = JSON.parse(rawJson)
  const create = Array.isArray(parsed?.create) ? parsed.create : []
  const update = Array.isArray(parsed?.update) ? parsed.update : []
  const factWrites = Array.isArray(parsed?.factWrites) ? parsed.factWrites : []
  const judgmentWrites = Array.isArray(parsed?.judgmentWrites) ? parsed.judgmentWrites : []
  return {
    create: create.map((item) => ({
      path: item.path,
      type: item.type,
      title: item.title,
      why: item.why ?? "",
    })),
    update: update.map((item) => ({
      path: item.path,
      why: item.why ?? "",
    })),
    factWrites,
    judgmentWrites,
  }
}

export function sourceArchivePath(sourceBaseName) {
  return `wiki/sources/${sourceBaseName}.md`
}

export function escapeMarkdownTableCell(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim()
}

export function buildSourceMainlineIndexSection(sourceMainlineIndex) {
  const items = sourceMainlineIndex?.items ?? []
  if (!items.length) return ""
  const rows = [
    SOURCE_MAINLINE_INDEX_START,
    "## 分时主线索引",
    "",
    "> 程序化索引：用于检索和回源复核，不代表事实已确认；完整证据以 raw 原文为准。",
    "",
    "| 时间窗 | 主线 | 热度 | 命中群 | 原文数 | raw 行号 |",
    "|---|---|---|---|---|---|",
    ...items.map((item) =>
      `| ${escapeMarkdownTableCell(item.windowTime)} | ${escapeMarkdownTableCell(item.label)} | ${escapeMarkdownTableCell(item.heat)} | ${escapeMarkdownTableCell(item.groups)} | ${escapeMarkdownTableCell(item.sourceCount)} | ${item.lineStart}${item.lineEnd && item.lineEnd !== item.lineStart ? `-${item.lineEnd}` : ""} |`
    ),
    "",
    SOURCE_MAINLINE_INDEX_END,
  ]
  return rows.join("\n")
}

export function injectSourceMainlineIndex(content, sourceMainlineIndex) {
  const section = buildSourceMainlineIndexSection(sourceMainlineIndex)
  if (!section) return content
  const blockRegex = new RegExp(`${SOURCE_MAINLINE_INDEX_START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${SOURCE_MAINLINE_INDEX_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`)
  if (blockRegex.test(content)) return content.replace(blockRegex, section)
  const relatedAt = content.search(/\n##\s+相关页面\b/)
  if (relatedAt >= 0) {
    return `${content.slice(0, relatedAt).replace(/\s*$/, "")}\n\n${section}\n\n${content.slice(relatedAt).replace(/^\n+/, "")}`
  }
  return `${content.replace(/\s*$/, "")}\n\n${section}\n`
}

export function applySourceMainlineIndexToPageWrites(pageWrites, sourceBaseName, sourceMainlineIndex) {
  if (!sourceMainlineIndex?.items?.length) return pageWrites
  const targetPath = sourceArchivePath(sourceBaseName)
  return pageWrites.map((write) => {
    if (write.path !== targetPath) return write
    return {
      ...write,
      content: injectSourceMainlineIndex(String(write.content ?? ""), sourceMainlineIndex),
    }
  })
}

export function validateSourceMainlineIndexManifest(manifest, finalWrites) {
  const index = manifest.sourceMainlineIndex
  const items = index?.items ?? []
  if (!items.length) return []
  const targetPath = manifest.sourceArchivePath ?? (manifest.sourcePath ? sourceArchivePath(path.basename(manifest.sourcePath).replace(/\.[^.]+$/, "")) : null)
  const sourceWrite = finalWrites.find((item) => item.path === targetPath)
  if (!sourceWrite) {
    return [{
      path: targetPath ?? "wiki/sources/(unknown).md",
      field: "sourceMainlineIndex",
      message: "Source mainline index is present but the source archive write is missing.",
      fatal: true,
    }]
  }
  if (!String(sourceWrite.content ?? "").includes(SOURCE_MAINLINE_INDEX_START)) {
    return [{
      path: sourceWrite.path,
      field: "sourceMainlineIndex",
      message: "Source archive is missing the programmatic 分时主线索引 block.",
      fatal: true,
    }]
  }
  return []
}

export function normalizeCoverageText(value) {
  return String(value ?? "")
    .replace(/[\s#｜|（）()【】\[\]、，。:：；;“”"'`*+$%0-9.·\-]+/g, "")
    .toLowerCase()
}

export function mainlineCoverageParts(label) {
  return String(label ?? "")
    .split(/[\/／、+，,（）()\s｜|：:；;“”"'`*#\[\]{}<>]+/)
    .map((item) => normalizeCoverageText(item))
    .filter((item) => item.length >= 2 && !/^(ai|ipo|etf|a股|美股|中国|美国|外资|风险|修复|行情|市场|风格|主线|高热|强call|满仓call)$/.test(item))
}

export function isMainlineCovered(item, corpus) {
  const text = normalizeCoverageText(corpus)
  const label = normalizeCoverageText(item.label)
  if (label.length >= 3 && text.includes(label)) return true
  const parts = [...new Set(mainlineCoverageParts(item.label))]
  if (!parts.length) return false
  const hits = parts.filter((part) => text.includes(part)).length
  return hits >= Math.min(2, Math.max(1, Math.ceil(parts.length * 0.35)))
}

export function buildSourceCoverageReview(sourceMainlineIndex, pageWrites) {
  const items = sourceMainlineIndex?.items ?? []
  const sourceArchive = pageWrites.find((write) => write.path?.startsWith("wiki/sources/"))
  const sourceArchiveHasIndex = Boolean(sourceArchive && String(sourceArchive.content ?? "").includes(SOURCE_MAINLINE_INDEX_START))
  const formalCorpus = pageWrites
    .filter((write) => !write.path?.startsWith("wiki/sources/"))
    .map((write) => String(write.content ?? ""))
    .join("\n")
  const corpus = formalCorpus
  const coveredItems = items.filter((item) => isMainlineCovered(item, corpus))
  const uncoveredItems = items.filter((item) => !isMainlineCovered(item, corpus))
  const coveragePct = items.length ? Number(((coveredItems.length / items.length) * 100).toFixed(1)) : 100
  return {
    version: 1,
    totalMainlines: items.length,
    sourceArchiveHasIndex,
    sourceArchiveIndexedMainlines: sourceArchiveHasIndex ? items.length : 0,
    coveredMainlines: coveredItems.length,
    uncoveredMainlines: uncoveredItems.length,
    coveragePct,
    uncovered: uncoveredItems.map((item) => ({
      id: item.id,
      windowTime: item.windowTime,
      label: item.label,
      heat: item.heat,
      groups: item.groups,
      sourceCount: item.sourceCount,
      lineStart: item.lineStart,
      lineEnd: item.lineEnd,
    })),
  }
}

export function sourceCoverageReviewMarkdown(review) {
  const rows = [
    "# Source Coverage Review",
    "",
    `- Total mainlines: ${review.totalMainlines}`,
    `- Source archive indexed mainlines: ${review.sourceArchiveIndexedMainlines}`,
    `- Covered mainlines: ${review.coveredMainlines}`,
    `- Uncovered mainlines: ${review.uncoveredMainlines}`,
    `- Coverage: ${review.coveragePct}%`,
    "",
    "## Uncovered Mainlines",
    "",
  ]
  if (!review.uncovered.length) {
    rows.push("- none")
  } else {
    for (const item of review.uncovered) {
      rows.push(`- ${item.windowTime} lines ${item.lineStart}-${item.lineEnd}: ${item.label}${item.heat ? ` | ${item.heat}` : ""}`)
    }
  }
  return `${rows.join("\n")}\n`
}

export function normalizePlanPath(rawPath) {
  return assertSafeWikiPath(String(rawPath ?? "").trim())
}

export async function normalizeIngestPlan(projectPath, plan, sourceBaseName, options = {}) {
  const pp = normalizePath(projectPath)
  const sourcePath = sourceArchivePath(sourceBaseName)
  const seen = new Set()
  const create = []
  const update = []

  async function addItem(rawItem, preferredAction, forced = false) {
    const safePath = normalizePlanPath(rawItem.path)
    if (seen.has(safePath)) return
    seen.add(safePath)
    const targetExists = await exists(path.join(pp, safePath))
    const action = targetExists ? "update" : "create"
    const why = rawItem.why || (forced ? "归档本次 source 的清洗版证据页，供后续知识页引用。" : "")
    if (action === "update") {
      update.push({ path: safePath, why })
    } else {
      create.push({
        path: safePath,
        type: normalizeTypeAlias(rawItem.type) ?? inferTypeFromPath(safePath),
        title: rawItem.title || pathToTitle(safePath),
        why,
      })
    }
  }

  await addItem(
    {
      path: sourcePath,
      type: "源文档",
      title: sourceBaseName,
      why: "归档本次 source 的清洗版证据页，供后续概念、模式、错误和策略页面引用。",
    },
    "create",
    true,
  )

  for (const item of plan.create ?? []) await addItem(item, "create")
  for (const item of plan.update ?? []) await addItem(item, "update")

  return applyConceptGovernanceToNormalizedPlan(pp, {
    create,
    update,
    factWrites: Array.isArray(plan.factWrites) ? plan.factWrites : [],
    judgmentWrites: Array.isArray(plan.judgmentWrites) ? plan.judgmentWrites : [],
  }, options)
}

export function parseOptionalPositiveInteger(value) {
  if (value == null || value === "") return null
  return parsePositiveInteger(value, null)
}

export function assessIngestPlanBudget(plan, options = {}) {
  const createCount = plan.create?.length ?? 0
  const updateCount = plan.update?.length ?? 0
  const pageCount = createCount + updateCount
  const limits = [
    ["maxPlanItems", parseOptionalPositiveInteger(options.maxPlanItems), pageCount, "planned wiki page writes"],
    ["maxCreatePages", parseOptionalPositiveInteger(options.maxCreatePages), createCount, "planned creates"],
    ["maxUpdatePages", parseOptionalPositiveInteger(options.maxUpdatePages), updateCount, "planned updates"],
  ]
  const violations = limits
    .filter(([, limit, actual]) => limit != null && actual > limit)
    .map(([field, limit, actual, label]) => `${label} ${actual} exceeds --${field.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`)} ${limit}`)
  return {
    counts: {
      create: createCount,
      update: updateCount,
      pageWrites: pageCount,
      factWrites: plan.factWrites?.length ?? 0,
    },
    limits: {
      maxPlanItems: parseOptionalPositiveInteger(options.maxPlanItems),
      maxCreatePages: parseOptionalPositiveInteger(options.maxCreatePages),
      maxUpdatePages: parseOptionalPositiveInteger(options.maxUpdatePages),
    },
    warnings: violations,
  }
}

export function planItemsInGenerationOrder(plan, sourceBaseName) {
  const sourcePath = sourceArchivePath(sourceBaseName)
  const items = [
    ...plan.update.map((item) => ({ ...item, action: "update", type: inferTypeFromPath(item.path), title: pathToTitle(item.path) })),
    ...plan.create.map((item) => ({ ...item, action: "create" })),
  ]
  return items.sort((a, b) => {
    if (a.path === sourcePath) return -1
    if (b.path === sourcePath) return 1
    if (a.action !== b.action) return a.action === "update" ? -1 : 1
    return a.path.localeCompare(b.path)
  })
}

export function candidateSummary(candidates, wikiLimit = 30, rawLimit = 12) {
  const formatMatchedSegments = (item) => {
    const segments = item.matchedSegments ?? []
    if (!segments.length) return ""
    return ` | matchedSegments=${segments.map((segment) => segment.title).join(" / ")}`
  }
  const wiki = candidates.wikiCandidates
    .slice(0, wikiLimit)
    .map(
      (item, i) =>
        `${i + 1}. ${item.path} | score=${item.score} | type=${item.type} | title=${item.title}${formatMatchedSegments(item)}\n   ${item.snippet}`,
    )
    .join("\n")
  const raw = candidates.rawCandidates
    .slice(0, rawLimit)
    .map((item, i) => `${i + 1}. ${item.path} | score=${item.score} | title=${item.title}${formatMatchedSegments(item)}\n   ${item.snippet}`)
    .join("\n")
  return { wiki: wiki || "(none)", raw: raw || "(none)", segments: segmentCandidateSummary(candidates.segments ?? []) }
}

export function segmentCandidateSummary(segments, segmentLimit = INGEST_SEGMENT_DEFAULT_MAX, wikiLimit = 6, rawLimit = 3) {
  if (!segments.length) return "(none)"
  return segments
    .slice(0, segmentLimit)
    .map((segment, i) => {
      const wikiRows = (segment.wikiCandidates ?? [])
        .slice(0, wikiLimit)
        .map((item, j) => `${j + 1}. ${item.path} | score=${item.score} | type=${item.type} | title=${item.title}\n      ${item.snippet}`)
        .join("\n")
      const rawRows = (segment.rawCandidates ?? [])
        .slice(0, rawLimit)
        .map((item, j) => `${j + 1}. ${item.path} | score=${item.score} | title=${item.title}\n      ${item.snippet}`)
        .join("\n")
      return [
        `### ${i + 1}. ${segment.id} ${segment.title}${segment.heat ? ` | heat=${segment.heat}` : ""}${segment.sourceGroups ? ` | groups=${segment.sourceGroups}` : ""} | lines=${segment.lineStart}-${segment.lineEnd}`,
        `preview: ${segment.textPreview}`,
        "Wiki candidates:",
        wikiRows || "(none)",
        "Raw candidates:",
        rawRows || "(none)",
      ].join("\n")
    })
    .join("\n\n")
}

export function formatTemporalFactContextMarkdown(context, options = {}) {
  if (!context) return "## Temporal Fact Context\n\n- none"
  const entityRows = (context.entityCandidates ?? [])
    .slice(0, 16)
    .map((item) => `- ${item.entityKey} | ${item.canonicalSubject}${item.stockCode ? ` | ${item.stockCode}` : ""} | score=${item.score} | reasons=${(item.reasons ?? []).join("; ")}`)
    .join("\n")
  const factRows = (context.relatedFacts ?? [])
    .slice(0, 18)
    .map((item) => {
      const object = item.object ? ` -> ${item.object}` : ""
      const claim = item.claim ? ` | claim=${item.claim}` : ""
      return `- ${item.id} | line=${item.line} | status=${item.status} | ${item.entityKey ?? item.canonicalSubject ?? "unknown"} | ${item.predicate ?? "FACT"}${object} | validAt=${item.validAt ?? "?"}${claim}`
    })
    .join("\n")
  const rows = [
    "## Temporal Fact Context",
    "",
    `- factsPath: ${context.factsPath}`,
    `- indexPath: ${context.indexPath}`,
    `- counts: total=${context.counts?.totalFacts ?? 0}; active=${context.counts?.activeFacts ?? 0}; inactive=${context.counts?.inactiveFacts ?? 0}; related=${context.counts?.relatedFacts ?? 0}; segmentSeeds=${context.counts?.segmentFactSeeds ?? 0}`,
    "",
    "### Entity Candidates",
    entityRows || "- none",
    "",
    "### Related Existing Temporal Facts",
    factRows || "- none",
  ]
  if (options.includeSegments) {
    const segmentRows = (context.segmentFactSeeds ?? [])
      .slice(0, INGEST_SEGMENT_DEFAULT_MAX)
      .map((segment) => {
        const entities = (segment.entityCandidates ?? []).slice(0, 6).map((item) => item.entityKey).join(", ") || "none"
        const facts = (segment.relatedFacts ?? []).slice(0, 6).map((item) => `${item.id}:${item.status}`).join(", ") || "none"
        const tokens = (segment.tokens ?? []).slice(0, 12).join(", ") || "none"
        return [`- ${segment.id} ${segment.title}${segment.heat ? ` | heat=${segment.heat}` : ""} | lines=${segment.lineStart}-${segment.lineEnd}`, `  entities: ${entities}`, `  relatedFacts: ${facts}`, `  tokens: ${tokens}`, `  preview: ${segment.textPreview}`].join("\n")
      })
      .join("\n")
    rows.push("", "### Segment Fact Seeds", segmentRows || "- none")
  }
  return rows.join("\n")
}

export function buildAnalysisStagePrompt(prepared) {
  const candidates = candidateSummary(prepared.candidates)
  const hasSegments = (prepared.candidates.segments ?? []).length > 0
  return [
    "# Stage 1/4: 分析源文档",
    "",
    "请像桌面应用摄入一样阅读 source，并生成结构化分析。不要只做摘要；要说明它应如何接入既有 wiki 知识网络。",
    "",
    "## 输出要求",
    "- 使用 Markdown。",
    "- 先判断 source 类型（如日复盘、微信舆情、研报新闻、夜间交流、OpenClaw 文本）。",
    "- 提炼核心结论、时间线/传播路径、重要主题、可沉淀概念、可沉淀模式、错误/交易纪律。",
    "- 若 source 是日复盘、交割单或交易流水，要识别交易执行行为，但不要建议把买入/卖出、成交价、数量、仓位、持仓或盈亏流水写入股票页；只提炼可复用策略、错误、模式，以及独立于个人执行的公司/催化新证据。",
    "- 明确区分事实强度：公告/财报/政策/权威报道/研报推演/群聊传闻/小作文。",
    "- 明确列出建议更新已有页面和建议新建页面。",
    hasSegments ? "- 本 source 已启用分段候选定位：按 Segment Candidate Groups 逐段判断主题，不要只围绕全局 Top 候选或最热主题。" : "",
    hasSegments ? "- 对多主题微信/夜间交流源，高热主线可进入概念/股票/模式/错误页；中等主题优先更新已有页；低证据小主题只进 source archive 或分析。" : "",
    "- 不要把高舆情直接写成高事实强度。",
    "",
    ...(prepared.methodologyContext?.markdown ? [prepared.methodologyContext.markdown, ""] : []),
    "## Source",
    `- sourceRelativePath: ${prepared.sourceRelativePath}`,
    `- sourceHash: ${prepared.sourceHash}`,
    "",
    "```markdown",
    prepared.sourceContent,
    "```",
    "",
    "## Candidate Wiki Pages",
    candidates.wiki,
    "",
    "## Related Raw Text Candidates",
    candidates.raw,
    "",
    "## Segment Candidate Groups",
    candidates.segments,
    "",
    "## purpose.md",
    "```markdown",
    prepared.purpose || "(missing purpose.md)",
    "```",
    "",
    "## wiki/index.md",
    "```markdown",
    prepared.index ? compactPreview(prepared.index, 260) : "(missing wiki/index.md)",
    "```",
    "",
    "## wiki/overview.md",
    "```markdown",
    prepared.overview ? compactPreview(prepared.overview, 220) : "(missing wiki/overview.md)",
    "```",
  ].join("\n")
}

export function buildPlanStagePrompt({ prepared, analysis, sourceBaseName, includeJudgments = false }) {
  const candidates = candidateSummary(prepared.candidates)
  const hasSegments = (prepared.candidates.segments ?? []).length > 0
  const planShape = {
    create: [{ path: `wiki/sources/${sourceBaseName}.md`, type: "源文档", title: sourceBaseName, why: "..." }],
    update: [{ path: "wiki/模式/当前市场阶段判断.md", why: "..." }],
    factWrites: [
      {
        path: TEMPORAL_FACTS_RELATIVE_PATH,
        subject: "股票或概念名",
        predicate: "HAS_CATALYST|HAS_ORDER|CONTRADICTS|VALIDATES",
        object: "事件/事实对象",
        claim: "一句话事实，不写推测成真",
        status: "active",
        evidenceLevel: "A|B|C|D",
        sourceKind: "official_announcement|broker_research|expert_meeting|media_report|social_chat|market_price",
        validAt: "YYYY-MM-DD",
        sourceDate: "YYYY-MM-DD",
        sourcePath: prepared.sourceRelativePath,
        sourceHash: prepared.sourceHash,
        wikiPath: "wiki/股票/示例.md",
        supersedes: [],
      },
    ],
  }
  if (includeJudgments) {
    planShape.judgmentWrites = [
      {
        path: JUDGMENTS_RELATIVE_PATH,
        subject: "股票或概念名",
        kind: "thesis|expectation|lesson|stance",
        claim: "一句话判断/理解，写清当时的推理立场",
        status: "held",
        confidence: "高|中|低",
        basedOnFacts: [],
        validAt: "YYYY-MM-DD",
        verifyBy: "YYYY-MM-DD",
        verifyNote: "后续用什么信号验证或证伪这个判断",
        visibility: "team",
        sourcePath: prepared.sourceRelativePath,
        sourceHash: prepared.sourceHash,
        wikiPath: "wiki/概念/示例.md",
        supersedes: [],
      },
    ]
  }
  return [
    "# Stage 2/4: 规划变更",
    "",
    "根据 Stage 1 分析生成 create/update 计划。输出必须是单个 ```json fenced block，不要输出额外文字。",
    "",
    "## JSON Shape",
    "```json",
    JSON.stringify(planShape, null, 2),
    "```",
    "",
    "## Rules",
    `- 必须包含 source archive：wiki/sources/${sourceBaseName}.md。`,
    "- 规划可以发散，但要优先更新已有同义/上位页面，只有独立复用价值明确时才新建。",
    hasSegments ? "- 本 source 是多主题分段候选：采用更充分写入策略，允许多个重要 segment 进入计划，但同一页面跨 segment 命中时只规划一次，并在 why 中合并 matchedSegments/主题理由。" : "",
    hasSegments ? "- 微信舆情/夜间交流默认可规划约 10-18 个已有正式页更新、2-5 个新建页；新建页必须没有高匹配已有页，且主题有持续复用价值，不只是单条群聊转发。" : "",
    hasSegments ? "- 日复盘/总结页只作为背景候选；除非 source 明确是日复盘，否则不要让总结页压过概念页、股票页、模式页和错误页。" : "",
    hasSegments ? "- 低证据小主题可以只进入 source archive；不要为了覆盖每个 segment 而强行新建低价值页面。" : "",
    "- 遵守 Concept Governance：sameAs/auto 指向标准承载页时，计划 canonical 页，不要继续更新重复标题页。",
    "- mergeInto、childOf、tradeSliceOf 只是提示；除非明确 auto，不要把子概念或交易切片吞进父概念。",
    "- 对父页只写总账判断；对细分规格、订单、涨价周期、鱼尾/高低切等交易语境，优先保留独立页面。",
    "- 交易执行边界：日复盘、交割单、成交流水中的买入/卖出、成交价、数量、仓位、持仓和盈亏，不要规划到 `wiki/股票/**`。股票页只有在 source 提供公司、产业链、催化、基本面、消息面或验证框架的新信息时才更新，并且只写这些研究信息。",
    "- 不要规划 raw/**，不要规划已废弃目录 wiki/市场环境/ 或 wiki/进化/。",
    "- `wiki/index.md`、`wiki/overview.md`、`wiki/log.md`、`wiki/logs/**` 不要出现在计划中；Stage 4 会统一处理。",
    `- 如果 source 给出可独立复用的时间敏感事实，可以在 factWrites 中规划 temporal edge；path 必须是 ${TEMPORAL_FACTS_RELATIVE_PATH}，不要把事实 JSONL 放进 writes。`,
    `- factWrites predicate 只能使用：${TEMPORAL_FACT_PREDICATES.join(" / ")}。`,
    `- factWrites status 只能使用：${TEMPORAL_FACT_STATUSES.join(" / ")}。`,
    `- evidenceLevel 只能是 ${TEMPORAL_FACT_EVIDENCE_LEVELS.join(" / ")}；sourceKind 只能是 ${TEMPORAL_FACT_SOURCE_KINDS.join(" / ")}。`,
    "- factWrites 只写明确事实、撤销/证伪/替代关系和验证结果；传闻、小作文或无时间锚的弱观点不要写入 factWrites。",
    "- factWrites 不记录个人买入/卖出/仓位/盈亏流水；只记录市场、公司、产业、验证、反证和替代链等可复用事实。",
    "- C/D 证据如果进入 factWrites，claim 必须明确写成传闻/待验证/观察项，不能写成已确认事实。",
    "- 如果新事实推翻旧事实，在新事实里填写 supersedes/invalidates/contradicts 的旧 fact id；不要直接改旧 JSONL 行。",
    "- 优先使用 Temporal Fact Context 中的 entityKey/canonicalSubject/stockCode；长文多主题时按 Segment Fact Seeds 逐段判断事实，避免把不同 segment 的公司/事件混写成一条 fact。",
    "- Related Existing Temporal Facts 给出了可 supersede 的旧 fact id；如果上下文里没有命中旧 fact，不要编造旧 id，可以新增 active fact 或用 claim 说明待后续匹配。",
    includeJudgments ? `- judgmentWrites 记录"当时的判断/理解/预期/教训"，与 factWrites 严格分开：客观发生的事实进 factWrites，对事实的解读、主线判断、预期和教训进 judgmentWrites；path 必须是 ${JUDGMENTS_RELATIVE_PATH}。` : "",
    includeJudgments ? `- judgmentWrites kind 只能使用：${JUDGMENT_KINDS.join(" / ")}；status 只能使用：${JUDGMENT_STATUSES.join(" / ")}；新判断默认 held。` : "",
    includeJudgments ? "- 判断要原子化：一条 judgment 只表达一个立场，尽量给 confidence 和 verifyBy 验证窗口；本次证据修正旧判断时在 supersedes 填旧 judgment id，不要改旧记录。" : "",
    includeJudgments ? "- 个人仓位/买卖倾向类判断 kind 用 stance、visibility 用 personal；行业/主线/公司层面的判断 visibility 用 team。不要把判断写成已验证事实。" : "",
    "- 概念/模式/错误/策略等正式页正文软上限为 2000 行。",
    "",
    ...(prepared.methodologyContext?.markdown ? [prepared.methodologyContext.markdown, ""] : []),
    "## Stage 1 Analysis",
    analysis,
    "",
    "## Candidate Wiki Pages",
    candidates.wiki,
    "",
    "## Segment Candidate Groups",
    candidates.segments,
    "",
    formatConceptGovernanceContextMarkdown(prepared.conceptGovernance),
    "",
    formatTemporalFactContextMarkdown(prepared.temporalFactContext, { includeSegments: true }),
    "",
    "## Existing Index",
    "```markdown",
    prepared.index ? compactPreview(prepared.index, 360) : "(missing wiki/index.md)",
    "```",
    "",
    "## schema.md",
    "```markdown",
    prepared.schema || "(missing schema.md)",
    "```",
  ].join("\n")
}

export function schemaPromptSection(nowTs) {
  return [
    "## Frontmatter Schema",
    "- 每个 wiki 页面必须用裸 `---` YAML frontmatter 开头，不能包在 ```yaml 里。",
    "- 必填字段：schema_version: 1, title, type, summary, tags, related, sources, created, updated, last_reviewed, confidence, status。",
    `- 时间字段格式为 YYYY-MM-DD HH:mm:ss；新建页面使用 ${nowTs}。`,
    `- type 只能使用：${WIKI_TYPES.join(" / ")}。`,
    `- confidence：${CONFIDENCE.join(" / ")}；status：${WIKI_STATUS.join(" / ")}。`,
    "- related 使用完整 wikilink，例如 \"[[概念/催化剂层级框架]]\"。",
    "- sources 必须包含本次 source 文件名（不带 .md）。",
    "- 概念页可以使用 parent、momentum（热/活跃/降温/已死）、catalysts。",
    `- 正文软上限 ${PAGE_BODY_LINE_SOFT_LIMIT} 行；超过也可校验通过，但应尽量清洗、归纳，不要复制 raw 全文。`,
  ].join("\n")
}

export function buildPageFilePrompt({ prepared, item, existingContent, analysis, sourceBaseName, nowTs }) {
  const sourceArchive = item.path === sourceArchivePath(sourceBaseName)
  const type = normalizeTypeAlias(item.type) ?? inferTypeFromPath(item.path)
  return [
    `# Stage 3/4: ${item.action === "update" ? "更新" : "生成"} ${item.path}`,
    "",
    "输出 exactly one FILE block，不要输出 FILE block 之外的文字：",
    `---FILE: ${item.path}---`,
    "(完整 Markdown 文件内容，含 YAML frontmatter)",
    "---END FILE---",
    "",
    "## Writing Rules",
    sourceArchive
      ? "- 这是 source archive：生成清洗后的证据档案，保留传播路径、关键原始节点、证据强度和后续引用依据；不要直接完整复制 raw；不要手写 `## 分时主线索引`，程序会按 raw 行号注入该索引。"
      : "- 这是正式知识页：不要写成摘要。按应用风格写成可复用知识结构，包含定义/事实强度/链条/交易框架/风险/后续观察。",
    item.action === "update"
      ? "- 这是 update：必须保留旧页面已有理解，只追加或合并新 evidence；不要重写成只有本次 source 的页面。"
      : "- 这是 create：页面必须独立可复用，且与现有页面形成 related/wikilink 网络。",
    "- 对群聊、小作文、研报强 Call、目标市值等必须降权，不能写成已验证事实。",
    "- 当日盘面数值不要在概念/模式/错误页大段复制；必要时链接到总结或 source archive。",
    item.path.startsWith("wiki/股票/")
      ? "- 股票页边界：本次更新不得新增买入/卖出、成交价、数量、仓位、持仓流水、盈亏、交割单逐笔记录或交易日志；旧交易日志不要继续扩写。股票页只承载公司档案、产业链位置、催化/基本面/消息面、验证框架、风险与来源链接。若需要提到交易复盘，只链接总结/策略/错误/source archive，不复制执行细节。"
      : "- 交易执行复盘可以进入总结、策略、错误、模式或长期记忆；不要把个人买入/卖出/仓位/盈亏流水反哺到股票页。",
    `- 本次页面 path 必须是 ${item.path}，title 应匹配文件名。`,
    "",
    ...(prepared.methodologyContext?.stage3Rules ? [prepared.methodologyContext.stage3Rules, ""] : []),
    schemaPromptSection(nowTs),
    "",
    "## Planned Change",
    `- action: ${item.action}`,
    `- type: ${type}`,
    `- title: ${item.title || pathToTitle(item.path)}`,
    `- why: ${item.why || "(none)"}`,
    item.conceptRouting ? `- conceptRouting: ${JSON.stringify(item.conceptRouting)}` : "",
    "",
    item.action === "update"
      ? ["## Existing Full Page", "```markdown", existingContent || "(missing)", "```"].join("\n")
      : "",
    "",
    "## Stage 1 Analysis",
    analysis,
    "",
    "## Source Content",
    "```markdown",
    prepared.sourceContent,
    "```",
    "",
    "## schema.md",
    "```markdown",
    prepared.schema || "(missing schema.md)",
    "```",
  ]
    .filter(Boolean)
    .join("\n")
}

export function buildPagePatchPrompt({ prepared, item, existingContent, analysis, nowTs }) {
  const outline = buildSectionOutline(existingContent)
  return [
    `# Stage 3/4: 章节补丁更新 ${item.path}`,
    "",
    "输出 exactly one ```json fenced block,内容为章节补丁操作数组;不要输出 JSON 之外的文字,不要输出整页 Markdown:",
    "```json",
    JSON.stringify(
      [
        { op: "replace_section", anchor: "## 章节标题", content: ["该章节完整新正文第一行(不含标题行)", "第二行", "..."] },
        { op: "append_to_section", anchor: "## 章节标题", content: ["要追加的内容,每行一个数组元素"] },
        { op: "insert_section_after", anchor: "## 已有章节", heading: "## 新章节", content: ["新章节正文"] },
        { op: "update_frontmatter", fields: { updated: nowTs, summary: "如主线判断变化才更新" } },
      ],
      null,
      2,
    ),
    "```",
    "",
    "## Patch Rules",
    "- content 必须是字符串数组:每个元素是一行 Markdown,不要在元素里内嵌 \\n 换行符,空行用空字符串 \"\" 表示。",
    "- 只修改需要吸收本次新证据的章节;未触及章节不要出现在补丁里,程序会原样保留。",
    "- replace_section 必须输出该章节合并后的完整新正文(保留旧知识 + 融合新证据),不要只输出增量句子。",
    "- 不允许删除章节,不允许重写整页;anchor 必须来自下方章节大纲,新增章节用 insert_section_after。",
    "- 如果页面的整体结论或主线判断因本次证据发生变化,用 replace_section 更新结论类章节,并在 update_frontmatter 中同步 summary。",
    `- update_frontmatter 至少把 updated 设为 ${nowTs}。`,
    "- 对群聊、小作文、研报强 Call、目标市值等必须降权,不能写成已验证事实。",
    "- 当日盘面数值不要大段复制;必要时链接到总结或 source archive。",
    item.path.startsWith("wiki/股票/")
      ? "- 股票页边界:不得新增买入/卖出、成交价、数量、仓位、持仓流水、盈亏、交割单逐笔记录或交易日志;只承载公司档案、产业链位置、催化/基本面/消息面、验证框架、风险与来源链接。"
      : "- 交易执行复盘可以进入总结、策略、错误、模式或长期记忆;不要把个人买入/卖出/仓位/盈亏流水反哺到本页。",
    "",
    ...(prepared.methodologyContext?.stage3Rules ? [prepared.methodologyContext.stage3Rules, ""] : []),
    "## Planned Change",
    `- action: update (section patch)`,
    `- path: ${item.path}`,
    `- why: ${item.why || "(none)"}`,
    item.conceptRouting ? `- conceptRouting: ${JSON.stringify(item.conceptRouting)}` : "",
    "",
    "## 章节大纲",
    outline || "- (页面暂无 ## 章节)",
    "",
    "## Existing Full Page",
    "```markdown",
    existingContent || "(missing)",
    "```",
    "",
    "## Stage 1 Analysis",
    analysis,
    "",
    "## Source Content",
    "```markdown",
    prepared.sourceContent,
    "```",
    "",
    "## schema.md",
    "```markdown",
    prepared.schema || "(missing schema.md)",
    "```",
  ]
    .filter(Boolean)
    .join("\n")
}

export function renderFileBlockArtifact(relativePath, content) {
  return [`---FILE: ${relativePath}---`, String(content ?? "").replace(/\s*$/, ""), "---END FILE---"].join("\n")
}

export function generatedFilesSummary(writes) {
  return writes
    .map((write) => {
      const title = extractTitle(write.content, write.path)
      const { fm, body } = parseFrontmatter(write.content)
      const summary = typeof fm.summary === "string" ? fm.summary : body.slice(0, 180).replace(/\s+/g, " ")
      return `- ${write.path} (${write.action}) — ${title}: ${summary}`
    })
    .join("\n")
}

export function tailLines(text, maxLines) {
  const lines = String(text ?? "").split(/\r?\n/)
  return lines.slice(-maxLines).join("\n")
}

export function indexSectionName(relativePath) {
  const match = String(relativePath ?? "").match(/^wiki\/([^/]+)\//)
  return match?.[1] ?? "other"
}

export function wikiIndexStem(relativePath) {
  return String(relativePath ?? "").replace(/^wiki\//, "").replace(/\.md$/i, "")
}

export function hasIndexEntry(indexContent, stem) {
  const escaped = stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`\\[\\[${escaped}(?:\\||\\]\\])`).test(indexContent)
}

export function indexEntryForWrite(write) {
  const stem = wikiIndexStem(write.path)
  const title = extractTitle(write.content, write.path)
  const display = title && title !== path.posix.basename(stem) ? `|${title}` : ""
  const { fm, body } = parseFrontmatter(write.content)
  const summary = typeof fm.summary === "string" && fm.summary.trim()
    ? fm.summary.trim()
    : body.split(/\r?\n/).find((line) => line.trim() && !line.startsWith("#"))?.trim() ?? ""
  return `- [[${stem}${display}]]${summary ? ` - ${summary.replace(/\s+/g, " ").slice(0, 180)}` : ""}`
}

export function mergeIndexEntriesText(existingIndex, pageWrites) {
  let next = String(existingIndex ?? "").trim() ? String(existingIndex).replace(/\s*$/, "") : "# Wiki Index"
  const additionsBySection = new Map()

  for (const write of pageWrites) {
    if (!write?.path?.startsWith("wiki/") || !write.path.endsWith(".md")) continue
    if (isReservedWikiPath(write.path)) continue
    const stem = wikiIndexStem(write.path)
    if (!stem || hasIndexEntry(next, stem)) continue
    const section = indexSectionName(write.path)
    if (!additionsBySection.has(section)) additionsBySection.set(section, [])
    additionsBySection.get(section).push(indexEntryForWrite(write))
  }

  for (const [section, lines] of additionsBySection.entries()) {
    if (!lines.length) continue
    const header = `## ${section}`
    const escapedHeader = header.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const match = new RegExp(`(^|\\n)${escapedHeader}\\n`).exec(next)
    if (match) {
      const insertAt = match.index + match[0].length
      next = `${next.slice(0, insertAt)}${lines.join("\n")}\n${next.slice(insertAt)}`
    } else {
      next = `${next}\n\n${header}\n${lines.join("\n")}`
    }
  }

  return `${next.replace(/\s*$/, "")}\n`
}

export function buildProgrammaticDailyLog({ pageWrites, sourceBaseName, nowTs }) {
  const day = nowTs.slice(0, 10)
  const rows = [`## [${day}] ingest | ${sourceBaseName}.md`, ""]
  const creates = pageWrites.filter((write) => write.action === "create")
  const updates = pageWrites.filter((write) => write.action !== "create")
  rows.push(`- pages: ${pageWrites.length}; created: ${creates.length}; updated: ${updates.length}`)
  for (const write of pageWrites.slice(0, 30)) {
    rows.push(`- ${write.action}: [[${wikiIndexStem(write.path)}]]`)
  }
  if (pageWrites.length > 30) rows.push(`- ... ${pageWrites.length - 30} more page writes`)
  return `${rows.join("\n")}\n`
}

export function buildProgrammaticOverview(existingOverview, pageWrites, sourceBaseName, nowTs) {
  const base = String(existingOverview ?? "").trim()
    ? String(existingOverview).replace(/\s*$/, "")
    : "# Wiki Overview\n\nThis overview is intentionally minimal until the wiki has a curated global summary."
  const day = String(nowTs ?? nowLocalTimestamp()).slice(0, 10)
  const source = `${sourceBaseName}.md`
  const escapedSource = source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  if (new RegExp(`^- \\d{4}-\\d{2}-\\d{2}: ${escapedSource}(?:\\s|$)`, "m").test(base)) return `${base}\n`

  const links = pageWrites
    .filter((write) => write?.path?.startsWith("wiki/") && write.path.endsWith(".md") && !isReservedWikiPath(write.path))
    .slice(0, 8)
    .map((write) => `[[${wikiIndexStem(write.path)}]]`)
    .join(", ")
  const more = pageWrites.length > 8 ? `, +${pageWrites.length - 8} more` : ""
  const line = `- ${day}: ${source}${links ? ` - ${links}${more}` : ""}`
  const headerMatch = /(^|\n)## Recent Ingests\n/.exec(base)
  if (!headerMatch) return `${base}\n\n## Recent Ingests\n${line}\n`
  const insertAt = headerMatch.index + headerMatch[0].length
  return `${base.slice(0, insertAt)}${line}\n${base.slice(insertAt).replace(/^\n/, "")}\n`
}

export function renderHousekeepingArtifact(writes) {
  return writes
    .map((write) => [`---FILE: ${write.path}---`, write.content.replace(/\s*$/, ""), "---END FILE---"].join("\n"))
    .join("\n\n")
}

export function buildProgrammaticHousekeepingWrites({ prepared, pageWrites, sourceBaseName, nowTs }) {
  const logPath = dailyLogPathFromTimestamp(nowTs)
  const writes = [
    {
      action: "update",
      path: "wiki/index.md",
      content: mergeIndexEntriesText(prepared.index, pageWrites),
    },
    {
      action: "update",
      path: "wiki/overview.md",
      content: buildProgrammaticOverview(prepared.overview, pageWrites, sourceBaseName, nowTs),
    },
    {
      action: "append",
      path: logPath,
      content: buildProgrammaticDailyLog({ pageWrites, sourceBaseName, nowTs }),
    },
  ]
  return { writes, artifact: renderHousekeepingArtifact(writes) }
}

export function buildHousekeepingPrompt({ prepared, plan, analysis, pageWrites, sourceBaseName, nowTs }) {
  const logPath = dailyLogPathFromTimestamp(nowTs)
  return [
    "# Stage 4/4: 汇总 index / overview / log",
    "",
    `请输出 exactly three FILE blocks：wiki/index.md、wiki/overview.md、${logPath}。`,
    "",
    "## Rules",
    "- wiki/index.md：输出完整更新后文件，保留全部旧条目，加入本次新增/重要更新页面。",
    "- wiki/overview.md：输出完整更新后文件；只有当整体主线、市场阶段或风险原则变化时才实质更新，否则保留原文并做最小补充。",
    `- ${logPath}：只输出本次要 append 的日志条目，不要输出完整旧 log。格式：## [${nowTs.slice(0, 10)}] ingest | ${sourceBaseName}.md。`,
    "- 不要输出 wiki/log.md；旧的 wiki/log.md 只是历史遗留文件。",
    "- 不要输出 FILE block 之外的文字。",
    "",
    "## Generated/Updated Pages",
    generatedFilesSummary(pageWrites),
    "",
    "## Normalized Plan",
    "```json",
    JSON.stringify(plan, null, 2),
    "```",
    "",
    "## Stage 1 Analysis",
    analysis,
    "",
    "## Existing wiki/index.md",
    "```markdown",
    prepared.index || "(missing wiki/index.md)",
    "```",
    "",
    "## Existing wiki/overview.md",
    "```markdown",
    prepared.overview || "(missing wiki/overview.md)",
    "```",
    "",
    `## Existing ${logPath}`,
    "如果为空，说明今天的分片日志尚未创建。",
    "```markdown",
    prepared.dailyLog || `(missing ${logPath})`,
    "```",
    "",
    "## Legacy wiki/log.md Tail",
    "只给旧总日志尾部上下文用于避免重复；不要返回完整旧 log，也不要继续写 wiki/log.md。",
    "```markdown",
    tailLines(prepared.log || "(missing wiki/log.md)", 160),
    "```",
  ].join("\n")
}

export async function nextAvailableWikiPath(projectPath, relativePath) {
  const parsed = path.posix.parse(relativePath)
  let candidate = relativePath
  let i = 1
  while (await exists(path.join(projectPath, candidate))) {
    candidate = path.posix.join(parsed.dir, `${parsed.name}-${i}${parsed.ext}`)
    i += 1
  }
  return candidate
}

export function wikiStem(relativePath) {
  return relativePath.replace(/^wiki\//, "").replace(/\.md$/i, "")
}

export function rewriteCollisionReferences(content, collisionMap) {
  let out = content
  for (const [fromPath, toPath] of collisionMap.entries()) {
    const fromStem = wikiStem(fromPath)
    const toStem = wikiStem(toPath)
    out = out.split(fromPath).join(toPath)
    out = out.split(`[[${fromStem}]]`).join(`[[${toStem}]]`)
  }
  return out
}

export function normalizeManifestWrites(manifest) {
  const writes = manifest.writes ?? manifest.files
  if (!Array.isArray(writes)) throw new Error("Manifest must contain a writes array")
  return writes.map((write) => ({
    action: write.action ?? "update",
    path: write.path ?? write.relativePath,
    content: write.content ?? "",
  }))
}

export function classifyIngestPath(relativePath) {
  const normalized = String(relativePath ?? "").replace(/^\/+/, "")
  if (normalized === "wiki/index.md" || normalized === "wiki/overview.md" || /^wiki\/logs\/log-\d{4}-\d{2}-\d{2}\.md$/.test(normalized)) return "housekeeping"
  if (normalized.startsWith("data/facts/")) return "facts"
  if (normalized.startsWith("wiki/sources/")) return "source"
  if (/^wiki\/(概念|模式|策略|错误|总结)\//.test(normalized)) return "core"
  return "other"
}

export function normalizeExpectedTargetHashes(expectedTargetHashes) {
  if (!expectedTargetHashes) return new Map()
  if (expectedTargetHashes instanceof Map) return expectedTargetHashes
  if (Array.isArray(expectedTargetHashes)) {
    return new Map(expectedTargetHashes.map((item) => [item.path, item]))
  }
  if (typeof expectedTargetHashes === "object") {
    return new Map(Object.entries(expectedTargetHashes).map(([key, value]) => [
      key,
      typeof value === "string" || value == null ? { path: key, baseHash: value, baseExists: value != null } : { path: key, ...value },
    ]))
  }
  return new Map()
}

export function manifestTargetPaths(manifest) {
  const paths = []
  for (const writeItem of normalizeManifestWrites(manifest)) {
    paths.push({ action: writeItem.action ?? "update", path: assertSafeWikiPath(writeItem.path) })
  }
  for (const factWrite of normalizeManifestFactWrites(manifest)) {
    paths.push({ action: "append", path: factWrite.path })
  }
  for (const judgmentWrite of normalizeManifestJudgmentWrites(manifest)) {
    paths.push({ action: "append", path: judgmentWrite.path })
  }
  const seen = new Set()
  return paths.filter((item) => {
    if (seen.has(item.path)) return false
    seen.add(item.path)
    return true
  })
}

export async function collectManifestTargetHashes(projectPath, manifest) {
  const normalizedProjectPath = normalizePath(projectPath ?? manifest.projectPath ?? DEFAULT_PROJECT_PATH)
  const targets = []
  for (const item of manifestTargetPaths(manifest)) {
    const fullPath = path.join(normalizedProjectPath, item.path)
    const baseExists = await exists(fullPath)
    const existing = baseExists ? await readTextFile(fullPath) : ""
    targets.push({
      path: item.path,
      action: item.action,
      classification: classifyIngestPath(item.path),
      baseExists,
      baseHash: baseExists ? shortHash(existing) : null,
    })
  }
  return targets
}

export async function checkManifestTargetConflicts(projectPath, manifest, expectedTargetHashes) {
  const expected = normalizeExpectedTargetHashes(expectedTargetHashes)
  if (expected.size === 0) return []
  const normalizedProjectPath = normalizePath(projectPath ?? manifest.projectPath ?? DEFAULT_PROJECT_PATH)
  const conflicts = []
  for (const item of manifestTargetPaths(manifest)) {
    const base = expected.get(item.path)
    if (!base) continue
    const fullPath = path.join(normalizedProjectPath, item.path)
    const currentExists = await exists(fullPath)
    const existing = currentExists ? await readTextFile(fullPath) : ""
    const currentHash = currentExists ? shortHash(existing) : null
    const baseExists = Boolean(base.baseExists)
    const baseHash = base.baseHash ?? null
    let reason = null
    if (item.action === "create" && currentExists) reason = "create_target_exists"
    else if (!baseExists && currentExists) reason = "create_target_exists"
    else if (baseExists !== currentExists) reason = "existence_changed"
    else if (baseHash !== currentHash) reason = "hash_mismatch"
    if (reason) {
      conflicts.push({
        path: item.path,
        action: item.action,
        classification: classifyIngestPath(item.path),
        reason,
        baseExists,
        currentExists,
        baseHash,
        currentHash,
      })
    }
  }
  return conflicts
}

export function compactPreview(text, maxLines = 80) {
  const lines = text.split(/\r?\n/)
  const preview = lines.slice(0, maxLines).join("\n")
  return lines.length > maxLines ? `${preview}\n... (${lines.length - maxLines} more lines)` : preview
}

export function buildSimpleDiff(before, after) {
  if (before === after) return "(no content changes)"
  return [
    "--- before",
    "+++ after",
    "@@ before preview @@",
    compactPreview(before || "(new file)", 40)
      .split("\n")
      .map((line) => `- ${line}`)
      .join("\n"),
    "@@ after preview @@",
    compactPreview(after || "(empty)", 40)
      .split("\n")
      .map((line) => `+ ${line}`)
      .join("\n"),
  ].join("\n")
}

export async function applyManifest(options) {
  const manifestPath = normalizePath(options.manifestPath)
  const manifest = JSON.parse(await readTextFile(manifestPath))
  const projectPath = normalizePath(options.projectPath ?? manifest.projectPath ?? DEFAULT_PROJECT_PATH)
  const write = Boolean(options.write)
  const allowSourceChange = Boolean(options.allowSourceChange)
  const targetConflictPolicy = options.targetConflictPolicy ?? "error"

  if (manifest.sourcePath && manifest.sourceHash && !allowSourceChange) {
    const currentSource = await readTextFile(manifest.sourcePath)
    const currentHash = shortHash(currentSource)
    if (currentHash !== manifest.sourceHash) {
      throw new Error(`Source hash changed: expected ${manifest.sourceHash}, got ${currentHash}`)
    }
  }

  const rawWrites = normalizeManifestWrites(manifest)
  const factWrites = normalizeManifestFactWrites(manifest)
  const targetConflicts = await checkManifestTargetConflicts(projectPath, manifest, options.expectedTargetHashes)
  if (write && targetConflicts.length > 0 && targetConflictPolicy !== "ignore") {
    const messages = targetConflicts.map((item) => `${item.path} [${item.reason}] ${item.baseHash ?? "missing"} -> ${item.currentHash ?? "missing"}`)
    throw new Error(`Target conflict detected. Re-run finalize or api-run before applying:\n${messages.join("\n")}`)
  }
  const factPlan = await planTemporalFactWrites(projectPath, factWrites)
  const factValidation = validateTemporalFactPlan(factPlan)
  const judgmentWrites = normalizeManifestJudgmentWrites(manifest)
  const judgmentPlan = await planJudgmentWrites(projectPath, judgmentWrites)
  const judgmentValidation = validateJudgmentPlan(judgmentPlan)
  const collisionMap = new Map()
  const prepared = []

  for (const writeItem of rawWrites) {
    const safePath = assertSafeWikiPath(writeItem.path)
    if (safePath === "wiki/log.md") {
      throw new Error("Refusing to write legacy wiki/log.md. Use daily logs such as wiki/logs/log-YYYY-MM-DD.md.")
    }
    let action = writeItem.action
    let actualPath = safePath
    const fullPath = path.join(projectPath, safePath)
    const targetExists = await exists(fullPath)

    if (action === "create" && targetExists) {
      throw new Error(`Create target already exists: ${safePath}. Re-run api-run/prepare so the plan can merge it as an update.`)
    } else if (action === "update" && !targetExists) {
      action = "create"
    } else if (action === "append" && !targetExists) {
      action = "create"
    }

    prepared.push({ ...writeItem, action, originalPath: safePath, path: actualPath })
  }

  const finalWrites = []
  for (const item of prepared) {
    const content = rewriteCollisionReferences(String(item.content ?? ""), collisionMap)
    finalWrites.push({ ...item, content })
  }

  const validation = []
  const diffs = []
  const written = []
  const factsWritten = []
  const judgmentsWritten = []
  let factIndex = null
  let judgmentIndex = null
  let embeddingIndexRefresh = null

  for (const item of finalWrites) {
    const fullPath = path.join(projectPath, item.path)
    const existing = await readIfExists(fullPath)
    const after = item.action === "append" && existing
      ? `${existing.replace(/\s*$/, "")}\n\n${item.content.trim()}\n`
      : item.content

    const contentIssues = validateWikiContent(item.path, after)
    if (existing && contentIssues.some((issue) => issue.fatal)) {
      const beforeKeys = new Set(validateWikiContent(item.path, existing).map((issue) => `${issue.field} ${issue.message}`))
      for (const issue of contentIssues) {
        if (issue.fatal && beforeKeys.has(`${issue.field} ${issue.message}`)) {
          issue.fatal = false
          issue.preExisting = true
        }
      }
    }
    const issues = [
      ...contentIssues,
      ...validatePreserveLargeHousekeepingPage(item.path, existing, after),
    ]
    validation.push({ path: item.path, issues })

    diffs.push({
      path: item.path,
      action: item.action,
      originalPath: item.originalPath,
      changed: existing !== after,
      diff: buildSimpleDiff(existing, after),
    })
  }
  const sourceMainlineIssues = validateSourceMainlineIndexManifest(manifest, finalWrites)

  const fatalIssues = validation.flatMap((item) =>
    item.issues.filter((issue) => issue.fatal).map((issue) => ({ path: item.path, ...issue })),
  ).concat(sourceMainlineIssues.filter((issue) => issue.fatal))
  const fatalFactIssues = factValidation.filter((issue) => issue.fatal)
  const fatalJudgmentIssues = judgmentValidation.filter((issue) => issue.fatal)
  if ((fatalIssues.length > 0 || fatalFactIssues.length > 0 || fatalJudgmentIssues.length > 0) && write) {
    const wikiMessages = fatalIssues.map((i) => `${i.path} [${i.field}] ${i.message}`)
    const factMessages = fatalFactIssues.map((i) => `${i.path} ${i.id ? `[${i.id}] ` : ""}[${i.field}] ${i.message}`)
    const judgmentMessages = fatalJudgmentIssues.map((i) => `${i.path} ${i.id ? `[${i.id}] ` : ""}[${i.field}] ${i.message}`)
    throw new Error(`Fatal schema validation failed:\n${[...wikiMessages, ...factMessages, ...judgmentMessages].join("\n")}`)
  }

  if (write) {
    for (const item of finalWrites) {
      const fullPath = path.join(projectPath, item.path)
      const existing = await readIfExists(fullPath)
      const after = item.action === "append" && existing
        ? `${existing.replace(/\s*$/, "")}\n\n${item.content.trim()}\n`
        : item.content
      await ensureDirectory(path.dirname(fullPath))
      await fs.writeFile(fullPath, after, "utf8")
      written.push(item.path)
    }
    for (const item of factPlan.plannedFactWrites) {
      const fullPath = path.join(projectPath, item.path)
      await appendJsonl(fullPath, item.record)
      factsWritten.push(item.record.id)
    }
    if (factsWritten.length > 0) {
      factIndex = await writeTemporalFactsIndex(projectPath)
    }
    for (const item of judgmentPlan.plannedJudgmentWrites) {
      const fullPath = path.join(projectPath, item.path)
      await appendJsonl(fullPath, item.record)
      judgmentsWritten.push(item.record.id)
    }
    if (judgmentsWritten.length > 0) {
      judgmentIndex = await writeJudgmentsIndex(projectPath)
    }
    if (written.some((relativePath) => isEmbeddingIndexedPath(relativePath))) {
      embeddingIndexRefresh = await maybeRefreshWikiEmbeddingIndex({ projectPath, options, onProgress: options.onProgress })
    }
  }

  let sourceHashAfter = null
  if (manifest.sourcePath) {
    sourceHashAfter = shortHash(await readTextFile(manifest.sourcePath))
  }

  const report = {
    manifestPath,
    projectPath,
    dryRun: !write,
    sourceHashBefore: manifest.sourceHash ?? null,
    sourceHashAfter,
    collisionMap: Object.fromEntries(collisionMap.entries()),
    conceptRouting: Array.isArray(manifest.conceptRouting) ? manifest.conceptRouting : manifest.plan?.conceptRouting ?? [],
    validation,
    fatalIssues,
    targetConflicts,
    diffs,
    written,
    plannedFactWrites: factPlan.plannedFactWrites.map((item) => ({
      path: item.path,
      id: item.record.id,
      status: item.record.status,
      subject: item.record.subject ?? null,
      predicate: item.record.predicate ?? null,
      object: item.record.object ?? null,
      claim: item.record.claim ?? null,
    })),
    duplicateFacts: factPlan.duplicateFacts,
    supersededFacts: factPlan.supersededFacts,
    invalidatedFacts: factPlan.invalidatedFacts,
    factValidation,
    fatalFactIssues,
    factsWritten,
    factIndex,
    plannedJudgmentWrites: judgmentPlan.plannedJudgmentWrites.map((item) => ({
      path: item.path,
      id: item.record.id,
      status: item.record.status,
      kind: item.record.kind ?? null,
      visibility: item.record.visibility ?? null,
      subject: item.record.subject ?? null,
      claim: item.record.claim ?? null,
    })),
    duplicateJudgments: judgmentPlan.duplicateJudgments,
    revisedJudgments: judgmentPlan.revisedJudgments,
    invalidatedJudgments: judgmentPlan.invalidatedJudgments,
    judgmentValidation,
    fatalJudgmentIssues,
    judgmentsWritten,
    judgmentIndex,
    embeddingIndexRefresh,
  }

  const reportPath = path.join(path.dirname(manifestPath), write ? "apply-report.json" : "apply-dry-run.json")
  await writeJson(reportPath, report)
  if (write) await maybeSyncApplyReportToSag(reportPath, { projectPath })

  return { ...report, reportPath }
}

export function formatSourceShardingStatus(sourceSharding) {
  const counts = sourceSharding?.mainlineIndex?.counts ?? { windows: 0, mainlines: 0 }
  if (!sourceSharding?.enabled) {
    return `Source sharding: disabled (${sourceSharding?.reason ?? "not_applicable"}); windows=${counts.windows}; mainlines=${counts.mainlines}`
  }
  return `Source sharding: enabled; shards=${sourceSharding.shards.length}; shardConcurrency=${sourceSharding.shardConcurrency}; windows=${counts.windows}; mainlines=${counts.mainlines}`
}

export function buildShardAnalysisPrompt({ prepared, shard }) {
  return [
    `# Shard Analysis: ${shard.id}`,
    "",
    "请只分析本分片，不要生成 wiki FILE block，不要规划最终写入。",
    "",
    "## 输出要求",
    "- 使用 Markdown。",
    "- 列出本分片的核心主题、时间线、关键主线、相关页面建议、事实强度、错误/交易纪律、待验证事项。",
    "- 对群聊/小作文/强 Call 保持降权，不要写成确认事实。",
    "- 如果出现可写入 Temporal Facts 的候选，只列为候选，并说明证据等级；最终 factWrites 由总规划阶段统一去重。",
    "- 必须覆盖分片主线索引中的每一条高热或中高热主线；低热主线可以只说明为何仅入 source archive。",
    "",
    ...(prepared.methodologyContext?.markdown ? [prepared.methodologyContext.markdown, ""] : []),
    "## Shard Source",
    "```markdown",
    shard.promptText,
    "```",
  ].join("\n")
}

export function buildShardedAnalysisMergePrompt({ prepared, shardAnalyses }) {
  const mainlineRows = (prepared.sourceMainlineIndex?.items ?? [])
    .map((item) => `- ${item.id} ${item.windowTime} lines ${item.lineStart}-${item.lineEnd}: ${item.label}${item.heat ? ` | ${item.heat}` : ""}${item.groups ? ` | ${item.groups}` : ""}`)
    .join("\n")
  const shardRows = shardAnalyses
    .map((item) => [`## ${item.shard.id} (${item.shard.windowTimes.join(", ")})`, item.analysis].join("\n\n"))
    .join("\n\n")
  const candidates = candidateSummary(prepared.candidates)
  return [
    "# Stage 1/4: 合并分片分析",
    "",
    "请把所有分片分析合并成一次 app-grade ingest analysis。不要生成 JSON 计划，不要生成 FILE block。",
    "",
    "## 输出要求",
    "- 按完整 source 视角输出核心结论、时间线/传播路径、重要主题、可沉淀概念、模式、错误/交易纪律。",
    "- 明确区分事实强度：公告/财报/政策/权威报道/研报推演/群聊传闻/小作文。",
    "- 明确哪些主线只进入 source archive，哪些应更新正式页，哪些可写 Temporal Facts 候选。",
    "- 使用分时主线索引做 coverage checklist，不要只围绕最热主题。",
    "",
    "## Source",
    `- sourceRelativePath: ${prepared.sourceRelativePath}`,
    `- sourceHash: ${prepared.sourceHash}`,
    "",
    "## 分时主线索引",
    mainlineRows || "- none",
    "",
    "## Shard Analyses",
    shardRows || "- none",
    "",
    "## Candidate Wiki Pages",
    candidates.wiki,
    "",
    "## Segment Candidate Groups",
    candidates.segments,
    "",
    formatTemporalFactContextMarkdown(prepared.temporalFactContext, { includeSegments: true }),
    "",
    ...(prepared.methodologyContext?.markdown ? [prepared.methodologyContext.markdown, ""] : []),
  ].join("\n")
}

export async function runShardAnalyses({ prepared, requestText, shardConcurrency }) {
  if (!prepared.sourceSharding?.enabled) return []
  const shardDir = path.join(prepared.reportDir, "shard-analyses")
  await ensureDirectory(shardDir)
  const concurrency = Math.min(parsePositiveInteger(shardConcurrency, DEFAULT_SOURCE_SHARD_CONCURRENCY), prepared.sourceSharding.shards.length || 1)
  return mapWithConcurrency(prepared.sourceSharding.shards, concurrency, async (shard) => {
    const prompt = buildShardAnalysisPrompt({ prepared, shard })
    try {
      const analysis = await requestText({
        stage: `shard-${shard.id}`,
        prompt,
        instructions: "You are an application-grade trading wiki ingest shard analyst. Return Markdown analysis only.",
      })
      const filePath = path.join(shardDir, `${String(shard.index).padStart(3, "0")}-${shard.id}.md`)
      await fs.writeFile(filePath, analysis, "utf8")
      return { shard, analysis, filePath }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new Error(`Shard analysis failed for ${shard.id} (${shard.windowTimes.join(", ")}): ${message}. Re-run api-run for this source; completed shard outputs remain under ${shardDir}.`)
    }
  })
}

export async function apiRunIngest(options) {
  const provider = options.provider ?? "openai"
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY
  const model = options.model ?? (provider === "openai" ? process.env.OPENAI_MODEL : process.env.CODEX_MODEL)
  if (!options.requestText && provider === "openai" && !apiKey) {
    throw new Error("Missing OpenAI API key. Pass --api-key or set OPENAI_API_KEY, or use --provider codex.")
  }
  if (!options.requestText && provider === "openai" && !model) {
    throw new Error("Missing model. Pass --model or set OPENAI_MODEL.")
  }
  if (!["openai", "codex"].includes(provider) && !options.requestText) {
    throw new Error(`Unsupported provider: ${provider}`)
  }

  const prepared = await prepareIngest({ ...options, noReport: false })
  options.onProgress?.(formatSourceShardingStatus(prepared.sourceSharding))
  const codexOutputsDir = path.join(prepared.reportDir, "codex-outputs")
  let codexCallCounter = 0

  const requestText = async ({ stage, prompt, instructions }) => {
    if (options.requestText) {
      return options.requestText({
        stage,
        prompt,
        instructions,
        model,
        provider,
        prepared,
      })
    }
    if (provider === "codex") {
      codexCallCounter += 1
      const outputPath = path.join(codexOutputsDir, `${String(codexCallCounter).padStart(3, "0")}-${stage}.md`)
      return requestCodexExecText({
        stage,
        prompt,
        instructions,
        model,
        prepared,
        outputPath,
        codexBin: options.codexBin,
        codexProfile: options.codexProfile,
        codexProfileV2: options.codexProfileV2,
        codexTimeoutMs: options.codexTimeoutMs,
      })
    }
    return requestResponsesText({
      apiKey,
      endpoint: options.endpoint,
      model,
      prompt,
      instructions,
      reasoningEffort: options.reasoningEffort ?? "medium",
    })
  }

  const sourceBaseName = path.basename(prepared.sourcePath).replace(/\.[^.]+$/, "")
  const nowTs = prepared.createdAt

  const shardAnalyses = await runShardAnalyses({
    prepared,
    requestText,
    shardConcurrency: prepared.sourceSharding?.shardConcurrency ?? options.shardConcurrency,
  })
  const analysisPrompt = prepared.sourceSharding?.enabled
    ? buildShardedAnalysisMergePrompt({ prepared, shardAnalyses })
    : buildAnalysisStagePrompt(prepared)
  const analysis = await requestText({
    stage: "analysis",
    prompt: analysisPrompt,
    instructions: "You are an application-grade trading wiki ingest analyst. Return Markdown analysis only.",
  })
  const analysisPath = path.join(prepared.reportDir, "analysis.md")
  await fs.writeFile(analysisPath, analysis, "utf8")

  const planPrompt = buildPlanStagePrompt({ prepared, analysis, sourceBaseName, includeJudgments: Boolean(options.judgments) })
  const planRaw = await requestText({
    stage: "plan",
    prompt: planPrompt,
    instructions: "You are an application-grade trading wiki ingest planner. Return only the requested JSON fenced block.",
  })
  const parsedPlan = parsePlanFromModelText(planRaw)
  const plan = await normalizeIngestPlan(prepared.projectPath, parsedPlan, sourceBaseName)
  const planMarkdownPath = path.join(prepared.reportDir, "plan.md")
  const planJsonPath = path.join(prepared.reportDir, "plan.json")
  await fs.writeFile(planMarkdownPath, planRaw, "utf8")
  await writeJson(planJsonPath, plan)
  const planBudget = assessIngestPlanBudget(plan, options)
  const planBudgetPath = path.join(prepared.reportDir, "plan-budget.json")
  await writeJson(planBudgetPath, planBudget)

  const filesDir = path.join(prepared.reportDir, "files")
  await ensureDirectory(filesDir)
  const items = planItemsInGenerationOrder(plan, sourceBaseName)
  const pageConcurrency = parsePositiveInteger(options.pageConcurrency, 1)
  const pageWriteMode = resolvePageWriteMode(options.pageWriteMode)
  const pagePatchStats = { mode: pageWriteMode, patchedPages: 0, fullPages: 0, fallbacks: [] }
  const pageWrites = await mapWithConcurrency(items, pageConcurrency, async (item, i) => {
    const existingContent = item.action === "update" ? await readIfExists(path.join(prepared.projectPath, item.path)) : ""
    const artifactName = `${String(i + 1).padStart(3, "0")}-${item.path.replace(/[^\p{L}\p{N}._-]+/gu, "_")}`

    if (pageWriteMode === "patch" && item.action === "update" && existingContent) {
      try {
        const patchPrompt = buildPagePatchPrompt({ prepared, item, existingContent, analysis, nowTs })
        const patchRaw = await requestText({
          stage: "file-patch",
          prompt: patchPrompt,
          instructions: "You are an application-grade trading wiki page patcher. Return exactly one JSON fenced block containing section patch operations.",
        })
        await fs.writeFile(path.join(filesDir, `patch-${artifactName}`), patchRaw, "utf8")
        const patchOps = parseSectionPatchOpsFromModelText(patchRaw)
        const resolved = resolvePagePatchContent({ existingContent, patchOps, nowTs })
        if (resolved.fatalIssues.length > 0) {
          throw new Error(resolved.fatalIssues.map((issue) => `${issue.op}${issue.anchor ? ` @${issue.anchor}` : ""}: ${issue.message}`).join("; "))
        }
        await fs.writeFile(path.join(filesDir, artifactName), renderFileBlockArtifact(item.path, resolved.content), "utf8")
        pagePatchStats.patchedPages += 1
        return { action: item.action, path: item.path, content: resolved.content }
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err)
        pagePatchStats.fallbacks.push({ path: item.path, reason })
        options.onProgress?.(`Section patch fallback to full page for ${item.path}: ${reason}`)
      }
    }

    const prompt = buildPageFilePrompt({
      prepared,
      item,
      existingContent,
      analysis,
      sourceBaseName,
      nowTs,
    })
    const raw = await requestText({
      stage: "file",
      prompt,
      instructions: "You are an application-grade trading wiki page writer. Return exactly one FILE block.",
    })
    const blocks = parseFileBlocks(raw)
    const block = blocks.find((candidate) => candidate.path === item.path) ?? blocks[0]
    if (!block) throw new Error(`Stage 3 returned no FILE block for ${item.path}`)
    if (block.path !== item.path) {
      throw new Error(`Stage 3 returned FILE path ${block.path}, expected ${item.path}`)
    }
    await fs.writeFile(path.join(filesDir, artifactName), raw, "utf8")
    pagePatchStats.fullPages += 1
    return { action: item.action, path: item.path, content: block.content }
  })
  const indexedPageWrites = applySourceMainlineIndexToPageWrites(pageWrites, sourceBaseName, prepared.sourceMainlineIndex)

  const housekeeping = buildProgrammaticHousekeepingWrites({
    prepared,
    pageWrites: indexedPageWrites,
    sourceBaseName,
    nowTs,
  })
  await fs.writeFile(path.join(filesDir, "999-housekeeping.md"), housekeeping.artifact, "utf8")
  const housekeepingWrites = housekeeping.writes

  const manifest = {
    ...prepared.manifestTemplate,
    generatedBy: `codex-ingest api-run staged (${provider})`,
    provider,
    pageWriteMode,
    pagePatch: pagePatchStats,
    stages: {
      analysis: projectRelative(prepared.projectPath, analysisPath),
      plan: projectRelative(prepared.projectPath, planJsonPath),
      planBudget: projectRelative(prepared.projectPath, planBudgetPath),
      files: projectRelative(prepared.projectPath, filesDir),
    },
    planBudget,
    plan,
    conceptRouting: plan.conceptRouting ?? [],
    sourceArchivePath: sourceArchivePath(sourceBaseName),
    sourceMainlineIndex: prepared.sourceMainlineIndex,
    sourceSharding: prepared.sourceSharding ? {
      enabled: prepared.sourceSharding.enabled,
      mode: prepared.sourceSharding.mode,
      reason: prepared.sourceSharding.reason,
      retentionMode: prepared.sourceSharding.retentionMode,
      maxShardChars: prepared.sourceSharding.maxShardChars,
      shardConcurrency: prepared.sourceSharding.shardConcurrency,
      warnings: prepared.sourceSharding.warnings,
      counts: {
        windows: prepared.sourceMainlineIndex?.counts?.windows ?? 0,
        mainlines: prepared.sourceMainlineIndex?.counts?.mainlines ?? 0,
        shards: prepared.sourceSharding.shards?.length ?? 0,
      },
    } : null,
    factWrites: plan.factWrites ?? [],
    judgmentWrites: plan.judgmentWrites ?? [],
    writes: [...indexedPageWrites, ...housekeepingWrites],
  }
  const manifestPath = path.join(prepared.reportDir, "changes.json")
  await writeJson(manifestPath, manifest)
  const coverageReview = buildSourceCoverageReview(prepared.sourceMainlineIndex, indexedPageWrites)
  await writeJson(path.join(prepared.reportDir, "source-coverage-review.json"), coverageReview)
  await fs.writeFile(path.join(prepared.reportDir, "source-coverage-review.md"), sourceCoverageReviewMarkdown(coverageReview), "utf8")
  const dryRunReport = await applyManifest({ manifestPath, write: false })
  return { ...prepared, shardAnalyses, analysisPath, planMarkdownPath, planJsonPath, planBudgetPath, filesDir, planBudget, plan, pageWriteMode, pagePatchStats, coverageReview, manifestPath, modelText: analysis, dryRunReport }
}

export async function finalizeStagedIngest(options) {
  const reportDir = normalizePath(options.reportDir)
  const manifestTemplatePath = path.join(reportDir, "changes.template.json")
  const manifestTemplate = JSON.parse(await fs.readFile(manifestTemplatePath, "utf8"))
  const projectPath = normalizePath(options.projectPath ?? manifestTemplate.projectPath ?? DEFAULT_PROJECT_PATH)
  const sourcePath = normalizePath(manifestTemplate.sourcePath)
  const sourceBaseName = path.basename(sourcePath).replace(/\.[^.]+$/, "")
  const provider = options.provider ?? "codex"
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY
  const model = options.model ?? (provider === "openai" ? process.env.OPENAI_MODEL : process.env.CODEX_MODEL)

  if (!["openai", "codex"].includes(provider)) throw new Error(`Unsupported provider: ${provider}`)
  if (provider === "openai" && !apiKey) throw new Error("Missing OpenAI API key. Pass --api-key or set OPENAI_API_KEY, or use --provider codex.")
  if (provider === "openai" && !model) throw new Error("Missing model. Pass --model or set OPENAI_MODEL.")

  const createdAt = manifestTemplate.createdAt ?? nowLocalTimestamp()
  const dailyLogPath = dailyLogPathFromTimestamp(createdAt)
  const fullSourceContent = await fs.readFile(sourcePath, "utf8")
  const sourceRelativePath = manifestTemplate.sourceRelativePath ?? projectRelative(projectPath, sourcePath)
  let sourceMainlineIndex
  try {
    sourceMainlineIndex = JSON.parse(await fs.readFile(path.join(reportDir, "source-mainline-index.json"), "utf8"))
  } catch {
    sourceMainlineIndex = extractWechatMainlineIndex(fullSourceContent, sourcePath, sourceRelativePath)
    await writeJson(path.join(reportDir, "source-mainline-index.json"), sourceMainlineIndex)
  }
  const prepared = {
    projectPath,
    sourcePath,
    sourceRelativePath,
    sourceHash: manifestTemplate.sourceHash,
    createdAt,
    sourceContent: compactSourceContentForPrompt(fullSourceContent, sourcePath, manifestTemplate.sourceHash),
    sourceMainlineIndex,
    schema: await readIfExists(path.join(projectPath, "schema.md")),
    purpose: await readIfExists(path.join(projectPath, "purpose.md")),
    index: await readIfExists(path.join(projectPath, "wiki/index.md")),
    overview: await readIfExists(path.join(projectPath, "wiki/overview.md")),
    log: await readIfExists(path.join(projectPath, "wiki/log.md")),
    dailyLogPath,
    dailyLog: await readIfExists(path.join(projectPath, dailyLogPath)),
    manifestTemplate: { ...manifestTemplate, projectPath, sourcePath },
  }

  const analysisPath = path.join(reportDir, "analysis.md")
  const planJsonPath = path.join(reportDir, "plan.json")
  const filesDir = path.join(reportDir, "files")
  const codexOutputsDir = path.join(reportDir, "codex-outputs")
  const analysis = await fs.readFile(analysisPath, "utf8")
  let plan
  try {
    plan = JSON.parse(await fs.readFile(planJsonPath, "utf8"))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`Cannot finalize because plan.json is missing or unreadable at ${planJsonPath}. Re-run api-run for this source before finalize. ${message}`)
  }

  const blocksByPath = new Map()
  const fileArtifacts = (await listFilesRecursive(filesDir, { extensions: new Set([".md"]) })).filter(
    (filePath) => path.basename(filePath) !== "999-housekeeping.md",
  )
  for (const filePath of fileArtifacts.sort()) {
    const raw = await fs.readFile(filePath, "utf8")
    for (const block of parseFileBlocks(raw)) {
      if (!blocksByPath.has(block.path)) blocksByPath.set(block.path, block)
    }
  }

  const items = planItemsInGenerationOrder(plan, sourceBaseName)
  const pageWrites = items.map((item) => {
    const block = blocksByPath.get(item.path)
    if (!block) throw new Error(`Missing generated FILE block for ${item.path}`)
    return { action: item.action, path: item.path, content: block.content }
  })
  const indexedPageWrites = applySourceMainlineIndexToPageWrites(pageWrites, sourceBaseName, sourceMainlineIndex)

  const housekeepingPath = path.join(filesDir, "999-housekeeping.md")
  const housekeeping = buildProgrammaticHousekeepingWrites({
    prepared,
    pageWrites: indexedPageWrites,
    sourceBaseName,
    nowTs: prepared.createdAt,
  })
  await fs.writeFile(housekeepingPath, housekeeping.artifact, "utf8")
  const housekeepingWrites = housekeeping.writes

  const manifest = {
    ...prepared.manifestTemplate,
    generatedBy: `codex-ingest finalize staged (${provider})`,
    provider,
    stages: {
      analysis: projectRelative(projectPath, analysisPath),
      plan: projectRelative(projectPath, planJsonPath),
      files: projectRelative(projectPath, filesDir),
    },
    plan,
    conceptRouting: plan.conceptRouting ?? [],
    sourceArchivePath: sourceArchivePath(sourceBaseName),
    sourceMainlineIndex,
    factWrites: plan.factWrites ?? [],
    judgmentWrites: plan.judgmentWrites ?? [],
    writes: [...indexedPageWrites, ...housekeepingWrites],
  }
  const manifestPath = path.join(reportDir, "changes.json")
  await writeJson(manifestPath, manifest)
  const coverageReview = buildSourceCoverageReview(sourceMainlineIndex, indexedPageWrites)
  await writeJson(path.join(reportDir, "source-coverage-review.json"), coverageReview)
  await fs.writeFile(path.join(reportDir, "source-coverage-review.md"), sourceCoverageReviewMarkdown(coverageReview), "utf8")
  const dryRunReport = await applyManifest({ manifestPath, write: false })
  return { reportDir, filesDir, plan, coverageReview, manifestPath, dryRunReport }
}

export const BATCH_INGEST_ROOT = ".llm-wiki/codex-ingest-batches"

export function normalizeBatchSources(sources) {
  if (Array.isArray(sources)) return sources.map((item) => normalizePath(item)).filter(Boolean)
  return String(sources ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => normalizePath(item))
}

export function mergeExpectedTargetHashes(initialTargets = [], refreshedTargets = []) {
  const refreshedByPath = new Map(refreshedTargets.map((item) => [item.path, item]))
  const merged = []
  const seen = new Set()
  for (const target of initialTargets) {
    const refreshed = refreshedByPath.get(target.path)
    const chosen = refreshed?.classification === "housekeeping" ? refreshed : target
    merged.push(chosen)
    seen.add(chosen.path)
  }
  for (const target of refreshedTargets) {
    if (!seen.has(target.path)) merged.push(target)
  }
  return merged
}

export function batchTaskCounts(tasks = []) {
  const counts = {}
  for (const task of tasks) counts[task.status] = (counts[task.status] ?? 0) + 1
  return counts
}

export function batchStatusFromTasks(tasks = [], write = false) {
  if (tasks.some((task) => task.status === "failed" || task.status === "blocked")) return "needs_attention"
  const doneStatus = write ? "applied" : "dry-run-ready"
  return tasks.every((task) => task.status === doneStatus) ? "ok" : "running"
}

export async function writeWikiChangeReview(reportDir) {
  const reportPath = path.join(reportDir, await exists(path.join(reportDir, "apply-report.json")) ? "apply-report.json" : "apply-dry-run.json")
  if (!await exists(reportPath) || !await exists(path.join(reportDir, "changes.json"))) return null
  const report = JSON.parse(await readTextFile(reportPath))
  const manifest = JSON.parse(await readTextFile(path.join(reportDir, "changes.json")))
  const writes = new Map((manifest.writes ?? []).map((w) => [w.path, w]))
  const paths = report.written?.length ? report.written : (report.diffs ?? []).map((d) => d.path)
  const groups = new Map()
  for (const p of paths) {
    const cluster = p === "wiki/index.md" || p === "wiki/overview.md"
      ? "housekeeping"
      : (p.match(/^wiki\/([^/]+)\//)?.[1] ?? "other")
    if (!groups.has(cluster)) groups.set(cluster, [])
    groups.get(cluster).push(p)
  }
  const titleOf = (content, filePath) => {
    const title = content.match(/\ntitle:\s*(.+?)\n/)
    if (title) return title[1].replace(/^['"]|['"]$/g, "")
    const heading = content.match(/^#\s+(.+)$/m)
    return heading ? heading[1] : path.basename(filePath, ".md")
  }
  const summaryOf = (content) => {
    const summary = content.match(/\nsummary:\s*(.+?)(?:\n\S|\n[a-zA-Z_]+:|\n---)/s)
    return summary ? summary[1].replace(/\n\s+/g, " ").replace(/^['"]|['"]$/g, "").trim() : ""
  }
  const out = [
    "# Wiki Change Review",
    "",
    `- Report: \`${reportDir}\``,
    `- Mode: ${report.dryRun ? "dry-run / planned" : "written"}`,
    `- Files: ${paths.length}`,
    `- Source hash: \`${report.sourceHashBefore ?? ""}\` -> \`${report.sourceHashAfter ?? ""}\``,
    `- raw written: ${paths.some((p) => p.startsWith("raw/")) ? "yes" : "no"}`,
    `- legacy wiki/log.md written: ${paths.includes("wiki/log.md") ? "yes" : "no"}`,
    `- facts planned: ${(manifest.factWrites ?? []).length}`,
    `- facts written: ${report.factsWritten?.length ?? 0}`,
    `- duplicate facts: ${(report.duplicateFacts ?? []).length}`,
    `- superseded facts: ${(report.supersededFacts ?? []).length}`,
    `- invalidated facts: ${(report.invalidatedFacts ?? []).length}`,
    `- judgments planned: ${(manifest.judgmentWrites ?? []).length}`,
    `- judgments written: ${report.judgmentsWritten?.length ?? 0}`,
    `- duplicate judgments: ${(report.duplicateJudgments ?? []).length}`,
    "",
    "## Groups",
  ]
  for (const [cluster, ps] of groups) out.push(`- ${cluster}: ${ps.length}`)
  out.push("", "## Created Files")
  for (const d of (report.diffs ?? []).filter((d) => d.action === "create")) out.push(`- \`${d.path}\``)
  out.push("", "## Detailed Files")
  for (const [cluster, ps] of groups) {
    out.push("", `### ${cluster}`)
    for (const p of ps) {
      const w = writes.get(p)
      const content = String(w?.content ?? "")
      const lines = content ? content.split(/\r?\n/).length : 0
      const summary = summaryOf(content)
      out.push(`- \`${p}\` (${w?.action ?? "unknown"}, ${lines} lines) - ${titleOf(content, p)}${summary ? `: ${summary}` : ""}`)
    }
  }
  out.push("", "## Recommended Review Focus")
  out.push("- Source archive page under `wiki/sources/`.")
  out.push("- Market-stage, strategy, fact-strength, and error pages touched by this ingest.")
  out.push("- `wiki/index.md` and `wiki/overview.md` for incremental merge quality.")
  out.push("- Daily log under `wiki/logs/`.")
  const reviewPath = path.join(reportDir, "wiki-change-review.md")
  await fs.writeFile(reviewPath, `${out.join("\n")}\n`, "utf8")
  return reviewPath
}

export function batchSummaryMarkdown(batch) {
  const lines = [
    "# Batch Ingest Summary",
    "",
    `- Batch: \`${batch.batchId}\``,
    `- Status: ${batch.status}`,
    `- Write: ${batch.write ? "yes" : "no"}`,
    `- API concurrency: ${batch.apiConcurrency}`,
    `- Write concurrency: ${batch.writeConcurrency}`,
    "",
    "## Counts",
  ]
  for (const [status, count] of Object.entries(batch.counts ?? {})) lines.push(`- ${status}: ${count}`)
  lines.push("", "## Sources")
  for (const task of batch.tasks ?? []) {
    lines.push(`- ${task.status}: \`${task.sourcePath}\`${task.reportDir ? ` -> \`${task.reportDir}\`` : ""}${task.rerunCount ? ` (rerun ${task.rerunCount})` : ""}`)
    if (task.error) lines.push(`  - error: ${task.error}`)
    if (task.conflicts?.length) lines.push(`  - conflicts: ${task.conflicts.map((c) => `${c.path}:${c.reason}`).join(", ")}`)
    if (task.nextCommand) lines.push(`  - next: \`${task.nextCommand}\``)
  }
  return `${lines.join("\n")}\n`
}

async function writeBatchState(batch) {
  batch.counts = batchTaskCounts(batch.tasks)
  batch.status = batchStatusFromTasks(batch.tasks, batch.write)
  await writeJson(path.join(batch.batchDir, "batch-manifest.json"), batch)
  await fs.writeFile(path.join(batch.batchDir, "batch-summary.md"), batchSummaryMarkdown(batch), "utf8")
}

async function runBatchApiTask(task, batch, runOptions, apiRunImpl) {
  task.status = "api-running"
  await writeBatchState(batch)
  try {
    const result = await apiRunImpl({
      ...runOptions,
      sourcePath: task.sourcePath,
      pageConcurrency: runOptions.pageConcurrency ?? 2,
      shardConcurrency: runOptions.shardConcurrency ?? 2,
    })
    task.reportDir = result.reportDir ?? path.dirname(result.manifestPath)
    task.manifestPath = result.manifestPath
    task.dryRunReportPath = result.dryRunReport?.reportPath ?? path.join(task.reportDir, "apply-dry-run.json")
    const manifest = JSON.parse(await readTextFile(task.manifestPath))
    task.targetHashes = await collectManifestTargetHashes(batch.projectPath, manifest)
    await writeJson(path.join(task.reportDir, "batch-targets.json"), task.targetHashes)
    task.conflicts = await checkManifestTargetConflicts(batch.projectPath, manifest, task.targetHashes)
    task.status = !batch.write && task.conflicts.length > 0 ? "blocked" : batch.write ? "write-waiting" : "dry-run-ready"
  } catch (err) {
    task.status = "failed"
    task.error = err instanceof Error ? err.message : String(err)
  }
  await writeBatchState(batch)
  return task
}

async function applyBatchTask(task, batch, runOptions, implementations) {
  const { apiRunImpl, finalizeImpl, applyImpl } = implementations
  try {
    task.status = "finalizing"
    await writeBatchState(batch)
    const finalized = await finalizeImpl({
      ...runOptions,
      reportDir: task.reportDir,
    })
    task.manifestPath = finalized.manifestPath ?? task.manifestPath
    task.dryRunReportPath = finalized.dryRunReport?.reportPath ?? path.join(task.reportDir, "apply-dry-run.json")

    task.status = "conflict-checking"
    await writeBatchState(batch)
    const manifest = JSON.parse(await readTextFile(task.manifestPath))
    const refreshedTargets = await collectManifestTargetHashes(batch.projectPath, manifest)
    const expectedTargetHashes = mergeExpectedTargetHashes(task.targetHashes, refreshedTargets)
    const conflicts = await checkManifestTargetConflicts(batch.projectPath, manifest, expectedTargetHashes)
    task.conflicts = conflicts
    const hasCoreConflict = conflicts.some((item) => item.classification === "core" || item.classification === "facts")
    if (hasCoreConflict && batch.conflictPolicy === "rerun-core-overlap" && (task.rerunCount ?? 0) < 1) {
      task.rerunCount = (task.rerunCount ?? 0) + 1
      task.status = "api-running"
      await writeBatchState(batch)
      const rerun = await apiRunImpl({
        ...runOptions,
        sourcePath: task.sourcePath,
        pageConcurrency: runOptions.pageConcurrency ?? 2,
        shardConcurrency: runOptions.shardConcurrency ?? 2,
      })
      task.reportDir = rerun.reportDir ?? path.dirname(rerun.manifestPath)
      task.manifestPath = rerun.manifestPath
      task.dryRunReportPath = rerun.dryRunReport?.reportPath ?? path.join(task.reportDir, "apply-dry-run.json")
      const rerunManifest = JSON.parse(await readTextFile(task.manifestPath))
      task.targetHashes = await collectManifestTargetHashes(batch.projectPath, rerunManifest)
      await writeJson(path.join(task.reportDir, "batch-targets.json"), task.targetHashes)
      return applyBatchTask(task, batch, runOptions, implementations)
    }
    if (conflicts.length > 0) {
      task.status = "blocked"
      task.nextCommand = `npm run codex:ingest -- api-run --provider ${batch.provider} --source "${task.sourcePath}" --project "${batch.projectPath}"`
      await writeBatchState(batch)
      return task
    }

    task.status = "applying"
    await writeBatchState(batch)
    const applied = await applyImpl({
      manifestPath: task.manifestPath,
      projectPath: batch.projectPath,
      write: true,
      expectedTargetHashes,
    })
    task.applyReportPath = applied.reportPath
    task.reviewPath = await writeWikiChangeReview(task.reportDir)
    task.status = "applied"
  } catch (err) {
    task.status = "failed"
    task.error = err instanceof Error ? err.message : String(err)
  }
  await writeBatchState(batch)
  return task
}

export async function runBatchIngest(options) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const sourcePaths = normalizeBatchSources(options.sources ?? options.sourcePaths)
  if (sourcePaths.length === 0) throw new Error("batch-run requires at least one source via --sources")
  const writeConcurrency = parsePositiveInteger(options.writeConcurrency, 1)
  if (writeConcurrency !== 1) throw new Error("--write-concurrency is fixed at 1 for live wiki safety.")
  const provider = options.provider ?? "codex"
  const apiConcurrency = parsePositiveInteger(options.apiConcurrency, 2)
  const batchId = options.batchId ?? makeReportId("batch-run")
  const batchDir = path.join(projectPath, BATCH_INGEST_ROOT, batchId)
  await ensureDirectory(batchDir)
  const batch = {
    schema: "codex-ingest-batch-v1",
    batchId,
    batchDir,
    createdAt: nowLocalTimestamp(),
    projectPath,
    provider,
    write: Boolean(options.write),
    apiConcurrency,
    writeConcurrency: 1,
    pageConcurrency: parsePositiveInteger(options.pageConcurrency, 2),
    shardConcurrency: parsePositiveInteger(options.shardConcurrency, 2),
    conflictPolicy: options.conflictPolicy ?? "rerun-core-overlap",
    status: "running",
    counts: {},
    tasks: sourcePaths.map((sourcePath, index) => ({
      id: `source-${String(index + 1).padStart(3, "0")}`,
      index,
      sourcePath,
      status: "queued",
      rerunCount: 0,
    })),
  }
  await writeBatchState(batch)

  const runOptions = {
    projectPath,
    schemaPath: options.schemaPath,
    provider,
    model: options.model,
    apiKey: options.apiKey,
    endpoint: options.endpoint,
    reasoningEffort: options.reasoningEffort,
    codexBin: options.codexBin,
    codexProfile: options.codexProfile,
    codexProfileV2: options.codexProfileV2,
    codexTimeoutMs: options.codexTimeoutMs,
    pageConcurrency: batch.pageConcurrency,
    pageWriteMode: options.pageWriteMode,
    judgments: options.judgments,
    embeddingRouting: options.embeddingRouting,
    embeddingApiKey: options.embeddingApiKey,
    embeddingModel: options.embeddingModel,
    embeddingEndpoint: options.embeddingEndpoint,
    maxPlanItems: options.maxPlanItems,
    maxCreatePages: options.maxCreatePages,
    maxUpdatePages: options.maxUpdatePages,
    sourceSharding: options.sourceSharding,
    shardConcurrency: batch.shardConcurrency,
    maxShardChars: options.maxShardChars,
    sourceRetention: options.sourceRetention,
    requestText: options.requestText,
    onProgress: options.onProgress,
  }
  const apiRunImpl = options.apiRunImpl ?? apiRunIngest
  const finalizeImpl = options.finalizeImpl ?? finalizeStagedIngest
  const applyImpl = options.applyImpl ?? applyManifest

  await mapWithConcurrency(batch.tasks, apiConcurrency, (task) => runBatchApiTask(task, batch, runOptions, apiRunImpl))
  if (batch.write) {
    for (const task of batch.tasks) {
      if (task.status === "failed") continue
      await applyBatchTask(task, batch, runOptions, { apiRunImpl, finalizeImpl, applyImpl })
    }
  }
  await writeBatchState(batch)
  return batch
}
