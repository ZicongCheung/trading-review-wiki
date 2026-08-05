import { useCallback, useEffect, useRef, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import { useWikiStore } from "@/stores/wiki-store"
import { Button } from "@/components/ui/button"
import { Play, FileText, AlertTriangle, CheckCircle2, Clock, Wrench } from "lucide-react"

type DeTask =
  | "prepare"
  | "convert-source"
  | "embeddings"
  | "api-run"
  | "finalize"
  | "apply"
  | "batch-run"
  | "sag-sync"
  | "hygiene"

interface DeResult {
  [key: string]: unknown
}

const TASK_LABELS: Record<DeTask, string> = {
  "prepare": "prepare — 预处理（生成 ingest context）",
  "convert-source": "convert-source — 源文件转 Markdown sidecar",
  "embeddings": "embeddings — 向量化 wiki 索引",
  "api-run": "api-run — LLM 分步提取 ingest artifacts",
  "finalize": "finalize — 收尾合并 staged artifacts",
  "apply": "apply — 落地 manifest 到 wiki",
  "batch-run": "batch-run — 批量 ingest 预研报",
  "sag-sync": "sag-sync — SAG 同步",
  "hygiene": "hygiene — 清理过期 artifacts",
}

export function DataEngineeringPanel() {
  const project = useWikiStore((s) => s.project)
  const [task, setTask] = useState<DeTask>("prepare")
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<DeResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<string[]>([])
  const startedAt = useRef<number>(0)

  // ---- task-specific form state ----
  // prepare / convert-source / api-run
  const [source, setSource] = useState("")
  const [schema, setSchema] = useState("")
  const [output, setOutput] = useState("")
  // finalize / apply / batch-run
  const [report, setReport] = useState("")
  const [manifest, setManifest] = useState("")
  const [sources, setSources] = useState("")
  // embeddings
  const [embSub, setEmbSub] = useState("status")
  // sag-sync
  const [sagSub, setSagSub] = useState("status")
  const [sagApiBase, setSagApiBase] = useState("")
  const [sagProjectName, setSagProjectName] = useState("")
  const [sagPath, setSagPath] = useState("")
  // hygiene
  const [hygieneSub, setHygieneSub] = useState("audit")
  // shared
  const [write, setWrite] = useState(false)
  const [overwrite, setOverwrite] = useState(false)
  const [noOcr, setNoOcr] = useState(false)
  const [keepDays, setKeepDays] = useState("30")
  const [judgments, setJudgments] = useState(false)
  const [pageConcurrency, setPageConcurrency] = useState("")
  const [apiConcurrency, setApiConcurrency] = useState("")
  const [sourceSharding, setSourceSharding] = useState("")
  const [limit, setLimit] = useState("")

  // ---- progress listener ----
  useEffect(() => {
    let unlisten: UnlistenFn | undefined
    let cancelled = false
    listen<{ action?: string; stream?: string; line?: string }>("research-cockpit-progress", (evt) => {
      if (cancelled) return
      const payload = evt.payload
      if (payload?.action !== "data-engineering") return
      if (payload.stream === "stderr" && payload.line) {
        setProgress((prev) => [...prev.slice(-80), payload.line])
      }
    })
      .then((fn) => { unlisten = fn })
      .catch(() => {})
    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [])

  // ---- build args ----
  const buildArgs = useCallback((): string[] => {
    const a: string[] = ["--task", task]
    switch (task) {
      case "prepare":
        if (source) a.push("--source", source)
        if (schema) a.push("--schema", schema)
        // no-report not exposed in basic form, skip
        break
      case "convert-source":
        if (source) a.push("--source", source)
        if (output) a.push("--output", output)
        if (overwrite) a.push("--overwrite")
        if (noOcr) a.push("--no-ocr")
        break
      case "embeddings":
        a.push(embSub)
        break
      case "api-run":
        if (source) a.push("--source", source)
        if (schema) a.push("--schema", schema)
        if (pageConcurrency) a.push("--page-concurrency", pageConcurrency)
        if (sourceSharding) a.push("--source-sharding", sourceSharding)
        if (judgments) a.push("--judgments")
        break
      case "finalize":
        if (report) a.push("--report", report)
        break
      case "apply":
        if (manifest) a.push("--manifest", manifest)
        if (write) a.push("--write")
        break
      case "batch-run":
        if (sources) a.push("--sources", sources)
        if (schema) a.push("--schema", schema)
        if (apiConcurrency) a.push("--api-concurrency", apiConcurrency)
        if (pageConcurrency) a.push("--page-concurrency", pageConcurrency)
        if (sourceSharding) a.push("--source-sharding", sourceSharding)
        if (judgments) a.push("--judgments")
        if (write) a.push("--write")
        break
      case "sag-sync":
        a.push(sagSub)
        if (sagApiBase) a.push("--sag-api-base", sagApiBase)
        if (sagProjectName) a.push("--sag-project-name", sagProjectName)
        if (sagSub === "report" && report) a.push("--report", report)
        if (sagSub === "file" && sagPath) a.push("--path", sagPath)
        if (limit) a.push("--limit", limit)
        break
      case "hygiene":
        a.push(hygieneSub)
        if (keepDays && keepDays !== "30") a.push("--keep-days", keepDays)
        if (write) a.push("--write")
        break
    }
    return a
  }, [
    task, source, schema, output, report, manifest, sources,
    embSub, sagSub, sagApiBase, sagProjectName, sagPath,
    hygieneSub, write, overwrite, noOcr, keepDays, judgments,
    pageConcurrency, apiConcurrency, sourceSharding, limit,
  ])

  // ---- run ----
  const run = useCallback(async () => {
    if (!project) return
    setRunning(true)
    setError(null)
    setResult(null)
    setProgress([])
    startedAt.current = Date.now()
    try {
      const args = buildArgs()
      const raw = await invoke<string>("run_research_cockpit_command", {
        projectPath: project.path,
        action: "data-engineering",
        args,
      })
      try {
        setResult(JSON.parse(raw) as DeResult)
      } catch {
        setResult({ raw })
      }
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally {
      setRunning(false)
    }
  }, [project, buildArgs])

  const elapsed = running && startedAt.current ? Math.round((Date.now() - startedAt.current) / 1000) : 0

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <Wrench className="h-5 w-5" />
          数据工程台
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          预处理、源转换、向量化、LLM 提取、落地、批量、SAG 同步、清理 —— 9 个子命令一站式入口。
        </p>
      </div>

      {/* 任务选择 */}
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted-foreground">子命令 (--task)</span>
        <select
          value={task}
          disabled={running}
          onChange={(e) => setTask(e.target.value as DeTask)}
          className="rounded-md border border-border bg-background px-3 py-2 text-sm"
        >
          {Object.entries(TASK_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </label>

      {/* Task-specific form fields */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* prepare / convert-source / api-run */}
        {(task === "prepare" || task === "convert-source" || task === "api-run") && (
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="text-muted-foreground">源文件路径 (--source){task !== "prepare" ? "" : " *必填"}</span>
            <input
              type="text"
              value={source}
              disabled={running}
              onChange={(e) => setSource(e.target.value)}
              placeholder="/path/to/source.pdf 或 .md"
              className="rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </label>
        )}

        {/* schema (prepare / api-run / batch-run) */}
        {(task === "prepare" || task === "api-run" || task === "batch-run") && (
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">Schema 路径 (--schema)</span>
            <input
              type="text"
              value={schema}
              disabled={running}
              onChange={(e) => setSchema(e.target.value)}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </label>
        )}

        {/* output (convert-source) */}
        {task === "convert-source" && (
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">输出路径 (--output)</span>
            <input
              type="text"
              value={output}
              disabled={running}
              onChange={(e) => setOutput(e.target.value)}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </label>
        )}

        {/* report (finalize / sag-sync report) */}
        {task === "finalize" && (
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="text-muted-foreground">报告目录 (--report) *必填</span>
            <input
              type="text"
              value={report}
              disabled={running}
              onChange={(e) => setReport(e.target.value)}
              placeholder="/path/to/report-dir"
              className="rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </label>
        )}
        {task === "sag-sync" && sagSub === "report" && (
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="text-muted-foreground">报告路径 (--report)</span>
            <input
              type="text"
              value={report}
              disabled={running}
              onChange={(e) => setReport(e.target.value)}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </label>
        )}

        {/* manifest (apply) */}
        {task === "apply" && (
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="text-muted-foreground">Manifest 路径 (--manifest) *必填</span>
            <input
              type="text"
              value={manifest}
              disabled={running}
              onChange={(e) => setManifest(e.target.value)}
              placeholder="/path/to/manifest.json"
              className="rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </label>
        )}

        {/* sources (batch-run) */}
        {task === "batch-run" && (
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="text-muted-foreground">源目录 (--sources) *必填</span>
            <input
              type="text"
              value={sources}
              disabled={running}
              onChange={(e) => setSources(e.target.value)}
              placeholder="/path/to/sources/"
              className="rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </label>
        )}

        {/* embeddings subcommand */}
        {task === "embeddings" && (
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">子命令</span>
            <select
              value={embSub}
              disabled={running}
              onChange={(e) => setEmbSub(e.target.value)}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm"
            >
              <option value="status">status — 查看索引状态</option>
              <option value="build">build — 构建/重建向量索引</option>
            </select>
          </label>
        )}

        {/* sag-sync subcommand */}
        {task === "sag-sync" && (
          <>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">子命令</span>
              <select
                value={sagSub}
                disabled={running}
                onChange={(e) => setSagSub(e.target.value)}
                className="rounded-md border border-border bg-background px-3 py-2 text-sm"
              >
                <option value="status">status</option>
                <option value="report">report</option>
                <option value="scan-reports">scan-reports</option>
                <option value="file">file</option>
                <option value="scan-wiki">scan-wiki</option>
                <option value="pending">pending</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">SAG API Base (--sag-api-base)</span>
              <input
                type="text"
                value={sagApiBase}
                disabled={running}
                onChange={(e) => setSagApiBase(e.target.value)}
                className="rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">SAG Project Name (--sag-project-name)</span>
              <input
                type="text"
                value={sagProjectName}
                disabled={running}
                onChange={(e) => setSagProjectName(e.target.value)}
                className="rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
            </label>
            {sagSub === "file" && (
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">文件路径 (--path)</span>
                <input
                  type="text"
                  value={sagPath}
                  disabled={running}
                  onChange={(e) => setSagPath(e.target.value)}
                  className="rounded-md border border-border bg-background px-3 py-2 text-sm"
                />
              </label>
            )}
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">数量上限 (--limit)</span>
              <input
                type="number"
                value={limit}
                disabled={running}
                onChange={(e) => setLimit(e.target.value)}
                className="rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
            </label>
          </>
        )}

        {/* hygiene subcommand */}
        {task === "hygiene" && (
          <>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">操作</span>
              <select
                value={hygieneSub}
                disabled={running}
                onChange={(e) => setHygieneSub(e.target.value)}
                className="rounded-md border border-border bg-background px-3 py-2 text-sm"
              >
                <option value="audit">audit — 审计扫描</option>
                <option value="clean">clean — 清理过期文件</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">保留天数 (--keep-days)</span>
              <input
                type="number"
                value={keepDays}
                disabled={running}
                onChange={(e) => setKeepDays(e.target.value)}
                className="rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
            </label>
          </>
        )}

        {/* concurrency / sharding (api-run / batch-run) */}
        {(task === "api-run" || task === "batch-run") && (
          <>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">页并发 (--page-concurrency)</span>
              <input
                type="number"
                value={pageConcurrency}
                disabled={running}
                onChange={(e) => setPageConcurrency(e.target.value)}
                className="rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
            </label>
            {task === "batch-run" && (
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">API 并发 (--api-concurrency)</span>
                <input
                  type="number"
                  value={apiConcurrency}
                  disabled={running}
                  onChange={(e) => setApiConcurrency(e.target.value)}
                  className="rounded-md border border-border bg-background px-3 py-2 text-sm"
                />
              </label>
            )}
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">源分片 (--source-sharding)</span>
              <input
                type="text"
                value={sourceSharding}
                disabled={running}
                onChange={(e) => setSourceSharding(e.target.value)}
                placeholder="如 auto"
                className="rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
            </label>
          </>
        )}
      </div>

      {/* switches */}
      <div className="flex flex-wrap gap-4">
        {(task === "apply" || task === "hygiene" || task === "batch-run") && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={write} disabled={running} onChange={(e) => setWrite(e.target.checked)} />
            落盘写入 (--write)
          </label>
        )}
        {task === "convert-source" && (
          <>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={overwrite} disabled={running} onChange={(e) => setOverwrite(e.target.checked)} />
              覆盖已有 (--overwrite)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={noOcr} disabled={running} onChange={(e) => setNoOcr(e.target.checked)} />
              禁用 OCR (--no-ocr)
            </label>
          </>
        )}
        {(task === "api-run" || task === "batch-run") && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={judgments} disabled={running} onChange={(e) => setJudgments(e.target.checked)} />
            启用判定 (--judgments)
          </label>
        )}
      </div>

      {/* run button */}
      <div className="flex items-center gap-3">
        <Button onClick={run} disabled={running || !project}>
          <Play className="h-4 w-4" />
          {running ? `运行中… ${elapsed}s` : `运行 ${task}`}
        </Button>
        {!project && <span className="text-xs text-muted-foreground">未选择项目</span>}
      </div>

      {/* progress */}
      {running && progress.length > 0 && (
        <div className="max-h-48 overflow-auto rounded-md border border-border bg-muted/40 p-3 text-xs">
          {progress.map((line, i) => (
            <div key={i} className="whitespace-pre-wrap text-muted-foreground">{line}</div>
          ))}
        </div>
      )}

      {/* error */}
      {error && (
        <div className="flex items-start gap-2 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* result */}
      {result && !error && (
        <div className="space-y-3 rounded-md border border-border p-4">
          <div className="flex flex-wrap items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <span className="text-sm font-medium">执行完成</span>
            <span className="rounded bg-muted px-2 py-0.5 text-xs">{task}</span>
          </div>
          <pre className="max-h-96 overflow-auto rounded-md bg-muted/50 p-3 text-xs leading-relaxed">
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}

      {!result && !error && !running && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Clock className="h-3 w-3" />
          选择子命令并填写必要参数后点击运行，结果将展示在此处。
        </div>
      )}
    </div>
  )
}
