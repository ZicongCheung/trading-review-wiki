import { useCallback, useEffect, useRef, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import { useWikiStore } from "@/stores/wiki-store"
import { Button } from "@/components/ui/button"
import { Play, FileText, AlertTriangle, CheckCircle2, Clock, Building2, Globe } from "lucide-react"

interface CompanyResearchOutput {
  report?: string
  deepReport?: string
  modelXlsx?: string
  deepModelXlsx?: string
  businessBreakdown?: string
  [key: string]: string | undefined
}

interface CompanyResearchResult {
  mode?: string
  generatedAt?: string
  company?: { stockCode?: string; stockName?: string; secName?: string }
  outputDir?: string
  deep?: boolean
  pluginLed?: boolean
  pluginReview?: boolean
  outputs?: CompanyResearchOutput
  writePolicy?: { allowed?: boolean; reason?: string }
}

export function CompanyResearchPanel() {
  const project = useWikiStore((s) => s.project)
  const setSelectedFile = useWikiStore((s) => s.setSelectedFile)
  const setActiveView = useWikiStore((s) => s.setActiveView)

  const [stock, setStock] = useState("")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [cninfoEventFrom, setCninfoEventFrom] = useState("")
  const [deep, setDeep] = useState(false)
  // Deep-research scope/quality knobs (only sent when --deep is on).
  const [cninfoPeriodicFrom, setCninfoPeriodicFrom] = useState("")
  const [topWiki, setTopWiki] = useState("")
  const [topRaw, setTopRaw] = useState("")
  const [graphNeighbors, setGraphNeighbors] = useState("")
  const [graphDepth, setGraphDepth] = useState("")
  const [cninfoDownloadLimit, setCninfoDownloadLimit] = useState("")
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<CompanyResearchResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<string[]>([])
  const startedAt = useRef<number>(0)

  // Mode: "company" = company-research, "deep" = deep-research (general topic)
  const [mode, setMode] = useState<"company" | "deep">("company")
  // deep-research fields
  const [topic, setTopic] = useState("")
  const [queries, setQueries] = useState("")
  const [maxResults, setMaxResults] = useState("")
  const [sourceK, setSourceK] = useState("")
  const [deepGraphDepth, setDeepGraphDepth] = useState("")
  const [deepGraphNeighbors, setDeepGraphNeighbors] = useState("")
  const [topBrain, setTopBrain] = useState("")
  const [drWrite, setDrWrite] = useState(false)
  const [drIngest, setDrIngest] = useState(false)
  const [drApplyIngest, setDrApplyIngest] = useState(false)
  const [includeInvalidated, setIncludeInvalidated] = useState(false)
  // deep-research output
  const [drResult, setDrResult] = useState<string | null>(null)
  const [drError, setDrError] = useState<string | null>(null)

  useEffect(() => {
    let unlisten: UnlistenFn | undefined
    let cancelled = false
    listen<{ action?: string; stream?: string; line?: string }>("research-cockpit-progress", (evt) => {
      if (cancelled) return
      const payload = evt.payload
      if (payload?.action !== "company-research" && payload?.action !== "deep-research") return
      if (payload.stream === "stderr" && payload.line) {
        setProgress((prev) => [...prev.slice(-40), payload.line])
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
    if (!project || !stock.trim()) return
    setRunning(true)
    setError(null)
    setResult(null)
    setProgress([])
    startedAt.current = Date.now()
    try {
      const cfg = useWikiStore.getState().llmConfig
      const args: string[] = ["--stock", stock.trim()]
      if (from.trim()) args.push("--from", from.trim())
      if (to.trim()) args.push("--to", to.trim())
      if (cninfoEventFrom.trim()) args.push("--cninfo-event-from", cninfoEventFrom.trim())
      if (deep) {
        args.push("--deep")
        if (cninfoPeriodicFrom.trim()) args.push("--cninfo-periodic-from", cninfoPeriodicFrom.trim())
        if (topWiki.trim()) args.push("--top-wiki", topWiki.trim())
        if (topRaw.trim()) args.push("--top-raw", topRaw.trim())
        if (graphNeighbors.trim()) args.push("--graph-neighbors", graphNeighbors.trim())
        if (graphDepth.trim()) args.push("--graph-depth", graphDepth.trim())
        if (cninfoDownloadLimit.trim()) args.push("--cninfo-download-limit", cninfoDownloadLimit.trim())
      }
      args.push("--api-key", cfg.apiKey ?? "")
      if (cfg.customEndpoint) args.push("--endpoint", cfg.customEndpoint)
      if (cfg.model) args.push("--model", cfg.model)

      const raw = await invoke<string>("run_research_cockpit_command", {
        projectPath: project.path,
        action: "company-research",
        args,
      })
      let parsed: CompanyResearchResult
      try {
        parsed = JSON.parse(raw) as CompanyResearchResult
      } catch {
        parsed = { mode: "company-research" }
      }
      setResult(parsed)
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally {
      setRunning(false)
    }
  }, [project, stock, from, to, cninfoEventFrom, deep])

  const runDeepResearch = useCallback(async () => {
    if (!project || !topic.trim()) return
    setRunning(true)
    setDrError(null)
    setDrResult(null)
    setProgress([])
    startedAt.current = Date.now()
    try {
      const cfg = useWikiStore.getState().llmConfig
      const args: string[] = ["--topic", topic.trim()]
      if (queries.trim()) args.push("--queries", queries.trim())
      if (maxResults.trim()) args.push("--max-results", maxResults.trim())
      if (sourceK.trim()) args.push("--source-k", sourceK.trim())
      if (deepGraphDepth.trim()) args.push("--graph-depth", deepGraphDepth.trim())
      if (deepGraphNeighbors.trim()) args.push("--graph-neighbors", deepGraphNeighbors.trim())
      if (topBrain.trim()) args.push("--top-brain", topBrain.trim())
      if (drWrite) args.push("--write")
      if (drIngest) args.push("--ingest")
      if (drApplyIngest) args.push("--apply-ingest")
      if (includeInvalidated) args.push("--include-invalidated")
      args.push("--api-key", cfg.apiKey ?? "")
      if (cfg.customEndpoint) args.push("--endpoint", cfg.customEndpoint)
      if (cfg.model) args.push("--model", cfg.model)

      const raw = await invoke<string>("run_research_cockpit_command", {
        projectPath: project.path,
        action: "deep-research",
        args,
      })
      setDrResult(raw)
    } catch (e: any) {
      setDrError(e?.message ?? String(e))
    } finally {
      setRunning(false)
    }
  }, [project, topic, queries, maxResults, sourceK, deepGraphDepth, deepGraphNeighbors, topBrain, drWrite, drIngest, drApplyIngest, includeInvalidated])

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
  const companyLabel =
    result?.company?.stockName || result?.company?.secName || result?.company?.stockCode || null

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">公司深度研究（Company Research）</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          基于 Tushare + 交易所公告（CNINFO / SSE）自动拉取公司证据，模板化生成深度研究报告，落盘到
          <code className="mx-1 rounded bg-muted px-1">.llm-wiki/company-research/</code>。
          基础报告与 <code className="mx-1 rounded bg-muted px-1">--deep</code> 报告均为数据驱动生成，无需外部 LLM。
        </p>
        {/* Mode toggle */}
        <div className="mt-3 flex items-center gap-2">
          <Button
            variant={mode === "company" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setMode("company")}
            className="text-xs gap-1 h-7"
          >
            <Building2 className="h-3.5 w-3.5" />
            公司研究
          </Button>
          <Button
            variant={mode === "deep" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setMode("deep")}
            className="text-xs gap-1 h-7"
          >
            <Globe className="h-3.5 w-3.5" />
            深度话题研究
          </Button>
        </div>
      </div>

      {mode === "company" && (
      <>

      {/* 股票代码/名称 */}
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted-foreground">股票代码 / 名称（必填）</span>
        <input
          type="text"
          value={stock}
          disabled={running}
          placeholder="如 600000 / 贵州茅台 / 300750"
          onChange={(e) => setStock(e.target.value)}
          className="rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
      </label>

      {/* 日期参数 */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">起始日 (from)</span>
          <input
            type="date"
            value={from}
            disabled={running}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">结束日 (to)</span>
          <input
            type="date"
            value={to}
            disabled={running}
            onChange={(e) => setTo(e.target.value)}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">公告起始 (cninfo-event-from)</span>
          <input
            type="date"
            value={cninfoEventFrom}
            disabled={running}
            onChange={(e) => setCninfoEventFrom(e.target.value)}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
        </label>
      </div>

      {/* 深度开关 */}
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={deep}
            disabled={running}
            onChange={(e) => setDeep(e.target.checked)}
          />
          深度研究（--deep，生成 deep-company-report 与财务模型）
        </label>
      </div>

      {/* 深度研究范围（仅在开启 --deep 时显示） */}
      {deep && (
        <div className="space-y-3 rounded-md border border-amber-200 bg-amber-50/40 p-4">
          <p className="text-sm font-medium text-amber-800">深度研究范围 / 质量参数</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">定期报告窗口 (cninfo-periodic-from)</span>
              <input
                type="date"
                value={cninfoPeriodicFrom}
                disabled={running}
                onChange={(e) => setCninfoPeriodicFrom(e.target.value)}
                className="rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
              <span className="text-xs text-muted-foreground">年报/半年报/季报来源（深度研究最关键财报证据）</span>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">公告下载上限 (cninfo-download-limit)</span>
              <input
                type="number"
                min={1}
                max={500}
                value={cninfoDownloadLimit}
                disabled={running}
                placeholder="默认 60"
                onChange={(e) => setCninfoDownloadLimit(e.target.value)}
                className="rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
              <span className="text-xs text-muted-foreground">最多拉取的公告 PDF 数量</span>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">Wiki 检索条数 (top-wiki)</span>
              <input
                type="number"
                min={1}
                max={100}
                value={topWiki}
                disabled={running}
                placeholder="默认 10"
                onChange={(e) => setTopWiki(e.target.value)}
                className="rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">Raw 检索条数 (top-raw)</span>
              <input
                type="number"
                min={1}
                max={100}
                value={topRaw}
                disabled={running}
                placeholder="默认 8"
                onChange={(e) => setTopRaw(e.target.value)}
                className="rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">图谱邻居数 (graph-neighbors)</span>
              <input
                type="number"
                min={1}
                max={500}
                value={graphNeighbors}
                disabled={running}
                placeholder="默认 20"
                onChange={(e) => setGraphNeighbors(e.target.value)}
                className="rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">图谱深度 (graph-depth)</span>
              <input
                type="number"
                min={1}
                max={6}
                value={graphDepth}
                disabled={running}
                placeholder="默认 2"
                onChange={(e) => setGraphDepth(e.target.value)}
                className="rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
            </label>
          </div>
        </div>
      )}

      {/* 运行 */}
      <div className="flex items-center gap-3">
        <Button onClick={run} disabled={running || !project || !stock.trim()}>
          <Play className="h-4 w-4" />
          {running ? `研究中… ${elapsed}s` : "运行 Company Research"}
        </Button>
        {!project && <span className="text-xs text-muted-foreground">未选择项目</span>}
        {!stock.trim() && project && (
          <span className="text-xs text-muted-foreground">请填写股票代码 / 名称</span>
        )}
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
            <span className="text-sm font-medium">研究完成</span>
            {companyLabel && (
              <span className="rounded bg-muted px-2 py-0.5 text-xs">{companyLabel}</span>
            )}
            {result.mode && <span className="rounded bg-muted px-2 py-0.5 text-xs">{result.mode}</span>}
            {result.deep && (
              <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-700">deep</span>
            )}
          </div>

          {result.writePolicy && (
            <div className="text-xs">
              <span className="font-medium">写入策略：</span>
              <span className={result.writePolicy.allowed ? "text-emerald-600" : "text-amber-600"}>
                {result.writePolicy.allowed ? "允许" : "受限"}
              </span>
              {result.writePolicy.reason && (
                <span className="ml-2 text-muted-foreground">{result.writePolicy.reason}</span>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {result.outputs?.report ? (
              <Button variant="outline" size="sm" onClick={() => openPath(result.outputs?.report)}>
                <FileText className="h-4 w-4" />
                打开报告
              </Button>
            ) : (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                无报告路径
              </span>
            )}
            {result.outputs?.deepReport && (
              <Button variant="outline" size="sm" onClick={() => openPath(result.outputs?.deepReport)}>
                <Building2 className="h-4 w-4" />
                深度报告
              </Button>
            )}
            {result.outputs?.modelXlsx && (
              <Button variant="outline" size="sm" onClick={() => openPath(result.outputs?.modelXlsx)}>
                <FileText className="h-4 w-4" />
                财务模型
              </Button>
            )}
          </div>
        </div>
      )}

      {!result && !error && !running && mode === "company" && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Clock className="h-3 w-3" />
          输入股票代码后点击运行，结果将以 JSON 展示在此处。
        </div>
      )}
      </>
      )}

      {mode === "deep" && (
      <>
        {/* Deep research mode */}
        <p className="text-sm text-muted-foreground">
          基于 Web 搜索 + wiki + 图谱 + 时序事实的多源深度研究，调用 LLM 综合分析并生成报告。
        </p>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">研究主题 (--topic) *必填</span>
          <input
            type="text"
            value={topic}
            disabled={running}
            placeholder="如 AI芯片市场趋势 或 光伏产业链竞争格局"
            onChange={(e) => setTopic(e.target.value)}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
        </label>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">搜索子查询 (--queries)</span>
            <input
              type="text"
              value={queries}
              disabled={running}
              placeholder="逗号分隔，留空自动生成"
              onChange={(e) => setQueries(e.target.value)}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">搜索结果上限 (--max-results)</span>
            <input
              type="number"
              min={1}
              max={100}
              value={maxResults}
              disabled={running}
              placeholder="默认"
              onChange={(e) => setMaxResults(e.target.value)}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">Wiki 来源数 (--source-k)</span>
            <input
              type="number"
              min={1}
              max={100}
              value={sourceK}
              disabled={running}
              placeholder="默认"
              onChange={(e) => setSourceK(e.target.value)}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">图谱深度 (--graph-depth)</span>
            <input
              type="number"
              min={1}
              max={6}
              value={deepGraphDepth}
              disabled={running}
              placeholder="默认"
              onChange={(e) => setDeepGraphDepth(e.target.value)}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">图谱邻居数 (--graph-neighbors)</span>
            <input
              type="number"
              min={1}
              max={500}
              value={deepGraphNeighbors}
              disabled={running}
              placeholder="默认"
              onChange={(e) => setDeepGraphNeighbors(e.target.value)}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">脑记忆条数 (--top-brain)</span>
            <input
              type="number"
              min={1}
              max={200}
              value={topBrain}
              disabled={running}
              placeholder="默认"
              onChange={(e) => setTopBrain(e.target.value)}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </label>
        </div>

        {/* switches */}
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={drWrite} disabled={running} onChange={(e) => setDrWrite(e.target.checked)} />
            写入 wiki 页面 (--write)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={drIngest} disabled={running} onChange={(e) => setDrIngest(e.target.checked)} />
            Ingest 到 wiki (--ingest)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={drApplyIngest} disabled={running} onChange={(e) => setDrApplyIngest(e.target.checked)} />
            自动落地 (--apply-ingest)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={includeInvalidated} disabled={running} onChange={(e) => setIncludeInvalidated(e.target.checked)} />
            包含已失效 (--include-invalidated)
          </label>
        </div>

        {/* run button */}
        <div className="flex items-center gap-3">
          <Button onClick={runDeepResearch} disabled={running || !project || !topic.trim()}>
            <Play className="h-4 w-4" />
            {running ? `运行中… ${elapsed}s` : "运行 Deep Research"}
          </Button>
          {!project && <span className="text-xs text-muted-foreground">未选择项目</span>}
        </div>

        {/* progress */}
        {running && progress.length > 0 && (
          <div className="max-h-40 overflow-auto rounded-md border border-border bg-muted/40 p-3 text-xs">
            {progress.map((line, i) => (
              <div key={i} className="whitespace-pre-wrap text-muted-foreground">{line}</div>
            ))}
          </div>
        )}

        {/* dr error */}
        {drError && (
          <div className="flex items-start gap-2 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{drError}</span>
          </div>
        )}

        {/* dr result */}
        {drResult && !drError && (
          <div className="space-y-3 rounded-md border border-border p-4">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              <span className="text-sm font-medium">Deep Research 完成</span>
            </div>
            <pre className="max-h-80 overflow-auto rounded-md bg-muted/50 p-3 text-xs leading-relaxed">
              {drResult.length > 5000 ? drResult.slice(0, 5000) + "\n… (truncated)" : drResult}
            </pre>
          </div>
        )}

        {!drResult && !drError && !running && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            输入研究主题后点击运行，需 LLM + Tavily API 可用。
          </div>
        )}
      </>
      )}
    </div>
  )
}
