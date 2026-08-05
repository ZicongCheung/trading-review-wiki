import { useCallback, useEffect, useRef, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import { useWikiStore } from "@/stores/wiki-store"
import { Button } from "@/components/ui/button"
import { Play, FileText, AlertTriangle, CheckCircle2, Clock, Database, Gauge } from "lucide-react"

type RosSubAction = "status" | "plan" | "review" | "verify"

interface ResearchConsoleResult {
  [key: string]: unknown
}

export function ResearchConsolePanel() {
  const project = useWikiStore((s) => s.project)
  const [subAction, setSubAction] = useState<RosSubAction>("status")
  const [stepId, setStepId] = useState("")
  const [queue, setQueue] = useState("")
  const [source, setSource] = useState("")
  const [limit, setLimit] = useState("20")
  const [write, setWrite] = useState(false)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<ResearchConsoleResult | null>(null)
  const [resultAction, setResultAction] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<string[]>([])
  const startedAt = useRef<number>(0)

  useEffect(() => {
    let unlisten: UnlistenFn | undefined
    let cancelled = false
    listen<{ action?: string; stream?: string; line?: string }>("research-cockpit-progress", (evt) => {
      if (cancelled) return
      const payload = evt.payload
      if (payload?.action !== "research-os" && payload?.action !== "dashboard-data") return
      if (payload.stream === "stderr" && payload.line) {
        setProgress((prev) => [...prev.slice(-80), payload.line])
      }
    })
      .then((fn) => {
        unlisten = fn
      })
      .catch(() => {})
    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [])

  const runRos = useCallback(async () => {
    if (!project) return
    setRunning(true)
    setError(null)
    setResult(null)
    setResultAction("research-os")
    setProgress([])
    startedAt.current = Date.now()
    try {
      const args: string[] = ["agent", subAction]
      if (stepId.trim()) args.push("--step-id", stepId.trim())
      if (queue.trim()) args.push("--queue", queue.trim())
      if (source.trim()) args.push("--source", source.trim())
      if (limit.trim() && limit.trim() !== "20") args.push("--limit", limit.trim())
      if (write) args.push("--write")
      const raw = await invoke<string>("run_research_cockpit_command", {
        projectPath: project.path,
        action: "research-os",
        args,
      })
      try {
        setResult(JSON.parse(raw) as ResearchConsoleResult)
      } catch {
        setResult({ raw })
      }
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally {
      setRunning(false)
    }
  }, [project, subAction, stepId, queue, source, limit, write])

  const runDashboardData = useCallback(async () => {
    if (!project) return
    setRunning(true)
    setError(null)
    setResult(null)
    setResultAction("dashboard-data")
    setProgress([])
    startedAt.current = Date.now()
    try {
      const raw = await invoke<string>("run_research_cockpit_command", {
        projectPath: project.path,
        action: "dashboard-data",
        args: [],
      })
      try {
        setResult(JSON.parse(raw) as ResearchConsoleResult)
      } catch {
        setResult({ raw })
      }
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally {
      setRunning(false)
    }
  }, [project])

  const elapsed = running && startedAt.current ? Math.round((Date.now() - startedAt.current) / 1000) : 0

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <Gauge className="h-5 w-5" />
          研究总控台（Research Console）
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          聚合查看研究系统的智能体状态、计划、审查队列与产物校验，以及 wiki 总览数据。
          只读操作，不依赖外部 LLM / 行情源，可随时安全触发。
        </p>
      </div>

      {/* 子动作选择 */}
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted-foreground">子动作 (research-os agent &lt;action&gt;)</span>
        <select
          value={subAction}
          disabled={running}
          onChange={(e) => setSubAction(e.target.value as RosSubAction)}
          className="rounded-md border border-border bg-background px-3 py-2 text-sm"
        >
          <option value="status">状态概览 (agent status)</option>
          <option value="plan">执行计划 (agent plan)</option>
          <option value="review">审查队列 (agent review)</option>
          <option value="verify">产物校验 (agent verify)</option>
        </select>
      </label>

      {/* 可选参数（主要用于 review） */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">步骤 ID (--step-id)</span>
          <input
            type="text"
            value={stepId}
            disabled={running}
            onChange={(e) => setStepId(e.target.value)}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">队列 (--queue)</span>
          <input
            type="text"
            value={queue}
            disabled={running}
            onChange={(e) => setQueue(e.target.value)}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">来源 (--source)</span>
          <input
            type="text"
            value={source}
            disabled={running}
            onChange={(e) => setSource(e.target.value)}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">数量上限 (--limit)</span>
          <input
            type="number"
            min={1}
            max={500}
            value={limit}
            disabled={running}
            onChange={(e) => setLimit(e.target.value)}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
        </label>
      </div>

      {/* 开关 */}
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={write}
            disabled={running}
            onChange={(e) => setWrite(e.target.checked)}
          />
          落盘写入（--write，仅状态/计划会写本地快照）
        </label>
      </div>

      {/* 运行 */}
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={runRos} disabled={running || !project}>
          <Play className="h-4 w-4" />
          {running && resultAction === "research-os"
            ? `运行中… ${elapsed}s`
            : `运行 research-os agent ${subAction}`}
        </Button>
        <Button variant="outline" onClick={runDashboardData} disabled={running || !project}>
          <Database className="h-4 w-4" />
          {running && resultAction === "dashboard-data" ? `运行中… ${elapsed}s` : "总览数据 (dashboard-data)"}
        </Button>
        {!project && <span className="text-xs text-muted-foreground">未选择项目</span>}
      </div>

      {/* 进度 */}
      {running && progress.length > 0 && (
        <div className="max-h-48 overflow-auto rounded-md border border-border bg-muted/40 p-3 text-xs">
          {progress.map((line, i) => (
            <div key={i} className="whitespace-pre-wrap text-muted-foreground">
              {line}
            </div>
          ))}
        </div>
      )}

      {/* 错误 */}
      {error && (
        <div className="flex items-start gap-2 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* 结果 */}
      {result && !error && (
        <div className="space-y-3 rounded-md border border-border p-4">
          <div className="flex flex-wrap items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <span className="text-sm font-medium">执行完成</span>
            {resultAction && (
              <span className="rounded bg-muted px-2 py-0.5 text-xs">{resultAction}</span>
            )}
          </div>
          <pre className="max-h-96 overflow-auto rounded-md bg-muted/50 p-3 text-xs leading-relaxed">
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}

      {!result && !error && !running && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Clock className="h-3 w-3" />
          选择子动作后点击运行，结果将以 JSON 展示在此处。
        </div>
      )}
    </div>
  )
}
