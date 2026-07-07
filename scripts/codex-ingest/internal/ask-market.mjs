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
  ASK_DEFAULT_SQL_LIMIT,
  ASK_DEFAULT_TOPIC_SEGMENT_MAX_SEGMENTS_PER_STOCK,
  ASK_DEFAULT_TOPIC_SEGMENT_STOCK_LIMIT,
  ASK_DEFAULT_TOPIC_SEGMENT_TOTAL_STOCK_LIMIT,
  ASK_DEFAULT_TOPIC_STOCK_LIMIT,
  ASK_SOURCE_ALIASES,
  ASK_SOURCE_IDS,
  ASK_STOCK_DAILY_DEFAULT_DATABASE,
  ASK_STOCK_DAILY_DEFAULT_SCHEMA,
  ASK_STOCK_DAILY_DEFAULT_TABLE,
  ASK_STOCK_DAILY_KEYCHAIN_ACCOUNT,
  ASK_STOCK_DAILY_KEYCHAIN_SERVICE,
  BRAIN_KEYWORD_REGEX,
  DAILY_LOOP_EXTERNAL_MARKET_DEFAULT,
  DEFAULT_AGENT_CONCURRENCY,
  DEFAULT_TOPIC_MARKET_SEGMENT_REGISTRY,
  EASTMONEY_KLINE_COLUMNS,
  FACTS_KEYWORD_REGEX,
  RAW_NEWS_KEYWORD_REGEX,
  STOCK_CODE_LIKE_REGEX,
  STOCK_DAILY_COLUMN_CANDIDATES,
  STOCK_DAILY_KEYWORD_REGEX,
  TOPIC_MARKET_CANDIDATE_NAME_DENYLIST,
  TOPIC_MARKET_SEGMENT_REGISTRY_RELATIVE_PATHS,
  TOPIC_MARKET_VALIDATION_KEYWORD_REGEX,
  TOPIC_SEGMENT_REQUEST_REGEX,
  TRADE_REVIEW_KEYWORD_REGEX,
  averageNumbers,
  execFileAsync,
  formatSqlCell,
  listFilesRecursive,
  mapWithConcurrency,
  normalizeStockCode,
  numberFromSqlCell,
  parsePositiveInteger,
  roundMetric,
  safeErrorMessage,
  stockCodeAlternatives,
} from "./core.mjs"

import {
  parseFrontmatter,
} from "./knowledge.mjs"

export function parseAskSourcesOption(value) {
  const raw = String(value ?? "auto").trim()
  if (!raw || raw === "auto") return null
  const sourceIds = raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => ASK_SOURCE_ALIASES.get(item) ?? item)
  const unknown = sourceIds.filter((id) => !ASK_SOURCE_IDS.includes(id))
  if (unknown.length > 0) throw new Error(`Unknown ask source(s): ${unknown.join(", ")}`)
  return [...new Set(sourceIds)]
}

export function isStockDailyQuestion(query) {
  STOCK_CODE_LIKE_REGEX.lastIndex = 0
  return STOCK_DAILY_KEYWORD_REGEX.test(query) || STOCK_CODE_LIKE_REGEX.test(query)
}

export function isTradeReviewQuestion(query) {
  return TRADE_REVIEW_KEYWORD_REGEX.test(String(query ?? "").replace(/交易日/g, ""))
}

export function isFactsQuestion(query) {
  return FACTS_KEYWORD_REGEX.test(query)
}

export function isBrainQuestion(query) {
  return BRAIN_KEYWORD_REGEX.test(query)
}

export function isRawNewsQuestion(query) {
  return RAW_NEWS_KEYWORD_REGEX.test(query)
}

export function isTopicMarketValidationQuestion(query) {
  return TOPIC_MARKET_VALIDATION_KEYWORD_REGEX.test(String(query ?? ""))
}

export function readStockDailyPgConfigFile(env = process.env, options = {}) {
  const configPath = options.pgConfigPath ?? env.PG_SHIHAO_CONFIG_PATH
  if (!configPath) return { config: {}, error: null }
  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8"))
    return {
      config: parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {},
      error: null,
    }
  } catch (err) {
    return { config: {}, error: `PG_SHIHAO_CONFIG_PATH unreadable: ${safeErrorMessage(err)}` }
  }
}

export function readStockDailyPgPasswordFromKeychain(env = process.env, options = {}) {
  if (options.disablePgKeychain || env.TRADING_WIKI_DISABLE_PG_KEYCHAIN === "1") return null
  if (env.VITEST || env.NODE_ENV === "test") return null
  const service = options.pgKeychainService ?? env.TRADING_WIKI_PG_KEYCHAIN_SERVICE ?? ASK_STOCK_DAILY_KEYCHAIN_SERVICE
  const account = options.pgKeychainAccount ?? env.TRADING_WIKI_PG_KEYCHAIN_ACCOUNT ?? ASK_STOCK_DAILY_KEYCHAIN_ACCOUNT
  if (!service || !account) return null
  try {
    const output = execFileSync(
      "security",
      ["find-generic-password", "-s", String(service), "-a", String(account), "-w"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 2500 },
    )
    const password = output.trim()
    return password || null
  } catch {
    return null
  }
}

export function getStockDailyPgConfig(env = process.env, options = {}) {
  const fileConfig = readStockDailyPgConfigFile(env, options)
  const fileStockDaily = fileConfig.config.stockDaily && typeof fileConfig.config.stockDaily === "object" && !Array.isArray(fileConfig.config.stockDaily)
    ? fileConfig.config.stockDaily
    : {}
  const explicitPassword = options.pgPassword ?? env.PG_SHIHAO_PASSWORD ?? fileConfig.config.password
  const rawPort = options.pgPort ?? env.PG_SHIHAO_PORT ?? fileConfig.config.port
  const stockDatabase = options.pgDatabase ?? env.PG_SHIHAO_DATABASE ?? fileConfig.config.stockDailyDatabase ?? fileConfig.config.stock_daily_database ?? fileStockDaily.database ?? ASK_STOCK_DAILY_DEFAULT_DATABASE
  const stockSchema = options.pgSchema ?? env.PG_SHIHAO_SCHEMA ?? fileConfig.config.stockDailySchema ?? fileConfig.config.stock_daily_schema ?? fileStockDaily.schema ?? ASK_STOCK_DAILY_DEFAULT_SCHEMA
  const stockTable = options.pgTable ?? env.PG_SHIHAO_STOCK_DAILY_TABLE ?? fileConfig.config.stockDailyTable ?? fileConfig.config.stock_daily_table ?? fileStockDaily.table ?? ASK_STOCK_DAILY_DEFAULT_TABLE
  return {
    host: options.pgHost ?? env.PG_SHIHAO_HOST ?? fileConfig.config.host,
    port: rawPort === undefined || rawPort === null || rawPort === "" ? undefined : Number(rawPort),
    user: options.pgUser ?? env.PG_SHIHAO_USER ?? fileConfig.config.user,
    password: explicitPassword ?? readStockDailyPgPasswordFromKeychain(env, options),
    database: stockDatabase,
    schema: stockSchema,
    table: stockTable,
    configError: fileConfig.error,
  }
}

export function hasUsableStockDailyPgConfig(config) {
  return Boolean(config.host && config.port && config.user && config.password && config.database && config.schema && config.table)
}

export function stockDailyPgConfigUnavailableReason(config) {
  if (config.configError) return config.configError
  const missing = []
  if (!config.host) missing.push("PG_SHIHAO_HOST")
  if (!Number.isFinite(config.port) || config.port <= 0) missing.push("PG_SHIHAO_PORT")
  if (!config.user) missing.push("PG_SHIHAO_USER")
  if (!config.password) missing.push("PG_SHIHAO_PASSWORD")
  if (!config.database) missing.push("PG_SHIHAO_DATABASE")
  if (!config.schema) missing.push("PG_SHIHAO_SCHEMA")
  if (!config.table) missing.push("PG_SHIHAO_STOCK_DAILY_TABLE")
  return missing.length > 0 ? `${missing.join(", ")} is not set` : "stock SQL config is not usable"
}

export function redactPgConfig(config) {
  return {
    host: config.host,
    port: config.port,
    user: config.user,
    database: config.database,
    schema: config.schema,
    table: config.table,
    password: config.password ? "[redacted]" : undefined,
  }
}

export function quotePgIdentifier(identifier) {
  const clean = String(identifier ?? "")
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(clean)) throw new Error(`Unsafe PostgreSQL identifier: ${clean}`)
  return `"${clean.replace(/"/g, '""')}"`
}

export function findColumn(columns, candidates) {
  const lowerToOriginal = new Map(columns.map((column) => [String(column).toLowerCase(), String(column)]))
  for (const candidate of candidates) {
    const found = lowerToOriginal.get(candidate.toLowerCase())
    if (found) return found
  }
  return null
}

export function resolveStockDailyColumns(columns = []) {
  const names = [...new Set(columns.map((column) => String(column).trim()).filter(Boolean))]
  const resolved = {
    all: names,
    ticker: findColumn(names, STOCK_DAILY_COLUMN_CANDIDATES.ticker),
    date: findColumn(names, STOCK_DAILY_COLUMN_CANDIDATES.date),
    open: findColumn(names, STOCK_DAILY_COLUMN_CANDIDATES.open),
    high: findColumn(names, STOCK_DAILY_COLUMN_CANDIDATES.high),
    low: findColumn(names, STOCK_DAILY_COLUMN_CANDIDATES.low),
    close: findColumn(names, STOCK_DAILY_COLUMN_CANDIDATES.close),
    preClose: findColumn(names, STOCK_DAILY_COLUMN_CANDIDATES.preClose),
    change: findColumn(names, STOCK_DAILY_COLUMN_CANDIDATES.change),
    pctChange: findColumn(names, STOCK_DAILY_COLUMN_CANDIDATES.pctChange),
    volume: findColumn(names, STOCK_DAILY_COLUMN_CANDIDATES.volume),
    amount: findColumn(names, STOCK_DAILY_COLUMN_CANDIDATES.amount),
    turnover: findColumn(names, STOCK_DAILY_COLUMN_CANDIDATES.turnover),
  }
  resolved.ready = Boolean(resolved.ticker && resolved.date)
  return resolved
}

export async function loadPgClient() {
  const mod = await import("pg")
  const Client = mod.Client ?? mod.default?.Client
  if (!Client) throw new Error("Missing PostgreSQL Client export from pg")
  return Client
}

export async function describeStockDailySqlSource(options = {}) {
  const config = getStockDailyPgConfig(process.env, options)
  if (Array.isArray(options.stockDailyColumns) && options.stockDailyColumns.length > 0) {
    const columns = resolveStockDailyColumns(options.stockDailyColumns)
    return { ok: columns.ready, config: redactPgConfig(config), columns, error: columns.ready ? null : "stockDailyColumns missing ticker/date columns" }
  }
  if (!hasUsableStockDailyPgConfig(config)) {
    return { ok: false, config: redactPgConfig(config), columns: resolveStockDailyColumns([]), error: stockDailyPgConfigUnavailableReason(config) }
  }
  const Client = await loadPgClient()
  const client = new Client({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    ssl: false,
    connectionTimeoutMillis: parsePositiveInteger(options.pgConnectTimeoutMs, 5000),
  })
  try {
    await client.connect()
    await client.query("select set_config('statement_timeout', $1, false)", [`${parsePositiveInteger(options.pgStatementTimeoutMs, 8000)}ms`])
    const result = await client.query(
      `
        select column_name
        from information_schema.columns
        where table_schema = $1
          and table_name = $2
        order by ordinal_position
      `,
      [config.schema, config.table],
    )
    const columns = resolveStockDailyColumns(result.rows.map((row) => row.column_name))
    return {
      ok: columns.ready,
      config: redactPgConfig(config),
      columns,
      error: columns.ready ? null : `Missing required ticker/date columns on ${config.schema}.${config.table}`,
    }
  } catch (err) {
    return { ok: false, config: redactPgConfig(config), columns: resolveStockDailyColumns([]), error: safeErrorMessage(err) }
  } finally {
    await client.end().catch(() => {})
  }
}

export async function loadStockCodeMapping(projectPath) {
  const mapping = new Map()
  try {
    const raw = await fs.readFile(path.join(projectPath, ".llm-wiki", "stock-codes.json"), "utf8")
    const parsed = JSON.parse(raw)
    for (const [name, code] of Object.entries(parsed.mapping ?? {})) {
      if (name && code) mapping.set(String(name), String(code).toUpperCase())
    }
  } catch {}

  const stockDir = path.join(projectPath, "wiki", "股票")
  const files = await listFilesRecursive(stockDir, {
    extensions: new Set([".md"]),
    excludeDirNames: new Set([".git", ".conflicts", "scripts"]),
  }).catch(() => [])
  for (const filePath of files) {
    try {
      const content = await fs.readFile(filePath, "utf8")
      const { fm } = parseFrontmatter(content)
      const title = typeof fm.title === "string" && fm.title.trim() ? fm.title.trim() : path.basename(filePath, ".md")
      if (typeof fm.code === "string" && fm.code.trim()) mapping.set(title, fm.code.trim().toUpperCase())
    } catch {}
  }
  return mapping
}

export function parseStockLookbackDays(query) {
  const numeric = String(query).match(/(?:最近|近)\s*(\d+)\s*(?:个)?(?:交易日|日|天)/)
  if (numeric) return Math.max(1, Math.min(Number(numeric[1]), 260))
  if (/最近一周|近一周|近7天|本周/.test(query)) return 5
  if (/最近一个月|近一个月|近30天|本月/.test(query)) return 22
  if (/最近三个月|近三个月|近90天/.test(query)) return 66
  return 20
}

export function resolveStockIntentName({ mapping, explicitCodes, nameMatches, primaryCode }) {
  const normalizedPrimary = normalizeStockCode(primaryCode)
  if (!normalizedPrimary) return nameMatches[0]?.name ?? null
  const matchedNameForCode = nameMatches.find((item) => normalizeStockCode(item.code) === normalizedPrimary)
  if (matchedNameForCode) return matchedNameForCode.name
  if (explicitCodes.length > 0) {
    const reverseMatches = [...mapping.entries()]
      .map(([name, code]) => ({ name, code: normalizeStockCode(code) }))
      .filter((item) => item.name && item.code === normalizedPrimary)
      .sort((a, b) => [...b.name].length - [...a.name].length || a.name.localeCompare(b.name))
    return reverseMatches[0]?.name ?? null
  }
  return nameMatches[0]?.name ?? null
}

export function parseStockDailyIntent(query, options = {}) {
  const text = String(query ?? "")
  STOCK_CODE_LIKE_REGEX.lastIndex = 0
  const explicitCodes = [...text.matchAll(STOCK_CODE_LIKE_REGEX)]
    .map((match) => normalizeStockCode(match[0]))
    .filter(Boolean)
  const mapping = options.stockCodeMapping instanceof Map ? options.stockCodeMapping : new Map(Object.entries(options.stockCodeMapping ?? {}))
  const nameMatches = []
  for (const [name, code] of mapping.entries()) {
    if (name && text.includes(name)) nameMatches.push({ name, code: normalizeStockCode(code) })
  }
  nameMatches.sort((a, b) => [...b.name].length - [...a.name].length || a.name.localeCompare(b.name))
  const primaryCode = explicitCodes[0] ?? nameMatches.find((item) => item.code)?.code ?? null
  const stockName = resolveStockIntentName({ mapping, explicitCodes, nameMatches, primaryCode })
  return {
    isStockQuestion: isStockDailyQuestion(text),
    lookbackDays: parseStockLookbackDays(text),
    stockName,
    stockCode: primaryCode,
    tickerCandidates: stockCodeAlternatives(primaryCode),
    wantsVolume: /成交量|量能|放量|缩量|volume|vol/i.test(text),
    wantsAmount: /成交额|金额|amount|amt/i.test(text),
    wantsPctChange: /涨跌|涨幅|跌幅|收益|pct|change/i.test(text),
  }
}

export function buildStockDailySqlQuery(intent, descriptor, options = {}) {
  const columns = descriptor?.columns ?? resolveStockDailyColumns([])
  if (!columns.ready) throw new Error("stock_daily_sql is unavailable: missing ticker/date columns")
  if (!intent?.stockCode || intent.tickerCandidates.length === 0) throw new Error("stock_daily_sql needs a stock code or resolvable stock name")
  const config = getStockDailyPgConfig(process.env, options)
  const table = `${quotePgIdentifier(config.schema)}.${quotePgIdentifier(config.table)}`
  const selected = [
    columns.ticker,
    columns.date,
    columns.open,
    columns.high,
    columns.low,
    columns.close,
    columns.preClose,
    columns.change,
    columns.pctChange,
    columns.volume,
    columns.amount,
    columns.turnover,
  ].filter(Boolean)
  const uniqueSelected = [...new Set(selected)]
  const selectSql = uniqueSelected.map((column) => quotePgIdentifier(column)).join(", ")
  const limit = Math.min(parsePositiveInteger(options.sqlLimit, ASK_DEFAULT_SQL_LIMIT), Math.max(1, intent.lookbackDays))
  const sql = `
with recent_rows as (
  select ${selectSql}
  from ${table}
  where ${quotePgIdentifier(columns.ticker)} = any($1::text[])
  order by ${quotePgIdentifier(columns.date)} desc
  limit $2
)
select *
from recent_rows
order by ${quotePgIdentifier(columns.date)} asc
`.trim()
  return {
    language: "SQL",
    sql,
    params: [intent.tickerCandidates, limit],
    summary: `SELECT ${uniqueSelected.join(", ")} FROM ${config.schema}.${config.table} WHERE ${columns.ticker}=ANY($1) ORDER BY ${columns.date} DESC LIMIT ${limit}`,
    table: `${config.database}.${config.schema}.${config.table}`,
    limit,
    tickerCandidates: intent.tickerCandidates,
  }
}

export async function executeStockDailyQuery(nativeQuery, options = {}) {
  if (options.stockDailyExecutor) return options.stockDailyExecutor({ nativeQuery, options })
  const config = getStockDailyPgConfig(process.env, options)
  if (!hasUsableStockDailyPgConfig(config)) throw new Error(stockDailyPgConfigUnavailableReason(config))
  const Client = await loadPgClient()
  const client = new Client({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    ssl: false,
    connectionTimeoutMillis: parsePositiveInteger(options.pgConnectTimeoutMs, 5000),
  })
  try {
    await client.connect()
    await client.query("begin read only")
    await client.query("select set_config('statement_timeout', $1, true)", [`${parsePositiveInteger(options.pgStatementTimeoutMs, 8000)}ms`])
    const result = await client.query(nativeQuery.sql, nativeQuery.params)
    await client.query("commit")
    return { rows: result.rows, rowCount: result.rowCount }
  } catch (err) {
    await client.query("rollback").catch(() => {})
    throw err
  } finally {
    await client.end().catch(() => {})
  }
}

export function sqlDateSortValue(value) {
  if (value instanceof Date) return value.getTime()
  const parsed = Date.parse(String(value ?? ""))
  return Number.isFinite(parsed) ? parsed : String(value ?? "")
}

export function parseLocalTimestampParts(value) {
  const match = String(value ?? "").match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}(?::\d{2})?))?/)
  if (!match) return null
  return {
    date: match[1],
    time: match[2] ? (match[2].length === 5 ? `${match[2]}:00` : match[2]) : null,
  }
}

export function validationAnchorFromPrediction(prediction) {
  const parsed = parseLocalTimestampParts(prediction?.createdAt ?? prediction?.answeredAt ?? prediction?.date)
  if (!parsed?.date) return null
  return {
    date: parsed.date,
    exclusive: Boolean(parsed.time && parsed.time >= "15:00:00"),
    source: prediction?.createdAt ? "createdAt" : prediction?.answeredAt ? "answeredAt" : "date",
  }
}

export function stockDailyRowRef(row, columns, fallbackCode, tableName) {
  const ticker = row[columns.ticker] ?? fallbackCode ?? "UNKNOWN"
  const date = formatSqlCell(row[columns.date] ?? "unknown-date")
  return `sql:${tableName}#${ticker}/${date}`
}

export function stockDailyRowsToEvidence({ rows, nativeQuery, descriptor, intent }) {
  const columns = descriptor.columns
  const tableName = nativeQuery.table.split(".").slice(-1)[0]
  return rows.map((row, index) => {
    const refPath = stockDailyRowRef(row, columns, intent.stockCode, tableName)
    const fields = Object.entries(row)
      .map(([key, value]) => `${key}=${formatSqlCell(value)}`)
      .join(", ")
    return {
      sourceId: "stock_daily_sql",
      path: refPath,
      title: `${intent.stockName ? `${intent.stockName} ` : ""}${intent.stockCode ?? ""} 日线 ${formatSqlCell(row[columns.date])}`,
      score: 30 - index * 0.2,
      type: "SQL",
      nativeQuery: nativeQuery.summary,
      excerpt: fields,
      row,
    }
  })
}

export function shouldCrossCheckAskStockDaily(options = {}) {
  if (options.askStockDailyCrossCheck === false || options.stockDailyCrossCheck === false) return false
  if (options.externalMarketFetcher) return true
  if (options.stockDailyExecutor) return false
  if (process.env.VITEST || process.env.NODE_ENV === "test") return false
  return true
}

export function stockDailyMetricFromAskRows(stockDaily) {
  const rows = (stockDaily?.results ?? []).map((item) => item.row).filter(Boolean)
  if (!stockDaily?.descriptor?.columns || rows.length === 0) {
    return {
      code: stockDaily?.intent?.stockCode ?? null,
      name: stockDaily?.intent?.stockName ?? null,
      status: rows.length === 0 ? "no_rows" : "missing_columns",
    }
  }
  const tableName = stockDaily.nativeQuery?.table?.split(".").slice(-1)[0] ?? ASK_STOCK_DAILY_DEFAULT_TABLE
  return metricFromStockRows({
    code: stockDaily.intent?.stockCode,
    name: stockDaily.intent?.stockName ?? stockDaily.intent?.stockCode,
    rows,
    columns: stockDaily.descriptor.columns,
    tableName,
  })
}

export async function crossCheckAskStockDaily(stockDaily, options = {}) {
  const sqlMetric = stockDailyMetricFromAskRows(stockDaily)
  if (!shouldCrossCheckAskStockDaily(options)) {
    return { status: "skipped", sqlMetric, externalMetric: null, validation: null, warning: null }
  }
  if (!stockDaily?.intent?.stockCode || stockDaily.status !== "ok" || sqlMetric.status !== "ok") {
    return { status: "skipped", sqlMetric, externalMetric: null, validation: null, warning: "股票日线 SQL 结果不足，跳过外部行情交叉验证" }
  }
  const stock = {
    code: stockDaily.intent.stockCode,
    name: stockDaily.intent.stockName ?? stockDaily.intent.stockCode,
    branch: "ask-stock-daily",
  }
  const external = await fetchDailyLoopExternalMarketMetrics([stock], {
    ...options,
    marketValidate: options.askExternalMarket ?? options.stockDailyExternalMarket ?? "eastmoney",
    stockLookbackDays: stockDaily.intent.lookbackDays,
  })
  const externalMetric = external.metrics.get(stock.code) ?? {
    code: stock.code,
    name: stock.name,
    status: "missing",
    warning: external.warning ?? "外部行情未返回该股票",
    source: external.source ?? "external_market",
  }
  const validation = compareDailyMarketMetrics(sqlMetric, externalMetric)
  const warning = ["divergent", "sql_stale", "external_stale"].includes(validation.status)
    ? validation.reason
    : external.warning ?? null
  return {
    status: validation.status,
    source: external.source,
    sqlMetric,
    externalMetric,
    validation,
    warning,
  }
}

export function inferMarketValidationDirection(query) {
  const text = String(query ?? "").replace(/涨跌幅|涨跌|跌幅/g, "")
  if (/(?:看空|下跌|走弱|风险|回撤|破位|跌)/.test(text)) return "bearish"
  if (/(?:看多|上涨|走强|补涨|突破|有空间|空间|强势|修复|反弹)/.test(text)) return "bullish"
  return "neutral"
}

export function verdictFromMarketMove({ direction, periodReturnPct, lastVolumeVsAvg }) {
  if (periodReturnPct == null) return { verdict: "证据不足", reason: "SQL 日线缺少可计算的收盘价列" }
  if (direction === "bullish") {
    if (periodReturnPct >= 3 && (lastVolumeVsAvg == null || lastVolumeVsAvg >= 0.8)) {
      return { verdict: "验证通过", reason: "看多/补涨假设得到区间正收益支撑，且末日量能不明显弱于均量" }
    }
    if (periodReturnPct <= -3) return { verdict: "验证失败", reason: "看多/补涨假设与区间负收益冲突" }
    return { verdict: "待继续观察", reason: "区间收益幅度未达到明确验证阈值" }
  }
  if (direction === "bearish") {
    if (periodReturnPct <= -3) return { verdict: "验证通过", reason: "看空/风险假设得到区间负收益支撑" }
    if (periodReturnPct >= 3 && (lastVolumeVsAvg == null || lastVolumeVsAvg >= 0.8)) {
      return { verdict: "验证失败", reason: "看空/风险假设与区间正收益冲突" }
    }
    return { verdict: "待继续观察", reason: "区间收益幅度未达到明确验证阈值" }
  }
  return { verdict: "待继续观察", reason: "问题没有给出明确预测方向，日线结果只作为市场验证材料" }
}

export function buildStockDailyMarketValidation(stockDaily, query) {
  if (!stockDaily || stockDaily.status === "skipped") return null
  const base = {
    sourceId: "stock_daily_sql",
    status: stockDaily.status,
    verdict: "证据不足",
    reason: stockDaily.warning ?? null,
    stockName: stockDaily.intent?.stockName ?? null,
    stockCode: stockDaily.intent?.stockCode ?? null,
    lookbackDays: stockDaily.intent?.lookbackDays ?? null,
    rowCount: stockDaily.results?.length ?? 0,
  }
  if (stockDaily.status !== "ok") return base
  const rows = (stockDaily.results ?? []).map((item) => item.row).filter(Boolean)
  const columns = stockDaily.descriptor?.columns ?? {}
  if (rows.length === 0) return { ...base, reason: stockDaily.warning ?? "SQL 源执行成功，但没有返回日线记录" }
  const first = rows[0]
  const last = rows[rows.length - 1]
  const sqlFirstClose = numberFromSqlCell(first[columns.close])
  const sqlLastClose = numberFromSqlCell(last[columns.close])
  const sqlPeriodReturnPct = sqlFirstClose != null && sqlFirstClose !== 0 && sqlLastClose != null ? ((sqlLastClose - sqlFirstClose) / sqlFirstClose) * 100 : null
  const crossCheck = stockDaily.marketCrossCheck ?? null
  const externalMetric = crossCheck?.externalMetric?.status === "ok" ? crossCheck.externalMetric : null
  const sqlLastDate = formatSqlCell(last[columns.date])
  const externalEndDate = externalMetric?.endDate ?? null
  const sqlLastDateValue = marketMetricDateValue({ endDate: sqlLastDate })
  const externalEndDateValue = marketMetricDateValue(externalMetric)
  const externalCoversSqlWindow =
    sqlLastDateValue == null ||
    externalEndDateValue == null ||
    externalEndDateValue >= sqlLastDateValue
  const useExternalReturn = Boolean(
    externalMetric &&
      (crossCheck?.validation?.status === "sql_stale" ||
        (["confirmed", "divergent"].includes(crossCheck?.validation?.status) && externalCoversSqlWindow)),
  )
  const firstClose = useExternalReturn ? externalMetric.closeStart : sqlFirstClose
  const lastClose = useExternalReturn ? externalMetric.closeEnd : sqlLastClose
  const periodReturnPct = useExternalReturn ? externalMetric.pct20 : sqlPeriodReturnPct
  const avgVolume = columns.volume ? averageNumbers(rows.map((row) => row[columns.volume])) : null
  const lastVolume = columns.volume ? numberFromSqlCell(last[columns.volume]) : null
  const lastVolumeVsAvg = avgVolume && lastVolume != null ? lastVolume / avgVolume : null
  const avgAmount = columns.amount ? averageNumbers(rows.map((row) => row[columns.amount])) : null
  const lastAmount = columns.amount ? numberFromSqlCell(last[columns.amount]) : null
  const direction = inferMarketValidationDirection(query)
  const verdict = verdictFromMarketMove({ direction, periodReturnPct, lastVolumeVsAvg })
  return {
    ...base,
    status: rows.length >= 2 ? "ready" : "partial",
    verdict: rows.length >= 2 ? verdict.verdict : "证据不足",
    reason: rows.length >= 2 ? verdict.reason : "少于 2 条日线，无法形成区间验证",
    expectedDirection: direction,
    firstDate: formatSqlCell(first[columns.date]),
    lastDate: sqlLastDate,
    firstClose: roundMetric(firstClose, 4),
    lastClose: roundMetric(lastClose, 4),
    periodReturnPct: roundMetric(periodReturnPct, 2),
    returnSource: useExternalReturn ? externalMetric.source ?? "external_market" : "stock_daily_sql",
    crossCheckStatus: crossCheck?.validation?.status ?? null,
    crossCheckReason: crossCheck?.validation?.reason ?? null,
    sqlPeriodReturnPct: roundMetric(sqlPeriodReturnPct, 2),
    externalPeriodReturnPct: externalMetric?.pct20 != null ? roundMetric(externalMetric.pct20, 2) : null,
    sqlClose: { first: roundMetric(sqlFirstClose, 4), last: roundMetric(sqlLastClose, 4) },
    externalClose: externalMetric ? { first: roundMetric(externalMetric.closeStart, 4), last: roundMetric(externalMetric.closeEnd, 4) } : null,
    avgVolume: roundMetric(avgVolume, 2),
    lastVolume: roundMetric(lastVolume, 2),
    lastVolumeVsAvg: roundMetric(lastVolumeVsAvg, 2),
    avgAmount: roundMetric(avgAmount, 2),
    lastAmount: roundMetric(lastAmount, 2),
    refs: [
      ...stockDaily.results.map((item) => item.path),
      externalMetric?.externalRef,
    ].filter(Boolean),
  }
}

export async function searchAskStockDaily(projectPath, query, options = {}) {
  const mapping = await loadStockCodeMapping(projectPath)
  const intent = parseStockDailyIntent(query, { stockCodeMapping: mapping })
  const descriptor = options.stockDailyDescriptor ?? (await describeStockDailySqlSource(options))
  if (!intent.isStockQuestion) {
    return { status: "skipped", intent, descriptor, nativeQuery: null, results: [], warning: null }
  }
  if (!intent.stockCode) {
    return { status: "insufficient", intent, descriptor, nativeQuery: null, results: [], warning: "未能从问题中解析股票代码或股票名" }
  }
  if (!descriptor.ok) {
    return { status: "unavailable", intent, descriptor, nativeQuery: null, results: [], warning: `SQL 源不可用: ${descriptor.error}` }
  }
  const nativeQuery = buildStockDailySqlQuery(intent, descriptor, options)
  try {
    const execution = await executeStockDailyQuery(nativeQuery, options)
    const rows = Array.isArray(execution?.rows) ? execution.rows : []
    const results = stockDailyRowsToEvidence({ rows, nativeQuery, descriptor, intent })
    const stockDaily = {
      status: "ok",
      intent,
      descriptor,
      nativeQuery,
      results,
      warning: rows.length > 0 ? null : "SQL 源执行成功，但没有返回日线记录",
    }
    const marketCrossCheck = await crossCheckAskStockDaily(stockDaily, options)
    return {
      ...stockDaily,
      marketCrossCheck,
    }
  } catch (err) {
    return { status: "error", intent, descriptor, nativeQuery, results: [], warning: `SQL 查询失败: ${safeErrorMessage(err)}` }
  }
}

export function countTextOccurrences(text, needle) {
  const target = String(needle ?? "")
  if (!target) return 0
  let count = 0
  let index = String(text ?? "").indexOf(target)
  while (index !== -1) {
    count += 1
    index = String(text ?? "").indexOf(target, index + target.length)
  }
  return count
}

export function askEvidenceSearchText(item) {
  return [
    item?.ref,
    item?.title,
    item?.path,
    item?.sourceId,
    item?.type,
    item?.excerpt,
    item?.snippet,
    item?.value ? JSON.stringify(item.value) : "",
  ].filter(Boolean).join("\n")
}

export function inferAskEvidenceSourceId(item) {
  if (item?.sourceId) return item.sourceId
  if (item?.ref?.startsWith("W")) return "wiki_pages"
  if (item?.ref?.startsWith("R")) return "raw_text"
  if (item?.ref?.startsWith("G")) return "wiki_graph"
  if (item?.ref?.startsWith("F")) return "facts_jsonl"
  if (item?.ref?.startsWith("M")) return "brain_memory"
  if (item?.raw) return "raw_text"
  if (item?.path?.startsWith("wiki/")) return "wiki_pages"
  if (item?.path?.startsWith("raw/")) return "raw_text"
  return "evidence"
}

export function topicStockCandidateBlockWeight(item) {
  const sourceId = inferAskEvidenceSourceId(item)
  if (sourceId === "wiki_pages") return 8
  if (sourceId === "raw_text") return 7
  if (sourceId === "wiki_graph") return 4
  if (sourceId === "facts_jsonl") return 3
  if (sourceId === "brain_memory") return 1
  return 3
}

export function topicStockCandidateTopicalBonus(block, query) {
  const question = String(query ?? "")
  const surface = `${block?.title ?? ""}\n${block?.path ?? ""}`
  if (/(?:电源|供电|功率|DrMOS|VPD|HVDC|SST|Power)/i.test(question) && /(?:电源|供电|功率|DrMOS|VPD|HVDC|SST|Power)/i.test(surface)) return 20
  if (/(?:MLCC|电容|被动元件)/i.test(question) && /(?:MLCC|电容|被动元件)/i.test(surface)) return 16
  if (/(?:PCB|覆铜板|铜箔|基板|载板)/i.test(question) && /(?:PCB|覆铜板|铜箔|基板|载板)/i.test(surface)) return 16
  return 0
}

export function normalizeTopicKeywordList(value) {
  if (!Array.isArray(value)) return []
  return value.map((item) => String(item ?? "").trim()).filter(Boolean)
}

export function normalizeTopicMarketSegment(segment, fallbackId) {
  if (!segment || typeof segment !== "object") return null
  const label = String(segment.label ?? segment.name ?? segment.id ?? fallbackId ?? "").trim()
  const id = String(segment.id ?? label ?? fallbackId ?? "").trim()
  const keywords = normalizeTopicKeywordList(segment.keywords ?? segment.aliases ?? segment.terms)
  if (!id || !label || keywords.length === 0) return null
  return { id, label, keywords }
}

export function normalizeTopicMarketTheme(theme, fallbackId) {
  if (!theme || typeof theme !== "object") return null
  const label = String(theme.label ?? theme.name ?? theme.id ?? fallbackId ?? "").trim()
  const id = String(theme.id ?? label ?? fallbackId ?? "").trim()
  const keywords = normalizeTopicKeywordList(theme.keywords ?? theme.aliases ?? theme.themeKeywords ?? theme.terms)
  const segments = (Array.isArray(theme.segments) ? theme.segments : [])
    .map((segment, index) => normalizeTopicMarketSegment(segment, `${id}-segment-${index + 1}`))
    .filter(Boolean)
  if (!id || !label || keywords.length === 0 || segments.length === 0) return null
  const maxSegmentsPerStock = parsePositiveInteger(theme.maxSegmentsPerStock ?? theme.max_segments_per_stock, 0)
  return {
    id,
    label,
    keywords,
    segments,
    ...(maxSegmentsPerStock > 0 ? { maxSegmentsPerStock } : {}),
  }
}

export function normalizeTopicMarketSegmentRegistry(rawRegistry) {
  const rawThemes = Array.isArray(rawRegistry)
    ? rawRegistry
    : Array.isArray(rawRegistry?.themes)
      ? rawRegistry.themes
      : Array.isArray(rawRegistry?.registry)
        ? rawRegistry.registry
        : []
  return rawThemes
    .map((theme, index) => normalizeTopicMarketTheme(theme, `theme-${index + 1}`))
    .filter(Boolean)
}

export function mergeTopicMarketSegmentRegistries(...registries) {
  const merged = new Map()
  for (const registry of registries) {
    for (const theme of normalizeTopicMarketSegmentRegistry(registry)) {
      merged.set(theme.id, theme)
    }
  }
  return [...merged.values()]
}

export async function loadTopicMarketSegmentRegistry(projectPath, options = {}) {
  if (Array.isArray(options.topicSegmentRegistry) || Array.isArray(options.topicMarketSegmentRegistry)) {
    return normalizeTopicMarketSegmentRegistry(options.topicSegmentRegistry ?? options.topicMarketSegmentRegistry)
  }
  const defaultRegistry = options.disableDefaultTopicSegmentRegistry
    ? []
    : normalizeTopicMarketSegmentRegistry(DEFAULT_TOPIC_MARKET_SEGMENT_REGISTRY)
  const registryPaths = options.topicSegmentRegistryPath
    ? [options.topicSegmentRegistryPath]
    : TOPIC_MARKET_SEGMENT_REGISTRY_RELATIVE_PATHS
  const projectRegistries = []
  for (const registryPath of registryPaths) {
    const absolutePath = path.isAbsolute(registryPath) ? registryPath : path.join(projectPath, registryPath)
    const raw = await fs.readFile(absolutePath, "utf8").catch((err) => {
      if (err?.code === "ENOENT") return null
      throw err
    })
    if (!raw) continue
    try {
      projectRegistries.push(JSON.parse(raw))
    } catch (err) {
      throw new Error(`Failed to parse topic segment registry ${absolutePath}: ${safeErrorMessage(err)}`)
    }
  }
  return mergeTopicMarketSegmentRegistries(defaultRegistry, ...projectRegistries)
}

export function topicSegmentMatchesText(segment, text) {
  const source = String(text ?? "")
  return segment.keywords.some((keyword) => source.toLowerCase().includes(String(keyword).toLowerCase()))
}

export function topicThemeMatchesText(theme, text) {
  const source = String(text ?? "").toLowerCase()
  return theme.keywords.some((keyword) => source.includes(String(keyword).toLowerCase()))
}

export function matchedTopicSegments(text, segments = []) {
  return segments.filter((segment) => topicSegmentMatchesText(segment, text))
}

export function textContainsAnyNeedle(text, needles) {
  const source = String(text ?? "").toLowerCase()
  return needles.some((needle) => {
    const target = String(needle ?? "").trim().toLowerCase()
    return target && source.includes(target)
  })
}

export function findNeedlePositions(text, needles) {
  const source = String(text ?? "").toLowerCase()
  const positions = []
  for (const rawNeedle of needles) {
    const needle = String(rawNeedle ?? "").trim().toLowerCase()
    if (!needle) continue
    let index = source.indexOf(needle)
    while (index !== -1) {
      positions.push(index)
      index = source.indexOf(needle, index + needle.length)
    }
  }
  return positions
}

export function hasNearbyNeedlePair(text, leftNeedles, rightNeedles, maxDistance = 180) {
  const leftPositions = findNeedlePositions(text, leftNeedles)
  const rightPositions = findNeedlePositions(text, rightNeedles)
  if (!leftPositions.length || !rightPositions.length) return false
  for (const left of leftPositions) {
    if (rightPositions.some((right) => Math.abs(left - right) <= maxDistance)) return true
  }
  return false
}

export function topicSegmentMatchesCandidate(segment, blockSurface, stockNeedles, stockPageHit = false) {
  if (!topicSegmentMatchesText(segment, blockSurface)) return false
  if (stockPageHit) return true
  const units = String(blockSurface ?? "")
    .split(/(?:\r?\n)+|[。；;.!?！？]/)
    .map((unit) => unit.trim())
    .filter(Boolean)
  if (units.some((unit) => textContainsAnyNeedle(unit, stockNeedles) && topicSegmentMatchesText(segment, unit))) {
    return true
  }
  return hasNearbyNeedlePair(blockSurface, stockNeedles, segment.keywords)
}

export function detectTopicMarketTheme(query, blocks, registry = []) {
  if (!registry.length) return null
  const queryText = String(query ?? "")
  const blockText = blocks.map((block) => `${block.title ?? ""}\n${block.path ?? ""}\n${block.text ?? ""}`).join("\n")
  const ranked = registry
    .map((theme) => {
      const queryHits = theme.keywords.reduce((sum, keyword) => sum + countTextOccurrences(queryText.toLowerCase(), String(keyword).toLowerCase()), 0)
      const segmentQueryHits = theme.segments.reduce((sum, segment) => sum + segment.keywords.reduce((inner, keyword) => inner + countTextOccurrences(queryText.toLowerCase(), String(keyword).toLowerCase()), 0), 0)
      const blockHits = theme.keywords.reduce((sum, keyword) => sum + Math.min(countTextOccurrences(blockText.toLowerCase(), String(keyword).toLowerCase()), 3), 0)
      return { theme, score: queryHits * 10 + segmentQueryHits * 8 + blockHits }
    })
    .filter((item) => item.score > 0 || topicThemeMatchesText(item.theme, queryText))
    .sort((a, b) => b.score - a.score || a.theme.label.localeCompare(b.theme.label))
  return ranked[0]?.theme ?? null
}

export function shouldRequestTopicSegmentConfig(query) {
  return TOPIC_SEGMENT_REQUEST_REGEX.test(String(query ?? ""))
}

export function unconfiguredTopicSegmentWarning(query) {
  if (!shouldRequestTopicSegmentConfig(query)) return null
  return "未配置细分环节；已回退到普通主题候选池"
}

export function activeTopicMarketSegments(query, blocks, theme = null) {
  const themeSegments = theme?.segments ?? []
  if (!themeSegments.length) return []
  const queryMatches = matchedTopicSegments(query, themeSegments)
  if (queryMatches.length > 0) return queryMatches
  if (shouldRequestTopicSegmentConfig(query)) return themeSegments
  const seen = new Map()
  for (const block of blocks) {
    const surface = `${block.title ?? ""}\n${block.path ?? ""}\n${block.text ?? ""}`
    for (const segment of matchedTopicSegments(surface, themeSegments)) {
      seen.set(segment.id, segment)
    }
  }
  return [...seen.values()].filter((segment) => {
    if (/(?:光互联|数据中心|AI服务器|CPO|LPO|NPO|800G|1\.6T|1.6T)/i.test(query)) return true
    return topicSegmentMatchesText(segment, query)
  })
}

export function topicCandidateSegmentLabels(candidate) {
  return (candidate.segments ?? []).map((segment) => segment.label)
}

export function topicCandidatePositiveSegmentIds(candidate) {
  return Object.entries(candidate.segmentScores ?? {})
    .filter(([, score]) => Number(score) > 0)
    .map(([id]) => id)
}

export function isBroadTopicSegmentCandidate(candidate, activeSegments, options = {}) {
  if (options.allowBroadTopicSegmentCandidates === true || options.allowBroadSegmentCandidates === true) return false
  const maxSegments = parsePositiveInteger(
    options.topicSegmentMaxSegmentsPerStock ?? options.marketValidationSegmentMaxSegmentsPerStock,
    ASK_DEFAULT_TOPIC_SEGMENT_MAX_SEGMENTS_PER_STOCK,
  )
  if (maxSegments <= 0) return false
  const positiveSegmentIds = topicCandidatePositiveSegmentIds(candidate)
  return activeSegments.length > maxSegments && positiveSegmentIds.length > maxSegments
}

export function topicSegmentExclusionReason(candidate, activeSegments, options = {}) {
  if (!isBroadTopicSegmentCandidate(candidate, activeSegments, options)) return null
  const positiveSegmentIds = new Set(topicCandidatePositiveSegmentIds(candidate))
  const labels = activeSegments
    .filter((segment) => positiveSegmentIds.has(segment.id))
    .map((segment) => segment.label)
  return `跨 ${labels.length} 个细分环节同时命中（${labels.join(" / ")}），疑似光模块龙头或泛主题共现噪声，未进入细分 SQL 验证池`
}

export function dedupeTopicCandidatesByCode(candidates) {
  const seen = new Set()
  return candidates.filter((candidate) => {
    if (!candidate.code) return true
    if (seen.has(candidate.code)) return false
    seen.add(candidate.code)
    return true
  })
}

export function isTopicMarketCandidateDenied(name, query) {
  const stockName = String(name ?? "").trim()
  if (!TOPIC_MARKET_CANDIDATE_NAME_DENYLIST.has(stockName)) return false
  return !String(query ?? "").includes(stockName)
}

export function mergeTopicCandidate(existing, incoming) {
  if (!existing) return incoming
  const segmentById = new Map((existing.segments ?? []).map((segment) => [segment.id, segment]))
  for (const segment of incoming.segments ?? []) segmentById.set(segment.id, segment)
  return {
    ...existing,
    score: Math.max(existing.score ?? 0, incoming.score ?? 0),
    hasPrimaryEvidence: existing.hasPrimaryEvidence || incoming.hasPrimaryEvidence,
    reasons: [...new Set([...(existing.reasons ?? []), ...(incoming.reasons ?? [])])].slice(0, 12),
    segmentScores: {
      ...(existing.segmentScores ?? {}),
      ...(incoming.segmentScores ?? {}),
    },
    segments: [...segmentById.values()],
  }
}

export function collectTopicStockCandidateSet(query, mapping, evidenceItems = [], options = {}) {
  const flatLimit = parsePositiveInteger(options.topicStockLimit ?? options.agenticMarketStockLimit ?? options.marketValidationStockLimit, ASK_DEFAULT_TOPIC_STOCK_LIMIT)
  const perSegmentLimit = parsePositiveInteger(options.topicSegmentStockLimit ?? options.marketValidationSegmentStockLimit, ASK_DEFAULT_TOPIC_SEGMENT_STOCK_LIMIT)
  const segmentTotalLimit = parsePositiveInteger(options.topicSegmentTotalStockLimit ?? options.marketValidationSegmentTotalStockLimit, Math.max(ASK_DEFAULT_TOPIC_SEGMENT_TOTAL_STOCK_LIMIT, flatLimit))
  const blocks = [
    { ref: "query", sourceId: "query", weight: 12, text: String(query ?? "") },
    ...evidenceItems.map((item) => ({
      ref: item?.ref ?? item?.path ?? item?.title ?? "evidence",
      sourceId: inferAskEvidenceSourceId(item),
      weight: topicStockCandidateBlockWeight(item),
      path: item?.path,
      title: item?.title,
      text: askEvidenceSearchText(item),
    })),
  ]
  const themeRegistry = Array.isArray(options.topicSegmentRegistry)
    ? normalizeTopicMarketSegmentRegistry(options.topicSegmentRegistry)
    : Array.isArray(options.topicMarketSegmentRegistry)
      ? normalizeTopicMarketSegmentRegistry(options.topicMarketSegmentRegistry)
      : normalizeTopicMarketSegmentRegistry(DEFAULT_TOPIC_MARKET_SEGMENT_REGISTRY)
  const activeTheme = detectTopicMarketTheme(query, blocks, themeRegistry)
  const activeSegments = activeTopicMarketSegments(query, blocks, activeTheme)
  const activeSegmentIds = new Set(activeSegments.map((segment) => segment.id))
  const segmentFilterOptions = {
    ...options,
    topicSegmentMaxSegmentsPerStock: options.topicSegmentMaxSegmentsPerStock
      ?? options.marketValidationSegmentMaxSegmentsPerStock
      ?? activeTheme?.maxSegmentsPerStock,
  }
  const segmentConfigStatus = activeTheme
    ? activeSegments.length > 0 ? "configured" : "configured_no_matching_segment"
    : shouldRequestTopicSegmentConfig(query) ? "unconfigured" : "not_requested"
  const segmentConfigWarning = activeTheme ? null : unconfiguredTopicSegmentWarning(query)
  const candidates = []
  for (const [name, rawCode] of mapping.entries()) {
    const code = normalizeStockCode(rawCode)
    if (!name || !code) continue
    if (isTopicMarketCandidateDenied(name, query)) continue
    const stockNeedles = [name, ...stockCodeAlternatives(code)]
    let score = 0
    const reasons = []
    const segmentScores = new Map()
    const segmentReasons = new Map()
    let hasPrimaryEvidence = false
    for (const block of blocks) {
      const text = block.text ?? ""
      const nameHits = countTextOccurrences(text, name)
      const codeHits = stockCodeAlternatives(code).reduce((sum, ticker) => sum + countTextOccurrences(text, ticker), 0)
      const stockPageHit = block.path === `wiki/股票/${name}.md` || (block.sourceId === "wiki_pages" && block.title === name)
      const primaryEvidence = block.sourceId === "query" || ["wiki_pages", "raw_text", "wiki_graph", "facts_jsonl"].includes(block.sourceId) || stockPageHit
      const topicalBonus = primaryEvidence ? topicStockCandidateTopicalBonus(block, query) : 0
      const hitScore = Math.min(nameHits, block.sourceId === "brain_memory" ? 1 : 3) * block.weight + Math.min(codeHits, 1) * Math.max(6, block.weight)
      const blockSurface = `${block.title ?? ""}\n${block.path ?? ""}\n${text}`
      const blockSegments = matchedTopicSegments(blockSurface, activeSegments)
        .filter((segment) => activeSegmentIds.has(segment.id))
        .filter((segment) => topicSegmentMatchesCandidate(segment, blockSurface, stockNeedles, stockPageHit))
      if (stockPageHit) {
        score += 60
        reasons.push(`${block.ref}:stock-page`)
        hasPrimaryEvidence = true
      }
      if (nameHits > 0) {
        score += Math.min(nameHits, block.sourceId === "brain_memory" ? 1 : 3) * block.weight
        if (topicalBonus > 0) {
          score += topicalBonus
          reasons.push(`${block.ref}:topic`)
        }
        reasons.push(`${block.ref}:name`)
        if (primaryEvidence) hasPrimaryEvidence = true
      }
      if (codeHits > 0) {
        score += Math.min(codeHits, 1) * Math.max(6, block.weight)
        reasons.push(`${block.ref}:code`)
        if (primaryEvidence) hasPrimaryEvidence = true
      }
      if ((nameHits > 0 || codeHits > 0 || stockPageHit) && primaryEvidence && blockSegments.length > 0) {
        for (const segment of blockSegments) {
          const addScore = Math.max(1, hitScore) + (topicalBonus > 0 ? topicalBonus : 6) + (stockPageHit ? 25 : 0)
          segmentScores.set(segment.id, (segmentScores.get(segment.id) ?? 0) + addScore)
          const reasonList = segmentReasons.get(segment.id) ?? []
          reasonList.push(`${block.ref}:${segment.id}`)
          segmentReasons.set(segment.id, reasonList)
        }
      }
    }
    if (score > 0) {
      candidates.push({
        name,
        code,
        score,
        hasPrimaryEvidence,
        reasons: [...new Set(reasons)].slice(0, 8),
        segmentScores: Object.fromEntries(segmentScores),
        segmentReasons: Object.fromEntries([...segmentReasons.entries()].map(([id, values]) => [id, [...new Set(values)].slice(0, 8)])),
      })
    }
  }
  const sorted = candidates
    .sort((a, b) => Number(b.hasPrimaryEvidence) - Number(a.hasPrimaryEvidence) || b.score - a.score || a.name.localeCompare(b.name))
  if (activeSegments.length > 0) {
    const mergedByCode = new Map()
    const segmentPools = activeSegments.map((segment) => {
      const matchingCandidates = sorted
        .filter((candidate) => Number(candidate.segmentScores?.[segment.id] ?? 0) > 0)
        .sort((a, b) => Number(b.segmentScores?.[segment.id] ?? 0) - Number(a.segmentScores?.[segment.id] ?? 0) || b.score - a.score || a.name.localeCompare(b.name))
      const excludedCandidates = dedupeTopicCandidatesByCode(
        matchingCandidates.filter((candidate) => isBroadTopicSegmentCandidate(candidate, activeSegments, segmentFilterOptions)),
      )
        .slice(0, perSegmentLimit)
        .map((candidate) => ({
          name: candidate.name,
          code: candidate.code,
          segments: activeSegments.filter((item) => Number(candidate.segmentScores?.[item.id] ?? 0) > 0),
          reason: topicSegmentExclusionReason(candidate, activeSegments, segmentFilterOptions),
          reasons: [...new Set([...(candidate.segmentReasons?.[segment.id] ?? []), ...(candidate.reasons ?? [])])].slice(0, 8),
        }))
      const segmentCandidates = dedupeTopicCandidatesByCode(
        matchingCandidates.filter((candidate) => !isBroadTopicSegmentCandidate(candidate, activeSegments, segmentFilterOptions)),
      )
        .slice(0, perSegmentLimit)
        .map((candidate) => ({
          ...candidate,
          score: Number(candidate.segmentScores?.[segment.id] ?? candidate.score),
          reasons: [...new Set([...(candidate.segmentReasons?.[segment.id] ?? []), ...(candidate.reasons ?? [])])].slice(0, 8),
          segments: [{ id: segment.id, label: segment.label }],
        }))
      for (const candidate of segmentCandidates) {
        mergedByCode.set(candidate.code, mergeTopicCandidate(mergedByCode.get(candidate.code), candidate))
      }
      return { id: segment.id, label: segment.label, candidates: segmentCandidates, excludedCandidates }
    })
    const merged = [...mergedByCode.values()]
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
      .slice(0, segmentTotalLimit)
    const allowedCodes = new Set(merged.map((candidate) => candidate.code))
    return {
      mode: "segmented",
      theme: { id: activeTheme.id, label: activeTheme.label },
      segmentConfigStatus,
      segmentConfigWarning,
      activeSegments,
      segmentPools: segmentPools.map((pool) => ({
        ...pool,
        candidates: pool.candidates.filter((candidate) => allowedCodes.has(candidate.code)),
      })),
      candidates: merged,
    }
  }
  const deduped = []
  const seenCodes = new Set()
  for (const candidate of sorted) {
    if (seenCodes.has(candidate.code)) continue
    seenCodes.add(candidate.code)
    deduped.push(candidate)
    if (deduped.length >= flatLimit) break
  }
  return {
    mode: "flat",
    theme: activeTheme ? { id: activeTheme.id, label: activeTheme.label } : null,
    segmentConfigStatus,
    segmentConfigWarning,
    activeSegments: [],
    segmentPools: [],
    candidates: deduped,
  }
}

export function collectTopicStockCandidates(query, mapping, evidenceItems = [], options = {}) {
  return collectTopicStockCandidateSet(query, mapping, evidenceItems, options).candidates
}

export function topicStockIntent(query, candidate) {
  const lookbackDays = parseStockLookbackDays(query)
  return {
    isStockQuestion: true,
    lookbackDays,
    stockName: candidate.name,
    stockCode: candidate.code,
    tickerCandidates: stockCodeAlternatives(candidate.code),
    wantsVolume: true,
    wantsAmount: true,
    wantsPctChange: true,
  }
}

export function topicStockValidationEvidence({ candidate, validation, nativeQuery, index }) {
  const firstDate = validation?.firstDate ?? "unknown"
  const lastDate = validation?.lastDate ?? "unknown"
  const tableName = nativeQuery?.table?.split(".").slice(-1)[0] ?? ASK_STOCK_DAILY_DEFAULT_TABLE
  const segmentLabels = topicCandidateSegmentLabels(candidate)
  const excerpt = [
    `candidate=${candidate.name} ${candidate.code}`,
    segmentLabels.length ? `segments=${segmentLabels.join(" / ")}` : "",
    `status=${validation?.status ?? "unknown"}`,
    `verdict=${validation?.verdict ?? "证据不足"}`,
    `window=${firstDate}->${lastDate}`,
    `rows=${validation?.rowCount ?? 0}`,
    `period_return_pct=${validation?.periodReturnPct ?? "NA"}`,
    validation?.returnSource ? `return_source=${validation.returnSource}` : "",
    validation?.crossCheckStatus ? `cross_check=${validation.crossCheckStatus}: ${validation.crossCheckReason ?? "none"}` : "",
    validation?.sqlPeriodReturnPct != null || validation?.externalPeriodReturnPct != null
      ? `return_cross_check=sql:${validation?.sqlPeriodReturnPct ?? "NA"} external:${validation?.externalPeriodReturnPct ?? "NA"}`
      : "",
    `last_volume_vs_avg=${validation?.lastVolumeVsAvg ?? "NA"}`,
    `last_amount=${validation?.lastAmount ?? "NA"}`,
    `avg_amount=${validation?.avgAmount ?? "NA"}`,
    `candidate_reasons=${candidate.reasons.join("; ") || "matched"}`,
    validation?.reason ? `reason=${validation.reason}` : "",
    validation?.refs?.length ? `row_refs=${validation.refs.slice(0, 6).join(", ")}` : "",
  ].filter(Boolean).join("\n")
  return {
    sourceId: "stock_daily_sql",
    path: `sql:${tableName}#${candidate.code}/${firstDate}_${lastDate}`,
    title: `${candidate.name} ${candidate.code}${segmentLabels.length ? ` ${segmentLabels.join("/")}` : ""} 主题量价验证`,
    score: 35 - index,
    type: "SQL_TOPIC_VALIDATION",
    nativeQuery: nativeQuery?.summary ?? null,
    excerpt,
  }
}

export function buildTopicCandidateFailureValidation(candidate, status, warning, query) {
  return {
    sourceId: "stock_daily_sql",
    status,
    verdict: "证据不足",
    reason: warning,
    stockName: candidate.name,
    stockCode: candidate.code,
    segments: topicCandidateSegmentLabels(candidate),
    lookbackDays: parseStockLookbackDays(query),
    rowCount: 0,
    refs: [],
  }
}

export async function searchAskTopicStockDaily(projectPath, query, options = {}) {
  const evidenceItems = options.evidenceItems ?? []
  const descriptor = options.stockDailyDescriptor ?? (await describeStockDailySqlSource(options))
  const mapping = options.stockCodeMapping instanceof Map ? options.stockCodeMapping : await loadStockCodeMapping(projectPath)
  const topicSegmentRegistry = Array.isArray(options.topicSegmentRegistry) || Array.isArray(options.topicMarketSegmentRegistry)
    ? (options.topicSegmentRegistry ?? options.topicMarketSegmentRegistry)
    : await loadTopicMarketSegmentRegistry(projectPath, options)
  const candidateSet = collectTopicStockCandidateSet(query, mapping, evidenceItems, {
    ...options,
    topicSegmentRegistry,
  })
  const candidates = candidateSet.candidates
  if (candidates.length === 0) {
    const excludedCount = candidateSet.segmentPools.reduce((sum, pool) => sum + (pool.excludedCandidates?.length ?? 0), 0)
    return {
      status: "insufficient",
      descriptor,
      candidates: [],
      theme: candidateSet.theme,
      segmentMode: candidateSet.mode,
      segmentConfigStatus: candidateSet.segmentConfigStatus,
      segmentConfigWarning: candidateSet.segmentConfigWarning,
      segmentPools: candidateSet.segmentPools,
      validations: [],
      nativeQueries: [],
      results: [],
      rowCount: 0,
      warning: excludedCount > 0
        ? `主题量价验证已识别细分环节，但 ${excludedCount} 个候选因跨多个细分环节宽泛命中被过滤，未进入 SQL 验证池`
        : candidateSet.activeSegments.length > 0
        ? `主题量价验证已识别细分环节（${candidateSet.activeSegments.map((segment) => segment.label).join(" / ")}），但未匹配到有代码映射的候选股票`
        : "主题量价验证未从检索上下文中匹配到有代码映射的候选股票",
    }
  }
  if (!descriptor.ok && !options.stockDailyExecutor) {
    return {
      status: "unavailable",
      descriptor,
      candidates,
      theme: candidateSet.theme,
      segmentMode: candidateSet.mode,
      segmentConfigStatus: candidateSet.segmentConfigStatus,
      segmentConfigWarning: candidateSet.segmentConfigWarning,
      segmentPools: candidateSet.segmentPools,
      validations: candidates.map((candidate) => ({
        candidate,
        status: "unavailable",
        warning: `SQL 源不可用: ${descriptor.error}`,
        marketValidation: buildTopicCandidateFailureValidation(candidate, "unavailable", `SQL 源不可用: ${descriptor.error}`, query),
        nativeQuery: null,
      })),
      nativeQueries: [],
      results: [],
      rowCount: 0,
      warning: `SQL 源不可用: ${descriptor.error}`,
    }
  }

  const concurrency = parsePositiveInteger(options.marketValidationConcurrency ?? options.agentConcurrency, DEFAULT_AGENT_CONCURRENCY)
  const executions = await mapWithConcurrency(candidates, concurrency, async (candidate, index) => {
    const intent = topicStockIntent(query, candidate)
    const nativeQuery = buildStockDailySqlQuery(intent, descriptor, options)
    try {
      const execution = await executeStockDailyQuery(nativeQuery, options)
      const rows = Array.isArray(execution?.rows) ? execution.rows : []
      const stockDaily = {
        status: "ok",
        intent,
        descriptor,
        nativeQuery,
        results: stockDailyRowsToEvidence({ rows, nativeQuery, descriptor, intent }),
        warning: rows.length > 0 ? null : "SQL 源执行成功，但没有返回日线记录",
      }
      const marketCrossCheck = await crossCheckAskStockDaily(stockDaily, options)
      const checkedStockDaily = { ...stockDaily, marketCrossCheck }
      const marketValidation = buildStockDailyMarketValidation(checkedStockDaily, query)
      return {
        candidate,
        status: rows.length > 0 ? "ok" : "empty",
        rowCount: rows.length,
        marketValidation,
        nativeQuery,
        evidence: topicStockValidationEvidence({ candidate, validation: marketValidation, nativeQuery, index }),
        warning: [stockDaily.warning, marketCrossCheck.warning].filter(Boolean).join("; ") || null,
      }
    } catch (err) {
      const warning = `SQL 查询失败: ${safeErrorMessage(err)}`
      return {
        candidate,
        status: "error",
        rowCount: 0,
        marketValidation: buildTopicCandidateFailureValidation(candidate, "error", warning, query),
        nativeQuery,
        evidence: null,
        warning,
      }
    }
  })

  const rowCount = executions.reduce((sum, item) => sum + (item.rowCount ?? 0), 0)
  const okCount = executions.filter((item) => item.rowCount > 0).length
  const failedCount = executions.filter((item) => item.status === "error" || item.status === "unavailable").length
  const crossCheckWarning = executions.map((item) => item.warning).filter(Boolean)[0] ?? null
  const status = okCount > 0 ? (failedCount > 0 ? "partial" : "ready") : (failedCount > 0 ? "error" : "insufficient")
  const warning = status === "ready"
    ? crossCheckWarning
    : okCount > 0
      ? [`主题量价验证部分成功：${okCount}/${executions.length} 个候选股票返回日线`, crossCheckWarning].filter(Boolean).join("; ")
      : executions.map((item) => item.warning).filter(Boolean)[0] ?? "主题量价验证没有返回可用日线"
  return {
    status,
    descriptor,
    candidates,
    theme: candidateSet.theme,
    segmentMode: candidateSet.mode,
    segmentConfigStatus: candidateSet.segmentConfigStatus,
    segmentConfigWarning: candidateSet.segmentConfigWarning,
    segmentPools: candidateSet.segmentPools,
    validations: executions,
    nativeQueries: executions.map((item) => ({
      stockName: item.candidate.name,
      stockCode: item.candidate.code,
      segments: topicCandidateSegmentLabels(item.candidate),
      summary: item.nativeQuery?.summary ?? item.warning ?? "not executed",
      status: item.status,
    })),
    results: executions.map((item) => item.evidence).filter(Boolean),
    rowCount,
    warning,
  }
}

export function buildTopicStockDailyMarketValidation(topicStockDaily, query) {
  if (!topicStockDaily) return null
  const validations = topicStockDaily.validations ?? []
  const candidateRows = validations.map((item) => ({
    stockName: item.candidate?.name ?? item.marketValidation?.stockName ?? null,
    stockCode: item.candidate?.code ?? item.marketValidation?.stockCode ?? null,
    segments: topicCandidateSegmentLabels(item.candidate ?? {}),
    status: item.marketValidation?.status ?? item.status,
    verdict: item.marketValidation?.verdict ?? "证据不足",
    reason: item.marketValidation?.reason ?? item.warning ?? null,
    firstDate: item.marketValidation?.firstDate ?? null,
    lastDate: item.marketValidation?.lastDate ?? null,
    rowCount: item.marketValidation?.rowCount ?? item.rowCount ?? 0,
    periodReturnPct: item.marketValidation?.periodReturnPct ?? null,
    returnSource: item.marketValidation?.returnSource ?? null,
    crossCheckStatus: item.marketValidation?.crossCheckStatus ?? null,
    crossCheckReason: item.marketValidation?.crossCheckReason ?? null,
    sqlPeriodReturnPct: item.marketValidation?.sqlPeriodReturnPct ?? null,
    externalPeriodReturnPct: item.marketValidation?.externalPeriodReturnPct ?? null,
    lastVolumeVsAvg: item.marketValidation?.lastVolumeVsAvg ?? null,
    avgAmount: item.marketValidation?.avgAmount ?? null,
    lastAmount: item.marketValidation?.lastAmount ?? null,
    refs: item.marketValidation?.refs ?? [],
    candidateReasons: item.candidate?.reasons ?? [],
  }))
  const readyRows = candidateRows.filter((item) => item.rowCount > 0)
  const rowByCode = new Map(candidateRows.map((item) => [item.stockCode, item]))
  const segmentPools = (topicStockDaily.segmentPools ?? []).map((pool) => ({
    id: pool.id,
    label: pool.label,
    candidates: (pool.candidates ?? []).map((candidate) => rowByCode.get(candidate.code) ?? {
      stockName: candidate.name,
      stockCode: candidate.code,
      segments: topicCandidateSegmentLabels(candidate),
      status: "not_queried",
      verdict: "证据不足",
      reason: "该候选未进入最终 SQL 查询池",
      rowCount: 0,
      candidateReasons: candidate.reasons ?? [],
    }),
    excludedCandidates: (pool.excludedCandidates ?? []).map((candidate) => ({
      stockName: candidate.name,
      stockCode: candidate.code,
      segments: topicCandidateSegmentLabels(candidate),
      reason: candidate.reason ?? "跨多个细分环节宽泛命中，未进入细分 SQL 验证池",
      candidateReasons: candidate.reasons ?? [],
    })),
  }))
  const representedSegments = segmentPools.filter((pool) => pool.candidates.length > 0)
  const missingSegments = segmentPools
    .filter((pool) => !pool.candidates.length)
    .map((pool) => pool.label)
  const direction = inferMarketValidationDirection(query)
  const verdict = readyRows.length > 0 ? "待继续观察" : "证据不足"
  const reason = readyRows.length > 0
    ? segmentPools.length > 0
      ? `已按 ${segmentPools.length} 个细分环节构建候选池，其中 ${representedSegments.length} 个环节（${representedSegments.map((pool) => pool.label).join(" / ") || "无"}）对 ${readyRows.length}/${candidateRows.length} 个候选股票做日线量价验证；${missingSegments.length ? `缺口：${missingSegments.join(" / ")}。` : ""}该结果只能证明市场承接/扩散状态，不能单独证明订单兑现。`
      : `已对 ${readyRows.length}/${candidateRows.length} 个主题候选股票做日线量价验证；${topicStockDaily.segmentConfigWarning ? `${topicStockDaily.segmentConfigWarning}；` : ""}该结果只能证明市场承接/扩散状态，不能单独证明订单兑现。`
    : topicStockDaily.warning ?? "主题候选股票未返回可用日线"
  return {
    sourceId: "stock_daily_sql",
    scope: representedSegments.length > 0 ? "topic-segmented" : "topic",
    status: topicStockDaily.status,
    verdict,
    reason,
    theme: topicStockDaily.theme ?? null,
    segmentConfigStatus: topicStockDaily.segmentConfigStatus ?? null,
    segmentConfigWarning: topicStockDaily.segmentConfigWarning ?? null,
    expectedDirection: direction,
    lookbackDays: parseStockLookbackDays(query),
    candidateCount: candidateRows.length,
    segmentCount: segmentPools.length,
    representedSegmentCount: representedSegments.length,
    missingSegments,
    rowCount: topicStockDaily.rowCount ?? readyRows.reduce((sum, item) => sum + (item.rowCount ?? 0), 0),
    segmentPools,
    candidates: candidateRows,
    refs: candidateRows.flatMap((item) => item.refs ?? []).slice(0, 24),
  }
}

export function buildAskMarketValidation(stockDaily, topicStockDaily, query) {
  const topicValidation = buildTopicStockDailyMarketValidation(topicStockDaily, query)
  if (topicValidation) return topicValidation
  return buildStockDailyMarketValidation(stockDaily, query)
}

export function buildDailyLoopStockDailyNativeQuery(codes, descriptor, options = {}) {
  const columns = descriptor?.columns ?? resolveStockDailyColumns([])
  if (!columns.ready) throw new Error("stock_daily_sql is unavailable: missing ticker/date columns")
  const config = getStockDailyPgConfig(process.env, options)
  const table = `${quotePgIdentifier(config.schema)}.${quotePgIdentifier(config.table)}`
  const selected = [
    columns.ticker,
    columns.date,
    columns.open,
    columns.high,
    columns.low,
    columns.close,
    columns.preClose,
    columns.change,
    columns.pctChange,
    columns.volume,
    columns.amount,
    columns.turnover,
  ].filter(Boolean)
  const uniqueSelected = [...new Set(selected)]
  const selectSql = uniqueSelected.map((column) => quotePgIdentifier(column)).join(", ")
  const limit = Math.min(parsePositiveInteger(options.sqlLimit, ASK_DEFAULT_SQL_LIMIT), parsePositiveInteger(options.lookbackDays, 20))
  const normalizedCodes = [...new Set(codes.map(normalizeStockCode).filter(Boolean))]
  const tickerCandidates = normalizedCodes
  const validationAnchorDate = String(options.validationAnchorDate ?? "").trim()
  const hasValidationAnchor = /^\d{4}-\d{2}-\d{2}$/.test(validationAnchorDate)
  const dateColumn = quotePgIdentifier(columns.date)
  const validationAnchorPredicate = hasValidationAnchor ? `\n    and ${dateColumn} ${options.validationAnchorExclusive ? ">" : ">="} $3::date` : ""
  const rankOrder = hasValidationAnchor ? "asc" : "desc"
  const sql = `
with ranked as (
  select ${selectSql},
         row_number() over (partition by ${quotePgIdentifier(columns.ticker)} order by ${dateColumn} ${rankOrder}) as rn
  from ${table}
  where ${quotePgIdentifier(columns.ticker)} = any($1::text[])${validationAnchorPredicate}
)
select ${selectSql}
from ranked
where rn <= $2
order by ${quotePgIdentifier(columns.ticker)} asc, ${dateColumn} asc
`.trim()
  return {
    language: "SQL",
    sql,
    params: hasValidationAnchor ? [tickerCandidates, limit, validationAnchorDate] : [tickerCandidates, limit],
    summary: hasValidationAnchor
      ? `SELECT first ${limit} trading day(s) after prediction anchor ${validationAnchorDate} for ${normalizedCodes.length} ticker(s) FROM ${config.schema}.${config.table}`
      : `SELECT daily OHLCV metrics for ${normalizedCodes.length} ticker(s) FROM ${config.schema}.${config.table} LIMIT ${limit} per ticker`,
    table: `${config.database}.${config.schema}.${config.table}`,
    limit,
    tickerCandidates,
    normalizedCodes,
    validationAnchorDate: hasValidationAnchor ? validationAnchorDate : null,
    validationAnchorExclusive: hasValidationAnchor ? Boolean(options.validationAnchorExclusive) : null,
  }
}

export function parseDailyLoopMarketValidateMode(value) {
  const raw = String(value ?? DAILY_LOOP_EXTERNAL_MARKET_DEFAULT).trim().toLowerCase()
  if (!raw || raw === "auto") return "auto"
  if (["off", "none", "false", "0"].includes(raw)) return "off"
  if (["tencent", "tencent_kline", "qq"].includes(raw)) return "tencent"
  if (["eastmoney", "eastmoney_kline", "online", "web"].includes(raw)) return "eastmoney"
  return "auto"
}

export function eastmoneySecid(code) {
  const normalized = normalizeStockCode(code)
  if (!normalized) return null
  const exchange = normalized.slice(0, 2)
  const digits = normalized.slice(2)
  if (exchange === "SH") return `1.${digits}`
  if (exchange === "SZ") return `0.${digits}`
  if (exchange === "BJ") return `0.${digits}`
  return null
}

export function eastmoneyKlineUrl(code, limit) {
  const secid = eastmoneySecid(code)
  if (!secid) return null
  return [
    "https://push2his.eastmoney.com/api/qt/stock/kline/get?",
    `secid=${encodeURIComponent(secid)}`,
    "&klt=101&fqt=1",
    `&lmt=${Math.max(1, limit)}`,
    "&end=20500101",
    "&fields1=f1,f2,f3,f4,f5,f6",
    "&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61",
  ].join("")
}

export function tencentSymbol(code) {
  const normalized = normalizeStockCode(code)
  if (!normalized) return null
  const exchange = normalized.slice(0, 2).toLowerCase()
  const digits = normalized.slice(2)
  if (!["sh", "sz", "bj"].includes(exchange)) return null
  return `${exchange}${digits}`
}

export function tencentKlineUrl(code, limit) {
  const symbol = tencentSymbol(code)
  if (!symbol) return null
  return `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${symbol},day,,,${Math.max(1, limit)},qfq`
}

export async function normalizeExternalMarketPayload(payload) {
  if (payload && typeof payload.json === "function") return payload.json()
  if (typeof payload === "string") return JSON.parse(payload)
  return payload
}

export async function httpsGetText(url, options = {}) {
  const timeoutMs = parsePositiveInteger(options.timeoutMs, 8000)
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        timeout: timeoutMs,
        headers: {
          accept: "application/json,text/plain,*/*",
          referer: "https://quote.eastmoney.com/",
          "user-agent": "Mozilla/5.0 TradingReviewWiki/1.0",
        },
      },
      (res) => {
        let body = ""
        res.setEncoding("utf8")
        res.on("data", (chunk) => {
          body += chunk
        })
        res.on("end", () => {
          if ((res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300) resolve(body)
          else reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`))
        })
      },
    )
    req.on("timeout", () => {
      req.destroy(new Error(`HTTPS timeout after ${timeoutMs}ms`))
    })
    req.on("error", reject)
  })
}

export async function curlGetText(url, options = {}) {
  const timeoutSec = String(Math.max(1, Math.ceil(parsePositiveInteger(options.timeoutMs, 8000) / 1000)))
  const { stdout } = await execFileAsync(
    "curl",
    [
      "-L",
      "--silent",
      "--show-error",
      "--connect-timeout",
      timeoutSec,
      "--max-time",
      timeoutSec,
      "-H",
      "Referer: https://quote.eastmoney.com/",
      "-H",
      "User-Agent: Mozilla/5.0 TradingReviewWiki/1.0",
      url,
    ],
    { maxBuffer: 1024 * 1024 },
  )
  return stdout
}

export async function fetchJsonWithHttpsFallback(url, options = {}) {
  const timeoutMs = parsePositiveInteger(options.timeoutMs, 8000)
  try {
    return JSON.parse(await curlGetText(url, { timeoutMs }))
  } catch {
    // Some market endpoints are picky by client stack. Curl is fastest on this
    // machine; fetch/https remain as fallback for environments without curl.
  }
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        accept: "application/json,text/plain,*/*",
        referer: "https://quote.eastmoney.com/",
        "user-agent": "Mozilla/5.0 TradingReviewWiki/1.0",
      },
    })
    return response.json()
  } catch {
    return JSON.parse(await httpsGetText(url, { timeoutMs }))
  }
}

export async function fetchEastmoneyKlinesForStock(stock, options = {}) {
  const limit = parsePositiveInteger(options.stockLookbackDays ?? options.lookbackDays, 20)
  const url = eastmoneyKlineUrl(stock.code, limit)
  if (!url) return { code: stock.code, status: "invalid_code", rows: [], warning: "无法映射东方财富 secid", source: "eastmoney_kline" }
  try {
    const payload = options.externalMarketFetcher
      ? await options.externalMarketFetcher({ source: "eastmoney_kline", code: stock.code, url, limit })
      : await fetchJsonWithHttpsFallback(url, { timeoutMs: options.externalMarketTimeoutMs })
    const parsed = await normalizeExternalMarketPayload(payload)
    if (parsed?.rc !== 0 || !parsed?.data) return { code: stock.code, status: "error", rows: [], warning: `东方财富返回异常 rc=${parsed?.rc ?? "NA"}`, source: "eastmoney_kline" }
    const normalized = normalizeStockCode(stock.code)
    const rows = Array.isArray(parsed.data.klines)
      ? parsed.data.klines
          .map((line) => String(line).split(","))
          .filter((parts) => parts.length >= 11)
          .map((parts) => ({
            ticker: normalized,
            date: parts[0],
            open: Number(parts[1]),
            close: Number(parts[2]),
            high: Number(parts[3]),
            low: Number(parts[4]),
            volume: Number(parts[5]),
            amount: Number(parts[6]),
            pctChange: Number(parts[8]),
            change: Number(parts[9]),
            turnover: Number(parts[10]),
          }))
      : []
    return { code: stock.code, status: rows.length > 0 ? "ok" : "no_rows", rows, warning: rows.length > 0 ? null : "东方财富未返回K线", name: parsed.data.name ?? stock.name, source: "eastmoney_kline" }
  } catch (err) {
    return { code: stock.code, status: "error", rows: [], warning: `东方财富K线失败: ${safeErrorMessage(err)}`, source: "eastmoney_kline" }
  }
}

export async function fetchTencentKlinesForStock(stock, options = {}) {
  const limit = parsePositiveInteger(options.stockLookbackDays ?? options.lookbackDays, 20)
  const url = tencentKlineUrl(stock.code, limit)
  const symbol = tencentSymbol(stock.code)
  if (!url || !symbol) return { code: stock.code, status: "invalid_code", rows: [], warning: "无法映射腾讯 symbol", source: "tencent_kline" }
  try {
    const payload = options.externalMarketFetcher
      ? await options.externalMarketFetcher({ source: "tencent_kline", code: stock.code, url, limit })
      : JSON.parse(await curlGetText(url, { timeoutMs: options.externalMarketTimeoutMs }))
    const parsed = await normalizeExternalMarketPayload(payload)
    if (parsed?.code !== 0 || !parsed?.data?.[symbol]) return { code: stock.code, status: "error", rows: [], warning: `腾讯K线返回异常 code=${parsed?.code ?? "NA"}`, source: "tencent_kline" }
    const rawRows = parsed.data[symbol].qfqday ?? parsed.data[symbol].day ?? []
    const normalized = normalizeStockCode(stock.code)
    const rows = Array.isArray(rawRows)
      ? rawRows
          .filter((parts) => Array.isArray(parts) && parts.length >= 6)
          .map((parts) => ({
            ticker: normalized,
            date: parts[0],
            open: Number(parts[1]),
            close: Number(parts[2]),
            high: Number(parts[3]),
            low: Number(parts[4]),
            volume: Number(parts[5]),
            amount: null,
            pctChange: null,
            change: null,
            turnover: null,
          }))
      : []
    return { code: stock.code, status: rows.length > 0 ? "ok" : "no_rows", rows, warning: rows.length > 0 ? null : "腾讯未返回K线", name: stock.name, source: "tencent_kline" }
  } catch (err) {
    return { code: stock.code, status: "error", rows: [], warning: `腾讯K线失败: ${safeErrorMessage(err)}`, source: "tencent_kline" }
  }
}

export async function fetchDailyLoopExternalMarketMetrics(stocks, options = {}) {
  const mode = parseDailyLoopMarketValidateMode(options.marketValidate ?? options.marketValidation ?? options.externalMarket)
  const uniqueStocks = [...new Map(stocks.filter((stock) => stock?.code).map((stock) => [stock.code, stock])).values()]
  if (mode === "off") return { status: "off", source: null, metrics: new Map(), warning: "external market validation disabled" }
  if (uniqueStocks.length === 0) return { status: "empty", source: "eastmoney_kline", metrics: new Map(), warning: "没有可外部验证的股票代码" }
  const concurrency = parsePositiveInteger(options.externalMarketConcurrency, 4)
  const source = mode === "eastmoney" ? "eastmoney_kline" : "tencent_kline"
  const items = await mapWithConcurrency(uniqueStocks, concurrency, async (stock) => {
    const fetchOptions = { ...options, lookbackDays: options.stockLookbackDays ?? options.lookbackDays ?? 20 }
    if (mode === "eastmoney") return fetchEastmoneyKlinesForStock(stock, fetchOptions)
    const tencent = await fetchTencentKlinesForStock(stock, fetchOptions)
    if (tencent.status === "ok" || mode === "tencent") return tencent
    return fetchEastmoneyKlinesForStock(stock, fetchOptions)
  })
  const metrics = new Map()
  let okCount = 0
  const warnings = []
  for (const item of items) {
    const stock = uniqueStocks.find((candidate) => candidate.code === item.code)
    if (!stock) continue
    const itemSource = item.source ?? source
    if (item.status === "ok") {
      okCount += 1
      const metric = metricFromStockRows({
        code: stock.code,
        name: stock.name,
        branch: stock.branch,
        rows: item.rows,
        columns: EASTMONEY_KLINE_COLUMNS,
        tableName: itemSource,
      })
      metrics.set(stock.code, { ...metric, source: itemSource, externalRef: `external:${itemSource}#${stock.code}/${metric.endDate}` })
    } else {
      metrics.set(stock.code, { code: stock.code, name: stock.name, branch: stock.branch, status: item.status, warning: item.warning, source: itemSource })
      if (item.warning) warnings.push(`${stock.code}: ${item.warning}`)
    }
  }
  return {
    status: okCount > 0 ? "ok" : "unavailable",
    source,
    metrics,
    okCount,
    total: uniqueStocks.length,
    warning: warnings.length ? warnings.slice(0, 5).join("; ") : null,
  }
}

export function marketMetricDateValue(metric) {
  const parsed = Date.parse(`${metric?.endDate ?? ""}T00:00:00`)
  return Number.isFinite(parsed) ? parsed : null
}

export function compareDailyMarketMetrics(sqlMetric, externalMetric) {
  const sqlOk = sqlMetric?.status === "ok"
  const extOk = externalMetric?.status === "ok"
  if (sqlOk && extOk) {
    const sqlDate = marketMetricDateValue(sqlMetric)
    const extDate = marketMetricDateValue(externalMetric)
    const pctDiff = sqlMetric.pct20 != null && externalMetric.pct20 != null ? Math.abs(sqlMetric.pct20 - externalMetric.pct20) : null
    const closeDiffPct =
      sqlMetric.closeEnd != null && externalMetric.closeEnd != null && externalMetric.closeEnd !== 0
        ? Math.abs((sqlMetric.closeEnd - externalMetric.closeEnd) / externalMetric.closeEnd) * 100
        : null
    if (extDate != null && sqlDate != null && extDate > sqlDate) {
      return {
        status: "sql_stale",
        confidence: 0.72,
        reason: `本地SQL日期${sqlMetric.endDate}落后在线行情${externalMetric.endDate}`,
        pctDiff: roundMetric(pctDiff, 2),
        closeDiffPct: roundMetric(closeDiffPct, 2),
      }
    }
    if (extDate != null && sqlDate != null && extDate < sqlDate) {
      return {
        status: "external_stale",
        confidence: 0.72,
        reason: `在线行情日期${externalMetric.endDate}落后本地SQL${sqlMetric.endDate}`,
        pctDiff: roundMetric(pctDiff, 2),
        closeDiffPct: roundMetric(closeDiffPct, 2),
      }
    }
    if ((pctDiff != null && pctDiff > 3) || (closeDiffPct != null && closeDiffPct > 1.5)) {
      return {
        status: "divergent",
        confidence: 0.45,
        reason: `SQL与在线行情差异较大 pctDiff=${roundMetric(pctDiff, 2)} closeDiffPct=${roundMetric(closeDiffPct, 2)}`,
        pctDiff: roundMetric(pctDiff, 2),
        closeDiffPct: roundMetric(closeDiffPct, 2),
      }
    }
    return { status: "confirmed", confidence: 0.95, reason: "SQL与在线行情口径基本一致", pctDiff: roundMetric(pctDiff, 2), closeDiffPct: roundMetric(closeDiffPct, 2) }
  }
  if (extOk && !sqlOk) return { status: "external_only", confidence: 0.65, reason: "只有在线行情可用，本地SQL缺失或失败" }
  if (sqlOk && !extOk) return { status: "sql_only", confidence: 0.55, reason: externalMetric?.warning ?? "在线行情不可用，仅有本地SQL" }
  return { status: "unavailable", confidence: 0.2, reason: "本地SQL与在线行情均不可用" }
}

export function mergeDailyLoopMarketMetrics(stocks, sqlMetrics, externalMetrics) {
  const merged = new Map()
  for (const stock of stocks) {
    const sqlMetric = sqlMetrics.get(stock.code) ?? { code: stock.code, name: stock.name, status: "missing" }
    const externalMetric = externalMetrics.get(stock.code) ?? { code: stock.code, name: stock.name, status: "missing", source: "eastmoney_kline" }
    const validation = compareDailyMarketMetrics(sqlMetric, externalMetric)
    const sqlDate = marketMetricDateValue(sqlMetric)
    const extDate = marketMetricDateValue(externalMetric)
    const useExternal = externalMetric.status === "ok" && (sqlMetric.status !== "ok" || validation.status === "sql_stale" || extDate == null || sqlDate == null || extDate >= sqlDate)
    const primary = useExternal ? externalMetric : sqlMetric
    const refs = [
      sqlMetric.status === "ok" ? sqlMetric.sqlRef : null,
      externalMetric.status === "ok" ? externalMetric.externalRef : null,
    ].filter(Boolean)
    merged.set(stock.code, {
      ...primary,
      amountRatio: primary.amountRatio ?? sqlMetric.amountRatio ?? externalMetric.amountRatio ?? null,
      avgTurnoverLast5: primary.avgTurnoverLast5 ?? sqlMetric.avgTurnoverLast5 ?? externalMetric.avgTurnoverLast5 ?? null,
      volumeRatio: primary.volumeRatio ?? externalMetric.volumeRatio ?? sqlMetric.volumeRatio ?? null,
      source: useExternal ? externalMetric.source ?? "external_market" : "stock_daily_sql",
      sqlMetric,
      externalMetric,
      marketValidation: validation,
      refs,
      sqlRef: sqlMetric.status === "ok" ? sqlMetric.sqlRef : null,
      externalRef: externalMetric.status === "ok" ? externalMetric.externalRef : null,
    })
  }
  return merged
}

export function metricFromStockRows({ code, name, branch, rows, columns, tableName, requiredRows = null, validationAnchorDate = null }) {
  const sorted = [...rows].sort((a, b) => {
    const av = sqlDateSortValue(a[columns.date])
    const bv = sqlDateSortValue(b[columns.date])
    if (typeof av === "number" && typeof bv === "number") return av - bv
    return String(av).localeCompare(String(bv))
  })
  const required = parsePositiveInteger(requiredRows, null)
  const anchorDate = String(validationAnchorDate ?? "").trim()
  if (sorted.length === 0) {
    if (anchorDate) {
      return {
        code,
        name,
        branch,
        status: "not_due",
        rows: 0,
        requiredRows: required,
        startDate: null,
        endDate: null,
        warning: `窗口尚未到期：anchor ${anchorDate} 后没有交易日记录`,
        sqlRef: null,
      }
    }
    return { code, name, branch, status: "no_rows" }
  }
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  const ref = stockDailyRowRef(last, columns, code, tableName)
  if (required && sorted.length < required) {
    return {
      code,
      name,
      branch,
      status: "not_due",
      rows: sorted.length,
      requiredRows: required,
      startDate: formatSqlCell(first[columns.date]),
      endDate: formatSqlCell(last[columns.date]),
      warning: `窗口尚未到期：需要 ${required} 个交易日，当前只有 ${sorted.length} 个`,
      sqlRef: ref,
    }
  }
  const firstClose = numberFromSqlCell(first[columns.close])
  const lastClose = numberFromSqlCell(last[columns.close])
  const fallbackPct = columns.pctChange ? numberFromSqlCell(last[columns.pctChange]) : null
  const pct20 = firstClose != null && firstClose !== 0 && lastClose != null && sorted.length >= 2 ? ((lastClose - firstClose) / firstClose) * 100 : fallbackPct
  const first5 = sorted.slice(0, Math.min(5, sorted.length))
  const last5 = sorted.slice(Math.max(0, sorted.length - 5))
  const avgAmountFirst5 = columns.amount ? averageNumbers(first5.map((row) => row[columns.amount])) : null
  const avgAmountLast5 = columns.amount ? averageNumbers(last5.map((row) => row[columns.amount])) : null
  const avgVolumeFirst5 = columns.volume ? averageNumbers(first5.map((row) => row[columns.volume])) : null
  const avgVolumeLast5 = columns.volume ? averageNumbers(last5.map((row) => row[columns.volume])) : null
  const avgTurnoverLast5 = columns.turnover ? averageNumbers(last5.map((row) => row[columns.turnover])) : null
  return {
    code,
    name,
    branch,
    status: "ok",
    startDate: formatSqlCell(first[columns.date]),
    endDate: formatSqlCell(last[columns.date]),
    rows: sorted.length,
    closeStart: roundMetric(firstClose, 4),
    closeEnd: roundMetric(lastClose, 4),
    pct20: roundMetric(pct20, 2),
    avgAmountFirst5: roundMetric(avgAmountFirst5, 2),
    avgAmountLast5: roundMetric(avgAmountLast5, 2),
    amountRatio: avgAmountFirst5 ? roundMetric(avgAmountLast5 / avgAmountFirst5, 2) : null,
    avgVolumeFirst5: roundMetric(avgVolumeFirst5, 2),
    avgVolumeLast5: roundMetric(avgVolumeLast5, 2),
    volumeRatio: avgVolumeFirst5 ? roundMetric(avgVolumeLast5 / avgVolumeFirst5, 2) : null,
    avgTurnoverLast5: roundMetric(avgTurnoverLast5, 2),
    latestPctCng: columns.pctChange ? roundMetric(numberFromSqlCell(last[columns.pctChange]), 2) : null,
    sqlRef: ref,
  }
}

export async function fetchDailyLoopStockMetrics(stocks, options = {}) {
  const uniqueStocks = [...new Map(stocks.filter((stock) => stock?.code).map((stock) => [stock.code, stock])).values()]
  if (uniqueStocks.length === 0) return { status: "empty", metrics: new Map(), warning: "没有可查询的股票代码", nativeQuery: null }
  const descriptor = options.stockDailyDescriptor ?? (await describeStockDailySqlSource(options))
  if (!descriptor.ok && !options.stockDailyExecutor) {
    return { status: "unavailable", metrics: new Map(), warning: `SQL 源不可用: ${descriptor.error}`, nativeQuery: null, descriptor }
  }
  const nativeQuery = buildDailyLoopStockDailyNativeQuery(
    uniqueStocks.map((stock) => stock.code),
    descriptor,
    { ...options, lookbackDays: options.stockLookbackDays ?? options.lookbackDays ?? 20 },
  )
  try {
    const execution = await executeStockDailyQuery(nativeQuery, options)
    const rows = Array.isArray(execution?.rows) ? execution.rows : []
    const columns = descriptor.columns
    const tableName = nativeQuery.table.split(".").slice(-1)[0]
    const codeByTicker = new Map()
    for (const stock of uniqueStocks) {
      for (const alt of stockCodeAlternatives(stock.code)) codeByTicker.set(alt, stock.code)
    }
    const grouped = new Map()
    for (const row of rows) {
      const rowTicker = String(row[columns.ticker] ?? "")
      const code = codeByTicker.get(rowTicker) ?? normalizeStockCode(rowTicker)
      if (!code) continue
      if (!grouped.has(code)) grouped.set(code, [])
      grouped.get(code).push(row)
    }
    const metrics = new Map()
    for (const stock of uniqueStocks) {
      metrics.set(
        stock.code,
        metricFromStockRows({
          code: stock.code,
          name: stock.name,
          branch: stock.branch,
          rows: grouped.get(stock.code) ?? [],
          columns,
          tableName,
          requiredRows: options.requiredRows,
          validationAnchorDate: nativeQuery.validationAnchorDate,
        }),
      )
    }
    return { status: "ok", metrics, warning: rows.length > 0 ? null : "SQL 源执行成功，但没有返回日线记录", nativeQuery, descriptor }
  } catch (err) {
    return { status: "error", metrics: new Map(), warning: `SQL 查询失败: ${safeErrorMessage(err)}`, nativeQuery, descriptor }
  }
}

export function attachDailyLoopMetrics(stocks, metricsByCode) {
  return stocks.map((stock) => ({
    ...stock,
    metric: metricsByCode.get(stock.code) ?? { code: stock.code, name: stock.name, status: "missing" },
  }))
}
