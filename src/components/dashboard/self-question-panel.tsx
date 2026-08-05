import { useCallback, useEffect, useRef, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import { useWikiStore } from "@/stores/wiki-store"
import { Button } from "@/components/ui/button"
import { Play, FileText, AlertTriangle, CheckCircle2, Clock, Repeat, NotebookText, BarChart3 } from "lucide-react"

type MarketValidate = "xueqiu" | "auto" | "eastmoney" | "tencent" | "off"

interface SelfQuestionExport {
  kind?: string
  count?: number
  relativePath?: string
  manifest?: string
  ledger?: string
}

interface SelfQuestionCounts {
  questions?: number
  validations?: number
  attributions?: number
  [key: string]: unknown
}

interface SelfQuestionResult {
  status?: string
  dryRun?: boolean
  mode?: string
  runId?: string
  stages?: string[]
  gateSummary?: unknown
  counts?: SelfQuestionCounts
  outputs?: Record<string, string | undefined>
  manifest?: string
  selfTrainingActions?: number | null
  exports?: SelfQuestionExport[]
}

export function SelfQuestionPanel() {
  const project = useWikiStore((s) => s.project)
  const setSelectedFile = useWikiStore((s) => s.setSelectedFile)
  const setActiveView = useWikiStore((s) => s.setActiveView)

  const [stages, setStages] = useState("generate,validate,attribute")
  const [questionCount, setQuestionCount] = useState("3")
  const [marketValidate, setMarketValidate] = useState<MarketValidate>("xueqiu")
  const [externalTimeoutMs, setExternalTimeoutMs] = useState("3000")
  const [externalConcurrency, setExternalConcurrency] = useState("6")
  const [selfTrainWrite, setSelfTrainWrite] = useState(false)
  const [write, setWrite] = useState(true)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<SelfQuestionResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<string[]>([])
  // autoresearch status / ledger
  const [arRunning, setArRunning] = useState(false)
  const [arResult, setArResult] = useState<string | null>(null)
  const [arError, setArError] = useState<string | null>(null)
  const [arSubcommand, setArSubcommand] = useState<"status" | "ledger">("status")
  const startedAt = useRef<number>(0)

  useEffect(() => {
    let unlisten: UnlistenFn | undefined
    let cancelled = false
    listen<{ action?: string; stream?: string; line?: string }>("research-cockpit-progress", (evt) => {
      if (cancelled) return
      const payload = evt.payload
      if (payload?.action !== "self-question") return
      if (payload.stream === "stderr" && payload.line) {
        setProgress((prev) => [...prev.slice(-60), payload.line])
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

  const run = useCallback(async () => {
    if (!project) return
    setRunning(true)
    setError(null)
    setResult(null)
    setProgress([])
    startedAt.current = Date.now()
    try {
      const cfg = useWikiStore.getState().llmConfig
      const args: string[] = [
        "--stages",
        stages.trim(),
        "--question-count",
        questionCount.trim() || "3",
        "--market-validate",
        marketValidate,
        "--external-market-timeout-ms",
        externalTimeoutMs.trim() || "3000",
        "--external-market-concurrency",
        externalConcurrency.trim() || "6",
      ]
      // No-LLM question planner is hardcoded in the Rust bridge (DeepSeek-safe).
      if (selfTrainWrite) args.push("--self-train-write")
      if (write) args.push("--write")
      args.push("--api-key", cfg.apiKey ?? "")
      if (cfg.customEndpoint) args.push("--endpoint", cfg.customEndpoint)
      if (cfg.model) args.push("--model", cfg.model)

      const raw = await invoke<string>("run_research_cockpit_command", {
        projectPath: project.path,
        action: "self-question",
        args,
      })
      let parsed: SelfQuestionResult
      try {
        parsed = JSON.parse(raw) as SelfQuestionResult
      } catch {
        parsed = { mode: "self-question-loop" }
      }
      setResult(parsed)
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally {
      setRunning(false)
    }
  }, [project, stages, questionCount, marketValidate, externalTimeoutMs, externalConcurrency, selfTrainWrite, write])

  const runAutoresearch = useCallback(async () => {
    if (!project) return
    setArRunning(true)
    setArError(null)
    setArResult(null)
    try {
      const raw = await invoke<string>("run_research_cockpit_command", {
        projectPath: project.path,
        action: arSubcommand === "status" ? "autoresearch-status" : "autoresearch-ledger",
        args: [],
      })
      setArResult(raw)
    } catch (e: any) {
      setArError(e?.message ?? String(e))
    } finally {
      setArRunning(false)
    }
  }, [project, arSubcommand])

  const openPath = useCallback(
    (relative: string | null | undefined) => {
      if (!project || !relative) return
      const abs = `${project.path}/${relative}`
      setSelectedFile(abs)
      setActiveView("wiki")
    },
    [project, setSelectedFile, setActiveView],
  )

  const elapsed = running && startedAt.current ? Math.round((Date.now() - startedAt.current) / 1000) : 0

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">自提问递归演化（Self-Question Loop）</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          驱动知识库的自我提问→验证→归因闭环，自演化出可验证问题并沉淀到
          <code className="mx-1 rounded bg-muted px-1">data/brain/questions.jsonl</code>。
          默认用规则生成问题（不依赖外部 LLM），量价验证走雪球外部行情（抗限流、含成交额/换手）。
        </p>
      </div>

      {/* 阶段预设 */}
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted-foreground">演化阶段 (stages)</span>
        <select
          value={stages}
          disabled={running}
          onChange={(e) => setStages(e.target.value)}
          className="rounded-md border border-border bg-background px-3 py-2 text-sm"
        >
          <option value="generate,validate,attribute">核心闭环：generate,validate,attribute</option>
          <option value="generate,validate,attribute,evidence,policy,self-train,self-train-plan,export">
            完整闭环：核心 + evidence,policy,self-train,export
          </option>
          <option value="generate">仅提问生成（generate）</option>
          <option value="generate,validate">提问 + 量价验证（generate,validate）</option>
        </select>
        <span className="text-xs text-muted-foreground">
          「完整闭环」含 evidence/policy 等需 Tushare/CNINFO 的阶段，本机未配置时优雅降级。
        </span>
      </label>

      {/* 数量 + 行情源 */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">问题数量 (question-count)</span>
          <input
            type="number"
            min={1}
            max={50}
            value={questionCount}
            disabled={running}
            onChange={(e) => setQuestionCount(e.target.value)}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">量价验证源 (market-validate)</span>
          <select
            value={marketValidate}
            disabled={running}
            onChange={(e) => setMarketValidate(e.target.value as MarketValidate)}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm"
          >
            <option value="xueqiu">雪球（含成交额/换手，抗限流，推荐）</option>
            <option value="auto">自动（雪球→东财→腾讯 依次回退）</option>
            <option value="eastmoney">东方财富（字段全，但易被限流）</option>
            <option value="tencent">腾讯（稳定，但不返量能）</option>
            <option value="off">关闭</option>
          </select>
        </label>
      </div>

      {/* 外部行情并发 */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">行情超时 ms (external-market-timeout-ms)</span>
          <input
            type="number"
            min={500}
            max={60000}
            value={externalTimeoutMs}
            disabled={running}
            onChange={(e) => setExternalTimeoutMs(e.target.value)}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">行情并发 (external-market-concurrency)</span>
          <input
            type="number"
            min={1}
            max={50}
            value={externalConcurrency}
            disabled={running}
            onChange={(e) => setExternalConcurrency(e.target.value)}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
        </label>
      </div>

      {/* 开关 */}
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={selfTrainWrite}
            disabled={running}
            onChange={(e) => setSelfTrainWrite(e.target.checked)}
          />
          写入自训练动作（--self-train-write）
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={write}
            disabled={running}
            onChange={(e) => setWrite(e.target.checked)}
          />
          落盘写入（--write）
        </label>
      </div>

      {/* 运行 */}
      <div className="flex items-center gap-3">
        <Button onClick={run} disabled={running || !project}>
          <Play className="h-4 w-4" />
          {running ? `演化中… ${elapsed}s` : "运行 Self-Question Loop"}
        </Button>
        {!project && <span className="text-xs text-muted-foreground">未选择项目</span>}
      </div>

      {/* 自动研究 (autoresearch 收敛) */}
      <div className="space-y-3 rounded-md border border-indigo-200 bg-indigo-50/30 p-4">
        <div className="flex items-center gap-2 text-sm font-medium text-indigo-800">
          <NotebookText className="h-4 w-4" />
          自动研究 (autoresearch) — 状态 / 账本
        </div>
        <p className="text-xs text-muted-foreground">
          自动研究循环已收敛到自问台面板。查看当前 readiness 或列出已有实验账本，调用底层 <code className="rounded bg-muted px-1">autoresearch status</code> / <code className="rounded bg-muted px-1">autoresearch ledger</code>。
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">子命令</span>
            <select
              value={arSubcommand}
              disabled={arRunning}
              onChange={(e) => setArSubcommand(e.target.value as "status" | "ledger")}
              className="rounded-md border border-border bg-background px-2 py-1 text-xs"
            >
              <option value="status">status (readiness)</option>
              <option value="ledger">ledger (实验账本)</option>
            </select>
          </label>
          <Button variant="outline" size="sm" onClick={runAutoresearch} disabled={arRunning || !project}>
            <BarChart3 className="h-4 w-4" />
            {arRunning ? "查询中…" : `查询 autoresearch ${arSubcommand}`}
          </Button>
        </div>
        {arError && (
          <div className="flex items-start gap-2 rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-700">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
            <span>{arError}</span>
          </div>
        )}
        {arResult && !arError && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs">
              <CheckCircle2 className="h-3 w-3 text-emerald-600" />
              <span className="font-medium">autoresearch {arSubcommand} 完成</span>
            </div>
            <pre className="max-h-72 overflow-auto rounded-md bg-muted/50 p-2 text-xs leading-relaxed">
              {arResult.length > 4000 ? arResult.slice(0, 4000) + "\n… (truncated)" : arResult}
            </pre>
          </div>
        )}
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
        <div className="space-y-4 rounded-md border border-border p-4">
          <div className="flex flex-wrap items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <span className="text-sm font-medium">演化完成</span>
            {result.runId && (
              <span className="rounded bg-muted px-2 py-0.5 text-xs">{result.runId}</span>
            )}
            {result.dryRun && (
              <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-700">dry-run</span>
            )}
            {result.status && (
              <span className="rounded bg-muted px-2 py-0.5 text-xs">{result.status}</span>
            )}
          </div>

          {result.stages && result.stages.length > 0 && (
            <div className="text-xs">
              <span className="font-medium">阶段：</span>
              <span className="text-muted-foreground">{result.stages.join(" → ")}</span>
            </div>
          )}

          {result.counts && (
            <div className="flex flex-wrap gap-3 text-xs">
              <span className="rounded bg-muted px-2 py-0.5">
                问题 {result.counts.questions ?? "?"}
              </span>
              <span className="rounded bg-muted px-2 py-0.5">
                验证 {result.counts.validations ?? "?"}
              </span>
              <span className="rounded bg-muted px-2 py-0.5">
                归因 {result.counts.attributions ?? "?"}
              </span>
              {typeof result.selfTrainingActions === "number" && (
                <span className="rounded bg-muted px-2 py-0.5">
                  自训练动作 {result.selfTrainingActions}
                </span>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {result.manifest && (
              <Button variant="outline" size="sm" onClick={() => openPath(result.manifest)}>
                <Repeat className="h-4 w-4" />
                运行清单
              </Button>
            )}
            {(result.exports ?? []).map((exp, i) => (
              <Button
                key={i}
                variant="outline"
                size="sm"
                onClick={() => openPath(exp.relativePath ?? exp.manifest)}
              >
                <FileText className="h-4 w-4" />
                {exp.kind ?? `导出 ${i + 1}`}
                {typeof exp.count === "number" ? ` (${exp.count})` : ""}
              </Button>
            ))}
            {!result.manifest && (!result.exports || result.exports.length === 0) && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                无可见产物（问题/验证已写入 data/brain）
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
