import { useState, useEffect, useCallback, useRef } from "react"
import { useWikiStore, type ImaSyncConfig } from "@/stores/wiki-store"
import { saveImaSyncConfig, loadImaSyncConfig } from "@/lib/project-store"
import { runResearchCockpitCommand } from "@/commands/research-cockpit"
import { runImaConsistencyCheck, isRealImaFolder } from "@/lib/ima-consistency"
import { listen } from "@tauri-apps/api/event"
import { open } from "@tauri-apps/plugin-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  RefreshCw,
  KeyRound,
  FolderOpen,
  Download,
  FileCheck,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
} from "lucide-react"

interface ImaFolderItem {
  title: string
  media_id: string
  date: string | null
}

interface ImaResult {
  ok: boolean
  needHar?: boolean
  reason?: string
  mode?: string
  user_id?: string
  token_head?: string
  refresh_token_head?: string
  source?: string
  seconds_left?: number | null
  refresh_token_present?: boolean
  kb_id?: string | null
  folder?: string
  downloaded?: number
  skipped?: number
  failed?: number
  files?: { name: string; bytes: number; status: string }[]
  folders?: ImaFolderItem[]
  /** 本地已与 IMA 目标文件夹完全一致 */
  up_to_date?: boolean
  message?: string
  local_count?: number
  remote_count?: number
}

const DEFAULT_KB_ID = "7298132001970717"
const DEFAULT_OUT_DIR_DISPLAY = "/raw/sources/研报"

// 复盘库（数据工作区）位置：GUI 实际写入目录
function resolveDataWorkspace(projectPath?: string): string {
  if (!projectPath) return ""
  const sep = projectPath.includes("/") ? "/" : "\\"
  const suffix = ["zTradingData", "小张的交易复盘"].join(sep)
  if (projectPath.endsWith(suffix)) return projectPath
  return [projectPath, "zTradingData", "小张的交易复盘"].join(sep)
}

// 把界面上填写的「相对复盘库位置」的路径解析为真实文件系统路径
function resolveOutDir(display: string, projectPath?: string): string {
  const v = (display || "").trim()
  if (!v) return ""
  // Windows 绝对路径（如 C:\... 或 D:/...）原样使用
  if (/^[A-Za-z]:[\\/]/.test(v)) return v
  const ws = resolveDataWorkspace(projectPath)
  const rel = v.replace(/^[/\\]+/, "")
  if (!ws) return rel
  const sep = ws.includes("/") ? "/" : "\\"
  return [ws, rel].join(sep)
}

// 把已保存的绝对路径在界面上显示为相对复盘库位置的形式（如 /raw/sources/研报）
function toDisplayOutDir(saved: string, projectPath?: string): string {
  const v = (saved || "").trim()
  if (!v) return DEFAULT_OUT_DIR_DISPLAY
  if (/^[A-Za-z]:[\\/]/.test(v)) {
    const ws = resolveDataWorkspace(projectPath)
    if (ws && v.startsWith(ws)) {
      // 切片后把 Windows 反斜杠统一转成正斜杠，避免显示成 /raw\sources\研报
      const rel = v.slice(ws.length).replace(/^[\\/]+/, "").replace(/\\/g, "/")
      return rel ? "/" + rel : DEFAULT_OUT_DIR_DISPLAY
    }
    return v.replace(/\\/g, "/")
  }
  // 用户直接输入的相对路径也可能含反斜杠，统一规范化
  return v.replace(/\\/g, "/")
}

/** 迁移：旧配置里的「全部/最新」清空，需用户重新选文件夹 */
function normalizeFolder(folder?: string): string {
  const f = (folder || "").trim()
  if (!f || f === "全部" || f === "最新" || f === "all" || f === "latest") return ""
  return f
}

export function ImaSyncSection() {
  const project = useWikiStore((s) => s.project)
  const imaSyncConfig = useWikiStore((s) => s.imaSyncConfig)
  const setImaSyncConfig = useWikiStore((s) => s.setImaSyncConfig)
  const imaSyncStatus = useWikiStore((s) => s.imaSyncStatus)
  const setImaSyncStatus = useWikiStore((s) => s.setImaSyncStatus)

  const [harInput, setHarInput] = useState(imaSyncConfig.harPath)
  const [outDir, setOutDir] = useState(imaSyncConfig.outDir || DEFAULT_OUT_DIR_DISPLAY)
  const [folder, setFolder] = useState(normalizeFolder(imaSyncConfig.folder))
  const [kbId, setKbId] = useState(imaSyncConfig.kbId)
  const [folders, setFolders] = useState<ImaFolderItem[]>([])
  const [foldersLoading, setFoldersLoading] = useState(false)
  const [logs, setLogs] = useState<string[]>([])
  const [manualOpen, setManualOpen] = useState(false)
  const [manualInput, setManualInput] = useState("")
  const [statusInfo, setStatusInfo] = useState<ImaResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  /** 每个项目只静默自动拉一次文件夹列表，避免 folder/kb 变化后重复请求 */
  const autoFoldersLoadedForPath = useRef<string | null>(null)
  /** 指向最新 handleRefreshFolders，供 load 配置 effect 在定义前安全调用 */
  const refreshFoldersRef = useRef<
    (opts?: { autoSelectLatest?: boolean; nextKb?: string; quiet?: boolean }) => Promise<void>
  >(async () => {})

  useEffect(() => {
    let active = true
    if (project) {
      loadImaSyncConfig()
        .then((cfg) => {
          if (!active) return
          const base: ImaSyncConfig = cfg ?? {
            enabled: true,
            harPath: "",
            outDir: "",
            folder: "",
            kbId: "",
          }
          const outDirValue = toDisplayOutDir(base.outDir || "", project.path) || DEFAULT_OUT_DIR_DISPLAY
          const folderValue = normalizeFolder(base.folder)
          setHarInput(base.harPath)
          setOutDir(outDirValue)
          setFolder(folderValue)
          setKbId(base.kbId)
          const merged = { ...base, outDir: outDirValue, folder: folderValue }
          setImaSyncConfig(merged)
          // 旧「全部/最新」需写回空 folder，避免残留
          if (base.folder !== folderValue) {
            void saveImaSyncConfig(merged)
          }
          // 方案 A：配置就绪后静默拉一次列表，下拉显示「8月2日」而非 folder_xxx（已保存）
          if (autoFoldersLoadedForPath.current !== project.path) {
            autoFoldersLoadedForPath.current = project.path
            void refreshFoldersRef.current({
              quiet: true,
              autoSelectLatest: false,
              nextKb: base.kbId || "",
            })
          }
        })
        .catch(() => {})
    }
    return () => {
      active = false
    }
  }, [project, setImaSyncConfig])

  const persist = useCallback(
    (next: Partial<ImaSyncConfig>, opts?: { check?: boolean }) => {
      const merged: ImaSyncConfig = {
        enabled: true,
        harPath: harInput,
        outDir,
        folder,
        kbId,
        ...next,
      }
      // 保证 folder 字段最终也是规范化后的
      merged.folder = normalizeFolder(merged.folder)
      setImaSyncConfig(merged)
      void saveImaSyncConfig(merged)
      // 保存配置后：若已选真实文件夹则自动比对
      if (opts?.check !== false && project && isRealImaFolder(merged.folder)) {
        void runImaConsistencyCheck({ projectPath: project.path, config: merged, force: true })
      } else if (opts?.check !== false && project && !isRealImaFolder(merged.folder)) {
        setImaSyncStatus((s) => ({
          ...s,
          consistency: "need_config",
          consistencyDetail: "请选择目标文件夹",
          localCount: 0,
          remoteCount: 0,
          missingCount: 0,
        }))
      }
    },
    [harInput, outDir, folder, kbId, setImaSyncConfig, setImaSyncStatus, project],
  )

  const appendLog = useCallback((line: string) => {
    setLogs((prev) => [...prev.slice(-200), line])
  }, [])

  const handleProgressLine = useCallback(
    (line: string) => {
      let parsed: any = null
      try {
        parsed = JSON.parse(line)
      } catch {
        /* not json */
      }
      if (parsed && typeof parsed === "object") {
        if (parsed.type === "phase") {
          setImaSyncStatus((prev) => ({
            ...prev,
            phase: parsed.phase || prev.phase,
            current: Number(parsed.current) || prev.current,
            total: Number(parsed.total) || prev.total,
          }))
          appendLog(`[${parsed.phase}] ${parsed.current ?? ""}/${parsed.total ?? ""}`)
          return
        }
        if (parsed.type === "item") {
          appendLog(`▸ (${parsed.index}/${parsed.total}) ${parsed.name}`)
          return
        }
        if (parsed.type === "item-done") {
          const tag =
            parsed.status === "ok" ? "✓" : parsed.status === "skip" ? "·" : "✗"
          appendLog(`  ${tag} (${parsed.index}/${parsed.total}) ${parsed.name} ${parsed.message ? "— " + parsed.message : ""}`)
          if (parsed.status === "ok" || parsed.status === "skip" || parsed.status === "fail") {
            setImaSyncStatus((prev) => ({ ...prev, current: Number(parsed.index) || prev.current }))
          }
          return
        }
        if (parsed.type === "done") {
          if (parsed.up_to_date) {
            appendLog(`✓ 本地与 IMA 目标文件夹一致，无需更新（${parsed.folder || ""}）`)
          } else {
            appendLog(`完成：下载 ${parsed.ok} / 跳过 ${parsed.skip} / 失败 ${parsed.fail}（${parsed.folder}）`)
          }
          return
        }
        if (parsed.type === "auth-fail") {
          appendLog(`! 鉴权失败，尝试刷新：${parsed.message}`)
          return
        }
        if (parsed.type === "log") {
          appendLog(parsed.message || "")
          return
        }
        if (parsed.type === "error") {
          appendLog(`! ${parsed.message || "错误"}`)
          return
        }
      }
      if (line.trim()) appendLog(line)
    },
    [appendLog, setImaSyncStatus],
  )

  const runIma = useCallback(
    async (args: string[]): Promise<ImaResult | null> => {
      if (!project) return null
      const unlisten = await listen<{ action?: string; stream?: string; line?: string }>(
        "research-cockpit-progress",
        (evt) => {
          if (evt.payload?.action !== "ima-sync") return
          if ((evt.payload.stream ?? "stderr") !== "stderr") return
          if (evt.payload.line) handleProgressLine(evt.payload.line)
        },
      )
      try {
        return await runResearchCockpitCommand<ImaResult>(project.path, "ima-sync", args)
      } finally {
        unlisten()
      }
    },
    [project, handleProgressLine],
  )

  async function handleBrowse() {
    try {
      const initial = resolveOutDir(outDir, project?.path) || project?.path || ""
      const picked = await open({ directory: true, defaultPath: initial })
      if (typeof picked === "string" && picked) {
        const display = toDisplayOutDir(picked, project?.path)
        setOutDir(display)
        persist({ outDir: display })
      }
    } catch {
      /* ignore */
    }
  }

  const handleRefreshFolders = useCallback(
    async (opts?: { autoSelectLatest?: boolean; nextKb?: string; quiet?: boolean }) => {
      if (!project) return
      setFoldersLoading(true)
      if (!opts?.quiet) appendLog("刷新知识库文件夹列表…")
      try {
        const args = ["--mode", "folders"]
        const effectiveKb = (opts?.nextKb ?? kbId).trim()
        if (effectiveKb) args.push("--kb", effectiveKb)
        const res = await runIma(args)
        if (res?.ok && Array.isArray(res.folders)) {
          const list = res.folders
          setFolders(list)
          if (!opts?.quiet) appendLog(`✓ 已加载 ${list.length} 个文件夹`)
          // 当前选中的 folder 是否仍在列表中
          const stillThere = list.some((f) => f.media_id === folder)
          if ((!folder || !stillThere) && list.length > 0) {
            // 默认选最新（按 date 降序）
            const sorted = [...list].sort((a, b) => {
              const da = a.date || ""
              const db = b.date || ""
              if (da && db) return db.localeCompare(da)
              if (da) return -1
              if (db) return 1
              return (b.title || "").localeCompare(a.title || "", "zh")
            })
            const pick = sorted[0]
            if (opts?.autoSelectLatest !== false && pick) {
              setFolder(pick.media_id)
              persist({ folder: pick.media_id, kbId: effectiveKb || kbId })
              if (!opts?.quiet) appendLog(`✓ 已自动选择最新文件夹：${pick.title}`)
            }
          }
        } else if (res?.needHar) {
          // 静默加载时不弹手动凭证区，避免一进设置就打扰
          if (!opts?.quiet) {
            setManualOpen(true)
            setImaSyncStatus((s) => ({
              ...s,
              error: res.reason || "凭证无效，请更新 HAR 或 refresh_token",
            }))
            appendLog(`! ${res.reason}`)
          }
        } else if (!opts?.quiet) {
          appendLog(`! ${res?.reason || "加载文件夹失败"}`)
          setImaSyncStatus((s) => ({ ...s, error: res?.reason || "加载文件夹失败" }))
        }
      } catch (err) {
        if (!opts?.quiet) {
          appendLog(`! ${String(err)}`)
          setImaSyncStatus((s) => ({ ...s, error: String(err) }))
        }
      } finally {
        setFoldersLoading(false)
      }
    },
    [project, kbId, folder, runIma, persist, appendLog, setImaSyncStatus],
  )
  refreshFoldersRef.current = handleRefreshFolders

  
  async function handleExtract() {
    if (!harInput.trim()) {
      setImaSyncStatus((s) => ({ ...s, error: "请先填写 HAR 路径或 refresh_token JSON" }))
      return
    }
    setBusy(true)
    setImaSyncStatus((s) => ({ ...s, error: null }))
    appendLog(`提取凭证：${harInput.trim().slice(0, 80)}`)
    try {
      const res = await runIma(["--mode", "extract", "--har", harInput.trim()])
      if (res?.ok) {
        setStatusInfo(res)
        appendLog(`✓ 凭证已保存（user_id=${res.user_id || "?"}，source=${res.source}）`)
        const nextKb = res.kb_id || kbId
        if (res.kb_id) {
          setKbId(res.kb_id)
          appendLog(`✓ 已自动识别知识库 ID：${res.kb_id}`)
        }
        persist(
          {
            harPath: harInput.trim(),
            kbId: nextKb || "",
          },
          { check: false },
        )
        // 提取成功后刷新文件夹列表并尽量自动选最新
        await handleRefreshFolders({ autoSelectLatest: true, nextKb: nextKb || "" })
      } else if (res?.needHar) {
        setManualOpen(true)
        setImaSyncStatus((s) => ({ ...s, error: res.reason || "凭证无效，请粘贴新的 HAR 或 refresh_token" }))
        appendLog(`! ${res.reason}`)
      } else {
        setImaSyncStatus((s) => ({ ...s, error: res?.reason || "提取失败" }))
      }
    } catch (err) {
      setImaSyncStatus((s) => ({ ...s, error: String(err) }))
    } finally {
      setBusy(false)
    }
  }

  async function handleStatus() {
    if (!project) return
    setBusy(true)
    try {
      const res = await runIma(["--mode", "status"])
      if (res) setStatusInfo(res)
    } catch (err) {
      setImaSyncStatus((s) => ({ ...s, error: String(err) }))
    } finally {
      setBusy(false)
    }
  }

  async function handleSync() {
    if (!project) {
      setImaSyncStatus((s) => ({ ...s, error: "请先打开一个项目" }))
      return
    }
    // 已是最新：不触发下载，按钮也显示「无需更新」
    if (imaSyncStatus.consistency === "up_to_date" && !imaSyncStatus.running) {
      return
    }
    if (!isRealImaFolder(folder)) {
      setImaSyncStatus((s) => ({
        ...s,
        error: "请先选择目标文件夹",
        consistency: "need_config",
        consistencyDetail: "未选定目标文件夹",
      }))
      return
    }
    // 开始同步前自动落盘；不同时跑 check，避免与 sync 抢 IMA 接口
    persist(
      {
        harPath: harInput.trim(),
        outDir: outDir.trim(),
        folder,
        kbId: kbId.trim(),
      },
      { check: false },
    )
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
    setBusy(true)
    setLogs([])
    setImaSyncStatus((prev) => ({
      ...prev,
      running: true,
      phase: "准备中",
      lastMessage: "正在连接 IMA 知识库…",
      error: null,
      lastResult: null,
      current: 0,
      total: 0,
    }))
    try {
      if (!outDir.trim()) {
        setImaSyncStatus((s) => ({
          ...s,
          running: false,
          phase: "失败",
          error: "请先填写下载目录",
          consistency: "need_config",
          consistencyDetail: "未配置下载目录",
        }))
        setBusy(false)
        return
      }
      const resolvedOut = resolveOutDir(outDir.trim(), project?.path)
      const args = ["--mode", "sync", "--out", resolvedOut || "", "--folder", folder]
      if (kbId.trim()) args.push("--kb", kbId.trim())
      const res = await runIma(args)
      if (res?.ok) {
        const at = new Date().toISOString()
        const folderLabel =
          res.folder || folders.find((f) => f.media_id === folder)?.title || folder
        if (res.up_to_date) {
          const msg = res.message || `本地与 IMA「${folderLabel}」一致，无需更新`
          appendLog(`✓ ${msg}`)
          const skipped = res.skipped || res.local_count || 0
          setImaSyncStatus((s) => ({
            ...s,
            running: false,
            phase: "已是最新",
            lastMessage: msg,
            lastResult: {
              ok: true,
              downloaded: 0,
              skipped,
              failed: 0,
              folder: folderLabel,
              at,
            },
            error: null,
            consistency: "up_to_date",
            consistencyDetail: msg,
            localCount: res.local_count || skipped,
            remoteCount: res.remote_count || skipped,
            missingCount: 0,
          }))
          setStatusInfo(res as ImaResult)
        } else {
          setImaSyncStatus((s) => ({
            ...s,
            running: false,
            phase: "完成",
            lastMessage: `下载 ${res.downloaded} / 跳过 ${res.skipped} / 失败 ${res.failed}`,
            lastResult: {
              ok: true,
              downloaded: res.downloaded || 0,
              skipped: res.skipped || 0,
              failed: res.failed || 0,
              folder: folderLabel,
              at,
            },
            error: null,
            // 同步完成后以结果为准；若失败>0 仍标 pending 便于再同步
            consistency: (res.failed || 0) > 0 ? "pending" : "up_to_date",
            consistencyDetail:
              (res.failed || 0) > 0
                ? `同步完成但仍有 ${res.failed} 失败`
                : "同步完成，本地已更新",
            localCount: (res.downloaded || 0) + (res.skipped || 0),
            remoteCount: (res.downloaded || 0) + (res.skipped || 0) + (res.failed || 0),
            missingCount: res.failed || 0,
          }))
          setStatusInfo(res as ImaResult)
        }
      } else if (res?.needHar) {
        setManualOpen(true)
        setImaSyncStatus((s) => ({
          ...s,
          running: false,
          phase: "需要更新凭证",
          error: res.reason || "refresh_token 已过期，请粘贴新的 HAR 或 refresh_token",
          consistency: "auth_error",
          consistencyDetail: res.reason || "凭证失效",
        }))
      } else {
        setImaSyncStatus((s) => ({
          ...s,
          running: false,
          phase: "失败",
          error: res?.reason || "同步失败",
          consistency: "error",
          consistencyDetail: res?.reason || "同步失败",
        }))
      }
    } catch (err) {
      setImaSyncStatus((s) => ({
        ...s,
        running: false,
        phase: "失败",
        error: String(err),
        consistency: "error",
        consistencyDetail: String(err),
      }))
    } finally {
      setBusy(false)
    }
  }

  async function handleManualSave() {
    if (!manualInput.trim()) return
    setBusy(true)
    appendLog("通过手动输入更新凭证…")
    try {
      const res = await runIma(["--mode", "extract", "--har", manualInput.trim()])
      if (res?.ok) {
        setManualOpen(false)
        setManualInput("")
        setStatusInfo(res)
        setImaSyncStatus((s) => ({ ...s, error: null, lastMessage: "凭证已更新，可再次点击同步" }))
        appendLog("✓ 凭证已更新")
        const nextKb = res.kb_id || kbId
        if (res.kb_id) {
          setKbId(res.kb_id)
          appendLog(`✓ 已自动识别知识库 ID：${res.kb_id}`)
        }
        persist(
          {
            harPath: manualInput.trim() || harInput.trim(),
            kbId: nextKb || "",
          },
          { check: false },
        )
        await handleRefreshFolders({ autoSelectLatest: true, nextKb: nextKb || "" })
      } else {
        setImaSyncStatus((s) => ({ ...s, error: res?.reason || "凭证更新失败" }))
        appendLog(`! ${res?.reason || "凭证更新失败"}`)
      }
    } catch (err) {
      setImaSyncStatus((s) => ({ ...s, error: String(err) }))
    } finally {
      setBusy(false)
    }
  }

  function handleSaveConfig() {
    persist(
      {
        harPath: harInput.trim(),
        outDir: outDir.trim(),
        folder,
        kbId: kbId.trim(),
      },
      { check: true },
    )
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  function handleFolderChange(value: string) {
    const next = normalizeFolder(value)
    setFolder(next)
    persist({ folder: next })
  }

  const error = imaSyncStatus.error
  const lastResult = imaSyncStatus.lastResult
  const upToDate = imaSyncStatus.consistency === "up_to_date"
  const pendingUpdate = imaSyncStatus.consistency === "pending"
  const checking = imaSyncStatus.consistency === "checking"
  const hasFolder = isRealImaFolder(folder)
  const selectedFolderTitle =
    folders.find((f) => f.media_id === folder)?.title ||
    (hasFolder ? folder : "")

  return (
    <div id="settings-ima-sync" className="scroll-mt-4 space-y-4 rounded-lg border p-4">
      <h3 className="font-semibold">研报同步（IMA 知识库）</h3>
      <p className="text-xs text-muted-foreground">
        选择 IMA 知识库中的目标文件夹，与本地研报目录比对后只下载缺失文件。首次使用需粘贴 HAR 路径或
        refresh_token 写入本地凭证。
      </p>

      {/* HAR / 凭证录入 */}
      <div className="space-y-2">
        <Label>HAR 路径 / refresh_token JSON</Label>
        <Input
          value={harInput}
          onChange={(e) => setHarInput(e.target.value)}
          placeholder='例如 D:\...\xxx.har 或 {"refresh_token":"..."}'
        />
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={handleExtract} disabled={busy}>
            <KeyRound className="mr-1 size-3.5" />
            提取并更新凭证
          </Button>
          <Button variant="outline" size="sm" onClick={handleStatus} disabled={busy || !project}>
            <RefreshCw className="mr-1 size-3.5" />
            检查凭证状态
          </Button>
        </div>
        {statusInfo && (
          <p className="text-xs text-muted-foreground">
            凭证状态：user_id={statusInfo.user_id || "?"} ·
            {statusInfo.seconds_left != null
              ? ` token 剩余 ${Math.max(0, statusInfo.seconds_left)} 秒`
              : " 尚未续期（下次同步会自动刷新）"}
            {statusInfo.refresh_token_present ? " · refresh_token 已保存" : ""}
          </p>
        )}
      </div>

      {/* 知识库 ID（可选） */}
      <div className="space-y-2">
        <Label>知识库 ID（可选）</Label>
        <Input
          value={kbId}
          onChange={(e) => setKbId(e.target.value)}
          placeholder="留空=默认 7298132001970717 ；抓 HAR 会自动识别回填"
        />
        <p className="text-xs text-muted-foreground">
          IMA 内部用于拉取文件的数字 ID（如 <code>{DEFAULT_KB_ID}</code>），与分享链接里的{" "}
          <code>shareId</code> 不同。 留空即用默认 7298132001970717
          。要拉其他知识库时：抓 HAR，本工具会自动识别并回填此 ID；或自行从{" "}
          <code>get_knowledge_list</code> 请求的 body 中复制 <code>knowledge_base_id</code>。
        </p>
      </div>

      {/* 目标文件夹 */}
      <div className="space-y-2">
        <Label>目标文件夹</Label>
        <div className="flex items-center gap-2">
          <select
            className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex h-8 w-full rounded-md border px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 disabled:cursor-not-allowed disabled:opacity-50"
            value={folder}
            onChange={(e) => handleFolderChange(e.target.value)}
            disabled={busy || foldersLoading}
          >
            <option value="">
              {folders.length === 0 ? "请先刷新文件夹列表…" : "请选择文件夹…"}
            </option>
            {/* 已保存的 folder 不在当前列表中时，保留选项避免丢失 */}
            {hasFolder && !folders.some((f) => f.media_id === folder) && (
              <option value={folder}>{folder}（已保存）</option>
            )}
            {folders.map((f) => (
              <option key={f.media_id} value={f.media_id}>
                {f.title}
                {f.date ? ` · ${f.date}` : ""}
              </option>
            ))}
          </select>
          <Button
            variant="outline"
            onClick={() => void handleRefreshFolders({ autoSelectLatest: !hasFolder })}
            disabled={busy || foldersLoading || !project}
            className="h-8 shrink-0"
            title="从 IMA 拉取知识库根目录下的文件夹列表"
          >
            {foldersLoading ? (
              <Loader2 className="mr-1 size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-1 size-3.5" />
            )}
            刷新
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          只对比并同步所选文件夹内的研报，不会扫描全库或其他文件夹。
          {selectedFolderTitle ? ` 当前：${selectedFolderTitle}` : ""}
        </p>
      </div>

      {/* 输出目录 */}
      <div className="space-y-2">
        <Label>下载目录</Label>
        <div className="flex items-center gap-2">
          <Input
            value={outDir}
            onChange={(e) => setOutDir(e.target.value)}
            placeholder="复盘库位置下研报的保存目录"
            className="h-8"
          />
          <Button variant="outline" onClick={handleBrowse} disabled={!project} className="h-8 shrink-0">
            <FolderOpen className="mr-1 size-3.5" />
            浏览
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          同步时对比「所选目标文件夹」与本目录；一致则无需下载，不一致只补缺文件。
          {imaSyncStatus.consistencyDetail ? ` 当前：${imaSyncStatus.consistencyDetail}` : ""}
        </p>
      </div>

      {/* 操作：一致→无需更新；不一致→开始同步 */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          onClick={handleSync}
          disabled={
            busy ||
            !project ||
            !outDir.trim() ||
            !hasFolder ||
            upToDate ||
            checking ||
            imaSyncStatus.running
          }
          variant={upToDate ? "outline" : "default"}
          className="h-8"
          title={
            upToDate
              ? imaSyncStatus.consistencyDetail || "本地与目标文件夹一致"
              : pendingUpdate
                ? `将下载缺少的 ${imaSyncStatus.missingCount || ""} 份研报`.trim()
                : !hasFolder
                  ? "请先选择目标文件夹"
                  : undefined
          }
        >
          {busy || imaSyncStatus.running ? (
            <Loader2 className="mr-1 size-4 animate-spin" />
          ) : upToDate ? (
            <CheckCircle2 className="mr-1 size-4 text-emerald-600" />
          ) : (
            <Download className="mr-1 size-4" />
          )}
          {imaSyncStatus.running
            ? "同步中…"
            : checking
              ? "检查中…"
              : upToDate
                ? "无需更新"
                : pendingUpdate && imaSyncStatus.missingCount > 0
                  ? `开始同步（缺 ${imaSyncStatus.missingCount}）`
                  : "开始同步"}
        </Button>
        <Button
          variant="outline"
          onClick={handleSaveConfig}
          disabled={busy || !outDir.trim()}
          className="h-8"
        >
          {saved ? <CheckCircle2 className="mr-1 size-4" /> : null}
          保存配置
        </Button>
      </div>

      {/* 错误提示 + 手动凭证更新 */}
      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <div className="space-y-2">
              <p>{error}</p>
              {imaSyncStatus.error?.includes("refresh_token") || manualOpen ? (
                <div className="space-y-2">
                  <p className="font-medium">粘贴新的 HAR 路径或 refresh_token JSON 以更新本地凭证：</p>
                  <textarea
                    className="h-20 w-full rounded-md border border-border bg-transparent p-2 font-mono text-xs"
                    value={manualInput}
                    onChange={(e) => setManualInput(e.target.value)}
                    placeholder='D:\path\to\new.har  或  {"refresh_token":"...","user_id":"...","registration_id":"..."}'
                  />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={handleManualSave} disabled={busy || !manualInput.trim()}>
                      保存凭证
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setManualOpen(false)}>
                      取消
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {/* 上次结果 / 已是最新提示 */}
      {lastResult && !imaSyncStatus.running && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {lastResult.failed > 0 ? (
            <XCircle className="size-4 text-destructive" />
          ) : (
            <FileCheck className="size-4 text-emerald-600" />
          )}
          <span>
            {imaSyncStatus.phase === "已是最新" ||
            (lastResult.downloaded === 0 &&
              lastResult.failed === 0 &&
              lastResult.skipped > 0 &&
              imaSyncStatus.lastMessage?.includes("无需更新"))
              ? `本地与 IMA「${lastResult.folder}」一致，无需更新（${lastResult.skipped} 份）`
              : `上次同步（${lastResult.folder}）：下载 ${lastResult.downloaded} · 跳过 ${lastResult.skipped} · 失败 ${lastResult.failed}`}
            {" · "}
            {lastResult.at.slice(0, 19).replace("T", " ")}
          </span>
        </div>
      )}

      {/* 实时进度面板 */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <Label className="text-xs">日志</Label>
          {imaSyncStatus.running && (
            <span className="text-xs text-muted-foreground">
              {imaSyncStatus.phase}{" "}
              {imaSyncStatus.total ? `(${imaSyncStatus.current}/${imaSyncStatus.total})` : ""}
            </span>
          )}
        </div>
        <div className="max-h-48 overflow-auto rounded-md border bg-muted/30 p-2 font-mono text-xs leading-relaxed">
          {logs.length === 0 ? (
            <span className="text-muted-foreground">暂无记录，点击「开始同步」后这里会实时显示。</span>
          ) : (
            logs.map((l, i) => (
              <div key={i} className="whitespace-pre-wrap break-all">
                {l}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
