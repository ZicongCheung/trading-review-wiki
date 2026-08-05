import { useCallback, useEffect, useRef, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import { useWikiStore } from "@/stores/wiki-store"
import { Button } from "@/components/ui/button"
import { Play, FileText, AlertTriangle, CheckCircle2, Clock, Sunrise, Sunset, Layers } from "lucide-react"

type DailyLoopMode = "premarket" | "postclose" | "full"
type MarketValidate = "off" | "xueqiu" | "eastmoney" | "auto"

interface DailyLoopResult {
  dryRun?: boolean
  mode?: string
  runId?: string
  counts?: Record<string, number>
  sql?: { status?: string; warning?: string | null }
  marketValidation?: {
    mode?: string
    externalStatus?: string
    externalOkCount?: number
    externalTotal?: number
    warning?: string | null
  }
  questionPlanner?: { status?: string; mode?: string; warning?: string | null; plannedCount?: number }
  report?: string | null
  feedback?: string | null
  compoundPaths?: string[]
  selfTrainingActions?: number | null
}

const MODE_OPTIONS: { value: DailyLoopMode; label: string; icon: typeof Sunrise; hint: string }[] = [
  { value: "premarket", label: "盘前", icon: Sunrise, hint: "盘前机会发现" },
  { value: "postclose", label: "盘后", icon: Sunset, hint: "盘后验证 + 反馈" },
  { value: "full", label: "完整", icon: Layers, hint: "盘前 + 盘后全套" },
]

const COUNT_FIELDS: { key: string; label: string }[] = [
  { key: "stockUniverse", label: "股票池" },
  { key: "recentCorpus", label: "近期语料" },
  { key: "themes", label: "主题" },
  { key: "candidateStocks", label: "候选股" },
  { key: "questions", label: "问题" },
  { key: "predictions", label: "预测" },
  { key: "validations", label: "验证" },
]

export function DailyLoopPanel() {
  const project = useWikiStore((s) => s.project)
  const setSelectedFile = useWikiStore((s) => s.setSelectedFile)
  const setActiveView = useWikiStore((s) => s.setActiveView)

  const [mode, setMode] = useState<DailyLoopMode>("premarket")
  const [questionCount, setQuestionCount] = useState(8)
  const [validatePendingOnly, setValidatePendingOnly] = useState(false)
  const [writeReport, setWriteReport] = useState(true)
  const [marketValidate, setMarketValidate] = useState<MarketValidate>("xueqiu")
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<DailyLoopResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<string[]>([])
  const startedAt = useRef<number>(0)

  useEffect(() => {
    let unlisten: UnlistenFn | undefined
    let cancelled = false
    listen<{ action?: string; stream?: string; line?: string }>("research-cockpit-progress", (evt) => {
      if (cancelled) return
      const payload = evt.payload
      if (payload?.action !== "daily-loop") return
      if (payload.stream === "stderr" && payload.line) {
        const line = payload.line
        setProgress((prev) => [...prev.slice(-40), line])
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
        "--mode", mode,
        "--question-count", String(questionCount),
        "--market-validate", marketValidate,
      ]
      if (validatePendingOnly) args.push("--validate-pending-only")
      if (writeReport) args.push("--write")
      args.push("--api-key", cfg.apiKey ?? "")
      if (cfg.customEndpoint) args.push("--endpoint", cfg.customEndpoint)
      if (cfg.model) args.push("--model", cfg.model)

      const raw = await invoke<string>("run_research_cockpit_command", {
        projectPath: project.path,
        action: "daily-loop",
        args,
      })
      let parsed: DailyLoopResult
      try {
        parsed = JSON.parse(raw) as DailyLoopResult
      } catch {
        parsed = { mode, dryRun: true, report: null }
      }
      setResult(parsed)
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally {
      setRunning(false)
    }
  }, [project, mode, questionCount, validatePendingOnly, writeReport, marketValidate])

  // 仅跑市场验证（validate-pending-only）：复用 daily-loop arm，不写报告，
  // 只验证待处理预测并回写 brain/feedback，作为 market-validate 的独立子动作。
  const runValidateOnly = useCallback(async () => {
    if (!project) return
    setRunning(true)
    setError(null)
    setResult(null)
    setProgress([])
    startedAt.current = Date.now()
    try {
      const cfg = useWikiStore.getState().llmConfig
      const args: string[] = [
        "--mode", "postclose",
        "--validate-pending-only",
        "--market-validate", marketValidate,
      ]
      args.push("--api-key", cfg.apiKey ?? "")
      if (cfg.customEndpoint) args.push("--endpoint", cfg.customEndpoint)
      if (cfg.model) args.push("--model", cfg.model)

      const raw = await invoke<string>("run_research_cockpit_command", {
        projectPath: project.path,
        action: "daily-loop",
        args,
      })
      let parsed: DailyLoopResult
      try {
        parsed = JSON.parse(raw) as DailyLoopResult
      } catch {
        parsed = { mode: "postclose", dryRun: false, report: null }
      }
      setResult(parsed)
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally {
      setRunning(false)
    }
  }, [project, marketValidate])

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
        <h1 className="text-xl font-semibold">每日盘前盘后（Daily Loop）</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          基于知识库自动生成盘前/盘后研究问题、调用多源检索作答，并（可选）落盘报告到
          <code className="mx-1 rounded bg-muted px-1">.llm-wiki/daily-research/</code>。
          规划器使用规则生成（兼容 DeepSeek 等 OpenAI 兼容端点）。
        </p>
      </div>

      {/* 模式选择 */}
      <div className="flex flex-wrap gap-2">
        {MODE_OPTIONS.map((opt) => {
          const Icon = opt.icon
          const active = mode === opt.value
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => setMode(opt.value)}
              disabled={running}
              className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors ${
                active
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:bg-accent/50"
              }`}
            >
              <Icon className="h-4 w-4" />
              <span className="font-medium">{opt.label}</span>
              <span className="text-xs opacity-70">{opt.hint}</span>
            </button>
          )
        })}
      </div>

      {/* 参数 */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">问题数量</span>
          <input
            type="number"
            min={1}
            max={20}
            value={questionCount}
            disabled={running || validatePendingOnly}
            onChange={(e) => setQuestionCount(Math.min(20, Math.max(1, Number(e.target.value) || 1)))}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">行情验证（market-validate）</span>
          <select
            value={marketValidate}
            disabled={running}
            onChange={(e) => setMarketValidate(e.target.value as MarketValidate)}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm"
          >
            <option value="xueqiu">雪球（含成交额/换手，抗限流，推荐）</option>
            <option value="auto">自动（雪球→腾讯 依次回退）</option>
            <option value="off">关闭（不调用外部行情）</option>
          </select>
        </label>
      </div>

      {/* 开关 */}
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={validatePendingOnly}
            disabled={running}
            onChange={(e) => setValidatePendingOnly(e.target.checked)}
          />
          仅验证待处理预测（validate-pending-only）
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={writeReport}
            disabled={running || validatePendingOnly}
            onChange={(e) => setWriteReport(e.target.checked)}
          />
          写入报告（--write）
        </label>
      </div>

      {/* 运行 */}
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={run} disabled={running || !project}>
          <Play className="h-4 w-4" />
          {running ? `运行中… ${elapsed}s` : "运行 Daily Loop"}
        </Button>
        <Button variant="outline" onClick={runValidateOnly} disabled={running || !project}>
          <Play className="h-4 w-4" />
          仅跑市场验证
        </Button>
        {!project && <span className="text-xs text-muted-foreground">未选择项目</span>}
      </div>

      {/* 进度 */}
      {running && progress.length > 0 && (
        <div className="max-h-40 overflow-auto rounded-md border border-border bg-muted/40 p-3 text-xs">
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
            <span className="text-sm font-medium">运行完成</span>
            <span className="rounded bg-muted px-2 py-0.5 text-xs">{result.mode ?? mode}</span>
            {result.dryRun && (
              <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-700">dry-run（未落盘）</span>
            )}
            {result.runId && <span className="text-xs text-muted-foreground">{result.runId}</span>}
          </div>

          {result.counts && (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {COUNT_FIELDS.map((f) => (
                <div key={f.key} className="rounded-md border border-border bg-muted/30 p-2 text-center">
                  <div className="text-lg font-semibold">{result.counts?.[f.key] ?? 0}</div>
                  <div className="text-xs text-muted-foreground">{f.label}</div>
                </div>
              ))}
            </div>
          )}

          {result.sql && (
            <div className="text-xs">
              <span className="font-medium">SQL 行情源：</span>
              <span className={result.sql.status === "ok" ? "text-emerald-600" : "text-amber-600"}>
                {result.sql.status}
              </span>
              {result.sql.warning && <span className="ml-2 text-muted-foreground">{result.sql.warning}</span>}
            </div>
          )}

          {result.marketValidation && (
            <div className="text-xs">
              <span className="font-medium">外部行情验证：</span>
              <span className="text-muted-foreground">
                {result.marketValidation.mode} / {result.marketValidation.externalStatus}
                {typeof result.marketValidation.externalOkCount === "number" &&
                  ` (${result.marketValidation.externalOkCount}/${result.marketValidation.externalTotal})`}
              </span>
              {result.marketValidation.warning && (
                <span className="ml-2 text-amber-600">{result.marketValidation.warning}</span>
              )}
            </div>
          )}

          {result.questionPlanner && (
            <div className="text-xs">
              <span className="font-medium">问题规划器：</span>
              <span className="text-muted-foreground">{result.questionPlanner.status}</span>
              {result.questionPlanner.warning && (
                <span className="ml-2 text-amber-600">{result.questionPlanner.warning}</span>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {result.report ? (
              <Button variant="outline" size="sm" onClick={() => openPath(result.report)}>
                <FileText className="h-4 w-4" />
                打开报告
              </Button>
            ) : (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                无报告文件（dry-run 或未生成）
              </span>
            )}
            {result.feedback && (
              <Button variant="outline" size="sm" onClick={() => openPath(result.feedback)}>
                <FileText className="h-4 w-4" />
                打开反馈
              </Button>
            )}
            {result.compoundPaths && result.compoundPaths.length > 0 && (
              <div className="mt-2 w-full border-t pt-2">
                <div className="mb-1 text-xs font-medium text-muted-foreground">复利回灌（中文分类 wiki）</div>
                <div className="flex flex-wrap gap-2">
                  {result.compoundPaths.map((p) => (
                    <Button key={p} variant="ghost" size="sm" className="h-auto px-2 py-1 text-xs" onClick={() => openPath(p)}>
                      <FileText className="mr-1 h-3 w-3" />
                      {p.split("/").pop()}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
