/**
 * IMA 研报本地一致性检查（启动 / 保存配置时调用）。
 * 走 research-cockpit `ima-sync --mode check`，不下载。
 * 范围：仅当前配置的目标文件夹（folder_xxx），不做全库对比。
 *
 * App 启动：`resolveLatest: true` 时会先拉文件夹列表、自动选最新夹并落盘，再比对。
 */
import { runResearchCockpitCommand } from "@/commands/research-cockpit"
import { saveImaSyncConfig } from "@/lib/project-store"
import { useWikiStore, type ImaSyncConfig, type ImaConsistency } from "@/stores/wiki-store"

const DEFAULT_OUT_DIR_DISPLAY = "/raw/sources/研报"

function resolveDataWorkspace(projectPath?: string): string {
  if (!projectPath) return ""
  const sep = projectPath.includes("/") ? "/" : "\\"
  const suffix = ["zTradingData", "小张的交易复盘"].join(sep)
  if (projectPath.endsWith(suffix)) return projectPath
  return [projectPath, "zTradingData", "小张的交易复盘"].join(sep)
}

/** 界面路径 → 真实绝对路径（与 ima-sync-section 保持一致） */
export function resolveImaOutDir(display: string, projectPath?: string): string {
  const v = (display || "").trim()
  if (!v) return ""
  if (/^[A-Za-z]:[\\/]/.test(v)) return v
  const ws = resolveDataWorkspace(projectPath)
  const rel = v.replace(/^[/\\]+/, "")
  if (!ws) return rel
  const sep = ws.includes("/") ? "/" : "\\"
  return [ws, rel].join(sep)
}

/** 是否为可用的目标文件夹 id（folder_xxx），排除「全部/最新」等伪值 */
export function isRealImaFolder(folder?: string | null): boolean {
  const f = (folder || "").trim()
  if (!f) return false
  if (f === "全部" || f === "最新" || f === "all" || f === "latest") return false
  return f.startsWith("folder_") || f.length > 0
}

/** 至少有下载目录（凭证在 .ima-auth-state.json；启动时可再自动解析最新夹） */
export function hasImaOutDir(cfg: ImaSyncConfig | null | undefined): boolean {
  return !!(cfg?.outDir || "").trim()
}

/** 完整配置：下载目录 + 真实目标文件夹 */
export function isImaConfigured(cfg: ImaSyncConfig | null | undefined): boolean {
  if (!cfg) return false
  return hasImaOutDir(cfg) && isRealImaFolder(cfg.folder)
}

export interface ImaFolderItem {
  title: string
  media_id: string
  date: string | null
}

/** 按日期降序取最新文件夹（与设置页 / CLI resolveLatestFolder 一致） */
export function pickLatestImaFolder(folders: ImaFolderItem[]): ImaFolderItem | null {
  if (!folders?.length) return null
  const sorted = [...folders].sort((a, b) => {
    const da = a.date || ""
    const db = b.date || ""
    if (da && db) return db.localeCompare(da)
    if (da) return -1
    if (db) return 1
    return (b.title || "").localeCompare(a.title || "", "zh")
  })
  return sorted[0] || null
}

interface CheckResult {
  ok: boolean
  needHar?: boolean
  consistency?: ImaConsistency | string
  up_to_date?: boolean
  local_count?: number
  remote_count?: number
  missing_count?: number
  folder?: string
  message?: string
  reason?: string
}

interface FoldersResult {
  ok: boolean
  needHar?: boolean
  folders?: ImaFolderItem[]
  reason?: string
}

let inFlight: Promise<void> | null = null
let lastKey = ""
let lastAt = 0

/**
 * 拉取知识库文件夹列表，选出最新夹，写回 store + 持久化。
 * 成功返回更新后的 config；失败时已写好 imaSyncStatus，返回 null。
 */
export async function resolveAndPersistLatestImaFolder(opts: {
  projectPath: string
  config: ImaSyncConfig
}): Promise<ImaSyncConfig | null> {
  const { projectPath, config } = opts
  const store = useWikiStore.getState()

  store.setImaSyncStatus((s) => ({
    ...s,
    consistency: "checking",
    consistencyDetail: "正在获取知识库最新文件夹…",
  }))

  try {
    const args = ["--mode", "folders"]
    if (config.kbId?.trim()) args.push("--kb", config.kbId.trim())
    const res = await runResearchCockpitCommand<FoldersResult>(projectPath, "ima-sync", args)

    if (!res) {
      store.setImaSyncStatus((s) => ({
        ...s,
        consistency: "error",
        consistencyDetail: "获取文件夹列表无响应",
      }))
      return null
    }

    if (res.needHar) {
      store.setImaSyncStatus((s) => ({
        ...s,
        consistency: "auth_error",
        consistencyDetail: res.reason || "凭证失效，请到设置页更新",
        error: res.reason || s.error,
      }))
      return null
    }

    if (!res.ok) {
      store.setImaSyncStatus((s) => ({
        ...s,
        consistency: "error",
        consistencyDetail: res.reason || "获取文件夹列表失败",
      }))
      return null
    }

    const latest = pickLatestImaFolder(res.folders || [])
    if (!latest?.media_id) {
      store.setImaSyncStatus((s) => ({
        ...s,
        consistency: "need_config",
        consistencyDetail: "知识库中未找到文件夹，请到设置页检查",
      }))
      return null
    }

    const merged: ImaSyncConfig = {
      ...config,
      folder: latest.media_id,
      enabled: true,
    }
    store.setImaSyncConfig(merged)
    try {
      await saveImaSyncConfig(merged)
    } catch {
      /* 持久化失败不阻断本次 check */
    }
    store.setImaSyncStatus((s) => ({
      ...s,
      consistency: "checking",
      consistencyDetail: `已自动选择最新文件夹「${latest.title}」，正在比对…`,
    }))
    return merged
  } catch (err) {
    store.setImaSyncStatus((s) => ({
      ...s,
      consistency: "error",
      consistencyDetail: String(err),
    }))
    return null
  }
}

/**
 * 对当前 store 中的 imaSyncConfig 做一致性检查并写回 imaSyncStatus。
 * 并发调用会复用同一次 in-flight；短时间同配置去抖。
 *
 * @param resolveLatest 为 true 时（App 启动默认）：先拉文件夹并自动选最新夹再比对。
 *                      为 false 时（设置页保存）：必须已有真实 folder。
 */
export async function runImaConsistencyCheck(opts?: {
  projectPath?: string
  config?: ImaSyncConfig
  force?: boolean
  /** App 启动时 true：自动获取并锁定最新目标文件夹 */
  resolveLatest?: boolean
}): Promise<void> {
  const store = useWikiStore.getState()
  const projectPath = opts?.projectPath || store.project?.path
  let cfg = opts?.config || store.imaSyncConfig
  const resolveLatest = !!opts?.resolveLatest

  if (!projectPath) {
    store.setImaSyncStatus((s) => ({
      ...s,
      consistency: "need_config",
      consistencyDetail: "请先打开一个项目",
      localCount: 0,
      remoteCount: 0,
      missingCount: 0,
    }))
    return
  }

  // 启动自动解析最新夹：只需下载目录；否则需完整 folder
  if (resolveLatest) {
    if (!hasImaOutDir(cfg)) {
      store.setImaSyncStatus((s) => ({
        ...s,
        consistency: "need_config",
        consistencyDetail: "请到设置页配置 IMA 凭证与下载目录",
        localCount: 0,
        remoteCount: 0,
        missingCount: 0,
      }))
      return
    }
  } else if (!isImaConfigured(cfg)) {
    store.setImaSyncStatus((s) => ({
      ...s,
      consistency: "need_config",
      consistencyDetail: "请到设置页配置 IMA 凭证、下载目录与目标文件夹",
      localCount: 0,
      remoteCount: 0,
      missingCount: 0,
    }))
    return
  }

  // 同步进行中不打断
  if (store.imaSyncStatus.running && !opts?.force) return

  // 去抖 key：启动 resolveLatest 时 folder 会变，用 out+kb
  const resolvedOut = resolveImaOutDir(cfg.outDir || DEFAULT_OUT_DIR_DISPLAY, projectPath)
  const keyBase = resolveLatest
    ? `${projectPath}|${resolvedOut}|latest|${cfg.kbId || ""}`
    : `${projectPath}|${resolvedOut}|${(cfg.folder || "").trim()}|${cfg.kbId || ""}`
  const now = Date.now()
  if (!opts?.force && keyBase === lastKey && now - lastAt < 8000) return
  if (inFlight) return inFlight

  store.setImaSyncStatus((s) => ({
    ...s,
    consistency: "checking",
    consistencyDetail: resolveLatest
      ? "正在获取最新文件夹并比对…"
      : "正在比对本地与目标文件夹…",
  }))

  inFlight = (async () => {
    try {
      // App 启动：自动拉取最新文件夹并写回配置
      if (resolveLatest) {
        const updated = await resolveAndPersistLatestImaFolder({
          projectPath,
          config: cfg,
        })
        if (!updated) return // 状态已在 resolve 里写好
        cfg = updated
      }

      const folder = (cfg.folder || "").trim()
      if (!isRealImaFolder(folder)) {
        useWikiStore.getState().setImaSyncStatus((s) => ({
          ...s,
          consistency: "need_config",
          consistencyDetail: "未选定目标文件夹",
        }))
        return
      }

      const args = ["--mode", "check", "--out", resolvedOut, "--folder", folder]
      if (cfg.kbId?.trim()) {
        args.push("--kb", cfg.kbId.trim())
      }
      const res = await runResearchCockpitCommand<CheckResult>(projectPath, "ima-sync", args)
      lastKey = keyBase
      lastAt = Date.now()

      if (!res) {
        useWikiStore.getState().setImaSyncStatus((s) => ({
          ...s,
          consistency: "error",
          consistencyDetail: "检查无响应",
        }))
        return
      }

      if (res.needHar || res.consistency === "auth_error") {
        useWikiStore.getState().setImaSyncStatus((s) => ({
          ...s,
          consistency: "auth_error",
          consistencyDetail: res.reason || "凭证失效，请到设置页更新",
          error: res.reason || s.error,
        }))
        return
      }

      if (res.consistency === "need_config" || (!res.ok && res.consistency === "need_config")) {
        useWikiStore.getState().setImaSyncStatus((s) => ({
          ...s,
          consistency: "need_config",
          consistencyDetail: res.reason || "配置不完整",
        }))
        return
      }

      if (!res.ok) {
        useWikiStore.getState().setImaSyncStatus((s) => ({
          ...s,
          consistency: "error",
          consistencyDetail: res.reason || "一致性检查失败",
        }))
        return
      }

      const upToDate = !!res.up_to_date || res.consistency === "up_to_date"
      const localCount = res.local_count ?? 0
      const remoteCount = res.remote_count ?? 0
      const missingCount = res.missing_count ?? Math.max(0, remoteCount - localCount)
      const folderLabel = res.folder || folder

      useWikiStore.getState().setImaSyncStatus((s) => ({
        ...s,
        consistency: upToDate ? "up_to_date" : "pending",
        consistencyDetail:
          res.message ||
          (upToDate
            ? `「${folderLabel}」本地 ${localCount}/${remoteCount} 份，无需更新`
            : `「${folderLabel}」本地 ${localCount}/${remoteCount}，缺 ${missingCount} 份`),
        localCount,
        remoteCount,
        missingCount,
        error: null,
      }))
    } catch (err) {
      useWikiStore.getState().setImaSyncStatus((s) => ({
        ...s,
        consistency: "error",
        consistencyDetail: String(err),
      }))
    } finally {
      inFlight = null
    }
  })()

  return inFlight
}
