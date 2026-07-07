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
  ASK_TIME_TOKENS,
  CONCEPT_CANONICAL_RULINGS_SCHEMA,
  CONCEPT_GOVERNANCE_ROOT,
  CONFIDENCE,
  DEFAULT_CONCEPT_RULINGS_PATH,
  DEFAULT_PROJECT_PATH,
  DEFAULT_SOURCE_SHARD_CONCURRENCY,
  DEFAULT_SOURCE_SHARD_MAX_CHARS,
  EVIDENCE_QUERY_TOKENS,
  GENERIC_QUERY_TOKENS,
  INGEST_GENERIC_SOURCE_TOKENS,
  INGEST_IMPORTANT_PHRASE_REGEX,
  INGEST_SEGMENT_DEFAULT_MAX,
  INGEST_SEGMENT_RAW_LIMIT,
  INGEST_SEGMENT_WIKI_LIMIT,
  INGEST_SOURCE_FIELD_TOKENS,
  INGEST_UPPERCASE_KEEP_TOKENS,
  METHODOLOGY_CONTEXT_PATHS,
  METHODOLOGY_CONTEXT_TOTAL_CHAR_SOFT_LIMIT,
  METHODOLOGY_IMPORTANT_LINE_REGEX,
  METHODOLOGY_PAGE_CHAR_SOFT_LIMIT,
  METHODOLOGY_STAGE3_RULE_CHAR_SOFT_LIMIT,
  PAGE_BODY_LINE_SOFT_LIMIT,
  REPORT_ROOT,
  RETRIEVAL_MODES,
  SOURCE_PROMPT_CHAR_SOFT_LIMIT,
  STATUS_ALIASES,
  STOCK_CODE_REGEX,
  STOP_WORDS,
  SUMMARY_MAX,
  SUMMARY_MIN,
  TEMPORAL_FACTS_RELATIVE_PATH,
  TEMPORAL_FACT_EVIDENCE_LEVELS,
  TEMPORAL_FACT_INDEX_RELATIVE_PATH,
  TEMPORAL_FACT_PREDICATES,
  TEMPORAL_FACT_SOURCE_KINDS,
  TEMPORAL_FACT_STATUSES,
  TEXT_EXTENSIONS,
  TIMESTAMP_REGEX,
  TYPE_ALIASES,
  WIKILINK_REGEX,
  WIKI_STATUS,
  WIKI_TYPES,
  assertSafeWikiPath,
  ensureDirectory,
  exists,
  filterRawFilesByQueryPolicy,
  isObjectRecord,
  isReservedWikiPath,
  jsonLineSearchText,
  listFilesRecursive,
  normalizePath,
  normalizeRetrievalMode,
  normalizeStockCode,
  nowLocalTimestamp,
  parsePositiveInteger,
  pathMetric,
  pathSizeBytes,
  projectRelative,
  readIfExists,
  readJsonlFile,
  readTextFile,
  shortHash,
  stableJsonString,
  stockCodeAlternatives,
  toPosixPath,
  writeJson,
} from "./core.mjs"

export function truncateAtBoundary(text, maxChars) {
  if (text.length <= maxChars) return text
  const slice = text.slice(0, maxChars)
  const boundary = Math.max(slice.lastIndexOf("\n- "), slice.lastIndexOf("\n## "), slice.lastIndexOf("\n【"))
  return `${slice.slice(0, boundary > maxChars * 0.55 ? boundary : maxChars).trimEnd()}\n...（本段因超大源文档做 prompt 压缩，完整证据见原始 raw 文件）`
}

export function isWechatSentimentSourcePath(sourceRelativePath) {
  return /^raw\/微信聊天\//.test(toPosixPath(String(sourceRelativePath ?? "")))
}

export function parseWechatUpdateWindows(sourceContent) {
  const normalized = String(sourceContent ?? "").replace(/\r\n/g, "\n")
  const regex = /^##\s+((?:\d{4}-\d{2}-\d{2}\s+)?\d{2}:\d{2}(?::\d{2})?)\s+舆情更新\s*$/gm
  const matches = []
  let match
  while ((match = regex.exec(normalized)) !== null) {
    matches.push({
      index: match.index,
      heading: match[0],
      windowTime: match[1].trim(),
    })
  }
  const firstWindowOffset = matches[0]?.index ?? -1
  const header = firstWindowOffset >= 0 ? normalized.slice(0, firstWindowOffset).trimEnd() : normalized
  const windows = matches.map((item, index) => {
    const endOffset = matches[index + 1]?.index ?? normalized.length
    return {
      id: `window-${String(index + 1).padStart(2, "0")}`,
      index,
      windowTime: item.windowTime,
      heading: item.heading,
      startOffset: item.index,
      endOffset,
      lineStart: lineNumberAtOffset(normalized, item.index),
      lineEnd: lineNumberAtOffset(normalized, Math.max(item.index, endOffset - 1)),
      text: normalized.slice(item.index, endOffset).trimEnd(),
    }
  })
  return {
    header,
    windows,
    warnings: windows.length ? [] : ["No WeChat sentiment update windows matched `## HH:mm:ss 舆情更新` or `## YYYY-MM-DD HH:mm:ss 舆情更新`."],
  }
}

export function mainlineTokens(label) {
  return [...new Set(String(label ?? "")
    .split(/[\/／、+，,（）()\s｜|：:；;“”"'`*#\[\]{}<>]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2)
    .slice(0, 12))]
}

const MAINLINE_FIELD_KEYS = [
  "主线",
  "热度",
  "命中群",
  "原文数",
  "发酵/异动",
  "核心标的",
  "弹性/预期差",
  "上游/配套",
  "催化",
  "待验证",
  "代表来源",
]

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function isMainlineContinuationField(line) {
  const keyAlternation = MAINLINE_FIELD_KEYS.map(escapeRegExp).join("|")
  return new RegExp(`^(?:${keyAlternation})\\s*[：:｜|]`).test(String(line ?? "").trim())
}

function readMainlineField(body, key) {
  const keyAlternation = MAINLINE_FIELD_KEYS.map(escapeRegExp).join("|")
  const re = new RegExp(`(?:^|[；;｜|\\n])\\s*${escapeRegExp(key)}\\s*[：:｜|]\\s*([\\s\\S]*?)(?=\\s*[；;｜|\\n]\\s*(?:${keyAlternation})\\s*[：:｜|]|$)`)
  return body.match(re)?.[1]?.trim() ?? ""
}

export function parseMainlineRow(rawLine) {
  const body = String(rawLine ?? "").replace(/^-\s*/, "").trim()
  const columns = body.split(/\s*[｜|]\s*/).map((item) => item.trim())
  const label = columns[0] ?? ""
  if (!label) return null
  return {
    label,
    heat: columns[1] ?? "",
    groups: columns[2] ?? "",
    sourceCount: columns[3] ?? "",
    raw: body,
    normalizedTokens: mainlineTokens(label),
  }
}

export function parseNumberedMainlineTitle(rawLine) {
  const blockLines = String(rawLine ?? "")
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const numbered = (blockLines[0] ?? "").match(/^\d+[\.)、]\s+(.+)$/)
  if (!numbered) return null
  const body = [numbered[1], ...blockLines.slice(1)].join("\n")
    .replace(/^\*\*/, "")
    .replace(/\*\*\s*$/, "")
    .trim()
  const keyed = {
    label: readMainlineField(body, "主线"),
    heat: readMainlineField(body, "热度"),
    groups: readMainlineField(body, "命中群"),
    sourceCount: readMainlineField(body, "原文数"),
  }
  if (!keyed.label && (keyed.heat || keyed.groups || keyed.sourceCount)) {
    keyed.label = body.match(/^(.*?)(?=\s*[；;｜|]\s*热度\s*[：:｜|])/)?.[1]?.trim() ?? ""
  }
  if (keyed.label) {
    return {
      label: keyed.label,
      heat: keyed.heat,
      groups: keyed.groups,
      sourceCount: keyed.sourceCount,
      raw: body,
      normalizedTokens: mainlineTokens(keyed.label),
    }
  }
  const columns = body.split(/\s*[｜|]\s*/).map((item) => item.trim()).filter(Boolean)
  const label = columns[0] ?? ""
  if (!label) return null
  const row = {
    label,
    heat: "",
    groups: "",
    sourceCount: "",
    raw: body,
    normalizedTokens: mainlineTokens(label),
  }
  for (const column of columns.slice(1)) {
    const match = column.match(/^([^：:]+)[：:]\s*(.*)$/)
    if (!match) {
      if (!row.heat) row.heat = column
      continue
    }
    const key = match[1].trim()
    const value = match[2].trim()
    if (key === "热度") row.heat = value
    else if (key === "命中群") row.groups = value
    else if (key === "原文数") row.sourceCount = value
  }
  return row
}

export function extractWechatMainlineIndex(sourceContent, sourcePath = "", sourceRelativePath = "") {
  const parsed = parseWechatUpdateWindows(sourceContent)
  const items = []
  for (const window of parsed.windows) {
    const lines = window.text.split("\n")
    let mainlineSection = ""
    let sawRows = false
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (/^###\s*主线归因\s*$/.test(line.trim())) {
        mainlineSection = "table"
        sawRows = false
        continue
      }
      if (/^###\s*【?重点板块\s*\/\s*标的】?\s*$/.test(line.trim())) {
        mainlineSection = "numbered"
        sawRows = false
        continue
      }
      if (!mainlineSection) continue
      const trimmed = line.trim()
      if (/^###\s+/.test(trimmed) || /^##\s+/.test(trimmed)) break
      if (!trimmed && mainlineSection === "table") {
        if (sawRows) break
        continue
      }
      if (!trimmed) continue
      if (/^---+$/.test(trimmed) && sawRows && mainlineSection === "table") break
      if (/^主线\s*[｜|]\s*热度/.test(trimmed)) continue
      let parsedRow = null
      const lineStart = window.lineStart + i
      let lineEnd = window.lineStart + i
      if (mainlineSection === "numbered") {
        if (/^\d+[\.)、]\s+/.test(trimmed)) {
          const blockLines = [trimmed]
          let j = i + 1
          for (; j < lines.length; j++) {
            const nextTrimmed = lines[j].trim()
            if (/^###\s+/.test(nextTrimmed) || /^##\s+/.test(nextTrimmed) || /^\d+[\.)、]\s+/.test(nextTrimmed)) break
            if (isMainlineContinuationField(nextTrimmed)) blockLines.push(nextTrimmed)
          }
          parsedRow = parseNumberedMainlineTitle(blockLines.join("\n"))
          lineEnd = window.lineStart + Math.max(i, j - 1)
          i = j - 1
        }
      } else if (/^- /.test(trimmed)) {
        parsedRow = parseMainlineRow(trimmed)
      }
      if (!parsedRow) continue
      sawRows = true
      items.push({
        id: `mainline-${String(items.length + 1).padStart(3, "0")}`,
        windowId: window.id,
        windowTime: window.windowTime,
        label: parsedRow.label,
        heat: parsedRow.heat,
        groups: parsedRow.groups,
        sourceCount: parsedRow.sourceCount,
        lineStart,
        lineEnd,
        raw: parsedRow.raw,
        normalizedTokens: parsedRow.normalizedTokens,
      })
    }
  }
  return {
    version: 1,
    sourcePath,
    sourceRelativePath,
    windows: parsed.windows.map((window) => ({
      id: window.id,
      windowTime: window.windowTime,
      lineStart: window.lineStart,
      lineEnd: window.lineEnd,
    })),
    counts: {
      windows: parsed.windows.length,
      mainlines: items.length,
    },
    warnings: parsed.warnings,
    items,
  }
}

export function emptySourceMainlineIndex(sourcePath = "", sourceRelativePath = "") {
  return {
    version: 1,
    sourcePath,
    sourceRelativePath,
    windows: [],
    counts: { windows: 0, mainlines: 0 },
    warnings: [],
    items: [],
  }
}

export function resolveSourceShardingMode(value) {
  const mode = String(value ?? "auto").trim().toLowerCase()
  if (["auto", "off", "force"].includes(mode)) return mode
  throw new Error(`Invalid --source-sharding value: ${value}. Use auto, off, or force.`)
}

export function normalizeSourceRetention(value) {
  const mode = String(value ?? "mainline-index").trim().toLowerCase()
  if (["mainline-index", "index-with-excerpts"].includes(mode)) return mode
  throw new Error(`Invalid --source-retention value: ${value}. Use mainline-index or index-with-excerpts.`)
}

export function buildShardPromptText({ sourcePath, sourceRelativePath, sourceHash, shard, totalShards, mainlineIndex, retentionMode }) {
  const includedWindowIds = new Set(shard.windows.map((window) => window.id))
  const indexRows = mainlineIndex.items
    .filter((item) => includedWindowIds.has(item.windowId))
    .map((item) => `- ${item.windowTime} lines ${item.lineStart}-${item.lineEnd}: ${item.label}${item.heat ? ` | ${item.heat}` : ""}${item.groups ? ` | ${item.groups}` : ""}${item.sourceCount ? ` | 原文数 ${item.sourceCount}` : ""}`)
    .join("\n")
  return [
    `# 微信舆情分片 ${shard.id} / ${totalShards}`,
    "",
    `- sourcePath: ${sourcePath}`,
    `- sourceRelativePath: ${sourceRelativePath}`,
    `- sourceHash: ${sourceHash}`,
    `- windows: ${shard.windows.map((window) => window.windowTime).join(", ")}`,
    `- raw lines: ${shard.lineStart}-${shard.lineEnd}`,
    `- source retention mode: ${retentionMode}`,
    "",
    "## 分片主线索引",
    indexRows || "- none",
    "",
    "## 分片原文",
    ...shard.windows.map((window) => window.text),
  ].join("\n")
}

export function buildWechatSourceShards({ sourceContent, sourcePath, sourceRelativePath, sourceHash, mainlineIndex, maxShardChars, retentionMode }) {
  const parsed = parseWechatUpdateWindows(sourceContent)
  if (!parsed.windows.length) return []
  const shards = []
  let current = []
  let currentChars = 0
  const effectiveMax = Math.max(8000, Number(maxShardChars) || DEFAULT_SOURCE_SHARD_MAX_CHARS)

  function flush() {
    if (!current.length) return
    const index = shards.length + 1
    const windows = current.map((window) => {
      if (window.text.length <= effectiveMax) return window
      const compacted = compactWechatSection(window.text, Math.max(2400, effectiveMax - 1600))
      return { ...window, text: compacted, compacted: true, originalChars: window.text.length }
    })
    const shard = {
      id: `shard-${String(index).padStart(2, "0")}`,
      index,
      windowIds: windows.map((window) => window.id),
      windowTimes: windows.map((window) => window.windowTime),
      lineStart: windows[0].lineStart,
      lineEnd: windows[windows.length - 1].lineEnd,
      chars: windows.reduce((sum, window) => sum + window.text.length, 0),
      compactedWindows: windows.filter((window) => window.compacted).map((window) => window.id),
      windows,
    }
    shards.push(shard)
    current = []
    currentChars = 0
  }

  for (const window of parsed.windows) {
    const windowChars = Math.max(1, window.text.length)
    if (current.length && currentChars + windowChars > effectiveMax) flush()
    current.push(window)
    currentChars += windowChars
    if (windowChars > effectiveMax) flush()
  }
  flush()

  return shards.map((shard) => ({
    ...shard,
    promptText: buildShardPromptText({
      sourcePath,
      sourceRelativePath,
      sourceHash,
      shard,
      totalShards: shards.length,
      mainlineIndex,
      retentionMode,
    }),
  }))
}

export function buildSourceShardingPlan({ sourceContent, sourcePath, sourceRelativePath, sourceHash, options = {} }) {
  const mode = resolveSourceShardingMode(options.sourceSharding)
  const retentionMode = normalizeSourceRetention(options.sourceRetention)
  const isWechat = isWechatSentimentSourcePath(sourceRelativePath)
  const mainlineIndex = isWechat || mode === "force"
    ? extractWechatMainlineIndex(sourceContent, sourcePath, sourceRelativePath)
    : emptySourceMainlineIndex(sourcePath, sourceRelativePath)
  const warnings = [...(mainlineIndex.warnings ?? [])]
  const maxShardChars = parsePositiveInteger(options.maxShardChars, DEFAULT_SOURCE_SHARD_MAX_CHARS)
  const shardConcurrency = parsePositiveInteger(options.shardConcurrency, DEFAULT_SOURCE_SHARD_CONCURRENCY)
  const eligible = mode === "force" || (mode === "auto" && isWechat && (sourceContent.length > SOURCE_PROMPT_CHAR_SOFT_LIMIT || mainlineIndex.counts.windows > 10))

  if (mode === "off") {
    return {
      enabled: false,
      mode,
      reason: "disabled_by_option",
      retentionMode,
      maxShardChars,
      shardConcurrency,
      warnings: [],
      mainlineIndex,
      shards: [],
    }
  }
  if (!eligible) {
    return {
      enabled: false,
      mode,
      reason: isWechat ? "below_threshold" : "not_wechat_sentiment_source",
      retentionMode,
      maxShardChars,
      shardConcurrency,
      warnings,
      mainlineIndex,
      shards: [],
    }
  }
  if (!mainlineIndex.counts.windows) {
    return {
      enabled: false,
      mode,
      reason: "no_parseable_wechat_windows",
      retentionMode,
      maxShardChars,
      shardConcurrency,
      warnings,
      mainlineIndex,
      shards: [],
    }
  }

  const shards = buildWechatSourceShards({
    sourceContent,
    sourcePath,
    sourceRelativePath,
    sourceHash,
    mainlineIndex,
    maxShardChars,
    retentionMode,
  })
  return {
    enabled: mode === "force" || shards.length > 1 || sourceContent.length > SOURCE_PROMPT_CHAR_SOFT_LIMIT,
    mode,
    reason: shards.length > 1 ? "large_wechat_source" : "single_shard",
    retentionMode,
    maxShardChars,
    shardConcurrency,
    warnings,
    mainlineIndex,
    shards,
  }
}

export function compactWechatSection(section, perSectionLimit) {
  const lines = section.split(/\r?\n/)
  const kept = []
  let skipOtherAttention = false
  let inCode = false
  let codeLines = 0

  for (const line of lines) {
    if (/^【其他关注】/.test(line)) {
      skipOtherAttention = true
      continue
    }
    if (/^【(?:市场情绪|重点板块\/标的|核心催化|完整调研原文)】/.test(line)) {
      skipOtherAttention = false
    }
    if (skipOtherAttention) {
      if (/^\s*原文：/.test(line) || /^\s*```/.test(line) || /^-\s*来源：/.test(line)) {
        skipOtherAttention = false
      } else if (/wx-cli|radar\.db|group_tags|local_id|chatroom|session|daemon|权限|last_success_at|stale|缺失核心群名|增量窗口/.test(line)) {
        continue
      }
    }

    if (/^\s*```/.test(line)) {
      inCode = !inCode
      codeLines = 0
      kept.push(line)
      continue
    }
    if (inCode) {
      codeLines += 1
      if (codeLines <= 45) kept.push(line.length > 900 ? excerptForPrompt(line, 900) : line)
      else if (codeLines === 46) kept.push("...（长原文节选，完整内容见 raw）")
      continue
    }
    if (/本半小时无显著新增舆情|本窗口内无新增可确认催化|本窗口内无新增完整调研类原文/.test(line)) continue
    kept.push(line)
  }

  return truncateAtBoundary(kept.join("\n").replace(/\n{3,}/g, "\n\n").trim(), perSectionLimit)
}

export function stripHtmlForPrompt(text) {
  return String(text ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|li|h\d|ul|ol)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim()
}

export function excerptForPrompt(text, maxChars) {
  const cleaned = stripHtmlForPrompt(text)
  if (cleaned.length <= maxChars) return cleaned
  if (maxChars <= 20) return `${cleaned.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`
  const budget = Math.max(1, maxChars - 3)
  const headChars = Math.max(1, Math.floor(budget * 0.62))
  const tailChars = Math.max(1, budget - headChars)
  return `${cleaned.slice(0, headChars).trimEnd()}...${cleaned.slice(-tailChars).trimStart()}`
}

export function extractSectionAfterHeading(text, heading, stopHeadingRegex = /\n###? /) {
  const start = text.indexOf(heading)
  if (start < 0) return ""
  const bodyStart = start + heading.length
  const rest = text.slice(bodyStart)
  const stop = rest.search(stopHeadingRegex)
  return (stop >= 0 ? rest.slice(0, stop) : rest).trim()
}

export function compactMeetingCluesContentForPrompt(sourceContent, sourcePath, sourceHash, maxChars) {
  const normalized = sourceContent.replace(/\r\n/g, "\n")
  const frontmatterMatch = normalized.match(/^---\n[\s\S]*?\n---\n/)
  const frontmatter = frontmatterMatch?.[0]?.trimEnd() ?? ""
  const overview = extractSectionAfterHeading(normalized, "## 今日概览")
  const detailStart = normalized.indexOf("\n## 明细")
  const details = detailStart >= 0 ? normalized.slice(detailStart) : normalized
  const records = details
    .split(/\n(?=### \d+\. )/)
    .map((s) => s.trim())
    .filter((s) => /^### \d+\. /.test(s))

  const overviewLimit = Math.min(Math.max(700, Math.floor(maxChars * 0.12)), 2400)
  const compactedOverview = overview ? excerptForPrompt(overview, overviewLimit) : "(missing 今日概览)"
  const intro = [
    frontmatter,
    "",
    "## 超大投研线索 prompt 压缩说明",
    "",
    `- 原始 sourcePath：${sourcePath}`,
    `- 原始 sourceHash：${sourceHash}`,
    `- 原始字符数：${sourceContent.length}`,
    `- 本段仅用于 Codex prompt：按每条 meeting clue 保留标题、发布时间、记录ID、主题/标的、detail_topic 和摘要/正文节选；manifest 和写入校验仍绑定原始 raw 文件。`,
    `- 保留记录数：${records.length}`,
    "",
    "## 今日概览",
    compactedOverview,
    "",
    "## 明细压缩版",
    "",
  ].join("\n")

  const buildRecord = (record, { excerptLimit, metaLimit, includePubTime, includeDetailTopic }) => {
    const lines = record.split("\n")
    const title = lines[0] ?? "### 记录"
    const pubTime = record.match(/^- 发布时间:\s*(.+)$/m)?.[1]?.trim()
    const recordId = record.match(/^- 记录 ID:\s*(.+)$/m)?.[1]?.trim()
    const topics = record.match(/^- 主题\/标的:\s*(.+)$/m)?.[1]?.trim()
    const detailTopic = record.match(/^- detail_topic:\s*([\s\S]*?)(?:\n\n#### |\n### |\n$)/)?.[1]?.trim()
    const aiSummary = extractSectionAfterHeading(record, "#### ai_summary", /\n#### |\n### /)
    const content = extractSectionAfterHeading(record, "#### content", /\n#### |\n### /)
    const preferred = aiSummary || content
    return [
      title,
      includePubTime && pubTime ? `- 发布时间: ${pubTime}` : "",
      recordId ? `- 记录 ID: ${recordId}` : "",
      topics ? `- 主题/标的: ${excerptForPrompt(topics, metaLimit)}` : "",
      includeDetailTopic && detailTopic && detailTopic !== "无"
        ? `- detail_topic: ${excerptForPrompt(detailTopic, Math.min(metaLimit, 220))}`
        : "",
      preferred ? `- 摘要/正文节选: ${excerptForPrompt(preferred, excerptLimit)}` : "",
    ]
      .filter(Boolean)
      .join("\n")
  }

  const buildCompacted = (options) => {
    const compactedRecords = records.map((record) => buildRecord(record, options))
    return `${intro}${compactedRecords.join("\n\n")}`
  }

  const budgetForRecords = Math.max(1000, maxChars - intro.length)
  const baseLimit = Math.max(80, Math.min(900, Math.floor(budgetForRecords / Math.max(1, records.length)) - 120))
  let options = {
    excerptLimit: baseLimit,
    metaLimit: Math.max(80, Math.min(240, baseLimit)),
    includePubTime: true,
    includeDetailTopic: true,
  }
  let compacted = buildCompacted(options)
  while (compacted.length > maxChars && options.excerptLimit > 80) {
    options = {
      ...options,
      excerptLimit: Math.max(80, Math.floor(options.excerptLimit * 0.7)),
      metaLimit: Math.max(80, Math.floor(options.metaLimit * 0.8)),
    }
    compacted = buildCompacted(options)
  }

  if (compacted.length <= maxChars) return compacted

  options = {
    excerptLimit: 45,
    metaLimit: 70,
    includePubTime: false,
    includeDetailTopic: false,
  }
  compacted = buildCompacted(options)
  while (compacted.length > maxChars && options.excerptLimit > 24) {
    options = {
      ...options,
      excerptLimit: Math.max(24, options.excerptLimit - 6),
      metaLimit: Math.max(48, options.metaLimit - 6),
    }
    compacted = buildCompacted(options)
  }
  return compacted.length <= maxChars ? compacted : truncateAtBoundary(compacted, maxChars)
}

export function compactSourceContentForPrompt(sourceContent, sourcePath, sourceHash, maxChars = SOURCE_PROMPT_CHAR_SOFT_LIMIT) {
  if (sourceContent.length <= maxChars) return sourceContent

  const normalized = sourceContent.replace(/\r\n/g, "\n")
  if (/source:\s*cn_alternative_db\.public\.gangtise_meeting_clues/.test(normalized)) {
    return compactMeetingCluesContentForPrompt(sourceContent, sourcePath, sourceHash, maxChars)
  }

  const wechatWindows = parseWechatUpdateWindows(normalized)
  const hasWechatWindows = wechatWindows.windows.length > 0
  const header = hasWechatWindows ? wechatWindows.header : normalized.slice(0, 2500)
  const body = hasWechatWindows ? "" : normalized.slice(2500)
  const sections = hasWechatWindows
    ? wechatWindows.windows.map((window) => window.text)
    : body
      .split(/\n(?=## \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} 舆情更新)/)
      .map((s) => s.trim())
      .filter(Boolean)

  const informative = sections.filter((section) => {
    if (/本半小时无显著新增舆情/.test(section) && !/原文：|重点板块|核心催化|完整调研|强call|涨价|IPO|订单|发射|机器人|存储|光模块|电子布|工控|商业航天|半导体|算力|电力/.test(section)) {
      return false
    }
    if (/本窗口内未捕获到新增微信消息/.test(section) && !/原文：|来源：/.test(section)) return false
    return true
  })

  const budgetForSections = Math.max(12000, maxChars - header.length - 1200)
  const perSectionLimit = Math.max(1400, Math.floor(budgetForSections / Math.max(1, informative.length)))
  let compactedSections = informative.map((section) => compactWechatSection(section, perSectionLimit))
  let compacted = [
    header.trimEnd(),
    "",
    "## 超大源文档 prompt 压缩说明",
    "",
    `- 原始 sourcePath：${sourcePath}`,
    `- 原始 sourceHash：${sourceHash}`,
    `- 原始字符数：${sourceContent.length}`,
    `- 本段仅用于 Codex prompt：已剔除大量空窗口、wx-cli/radar 诊断噪声，并对超长原文做节选；manifest 和写入校验仍绑定原始 raw 文件。`,
    hasWechatWindows ? `- 微信窗口解析：已识别 time-only/date-time 窗口标题。` : "",
    `- 保留窗口数：${compactedSections.length} / ${sections.length}`,
    "",
    ...compactedSections,
  ].filter(Boolean).join("\n")

  if (compacted.length <= maxChars) return compacted

  const tighterLimit = Math.max(900, Math.floor((budgetForSections * 0.75) / Math.max(1, informative.length)))
  compactedSections = informative.map((section) => compactWechatSection(section, tighterLimit))
  compacted = [
    header.trimEnd(),
    "",
    "## 超大源文档 prompt 压缩说明",
    "",
    `- 原始 sourcePath：${sourcePath}`,
    `- 原始 sourceHash：${sourceHash}`,
    `- 原始字符数：${sourceContent.length}`,
    `- 本段仅用于 Codex prompt：已剔除大量空窗口、wx-cli/radar 诊断噪声，并对超长原文做节选；manifest 和写入校验仍绑定原始 raw 文件。`,
    hasWechatWindows ? `- 微信窗口解析：已识别 time-only/date-time 窗口标题。` : "",
    `- 保留窗口数：${compactedSections.length} / ${sections.length}`,
    "",
    ...compactedSections,
  ].filter(Boolean).join("\n")
  return truncateAtBoundary(compacted, maxChars)
}

export function normalizeFactRefList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean)
  if (typeof value === "string") {
    return value
      .split(/[,\s，、]+/)
      .map((item) => item.trim())
      .filter(Boolean)
  }
  return []
}

export function normalizeTemporalFactStatus(value) {
  const raw = String(value ?? "").trim()
  if (!raw) return "active"
  const lower = raw.toLowerCase()
  if (["active", "current", "valid", "pending", "observed"].includes(lower) || ["活跃", "当前", "有效", "观察", "待验证"].includes(raw)) {
    return "active"
  }
  if (["superseded", "replaced"].includes(lower) || ["被替代", "已替代"].includes(raw)) return "superseded"
  if (["invalidated", "contradicted", "retracted", "false"].includes(lower) || ["证伪", "被证伪", "失效", "已失效", "撤回"].includes(raw)) {
    return "invalidated"
  }
  if (["expired", "stale"].includes(lower) || ["过期", "陈旧"].includes(raw)) return "expired"
  return lower
}

export function normalizeTemporalFactEvidenceLevel(value) {
  const raw = String(value ?? "").trim().toUpperCase()
  return raw && TEMPORAL_FACT_EVIDENCE_LEVELS.includes(raw) ? raw : raw || null
}

export function normalizeTemporalFactSourceKind(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[-\s]+/g, "_") || null
}

export function normalizeTemporalFactPredicate(value) {
  return String(value ?? "").trim().toUpperCase().replace(/[-\s]+/g, "_")
}

export function normalizeEntityAlias(value) {
  const raw = String(value ?? "")
    .trim()
    .replace(/^\[\[/, "")
    .replace(/\]\]$/, "")
    .split("|")
    .pop()
    .replace(/^wiki\//, "")
    .replace(/^(?:股票|概念|事件|模式|策略|错误)\//, "")
    .replace(/\.(?:md|markdown)$/i, "")
    .replace(/[（(]\s*(?:SZ|SH|BJ)?\d{6}(?:\.(?:SZ|SH|BJ))?\s*[）)]/gi, "")
    .replace(/\s+/g, "")
  return raw
}

export function normalizeEntitySearchText(value) {
  return String(value ?? "")
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$1 $2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\s+/g, "")
    .toLowerCase()
}

export function entityKeyForSubject(subject, stockCode = null) {
  const code = normalizeStockCode(stockCode)
  if (code) return `stock:${code}`
  const normalized = normalizeEntityAlias(subject).toLowerCase()
  return normalized ? `entity:${normalized}` : null
}

export function addEntityLookupAlias(lookup, alias, info) {
  const normalized = normalizeEntityAlias(alias)
  if (!normalized) return
  lookup.aliases.set(normalized.toLowerCase(), info)
}

export async function loadTemporalEntityLookup(projectPath) {
  const pp = normalizePath(projectPath)
  const lookup = { aliases: new Map(), byKey: new Map() }
  const add = ({ subject, stockCode = null, aliases = [], wikiPath = null }) => {
    const canonicalSubject = normalizeEntityAlias(subject)
    if (!canonicalSubject) return null
    const normalizedCode = normalizeStockCode(stockCode)
    const entityKey = entityKeyForSubject(canonicalSubject, normalizedCode)
    if (!entityKey) return null
    const existing = lookup.byKey.get(entityKey)
    const mergedAliases = [...new Set([...(existing?.aliases ?? []), canonicalSubject, ...aliases.map(normalizeEntityAlias).filter(Boolean)])]
    const info = {
      entityKey,
      canonicalSubject: existing?.canonicalSubject ?? canonicalSubject,
      stockCode: existing?.stockCode ?? normalizedCode ?? null,
      aliases: mergedAliases,
      wikiPath: existing?.wikiPath ?? wikiPath ?? null,
    }
    lookup.byKey.set(entityKey, info)
    addEntityLookupAlias(lookup, canonicalSubject, info)
    if (normalizedCode) {
      addEntityLookupAlias(lookup, normalizedCode, info)
      addEntityLookupAlias(lookup, normalizedCode.replace(/^(SZ|SH|BJ)/, ""), info)
    }
    for (const alias of mergedAliases) addEntityLookupAlias(lookup, alias, info)
    return info
  }

  try {
    const raw = await fs.readFile(path.join(pp, ".llm-wiki", "stock-codes.json"), "utf8")
    const parsed = JSON.parse(raw)
    for (const [name, code] of Object.entries(parsed.mapping ?? {})) {
      add({ subject: name, stockCode: code })
    }
  } catch {}

  const stockFiles = await listFilesRecursive(path.join(pp, "wiki", "股票"), {
    extensions: new Set([".md"]),
    excludeDirNames: new Set([".git", ".conflicts", "scripts"]),
  }).catch(() => [])
  for (const filePath of stockFiles) {
    try {
      const content = await fs.readFile(filePath, "utf8")
      const { fm } = parseFrontmatter(content)
      const wikiPath = projectRelative(pp, filePath)
      const title = typeof fm.title === "string" && fm.title.trim() ? fm.title.trim() : path.basename(filePath, ".md")
      const aliases = Array.isArray(fm.aliases) ? fm.aliases : []
      add({ subject: title, stockCode: fm.code, aliases, wikiPath })
    } catch {}
  }

  return lookup
}

export function resolveTemporalEntity(record, lookup) {
  const rawSubject = record.subject ?? record.entity ?? record.canonicalSubject ?? record.name ?? ""
  const explicitCode = normalizeStockCode(record.stockCode ?? record.code ?? record.ticker)
  if (explicitCode) {
    const key = `stock:${explicitCode}`
    const found = lookup.byKey.get(key)
    if (found) return found
    const subject = normalizeEntityAlias(rawSubject) || explicitCode
    return { entityKey: key, canonicalSubject: subject, stockCode: explicitCode, aliases: [subject, explicitCode], wikiPath: null }
  }
  const normalizedSubject = normalizeEntityAlias(rawSubject)
  const found = normalizedSubject ? lookup.aliases.get(normalizedSubject.toLowerCase()) : null
  if (found) return found
  const entityKey = entityKeyForSubject(normalizedSubject)
  return entityKey ? { entityKey, canonicalSubject: normalizedSubject, stockCode: null, aliases: normalizedSubject ? [normalizedSubject] : [], wikiPath: null } : null
}

export function normalizeTemporalFactRecord(record, lookup) {
  const entity = resolveTemporalEntity(record, lookup)
  const subject = entity?.canonicalSubject ?? normalizeEntityAlias(record.subject ?? record.entity ?? record.canonicalSubject ?? "")
  const normalized = {
    ...record,
    type: record.type ?? "temporal_fact",
    status: normalizeTemporalFactStatus(record.status),
    subject: subject || record.subject,
    canonicalSubject: record.canonicalSubject ?? entity?.canonicalSubject ?? subject ?? null,
    entityKey: record.entityKey ?? entity?.entityKey ?? entityKeyForSubject(subject, record.stockCode ?? record.code ?? record.ticker),
    stockCode: normalizeStockCode(record.stockCode ?? record.code ?? record.ticker) ?? entity?.stockCode ?? null,
    aliases: [...new Set([...(Array.isArray(record.aliases) ? record.aliases.map(normalizeEntityAlias).filter(Boolean) : []), ...(entity?.aliases ?? [])])],
    wikiPath: record.wikiPath ?? entity?.wikiPath ?? null,
  }
  if (!normalized.id) normalized.id = temporalFactId(normalized)
  return normalized
}

export function temporalFactIdentity(record) {
  const identity = {
    subject: record.subject ?? record.entity ?? null,
    canonicalSubject: record.canonicalSubject ?? null,
    entityKey: record.entityKey ?? null,
    stockCode: record.stockCode ?? null,
    predicate: record.predicate ?? record.relation ?? record.edgeType ?? null,
    object: record.object ?? record.target ?? record.value ?? null,
    claim: record.claim ?? record.text ?? record.summary ?? null,
    validAt: record.validAt ?? record.asOf ?? record.date ?? null,
    status: normalizeTemporalFactStatus(record.status),
    supersedes: normalizeFactRefList(record.supersedes),
    invalidates: normalizeFactRefList(record.invalidates),
    contradicts: normalizeFactRefList(record.contradicts),
    sourcePath: record.sourcePath ?? record.source ?? null,
    sourceHash: record.sourceHash ?? null,
    wikiPath: record.wikiPath ?? null,
  }
  if (Object.values(identity).some((value) => value != null && String(value).trim() !== "")) {
    return stableJsonString(identity)
  }
  const fallback = { ...record }
  delete fallback.id
  delete fallback.createdAt
  delete fallback.updatedAt
  return stableJsonString(fallback)
}

export function temporalFactId(record) {
  return `tf_${shortHash(temporalFactIdentity(record))}`
}

export function isTemporalFactRecord(record) {
  return isObjectRecord(record) && (record.type === "temporal_fact" || record.temporal === true || record.validAt || record.supersedes || record.invalidates || record.contradicts)
}

export function assertSafeTemporalFactsPath(relativePath) {
  const normalized = toPosixPath(String(relativePath ?? TEMPORAL_FACTS_RELATIVE_PATH)).replace(/^\/+/, "")
  if (normalized.includes("..")) throw new Error(`Refusing temporal fact path traversal: ${relativePath}`)
  if (normalized !== TEMPORAL_FACTS_RELATIVE_PATH) {
    throw new Error(`Temporal facts must be written only to ${TEMPORAL_FACTS_RELATIVE_PATH}: ${relativePath}`)
  }
  return normalized
}

export function normalizeManifestFactWrites(manifest) {
  const factWrites = manifest.factWrites ?? manifest.facts ?? []
  if (!Array.isArray(factWrites)) throw new Error("Manifest factWrites must be an array when present")
  return factWrites.map((raw, index) => {
    if (!isObjectRecord(raw)) throw new Error(`Invalid factWrites[${index}]: expected an object`)
    const relativePath = assertSafeTemporalFactsPath(raw.targetPath ?? raw.relativePath ?? raw.filePath ?? raw.file ?? raw.path ?? TEMPORAL_FACTS_RELATIVE_PATH)
    let payload
    if (isObjectRecord(raw.fact)) {
      payload = { ...raw.fact }
    } else if (isObjectRecord(raw.record)) {
      payload = { ...raw.record }
    } else if (isObjectRecord(raw.content)) {
      payload = { ...raw.content }
    } else {
      payload = { ...raw }
      delete payload.action
      delete payload.targetPath
      delete payload.relativePath
      delete payload.filePath
      delete payload.file
      delete payload.path
      delete payload.content
    }
    const record = {
      ...payload,
      type: payload.type ?? "temporal_fact",
      status: normalizeTemporalFactStatus(payload.status),
      predicate: normalizeTemporalFactPredicate(payload.predicate ?? payload.relation ?? payload.edgeType),
      evidenceLevel: normalizeTemporalFactEvidenceLevel(payload.evidenceLevel ?? payload.evidence_level),
      sourceKind: normalizeTemporalFactSourceKind(payload.sourceKind ?? payload.source_kind),
      sourceHash: payload.sourceHash ?? manifest.sourceHash ?? null,
      sourcePath: payload.sourcePath ?? payload.source ?? manifest.sourcePath ?? null,
      createdAt: payload.createdAt ?? nowLocalTimestamp(),
    }
    if (payload.id) record.id = payload.id
    return {
      action: raw.action ?? "append",
      path: relativePath,
      record,
      identity: temporalFactIdentity(record),
    }
  })
}

export async function readTemporalFactEntries(projectPath, entityLookup = null) {
  const filePath = path.join(normalizePath(projectPath), TEMPORAL_FACTS_RELATIVE_PATH)
  entityLookup = entityLookup ?? await loadTemporalEntityLookup(projectPath)
  const entries = (await readJsonlFile(filePath)).map((entry) => ({
    ...entry,
    value: isObjectRecord(entry.value) ? normalizeTemporalFactRecord(entry.value, entityLookup) : entry.value,
  }))
  const statusById = new Map()
  const statusByIdentity = new Map()

  for (const entry of entries) {
    const record = entry.value
    if (!isObjectRecord(record)) continue
    const sourceId = record.id ? String(record.id) : null
    const supersededRefs = normalizeFactRefList(record.supersedes)
    const invalidatedRefs = [
      ...normalizeFactRefList(record.invalidates),
      ...normalizeFactRefList(record.contradicts),
      ...normalizeFactRefList(record.contradictedFacts),
    ]
    for (const ref of supersededRefs) statusById.set(ref, { status: "superseded", by: sourceId, line: entry.line })
    for (const ref of invalidatedRefs) statusById.set(ref, { status: "invalidated", by: sourceId, line: entry.line })
    for (const ref of normalizeFactRefList(record.supersedesIdentity)) statusByIdentity.set(ref, { status: "superseded", by: sourceId, line: entry.line })
    for (const ref of normalizeFactRefList(record.invalidatesIdentity)) statusByIdentity.set(ref, { status: "invalidated", by: sourceId, line: entry.line })
  }

  return entries.map((entry) => {
    const record = entry.value
    if (!isObjectRecord(record)) return { ...entry, status: "invalidated", statusReason: null, identity: null }
    const identity = temporalFactIdentity(record)
    const explicitStatus = normalizeTemporalFactStatus(record.status)
    const linkStatus = (record.id ? statusById.get(String(record.id)) : null) ?? statusByIdentity.get(identity)
    let status = explicitStatus
    let statusReason = null
    if (record.supersededBy || record.replacedBy) status = "superseded"
    if (record.invalidatedBy || record.contradictedBy || record.retractedAt || record.invalidatedAt || record.expiredAt) status = status === "superseded" ? status : "invalidated"
    if (linkStatus) {
      status = linkStatus.status
      statusReason = linkStatus
    }
    return { ...entry, status, statusReason, identity }
  })
}

export async function planTemporalFactWrites(projectPath, factWrites) {
  const entityLookup = await loadTemporalEntityLookup(projectPath)
  factWrites = factWrites.map((item) => {
    const record = normalizeTemporalFactRecord(item.record, entityLookup)
    return {
      ...item,
      record,
      identity: temporalFactIdentity(record),
    }
  })
  const existingEntries = await readTemporalFactEntries(projectPath, entityLookup)
  const existingIds = new Map()
  const existingIdentities = new Map()
  for (const entry of existingEntries) {
    if (!isObjectRecord(entry.value)) continue
    if (entry.value.id) existingIds.set(String(entry.value.id), entry)
    if (entry.identity) existingIdentities.set(entry.identity, entry)
  }

  const plannedFactWrites = []
  const duplicateFacts = []
  const pendingIds = new Set(existingIds.keys())
  const pendingIdentities = new Set(existingIdentities.keys())

  for (const item of factWrites) {
    const id = String(item.record.id)
    const duplicateEntry = existingIds.get(id) ?? existingIdentities.get(item.identity)
    if (duplicateEntry || pendingIds.has(id) || pendingIdentities.has(item.identity)) {
      duplicateFacts.push({
        id,
        path: item.path,
        line: duplicateEntry?.line ?? null,
        reason: duplicateEntry ? "already_present" : "duplicate_in_manifest",
      })
      continue
    }
    plannedFactWrites.push(item)
    pendingIds.add(id)
    pendingIdentities.add(item.identity)
  }

  const supersededFacts = []
  const invalidatedFacts = []
  const collectRefs = (record, fields) => fields.flatMap((field) => normalizeFactRefList(record[field]))
  for (const item of plannedFactWrites) {
    for (const ref of collectRefs(item.record, ["supersedes"])) {
      const existing = existingIds.get(ref) ?? existingIdentities.get(ref)
      supersededFacts.push({
        id: ref,
        by: item.record.id,
        path: TEMPORAL_FACTS_RELATIVE_PATH,
        line: existing?.line ?? null,
        found: Boolean(existing),
      })
    }
    for (const ref of collectRefs(item.record, ["invalidates", "contradicts", "contradictedFacts"])) {
      const existing = existingIds.get(ref) ?? existingIdentities.get(ref)
      invalidatedFacts.push({
        id: ref,
        by: item.record.id,
        path: TEMPORAL_FACTS_RELATIVE_PATH,
        line: existing?.line ?? null,
        found: Boolean(existing),
      })
    }
  }

  return {
    plannedFactWrites,
    duplicateFacts,
    supersededFacts,
    invalidatedFacts,
  }
}

export function makeTemporalFactIssue(item, field, message, fatal = false) {
  return {
    path: item.path,
    id: item.record?.id ?? null,
    field,
    message,
    fatal,
  }
}

export function validateTemporalFactWrite(item) {
  const record = item.record ?? {}
  const issues = []
  const subject = String(record.subject ?? record.canonicalSubject ?? "").trim()
  const predicate = normalizeTemporalFactPredicate(record.predicate)
  const claim = String(record.claim ?? record.text ?? record.summary ?? "").trim()
  const status = normalizeTemporalFactStatus(record.status)
  const evidenceLevel = normalizeTemporalFactEvidenceLevel(record.evidenceLevel)
  const sourceKind = normalizeTemporalFactSourceKind(record.sourceKind)

  if (!subject) issues.push(makeTemporalFactIssue(item, "subject", "Temporal fact must include subject/canonicalSubject.", true))
  if (!predicate) issues.push(makeTemporalFactIssue(item, "predicate", "Temporal fact must include predicate.", true))
  else if (!TEMPORAL_FACT_PREDICATES.includes(predicate)) {
    issues.push(makeTemporalFactIssue(item, "predicate", `Unknown temporal fact predicate: ${predicate}. See docs/temporal-facts-v1.md.`, true))
  }
  if (!claim) issues.push(makeTemporalFactIssue(item, "claim", "Temporal fact must include a one-sentence claim.", true))
  else if (charLength(claim) > 220) {
    issues.push(makeTemporalFactIssue(item, "claim", "Claim is too long for an atomic fact; split it into smaller factWrites.", false))
  }
  if (!TEMPORAL_FACT_STATUSES.includes(status)) {
    issues.push(makeTemporalFactIssue(item, "status", `Unknown temporal fact status: ${status}.`, true))
  }
  if (!record.validAt && !record.eventDate && !record.sourceDate && !record.observedAt) {
    issues.push(makeTemporalFactIssue(item, "validAt", "Temporal fact should include validAt, eventDate, sourceDate, or observedAt.", false))
  }
  if (!evidenceLevel) {
    issues.push(makeTemporalFactIssue(item, "evidenceLevel", "Temporal fact should include evidenceLevel A/B/C/D.", false))
  } else if (!TEMPORAL_FACT_EVIDENCE_LEVELS.includes(evidenceLevel)) {
    issues.push(makeTemporalFactIssue(item, "evidenceLevel", `Unknown evidenceLevel: ${evidenceLevel}.`, true))
  }
  if (!sourceKind) {
    issues.push(makeTemporalFactIssue(item, "sourceKind", "Temporal fact should include sourceKind.", false))
  } else if (!TEMPORAL_FACT_SOURCE_KINDS.includes(sourceKind)) {
    issues.push(makeTemporalFactIssue(item, "sourceKind", `Unknown sourceKind: ${sourceKind}.`, true))
  }
  if (!record.sourcePath) issues.push(makeTemporalFactIssue(item, "sourcePath", "Temporal fact should carry sourcePath for audit.", false))
  if (!record.sourceHash) issues.push(makeTemporalFactIssue(item, "sourceHash", "Temporal fact should carry sourceHash for replay safety.", false))
  if (status === "active" && (evidenceLevel === "C" || evidenceLevel === "D")) {
    issues.push(makeTemporalFactIssue(item, "evidenceLevel", "C/D evidence may be active only as a weak/pending claim; keep claim wording explicit and avoid treating it as confirmed.", false))
  }
  if (status === "active" && sourceKind === "social_chat") {
    issues.push(makeTemporalFactIssue(item, "sourceKind", "social_chat facts should be worded as rumor/watchlist/pending, not confirmed fact.", false))
  }
  if ((predicate === "CONTRADICTS" || status === "invalidated" || status === "superseded") && !normalizeFactRefList(record.supersedes).length && !normalizeFactRefList(record.invalidates).length && !normalizeFactRefList(record.contradicts).length) {
    issues.push(makeTemporalFactIssue(item, "supersedes", "Contradiction/replacement facts should reference old fact ids through supersedes, invalidates, or contradicts when available.", false))
  }
  return issues
}

export function validateTemporalFactPlan(factPlan) {
  return factPlan.plannedFactWrites.flatMap((item) => validateTemporalFactWrite(item))
}

export function compactTemporalFactEntry(entry) {
  const record = entry.value
  return {
    id: record.id ?? null,
    line: entry.line,
    status: entry.status,
    entityKey: record.entityKey ?? null,
    canonicalSubject: record.canonicalSubject ?? record.subject ?? null,
    stockCode: record.stockCode ?? null,
    predicate: record.predicate ?? record.relation ?? record.edgeType ?? null,
    object: record.object ?? record.target ?? record.value ?? null,
    claim: record.claim ?? record.text ?? record.summary ?? null,
    validAt: record.validAt ?? record.asOf ?? record.date ?? null,
    sourcePath: record.sourcePath ?? record.source ?? null,
    wikiPath: record.wikiPath ?? null,
    supersedes: normalizeFactRefList(record.supersedes),
    invalidates: normalizeFactRefList(record.invalidates),
    contradicts: normalizeFactRefList(record.contradicts),
  }
}

export function extractTemporalEntityCandidates(sourceContent, sourcePath, candidates, lookup, maxItems = 24) {
  const sourceText = `${path.basename(sourcePath)}\n${String(sourceContent ?? "")}`
  const normalizedSource = normalizeEntitySearchText(sourceText)
  const scores = new Map()

  const bump = (info, score, reason) => {
    if (!info?.entityKey) return
    const existing = scores.get(info.entityKey) ?? { ...info, score: 0, reasons: [] }
    existing.score += score
    if (reason && !existing.reasons.includes(reason)) existing.reasons.push(reason)
    scores.set(info.entityKey, existing)
  }

  for (const info of lookup.byKey.values()) {
    for (const alias of info.aliases ?? []) {
      const normalizedAlias = normalizeEntityAlias(alias).toLowerCase()
      if (normalizedAlias && normalizedSource.includes(normalizedAlias)) {
        bump(info, normalizedAlias.length >= 4 ? 4 : 2, `source_alias:${alias}`)
      }
    }
    for (const code of stockCodeAlternatives(info.stockCode)) {
      if (code && String(sourceContent ?? "").toUpperCase().includes(code.toUpperCase())) bump(info, 5, `source_code:${code}`)
    }
  }

  for (const item of candidates?.wikiCandidates ?? []) {
    if (!String(item.path ?? "").startsWith("wiki/股票/")) continue
    const info = resolveTemporalEntity({ subject: item.title ?? path.basename(item.path, ".md") }, lookup)
    bump(info, 3, `wiki_candidate:${item.path}`)
  }

  for (const segment of candidates?.segments ?? []) {
    const segmentInfo = resolveTemporalEntity({ subject: segment.title }, lookup)
    bump(segmentInfo, 1.5, `segment:${segment.id}`)
    for (const item of segment.wikiCandidates ?? []) {
      if (!String(item.path ?? "").startsWith("wiki/股票/")) continue
      const info = resolveTemporalEntity({ subject: item.title ?? path.basename(item.path, ".md") }, lookup)
      bump(info, 2, `segment_wiki:${segment.id}`)
    }
  }

  for (const match of String(sourceContent ?? "").matchAll(/\b(?:SZ|SH|BJ)?\d{6}(?:\.(?:SZ|SH|BJ))?\b/gi)) {
    const code = normalizeStockCode(match[0])
    const info = code ? lookup.byKey.get(`stock:${code}`) ?? { entityKey: `stock:${code}`, canonicalSubject: code, stockCode: code, aliases: [code], wikiPath: null } : null
    bump(info, 4, `code:${match[0]}`)
  }

  return [...scores.values()]
    .sort((a, b) => b.score - a.score || a.canonicalSubject.localeCompare(b.canonicalSubject))
    .slice(0, maxItems)
    .map((item) => ({
      entityKey: item.entityKey,
      canonicalSubject: item.canonicalSubject,
      stockCode: item.stockCode ?? null,
      aliases: (item.aliases ?? []).slice(0, 8),
      wikiPath: item.wikiPath ?? null,
      score: Number(item.score.toFixed(2)),
      reasons: item.reasons.slice(0, 6),
    }))
}

export function scoreTemporalFactEntry(entry, tokens, entityKeys) {
  const record = entry.value
  if (!isObjectRecord(record)) return 0
  const text = `${record.entityKey ?? ""}\n${record.canonicalSubject ?? ""}\n${jsonLineSearchText(record)}`
  let score = tokenMatchScore(text, tokens)
  if (record.entityKey && entityKeys.has(record.entityKey)) score += 8
  if (entry.status === "active") score += 1
  else score += 0.25
  if (score > 0 && record.validAt) score += Math.max(0, getRecencyBoost(String(record.validAt), "最近"))
  return score
}

export function relatedTemporalFactsForText(entries, text, sourcePath, entityCandidates, maxItems = 12) {
  const tokens = extractSourceTokens(text, sourcePath, 90)
  const entityKeys = new Set(entityCandidates.map((item) => item.entityKey).filter(Boolean))
  return entries
    .map((entry) => ({ entry, score: scoreTemporalFactEntry(entry, tokens, entityKeys) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.entry.line - b.entry.line)
    .slice(0, maxItems)
    .map(({ entry, score }) => ({
      ...compactTemporalFactEntry(entry),
      score: Number(score.toFixed(2)),
    }))
}

export function buildSegmentFactSeeds({ sourcePath, segments, entries, lookup, maxSegments = 12 }) {
  return (segments ?? []).slice(0, maxSegments).map((segment) => {
    const segmentText = segment.searchText ?? segment.text ?? segment.textPreview ?? segment.title
    const entityCandidates = extractTemporalEntityCandidates(segmentText, `${sourcePath}#${segment.id}`, { wikiCandidates: segment.wikiCandidates ?? [], segments: [] }, lookup, 8)
    return {
      id: segment.id,
      title: segment.title,
      heat: segment.heat || "",
      lineStart: segment.lineStart,
      lineEnd: segment.lineEnd,
      textPreview: segment.textPreview,
      tokens: extractSourceTokens(segmentText, `${sourcePath}#${segment.id}`, 24),
      entityCandidates,
      relatedFacts: relatedTemporalFactsForText(entries, segmentText, `${sourcePath}#${segment.id}`, entityCandidates, 6),
    }
  })
}

export async function buildTemporalFactContext({ projectPath, sourcePath, sourceContent, candidates, options = {} }) {
  const lookup = await loadTemporalEntityLookup(projectPath)
  const entries = await readTemporalFactEntries(projectPath, lookup)
  const entityCandidates = extractTemporalEntityCandidates(sourceContent, sourcePath, candidates, lookup, options.maxEntities ?? 24)
  const relatedFacts = relatedTemporalFactsForText(entries, sourceContent, sourcePath, entityCandidates, options.maxFacts ?? 18)
  const segmentFactSeeds = buildSegmentFactSeeds({
    sourcePath,
    segments: candidates?.segments ?? [],
    entries,
    lookup,
    maxSegments: options.maxSegments ?? INGEST_SEGMENT_DEFAULT_MAX,
  })
  return {
    factsPath: TEMPORAL_FACTS_RELATIVE_PATH,
    indexPath: TEMPORAL_FACT_INDEX_RELATIVE_PATH,
    counts: {
      totalFacts: entries.filter((entry) => isObjectRecord(entry.value)).length,
      activeFacts: entries.filter((entry) => isObjectRecord(entry.value) && entry.status === "active").length,
      inactiveFacts: entries.filter((entry) => isObjectRecord(entry.value) && entry.status !== "active").length,
      entityCandidates: entityCandidates.length,
      relatedFacts: relatedFacts.length,
      segmentFactSeeds: segmentFactSeeds.length,
    },
    entityCandidates,
    relatedFacts,
    segmentFactSeeds,
  }
}

export async function buildTemporalFactsIndex(projectPath) {
  const entries = await readTemporalFactEntries(projectPath)
  const facts = entries
    .filter((entry) => isObjectRecord(entry.value))
    .map((entry) => compactTemporalFactEntry(entry))
  const entities = new Map()
  for (const fact of facts) {
    const key = fact.entityKey ?? entityKeyForSubject(fact.canonicalSubject)
    if (!key) continue
    const existing = entities.get(key) ?? {
      entityKey: key,
      canonicalSubject: fact.canonicalSubject,
      stockCode: fact.stockCode ?? null,
      activeFactIds: [],
      inactiveFactIds: [],
      predicates: [],
      lastValidAt: null,
    }
    if (fact.status === "active") existing.activeFactIds.push(fact.id)
    else existing.inactiveFactIds.push(fact.id)
    if (fact.predicate && !existing.predicates.includes(fact.predicate)) existing.predicates.push(fact.predicate)
    if (fact.validAt && (!existing.lastValidAt || String(fact.validAt) > String(existing.lastValidAt))) existing.lastValidAt = fact.validAt
    entities.set(key, existing)
  }
  const activeFacts = facts.filter((fact) => fact.status === "active").length
  return {
    version: 1,
    generatedAt: nowLocalTimestamp(),
    factsPath: TEMPORAL_FACTS_RELATIVE_PATH,
    counts: {
      totalFacts: facts.length,
      activeFacts,
      inactiveFacts: facts.length - activeFacts,
      entities: entities.size,
    },
    entities: Object.fromEntries([...entities.entries()].sort(([a], [b]) => a.localeCompare(b))),
    facts,
  }
}

export async function writeTemporalFactsIndex(projectPath) {
  const index = await buildTemporalFactsIndex(projectPath)
  await writeJson(path.join(normalizePath(projectPath), TEMPORAL_FACT_INDEX_RELATIVE_PATH), index)
  return {
    path: TEMPORAL_FACT_INDEX_RELATIVE_PATH,
    counts: index.counts,
  }
}

export const TEMPORAL_FACT_AUDIT_ROOT = ".llm-wiki/temporal-facts"

export const TEMPORAL_PREDICATE_AUDIT_RULES = [
  { suggestedPredicate: "HAS_CATALYST", terms: ["催化", "催化剂", "事件驱动", "发布会", "新品发布", "政策预期"] },
  {
    suggestedPredicate: "HAS_ORDER",
    candidatePredicates: ["HAS_ORDER_RUMOR", "HAS_CONFIRMED_ORDER"],
    terms: ["订单"],
    reviewNote: "订单是歧义词，需按信源和上下文区分传闻、意向、确认订单。",
  },
  { suggestedPredicate: "HAS_ORDER_RUMOR", terms: ["小作文", "群聊截图", "加单传闻", "未确认订单", "传闻订单"], reviewNote: "传闻、群聊、小作文只能作为待验证订单观察。" },
  { suggestedPredicate: "HAS_ORDER_INTENT", terms: ["定点", "客户意向", "送样后预计导入"], reviewNote: "客户意向或定点不等于正式订单。" },
  { suggestedPredicate: "HAS_CONFIRMED_ORDER", terms: ["中标", "合同", "正式订单", "公告订单", "项目落地"], reviewNote: "需要公告、合同、中标或等价强信源支撑。" },
  { suggestedPredicate: "HAS_DELIVERY_VALIDATION", terms: ["批量供货", "持续交付", "放量出货"], reviewNote: "交付放量比订单传闻更接近产业兑现。" },
  { suggestedPredicate: "CUSTOMER_VALIDATED", terms: ["客户", "供应客户", "进入供应链", "供应链", "下游客户", "绑定客户"] },
  { suggestedPredicate: "HAS_CAPACITY", terms: ["产能", "扩产", "投产", "产线", "产量", "稼动率"] },
  { suggestedPredicate: "PRICE_VALIDATED", terms: ["涨价", "提价", "报价", "价格", "ASP", "涨价落地"] },
  { suggestedPredicate: "HAS_POLICY_SUPPORT", terms: ["政策", "补贴", "规划", "文件", "产业政策", "目录"] },
  { suggestedPredicate: "HAS_PRODUCT", terms: ["产品", "材料", "设备", "工艺", "业务线", "新品"] },
  { suggestedPredicate: "VOLUME_VALIDATED", terms: ["放量", "产量", "稼动率"] },
  { suggestedPredicate: "TECH_VALIDATED", terms: ["认证", "样品", "量产", "良率", "验证通过"] },
  { suggestedPredicate: "FUNDAMENTAL_VALIDATED", terms: ["兑现", "业绩兑现", "财报映射", "订单转收入"] },
  { suggestedPredicate: "HAS_TECH_PROGRESS", terms: ["技术"] },
  { suggestedPredicate: "HAS_SUPPLY_CONSTRAINT", terms: ["缺货", "紧缺", "瓶颈", "供给约束", "卡脖子", "扩产瓶颈"] },
  {
    suggestedPredicate: "HAS_VALIDATION_SIGNAL",
    candidatePredicates: ["PRICE_VALIDATED", "VOLUME_VALIDATED", "CUSTOMER_VALIDATED", "TECH_VALIDATED", "FUNDAMENTAL_VALIDATED"],
    terms: ["验证", "反馈", "确认", "量价验证"],
    reviewNote: "泛验证词需要进一步拆成价格、量、客户、技术或财报兑现。",
  },
  { suggestedPredicate: "HAS_RISK", terms: ["风险"] },
  { suggestedPredicate: "HAS_CLARIFICATION_RISK", terms: ["澄清", "否认", "未确认", "撤回", "口径冲突", "不属实"] },
  { suggestedPredicate: "HAS_COMPETITION_RISK", terms: ["竞争", "替代风险", "同业扩产"] },
  { suggestedPredicate: "HAS_DEMAND_RISK", terms: ["不及预期", "下修", "降价", "需求不及预期", "价格下修", "订单下修"] },
  { suggestedPredicate: "HAS_SUPPLY_CHAIN_RISK", terms: ["良率风险", "供应链卡点", "良率不达标", "扩产不及预期"] },
  { suggestedPredicate: "HAS_VALUATION_RISK", terms: ["透支", "预期兑现", "高开低走", "追高", "利好集中兑现"] },
  { suggestedPredicate: "CONTRADICTS", terms: ["证伪", "反证"] },
]

export const TEMPORAL_AUDIT_TAG_PROMOTE_CONCEPTS = new Set([
  "国产替代", "AI服务器", "PCB", "先进封装", "商业航天", "光模块", "数据中心", "AI算力",
  "CPO", "AI硬件", "液冷", "半导体设备", "存储", "半导体", "半导体材料", "光通信",
  "AIDC", "MLCC", "国产算力", "玻璃基板", "算力租赁", "HBM", "消费电子", "人形机器人",
  "储能", "CCL", "具身智能", "智能驾驶", "mSAP", "光互联", "物理AI", "电子布",
  "硅光", "创新药", "固态电池", "涨价链", "Rubin", "AI眼镜", "NPO", "TGV",
  "SST", "AI电源",
].map((item) => normalizeEntityAlias(item).toLowerCase()))

export const TEMPORAL_AUDIT_TAG_METADATA_ONLY = new Set([
  "Gangtise", "行业复盘", "行业晨报", "微信舆情", "周末舆情", "股票", "港股", "科技",
  "AI", "L4执行", "L4执行控制", "涨价", "小作文", "Call", "IPO", "Q1", "Q2", "Q3",
].map((item) => normalizeEntityAlias(item).toLowerCase()))

export const TEMPORAL_AUDIT_TAG_METHOD_PAGES = new Set([
  "事实强度", "交易纪律", "交易错误", "信源分级", "舆情过滤", "风控", "风险控制",
  "仓位管理", "催化剂", "主线判断", "预期兑现",
].map((item) => normalizeEntityAlias(item).toLowerCase()))

export const TEMPORAL_AUDIT_ABBREVIATION_ALIAS_WHITELIST = new Set([
  "CPO", "NPO", "MLCC", "SLCC", "AIDC", "CoPoS", "CoWoS", "TGV", "TSV", "DrMOS",
  "SST", "HVDC", "mSAP", "ABF", "CCL", "HBM", "ASIC", "TPU", "GPU", "CPU",
  "PSU", "InP", "SiC", "WF6", "PTFE", "PCIe", "OCS", "NAND", "DRAM", "SSD",
  "ASP", "ARR", "MPO", "Chiplet", "BS-PDN", "D2C",
].map((item) => normalizeEntityAlias(item).toLowerCase()))

export const TEMPORAL_AUDIT_ABBREVIATION_ALIAS_BLACKLIST = new Set([
  "AI", "Call", "L4", "L3", "L2", "L1", "IPO", "Q1", "Q2", "Q3", "IP", "PC",
  "V3", "Tier", "Token", "Agent", "Switch", "Logic", "Folding", "Beta", "Meta",
  "Google", "NVIDIA", "SpaceX", "Rubin", "DeepSeek", "Gangtise",
].map((item) => normalizeEntityAlias(item).toLowerCase()))

export const TEMPORAL_AUDIT_ALIAS_RULINGS = [
  { alias: "8英寸SiC衬底", decision: "merge_to", target: "8英寸SiC衬底供需缺口", note: "SiC碳化硅AI电源主线只做 related。" },
  { alias: "AHF涨价链", decision: "merge_to", target: "电子级氢氟酸涨价链", note: "半导体材料涨价链做上位概念。" },
  { alias: "AIDC电力", decision: "keep_parent", target: "AIDC电力", note: "下挂 AIDC电源与SST / SST固态变压器与AIDC电力。" },
  { alias: "AIPCB材料涨价链", decision: "keep_parent", target: "AIPCB材料涨价链", note: "作为上位交易链，下挂 AI PCB油墨涨价链 / 电子布涨价链。" },
  { alias: "AI数据中心电源", decision: "merge_to", target: "AIDC电源", note: "AIDC电源与SST做专题页。" },
  { alias: "AI服务器电源", decision: "keep_parent", target: "AI服务器电源链", note: "不直接合并到 PSU 或 DrMOS。" },
  { alias: "AI服务器电源链", decision: "keep_parent", target: "AI服务器电源链", note: "价值量提升和 AIDC/SST 是不同切片。" },
  { alias: "AI电子布", decision: "merge_to", target: "电子布涨价链", note: "AI服务器PCB价值量提升做 related。" },
  { alias: "AI电源价值量提升", decision: "merge_to", target: "AI服务器电源价值量提升", note: "" },
  { alias: "AI硬件材料涨价链", decision: "merge_to", target: "半导体材料涨价链", note: "AI-PCB油墨涨价链是子链。" },
  { alias: "AI铜箔", decision: "merge_to", target: "PCB铜箔涨价周期", note: "AI服务器PCB价值量提升做 related。" },
  { alias: "BGB-43395", decision: "merge_to", target: "CDK4选择性抑制剂", note: "百济神州是公司实体，药物代码不做公司 alias。" },
  { alias: "BlankMask", decision: "merge_to", target: "BlankMask与先进制程多重曝光", note: "Blank-Mask 重复页并入。" },
  { alias: "BuriedMask", decision: "merge_to", target: "BuriedMask与3D封装材料", note: "不要并入 BlankMask。" },
  { alias: "Coherent-lite", decision: "merge_to", target: "2.4T相干光模块", note: "2-4t相干光模块视为格式噪声/错写。" },
  { alias: "COUPE", decision: "merge_to", target: "台积电COUPE光互联平台", note: "台积电COUPE硅光整合平台合并进去。" },
  { alias: "CoWoP+mSAP", decision: "merge_to", target: "CoWoP与mSAP", note: "封装级PCB技术代差做 related。" },
  { alias: "CPO/NPO光引擎", decision: "merge_to", target: "CPO-NPO光引擎", note: "光互联Scale-Up-十年大周期是上位。" },
  { alias: "CPO光引擎", decision: "merge_to", target: "CPO-NPO光引擎", note: "" },
  { alias: "Dato-DXd", decision: "merge_to", target: "TROP2ADC一线肺癌竞争", note: "第一三共是公司实体。" },
  { alias: "DCI算力专网", decision: "keep_slice", target: "DCI算力专网", note: "related 到 AI算力财报映射链和光互联Scale-Up。" },
  { alias: "H200不买", decision: "merge_to", target: "H200不买与国产AI芯片自主研发", note: "" },
  { alias: "H200口径冲突", decision: "merge_to", target: "H200不买与国产AI芯片自主研发", note: "标记为风险/口径冲突事件。" },
  { alias: "H200未谈", decision: "merge_to", target: "H200不买与国产AI芯片自主研发", note: "" },
  { alias: "HBM逻辑泛化", decision: "merge_to", target: "HBM逻辑泛化到全部存储股", note: "错误页。" },
  { alias: "LPU垂直供电PCB", decision: "merge_to", target: "NV-LPU垂直供电PCB", note: "VPD垂直供电是上位技术。" },
  { alias: "MicroLED光互连", decision: "merge_to", target: "MicroLED光互联", note: "不要并入玻璃基板。" },
  { alias: "MicroLED光通信", decision: "merge_to", target: "MicroLED光互联", note: "" },
  { alias: "MicrosoftMOSAIC", decision: "merge_to", target: "微软MOSAIC光互联方案", note: "MicroLED光互联做 related。" },
  { alias: "PCB半导体化", decision: "keep_independent", target: "PCB半导体化", note: "技术范式，不是某条 PCB 或 CIPB 子链。" },
  { alias: "PD-1/VEGF双抗", decision: "merge_to", target: "PD-1与VEGF双抗肺癌竞争", note: "康方生物是公司实体。" },
  { alias: "Rubin互连芯片", decision: "merge_to", target: "英伟达Rubin互连芯片增量", note: "" },
  { alias: "Rubin互连芯片增量", decision: "merge_to", target: "英伟达Rubin互连芯片增量", note: "英伟达Rubin拆解价值量做上位。" },
  { alias: "Rubin正交背板", decision: "merge_to", target: "Rubin正交背板PCB链", note: "PTFE正交背板材料是材料切片。" },
  { alias: "sac-TMT", decision: "merge_to", target: "TROP2ADC一线肺癌竞争", note: "科伦博泰做公司 related。" },
  { alias: "SKB264", decision: "merge_to", target: "TROP2ADC一线肺癌竞争", note: "科伦博泰做公司 related。" },
  { alias: "SolidStateTransformer", decision: "merge_to", target: "SST固态变压器", note: "" },
  { alias: "SpaceX上市催化", decision: "merge_to", target: "SpaceX-IPO催化", note: "统一 SpaceX IPO 催化格式。" },
  { alias: "SST", decision: "merge_to", target: "SST固态变压器", note: "SST固态变压器与AIDC电力是应用场景。" },
  { alias: "Token算力", decision: "keep_parent", target: "Token算力", note: "关联 Token工厂与聚合运营商业模式 / 算力Token化。" },
  { alias: "VeraRubin互连芯片", decision: "merge_to", target: "英伟达Rubin互连芯片增量", note: "" },
  { alias: "τ定律", decision: "merge_to", target: "华为τ定律与LogicFolding", note: "" },
  { alias: "主线对标的错", decision: "merge_to", target: "主线判断正确但标的选择错误", note: "主线正确但标的错误作为 alias。" },
  { alias: "事实强度传播热度矩阵", decision: "merge_to", target: "催化剂事实强度传播热度矩阵", note: "事实强度与传播热度分离是原则页。" },
  { alias: "产能兑现型不等于透支区", decision: "merge_to", target: "产能兑现型主线", note: "产业兑现驱动的科技主升是更上位框架。" },
  { alias: "产能兑现型主线", decision: "keep_concept", target: "产能兑现型主线", note: "不要并入产业兑现驱动的科技主升。" },
  { alias: "京东方康宁合作备忘录", decision: "merge_to", target: "京东方康宁玻璃基光互联合作", note: "" },
  { alias: "企业级SSD供需紧张", decision: "merge_to", target: "NAND供需紧张至2027", note: "铠侠产能售罄是事件/厂商切片。" },
  { alias: "伊朗油洗白", decision: "merge_to", target: "伊朗油洗白与VLCC周期", note: "美伊谈判与霍尔木兹海峡风险是宏观上位。" },
  { alias: "光模块上游MLCC-SLCC", decision: "merge_to", target: "SLCC与1.6T光模块增量", note: "AI服务器被动元件供需紧张做 related。" },
  { alias: "光通信检测设备", decision: "merge_to", target: "光模块检测设备", note: "光模块检测设备量价齐升是验证/交易切片。" },
  { alias: "几内亚铝土矿", decision: "merge_to", target: "几内亚铝土矿出口管制", note: "" },
  { alias: "利好集中兑现日", decision: "merge_to", target: "盘前利好集中兑现日", note: "舆情强一致后的高开低走是相邻模式。" },
  { alias: "千帆星座", decision: "keep_parent", target: "千帆星座", note: "下挂千帆星座组网催化/组网进度。" },
  { alias: "半导体全链路瓶颈传导", decision: "merge_to", target: "半导体涨价全链路扩散", note: "半导体涨价扩散是概念简写。" },
  { alias: "华为τ定律", decision: "merge_to", target: "华为τ定律与LogicFolding", note: "" },
  { alias: "固态变压器", decision: "merge_to", target: "SST固态变压器", note: "" },
  { alias: "国产AI芯片自主研发", decision: "merge_to", target: "国产AI芯片自主可控", note: "H200不买是事件驱动切片。" },
  { alias: "国产算力供不应求", decision: "merge_to", target: "国产AI芯片供不应求", note: "算力租赁涨价与卖方市场做 related。" },
  { alias: "国产算力链", decision: "keep_parent", target: "国产算力链", note: "下挂国产算力替代加速/国产算力链兑现期。" },
  { alias: "LogicFolding", decision: "merge_to", target: "华为τ定律与LogicFolding", note: "优先归入华为τ定律与LogicFolding；3D堆叠仍是先进封装上位技术。" },
]

export const TEMPORAL_AUDIT_CONCEPT_HIERARCHIES = [
  {
    root: "AI硬件 / AI服务器 / AI服务器PCB价值量提升",
    children: ["AI PCB上游短缺体系", "AI PCB油墨涨价链", "电子布涨价链", "PCB铜箔涨价周期", "AI PCB钻针三重通胀", "mSAP工艺预期差", "ABF载板涨价"],
    principle: "AI服务器PCB价值量提升是主概念，短缺、涨价、价值量提升是不同交易切片，不做简单同义合并。",
  },
  {
    root: "先进封装",
    children: ["Chiplet与3D堆叠封装", "TSV与3D堆叠先进封装", "华为τ定律与LogicFolding", "BS-PDN背面供电", "玻璃基板与TGV先进封装", "CoPoS面板级封装", "BlankMask与先进制程多重曝光", "BuriedMask与3D封装材料"],
    principle: "3D堆叠是技术总称，不直接等于 LogicFolding。",
  },
  {
    root: "光通信 / 光模块 / 光互联",
    children: ["800G到1.6T光模块升级", "2.4T相干光模块", "光模块检测设备", "光互联Scale-Up-十年大周期", "CPO-NPO光引擎", "DCI算力专网", "台积电COUPE光互联平台", "MicroLED光互联", "硅光芯片全链条布局"],
    principle: "光互联Scale-Up 是上位大周期，不吞并具体器件页。",
  },
  {
    root: "数据中心 / AIDC / AIDC电源",
    children: ["AI服务器电源链", "AI服务器电源价值量提升", "DrMOS与AI服务器电源", "PSU高功率电源", "SST固态变压器", "800V HVDC数据中心供电架构", "液冷单柜价值量提升", "AIDC储能从备用电源到基础设施", "算电协同"],
    principle: "AIDC电力是上位主题，SST 是技术实体，价值量提升是投资切片。",
  },
  {
    root: "国产算力",
    children: ["国产AI芯片自主可控", "H200不买与国产AI芯片自主研发", "国产AI芯片供不应求", "国产算力链兑现期", "国产算力替代加速", "算力租赁涨价与卖方市场", "Token工厂与算力网"],
    principle: "国产算力链是上位主题，不直接并入替代加速。",
  },
  {
    root: "商业航天",
    children: ["千帆星座", "千帆星座组网进度", "千帆星座组网催化", "D2C卫星直连手机", "太空算力", "轨道数据中心", "在轨数据中心", "SpaceX-IPO催化"],
    principle: "千帆星座是上位主题，太空数据中心相关命名先统一方向，再决定是否建子页。",
  },
]

export const TEMPORAL_AUDIT_ALIAS_RULING_BY_KEY = new Map(
  TEMPORAL_AUDIT_ALIAS_RULINGS.map((item) => [normalizeEntityAlias(item.alias).toLowerCase(), item]),
)

export function classifyTemporalAuditTag(tag) {
  const key = normalizeEntityAlias(tag).toLowerCase()
  if (TEMPORAL_AUDIT_TAG_PROMOTE_CONCEPTS.has(key)) {
    return { classification: "promote_concept", action: "晋升或维护为正式概念页" }
  }
  if (TEMPORAL_AUDIT_TAG_METHOD_PAGES.has(key)) {
    return { classification: "method_or_error_page", action: "进入方法论、模式或错误页体系" }
  }
  if (TEMPORAL_AUDIT_TAG_METADATA_ONLY.has(key)) {
    return { classification: "metadata_only", action: "只做元数据/来源标签，不晋升为概念页" }
  }
  return { classification: "review", action: "人工判断是否承载产业链、时间线、公司映射或交易框架" }
}

export function classifyTemporalAuditAbbreviation(abbreviation) {
  const key = normalizeEntityAlias(abbreviation).toLowerCase()
  if (TEMPORAL_AUDIT_ABBREVIATION_ALIAS_WHITELIST.has(key)) {
    return { classification: "alias_whitelist", action: "可作为 alias 候选，但仍需绑定到正确概念或实体" }
  }
  if (TEMPORAL_AUDIT_ABBREVIATION_ALIAS_BLACKLIST.has(key)) {
    return { classification: "blocked_alias", action: "不要自动挂靠为 alias；如有价值，应作为实体/主题词单独处理" }
  }
  return { classification: "review", action: "人工判断是有效简称、产品代码、公司代码还是噪声" }
}

export function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export function temporalAuditSnippet(text, index, termLength, maxChars = 120) {
  const start = Math.max(0, index - Math.floor(maxChars / 2))
  const end = Math.min(String(text).length, index + termLength + Math.floor(maxChars / 2))
  return String(text).slice(start, end).replace(/\s+/g, " ").trim()
}

export function addTemporalAuditMapItem(map, key, patch) {
  const existing = map.get(key) ?? {
    key,
    count: 0,
    pages: new Set(),
    examples: [],
  }
  existing.count += patch.count ?? 1
  if (patch.page) existing.pages.add(patch.page)
  if (patch.example && existing.examples.length < 5) existing.examples.push(patch.example)
  for (const [field, value] of Object.entries(patch)) {
    if (["count", "page", "example"].includes(field)) continue
    if (value !== undefined) existing[field] = value
  }
  map.set(key, existing)
}

export const TEMPORAL_AUDIT_CONFIDENCE_RANK = {
  high: 3,
  medium: 2,
  low: 1,
}

export function dedupeTemporalAuditRows(rows) {
  const deduped = new Map()
  for (const row of rows) {
    const key = normalizeEntityAlias(row.alias).toLowerCase()
    const existing = deduped.get(key)
    if (!existing || (TEMPORAL_AUDIT_CONFIDENCE_RANK[row.confidence] ?? 0) > (TEMPORAL_AUDIT_CONFIDENCE_RANK[existing.confidence] ?? 0)) {
      deduped.set(key, row)
    }
  }
  return [...deduped.values()].sort((a, b) => a.alias.localeCompare(b.alias))
}

export function extractTemporalAuditAliases({ title, fm }) {
  const rows = []
  const add = (alias, source, confidence = "medium") => {
    const normalized = normalizeEntityAlias(alias)
    if (!normalized || normalized === normalizeEntityAlias(title)) return
    if (normalized.length < 2 || normalized.length > 32) return
    rows.push({ alias: normalized, source, confidence })
  }

  for (const alias of frontmatterValues(fm, "aliases")) add(alias, "frontmatter.aliases", "high")

  const titleText = String(title ?? "")
  for (const part of titleText.split(/[\/／|｜、，,]/)) add(part, "title.split", "medium")
  for (const match of titleText.matchAll(/[（(]([^（）()]{2,32})[）)]/g)) add(match[1], "title.parenthetical", "medium")

  return dedupeTemporalAuditRows(rows)
}

export function extractTemporalAuditTags({ title, fm }) {
  const rows = []
  for (const tag of frontmatterValues(fm, "tags")) {
    const normalized = normalizeEntityAlias(tag)
    if (!normalized || normalized === normalizeEntityAlias(title)) continue
    if (normalized.length < 2 || normalized.length > 32) continue
    rows.push({ alias: normalized, source: "frontmatter.tags", confidence: "low" })
  }
  return dedupeTemporalAuditRows(rows)
}

export function extractTemporalAuditAbbreviations({ title, fm, body }) {
  const titleText = String(title ?? "")
  const abbreviationMatches = String(`${title}\n${frontmatterFieldSearchText(fm, "summary")}\n${body.slice(0, 6000)}`)
    .match(/\b[A-Za-z][A-Za-z0-9+.-]{1,14}\b/g) ?? []
  const abbreviationCounts = new Map()
  for (const raw of abbreviationMatches) {
    if (!/[A-Z0-9]/.test(raw)) continue
    if (/^(?:http|https|www|raw|wiki|markdown|json|schema|version)$/i.test(raw)) continue
    abbreviationCounts.set(raw, (abbreviationCounts.get(raw) ?? 0) + 1)
  }
  const rows = []
  for (const [alias, count] of abbreviationCounts.entries()) {
    const normalized = normalizeEntityAlias(alias)
    if (!normalized || normalized === normalizeEntityAlias(title)) continue
    if (normalized.length < 2 || normalized.length > 32) continue
    if (count >= 2 || titleText.includes(alias)) {
      rows.push({
        alias: normalized,
        source: `body.abbreviation:${count}`,
        confidence: count >= 4 || titleText.includes(alias) ? "medium" : "low",
        count,
      })
    }
  }
  return dedupeTemporalAuditRows(rows).sort((a, b) => (b.count ?? 0) - (a.count ?? 0) || a.alias.localeCompare(b.alias))
}

export function wikiAuditPageType(relativePath, fm) {
  if (typeof fm.type === "string" && fm.type.trim()) return fm.type.trim()
  const match = relativePath.match(/^wiki\/([^/]+)\//)
  return match?.[1] ?? "未知"
}

export function auditEntityKeyForWikiPage({ title, type, fm, relativePath }) {
  const code = fm.code ?? fm.stockCode ?? fm.ticker
  if (type === "股票" || relativePath.startsWith("wiki/股票/")) return entityKeyForSubject(title, code)
  return entityKeyForSubject(title)
}

export async function collectTemporalAuditWikiPages(projectPath, options = {}) {
  const pp = normalizePath(projectPath)
  const files = await listFilesRecursive(path.join(pp, "wiki"), {
    extensions: new Set([".md"]),
    excludeDirNames: new Set([".git", ".llm-wiki", ".obsidian", ".conflicts", "scripts", "templates", "archive", "assets"]),
    maxBytes: options.maxWikiBytes ?? 1024 * 1024,
    maxFiles: options.maxWikiFiles ? parsePositiveInteger(options.maxWikiFiles, null) : null,
  })
  const pages = []
  for (const filePath of files) {
    const relativePath = projectRelative(pp, filePath)
    if (isReservedWikiPath(relativePath)) continue
    const content = await readIfExists(filePath)
    if (!content.trim()) continue
    const { fm, body } = parseFrontmatter(content)
    const title = typeof fm.title === "string" && fm.title.trim()
      ? fm.title.trim()
      : path.basename(relativePath, ".md")
    const type = wikiAuditPageType(relativePath, fm)
    pages.push({
      path: relativePath,
      title,
      type,
      fm,
      body,
      content,
    })
  }
  return pages.sort((a, b) => a.path.localeCompare(b.path))
}

export function auditPredicateCandidatesFromPages(pages, options = {}) {
  const map = new Map()
  const maxBodyChars = parsePositiveInteger(options.maxPredicateBodyChars, 16000)
  for (const page of pages) {
    const searchable = [
      page.title,
      frontmatterFieldSearchText(page.fm, "summary"),
      frontmatterFieldSearchText(page.fm, "tags"),
      frontmatterFieldSearchText(page.fm, "aliases"),
      page.body.slice(0, maxBodyChars),
    ].join("\n")
    for (const rule of TEMPORAL_PREDICATE_AUDIT_RULES) {
      for (const term of rule.terms) {
        const regex = new RegExp(escapeRegex(term), "g")
        let match
        while ((match = regex.exec(searchable)) !== null) {
          addTemporalAuditMapItem(map, `${rule.suggestedPredicate}:${term}`, {
            term,
            suggestedPredicate: rule.suggestedPredicate,
            candidatePredicates: rule.candidatePredicates ?? [rule.suggestedPredicate],
            reviewNote: rule.reviewNote ?? "",
            page: page.path,
            example: {
              path: page.path,
              title: page.title,
              snippet: temporalAuditSnippet(searchable, match.index, term.length),
            },
          })
        }
      }
    }
  }
  return [...map.values()]
    .map((item) => ({
      term: item.term,
      suggestedPredicate: item.suggestedPredicate,
      candidatePredicates: item.candidatePredicates ?? [item.suggestedPredicate],
      reviewNote: item.reviewNote ?? "",
      count: item.count,
      pageCount: item.pages.size,
      pages: [...item.pages].sort().slice(0, 20),
      examples: item.examples,
    }))
    .sort((a, b) => b.pageCount - a.pageCount || b.count - a.count || a.suggestedPredicate.localeCompare(b.suggestedPredicate))
}

export function auditAliasCandidatesFromPages(pages) {
  const candidates = []
  const aliasOwners = new Map()
  const tagMap = new Map()
  const abbreviationMap = new Map()
  for (const page of pages) {
    if (!/^(股票|概念|事件|模式|策略|错误)$/.test(page.type) && !/^wiki\/(?:股票|概念|事件|模式|策略|错误)\//.test(page.path)) continue
    const aliases = extractTemporalAuditAliases({ title: page.title, fm: page.fm })
    const tagRows = extractTemporalAuditTags({ title: page.title, fm: page.fm })
    const abbreviationRows = extractTemporalAuditAbbreviations({ title: page.title, fm: page.fm, body: page.body })
    const entityKey = auditEntityKeyForWikiPage({ title: page.title, type: page.type, fm: page.fm, relativePath: page.path })
    const row = {
      canonicalSubject: normalizeEntityAlias(page.title),
      entityKey,
      type: page.type,
      path: page.path,
      aliases,
      aliasCount: aliases.length,
    }
    candidates.push(row)
    for (const alias of aliases) {
      const key = normalizeEntityAlias(alias.alias).toLowerCase()
      const owners = aliasOwners.get(key) ?? []
      owners.push({
        alias: alias.alias,
        canonicalSubject: row.canonicalSubject,
        entityKey: row.entityKey,
        path: row.path,
        source: alias.source,
        confidence: alias.confidence,
      })
      aliasOwners.set(key, owners)
    }
    for (const tag of tagRows) {
      const classification = classifyTemporalAuditTag(tag.alias)
      addTemporalAuditMapItem(tagMap, normalizeEntityAlias(tag.alias).toLowerCase(), {
        tag: tag.alias,
        confidence: tag.confidence,
        classification: classification.classification,
        action: classification.action,
        page: page.path,
        example: {
          canonicalSubject: row.canonicalSubject,
          entityKey: row.entityKey,
          path: row.path,
        },
      })
    }
    for (const abbreviation of abbreviationRows) {
      const classification = classifyTemporalAuditAbbreviation(abbreviation.alias)
      addTemporalAuditMapItem(abbreviationMap, normalizeEntityAlias(abbreviation.alias).toLowerCase(), {
        abbreviation: abbreviation.alias,
        confidence: abbreviation.confidence,
        classification: classification.classification,
        action: classification.action,
        count: abbreviation.count ?? 1,
        page: page.path,
        example: {
          canonicalSubject: row.canonicalSubject,
          entityKey: row.entityKey,
          path: row.path,
          count: abbreviation.count ?? 1,
        },
      })
    }
  }
  const aliasConflicts = [...aliasOwners.values()]
    .filter((owners) => new Set(owners.map((item) => item.entityKey)).size > 1)
    .map((owners) => ({
      alias: owners[0].alias,
      owners: owners.sort((a, b) => a.path.localeCompare(b.path)),
      ruling: TEMPORAL_AUDIT_ALIAS_RULING_BY_KEY.get(normalizeEntityAlias(owners[0].alias).toLowerCase()) ?? null,
    }))
    .sort((a, b) => b.owners.length - a.owners.length || a.alias.localeCompare(b.alias))
  const aliasOwnerKeys = new Set(aliasOwners.keys())
  const curatedAliasRulings = TEMPORAL_AUDIT_ALIAS_RULINGS
    .map((ruling) => {
      const key = normalizeEntityAlias(ruling.alias).toLowerCase()
      const owners = aliasOwners.get(key) ?? []
      return {
        ...ruling,
        matchedConflict: owners.length > 1,
        ownerCount: new Set(owners.map((item) => item.entityKey)).size,
        seenInAliases: aliasOwnerKeys.has(key),
      }
    })
    .sort((a, b) => Number(b.matchedConflict) - Number(a.matchedConflict) || Number(b.seenInAliases) - Number(a.seenInAliases) || a.alias.localeCompare(b.alias))
  return {
    aliasCandidates: candidates
      .filter((item) => item.aliases.length > 0)
      .sort((a, b) => b.aliasCount - a.aliasCount || a.path.localeCompare(b.path)),
    aliasConflicts,
    curatedAliasRulings,
    tagCandidates: [...tagMap.values()]
      .map((item) => ({
        tag: item.tag,
        confidence: item.confidence,
        classification: item.classification,
        action: item.action,
        count: item.count,
        pageCount: item.pages.size,
        pages: [...item.pages].sort().slice(0, 20),
        examples: item.examples,
      }))
      .sort((a, b) => b.pageCount - a.pageCount || b.count - a.count || a.tag.localeCompare(b.tag)),
    abbreviationCandidates: [...abbreviationMap.values()]
      .map((item) => ({
        abbreviation: item.abbreviation,
        confidence: item.confidence,
        classification: item.classification,
        action: item.action,
        count: item.count,
        pageCount: item.pages.size,
        pages: [...item.pages].sort().slice(0, 20),
        examples: item.examples,
      }))
      .sort((a, b) => b.pageCount - a.pageCount || b.count - a.count || a.abbreviation.localeCompare(b.abbreviation)),
  }
}

export function buildTemporalFactsAuditMarkdown(result, topN = 50) {
  const predicateRows = result.predicateCandidates
    .slice(0, topN)
    .map((item) => `| ${item.term} | ${item.suggestedPredicate} | ${(item.candidatePredicates ?? [item.suggestedPredicate]).join("<br>")} | ${item.count} | ${item.pageCount} | ${item.pages.slice(0, 3).join("<br>")} | ${item.reviewNote ?? ""} |`)
    .join("\n")
  const aliasRows = result.aliasCandidates
    .slice(0, topN)
    .map((item) => `| ${item.canonicalSubject} | ${item.entityKey ?? ""} | ${item.type} | ${item.path} | ${item.aliases.slice(0, 8).map((alias) => `${alias.alias}(${alias.confidence})`).join("<br>")} |`)
    .join("\n")
  const conflictRows = result.aliasConflicts
    .slice(0, topN)
    .map((item) => `| ${item.alias} | ${item.owners.map((owner) => `${owner.canonicalSubject} ${owner.entityKey ?? ""} ${owner.path}`).join("<br>")} | ${item.ruling ? `${item.ruling.decision} -> ${item.ruling.target}` : ""} | ${item.ruling?.note ?? ""} |`)
    .join("\n")
  const curatedRulingRows = result.curatedAliasRulings
    .slice(0, topN)
    .map((item) => `| ${item.alias} | ${item.decision} | ${item.target} | ${item.matchedConflict ? "yes" : "no"} | ${item.seenInAliases ? "yes" : "no"} | ${item.note ?? ""} |`)
    .join("\n")
  const tagRows = result.tagCandidates
    .slice(0, topN)
    .map((item) => `| ${item.tag} | ${item.classification} | ${item.count} | ${item.pageCount} | ${item.pages.slice(0, 3).join("<br>")} | ${item.action ?? ""} |`)
    .join("\n")
  const abbreviationRows = result.abbreviationCandidates
    .slice(0, topN)
    .map((item) => `| ${item.abbreviation} | ${item.classification} | ${item.confidence} | ${item.count} | ${item.pageCount} | ${item.pages.slice(0, 3).join("<br>")} | ${item.action ?? ""} |`)
    .join("\n")
  const hierarchyRows = result.conceptHierarchyRules
    .map((item) => `| ${item.root} | ${item.children.slice(0, 10).join("<br>")} | ${item.principle} |`)
    .join("\n")
  const unmappedNote = [
    "本报告只给候选，不自动改词表或别名表。",
    "Predicate 候选需要人工确认后，再加入 `TEMPORAL_FACT_PREDICATES` 和 docs/temporal-facts-v1.md。",
    "Alias 候选只保留 frontmatter aliases、标题拆分和括号同义；tags 与正文缩写已拆成独立候选，避免泛主题词制造假冲突。",
    "Alias 冲突如果命中 curated ruling，只代表人工裁决建议，不自动改 wiki 页面。",
    "交易 wiki 的规则是先分层再合并：上位主题、事件催化、供需切片、价格切片、价值量切片不要混成同义词。",
  ].map((line) => `- ${line}`).join("\n")
  return [
    "# Temporal Facts Audit",
    "",
    `- generatedAt: ${result.generatedAt}`,
    `- projectPath: ${result.projectPath}`,
    `- wikiFiles: ${result.counts.wikiFiles}`,
    `- predicateCandidates: ${result.counts.predicateCandidates}`,
    `- aliasCandidates: ${result.counts.aliasCandidates}`,
    `- aliasConflicts: ${result.counts.aliasConflicts}`,
    `- curatedAliasRulings: ${result.counts.curatedAliasRulings}`,
    `- tagCandidates: ${result.counts.tagCandidates}`,
    `- abbreviationCandidates: ${result.counts.abbreviationCandidates}`,
    `- conceptHierarchyRules: ${result.counts.conceptHierarchyRules}`,
    "",
    "## Review Notes",
    "",
    unmappedNote,
    "",
    "## Predicate Candidates",
    "",
    "| term | suggestedPredicate | candidatePredicates | count | pages | sample pages | review note |",
    "|---|---|---|---:|---:|---|---|",
    predicateRows || "| none |  | 0 | 0 |  |",
    "",
    "## Alias Candidates",
    "",
    "| canonicalSubject | entityKey | type | path | aliases |",
    "|---|---|---|---|---|",
    aliasRows || "| none |  |  |  |  |",
    "",
    "## Alias Conflicts",
    "",
    "| alias | owners | curated ruling | note |",
    "|---|---|---|---|",
    conflictRows || "| none |  |  |  |",
    "",
    "## Curated Alias Rulings",
    "",
    "| alias | decision | target | matched conflict | seen in aliases | note |",
    "|---|---|---|---|---|---|",
    curatedRulingRows || "| none |  |  |  |  |  |",
    "",
    "## Tag Candidates",
    "",
    "| tag | classification | count | pages | sample pages | action |",
    "|---|---|---:|---:|---|---|",
    tagRows || "| none |  | 0 | 0 |  |  |",
    "",
    "## Abbreviation Candidates",
    "",
    "| abbreviation | classification | confidence | count | pages | sample pages | action |",
    "|---|---|---|---:|---:|---|---|",
    abbreviationRows || "| none |  |  | 0 | 0 |  |  |",
    "",
    "## Concept Hierarchy Rules",
    "",
    "| root | children / slices | principle |",
    "|---|---|---|",
    hierarchyRows || "| none |  |  |",
  ].join("\n")
}

export async function runTemporalFactsAudit(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const topN = parsePositiveInteger(options.topN ?? options.top, 50)
  const generatedAt = nowLocalTimestamp()
  const pages = await collectTemporalAuditWikiPages(projectPath, options)
  const predicateCandidates = auditPredicateCandidatesFromPages(pages, options)
  const { aliasCandidates, aliasConflicts, curatedAliasRulings, tagCandidates, abbreviationCandidates } = auditAliasCandidatesFromPages(pages)
  const result = {
    schema: "temporal-facts-audit-v1",
    generatedAt,
    projectPath,
    counts: {
      wikiFiles: pages.length,
      predicateCandidates: predicateCandidates.length,
      aliasCandidates: aliasCandidates.length,
      aliasConflicts: aliasConflicts.length,
      curatedAliasRulings: curatedAliasRulings.length,
      tagCandidates: tagCandidates.length,
      abbreviationCandidates: abbreviationCandidates.length,
      conceptHierarchyRules: TEMPORAL_AUDIT_CONCEPT_HIERARCHIES.length,
    },
    predicateCandidates,
    aliasCandidates,
    aliasConflicts,
    curatedAliasRulings,
    tagCandidates,
    abbreviationCandidates,
    conceptHierarchyRules: TEMPORAL_AUDIT_CONCEPT_HIERARCHIES,
    outputs: null,
  }
  const markdown = buildTemporalFactsAuditMarkdown(result, topN)
  if (options.write) {
    const stamp = generatedAt.replace(/[: ]/g, "-")
    const reportId = options.reportId ?? `audit-${stamp}`
    const outputDir = path.join(projectPath, TEMPORAL_FACT_AUDIT_ROOT)
    const jsonPath = path.join(outputDir, `${reportId}.json`)
    const markdownPath = path.join(outputDir, `${reportId}.md`)
    result.outputs = {
      json: projectRelative(projectPath, jsonPath),
      markdown: projectRelative(projectPath, markdownPath),
    }
    await writeJson(jsonPath, result)
    await ensureDirectory(outputDir)
    await fs.writeFile(markdownPath, markdown, "utf8")
  }
  return { ...result, markdown }
}

export function normalizeConceptRulePath(raw) {
  const value = String(raw ?? "").trim()
  if (!value) return null
  if (value.startsWith("wiki/")) return assertSafeWikiPath(value)
  const title = value
    .replace(/^概念\//, "")
    .replace(/\.md$/i, "")
    .trim()
  if (!title) return null
  return assertSafeWikiPath(`wiki/概念/${title}.md`)
}

export function conceptRuleTitle(relativePath) {
  return path.posix.basename(relativePath, ".md")
}

export function normalizeConceptDuplicateKey(value) {
  return normalizeEntityAlias(value)
    .toLowerCase()
    .replace(/[.\-—–_·・/\\:：()[\]{}（）【】"'“”‘’]/g, "")
}

export function conceptRouteMode(rule, fallback = "review") {
  return String(rule?.mode ?? fallback).trim().toLowerCase()
}

export function conceptRuleSummary(rule) {
  const out = {
    type: rule.type,
    mode: rule.mode,
    auto: Boolean(rule.auto),
    reason: rule.reason ?? "",
  }
  if (rule.fromPath) out.fromPath = rule.fromPath
  if (rule.toPath) out.toPath = rule.toPath
  if (rule.childPath) out.childPath = rule.childPath
  if (rule.parentPath) out.parentPath = rule.parentPath
  if (rule.slicePath) out.slicePath = rule.slicePath
  return out
}

export function normalizeConceptCanonicalRulings(parsed, configPath) {
  const rules = []
  const warnings = []
  const addRule = (rule) => {
    if (!rule) return
    rules.push(rule)
  }

  for (const item of Array.isArray(parsed?.sameAs) ? parsed.sameAs : []) {
    const fromPath = normalizeConceptRulePath(item.from)
    const toPath = normalizeConceptRulePath(item.to)
    if (!fromPath || !toPath) {
      warnings.push(`Skipped invalid sameAs rule in ${configPath}`)
      continue
    }
    const mode = conceptRouteMode(item, "auto")
    addRule({
      type: "sameAs",
      mode,
      auto: mode === "auto",
      fromPath,
      toPath,
      reason: item.reason ?? "Same concept.",
    })
  }

  for (const item of Array.isArray(parsed?.mergeInto) ? parsed.mergeInto : []) {
    const fromPath = normalizeConceptRulePath(item.from)
    const toPath = normalizeConceptRulePath(item.to)
    if (!fromPath || !toPath) {
      warnings.push(`Skipped invalid mergeInto rule in ${configPath}`)
      continue
    }
    const mode = conceptRouteMode(item, "review")
    addRule({
      type: "mergeInto",
      mode,
      auto: mode === "auto",
      fromPath,
      toPath,
      reason: item.reason ?? "Merge candidate; review before auto-routing.",
    })
  }

  for (const item of Array.isArray(parsed?.childOf) ? parsed.childOf : []) {
    const childPath = normalizeConceptRulePath(item.child)
    const parentPath = normalizeConceptRulePath(item.parent)
    if (!childPath || !parentPath) {
      warnings.push(`Skipped invalid childOf rule in ${configPath}`)
      continue
    }
    addRule({
      type: "childOf",
      mode: "review",
      auto: false,
      childPath,
      parentPath,
      reason: item.reason ?? "Child concept; do not merge automatically.",
    })
  }

  for (const item of Array.isArray(parsed?.tradeSliceOf) ? parsed.tradeSliceOf : []) {
    const slicePath = normalizeConceptRulePath(item.slice)
    const parentPath = normalizeConceptRulePath(item.parent)
    if (!slicePath || !parentPath) {
      warnings.push(`Skipped invalid tradeSliceOf rule in ${configPath}`)
      continue
    }
    addRule({
      type: "tradeSliceOf",
      mode: "review",
      auto: false,
      slicePath,
      parentPath,
      reason: item.reason ?? "Trading slice; keep independent.",
    })
  }

  const routingHints = (Array.isArray(parsed?.routingHints) ? parsed.routingHints : [])
    .map((item) => ({
      match: String(item.match ?? "").trim(),
      path: normalizeConceptRulePath(item.path),
      reason: item.reason ?? "",
    }))
    .filter((item) => item.match && item.path)

  const byPath = new Map()
  const addByPath = (relativePath, rule) => {
    const rows = byPath.get(relativePath) ?? []
    rows.push(rule)
    byPath.set(relativePath, rows)
  }
  for (const rule of rules) {
    if (rule.fromPath) addByPath(rule.fromPath, rule)
    if (rule.childPath) addByPath(rule.childPath, rule)
    if (rule.slicePath) addByPath(rule.slicePath, rule)
  }

  return {
    schema: parsed?.schema ?? null,
    version: parsed?.version ?? null,
    configPath,
    rules,
    byPath,
    routingHints,
    warnings,
    counts: {
      sameAs: rules.filter((item) => item.type === "sameAs").length,
      mergeInto: rules.filter((item) => item.type === "mergeInto").length,
      childOf: rules.filter((item) => item.type === "childOf").length,
      tradeSliceOf: rules.filter((item) => item.type === "tradeSliceOf").length,
      routingHints: routingHints.length,
      autoRoutes: rules.filter((item) => item.auto).length,
    },
  }
}

export async function loadConceptCanonicalRulings(options = {}) {
  const configPath = normalizePath(
    options.conceptRulingsPath ??
      options.rulesPath ??
      process.env.TRADING_WIKI_CONCEPT_RULINGS_PATH ??
      DEFAULT_CONCEPT_RULINGS_PATH,
  )
  const raw = await readIfExists(configPath)
  if (!raw.trim()) {
    return normalizeConceptCanonicalRulings({ schema: CONCEPT_CANONICAL_RULINGS_SCHEMA }, configPath)
  }
  const parsed = JSON.parse(raw)
  if (parsed.schema && parsed.schema !== CONCEPT_CANONICAL_RULINGS_SCHEMA) {
    throw new Error(`Unsupported concept rulings schema: ${parsed.schema}`)
  }
  return normalizeConceptCanonicalRulings(parsed, configPath)
}

export function conceptGovernanceForPath(context, relativePath) {
  const pathKey = toPosixPath(relativePath)
  const rules = context?.byPath?.get(pathKey) ?? []
  if (!rules.length) return null
  const autoRule = rules.find((rule) => rule.auto && rule.toPath && rule.toPath !== pathKey)
  return {
    path: pathKey,
    canonicalPath: autoRule?.toPath ?? null,
    autoRoute: Boolean(autoRule),
    rules: rules.map(conceptRuleSummary),
  }
}

export function collectConceptGovernanceCandidateHints(context, candidates) {
  const paths = new Set()
  for (const item of candidates?.wikiCandidates ?? []) paths.add(item.path)
  for (const segment of candidates?.segments ?? []) {
    for (const item of segment.wikiCandidates ?? []) paths.add(item.path)
  }
  return [...paths]
    .map((relativePath) => conceptGovernanceForPath(context, relativePath))
    .filter(Boolean)
    .sort((a, b) => Number(b.autoRoute) - Number(a.autoRoute) || a.path.localeCompare(b.path))
}

export function annotateConceptGovernanceCandidate(item, context) {
  const governance = conceptGovernanceForPath(context, item.path)
  return governance ? { ...item, conceptGovernance: governance } : item
}

export function annotateConceptGovernanceCandidateResults(candidates, context) {
  const annotated = {
    ...candidates,
    wikiCandidates: (candidates.wikiCandidates ?? []).map((item) => annotateConceptGovernanceCandidate(item, context)),
    segments: (candidates.segments ?? []).map((segment) => ({
      ...segment,
      wikiCandidates: (segment.wikiCandidates ?? []).map((item) => annotateConceptGovernanceCandidate(item, context)),
    })),
  }
  annotated.conceptGovernance = {
    configPath: context.configPath,
    counts: context.counts,
    warnings: context.warnings,
    candidateHints: collectConceptGovernanceCandidateHints(context, annotated),
  }
  return annotated
}

export function formatConceptGovernanceContextMarkdown(context) {
  if (!context) return "## Concept Governance\n\n- none"
  const hintRows = (context.candidateHints ?? [])
    .slice(0, 20)
    .map((item) => {
      const ruleText = item.rules
        .slice(0, 3)
        .map((rule) => `${rule.type}${rule.auto ? "/auto" : ""}${rule.toPath ? ` -> ${rule.toPath}` : ""}${rule.parentPath ? ` parent=${rule.parentPath}` : ""}: ${rule.reason}`)
        .join(" | ")
      return `- ${item.path}${item.autoRoute ? ` -> ${item.canonicalPath}` : ""} | ${ruleText}`
    })
    .join("\n")
  return [
    "## Concept Governance",
    "",
    `- configPath: ${context.configPath}`,
    `- counts: sameAs=${context.counts?.sameAs ?? 0}; mergeInto=${context.counts?.mergeInto ?? 0}; childOf=${context.counts?.childOf ?? 0}; tradeSliceOf=${context.counts?.tradeSliceOf ?? 0}; autoRoutes=${context.counts?.autoRoutes ?? 0}`,
    "- Policy: sameAs/auto may rewrite ingest plans; mergeInto, childOf, and tradeSliceOf are guidance unless explicitly mode:auto.",
    "",
    "### Candidate Hints",
    hintRows || "- none",
  ].join("\n")
}

export async function applyConceptGovernanceToNormalizedPlan(projectPath, plan, options = {}) {
  const context = options.context ?? await loadConceptCanonicalRulings(options)
  const conceptRouting = []

  async function routeItem(item) {
    const governance = conceptGovernanceForPath(context, item.path)
    const autoRule = governance?.rules?.find((rule) => rule.auto && rule.toPath && rule.toPath !== item.path)
    if (!autoRule) {
      if (governance) {
        conceptRouting.push({
          originalPath: item.path,
          routedPath: item.path,
          ruleType: governance.rules[0]?.type ?? "review",
          mode: "review",
          auto: false,
          reason: governance.rules[0]?.reason ?? "",
        })
        return { ...item, conceptRouting: governance }
      }
      return item
    }
    const routedPath = assertSafeWikiPath(autoRule.toPath)
    const targetExists = await exists(path.join(projectPath, routedPath))
    conceptRouting.push({
      originalPath: item.path,
      routedPath,
      ruleType: autoRule.type,
      mode: autoRule.mode,
      auto: true,
      reason: autoRule.reason ?? "",
    })
    return {
      ...item,
      action: targetExists ? "update" : item.action,
      path: routedPath,
      title: conceptRuleTitle(routedPath),
      why: [item.why, `conceptRouting: ${item.path} -> ${routedPath} (${autoRule.type})`].filter(Boolean).join("；"),
      conceptRouting: governance,
    }
  }

  async function routeList(items) {
    const byPath = new Map()
    for (const item of items ?? []) {
      const routed = await routeItem(item)
      const existing = byPath.get(routed.path)
      if (!existing) {
        byPath.set(routed.path, routed)
        continue
      }
      existing.why = [...new Set([existing.why, routed.why].filter(Boolean))].join("；")
      existing.conceptRouting = existing.conceptRouting ?? routed.conceptRouting
    }
    return [...byPath.values()]
  }

  const routedItems = await routeList([
    ...(plan.update ?? []).map((item) => ({ ...item, action: item.action ?? "update" })),
    ...(plan.create ?? []).map((item) => ({ ...item, action: item.action ?? "create" })),
  ])
  return {
    ...plan,
    update: routedItems.filter((item) => item.action === "update"),
    create: routedItems.filter((item) => item.action !== "update"),
    factWrites: plan.factWrites ?? [],
    conceptRouting,
  }
}

export function buildConceptGovernanceAuditMarkdown(result, topN = 80) {
  const duplicateRows = result.duplicateTitleGroups
    .slice(0, topN)
    .map((item) => `| ${item.key} | ${item.pages.map((page) => `${page.title} (${page.path})`).join("<br>")} | ${item.suggestedAction} |`)
    .join("\n")
  const aliasRows = result.aliasTitleConflicts
    .slice(0, topN)
    .map((item) => `| ${item.alias} | ${item.owner.title} (${item.owner.path}) | ${item.matches.map((page) => `${page.title} (${page.path})`).join("<br>")} | review |`)
    .join("\n")
  const containmentRows = result.containmentPairs
    .slice(0, topN)
    .map((item) => `| ${item.parent.title} (${item.parent.path}) | ${item.child.title} (${item.child.path}) | ${item.ratio} | childOf review |`)
    .join("\n")
  const ruleRows = result.ruleCoverage
    .map((item) => `| ${item.type} | ${item.fromPath ?? item.childPath ?? item.slicePath ?? ""} | ${item.toPath ?? item.parentPath ?? ""} | ${item.mode} | ${item.auto ? "yes" : "no"} | ${item.sourceExists ? "yes" : "no"} | ${item.targetExists ? "yes" : "no"} | ${item.reason ?? ""} |`)
    .join("\n")
  return [
    "# Concept Governance Audit",
    "",
    `- generatedAt: ${result.generatedAt}`,
    `- projectPath: ${result.projectPath}`,
    `- rulingsPath: ${result.rulingsPath}`,
    `- conceptPages: ${result.counts.conceptPages}`,
    `- duplicateTitleGroups: ${result.counts.duplicateTitleGroups}`,
    `- aliasTitleConflicts: ${result.counts.aliasTitleConflicts}`,
    `- containmentPairs: ${result.counts.containmentPairs}`,
    `- configuredRules: ${result.counts.configuredRules}`,
    `- autoRoutes: ${result.counts.autoRoutes}`,
    "",
    "## Review Policy",
    "",
    "- sameAs/auto can rewrite future ingest plans.",
    "- mergeInto is review-only unless the rule explicitly says mode:auto.",
    "- childOf and tradeSliceOf are never automatic merges.",
    "- This audit report does not change wiki pages or raw files.",
    "",
    "## Configured Rule Coverage",
    "",
    "| type | source | target/parent | mode | auto | source exists | target exists | reason |",
    "|---|---|---|---|---|---|---|---|",
    ruleRows || "| none |  |  |  |  |  |  |  |",
    "",
    "## Duplicate / Punctuation Variant Candidates",
    "",
    "| normalized key | pages | suggested action |",
    "|---|---|---|",
    duplicateRows || "| none |  |  |",
    "",
    "## Alias-Title Conflicts",
    "",
    "| alias | alias owner | title matches | suggested action |",
    "|---|---|---|---|",
    aliasRows || "| none |  |  |  |",
    "",
    "## Parent-Child Containment Candidates",
    "",
    "| possible parent | possible child | ratio | suggested action |",
    "|---|---|---:|---|",
    containmentRows || "| none |  | 0 |  |",
  ].join("\n")
}

export async function runConceptGovernanceAudit(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const topN = parsePositiveInteger(options.topN ?? options.top, 80)
  const generatedAt = nowLocalTimestamp()
  const pages = (await collectTemporalAuditWikiPages(projectPath, options))
    .filter((page) => page.path.startsWith("wiki/概念/"))
    .map((page) => ({
      ...page,
      key: normalizeConceptDuplicateKey(page.title),
      aliases: extractTemporalAuditAliases({ title: page.title, fm: page.fm }).map((item) => item.alias),
      chars: page.content.length,
    }))

  const byTitleKey = new Map()
  for (const page of pages) {
    const group = byTitleKey.get(page.key) ?? []
    group.push(page)
    byTitleKey.set(page.key, group)
  }
  const duplicateTitleGroups = [...byTitleKey.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([key, group]) => ({
      key,
      suggestedAction: "sameAs review; auto only after explicit ruling",
      pages: group.map((page) => ({ path: page.path, title: page.title, chars: page.chars })).sort((a, b) => a.path.localeCompare(b.path)),
    }))
    .sort((a, b) => b.pages.length - a.pages.length || a.key.localeCompare(b.key))

  const titleByAliasKey = new Map(pages.map((page) => [normalizeEntityAlias(page.title).toLowerCase(), page]))
  const aliasTitleConflicts = []
  for (const page of pages) {
    for (const alias of page.aliases) {
      const match = titleByAliasKey.get(normalizeEntityAlias(alias).toLowerCase())
      if (!match || match.path === page.path) continue
      aliasTitleConflicts.push({
        alias,
        owner: { path: page.path, title: page.title },
        matches: [{ path: match.path, title: match.title }],
      })
    }
  }
  aliasTitleConflicts.sort((a, b) => a.alias.localeCompare(b.alias) || a.owner.path.localeCompare(b.owner.path))

  const containmentPairs = []
  for (const parent of pages) {
    if (parent.key.length < 2) continue
    for (const child of pages) {
      if (parent.path === child.path || child.key.length < 4 || parent.key === child.key) continue
      if (!child.key.includes(parent.key)) continue
      const ratio = parent.key.length / child.key.length
      if (ratio < 0.4) continue
      containmentPairs.push({
        parent: { path: parent.path, title: parent.title },
        child: { path: child.path, title: child.title },
        ratio: Number(ratio.toFixed(2)),
      })
    }
  }
  containmentPairs.sort((a, b) => b.ratio - a.ratio || a.parent.path.localeCompare(b.parent.path))

  const rulings = await loadConceptCanonicalRulings(options)
  const ruleCoverage = await Promise.all(rulings.rules.map(async (rule) => {
    const sourcePath = rule.fromPath ?? rule.childPath ?? rule.slicePath
    const targetPath = rule.toPath ?? rule.parentPath
    return {
      ...conceptRuleSummary(rule),
      sourceExists: sourcePath ? await exists(path.join(projectPath, sourcePath)) : false,
      targetExists: targetPath ? await exists(path.join(projectPath, targetPath)) : false,
    }
  }))

  const result = {
    schema: "concept-governance-audit-v1",
    generatedAt,
    projectPath,
    rulingsPath: rulings.configPath,
    counts: {
      conceptPages: pages.length,
      duplicateTitleGroups: duplicateTitleGroups.length,
      aliasTitleConflicts: aliasTitleConflicts.length,
      containmentPairs: containmentPairs.length,
      configuredRules: rulings.rules.length,
      autoRoutes: rulings.rules.filter((item) => item.auto).length,
    },
    duplicateTitleGroups,
    aliasTitleConflicts,
    containmentPairs,
    ruleCoverage,
    outputs: null,
  }
  const markdown = buildConceptGovernanceAuditMarkdown(result, topN)
  if (options.write) {
    const stamp = generatedAt.replace(/[: ]/g, "-")
    const reportId = options.reportId ?? `audit-${stamp}`
    const outputDir = path.join(projectPath, CONCEPT_GOVERNANCE_ROOT)
    const jsonPath = path.join(outputDir, `${reportId}.json`)
    const markdownPath = path.join(outputDir, `${reportId}.md`)
    result.outputs = {
      json: projectRelative(projectPath, jsonPath),
      markdown: projectRelative(projectPath, markdownPath),
    }
    await writeJson(jsonPath, result)
    await ensureDirectory(outputDir)
    await fs.writeFile(markdownPath, markdown, "utf8")
  }
  return { ...result, markdown }
}

export async function findLargeWikiMarkdown(projectPath, minBytes = 100 * 1024) {
  const wikiRoot = path.join(projectPath, "wiki")
  const files = await listFilesRecursive(wikiRoot, {
    extensions: new Set([".md"]),
    excludeDirNames: new Set([".git", ".llm-wiki", ".obsidian"]),
  })
  const rows = []
  for (const filePath of files) {
    const stat = await fs.stat(filePath)
    if (stat.size < minBytes) continue
    rows.push({
      relativePath: projectRelative(projectPath, filePath),
      bytes: stat.size,
    })
  }
  return rows.sort((a, b) => b.bytes - a.bytes).slice(0, 50)
}

export async function listSuccessfulIngestReportDirs(projectPath, keepDays) {
  const root = path.join(projectPath, REPORT_ROOT)
  let entries
  try {
    entries = await fs.readdir(root, { withFileTypes: true })
  } catch {
    return []
  }
  const now = Date.now()
  const minAgeMs = keepDays * 24 * 60 * 60 * 1000
  const candidates = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dirPath = path.join(root, entry.name)
    const reportPath = path.join(dirPath, "apply-report.json")
    if (!(await exists(reportPath))) continue
    const stat = await fs.stat(dirPath)
    const ageMs = Math.max(0, now - stat.mtimeMs)
    if (ageMs < minAgeMs) continue
    candidates.push({
      type: "delete_dir",
      relativePath: projectRelative(projectPath, dirPath),
      bytes: await pathSizeBytes(dirPath),
      ageDays: Number((ageMs / (24 * 60 * 60 * 1000)).toFixed(1)),
      reason: `successful codex-ingest report older than ${keepDays} days`,
    })
  }
  return candidates.sort((a, b) => b.bytes - a.bytes)
}

export function assertSafeHygieneDelete(relativePath) {
  const normalized = toPosixPath(relativePath).replace(/^\/+/, "")
  if (!normalized.startsWith(`${REPORT_ROOT}/`)) {
    throw new Error(`Refusing hygiene delete outside ${REPORT_ROOT}: ${relativePath}`)
  }
  if (normalized.includes("..")) throw new Error(`Refusing path traversal: ${relativePath}`)
  return normalized
}

export async function buildHygieneAudit(projectPath, keepDays) {
  const targets = {
    codexIngestReports: await pathMetric(projectPath, REPORT_ROOT),
    lancedb: await pathMetric(projectPath, ".llm-wiki/lancedb"),
    lancedbVersions: await pathMetric(projectPath, ".llm-wiki/lancedb/wiki_vectors.lance/_versions"),
    lancedbTransactions: await pathMetric(projectPath, ".llm-wiki/lancedb/wiki_vectors.lance/_transactions"),
    backups: await pathMetric(projectPath, ".llm-wiki/backups"),
    cache: await pathMetric(projectPath, ".llm-wiki/cache"),
    raw: await pathMetric(projectPath, "raw"),
    wiki: await pathMetric(projectPath, "wiki"),
    legacyLog: await pathMetric(projectPath, "wiki/log.md"),
  }
  return {
    keepDays,
    targets,
    largeWikiMarkdown: await findLargeWikiMarkdown(projectPath),
    safety: {
      rawWrites: "never",
      wikiBodyCompression: "candidate-report-only",
      formalWikiPages: "not cleaned by hygiene",
      applyScope: `${REPORT_ROOT}/ successful report directories only`,
    },
  }
}

export async function buildHygienePlan(projectPath, keepDays) {
  return {
    actions: await listSuccessfulIngestReportDirs(projectPath, keepDays),
    notes: [
      "No raw/** files are written or deleted.",
      "No formal wiki/** pages are compressed or deleted.",
      "LanceDB index maintenance is reported here; clear/rebuild is handled by vector maintenance commands.",
    ],
  }
}

export async function runHygiene(options = {}) {
  const action = options.action ?? "audit"
  if (!["audit", "plan", "apply"].includes(action)) {
    throw new Error("Unknown hygiene action. Use audit, plan, or apply.")
  }
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const keepDays = parsePositiveInteger(options.keepDays, 14)
  const audit = await buildHygieneAudit(projectPath, keepDays)
  const plan = action === "audit" ? { actions: [], notes: [] } : await buildHygienePlan(projectPath, keepDays)
  const write = Boolean(options.write)
  const result = {
    action,
    projectPath,
    generatedAt: nowLocalTimestamp(),
    dryRun: action !== "apply" || !write,
    audit,
    plan,
    applied: [],
  }

  if (action !== "apply" || !write) return result

  for (const planned of plan.actions) {
    if (planned.type !== "delete_dir") continue
    const safePath = assertSafeHygieneDelete(planned.relativePath)
    const fullPath = path.join(projectPath, safePath)
    await fs.rm(fullPath, { recursive: true, force: true })
    result.applied.push({ ...planned, relativePath: safePath })
  }
  return result
}

export function normalizeTypeAlias(raw) {
  if (!raw) return null
  const trimmed = String(raw).trim()
  return TYPE_ALIASES.get(trimmed) ?? TYPE_ALIASES.get(trimmed.toLowerCase()) ?? null
}

export function normalizeStatusAlias(raw) {
  if (!raw) return null
  const trimmed = String(raw).trim()
  return STATUS_ALIASES.get(trimmed) ?? STATUS_ALIASES.get(trimmed.toLowerCase()) ?? null
}

export function inferTypeFromPath(filePath) {
  const norm = toPosixPath(filePath)
  const match = norm.match(/(?:^|\/)wiki\/([^/]+)\//)
  return normalizeTypeAlias(match?.[1] ?? "") ?? "总结"
}

export function stripYamlWrapper(raw) {
  const match = raw.match(/^```yaml\s*\r?\n([\s\S]*?)\r?\n```\s*\r?\n?/)
  if (!match) return { content: raw, stripped: false }
  return { content: match[1], stripped: true }
}

export function parseFrontmatter(markdown) {
  const { content, stripped } = stripYamlWrapper(markdown)
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!match) return { fm: {}, body: content, hadYamlWrapper: stripped }
  let fm = {}
  try {
    const parsed = parseYaml(match[1])
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) fm = parsed
  } catch {
    fm = {}
  }
  return { fm, body: content.slice(match[0].length), hadYamlWrapper: stripped }
}

export function serializeFrontmatter(fm, body) {
  const yaml = stringifyYaml(fm, { lineWidth: 0 }).trimEnd()
  const cleanBody = body.startsWith("\n") ? body.slice(1) : body
  return `---\n${yaml}\n---\n\n${cleanBody}`
}

export function cleanSources(raw) {
  if (!Array.isArray(raw)) return []
  const seen = new Set()
  const out = []
  for (const item of raw) {
    if (typeof item !== "string") continue
    let source = item.trim()
    if (!source) continue
    if (source.includes("]]") || source.includes("：")) continue
    if (/^(好的|以下是|这份|现在写入)/.test(source)) continue
    source = source.replace(/\.md$/i, "")
    source = source.replace(/-\d+$/, "")
    if (source.length > 60) source = `${source.slice(0, 40)}...`
    if (!seen.has(source)) {
      seen.add(source)
      out.push(source)
    }
  }
  return out
}

export function validateFrontmatter(fm, filePath = "") {
  const violations = []
  const add = (field, message, fatal = true) => violations.push({ field, message, fatal })

  if (fm.schema_version !== 1) add("schema_version", "must be 1")
  if (!fm.title || typeof fm.title !== "string") add("title", "missing title")

  const normalizedType = normalizeTypeAlias(fm.type)
  if (!normalizedType) add("type", `must be one of: ${WIKI_TYPES.join(" / ")}`)

  if (typeof fm.summary !== "string" || fm.summary.trim().length === 0) {
    add("summary", "missing summary")
  } else {
    const len = [...fm.summary].length
    if (len < SUMMARY_MIN || len > SUMMARY_MAX) {
      add("summary", `summary should be ${SUMMARY_MIN}-${SUMMARY_MAX} characters`, false)
    }
  }

  for (const field of ["created", "updated", "last_reviewed"]) {
    const value = fm[field]
    if (typeof value !== "string" || !TIMESTAMP_REGEX.test(value)) {
      add(field, "must use YYYY-MM-DD HH:mm:ss")
    }
  }

  if (!CONFIDENCE.includes(fm.confidence)) add("confidence", `must be one of: ${CONFIDENCE.join(" / ")}`)

  const normalizedStatus = normalizeStatusAlias(fm.status)
  if (!normalizedStatus) add("status", `must be one of: ${WIKI_STATUS.join(" / ")}`)

  if (normalizedType === "股票") {
    if (typeof fm.code !== "string" || !STOCK_CODE_REGEX.test(fm.code)) {
      add("code", "stock pages require code like SZ000001, HK09992, or AAPL")
    }
  }

  for (const [field, expectedArray] of [
    ["aliases", false],
    ["tags", false],
    ["related", true],
    ["sources", false],
  ]) {
    if (fm[field] == null) continue
    if (!Array.isArray(fm[field])) {
      add(field, "must be an array")
      continue
    }
    if (expectedArray) {
      for (const item of fm[field]) {
        if (typeof item !== "string" || !WIKILINK_REGEX.test(item)) {
          add(field, `invalid wikilink in ${field}: ${String(item)}`)
        }
      }
    }
  }

  if (filePath) {
    const typeFromPath = inferTypeFromPath(filePath)
    if (normalizedType && typeFromPath !== "总结" && normalizedType !== typeFromPath) {
      add("type", `type ${normalizedType} does not match path type ${typeFromPath}`, false)
    }
  }

  if (fm.visibility != null && !["team", "personal"].includes(fm.visibility)) {
    add("visibility", "must be team or personal", false)
  }
  if (fm.entity_key != null && (typeof fm.entity_key !== "string" || !fm.entity_key.trim())) {
    add("entity_key", "must be a non-empty string", false)
  }

  return violations
}

export function validateWikiContent(relativePath, content) {
  if (isReservedWikiPath(relativePath)) return []
  if (!relativePath.startsWith("wiki/") || !relativePath.endsWith(".md")) return []
  const { fm, body } = parseFrontmatter(content)
  const issues = validateFrontmatter(fm, relativePath)
  const bodyLineCount = countBodyLines(body)
  if (bodyLineCount > PAGE_BODY_LINE_SOFT_LIMIT) {
    issues.push({
      field: "body_lines",
      message: `body has ${bodyLineCount} lines; soft limit is ${PAGE_BODY_LINE_SOFT_LIMIT}`,
      fatal: false,
    })
  }
  return issues
}

export function countBodyLines(body) {
  const trimmed = String(body ?? "").replace(/^\s+|\s+$/g, "")
  if (!trimmed) return 0
  return trimmed.split(/\r?\n/).length
}

export function countAllLines(text) {
  if (!text) return 0
  return String(text).split(/\r?\n/).length
}

export function validatePreserveLargeHousekeepingPage(relativePath, before, after) {
  if (!["wiki/index.md", "wiki/overview.md"].includes(relativePath)) return []
  const beforeLines = countAllLines(before)
  const afterLines = countAllLines(after)
  if (beforeLines < 50) return []
  if (afterLines >= Math.floor(beforeLines * 0.8)) return []
  return [
    {
      field: "preserve_existing_content",
      message: `${relativePath} would shrink from ${beforeLines} to ${afterLines} lines; keep existing content and append/merge instead`,
      fatal: true,
    },
  ]
}

export function extractTitle(content, filePath) {
  const fileName = path.basename(filePath)
  const { fm } = parseFrontmatter(content)
  if (typeof fm.title === "string" && fm.title.trim()) return fm.title.trim()
  const heading = content.match(/^#\s+(.+)$/m)
  if (heading) return heading[1].trim()
  return fileName.replace(/\.md$/i, "")
}

export function frontmatterSearchText(content) {
  const { fm } = parseFrontmatter(content)
  return [
    frontmatterFieldSearchText(fm, "title"),
    frontmatterFieldSearchText(fm, "type"),
    frontmatterFieldSearchText(fm, "summary"),
    frontmatterFieldSearchText(fm, "aliases"),
    frontmatterFieldSearchText(fm, "tags"),
    frontmatterFieldSearchText(fm, "related"),
    frontmatterFieldSearchText(fm, "sources"),
  ].filter(Boolean).join(" ")
}

export function frontmatterValues(fm, field) {
  const value = fm?.[field]
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean)
  if (typeof value === "string" || typeof value === "number") return [String(value).trim()].filter(Boolean)
  return []
}

export function frontmatterFieldSearchText(fm, field) {
  const values = frontmatterValues(fm, field)
  if (values.length === 0) return ""
  if (field === "related") {
    return values
      .flatMap((value) => [value, normalizeWikilinkTarget(value), normalizeWikilinkTarget(value).split("/").pop()])
      .filter(Boolean)
      .join(" ")
  }
  if (field === "sources") {
    return values
      .flatMap((value) => {
        const normalized = toPosixPath(value).replace(/\.md$/i, "")
        return [value, normalized, path.basename(normalized)]
      })
      .filter(Boolean)
      .join(" ")
  }
  return values.join(" ")
}

export function scoreFrontmatterStructure(fm, tokens) {
  const fieldWeights = new Map([
    ["title", 5],
    ["aliases", 5],
    ["tags", 5],
    ["related", 6],
    ["sources", 6],
    ["summary", 3],
    ["type", 2],
  ])
  let score = 0
  const matches = []

  for (const [field, weight] of fieldWeights) {
    const text = frontmatterFieldSearchText(fm, field)
    if (!text) continue
    const tokenScore = tokenMatchScore(text, tokens)
    if (tokenScore <= 0) continue
    score += tokenScore * weight
    score += topicCoverageBonus(text, tokens) * 0.8
    matches.push(field)
  }

  return {
    score,
    matches,
    sources: frontmatterValues(fm, "sources"),
    related: frontmatterValues(fm, "related"),
    tags: frontmatterValues(fm, "tags"),
  }
}

export function buildSnippet(content, tokens, maxLength = 180) {
  const lower = content.toLowerCase()
  const token = preferredEvidenceTokens(tokens).find((t) => lower.includes(t.toLowerCase()))
  if (!token) return content.slice(0, maxLength).replace(/\s+/g, " ").trim()
  const idx = lower.indexOf(token.toLowerCase())
  const start = Math.max(0, idx - 80)
  const end = Math.min(content.length, idx + token.length + 100)
  let snippet = content.slice(start, end).replace(/\s+/g, " ").trim()
  if (start > 0) snippet = `...${snippet}`
  if (end < content.length) snippet = `${snippet}...`
  return snippet
}

export function charLength(token) {
  return [...String(token ?? "")].length
}

export function isSingleCjkToken(token) {
  return charLength(token) === 1 && /[\u4e00-\u9fff\u3400-\u4dbf]/.test(token)
}

export function containsAnyToken(token, words) {
  for (const word of words) {
    if (word && token.includes(word)) return true
  }
  return false
}

export function tokenWeight(token) {
  const normalized = String(token ?? "").toLowerCase()
  const length = charLength(normalized)
  if (EVIDENCE_QUERY_TOKENS.has(normalized)) return 2.4
  if (ASK_TIME_TOKENS.has(normalized)) return 0.2
  if (GENERIC_QUERY_TOKENS.has(normalized)) return 0.15
  if (isSingleCjkToken(normalized)) return 0.05
  if (length > 4 && containsAnyToken(normalized, ASK_TIME_TOKENS)) return 0.35
  if (length > 4 && containsAnyToken(normalized, GENERIC_QUERY_TOKENS)) return 0.35
  if (length > 10 && /[\u4e00-\u9fff\u3400-\u4dbf]/.test(normalized)) return 0.35
  if (/[a-z0-9]/i.test(normalized)) return Math.min(3, 1 + length * 0.15)
  if (length >= 4) return 2.4
  if (length === 3) return 1.7
  return 1
}

export function preferredEvidenceTokens(tokens) {
  const uniq = [...new Set(tokens.map((token) => String(token).trim()).filter(Boolean))]
  const topical = uniq
    .filter((token) => tokenWeight(token) >= 1)
    .sort((a, b) => tokenWeight(b) - tokenWeight(a) || charLength(b) - charLength(a))
  return topical.length > 0 ? topical : uniq
}

export function titleCoverageBonus(titleText, tokens) {
  const topicalTokens = preferredEvidenceTokens(tokens)
    .filter((token) => !ASK_TIME_TOKENS.has(token))
    .slice(0, 8)
  if (topicalTokens.length === 0) return 0
  const lower = titleText.toLowerCase()
  const matched = topicalTokens.filter((token) => lower.includes(token.toLowerCase()))
  if (matched.length >= 2 && matched.length === topicalTokens.length) return 18
  if (matched.length >= 2) return matched.length * 5
  return 0
}

export function topicCoverageBonus(text, tokens) {
  const lower = text.toLowerCase()
  const matched = preferredEvidenceTokens(tokens)
    .slice(0, 14)
    .filter((token) => lower.includes(token.toLowerCase()))
  if (matched.length === 0) return 0

  let score = matched.reduce((sum, token) => sum + tokenWeight(token) * 1.8, 0)
  if (matched.length >= 2) score += 6
  if (matched.length >= 4) score += 6
  return score
}

export function rawPathQualityBonus(relativePath, title, tokens, options = {}) {
  const mode = normalizeRetrievalMode(options.mode)
  const normalizedPath = toPosixPath(relativePath).toLowerCase()
  const titleText = `${title} ${path.basename(relativePath)}`.toLowerCase()
  let score = 0

  const titleMatches = preferredEvidenceTokens(tokens)
    .slice(0, 12)
    .filter((token) => titleText.includes(token.toLowerCase()))
  if (titleMatches.length > 0) score += 18 + titleMatches.length * 5

  if (/(?:^|\/)(?:研报新闻|openclaw数据|产业链复盘|投研线索|日复盘)(?:\/|$)/.test(normalizedPath)) {
    score += 10
  }
  if (mode === RETRIEVAL_MODES.ASK && /(?:^|\/)微信聊天(?:\/|$)/.test(normalizedPath)) {
    score -= 15
  }

  return score
}

export function normalizeSourceReference(value) {
  return toPosixPath(String(value ?? ""))
    .trim()
    .replace(/^\/+/, "")
    .replace(/\.md$/i, "")
    .toLowerCase()
}

export function isWeakSourceReference(value) {
  const normalized = normalizeSourceReference(value)
  if (!normalized) return true
  if (/^\d{4}(?:-\d{2}){0,2}$/.test(normalized)) return true
  if (/^(?:today|yesterday|daily|review|think|source|raw)$/.test(normalized)) return true
  if (!normalized.includes("/") && normalized.length < 8) return true
  return false
}

export function sourceReferenceKeys(value) {
  const normalized = normalizeSourceReference(value)
  if (!normalized || isWeakSourceReference(normalized)) return []
  return [...new Set([normalized, path.posix.basename(normalized)].filter((item) => item.length >= 4))]
}

export function boostRawResultsByWikiStructure(rawResults, wikiResults) {
  const sourceKeys = new Map()
  for (const wiki of wikiResults.slice(0, 18)) {
    for (const source of wiki.frontmatterSources ?? []) {
      for (const key of sourceReferenceKeys(source)) {
        if (!sourceKeys.has(key)) sourceKeys.set(key, [])
        sourceKeys.get(key).push(wiki.path)
      }
    }
  }
  if (sourceKeys.size === 0) return

  for (const raw of rawResults) {
    const rawPath = normalizeSourceReference(raw.path)
    const rawTitle = String(raw.title ?? "").toLowerCase()
    const haystack = `${rawPath} ${path.posix.basename(rawPath)} ${rawTitle}`
    const matchedFrom = []
    for (const [key, wikiPaths] of sourceKeys) {
      if (!haystack.includes(key)) continue
      matchedFrom.push(...wikiPaths)
    }
    if (matchedFrom.length === 0) continue
    const uniqueFrom = [...new Set(matchedFrom)]
    raw.score += 26 + Math.min(uniqueFrom.length, 5) * 3
    raw.structuredSourceMatch = uniqueFrom.slice(0, 8)
  }
}

export function specificWikiTypeBonus(type) {
  if (["概念", "股票", "错误", "模式", "策略"].includes(type)) return 5
  if (["源文档", "总结", "查询"].includes(type)) return 0
  return 2
}

export function compactFrontmatterForEvidence(fm) {
  const rows = []
  for (const field of ["title", "type", "summary", "confidence", "status"]) {
    if (typeof fm[field] === "string" || typeof fm[field] === "number") rows.push(`${field}: ${fm[field]}`)
  }
  for (const field of ["aliases", "tags", "related", "sources"]) {
    if (Array.isArray(fm[field]) && fm[field].length > 0) {
      rows.push(`${field}: ${fm[field].slice(0, 18).map((item) => String(item)).join(", ")}`)
    }
  }
  return rows.join("\n")
}

export function buildEvidenceExcerpt(content, tokens, maxChars) {
  const { fm, body } = parseFrontmatter(content)
  const fmText = compactFrontmatterForEvidence(fm)
  const sourceText = body.trim() ? body : content
  const lower = sourceText.toLowerCase()
  const windows = []
  const usedRanges = []

  for (const token of preferredEvidenceTokens(tokens)) {
    if (windows.length >= 3) break
    const idx = lower.indexOf(token.toLowerCase())
    if (idx < 0) continue
    const start = Math.max(0, idx - 650)
    const end = Math.min(sourceText.length, idx + token.length + 1150)
    if (usedRanges.some(([a, b]) => Math.max(a, start) < Math.min(b, end))) continue
    usedRanges.push([start, end])
    windows.push(`${start > 0 ? "..." : ""}${sourceText.slice(start, end).trim()}${end < sourceText.length ? "..." : ""}`)
  }

  if (windows.length === 0 && sourceText.trim()) {
    windows.push(sourceText.slice(0, Math.min(sourceText.length, Math.max(900, maxChars - fmText.length - 120))).trim())
  }

  return truncateAtBoundary([fmText, ...windows].filter(Boolean).join("\n\n").replace(/\n{3,}/g, "\n\n"), maxChars)
}

export function wikiRelativePathToNodeId(relativePath) {
  const norm = toPosixPath(relativePath)
  if (!norm.startsWith("wiki/") || !norm.endsWith(".md")) return null
  return norm.slice("wiki/".length, -".md".length)
}

export function normalizeWikilinkTarget(raw) {
  return String(raw ?? "")
    .trim()
    .replace(/^\[\[|\]\]$/g, "")
    .split("|")[0]
    .trim()
    .replace(/^wiki\//, "")
    .replace(/\.md$/i, "")
}

export function extractWikilinkTargets(content) {
  const links = []
  const regex = /\[\[([^\]|]+?)(?:\|[^\]]+?)?\]\]/g
  let match
  while ((match = regex.exec(content)) !== null) {
    const target = normalizeWikilinkTarget(match[1])
    if (target) links.push(target)
  }
  return links
}

export function resolveGraphTarget(rawTarget, nodeIds, basenameIndex) {
  const target = normalizeWikilinkTarget(rawTarget)
  if (!target) return null
  if (nodeIds.has(target)) return target
  const basename = target.includes("/") ? target.split("/").pop() : target
  const byBase = basenameIndex.get(basename)
  if (byBase?.length === 1) return byBase[0]
  const normalized = basename.toLowerCase().replace(/\s+/g, "-")
  for (const id of nodeIds) {
    const idBase = id.includes("/") ? id.split("/").pop() : id
    const idLower = idBase.toLowerCase()
    if (idLower === basename.toLowerCase() || idLower.replace(/\s+/g, "-") === normalized) return id
  }
  return null
}

export function sortSearchResults(items) {
  return items.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    const dateA = a.path.match(/(\d{4})-(\d{2})-(\d{2})/)
    const dateB = b.path.match(/(\d{4})-(\d{2})-(\d{2})/)
    if (dateA && dateB) return dateB[0].localeCompare(dateA[0])
    if (dateB) return 1
    if (dateA) return -1
    return a.path.localeCompare(b.path)
  })
}

export function tokenizeQuery(query) {
  const rawTokens = query
    .toLowerCase()
    .split(/[\s,，。！？、；：""''（）()\-_/\\·~～…【】《》|*#>[\]{}]+/)
    .filter((token) => token.length > 1)
    .filter((token) => !STOP_WORDS.has(token))

  const tokens = []
  for (const token of rawTokens) {
    const hasCjk = /[\u4e00-\u9fff\u3400-\u4dbf]/.test(token)
    if (hasCjk && token.length > 2) {
      const chars = [...token]
      for (let i = 0; i < chars.length - 1; i++) tokens.push(chars[i] + chars[i + 1])
      for (let i = 0; i < chars.length - 2; i++) tokens.push(chars[i] + chars[i + 1] + chars[i + 2])
      for (const ch of chars) {
        if (!STOP_WORDS.has(ch)) tokens.push(ch)
      }
      tokens.push(token)
    } else {
      tokens.push(token)
    }
  }
  return [...new Set(tokens)]
}

export function tokenMatchScore(text, tokens) {
  const lower = text.toLowerCase()
  let score = 0
  for (const token of tokens) {
    if (lower.includes(token.toLowerCase())) score += tokenWeight(token)
  }
  return score
}

export function getRecencyBoost(fileName, query) {
  const dateMatch = fileName.match(/(\d{4})-(\d{2})-(\d{2})/)
  if (!dateMatch) return 0
  const fileDate = new Date(Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3]))
  const now = new Date()
  const diffDays = (now.getTime() - fileDate.getTime()) / 86400000

  let boost = 0
  if (diffDays <= 7) boost += 6
  else if (diffDays <= 30) boost += 3
  else if (diffDays <= 90) boost += 1

  const patterns = [
    { regex: /最近一?个?月|本月|这个月|近30天|近一个月/, days: 30 },
    { regex: /最近一?周|本周|这周|近7天/, days: 7 },
    { regex: /昨日|昨天/, days: 1 },
    { regex: /今天|当日/, days: 0 },
  ]
  for (const p of patterns) {
    if (p.regex.test(query)) {
      if (diffDays <= p.days) boost += 15
      break
    }
  }
  return boost
}

export const FRONTMATTER_FRESHNESS_FIELDS = ["updated", "last_reviewed", "created"]

export const FRONTMATTER_STALE_SENSITIVE_TYPES = new Set(["概念", "股票", "总结", "源文档", "查询"])

export const FRONTMATTER_STABLE_TYPES = new Set(["策略", "模式", "错误"])

export const FRESHNESS_SENSITIVE_QUERY_REGEX =
  /最新|最近|近期|今日|今天|当日|昨日|昨天|本周|这周|本月|这个月|近\s*\d+|近[一二三四五六七八九十两]+(?:天|日|周|月)|催化|订单|进展|变化|更新|量产|业绩|公告|调研|会议|研报|新闻|舆情|成交|量价|涨跌幅|放量|缩量|验证/

export function parseFrontmatterFreshnessDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return { date: value, value: value.toISOString().slice(0, 19).replace("T", " ") }
  }

  const text = String(value ?? "").trim().replace(/^['"]|['"]$/g, "")
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/)
  if (!match) return null
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4] ?? 12),
    Number(match[5] ?? 0),
    Number(match[6] ?? 0),
  )
  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== Number(match[1]) ||
    date.getMonth() !== Number(match[2]) - 1 ||
    date.getDate() !== Number(match[3])
  ) {
    return null
  }
  return { date, value: text }
}

export function frontmatterFreshnessTimestamp(fm) {
  const candidates = []
  for (const field of FRONTMATTER_FRESHNESS_FIELDS) {
    const parsed = parseFrontmatterFreshnessDate(fm?.[field])
    if (parsed) candidates.push({ ...parsed, field })
  }
  return candidates.sort((a, b) => b.date.getTime() - a.date.getTime())[0] ?? null
}

export function localDateOnly(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

export function frontmatterFreshnessScore(fm, query, type, now = new Date()) {
  const timestamp = frontmatterFreshnessTimestamp(fm)
  if (!timestamp) {
    return {
      score: 0,
      field: null,
      value: null,
      staleDays: null,
      timeSensitive: FRESHNESS_SENSITIVE_QUERY_REGEX.test(query),
    }
  }

  const diffDays = Math.max(
    0,
    Math.floor((localDateOnly(now).getTime() - localDateOnly(timestamp.date).getTime()) / 86400000),
  )
  const normalizedType = normalizeTypeAlias(type) ?? String(type ?? "")
  const timeSensitive = FRESHNESS_SENSITIVE_QUERY_REGEX.test(query)
  const stableType = FRONTMATTER_STABLE_TYPES.has(normalizedType)
  const staleSensitiveType = FRONTMATTER_STALE_SENSITIVE_TYPES.has(normalizedType)
  let score = 0

  if (diffDays <= 7) score += timeSensitive ? 10 : 4
  else if (diffDays <= 30) score += timeSensitive ? 6 : 2
  else if (diffDays <= 90) score += timeSensitive ? 2 : 1

  if (diffDays > 365) {
    if (timeSensitive) score -= stableType ? 2 : 10
    else if (staleSensitiveType) score -= 3
  } else if (diffDays > 180) {
    if (timeSensitive) score -= stableType ? 1 : 5
    else if (staleSensitiveType) score -= 1
  }

  return {
    score,
    field: timestamp.field,
    value: timestamp.value,
    staleDays: diffDays,
    timeSensitive,
  }
}

export function extractSourceSearchSeed(sourceContent, sourcePath) {
  const searchableContent = String(sourceContent ?? "").replace(/<\/?[a-z][^>\n]*>/gi, " ")
  const headings = searchableContent
    .split(/\r?\n/)
    .filter((line) => /^#{1,4}\s+/.test(line.trim()) || /^[-*]\s*\*\*.+\*\*/.test(line.trim()))
    .slice(0, 80)
    .join("\n")
  const lead = searchableContent.slice(0, 16000)
  return `${path.basename(sourcePath)}\n${headings}\n${lead}`
}

export function normalizeIngestToken(token) {
  return String(token ?? "")
    .trim()
    .replace(/^['"`*_#[\]()<>{}:：,，.。;；!?！？+-]+|['"`*_#[\]()<>{}:：,，.。;；!?！？+-]+$/g, "")
    .toLowerCase()
}

export function isUsefulIngestSourceToken(token) {
  const normalized = normalizeIngestToken(token)
  if (!normalized) return false
  const upper = normalized.toUpperCase()
  const length = charLength(normalized)
  if (INGEST_UPPERCASE_KEEP_TOKENS.has(upper)) return true
  if (STOP_WORDS.has(normalized) || ASK_TIME_TOKENS.has(normalized)) return false
  if (GENERIC_QUERY_TOKENS.has(normalized) || INGEST_GENERIC_SOURCE_TOKENS.has(normalized)) return false
  if (INGEST_SOURCE_FIELD_TOKENS.has(normalized)) return false
  if (/^\d+(?:\.\d+)?$/.test(normalized)) return false
  if (/^\d{4}(?:-\d{2}){0,2}$/.test(normalized)) return false
  if (/^[a-z0-9_.:-]+$/i.test(normalized)) {
    if (/[_.:-]/.test(normalized)) return false
    if (normalized.length <= 2) return false
    if (/^(?:cn|db|gt|md|html|http|https|www|com|mjs|json|txt|csv)$/.test(normalized)) return false
  }
  const cjkChars = normalized.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g)?.length ?? 0
  if (cjkChars === 1 && !/[a-z]{2,}/i.test(normalized)) return false
  if (cjkChars === 0 && !/[a-z]{3,}/i.test(normalized) && !INGEST_UPPERCASE_KEEP_TOKENS.has(upper)) return false
  if (length > 24) return false
  return true
}

export function extractSourceTopicSeed(sourceContent, sourcePath) {
  const { fm } = parseFrontmatter(sourceContent)
  const frontmatterHints = ["title", "name", "theme", "theme_name", "category_name"]
    .map((field) => (typeof fm[field] === "string" ? fm[field] : ""))
    .filter(Boolean)
  const basename = path.basename(sourcePath, path.extname(sourcePath))
  const pathHint = basename
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ")
    .replace(/\b\d{3,}\b/g, " ")
    .replace(/(?:^|[-_/])(?:晨报|复盘|非热门)(?=$|[-_/])/g, " ")
  const headings = sourceContent
    .split(/\r?\n/)
    .filter((line) => /^#{1,3}\s+/.test(line.trim()))
    .slice(0, 16)
    .join("\n")
  return [pathHint, ...frontmatterHints, headings].join("\n")
}

export function extractIngestPhraseTokens(text) {
  const tokens = []
  for (const seq of String(text ?? "").match(/[\u4e00-\u9fff\u3400-\u4dbf]{4,18}/g) ?? []) {
    const chars = [...seq]
    const maxN = Math.min(6, chars.length)
    for (let n = 4; n <= maxN; n++) {
      for (let i = 0; i <= chars.length - n; i++) {
        tokens.push(chars.slice(i, i + n).join(""))
      }
    }
    if (chars.length <= 10) tokens.push(seq)
  }
  return [...new Set(tokens)].filter(isUsefulIngestSourceToken)
}

export function ingestSourceTokenSortWeight(token, phraseOnly) {
  let weight = tokenWeight(token)
  if (/^[a-z0-9]+$/i.test(token) && charLength(token) >= 3) weight += 0.45
  if (INGEST_IMPORTANT_PHRASE_REGEX.test(token)) weight += 1.1
  if (phraseOnly && !INGEST_IMPORTANT_PHRASE_REGEX.test(token)) weight -= 1.2
  return weight
}

export function extractSourceTokens(sourceContent, sourcePath, maxTokens = 180) {
  const seed = extractSourceSearchSeed(sourceContent, sourcePath)
  const topicSeed = extractSourceTopicSeed(sourceContent, sourcePath)
  const topicTokens = [
    ...tokenizeQuery(topicSeed),
    ...extractIngestPhraseTokens(topicSeed),
  ].filter(isUsefulIngestSourceToken)
  const lexicalTokens = tokenizeQuery(seed).filter(isUsefulIngestSourceToken)
  const phraseTokens = extractIngestPhraseTokens(seed)
  const weighted = new Map()
  const phraseOnly = new Set()
  const lowerSeed = seed.toLowerCase()
  for (const token of lexicalTokens) {
    const normalized = normalizeIngestToken(token)
    if (!normalized) continue
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const count = (lowerSeed.match(new RegExp(escaped, "g")) ?? []).length
    weighted.set(normalized, Math.max(weighted.get(normalized) ?? 0, count))
  }
  for (const token of phraseTokens) {
    const normalized = normalizeIngestToken(token)
    if (!normalized || weighted.has(normalized)) continue
    weighted.set(normalized, INGEST_IMPORTANT_PHRASE_REGEX.test(normalized) ? 1.05 : 0.6)
    phraseOnly.add(normalized)
  }
  for (const token of topicTokens) {
    const normalized = normalizeIngestToken(token)
    if (!normalized) continue
    weighted.set(normalized, (weighted.get(normalized) ?? 0) + 18)
    phraseOnly.delete(normalized)
  }
  return [...weighted.entries()]
    .sort(
      (a, b) =>
        b[1] - a[1] ||
        ingestSourceTokenSortWeight(b[0], phraseOnly.has(b[0])) - ingestSourceTokenSortWeight(a[0], phraseOnly.has(a[0])) ||
        charLength(b[0]) - charLength(a[0]),
    )
    .map(([token]) => token)
    .slice(0, maxTokens)
}

export async function scoreFile({ filePath, projectPath, sourcePath, tokens, query, isRaw, mode }) {
  const retrievalMode = normalizeRetrievalMode(mode)
  let content
  try {
    content = await readTextFile(filePath)
  } catch {
    return null
  }

  const relativePath = projectRelative(projectPath, filePath)
  if (sourcePath && path.resolve(filePath) === path.resolve(sourcePath)) return null

  const title = extractTitle(content, filePath)
  const { fm } = parseFrontmatter(content)
  const type = normalizeTypeAlias(fm.type) ?? inferTypeFromPath(relativePath)
  const fmText = frontmatterSearchText(content)
  const fmStructure = scoreFrontmatterStructure(fm, tokens)
  const titleScore = tokenMatchScore(`${title} ${path.basename(filePath)}`, tokens)
  const contentScore = tokenMatchScore(content, tokens)
  const frontmatterScore = tokenMatchScore(fmText, tokens) * 1.5 + fmStructure.score
  let score = contentScore + frontmatterScore + topicCoverageBonus(content, tokens)
  if (titleScore > 0) score += 10 + titleScore
  score += titleCoverageBonus(`${title} ${path.basename(filePath)}`, tokens)
  if (isRaw && score > 0) score += 4 + rawPathQualityBonus(relativePath, title, tokens, { mode: retrievalMode })
  if (!isRaw && score > 0) score += specificWikiTypeBonus(type)
  let freshness = { score: 0, field: null, value: null, staleDays: null, timeSensitive: false }
  if (retrievalMode === RETRIEVAL_MODES.ASK) {
    freshness = frontmatterFreshnessScore(fm, query, type)
    if (score > 0) {
      score += getRecencyBoost(path.basename(filePath), query)
      score += freshness.score
    }
  }

  if (score <= 0) return null

  return {
    retrievalMode,
    path: relativePath,
    title,
    score,
    titleMatch: titleScore > 0,
    frontmatterMatch: frontmatterScore > 0,
    frontmatterMatches: fmStructure.matches,
    frontmatterSources: fmStructure.sources,
    frontmatterRelated: fmStructure.related,
    frontmatterTags: fmStructure.tags,
    frontmatterUpdated: freshness.value,
    frontmatterUpdatedField: freshness.field,
    staleDays: freshness.staleDays,
    freshnessScore: freshness.score,
    freshnessTimeSensitive: freshness.timeSensitive,
    raw: isRaw,
    type,
    snippet: buildSnippet(content, tokens),
  }
}

export function buildWikiRelatedResolver(projectPath, wikiFiles) {
  const byNodeId = new Map()
  const byBasename = new Map()
  for (const filePath of wikiFiles) {
    const relativePath = projectRelative(projectPath, filePath)
    const nodeId = wikiRelativePathToNodeId(relativePath)
    if (!nodeId) continue
    byNodeId.set(nodeId, relativePath)
    const basename = nodeId.split("/").pop()
    if (!byBasename.has(basename)) byBasename.set(basename, [])
    byBasename.get(basename).push(relativePath)
  }

  return (rawTarget) => {
    const target = normalizeWikilinkTarget(rawTarget)
    if (!target || target.startsWith("raw/")) return null
    if (byNodeId.has(target)) return byNodeId.get(target)
    const basename = target.split("/").pop()
    const basenameMatches = byBasename.get(basename) ?? []
    if (basenameMatches.length === 1) return basenameMatches[0]
    const lowerTarget = target.toLowerCase()
    return basenameMatches.find((relativePath) => wikiRelativePathToNodeId(relativePath)?.toLowerCase() === lowerTarget) ?? null
  }
}

export async function expandRelatedWikiCandidates({ projectPath, sourcePath, wikiFiles, wikiResults, tokens, query }) {
  if (wikiResults.length === 0) return []
  const resolveRelatedPath = buildWikiRelatedResolver(projectPath, wikiFiles)
  const byPath = new Map(wikiResults.map((item) => [item.path, item]))
  const relatedCandidates = []
  const seeds = sortSearchResults([...wikiResults]).filter((item) => item.type !== "总结").slice(0, 12)

  for (const seed of seeds) {
    for (const rawTarget of seed.frontmatterRelated ?? []) {
      const relatedPath = resolveRelatedPath(rawTarget)
      if (!relatedPath || isReservedWikiPath(relatedPath)) continue
      const inheritedScore = Math.max(1, seed.score * 0.38)
      const existing = byPath.get(relatedPath)
      if (existing) {
        existing.score = Math.max(existing.score, inheritedScore)
        existing.relatedFrom = [...new Set([...(existing.relatedFrom ?? []), seed.path])]
        continue
      }

      const filePath = path.join(projectPath, relatedPath)
      if (sourcePath && path.resolve(filePath) === path.resolve(sourcePath)) continue
      let content
      try {
        content = await readTextFile(filePath)
      } catch {
        continue
      }

      const { fm } = parseFrontmatter(content)
      const fmStructure = scoreFrontmatterStructure(fm, tokens)
      const candidate = {
        retrievalMode: RETRIEVAL_MODES.INGEST,
        path: relatedPath,
        title: extractTitle(content, filePath),
        score: inheritedScore + Math.min(fmStructure.score, 18),
        titleMatch: false,
        frontmatterMatch: true,
        frontmatterMatches: [...new Set(["related", ...fmStructure.matches])],
        frontmatterSources: fmStructure.sources,
        frontmatterRelated: fmStructure.related,
        frontmatterTags: fmStructure.tags,
        raw: false,
        type: normalizeTypeAlias(fm.type) ?? inferTypeFromPath(relatedPath),
        snippet: buildSnippet(content, tokens),
        relatedFrom: [seed.path],
      }
      byPath.set(relatedPath, candidate)
      relatedCandidates.push(candidate)
    }
  }
  return relatedCandidates
}

export function lineNumberAtOffset(text, offset) {
  if (offset <= 0) return 1
  return text.slice(0, offset).split(/\r?\n/).length
}

export function heatRank(heat) {
  const value = String(heat ?? "")
  if (/中高|较高/.test(value)) return 3
  if (/^高$|高热|很高/.test(value)) return 4
  if (/中/.test(value)) return 2
  if (/低/.test(value)) return 1
  return 0
}

export function compactSegmentPreview(text, maxChars = 260) {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxChars)
}

export function isMultiTopicSourcePath(sourceRelativePath) {
  const relativePath = toPosixPath(sourceRelativePath)
  return /^raw\/(?:微信聊天|每日夜间交流)\//.test(relativePath)
}

export function isDailyReviewSourcePath(sourceRelativePath) {
  const relativePath = toPosixPath(sourceRelativePath)
  return /^raw\/(?:日复盘|每日复盘)\//.test(relativePath) || /(?:^|\/)\d{4}-\d{2}-\d{2}-.{0,20}复盘\.md$/.test(relativePath)
}

export function shouldBuildIngestSegments(sourceRelativePath, sourceContent, options = {}) {
  if (options.enableSegments === false || options.segmentedRetrieval === false) return false
  if (options.enableSegments === true || options.segmentedRetrieval === true) return true
  if (isMultiTopicSourcePath(sourceRelativePath)) return true
  return String(sourceContent ?? "").length > 45000 && /###\s*重点板块\/标的|^\d+\.\s+.+热度[:：]/m.test(String(sourceContent ?? ""))
}

export function extractFocusBlocks(normalized) {
  const blocks = []
  const regex = /^###\s*重点板块\/标的\s*$/gm
  let match
  while ((match = regex.exec(normalized)) !== null) {
    const start = match.index + match[0].length
    const rest = normalized.slice(start)
    const endMatch = rest.search(/^###\s*(?:风险与待验证|完整调研原文|市场情绪|同步与窗口)\s*$|^##\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/m)
    const end = endMatch >= 0 ? start + endMatch : normalized.length
    blocks.push({ start, end, text: normalized.slice(start, end) })
  }
  return blocks
}

export function parseFocusBlockSegments(normalized, block, startIndex) {
  const lines = block.text.split(/\n/)
  const segments = []
  let current = null
  let cursor = block.start

  function flush(endOffset) {
    if (!current) return
    const text = current.lines.join("\n").trim()
    if (text.length < 80) {
      current = null
      return
    }
    const title = current.title
    segments.push({
      id: `segment-${String(startIndex + segments.length + 1).padStart(2, "0")}`,
      title,
      heat: current.heat || "",
      sourceGroups: current.sourceGroups || "",
      sourceCount: current.sourceCount,
      lineStart: lineNumberAtOffset(normalized, current.startOffset),
      lineEnd: lineNumberAtOffset(normalized, endOffset),
      text,
      textPreview: compactSegmentPreview(text),
      searchText: [`${title} ${current.heat || ""} ${current.sourceGroups || ""}`, text].filter(Boolean).join("\n"),
    })
    current = null
  }

  for (const line of lines) {
    const lineStart = cursor
    cursor += line.length + 1
    const header = line.match(/^(\d+)\.\s+(.+?)\s*$/)
    if (header) {
      flush(lineStart)
      const rawTitle = header[2].trim()
      const title = rawTitle.split(/[｜|]/)[0].trim()
      const heat = rawTitle.match(/热度[:：]\s*([^｜|\n]+)/)?.[1]?.trim() ?? ""
      const sourceGroups = rawTitle.match(/命中群[:：]\s*([^｜|\n]+)/)?.[1]?.trim() ?? ""
      const sourceCountRaw = rawTitle.match(/原文数[:：]\s*(\d+)/)?.[1]
      current = {
        title,
        heat,
        sourceGroups,
        sourceCount: sourceCountRaw ? Number(sourceCountRaw) : null,
        startOffset: lineStart,
        lines: [line],
      }
      continue
    }
    if (current) current.lines.push(line)
  }
  flush(block.end)
  return segments
}

export function parseLooseNumberedSegments(normalized, startIndex) {
  if (!/^\d+[.、)]\s+.+热度[:：]/m.test(normalized)) return []
  const lines = normalized.split(/\n/)
  const segments = []
  let current = null
  let cursor = 0

  function flush(endOffset) {
    if (!current) return
    const text = current.lines.join("\n").trim()
    if (text.length < 80) {
      current = null
      return
    }
    segments.push({
      id: `segment-${String(startIndex + segments.length + 1).padStart(2, "0")}`,
      title: current.title,
      heat: current.heat || "",
      sourceGroups: current.sourceGroups || "",
      sourceCount: current.sourceCount,
      lineStart: lineNumberAtOffset(normalized, current.startOffset),
      lineEnd: lineNumberAtOffset(normalized, endOffset),
      text,
      textPreview: compactSegmentPreview(text),
      searchText: [`${current.title} ${current.heat || ""} ${current.sourceGroups || ""}`, text].filter(Boolean).join("\n"),
    })
    current = null
  }

  for (const line of lines) {
    const lineStart = cursor
    cursor += line.length + 1
    const header = line.match(/^(\d+)[.、)]\s+(.+热度[:：].+?)\s*$/)
    if (header) {
      flush(lineStart)
      const rawTitle = header[2].trim()
      const title = rawTitle.split(/[｜|]/)[0].trim()
      const heat = rawTitle.match(/热度[:：]\s*([^｜|\n]+)/)?.[1]?.trim() ?? ""
      const sourceGroups = rawTitle.match(/命中群[:：]\s*([^｜|\n]+)/)?.[1]?.trim() ?? ""
      const sourceCountRaw = rawTitle.match(/原文数[:：]\s*(\d+)/)?.[1]
      current = {
        title,
        heat,
        sourceGroups,
        sourceCount: sourceCountRaw ? Number(sourceCountRaw) : null,
        startOffset: lineStart,
        lines: [line],
      }
      continue
    }
    if (/^#{2,3}\s+/.test(line) && current) {
      flush(lineStart)
      continue
    }
    if (current) current.lines.push(line)
  }
  flush(normalized.length)
  return segments
}

export function extractIngestSourceSegments(sourceContent, sourcePath, sourceRelativePath, options = {}) {
  if (!shouldBuildIngestSegments(sourceRelativePath, sourceContent, options)) return []
  const normalized = String(sourceContent ?? "").replace(/\r\n/g, "\n")
  const focusBlocks = extractFocusBlocks(normalized)
  const segments = []
  for (const block of focusBlocks) {
    segments.push(...parseFocusBlockSegments(normalized, block, segments.length))
  }
  if (!segments.length) {
    segments.push(...parseLooseNumberedSegments(normalized, segments.length))
  }
  const maxSegments = options.maxSegments ?? INGEST_SEGMENT_DEFAULT_MAX
  return segments
    .filter((segment) => segment.title && !/^(同步与窗口|市场情绪|风险与待验证|完整调研原文)$/.test(segment.title))
    .sort((a, b) => heatRank(b.heat) - heatRank(a.heat) || (b.sourceCount ?? 0) - (a.sourceCount ?? 0) || a.lineStart - b.lineStart)
    .slice(0, maxSegments)
    .map((segment, index) => ({
      ...segment,
      id: `segment-${String(index + 1).padStart(2, "0")}`,
      sourcePath: sourceRelativePath,
    }))
}

export function mergeMatchedSegments(existing, segmentRef) {
  const refs = [...(existing.matchedSegments ?? [])]
  if (!refs.some((item) => item.id === segmentRef.id)) refs.push(segmentRef)
  return refs
}

export function segmentRef(segment) {
  return { id: segment.id, title: segment.title, heat: segment.heat || "" }
}

export function cloneSegmentCandidate(item, segment) {
  return {
    ...item,
    matchedSegments: [segmentRef(segment)],
  }
}

export function prioritizeNonSummaryCandidates(candidates, allowSummaryLead = false) {
  const sorted = sortSearchResults(candidates)
  if (allowSummaryLead) return sorted
  return sorted.sort((a, b) => {
    const aSummary = a.type === "总结" ? 1 : 0
    const bSummary = b.type === "总结" ? 1 : 0
    if (aSummary !== bSummary) return aSummary - bSummary
    return Number(b.score ?? 0) - Number(a.score ?? 0)
  })
}

export function mergeSegmentedCandidateResults(base, segments, options = {}) {
  if (!segments.length) return { ...base, segments: [] }
  const summaryMultiplier = options.summaryCandidateMultiplier ?? 0.62
  const segmentMultiplier = options.segmentCandidateMultiplier ?? 0.95
  const wikiByPath = new Map()

  function addWikiCandidate(item, segment = null, multiplier = 1) {
    const scoreMultiplier = item.type === "总结" ? Math.min(multiplier, summaryMultiplier) : multiplier
    const candidate = {
      ...item,
      score: item.score * scoreMultiplier,
    }
    if (segment) {
      candidate.segmentOnly = true
      candidate.matchedSegments = mergeMatchedSegments(candidate, segmentRef(segment))
    }
    const existing = wikiByPath.get(candidate.path)
    if (!existing) {
      wikiByPath.set(candidate.path, candidate)
      return
    }
    existing.score = Math.max(existing.score, candidate.score)
    existing.frontmatterMatches = [...new Set([...(existing.frontmatterMatches ?? []), ...(candidate.frontmatterMatches ?? [])])]
    existing.relatedFrom = [...new Set([...(existing.relatedFrom ?? []), ...(candidate.relatedFrom ?? [])])]
    if (segment) existing.matchedSegments = mergeMatchedSegments(existing, segmentRef(segment))
  }

  for (const item of base.wikiCandidates) addWikiCandidate(item)
  for (const segment of segments) {
    for (const item of segment.wikiCandidates ?? []) addWikiCandidate(item, segment, segmentMultiplier)
  }

  const rawByPath = new Map()
  function addRawCandidate(item, segment = null, multiplier = 1) {
    const candidate = { ...item, score: item.score * multiplier }
    if (segment) candidate.matchedSegments = mergeMatchedSegments(candidate, segmentRef(segment))
    const existing = rawByPath.get(candidate.path)
    if (!existing) {
      rawByPath.set(candidate.path, candidate)
      return
    }
    existing.score = Math.max(existing.score, candidate.score)
    if (segment) existing.matchedSegments = mergeMatchedSegments(existing, segmentRef(segment))
  }
  for (const item of base.rawCandidates) addRawCandidate(item)
  for (const segment of segments) {
    for (const item of segment.rawCandidates ?? []) addRawCandidate(item, segment, segmentMultiplier)
  }

  return {
    ...base,
    wikiCandidates: prioritizeNonSummaryCandidates([...wikiByPath.values()], options.allowSummaryLead).slice(0, options.topWiki ?? 30),
    rawCandidates: sortSearchResults([...rawByPath.values()]).slice(0, options.topRaw ?? 20),
    segments,
  }
}

export async function searchCandidatePagesCore({ projectPath, sourcePath, sourceContent, options, wikiFiles, rawFilesAll }) {
  const query = extractSourceSearchSeed(sourceContent, sourcePath)
  const tokens = extractSourceTokens(sourceContent, sourcePath, options.maxTokens ?? 180)
  const effectiveTokens = tokens.length > 0 ? tokens : tokenizeQuery(path.basename(sourcePath))
  const rawFiles = filterRawFilesByQueryPolicy(rawFilesAll, query, {
    ...options,
    mode: RETRIEVAL_MODES.INGEST,
    maxRawFiles: options.maxRawFiles ?? options.rawScanLimit ?? 240,
  })

  const wikiResults = []
  for (const filePath of wikiFiles) {
    const relativePath = projectRelative(projectPath, filePath)
    if (isReservedWikiPath(relativePath)) continue
    const scored = await scoreFile({
      filePath,
      projectPath,
      sourcePath,
      tokens: effectiveTokens,
      query,
      isRaw: false,
      mode: RETRIEVAL_MODES.INGEST,
    })
    if (scored) wikiResults.push(scored)
  }
  wikiResults.push(
    ...(await expandRelatedWikiCandidates({
      projectPath,
      sourcePath,
      wikiFiles,
      wikiResults,
      tokens: effectiveTokens,
      query,
    })),
  )

  const rawResults = []
  for (const filePath of rawFiles) {
    const scored = await scoreFile({
      filePath,
      projectPath,
      sourcePath,
      tokens: effectiveTokens,
      query,
      isRaw: true,
      mode: RETRIEVAL_MODES.INGEST,
    })
    if (scored) rawResults.push(scored)
  }

  const sortResults = (items) =>
    items.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      const dateA = a.path.match(/(\d{4})-(\d{2})-(\d{2})/)
      const dateB = b.path.match(/(\d{4})-(\d{2})-(\d{2})/)
      if (dateA && dateB) return dateB[0].localeCompare(dateA[0])
      if (dateB) return 1
      if (dateA) return -1
      return a.path.localeCompare(b.path)
    })

  return {
    retrievalMode: RETRIEVAL_MODES.INGEST,
    tokens: effectiveTokens,
    wikiCandidates: sortResults(wikiResults).slice(0, options.topWiki ?? 30),
    rawCandidates: sortResults(rawResults).slice(0, options.topRaw ?? 20),
  }
}

export async function buildSegmentedCandidateResults({ projectPath, sourcePath, sourceRelativePath, sourceContent, options, wikiFiles, rawFilesAll }) {
  const extracted = extractIngestSourceSegments(sourceContent, sourcePath, sourceRelativePath, options)
  const segments = []
  for (const segment of extracted) {
    const result = await searchCandidatePagesCore({
      projectPath,
      sourcePath,
      sourceContent: segment.searchText,
      options: {
        ...options,
        topWiki: options.segmentTopWiki ?? INGEST_SEGMENT_WIKI_LIMIT,
        topRaw: options.segmentTopRaw ?? INGEST_SEGMENT_RAW_LIMIT,
        maxTokens: options.segmentMaxTokens ?? 100,
      },
      wikiFiles,
      rawFilesAll,
    })
    segments.push({
      ...segment,
      retrievalMode: RETRIEVAL_MODES.INGEST,
      tokens: result.tokens,
      wikiCandidates: prioritizeNonSummaryCandidates(
        result.wikiCandidates.map((item) => cloneSegmentCandidate(item, segment)),
        options.allowSummaryLead,
      ),
      rawCandidates: result.rawCandidates.map((item) => cloneSegmentCandidate(item, segment)),
    })
  }
  return segments
}

export async function searchCandidatePages(projectPath, sourcePath, sourceContent, options = {}) {
  const pp = normalizePath(projectPath)
  const sp = normalizePath(sourcePath)
  const sourceRelativePath = projectRelative(pp, sp)

  const wikiFiles = await listFilesRecursive(path.join(pp, "wiki"), {
    extensions: new Set([".md"]),
    excludeDirNames: new Set([".git", ".conflicts", "scripts"]),
  })

  const rawFilesAll = await listFilesRecursive(path.join(pp, "raw"), {
    extensions: TEXT_EXTENSIONS,
    excludeDirNames: new Set([".git", ".llm-wiki", ".obsidian", "scripts", "templates", "archive", "assets"]),
    maxBytes: options.maxRawBytes ?? 512000,
    preferRecent: true,
    maxFiles: options.rawScanLimit ?? 240,
  })

  const base = await searchCandidatePagesCore({
    projectPath: pp,
    sourcePath: sp,
    sourceContent,
    options,
    wikiFiles,
    rawFilesAll,
  })
  const segments = options.enableSegments === false
    ? []
    : await buildSegmentedCandidateResults({
        projectPath: pp,
        sourcePath: sp,
        sourceRelativePath,
        sourceContent,
        options: {
          ...options,
          allowSummaryLead: options.allowSummaryLead ?? isDailyReviewSourcePath(sourceRelativePath),
        },
        wikiFiles,
        rawFilesAll,
      })
  const merged = mergeSegmentedCandidateResults(base, segments, {
    ...options,
    allowSummaryLead: options.allowSummaryLead ?? isDailyReviewSourcePath(sourceRelativePath),
  })
  const conceptGovernance = await loadConceptCanonicalRulings(options)
  return annotateConceptGovernanceCandidateResults(merged, conceptGovernance)
}

export function compactMethodologyList(items, maxItems = 8) {
  if (!Array.isArray(items)) return ""
  return items
    .filter((item) => typeof item === "string" && item.trim())
    .slice(0, maxItems)
    .map((item) => item.trim())
    .join(", ")
}

export function truncateMethodologyText(text, maxChars) {
  if (text.length <= maxChars) return text
  const slice = text.slice(0, maxChars)
  const boundary = Math.max(slice.lastIndexOf("\n### "), slice.lastIndexOf("\n## "), slice.lastIndexOf("\n- "), slice.lastIndexOf("\n"))
  const end = boundary > maxChars * 0.55 ? boundary : maxChars
  return `${slice.slice(0, end).trimEnd()}\n...（本方法论摘录已截断，完整内容见对应 wiki 页面）`
}

export function compactMethodologyLine(line, maxChars = 220) {
  const trimmed = line.replace(/\s+/g, " ").trim()
  if (!trimmed) return ""
  if (trimmed.length <= maxChars) return trimmed
  return `${trimmed.slice(0, maxChars).trimEnd()}...`
}

export function selectMethodologyLines(body, options = {}) {
  const maxHeadingLines = options.maxHeadingLines ?? 18
  const maxImportantLines = options.maxImportantLines ?? 32
  const headings = []
  const important = []
  const seen = new Set()

  for (const rawLine of body.split(/\r?\n/)) {
    const line = compactMethodologyLine(rawLine)
    if (!line) continue
    if (/^```/.test(line)) continue
    if (/^\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?$/.test(line)) continue

    if (/^#{1,6}\s+/.test(line) && headings.length < maxHeadingLines) {
      headings.push(line)
    }

    if (important.length >= maxImportantLines) continue
    if (!METHODOLOGY_IMPORTANT_LINE_REGEX.test(line)) continue
    if (seen.has(line)) continue
    seen.add(line)
    important.push(line)
  }

  return { headings, important }
}

export function parseMethodologyPage(content) {
  const wrapped = content.match(/^```yaml\s*\r?\n(---\r?\n[\s\S]*?\r?\n---)\r?\n```\s*\r?\n?/i)
  if (!wrapped) return parseFrontmatter(content)
  const { fm } = parseFrontmatter(`${wrapped[1]}\n`)
  return { fm, body: content.slice(wrapped[0].length) }
}

export function compactMethodologyPage(relativePath, content, charLimit) {
  const title = extractTitle(content, relativePath)
  const { fm, body } = parseMethodologyPage(content)
  const type = normalizeTypeAlias(fm.type) ?? inferTypeFromPath(relativePath)
  const summary = typeof fm.summary === "string" ? compactMethodologyLine(fm.summary, 260) : ""
  const tags = compactMethodologyList(fm.tags, 10)
  const related = compactMethodologyList(fm.related, 10)
  const { headings, important } = selectMethodologyLines(body)
  const fallback = body
    .split(/\r?\n/)
    .map((line) => compactMethodologyLine(line))
    .filter(Boolean)
    .slice(0, 12)

  const lines = [
    `### ${relativePath} — ${title}`,
    `- type: ${type}`,
    summary ? `- summary: ${summary}` : "",
    tags ? `- tags: ${tags}` : "",
    related ? `- related: ${related}` : "",
    headings.length > 0 ? "- headings:" : "",
    ...headings.map((line) => `  - ${line.replace(/^#+\s*/, "")}`),
    important.length > 0 ? "- key excerpts:" : "- lead excerpts:",
    ...(important.length > 0 ? important : fallback).map((line) => `  - ${line.replace(/^[-*]\s*/, "")}`),
  ].filter(Boolean)

  return truncateMethodologyText(lines.join("\n"), charLimit)
}

export function buildMethodologyStage3Rules(paths) {
  return truncateMethodologyText(
    [
      "## Methodology Guardrails",
      "- Stage 1/2 already received the full compact methodology pack; use this page-level snippet as hard writing rules.",
      "- Treat source text as evidence, and methodology pages as decision rules. Do not cite methodology snippets as new market facts.",
      "- Keep the ingest aligned with 盘前预测 / 盘中执行 / 盘后验证 / 明日验证清单.",
      "- Separate fact strength from heat: official disclosures, financial data, policy text, and verifiable market data outrank research inference, group chat, and unverified writeups.",
      "- Use the L1-L4 decision structure when deciding whether a theme is strategy-level, execution-level, observation-only, or error/discipline material.",
      "- For catalysts, distinguish hard catalyst, soft catalyst, price expectation, verification window, and evidence failure. High attention alone is not a buy point.",
      "- For errors and exits, preserve the trigger, violated rule, correct action, and next validation condition rather than writing a generic lesson.",
      "- For strategy pages, make the output operational: decision preconditions, execution trigger, invalidation/exit rule, and tomorrow's checklist.",
      `- Methodology source paths: ${paths.join(" / ")}`,
    ].join("\n"),
    METHODOLOGY_STAGE3_RULE_CHAR_SOFT_LIMIT,
  )
}

export async function buildMethodologyContext(projectPath, options = {}) {
  if (options === false || options.enabled === false) {
    return {
      enabled: false,
      markdown: "",
      stage3Rules: "",
      paths: [],
      missingPaths: [],
      stats: { sourceChars: 0, promptChars: 0 },
    }
  }

  const pp = normalizePath(projectPath)
  const paths = Array.isArray(options.paths) && options.paths.length > 0 ? options.paths : METHODOLOGY_CONTEXT_PATHS
  const perPageChars = parsePositiveInteger(options.perPageChars, METHODOLOGY_PAGE_CHAR_SOFT_LIMIT)
  const totalChars = parsePositiveInteger(options.totalChars, METHODOLOGY_CONTEXT_TOTAL_CHAR_SOFT_LIMIT)
  const pageSources = []
  const missingPaths = []
  let sourceChars = 0

  for (const rawRelativePath of paths) {
    const relativePath = toPosixPath(String(rawRelativePath ?? "").trim()).replace(/^\/+/, "")
    if (!relativePath || relativePath.includes("..") || !relativePath.startsWith("wiki/")) continue
    const fullPath = path.join(pp, relativePath)
    const content = await readIfExists(fullPath)
    if (!content.trim()) {
      missingPaths.push(relativePath)
      continue
    }
    sourceChars += content.length
    pageSources.push({
      path: relativePath,
      content,
    })
  }

  if (pageSources.length === 0) {
    return {
      enabled: true,
      markdown: "",
      stage3Rules: "",
      paths: [],
      missingPaths,
      stats: { sourceChars, promptChars: 0 },
    }
  }

  const headerLines = [
    "## Methodology Pre-read Pack",
    "",
    "Use this compact pack as durable trading-system methodology, not as source evidence. It exists to keep ingest decisions aligned with the user's execution framework.",
    "",
    "### Application Rules",
    "- Prefer execution-ready structure over generic summaries.",
    "- Map durable knowledge into 盘前预测 / 盘中执行 / 盘后验证 / 明日验证清单 when the source supports it.",
    "- Distinguish facts, inference, sentiment, catalyst quality, and price action absorption.",
    "- Do not upgrade chat heat or research conviction into verified fact strength.",
    "- For catalyst material, record catalyst level, verification window, invalidation signal, and whether it creates only observation or an actionable L4 setup.",
    "- For strategy/error material, preserve triggers, violated rules, correct action, and follow-up validation.",
    "",
    "### Source Page Extracts",
  ]
  const headerChars = headerLines.join("\n").length
  const totalPageBudget = Math.max(2400, totalChars - headerChars - 120)
  const effectivePerPageChars = Math.max(650, Math.min(perPageChars, Math.floor(totalPageBudget / pageSources.length)))
  const pages = pageSources.map((page) => ({
    path: page.path,
    markdown: compactMethodologyPage(page.path, page.content, effectivePerPageChars),
  }))
  const markdown = truncateMethodologyText([...headerLines, ...pages.map((page) => page.markdown)].join("\n"), totalChars)

  return {
    enabled: true,
    markdown,
    stage3Rules: buildMethodologyStage3Rules(pages.map((page) => page.path)),
    paths: pages.map((page) => page.path),
    missingPaths,
    stats: {
      sourceChars,
      promptChars: markdown.length,
      perPagePromptChars: effectivePerPageChars,
    },
  }
}
