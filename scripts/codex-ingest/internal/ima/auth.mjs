// IMA authentication helpers (Node port of ima_auth.py, zero external deps).
// Reuses the same endpoints / headers / refresh protocol documented in the
// reference Python implementation.
import fs from "node:fs"
import path from "node:path"
import https from "node:https"
import http from "node:http"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// IMA base host
const IMA_HOST = "ima.qq.com"
// Knowledge base id for the "猫在飞fly" report library (default target).
export const DEFAULT_KB_ID = "7298132001970717"

// Allow self-signed / mismatched certs like the Python reference (ssl.CERT_NONE).
const insecureAgent = new https.Agent({ rejectUnauthorized: false })

export class AuthError extends Error {
  constructor(message, { needHar = false, detail = null } = {}) {
    super(message)
    this.name = "AuthError"
    this.needHar = needHar
    this.detail = detail
  }
}

export const HAR_HINT = `[需要新 HAR]
当前 refresh_token 已失效，无法自动续期。请重新抓包后：
  1) 优先抓包含以下接口之一的请求：
       POST https://ima.qq.com/auth_login/login
       POST https://ima.qq.com/auth_login/refresh
  2) 在设置页「研报同步」区粘贴 HAR 路径或 refresh_token JSON，点保存更新本地凭证。`

export function calcBkn(token) {
  let h = 5381
  for (const ch of token) {
    h += (h << 5) + ch.codePointAt(0)
    h &= 0xffffffff
  }
  return h & 2147483647
}

export function cookieMap(s) {
  const d = {}
  for (const part of (s || "").split(";")) {
    const p = part.trim()
    if (p.includes("=")) {
      const idx = p.indexOf("=")
      d[p.slice(0, idx).trim()] = p.slice(idx + 1).trim()
    }
  }
  return d
}

// Resolve where the auth state file lives. Tied to the project dir so the
// credential is reused across syncs but never committed to git (data dir).
export function defaultStatePath(projectPath) {
  const base = projectPath && projectPath.trim() ? projectPath : process.cwd()
  return path.join(base, ".ima-auth-state.json")
}

export function loadState(statePath) {
  if (!fs.existsSync(statePath)) {
    throw new AuthError(`auth state not found: ${statePath}`, { needHar: true, detail: { path: statePath } })
  }
  return JSON.parse(fs.readFileSync(statePath, "utf-8"))
}

export function saveState(state, statePath) {
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), "utf-8")
}

export function looksLikeAuthFailure(data = null, exc = null) {
  const textParts = []
  let code = null
  let httpStatus = null
  if (data && typeof data === "object") {
    code = data.code
    httpStatus = data._http_status
    for (const k of ["msg", "message", "error", "raw"]) {
      if (data[k] != null) textParts.push(String(data[k]))
    }
    try {
      textParts.push(JSON.stringify(data).slice(0, 500))
    } catch {
      /* ignore */
    }
  }
  if (exc != null) {
    textParts.push(String(exc && exc.stack ? exc.stack : exc))
  }
  const blob = textParts.join(" ").toLowerCase()
  const keywords = [
    "auth", "token", "login", "unauthorized", "forbidden", "expire", "expired",
    "invalid", "未登录", "登录", "过期", "失效", "鉴权", "票据", "session", "refresh",
  ]
  if (httpStatus === 401 || httpStatus === 403) return true
  if ([401, 403, -401, -403, 10001, 10002, 10003, 10004, 11000, 11001].includes(code)) return true
  if (code != null && code !== 0 && keywords.some((k) => blob.includes(k))) return true
  if (["token", "auth", "login", "expire", "未登录", "过期", "失效"].some((k) => blob.includes(k))) {
    if (blob.includes("http error 401") || blob.includes("http error 403")) return true
    if (blob.includes("refresh failed") || blob.includes("auth")) return true
  }
  return false
}

// --- HTTP helpers -----------------------------------------------------------

function requestJson(fullPath, headers, payload, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const url = new URL(fullPath.startsWith("http") ? fullPath : `https://${IMA_HOST}${fullPath}`)
    const body = Buffer.from(JSON.stringify(payload), "utf-8")
    const lib = url.protocol === "http:" ? http : https
    const agent = url.protocol === "http:" ? undefined : insecureAgent
    const req = lib.request(
      url,
      {
        method: "POST",
        agent,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": body.length,
          ...headers,
        },
      },
      (res) => {
        const chunks = []
        res.on("data", (c) => chunks.push(c))
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf-8")
          let data
          try {
            data = JSON.parse(raw)
          } catch {
            data = { raw }
          }
          if (res.statusCode >= 400) {
            data._http_status = res.statusCode
            const err = new Error(`HTTP ${res.statusCode}: ${raw.slice(0, 500)}`)
            err.data = data
            reject(err)
            return
          }
          resolve(data)
        })
      },
    )
    req.on("error", reject)
    if (timeout) req.setTimeout(timeout, () => req.destroy(new Error("request timeout")))
    req.write(body)
    req.end()
  })
}

export function makeHeaders(state, token = null) {
  const tok = token != null ? token : state.token || ""
  const cm = { ...(state.cookie_template || {}) }
  if (tok) cm["IMA-TOKEN"] = tok
  const hd = { ...(state.base_headers || {}) }
  hd["Content-Type"] = hd["Content-Type"] || "application/json"
  hd["Accept"] = hd["Accept"] || "*/*"
  hd["Origin"] = hd["Origin"] || "https://ima.qq.com"
  hd["Referer"] = hd["Referer"] || "https://ima.qq.com"
  hd["from_browser_ima"] = hd["from_browser_ima"] || "1"
  hd["x-ima-cookie"] = Object.entries(cm)
    .map(([k, v]) => `${k}=${v}`)
    .join(";")
  if (tok) hd["x-ima-bkn"] = String(calcBkn(tok))
  return hd
}

export async function refreshToken(state, force = false, skewSec = 120) {
  const now = Math.floor(Date.now() / 1000)
  const valid = parseInt(state.token_valid_time || "7200", 10) || 7200
  const refreshedAt = parseInt(state.refreshed_at || "0", 10) || 0
  const token = state.token || ""
  if (!force && token && refreshedAt && now < refreshedAt + Math.max(60, valid - skewSec)) {
    return state
  }
  if (!state.refresh_token) {
    const err = new AuthError("missing refresh_token in auth state", { needHar: true })
    throw err
  }
  const payload = {
    user_id: state.user_id || "",
    refresh_token: state.refresh_token,
    token_type: state.token_type || 14,
    registration_id: state.registration_id || "",
  }
  const headers = makeHeaders(state, token || "AAAA")
  let data
  try {
    data = await requestJson("/auth_login/refresh", headers, payload)
  } catch (ex) {
    throw new AuthError(`refresh request failed: ${ex.message || ex}`, { needHar: true, detail: String(ex) })
  }
  if (data.code != null && data.code !== 0) {
    throw new AuthError(`refresh failed: code=${data.code} ${data.msg || ""}`, { needHar: true, detail: data })
  }
  if (!data.token) {
    throw new AuthError("refresh returned no token", { needHar: true, detail: data })
  }
  state.token = data.token
  state.token_valid_time = parseInt(data.token_valid_time || "7200", 10) || 7200
  if (data.refresh_token) state.refresh_token = data.refresh_token
  if (data.refresh_token_valid_time != null) {
    state.refresh_token_valid_time = parseInt(data.refresh_token_valid_time || "0", 10) || 0
  }
  if (data.user_id) state.user_id = data.user_id
  state.refreshed_at = now
  const ct = { ...(state.cookie_template || {}) }
  ct["IMA-TOKEN"] = state.token
  if (state.user_id) ct["IMA-UID"] = state.user_id
  state.cookie_template = ct
  return state
}

// --- HAR extraction ---------------------------------------------------------

function extractFromHarInternal(harPath, statePath) {
  const har = JSON.parse(fs.readFileSync(harPath, "utf-8"))
  const entries = har.log.entries
  let loginEntry = null
  let refreshEntry = null
  let cookieEntry = null
  let homeEntry = null
  for (const e of entries) {
    const url = e.request.url.replace(/\/$/, "")
    const hs = {}
    for (const h of e.request.headers) hs[h.name] = h.value
    if ("x-ima-cookie" in hs && !cookieEntry) cookieEntry = hs
    if (url.endsWith("/auth_login/login")) loginEntry = e
    if (url.endsWith("/auth_login/refresh")) refreshEntry = e
    if (url.includes("get_knowledge_base_home_page") || url.includes("get_knowledge_list")) homeEntry = e
  }

  let refreshTokenVal = ""
  let token = ""
  let userId = ""
  let tokenType = 14
  let registrationId = ""
  let tokenValidTime = 7200
  let refreshTokenValidTime = 0
  let sourceEndpoint = ""
  let baseHeadersSrc = null

  if (loginEntry) {
    const reqBody = JSON.parse(loginEntry.request.postData?.text || "{}")
    const resp = JSON.parse(loginEntry.response.content.text || "{}")
    if (resp.code === 0 && resp.refresh_token) {
      refreshTokenVal = resp.refresh_token
      token = resp.token || ""
      userId = resp.user_id || ""
      tokenType = resp.token_type || 14
      registrationId = reqBody.registration_id || ""
      tokenValidTime = parseInt(resp.token_valid_time || "7200", 10) || 7200
      refreshTokenValidTime = parseInt(resp.refresh_token_valid_time || "0", 10) || 0
      sourceEndpoint = "/auth_login/login"
      baseHeadersSrc = {}
      for (const h of loginEntry.request.headers) baseHeadersSrc[h.name] = h.value
    }
  }

  if (!refreshTokenVal && refreshEntry) {
    const rhs = {}
    for (const h of refreshEntry.request.headers) rhs[h.name] = h.value
    const body = JSON.parse(refreshEntry.request.postData?.text || "{}")
    if (body.refresh_token) {
      refreshTokenVal = body.refresh_token
      userId = body.user_id || ""
      tokenType = body.token_type || 14
      registrationId = body.registration_id || ""
      sourceEndpoint = "/auth_login/refresh"
      baseHeadersSrc = rhs
      try {
        const resp = JSON.parse(refreshEntry.response.content.text || "{}")
        if (resp.token) {
          token = resp.token
          tokenValidTime = parseInt(resp.token_valid_time || "7200", 10) || 7200
        }
        if (resp.refresh_token) refreshTokenVal = resp.refresh_token
        if (resp.refresh_token_valid_time != null) {
          refreshTokenValidTime = parseInt(resp.refresh_token_valid_time || "0", 10) || 0
        }
      } catch {
        /* ignore */
      }
    }
  }

  if (!refreshTokenVal) {
    throw new AuthError("HAR has neither /auth_login/login nor /auth_login/refresh with refresh_token", {
      needHar: true,
      detail: { har: harPath },
    })
  }

  // Build cookie_template from the entry whose IMA-TOKEN matches the login token.
  let cm = {}
  for (const e of entries) {
    const hs = {}
    for (const h of e.request.headers) hs[h.name] = h.value
    if (!("x-ima-cookie" in hs)) continue
    const cand = cookieMap(hs["x-ima-cookie"])
    if (token && cand["IMA-TOKEN"] === token) {
      cm = cand
      break
    }
    if (cand["IMA-TOKEN"]) cm = cand
  }
  if (!Object.keys(cm).length && cookieEntry) {
    cm = cookieMap(cookieEntry["x-ima-cookie"] || "")
  }
  if (token) cm["IMA-TOKEN"] = token
  if (userId) cm["IMA-UID"] = userId
  if (!userId) userId = cm["IMA-UID"] || ""

  if (homeEntry) {
    baseHeadersSrc = {}
    for (const h of homeEntry.request.headers) baseHeadersSrc[h.name] = h.value
  }
  // Best-effort: extract the knowledge_base_id from the home/list request body so
  // the user doesn't have to find it manually. NOTE: a share link's `shareId` is a
  // different identifier and cannot be used as knowledge_base_id directly.
  let knowledgeBaseId = ""
  if (homeEntry) {
    try {
      const hb = JSON.parse(homeEntry.request.postData?.text || "{}")
      if (hb.knowledge_base_id) knowledgeBaseId = String(hb.knowledge_base_id)
    } catch {
      /* ignore */
    }
  }
  if (!baseHeadersSrc) baseHeadersSrc = {}
  const baseHeaders = {}
  for (const [k, v] of Object.entries(baseHeadersSrc)) {
    const lk = k.toLowerCase()
    if (["host", "content-length", "accept-encoding", "connection", "x-ima-cookie", "x-ima-bkn"].includes(lk)) {
      continue
    }
    baseHeaders[k] = v
  }

  const state = {
    user_id: userId,
    refresh_token: refreshTokenVal,
    token_type: tokenType,
    registration_id: registrationId,
    cookie_template: cm,
    token: token || cm["IMA-TOKEN"] || "",
    token_valid_time: tokenValidTime,
    refresh_token_valid_time: refreshTokenValidTime,
    refreshed_at: token ? Math.floor(Date.now() / 1000) : 0,
    source_har: harPath,
    source_endpoint: sourceEndpoint,
    base_headers: baseHeaders,
    knowledge_base_id: knowledgeBaseId,
  }
  saveState(state, statePath)
  return state
}

// input may be:
//  - a HAR file path (ends with .har / .json and exists on disk)
//  - a JSON object string {refresh_token, user_id?, registration_id?, token?}
//  - a JSON string literal ("<token>") -> treated as refresh_token
//  - a bare refresh_token value (plain token string) -> recognized directly
function buildManualState(refresh_token, parsed, statePath) {
  const state = {
    user_id: parsed?.user_id || "",
    refresh_token: refresh_token,
    token_type: parsed?.token_type || 14,
    registration_id: parsed?.registration_id || "",
    cookie_template: parsed?.cookie_template || {},
    token: parsed?.token || "",
    token_valid_time: parsed?.token_valid_time || 7200,
    refresh_token_valid_time: parsed?.refresh_token_valid_time || 0,
    refreshed_at: 0,
    source_har: "manual",
    source_endpoint: "manual",
    base_headers: parsed?.base_headers || {},
  }
  saveState(state, statePath)
  return state
}

function extractFromManualInternal(input, statePath) {
  const trimmed = (input || "").trim()
  if (!trimmed) {
    throw new AuthError("输入为空：请填写 HAR 文件路径，或 refresh_token（可直接粘贴 token 值）", { needHar: true })
  }
  let parsed
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    parsed = undefined
  }
  // JSON string literal -> unwrap to { refresh_token }
  if (typeof parsed === "string") {
    return buildManualState(parsed, { refresh_token: parsed }, statePath)
  }
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    if (parsed.refresh_token) {
      return buildManualState(parsed.refresh_token, parsed, statePath)
    }
    throw new AuthError("JSON 缺少 refresh_token 字段", { needHar: true })
  }
  // Bare refresh_token: a plain token string (not JSON, not a file path)
  if (!fs.existsSync(trimmed)) {
    return buildManualState(trimmed, { refresh_token: trimmed }, statePath)
  }
  throw new AuthError("无法识别输入：请填写 HAR 文件路径，或 refresh_token（可直接粘贴 token 值）", { needHar: true })
}

// High level: extract credentials from a HAR path, a JSON string, or a bare token.
export function extractCredentials(input, statePath) {
  const trimmed = (input || "").trim()
  // Existing file (HAR or .json) -> try HAR parse, then read content as manual JSON
  if (fs.existsSync(trimmed) && /\.(har|json)$/i.test(trimmed)) {
    try {
      return extractFromHarInternal(trimmed, statePath)
    } catch {
      /* not a HAR (e.g. a manual credentials .json) -> fall through */
    }
    try {
      const content = fs.readFileSync(trimmed, "utf-8")
      return extractFromManualInternal(content, statePath)
    } catch {
      /* fall through */
    }
  }
  return extractFromManualInternal(trimmed, statePath)
}

// Refresh-on-load. Returns the (possibly refreshed) state.
// Always persists after a successful refresh so subsequent calls (list/sync)
// reuse the same valid token — otherwise in-memory refresh is lost and the
// server may answer 600001「服务繁忙」with a stale token.
export async function ensureAuth(statePath, forceRefresh = false) {
  if (!fs.existsSync(statePath)) {
    throw new AuthError(`auth state not found: ${statePath}`, { needHar: true, detail: { path: statePath } })
  }
  const before = loadState(statePath)
  const tokenBefore = before.token || ""
  const state = await refreshToken(before, forceRefresh)
  if ((state.token || "") !== tokenBefore || forceRefresh) {
    try {
      saveState(state, statePath)
    } catch {
      /* non-fatal: in-memory state still usable this process */
    }
  }
  // stash path so callers (e.g. sync retries) can re-persist after a mid-flight refresh
  state._statePath = statePath
  return state
}

export { requestJson }
