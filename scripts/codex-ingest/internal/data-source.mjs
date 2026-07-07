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
  CNINFO_DATASERVICE_KEYCHAIN_KEY_ACCOUNT,
  CNINFO_DATASERVICE_KEYCHAIN_SECRET_ACCOUNT,
  CNINFO_DATASERVICE_KEYCHAIN_SERVICE,
  COMPANY_RESEARCH_ROOT,
  COMPANY_TAVILY_KEYCHAIN_ACCOUNT,
  COMPANY_TAVILY_KEYCHAIN_SERVICE,
  COMPANY_TUSHARE_KEYCHAIN_ACCOUNT,
  COMPANY_TUSHARE_KEYCHAIN_SERVICE,
  normalizeStockCode,
  QCC_OPENAPI_KEYCHAIN_KEY_ACCOUNT,
  QCC_OPENAPI_KEYCHAIN_SECRET_ACCOUNT,
  QCC_OPENAPI_KEYCHAIN_SERVICE,
  QCC_TENDER_LIST_ENDPOINT,
  nowLocalTimestamp,
  parsePositiveInteger,
  projectRelative,
  sanitizeArtifactName,
  shortHash,
} from "./core.mjs"

export function dateCompact(value) {
  const parsed = String(value ?? "").match(/\d{4}-?\d{2}-?\d{2}/)?.[0]
  if (!parsed) return ""
  return parsed.replace(/-/g, "")
}

export function yearFromDateLike(value, fallback = new Date().getFullYear()) {
  const compact = dateCompact(value)
  const year = Number(compact.slice(0, 4))
  return Number.isFinite(year) && year > 1900 ? year : fallback
}

export function companyFinancialStartDate(options = {}) {
  const explicit = dateCompact(options.financialFrom ?? options["financial-from"])
  if (explicit) return explicit
  const endYear = yearFromDateLike(options.financialTo ?? options.to ?? nowLocalTimestamp())
  return `${Math.max(1990, endYear - 5)}0101`
}

export function companyPeriodicAnnouncementStartDate(options = {}) {
  const explicit = String(options.cninfoPeriodicFrom ?? options["cninfo-periodic-from"] ?? "").trim()
  if (explicit) return explicit
  const endYear = yearFromDateLike(options.to ?? nowLocalTimestamp())
  return `${Math.max(1990, endYear - 1)}-01-01`
}

export function companyEventAnnouncementStartDate(options = {}) {
  const explicit = String(options.cninfoEventFrom ?? options["cninfo-event-from"] ?? "").trim()
  if (explicit) return explicit
  const endYear = yearFromDateLike(options.to ?? nowLocalTimestamp())
  return `${Math.max(1990, endYear - 3)}-01-01`
}

export function parseDateMs(value) {
  const n = Number(value)
  if (Number.isFinite(n) && n > 0) return n
  const parsed = Date.parse(String(value ?? ""))
  return Number.isFinite(parsed) ? parsed : 0
}

export function localDateFromMs(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return ""
  const d = new Date(ms)
  const pad = (n) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function companyResearchReportId(company, options = {}) {
  if (options.reportId) return sanitizeArtifactName(options.reportId)
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const stock = company.stockCode ?? company.tsCode ?? company.stockInput ?? "company"
  return `${stamp}-${sanitizeArtifactName(stock)}`
}

export function ensureCompanyResearchRelative(projectPath, targetPath) {
  const relativePath = projectRelative(projectPath, targetPath)
  if (relativePath !== COMPANY_RESEARCH_ROOT && !relativePath.startsWith(`${COMPANY_RESEARCH_ROOT}/`)) {
    throw new Error(`Refusing company-research write outside ${COMPANY_RESEARCH_ROOT}: ${relativePath}`)
  }
  return relativePath
}

export function readCompanySecretFromKeychain({ service, account, env = process.env, options = {} }) {
  if (options.disableKeychain || env.TRADING_WIKI_DISABLE_COMPANY_KEYCHAIN === "1") return null
  if (env.VITEST || env.NODE_ENV === "test") return null
  if (!service || !account) return null
  try {
    const output = execFileSync(
      "security",
      ["find-generic-password", "-s", String(service), "-a", String(account), "-w"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 2500 },
    )
    const secret = output.trim()
    return secret || null
  } catch {
    return null
  }
}

export function getCompanyResearchCredentials(options = {}, env = process.env) {
  const tushareToken =
    options.tushareToken ??
    env.TUSHARE_TOKEN ??
    readCompanySecretFromKeychain({
      service: options.tushareKeychainService ?? env.TRADING_WIKI_TUSHARE_KEYCHAIN_SERVICE ?? COMPANY_TUSHARE_KEYCHAIN_SERVICE,
      account: options.tushareKeychainAccount ?? env.TRADING_WIKI_TUSHARE_KEYCHAIN_ACCOUNT ?? COMPANY_TUSHARE_KEYCHAIN_ACCOUNT,
      env,
      options,
    })
  const tavilyApiKey =
    options.tavilyApiKey ??
    env.TAVILY_API_KEY ??
    readCompanySecretFromKeychain({
      service: options.tavilyKeychainService ?? env.TRADING_WIKI_TAVILY_KEYCHAIN_SERVICE ?? COMPANY_TAVILY_KEYCHAIN_SERVICE,
      account: options.tavilyKeychainAccount ?? env.TRADING_WIKI_TAVILY_KEYCHAIN_ACCOUNT ?? COMPANY_TAVILY_KEYCHAIN_ACCOUNT,
      env,
      options,
    })
  return {
    tushareToken,
    tavilyApiKey,
    status: {
      tushare: { configured: Boolean(tushareToken), auth: options.tushareToken || env.TUSHARE_TOKEN ? "env_or_option" : tushareToken ? "keychain" : "missing" },
      tavily: { configured: Boolean(tavilyApiKey), auth: options.tavilyApiKey || env.TAVILY_API_KEY ? "env_or_option" : tavilyApiKey ? "keychain" : "missing" },
    },
  }
}

export function credentialAuthLabel({ optionValue, envValue, secretValue }) {
  if (optionValue || envValue) return "env_or_option"
  return secretValue ? "keychain" : "missing"
}

export function getExternalDataCredentials(options = {}, env = process.env) {
  const companyCredentials = getCompanyResearchCredentials(options, env)
  const qccKey =
    options.qccKey ??
    env.QCC_API_KEY ??
    env.QICHACHA_KEY ??
    readCompanySecretFromKeychain({
      service: options.qccKeychainService ?? env.TRADING_WIKI_QCC_KEYCHAIN_SERVICE ?? QCC_OPENAPI_KEYCHAIN_SERVICE,
      account: options.qccKeychainKeyAccount ?? env.TRADING_WIKI_QCC_KEYCHAIN_KEY_ACCOUNT ?? QCC_OPENAPI_KEYCHAIN_KEY_ACCOUNT,
      env,
      options,
    })
  const qccSecretKey =
    options.qccSecretKey ??
    env.QCC_SECRET_KEY ??
    env.QICHACHA_SECRET_KEY ??
    readCompanySecretFromKeychain({
      service: options.qccKeychainService ?? env.TRADING_WIKI_QCC_KEYCHAIN_SERVICE ?? QCC_OPENAPI_KEYCHAIN_SERVICE,
      account: options.qccKeychainSecretAccount ?? env.TRADING_WIKI_QCC_KEYCHAIN_SECRET_ACCOUNT ?? QCC_OPENAPI_KEYCHAIN_SECRET_ACCOUNT,
      env,
      options,
    })
  const cninfoAccessKey =
    options.cninfoAccessKey ??
    env.CNINFO_ACCESS_KEY ??
    readCompanySecretFromKeychain({
      service: options.cninfoDataserviceKeychainService ?? env.TRADING_WIKI_CNINFO_DATASERVICE_KEYCHAIN_SERVICE ?? CNINFO_DATASERVICE_KEYCHAIN_SERVICE,
      account: options.cninfoDataserviceKeyAccount ?? env.TRADING_WIKI_CNINFO_DATASERVICE_KEY_ACCOUNT ?? CNINFO_DATASERVICE_KEYCHAIN_KEY_ACCOUNT,
      env,
      options,
    })
  const cninfoAccessSecret =
    options.cninfoAccessSecret ??
    env.CNINFO_ACCESS_SECRET ??
    readCompanySecretFromKeychain({
      service: options.cninfoDataserviceKeychainService ?? env.TRADING_WIKI_CNINFO_DATASERVICE_KEYCHAIN_SERVICE ?? CNINFO_DATASERVICE_KEYCHAIN_SERVICE,
      account: options.cninfoDataserviceSecretAccount ?? env.TRADING_WIKI_CNINFO_DATASERVICE_SECRET_ACCOUNT ?? CNINFO_DATASERVICE_KEYCHAIN_SECRET_ACCOUNT,
      env,
      options,
    })
  return {
    qccKey,
    qccSecretKey,
    cninfoAccessKey,
    cninfoAccessSecret,
    tushareToken: companyCredentials.tushareToken,
    status: {
      qichacha: {
        configured: Boolean(qccKey && qccSecretKey),
        keyConfigured: Boolean(qccKey),
        secretConfigured: Boolean(qccSecretKey),
        auth: credentialAuthLabel({ optionValue: options.qccKey || options.qccSecretKey, envValue: env.QCC_API_KEY || env.QCC_SECRET_KEY || env.QICHACHA_KEY || env.QICHACHA_SECRET_KEY, secretValue: qccKey && qccSecretKey }),
      },
      cninfoDataservice: {
        configured: Boolean(cninfoAccessKey && cninfoAccessSecret),
        keyConfigured: Boolean(cninfoAccessKey),
        secretConfigured: Boolean(cninfoAccessSecret),
        auth: credentialAuthLabel({ optionValue: options.cninfoAccessKey || options.cninfoAccessSecret, envValue: env.CNINFO_ACCESS_KEY || env.CNINFO_ACCESS_SECRET, secretValue: cninfoAccessKey && cninfoAccessSecret }),
      },
      tushare: companyCredentials.status.tushare,
    },
  }
}

export function buildQccOpenApiToken({ key, secretKey, timespan }) {
  const raw = `${String(key ?? "")}${String(timespan ?? "")}${String(secretKey ?? "")}`
  return createHash("md5").update(raw, "utf8").digest("hex").toUpperCase()
}

export function normalizeTenderUnits(list, amountField = null) {
  if (!Array.isArray(list)) return []
  return list.map((item) => ({
    name: String(item?.Name ?? item?.name ?? "").trim(),
    keyNo: item?.KeyNo ? String(item.KeyNo) : null,
    amount: amountField ? String(item?.[amountField] ?? "").trim() || null : null,
  })).filter((item) => item.name || item.amount)
}

export function normalizeQccTenderItem(raw) {
  return {
    id: String(raw?.Id ?? raw?.id ?? shortHash(JSON.stringify(raw ?? {}))),
    title: String(raw?.Title ?? raw?.title ?? "").trim(),
    projectNo: String(raw?.ProjectNo ?? raw?.projectNo ?? "").trim() || null,
    channelName: String(raw?.ChannelName ?? raw?.channelName ?? "").trim() || null,
    province: String(raw?.Province ?? raw?.province ?? "").trim() || null,
    city: String(raw?.City ?? raw?.city ?? "").trim() || null,
    industry: String(raw?.IndustryDesc ?? raw?.industryDesc ?? "").trim() || null,
    budgetAmount: String(raw?.BudgetAmt ?? raw?.budgetAmount ?? "").trim() || null,
    publishDate: String(raw?.PublishDate ?? raw?.publishDate ?? "").trim() || null,
    openDate: String(raw?.OpenDate ?? raw?.openDate ?? "").trim() || null,
    bidEndDate: String(raw?.BidEndDate ?? raw?.bidEndDate ?? "").trim() || null,
    contractEndTime: String(raw?.ContractEndTime ?? raw?.contractEndTime ?? "").trim() || null,
    purchaserUnits: normalizeTenderUnits(raw?.BidInviUnitList ?? raw?.bidInviUnitList),
    winnerUnits: normalizeTenderUnits(raw?.WinBidUnitList ?? raw?.winBidUnitList, "WinBidAmt"),
    agentUnits: normalizeTenderUnits(raw?.AgentUnitList ?? raw?.agentUnitList),
    progress: Array.isArray(raw?.BidProgressList) ? raw.BidProgressList.map(String) : [],
    contentUrl: String(raw?.ContentUrl ?? raw?.contentUrl ?? "").trim() || null,
  }
}

export function normalizeQccTenderResponse(response) {
  const result = response?.Result ?? response?.result ?? response
  const data = Array.isArray(result?.Data) ? result.Data : Array.isArray(response?.Data) ? response.Data : []
  const statusCode = response?.Status ?? response?.status ?? response?.Code ?? response?.code ?? null
  const message = response?.Message ?? response?.message ?? response?.Msg ?? response?.msg ?? null
  return {
    providerStatus: statusCode == null ? null : String(statusCode),
    message: message == null ? null : String(message),
    verifyResult: result?.VerifyResult ?? response?.VerifyResult ?? null,
    rows: data.map(normalizeQccTenderItem),
    rawCount: data.length,
  }
}

export async function defaultQccTenderClient({ credentials, keyword, areaCode, msgType, pubDateStart, pubDateEnd, pageIndex = 1, pageSize = 10, timeoutMs }) {
  if (!credentials.qccKey || !credentials.qccSecretKey) throw new Error("Qichacha OpenAPI key/secret is not configured")
  const timespan = Math.floor(Date.now() / 1000)
  const url = new URL(QCC_TENDER_LIST_ENDPOINT)
  url.searchParams.set("key", credentials.qccKey)
  url.searchParams.set("keyword", keyword)
  if (areaCode) url.searchParams.set("areaCode", String(areaCode))
  if (msgType) url.searchParams.set("msgType", String(msgType))
  if (pubDateStart) url.searchParams.set("pubDateStart", String(pubDateStart))
  if (pubDateEnd) url.searchParams.set("pubDateEnd", String(pubDateEnd))
  url.searchParams.set("pageIndex", String(parsePositiveInteger(pageIndex, 1)))
  url.searchParams.set("pageSize", String(Math.min(parsePositiveInteger(pageSize, 10), 20)))
  return fetchJsonWithTimeout(url, {
    timeoutMs,
    fetchOptions: {
      method: "GET",
      headers: {
        Token: buildQccOpenApiToken({ key: credentials.qccKey, secretKey: credentials.qccSecretKey, timespan }),
        Timespan: String(timespan),
      },
    },
  })
}

export async function defaultTushareDataSourceClient({ apiName, token, params = {}, fields = "", timeoutMs }) {
  if (!token) throw new Error("Tushare token is not configured")
  return fetchJsonWithTimeout("http://api.tushare.pro", {
    timeoutMs,
    fetchOptions: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_name: apiName, token, params, fields }),
    },
  })
}

function normalizeTushareProbeResponse(response) {
  const fields = Array.isArray(response?.data?.fields) ? response.data.fields : []
  const rows = Array.isArray(response?.data?.items) ? response.data.items : []
  const code = response?.code ?? null
  return {
    code,
    status: code === 0 ? "ok" : "failed",
    rowCount: rows.length,
    fieldCount: fields.length,
    message: code === 0 ? null : String(response?.msg ?? "").slice(0, 160) || null,
  }
}

function tushareRowObject(fields, row) {
  if (!Array.isArray(fields) || !Array.isArray(row)) return {}
  return Object.fromEntries(fields.map((field, index) => [String(field), row[index]]))
}

function numberOrNull(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function roundedTushareNumber(value, digits = 4) {
  const n = numberOrNull(value)
  if (n === null) return null
  const factor = 10 ** digits
  return Math.round(n * factor) / factor
}

function isoDateFromCompact(value) {
  const compact = dateCompact(value)
  if (compact.length !== 8) return ""
  return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`
}

function buildTushareEntryPriceSuggestion({ response, stockCode, tradeDate }) {
  if (response?.code !== 0) return null
  const fields = Array.isArray(response?.data?.fields) ? response.data.fields : []
  const rows = Array.isArray(response?.data?.items) ? response.data.items : []
  if (rows.length === 0) return null
  const rowObjects = rows.map((row) => tushareRowObject(fields, row))
  const matched = rowObjects.find((row) => {
    const rowCode = String(row.ts_code ?? "").trim().toUpperCase()
    const rowDate = dateCompact(row.trade_date)
    return (!rowCode || rowCode === stockCode) && (!rowDate || rowDate === tradeDate)
  }) ?? rowObjects[0]
  const close = roundedTushareNumber(matched.close)
  const open = roundedTushareNumber(matched.open)
  const price = close ?? open
  if (price === null) return null
  return {
    schema: "external-tushare-entry-price-suggestion-v1",
    provider: "tushare",
    source: "tushare:daily",
    ref: `tushare:daily#${stockCode}/${tradeDate}`,
    stockCode,
    tradeDate,
    asOfDate: isoDateFromCompact(tradeDate),
    priceType: close === null ? "open" : "close",
    price,
    close,
    open,
    pctChg: roundedTushareNumber(matched.pct_chg),
    amount: roundedTushareNumber(matched.amount, 2),
    rowCount: rows.length,
    rawRowsReturned: false,
  }
}

function tushareProbeCalls({ stockCode, tradeDate }) {
  return [
    {
      api: "stock_basic",
      params: { ts_code: stockCode },
      fields: "ts_code,symbol,name,area,industry,market,list_date",
      purpose: "stock_identity",
    },
    {
      api: "daily",
      params: { ts_code: stockCode, start_date: tradeDate, end_date: tradeDate },
      fields: "ts_code,trade_date,open,close,pct_chg,vol,amount",
      purpose: "price_path",
    },
    {
      api: "daily_basic",
      params: { ts_code: stockCode, trade_date: tradeDate },
      fields: "ts_code,trade_date,turnover_rate,volume_ratio,pe_ttm,total_mv",
      purpose: "turnover_and_valuation",
    },
    { api: "limit_list_d", params: { trade_date: tradeDate }, fields: "", purpose: "limit_up_down_board" },
    { api: "limit_step", params: { trade_date: tradeDate }, fields: "", purpose: "limit_step_ladder" },
    { api: "top_list", params: { trade_date: tradeDate }, fields: "", purpose: "dragon_tiger_list" },
    { api: "top_inst", params: { trade_date: tradeDate }, fields: "", purpose: "institution_dragon_tiger" },
    { api: "hm_detail", params: { trade_date: tradeDate }, fields: "", purpose: "hot_money_detail" },
    { api: "ths_hot", params: { trade_date: tradeDate }, fields: "", purpose: "ths_hotness" },
    { api: "dc_hot", params: { trade_date: tradeDate }, fields: "", purpose: "eastmoney_hotness" },
  ]
}

function toTushareProbeCode(value) {
  const normalized = normalizeStockCode(value)
  if (!normalized) return String(value ?? "").trim().toUpperCase()
  return `${normalized.slice(2)}.${normalized.slice(0, 2)}`
}

export async function runTushareProbe({ credentials, options = {} }) {
  const credentialStatus = credentials.status.tushare
  const stockCode = toTushareProbeCode(options.stockCode ?? options.tsCode ?? "000001.SZ") || "000001.SZ"
  const tradeDate = dateCompact(options.tradeDate ?? options.date) || "20240603"
  const calls = tushareProbeCalls({ stockCode, tradeDate })
  if (!credentials.tushareToken && !options.tushareClient) {
    return {
      schema: "external-tushare-probe-v1",
      generatedAt: nowLocalTimestamp(),
      provider: "tushare",
      status: "unavailable",
      query: { stockCode, tradeDate },
      credentialStatus,
      endpoints: calls.map((call) => ({ api: call.api, purpose: call.purpose, status: "skipped", rowCount: 0, fieldCount: 0 })),
      entryPriceSuggestion: null,
      writePolicy: { wroteFiles: false, wroteSecrets: false, returnedRows: false },
    }
  }
  const client = options.tushareClient ?? defaultTushareDataSourceClient
  const endpoints = []
  let entryPriceSuggestion = null
  for (const call of calls) {
    try {
      const response = await client({
        apiName: call.api,
        token: credentials.tushareToken,
        params: call.params,
        fields: call.fields,
        timeoutMs: options.tushareTimeoutMs,
      })
      if (call.api === "daily") {
        entryPriceSuggestion = buildTushareEntryPriceSuggestion({ response, stockCode, tradeDate })
      }
      endpoints.push({
        api: call.api,
        purpose: call.purpose,
        ...normalizeTushareProbeResponse(response),
      })
    } catch (error) {
      endpoints.push({
        api: call.api,
        purpose: call.purpose,
        status: "error",
        rowCount: 0,
        fieldCount: 0,
        message: String(error?.message ?? error).slice(0, 160),
      })
    }
  }
  const okCount = endpoints.filter((endpoint) => endpoint.status === "ok").length
  return {
    schema: "external-tushare-probe-v1",
    generatedAt: nowLocalTimestamp(),
    provider: "tushare",
    status: okCount === endpoints.length ? "ok" : okCount > 0 ? "partial" : "failed",
    query: { stockCode, tradeDate },
    credentialStatus,
    endpoints,
    entryPriceSuggestion,
    coverage: {
      total: endpoints.length,
      ok: okCount,
      failed: endpoints.filter((endpoint) => endpoint.status === "failed" || endpoint.status === "error").length,
      skipped: endpoints.filter((endpoint) => endpoint.status === "skipped").length,
    },
    writePolicy: { wroteFiles: false, wroteSecrets: false, returnedRows: false },
  }
}

export async function runDataSource(options = {}) {
  const action = String(options.action ?? options.subcommand ?? "status").trim() || "status"
  const credentials = getExternalDataCredentials(options)
  if (action === "status") {
    return {
      schema: "external-data-source-status-v1",
      generatedAt: nowLocalTimestamp(),
      providers: credentials.status,
      writePolicy: { wroteFiles: false, wroteSecrets: false },
    }
  }
  if (action === "tushare-probe" || action === "tushare" || action === "tushare-status") {
    return runTushareProbe({ credentials, options })
  }
  if (action === "qcc-tenders") {
    const keyword = String(options.keyword ?? options.query ?? "").trim()
    if (!keyword) throw new Error("Missing --keyword for data-source qcc-tenders")
    const client = options.qccTenderClient ?? defaultQccTenderClient
    const raw = await client({
      credentials,
      keyword,
      areaCode: options.areaCode,
      msgType: options.msgType,
      pubDateStart: options.pubDateStart,
      pubDateEnd: options.pubDateEnd,
      pageIndex: options.pageIndex,
      pageSize: options.pageSize,
      timeoutMs: options.qccTimeoutMs,
    })
    const normalized = normalizeQccTenderResponse(raw)
    return {
      schema: "external-qcc-tenders-v1",
      generatedAt: nowLocalTimestamp(),
      provider: "qichacha",
      api: "TenderCheck/GetList",
      query: {
        keyword,
        areaCode: options.areaCode ?? null,
        msgType: options.msgType ?? null,
        pubDateStart: options.pubDateStart ?? null,
        pubDateEnd: options.pubDateEnd ?? null,
        pageIndex: parsePositiveInteger(options.pageIndex, 1),
        pageSize: Math.min(parsePositiveInteger(options.pageSize, 10), 20),
      },
      status: normalized.providerStatus,
      message: normalized.message,
      verifyResult: normalized.verifyResult,
      count: normalized.rows.length,
      rows: normalized.rows,
      credentialStatus: credentials.status.qichacha,
      writePolicy: { wroteFiles: false, wroteSecrets: false },
    }
  }
  throw new Error(`Unknown data-source action: ${action}`)
}

export async function fetchJsonWithTimeout(url, options = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), parsePositiveInteger(options.timeoutMs, 15000))
  try {
    const response = await fetch(url, { ...options.fetchOptions, signal: controller.signal })
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`)
    return await response.json()
  } finally {
    clearTimeout(timeout)
  }
}
