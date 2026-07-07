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
  buildAskRetrievalContext,
} from "./ask-flow.mjs"

import {
  COMPANY_DEEP_TEMPLATE_VERSION,
  COMPANY_FINANCIAL_MODEL_V2_VERSION,
  COMPANY_RESEARCH_ROOT,
  COMPANY_RESEARCH_TEMPLATE_VERSION,
  DEFAULT_PROJECT_PATH,
  ensureDirectory,
  execFileAsync,
  normalizePath,
  normalizeStockCode,
  nowLocalTimestamp,
  numberFromSqlCell,
  parsePositiveInteger,
  projectRelative,
  requestCodexExecText,
  roundMetric,
  safeErrorMessage,
  sanitizeArtifactName,
  shortHash,
  writeJson,
} from "./core.mjs"

import {
  companyEventAnnouncementStartDate,
  companyFinancialStartDate,
  companyPeriodicAnnouncementStartDate,
  companyResearchReportId,
  dateCompact,
  ensureCompanyResearchRelative,
  fetchJsonWithTimeout,
  getCompanyResearchCredentials,
  localDateFromMs,
  parseDateMs,
} from "./data-source.mjs"

import {
  excerptForPrompt,
} from "./knowledge.mjs"

export const DEFAULT_COMPANY_PROVIDER_TIMEOUT_MS = 45000

export function companyProviderStageTimeoutMs(options = {}, stage, fallback = DEFAULT_COMPANY_PROVIDER_TIMEOUT_MS) {
  return parsePositiveInteger(
    options[`${stage}StageTimeoutMs`] ?? options[`${stage}-stage-timeout-ms`],
    parsePositiveInteger(options.companyProviderTimeoutMs ?? options["company-provider-timeout-ms"], fallback),
  )
}

export async function runCompanyResearchStage({ stage, label, timeoutMs, providerEvents, onProgress, fn, fallback }) {
  const startedAt = nowLocalTimestamp()
  const startedMs = Date.now()
  const effectiveTimeoutMs = parsePositiveInteger(timeoutMs, DEFAULT_COMPANY_PROVIDER_TIMEOUT_MS)
  onProgress?.(`[company-research] ${stage} started (${label}; timeout=${effectiveTimeoutMs}ms)`)
  let timer
  try {
    const result = await Promise.race([
      Promise.resolve().then(fn),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${effectiveTimeoutMs}ms`)), effectiveTimeoutMs)
      }),
    ])
    const event = {
      stage,
      label,
      status: "success",
      startedAt,
      finishedAt: nowLocalTimestamp(),
      durationMs: Date.now() - startedMs,
      timeoutMs: effectiveTimeoutMs,
    }
    providerEvents?.push(event)
    onProgress?.(`[company-research] ${stage} success (${event.durationMs}ms)`)
    return result
  } catch (err) {
    const event = {
      stage,
      label,
      status: "failed",
      startedAt,
      finishedAt: nowLocalTimestamp(),
      durationMs: Date.now() - startedMs,
      timeoutMs: effectiveTimeoutMs,
      error: safeErrorMessage(err),
    }
    providerEvents?.push(event)
    onProgress?.(`[company-research] ${stage} failed (${event.durationMs}ms): ${event.error}`)
    if (fallback) return fallback(err, event)
    throw err
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export function toTushareCode(value) {
  const normalized = normalizeStockCode(value)
  if (!normalized) return null
  return `${normalized.slice(2)}.${normalized.slice(0, 2)}`
}

export function digitsFromStockCode(value) {
  const normalized = normalizeStockCode(value)
  if (normalized) return normalized.slice(2)
  const match = String(value ?? "").match(/\b(\d{6})\b/)
  return match?.[1] ?? null
}

export function normalizeTushareResponse(apiName, response) {
  if (!response || typeof response !== "object") {
    return { apiName, status: "failed", error: "empty response", fields: [], rows: [] }
  }
  if (Number(response.code ?? 0) !== 0) {
    return { apiName, status: "failed", error: response.msg ?? `tushare code ${response.code}`, fields: [], rows: [] }
  }
  const fields = Array.isArray(response.data?.fields) ? response.data.fields.map(String) : []
  const items = Array.isArray(response.data?.items) ? response.data.items : []
  const rows = items.map((item) => Object.fromEntries(fields.map((field, index) => [field, Array.isArray(item) ? item[index] : undefined])))
  return { apiName, status: "success", error: null, fields, rows }
}

export async function fetchTextWithTimeout(url, options = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), parsePositiveInteger(options.timeoutMs, 15000))
  try {
    const response = await fetch(url, { ...options.fetchOptions, signal: controller.signal })
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`)
    return await response.text()
  } finally {
    clearTimeout(timeout)
  }
}

export async function fetchBufferWithTimeout(url, options = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), parsePositiveInteger(options.timeoutMs, 20000))
  try {
    const response = await fetch(url, { ...options.fetchOptions, signal: controller.signal })
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`)
    return Buffer.from(await response.arrayBuffer())
  } finally {
    clearTimeout(timeout)
  }
}

export function isPdfBuffer(buffer) {
  return Buffer.isBuffer(buffer) && buffer.subarray(0, 5).toString("latin1") === "%PDF-"
}

export function extractAcwScV2Cookie(html) {
  const source = String(html ?? "")
  if (!/acw_sc__v2|arg1/.test(source)) return null
  const script = source.match(/<script[^>]*>([\s\S]*?)<\/script>/i)?.[1] ?? source
  const cookies = []
  const document = {}
  Object.defineProperty(document, "cookie", {
    get() {
      return cookies.join("; ")
    },
    set(value) {
      cookies.push(String(value))
    },
  })
  const location = {
    host: "static.sse.com.cn",
    hostname: "static.sse.com.cn",
    protocol: "https:",
    reload() {},
    replace() {},
    assign() {},
    set href(_value) {},
    get href() {
      return ""
    },
  }
  const sandbox = {
    window: null,
    self: null,
    document,
    location,
    navigator: { userAgent: "Mozilla/5.0" },
    atob(value) {
      return Buffer.from(String(value), "base64").toString("binary")
    },
    btoa(value) {
      return Buffer.from(String(value), "binary").toString("base64")
    },
    setTimeout(callback) {
      if (typeof callback === "function") callback()
      return 0
    },
    clearTimeout() {},
    console: { log() {}, warn() {}, error() {} },
    Date,
    Math,
    String,
    Number,
    Array,
    Object,
    RegExp,
    parseInt,
    parseFloat,
    encodeURIComponent,
    decodeURIComponent,
  }
  sandbox.window = sandbox
  sandbox.self = sandbox
  try {
    vm.runInNewContext(script, sandbox, { timeout: 1000 })
  } catch {
    const cookie = cookies.find((item) => /acw_sc__v2=/.test(item))
    return cookie ? cookie.split(";")[0] : null
  }
  const cookie = cookies.find((item) => /acw_sc__v2=/.test(item))
  return cookie ? cookie.split(";")[0] : null
}

export async function fetchPdfBufferWithTimeout(url, options = {}) {
  const first = await fetchBufferWithTimeout(url, options)
  if (isPdfBuffer(first)) return first
  const text = first.toString("utf8")
  const cookie = extractAcwScV2Cookie(text)
  if (cookie) {
    const retryHeaders = {
      ...(options.fetchOptions?.headers ?? {}),
      Cookie: [options.fetchOptions?.headers?.Cookie, cookie].filter(Boolean).join("; "),
    }
    const retry = await fetchBufferWithTimeout(url, {
      ...options,
      fetchOptions: {
        ...(options.fetchOptions ?? {}),
        headers: retryHeaders,
      },
    })
    if (isPdfBuffer(retry)) return retry
  }
  const preview = text.replace(/\s+/g, " ").slice(0, 80)
  throw new Error(`Downloaded file is not a PDF${preview ? `: ${preview}` : ""}`)
}

export async function defaultTushareClient({ apiName, token, params = {}, fields = "", timeoutMs }) {
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

export function inferCninfoAnnouncementType(title) {
  const text = String(title ?? "").replace(/<[^>]+>/g, "")
  if (/半年度报告(?!摘要)|半年报全文/.test(text)) return "semiannual_report"
  if (/年度报告(?!摘要)|年报全文|年度报告全文/.test(text)) return "annual_report"
  if (/季度报告|一季报|三季报/.test(text)) return "quarterly_report"
  if (/管理制度|利润分配|现金分红|提前赎回.*转债|转债.*提示性公告/.test(text)) return "announcement"
  if (/投资者关系|调研|业绩说明会|互动易|路演/.test(text)) return "investor_relations"
  if (/重大|收购|预案|发行|并购|重组|定增|股权激励|可转债|回购|异常波动|资产/.test(text)) return "event"
  return "announcement"
}

export function normalizeCninfoAnnouncement(raw) {
  const ms = parseDateMs(raw.announcementTime)
  const cleanTitle = String(raw.announcementTitle ?? raw.shortTitle ?? raw.title ?? "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim()
  const adjunctUrl = String(raw.adjunctUrl ?? "").trim()
  const downloadUrl = raw.downloadUrl ?? (adjunctUrl ? `https://static.cninfo.com.cn/${adjunctUrl.replace(/^\/+/, "")}` : null)
  return {
    id: String(raw.announcementId ?? raw.id ?? shortHash(JSON.stringify(raw))),
    secCode: String(raw.secCode ?? ""),
    secName: String(raw.secName ?? raw.tileSecName ?? "").replace(/<[^>]+>/g, ""),
    orgId: raw.orgId ? String(raw.orgId) : null,
    title: cleanTitle,
    date: raw.date ?? localDateFromMs(ms),
    announcementTime: ms || null,
    adjunctUrl,
    downloadUrl,
    adjunctType: raw.adjunctType ?? null,
    adjunctSize: raw.adjunctSize ?? null,
    type: raw.type ?? inferCninfoAnnouncementType(cleanTitle),
    source: raw.source ?? "cninfo_public_web",
  }
}

export function dedupeAnnouncements(announcements) {
  const seen = new Set()
  const out = []
  for (const item of announcements) {
    const keys = [
      item.downloadUrl,
      item.adjunctUrl,
      item.id,
      `${item.secCode ?? ""}:${item.title ?? ""}:${item.date ?? ""}`,
    ].filter(Boolean)
    if (keys.some((key) => seen.has(key))) continue
    for (const key of keys) seen.add(key)
    out.push(item)
  }
  return out.sort((a, b) => (b.announcementTime ?? 0) - (a.announcementTime ?? 0) || a.title.localeCompare(b.title))
}

export function parseJsonpPayload(text) {
  const body = String(text ?? "").trim()
  const match = body.match(/^[^(]*\(([\s\S]*)\)\s*;?$/)
  return JSON.parse(match ? match[1] : body)
}

export function isShanghaiListedCompany(company) {
  const code = String(company?.stockCode ?? company?.tsCode ?? company?.stockInput ?? "").toUpperCase()
  return code.startsWith("SH") || code.endsWith(".SH") || /^6\d{5}$/.test(code)
}

export function normalizeSseAnnouncement(raw, company) {
  const title = String(raw.TITLE ?? raw.title ?? "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim()
  const date = String(raw.SSEDATE ?? raw.ADDDATE ?? raw.date ?? "").slice(0, 10)
  const urlPath = String(raw.URL ?? raw.url ?? "").trim()
  const downloadUrl = urlPath
    ? (urlPath.startsWith("http") ? urlPath : `https://static.sse.com.cn${urlPath.startsWith("/") ? "" : "/"}${urlPath}`)
    : null
  const secCode = String(raw.SECURITY_CODE ?? raw.SECURITY_CODE_A ?? raw.PRODUCTID ?? digitsFromStockCode(company?.stockCode) ?? "")
  const secName = String(raw.SECURITY_ABBR_A ?? raw.SECURITY_NAME_ABBR ?? raw.SECURITY_NAME ?? company?.stockName ?? company?.secName ?? "")
  return {
    id: `sse-${shortHash(`${secCode}:${title}:${date}:${urlPath}`)}`,
    secCode,
    secName,
    orgId: null,
    title,
    date,
    announcementTime: parseDateMs(date),
    adjunctUrl: urlPath,
    downloadUrl,
    adjunctType: "PDF",
    adjunctSize: null,
    type: inferCninfoAnnouncementType(title),
    source: "sse_public_web",
  }
}

export async function defaultSseAnnouncementClient({ company, to, timeoutMs, options = {} }) {
  if (!isShanghaiListedCompany(company)) {
    return { status: "skipped", requests: [], announcements: [] }
  }
  const digits = digitsFromStockCode(company.stockCode ?? company.tsCode ?? company.stockInput)
  if (!digits) return { status: "skipped", requests: [], announcements: [] }
  const periodicFrom = companyPeriodicAnnouncementStartDate(options)
  const eventFrom = companyEventAnnouncementStartDate(options)
  const endDate = String(to ?? nowLocalTimestamp().slice(0, 10)).slice(0, 10)
  const eventKeywords = ["重大事项", "收购", "资产收购", "并购重组", "股权激励", "投资者关系"]
  const plans = [
    { key: "", purpose: "sse_periodic_lookback", from: periodicFrom, reportType2: "DQBG" },
    ...eventKeywords.map((key) => ({ key, purpose: "sse_event_lookback", from: eventFrom, reportType2: "ALL" })),
  ]
  const requests = []
  const announcements = []
  for (const plan of plans) {
    const url = new URL("https://query.sse.com.cn/security/stock/queryCompanyBulletin.do")
    url.searchParams.set("jsonCallBack", "jsonpCallback1")
    url.searchParams.set("isPagination", "true")
    url.searchParams.set("productId", digits)
    url.searchParams.set("keyWord", plan.key)
    url.searchParams.set("securityType", "0101,120100,020100,020200,120200")
    url.searchParams.set("reportType2", plan.reportType2)
    url.searchParams.set("reportType", "ALL")
    url.searchParams.set("beginDate", plan.from)
    url.searchParams.set("endDate", endDate)
    url.searchParams.set("pageHelp.pageSize", String(parsePositiveInteger(options.ssePageSize, 30)))
    url.searchParams.set("pageHelp.pageNo", "1")
    url.searchParams.set("pageHelp.beginPage", "1")
    url.searchParams.set("pageHelp.cacheSize", "1")
    url.searchParams.set("pageHelp.endPage", "1")
    requests.push({ key: plan.key || digits, purpose: plan.purpose, url: url.toString() })
    const text = await fetchTextWithTimeout(url, {
      timeoutMs: timeoutMs ?? options.sseTimeoutMs,
      fetchOptions: {
        headers: {
          Referer: "https://www.sse.com.cn/",
          "User-Agent": "Mozilla/5.0 trading-review-wiki-company-research",
        },
      },
    })
    const parsed = parseJsonpPayload(text)
    const rows = Array.isArray(parsed.result) ? parsed.result : []
    announcements.push(...rows.map((row) => normalizeSseAnnouncement(row, company)))
  }
  const filtered = announcements.filter((item) => !item.secCode || item.secCode === digits)
  return { status: "success", requests, announcements: dedupeAnnouncements(filtered) }
}

export async function defaultCninfoClient({ company, from, to, timeoutMs, options = {} }) {
  const searchKeys = [
    company.stockName,
    company.secName,
    company.stockCode ? digitsFromStockCode(company.stockCode) : null,
    company.stockInput,
  ].filter(Boolean)
  const uniqueSearchKeys = [...new Set(searchKeys)]
  const periodicBase = company.stockName ?? company.secName ?? company.stockInput
  const periodicFrom = companyPeriodicAnnouncementStartDate(options)
  const eventFrom = companyEventAnnouncementStartDate(options)
  const searchPlans = uniqueSearchKeys.map((key) => ({ key, from, to, purpose: "event_window" }))
  if (periodicBase) {
    for (const suffix of ["年度报告", "半年度报告", "季度报告", "投资者关系"]) {
      searchPlans.push({ key: `${periodicBase} ${suffix}`, from: periodicFrom, to, purpose: "periodic_lookback" })
    }
    for (const suffix of ["重大事项", "收购", "资产收购", "并购重组", "预案", "股权转让"]) {
      searchPlans.push({ key: `${periodicBase} ${suffix}`, from: eventFrom, to, purpose: "event_lookback" })
    }
  }
  const announcements = []
  const requests = []
  for (const plan of searchPlans) {
    const url = new URL("https://www.cninfo.com.cn/new/fulltextSearch/full")
    url.searchParams.set("searchkey", plan.key)
    if (plan.from) url.searchParams.set("sdate", plan.from)
    if (plan.to) url.searchParams.set("edate", plan.to)
    url.searchParams.set("isfulltext", "false")
    url.searchParams.set("sortName", "pubdate")
    url.searchParams.set("sortType", "desc")
    url.searchParams.set("pageNum", "1")
    requests.push({ key: plan.key, purpose: plan.purpose, url: url.toString() })
    const parsed = await fetchJsonWithTimeout(url, {
      timeoutMs,
      fetchOptions: {
        headers: {
          Referer: "https://www.cninfo.com.cn/new/index",
          "User-Agent": "Mozilla/5.0 trading-review-wiki-company-research",
        },
      },
    })
    const rawAnnouncements = Array.isArray(parsed.announcements) ? parsed.announcements : []
    announcements.push(...rawAnnouncements.map(normalizeCninfoAnnouncement))
  }
  const digits = company.stockCode ? digitsFromStockCode(company.stockCode) : null
  const filtered = digits ? announcements.filter((item) => !item.secCode || item.secCode === digits) : announcements
  return { status: "success", requests, announcements: dedupeAnnouncements(filtered) }
}

export function selectCninfoDownloads(announcements, limit) {
  const priority = new Map([
    ["annual_report", 100],
    ["semiannual_report", 90],
    ["quarterly_report", 80],
    ["event", 70],
    ["investor_relations", 60],
    ["announcement", 20],
  ])
  function downloadRelevance(item) {
    const title = String(item.title ?? "")
    let score = priority.get(item.type) ?? 0
    if (/发行股份购买资产|重大资产|资产购买|交易标的|收购|并购|重组|股权转让/.test(title)) score += 45
    if (/募集配套资金|预案|摘要/.test(title)) score += 15
    if (/投资者关系活动|调研|业绩说明会|互动易|路演/.test(title)) score += 20
    if (/异常波动/.test(title)) score -= 30
    if (/利润分配|现金分红/.test(title)) score -= 35
    if (/提前赎回|转债.*提示性公告/.test(title)) score -= 35
    if (/管理制度/.test(title)) score -= 25
    return score
  }
  function compareDownload(a, b) {
    return downloadRelevance(b) - downloadRelevance(a) || (b.announcementTime ?? 0) - (a.announcementTime ?? 0) || a.title.localeCompare(b.title)
  }
  const max = Math.max(0, limit)
  const pdfs = announcements
    .filter((item) => item.downloadUrl && String(item.adjunctType ?? "").toUpperCase() === "PDF")
    .sort(compareDownload)
  const selected = []
  const seen = new Set()
  for (const type of ["annual_report", "semiannual_report", "quarterly_report", "event", "investor_relations", "announcement"]) {
    if (selected.length >= max) break
    const match = pdfs.filter((item) => item.type === type).sort(compareDownload)[0]
    if (!match || seen.has(match.id)) continue
    selected.push(match)
    seen.add(match.id)
  }
  for (const item of pdfs) {
    if (selected.length >= max) break
    if (seen.has(item.id)) continue
    selected.push(item)
    seen.add(item.id)
  }
  return selected
}

export const COMPANY_PDF_TARGET_KEYWORDS = [
  "主营业务分行业",
  "主营业务分产品",
  "营业收入和营业成本",
  "营业收入构成",
  "占营业收入",
  "产销量",
  "销售量",
  "生产量",
  "主要控股参股公司",
  "主要子公司",
  "子公司情况",
  "重要在建工程",
  "在建工程",
  "固定资产",
  "投资情况",
  "募集资金",
  "收购",
  "评估",
  "交易标的",
  "客户",
  "供应商",
  "前五名",
  "毛利率",
  "分行业",
  "分产品",
]

export const COMPANY_PDF_EXTRACTOR_SCRIPT = String.raw`
import json
import re
import sys

pdf_path = sys.argv[1]
keywords = ${JSON.stringify(COMPANY_PDF_TARGET_KEYWORDS)}
result = {
    "status": "manual_needed",
    "tool": "python_fitz_pdfplumber",
    "pageCount": 0,
    "extractedChars": 0,
    "text": "",
    "sections": [],
    "tables": [],
    "targetPages": [],
    "issues": [],
}

def compact(text, limit=900):
    value = re.sub(r"\s+", " ", text or "").strip()
    return value[:limit]

try:
    import fitz

    doc = fitz.open(pdf_path)
    result["pageCount"] = int(doc.page_count)
    chunks = []
    hit_pages = set()
    for index, page in enumerate(doc):
        page_no = index + 1
        text = page.get_text("text") or ""
        if text:
            chunks.append(f"\n\n[Page {page_no}]\n{text}")
        hits = [key for key in keywords if key in text]
        if hits:
            hit_pages.add(page_no)
            result["sections"].append({
                "page": page_no,
                "keywords": hits[:10],
                "excerpt": compact(text),
            })
    text = "".join(chunks).strip()
    result["text"] = text
    result["extractedChars"] = len(text)
    target_pages = set()
    for page_no in hit_pages:
        for adjacent in (page_no - 1, page_no, page_no + 1):
            if 1 <= adjacent <= result["pageCount"]:
                target_pages.add(adjacent)
    result["targetPages"] = sorted(target_pages)
except Exception as exc:
    result["issues"].append(f"fitz_text_failed: {str(exc)[:240]}")

try:
    import pdfplumber

    with pdfplumber.open(pdf_path) as pdf:
        page_count = len(pdf.pages)
        if not result["pageCount"]:
            result["pageCount"] = page_count
        target_pages = set(result["targetPages"])
        if not target_pages:
            max_pages = min(page_count, 20 if result["extractedChars"] else 8)
            target_pages = set(range(1, max_pages + 1))
            result["targetPages"] = sorted(target_pages)
        for page_no in sorted(target_pages):
            if page_no < 1 or page_no > page_count:
                continue
            page = pdf.pages[page_no - 1]
            tables = page.extract_tables() or []
            for table_index, table in enumerate(tables):
                rows = []
                for row in table or []:
                    cleaned = ["" if cell is None else str(cell) for cell in row]
                    if any(cell.strip() for cell in cleaned):
                        rows.append(cleaned)
                if rows:
                    result["tables"].append({
                        "page": page_no,
                        "tableIndex": table_index,
                        "rows": rows,
                    })
except Exception as exc:
    result["issues"].append(f"pdfplumber_table_failed: {str(exc)[:240]}")

if result["extractedChars"] or result["tables"]:
    result["status"] = "success" if result["tables"] else "partial"

print(json.dumps(result, ensure_ascii=False))
`

export function defaultPdfExtractionResult() {
  return {
    status: "manual_needed",
    extractionTool: "unavailable",
    text: "",
    tables: [],
    sections: [],
    pageCount: 0,
    targetPages: [],
    issues: [],
  }
}

export function normalizePdfExtractionResult(raw) {
  const base = defaultPdfExtractionResult()
  if (!raw || typeof raw !== "object") return base
  return {
    ...base,
    status: raw.status ?? base.status,
    extractionTool: raw.tool ?? raw.extractionTool ?? base.extractionTool,
    text: typeof raw.text === "string" ? raw.text : "",
    extractedChars: Number.isFinite(Number(raw.extractedChars)) ? Number(raw.extractedChars) : (typeof raw.text === "string" ? raw.text.length : 0),
    tables: Array.isArray(raw.tables) ? raw.tables : [],
    sections: Array.isArray(raw.sections) ? raw.sections : [],
    pageCount: Number.isFinite(Number(raw.pageCount)) ? Number(raw.pageCount) : 0,
    targetPages: Array.isArray(raw.targetPages) ? raw.targetPages : [],
    issues: Array.isArray(raw.issues) ? raw.issues : [],
  }
}

export async function extractPdfDocumentIfAvailable(pdfPath) {
  try {
    const { stdout } = await execFileAsync("python3", ["-c", COMPANY_PDF_EXTRACTOR_SCRIPT, pdfPath], {
      encoding: "utf8",
      maxBuffer: 24 * 1024 * 1024,
      timeout: 60000,
    })
    return normalizePdfExtractionResult(JSON.parse(stdout))
  } catch (pythonErr) {
    try {
      const { stdout } = await execFileAsync("pdftotext", ["-layout", pdfPath, "-"], {
        encoding: "utf8",
        maxBuffer: 6 * 1024 * 1024,
        timeout: 30000,
      })
      const text = stdout.trim()
      return {
        ...defaultPdfExtractionResult(),
        status: text ? "partial" : "manual_needed",
        extractionTool: "pdftotext_layout",
        text,
        extractedChars: text.length,
        issues: text ? ["PDF text extracted by pdftotext; table recognition unavailable."] : [`pdf_extract_failed: ${safeErrorMessage(pythonErr)}`],
      }
    } catch (pdftotextErr) {
      return {
        ...defaultPdfExtractionResult(),
        issues: [`python_pdf_extract_failed: ${safeErrorMessage(pythonErr)}`, `pdftotext_failed: ${safeErrorMessage(pdftotextErr)}`],
      }
    }
  }
}

export function pdfExtractionSidecar(extraction) {
  return {
    schema: "company-pdf-extract-v1",
    status: extraction.status,
    extractionTool: extraction.extractionTool,
    pageCount: extraction.pageCount,
    extractedChars: extraction.extractedChars ?? extraction.text?.length ?? 0,
    targetPages: extraction.targetPages,
    sections: extraction.sections,
    tables: extraction.tables,
    issues: extraction.issues,
  }
}

export async function extractPdfTextIfAvailable(pdfPath) {
  try {
    const { stdout } = await execFileAsync("pdftotext", ["-layout", pdfPath, "-"], {
      encoding: "utf8",
      maxBuffer: 6 * 1024 * 1024,
      timeout: 30000,
    })
    return stdout.trim()
  } catch {
    return ""
  }
}

export async function downloadCninfoArtifacts({ projectPath, outputDir, announcements, options = {} }) {
  const files = []
  const selected = selectCninfoDownloads(announcements, parsePositiveInteger(options.cninfoDownloadLimit, 12))
  const cninfoDir = path.join(outputDir, "artifacts", "cninfo")
  await ensureDirectory(cninfoDir)
  for (const announcement of selected) {
    const date = announcement.date ? announcement.date.replace(/-/g, "") : "unknown-date"
    const fileName = `${date}-${announcement.id}-${sanitizeArtifactName(announcement.title)}.pdf`
    const pdfPath = path.join(cninfoDir, fileName)
    try {
      const buffer = options.cninfoDownloader
        ? await options.cninfoDownloader({ announcement, outputPath: pdfPath })
        : await fetchPdfBufferWithTimeout(announcement.downloadUrl, {
            timeoutMs: options.cninfoDownloadTimeoutMs,
            fetchOptions: {
              headers: {
                Referer: announcement.source === "sse_public_web" ? "https://www.sse.com.cn/" : "https://www.cninfo.com.cn/new/index",
                "User-Agent": "Mozilla/5.0 trading-review-wiki-company-research",
              },
            },
          })
      const binary = Buffer.isBuffer(buffer) ? buffer : Buffer.from(String(buffer ?? ""))
      await fs.writeFile(pdfPath, binary)
      const hash = createHash("sha256").update(binary).digest("hex")
      const extraction = await extractPdfDocumentIfAvailable(pdfPath)
      const extracted = extraction.text ?? ""
      let textPath = null
      if (extracted) {
        textPath = pdfPath.replace(/\.pdf$/i, ".txt")
        await fs.writeFile(textPath, extracted, "utf8")
      }
      const extractPath = pdfPath.replace(/\.pdf$/i, ".extract.json")
      await writeJson(extractPath, pdfExtractionSidecar(extraction))
      files.push({
        announcementId: announcement.id,
        title: announcement.title,
        type: announcement.type,
        date: announcement.date ?? null,
        status: "success",
        filePath: projectRelative(projectPath, pdfPath),
        textPath: textPath ? projectRelative(projectPath, textPath) : null,
        extractPath: projectRelative(projectPath, extractPath),
        sha256: hash,
        bytes: binary.length,
        extractedChars: extraction.extractedChars ?? extracted.length,
        pageCount: extraction.pageCount ?? 0,
        relevantPages: extraction.targetPages ?? [],
        tableCount: extraction.tables?.length ?? 0,
        extractionTool: extraction.extractionTool,
        extractionIssues: extraction.issues ?? [],
      })
    } catch (err) {
      files.push({
        announcementId: announcement.id,
        title: announcement.title,
        type: announcement.type,
        status: "failed",
        error: safeErrorMessage(err),
      })
    }
  }
  return files
}

export async function copyIfExists(sourcePath, targetPath) {
  try {
    await fs.copyFile(sourcePath, targetPath)
    return true
  } catch {
    return false
  }
}

export async function readFileBytesIfAvailable(filePath) {
  try {
    return await fs.readFile(filePath)
  } catch {
    return null
  }
}

export async function findCachedCninfoArtifacts({ projectPath, outputDir, company, options = {} }) {
  if (options.disableCninfoCacheFallback) return []
  const root = path.join(projectPath, COMPANY_RESEARCH_ROOT)
  const cninfoDir = path.join(outputDir, "artifacts", "cninfo")
  await ensureDirectory(cninfoDir)
  const nameTokens = [
    company.stockName,
    company.secName,
    company.stockInput && !/^\d+$/.test(company.stockInput) ? company.stockInput : null,
  ].filter(Boolean).map((item) => String(item).toLowerCase())
  if (nameTokens.length === 0) return []
  let reportDirs = []
  try {
    reportDirs = await fs.readdir(root, { withFileTypes: true })
  } catch {
    return []
  }
  const candidates = []
  for (const dirent of reportDirs) {
    if (!dirent.isDirectory()) continue
    const artifactsDir = path.join(root, dirent.name, "artifacts", "cninfo")
    if (path.resolve(artifactsDir) === path.resolve(cninfoDir)) continue
    let files = []
    try {
      files = await fs.readdir(artifactsDir)
    } catch {
      continue
    }
    for (const fileName of files) {
      if (!fileName.toLowerCase().endsWith(".pdf")) continue
      const lower = fileName.toLowerCase()
      if (!nameTokens.some((token) => lower.includes(token))) continue
      const pdfPath = path.join(artifactsDir, fileName)
      let stat
      try {
        stat = await fs.stat(pdfPath)
      } catch {
        continue
      }
      candidates.push({ fileName, pdfPath, artifactsDir, mtimeMs: stat.mtimeMs })
    }
  }
  const limit = parsePositiveInteger(options.cninfoDownloadLimit, 12)
  const selected = candidates.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, limit)
  const out = []
  for (const item of selected) {
    const targetPdf = path.join(cninfoDir, item.fileName)
    const copiedPdf = await copyIfExists(item.pdfPath, targetPdf)
    if (!copiedPdf) continue
    const sourceText = item.pdfPath.replace(/\.pdf$/i, ".txt")
    const targetText = targetPdf.replace(/\.pdf$/i, ".txt")
    const copiedText = await copyIfExists(sourceText, targetText)
    const sourceExtract = item.pdfPath.replace(/\.pdf$/i, ".extract.json")
    const targetExtract = targetPdf.replace(/\.pdf$/i, ".extract.json")
    const copiedExtract = await copyIfExists(sourceExtract, targetExtract)
    const binary = await readFileBytesIfAvailable(targetPdf)
    const sidecar = readJsonObjectIfAvailable(targetExtract)
    const title = item.fileName.replace(/^\d{8}-[^-]+-/, "").replace(/\.pdf$/i, "")
    const dateMatch = item.fileName.match(/^(\d{4})(\d{2})(\d{2})-/)
    out.push({
      announcementId: `cached-${shortHash(item.pdfPath)}`,
      title,
      type: inferCninfoAnnouncementType(title),
      date: dateMatch ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}` : null,
      status: "success",
      cached: true,
      filePath: projectRelative(projectPath, targetPdf),
      textPath: copiedText ? projectRelative(projectPath, targetText) : null,
      extractPath: copiedExtract ? projectRelative(projectPath, targetExtract) : null,
      sha256: binary ? createHash("sha256").update(binary).digest("hex") : null,
      bytes: binary?.length ?? null,
      extractedChars: sidecar?.extractedChars ?? 0,
      pageCount: sidecar?.pageCount ?? 0,
      relevantPages: sidecar?.targetPages ?? [],
      tableCount: sidecar?.tables?.length ?? 0,
      extractionTool: sidecar?.extractionTool ?? "cached_cninfo_artifact",
      extractionIssues: sidecar?.issues ?? [],
    })
  }
  return out
}

export async function collectTushareEvidence({ company, credentials, options = {} }) {
  const client = options.tushareClient ?? defaultTushareClient
  const tsCode = company.tsCode ?? toTushareCode(company.stockCode ?? company.stockInput)
  const startDate = companyFinancialStartDate(options)
  const endDate = dateCompact(options.financialTo ?? options["financial-to"] ?? options.to) || dateCompact(nowLocalTimestamp())
  const calls = [
    { apiName: "stock_basic", params: tsCode ? { ts_code: tsCode } : { name: company.stockInput }, fields: "ts_code,symbol,name,area,industry,market,list_date" },
    { apiName: "income", params: tsCode ? { ts_code: tsCode, start_date: startDate, end_date: endDate } : { start_date: startDate, end_date: endDate } },
    { apiName: "balancesheet", params: tsCode ? { ts_code: tsCode, start_date: startDate, end_date: endDate } : { start_date: startDate, end_date: endDate } },
    { apiName: "cashflow", params: tsCode ? { ts_code: tsCode, start_date: startDate, end_date: endDate } : { start_date: startDate, end_date: endDate } },
    { apiName: "fina_indicator", params: tsCode ? { ts_code: tsCode, start_date: startDate, end_date: endDate } : { start_date: startDate, end_date: endDate } },
    { apiName: "daily_basic", params: tsCode ? { ts_code: tsCode, start_date: startDate, end_date: endDate } : { start_date: startDate, end_date: endDate } },
    { apiName: "forecast", params: tsCode ? { ts_code: tsCode, start_date: startDate, end_date: endDate } : { start_date: startDate, end_date: endDate } },
    { apiName: "express", params: tsCode ? { ts_code: tsCode, start_date: startDate, end_date: endDate } : { start_date: startDate, end_date: endDate } },
  ]
  const tables = {}
  const callsSummary = []
  if (!credentials.tushareToken && !options.tushareClient) {
    return { status: "missing_config", calls: callsSummary, tables, error: "Tushare token is not configured" }
  }
  for (const call of calls) {
    try {
      const response = await client({
        ...call,
        token: credentials.tushareToken,
        timeoutMs: options.tushareTimeoutMs,
      })
      const normalized = normalizeTushareResponse(call.apiName, response)
      tables[call.apiName] = normalized
      callsSummary.push({
        apiName: call.apiName,
        status: normalized.status,
        rows: normalized.rows.length,
        error: normalized.error,
      })
    } catch (err) {
      tables[call.apiName] = { apiName: call.apiName, status: "failed", error: safeErrorMessage(err), fields: [], rows: [] }
      callsSummary.push({ apiName: call.apiName, status: "failed", rows: 0, error: safeErrorMessage(err) })
    }
  }
  const ok = callsSummary.some((item) => item.status === "success" && item.rows > 0)
  return { status: ok ? "success" : "partial", calls: callsSummary, tables, error: ok ? null : "No non-empty Tushare table returned" }
}

export async function defaultTavilyClient({ query, apiKey, timeoutMs }) {
  if (!apiKey) throw new Error("Tavily API key is not configured")
  return fetchJsonWithTimeout("https://api.tavily.com/search", {
    timeoutMs,
    fetchOptions: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query,
        search_depth: "advanced",
        include_answer: false,
        max_results: 5,
      }),
    },
  })
}

export function normalizeTavilyResults(query, response) {
  const results = Array.isArray(response?.results) ? response.results : []
  return results.map((item, index) => ({
    query,
    rank: index + 1,
    title: item.title ?? "",
    url: item.url ?? "",
    content: item.content ?? item.snippet ?? "",
    score: typeof item.score === "number" ? item.score : null,
    publishedDate: item.published_date ?? item.publishedDate ?? null,
  }))
}

export async function collectTavilyEvidence({ company, credentials, options = {} }) {
  const client = options.tavilyClient ?? defaultTavilyClient
  const name = company.stockName ?? company.secName ?? company.stockInput
  const industry = company.industry ?? "行业"
  const queries = [
    `${name} 技术能力 同业 对比`,
    `${name} ${industry} 供应链 海外 竞争格局`,
    `${name} 客户 验证 产能 ASP 毛利率`,
  ]
  if (!credentials.tavilyApiKey && !options.tavilyClient) {
    return { status: "missing_config", queries: queries.map((query) => ({ query, status: "skipped", results: 0 })), results: [], error: "Tavily API key is not configured" }
  }
  const summaries = []
  const results = []
  for (const query of queries) {
    try {
      const response = await client({ query, apiKey: credentials.tavilyApiKey, timeoutMs: options.tavilyTimeoutMs })
      const normalized = normalizeTavilyResults(query, response)
      results.push(...normalized)
      summaries.push({ query, status: "success", results: normalized.length })
    } catch (err) {
      summaries.push({ query, status: "failed", results: 0, error: safeErrorMessage(err) })
    }
  }
  return { status: results.length > 0 ? "success" : "partial", queries: summaries, results, error: results.length > 0 ? null : "No Tavily results returned" }
}

export function latestByDate(rows, candidates = ["end_date", "ann_date", "trade_date"]) {
  const valid = Array.isArray(rows) ? rows.filter(Boolean) : []
  if (valid.length === 0) return null
  return [...valid].sort((a, b) => {
    const av = candidates.map((key) => String(a[key] ?? "")).find(Boolean) ?? ""
    const bv = candidates.map((key) => String(b[key] ?? "")).find(Boolean) ?? ""
    return bv.localeCompare(av)
  })[0]
}

export function pickNumber(row, keys) {
  if (!row) return null
  for (const key of keys) {
    const value = numberFromSqlCell(row[key])
    if (value != null) return value
  }
  return null
}

export function scaleNumber(value, factor) {
  return value == null ? null : value * factor
}

export function buildFinancialsFromTushare(tushareEvidence) {
  const tables = tushareEvidence.tables ?? {}
  const stockBasic = latestByDate(tables.stock_basic?.rows, ["list_date"])
  const income = latestByDate(tables.income?.rows)
  const balance = latestByDate(tables.balancesheet?.rows)
  const cashflow = latestByDate(tables.cashflow?.rows)
  const indicator = latestByDate(tables.fina_indicator?.rows)
  const dailyBasic = latestByDate(tables.daily_basic?.rows, ["trade_date"])
  return {
    schema: "company-financials-v1",
    source: "tushare_cross_check",
    stockBasic,
    latestPeriod: income?.end_date ?? balance?.end_date ?? indicator?.end_date ?? null,
    latestTradeDate: dailyBasic?.trade_date ?? null,
    metrics: {
      revenue: pickNumber(income, ["revenue", "total_revenue"]),
      operatingProfit: pickNumber(income, ["operate_profit", "op_income"]),
      netProfit: pickNumber(income, ["n_income_attr_p", "net_profit", "n_income"]),
      grossMarginPct: pickNumber(indicator, ["grossprofit_margin", "gross_margin"]),
      netMarginPct: pickNumber(indicator, ["netprofit_margin", "net_margin"]),
      roePct: pickNumber(indicator, ["roe", "roe_dt"]),
      totalAssets: pickNumber(balance, ["total_assets"]),
      totalLiabilities: pickNumber(balance, ["total_liab"]),
      operatingCashflow: pickNumber(cashflow, ["n_cashflow_act", "c_fr_sale_sg"]),
      peTtm: pickNumber(dailyBasic, ["pe_ttm", "pe"]),
      pb: pickNumber(dailyBasic, ["pb"]),
      totalMarketValue: scaleNumber(pickNumber(dailyBasic, ["total_mv"]), 10000),
      floatMarketValue: scaleNumber(pickNumber(dailyBasic, ["circ_mv"]), 10000),
      close: pickNumber(dailyBasic, ["close"]),
    },
    rawLatest: {
      income,
      balance,
      cashflow,
      indicator,
      dailyBasic,
    },
    tables: Object.fromEntries(Object.entries(tables).map(([key, table]) => [key, { status: table.status, rows: table.rows?.length ?? 0, fields: table.fields ?? [], error: table.error ?? null }])),
  }
}

export function buildEvidenceLedger({ company, cninfo, downloads, tushare, tavily, wikiContext, generatedAt }) {
  const rows = []
  rows.push({
    dataItem: `${company.stockName ?? company.stockInput} CNINFO announcement search`,
    source: "cninfo",
    tool: "cninfo_public_web_adapter",
    status: cninfo.status,
    completedAt: generatedAt,
    purpose: "官方公告检索与下载候选",
    evidenceLevel: "A",
    details: { announcements: cninfo.announcements?.length ?? 0, requests: cninfo.requests?.length ?? 0, error: cninfo.error ?? null },
  })
  for (const file of downloads) {
    rows.push({
      dataItem: file.title,
      source: "cninfo",
      tool: "cninfo_pdf_download",
      status: file.status,
      completedAt: generatedAt,
      purpose: "年报/季报/重大事项/IR 原文缓存",
      evidenceLevel: "A",
      refs: [file.filePath, file.textPath].filter(Boolean),
      details: { announcementId: file.announcementId, type: file.type, bytes: file.bytes, extractedChars: file.extractedChars, error: file.error ?? null },
    })
  }
  for (const call of tushare.calls ?? []) {
    rows.push({
      dataItem: `Tushare ${call.apiName}`,
      source: "tushare",
      tool: "tushare_pro_http",
      status: call.status,
      completedAt: generatedAt,
      purpose: "财务快照/三表/估值交叉验证",
      evidenceLevel: "B",
      details: { rows: call.rows, error: call.error ?? null },
    })
  }
  for (const query of tavily.queries ?? []) {
    rows.push({
      dataItem: query.query,
      source: "tavily",
      tool: "tavily_search",
      status: query.status,
      completedAt: generatedAt,
      purpose: "同业技术能力、海外供应链、客户验证辅助证据",
      evidenceLevel: "C",
      details: { results: query.results, error: query.error ?? null },
    })
  }
  rows.push({
    dataItem: "Trading Review Wiki retrieval",
    source: "wiki",
    tool: "ask_retrieval_context",
    status: wikiContext?.retrievalWarnings?.length ? "partial" : "success",
    completedAt: generatedAt,
    purpose: "既有产业链、主题页、历史观点和图谱关联",
    evidenceLevel: "B",
    details: {
      counts: wikiContext?.counts ?? {},
      warnings: wikiContext?.retrievalWarnings ?? [],
    },
  })
  return {
    schema: "evidence-ledger-v1",
    generatedAt,
    company: {
      stockInput: company.stockInput,
      stockCode: company.stockCode,
      tsCode: company.tsCode,
      stockName: company.stockName,
      industry: company.industry,
    },
    rows,
  }
}

export function markdownTable(headers, rows) {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${headers.map((header) => String(row[header] ?? "")).join(" | ")} |`),
  ].join("\n")
}

export function formatNumberForReport(value) {
  if (value == null || !Number.isFinite(Number(value))) return "n/a"
  const n = Number(value)
  if (Math.abs(n) >= 100000000) return `${roundMetric(n / 100000000, 2)}亿`
  if (Math.abs(n) >= 10000) return `${roundMetric(n / 10000, 2)}万`
  return String(roundMetric(n, 2))
}

export function buildCompanyReportMarkdown({ company, financials, ledger, cninfo, tavily, wikiContext, generatedAt }) {
  const metrics = financials.metrics ?? {}
  const ledgerRows = ledger.rows.map((row) => ({
    数据项: row.dataItem,
    来源: row.source,
    工具: row.tool,
    状态: row.status,
    完成时间: row.completedAt,
    用途: row.purpose,
    可信等级: row.evidenceLevel,
  }))
  const topAnnouncements = (cninfo.announcements ?? []).slice(0, 12)
  const topWeb = (tavily.results ?? []).slice(0, 8)
  const wikiHits = [
    ...(wikiContext?.wikiResults ?? []).slice(0, 6).map((item) => ({ bucket: "wiki", ...item })),
    ...(wikiContext?.graphExpansions ?? []).slice(0, 6).map((item) => ({ bucket: "graph", ...item })),
  ].slice(0, 10)
  return [
    `# ${company.stockName ?? company.stockInput} 公司深度研究`,
    "",
    `- 生成时间：${generatedAt}`,
    `- 股票代码：${company.tsCode ?? company.stockCode ?? "n/a"}`,
    `- 行业：${company.industry ?? "n/a"}`,
    "",
    "## 数据可信度声明",
    "",
    "- 基础财务模型只使用 A/B 级证据：公告、年报、季报、官方披露、Tushare/交易所结构化数据和本地行情库。",
    "- Tavily/WebSearch、研报、会议纪要和群聊线索只用于技术定位、行业对比、弹性假设与风险提示，不直接进入基础估值。",
    "- 缺少原始出处的关键数字标记为 `manual_needed`，不得作为基准结论。",
    "",
    "## 数据拉取确认表",
    "",
    markdownTable(["数据项", "来源", "工具", "状态", "完成时间", "用途", "可信等级"], ledgerRows),
    "",
    "## 核心财务快照",
    "",
    markdownTable(
      ["指标", "数值", "来源等级"],
      [
        { 指标: "最新报告期", 数值: financials.latestPeriod ?? "n/a", 来源等级: "B" },
        { 指标: "营业收入", 数值: formatNumberForReport(metrics.revenue), 来源等级: "B" },
        { 指标: "归母净利润", 数值: formatNumberForReport(metrics.netProfit), 来源等级: "B" },
        { 指标: "毛利率", 数值: metrics.grossMarginPct == null ? "n/a" : `${roundMetric(metrics.grossMarginPct, 2)}%`, 来源等级: "B" },
        { 指标: "ROE", 数值: metrics.roePct == null ? "n/a" : `${roundMetric(metrics.roePct, 2)}%`, 来源等级: "B" },
        { 指标: "总市值", 数值: formatNumberForReport(metrics.totalMarketValue), 来源等级: "B" },
        { 指标: "PE TTM", 数值: metrics.peTtm == null ? "n/a" : roundMetric(metrics.peTtm, 2), 来源等级: "B" },
      ],
    ),
    "",
    "## 官方公告证据",
    "",
    topAnnouncements.length
      ? topAnnouncements.map((item) => `- [${item.date || "unknown"}] ${item.title}（${item.type}，${item.downloadUrl ?? "no pdf"}）`).join("\n")
      : "- 未检索到公告，需人工补官方文件。",
    "",
    "## 行业与技术辅助证据",
    "",
    topWeb.length
      ? topWeb.map((item) => `- ${item.title || item.query}：${item.url}`).join("\n")
      : "- Tavily/WebSearch 未返回可用结果，技术和同业定位需人工补证据。",
    "",
    "## Wiki/图谱上下文",
    "",
    wikiHits.length
      ? wikiHits.map((item) => `- ${item.bucket}: ${item.path}（score=${roundMetric(item.score, 2)}）`).join("\n")
      : "- 暂未命中既有 wiki/图谱页面。",
    "",
    "## 初步研究结论",
    "",
    "- 当前报告为自动底稿版：已完成证据台账、财务快照、公告缓存、行业资料检索和 Excel 模型生成。",
    "- 基准估值必须以 `company-model.xlsx` 的 A/B 级证据假设为准；C 级网页资料只作为情景弹性。",
    "- 需要人工复核的重点：PDF 表格抽取完整性、子公司盈亏附注、分部收入/毛利率、产能和客户验证口径。",
    "",
  ].join("\n")
}

export function buildWikiChangeCandidates({ company, wikiContext, ledger }) {
  const wikiHits = [
    ...(wikiContext?.wikiResults ?? []),
    ...(wikiContext?.graphExpansions ?? []),
  ]
  const unique = []
  const seen = new Set()
  for (const hit of wikiHits) {
    if (!hit.path || seen.has(hit.path)) continue
    seen.add(hit.path)
    unique.push(hit)
  }
  return [
    `# ${company.stockName ?? company.stockInput} wiki 写入候选`,
    "",
    "默认不自动写入正式 wiki。以下只是候选清单，后续需要单独确认。",
    "",
    "## 建议候选页",
    "",
    unique.length
      ? unique.slice(0, 12).map((hit) => `- ${hit.path}：补充 ${company.stockName ?? company.stockInput} 的官方公告证据、财务模型结论或技术定位；当前命中分 ${roundMetric(hit.score, 2)}。`).join("\n")
      : "- 暂无明确候选页，可考虑新建股票页或主题页，但需要人工确认。",
    "",
    "## 可写入信息类型",
    "",
    "- A/B 级：年报、公告、季报、Tushare/行情库交叉验证后的财务事实。",
    "- C 级：行业对比、海外供应链、技术定位，只能写入“待验证/辅助证据”。",
    "- D 级：群聊/KOL/传闻，不从本功能直接写入。",
    "",
    "## 证据状态",
    "",
    `- evidence ledger rows: ${ledger.rows.length}`,
    "",
  ].join("\n")
}

export function buildCompanyWorkbookRows({ company, financials, ledger }) {
  const metrics = financials.metrics ?? {}
  const revenue = metrics.revenue ?? 0
  const netProfit = metrics.netProfit ?? 0
  const grossMargin = metrics.grossMarginPct ?? 0
  const pe = metrics.peTtm ?? 25
  const marketValue = metrics.totalMarketValue ?? 0
  return {
    Summary: [
      ["Company Research Model", "", "", COMPANY_RESEARCH_TEMPLATE_VERSION],
      ["Company", company.stockName ?? company.stockInput],
      ["Stock", company.tsCode ?? company.stockCode ?? ""],
      ["Industry", company.industry ?? ""],
      ["Latest Period", financials.latestPeriod ?? ""],
      [],
      ["Metric", "Value", "Evidence Level"],
      ["Revenue", revenue, "B"],
      ["Net Profit", netProfit, "B"],
      ["Gross Margin %", grossMargin, "B"],
      ["Market Value", marketValue, "B"],
      ["Base Target PE", { f: "Valuation!B5", t: "n" }, "model"],
      ["Base Equity Value", { f: "Valuation!B8", t: "n" }, "model"],
    ],
    Assumptions: [
      ["Assumption", "Downside", "Base", "Upside", "Evidence Level", "Note"],
      ["Revenue Growth Y1", -0.05, 0.08, 0.18, "B", "Default until segment model is manually refined"],
      ["Revenue Growth Y2", 0, 0.1, 0.2, "B", "Default until segment model is manually refined"],
      ["Revenue Growth Y3", 0.02, 0.1, 0.22, "B", "Default until segment model is manually refined"],
      ["Net Margin", grossMargin ? grossMargin / 100 * 0.45 : 0.08, grossMargin ? grossMargin / 100 * 0.55 : 0.1, grossMargin ? grossMargin / 100 * 0.65 : 0.12, "B", "Anchored to latest gross margin"],
      ["Target PE", Math.max(10, pe * 0.65), Math.max(12, pe * 0.85), Math.max(15, pe * 1.05), "B", "Anchored to latest daily_basic pe_ttm when available"],
    ],
    Historical: [
      ["Metric", "Latest", "Period", "Source"],
      ["Revenue", revenue, financials.latestPeriod ?? "", "tushare.income"],
      ["Net Profit", netProfit, financials.latestPeriod ?? "", "tushare.income"],
      ["Gross Margin %", grossMargin, financials.latestPeriod ?? "", "tushare.fina_indicator"],
      ["ROE %", metrics.roePct ?? "", financials.latestPeriod ?? "", "tushare.fina_indicator"],
      ["Total Assets", metrics.totalAssets ?? "", financials.latestPeriod ?? "", "tushare.balancesheet"],
      ["Operating Cashflow", metrics.operatingCashflow ?? "", financials.latestPeriod ?? "", "tushare.cashflow"],
    ],
    Forecast: [
      ["Metric", "Y0", "Y1 Base", "Y2 Base", "Y3 Base"],
      ["Revenue", revenue, { f: "B2*(1+Assumptions!C2)", t: "n" }, { f: "C2*(1+Assumptions!C3)", t: "n" }, { f: "D2*(1+Assumptions!C4)", t: "n" }],
      ["Net Margin", metrics.netMarginPct ? metrics.netMarginPct / 100 : 0.1, { f: "Assumptions!C5", t: "n" }, { f: "Assumptions!C5", t: "n" }, { f: "Assumptions!C5", t: "n" }],
      ["Net Profit", netProfit, { f: "C2*C3", t: "n" }, { f: "D2*D3", t: "n" }, { f: "E2*E3", t: "n" }],
    ],
    "Segment Model": [
      ["Segment", "Revenue", "Gross Margin %", "Evidence Level", "Status"],
      ["Core business", revenue, grossMargin, "B", "placeholder_from_financials"],
      ["New business / option", "", "", "manual_needed", "requires announcement table extraction"],
      ["Capacity / ASP / volume", "", "", "manual_needed", "requires annual report note parsing"],
    ],
    Valuation: [
      ["Scenario", "Net Profit Y1", "Target PE", "Equity Value", "Note"],
      ["Downside", { f: "Forecast!C4*0.85", t: "n" }, { f: "Assumptions!B6", t: "n" }, { f: "B2*C2", t: "n" }, "A/B evidence only"],
      ["Base", { f: "Forecast!C4", t: "n" }, { f: "Assumptions!C6", t: "n" }, { f: "B3*C3", t: "n" }, "A/B evidence only"],
      ["Upside", { f: "Forecast!C4*1.2", t: "n" }, { f: "Assumptions!D6", t: "n" }, { f: "B4*C4", t: "n" }, "C evidence only affects scenario note"],
      [],
      ["Base Target PE", { f: "C3", t: "n" }],
      ["Base Net Profit", { f: "B3", t: "n" }],
      ["Base Equity Value", { f: "D3", t: "n" }],
    ],
    Sensitivity: [
      ["PE / Net Profit", "Downside NP", "Base NP", "Upside NP"],
      [{ f: "Assumptions!B6", t: "n" }, { f: "A2*Valuation!B2", t: "n" }, { f: "A2*Valuation!B3", t: "n" }, { f: "A2*Valuation!B4", t: "n" }],
      [{ f: "Assumptions!C6", t: "n" }, { f: "A3*Valuation!B2", t: "n" }, { f: "A3*Valuation!B3", t: "n" }, { f: "A3*Valuation!B4", t: "n" }],
      [{ f: "Assumptions!D6", t: "n" }, { f: "A4*Valuation!B2", t: "n" }, { f: "A4*Valuation!B3", t: "n" }, { f: "A4*Valuation!B4", t: "n" }],
    ],
    Evidence: [
      ["Data Item", "Source", "Tool", "Status", "Completed At", "Evidence Level"],
      ...ledger.rows.map((row) => [row.dataItem, row.source, row.tool, row.status, row.completedAt, row.evidenceLevel]),
    ],
  }
}

export function formatPeriod(value) {
  const raw = String(value ?? "")
  if (/^\d{8}$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
  if (/^\d{6}$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}`
  return raw || "n/a"
}

export function reportTypeLabel(row) {
  const endDate = String(row?.end_date ?? "")
  if (endDate.endsWith("1231")) return "annual"
  if (endDate.endsWith("0630")) return "semiannual"
  if (endDate.endsWith("0331") || endDate.endsWith("0930")) return "quarterly"
  return "periodic"
}

export function latestRowsByPeriod(rows, limit = 6) {
  const byPeriod = new Map()
  for (const row of rows ?? []) {
    const period = String(row?.end_date ?? row?.trade_date ?? row?.ann_date ?? "")
    if (!period) continue
    if (!byPeriod.has(period)) byPeriod.set(period, row)
  }
  return [...byPeriod.values()]
    .sort((a, b) => String(b.end_date ?? b.trade_date ?? b.ann_date ?? "").localeCompare(String(a.end_date ?? a.trade_date ?? a.ann_date ?? "")))
    .slice(0, limit)
}

export function resolveProjectArtifactPath(projectPath, maybeRelativePath) {
  if (!maybeRelativePath) return null
  return path.isAbsolute(maybeRelativePath) ? maybeRelativePath : path.join(projectPath, maybeRelativePath)
}

export function readJsonObjectIfAvailable(filePath) {
  if (!filePath) return null
  try {
    return JSON.parse(readFileSync(filePath, "utf8"))
  } catch {
    return null
  }
}

export function cleanPdfCell(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .replace(/\u3000/g, " ")
    .trim()
}

export function cleanPdfRows(rows) {
  return (rows ?? [])
    .map((row) => (row ?? []).map(cleanPdfCell))
    .filter((row) => row.some(Boolean))
}

export function pdfTableText(table) {
  return cleanPdfRows(table.rows).map((row) => row.join(" ")).join(" ")
}

export function parsePdfNumber(value) {
  const raw = cleanPdfCell(value)
    .replace(/,/g, "")
    .replace(/，/g, "")
    .replace(/%/g, "")
    .replace(/\s+/g, "")
  if (!raw || raw === "-" || raw === "—") return null
  const match = raw.match(/-?\d+(?:\.\d+)?/)
  if (!match) return null
  const parsed = Number(match[0])
  return Number.isFinite(parsed) ? parsed : null
}

export function parsePdfPercent(value) {
  const raw = cleanPdfCell(value)
  if (!raw.includes("%")) return null
  return parsePdfNumber(raw)
}

export function pdfRowNumbers(row) {
  return row.map(parsePdfNumber).filter((value) => value != null)
}

export function firstMeaningfulPdfCell(row) {
  return row.find((cell) => {
    if (!cell) return false
    if (/^\d+(?:\.\d+)?%?$/.test(cell.replace(/,/g, ""))) return false
    return /[\p{Script=Han}A-Za-z]/u.test(cell)
  }) ?? ""
}

export function isPdfHeaderLike(value) {
  return /^(项目|分行业|分产品|分地区|销售模式|公司名称|合计|小计|单位|本期|上期|报告期|行业分类)$/.test(cleanPdfCell(value))
}

export function inferCompanyPdfTableType(rawTable, sectionKeywords = []) {
  const tableOnly = pdfTableText(rawTable)
  const compactTable = tableOnly.replace(/\s+/g, "")
  const text = `${sectionKeywords.join(" ")} ${tableOnly}`
  const compactText = `${sectionKeywords.join("")}${compactTable}`
  if (/(主营业务分行业|主营业务分产品|分产品|分行业|营业收入构成|产品构成)/.test(compactTable) && /(营业收入|主营业务收入|收入)/.test(compactText) && /(营业成本|毛利率|收入占比|分产品|存储芯片|微控制器|传感器|电子封装材料|电子级薄膜材料)/.test(compactText)) return "product_revenue"
  if (/(销售量|生产量|库存量)/.test(compactText) && /(万卷|万平方米|万只|吨|平方米|万颗|亿颗|颗|片|只|块)/.test(compactText)) return "capacity"
  if (/公司名称/.test(compactTable) && /(注册资本|公司类型|主要业务)/.test(compactTable) && /(净利润|营业利润|总资产|净资产)/.test(compactTable)) return "subsidiary_profit"
  if (/(工程进度|预算数|本期增加|转入固定资产|工程累计投入|利息资本化)/.test(compactTable) && /(在建工程|工程|项目|厂房|设备|基地|基膜|年产|产线|研发|芯片|晶圆|封测)/.test(compactTable)) return "capex"
  if (/(前五名客户|前五名供应商|客户|供应商)/.test(compactTable) && /(销售额|采购额|占年度)/.test(compactTable)) return "customer_supplier"
  return "other"
}

export function normalizeProductRevenueTable(rawTable, sourceMeta) {
  const rows = cleanPdfRows(rawTable.rows)
  const text = `${sourceMeta.sectionKeywords?.join(" ") ?? ""} ${rows.map((row) => row.join(" ")).join(" ")}`
  const hasCost = /营业成本/.test(text) && /毛利率/.test(text)
  const normalized = []
  for (const row of rows) {
    const name = cleanPdfCell(row[0])
    if (!name || isPdfHeaderLike(name) || /营业收入|营业成本|毛利率|项目|合同分类|业务类型|其中|202\d年/.test(name)) continue
    const numbers = pdfRowNumbers(row)
    if (numbers.length === 0) continue
    const rowLooksCost = hasCost || (row.length >= 7 && parsePdfPercent(row[3]) != null)
    const record = {
      name,
      revenue: numbers[0] ?? null,
      status: "extracted",
      sourcePage: rawTable.page,
      evidenceLevel: "A",
    }
    if (rowLooksCost) {
      record.cost = numbers[1] ?? null
      record.grossMarginPct = numbers[2] ?? null
      record.yoyRevenuePct = numbers[3] ?? null
      record.yoyCostPct = numbers[4] ?? null
      record.yoyGrossMarginPctChange = numbers[5] ?? null
    } else {
      record.revenueSharePct = row.map(parsePdfPercent).find((value) => value != null) ?? null
      record.yoyRevenuePct = numbers.length >= 5 ? numbers[4] : null
    }
    normalized.push(record)
  }
  return normalized
}

export function normalizeCapacityTable(rawTable) {
  const rows = cleanPdfRows(rawTable.rows)
  const normalized = []
  for (const row of rows) {
    const text = row.join(" ")
    if (!/(销售量|生产量|库存量)/.test(text)) continue
    const category = row.find((cell) => /产业|材料|业务|产品/.test(cell)) ?? ""
    const item = row.find((cell) => /(销售量|生产量|库存量)/.test(cell)) ?? ""
    const unit = row.find((cell) => /^万|平方米|吨|卷|只/.test(cell)) ?? ""
    const numbers = pdfRowNumbers(row)
    if (!item || numbers.length === 0) continue
    normalized.push({
      name: [category, item, unit].filter(Boolean).join("-"),
      category,
      item,
      unit,
      currentYear: numbers[0] ?? null,
      previousYear: numbers[1] ?? null,
      yoyPct: numbers[2] ?? null,
      status: "extracted",
      sourcePage: rawTable.page,
      evidenceLevel: "A",
    })
  }
  return normalized
}

export function normalizeSubsidiaryProfitTable(rawTable) {
  const rows = cleanPdfRows(rawTable.rows)
  const normalized = []
  for (const row of rows) {
    const name = firstMeaningfulPdfCell(row)
    if (!name || isPdfHeaderLike(name) || /公司名称|主要业务|注册资本/.test(name)) continue
    const numbers = pdfRowNumbers(row)
    if (numbers.length < 4) continue
    normalized.push({
      name,
      registeredCapital: numbers[0] ?? null,
      totalAssets: numbers[1] ?? null,
      netAssets: numbers[2] ?? null,
      revenue: numbers[3] ?? null,
      operatingProfit: numbers[4] ?? null,
      netProfit: numbers[5] ?? null,
      status: "extracted",
      sourcePage: rawTable.page,
      evidenceLevel: "A",
    })
  }
  return normalized
}

export function normalizeCapexTable(rawTable) {
  const rows = cleanPdfRows(rawTable.rows)
  const normalized = []
  for (const row of rows) {
    const project = firstMeaningfulPdfCell(row)
    if (!project || isPdfHeaderLike(project) || /工程名称|项目名称|预算数|工程进度/.test(project)) continue
    const compactProject = project.replace(/\s+/g, "")
    if (!/(项目|工程|厂房|设备|基地|基膜|年产|产研|离型膜|载带|产线|研发|芯片|晶圆|封测|存储|微控制器|传感器)/.test(compactProject)) continue
    const numbers = pdfRowNumbers(row)
    if (numbers.length === 0) continue
    const budget = parsePdfNumber(row[1])
    const openingBalance = parsePdfNumber(row[2])
    const additions = parsePdfNumber(row[3])
    const transferredToFixedAssets = parsePdfNumber(row[4])
    const otherDecrease = parsePdfNumber(row[5])
    const closingBalance = parsePdfNumber(row[6])
    const cumulativeInputPct = parsePdfPercent(row[7])
    const progressPct = parsePdfPercent(row[8])
    normalized.push({
      name: project,
      project,
      budget: budget ?? numbers[0] ?? null,
      openingBalance: openingBalance ?? numbers[1] ?? null,
      additions: additions ?? numbers[2] ?? null,
      transferredToFixedAssets: transferredToFixedAssets ?? numbers[3] ?? null,
      otherDecrease,
      closingBalance: closingBalance ?? numbers[5] ?? numbers[4] ?? numbers[0] ?? null,
      amount: closingBalance ?? numbers[5] ?? numbers[4] ?? numbers[0] ?? null,
      cumulativeInputPct,
      progressPct,
      fundingSource: row[12] ?? "",
      status: "extracted",
      sourcePage: rawTable.page,
      evidenceLevel: "A",
    })
  }
  return normalized
}

export function normalizeCustomerSupplierTable(rawTable) {
  const rows = cleanPdfRows(rawTable.rows)
  const normalized = []
  for (const row of rows) {
    const name = firstMeaningfulPdfCell(row)
    const numbers = pdfRowNumbers(row)
    if (!name || isPdfHeaderLike(name) || numbers.length === 0) continue
    normalized.push({
      name,
      amount: numbers[0],
      sharePct: row.map(parsePdfPercent).find((value) => value != null) ?? null,
      status: "extracted",
      sourcePage: rawTable.page,
      evidenceLevel: "A",
    })
  }
  return normalized
}

export function normalizeCompanyPdfTables(extraction) {
  const sectionKeywordsByPage = new Map()
  for (const section of extraction?.sections ?? []) {
    sectionKeywordsByPage.set(section.page, section.keywords ?? [])
  }
  const tables = []
  for (const rawTable of extraction?.tables ?? []) {
    const sectionKeywords = sectionKeywordsByPage.get(rawTable.page) ?? []
    const type = inferCompanyPdfTableType(rawTable, sectionKeywords)
    let rows = []
    if (type === "product_revenue") rows = normalizeProductRevenueTable(rawTable, { sectionKeywords })
    if (type === "capacity") rows = normalizeCapacityTable(rawTable)
    if (type === "subsidiary_profit") rows = normalizeSubsidiaryProfitTable(rawTable)
    if (type === "capex") rows = normalizeCapexTable(rawTable)
    if (type === "customer_supplier") rows = normalizeCustomerSupplierTable(rawTable)
    if (type === "other") {
      rows = cleanPdfRows(rawTable.rows).slice(0, 8).map((row) => ({ cells: row, status: "raw_table", sourcePage: rawTable.page, evidenceLevel: "A" }))
    }
    tables.push({
      type,
      page: rawTable.page,
      tableIndex: rawTable.tableIndex,
      rows,
      rawRows: cleanPdfRows(rawTable.rows),
    })
  }
  return tables
}

export function buildDeepDocumentExtract({ projectPath, downloads, options = {} }) {
  const documents = []
  for (const file of downloads ?? []) {
    const custom = options.deepDocumentExtractor?.({ file, projectPath })
    if (custom && typeof custom === "object") {
      documents.push({
        documentId: file.announcementId,
        title: file.title,
        type: file.type,
        date: custom.date ?? file.date ?? null,
        status: custom.status ?? "success",
        filePath: file.filePath,
        textPath: custom.textPath ?? file.textPath ?? null,
        extractedChars: custom.extractedChars ?? file.extractedChars ?? 0,
        tables: Array.isArray(custom.tables) ? custom.tables : [],
        sections: Array.isArray(custom.sections) ? custom.sections : [],
        extractionTool: custom.extractionTool ?? "custom_deep_document_extractor",
        issues: custom.issues ?? [],
      })
      continue
    }
    const sidecarPath = resolveProjectArtifactPath(projectPath, file.extractPath)
    const sidecar = readJsonObjectIfAvailable(sidecarPath)
    const sidecarTables = normalizeCompanyPdfTables(sidecar)
    if (sidecar) {
      const hasUsefulTables = sidecarTables.some((table) => table.type !== "other" && (table.rows?.length ?? 0) > 0)
      const hasText = Boolean(file.textPath && (file.extractedChars ?? 0) > 0)
      documents.push({
        documentId: file.announcementId,
        title: file.title,
        type: file.type,
        date: file.date ?? null,
        status: hasUsefulTables ? "success" : (hasText ? "partial" : "manual_needed"),
        filePath: file.filePath,
        textPath: file.textPath ?? null,
        extractPath: file.extractPath ?? null,
        extractedChars: sidecar.extractedChars ?? file.extractedChars ?? 0,
        pageCount: sidecar.pageCount ?? file.pageCount ?? 0,
        relevantPages: sidecar.targetPages ?? file.relevantPages ?? [],
        tables: sidecarTables,
        sections: Array.isArray(sidecar.sections) ? sidecar.sections : [],
        extractionTool: sidecar.extractionTool ?? file.extractionTool ?? "local_pdf_extractor",
        issues: [
          ...(Array.isArray(sidecar.issues) ? sidecar.issues : []),
          ...(hasUsefulTables ? [] : ["PDF was cached, but no key annual-report table was machine-normalized."]),
        ],
      })
      continue
    }
    const hasText = Boolean(file.textPath && (file.extractedChars ?? 0) > 0)
    documents.push({
      documentId: file.announcementId,
      title: file.title,
      type: file.type,
      date: file.date ?? null,
      status: hasText ? "partial" : "manual_needed",
      filePath: file.filePath,
      textPath: file.textPath ?? null,
      extractPath: file.extractPath ?? null,
      extractedChars: file.extractedChars ?? 0,
      pageCount: file.pageCount ?? 0,
      relevantPages: file.relevantPages ?? [],
      tables: [],
      sections: [],
      extractionTool: hasText ? "pdftotext_layout" : "fallback_metadata_only",
      issues: hasText
        ? ["PDF text was extracted, but table recognition is not yet verified."]
        : ["PDF table/text extraction unavailable; keep official PDF cached and require manual table review."],
    })
  }
  return {
    schema: "company-document-extract-v1",
    generatedAt: nowLocalTimestamp(),
    providerPolicy: {
      dataAnalytics: "Use Data Analytics/table normalization when available; local fallback preserves manual_needed instead of guessing.",
      publicEquityInvesting: "Use buy-side report framing while keeping evidence levels explicit.",
    },
    documents,
    summary: {
      documents: documents.length,
      success: documents.filter((doc) => doc.status === "success").length,
      partial: documents.filter((doc) => doc.status === "partial").length,
      manualNeeded: documents.filter((doc) => doc.status === "manual_needed").length,
      tables: documents.reduce((sum, doc) => sum + (doc.tables?.length ?? 0), 0),
      keyTables: documents.reduce((sum, doc) => sum + (doc.tables ?? []).filter((table) => table.type !== "other").length, 0),
      keyRows: documents.reduce((sum, doc) => sum + (doc.tables ?? []).filter((table) => table.type !== "other").reduce((rowSum, table) => rowSum + (table.rows?.length ?? 0), 0), 0),
    },
  }
}

export function extractRowsFromDocumentTables(documentExtract, tableType) {
  const rows = []
  for (const doc of documentExtract.documents ?? []) {
    for (const table of doc.tables ?? []) {
      if (table.type !== tableType) continue
      for (const row of table.rows ?? []) {
        rows.push({
          ...row,
          sourceDocumentId: doc.documentId,
          sourceTitle: doc.title,
          sourceType: doc.type,
          sourceDate: doc.date ?? null,
          sourcePage: table.page ?? row.page ?? null,
          evidenceLevel: "A",
          status: row.status ?? "extracted",
        })
      }
    }
  }
  return rows
}

export function preferAnnualRows(rows) {
  const annual = (rows ?? []).filter((row) => row.sourceType === "annual_report")
  if (annual.length === 0) return rows ?? []
  const dates = annual.map((row) => String(row.sourceDate ?? "")).filter(Boolean).sort()
  const latest = dates[dates.length - 1]
  return latest ? annual.filter((row) => String(row.sourceDate ?? "") === latest) : annual
}

export function mergeRowsByName(rows) {
  const byName = new Map()
  for (const row of rows ?? []) {
    const displayName = cleanPdfCell(row.name ?? row.product ?? row.segment ?? "")
    const key = canonicalCompanyRowName(displayName)
    if (!key) continue
    const existing = byName.get(key) ?? { name: displayName }
    const merged = { ...existing }
    for (const [field, value] of Object.entries(row)) {
      if (value == null || value === "") continue
      if (field === "sourcePage") {
        const pages = new Set([...(Array.isArray(existing.sourcePages) ? existing.sourcePages : []), existing.sourcePage, value].filter(Boolean))
        merged.sourcePages = [...pages].sort((a, b) => Number(a) - Number(b))
        merged.sourcePage = merged.sourcePages[0] ?? value
        continue
      }
      if (["cost", "grossMarginPct", "yoyCostPct", "yoyGrossMarginPctChange"].includes(field) && value != null) {
        const incomingPage = Number(row.sourcePage ?? 0)
        const existingPage = Number(existing.sourcePage ?? 0)
        if (merged[field] == null || incomingPage >= existingPage) merged[field] = value
        continue
      }
      if (merged[field] == null || merged[field] === "") merged[field] = value
    }
    byName.set(key, merged)
  }
  return [...byName.values()]
}

export function canonicalCompanyRowName(value) {
  return cleanPdfCell(value)
    .replace(/\s+/g, "")
    .replace(/行业$/, "产业")
}

export function selectPrimaryCapexRows(rows) {
  return (rows ?? []).filter((row) => {
    const name = canonicalCompanyRowName(row.name ?? row.project ?? "")
    if (!name) return false
    if (/(机器设备|转入在建工程|设备改造|固定资产改造)/.test(name)) return false
    if (row.progressPct == null && row.cumulativeInputPct == null) return false
    if (row.budget != null && Math.abs(Number(row.budget)) < 1000000) return false
    return /(项目|工程|厂房|设备安装|基地|基膜|年产|离型膜|载带|产线|研发|芯片|晶圆|封测|存储|微控制器|传感器)/.test(name)
  })
}

export function unitScaleFromChineseUnit(unit) {
  const text = cleanPdfCell(unit)
  if (text.includes("万")) return 10000
  return 1
}

export function attachAspInferences(productLines, capacityRows) {
  const salesRows = (capacityRows ?? []).filter((row) => /销售量/.test(row.item ?? row.name ?? "") && row.currentYear != null)
  return (productLines ?? []).map((row) => {
    if (row.revenue == null) return row
    let matched = null
    const name = row.name ?? ""
    if (/薄膜|离型膜/.test(name)) matched = salesRows.find((item) => /平方米/.test(item.unit ?? item.name ?? ""))
    if (!matched && /封装|载带|胶带/.test(name)) matched = salesRows.find((item) => /卷/.test(item.unit ?? item.name ?? ""))
    if (!matched && /存储|芯片|MCU|微控制器|传感器|Flash|DRAM|NOR|NAND/i.test(name)) matched = salesRows.find((item) => /颗|片|只|块/.test(item.unit ?? item.name ?? ""))
    if (!matched) return row
    const denominator = Number(matched.currentYear) * unitScaleFromChineseUnit(matched.unit)
    if (!Number.isFinite(denominator) || denominator <= 0) return row
    return {
      ...row,
      volume: `${matched.currentYear}${matched.unit ?? ""}`,
      asp: roundMetric(Number(row.revenue) / denominator, 4),
      aspUnit: /平方米/.test(matched.unit ?? "") ? "元/平方米" : (/卷/.test(matched.unit ?? "") ? "元/卷" : "元/单位"),
      aspStatus: "requires_review",
      aspSourcePage: matched.sourcePage,
      aspNote: "ASP uses product revenue divided by annual-report sales volume. Because PDF tables may not explicitly map every product row to each volume unit, keep this as review-required.",
    }
  })
}

export function manualNeededRow(name, reason, sourceTitle = null) {
  return {
    name,
    status: "manual_needed",
    evidenceLevel: "A",
    sourceTitle,
    reason,
  }
}

export const CORPORATE_ACTION_PATTERN = /收购|并购|重组|重大|预案|交易标的|股权转让|增资|投资协议|资产购买|发行股份|定增|可转债|回购|异常波动|埃福思/

export function isCorporateActionDocument(doc) {
  const text = `${doc?.title ?? ""} ${doc?.type ?? ""}`
  if (/利润分配|现金分红|提前赎回|转债.*提示性公告|异常波动|管理制度/.test(text)) return false
  return doc?.type === "event" || CORPORATE_ACTION_PATTERN.test(text)
}

export function corporateActionExcerpt(doc) {
  const sections = (doc?.sections ?? [])
    .filter((section) => CORPORATE_ACTION_PATTERN.test(`${section.keywords?.join(" ") ?? ""} ${section.excerpt ?? ""}`))
    .slice(0, 2)
  const picked = sections.length ? sections : (doc?.sections ?? []).slice(0, 1)
  return picked.map((section) => excerptForPrompt(section.excerpt ?? "", 180)).filter(Boolean).join(" / ")
}

export function compactCorporateTerm(value, limit = 220) {
  const text = String(value ?? "")
    .replace(/\[Page\s*\d+\]/gi, "")
    .replace(/浙江洁美电子科技股份有限公司发行股份购买资产并募集配套资金预案\d*/g, "")
    .replace(/\s+/g, "")
    .replace(/[□√]+/g, "")
    .trim()
  return text ? excerptForPrompt(text, limit) : ""
}

export function firstCompactMatch(text, regex, limit = 220) {
  const match = String(text ?? "").replace(/\s+/g, "").match(regex)
  return match ? compactCorporateTerm(match[1], limit) : ""
}

export function extractCorporateActionTerms(text) {
  const compact = String(text ?? "").replace(/\s+/g, "")
  if (!compact || !CORPORATE_ACTION_PATTERN.test(compact)) return {}
  const acquiredTarget =
    firstCompactMatch(compact, /收购([^，。；;]{2,100}?(?:股份有限公司|有限公司))(?:全体股东|控股权|70%)/, 140) ||
    firstCompactMatch(compact, /标的公司[”"]?）?([^，。；;]{2,80}?(?:股份有限公司|有限公司))/, 120)
  const acquiredEquity =
    firstCompactMatch(compact, /(?:标的股权为|合计持有(?:的)?)([^，。；;]{1,80}?70%[的]?(?:股份|股权))/, 120) ||
    firstCompactMatch(compact, /(70%[的]?(?:股份|股权))/, 80)
  const targetName =
    firstCompactMatch(compact, /交易标的名称([^，。；;]{2,80}?(?:100%股权|股权|资产|公司))/, 120) ||
    firstCompactMatch(compact, /(?:标的资产、标的股份|名称)([^，。；;]{2,80}?(?:100%股权|股权|资产|公司))/, 120) ||
    [acquiredTarget, acquiredEquity].filter(Boolean).join(" ")
  const performanceCommitment =
    firstCompactMatch(compact, /本次交易有无业绩承诺□有□无（(.{20,260}?具体安排)）/, 260) ||
    firstCompactMatch(compact, /本次交易有无业绩承诺(.{20,260}?)(?:浙江洁美|本次交易对上市公司|管理办法|交易性质)/, 260) ||
    firstCompactMatch(compact, /(业绩承诺方.{20,260}?盈利补偿协议)/, 260)
  const terms = {
    transactionForm: firstCompactMatch(compact, /交易形式([^，。；;]{4,80}?)(?:交易方案简介|上市公司拟)/) ||
      firstCompactMatch(compact, /(以现金方式收购[^，。；;]{4,120}?)(?:。|；|本次交易|根据)/, 160),
    transactionOverview: firstCompactMatch(compact, /交易方案简介(.{20,260}?)(?:交易价格|交[易]?标[的]?名称)/, 260),
    targetName,
    targetBusiness: firstCompactMatch(compact, /主营业务(.{4,120}?)(?:所属行业|其他|符合板块定位)/, 160),
    targetIndustry: firstCompactMatch(compact, /所属行业(.{4,120}?)(?:其他|符合板块定位|属于上市公司)/, 160),
    counterparties: firstCompactMatch(compact, /向(.{2,100}?交易对方)购买/, 160) ||
      firstCompactMatch(compact, /本次交易的交易对方(?:\/转让方)?为(.{4,180}?)(?:本次交易标的|其他交易对方|。)/, 180),
    priceStatus: firstCompactMatch(compact, /交易价格(?:（不含募集配套资金金额）)?(.{20,260}?)(?:交易标的|交[易]?标[的]?名称|名称)/, 260) ||
      firstCompactMatch(compact, /交易价格确定为([^。；;]{4,100}?万元)/, 140) ||
      firstCompactMatch(compact, /本次(?:苏州赛芯)?70%股权的交易价格确定为([^。；;]{4,100}?万元)/, 140),
    performanceCommitment,
    auditValuationStatus: firstCompactMatch(compact, /(审计、评估工作尚未完成.{20,220}?披露)/, 260) ||
      firstCompactMatch(compact, /((?:评估值|评估值为|股东全部权益的评估值为)[^。；;]{4,120}?万元)/, 160),
  }
  return Object.fromEntries(Object.entries(terms).filter(([, value]) => Boolean(value)))
}

export function readDocumentTextForTerms(projectPath, doc) {
  const textPath = resolveProjectArtifactPath(projectPath, doc?.textPath)
  if (!textPath) return ""
  try {
    return readFileSync(textPath, "utf8")
  } catch {
    return ""
  }
}

export function buildCorporateActionFindings({ projectPath, documentExtract, evidencePack }) {
  const downloadedDocIds = new Set((documentExtract.documents ?? []).map((doc) => String(doc.documentId ?? "")))
  const downloadedTitles = new Set((documentExtract.documents ?? []).map((doc) => String(doc.title ?? "")))
  const rows = []
  for (const doc of documentExtract.documents ?? []) {
    if (!isCorporateActionDocument(doc)) continue
    const terms = extractCorporateActionTerms(readDocumentTextForTerms(projectPath, doc))
    rows.push({
      title: doc.title,
      date: doc.date ?? null,
      type: doc.type ?? "event",
      status: doc.status ?? "partial",
      evidenceLevel: "A",
      source: "cninfo_pdf",
      filePath: doc.filePath ?? null,
      pages: doc.relevantPages?.slice(0, 8).join(",") ?? "",
      terms,
      summary: corporateActionExcerpt(doc) || "官方重大事项 PDF 已缓存；需要打开原文复核交易条款和会计影响。",
    })
  }
  for (const item of evidencePack?.cninfo?.announcements ?? []) {
    if (!isCorporateActionDocument(item)) continue
    if (downloadedDocIds.has(String(item.id ?? "")) || downloadedTitles.has(String(item.title ?? ""))) continue
    rows.push({
      title: item.title,
      date: item.date ?? null,
      type: item.type ?? "event",
      status: "announcement_only",
      evidenceLevel: "A",
      source: "cninfo_announcement_search",
      filePath: item.downloadUrl ?? null,
      pages: "",
      terms: {},
      summary: "CNINFO 检索到官方重大事项公告，但本次下载上限未覆盖 PDF；可提高 --cninfo-download-limit 后复核原文表格。",
    })
  }
  const officialRows = rows.slice(0, 8)
  if (officialRows.length) return officialRows
  const webRows = (evidencePack?.tavily?.results ?? [])
    .filter((item) => CORPORATE_ACTION_PATTERN.test(`${item.title ?? ""} ${item.content ?? ""} ${item.url ?? ""}`))
    .slice(0, 5)
    .map((item) => ({
      title: item.title ?? item.query ?? "外部重大事项线索",
      date: item.publishedDate ?? null,
      type: "external_event_clue",
      status: "external_only",
      evidenceLevel: "C",
      source: "tavily_web",
      filePath: item.url ?? null,
      pages: "",
      terms: {},
      summary: excerptForPrompt(item.content ?? "", 220) || "外部资料线索，不能作为基础事实。",
    }))
  if (webRows.length) return webRows
  return [{
    title: "重大事项/收购期权",
    date: null,
    type: "event",
    status: "manual_needed",
    evidenceLevel: "A",
    source: "cninfo_pdf",
    filePath: null,
    pages: "",
    terms: {},
    summary: "未抽到官方重大事项 PDF；若研究假设包含收购、重组或期权价值，需要补官方公告原文后再进入模型。",
  }]
}

export function buildDeepBusinessBreakdown({ projectPath, company, financials, evidencePack, documentExtract }) {
  const tables = evidencePack?.tushare?.tables ?? {}
  const incomeRows = latestRowsByPeriod(tables.income?.rows, 8).map((row) => ({
    period: row.end_date,
    periodLabel: formatPeriod(row.end_date),
    reportType: reportTypeLabel(row),
    revenue: pickNumber(row, ["revenue", "total_revenue"]),
    netProfit: pickNumber(row, ["n_income_attr_p", "net_profit", "n_income"]),
    operatingProfit: pickNumber(row, ["operate_profit", "op_income"]),
    rdExpense: pickNumber(row, ["rd_exp"]),
    evidenceLevel: "B",
    source: "tushare.income",
  }))
  const balanceRows = latestRowsByPeriod(tables.balancesheet?.rows, 8).map((row) => ({
    period: row.end_date,
    periodLabel: formatPeriod(row.end_date),
    totalAssets: pickNumber(row, ["total_assets"]),
    totalLiabilities: pickNumber(row, ["total_liab"]),
    fixedAssets: pickNumber(row, ["fix_assets"]),
    constructionInProgress: pickNumber(row, ["cip"]),
    inventories: pickNumber(row, ["inventories"]),
    accountsReceivable: pickNumber(row, ["accounts_receiv"]),
    totalShare: pickNumber(row, ["total_share"]),
    evidenceLevel: "B",
    source: "tushare.balancesheet",
  }))
  const cashflowRows = latestRowsByPeriod(tables.cashflow?.rows, 8).map((row) => ({
    period: row.end_date,
    periodLabel: formatPeriod(row.end_date),
    operatingCashflow: pickNumber(row, ["n_cashflow_act", "net_cash_flows_oper_act", "n_cashflow_act"]),
    capexCashOutflow: pickNumber(row, ["c_pay_acq_const_fiolta", "c_paid_for_assets", "c_cash_paid_for_assets"]),
    freeCashflow: pickNumber(row, ["free_cashflow", "fcff"]),
    evidenceLevel: "B",
    source: "tushare.cashflow",
  }))
  const indicatorRows = latestRowsByPeriod(tables.fina_indicator?.rows, 8).map((row) => ({
    period: row.end_date,
    periodLabel: formatPeriod(row.end_date),
    grossMarginPct: pickNumber(row, ["grossprofit_margin", "gross_margin"]),
    netMarginPct: pickNumber(row, ["netprofit_margin", "net_margin"]),
    roePct: pickNumber(row, ["roe", "roe_dt"]),
    debtToAssetsPct: pickNumber(row, ["debt_to_assets"]),
    evidenceLevel: "B",
    source: "tushare.fina_indicator",
  }))
  const capacity = preferAnnualRows(extractRowsFromDocumentTables(documentExtract, "capacity"))
  const productLines = attachAspInferences(mergeRowsByName(preferAnnualRows(extractRowsFromDocumentTables(documentExtract, "product_revenue"))), capacity)
  const subsidiaryProfit = extractRowsFromDocumentTables(documentExtract, "subsidiary_profit")
  const capex = selectPrimaryCapexRows(preferAnnualRows(extractRowsFromDocumentTables(documentExtract, "capex")))
  const corporateActions = buildCorporateActionFindings({ projectPath, documentExtract, evidencePack })
  const latestIncome = incomeRows[0] ?? {}
  const latestBalance = balanceRows[0] ?? {}
  const latestIndicator = indicatorRows[0] ?? {}
  const webEvidence = (evidencePack?.tavily?.results ?? []).slice(0, 10).map((item) => ({
    title: item.title,
    url: item.url,
    query: item.query,
    content: excerptForPrompt(item.content ?? "", 220),
    evidenceLevel: "C",
    status: item.url ? "available" : "partial",
  }))
  return {
    schema: "company-business-breakdown-v1",
    generatedAt: nowLocalTimestamp(),
    company,
    productLines: productLines.length > 0
      ? productLines
      : [
          manualNeededRow("产品收入/毛利率拆分", "Annual report product revenue table was not machine-extracted.", documentExtract.documents?.find((doc) => doc.type === "annual_report")?.title),
          manualNeededRow("销量/ASP 拆分", "Volume and ASP table requires annual-report note/table extraction.", documentExtract.documents?.find((doc) => doc.type === "annual_report")?.title),
        ],
    subsidiaryProfit: subsidiaryProfit.length > 0
      ? subsidiaryProfit
      : [manualNeededRow("子公司盈亏核实", "Subsidiary P&L table requires annual-report note extraction.", documentExtract.documents?.find((doc) => doc.type === "annual_report")?.title)],
    capacity: capacity.length > 0
      ? capacity
      : [manualNeededRow("产能/客户验证/ASP", "Capacity, utilization, validation and ASP fields require announcement table/text extraction.", documentExtract.documents?.find((doc) => doc.type === "annual_report")?.title)],
    capex: capex.length > 0
      ? capex
      : [
          {
            name: "在建工程",
            period: latestBalance.period ?? null,
            amount: latestBalance.constructionInProgress ?? null,
            evidenceLevel: "B",
            source: "tushare.balancesheet",
            status: latestBalance.constructionInProgress == null ? "manual_needed" : "cross_check",
            reason: latestBalance.constructionInProgress == null ? "CIP field unavailable from structured financials." : "Structured financial cross-check; annual-report project detail still needs PDF table extraction.",
          },
        ],
    historicalFinancials: {
      income: incomeRows,
      balance: balanceRows,
      cashflow: cashflowRows,
      indicators: indicatorRows,
    },
    keyMetrics: {
      latestPeriod: financials.latestPeriod,
      revenue: latestIncome.revenue ?? financials.metrics?.revenue ?? null,
      netProfit: latestIncome.netProfit ?? financials.metrics?.netProfit ?? null,
      grossMarginPct: latestIndicator.grossMarginPct ?? financials.metrics?.grossMarginPct ?? null,
      netMarginPct: latestIndicator.netMarginPct ?? financials.metrics?.netMarginPct ?? null,
      constructionInProgress: latestBalance.constructionInProgress ?? null,
      fixedAssets: latestBalance.fixedAssets ?? null,
      totalMarketValue: financials.metrics?.totalMarketValue ?? null,
      peTtm: financials.metrics?.peTtm ?? null,
      pb: financials.metrics?.pb ?? null,
      close: financials.metrics?.close ?? null,
    },
    technicalAndIndustryEvidence: webEvidence,
    corporateActions,
    validationStatus: {
      productLineCompleteness: productLines.length > 0 ? "official_table_extracted" : "manual_needed",
      subsidiaryCompleteness: subsidiaryProfit.length > 0 ? "official_table_extracted" : "manual_needed",
      capexCompleteness: capex.length > 0 ? "official_table_extracted" : (latestBalance.constructionInProgress == null ? "manual_needed" : "cross_check"),
      corporateActionCompleteness: corporateActions.some((row) => row.evidenceLevel === "A" && row.status !== "manual_needed") ? "official_evidence_available" : "manual_needed",
      noInventedFigures: true,
    },
  }
}

export function tableRowsFromObjects(headers, rows) {
  return rows.map((row) => Object.fromEntries(headers.map((header) => [header, row[header] ?? ""])))
}

export function formatPercentForReport(value, digits = 2) {
  return value == null ? "n/a" : `${roundMetric(Number(value), digits)}%`
}

export function numberToYi(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n / 100000000 : null
}

export function formatYi(value, digits = 2) {
  const yi = numberToYi(value)
  return yi == null ? "n/a" : `${roundMetric(yi, digits)}亿`
}

export function findBusinessRow(rows, patterns) {
  const list = Array.isArray(patterns) ? patterns : [patterns]
  return (rows ?? []).find((row) => list.some((pattern) => pattern.test(String(row.name ?? row.product ?? row.segment ?? "")))) ?? null
}

export function companyResearchProfile(company = {}) {
  const text = [
    company.stockName,
    company.secName,
    company.stockInput,
    company.stockCode,
    company.tsCode,
    company.industry,
  ].filter(Boolean).join(" ")
  if (/洁美|002859/.test(text)) {
    return {
      kind: "jiemei",
      productPatterns: [/电子封装/, /电子级薄膜/, /^其他$/],
      coreProductPatterns: [/电子级薄膜/, /离型膜/, /薄膜/],
      baseProductPatterns: [/电子封装/, /载带/],
      focusSubsidiaryPatterns: [/广东洁美/, /天津洁美/],
      coreProductName: "电子级薄膜材料",
      coreShortName: "薄膜材料",
      baseProductName: "载带业务",
      baseSectionTitle: "## 五、载带业务（稳定现金牛）",
      baseSectionMissing: "- 未从公告表格中稳定抽出载带/电子封装材料数据，需人工复核。",
      aspSectionTitle: "### 1.2 ASP 独立推算",
      scenarioVolumeHeader: "2026E薄膜量",
      scenarioAspHeader: "2026E薄膜ASP",
      scenarioVolumeUnit: "亿平",
      scenarioAspUnit: "元/平",
      scenarioWorkbookVolume2026: "Film Volume 2026E",
      scenarioWorkbookAsp2026: "Film ASP 2026E",
      scenarioWorkbookVolume2027: "Film Volume 2027E",
      scenarioWorkbookAsp2027: "Film ASP 2027E",
      coreVariableText: "核心变量是薄膜材料销量、混合 ASP、毛利率改善速度和载带业务稳定性。",
      currentPositionText: "当前价格大致贴近基准情景，关键在于离型膜量价兑现。",
      coreMissingText: "高弹性业务线未能从公告表格中稳定拆出，需要人工复核。",
      aspNote: "该 ASP 是产品线收入除以销量的混合结果，可能同时包含 MLCC 离型膜、偏光片离型膜、流延膜等，不能直接等同于单一高端 MLCC 产品价格。",
      techNotes: [
        "- 自动报告只把技术能力作为 C 级或待验证判断，除非来自公告、投资者关系记录或公司官网的明确表述。",
        "- 若外部资料提到高端 MLCC、日韩客户、极薄离型膜或高 ASP 产品，默认进入乐观情景和验证清单，不进入基准估值。",
        "- 后续增强可以把官方 IR Q&A PDF/网页作为 A/B 证据抽取，单独更新技术路线表。",
      ],
      scenarioThesis: {
        pessimistic: "离型膜量价改善慢，载带稳定增长但估值难继续扩张。",
        base: "离型膜完成爬坡并改善结构，载带继续提供现金流基础。",
        optimistic: "高端客户和高 ASP 产品放量，离型膜从利润拖累变成主要弹性。",
      },
      valuationSensitivityText: "估值对薄膜兑现速度高度敏感。",
      scenarioInterpretationText: "悲观情景代表量价兑现慢；基准情景代表产能爬坡和结构升级按公告可验证路径推进；乐观情景需要高端客户或高 ASP 产品得到独立验证。",
      sensitivityNote: "基准情景若目标价低于现价，说明市场已提前定价一部分薄膜弹性；乐观情景需要官方客户、ASP 或收购并表证据兑现。",
      subsidiaryLossText: (value) => value
        ? `广东/天津等薄膜相关子公司营业利润合计 ${formatNumberForReport(value)}，提示薄膜业务仍处于爬坡修复阶段。`
        : "薄膜相关子公司亏损未能完整量化，需要继续复核子公司表。",
      baseSectionText: (baseProduct) => baseProduct
        ? [
            `- 年报确认：${baseProduct.name}收入 ${formatNumberForReport(baseProduct.revenue)}，毛利率 ${formatPercentForReport(baseProduct.grossMarginPct)}，收入占比 ${formatPercentForReport(baseProduct.revenueSharePct)}。`,
            `- 量价口径：销量 ${baseProduct.volume ?? "n/a"}，混合 ASP ${baseProduct.asp == null ? "n/a" : `${baseProduct.asp}${baseProduct.aspUnit ? ` ${baseProduct.aspUnit}` : ""}`}。`,
            "- 投资含义：载带业务给出现金流和估值底座，薄膜/高端材料决定估值弹性；若薄膜验证失败，应回到载带现金牛定价。",
          ].join("\n")
        : null,
    }
  }
  if (/半导体|兆易|603986|存储|DRAM|NOR|NAND|Flash|MCU|微控制器|传感器/.test(text)) {
    return {
      kind: "semiconductor_memory",
      productPatterns: [/存储/, /DRAM/i, /NOR/i, /NAND/i, /Flash/i, /MCU/i, /微控制器/, /传感器/, /芯片/, /集成电路/],
      coreProductPatterns: [/存储/, /DRAM/i, /NOR/i, /NAND/i, /Flash/i],
      baseProductPatterns: [/MCU/i, /微控制器/, /传感器/, /模拟产品/],
      focusSubsidiaryPatterns: [/兆易/, /合肥/, /芯技佳易/, /思立微/],
      coreProductName: "存储产品/高弹性业务",
      coreShortName: "存储产品",
      baseProductName: "MCU/传感器等现金流底座",
      baseSectionTitle: "## 五、核心业务与现金流底座",
      baseSectionMissing: "- 未从公告表格中稳定抽出 MCU/传感器等成熟产品线数据，需人工复核。",
      aspSectionTitle: "### 1.2 价格/毛利率线索",
      scenarioVolumeHeader: "2026E核心产品量",
      scenarioAspHeader: "2026E价格/毛利率",
      scenarioVolumeUnit: "",
      scenarioAspUnit: "",
      scenarioWorkbookVolume2026: "Core Product Volume 2026E",
      scenarioWorkbookAsp2026: "Core Product Price/Margin 2026E",
      scenarioWorkbookVolume2027: "Core Product Volume 2027E",
      scenarioWorkbookAsp2027: "Core Product Price/Margin 2027E",
      coreVariableText: "核心变量是存储价格周期、产品结构、毛利率修复、库存去化和 MCU/传感器业务韧性。",
      currentPositionText: "当前价格大致贴近基准情景，关键在于存储价格周期和毛利率修复能否兑现。",
      coreMissingText: "存储/MCU/传感器等核心产品线未能从公告表格中稳定拆出，需要人工复核。",
      aspNote: "若公告只披露分产品收入/毛利率而不披露销量，价格弹性只能作为毛利率和产品结构线索，不能强行反推单颗芯片 ASP。",
      techNotes: [
        "- 自动报告只把技术路线、客户和供应链资料作为 C 级或待验证判断，除非来自公告、投资者关系记录或公司官网的明确表述。",
        "- 若外部资料提到 DRAM/NOR Flash/MCU 价格周期、国产替代或客户导入，默认进入乐观情景和验证清单，不进入基准估值。",
        "- 后续增强可以把官方 IR Q&A PDF/网页作为 A/B 证据抽取，单独更新产品线和库存周期验证表。",
      ],
      scenarioThesis: {
        pessimistic: "存储价格修复慢，库存和费用拖累毛利率，MCU/传感器只提供估值底座。",
        base: "存储价格和产品结构温和修复，MCU/传感器维持现金流韧性。",
        optimistic: "存储周期上行叠加新品/客户导入，毛利率和收入弹性同步释放。",
      },
      valuationSensitivityText: "估值对存储价格周期、毛利率修复和库存去化速度高度敏感。",
      scenarioInterpretationText: "悲观情景代表存储周期兑现慢；基准情景代表价格和毛利率按公告可验证路径修复；乐观情景需要客户导入、新品放量或价格周期得到独立验证。",
      sensitivityNote: "基准情景若目标价低于现价，说明市场已提前定价一部分周期修复；乐观情景需要官方客户、产品结构或毛利率证据兑现。",
      subsidiaryLossText: (value) => value
        ? `重点子公司营业利润合计 ${formatNumberForReport(value)}，提示业务结构和研发投入仍需拆分复核。`
        : "重点子公司盈亏未能完整量化，需要继续复核年报子公司表。",
      baseSectionText: (baseProduct) => baseProduct
        ? [
            `- 年报确认：${baseProduct.name}收入 ${formatNumberForReport(baseProduct.revenue)}，毛利率 ${formatPercentForReport(baseProduct.grossMarginPct)}，收入占比 ${formatPercentForReport(baseProduct.revenueSharePct)}。`,
            "- 投资含义：成熟产品线决定估值底座，存储价格周期和新品导入决定估值弹性；若周期验证失败，应回到现金流底座定价。",
          ].join("\n")
        : null,
    }
  }
  return {
    kind: "generic",
    productPatterns: [],
    coreProductPatterns: [],
    baseProductPatterns: [],
    focusSubsidiaryPatterns: [],
    coreProductName: "高弹性业务线",
    coreShortName: "高弹性业务",
    baseProductName: "成熟业务底座",
    baseSectionTitle: "## 五、核心业务与现金流底座",
    baseSectionMissing: "- 未从公告表格中稳定抽出成熟业务底座，需人工复核。",
    aspSectionTitle: "### 1.2 价格/毛利率线索",
    scenarioVolumeHeader: "2026E核心业务量",
    scenarioAspHeader: "2026E价格/毛利率",
    scenarioVolumeUnit: "",
    scenarioAspUnit: "",
    scenarioWorkbookVolume2026: "Core Business Volume 2026E",
    scenarioWorkbookAsp2026: "Core Business Price/Margin 2026E",
    scenarioWorkbookVolume2027: "Core Business Volume 2027E",
    scenarioWorkbookAsp2027: "Core Business Price/Margin 2027E",
    coreVariableText: "核心变量是收入增长、产品结构、毛利率修复、现金流和估值消化速度。",
    currentPositionText: "当前价格大致贴近基准情景，关键在于核心业务增长和毛利率验证。",
    coreMissingText: "核心业务线未能从公告表格中稳定拆出，需要人工复核。",
    aspNote: "若公告未披露销量，价格弹性只能作为毛利率和产品结构线索，不能强行反推单品 ASP。",
    techNotes: [
      "- 自动报告只把行业和同业资料作为 C 级或待验证判断，除非来自公告、投资者关系记录或公司官网的明确表述。",
      "- 外部资料默认进入乐观情景和验证清单，不进入基准估值。",
      "- 后续增强可以把官方 IR Q&A PDF/网页作为 A/B 证据抽取。",
    ],
    scenarioThesis: {
      pessimistic: "核心业务改善慢，估值难继续扩张。",
      base: "核心业务温和修复，成熟业务提供现金流底座。",
      optimistic: "产品结构和客户验证超预期，利润弹性释放。",
    },
    valuationSensitivityText: "估值对核心业务兑现速度高度敏感。",
    scenarioInterpretationText: "悲观情景代表兑现慢；基准情景代表按公告可验证路径推进；乐观情景需要客户、价格或结构证据得到独立验证。",
    sensitivityNote: "基准情景若目标价低于现价，说明市场已提前定价一部分弹性；乐观情景需要官方证据兑现。",
    subsidiaryLossText: () => "重点子公司盈亏未能完整量化，需要继续复核子公司表。",
    baseSectionText: (baseProduct) => baseProduct
      ? `- 年报确认：${baseProduct.name}收入 ${formatNumberForReport(baseProduct.revenue)}，毛利率 ${formatPercentForReport(baseProduct.grossMarginPct)}，收入占比 ${formatPercentForReport(baseProduct.revenueSharePct)}。`
      : null,
  }
}

export function productLineRowsForReport(rows, profile = companyResearchProfile()) {
  const allRows = rows ?? []
  const productPatterns = profile.productPatterns ?? []
  const filtered = productPatterns.length
    ? allRows.filter((row) => productPatterns.some((pattern) => pattern.test(String(row.name ?? ""))))
    : []
  return filtered.length ? filtered : allRows.slice(0, 12)
}

export function parseVolumeYiFromRow(row) {
  if (!row?.volume) return null
  const match = String(row.volume).match(/(-?\d+(?:\.\d+)?)/)
  if (!match) return null
  const raw = Number(match[1])
  if (!Number.isFinite(raw)) return null
  return String(row.volume).includes("万") ? raw / 10000 : raw / 100000000
}

export function roundOrNull(value, digits = 2) {
  return value == null || !Number.isFinite(Number(value)) ? null : roundMetric(Number(value), digits)
}

export function latestAnnualIncomeRow(businessBreakdown) {
  return (businessBreakdown.historicalFinancials?.income ?? []).find((row) => row.reportType === "annual") ?? null
}

export function buildCompanyResearchInsightModel({ company, businessBreakdown, evidencePack }) {
  const profile = companyResearchProfile(company)
  const metrics = businessBreakdown.keyMetrics ?? {}
  const productLines = businessBreakdown.productLines ?? []
  const carrier = findBusinessRow(productLines, profile.baseProductPatterns) ?? (profile.kind === "jiemei" ? null : productLines[1] ?? null)
  const film = findBusinessRow(productLines, profile.coreProductPatterns) ?? (profile.kind === "jiemei" ? null : productLines[0] ?? null)
  const other = findBusinessRow(productLines, /^其他$/)
  const annualIncome = latestAnnualIncomeRow(businessBreakdown)
  const baseNetProfit = annualIncome?.netProfit ?? metrics.netProfit ?? 0
  const marketValue = metrics.totalMarketValue ?? 0
  const close = metrics.close ?? null
  const shares = marketValue && close ? marketValue / close : null
  const filmVolumeYi = parseVolumeYiFromRow(film)
  const filmAsp = film?.asp ?? null
  const focusSubsidiaries = (businessBreakdown.subsidiaryProfit ?? []).filter((row) =>
    (profile.focusSubsidiaryPatterns ?? []).some((pattern) => pattern.test(String(row.name ?? row.subsidiary ?? ""))),
  )
  const guangdong = focusSubsidiaries[0] ?? null
  const tianjin = focusSubsidiaries[1] ?? null
  const filmSubsidiaryLoss = focusSubsidiaries
    .map((row) => row?.operatingProfit)
    .filter((value) => Number.isFinite(Number(value)))
    .reduce((sum, value) => sum + Number(value), 0)
  const scenarioNetProfit = {
    pessimistic2026: baseNetProfit ? baseNetProfit * 1.6 : null,
    base2026: baseNetProfit ? baseNetProfit * 2.2 : null,
    optimistic2026: baseNetProfit ? baseNetProfit * 2.8 : null,
    pessimistic2027: baseNetProfit ? baseNetProfit * 2.3 : null,
    base2027: baseNetProfit ? baseNetProfit * 3.6 : null,
    optimistic2027: baseNetProfit ? baseNetProfit * 6.1 : null,
  }
  const scenarios = [
    {
      name: "悲观",
      evidenceLevel: "B/C",
      thesis: profile.scenarioThesis.pessimistic,
      filmVolume2026: filmVolumeYi ? filmVolumeYi * 1.5 : null,
      filmAsp2026: filmAsp ? filmAsp * 1.15 : null,
      filmVolume2027: filmVolumeYi ? filmVolumeYi * 2.1 : null,
      filmAsp2027: filmAsp ? filmAsp * 1.35 : null,
      netProfit2026: scenarioNetProfit.pessimistic2026,
      netProfit2027: scenarioNetProfit.pessimistic2027,
      targetPe2027: 30,
    },
    {
      name: "基准",
      evidenceLevel: "B/C",
      thesis: profile.scenarioThesis.base,
      filmVolume2026: filmVolumeYi ? filmVolumeYi * 1.8 : null,
      filmAsp2026: filmAsp ? Math.max(filmAsp * 1.35, 1.6) : null,
      filmVolume2027: filmVolumeYi ? filmVolumeYi * 2.9 : null,
      filmAsp2027: filmAsp ? Math.max(filmAsp * 1.6, 1.9) : null,
      netProfit2026: scenarioNetProfit.base2026,
      netProfit2027: scenarioNetProfit.base2027,
      targetPe2027: 40,
    },
    {
      name: "乐观",
      evidenceLevel: "C/待验证",
      thesis: profile.scenarioThesis.optimistic,
      filmVolume2026: filmVolumeYi ? filmVolumeYi * 2.1 : null,
      filmAsp2026: filmAsp ? Math.max(filmAsp * 1.6, 2.0) : null,
      filmVolume2027: filmVolumeYi ? filmVolumeYi * 3.8 : null,
      filmAsp2027: filmAsp ? Math.max(filmAsp * 2.2, 2.8) : null,
      netProfit2026: scenarioNetProfit.optimistic2026,
      netProfit2027: scenarioNetProfit.optimistic2027,
      targetPe2027: 45,
    },
  ].map((scenario) => {
    const targetMarketValue = scenario.netProfit2027 == null ? null : scenario.netProfit2027 * scenario.targetPe2027
    const targetPrice = targetMarketValue != null && shares ? targetMarketValue / shares : null
    return {
      ...scenario,
      targetMarketValue,
      targetPrice,
      upsidePct: targetPrice != null && close ? (targetPrice / close - 1) * 100 : null,
      impliedPe2026: scenario.netProfit2026 && marketValue ? marketValue / scenario.netProfit2026 : null,
      impliedPe2027: scenario.netProfit2027 && marketValue ? marketValue / scenario.netProfit2027 : null,
    }
  })
  const webEvidence = evidencePack?.tavily?.results ?? []
  return {
    profile,
    company,
    carrier,
    film,
    baseProduct: carrier,
    coreProduct: film,
    other,
    annualIncome,
    marketValue,
    close,
    shares,
    baseNetProfit,
    filmVolumeYi,
    filmAsp,
    guangdong,
    tianjin,
    filmSubsidiaryLoss,
    scenarios,
    officialDocumentCount: businessBreakdown.productLines?.filter((row) => row.sourceType === "annual_report").length ?? 0,
    webEvidenceCount: webEvidence.length,
  }
}

export function buildEvidenceConfidenceRows({ documentExtract, evidencePack }) {
  const docs = (documentExtract.documents ?? []).map((doc) => ({
    来源: doc.title,
    可信度: doc.type === "annual_report" || doc.type === "semiannual_report" || doc.type === "quarterly_report" ? "A 一手公告" : "A 官方公告",
    用途: doc.type === "annual_report" ? "年度基准模型、产品/毛利率/在建工程" : doc.type === "semiannual_report" ? "子公司与中期经营补充" : "事项验证",
  }))
  const web = (evidencePack?.tavily?.results ?? []).slice(0, 3).map((item) => ({
    来源: item.title || item.query || "Web evidence",
    可信度: "C 外部资料",
    用途: "技术能力、同业、供应链辅助判断，不进入基准事实",
  }))
  return [...docs, ...web]
}

export function scenarioMarkdownTable(scenarios, close, profile = companyResearchProfile()) {
  const volumeHeader = profile.scenarioVolumeHeader ?? "2026E核心业务量"
  const aspHeader = profile.scenarioAspHeader ?? "2026E价格/毛利率"
  return markdownTable(
    ["情景", volumeHeader, aspHeader, "2027E净利", "2027E目标PE", "目标价", "较当前", "证据等级"],
    scenarios.map((item) => ({
      情景: item.name,
      [volumeHeader]: item.filmVolume2026 == null ? "n/a" : `${roundMetric(item.filmVolume2026, 2)}${profile.scenarioVolumeUnit ?? ""}`,
      [aspHeader]: item.filmAsp2026 == null ? "n/a" : `${roundMetric(item.filmAsp2026, 2)}${profile.scenarioAspUnit ?? ""}`,
      "2027E净利": formatYi(item.netProfit2027),
      "2027E目标PE": `${item.targetPe2027}x`,
      目标价: item.targetPrice == null ? "n/a" : `${roundMetric(item.targetPrice, 2)}元`,
      较当前: item.upsidePct == null ? "n/a" : `${roundMetric(item.upsidePct, 1)}%`,
      证据等级: item.evidenceLevel,
    })),
  )
}

export function impliedPeMarkdownTable(scenarios) {
  return markdownTable(
    ["情景", "2026E隐含PE", "2027E隐含PE", "含义"],
    scenarios.map((item) => ({
      情景: item.name,
      "2026E隐含PE": item.impliedPe2026 == null ? "n/a" : `${roundMetric(item.impliedPe2026, 1)}x`,
      "2027E隐含PE": item.impliedPe2027 == null ? "n/a" : `${roundMetric(item.impliedPe2027, 1)}x`,
      含义: item.thesis,
    })),
  )
}

export function buildExitSignalRows(profile = companyResearchProfile()) {
  if (profile.kind === "semiconductor_memory") {
    return [
      { 指标: "存储产品收入/毛利率", 观测时间: "半年报/季报", 乐观信号: "收入恢复且毛利率持续改善", 悲观信号: "收入修复但毛利率停留低位" },
      { 指标: "库存与渠道", 观测时间: "季报/年报附注", 乐观信号: "库存周转改善、减值压力下降", 悲观信号: "库存继续累积或跌价准备扩大" },
      { 指标: "MCU/传感器韧性", 观测时间: "分产品表/IR", 乐观信号: "成熟产品收入稳定且毛利率不恶化", 悲观信号: "成熟产品同步下滑，现金流底座削弱" },
      { 指标: "研发/新品导入", 观测时间: "公告/IR/客户验证", 乐观信号: "官方明确新品量产或客户导入", 悲观信号: "长期只有外部传闻" },
      { 指标: "在建工程/资本开支", 观测时间: "资产负债表附注", 乐观信号: "转固后收入释放", 悲观信号: "高投入但收入/利润没有跟上" },
      { 指标: "重大事项", 观测时间: "公告原文", 乐观信号: "标的盈利、对价、协同清晰且可并表验证", 悲观信号: "长期只有外部线索，缺官方条款或财务影响" },
    ]
  }
  if (profile.kind === "jiemei") {
    return [
    { 指标: "薄膜材料季度收入", 观测时间: "半年报/季报", 乐观信号: "收入显著高于历史季度 run-rate", 悲观信号: "收入增速低于产能爬坡假设" },
    { 指标: "薄膜毛利率", 观测时间: "半年报/年报", 乐观信号: ">25% 并持续改善", 悲观信号: "<15% 或改善停滞" },
    { 指标: "ASP", 观测时间: "公告/年报量价表", 乐观信号: "混合 ASP 上行且销量同步增长", 悲观信号: "ASP 停留在低端产品价格带" },
    { 指标: "在建工程", 观测时间: "资产负债表附注", 乐观信号: "转固后收入释放", 悲观信号: "高余额、高进度但利润不释放" },
    { 指标: "高端客户/产品", 观测时间: "公告/IR/客户验证", 乐观信号: "明确批量或价格带披露", 悲观信号: "长期只有外部传闻" },
    { 指标: "重大事项", 观测时间: "公告原文", 乐观信号: "标的资产盈利、对价、协同清晰且可并表验证", 悲观信号: "长期只有外部线索，缺官方条款或财务影响" },
  ]
  }
  return [
    { 指标: "核心业务收入/毛利率", 观测时间: "半年报/季报", 乐观信号: "收入和毛利率同步改善", 悲观信号: "收入修复但利润率不改善" },
    { 指标: "现金流底座", 观测时间: "季报/年报", 乐观信号: "经营现金流和利润同步改善", 悲观信号: "利润增长但现金流持续背离" },
    { 指标: "客户/产品验证", 观测时间: "公告/IR/客户验证", 乐观信号: "官方明确批量或价格带披露", 悲观信号: "长期只有外部传闻" },
    { 指标: "资本开支", 观测时间: "资产负债表附注", 乐观信号: "转固后收入释放", 悲观信号: "高投入但收入/利润没有跟上" },
  ]
}

export function buildValuationSensitivityRows(insight) {
  const peLevels = [25, 30, 35, 40, 45, 50]
  const scenarios = ["悲观", "基准", "乐观"].map((name) => insight.scenarios.find((row) => row.name === name)).filter(Boolean)
  return peLevels.map((pe) => {
    const row = { PE: `${pe}x` }
    for (const scenario of scenarios) {
      const targetMarketValue = scenario.netProfit2027 == null ? null : scenario.netProfit2027 * pe
      const targetPrice = targetMarketValue != null && insight.shares ? targetMarketValue / insight.shares : null
      row[`${scenario.name}目标价`] = targetPrice == null ? "n/a" : `${roundMetric(targetPrice, 2)}元`
      row[`${scenario.name}市值`] = targetMarketValue == null ? "n/a" : formatNumberForReport(targetMarketValue)
      if (scenario.name === "基准") {
        row["基准较当前"] = targetPrice != null && insight.close ? `${roundMetric((targetPrice / insight.close - 1) * 100, 1)}%` : "n/a"
      }
    }
    return row
  })
}

export function buildValidationChecklistRows({ insight, businessBreakdown }) {
  const profile = insight.profile ?? companyResearchProfile(insight.company)
  const corporateAction = (businessBreakdown.corporateActions ?? []).find((row) => row.terms?.targetName)
  if (profile.kind === "semiconductor_memory") {
    return [
      {
        事项: "存储产品收入与毛利率",
        当前证据: insight.coreProduct ? `${formatNumberForReport(insight.coreProduct.revenue)}收入，毛利率${formatPercentForReport(insight.coreProduct.grossMarginPct)}` : "manual_needed",
        下一步数据: "半年报/年报分产品收入、毛利率和库存附注",
        乐观确认: "收入恢复且毛利率连续改善",
        证伪信号: "收入恢复但毛利率低位停滞或库存减值扩大",
        责任状态: insight.coreProduct ? "已抽取基准，等待下一期复核" : "manual_needed",
      },
      {
        事项: "MCU/传感器现金流底座",
        当前证据: insight.baseProduct ? `${formatNumberForReport(insight.baseProduct.revenue)}收入，毛利率${formatPercentForReport(insight.baseProduct.grossMarginPct)}` : "manual_needed",
        下一步数据: "分产品表、IR 对下游需求和价格的官方说明",
        乐观确认: "成熟产品收入稳定且毛利率不恶化",
        证伪信号: "成熟产品同步下滑，底座削弱",
        责任状态: insight.baseProduct ? "已抽取基准，等待下一期复核" : "manual_needed",
      },
      {
        事项: "库存去化与跌价准备",
        当前证据: (businessBreakdown.historicalFinancials?.balance ?? []).some((row) => row.inventories != null) ? "已拉取资产负债表库存字段，需附注复核" : "manual_needed",
        下一步数据: "存货附注、跌价准备、库存周转天数",
        乐观确认: "库存周转改善，跌价准备压力下降",
        证伪信号: "库存继续累积或跌价准备扩大",
        责任状态: "cross_check",
      },
      {
        事项: "在建工程转固与折旧压力",
        当前证据: (businessBreakdown.capex ?? []).some((row) => row.status === "extracted") ? "已抽取在建工程项目和进度" : "manual_needed",
        下一步数据: "资产负债表附注、在建工程明细、固定资产折旧",
        乐观确认: "转固后收入释放快于折旧压力",
        证伪信号: "高进度项目转固后收入/利润没有跟上",
        责任状态: (businessBreakdown.capex ?? []).some((row) => row.status === "extracted") ? "已抽取项目，需跟踪转固" : "manual_needed",
      },
      {
        事项: "收购/投资事项",
        当前证据: corporateAction?.terms?.targetName ? `${corporateAction.terms.targetName}；${corporateAction.terms.priceStatus ?? "作价待定"}` : "manual_needed",
        下一步数据: "公告原文、基金/并购标的、审计评估、并表节奏",
        乐观确认: "标的盈利、作价、协同和并表节奏清晰",
        证伪信号: "长期只有进展公告，缺少财务影响",
        责任状态: corporateAction?.terms?.targetName ? "已抽取条款，等待后续公告" : "manual_needed",
      },
      {
        事项: "新品/客户/国产替代验证",
        当前证据: `${businessBreakdown.technicalAndIndustryEvidence?.length ?? 0} 条 C 级外部资料`,
        下一步数据: "官方 IR、公告、客户认证或批量供货披露",
        乐观确认: "官方明确新品量产、客户导入或价格改善",
        证伪信号: "长期只有外部资料或研报表述，没有官方验证",
        责任状态: "C 级线索，不能进入基准模型",
      },
    ]
  }
  if (profile.kind !== "jiemei") {
    return [
      {
        事项: "核心业务收入与毛利率",
        当前证据: insight.coreProduct ? `${formatNumberForReport(insight.coreProduct.revenue)}收入，毛利率${formatPercentForReport(insight.coreProduct.grossMarginPct)}` : "manual_needed",
        下一步数据: "半年报/年报分产品收入和毛利率表",
        乐观确认: "收入和毛利率同步改善",
        证伪信号: "收入放量但毛利率停留低位或继续下滑",
        责任状态: insight.coreProduct ? "已抽取基准，等待下一期复核" : "manual_needed",
      },
      {
        事项: "成熟业务现金流底座",
        当前证据: insight.baseProduct ? `${formatNumberForReport(insight.baseProduct.revenue)}收入，毛利率${formatPercentForReport(insight.baseProduct.grossMarginPct)}` : "manual_needed",
        下一步数据: "分产品表、现金流量表、客户/价格官方说明",
        乐观确认: "成熟业务收入稳定且现金流改善",
        证伪信号: "利润增长但现金流持续背离",
        责任状态: insight.baseProduct ? "已抽取基准，等待下一期复核" : "manual_needed",
      },
      {
        事项: "在建工程转固与折旧压力",
        当前证据: (businessBreakdown.capex ?? []).some((row) => row.status === "extracted") ? "已抽取在建工程项目和进度" : "manual_needed",
        下一步数据: "资产负债表附注、在建工程明细、固定资产折旧",
        乐观确认: "转固后收入释放快于折旧压力",
        证伪信号: "高进度项目转固后收入/利润没有跟上",
        责任状态: (businessBreakdown.capex ?? []).some((row) => row.status === "extracted") ? "已抽取项目，需跟踪转固" : "manual_needed",
      },
      {
        事项: "客户/技术验证",
        当前证据: `${businessBreakdown.technicalAndIndustryEvidence?.length ?? 0} 条 C 级外部资料`,
        下一步数据: "官方 IR、公告、客户认证或批量供货披露",
        乐观确认: "官方明确客户、价格或批量供货",
        证伪信号: "长期只有外部资料或研报表述，没有官方验证",
        责任状态: "C 级线索，不能进入基准模型",
      },
    ]
  }
  return [
    {
      事项: "薄膜材料收入与毛利率",
      当前证据: insight.film ? `${formatNumberForReport(insight.film.revenue)}收入，毛利率${formatPercentForReport(insight.film.grossMarginPct)}` : "manual_needed",
      下一步数据: "半年报/年报分产品收入和毛利率表",
      乐观确认: "收入增速继续高于公司整体，毛利率持续改善",
      证伪信号: "收入放量但毛利率停留低位或继续下滑",
      责任状态: insight.film ? "已抽取基准，等待下一期复核" : "manual_needed",
    },
    {
      事项: "薄膜 ASP 与销量",
      当前证据: insight.film?.asp == null ? "manual_needed" : `${insight.film.volume ?? "n/a"}，ASP ${insight.film.asp}${insight.film.aspUnit ?? ""}`,
      下一步数据: "年报产销量表、IR 对高端产品价格带的官方说明",
      乐观确认: "销量和混合 ASP 同时上行",
      证伪信号: "只有销量增长，ASP 仍在低端价格带",
      责任状态: insight.film?.asp == null ? "manual_needed" : "已推算，需口径复核",
    },
    {
      事项: "广东/天津薄膜子公司亏损修复",
      当前证据: insight.filmSubsidiaryLoss ? `营业利润合计 ${formatNumberForReport(insight.filmSubsidiaryLoss)}` : "manual_needed",
      下一步数据: "半年报/年报主要子公司盈亏表",
      乐观确认: "亏损明显收窄或转正",
      证伪信号: "收入增长但子公司仍扩大亏损",
      责任状态: insight.filmSubsidiaryLoss ? "已抽取基准，等待下一期复核" : "manual_needed",
    },
    {
      事项: "在建工程转固与折旧压力",
      当前证据: (businessBreakdown.capex ?? []).some((row) => row.status === "extracted") ? "已抽取在建工程项目和进度" : "manual_needed",
      下一步数据: "资产负债表附注、在建工程明细、固定资产折旧",
      乐观确认: "转固后收入释放快于折旧压力",
      证伪信号: "高进度项目转固后收入/利润没有跟上",
      责任状态: (businessBreakdown.capex ?? []).some((row) => row.status === "extracted") ? "已抽取项目，需跟踪转固" : "manual_needed",
    },
    {
      事项: "收购/重组期权",
      当前证据: corporateAction?.terms?.targetName ? `${corporateAction.terms.targetName}；${corporateAction.terms.priceStatus ?? "作价待定"}` : "manual_needed",
      下一步数据: "重组报告书、审计评估报告、交易价格、业绩承诺",
      乐观确认: "标的盈利、作价、协同和并表节奏清晰",
      证伪信号: "审计评估迟迟不落地，或交易价格/业绩承诺低于预期",
      责任状态: corporateAction?.terms?.targetName ? "已抽取预案条款，等待正式报告书" : "manual_needed",
    },
    {
      事项: "高端客户/技术验证",
      当前证据: `${businessBreakdown.technicalAndIndustryEvidence?.length ?? 0} 条 C 级外部资料`,
      下一步数据: "官方 IR、公告、客户认证或批量供货披露",
      乐观确认: "官方明确高端 MLCC/客户/批量供货",
      证伪信号: "长期只有外部资料或研报表述，没有官方验证",
      责任状态: "C 级线索，不能进入基准模型",
    },
  ]
}

export function buildDeepCompanyReportMarkdown({ company, ledger, documentExtract, businessBreakdown, evidencePack, wikiCandidatesMarkdown, generatedAt }) {
  const metrics = businessBreakdown.keyMetrics ?? {}
  const insight = buildCompanyResearchInsightModel({ company, businessBreakdown, evidencePack })
  const profile = insight.profile ?? companyResearchProfile(company)
  const reportProductLines = productLineRowsForReport(businessBreakdown.productLines ?? [], profile)
  const productRows = reportProductLines.map((row) => ({
    业务或产品: row.name ?? row.product ?? row.segment ?? "n/a",
    收入: row.revenue == null ? "manual_needed" : formatNumberForReport(row.revenue),
    成本: row.cost == null ? "" : formatNumberForReport(row.cost),
    收入占比: row.revenueSharePct == null ? "" : `${roundMetric(row.revenueSharePct, 2)}%`,
    毛利率: row.grossMarginPct == null ? "manual_needed" : `${roundMetric(row.grossMarginPct, 2)}%`,
    收入同比: row.yoyRevenuePct == null ? "" : `${roundMetric(row.yoyRevenuePct, 2)}%`,
    销量: row.volume ?? "manual_needed",
    ASP: row.asp == null ? "manual_needed" : `${row.asp}${row.aspUnit ? ` ${row.aspUnit}` : ""}`,
    状态: row.status ?? "n/a",
    页码: row.sourcePages?.join(",") ?? row.sourcePage ?? "",
    来源: row.sourceTitle ?? row.source ?? "n/a",
  }))
  const subsidiaryRows = (businessBreakdown.subsidiaryProfit ?? []).map((row) => ({
    子公司: row.name ?? row.subsidiary ?? "n/a",
    总资产: row.totalAssets == null ? "" : formatNumberForReport(row.totalAssets),
    净资产: row.netAssets == null ? "" : formatNumberForReport(row.netAssets),
    收入: row.revenue == null ? "manual_needed" : formatNumberForReport(row.revenue),
    营业利润: row.operatingProfit == null ? "" : formatNumberForReport(row.operatingProfit),
    净利润: row.netProfit == null ? "manual_needed" : formatNumberForReport(row.netProfit),
    状态: row.status ?? "n/a",
    页码: row.sourcePage ?? "",
    来源: row.sourceTitle ?? row.source ?? "n/a",
  }))
  const capexRows = (businessBreakdown.capex ?? []).map((row) => ({
    项目: row.name ?? row.project ?? "n/a",
    预算: row.budget == null ? "" : formatNumberForReport(row.budget),
    期末余额: row.closingBalance == null ? (row.amount == null ? "manual_needed" : formatNumberForReport(row.amount)) : formatNumberForReport(row.closingBalance),
    工程进度: row.progressPct == null ? "" : `${roundMetric(row.progressPct, 2)}%`,
    状态: row.status ?? "n/a",
    页码: row.sourcePage ?? "",
    来源: row.sourceTitle ?? row.source ?? "n/a",
    说明: row.reason ?? "",
  }))
  const incomeRows = (businessBreakdown.historicalFinancials?.income ?? []).slice(0, 6).map((row) => ({
    期间: row.periodLabel,
    收入: formatNumberForReport(row.revenue),
    归母净利润: formatNumberForReport(row.netProfit),
    经营利润: formatNumberForReport(row.operatingProfit),
    报告类型: row.reportType,
  }))
  const industryRows = (businessBreakdown.technicalAndIndustryEvidence ?? []).slice(0, 8).map((row) => ({
    主题: row.query ?? "",
    标题: row.title ?? "",
    证据等级: row.evidenceLevel,
    链接: row.url ?? "",
  }))
  const corporateActionRows = (businessBreakdown.corporateActions ?? []).map((row) => ({
    事项: row.title ?? "n/a",
    日期: row.date ?? "",
    类型: row.type ?? "",
    状态: row.status ?? "",
    证据等级: row.evidenceLevel ?? "",
    来源: row.source ?? "",
    页码或链接: row.pages || row.filePath || "",
    摘要: row.summary ?? "",
  }))
  const termLabels = {
    transactionForm: "交易形式",
    transactionOverview: "交易方案简介",
    targetName: "交易标的",
    targetBusiness: "标的主营业务",
    targetIndustry: "标的所属行业",
    counterparties: "交易对方",
    priceStatus: "交易价格状态",
    performanceCommitment: "业绩承诺状态",
    auditValuationStatus: "审计/评估状态",
  }
  const corporateTermRows = (businessBreakdown.corporateActions ?? []).flatMap((row) =>
    Object.entries(row.terms ?? {}).map(([field, value]) => ({
      事项: row.title ?? "",
      字段: termLabels[field] ?? field,
      内容: value,
      证据等级: row.evidenceLevel ?? "",
      状态: row.status ?? "",
    })),
  )
  const exitSignalRows = buildExitSignalRows(profile)
  const valuationSensitivityRows = buildValuationSensitivityRows(insight)
  const validationChecklistRows = buildValidationChecklistRows({ insight, businessBreakdown })
  const manualItems = [
    ...(businessBreakdown.productLines ?? []).filter((row) => row.status === "manual_needed").map((row) => row.name ?? "产品拆分"),
    ...(businessBreakdown.subsidiaryProfit ?? []).filter((row) => row.status === "manual_needed").map((row) => row.name ?? "子公司盈亏"),
    ...(businessBreakdown.capacity ?? []).filter((row) => row.status === "manual_needed").map((row) => row.name ?? "产能/ASP"),
  ]
  const confidenceRows = buildEvidenceConfidenceRows({ documentExtract, evidencePack })
  const currentPosition = insight.scenarios.find((item) => item.name === "基准")
  const coreVerdict = currentPosition?.targetPrice != null && metrics.close
    ? (currentPosition.targetPrice > metrics.close * 1.15 ? "基准情景仍有上行空间，但需要后续经营验证。" : currentPosition.targetPrice < metrics.close * 0.9 ? "当前价格已接近或高于基准情景，主要价值来自乐观期权。" : profile.currentPositionText)
    : "估值位置需要股价/市值和情景净利润继续校验。"
  const filmLossText = profile.subsidiaryLossText(insight.filmSubsidiaryLoss)
  const coreProduct = insight.coreProduct
  const baseProduct = insight.baseProduct
  const baseSectionText = profile.baseSectionText(baseProduct) ?? profile.baseSectionMissing
  const riskRows = profile.kind === "semiconductor_memory"
    ? [
        { 风险: "存储价格周期修复失败", 量化影响: "基准/乐观情景下修，估值回到成熟业务底座定价", 触发条件: "存储收入或毛利率连续低于模型假设" },
        { 风险: "库存去化慢或跌价压力", 量化影响: "毛利率和现金流承压", 触发条件: "库存继续累积或跌价准备扩大" },
        { 风险: "新品/客户验证慢", 量化影响: "乐观期权折价或归零", 触发条件: "官方公告/IR 持续缺少量产和客户导入证据" },
        { 风险: "C 级资料无法证实", 量化影响: "情景假设降级", 触发条件: "外部资料与公告表格冲突或没有官方确认" },
      ]
    : profile.kind === "jiemei"
      ? [
          { 风险: "薄膜量价双升失败", 量化影响: "基准/乐观情景下修，估值回到载带现金牛定价", 触发条件: "薄膜收入或毛利率连续低于模型假设" },
          { 风险: "高端产品验证慢", 量化影响: "乐观期权折价或归零", 触发条件: "官方公告/IR 持续停留在验证中，缺少批量供货证据" },
          { 风险: "在建工程转固压力", 量化影响: "折旧压制利润释放", 触发条件: "在建工程余额高、工程进度高但收入不提速" },
          { 风险: "C 级资料无法证实", 量化影响: "情景假设降级", 触发条件: "外部资料与公告表格冲突或没有官方确认" },
        ]
      : [
          { 风险: "核心业务兑现失败", 量化影响: "基准/乐观情景下修", 触发条件: "收入或毛利率连续低于模型假设" },
          { 风险: "现金流验证不足", 量化影响: "估值折价", 触发条件: "利润增长但经营现金流持续背离" },
          { 风险: "客户/产品验证慢", 量化影响: "乐观期权折价或归零", 触发条件: "官方公告/IR 缺少批量供货证据" },
          { 风险: "C 级资料无法证实", 量化影响: "情景假设降级", 触发条件: "外部资料与公告表格冲突或没有官方确认" },
        ]
  return [
    `# ${company.stockName ?? company.stockInput} 深度公司研究底稿`,
    "",
    `- 生成时间：${generatedAt}`,
    `- 股票代码：${company.tsCode ?? company.stockCode ?? "n/a"}`,
    `- 行业：${company.industry ?? "n/a"}`,
    "- 输出性质：可复核深度底稿，不自动写入正式 wiki。",
    "- 报告方法：以公告和结构化财务为基准，外部资料仅用于技术定位、催化和情景假设。",
    "",
    "## 自动重建说明",
    "",
    "- 本版本从 CNINFO PDF 原文表格、Tushare 财务快照、Tavily/Web 资料和既有 wiki 检索重建公司研究底稿。",
    "- 基准事实只采用 A/B 级证据；C 级资料进入技术能力、催化、乐观情景或待验证清单。",
    "- 和人工 DOCX 相比，本报告把未经核实的调研、路演、群聊数据降级为待验证，不直接进入基准模型。",
    "",
    "## 数据拉取确认",
    "",
    markdownTable(
      ["数据项", "来源", "工具", "状态", "完成时间", "用途", "可信等级"],
      ledger.rows.map((row) => ({
        数据项: row.dataItem,
        来源: row.source,
        工具: row.tool,
        状态: row.status,
        完成时间: row.completedAt,
        用途: row.purpose,
        可信等级: row.evidenceLevel,
      })),
    ),
    "",
    "## 数据可信度说明",
    "",
    markdownTable(["来源", "可信度", "用途"], confidenceRows),
    "",
    "## 开篇结论",
    "",
    `- 核心判断：${coreVerdict}`,
    `- 基础事实：最新报告期 ${formatPeriod(metrics.latestPeriod)}，收入 ${formatNumberForReport(metrics.revenue)}，归母净利润 ${formatNumberForReport(metrics.netProfit)}，毛利率 ${metrics.grossMarginPct == null ? "n/a" : `${roundMetric(metrics.grossMarginPct, 2)}%`}。`,
    `- 估值状态：股价 ${metrics.close == null ? "n/a" : `${roundMetric(metrics.close, 2)}元`}，总市值 ${formatNumberForReport(metrics.totalMarketValue)}，PE TTM ${metrics.peTtm == null ? "n/a" : roundMetric(metrics.peTtm, 2)}，PB ${metrics.pb == null ? "n/a" : roundMetric(metrics.pb, 2)}。`,
    `- 主导矛盾：${coreProduct ? `${coreProduct.name ?? profile.coreProductName}收入 ${formatNumberForReport(coreProduct.revenue)}、毛利率 ${formatPercentForReport(coreProduct.grossMarginPct)}，${coreProduct.asp == null ? "价格/ASP 口径需复核" : `混合 ASP ${coreProduct.asp} ${coreProduct.aspUnit ?? ""}`}，决定未来弹性。` : profile.coreMissingText}`,
    "- 证据边界：A/B 级事实进入基础模型；C 级网页/研报证据只用于技术定位和乐观情景；manual_needed 不进入估值。",
    manualItems.length ? `- 主要缺口：${manualItems.slice(0, 6).join("、")} 仍需人工复核。` : "- 主要缺口：暂无强制人工缺口，但仍需复核公告原表。",
    "",
    "## 一、业务地图（公告确认数据）",
    "",
    "### 1.1 分产品收入与毛利率",
    "",
    markdownTable(["业务或产品", "收入", "成本", "收入占比", "毛利率", "收入同比", "销量", "ASP", "状态", "页码", "来源"], productRows),
    "",
    profile.aspSectionTitle,
    "",
    coreProduct
      ? [
          `- 年报直接数据：${coreProduct.name ?? profile.coreProductName}收入 ${formatNumberForReport(coreProduct.revenue)}，销量 ${coreProduct.volume ?? "n/a"}，反推/观察口径 ${coreProduct.asp == null ? "manual_needed" : `${coreProduct.asp}${coreProduct.aspUnit ? ` ${coreProduct.aspUnit}` : ""}`}。`,
          `- 口径说明：${profile.aspNote}`,
          "- 建模含义：基准情景看结构升级和利用率改善；乐观情景必须由高端客户、高 ASP 产品或明确公告验证。",
        ].join("\n")
      : "- 未抽到可反推 ASP 的销量/收入组合，需人工复核。",
    "",
    "### 1.3 子公司盈亏核实",
    "",
    filmLossText,
    "",
    "## 子公司盈亏核实",
    "",
    markdownTable(["子公司", "总资产", "净资产", "收入", "营业利润", "净利润", "状态", "页码", "来源"], subsidiaryRows),
    "",
    "## 二、技术能力与同业/海外对标",
    "",
    profile.techNotes.join("\n"),
    "",
    industryRows.length
      ? markdownTable(["主题", "标题", "证据等级", "链接"], industryRows)
      : "- 暂无 C 级外部技术/同业证据。",
    "",
    "## 三、产能规划与折旧压力",
    "",
    markdownTable(["项目", "预算", "期末余额", "工程进度", "状态", "页码", "来源", "说明"], capexRows),
    "",
    "## 四、历史财务重建",
    "",
    markdownTable(["期间", "收入", "归母净利润", "经营利润", "报告类型"], incomeRows),
    "",
    profile.baseSectionTitle,
    "",
    baseSectionText,
    "",
    "## 六、重大事项/收购期权价值",
    "",
    markdownTable(["事项", "日期", "类型", "状态", "证据等级", "来源", "页码或链接", "摘要"], corporateActionRows),
    "",
    "### 6.1 预案关键条款自动抽取",
    "",
    corporateTermRows.length
      ? markdownTable(["事项", "字段", "内容", "证据等级", "状态"], corporateTermRows)
      : "- 未从官方重大事项 PDF 中稳定抽出交易条款，需人工打开预案原文复核。",
    "",
    "- 处理原则：官方公告 PDF 属于 A 级，可进入事项验证；外部资料或网页线索只能作为 C 级期权假设，不进入基准估值。",
    "- 若状态为 `manual_needed` 或 `announcement_only`，需要补下载/打开原 PDF 表格，确认交易标的、对价、利润、商誉和并表时间。",
    "",
    "## 七、三年财务模型（三情景）",
    "",
    "- 情景模型不是官方预测，而是把公告事实转成可讨论的买方底稿；基准只依赖 A/B 级事实锚点，C 级资料只改变乐观路径。",
    `- ${profile.coreVariableText}`,
    "",
    scenarioMarkdownTable(insight.scenarios, metrics.close, profile),
    "",
    "## 八、估值分析",
    "",
    impliedPeMarkdownTable(insight.scenarios),
    "",
    `- 当前市值 ${formatNumberForReport(metrics.totalMarketValue)}。若以 2027E 情景净利衡量，${profile.valuationSensitivityText}`,
    `- ${profile.scenarioInterpretationText}`,
    "",
    "## 九、PE/市值敏感性矩阵",
    "",
    markdownTable(["PE", "悲观目标价", "基准目标价", "乐观目标价", "基准较当前"], valuationSensitivityRows),
    "",
    "- 读法：敏感性矩阵不是预测结论，而是把 2027E 情景净利润和目标 PE 展开，帮助判断当前价格隐含了哪一种兑现路径。",
    `- ${profile.sensitivityNote}`,
    "",
    "## 十、核心风险",
    "",
    markdownTable(
      ["风险", "量化影响", "触发条件"],
      riskRows,
    ),
    "",
    "## 十一、退出信号体系",
    "",
    markdownTable(["指标", "观测时间", "乐观信号", "悲观信号"], exitSignalRows),
    "",
    "## 十二、验证清单",
    "",
    markdownTable(["事项", "当前证据", "下一步数据", "乐观确认", "证伪信号", "责任状态"], validationChecklistRows),
    "",
    "## 十三、研究边界声明",
    "",
    "- 本报告基于可核实的一手公告、结构化财务和已标级外部资料生成。",
    "- 没有页码、公告标题或结构化来源绑定的数字不会作为基准模型事实。",
    "- C/D 级资料可进入观察线索、催化和乐观情景，但不能替代公告表格。",
    "- 下一次更新触发：半年报/季报披露、官方 IR 明确高端产品批量、或重大收购事项进展。",
    "",
    "## wiki 写入候选",
    "",
    wikiCandidatesMarkdown.split("\n").slice(4, 24).join("\n"),
    "",
    "## PDF/表格抽取状态",
    "",
    markdownTable(
      ["文件", "状态", "抽取字符", "原始表数", "关键表数", "关键行数", "工具"],
      (documentExtract.documents ?? []).map((doc) => ({
        文件: doc.title,
        状态: doc.status,
        抽取字符: doc.extractedChars ?? 0,
        原始表数: doc.tables?.length ?? 0,
        关键表数: (doc.tables ?? []).filter((table) => table.type !== "other").length,
        关键行数: (doc.tables ?? []).filter((table) => table.type !== "other").reduce((sum, table) => sum + (table.rows?.length ?? 0), 0),
        工具: doc.extractionTool,
      })),
    ),
    "",
    "## 口径复核提示",
    "",
    "- `ASP` 若显示 `requires_review` 相关说明，表示它由收入和销量表推导，尚未把产品与销量单位完全确认为同一口径。",
    "- PDF 表格页码来自自动抽取页码，最终引用正式报告前仍建议打开原 PDF 对照。",
    "",
  ].join("\n")
}

export function buildDeepReviewChecklist({ documentExtract, businessBreakdown }) {
  const items = []
  const corporateActionsByTitle = new Map((businessBreakdown.corporateActions ?? []).map((row) => [row.title, row]))
  for (const doc of documentExtract.documents ?? []) {
    if (doc.status !== "success" || (doc.tables?.length ?? 0) === 0) {
      if (isCorporateActionDocument(doc)) {
        const action = corporateActionsByTitle.get(doc.title)
        const termCount = Object.keys(action?.terms ?? {}).length
        items.push({
          item: doc.title,
          status: termCount > 0 ? "review_required" : "manual_needed",
          reason: termCount > 0
            ? "Corporate action terms were extracted; review original PDF for final price, audited financials, performance commitment and approval status."
            : "Official event PDF was cached, but key transaction terms were not machine-extracted.",
          evidenceLevel: "A",
        })
        continue
      }
      if (doc.type === "quarterly_report" || /摘要/.test(doc.title ?? "")) {
        items.push({
          item: doc.title,
          status: "review_optional",
          reason: "PDF text was cached; detailed annual-report table normalization is not required for the base model.",
          evidenceLevel: "A",
        })
        continue
      }
      items.push({
        item: doc.title,
        status: "manual_needed",
        reason: doc.issues?.join("; ") || "PDF table extraction not verified.",
        evidenceLevel: "A",
      })
    }
  }
  for (const section of ["productLines", "subsidiaryProfit", "capacity", "capex"]) {
    for (const row of businessBreakdown[section] ?? []) {
      if (row.status === "manual_needed") {
        items.push({
          item: row.name ?? section,
          status: "manual_needed",
          reason: row.reason ?? "Requires official table/text review.",
          evidenceLevel: row.evidenceLevel ?? "A",
        })
      }
    }
  }
  const insight = buildCompanyResearchInsightModel({ company: businessBreakdown.company, businessBreakdown, evidencePack: null })
  const validationRows = buildValidationChecklistRows({ insight, businessBreakdown })
  return [
    "# Deep Company Research Review Checklist",
    "",
    items.length
      ? markdownTable(["事项", "状态", "原因", "证据等级"], items.map((item) => ({
          事项: item.item,
          状态: item.status,
          原因: item.reason,
          证据等级: item.evidenceLevel,
        })))
      : "- No mandatory manual review items detected.",
    "",
    "## Validation Checklist",
    "",
    markdownTable(["事项", "当前证据", "下一步数据", "乐观确认", "证伪信号", "责任状态"], validationRows),
    "",
  ].join("\n")
}

export function buildDeepCompanyWorkbookRows({ company, businessBreakdown, ledger, evidencePack }) {
  const metrics = businessBreakdown.keyMetrics ?? {}
  const revenue = metrics.revenue ?? 0
  const netProfit = metrics.netProfit ?? 0
  const pe = metrics.peTtm ?? 25
  const insight = buildCompanyResearchInsightModel({ company, businessBreakdown, evidencePack })
  const profile = insight.profile ?? companyResearchProfile(company)
  const productRows = (businessBreakdown.productLines ?? []).map((row) => [
    row.name ?? row.product ?? row.segment ?? "n/a",
    row.revenue ?? "",
    row.cost ?? "",
    row.revenueSharePct ?? "",
    row.grossMarginPct ?? "",
    row.yoyRevenuePct ?? "",
    row.volume ?? "",
    row.asp ?? "",
    row.aspUnit ?? "",
    row.aspStatus ?? "",
    row.status ?? "",
    row.evidenceLevel ?? "",
    row.sourcePages?.join(",") ?? row.sourcePage ?? "",
    row.sourceTitle ?? row.source ?? "",
  ])
  const capexRows = (businessBreakdown.capex ?? []).map((row) => [
    row.name ?? row.project ?? "n/a",
    row.budget ?? "",
    row.openingBalance ?? "",
    row.additions ?? "",
    row.transferredToFixedAssets ?? "",
    row.closingBalance ?? row.amount ?? "",
    row.progressPct ?? "",
    row.status ?? "",
    row.evidenceLevel ?? "",
    row.sourcePage ?? "",
    row.sourceTitle ?? row.source ?? "",
    row.reason ?? "",
  ])
  const scenarioRows = insight.scenarios.map((row) => [
    row.name,
    row.thesis,
    row.evidenceLevel,
    row.filmVolume2026 ?? "",
    row.filmAsp2026 ?? "",
    row.netProfit2026 ?? "",
    row.filmVolume2027 ?? "",
    row.filmAsp2027 ?? "",
    row.netProfit2027 ?? "",
    row.impliedPe2026 ?? "",
    row.impliedPe2027 ?? "",
    row.targetPe2027 ?? "",
    row.targetMarketValue ?? "",
    row.targetPrice ?? "",
    row.upsidePct ?? "",
  ])
  const valuationMatrixRows = buildValuationSensitivityRows(insight).map((row) => [
    row.PE,
    row["悲观目标价"] ?? "",
    row["悲观市值"] ?? "",
    row["基准目标价"] ?? "",
    row["基准市值"] ?? "",
    row["基准较当前"] ?? "",
    row["乐观目标价"] ?? "",
    row["乐观市值"] ?? "",
  ])
  const corporateRows = (businessBreakdown.corporateActions ?? []).map((row) => [
    row.title ?? "",
    row.date ?? "",
    row.type ?? "",
    row.status ?? "",
    row.evidenceLevel ?? "",
    row.source ?? "",
    row.pages ?? "",
    row.filePath ?? "",
    row.terms?.transactionForm ?? "",
    row.terms?.targetName ?? "",
    row.terms?.targetBusiness ?? "",
    row.terms?.targetIndustry ?? "",
    row.terms?.counterparties ?? "",
    row.terms?.priceStatus ?? "",
    row.terms?.performanceCommitment ?? "",
    row.summary ?? "",
  ])
  const exitRows = buildExitSignalRows(profile).map((row) => [row.指标, row.观测时间, row.乐观信号, row.悲观信号])
  const validationRows = buildValidationChecklistRows({ insight, businessBreakdown }).map((row) => [
    row.事项,
    row.当前证据,
    row.下一步数据,
    row.乐观确认,
    row.证伪信号,
    row.责任状态,
  ])
  return {
    Summary: [
      ["Deep Company Research Model", "", "", COMPANY_DEEP_TEMPLATE_VERSION],
      ["Company", company.stockName ?? company.stockInput],
      ["Stock", company.tsCode ?? company.stockCode ?? ""],
      ["Latest Period", metrics.latestPeriod ?? ""],
      ["Revenue", revenue],
      ["Net Profit", netProfit],
      ["Market Value", metrics.totalMarketValue ?? ""],
      ["PE TTM", metrics.peTtm ?? ""],
      ["Close", metrics.close ?? ""],
      ["Base 2027 Target Price", insight.scenarios.find((row) => row.name === "基准")?.targetPrice ?? ""],
    ],
    "Product Lines": [
      ["Product/Segment", "Revenue", "Cost", "Revenue Share %", "Gross Margin %", "Revenue YoY %", "Volume", "ASP", "ASP Unit", "ASP Status", "Status", "Evidence Level", "Page", "Source"],
      ...productRows,
    ],
    "Subsidiary P&L": [
      ["Subsidiary", "Registered Capital", "Total Assets", "Net Assets", "Revenue", "Operating Profit", "Net Profit", "Status", "Evidence Level", "Page", "Source"],
      ...(businessBreakdown.subsidiaryProfit ?? []).map((row) => [
        row.name ?? row.subsidiary ?? "n/a",
        row.registeredCapital ?? "",
        row.totalAssets ?? "",
        row.netAssets ?? "",
        row.revenue ?? "",
        row.operatingProfit ?? "",
        row.netProfit ?? "",
        row.status ?? "",
        row.evidenceLevel ?? "",
        row.sourcePage ?? "",
        row.sourceTitle ?? row.source ?? "",
      ]),
    ],
    Capex: [
      ["Project", "Budget", "Opening Balance", "Additions", "Transferred To Fixed Assets", "Closing Balance", "Progress %", "Status", "Evidence Level", "Page", "Source", "Note"],
      ...capexRows,
    ],
    Forecast: [
      ["Metric", "Y0", "Y1 Base", "Y2 Base", "Y3 Base"],
      ["Revenue", revenue, { f: "B2*1.08", t: "n" }, { f: "C2*1.10", t: "n" }, { f: "D2*1.10", t: "n" }],
      ["Net Margin", metrics.netMarginPct ? metrics.netMarginPct / 100 : 0.1, 0.1, 0.105, 0.11],
      ["Net Profit", netProfit, { f: "C2*C3", t: "n" }, { f: "D2*D3", t: "n" }, { f: "E2*E3", t: "n" }],
    ],
    Valuation: [
      ["Scenario", "Net Profit Y1", "Target PE", "Equity Value", "Evidence Rule"],
      ["Downside", { f: "Forecast!C4*0.85", t: "n" }, Math.max(10, pe * 0.65), { f: "B2*C2", t: "n" }, "A/B only"],
      ["Base", { f: "Forecast!C4", t: "n" }, Math.max(12, pe * 0.85), { f: "B3*C3", t: "n" }, "A/B only"],
      ["Upside", { f: "Forecast!C4*1.2", t: "n" }, Math.max(15, pe * 1.05), { f: "B4*C4", t: "n" }, "C only affects scenario"],
    ],
    Sensitivity: [
      ["PE / NP", "Downside", "Base", "Upside"],
      [Math.max(10, pe * 0.65), { f: "A2*Valuation!B2", t: "n" }, { f: "A2*Valuation!B3", t: "n" }, { f: "A2*Valuation!B4", t: "n" }],
      [Math.max(12, pe * 0.85), { f: "A3*Valuation!B2", t: "n" }, { f: "A3*Valuation!B3", t: "n" }, { f: "A3*Valuation!B4", t: "n" }],
      [Math.max(15, pe * 1.05), { f: "A4*Valuation!B2", t: "n" }, { f: "A4*Valuation!B3", t: "n" }, { f: "A4*Valuation!B4", t: "n" }],
    ],
    "Scenario Model": [
      ["Scenario", "Thesis", "Evidence Level", profile.scenarioWorkbookVolume2026, profile.scenarioWorkbookAsp2026, "Net Profit 2026E", profile.scenarioWorkbookVolume2027, profile.scenarioWorkbookAsp2027, "Net Profit 2027E", "Implied PE 2026E", "Implied PE 2027E", "Target PE 2027E", "Target Market Value", "Target Price", "Upside %"],
      ...scenarioRows,
    ],
    "Corporate Actions": [
      ["Title", "Date", "Type", "Status", "Evidence Level", "Source", "Pages", "File/URL", "Transaction Form", "Target", "Target Business", "Target Industry", "Counterparties", "Price Status", "Performance Commitment", "Summary"],
      ...corporateRows,
    ],
    "Valuation Matrix": [
      ["PE", "Downside Target Price", "Downside Market Value", "Base Target Price", "Base Market Value", "Base Upside %", "Upside Target Price", "Upside Market Value"],
      ...valuationMatrixRows,
    ],
    "Exit Signals": [
      ["Metric", "Observation Time", "Bullish Signal", "Bearish Signal"],
      ...exitRows,
    ],
    "Validation Checklist": [
      ["Item", "Current Evidence", "Next Data", "Bullish Confirmation", "Bearish Disproof", "Status"],
      ...validationRows,
    ],
    Evidence: [
      ["Data Item", "Source", "Tool", "Status", "Completed At", "Evidence Level"],
      ...ledger.rows.map((row) => [row.dataItem, row.source, row.tool, row.status, row.completedAt, row.evidenceLevel]),
    ],
  }
}

export function modelPctDecimal(value, fallback = 0) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.abs(n) > 1.5 ? n / 100 : n
}

export function modelNumber(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

export function fiscalYearFromPeriod(value) {
  const raw = String(value ?? "")
  const match = raw.match(/^(\d{4})/)
  return match ? Number(match[1]) : new Date().getFullYear()
}

export function forecastYearLabels(latestPeriod) {
  const year = fiscalYearFromPeriod(latestPeriod)
  return [`${year}E`, `${year + 1}E`, `${year + 2}E`]
}

export function sortFinancialRowsAsc(rows) {
  return [...(rows ?? [])].sort((a, b) => String(a.period ?? "").localeCompare(String(b.period ?? "")))
}

export function deriveShareCountForModel(businessBreakdown) {
  const balanceRows = businessBreakdown.historicalFinancials?.balance ?? []
  const latestBalance = balanceRows[0] ?? {}
  const fromBalance = modelNumber(latestBalance.totalShare, null)
  if (fromBalance && fromBalance > 0) return fromBalance
  const metrics = businessBreakdown.keyMetrics ?? {}
  const marketValue = modelNumber(metrics.totalMarketValue, null)
  const close = modelNumber(metrics.close, null)
  if (marketValue && close && close > 0) return marketValue / close
  return null
}

export function inferFinancialModelPack(company = {}, profile = companyResearchProfile(company)) {
  const text = [
    company.stockName,
    company.secName,
    company.stockInput,
    company.stockCode,
    company.tsCode,
    company.industry,
  ].filter(Boolean).join(" ")
  if (profile.kind === "jiemei") {
    return {
      kind: "electronic-materials",
      frameworkName: "电子材料量价产能模型",
      statementCore: "三表底座 + 分产品量价 + 产能/转固/折旧 + 子公司扭亏",
      defaultSegments: [
        { name: "载带/电子封装材料", role: "现金流底座", revenueShare: 0.62, gm: 0.32, growth: [0.06, 0.07, 0.07] },
        { name: "离型膜/电子级薄膜", role: "估值弹性", revenueShare: 0.26, gm: 0.22, growth: [0.18, 0.24, 0.20] },
        { name: "其他材料", role: "补充业务", revenueShare: 0.12, gm: 0.18, growth: [0.04, 0.05, 0.05] },
      ],
      operatingDrivers: ["销量", "ASP", "良率/稼动率", "产品结构", "子公司亏损收窄", "转固折旧"],
      valuationMethods: ["PE", "FCF", "P/S"],
      defaultAssumptions: { opexRatio: 0.18, taxRate: 0.15, capexPct: 0.12, daPct: 0.06, nwcPct: 0.18, targetPe: 35, evFcf: 28, ps: 4.5, discountRate: 0.1 },
      externalDataNeeds: [
        { item: "MLCC 离型膜 ASP/客户认证", preferredSource: "公司公告/IR/客户验证", requiredFor: "乐观情景", status: "manual_input" },
        { item: "MLCC/薄膜行业价格与需求", preferredSource: "CINNO/TrendForce/产业链调研", requiredFor: "价格弹性", status: "provider_needed" },
        { item: "一致预期净利润", preferredSource: "Wind/iFinD/Choice", requiredFor: "估值交叉验证", status: "provider_needed" },
      ],
    }
  }
  if (profile.kind === "semiconductor_memory") {
    return {
      kind: "semiconductor-memory",
      frameworkName: "半导体周期/产品线模型",
      statementCore: "三表底座 + 存储价格周期 + MCU/传感器底座 + 库存/现金流",
      defaultSegments: [
        { name: "存储芯片/NOR Flash/DRAM", role: "周期弹性", revenueShare: 0.52, gm: 0.34, growth: [0.14, 0.12, 0.08] },
        { name: "微控制器 MCU", role: "现金流底座", revenueShare: 0.28, gm: 0.38, growth: [0.08, 0.08, 0.07] },
        { name: "传感器/模拟及其他", role: "结构补充", revenueShare: 0.20, gm: 0.30, growth: [0.07, 0.08, 0.08] },
      ],
      operatingDrivers: ["存储价格指数", "出货量", "库存周转", "产品结构", "晶圆/封测成本", "研发费用率"],
      valuationMethods: ["PE", "FCF", "P/S"],
      defaultAssumptions: { opexRatio: 0.22, taxRate: 0.15, capexPct: 0.09, daPct: 0.05, nwcPct: 0.22, targetPe: 42, evFcf: 35, ps: 7, discountRate: 0.11 },
      externalDataNeeds: [
        { item: "DRAM/NOR Flash 价格指数", preferredSource: "TrendForce/DRAMeXchange/CFM", requiredFor: "周期弹性", status: "provider_needed" },
        { item: "渠道库存与交期", preferredSource: "产业链调研/券商数据库", requiredFor: "毛利率修复验证", status: "manual_input" },
        { item: "一致预期 EPS/净利润", preferredSource: "Wind/iFinD/Choice", requiredFor: "估值交叉验证", status: "provider_needed" },
      ],
    }
  }
  if (/银行|证券|保险|金融/.test(text)) {
    return {
      kind: "financial-services",
      frameworkName: "金融机构资产负债/资本约束模型",
      statementCore: "净息差/手续费/信用成本/资本充足率，三表口径不同于制造业",
      defaultSegments: [
        { name: "净利息收入", role: "收入底座", revenueShare: 0.58, gm: 0.55, growth: [0.03, 0.04, 0.04] },
        { name: "手续费及佣金", role: "弹性收入", revenueShare: 0.25, gm: 0.62, growth: [0.06, 0.07, 0.07] },
        { name: "投资及其他收益", role: "波动项", revenueShare: 0.17, gm: 0.45, growth: [0.02, 0.03, 0.03] },
      ],
      operatingDrivers: ["生息资产", "净息差", "信用成本", "手续费率", "资本充足率", "拨备覆盖率"],
      valuationMethods: ["P/B", "PE", "ROE spread"],
      defaultAssumptions: { opexRatio: 0.28, taxRate: 0.25, capexPct: 0.01, daPct: 0.01, nwcPct: 0.05, targetPe: 8, evFcf: 10, ps: 2, discountRate: 0.1 },
      externalDataNeeds: [
        { item: "生息资产/净息差/不良率", preferredSource: "年报附注/Wind/iFinD", requiredFor: "金融框架", status: "provider_needed" },
        { item: "资本充足率和拨备覆盖率", preferredSource: "年报/监管指标库", requiredFor: "估值安全边际", status: "provider_needed" },
      ],
    }
  }
  if (/医药|创新药|医疗|生物/.test(text)) {
    return {
      kind: "healthcare-pharma",
      frameworkName: "医药管线/产品生命周期模型",
      statementCore: "三表底座 + 核心产品放量 + 管线概率调整 + 研发费用率",
      defaultSegments: [
        { name: "已上市核心产品", role: "现金流底座", revenueShare: 0.60, gm: 0.72, growth: [0.10, 0.10, 0.08] },
        { name: "新品/适应症扩展", role: "估值弹性", revenueShare: 0.25, gm: 0.76, growth: [0.22, 0.26, 0.22] },
        { name: "服务及其他", role: "补充业务", revenueShare: 0.15, gm: 0.45, growth: [0.06, 0.06, 0.06] },
      ],
      operatingDrivers: ["患者数", "渗透率", "价格/医保", "管线成功率", "销售费用率", "研发费用率"],
      valuationMethods: ["PE", "rNPV", "P/S"],
      defaultAssumptions: { opexRatio: 0.36, taxRate: 0.15, capexPct: 0.06, daPct: 0.03, nwcPct: 0.18, targetPe: 32, evFcf: 24, ps: 5, discountRate: 0.12 },
      externalDataNeeds: [
        { item: "核心产品销量/中标价格/医保限制", preferredSource: "公告/药智/米内/医保局", requiredFor: "产品放量模型", status: "provider_needed" },
        { item: "临床管线概率和峰值销售", preferredSource: "ClinicalTrials/公司公告/医药数据库", requiredFor: "rNPV", status: "provider_needed" },
      ],
    }
  }
  if (/消费|食品|饮料|家电|白酒|零售/.test(text)) {
    return {
      kind: "consumer",
      frameworkName: "消费品渠道/单品模型",
      statementCore: "三表底座 + SKU/渠道/价格带 + 费用投放效率",
      defaultSegments: [
        { name: "核心单品/主品牌", role: "现金流底座", revenueShare: 0.70, gm: 0.45, growth: [0.07, 0.08, 0.07] },
        { name: "新品/新渠道", role: "估值弹性", revenueShare: 0.20, gm: 0.38, growth: [0.16, 0.18, 0.15] },
        { name: "其他", role: "补充业务", revenueShare: 0.10, gm: 0.30, growth: [0.03, 0.04, 0.04] },
      ],
      operatingDrivers: ["销量", "ASP", "渠道库存", "费用率", "经销商数量", "同店/动销"],
      valuationMethods: ["PE", "FCF", "P/S"],
      defaultAssumptions: { opexRatio: 0.24, taxRate: 0.25, capexPct: 0.04, daPct: 0.03, nwcPct: 0.16, targetPe: 26, evFcf: 22, ps: 3, discountRate: 0.1 },
      externalDataNeeds: [
        { item: "渠道动销/库存/价格带", preferredSource: "渠道调研/第三方零售数据", requiredFor: "收入质量", status: "manual_input" },
        { item: "一致预期", preferredSource: "Wind/iFinD/Choice", requiredFor: "估值交叉验证", status: "provider_needed" },
      ],
    }
  }
  return {
    kind: "generic-industrial",
    frameworkName: "通用制造/成长股三表模型",
    statementCore: "三表底座 + 分业务收入/毛利率 + 营运资本 + Capex/折旧 + 多方法估值",
    defaultSegments: [
      { name: "核心业务", role: "现金流底座", revenueShare: 0.65, gm: 0.30, growth: [0.08, 0.09, 0.08] },
      { name: "高弹性业务", role: "估值弹性", revenueShare: 0.25, gm: 0.35, growth: [0.18, 0.20, 0.18] },
      { name: "其他", role: "补充业务", revenueShare: 0.10, gm: 0.22, growth: [0.04, 0.05, 0.05] },
    ],
    operatingDrivers: ["收入增长", "毛利率", "费用率", "营运资本周转", "Capex", "折旧摊销"],
    valuationMethods: ["PE", "FCF", "P/S"],
    defaultAssumptions: { opexRatio: 0.20, taxRate: 0.20, capexPct: 0.08, daPct: 0.04, nwcPct: 0.18, targetPe: 25, evFcf: 20, ps: 3, discountRate: 0.1 },
    externalDataNeeds: [
      { item: "分业务收入/毛利率官方表", preferredSource: "年报附注/CNINFO PDF", requiredFor: "分部模型", status: "manual_input" },
      { item: "一致预期净利润/收入", preferredSource: "Wind/iFinD/Choice", requiredFor: "估值交叉验证", status: "provider_needed" },
    ],
  }
}

export function buildFinancialModelV2SegmentInputs({ businessBreakdown, pack }) {
  const revenue = modelNumber(businessBreakdown.keyMetrics?.revenue, 0)
  const profile = companyResearchProfile(businessBreakdown.company)
  const productRows = (businessBreakdown.productLines ?? []).filter((row) => row.status !== "manual_needed" && modelNumber(row.revenue, null) != null)
  const specificPatterns = [
    ...(profile.coreProductPatterns ?? []),
    ...(profile.baseProductPatterns ?? []),
    /^其他$/,
  ]
  const specificProductRows = productRows.filter((row) =>
    specificPatterns.some((pattern) => pattern.test(String(row.name ?? row.product ?? row.segment ?? ""))),
  )
  const modelProductRows = specificProductRows.length ? specificProductRows : productLineRowsForReport(productRows, profile)
  if (modelProductRows.length > 0) {
    return modelProductRows.slice(0, 8).map((row, index) => {
      const defaults = pack.defaultSegments[index] ?? pack.defaultSegments[pack.defaultSegments.length - 1] ?? {}
      return {
        name: row.name ?? row.product ?? row.segment ?? defaults.name ?? "业务线",
        role: defaults.role ?? "业务线",
        revenue: modelNumber(row.revenue, 0),
        gm: modelPctDecimal(row.grossMarginPct, defaults.gm ?? modelPctDecimal(businessBreakdown.keyMetrics?.grossMarginPct, 0.3)),
        growth: defaults.growth ?? [0.08, 0.08, 0.08],
        evidenceLevel: row.evidenceLevel ?? "A",
        status: row.status ?? "extracted",
        source: row.sourceTitle ?? row.source ?? "annual_report_product_table",
        notes: row.aspStatus === "requires_review" ? "ASP/销量映射需复核" : "",
      }
    })
  }
  return pack.defaultSegments.map((segment) => ({
    name: segment.name,
    role: segment.role,
    revenue: revenue * segment.revenueShare,
    gm: segment.gm,
    growth: segment.growth,
    evidenceLevel: revenue ? "B" : "manual_needed",
    status: revenue ? "template_allocated_from_total_revenue" : "manual_needed",
    source: revenue ? "tushare.income + industry_driver_pack" : "manual_input",
    notes: revenue ? "分产品表缺失时按行业模板临时分摊，需用公告表替换" : "缺少总收入或分部收入",
  }))
}

export function buildFinancialModelV2Blueprint({ company, businessBreakdown, ledger, evidencePack, generatedAt }) {
  const profile = companyResearchProfile(company)
  const pack = inferFinancialModelPack(company, profile)
  const sourceMap = [
    { item: "三表历史数据", source: "tushare income/balancesheet/cashflow", evidenceLevel: "B", status: (businessBreakdown.historicalFinancials?.income?.length ?? 0) ? "available" : "manual_needed" },
    { item: "分产品收入/毛利率", source: "CNINFO annual report PDF tables", evidenceLevel: "A", status: businessBreakdown.validationStatus?.productLineCompleteness ?? "manual_needed" },
    { item: "子公司盈亏", source: "CNINFO annual report notes", evidenceLevel: "A", status: businessBreakdown.validationStatus?.subsidiaryCompleteness ?? "manual_needed" },
    { item: "在建工程/Capex", source: "CNINFO annual report tables + Tushare balance sheet", evidenceLevel: "A/B", status: businessBreakdown.validationStatus?.capexCompleteness ?? "manual_needed" },
    { item: "估值和市值", source: "Tushare daily_basic / local market data", evidenceLevel: "B", status: businessBreakdown.keyMetrics?.totalMarketValue ? "available" : "manual_needed" },
    ...pack.externalDataNeeds.map((row) => ({ ...row, evidenceLevel: row.status === "provider_needed" ? "B/C" : "manual_needed", source: row.preferredSource })),
  ]
  return {
    schema: `${COMPANY_FINANCIAL_MODEL_V2_VERSION}-blueprint`,
    generatedAt,
    company,
    profileKind: profile.kind,
    frameworkKind: pack.kind,
    frameworkName: pack.frameworkName,
    statementCore: pack.statementCore,
    workbookArchitecture: [
      "Cover",
      "Financial Framework",
      "Data Sources",
      "Driver Assumptions",
      "Historical IS",
      "Historical BS",
      "Historical CF",
      "Segment Drivers",
      "Working Capital",
      "Capex D&A",
      "Forecast",
      "Valuation v2",
      "Sensitivity",
      "Checks",
      "Manual Inputs",
    ],
    operatingDrivers: pack.operatingDrivers,
    valuationMethods: pack.valuationMethods,
    sourcePolicy: "A/B evidence drives actuals and base model. C/D evidence may only enter upside notes, risks, or manual-input watchlist.",
    sourceMap,
    providerStatus: {
      tushareRows: ledger.rows.filter((row) => row.source === "tushare").reduce((sum, row) => sum + (row.details?.rows ?? 0), 0),
      cninfoDownloads: ledger.rows.filter((row) => row.tool === "cninfo_pdf_download" && row.status === "success").length,
      webResults: evidencePack?.tavily?.results?.length ?? 0,
    },
  }
}

export function buildFinancialModelV2Json({ blueprint, rows }) {
  return {
    schema: COMPANY_FINANCIAL_MODEL_V2_VERSION,
    generatedAt: blueprint.generatedAt,
    company: blueprint.company,
    frameworkKind: blueprint.frameworkKind,
    frameworkName: blueprint.frameworkName,
    sheets: Object.keys(rows),
    sourcePolicy: blueprint.sourcePolicy,
    sourceMap: blueprint.sourceMap,
    formulaMap: {
      forecastRevenue: "Forecast forecast-year revenue equals SUM of Segment Drivers forecast revenue.",
      forecastFcf: "Free Cash Flow = Net Profit + D&A - Capex - Change in NWC.",
      blendedValuation: "Valuation v2 blends PE, FCF multiple, and P/S outputs with visible weights.",
      checks: "Checks sheet ties segment revenue, forecast revenue, FCF, evidence completeness, and write boundaries.",
    },
    manualInputPolicy: "Provider-needed or manual-input rows are visible in Manual Inputs and must not be silently filled by the model generator.",
  }
}

export function latestFinancialRow(rows) {
  return (rows ?? [])[0] ?? {}
}

export function buildHistoricalSheetRows(rows, metrics) {
  const ordered = sortFinancialRowsAsc(rows).slice(-5)
  const labels = ordered.map((row) => row.periodLabel ?? formatPeriod(row.period))
  const rowFor = (label, key, fallback = "") => [
    label,
    ...ordered.map((row) => row[key] ?? ""),
    fallback,
  ]
  return { labels, rowFor }
}

export function buildFinancialModelV2WorkbookRows({ company, businessBreakdown, ledger, evidencePack, blueprint }) {
  const profile = companyResearchProfile(company)
  const pack = inferFinancialModelPack(company, profile)
  const metrics = businessBreakdown.keyMetrics ?? {}
  const revenue = modelNumber(metrics.revenue, 0)
  const netProfit = modelNumber(metrics.netProfit, 0)
  const grossMargin = modelPctDecimal(metrics.grossMarginPct, pack.defaultAssumptions.grossMargin ?? 0.3)
  const netMargin = modelPctDecimal(metrics.netMarginPct, revenue ? netProfit / revenue : 0.08)
  const latestBalance = latestFinancialRow(businessBreakdown.historicalFinancials?.balance)
  const latestCashflow = latestFinancialRow(businessBreakdown.historicalFinancials?.cashflow)
  const capexPct = revenue && latestCashflow.capexCashOutflow != null
    ? Math.min(0.5, Math.abs(Number(latestCashflow.capexCashOutflow)) / revenue)
    : pack.defaultAssumptions.capexPct
  const nwcActual = modelNumber(latestBalance.accountsReceivable, 0) + modelNumber(latestBalance.inventories, 0)
  const nwcPct = revenue ? Math.min(0.8, nwcActual / revenue) : pack.defaultAssumptions.nwcPct
  const opexRatio = Math.max(0.02, grossMargin - Math.max(netMargin, 0.02))
  const targetPe = modelNumber(metrics.peTtm, pack.defaultAssumptions.targetPe) || pack.defaultAssumptions.targetPe
  const shareCount = deriveShareCountForModel(businessBreakdown)
  const forecastYears = forecastYearLabels(metrics.latestPeriod)
  const segmentInputs = buildFinancialModelV2SegmentInputs({ businessBreakdown, pack })
  const segmentEndRow = segmentInputs.length + 1
  const manualInputRows = blueprint.sourceMap
    .filter((row) => row.status === "provider_needed" || row.status === "manual_input" || row.status === "manual_needed")
    .map((row) => [row.item, row.preferredSource ?? row.source, row.requiredFor ?? "", row.status, row.evidenceLevel ?? "", ""])
  const assumptions = [
    ["Revenue Overlay", -0.05, 0, 0.08, "%", "model", "Visible override; segment growth remains primary", "optional", "Keep zero unless analyst wants top-down override"],
    ["Gross Margin Normalization", -0.02, 0, 0.03, "ppt", "A/B/C", "Used as review cue, not embedded in segment GM", "optional", ""],
    ["Opex Ratio", Math.max(0.02, opexRatio * 1.1), opexRatio, Math.max(0.02, opexRatio * 0.9), "% revenue", "B", "Derived from latest gross/net margin", "derived", ""],
    ["Tax Rate", Math.min(0.3, pack.defaultAssumptions.taxRate + 0.03), pack.defaultAssumptions.taxRate, Math.max(0.05, pack.defaultAssumptions.taxRate - 0.03), "% pretax", "template", "Industry default until official tax note is parsed", "manual_review", ""],
    ["Capex % Revenue", Math.max(capexPct * 0.7, 0.01), capexPct, Math.min(capexPct * 1.4, 0.5), "% revenue", "B", "Tushare cashflow or industry default", latestCashflow.capexCashOutflow != null ? "derived" : "manual_review", ""],
    ["D&A % Revenue", Math.max(pack.defaultAssumptions.daPct * 0.8, 0.005), pack.defaultAssumptions.daPct, pack.defaultAssumptions.daPct * 1.25, "% revenue", "template", "Needs annual report fixed asset/depreciation note", "manual_review", ""],
    ["NWC % Revenue", Math.max(nwcPct * 0.75, 0.02), nwcPct, Math.min(nwcPct * 1.25, 0.8), "% revenue", "B", "AR + inventory / revenue", "derived", ""],
    ["Target PE", Math.max(8, targetPe * 0.65), Math.max(10, targetPe * 0.85), Math.max(12, targetPe * 1.05), "x", "B", "Anchored to latest PE TTM where available", metrics.peTtm ? "derived" : "manual_review", ""],
    ["Exit FCF Multiple", Math.max(8, pack.defaultAssumptions.evFcf * 0.7), pack.defaultAssumptions.evFcf, pack.defaultAssumptions.evFcf * 1.25, "x", "template", "Fallback cross-check", "manual_review", ""],
    ["P/S Multiple", Math.max(0.5, pack.defaultAssumptions.ps * 0.7), pack.defaultAssumptions.ps, pack.defaultAssumptions.ps * 1.25, "x", "template", "Fallback cross-check", "manual_review", ""],
    ["Discount Rate", pack.defaultAssumptions.discountRate + 0.02, pack.defaultAssumptions.discountRate, Math.max(0.06, pack.defaultAssumptions.discountRate - 0.02), "%", "template", "For later DCF/rNPV extension", "manual_review", ""],
  ]
  const segmentRows = segmentInputs.map((segment, index) => {
    const row = index + 2
    return [
      segment.name,
      segment.role,
      segment.revenue,
      segment.gm,
      segment.growth?.[0] ?? 0.08,
      segment.growth?.[1] ?? 0.08,
      segment.growth?.[2] ?? 0.08,
      { f: `C${row}*(1+E${row})`, t: "n" },
      { f: `H${row}*(1+F${row})`, t: "n" },
      { f: `I${row}*(1+G${row})`, t: "n" },
      { f: `J${row}*D${row}`, t: "n" },
      segment.evidenceLevel,
      segment.status,
      segment.source,
      segment.notes,
    ]
  })
  const income = buildHistoricalSheetRows(businessBreakdown.historicalFinancials?.income, metrics)
  const balance = buildHistoricalSheetRows(businessBreakdown.historicalFinancials?.balance, metrics)
  const cashflow = buildHistoricalSheetRows(businessBreakdown.historicalFinancials?.cashflow, metrics)
  const dataSourceRows = [
    ["Item", "Source", "Evidence Level", "Status", "Required For", "Notes"],
    ...blueprint.sourceMap.map((row) => [row.item, row.source ?? row.preferredSource ?? "", row.evidenceLevel ?? "", row.status ?? "", row.requiredFor ?? "", row.notes ?? ""]),
    [],
    ["Ledger Item", "Source", "Tool", "Status", "Completed At", "Evidence Level"],
    ...ledger.rows.map((row) => [row.dataItem, row.source, row.tool, row.status, row.completedAt, row.evidenceLevel]),
  ]
  return {
    Cover: [
      ["Company Financial Model v2", "", "", COMPANY_FINANCIAL_MODEL_V2_VERSION],
      ["Company", company.stockName ?? company.stockInput],
      ["Stock", company.tsCode ?? company.stockCode ?? ""],
      ["Framework", blueprint.frameworkName],
      ["Framework Kind", blueprint.frameworkKind],
      ["Latest Period", metrics.latestPeriod ?? ""],
      ["Model Status", { f: "Checks!F2", t: "s", v: "" }],
      ["Write Policy", "No raw/** or formal wiki/** writes; artifacts only under .llm-wiki/company-research"],
      ["Evidence Rule", blueprint.sourcePolicy],
    ],
    "Financial Framework": [
      ["Section", "Design"],
      ["Model architecture", blueprint.statementCore],
      ["Industry driver pack", blueprint.frameworkKind],
      ["Operating drivers", blueprint.operatingDrivers.join(", ")],
      ["Valuation methods", blueprint.valuationMethods.join(", ")],
      ["Universal base", "Historical IS/BS/CF, forecast, valuation, checks, source map"],
      ["Company override", "Use official product-line tables and annual-report notes when available; otherwise keep manual_input/provider_needed visible"],
    ],
    "Data Sources": dataSourceRows,
    "Driver Assumptions": [
      ["Driver", "Downside", "Base", "Upside", "Unit", "Evidence", "Source", "Status", "Notes"],
      ...assumptions,
    ],
    "Historical IS": [
      ["Metric", ...income.labels, "Source"],
      income.rowFor("Revenue", "revenue", "tushare.income"),
      income.rowFor("Operating Profit", "operatingProfit", "tushare.income"),
      income.rowFor("Net Profit", "netProfit", "tushare.income"),
      income.rowFor("R&D Expense", "rdExpense", "tushare.income"),
      ["Net Margin %", ...sortFinancialRowsAsc(businessBreakdown.historicalFinancials?.income).slice(-5).map((row) => row.revenue ? modelNumber(row.netProfit, 0) / row.revenue : ""), "derived"],
    ],
    "Historical BS": [
      ["Metric", ...balance.labels, "Source"],
      balance.rowFor("Total Assets", "totalAssets", "tushare.balancesheet"),
      balance.rowFor("Total Liabilities", "totalLiabilities", "tushare.balancesheet"),
      balance.rowFor("Fixed Assets", "fixedAssets", "tushare.balancesheet"),
      balance.rowFor("Construction in Progress", "constructionInProgress", "tushare.balancesheet"),
      balance.rowFor("Inventories", "inventories", "tushare.balancesheet"),
      balance.rowFor("Accounts Receivable", "accountsReceivable", "tushare.balancesheet"),
      balance.rowFor("Share Count", "totalShare", "tushare.balancesheet"),
    ],
    "Historical CF": [
      ["Metric", ...cashflow.labels, "Source"],
      cashflow.rowFor("Operating Cash Flow", "operatingCashflow", "tushare.cashflow"),
      cashflow.rowFor("Capex Cash Outflow", "capexCashOutflow", "tushare.cashflow"),
      cashflow.rowFor("Free Cash Flow", "freeCashflow", "tushare.cashflow/manual derived"),
    ],
    "Segment Drivers": [
      ["Segment", "Role", "Actual Revenue", "Actual GM %", `${forecastYears[0]} Growth`, `${forecastYears[1]} Growth`, `${forecastYears[2]} Growth`, `${forecastYears[0]} Revenue`, `${forecastYears[1]} Revenue`, `${forecastYears[2]} Revenue`, `${forecastYears[2]} Gross Profit`, "Evidence", "Status", "Source", "Notes"],
      ...segmentRows,
    ],
    "Working Capital": [
      ["Metric", "Actual", "% Revenue", forecastYears[0], forecastYears[1], forecastYears[2], "Source/Note"],
      ["Accounts Receivable", modelNumber(latestBalance.accountsReceivable, 0), revenue ? modelNumber(latestBalance.accountsReceivable, 0) / revenue : 0, { f: "Forecast!C2*C2", t: "n" }, { f: "Forecast!D2*C2", t: "n" }, { f: "Forecast!E2*C2", t: "n" }, "tushare.balancesheet"],
      ["Inventory", modelNumber(latestBalance.inventories, 0), revenue ? modelNumber(latestBalance.inventories, 0) / revenue : 0, { f: "Forecast!C2*C3", t: "n" }, { f: "Forecast!D2*C3", t: "n" }, { f: "Forecast!E2*C3", t: "n" }, "tushare.balancesheet"],
      ["Operating NWC", nwcActual, revenue ? nwcActual / revenue : 0, { f: "D2+D3", t: "n" }, { f: "E2+E3", t: "n" }, { f: "F2+F3", t: "n" }, "AR + inventory proxy"],
      ["NWC % Revenue", revenue ? nwcActual / revenue : pack.defaultAssumptions.nwcPct, { f: "B4/Forecast!B2", t: "n" }, { f: "D4/Forecast!C2", t: "n" }, { f: "E4/Forecast!D2", t: "n" }, { f: "F4/Forecast!E2", t: "n" }, "proxy"],
      ["Change in NWC", "", "", { f: "D4-B4", t: "n" }, { f: "E4-D4", t: "n" }, { f: "F4-E4", t: "n" }, "cash-flow deduction"],
    ],
    "Capex D&A": [
      ["Metric", "Actual", "% Revenue", forecastYears[0], forecastYears[1], forecastYears[2], "Source/Note"],
      ["Fixed Assets", modelNumber(latestBalance.fixedAssets, 0), revenue ? modelNumber(latestBalance.fixedAssets, 0) / revenue : 0, "", "", "", "tushare.balancesheet"],
      ["Construction in Progress", modelNumber(latestBalance.constructionInProgress, 0), revenue ? modelNumber(latestBalance.constructionInProgress, 0) / revenue : 0, "", "", "", "tushare.balancesheet / annual-report capex table"],
      ["Capex % Revenue", "", { f: "'Driver Assumptions'!C6", t: "n" }, { f: "C4", t: "n" }, { f: "C4", t: "n" }, { f: "C4", t: "n" }, "assumption"],
      ["D&A % Revenue", "", { f: "'Driver Assumptions'!C7", t: "n" }, { f: "C5", t: "n" }, { f: "C5", t: "n" }, { f: "C5", t: "n" }, "assumption"],
      ["Forecast Capex", "", "", { f: "Forecast!C2*D4", t: "n" }, { f: "Forecast!D2*E4", t: "n" }, { f: "Forecast!E2*F4", t: "n" }, "revenue linked"],
      ["Forecast D&A", "", "", { f: "Forecast!C2*D5", t: "n" }, { f: "Forecast!D2*E5", t: "n" }, { f: "Forecast!E2*F5", t: "n" }, "revenue linked"],
      ["Depreciation Pressure", "", "", { f: "IF(Forecast!C3=0,0,D7/Forecast!C3)", t: "n" }, { f: "IF(Forecast!D3=0,0,E7/Forecast!D3)", t: "n" }, { f: "IF(Forecast!E3=0,0,F7/Forecast!E3)", t: "n" }, "D&A / gross profit"],
    ],
    Forecast: [
      ["Metric", "Actual", forecastYears[0], forecastYears[1], forecastYears[2], "Evidence/Formula"],
      ["Revenue", revenue, { f: `SUM('Segment Drivers'!H2:H${segmentEndRow})`, t: "n" }, { f: `SUM('Segment Drivers'!I2:I${segmentEndRow})`, t: "n" }, { f: `SUM('Segment Drivers'!J2:J${segmentEndRow})`, t: "n" }, "segment driver sum"],
      ["Gross Profit", revenue * grossMargin, { f: `SUMPRODUCT('Segment Drivers'!H2:H${segmentEndRow},'Segment Drivers'!D2:D${segmentEndRow})`, t: "n" }, { f: `SUMPRODUCT('Segment Drivers'!I2:I${segmentEndRow},'Segment Drivers'!D2:D${segmentEndRow})`, t: "n" }, { f: `SUMPRODUCT('Segment Drivers'!J2:J${segmentEndRow},'Segment Drivers'!D2:D${segmentEndRow})`, t: "n" }, "segment revenue * GM"],
      ["Gross Margin %", grossMargin, { f: "IF(C2=0,0,C3/C2)", t: "n" }, { f: "IF(D2=0,0,D3/D2)", t: "n" }, { f: "IF(E2=0,0,E3/E2)", t: "n" }, "derived"],
      ["Opex Ratio", opexRatio, { f: "'Driver Assumptions'!C4", t: "n" }, { f: "'Driver Assumptions'!C4", t: "n" }, { f: "'Driver Assumptions'!C4", t: "n" }, "assumption"],
      ["EBIT", revenue * Math.max(grossMargin - opexRatio, 0), { f: "C2*(C4-C5)", t: "n" }, { f: "D2*(D4-D5)", t: "n" }, { f: "E2*(E4-E5)", t: "n" }, "revenue * spread"],
      ["Tax Rate", pack.defaultAssumptions.taxRate, { f: "'Driver Assumptions'!C5", t: "n" }, { f: "'Driver Assumptions'!C5", t: "n" }, { f: "'Driver Assumptions'!C5", t: "n" }, "assumption"],
      ["Net Profit", netProfit, { f: "C6*(1-C7)", t: "n" }, { f: "D6*(1-D7)", t: "n" }, { f: "E6*(1-E7)", t: "n" }, "EBIT after tax"],
      ["D&A", "", { f: "'Capex D&A'!D7", t: "n" }, { f: "'Capex D&A'!E7", t: "n" }, { f: "'Capex D&A'!F7", t: "n" }, "Capex D&A"],
      ["Capex", Math.abs(modelNumber(latestCashflow.capexCashOutflow, 0)), { f: "'Capex D&A'!D6", t: "n" }, { f: "'Capex D&A'!E6", t: "n" }, { f: "'Capex D&A'!F6", t: "n" }, "Capex D&A"],
      ["Change in NWC", "", { f: "'Working Capital'!D6", t: "n" }, { f: "'Working Capital'!E6", t: "n" }, { f: "'Working Capital'!F6", t: "n" }, "Working Capital"],
      ["Free Cash Flow", modelNumber(latestCashflow.operatingCashflow, 0) - Math.abs(modelNumber(latestCashflow.capexCashOutflow, 0)), { f: "C8+C9-C10-C11", t: "n" }, { f: "D8+D9-D10-D11", t: "n" }, { f: "E8+E9-E10-E11", t: "n" }, "NI + D&A - capex - delta NWC"],
    ],
    "Valuation v2": [
      ["Method", `${forecastYears[1]} Metric`, "Multiple", "Equity Value", "Weight", "Weighted Value", "Evidence Rule", "Notes"],
      ["PE", { f: "Forecast!D8", t: "n" }, { f: "'Driver Assumptions'!C9", t: "n" }, { f: "B2*C2", t: "n" }, 0.5, { f: "D2*E2", t: "n" }, "A/B base; C only in note", "净利润口径"],
      ["FCF", { f: "Forecast!D12", t: "n" }, { f: "'Driver Assumptions'!C10", t: "n" }, { f: "B3*C3", t: "n" }, 0.3, { f: "D3*E3", t: "n" }, "A/B base", "现金流交叉验证"],
      ["P/S", { f: "Forecast!D2", t: "n" }, { f: "'Driver Assumptions'!C11", t: "n" }, { f: "B4*C4", t: "n" }, 0.2, { f: "D4*E4", t: "n" }, "B/template", "成长股辅助"],
      [],
      ["Blended Equity Value", "", "", { f: "SUM(F2:F4)", t: "n" }],
      ["Share Count", "", "", shareCount ?? ""],
      ["Target Price", "", "", { f: 'IF(D7>0,D6/D7,"")', t: "n" }],
      ["Current Market Value", "", "", metrics.totalMarketValue ?? ""],
      ["Upside %", "", "", { f: 'IF(D9>0,D6/D9-1,"")', t: "n" }],
    ],
    Sensitivity: [
      ["Target PE / Net Profit", "Downside NP", "Base NP", "Upside NP"],
      [Math.max(8, targetPe * 0.65), { f: 'IF(\'Valuation v2\'!$D$7>0,A2*Forecast!$D$8*0.85/\'Valuation v2\'!$D$7,"")', t: "n" }, { f: 'IF(\'Valuation v2\'!$D$7>0,A2*Forecast!$D$8/\'Valuation v2\'!$D$7,"")', t: "n" }, { f: 'IF(\'Valuation v2\'!$D$7>0,A2*Forecast!$D$8*1.15/\'Valuation v2\'!$D$7,"")', t: "n" }],
      [Math.max(10, targetPe * 0.85), { f: 'IF(\'Valuation v2\'!$D$7>0,A3*Forecast!$D$8*0.85/\'Valuation v2\'!$D$7,"")', t: "n" }, { f: 'IF(\'Valuation v2\'!$D$7>0,A3*Forecast!$D$8/\'Valuation v2\'!$D$7,"")', t: "n" }, { f: 'IF(\'Valuation v2\'!$D$7>0,A3*Forecast!$D$8*1.15/\'Valuation v2\'!$D$7,"")', t: "n" }],
      [Math.max(12, targetPe * 1.05), { f: 'IF(\'Valuation v2\'!$D$7>0,A4*Forecast!$D$8*0.85/\'Valuation v2\'!$D$7,"")', t: "n" }, { f: 'IF(\'Valuation v2\'!$D$7>0,A4*Forecast!$D$8/\'Valuation v2\'!$D$7,"")', t: "n" }, { f: 'IF(\'Valuation v2\'!$D$7>0,A4*Forecast!$D$8*1.15/\'Valuation v2\'!$D$7,"")', t: "n" }],
    ],
    Checks: [
      ["Check", "Actual", "Expected", "Difference", "Tolerance", "Status", "Notes"],
      ["Overall model status", "", "", "", "", { f: 'IF(COUNTIF(F3:F20,"REVIEW")=0,"OK","REVIEW")', t: "s", v: "" }, "Visible on Cover"],
      ["Product revenue ties to reported revenue", { f: `SUM('Segment Drivers'!C2:C${segmentEndRow})`, t: "n" }, { f: "Forecast!B2", t: "n" }, { f: "B3-C3", t: "n" }, { f: "MAX(ABS(C3)*0.05,1)", t: "n" }, { f: 'IF(OR(C3=0,ABS(D3)<=E3),"OK","REVIEW")', t: "s", v: "" }, "If template allocation is used this should tie; official product table may require review"],
      ["Forecast revenue sourced from segment drivers", { f: "Forecast!C2", t: "n" }, { f: `SUM('Segment Drivers'!H2:H${segmentEndRow})`, t: "n" }, { f: "B4-C4", t: "n" }, 1, { f: 'IF(ABS(D4)<=E4,"OK","REVIEW")', t: "s", v: "" }, ""],
      ["FCF formula tie", { f: "Forecast!C12", t: "n" }, { f: "Forecast!C8+Forecast!C9-Forecast!C10-Forecast!C11", t: "n" }, { f: "B5-C5", t: "n" }, 1, { f: 'IF(ABS(D5)<=E5,"OK","REVIEW")', t: "s", v: "" }, ""],
      ["Evidence/manual input count", manualInputRows.length, 0, { f: "B6-C6", t: "n" }, 0, { f: 'IF(B6=0,"OK","REVIEW")', t: "s", v: "" }, "REVIEW is expected when professional data is not connected"],
      ["Write boundary", 0, 0, { f: "B7-C7", t: "n" }, 0, { f: 'IF(B7=C7,"OK","REVIEW")', t: "s", v: "" }, "No raw/wiki formal writes"],
    ],
    "Manual Inputs": [
      ["Input", "Preferred Source", "Required For", "Status", "Evidence Level", "Analyst Fill"],
      ...manualInputRows,
    ],
  }
}

export function buildDeepQualityAudit({ company, documentExtract, businessBreakdown, deepReport, deepModelRows }) {
  const profile = companyResearchProfile(company ?? businessBreakdown.company)
  const report = String(deepReport ?? "")
  const sheetNames = Object.keys(deepModelRows ?? {})
  const hasSheet = (name) => sheetNames.includes(name)
  const hasProductLines = (businessBreakdown.productLines ?? []).some((row) => row.status === "extracted")
  const hasSubsidiary = (businessBreakdown.subsidiaryProfit ?? []).some((row) => row.status === "extracted")
  const hasCapex = (businessBreakdown.capex ?? []).some((row) => row.status === "extracted")
  const hasCorporateTerms = (businessBreakdown.corporateActions ?? []).some((row) => Object.keys(row.terms ?? {}).length >= 4)
  const hasOfficialTables = (documentExtract.summary?.keyTables ?? 0) > 0 && (documentExtract.summary?.keyRows ?? 0) > 0
  const hasPriceOrMarginLine = profile.kind === "jiemei"
    ? (businessBreakdown.productLines ?? []).some((row) => row.asp != null)
    : hasProductLines && (businessBreakdown.productLines ?? []).some((row) => row.grossMarginPct != null)
  const capexReviewed = hasCapex || (profile.kind !== "jiemei" && businessBreakdown.validationStatus?.capexCompleteness === "cross_check")
  const requirements = [
    { id: "data_pull_confirmation", label: "数据拉取确认", completed: report.includes("## 数据拉取确认"), evidence: "deep report section" },
    { id: "evidence_confidence", label: "数据可信度说明", completed: report.includes("## 数据可信度说明"), evidence: "deep report section" },
    { id: "opening_conclusion", label: "开篇结论", completed: report.includes("## 开篇结论"), evidence: "deep report section" },
    { id: "official_table_extraction", label: "公告原文表格抽取", completed: hasOfficialTables, evidence: `${documentExtract.summary?.keyTables ?? 0} key tables / ${documentExtract.summary?.keyRows ?? 0} key rows` },
    { id: "product_breakdown", label: "分产品收入和毛利率", completed: hasProductLines && report.includes("分产品收入与毛利率"), evidence: businessBreakdown.validationStatus?.productLineCompleteness ?? "unknown" },
    { id: "price_or_asp_inference", label: profile.kind === "jiemei" ? "ASP 独立推算" : "价格/毛利率线索", completed: hasPriceOrMarginLine && (report.includes("ASP 独立推算") || report.includes("价格/毛利率线索")), evidence: profile.kind === "jiemei" ? "product line ASP field" : "product line gross margin field" },
    { id: "subsidiary_profit", label: "子公司盈亏核实", completed: hasSubsidiary && report.includes("子公司盈亏核实"), evidence: businessBreakdown.validationStatus?.subsidiaryCompleteness ?? "unknown" },
    { id: "capex_capacity", label: "产能/在建工程/折旧压力", completed: capexReviewed && report.includes("产能规划与折旧压力"), evidence: businessBreakdown.validationStatus?.capexCompleteness ?? "unknown" },
    { id: "cashflow_base_module", label: "核心业务/现金流底座", completed: report.includes("载带业务（稳定现金牛）") || report.includes("核心业务与现金流底座"), evidence: "deep report section" },
    { id: "corporate_action_terms", label: "重大事项/收购条款", completed: hasCorporateTerms && report.includes("预案关键条款自动抽取"), evidence: businessBreakdown.validationStatus?.corporateActionCompleteness ?? "unknown" },
    { id: "scenario_model", label: "三情景财务模型", completed: report.includes("三年财务模型（三情景）") && hasSheet("Scenario Model"), evidence: "report section + Scenario Model sheet" },
    { id: "valuation_matrix", label: "PE/市值敏感性矩阵", completed: report.includes("PE/市值敏感性矩阵") && hasSheet("Valuation Matrix"), evidence: "report section + Valuation Matrix sheet" },
    { id: "risk_table", label: "核心风险", completed: report.includes("核心风险"), evidence: "deep report section" },
    { id: "exit_signals", label: "退出信号体系", completed: report.includes("退出信号体系") && hasSheet("Exit Signals"), evidence: "report section + Exit Signals sheet" },
    { id: "validation_checklist", label: "验证清单", completed: report.includes("验证清单") && hasSheet("Validation Checklist"), evidence: "report section + Validation Checklist sheet" },
    { id: "wiki_candidates", label: "wiki 写入候选", completed: report.includes("wiki 写入候选"), evidence: "deep report section" },
    { id: "safe_write_policy", label: "安全写入边界", completed: true, evidence: "company-research writes under .llm-wiki/company-research only" },
  ]
  const completed = requirements.filter((item) => item.completed).length
  const score = requirements.length ? completed / requirements.length : 0
  return {
    schema: "company-deep-quality-audit-v1",
    generatedAt: nowLocalTimestamp(),
    targetScore: 0.9,
    score: roundMetric(score, 4),
    completed,
    total: requirements.length,
    pass: score >= 0.9,
    requirements,
    residualRisks: [
      hasCorporateTerms ? null : "重大事项只命中标题或 PDF 摘要，未抽出足够交易条款。",
      hasOfficialTables ? null : "公告 PDF 未抽出足够关键表格。",
      "自动报告仍需人工复核 PDF 页码、ASP 口径和情景假设，不直接等同于可发布投研报告。",
    ].filter(Boolean),
  }
}

export async function buildDeepCompanyResearchArtifacts({ projectPath, outputDir, paths, company, financials, ledger, evidencePack, downloads, wikiCandidatesMarkdown, generatedAt, options = {} }) {
  const documentExtract = buildDeepDocumentExtract({ projectPath, downloads, options })
  const businessBreakdown = buildDeepBusinessBreakdown({ projectPath, company, financials, evidencePack, documentExtract })
  const deepReport = buildDeepCompanyReportMarkdown({
    company,
    ledger,
    documentExtract,
    businessBreakdown,
    evidencePack,
    wikiCandidatesMarkdown,
    generatedAt,
  })
  const deepChecklist = buildDeepReviewChecklist({ documentExtract, businessBreakdown })
  const deepModelRows = buildDeepCompanyWorkbookRows({ company, businessBreakdown, ledger, evidencePack })
  const financialModelV2Blueprint = buildFinancialModelV2Blueprint({ company, businessBreakdown, ledger, evidencePack, generatedAt })
  const financialModelV2Rows = buildFinancialModelV2WorkbookRows({
    company,
    businessBreakdown,
    ledger,
    evidencePack,
    blueprint: financialModelV2Blueprint,
  })
  const financialModelV2Json = buildFinancialModelV2Json({ blueprint: financialModelV2Blueprint, rows: financialModelV2Rows })
  const deepQualityAudit = buildDeepQualityAudit({ company, documentExtract, businessBreakdown, deepReport, deepModelRows })
  const deepPaths = {
    documentExtract: path.join(outputDir, "document-extract.json"),
    businessBreakdown: path.join(outputDir, "business-breakdown.json"),
    deepReport: path.join(outputDir, "deep-company-report.md"),
    deepModelXlsx: path.join(outputDir, "deep-company-model.xlsx"),
    financialModelV2Xlsx: path.join(outputDir, "financial-model-v2.xlsx"),
    financialModelV2Json: path.join(outputDir, "financial-model-v2.json"),
    financialModelV2Template: path.join(outputDir, "financial-model-v2-template.json"),
    deepChecklist: path.join(outputDir, "deep-review-checklist.md"),
    deepQualityAudit: path.join(outputDir, "deep-quality-audit.json"),
  }
  await writeJson(deepPaths.documentExtract, documentExtract)
  await writeJson(deepPaths.businessBreakdown, businessBreakdown)
  await fs.writeFile(deepPaths.deepReport, deepReport, "utf8")
  await writeCompanyWorkbook(deepPaths.deepModelXlsx, deepModelRows)
  await writeCompanyWorkbook(deepPaths.financialModelV2Xlsx, financialModelV2Rows)
  await writeJson(deepPaths.financialModelV2Json, financialModelV2Json)
  await writeJson(deepPaths.financialModelV2Template, financialModelV2Blueprint)
  await fs.writeFile(deepPaths.deepChecklist, deepChecklist, "utf8")
  await writeJson(deepPaths.deepQualityAudit, deepQualityAudit)
  return {
    enabled: true,
    templateVersion: COMPANY_DEEP_TEMPLATE_VERSION,
    financialModelVersion: COMPANY_FINANCIAL_MODEL_V2_VERSION,
    providerPolicy: documentExtract.providerPolicy,
    outputs: Object.fromEntries(Object.entries(deepPaths).map(([key, value]) => [key, projectRelative(projectPath, value)])),
    summary: {
      documents: documentExtract.summary,
      financialModelKind: financialModelV2Blueprint.frameworkKind,
      productLineCompleteness: businessBreakdown.validationStatus.productLineCompleteness,
      subsidiaryCompleteness: businessBreakdown.validationStatus.subsidiaryCompleteness,
      capexCompleteness: businessBreakdown.validationStatus.capexCompleteness,
      corporateActionCompleteness: businessBreakdown.validationStatus.corporateActionCompleteness,
      noInventedFigures: businessBreakdown.validationStatus.noInventedFigures,
      qualityScore: deepQualityAudit.score,
      qualityPass: deepQualityAudit.pass,
    },
  }
}

export function hasInvestmentBankingTrigger(businessBreakdown = {}) {
  const actions = Array.isArray(businessBreakdown.corporateActions) ? businessBreakdown.corporateActions : []
  return actions.some((row) => {
    if (row.status === "manual_needed" || row.evidenceLevel !== "A") return false
    const text = [
      row.title,
      row.type,
      row.status,
      row.summary,
      row.filePath,
      row.terms?.targetName,
      row.terms?.transactionForm,
      row.terms?.priceStatus,
      row.terms?.fundingSource,
      row.terms?.paymentMethod,
    ].filter(Boolean).join(" ")
    if (!text.trim()) return false
    const noisyOnly = /异常波动|业绩说明会|年度报告摘要|利润分配|分红|股东大会|问询函/.test(text)
      && !/收购|并购|重组|定增|发行股份|可转债|资产购买|交易对方|标的|股权|对价|募集/.test(text)
    if (noisyOnly) return false
    return /收购|并购|重组|定增|发行股份|可转债|资产购买|交易对方|标的|股权|业绩承诺|商誉|对价|募集配套资金|资本运作|融资/.test(text)
  })
}

function companyPluginReviewTag(plugin) {
  if (plugin === "data-analytics") return "[@data-analytics](plugin://data-analytics@openai-curated-remote)"
  if (plugin === "public-equity-investing") return "[@public-equity-investing](plugin://public-equity-investing@openai-curated-remote)"
  if (plugin === "investment-banking") return "[@investment-banking](plugin://investment-banking@openai-curated-remote)"
  return `@${plugin}`
}

function companyPluginReviewPurpose(plugin) {
  if (plugin === "data-analytics") {
    return [
      "你是 Data Analytics 插件评审员，重点检查数据表、财务模型、口径、单位、来源映射和可复算性。",
      "请判断模型是否真的使用了 A/B 证据，是否存在单位错配、市场值口径错误、未校验公式或 manual_needed 被误当事实。",
      "请输出：一页结论、数据/模型质量评分、关键阻断项、可自动修复项、需要人工复核项、下一步数据接口建议。",
    ].join("\n")
  }
  if (plugin === "public-equity-investing") {
    return [
      "你是 Public Equity Investing 插件评审员，重点检查上市公司投资框架、三年驱动、估值、催化、风险证伪和仓位友好表达。",
      "请区分已验证事实、模型假设、乐观情景、交易催化、风险证伪，避免把网页/研报观点写成官方事实。",
      "请输出：投资结论质量、需要补充的数据、估值框架是否可用、核心多空争议、可追踪验证清单。",
    ].join("\n")
  }
  if (plugin === "investment-banking") {
    return [
      "你是 Investment Banking 插件评审员，只围绕公告中的交易/融资/并购/重组事项做投行式条款与影响复核。",
      "请检查交易结构、对价、估值、业绩承诺、资金来源、审批进度、稀释/商誉/整合风险，不能把普通公司研究改写成交易执行项目。",
      "请输出：交易事项摘要、条款缺口、估值与财务影响、关键审批节点、尽调清单和不能下结论的部分。",
    ].join("\n")
  }
  return "请评审公司深度研究产物。"
}

function companyPluginReviewPrompt({ plugin, company, inputRelativePath, relativePaths, summary }) {
  const tag = companyPluginReviewTag(plugin)
  const purpose = companyPluginReviewPurpose(plugin)
  return [
    `${tag}`,
    "",
    purpose,
    "",
    "请真实使用上面标记的插件工作流完成评审；不要只说“已参考插件”。",
    "你可以读取下列本地文件，但不要编辑、创建或删除任何文件；最终只返回 Markdown 评审正文。",
    "",
    `公司：${company.stockName ?? company.secName ?? company.stockInput ?? ""} ${company.tsCode ?? company.stockCode ?? ""}`.trim(),
    `插件评审输入包：${inputRelativePath}`,
    "",
    "核心产物：",
    ...Object.entries(relativePaths).map(([key, value]) => `- ${key}: ${value}`),
    "",
    "当前自动摘要：",
    "```json",
    JSON.stringify(summary, null, 2),
    "```",
    "",
    "输出格式：",
    "# 插件评审结论",
    "## 结论",
    "## 关键发现",
    "## 数据和模型问题",
    "## 可执行修正建议",
    "## 仍需人工确认",
  ].join("\n")
}

function readTextIfAvailable(filePath) {
  if (!filePath) return ""
  try {
    return readFileSync(filePath, "utf8")
  } catch {
    return ""
  }
}

async function runCompanyPluginReviewCall({ plugin, prompt, outputPath, projectPath, options }) {
  const startedMs = Date.now()
  if (options.pluginReviewer) {
    const text = await options.pluginReviewer({
      plugin,
      prompt,
      outputPath,
      projectPath,
    })
    const finalText = String(text ?? "").trim()
    if (!finalText) throw new Error(`pluginReviewer returned empty output for ${plugin}`)
    await ensureDirectory(path.dirname(outputPath))
    await fs.writeFile(outputPath, `${finalText}\n`, "utf8")
    return {
      status: "success",
      mode: "injected-reviewer",
      durationMs: Date.now() - startedMs,
    }
  }
  await requestCodexExecText({
    stage: `company-plugin-review-${plugin}`,
    prompt,
    instructions: [
      "You are a plugin-backed reviewer for Trading Review Wiki company deep-research artifacts.",
      "Use the explicitly tagged plugin workflow in the prompt. Read local artifacts when needed.",
      "Do not edit files. Return only the requested Markdown review.",
    ].join("\n"),
    model: options.pluginReviewModel ?? options.model,
    prepared: { projectPath },
    outputPath,
    codexBin: options.codexBin,
    codexProfile: options.codexProfile,
    codexProfileV2: options.codexProfileV2,
    codexTimeoutMs: parsePositiveInteger(
      options.pluginReviewTimeoutMs ?? options["plugin-review-timeout-ms"],
      parsePositiveInteger(options.codexTimeoutMs, 10 * 60 * 1000),
    ),
  })
  return {
    status: "success",
    mode: "codex-plugin-subprocess",
    durationMs: Date.now() - startedMs,
  }
}

function companyPluginLedDataAnalyticsPrompt({ company, inputRelativePath, relativePaths, summary }) {
  return [
    companyPluginReviewTag("data-analytics"),
    "",
    "请作为 Data Analytics 直接参与公司深度研究的第一阶段，不要评审主程序报告，而是基于证据包、底表和模型模板做数据/模型分析。",
    "你可以读取下列本地文件，但不要编辑、创建或删除任何文件；最终只返回 Markdown 分析正文。",
    "目标是给 Public Equity 主报告提供可直接引用的完整数据底稿，而不是一页摘要。请展开表格口径、字段来源、公式风险、模型可用项和不可用项。",
    "如果表格抽取或字段不足，请保留 manual_needed/provider_needed，并说明缺口会影响哪些预测、估值或结论；不要用估算填补官方事实。",
    "",
    `公司：${company.stockName ?? company.secName ?? company.stockInput ?? ""} ${company.tsCode ?? company.stockCode ?? ""}`.trim(),
    `插件主导输入包：${inputRelativePath}`,
    "",
    "核心输入：",
    ...Object.entries(relativePaths).map(([key, value]) => `- ${key}: ${value}`),
    "",
    "自动摘要：",
    "```json",
    JSON.stringify(summary, null, 2),
    "```",
    "",
    "输出格式：",
    "# Data Analytics 模型分析",
    "## 结论",
    "## 数据源与证据等级",
    "## 可用 A/B 证据",
    "## 年报/公告表格抽取状态",
    "## 表格与口径问题",
    "## 模型 tie-out 与公式风险",
    "## 三表质量与现金流重算风险",
    "## 分部、子公司、产能和 capex 可用底稿",
    "## 可用于 Public Equity 的修正输入",
    "## 仍需补数",
  ].join("\n")
}

function companyPluginLedPublicEquityPrompt({ company, inputRelativePath, relativePaths, summary, dataAnalyticsText, investmentBankingText }) {
  return [
    companyPluginReviewTag("public-equity-investing"),
    "",
    "请作为 Public Equity Investing 主分析师，直接基于本地证据包、底表、模型模板和 Data Analytics 模型分析，生成公司深度研究主报告。",
    "不要把这当成对主程序 deep report 的评审；你是主报告作者。请严格区分已验证事实、模型假设、乐观情景、催化、风险证伪。",
    "如果证据不足以发布正式投资结论，请输出内部候选稿并明确发布门禁；不要硬凑目标价或买入结论。",
    "你可以读取下列本地文件，但不要编辑、创建或删除任何文件；最终只返回 Markdown 主报告正文。",
    "",
    "完整度硬要求：",
    "- 这是一份“完整深度研究底稿”，不是摘要、不是评审意见、不是只列阻断项。",
    "- 即使发布门禁 blocked，也必须完整展开业务、产品、财务、模型、估值、催化、风险、验证清单和 wiki 候选。",
    "- 报告建议不少于 220 行；若证据缺失，用 `manual_needed` 写出缺口、影响和补数方法，而不是省略章节。",
    "- 至少包含 10 张 Markdown 表格：数据拉取确认、核心财务、业务结构、分部模型、子公司/组织、capex/D&A、营运资本、估值矩阵、催化清单、风险证伪、待补数据可任选组合。",
    "- 数字必须标注证据等级 A/B/C/D 或来源文件类型；C/D 不能当作基础事实。",
    "- 不要输出“无法完整报告所以略写”；缺口也是报告内容的一部分。",
    "",
    `公司：${company.stockName ?? company.secName ?? company.stockInput ?? ""} ${company.tsCode ?? company.stockCode ?? ""}`.trim(),
    `插件主导输入包：${inputRelativePath}`,
    "",
    "核心输入：",
    ...Object.entries(relativePaths).map(([key, value]) => `- ${key}: ${value}`),
    "",
    "自动摘要：",
    "```json",
    JSON.stringify(summary, null, 2),
    "```",
    "",
    "Data Analytics 模型分析摘要：",
    dataAnalyticsText || "(missing)",
    investmentBankingText ? ["", "Investment Banking 交易事项分析摘要：", investmentBankingText].join("\n") : "",
    "",
    "输出格式：",
    "# 插件主导公司深度研究报告",
    "## 0. 发布门禁与报告使用说明",
    "## 1. 一页结论",
    "## 2. 数据拉取确认与证据等级",
    "## 3. 公司画像、历史沿革与股权/治理",
    "## 4. 业务结构全景",
    "## 5. 产品/服务收入、毛利率、销量/ASP/产能拆解",
    "## 6. 子公司、区域与组织口径核实",
    "## 7. 年报附注、公告原文与关键表格摘录",
    "## 8. 行业空间、竞争格局与同业对标",
    "## 9. 技术能力、供应链、客户与订单验证",
    "## 10. 财务三表与质量分析",
    "## 11. 分部模型与三年预测",
    "## 12. 估值框架、SOTP 与敏感性矩阵",
    "## 13. 催化剂、跟踪指标与验证节奏",
    "## 14. 风险、反证与下修条件",
    "## 15. 交易含义与仓位观察",
    "## 16. 仍需补数和人工复核清单",
    "## 17. wiki 写入候选",
    "## 附录 A. 证据索引",
    "## 附录 B. 模型检查与口径说明",
  ].filter(Boolean).join("\n")
}

const COMPANY_PLUGIN_LED_REQUIRED_REPORT_SECTIONS = [
  "## 0. 发布门禁与报告使用说明",
  "## 1. 一页结论",
  "## 2. 数据拉取确认与证据等级",
  "## 3. 公司画像、历史沿革与股权/治理",
  "## 4. 业务结构全景",
  "## 5. 产品/服务收入、毛利率、销量/ASP/产能拆解",
  "## 6. 子公司、区域与组织口径核实",
  "## 7. 年报附注、公告原文与关键表格摘录",
  "## 8. 行业空间、竞争格局与同业对标",
  "## 9. 技术能力、供应链、客户与订单验证",
  "## 10. 财务三表与质量分析",
  "## 11. 分部模型与三年预测",
  "## 12. 估值框架、SOTP 与敏感性矩阵",
  "## 13. 催化剂、跟踪指标与验证节奏",
  "## 14. 风险、反证与下修条件",
  "## 15. 交易含义与仓位观察",
  "## 16. 仍需补数和人工复核清单",
  "## 17. wiki 写入候选",
  "## 附录 A. 证据索引",
  "## 附录 B. 模型检查与口径说明",
]

const COMPANY_PLUGIN_LED_REPORT_SECTION_GROUPS = [
  {
    id: "part-1",
    label: "核心结论、数据确认与公司/业务全景",
    sections: COMPANY_PLUGIN_LED_REQUIRED_REPORT_SECTIONS.slice(0, 5),
  },
  {
    id: "part-2",
    label: "产品、子公司、公告表格、行业和竞争",
    sections: COMPANY_PLUGIN_LED_REQUIRED_REPORT_SECTIONS.slice(5, 10),
  },
  {
    id: "part-3",
    label: "三表、分部模型、预测和估值",
    sections: COMPANY_PLUGIN_LED_REQUIRED_REPORT_SECTIONS.slice(10, 13),
  },
  {
    id: "part-4",
    label: "催化、风险、交易含义、补数清单和附录",
    sections: COMPANY_PLUGIN_LED_REQUIRED_REPORT_SECTIONS.slice(13),
  },
]

function auditCompanyPluginLedReportCompleteness(text, { minLines = 220, minTables = 10 } = {}) {
  const body = String(text ?? "")
  const lines = body.split(/\r?\n/)
  const nonEmptyLines = lines.filter((line) => line.trim()).length
  const missingSections = COMPANY_PLUGIN_LED_REQUIRED_REPORT_SECTIONS.filter((section) => !body.includes(section))
  const tableCount = (body.match(/\n\|[^\n]*\|\n\|[\s:|+-]*\|/g) ?? []).length
  const blockers = [
    nonEmptyLines >= minLines ? null : `report_too_short:${nonEmptyLines}<${minLines}`,
    tableCount >= minTables ? null : `too_few_tables:${tableCount}<${minTables}`,
    missingSections.length ? `missing_sections:${missingSections.length}` : null,
  ].filter(Boolean)
  return {
    schema: "company-plugin-led-report-completeness-v1",
    generatedAt: nowLocalTimestamp(),
    complete: blockers.length === 0,
    lineCount: lines.length,
    nonEmptyLineCount: nonEmptyLines,
    charCount: body.length,
    tableCount,
    requiredSections: COMPANY_PLUGIN_LED_REQUIRED_REPORT_SECTIONS,
    missingSections,
    blockers,
  }
}

function stripCompanyReportTitle(text) {
  return String(text ?? "").replace(/^#\s+插件主导公司深度研究报告\s*\n+/u, "").trim()
}

function assembleCompanyPluginLedReport(parts) {
  return [
    "# 插件主导公司深度研究报告",
    "",
    ...parts.map((part) => stripCompanyReportTitle(part.text)).filter(Boolean),
    "",
  ].join("\n\n")
}

function companyPluginLedPublicEquitySectionPrompt({ company, inputRelativePath, relativePaths, summary, dataAnalyticsText, investmentBankingText, group }) {
  return [
    companyPluginReviewTag("public-equity-investing"),
    "",
    "请作为 Public Equity Investing 主分析师，分段生成公司深度研究主报告。本次只写指定章节，后续由主程序拼接成完整报告。",
    "不要写泛泛摘要；每个指定章节都要展开事实、判断、表格、缺口、验证路径。不要编辑文件，只返回 Markdown。",
    "如果证据不足，写 manual_needed/provider_needed，并说明影响；不要省略章节，不要编造官方事实。",
    "",
    `公司：${company.stockName ?? company.secName ?? company.stockInput ?? ""} ${company.tsCode ?? company.stockCode ?? ""}`.trim(),
    `插件主导输入包：${inputRelativePath}`,
    `本段：${group.id} ${group.label}`,
    "",
    "核心输入：",
    ...Object.entries(relativePaths).map(([key, value]) => `- ${key}: ${value}`),
    "",
    "自动摘要：",
    "```json",
    JSON.stringify(summary, null, 2),
    "```",
    "",
    "Data Analytics 模型分析摘要：",
    dataAnalyticsText || "(missing)",
    investmentBankingText ? ["", "Investment Banking 交易事项分析摘要：", investmentBankingText].join("\n") : "",
    "",
    "本段必须逐字包含这些二级标题，并只围绕这些标题展开：",
    ...group.sections,
    "",
    "本段完整度要求：",
    "- 每个标题至少 2-4 段或 1 张表，不能只写一句。",
    "- 本段至少 3 张 Markdown 表格，除非指定章节少于 3 个；数字必须标注证据等级或来源类型。",
    "- 缺失数据也要写入对应章节，格式为：缺口、影响、补数路径、是否阻断发布。",
    "- 不要输出整篇报告标题；直接从本段第一个 `##` 标题开始。",
  ].filter(Boolean).join("\n")
}

function companyPluginLedPublicEquityRepairPrompt({ company, inputRelativePath, relativePaths, summary, dataAnalyticsText, investmentBankingText, draftReport, completeness }) {
  return [
    companyPluginReviewTag("public-equity-investing"),
    "",
    "上一版 Public Equity 主报告没有达到完整深研交付标准。请基于原始证据包、Data Analytics 分析、原稿和完整性校验结果，重写为一份完整深度研究报告。",
    "不要只补一个附录；请输出一份从标题开始的完整主报告正文。不要编辑文件，只返回 Markdown。",
    "如果证据不足，保留 blocked/manual_needed，但必须完整展开缺口对业务、模型、估值、催化和风险的影响。",
    "",
    `公司：${company.stockName ?? company.secName ?? company.stockInput ?? ""} ${company.tsCode ?? company.stockCode ?? ""}`.trim(),
    `插件主导输入包：${inputRelativePath}`,
    "",
    "核心输入：",
    ...Object.entries(relativePaths).map(([key, value]) => `- ${key}: ${value}`),
    "",
    "自动摘要：",
    "```json",
    JSON.stringify(summary, null, 2),
    "```",
    "",
    "完整性校验结果：",
    "```json",
    JSON.stringify(completeness, null, 2),
    "```",
    "",
    "Data Analytics 模型分析摘要：",
    dataAnalyticsText || "(missing)",
    investmentBankingText ? ["", "Investment Banking 交易事项分析摘要：", investmentBankingText].join("\n") : "",
    "",
    "上一版原稿：",
    draftReport || "(missing)",
    "",
    "必须输出这些章节，标题要逐字保留：",
    "# 插件主导公司深度研究报告",
    ...COMPANY_PLUGIN_LED_REQUIRED_REPORT_SECTIONS,
    "",
    "完整度硬要求：不少于 220 行，至少 10 张 Markdown 表格；缺数据时写 manual_needed/provider_needed、影响、补数路径，不能省略章节。",
  ].filter(Boolean).join("\n")
}

function companyPluginLedInvestmentBankingPrompt({ company, inputRelativePath, relativePaths, summary }) {
  return [
    companyPluginReviewTag("investment-banking"),
    "",
    "请作为 Investment Banking 插件，只围绕公告中的交易/融资/并购/重组事项做条款、估值和财务影响分析。",
    "如果证据不足，请明确写出不能下结论的条款缺口。不要输出普通公司研究报告。",
    "",
    `公司：${company.stockName ?? company.secName ?? company.stockInput ?? ""} ${company.tsCode ?? company.stockCode ?? ""}`.trim(),
    `插件主导输入包：${inputRelativePath}`,
    "",
    "核心输入：",
    ...Object.entries(relativePaths).map(([key, value]) => `- ${key}: ${value}`),
    "",
    "自动摘要：",
    "```json",
    JSON.stringify(summary, null, 2),
    "```",
  ].join("\n")
}

async function runCompanyPluginLedCall({ plugin, stage, prompt, outputPath, projectPath, options }) {
  const startedMs = Date.now()
  if (options.pluginLedRunner) {
    const text = await options.pluginLedRunner({
      plugin,
      stage,
      prompt,
      outputPath,
      projectPath,
    })
    const finalText = String(text ?? "").trim()
    if (!finalText) throw new Error(`pluginLedRunner returned empty output for ${stage}`)
    await ensureDirectory(path.dirname(outputPath))
    await fs.writeFile(outputPath, `${finalText}\n`, "utf8")
    return {
      status: "success",
      mode: "injected-plugin-led-runner",
      text: `${finalText}\n`,
      durationMs: Date.now() - startedMs,
    }
  }
  const text = await requestCodexExecText({
    stage: `company-plugin-led-${stage}`,
    prompt,
    instructions: [
      "You are running a plugin-led company deep-research stage for Trading Review Wiki.",
      "Use the explicitly tagged plugin workflow in the prompt. Read local artifacts when needed.",
      "Do not edit files. Return only the requested Markdown artifact.",
    ].join("\n"),
    model: options.pluginLedModel ?? options.pluginReviewModel ?? options.model,
    prepared: { projectPath },
    outputPath,
    codexBin: options.codexBin,
    codexProfile: options.codexProfile,
    codexProfileV2: options.codexProfileV2,
    codexTimeoutMs: parsePositiveInteger(
      options.pluginLedTimeoutMs ?? options["plugin-led-timeout-ms"],
      parsePositiveInteger(options.pluginReviewTimeoutMs ?? options["plugin-review-timeout-ms"], parsePositiveInteger(options.codexTimeoutMs, 10 * 60 * 1000)),
    ),
  })
  return {
    status: "success",
    mode: "codex-plugin-subprocess",
    text,
    durationMs: Date.now() - startedMs,
  }
}

export async function buildCompanyPluginLedArtifacts({ projectPath, outputDir, company, deep, generatedAt, options = {} }) {
  if (!deep?.enabled) {
    return { enabled: false, reason: "requires --deep" }
  }
  const pluginDir = path.join(outputDir, "plugin-led")
  await ensureDirectory(pluginDir)
  const absolutePaths = {
    evidenceLedger: path.join(outputDir, "evidence-ledger.json"),
    evidencePack: path.join(outputDir, "evidence-pack.json"),
    financials: path.join(outputDir, "financials.json"),
    documentExtract: path.join(outputDir, "document-extract.json"),
    businessBreakdown: path.join(outputDir, "business-breakdown.json"),
    deepQualityAudit: path.join(outputDir, "deep-quality-audit.json"),
    financialModelV2Template: path.join(outputDir, "financial-model-v2-template.json"),
    financialModelV2Json: path.join(outputDir, "financial-model-v2.json"),
    financialModelV2Xlsx: path.join(outputDir, "financial-model-v2.xlsx"),
    companyModelXlsx: path.join(outputDir, "company-model.xlsx"),
    wikiCandidates: path.join(outputDir, "wiki-change-candidates.md"),
  }
  const relativePaths = Object.fromEntries(Object.entries(absolutePaths).map(([key, value]) => [key, projectRelative(projectPath, value)]))
  const businessBreakdown = readJsonObjectIfAvailable(absolutePaths.businessBreakdown) ?? {}
  const deepQualityAudit = readJsonObjectIfAvailable(absolutePaths.deepQualityAudit) ?? {}
  const financialModelTemplate = readJsonObjectIfAvailable(absolutePaths.financialModelV2Template) ?? {}
  const ibTriggered = Boolean(options.forceInvestmentBankingReview) || hasInvestmentBankingTrigger(businessBreakdown)
  const inputPacket = {
    schema: "company-plugin-led-input-v1",
    generatedAt,
    company,
    relativePaths,
    summary: {
      deep: deep.summary ?? {},
      qualityScore: deepQualityAudit.score ?? null,
      qualityPass: deepQualityAudit.pass ?? null,
      residualRisks: deepQualityAudit.residualRisks ?? [],
      frameworkKind: financialModelTemplate.frameworkKind ?? deep.summary?.financialModelKind ?? null,
      productLineCompleteness: businessBreakdown.validationStatus?.productLineCompleteness ?? null,
      subsidiaryCompleteness: businessBreakdown.validationStatus?.subsidiaryCompleteness ?? null,
      capexCompleteness: businessBreakdown.validationStatus?.capexCompleteness ?? null,
      corporateActionCompleteness: businessBreakdown.validationStatus?.corporateActionCompleteness ?? null,
      investmentBankingTriggered: ibTriggered,
    },
    invocationPolicy: {
      mode: "plugin_led",
      dataAnalytics: "first-pass model and evidence analysis from structured artifacts",
      publicEquityInvesting: "lead analyst report after Data Analytics",
      investmentBanking: "transaction/capital-markets only, unless forced",
      writeBoundary: "plugins may read artifacts only; main CLI writes plugin-led outputs under .llm-wiki/company-research",
      formalWikiPublish: "never automatic",
    },
  }
  const inputPath = path.join(pluginDir, "plugin-led-input.json")
  await writeJson(inputPath, inputPacket)
  const calls = []
  const callStage = async ({ plugin, stage, prompt, outputPath, promptPath, errorPath }) => {
    await fs.writeFile(promptPath, prompt, "utf8")
    try {
      const result = await runCompanyPluginLedCall({ plugin, stage, prompt, outputPath, projectPath, options })
      calls.push({
        plugin,
        stage,
        tag: companyPluginReviewTag(plugin),
        status: result.status,
        mode: result.mode,
        durationMs: result.durationMs,
        prompt: projectRelative(projectPath, promptPath),
        output: projectRelative(projectPath, outputPath),
      })
      return result
    } catch (err) {
      const message = safeErrorMessage(err)
      await fs.writeFile(errorPath, `${message}\n`, "utf8")
      calls.push({
        plugin,
        stage,
        tag: companyPluginReviewTag(plugin),
        status: "failed",
        mode: options.pluginLedRunner ? "injected-plugin-led-runner" : "codex-plugin-subprocess",
        error: message,
        prompt: projectRelative(projectPath, promptPath),
        errorPath: projectRelative(projectPath, errorPath),
      })
      return { status: "failed", text: message, error: message, durationMs: 0 }
    }
  }

  const dataAnalyticsPromptPath = path.join(pluginDir, "data-analytics-model-analysis-prompt.md")
  const dataAnalyticsOutputPath = path.join(pluginDir, "data-analytics-model-analysis.md")
  const dataAnalyticsResult = await callStage({
    plugin: "data-analytics",
    stage: "data-analytics-model-analysis",
    prompt: companyPluginLedDataAnalyticsPrompt({
      company,
      inputRelativePath: projectRelative(projectPath, inputPath),
      relativePaths,
      summary: inputPacket.summary,
    }),
    outputPath: dataAnalyticsOutputPath,
    promptPath: dataAnalyticsPromptPath,
    errorPath: path.join(pluginDir, "data-analytics-model-analysis-error.txt"),
  })

  let investmentBankingText = ""
  if (ibTriggered) {
    const investmentBankingResult = await callStage({
      plugin: "investment-banking",
      stage: "investment-banking-transaction-analysis",
      prompt: companyPluginLedInvestmentBankingPrompt({
        company,
        inputRelativePath: projectRelative(projectPath, inputPath),
        relativePaths,
        summary: inputPacket.summary,
      }),
      outputPath: path.join(pluginDir, "investment-banking-transaction-analysis.md"),
      promptPath: path.join(pluginDir, "investment-banking-transaction-analysis-prompt.md"),
      errorPath: path.join(pluginDir, "investment-banking-transaction-analysis-error.txt"),
    })
    investmentBankingText = excerptForPrompt(investmentBankingResult.text ?? "", 5000)
  } else {
    const skippedPath = path.join(pluginDir, "investment-banking-skipped.md")
    await fs.writeFile(
      skippedPath,
      [
        "# Investment Banking Skipped",
        "",
        "未检测到收购、并购、定增、可转债、重组、融资等交易/资本市场触发项，因此 plugin-led 模式没有调用 Investment Banking。",
        "需要强制参与时使用 `--force-investment-banking-review`。",
      ].join("\n"),
      "utf8",
    )
    calls.push({
      plugin: "investment-banking",
      stage: "investment-banking-transaction-analysis",
      tag: companyPluginReviewTag("investment-banking"),
      status: "skipped",
      reason: "no transaction/capital-markets trigger detected",
      output: projectRelative(projectPath, skippedPath),
    })
  }

  const dataAnalyticsTextForPrompt = excerptForPrompt(dataAnalyticsResult.text ?? "", 7000)
  const publicEquityOutputPath = path.join(pluginDir, "plugin-led-company-report.md")
  const publicEquityParts = []
  for (const group of COMPANY_PLUGIN_LED_REPORT_SECTION_GROUPS) {
    const partOutputPath = path.join(pluginDir, `plugin-led-company-report-${group.id}.md`)
    const partResult = await callStage({
      plugin: "public-equity-investing",
      stage: `public-equity-company-report-${group.id}`,
      prompt: companyPluginLedPublicEquitySectionPrompt({
        company,
        inputRelativePath: projectRelative(projectPath, inputPath),
        relativePaths: {
          ...relativePaths,
          dataAnalyticsModelAnalysis: projectRelative(projectPath, dataAnalyticsOutputPath),
        },
        summary: inputPacket.summary,
        dataAnalyticsText: dataAnalyticsTextForPrompt,
        investmentBankingText,
        group,
      }),
      outputPath: partOutputPath,
      promptPath: path.join(pluginDir, `public-equity-company-report-${group.id}-prompt.md`),
      errorPath: path.join(pluginDir, `public-equity-company-report-${group.id}-error.txt`),
    })
    publicEquityParts.push({
      group,
      status: partResult.status,
      text: partResult.text ?? "",
      outputPath: partOutputPath,
      error: partResult.error ?? null,
    })
  }
  const failedPublicEquityParts = publicEquityParts.filter((part) => part.status !== "success")
  const assembledPublicEquityText = assembleCompanyPluginLedReport(publicEquityParts.filter((part) => part.status === "success"))
  await fs.writeFile(publicEquityOutputPath, assembledPublicEquityText, "utf8")
  const publicEquityResult = {
    status: failedPublicEquityParts.length ? "failed" : "success",
    mode: "sectioned-codex-plugin-subprocess",
    text: assembledPublicEquityText,
    error: failedPublicEquityParts.length ? `failed_sections:${failedPublicEquityParts.map((part) => part.group.id).join(",")}` : null,
  }
  let finalPublicEquityOutputPath = publicEquityOutputPath
  let finalPublicEquityResult = publicEquityResult
  let reportCompleteness = auditCompanyPluginLedReportCompleteness(publicEquityResult.text ?? "")
  let repairAttempted = false
  let draftReportPath = null
  if (publicEquityResult.status === "success" && !reportCompleteness.complete) {
    repairAttempted = true
    draftReportPath = projectRelative(projectPath, publicEquityOutputPath)
    const repairOutputPath = path.join(pluginDir, "plugin-led-company-report-complete.md")
    const repairResult = await callStage({
      plugin: "public-equity-investing",
      stage: "public-equity-company-report-complete",
      prompt: companyPluginLedPublicEquityRepairPrompt({
        company,
        inputRelativePath: projectRelative(projectPath, inputPath),
        relativePaths: {
          ...relativePaths,
          dataAnalyticsModelAnalysis: projectRelative(projectPath, dataAnalyticsOutputPath),
          draftPluginLedReport: projectRelative(projectPath, publicEquityOutputPath),
        },
        summary: inputPacket.summary,
        dataAnalyticsText: dataAnalyticsTextForPrompt,
        investmentBankingText,
        draftReport: excerptForPrompt(publicEquityResult.text ?? "", 12000),
        completeness: reportCompleteness,
      }),
      outputPath: repairOutputPath,
      promptPath: path.join(pluginDir, "public-equity-company-report-complete-prompt.md"),
      errorPath: path.join(pluginDir, "public-equity-company-report-complete-error.txt"),
    })
    if (repairResult.status === "success") {
      const repairedCompleteness = auditCompanyPluginLedReportCompleteness(repairResult.text ?? "")
      if (repairedCompleteness.complete || repairedCompleteness.blockers.length <= reportCompleteness.blockers.length) {
        finalPublicEquityOutputPath = repairOutputPath
        finalPublicEquityResult = repairResult
        reportCompleteness = repairedCompleteness
      }
    }
  }

  if (finalPublicEquityResult.status === "success") {
    await fs.copyFile(finalPublicEquityOutputPath, path.join(outputDir, "deep-company-report.md"))
  }
  const readiness = buildPublishReadiness({
    deep,
    pluginReview: { calls },
    optimizationStatus: finalPublicEquityResult.status,
    optimizationText: finalPublicEquityResult.text ?? "",
    reportCompleteness,
    rerunCommand: "company-research --deep --plugin-led",
  })
  const readinessPath = path.join(pluginDir, "publish-readiness.json")
  await writeJson(readinessPath, readiness)
  const completenessPath = path.join(pluginDir, "report-completeness.json")
  await writeJson(completenessPath, reportCompleteness)
  const summaryPath = path.join(pluginDir, "plugin-led.json")
  const summary = {
    schema: "company-plugin-led-v1",
    generatedAt: nowLocalTimestamp(),
    enabled: true,
    input: projectRelative(projectPath, inputPath),
    calls,
    investmentBankingTriggered: ibTriggered,
    reportCompleteness: {
      complete: reportCompleteness.complete,
      lineCount: reportCompleteness.lineCount,
      nonEmptyLineCount: reportCompleteness.nonEmptyLineCount,
      tableCount: reportCompleteness.tableCount,
      missingSections: reportCompleteness.missingSections.length,
      repairAttempted,
    },
    publishable: readiness.publishable,
    blockers: readiness.blockers,
    outputs: {
      dataAnalyticsModelAnalysis: projectRelative(projectPath, dataAnalyticsOutputPath),
      pluginLedReport: projectRelative(projectPath, finalPublicEquityOutputPath),
      pluginLedDraftReport: draftReportPath,
      reportCompleteness: projectRelative(projectPath, completenessPath),
      publishReadiness: projectRelative(projectPath, readinessPath),
      deepReport: projectRelative(projectPath, path.join(outputDir, "deep-company-report.md")),
    },
    writePolicy: {
      wroteRaw: false,
      wroteFormalWiki: false,
      outputRoot: projectRelative(projectPath, pluginDir),
    },
  }
  await writeJson(summaryPath, summary)
  return {
    enabled: true,
    summary: projectRelative(projectPath, summaryPath),
    input: projectRelative(projectPath, inputPath),
    calls,
    investmentBankingTriggered: ibTriggered,
    reportCompleteness,
    publishable: readiness.publishable,
    blockers: readiness.blockers,
    outputs: summary.outputs,
  }
}

function companyPluginOptimizationPrompt({ company, inputRelativePath, relativePaths, summary, reviewSnippets, includeInvestmentBanking }) {
  const tags = [
    companyPluginReviewTag("data-analytics"),
    companyPluginReviewTag("public-equity-investing"),
    includeInvestmentBanking ? companyPluginReviewTag("investment-banking") : null,
  ].filter(Boolean).join(" ")
  return [
    tags,
    "",
    "请让上面标记的插件共同参与优化公司深度研究底稿。目标不是再评审一次，而是把评审意见落实成一版更适合发布/内部传阅的候选报告。",
    "你可以读取下列本地文件，但不要编辑、创建或删除任何文件；最终只返回 Markdown 候选报告正文。",
    "如果关键数据或模型仍不足以支持正式投资结论，请不要硬凑通过；把报告改写为“内部研究候选稿/待验证稿”，并在首页明确发布门禁和阻断项。",
    "",
    `公司：${company.stockName ?? company.secName ?? company.stockInput ?? ""} ${company.tsCode ?? company.stockCode ?? ""}`.trim(),
    `插件优化输入包：${inputRelativePath}`,
    "",
    "核心产物：",
    ...Object.entries(relativePaths).map(([key, value]) => `- ${key}: ${value}`),
    "",
    "自动摘要和发布门禁上下文：",
    "```json",
    JSON.stringify(summary, null, 2),
    "```",
    "",
    "插件评审摘要：",
    ...reviewSnippets.map((item) => [
      `### ${item.plugin}`,
      item.text,
    ].join("\n")),
    "",
    "请输出以下 Markdown 结构：",
    "# 发布候选稿",
    "## 发布门禁",
    "## 一页结论",
    "## 已验证事实",
    "## 模型修正说明",
    "## 分部/SOTP 框架",
    "## 三年情景与估值边界",
    "## 催化与验证清单",
    "## 风险与证伪",
    "## 仍需补数",
    "## wiki 写入候选",
  ].join("\n")
}

function pluginReviewCallOutputPath(projectPath, call) {
  const rel = call?.output ?? call?.errorPath
  if (!rel) return null
  return resolveProjectArtifactPath(projectPath, rel)
}

function summarizePluginReviewOutputs({ projectPath, pluginReview }) {
  return (pluginReview?.calls ?? [])
    .filter((call) => call.status === "success" && call.output)
    .map((call) => {
      const text = readTextIfAvailable(pluginReviewCallOutputPath(projectPath, call))
      return {
        plugin: call.plugin,
        output: call.output,
        text: excerptForPrompt(text, 5000),
      }
    })
    .filter((item) => item.text.trim())
}

function buildPublishReadiness({ deep, pluginReview, optimizationStatus, optimizationText, reportCompleteness = null, rerunCommand = "company-research --deep --plugin-review --plugin-optimize" }) {
  const reviewCalls = pluginReview?.calls ?? []
  const failedPlugins = reviewCalls.filter((call) => call.status === "failed").map((call) => call.plugin)
  const successfulPlugins = reviewCalls.filter((call) => call.status === "success").map((call) => call.plugin)
  const skippedPlugins = reviewCalls.filter((call) => call.status === "skipped").map((call) => call.plugin)
  const text = String(optimizationText ?? "")
  const blockers = [
    optimizationStatus === "success" ? null : "plugin_optimization_failed_or_skipped",
    deep?.summary?.qualityPass ? null : "deep_quality_gate_failed",
    failedPlugins.length ? `plugin_review_failed:${failedPlugins.join(",")}` : null,
    /不能发布|不通过|不可发布|阻断|manual_needed|provider_needed/i.test(text) ? "optimized_report_contains_publish_blockers" : null,
    reportCompleteness && !reportCompleteness.complete ? "plugin_led_report_incomplete" : null,
    deep?.summary?.capexCompleteness === "manual_needed" ? "capex_capacity_manual_needed" : null,
    deep?.summary?.corporateActionCompleteness === "manual_needed" ? "corporate_action_terms_manual_needed" : null,
  ].filter(Boolean)
  const status = blockers.length ? "blocked" : "ready"
  return {
    schema: "company-publish-readiness-v1",
    generatedAt: nowLocalTimestamp(),
    status,
    publishable: status === "ready",
    successfulPlugins,
    skippedPlugins,
    failedPlugins,
    blockers,
    requiredBeforeFormalPublish: blockers.length
      ? [
          `修复阻断项后重新运行 ${rerunCommand}。`,
          "正式 wiki 写入仍需人工确认，不由 company-research 自动执行。",
        ]
      : [
          "人工抽查关键来源、估值和风险段落后，可进入正式发布/写入候选审阅。",
        ],
  }
}

async function runCompanyPluginOptimizationCall({ prompt, outputPath, projectPath, options }) {
  const startedMs = Date.now()
  if (options.pluginOptimizer) {
    const text = await options.pluginOptimizer({
      prompt,
      outputPath,
      projectPath,
    })
    const finalText = String(text ?? "").trim()
    if (!finalText) throw new Error("pluginOptimizer returned empty output")
    await ensureDirectory(path.dirname(outputPath))
    await fs.writeFile(outputPath, `${finalText}\n`, "utf8")
    return {
      status: "success",
      mode: "injected-optimizer",
      text: `${finalText}\n`,
      durationMs: Date.now() - startedMs,
    }
  }
  const text = await requestCodexExecText({
    stage: "company-plugin-optimization",
    prompt,
    instructions: [
      "You are a plugin-backed optimizer for Trading Review Wiki company deep-research artifacts.",
      "Use the explicitly tagged plugin workflows in the prompt. Read local artifacts when needed.",
      "Do not edit files. Return only the optimized Markdown report.",
    ].join("\n"),
    model: options.pluginOptimizeModel ?? options.pluginReviewModel ?? options.model,
    prepared: { projectPath },
    outputPath,
    codexBin: options.codexBin,
    codexProfile: options.codexProfile,
    codexProfileV2: options.codexProfileV2,
    codexTimeoutMs: parsePositiveInteger(
      options.pluginOptimizeTimeoutMs ?? options["plugin-optimize-timeout-ms"],
      parsePositiveInteger(options.pluginReviewTimeoutMs ?? options["plugin-review-timeout-ms"], parsePositiveInteger(options.codexTimeoutMs, 10 * 60 * 1000)),
    ),
  })
  return {
    status: "success",
    mode: "codex-plugin-subprocess",
    text,
    durationMs: Date.now() - startedMs,
  }
}

export async function buildCompanyPluginOptimizationArtifacts({ projectPath, outputDir, company, deep, pluginReview, generatedAt, options = {} }) {
  if (!pluginReview?.enabled) {
    return { enabled: false, reason: "requires --plugin-review" }
  }
  const reviewSnippets = summarizePluginReviewOutputs({ projectPath, pluginReview })
  if (reviewSnippets.length === 0) {
    return { enabled: false, reason: "no successful plugin review outputs" }
  }
  const pluginDir = path.join(outputDir, "plugin-review")
  await ensureDirectory(pluginDir)
  const relativePaths = {
    evidenceLedger: projectRelative(projectPath, path.join(outputDir, "evidence-ledger.json")),
    evidencePack: projectRelative(projectPath, path.join(outputDir, "evidence-pack.json")),
    documentExtract: projectRelative(projectPath, path.join(outputDir, "document-extract.json")),
    businessBreakdown: projectRelative(projectPath, path.join(outputDir, "business-breakdown.json")),
    deepReport: projectRelative(projectPath, path.join(outputDir, "deep-company-report.md")),
    deepQualityAudit: projectRelative(projectPath, path.join(outputDir, "deep-quality-audit.json")),
    financialModelV2Template: projectRelative(projectPath, path.join(outputDir, "financial-model-v2-template.json")),
    financialModelV2Json: projectRelative(projectPath, path.join(outputDir, "financial-model-v2.json")),
    financialModelV2Xlsx: projectRelative(projectPath, path.join(outputDir, "financial-model-v2.xlsx")),
    pluginReview: pluginReview.summary,
    pluginReviewInput: pluginReview.input,
    ...Object.fromEntries((pluginReview.calls ?? []).filter((call) => call.output).map((call) => [`${call.plugin}Review`, call.output])),
  }
  const inputPacket = {
    schema: "company-plugin-optimization-input-v1",
    generatedAt,
    company,
    relativePaths,
    summary: {
      deep: deep.summary ?? {},
      pluginReview: {
        successful: (pluginReview.calls ?? []).filter((call) => call.status === "success").map((call) => call.plugin),
        failed: (pluginReview.calls ?? []).filter((call) => call.status === "failed").map((call) => call.plugin),
        skipped: (pluginReview.calls ?? []).filter((call) => call.status === "skipped").map((call) => call.plugin),
        investmentBankingTriggered: pluginReview.investmentBankingTriggered,
      },
      optimizationPolicy: {
        writeBoundary: "write only plugin-review optimization artifacts under .llm-wiki/company-research",
        formalWikiPublish: "never automatic",
        target: "produce a publish candidate only when blockers are explicit",
      },
    },
  }
  const inputPath = path.join(pluginDir, "plugin-optimization-input.json")
  const promptPath = path.join(pluginDir, "plugin-optimization-prompt.md")
  const outputPath = path.join(pluginDir, "optimized-company-report.md")
  const readinessPath = path.join(pluginDir, "publish-readiness.json")
  const errorPath = path.join(pluginDir, "plugin-optimization-error.txt")
  await writeJson(inputPath, inputPacket)
  const prompt = companyPluginOptimizationPrompt({
    company,
    inputRelativePath: projectRelative(projectPath, inputPath),
    relativePaths,
    summary: inputPacket.summary,
    reviewSnippets,
    includeInvestmentBanking: Boolean(pluginReview.investmentBankingTriggered),
  })
  await fs.writeFile(promptPath, prompt, "utf8")
  try {
    const optimized = await runCompanyPluginOptimizationCall({ prompt, outputPath, projectPath, options })
    const readiness = buildPublishReadiness({
      deep,
      pluginReview,
      optimizationStatus: optimized.status,
      optimizationText: optimized.text,
    })
    await writeJson(readinessPath, readiness)
    return {
      enabled: true,
      status: optimized.status,
      mode: optimized.mode,
      durationMs: optimized.durationMs,
      input: projectRelative(projectPath, inputPath),
      prompt: projectRelative(projectPath, promptPath),
      output: projectRelative(projectPath, outputPath),
      readiness: projectRelative(projectPath, readinessPath),
      publishable: readiness.publishable,
      blockers: readiness.blockers,
    }
  } catch (err) {
    const message = safeErrorMessage(err)
    await fs.writeFile(errorPath, `${message}\n`, "utf8")
    const readiness = buildPublishReadiness({
      deep,
      pluginReview,
      optimizationStatus: "failed",
      optimizationText: message,
    })
    await writeJson(readinessPath, readiness)
    return {
      enabled: true,
      status: "failed",
      mode: options.pluginOptimizer ? "injected-optimizer" : "codex-plugin-subprocess",
      error: message,
      input: projectRelative(projectPath, inputPath),
      prompt: projectRelative(projectPath, promptPath),
      errorPath: projectRelative(projectPath, errorPath),
      readiness: projectRelative(projectPath, readinessPath),
      publishable: false,
      blockers: readiness.blockers,
    }
  }
}

export async function buildCompanyPluginReviewArtifacts({ projectPath, outputDir, company, deep, generatedAt, options = {} }) {
  if (!deep?.enabled) {
    return { enabled: false, reason: "requires --deep" }
  }
  const pluginDir = path.join(outputDir, "plugin-review")
  await ensureDirectory(pluginDir)
  const absolutePaths = {
    evidenceLedger: path.join(outputDir, "evidence-ledger.json"),
    evidencePack: path.join(outputDir, "evidence-pack.json"),
    financials: path.join(outputDir, "financials.json"),
    companyReport: path.join(outputDir, "company-report.md"),
    wikiCandidates: path.join(outputDir, "wiki-change-candidates.md"),
    documentExtract: path.join(outputDir, "document-extract.json"),
    businessBreakdown: path.join(outputDir, "business-breakdown.json"),
    deepReport: path.join(outputDir, "deep-company-report.md"),
    deepChecklist: path.join(outputDir, "deep-review-checklist.md"),
    deepQualityAudit: path.join(outputDir, "deep-quality-audit.json"),
    financialModelV2Template: path.join(outputDir, "financial-model-v2-template.json"),
    financialModelV2Json: path.join(outputDir, "financial-model-v2.json"),
    financialModelV2Xlsx: path.join(outputDir, "financial-model-v2.xlsx"),
    deepModelXlsx: path.join(outputDir, "deep-company-model.xlsx"),
  }
  const relativePaths = Object.fromEntries(Object.entries(absolutePaths).map(([key, value]) => [key, projectRelative(projectPath, value)]))
  const businessBreakdown = readJsonObjectIfAvailable(absolutePaths.businessBreakdown) ?? {}
  const deepQualityAudit = readJsonObjectIfAvailable(absolutePaths.deepQualityAudit) ?? {}
  const financialModelTemplate = readJsonObjectIfAvailable(absolutePaths.financialModelV2Template) ?? {}
  const inputPacket = {
    schema: "company-plugin-review-input-v1",
    generatedAt,
    company,
    relativePaths,
    summary: {
      deep: deep.summary ?? {},
      qualityScore: deepQualityAudit.score ?? null,
      qualityPass: deepQualityAudit.pass ?? null,
      completedRequirements: deepQualityAudit.completed ?? null,
      totalRequirements: deepQualityAudit.total ?? null,
      residualRisks: deepQualityAudit.residualRisks ?? [],
      frameworkKind: financialModelTemplate.frameworkKind ?? deep.summary?.financialModelKind ?? null,
      productLineCompleteness: businessBreakdown.validationStatus?.productLineCompleteness ?? null,
      subsidiaryCompleteness: businessBreakdown.validationStatus?.subsidiaryCompleteness ?? null,
      capexCompleteness: businessBreakdown.validationStatus?.capexCompleteness ?? null,
      corporateActionCompleteness: businessBreakdown.validationStatus?.corporateActionCompleteness ?? null,
      corporateActionCount: Array.isArray(businessBreakdown.corporateActions) ? businessBreakdown.corporateActions.length : 0,
    },
    invocationPolicy: {
      dataAnalytics: "always_review_deep_model_quality_when --plugin-review is set",
      publicEquityInvesting: "always_review_listed_equity_investment_framing_when --plugin-review is set",
      investmentBanking: "review only when transaction/capital-markets trigger exists, or --force-investment-banking-review is set",
      writeBoundary: "reviewers may read artifacts only; main CLI writes only under this plugin-review directory",
    },
  }
  const inputPath = path.join(pluginDir, "plugin-review-input.json")
  await writeJson(inputPath, inputPacket)

  const plugins = ["data-analytics", "public-equity-investing"]
  const ibTriggered = Boolean(options.forceInvestmentBankingReview) || hasInvestmentBankingTrigger(businessBreakdown)
  if (ibTriggered) plugins.push("investment-banking")

  const calls = []
  for (const plugin of plugins) {
    const promptPath = path.join(pluginDir, `${plugin}-prompt.md`)
    const outputPath = path.join(pluginDir, `${plugin}-review.md`)
    const errorPath = path.join(pluginDir, `${plugin}-error.txt`)
    const prompt = companyPluginReviewPrompt({
      plugin,
      company,
      inputRelativePath: projectRelative(projectPath, inputPath),
      relativePaths,
      summary: inputPacket.summary,
    })
    await fs.writeFile(promptPath, prompt, "utf8")
    try {
      const call = await runCompanyPluginReviewCall({ plugin, prompt, outputPath, projectPath, options })
      calls.push({
        plugin,
        tag: companyPluginReviewTag(plugin),
        status: call.status,
        mode: call.mode,
        durationMs: call.durationMs,
        prompt: projectRelative(projectPath, promptPath),
        output: projectRelative(projectPath, outputPath),
      })
    } catch (err) {
      const message = safeErrorMessage(err)
      await fs.writeFile(errorPath, `${message}\n`, "utf8")
      calls.push({
        plugin,
        tag: companyPluginReviewTag(plugin),
        status: "failed",
        mode: options.pluginReviewer ? "injected-reviewer" : "codex-plugin-subprocess",
        error: message,
        prompt: projectRelative(projectPath, promptPath),
        errorPath: projectRelative(projectPath, errorPath),
      })
    }
  }
  if (!ibTriggered) {
    const skippedPath = path.join(pluginDir, "investment-banking-skipped.md")
    await fs.writeFile(
      skippedPath,
      [
        "# Investment Banking Review Skipped",
        "",
        "未检测到收购、并购、定增、可转债、重组、融资等交易/资本市场触发项，因此没有调用 Investment Banking 插件。",
        "需要强制评审时使用 `--force-investment-banking-review`。",
      ].join("\n"),
      "utf8",
    )
    calls.push({
      plugin: "investment-banking",
      tag: companyPluginReviewTag("investment-banking"),
      status: "skipped",
      reason: "no transaction/capital-markets trigger detected",
      output: projectRelative(projectPath, skippedPath),
    })
  }

  const summaryPath = path.join(pluginDir, "plugin-review.json")
  const summary = {
    schema: "company-plugin-review-v1",
    generatedAt: nowLocalTimestamp(),
    enabled: true,
    input: projectRelative(projectPath, inputPath),
    pluginsRequested: plugins,
    investmentBankingTriggered: ibTriggered,
    calls,
    writePolicy: {
      wroteRaw: false,
      wroteFormalWiki: false,
      outputRoot: projectRelative(projectPath, pluginDir),
    },
  }
  await writeJson(summaryPath, summary)
  return {
    enabled: true,
    summary: projectRelative(projectPath, summaryPath),
    input: projectRelative(projectPath, inputPath),
    calls,
    investmentBankingTriggered: ibTriggered,
  }
}

export async function writeCompanyWorkbook(filePath, modelRows) {
  const xlsx = await import("xlsx")
  const XLSX = xlsx.default ?? xlsx
  const wb = XLSX.utils.book_new()
  for (const [sheetName, rows] of Object.entries(modelRows)) {
    const normalizedRows = rows.map((row) => row.map((cell) => {
      if (cell && typeof cell === "object" && !Array.isArray(cell) && cell.f) {
        return { t: cell.t ?? "n", v: cell.v ?? 0, f: cell.f }
      }
      return cell
    }))
    const ws = XLSX.utils.aoa_to_sheet(normalizedRows)
    XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31))
  }
  await ensureDirectory(path.dirname(filePath))
  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" })
  await fs.writeFile(filePath, buffer)
}

export async function buildCompanyWikiContext({ projectPath, company, options }) {
  const query = [
    company.stockName,
    company.stockCode,
    company.tsCode,
    "公司 财务 模型 技术能力 产业链 估值 关联页面 最近20个交易日股价 成交额",
  ].filter(Boolean).join(" ")
  try {
    return await buildAskRetrievalContext({
      projectPath,
      query,
      sources: "wiki,raw,graph,stock-price",
      useLlmSourceRouting: false,
      topWiki: options.topWiki ?? 10,
      topRaw: options.topRaw ?? 6,
      graphNeighbors: options.graphNeighbors ?? 8,
      sqlLimit: options.sqlLimit ?? 60,
      stockDailyExecutor: options.stockDailyExecutor,
      stockDailyColumns: options.stockDailyColumns,
      stockDailyDescriptor: options.stockDailyDescriptor,
      pgConnectTimeoutMs: options.pgConnectTimeoutMs,
      pgStatementTimeoutMs: options.pgStatementTimeoutMs,
    })
  } catch (err) {
    return {
      query,
      retrievalWarnings: [`wiki retrieval failed: ${safeErrorMessage(err)}`],
      counts: {},
      wikiResults: [],
      rawResults: [],
      graphExpansions: [],
      stockDailyResults: [],
      marketValidation: null,
    }
  }
}

export function resolveCompanyFromInputs({ stockInput, tushareEvidence }) {
  const normalizedCode = normalizeStockCode(stockInput)
  const stockBasic = latestByDate(tushareEvidence?.tables?.stock_basic?.rows, ["list_date"])
  const tsCode = stockBasic?.ts_code ?? toTushareCode(normalizedCode ?? stockInput)
  return {
    stockInput,
    stockCode: normalizedCode ?? normalizeStockCode(stockBasic?.ts_code),
    tsCode,
    stockName: stockBasic?.name ?? (normalizedCode ? null : stockInput),
    secName: stockBasic?.name ?? null,
    industry: stockBasic?.industry ?? null,
    market: stockBasic?.market ?? null,
    area: stockBasic?.area ?? null,
    listDate: stockBasic?.list_date ?? null,
  }
}

function shouldRetryTushareWithResolvedTsCode({ seedCompany, company, tushareEvidence, credentials, options = {} }) {
  if (seedCompany?.tsCode || !company?.tsCode) return false
  if (!credentials?.tushareToken && !options.tushareClient) return false
  const calls = tushareEvidence?.calls ?? []
  return calls.some((call) =>
    call.status === "failed" && /ts_code|至少输入一个参数|必填参数/.test(String(call.error ?? "")),
  )
}

export async function runCompanyResearch(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const stockInput = String(options.stock ?? options.company ?? "").trim()
  if (!stockInput) throw new Error("Missing --stock for company-research")
  const generatedAt = nowLocalTimestamp()
  const credentials = getCompanyResearchCredentials(options)
  const providerEvents = []

  const seedCompany = {
    stockInput,
    stockCode: normalizeStockCode(stockInput),
    tsCode: toTushareCode(stockInput),
    stockName: normalizeStockCode(stockInput) ? null : stockInput,
    secName: normalizeStockCode(stockInput) ? null : stockInput,
    industry: null,
  }
  let tushareEvidence = await runCompanyResearchStage({
    stage: "tushare",
    label: "Tushare evidence collection",
    timeoutMs: companyProviderStageTimeoutMs(options, "tushare"),
    providerEvents,
    onProgress: options.onProgress,
    fn: () => collectTushareEvidence({ company: seedCompany, credentials, options }),
    fallback: (err) => ({
      status: "failed",
      calls: [],
      tables: {},
      error: safeErrorMessage(err),
    }),
  })
  const company = resolveCompanyFromInputs({ stockInput, tushareEvidence })
  if (shouldRetryTushareWithResolvedTsCode({ seedCompany, company, tushareEvidence, credentials, options })) {
    tushareEvidence = await runCompanyResearchStage({
      stage: "tushare-resolved",
      label: "Tushare evidence collection with resolved ts_code",
      timeoutMs: companyProviderStageTimeoutMs(options, "tushare"),
      providerEvents,
      onProgress: options.onProgress,
      fn: () => collectTushareEvidence({ company, credentials, options }),
      fallback: (err) => ({
        status: "failed",
        calls: tushareEvidence?.calls ?? [],
        tables: tushareEvidence?.tables ?? {},
        error: safeErrorMessage(err),
      }),
    })
  }
  const reportId = companyResearchReportId(company, options)
  const outputDir = path.join(projectPath, COMPANY_RESEARCH_ROOT, reportId)
  ensureCompanyResearchRelative(projectPath, outputDir)
  await ensureDirectory(outputDir)

  const cninfoClient = options.cninfoClient ?? defaultCninfoClient
  let cninfo = await runCompanyResearchStage({
    stage: "cninfo",
    label: "CNINFO announcement search",
    timeoutMs: companyProviderStageTimeoutMs(options, "cninfo"),
    providerEvents,
    onProgress: options.onProgress,
    fn: async () => {
      const result = await cninfoClient({
        company,
        from: options.from,
        to: options.to,
        timeoutMs: options.cninfoTimeoutMs,
        options,
      })
      return {
        status: result.status ?? "success",
        requests: result.requests ?? [],
        announcements: dedupeAnnouncements((result.announcements ?? []).map((item) => item.downloadUrl ? item : normalizeCninfoAnnouncement(item))),
        error: result.error ?? null,
      }
    },
    fallback: (err) => ({ status: "failed", requests: [], announcements: [], error: safeErrorMessage(err) }),
  })
  if (!options.cninfoClient && options.disableSseFallback !== true && isShanghaiListedCompany(company)) {
    const sse = await runCompanyResearchStage({
      stage: "sse",
      label: "SSE announcement fallback",
      timeoutMs: companyProviderStageTimeoutMs(options, "sse", 30000),
      providerEvents,
      onProgress: options.onProgress,
      fn: () => defaultSseAnnouncementClient({
        company,
        to: options.to,
        timeoutMs: options.sseTimeoutMs ?? options.cninfoTimeoutMs,
        options,
      }),
      fallback: (err) => ({ status: "failed", requests: [], announcements: [], error: safeErrorMessage(err) }),
    })
    if (sse.status === "failed") {
      cninfo = {
        ...cninfo,
        status: cninfo.status === "success" ? "partial" : cninfo.status,
        error: [cninfo.error, `SSE fallback failed: ${sse.error}`].filter(Boolean).join("; "),
      }
    } else if ((sse.announcements?.length ?? 0) > 0) {
      cninfo = {
        ...cninfo,
        status: cninfo.status === "failed" ? "partial" : cninfo.status,
        requests: [...(cninfo.requests ?? []), ...(sse.requests ?? [])],
        announcements: dedupeAnnouncements([...(cninfo.announcements ?? []), ...(sse.announcements ?? [])]),
        error: cninfo.error ?? null,
      }
    }
  }
  options.onProgress?.(`[company-research] cninfo-download started (announcements=${cninfo.announcements.length})`)
  let downloads = await downloadCninfoArtifacts({ projectPath, outputDir, announcements: cninfo.announcements, options })
  options.onProgress?.(`[company-research] cninfo-download success (downloads=${downloads.filter((item) => item.status === "success").length}/${downloads.length})`)
  if (downloads.length === 0) {
    const cachedDownloads = await findCachedCninfoArtifacts({ projectPath, outputDir, company, options })
    if (cachedDownloads.length > 0) {
      downloads = cachedDownloads
      cninfo = {
        ...cninfo,
        status: "partial",
        error: [cninfo.error, `used ${cachedDownloads.length} cached CNINFO artifact(s)`].filter(Boolean).join("; "),
      }
    }
  }
  const tavilyEvidence = await runCompanyResearchStage({
    stage: "tavily",
    label: "Tavily web evidence collection",
    timeoutMs: companyProviderStageTimeoutMs(options, "tavily"),
    providerEvents,
    onProgress: options.onProgress,
    fn: () => collectTavilyEvidence({ company, credentials, options }),
    fallback: (err) => ({
      status: "failed",
      queries: [],
      results: [],
      error: safeErrorMessage(err),
    }),
  })
  const wikiContext = await runCompanyResearchStage({
    stage: "wiki",
    label: "local wiki retrieval",
    timeoutMs: companyProviderStageTimeoutMs(options, "wiki"),
    providerEvents,
    onProgress: options.onProgress,
    fn: () => buildCompanyWikiContext({ projectPath, company, options }),
    fallback: (err) => ({
      query: company.stockName ?? company.secName ?? company.stockInput,
      counts: { wikiFiles: 0, rawFiles: 0, wikiMatches: 0, rawMatches: 0, graphMatches: 0, sqlRows: 0 },
      retrievalWarnings: [`company wiki retrieval failed: ${safeErrorMessage(err)}`],
      wikiResults: [],
      rawResults: [],
      graphExpansions: [],
      stockDailyResults: [],
      marketValidation: null,
    }),
  })
  const financials = buildFinancialsFromTushare(tushareEvidence)
  const ledger = buildEvidenceLedger({
    company,
    cninfo,
    downloads,
    tushare: tushareEvidence,
    tavily: tavilyEvidence,
    wikiContext,
    generatedAt,
  })
  const evidencePack = {
    schema: "company-evidence-pack-v1",
    generatedAt,
    company,
    cninfo,
    cninfoDownloads: downloads,
    tushare: {
      status: tushareEvidence.status,
      calls: tushareEvidence.calls,
      tables: tushareEvidence.tables,
      error: tushareEvidence.error,
    },
    tavily: tavilyEvidence,
    providerEvents,
    wikiContext: {
      query: wikiContext.query,
      counts: wikiContext.counts,
      retrievalWarnings: wikiContext.retrievalWarnings,
      wikiResults: (wikiContext.wikiResults ?? []).map(({ ref, path, title, score, type, snippet }) => ({ ref, path, title, score, type, snippet })),
      rawResults: (wikiContext.rawResults ?? []).map(({ ref, path, title, score, snippet }) => ({ ref, path, title, score, snippet })),
      graphExpansions: (wikiContext.graphExpansions ?? []).map(({ ref, path, title, score, reasons, from, snippet }) => ({ ref, path, title, score, reasons, from, snippet })),
      stockDailyResults: (wikiContext.stockDailyResults ?? []).map(({ ref, path, title, score, type, excerpt, nativeQuery }) => ({ ref, path, title, score, type, excerpt, nativeQuery })),
      marketValidation: wikiContext.marketValidation,
    },
  }
  const modelRows = buildCompanyWorkbookRows({ company, financials, ledger })
  const modelJson = {
    schema: COMPANY_RESEARCH_TEMPLATE_VERSION,
    generatedAt,
    company,
    sheets: Object.keys(modelRows),
    assumptions: modelRows.Assumptions.slice(1).map((row) => ({
      name: row[0],
      downside: row[1],
      base: row[2],
      upside: row[3],
      evidenceLevel: row[4],
      note: row[5],
    })),
    formulaPolicy: "formulas are deterministic template cells; LLM/provider text must not invent model formulas",
    evidenceRefs: ledger.rows.map((row, index) => ({ index: index + 1, dataItem: row.dataItem, evidenceLevel: row.evidenceLevel, status: row.status })),
  }
  const reportMarkdown = buildCompanyReportMarkdown({
    company,
    financials,
    ledger,
    cninfo,
    tavily: tavilyEvidence,
    wikiContext,
    generatedAt,
  })
  const wikiCandidatesMarkdown = buildWikiChangeCandidates({ company, wikiContext, ledger })
  const paths = {
    evidenceLedger: path.join(outputDir, "evidence-ledger.json"),
    evidencePack: path.join(outputDir, "evidence-pack.json"),
    financials: path.join(outputDir, "financials.json"),
    modelXlsx: path.join(outputDir, "company-model.xlsx"),
    modelJson: path.join(outputDir, "company-model.json"),
    report: path.join(outputDir, "company-report.md"),
    wikiCandidates: path.join(outputDir, "wiki-change-candidates.md"),
    runSummary: path.join(outputDir, "run-summary.json"),
  }
  await writeJson(paths.evidenceLedger, ledger)
  await writeJson(paths.evidencePack, evidencePack)
  await writeJson(paths.financials, financials)
  await writeCompanyWorkbook(paths.modelXlsx, modelRows)
  await writeJson(paths.modelJson, modelJson)
  await fs.writeFile(paths.report, reportMarkdown, "utf8")
  await fs.writeFile(paths.wikiCandidates, wikiCandidatesMarkdown, "utf8")
  const deep = options.deep
    ? await buildDeepCompanyResearchArtifacts({
        projectPath,
        outputDir,
        paths,
        company,
        financials,
        ledger,
        evidencePack,
        downloads,
        wikiCandidatesMarkdown,
        generatedAt,
        options,
      })
    : { enabled: false }
  const pluginLed = options.pluginLed
    ? await buildCompanyPluginLedArtifacts({
        projectPath,
        outputDir,
        company,
        deep,
        generatedAt,
        options,
      })
    : { enabled: false, reason: "not_requested" }
  const pluginReview = (!pluginLed.enabled && (options.pluginReview || options.pluginOptimize))
    ? await buildCompanyPluginReviewArtifacts({
        projectPath,
        outputDir,
        company,
        deep,
        generatedAt,
        options,
      })
    : { enabled: false, reason: "not_requested" }
  const pluginOptimization = (!pluginLed.enabled && options.pluginOptimize)
    ? await buildCompanyPluginOptimizationArtifacts({
        projectPath,
        outputDir,
        company,
        deep,
        pluginReview,
        generatedAt,
        options,
      })
    : { enabled: false, reason: "not_requested" }
  const runSummary = {
    mode: "company-research",
    generatedAt,
    projectPath,
    outputDir: projectRelative(projectPath, outputDir),
    company,
    providers: {
      cninfo: { mode: "public_web_adapter", configured: true, status: cninfo.status, announcements: cninfo.announcements.length, downloads: downloads.filter((item) => item.status === "success").length, error: cninfo.error ?? null },
      tushare: { configured: credentials.status.tushare.configured, auth: credentials.status.tushare.auth, status: tushareEvidence.status, calls: tushareEvidence.calls.length, error: tushareEvidence.error ?? null },
      tavily: { configured: credentials.status.tavily.configured, auth: credentials.status.tavily.auth, status: tavilyEvidence.status, queries: tavilyEvidence.queries.length, error: tavilyEvidence.error ?? null },
      wiki: { configured: true, status: wikiContext.retrievalWarnings?.length ? "partial" : "success", counts: wikiContext.counts },
    },
    providerEvents,
    deep,
    pluginLed,
    pluginReview,
    pluginOptimization,
    outputs: {
      ...Object.fromEntries(Object.entries(paths).map(([key, value]) => [key, projectRelative(projectPath, value)])),
      ...(deep.enabled ? deep.outputs : {}),
      ...(pluginLed.enabled ? {
        pluginLed: pluginLed.summary,
        pluginLedInput: pluginLed.input,
        dataAnalyticsModelAnalysis: pluginLed.outputs.dataAnalyticsModelAnalysis,
        pluginLedReport: pluginLed.outputs.pluginLedReport,
        pluginLedDraftReport: pluginLed.outputs.pluginLedDraftReport,
        reportCompleteness: pluginLed.outputs.reportCompleteness,
        publishReadiness: pluginLed.outputs.publishReadiness,
        deepReport: pluginLed.outputs.deepReport,
      } : {}),
      ...(pluginReview.enabled ? {
        pluginReview: pluginReview.summary,
        pluginReviewInput: pluginReview.input,
        dataAnalyticsReview: pluginReview.calls.find((call) => call.plugin === "data-analytics")?.output,
        publicEquityReview: pluginReview.calls.find((call) => call.plugin === "public-equity-investing")?.output,
        investmentBankingReview: pluginReview.calls.find((call) => call.plugin === "investment-banking")?.output,
      } : {}),
      ...(pluginOptimization.enabled ? {
        pluginOptimizationInput: pluginOptimization.input,
        pluginOptimizationPrompt: pluginOptimization.prompt,
        optimizedReport: pluginOptimization.output,
        publishReadiness: pluginOptimization.readiness,
        pluginOptimizationError: pluginOptimization.errorPath,
      } : {}),
    },
    writePolicy: {
      wroteRaw: false,
      wroteFormalWiki: false,
      outputRoot: COMPANY_RESEARCH_ROOT,
    },
  }
  await writeJson(paths.runSummary, runSummary)
  return {
    ...runSummary,
    outputDirPath: outputDir,
    outputPaths: paths,
    ledger,
    financials,
  }
}
