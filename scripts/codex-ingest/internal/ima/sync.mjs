// IMA report downloader (Node port of dl_folder.py, zero external deps).
// Uses built-in crypto for RSA-OAEP-SHA256 + AES-128-GCM encrypted media fetch.
import fs from "node:fs"
import path from "node:path"
import https from "node:https"
import http from "node:http"
import crypto from "node:crypto"
import { fileURLToPath } from "node:url"
import {
  makeHeaders,
  requestJson,
  refreshToken,
  looksLikeAuthFailure,
  saveState,
  DEFAULT_KB_ID,
} from "./auth.mjs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PUBKEY = fs.readFileSync(path.join(__dirname, "pubkey.pem"), "utf-8")
const IMA_HOST = "ima.qq.com"

// --- crypto: encrypted media ------------------------------------------------

async function secureGetMedia(state, mediaId, onProgress) {
  const aesKey = crypto.randomBytes(16)
  const ckey = crypto.publicEncrypt(
    { key: PUBKEY, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
    aesKey,
  )
  const pt = Buffer.from(JSON.stringify({ mediaId }), "utf-8")
  const nonce = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv("aes-128-gcm", aesKey, nonce)
  const ct = Buffer.concat([cipher.update(pt), cipher.final()])
  const tag = cipher.getAuthTag()
  // request body = base64(nonce + ct + tag), matching the Python reference
  const body = Buffer.concat([nonce, ct, tag]).toString("base64")

  const headers = makeHeaders(state)
  headers["x-ima-cm"] = "1"
  headers["x-ima-ckey"] = ckey.toString("base64")

  // Response is base64(nonce + ct + tag) where ct is AES-128-GCM encrypted with
  // the SAME aesKey. Decrypt to obtain { jump_url, jump_url_info }.
  const resp = await apiCall(state, "/cgi-bin/s/file_manager/get_media", body, headers, onProgress, true)
  const rawStr = Buffer.isBuffer(resp) ? resp.toString("utf-8") : String(resp)
  const trimmed = rawStr.trim()
  if (trimmed.startsWith("{")) {
    // server returned a JSON error instead of encrypted media
    try {
      return JSON.parse(trimmed)
    } catch {
      return { code: -2, msg: "get_media 返回了非法 JSON" }
    }
  }
  let b
  try {
    b = Buffer.from(trimmed, "base64")
  } catch {
    return { code: -2, msg: "get_media 响应 base64 解码失败" }
  }
  if (b.length < 28) {
    return { code: -2, msg: `get_media 响应长度异常: ${b.length}` }
  }
  const rNonce = b.subarray(0, 12)
  const rTag = b.subarray(b.length - 16)
  const rCt = b.subarray(12, b.length - 16)
  try {
    const decipher = crypto.createDecipheriv("aes-128-gcm", aesKey, rNonce)
    decipher.setAuthTag(rTag)
    const dec = Buffer.concat([decipher.update(rCt), decipher.final()])
    return JSON.parse(dec.toString("utf-8"))
  } catch (ex) {
    return { code: -2, msg: `get_media 解密失败: ${ex.message || ex}` }
  }
}

// --- low level api with single auth-refresh retry ---------------------------

function safeJson(raw) {
  const s = raw.toString("utf-8")
  try {
    return JSON.parse(s)
  } catch {
    return { raw: s.slice(0, 500) }
  }
}

async function apiCall(state, apiPath, payload, headers, onProgress, isRawBody = false) {
  // 注意：绝不能在 ClientRequest 上监听 "response" 再自己 emit("response", data)。
  // Node 的 https.request 在 headers 到达时会原生 emit("response", IncomingMessage)，
  // 会抢先 resolve 成未读完 body 的流对象，导致永远看不到 code/msg（表现为 code=?）。
  const doRequest = () =>
    new Promise((resolve, reject) => {
      const url = new URL(`https://${IMA_HOST}${apiPath}`)
      const bodyBuf = isRawBody ? Buffer.from(payload, "base64") : Buffer.from(JSON.stringify(payload), "utf-8")
      const req = https.request(
        url,
        {
          method: "POST",
          agent: new https.Agent({ rejectUnauthorized: false }),
          headers: {
            "Content-Type": isRawBody ? "application/octet-stream" : "application/json",
            "Content-Length": bodyBuf.length,
            ...headers,
          },
        },
        (res) => {
          const chunks = []
          res.on("data", (c) => chunks.push(c))
          res.on("end", () => {
            const raw = Buffer.concat(chunks)
            if (res.statusCode >= 400) {
              const err = new Error(`HTTP ${res.statusCode}: ${raw.toString("utf-8", 0, 200)}`)
              err._http_status = res.statusCode
              err._raw = raw.toString("utf-8", 0, 500)
              reject(err)
              return
            }
            resolve(isRawBody ? raw : safeJson(raw))
          })
          res.on("error", reject)
        },
      )
      req.on("error", reject)
      req.setTimeout(20000, () => {
        req.destroy(new Error("request timeout"))
      })
      req.write(bodyBuf)
      req.end()
    })

  const single = async () => {
    try {
      return await doRequest()
    } catch (ex) {
      const isAuth = ex._http_status === 401 || ex._http_status === 403 || looksLikeAuthFailure(null, ex)
      if (!isAuth) throw ex
      ex.needHar = true
      throw ex
    }
  }

  try {
    return await single()
  } catch (ex) {
    if (!ex.needHar) throw ex
    if (onProgress) onProgress("auth-fail", { message: ex.message || String(ex) })
    // refresh once and retry
    await refreshToken(state, true)
    if (state._statePath) {
      try {
        saveState(state, state._statePath)
      } catch {
        /* ignore */
      }
    }
    return await single()
  }
}

// --- listing ----------------------------------------------------------------

// IMA 偶发用 code=600001「服务繁忙」拒绝仍看似有效的 token；强制 refresh 后再试通常恢复。
function isImaBusy(r) {
  if (!r || typeof r !== "object") return false
  const c = r.code ?? r.ret ?? r.retcode ?? r.errcode
  if (c === 600001 || c === "600001") return true
  const m = String(r.msg || r.message || r.errmsg || "")
  return /服务繁忙|稍后重试|too many|busy|rate.?limit/i.test(m)
}

function extractListPayload(r) {
  // home_page 把列表包在 list_rsp 里；get_knowledge_list 在顶层或 data 里。
  if (!r || typeof r !== "object") return null
  if (r.list_rsp && typeof r.list_rsp === "object") return r.list_rsp
  if (r.data && typeof r.data === "object" && (r.data.knowledge_list || r.data.list_rsp)) {
    return r.data.list_rsp || r.data
  }
  return r
}

async function listOnce(state, folderId, cursor, kbId, onProgress) {
  const effectiveKb = kbId || DEFAULT_KB_ID
  // 根目录：IMA 新客户端走 get_knowledge_base_home_page；子目录走 get_knowledge_list + folder_id。
  // 两者都能列 knowledge_list；home_page 是 HAR 里打开知识库时的真实入口。
  let apiPath
  let body
  if (!folderId) {
    apiPath = "/cgi-bin/knowledge_tab_reader/get_knowledge_base_home_page"
    body = {
      knowledge_base_id: effectiveKb,
      knowledge_list_req: { sort_type: 9, limit: "50" },
    }
    if (cursor) body.knowledge_list_req.cursor = cursor
  } else {
    apiPath = "/cgi-bin/knowledge_tab_reader/get_knowledge_list"
    body = { limit: "50", sort_type: 9, knowledge_base_id: effectiveKb, folder_id: folderId }
    if (cursor) body.cursor = cursor
  }
  return apiCall(state, apiPath, body, makeHeaders(state), onProgress)
}

async function listAll(state, folderId, onProgress, kbId) {
  const items = []
  let cursor = null
  let busyRetried = false
  for (let page = 1; page < 30; page++) {
    const r = await listOnce(state, folderId, cursor, kbId, onProgress)
    // 兼容腾讯系常见返回字段名：code / ret / retcode / errcode；以及 data / list_rsp 包装。
    const rc = r && (r.code !== undefined ? r.code : r.ret !== undefined ? r.ret : r.retcode !== undefined ? r.retcode : r.errcode !== undefined ? r.errcode : undefined)
    const payload = extractListPayload(r)
    const hasList = !!(payload && Array.isArray(payload.knowledge_list))
    // 600001「服务繁忙」多半是 token 实际已不可用：强制 refresh 一次后重试当页。
    if (isImaBusy(r) && !busyRetried) {
      busyRetried = true
      if (onProgress) onProgress("log", { message: "IMA 返回 600001（服务繁忙），强制刷新 token 后重试…" })
      try {
        await refreshToken(state, true)
        if (state._statePath) {
          try {
            saveState(state, state._statePath)
          } catch {
            /* ignore */
          }
        }
      } catch (ex) {
        const err = new Error(`token 刷新失败：${ex.message || ex}`)
        err.needHar = true
        throw err
      }
      page -= 1 // re-run same page
      continue
    }
    // 失败判定：r 为空，或返回码非 0 且响应里没有 knowledge_list
    const isFail = !r || (rc !== 0 && !hasList)
    if (isFail) {
      const rm = r && r.msg != null ? r.msg : r && r.message != null ? r.message : r && r.errmsg != null ? r.errmsg : "(none)"
      const detail = !r
        ? "(no response)"
        : `code=${rc ?? "?"} msg=${JSON.stringify(rm)}` +
          (r && r.raw ? ` raw=${String(r.raw).slice(0, 200)}` : "") +
          (r && rc === undefined && r.raw == null ? ` body=${JSON.stringify(r).slice(0, 400)}` : "")
      if (onProgress) onProgress("log", { message: `list fail: ${detail}` })
      if (looksLikeAuthFailure(r) || isImaBusy(r)) {
        const err = new Error(`鉴权失败列出文件夹（${detail}）`)
        err.needHar = true
        throw err
      }
      const err = new Error(`list failed: ${detail}`)
      err.imaListFailure = true
      throw err
    }
    const kl = (payload && payload.knowledge_list) || r.knowledge_list || []
    items.push(...kl)
    if (onProgress) {
      onProgress("phase", {
        phase: "列出文件",
        current: items.length,
        total: parseInt((payload && (payload.total_size || payload.total)) || r.total_size || "0", 10) || items.length,
      })
    }
    const isEnd = payload?.is_end ?? r.is_end
    if (isEnd) break
    cursor = payload?.cursor ?? payload?.next_cursor ?? r.cursor ?? r.next_cursor
    if (!cursor) break
    await new Promise((res) => setTimeout(res, 200))
  }
  return items
}

// --- folder resolution ------------------------------------------------------

function isFolder(item) {
  // IMA uses media_type=99 for folders in current client builds; legacy refs used 2.
  // media_id always starts with "folder_" for real folders.
  const t = item?.media_type
  return t === 99 || t === 2 || String(item?.media_id || "").startsWith("folder_")
}

function parseFolderDate(name) {
  if (!name) return null
  // "2026-08-02" / "2026/08/02"
  let m = name.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  // "2026年8月2日"
  m = name.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/)
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  // "8月2日" (current/near year)
  m = name.match(/(\d{1,2})月(\d{1,2})日/)
  if (m) {
    const now = new Date()
    let year = now.getFullYear()
    const md = new Date(year, Number(m[1]) - 1, Number(m[2]))
    if (md > now) year -= 1
    return new Date(year, Number(m[1]) - 1, Number(m[2]))
  }
  return null
}

async function resolveLatestFolder(state, onProgress, kbId) {
  // 优先用 listFolders（根目录早停），避免 listAll 扫 5000+ 条
  const listed = await listFolders(state, kbId, onProgress)
  if (listed && listed.length) {
    const sorted = [...listed].sort((a, b) => {
      if (a.date && b.date) return b.date.localeCompare(a.date)
      if (a.date && !b.date) return -1
      if (!a.date && b.date) return 1
      return String(b.title || "").localeCompare(String(a.title || ""))
    })
    const top = sorted[0]
    return { title: top.title, media_id: top.media_id }
  }
  // 回退：listAll + isFolder
  const root = await listAll(state, "", onProgress, kbId)
  const folders = root.filter(isFolder)
  if (!folders.length) return null
  folders.sort((a, b) => {
    const da = parseFolderDate(a.title)
    const db = parseFolderDate(b.title)
    if (da && db) return db - da
    if (da && !db) return -1
    if (!da && db) return 1
    return String(b.title).localeCompare(String(a.title))
  })
  return folders[0]
}

async function resolveFolder(state, kwOrId, onProgress, kbId) {
  if (kwOrId && String(kwOrId).startsWith("folder_")) {
    // media_id 已知时仍尽量补全 title（列表失败则用 id 作标题）
    try {
      const listed = await listFolders(state, kbId, onProgress)
      const hit = (listed || []).find((f) => f.media_id === kwOrId)
      if (hit) return { title: hit.title, media_id: hit.media_id }
    } catch {
      /* ignore */
    }
    return { title: kwOrId, media_id: kwOrId }
  }
  if (!kwOrId || kwOrId === "latest" || kwOrId === "最新") {
    return resolveLatestFolder(state, onProgress, kbId)
  }
  const listed = await listFolders(state, kbId, onProgress)
  for (const f of listed || []) {
    if ((f.title || "").includes(kwOrId) || f.media_id === kwOrId) {
      return { title: f.title, media_id: f.media_id }
    }
  }
  return null
}

// --- download ---------------------------------------------------------------

const ALLOWED_EXTS = [
  ".pdf", ".xlsx", ".xls", ".docx", ".doc", ".pptx", ".ppt", ".mp3", ".mp4",
  ".wav", ".txt", ".csv", ".png", ".jpg", ".jpeg", ".zip", ".md", ".m4a", ".amr",
]

function sanitizeFilename(t) {
  return (t || "").replace(/[<>:"/\\|?*]/g, "").trim()
}

function extFor(item, gm) {
  const t = item.title || ""
  const ext = path.extname(t).toLowerCase()
  if (ALLOWED_EXTS.includes(ext)) return ext
  const ct = ((gm && gm.content_type) || "").toLowerCase()
  const map = {
    "application/pdf": ".pdf",
    spreadsheetml: ".xlsx",
    wordprocessingml: ".docx",
    presentationml: ".pptx",
    mpeg: ".mp3",
    audio: ".mp3",
    video: ".mp4",
    plain: ".txt",
    csv: ".csv",
    zip: ".zip",
    png: ".png",
    jpeg: ".jpg",
  }
  for (const [k, v] of Object.entries(map)) {
    if (ct.includes(k)) return v
  }
  return ".pdf"
}

// 一次性扫本地下载目录，按文件名 / stem 建索引，避免同步时反复 stat + 误调 get_media。
function buildLocalIndex(outDir) {
  const byName = new Map()
  const byStem = new Map()
  if (!outDir || !fs.existsSync(outDir)) return { byName, byStem }
  let entries = []
  try {
    entries = fs.readdirSync(outDir)
  } catch {
    return { byName, byStem }
  }
  for (const f of entries) {
    try {
      const st = fs.statSync(path.join(outDir, f))
      if (!st.isFile() || st.size <= 0) continue
    } catch {
      continue
    }
    byName.set(f.toLowerCase(), f)
    byStem.set(path.parse(f).name.toLowerCase(), f)
  }
  return { byName, byStem }
}

// 用 IMA 条目 title 在本地索引里找已存在的文件名（无需 get_media 也能判定）。
function findLocalMatch(index, title) {
  const base = sanitizeFilename(title)
  if (!base) return null
  const low = base.toLowerCase()
  if (index.byName.has(low)) return index.byName.get(low)
  for (const e of ALLOWED_EXTS) {
    if (index.byName.has(low + e)) return index.byName.get(low + e)
  }
  const stem = path.parse(base).name.toLowerCase()
  if (index.byStem.has(stem)) return index.byStem.get(stem)
  if (index.byStem.has(low)) return index.byStem.get(low)
  return null
}

function downloadFile(url, headers, outPath) {
  return new Promise((resolve) => {
    let attempts = 0
    const tryOnce = () => {
      attempts += 1
      try {
        const u = new URL(url)
        const lib = u.protocol === "http:" ? http : https
        const req = lib.get(
          u,
          {
            agent: u.protocol === "http:" ? undefined : new https.Agent({ rejectUnauthorized: false }),
            headers,
            timeout: 90000,
          },
          (res) => {
            if (res.statusCode && res.statusCode >= 400) {
              if (attempts < 3) {
                setTimeout(tryOnce, 1000)
                return
              }
              resolve({ ok: false, bytes: 0 })
              return
            }
            const f = fs.createWriteStream(outPath)
            let bytes = 0
            res.on("data", (c) => {
              bytes += c.length
            })
            res.on("end", () => {
              f.end(() => resolve({ ok: bytes > 0, bytes }))
            })
            res.on("error", () => {
              f.destroy()
              if (attempts < 3) setTimeout(tryOnce, 1000)
              else resolve({ ok: false, bytes: 0 })
            })
          },
        )
        req.on("error", () => {
          if (attempts < 3) setTimeout(tryOnce, 1000)
          else resolve({ ok: false, bytes: 0 })
        })
        req.setTimeout(90000, () => {
          req.destroy()
          if (attempts < 3) setTimeout(tryOnce, 1000)
          else resolve({ ok: false, bytes: 0 })
        })
      } catch {
        if (attempts < 3) setTimeout(tryOnce, 1000)
        else resolve({ ok: false, bytes: 0 })
      }
    }
    tryOnce()
  })
}

// --- orchestration ----------------------------------------------------------

/**
 * 只比对本地目录与 IMA 目标文件夹（单个），不下载、不调 get_media。
 * folder 可为 folder_xxx / 「最新」/ 关键字。
 */
export async function checkConsistency({ state, outDir, folder, kbId, onProgress }) {
  const effectiveKb = kbId || state?.knowledge_base_id || DEFAULT_KB_ID
  const target = await resolveFolder(state, folder, onProgress, effectiveKb)
  if (!target) {
    const err = new Error(`未找到名称包含『${folder || "最新"}』的文件夹`)
    err.needHar = false
    throw err
  }
  if (onProgress) {
    onProgress("log", { message: `目标文件夹: ${target.title} (${target.media_id})` })
  }
  const items = await listAll(state, target.media_id, onProgress, effectiveKb)
  if (onProgress) onProgress("log", { message: `共 ${items.length} 个条目` })

  const seen = new Set()
  const unique = []
  for (const i of items) {
    const md = i.md5_sum || ""
    const t = i.title || ""
    const mid = i.media_id || ""
    if (String(mid).startsWith("folder_") || isFolder(i)) continue
    if ((md && seen.has(md)) || (t && seen.has(t))) continue
    if (md) seen.add(md)
    if (t) seen.add(t)
    unique.push(i)
  }

  const localIndex = buildLocalIndex(outDir)
  const missing = []
  let alreadyLocal = 0
  for (const item of unique) {
    const hit = findLocalMatch(localIndex, item.title || "")
    if (hit) alreadyLocal += 1
    else missing.push(item)
  }
  const upToDate = unique.length > 0 && missing.length === 0
  if (onProgress) {
    onProgress("log", {
      message: `本地已有 ${alreadyLocal}/${unique.length} 份；待下载 ${missing.length} 份`,
    })
  }
  return {
    up_to_date: upToDate,
    local_count: alreadyLocal,
    remote_count: unique.length,
    missing_count: missing.length,
    folder: target.title,
    folder_id: target.media_id,
    outDir,
    target,
    unique,
    missing,
    message: upToDate
      ? "本地与 IMA 知识库中研报一致，无需更新"
      : missing.length > 0
        ? `本地缺少 ${missing.length} 份研报，待更新`
        : "知识库目标文件夹暂无研报",
  }
}

export async function runSync({ state, outDir, folder, kbId, onProgress }) {
  const check = await checkConsistency({ state, outDir, folder, kbId, onProgress })
  const { target, unique, missing, local_count: alreadyLocal } = check

  if (check.up_to_date) {
    const msg = check.message
    if (onProgress) {
      onProgress("log", { message: msg })
      onProgress("done", {
        ok: 0,
        skip: alreadyLocal,
        fail: 0,
        folder: target.title,
        downloaded: 0,
        up_to_date: true,
      })
    }
    return {
      ok: 0,
      skip: alreadyLocal,
      fail: 0,
      folder: target.title,
      outDir,
      files: [],
      up_to_date: true,
      message: msg,
      local_count: alreadyLocal,
      remote_count: unique.length,
    }
  }

  if (onProgress) onProgress("phase", { phase: "下载研报", current: 0, total: missing.length })

  const downloaded = []
  const files = []
  let ok = 0
  let skip = alreadyLocal
  let fail = 0

  for (let n = 0; n < missing.length; n++) {
    const item = missing[n]
    const t = item.title || ""
    const mid = item.media_id || ""
    if (onProgress) onProgress("item", { name: t, index: n + 1, total: missing.length })
    if (!mid) {
      if (onProgress) onProgress("item-done", { name: t, index: n + 1, total: missing.length, status: "fail", message: "无 media_id" })
      fail += 1
      continue
    }
    let gm
    try {
      const resp = await secureGetMedia(state, mid, onProgress)
      gm = Buffer.isBuffer(resp) ? JSON.parse(resp.toString("utf-8")) : resp
    } catch (ex) {
      if (ex && ex.needHar) throw ex
      if (onProgress) onProgress("item-done", { name: t, index: n + 1, total: missing.length, status: "fail", message: String(ex.message || ex) })
      fail += 1
      continue
    }
    if (!gm || gm.code !== 0) {
      if (looksLikeAuthFailure(gm)) {
        const err = new Error("auth failure fetching media")
        err.needHar = true
        throw err
      }
      if (onProgress) onProgress("item-done", { name: t, index: n + 1, total: missing.length, status: "fail", message: gm?.msg || "get_media 失败" })
      fail += 1
      continue
    }
    const url = gm.jump_url || ""
    if (!url) {
      if (onProgress) onProgress("item-done", { name: t, index: n + 1, total: missing.length, status: "fail", message: "无 jump_url" })
      fail += 1
      continue
    }
    const ext = extFor(item, gm)
    let name = sanitizeFilename(t)
    if (!name.toLowerCase().endsWith(ext)) name += ext
    const outPath = path.join(outDir, name)
    if (fs.existsSync(outPath) && fs.statSync(outPath).size > 0) {
      if (onProgress) onProgress("item-done", { name: t, index: n + 1, total: missing.length, status: "skip", message: `${fs.statSync(outPath).size} B 已存在` })
      skip += 1
      continue
    }
    const hdrs = { "User-Agent": "ima/1314 CFNetwork/3860.600.12 Darwin/25.5.0" }
    const jui = gm.jump_url_info || {}
    for (const [k, v] of Object.entries(jui.headers || {})) hdrs[k] = v
    const res = await downloadFile(url, hdrs, outPath)
    if (res.ok) {
      downloaded.push(name)
      files.push({ name, bytes: res.bytes, status: "ok" })
      if (onProgress) onProgress("item-done", { name: t, index: n + 1, total: missing.length, status: "ok", bytes: res.bytes })
      ok += 1
    } else {
      if (onProgress) onProgress("item-done", { name: t, index: n + 1, total: missing.length, status: "fail", message: "下载失败" })
      fail += 1
    }
    await new Promise((r) => setTimeout(r, 300))
  }

  if (onProgress) {
    onProgress("done", { ok, skip, fail, folder: target.title, downloaded: downloaded.length, up_to_date: false })
  }
  return { ok, skip, fail, folder: target.title, outDir, files, up_to_date: false }
}

export { listAll, resolveFolder, resolveLatestFolder, secureGetMedia, downloadFile, listFolders }

function formatLocalDate(d) {
  if (!d || !(d instanceof Date) || Number.isNaN(d.getTime())) return null
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

// List the root-level folders of the knowledge base so the user can pick a
// target instead of relying on the implicit "最新" heuristic.
// 优化：根目录 sort_type=9 时文件夹排在前面，扫到连续非文件夹页后即可停，不必翻完 5000+ 条。
async function listFolders(state, kbId, onProgress) {
  const folders = []
  let cursor = null
  let busyRetried = false
  let seenNonFolderPage = false
  for (let page = 1; page < 20; page++) {
    const r = await listOnce(state, "", cursor, kbId, onProgress)
    const rc = r && (r.code !== undefined ? r.code : r.ret !== undefined ? r.ret : r.retcode !== undefined ? r.retcode : r.errcode !== undefined ? r.errcode : undefined)
    if (isImaBusy(r) && !busyRetried) {
      busyRetried = true
      if (onProgress) onProgress("log", { message: "IMA 返回 600001（服务繁忙），强制刷新 token 后重试…" })
      try {
        await refreshToken(state, true)
        if (state._statePath) {
          try {
            saveState(state, state._statePath)
          } catch {
            /* ignore */
          }
        }
      } catch (ex) {
        const err = new Error(`token 刷新失败：${ex.message || ex}`)
        err.needHar = true
        throw err
      }
      page -= 1
      continue
    }
    const payload = extractListPayload(r)
    const hasList = !!(payload && Array.isArray(payload.knowledge_list))
    if (!r || (rc !== 0 && !hasList)) {
      const rm = r?.msg ?? r?.message ?? r?.errmsg ?? "(none)"
      const detail = !r ? "(no response)" : `code=${rc ?? "?"} msg=${JSON.stringify(rm)}`
      if (onProgress) onProgress("log", { message: `list fail: ${detail}` })
      if (looksLikeAuthFailure(r) || isImaBusy(r)) {
        const err = new Error(`鉴权失败列出文件夹（${detail}）`)
        err.needHar = true
        throw err
      }
      const err = new Error(`list failed: ${detail}`)
      err.imaListFailure = true
      throw err
    }
    const kl = payload.knowledge_list || []
    let pageFolders = 0
    for (const it of kl) {
      if (isFolder(it)) {
        pageFolders += 1
        folders.push(it)
      }
    }
    if (onProgress) {
      onProgress("phase", {
        phase: "列出文件夹",
        current: folders.length,
        total: parseInt(payload.total_size || "0", 10) || folders.length,
      })
      onProgress("log", { message: `第 ${page} 页：本页文件夹 ${pageFolders}，累计 ${folders.length}` })
    }
    // 本页没有文件夹：若已经收集到一些，说明文件夹段结束，可以停
    if (pageFolders === 0) {
      if (folders.length > 0 || seenNonFolderPage) break
      seenNonFolderPage = true
    }
    const isEnd = payload.is_end
    if (isEnd) break
    cursor = payload.cursor ?? payload.next_cursor
    if (!cursor) break
    // 已有文件夹且本页文件夹占比很低（例如 50 条里只有 0-2 个），也停
    if (folders.length > 0 && pageFolders < 3 && kl.length >= 20) break
    await new Promise((res) => setTimeout(res, 150))
  }
  return folders
    .map((f) => {
      const d = parseFolderDate(f.title)
      return {
        title: f.title || f.media_id || "",
        media_id: f.media_id || "",
        date: formatLocalDate(d),
      }
    })
    .filter((f) => f.media_id)
}
