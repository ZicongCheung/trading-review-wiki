import { useState, useEffect, useRef, useCallback, useMemo, memo } from "react"
import {
  ChevronUp, ChevronDown, Loader2, CheckCircle2, AlertCircle,
  FileText, Users, Lightbulb, BookOpen, GitMerge, BarChart3, HelpCircle, Layout,
  RotateCcw, X, Clock,
} from "lucide-react"
import { useActivityStore, type ActivityItem, type PlanItem, type IngestStage } from "@/stores/activity-store"
import { Plus, Pencil } from "lucide-react"
import { useWikiStore } from "@/stores/wiki-store"
import { normalizePath, getFileName } from "@/lib/path-utils"
import { getQueue, getQueueSummary, retryTask, cancelTask, enqueueBatch, pauseQueue, resumeQueue, isPaused, type IngestTask } from "@/lib/ingest-queue"
import { getIngestBacklog, type IngestBacklog } from "@/lib/ingest-backlog"

const FILE_TYPE_ICONS: Record<string, typeof FileText> = {
  sources: BookOpen,
  entities: Users,
  concepts: Lightbulb,
  queries: HelpCircle,
  synthesis: GitMerge,
  comparisons: BarChart3,
}

function getFileTypeInfo(path: string): { icon: typeof FileText; type: string } {
  for (const [dir, icon] of Object.entries(FILE_TYPE_ICONS)) {
    if (path.includes(`/${dir}/`) || path.startsWith(`wiki/${dir}/`)) {
      return { icon, type: dir.charAt(0).toUpperCase() + dir.slice(1, -1) }
    }
  }
  if (path.includes("index.md")) return { icon: Layout, type: "Index" }
  if (path.includes("log.md")) return { icon: FileText, type: "Log" }
  return { icon: FileText, type: "File" }
}

export function ActivityPanel() {
  const items = useActivityStore((s) => s.items)
  const clearDone = useActivityStore((s) => s.clearDone)
  const project = useWikiStore((s) => s.project)
  const [expanded, setExpanded] = useState(false)
  const [queueTasks, setQueueTasks] = useState<IngestTask[]>([])
  const [backlog, setBacklog] = useState<IngestBacklog>({ total: 0, items: [], duplicateBases: [], caseMismatchBases: [] })
  const [paused, setPaused] = useState(() => isPaused())
  const prevRunningRef = useRef(0)

  const runningCount = items.filter((i) => i.status === "running").length
  const hasItems = items.length > 0
  const queueSummary = getQueueSummary()
  const hasQueue = queueSummary.total > 0

  // Poll queue state. Only trigger a React render when the queue snapshot
  // actually changes so the panel doesn't flash during rapid plan updates.
  useEffect(() => {
    let lastSnapshot = ""
    const interval = setInterval(() => {
      const q = getQueue()
      const snapshot = [
        q.length,
        q.filter((t) => t.status === "processing").length,
        q.filter((t) => t.status === "pending").length,
        q.filter((t) => t.status === "failed").length,
      ].join("")
      if (snapshot !== lastSnapshot) {
        lastSnapshot = snapshot
        setQueueTasks([...q])
      }
    }, hasQueue ? 300 : 2000)
    return () => clearInterval(interval)
  }, [hasQueue])

  // Poll backlog (raw sources not yet turned into wiki pages)
  useEffect(() => {
    if (!project) return
    const pp = normalizePath(project.path)
    let alive = true
    const run = () =>
      getIngestBacklog(pp)
        .then((b) => { if (alive) setBacklog(b) })
        .catch(() => {})
    run()
    const t = setInterval(run, 5000)
    return () => { alive = false; clearInterval(t) }
  }, [project])

  // Keep `paused` state in sync with the queue module (faster when active)
  useEffect(() => {
    const t = setInterval(() => setPaused(isPaused()), hasQueue ? 200 : 1000)
    return () => clearInterval(t)
  }, [hasQueue])

  // All hooks must be before any conditional return
  const handleRetry = useCallback((taskId: string) => {
    if (!project) return
    retryTask(normalizePath(project.path), taskId)
  }, [project])

  const handleCancel = useCallback((taskId: string) => {
    if (!project) return
    cancelTask(normalizePath(project.path), taskId)
  }, [project])

  // Auto-expand when a new task starts running (only when runningCount goes 0→>0)
  useEffect(() => {
    if (runningCount > 0 && prevRunningRef.current === 0) {
      setExpanded(true)
    }
    prevRunningRef.current = runningCount
  }, [runningCount])

  const backlogCount = backlog.items.length

  const latestItem = items[0]

  // Build status text — always anchored to the backlog total so the numbers
  // never disagree with the tree counters (e.g. "Raw Sources 417").
  let statusText = ""
  if (queueSummary.processing > 0 || queueSummary.pending > 0) {
    const done = queueSummary.total - queueSummary.pending - queueSummary.processing
    statusText = `当前批次 ${done}/${queueSummary.total} · 共 ${backlog.total} 份原始资料`
    if (backlogCount > 0) statusText += ` · 待处理 ${backlogCount}`
    if (queueSummary.failed > 0) statusText += ` (${queueSummary.failed} 失败)`
  } else if (runningCount > 0) {
    statusText = `Processing: ${latestItem?.title ?? "..."}`
  } else if (queueSummary.failed > 0) {
    statusText = `${queueSummary.failed} failed task${queueSummary.failed > 1 ? "s" : ""}`
  } else if (backlogCount > 0) {
    const processed = backlog.total - backlogCount
    statusText = `${processed}/${backlog.total} 已处理 · ${backlogCount} 待处理${paused ? "（已暂停）" : ""}`
  } else {
    statusText = `Done: ${latestItem?.title ?? "All tasks complete"}`
  }

  // Control handlers
  const handleStart = useCallback(async () => {
    if (!project) return
    const pp = normalizePath(project.path)
    const queued = new Set(getQueue().map((t) => t.sourcePath))
    const toAdd = backlog.items.filter((it) => !queued.has(it.sourcePath))
    if (toAdd.length > 0) {
      await enqueueBatch(pp, toAdd)
    } else if (queueSummary.total > 0 && paused) {
      resumeQueue(pp)
    } else if (queueSummary.total > 0) {
      // Already running and all known backlog is in the queue — nothing to add
      resumeQueue(pp)
    }
  }, [project, backlog, queueSummary.total, paused])

  const handlePause = useCallback(() => {
    pauseQueue()
    setPaused(true)
  }, [])

  const handleResume = useCallback(() => {
    if (!project) return
    resumeQueue(normalizePath(project.path))
    setPaused(false)
  }, [project])

  const isActive = runningCount > 0 || queueSummary.processing > 0 || queueSummary.pending > 0

  const showStart = backlogCount > 0 && !isActive && !paused
  const showPause = isActive && !paused
  const showResume = paused && (isActive || backlogCount > 0)

  if (!hasItems && !hasQueue && backlogCount === 0) return null

  return (
    <div className="border-t bg-muted/30">
      <div className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent/50">
        {isActive ? (
          <Loader2 className="h-3 w-3 animate-spin shrink-0" />
        ) : backlogCount > 0 ? (
          <Clock className="h-3 w-3 shrink-0 text-amber-500" />
        ) : queueSummary.failed > 0 ? (
          <AlertCircle className="h-3 w-3 shrink-0 text-destructive" />
        ) : (
          <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-500" />
        )}
        <span className="flex-1 truncate text-left">{statusText}</span>
        <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
          {showStart && (
            <button
              onClick={handleStart}
              className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-primary text-primary-foreground hover:bg-primary/90"
              title={queueSummary.total > 0 ? "补齐未入队的研报并继续处理" : "把未处理的研报加入处理队列"}
            >
              {queueSummary.total > 0 ? "补齐继续" : "开始处理"}
            </button>
          )}
          {showPause && (
            <button
              onClick={handlePause}
              className="rounded px-1.5 py-0.5 text-[10px] font-medium hover:bg-accent text-muted-foreground hover:text-foreground"
              title="暂停：当前研报处理完后停止取下一份"
            >
              暂停
            </button>
          )}
          {showResume && (
            <button
              onClick={handleResume}
              className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-emerald-600 text-white hover:bg-emerald-700"
              title="继续处理队列"
            >
              继续
            </button>
          )}
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="shrink-0 rounded p-0.5 hover:bg-accent"
          title={expanded ? "收起" : "展开"}
        >
          {expanded ? (
            <ChevronDown className="h-3 w-3 shrink-0" />
          ) : (
            <ChevronUp className="h-3 w-3 shrink-0" />
          )}
        </button>
      </div>

      {expanded && (
        <div className="max-h-64 overflow-y-auto border-t">
          {/* Backlog summary — how many raw sources still need processing */}
          {backlogCount > 0 && (
            <div className="px-3 py-1.5 border-b border-border/50">
              <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
                <span>研报处理进度</span>
                <span>{backlog.total - backlogCount}/{backlog.total} 已处理</span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${((backlog.total - backlogCount) / Math.max(backlog.total, 1)) * 100}%` }}
                />
              </div>
            </div>
          )}

          {/* Queue progress bar — current batch only */}
          {hasQueue && (queueSummary.processing > 0 || queueSummary.pending > 0) && (
            <div className="px-3 py-1.5 border-b border-border/50">
              <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
                <span>当前批次</span>
                <span>{queueSummary.total - queueSummary.pending - queueSummary.processing}/{queueSummary.total} 完成</span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${((queueSummary.total - queueSummary.pending - queueSummary.processing) / Math.max(queueSummary.total, 1)) * 100}%` }}
                />
              </div>
            </div>
          )}

          {/* Backlog items — raw sources not yet represented in wiki/sources */}
          {backlogCount > 0 && (
            <div className="px-3 py-2 text-xs border-b border-border/50">
              <div className="text-[10px] text-muted-foreground mb-1">待处理原始文件</div>
              <div className="flex flex-col gap-1">
                {backlog.items.map((item) => (
                  <div key={item.sourcePath} className="flex items-start gap-2">
                    <Clock className="h-3 w-3 shrink-0 text-amber-500 mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{getFileName(item.sourcePath)}</div>
                      {item.folderContext && (
                        <div className="text-[10px] text-muted-foreground/70 truncate">{item.folderContext}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              {backlog.duplicateBases.length > 0 && (
                <div className="mt-2 text-[10px] text-amber-600 bg-amber-50 dark:bg-amber-950/30 rounded px-2 py-1">
                  检测到 {backlog.duplicateBases.length} 组同名文件：
                  {backlog.duplicateBases.join(", ")}
                  <span className="block text-muted-foreground/80">
                    这些文件共用同一个 wiki/sources/&lt;base&gt;.md，若只处理了一份，其余会被误判为已处理。
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Case-mismatch notice — ingested, but wiki filename casing differs */}
          {backlog.caseMismatchBases.length > 0 && (
            <div className="px-3 py-2 text-xs border-b border-border/50">
              <div className="text-[10px] text-sky-600 bg-sky-50 dark:bg-sky-950/30 rounded px-2 py-1">
                已处理但 wiki 文件名大小写不一致（{backlog.caseMismatchBases.length} 个）：
                <div className="mt-1 flex flex-col gap-0.5 font-mono text-[10px]">
                  {backlog.caseMismatchBases.map((b) => (
                    <span key={b} className="truncate">{b}</span>
                  ))}
                </div>
                <span className="block text-muted-foreground/80 mt-1">
                  研报已摄入，仅生成的 wiki 页面文件名大小写与源文件不同。进度已按「已处理」统计；如需统一，可将 wiki 文件名改回与源一致。
                </span>
              </div>
            </div>
          )}

          {/* Queue tasks */}
          {queueTasks.filter((t) => t.status === "processing").map((task) => (
            <MemoQueueRow key={task.id} task={task} onRetry={handleRetry} onCancel={handleCancel} />
          ))}
          {queueTasks.filter((t) => t.status === "pending").map((task) => (
            <MemoQueueRow key={task.id} task={task} onRetry={handleRetry} onCancel={handleCancel} />
          ))}
          {queueTasks.filter((t) => t.status === "failed").map((task) => (
            <MemoQueueRow key={task.id} task={task} onRetry={handleRetry} onCancel={handleCancel} />
          ))}

          {/* Activity items */}
          {items.map((item) => {
            // Find matching queue task for cancel button
            const matchingTask = item.status === "running"
              ? queueTasks.find((t) => t.status === "processing" && getFileName(t.sourcePath) === item.title)
              : undefined
            return (
              <MemoActivityRow
                key={item.id}
                item={item}
                onCancel={matchingTask ? () => handleCancel(matchingTask.id) : undefined}
              />
            )
          })}
          {items.some((i) => i.status !== "running") && (
            <button
              onClick={clearDone}
              className="w-full px-3 py-1 text-center text-[10px] text-muted-foreground hover:underline"
            >
              Clear completed
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function QueueRow({ task, onRetry, onCancel }: { task: IngestTask; onRetry: (id: string) => void; onCancel: (id: string) => void }) {
  const fileName = getFileName(task.sourcePath)

  return (
    <div className="px-3 py-2 text-xs border-b border-border/50">
      <div className="flex items-center gap-2">
        <div className="shrink-0">
          {task.status === "processing" && <Loader2 className="h-3 w-3 animate-spin text-primary" />}
          {task.status === "pending" && <Clock className="h-3 w-3 text-muted-foreground" />}
          {task.status === "failed" && <AlertCircle className="h-3 w-3 text-destructive" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-medium truncate">{fileName}</div>
          {task.folderContext && (
            <div className="text-[10px] text-muted-foreground/70 truncate">{task.folderContext}</div>
          )}
          {task.status === "failed" && task.error && (
            <div className="text-[10px] text-destructive mt-0.5 truncate">{task.error}</div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {task.status === "failed" && (
            <button
              onClick={() => onRetry(task.id)}
              className="p-0.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
              title="Retry"
            >
              <RotateCcw className="h-3 w-3" />
            </button>
          )}
          {(task.status === "pending" || task.status === "processing") && (
            <button
              onClick={() => onCancel(task.id)}
              className="p-0.5 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive"
              title="Cancel"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

const MemoQueueRow = memo(QueueRow)

function ActivityRow({ item, onCancel }: { item: ActivityItem; onCancel?: () => void }) {
  const setSelectedFile = useWikiStore((s) => s.setSelectedFile)
  const project = useWikiStore((s) => s.project)

  function handleFileClick(filePath: string) {
    if (!project) return
    const pp = normalizePath(project.path)
    const fullPath = filePath.startsWith("/") ? normalizePath(filePath) : `${pp}/${filePath}`
    setSelectedFile(fullPath)
  }

  // Group plan items by stage once per item update. This keeps the sub-tree
  // stable and avoids re-creating arrays that make the stage rows flicker.
  const planByStage = useMemo(() => {
    if (!item.stages || item.stages.length === 0 || !item.plan) return null
    const groups = new Map<number, PlanItem[]>()
    for (const p of item.plan) {
      const step =
        p.stage !== undefined ? p.stage : p.action === "update" ? 3 : p.action === "create" ? 4 : undefined
      if (step === undefined) continue
      const arr = groups.get(step) ?? []
      arr.push(p)
      groups.set(step, arr)
    }
    return groups
  }, [item.stages, item.plan])

  return (
    <div className="px-3 py-2 text-xs border-b border-border/50 last:border-b-0">
      <div className="flex items-start gap-2">
        <div className="mt-0.5 shrink-0">
          {item.status === "running" && <Loader2 className="h-3 w-3 animate-spin text-primary" />}
          {item.status === "done" && <CheckCircle2 className="h-3 w-3 text-emerald-500" />}
          {item.status === "error" && <AlertCircle className="h-3 w-3 text-destructive" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-medium">{item.title}</div>
          <div className="text-muted-foreground mt-0.5">{item.detail}</div>
        </div>
        {item.status === "running" && onCancel && (
          <button
            onClick={onCancel}
            className="shrink-0 p-0.5 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive"
            title="Cancel"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Stage groups: Step 1/2 are header-only; Step 3 lists updates; Step 4 lists creates + housekeeping */}
      {planByStage && item.stages && item.stages.length > 0 && (
        <div className="mt-1.5 ml-5 flex flex-col gap-1">
          {item.stages.map((stage) => (
            <MemoStageRow
              key={stage.step}
              stage={stage}
              planItems={planByStage.get(stage.step) ?? []}
              onPlanItemClick={handleFileClick}
            />
          ))}
        </div>
      )}

      {/* Fallback: plan items without stages (legacy path) */}
      {(!item.stages || item.stages.length === 0) && item.plan && item.plan.length > 0 && (
        <div className="mt-1.5 ml-5 flex flex-col gap-0.5">
          {item.plan.map((p) => (
            <MemoPlanItemRow key={p.id} planItem={p} onClick={() => handleFileClick(p.path)} />
          ))}
        </div>
      )}

      {/* File list (only shown when no plan exists — e.g. cache hit) */}
      {(!item.plan || item.plan.length === 0) &&
        item.filesWritten.length > 0 &&
        item.status === "done" && (
          <div className="mt-1.5 ml-5 flex flex-col gap-0.5">
            {item.filesWritten.map((filePath) => {
              const { icon: Icon, type } = getFileTypeInfo(filePath)
              const fileName = getFileName(filePath)
              return (
                <button
                  key={filePath}
                  type="button"
                  onClick={() => handleFileClick(filePath)}
                  className="flex items-center gap-1.5 rounded px-1 py-0.5 text-left text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors"
                >
                  <Icon className="h-3 w-3 shrink-0" />
                  <span className="text-[10px] font-medium text-muted-foreground/70 w-14 shrink-0">{type}</span>
                  <span className="truncate">{fileName}</span>
                </button>
              )
            })}
          </div>
        )}
    </div>
  )
}

const MemoActivityRow = memo(ActivityRow, (prev, next) => {
  // The store recreates the item object on every update, so a shallow compare
  // would always re-render. Only re-render when the fields that affect the UI
  // actually change.
  const prevPlan = prev.item.plan
  const nextPlan = next.item.plan
  if (prev.item.status !== next.item.status) return false
  if (prev.item.detail !== next.item.detail) return false
  if (prev.item.title !== next.item.title) return false
  if (prev.item.filesWritten.length !== next.item.filesWritten.length) return false
  const prevStages = prev.item.stages
  const nextStages = next.item.stages
  if (prevStages?.length !== nextStages?.length) return false
  if (prevStages && nextStages) {
    for (let i = 0; i < prevStages.length; i++) {
      if (prevStages[i].status !== nextStages[i].status || prevStages[i].error !== nextStages[i].error) return false
    }
  }
  if (prevPlan?.length !== nextPlan?.length) return false
  if (prevPlan && nextPlan) {
    for (let i = 0; i < prevPlan.length; i++) {
      const a = prevPlan[i]
      const b = nextPlan[i]
      if (a.id !== b.id || a.status !== b.status || a.error !== b.error || a.note !== b.note) return false
    }
  }
  return true
})

function StageRow({
  stage,
  planItems,
  onPlanItemClick,
}: {
  stage: IngestStage
  planItems: PlanItem[]
  onPlanItemClick: (path: string) => void
}) {
  const doneCount = planItems.filter((p) => p.status === "done").length
  const failCount = planItems.filter((p) => p.status === "error").length
  const total = planItems.length

  let summary = ""
  if (total > 0) {
    summary = `${doneCount}/${total}`
    if (failCount > 0) summary += ` · ${failCount} 失败`
  }

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1.5 text-[11px]" title={stage.error ?? ""}>
        <div className="shrink-0">
          {stage.status === "pending" && <Clock className="h-3 w-3 text-muted-foreground/60" />}
          {stage.status === "running" && <Loader2 className="h-3 w-3 animate-spin text-primary" />}
          {stage.status === "done" && <CheckCircle2 className="h-3 w-3 text-emerald-500" />}
          {stage.status === "error" && <AlertCircle className="h-3 w-3 text-destructive" />}
        </div>
        <span className="font-medium text-muted-foreground/80">Step {stage.step}/4</span>
        <span className="text-foreground">{stage.label}</span>
        {summary && <span className="text-muted-foreground/60">· {summary}</span>}
        {stage.error && stage.status === "error" && (
          <span className="text-destructive truncate">— {stage.error}</span>
        )}
      </div>
      {planItems.length > 0 && (
        <div className="ml-4 flex flex-col gap-0.5">
          {planItems.map((p) => (
            <MemoPlanItemRow key={p.id} planItem={p} onClick={() => onPlanItemClick(p.path)} />
          ))}
        </div>
      )}
    </div>
  )
}

const MemoStageRow = memo(StageRow)

function PlanItemRow({ planItem, onClick }: { planItem: PlanItem; onClick: () => void }) {
  const ActionIcon =
    planItem.action === "create" ? Plus :
    planItem.action === "append" ? FileText :
    Pencil
  const actionLabel =
    planItem.action === "create" ? "新建" :
    planItem.action === "append" ? "追加" :
    "更新"
  const actionColor =
    planItem.action === "create" ? "text-emerald-600" :
    planItem.action === "append" ? "text-amber-600" :
    "text-blue-600"

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-start gap-1.5 rounded px-1 py-0.5 text-left text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors"
      title={planItem.error ?? planItem.why ?? ""}
    >
      <div className="mt-0.5 shrink-0">
        {planItem.status === "pending" && <Clock className="h-3 w-3 text-muted-foreground/60" />}
        {planItem.status === "running" && <Loader2 className="h-3 w-3 animate-spin text-primary" />}
        {planItem.status === "done" && <CheckCircle2 className="h-3 w-3 text-emerald-500" />}
        {planItem.status === "error" && <AlertCircle className="h-3 w-3 text-destructive" />}
      </div>
      <ActionIcon className={`mt-0.5 h-3 w-3 shrink-0 ${actionColor}`} />
      <span className={`text-[10px] font-medium w-7 shrink-0 ${actionColor}`}>{actionLabel}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="truncate">{planItem.path}</span>
          {planItem.note && (
            <span className="shrink-0 rounded-sm bg-amber-100 px-1 py-0.5 text-[9px] font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300">
              {planItem.note}
            </span>
          )}
        </div>
        {planItem.status === "error" && planItem.error && (
          <div className="text-[10px] text-destructive truncate">{planItem.error}</div>
        )}
      </div>
    </button>
  )
}

const MemoPlanItemRow = memo(PlanItemRow, (prev, next) => {
  const a = prev.planItem
  const b = next.planItem
  return (
    a.id === b.id &&
    a.status === b.status &&
    a.error === b.error &&
    a.note === b.note &&
    a.path === b.path &&
    a.action === b.action
  )
})
