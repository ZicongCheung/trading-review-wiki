// Free, no-token financial data source for company-research.
//
// Tushare requires a paid token; when it is unavailable the company profile
// (stock name) and the core financial snapshot (revenue / net profit / assets /
// operating cashflow / ROE / market cap / PE / PB) would otherwise be empty.
//
// This module fills that gap with three zero-auth public endpoints (mirrored
// from ZhangInvest/25.A股数据源整合.py):
//   - Sina three statements (利润表/资产负债表/现金流量表)
//       quotes.sina.cn/cn/api/openapi.php/CompanyFinanceService.getFinanceReport2022
//   - Tencent gtimg realtime quote (name / total mv / PE / PB / price)
//       qt.gtimg.cn/q=sh600000  (GBK encoded, ~ separated)
//   - CNINFO company overview (行业 / 上市日期 / 主营业务)
//       www.cninfo.com.cn/data20/companyOverview/getCompanyIntroduction
//
// Note: Eastmoney's push2 quote endpoint (push2.eastmoney.com/api/qt/stock/get)
// is NOT usable in this environment — the connection is hard-blocked with
// "socket hang up" — so it has been dropped entirely in favour of Tencent gtimg.
//
// It is intentionally dependency-free (only node:https) and degrades gracefully:
// if Sina fails we still try the other endpoints and vice-versa.

import http from "node:http"
import https from "node:https"

const SINA_STMT_URL = "https://quotes.sina.cn/cn/api/openapi.php/CompanyFinanceService.getFinanceReport2022"
const CNINFO_PROFILE_URL = "http://www.cninfo.com.cn/data20/companyOverview/getCompanyIntroduction"

function httpsGetJson(url, headers = {}, timeoutMs = 20000) {
  const lib = url.startsWith("http://") ? http : https
  return new Promise((resolve, reject) => {
    const req = lib.get(
      url,
      { headers: { "User-Agent": "Mozilla/5.0", ...headers } },
      (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          res.resume()
          reject(new Error(`HTTP ${res.statusCode} for ${url}`))
          return
        }
        let body = ""
        res.setEncoding("utf8")
        res.on("data", (c) => (body += c))
        res.on("end", () => resolve(body))
      },
    )
    req.on("error", reject)
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`timeout after ${timeoutMs}ms for ${url}`)))
  })
}

// Public endpoints can intermittently reset the connection (socket hang up) or
// rate-limit us under load. Retry a few times with linear backoff before giving up.
async function withRetry(fn, { attempts = 3, backoffMs = 500 } = {}) {
  let lastErr
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (e) {
      lastErr = e
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, backoffMs * (i + 1)))
    }
  }
  throw lastErr
}

function parseJsonpSafe(body) {
  const trimmed = String(body).trim()
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return JSON.parse(trimmed)
  // JSONP: name( ... );
  const m = trimmed.match(/^[^(]*\(([\s\S]*)\)\s*;?\s*$/)
  if (m) return JSON.parse(m[1])
  throw new Error("response is not JSON or JSONP")
}

function toSinaPaperCode(stockCode) {
  const s = String(stockCode || "")
  let m = s.match(/^(SH|SZ)(\d{6})$/i)
  if (!m) {
    const code = s.match(/(\d{6})/)
    if (!code) return null
    m = [(code[1][0] === "6" || code[1][0] === "9" ? "SH" : "SZ"), code[1]]
  }
  const prefix = m[1].toUpperCase() === "SH" ? "sh" : "sz"
  return `${prefix}${m[2]}`
}

function num(v) {
  if (v == null) return null
  const n = Number(String(v).replace(/,/g, ""))
  return Number.isFinite(n) ? n : null
}

// Sina returns report_date[0] = latest period; report_list[<date>].data = line items.
async function fetchSinaStatement(paperCode, type, timeoutMs) {
  const url = `${SINA_STMT_URL}?paperCode=${paperCode}&source=${type}&type=0&page=1&num=20`
  const body = await httpsGetJson(url, { Referer: "https://quotes.sina.cn/" }, timeoutMs)
  const json = parseJsonpSafe(body)
  const data = json?.result?.data
  if (!data || !Array.isArray(data.report_date) || !data.report_list) {
    throw new Error(`unexpected sina ${type} shape`)
  }
  const latestDate = data.report_date[0]?.date_value
  const node = latestDate ? data.report_list[latestDate] : null
  const rows = (node && Array.isArray(node.data) ? node.data : []).filter(
    (x) => x && (x.item_field || x.item_title),
  )
  return { latestDate, rows }
}

// Sina uses different item_field names for banks/insurers vs ordinary firms
// (e.g. 归母净利润 = NETPARECOMPPROF for banks, PARENETP for others), so every
// lookup accepts a list of candidate fields and falls back to Chinese titles.
function findRow(rows, fields, titles) {
  const fieldList = Array.isArray(fields) ? fields : fields ? [fields] : []
  const titleList = Array.isArray(titles) ? titles : titles ? [titles] : []
  for (const f of fieldList) {
    const hit = rows.find((x) => x.item_field === f && x.item_value != null)
    if (hit) return hit
  }
  for (const t of titleList) {
    const hit = rows.find((x) => x.item_title === t && x.item_value != null)
    if (hit) return hit
  }
  return null
}

function fmtPeriod(s) {
  if (!s || s.length !== 8) return s || null
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
}

function httpsGetBuffer(url, headers = {}, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { headers: { "User-Agent": "Mozilla/5.0", ...headers } },
      (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          res.resume()
          reject(new Error(`HTTP ${res.statusCode} for ${url}`))
          return
        }
        const chunks = []
        res.on("data", (c) => chunks.push(c))
        res.on("end", () => resolve(Buffer.concat(chunks)))
      },
    )
    req.on("error", reject)
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`timeout after ${timeoutMs}ms for ${url}`)))
  })
}

// Returns a normalized quote: { stockName, totalMarketValue(元), floatMarketValue(元), peTtm, pb, close }.
async function fetchTencentQuote(paperCode, timeoutMs) {
  const tcode = paperCode.toLowerCase()
  const url = `https://qt.gtimg.cn/q=${tcode}`
  const buf = await withRetry(() => httpsGetBuffer(url, { Referer: "https://finance.qq.com/" }, timeoutMs))
  const txt = new TextDecoder("gbk").decode(buf)
  const m = txt.match(/="(.+)"/)
  if (!m) throw new Error("unexpected tencent shape")
  const f = m[1].split("~")
  // Tencent pads short names with spaces ("五 粮 液"); strip them for display.
  const rawName = (f[1] || "").replace(/[\s\u3000]/g, "")
  return {
    stockName: rawName || null,
    totalMarketValue: f[44] != null ? num(f[44]) * 1e8 : null, // 亿元 -> 元
    floatMarketValue: f[45] != null ? num(f[45]) * 1e8 : null,
    peTtm: num(f[52]),
    pb: num(f[46]),
    close: num(f[3]),
  }
}

// CNINFO company overview: the only zero-auth source that carries 行业 / 上市日期 /
// 主营业务, which Tushare stock_basic would normally provide.
// Field codes are CNINFO internal: F032V=行业, F010D=上市日期, F003V=法人代表,
// F015V=主营业务, F007N=注册资本(万元), F011V=官网, F017V=公司简介.
async function fetchCninfoProfile(code6, timeoutMs) {
  const url = `${CNINFO_PROFILE_URL}?scode=${code6}`
  const body = await withRetry(() =>
    httpsGetJson(url, { Referer: "http://www.cninfo.com.cn/" }, timeoutMs),
  )
  const json = parseJsonpSafe(body)
  const bi = json?.data?.records?.[0]?.basicInformation?.[0]
  if (!bi) throw new Error("empty cninfo profile")
  const clean = (v) => {
    const s = v == null ? "" : String(v).trim()
    return s ? s : null
  }
  return {
    industry: clean(bi.F032V),
    market: clean(bi.MARKET),
    listDate: clean(bi.F010D),
    chairman: clean(bi.F003V),
    englishName: clean(bi.F001V),
    website: clean(bi.F011V),
    mainBusiness: clean(bi.F015V),
    indexMembership: clean(bi.F044V),
    registeredCapitalWan: num(bi.F007N),
    intro: clean(bi.F017V),
  }
}

export async function collectFreeQuoteEvidence({ company, options = {} } = {}) {
  const stockCode = company?.stockCode ?? company?.tsCode ?? null
  const paperCode = toSinaPaperCode(stockCode)
  const code6 = String(stockCode || "").match(/(\d{6})/)?.[1] ?? null
  const timeoutMs = options.freeQuoteTimeoutMs ?? 20000
  const calls = []
  const errors = []

  // ---- CNINFO company overview (行业 / 上市日期 / 主营业务) ----
  let profile = null
  if (code6) {
    try {
      profile = await fetchCninfoProfile(code6, timeoutMs)
      calls.push({ apiName: "cninfo_company_profile", status: "success", rows: 1, error: null })
    } catch (e) {
      calls.push({
        apiName: "cninfo_company_profile",
        status: "failed",
        rows: 0,
        error: String(e?.message || e),
      })
      errors.push(`cninfo_company_profile: ${e?.message || e}`)
    }
  }

  // ---- Sina three statements ----
  let sina = { lrb: null, fzb: null, llb: null }
  for (const type of ["lrb", "fzb", "llb"]) {
    const apiName = `sina_financial_report_${type}`
    if (!paperCode) {
      calls.push({ apiName, status: "skipped", rows: 0, error: "cannot derive sina paper code" })
      continue
    }
    try {
      const { latestDate, rows } = await withRetry(() => fetchSinaStatement(paperCode, type, timeoutMs))
      sina[type] = { latestDate, rows }
      calls.push({ apiName, status: "success", rows: rows.length, error: null })
    } catch (e) {
      calls.push({ apiName, status: "failed", rows: 0, error: String(e?.message || e) })
      errors.push(`${apiName}: ${e?.message || e}`)
    }
  }

  // ---- Quote (Tencent gtimg only) ----
  // Eastmoney push2 is hard-blocked in this environment ("socket hang up"), so
  // Tencent gtimg is the sole realtime quote source for name / total mv / float
  // mv / PE / PB / price.
  let quote = null
  let quoteSource = null
  if (paperCode) {
    try {
      quote = await fetchTencentQuote(paperCode, timeoutMs)
      quoteSource = "tencent"
      calls.push({ apiName: "tencent_quote", status: "success", rows: 1, error: null })
    } catch (e) {
      calls.push({ apiName: "tencent_quote", status: "failed", rows: 0, error: String(e?.message || e) })
      errors.push(`tencent_quote: ${e?.message || e}`)
    }
  }

  // ---- Parse financial metrics ----
  const lrb = sina.lrb?.rows || []
  const fzb = sina.fzb?.rows || []
  const llb = sina.llb?.rows || []

  const revenue = num(
    findRow(lrb, ["BIZINCO", "BIZTOTINCO"], ["营业收入", "营业总收入"])?.item_value,
  )
  // Prefer 归母净利润; fall back to 净利润 (includes minority interest).
  const netProfit = num(
    findRow(
      lrb,
      ["NETPARECOMPPROF", "PARENETP", "NETPROFIT"],
      ["归属于母公司的净利润", "归属于母公司所有者的净利润", "净利润"],
    )?.item_value,
  )
  const totalAssets = num(findRow(fzb, ["TOTASSET"], ["资产总计"])?.item_value)
  const totalLiabilities = num(findRow(fzb, ["TOTLIAB"], ["负债合计"])?.item_value)
  const parentNetAssets = num(
    findRow(
      fzb,
      ["PARECOMPSHARRIGHT", "PARESHARRIGH"],
      ["归属于母公司股东的权益", "归属于母公司股东权益合计"],
    )?.item_value,
  )
  const operatingCashflow = num(findRow(llb, ["MANANETR"], ["经营活动产生的现金流量净额"])?.item_value)

  // Gross margin: prefer explicit field, else compute for non-financial firms.
  // Banks/insurers have no 营业成本 line, so this stays null for them by design.
  let grossMarginPct = num(findRow(lrb, ["GROSSPROFITMARGIN"], ["毛利率"])?.item_value)
  if (grossMarginPct == null) {
    const bizCost = num(findRow(lrb, ["BIZCOST"], ["营业成本"])?.item_value)
    if (revenue && bizCost != null) grossMarginPct = ((revenue - bizCost) / revenue) * 100
  }

  // ROE: prefer explicit weighted-avg field, else compute from net profit / parent
  // equity. Note this is period ROE (Q1 report => quarterly ROE), not annualized.
  let roePct = num(findRow(lrb, ["WEIGHTAVGROE"], ["加权平均净资产收益率"])?.item_value)
  if (roePct == null && netProfit != null && parentNetAssets) {
    roePct = (netProfit / parentNetAssets) * 100
  }

  const latestPeriodRaw = sina.lrb?.latestDate || sina.fzb?.latestDate || sina.llb?.latestDate || null
  const latestPeriod = fmtPeriod(latestPeriodRaw)

  // ---- Quote metrics (already normalized by the fetcher) ----
  const stockName = quote?.stockName ?? null
  const totalMarketValue = quote?.totalMarketValue ?? null
  const floatMarketValue = quote?.floatMarketValue ?? null
  const peTtm = quote?.peTtm ?? null
  const pb = quote?.pb ?? null
  const close = quote?.close ?? null

  const metrics = {
    revenue,
    netProfit,
    grossMarginPct,
    grossMargin: grossMarginPct, // workbook compatibility alias
    roePct,
    totalAssets,
    totalLiabilities,
    operatingCashflow,
    peTtm,
    pb,
    totalMarketValue,
    floatMarketValue,
    close,
  }

  // Only standard company fields are patched; the rest of the CNINFO overview is
  // exposed via `profile` so the evidence pack can carry it without polluting
  // the company object the report template iterates over.
  const companyPatch = {
    stockName: stockName || null,
    industry: profile?.industry ?? null,
    market: profile?.market ?? null,
    listDate: profile?.listDate ?? null,
  }

  const hasFinancials = revenue != null || netProfit != null || totalAssets != null || operatingCashflow != null
  const hasQuote = stockName != null || totalMarketValue != null || peTtm != null
  let status = "failed"
  if (hasFinancials && hasQuote) status = "success"
  else if (hasFinancials || hasQuote) status = "partial"

  const sourceParts = []
  if (latestPeriod) sourceParts.push("sina_statements")
  if (quoteSource) sourceParts.push(`${quoteSource}_quote`)
  if (profile) sourceParts.push("cninfo_profile")

  // A primary-source failure that a fallback recovered from is a warning, not an
  // error — otherwise every successful run would still report "socket hang up".
  const joined = errors.length ? errors.join("; ") : null

  return {
    status,
    configured: true,
    auth: "none",
    calls,
    tables: {},
    companyPatch,
    profile,
    financials: {
      latestPeriod,
      metrics,
      source: sourceParts.length ? sourceParts.join("+") : null,
      quoteSource,
    },
    warnings: status === "success" ? joined : null,
    error: status === "success" ? null : joined,
  }
}

// Merge free-quote financials on top of Tushare-derived financials (Tushare wins
// where both present; free quote fills gaps when Tushare is unavailable).
export function mergeFreeQuoteIntoFinancials(tushareFinancials = {}, freeFinancials = {}) {
  const baseMetrics = tushareFinancials.metrics || {}
  const freeMetrics = freeFinancials.metrics || {}
  const mergedMetrics = { ...baseMetrics }
  for (const [k, v] of Object.entries(freeMetrics)) {
    if (v != null && mergedMetrics[k] == null) mergedMetrics[k] = v
  }
  const freeSource = freeFinancials.source || null
  const baseSource = tushareFinancials.source || null
  let source = baseSource
  if (freeSource) source = baseSource ? `${baseSource}+${freeSource}` : freeSource
  return {
    ...tushareFinancials,
    source,
    latestPeriod: tushareFinancials.latestPeriod ?? freeFinancials.latestPeriod ?? null,
    metrics: mergedMetrics,
  }
}

// Overlay free-quote company fields only where Tushare left them null.
export function mergeFreeQuoteCompanyPatch(company = {}, patch = {}) {
  const out = { ...company }
  for (const [k, v] of Object.entries(patch)) {
    if (v != null && (out[k] == null || out[k] === "")) out[k] = v
  }
  return out
}
