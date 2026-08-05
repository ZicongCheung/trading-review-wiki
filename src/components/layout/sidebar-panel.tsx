import { useState } from "react"
import { KnowledgeTree } from "./knowledge-tree"
import { FileTree } from "./file-tree"
import { useWikiStore } from "@/stores/wiki-store"
import { Loader2, FileCheck, XCircle, CloudOff, RefreshCw, Settings } from "lucide-react"

function ImaSyncStatusBar() {
  const status = useWikiStore((s) => s.imaSyncStatus)
  const openSettingsSection = useWikiStore((s) => s.openSettingsSection)
  if (!status) return null

  // 跳转设置页并滚到「研报同步（IMA 知识库）」区块
  const goSettings = () => openSettingsSection("settings-ima-sync")

  if (status.running) {
    return (
      <button
        type="button"
        onClick={goSettings}
        className="flex w-full items-center gap-2 border-t px-3 py-1.5 text-left text-xs text-foreground hover:bg-muted/40"
      >
        <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
        <span className="truncate">
          研报同步中… {status.phase}
          {status.total ? ` (${status.current}/${status.total})` : ""}
        </span>
      </button>
    )
  }

  // 凭证错误优先
  if (status.consistency === "auth_error" || (status.error && /refresh_token|凭证|HAR|鉴权/i.test(status.error))) {
    return (
      <button
        type="button"
        onClick={goSettings}
        className="flex w-full items-center gap-2 border-t px-3 py-1.5 text-left text-xs text-destructive hover:bg-muted/40"
        title={status.consistencyDetail || status.error || ""}
      >
        <CloudOff className="size-3.5 shrink-0" />
        <span className="truncate">研报同步需更新凭证（设置页）</span>
      </button>
    )
  }

  // 一致性三态（用户选定文案）
  if (status.consistency === "checking") {
    return (
      <div className="flex items-center gap-2 border-t px-3 py-1.5 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 shrink-0 animate-spin" />
        <span className="truncate">研报同步：检查中…</span>
      </div>
    )
  }

  if (status.consistency === "need_config" || status.consistency === "unknown") {
    // unknown 在启动极短窗口；若尚未配置也显示待配置
    const label =
      status.consistency === "need_config"
        ? "研报同步：点击进行配置"
        : "研报同步：检查中…"
    const Icon = status.consistency === "need_config" ? Settings : Loader2
    return (
      <button
        type="button"
        onClick={goSettings}
        className="flex w-full items-center gap-2 border-t px-3 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted/40"
        title={status.consistencyDetail || "打开设置页配置 IMA 研报同步"}
      >
        <Icon
          className={`size-3.5 shrink-0 ${status.consistency === "unknown" ? "animate-spin" : ""}`}
        />
        <span className="truncate">{label}</span>
      </button>
    )
  }

  if (status.consistency === "up_to_date") {
    return (
      <button
        type="button"
        onClick={goSettings}
        className="flex w-full items-center gap-2 border-t px-3 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted/40"
        title={
          status.consistencyDetail ||
          `本地 ${status.localCount}/${status.remoteCount} 份，无需更新`
        }
      >
        <FileCheck className="size-3.5 shrink-0 text-emerald-600" />
        <span className="truncate">研报同步：无需更新</span>
      </button>
    )
  }

  if (status.consistency === "pending") {
    return (
      <button
        type="button"
        onClick={goSettings}
        className="flex w-full items-center gap-2 border-t px-3 py-1.5 text-left text-xs text-amber-700 dark:text-amber-400 hover:bg-muted/40"
        title={
          status.consistencyDetail ||
          `本地 ${status.localCount}/${status.remoteCount}，缺 ${status.missingCount} 份`
        }
      >
        <RefreshCw className="size-3.5 shrink-0" />
        <span className="truncate">研报同步：待更新</span>
      </button>
    )
  }

  // 检查失败 / 同步失败等
  if (status.consistency === "error" || status.error) {
    return (
      <button
        type="button"
        onClick={goSettings}
        className="flex w-full items-center gap-2 border-t px-3 py-1.5 text-left text-xs text-destructive hover:bg-muted/40"
        title={status.consistencyDetail || status.error || ""}
      >
        <XCircle className="size-3.5 shrink-0" />
        <span className="truncate">研报同步：检查失败</span>
      </button>
    )
  }

  // 有 lastResult 时的兜底（同步刚完成但尚未再 check）
  if (status.lastResult) {
    const r = status.lastResult
    const failed = r.failed > 0
    return (
      <button
        type="button"
        onClick={goSettings}
        className={`flex w-full items-center gap-2 border-t px-3 py-1.5 text-left text-xs hover:bg-muted/40 ${
          failed ? "text-destructive" : "text-muted-foreground"
        }`}
        title={`${r.folder} · ${r.at.slice(0, 19).replace("T", " ")}`}
      >
        {failed ? <XCircle className="size-3.5 shrink-0" /> : <FileCheck className="size-3.5 shrink-0 text-emerald-600" />}
        <span className="truncate">
          {failed
            ? `上次同步 ${r.folder}：下 ${r.downloaded}/跳 ${r.skipped}/败 ${r.failed}`
            : r.downloaded === 0 && r.skipped > 0
              ? "研报同步：无需更新"
              : `上次同步 ${r.folder}：下 ${r.downloaded}/跳 ${r.skipped}`}
        </span>
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={goSettings}
      className="flex w-full items-center gap-2 border-t px-3 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted/40"
    >
      <Settings className="size-3.5 shrink-0" />
      <span className="truncate">研报同步：点击进行配置</span>
    </button>
  )
}

export function SidebarPanel() {
  const [mode, setMode] = useState<"knowledge" | "files">("knowledge")

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 border-b">
        <button
          onClick={() => setMode("knowledge")}
          className={`flex-1 px-3 py-1.5 text-xs font-medium transition-colors ${
            mode === "knowledge"
              ? "border-b-2 border-primary text-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          知识树
        </button>
        <button
          onClick={() => setMode("files")}
          className={`flex-1 px-3 py-1.5 text-xs font-medium transition-colors ${
            mode === "files"
              ? "border-b-2 border-primary text-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          文件树
        </button>
      </div>
      <div className="flex-1 overflow-hidden">
        {mode === "knowledge" ? <KnowledgeTree /> : <FileTree />}
      </div>
      <ImaSyncStatusBar />
    </div>
  )
}
