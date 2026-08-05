// CLI handler for `ima-sync` (research-cockpit action).
// Progress is streamed to stderr as JSON lines; the final result is a single
// JSON object printed to stdout so the Rust gateway can JSON.parse it.
import fs from "node:fs"
import path from "node:path"
import {
  defaultStatePath,
  extractCredentials,
  ensureAuth,
  loadState,
  looksLikeAuthFailure,
  DEFAULT_KB_ID,
} from "./auth.mjs"
import { runSync, listFolders, checkConsistency } from "./sync.mjs"

function emit(type, payload) {
  try {
    process.stderr.write(JSON.stringify({ type, ...payload }) + "\n")
  } catch {
    /* ignore */
  }
}

export async function handleImaSync(args) {
  const mode = args.mode || "sync"
  const project = args.project || ""
  const statePath = defaultStatePath(project)
  const onProgress = (type, payload) => emit(type, payload)

  try {
    if (mode === "extract") {
      const input = args.har || args.input || ""
      if (!input.trim()) {
        console.log(JSON.stringify({ ok: false, needHar: true, reason: "extract 模式需要 --har <路径或refresh_token JSON>" }))
        return
      }
      const state = extractCredentials(input, statePath)
      console.log(
        JSON.stringify({
          ok: true,
          mode: "extract",
          user_id: state.user_id,
          token_head: (state.token || "").slice(0, 40),
          refresh_token_head: (state.refresh_token || "").slice(0, 40),
          source: state.source_endpoint,
          kb_id: state.knowledge_base_id || null,
        }),
      )
      return
    }

    if (mode === "status") {
      if (!fs.existsSync(statePath)) {
        console.log(JSON.stringify({ ok: false, needHar: true, reason: "未找到本地凭证，请先在设置页提取 HAR" }))
        return
      }
      const state = loadState(statePath)
      const now = Math.floor(Date.now() / 1000)
      const refreshedAt = parseInt(state.refreshed_at || "0", 10) || 0
      const valid = parseInt(state.token_valid_time || "7200", 10) || 7200
      const secondsLeft = refreshedAt ? refreshedAt + valid - now : null
      console.log(
        JSON.stringify({
          ok: true,
          mode: "status",
          user_id: state.user_id,
          token_present: !!(state.token || state.cookie_template?.["IMA-TOKEN"]),
          seconds_left: secondsLeft,
          refresh_token_present: !!state.refresh_token,
          source: state.source_endpoint,
        }),
      )
      return
    }

    // folders: list the knowledge base's root folders so the user can pick
    if (mode === "folders") {
      if (!fs.existsSync(statePath)) {
        console.log(JSON.stringify({ ok: false, needHar: true, reason: "未找到本地凭证，请先在设置页提取 HAR 或粘贴 refresh_token" }))
        return
      }
      let fstate
      try {
        fstate = await ensureAuth(statePath, false)
      } catch (ex) {
        console.log(
          JSON.stringify({
            ok: false,
            needHar: true,
            reason: `凭证校验/续期失败：${ex.message || ex}。请更新 HAR 或 refresh_token。`,
          }),
        )
        return
      }
      const kbId = args.kb || fstate.knowledge_base_id || DEFAULT_KB_ID
      emit("log", { message: `列出知识库 ${kbId} 的文件夹…` })
      try {
        const folders = await listFolders(fstate, kbId, onProgress)
        console.log(JSON.stringify({ ok: true, mode: "folders", folders }))
      } catch (ex) {
        const needHar = !!ex.needHar || (ex && looksLikeAuthFailure(null, ex))
        console.log(
          JSON.stringify({
            ok: false,
            needHar,
            mode: "folders",
            reason: ex && ex.message ? ex.message : String(ex),
          }),
        )
      }
      return
    }

    // check: 只比对本地与知识库，不下载
    if (mode === "check") {
      if (!fs.existsSync(statePath)) {
        console.log(
          JSON.stringify({
            ok: false,
            needHar: true,
            mode: "check",
            consistency: "need_config",
            reason: "未找到本地凭证，请先在设置页提取 HAR 或粘贴 refresh_token",
          }),
        )
        return
      }
      let cstate
      try {
        cstate = await ensureAuth(statePath, false)
      } catch (ex) {
        console.log(
          JSON.stringify({
            ok: false,
            needHar: true,
            mode: "check",
            consistency: "auth_error",
            reason: `凭证校验/续期失败：${ex.message || ex}。请更新 HAR 或 refresh_token。`,
          }),
        )
        return
      }
      const outDir = (args.out || "").trim()
      const folder = (args.folder || "").trim()
      if (!outDir || !folder || folder === "最新" || folder === "全部" || folder === "all" || folder === "latest") {
        console.log(
          JSON.stringify({
            ok: false,
            needHar: false,
            mode: "check",
            consistency: "need_config",
            reason: !outDir
              ? "未配置下载目录"
              : "未选定目标文件夹，请先提取凭证或刷新文件夹",
          }),
        )
        return
      }
      const kbId = args.kb || cstate.knowledge_base_id || DEFAULT_KB_ID
      emit("log", { message: `一致性检查：${outDir} ↔ ${folder}` })
      try {
        const summary = await checkConsistency({
          state: cstate,
          outDir,
          folder,
          kbId,
          onProgress,
        })
        const consistency = summary.up_to_date ? "up_to_date" : "pending"
        console.log(
          JSON.stringify({
            ok: true,
            mode: "check",
            consistency,
            up_to_date: !!summary.up_to_date,
            local_count: summary.local_count,
            remote_count: summary.remote_count,
            missing_count: summary.missing_count,
            folder: summary.folder,
            folder_id: summary.folder_id,
            message: summary.message,
          }),
        )
      } catch (ex) {
        const needHar = !!ex.needHar || (ex && looksLikeAuthFailure(null, ex))
        console.log(
          JSON.stringify({
            ok: false,
            needHar,
            mode: "check",
            consistency: needHar ? "auth_error" : "error",
            reason: ex && ex.message ? ex.message : String(ex),
          }),
        )
      }
      return
    }

    // default: sync
    if (!fs.existsSync(statePath)) {
      console.log(JSON.stringify({ ok: false, needHar: true, reason: "未找到本地凭证，请先在设置页提取 HAR 或粘贴 refresh_token" }))
      return
    }
    let state
    try {
      state = await ensureAuth(statePath, false)
    } catch (ex) {
      console.log(
        JSON.stringify({
          ok: false,
          needHar: true,
          reason: `凭证校验/续期失败：${ex.message || ex}。请更新 HAR 或 refresh_token。`,
        }),
      )
      return
    }

    const outDir = (args.out || "").trim()
    const folder = (args.folder || "").trim()
    if (!outDir) {
      console.log(
        JSON.stringify({
          ok: false,
          needHar: false,
          reason: "未配置下载目录（out），请先在设置中填写下载目录后再开始同步。",
        }),
      )
      return
    }
    if (!folder || folder === "最新" || folder === "全部" || folder === "all" || folder === "latest") {
      console.log(
        JSON.stringify({
          ok: false,
          needHar: false,
          reason: "未选定目标文件夹，请先在设置中选择要同步的 IMA 文件夹。",
        }),
      )
      return
    }
    fs.mkdirSync(outDir, { recursive: true })
    const kbId = args.kb || state.knowledge_base_id || DEFAULT_KB_ID

    emit("log", { message: `开始同步：输出目录 ${outDir}，目标文件夹 ${folder}，知识库 ${kbId}` })
    const summary = await runSync({ state, outDir, folder, kbId, onProgress })
    // up_to_date 时 message 已是「本地与 IMA 知识库中研报一致，无需更新」
    console.log(
      JSON.stringify({
        ok: true,
        mode: "sync",
        ...summary,
        downloaded: summary.ok ?? summary.downloaded ?? 0,
        skipped: summary.skip ?? summary.skipped ?? 0,
        failed: summary.fail ?? summary.failed ?? 0,
      }),
    )
  } catch (ex) {
    const needHar = !!ex.needHar || (ex && looksLikeAuthFailure(null, ex))
    console.log(
      JSON.stringify({
        ok: false,
        needHar,
        reason: ex && ex.message ? ex.message : String(ex),
      }),
    )
  }
}
