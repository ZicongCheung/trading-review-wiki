import { useCallback, useEffect, useRef, useState } from "react"
import {
  Bot,
  Brain,
  CheckCircle2,
  ListTree,
  Loader2,
  Play,
  RefreshCw,
  Save,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { runResearchCockpitCommand, type ResearchCockpitAction } from "@/commands/research-cockpit"
import { useWikiStore } from "@/stores/wiki-store"

type CommandResult = { ok: boolean; raw: unknown; error?: string }

interface FamilyAction {
  label: string
  action: ResearchCockpitAction
  args?: string[]
  needs?: ("taskId" | "stockCode" | "resultId")[]
  tone?: "neutral" | "good" | "warn"
}

const STOCK_FEEDBACK_FAMILY: { group: string; actions: FamilyAction[] }[] = [
  {
    group: "证据链 (evidence)",
    actions: [
      { label: "证据任务·列表", action: "stock-feedback-evidence-task-list", args: ["--status", "all", "--limit", "50"] },
      { label: "证据任务·详情", action: "stock-feedback-evidence-task-show", needs: ["taskId"] },
      { label: "证据任务·创建(演练)", action: "stock-feedback-evidence-task-create-dry-run" },
      { label: "证据任务·创建(写入)", action: "stock-feedback-evidence-task-create-write" },
      { label: "证据结果·列表", action: "stock-feedback-evidence-result-list", args: ["--limit", "50"] },
      { label: "证据结果·复核(写入)", action: "stock-feedback-evidence-result-review-write", needs: ["resultId"] },
      { label: "数据源健康", action: "stock-feedback-source-status" },
      { label: "死信队列·列表", action: "stock-feedback-dlq-list", args: ["--status", "all", "--limit", "50"] },
      { label: "死信·重试(写入)", action: "stock-feedback-dlq-retry-write", needs: ["taskId"] },
      { label: "死信·丢弃(写入)", action: "stock-feedback-dlq-discard-write", needs: ["taskId"] },
    ],
  },
  {
    group: "队列与轨迹 (queue / trajectory)",
    actions: [
      { label: "运行任务队列(演练)", action: "stock-feedback-run-task-queue-dry-run", args: ["--limit", "20"] },
      { label: "运行任务队列(写入)", action: "stock-feedback-run-task-queue-write", args: ["--limit", "20"] },
      { label: "轨迹·列表", action: "stock-feedback-list", args: ["--limit", "50"] },
      { label: "复核队列", action: "stock-feedback-review-queue", args: ["--limit", "50"] },
      { label: "人工复核(演练)", action: "stock-feedback-review-dry-run" },
      { label: "人工复核(写入)", action: "stock-feedback-review-write" },
      { label: "构建轨迹(演练)", action: "stock-feedback-build-dry-run" },
      { label: "构建轨迹(写入)", action: "stock-feedback-build-write" },
      { label: "Benchmark", action: "stock-feedback-bench" },
      { label: "导出 LoRA-ready", action: "stock-feedback-export-lora-ready" },
      { label: "校验", action: "stock-feedback-verify" },
    ],
  },
  {
    group: "模拟交易 (paper-trade)",
    actions: [
      { label: "模拟交易·状态", action: "stock-feedback-paper-trade-status" },
      { label: " discretionary 复核", action: "stock-feedback-paper-trade-discretionary-review" },
      { label: "模拟交易·记录(演练)", action: "stock-feedback-paper-trade-record-dry-run", needs: ["stockCode"] },
      { label: "模拟交易·记录(写入)", action: "stock-feedback-paper-trade-record-write", needs: ["stockCode"] },
      { label: "模拟交易·结算(演练)", action: "stock-feedback-paper-trade-settle-dry-run", needs: ["stockCode"] },
      { label: "模拟交易·结算(写入)", action: "stock-feedback-paper-trade-settle-write", needs: ["stockCode"] },
      { label: "Adapter 候选(演练)", action: "stock-feedback-paper-trade-agent-dry-run" },
      { label: "Adapter 候选(写入)", action: "stock-feedback-paper-trade-agent-write" },
    ],
  },
  {
    group: "采集 (collection)",
    actions: [
      { label: "采集任务(演练)", action: "stock-feedback-collection-task-dry-run" },
      { label: "采集任务(写入)", action: "stock-feedback-collection-task-write" },
      { label: "采集结果(演练)", action: "stock-feedback-collection-result-dry-run" },
      { label: "采集结果(写入)", action: "stock-feedback-collection-result-write" },
    ],
  },
]

function ResultBlock({ result }: { result: CommandResult | null }) {
  if (!result) return null
  if (result.error) {
    return (
      <pre className="max-h-72 overflow-auto rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
        {result.error}
      </pre>
    )
  }
  return (
    <pre className="max-h-72 overflow-auto rounded-md border bg-muted p-3 text-xs">
      {typeof result.raw === "string" ? result.raw : JSON.stringify(result.raw, null, 2)}
    </pre>
  )
}

export function TrainingFlywheelExtras() {
  const project = useWikiStore((s) => s.project)
  const projectPath = project?.path ?? ""

  const [brainStatus, setBrainStatus] = useState<CommandResult | null>(null)

  // brain remember/resolve forms
  const BRAIN_TYPES = [
    "preference",
    "guardrail",
    "correction",
    "question",
    "prediction",
    "validation",
    "attribution",
    "evidence_result",
    "policy",
    "thread",
    "event",
  ] as const
  const RESOLVE_RESULTS = ["success", "failure", "uncertain"] as const

  const [bType, setBType] = useState<string>("preference")
  const [bText, setBText] = useState("")
  const [bTitle, setBTitle] = useState("")
  const [bStatus, setBStatus] = useState("")
  const [bSource, setBSource] = useState("")
  const [bTags, setBTags] = useState("")
  const [bRelated, setBRelated] = useState("")
  const [rId, setRId] = useState("")
  const [rResult, setRResult] = useState<string>("success")
  const [rNote, setRNote] = useState("")

  // stock-feedback family launcher
  const [taskId, setTaskId] = useState("")
  const [stockCode, setStockCode] = useState("")
  const [resultId, setResultId] = useState("")
  const [familyResult, setFamilyResult] = useState<CommandResult | null>(null)

  const [running, setRunning] = useState<string | null>(null)
  const startedAt = useRef<number>(0)

  const runCmd = useCallback(
    async (key: string, action: ResearchCockpitAction, args: string[] = []) => {
      if (!projectPath) return
      setRunning(key)
      startedAt.current = Date.now()
      try {
        const raw = await runResearchCockpitCommand<unknown>(projectPath, action, args)
        return { ok: true, raw }
      } catch (err) {
        return { ok: false, raw: null, error: err instanceof Error ? err.message : String(err) }
      } finally {
        setRunning(null)
      }
    },
    [projectPath],
  )

  const loadBrain = useCallback(async () => {
    const res = await runCmd("brain-status", "brain", ["status"])
    setBrainStatus(res)
  }, [runCmd])

  useEffect(() => {
    if (projectPath) {
      loadBrain()
    }
  }, [projectPath, loadBrain])

  const submitRemember = useCallback(async () => {
    if (!bText.trim()) return
    const args = ["remember", "--type", bType.trim(), "--text", bText.trim()]
    if (bTitle.trim()) args.push("--title", bTitle.trim())
    if (bStatus.trim()) args.push("--status", bStatus.trim())
    if (bSource.trim()) args.push("--source", bSource.trim())
    if (bTags.trim()) args.push("--tags", bTags.trim())
    if (bRelated.trim()) args.push("--related", bRelated.trim())
    const res = await runCmd("brain-remember", "brain", args)
    setBrainStatus(res)
    if (res?.ok) {
      setBText("")
      setBTitle("")
      setBStatus("")
      setBSource("")
      setBTags("")
      setBRelated("")
    }
  }, [bText, bTitle, bStatus, bSource, bTags, bRelated, bType, runCmd])

  const submitResolve = useCallback(async () => {
    if (!rId.trim() || !rResult.trim()) return
    const args = ["resolve", "--id", rId.trim(), "--result", rResult.trim()]
    if (rNote.trim()) args.push("--note", rNote.trim())
    const res = await runCmd("brain-resolve", "brain", args)
    setBrainStatus(res)
    if (res?.ok) {
      setRId("")
      setRNote("")
    }
  }, [rId, rResult, rNote, runCmd])

  const runFamily = useCallback(
    async (fa: FamilyAction) => {
      const args = [...(fa.args ?? [])]
      if (fa.needs?.includes("taskId") && taskId.trim()) args.push("--task-id", taskId.trim())
      if (fa.needs?.includes("stockCode") && stockCode.trim()) args.push("--stock-code", stockCode.trim())
      if (fa.needs?.includes("resultId") && resultId.trim()) args.push("--result-id", resultId.trim())
      const res = await runCmd(`family-${fa.action}`, fa.action, args)
      setFamilyResult(res)
    },
    [taskId, stockCode, resultId, runCmd],
  )

  if (!project) {
    return (
      <section className="rounded-md border bg-card p-4 text-sm text-muted-foreground">
        请先打开一个交易复盘项目
      </section>
    )
  }

  const busy = running !== null

  return (
    <section className="rounded-md border bg-card p-4">
      <div className="mb-3 flex items-center gap-2">
        <Brain className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">训练飞轮 · 增强控制</h2>
        <Button variant="ghost" size="sm" className="ml-auto h-7" onClick={loadBrain} disabled={busy}>
          <RefreshCw className={running ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} /> 刷新
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Brain inspection */}
        <div className="space-y-3 rounded-md border p-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Brain className="h-4 w-4" /> 大脑检视 (brain)
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs text-muted-foreground">当前大脑状态 (status)</span>
              <Button size="sm" variant="outline" className="h-7" onClick={loadBrain} disabled={running === "brain-status"}>
                {running === "brain-status" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} 查看
              </Button>
            </div>
            <ResultBlock result={brainStatus} />
          </div>

          <div className="space-y-2 border-t pt-2">
            <p className="text-xs font-medium text-muted-foreground">记录 (remember)</p>
            <div className="grid grid-cols-2 gap-2">
              <select className="col-span-1 rounded border bg-background px-2 py-1 text-xs" value={bType} onChange={(e) => setBType(e.target.value)}>
                {BRAIN_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <input className="col-span-1 rounded border bg-background px-2 py-1 text-xs" placeholder="状态 status" value={bStatus} onChange={(e) => setBStatus(e.target.value)} />
              <input className="col-span-2 rounded border bg-background px-2 py-1 text-xs" placeholder="标题 title" value={bTitle} onChange={(e) => setBTitle(e.target.value)} />
              <input className="col-span-2 rounded border bg-background px-2 py-1 text-xs" placeholder="来源 source" value={bSource} onChange={(e) => setBSource(e.target.value)} />
              <input className="col-span-2 rounded border bg-background px-2 py-1 text-xs" placeholder="标签 tags (逗号分隔)" value={bTags} onChange={(e) => setBTags(e.target.value)} />
              <input className="col-span-2 rounded border bg-background px-2 py-1 text-xs" placeholder="关联 related" value={bRelated} onChange={(e) => setBRelated(e.target.value)} />
              <textarea className="col-span-2 min-h-16 rounded border bg-background px-2 py-1 text-xs" placeholder="内容 text (必填)" value={bText} onChange={(e) => setBText(e.target.value)} />
            </div>
            <Button size="sm" className="h-7 w-full" onClick={submitRemember} disabled={busy || !bText.trim()}>
              <Save className="h-3.5 w-3.5" /> 记录到大脑
            </Button>
          </div>

          <div className="space-y-2 border-t pt-2">
            <p className="text-xs font-medium text-muted-foreground">解决 (resolve)</p>
            <div className="grid grid-cols-2 gap-2">
              <input className="col-span-1 rounded border bg-background px-2 py-1 text-xs" placeholder="ID id (必填)" value={rId} onChange={(e) => setRId(e.target.value)} />
              <select className="col-span-1 rounded border bg-background px-2 py-1 text-xs" value={rResult} onChange={(e) => setRResult(e.target.value)}>
                {RESOLVE_RESULTS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
              <textarea className="col-span-2 min-h-12 rounded border bg-background px-2 py-1 text-xs" placeholder="备注 note" value={rNote} onChange={(e) => setRNote(e.target.value)} />
            </div>
            <Button size="sm" className="h-7 w-full" onClick={submitResolve} disabled={busy || !rId.trim()}>
              <CheckCircle2 className="h-3.5 w-3.5" /> 标记已解决
            </Button>
          </div>
        </div>

        {/* Autoresearch 已收敛到自问台 (E3) — 此处不再展示 */}

        {/* Stock-feedback full family */}
        <div className="space-y-3 rounded-md border p-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <ListTree className="h-4 w-4" /> Stock-Feedback 全族
          </div>
          <div className="grid grid-cols-3 gap-2">
            <input className="rounded border bg-background px-2 py-1 text-xs" placeholder="task-id" value={taskId} onChange={(e) => setTaskId(e.target.value)} />
            <input className="rounded border bg-background px-2 py-1 text-xs" placeholder="stock-code" value={stockCode} onChange={(e) => setStockCode(e.target.value)} />
            <input className="rounded border bg-background px-2 py-1 text-xs" placeholder="result-id" value={resultId} onChange={(e) => setResultId(e.target.value)} />
          </div>
          <div className="max-h-72 space-y-3 overflow-auto pr-1">
            {STOCK_FEEDBACK_FAMILY.map((grp) => (
              <div key={grp.group} className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">{grp.group}</p>
                <div className="flex flex-wrap gap-1.5">
                  {grp.actions.map((fa) => (
                    <Button
                      key={fa.action}
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-[11px]"
                      onClick={() => runFamily(fa)}
                      disabled={busy}
                    >
                      {running === `family-${fa.action}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                      {fa.label}
                    </Button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="border-t pt-2">
            <p className="mb-1 text-xs text-muted-foreground">执行结果</p>
            <ResultBlock result={familyResult} />
          </div>
        </div>
      </div>
    </section>
  )
}
