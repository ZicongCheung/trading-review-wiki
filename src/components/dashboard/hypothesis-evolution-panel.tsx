import { useCallback, useEffect, useRef, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import { open } from "@tauri-apps/plugin-dialog"
import { useWikiStore } from "@/stores/wiki-store"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Play, FileText, AlertTriangle, CheckCircle2, Clock,
  GitBranch, MessageCircle, ClipboardList, FilePlus2,
  SearchCheck, ShieldCheck, Download, Radio, Gauge, Eye,
  Lightbulb, ArrowRight, Loader2,
} from "lucide-react"

// ---------- section helpers ----------

function SectionHeader({ icon: Icon, title, subtitle }: { icon: React.ElementType; title: string; subtitle?: string }) {
  return (
    <div className="mb-3">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Icon className="h-4 w-4 text-primary" />
        {title}
      </div>
      {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
    </div>
  )
}

function ActionRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2">
      <span className="min-w-[110px] text-xs font-medium text-muted-foreground">{label}</span>
      <div className="flex flex-1 flex-wrap items-center gap-2">{children}</div>
    </div>
  )
}

function ResultBlock({ result, action }: { result: unknown; action: string | null }) {
  if (!result) return null
  const text = typeof result === "string" ? result : JSON.stringify(result, null, 2)
  const display = text.length > 4000 ? text.slice(0, 4000) + "\n...(truncated)" : text
  return (
    <div className="mt-2 rounded-md border bg-muted/30 p-3">
      <div className="mb-1 flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <CheckCircle2 className="h-3 w-3 text-green-500" />
        结果 {action ? `(${action})` : ""}
      </div>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs">{display}</pre>
    </div>
  )
}

function ErrorBlock({ error }: { error: string | null }) {
  if (!error) return null
  return (
    <div className="mt-2 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <pre className="max-h-32 overflow-auto whitespace-pre-wrap">{error}</pre>
    </div>
  )
}

// ---------- main component ----------

export function HypothesisEvolutionPanel() {
  const project = useWikiStore((s) => s.project)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<unknown>(null)
  const [resultAction, setResultAction] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<string[]>([])
  const startedAt = useRef<number>(0)

  // --- hypothesis mgmt state ---
  const [hypoTheme, setHypoTheme] = useState("")
  const [hypoTitle, setHypoTitle] = useState("")
  const [hypoId, setHypoId] = useState("")
  const [hypoStatus, setHypoStatus] = useState("watching")
  const [hypoTimeHorizon, setHypoTimeHorizon] = useState("")
  const [hypoWindow, setHypoWindow] = useState("20d")

  // --- wechat state ---
  const [wechatSource, setWechatSource] = useState("raw/微信聊天")
  const [wechatSince, setWechatSince] = useState("")
  const [wechatLimit, setWechatLimit] = useState("200")

  // --- observation draft state ---
  const [obsTitle, setObsTitle] = useState("")
  const [obsStocks, setObsStocks] = useState("")
  const [obsGap, setObsGap] = useState("")
  const [obsNextAction, setObsNextAction] = useState("")
  const [obsHypothesisId, setObsHypothesisId] = useState("")
  const [obsDate, setObsDate] = useState("")
  const [obsLimit, setObsLimit] = useState("8")

  // --- validate/report state ---
  const [valId, setValId] = useState("")
  const [valWindow, setValWindow] = useState("20d")
  const [repId, setRepId] = useState("")

  // --- export samples ---
  const [expKind, setExpKind] = useState("sft")
  const [expQG, setExpQG] = useState("all")
  const [expLimit, setExpLimit] = useState("8")

  // --- data-source ---
  const [dsStock, setDsStock] = useState("")
  const [dsDate, setDsDate] = useState("")

  // --- watch (增量监控) ---
  const [watchSince, setWatchSince] = useState("30m")
  const [watchLlmReview, setWatchLlmReview] = useState<"off" | "auto" | "force">("off")

  // --- progress listener ---
  useEffect(() => {
    let unlisten: UnlistenFn | undefined
    let cancelled = false
    listen<{ action?: string; stream?: string; line?: string }>("research-cockpit-progress", (evt) => {
      if (cancelled) return
      const payload = evt.payload
      const pa = payload?.action ?? ""
      if (!pa.startsWith("hypothesis") && !pa.startsWith("autoresearch") && !pa.startsWith("watch")) return
      if (payload.stream === "stderr" && payload.line) {
        setProgress((prev) => [...prev.slice(-80), payload.line])
      }
    })
      .then((fn) => { unlisten = fn })
      .catch(() => {})
    return () => { cancelled = true; unlisten?.() }
  }, [])

  // ---------- generic runner ----------
  const run = useCallback(async (action: string, args: string[]) => {
    if (!project) return
    setRunning(true)
    setError(null)
    setResult(null)
    setResultAction(action)
    setProgress([])
    startedAt.current = Date.now()
    try {
      const raw = await invoke<string>("run_research_cockpit_command", {
        projectPath: project.path,
        action,
        args,
      })
      try { setResult(JSON.parse(raw)) } catch { setResult({ raw }) }
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally {
      setRunning(false)
    }
  }, [project])

  const pickSource = useCallback(async () => {
    const chosen = await open({ directory: false, multiple: false })
    if (chosen) setWechatSource(chosen as string)
  }, [])

  // ---------- action builders ----------
  const runHypoDiscover = () => {
    const args: string[] = []
    if (hypoTheme.trim()) args.push("--theme", hypoTheme.trim())
    run("hypothesis-discover-dry-run", args)
  }

  const runHypoCreate = (write: boolean) => {
    const args = ["--title", hypoTitle.trim() || "未命名假设", "--status", hypoStatus]
    if (hypoTheme.trim()) args.push("--theme", hypoTheme.trim())
    if (hypoTimeHorizon.trim()) args.push("--time-horizon", hypoTimeHorizon.trim())
    if (write) run("hypothesis-create-write", args)
    else run("hypothesis-create-dry-run", args)
  }

  const runHypoStatusUpdate = () => {
    if (!hypoId.trim()) { setError("--id required"); return }
    run("hypothesis-status-update-write", ["--id", hypoId.trim(), "--status", hypoStatus])
  }

  const runHypoAsk = () => {
    if (!hypoId.trim()) { setError("--id required"); return }
    run("hypothesis-ask", ["--id", hypoId.trim()])
  }

  const runHypoVerify = () => run("hypothesis-verify", [])

  const runHypoPostMortem = (write: boolean) => {
    if (write) run("hypothesis-post-mortem-write", [])
    else run("hypothesis-post-mortem-dry-run", [])
  }

  const runHypoEvidence = (write: boolean) => {
    if (write) run("hypothesis-evidence-feedback-write", [])
    else run("hypothesis-evidence-feedback-dry-run", [])
  }

  // --- wechat ---
  const runWechatSources = () => {
    run("wechat-source-list", ["--source", wechatSource])
  }

  const runWechatImport = (write: boolean) => {
    const args = ["--source", wechatSource, "--limit", wechatLimit]
    if (wechatSince.trim()) args.push("--since", wechatSince.trim())
    if (write) run("wechat-import-raw-write", args)
    else run("wechat-import-raw-dry-run", args)
  }

  const runWechatProcess = () => run("wechat-process", [])
  const runWechatStatus = () => run("wechat-status", [])

  // --- observation drafts ---
  const runObsList = () => {
    const args = ["--limit", obsLimit]
    if (obsDate.trim()) args.push("--date", obsDate.trim())
    run("observation-draft-list", args)
  }

  const runObsWrite = () => {
    if (!obsTitle.trim()) { setError("--title required"); return }
    const args = ["--title", obsTitle.trim()]
    if (obsStocks.trim()) args.push("--stocks", obsStocks.trim())
    if (obsGap.trim()) args.push("--gap", obsGap.trim())
    if (obsNextAction.trim()) args.push("--next-action", obsNextAction.trim())
    if (obsHypothesisId.trim()) args.push("--hypothesis-id", obsHypothesisId.trim())
    run("observation-draft-write", args)
  }

  // --- policy ---
  const runPolicy = (write: boolean) => {
    if (write) run("policy-proposal-write", [])
    else run("policy-proposal-dry-run", [])
  }

  // --- validate / report ---
  const runValidate = () => {
    if (!valId.trim()) { setError("--id required"); return }
    run("validate", ["--id", valId.trim(), "--window", valWindow])
  }

  const runReport = () => {
    if (!repId.trim()) { setError("--id required"); return }
    run("report", ["--id", repId.trim()])
  }

  // --- export samples ---
  const runExportSamples = () => {
    run("export-samples-list", ["--kind", expKind, "--quality-gate", expQG, "--limit", expLimit])
  }

  // --- data source probe ---
  const runDSProbe = () => {
    const args: string[] = []
    if (dsStock.trim()) args.push("--stock-code", dsStock.trim())
    if (dsDate.trim()) args.push("--trade-date", dsDate.trim())
    run("data-source-tushare-probe", args)
  }

  // --- watch (增量监控) ---
  const runWatch = (write: boolean) => {
    const args: string[] = []
    if (watchSince.trim()) args.push("--since", watchSince.trim())
    if (watchLlmReview !== "off") args.push("--llm-review", watchLlmReview)
    run(write ? "watch-write" : "watch-dry-run", args)
  }

  const elapsed = startedAt.current ? Math.floor((Date.now() - startedAt.current) / 1000) : 0
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!running) return
    const interval = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(interval)
  }, [running])

  return (
    <div className="flex h-full flex-col overflow-auto p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold">假设演化台 (Hypothesis Evolution)</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          假设全生命周期管理：发现 → 创建 → 跟踪 → 证据反馈 → 验证 → 复盘。整合微信导入、观测草稿、政策提议、数据源探测。
        </p>
        {!project && <p className="mt-2 text-xs text-red-500">⚠ 未选择项目</p>}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">

        {/* ===== 1. 假设管理 ===== */}
        <section className="rounded-lg border p-4">
          <SectionHeader icon={GitBranch} title="假设管理" subtitle="discover / create / status-update / ask / verify / post-mortem / evidence-feedback" />

          <div className="space-y-2">
            <ActionRow label="发现 (discover)">
              <Input className="h-7 w-44 text-xs" placeholder="主题 (如 AI数据中心)" value={hypoTheme} onChange={(e) => setHypoTheme(e.target.value)} />
              <Button size="sm" className="h-7 text-xs" onClick={runHypoDiscover} disabled={running}><Play className="h-3 w-3" /> dry-run</Button>
            </ActionRow>

            <ActionRow label="创建 (create)">
              <Input className="h-7 w-36 text-xs" placeholder="标题" value={hypoTitle} onChange={(e) => setHypoTitle(e.target.value)} />
              <select className="h-7 rounded border bg-background px-2 text-xs" value={hypoStatus} onChange={(e) => setHypoStatus(e.target.value)}>
                <option value="watching">watching</option>
                <option value="strengthening">strengthening</option>
                <option value="priced_in_risk">priced_in_risk</option>
                <option value="disconfirmed">disconfirmed</option>
              </select>
              <Input className="h-7 w-24 text-xs" placeholder="时间跨度" value={hypoTimeHorizon} onChange={(e) => setHypoTimeHorizon(e.target.value)} />
              <Button size="sm" className="h-7 text-xs" onClick={() => runHypoCreate(false)} disabled={running}><Play className="h-3 w-3" /> dry-run</Button>
              <Button size="sm" className="h-7 text-xs" variant="outline" onClick={() => runHypoCreate(true)} disabled={running}><FilePlus2 className="h-3 w-3" /> write</Button>
            </ActionRow>

            <ActionRow label="状态更新 (status-update)">
              <Input className="h-7 w-36 text-xs" placeholder="假设 ID" value={hypoId} onChange={(e) => setHypoId(e.target.value)} />
              <select className="h-7 rounded border bg-background px-2 text-xs" value={hypoStatus} onChange={(e) => setHypoStatus(e.target.value)}>
                <option value="watching">watching</option>
                <option value="strengthening">strengthening</option>
                <option value="priced_in_risk">priced_in_risk</option>
                <option value="disconfirmed">disconfirmed</option>
              </select>
              <Button size="sm" className="h-7 text-xs" onClick={runHypoStatusUpdate} disabled={running}><Play className="h-3 w-3" /> write</Button>
            </ActionRow>

            <ActionRow label="问答 (ask)">
              <Input className="h-7 w-36 text-xs" placeholder="假设 ID" value={hypoId} onChange={(e) => setHypoId(e.target.value)} />
              <Button size="sm" className="h-7 text-xs" onClick={runHypoAsk} disabled={running}><SearchCheck className="h-3 w-3" /> 运行</Button>
            </ActionRow>

            <ActionRow label="工具">
              <Button size="sm" className="h-7 text-xs" onClick={runHypoVerify} disabled={running}><ShieldCheck className="h-3 w-3" /> verify</Button>
              <Button size="sm" className="h-7 text-xs" onClick={() => runHypoPostMortem(false)} disabled={running}><Clock className="h-3 w-3" /> post-mortem (dry)</Button>
              <Button size="sm" className="h-7 text-xs" variant="outline" onClick={() => runHypoPostMortem(true)} disabled={running}><Clock className="h-3 w-3" /> post-mortem (write)</Button>
              <Button size="sm" className="h-7 text-xs" onClick={() => runHypoEvidence(false)} disabled={running}><ArrowRight className="h-3 w-3" /> evidence (dry)</Button>
              <Button size="sm" className="h-7 text-xs" variant="outline" onClick={() => runHypoEvidence(true)} disabled={running}><ArrowRight className="h-3 w-3" /> evidence (write)</Button>
            </ActionRow>
          </div>
        </section>

        {/* ===== 2. 微信导入 ===== */}
        <section className="rounded-lg border p-4">
          <SectionHeader icon={MessageCircle} title="微信导入 (WeChat Inbox)" subtitle="sources / import-raw / process / status" />

          <div className="space-y-2">
            <ActionRow label="源文件">
              <Input className="h-7 flex-1 text-xs font-mono" value={wechatSource} onChange={(e) => setWechatSource(e.target.value)} />
              <Button size="sm" className="h-7 text-xs" variant="ghost" onClick={pickSource}>浏览</Button>
            </ActionRow>

            <ActionRow label="查看源 (sources)">
              <Button size="sm" className="h-7 text-xs" onClick={runWechatSources} disabled={running}><Play className="h-3 w-3" /> 查看</Button>
            </ActionRow>

            <ActionRow label="导入 (import-raw)">
              <Input className="h-7 w-20 text-xs" placeholder="since (如 7d)" value={wechatSince} onChange={(e) => setWechatSince(e.target.value)} />
              <Input className="h-7 w-16 text-xs" placeholder="limit" value={wechatLimit} onChange={(e) => setWechatLimit(e.target.value)} />
              <Button size="sm" className="h-7 text-xs" onClick={() => runWechatImport(false)} disabled={running}><Play className="h-3 w-3" /> dry-run</Button>
              <Button size="sm" className="h-7 text-xs" variant="outline" onClick={() => runWechatImport(true)} disabled={running}><Download className="h-3 w-3" /> write</Button>
            </ActionRow>

            <ActionRow label="处理/状态">
              <Button size="sm" className="h-7 text-xs" onClick={runWechatProcess} disabled={running}><Play className="h-3 w-3" /> process</Button>
              <Button size="sm" className="h-7 text-xs" onClick={runWechatStatus} disabled={running}><Gauge className="h-3 w-3" /> status</Button>
            </ActionRow>
          </div>
        </section>

        {/* ===== 3. 观测草稿 ===== */}
        <section className="rounded-lg border p-4">
          <SectionHeader icon={ClipboardList} title="观测草稿 (Observation Drafts)" subtitle="list / write — 将观测沉淀为结构化草稿" />

          <div className="space-y-2">
            <ActionRow label="列出草稿">
              <Input className="h-7 w-28 text-xs" placeholder="日期 (YYYY-MM-DD)" value={obsDate} onChange={(e) => setObsDate(e.target.value)} />
              <Input className="h-7 w-14 text-xs" placeholder="limit" value={obsLimit} onChange={(e) => setObsLimit(e.target.value)} />
              <Button size="sm" className="h-7 text-xs" onClick={runObsList} disabled={running}><Play className="h-3 w-3" /> list</Button>
            </ActionRow>

            <ActionRow label="新建草稿">
              <Input className="h-7 w-40 text-xs" placeholder="标题" value={obsTitle} onChange={(e) => setObsTitle(e.target.value)} />
              <Input className="h-7 w-28 text-xs" placeholder="股票代码" value={obsStocks} onChange={(e) => setObsStocks(e.target.value)} />
              <Input className="h-7 w-28 text-xs" placeholder="缺口" value={obsGap} onChange={(e) => setObsGap(e.target.value)} />
              <Input className="h-7 w-28 text-xs" placeholder="下一步" value={obsNextAction} onChange={(e) => setObsNextAction(e.target.value)} />
              <Input className="h-7 w-28 text-xs" placeholder="假设ID" value={obsHypothesisId} onChange={(e) => setObsHypothesisId(e.target.value)} />
              <Button size="sm" className="h-7 text-xs" onClick={runObsWrite} disabled={running}><FilePlus2 className="h-3 w-3" /> write</Button>
            </ActionRow>
          </div>
        </section>

        {/* ===== 4. 政策提议 ===== */}
        <section className="rounded-lg border p-4">
          <SectionHeader icon={Lightbulb} title="政策提议 (Policy Proposals)" subtitle="autoresearch proposal — 基于评分增量自动生成策略变更提案" />

          <div className="flex flex-wrap gap-2">
            <Button size="sm" className="h-7 text-xs" onClick={() => runPolicy(false)} disabled={running}><Play className="h-3 w-3" /> dry-run</Button>
            <Button size="sm" className="h-7 text-xs" variant="outline" onClick={() => runPolicy(true)} disabled={running}><FilePlus2 className="h-3 w-3" /> write</Button>
          </div>
        </section>

        {/* ===== 5. 验证/报告 ===== */}
        <section className="rounded-lg border p-4">
          <SectionHeader icon={ShieldCheck} title="验证 & 报告 (Validate & Report)" subtitle="对假设进行外部数据验证 / 生成结构化报告" />

          <div className="space-y-2">
            <ActionRow label="验证 (validate)">
              <Input className="h-7 w-36 text-xs" placeholder="假设 ID" value={valId} onChange={(e) => setValId(e.target.value)} />
              <Input className="h-7 w-20 text-xs" placeholder="窗口 (如 20d)" value={valWindow} onChange={(e) => setValWindow(e.target.value)} />
              <Button size="sm" className="h-7 text-xs" onClick={runValidate} disabled={running}><SearchCheck className="h-3 w-3" /> validate</Button>
            </ActionRow>

            <ActionRow label="报告 (report)">
              <Input className="h-7 w-36 text-xs" placeholder="假设 ID" value={repId} onChange={(e) => setRepId(e.target.value)} />
              <Button size="sm" className="h-7 text-xs" onClick={runReport} disabled={running}><FileText className="h-3 w-3" /> report (--json)</Button>
            </ActionRow>
          </div>
        </section>

        {/* ===== 6. 样本导出 ===== */}
        <section className="rounded-lg border p-4">
          <SectionHeader icon={Download} title="样本导出 (Export Samples)" subtitle="导出 SFT / RLHF / preference 训练样本" />

          <div className="flex flex-wrap items-center gap-2">
            <select className="h-7 rounded border bg-background px-2 text-xs" value={expKind} onChange={(e) => setExpKind(e.target.value)}>
              <option value="sft">sft</option>
              <option value="rlhf">rlhf</option>
              <option value="preference">preference</option>
            </select>
            <select className="h-7 rounded border bg-background px-2 text-xs" value={expQG} onChange={(e) => setExpQG(e.target.value)}>
              <option value="all">all</option>
              <option value="high">high</option>
              <option value="medium">medium</option>
            </select>
            <Input className="h-7 w-16 text-xs" placeholder="limit" value={expLimit} onChange={(e) => setExpLimit(e.target.value)} />
            <Button size="sm" className="h-7 text-xs" onClick={runExportSamples} disabled={running}><Download className="h-3 w-3" /> list</Button>
          </div>
        </section>

        {/* ===== 7. 数据源探测 ===== */}
        <section className="rounded-lg border p-4">
          <SectionHeader icon={Radio} title="数据源探测 (Data Source Probe)" subtitle="Tushare 数据可用性探测" />

          <div className="flex flex-wrap items-center gap-2">
            <Input className="h-7 w-28 text-xs" placeholder="股票代码" value={dsStock} onChange={(e) => setDsStock(e.target.value)} />
            <Input className="h-7 w-28 text-xs" placeholder="交易日 (YYYYMMDD)" value={dsDate} onChange={(e) => setDsDate(e.target.value)} />
            <Button size="sm" className="h-7 text-xs" onClick={runDSProbe} disabled={running}><Radio className="h-3 w-3" /> probe</Button>
          </div>
        </section>

        {/* ===== 8. 增量监控 (watch) ===== */}
        <section className="rounded-lg border p-4">
          <SectionHeader icon={Eye} title="增量监控 (Watch)" subtitle="监控微信增量与补资料，生成预警 (hypothesis watch)" />

          <div className="flex flex-wrap items-center gap-2">
            <Input className="h-7 w-28 text-xs" placeholder="since (如 30m/7d)" value={watchSince} onChange={(e) => setWatchSince(e.target.value)} />
            <select className="h-7 rounded border bg-background px-2 text-xs" value={watchLlmReview} onChange={(e) => setWatchLlmReview(e.target.value as "off" | "auto" | "force")}>
              <option value="off">llm-review: off</option>
              <option value="auto">auto</option>
              <option value="force">force</option>
            </select>
            <Button size="sm" className="h-7 text-xs" onClick={() => runWatch(false)} disabled={running}><Eye className="h-3 w-3" /> dry-run</Button>
            <Button size="sm" className="h-7 text-xs" variant="outline" onClick={() => runWatch(true)} disabled={running}><Eye className="h-3 w-3" /> write</Button>
          </div>
        </section>

      </div>

      {/* Progress + Result */}
      {running && (
        <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          运行中… {elapsed}s
          {progress.length > 0 && <span className="ml-2">({progress.length} 条进度)</span>}
        </div>
      )}

      <ErrorBlock error={error} />
      <ResultBlock result={result} action={resultAction} />
    </div>
  )
}
