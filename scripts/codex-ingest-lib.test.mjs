import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { parseArgs, requireArg } from "./codex-ingest/cli/args.mjs"
import { COMMAND_HANDLERS } from "./codex-ingest/cli/index.mjs"
import { resolveCliPerformanceProfile } from "./codex-ingest/cli/performance.mjs"
import {
  checkRecursiveAiPhase5Readiness as checkRecursiveAiPhase5ReadinessFromBrainApi,
  getRecursiveAiPhaseStatus as getRecursiveAiPhaseStatusFromBrainApi,
  runRecursiveAiPhaseAdvance as runRecursiveAiPhaseAdvanceFromBrainApi,
  runRecursiveAiPhaseRun as runRecursiveAiPhaseRunFromBrainApi,
} from "./codex-ingest/brain/index.mjs"
import {
  METHODOLOGY_CONTEXT_PATHS,
  METHODOLOGY_CONTEXT_TOTAL_CHAR_SOFT_LIMIT,
  METHODOLOGY_PAGE_CHAR_SOFT_LIMIT,
  AGENT_RUNS_ROOT,
  PAGE_BODY_LINE_SOFT_LIMIT,
  RETRIEVAL_MODES,
  TEMPORAL_FACT_INDEX_RELATIVE_PATH,
  TEMPORAL_FACTS_RELATIVE_PATH,
  askWiki,
  apiRunIngest,
  applyManifest,
  buildMethodologyContext,
  buildAskRetrievalContext,
  buildQccOpenApiToken,
  buildCodexExecInvocation,
  buildStockDailySqlQuery,
  compactSourceContentForPrompt,
  collectManifestTargetHashes,
  checkManifestTargetConflicts,
  classifyIngestPath,
  convertSourceWithMarkitdown,
  defaultConvertedSourcePath,
  exportTrainingSamples,
  checkRecursiveAiPhase5Readiness,
  appendAutoresearchExperiment,
  buildHypothesisReport,
  buildHypothesisDashboardData,
  createAutoresearchProgram,
  createHypothesis,
  createObservationDraft,
  discoverHypotheses,
  draftHypothesisSupplement,
  runDeepResearch,
  appendWechatIncrementMessages,
  importWechatRawChatMessages,
  listWechatRawChatSources,
  submitHypothesisSupplement,
  getWechatIncrementInboxStatus,
  getAutoresearchReadiness,
  listHypothesisAlerts,
  listHypotheses,
  listObservationDrafts,
  listAutoresearchExperiments,
  processWechatIncrementInbox,
  proposeAutoresearchPolicyChanges,
  qualityCheckHypotheses,
  scoreAutoresearchExperiment,
  runHypothesisWatch,
  startWechatIncrementServer,
  updateHypothesisFromArticle,
  updateHypothesisStatus,
  validateHypothesis,
  getRecursiveAiPhaseStatus,
  listSelfTrainingActions,
  listTrainingSampleExports,
  verifyTrainingSampleExports,
  extractSourceTokens,
  getBrainStatus,
  marketValidatePrediction,
  normalizeIngestPlan,
  parseStockDailyIntent,
  parseWechatUpdateWindows,
  parseFileBlocks,
  prepareIngest,
  rememberBrainMemory,
  resolveBrainMemory,
  runBatchIngest,
  runAskEval,
  runCompanyResearch,
  runDailyLoop,
  runDataSource,
  runConceptGovernanceAudit,
  runHygiene,
  runSelfTraining,
  runSelfQuestion,
  runRecursiveAiPhaseAdvance,
  runRecursiveAiPhaseRun,
  runSelfQuestionLoop,
  proposeSelfQuestionPolicies,
  executeSelfQuestionPolicyRegressions,
  exportSelfQuestionPolicyRegressions,
  evaluateSelfQuestionPolicyRegressions,
  reviewSelfQuestionPolicyProposal,
  listActiveSelfQuestionPolicies,
  collectSelfQuestionEvidenceTasks,
  listSelfTrainingPlans,
  planSelfTrainingActions,
  verifySelfTrainingPlans,
  recordSelfQuestionEvidenceResult,
  collectSelfQuestionPolicyRegressionFeedback,
  proposeSelfQuestionPolicyRegressionRemediations,
  exportSelfQuestionPolicyRegressionPatchCandidates,
  applySelfQuestionPolicyRegressionPatchCandidate,
  reviewSelfQuestionPolicyRegressionRemediation,
  reviewSelfTrainingAction,
  safeErrorMessage,
  attributeSelfQuestionValidations,
  validateSelfQuestions,
  runTemporalFactsAudit,
  searchCandidatePages,
  selectAskSources,
  tokenizeQuery,
  validateWikiContent,
  extractWechatMainlineIndex,
  buildStockFeedbackBenchmark,
  buildStockFeedbackTrajectories,
  exportStockFeedbackLoraReady,
  getStockFeedbackPaperTradeStatus,
  getStockFeedbackStatus,
  listStockFeedbackReviewQueue,
  listStockFeedbackTrajectories,
  planStockFeedbackCollectionTask,
  recordStockFeedbackPaperTrade,
  recordStockFeedbackCollectionResult,
  reviewStockFeedbackTrajectory,
  verifyStockFeedbackArtifacts,
  isSagSyncableWikiPath,
  retryPendingSagSync,
  sagSyncStatus,
  syncablePathsFromApplyReport,
  syncApplyReportToSag,
  syncWikiFileToSag,
  syncWikiTreeToSag,
} from "./codex-ingest-lib.mjs"

let tmpRoot

async function write(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, content, "utf8")
}

async function read(filePath) {
  return fs.readFile(filePath, "utf8")
}

async function writeExecutable(filePath, content) {
  await write(filePath, content)
  await fs.chmod(filePath, 0o755)
}

async function readJsonl(filePath) {
  const raw = await fs.readFile(filePath, "utf8").catch(() => "")
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function makeFakeSagFetch({ failPaths = new Set() } = {}) {
  const state = {
    projects: [],
    documents: [],
    requests: [],
    nextProject: 1,
    nextDocument: 1,
  }
  const fetchImpl = async (url, init = {}) => {
    const parsed = new URL(url)
    const method = init.method ?? "GET"
    const body = init.body ? JSON.parse(init.body) : null
    state.requests.push({ method, pathname: parsed.pathname, body })

    if (method === "GET" && parsed.pathname === "/api/projects") {
      return jsonResponse({ projects: state.projects })
    }
    if (method === "POST" && parsed.pathname === "/api/projects") {
      const projectId = `11111111-1111-4111-8111-${String(state.nextProject++).padStart(12, "0")}`
      const project = {
        id: projectId,
        name: body.name,
        description: body.description ?? null,
        metadata: {},
        archivedAt: null,
      }
      state.projects.push(project)
      return jsonResponse({ project }, 201)
    }
    const projectDocumentsMatch = parsed.pathname.match(/^\/api\/projects\/([^/]+)\/documents$/)
    if (method === "GET" && projectDocumentsMatch) {
      return jsonResponse({ documents: state.documents.filter((item) => item.sourceId === projectDocumentsMatch[1]) })
    }
    const archiveMatch = parsed.pathname.match(/^\/api\/documents\/(.+)\/archive$/)
    if (method === "POST" && archiveMatch) {
      const doc = state.documents.find((item) => item.id === archiveMatch[1])
      if (doc) doc.archivedAt = new Date().toISOString()
      return jsonResponse({ document: doc })
    }
    if (method === "POST" && parsed.pathname === "/ingest") {
      if (failPaths.has(body.metadata?.wikiPath)) {
        return jsonResponse({ error: { message: "SAG unavailable token=secret" } }, 503)
      }
      const document = {
        id: `doc-${state.nextDocument++}`,
        sourceId: body.sourceId,
        title: body.title,
        status: "READY",
        parseStatus: "READY",
        metadata: body.metadata ?? {},
        archivedAt: null,
      }
      state.documents.push(document)
      return jsonResponse({
        sourceId: body.sourceId,
        documentId: document.id,
        chunkCount: 1,
        eventCount: body.extract === false ? 0 : 1,
        taskId: "task-1",
        traceId: "trace-1",
      }, 201)
    }
    return jsonResponse({ error: { message: `Unhandled ${method} ${parsed.pathname}` } }, 404)
  }
  return { fetchImpl, state }
}

function validFrontmatter(title, type = "概念", extra = "") {
  return `---
schema_version: 1
title: ${title}
aliases: []
type: ${type}
summary: 这是一个用于测试的页面摘要，长度足够覆盖检索召回和 schema 校验要求，不直接复用正文内容。
tags:
  - 测试
related: []
sources: []
created: 2026-05-11 14:23:07
updated: 2026-05-11 14:23:07
last_reviewed: 2026-05-11 14:23:07
confidence: 中
status: 活跃
${extra}---
`
}

function timestampDaysAgo(days) {
  const date = new Date(Date.now() - days * 86400000)
  const pad = (value) => String(value).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

async function makeProject() {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), "codex-ingest-"))
  await write(path.join(project, "schema.md"), "# schema\n\n使用 [[目录/页面名]] 链接。")
  await write(path.join(project, "purpose.md"), "# purpose\n\n交易复盘。")
  await write(
    path.join(project, "wiki/index.md"),
    `${validFrontmatter("index", "总结")}# index\n\n- [[概念/算电协同]] — 算力与电力联动`,
  )
  await write(path.join(project, "wiki/overview.md"), `${validFrontmatter("overview", "总结")}# overview\n`)
  await write(path.join(project, "wiki/log.md"), "# log\n")
  await write(
    path.join(project, "wiki/概念/算电协同.md"),
    `---
schema_version: 1
title: 算电协同
aliases:
  - AI服务器电源
type: 概念
summary: 这是一个用于测试的算电协同页面摘要，覆盖 AI 服务器电源、电力容量和算力扩张之间的联动关系。
tags:
  - AI电源
  - 算力
related:
  - "[[概念/电力运营商重估]]"
sources: []
created: 2026-05-11 14:23:07
updated: 2026-05-11 14:23:07
last_reviewed: 2026-05-11 14:23:07
confidence: 中
status: 活跃
---

# 算电协同

AI 服务器电源需求、数据中心供电和电力运营商重估共同构成观察框架。
`,
  )
  await write(
    path.join(project, "wiki/概念/电力运营商重估.md"),
    `${validFrontmatter("电力运营商重估")}# 电力运营商重估\n\n负荷增长带来估值变化。\n`,
  )
  await write(
    path.join(project, "raw/研报新闻/2026-05-28-AI服务器电源.md"),
    "# AI服务器电源涨价\n\n本轮 AI 服务器电源和数据中心供电瓶颈强化了算电协同逻辑。",
  )
  await write(
    path.join(project, "data/facts/cases.jsonl"),
    `${JSON.stringify({ id: "case-1", title: "高开接盘案例", error: "高开接盘", lesson: "高开无承接时不要追涨" })}\n`,
  )
  await write(
    path.join(project, ".llm-wiki/stock-codes.json"),
    `${JSON.stringify({ synced_at: "2026-05-30 13:38:51", count: 2, mapping: { 利通电子: "SH603629", 三孚新科: "SH688359" } }, null, 2)}\n`,
  )
  return project
}

beforeEach(async () => {
  tmpRoot = await makeProject()
})

afterEach(async () => {
  if (tmpRoot) await fs.rm(tmpRoot, { recursive: true, force: true })
})

describe("codex ingest convert-source", () => {
  async function makeMarkitdownStub(markdown) {
    const stub = path.join(tmpRoot, "markitdown-stub.mjs")
    await writeExecutable(
      stub,
      `#!/usr/bin/env node\nconst source = process.argv[2]\nprocess.stdout.write(${JSON.stringify(markdown)}.replace(/__SOURCE__/g, source))\n`,
    )
    return stub
  }

  it("writes a MarkItDown sidecar next to the source with trace metadata", async () => {
    const source = path.join(tmpRoot, "raw/研报新闻/AI服务器电源.pdf")
    await write(source, "%PDF fake content")
    const stub = await makeMarkitdownStub("# Converted\n\n- __SOURCE__\n- AI服务器电源价值量")

    const result = await convertSourceWithMarkitdown({
      projectPath: tmpRoot,
      sourcePath: source,
      markitdownBin: stub,
    })

    expect(result.outputPath).toBe(defaultConvertedSourcePath(source))
    expect(result.outputRelativePath).toBe("raw/研报新闻/AI服务器电源.markitdown.md")
    expect(result.sourceRelativePath).toBe("raw/研报新闻/AI服务器电源.pdf")
    const sidecar = await read(result.outputPath)
    expect(sidecar).toContain('converted_schema: "markitdown-sidecar-v1"')
    expect(sidecar).toContain("source_sha256:")
    expect(sidecar).toContain('source_basename: "AI服务器电源.pdf"')
    expect(sidecar).toContain("# AI服务器电源")
    expect(sidecar).toContain("AI服务器电源价值量")
  })

  it("falls back to OCR when MarkItDown returns empty Markdown for a PDF", async () => {
    const source = path.join(tmpRoot, "raw/研报新闻/AI+PCB报告.pdf")
    await write(source, "%PDF image-only fake content")
    const stub = await makeMarkitdownStub("")

    const result = await convertSourceWithMarkitdown({
      projectPath: tmpRoot,
      sourcePath: source,
      markitdownBin: stub,
      ocrRunner: async () => ({
        content: "## Page 1\n\nRubin NVL144 PCB 价值 M9 Q-Glass 沪电 胜宏 生益",
        converter: "test OCR",
        conversionNote: "test OCR fallback used",
        pages: 1,
        pageCharCounts: [41],
      }),
    })

    expect(result.ocrPages).toBe(1)
    expect(result.ocrPageCharCounts).toEqual([41])
    expect(result.conversionNote).toBe("test OCR fallback used")
    const sidecar = await read(result.outputPath)
    expect(sidecar).toContain("conversion_note:")
    expect(sidecar).toContain("test OCR")
    expect(sidecar).toContain("Rubin NVL144 PCB 价值")
  })

  it("keeps empty PDF conversion as an error when OCR fallback is disabled", async () => {
    const source = path.join(tmpRoot, "raw/研报新闻/empty.pdf")
    await write(source, "%PDF image-only fake content")
    const stub = await makeMarkitdownStub("")

    await expect(
      convertSourceWithMarkitdown({
        sourcePath: source,
        markitdownBin: stub,
        ocrFallback: false,
      }),
    ).rejects.toThrow(/produced empty Markdown/)
  })

  it("refuses to overwrite an existing sidecar unless overwrite is set", async () => {
    const source = path.join(tmpRoot, "raw/研报新闻/report.docx")
    await write(source, "docx bytes")
    const stub = await makeMarkitdownStub("first conversion")

    const first = await convertSourceWithMarkitdown({ sourcePath: source, markitdownBin: stub })
    await expect(convertSourceWithMarkitdown({ sourcePath: source, markitdownBin: stub })).rejects.toThrow(
      /already exists/,
    )

    await convertSourceWithMarkitdown({ sourcePath: source, markitdownBin: stub, overwrite: true })
    expect(await read(first.outputPath)).toContain("first conversion")
  })

  it("reports a focused install hint when the MarkItDown binary is missing", async () => {
    const source = path.join(tmpRoot, "raw/研报新闻/report.pptx")
    await write(source, "pptx bytes")

    await expect(
      convertSourceWithMarkitdown({
        sourcePath: source,
        markitdownBin: path.join(tmpRoot, "missing-markitdown"),
      }),
    ).rejects.toThrow(/pip install 'markitdown\[pdf,docx,pptx,xlsx\]'/)
  })

  it("points binary prepare calls to convert-source first", async () => {
    const source = path.join(tmpRoot, "raw/研报新闻/report.pdf")
    await write(source, "%PDF fake content")

    await expect(prepareIngest({ projectPath: tmpRoot, sourcePath: source })).rejects.toThrow(/convert-source/)
  })
})

describe("codex ingest prepare", () => {
  it("compacts gangtise meeting clues while preserving late records", () => {
    const records = Array.from({ length: 140 }, (_, i) => {
      const n = i + 1
      return [
        `### ${n}. 记录 ${60000 + n}`,
        "",
        `- 发布时间: 2026-06-01 21:${String(n % 60).padStart(2, "0")}:00（北京时间）`,
        `- 记录 ID: ${60000 + n}`,
        `- 主题/标的: 主题${n}, ${n === 140 ? "尾部AI液冷" : "普通线索"}`,
        "- detail_topic: 无",
        "",
        "#### content",
        "",
        `<p><strong>核心：</strong>${"长正文".repeat(120)}${n === 140 ? " 尾部CDU冷板价值量验证" : ""}</p>`,
      ].join("\n")
    })
    const source = [
      "---",
      "source: cn_alternative_db.public.gangtise_meeting_clues",
      "record_count: 140",
      "---",
      "",
      "# 2026-06-01 投研线索汇总",
      "",
      "## 今日概览",
      "",
      "- 记录数: 140",
      "",
      "## 主题索引",
      "",
      "- AI",
      "",
      "## 明细",
      "",
      ...records,
    ].join("\n")
    const compacted = compactSourceContentForPrompt(source, "/tmp/meeting-clues.md", "hash", 20000)
    expect(compacted.length).toBeLessThanOrEqual(20080)
    expect(compacted).toContain("保留记录数：140")
    expect(compacted).toContain("### 140. 记录 60140")
    expect(compacted).toContain("尾部AI液冷")
    expect(compacted).toContain("尾部CDU冷板价值量验证")
  })

  it("parses time-only WeChat update windows and mainline index rows", () => {
    const source = [
      "# 2026-06-12 微信股票群聊舆情摘要",
      "",
      "## 00:40:00 舆情更新",
      "",
      "### 主线归因",
      "",
      "主线｜热度｜命中群｜原文数",
      "- 江丰电子（靶材涨价+对日替代+海力士扩产）| ★★★★★ | 2026资讯(1) | 1",
      "- AI燃气轮机/数据中心需求旺盛 | ★★★ | 2026资讯(1) | 8+重复",
      "",
      "### 完整调研原文",
      "```",
      "江丰电子强call",
      "```",
      "",
      "## 2026-06-12 03:55:00 舆情更新",
      "",
      "### 主线归因",
      "",
      "主线｜热度｜命中群｜原文数",
      "- SpaceX IPO定价$135/股 | ★★★★ | 周期有道(2) | 3",
    ].join("\n")

    const windows = parseWechatUpdateWindows(source)
    expect(windows.windows.map((item) => item.windowTime)).toEqual(["00:40:00", "2026-06-12 03:55:00"])
    const index = extractWechatMainlineIndex(source, "/tmp/2026-06-12.md", "raw/微信聊天/2026-06-12.md")
    expect(index.counts).toEqual({ windows: 2, mainlines: 3 })
    expect(index.items[0]).toMatchObject({
      windowTime: "00:40:00",
      label: "江丰电子（靶材涨价+对日替代+海力士扩产）",
      heat: "★★★★★",
      groups: "2026资讯(1)",
      sourceCount: "1",
      lineStart: 8,
    })
    expect(index.items[2].label).toBe("SpaceX IPO定价$135/股")
  })

  it("indexes numbered WeChat focus board rows", () => {
    const source = [
      "## 01:00:00 舆情更新",
      "",
      "### 【重点板块/标的】",
      "",
      "1. **SpaceX IPO后续/商业航天承压｜热度：中｜命中群：2026资讯、学霸圈🔥｜原文数：3**",
      "   - 发酵/异动：SpaceX 上市后续继续发酵。",
      "",
      "2. **美伊协议/原油油运/霍尔木兹风险｜热度：高｜命中群：2026资讯｜原文数：22**",
      "   - 待验证：协议文本是否公开。",
      "",
      "### 【完整调研原文】",
      "",
      "## 02:00:00 舆情更新",
      "",
      "### 【重点板块/标的】",
      "",
      "1. **长鑫/存储上市映射｜热度：中低｜命中群：周期有道｜原文数：4**",
    ].join("\n")

    const index = extractWechatMainlineIndex(source, "/tmp/2026-06-13.md", "raw/微信聊天/2026-06-13.md")
    expect(index.counts).toEqual({ windows: 2, mainlines: 3 })
    expect(index.items[0]).toMatchObject({
      windowTime: "01:00:00",
      label: "SpaceX IPO后续/商业航天承压",
      heat: "中",
      groups: "2026资讯、学霸圈🔥",
      sourceCount: "3",
      lineStart: 5,
    })
    expect(index.items[2].label).toBe("长鑫/存储上市映射")
  })

  it("indexes numbered WeChat focus rows with keyed fullwidth separators", () => {
    const source = [
      "## 23:00:00 舆情更新",
      "",
      "### 重点板块/标的",
      "",
      "1. 主线｜AI算力上游材料/载板/高速CCL通胀链；热度｜高；命中群｜2026资讯、财闻京华；原文数｜18；发酵/异动：材料缺货和Q2业绩确定性外溢。",
      "",
      "2. 主线｜InP/EML/光芯片衬底国产替代；热度｜中高；命中群｜财闻京华；原文数｜5；发酵/异动：InP 衬底供需缺口继续发酵。",
    ].join("\n")

    const index = extractWechatMainlineIndex(source, "/tmp/2026-06-14.md", "raw/微信聊天/2026-06-14.md")
    expect(index.counts).toEqual({ windows: 1, mainlines: 2 })
    expect(index.items[0]).toMatchObject({
      windowTime: "23:00:00",
      label: "AI算力上游材料/载板/高速CCL通胀链",
      heat: "高",
      groups: "2026资讯、财闻京华",
      sourceCount: "18",
      lineStart: 5,
    })
    expect(index.items[1].label).toBe("InP/EML/光芯片衬底国产替代")
  })

  it("indexes multiline numbered WeChat focus rows with spaced section title", () => {
    const source = [
      "## 23:00:00 舆情更新",
      "",
      "### 重点板块 / 标的",
      "",
      "1. 主线｜MPO / 无源光互联 / CPO-NPO 连接器",
      "   热度｜高",
      "   命中群｜周期有道、2026，5月🇨🇳崛起",
      "   原文数｜5",
      "   发酵/异动｜MPO 是无源光互联强通胀环节。",
      "",
      "2. 主线｜HVLP4 高端铜箔 / AI 服务器铜互连",
      "   热度｜中高",
      "   命中群｜倚天、2026",
      "   原文数｜4",
    ].join("\n")

    const index = extractWechatMainlineIndex(source, "/tmp/2026-06-15.md", "raw/微信聊天/2026-06-15.md")
    expect(index.counts).toEqual({ windows: 1, mainlines: 2 })
    expect(index.items[0]).toMatchObject({
      windowTime: "23:00:00",
      label: "MPO / 无源光互联 / CPO-NPO 连接器",
      heat: "高",
      groups: "周期有道、2026，5月🇨🇳崛起",
      sourceCount: "5",
      lineStart: 5,
    })
    expect(index.items[1]).toMatchObject({
      label: "HVLP4 高端铜箔 / AI 服务器铜互连",
      heat: "中高",
      groups: "倚天、2026",
      sourceCount: "4",
    })
  })

  it("compacts large time-only WeChat sources without dropping tail windows", () => {
    const windows = Array.from({ length: 12 }, (_, i) => {
      const hh = String(i).padStart(2, "0")
      return [
        `## ${hh}:00:00 舆情更新`,
        "",
        "### 主线归因",
        "",
        "主线｜热度｜命中群｜原文数",
        `- 主题${i + 1}尾部验证 | ★★★ | 核心群(${i + 1}) | 1`,
        "",
        "### 完整调研原文",
        "```",
        `${"长原文".repeat(900)} ${i === 11 ? "TAIL-KEEP-ME" : ""}`,
        "```",
      ].join("\n")
    })
    const source = ["# 2026-06-12 微信舆情", "", ...windows].join("\n\n")
    const compacted = compactSourceContentForPrompt(source, "/tmp/2026-06-12.md", "hash", 30000)
    expect(compacted).toContain("保留窗口数：12 / 12")
    expect(compacted).toContain("TAIL-KEEP-ME")
  })

  it("builds source sharding reports for large WeChat sentiment during prepare", async () => {
    const sourcePath = path.join(tmpRoot, "raw/微信聊天/2026-06-12.md")
    const windows = Array.from({ length: 12 }, (_, i) => {
      const hh = String(i).padStart(2, "0")
      return [
        `## ${hh}:00:00 舆情更新`,
        "",
        "### 主线归因",
        "",
        "主线｜热度｜命中群｜原文数",
        `- 分片主题${i + 1} | ★★★★ | 核心群(${i + 1}) | 1`,
        "",
        "### 完整调研原文",
        "```",
        `${"分片长原文".repeat(700)}`,
        "```",
      ].join("\n")
    })
    await write(sourcePath, ["# 2026-06-12 微信舆情", "", ...windows].join("\n\n"))

    const result = await prepareIngest({
      projectPath: tmpRoot,
      sourcePath,
      reportId: "wechat-shards",
      maxShardChars: 12000,
      shardConcurrency: 2,
    })

    expect(result.sourceSharding.enabled).toBe(true)
    expect(result.sourceSharding.shards.length).toBeGreaterThan(1)
    expect(result.sourceMainlineIndex.counts).toEqual({ windows: 12, mainlines: 12 })
    const savedIndex = JSON.parse(await read(path.join(result.reportDir, "source-mainline-index.json")))
    const savedShards = JSON.parse(await read(path.join(result.reportDir, "shards.json")))
    expect(savedIndex.items).toHaveLength(12)
    expect(savedShards.enabled).toBe(true)
    expect(savedShards.counts.shards).toBe(result.sourceSharding.shards.length)
  })

  it("honors source sharding off and force modes", async () => {
    const sourcePath = path.join(tmpRoot, "raw/微信聊天/2026-06-12-small.md")
    await write(
      sourcePath,
      [
        "# 小微信舆情",
        "",
        "## 00:40:00 舆情更新",
        "",
        "### 主线归因",
        "",
        "主线｜热度｜命中群｜原文数",
        "- 小文件主线 | ★★★ | 核心群(1) | 1",
      ].join("\n") + "\n",
    )

    const off = await prepareIngest({
      projectPath: tmpRoot,
      sourcePath,
      reportId: "wechat-shards-off",
      sourceSharding: "off",
    })
    expect(off.sourceSharding.enabled).toBe(false)
    expect(off.sourceSharding.reason).toBe("disabled_by_option")

    const forced = await prepareIngest({
      projectPath: tmpRoot,
      sourcePath,
      reportId: "wechat-shards-force",
      sourceSharding: "force",
    })
    expect(forced.sourceSharding.enabled).toBe(true)
    expect(forced.sourceSharding.shards).toHaveLength(1)
  })

  it("writes reports without changing raw or wiki content", async () => {
    const source = path.join(tmpRoot, "raw/研报新闻/2026-05-28-AI服务器电源.md")
    const wikiBefore = await read(path.join(tmpRoot, "wiki/概念/算电协同.md"))
    const rawBefore = await read(source)

    const result = await prepareIngest({
      projectPath: tmpRoot,
      sourcePath: source,
      reportId: "test-report",
    })

    expect(result.reportDir).toBe(path.join(tmpRoot, ".llm-wiki/codex-ingest/test-report"))
    expect(result.candidates.wikiCandidates[0].path).toBe("wiki/概念/算电协同.md")
    expect(await read(path.join(tmpRoot, "wiki/概念/算电协同.md"))).toBe(wikiBefore)
    expect(await read(source)).toBe(rawBefore)
    await expect(fs.access(path.join(result.reportDir, "context.md"))).resolves.toBeUndefined()
    await expect(fs.access(path.join(result.reportDir, "changes.template.json"))).resolves.toBeUndefined()
  })

  it("puts trade execution data boundary into ingest context", async () => {
    const source = path.join(tmpRoot, "raw/日复盘/2026-06-13-复盘.md")
    await write(
      source,
      [
        "# 2026-06-13 复盘",
        "",
        "- 今日买入利通电子，卖出三孚新科，记录了成交价、仓位和盈亏。",
        "- 真正可沉淀的是追高错误、仓位纪律和机器人链条的验证条件。",
      ].join("\n") + "\n",
    )

    const result = await prepareIngest({
      projectPath: tmpRoot,
      sourcePath: source,
      noReport: true,
    })

    expect(result.contextMarkdown).toContain("Stock-page boundary")
    expect(result.contextMarkdown).toContain("do not record user trade execution data")
    expect(result.contextMarkdown).toContain("buy/sell actions")
    expect(result.contextMarkdown).toContain("stock pages may link to reviews but must not copy execution details")
  })

  it("adds a compact methodology pre-read pack without full-text prompt bloat", async () => {
    const source = path.join(tmpRoot, "raw/研报新闻/2026-05-28-AI服务器电源.md")
    await write(
      path.join(tmpRoot, "wiki/策略/四层嵌套决策体系.md"),
      `${validFrontmatter("四层嵌套决策体系", "策略")}# 四层嵌套决策体系

## L1 市场结构
- L1 判断主线和非主线，先确认市场阶段。

## L4 执行控制
- L4 只处理执行触发、仓位、退出和明日验证清单。

${Array.from({ length: 260 }, (_, i) => `- 普通长段 ${i} ${"背景文字".repeat(18)}`).join("\n")}

- TAIL_SHOULD_BE_TRUNCATED ${"尾部不应进入预读包".repeat(80)}
`,
    )
    await write(
      path.join(tmpRoot, "wiki/策略/L4执行控制层.md"),
      `${validFrontmatter("L4执行控制层", "策略")}# L4执行控制层

- 执行必须绑定验证窗口、证伪条件和退出规则。
`,
    )
    await write(
      path.join(tmpRoot, "wiki/策略/WKID四步法.md"),
      `\`\`\`yaml
---
schema_version: 1
title: WKID四步法
aliases: []
type: 策略
summary: ""
tags:
  - WKID
related:
  - "[[策略/四层嵌套决策体系]]"
sources: []
created: 2026-05-11 14:23:07
updated: 2026-05-11 14:23:07
last_reviewed: 2026-05-11 14:23:07
confidence: 中
status: 活跃
---
\`\`\`
# WKID四步法

## Step 1: W — Wikilink提取与规范化
- W 步骤用于提取股票、催化剂、市场状态、策略名称和错误类型。

## Step 2: K — Keyword归属映射
- K 步骤把关键词映射到 L1-L4，避免孤立页面脱离四层嵌套决策体系。
`,
    )

    const direct = await buildMethodologyContext(tmpRoot, {
      paths: METHODOLOGY_CONTEXT_PATHS,
      perPageChars: METHODOLOGY_PAGE_CHAR_SOFT_LIMIT,
      totalChars: METHODOLOGY_CONTEXT_TOTAL_CHAR_SOFT_LIMIT,
    })
    expect(direct.paths).toContain("wiki/策略/四层嵌套决策体系.md")
    expect(direct.markdown).toContain("Methodology Pre-read Pack")
    expect(direct.markdown).toContain("L4 执行控制")
    expect(direct.markdown).toContain("Keyword归属映射")
    expect(direct.markdown).not.toContain("TAIL_SHOULD_BE_TRUNCATED")
    expect(direct.markdown.length).toBeLessThanOrEqual(METHODOLOGY_CONTEXT_TOTAL_CHAR_SOFT_LIMIT + 80)

    const result = await prepareIngest({
      projectPath: tmpRoot,
      sourcePath: source,
      reportId: "methodology-pack",
    })
    expect(result.methodologyContext.markdown).toContain("Methodology Pre-read Pack")
    expect(result.methodologyContext.stage3Rules).toContain("Methodology Guardrails")
    expect(await read(path.join(result.reportDir, "context.md"))).toContain("Methodology Pre-read Pack")
    const saved = JSON.parse(await read(path.join(result.reportDir, "methodology-context.json")))
    expect(saved.paths).toContain("wiki/策略/L4执行控制层.md")
  })

  it("non-vector search uses aliases, tags, related and body text", async () => {
    const source = path.join(tmpRoot, "raw/研报新闻/2026-05-28-AI服务器电源.md")
    const sourceContent = await read(source)
    const candidates = await searchCandidatePages(tmpRoot, source, sourceContent, { topWiki: 5 })

    expect(candidates.retrievalMode).toBe(RETRIEVAL_MODES.INGEST)
    const paths = candidates.wikiCandidates.map((item) => item.path)
    expect(paths[0]).toBe("wiki/概念/算电协同.md")
    expect(paths).toContain("wiki/概念/电力运营商重估.md")
    expect(candidates.tokens).toContain("ai")
  })

  it("ingest source tokens keep topic words and drop metadata noise", async () => {
    const sourcePath = path.join(tmpRoot, "raw/openclaw数据/产业链复盘/gangtise_themes/2026-06-05/0056-复盘-机器人-126491.md")
    const source = `---
title: "机器人 2026-06-05 复盘"
theme_id: 126491
theme_date: "2026-06-05"
type: "复盘"
type_code: 1
name: "机器人"
code: "880134.GT"
source_db: "cn_alternative_db.public.gangtise_themes"
source_field: "full_content"
content_sha256: "9fee053924294ea6c88e3a41965ccd8d326612184fddaa13f2462f0d0c7c2e40"
hot_status: "热门"
---
# 机器人 2026-06-05 复盘

## 原文
- <strong>黄仁勋表态“机器人+AI制造”</strong>：Physical AI 与具身智能进入工业场景。
- 特斯拉 Optimus V3 量产、PPA、SOP、谐波减速器、丝杠和订单节点需要跟踪。
`
    const tokens = extractSourceTokens(source, sourcePath, 40)

    expect(tokens).toContain("机器人")
    expect(tokens).toContain("具身智能")
    expect(tokens).toContain("physical")
    expect(tokens).toContain("ai")
    expect(tokens).toContain("ppa")
    expect(tokens).not.toContain("0")
    expect(tokens).not.toContain("t")
    expect(tokens).not.toContain(":")
    expect(tokens).not.toContain("theme_id")
    expect(tokens).not.toContain("2026")
    expect(tokens).not.toContain("复盘")
  })

  it("ingest candidate ranking stays topic-focused for noisy OpenClaw robot sources", async () => {
    const sourcePath = path.join(tmpRoot, "raw/openclaw数据/产业链复盘/gangtise_themes/2026-06-05/0056-复盘-机器人-126491.md")
    const source = `---
title: "机器人 2026-06-05 复盘"
theme_id: 126491
theme_date: "2026-06-05"
type: "复盘"
name: "机器人"
source_db: "cn_alternative_db.public.gangtise_themes"
source_field: "full_content"
---
# 机器人 2026-06-05 复盘

## 元数据
- theme_id：126491
- theme_date：2026-06-05
- type：复盘
- code：880134.GT

## 原文
- 黄仁勋表态机器人和 Physical AI 进入工业制造。
- 特斯拉 Optimus V3 量产、PPA、SOP、谐波减速器、丝杠和订单节点需要跟踪。
`
    await write(sourcePath, source)
    await write(
      path.join(tmpRoot, "wiki/概念/物理AI与具身智能.md"),
      `---
schema_version: 1
title: 物理AI与具身智能
aliases:
  - Physical AI
type: 概念
summary: 物理AI与具身智能页沉淀机器人方向的量产、客户、订单、出货和交易验证节点。
tags:
  - 机器人
  - 具身智能
related:
  - "[[概念/机器人产业链]]"
sources:
  - raw/openclaw数据/产业链复盘/gangtise_themes/2026-06-05/0056-复盘-机器人-126491.md
created: 2026-05-11 14:23:07
updated: 2026-05-11 14:23:07
last_reviewed: 2026-05-11 14:23:07
confidence: 中
status: 活跃
---

# 物理AI与具身智能

机器人进入订单、量产、客户和出货验证阶段，关注 PPA、SOP、谐波减速器和丝杠。
`,
    )
    await write(
      path.join(tmpRoot, "wiki/概念/泛AI服务器链.md"),
      `${validFrontmatter("泛AI服务器链", "概念")}# 泛AI服务器链

AI 服务器、PCB、光模块和算力链在 2026 年反复出现。${"AI 2026 今日 复盘 逻辑 验证 ".repeat(80)}
`,
    )

    const candidates = await searchCandidatePages(tmpRoot, sourcePath, source, { topWiki: 5 })
    expect(candidates.retrievalMode).toBe("ingest")
    const paths = candidates.wikiCandidates.map((item) => item.path)
    const specificIndex = paths.indexOf("wiki/概念/物理AI与具身智能.md")
    const broadIndex = paths.indexOf("wiki/概念/泛AI服务器链.md")
    expect(specificIndex).toBe(0)
    if (broadIndex !== -1) expect(broadIndex).toBeGreaterThan(specificIndex)
    expect(candidates.tokens).not.toContain("0")
    expect(candidates.tokens).not.toContain("theme_id")
    expect(candidates.segments).toEqual([])
  })

  it("segments multi-topic WeChat sentiment and keeps theme candidates distinct", async () => {
    const sourcePath = path.join(tmpRoot, "raw/微信聊天/2026-06-06.md")
    const source = `---
---

## 2026-06-06 00:00:00 舆情更新
## 2026-06-06 00:00 舆情摘要

### 同步与窗口
- core-sync 成功，核心群成功 11 个。

### 市场情绪
- 外围科技风险压制，但低位科技主线仍有分化机会。

### 重点板块/标的
1. 商业航天/SpaceX IPO 映射｜热度：高｜命中群：2026资讯、周期有道｜原文数：7
   - SpaceX 750 亿美元 IPO 超额认购，商业航天、卫星互联网和太空算力映射继续发酵。
   - 待验证：SpaceX IPO 实际定价、交易时间、国内商业航天产业链是否有订单兑现。
   - 共同需要参考跨主题风险管理，避免海外龙头利好映射 A 股追高。

2. 数据中心光纤/MPO/中天科技｜热度：高｜命中群：2026资讯｜原文数：2
   - 中天科技中标国内互联网企业数据中心 MPO 光纤跳线及配件约 15.18 亿元。
   - A1/D 纤、MPO 光纤、数据中心耗材、Scale-Up、DCI 和光互联需求被集中强调。
   - 共同需要参考跨主题风险管理，避免把单条中标小作文直接当作全行业确认。

3. 美股科技回撤/外围科技风险｜热度：中高｜命中群：2026资讯｜原文数：4
   - 纳指、英伟达、台积电、博通、美光、AMD、英特尔同步下跌，影响 A 股科技风险偏好。
   - A 股高位算力、CPO 和 AIDC 休整，低位科技接力仍需下个交易日验证。
   - 共同需要参考跨主题风险管理和当前市场阶段判断。

### 风险与待验证
- 本轮 SpaceX IPO、MPO 光纤中标和美股科技风险均来自群聊文本或转发纪要，未接外部行情源校验。
`
    await write(sourcePath, source)
    await write(
      path.join(tmpRoot, "wiki/概念/商业航天产业链.md"),
      `---
schema_version: 1
title: 商业航天产业链
aliases:
  - SpaceX IPO
  - 卫星互联网
type: 概念
summary: 商业航天产业链页跟踪 SpaceX IPO、卫星互联网、太空算力和国内商业航天映射。
tags:
  - 商业航天
  - SpaceX
  - IPO催化
related: []
sources: []
created: 2026-05-11 14:23:07
updated: 2026-05-11 14:23:07
last_reviewed: 2026-05-11 14:23:07
confidence: 中
status: 活跃
---

# 商业航天产业链

SpaceX IPO、卫星互联网、太空算力和商业航天国内映射需要订单与政策验证。
`,
    )
    await write(
      path.join(tmpRoot, "wiki/概念/SpaceX IPO催化.md"),
      `---
schema_version: 1
title: SpaceX IPO催化
aliases:
  - SpaceX上市
  - SpaceX IPO
type: 概念
summary: SpaceX IPO催化页跟踪上市时间、估值、定价结构和 A 股商业航天映射风险。
tags:
  - SpaceX
  - IPO催化
  - 商业航天
related:
  - "[[概念/商业航天产业链]]"
sources: []
created: 2026-05-11 14:23:07
updated: 2026-05-11 14:23:07
last_reviewed: 2026-05-11 14:23:07
confidence: 中
status: 活跃
---

# SpaceX IPO催化

SpaceX IPO 交易时间、估值和映射需要二次核验。
`,
    )
    await write(
      path.join(tmpRoot, "wiki/概念/数据中心光纤MPO.md"),
      `---
schema_version: 1
title: 数据中心光纤MPO
aliases:
  - MPO光纤跳线
  - 数据中心光纤
  - 中天科技MPO
type: 概念
summary: 数据中心光纤MPO页跟踪 A1/D纤、MPO跳线、数据中心耗材、Scale-Up 和光互联需求。
tags:
  - 光纤
  - MPO
  - 数据中心
  - 光互联
related:
  - "[[概念/光互联Scale-Up-十年大周期]]"
sources: []
created: 2026-05-11 14:23:07
updated: 2026-05-11 14:23:07
last_reviewed: 2026-05-11 14:23:07
confidence: 中
status: 活跃
---

# 数据中心光纤MPO

中天科技、亨通光电、MPO 光纤跳线和数据中心光纤紧缺需要中标份额、单价与交付验证。
`,
    )
    await write(
      path.join(tmpRoot, "wiki/概念/光互联Scale-Up-十年大周期.md"),
      `---
schema_version: 1
title: 光互联Scale-Up-十年大周期
aliases:
  - Scale-Up
  - 数据中心光互联
  - MPO光纤
type: 概念
summary: 光互联Scale-Up页跟踪 AI 数据中心互联、MPO 光纤、DCI 和 Scale-Up 网络需求。
tags:
  - 光互联
  - Scale-Up
  - MPO
related:
  - "[[概念/数据中心光纤MPO]]"
sources: []
created: 2026-05-11 14:23:07
updated: 2026-05-11 14:23:07
last_reviewed: 2026-05-11 14:23:07
confidence: 中
status: 活跃
---

# 光互联Scale-Up-十年大周期

Scale-Up、DCI、MPO 光纤和数据中心光互联是 AI 基础设施互联分支。
`,
    )
    await write(
      path.join(tmpRoot, "wiki/模式/当前市场阶段判断.md"),
      `---
schema_version: 1
title: 当前市场阶段判断
aliases:
  - 科技风险偏好
  - 风格切换
type: 模式
summary: 当前市场阶段判断页跟踪指数、成交、主线承接、风格切换和风险偏好变化。
tags:
  - 市场阶段
  - 风格切换
  - 科技风险
related: []
sources: []
created: 2026-05-11 14:23:07
updated: 2026-05-11 14:23:07
last_reviewed: 2026-05-11 14:23:07
confidence: 中
status: 活跃
---

# 当前市场阶段判断

美股科技回撤、A 股高位算力休整和低位科技接力需要区分。
`,
    )
    await write(
      path.join(tmpRoot, "wiki/模式/跨主题风险管理.md"),
      `---
schema_version: 1
title: 跨主题风险管理
aliases:
  - SpaceX IPO
  - MPO光纤
  - 美股科技回撤
type: 模式
summary: 跨主题风险管理页用于约束多主题舆情中高热转发、群聊小作文和事实强度之间的错配。
tags:
  - 风险管理
  - 群聊舆情
  - 事实强度
related: []
sources: []
created: 2026-05-11 14:23:07
updated: 2026-05-11 14:23:07
last_reviewed: 2026-05-11 14:23:07
confidence: 中
status: 活跃
---

# 跨主题风险管理

SpaceX IPO、MPO 光纤和美股科技回撤都需要避免把群聊热度升级为事实强度。
`,
    )
    await write(
      path.join(tmpRoot, "wiki/总结/2026-06-02-日复盘.md"),
      `${validFrontmatter("2026 06 02 日复盘", "总结")}# 2026 06 02 日复盘\n\n${"商业航天 SpaceX 数据中心 光纤 MPO 科技 风险 ".repeat(120)}\n`,
    )

    const result = await prepareIngest({
      projectPath: tmpRoot,
      sourcePath,
      reportId: "wechat-segments",
    })
    const segments = result.candidates.segments
    expect(segments.length).toBeGreaterThanOrEqual(3)
    expect(segments.map((item) => item.title)).toEqual([
      "商业航天/SpaceX IPO 映射",
      "数据中心光纤/MPO/中天科技",
      "美股科技回撤/外围科技风险",
    ])

    const spaceSegment = segments.find((item) => item.title.includes("商业航天"))
    const fiberSegment = segments.find((item) => item.title.includes("数据中心光纤"))
    const riskSegment = segments.find((item) => item.title.includes("美股科技"))
    expect(spaceSegment.wikiCandidates.map((item) => item.path)).toContain("wiki/概念/商业航天产业链.md")
    expect(spaceSegment.wikiCandidates[0].type).not.toBe("总结")
    expect(fiberSegment.wikiCandidates.map((item) => item.path)).toContain("wiki/概念/数据中心光纤MPO.md")
    expect(fiberSegment.wikiCandidates[0].path).not.toMatch(/SpaceX|商业航天/)
    expect(fiberSegment.wikiCandidates[0].type).not.toBe("总结")
    expect(riskSegment.wikiCandidates.map((item) => item.path)).toContain("wiki/模式/当前市场阶段判断.md")

    const globalPaths = result.candidates.wikiCandidates.map((item) => item.path)
    expect(new Set(globalPaths).size).toBe(globalPaths.length)
    const crossTheme = result.candidates.wikiCandidates.find((item) => item.path === "wiki/模式/跨主题风险管理.md")
    expect(crossTheme?.matchedSegments?.length).toBeGreaterThanOrEqual(2)
    const summaryIndex = globalPaths.indexOf("wiki/总结/2026-06-02-日复盘.md")
    const conceptIndex = globalPaths.indexOf("wiki/概念/商业航天产业链.md")
    expect(summaryIndex === -1 || summaryIndex).toBeGreaterThan(conceptIndex)

    const saved = JSON.parse(await read(path.join(result.reportDir, "candidate-pages.json")))
    expect(saved.segments.length).toBe(3)
    expect(await read(path.join(result.reportDir, "context.md"))).toContain("Segment Candidate Groups")
    expect(await read(path.join(result.reportDir, "dry-run.md"))).toContain("Segment Candidate Groups")
  })

  it("falls back to whole-document retrieval when WeChat segmentation is unavailable", async () => {
    const sourcePath = path.join(tmpRoot, "raw/微信聊天/2026-06-06-no-segments.md")
    const source = "# 2026-06-06 舆情摘要\n\nAI服务器电源、数据中心供电和算电协同继续被讨论，但没有重点板块编号。"
    await write(sourcePath, source)

    const candidates = await searchCandidatePages(tmpRoot, sourcePath, source, { topWiki: 5 })
    expect(candidates.segments).toEqual([])
    expect(candidates.wikiCandidates[0].path).toBe("wiki/概念/算电协同.md")
  })

  it("segments obvious long multi-topic sources without focus headings", async () => {
    const sourcePath = path.join(tmpRoot, "raw/研报新闻/2026-06-06-多主题长文.md")
    const source = [
      "# 多主题长文",
      "",
      `1. AI服务器电源｜热度：高｜原文数：3\n   - AI服务器电源、数据中心供电、算电协同和算力扩张被反复讨论。\n   ${"AI服务器电源 数据中心供电 算电协同 ".repeat(1300)}`,
      "",
      `2. 电力运营商重估｜热度：中｜原文数：2\n   - 电力负荷、容量电价、运营商重估和算力用电弹性进入讨论。\n   ${"电力运营商重估 电力负荷 容量电价 ".repeat(1300)}`,
    ].join("\n")
    await write(sourcePath, source)

    const candidates = await searchCandidatePages(tmpRoot, sourcePath, source, { topWiki: 8, maxSegments: 2 })
    expect(candidates.segments.map((item) => item.title)).toEqual(["AI服务器电源", "电力运营商重估"])
    expect(candidates.segments[0].wikiCandidates.map((item) => item.path)).toContain("wiki/概念/算电协同.md")
    expect(candidates.segments[1].wikiCandidates.map((item) => item.path)).toContain("wiki/概念/电力运营商重估.md")
  })

  it("prepares temporal fact context with entity candidates and related old facts", async () => {
    await write(
      path.join(tmpRoot, TEMPORAL_FACTS_RELATIVE_PATH),
      `${JSON.stringify({
        id: "tf-old-msap",
        type: "temporal_fact",
        status: "active",
        subject: "三孚新科",
        predicate: "HAS_ORDER",
        object: "mSAP电镀设备订单",
        claim: "三孚新科 mSAP 电镀设备订单已经落地。",
        validAt: "2026-05-28",
      })}\n`,
    )
    const sourcePath = path.join(tmpRoot, "raw/研报新闻/2026-06-06-三孚新科澄清.md")
    await write(sourcePath, "# 三孚新科澄清\n\n三孚新科 688359.SH mSAP 电镀设备订单尚未确认，旧订单结论需要回查。")

    const result = await prepareIngest({
      projectPath: tmpRoot,
      sourcePath,
      reportId: "temporal-context",
    })

    expect(result.temporalFactContext.entityCandidates.map((item) => item.entityKey)).toContain("stock:SH688359")
    expect(result.temporalFactContext.relatedFacts.map((item) => item.id)).toContain("tf-old-msap")
    expect(result.contextMarkdown).toContain("Temporal Fact Context")
    expect(result.contextMarkdown).toContain("tf-old-msap")
    const saved = JSON.parse(await read(path.join(result.reportDir, "candidate-pages.json")))
    expect(saved.temporalFactContext.relatedFacts.map((item) => item.id)).toContain("tf-old-msap")
  })

  it("adds segment-level temporal fact seeds for long multi-topic sources", async () => {
    await write(
      path.join(tmpRoot, TEMPORAL_FACTS_RELATIVE_PATH),
      `${JSON.stringify({
        id: "tf-sanf-msap",
        type: "temporal_fact",
        status: "active",
        subject: "三孚新科",
        predicate: "HAS_ORDER",
        object: "mSAP电镀设备订单",
        claim: "三孚新科 mSAP 电镀设备订单已经落地。",
        validAt: "2026-05-28",
      })}\n`,
    )
    const sourcePath = path.join(tmpRoot, "raw/微信聊天/2026-06-06-temporal-segments.md")
    const source = [
      "# 2026-06-06 多主题舆情",
      "",
      "### 重点板块/标的",
      "",
      "1. 三孚新科/mSAP订单澄清｜热度：高｜原文数：3",
      "   - 三孚新科 688359.SH mSAP 电镀设备订单尚未确认，可能需要推翻旧订单事实。",
      "   - 需要回看旧 fact id 后再 supersedes。",
      "",
      "2. 电力运营商重估｜热度：中｜原文数：2",
      "   - 电力负荷、容量电价、运营商重估继续发酵。",
      "",
      "### 风险与待验证",
      "- 订单事实强度待公告验证。",
    ].join("\n")
    await write(sourcePath, source)

    const result = await prepareIngest({
      projectPath: tmpRoot,
      sourcePath,
      reportId: "temporal-segments",
    })

    const sanfSegment = result.temporalFactContext.segmentFactSeeds.find((item) => item.title.includes("三孚新科"))
    expect(sanfSegment.entityCandidates.map((item) => item.entityKey)).toContain("stock:SH688359")
    expect(sanfSegment.relatedFacts.map((item) => item.id)).toContain("tf-sanf-msap")
    expect(result.contextMarkdown).toContain("Segment Fact Seeds")
  })

  it("audits existing wiki for temporal predicate and concept alias candidates", async () => {
    await write(
      path.join(tmpRoot, "wiki/股票/三孚新科.md"),
      `---
schema_version: 1
title: 三孚新科
aliases:
  - 688359
  - 688359.SH
code: SH688359
type: 股票
summary: 三孚新科跟踪 mSAP 类载板设备、客户验证、订单落地、产能扩张和涨价风险。
tags:
  - mSAP
  - 类载板
related:
  - "[[概念/mSAP类载板]]"
sources: []
created: 2026-05-11 14:23:07
updated: 2026-05-11 14:23:07
last_reviewed: 2026-05-11 14:23:07
confidence: 中
status: 活跃
---

# 三孚新科

## 订单与客户验证
三孚新科的 mSAP 设备订单、客户验证、产能扩张、涨价弹性和澄清风险都需要进入 temporal facts 审计。
`,
    )
    await write(
      path.join(tmpRoot, "wiki/概念/mSAP类载板.md"),
      `---
schema_version: 1
title: mSAP类载板
aliases:
  - mSAP
  - 类载板
  - 载板
type: 概念
summary: mSAP 类载板跟踪 ABF、IC substrate、设备订单、产能瓶颈、客户验证和供给约束。
tags:
  - ABF
  - IC substrate
related: []
sources: []
created: 2026-05-11 14:23:07
updated: 2026-05-11 14:23:07
last_reviewed: 2026-05-11 14:23:07
confidence: 中
status: 活跃
---

# mSAP类载板

mSAP 类载板涉及 ABF、IC substrate、设备订单、产能瓶颈、客户验证和供给约束。
`,
    )
    await write(
      path.join(tmpRoot, "wiki/概念/华为τ定律与LogicFolding.md"),
      `---
schema_version: 1
title: 华为τ定律与LogicFolding
aliases:
  - LogicFolding
  - 华为τ定律
type: 概念
summary: 华为τ定律与 LogicFolding 属于先进封装与逻辑折叠技术路径。
tags:
  - 先进封装
related: []
sources: []
created: 2026-05-11 14:23:07
updated: 2026-05-11 14:23:07
last_reviewed: 2026-05-11 14:23:07
confidence: 中
status: 活跃
---

# 华为τ定律与LogicFolding

LogicFolding 和华为τ定律需要作为人工裁决样例。
`,
    )
    await write(
      path.join(tmpRoot, "wiki/概念/逻辑折叠.md"),
      `---
schema_version: 1
title: 逻辑折叠
aliases:
  - LogicFolding
type: 概念
summary: 逻辑折叠是先进封装路径中的一个表达。
tags:
  - 先进封装
related: []
sources: []
created: 2026-05-11 14:23:07
updated: 2026-05-11 14:23:07
last_reviewed: 2026-05-11 14:23:07
confidence: 中
status: 活跃
---

# 逻辑折叠

LogicFolding 可能和华为τ定律页面冲突。
`,
    )

    const result = await runTemporalFactsAudit({
      projectPath: tmpRoot,
      reportId: "audit-test",
      write: true,
      topN: 20,
    })

    expect(result.counts.wikiFiles).toBeGreaterThan(0)
    expect(result.predicateCandidates.map((item) => item.suggestedPredicate)).toEqual(expect.arrayContaining(["HAS_ORDER", "CUSTOMER_VALIDATED", "HAS_CAPACITY", "PRICE_VALIDATED", "HAS_RISK", "HAS_VALIDATION_SIGNAL"]))
    const orderPredicate = result.predicateCandidates.find((item) => item.term === "订单")
    expect(orderPredicate.candidatePredicates).toEqual(expect.arrayContaining(["HAS_ORDER_RUMOR", "HAS_CONFIRMED_ORDER"]))
    const stockAlias = result.aliasCandidates.find((item) => item.entityKey === "stock:SH688359")
    expect(stockAlias.aliases.map((item) => item.alias)).toEqual(expect.arrayContaining(["688359", "688359.SH"]))
    expect(stockAlias.aliases.map((item) => item.alias)).not.toEqual(expect.arrayContaining(["mSAP", "类载板"]))
    const conceptAlias = result.aliasCandidates.find((item) => item.path === "wiki/概念/mSAP类载板.md")
    expect(conceptAlias.aliases.map((item) => item.alias)).toEqual(expect.arrayContaining(["mSAP", "类载板"]))
    expect(conceptAlias.aliases.map((item) => item.alias)).not.toContain("ABF")
    expect(result.tagCandidates.map((item) => item.tag)).toEqual(expect.arrayContaining(["mSAP", "类载板", "ABF", "ICsubstrate"]))
    expect(result.tagCandidates.find((item) => item.tag === "mSAP").classification).toBe("promote_concept")
    expect(result.tagCandidates.find((item) => item.tag === "先进封装").classification).toBe("promote_concept")
    expect(result.abbreviationCandidates.map((item) => item.abbreviation)).toEqual(expect.arrayContaining(["mSAP", "ABF"]))
    expect(result.abbreviationCandidates.find((item) => item.abbreviation === "ABF").classification).toBe("alias_whitelist")
    const logicConflict = result.aliasConflicts.find((item) => item.alias === "LogicFolding")
    expect(logicConflict.ruling.target).toBe("华为τ定律与LogicFolding")
    expect(result.curatedAliasRulings.find((item) => item.alias === "LogicFolding").matchedConflict).toBe(true)
    expect(result.conceptHierarchyRules.map((item) => item.root)).toEqual(expect.arrayContaining(["先进封装"]))
    expect(result.outputs).toEqual({
      json: ".llm-wiki/temporal-facts/audit-test.json",
      markdown: ".llm-wiki/temporal-facts/audit-test.md",
    })
    expect(await read(path.join(tmpRoot, result.outputs.markdown))).toContain("Temporal Facts Audit")
    expect(await read(path.join(tmpRoot, result.outputs.markdown))).toContain("Tag Candidates")
    expect(await read(path.join(tmpRoot, result.outputs.markdown))).toContain("Curated Alias Rulings")
    expect(JSON.parse(await read(path.join(tmpRoot, result.outputs.json))).counts.aliasCandidates).toBeGreaterThan(0)
  })

  it("routes sameAs concept plan items to the canonical page", async () => {
    const rulingsPath = path.join(tmpRoot, "concept-rulings.json")
    await write(
      rulingsPath,
      JSON.stringify({
        schema: "concept-canonical-rulings-v1",
        sameAs: [
          {
            from: "wiki/概念/AI-PCB上游短缺体系.md",
            to: "wiki/概念/AI PCB上游短缺体系.md",
            mode: "auto",
            reason: "标点差异",
          },
        ],
      }),
    )
    await write(path.join(tmpRoot, "wiki/概念/AI PCB上游短缺体系.md"), `${validFrontmatter("AI PCB上游短缺体系")}# AI PCB上游短缺体系\n`)

    const plan = await normalizeIngestPlan(
      tmpRoot,
      {
        create: [],
        update: [{ path: "wiki/概念/AI-PCB上游短缺体系.md", why: "补充上游短缺证据" }],
        factWrites: [],
      },
      "2026-06-13-test",
      { conceptRulingsPath: rulingsPath },
    )

    expect(plan.update.map((item) => item.path)).toContain("wiki/概念/AI PCB上游短缺体系.md")
    expect(plan.update.map((item) => item.path)).not.toContain("wiki/概念/AI-PCB上游短缺体系.md")
    expect(plan.conceptRouting).toEqual(expect.arrayContaining([
      expect.objectContaining({
        originalPath: "wiki/概念/AI-PCB上游短缺体系.md",
        routedPath: "wiki/概念/AI PCB上游短缺体系.md",
        ruleType: "sameAs",
        auto: true,
      }),
    ]))
  })

  it("does not auto-merge child concepts or trading slices", async () => {
    const rulingsPath = path.join(tmpRoot, "concept-rulings.json")
    await write(
      rulingsPath,
      JSON.stringify({
        schema: "concept-canonical-rulings-v1",
        childOf: [
          {
            child: "wiki/概念/HVLP铜箔.md",
            parent: "wiki/概念/铜箔.md",
            reason: "HVLP 有独立等级和客户验证",
          },
        ],
        tradeSliceOf: [
          {
            slice: "wiki/概念/PCB铜箔涨价周期.md",
            parent: "wiki/概念/铜箔.md",
            reason: "涨价周期保留交易语境",
          },
        ],
      }),
    )
    await write(path.join(tmpRoot, "wiki/概念/HVLP铜箔.md"), `${validFrontmatter("HVLP铜箔")}# HVLP铜箔\n`)
    await write(path.join(tmpRoot, "wiki/概念/铜箔.md"), `${validFrontmatter("铜箔")}# 铜箔\n`)
    await write(path.join(tmpRoot, "wiki/概念/PCB铜箔涨价周期.md"), `${validFrontmatter("PCB铜箔涨价周期")}# PCB铜箔涨价周期\n`)

    const plan = await normalizeIngestPlan(
      tmpRoot,
      {
        create: [],
        update: [
          { path: "wiki/概念/HVLP铜箔.md", why: "补充 HVLP4 良率" },
          { path: "wiki/概念/PCB铜箔涨价周期.md", why: "补充涨价验证" },
        ],
        factWrites: [],
      },
      "2026-06-13-test",
      { conceptRulingsPath: rulingsPath },
    )

    expect(plan.update.map((item) => item.path)).toEqual(expect.arrayContaining([
      "wiki/概念/HVLP铜箔.md",
      "wiki/概念/PCB铜箔涨价周期.md",
    ]))
    expect(plan.update.map((item) => item.path)).not.toContain("wiki/概念/铜箔.md")
    expect(plan.conceptRouting.filter((item) => item.auto)).toHaveLength(0)
    expect(plan.conceptRouting.map((item) => item.ruleType)).toEqual(expect.arrayContaining(["childOf", "tradeSliceOf"]))
  })

  it("writes concept governance audit reports without changing wiki pages", async () => {
    const rulingsPath = path.join(tmpRoot, "concept-rulings.json")
    await write(
      rulingsPath,
      JSON.stringify({
        schema: "concept-canonical-rulings-v1",
        sameAs: [
          {
            from: "wiki/概念/AI-PCB油墨涨价链.md",
            to: "wiki/概念/AI PCB油墨涨价链.md",
            mode: "auto",
            reason: "标点差异",
          },
        ],
      }),
    )
    const canonicalPath = path.join(tmpRoot, "wiki/概念/AI PCB油墨涨价链.md")
    const variantPath = path.join(tmpRoot, "wiki/概念/AI-PCB油墨涨价链.md")
    await write(canonicalPath, `${validFrontmatter("AI PCB油墨涨价链")}# AI PCB油墨涨价链\n`)
    await write(variantPath, `${validFrontmatter("AI-PCB油墨涨价链")}# AI-PCB油墨涨价链\n`)
    const before = await read(canonicalPath)

    const result = await runConceptGovernanceAudit({
      projectPath: tmpRoot,
      conceptRulingsPath: rulingsPath,
      reportId: "concept-audit-test",
      write: true,
      topN: 20,
    })

    expect(result.outputs).toEqual({
      json: ".llm-wiki/concept-governance/concept-audit-test.json",
      markdown: ".llm-wiki/concept-governance/concept-audit-test.md",
    })
    expect(result.counts.duplicateTitleGroups).toBeGreaterThan(0)
    expect(result.counts.configuredRules).toBe(1)
    expect(await read(canonicalPath)).toBe(before)
    expect(await read(path.join(tmpRoot, result.outputs.markdown))).toContain("Concept Governance Audit")
  })

  it("keeps ask and ingest retrieval modes explicit", async () => {
    const source = path.join(tmpRoot, "raw/研报新闻/2026-05-28-AI服务器电源.md")
    const sourceContent = await read(source)
    const candidates = await searchCandidatePages(tmpRoot, source, sourceContent, { topWiki: 5 })
    const context = await buildAskRetrievalContext({
      projectPath: tmpRoot,
      query: "AI服务器电源 最近一周",
      topWiki: 3,
      topRaw: 3,
    })

    expect(candidates.retrievalMode).toBe("ingest")
    expect(candidates.wikiCandidates.every((item) => item.retrievalMode === "ingest")).toBe(true)
    expect(context.retrievalMode).toBe("ask")
    expect(context.wikiResults.every((item) => item.retrievalMode === "ask")).toBe(true)
  })

  it("ask retrieval reads frontmatter freshness and decays stale topic pages", async () => {
    const freshTs = timestampDaysAgo(3)
    const staleTs = timestampDaysAgo(420)
    const page = (title, timestamp) => `---
schema_version: 1
title: ${title}
aliases:
  - 机器人订单进展
type: 概念
summary: 机器人订单进展页跟踪执行器、客户、出货、量产和供应商导入验证节点。
tags:
  - 机器人
  - 订单
related: []
sources: []
created: ${timestamp}
updated: ${timestamp}
last_reviewed: ${timestamp}
confidence: 中
status: 活跃
---

# ${title}

机器人订单进展、执行器客户、出货、量产和供应商导入验证节点。
`

    await write(path.join(tmpRoot, "wiki/概念/机器人订单进展-新.md"), page("机器人订单进展", freshTs))
    await write(path.join(tmpRoot, "wiki/概念/机器人订单进展-旧.md"), page("机器人订单进展", staleTs))

    const context = await buildAskRetrievalContext({
      projectPath: tmpRoot,
      query: "最新机器人订单进展 执行器客户出货和量产验证",
      sources: "wiki",
      topWiki: 8,
    })

    const paths = context.wikiResults.map((item) => item.path)
    const fresh = context.wikiResults.find((item) => item.path === "wiki/概念/机器人订单进展-新.md")
    const stale = context.wikiResults.find((item) => item.path === "wiki/概念/机器人订单进展-旧.md")
    expect(paths.indexOf("wiki/概念/机器人订单进展-新.md")).toBeLessThan(paths.indexOf("wiki/概念/机器人订单进展-旧.md"))
    expect(fresh.frontmatterUpdated).toBe(freshTs)
    expect(fresh.freshnessScore).toBeGreaterThan(0)
    expect(stale.frontmatterUpdated).toBe(staleTs)
    expect(stale.staleDays).toBeGreaterThan(365)
    expect(stale.freshnessScore).toBeLessThan(0)
  })

	  it("tokenizeQuery keeps Chinese bigrams and full phrase tokens", () => {
	    const tokens = tokenizeQuery("最近一个月 AI服务器电源 机器人方向")
	    expect(tokens).toContain("服务")
	    expect(tokens).toContain("服务器")
	    expect(tokens).toContain("电源")
	    expect(tokens).toContain("机器人")
	    expect(tokens).toContain("ai服务器电源")
	  })

	  it("ask retrieval ranks concrete pages and expands graph neighbors", async () => {
	    await write(
	      path.join(tmpRoot, "wiki/log.md"),
	      `# log\n\n${"AI服务器电源 算电协同 最近一周 ".repeat(120)}`,
	    )
	    const context = await buildAskRetrievalContext({
	      projectPath: tmpRoot,
	      query: "AI服务器电源 最近一周",
	      topWiki: 1,
	      topRaw: 3,
	      graphNeighbors: 3,
	    })

	    expect(context.wikiResults[0].path).toBe("wiki/概念/算电协同.md")
	    expect(context.wikiResults.map((item) => item.path)).not.toContain("wiki/log.md")
	    expect(context.rawResults.map((item) => item.path)).toContain("raw/研报新闻/2026-05-28-AI服务器电源.md")
	    expect(context.graphExpansions.map((item) => item.path)).toContain("wiki/概念/电力运营商重估.md")
	    expect(context.graphExpansions.find((item) => item.path === "wiki/概念/电力运营商重估.md").reasons[0]).toContain("linked from")
	    expect(context.prompt).toContain("结论、证据链、分歧/反证、后续验证、交易含义、引用来源")
	  })

  it("agentic ask runs trading agents with bounded concurrency, degrades on one failure, and writes artifacts", async () => {
    const calls = []
    const prompts = new Map()
    let active = 0
    let maxActive = 0
    const result = await askWiki({
      projectPath: tmpRoot,
      query: "AI服务器电源 最近一周如何验证",
      sources: "wiki,raw,graph",
      provider: "codex",
      agentic: true,
      agentConcurrency: 2,
      requestAgentText: async ({ stage, role, prompt, agentResults }) => {
        calls.push({ stage, role })
        prompts.set(role ?? stage, prompt)
        if (stage.startsWith("ask-agent-")) {
          active += 1
          maxActive = Math.max(maxActive, active)
          await sleep(role === "evidence-researcher" ? 20 : 5)
          active -= 1
          if (role === "counterevidence-auditor") throw new Error("auditor unavailable password=secret")
          return `# ${role}\n\n${role} 基于 [W1] 和 [R1] 输出。`
        }
        expect(stage).toBe("ask-adjudicator")
        expect(agentResults).toHaveLength(4)
        expect(agentResults.find((item) => item.role === "counterevidence-auditor").status).toBe("failed")
        return [
          "## 结论",
          "AI服务器电源仍需量价和订单验证；反证审计 agent 失败，置信度降级。",
          "## 证据链",
          "- [W1] 与 [R1] 提供基础证据。",
          "## 分歧/反证",
          "- counterevidence-auditor failed，需要人工补反证。",
          "## 后续验证",
          "- 检查订单、成交量和公告。",
          "## 交易含义",
          "- 只观察，不输出真实交易指令。",
          "## 引用来源",
          "- [W1] wiki hit",
          "- [R1] raw hit",
        ].join("\n")
      },
    })

    expect(result.answer).toContain("反证审计 agent 失败")
    expect(result.agentRun.status).toBe("ok_with_failures")
    expect(result.contextMetrics.prompt.chars).toBe(result.prompt.length)
    expect(result.contextMetrics.fullCopyAgenticApproxTokens).toBe(result.contextMetrics.prompt.approxTokens * 5)
    expect(result.agentRun.promptMetrics.totalApproxTokens).toBeLessThan(result.contextMetrics.fullCopyAgenticApproxTokens)
    expect(result.agentRun.roles.find((item) => item.role === "market-validator").promptMetrics.approxTokens).toBeGreaterThan(0)
    expect(prompts.get("market-validator")).toContain("## Market Validation")
    expect(prompts.get("market-validator")).toContain("## Stock Daily SQL Hits")
    expect(prompts.get("market-validator")).not.toContain("## Raw Hits")
    expect(prompts.get("adjudicator")).toContain("## Compiled Evidence Context")
    expect(prompts.get("adjudicator")).toContain("## Evidence Ledger")
    expect(prompts.get("adjudicator")).not.toContain("## Original Retrieval Context")
    expect(maxActive).toBeLessThanOrEqual(2)
    expect(calls.filter((call) => call.stage.startsWith("ask-agent-")).map((call) => call.role)).toEqual([
      "evidence-researcher",
      "counterevidence-auditor",
      "market-validator",
      "strategy-mapper",
    ])
    const runDir = path.join(tmpRoot, result.agentRun.artifact.relativeRunDir)
    await expect(fs.access(path.join(runDir, "manifest.json"))).resolves.toBeUndefined()
    await expect(fs.access(path.join(runDir, "agents/evidence-researcher.md"))).resolves.toBeUndefined()
    await expect(fs.access(path.join(runDir, "agents/market-validator.md"))).resolves.toBeUndefined()
    await expect(fs.access(path.join(runDir, "final.md"))).resolves.toBeUndefined()
    const manifest = JSON.parse(await read(path.join(runDir, "manifest.json")))
    expect(manifest.schema).toBe("agent-run-manifest-v1")
    expect(manifest.status).toBe("ok_with_failures")
    expect(manifest.concurrency).toBe(2)
    expect(manifest.contextMetrics.prompt.chars).toBe(result.prompt.length)
    expect(manifest.promptMetrics.totalApproxTokens).toBeLessThan(manifest.promptMetrics.fullCopyAgenticApproxTokens)
    expect(manifest.roles.find((item) => item.role === "counterevidence-auditor").error).toContain("password=[redacted]")
    expect(manifest.roles.find((item) => item.role === "counterevidence-auditor").promptMetrics.approxTokens).toBeGreaterThan(0)
    expect(JSON.stringify(manifest)).not.toContain("password=secret")
    expect(manifest.sourceRefs.wiki[0].ref).toBe("W1")
  })

  it("agentic ask can run without artifacts and fails when all parallel agents fail", async () => {
    const ok = await askWiki({
      projectPath: tmpRoot,
      query: "AI服务器电源 最近一周",
      sources: "wiki",
      provider: "codex",
      agentic: true,
      agentArtifacts: false,
      requestAgentText: async ({ stage, role }) => {
        if (stage.startsWith("ask-agent-")) return `# ${role}\n\nok`
        return "## 结论\nok\n## 证据链\nok\n## 分歧/反证\n无\n## 后续验证\n继续\n## 交易含义\n观察\n## 引用来源\n[W1]"
      },
    })
    expect(ok.agentRun.status).toBe("ok")
    expect(ok.agentRun.artifact).toBeNull()
    await expect(fs.access(path.join(tmpRoot, AGENT_RUNS_ROOT))).rejects.toThrow()

    await expect(askWiki({
      projectPath: tmpRoot,
      query: "AI服务器电源 最近一周",
      sources: "wiki",
      provider: "codex",
      agentic: true,
      agentArtifacts: false,
      requestAgentText: async ({ stage }) => {
        if (stage.startsWith("ask-agent-")) throw new Error("agent down")
        return "should not adjudicate"
      },
    })).rejects.toThrow("All agentic ask roles failed")
  })

  it("non-agentic ask show-context does not invoke agent provider or write agent artifacts", async () => {
    const context = await askWiki({
      projectPath: tmpRoot,
      query: "AI服务器电源 最近一周",
      sources: "wiki",
      provider: "codex",
      showContext: true,
      requestAgentText: async () => {
        throw new Error("agent provider should not be called")
      },
    })

    expect(context.answer).toBeNull()
    expect(context.agentRun).toBeUndefined()
    await expect(fs.access(path.join(tmpRoot, AGENT_RUNS_ROOT))).rejects.toThrow()
  })

  it("ask show-context includes active policies as read-only answer guardrails", async () => {
    await write(
      path.join(tmpRoot, "wiki/概念/AI服务器PCB.md"),
      `${validFrontmatter("AI服务器PCB")}# AI服务器PCB\n\nAI服务器 PCB 材料需要结合订单、公告和量价验证。\n`,
    )
    await write(
      path.join(tmpRoot, "data/brain/policies.jsonl"),
      `${JSON.stringify({
        schema: "trading-ai-policy-v1",
        id: "policy_ask_evidence_before_confidence",
        type: "policy",
        policyId: "policy_ask_evidence_before_confidence",
        status: "active",
        scope: "self-question.validation_policy",
        rule: "must_run_evidence_stage_before_high_confidence",
        evidenceGap: "fundamental:qcc_tender_or_order:not_checked",
        sourceProposalId: "policy_proposal_qcc",
        regressionQuestions: ["量价先行但招投标未查时，回答是否必须降低置信度？"],
        approvedAt: "2026-06-15 02:40:00",
      })}\n`,
    )

    const context = await askWiki({
      projectPath: tmpRoot,
      query: "AI服务器 PCB 材料是订单兑现还是叙事扩散",
      sources: "wiki",
      showContext: true,
    })

    expect(context.activePolicies).toHaveLength(1)
    expect(context.activePolicies[0]).toMatchObject({
      policyId: "policy_ask_evidence_before_confidence",
      rule: "must_run_evidence_stage_before_high_confidence",
      evidenceGap: "fundamental:qcc_tender_or_order:not_checked",
    })
    expect(context.counts.activePolicies).toBe(1)
    expect(context.contextMetrics.sourceCounts.activePolicies).toBe(1)
    expect(context.prompt).toContain("## Active Trading AI Policies")
    expect(context.prompt).toContain("must_run_evidence_stage_before_high_confidence")
    expect(context.prompt).toContain("量价先行但招投标未查时")
  })

  it("ask retrieval prefers concrete raw evidence over broad chat heat for physical AI questions", async () => {
    await write(
      path.join(tmpRoot, "wiki/概念/物理AI与具身智能.md"),
      `---
schema_version: 1
title: 物理AI与具身智能
aliases:
  - 物理AI
  - 具身智能
type: 概念
summary: 物理AI与具身智能页通过表头沉淀机器人方向的量产、客户、订单、出货和交易验证节点。
tags:
  - 物理AI
  - 具身智能
  - 机器人
related:
  - "[[概念/机器人产业链]]"
sources:
  - raw/openclaw数据/产业链复盘/gangtise_themes/2026-06-04/0060-复盘-机器人-126380.md
created: 2026-05-11 14:23:07
updated: 2026-05-11 14:23:07
last_reviewed: 2026-05-11 14:23:07
confidence: 中
status: 活跃
---

# 物理AI与具身智能

本页把机器人从主题热度压到客户、订单、出货和量产兑现验证。
`,
    )
    await write(
      path.join(tmpRoot, "raw/微信聊天/2026-06-05.md"),
      "# 微信聊天\n\n最近一个月物理AI投资方向，交易验证、证据、标的、机器人热度、电子通信资金扩散都有讨论，但缺少客户、订单、出货节点。",
    )
    await write(
      path.join(tmpRoot, "raw/openclaw数据/产业链复盘/gangtise_themes/2026-06-04/0060-复盘-机器人-126380.md"),
      "# 复盘-机器人\n\n具身智能和割草机器人进入订单验证阶段，客户包括九号、石头，关注出货、量产、客户节点和供应商导入。",
    )

    const context = await buildAskRetrievalContext({
      projectPath: tmpRoot,
      query: "最近一个月物理AI/具身智能/机器人方向，A股投资应该优先看哪些产业链环节和标的？请区分已有知识库反复验证的证据、仍偏叙事的环节，以及交易上要验证的量价/订单/客户节点。",
      sources: "raw",
      topRaw: 3,
    })

    expect(context.rawResults[0].path).toBe("raw/openclaw数据/产业链复盘/gangtise_themes/2026-06-04/0060-复盘-机器人-126380.md")
    expect(context.rawResults[0].structuredSourceMatch).toContain("wiki/概念/物理AI与具身智能.md")
    expect(context.rawResults.map((item) => item.path)).toContain("raw/微信聊天/2026-06-05.md")
  })

  it("ask eval scores recall, evidence coverage, raw noise, and structured fields", async () => {
    const result = await runAskEval({
      projectPath: tmpRoot,
      query: "AI服务器电源 最近一周",
      sources: "wiki,raw,graph",
      topWiki: 5,
      topRaw: 5,
      graphNeighbors: 3,
      expectedPaths: "wiki/概念/算电协同.md,raw/研报新闻/2026-05-28-AI服务器电源.md,wiki/概念/电力运营商重估.md",
    })

    expect(result.retrievalMode).toBe("ask")
    expect(result.aggregate.overall).toBeGreaterThan(0)
    expect(result.cases[0].metrics.recall).toBe(100)
    expect(result.cases[0].metrics.evidenceCoverage).toBeGreaterThan(0)
    expect(result.cases[0].metrics.structureFieldCoverage).toBeGreaterThan(0)
    expect(result.cases[0].topHits.map((item) => item.path)).toContain("wiki/概念/算电协同.md")
  })

  it("routes ask sources with rule fallback and keeps stock SQL available when columns are provided", async () => {
    const routing = await selectAskSources({
      projectPath: tmpRoot,
      query: "SZ000001 最近20个交易日涨跌幅和成交量",
      stockDailyColumns: ["ticker", "date", "open", "high", "low", "close", "pct_chg", "volume"],
    })

    expect(routing.route.mode).toBe("rules")
    expect(routing.selectedSources.map((source) => source.id)).toContain("stock_daily_sql")
    expect(routing.selectedSources.find((source) => source.id === "stock_daily_sql").columns).toMatchObject({
      ticker: "ticker",
      date: "date",
    })
  })

  it("searches facts jsonl as a native source", async () => {
    const context = await buildAskRetrievalContext({
      projectPath: tmpRoot,
      query: "高开接盘 案例",
      sources: "facts",
    })

    expect(context.selectedSources.map((source) => source.id)).toEqual(["facts_jsonl"])
    expect(context.factsResults[0].path).toContain("facts:data/facts/cases.jsonl:1")
    expect(context.factsResults[0].excerpt).toContain("高开接盘")
    expect(context.prompt).toContain("Facts JSONL Hits")
  })

  it("keeps invalidated temporal facts out of normal facts evidence by default", async () => {
    await write(
      path.join(tmpRoot, TEMPORAL_FACTS_RELATIVE_PATH),
      [
        JSON.stringify({
          id: "tf-active-msap",
          type: "temporal_fact",
          status: "active",
          subject: "三孚新科",
          predicate: "HAS_ORDER",
          object: "mSAP电镀设备订单",
          claim: "三孚新科 mSAP 订单仍是当前待验证事实。",
          validAt: "2026-05-28",
        }),
        JSON.stringify({
          id: "tf-invalid-msap",
          type: "temporal_fact",
          status: "invalidated",
          subject: "三孚新科",
          predicate: "HAS_ORDER",
          object: "旧mSAP订单传闻",
          claim: "三孚新科 mSAP 旧订单传闻已被证伪。",
          validAt: "2026-05-20",
          invalidatedAt: "2026-05-29",
        }),
      ].join("\n") + "\n",
    )

    const context = await buildAskRetrievalContext({
      projectPath: tmpRoot,
      query: "三孚新科 mSAP 订单",
      sources: "facts",
    })

    expect(context.factsResults.map((item) => item.value.id)).toContain("tf-active-msap")
    expect(context.factsResults.map((item) => item.value.id)).not.toContain("tf-invalid-msap")
    expect(context.invalidatedFactsResults).toHaveLength(0)

    const auditContext = await buildAskRetrievalContext({
      projectPath: tmpRoot,
      query: "三孚新科 mSAP 订单",
      sources: "facts",
      includeInvalidated: true,
    })
    expect(auditContext.factsResults.map((item) => item.value.id)).not.toContain("tf-invalid-msap")
    expect(auditContext.invalidatedFactsResults.map((item) => item.value.id)).toContain("tf-invalid-msap")
    expect(auditContext.invalidatedFactsResults[0].ref).toMatch(/^FH/)
  })

  it("searches brain memory as a long-term correction source", async () => {
    await write(
      path.join(tmpRoot, "data/brain/corrections.jsonl"),
      `${JSON.stringify({ id: "corr-1", type: "correction", title: "高开接盘卫语句", text: "高开接盘必须看承接，不允许把热度当作买点", tags: ["高开接盘", "L4"] })}\n`,
    )
    const context = await buildAskRetrievalContext({
      projectPath: tmpRoot,
      query: "高开接盘 最近错误",
      sources: "brain",
    })

    expect(context.selectedSources.map((source) => source.id)).toEqual(["brain_memory"])
    expect(context.brainResults[0].path).toContain("brain:data/brain/corrections.jsonl:1")
    expect(context.brainResults[0].excerpt).toContain("不允许把热度当作买点")
    expect(context.prompt).toContain("Brain Memory Hits")
  })

  it("prefers .llm-wiki graph json and preserves edge types in expansion reasons", async () => {
    await write(
      path.join(tmpRoot, ".llm-wiki/graph.json"),
      JSON.stringify(
        {
          nodes: [
            { id: "概念/算电协同", label: "算电协同", type: "概念", path: "wiki/概念/算电协同.md" },
            { id: "概念/电力运营商重估", label: "电力运营商重估", type: "概念", path: "wiki/概念/电力运营商重估.md" },
          ],
          edges: [{ source: "概念/算电协同", target: "概念/电力运营商重估", type: "graph-json-link" }],
        },
        null,
        2,
      ),
    )
    const context = await buildAskRetrievalContext({
      projectPath: tmpRoot,
      query: "AI服务器电源 最近一周",
      topWiki: 1,
      topRaw: 0,
      graphNeighbors: 3,
      sources: "wiki,graph",
    })

    const expansion = context.graphExpansions.find((item) => item.path === "wiki/概念/电力运营商重估.md")
    expect(expansion.reasons[0]).toContain("graph-json-link")
  })

  it("merges stale graph json with current frontmatter related edges", async () => {
    await write(
      path.join(tmpRoot, ".llm-wiki/graph.json"),
      JSON.stringify(
        {
          nodes: [
            { id: "概念/算电协同", label: "算电协同", type: "概念", path: "wiki/概念/算电协同.md" },
            { id: "概念/电力运营商重估", label: "电力运营商重估", type: "概念", path: "wiki/概念/电力运营商重估.md" },
          ],
          edges: [],
        },
        null,
        2,
      ),
    )
    const context = await buildAskRetrievalContext({
      projectPath: tmpRoot,
      query: "AI服务器电源 最近一周",
      topWiki: 1,
      topRaw: 0,
      graphNeighbors: 3,
      sources: "wiki,graph",
    })

    const expansion = context.graphExpansions.find((item) => item.path === "wiki/概念/电力运营商重估.md")
    expect(expansion).toBeTruthy()
    expect(expansion.reasons.join(" ")).toContain("wikilink")
  })

  it("supports bounded two-hop graph expansion for industry-chain queries", async () => {
    await write(
      path.join(tmpRoot, "wiki/概念/算电协同.md"),
      `---
schema_version: 1
title: 算电协同
aliases:
  - AI服务器电源
type: 概念
summary: 算电协同页跟踪 AI 服务器电源、数据中心供电和产业链受益方向。
tags:
  - AI电源
  - 算力
related:
  - "[[概念/电力运营商重估]]"
sources: []
created: 2026-05-11 14:23:07
updated: 2026-06-08 14:23:07
last_reviewed: 2026-06-08 14:23:07
confidence: 中
status: 活跃
---

# 算电协同

${"AI服务器电源 产业链 受益方向 数据中心供电 ".repeat(80)}
`,
    )
    await write(
      path.join(tmpRoot, "wiki/概念/电力运营商重估.md"),
      `---
schema_version: 1
title: 电力运营商重估
aliases: []
type: 概念
summary: 电力运营商重估页跟踪算力供电、电力负荷、运营商估值和下游扩展关系。
tags:
  - 电力
related:
  - "[[概念/机器人执行器]]"
sources: []
created: 2026-05-11 14:23:07
updated: 2026-06-08 14:23:07
last_reviewed: 2026-06-08 14:23:07
confidence: 中
status: 活跃
---

# 电力运营商重估

负荷增长带来估值变化。
`,
    )
    await write(
      path.join(tmpRoot, "wiki/概念/机器人执行器.md"),
      `${validFrontmatter("机器人执行器")}# 机器人执行器\n\n机器人执行器属于二跳扩展线索，需要后续证据验证。\n`,
    )

    const oneHop = await buildAskRetrievalContext({
      projectPath: tmpRoot,
      query: "AI服务器电源 产业链 机器人受益方向",
      sources: "wiki,graph",
      topWiki: 1,
      topRaw: 0,
      graphNeighbors: 5,
      graphDepth: 1,
    })
    expect(oneHop.graphExpansions.map((item) => item.path)).not.toContain("wiki/概念/机器人执行器.md")

    const autoDepth = await buildAskRetrievalContext({
      projectPath: tmpRoot,
      query: "AI服务器电源 产业链 机器人受益方向",
      sources: "wiki,graph",
      topWiki: 1,
      topRaw: 0,
      graphNeighbors: 5,
    })
    const expansion = autoDepth.graphExpansions.find((item) => item.path === "wiki/概念/机器人执行器.md")
    expect(expansion).toBeTruthy()
    expect(expansion.hop).toBe(2)
    expect(expansion.pathTrace).toEqual([
      "wiki/概念/算电协同.md",
      "wiki/概念/电力运营商重估.md",
      "wiki/概念/机器人执行器.md",
    ])
    expect(expansion.reasons.join(" ")).toContain("hop 2")
    expect(autoDepth.nativeQueries.find((item) => item.sourceId === "wiki_graph").summary).toContain("graph_depth=2")
  })

  it("builds parameterized stock daily SQL from parsed stock intent", async () => {
    const intent = parseStockDailyIntent("SZ000001 最近20个交易日涨跌幅和成交量")
    const nativeQuery = buildStockDailySqlQuery(
      intent,
      {
        columns: {
          ready: true,
          ticker: "ticker",
          date: "date",
          open: "open",
          high: "high",
          low: "low",
          close: "close",
          pctChange: "pct_chg",
          volume: "volume",
          all: ["ticker", "date", "open", "high", "low", "close", "pct_chg", "volume"],
        },
      },
      { sqlLimit: 200 },
    )

    expect(intent.tickerCandidates).toContain("SZ000001")
    expect(intent.tickerCandidates).toContain("000001.SZ")
    expect(nativeQuery.sql).toContain("where \"ticker\" = any($1::text[])")
    expect(nativeQuery.params[0]).toEqual(expect.arrayContaining(["SZ000001", "000001.SZ"]))
    expect(nativeQuery.params[1]).toBe(20)
    expect(nativeQuery.summary).not.toContain("password")
  })

  it("binds an explicit stock code to the matching name when comparative names appear", () => {
    const intent = parseStockDailyIntent("炬光科技688167是不是下一个中际旭创，最近20日量价是否承接", {
      stockCodeMapping: new Map([
        ["中际旭创", "SZ300308"],
        ["炬光科技", "SH688167"],
      ]),
    })

    expect(intent.stockCode).toBe("SH688167")
    expect(intent.stockName).toBe("炬光科技")
  })

  it("executes stock daily source through a read-only native executor hook", async () => {
    const context = await buildAskRetrievalContext({
      projectPath: tmpRoot,
      query: "利通电子 最近20个交易日是否走强，涨跌幅和成交量怎么样",
      sources: "stock-price",
      pgTable: "cn_stock_price_daily_wind",
      stockDailyColumns: ["ticker", "date", "open", "high", "low", "close", "pct_chg", "volume"],
      stockDailyExecutor: async ({ nativeQuery }) => {
        expect(nativeQuery.params[0]).toEqual(expect.arrayContaining(["SH603629", "603629.SH"]))
        return {
          rows: [
            { ticker: "SH603629", date: "2026-05-27", open: 10, high: 10.2, low: 9.8, close: 10, pct_chg: 0.5, volume: 10000 },
            { ticker: "SH603629", date: "2026-05-28", open: 10.2, high: 10.8, low: 10.1, close: 10.6, pct_chg: 6, volume: 13000 },
          ],
        }
      },
    })

    expect(context.selectedSources.map((source) => source.id)).toEqual(["stock_daily_sql"])
    expect(context.stockDaily.status).toBe("ok")
    expect(context.stockDailyResults[0].path).toBe("sql:cn_stock_price_daily_wind#SH603629/2026-05-27")
    expect(context.stockDailyResults[1].path).toBe("sql:cn_stock_price_daily_wind#SH603629/2026-05-28")
    expect(context.stockDailyResults[1].excerpt).toContain("pct_chg=6")
    expect(context.marketValidation).toMatchObject({
      sourceId: "stock_daily_sql",
      status: "ready",
      verdict: "验证通过",
      stockCode: "SH603629",
      periodReturnPct: 6,
      lastVolumeVsAvg: 1.13,
    })
    expect(context.prompt).toContain("Market Validation")
    expect(context.prompt).toContain("Stock Daily SQL Hits")
  })

  it("uses external adjusted kline cross-check when raw SQL close is distorted by ex-rights", async () => {
    await write(
      path.join(tmpRoot, ".llm-wiki/stock-codes.json"),
      `${JSON.stringify({ synced_at: "2026-06-14 21:00:00", count: 2, mapping: { 炬光科技: "SH688167", 中际旭创: "SZ300308" } }, null, 2)}\n`,
    )

    const context = await buildAskRetrievalContext({
      projectPath: tmpRoot,
      query: "炬光科技688167是不是下一个中际旭创，最近20个交易日涨跌幅和成交量是否承接",
      sources: "stock-price",
      pgTable: "cn_stock_price_daily_wind",
      stockDailyColumns: ["ticker", "date", "open", "high", "low", "close", "pct_cng", "volume", "amount", "turnover"],
      stockDailyExecutor: async () => ({
        rows: [
          { ticker: "SH688167", date: "2026-05-18", open: 508.22, high: 521.88, low: 485.11, close: 495.88, pct_cng: -3.52, volume: 6306600, amount: 3165914000, turnover: 7.02 },
          { ticker: "SH688167", date: "2026-06-12", open: 372, high: 372.6, low: 328, close: 331.88, pct_cng: -2.06, volume: 16729300, amount: 5797242000, turnover: 12.86 },
        ],
      }),
      externalMarketFetcher: async ({ source, code }) => {
        expect(source).toBe("eastmoney_kline")
        expect(code).toBe("SH688167")
        return {
          rc: 0,
          data: {
            name: "炬光科技",
            klines: [
              "2026-05-18,350.50,341.99,359.92,334.56,63066,3165913534.00,0,-3.52,0,7.02",
              "2026-06-12,372.00,331.88,372.60,328.00,167294,5797242581.00,0,-2.06,0,12.86",
            ],
          },
        }
      },
    })

    expect(context.marketValidation.stockName).toBe("炬光科技")
    expect(context.marketValidation.periodReturnPct).toBe(-2.96)
    expect(context.marketValidation.sqlPeriodReturnPct).toBe(-33.07)
    expect(context.marketValidation.externalPeriodReturnPct).toBe(-2.96)
    expect(context.marketValidation.returnSource).toBe("eastmoney_kline")
    expect(context.marketValidation.crossCheckStatus).toBe("divergent")
    expect(context.prompt).toContain("return_cross_check: sql=-33.07; external=-2.96")
    expect(context.retrievalWarnings.join(" ")).toContain("SQL与在线行情差异较大")
  })

  it("keeps SQL return when the external adjusted kline lags the SQL window", async () => {
    await write(
      path.join(tmpRoot, ".llm-wiki/stock-codes.json"),
      `${JSON.stringify({ synced_at: "2026-06-14 21:00:00", count: 1, mapping: { 炬光科技: "SH688167" } }, null, 2)}\n`,
    )

    const context = await buildAskRetrievalContext({
      projectPath: tmpRoot,
      query: "炬光科技688167最近20个交易日涨跌幅和成交量是否承接",
      sources: "stock-price",
      pgTable: "cn_stock_price_daily_wind",
      stockDailyColumns: ["ticker", "date", "open", "high", "low", "close", "pct_cng", "volume", "amount", "turnover"],
      stockDailyExecutor: async () => ({
        rows: [
          { ticker: "SH688167", date: "2026-05-18", open: 508.22, high: 521.88, low: 485.11, close: 495.88, pct_cng: -3.52, volume: 6306600, amount: 3165914000, turnover: 7.02 },
          { ticker: "SH688167", date: "2026-06-12", open: 372, high: 372.6, low: 328, close: 331.88, pct_cng: -2.06, volume: 16729300, amount: 5797242000, turnover: 12.86 },
        ],
      }),
      externalMarketFetcher: async () => ({
        rc: 0,
        data: {
          name: "炬光科技",
          klines: [
            "2026-05-18,350.50,341.99,359.92,334.56,63066,3165913534.00,0,-3.52,0,7.02",
            "2026-06-11,330.00,338.86,338.86,316.00,54497,1821667270.00,0,20.00,0,4.19",
          ],
        },
      }),
    })

    expect(context.marketValidation.periodReturnPct).toBe(-33.07)
    expect(context.marketValidation.returnSource).toBe("stock_daily_sql")
    expect(context.marketValidation.crossCheckStatus).toBe("external_stale")
    expect(context.marketValidation.externalPeriodReturnPct).toBe(-0.92)
    expect(context.retrievalWarnings.join(" ")).toContain("在线行情日期2026-06-11落后本地SQL2026-06-12")
  })

  it("cross-checks adjusted returns for agentic topic candidate stocks", async () => {
    await write(
      path.join(tmpRoot, ".llm-wiki/stock-codes.json"),
      `${JSON.stringify({ synced_at: "2026-06-14 21:00:00", count: 1, mapping: { 炬光科技: "SH688167" } }, null, 2)}\n`,
    )
    await write(
      path.join(tmpRoot, "wiki/概念/光互联CPO.md"),
      `${validFrontmatter("光互联CPO")}# 光互联CPO\n\nCPO、FAU、光纤阵列和垂直光学耦合需要验证订单兑现还是叙事扩散。炬光科技被反复提到，但必须结合近20日量价承接。\n`,
    )

    const context = await buildAskRetrievalContext({
      projectPath: tmpRoot,
      query: "光互联CPO这条线现在是订单兑现还是叙事扩散，结合近20日量价承接",
      sources: "wiki,stock-price",
      agentic: true,
      pgTable: "cn_stock_price_daily_wind",
      stockDailyColumns: ["ticker", "date", "open", "high", "low", "close", "pct_cng", "volume", "amount", "turnover"],
      stockDailyExecutor: async () => ({
        rows: [
          { ticker: "SH688167", date: "2026-05-18", open: 508.22, high: 521.88, low: 485.11, close: 495.88, pct_cng: -3.52, volume: 6306600, amount: 3165914000, turnover: 7.02 },
          { ticker: "SH688167", date: "2026-06-12", open: 372, high: 372.6, low: 328, close: 331.88, pct_cng: -2.06, volume: 16729300, amount: 5797242000, turnover: 12.86 },
        ],
      }),
      externalMarketFetcher: async ({ code }) => {
        expect(code).toBe("SH688167")
        return {
          rc: 0,
          data: {
            name: "炬光科技",
            klines: [
              "2026-05-18,350.50,341.99,359.92,334.56,63066,3165913534.00,0,-3.52,0,7.02",
              "2026-06-12,372.00,331.88,372.60,328.00,167294,5797242581.00,0,-2.06,0,12.86",
            ],
          },
        }
      },
    })

    const candidate = context.marketValidation.candidates.find((item) => item.stockCode === "SH688167")
    expect(candidate.stockName).toBe("炬光科技")
    expect(candidate.periodReturnPct).toBe(-2.96)
    expect(candidate.sqlPeriodReturnPct).toBe(-33.07)
    expect(candidate.externalPeriodReturnPct).toBe(-2.96)
    expect(candidate.returnSource).toBe("eastmoney_kline")
    expect(candidate.crossCheckStatus).toBe("divergent")
    expect(context.prompt).toContain("cross_check=divergent")
    expect(context.prompt).toContain("sql_return=-33.07")
  })

  it("runs topic candidate stock market validation for agentic theme questions", async () => {
    await write(
      path.join(tmpRoot, "wiki/概念/算电协同.md"),
      `---
schema_version: 1
title: 算电协同
aliases:
  - AI服务器电源
type: 概念
summary: AI服务器电源主题里，利通电子和三孚新科被反复用于观察订单兑现和叙事扩散。
tags:
  - AI电源
related: []
sources: []
created: 2026-05-11 14:23:07
updated: 2026-05-11 14:23:07
last_reviewed: 2026-05-11 14:23:07
confidence: 中
status: 活跃
---

# 算电协同

AI服务器电源主题需要比较利通电子、三孚新科的订单兑现、量价承接和叙事扩散。
`,
    )
    const calls = []
    const rowsFor = (code) => [
      { ticker: code, date: "2026-05-27", open: 10, high: 10.3, low: 9.8, close: 10, pct_cng: 0, volume: 10000, amount: 1000000 },
      { ticker: code, date: "2026-05-28", open: 10.2, high: 11, low: 10.1, close: code === "SH603629" ? 10.8 : 9.7, pct_cng: code === "SH603629" ? 8 : -3, volume: code === "SH603629" ? 15000 : 8000, amount: code === "SH603629" ? 1600000 : 700000 },
    ]

    const context = await buildAskRetrievalContext({
      projectPath: tmpRoot,
      query: "AI服务器电源这条线现在是订单兑现还是叙事扩散",
      sources: "wiki,stock-price",
      agentic: true,
      stockDailyColumns: ["ticker", "date", "open", "high", "low", "close", "pct_cng", "volume", "amount"],
      stockDailyExecutor: async ({ nativeQuery }) => {
        const code = nativeQuery.params[0].find((item) => /^S[HZ]/.test(item))
        calls.push(code)
        return { rows: rowsFor(code) }
      },
    })

    expect(calls).toEqual(expect.arrayContaining(["SH603629", "SH688359"]))
    expect(context.stockDaily.status).toBe("skipped")
    expect(context.topicStockDaily.status).toBe("ready")
    expect(context.counts.sqlRows).toBe(4)
    expect(context.marketValidation).toMatchObject({
      sourceId: "stock_daily_sql",
      scope: "topic",
      status: "ready",
      candidateCount: 2,
      rowCount: 4,
    })
    expect(context.marketValidation.candidates.map((item) => item.stockName)).toEqual(expect.arrayContaining(["利通电子", "三孚新科"]))
    expect(context.stockDailyResults.map((item) => item.type)).toContain("SQL_TOPIC_VALIDATION")
    expect(context.prompt).toContain("### Candidate Stocks")
    expect(context.prompt).toContain("利通电子 SH603629")
    expect(context.nativeQueries.find((item) => item.sourceId === "stock_daily_sql").summary).toContain("topic candidates")
  })

  it("builds segmented topic market validation pools for optical fiber subchains", async () => {
    await write(
      path.join(tmpRoot, ".llm-wiki/stock-codes.json"),
      `${JSON.stringify({
        synced_at: "2026-06-14 10:00:00",
        count: 7,
        mapping: {
          光纤股份: "SH600001",
          连接精密: "SZ300002",
          跳线科技: "SZ300003",
          光阵列: "SH688004",
          特纤材料: "SZ300005",
          光模块龙头: "SZ300006",
          申万宏源: "SZ000166",
        },
      }, null, 2)}\n`,
    )
    await write(
      path.join(tmpRoot, "wiki/概念/数据中心光纤光缆.md"),
      `${validFrontmatter("数据中心光纤光缆")}# 数据中心光纤光缆\n\n光纤光缆和光缆用量需要单独验证，光纤股份跟踪数据中心东西向流量带来的订单兑现。\n`,
    )
    await write(
      path.join(tmpRoot, "wiki/概念/MPO连接器.md"),
      `${validFrontmatter("MPO连接器")}# MPO连接器\n\nMPO/MTP连接器和MT插芯在高密数据中心布线中重要，连接精密用于验证连接器订单承接。\n`,
    )
    await write(
      path.join(tmpRoot, "wiki/概念/高密跳线.md"),
      `${validFrontmatter("高密跳线")}# 高密跳线\n\n高密跳线、光纤跳线和线缆组件是机柜侧验证对象，跳线科技用于观察跳线交付。\n`,
    )
    await write(
      path.join(tmpRoot, "wiki/概念/FAU光纤阵列.md"),
      `${validFrontmatter("FAU光纤阵列")}# FAU光纤阵列\n\nFAU、光纤阵列和硅光耦合需要与光模块成品分开，光阵列用于验证 FAU 订单兑现。\n`,
    )
    await write(
      path.join(tmpRoot, "wiki/概念/特种光纤.md"),
      `${validFrontmatter("特种光纤")}# 特种光纤\n\n特种光纤、保偏光纤和空芯光纤是差异化环节，特纤材料用于跟踪特种光纤叙事扩散。\n`,
    )
    await write(
      path.join(tmpRoot, "wiki/概念/光模块成品链.md"),
      `${validFrontmatter("光模块成品链")}# 光模块成品链\n\n800G光模块成品链热度很高，光模块龙头反复出现在 AI 硬件叙事中，但这里只代表成品链热度，并非本轮需要拆开的上游细分部件验证对象。\n`,
    )
    await write(
      path.join(tmpRoot, "wiki/概念/泛光模块噪声.md"),
      `${validFrontmatter("泛光模块噪声")}# 泛光模块噪声\n\n光模块龙头在一篇泛 AI 硬件叙事里同时被贴上光纤光缆、MPO/MTP连接器、高密跳线、FAU和特种光纤标签，但该页面没有拆分订单证据。\n`,
    )
    await write(
      path.join(tmpRoot, "raw/研报新闻/2026-06-14-申万宏源高密跳线点评.md"),
      "# 申万宏源高密跳线点评\n\n申万宏源作为研报来源提到高密跳线和光纤跳线，但它不是本轮光互联产业链候选标的。\n",
    )
    const calls = []
    const rowsFor = (code) => [
      { ticker: code, date: "2026-06-01", open: 10, high: 10.4, low: 9.9, close: 10, pct_cng: 0, volume: 10000, amount: 1000000 },
      { ticker: code, date: "2026-06-02", open: 10.1, high: 10.9, low: 10, close: code === "SZ300005" ? 9.8 : 10.8, pct_cng: code === "SZ300005" ? -2 : 8, volume: 14000, amount: 1500000 },
    ]

    const context = await buildAskRetrievalContext({
      projectPath: tmpRoot,
      query: "未来三年数据中心对光纤光缆、MPO/MTP连接器、跳线、FAU和特种光纤的带动，哪些环节订单兑现，哪些只是叙事扩散？",
      sources: "wiki,stock-price",
      agentic: true,
      topWiki: 12,
      topicSegmentStockLimit: 1,
      stockDailyColumns: ["ticker", "date", "open", "high", "low", "close", "pct_cng", "volume", "amount"],
      stockDailyExecutor: async ({ nativeQuery }) => {
        const code = nativeQuery.params[0].find((item) => /^S[HZ]/.test(item))
        calls.push(code)
        return { rows: rowsFor(code) }
      },
    })

    expect(calls).toEqual(expect.arrayContaining(["SH600001", "SZ300002", "SZ300003", "SH688004", "SZ300005"]))
    expect(calls).not.toContain("SZ300006")
    expect(calls).not.toContain("SZ000166")
    expect(context.topicStockDaily.segmentMode).toBe("segmented")
    expect(context.marketValidation).toMatchObject({
      sourceId: "stock_daily_sql",
      scope: "topic-segmented",
      status: "ready",
      segmentCount: 5,
      candidateCount: 5,
      rowCount: 10,
    })
    expect(context.marketValidation.segmentPools.map((pool) => pool.label)).toEqual([
      "光纤光缆",
      "MPO/MTP连接器",
      "高密跳线",
      "FAU/光纤阵列",
      "特种光纤",
    ])
    expect(context.marketValidation.segmentPools.map((pool) => pool.candidates[0]?.stockName)).toEqual([
      "光纤股份",
      "连接精密",
      "跳线科技",
      "光阵列",
      "特纤材料",
    ])
    expect(context.marketValidation.candidates.map((item) => item.stockName)).not.toContain("光模块龙头")
    expect(context.marketValidation.segmentPools.flatMap((pool) => pool.excludedCandidates ?? []).map((item) => item.stockName)).toContain("光模块龙头")
    expect(context.stockDailyResults.find((item) => item.title.includes("光纤股份"))?.excerpt).toContain("segments=光纤光缆")
    expect(context.prompt).toContain("### Segment Candidate Pools")
    expect(context.prompt).toContain("excluded 光模块龙头 SZ300006")
    expect(context.prompt).toContain("MPO/MTP连接器")
    expect(context.prompt).toContain("segments=特种光纤")
  })

  it("falls back to flat topic validation when a requested segment theme is not configured", async () => {
    await write(
      path.join(tmpRoot, ".llm-wiki/stock-codes.json"),
      `${JSON.stringify({
        synced_at: "2026-06-14 11:00:00",
        count: 2,
        mapping: {
          英维克: "SZ002837",
          高澜股份: "SZ300499",
        },
      }, null, 2)}\n`,
    )
    await write(
      path.join(tmpRoot, "wiki/概念/AI液冷产业链.md"),
      `${validFrontmatter("AI液冷产业链")}# AI液冷产业链\n\nAI液冷产业链各环节需要区分冷板、CDU、泵阀和冷却液。英维克和高澜股份都被用于观察订单兑现和叙事扩散。\n`,
    )
    const calls = []

    const context = await buildAskRetrievalContext({
      projectPath: tmpRoot,
      query: "AI液冷产业链各环节现在是订单兑现还是叙事扩散？",
      sources: "wiki,stock-price",
      agentic: true,
      stockDailyColumns: ["ticker", "date", "open", "high", "low", "close", "pct_cng", "volume", "amount"],
      stockDailyExecutor: async ({ nativeQuery }) => {
        const code = nativeQuery.params[0].find((item) => /^S[HZ]/.test(item))
        calls.push(code)
        return {
          rows: [
            { ticker: code, date: "2026-06-01", open: 10, high: 10.2, low: 9.8, close: 10, pct_cng: 0, volume: 10000, amount: 1000000 },
            { ticker: code, date: "2026-06-02", open: 10, high: 10.7, low: 9.9, close: 10.5, pct_cng: 5, volume: 13000, amount: 1400000 },
          ],
        }
      },
    })

    expect(calls).toEqual(expect.arrayContaining(["SZ002837", "SZ300499"]))
    expect(context.topicStockDaily.segmentMode).toBe("flat")
    expect(context.topicStockDaily.segmentConfigStatus).toBe("unconfigured")
    expect(context.topicStockDaily.segmentConfigWarning).toContain("未配置细分环节")
    expect(context.marketValidation).toMatchObject({
      scope: "topic",
      segmentConfigStatus: "unconfigured",
      segmentConfigWarning: "未配置细分环节；已回退到普通主题候选池",
      candidateCount: 2,
      rowCount: 4,
    })
    expect(context.retrievalWarnings).toContain("未配置细分环节；已回退到普通主题候选池")
    expect(context.prompt).toContain("segment_config: unconfigured")
    expect(context.prompt).toContain("segment_config_warning: 未配置细分环节")
    expect(context.prompt).not.toContain("### Segment Candidate Pools")
  })

  it("uses built-in PCB segment registry for broad PCB investment questions", async () => {
    await write(
      path.join(tmpRoot, ".llm-wiki/stock-codes.json"),
      `${JSON.stringify({
        synced_at: "2026-06-14 11:20:00",
        count: 3,
        mapping: {
          胜宏科技: "SZ300476",
          生益科技: "SH600183",
          铜冠铜箔: "SZ301217",
        },
      }, null, 2)}\n`,
    )
    await write(
      path.join(tmpRoot, "wiki/概念/AI高速PCB.md"),
      `${validFrontmatter("AI高速PCB")}# AI高速PCB\n\n高速多层PCB和高速板环节跟踪胜宏科技，关注 AI 服务器订单兑现和 ASP 提升。\n`,
    )
    await write(
      path.join(tmpRoot, "wiki/概念/AI高速覆铜板.md"),
      `${validFrontmatter("AI高速覆铜板")}# AI高速覆铜板\n\n高速覆铜板、CCL 和低损耗覆铜板环节跟踪生益科技，关注材料涨价和客户认证。\n`,
    )
    await write(
      path.join(tmpRoot, "wiki/概念/HVLP铜箔.md"),
      `${validFrontmatter("HVLP铜箔")}# HVLP铜箔\n\nHVLP铜箔和极低轮廓铜箔环节跟踪铜冠铜箔，关注高频高速板材料升级。\n`,
    )
    const calls = []

    const context = await buildAskRetrievalContext({
      projectPath: tmpRoot,
      query: "PCB有什么细分有投资价值？请按各环节判断订单兑现还是叙事扩散。",
      sources: "wiki,stock-price",
      agentic: true,
      topWiki: 8,
      topicSegmentStockLimit: 1,
      stockDailyColumns: ["ticker", "date", "open", "high", "low", "close", "pct_cng", "volume", "amount"],
      stockDailyExecutor: async ({ nativeQuery }) => {
        const code = nativeQuery.params[0].find((item) => /^S[HZ]/.test(item))
        calls.push(code)
        return {
          rows: [
            { ticker: code, date: "2026-06-01", open: 10, high: 10.2, low: 9.8, close: 10, pct_cng: 0, volume: 10000, amount: 1000000 },
            { ticker: code, date: "2026-06-02", open: 10, high: 10.7, low: 9.9, close: 10.5, pct_cng: 5, volume: 13000, amount: 1400000 },
          ],
        }
      },
    })

    expect(calls).toEqual(expect.arrayContaining(["SZ300476", "SH600183", "SZ301217"]))
    expect(context.topicStockDaily.segmentMode).toBe("segmented")
    expect(context.topicStockDaily.theme).toEqual({ id: "pcb-chain", label: "PCB产业链" })
    expect(context.marketValidation).toMatchObject({
      scope: "topic-segmented",
      theme: { id: "pcb-chain", label: "PCB产业链" },
      segmentConfigStatus: "configured",
      segmentCount: 11,
      representedSegmentCount: 3,
      candidateCount: 3,
      rowCount: 6,
    })
    expect(context.marketValidation.missingSegments).toEqual(expect.arrayContaining(["HDI", "服务器背板", "ABF/BT载板", "低Dk-Df树脂"]))
    expect(context.marketValidation.segmentPools.find((pool) => pool.label === "高速多层PCB")?.candidates[0]?.stockName).toBe("胜宏科技")
    expect(context.marketValidation.segmentPools.find((pool) => pool.label === "高速覆铜板CCL")?.candidates[0]?.stockName).toBe("生益科技")
    expect(context.marketValidation.segmentPools.find((pool) => pool.label === "HVLP铜箔")?.candidates[0]?.stockName).toBe("铜冠铜箔")
    expect(context.prompt).toContain("theme: PCB产业链 (pcb-chain)")
    expect(context.prompt).toContain("missing_segments")
  })

  it("loads project topic segment registry for new themes without code changes", async () => {
    await write(
      path.join(tmpRoot, ".llm-wiki/stock-codes.json"),
      `${JSON.stringify({
        synced_at: "2026-06-14 11:30:00",
        count: 2,
        mapping: {
          胜宏科技: "SZ300476",
          生益科技: "SH600183",
        },
      }, null, 2)}\n`,
    )
    await write(
      path.join(tmpRoot, ".llm-wiki/theme-segments.json"),
      `${JSON.stringify({
        schema: "topic-market-segment-registry-v1",
        themes: [
          {
            id: "pcb-chain",
            label: "PCB产业链",
            keywords: ["PCB", "覆铜板", "铜箔", "玻纤布"],
            segments: [
              { id: "pcb-board", label: "PCB厂", keywords: ["PCB厂", "板厂"] },
              { id: "ccl", label: "覆铜板", keywords: ["覆铜板", "CCL"] },
            ],
          },
        ],
      }, null, 2)}\n`,
    )
    await write(
      path.join(tmpRoot, "wiki/概念/AI-PCB板厂.md"),
      `${validFrontmatter("AI-PCB板厂")}# AI-PCB板厂\n\nPCB厂和板厂环节跟踪胜宏科技，重点观察 AI 服务器订单兑现。\n`,
    )
    await write(
      path.join(tmpRoot, "wiki/概念/AI-覆铜板.md"),
      `${validFrontmatter("AI-覆铜板")}# AI-覆铜板\n\n覆铜板和 CCL 环节跟踪生益科技，重点观察材料涨价和订单承接。\n`,
    )
    const calls = []

    const context = await buildAskRetrievalContext({
      projectPath: tmpRoot,
      query: "AI PCB产业链各环节现在是订单兑现还是叙事扩散？",
      sources: "wiki,stock-price",
      agentic: true,
      topWiki: 8,
      topicSegmentStockLimit: 1,
      stockDailyColumns: ["ticker", "date", "open", "high", "low", "close", "pct_cng", "volume", "amount"],
      stockDailyExecutor: async ({ nativeQuery }) => {
        const code = nativeQuery.params[0].find((item) => /^S[HZ]/.test(item))
        calls.push(code)
        return {
          rows: [
            { ticker: code, date: "2026-06-01", open: 10, high: 10.2, low: 9.8, close: 10, pct_cng: 0, volume: 10000, amount: 1000000 },
            { ticker: code, date: "2026-06-02", open: 10, high: 10.7, low: 9.9, close: 10.5, pct_cng: 5, volume: 13000, amount: 1400000 },
          ],
        }
      },
    })

    expect(calls).toEqual(expect.arrayContaining(["SZ300476", "SH600183"]))
    expect(context.topicStockDaily.segmentMode).toBe("segmented")
    expect(context.topicStockDaily.theme).toEqual({ id: "pcb-chain", label: "PCB产业链" })
    expect(context.marketValidation).toMatchObject({
      scope: "topic-segmented",
      theme: { id: "pcb-chain", label: "PCB产业链" },
      segmentConfigStatus: "configured",
      segmentCount: 2,
      representedSegmentCount: 2,
      candidateCount: 2,
      rowCount: 4,
    })
    expect(context.marketValidation.segmentPools.map((pool) => pool.label)).toEqual(["PCB厂", "覆铜板"])
    expect(context.marketValidation.segmentPools.map((pool) => pool.candidates[0]?.stockName)).toEqual(["胜宏科技", "生益科技"])
    expect(context.prompt).toContain("theme: PCB产业链 (pcb-chain)")
    expect(context.prompt).toContain("### Segment Candidate Pools")
  })

  it("redacts stock SQL password from source registry diagnostics", async () => {
    const context = await buildAskRetrievalContext({
      projectPath: tmpRoot,
      query: "SZ000001 最近20个交易日涨跌幅",
      sources: "stock-price",
      pgPassword: "super-secret-test-password",
      stockDailyColumns: ["ticker", "date", "close"],
      stockDailyExecutor: async () => ({ rows: [] }),
    })

    const serialized = JSON.stringify({
      selectedSources: context.selectedSources,
      nativeQueries: context.nativeQueries,
      retrievalWarnings: context.retrievalWarnings,
      marketValidation: context.marketValidation,
    })
    expect(serialized).toContain("[redacted]")
    expect(serialized).not.toContain("super-secret-test-password")
  })

  it("loads stock SQL credentials from PG_SHIHAO_CONFIG_PATH without leaking the password", async () => {
    const configPath = path.join(tmpRoot, "pg-shihao-config.json")
    await write(
      configPath,
      JSON.stringify({
        host: "db.local",
        port: 5432,
        user: "reader",
        password: "file-secret-test-password",
        database: "non_stock_db",
        schema: "non_stock_schema",
        table: "non_stock_table",
      }),
    )

    const previous = process.env.PG_SHIHAO_CONFIG_PATH
    const previousPassword = process.env.PG_SHIHAO_PASSWORD
    process.env.PG_SHIHAO_CONFIG_PATH = configPath
    delete process.env.PG_SHIHAO_PASSWORD
    try {
      const context = await buildAskRetrievalContext({
        projectPath: tmpRoot,
        query: "SZ000001 最近20个交易日涨跌幅",
        sources: "stock-price",
        stockDailyColumns: ["ticker", "date", "close"],
        stockDailyExecutor: async () => ({ rows: [] }),
      })

      const serialized = JSON.stringify({
        selectedSources: context.selectedSources,
        nativeQueries: context.nativeQueries,
        retrievalWarnings: context.retrievalWarnings,
        marketValidation: context.marketValidation,
      })
      expect(serialized).toContain("[redacted]")
      expect(serialized).toContain("cn_stock_db")
      expect(serialized).toContain("cn_stock_price_daily_wind")
      expect(serialized).not.toContain("non_stock_db")
      expect(serialized).not.toContain("non_stock_table")
      expect(serialized).not.toContain("file-secret-test-password")
    } finally {
      if (previous === undefined) delete process.env.PG_SHIHAO_CONFIG_PATH
      else process.env.PG_SHIHAO_CONFIG_PATH = previous
      if (previousPassword === undefined) delete process.env.PG_SHIHAO_PASSWORD
      else process.env.PG_SHIHAO_PASSWORD = previousPassword
    }
  })

  it("does not synthesize public stock SQL connection defaults when local config is missing", async () => {
    const saved = {
      PG_SHIHAO_CONFIG_PATH: process.env.PG_SHIHAO_CONFIG_PATH,
      PG_SHIHAO_HOST: process.env.PG_SHIHAO_HOST,
      PG_SHIHAO_PORT: process.env.PG_SHIHAO_PORT,
      PG_SHIHAO_USER: process.env.PG_SHIHAO_USER,
      PG_SHIHAO_PASSWORD: process.env.PG_SHIHAO_PASSWORD,
      PG_SHIHAO_DATABASE: process.env.PG_SHIHAO_DATABASE,
      PG_SHIHAO_SCHEMA: process.env.PG_SHIHAO_SCHEMA,
      PG_SHIHAO_STOCK_DAILY_TABLE: process.env.PG_SHIHAO_STOCK_DAILY_TABLE,
    }
    for (const key of Object.keys(saved)) delete process.env[key]
    try {
      const context = await buildAskRetrievalContext({
        projectPath: tmpRoot,
        query: "SZ000001 最近20个交易日涨跌幅",
        sources: "stock-price",
      })

      const serialized = JSON.stringify({
        selectedSources: context.selectedSources,
        nativeQueries: context.nativeQueries,
        retrievalWarnings: context.retrievalWarnings,
        sourceRegistry: context.sourceRegistry,
        marketValidation: context.marketValidation,
      })
      expect(serialized).toContain("PG_SHIHAO_HOST")
      expect(serialized).toContain("PG_SHIHAO_PORT")
      const stockSource = context.selectedSources.find((source) => source.id === "stock_daily_sql")
      expect(stockSource.config.host).toBeUndefined()
      expect(stockSource.config.port).toBeUndefined()
      expect(stockSource.config.user).toBeUndefined()
      expect(stockSource.config.database).toBe("cn_stock_db")
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }
  })

  it("builds Qichacha OpenAPI tokens without exposing the secret", () => {
    const token = buildQccOpenApiToken({
      key: "AppKey",
      timespan: "1700000000",
      secretKey: "SecretKey",
    })

    expect(token).toBe("02F36A764260A1E063F4CF3F9B13B3E4")
    expect(token).not.toContain("SecretKey")
  })

  it("redacts common secret-bearing fields from safe error messages", () => {
    const message = safeErrorMessage(
      new Error("failed password=pw123 token=tok123 api_key=ak123 secretKey=sk123 access_secret=as123"),
    )

    expect(message).toContain("password=[redacted]")
    expect(message).toContain("token=[redacted]")
    expect(message).toContain("api_key=[redacted]")
    expect(message).toContain("secretKey=[redacted]")
    expect(message).toContain("access_secret=[redacted]")
    expect(message).not.toContain("pw123")
    expect(message).not.toContain("tok123")
    expect(message).not.toContain("ak123")
    expect(message).not.toContain("sk123")
    expect(message).not.toContain("as123")
  })

  it("reports external data source credential status without leaking credentials", async () => {
    const status = await runDataSource({
      action: "status",
      qccKey: "fake-qcc-key",
      qccSecretKey: "fake-qcc-secret",
      cninfoAccessKey: "fake-cninfo-key",
      cninfoAccessSecret: "fake-cninfo-secret",
      tushareToken: "fake-tushare-token",
    })

    const serialized = JSON.stringify(status)
    expect(status.providers.qichacha).toMatchObject({ configured: true, auth: "env_or_option" })
    expect(status.providers.cninfoDataservice).toMatchObject({ configured: true, auth: "env_or_option" })
    expect(status.providers.tushare).toMatchObject({ configured: true, auth: "env_or_option" })
    expect(serialized).not.toContain("fake-qcc-key")
    expect(serialized).not.toContain("fake-qcc-secret")
    expect(serialized).not.toContain("fake-cninfo-secret")
    expect(serialized).not.toContain("fake-tushare-token")
  })

  it("normalizes Qichacha tender search results for order-validation evidence", async () => {
    const result = await runDataSource({
      action: "qcc-tenders",
      keyword: "数据中心 MPO 光纤",
      qccKey: "fake-qcc-key",
      qccSecretKey: "fake-qcc-secret",
      pubDateStart: "2026-01-01",
      msgType: "4",
      qccTenderClient: async ({ credentials, keyword, pubDateStart, msgType }) => {
        expect(credentials.qccKey).toBe("fake-qcc-key")
        expect(credentials.qccSecretKey).toBe("fake-qcc-secret")
        expect(keyword).toBe("数据中心 MPO 光纤")
        expect(pubDateStart).toBe("2026-01-01")
        expect(msgType).toBe("4")
        return {
          Status: "200",
          Message: "查询成功",
          Result: {
            VerifyResult: 1,
            Data: [
              {
                Id: "tender-1",
                Title: "AI 数据中心 MPO 跳线采购项目",
                ProjectNo: "AI-MPO-001",
                ChannelName: "中标公告",
                Province: "广东省",
                City: "深圳市",
                IndustryDesc: "货物采购",
                BudgetAmt: "300.0万元",
                PublishDate: "2026-06-01",
                OpenDate: "2026-06-05 10:00",
                BidInviUnitList: [{ Name: "某云计算有限公司", Contact: "张三", TelNo: "13800000000" }],
                WinBidUnitList: [{ Name: "某光通信股份有限公司", WinBidAmt: "268.0万元", Contact: "李四", TelNo: "13900000000" }],
                AgentUnitList: [{ Name: "某招标代理有限公司", TelNo: "13700000000" }],
                BidProgressList: ["中标公告"],
                ContentUrl: "https://example.com/tender-1",
              },
            ],
          },
        }
      },
    })

    const serialized = JSON.stringify(result)
    expect(result).toMatchObject({
      schema: "external-qcc-tenders-v1",
      provider: "qichacha",
      api: "TenderCheck/GetList",
      status: "200",
      count: 1,
    })
    expect(result.rows[0]).toMatchObject({
      id: "tender-1",
      title: "AI 数据中心 MPO 跳线采购项目",
      projectNo: "AI-MPO-001",
      budgetAmount: "300.0万元",
      publishDate: "2026-06-01",
      purchaserUnits: [{ name: "某云计算有限公司", keyNo: null, amount: null }],
      winnerUnits: [{ name: "某光通信股份有限公司", keyNo: null, amount: "268.0万元" }],
    })
    expect(serialized).not.toContain("fake-qcc-secret")
    expect(serialized).not.toContain("13800000000")
    expect(serialized).not.toContain("张三")
  })
		})

describe("MPA brain memory and validation", () => {
  it("remembers, reports, and resolves brain memory explicitly", async () => {
    const remembered = await rememberBrainMemory({
      projectPath: tmpRoot,
      type: "correction",
      text: "高开接盘必须先看承接",
      title: "高开接盘纠错",
      tags: "高开接盘,L4",
    })
    expect(remembered.relativePath).toBe("data/brain/corrections.jsonl")
    expect(remembered.record.id).toContain("brain_correction_")

    const status = await getBrainStatus({ projectPath: tmpRoot })
    expect(status.total).toBe(1)
    expect(status.byType.correction).toBe(1)

    const resolved = await resolveBrainMemory({
      projectPath: tmpRoot,
      id: remembered.record.id,
      result: "failure",
      note: "盘面反向验证",
    })
    expect(resolved.relativePath).toBe("data/brain/self_training_events.jsonl")
    expect(resolved.record).toMatchObject({
      eventType: "manual-resolution",
      targetId: remembered.record.id,
      result: "failure",
      verdict: "验证失败",
    })
  })

  it("self-question dry-run emits structured questions without writing brain files", async () => {
    await write(
      path.join(tmpRoot, "wiki/股票/风华高科.md"),
      `${validFrontmatter("风华高科", "股票", "code: SZ000636\n")}# 风华高科\n\nMLCC、被动元件、AI服务器价值量提升。\n`,
    )
    await write(
      path.join(tmpRoot, "raw/研报新闻/2026-06-14-MLCC.md"),
      "AI服务器带动MLCC、被动元件、陶瓷粉体和离型膜需求，需要结合涨价、订单和量价验证。",
    )

    const result = await runSelfQuestion({
      projectPath: tmpRoot,
      questionCount: 1,
      marketValidate: "off",
      selfQuestionPlanner: async () => ({
        questions: [
          {
            questionType: "expected_difference",
            themeId: "passive-components",
            branch: "MLCC/被动元件链",
            question: "未来三个月 AI服务器 对 MLCC/被动元件链的拉动，是订单兑现还是叙事扩散？请用量价、公告、订单和财报闭环验证。",
            expectedMove: "bullish",
            stockCodes: ["SZ000636"],
            reason: "MLCC 在近期原始材料中反复出现，需要形成可验证问题。",
          },
        ],
      }),
      stockDailyColumns: ["ticker", "date", "close", "amount", "pct_cng"],
      stockDailyExecutor: async () => ({
        rows: [
          { ticker: "SZ000636", date: "2026-06-10", close: 20, amount: 1000, pct_cng: 1 },
          { ticker: "SZ000636", date: "2026-06-11", close: 22, amount: 1800, pct_cng: 10 },
        ],
      }),
    })

    expect(result.dryRun).toBe(true)
    expect(result.questions).toHaveLength(1)
    expect(result.questions[0]).toMatchObject({
      schema: "self-question-v1",
      type: "question",
      kind: "self-question",
      segment: "MLCC/被动元件链",
      validationWindows: ["1d", "3d", "5d", "10d", "20d"],
      status: "planned",
    })
    expect(result.questions[0].marketSignals).toContain("volume_price_confirmed")
    expect(result.questions[0].fundamentalSignals).toContain("qcc_tender_or_order")
    expect(result.questions[0].disconfirmIf).toContain("price_only_without_fundamental_confirmation")
    expect(result.writeResult).toBeNull()
    await expect(fs.access(path.join(tmpRoot, "data/brain/questions.jsonl"))).rejects.toThrow()
    await expect(fs.access(path.join(tmpRoot, "wiki/查询"))).rejects.toThrow()
  })

  it("self-question planner receives active policy context without changing write boundaries", async () => {
    await write(
      path.join(tmpRoot, "wiki/股票/生益科技.md"),
      `${validFrontmatter("生益科技", "股票", "code: SH600183\n")}# 生益科技\n\nPCB、覆铜板、CCL、AI服务器高速板材料验证。\n`,
    )
    await write(path.join(tmpRoot, "raw/研报新闻/2026-06-14-PCB.md"), "PCB材料需要公告、招投标和财报补证。")
    await write(
      path.join(tmpRoot, "data/brain/policies.jsonl"),
      `${JSON.stringify({
        schema: "trading-ai-policy-v1",
        id: "policy_active_cninfo_before_confidence",
        type: "policy",
        policyId: "policy_active_cninfo_before_confidence",
        status: "active",
        scope: "self-question.validation_policy",
        rule: "must_run_evidence_stage_before_high_confidence",
        trigger: "price_only attribution with cninfo gap",
        evidenceGap: "fundamental:cninfo_announcement:not_checked",
        sourceProposalId: "policy_proposal_cninfo",
        regressionQuestions: ["如果量价先行但公告未查，下一轮问题必须先要求公告补证吗？"],
        approvedAt: "2026-06-15 02:30:00",
      })}\n`,
    )

    let plannerContext = null
    const result = await runSelfQuestion({
      projectPath: tmpRoot,
      questionCount: 1,
      marketValidate: "off",
      selfQuestionPlanner: async (context) => {
        plannerContext = context
        return {
          questions: [
            {
              questionType: "expected_difference",
              themeId: "ai-pcb-materials",
              branch: "PCB材料/工艺链",
              question: "未来三个月 AI服务器 PCB材料/工艺链里，CCL是否已经从量价先行进入公告和订单兑现？",
              expectedMove: "bullish",
              stockCodes: ["SH600183"],
            },
          ],
        }
      },
      stockDailyColumns: ["ticker", "date", "close", "amount", "pct_cng"],
      stockDailyExecutor: async () => ({
        rows: [{ ticker: "SH600183", date: "2026-06-11", close: 33, amount: 3600, pct_cng: 4.2 }],
      }),
    })

    expect(plannerContext.activePolicies).toHaveLength(1)
    expect(plannerContext.activePolicies[0]).toMatchObject({
      policyId: "policy_active_cninfo_before_confidence",
      rule: "must_run_evidence_stage_before_high_confidence",
      evidenceGap: "fundamental:cninfo_announcement:not_checked",
    })
    expect(plannerContext.prompt).toContain("Active trading AI policies")
    expect(plannerContext.prompt).toContain("must_run_evidence_stage_before_high_confidence")
    expect(result.planner.activePolicyCount).toBe(1)
    expect(result.planner.activePolicies[0].policyId).toBe("policy_active_cninfo_before_confidence")
    expect(result.writeResult).toBeNull()
    await expect(fs.access(path.join(tmpRoot, "data/brain/questions.jsonl"))).rejects.toThrow()
  })

  it("self-question write filters duplicate questions and appends only questions.jsonl", async () => {
    await write(
      path.join(tmpRoot, "wiki/股票/风华高科.md"),
      `${validFrontmatter("风华高科", "股票", "code: SZ000636\n")}# 风华高科\n\nMLCC、被动元件、AI服务器价值量提升。\n`,
    )
    await write(
      path.join(tmpRoot, "wiki/股票/生益科技.md"),
      `${validFrontmatter("生益科技", "股票", "code: SH600183\n")}# 生益科技\n\nPCB、覆铜板、CCL、AI服务器高速板材料验证。\n`,
    )
    await write(path.join(tmpRoot, "raw/研报新闻/2026-06-14-PCB.md"), "PCB、CCL、覆铜板、MLCC 都是AI硬件上游验证方向。")
    const priorQuestion = "未来三个月 AI服务器 对 MLCC/被动元件链的拉动，是订单兑现还是叙事扩散？请用量价、公告、订单和财报闭环验证。"
    await write(
      path.join(tmpRoot, "data/brain/questions.jsonl"),
      `${JSON.stringify({
        schema: "self-question-v1",
        id: "selfq-old",
        type: "question",
        kind: "self-question",
        branch: "MLCC/被动元件链",
        questionType: "expected_difference",
        question: priorQuestion,
        createdAt: "2026-06-14 08:30:00",
      })}\n`,
    )
    const wikiBefore = await read(path.join(tmpRoot, "wiki/股票/风华高科.md"))
    const rawBefore = await read(path.join(tmpRoot, "raw/研报新闻/2026-06-14-PCB.md"))

    const result = await runSelfQuestion({
      projectPath: tmpRoot,
      questionCount: 1,
      write: true,
      marketValidate: "off",
      selfQuestionPlanner: async () => ({
        questions: [
          {
            questionType: "expected_difference",
            themeId: "passive-components",
            branch: "MLCC/被动元件链",
            question: priorQuestion,
            expectedMove: "bullish",
            stockCodes: ["SZ000636"],
          },
          {
            questionType: "bottleneck_supplier",
            themeId: "ai-pcb-materials",
            branch: "PCB材料/工艺链",
            question: "未来三个月 AI服务器 PCB材料/工艺链里，CCL和高速板材料谁更可能率先兑现订单和毛利率？请用量价、公告、招投标和财报闭环验证。",
            expectedMove: "bullish",
            stockCodes: ["SH600183"],
          },
        ],
      }),
      stockDailyColumns: ["ticker", "date", "close", "amount", "pct_cng"],
      stockDailyExecutor: async () => ({
        rows: [
          { ticker: "SH600183", date: "2026-06-10", close: 30, amount: 2000, pct_cng: 2 },
          { ticker: "SH600183", date: "2026-06-11", close: 33, amount: 3600, pct_cng: 10 },
          { ticker: "SZ000636", date: "2026-06-10", close: 20, amount: 1000, pct_cng: 1 },
        ],
      }),
    })

    expect(result.dryRun).toBe(false)
    expect(result.counts.duplicateFiltered).toBeGreaterThanOrEqual(1)
    expect(result.questions).toHaveLength(1)
    expect(result.questions[0].segment).toBe("PCB材料/工艺链")
    expect(result.writeResult).toMatchObject({ relativePath: "data/brain/questions.jsonl", records: 1 })
    const lines = (await read(path.join(tmpRoot, "data/brain/questions.jsonl"))).trim().split(/\r?\n/)
    expect(lines).toHaveLength(2)
    expect(lines[1]).toContain("self-question-v1")
    expect(lines[1]).toContain("PCB材料")
    expect(await read(path.join(tmpRoot, "wiki/股票/风华高科.md"))).toBe(wikiBefore)
    expect(await read(path.join(tmpRoot, "raw/研报新闻/2026-06-14-PCB.md"))).toBe(rawBefore)
  })

  it("self-question validate creates market-feedback validations without touching wiki or raw", async () => {
    await write(
      path.join(tmpRoot, "wiki/股票/生益科技.md"),
      `${validFrontmatter("生益科技", "股票", "code: SH600183\n")}# 生益科技\n\nPCB、覆铜板、CCL、AI服务器高速板材料验证。\n`,
    )
    await write(path.join(tmpRoot, "raw/研报新闻/2026-06-14-PCB.md"), "PCB材料需要用量价、公告、招投标和财报闭环验证。")
    await write(
      path.join(tmpRoot, "data/brain/questions.jsonl"),
      `${JSON.stringify({
        schema: "self-question-v1",
        id: "selfq-validate-1",
        type: "question",
        kind: "self-question",
        runId: "self_question_test",
        questionId: "self_q_1",
        branch: "PCB材料/工艺链",
        question: "未来三个月 AI服务器 PCB材料/工艺链里，CCL和高速板材料谁更可能率先兑现订单和毛利率？",
        hypothesis: "PCB材料/工艺链需要用量价、公告、订单和财报闭环验证。",
        expectedMove: "bullish",
        validationWindows: ["1d"],
        fundamentalSignals: ["cninfo_announcement", "qcc_tender_or_order", "revenue_and_margin"],
        sourceRefs: ["wiki/股票/生益科技.md", "raw/研报新闻/2026-06-14-PCB.md"],
        stocks: [{ name: "生益科技", code: "SH600183", path: "wiki/股票/生益科技.md", branch: "PCB材料/工艺链" }],
        status: "planned",
        createdAt: "2026-06-10 14:30:00",
      })}\n`,
    )
    const wikiBefore = await read(path.join(tmpRoot, "wiki/股票/生益科技.md"))
    const rawBefore = await read(path.join(tmpRoot, "raw/研报新闻/2026-06-14-PCB.md"))

    const stockDailyOptions = {
      stockDailyColumns: ["ticker", "date", "close", "amount", "pct_cng"],
      stockDailyExecutor: async () => ({
        rows: [
          { ticker: "SH600183", date: "2026-06-11", close: 33, amount: 3600, pct_cng: 4.2 },
        ],
      }),
    }
    const dryRun = await validateSelfQuestions({
      projectPath: tmpRoot,
      id: "selfq-validate-1",
      marketValidate: "off",
      ...stockDailyOptions,
    })
    expect(dryRun.dryRun).toBe(true)
    expect(dryRun.validations).toHaveLength(1)
    expect(dryRun.validations[0]).toMatchObject({
      type: "validation",
      kind: "self-question-market-validation",
      validationMethod: "self_question_market_feedback_v1",
      targetType: "self-question",
      questionRecordId: "selfq-validate-1",
      questionId: "self_q_1",
      stockCode: "SH600183",
      verdict: "验证通过",
    })
    expect(dryRun.validations[0].evidenceGaps).toContain("fundamental:cninfo_announcement:not_checked")
    await expect(fs.access(path.join(tmpRoot, "data/brain/validations.jsonl"))).rejects.toThrow()

    const written = await validateSelfQuestions({
      projectPath: tmpRoot,
      id: "self_q_1",
      marketValidate: "off",
      write: true,
      ...stockDailyOptions,
    })
    expect(written.writeResult).toMatchObject({ relativePath: "data/brain/validations.jsonl", records: 1 })
    const writtenLines = (await read(path.join(tmpRoot, "data/brain/validations.jsonl"))).trim().split(/\r?\n/)
    expect(writtenLines).toHaveLength(1)
    expect(writtenLines[0]).toContain("self_question_market_feedback_v1")
    expect(await read(path.join(tmpRoot, "wiki/股票/生益科技.md"))).toBe(wikiBefore)
    expect(await read(path.join(tmpRoot, "raw/研报新闻/2026-06-14-PCB.md"))).toBe(rawBefore)

    const deduped = await validateSelfQuestions({
      projectPath: tmpRoot,
      id: "selfq-validate-1",
      marketValidate: "off",
      write: true,
      ...stockDailyOptions,
    })
    expect(deduped.validations).toHaveLength(0)
    expect(deduped.counts.existing).toBe(1)
    const dedupedLines = (await read(path.join(tmpRoot, "data/brain/validations.jsonl"))).trim().split(/\r?\n/)
    expect(dedupedLines).toHaveLength(1)
  })

  it("self-question validate treats anchored empty SQL rows as not due", async () => {
    await write(
      path.join(tmpRoot, "data/brain/questions.jsonl"),
      `${JSON.stringify({
        schema: "self-question-v1",
        id: "selfq-not-due",
        type: "question",
        kind: "self-question",
        runId: "self_question_not_due",
        questionId: "self_q_not_due",
        branch: "机器人/物理AI",
        question: "机器人链自提问是否已经有市场反馈？",
        hypothesis: "需要等生成后的第一个交易日验证。",
        expectedMove: "bullish",
        validationWindows: ["1d"],
        stocks: [{ name: "绿的谐波", code: "SH688017", branch: "机器人/物理AI" }],
        status: "planned",
        createdAt: "2026-06-15 13:43:38",
      })}\n`,
    )

    const result = await validateSelfQuestions({
      projectPath: tmpRoot,
      id: "selfq-not-due",
      write: true,
      marketValidate: "off",
      stockDailyColumns: ["ticker", "date", "close"],
      stockDailyExecutor: async ({ nativeQuery }) => {
        expect(nativeQuery.validationAnchorDate).toBe("2026-06-15")
        return { rows: [] }
      },
    })

    expect(result.dryRun).toBe(false)
    expect(result.counts.notDue).toBe(1)
    expect(result.validations).toHaveLength(0)
    expect(result.writeResult).toBeNull()
    await expect(fs.access(path.join(tmpRoot, "data/brain/validations.jsonl"))).rejects.toThrow()
  })

  it("self-question validate can opt into external market fallback for anchored empty SQL rows", async () => {
    await write(
      path.join(tmpRoot, "data/brain/questions.jsonl"),
      `${JSON.stringify({
        schema: "self-question-v1",
        id: "selfq-external-fallback",
        type: "question",
        kind: "self-question",
        runId: "self_question_external_fallback",
        questionId: "self_q_external_fallback",
        branch: "机器人/物理AI",
        question: "机器人链自提问是否已经有市场反馈？",
        hypothesis: "SQL滞后时允许显式外部行情兜底，但必须保留来源。",
        expectedMove: "bullish",
        validationWindows: ["1d"],
        stocks: [{ name: "绿的谐波", code: "SH688017", branch: "机器人/物理AI" }],
        status: "planned",
        createdAt: "2026-06-15 13:43:38",
      })}\n`,
    )

    const result = await validateSelfQuestions({
      projectPath: tmpRoot,
      id: "selfq-external-fallback",
      write: true,
      allowAnchoredExternalMarket: true,
      marketValidate: "eastmoney",
      stockDailyColumns: ["ticker", "date", "close"],
      stockDailyExecutor: async () => ({ rows: [] }),
      externalMarketFetcher: async ({ source, code }) => {
        expect(source).toBe("eastmoney_kline")
        expect(code).toBe("SH688017")
        return {
          rc: 0,
          data: {
            name: "绿的谐波",
            klines: ["2026-06-15,100.00,104.20,105.00,99.00,10000,104200000.00,0,4.20,4.20,3.10"],
          },
        }
      },
    })

    expect(result.counts).toMatchObject({ validations: 1, notDue: 0 })
    expect(result.marketValidation.runs[0]).toMatchObject({ source: "eastmoney_kline", status: "ok", okCount: 1 })
    expect(result.validations[0]).toMatchObject({
      stockCode: "SH688017",
      result: "success",
      verdict: "验证通过",
      marketValidation: {
        status: "ready",
        periodReturnPct: 4.2,
        quoteValidation: {
          status: "external_only",
        },
      },
    })
    expect(result.validations[0].sqlRefs).toEqual(["external:eastmoney_kline#SH688017/2026-06-15"])
    const lines = (await read(path.join(tmpRoot, "data/brain/validations.jsonl"))).trim().split(/\r?\n/)
    expect(lines).toHaveLength(1)
  })

  it("self-question validate retries previous insufficient feedback records", async () => {
    await write(
      path.join(tmpRoot, "data/brain/questions.jsonl"),
      `${JSON.stringify({
        schema: "self-question-v1",
        id: "selfq-retry",
        type: "question",
        kind: "self-question",
        runId: "self_question_retry",
        questionId: "self_q_retry",
        branch: "PCB材料/工艺链",
        question: "PCB材料链的市场反馈是否已经确认？",
        hypothesis: "如果行情更新后转强，应允许覆盖此前证据不足的窗口。",
        expectedMove: "bullish",
        validationWindows: ["1d"],
        stocks: [{ name: "生益科技", code: "SH600183", branch: "PCB材料/工艺链" }],
        status: "planned",
        createdAt: "2026-06-10 14:30:00",
      })}\n`,
    )
    await write(
      path.join(tmpRoot, "data/brain/validations.jsonl"),
      `${JSON.stringify({
        id: "old-insufficient-validation",
        type: "validation",
        kind: "self-question-market-validation",
        validationMethod: "self_question_market_feedback_v1",
        targetType: "self-question",
        questionRecordId: "selfq-retry",
        questionId: "self_q_retry",
        stockCode: "SH600183",
        stockName: "生益科技",
        windowDays: 1,
        result: "insufficient",
        verdict: "证据不足",
        marketValidation: { status: "insufficient", verdict: "证据不足" },
      })}\n`,
    )

    const result = await validateSelfQuestions({
      projectPath: tmpRoot,
      id: "selfq-retry",
      write: true,
      marketValidate: "off",
      stockDailyColumns: ["ticker", "date", "close", "pct_cng"],
      stockDailyExecutor: async () => ({
        rows: [{ ticker: "SH600183", date: "2026-06-11", close: 33, pct_cng: 4.2 }],
      }),
    })

    expect(result.counts.existing).toBe(0)
    expect(result.validations).toHaveLength(1)
    expect(result.validations[0]).toMatchObject({ result: "success", verdict: "验证通过" })
    const lines = (await read(path.join(tmpRoot, "data/brain/validations.jsonl"))).trim().split(/\r?\n/)
    expect(lines).toHaveLength(2)
  })

  it("market-validates a prediction with stock SQL and writes only when requested", async () => {
    const dryRun = await marketValidatePrediction({
      projectPath: tmpRoot,
      prediction: "利通电子看多，应该走强",
      stock: "利通电子",
      window: "20d",
      stockDailyColumns: ["ticker", "date", "open", "high", "low", "close", "volume"],
      stockDailyExecutor: async () => ({
        rows: [
          { ticker: "SH603629", date: "2026-05-27", open: 10, high: 10.2, low: 9.8, close: 10, volume: 10000 },
          { ticker: "SH603629", date: "2026-05-28", open: 10.2, high: 10.8, low: 10.1, close: 10.6, volume: 13000 },
        ],
      }),
    })
    expect(dryRun.dryRun).toBe(true)
    expect(dryRun.record.verdict).toBe("验证通过")
    await expect(fs.access(path.join(tmpRoot, "data/brain/validations.jsonl"))).rejects.toThrow()

    const written = await marketValidatePrediction({
      projectPath: tmpRoot,
      prediction: "利通电子看多，应该走强",
      stock: "利通电子",
      window: "20d",
      write: true,
      stockDailyColumns: ["ticker", "date", "open", "high", "low", "close", "volume"],
      stockDailyExecutor: async () => ({
        rows: [
          { ticker: "SH603629", date: "2026-05-27", open: 10, high: 10.2, low: 9.8, close: 10, volume: 10000 },
          { ticker: "SH603629", date: "2026-05-28", open: 10.2, high: 10.8, low: 10.1, close: 10.6, volume: 13000 },
        ],
      }),
    })
    expect(written.writeResult.relativePath).toBe("data/brain/validations.jsonl")
    expect(await read(path.join(tmpRoot, "data/brain/validations.jsonl"))).toContain("验证通过")
  })

  it("self-train dry-run emits MPA trigger actions without writing events", async () => {
    const validations = [
      { id: "v1", type: "validation", target: "AI服务器电源", result: "success", createdAt: "2026-05-01 10:00:00" },
      { id: "v2", type: "validation", target: "AI服务器电源", result: "success", createdAt: "2026-05-02 10:00:00" },
      { id: "v3", type: "validation", target: "AI服务器电源", result: "success", createdAt: "2026-05-03 10:00:00" },
      { id: "v4", type: "validation", target: "高开接盘模式", targetType: "pattern", result: "success", createdAt: "2026-05-01 10:00:00" },
      { id: "v5", type: "validation", target: "高开接盘模式", targetType: "pattern", result: "success", createdAt: "2026-05-02 10:00:00" },
      { id: "v6", type: "validation", target: "高开接盘模式", targetType: "pattern", result: "success", createdAt: "2026-05-03 10:00:00" },
      { id: "v7", type: "validation", target: "高开接盘模式", targetType: "pattern", result: "success", createdAt: "2026-05-04 10:00:00" },
      { id: "v8", type: "validation", target: "高开接盘模式", targetType: "pattern", result: "success", createdAt: "2026-05-05 10:00:00" },
    ]
    await write(path.join(tmpRoot, "data/brain/validations.jsonl"), `${validations.map((item) => JSON.stringify(item)).join("\n")}\n`)
    await write(
      path.join(tmpRoot, "data/brain/corrections.jsonl"),
      `${JSON.stringify({ id: "c1", type: "correction", errorType: "高开接盘" })}\n${JSON.stringify({ id: "c2", type: "correction", errorType: "高开接盘" })}\n`,
    )

    const result = await runSelfTraining({ projectPath: tmpRoot })
    expect(result.dryRun).toBe(true)
    expect(result.actions.map((action) => action.rule)).toContain("R1-concept-upgrade")
    expect(result.actions.map((action) => action.rule)).toContain("R3-pattern-solidify")
    expect(result.actions.map((action) => action.rule)).toContain("R6-error-guardrail-escalation")
    await expect(fs.access(path.join(tmpRoot, "data/brain/self_training_events.jsonl"))).rejects.toThrow()
  })

  it("self-train turns price-only attribution into a fundamental evidence task", async () => {
    await write(
      path.join(tmpRoot, "data/brain/attributions.jsonl"),
      `${JSON.stringify({
        schema: "self-question-attribution-v1",
        id: "selfqa-price-only",
        type: "attribution",
        kind: "self-question-attribution",
        attributionMethod: "self_question_attribution_v1",
        validationId: "selfq-val-1",
        question: "AI服务器 PCB材料 是订单兑现还是叙事扩散？",
        target: "PCB材料/工艺链 '订单'",
        stockName: "生益科技",
        stockCode: "SH600183",
        attributionLabel: "price_only",
        confidenceImpact: "positive_but_unconfirmed",
        nextAction: "verify_fundamentals",
        evidenceGaps: ["fundamental:cninfo_announcement:not_checked", "fundamental:qcc_tender_or_order:not_checked", "fundamental:revenue_and_margin:not_checked"],
      })}\n`,
    )

    const result = await runSelfTraining({ projectPath: tmpRoot })
    expect(result.dryRun).toBe(true)
    expect(result.rules).toContain("R8-attribution-fundamental-gap")
    const action = result.actions.find((item) => item.rule === "R8-attribution-fundamental-gap")
    expect(action).toMatchObject({
      target: "PCB材料/工艺链 '订单'",
      action: "verify-fundamentals",
      affectedIds: ["selfqa-price-only"],
    })
    expect(action.evidenceGaps).toContain("fundamental:qcc_tender_or_order:not_checked")
    expect(action.evidenceTasks).toEqual([
      expect.objectContaining({ signal: "cninfo_announcement", provider: "cninfo", command: expect.stringContaining("company-research") }),
      expect.objectContaining({ signal: "qcc_tender_or_order", provider: "qichacha", command: expect.stringContaining("data-source qcc-tenders") }),
      expect.objectContaining({ signal: "revenue_and_margin", provider: "tushare_or_cninfo", command: expect.stringContaining("company-research") }),
    ])
    expect(action.evidenceTasks.find((task) => task.provider === "qichacha").command).toContain("'\\''订单'\\'''")
    await expect(fs.access(path.join(tmpRoot, "data/brain/self_training_events.jsonl"))).rejects.toThrow()
  })

  it("self-train write appends only new action events", async () => {
    await write(
      path.join(tmpRoot, "data/brain/attributions.jsonl"),
      `${JSON.stringify({
        schema: "self-question-attribution-v1",
        id: "selfqa-idempotent-price-only",
        type: "attribution",
        kind: "self-question-attribution",
        attributionMethod: "self_question_attribution_v1",
        validationId: "selfq-val-idempotent",
        question: "AI服务器 电源 是订单兑现还是叙事扩散？",
        target: "AI服务器电源",
        stockName: "麦格米特",
        stockCode: "SZ002851",
        attributionLabel: "price_only",
        confidenceImpact: "positive_but_unconfirmed",
        nextAction: "verify_fundamentals",
        evidenceGaps: ["fundamental:qcc_tender_or_order:not_checked"],
      })}\n`,
    )

    const first = await runSelfTraining({ projectPath: tmpRoot, write: true })
    expect(first.writeResult).toMatchObject({
      relativePath: "data/brain/self_training_events.jsonl",
      records: 1,
      skippedExisting: 0,
    })
    const afterFirst = await readJsonl(path.join(tmpRoot, "data/brain/self_training_events.jsonl"))
    expect(afterFirst).toHaveLength(1)
    expect(afterFirst[0]).toMatchObject({
      type: "event",
      eventType: "self-training-action",
      rule: "R8-attribution-fundamental-gap",
      affectedIds: ["selfqa-idempotent-price-only"],
    })
    expect(afterFirst[0].actionFingerprint).toEqual(expect.any(String))

    const second = await runSelfTraining({ projectPath: tmpRoot, write: true })
    expect(second.writeResult).toMatchObject({
      relativePath: "data/brain/self_training_events.jsonl",
      records: 0,
      skippedExisting: 1,
    })
    const afterSecond = await readJsonl(path.join(tmpRoot, "data/brain/self_training_events.jsonl"))
    expect(afterSecond).toEqual(afterFirst)
  })

  it("self-train action review closes reviewed actions without mutating source records", async () => {
    await write(
      path.join(tmpRoot, "data/brain/attributions.jsonl"),
      `${JSON.stringify({
        schema: "self-question-attribution-v1",
        id: "selfqa-review-price-only",
        type: "attribution",
        kind: "self-question-attribution",
        attributionMethod: "self_question_attribution_v1",
        validationId: "selfq-val-review",
        question: "AI服务器 电源 是否进入订单兑现？",
        target: "AI服务器电源",
        stockName: "麦格米特",
        stockCode: "SZ002851",
        attributionLabel: "price_only",
        confidenceImpact: "positive_but_unconfirmed",
        nextAction: "verify_fundamentals",
        evidenceGaps: ["fundamental:qcc_tender_or_order:not_checked"],
      })}\n`,
    )

    const first = await runSelfTraining({ projectPath: tmpRoot, write: true })
    const action = first.actions[0]
    const beforeReview = await read(path.join(tmpRoot, "data/brain/self_training_events.jsonl"))
    const rawSecret = ["shadow", "123"].join("")
    const openLedger = await listSelfTrainingActions({ projectPath: tmpRoot, status: "open" })
    expect(openLedger).toMatchObject({
      schema: "self-training-action-ledger-v1",
      mode: "self-train-actions",
      statusFilter: "open",
      counts: {
        actions: 1,
        open: 1,
        reviewed: 0,
        returned: 1,
      },
    })
    expect(openLedger.actions[0]).toMatchObject({
      id: action.id,
      actionFingerprint: action.actionFingerprint,
      rule: "R8-attribution-fundamental-gap",
      target: "AI服务器电源",
      reviewStatus: "open",
      reviewed: false,
      latestReview: null,
      reviewCount: 0,
    })

    const dryRun = await reviewSelfTrainingAction({
      projectPath: tmpRoot,
      id: action.id,
      action: "resolve",
      reviewer: "codex",
      note: `manual check api_key=${rawSecret}`,
    })
    expect(dryRun).toMatchObject({
      dryRun: true,
      action: "resolve",
      reviewEvent: {
        eventType: "self-training-action-review",
        result: "resolved",
        actionId: action.id,
        actionFingerprint: action.actionFingerprint,
        note: "manual check api_key=[redacted]",
      },
    })
    expect(JSON.stringify(dryRun.reviewEvent)).not.toContain(rawSecret)
    expect(await read(path.join(tmpRoot, "data/brain/self_training_events.jsonl"))).toBe(beforeReview)

    const reviewed = await reviewSelfTrainingAction({
      projectPath: tmpRoot,
      actionFingerprint: action.actionFingerprint,
      action: "resolve",
      reviewer: "codex",
      note: "done",
      write: true,
    })
    expect(reviewed.writeResult.event).toMatchObject({
      relativePath: "data/brain/self_training_events.jsonl",
      records: 1,
    })
    const afterReview = await readJsonl(path.join(tmpRoot, "data/brain/self_training_events.jsonl"))
    expect(afterReview).toHaveLength(2)
    expect(afterReview[0]).toMatchObject({ eventType: "self-training-action", id: action.id })
    expect(afterReview[1]).toMatchObject({
      eventType: "self-training-action-review",
      result: "resolved",
      actionFingerprint: action.actionFingerprint,
    })
    const reviewedLedger = await listSelfTrainingActions({ projectPath: tmpRoot })
    expect(reviewedLedger.counts).toMatchObject({
      actions: 1,
      open: 0,
      reviewed: 1,
      resolved: 1,
      reviewEvents: 1,
      returned: 1,
    })
    expect(reviewedLedger.actions[0]).toMatchObject({
      id: action.id,
      reviewStatus: "resolved",
      reviewed: true,
      reviewCount: 1,
      latestReview: {
        result: "resolved",
        reviewAction: "resolve",
        actionFingerprint: action.actionFingerprint,
        reviewer: "codex",
        note: "done",
      },
    })
    const openAfterReview = await listSelfTrainingActions({ projectPath: tmpRoot, status: "open" })
    expect(openAfterReview.actions).toEqual([])
    expect(openAfterReview.counts.returned).toBe(0)
    const resolvedAfterReview = await listSelfTrainingActions({ projectPath: tmpRoot, status: "resolved", rule: "R8", target: "AI服务器" })
    expect(resolvedAfterReview.actions.map((item) => item.id)).toEqual([action.id])
    const reviewedAfterReview = await listSelfTrainingActions({ projectPath: tmpRoot, status: "reviewed", limit: 1 })
    expect(reviewedAfterReview.actions.map((item) => item.id)).toEqual([action.id])

    const hidden = await runSelfTraining({ projectPath: tmpRoot })
    expect(hidden.actions).toEqual([])
    expect(hidden.reviewedActionCount).toBe(1)

    const included = await runSelfTraining({ projectPath: tmpRoot, includeReviewed: true })
    expect(included.actions.map((item) => item.id)).toContain(action.id)

    const allEvalSamples = await exportTrainingSamples({ projectPath: tmpRoot, kind: "eval" })
    expect(allEvalSamples.samples.map((item) => item.source).filter(Boolean).sort()).toEqual(["self-training-action", "self-training-action-review"])
    const reviewSample = allEvalSamples.samples.find((item) => item.source === "self-training-action-review")
    expect(reviewSample).toMatchObject({
      sourceRecordId: afterReview[1].id,
      question: expect.stringContaining("人工审核结论"),
      expected: expect.stringContaining("审核结论：resolved"),
      evidence: {
        actionId: action.id,
        actionFingerprint: action.actionFingerprint,
        sourceRule: "R8-attribution-fundamental-gap",
        sourceTarget: "AI服务器电源",
        sourceAction: "verify-fundamentals",
        reviewer: "codex",
        result: "resolved",
        reviewAction: "resolve",
      },
      qualityGate: {
        status: "eligible",
        highConfidenceEligible: false,
        requiredAction: "promote_with_evidence_refs",
      },
    })

    const eligible = await exportTrainingSamples({ projectPath: tmpRoot, kind: "eval", qualityGate: "eligible" })
    expect(eligible.samples.map((item) => item.source)).toEqual(["self-training-action-review"])
    const highConfidenceBeforePromotion = await exportTrainingSamples({ projectPath: tmpRoot, kind: "eval", qualityGate: "high_confidence" })
    expect(highConfidenceBeforePromotion.samples).toEqual([])

    await expect(reviewSelfTrainingAction({
      projectPath: tmpRoot,
      id: action.id,
      action: "approve",
      quality: "high_confidence",
    })).rejects.toThrow("--evidence-ref is required when --quality high_confidence")

    const promoted = await reviewSelfTrainingAction({
      projectPath: tmpRoot,
      id: action.id,
      action: "approve",
      reviewer: "codex",
      quality: "high_confidence",
      evidenceRef: "evidence_result_1, cninfo:2026-06-14:公告",
      note: "evidence-backed",
      write: true,
    })
    expect(promoted.reviewEvent).toMatchObject({
      result: "approved",
      reviewQuality: "high_confidence",
      evidenceRefs: ["evidence_result_1", "cninfo:2026-06-14:公告"],
    })
    const highConfidenceAfterPromotion = await exportTrainingSamples({ projectPath: tmpRoot, kind: "eval", qualityGate: "high_confidence" })
    expect(highConfidenceAfterPromotion.samples).toHaveLength(1)
    expect(highConfidenceAfterPromotion.samples[0]).toMatchObject({
      source: "self-training-action-review",
      evidence: {
        evidenceRefs: ["evidence_result_1", "cninfo:2026-06-14:公告"],
      },
      qualityGate: {
        status: "eligible",
        highConfidenceEligible: true,
        requiredAction: "train_on_reviewed_action",
        reasons: ["self_training_action_reviewed", "evidence_refs_confirmed"],
      },
    })
    const reviewRequired = await exportTrainingSamples({ projectPath: tmpRoot, kind: "eval", qualityGate: "review_required" })
    expect(reviewRequired.samples.map((item) => item.source)).toEqual(["self-training-action"])
  })

  it("self-train turns open self-question gate events into follow-up actions", async () => {
    await write(
      path.join(tmpRoot, "data/brain/self_training_events.jsonl"),
      `${[
        {
          schema: "self-question-loop-gate-event-v1",
          id: "self_question_gate_planned",
          type: "event",
          eventType: "self-question-loop-gate",
          loopRunId: "self_question_loop_20260615063000",
          stage: "policy-regression-execute",
          status: "planned",
          gateStatus: "planned",
          reason: "regression execution planned; pass --execute to run cases",
          recommendedNextStages: ["policy-regression-execute"],
          commandFailures: 0,
          evaluationFailed: 0,
          evaluationSkipped: 0,
          createdAt: "2026-06-15 06:30:00",
        },
        {
          schema: "self-question-loop-gate-event-v1",
          id: "self_question_gate_remediation",
          type: "event",
          eventType: "self-question-loop-gate",
          loopRunId: "self_question_loop_20260615063500",
          stage: "policy-regression-verify",
          status: "needs_remediation",
          gateStatus: "needs_remediation",
          reason: "verification assertions failed or were skipped",
          recommendedNextStages: ["policy-regression-feedback", "policy-regression-remediation", "bad;rm -rf /"],
          commandFailures: 0,
          evaluationFailed: 1,
          evaluationSkipped: 1,
          createdAt: "2026-06-15 06:35:00",
        },
      ].map((item) => JSON.stringify(item)).join("\n")}\n`,
    )
    const before = await read(path.join(tmpRoot, "data/brain/self_training_events.jsonl"))

    const result = await runSelfTraining({ projectPath: tmpRoot })

    expect(result.dryRun).toBe(true)
    expect(result.rules).toContain("R9-open-regression-gate")
    const actions = result.actions.filter((item) => item.rule === "R9-open-regression-gate")
    expect(actions).toHaveLength(2)
    expect(actions[0]).toMatchObject({
      target: "policy-regression-execute",
      action: "execute-regression-gate",
      gateStatus: "planned",
      nextStages: ["policy-regression-execute"],
      suggestedCommands: [
        "npm run codex:ingest -- self-question loop --stages policy-regression,policy-regression-execute --execute-policy-regressions --write",
      ],
      affectedIds: ["self_question_gate_planned"],
    })
    expect(actions[1]).toMatchObject({
      target: "policy-regression-verify",
      action: "repair-regression-gate",
      gateStatus: "needs_remediation",
      nextStages: ["policy-regression-feedback", "policy-regression-remediation", "bad;rm -rf /"],
      suggestedCommands: [
        "npm run codex:ingest -- self-question loop --stages policy-regression-execute,policy-regression-feedback --write",
        "npm run codex:ingest -- self-question loop --stages policy-regression-feedback,policy-regression-remediation --write",
      ],
      commandFailures: 0,
      evaluationFailed: 1,
      evaluationSkipped: 1,
      affectedIds: ["self_question_gate_remediation"],
    })
    expect(await read(path.join(tmpRoot, "data/brain/self_training_events.jsonl"))).toBe(before)
  })

  it("self-train next prioritizes open remediation gates before evidence gaps", async () => {
    await write(
      path.join(tmpRoot, "data/brain/attributions.jsonl"),
      `${JSON.stringify({
        schema: "self-question-attribution-v1",
        id: "selfqa-next-price-only",
        type: "attribution",
        kind: "self-question-attribution",
        attributionMethod: "self_question_attribution_v1",
        validationId: "selfq-val-next",
        question: "AI服务器 电源 是否进入订单兑现？",
        target: "AI服务器电源",
        stockName: "麦格米特",
        stockCode: "SZ002851",
        attributionLabel: "price_only",
        confidenceImpact: "positive_but_unconfirmed",
        nextAction: "verify_fundamentals",
        evidenceGaps: ["fundamental:cninfo_announcement:not_checked"],
      })}\n`,
    )
    await write(
      path.join(tmpRoot, "data/brain/self_training_events.jsonl"),
      `${JSON.stringify({
        schema: "self-question-loop-gate-event-v1",
        id: "self_question_gate_next_remediation",
        type: "event",
        eventType: "self-question-loop-gate",
        loopRunId: "self_question_loop_20260615070000",
        stage: "policy-regression-verify",
        status: "needs_remediation",
        gateStatus: "needs_remediation",
        recommendedNextStages: ["policy-regression-feedback", "policy-regression-remediation"],
        createdAt: "2026-06-15 07:00:00",
      })}\n`,
    )

    const written = await runSelfTraining({ projectPath: tmpRoot, write: true })
    expect(written.writeResult.records).toBe(2)

    const priorityLedger = await listSelfTrainingActions({ projectPath: tmpRoot, status: "open", orderBy: "priority" })
    expect(priorityLedger).toMatchObject({
      statusFilter: "open",
      orderBy: "priority",
      counts: {
        actions: 2,
        open: 2,
        returned: 2,
      },
    })
    expect(priorityLedger.actions.map((item) => item.rule)).toEqual(["R9-open-regression-gate", "R8-attribution-fundamental-gap"])
    expect(priorityLedger.actions[0]).toMatchObject({
      rule: "R9-open-regression-gate",
      gateStatus: "needs_remediation",
      priority: {
        rank: 10,
        label: "repair-regression-gate",
      },
    })

    const next = await listSelfTrainingActions({ projectPath: tmpRoot, status: "open", orderBy: "next", limit: 1 })
    expect(next.actions.map((item) => item.rule)).toEqual(["R9-open-regression-gate"])
    expect(next.actions[0].priority.rank).toBeLessThan(priorityLedger.actions[1].priority.rank)
  })

  it("self-train plan creates a read-only execution plan artifact for open actions", async () => {
    await write(
      path.join(tmpRoot, "data/brain/attributions.jsonl"),
      `${JSON.stringify({
        schema: "self-question-attribution-v1",
        id: "selfqa-plan-price-only",
        type: "attribution",
        kind: "self-question-attribution",
        attributionMethod: "self_question_attribution_v1",
        validationId: "selfq-val-plan",
        question: "AI服务器 电源 是否进入订单兑现？",
        target: "AI服务器电源",
        stockName: "麦格米特",
        stockCode: "SZ002851",
        attributionLabel: "price_only",
        confidenceImpact: "positive_but_unconfirmed",
        nextAction: "verify_fundamentals",
        evidenceGaps: ["fundamental:cninfo_announcement:not_checked"],
      })}\n`,
    )
    await write(
      path.join(tmpRoot, "data/brain/self_training_events.jsonl"),
      `${JSON.stringify({
        schema: "self-question-loop-gate-event-v1",
        id: "self_question_gate_plan_remediation",
        type: "event",
        eventType: "self-question-loop-gate",
        loopRunId: "self_question_loop_20260615073000",
        stage: "policy-regression-verify",
        status: "needs_remediation",
        gateStatus: "needs_remediation",
        recommendedNextStages: ["policy-regression-feedback", "policy-regression-remediation"],
        createdAt: "2026-06-15 07:30:00",
      })}\n`,
    )
    await runSelfTraining({ projectPath: tmpRoot, write: true })
    const brainBefore = await read(path.join(tmpRoot, "data/brain/self_training_events.jsonl"))

    const dryRun = await planSelfTrainingActions({ projectPath: tmpRoot, limit: 2 })
    expect(dryRun).toMatchObject({
      schema: "self-training-action-plan-run-v1",
      mode: "self-train-plan",
      dryRun: true,
      counts: {
        actions: 2,
      },
      writeResult: null,
      writePolicy: {
        artifacts: ".llm-wiki/self-training-plans only when --write is present",
        wroteWiki: false,
        wroteRaw: false,
        wroteBrain: false,
        autoExecuted: false,
      },
    })
    expect(dryRun.actions.map((item) => item.sourceRule)).toEqual(["R9-open-regression-gate", "R8-attribution-fundamental-gap"])
    expect(dryRun.actions[0]).toMatchObject({
      status: "planned",
      sourceRule: "R9-open-regression-gate",
      priority: { rank: 10 },
      steps: [
        {
          type: "command",
          status: "planned",
          autoExecute: false,
          command: "npm run codex:ingest -- self-question loop --stages policy-regression-execute,policy-regression-feedback --write",
        },
        {
          type: "command",
          status: "planned",
          autoExecute: false,
          command: "npm run codex:ingest -- self-question loop --stages policy-regression-feedback,policy-regression-remediation --write",
        },
      ],
    })
    expect(dryRun.actions[1]).toMatchObject({
      sourceRule: "R8-attribution-fundamental-gap",
      steps: [
        {
          type: "evidence-task",
          status: "planned",
          provider: "cninfo",
          autoExecute: false,
          command: "npm run codex:ingest -- company-research --stock 'SZ002851' --deep --cninfo-event-from 2025-01-01",
        },
      ],
    })
    expect(await read(path.join(tmpRoot, "data/brain/self_training_events.jsonl"))).toBe(brainBefore)
    await expect(fs.access(path.join(tmpRoot, ".llm-wiki/self-training-plans"))).rejects.toThrow()

    const generatedAt = "2026-06-15 07:35:00"
    const written = await planSelfTrainingActions({ projectPath: tmpRoot, limit: 2, generatedAt, write: true })
    expect(written.writeResult).toMatchObject({
      relativePath: expect.stringMatching(/^\.llm-wiki\/self-training-plans\/.+-self-training-plan\.json$/),
      records: 2,
    })
    expect(await read(path.join(tmpRoot, "data/brain/self_training_events.jsonl"))).toBe(brainBefore)
    const manifest = JSON.parse(await read(written.writeResult.filePath))
    expect(manifest.schema).toBe("self-training-action-plan-run-v1")
    expect(manifest.actions).toHaveLength(2)
    const rawPassword = ["pass", "word=", "secret"].join("")
    expect(JSON.stringify(manifest)).not.toContain(rawPassword)

    const secondWritten = await planSelfTrainingActions({ projectPath: tmpRoot, limit: 2, generatedAt, write: true })
    expect(secondWritten.writeResult.relativePath).not.toBe(written.writeResult.relativePath)
    await expect(fs.access(secondWritten.writeResult.filePath)).resolves.toBeUndefined()
    await expect(fs.access(written.writeResult.filePath)).resolves.toBeUndefined()

    const listed = await listSelfTrainingPlans({ projectPath: tmpRoot, limit: 2 })
    expect(listed).toMatchObject({
      schema: "self-training-action-plan-list-v1",
      mode: "self-train-plan-list",
      totalPlans: 2,
      returned: 2,
      limit: 2,
    })
    expect(listed.plans.map((item) => item.relativePath)).toEqual([
      secondWritten.writeResult.relativePath,
      written.writeResult.relativePath,
    ])
    expect(listed.plans[0]).toMatchObject({
      schema: "self-training-action-plan-run-v1",
      mode: "self-train-plan",
      runId: "self_training_plan_20260615073500",
      counts: {
        actions: 2,
      },
      writePolicy: {
        wroteBrain: false,
        autoExecuted: false,
      },
    })
  })

  it("self-train plan verify gates tampered or executable plan artifacts without writing", async () => {
    await write(
      path.join(tmpRoot, "data/brain/attributions.jsonl"),
      `${JSON.stringify({
        schema: "self-question-attribution-v1",
        id: "selfqa-plan-verify-price-only",
        type: "attribution",
        kind: "self-question-attribution",
        attributionMethod: "self_question_attribution_v1",
        validationId: "selfq-val-plan-verify",
        question: "AI服务器 电源 是否进入订单兑现？",
        target: "AI服务器电源",
        stockName: "麦格米特",
        stockCode: "SZ002851",
        attributionLabel: "price_only",
        confidenceImpact: "positive_but_unconfirmed",
        nextAction: "verify_fundamentals",
        evidenceGaps: ["fundamental:cninfo_announcement:not_checked"],
      })}\n`,
    )
    await write(
      path.join(tmpRoot, "data/brain/self_training_events.jsonl"),
      `${JSON.stringify({
        schema: "self-question-loop-gate-event-v1",
        id: "self_question_gate_plan_verify_remediation",
        type: "event",
        eventType: "self-question-loop-gate",
        loopRunId: "self_question_loop_20260615073000",
        stage: "policy-regression-verify",
        status: "needs_remediation",
        gateStatus: "needs_remediation",
        recommendedNextStages: ["policy-regression-feedback", "policy-regression-remediation"],
        createdAt: "2026-06-15 07:30:00",
      })}\n`,
    )
    await runSelfTraining({ projectPath: tmpRoot, write: true })
    const generatedAt = "2026-06-15 07:35:00"
    const written = await planSelfTrainingActions({ projectPath: tmpRoot, limit: 2, generatedAt, write: true })
    const planDir = path.join(tmpRoot, ".llm-wiki/self-training-plans")
    const filesBefore = (await fs.readdir(planDir)).sort()

    const clean = await verifySelfTrainingPlans({ projectPath: tmpRoot, planPath: written.writeResult.relativePath })
    expect(clean).toMatchObject({
      schema: "self-training-action-plan-verify-v1",
      mode: "self-train-plan-verify",
      status: "ok",
      checked: 1,
      passed: 1,
      failed: 0,
      issueCount: 0,
    })
    expect(clean.plans[0]).toMatchObject({
      status: "ok",
      relativePath: written.writeResult.relativePath,
      actionCount: 2,
      stepCount: 3,
      issues: [],
    })
    expect((await fs.readdir(planDir)).sort()).toEqual(filesBefore)

    const bad = JSON.parse(await read(written.writeResult.filePath))
    bad.actions[0].steps[0].autoExecute = true
    bad.counts.actions = 999
    const badRelativePath = ".llm-wiki/self-training-plans/bad-self-training-plan.json"
    await write(path.join(tmpRoot, badRelativePath), `${JSON.stringify(bad, null, 2)}\n`)

    const broken = await verifySelfTrainingPlans({ projectPath: tmpRoot, planPath: badRelativePath })
    expect(broken).toMatchObject({
      schema: "self-training-action-plan-verify-v1",
      mode: "self-train-plan-verify",
      status: "needs_remediation",
      checked: 1,
      passed: 0,
      failed: 1,
    })
    expect(broken.issueCount).toBeGreaterThanOrEqual(2)
    expect(broken.plans[0].issues.map((item) => item.code)).toEqual(expect.arrayContaining([
      "auto_execute_enabled",
      "action_count_mismatch",
    ]))
    const phaseStatus = await getRecursiveAiPhaseStatus({ projectPath: tmpRoot })
    expect(phaseStatus.counts.selfTrainingPlanIssues).toBeGreaterThanOrEqual(2)
    expect(phaseStatus.phase5Readiness.gates.find((item) => item.gate === "self_training_plan_verified")).toMatchObject({
      status: "blocked",
      evidence: {
        plans: 2,
      },
    })
    expect(phaseStatus.nextActions.map((item) => item.gate)).toContain("verify_self_training_plans")
  })

  it("exports training samples from brain memory records", async () => {
    await write(
      path.join(tmpRoot, "data/brain/corrections.jsonl"),
      `${JSON.stringify({ id: "corr-1", type: "correction", badAnswer: "高开就追", goodAnswer: "高开必须等承接确认" })}\n`,
    )
    await write(
      path.join(tmpRoot, "data/brain/validations.jsonl"),
      `${JSON.stringify({ id: "val-1", type: "validation", prediction: "利通电子看多", verdict: "验证通过", reason: "20日区间上涨" })}\n`,
    )
    await write(
      path.join(tmpRoot, "data/brain/questions.jsonl"),
      `${JSON.stringify({
        schema: "self-question-v1",
        id: "selfq-1",
        type: "question",
        kind: "self-question",
        question: "AI服务器电源这条线现在是订单兑现还是叙事扩散？",
        hypothesis: "AI服务器电源需要用量价、公告、订单和财报闭环验证。",
        validationWindows: ["3d", "10d"],
        marketSignals: ["relative_strength"],
        fundamentalSignals: ["cninfo_announcement", "qcc_tender_or_order"],
        disconfirmIf: ["price_only_without_fundamental_confirmation"],
      })}\n`,
    )

    const sft = await exportTrainingSamples({ projectPath: tmpRoot, kind: "sft" })
    expect(sft.count).toBe(2)
    expect(sft.relativePath).toMatch(/^\.llm-wiki\/exports\/training\/sft-\d{4}-\d{2}-\d{2}\.jsonl$/)
    expect(await read(sft.outputPath)).toContain("高开必须等承接确认")
    expect(sft.manifestRelativePath).toMatch(/^\.llm-wiki\/exports\/training\/sft-\d{4}-\d{2}-\d{2}\.manifest\.json$/)
    const sftManifest = JSON.parse(await read(sft.manifestPath))
    expect(sftManifest).toMatchObject({
      schema: "training-sample-export-manifest-v1",
      kind: "sft",
      qualityGate: "all",
      count: 2,
      outputs: {
        jsonl: sft.relativePath,
      },
      qualityGateCounts: {
        unclassified: 2,
      },
      sourceCounts: {
        "brain-memory": 2,
      },
    })
    expect(sftManifest.sampleRefs).toEqual([
      expect.objectContaining({ id: "sft_corr-1", source: "brain-memory", qualityGateStatus: "unclassified" }),
      expect.objectContaining({ id: "sft_val-1", source: "brain-memory", qualityGateStatus: "unclassified" }),
    ])

    const preference = await exportTrainingSamples({ projectPath: tmpRoot, kind: "preference" })
    expect(preference.count).toBe(1)
    expect(await read(preference.outputPath)).toContain("accepted")

    const evalSamples = await exportTrainingSamples({ projectPath: tmpRoot, kind: "eval" })
    expect(evalSamples.count).toBe(2)
    const evalText = await read(evalSamples.outputPath)
    expect(evalText).toContain("AI服务器电源这条线现在是订单兑现还是叙事扩散")
    expect(evalText).toContain("必须输出验证计划")
  })

  it("keeps same-day training sample export batches instead of overwriting prior files", async () => {
    const validationsPath = path.join(tmpRoot, "data/brain/validations.jsonl")
    await write(
      validationsPath,
      `${JSON.stringify({ id: "val-batch-1", type: "validation", prediction: "AI服务器电源看多", verdict: "验证通过", reason: "第一批" })}\n`,
    )

    const first = await exportTrainingSamples({ projectPath: tmpRoot, kind: "eval" })
    const firstText = await read(first.outputPath)
    const firstManifest = JSON.parse(await read(first.manifestPath))
    expect(first.count).toBe(1)
    expect(firstText).toContain("val-batch-1")
    expect(firstManifest.count).toBe(1)

    await fs.appendFile(
      validationsPath,
      `${JSON.stringify({ id: "val-batch-2", type: "validation", prediction: "AI服务器液冷看多", verdict: "待继续观察", reason: "第二批" })}\n`,
      "utf8",
    )

    const second = await exportTrainingSamples({ projectPath: tmpRoot, kind: "eval" })
    expect(second.count).toBe(2)
    expect(second.relativePath).not.toBe(first.relativePath)
    expect(second.manifestRelativePath).not.toBe(first.manifestRelativePath)
    expect(first.ledgerRelativePath).toBe(".llm-wiki/exports/training/export-ledger.jsonl")
    expect(second.ledgerRelativePath).toBe(first.ledgerRelativePath)
    expect(await read(first.outputPath)).toBe(firstText)
    expect(JSON.parse(await read(first.manifestPath))).toMatchObject({
      schema: "training-sample-export-manifest-v1",
      count: 1,
      outputs: { jsonl: first.relativePath },
    })
    expect(await read(second.outputPath)).toContain("val-batch-2")
    expect(JSON.parse(await read(second.manifestPath))).toMatchObject({
      schema: "training-sample-export-manifest-v1",
      count: 2,
      outputs: { jsonl: second.relativePath },
    })
    const ledger = await readJsonl(first.ledgerPath)
    expect(ledger).toEqual([
      expect.objectContaining({
        schema: "training-sample-export-ledger-entry-v1",
        kind: "eval",
        qualityGate: "all",
        count: 1,
        outputs: expect.objectContaining({ jsonl: first.relativePath, manifest: first.manifestRelativePath }),
        qualityGateCounts: { unclassified: 1 },
        sourceCounts: { "brain-memory": 1 },
      }),
      expect.objectContaining({
        schema: "training-sample-export-ledger-entry-v1",
        kind: "eval",
        qualityGate: "all",
        count: 2,
        outputs: expect.objectContaining({ jsonl: second.relativePath, manifest: second.manifestRelativePath }),
      }),
    ])
  })

  it("lists training sample export ledger entries with filters and newest-first order", async () => {
    expect(await listTrainingSampleExports({ projectPath: tmpRoot })).toMatchObject({
      ledgerRelativePath: ".llm-wiki/exports/training/export-ledger.jsonl",
      totalEntries: 0,
      returned: 0,
      entries: [],
    })

    await write(
      path.join(tmpRoot, "data/brain/validations.jsonl"),
      `${JSON.stringify({ id: "val-ledger-1", type: "validation", prediction: "AI服务器电源看多", verdict: "验证通过" })}\n`,
    )
    const evalAll = await exportTrainingSamples({ projectPath: tmpRoot, kind: "eval" })
    const sftAll = await exportTrainingSamples({ projectPath: tmpRoot, kind: "sft" })
    const evalHighConfidence = await exportTrainingSamples({ projectPath: tmpRoot, kind: "eval", qualityGate: "high_confidence" })

    const all = await listTrainingSampleExports({ projectPath: tmpRoot })
    expect(all.totalEntries).toBe(3)
    expect(all.returned).toBe(3)
    expect(all.entries.map((entry) => entry.outputs.jsonl)).toEqual([
      evalHighConfidence.relativePath,
      sftAll.relativePath,
      evalAll.relativePath,
    ])
    expect(all.summary).toMatchObject({
      byKind: { eval: 2, sft: 1 },
      byQualityGate: { all: 2, high_confidence: 1 },
      sampleCount: 2,
    })

    const evalOnly = await listTrainingSampleExports({ projectPath: tmpRoot, kind: "eval", limit: 1 })
    expect(evalOnly.totalEntries).toBe(3)
    expect(evalOnly.filteredEntries).toBe(2)
    expect(evalOnly.returned).toBe(1)
    expect(evalOnly.entries[0]).toMatchObject({
      kind: "eval",
      qualityGate: "high_confidence",
      outputs: expect.objectContaining({ jsonl: evalHighConfidence.relativePath }),
    })

    const highConfidenceOnly = await listTrainingSampleExports({ projectPath: tmpRoot, qualityGate: "high_confidence" })
    expect(highConfidenceOnly.entries).toHaveLength(1)
    expect(highConfidenceOnly.entries[0].outputs.jsonl).toBe(evalHighConfidence.relativePath)
  })

  it("verifies training sample export ledger integrity before self-training use", async () => {
    await write(
      path.join(tmpRoot, "data/brain/validations.jsonl"),
      `${JSON.stringify({ id: "val-verify-1", type: "validation", prediction: "AI服务器电源看多", verdict: "验证通过" })}\n`,
    )
    const first = await exportTrainingSamples({ projectPath: tmpRoot, kind: "eval" })

    const clean = await verifyTrainingSampleExports({ projectPath: tmpRoot })
    expect(clean).toMatchObject({
      status: "ok",
      checked: 1,
      failed: 0,
      issueCount: 0,
    })
    expect(clean.entries[0]).toMatchObject({
      status: "ok",
      outputs: expect.objectContaining({ jsonl: first.relativePath, manifest: first.manifestRelativePath }),
      jsonlCount: 1,
      manifestCount: 1,
      ledgerCount: 1,
      issues: [],
    })

    const second = await exportTrainingSamples({ projectPath: tmpRoot, kind: "eval" })
    await fs.rm(second.manifestPath)

    const broken = await verifyTrainingSampleExports({ projectPath: tmpRoot, limit: 2, concurrency: 2 })
    expect(broken.status).toBe("failed")
    expect(broken.checked).toBe(2)
    expect(broken.concurrency).toBe(2)
    expect(broken.failed).toBe(1)
    expect(broken.issueCount).toBe(1)
    expect(broken.entries[0]).toMatchObject({
      status: "failed",
      outputs: expect.objectContaining({ jsonl: second.relativePath, manifest: second.manifestRelativePath }),
      issues: [expect.objectContaining({ code: "missing_manifest" })],
    })
    expect(broken.entries[1].status).toBe("ok")
  })

  it("creates read-only autoresearch program artifacts for parallel research lanes", async () => {
    const dryRun = await createAutoresearchProgram({
      projectPath: tmpRoot,
      title: "未来三年数据中心光纤带动",
      hypothesis: "光纤链的增量可能先体现在细分环节订单和交付闭环。",
      lanes: "光纤链,PCB链",
    })
    expect(dryRun).toMatchObject({
      schema: "trading-autoresearch-program-run-v1",
      dryRun: true,
      program: {
        schema: "trading-autoresearch-program-v1",
        title: "未来三年数据中心光纤带动",
        lanes: ["光纤链", "PCB链"],
        lockedEvaluator: {
          version: "trading-autoresearch-lite-v1",
          immutable: true,
        },
        writePolicy: {
          wroteWiki: false,
          wroteRaw: false,
          editableArtifactsOnly: true,
        },
      },
      writeResult: null,
    })
    await expect(fs.access(path.join(tmpRoot, ".llm-wiki/research-programs"))).rejects.toThrow()

    const written = await createAutoresearchProgram({
      projectPath: tmpRoot,
      title: "未来三年数据中心光纤带动",
      hypothesis: "光纤链的增量可能先体现在细分环节订单和交付闭环。",
      lanes: ["光纤链", "PCB链"],
      editableArtifacts: "prompt_template,segment_config,market_validator_params",
      slug: "future-three-years-data-center-fiber",
      generatedAt: "2026-06-15 10:30:00",
      write: true,
    })
    expect(written.writeResult).toMatchObject({
      jsonRelativePath: ".llm-wiki/research-programs/20260615103000-future-three-years-data-center-fiber.json",
      markdownRelativePath: ".llm-wiki/research-programs/20260615103000-future-three-years-data-center-fiber.md",
    })
    const jsonProgram = JSON.parse(await read(written.writeResult.jsonPath))
    expect(jsonProgram).toMatchObject({
      id: written.program.id,
      allowedEditableArtifacts: ["prompt_template", "segment_config", "market_validator_params"],
      forbiddenWrites: ["wiki/", "raw/", "real_trade_execution"],
    })
    expect(await read(written.writeResult.markdownPath)).toContain("Locked Evaluator")
    expect(written.writeResult.jsonRelativePath.startsWith(".llm-wiki/research-programs/")).toBe(true)
    expect(written.writeResult.markdownRelativePath.startsWith(".llm-wiki/research-programs/")).toBe(true)
    const readiness = await getAutoresearchReadiness({ projectPath: tmpRoot })
    expect(readiness).toMatchObject({
      schema: "trading-autoresearch-readiness-v1",
      status: "program_ready",
      phase5Unlocks: false,
      counts: {
        researchPrograms: 1,
        experiments: 0,
      },
      writePolicy: {
        readOnly: true,
        wroteWiki: false,
        wroteRaw: false,
        phase5Unlocks: false,
      },
    })
    await expect(createAutoresearchProgram({
      projectPath: tmpRoot,
      title: "bad editable boundary",
      editableArtifacts: "wiki,segment_config",
    })).rejects.toThrow("--editable-artifacts contains unsupported artifact: wiki")
  })

  it("scores autoresearch experiments and appends review-gated ledger entries", async () => {
    const score = scoreAutoresearchExperiment({
      marketFeedbackScore: 3,
      evidenceClosureScore: 2,
      attributionQualityScore: 1,
      noveltyScore: 1,
      leakagePenalty: 1,
      complexityPenalty: 1,
      hypeWithoutOrderPenalty: 2,
    })
    expect(score).toMatchObject({
      schema: "trading-autoresearch-score-v1",
      totalScore: 3,
      formula: "market_feedback_score + evidence_closure_score + attribution_quality_score + novelty_score - leakage_penalty - complexity_penalty - hype_without_order_penalty",
    })

    const dryRun = await appendAutoresearchExperiment({
      projectPath: tmpRoot,
      programId: "program_fiber",
      hypothesis: "提高光纤链证据任务优先级能增加可行动反馈。",
      changedArtifact: "evidence_task_priority",
      baselineScore: 2,
      newScore: 3,
      manifestPath: ".llm-wiki/self-question-runs/run/manifest.json",
    })
    expect(dryRun).toMatchObject({
      dryRun: true,
      entry: {
        decision: "review_required",
        scoreDelta: 1,
        highConfidenceEligible: false,
      },
      writeResult: null,
    })
    expect(dryRun.entry.manifestEvidence).toMatchObject({
      status: "missing",
      path: ".llm-wiki/self-question-runs/run/manifest.json",
    })
    await expect(fs.access(path.join(tmpRoot, ".llm-wiki/experiments"))).rejects.toThrow()

    const written = await appendAutoresearchExperiment({
      projectPath: tmpRoot,
      programId: "program_fiber",
      hypothesis: "提高光纤链证据任务优先级能增加可行动反馈。",
      changedArtifact: "evidence_task_priority",
      baselineScore: 2,
      newScore: 1,
      evidenceGaps: "fundamental:orders:not_checked",
      futureValidationDate: "2026-06-30",
      generatedAt: "2026-06-15 10:35:00",
      write: true,
    })
    expect(written.entry).toMatchObject({
      decision: "discard",
      evidenceGaps: ["fundamental:orders:not_checked"],
      highConfidenceEligible: false,
    })
    expect(written.writeResult).toMatchObject({
      relativePath: ".llm-wiki/experiments/experiment-ledger.jsonl",
      records: 1,
    })
    const ledger = await listAutoresearchExperiments({ projectPath: tmpRoot })
    expect(ledger).toMatchObject({
      schema: "trading-autoresearch-experiment-ledger-v1",
      totalEntries: 1,
      entries: [
        expect.objectContaining({
          programId: "program_fiber",
          changedArtifact: "evidence_task_priority",
          decision: "discard",
        }),
      ],
      writePolicy: {
        readOnly: true,
        wroteWiki: false,
        wroteRaw: false,
      },
    })
    await expect(appendAutoresearchExperiment({
      projectPath: tmpRoot,
      programId: "program_fiber",
      hypothesis: "不存在的 agentic ask manifest 不能作为实验凭证。",
      changedArtifact: "agent_role_weighting",
      baselineScore: 1,
      newScore: 2,
      manifestPath: ".llm-wiki/agent-runs/missing/manifest.json",
      write: true,
    })).rejects.toThrow("--manifest does not exist")
    await write(
      path.join(tmpRoot, AGENT_RUNS_ROOT, "20260615-110000-ask/manifest.json"),
      `${JSON.stringify({
        schema: "agent-run-manifest-v1",
        mode: "ask",
        runId: "agentic_ask_autoresearch_evidence",
        status: "ok",
        query: "未来三年数据中心光纤带动，哪些细分最有验证价值？",
        roles: [],
      })}\n`,
    )
    const agenticEvidence = await appendAutoresearchExperiment({
      projectPath: tmpRoot,
      programId: "program_fiber",
      hypothesis: "agentic ask 审计产物能作为实验 ledger 的证据引用。",
      changedArtifact: "agent_role_weighting",
      baselineScore: 2,
      newScore: 4,
      manifestPath: ".llm-wiki/agent-runs/20260615-110000-ask/manifest.json",
      generatedAt: "2026-06-15 10:36:00",
      write: true,
    })
    expect(agenticEvidence.entry).toMatchObject({
      decision: "review_required",
      manifestEvidence: {
        status: "ok",
        path: ".llm-wiki/agent-runs/20260615-110000-ask/manifest.json",
        schema: "agent-run-manifest-v1",
        mode: "ask",
        runId: "agentic_ask_autoresearch_evidence",
        runStatus: "ok",
      },
    })
    const ledgerWithAgentEvidence = await listAutoresearchExperiments({ projectPath: tmpRoot })
    expect(ledgerWithAgentEvidence.totalEntries).toBe(2)
    expect(ledgerWithAgentEvidence.entries.find((entry) => entry.changedArtifact === "agent_role_weighting")).toMatchObject({
      manifestEvidence: {
        schema: "agent-run-manifest-v1",
        runId: "agentic_ask_autoresearch_evidence",
      },
    })
  })

  it("proposes review-gated autoresearch policy changes without auto-applying", async () => {
    await write(path.join(tmpRoot, "wiki/概念/Autoresearch边界.md"), "wiki sentinel")
    await write(path.join(tmpRoot, "raw/研报新闻/autoresearch-boundary.md"), "raw sentinel")
    const wikiBefore = await read(path.join(tmpRoot, "wiki/概念/Autoresearch边界.md"))
    const rawBefore = await read(path.join(tmpRoot, "raw/研报新闻/autoresearch-boundary.md"))
    await appendAutoresearchExperiment({
      projectPath: tmpRoot,
      programId: "program_policy",
      hypothesis: "细分候选池提升可行动反馈。",
      changedArtifact: "segment_config",
      baselineScore: 1,
      newScore: 3,
      generatedAt: "2026-06-15 11:00:00",
      write: true,
    })
    await appendAutoresearchExperiment({
      projectPath: tmpRoot,
      programId: "program_policy",
      hypothesis: "补证任务优先级提升基本面闭环。",
      changedArtifact: "evidence_task_priority",
      baselineScore: 2,
      newScore: 3,
      generatedAt: "2026-06-15 11:01:00",
      write: true,
    })
    await appendAutoresearchExperiment({
      projectPath: tmpRoot,
      programId: "program_policy",
      hypothesis: "验证参数改动没有带来改善。",
      changedArtifact: "market_validator_params",
      baselineScore: 3,
      newScore: 1,
      generatedAt: "2026-06-15 11:02:00",
      write: true,
    })

    const dryRun = await proposeAutoresearchPolicyChanges({
      projectPath: tmpRoot,
      minScoreDelta: 1,
      changedArtifacts: "segment_config,evidence_task_priority,market_validator_params",
    })
    expect(dryRun).toMatchObject({
      schema: "trading-autoresearch-policy-proposal-run-v1",
      mode: "autoresearch-policy-propose",
      dryRun: true,
      counts: {
        experiments: 3,
        candidates: 2,
        proposals: 2,
        minScoreDelta: 1,
      },
      writePolicy: {
        artifacts: ".llm-wiki/policy-proposals",
        wroteWiki: false,
        wroteRaw: false,
        wroteBrain: false,
        autoApplied: false,
        realTradeExecution: false,
      },
      writeResult: null,
    })
    expect(dryRun.proposals.map((proposal) => proposal.changedArtifact).sort()).toEqual(["evidence_task_priority", "segment_config"])
    expect(dryRun.proposals.every((proposal) =>
      proposal.status === "proposed_review_required" &&
      proposal.reviewStatus === "review_required" &&
      proposal.autoApply === false &&
      proposal.autoApplyAllowed === false &&
      proposal.reviewRequired === true)).toBe(true)
    expect(dryRun.proposals.find((proposal) => proposal.targetArtifact === "segment_config")).toMatchObject({
      evidenceSufficiency: { status: "insufficient" },
      evidenceGaps: [],
      riskLevel: "high",
      evidenceRefs: {
        ledger: [expect.stringMatching(/^autoresearch_experiment_/)],
        agentRuns: [],
        validations: [],
      },
      risks: expect.arrayContaining(["missing_manifest_or_validation_evidence"]),
    })
    await expect(fs.access(path.join(tmpRoot, ".llm-wiki/policy-proposals"))).rejects.toThrow()
    await expect(fs.access(path.join(tmpRoot, ".llm-wiki/experiments/policy-proposals"))).rejects.toThrow()

    const written = await proposeAutoresearchPolicyChanges({
      projectPath: tmpRoot,
      minScoreDelta: 1,
      changedArtifacts: "segment_config,evidence_task_priority",
      generatedAt: "2026-06-15 11:05:00",
      write: true,
    })
    expect(written.writeResult).toMatchObject({
      relativePath: ".llm-wiki/policy-proposals/20260615110500-autoresearch-policy-proposals.json",
      markdownRelativePath: ".llm-wiki/policy-proposals/20260615110500-autoresearch-policy-proposals.md",
      records: 2,
    })
    const proposalRun = JSON.parse(await read(written.writeResult.filePath))
    const proposalMarkdown = await read(written.writeResult.markdownPath)
    expect(proposalRun).toMatchObject({
      schema: "trading-autoresearch-policy-proposal-run-v1",
      dryRun: false,
      proposals: [
        expect.objectContaining({
          schema: "trading-autoresearch-policy-proposal-v1",
          status: "proposed_review_required",
          reviewStatus: "review_required",
          targetArtifact: expect.any(String),
          evidenceRefs: expect.objectContaining({
            ledger: expect.any(Array),
            agentRuns: expect.any(Array),
            validations: expect.any(Array),
          }),
          riskLevel: "high",
          autoApplyAllowed: false,
          autoApply: false,
          proposedPolicyChange: expect.objectContaining({
            autoApply: false,
            source: "autoresearch_experiment_ledger",
          }),
        }),
        expect.objectContaining({
          schema: "trading-autoresearch-policy-proposal-v1",
          status: "proposed_review_required",
          reviewStatus: "review_required",
          autoApplyAllowed: false,
          autoApply: false,
        }),
      ],
      writePolicy: {
        artifacts: ".llm-wiki/policy-proposals",
        wroteWiki: false,
        wroteRaw: false,
        wroteBrain: false,
        autoApplied: false,
        realTradeExecution: false,
      },
      writeResult: {
        relativePath: ".llm-wiki/policy-proposals/20260615110500-autoresearch-policy-proposals.json",
        markdownRelativePath: ".llm-wiki/policy-proposals/20260615110500-autoresearch-policy-proposals.md",
        records: 2,
      },
    })
    expect(proposalMarkdown).toContain("targetArtifact: segment_config")
    expect(proposalMarkdown).toContain("autoApplyAllowed: false")
    expect(await read(path.join(tmpRoot, "wiki/概念/Autoresearch边界.md"))).toBe(wikiBefore)
    expect(await read(path.join(tmpRoot, "raw/研报新闻/autoresearch-boundary.md"))).toBe(rawBefore)
    await expect(fs.access(path.join(tmpRoot, ".llm-wiki/experiments/policy-proposals"))).rejects.toThrow()
    await expect(proposeAutoresearchPolicyChanges({
      projectPath: tmpRoot,
      changedArtifacts: "wiki,segment_config",
    })).rejects.toThrow("--editable-artifacts contains unsupported artifact: wiki")
  })

  it("exports self-training action events as review-required eval samples", async () => {
    await write(
      path.join(tmpRoot, "data/brain/self_training_events.jsonl"),
      `${JSON.stringify({
        id: "self_train_gate_action",
        actionFingerprint: "self_train_gate_action_fingerprint",
        type: "event",
        eventType: "self-training-action",
        rulesVersion: "mpa-v1",
        rule: "R9-open-regression-gate",
        target: "policy-regression-execute",
        action: "execute-regression-gate",
        reason: "回归门控仍是 planned，需要执行回归验证后才能宣称闭环。",
        affectedIds: ["self_question_gate_planned"],
        gateStatus: "planned",
        evidenceTasks: [
          { provider: "qichacha", command: "npm run codex:ingest -- data-source qcc-tenders token=secret123" },
        ],
        nextStages: ["policy-regression-execute"],
        suggestedCommands: [
          "npm run codex:ingest -- self-question loop --stages policy-regression,policy-regression-execute --execute-policy-regressions --write",
        ],
        createdAt: "2026-06-15 08:30:00",
      })}\n`,
    )

    const evalSamples = await exportTrainingSamples({ projectPath: tmpRoot, kind: "eval" })
    expect(evalSamples.count).toBe(1)
    expect(evalSamples.samples[0]).toMatchObject({
      kind: "eval",
      id: "eval_self_train_gate_action",
      source: "self-training-action",
      sourceRecordId: "self_train_gate_action",
      question: expect.stringContaining("递归自训练动作"),
      expected: expect.stringContaining("execute-regression-gate"),
      qualityGate: {
        status: "review_required",
        highConfidenceEligible: false,
        requiredAction: "execute_or_review_action",
      },
    })
    expect(evalSamples.samples[0].evidence).toMatchObject({
      rule: "R9-open-regression-gate",
      target: "policy-regression-execute",
      gateStatus: "planned",
      affectedIds: ["self_question_gate_planned"],
      evidenceTasks: [
        { provider: "qichacha", command: "npm run codex:ingest -- data-source qcc-tenders token=[redacted]" },
      ],
      nextStages: ["policy-regression-execute"],
      suggestedCommands: [
        "npm run codex:ingest -- self-question loop --stages policy-regression,policy-regression-execute --execute-policy-regressions --write",
      ],
    })
    expect(await read(evalSamples.outputPath)).not.toContain("secret123")

    const reviewRequired = await exportTrainingSamples({ projectPath: tmpRoot, kind: "eval", qualityGate: "review_required" })
    expect(reviewRequired.count).toBe(1)

    const highConfidenceSft = await exportTrainingSamples({ projectPath: tmpRoot, kind: "sft", qualityGate: "high_confidence" })
    expect(highConfidenceSft.count).toBe(0)
  })

  it("exports self-training plan artifacts and verification manifests as review-required eval samples", async () => {
    const rawTokenKey = ["to", "ken"].join("")
    const rawTokenValue = ["fixture", "value", "123"].join("")
    const rawTokenCommand = ["npm run codex:ingest -- data-source qcc-tenders ", rawTokenKey, "=", rawTokenValue].join("")
    const planned = await planSelfTrainingActions({
      projectPath: tmpRoot,
      actions: [
        {
          id: "self_train_plan_export_action",
          actionFingerprint: "self_train_plan_export_action_fp",
          rule: "R8-attribution-fundamental-gap",
          target: "AI服务器PCB材料",
          action: "verify-fundamentals",
          reason: "量价先行但缺少公告和订单证据。",
          evidenceTasks: [
            {
              provider: "qichacha",
              signal: "qcc_tender_or_order",
              evidenceType: "tender_or_order",
              command: rawTokenCommand,
            },
          ],
        },
      ],
      generatedAt: "2026-06-15 09:00:00",
      write: true,
    })
    await write(
      path.join(tmpRoot, ".llm-wiki/self-question-runs/20260615090500-loop/manifest.json"),
      `${JSON.stringify({
        schema: "self-question-loop-run-v1",
        runId: "self_question_loop_20260615090500",
        status: "ok",
        generatedAt: "2026-06-15 09:05:00",
        stages: [
          {
            stage: "self-train-plan-verify",
            status: "ok",
            counts: { checked: 1, failed: 0, issues: 0 },
            verdict: {
              status: "passed",
              reason: "self-training plan safety and count consistency verified",
              nextStages: [],
            },
          },
        ],
        gateSummary: {
          status: "passed",
          recommendedNextStages: [],
          results: [
            {
              stage: "self-train-plan-verify",
              status: "passed",
              reason: "self-training plan safety and count consistency verified",
              nextStages: [],
            },
          ],
        },
        counts: {
          selfTrainingPlanActions: 1,
          selfTrainingPlanVerificationChecked: 1,
          selfTrainingPlanVerificationFailures: 0,
          selfTrainingPlanVerificationIssues: 0,
        },
        outputs: {
          selfTrainingPlan: planned.writeResult.relativePath,
          selfTrainingPlanVerification: {
            status: "ok",
            checked: 1,
            failed: 0,
            issueCount: 0,
            plans: [
              {
                status: "ok",
                relativePath: planned.writeResult.relativePath,
                actionCount: 1,
                stepCount: 1,
                issues: [],
              },
            ],
          },
        },
      }, null, 2)}\n`,
    )

    const evalSamples = await exportTrainingSamples({ projectPath: tmpRoot, kind: "eval" })
    expect(evalSamples.count).toBe(2)
    expect(evalSamples.samples.map((item) => item.source).sort()).toEqual([
      "self-training-plan",
      "self-training-plan-verification",
    ])
    const planSample = evalSamples.samples.find((item) => item.source === "self-training-plan")
    expect(planSample).toMatchObject({
      kind: "eval",
      source: "self-training-plan",
      sourceRecordId: planned.runId,
      qualityGate: {
        status: "review_required",
        highConfidenceEligible: false,
        requiredAction: "verify_and_review_self_training_plan",
      },
    })
    expect(planSample.evidence).toMatchObject({
      planPath: planned.writeResult.relativePath,
      counts: { actions: 1, steps: 1 },
      actions: [
        expect.objectContaining({
          sourceRule: "R8-attribution-fundamental-gap",
          steps: [
            expect.objectContaining({
              autoExecute: false,
              command: "npm run codex:ingest -- data-source qcc-tenders token=[redacted]",
            }),
          ],
        }),
      ],
    })
    const verificationSample = evalSamples.samples.find((item) => item.source === "self-training-plan-verification")
    expect(verificationSample).toMatchObject({
      sourceRecordId: "self_question_loop_20260615090500",
      qualityGate: {
        status: "review_required",
        highConfidenceEligible: false,
        requiredAction: "review_verified_self_training_plan",
      },
      evidence: {
        status: "ok",
        checked: 1,
        failed: 0,
        issueCount: 0,
      },
    })
    expect(await read(evalSamples.outputPath)).not.toContain(rawTokenValue)

    const reviewRequired = await exportTrainingSamples({ projectPath: tmpRoot, kind: "eval", qualityGate: "review_required" })
    expect(reviewRequired.count).toBe(2)
    const highConfidence = await exportTrainingSamples({ projectPath: tmpRoot, kind: "eval", qualityGate: "high_confidence" })
    expect(highConfidence.count).toBe(0)
  })

  it("reports recursive AI phase status from brain records and audit artifacts", async () => {
    const blockedCheck = await checkRecursiveAiPhase5Readiness({ projectPath: tmpRoot })
    expect(blockedCheck).toMatchObject({
      schema: "recursive-ai-phase5-check-v1",
      mode: "self-question-phase-check",
      status: "blocked",
      ready: false,
      exitCode: 1,
      phase5Readiness: {
        status: "blocked",
        autoExecuteAllowed: false,
        humanApprovalRequired: true,
      },
    })
    expect(blockedCheck.blockingGates.map((item) => item.gate)).toContain("self_question_feedback")

    await write(
      path.join(tmpRoot, AGENT_RUNS_ROOT, "20260615-093000-ask/manifest.json"),
      `${JSON.stringify({
        schema: "agent-run-manifest-v1",
        mode: "ask",
        runId: "agentic_ask_phase_status",
        status: "ok",
        query: "AI服务器电源是订单兑现还是叙事扩散",
        roles: [],
      })}\n`,
    )
    await write(
      path.join(tmpRoot, "data/brain/questions.jsonl"),
      `${JSON.stringify({ schema: "self-question-v1", id: "selfq-phase", type: "question", kind: "self-question", question: "PCB细分谁更有投资价值？" })}\n`,
    )
    await write(
      path.join(tmpRoot, "data/brain/validations.jsonl"),
      `${JSON.stringify({ id: "val-phase", type: "validation", targetType: "self-question", validationMethod: "self_question_market_feedback_v1", result: "success" })}\n`,
    )
    await write(
      path.join(tmpRoot, "data/brain/attributions.jsonl"),
      `${JSON.stringify({ schema: "self-question-attribution-v1", id: "attr-phase", type: "attribution", kind: "self-question-attribution", attributionLabel: "price_only" })}\n`,
    )
    await write(
      path.join(tmpRoot, "data/brain/evidence_results.jsonl"),
      `${JSON.stringify({ schema: "self-question-evidence-result-v1", id: "ev-phase", type: "evidence_result", kind: "self-question-evidence-result", result: "confirmed" })}\n`,
    )
    await write(
      path.join(tmpRoot, "data/brain/policies.jsonl"),
      `${JSON.stringify({ schema: "trading-ai-policy-v1", id: "policy-phase", policyId: "policy-phase", type: "policy", status: "active", rule: "must disclose evidence gaps" })}\n`,
    )
    await write(
      path.join(tmpRoot, "data/brain/self_training_events.jsonl"),
      `${[
        {
          id: "self_train_phase_action",
          actionFingerprint: "self_train_phase_action_fp",
          type: "event",
          eventType: "self-training-action",
          rule: "R8-attribution-fundamental-gap",
          target: "PCB细分",
          action: "verify-fundamentals",
          reason: "需要补公告和订单证据。",
          createdAt: "2026-06-15 09:20:00",
        },
        {
          id: "self_train_phase_review",
          type: "event",
          eventType: "self-training-action-review",
          result: "resolved",
          reviewAction: "resolve",
          actionId: "self_train_phase_action",
          actionFingerprint: "self_train_phase_action_fp",
          sourceRule: "R8-attribution-fundamental-gap",
          sourceTarget: "PCB细分",
          sourceAction: "verify-fundamentals",
          reviewer: "codex",
          reviewQuality: "high_confidence",
          evidenceRefs: ["ev-phase", "cninfo:2026-06-15:公告"],
          createdAt: "2026-06-15 09:25:00",
        },
      ].map((item) => JSON.stringify(item)).join("\n")}\n`,
    )
    const planned = await planSelfTrainingActions({
      projectPath: tmpRoot,
      actions: [
        {
          id: "phase_plan_action",
          actionFingerprint: "phase_plan_action_fp",
          rule: "R8-attribution-fundamental-gap",
          target: "PCB细分",
          action: "verify-fundamentals",
          reason: "补证后再训练。",
          evidenceTasks: [{
            provider: "cninfo",
            signal: "cninfo_announcement",
            evidenceType: "announcement",
            command: "npm run codex:ingest -- company-research --stock 'SH600183' --deep --cninfo-event-from 2025-01-01",
          }],
        },
      ],
      generatedAt: "2026-06-15 09:30:00",
      write: true,
    })
    await write(
      path.join(tmpRoot, ".llm-wiki/self-question-runs/20260615093500-loop/manifest.json"),
      `${JSON.stringify({
        schema: "self-question-loop-run-v1",
        runId: "self_question_loop_phase_status",
        status: "ok",
        stages: [{ stage: "self-train-plan-verify", status: "ok" }],
        outputs: {
          selfTrainingPlan: planned.writeResult.relativePath,
          selfTrainingPlanVerification: { status: "ok", checked: 1, failed: 0, issueCount: 0 },
        },
      })}\n`,
    )
    await write(
      path.join(tmpRoot, ".llm-wiki/self-question-runs/20260615093800-phase-run/manifest.json"),
      `${JSON.stringify({
        schema: "recursive-ai-phase-run-v1",
        mode: "self-question-phase-run",
        generatedAt: "2026-06-15 09:38:00",
        projectPath: tmpRoot,
        status: "max_gates_reached",
        dryRun: false,
        executed: true,
        maxGates: 3,
        executedCount: 3,
        stopReason: "max_gates_reached",
        writePolicy: {
          wroteWiki: false,
          wroteRaw: false,
          writes: "declared stage outputs only",
        },
      })}\n`,
    )
    await exportTrainingSamples({ projectPath: tmpRoot, kind: "eval" })
    const autoresearchProgram = await createAutoresearchProgram({
      projectPath: tmpRoot,
      title: "PCB 细分价值实验",
      hypothesis: "把 PCB 细分候选池拆开后，验证任务更容易形成可行动市场反馈。",
      lanes: "PCB链,光纤链",
      slug: "pcb-segment-value",
      generatedAt: "2026-06-15 09:39:00",
      write: true,
    })
    await appendAutoresearchExperiment({
      projectPath: tmpRoot,
      programId: autoresearchProgram.program.id,
      hypothesis: "细分候选池能提升归因质量。",
      changedArtifact: "segment_config",
      baselineScore: 2,
      newScore: 3,
      manifestPath: ".llm-wiki/self-question-runs/20260615093800-phase-run/manifest.json",
      generatedAt: "2026-06-15 09:39:30",
      write: true,
    })

    const status = await getRecursiveAiPhaseStatus({ projectPath: tmpRoot, generatedAt: "2026-06-15 09:40:00" })
    expect(status).toMatchObject({
      schema: "recursive-ai-phase-status-v1",
      mode: "self-question-phase-status",
      currentPhase: 4,
      finalPhase: 5,
      status: "in_progress",
      writePolicy: {
        readOnly: true,
        wroteWiki: false,
        wroteRaw: false,
        wroteBrain: false,
        wroteArtifacts: false,
      },
    })
    expect(status.counts).toMatchObject({
      agentRuns: 1,
      selfQuestions: 1,
      marketValidations: 1,
      attributions: 1,
      evidenceResults: 1,
      activePolicies: 1,
      selfTrainingActions: 1,
      selfTrainingReviewedActions: 1,
      selfTrainingPlans: 1,
      selfQuestionLoops: 1,
      recursiveAiPhaseRuns: 1,
      trainingExportEntries: 1,
      autoresearchPrograms: 1,
      autoresearchExperiments: 1,
      autoresearchExperimentDecisions: {
        review_required: 1,
      },
    })
    expect(status.counts.highConfidenceSamples).toBeGreaterThanOrEqual(1)
    expect(status.phases.find((item) => item.phase === 4)).toMatchObject({ status: "active" })
    expect(status.phases.find((item) => item.phase === 4)).toMatchObject({
      evidence: {
        autoresearchPrograms: 1,
        autoresearchExperiments: 1,
        autoresearchStatus: "experiment_ledger_active",
      },
    })
    expect(status.autoresearchReadiness).toMatchObject({
      schema: "trading-autoresearch-readiness-v1",
      status: "experiment_ledger_active",
      phase5Unlocks: false,
      counts: {
        researchPrograms: 1,
        experiments: 1,
        decisions: {
          review_required: 1,
        },
      },
      writePolicy: {
        readOnly: true,
        wroteWiki: false,
        wroteRaw: false,
        phase5Unlocks: false,
      },
    })
    expect(status.phases.find((item) => item.phase === 5)).toMatchObject({
      status: "planned_manual_gate",
      evidence: {
        autoExecute: false,
        readiness: "ready_for_human_approval",
        blockingGates: [],
      },
    })
    expect(status.phase5Readiness).toMatchObject({
      schema: "recursive-ai-phase5-readiness-v1",
      status: "ready_for_human_approval",
      autoExecuteAllowed: false,
      humanApprovalRequired: true,
      blockingGates: [],
      approvalGate: {
        gate: "human_phase5_approval",
        status: "required",
      },
    })
    expect(status.phase5Readiness.gates.find((item) => item.gate === "phase_run_audit")).toMatchObject({ status: "passed" })
    expect(status.phase5Readiness.gates.find((item) => item.gate === "latest_phase_run_progress")).toMatchObject({ status: "passed" })
    expect(status.phase5Readiness.gates.find((item) => item.gate === "high_confidence_samples")).toMatchObject({ status: "passed" })
    const readyCheck = await checkRecursiveAiPhase5Readiness({ projectPath: tmpRoot })
    expect(readyCheck).toMatchObject({
      schema: "recursive-ai-phase5-check-v1",
      mode: "self-question-phase-check",
      status: "ready_for_human_approval",
      ready: true,
      exitCode: 0,
      blockingGates: [],
      approvalGate: {
        gate: "human_phase5_approval",
        status: "required",
      },
    })
    expect(status.nextActions.map((item) => item.gate)).toContain("verify_training_exports")
    expect(status.nextActions.map((item) => item.gate)).not.toContain("verify_self_training_plans")
    expect(status.nextActions.map((item) => item.gate)).not.toContain("generate_self_questions")
    expect(status.nextActions.find((item) => item.gate === "verify_training_exports").command).toContain("export-samples verify")
  })

  it("does not count insufficient self-question feedback as phase-five ready", async () => {
    await write(
      path.join(tmpRoot, "data/brain/questions.jsonl"),
      `${JSON.stringify({ schema: "self-question-v1", id: "selfq-insufficient-phase", type: "question", kind: "self-question", question: "AI硬件链是否有反馈？" })}\n`,
    )
    await write(
      path.join(tmpRoot, "data/brain/validations.jsonl"),
      `${JSON.stringify({
        id: "val-insufficient-phase",
        type: "validation",
        kind: "self-question-market-validation",
        targetType: "self-question",
        validationMethod: "self_question_market_feedback_v1",
        result: "insufficient",
        verdict: "证据不足",
        marketValidation: { status: "insufficient", verdict: "证据不足" },
      })}\n`,
    )
    await write(
      path.join(tmpRoot, "data/brain/attributions.jsonl"),
      `${JSON.stringify({
        schema: "self-question-attribution-v1",
        id: "attr-insufficient-phase",
        type: "attribution",
        kind: "self-question-attribution",
        attributionLabel: "insufficient",
        nextAction: "wait_for_evidence",
      })}\n`,
    )

    const status = await getRecursiveAiPhaseStatus({ projectPath: tmpRoot, generatedAt: "2026-06-15 10:00:00" })

    expect(status.counts).toMatchObject({
      selfQuestions: 1,
      marketValidations: 1,
      actionableMarketValidations: 0,
      attributions: 1,
      actionableAttributions: 0,
    })
    const feedbackGate = status.phase5Readiness.gates.find((item) => item.gate === "self_question_feedback")
    expect(feedbackGate).toMatchObject({
      status: "blocked",
      evidence: {
        marketValidations: 1,
        actionableMarketValidations: 0,
        attributions: 1,
        actionableAttributions: 0,
      },
    })
    expect(status.nextActions.map((item) => item.gate)).toEqual(["validate_market_feedback"])
    expect(status.nextActions[0].command).toContain("--max-questions 1")
    expect(status.nextActions[0].command).toContain("--validation-windows 1")
    expect(status.nextActions[0].command).toContain("--allow-anchored-external-market")
    expect(status.nextActions[0].command).toContain("--market-validate auto")
    expect(status.nextActions[0].command).toContain("--external-market-timeout-ms 3000")
  })

  it("plans and executes one recursive AI phase gate with explicit write confirmation", async () => {
    const planned = await runRecursiveAiPhaseAdvance({ projectPath: tmpRoot })
    expect(planned).toMatchObject({
      schema: "recursive-ai-phase-advance-v1",
      mode: "self-question-phase-advance",
      dryRun: true,
      executed: false,
      selectedAction: {
        gate: "generate_self_questions",
      },
      plannedInvocation: {
        kind: "self-question-loop",
        stages: ["generate"],
        requiresWrite: true,
      },
      result: null,
    })
    await expect(fs.access(path.join(tmpRoot, "data/brain/questions.jsonl"))).rejects.toThrow()
    await expect(runRecursiveAiPhaseAdvance({ projectPath: tmpRoot, execute: true }))
      .rejects.toThrow("--write is required to execute recursive AI phase gate: generate_self_questions")

    await write(
      path.join(tmpRoot, "data/brain/self_training_events.jsonl"),
      `${JSON.stringify({
        id: "phase_advance_export_action",
        actionFingerprint: "phase_advance_export_action_fp",
        type: "event",
        eventType: "self-training-action",
        rule: "R9-open-regression-gate",
        target: "policy-regression-execute",
        action: "execute-regression-gate",
        reason: "需要进入 eval 复核池。",
      })}\n`,
    )
    const executed = await runRecursiveAiPhaseAdvance({
      projectPath: tmpRoot,
      gate: "export_review_required_eval_samples",
      execute: true,
      write: true,
    })
    expect(executed).toMatchObject({
      dryRun: false,
      executed: true,
      selectedAction: {
        gate: "export_review_required_eval_samples",
      },
      plannedInvocation: {
        kind: "export-samples",
        requiresWrite: true,
      },
      result: {
        kind: "eval",
        qualityGate: "review_required",
        count: 1,
      },
      afterStatus: {
        counts: {
          trainingExportEntries: 1,
        },
      },
    })
    expect(await read(executed.result.outputPath)).toContain("phase_advance_export_action")
  })

  it("plans and runs bounded recursive AI phase gates", async () => {
    const planned = await runRecursiveAiPhaseRun({ projectPath: tmpRoot, maxGates: 3 })
    expect(planned).toMatchObject({
      schema: "recursive-ai-phase-run-v1",
      mode: "self-question-phase-run",
      dryRun: true,
      executed: false,
      maxGates: 3,
      status: "planned",
    })
    expect(planned.steps.map((step) => step.gate)).toEqual([
      "generate_self_questions",
    ])
    expect(planned.steps.every((step) => step.requiresWrite)).toBe(true)
    expect(planned.manifestRelativePath).toMatch(/^\.llm-wiki\/self-question-runs\/.+-phase-run\/manifest\.json$/)
    const plannedManifest = JSON.parse(await read(planned.manifestPath))
    expect(plannedManifest).toMatchObject({
      schema: "recursive-ai-phase-run-v1",
      status: "planned",
      dryRun: true,
      executed: false,
      steps: [
        { gate: "generate_self_questions", status: "planned" },
      ],
      writePolicy: {
        wroteWiki: false,
        wroteRaw: false,
      },
    })
    const noArtifact = await runRecursiveAiPhaseRun({
      projectPath: tmpRoot,
      generatedAt: "2026-06-15 10:01:00",
      maxGates: 1,
      phaseRunArtifacts: false,
    })
    expect(noArtifact.manifestPath).toBeNull()
    expect(noArtifact.manifestRelativePath).toBeNull()
    await expect(fs.access(path.join(tmpRoot, "data/brain/questions.jsonl"))).rejects.toThrow()
    let caught = null
    try {
      await runRecursiveAiPhaseRun({ projectPath: tmpRoot, execute: true })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(Error)
    expect(caught.message).toContain("--write is required to execute recursive AI phase gate: generate_self_questions")
    expect(caught.manifestRelativePath).toMatch(/^\.llm-wiki\/self-question-runs\/.+-phase-run\/manifest\.json$/)
    const failureManifest = JSON.parse(await read(caught.manifestPath))
    expect(failureManifest).toMatchObject({
      schema: "recursive-ai-phase-run-v1",
      status: "failed",
      dryRun: false,
      executed: false,
      error: "--write is required to execute recursive AI phase gate: generate_self_questions",
    })

    await write(
      path.join(tmpRoot, "data/brain/questions.jsonl"),
      [
        {
          id: "phase_run_question",
          schema: "self-question-v1",
          question: "phase run 是否能继续向后推进？",
        },
        {
          id: "phase_run_validation",
          kind: "self-question-market-validation",
          questionId: "phase_run_question",
          status: "validated",
        },
        {
          id: "phase_run_attribution",
          schema: "self-question-attribution-v1",
          questionId: "phase_run_question",
          attributionLabel: "price_only",
        },
      ].map((item) => JSON.stringify(item)).join("\n") + "\n",
    )
    await write(
      path.join(tmpRoot, "data/brain/self_training_events.jsonl"),
      `${JSON.stringify({
        id: "phase_run_action",
        actionFingerprint: "phase_run_action_fp",
        type: "event",
        eventType: "self-training-action",
        rule: "R9-open-regression-gate",
        target: "policy-regression-execute",
        action: "execute-regression-gate",
        reason: "用于 phase-run 计划验证。",
      })}\n`,
    )
    const executed = await runRecursiveAiPhaseRun({
      projectPath: tmpRoot,
      execute: true,
      write: true,
      maxGates: 3,
    })
    expect(executed).toMatchObject({
      dryRun: false,
      executed: true,
      maxGates: 3,
      status: "max_gates_reached",
      executedCount: 3,
    })
    expect(executed.steps.map((step) => step.gate)).toEqual([
      "plan_self_training_handoffs",
      "export_review_required_eval_samples",
      "review_actions_for_high_confidence_labels",
    ])
    expect(executed.steps[0]).toMatchObject({
      kind: "self-train-plan",
      requiresWrite: true,
      result: {
        schema: "self-training-action-plan-run-v1",
        dryRun: false,
        counts: {
          actions: 1,
        },
      },
    })
    expect(executed.steps[1]).toMatchObject({
      kind: "export-samples",
      requiresWrite: true,
      result: {
        kind: "eval",
        qualityGate: "review_required",
        count: 2,
      },
    })
    expect(executed.steps[2]).toMatchObject({
      kind: "self-train-actions",
      requiresWrite: false,
      result: {
        mode: "self-train-actions",
        counts: {
          open: 1,
        },
      },
    })
    expect(executed.afterStatus.counts.selfTrainingPlans).toBe(1)
    expect(executed.afterStatus.counts.trainingExportEntries).toBe(1)
    expect(executed.afterStatus.nextActions[0].gate).toBe("review_actions_for_high_confidence_labels")
    expect(JSON.parse(await read(executed.manifestPath))).toMatchObject({
      schema: "recursive-ai-phase-run-v1",
      status: "max_gates_reached",
      executedCount: 3,
      steps: [
        { gate: "plan_self_training_handoffs" },
        { gate: "export_review_required_eval_samples" },
        { gate: "review_actions_for_high_confidence_labels" },
      ],
    })
    const phaseStatus = await getRecursiveAiPhaseStatus({ projectPath: tmpRoot })
    expect(phaseStatus.counts).toMatchObject({
      recursiveAiPhaseRuns: 3,
      recursiveAiPhaseRunsByStatus: {
        planned: 1,
        failed: 1,
        max_gates_reached: 1,
      },
    })
    expect(phaseStatus.counts.latestRecursiveAiPhaseRun).toMatchObject({
      status: "max_gates_reached",
      relativePath: expect.stringMatching(/\.llm-wiki\/self-question-runs\/.+-phase-run\/manifest\.json$/),
    })
    expect(phaseStatus.phases.find((item) => item.phase === 4).evidence).toMatchObject({
      phaseRuns: 3,
      phaseRunStatuses: {
        planned: 1,
        failed: 1,
        max_gates_reached: 1,
      },
    })
  })

  it("phase-run stops after non-actionable validation instead of running attribution", async () => {
    await write(
      path.join(tmpRoot, "data/brain/questions.jsonl"),
      `${JSON.stringify({
        schema: "self-question-v1",
        id: "phase-run-not-due-question",
        type: "question",
        kind: "self-question",
        questionId: "phase_run_not_due",
        branch: "机器人/物理AI",
        question: "机器人链生成后是否已经有市场反馈？",
        expectedMove: "bullish",
        validationWindows: ["1d"],
        stocks: [{ name: "绿的谐波", code: "SH688017", branch: "机器人/物理AI" }],
        status: "planned",
        createdAt: "2026-06-15 13:43:38",
      })}\n`,
    )

    const result = await runRecursiveAiPhaseRun({
      projectPath: tmpRoot,
      execute: true,
      write: true,
      maxGates: 3,
      stockDailyColumns: ["ticker", "date", "close"],
      stockDailyExecutor: async ({ nativeQuery }) => {
        expect(nativeQuery.validationAnchorDate).toBe("2026-06-15")
        return { rows: [] }
      },
    })

    expect(result).toMatchObject({
      status: "repeated_gate",
      stopReason: "repeated_gate",
      executedCount: 1,
    })
    expect(result.steps.map((step) => step.gate)).toEqual(["validate_market_feedback"])
    expect(result.steps[0].result).toMatchObject({
      schema: "self-question-loop-run-v1",
      counts: {
        validations: 0,
      },
    })
    expect(result.afterStatus.counts).toMatchObject({
      marketValidations: 0,
      actionableMarketValidations: 0,
      attributions: 0,
      actionableAttributions: 0,
    })
    expect(result.afterStatus.nextActions.map((item) => item.gate)).toEqual(["validate_market_feedback"])
    const refreshedStatus = await getRecursiveAiPhaseStatus({ projectPath: tmpRoot })
    expect(refreshedStatus.phase5Readiness.blockingGates.map((item) => item.gate)).toContain("latest_phase_run_progress")
    expect(refreshedStatus.phase5Readiness.gates.find((item) => item.gate === "latest_phase_run_progress")).toMatchObject({
      status: "blocked",
      evidence: {
        latest: {
          status: "repeated_gate",
          stopReason: "repeated_gate",
        },
      },
    })
    await expect(fs.access(path.join(tmpRoot, "data/brain/validations.jsonl"))).rejects.toThrow()
  })

  it("exports agentic ask runs as review-required eval samples", async () => {
    const runDir = path.join(tmpRoot, AGENT_RUNS_ROOT, "20260615-083000-ask")
    await write(
      path.join(runDir, "manifest.json"),
      `${JSON.stringify({
        schema: "agent-run-manifest-v1",
        runId: "agent_run_20260615083000",
        mode: "ask",
        status: "ok_with_failures",
        query: "AI服务器电源这条线现在是订单兑现还是叙事扩散？",
        provider: "codex",
        model: "gpt-test",
        concurrency: 3,
        sourceRefs: {
          wiki: [{ ref: "W1", path: "wiki/概念/AI服务器电源.md" }],
          raw: [{ ref: "R1", path: "raw/研报新闻/AI服务器电源.md" }],
        },
        roles: [
          { role: "evidence-researcher", status: "ok", summary: "证据研究完成", outputPath: `${AGENT_RUNS_ROOT}/20260615-083000-ask/agents/evidence-researcher.md` },
          { role: "counterevidence-auditor", status: "failed", error: "tool failed token=secret123" },
          { role: "market-validator", status: "ok", summary: "量价验证完成" },
        ],
        finalPath: `${AGENT_RUNS_ROOT}/20260615-083000-ask/final.md`,
      })}\n`,
    )
    await write(
      path.join(runDir, "final.md"),
      [
        "## 结论",
        "量价先行，但订单和财报证据不足。token=secret123",
        "## 后续验证",
        "补公告、招投标和财报闭环。",
      ].join("\n"),
    )

    const evalSamples = await exportTrainingSamples({ projectPath: tmpRoot, kind: "eval" })
    expect(evalSamples.count).toBe(1)
    expect(evalSamples.samples[0]).toMatchObject({
      kind: "eval",
      id: "eval_agent_run_agent_run_20260615083000",
      source: "agent-run",
      sourceRecordId: "agent_run_20260615083000",
      question: expect.stringContaining("AI服务器电源"),
      qualityGate: {
        status: "review_required",
        highConfidenceEligible: false,
        requiredAction: "review_agentic_answer",
      },
    })
    expect(evalSamples.samples[0].expected).toContain("失败角色")
    expect(evalSamples.samples[0].evidence).toMatchObject({
      runId: "agent_run_20260615083000",
      status: "ok_with_failures",
      failedRoles: ["counterevidence-auditor"],
      sourceRefs: {
        wiki: [{ ref: "W1", path: "wiki/概念/AI服务器电源.md" }],
        raw: [{ ref: "R1", path: "raw/研报新闻/AI服务器电源.md" }],
      },
    })
    expect(evalSamples.samples[0].evidence.finalExcerpt).toContain("token=[redacted]")
    expect(await read(evalSamples.outputPath)).not.toContain("secret123")

    const reviewRequired = await exportTrainingSamples({ projectPath: tmpRoot, kind: "eval", qualityGate: "review_required" })
    expect(reviewRequired.count).toBe(1)

    const highConfidence = await exportTrainingSamples({ projectPath: tmpRoot, kind: "eval", qualityGate: "high_confidence" })
    expect(highConfidence.count).toBe(0)
  })

  it("exports self-question market-feedback samples with question and evidence gaps", async () => {
    await write(
      path.join(tmpRoot, "data/brain/validations.jsonl"),
      `${JSON.stringify({
        id: "selfq-val-1",
        type: "validation",
        kind: "self-question-market-validation",
        validationMethod: "self_question_market_feedback_v1",
        questionRecordId: "selfq-1",
        questionId: "self_q_1",
        question: "未来三个月 AI服务器 PCB材料/工艺链里，CCL和高速板材料谁更可能率先兑现订单和毛利率？",
        hypothesis: "PCB材料/工艺链需要用量价、公告、订单和财报闭环验证。",
        stockName: "生益科技",
        stockCode: "SH600183",
        windowDays: 1,
        verdict: "验证通过",
        reason: "看多/补涨假设得到区间正收益支撑",
        evidenceGaps: ["fundamental:cninfo_announcement:not_checked", "fundamental:qcc_tender_or_order:not_checked"],
        marketValidation: { periodReturnPct: 4.2, amountRatio: 1.8, refs: ["sql:stock_price_daily#SH600183/2026-06-11"] },
        sourceRefs: ["wiki/股票/生益科技.md"],
      })}\n`,
    )

    const sft = await exportTrainingSamples({ projectPath: tmpRoot, kind: "sft" })
    expect(sft.count).toBe(1)
    const sftText = await read(sft.outputPath)
    expect(sftText).toContain("未来三个月 AI服务器 PCB材料")
    expect(sftText).toContain("验证通过")
    expect(sftText).toContain("cninfo_announcement")

    const evalSamples = await exportTrainingSamples({ projectPath: tmpRoot, kind: "eval" })
    expect(evalSamples.count).toBe(1)
    const sample = evalSamples.samples[0]
    expect(sample.question).toContain("自提问市场反馈")
    expect(sample.question).toContain("未来三个月 AI服务器 PCB材料")
    expect(sample.expected).toContain("验证通过")
    expect(sample.evidence.evidenceGaps).toContain("fundamental:qcc_tender_or_order:not_checked")
  })

  it("attributes self-question validation outcomes without touching wiki or raw", async () => {
    await write(
      path.join(tmpRoot, "wiki/股票/生益科技.md"),
      `${validFrontmatter("生益科技", "股票", "code: SH600183\n")}# 生益科技\n\nPCB、覆铜板、CCL。\n`,
    )
    await write(path.join(tmpRoot, "raw/研报新闻/2026-06-14-PCB.md"), "PCB材料订单和财报仍需验证。")
    await write(
      path.join(tmpRoot, "data/brain/validations.jsonl"),
      `${JSON.stringify({
        id: "selfq-val-1",
        type: "validation",
        kind: "self-question-market-validation",
        validationMethod: "self_question_market_feedback_v1",
        questionRecordId: "selfq-1",
        questionId: "self_q_1",
        question: "未来三个月 AI服务器 PCB材料/工艺链里，CCL和高速板材料谁更可能率先兑现订单和毛利率？",
        hypothesis: "PCB材料/工艺链需要用量价、公告、订单和财报闭环验证。",
        target: "PCB材料/工艺链",
        stockName: "生益科技",
        stockCode: "SH600183",
        windowDays: 1,
        verdict: "验证通过",
        reason: "看多/补涨假设得到区间正收益支撑",
        evidenceGaps: ["fundamental:cninfo_announcement:not_checked", "fundamental:qcc_tender_or_order:not_checked"],
        marketValidation: { status: "ready", periodReturnPct: 4.2, amountRatio: 1.8, refs: ["sql:stock_price_daily#SH600183/2026-06-11"] },
        sourceRefs: ["wiki/股票/生益科技.md", "raw/研报新闻/2026-06-14-PCB.md"],
        createdAt: "2026-06-11 16:00:00",
      })}\n`,
    )
    const wikiBefore = await read(path.join(tmpRoot, "wiki/股票/生益科技.md"))
    const rawBefore = await read(path.join(tmpRoot, "raw/研报新闻/2026-06-14-PCB.md"))

    const dryRun = await attributeSelfQuestionValidations({ projectPath: tmpRoot, id: "selfq-val-1" })
    expect(dryRun.dryRun).toBe(true)
    expect(dryRun.attributions).toHaveLength(1)
    expect(dryRun.attributions[0]).toMatchObject({
      schema: "self-question-attribution-v1",
      type: "attribution",
      kind: "self-question-attribution",
      validationId: "selfq-val-1",
      questionRecordId: "selfq-1",
      attributionLabel: "price_only",
      confidenceImpact: "positive_but_unconfirmed",
      nextAction: "verify_fundamentals",
    })
    expect(dryRun.attributions[0].evidenceGaps).toContain("fundamental:qcc_tender_or_order:not_checked")
    await expect(fs.access(path.join(tmpRoot, "data/brain/attributions.jsonl"))).rejects.toThrow()

    const written = await attributeSelfQuestionValidations({ projectPath: tmpRoot, id: "self_q_1", write: true })
    expect(written.writeResult).toMatchObject({ relativePath: "data/brain/attributions.jsonl", records: 1 })
    const lines = (await read(path.join(tmpRoot, "data/brain/attributions.jsonl"))).trim().split(/\r?\n/)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain("price_only")
    expect(await read(path.join(tmpRoot, "wiki/股票/生益科技.md"))).toBe(wikiBefore)
    expect(await read(path.join(tmpRoot, "raw/研报新闻/2026-06-14-PCB.md"))).toBe(rawBefore)

    const deduped = await attributeSelfQuestionValidations({ projectPath: tmpRoot, id: "selfq-val-1", write: true })
    expect(deduped.attributions).toHaveLength(0)
    expect(deduped.counts.existing).toBe(1)
    const dedupedLines = (await read(path.join(tmpRoot, "data/brain/attributions.jsonl"))).trim().split(/\r?\n/)
    expect(dedupedLines).toHaveLength(1)
  })

  it("self-question loop orchestrates question, validation, attribution, self-train and exports with an audit manifest", async () => {
    await write(
      path.join(tmpRoot, "wiki/股票/生益科技.md"),
      `${validFrontmatter("生益科技", "股票", "code: SH600183\n")}# 生益科技\n\nPCB、覆铜板、CCL、AI服务器高速板材料验证。\n`,
    )
    await write(path.join(tmpRoot, "raw/研报新闻/2026-06-14-PCB.md"), "PCB材料需要用量价、公告、招投标和财报闭环验证。")
    const wikiBefore = await read(path.join(tmpRoot, "wiki/股票/生益科技.md"))
    const rawBefore = await read(path.join(tmpRoot, "raw/研报新闻/2026-06-14-PCB.md"))

    const result = await runSelfQuestionLoop({
      projectPath: tmpRoot,
      stages: "generate,validate,attribute,self-train,export,export-verify",
      questionCount: 1,
      validationWindows: "1",
      exportKinds: "sft,eval",
      exportVerifyConcurrency: 2,
      marketValidate: "off",
      write: true,
      selfQuestionPlanner: async () => ({
        questions: [
          {
            questionType: "expected_difference",
            themeId: "ai-pcb-materials",
            branch: "PCB材料/工艺链",
            question: "未来三个月 AI服务器 PCB材料/工艺链里，CCL和高速板材料谁更可能率先兑现订单和毛利率？",
            expectedMove: "bullish",
            stockCodes: ["SH600183"],
          },
        ],
      }),
      stockDailyColumns: ["ticker", "date", "close", "amount", "pct_cng"],
      stockDailyExecutor: async () => ({
        rows: [{ ticker: "SH600183", date: "2026-06-11", close: 33, amount: 3600, pct_cng: 4.2 }],
      }),
    })

    expect(result.dryRun).toBe(false)
    expect(result.stages.map((stage) => stage.stage)).toEqual(["generate", "validate", "attribute", "self-train", "export", "export-verify"])
    expect(result.counts).toMatchObject({ questions: 1, validations: 1, attributions: 1 })
    expect(result.selfTraining.actions.map((action) => action.rule)).toContain("R8-attribution-fundamental-gap")
    expect(result.exports.map((item) => item.kind).sort()).toEqual(["eval", "sft"])
    expect(result.exports.every((item) => item.manifestRelativePath?.endsWith(".manifest.json"))).toBe(true)
    expect(result.exportVerificationRun).toMatchObject({
      status: "ok",
      checked: 2,
      failed: 0,
      issueCount: 0,
      concurrency: 2,
      verdict: { status: "passed" },
    })
    expect(result.manifestRelativePath).toMatch(/^\.llm-wiki\/self-question-runs\/.+-loop\/manifest\.json$/)
    const manifest = JSON.parse(await read(result.manifestPath))
    expect(manifest.schema).toBe("self-question-loop-run-v1")
    expect(manifest.status).toBe("ok")
    expect(manifest.timing).toMatchObject({
      startedAt: expect.any(String),
      finishedAt: expect.any(String),
      durationMs: expect.any(Number),
    })
    expect(manifest.stages.map((stage) => stage.status)).toEqual(["ok", "ok", "ok", "ok", "ok", "ok"])
    expect(manifest.stages.every((stage) => typeof stage.durationMs === "number" && stage.startedAt && stage.finishedAt)).toBe(true)
    expect(manifest.stages.at(-1)).toMatchObject({
      stage: "export-verify",
      status: "ok",
      counts: { checked: 2, failed: 0, issues: 0, concurrency: 2 },
      verdict: { status: "passed" },
    })
    expect(manifest.counts).toMatchObject({ exportVerificationChecked: 2, exportVerificationFailures: 0, exportVerificationIssues: 0, exportVerificationConcurrency: 2 })
    expect(manifest.outputs.exportVerification).toMatchObject({ status: "ok", checked: 2, failed: 0, issueCount: 0, concurrency: 2 })
    expect(await read(path.join(tmpRoot, "data/brain/questions.jsonl"))).toContain("self-question-v1")
    expect(await read(path.join(tmpRoot, "data/brain/validations.jsonl"))).toContain("self_question_market_feedback_v1")
    expect(await read(path.join(tmpRoot, "data/brain/attributions.jsonl"))).toContain("price_only")
    expect(await read(path.join(tmpRoot, "wiki/股票/生益科技.md"))).toBe(wikiBefore)
    expect(await read(path.join(tmpRoot, "raw/研报新闻/2026-06-14-PCB.md"))).toBe(rawBefore)
  })

  it("self-question loop can plan and verify in-memory self-training actions", async () => {
    await write(
      path.join(tmpRoot, "wiki/股票/生益科技.md"),
      `${validFrontmatter("生益科技", "股票", "code: SH600183\n")}# 生益科技\n\nPCB、覆铜板、CCL、AI服务器高速板材料验证。\n`,
    )
    await write(path.join(tmpRoot, "raw/研报新闻/2026-06-14-PCB.md"), "PCB材料需要用量价、公告、招投标和财报闭环验证。")

    const result = await runSelfQuestionLoop({
      projectPath: tmpRoot,
      stages: "generate,validate,attribute,self-train,self-train-plan,self-train-plan-verify",
      questionCount: 1,
      validationWindows: "1",
      marketValidate: "off",
      write: true,
      selfQuestionPlanner: async () => ({
        questions: [
          {
            questionType: "expected_difference",
            themeId: "ai-pcb-materials",
            branch: "PCB材料/工艺链",
            question: "未来三个月 AI服务器 PCB材料/工艺链里，CCL和高速板材料谁更可能率先兑现订单和毛利率？",
            expectedMove: "bullish",
            stockCodes: ["SH600183"],
          },
        ],
      }),
      stockDailyColumns: ["ticker", "date", "close", "amount", "pct_cng"],
      stockDailyExecutor: async () => ({
        rows: [{ ticker: "SH600183", date: "2026-06-11", close: 33, amount: 3600, pct_cng: 4.2 }],
      }),
    })

    expect(result.status).toBe("ok")
    expect(result.stages.map((stage) => [stage.stage, stage.status])).toEqual([
      ["generate", "ok"],
      ["validate", "ok"],
      ["attribute", "ok"],
      ["self-train", "ok"],
      ["self-train-plan", "ok"],
      ["self-train-plan-verify", "ok"],
    ])
    expect(result.selfTraining.writeResult).toBeNull()
    expect(result.selfTrainingPlanRun).toMatchObject({
      schema: "self-training-action-plan-run-v1",
      dryRun: false,
      counts: { actions: 1 },
      sourceLedger: {
        source: "in-memory-self-training-actions",
      },
    })
    expect(result.selfTrainingPlanRun.writeResult.relativePath).toMatch(/^\.llm-wiki\/self-training-plans\/.+-self-training-plan\.json$/)
    expect(result.selfTrainingPlanVerificationRun).toMatchObject({
      schema: "self-training-action-plan-verify-v1",
      status: "ok",
      checked: 1,
      failed: 0,
      issueCount: 0,
      verdict: { status: "passed" },
    })
    const plan = JSON.parse(await read(result.selfTrainingPlanRun.writeResult.filePath))
    expect(plan.actions[0]).toMatchObject({
      sourceRule: "R8-attribution-fundamental-gap",
      steps: expect.arrayContaining([
        expect.objectContaining({
          type: "evidence-task",
          status: "planned",
          autoExecute: false,
        }),
      ]),
    })
    await expect(fs.access(path.join(tmpRoot, "data/brain/self_training_events.jsonl"))).rejects.toThrow()
    const manifest = JSON.parse(await read(result.manifestPath))
    expect(manifest.counts).toMatchObject({
      selfTrainingActions: 1,
      selfTrainingPlanActions: 1,
      selfTrainingPlanVerificationChecked: 1,
      selfTrainingPlanVerificationFailures: 0,
    })
    expect(manifest.outputs.selfTrainingPlan).toBe(result.selfTrainingPlanRun.writeResult.relativePath)
    expect(manifest.outputs.selfTrainingPlanVerification).toMatchObject({
      status: "ok",
      checked: 1,
      failed: 0,
      issueCount: 0,
    })
    expect(manifest.gateSummary).toMatchObject({ status: "passed", recommendedNextStages: [] })
  })

  it("self-question loop plan verification does not pass a dry-run plan by reusing old artifacts", async () => {
    await planSelfTrainingActions({
      projectPath: tmpRoot,
      actions: [
        {
          id: "old-self-training-action",
          actionFingerprint: "old-self-training-action",
          rule: "R6-error-guardrail-escalation",
          target: "旧动作",
          action: "escalate-guardrail",
          reason: "old plan should not validate the current dry-run plan",
        },
      ],
      write: true,
    })
    await write(
      path.join(tmpRoot, "wiki/股票/生益科技.md"),
      `${validFrontmatter("生益科技", "股票", "code: SH600183\n")}# 生益科技\n\nPCB、覆铜板、CCL、AI服务器高速板材料验证。\n`,
    )
    await write(path.join(tmpRoot, "raw/研报新闻/2026-06-14-PCB.md"), "PCB材料需要用量价、公告、招投标和财报闭环验证。")

    const result = await runSelfQuestionLoop({
      projectPath: tmpRoot,
      stages: "generate,validate,attribute,self-train,self-train-plan,self-train-plan-verify",
      questionCount: 1,
      validationWindows: "1",
      marketValidate: "off",
      loopArtifacts: false,
      selfQuestionPlanner: async () => ({
        questions: [
          {
            questionType: "expected_difference",
            themeId: "ai-pcb-materials",
            branch: "PCB材料/工艺链",
            question: "未来三个月 AI服务器 PCB材料/工艺链里，CCL和高速板材料谁更可能率先兑现订单和毛利率？",
            expectedMove: "bullish",
            stockCodes: ["SH600183"],
          },
        ],
      }),
      stockDailyColumns: ["ticker", "date", "close", "amount", "pct_cng"],
      stockDailyExecutor: async () => ({
        rows: [{ ticker: "SH600183", date: "2026-06-11", close: 33, amount: 3600, pct_cng: 4.2 }],
      }),
    })

    expect(result.selfTrainingPlanRun).toMatchObject({ dryRun: true, writeResult: null })
    expect(result.selfTrainingPlanVerificationRun).toMatchObject({
      checked: 0,
      failed: 0,
      issueCount: 0,
      verdict: {
        status: "planned",
        nextStages: ["self-train-plan", "self-train-plan-verify"],
      },
    })
    expect(result.status).toBe("planned")
    expect(result.stages.at(-1)).toMatchObject({
      stage: "self-train-plan-verify",
      status: "planned",
    })
    expect(result.gateSummary).toMatchObject({
      status: "planned",
      recommendedNextStages: ["self-train-plan", "self-train-plan-verify"],
    })
  })

  it("self-question loop export stage can apply training sample quality gates", async () => {
    await write(
      path.join(tmpRoot, "data/brain/attributions.jsonl"),
      `${[
        {
          schema: "self-question-attribution-v1",
          id: "selfqa-high-confidence",
          type: "attribution",
          kind: "self-question-attribution",
          attributionMethod: "self_question_attribution_v1",
          validationId: "selfq-val-high-confidence",
          questionRecordId: "selfq-high-confidence",
          questionId: "self_q_high_confidence",
          question: "AI服务器 PCB材料 是否已经从量价先行进入公告兑现？",
          hypothesis: "PCB材料需要公告补证。",
          stockName: "生益科技",
          stockCode: "SH600183",
          verdict: "验证通过",
          attributionLabel: "price_only",
          confidenceImpact: "positive_but_unconfirmed",
          nextAction: "verify_fundamentals",
          evidenceGaps: ["fundamental:cninfo_announcement:not_checked"],
        },
        {
          schema: "self-question-attribution-v1",
          id: "selfqa-needs-evidence",
          type: "attribution",
          kind: "self-question-attribution",
          attributionMethod: "self_question_attribution_v1",
          validationId: "selfq-val-needs-evidence",
          questionRecordId: "selfq-needs-evidence",
          questionId: "self_q_needs_evidence",
          question: "AI服务器 PCB材料 是否只有量价反馈？",
          hypothesis: "PCB材料需要公告补证。",
          stockName: "生益科技",
          stockCode: "SH600183",
          verdict: "验证通过",
          attributionLabel: "price_only",
          confidenceImpact: "positive_but_unconfirmed",
          nextAction: "verify_fundamentals",
          evidenceGaps: ["fundamental:cninfo_announcement:not_checked"],
        },
      ].map((item) => JSON.stringify(item)).join("\n")}\n`,
    )
    await write(
      path.join(tmpRoot, "data/brain/evidence_results.jsonl"),
      `${JSON.stringify({
        schema: "self-question-evidence-result-v1",
        id: "evidence_result_high_confidence_1",
        type: "evidence_result",
        kind: "self-question-evidence-result",
        attributionId: "selfqa-high-confidence",
        validationId: "selfq-val-high-confidence",
        questionRecordId: "selfq-high-confidence",
        questionId: "self_q_high_confidence",
        provider: "cninfo",
        signal: "cninfo_announcement",
        evidenceGap: "fundamental:cninfo_announcement:not_checked",
        result: "confirmed",
        status: "resolved",
        summary: "公告补证已确认。",
        sourceRefs: ["cninfo:2026-06-14:公告"],
      })}\n`,
    )

    const result = await runSelfQuestionLoop({
      projectPath: tmpRoot,
      stages: "export",
      exportKinds: "sft,eval",
      exportQualityGate: "high_confidence",
      write: true,
    })

    expect(result.exports).toEqual([
      expect.objectContaining({ kind: "sft", qualityGate: "high_confidence", count: 1 }),
      expect.objectContaining({ kind: "eval", qualityGate: "high_confidence", count: 1 }),
    ])
    expect(result.exports.every((item) => item.relativePath.includes("high_confidence"))).toBe(true)
    expect(result.exports.every((item) => item.manifestRelativePath.includes("high_confidence"))).toBe(true)
    expect(result.exports.every((item) => item.ledgerRelativePath === ".llm-wiki/exports/training/export-ledger.jsonl")).toBe(true)
    expect(await read(result.exports.find((item) => item.kind === "sft").outputPath)).toContain("selfqa-high-confidence")
    expect(await read(result.exports.find((item) => item.kind === "sft").outputPath)).not.toContain("selfqa-needs-evidence")
    const exportManifest = JSON.parse(await read(result.exports.find((item) => item.kind === "sft").manifestPath))
    expect(exportManifest).toMatchObject({
      schema: "training-sample-export-manifest-v1",
      kind: "sft",
      qualityGate: "high_confidence",
      count: 1,
      qualityGateCounts: {
        eligible: 1,
      },
      highConfidenceEligible: 1,
      highConfidenceBlocked: 0,
    })

    const manifest = JSON.parse(await read(result.manifestPath))
    expect(manifest.stages).toEqual([
      expect.objectContaining({
        stage: "export",
        status: "ok",
        counts: { exports: 2, samples: 2 },
        qualityGate: "high_confidence",
        manifests: result.exports.map((item) => item.manifestRelativePath),
        ledgers: [".llm-wiki/exports/training/export-ledger.jsonl"],
      }),
    ])
    expect(manifest.outputs.exports.every((item) => item.includes("high_confidence"))).toBe(true)
    expect(manifest.outputs.exportManifests).toEqual(result.exports.map((item) => item.manifestRelativePath))
    expect(manifest.outputs.exportLedgers).toEqual([".llm-wiki/exports/training/export-ledger.jsonl"])
  })

  it("self-question loop gates broken training export integrity without crashing", async () => {
    await write(
      path.join(tmpRoot, "data/brain/validations.jsonl"),
      `${JSON.stringify({ id: "val-loop-verify-1", type: "validation", prediction: "AI服务器电源看多", verdict: "验证通过" })}\n`,
    )
    const exported = await exportTrainingSamples({ projectPath: tmpRoot, kind: "eval" })
    await fs.rm(exported.manifestPath)

    const result = await runSelfQuestionLoop({
      projectPath: tmpRoot,
      stages: "export-verify",
      exportKinds: "eval",
    })

    expect(result.status).toBe("needs_remediation")
    expect(result.stages).toHaveLength(1)
    expect(result.stages[0]).toMatchObject({
      stage: "export-verify",
      status: "needs_remediation",
      counts: { checked: 1, failed: 1, issues: 1 },
      verdict: {
        status: "needs_remediation",
        nextStages: ["export", "export-verify"],
      },
    })
    expect(result.exportVerificationRun.entries[0].issues).toEqual([expect.objectContaining({ code: "missing_manifest" })])
    expect(result.gateSummary).toMatchObject({
      status: "needs_remediation",
      recommendedNextStages: ["export", "export-verify"],
    })
    const manifest = JSON.parse(await read(result.manifestPath))
    expect(manifest.status).toBe("needs_remediation")
    expect(manifest.outputs.exportVerification).toMatchObject({ status: "failed", checked: 1, failed: 1, issueCount: 1 })
  })

  it("self-question loop dry-run carries generated records through validation and attribution without brain writes", async () => {
    await write(
      path.join(tmpRoot, "wiki/股票/生益科技.md"),
      `${validFrontmatter("生益科技", "股票", "code: SH600183\n")}# 生益科技\n\nPCB、覆铜板、CCL、AI服务器高速板材料验证。\n`,
    )
    await write(path.join(tmpRoot, "raw/研报新闻/2026-06-14-PCB.md"), "PCB材料需要用量价、公告、招投标和财报闭环验证。")

    const result = await runSelfQuestionLoop({
      projectPath: tmpRoot,
      stages: "generate,validate,attribute",
      questionCount: 1,
      validationWindows: "1",
      marketValidate: "off",
      selfQuestionPlanner: async () => ({
        questions: [
          {
            questionType: "expected_difference",
            themeId: "ai-pcb-materials",
            branch: "PCB材料/工艺链",
            question: "未来三个月 AI服务器 PCB材料/工艺链里，CCL和高速板材料谁更可能率先兑现订单和毛利率？",
            expectedMove: "bullish",
            stockCodes: ["SH600183"],
          },
        ],
      }),
      stockDailyColumns: ["ticker", "date", "close", "amount", "pct_cng"],
      stockDailyExecutor: async () => ({
        rows: [{ ticker: "SH600183", date: "2026-06-11", close: 33, amount: 3600, pct_cng: 4.2 }],
      }),
    })

    expect(result.dryRun).toBe(true)
    expect(result.counts).toMatchObject({ questions: 1, validations: 1, attributions: 1 })
    expect(result.stages.map((stage) => [stage.stage, stage.status])).toEqual([
      ["generate", "ok"],
      ["validate", "ok"],
      ["attribute", "ok"],
    ])
    expect(result.outputs).toMatchObject({ questions: null, validations: null, attributions: null })
    await expect(fs.access(path.join(tmpRoot, "data/brain/questions.jsonl"))).rejects.toThrow()
    await expect(fs.access(path.join(tmpRoot, "data/brain/validations.jsonl"))).rejects.toThrow()
    await expect(fs.access(path.join(tmpRoot, "data/brain/attributions.jsonl"))).rejects.toThrow()
    expect(result.manifestRelativePath).toMatch(/^\.llm-wiki\/self-question-runs\/.+-loop\/manifest\.json$/)
  })

  it("self-question loop can collect in-memory evidence tasks as an optional stage", async () => {
    await write(
      path.join(tmpRoot, "wiki/股票/生益科技.md"),
      `${validFrontmatter("生益科技", "股票", "code: SH600183\n")}# 生益科技\n\nPCB、覆铜板、CCL、AI服务器高速板材料验证。\n`,
    )

    const result = await runSelfQuestionLoop({
      projectPath: tmpRoot,
      stages: "generate,validate,attribute,evidence",
      questionCount: 1,
      validationWindows: "1",
      marketValidate: "off",
      selfQuestionPlanner: async () => ({
        questions: [
          {
            questionType: "expected_difference",
            themeId: "ai-pcb-materials",
            branch: "PCB材料/工艺链",
            question: "未来三个月 AI服务器 PCB材料/工艺链里，CCL和高速板材料谁更可能率先兑现订单和毛利率？",
            expectedMove: "bullish",
            stockCodes: ["SH600183"],
          },
        ],
      }),
      stockDailyColumns: ["ticker", "date", "close", "amount", "pct_cng"],
      stockDailyExecutor: async () => ({
        rows: [{ ticker: "SH600183", date: "2026-06-11", close: 33, amount: 3600, pct_cng: 4.2 }],
      }),
    })

    expect(result.dryRun).toBe(true)
    expect(result.stages.map((stage) => [stage.stage, stage.status])).toEqual([
      ["generate", "ok"],
      ["validate", "ok"],
      ["attribute", "ok"],
      ["evidence", "ok"],
    ])
    expect(result.counts).toMatchObject({ questions: 1, validations: 1, attributions: 1, evidenceTasks: 4 })
    expect(result.evidenceRun.tasks.map((task) => task.provider)).toEqual(["cninfo", "qichacha", "tushare_or_cninfo", "manual_or_external"])
    expect(result.outputs.evidenceTasks).toBe(null)
    await expect(fs.access(path.join(tmpRoot, ".llm-wiki/evidence-tasks"))).rejects.toThrow()
  })

  it("self-question loop can propose policies from in-memory attributions as an optional stage", async () => {
    await write(
      path.join(tmpRoot, "wiki/股票/生益科技.md"),
      `${validFrontmatter("生益科技", "股票", "code: SH600183\n")}# 生益科技\n\nPCB、覆铜板、CCL、AI服务器高速板材料验证。\n`,
    )
    await write(
      path.join(tmpRoot, "wiki/股票/胜宏科技.md"),
      `${validFrontmatter("胜宏科技", "股票", "code: SZ300476\n")}# 胜宏科技\n\nAI服务器高速PCB验证。\n`,
    )

    const result = await runSelfQuestionLoop({
      projectPath: tmpRoot,
      stages: "generate,validate,attribute,policy",
      questionCount: 1,
      validationWindows: "1",
      marketValidate: "off",
      selfQuestionPlanner: async () => ({
        questions: [
          {
            questionType: "expected_difference",
            themeId: "ai-pcb-materials",
            branch: "PCB材料/工艺链",
            question: "未来三个月 AI服务器 PCB材料/工艺链里，CCL和高速板材料谁更可能率先兑现订单和毛利率？",
            expectedMove: "bullish",
            stockCodes: ["SH600183", "SZ300476"],
          },
        ],
      }),
      stockDailyColumns: ["ticker", "date", "close", "amount", "pct_cng"],
      stockDailyExecutor: async () => ({
        rows: [
          { ticker: "SH600183", date: "2026-06-11", close: 33, amount: 3600, pct_cng: 4.2 },
          { ticker: "SZ300476", date: "2026-06-11", close: 118, amount: 8800, pct_cng: 5.1 },
        ],
      }),
    })

    expect(result.dryRun).toBe(true)
    expect(result.stages.map((stage) => [stage.stage, stage.status])).toEqual([
      ["generate", "ok"],
      ["validate", "ok"],
      ["attribute", "ok"],
      ["policy", "ok"],
    ])
    expect(result.counts).toMatchObject({ questions: 1, validations: 2, attributions: 2, policyProposals: 4 })
    expect(result.policyRun.proposals.map((proposal) => proposal.rule)).toContain("must_run_evidence_stage_before_high_confidence")
    expect(result.policyRun.proposals.map((proposal) => proposal.evidenceGap)).toContain("fundamental:qcc_tender_or_order:not_checked")
    expect(result.outputs.policyProposals).toBe(null)
    await expect(fs.access(path.join(tmpRoot, ".llm-wiki/policy-proposals"))).rejects.toThrow()

    await write(
      path.join(tmpRoot, "data/brain/attributions.jsonl"),
      `${result.attributionRun.attributions.map((record) => JSON.stringify(record)).join("\n")}\n`,
    )
    const policyRerun = await proposeSelfQuestionPolicies({
      projectPath: tmpRoot,
      minOccurrences: 2,
      attributionRecords: result.attributionRun.attributions,
    })
    expect(policyRerun.counts.attributions).toBe(2)
    expect(policyRerun.proposals.map((proposal) => proposal.occurrenceCount)).toEqual([2, 2, 2, 2])
  })

  it("self-question loop can export active policy regressions as an optional stage", async () => {
    const policies = [
      {
        schema: "trading-ai-policy-v1",
        id: "policy_loop_regression_cninfo",
        type: "policy",
        policyId: "policy_loop_regression_cninfo",
        status: "active",
        scope: "self-question.validation_policy",
        rule: "must_run_evidence_stage_before_high_confidence",
        evidenceGap: "fundamental:cninfo_announcement:not_checked",
        regressionQuestions: ["量价先行但公告未查时，回答是否必须降置信？"],
        approvedAt: "2026-06-15 04:30:00",
      },
    ]
    await write(path.join(tmpRoot, "data/brain/policies.jsonl"), `${policies.map((item) => JSON.stringify(item)).join("\n")}\n`)
    const brainBefore = await read(path.join(tmpRoot, "data/brain/policies.jsonl"))

    const result = await runSelfQuestionLoop({
      projectPath: tmpRoot,
      stages: "policy-regression",
      write: true,
    })

    expect(result.dryRun).toBe(false)
    expect(result.stages.map((stage) => [stage.stage, stage.status])).toEqual([["policy-regression", "ok"]])
    expect(result.counts.policyRegressionCases).toBe(3)
    expect(result.outputs.policyRegressions).toMatch(/^\.llm-wiki\/policy-regressions\/.+-policy-regressions\.json$/)
    expect(result.policyRegressionRun.cases.map((item) => item.caseType)).toEqual(["ask-answer", "daily-loop-planner", "training-sample-quality"])
    const regressionManifest = JSON.parse(await read(result.policyRegressionRun.writeResult.filePath))
    expect(regressionManifest.schema).toBe("trading-ai-policy-regression-run-v1")
    const loopManifest = JSON.parse(await read(result.manifestPath))
    expect(loopManifest.counts.policyRegressionCases).toBe(3)
    expect(loopManifest.outputs.policyRegressions).toBe(result.outputs.policyRegressions)
    expect(loopManifest.writePolicy.policyRegressions).toBe(".llm-wiki/policy-regressions only when policy-regression stage runs with write enabled")
    expect(await read(path.join(tmpRoot, "data/brain/policies.jsonl"))).toBe(brainBefore)
  })

  it("self-question loop can execute active policy regressions as an optional stage", async () => {
    const policies = [
      {
        schema: "trading-ai-policy-v1",
        id: "policy_loop_regression_exec_cninfo",
        type: "policy",
        policyId: "policy_loop_regression_exec_cninfo",
        status: "active",
        scope: "self-question.validation_policy",
        rule: "must_run_evidence_stage_before_high_confidence",
        evidenceGap: "fundamental:cninfo_announcement:not_checked",
        regressionQuestions: ["量价先行但公告未查时，回答是否必须降置信？"],
        approvedAt: "2026-06-15 04:45:00",
      },
    ]
    await write(path.join(tmpRoot, "data/brain/policies.jsonl"), `${policies.map((item) => JSON.stringify(item)).join("\n")}\n`)
    const brainBefore = await read(path.join(tmpRoot, "data/brain/policies.jsonl"))
    const calls = []

    const result = await runSelfQuestionLoop({
      projectPath: tmpRoot,
      stages: "policy-regression,policy-regression-execute",
      write: true,
      executePolicyRegressions: true,
      policyRegressionExecutor: async ({ command, regressionCase }) => {
        calls.push({ command, caseType: regressionCase.caseType })
        if (regressionCase.caseType === "ask-answer") {
          return { exitCode: 0, stdout: "证据缺口 fundamental:cninfo_announcement:not_checked；需补 CNINFO 公告；降低置信度；引用来源 CNINFO待查。" }
        }
        if (regressionCase.caseType === "daily-loop-planner") {
          return { exitCode: 0, stdout: "planner_receives_active_policy policy_loop_regression_exec_cninfo\n## Active Policies\nanswer discloses policy guardrail" }
        }
        return { exitCode: 0, stdout: "qualityGate needs_evidence；block high confidence；evidence_results confirmed required for upgrade" }
      },
    })

    expect(result.stages.map((stage) => [stage.stage, stage.status])).toEqual([
      ["policy-regression", "ok"],
      ["policy-regression-execute", "ok"],
    ])
    expect(result.status).toBe("ok")
    expect(result.stages[1].verdict).toMatchObject({
      status: "passed",
      reason: "regression execution completed and all evaluated assertions passed",
    })
    expect(calls.map((item) => item.caseType)).toEqual(["ask-answer", "daily-loop-planner", "training-sample-quality"])
    expect(result.counts).toMatchObject({ policyRegressionCases: 3, policyRegressionExecutions: 3 })
    expect(result.policyRegressionExecutionRun.counts).toMatchObject({ completed: 3, failed: 0, timedOut: 0 })
    expect(result.policyRegressionExecutionRun.evaluation.counts).toMatchObject({ passed: 3, failed: 0, skipped: 0 })
    expect(result.outputs.policyRegressionExecutions).toMatch(/^\.llm-wiki\/policy-regression-executions\/.+-policy-regression-execution\.json$/)
    const loopManifest = JSON.parse(await read(result.manifestPath))
    expect(loopManifest.counts.policyRegressionExecutions).toBe(3)
    expect(loopManifest.outputs.policyRegressionExecutions).toBe(result.outputs.policyRegressionExecutions)
    expect(loopManifest.writePolicy.policyRegressionExecutions).toBe(".llm-wiki/policy-regression-executions only when policy-regression-execute stage runs with write enabled")
    expect(await read(path.join(tmpRoot, "data/brain/policies.jsonl"))).toBe(brainBefore)
  })

  it("self-question loop marks policy regression execution as planned without execute flag", async () => {
    await write(
      path.join(tmpRoot, "data/brain/policies.jsonl"),
      `${JSON.stringify({
        schema: "trading-ai-policy-v1",
        id: "policy_loop_regression_exec_planned_cninfo",
        type: "policy",
        policyId: "policy_loop_regression_exec_planned_cninfo",
        status: "active",
        scope: "self-question.validation_policy",
        rule: "must_plan_regression_execution_before_claiming_passed",
        evidenceGap: "fundamental:cninfo_announcement:not_checked",
        regressionQuestions: ["执行回归前是否只能标记 planned？"],
        approvedAt: "2026-06-15 06:25:00",
      })}\n`,
    )
    let calls = 0

    const result = await runSelfQuestionLoop({
      projectPath: tmpRoot,
      stages: "policy-regression,policy-regression-execute",
      maxQuestionsPerPolicy: 1,
      write: true,
      policyRegressionExecutor: async () => {
        calls += 1
        return { exitCode: 0, stdout: "" }
      },
    })

    expect(calls).toBe(0)
    expect(result.status).toBe("planned")
    expect(result.gateSummary).toMatchObject({
      status: "planned",
      recommendedNextStages: ["policy-regression-execute"],
      results: [
        {
          stage: "policy-regression-execute",
          status: "planned",
          reason: "regression execution planned; pass --execute to run cases",
        },
      ],
    })
    expect(result.stages.map((stage) => [stage.stage, stage.status])).toEqual([
      ["policy-regression", "ok"],
      ["policy-regression-execute", "planned"],
    ])
    expect(result.stages[1].verdict).toMatchObject({
      status: "planned",
      reason: "regression execution planned; pass --execute to run cases",
      nextStages: ["policy-regression-execute"],
    })
    const loopManifest = JSON.parse(await read(result.manifestPath))
    expect(loopManifest.status).toBe("planned")
    expect(loopManifest.gateSummary).toMatchObject({
      status: "planned",
      recommendedNextStages: ["policy-regression-execute"],
    })
    expect(loopManifest.stages[1].verdict.status).toBe("planned")
    await expect(fs.access(path.join(tmpRoot, "data/brain/self_training_events.jsonl"))).rejects.toThrow()
  })

  it("self-question loop records gate summary events only through the opt-in gate-event stage", async () => {
    await write(
      path.join(tmpRoot, "data/brain/policies.jsonl"),
      `${JSON.stringify({
        schema: "trading-ai-policy-v1",
        id: "policy_loop_gate_event_cninfo",
        type: "policy",
        policyId: "policy_loop_gate_event_cninfo",
        status: "active",
        scope: "self-question.validation_policy",
        rule: "must_record_open_regression_gate_as_learning_event",
        evidenceGap: "fundamental:cninfo_announcement:not_checked",
        regressionQuestions: ["未执行回归时，gate summary 是否进入长期学习事件？"],
        approvedAt: "2026-06-15 06:35:00",
      })}\n`,
    )

    const result = await runSelfQuestionLoop({
      projectPath: tmpRoot,
      stages: "policy-regression,policy-regression-execute,gate-event",
      maxQuestionsPerPolicy: 1,
      write: true,
      policyRegressionExecutor: async () => ({ exitCode: 0, stdout: "" }),
    })

    expect(result.status).toBe("planned")
    expect(result.stages.map((stage) => [stage.stage, stage.status])).toEqual([
      ["policy-regression", "ok"],
      ["policy-regression-execute", "planned"],
      ["gate-event", "ok"],
    ])
    expect(result.counts.gateEvents).toBe(1)
    expect(result.gateEventRun.counts).toMatchObject({ gateResults: 1, events: 1 })
    expect(result.outputs.gateEvents).toBe("data/brain/self_training_events.jsonl")

    const events = await readJsonl(path.join(tmpRoot, "data/brain/self_training_events.jsonl"))
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      schema: "self-question-loop-gate-event-v1",
      type: "event",
      eventType: "self-question-loop-gate",
      loopRunId: result.runId,
      stage: "policy-regression-execute",
      gateStatus: "planned",
      status: "planned",
      reason: "regression execution planned; pass --execute to run cases",
      recommendedNextStages: ["policy-regression-execute"],
      commandFailures: 0,
      evaluationFailed: 0,
      evaluationSkipped: 0,
    })
    expect(events[0].id).toMatch(/^self_question_gate_/)

    const loopManifest = JSON.parse(await read(result.manifestPath))
    expect(loopManifest.counts.gateEvents).toBe(1)
    expect(loopManifest.outputs.gateEvents).toBe("data/brain/self_training_events.jsonl")
    expect(loopManifest.writePolicy.gateEvents).toBe("data/brain/self_training_events.jsonl only when gate-event stage runs with write enabled")
  })

  it("self-question loop dry-run feeds gate-event records into self-train without brain writes", async () => {
    await write(
      path.join(tmpRoot, "data/brain/policies.jsonl"),
      `${JSON.stringify({
        schema: "trading-ai-policy-v1",
        id: "policy_loop_gate_self_train_cninfo",
        type: "policy",
        policyId: "policy_loop_gate_self_train_cninfo",
        status: "active",
        scope: "self-question.validation_policy",
        rule: "must_surface_open_gate_to_self_train_in_dry_run",
        evidenceGap: "fundamental:cninfo_announcement:not_checked",
        regressionQuestions: ["dry-run 中 gate event 是否能直接进入 self-train 动作？"],
        approvedAt: "2026-06-15 07:05:00",
      })}\n`,
    )

    const result = await runSelfQuestionLoop({
      projectPath: tmpRoot,
      stages: "policy-regression,policy-regression-execute,gate-event,self-train",
      maxQuestionsPerPolicy: 1,
    })

    expect(result.dryRun).toBe(true)
    expect(result.status).toBe("planned")
    expect(result.stages.map((stage) => [stage.stage, stage.status])).toEqual([
      ["policy-regression", "ok"],
      ["policy-regression-execute", "planned"],
      ["gate-event", "ok"],
      ["self-train", "ok"],
    ])
    expect(result.gateEventRun.dryRun).toBe(true)
    expect(result.gateEventRun.events).toHaveLength(1)
    expect(result.outputs.gateEvents).toBeNull()
    const gateAction = result.selfTraining.actions.find((action) => action.rule === "R9-open-regression-gate")
    expect(gateAction).toMatchObject({
      target: "policy-regression-execute",
      action: "execute-regression-gate",
      gateStatus: "planned",
      affectedIds: [result.gateEventRun.events[0].id],
    })
    expect(result.counts.selfTrainingActions).toBeGreaterThanOrEqual(1)
    await expect(fs.access(path.join(tmpRoot, "data/brain/self_training_events.jsonl"))).rejects.toThrow()
  })

  it("self-question loop can collect policy regression feedback from execution failures", async () => {
    const policies = [
      {
        schema: "trading-ai-policy-v1",
        id: "policy_loop_regression_feedback_cninfo",
        type: "policy",
        policyId: "policy_loop_regression_feedback_cninfo",
        status: "active",
        scope: "self-question.validation_policy",
        rule: "must_run_evidence_stage_before_high_confidence",
        evidenceGap: "fundamental:cninfo_announcement:not_checked",
        regressionQuestions: ["量价先行但公告未查时，回答是否必须降置信？"],
        approvedAt: "2026-06-15 04:55:00",
      },
    ]
    await write(path.join(tmpRoot, "data/brain/policies.jsonl"), `${policies.map((item) => JSON.stringify(item)).join("\n")}\n`)

    const result = await runSelfQuestionLoop({
      projectPath: tmpRoot,
      stages: "policy-regression,policy-regression-execute,policy-regression-feedback",
      write: true,
      executePolicyRegressions: true,
      policyRegressionExecutor: async ({ regressionCase }) => {
        if (regressionCase.caseType === "ask-answer") return { exitCode: 1, stdout: "", stderr: "provider failed" }
        if (regressionCase.caseType === "daily-loop-planner") return { exitCode: 0, stdout: "planner_receives_active_policy policy_loop_regression_feedback_cninfo\n## Active Policies" }
        return { exitCode: 0, stdout: "qualityGate needs_evidence block high confidence evidence_results confirmed required for upgrade" }
      },
    })

    expect(result.stages.map((stage) => [stage.stage, stage.status])).toEqual([
      ["policy-regression", "ok"],
      ["policy-regression-execute", "needs_remediation"],
      ["policy-regression-feedback", "ok"],
    ])
    expect(result.status).toBe("needs_remediation")
    expect(result.gateSummary).toMatchObject({
      status: "needs_remediation",
      recommendedNextStages: ["policy-regression-feedback", "policy-regression-remediation"],
      results: [
        {
          stage: "policy-regression-execute",
          status: "needs_remediation",
          reason: "regression command failures or timeouts",
        },
      ],
    })
    expect(result.stages[1].verdict).toMatchObject({
      status: "needs_remediation",
      reason: "regression command failures or timeouts",
      nextStages: ["policy-regression-feedback", "policy-regression-remediation"],
    })
    expect(result.counts).toMatchObject({ policyRegressionFeedbackItems: 3 })
    expect(result.policyRegressionFeedbackRun.counts).toMatchObject({ commandFailures: 1, assertionFailures: 1, skippedCases: 1, feedbackItems: 3 })
    expect(result.outputs.policyRegressionFeedback).toMatch(/^\.llm-wiki\/policy-regression-feedback\/.+-policy-regression-feedback\.json$/)
    const loopManifest = JSON.parse(await read(result.manifestPath))
    expect(loopManifest.counts.policyRegressionFeedbackItems).toBe(3)
    expect(loopManifest.gateSummary.status).toBe("needs_remediation")
    expect(loopManifest.outputs.policyRegressionFeedback).toBe(result.outputs.policyRegressionFeedback)
    expect(loopManifest.writePolicy.policyRegressionFeedback).toBe(".llm-wiki/policy-regression-feedback only when policy-regression-feedback stage runs with write enabled")
  })

  it("self-question loop can propose remediation from policy regression feedback", async () => {
    await write(
      path.join(tmpRoot, "data/brain/policies.jsonl"),
      `${JSON.stringify({
        schema: "trading-ai-policy-v1",
        id: "policy_loop_regression_remediation_cninfo",
        type: "policy",
        policyId: "policy_loop_regression_remediation_cninfo",
        status: "active",
        scope: "self-question.validation_policy",
        rule: "must_run_evidence_stage_before_high_confidence",
        evidenceGap: "fundamental:cninfo_announcement:not_checked",
        regressionQuestions: ["量价先行但公告未查时，回答是否必须降置信？"],
        approvedAt: "2026-06-15 05:05:00",
      })}\n`,
    )

    const result = await runSelfQuestionLoop({
      projectPath: tmpRoot,
      stages: "policy-regression,policy-regression-execute,policy-regression-feedback,policy-regression-remediation",
      write: true,
      executePolicyRegressions: true,
      policyRegressionExecutor: async ({ regressionCase }) => {
        if (regressionCase.caseType === "ask-answer") return { exitCode: 1, stdout: "", stderr: "provider failed" }
        if (regressionCase.caseType === "daily-loop-planner") return { exitCode: 0, stdout: "planner_receives_active_policy policy_loop_regression_remediation_cninfo\n## Active Policies" }
        return { exitCode: 0, stdout: "qualityGate needs_evidence block high confidence evidence_results confirmed required for upgrade" }
      },
    })

    expect(result.stages.map((stage) => [stage.stage, stage.status])).toEqual([
      ["policy-regression", "ok"],
      ["policy-regression-execute", "needs_remediation"],
      ["policy-regression-feedback", "ok"],
      ["policy-regression-remediation", "ok"],
    ])
    expect(result.status).toBe("needs_remediation")
    expect(result.counts).toMatchObject({ policyRegressionRemediationProposals: 3 })
    expect(result.policyRegressionRemediationRun.counts).toMatchObject({
      feedbackItems: 3,
      remediationProposals: 3,
      byRemediationType: {
        case_output_repair: 1,
        execution_repair: 1,
        policy_or_prompt_patch: 1,
      },
    })
    expect(result.outputs.policyRegressionRemediation).toMatch(/^\.llm-wiki\/policy-regression-remediations\/.+-policy-regression-remediations\.json$/)
    const loopManifest = JSON.parse(await read(result.manifestPath))
    expect(loopManifest.counts.policyRegressionRemediationProposals).toBe(3)
    expect(loopManifest.outputs.policyRegressionRemediation).toBe(result.outputs.policyRegressionRemediation)
    expect(loopManifest.writePolicy.policyRegressionRemediation).toBe(".llm-wiki/policy-regression-remediations only when policy-regression-remediation stage runs with write enabled")
  })

  it("self-question loop can export approved remediation patch candidates without applying them", async () => {
    await write(
      path.join(tmpRoot, "data/brain/policies.jsonl"),
      `${JSON.stringify({
        schema: "trading-ai-policy-v1",
        id: "policy_loop_regression_patches_cninfo",
        type: "policy",
        policyId: "policy_loop_regression_patches_cninfo",
        status: "active",
        scope: "self-question.validation_policy",
        rule: "must_run_evidence_stage_before_high_confidence",
        evidenceGap: "fundamental:cninfo_announcement:not_checked",
        regressionQuestions: ["量价先行但公告未查时，回答是否必须降置信？"],
        approvedAt: "2026-06-15 05:15:00",
      })}\n`,
    )
    const regression = await exportSelfQuestionPolicyRegressions({ projectPath: tmpRoot })
    const execution = await executeSelfQuestionPolicyRegressions({
      projectPath: tmpRoot,
      regressionRun: regression,
      execute: true,
      executor: async ({ regressionCase }) => {
        if (regressionCase.caseType === "ask-answer") return { exitCode: 0, stdout: "answer_discloses_policy_guardrail evidence-gap confidence-cut" }
        if (regressionCase.caseType === "daily-loop-planner") return { exitCode: 0, stdout: "planner_receives_active_policy policy_loop_regression_patches_cninfo\n## Active Policies" }
        return { exitCode: 0, stdout: "qualityGate needs_evidence but missing block high confidence evidence_results confirmed required for upgrade" }
      },
    })
    const feedback = await collectSelfQuestionPolicyRegressionFeedback({ projectPath: tmpRoot, executionRun: execution })
    const remediationRun = await proposeSelfQuestionPolicyRegressionRemediations({ projectPath: tmpRoot, feedbackRun: feedback, write: true })
    const patchProposal = remediationRun.proposals.find((proposal) => proposal.remediationType === "policy_or_prompt_patch")
    await reviewSelfQuestionPolicyRegressionRemediation({
      projectPath: tmpRoot,
      remediationPath: remediationRun.writeResult.relativePath,
      remediationId: patchProposal.id,
      action: "approve",
      note: "approved token=secret",
      write: true,
    })
    const policyBefore = await read(path.join(tmpRoot, "data/brain/policies.jsonl"))
    const eventsBefore = await read(path.join(tmpRoot, "data/brain/self_training_events.jsonl"))

    const result = await runSelfQuestionLoop({
      projectPath: tmpRoot,
      stages: "policy-regression-patches",
      write: true,
      remediationId: patchProposal.id,
    })

    expect(result.stages.map((stage) => [stage.stage, stage.status])).toEqual([
      ["policy-regression-patches", "ok"],
    ])
    expect(result.counts).toMatchObject({ policyRegressionPatchCandidates: 1 })
    expect(result.policyRegressionPatchRun.counts).toMatchObject({
      approvedReviewEvents: 1,
      patchCandidates: 1,
      byPatchTarget: {
        prompt_or_policy: 1,
      },
    })
    expect(result.outputs.policyRegressionPatches).toMatch(/^\.llm-wiki\/policy-regression-patches\/.+-policy-regression-patches\.json$/)
    expect(await read(path.join(tmpRoot, "data/brain/policies.jsonl"))).toBe(policyBefore)
    const eventsAfter = await read(path.join(tmpRoot, "data/brain/self_training_events.jsonl"))
    expect(eventsAfter).toBe(eventsBefore)
    expect(eventsAfter).not.toContain("policy-regression-patch-apply")
    const patchText = await read(path.join(tmpRoot, result.outputs.policyRegressionPatches))
    expect(patchText).not.toContain("token=secret")
    expect(patchText).toContain("token=[redacted]")
    const loopManifest = JSON.parse(await read(result.manifestPath))
    expect(loopManifest.counts.policyRegressionPatchCandidates).toBe(1)
    expect(loopManifest.outputs.policyRegressionPatches).toBe(result.outputs.policyRegressionPatches)
    expect(loopManifest.writePolicy.policyRegressionPatches).toBe(".llm-wiki/policy-regression-patches only when policy-regression-patches stage runs with write enabled")
  })

  it("self-question loop applies policy regression patch candidates only with explicit confirmation", async () => {
    await write(path.join(tmpRoot, "wiki/股票/生益科技.md"), `${validFrontmatter("生益科技", "股票", "code: SH600183\n")}# 生益科技\n`)
    await write(path.join(tmpRoot, "raw/研报新闻/2026-06-14-PCB.md"), "PCB材料补证来源。")
    await write(
      path.join(tmpRoot, "data/brain/policies.jsonl"),
      `${JSON.stringify({
        schema: "trading-ai-policy-v1",
        id: "policy_loop_apply_patch_cninfo",
        type: "policy",
        policyId: "policy_loop_apply_patch_cninfo",
        status: "active",
        scope: "self-question.validation_policy",
        rule: "must_run_evidence_stage_before_high_confidence",
        evidenceGap: "fundamental:cninfo_announcement:not_checked",
        regressionQuestions: ["Does the answer lower confidence when CNINFO is missing?"],
        approvedAt: "2026-06-15 05:40:00",
        revision: 1,
      })}\n`,
    )
    const patchRun = {
      schema: "trading-ai-policy-regression-patch-candidate-run-v1",
      mode: "self-question-policy-regression-patch-candidates",
      runId: "loop_patch_apply_test",
      patchCandidates: [
        {
          schema: "trading-ai-policy-regression-patch-candidate-v1",
          id: "policy_reg_patch_loop_apply_test",
          type: "policy_regression_patch_candidate",
          status: "candidate",
          reviewEventId: "brain_event_loop_patch_apply_test",
          remediationId: "policy_reg_remediation_loop_apply_test",
          remediationType: "policy_or_prompt_patch",
          feedbackType: "assertion_failed",
          severity: "review",
          policyId: "policy_loop_apply_patch_cninfo",
          caseId: "case_loop_apply_test",
          caseType: "ask-answer",
          assertion: "loop_apply_guardrail_assertion",
          sourceFeedbackId: "policy_reg_feedback_loop_apply_test",
          patchTarget: "prompt_or_policy",
          proposedAction: "tighten_policy_prompt_or_regression_assertion",
          proposedQuestion: "Should the loop-applied policy appear in ask regressions?",
          proposedPolicyPatch: {
            policyId: "policy_loop_apply_patch_cninfo",
            caseType: "ask-answer",
            addRegressionAssertion: "loop_apply_guardrail_assertion",
            promptGuardrail: "Loop apply must disclose loop_apply_guardrail_assertion and redact token=secret.",
            sourceFeedbackId: "policy_reg_feedback_loop_apply_test",
            reviewRequired: true,
          },
          applyMode: "manual_required",
          reviewRequired: true,
          autoApplied: false,
        },
      ],
    }
    await write(path.join(tmpRoot, ".llm-wiki/policy-regression-patches/loop-patch-apply-test.json"), `${JSON.stringify(patchRun, null, 2)}\n`)
    const wikiBefore = await read(path.join(tmpRoot, "wiki/股票/生益科技.md"))
    const rawBefore = await read(path.join(tmpRoot, "raw/研报新闻/2026-06-14-PCB.md"))
    const policyBefore = await read(path.join(tmpRoot, "data/brain/policies.jsonl"))

    const skipped = await runSelfQuestionLoop({
      projectPath: tmpRoot,
      stages: "policy-regression-apply",
      patchPath: ".llm-wiki/policy-regression-patches/loop-patch-apply-test.json",
      patchId: "policy_reg_patch_loop_apply_test",
      write: true,
    })
    expect(skipped.stages).toHaveLength(1)
    expect(skipped.stages[0]).toMatchObject({
      stage: "policy-regression-apply",
      status: "skipped",
      counts: { patchCandidates: 0, activePolicyRevisions: 0, applyEvents: 0 },
    })
    expect(skipped.counts.policyRegressionPatchApplyEvents).toBe(0)
    expect(await read(path.join(tmpRoot, "data/brain/policies.jsonl"))).toBe(policyBefore)
    await expect(fs.access(path.join(tmpRoot, "data/brain/self_training_events.jsonl"))).rejects.toThrow()

    const applied = await runSelfQuestionLoop({
      projectPath: tmpRoot,
      stages: "policy-regression-apply",
      id: "question_scope_should_not_be_used_as_patch_id",
      patchPath: ".llm-wiki/policy-regression-patches/loop-patch-apply-test.json",
      remediationId: "policy_reg_remediation_loop_apply_test",
      applyPolicyRegressionPatches: true,
      reviewer: "codex-test",
      note: "loop apply token=secret",
      write: true,
    })
    expect(applied.stages.map((stage) => [stage.stage, stage.status])).toEqual([
      ["policy-regression-apply", "ok"],
    ])
    expect(applied.stages[0].counts).toMatchObject({
      patchCandidates: 1,
      activePolicyRevisions: 1,
      applyEvents: 1,
      wrotePolicies: 1,
      wroteEvents: 1,
      alreadyApplied: 0,
    })
    expect(applied.counts).toMatchObject({
      policyRegressionPatchApplyCandidates: 1,
      policyRegressionPatchPolicyRevisions: 1,
      policyRegressionPatchApplyEvents: 1,
    })
    expect(applied.outputs.policyRegressionPatchApply).toEqual({
      policy: "data/brain/policies.jsonl",
      event: "data/brain/self_training_events.jsonl",
    })
    expect(applied.policyRegressionPatchApplyRun.applyEvent).toMatchObject({
      eventType: "policy-regression-patch-apply",
      patchCandidateId: "policy_reg_patch_loop_apply_test",
      autoApplied: false,
    })
    const policiesText = await read(path.join(tmpRoot, "data/brain/policies.jsonl"))
    const eventsText = await read(path.join(tmpRoot, "data/brain/self_training_events.jsonl"))
    expect(policiesText).not.toContain("token=secret")
    expect(eventsText).not.toContain("token=secret")
    expect(policiesText).toContain("token=[redacted]")
    expect(eventsText).toContain("policy-regression-patch-apply")
    expect(await read(path.join(tmpRoot, "wiki/股票/生益科技.md"))).toBe(wikiBefore)
    expect(await read(path.join(tmpRoot, "raw/研报新闻/2026-06-14-PCB.md"))).toBe(rawBefore)
    const loopManifest = JSON.parse(await read(applied.manifestPath))
    expect(loopManifest.counts.policyRegressionPatchApplyEvents).toBe(1)
    expect(loopManifest.outputs.policyRegressionPatchApply).toEqual(applied.outputs.policyRegressionPatchApply)
    expect(loopManifest.writePolicy.policyRegressionPatchApply).toBe("data/brain/policies.jsonl and data/brain/self_training_events.jsonl only when policy-regression-apply stage runs with explicit apply confirmation and write enabled")
  })

  it("self-question loop can verify regressions after applying a policy patch", async () => {
    await write(
      path.join(tmpRoot, "data/brain/policies.jsonl"),
      `${JSON.stringify({
        schema: "trading-ai-policy-v1",
        id: "policy_loop_verify_patch_cninfo",
        type: "policy",
        policyId: "policy_loop_verify_patch_cninfo",
        status: "active",
        scope: "self-question.validation_policy",
        rule: "must_run_evidence_stage_before_high_confidence",
        evidenceGap: "fundamental:cninfo_announcement:not_checked",
        regressionQuestions: ["Does post-apply verification see the new regression assertion?"],
        approvedAt: "2026-06-15 05:55:00",
        revision: 1,
      })}\n`,
    )
    const patchRun = {
      schema: "trading-ai-policy-regression-patch-candidate-run-v1",
      mode: "self-question-policy-regression-patch-candidates",
      runId: "loop_patch_verify_test",
      patchCandidates: [
        {
          schema: "trading-ai-policy-regression-patch-candidate-v1",
          id: "policy_reg_patch_loop_verify_test",
          type: "policy_regression_patch_candidate",
          status: "candidate",
          reviewEventId: "brain_event_loop_patch_verify_test",
          remediationId: "policy_reg_remediation_loop_verify_test",
          remediationType: "policy_or_prompt_patch",
          feedbackType: "assertion_failed",
          severity: "review",
          policyId: "policy_loop_verify_patch_cninfo",
          caseId: "case_loop_verify_test",
          caseType: "ask-answer",
          assertion: "post_apply_guardrail_assertion",
          sourceFeedbackId: "policy_reg_feedback_loop_verify_test",
          patchTarget: "prompt_or_policy",
          proposedAction: "tighten_policy_prompt_or_regression_assertion",
          proposedQuestion: "Should post-apply regression verification include the new assertion?",
          proposedPolicyPatch: {
            policyId: "policy_loop_verify_patch_cninfo",
            caseType: "ask-answer",
            addRegressionAssertion: "post_apply_guardrail_assertion",
            promptGuardrail: "Post apply verification must check post_apply_guardrail_assertion.",
            sourceFeedbackId: "policy_reg_feedback_loop_verify_test",
            reviewRequired: true,
          },
          applyMode: "manual_required",
          reviewRequired: true,
          autoApplied: false,
        },
      ],
    }
    await write(path.join(tmpRoot, ".llm-wiki/policy-regression-patches/loop-patch-verify-test.json"), `${JSON.stringify(patchRun, null, 2)}\n`)
    const calls = []

    const result = await runSelfQuestionLoop({
      projectPath: tmpRoot,
      stages: "policy-regression-apply,policy-regression-verify",
      patchPath: ".llm-wiki/policy-regression-patches/loop-patch-verify-test.json",
      patchId: "policy_reg_patch_loop_verify_test",
      applyPolicyRegressionPatches: true,
      executePolicyRegressions: true,
      maxQuestionsPerPolicy: 1,
      write: true,
      policyRegressionExecutor: async ({ regressionCase }) => {
        calls.push({
          caseType: regressionCase.caseType,
          expectedAssertions: regressionCase.expectedAssertions,
        })
        if (regressionCase.caseType === "ask-answer") {
          return { exitCode: 0, stdout: "post_apply_guardrail_assertion；证据缺口 fundamental:cninfo_announcement:not_checked；降低置信度；引用来源 CNINFO待查。" }
        }
        if (regressionCase.caseType === "daily-loop-planner") {
          return { exitCode: 0, stdout: "planner_receives_active_policy policy_loop_verify_patch_cninfo\n## Active Policies\npolicy guardrail active" }
        }
        return { exitCode: 0, stdout: "qualityGate needs_evidence；block high confidence；evidence_results confirmed required for upgrade" }
      },
    })

    expect(result.stages.map((stage) => [stage.stage, stage.status])).toEqual([
      ["policy-regression-apply", "ok"],
      ["policy-regression-verify", "ok"],
    ])
    expect(result.status).toBe("ok")
    expect(result.gateSummary).toMatchObject({
      status: "passed",
      recommendedNextStages: [],
      results: [
        {
          stage: "policy-regression-verify",
          status: "passed",
          reason: "verification executed and all evaluated assertions passed",
        },
      ],
    })
    expect(calls.map((item) => item.caseType)).toEqual(["ask-answer", "daily-loop-planner", "training-sample-quality"])
    expect(calls.find((item) => item.caseType === "ask-answer").expectedAssertions).toContain("post_apply_guardrail_assertion")
    expect(result.counts).toMatchObject({
      policyRegressionPatchApplyEvents: 1,
      policyRegressionVerificationCases: 3,
      policyRegressionVerificationExecutions: 3,
      policyRegressionVerificationFailures: 0,
      policyRegressionVerificationEvaluationFailed: 0,
    })
    expect(result.policyRegressionVerificationRun.sourcePatchApply).toMatchObject({
      patchCandidateId: "policy_reg_patch_loop_verify_test",
      policyId: "policy_loop_verify_patch_cninfo",
      revision: 2,
    })
    expect(result.policyRegressionVerificationRun.executionRun.evaluation.counts).toMatchObject({
      passed: 3,
      failed: 0,
      skipped: 0,
    })
    expect(result.policyRegressionVerificationRun.verdict).toMatchObject({
      status: "passed",
      reason: "verification executed and all evaluated assertions passed",
      nextStages: [],
    })
    expect(result.outputs.policyRegressionVerification.regressions).toMatch(/^\.llm-wiki\/policy-regressions\/.+-policy-regressions\.json$/)
    expect(result.outputs.policyRegressionVerification.executions).toMatch(/^\.llm-wiki\/policy-regression-executions\/.+-policy-regression-execution\.json$/)
    const loopManifest = JSON.parse(await read(result.manifestPath))
    expect(loopManifest.counts.policyRegressionVerificationCases).toBe(3)
    expect(loopManifest.gateSummary.status).toBe("passed")
    expect(loopManifest.stages[1].verdict.status).toBe("passed")
    expect(loopManifest.outputs.policyRegressionVerification).toEqual(result.outputs.policyRegressionVerification)
    expect(loopManifest.writePolicy.policyRegressionVerification).toBe(".llm-wiki/policy-regressions and .llm-wiki/policy-regression-executions only when policy-regression-verify stage runs with write enabled")
  })

  it("self-question loop marks failed policy regression verification for remediation", async () => {
    await write(
      path.join(tmpRoot, "data/brain/policies.jsonl"),
      `${JSON.stringify({
        schema: "trading-ai-policy-v1",
        id: "policy_loop_verify_gate_cninfo",
        type: "policy",
        policyId: "policy_loop_verify_gate_cninfo",
        status: "active",
        scope: "self-question.validation_policy",
        rule: "must_run_evidence_stage_before_high_confidence",
        evidenceGap: "fundamental:cninfo_announcement:not_checked",
        regressionQuestions: ["Does failed verification trigger remediation status?"],
        regressionAssertions: {
          "ask-answer": ["must_show_gate_assertion"],
        },
        approvedAt: "2026-06-15 06:05:00",
      })}\n`,
    )

    const result = await runSelfQuestionLoop({
      projectPath: tmpRoot,
      stages: "policy-regression-verify",
      executePolicyRegressions: true,
      maxQuestionsPerPolicy: 1,
      write: true,
      policyRegressionExecutor: async ({ regressionCase }) => {
        if (regressionCase.caseType === "ask-answer") {
          return { exitCode: 0, stdout: "证据缺口 fundamental:cninfo_announcement:not_checked；降低置信度；引用来源 CNINFO待查。" }
        }
        if (regressionCase.caseType === "daily-loop-planner") {
          return { exitCode: 0, stdout: "planner_receives_active_policy policy_loop_verify_gate_cninfo\n## Active Policies\npolicy guardrail active" }
        }
        return { exitCode: 0, stdout: "qualityGate needs_evidence；block high confidence；evidence_results confirmed required for upgrade" }
      },
    })

    expect(result.status).toBe("needs_remediation")
    expect(result.stages).toHaveLength(1)
    expect(result.stages[0]).toMatchObject({
      stage: "policy-regression-verify",
      status: "needs_remediation",
      verdict: {
        status: "needs_remediation",
        reason: "verification assertions failed or were skipped",
        nextStages: ["policy-regression-feedback", "policy-regression-remediation"],
      },
    })
    expect(result.counts).toMatchObject({
      policyRegressionVerificationCases: 3,
      policyRegressionVerificationExecutions: 3,
      policyRegressionVerificationEvaluationFailed: 1,
    })
    expect(result.policyRegressionVerificationRun.verdict).toMatchObject({
      status: "needs_remediation",
      evaluationFailed: 1,
    })
    const loopManifest = JSON.parse(await read(result.manifestPath))
    expect(loopManifest.status).toBe("needs_remediation")
    expect(loopManifest.stages[0].status).toBe("needs_remediation")
    expect(loopManifest.stages[0].verdict.status).toBe("needs_remediation")
  })

  it("self-question loop marks policy regression verification as planned without execution", async () => {
    await write(
      path.join(tmpRoot, "data/brain/policies.jsonl"),
      `${JSON.stringify({
        schema: "trading-ai-policy-v1",
        id: "policy_loop_verify_planned_cninfo",
        type: "policy",
        policyId: "policy_loop_verify_planned_cninfo",
        status: "active",
        scope: "self-question.validation_policy",
        rule: "must_plan_verification_before_claiming_passed",
        evidenceGap: "fundamental:cninfo_announcement:not_checked",
        regressionQuestions: ["Does dry-run verification stay planned?"],
        approvedAt: "2026-06-15 06:10:00",
      })}\n`,
    )

    const result = await runSelfQuestionLoop({
      projectPath: tmpRoot,
      stages: "policy-regression-verify",
      maxQuestionsPerPolicy: 1,
      write: true,
    })

    expect(result.status).toBe("planned")
    expect(result.stages[0]).toMatchObject({
      stage: "policy-regression-verify",
      status: "planned",
      verdict: {
        status: "planned",
        reason: "verification planned; pass --execute-policy-regressions to run cases",
        nextStages: ["policy-regression-verify"],
      },
    })
    expect(result.counts).toMatchObject({
      policyRegressionVerificationCases: 3,
      policyRegressionVerificationExecutions: 3,
      policyRegressionVerificationFailures: 0,
      policyRegressionVerificationEvaluationFailed: 0,
      policyRegressionVerificationEvaluationSkipped: 0,
    })
    expect(result.policyRegressionVerificationRun.executionRun.execute).toBe(false)
    const loopManifest = JSON.parse(await read(result.manifestPath))
    expect(loopManifest.status).toBe("planned")
    expect(loopManifest.stages[0].verdict.status).toBe("planned")
  })

  it("self-question loop writes a redacted failure manifest before rethrowing stage errors", async () => {
    await write(
      path.join(tmpRoot, "wiki/股票/生益科技.md"),
      `${validFrontmatter("生益科技", "股票", "code: SH600183\n")}# 生益科技\n\nPCB、覆铜板、CCL、AI服务器高速板材料验证。\n`,
    )
    await write(path.join(tmpRoot, "raw/研报新闻/2026-06-14-PCB.md"), "PCB材料需要用量价、公告、招投标和财报闭环验证。")

    let caught = null
    try {
      await runSelfQuestionLoop({
        projectPath: tmpRoot,
        stages: "export",
        exportKinds: "password=secret",
        write: true,
      })
    } catch (err) {
      caught = err
    }

    expect(caught).toBeInstanceOf(Error)
    expect(caught.message).toContain("password=[redacted]")
    expect(caught.message).not.toContain("password=secret")
    expect(caught.manifestRelativePath).toMatch(/^\.llm-wiki\/self-question-runs\/.+-loop\/manifest\.json$/)
    const manifest = JSON.parse(await read(caught.manifestPath))
    expect(manifest.status).toBe("failed")
    expect(manifest.timing).toMatchObject({
      startedAt: expect.any(String),
      finishedAt: expect.any(String),
      durationMs: expect.any(Number),
    })
    expect(manifest.stages.map((stage) => [stage.stage, stage.status])).toEqual([
      ["export", "failed"],
    ])
    expect(manifest.stages[0]).toMatchObject({
      startedAt: expect.any(String),
      finishedAt: expect.any(String),
      durationMs: expect.any(Number),
    })
    expect(manifest.stages[0].error).toContain("password=[redacted]")
    expect(JSON.stringify(manifest)).not.toContain("password=secret")
    expect(manifest.counts.questions).toBe(0)
    expect(manifest.outputs.questions).toBe(null)
  })

  it("exports self-question attribution samples for recursive training", async () => {
    await write(
      path.join(tmpRoot, "data/brain/attributions.jsonl"),
      `${JSON.stringify({
        schema: "self-question-attribution-v1",
        id: "selfqa-1",
        type: "attribution",
        kind: "self-question-attribution",
        attributionMethod: "self_question_attribution_v1",
        validationId: "selfq-val-1",
        questionRecordId: "selfq-1",
        questionId: "self_q_1",
        question: "AI服务器 PCB材料 是订单兑现还是叙事扩散？",
        hypothesis: "PCB材料需要量价、公告、订单和财报闭环验证。",
        stockName: "生益科技",
        stockCode: "SH600183",
        windowDays: 1,
        verdict: "验证通过",
        attributionLabel: "price_only",
        confidenceImpact: "positive_but_unconfirmed",
        nextAction: "verify_fundamentals",
        attributionReason: "量价反馈支持假设，但公告、招投标、订单或财报闭环仍存在未验证缺口。",
        evidenceGaps: ["fundamental:cninfo_announcement:not_checked", "fundamental:qcc_tender_or_order:not_checked"],
      })}\n`,
    )

    const sft = await exportTrainingSamples({ projectPath: tmpRoot, kind: "sft" })
    expect(sft.count).toBe(1)
    const sftText = await read(sft.outputPath)
    expect(sftText).toContain("AI服务器 PCB材料")
    expect(sftText).toContain("price_only")
    expect(sftText).toContain("verify_fundamentals")
    expect(sftText).toContain("data-source qcc-tenders")
    expect(sft.samples[0].qualityGate).toMatchObject({
      status: "needs_evidence",
      highConfidenceEligible: false,
      requiredAction: "run_evidence_stage",
    })

    const evalSamples = await exportTrainingSamples({ projectPath: tmpRoot, kind: "eval" })
    expect(evalSamples.count).toBe(1)
    expect(evalSamples.samples[0].question).toContain("归因是否合理")
    expect(evalSamples.samples[0].expected).toContain("price_only")
    expect(evalSamples.samples[0].evidence.nextAction).toBe("verify_fundamentals")
    expect(evalSamples.samples[0].evidence.evidenceTasks).toEqual([
      expect.objectContaining({ signal: "cninfo_announcement", provider: "cninfo" }),
      expect.objectContaining({ signal: "qcc_tender_or_order", provider: "qichacha" }),
    ])
    expect(evalSamples.samples[0].qualityGate).toMatchObject({
      status: "needs_evidence",
      highConfidenceEligible: false,
    })

    const eligibleOnly = await exportTrainingSamples({ projectPath: tmpRoot, kind: "sft", qualityGate: "eligible" })
    expect(eligibleOnly.count).toBe(0)
    expect(eligibleOnly.relativePath).toContain("sft-eligible-")

    const needsEvidenceOnly = await exportTrainingSamples({ projectPath: tmpRoot, kind: "sft", qualityGate: "needs_evidence" })
    expect(needsEvidenceOnly.count).toBe(1)
    expect(needsEvidenceOnly.samples[0].qualityGate.status).toBe("needs_evidence")
    expect(needsEvidenceOnly.relativePath).toContain("sft-needs_evidence-")
  })

  it("promotes price-only attribution samples after confirmed evidence results", async () => {
    await write(
      path.join(tmpRoot, "data/brain/attributions.jsonl"),
      `${JSON.stringify({
        schema: "self-question-attribution-v1",
        id: "selfqa-evidence-closed-1",
        type: "attribution",
        kind: "self-question-attribution",
        attributionMethod: "self_question_attribution_v1",
        validationId: "selfq-val-closed-1",
        questionRecordId: "selfq-closed-1",
        questionId: "self_q_closed_1",
        question: "AI服务器 PCB材料 是否已从量价先行进入公告兑现？",
        hypothesis: "PCB材料需要公告补证。",
        stockName: "生益科技",
        stockCode: "SH600183",
        verdict: "验证通过",
        attributionLabel: "price_only",
        confidenceImpact: "positive_but_unconfirmed",
        nextAction: "verify_fundamentals",
        evidenceGaps: ["fundamental:cninfo_announcement:not_checked"],
      })}\n`,
    )
    await write(
      path.join(tmpRoot, "data/brain/evidence_results.jsonl"),
      `${JSON.stringify({
        schema: "self-question-evidence-result-v1",
        id: "evidence_result_closed_1",
        type: "evidence_result",
        kind: "self-question-evidence-result",
        taskId: "evidence_task_closed_1",
        attributionId: "selfqa-evidence-closed-1",
        validationId: "selfq-val-closed-1",
        questionRecordId: "selfq-closed-1",
        questionId: "self_q_closed_1",
        provider: "cninfo",
        signal: "cninfo_announcement",
        evidenceGap: "fundamental:cninfo_announcement:not_checked",
        result: "confirmed",
        status: "resolved",
        summary: "公告补证已确认。",
        sourceRefs: ["cninfo:2026-06-14:公告"],
        createdAt: "2026-06-15 02:45:00",
      })}\n`,
    )

    const eligibleOnly = await exportTrainingSamples({ projectPath: tmpRoot, kind: "sft", qualityGate: "eligible" })
    expect(eligibleOnly.count).toBe(1)
    expect(eligibleOnly.samples[0].qualityGate).toMatchObject({
      status: "eligible",
      highConfidenceEligible: true,
      requiredAction: null,
    })
    expect(eligibleOnly.samples[0].qualityGate.evidenceResultIds).toEqual(["evidence_result_closed_1"])

    const needsEvidenceOnly = await exportTrainingSamples({ projectPath: tmpRoot, kind: "sft", qualityGate: "needs_evidence" })
    expect(needsEvidenceOnly.count).toBe(0)
  })

  it("builds stock-feedback trajectories where market-traded expectation is not forced into fundamental closure", async () => {
    await write(
      path.join(tmpRoot, "data/brain/attributions.jsonl"),
      `${JSON.stringify({
        schema: "self-question-attribution-v1",
        id: "selfqa-expectation-1",
        type: "attribution",
        kind: "self-question-attribution",
        attributionMethod: "self_question_attribution_v1",
        validationId: "selfq-val-expectation-1",
        questionRecordId: "selfq-expectation-1",
        questionId: "self_q_expectation_1",
        question: "CPO 光模块 是否先被资金交易预期？",
        hypothesis: "事件未落地前市场可能先交易 CPO 订单预期。",
        stockName: "新易盛",
        stockCode: "SZ300502",
        windowDays: 3,
        verdict: "验证通过",
        attributionLabel: "price_only",
        confidenceImpact: "positive_but_unconfirmed",
        nextAction: "verify_fundamentals",
        attributionReason: "盘中相对强度、成交额放大和板块扩散验证了预期交易，但公告/订单/财报尚未落地。",
        marketSignals: ["relative_strength", "turnover_expansion", "follow_through", "theme_diffusion"],
        evidenceGaps: ["fundamental:cninfo_announcement:not_checked", "fundamental:order:not_checked"],
        createdAt: "2026-06-19 10:30:00",
      })}\n`,
    )

    const dryRun = await buildStockFeedbackTrajectories({ projectPath: tmpRoot })
    expect(dryRun.dryRun).toBe(true)
    expect(dryRun.writeResult).toBe(null)
    expect(dryRun.trajectories).toEqual([
      expect.objectContaining({
        schema: "stock-feedback-trajectory-v1",
        validationTarget: "expectation_trade",
        qualityGate: expect.objectContaining({
          status: "expectation_validated",
          validationTarget: "expectation_trade",
          highConfidenceEligible: true,
        }),
      }),
      expect.objectContaining({
        validationTarget: "fundamental_closure",
        qualityGate: expect.objectContaining({
          status: "needs_evidence",
          validationTarget: "fundamental_closure",
          highConfidenceEligible: false,
        }),
      }),
    ])
    const expectationTrajectory = dryRun.trajectories.find((item) => item.validationTarget === "expectation_trade")
    const fundamentalTrajectory = dryRun.trajectories.find((item) => item.validationTarget === "fundamental_closure")
    expect(expectationTrajectory.marketPatterns.map((item) => item.id)).not.toContain("fundamental_closure_confirmation")
    expect(fundamentalTrajectory.marketPatterns.map((item) => item.id)).not.toContain("fundamental_closure_confirmation")
    expect(fundamentalTrajectory.marketPatterns).toEqual([])
    expect(JSON.stringify(dryRun.trajectories[0])).not.toContain("HAS_ORDER")

    const written = await buildStockFeedbackTrajectories({ projectPath: tmpRoot, write: true })
    expect(written.dryRun).toBe(false)
    expect(written.writeResult.trajectories.relativePath).toMatch(/^\.llm-wiki\/stock-feedback\/trajectories\//)
    const status = await getStockFeedbackStatus({ projectPath: tmpRoot })
    expect(status.summary.byMarketPattern.fundamental_closure_confirmation ?? 0).toBe(0)
    expect(await read(path.join(tmpRoot, "wiki/概念/算电协同.md"))).toContain("AI 服务器电源需求")
    await expect(read(path.join(tmpRoot, "raw/研报新闻/stock-feedback.jsonl"))).rejects.toThrow()
  })

  it("keeps priced-in and failed expectation perspectives as eval/preference stock-feedback samples", async () => {
    await write(
      path.join(tmpRoot, "data/brain/attributions.jsonl"),
      `${JSON.stringify({
        schema: "self-question-attribution-v1",
        id: "selfqa-priced-in-1",
        type: "attribution",
        kind: "self-question-attribution",
        attributionMethod: "self_question_attribution_v1",
        validationId: "selfq-val-priced-in-1",
        questionRecordId: "selfq-priced-in-1",
        questionId: "self_q_priced_in_1",
        question: "玻璃基板是否已经从方向正确变成后手风险？",
        hypothesis: "方向正确，但连续缩量加速后赔率压缩。",
        stockName: "沃格光电",
        stockCode: "SH603773",
        windowDays: 5,
        verdict: "验证通过",
        attributionLabel: "price_only",
        confidenceImpact: "entry_risk_up",
        nextAction: "avoid_late_entry",
        attributionReason: "方向对但买点错，预期已经 price-in，后手追涨风险高。",
        marketSignals: ["relative_strength", "turnover_expansion", "follow_through", "theme_diffusion"],
        createdAt: "2026-06-19 14:10:00",
      })}\n${JSON.stringify({
        schema: "self-question-attribution-v1",
        id: "selfqa-failed-1",
        type: "attribution",
        kind: "self-question-attribution",
        attributionMethod: "self_question_attribution_v1",
        validationId: "selfq-val-failed-1",
        questionRecordId: "selfq-failed-1",
        questionId: "self_q_failed_1",
        question: "某一日游题材是否被证伪？",
        hypothesis: "无承接的一日游不应继续当作主线。",
        stockName: "样本股份",
        stockCode: "SH600000",
        windowDays: 3,
        verdict: "验证失败",
        attributionLabel: "disconfirmed",
        confidenceImpact: "negative",
        nextAction: "downgrade_hypothesis",
        attributionReason: "次日无承接、板块未扩散，预期失败。",
        marketSignals: ["no_follow_through"],
        createdAt: "2026-06-19 15:00:00",
      })}\n`,
    )

    await buildStockFeedbackTrajectories({ projectPath: tmpRoot, write: true })

    const listed = await listStockFeedbackTrajectories({ projectPath: tmpRoot, validationTarget: "priced_in_risk" })
    expect(listed.trajectories).toHaveLength(1)
    expect(listed.trajectories[0].qualityGate.status).toBe("priced_in_validated")

    const evalSamples = await exportTrainingSamples({ projectPath: tmpRoot, kind: "eval", qualityGate: "priced_in_validated" })
    expect(evalSamples.samples).toEqual([
      expect.objectContaining({
        source: "stock-feedback-trajectory",
        trainingUse: expect.arrayContaining(["eval", "preference"]),
        qualityGate: expect.objectContaining({
          status: "priced_in_validated",
          validationTarget: "priced_in_risk",
        }),
      }),
    ])

    const preferenceSamples = await exportTrainingSamples({ projectPath: tmpRoot, kind: "preference", qualityGate: "disconfirmed_validated" })
    expect(preferenceSamples.samples).toEqual([
      expect.objectContaining({
        source: "stock-feedback-trajectory",
        accepted: expect.stringContaining("降低假设权重"),
        rejected: expect.stringContaining("仅因短期上涨"),
      }),
    ])
  })

  it("exports compact PEFT-ready adapter candidates without embedding raw fact bodies", async () => {
    await write(
      path.join(tmpRoot, "data/brain/attributions.jsonl"),
      `${JSON.stringify({
        schema: "self-question-attribution-v1",
        id: "selfqa-lora-ready-1",
        type: "attribution",
        kind: "self-question-attribution",
        attributionMethod: "self_question_attribution_v1",
        validationId: "selfq-val-lora-ready-1",
        questionRecordId: "selfq-lora-ready-1",
        questionId: "self_q_lora_ready_1",
        question: "MPO 线索是否能形成可复用的预期交易判断？",
        hypothesis: "扩散、相对强度和承接共同验证预期交易。",
        stockName: "太辰光",
        stockCode: "SZ300570",
        windowDays: 3,
        verdict: "验证通过",
        attributionLabel: "price_only",
        confidenceImpact: "positive_but_unconfirmed",
        nextAction: "route_to_expectation_trade_eval",
        attributionReason: "相对强度、成交额放大、后续承接和链条扩散满足预期交易验证。",
        marketSignals: ["relative_strength", "turnover_expansion", "follow_through", "theme_diffusion"],
        rawFactBody: "这是不应该进入 LoRA-ready manifest 的原始大段事实。".repeat(200),
        createdAt: "2026-06-19 09:45:00",
      })}\n`,
    )
    await buildStockFeedbackTrajectories({ projectPath: tmpRoot, write: true })

    const dryRun = await exportStockFeedbackLoraReady({ projectPath: tmpRoot })
    expect(dryRun.dryRun).toBe(true)
    expect(dryRun.candidates[0]).toMatchObject({
      schema: "stock-feedback-adapter-candidate-v1",
      adapterCapability: "expectation_trade_judgment",
      validationTarget: "expectation_trade",
      qualityGateStatus: "expectation_validated",
    })
    expect(JSON.stringify(dryRun)).not.toContain("原始大段事实")

    const written = await exportStockFeedbackLoraReady({ projectPath: tmpRoot, write: true })
    expect(written.writeResult.manifest.relativePath).toMatch(/^\.llm-wiki\/stock-feedback\/exports\//)
    const manifest = JSON.parse(await read(written.writeResult.manifest.path))
    expect(manifest.sources).toEqual(expect.arrayContaining(["stock-feedback-trajectory-v1"]))
    expect(JSON.stringify(manifest)).not.toContain("原始大段事实")

    const benchmark = await buildStockFeedbackBenchmark({ projectPath: tmpRoot })
    expect(benchmark.coverage.byValidationTarget.expectation_trade).toBeGreaterThan(0)

    const verified = await verifyStockFeedbackArtifacts({ projectPath: tmpRoot })
    expect(verified.status).toBe("ok")
    expect(verified.issueCount).toBe(0)
  })

  it("distills market patterns and realized profit feedback into dynamic benchmark and adapter candidates", async () => {
    await write(
      path.join(tmpRoot, "data/brain/attributions.jsonl"),
      `${JSON.stringify({
        schema: "self-question-attribution-v1",
        id: "selfqa-pattern-profit-1",
        type: "attribution",
        kind: "self-question-attribution",
        attributionMethod: "self_question_attribution_v1",
        validationId: "selfq-val-pattern-profit-1",
        questionRecordId: "selfq-pattern-profit-1",
        questionId: "self_q_pattern_profit_1",
        question: "低位吸收后的事件预期能否先被市场交易？",
        hypothesis: "低位吸收后出现事件未落地预期，资金可能先交易扩散和相对强度。",
        stockName: "样本科技",
        stockCode: "SZ300001",
        windowDays: 5,
        verdict: "验证通过",
        attributionLabel: "price_only",
        confidenceImpact: "positive_and_profitable",
        nextAction: "solidify_pattern_with_risk_control",
        attributionReason: "低位吸收后相对强度抬升、成交额放大、板块扩散，事件未落地前市场先交易预期；实际收益为正，但回撤控制来自小仓试错和分批兑现。",
        marketSignals: ["relative_strength", "turnover_expansion", "follow_through", "theme_diffusion", "low_absorption"],
        realizedPnlPct: 12.4,
        maxDrawdownPct: -3.1,
        holdingDays: 4,
        entryTiming: "low_absorption_then_breakout",
        exitTiming: "scale_out_after_acceleration",
        positionSizing: "probe_then_add",
        rawFactBody: "不应该进入 adapter candidate 的原始事实。".repeat(200),
        createdAt: "2026-06-19 10:05:00",
      })}\n`,
    )

    await buildStockFeedbackTrajectories({ projectPath: tmpRoot, write: true })
    const listed = await listStockFeedbackTrajectories({ projectPath: tmpRoot, validationTarget: "expectation_trade" })
    expect(listed.trajectories[0]).toMatchObject({
      marketPatterns: expect.arrayContaining([
        expect.objectContaining({ id: "event_expectation_front_run" }),
        expect.objectContaining({ id: "low_absorption_breakout" }),
      ]),
      profitFeedback: {
        outcome: "profitable",
        realizedPnlPct: 12.4,
        maxDrawdownPct: -3.1,
        holdingDays: 4,
      },
      distillationSignals: expect.objectContaining({
        skill: "expectation_trade_judgment",
        toolHabit: expect.stringContaining("retrieval"),
        decisionStrategy: expect.stringContaining("低位吸收"),
        riskControl: expect.stringContaining("回撤"),
      }),
    })

    const benchmark = await buildStockFeedbackBenchmark({ projectPath: tmpRoot })
    expect(benchmark.coverage.byMarketPattern.low_absorption_breakout).toBeGreaterThan(0)
    expect(benchmark.cases[0]).toMatchObject({
      marketPatternIds: expect.arrayContaining(["event_expectation_front_run", "low_absorption_breakout"]),
      expected: expect.objectContaining({
        profitOutcome: "profitable",
        distillInto: expect.arrayContaining(["behavior", "skill", "tool_habit", "decision_strategy"]),
      }),
    })

    const loraReady = await exportStockFeedbackLoraReady({ projectPath: tmpRoot })
    expect(loraReady.candidates[0]).toMatchObject({
      marketPatternIds: expect.arrayContaining(["event_expectation_front_run", "low_absorption_breakout"]),
      profitFeedback: expect.objectContaining({ outcome: "profitable", realizedPnlPct: 12.4 }),
      distillationSignals: expect.objectContaining({
        distillInto: expect.arrayContaining(["behavior", "skill", "tool_habit", "decision_strategy"]),
      }),
    })
    expect(JSON.stringify(loraReady)).toContain("收益")
    expect(JSON.stringify(loraReady)).not.toContain("原始事实")
  })

  it("assigns profit feedback credit to reusable execution behavior instead of raw facts", async () => {
    await write(
      path.join(tmpRoot, "data/brain/attributions.jsonl"),
      `${JSON.stringify({
        schema: "self-question-attribution-v1",
        id: "selfqa-profit-credit-win",
        type: "attribution",
        kind: "self-question-attribution",
        attributionMethod: "self_question_attribution_v1",
        validationId: "selfq-val-profit-credit-win",
        questionRecordId: "selfq-profit-credit-win",
        questionId: "self_q_profit_credit_win",
        question: "低位吸收后的预期交易收益应该如何归因？",
        hypothesis: "低位吸收后小仓试错、转强加仓、加速分批兑现。",
        stockName: "样本收益A",
        stockCode: "SZ301001",
        verdict: "验证通过",
        attributionLabel: "price_only",
        attributionReason: "相对强度、成交额、板块扩散通过，收益来自低位吸收后的交易节奏。",
        marketSignals: ["relative_strength", "turnover_expansion", "follow_through", "theme_diffusion", "low_absorption"],
        realizedPnlPct: 13.6,
        maxDrawdownPct: -2.4,
        holdingDays: 5,
        entryTiming: "low_absorption_then_breakout",
        exitTiming: "scale_out_after_acceleration",
        positionSizing: "small_probe_then_add",
        rawFactBody: "收益归因不应该带入 LoRA 的原始事实正文。".repeat(120),
        createdAt: "2026-06-20 15:10:00",
      })}\n${JSON.stringify({
        schema: "self-question-attribution-v1",
        id: "selfqa-profit-credit-loss",
        type: "attribution",
        kind: "self-question-attribution",
        attributionMethod: "self_question_attribution_v1",
        validationId: "selfq-val-profit-credit-loss",
        questionRecordId: "selfq-profit-credit-loss",
        questionId: "self_q_profit_credit_loss",
        question: "方向对但后手追涨亏损应该如何归因？",
        hypothesis: "方向对，但后手追涨、仓位过重导致回撤。",
        stockName: "样本收益B",
        stockCode: "SZ301002",
        verdict: "验证通过",
        attributionLabel: "price_only",
        confidenceImpact: "entry_risk_up",
        nextAction: "avoid_late_entry",
        attributionReason: "方向对但买点错，预期已经 priced_in，后手追涨亏损。",
        marketSignals: ["relative_strength", "turnover_expansion", "follow_through"],
        realizedPnlPct: -5.7,
        maxDrawdownPct: -9.4,
        holdingDays: 2,
        entryTiming: "late_chase",
        exitTiming: "stop_loss_after_failed_follow_through",
        positionSizing: "oversized_chase",
        rawFactBody: "亏损归因不应该带入 LoRA 的原始事实正文。".repeat(120),
        createdAt: "2026-06-20 15:20:00",
      })}\n${JSON.stringify({
        schema: "self-question-attribution-v1",
        id: "selfqa-profit-credit-failed",
        type: "attribution",
        kind: "self-question-attribution",
        attributionMethod: "self_question_attribution_v1",
        validationId: "selfq-val-profit-credit-failed",
        questionRecordId: "selfq-profit-credit-failed",
        questionId: "self_q_profit_credit_failed",
        question: "一日游伪催化亏损应该如何归因？",
        hypothesis: "预期无承接且被证伪，不应归因成单纯买点问题。",
        stockName: "样本收益C",
        stockCode: "SZ301004",
        verdict: "验证失败",
        attributionLabel: "disconfirmed",
        confidenceImpact: "negative",
        nextAction: "downgrade_hypothesis",
        attributionReason: "次日无承接、板块未扩散，预期失败并造成亏损。",
        marketSignals: ["no_follow_through"],
        realizedPnlPct: -6.8,
        maxDrawdownPct: -8.7,
        holdingDays: 1,
        exitTiming: "stop_loss_after_no_follow_through",
        rawFactBody: "失败归因不应该带入 LoRA 的原始事实正文。".repeat(120),
        createdAt: "2026-06-20 15:30:00",
      })}\n`,
    )

    await buildStockFeedbackTrajectories({ projectPath: tmpRoot, write: true })
    const listed = await listStockFeedbackTrajectories({ projectPath: tmpRoot })
    const winner = listed.trajectories.find((item) => item.stock?.code === "SZ301001" && item.validationTarget === "expectation_trade")
    const loser = listed.trajectories.find((item) => item.stock?.code === "SZ301002" && item.validationTarget === "priced_in_risk")
    const failed = listed.trajectories.find((item) => item.stock?.code === "SZ301004" && item.validationTarget === "disconfirmation")
    expect(winner).toMatchObject({
      profitFeedback: expect.objectContaining({
        outcome: "profitable",
        creditAssignment: expect.objectContaining({
          trainingUse: "adapter_candidate_after_review",
          primaryCredit: "pattern_execution_supported",
          adapterLearns: expect.arrayContaining(["entry_timing", "position_sizing", "exit_discipline", "drawdown_control"]),
          storesRawFacts: false,
        }),
      }),
      distillationSignals: expect.objectContaining({
        profitCredit: expect.stringContaining("pattern_execution_supported"),
      }),
    })
    expect(failed).toMatchObject({
      profitFeedback: expect.objectContaining({
        outcome: "loss",
        creditAssignment: expect.objectContaining({
          trainingUse: "eval_preference_negative",
          primaryCredit: "failed_expectation_negative",
          adapterLearns: expect.arrayContaining(["failure_attribution"]),
          storesRawFacts: false,
        }),
      }),
    })
    expect(loser).toMatchObject({
      profitFeedback: expect.objectContaining({
        outcome: "loss",
        creditAssignment: expect.objectContaining({
          trainingUse: "eval_preference_negative",
          primaryCredit: "execution_risk_negative",
          adapterLearns: expect.arrayContaining(["entry_risk", "position_sizing", "stop_loss_or_exit_discipline"]),
          failureModes: expect.arrayContaining(["late_entry_or_chase"]),
          storesRawFacts: false,
        }),
      }),
    })

    const benchmark = await buildStockFeedbackBenchmark({ projectPath: tmpRoot })
    const lossCase = benchmark.cases.find((item) => item.sourceTrajectoryId === loser.id)
    expect(lossCase).toMatchObject({
      expected: expect.objectContaining({
        profitCredit: expect.objectContaining({
          primaryCredit: "execution_risk_negative",
          trainingUse: "eval_preference_negative",
        }),
      }),
    })

    const loraReady = await exportStockFeedbackLoraReady({ projectPath: tmpRoot })
    const candidate = loraReady.candidates.find((item) => item.sourceTrajectoryId === winner.id)
    expect(candidate).toMatchObject({
      profitFeedback: expect.objectContaining({
        creditAssignment: expect.objectContaining({
          primaryCredit: "pattern_execution_supported",
          storesRawFacts: false,
        }),
      }),
      distillationPlan: expect.objectContaining({
        adapterLearns: expect.arrayContaining([
          expect.objectContaining({ kind: "profit_credit_assignment", value: expect.stringContaining("pattern_execution_supported") }),
        ]),
      }),
    })
    expect(JSON.stringify({ benchmark, loraReady })).not.toContain("原始事实正文")
  })

  it("reports profit credit coverage gaps in the dynamic benchmark curriculum", async () => {
    await write(
      path.join(tmpRoot, "data/brain/attributions.jsonl"),
      `${JSON.stringify({
        schema: "self-question-attribution-v1",
        id: "selfqa-profit-credit-coverage",
        type: "attribution",
        kind: "self-question-attribution",
        attributionMethod: "self_question_attribution_v1",
        validationId: "selfq-val-profit-credit-coverage",
        questionRecordId: "selfq-profit-credit-coverage",
        questionId: "self_q_profit_credit_coverage",
        question: "低位吸收预期交易的正收益是否可沉淀为可复用执行能力？",
        hypothesis: "低位吸收后小仓试错，扩散确认后加仓，冲高分批兑现。",
        stockName: "样本收益覆盖",
        stockCode: "SZ301003",
        verdict: "验证通过",
        attributionLabel: "price_only",
        attributionReason: "低位吸收后相对强度、成交额、扩散和承接通过，收益来自执行节奏。",
        marketSignals: ["relative_strength", "turnover_expansion", "follow_through", "theme_diffusion", "low_absorption"],
        realizedPnlPct: 9.8,
        maxDrawdownPct: -2.1,
        holdingDays: 3,
        entryTiming: "low_absorption_then_breakout",
        exitTiming: "scale_out_after_acceleration",
        positionSizing: "small_probe_then_add",
        rawFactBody: "动态测试集 coverage 不应该复制原始事实正文。".repeat(120),
        createdAt: "2026-06-20 16:10:00",
      })}\n`,
    )

    await buildStockFeedbackTrajectories({ projectPath: tmpRoot, write: true })
    const benchmark = await buildStockFeedbackBenchmark({ projectPath: tmpRoot, write: true })

    expect(benchmark.coverage.byProfitCredit).toMatchObject({
      pattern_execution_supported: 1,
    })
    expect(benchmark.dynamicTestSet.profitCreditCounts).toMatchObject({
      pattern_execution_supported: 1,
    })
    expect(benchmark.dynamicTestSet.coverageGaps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        bucket: "profit_credit",
        id: "execution_risk_negative",
        recommendedAction: "collect_entry_risk_loss_feedback",
        trainingUse: "eval_preference_negative",
      }),
      expect.objectContaining({
        bucket: "profit_credit",
        id: "failed_expectation_negative",
        recommendedAction: "collect_failed_expectation_feedback",
        trainingUse: "eval_preference_negative",
      }),
    ]))
    expect(benchmark.dynamicTestSet.coverageGaps).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ bucket: "profit_credit", id: "pattern_execution_supported" }),
    ]))

    const manifest = JSON.parse(await read(benchmark.writeResult.manifest.path))
    expect(manifest.coverage.byProfitCredit.pattern_execution_supported).toBe(1)
    expect(manifest.dynamicTestSet.profitCreditCounts.pattern_execution_supported).toBe(1)
    expect(JSON.stringify(manifest)).not.toContain("原始事实正文")
  })

  it("filters stock-feedback trajectories by market pattern for radar-driven review", async () => {
    await write(
      path.join(tmpRoot, "data/brain/attributions.jsonl"),
      `${JSON.stringify({
        schema: "self-question-attribution-v1",
        id: "selfqa-market-pattern-filter-1",
        type: "attribution",
        kind: "self-question-attribution",
        attributionMethod: "self_question_attribution_v1",
        validationId: "selfq-val-market-pattern-filter-1",
        questionRecordId: "selfq-market-pattern-filter-1",
        questionId: "self_q_market_pattern_filter_1",
        question: "低位吸收转强是否能作为可复用样本？",
        hypothesis: "低位吸收后放量突破，适合训练预期交易的试错到加仓节奏。",
        stockName: "样本科技F1",
        stockCode: "SZ300501",
        verdict: "验证通过",
        attributionLabel: "price_only",
        attributionReason: "低位吸收后相对强度抬升、成交额放大、板块扩散并出现 follow-through。",
        marketSignals: ["relative_strength", "turnover_expansion", "follow_through", "theme_diffusion", "low_absorption"],
        createdAt: "2026-06-19 10:01:00",
      })}\n${JSON.stringify({
        schema: "self-question-attribution-v1",
        id: "selfqa-market-pattern-filter-2",
        type: "attribution",
        kind: "self-question-attribution",
        attributionMethod: "self_question_attribution_v1",
        validationId: "selfq-val-market-pattern-filter-2",
        questionRecordId: "selfq-market-pattern-filter-2",
        questionId: "self_q_market_pattern_filter_2",
        question: "方向对但后手风险是否要转 preference？",
        hypothesis: "题材方向正确，但已经 priced-in，追涨买点风险高。",
        stockName: "样本科技F2",
        stockCode: "SZ300502",
        verdict: "验证通过",
        attributionLabel: "price_only",
        confidenceImpact: "entry_risk_up",
        nextAction: "avoid_late_entry",
        attributionReason: "方向对但后手，赔率压缩，priced-in 后继续追涨风险高。",
        marketSignals: ["relative_strength", "turnover_expansion", "follow_through", "theme_diffusion"],
        realizedPnlPct: -4.8,
        createdAt: "2026-06-19 10:05:00",
      })}\n`,
    )

    await buildStockFeedbackTrajectories({ projectPath: tmpRoot, write: true })

    const lowAbsorption = await listStockFeedbackTrajectories({
      projectPath: tmpRoot,
      marketPattern: "low_absorption_breakout",
    })
    expect(lowAbsorption.filters.marketPattern).toBe("low_absorption_breakout")
    expect(lowAbsorption.trajectories).toHaveLength(1)
    expect(lowAbsorption.trajectories[0]).toMatchObject({
      stock: expect.objectContaining({ code: "SZ300501" }),
      marketPatterns: expect.arrayContaining([
        expect.objectContaining({ id: "low_absorption_breakout" }),
      ]),
    })

    const pricedIn = await listStockFeedbackTrajectories({
      projectPath: tmpRoot,
      marketPattern: "priced_in_late_entry",
    })
    expect(pricedIn.filters.marketPattern).toBe("priced_in_late_entry")
    expect(pricedIn.trajectories.length).toBeGreaterThan(0)
    expect(pricedIn.trajectories.every((trajectory) => trajectory.stock?.code === "SZ300502")).toBe(true)
    expect(pricedIn.trajectories.every((trajectory) => (
      trajectory.marketPatterns ?? []
    ).some((pattern) => pattern.id === "priced_in_late_entry"))).toBe(true)
    expect(pricedIn.trajectories.some((trajectory) => trajectory.validationTarget === "priced_in_risk")).toBe(true)
  })

  it("explains distillation plans for human review without leaking raw facts into LoRA-ready candidates", async () => {
    await write(
      path.join(tmpRoot, "data/brain/attributions.jsonl"),
      `${JSON.stringify({
        schema: "self-question-attribution-v1",
        id: "selfqa-distillation-plan-1",
        type: "attribution",
        kind: "self-question-attribution",
        attributionMethod: "self_question_attribution_v1",
        validationId: "selfq-val-distillation-plan-1",
        questionRecordId: "selfq-distillation-plan-1",
        questionId: "self_q_distillation_plan_1",
        question: "低位吸收后的事件预期应该如何给人审、给 adapter 学？",
        hypothesis: "低位吸收后相对强度和扩散同步出现，适合沉淀预期交易判断技能。",
        stockName: "样本科技D",
        stockCode: "SZ300301",
        verdict: "验证通过",
        attributionLabel: "price_only",
        attributionReason: "低位吸收后相对强度抬升、成交额放大、板块扩散，实际收益为正，但原文事实必须留在 retrieval。",
        marketSignals: ["relative_strength", "turnover_expansion", "follow_through", "theme_diffusion", "low_absorption"],
        realizedPnlPct: 10.6,
        maxDrawdownPct: -2.8,
        holdingDays: 3,
        rawFactBody: "不应该进入蒸馏计划或 LoRA-ready 的原始事实。".repeat(160),
        createdAt: "2026-06-19 10:55:00",
      })}\n`,
    )

    await buildStockFeedbackTrajectories({ projectPath: tmpRoot, write: true })
    const listed = await listStockFeedbackTrajectories({ projectPath: tmpRoot, validationTarget: "expectation_trade" })
    expect(listed.trajectories[0].distillationPlan).toMatchObject({
      schema: "stock-feedback-distillation-plan-v1",
      factBoundary: expect.objectContaining({
        storesRawFacts: false,
        adapterDoesNotStore: expect.arrayContaining(["raw_facts", "announcements_or_report_text", "price_rows_or_trade_records"]),
      }),
      adapterLearns: expect.arrayContaining([
        expect.objectContaining({ kind: "behavior", value: expect.stringContaining("预期交易") }),
        expect.objectContaining({ kind: "tool_habit", value: expect.stringContaining("retrieval") }),
        expect.objectContaining({ kind: "decision_strategy", value: expect.stringContaining("低位吸收") }),
      ]),
      humanDecision: expect.objectContaining({
        recommendedAction: "approve_for_adapter",
        recommendedActionLabel: expect.stringContaining("adapter"),
      }),
    })
    expect(listed.trajectories[0].distillationPlan.requiredToolState).toEqual(expect.arrayContaining([
      expect.stringContaining("price-volume"),
      expect.stringContaining("sourceRefs"),
    ]))

    const queue = await listStockFeedbackReviewQueue({ projectPath: tmpRoot })
    expect(queue.items[0].distillationPlan).toMatchObject({
      planId: listed.trajectories[0].distillationPlan.planId,
      humanDecision: expect.objectContaining({ recommendedAction: "approve_for_adapter" }),
    })
    expect(queue.items[0].humanActionPlan).toMatchObject({
      schema: "stock-feedback-human-action-plan-v1",
      sourceTrajectoryId: listed.trajectories[0].id,
      recommendedAction: "approve_for_adapter",
      primaryButtonLabel: expect.stringContaining("adapter"),
      expectedRouting: expect.objectContaining({
        eval: true,
        sft: true,
        adapterCandidate: true,
        preference: false,
      }),
      peftBoundary: expect.objectContaining({
        storesRawFacts: false,
        adapterStores: expect.arrayContaining(["behavior", "skill", "tool_habit", "decision_strategy"]),
      }),
    })
    expect(queue.items[0].humanActionPlan.actionOptions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: "approve_for_adapter",
        label: expect.stringContaining("adapter"),
        recommended: true,
        enabled: true,
        preview: expect.objectContaining({
          trainingUse: expect.arrayContaining(["eval", "sft", "adapter"]),
          routing: expect.objectContaining({
            eval: true,
            sft: true,
            adapterCandidate: true,
          }),
          trainingWeightDecision: expect.objectContaining({
            state: "human_approved_upweight",
            effectiveWeightMultiplier: 1,
          }),
        }),
      }),
      expect.objectContaining({
        action: "route_to_preference",
        enabled: true,
        preview: expect.objectContaining({
          trainingUse: expect.arrayContaining(["eval", "preference"]),
          trainingWeightDecision: expect.objectContaining({
            state: "human_risk_downweight",
            effectiveWeightMultiplier: 0.75,
          }),
        }),
      }),
      expect.objectContaining({
        action: "needs_evidence",
        preview: expect.objectContaining({
          trainingUse: expect.arrayContaining(["needs_evidence"]),
          trainingWeightDecision: expect.objectContaining({
            state: "evidence_gap_downweight",
            effectiveWeightMultiplier: 0.25,
          }),
        }),
      }),
      expect.objectContaining({
        action: "reject_for_adapter",
        preview: expect.objectContaining({
          trainingUse: expect.arrayContaining(["audit"]),
          trainingWeightDecision: expect.objectContaining({
            state: "human_rejected_zero_weight",
            effectiveWeightMultiplier: 0,
          }),
        }),
      }),
    ]))
    expect(queue.items[0].humanActionPlan.why).toEqual(expect.arrayContaining([
      expect.stringContaining("market_pattern:low_absorption_breakout"),
    ]))

    const loraReady = await exportStockFeedbackLoraReady({ projectPath: tmpRoot })
    expect(loraReady.candidates[0].distillationPlan).toMatchObject({
      planId: listed.trajectories[0].distillationPlan.planId,
      adapterCurriculum: expect.objectContaining({
        strategy: "review_weighted_adapter_curriculum_v1",
        bucket: expect.any(String),
      }),
    })
    expect(JSON.stringify({ listed, queue, loraReady })).not.toContain("不应该进入蒸馏计划")
  })

  it("uses realized profit feedback to override adapter-positive stock-feedback review recommendations", async () => {
    await write(
      path.join(tmpRoot, "data/brain/attributions.jsonl"),
      `${JSON.stringify({
        schema: "self-question-attribution-v1",
        id: "selfqa-loss-review-route-1",
        type: "attribution",
        kind: "self-question-attribution",
        attributionMethod: "self_question_attribution_v1",
        validationId: "selfq-val-loss-review-route-1",
        questionRecordId: "selfq-loss-review-route-1",
        questionId: "self_q_loss_review_route_1",
        question: "扩散和相对强度验证的预期交易，如果真实收益为负，是否还能直接进 adapter？",
        hypothesis: "预期交易方向被市场交易过，但买点/赔率导致真实收益为负。",
        stockName: "样本科技L",
        stockCode: "SZ300901",
        verdict: "验证通过",
        attributionLabel: "price_only",
        attributionReason: "相对强度、成交额和板块扩散都出现，但后续交易收益为负，应沉淀成负反馈而不是正样本。",
        marketSignals: ["relative_strength", "turnover_expansion", "follow_through", "theme_diffusion"],
        realizedPnlPct: -3.4,
        maxDrawdownPct: 8.1,
        holdingDays: 2,
        entryTiming: "late_chase",
        createdAt: "2026-06-19 11:20:00",
      })}\n`,
    )

    await buildStockFeedbackTrajectories({ projectPath: tmpRoot, write: true })

    const queue = await listStockFeedbackReviewQueue({ projectPath: tmpRoot })
    const expectationItem = queue.items.find((item) => item.trajectory.validationTarget === "expectation_trade")
    expect(expectationItem).toMatchObject({
      recommendedAction: "route_to_preference",
      humanActionPlan: expect.objectContaining({
        recommendedAction: "route_to_preference",
        expectedRouting: expect.objectContaining({
          eval: true,
          preference: true,
          adapterCandidate: false,
        }),
      }),
      trajectory: expect.objectContaining({
        qualityGate: expect.objectContaining({
          status: "expectation_validated",
          highConfidenceEligible: true,
        }),
        profitFeedback: expect.objectContaining({
          outcome: "loss",
          realizedPnlPct: -3.4,
        }),
      }),
    })
    expect(expectationItem?.humanActionPlan.actionOptions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: "route_to_preference",
        recommended: true,
        preview: expect.objectContaining({
          trainingWeightDecision: expect.objectContaining({
            state: "human_risk_downweight",
            effectiveWeightMultiplier: 0.75,
          }),
        }),
      }),
      expect.objectContaining({
        action: "approve_for_adapter",
        recommended: false,
      }),
    ]))
  })

  it("records human stock-feedback review events without touching wiki raw or brain", async () => {
    await write(path.join(tmpRoot, "wiki/股票/样本科技.md"), `${validFrontmatter("样本科技", "股票", "code: SZ300001\n")}# 样本科技\n`)
    await write(path.join(tmpRoot, "raw/研报新闻/2026-06-19-sample.md"), "原始研报材料。")
    await write(
      path.join(tmpRoot, "data/brain/attributions.jsonl"),
      `${JSON.stringify({
        schema: "self-question-attribution-v1",
        id: "selfqa-human-review-1",
        type: "attribution",
        kind: "self-question-attribution",
        attributionMethod: "self_question_attribution_v1",
        validationId: "selfq-val-human-review-1",
        questionRecordId: "selfq-human-review-1",
        questionId: "self_q_human_review_1",
        question: "低位吸收后的事件预期是否适合进入训练？",
        hypothesis: "低位吸收后有扩散和相对强度，适合作为预期交易样本。",
        stockName: "样本科技",
        stockCode: "SZ300001",
        windowDays: 5,
        verdict: "验证通过",
        attributionLabel: "price_only",
        confidenceImpact: "positive_and_profitable",
        nextAction: "human_review_adapter_candidate",
        attributionReason: "低位吸收后相对强度抬升、成交额放大、板块扩散，实际收益为正。",
        marketSignals: ["relative_strength", "turnover_expansion", "follow_through", "theme_diffusion", "low_absorption"],
        realizedPnlPct: 9.2,
        maxDrawdownPct: -2.4,
        holdingDays: 3,
        createdAt: "2026-06-19 10:25:00",
      })}\n`,
    )
    const wikiBefore = await read(path.join(tmpRoot, "wiki/股票/样本科技.md"))
    const rawBefore = await read(path.join(tmpRoot, "raw/研报新闻/2026-06-19-sample.md"))
    const brainBefore = await read(path.join(tmpRoot, "data/brain/attributions.jsonl"))

    await buildStockFeedbackTrajectories({ projectPath: tmpRoot, write: true })
    const queue = await listStockFeedbackReviewQueue({ projectPath: tmpRoot })
    expect(queue).toMatchObject({
      schema: "stock-feedback-review-queue-v1",
      counts: expect.objectContaining({
        pending: 1,
        reviewed: 0,
      }),
    })
    expect(queue.items[0]).toMatchObject({
      recommendedAction: "approve_for_adapter",
      trajectory: expect.objectContaining({
        validationTarget: "expectation_trade",
        qualityGate: expect.objectContaining({ status: "expectation_validated" }),
      }),
      latestReview: null,
    })

    const dryRun = await reviewStockFeedbackTrajectory({
      projectPath: tmpRoot,
      trajectoryId: queue.items[0].trajectory.id,
      action: "approve_for_adapter",
      reviewer: "codex-test",
      note: "确认进入预期交易 adapter 候选，保留事实在 retrieval/tool state。",
    })
    expect(dryRun.dryRun).toBe(true)
    expect(dryRun.writeResult).toBe(null)
    expect(dryRun.reviewEvent).toMatchObject({
      schema: "stock-feedback-review-event-v1",
      result: "approved",
      action: "approve_for_adapter",
      reviewer: "codex-test",
      sourceTrajectoryId: queue.items[0].trajectory.id,
      trainingWeightDecision: expect.objectContaining({
        state: "human_approved_upweight",
        effectiveWeightMultiplier: 1,
        source: "human_review",
      }),
    })

    const written = await reviewStockFeedbackTrajectory({
      projectPath: tmpRoot,
      trajectoryId: queue.items[0].trajectory.id,
      action: "approve_for_adapter",
      reviewer: "codex-test",
      note: "确认进入预期交易 adapter 候选，保留事实在 retrieval/tool state。",
      write: true,
    })
    expect(written.writeResult.review.relativePath).toMatch(/^\.llm-wiki\/stock-feedback\/reviews\//)
    const reviewText = await read(written.writeResult.review.path)
    expect(reviewText).toContain("approve_for_adapter")
    expect(reviewText).not.toContain("原始研报材料")

    const reviewedQueue = await listStockFeedbackReviewQueue({ projectPath: tmpRoot })
    expect(reviewedQueue.counts).toMatchObject({ pending: 0, reviewed: 1 })
    expect(reviewedQueue.items[0].latestReview).toMatchObject({
      result: "approved",
      action: "approve_for_adapter",
      reviewer: "codex-test",
      trainingWeightDecision: expect.objectContaining({
        state: "human_approved_upweight",
        effectiveWeightMultiplier: 1,
      }),
    })

    expect(await read(path.join(tmpRoot, "wiki/股票/样本科技.md"))).toBe(wikiBefore)
    expect(await read(path.join(tmpRoot, "raw/研报新闻/2026-06-19-sample.md"))).toBe(rawBefore)
    expect(await read(path.join(tmpRoot, "data/brain/attributions.jsonl"))).toBe(brainBefore)
    const verified = await verifyStockFeedbackArtifacts({ projectPath: tmpRoot })
    expect(verified.status).toBe("ok")
  })

  it("prioritizes dynamic benchmark cases from review signals, scarce patterns, and profit feedback", async () => {
    const attributions = [
      {
        schema: "self-question-attribution-v1",
        id: "selfqa-dynamic-profit-1",
        type: "attribution",
        kind: "self-question-attribution",
        attributionMethod: "self_question_attribution_v1",
        validationId: "selfq-val-dynamic-profit-1",
        questionRecordId: "selfq-dynamic-profit-1",
        questionId: "self_q_dynamic_profit_1",
        question: "低位吸收后的事件预期是否可进入高质量预期交易样本？",
        hypothesis: "低位吸收后出现事件未落地预期，资金先交易扩散和相对强度。",
        stockName: "样本科技A",
        stockCode: "SZ300101",
        verdict: "验证通过",
        attributionLabel: "price_only",
        attributionReason: "低位吸收后相对强度抬升、成交额放大、板块扩散，实际收益为正。",
        marketSignals: ["relative_strength", "turnover_expansion", "follow_through", "theme_diffusion", "low_absorption"],
        realizedPnlPct: 11.8,
        maxDrawdownPct: -2.2,
        holdingDays: 4,
        createdAt: "2026-06-19 10:10:00",
      },
      {
        schema: "self-question-attribution-v1",
        id: "selfqa-dynamic-priced-in-1",
        type: "attribution",
        kind: "self-question-attribution",
        attributionMethod: "self_question_attribution_v1",
        validationId: "selfq-val-dynamic-priced-in-1",
        questionRecordId: "selfq-dynamic-priced-in-1",
        questionId: "self_q_dynamic_priced_in_1",
        question: "方向正确但后手追涨是否应进入偏好样本？",
        hypothesis: "方向正确，但连续加速后赔率压缩。",
        stockName: "样本科技B",
        stockCode: "SZ300102",
        verdict: "验证通过",
        attributionLabel: "price_only",
        attributionReason: "方向对但买点错，预期已经 priced_in，后手追涨风险高。",
        marketSignals: ["relative_strength", "turnover_expansion", "follow_through"],
        realizedPnlPct: -4.6,
        maxDrawdownPct: -8.3,
        holdingDays: 2,
        createdAt: "2026-06-19 14:10:00",
      },
      {
        schema: "self-question-attribution-v1",
        id: "selfqa-dynamic-failed-1",
        type: "attribution",
        kind: "self-question-attribution",
        attributionMethod: "self_question_attribution_v1",
        validationId: "selfq-val-dynamic-failed-1",
        questionRecordId: "selfq-dynamic-failed-1",
        questionId: "self_q_dynamic_failed_1",
        question: "一日游伪催化是否应进入失败归因样本？",
        hypothesis: "无承接的一日游不应继续当作主线。",
        stockName: "样本科技C",
        stockCode: "SZ300103",
        verdict: "验证失败",
        attributionLabel: "disconfirmed",
        attributionReason: "次日无承接、板块未扩散，预期失败。",
        marketSignals: ["no_follow_through"],
        realizedPnlPct: -7.1,
        maxDrawdownPct: -9.5,
        holdingDays: 1,
        createdAt: "2026-06-19 15:10:00",
      },
    ]
    await write(path.join(tmpRoot, "data/brain/attributions.jsonl"), `${attributions.map((item) => JSON.stringify(item)).join("\n")}\n`)
    await buildStockFeedbackTrajectories({ projectPath: tmpRoot, write: true })
    const queue = await listStockFeedbackReviewQueue({ projectPath: tmpRoot })
    const profitItem = queue.items.find((item) => item.trajectory?.stock?.code === "SZ300101")
    const lossExpectationItem = queue.items.find((item) => item.trajectory?.stock?.code === "SZ300102" && item.trajectory?.validationTarget === "expectation_trade")
    const pricedInItem = queue.items.find((item) => item.trajectory?.stock?.code === "SZ300102" && item.trajectory?.validationTarget === "priced_in_risk")
    expect(profitItem?.trajectory?.id).toBeTruthy()
    expect(lossExpectationItem?.trajectory?.id).toBeTruthy()
    expect(pricedInItem?.trajectory?.id).toBeTruthy()
    expect(profitItem).toMatchObject({
      recommendedAction: "approve_for_adapter",
      humanActionPlan: expect.objectContaining({ recommendedAction: "approve_for_adapter" }),
    })
    expect(lossExpectationItem).toMatchObject({
      recommendedAction: "route_to_preference",
      humanActionPlan: expect.objectContaining({ recommendedAction: "route_to_preference" }),
    })
    expect(pricedInItem).toMatchObject({
      recommendedAction: "mark_priced_in",
      humanActionPlan: expect.objectContaining({ recommendedAction: "mark_priced_in" }),
    })
    await reviewStockFeedbackTrajectory({
      projectPath: tmpRoot,
      trajectoryId: profitItem.trajectory.id,
      action: "approve_for_adapter",
      reviewer: "codex-test",
      note: "人工确认低位吸收预期交易样本可进入 adapter 候选。",
      write: true,
    })
    await reviewStockFeedbackTrajectory({
      projectPath: tmpRoot,
      trajectoryId: pricedInItem.trajectory.id,
      action: "mark_priced_in",
      reviewer: "codex-test",
      note: "人工确认方向对但赔率压缩，应作为 priced-in 风控样本。",
      write: true,
    })

    const benchmark = await buildStockFeedbackBenchmark({ projectPath: tmpRoot, limit: 20 })
    expect(benchmark.dynamicTestSet).toMatchObject({
      strategy: "review_weighted_market_pattern_curriculum_v1",
      counts: expect.objectContaining({
        reviewedCases: 2,
        negativeOrRiskCases: expect.any(Number),
      }),
    })
    expect(benchmark.dynamicTestSet.coverageGaps).toEqual(expect.arrayContaining([
      expect.objectContaining({ bucket: "market_pattern", id: "fundamental_closure_confirmation" }),
    ]))
    expect(benchmark.dynamicTestSet.profitCreditCounts).toMatchObject({
      pattern_execution_supported: 1,
      execution_risk_negative: expect.any(Number),
      failed_expectation_negative: 1,
    })
    expect(benchmark.dynamicTestSet.coverageGaps).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ bucket: "profit_credit" }),
    ]))
    expect(benchmark.cases[0]).toMatchObject({
      dynamicPriority: expect.objectContaining({
        score: expect.any(Number),
        bucket: expect.any(String),
        reasons: expect.arrayContaining([expect.stringMatching(/human_review|risk_negative|adapter_approved/)]),
      }),
      reviewSignal: expect.objectContaining({
        latestAction: expect.any(String),
        reviewed: true,
      }),
    })
    expect(benchmark.cases[0].dynamicPriority.score).toBeGreaterThanOrEqual(benchmark.cases.at(-1).dynamicPriority.score)
    expect(benchmark.cases.map((item) => item.dynamicPriority.bucket)).toEqual(expect.arrayContaining([
      "adapter_approved",
      "risk_negative",
    ]))
    expect(benchmark.manifest.dynamicTestSet.strategy).toBe("review_weighted_market_pattern_curriculum_v1")

    const status = await getStockFeedbackStatus({ projectPath: tmpRoot })
    expect(status.dynamicBenchmark).toMatchObject({
      strategy: "review_weighted_market_pattern_curriculum_v1",
      counts: expect.objectContaining({ reviewedCases: 2 }),
    })
    expect(status.counts.dynamicBenchmarkGaps).toBe(status.dynamicBenchmark.coverageGaps.length)
  })

  it("orders LoRA-ready adapter candidates by reviewed reusable skills without leaking raw facts", async () => {
    const attributions = [
      {
        schema: "self-question-attribution-v1",
        id: "selfqa-lora-priority-low-absorption",
        type: "attribution",
        kind: "self-question-attribution",
        attributionMethod: "self_question_attribution_v1",
        validationId: "selfq-val-lora-priority-low-absorption",
        questionRecordId: "selfq-lora-priority-low-absorption",
        questionId: "self_q_lora_priority_low_absorption",
        question: "低位吸收后的事件预期是否应进入 adapter 优先候选？",
        hypothesis: "低位吸收后出现事件未落地预期，资金先交易扩散和相对强度。",
        stockName: "样本科技A",
        stockCode: "SZ300201",
        verdict: "验证通过",
        attributionLabel: "price_only",
        attributionReason: "低位吸收后相对强度抬升、成交额放大、板块扩散，实际收益为正。",
        marketSignals: ["relative_strength", "turnover_expansion", "follow_through", "theme_diffusion", "low_absorption"],
        realizedPnlPct: 13.2,
        maxDrawdownPct: -2.6,
        holdingDays: 4,
        rawFactBody: "不应该进入 LoRA-ready 优先候选的原始事实。".repeat(120),
        createdAt: "2026-06-19 10:30:00",
      },
      {
        schema: "self-question-attribution-v1",
        id: "selfqa-lora-priority-baseline",
        type: "attribution",
        kind: "self-question-attribution",
        attributionMethod: "self_question_attribution_v1",
        validationId: "selfq-val-lora-priority-baseline",
        questionRecordId: "selfq-lora-priority-baseline",
        questionId: "self_q_lora_priority_baseline",
        question: "普通预期交易样本是否可作为候选？",
        hypothesis: "扩散、相对强度和承接共同验证预期交易。",
        stockName: "样本科技B",
        stockCode: "SZ300202",
        verdict: "验证通过",
        attributionLabel: "price_only",
        attributionReason: "相对强度、成交额放大、后续承接和链条扩散满足预期交易验证。",
        marketSignals: ["relative_strength", "turnover_expansion", "follow_through", "theme_diffusion"],
        realizedPnlPct: 4.1,
        maxDrawdownPct: -4.0,
        holdingDays: 2,
        createdAt: "2026-06-19 10:40:00",
      },
    ]
    await write(path.join(tmpRoot, "data/brain/attributions.jsonl"), `${attributions.map((item) => JSON.stringify(item)).join("\n")}\n`)
    await buildStockFeedbackTrajectories({ projectPath: tmpRoot, write: true })
    const queue = await listStockFeedbackReviewQueue({ projectPath: tmpRoot })
    const priorityItem = queue.items.find((item) => item.trajectory?.stock?.code === "SZ300201")
    expect(priorityItem?.trajectory?.id).toBeTruthy()
    await reviewStockFeedbackTrajectory({
      projectPath: tmpRoot,
      trajectoryId: priorityItem.trajectory.id,
      action: "approve_for_adapter",
      reviewer: "codex-test",
      note: "人工确认低位吸收预期交易是高复用 skill，应优先进 adapter。",
      write: true,
    })

    const loraReady = await exportStockFeedbackLoraReady({ projectPath: tmpRoot })
    expect(loraReady.manifest.adapterCurriculum).toMatchObject({
      strategy: "review_weighted_adapter_curriculum_v1",
      counts: expect.objectContaining({
        reviewedCandidates: 1,
        totalCandidates: 2,
        reviewedUpweightedCandidates: 1,
        defaultDownweightedCandidates: 1,
      }),
    })
    expect(loraReady.manifest.trainingWeightDecisionCounts).toMatchObject({
      human_approved_upweight: 1,
      default_downweighted_pending_review: 1,
    })
    expect(loraReady.manifest.adapterBatchRecipe).toMatchObject({
      schema: "stock-feedback-adapter-batch-recipe-v1",
      strategy: "human_review_weighted_peft_selection_v1",
      modelTrainingStarted: false,
      storesRawFacts: false,
      totalCandidates: 2,
      weightedCandidateCount: 2,
      totalEffectiveWeight: 1.5,
      peftBoundary: expect.objectContaining({
        modelTrainingStarted: false,
        storesRawFacts: false,
        adapterStores: expect.arrayContaining(["behavior", "skill", "tool habit", "decision strategy"]),
      }),
    })
    expect(loraReady.adapterBatchRecipe).toMatchObject(loraReady.manifest.adapterBatchRecipe)
    expect(loraReady.manifest.adapterBatchRecipe.buckets).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "human_approved_upweight",
        label: "人工确认可提权",
        count: 1,
        effectiveWeightMultiplier: 1,
        totalEffectiveWeight: 1,
        recommendedSampling: "priority_include",
        selectionUse: expect.arrayContaining(["sft", "adapter"]),
      }),
      expect.objectContaining({
        id: "default_downweighted_pending_review",
        label: "未审默认降权",
        count: 1,
        effectiveWeightMultiplier: 0.5,
        totalEffectiveWeight: 0.5,
        recommendedSampling: "downsample_until_review",
        selectionUse: expect.arrayContaining(["eval", "adapter_candidate_pool"]),
      }),
    ]))
    expect(loraReady.manifest.adapterCurriculum.coverageGaps).toEqual(expect.arrayContaining([
      expect.objectContaining({ bucket: "market_pattern", id: "priced_in_late_entry" }),
    ]))
    expect(loraReady.candidates[0]).toMatchObject({
      sourceTrajectoryId: priorityItem.trajectory.id,
      reviewSignal: expect.objectContaining({
        reviewed: true,
        latestAction: "approve_for_adapter",
      }),
      adapterPriority: expect.objectContaining({
        strategy: "review_weighted_adapter_curriculum_v1",
        bucket: "reviewed_reusable_skill",
        reasons: expect.arrayContaining(["adapter_approved", "profitable_feedback"]),
      }),
      trainingWeightDecision: expect.objectContaining({
        state: "human_approved_upweight",
        effectiveWeightMultiplier: 1,
        source: "human_review",
      }),
      curriculumBucket: "reviewed_reusable_skill",
    })
    expect(loraReady.candidates[0].adapterPriority.score).toBeGreaterThanOrEqual(loraReady.candidates.at(-1).adapterPriority.score)
    expect(loraReady.manifest.candidateRefs[0]).toMatchObject({
      id: loraReady.candidates[0].id,
      curriculumBucket: "reviewed_reusable_skill",
      adapterPriorityScore: loraReady.candidates[0].adapterPriority.score,
      trainingWeightState: "human_approved_upweight",
      effectiveWeightMultiplier: 1,
    })
    const approvedRecipeBucket = loraReady.manifest.adapterBatchRecipe.buckets.find((bucket) => bucket.id === "human_approved_upweight")
    expect(approvedRecipeBucket.candidateIds).toContain(loraReady.candidates[0].id)
    expect(loraReady.candidates.at(-1).trainingWeightDecision).toMatchObject({
      state: "default_downweighted_pending_review",
      effectiveWeightMultiplier: 0.5,
      source: "system_default",
    })
    expect(JSON.stringify(loraReady)).not.toContain("原始事实")

    const status = await getStockFeedbackStatus({ projectPath: tmpRoot })
    expect(status.adapterCurriculum).toMatchObject({
      strategy: "review_weighted_adapter_curriculum_v1",
      counts: expect.objectContaining({
        reviewedCandidates: 1,
        totalCandidates: 2,
      }),
    })
    expect(status.counts.adapterCandidates).toBe(2)
    expect(status.counts.adapterCurriculumGaps).toBe(status.adapterCurriculum.coverageGaps.length)
  })

  it("writes LoRA-ready batch refresh deltas after human review without leaking raw facts", async () => {
    const attributions = [
      {
        schema: "self-question-attribution-v1",
        id: "selfqa-lora-delta-approve",
        type: "attribution",
        kind: "self-question-attribution",
        attributionMethod: "self_question_attribution_v1",
        validationId: "selfq-val-lora-delta-approve",
        questionRecordId: "selfq-lora-delta-approve",
        questionId: "self_q_lora_delta_approve",
        question: "事件预期扩散后是否应进入 adapter 候选？",
        hypothesis: "事件未落地但相对强度、成交额和扩散共同验证预期交易。",
        stockName: "样本科技D1",
        stockCode: "SZ300211",
        verdict: "验证通过",
        attributionLabel: "price_only",
        attributionReason: "相对强度抬升、成交额放大、后续承接和主题扩散均通过。",
        marketSignals: ["relative_strength", "turnover_expansion", "follow_through", "theme_diffusion"],
        rawFactBody: "这段原始事实正文不应该进入 LoRA-ready delta。".repeat(120),
        createdAt: "2026-06-20 13:00:00",
      },
      {
        schema: "self-question-attribution-v1",
        id: "selfqa-lora-delta-reject",
        type: "attribution",
        kind: "self-question-attribution",
        attributionMethod: "self_question_attribution_v1",
        validationId: "selfq-val-lora-delta-reject",
        questionRecordId: "selfq-lora-delta-reject",
        questionId: "self_q_lora_delta_reject",
        question: "另一个预期交易样本是否应先排除 adapter？",
        hypothesis: "短期异动虽然被交易，但人工确认不具备可复用手法。",
        stockName: "样本科技D2",
        stockCode: "SZ300212",
        verdict: "验证通过",
        attributionLabel: "price_only",
        attributionReason: "有时间戳、相对强度、成交额和承接，但人工后续认为不可作为正向 adapter。",
        marketSignals: ["relative_strength", "turnover_expansion", "follow_through", "theme_diffusion"],
        rawFactBody: "另一段原始事实正文也不应该进入 LoRA-ready delta。".repeat(120),
        createdAt: "2026-06-20 13:01:00",
      },
    ]
    await write(path.join(tmpRoot, "data/brain/attributions.jsonl"), `${attributions.map((item) => JSON.stringify(item)).join("\n")}\n`)
    await buildStockFeedbackTrajectories({
      projectPath: tmpRoot,
      generatedAt: "2026-06-20 13:02:00",
      write: true,
    })

    const before = await exportStockFeedbackLoraReady({
      projectPath: tmpRoot,
      generatedAt: "2026-06-20 13:03:00",
      write: true,
    })
    expect(before.manifest.batchRefreshDelta).toBeNull()
    expect(before.manifest.trainingWeightDecisionCounts).toMatchObject({
      default_downweighted_pending_review: 2,
    })

    const queue = await listStockFeedbackReviewQueue({ projectPath: tmpRoot })
    const approveItem = queue.items.find((item) => item.trajectory?.stock?.code === "SZ300211")
    const rejectItem = queue.items.find((item) => item.trajectory?.stock?.code === "SZ300212")
    expect(approveItem?.trajectory?.id).toBeTruthy()
    expect(rejectItem?.trajectory?.id).toBeTruthy()
    await reviewStockFeedbackTrajectory({
      projectPath: tmpRoot,
      trajectoryId: approveItem.trajectory.id,
      action: "approve_for_adapter",
      reviewer: "codex-test",
      note: "确认这是可复用预期交易行为，允许提权。",
      generatedAt: "2026-06-20 13:04:00",
      write: true,
    })
    await reviewStockFeedbackTrajectory({
      projectPath: tmpRoot,
      trajectoryId: rejectItem.trajectory.id,
      action: "reject_for_adapter",
      reviewer: "codex-test",
      note: "人工排除 adapter 正样本，只保留 eval 审计价值。",
      generatedAt: "2026-06-20 13:05:00",
      write: true,
    })

    const after = await exportStockFeedbackLoraReady({
      projectPath: tmpRoot,
      generatedAt: "2026-06-20 13:06:00",
      write: true,
    })
    expect(after.manifest.batchRefreshDelta).toMatchObject({
      schema: "stock-feedback-lora-ready-batch-refresh-delta-v1",
      strategy: "candidate_ref_weight_bucket_diff_v1",
      previousManifestPath: before.writeResult.manifest.relativePath,
      previousGeneratedAt: "2026-06-20 13:03:00",
      currentGeneratedAt: "2026-06-20 13:06:00",
      counts: {
        totalBefore: 2,
        totalAfter: 2,
        upweighted: 1,
        downweighted: 1,
        unchanged: 0,
        rerouted: 0,
        movedIn: 0,
        movedOut: 0,
        adapterApproved: 1,
        rejected: 1,
      },
      peftBoundary: expect.objectContaining({
        storesRawFacts: false,
        factsRemainIn: expect.arrayContaining(["wiki/raw/facts/tool-state", "stock price SQL", "sourceRefs"]),
        adapterStores: expect.arrayContaining(["behavior", "skill", "tool habit", "decision strategy"]),
      }),
    })
    expect(after.manifest.batchRefreshDelta.movements).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceTrajectoryId: approveItem.trajectory.id,
        movement: "upweighted",
        before: expect.objectContaining({
          bucketId: "default_downweighted_pending_review",
          effectiveWeightMultiplier: 0.5,
        }),
        after: expect.objectContaining({
          bucketId: "human_approved_upweight",
          effectiveWeightMultiplier: 1,
        }),
      }),
      expect.objectContaining({
        sourceTrajectoryId: rejectItem.trajectory.id,
        movement: "downweighted",
        after: expect.objectContaining({
          bucketId: "human_rejected_zero_weight",
          effectiveWeightMultiplier: 0,
        }),
      }),
    ]))
    const persistedManifest = JSON.parse(await read(after.writeResult.manifest.path))
    expect(persistedManifest.batchRefreshDelta).toMatchObject(after.manifest.batchRefreshDelta)
    const status = await getStockFeedbackStatus({ projectPath: tmpRoot })
    expect(status.artifactSourceMix.loraReady.batchRefreshDelta).toMatchObject({
      headline: "批次刷新影响",
      totalBefore: 2,
      totalAfter: 2,
      upweighted: 1,
      downweighted: 1,
      rerouted: 0,
      rejected: 1,
      adapterApproved: 1,
      source: "lora-ready-refresh",
    })
    expect(status.artifactSourceMix.loraReady.batchRefreshDelta.movements).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceTrajectoryId: approveItem.trajectory.id,
        movement: "upweighted",
        before: expect.objectContaining({
          bucketId: "default_downweighted_pending_review",
          effectiveWeightMultiplier: 0.5,
        }),
        after: expect.objectContaining({
          bucketId: "human_approved_upweight",
          effectiveWeightMultiplier: 1,
        }),
      }),
      expect.objectContaining({
        sourceTrajectoryId: rejectItem.trajectory.id,
        movement: "downweighted",
        after: expect.objectContaining({
          bucketId: "human_rejected_zero_weight",
          effectiveWeightMultiplier: 0,
        }),
      }),
    ]))
    expect(status.artifactSourceMix.loraReady.batchRefreshDelta.detail).toContain("不搬运原始事实")
    expect(status.artifactSourceMix.loraReady.batchRefreshDelta.detail).toContain("retrieval/tool state")
    expect(JSON.stringify(status.artifactSourceMix.loraReady.batchRefreshDelta)).not.toContain("原始事实正文")
    expect(JSON.stringify(after.manifest.batchRefreshDelta)).not.toContain("原始事实正文")
  })

  it("keeps a trajectory movement index when compact status samples omit a reviewed item", async () => {
    const attributions = Array.from({ length: 9 }, (_, index) => ({
      schema: "self-question-attribution-v1",
      id: `selfqa-lora-index-${index}`,
      type: "attribution",
      kind: "self-question-attribution",
      attributionMethod: "self_question_attribution_v1",
      validationId: `selfq-val-lora-index-${index}`,
      questionRecordId: `selfq-lora-index-${index}`,
      questionId: `self_q_lora_index_${index}`,
      question: "事件预期扩散后是否应进入 adapter 候选？",
      hypothesis: `第 ${index} 个样本用来验证 batch movement index。`,
      stockName: `样本索引${index}`,
      stockCode: `SZ30${String(300 + index).padStart(4, "0")}`,
      verdict: "验证通过",
      attributionLabel: "price_only",
      attributionReason: "相对强度抬升、成交额放大、后续承接和主题扩散均通过。",
      marketSignals: ["relative_strength", "turnover_expansion", "follow_through", "theme_diffusion"],
      rawFactBody: "movement index 不应该泄露的原始事实正文。".repeat(80),
      createdAt: `2026-06-20 14:${String(index).padStart(2, "0")}:00`,
    }))
    await write(path.join(tmpRoot, "data/brain/attributions.jsonl"), `${attributions.map((item) => JSON.stringify(item)).join("\n")}\n`)
    await buildStockFeedbackTrajectories({
      projectPath: tmpRoot,
      generatedAt: "2026-06-20 14:10:00",
      write: true,
    })

    const before = await exportStockFeedbackLoraReady({
      projectPath: tmpRoot,
      generatedAt: "2026-06-20 14:11:00",
      write: true,
    })
    expect(before.manifest.batchRefreshDelta).toBeNull()

    const queue = await listStockFeedbackReviewQueue({ projectPath: tmpRoot })
    const approveItems = queue.items.filter((item) => item.trajectory?.stock?.code !== "SZ300308").slice(0, 8)
    const rejectItem = queue.items.find((item) => item.trajectory?.stock?.code === "SZ300308")
    expect(approveItems).toHaveLength(8)
    expect(rejectItem?.trajectory?.id).toBeTruthy()
    for (const [index, item] of approveItems.entries()) {
      await reviewStockFeedbackTrajectory({
        projectPath: tmpRoot,
        trajectoryId: item.trajectory.id,
        action: "approve_for_adapter",
        reviewer: "codex-test",
        note: "确认可进入 adapter 候选，用来填满 compact movement 摘要。",
        generatedAt: `2026-06-20 14:${String(12 + index).padStart(2, "0")}:00`,
        write: true,
      })
    }
    await reviewStockFeedbackTrajectory({
      projectPath: tmpRoot,
      trajectoryId: rejectItem.trajectory.id,
      action: "reject_for_adapter",
      reviewer: "codex-test",
      note: "这条降权样本应被 movementIndex 精确召回，即使不在 top movements。",
      generatedAt: "2026-06-20 14:21:00",
      write: true,
    })

    const after = await exportStockFeedbackLoraReady({
      projectPath: tmpRoot,
      generatedAt: "2026-06-20 14:22:00",
      write: true,
    })
    expect(after.manifest.batchRefreshDelta).toMatchObject({
      counts: expect.objectContaining({
        totalBefore: 9,
        totalAfter: 9,
        upweighted: 8,
        downweighted: 1,
      }),
    })
    expect(after.manifest.batchRefreshDelta.movementIndex?.[rejectItem.trajectory.id]).toMatchObject({
      sourceTrajectoryId: rejectItem.trajectory.id,
      movement: "downweighted",
      after: expect.objectContaining({
        bucketId: "human_rejected_zero_weight",
        effectiveWeightMultiplier: 0,
      }),
    })

    const status = await getStockFeedbackStatus({ projectPath: tmpRoot })
    const compactDelta = status.artifactSourceMix.loraReady.batchRefreshDelta
    expect(compactDelta.movements).toHaveLength(8)
    expect(compactDelta.movements).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceTrajectoryId: rejectItem.trajectory.id }),
    ]))
    expect(compactDelta.movementIndex?.[rejectItem.trajectory.id]).toMatchObject({
      sourceTrajectoryId: rejectItem.trajectory.id,
      movement: "downweighted",
      before: expect.objectContaining({
        bucketId: "default_downweighted_pending_review",
      }),
      after: expect.objectContaining({
        bucketId: "human_rejected_zero_weight",
        effectiveWeightMultiplier: 0,
      }),
    })
    expect(JSON.stringify(compactDelta.movementIndex)).not.toContain("原始事实正文")

    const verified = await verifyStockFeedbackArtifacts({ projectPath: tmpRoot })
    expect(verified.status).toBe("ok")
    const brokenManifest = JSON.parse(await read(after.writeResult.manifest.path))
    delete brokenManifest.batchRefreshDelta.movementIndex[rejectItem.trajectory.id]
    await write(after.writeResult.manifest.path, `${JSON.stringify(brokenManifest, null, 2)}\n`)
    const failed = await verifyStockFeedbackArtifacts({ projectPath: tmpRoot })
    expect(failed.status).toBe("failed")
    expect(failed.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: "error",
        code: "lora_ready_batch_delta_missing_movement_index_entry",
        sourceTrajectoryId: rejectItem.trajectory.id,
      }),
    ]))
  })

  it("summarizes market pattern radar across trajectories, reviews, benchmark, and LoRA-ready export", async () => {
    const attributions = [
      {
        schema: "self-question-attribution-v1",
        id: "selfqa-pattern-radar-low-absorption",
        type: "attribution",
        kind: "self-question-attribution",
        attributionMethod: "self_question_attribution_v1",
        validationId: "selfq-val-pattern-radar-low-absorption",
        questionRecordId: "selfq-pattern-radar-low-absorption",
        questionId: "self_q_pattern_radar_low_absorption",
        question: "低位吸收后的事件预期是否是可训练手法？",
        hypothesis: "低位吸收后出现事件未落地预期，资金先交易扩散和相对强度。",
        stockName: "样本科技R1",
        stockCode: "SZ300401",
        verdict: "验证通过",
        attributionLabel: "price_only",
        attributionReason: "低位吸收后相对强度抬升、成交额放大、板块扩散，实际收益为正。",
        marketSignals: ["relative_strength", "turnover_expansion", "follow_through", "theme_diffusion", "low_absorption"],
        realizedPnlPct: 12.9,
        maxDrawdownPct: -2.1,
        holdingDays: 4,
        rawFactBody: "不应该进入模式雷达或 LoRA-ready 的原始事实。".repeat(120),
        createdAt: "2026-06-19 10:20:00",
      },
      {
        schema: "self-question-attribution-v1",
        id: "selfqa-pattern-radar-priced-in",
        type: "attribution",
        kind: "self-question-attribution",
        attributionMethod: "self_question_attribution_v1",
        validationId: "selfq-val-pattern-radar-priced-in",
        questionRecordId: "selfq-pattern-radar-priced-in",
        questionId: "self_q_pattern_radar_priced_in",
        question: "方向正确但后手追涨是否应作为风险手法样本？",
        hypothesis: "方向正确，但连续加速后赔率压缩。",
        stockName: "样本科技R2",
        stockCode: "SZ300402",
        verdict: "验证通过",
        attributionLabel: "price_only",
        attributionReason: "方向对但买点错，预期已经 priced_in，后手追涨风险高。",
        marketSignals: ["relative_strength", "turnover_expansion", "follow_through"],
        realizedPnlPct: -5.4,
        maxDrawdownPct: -8.8,
        holdingDays: 2,
        createdAt: "2026-06-19 14:20:00",
      },
    ]
    await write(path.join(tmpRoot, "data/brain/attributions.jsonl"), `${attributions.map((item) => JSON.stringify(item)).join("\n")}\n`)
    await buildStockFeedbackTrajectories({ projectPath: tmpRoot, write: true })
    const queue = await listStockFeedbackReviewQueue({ projectPath: tmpRoot })
    const adapterItem = queue.items.find((item) => item.trajectory?.stock?.code === "SZ300401")
    const riskItem = queue.items.find((item) => item.trajectory?.stock?.code === "SZ300402" && item.trajectory?.validationTarget === "priced_in_risk")
    expect(adapterItem?.trajectory?.id).toBeTruthy()
    expect(riskItem?.trajectory?.id).toBeTruthy()
    await reviewStockFeedbackTrajectory({
      projectPath: tmpRoot,
      trajectoryId: adapterItem.trajectory.id,
      action: "approve_for_adapter",
      reviewer: "codex-test",
      note: "确认低位吸收预期交易是可复用手法。",
      write: true,
    })
    await reviewStockFeedbackTrajectory({
      projectPath: tmpRoot,
      trajectoryId: riskItem.trajectory.id,
      action: "mark_priced_in",
      reviewer: "codex-test",
      note: "确认方向对但赔率压缩，应作为风险控制手法。",
      write: true,
    })

    const status = await getStockFeedbackStatus({ projectPath: tmpRoot })
    expect(status.patternRadar).toMatchObject({
      schema: "stock-feedback-pattern-radar-v1",
      strategy: "market_pattern_health_v1",
      counts: expect.objectContaining({
        totalPatterns: expect.any(Number),
        coveredPatterns: expect.any(Number),
        missingPatterns: expect.any(Number),
        adapterReadyPatterns: expect.any(Number),
        riskControlPatterns: expect.any(Number),
      }),
    })
    expect(status.counts.patternRadarGaps).toBe(status.patternRadar.gaps.length)
    expect(status.patternRadar.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "low_absorption_breakout",
        health: expect.objectContaining({
          status: "adapter_ready",
          nextAction: "export_lora_ready_candidate",
        }),
        counts: expect.objectContaining({
          totalTrajectories: expect.any(Number),
          reviewedTrajectories: expect.any(Number),
          profitableTrajectories: expect.any(Number),
        }),
      }),
      expect.objectContaining({
        id: "priced_in_late_entry",
        health: expect.objectContaining({
          status: "risk_control_ready",
          nextAction: "add_to_preference_eval",
        }),
      }),
      expect.objectContaining({
        id: "fundamental_closure_confirmation",
        health: expect.objectContaining({
          status: "missing",
          nextAction: "collect_market_pattern_case",
        }),
      }),
    ]))
    const fundamentalGap = status.patternRadar.items.find((item) => item.id === "fundamental_closure_confirmation")
    expect(fundamentalGap.collectionTask).toMatchObject({
      schema: "stock-feedback-collection-task-v1",
      targetPatternId: "fundamental_closure_confirmation",
      recommendedAction: "collect_market_pattern_case",
      validationTarget: "fundamental_closure",
      requiredToolState: expect.arrayContaining([
        expect.stringContaining("announcements"),
        expect.stringContaining("financials"),
      ]),
      acceptanceCriteria: expect.arrayContaining([
        expect.stringContaining("fundamentalEvidenceConfirmed"),
      ]),
      peftBoundary: expect.objectContaining({
        storesRawFacts: false,
        adapterStores: expect.arrayContaining(["behavior", "skill", "tool_habit", "decision_strategy"]),
      }),
    })
    expect(status.patternRadar.collectionTasks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        taskId: fundamentalGap.collectionTask.taskId,
        targetPatternId: "fundamental_closure_confirmation",
      }),
    ]))

    const benchmark = await buildStockFeedbackBenchmark({ projectPath: tmpRoot })
    expect(benchmark.manifest.patternRadar).toMatchObject({
      schema: "stock-feedback-pattern-radar-v1",
      counts: expect.objectContaining({ adapterReadyPatterns: expect.any(Number) }),
    })

    const loraReady = await exportStockFeedbackLoraReady({ projectPath: tmpRoot })
    expect(loraReady.manifest.patternRadar).toMatchObject({
      strategy: "market_pattern_health_v1",
      topNextActions: expect.arrayContaining([
        expect.objectContaining({ action: "export_lora_ready_candidate" }),
      ]),
    })
    expect(JSON.stringify({ status, benchmark, loraReady })).not.toContain("不应该进入模式雷达")
  })

  it("plans writable collection-task drafts for missing market pattern samples without touching facts stores", async () => {
    const dryRun = await planStockFeedbackCollectionTask({
      projectPath: tmpRoot,
      marketPattern: "fundamental_closure_confirmation",
      generatedAt: "2026-06-20 09:30:00",
    })
    expect(dryRun).toMatchObject({
      schema: "stock-feedback-collection-task-result-v1",
      mode: "stock-feedback-collection-task",
      dryRun: true,
      collectionTask: expect.objectContaining({
        schema: "stock-feedback-collection-task-v1",
        targetPatternId: "fundamental_closure_confirmation",
        validationTarget: "fundamental_closure",
      }),
      draft: expect.objectContaining({
        schema: "stock-feedback-collection-task-draft-v1",
        targetPatternId: "fundamental_closure_confirmation",
        validationTarget: "fundamental_closure",
        status: "open",
        requiredToolState: expect.arrayContaining([
          expect.stringContaining("announcements"),
          expect.stringContaining("financials"),
        ]),
        acceptanceCriteria: expect.arrayContaining([
          expect.stringContaining("fundamentalEvidenceConfirmed"),
        ]),
        intakeTemplate: expect.objectContaining({
          evidenceRefs: [],
          rawFactBody: null,
          marketDataRows: null,
        }),
        peftBoundary: expect.objectContaining({
          storesRawFacts: false,
          adapterStores: expect.arrayContaining(["behavior", "skill", "tool_habit", "decision_strategy"]),
        }),
      }),
      writeResult: null,
      writePolicy: expect.objectContaining({
        wroteWiki: false,
        wroteRaw: false,
        wroteBrain: false,
        wroteArtifacts: false,
      }),
    })
    expect(JSON.stringify(dryRun)).not.toContain("原始正文")

    const written = await planStockFeedbackCollectionTask({
      projectPath: tmpRoot,
      marketPattern: "fundamental_closure_confirmation",
      generatedAt: "2026-06-20 09:31:00",
      write: true,
    })
    expect(written.dryRun).toBe(false)
    expect(written.writeResult.draft.relativePath).toMatch(/^\.llm-wiki\/stock-feedback\/collection-tasks\//)
    expect(written.writeResult.manifest.relativePath).toMatch(/^\.llm-wiki\/stock-feedback\/collection-tasks\//)
    const manifest = JSON.parse(await read(written.writeResult.manifest.path))
    expect(manifest).toMatchObject({
      schema: "stock-feedback-collection-task-manifest-v1",
      count: 1,
      targetPatternId: "fundamental_closure_confirmation",
      validationTarget: "fundamental_closure",
      peftBoundary: expect.objectContaining({ storesRawFacts: false }),
      writeBoundary: expect.objectContaining({
        root: ".llm-wiki/stock-feedback",
        wroteWiki: false,
        wroteRaw: false,
        wroteBrain: false,
      }),
    })
    expect(JSON.stringify(manifest)).not.toContain("原始正文")
    await expect(read(path.join(tmpRoot, "wiki/stock-feedback-collection-task.md"))).rejects.toThrow()
    await expect(read(path.join(tmpRoot, "raw/stock-feedback-collection-task.json"))).rejects.toThrow()

    const verified = await verifyStockFeedbackArtifacts({ projectPath: tmpRoot })
    expect(verified.status).toBe("ok")
    expect(verified.checked.collectionTaskDrafts).toBe(1)
    expect(verified.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: "warning", code: "no_stock_feedback_trajectories" }),
    ]))

    await write(
      path.join(tmpRoot, ".llm-wiki/stock-feedback/collection-tasks/bad-raw-fact.jsonl"),
      `${JSON.stringify({
        ...written.draft,
        id: "bad_collection_task_raw_fact",
        intakeTemplate: {
          ...written.draft.intakeTemplate,
          rawFactBody: "原始正文不应该写进采集单。".repeat(300),
        },
      })}\n`,
    )
    const rejected = await verifyStockFeedbackArtifacts({ projectPath: tmpRoot })
    expect(rejected.status).toBe("failed")
    expect(rejected.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: "error",
        code: "collection_task_contains_raw_fact_body",
        id: "bad_collection_task_raw_fact",
        path: "intakeTemplate.rawFactBody",
      }),
    ]))
  })

  it("plans profit-credit collection-task drafts from benchmark gaps without touching facts stores", async () => {
    const dryRun = await planStockFeedbackCollectionTask({
      projectPath: tmpRoot,
      profitCredit: "execution_risk_negative",
      generatedAt: "2026-06-20 09:32:00",
    })

    expect(dryRun).toMatchObject({
      schema: "stock-feedback-collection-task-result-v1",
      mode: "stock-feedback-collection-task",
      dryRun: true,
      collectionTask: expect.objectContaining({
        schema: "stock-feedback-collection-task-v1",
        bucket: "profit_credit",
        targetProfitCredit: "execution_risk_negative",
        validationTarget: "priced_in_risk",
        adapterCapability: "priced_in_risk_judgment",
        recommendedAction: "collect_entry_risk_loss_feedback",
      }),
      draft: expect.objectContaining({
        schema: "stock-feedback-collection-task-draft-v1",
        targetProfitCredit: "execution_risk_negative",
        validationTarget: "priced_in_risk",
        status: "open",
        requiredToolState: expect.arrayContaining([
          expect.stringContaining("late-entry"),
          expect.stringContaining("trade ledger"),
        ]),
        acceptanceCriteria: expect.arrayContaining([
          expect.stringContaining("primaryCredit=execution_risk_negative"),
          expect.stringContaining("entryTiming_or_positionSizing"),
        ]),
        humanSteps: expect.arrayContaining([
          expect.stringContaining("收益归因训练缺口"),
          expect.stringContaining("trade ledger"),
        ]),
        suggestedFilters: expect.objectContaining({
          profitCredit: "execution_risk_negative",
          profitFeedback: "risk_negative",
          validationTarget: "priced_in_risk",
        }),
        intakeTemplate: expect.objectContaining({
          evidenceRefs: [],
          rawFactBody: null,
          marketDataRows: null,
          profitFeedback: expect.objectContaining({
            realizedPnlPct: null,
            maxDrawdownPct: null,
          }),
        }),
        peftBoundary: expect.objectContaining({ storesRawFacts: false }),
      }),
      writeResult: null,
      writePolicy: expect.objectContaining({
        wroteWiki: false,
        wroteRaw: false,
        wroteBrain: false,
        wroteArtifacts: false,
      }),
    })
    expect(JSON.stringify(dryRun)).not.toContain("原始正文")

    const written = await planStockFeedbackCollectionTask({
      projectPath: tmpRoot,
      profitCredit: "execution_risk_negative",
      generatedAt: "2026-06-20 09:33:00",
      write: true,
    })
    expect(written.writeResult.draft.relativePath).toMatch(/^\.llm-wiki\/stock-feedback\/collection-tasks\//)
    const manifest = JSON.parse(await read(written.writeResult.manifest.path))
    expect(manifest).toMatchObject({
      schema: "stock-feedback-collection-task-manifest-v1",
      count: 1,
      targetProfitCredit: "execution_risk_negative",
      validationTarget: "priced_in_risk",
      sources: expect.arrayContaining(["stock-feedback-dynamic-test-set-v1"]),
      writeBoundary: expect.objectContaining({
        root: ".llm-wiki/stock-feedback",
        wroteWiki: false,
        wroteRaw: false,
        wroteBrain: false,
      }),
    })
    expect(JSON.stringify(manifest)).not.toContain("原始正文")
    await expect(read(path.join(tmpRoot, "wiki/stock-feedback-profit-credit-task.md"))).rejects.toThrow()
    await expect(read(path.join(tmpRoot, "raw/stock-feedback-profit-credit-task.json"))).rejects.toThrow()

    await write(
      path.join(tmpRoot, ".llm-wiki/stock-feedback/collection-tasks/bad-profit-credit.jsonl"),
      `${JSON.stringify({
        ...written.draft,
        id: "bad_collection_task_profit_credit",
        targetProfitCredit: "single_stock_fact_memory",
      })}\n`,
    )
    const rejected = await verifyStockFeedbackArtifacts({ projectPath: tmpRoot })
    expect(rejected.status).toBe("failed")
    expect(rejected.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: "error",
        code: "invalid_collection_task_profit_credit",
        id: "bad_collection_task_profit_credit",
        targetProfitCredit: "single_stock_fact_memory",
      }),
    ]))
  })

  it("records collection-task evidence results as append-only tool-state refs without raw fact bodies", async () => {
    const taskDraft = await planStockFeedbackCollectionTask({
      projectPath: tmpRoot,
      marketPattern: "fundamental_closure_confirmation",
      generatedAt: "2026-06-20 09:40:00",
      write: true,
    })

    await expect(recordStockFeedbackCollectionResult({
      projectPath: tmpRoot,
      draftId: taskDraft.draft.id,
      result: "confirmed",
      summary: "人工确认但缺少 evidence refs。",
    })).rejects.toThrow(/confirmed collection result requires --evidence-refs/)

    const dryRun = await recordStockFeedbackCollectionResult({
      projectPath: tmpRoot,
      draftId: taskDraft.draft.id,
      result: "confirmed",
      evidenceRefs: "retrieval:cninfo/订单公告#2026-06-20, price-sql:SZ300001:2026-06-20",
      summary: "公告/订单与价格承接已在工具态确认，采集单只保存引用。",
      reviewer: "codex-test",
      stockName: "样本科技C",
      stockCode: "SZ300777",
      hypothesis: "基本面兑现闭环补样本。",
      generatedAt: "2026-06-20 09:41:00",
    })
    expect(dryRun).toMatchObject({
      schema: "stock-feedback-collection-result-result-v1",
      mode: "stock-feedback-collection-result",
      dryRun: true,
      collectionResult: expect.objectContaining({
        schema: "stock-feedback-collection-result-v1",
        sourceDraftId: taskDraft.draft.id,
        sourceTaskId: taskDraft.draft.taskId,
        targetPatternId: "fundamental_closure_confirmation",
        validationTarget: "fundamental_closure",
        result: "confirmed",
        evidenceRefs: expect.arrayContaining([
          "retrieval:cninfo/订单公告#2026-06-20",
          "price-sql:SZ300001:2026-06-20",
        ]),
        intakeSummary: expect.stringContaining("工具态确认"),
        peftBoundary: expect.objectContaining({
          storesRawFacts: false,
          adapterStores: expect.arrayContaining(["behavior", "skill", "tool_habit", "decision_strategy"]),
        }),
      }),
      writeResult: null,
    })
    expect(JSON.stringify(dryRun)).not.toContain("公告正文")

    const written = await recordStockFeedbackCollectionResult({
      projectPath: tmpRoot,
      draftId: taskDraft.draft.id,
      result: "confirmed",
      evidenceRefs: "retrieval:cninfo/订单公告#2026-06-20,price-sql:SZ300001:2026-06-20",
      summary: "人工确认基本面兑现证据足够，后续可重建轨迹并进入 review。",
      reviewer: "codex-test",
      generatedAt: "2026-06-20 09:42:00",
      write: true,
    })
    expect(written.writeResult.collectionResult.relativePath).toMatch(/^\.llm-wiki\/stock-feedback\/collection-results\//)
    expect(written.writeResult.manifest.relativePath).toMatch(/^\.llm-wiki\/stock-feedback\/collection-results\//)
    const manifest = JSON.parse(await read(written.writeResult.manifest.path))
    expect(manifest).toMatchObject({
      schema: "stock-feedback-collection-result-manifest-v1",
      count: 1,
      result: "confirmed",
      targetPatternId: "fundamental_closure_confirmation",
      writeBoundary: expect.objectContaining({
        root: ".llm-wiki/stock-feedback",
        wroteWiki: false,
        wroteRaw: false,
        wroteBrain: false,
      }),
    })
    await expect(read(path.join(tmpRoot, "wiki/stock-feedback-collection-result.md"))).rejects.toThrow()
    await expect(read(path.join(tmpRoot, "raw/stock-feedback-collection-result.json"))).rejects.toThrow()

    const status = await getStockFeedbackStatus({ projectPath: tmpRoot })
    expect(status.counts.collectionResults).toBe(1)
    expect(status.counts.confirmedCollectionResults).toBe(1)
    expect(status.counts.collectionResultsAwaitingTrajectory).toBe(0)
    expect(status.recentCollectionResults).toEqual([
      expect.objectContaining({
        id: written.collectionResult.id,
        result: "confirmed",
        targetPatternId: "fundamental_closure_confirmation",
        validationTarget: "fundamental_closure",
        evidenceRefCount: 2,
        artifactPath: expect.stringMatching(/^\.llm-wiki\/stock-feedback\/collection-results\//),
      }),
    ])

    const verified = await verifyStockFeedbackArtifacts({ projectPath: tmpRoot })
    expect(verified.status).toBe("ok")
    expect(verified.checked.collectionResults).toBe(1)

    const rebuilt = await buildStockFeedbackTrajectories({ projectPath: tmpRoot, generatedAt: "2026-06-20 09:43:00" })
    const synthetic = rebuilt.trajectories.find((item) => item.sourceRecordId === written.collectionResult.id)
    expect(synthetic).toMatchObject({
      source: "stock-feedback-collection-result",
      validationTarget: "fundamental_closure",
      qualityGate: expect.objectContaining({
        status: "fundamental_validated",
        validationTarget: "fundamental_closure",
        highConfidenceEligible: true,
      }),
      evidenceState: expect.objectContaining({
        fundamentalEvidenceConfirmed: true,
        collectionResultId: written.collectionResult.id,
        confirmedEvidenceRefs: expect.arrayContaining([
          "retrieval:cninfo/订单公告#2026-06-20",
          "price-sql:SZ300001:2026-06-20",
        ]),
      }),
      routing: expect.objectContaining({
        eval: true,
        sft: true,
        adapterCandidate: true,
      }),
      collectionState: expect.objectContaining({
        result: "confirmed",
        targetPatternId: "fundamental_closure_confirmation",
      }),
    })
    expect(JSON.stringify(synthetic)).not.toContain("公告正文")

    const reviewQueue = await listStockFeedbackReviewQueue({ projectPath: tmpRoot, includeReviewed: false })
    const syntheticReview = reviewQueue.items.find((item) => item.sourceTrajectoryId === synthetic.id)
    expect(syntheticReview).toMatchObject({
      recommendedAction: "approve_for_adapter",
      reviewStatus: "pending",
      humanActionPlan: expect.objectContaining({
        expectedRouting: expect.objectContaining({
          adapterCandidate: true,
        }),
      }),
    })

    await write(
      path.join(tmpRoot, ".llm-wiki/stock-feedback/collection-results/bad-raw-fact.jsonl"),
      `${JSON.stringify({
        ...written.collectionResult,
        id: "bad_collection_result_raw_fact",
        rawFactBody: "公告正文不应该写进 collection result。".repeat(300),
      })}\n`,
    )
    const rejected = await verifyStockFeedbackArtifacts({ projectPath: tmpRoot })
    expect(rejected.status).toBe("failed")
    expect(rejected.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: "error",
        code: "collection_result_contains_raw_fact_body",
        id: "bad_collection_result_raw_fact",
        path: "rawFactBody",
      }),
    ]))
  })

  it("records paper-trade ledgers as simulation evidence without touching real trade state", async () => {
    const dryRun = await recordStockFeedbackPaperTrade({
      projectPath: tmpRoot,
      track: "rule_baseline",
      sourceQuestionId: "question_expectation_001",
      validationTarget: "expectation_trade",
      stockName: "样本科技P",
      stockCode: "SZ300888",
      hypothesis: "低位吸收后扩散，按规则基准小仓试错。",
      expectedMove: "预期 3-5 日内相对强度转强。",
      entryDate: "2026-06-10",
      entryPrice: "10.00",
      entryTiming: "低位吸收后第一次放量转强试错",
      exitDate: "2026-06-14",
      exitPrice: "10.81",
      exitTiming: "三日承接转弱后兑现",
      exitReason: "follow-through 走弱，按计划止盈",
      positionSizing: "probe_then_add_20pct",
      realizedPnlPct: "8.1",
      maxDrawdownPct: "3.2",
      holdingDays: "4",
      sourceRefs: "self-question:question_expectation_001,retrieval:theme-diffusion#2026-06-10",
      evidenceRefs: "price-sql:SZ300888:2026-06-10..2026-06-14,market-data:relative-strength-turnover-follow-through",
      generatedAt: "2026-06-20 11:00:00",
    })
    expect(dryRun).toMatchObject({
      schema: "stock-feedback-paper-trade-result-v1",
      mode: "stock-feedback-paper-trade-record",
      dryRun: true,
      paperTrade: expect.objectContaining({
        schema: "stock-feedback-paper-trade-v1",
        ledgerKind: "paper_trade",
        track: "rule_baseline",
        status: "closed",
        validationTarget: "expectation_trade",
        stock: {
          name: "样本科技P",
          code: "SZ300888",
        },
        profitFeedback: expect.objectContaining({
          executionMode: "paper",
          ledgerKind: "paper_trade",
          outcome: "profitable",
          realizedPnlPct: 8.1,
          maxDrawdownPct: 3.2,
          holdingDays: 4,
        }),
        peftBoundary: expect.objectContaining({
          storesRawFacts: false,
          adapterStores: expect.arrayContaining(["behavior", "skill", "tool_habit", "decision_strategy"]),
        }),
      }),
      writeResult: null,
    })

    const written = await recordStockFeedbackPaperTrade({
      projectPath: tmpRoot,
      track: "llm_discretionary",
      sourceQuestionId: "question_expectation_002",
      validationTarget: "expectation_trade",
      stockName: "样本科技Q",
      stockCode: "SZ300889",
      hypothesis: "LLM 根据当时证据决定持有到承接衰减。",
      expectedMove: "预期扩散后 5 日内有惯性。",
      entryDate: "2026-06-11",
      entryPrice: "20.00",
      exitDate: "2026-06-16",
      exitPrice: "21.20",
      exitReason: "承接衰减后退出",
      positionSizing: "single_probe_15pct",
      realizedPnlPct: "6",
      maxDrawdownPct: "2.5",
      holdingDays: "5",
      sourceRefs: "self-question:question_expectation_002",
      evidenceRefs: "price-sql:SZ300889:2026-06-11..2026-06-16,tool-state:self-question-attribution",
      generatedAt: "2026-06-20 11:05:00",
      write: true,
    })
    expect(written.writeResult.paperTrade.relativePath).toMatch(/^\.llm-wiki\/stock-feedback\/paper-trades\//)
    expect(written.writeResult.manifest.relativePath).toMatch(/^\.llm-wiki\/stock-feedback\/paper-trades\//)
    const manifest = JSON.parse(await read(written.writeResult.manifest.path))
    expect(manifest).toMatchObject({
      schema: "stock-feedback-paper-trade-manifest-v1",
      count: 1,
      ledgerKind: "paper_trade",
      track: "llm_discretionary",
      sources: expect.arrayContaining(["self-question", "price SQL", "paper trade simulator"]),
      writeBoundary: expect.objectContaining({
        root: ".llm-wiki/stock-feedback",
        family: "paper-trades",
        wroteWiki: false,
        wroteRaw: false,
        wroteBrain: false,
        wroteRealTradeLedger: false,
      }),
    })
    await expect(read(path.join(tmpRoot, "wiki/paper-trade.md"))).rejects.toThrow()
    await expect(read(path.join(tmpRoot, "raw/paper-trade.json"))).rejects.toThrow()
    await expect(read(path.join(tmpRoot, "data/brain/paper-trades.jsonl"))).rejects.toThrow()

    const paperStatus = await getStockFeedbackPaperTradeStatus({ projectPath: tmpRoot })
    expect(paperStatus).toMatchObject({
      schema: "stock-feedback-paper-trade-status-v1",
      counts: {
        total: 1,
        open: 0,
        closed: 1,
        profitable: 1,
      },
      byTrack: {
        llm_discretionary: 1,
      },
    })

    const status = await getStockFeedbackStatus({ projectPath: tmpRoot })
    expect(status.counts.paperTrades).toBe(1)
    expect(status.counts.paperTradeProfitable).toBe(1)
    expect(status.paperTradeLedger.summary.byTrack.llm_discretionary).toBe(1)

    const verified = await verifyStockFeedbackArtifacts({ projectPath: tmpRoot })
    expect(verified.status).toBe("ok")
    expect(verified.checked.paperTrades).toBe(1)
  })

  it("rejects paper-trade records that masquerade as real trade ledger", async () => {
    await expect(recordStockFeedbackPaperTrade({
      projectPath: tmpRoot,
      ledgerKind: "real_trade",
      track: "rule_baseline",
      stockCode: "SZ300890",
      entryDate: "2026-06-12",
      entryPrice: "9.00",
      generatedAt: "2026-06-20 11:10:00",
    })).rejects.toThrow(/paper_trade/)

    await write(
      path.join(tmpRoot, ".llm-wiki/stock-feedback/paper-trades/bad-ledger-kind.jsonl"),
      `${JSON.stringify({
        schema: "stock-feedback-paper-trade-v1",
        id: "bad_paper_trade_real_ledger",
        generatedAt: "2026-06-20 11:11:00",
        ledgerKind: "real_trade",
        track: "rule_baseline",
        status: "closed",
        stock: { code: "SZ300890" },
        profitFeedback: {
          executionMode: "paper",
          ledgerKind: "paper_trade",
          outcome: "profitable",
          realizedPnlPct: 3.4,
        },
        peftBoundary: {
          storesRawFacts: false,
          factsRemainIn: ["retrieval/tool state", "sourceRefs", "price SQL", "paper trade ledger"],
          adapterStores: ["behavior", "skill", "tool_habit", "decision_strategy"],
        },
      })}\n`,
    )
    const rejected = await verifyStockFeedbackArtifacts({ projectPath: tmpRoot })
    expect(rejected.status).toBe("failed")
    expect(rejected.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: "error",
        code: "paper_trade_invalid_ledger_kind",
        id: "bad_paper_trade_real_ledger",
        ledgerKind: "real_trade",
      }),
    ]))
  })

  it("turns profitable paper-trade ledgers into reviewable low-weight stock-feedback trajectories", async () => {
    const paperTrade = await recordStockFeedbackPaperTrade({
      projectPath: tmpRoot,
      track: "llm_discretionary",
      sourceQuestionId: "question_paper_trade_001",
      validationTarget: "expectation_trade",
      stockName: "样本科技R",
      stockCode: "SZ300891",
      hypothesis: "低位吸收后，LLM 判断扩散和承接足够，先试错后兑现。",
      expectedMove: "预期 5 日内相对强度继续领先。",
      entryDate: "2026-06-03",
      entryPrice: "12.00",
      entryTiming: "低位吸收后转强首日试错",
      exitDate: "2026-06-07",
      exitPrice: "13.08",
      exitTiming: "三日强承接后冲高兑现",
      exitReason: "涨幅兑现且换手放大",
      positionSizing: "probe_then_add_25pct",
      maxDrawdownPct: "2.2",
      holdingDays: "4",
      sourceRefs: "self-question:question_paper_trade_001,retrieval:sourceRefs#theme",
      evidenceRefs: "price-sql:SZ300891:2026-06-03..2026-06-07,market-data:relative-strength-turnover-follow-through",
      generatedAt: "2026-06-20 11:20:00",
      write: true,
    })

    const built = await buildStockFeedbackTrajectories({
      projectPath: tmpRoot,
      generatedAt: "2026-06-20 11:21:00",
    })
    const trajectory = built.trajectories.find((item) => item.sourceRecordId === paperTrade.paperTrade.id)
    expect(trajectory).toMatchObject({
      schema: "stock-feedback-trajectory-v1",
      source: "stock-feedback-paper-trade",
      validationTarget: "expectation_trade",
      qualityGate: expect.objectContaining({
        status: "review_required",
        validationTarget: "expectation_trade",
        highConfidenceEligible: false,
        reasons: expect.arrayContaining(["paper_trade_simulation", "track:llm_discretionary"]),
      }),
      stock: {
        name: "样本科技R",
        code: "SZ300891",
        label: "样本科技R SZ300891",
      },
      profitFeedback: expect.objectContaining({
        executionMode: "paper",
        ledgerKind: "paper_trade",
        executionEvidenceClass: "paper_pattern_execution_supported",
        outcome: "profitable",
        realizedPnlPct: 9,
        maxDrawdownPct: 2.2,
        holdingDays: 4,
        creditAssignment: expect.objectContaining({
          primaryCredit: "pattern_execution_supported",
        }),
      }),
      evidenceState: expect.objectContaining({
        paperTradeId: paperTrade.paperTrade.id,
        paperTradeTrack: "llm_discretionary",
        ledgerKind: "paper_trade",
        confirmedEvidenceRefs: expect.arrayContaining([
          "price-sql:SZ300891:2026-06-03..2026-06-07",
          "market-data:relative-strength-turnover-follow-through",
        ]),
      }),
      routing: expect.objectContaining({
        eval: true,
        sft: false,
        preference: false,
        adapterCandidate: true,
      }),
      paperTradeState: expect.objectContaining({
        ledgerKind: "paper_trade",
        track: "llm_discretionary",
        status: "closed",
      }),
    })
    expect(JSON.stringify(trajectory)).not.toContain("公告正文")

    const status = await getStockFeedbackStatus({ projectPath: tmpRoot })
    expect(status.counts.paperTrades).toBe(1)
    expect(status.summary.byProfitOutcome.profitable).toBe(1)
    expect(status.summary.byProfitCredit.pattern_execution_supported).toBe(1)
    expect(status.counts.trainable).toBe(0)
    expect(status.counts.adapterCandidates).toBe(1)

    const reviewQueue = await listStockFeedbackReviewQueue({ projectPath: tmpRoot, includeReviewed: false })
    const paperReview = reviewQueue.items.find((item) => item.sourceTrajectoryId === trajectory.id)
    expect(paperReview).toMatchObject({
      recommendedAction: "approve_paper_adapter_candidate",
      recommendedActionLabel: "人审 paper adapter 正样本",
      reviewStatus: "pending",
      humanActionPlan: expect.objectContaining({
        expectedRouting: expect.objectContaining({
          eval: true,
          adapterCandidate: true,
        }),
        actionOptions: expect.arrayContaining([
          expect.objectContaining({
            action: "approve_paper_adapter_candidate",
            enabled: true,
            preview: expect.objectContaining({
              trainingWeightDecision: expect.objectContaining({
                state: "human_approved_paper_adapter_low_weight",
                effectiveWeightMultiplier: 0.35,
              }),
            }),
          }),
        ]),
      }),
    })

    const benchmark = await buildStockFeedbackBenchmark({
      projectPath: tmpRoot,
      generatedAt: "2026-06-20 11:22:00",
    })
    expect(benchmark.count).toBeGreaterThan(0)
    expect(benchmark.cases).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceTrajectoryId: trajectory.id,
        validationTarget: "expectation_trade",
        sourceAudit: expect.objectContaining({
          sourceKind: "stock-feedback-paper-trade",
          paperTradeState: expect.objectContaining({
            ledgerKind: "paper_trade",
          }),
        }),
      }),
    ]))

    const exported = await exportStockFeedbackLoraReady({
      projectPath: tmpRoot,
      qualityGate: "all",
      generatedAt: "2026-06-20 11:23:00",
    })
    expect(exported.count).toBe(1)
    expect(exported.candidates[0]).toMatchObject({
      sourceKind: "stock-feedback-paper-trade",
      sourceTrajectoryId: trajectory.id,
      trainingWeightDecision: expect.objectContaining({
        state: "default_downweighted_pending_review",
        maxWeightMultiplierBeforeReview: 0.5,
      }),
      profitFeedback: expect.objectContaining({
        executionEvidenceClass: "paper_pattern_execution_supported",
      }),
    })
  })

  it("routes refuted and insufficient collection results without closing the original evidence gap", async () => {
    const fundamentalTask = await planStockFeedbackCollectionTask({
      projectPath: tmpRoot,
      marketPattern: "fundamental_closure_confirmation",
      generatedAt: "2026-06-20 10:00:00",
      write: true,
    })
    const refuted = await recordStockFeedbackCollectionResult({
      projectPath: tmpRoot,
      draftId: fundamentalTask.draft.id,
      result: "refuted",
      summary: "公告检索未发现订单兑现，原基本面闭环假设被人工反驳。",
      reviewer: "codex-test",
      generatedAt: "2026-06-20 10:01:00",
      write: true,
    })
    const insufficientFundamental = await recordStockFeedbackCollectionResult({
      projectPath: tmpRoot,
      draftId: fundamentalTask.draft.id,
      result: "insufficient",
      summary: "仍缺公告、订单或财报兑现证据，不能算基本面闭环覆盖。",
      reviewer: "codex-test",
      generatedAt: "2026-06-20 10:01:30",
      write: true,
    })

    const expectationTask = await planStockFeedbackCollectionTask({
      projectPath: tmpRoot,
      marketPattern: "event_expectation_front_run",
      generatedAt: "2026-06-20 10:02:00",
      write: true,
    })
    const insufficient = await recordStockFeedbackCollectionResult({
      projectPath: tmpRoot,
      draftId: expectationTask.draft.id,
      result: "insufficient",
      summary: "缺少扩散和承接引用，继续补证。",
      reviewer: "codex-test",
      generatedAt: "2026-06-20 10:03:00",
      write: true,
    })

    const rebuilt = await buildStockFeedbackTrajectories({ projectPath: tmpRoot, generatedAt: "2026-06-20 10:04:00" })
    const refutedTrajectory = rebuilt.trajectories.find((item) => item.sourceRecordId === refuted.collectionResult.id)
    expect(refutedTrajectory).toMatchObject({
      source: "stock-feedback-collection-result",
      validationTarget: "disconfirmation",
      qualityGate: expect.objectContaining({
        status: "disconfirmed_validated",
        validationTarget: "disconfirmation",
        highConfidenceEligible: true,
      }),
      routing: expect.objectContaining({
        preference: true,
        adapterCandidate: true,
      }),
      collectionState: expect.objectContaining({
        result: "refuted",
        targetPatternId: "fundamental_closure_confirmation",
        requestedValidationTarget: "fundamental_closure",
      }),
    })
    expect(refutedTrajectory.marketPatterns.map((item) => item.id)).toContain("failed_catalyst_one_day_hype")
    expect(refutedTrajectory.marketPatterns.map((item) => item.id)).not.toContain("fundamental_closure_confirmation")

    const insufficientFundamentalTrajectory = rebuilt.trajectories.find((item) => item.sourceRecordId === insufficientFundamental.collectionResult.id)
    expect(insufficientFundamentalTrajectory).toMatchObject({
      source: "stock-feedback-collection-result",
      validationTarget: "fundamental_closure",
      qualityGate: expect.objectContaining({
        status: "needs_evidence",
        validationTarget: "fundamental_closure",
        highConfidenceEligible: false,
      }),
    })
    expect(insufficientFundamentalTrajectory.marketPatterns.map((item) => item.id)).not.toContain("fundamental_closure_confirmation")

    const insufficientTrajectory = rebuilt.trajectories.find((item) => item.sourceRecordId === insufficient.collectionResult.id)
    expect(insufficientTrajectory).toMatchObject({
      source: "stock-feedback-collection-result",
      validationTarget: "expectation_trade",
      qualityGate: expect.objectContaining({
        status: "needs_evidence",
        validationTarget: "expectation_trade",
        highConfidenceEligible: false,
        requiredAction: "keep_collection_task_open",
      }),
      routing: expect.objectContaining({
        adapterCandidate: false,
      }),
      evidenceState: expect.objectContaining({
        evidenceGaps: expect.arrayContaining(["collection_result_insufficient:event_expectation_front_run"]),
      }),
    })

    const status = await getStockFeedbackStatus({ projectPath: tmpRoot })
    const fundamentalRadar = status.patternRadar.items.find((item) => item.id === "fundamental_closure_confirmation")
    expect(fundamentalRadar.counts.totalTrajectories).toBe(0)
    expect(fundamentalRadar.health.status).toBe("missing")

    const reviewQueue = await listStockFeedbackReviewQueue({ projectPath: tmpRoot, includeReviewed: false })
    const insufficientReview = reviewQueue.items.find((item) => item.sourceTrajectoryId === insufficientTrajectory.id)
    expect(insufficientReview).toMatchObject({
      recommendedAction: "needs_evidence",
      humanActionPlan: expect.objectContaining({
        expectedRouting: expect.objectContaining({
          needsEvidence: true,
        }),
      }),
    })
  })

  it("exports collection-result trajectories as LoRA-ready strategy candidates with auditable source state", async () => {
    const taskDraft = await planStockFeedbackCollectionTask({
      projectPath: tmpRoot,
      marketPattern: "fundamental_closure_confirmation",
      generatedAt: "2026-06-20 11:00:00",
      write: true,
    })
    const result = await recordStockFeedbackCollectionResult({
      projectPath: tmpRoot,
      draftId: taskDraft.draft.id,
      result: "confirmed",
      evidenceRefs: "retrieval:cninfo/订单公告#2026-06-20,price-sql:SZ300777:2026-06-20",
      summary: "工具态确认订单公告、财报兑现和后续承接，候选只保留判断路线。",
      reviewer: "codex-test",
      stockName: "样本科技D",
      stockCode: "SZ300778",
      hypothesis: "基本面兑现闭环补样本可进入 adapter 候选。",
      generatedAt: "2026-06-20 11:01:00",
      write: true,
    })
    const built = await buildStockFeedbackTrajectories({
      projectPath: tmpRoot,
      generatedAt: "2026-06-20 11:02:00",
      write: true,
    })
    const trajectory = built.trajectories.find((item) => item.sourceRecordId === result.collectionResult.id)
    expect(trajectory).toMatchObject({
      source: "stock-feedback-collection-result",
      collectionState: expect.objectContaining({
        result: "confirmed",
        targetPatternId: "fundamental_closure_confirmation",
      }),
    })

    const loraReady = await exportStockFeedbackLoraReady({
      projectPath: tmpRoot,
      generatedAt: "2026-06-20 11:03:00",
    })
    const candidate = loraReady.candidates.find((item) => item.sourceTrajectoryId === trajectory.id)
    expect(candidate).toMatchObject({
      sourceKind: "stock-feedback-collection-result",
      sourceKindLabel: "补样本回流轨迹",
      collectionState: expect.objectContaining({
        result: "confirmed",
        sourceDraftId: taskDraft.draft.id,
        targetPatternId: "fundamental_closure_confirmation",
        requestedValidationTarget: "fundamental_closure",
        reviewer: "codex-test",
      }),
      references: expect.objectContaining({
        collectionResultId: result.collectionResult.id,
        sourceRefs: expect.arrayContaining([
          "retrieval:cninfo/订单公告#2026-06-20",
          "price-sql:SZ300777:2026-06-20",
        ]),
      }),
      decisionPolicy: expect.objectContaining({
        keepFactsInRetrieval: true,
      }),
    })
    expect(candidate.references.sourceRefs.join("\n")).not.toContain("订单公告正文")
    expect(loraReady.manifest.sourceKindCounts).toMatchObject({
      "stock-feedback-collection-result": 1,
    })
    expect(loraReady.manifest.candidateRefs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: candidate.id,
        sourceKind: "stock-feedback-collection-result",
        collectionResultId: result.collectionResult.id,
        collectionResult: "confirmed",
        targetPatternId: "fundamental_closure_confirmation",
      }),
    ]))
    expect(JSON.stringify(loraReady)).not.toContain("订单公告正文")
  })

  it("builds stock-validation benchmark cases with collection-result source audit state", async () => {
    const taskDraft = await planStockFeedbackCollectionTask({
      projectPath: tmpRoot,
      marketPattern: "fundamental_closure_confirmation",
      generatedAt: "2026-06-20 11:10:00",
      write: true,
    })
    const result = await recordStockFeedbackCollectionResult({
      projectPath: tmpRoot,
      draftId: taskDraft.draft.id,
      result: "confirmed",
      evidenceRefs: "retrieval:cninfo/订单公告#2026-06-20,price-sql:SZ300779:2026-06-20",
      summary: "工具态确认基本面兑现，动态测试集只保留引用和分流答案。",
      reviewer: "codex-test",
      stockName: "样本科技E",
      stockCode: "SZ300779",
      hypothesis: "基本面兑现闭环补样本应成为 benchmark case。",
      generatedAt: "2026-06-20 11:11:00",
      write: true,
    })
    const built = await buildStockFeedbackTrajectories({
      projectPath: tmpRoot,
      generatedAt: "2026-06-20 11:12:00",
      write: true,
    })
    const trajectory = built.trajectories.find((item) => item.sourceRecordId === result.collectionResult.id)
    const benchmark = await buildStockFeedbackBenchmark({
      projectPath: tmpRoot,
      generatedAt: "2026-06-20 11:13:00",
      write: true,
    })
    const benchCase = benchmark.cases.find((item) => item.sourceTrajectoryId === trajectory.id)
    expect(benchCase).toMatchObject({
      sourceKind: "stock-feedback-collection-result",
      sourceKindLabel: "补样本回流轨迹",
      collectionState: expect.objectContaining({
        result: "confirmed",
        sourceDraftId: taskDraft.draft.id,
        targetPatternId: "fundamental_closure_confirmation",
        requestedValidationTarget: "fundamental_closure",
        reviewer: "codex-test",
      }),
      expected: expect.objectContaining({
        validationTarget: "fundamental_closure",
        qualityGateStatus: "fundamental_validated",
        sourceKind: "stock-feedback-collection-result",
        collectionResult: "confirmed",
        targetPatternId: "fundamental_closure_confirmation",
      }),
      sourceRefs: expect.arrayContaining([
        "retrieval:cninfo/订单公告#2026-06-20",
        "price-sql:SZ300779:2026-06-20",
      ]),
    })
    expect(benchCase.question).toContain("来源：补样本回流轨迹")
    expect(benchmark.manifest.sourceKindCounts).toMatchObject({
      "stock-feedback-collection-result": 1,
    })
    expect(benchmark.manifest.caseRefs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: benchCase.id,
        sourceKind: "stock-feedback-collection-result",
        collectionResultId: result.collectionResult.id,
        collectionResult: "confirmed",
        targetPatternId: "fundamental_closure_confirmation",
      }),
    ]))
    expect(benchmark.writeResult.benchmark.relativePath).toMatch(/^\.llm-wiki\/stock-feedback\/benchmark\//)
    expect(JSON.stringify(benchmark)).not.toContain("订单公告正文")
  })

  it("surfaces recent benchmark and LoRA-ready source mix in stock-feedback status", async () => {
    const taskDraft = await planStockFeedbackCollectionTask({
      projectPath: tmpRoot,
      marketPattern: "fundamental_closure_confirmation",
      generatedAt: "2026-06-20 11:20:00",
      write: true,
    })
    await recordStockFeedbackCollectionResult({
      projectPath: tmpRoot,
      draftId: taskDraft.draft.id,
      result: "confirmed",
      evidenceRefs: "retrieval:cninfo/订单公告#2026-06-20,price-sql:SZ300780:2026-06-20",
      summary: "工具态确认基本面兑现，status 只展示来源结构。",
      reviewer: "codex-test",
      stockName: "样本科技F",
      stockCode: "SZ300780",
      hypothesis: "基本面兑现闭环补样本应进入最近批次来源结构。",
      generatedAt: "2026-06-20 11:21:00",
      write: true,
    })
    await buildStockFeedbackTrajectories({
      projectPath: tmpRoot,
      generatedAt: "2026-06-20 11:22:00",
      write: true,
    })
    const benchmark = await buildStockFeedbackBenchmark({
      projectPath: tmpRoot,
      generatedAt: "2026-06-20 11:23:00",
      write: true,
    })
    const loraReady = await exportStockFeedbackLoraReady({
      projectPath: tmpRoot,
      generatedAt: "2026-06-20 11:24:00",
      write: true,
    })

    const status = await getStockFeedbackStatus({ projectPath: tmpRoot })
    expect(status.artifactSourceMix).toMatchObject({
      benchmark: expect.objectContaining({
        schema: "stock-validation-benchmark-manifest-v1",
        artifactPath: benchmark.writeResult.manifest.relativePath,
        count: benchmark.count,
        sourceKindCounts: expect.objectContaining({
          "stock-feedback-collection-result": 1,
        }),
        sourceConcentration: expect.objectContaining({
          dominantSourceKind: "stock-feedback-collection-result",
          dominantCount: 1,
          total: benchmark.count,
          dominantSharePct: 100,
          singleSourceBatch: true,
          trainingWeightSuggestion: expect.objectContaining({
            action: "human_audit_before_weight_up",
            defaultWeightMultiplier: 0.5,
            maxWeightMultiplierBeforeReview: 0.5,
          }),
        }),
      }),
      loraReady: expect.objectContaining({
        schema: "stock-feedback-lora-ready-manifest-v1",
        artifactPath: loraReady.writeResult.manifest.relativePath,
        count: loraReady.count,
        sourceKindCounts: expect.objectContaining({
          "stock-feedback-collection-result": 1,
        }),
        sourceConcentration: expect.objectContaining({
          dominantSourceKind: "stock-feedback-collection-result",
          dominantCount: 1,
          total: loraReady.count,
          dominantSharePct: 100,
          singleSourceBatch: true,
          trainingWeightSuggestion: expect.objectContaining({
            action: "human_audit_before_weight_up",
            defaultWeightMultiplier: 0.5,
            maxWeightMultiplierBeforeReview: 0.5,
          }),
        }),
        adapterBatchRecipe: expect.objectContaining({
          schema: "stock-feedback-adapter-batch-recipe-v1",
          strategy: "human_review_weighted_peft_selection_v1",
          storesRawFacts: false,
          totalCandidates: loraReady.count,
          weightedCandidateCount: loraReady.count,
          totalEffectiveWeight: 0.5,
          buckets: expect.arrayContaining([
            expect.objectContaining({
              id: "default_downweighted_pending_review",
              label: "未审默认降权",
              count: 1,
              effectiveWeightMultiplier: 0.5,
              recommendedSampling: "downsample_until_review",
              candidateRefCount: 1,
              candidateRefs: expect.arrayContaining([
                expect.objectContaining({
                  refKind: "adapter_candidate",
                  sourceKind: "stock-feedback-collection-result",
                  collectionResultId: expect.any(String),
                  trainingWeightState: "default_downweighted_pending_review",
                  effectiveWeightMultiplier: 0.5,
                }),
              ]),
            }),
          ]),
        }),
      }),
    })
    expect(status.artifactSourceMix.benchmark.refs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        refKind: "benchmark_case",
        sourceKind: "stock-feedback-collection-result",
        collectionResultId: expect.any(String),
        collectionResult: "confirmed",
        targetPatternId: "fundamental_closure_confirmation",
        dynamicBucket: expect.any(String),
      }),
    ]))
    expect(status.artifactSourceMix.loraReady.refs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        refKind: "adapter_candidate",
        sourceKind: "stock-feedback-collection-result",
        collectionResultId: expect.any(String),
        collectionResult: "confirmed",
        targetPatternId: "fundamental_closure_confirmation",
        adapterCapability: "fundamental_closure_judgment",
        curriculumBucket: expect.any(String),
      }),
    ]))
    expect(status.latest.benchmarkManifest).toBe(benchmark.writeResult.manifest.relativePath)
    expect(status.latest.loraReadyManifest).toBe(loraReady.writeResult.manifest.relativePath)
    expect(JSON.stringify(status.artifactSourceMix)).not.toContain("订单公告正文")
  })

  it("proposes policy feedback from repeated self-question attribution gaps without touching wiki/raw/brain", async () => {
    await write(path.join(tmpRoot, "wiki/股票/生益科技.md"), `${validFrontmatter("生益科技", "股票", "code: SH600183\n")}# 生益科技\n`)
    await write(path.join(tmpRoot, "raw/研报新闻/2026-06-14-PCB.md"), "PCB材料补证来源。")
    const attributions = [
      {
        schema: "self-question-attribution-v1",
        id: "selfqa-policy-1",
        type: "attribution",
        kind: "self-question-attribution",
        attributionMethod: "self_question_attribution_v1",
        question: "AI服务器 PCB材料 是订单兑现还是叙事扩散？",
        target: "PCB材料/工艺链",
        stockName: "生益科技",
        stockCode: "SH600183",
        attributionLabel: "price_only",
        evidenceGaps: ["fundamental:qcc_tender_or_order:not_checked"],
      },
      {
        schema: "self-question-attribution-v1",
        id: "selfqa-policy-2",
        type: "attribution",
        kind: "self-question-attribution",
        attributionMethod: "self_question_attribution_v1",
        question: "PCB材料订单兑现需要补哪些证据？",
        target: "PCB材料/工艺链",
        stockName: "胜宏科技",
        stockCode: "SZ300476",
        attributionLabel: "price_only",
        evidenceGaps: ["fundamental:qcc_tender_or_order:not_checked"],
      },
    ]
    await write(path.join(tmpRoot, "data/brain/attributions.jsonl"), `${attributions.map((item) => JSON.stringify(item)).join("\n")}\n`)
    const wikiBefore = await read(path.join(tmpRoot, "wiki/股票/生益科技.md"))
    const rawBefore = await read(path.join(tmpRoot, "raw/研报新闻/2026-06-14-PCB.md"))
    const brainBefore = await read(path.join(tmpRoot, "data/brain/attributions.jsonl"))

    const dryRun = await proposeSelfQuestionPolicies({ projectPath: tmpRoot, minOccurrences: 2 })
    expect(dryRun.dryRun).toBe(true)
    expect(dryRun.counts).toMatchObject({ attributions: 2, proposals: 1 })
    expect(dryRun.proposals[0]).toMatchObject({
      schema: "trading-ai-policy-proposal-v1",
      status: "proposed",
      scope: "self-question.validation_policy",
      rule: "must_run_evidence_stage_before_high_confidence",
      evidenceGap: "fundamental:qcc_tender_or_order:not_checked",
      occurrenceCount: 2,
    })
    expect(dryRun.proposals[0].sourceAttributionIds).toEqual(["selfqa-policy-1", "selfqa-policy-2"])
    await expect(fs.access(path.join(tmpRoot, ".llm-wiki/policy-proposals"))).rejects.toThrow()

    const written = await proposeSelfQuestionPolicies({ projectPath: tmpRoot, minOccurrences: 2, write: true })
    expect(written.writeResult.relativePath).toMatch(/^\.llm-wiki\/policy-proposals\/.+-policy-proposals\.json$/)
    const manifest = JSON.parse(await read(written.writeResult.filePath))
    expect(manifest.schema).toBe("trading-ai-policy-proposal-run-v1")
    expect(manifest.proposals[0].regressionQuestions).toEqual(expect.arrayContaining([
      "AI服务器 PCB材料 是订单兑现还是叙事扩散？",
      "PCB材料订单兑现需要补哪些证据？",
    ]))
    expect(await read(path.join(tmpRoot, "wiki/股票/生益科技.md"))).toBe(wikiBefore)
    expect(await read(path.join(tmpRoot, "raw/研报新闻/2026-06-14-PCB.md"))).toBe(rawBefore)
    expect(await read(path.join(tmpRoot, "data/brain/attributions.jsonl"))).toBe(brainBefore)
  })

  it("reviews policy proposals into an explicit active policy registry", async () => {
    await write(path.join(tmpRoot, "wiki/股票/生益科技.md"), `${validFrontmatter("生益科技", "股票", "code: SH600183\n")}# 生益科技\n`)
    await write(path.join(tmpRoot, "raw/研报新闻/2026-06-14-PCB.md"), "PCB材料补证来源。")
    const attributions = [
      {
        schema: "self-question-attribution-v1",
        id: "selfqa-review-1",
        type: "attribution",
        kind: "self-question-attribution",
        attributionMethod: "self_question_attribution_v1",
        question: "PCB材料订单兑现是否需要先查公告和招投标？",
        target: "PCB材料/工艺链",
        stockName: "生益科技",
        stockCode: "SH600183",
        attributionLabel: "price_only",
        evidenceGaps: ["fundamental:cninfo_announcement:not_checked", "fundamental:qcc_tender_or_order:not_checked"],
      },
      {
        schema: "self-question-attribution-v1",
        id: "selfqa-review-2",
        type: "attribution",
        kind: "self-question-attribution",
        attributionMethod: "self_question_attribution_v1",
        question: "PCB材料量价先行后基本面补证优先级是什么？",
        target: "PCB材料/工艺链",
        stockName: "胜宏科技",
        stockCode: "SZ300476",
        attributionLabel: "price_only",
        evidenceGaps: ["fundamental:cninfo_announcement:not_checked", "fundamental:qcc_tender_or_order:not_checked"],
      },
    ]
    await write(path.join(tmpRoot, "data/brain/attributions.jsonl"), `${attributions.map((item) => JSON.stringify(item)).join("\n")}\n`)

    const proposalRun = await proposeSelfQuestionPolicies({ projectPath: tmpRoot, minOccurrences: 2, write: true })
    const approveProposal = proposalRun.proposals.find((proposal) => proposal.evidenceGap === "fundamental:cninfo_announcement:not_checked")
    const rejectProposal = proposalRun.proposals.find((proposal) => proposal.evidenceGap === "fundamental:qcc_tender_or_order:not_checked")

    const dryRun = await reviewSelfQuestionPolicyProposal({
      projectPath: tmpRoot,
      proposalPath: proposalRun.writeResult.relativePath,
      policyId: approveProposal.policyId,
      action: "approve",
    })
    expect(dryRun.dryRun).toBe(true)
    expect(dryRun.activePolicy.status).toBe("active")
    await expect(fs.access(path.join(tmpRoot, "data/brain/policies.jsonl"))).rejects.toThrow()

    const approved = await reviewSelfQuestionPolicyProposal({
      projectPath: tmpRoot,
      proposalPath: proposalRun.writeResult.relativePath,
      policyId: approveProposal.policyId,
      action: "approve",
      reviewer: "codex-test",
      note: "公告补证已经成为高置信前置要求",
      write: true,
    })
    expect(approved.writeResult.policy.relativePath).toBe("data/brain/policies.jsonl")
    expect(approved.writeResult.event.relativePath).toBe("data/brain/self_training_events.jsonl")
    expect(approved.activePolicy).toMatchObject({
      schema: "trading-ai-policy-v1",
      type: "policy",
      status: "active",
      scope: "self-question.validation_policy",
      evidenceGap: "fundamental:cninfo_announcement:not_checked",
      reviewer: "codex-test",
      sourceProposalId: approveProposal.policyId,
    })

    const rejected = await reviewSelfQuestionPolicyProposal({
      projectPath: tmpRoot,
      proposalPath: proposalRun.writeResult.relativePath,
      policyId: rejectProposal.policyId,
      action: "reject",
      note: "先保持人工外部数据补证，不进入 active policy",
      write: true,
    })
    expect(rejected.activePolicy).toBe(null)
    expect(rejected.writeResult.policy).toBe(null)
    expect(rejected.writeResult.event.relativePath).toBe("data/brain/self_training_events.jsonl")

    const listed = await listActiveSelfQuestionPolicies({ projectPath: tmpRoot })
    expect(listed.counts).toMatchObject({ active: 1, reviewEvents: 2 })
    expect(listed.policies.map((policy) => policy.evidenceGap)).toEqual(["fundamental:cninfo_announcement:not_checked"])
    expect(listed.reviewEvents.map((event) => event.result)).toEqual(["approved", "rejected"])
  })

  it("exports active policy regression suites without touching wiki/raw/brain", async () => {
    await write(path.join(tmpRoot, "wiki/股票/生益科技.md"), `${validFrontmatter("生益科技", "股票", "code: SH600183\n")}# 生益科技\n`)
    await write(path.join(tmpRoot, "raw/研报新闻/2026-06-14-PCB.md"), "PCB材料补证来源。")
    const policies = [
      {
        schema: "trading-ai-policy-v1",
        id: "policy_cninfo_before_confidence",
        type: "policy",
        policyId: "policy_cninfo_before_confidence",
        status: "active",
        scope: "self-question.validation_policy",
        rule: "must_run_evidence_stage_before_high_confidence",
        evidenceGap: "fundamental:cninfo_announcement:not_checked",
        proposedPolicy: { requireEvidenceStage: true },
        regressionQuestions: [
          "AI服务器 PCB材料 是订单兑现还是叙事扩散？",
          "量价先行但公告未查时，回答是否必须降置信？",
        ],
        approvedAt: "2026-06-15 04:00:00",
      },
      {
        schema: "trading-ai-policy-v1",
        id: "policy_qcc_tender_before_confidence",
        type: "policy",
        policyId: "policy_qcc_tender_before_confidence",
        status: "active",
        scope: "daily-loop.answer_policy",
        rule: "must_disclose_order_gap_before_trading_conclusion",
        evidenceGap: "fundamental:qcc_tender_or_order:not_checked",
        approvedAt: "2026-06-15 04:10:00",
      },
    ]
    await write(path.join(tmpRoot, "data/brain/policies.jsonl"), `${policies.map((item) => JSON.stringify(item)).join("\n")}\n`)
    const wikiBefore = await read(path.join(tmpRoot, "wiki/股票/生益科技.md"))
    const rawBefore = await read(path.join(tmpRoot, "raw/研报新闻/2026-06-14-PCB.md"))
    const brainBefore = await read(path.join(tmpRoot, "data/brain/policies.jsonl"))

    const dryRun = await exportSelfQuestionPolicyRegressions({ projectPath: tmpRoot })
    expect(dryRun.dryRun).toBe(true)
    expect(dryRun.counts).toMatchObject({ activePolicies: 2, regressionQuestions: 3, cases: 9 })
    expect(dryRun.cases.map((item) => item.caseType)).toEqual(expect.arrayContaining(["ask-answer", "daily-loop-planner", "training-sample-quality"]))
    expect(dryRun.cases[0]).toMatchObject({
      policyId: "policy_cninfo_before_confidence",
      evidenceGap: "fundamental:cninfo_announcement:not_checked",
    })
    expect(dryRun.cases[0].expectedAssertions).toContain("disclose_evidence_gap")
    await expect(fs.access(path.join(tmpRoot, ".llm-wiki/policy-regressions"))).rejects.toThrow()

    const written = await exportSelfQuestionPolicyRegressions({ projectPath: tmpRoot, write: true })
    expect(written.writeResult.relativePath).toMatch(/^\.llm-wiki\/policy-regressions\/.+-policy-regressions\.json$/)
    const manifest = JSON.parse(await read(written.writeResult.filePath))
    expect(manifest.schema).toBe("trading-ai-policy-regression-run-v1")
    expect(manifest.counts.cases).toBe(9)
    expect(manifest.writePolicy).toMatchObject({
      artifacts: ".llm-wiki/policy-regressions",
      wroteWiki: false,
      wroteRaw: false,
      wroteBrain: false,
    })
    expect(await read(path.join(tmpRoot, "wiki/股票/生益科技.md"))).toBe(wikiBefore)
    expect(await read(path.join(tmpRoot, "raw/研报新闻/2026-06-14-PCB.md"))).toBe(rawBefore)
    expect(await read(path.join(tmpRoot, "data/brain/policies.jsonl"))).toBe(brainBefore)
  })

  it("evaluates active policy regression outputs into pass/fail audit results", async () => {
    await write(path.join(tmpRoot, "wiki/股票/生益科技.md"), `${validFrontmatter("生益科技", "股票", "code: SH600183\n")}# 生益科技\n`)
    await write(path.join(tmpRoot, "raw/研报新闻/2026-06-14-PCB.md"), "PCB材料补证来源。")
    await write(
      path.join(tmpRoot, "data/brain/policies.jsonl"),
      `${JSON.stringify({
        schema: "trading-ai-policy-v1",
        id: "policy_eval_cninfo_before_confidence",
        type: "policy",
        policyId: "policy_eval_cninfo_before_confidence",
        status: "active",
        scope: "self-question.validation_policy",
        rule: "must_run_evidence_stage_before_high_confidence",
        evidenceGap: "fundamental:cninfo_announcement:not_checked",
        regressionQuestions: ["量价先行但公告未查时，回答是否必须降置信？"],
        approvedAt: "2026-06-15 04:20:00",
      })}\n`,
    )
    const brainBefore = await read(path.join(tmpRoot, "data/brain/policies.jsonl"))
    const regression = await exportSelfQuestionPolicyRegressions({ projectPath: tmpRoot })
    const caseOutputs = Object.fromEntries(regression.cases.map((item) => {
      if (item.caseType === "ask-answer") {
        return [item.id, "password=secret token=tok123。结论：证据缺口 fundamental:cninfo_announcement:not_checked，需补 CNINFO 公告；降低置信度。引用来源：CNINFO待查。"]
      }
      if (item.caseType === "daily-loop-planner") {
        return [item.id, "planner_receives_active_policy policy_eval_cninfo_before_confidence\n## Active Policies\nanswer discloses policy guardrail"]
      }
      return [item.id, "qualityGate: needs_evidence；block high confidence without confirmed evidence；evidence_results confirmed required for upgrade"]
    }))

    const dryRun = await evaluateSelfQuestionPolicyRegressions({ projectPath: tmpRoot, regressionRun: regression, caseOutputs })
    expect(dryRun.dryRun).toBe(true)
    expect(dryRun.counts).toMatchObject({ cases: 3, passed: 3, failed: 0, skipped: 0 })
    expect(dryRun.results.every((item) => item.status === "passed")).toBe(true)
    expect(dryRun.results[0].assertions.map((item) => item.status)).toEqual(["passed", "passed", "passed"])
    await expect(fs.access(path.join(tmpRoot, ".llm-wiki/policy-regression-results"))).rejects.toThrow()

    const writtenRegression = await exportSelfQuestionPolicyRegressions({ projectPath: tmpRoot, write: true })
    const written = await evaluateSelfQuestionPolicyRegressions({
      projectPath: tmpRoot,
      regressionPath: writtenRegression.writeResult.relativePath,
      caseOutputs,
      write: true,
    })
    expect(written.writeResult.relativePath).toMatch(/^\.llm-wiki\/policy-regression-results\/.+-policy-regression-results\.json$/)
    const manifestText = await read(written.writeResult.filePath)
    expect(manifestText).not.toContain("password=secret")
    expect(manifestText).not.toContain("token=tok123")
    expect(manifestText).toContain("password=[redacted]")
    expect(manifestText).toContain("token=[redacted]")
    const manifest = JSON.parse(manifestText)
    expect(manifest.schema).toBe("trading-ai-policy-regression-evaluation-run-v1")
    expect(manifest.counts).toMatchObject({ passed: 3, failed: 0, skipped: 0 })
    expect(manifest.writePolicy).toMatchObject({
      artifacts: ".llm-wiki/policy-regression-results",
      wroteWiki: false,
      wroteRaw: false,
      wroteBrain: false,
    })
    expect(await read(path.join(tmpRoot, "data/brain/policies.jsonl"))).toBe(brainBefore)
  })

  it("executes active policy regression cases and evaluates command outputs", async () => {
    await write(path.join(tmpRoot, "wiki/股票/生益科技.md"), `${validFrontmatter("生益科技", "股票", "code: SH600183\n")}# 生益科技\n`)
    await write(path.join(tmpRoot, "raw/研报新闻/2026-06-14-PCB.md"), "PCB材料补证来源。")
    await write(
      path.join(tmpRoot, "data/brain/policies.jsonl"),
      `${JSON.stringify({
        schema: "trading-ai-policy-v1",
        id: "policy_exec_cninfo_before_confidence",
        type: "policy",
        policyId: "policy_exec_cninfo_before_confidence",
        status: "active",
        scope: "self-question.validation_policy",
        rule: "must_run_evidence_stage_before_high_confidence",
        evidenceGap: "fundamental:cninfo_announcement:not_checked",
        regressionQuestions: ["量价'先行但公告未查时，回答是否必须降置信？"],
        approvedAt: "2026-06-15 04:35:00",
      })}\n`,
    )
    const brainBefore = await read(path.join(tmpRoot, "data/brain/policies.jsonl"))
    const regression = await exportSelfQuestionPolicyRegressions({ projectPath: tmpRoot })
    let dryRunCalls = 0

    const dryRun = await executeSelfQuestionPolicyRegressions({
      projectPath: tmpRoot,
      regressionRun: regression,
      executor: async () => {
        dryRunCalls += 1
        return { exitCode: 0, stdout: "" }
      },
    })
    expect(dryRun.dryRun).toBe(true)
    expect(dryRun.counts).toMatchObject({ cases: 3, planned: 3, completed: 0, failed: 0 })
    expect(dryRun.evaluation).toBeNull()
    expect(dryRun.verdict).toMatchObject({
      status: "planned",
      reason: "regression execution planned; pass --execute to run cases",
      nextStages: ["policy-regression-execute"],
    })
    expect(dryRunCalls).toBe(0)

    const calls = []
    const executed = await executeSelfQuestionPolicyRegressions({
      projectPath: tmpRoot,
      regressionRun: regression,
      execute: true,
      write: true,
      executor: async ({ command, regressionCase }) => {
        calls.push({ caseId: regressionCase.id, caseType: regressionCase.caseType, command })
        if (regressionCase.caseType === "ask-answer") {
          return {
            exitCode: 0,
            stdout: "api_key=secret。结论：证据缺口 fundamental:cninfo_announcement:not_checked，需补 CNINFO 公告；降低置信度。引用来源：CNINFO待查。",
          }
        }
        if (regressionCase.caseType === "daily-loop-planner") {
          return {
            exitCode: 0,
            stdout: "planner_receives_active_policy policy_exec_cninfo_before_confidence\n## Active Policies\nanswer discloses policy guardrail",
          }
        }
        return {
          exitCode: 0,
          stdout: "qualityGate: needs_evidence；block high confidence without confirmed evidence；evidence_results confirmed required for upgrade",
        }
      },
    })

    expect(calls.map((item) => item.caseType)).toEqual(["ask-answer", "daily-loop-planner", "training-sample-quality"])
    expect(calls[0].command).toContain("--query '量价'\\''先行")
    expect(calls.every((item) => item.command.includes(`--project '${tmpRoot}'`))).toBe(true)
    expect(executed.dryRun).toBe(false)
    expect(executed.counts).toMatchObject({ cases: 3, planned: 0, completed: 3, failed: 0 })
    expect(executed.evaluation.counts).toMatchObject({ cases: 3, passed: 3, failed: 0, skipped: 0 })
    expect(executed.verdict).toMatchObject({
      status: "passed",
      reason: "regression execution completed and all evaluated assertions passed",
      nextStages: [],
    })
    expect(executed.writeResult.relativePath).toMatch(/^\.llm-wiki\/policy-regression-executions\/.+-policy-regression-execution\.json$/)
    const manifestText = await read(executed.writeResult.filePath)
    expect(manifestText).not.toContain("api_key=secret")
    expect(manifestText).toContain("api_key=[redacted]")
    const manifest = JSON.parse(manifestText)
    expect(manifest.schema).toBe("trading-ai-policy-regression-execution-run-v1")
    expect(manifest.verdict.status).toBe("passed")
    expect(manifest.writePolicy).toMatchObject({
      artifacts: ".llm-wiki/policy-regression-executions",
      wroteWiki: false,
      wroteRaw: false,
      wroteBrain: false,
    })

    const degraded = await executeSelfQuestionPolicyRegressions({
      projectPath: tmpRoot,
      regressionRun: regression,
      execute: true,
      executor: async ({ regressionCase }) => {
        if (regressionCase.caseType === "ask-answer") return { exitCode: 2, stdout: "", stderr: "provider failed" }
        if (regressionCase.caseType === "daily-loop-planner") {
          return { exitCode: 0, stdout: "planner_receives_active_policy policy_exec_cninfo_before_confidence\n## Active Policies\nanswer discloses policy guardrail" }
        }
        return { exitCode: 0, stdout: "qualityGate: needs_evidence；block high confidence without confirmed evidence；evidence_results confirmed required for upgrade" }
      },
    })
    expect(degraded.counts).toMatchObject({ cases: 3, completed: 2, failed: 1, timedOut: 0 })
    expect(degraded.evaluation.counts).toMatchObject({ cases: 3, passed: 2, failed: 0, skipped: 1 })
    expect(degraded.verdict).toMatchObject({
      status: "needs_remediation",
      reason: "regression command failures or timeouts",
      nextStages: ["policy-regression-feedback", "policy-regression-remediation"],
      commandFailures: 1,
      evaluationSkipped: 1,
    })
    expect(await read(path.join(tmpRoot, "data/brain/policies.jsonl"))).toBe(brainBefore)
  })

  it("executes policy regression cases with bounded concurrency and stable result order", async () => {
    const regressionRun = {
      schema: "trading-ai-policy-regression-run-v1",
      runId: "policy_regression_concurrency",
      cases: [
        { id: "case-a", policyId: "policy-concurrency", caseType: "ask-answer", commandTemplate: "printf a", expectedAssertions: [] },
        { id: "case-b", policyId: "policy-concurrency", caseType: "daily-loop-planner", commandTemplate: "printf b", expectedAssertions: [] },
        { id: "case-c", policyId: "policy-concurrency", caseType: "training-sample-quality", commandTemplate: "printf c", expectedAssertions: [] },
      ],
    }
    const started = []
    const finished = []
    let active = 0
    let maxActive = 0

    const result = await executeSelfQuestionPolicyRegressions({
      projectPath: tmpRoot,
      regressionRun,
      execute: true,
      concurrency: 2,
      executor: async ({ regressionCase }) => {
        started.push(regressionCase.id)
        active += 1
        maxActive = Math.max(maxActive, active)
        await sleep(50)
        active -= 1
        finished.push(regressionCase.id)
        return { exitCode: 0, stdout: `${regressionCase.id} ok` }
      },
    })

    expect(maxActive).toBe(2)
    expect(started.slice(0, 2).sort()).toEqual(["case-a", "case-b"])
    expect(finished).toHaveLength(3)
    expect(result.concurrency).toBe(2)
    expect(result.results.map((item) => item.caseId)).toEqual(["case-a", "case-b", "case-c"])
    expect(result.counts).toMatchObject({ cases: 3, planned: 0, completed: 3, failed: 0, timedOut: 0 })
  })

  it("collects policy regression execution failures as reviewable feedback without touching wiki/raw/brain", async () => {
    await write(path.join(tmpRoot, "wiki/股票/生益科技.md"), `${validFrontmatter("生益科技", "股票", "code: SH600183\n")}# 生益科技\n`)
    await write(path.join(tmpRoot, "raw/研报新闻/2026-06-14-PCB.md"), "PCB材料补证来源。")
    await write(
      path.join(tmpRoot, "data/brain/policies.jsonl"),
      `${JSON.stringify({
        schema: "trading-ai-policy-v1",
        id: "policy_feedback_cninfo_before_confidence",
        type: "policy",
        policyId: "policy_feedback_cninfo_before_confidence",
        status: "active",
        scope: "self-question.validation_policy",
        rule: "must_run_evidence_stage_before_high_confidence",
        evidenceGap: "fundamental:cninfo_announcement:not_checked",
        regressionQuestions: ["量价先行但公告未查时，回答是否必须降置信？"],
        approvedAt: "2026-06-15 04:50:00",
      })}\n`,
    )
    const wikiBefore = await read(path.join(tmpRoot, "wiki/股票/生益科技.md"))
    const rawBefore = await read(path.join(tmpRoot, "raw/研报新闻/2026-06-14-PCB.md"))
    const brainBefore = await read(path.join(tmpRoot, "data/brain/policies.jsonl"))
    const regression = await exportSelfQuestionPolicyRegressions({ projectPath: tmpRoot })
    const execution = await executeSelfQuestionPolicyRegressions({
      projectPath: tmpRoot,
      regressionRun: regression,
      execute: true,
      executor: async ({ regressionCase }) => {
        if (regressionCase.caseType === "ask-answer") return { exitCode: 2, stdout: "", stderr: "provider token=secret failed" }
        if (regressionCase.caseType === "daily-loop-planner") return { exitCode: 0, stdout: "planner_receives_active_policy policy_feedback_cninfo_before_confidence\n## Active Policies" }
        return { exitCode: 0, stdout: "qualityGate needs_evidence block high confidence evidence_results confirmed required for upgrade" }
      },
    })

    const dryRun = await collectSelfQuestionPolicyRegressionFeedback({ projectPath: tmpRoot, executionRun: execution })
    expect(dryRun.dryRun).toBe(true)
    expect(dryRun.counts).toMatchObject({ commandFailures: 1, assertionFailures: 1, skippedCases: 1, feedbackItems: 3 })
    expect(dryRun.feedbackItems.map((item) => item.feedbackType)).toEqual(["command_failed", "case_output_missing", "assertion_failed"])
    expect(dryRun.feedbackItems[0]).toMatchObject({
      schema: "trading-ai-policy-regression-feedback-v1",
      status: "proposed",
      policyId: "policy_feedback_cninfo_before_confidence",
      caseType: "ask-answer",
      severity: "blocking",
      suggestedAction: "repair_regression_command_or_provider",
    })
    expect(JSON.stringify(dryRun)).not.toContain("token=secret")
    await expect(fs.access(path.join(tmpRoot, ".llm-wiki/policy-regression-feedback"))).rejects.toThrow()

    const writtenExecution = await executeSelfQuestionPolicyRegressions({
      projectPath: tmpRoot,
      regressionRun: regression,
      execute: true,
      write: true,
      executor: async ({ regressionCase }) => {
        if (regressionCase.caseType === "ask-answer") return { exitCode: 2, stdout: "", stderr: "provider token=secret failed" }
        if (regressionCase.caseType === "daily-loop-planner") return { exitCode: 0, stdout: "planner_receives_active_policy policy_feedback_cninfo_before_confidence\n## Active Policies" }
        return { exitCode: 0, stdout: "qualityGate needs_evidence block high confidence evidence_results confirmed required for upgrade" }
      },
    })
    const written = await collectSelfQuestionPolicyRegressionFeedback({
      projectPath: tmpRoot,
      executionPath: writtenExecution.writeResult.relativePath,
      write: true,
    })
    expect(written.writeResult.relativePath).toMatch(/^\.llm-wiki\/policy-regression-feedback\/.+-policy-regression-feedback\.json$/)
    const manifestText = await read(written.writeResult.filePath)
    expect(manifestText).not.toContain("token=secret")
    expect(manifestText).toContain("token=[redacted]")
    const manifest = JSON.parse(manifestText)
    expect(manifest.schema).toBe("trading-ai-policy-regression-feedback-run-v1")
    expect(manifest.writePolicy).toMatchObject({
      artifacts: ".llm-wiki/policy-regression-feedback",
      wroteWiki: false,
      wroteRaw: false,
      wroteBrain: false,
    })
    expect(await read(path.join(tmpRoot, "wiki/股票/生益科技.md"))).toBe(wikiBefore)
    expect(await read(path.join(tmpRoot, "raw/研报新闻/2026-06-14-PCB.md"))).toBe(rawBefore)
    expect(await read(path.join(tmpRoot, "data/brain/policies.jsonl"))).toBe(brainBefore)
  })

  it("proposes reviewable remediation from policy regression feedback without touching wiki/raw/brain", async () => {
    await write(path.join(tmpRoot, "wiki/股票/生益科技.md"), `${validFrontmatter("生益科技", "股票", "code: SH600183\n")}# 生益科技\n`)
    await write(path.join(tmpRoot, "raw/研报新闻/2026-06-14-PCB.md"), "PCB材料补证来源。")
    await write(
      path.join(tmpRoot, "data/brain/policies.jsonl"),
      `${JSON.stringify({
        schema: "trading-ai-policy-v1",
        id: "policy_remediation_cninfo_before_confidence",
        type: "policy",
        policyId: "policy_remediation_cninfo_before_confidence",
        status: "active",
        scope: "self-question.validation_policy",
        rule: "must_run_evidence_stage_before_high_confidence",
        evidenceGap: "fundamental:cninfo_announcement:not_checked",
        regressionQuestions: ["量价先行但公告未查时，回答是否必须降置信？"],
        approvedAt: "2026-06-15 05:00:00",
      })}\n`,
    )
    const wikiBefore = await read(path.join(tmpRoot, "wiki/股票/生益科技.md"))
    const rawBefore = await read(path.join(tmpRoot, "raw/研报新闻/2026-06-14-PCB.md"))
    const brainBefore = await read(path.join(tmpRoot, "data/brain/policies.jsonl"))
    const regression = await exportSelfQuestionPolicyRegressions({ projectPath: tmpRoot })
    const execution = await executeSelfQuestionPolicyRegressions({
      projectPath: tmpRoot,
      regressionRun: regression,
      execute: true,
      executor: async ({ regressionCase }) => {
        if (regressionCase.caseType === "ask-answer") return { exitCode: 2, stdout: "", stderr: "provider token=secret failed" }
        if (regressionCase.caseType === "daily-loop-planner") return { exitCode: 0, stdout: "planner_receives_active_policy policy_remediation_cninfo_before_confidence\n## Active Policies" }
        return { exitCode: 0, stdout: "qualityGate needs_evidence block high confidence evidence_results confirmed required for upgrade" }
      },
    })
    const feedback = await collectSelfQuestionPolicyRegressionFeedback({ projectPath: tmpRoot, executionRun: execution })

    const dryRun = await proposeSelfQuestionPolicyRegressionRemediations({ projectPath: tmpRoot, feedbackRun: feedback })
    expect(dryRun.dryRun).toBe(true)
    expect(dryRun.counts).toMatchObject({
      feedbackItems: 3,
      remediationProposals: 3,
      byRemediationType: {
        case_output_repair: 1,
        execution_repair: 1,
        policy_or_prompt_patch: 1,
      },
    })
    expect(dryRun.proposals.map((proposal) => proposal.remediationType)).toEqual(["execution_repair", "case_output_repair", "policy_or_prompt_patch"])
    expect(dryRun.proposals[0]).toMatchObject({
      schema: "trading-ai-policy-regression-remediation-v1",
      status: "proposed",
      policyId: "policy_remediation_cninfo_before_confidence",
      caseType: "ask-answer",
      feedbackType: "command_failed",
      reviewStatus: "needs_review",
      proposedPolicyPatch: null,
    })
    expect(dryRun.proposals[2]).toMatchObject({
      remediationType: "policy_or_prompt_patch",
      proposedPolicyPatch: {
        policyId: "policy_remediation_cninfo_before_confidence",
        caseType: "daily-loop-planner",
        addRegressionAssertion: "answer_discloses_policy_guardrail",
      },
    })
    expect(dryRun.proposals[2].proposedQuestion).toContain("answer_discloses_policy_guardrail")
    expect(JSON.stringify(dryRun)).not.toContain("token=secret")
    await expect(fs.access(path.join(tmpRoot, ".llm-wiki/policy-regression-remediations"))).rejects.toThrow()

    const writtenFeedback = await collectSelfQuestionPolicyRegressionFeedback({
      projectPath: tmpRoot,
      executionRun: execution,
      write: true,
    })
    const written = await proposeSelfQuestionPolicyRegressionRemediations({
      projectPath: tmpRoot,
      feedbackPath: writtenFeedback.writeResult.relativePath,
      write: true,
    })
    expect(written.writeResult.relativePath).toMatch(/^\.llm-wiki\/policy-regression-remediations\/.+-policy-regression-remediations\.json$/)
    const manifestText = await read(written.writeResult.filePath)
    expect(manifestText).not.toContain("token=secret")
    expect(manifestText).toContain("token=[redacted]")
    const manifest = JSON.parse(manifestText)
    expect(manifest.schema).toBe("trading-ai-policy-regression-remediation-run-v1")
    expect(manifest.writePolicy).toMatchObject({
      artifacts: ".llm-wiki/policy-regression-remediations",
      wroteWiki: false,
      wroteRaw: false,
      wroteBrain: false,
    })
    expect(await read(path.join(tmpRoot, "wiki/股票/生益科技.md"))).toBe(wikiBefore)
    expect(await read(path.join(tmpRoot, "raw/研报新闻/2026-06-14-PCB.md"))).toBe(rawBefore)
    expect(await read(path.join(tmpRoot, "data/brain/policies.jsonl"))).toBe(brainBefore)
  })

  it("reviews policy regression remediation proposals without auto-applying policy patches", async () => {
    await write(path.join(tmpRoot, "wiki/股票/生益科技.md"), `${validFrontmatter("生益科技", "股票", "code: SH600183\n")}# 生益科技\n`)
    await write(path.join(tmpRoot, "raw/研报新闻/2026-06-14-PCB.md"), "PCB材料补证来源。")
    await write(
      path.join(tmpRoot, "data/brain/policies.jsonl"),
      `${JSON.stringify({
        schema: "trading-ai-policy-v1",
        id: "policy_review_remediation_cninfo",
        type: "policy",
        policyId: "policy_review_remediation_cninfo",
        status: "active",
        scope: "self-question.validation_policy",
        rule: "must_run_evidence_stage_before_high_confidence",
        evidenceGap: "fundamental:cninfo_announcement:not_checked",
        regressionQuestions: ["量价先行但公告未查时，回答是否必须降置信？"],
        approvedAt: "2026-06-15 05:10:00",
      })}\n`,
    )
    const wikiBefore = await read(path.join(tmpRoot, "wiki/股票/生益科技.md"))
    const rawBefore = await read(path.join(tmpRoot, "raw/研报新闻/2026-06-14-PCB.md"))
    const policyBefore = await read(path.join(tmpRoot, "data/brain/policies.jsonl"))
    const regression = await exportSelfQuestionPolicyRegressions({ projectPath: tmpRoot })
    const execution = await executeSelfQuestionPolicyRegressions({
      projectPath: tmpRoot,
      regressionRun: regression,
      execute: true,
      executor: async ({ regressionCase }) => {
        if (regressionCase.caseType === "ask-answer") return { exitCode: 2, stdout: "", stderr: "provider token=secret failed" }
        if (regressionCase.caseType === "daily-loop-planner") return { exitCode: 0, stdout: "planner_receives_active_policy policy_review_remediation_cninfo\n## Active Policies" }
        return { exitCode: 0, stdout: "qualityGate needs_evidence block high confidence evidence_results confirmed required for upgrade" }
      },
    })
    const feedback = await collectSelfQuestionPolicyRegressionFeedback({ projectPath: tmpRoot, executionRun: execution })
    const remediationRun = await proposeSelfQuestionPolicyRegressionRemediations({ projectPath: tmpRoot, feedbackRun: feedback, write: true })
    const patchProposal = remediationRun.proposals.find((proposal) => proposal.remediationType === "policy_or_prompt_patch")

    const dryRun = await reviewSelfQuestionPolicyRegressionRemediation({
      projectPath: tmpRoot,
      remediationPath: remediationRun.writeResult.relativePath,
      remediationId: patchProposal.id,
      action: "approve",
      reviewer: "codex-test",
      note: "批准为后续 prompt/policy patch 候选",
    })
    expect(dryRun.dryRun).toBe(true)
    expect(dryRun.reviewEvent).toMatchObject({
      eventType: "policy-regression-remediation-review",
      result: "approved",
      remediationId: patchProposal.id,
      remediationType: "policy_or_prompt_patch",
      proposedAction: "tighten_policy_prompt_or_regression_assertion",
      reviewer: "codex-test",
      note: "批准为后续 prompt/policy patch 候选",
    })
    await expect(fs.access(path.join(tmpRoot, "data/brain/self_training_events.jsonl"))).rejects.toThrow()

    const approved = await reviewSelfQuestionPolicyRegressionRemediation({
      projectPath: tmpRoot,
      remediationPath: remediationRun.writeResult.relativePath,
      remediationId: patchProposal.id,
      action: "approve",
      reviewer: "codex-test",
      note: "approved token=secret",
      write: true,
    })
    expect(approved.writeResult.event.relativePath).toBe("data/brain/self_training_events.jsonl")
    const eventsText = await read(path.join(tmpRoot, "data/brain/self_training_events.jsonl"))
    expect(eventsText).toContain("policy-regression-remediation-review")
    expect(eventsText).toContain("approved")
    expect(eventsText).toContain(patchProposal.id)
    expect(eventsText).not.toContain("token=secret")
    expect(eventsText).toContain("token=[redacted]")
    expect(await read(path.join(tmpRoot, "wiki/股票/生益科技.md"))).toBe(wikiBefore)
    expect(await read(path.join(tmpRoot, "raw/研报新闻/2026-06-14-PCB.md"))).toBe(rawBefore)
    expect(await read(path.join(tmpRoot, "data/brain/policies.jsonl"))).toBe(policyBefore)

    const rejected = await reviewSelfQuestionPolicyRegressionRemediation({
      projectPath: tmpRoot,
      remediationPath: remediationRun.writeResult.relativePath,
      remediationId: remediationRun.proposals.find((proposal) => proposal.remediationType === "execution_repair").id,
      action: "reject",
      note: "执行失败先不进入修正队列",
      write: true,
    })
    expect(rejected.writeResult.event.relativePath).toBe("data/brain/self_training_events.jsonl")
    const events = (await read(path.join(tmpRoot, "data/brain/self_training_events.jsonl"))).trim().split("\n").map((line) => JSON.parse(line))
    expect(events.map((event) => event.result)).toEqual(["approved", "rejected"])
    expect(events[0].proposedPolicyPatch).toMatchObject({ addRegressionAssertion: "answer_discloses_policy_guardrail" })
    expect(events[0].autoApplied).toBe(false)
    expect(events[1].autoApplied).toBe(false)
  })

  it("exports approved policy regression remediation patch candidates without applying changes", async () => {
    await write(path.join(tmpRoot, "wiki/股票/生益科技.md"), `${validFrontmatter("生益科技", "股票", "code: SH600183\n")}# 生益科技\n`)
    await write(path.join(tmpRoot, "raw/研报新闻/2026-06-14-PCB.md"), "PCB材料补证来源。")
    await write(
      path.join(tmpRoot, "data/brain/policies.jsonl"),
      `${JSON.stringify({
        schema: "trading-ai-policy-v1",
        id: "policy_patch_candidate_cninfo",
        type: "policy",
        policyId: "policy_patch_candidate_cninfo",
        status: "active",
        scope: "self-question.validation_policy",
        rule: "must_run_evidence_stage_before_high_confidence",
        evidenceGap: "fundamental:cninfo_announcement:not_checked",
        regressionQuestions: ["量价先行但公告未查时，回答是否必须降置信？"],
        approvedAt: "2026-06-15 05:20:00",
      })}\n`,
    )
    const wikiBefore = await read(path.join(tmpRoot, "wiki/股票/生益科技.md"))
    const rawBefore = await read(path.join(tmpRoot, "raw/研报新闻/2026-06-14-PCB.md"))
    const policyBefore = await read(path.join(tmpRoot, "data/brain/policies.jsonl"))
    const regression = await exportSelfQuestionPolicyRegressions({ projectPath: tmpRoot })
    const execution = await executeSelfQuestionPolicyRegressions({
      projectPath: tmpRoot,
      regressionRun: regression,
      execute: true,
      executor: async ({ regressionCase }) => {
        if (regressionCase.caseType === "ask-answer") return { exitCode: 0, stdout: "answer_discloses_policy_guardrail evidence-gap confidence-cut" }
        if (regressionCase.caseType === "daily-loop-planner") return { exitCode: 0, stdout: "planner_receives_active_policy policy_patch_candidate_cninfo\n## Active Policies" }
        return { exitCode: 0, stdout: "qualityGate needs_evidence but missing block high confidence evidence_results confirmed required for upgrade" }
      },
    })
    const feedback = await collectSelfQuestionPolicyRegressionFeedback({ projectPath: tmpRoot, executionRun: execution })
    const remediationRun = await proposeSelfQuestionPolicyRegressionRemediations({ projectPath: tmpRoot, feedbackRun: feedback, write: true })
    const patchProposal = remediationRun.proposals.find((proposal) => proposal.remediationType === "policy_or_prompt_patch")
    await reviewSelfQuestionPolicyRegressionRemediation({
      projectPath: tmpRoot,
      remediationPath: remediationRun.writeResult.relativePath,
      remediationId: patchProposal.id,
      action: "approve",
      reviewer: "codex-test",
      note: "approved token=secret for controlled patch candidate",
      write: true,
    })

    const dryRun = await exportSelfQuestionPolicyRegressionPatchCandidates({ projectPath: tmpRoot })
    expect(dryRun.dryRun).toBe(true)
    expect(dryRun.counts).toMatchObject({
      approvedReviewEvents: 1,
      patchCandidates: 1,
      byPatchTarget: {
        prompt_or_policy: 1,
      },
    })
    expect(dryRun.patchCandidates[0]).toMatchObject({
      schema: "trading-ai-policy-regression-patch-candidate-v1",
      type: "policy_regression_patch_candidate",
      status: "candidate",
      remediationId: patchProposal.id,
      remediationType: "policy_or_prompt_patch",
      policyId: "policy_patch_candidate_cninfo",
      patchTarget: "prompt_or_policy",
      applyMode: "manual_required",
      autoApplied: false,
      proposedPolicyPatch: {
        addRegressionAssertion: patchProposal.proposedPolicyPatch.addRegressionAssertion,
      },
    })
    expect(dryRun.patchCandidates[0].reviewRequired).toBe(true)
    expect(dryRun.patchCandidates[0].nextCommand).toContain("self-question policy regression remediation patches")
    expect(JSON.stringify(dryRun)).not.toContain("token=secret")
    await expect(fs.access(path.join(tmpRoot, ".llm-wiki/policy-regression-patches"))).rejects.toThrow()

    const written = await exportSelfQuestionPolicyRegressionPatchCandidates({
      projectPath: tmpRoot,
      remediationId: patchProposal.id,
      write: true,
    })
    expect(written.writeResult.relativePath).toMatch(/^\.llm-wiki\/policy-regression-patches\/.+-policy-regression-patches\.json$/)
    const manifestText = await read(written.writeResult.filePath)
    expect(manifestText).not.toContain("token=secret")
    expect(manifestText).toContain("token=[redacted]")
    const manifest = JSON.parse(manifestText)
    expect(manifest.schema).toBe("trading-ai-policy-regression-patch-candidate-run-v1")
    expect(manifest.writePolicy).toMatchObject({
      artifacts: ".llm-wiki/policy-regression-patches",
      wroteWiki: false,
      wroteRaw: false,
      wroteBrain: false,
      autoApplied: false,
    })
    expect(await read(path.join(tmpRoot, "wiki/股票/生益科技.md"))).toBe(wikiBefore)
    expect(await read(path.join(tmpRoot, "raw/研报新闻/2026-06-14-PCB.md"))).toBe(rawBefore)
    expect(await read(path.join(tmpRoot, "data/brain/policies.jsonl"))).toBe(policyBefore)
  })

  it("applies approved policy regression patch candidates as active policy revisions", async () => {
    await write(path.join(tmpRoot, "wiki/股票/生益科技.md"), `${validFrontmatter("生益科技", "股票", "code: SH600183\n")}# 生益科技\n`)
    await write(path.join(tmpRoot, "raw/研报新闻/2026-06-14-PCB.md"), "PCB材料补证来源。")
    await write(
      path.join(tmpRoot, "data/brain/policies.jsonl"),
      `${JSON.stringify({
        schema: "trading-ai-policy-v1",
        id: "policy_apply_patch_cninfo",
        type: "policy",
        policyId: "policy_apply_patch_cninfo",
        status: "active",
        scope: "self-question.validation_policy",
        rule: "must_run_evidence_stage_before_high_confidence",
        evidenceGap: "fundamental:cninfo_announcement:not_checked",
        regressionQuestions: ["量价先行但公告未查时，回答是否必须降置信？"],
        approvedAt: "2026-06-15 05:30:00",
        revision: 1,
      })}\n`,
    )
    const patchRun = {
      schema: "trading-ai-policy-regression-patch-candidate-run-v1",
      mode: "self-question-policy-regression-patch-candidates",
      runId: "patch_apply_test",
      patchCandidates: [
        {
          schema: "trading-ai-policy-regression-patch-candidate-v1",
          id: "policy_reg_patch_apply_test",
          type: "policy_regression_patch_candidate",
          status: "candidate",
          reviewEventId: "brain_event_patch_apply_test",
          remediationId: "policy_reg_remediation_apply_test",
          remediationType: "policy_or_prompt_patch",
          feedbackType: "assertion_failed",
          severity: "review",
          policyId: "policy_apply_patch_cninfo",
          caseId: "case_apply_test",
          caseType: "ask-answer",
          assertion: "custom_new_guardrail_assertion",
          sourceFeedbackId: "policy_reg_feedback_apply_test",
          patchTarget: "prompt_or_policy",
          proposedAction: "tighten_policy_prompt_or_regression_assertion",
          proposedQuestion: "下一轮 ask 是否必须披露 custom_new_guardrail_assertion？",
          proposedPolicyPatch: {
            policyId: "policy_apply_patch_cninfo",
            caseType: "ask-answer",
            addRegressionAssertion: "custom_new_guardrail_assertion",
            promptGuardrail: "输出必须展示 custom_new_guardrail_assertion，且 token=secret 需要脱敏。",
            sourceFeedbackId: "policy_reg_feedback_apply_test",
            reviewRequired: true,
          },
          applyMode: "manual_required",
          reviewRequired: true,
          autoApplied: false,
        },
      ],
    }
    await write(path.join(tmpRoot, ".llm-wiki/policy-regression-patches/patch-apply-test.json"), `${JSON.stringify(patchRun, null, 2)}\n`)
    const wikiBefore = await read(path.join(tmpRoot, "wiki/股票/生益科技.md"))
    const rawBefore = await read(path.join(tmpRoot, "raw/研报新闻/2026-06-14-PCB.md"))
    const policyBefore = await read(path.join(tmpRoot, "data/brain/policies.jsonl"))

    const dryRun = await applySelfQuestionPolicyRegressionPatchCandidate({
      projectPath: tmpRoot,
      patchPath: ".llm-wiki/policy-regression-patches/patch-apply-test.json",
      patchId: "policy_reg_patch_apply_test",
      reviewer: "codex-test",
      note: "apply token=secret",
    })
    expect(dryRun.dryRun).toBe(true)
    expect(dryRun.activePolicyRevision).toMatchObject({
      schema: "trading-ai-policy-v1",
      policyId: "policy_apply_patch_cninfo",
      revision: 2,
      sourcePatchCandidateId: "policy_reg_patch_apply_test",
      sourceRemediationId: "policy_reg_remediation_apply_test",
      regressionAssertions: {
        "ask-answer": ["custom_new_guardrail_assertion"],
      },
    })
    expect(dryRun.applyEvent).toMatchObject({
      eventType: "policy-regression-patch-apply",
      result: "applied",
      patchCandidateId: "policy_reg_patch_apply_test",
      autoApplied: false,
    })
    expect(JSON.stringify(dryRun)).not.toContain("token=secret")
    expect(await read(path.join(tmpRoot, "data/brain/policies.jsonl"))).toBe(policyBefore)
    await expect(fs.access(path.join(tmpRoot, "data/brain/self_training_events.jsonl"))).rejects.toThrow()

    const written = await applySelfQuestionPolicyRegressionPatchCandidate({
      projectPath: tmpRoot,
      patchPath: ".llm-wiki/policy-regression-patches/patch-apply-test.json",
      patchId: "policy_reg_patch_apply_test",
      reviewer: "codex-test",
      note: "apply token=secret",
      write: true,
    })
    expect(written.writeResult.policy.relativePath).toBe("data/brain/policies.jsonl")
    expect(written.writeResult.event.relativePath).toBe("data/brain/self_training_events.jsonl")
    const policiesText = await read(path.join(tmpRoot, "data/brain/policies.jsonl"))
    const eventsText = await read(path.join(tmpRoot, "data/brain/self_training_events.jsonl"))
    expect(policiesText).not.toContain("token=secret")
    expect(eventsText).not.toContain("token=secret")
    expect(policiesText).toContain("token=[redacted]")
    expect(eventsText).toContain("policy-regression-patch-apply")
    const policies = await readJsonl(path.join(tmpRoot, "data/brain/policies.jsonl"))
    expect(policies).toHaveLength(2)
    expect(policies[1]).toMatchObject({
      policyId: "policy_apply_patch_cninfo",
      revision: 2,
      sourcePatchCandidateId: "policy_reg_patch_apply_test",
      promptGuardrails: ["输出必须展示 custom_new_guardrail_assertion，且 token=[redacted] 需要脱敏。"],
    })
    const regression = await exportSelfQuestionPolicyRegressions({ projectPath: tmpRoot })
    const askCase = regression.cases.find((item) => item.policyId === "policy_apply_patch_cninfo" && item.caseType === "ask-answer")
    expect(askCase.expectedAssertions).toContain("custom_new_guardrail_assertion")

    const duplicate = await applySelfQuestionPolicyRegressionPatchCandidate({
      projectPath: tmpRoot,
      patchPath: ".llm-wiki/policy-regression-patches/patch-apply-test.json",
      patchId: "policy_reg_patch_apply_test",
      write: true,
    })
    expect(duplicate.alreadyApplied).toBe(true)
    expect(duplicate.writeResult.policy).toBe(null)
    expect(duplicate.writeResult.event).toBe(null)
    expect(await read(path.join(tmpRoot, "wiki/股票/生益科技.md"))).toBe(wikiBefore)
    expect(await read(path.join(tmpRoot, "raw/研报新闻/2026-06-14-PCB.md"))).toBe(rawBefore)
  })

  it("collects self-question fundamental evidence tasks without touching wiki/raw/brain", async () => {
    await write(path.join(tmpRoot, "wiki/股票/生益科技.md"), `${validFrontmatter("生益科技", "股票", "code: SH600183\n")}# 生益科技\n`)
    await write(path.join(tmpRoot, "raw/研报新闻/2026-06-14-PCB.md"), "PCB材料补证来源。")
    const attributionRecord = {
      schema: "self-question-attribution-v1",
      id: "selfqa-evidence-1",
      type: "attribution",
      kind: "self-question-attribution",
      attributionMethod: "self_question_attribution_v1",
      validationId: "selfq-val-1",
      questionRecordId: "selfq-1",
      questionId: "self_q_1",
      question: "AI服务器 PCB材料 是订单兑现还是叙事扩散？",
      target: "PCB材料/工艺链",
      stockName: "生益科技",
      stockCode: "SH600183",
      attributionLabel: "price_only",
      evidenceGaps: ["fundamental:cninfo_announcement:not_checked", "fundamental:qcc_tender_or_order:not_checked"],
    }
    await write(
      path.join(tmpRoot, "data/brain/attributions.jsonl"),
      `${JSON.stringify(attributionRecord)}\n`,
    )
    const wikiBefore = await read(path.join(tmpRoot, "wiki/股票/生益科技.md"))
    const rawBefore = await read(path.join(tmpRoot, "raw/研报新闻/2026-06-14-PCB.md"))
    const brainBefore = await read(path.join(tmpRoot, "data/brain/attributions.jsonl"))

    const dryRun = await collectSelfQuestionEvidenceTasks({ projectPath: tmpRoot })
    expect(dryRun.dryRun).toBe(true)
    expect(dryRun.counts).toMatchObject({ attributions: 1, tasks: 2 })
    expect(dryRun.tasks.map((task) => task.provider)).toEqual(["cninfo", "qichacha"])
    expect(dryRun.writeResult).toBe(null)
    await expect(fs.access(path.join(tmpRoot, ".llm-wiki/evidence-tasks"))).rejects.toThrow()

    const withInlineDuplicate = await collectSelfQuestionEvidenceTasks({ projectPath: tmpRoot, attributionRecords: [attributionRecord] })
    expect(withInlineDuplicate.counts).toMatchObject({ attributions: 1, tasks: 2 })

    const written = await collectSelfQuestionEvidenceTasks({ projectPath: tmpRoot, write: true })
    expect(written.dryRun).toBe(false)
    expect(written.writeResult.relativePath).toMatch(/^\.llm-wiki\/evidence-tasks\/.+-fundamental-evidence-tasks\.json$/)
    const manifest = JSON.parse(await read(written.writeResult.filePath))
    expect(manifest.schema).toBe("self-question-evidence-task-run-v1")
    expect(manifest.tasks[0]).toMatchObject({
      attributionId: "selfqa-evidence-1",
      stockCode: "SH600183",
      status: "pending",
    })
    expect(await read(path.join(tmpRoot, "wiki/股票/生益科技.md"))).toBe(wikiBefore)
    expect(await read(path.join(tmpRoot, "raw/研报新闻/2026-06-14-PCB.md"))).toBe(rawBefore)
    expect(await read(path.join(tmpRoot, "data/brain/attributions.jsonl"))).toBe(brainBefore)
  })

  it("records self-question evidence results without touching wiki/raw/source attribution", async () => {
    await write(path.join(tmpRoot, "wiki/股票/生益科技.md"), `${validFrontmatter("生益科技", "股票", "code: SH600183\n")}# 生益科技\n`)
    await write(path.join(tmpRoot, "raw/研报新闻/2026-06-14-PCB.md"), "PCB材料补证来源。")
    const attributionRecord = {
      schema: "self-question-attribution-v1",
      id: "selfqa-evidence-result-1",
      type: "attribution",
      kind: "self-question-attribution",
      attributionMethod: "self_question_attribution_v1",
      validationId: "selfq-val-result-1",
      questionRecordId: "selfq-result-1",
      questionId: "self_q_result_1",
      question: "PCB材料订单兑现是否已有公告或招投标证据？",
      target: "PCB材料/工艺链",
      stockName: "生益科技",
      stockCode: "SH600183",
      attributionLabel: "price_only",
      evidenceGaps: ["fundamental:cninfo_announcement:not_checked"],
    }
    await write(path.join(tmpRoot, "data/brain/attributions.jsonl"), `${JSON.stringify(attributionRecord)}\n`)
    const wikiBefore = await read(path.join(tmpRoot, "wiki/股票/生益科技.md"))
    const rawBefore = await read(path.join(tmpRoot, "raw/研报新闻/2026-06-14-PCB.md"))
    const attributionBefore = await read(path.join(tmpRoot, "data/brain/attributions.jsonl"))

    const tasks = await collectSelfQuestionEvidenceTasks({ projectPath: tmpRoot, id: attributionRecord.id })
    const task = tasks.tasks.find((item) => item.signal === "cninfo_announcement")

    const dryRun = await recordSelfQuestionEvidenceResult({
      projectPath: tmpRoot,
      task,
      result: "confirmed",
      summary: "公告披露 AI服务器 PCB 材料订单进展，基本面补证已完成。",
      sourceRefs: "cninfo:2026-06-14:公告",
    })
    expect(dryRun.dryRun).toBe(true)
    expect(dryRun.record).toMatchObject({
      schema: "self-question-evidence-result-v1",
      type: "evidence_result",
      taskId: task.id,
      attributionId: attributionRecord.id,
      evidenceGap: "fundamental:cninfo_announcement:not_checked",
      result: "confirmed",
      status: "resolved",
    })
    await expect(fs.access(path.join(tmpRoot, "data/brain/evidence_results.jsonl"))).rejects.toThrow()

    const written = await recordSelfQuestionEvidenceResult({
      projectPath: tmpRoot,
      task,
      result: "confirmed",
      summary: "公告披露 AI服务器 PCB 材料订单进展，基本面补证已完成。",
      sourceRefs: ["cninfo:2026-06-14:公告", "wiki/股票/生益科技.md"],
      write: true,
    })
    expect(written.writeResult).toMatchObject({ relativePath: "data/brain/evidence_results.jsonl", records: 1 })
    const lines = (await read(path.join(tmpRoot, "data/brain/evidence_results.jsonl"))).trim().split(/\r?\n/)
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0])).toMatchObject({ taskId: task.id, result: "confirmed" })
    expect(await read(path.join(tmpRoot, "wiki/股票/生益科技.md"))).toBe(wikiBefore)
    expect(await read(path.join(tmpRoot, "raw/研报新闻/2026-06-14-PCB.md"))).toBe(rawBefore)
    expect(await read(path.join(tmpRoot, "data/brain/attributions.jsonl"))).toBe(attributionBefore)
  })

  it("daily-loop show-context generates stock questions and does not write reports", async () => {
    await write(
      path.join(tmpRoot, "wiki/股票/利通电子.md"),
      `${validFrontmatter("利通电子", "股票", "code: SH603629\n")}
# 利通电子

AI服务器电源、PCB材料和算电协同供货商观察。
`,
    )
    await write(
      path.join(tmpRoot, "wiki/股票/风华高科.md"),
      `${validFrontmatter("风华高科", "股票", "code: SZ000636\n")}
# 风华高科

MLCC、被动元件、AI服务器价值量提升。
`,
    )
    await write(
      path.join(tmpRoot, "raw/微信聊天/2026-06-03.md"),
      "AI硬件热门：PCB材料、MLCC、电源管理、HVDC、光模块上游继续发酵。",
    )

    const result = await runDailyLoop({
      projectPath: tmpRoot,
      mode: "premarket",
      questionCount: 6,
      showContext: true,
      answer: false,
      dailyLoopQuestionPlanner: async () => ({
        questions: [
          {
            questionType: "expected_difference",
            themeId: "passive-components",
            branch: "MLCC/被动元件链",
            question: "最近一个月，AI硬件里的MLCC/被动元件链是否属于知识库反复出现但股价还没充分反映的补涨方向？请结合原始材料、图谱关系和近20日量价排序。",
            expectedMove: "bullish",
            stockCodes: ["SZ000636"],
            reason: "MLCC在近期原始材料中反复出现，且需要结合量价验证。",
          },
        ],
      }),
      stockDailyColumns: ["ticker", "date", "open", "high", "low", "close", "volume", "amount", "turnover", "pct_cng"],
      stockDailyExecutor: async ({ nativeQuery }) => ({
        rows: nativeQuery.params[0].includes("SH603629")
          ? [
              { ticker: "SH603629", date: "2026-05-27", open: 10, high: 11, low: 9, close: 10, volume: 100, amount: 1000, turnover: 2, pct_cng: 0 },
              { ticker: "SH603629", date: "2026-05-28", open: 10, high: 12, low: 10, close: 11, volume: 150, amount: 1800, turnover: 3, pct_cng: 10 },
              { ticker: "SZ000636", date: "2026-05-27", open: 20, high: 22, low: 19, close: 20, volume: 100, amount: 2000, turnover: 2, pct_cng: 0 },
              { ticker: "SZ000636", date: "2026-05-28", open: 20, high: 25, low: 20, close: 24, volume: 300, amount: 7000, turnover: 6, pct_cng: 20 },
            ]
          : [],
      }),
      externalMarketFetcher: async ({ code }) => {
        const symbol = code.startsWith("SH") ? `sh${code.slice(2)}` : `sz${code.slice(2)}`
        return {
          code: 0,
          data: {
            [symbol]: {
              qfqday:
                code === "SH603629"
                  ? [
                      ["2026-05-28", "10", "11", "12", "10", "150"],
                      ["2026-05-29", "11", "12", "13", "11", "200"],
                    ]
                  : [
                      ["2026-05-28", "20", "24", "25", "20", "300"],
                      ["2026-05-29", "24", "25", "26", "23", "320"],
                    ],
            },
          },
        }
      },
    })

    expect(result.dryRun).toBe(true)
    expect(result.counts.questions).toBeGreaterThanOrEqual(6)
    expect(result.questionPlanner.status).toBe("llm")
    expect(result.questions.every((question) => question.stocks.some((stock) => stock.code))).toBe(true)
    expect(result.questions.map((question) => question.question).join("\n")).toContain("近20日量价")
    expect(result.questions.map((question) => question.question).join("\n")).not.toContain("SH603629")
    expect(result.questions.flatMap((question) => question.stocks).map((stock) => stock.code)).toContain("SH603629")
    expect(result.marketValidation.externalStatus).toBe("ok")
    expect(result.questions.flatMap((question) => question.stocks).some((stock) => stock.metric?.marketValidation?.status === "sql_stale")).toBe(true)
    expect(result.sql.nativeQuery.summary).not.toContain("password")
    await expect(fs.access(path.join(tmpRoot, ".llm-wiki/daily-research"))).rejects.toThrow()
    await expect(fs.access(path.join(tmpRoot, "data/brain/predictions.jsonl"))).rejects.toThrow()
  })

  it("daily-loop passes active policies into question planning and answers", async () => {
    await write(
      path.join(tmpRoot, "wiki/股票/生益科技.md"),
      `${validFrontmatter("生益科技", "股票", "code: SH600183\n")}# 生益科技\n\nPCB、覆铜板、CCL、AI服务器高速板材料验证。\n`,
    )
    await write(path.join(tmpRoot, "raw/研报新闻/2026-06-14-PCB.md"), "AI服务器 PCB材料需要公告、招投标和财报补证。")
    await write(
      path.join(tmpRoot, "data/brain/policies.jsonl"),
      `${JSON.stringify({
        schema: "trading-ai-policy-v1",
        id: "policy_daily_loop_evidence_before_confidence",
        type: "policy",
        policyId: "policy_daily_loop_evidence_before_confidence",
        status: "active",
        scope: "daily-loop.answer_policy",
        rule: "must_disclose_fundamental_gap_before_trading_conclusion",
        evidenceGap: "fundamental:cninfo_announcement:not_checked",
        proposedPolicy: "盘前结论必须先披露公告补证缺口，再给置信度。",
        regressionQuestions: ["盘前问题和答案是否披露公告补证缺口？"],
        approvedAt: "2026-06-15 03:00:00",
      })}\n`,
    )

    let plannerContext = null
    let answererOptions = null
    const result = await runDailyLoop({
      projectPath: tmpRoot,
      mode: "premarket",
      questionCount: 1,
      marketValidate: "off",
      dailyLoopQuestionPlanner: async (context) => {
        plannerContext = context
        return {
          questions: [
            {
              questionType: "expected_difference",
              themeId: "ai-pcb-materials",
              branch: "PCB材料/工艺链",
              question: "AI服务器 PCB材料/工艺链今天是否已经从量价先行进入公告兑现？",
              expectedMove: "bullish",
              stockCodes: ["SH600183"],
            },
          ],
        }
      },
      dailyLoopAnswerer: async ({ options }) => {
        answererOptions = options
        return "结论：先披露公告补证缺口。\n引用来源：测试。"
      },
      stockDailyColumns: ["ticker", "date", "close", "amount", "pct_cng"],
      stockDailyExecutor: async () => ({
        rows: [{ ticker: "SH600183", date: "2026-06-11", close: 33, amount: 3600, pct_cng: 4.2 }],
      }),
    })

    expect(plannerContext.activePolicies).toHaveLength(1)
    expect(plannerContext.prompt).toContain("must_disclose_fundamental_gap_before_trading_conclusion")
    expect(answererOptions.activePolicies).toHaveLength(1)
    expect(answererOptions.activePolicies[0]).toMatchObject({
      policyId: "policy_daily_loop_evidence_before_confidence",
      rule: "must_disclose_fundamental_gap_before_trading_conclusion",
      evidenceGap: "fundamental:cninfo_announcement:not_checked",
      proposedPolicy: "盘前结论必须先披露公告补证缺口，再给置信度。",
    })
    expect(result.counts.activePolicies).toBe(1)
    expect(result.questionPlanner.activePolicyCount).toBe(1)
    expect(result.questionPlanner.activePolicies[0].policyId).toBe("policy_daily_loop_evidence_before_confidence")
    expect(result.dryRun).toBe(true)
    await expect(fs.access(path.join(tmpRoot, "data/brain/predictions.jsonl"))).rejects.toThrow()
  })

  it("daily-loop write stores predictions, reports, feedback, and pending validations only outside wiki", async () => {
    await write(
      path.join(tmpRoot, "wiki/股票/利通电子.md"),
      `${validFrontmatter("利通电子", "股票", "code: SH603629\n")}
# 利通电子

AI服务器电源、PCB材料和算电协同供货商观察。
`,
    )
    await write(
      path.join(tmpRoot, "wiki/股票/风华高科.md"),
      `${validFrontmatter("风华高科", "股票", "code: SZ000636\n")}
# 风华高科

MLCC、被动元件、AI服务器价值量提升。
`,
    )
    await write(
      path.join(tmpRoot, "raw/微信聊天/2026-06-03.md"),
      "AI硬件热门：PCB材料、MLCC、电源管理、HVDC、光模块上游继续发酵。",
    )
    await write(
      path.join(tmpRoot, "data/brain/predictions.jsonl"),
      `${JSON.stringify({
        id: "pred-old",
        type: "prediction",
        kind: "daily-discovery",
        branch: "AI服务器电源",
        question: "利通电子看多",
        expectedMove: "bullish",
        status: "pending",
        stocks: [{ name: "利通电子", code: "SH603629", branch: "AI服务器电源" }],
        validationWindows: [1],
        createdAt: "2026-05-27 08:30:00",
      })}\n`,
    )
    await write(
      path.join(tmpRoot, "data/brain/policies.jsonl"),
      `${JSON.stringify({
        schema: "trading-ai-policy-v1",
        id: "policy_report_guardrail",
        type: "policy",
        policyId: "policy_report_guardrail",
        status: "active",
        scope: "daily-loop.report",
        rule: "must_show_policy_guardrail_in_daily_report",
        evidenceGap: "fundamental:order_or_announcement:not_checked",
        proposedPolicy: "日报必须披露主动策略约束。",
        approvedAt: "2026-06-15 04:00:00",
      })}\n`,
    )

    const result = await runDailyLoop({
      projectPath: tmpRoot,
      mode: "postclose",
      questionCount: 8,
      write: true,
      useLlmQuestionPlanner: false,
      marketValidate: "off",
      stockDailyColumns: ["ticker", "date", "open", "high", "low", "close", "volume", "amount", "turnover", "pct_cng"],
      stockDailyExecutor: async () => ({
        rows: [
          { ticker: "SH603629", date: "2026-05-27", open: 10, high: 11, low: 9, close: 10, volume: 100, amount: 1000, turnover: 2, pct_cng: 0 },
          { ticker: "SH603629", date: "2026-05-28", open: 10, high: 12, low: 10, close: 11, volume: 150, amount: 1800, turnover: 3, pct_cng: 10 },
          { ticker: "SZ000636", date: "2026-05-27", open: 20, high: 22, low: 19, close: 20, volume: 100, amount: 2000, turnover: 2, pct_cng: 0 },
          { ticker: "SZ000636", date: "2026-05-28", open: 20, high: 25, low: 20, close: 24, volume: 300, amount: 7000, turnover: 6, pct_cng: 20 },
        ],
      }),
      dailyLoopAnswerer: async ({ question }) => `结论：${question.branch} 继续观察。\n引用来源：测试。`,
    })

    expect(result.dryRun).toBe(false)
    expect(result.counts.activePolicies).toBe(1)
    expect(result.reportRelativePath).toMatch(/^\.llm-wiki\/daily-research\/\d{4}-\d{2}-\d{2}-postclose\.md$/)
    expect(result.feedbackRelativePath).toMatch(/^\.llm-wiki\/wiki-feedback\/\d{4}-\d{2}-\d{2}\.md$/)
    expect(await read(path.join(tmpRoot, "data/brain/predictions.jsonl"))).toContain("daily-discovery")
    expect(await read(path.join(tmpRoot, "data/brain/validations.jsonl"))).toContain("pred-old")
    const report = await read(result.reportPath)
    expect(report).toContain("Daily Research postclose")
    expect(report).toContain("## Active Policies")
    expect(report).toContain("policy_report_guardrail")
    expect(report).toContain("must_show_policy_guardrail_in_daily_report")
    expect(await read(result.feedbackPath)).toContain("review queue only")
    await expect(fs.access(path.join(tmpRoot, "wiki/查询"))).rejects.toThrow()
  })

  it("validates pending predictions from the first trading day after the answer and tracks later-window revisions", async () => {
    await write(
      path.join(tmpRoot, "wiki/股票/利通电子.md"),
      `${validFrontmatter("利通电子", "股票", "code: SH603629\n")}
# 利通电子

AI服务器电源、PCB材料和算电协同供货商观察。
`,
    )
    await write(path.join(tmpRoot, "raw/微信聊天/2026-06-03.md"), "AI硬件热门：电源管理继续发酵。")
    await write(
      path.join(tmpRoot, "data/brain/predictions.jsonl"),
      `${JSON.stringify({
        id: "pred-after-close",
        type: "prediction",
        kind: "daily-discovery",
        branch: "AI服务器电源",
        question: "利通电子看多，应该走强",
        expectedMove: "bullish",
        status: "pending",
        stocks: [{ name: "利通电子", code: "SH603629", branch: "AI服务器电源" }],
        validationWindows: [1, 3],
        createdAt: "2026-05-27 18:30:00",
      })}\n`,
    )

    const rows = [
      { ticker: "SH603629", date: "2026-05-27", open: 10, high: 12, low: 10, close: 11, volume: 100, amount: 1100, turnover: 2, pct_cng: 10 },
      { ticker: "SH603629", date: "2026-05-28", open: 11, high: 11, low: 9, close: 9, volume: 100, amount: 900, turnover: 2, pct_cng: -18.18 },
      { ticker: "SH603629", date: "2026-05-29", open: 9, high: 12, low: 9, close: 12, volume: 160, amount: 1800, turnover: 3, pct_cng: 33.33 },
      { ticker: "SH603629", date: "2026-06-01", open: 12, high: 13, low: 12, close: 13, volume: 180, amount: 2300, turnover: 4, pct_cng: 8.33 },
    ]

    const result = await runDailyLoop({
      projectPath: tmpRoot,
      mode: "postclose",
      validatePendingOnly: true,
      showContext: true,
      answer: false,
      marketValidate: "off",
      validationWindows: "1,3",
      stockDailyColumns: ["ticker", "date", "open", "high", "low", "close", "volume", "amount", "turnover", "pct_cng"],
      stockDailyExecutor: async ({ nativeQuery }) => {
        const start = nativeQuery.params[2]
        const filtered = rows
          .filter((row) => row.ticker === "SH603629")
          .filter((row) => (nativeQuery.validationAnchorExclusive ? row.date > start : row.date >= start))
          .slice(0, nativeQuery.limit)
        return { rows: filtered }
      },
    })

    const oldValidations = result.validations.filter((item) => item.predictionId === "pred-after-close")
    expect(result.counts.questions).toBe(0)
    expect(result.counts.predictions).toBe(0)
    expect(oldValidations).toHaveLength(2)
    const oneDay = oldValidations.find((item) => item.windowDays === 1)
    const threeDay = oldValidations.find((item) => item.windowDays === 3)
    expect(oneDay.marketValidation.firstDate).toBe("2026-05-28")
    expect(oneDay.verdict).toBe("验证失败")
    expect(threeDay.marketValidation.firstDate).toBe("2026-05-28")
    expect(threeDay.marketValidation.lastDate).toBe("2026-06-01")
    expect(threeDay.verdict).toBe("验证通过")
    expect(threeDay.horizonTrackKey).toBe("pred-after-close:SH603629")
    expect(threeDay.priorWindowDays).toEqual([1])
    expect(threeDay.validationAnchor.rule).toBe("first_trading_day_after_prediction")
  })

  it("does not write longer horizon validations before enough post-prediction trading days exist", async () => {
    await write(
      path.join(tmpRoot, "data/brain/predictions.jsonl"),
      `${JSON.stringify({
        id: "pred-not-due",
        type: "prediction",
        kind: "daily-discovery",
        branch: "AI服务器电源",
        question: "利通电子看多，应该走强",
        expectedMove: "bullish",
        status: "pending",
        stocks: [{ name: "利通电子", code: "SH603629", branch: "AI服务器电源" }],
        validationWindows: [1, 3],
        createdAt: "2026-05-27 18:30:00",
      })}\n`,
    )

    const result = await runDailyLoop({
      projectPath: tmpRoot,
      mode: "postclose",
      validatePendingOnly: true,
      validationWindows: "1,3",
      stockDailyColumns: ["ticker", "date", "open", "high", "low", "close", "volume", "amount", "turnover", "pct_cng"],
      stockDailyExecutor: async ({ nativeQuery }) => ({
        rows: [{ ticker: "SH603629", date: "2026-05-28", open: 10, high: 11, low: 10, close: 11, volume: 100, amount: 1100, turnover: 2, pct_cng: 10 }].slice(0, nativeQuery.limit),
      }),
    })

    expect(result.validations.map((item) => item.windowDays)).toEqual([1])
    expect(result.validations[0].verdict).toBe("验证通过")
  })

  it("treats conflicting validation horizons as review evidence instead of independent downgrade votes", async () => {
    const validations = [
      {
        id: "v1d",
        type: "validation",
        kind: "market-validation",
        predictionId: "pred-1",
        stockCode: "SH603629",
        windowDays: 1,
        target: "AI服务器电源",
        result: "success",
        verdict: "验证通过",
        horizonTrackKey: "pred-1:SH603629",
        validationStartDate: "2026-05-28",
        validationEndDate: "2026-05-28",
        createdAt: "2026-05-28 16:00:00",
      },
      {
        id: "v3d",
        type: "validation",
        kind: "market-validation",
        predictionId: "pred-1",
        stockCode: "SH603629",
        windowDays: 3,
        target: "AI服务器电源",
        result: "failure",
        verdict: "验证失败",
        horizonTrackKey: "pred-1:SH603629",
        validationStartDate: "2026-05-28",
        validationEndDate: "2026-06-01",
        createdAt: "2026-06-01 16:00:00",
      },
    ]
    await write(path.join(tmpRoot, "data/brain/validations.jsonl"), `${validations.map((item) => JSON.stringify(item)).join("\n")}\n`)

    const result = await runSelfTraining({ projectPath: tmpRoot })
    expect(result.actions.map((action) => action.rule)).toContain("R4-cognitive-conflict")
    expect(result.actions.map((action) => action.rule)).not.toContain("R2-concept-downgrade")
    const conflict = result.actions.find((action) => action.rule === "R4-cognitive-conflict")
    expect(conflict.target).toBe("AI服务器电源")
    expect(conflict.affectedIds).toEqual(["v3d_horizon_conflict"])
  })
})

describe("hypothesis library", () => {
  it("creates hypotheses with dry-run defaults and writes only .llm-wiki/hypotheses with --write", async () => {
    await write(path.join(tmpRoot, "wiki/概念/Hypothesis边界.md"), "wiki sentinel")
    await write(path.join(tmpRoot, "raw/研报新闻/hypothesis-boundary.md"), "raw sentinel")
    const wikiBefore = await read(path.join(tmpRoot, "wiki/概念/Hypothesis边界.md"))
    const rawBefore = await read(path.join(tmpRoot, "raw/研报新闻/hypothesis-boundary.md"))

    const dryRun = await createHypothesis({
      projectPath: tmpRoot,
      title: "CPO增速放缓可能推动MPO连接器量价齐升",
      theme: "AI数据中心互联",
      segments: "MPO,CPO,高速连接器",
      keyVariables: "MPO单柜用量,ASP变化,客户订单",
      risks: "CPO渗透超预期,MPO竞争降价",
      nextValidationDate: "2026-07-15",
    })
    expect(dryRun).toMatchObject({
      schema: "trading-hypothesis-create-run-v1",
      mode: "hypothesis-create",
      dryRun: true,
      hypothesis: {
        schema: "trading-hypothesis-v1",
        id: expect.stringMatching(/^hypo_/),
        title: "CPO增速放缓可能推动MPO连接器量价齐升",
        theme: "AI数据中心互联",
        segments: ["MPO", "CPO", "高速连接器"],
        status: "watching",
        conviction: 0,
        keyVariables: ["MPO单柜用量", "ASP变化", "客户订单"],
        risks: ["CPO渗透超预期", "MPO竞争降价"],
        nextValidationDate: "2026-07-15",
        writePolicy: {
          wroteWiki: false,
          wroteRaw: false,
          wroteRealTrade: false,
        },
      },
      writeResult: null,
    })
    await expect(fs.access(path.join(tmpRoot, ".llm-wiki/hypotheses"))).rejects.toThrow()

    const written = await createHypothesis({
      projectPath: tmpRoot,
      title: "CPO增速放缓可能推动MPO连接器量价齐升",
      theme: "AI数据中心互联",
      segments: ["MPO", "CPO", "高速连接器"],
      timeHorizon: "6-18个月",
      keyVariables: ["MPO单柜用量", "ASP变化", "客户订单"],
      risks: ["CPO渗透超预期", "MPO竞争降价"],
      nextValidationDate: "2026-07-15",
      generatedAt: "2026-06-16 10:00:00",
      write: true,
    })
    expect(written.writeResult).toMatchObject({
      jsonRelativePath: `.llm-wiki/hypotheses/${written.hypothesis.id}.json`,
      markdownRelativePath: `.llm-wiki/hypotheses/${written.hypothesis.id}.md`,
      records: 1,
    })
    const json = JSON.parse(await read(written.writeResult.jsonPath))
    expect(json).toMatchObject({
      id: written.hypothesis.id,
      createdAt: "2026-06-16 10:00:00",
      updatedAt: "2026-06-16 10:00:00",
    })
    expect(await read(written.writeResult.markdownPath)).toContain("## Key Variables")
    expect(await read(path.join(tmpRoot, "wiki/概念/Hypothesis边界.md"))).toBe(wikiBefore)
    expect(await read(path.join(tmpRoot, "raw/研报新闻/hypothesis-boundary.md"))).toBe(rawBefore)
  })

  it("creates observation drafts with dry-run defaults and writes only .llm-wiki/observation-drafts", async () => {
    await write(path.join(tmpRoot, "wiki/概念/Observation边界.md"), "wiki sentinel")
    await write(path.join(tmpRoot, "raw/研报新闻/observation-boundary.md"), "raw sentinel")
    const wikiBefore = await read(path.join(tmpRoot, "wiki/概念/Observation边界.md"))
    const rawBefore = await read(path.join(tmpRoot, "raw/研报新闻/observation-boundary.md"))

    const dryRun = await createObservationDraft({
      projectPath: tmpRoot,
      title: "CPO放缓推动MPO观察",
      hypothesisId: "hypo_ai_cpo_mpo",
      stocks: "太辰光,天孚通信",
      ranking: "太辰光 > 天孚通信",
      gap: "订单和ASP未验证",
      nextAction: "观察1-5个交易日量价扩散",
      wikiFrameLabel: "AI数据中心互联",
      wikiFrameSourceRef: "wiki/概念/AI数据中心互联.md",
      wikiFrameMetaLine: "标签 CPO/MPO",
      sourceRefs: "wiki/概念/AI数据中心互联.md,.llm-wiki/agent-runs/demo/final.md",
      askQuery: "围绕 CPO 放缓验证 MPO 连接器",
    })

    expect(dryRun).toMatchObject({
      schema: "trading-observation-draft-create-run-v1",
      mode: "observation-draft-create",
      dryRun: true,
      draft: {
        schema: "trading-observation-draft-v1",
        title: "CPO放缓推动MPO观察",
        hypothesisId: "hypo_ai_cpo_mpo",
        stocks: ["太辰光", "天孚通信"],
        wikiFrame: {
          label: "AI数据中心互联",
          sourceRef: "wiki/概念/AI数据中心互联.md",
        },
      },
      writeResult: null,
      writePolicy: {
        wroteWiki: false,
        wroteRaw: false,
        wroteRealTrade: false,
      },
    })
    await expect(fs.access(path.join(tmpRoot, ".llm-wiki/observation-drafts"))).rejects.toThrow()

    const written = await createObservationDraft({
      projectPath: tmpRoot,
      title: "CPO放缓推动MPO观察",
      hypothesisId: "hypo_ai_cpo_mpo",
      stocks: ["太辰光", "天孚通信"],
      ranking: "太辰光 > 天孚通信",
      gap: "订单和ASP未验证",
      nextAction: "观察1-5个交易日量价扩散",
      wikiFrameLabel: "AI数据中心互联",
      wikiFrameSourceRef: "wiki/概念/AI数据中心互联.md",
      generatedAt: "2026-06-20 12:40:00",
      write: true,
    })

    expect(written.writeResult).toMatchObject({
      jsonRelativePath: expect.stringMatching(/^\.llm-wiki\/observation-drafts\/2026-06-20\//),
      markdownRelativePath: expect.stringMatching(/^\.llm-wiki\/observation-drafts\/2026-06-20\//),
      records: 1,
    })
    const json = JSON.parse(await read(written.writeResult.jsonPath))
    expect(json).toMatchObject({
      schema: "trading-observation-draft-v1",
      title: "CPO放缓推动MPO观察",
      wikiFrame: { sourceRef: "wiki/概念/AI数据中心互联.md" },
    })
    expect(await read(written.writeResult.markdownPath)).toContain("## Wiki Frame")
    expect(await read(path.join(tmpRoot, "wiki/概念/Observation边界.md"))).toBe(wikiBefore)
    expect(await read(path.join(tmpRoot, "raw/研报新闻/observation-boundary.md"))).toBe(rawBefore)
  })

  it("lists saved observation drafts newest first with optional date filtering", async () => {
    await createObservationDraft({
      projectPath: tmpRoot,
      title: "昨日MPO观察",
      hypothesisId: "hypo_ai_cpo_mpo",
      stocks: "太辰光",
      ranking: "太辰光",
      gap: "订单未验证",
      nextAction: "等待新信号",
      wikiFrameLabel: "AI数据中心互联",
      wikiFrameSourceRef: "wiki/概念/AI数据中心互联.md",
      generatedAt: "2026-06-19 21:00:00",
      write: true,
    })
    const latest = await createObservationDraft({
      projectPath: tmpRoot,
      title: "今日MPO观察",
      hypothesisId: "hypo_ai_cpo_mpo",
      stocks: ["太辰光", "天孚通信"],
      ranking: "太辰光 > 天孚通信",
      gap: "订单和ASP未验证",
      nextAction: "Ask深挖关联股票排序",
      wikiFrameLabel: "AI数据中心互联",
      wikiFrameSourceRef: "wiki/概念/AI数据中心互联.md",
      generatedAt: "2026-06-20 09:30:00",
      write: true,
    })

    const listed = await listObservationDrafts({ projectPath: tmpRoot, limit: 5 })
    expect(listed).toMatchObject({
      schema: "trading-observation-draft-list-run-v1",
      mode: "observation-draft-list",
      dryRun: true,
      count: 2,
      totalCount: 2,
      writePolicy: {
        readOnly: true,
        wroteWiki: false,
        wroteRaw: false,
        wroteRealTrade: false,
      },
    })
    expect(listed.drafts.map((draft) => draft.title)).toEqual(["今日MPO观察", "昨日MPO观察"])
    expect(listed.drafts[0]).toMatchObject({
      id: latest.draft.id,
      jsonRelativePath: expect.stringMatching(/^\.llm-wiki\/observation-drafts\/2026-06-20\//),
      markdownRelativePath: expect.stringMatching(/^\.llm-wiki\/observation-drafts\/2026-06-20\//),
      wikiFrame: { sourceRef: "wiki/概念/AI数据中心互联.md" },
    })

    const dated = await listObservationDrafts({ projectPath: tmpRoot, date: "2026-06-19", limit: 5 })
    expect(dated.count).toBe(1)
    expect(dated.totalCount).toBe(1)
    expect(dated.drafts[0].title).toBe("昨日MPO观察")
  })

  it("lists hypotheses with status, theme, and segment filters", async () => {
    const mpo = await createHypothesis({
      projectPath: tmpRoot,
      title: "MPO连接器量价齐升",
      theme: "AI数据中心互联",
      segments: "MPO,CPO",
      status: "watching",
      write: true,
    })
    await createHypothesis({
      projectPath: tmpRoot,
      title: "PCB材料价值量提升",
      theme: "PCB产业链",
      segments: "PCB,CCL",
      status: "seed",
      write: true,
    })

    const all = await listHypotheses({ projectPath: tmpRoot })
    expect(all.count).toBe(2)
    expect(all.writePolicy).toMatchObject({ readOnly: true, wroteWiki: false, wroteRaw: false })

    const bySegment = await listHypotheses({ projectPath: tmpRoot, segment: "MPO" })
    expect(bySegment.hypotheses.map((item) => item.id)).toEqual([mpo.hypothesis.id])

    const byTheme = await listHypotheses({ projectPath: tmpRoot, theme: "PCB产业链" })
    expect(byTheme.count).toBe(1)
    expect(byTheme.hypotheses[0].title).toBe("PCB材料价值量提升")

    const byStatus = await listHypotheses({ projectPath: tmpRoot, status: "watching" })
    expect(byStatus.count).toBe(1)
    expect(byStatus.hypotheses[0].title).toBe("MPO连接器量价齐升")
  })

  it("quality-check flags hypotheses missing falsifiable conditions without changing status", async () => {
    const weak = await createHypothesis({
      projectPath: tmpRoot,
      title: "MPO连接器订单预期扩散",
      theme: "AI数据中心互联",
      segments: "MPO,CPO",
      keyVariables: "订单扩散,相对强度",
      triggerConditions: "新增资料出现MPO订单扩散,相关标的放量扩散",
      expectedEvidencePath: "wiki框架 -> Ask深挖关联股票 -> Tushare量价验证",
      relatedWikiPages: "wiki/概念/AI数据中心互联.md",
      evidenceRefs: "wiki/概念/AI数据中心互联.md",
      marketRefs: "stock_daily_sql:MPO相对强度",
      status: "watching",
      write: true,
    })
    await createHypothesis({
      projectPath: tmpRoot,
      title: "PCB材料涨价兑现",
      theme: "PCB产业链",
      segments: "PCB,CCL",
      keyVariables: "涨价函,毛利率",
      triggerConditions: "涨价函被二次确认,相关标的放量扩散",
      invalidationSignals: "涨价无法传导,毛利率不升",
      expectedEvidencePath: "wiki框架 -> Ask深挖关联股票 -> CNINFO/Tushare复核",
      relatedWikiPages: "wiki/概念/AI数据中心互联.md",
      risks: "涨价无法传导,毛利率不升",
      evidenceRefs: "cninfo:PCB材料公告",
      marketRefs: "stock_daily_sql:PCB成交额承接",
      status: "watching",
      write: true,
    })

    const checked = await qualityCheckHypotheses({ projectPath: tmpRoot, status: "watching" })
    const weakCheck = await qualityCheckHypotheses({ projectPath: tmpRoot, id: weak.hypothesis.id })
    const listed = await listHypotheses({ projectPath: tmpRoot, status: "watching" })

    expect(checked.schema).toBe("trading-hypothesis-quality-check-v1")
    expect(checked.counts).toMatchObject({
      total: 2,
      ready: 1,
      missingTriggerConditions: 0,
      missingFalsifiableConditions: 1,
      missingExpectedEvidencePath: 0,
      missingRelatedWikiPages: 0,
    })
    expect(weakCheck.items[0]).toMatchObject({
      id: weak.hypothesis.id,
      qualityGate: "review_required",
      recommendation: "add_falsifiable_conditions",
      missing: ["falsifiableConditions"],
    })
    expect(weakCheck.items[0].checks.find((check) => check.id === "falsifiableConditions")).toMatchObject({
      passed: false,
    })
    expect(weakCheck.items[0].checks.find((check) => check.id === "triggerConditions")).toMatchObject({
      passed: true,
    })
    expect(weakCheck.items[0].checks.find((check) => check.id === "expectedEvidencePath")).toMatchObject({
      passed: true,
    })
    expect(weakCheck.items[0].checks.find((check) => check.id === "relatedWikiPages")).toMatchObject({
      passed: true,
    })
    expect(weakCheck.writePolicy).toMatchObject({
      readOnly: true,
      wroteWiki: false,
      wroteRaw: false,
      wroteHypothesisStatus: false,
    })
    const listedWeak = listed.hypotheses.find((item) => item.id === weak.hypothesis.id)
    expect(listedWeak?.status).toBe("watching")
    expect(listedWeak).toMatchObject({
      triggerConditions: expect.arrayContaining(["新增资料出现MPO订单扩散"]),
      expectedEvidencePath: expect.arrayContaining([expect.stringContaining("Ask深挖")]),
      relatedWikiPages: expect.arrayContaining([
        expect.objectContaining({ sourceRef: "wiki/概念/AI数据中心互联.md" }),
      ]),
    })
  })

  it("discovers candidate hypotheses from wiki context with concurrent AI lanes without writing by default", async () => {
    await write(
      path.join(tmpRoot, "wiki/概念/AI数据中心互联.md"),
      `${validFrontmatter("AI数据中心互联")}# AI数据中心互联\n\nCPO 节奏放缓，MPO 高速连接器、PCB、玻璃基板和 CCL 涨价函成为新催化，需要跟踪台积电供应链、健滔涨价函和量价扩散。\n`,
    )
    const requestAgentText = vi.fn(async ({ prompt }) => {
      expect(prompt).toContain("AI数据中心互联")
      return JSON.stringify({
        question: "CPO 节奏放缓后，MPO 连接器是否获得替代性需求？",
        hypotheses: [
          {
            title: "CPO节奏放缓可能推动MPO连接器新催化扩散",
            theme: "AI数据中心互联",
            segments: ["MPO", "CPO", "高速连接器"],
            timeHorizon: "未来3-6个月",
            keyVariables: ["CPO放缓", "MPO订单", "量价扩散"],
            risks: ["仅为卖方叙事"],
            sourceRefs: ["wiki/概念/AI数据中心互联.md"],
          },
        ],
      })
    })

    const discovered = await discoverHypotheses({
      projectPath: tmpRoot,
      theme: "AI数据中心互联",
      questionCount: 3,
      concurrency: 2,
      sources: "wiki",
      since: "30d",
      generatedAt: "2026-06-17 12:00:00",
      requestAgentText,
    })

    expect(requestAgentText).toHaveBeenCalledTimes(3)
    expect(discovered).toMatchObject({
      schema: "trading-hypothesis-discover-run-v1",
      dryRun: true,
      summary: {
        questionsDesigned: 3,
        candidatesReturned: 1,
        wroteWiki: false,
        wroteRaw: false,
        wroteRealTrade: false,
      },
      candidates: [
        expect.objectContaining({
          schema: "trading-hypothesis-v1",
          status: "seed",
          title: "CPO节奏放缓可能推动MPO连接器新催化扩散",
          segments: ["MPO", "CPO", "高速连接器"],
          timeHorizon: "未来3-6个月",
          triggerConditions: expect.arrayContaining([expect.stringContaining("新增资料")]),
          invalidationSignals: expect.arrayContaining([expect.stringContaining("证伪")]),
          expectedEvidencePath: expect.arrayContaining([expect.stringContaining("Ask 深挖")]),
          granularity: expect.objectContaining({ status: "trackable" }),
        }),
      ],
    })
    await expect(fs.access(path.join(tmpRoot, ".llm-wiki/hypotheses"))).rejects.toThrow()
  })

  it("filters overly broad AI-discovered hypotheses while keeping trackable mid-level hypotheses", async () => {
    await write(
      path.join(tmpRoot, "wiki/概念/AI数据中心互联.md"),
      `${validFrontmatter("AI数据中心互联")}# AI数据中心互联\n\nCPO 节奏放缓、MPO 高速连接器、CCL 涨价函和玻璃基板产业化都需要跟踪。\n`,
    )
    const requestAgentText = vi.fn(async () => JSON.stringify({
      question: "哪些细分假设值得跟踪？",
      hypotheses: [
        {
          title: "PCB有投资机会",
          theme: "AI数据中心互联",
          segments: ["PCB"],
          reason: "太宽泛，应被过滤。",
        },
        {
          title: "某微信群6月19日提到某公司涨价可能利好某股",
          theme: "AI数据中心互联",
          segments: ["MPO", "高速连接器"],
          timeHorizon: "未来1个月",
          keyVariables: ["微信群消息", "单一涨价传闻"],
          triggerConditions: ["群消息继续扩散"],
          invalidationSignals: ["消息无法复核"],
          expectedEvidencePath: ["微信消息 -> 单一股票观察"],
          sourceRefs: ["wiki/概念/AI数据中心互联.md"],
          reason: "太细碎，应作为事件路由到已有假设，而不是新假设。",
        },
        {
          title: "健滔涨价函可能推动CCL覆铜板链条进入量价重估",
          theme: "AI数据中心互联",
          segments: ["CCL", "覆铜板", "PCB材料"],
          timeHorizon: "未来1-3个月",
          keyVariables: ["涨价函", "订单反馈", "量价扩散"],
          triggerConditions: ["涨价函被二次确认", "相关标的放量扩散"],
          invalidationSignals: ["下游不接受涨价", "库存压制导致价格传导失败"],
          expectedEvidencePath: ["研报新闻 -> wiki CCL 框架 -> Ask 深挖关联股票 -> Tushare 量价验证"],
          sourceRefs: ["wiki/概念/AI数据中心互联.md"],
        },
      ],
    }))

    const discovered = await discoverHypotheses({
      projectPath: tmpRoot,
      theme: "AI数据中心互联",
      questionCount: 1,
      concurrency: 1,
      sources: "wiki",
      generatedAt: "2026-06-25 09:00:00",
      requestAgentText,
    })

    expect(discovered.candidates.map((item) => item.title)).toEqual([
      "健滔涨价函可能推动CCL覆铜板链条进入量价重估",
    ])
    expect(discovered.candidates[0]).toMatchObject({
      triggerConditions: expect.arrayContaining(["涨价函被二次确认"]),
      invalidationSignals: expect.arrayContaining(["下游不接受涨价"]),
      expectedEvidencePath: expect.arrayContaining([expect.stringContaining("Ask 深挖")]),
      granularity: expect.objectContaining({ status: "trackable", issue: null }),
    })
  })

  it("persists manual hypothesis status updates and records an audit event only after --write", async () => {
    await write(path.join(tmpRoot, "wiki/概念/status-boundary.md"), "wiki sentinel")
    await write(path.join(tmpRoot, "raw/研报新闻/status-boundary.md"), "raw sentinel")
    const wikiBefore = await read(path.join(tmpRoot, "wiki/概念/status-boundary.md"))
    const rawBefore = await read(path.join(tmpRoot, "raw/研报新闻/status-boundary.md"))
    const created = await createHypothesis({
      projectPath: tmpRoot,
      title: "玻璃基板催化可能扩散到PCB材料链",
      theme: "AI数据中心互联",
      segments: "玻璃基板,PCB,CCL",
      status: "watching",
      write: true,
      generatedAt: "2026-06-17 12:10:00",
    })

    const dryRun = await updateHypothesisStatus({
      projectPath: tmpRoot,
      id: created.hypothesis.id,
      status: "strengthening",
      reason: "微信增量出现健滔涨价函和玻璃基板催化",
      askRunRef: ".llm-wiki/agent-runs/20260617-122000-ask/manifest.json",
    })
    expect(dryRun).toMatchObject({
      schema: "trading-hypothesis-status-update-run-v1",
      dryRun: true,
      previousStatus: "watching",
      newStatus: "strengthening",
      askRunRef: ".llm-wiki/agent-runs/20260617-122000-ask/manifest.json",
      writeResult: null,
    })
    expect(JSON.parse(await read(created.writeResult.jsonPath)).status).toBe("watching")

    const written = await updateHypothesisStatus({
      projectPath: tmpRoot,
      id: created.hypothesis.id,
      status: "strengthening",
      reason: "微信增量出现健滔涨价函和玻璃基板催化",
      eventRef: ".llm-wiki/hypothesis-alerts/2026-06-17.jsonl#alert_demo",
      askRunRef: ".llm-wiki/agent-runs/20260617-122000-ask/manifest.json",
      generatedAt: "2026-06-17 12:20:00",
      write: true,
    })
    expect(written.writeResult).toMatchObject({
      jsonRelativePath: `.llm-wiki/hypotheses/${created.hypothesis.id}.json`,
      markdownRelativePath: `.llm-wiki/hypotheses/${created.hypothesis.id}.md`,
      eventRelativePath: `.llm-wiki/hypothesis-events/${created.hypothesis.id}.jsonl`,
      records: 1,
    })
    const updated = JSON.parse(await read(created.writeResult.jsonPath))
    expect(updated).toMatchObject({
      status: "strengthening",
      updatedAt: "2026-06-17 12:20:00",
    })
    const events = await readJsonl(path.join(tmpRoot, ".llm-wiki/hypothesis-events", `${created.hypothesis.id}.jsonl`))
    expect(events).toEqual([
      expect.objectContaining({
        schema: "trading-hypothesis-event-v1",
        hypothesisId: created.hypothesis.id,
        eventTime: "2026-06-17 12:20:00",
        evidenceDelta: "manual_status_update",
        signalType: "人工确认",
        signalStrength: "medium",
        statusBefore: "watching",
        suggestedStatus: "strengthening",
        reason: "微信增量出现健滔涨价函和玻璃基板催化",
        tradingImplication: expect.stringContaining("人工确认"),
        askRunRef: ".llm-wiki/agent-runs/20260617-122000-ask/manifest.json",
        previousStatus: "watching",
        newStatus: "strengthening",
        sourceRef: ".llm-wiki/hypothesis-alerts/2026-06-17.jsonl#alert_demo",
        sourceKind: "manual_review",
        sourceKindLabel: "人工确认",
      }),
    ])
    expect(await read(path.join(tmpRoot, "wiki/概念/status-boundary.md"))).toBe(wikiBefore)
    expect(await read(path.join(tmpRoot, "raw/研报新闻/status-boundary.md"))).toBe(rawBefore)
  })

  it("reports a hypothesis without touching wiki/raw and can write report artifacts", async () => {
    const created = await createHypothesis({
      projectPath: tmpRoot,
      title: "MPO连接器量价齐升",
      theme: "AI数据中心互联",
      segments: "MPO,CPO",
      risks: "卖方叙事先行但订单不足",
      write: true,
    })
    const article = path.join(tmpRoot, "raw/研报新闻/mpo-validation.md")
    await write(article, "# MPO订单公告\n\nMPO CPO 高速连接器出现客户订单、CNINFO公告、财报收入、ASP价格和成交额放量验证。")
    await updateHypothesisFromArticle({ projectPath: tmpRoot, sourcePath: article, write: true })

    const dryRun = await buildHypothesisReport({ projectPath: tmpRoot, id: created.hypothesis.id })
    expect(dryRun).toMatchObject({
      schema: "trading-hypothesis-report-run-v1",
      dryRun: true,
      report: {
        schema: "trading-hypothesis-report-v1",
        hypothesis: { id: created.hypothesis.id },
        evidenceChain: [expect.objectContaining({ schema: "trading-hypothesis-event-v1" })],
        writePolicy: {
          wroteWiki: false,
          wroteRaw: false,
          wroteRealTrade: false,
        },
      },
      writeResult: null,
    })
    expect(dryRun.markdown).toContain("## Evidence Chain")

    const written = await buildHypothesisReport({
      projectPath: tmpRoot,
      id: created.hypothesis.id,
      generatedAt: "2026-06-16 10:30:00",
      write: true,
    })
    expect(written.writeResult).toMatchObject({
      jsonRelativePath: `.llm-wiki/hypothesis-reports/20260616103000-${created.hypothesis.id}.json`,
      markdownRelativePath: `.llm-wiki/hypothesis-reports/20260616103000-${created.hypothesis.id}.md`,
      records: 1,
    })
    expect(await read(written.writeResult.markdownPath)).toContain("Hypothesis Report")
  })

  it("updates matching hypotheses from articles and emits candidates without auto-creating when unmatched", async () => {
    const created = await createHypothesis({
      projectPath: tmpRoot,
      title: "CPO增速放缓可能推动MPO连接器量价齐升",
      theme: "AI数据中心互联",
      segments: "MPO,CPO,高速连接器",
      write: true,
    })
    const source = path.join(tmpRoot, "raw/研报新闻/mpo-event.md")
    await write(source, "# AI数据中心互联\n\n卖方研究称 CPO 增速放缓，但 MPO 高速连接器客户订单、公告和交付正在验证，ASP价格可能上行。")

    const dryRun = await updateHypothesisFromArticle({ projectPath: tmpRoot, sourcePath: "raw/研报新闻/mpo-event.md" })
    expect(dryRun).toMatchObject({
      schema: "trading-hypothesis-update-from-article-run-v1",
      dryRun: true,
      source: {
        ref: "raw/研报新闻/mpo-event.md",
        hash: expect.any(String),
      },
      matchedHypotheses: [{ id: created.hypothesis.id, title: created.hypothesis.title, score: expect.any(Number) }],
      events: [
        expect.objectContaining({
          hypothesisId: created.hypothesis.id,
          sourceRef: "raw/研报新闻/mpo-event.md",
          sourceHash: expect.any(String),
          evidenceDelta: "fundamental_delivery",
          confidenceImpact: expect.objectContaining({ direction: "positive" }),
          evidenceGaps: expect.arrayContaining(["fundamental:financials:not_checked"]),
        }),
      ],
      writeResult: null,
    })
    await expect(fs.access(path.join(tmpRoot, ".llm-wiki/hypothesis-events"))).rejects.toThrow()

    const written = await updateHypothesisFromArticle({
      projectPath: tmpRoot,
      sourcePath: "raw/研报新闻/mpo-event.md",
      generatedAt: "2026-06-16 11:00:00",
      write: true,
    })
    expect(written.writeResult).toMatchObject({
      records: 1,
      relativePaths: [`.llm-wiki/hypothesis-events/${created.hypothesis.id}.jsonl`],
    })
    const events = await readJsonl(path.join(tmpRoot, ".llm-wiki/hypothesis-events", `${created.hypothesis.id}.jsonl`))
    expect(events[0]).toMatchObject({
      id: expect.stringMatching(/^hypoe_/),
      hypothesisId: created.hypothesis.id,
      sourceRef: "raw/研报新闻/mpo-event.md",
      selfTrainingHooks: {
        sampleEligible: true,
        outcomePending: true,
      },
    })

    const unrelated = path.join(tmpRoot, "raw/研报新闻/robot.md")
    await write(unrelated, "# 人形机器人执行器\n\n机器人减速器出现新线索，但和数据中心互联无关。")
    const unmatched = await updateHypothesisFromArticle({ projectPath: tmpRoot, sourcePath: unrelated, write: true })
    expect(unmatched.matchedHypotheses).toEqual([])
    expect(unmatched.events).toEqual([])
    expect(unmatched.candidateHypotheses).toHaveLength(1)
    expect(unmatched.candidateHypotheses[0]).toMatchObject({
      schema: "trading-hypothesis-v1",
      status: "seed",
      title: "人形机器人执行器",
    })
    expect(unmatched.writeResult).toBeNull()
  })

  it("validates hypotheses with fixed labels and does not confirm on price-only feedback", async () => {
    const priceOnly = await createHypothesis({
      projectPath: tmpRoot,
      title: "MPO连接器量价齐升",
      theme: "AI数据中心互联",
      segments: "MPO,CPO",
      marketRefs: "stock_daily_sql: MPO候选股近20日成交额放量上涨",
      write: true,
    })
    const priceOnlyValidation = await validateHypothesis({
      projectPath: tmpRoot,
      id: priceOnly.hypothesis.id,
      window: "20d",
      generatedAt: "2026-06-16 11:10:00",
    })
    expect(["confirmed", "divergent", "disconfirmed", "insufficient", "priced_in"]).toContain(priceOnlyValidation.result)
    expect(priceOnlyValidation.result).toBe("priced_in")
    expect(priceOnlyValidation.marketFeedback.warning).toBe("market feedback alone cannot confirm fundamental delivery")
    expect(priceOnlyValidation.guardrails).toContain("do_not_treat_short_term_price_move_as_confirmed")
    expect(priceOnlyValidation.fundamentalEvidence.status).toBe("missing")

    const source = path.join(tmpRoot, "raw/研报新闻/mpo-confirmed.md")
    await write(source, "# AI数据中心互联\n\nMPO CPO 高速连接器候选公司出现成交额放量，客户订单、中标公告、CNINFO公告、财报收入、毛利率、ASP价格和交付均有验证。")
    await updateHypothesisFromArticle({
      projectPath: tmpRoot,
      sourcePath: source,
      generatedAt: "2026-06-16 11:20:00",
      write: true,
    })
    const confirmed = await validateHypothesis({
      projectPath: tmpRoot,
      id: priceOnly.hypothesis.id,
      window: "20d",
    })
    expect(confirmed).toMatchObject({
      schema: "trading-hypothesis-validation-v1",
      mode: "hypothesis-validate",
      dryRun: true,
      result: "confirmed",
      marketFeedback: { status: "available" },
      fundamentalEvidence: { status: "available" },
      selfTrainingHooks: {
        label: "confirmed",
        sampleEligible: true,
        requiresReviewForHighConfidence: true,
      },
    })
    expect(confirmed.evidenceGaps).toEqual([])

    const closesOldGaps = await createHypothesis({
      projectPath: tmpRoot,
      title: "高速连接器ASP上行",
      theme: "AI数据中心互联",
      segments: "MPO,CPO",
      marketRefs: "stock_daily_sql: MPO候选股成交额放量",
      write: true,
    })
    await write(
      path.join(tmpRoot, "raw/研报新闻/mpo-early-gap.md"),
      "# AI数据中心互联\n\nMPO CPO 高速连接器成交额放量，ASP价格上行，但只有卖方叙事扩散。",
    )
    await updateHypothesisFromArticle({
      projectPath: tmpRoot,
      sourcePath: "raw/研报新闻/mpo-early-gap.md",
      generatedAt: "2026-06-16 11:30:00",
      write: true,
    })
    const earlyValidation = await validateHypothesis({
      projectPath: tmpRoot,
      id: closesOldGaps.hypothesis.id,
      window: "20d",
    })
    expect(earlyValidation.result).toBe("insufficient")
    expect(earlyValidation.evidenceGaps).toContain("fundamental:orders:not_checked")

    await write(
      path.join(tmpRoot, "raw/研报新闻/mpo-later-closed.md"),
      "# AI数据中心互联\n\nMPO CPO 高速连接器成交额放量，客户订单、中标公告、CNINFO公告、财报收入、毛利率、ASP价格和单柜用量均有验证。",
    )
    await updateHypothesisFromArticle({
      projectPath: tmpRoot,
      sourcePath: "raw/研报新闻/mpo-later-closed.md",
      generatedAt: "2026-06-16 11:40:00",
      write: true,
    })
    const laterValidation = await validateHypothesis({
      projectPath: tmpRoot,
      id: closesOldGaps.hypothesis.id,
      window: "20d",
    })
    expect(laterValidation.result).toBe("confirmed")
    expect(laterValidation.evidenceGaps).toEqual([])
    expect(laterValidation.historicalEvidenceGaps).toContain("fundamental:orders:not_checked")
  })

  it("watches recent sources, writes deduped events and alerts without touching wiki/raw/data facts", async () => {
    await write(path.join(tmpRoot, "wiki/概念/watchtower-boundary.md"), "wiki sentinel")
    await write(path.join(tmpRoot, "raw/研报新闻/watchtower-boundary.sentinel"), "raw sentinel")
    await write(path.join(tmpRoot, "data/facts/watchtower-boundary.jsonl"), "facts sentinel\n")
    const wikiBefore = await read(path.join(tmpRoot, "wiki/概念/watchtower-boundary.md"))
    const rawBefore = await read(path.join(tmpRoot, "raw/研报新闻/watchtower-boundary.sentinel"))
    const factsBefore = await read(path.join(tmpRoot, "data/facts/watchtower-boundary.jsonl"))

    const mpo = await createHypothesis({
      projectPath: tmpRoot,
      title: "CPO增速放缓可能推动MPO连接器量价齐升",
      theme: "AI数据中心互联",
      segments: "MPO,CPO,高速连接器",
      write: true,
    })
    const storage = await createHypothesis({
      projectPath: tmpRoot,
      title: "存储涨价可能向服务器BOM和国产存储链传导",
      theme: "AI服务器存储",
      segments: "存储,HBM,DRAM,服务器BOM",
      marketRefs: "stock_daily_sql: 存储链候选股成交额放量上涨",
      write: true,
    })

    await write(
      path.join(tmpRoot, "raw/研报新闻/mpo-order.md"),
      "# AI数据中心互联\n\nMPO CPO 高速连接器客户订单、中标公告、CNINFO公告、财报收入、ASP价格和交付验证，MPO单柜用量提升。",
    )
    await write(
      path.join(tmpRoot, "raw/微信聊天/2026-06-16.md"),
      "# 微信舆情\n\n存储 HBM DRAM 服务器BOM 成交额放量上涨，但暂时没有订单、公告和财报闭环。",
    )
    await write(
      path.join(tmpRoot, ".llm-wiki/agent-runs/20260616-ask/final.md"),
      "# Agentic Ask\n\nMPO CPO 高速连接器出现反证：客户订单延期、降价和交付不及预期，需重新检查公告。",
    )
    await write(path.join(tmpRoot, "raw/研报新闻/old-mpo.md"), "# AI数据中心互联\n\nMPO 老材料不应被 since 过滤。")
    const oldTime = new Date("2026-06-12T12:00:00")
    await fs.utimes(path.join(tmpRoot, "raw/研报新闻/old-mpo.md"), oldTime, oldTime)
    await fs.utimes(path.join(tmpRoot, "raw/研报新闻/2026-05-28-AI服务器电源.md"), oldTime, oldTime)

    const reviewAgent = vi.fn(async (input) => {
      expect(input.prompt).toContain("小批量候选")
      expect(input.prompt).toContain("llm-review-1")
      const eventId = input.prompt.match(/"itemId": "(hypoe_[^"]+)"/)?.[1]
      return JSON.stringify({
        reviews: [
          {
            itemId: eventId,
            signalType: "新催化",
            evidenceDelta: "catalyst_signal",
            suggestedStatus: "watching",
            reason: "这是 CPO 节奏放缓带来的交易催化，先跟踪量价和二次来源。",
            oneLineTradingImplication: "MPO 链先进入跟踪，不直接当成订单兑现。",
            askDeepDiveRecommended: true,
            confidence: "medium",
          },
        ],
      })
    })

    const dryRun = await runHypothesisWatch({
      projectPath: tmpRoot,
      since: "1d",
      sources: "raw,wechat,agentic",
      generatedAt: "2026-06-16 12:00:00",
      limit: 20,
    })
    expect(dryRun).toMatchObject({
      schema: "trading-hypothesis-watch-run-v1",
      dryRun: true,
      summary: {
        sourcesScanned: 3,
        eventsWritten: 0,
        alertsWritten: 0,
        wroteWiki: false,
        wroteRaw: false,
        wroteRealTrade: false,
      },
      writeResult: null,
    })
    expect(dryRun.sources.map((source) => source.sourceRef).sort()).toEqual([
      ".llm-wiki/agent-runs/20260616-ask/final.md",
      "raw/微信聊天/2026-06-16.md",
      "raw/研报新闻/mpo-order.md",
    ])
    expect(dryRun.events.map((event) => event.hypothesisId)).toContain(mpo.hypothesis.id)
    expect(dryRun.events.map((event) => event.hypothesisId)).toContain(storage.hypothesis.id)
    expect(dryRun.events.find((event) => event.evidenceDelta === "fundamental_delivery")).toMatchObject({
      statusBefore: "watching",
      suggestedStatus: "strengthening",
      suggestedStatusReason: expect.any(String),
      reason: expect.any(String),
      askRunRef: null,
    })
    expect(dryRun.alerts.find((alert) => alert.evidenceDelta === "market_feedback")).toMatchObject({
      statusBefore: "watching",
      suggestedStatus: "priced_in",
      reason: expect.any(String),
      askRunRef: null,
    })
    expect(dryRun.alerts.some((alert) => alert.alertLevel === "important" && alert.evidenceDelta === "fundamental_delivery")).toBe(true)
    expect(dryRun.alerts.some((alert) => alert.flags?.includes("priced_in_risk"))).toBe(true)
    await expect(fs.access(path.join(tmpRoot, ".llm-wiki/hypothesis-alerts"))).rejects.toThrow()

    const written = await runHypothesisWatch({
      projectPath: tmpRoot,
      since: "1d",
      sources: ["raw", "wechat", "agentic"],
      generatedAt: "2026-06-16 12:00:00",
      limit: 20,
      write: true,
    })
    expect(written.summary).toMatchObject({
      sourcesScanned: 3,
      eventsWritten: 3,
      alertsWritten: 3,
      wroteWiki: false,
      wroteRaw: false,
      wroteRealTrade: false,
    })
    expect(written.writeResult.alertsRelativePath).toBe(".llm-wiki/hypothesis-alerts/2026-06-16.jsonl")

    const deduped = await runHypothesisWatch({
      projectPath: tmpRoot,
      since: "1d",
      sources: "raw,wechat,agentic",
      generatedAt: "2026-06-16 12:05:00",
      limit: 20,
      write: true,
    })
    expect(deduped.summary.eventsWritten).toBe(0)
    expect(deduped.summary.alertsWritten).toBe(0)

    const mpoEvents = await readJsonl(path.join(tmpRoot, ".llm-wiki/hypothesis-events", `${mpo.hypothesis.id}.jsonl`))
    expect(mpoEvents).toHaveLength(2)
    expect(mpoEvents.map((event) => event.evidenceDelta)).toEqual(expect.arrayContaining(["fundamental_delivery", "counter_signal"]))
    expect(new Set(mpoEvents.map((event) => `${event.hypothesisId}:${event.sourceHash}`)).size).toBe(mpoEvents.length)

    const alerts = await readJsonl(path.join(tmpRoot, ".llm-wiki/hypothesis-alerts/2026-06-16.jsonl"))
    expect(alerts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        hypothesisId: mpo.hypothesis.id,
        alertLevel: "important",
        status: "open",
        evidenceDelta: "fundamental_delivery",
      }),
      expect.objectContaining({
        hypothesisId: storage.hypothesis.id,
        alertLevel: "watch",
        flags: ["priced_in_risk"],
      }),
    ]))
    expect(await read(path.join(tmpRoot, "wiki/概念/watchtower-boundary.md"))).toBe(wikiBefore)
    expect(await read(path.join(tmpRoot, "raw/研报新闻/watchtower-boundary.sentinel"))).toBe(rawBefore)
    expect(await read(path.join(tmpRoot, "data/facts/watchtower-boundary.jsonl"))).toBe(factsBefore)
  })

  it("dedupes same-source watch events within a single scan", async () => {
    const created = await createHypothesis({
      projectPath: tmpRoot,
      title: "CPO增速放缓可能推动MPO连接器量价齐升",
      theme: "AI数据中心互联",
      segments: "MPO,CPO,高速连接器",
      write: true,
    })
    const duplicateText = "AI数据中心互联里 CPO 增速放缓，MPO 高速连接器出现客户订单、中标公告和收入确认线索。"
    await write(path.join(tmpRoot, "raw/研报新闻/duplicate-mpo-a.md"), duplicateText)
    await write(path.join(tmpRoot, "raw/研报新闻/duplicate-mpo-b.md"), duplicateText)

    const dryRun = await runHypothesisWatch({
      projectPath: tmpRoot,
      since: "1d",
      sources: "raw",
      generatedAt: "2026-06-16 13:00:00",
      limit: 20,
      llmReview: "off",
    })

    const duplicateSources = dryRun.sources.filter((source) => source.sourceRef.includes("duplicate-mpo-"))
    expect(duplicateSources).toHaveLength(2)
    expect(new Set(duplicateSources.map((source) => source.sourceHash)).size).toBe(1)
    expect(dryRun.events).toHaveLength(1)
    expect(dryRun.alerts).toHaveLength(1)
    expect(dryRun.events[0]).toMatchObject({
      hypothesisId: created.hypothesis.id,
      sourceKind: "research_news",
      evidenceDelta: "fundamental_delivery",
      statusBefore: "watching",
      suggestedStatus: "strengthening",
      reason: expect.any(String),
      askRunRef: null,
      mergedSourceRefs: expect.arrayContaining([
        "raw/研报新闻/duplicate-mpo-a.md",
        "raw/研报新闻/duplicate-mpo-b.md",
      ]),
      duplicateSourceCount: 2,
    })

    const written = await runHypothesisWatch({
      projectPath: tmpRoot,
      since: "1d",
      sources: "raw",
      generatedAt: "2026-06-16 13:00:00",
      limit: 20,
      llmReview: "off",
      write: true,
    })

    expect(written.summary).toMatchObject({
      eventsWritten: 1,
      alertsWritten: 1,
      duplicateEvents: 0,
      duplicateAlerts: 0,
      wroteWiki: false,
      wroteRaw: false,
      wroteRealTrade: false,
    })
    const records = await readJsonl(path.join(tmpRoot, ".llm-wiki/hypothesis-events", `${created.hypothesis.id}.jsonl`))
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      statusBefore: "watching",
      suggestedStatus: "strengthening",
      reason: expect.any(String),
      askRunRef: null,
    })
    expect(records[0].mergedSourceRefs).toEqual(expect.arrayContaining([
      "raw/研报新闻/duplicate-mpo-a.md",
      "raw/研报新闻/duplicate-mpo-b.md",
    ]))
  })

  it("keeps divergent hypotheses divergent when a source only adds a soft catalyst", async () => {
    const created = await createHypothesis({
      projectPath: tmpRoot,
      title: "CPO增速放缓可能推动MPO连接器量价齐升",
      theme: "AI数据中心互联",
      segments: "MPO,CPO,高速连接器",
      status: "divergent",
      write: true,
      generatedAt: "2026-06-25 09:00:00",
    })
    await write(
      path.join(tmpRoot, "raw/研报新闻/mpo-soft-catalyst.md"),
      "# MPO连接器舆情\n\n新增催化：MPO高速连接器的讨论重新升温，AI数据中心互联链条扩散，但暂时缺少硬证据。",
    )

    const dryRun = await runHypothesisWatch({
      projectPath: tmpRoot,
      since: "1d",
      sources: "raw",
      generatedAt: "2026-06-25 10:00:00",
      limit: 20,
      hypothesisId: created.hypothesis.id,
      llmReview: "off",
    })

    expect(dryRun.events).toHaveLength(1)
    expect(dryRun.events[0]).toMatchObject({
      hypothesisId: created.hypothesis.id,
      evidenceDelta: "catalyst_signal",
      statusBefore: "divergent",
      suggestedStatus: "divergent",
    })
    expect(dryRun.events[0].suggestedStatusReason).toContain("divergent")
  })

  it("applies hypothesis watch source filter to a single raw file", async () => {
    const created = await createHypothesis({
      projectPath: tmpRoot,
      title: "CPO增速放缓可能推动MPO连接器量价齐升",
      theme: "AI数据中心互联",
      segments: "MPO,CPO,高速连接器",
      write: true,
      generatedAt: "2026-06-25 09:00:00",
    })
    await write(
      path.join(tmpRoot, "raw/研报新闻/source-filter-target.md"),
      "# 目标文件\n\nMPO连接器出现客户订单和CNINFO公告线索，CPO节奏变化带来AI数据中心互联验证。",
    )
    await write(
      path.join(tmpRoot, "raw/研报新闻/source-filter-other.md"),
      "# 其他文件\n\nMPO连接器出现延期和降价反证，这个文件不应该被本轮 source filter 扫描。",
    )

    const dryRun = await runHypothesisWatch({
      projectPath: tmpRoot,
      since: "1d",
      sources: "raw",
      source: "raw/研报新闻/source-filter-target.md",
      generatedAt: "2026-06-25 10:00:00",
      limit: 20,
      hypothesisId: created.hypothesis.id,
      llmReview: "off",
    })

    expect(dryRun.sources.map((source) => source.sourceRef)).toEqual(["raw/研报新闻/source-filter-target.md"])
    expect(dryRun.summary.sourceDiscovery).toMatchObject({
      sourceFilterApplied: true,
      sourceFilterRef: "raw/研报新闻/source-filter-target.md",
      fileSourcesRead: 1,
    })
    expect(dryRun.events).toHaveLength(1)
    expect(dryRun.events[0]).toMatchObject({
      hypothesisId: created.hypothesis.id,
      sourceRef: "raw/研报新闻/source-filter-target.md",
      evidenceDelta: "fundamental_delivery",
      suggestedStatus: "strengthening",
    })
  })

  it("scans recent wiki updates as read-only hypothesis evidence", async () => {
    await write(path.join(tmpRoot, "raw/研报新闻/wiki-watch-boundary.sentinel"), "raw sentinel")
    const rawBefore = await read(path.join(tmpRoot, "raw/研报新闻/wiki-watch-boundary.sentinel"))
    const created = await createHypothesis({
      projectPath: tmpRoot,
      title: "CPO增速放缓可能推动MPO连接器量价齐升",
      theme: "AI数据中心互联",
      segments: "MPO,CPO,高速连接器",
      write: true,
    })
    await write(
      path.join(tmpRoot, "wiki/概念/MPO连接器验证.md"),
      `${validFrontmatter("MPO连接器验证")}# MPO连接器验证\n\nAI数据中心互联里 CPO 增速放缓，MPO 高速连接器出现客户订单、中标公告、CNINFO公告、财报收入、ASP价格和交付验证。\n`,
    )

    const dryRun = await runHypothesisWatch({
      projectPath: tmpRoot,
      hypothesisId: created.hypothesis.id,
      since: "1d",
      sources: "all",
      generatedAt: "2026-06-16 15:00:00",
      limit: 20,
    })

    expect(dryRun.filters.hypothesisId).toBe(created.hypothesis.id)
    expect(dryRun.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceRef: "wiki/概念/MPO连接器验证.md",
        sourceType: "wiki_article",
      }),
    ]))
    expect(dryRun.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        hypothesisId: created.hypothesis.id,
        sourceRef: "wiki/概念/MPO连接器验证.md",
        evidenceDelta: "fundamental_delivery",
      }),
    ]))
    expect(dryRun.summary).toMatchObject({
      eventsWritten: 0,
      alertsWritten: 0,
      wroteWiki: false,
      wroteRaw: false,
      wroteRealTrade: false,
    })
    expect(await read(path.join(tmpRoot, "raw/研报新闻/wiki-watch-boundary.sentinel"))).toBe(rawBefore)
  })

  it("returns a compact no-source watch result before loading heavier wiki context", async () => {
    const dryRun = await runHypothesisWatch({
      projectPath: tmpRoot,
      since: "1m",
      sources: "wechat_incremental",
      generatedAt: "2026-06-16 15:00:00",
      limit: 20,
      compact: true,
    })

    expect(dryRun).toMatchObject({
      schema: "trading-hypothesis-watch-run-v1",
      dryRun: true,
      sources: [],
      events: [],
      alerts: [],
      candidateHypotheses: [],
      summary: {
        sourcesScanned: 0,
        skippedReason: "no_sources",
        sourceDiscovery: {
          fileRootsScanned: 0,
          fileRootsSkipped: 4,
          skippedFileRoots: ["raw", "wiki", "agentic", "hypothesis_supplement"],
          wechatIncrementalSources: 0,
          durationMs: expect.any(Number),
        },
        eventsPending: 0,
        alertsPending: 0,
        candidateHypotheses: 0,
      },
    })
  })

  it("still rejects unknown hypothesis ids when watch has no new sources", async () => {
    await expect(runHypothesisWatch({
      projectPath: tmpRoot,
      since: "1m",
      sources: "wechat_incremental",
      generatedAt: "2026-06-16 15:00:00",
      hypothesisId: "hypo_missing",
      compact: true,
    })).rejects.toThrow(/Unknown hypothesis id: hypo_missing/)
  })

  it("only reads the newest file sources needed for a limited watch scan", async () => {
    await fs.rm(path.join(tmpRoot, "raw/研报新闻/2026-05-28-AI服务器电源.md"), { force: true })
    for (let index = 0; index < 5; index += 1) {
      const filePath = path.join(tmpRoot, `raw/研报新闻/limited-source-${index}.md`)
      await write(
        filePath,
        `新增变量：有限扫描样本 ${index}，玻璃基板和低介电材料出现催化。`,
      )
      const time = new Date(Date.UTC(2026, 5, 16, 9, index, 0))
      await fs.utimes(filePath, time, time)
    }

    const dryRun = await runHypothesisWatch({
      projectPath: tmpRoot,
      since: "30d",
      sources: "raw",
      generatedAt: "2026-06-16 10:00:00",
      limit: 2,
      llmReview: "off",
    })

    expect(dryRun.sources.map((source) => source.sourceRef)).toEqual([
      "raw/研报新闻/limited-source-4.md",
      "raw/研报新闻/limited-source-3.md",
    ])
    expect(dryRun.summary.sourceDiscovery).toMatchObject({
      fileCandidatesAfterCutoff: 5,
      fileSourcesRead: 2,
      fileSourcesSkippedByLimit: 3,
    })
  })

  it("does not turn date, number, and generic topic headers into candidate hypotheses", async () => {
    await fs.rm(path.join(tmpRoot, "raw/研报新闻/2026-05-28-AI服务器电源.md"), { force: true })
    await write(
      path.join(tmpRoot, "raw/研报新闻/2026-06-19.md"),
      "# 2026-06-19\n\n新增变量：2026-06-19，3.，PCB\n\n预期差，自主可控，芯片。\n",
    )

    const dryRun = await runHypothesisWatch({
      projectPath: tmpRoot,
      since: "30d",
      sources: "raw",
      generatedAt: "2026-06-19 10:00:00",
      limit: 20,
      llmReview: "off",
    })

    expect(dryRun.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceRef: "raw/研报新闻/2026-06-19.md" }),
    ]))
    expect(dryRun.candidateHypotheses).toEqual([])
    expect(dryRun.summary.candidateHypotheses).toBe(0)
  })

  it("requires an LLM provider to draft supplemental evidence before manual submit", async () => {
    await write(path.join(tmpRoot, "wiki/概念/supplement-draft-boundary.md"), "wiki sentinel")
    await write(path.join(tmpRoot, "raw/研报新闻/supplement-draft-boundary.md"), "raw sentinel")
    const wikiBefore = await read(path.join(tmpRoot, "wiki/概念/supplement-draft-boundary.md"))
    const rawBefore = await read(path.join(tmpRoot, "raw/研报新闻/supplement-draft-boundary.md"))

    const created = await createHypothesis({
      projectPath: tmpRoot,
      title: "CPO增速放缓可能推动MPO连接器量价齐升",
      theme: "AI数据中心互联",
      segments: "MPO,CPO,高速连接器",
      write: true,
    })
    const requestAgentText = vi.fn(async () => JSON.stringify({
      title: "补充资料：MPO订单验证",
      kind: "tender_order",
      evidenceDelta: "fundamental_delivery",
      extractedPoints: ["资料声称 MPO 高速连接器出现客户订单和 ASP 上行"],
      evidenceGaps: ["fundamental:announcement:not_checked", "fundamental:financials:not_checked"],
      suggestedSources: ["IMA知识库", "CNINFO公告", "企查查招投标", "Tushare财务"],
      sourceRefs: ["IMA:AI数据中心互联"],
      normalizedBody: "# LLM补证处理结果\n\n- MPO 客户订单待公告和财报验证。",
    }))

    const draft = await draftHypothesisSupplement({
      projectPath: tmpRoot,
      body: "请从 IMA 知识库、CNINFO、企查查、Tushare 补 MPO 订单、ASP、客户份额和财报验证。",
      sourceRefs: "IMA:AI数据中心互联",
      selectedSources: "ima,cninfo,qichacha,tushare",
      hypothesisId: created.hypothesis.id,
      collectExternalSources: false,
      requestAgentText,
    })

    expect(requestAgentText).toHaveBeenCalledTimes(1)
    expect(draft).toMatchObject({
      schema: "trading-hypothesis-supplement-draft-run-v1",
      dryRun: true,
      provider: "codex",
      hypothesisId: created.hypothesis.id,
      draft: {
        title: "补充资料：MPO订单验证",
        kind: "tender_order",
        evidenceDelta: "fundamental_delivery",
        mode: "llm",
        suggestedSources: expect.arrayContaining(["IMA知识库", "CNINFO公告", "企查查招投标", "Tushare财务"]),
        evidenceGaps: expect.arrayContaining(["fundamental:announcement:not_checked"]),
      },
      writePolicy: {
        wroteWiki: false,
        wroteRaw: false,
        wroteRealTrade: false,
      },
    })
    await expect(fs.access(path.join(tmpRoot, ".llm-wiki/hypothesis-supplements"))).rejects.toThrow()
    expect(await read(path.join(tmpRoot, "wiki/概念/supplement-draft-boundary.md"))).toBe(wikiBefore)
    expect(await read(path.join(tmpRoot, "raw/研报新闻/supplement-draft-boundary.md"))).toBe(rawBefore)
  })

  it("uses bounded IMA quick search context for supplemental evidence drafts", async () => {
    const created = await createHypothesis({
      projectPath: tmpRoot,
      title: "CPO增速放缓可能推动MPO连接器量价齐升",
      theme: "AI数据中心互联",
      segments: "MPO,CPO,高速连接器",
      write: true,
    })
    const imaApiCaller = vi.fn(async (apiPath) => {
      if (apiPath === "openapi/wiki/v1/search_knowledge_base") {
        return {
          info_list: [
            { kb_id: "kb-1", kb_name: "AI数据中心互联" },
            { kb_id: "kb-2", kb_name: "路演纪要" },
          ],
        }
      }
      if (apiPath === "openapi/wiki/v1/search_knowledge") {
        return {
          info_list: [
            {
              title: "MPO订单与ASP跟踪",
              highlight_content: "MPO 高速连接器出现客户订单线索，但公告和收入确认仍待核验。",
            },
          ],
        }
      }
      throw new Error(`unexpected IMA call ${apiPath}`)
    })
    const requestAgentText = vi.fn(async ({ prompt }) => {
      expect(prompt).toContain("MPO订单与ASP跟踪")
      expect(prompt).toContain("客户订单线索")
      return JSON.stringify({
        title: "补充资料：IMA快搜MPO订单",
        kind: "research_report",
        evidenceDelta: "supporting_signal",
        extractedPoints: ["IMA 快搜命中 MPO 客户订单线索"],
        evidenceGaps: ["fundamental:announcement:not_checked", "fundamental:revenue_recognition:not_checked"],
        suggestedSources: ["CNINFO公告", "Tushare财务"],
        sourceRefs: ["IMA:AI数据中心互联/MPO订单与ASP跟踪"],
        normalizedBody: "# IMA快搜结果\n\n- MPO 客户订单线索仍需公告和收入确认。",
      })
    })

    const draft = await draftHypothesisSupplement({
      projectPath: tmpRoot,
      body: "请去 IMA 搜 MPO 订单、ASP 和客户份额。",
      selectedSources: "ima",
      hypothesisId: created.hypothesis.id,
      imaApiCaller,
      imaMaxKnowledgeBases: 2,
      imaMaxHits: 1,
      imaMaxQueries: 1,
      requestAgentText,
    })

    expect(imaApiCaller).toHaveBeenCalledWith(
      "openapi/wiki/v1/search_knowledge_base",
      expect.any(Object),
      expect.objectContaining({ timeoutMs: expect.any(Number) }),
    )
    expect(imaApiCaller).toHaveBeenCalledWith(
      "openapi/wiki/v1/search_knowledge",
      expect.objectContaining({ knowledge_base_id: "kb-1" }),
      expect.objectContaining({ timeoutMs: expect.any(Number) }),
    )
    expect(imaApiCaller).not.toHaveBeenCalledWith(
      expect.stringContaining("get_media_info"),
      expect.anything(),
      expect.anything(),
    )
    expect(requestAgentText).toHaveBeenCalledTimes(1)
    expect(draft.externalContext.ima.hits).toHaveLength(1)
    expect(draft.draft.evidenceGaps).toEqual(expect.arrayContaining(["fundamental:announcement:not_checked"]))
    await expect(fs.access(path.join(tmpRoot, ".llm-wiki/hypothesis-supplements"))).rejects.toThrow()
  })

  it("submits supplemental evidence as a watchable source and derives feedback statuses", async () => {
    await write(path.join(tmpRoot, "wiki/概念/supplement-boundary.md"), "wiki sentinel")
    await write(path.join(tmpRoot, "raw/研报新闻/supplement-boundary.md"), "raw sentinel")
    const wikiBefore = await read(path.join(tmpRoot, "wiki/概念/supplement-boundary.md"))
    const rawBefore = await read(path.join(tmpRoot, "raw/研报新闻/supplement-boundary.md"))

    const mpo = await createHypothesis({
      projectPath: tmpRoot,
      title: "MPO连接器量价齐升",
      theme: "AI数据中心互联",
      segments: "MPO,CPO,高速连接器",
      write: true,
    })
    const priceOnly = await createHypothesis({
      projectPath: tmpRoot,
      title: "存储涨价可能扩散",
      theme: "AI服务器存储",
      segments: "存储,HBM,DRAM",
      marketRefs: "stock_daily_sql: 存储链候选股成交额放量上涨",
      write: true,
    })

    const dryRun = await submitHypothesisSupplement({
      projectPath: tmpRoot,
      title: "MPO路演纪要补充",
      body: "路演文件显示 MPO CPO 高速连接器已有客户订单、中标公告、CNINFO公告、财报收入、ASP价格和交付验证。",
      sourceRefs: "roadshow/mpo.pdf,model/mpo.xlsx",
      hypothesisId: mpo.hypothesis.id,
      generatedAt: "2026-06-16 14:00:00",
    })
    expect(dryRun).toMatchObject({
      schema: "trading-hypothesis-supplement-run-v1",
      dryRun: true,
      writeResult: null,
      writePolicy: {
        wroteWiki: false,
        wroteRaw: false,
        wroteRealTrade: false,
      },
    })
    await expect(fs.access(path.join(tmpRoot, ".llm-wiki/hypothesis-supplements"))).rejects.toThrow()

    const written = await submitHypothesisSupplement({
      projectPath: tmpRoot,
      title: "MPO路演纪要补充",
      body: "路演文件显示 MPO CPO 高速连接器已有客户订单、中标公告、CNINFO公告、财报收入、ASP价格和交付验证。",
      sourceRefs: "roadshow/mpo.pdf,model/mpo.xlsx",
      hypothesisId: mpo.hypothesis.id,
      kind: "roadshow",
      generatedAt: "2026-06-16 14:00:00",
      write: true,
    })
    expect(written.writeResult).toMatchObject({
      markdownRelativePath: expect.stringMatching(/^\.llm-wiki\/hypothesis-supplements\/20260616140000-/),
      jsonRelativePath: expect.stringMatching(/^\.llm-wiki\/hypothesis-supplements\/20260616140000-/),
      records: 1,
    })
    expect(await read(written.writeResult.markdownPath)).toContain("roadshow/mpo.pdf")

    const watch = await runHypothesisWatch({
      projectPath: tmpRoot,
      since: "1d",
      sources: "hypothesis_supplement",
      generatedAt: "2026-06-16 14:01:00",
      write: true,
    })
    expect(watch.summary).toMatchObject({
      sourcesScanned: 1,
      matchedHypotheses: 1,
      eventsWritten: 1,
      alertsWritten: 1,
      wroteWiki: false,
      wroteRaw: false,
    })
    expect(watch.sources[0].sourceType).toBe("hypothesis_supplement")

    const dashboard = await buildHypothesisDashboardData({
      projectPath: tmpRoot,
      generatedAt: "2026-06-16 14:02:00",
    })
    const mpoRow = dashboard.dashboard.hypotheses.find((item) => item.id === mpo.hypothesis.id)
    const priceOnlyRow = dashboard.dashboard.hypotheses.find((item) => item.id === priceOnly.hypothesis.id)
    expect(mpoRow).toMatchObject({
      status: "watching",
      feedbackStatus: "strengthening",
      latestEvidenceDelta: "fundamental_delivery",
    })
    expect(mpoRow.recentEvents?.[0]).toMatchObject({
      hypothesisId: mpo.hypothesis.id,
      evidenceDelta: "fundamental_delivery",
    })
    expect(mpoRow.openAlerts?.[0]).toMatchObject({
      hypothesisId: mpo.hypothesis.id,
      evidenceDelta: "fundamental_delivery",
      status: "open",
    })
    expect(priceOnlyRow).toMatchObject({
      feedbackStatus: "priced_in",
    })
    expect(await read(path.join(tmpRoot, "wiki/概念/supplement-boundary.md"))).toBe(wikiBefore)
    expect(await read(path.join(tmpRoot, "raw/研报新闻/supplement-boundary.md"))).toBe(rawBefore)
  })

  it("routes supplemental evidence by explicit hypothesis id", async () => {
    const created = await createHypothesis({
      projectPath: tmpRoot,
      title: "MPO连接器量价齐升",
      theme: "AI数据中心互联",
      segments: "MPO,CPO,高速连接器",
      write: true,
    })
    await submitHypothesisSupplement({
      projectPath: tmpRoot,
      title: "路演附件摘录",
      body: "客户订单、中标公告、交付节奏和财报收入继续验证，ASP价格保持上行。",
      hypothesisId: created.hypothesis.id,
      kind: "roadshow",
      generatedAt: "2026-06-16 15:00:00",
      write: true,
    })
    const watch = await runHypothesisWatch({
      projectPath: tmpRoot,
      since: "1d",
      sources: "hypothesis_supplement",
      generatedAt: "2026-06-16 15:01:00",
    })
    expect(watch.summary).toMatchObject({
      sourcesScanned: 1,
      matchedHypotheses: 1,
    })
    expect(watch.events[0]).toMatchObject({
      hypothesisId: created.hypothesis.id,
      sourceType: "hypothesis_supplement",
      evidenceDelta: "fundamental_delivery",
    })
  })

  it("does not surface already written watch alerts as pending dry-run actions", async () => {
    const created = await createHypothesis({
      projectPath: tmpRoot,
      title: "CPO增速放缓可能推动MPO连接器量价齐升",
      theme: "AI数据中心互联",
      segments: "MPO,CPO,高速连接器",
      write: true,
    })
    await submitHypothesisSupplement({
      projectPath: tmpRoot,
      title: "MPO订单补证",
      body: "MPO CPO 高速连接器出现客户订单、中标公告、CNINFO公告、财报收入、ASP价格和交付验证。",
      hypothesisId: created.hypothesis.id,
      kind: "roadshow",
      generatedAt: "2026-06-16 16:00:00",
      write: true,
    })

    const written = await runHypothesisWatch({
      projectPath: tmpRoot,
      since: "1d",
      sources: "hypothesis_supplement",
      generatedAt: "2026-06-16 16:01:00",
      write: true,
    })
    expect(written.summary).toMatchObject({
      sourcesScanned: 1,
      matchedHypotheses: 1,
      eventsPending: 1,
      alertsPending: 1,
      duplicateEvents: 0,
      duplicateAlerts: 0,
      eventsWritten: 1,
      alertsWritten: 1,
    })

    const dryRun = await runHypothesisWatch({
      projectPath: tmpRoot,
      since: "1d",
      sources: "hypothesis_supplement",
      generatedAt: "2026-06-16 16:02:00",
    })
    expect(dryRun.summary).toMatchObject({
      sourcesScanned: 1,
      matchedHypotheses: 1,
      eventsPending: 0,
      alertsPending: 0,
      duplicateEvents: 1,
      duplicateAlerts: 1,
      eventsWritten: 0,
      alertsWritten: 0,
    })
    expect(dryRun.events).toEqual([])
    expect(dryRun.alerts).toEqual([])
    expect(dryRun.duplicateEvents[0]).toMatchObject({
      hypothesisId: created.hypothesis.id,
      sourceType: "hypothesis_supplement",
      evidenceDelta: "fundamental_delivery",
    })
  })

  it("normalizes wechat incremental inbox messages with dedupe and invalid-line accounting", async () => {
    const incomingPath = path.join(tmpRoot, ".llm-wiki/wechat-inbox/incoming/2026-06-16.jsonl")
    await write(
      incomingPath,
      [
        JSON.stringify({
          schema: "wechat-increment-v1",
          messageId: "msg-1",
          chatId: "core",
          chatName: "核心群",
          senderAlias: "研究员A",
          sentAt: "2026-06-16 09:30:00",
          receivedAt: "2026-06-16 09:30:20",
          text: "MPO CPO 高速连接器成交额放量，但缺少公告和订单闭环。",
          sourceTool: "wechat-extractor",
        }),
        JSON.stringify({
          schema: "wechat-increment-v1",
          messageId: "msg-1",
          chatId: "core",
          chatName: "核心群",
          senderAlias: "研究员A",
          sentAt: "2026-06-16 09:30:00",
          receivedAt: "2026-06-16 09:30:25",
          text: "MPO CPO 高速连接器成交额放量，但缺少公告和订单闭环。",
          sourceTool: "wechat-extractor",
        }),
        "{not-json",
      ].join("\n") + "\n",
    )

    const result = await processWechatIncrementInbox({
      projectPath: tmpRoot,
      generatedAt: "2026-06-16 09:31:00",
    })

    expect(result).toMatchObject({
      schema: "wechat-increment-process-run-v1",
      dryRun: false,
      summary: {
        incomingLinesRead: 3,
        messagesWritten: 1,
        duplicateCount: 1,
        errorCount: 1,
        wroteWiki: false,
        wroteRaw: false,
        wroteRealTrade: false,
      },
    })
    expect(result.writeResult.processedRelativePaths).toEqual([".llm-wiki/wechat-inbox/processed/2026-06-16.jsonl"])

    const processed = await readJsonl(path.join(tmpRoot, ".llm-wiki/wechat-inbox/processed/2026-06-16.jsonl"))
    expect(processed).toHaveLength(1)
    expect(processed[0]).toMatchObject({
      schema: "wechat-increment-processed-v1",
      messageKey: "msg:msg-1",
      chatName: "核心群",
      text: "MPO CPO 高速连接器成交额放量，但缺少公告和订单闭环。",
    })
    expect(processed[0].senderAlias).toBeUndefined()
    expect(processed[0].senderAliasHash).toMatch(/^sender_/)

    const secondRun = await processWechatIncrementInbox({
      projectPath: tmpRoot,
      generatedAt: "2026-06-16 09:32:00",
    })
    expect(secondRun.summary.incomingLinesRead).toBe(0)
    expect(secondRun.summary.messagesWritten).toBe(0)

    await fs.appendFile(
      incomingPath,
      `${JSON.stringify({
        schema: "wechat-increment-v1",
        messageId: "msg-2",
        chatId: "core",
        chatName: "核心群",
        senderAlias: "研究员A",
        sentAt: "2026-06-16 09:33:00",
        receivedAt: "2026-06-16 09:33:20",
        text: "MPO CPO 后续新增消息不应被尾部空行 offset 跳过。",
        sourceTool: "wechat-extractor",
      })}\n`,
      "utf8",
    )
    const appendedRun = await processWechatIncrementInbox({
      projectPath: tmpRoot,
      generatedAt: "2026-06-16 09:34:00",
    })
    expect(appendedRun.summary.incomingLinesRead).toBe(1)
    expect(appendedRun.summary.messagesWritten).toBe(1)

    const status = await getWechatIncrementInboxStatus({ projectPath: tmpRoot })
    expect(status).toMatchObject({
      schema: "wechat-increment-inbox-status-v1",
      state: {
        messageCount: 2,
        duplicateCount: 1,
        errorCount: 1,
      },
      writePolicy: {
        readOnly: true,
        wroteWiki: false,
        wroteRaw: false,
      },
    })
  })

  it("imports raw wechat chat files into inbox with dry-run and write boundaries", async () => {
    const rawChatPath = path.join(tmpRoot, "raw/微信聊天/2026-06-16.md")
    await write(
      rawChatPath,
      [
        "# 微信聊天 2026-06-16",
        "",
        "- 09:30 研究员A：CPO增速放缓可能推动MPO连接器量价齐升，客户订单、中标公告、财报收入和ASP价格需要验证。",
        "- 09:35 研究员B：PCB里的CCL、HVLP铜箔和高速材料也要观察订单兑现。",
      ].join("\n"),
    )
    await write(path.join(tmpRoot, "wiki/概念/raw-wechat-boundary.md"), "wiki sentinel")
    const rawBefore = await read(rawChatPath)
    const wikiBefore = await read(path.join(tmpRoot, "wiki/概念/raw-wechat-boundary.md"))

    const dryRun = await importWechatRawChatMessages({
      projectPath: tmpRoot,
      sourcePath: "raw/微信聊天",
      generatedAt: "2026-06-16 10:00:00",
    })
    expect(dryRun).toMatchObject({
      schema: "wechat-raw-chat-import-run-v1",
      mode: "wechat-raw-chat-import",
      dryRun: true,
      summary: {
        filesScanned: 1,
        messagesExtracted: 2,
        recordsWritten: 0,
        wroteWiki: false,
        wroteRaw: false,
        wroteRealTrade: false,
      },
      writeResult: null,
    })
    await expect(fs.access(path.join(tmpRoot, ".llm-wiki/wechat-inbox/incoming"))).rejects.toThrow()
    const firstMpoMessageId = dryRun.previewMessages.find((message) => String(message.text).includes("MPO连接器量价齐升"))?.messageId

    await write(
      rawChatPath,
      [
        "# 微信聊天 2026-06-16",
        "",
        "- 09:25 研究员C：新增在前面的消息不应该改变后续旧消息的去重键。",
        "- 09:30 研究员A：CPO增速放缓可能推动MPO连接器量价齐升，客户订单、中标公告、财报收入和ASP价格需要验证。",
        "- 09:35 研究员B：PCB里的CCL、HVLP铜箔和高速材料也要观察订单兑现。",
      ].join("\n"),
    )
    const shiftedDryRun = await importWechatRawChatMessages({
      projectPath: tmpRoot,
      sourcePath: "raw/微信聊天",
      generatedAt: "2026-06-16 10:00:30",
    })
    expect(shiftedDryRun.previewMessages.find((message) => String(message.text).includes("MPO连接器量价齐升"))?.messageId).toBe(firstMpoMessageId)
    await write(rawChatPath, rawBefore)

    const written = await importWechatRawChatMessages({
      projectPath: tmpRoot,
      sourcePath: "raw/微信聊天",
      generatedAt: "2026-06-16 10:01:00",
      write: true,
    })
    expect(written).toMatchObject({
      dryRun: false,
      writeResult: {
        incomingRelativePaths: [".llm-wiki/wechat-inbox/incoming/2026-06-16.jsonl"],
        records: 2,
      },
      summary: {
        filesScanned: 1,
        messagesExtracted: 2,
        recordsWritten: 2,
        wroteWiki: false,
        wroteRaw: false,
        wroteRealTrade: false,
      },
    })

    const incoming = await readJsonl(path.join(tmpRoot, ".llm-wiki/wechat-inbox/incoming/2026-06-16.jsonl"))
    expect(incoming).toHaveLength(2)
    expect(incoming[0]).toMatchObject({
      schema: "wechat-increment-v1",
      chatId: "raw-wechat-chat",
      chatName: "微信聊天 2026-06-16",
      sourceTool: "wechat-raw-chat-file",
    })
    expect(incoming[0].messageId).toMatch(/^raw:/)
    expect(incoming[0].text).toContain("MPO连接器量价齐升")

    const processed = await processWechatIncrementInbox({
      projectPath: tmpRoot,
      generatedAt: "2026-06-16 10:02:00",
    })
    expect(processed.summary.messagesWritten).toBe(2)

    const repeatedImport = await importWechatRawChatMessages({
      projectPath: tmpRoot,
      sourcePath: "raw/微信聊天/2026-06-16.md",
      generatedAt: "2026-06-16 10:03:00",
      write: true,
    })
    expect(repeatedImport.summary.recordsWritten).toBe(0)
    const repeatedProcess = await processWechatIncrementInbox({
      projectPath: tmpRoot,
      generatedAt: "2026-06-16 10:04:00",
    })
    expect(repeatedProcess.summary.messagesWritten).toBe(0)

    await fs.appendFile(rawChatPath, "\n- 10:05 研究员D：健滔涨价函继续发酵，CCL 和 PCB 材料链需要更新状态。\n", "utf8")
    const rawAfterManualAppend = await read(rawChatPath)
    const appendedImport = await importWechatRawChatMessages({
      projectPath: tmpRoot,
      sourcePath: "raw/微信聊天/2026-06-16.md",
      generatedAt: "2026-06-16 10:05:30",
      write: true,
    })
    expect(appendedImport.summary.recordsWritten).toBe(1)
    const appendedProcess = await processWechatIncrementInbox({
      projectPath: tmpRoot,
      generatedAt: "2026-06-16 10:06:00",
    })
    expect(appendedProcess.summary.messagesWritten).toBe(1)

    expect(await read(rawChatPath)).toBe(rawAfterManualAppend)
    expect(await read(path.join(tmpRoot, "wiki/概念/raw-wechat-boundary.md"))).toBe(wikiBefore)
  })

  it("lists raw wechat chat sources with today and recent-file prioritization", async () => {
    const todayPath = path.join(tmpRoot, "raw/微信聊天/2026-06-18.md")
    const oldPath = path.join(tmpRoot, "raw/微信聊天/2026-06-17.md")
    await write(todayPath, "# 微信聊天 2026-06-18\n\n台积电玻璃基板和健滔涨价函成为今日催化。")
    await write(oldPath, "# 微信聊天 2026-06-17\n\n旧消息。")
    await fs.utimes(oldPath, new Date("2026-06-17T01:00:00Z"), new Date("2026-06-17T01:00:00Z"))
    await fs.utimes(todayPath, new Date("2026-06-18T12:00:00Z"), new Date("2026-06-18T12:00:00Z"))

    const listed = await listWechatRawChatSources({
      projectPath: tmpRoot,
      sourcePath: "raw/微信聊天",
      generatedAt: "2026-06-18 22:20:00",
      limit: 10,
    })

    expect(listed).toMatchObject({
      schema: "wechat-raw-chat-source-list-v1",
      mode: "wechat-raw-chat-source-list",
      writePolicy: {
        readOnly: true,
        wroteWiki: false,
        wroteRaw: false,
      },
      summary: {
        sourcesReturned: 2,
      },
    })
    expect(listed.sources.map((item) => item.sourceRef)).toEqual([
      "raw/微信聊天/2026-06-18.md",
      "raw/微信聊天/2026-06-17.md",
    ])
    expect(listed.sources[0]).toMatchObject({
      isToday: true,
      isSelectedCandidate: true,
      title: "微信聊天 2026-06-18",
      messagePreviewCount: 1,
    })
    expect(listed.defaultSourceRef).toBe("raw/微信聊天/2026-06-18.md")
  })

  it("lists the most recent raw wechat chat source when today file is missing", async () => {
    const recentPath = path.join(tmpRoot, "raw/微信聊天/2026-06-17.md")
    const olderPath = path.join(tmpRoot, "raw/微信聊天/2026-06-16.md")
    await write(recentPath, "# 微信聊天 2026-06-17\n\n台积电玻璃基板继续发酵。")
    await write(olderPath, "# 微信聊天 2026-06-16\n\n旧消息。")
    await fs.utimes(olderPath, new Date("2026-06-16T01:00:00Z"), new Date("2026-06-16T01:00:00Z"))
    await fs.utimes(recentPath, new Date("2026-06-17T12:00:00Z"), new Date("2026-06-17T12:00:00Z"))

    const listed = await listWechatRawChatSources({
      projectPath: tmpRoot,
      sourcePath: "raw/微信聊天",
      generatedAt: "2026-06-18 22:20:00",
      limit: 10,
    })

    expect(listed.summary.todayFound).toBe(false)
    expect(listed.defaultSourceRef).toBe("raw/微信聊天/2026-06-17.md")
    expect(listed.sources[0]).toMatchObject({
      sourceRef: "raw/微信聊天/2026-06-17.md",
      isToday: false,
      isSelectedCandidate: true,
    })
  })

  it("classifies research cockpit raw signal sources beyond wechat", async () => {
    const newsPath = path.join(tmpRoot, "raw/研报新闻/2026-06-25-健滔涨价函.md")
    const gangtisePath = path.join(tmpRoot, "raw/openclaw数据/产业链复盘/gangtise_themes/2026-06-25/001-MPO连接器.md")
    await write(newsPath, "# 健滔涨价函\n\nCCL 涨价函成为新催化，关注覆铜板链条。")
    await write(gangtisePath, "# MPO连接器产业链复盘\n\nCPO 节奏放缓，MPO 跳线和高速连接器需求扩散。")

    const newsSources = await listWechatRawChatSources({
      projectPath: tmpRoot,
      sourcePath: "raw/研报新闻",
      generatedAt: "2026-06-25 10:00:00",
      limit: 10,
    })
    const gangtiseSources = await listWechatRawChatSources({
      projectPath: tmpRoot,
      sourcePath: "raw/openclaw数据/产业链复盘/gangtise_themes",
      generatedAt: "2026-06-25 10:00:00",
      limit: 10,
    })

    expect(newsSources.sources[0]).toMatchObject({
      sourceKind: "research_news",
      sourceKindLabel: "研报新闻",
      sourceRef: "raw/研报新闻/2026-06-25-健滔涨价函.md",
    })
    expect(gangtiseSources.sources[0]).toMatchObject({
      sourceKind: "gangtise_themes",
      sourceKindLabel: "Gangtise产业链复盘",
      sourceRef: "raw/openclaw数据/产业链复盘/gangtise_themes/2026-06-25/001-MPO连接器.md",
    })

    const imported = await importWechatRawChatMessages({
      projectPath: tmpRoot,
      sourcePath: "raw/研报新闻",
      generatedAt: "2026-06-25 10:05:00",
      write: true,
    })
    expect(imported.sourceFiles[0]).toMatchObject({
      sourceKind: "research_news",
      sourceKindLabel: "研报新闻",
    })
    expect(imported.previewMessages[0]).toMatchObject({
      sourceKind: "research_news",
      sourceKindLabel: "研报新闻",
      sourceTool: "raw-research-news-file",
    })
    expect(imported.summary.wroteWiki).toBe(false)
    expect(imported.summary.wroteRaw).toBe(false)
    const incoming = await readJsonl(path.join(tmpRoot, ".llm-wiki/wechat-inbox/incoming/2026-06-25.jsonl"))
    expect(incoming[0]).toMatchObject({
      chatId: "raw-research-news",
      sourceTool: "raw-research-news-file",
    })

    const hypothesis = await createHypothesis({
      projectPath: tmpRoot,
      title: "健滔涨价函可能推动CCL覆铜板链条进入量价重估",
      theme: "AI数据中心互联",
      segments: "CCL,覆铜板,PCB材料",
      write: true,
    })
    await processWechatIncrementInbox({
      projectPath: tmpRoot,
      generatedAt: "2026-06-25 10:06:00",
    })
    const watched = await runHypothesisWatch({
      projectPath: tmpRoot,
      since: "1d",
      sources: "wechat_incremental",
      generatedAt: "2026-06-25 10:07:00",
      limit: 20,
      llmReview: "off",
    })
    expect(watched.sources[0]).toMatchObject({
      sourceType: "wechat_incremental",
      sourceKind: "research_news",
      sourceKindLabel: "研报新闻",
      sourceTool: "raw-research-news-file",
    })
    expect(watched.events[0]).toMatchObject({
      hypothesisId: hypothesis.hypothesis.id,
      sourceType: "wechat_incremental",
      sourceKind: "research_news",
      sourceKindLabel: "研报新闻",
      sourceTool: "raw-research-news-file",
      eventTime: expect.stringContaining("2026-06-25"),
      signalType: "新催化",
      signalStrength: "medium",
      tradingImplication: expect.stringContaining("新催化"),
    })
    expect(watched.alerts[0]).toMatchObject({
      hypothesisId: hypothesis.hypothesis.id,
      sourceKind: "research_news",
      sourceKindLabel: "研报新闻",
      sourceTool: "raw-research-news-file",
      eventTime: expect.stringContaining("2026-06-25"),
      signalType: "新催化",
      signalStrength: "medium",
    })
  })

  it("parses Gangtise theme files as research signals instead of metadata chat lines", async () => {
    const gangtisePath = path.join(tmpRoot, "raw/openclaw数据/产业链复盘/gangtise_themes/2026-06-25/0135-复盘-玻璃基板-128761.md")
    await write(
      gangtisePath,
      [
        "theme_id：128761",
        "theme_date：2026-06-25",
        "type：复盘",
        "type_code：review",
        "name：玻璃基板",
        "",
        "# 玻璃基板产业链复盘",
        "",
        "今日叙事主线：康宁 GlassBridge 技术更新，TGV 玻璃基板和 CPO 封装链条扩散。",
        "核心标的：沃格光电、凯盛科技、三超新材。",
        "催化：AI 数据中心先进封装带动玻璃基板设备和材料验证。",
        "风险提示：目前仍缺少订单、客户验证和收入确认。",
      ].join("\n"),
    )

    const imported = await importWechatRawChatMessages({
      projectPath: tmpRoot,
      sourcePath: "raw/openclaw数据/产业链复盘/gangtise_themes/2026-06-25",
      generatedAt: "2026-06-25 10:05:00",
      limit: 20,
    })

    const texts = imported.previewMessages.map((message) => String(message.text))
    expect(imported.summary).toMatchObject({
      filesScanned: 1,
      messagesExtracted: 4,
      recordsWritten: 0,
      wroteWiki: false,
      wroteRaw: false,
    })
    expect(imported.sourceFiles[0]).toMatchObject({
      sourceKind: "gangtise_themes",
      sourceKindLabel: "Gangtise产业链复盘",
    })
    expect(texts.join("\n")).toContain("今日叙事主线")
    expect(texts.join("\n")).toContain("核心标的")
    expect(texts.join("\n")).toContain("催化")
    expect(texts.join("\n")).not.toMatch(/theme_id|theme_date|type_code|^type：|^name：/m)
  })

  it("serves a local token-protected wechat incremental POST endpoint", async () => {
    const server = await startWechatIncrementServer({
      projectPath: tmpRoot,
      token: "test-token",
      host: "127.0.0.1",
      port: 0,
      maxBodyBytes: 512,
    })
    try {
      const unauthorized = await fetch(`${server.url}/wechat-inbox/increment`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "MPO增量" }),
      })
      expect(unauthorized.status).toBe(401)

      const tooLarge = await fetch(`${server.url}/wechat-inbox/increment`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-wechat-inbox-token": "test-token",
        },
        body: JSON.stringify({
          schema: "wechat-increment-v1",
          messageId: "huge",
          chatId: "core",
          text: "x".repeat(1000),
        }),
      })
      expect(tooLarge.status).toBe(413)

      const accepted = await fetch(`${server.url}/wechat-inbox/increment`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-wechat-inbox-token": "test-token",
        },
        body: JSON.stringify({
          schema: "wechat-increment-v1",
          messageId: "http-1",
          chatId: "core",
          chatName: "核心群",
          senderAlias: "研究员B",
          sentAt: "2026-06-16 10:00:00",
          receivedAt: "2026-06-16 10:00:20",
          text: "CPO放缓可能推动MPO连接器量价齐升。",
          sourceTool: "wechat-extractor",
        }),
      })
      expect(accepted.status).toBe(202)
      const body = await accepted.json()
      expect(body).toMatchObject({ ok: true, recordsWritten: 1 })

      const incoming = await readJsonl(path.join(tmpRoot, ".llm-wiki/wechat-inbox/incoming/2026-06-16.jsonl"))
      expect(incoming[0]).toMatchObject({
        schema: "wechat-increment-v1",
        messageId: "http-1",
        text: "CPO放缓可能推动MPO连接器量价齐升。",
      })
    } finally {
      await server.close()
    }
  })

  it("routes wechat incremental processed messages through hypothesis watch without raw/wiki writes", async () => {
    await write(path.join(tmpRoot, "wiki/概念/wechat-increment-boundary.md"), "wiki sentinel")
    await write(path.join(tmpRoot, "raw/研报新闻/wechat-increment-boundary.sentinel"), "raw sentinel")
    const wikiBefore = await read(path.join(tmpRoot, "wiki/概念/wechat-increment-boundary.md"))
    const rawBefore = await read(path.join(tmpRoot, "raw/研报新闻/wechat-increment-boundary.sentinel"))

    const mpo = await createHypothesis({
      projectPath: tmpRoot,
      title: "CPO增速放缓可能推动MPO连接器量价齐升",
      theme: "AI数据中心互联",
      segments: "MPO,CPO,高速连接器",
      write: true,
    })
    const appended = await appendWechatIncrementMessages({
      projectPath: tmpRoot,
      messages: [
        {
          schema: "wechat-increment-v1",
          messageId: "inc-1",
          chatId: "core",
          chatName: "核心群",
          senderAlias: "研究员C",
          sentAt: "2026-06-16 10:30:00",
          receivedAt: "2026-06-16 10:30:20",
          text: "AI数据中心互联里 MPO CPO 高速连接器成交额放量，客户订单、中标公告、CNINFO公告、财报收入和ASP价格都有验证。",
          sourceTool: "wechat-extractor",
        },
      ],
      generatedAt: "2026-06-16 10:30:30",
    })
    expect(appended.summary.recordsWritten).toBe(1)
    await processWechatIncrementInbox({
      projectPath: tmpRoot,
      generatedAt: "2026-06-16 10:31:00",
    })

    const dryRun = await runHypothesisWatch({
      projectPath: tmpRoot,
      since: "30m",
      sources: "wechat_incremental",
      generatedAt: "2026-06-16 10:32:00",
      limit: 20,
    })

    expect(dryRun.summary).toMatchObject({
      sourcesScanned: 1,
      sourceDiscovery: {
        fileRootsScanned: 0,
        fileRootsSkipped: 4,
        skippedFileRoots: ["raw", "wiki", "agentic", "hypothesis_supplement"],
        filesListed: 0,
        wechatIncrementalSources: 1,
        durationMs: expect.any(Number),
      },
      eventsWritten: 0,
      alertsWritten: 0,
      wroteWiki: false,
      wroteRaw: false,
      wroteRealTrade: false,
    })
    expect(dryRun.sources[0]).toMatchObject({
      sourceType: "wechat_incremental",
      sourceRef: ".llm-wiki/wechat-inbox/processed/2026-06-16.jsonl#msg:inc-1",
    })
    expect(dryRun.events[0]).toMatchObject({
      hypothesisId: mpo.hypothesis.id,
      evidenceDelta: "fundamental_delivery",
    })
    await expect(fs.access(path.join(tmpRoot, ".llm-wiki/hypothesis-alerts"))).rejects.toThrow()

    const written = await runHypothesisWatch({
      projectPath: tmpRoot,
      since: "30m",
      sources: "wechat_incremental",
      generatedAt: "2026-06-16 10:32:00",
      limit: 20,
      write: true,
    })
    expect(written.summary).toMatchObject({
      eventsWritten: 1,
      alertsWritten: 1,
      wroteWiki: false,
      wroteRaw: false,
      wroteRealTrade: false,
    })
    expect(await read(path.join(tmpRoot, "wiki/概念/wechat-increment-boundary.md"))).toBe(wikiBefore)
    expect(await read(path.join(tmpRoot, "raw/研报新闻/wechat-increment-boundary.sentinel"))).toBe(rawBefore)
  })

  it("limits wechat incremental discovery to the newest processed messages", async () => {
    await appendWechatIncrementMessages({
      projectPath: tmpRoot,
      messages: [
        {
          schema: "wechat-increment-v1",
          messageId: "limit-1",
          chatId: "core",
          chatName: "核心群",
          senderAlias: "研究员A",
          sentAt: "2026-06-16 10:00:00",
          receivedAt: "2026-06-16 10:00:10",
          text: "旧消息1：CPO 产业链观察。",
          sourceTool: "wechat-extractor",
        },
        {
          schema: "wechat-increment-v1",
          messageId: "limit-2",
          chatId: "core",
          chatName: "核心群",
          senderAlias: "研究员A",
          sentAt: "2026-06-16 10:01:00",
          receivedAt: "2026-06-16 10:01:10",
          text: "旧消息2：MPO 高速连接器观察。",
          sourceTool: "wechat-extractor",
        },
        {
          schema: "wechat-increment-v1",
          messageId: "limit-3",
          chatId: "core",
          chatName: "核心群",
          senderAlias: "研究员A",
          sentAt: "2026-06-16 10:02:00",
          receivedAt: "2026-06-16 10:02:10",
          text: "新消息3：玻璃基板产业催化。",
          sourceTool: "wechat-extractor",
        },
        {
          schema: "wechat-increment-v1",
          messageId: "limit-4",
          chatId: "core",
          chatName: "核心群",
          senderAlias: "研究员A",
          sentAt: "2026-06-16 10:03:00",
          receivedAt: "2026-06-16 10:03:10",
          text: "新消息4：健滔涨价函催化 CCL 链条。",
          sourceTool: "wechat-extractor",
        },
      ],
      generatedAt: "2026-06-16 10:04:00",
    })
    await processWechatIncrementInbox({
      projectPath: tmpRoot,
      generatedAt: "2026-06-16 10:05:00",
    })

    const dryRun = await runHypothesisWatch({
      projectPath: tmpRoot,
      since: "365d",
      sources: "wechat_incremental",
      generatedAt: "2026-06-16 10:06:00",
      limit: 2,
      llmReview: "off",
    })

    expect(dryRun.sources).toHaveLength(2)
    expect(dryRun.sources.map((source) => source.sourceRef)).toEqual([
      ".llm-wiki/wechat-inbox/processed/2026-06-16.jsonl#msg:limit-4",
      ".llm-wiki/wechat-inbox/processed/2026-06-16.jsonl#msg:limit-3",
    ])
    expect(dryRun.summary.sourceDiscovery).toMatchObject({
      wechatIncrementalFilesListed: 1,
      wechatIncrementalFilesScanned: 1,
      wechatIncrementalLinesRead: 2,
      wechatIncrementalSources: 2,
      wechatIncrementalLimit: 2,
    })
  })

  it("filters old messages inside recently processed wechat inbox files by message time", async () => {
    const currentTimestamp = new Date().toISOString().slice(0, 19).replace("T", " ")
    await appendWechatIncrementMessages({
      projectPath: tmpRoot,
      messages: [
        {
          schema: "wechat-increment-v1",
          messageId: "old-in-recent-file",
          chatId: "core",
          chatName: "核心群",
          senderAlias: "研究员O",
          sentAt: "2000-01-01 09:00:00",
          receivedAt: currentTimestamp,
          text: "旧消息：健滔涨价函带动CCL覆铜板链条，这条不应该进入今日候选。",
          sourceTool: "wechat-extractor",
        },
        {
          schema: "wechat-increment-v1",
          messageId: "fresh-in-recent-file",
          chatId: "core",
          chatName: "核心群",
          senderAlias: "研究员N",
          sentAt: currentTimestamp,
          receivedAt: currentTimestamp,
          text: "新催化：台积电玻璃基板消息继续发酵，先看设备和材料链量价反馈。",
          sourceTool: "wechat-extractor",
        },
      ],
      generatedAt: currentTimestamp,
    })
    await processWechatIncrementInbox({
      projectPath: tmpRoot,
      generatedAt: currentTimestamp,
    })

    const dryRun = await runHypothesisWatch({
      projectPath: tmpRoot,
      since: "1d",
      sources: "wechat_incremental",
      limit: 20,
    })

    const sourceRefs = dryRun.sources.map((source) => source.sourceRef)
    expect(sourceRefs.some((sourceRef) => sourceRef.includes("old-in-recent-file"))).toBe(false)
    expect(sourceRefs).toEqual(
      expect.arrayContaining([expect.stringContaining("#msg:fresh-in-recent-file")]),
    )
    expect(dryRun.candidateHypotheses.map((item) => item.title).join("\n")).toContain("玻璃基板")
    expect(dryRun.candidateHypotheses.map((item) => item.title).join("\n")).not.toContain("健滔")
  })

  it("routes fresh wechat catalysts as lightweight tracking alerts", async () => {
    const created = await createHypothesis({
      projectPath: tmpRoot,
      title: "玻璃基板催化可能扩散到PCB材料链",
      theme: "AI先进封装",
      segments: "玻璃基板,PCB,覆铜板,CCL",
      write: true,
    })
    await appendWechatIncrementMessages({
      projectPath: tmpRoot,
      messages: [
        {
          schema: "wechat-increment-v1",
          messageId: "catalyst-1",
          chatId: "core",
          chatName: "核心群",
          senderAlias: "研究员D",
          sentAt: "2026-06-16 22:30:00",
          receivedAt: "2026-06-16 22:30:20",
          text: "昨晚新催化：台积电玻璃基板消息继续发酵，建滔/健滔涨价函带动CCL和PCB材料关注，先看市场反应。",
          sourceTool: "wechat-extractor",
        },
      ],
      generatedAt: "2026-06-16 22:30:30",
    })
    await processWechatIncrementInbox({
      projectPath: tmpRoot,
      generatedAt: "2026-06-16 22:31:00",
    })

    const dryRun = await runHypothesisWatch({
      projectPath: tmpRoot,
      since: "30m",
      sources: "wechat_incremental",
      generatedAt: "2026-06-16 22:32:00",
      limit: 20,
    })

    expect(dryRun.events[0]).toMatchObject({
      hypothesisId: created.hypothesis.id,
      evidenceDelta: "catalyst_signal",
      evidenceGaps: [
        "catalyst:market_reaction:not_checked",
        "catalyst:follow_through:not_checked",
        "catalyst:second_source:not_checked",
      ],
    })
    expect(dryRun.events[0].catalystTags).toEqual(expect.arrayContaining(["台积电", "玻璃基板", "建滔/健滔", "涨价函/提价"]))
    expect(dryRun.alerts[0]).toMatchObject({
      hypothesisId: created.hypothesis.id,
      alertLevel: "important",
      evidenceDelta: "catalyst_signal",
      flags: expect.arrayContaining(["catalyst_tracking"]),
    })
  })

  it("links matched wechat signals back to related wiki pages", async () => {
    await write(
      path.join(tmpRoot, "wiki/概念/AI数据中心互联.md"),
      [
        "---",
        "title: AI数据中心互联",
        "tags: CPO, MPO, 高速连接器",
        "type: 概念",
        "summary: 数据中心互联页沉淀 CPO、MPO、高速连接器和 Scale-Up 网络的订单、量价和交付验证线索。",
        "status: 活跃",
        "confidence: 中",
        "momentum: 热",
        "updated: 2026-06-19",
        "last_reviewed: 2026-06-18 15:20:00",
        "catalysts:",
        "  - CPO节奏放缓",
        "  - MPO跳线需求",
        "related:",
        "  - \"[[概念/MPO连接器]]\"",
        "sources:",
        "  - raw/微信聊天/2026-06-19.md",
        "---",
        "# CPO 与 MPO 跟踪",
        "CPO 节奏变化会影响 MPO 高速连接器、跳线和连接器链条的短期交易弹性。",
      ].join("\n"),
    )
    await write(
      path.join(tmpRoot, "wiki/概念/AI.md"),
      [
        "---",
        "title: AI",
        "tags: AI",
        "---",
        "# AI",
        "泛 AI 页面不应该因为两个字母标题抢占具体产业链页面。",
      ].join("\n"),
    )
    await write(
      path.join(tmpRoot, "wiki/sources/2026-06-19.md"),
      [
        "---",
        "title: 2026-06-19",
        "tags: CPO, MPO, 高速连接器",
        "---",
        "# 2026-06-19",
        "源文档可以作为引用，但不应优先于概念页面。",
      ].join("\n"),
    )
    await write(
      path.join(tmpRoot, "wiki/总结/2026-06-19-微信舆情.md"),
      [
        "---",
        "title: 2026-06-19-微信舆情",
        "tags: CPO, MPO, 高速连接器",
        "---",
        "# 2026-06-19 微信舆情",
        "日期型舆情总结可以作为证据，但不应优先于概念页面。",
      ].join("\n"),
    )
    await write(
      path.join(tmpRoot, "wiki/queries/2026-06-19-CPO-MPO.md"),
      [
        "---",
        "title: 2026-06-19-CPO-MPO 查询残留",
        "tags: CPO, MPO, 高速连接器",
        "---",
        "# CPO MPO 查询残留",
        "查询残留不应该占用相关 wiki 主回连位。",
      ].join("\n"),
    )
    const created = await createHypothesis({
      projectPath: tmpRoot,
      title: "CPO节奏放缓可能提升MPO高速连接器短期订单弹性",
      theme: "AI数据中心互联",
      segments: "MPO,CPO,高速连接器",
      write: true,
    })
    await appendWechatIncrementMessages({
      projectPath: tmpRoot,
      messages: [
        {
          schema: "wechat-increment-v1",
          messageId: "wiki-link-event-1",
          chatId: "core",
          chatName: "核心群",
          senderAlias: "研究员L",
          sentAt: "2026-06-19 10:00:00",
          receivedAt: "2026-06-19 10:00:10",
          text: "CPO节奏放缓，MPO高速连接器可能有短期订单弹性，今天先看量价反馈。",
          sourceTool: "wechat-extractor",
        },
      ],
      generatedAt: "2026-06-19 10:00:30",
    })
    await processWechatIncrementInbox({
      projectPath: tmpRoot,
      generatedAt: "2026-06-19 10:01:00",
    })

    const dryRun = await runHypothesisWatch({
      projectPath: tmpRoot,
      since: "30m",
      sources: "wechat_incremental",
      generatedAt: "2026-06-19 10:02:00",
      limit: 20,
    })

    expect(dryRun.events[0]).toMatchObject({
      hypothesisId: created.hypothesis.id,
      relatedWikiPages: [
        expect.objectContaining({
          sourceRef: "wiki/概念/AI数据中心互联.md",
          title: "AI数据中心互联",
          matchedTerms: expect.arrayContaining(["CPO", "MPO", "高速连接器"]),
          wikiMeta: expect.objectContaining({
            type: "概念",
            summary: expect.stringContaining("Scale-Up"),
            status: "活跃",
            confidence: "中",
            momentum: "热",
            updated: expect.stringContaining("2026-06-19"),
            lastReviewed: expect.stringContaining("2026-06-18"),
            catalysts: expect.arrayContaining(["CPO节奏放缓", "MPO跳线需求"]),
            related: expect.arrayContaining(["[[概念/MPO连接器]]"]),
            sources: expect.arrayContaining(["raw/微信聊天/2026-06-19.md"]),
          }),
        }),
      ],
    })
    expect(dryRun.events[0].relatedWikiPages.map((page) => page.sourceRef)).not.toContain("wiki/概念/AI.md")
    const relatedRefs = dryRun.events[0].relatedWikiPages.map((page) => page.sourceRef)
    expect(relatedRefs).not.toContain("wiki/sources/2026-06-19.md")
    expect(relatedRefs).not.toContain("wiki/总结/2026-06-19-微信舆情.md")
    expect(relatedRefs).not.toContain("wiki/queries/2026-06-19-CPO-MPO.md")
    expect(dryRun.alerts[0]).toMatchObject({
      relatedWikiPages: [
        expect.objectContaining({
          sourceRef: "wiki/概念/AI数据中心互联.md",
        }),
      ],
    })
  })

  it("links unmatched catalyst candidates back to related wiki pages", async () => {
    await write(
      path.join(tmpRoot, "wiki/概念/SST固态变压器.md"),
      [
        "---",
        "title: SST固态变压器",
        "tags: 中国西电, SST, 800V",
        "---",
        "# SST / 800V 数据中心供电",
        "中国西电 SST 和 800VDC 数据中心供电是需要跟踪订单、中标和海外客户验证的方向。",
      ].join("\n"),
    )
    await appendWechatIncrementMessages({
      projectPath: tmpRoot,
      messages: [
        {
          schema: "wechat-increment-v1",
          messageId: "wiki-link-candidate-1",
          chatId: "core",
          chatName: "核心群",
          senderAlias: "研究员L",
          sentAt: "2026-06-19 10:10:00",
          receivedAt: "2026-06-19 10:10:10",
          text: "催化｜中国西电 13.8kVAC / 800VDC SST 海外订单，SST 用量翻倍预期继续扩散。",
          sourceTool: "wechat-extractor",
        },
      ],
      generatedAt: "2026-06-19 10:10:30",
    })
    await processWechatIncrementInbox({
      projectPath: tmpRoot,
      generatedAt: "2026-06-19 10:11:00",
    })

    const dryRun = await runHypothesisWatch({
      projectPath: tmpRoot,
      since: "30m",
      sources: "wechat_incremental",
      generatedAt: "2026-06-19 10:12:00",
      limit: 20,
    })

    expect(dryRun.candidateHypotheses[0]).toMatchObject({
      title: expect.stringContaining("中国西电"),
      relatedWikiPages: [
        expect.objectContaining({
          sourceRef: "wiki/概念/SST固态变压器.md",
          title: "SST固态变压器",
          matchedTerms: expect.arrayContaining(["中国西电", "SST", "800V"]),
        }),
      ],
    })
  })

  it("filters noisy wiki pages out of related watchtower backlinks", async () => {
    await write(
      path.join(tmpRoot, "wiki/概念/光通信上游涨价.md"),
      [
        "---",
        "title: 光通信上游涨价",
        "tags: 光纤, 光通信, 光通信上游, 供需紧俏",
        "---",
        "# 光纤/光通信上游涨价",
        "光纤和光通信上游材料供需紧俏时，需要跟踪涨价、交付和订单兑现。",
      ].join("\n"),
    )
    await write(
      path.join(tmpRoot, "wiki/概念/<think>.md"),
      [
        "---",
        "title: <think>",
        "tags: 光纤, 光通信, 市场, 材料",
        "---",
        "# <think>",
        "模型残留页面不应该进入投研回连。",
      ].join("\n"),
    )
    await write(
      path.join(tmpRoot, "wiki/人物/杰哥.md"),
      [
        "---",
        "title: 杰哥",
        "tags: 光纤, 光通信, 材料",
        "---",
        "# 杰哥",
        "个人或内部页面不应该抢占产业链概念页面。",
      ].join("\n"),
    )
    await write(
      path.join(tmpRoot, "wiki/概念/HVLP铜箔.md"),
      [
        "---",
        "title: HVLP铜箔",
        "tags: 市场, 材料, 涨价",
        "---",
        "# HVLP铜箔",
        "只有市场、材料、涨价这类泛词时，不应该被光通信舆情误连。",
      ].join("\n"),
    )
    await appendWechatIncrementMessages({
      projectPath: tmpRoot,
      messages: [
        {
          schema: "wechat-increment-v1",
          messageId: "wiki-link-noise-filter-1",
          chatId: "core",
          chatName: "核心群",
          senderAlias: "研究员N",
          sentAt: "2026-06-19 10:20:00",
          receivedAt: "2026-06-19 10:20:10",
          text: "**光纤/光通信上游涨价+供需紧俏｜热度：中高｜命中群：3（2026资讯",
          sourceTool: "wechat-extractor",
        },
      ],
      generatedAt: "2026-06-19 10:20:30",
    })
    await processWechatIncrementInbox({
      projectPath: tmpRoot,
      generatedAt: "2026-06-19 10:21:00",
    })

    const dryRun = await runHypothesisWatch({
      projectPath: tmpRoot,
      since: "30m",
      sources: "wechat_incremental",
      generatedAt: "2026-06-19 10:22:00",
      limit: 20,
    })
    const relatedRefs = dryRun.candidateHypotheses[0].relatedWikiPages.map((page) => page.sourceRef)

    expect(relatedRefs[0]).toBe("wiki/概念/光通信上游涨价.md")
    expect(relatedRefs).not.toContain("wiki/概念/<think>.md")
    expect(relatedRefs).not.toContain("wiki/人物/杰哥.md")
    expect(relatedRefs).not.toContain("wiki/概念/HVLP铜箔.md")
  })

  it("uses stock finance entity terms as strong wiki routes for theme-level hypothesis events", async () => {
    await createHypothesis({
      projectPath: tmpRoot,
      title: "AI硬件主线可能扩散",
      theme: "AI硬件",
      segments: "AI硬件,光模块",
      status: "watching",
      write: true,
    })
    await write(
      path.join(tmpRoot, "wiki/概念/光模块龙头资金反馈.md"),
      `${validFrontmatter("光模块龙头资金反馈", "概念", "momentum: 热\n")}# 光模块龙头资金反馈\n\n中际旭创是光模块龙头，资金反馈和订单预期是 AI 硬件主线的观察锚点。\n`,
    )
    await write(
      path.join(tmpRoot, ".llm-wiki/sag-entity-audit/full-wiki-finance-entities-test/project-entity-table.csv"),
      [
        "\uFEFF实体类型,中文名,实体名,归一名,别名,出现次数,覆盖页面数,平均置信度,代表页面,代表证据,建议动作",
        "stock,证券标的,中际旭创,中际旭创,300308 / 光模块龙头,12,6,0.94,wiki/概念/光模块龙头资金反馈.md,中际旭创资金反馈和订单预期,建议进入 SAG seed/词典",
      ].join("\n"),
    )
    await appendWechatIncrementMessages({
      projectPath: tmpRoot,
      messages: [
        {
          schema: "wechat-increment-v1",
          messageId: "stock-finance-route-1",
          chatId: "core",
          chatName: "核心群",
          senderAlias: "研究员S",
          sentAt: "2026-06-19 10:25:00",
          receivedAt: "2026-06-19 10:25:20",
          text: "AI硬件主线里，中际旭创资金反馈继续增强，先看光模块链量价承接和二次确认。",
          sourceTool: "wechat-extractor",
        },
      ],
      generatedAt: "2026-06-19 10:25:30",
    })
    await processWechatIncrementInbox({
      projectPath: tmpRoot,
      generatedAt: "2026-06-19 10:26:00",
    })

    const dryRun = await runHypothesisWatch({
      projectPath: tmpRoot,
      since: "30m",
      sources: "wechat_incremental",
      generatedAt: "2026-06-19 10:27:00",
      limit: 20,
    })

    expect(dryRun.events).toHaveLength(1)
    expect(dryRun.events[0].financeSignalEntities).toEqual(expect.arrayContaining([
      expect.objectContaining({ term: "中际旭创", type: "stock", label: "股票" }),
    ]))
    expect(dryRun.events[0].relatedWikiPages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceRef: "wiki/概念/光模块龙头资金反馈.md",
        financeAuditMatchedEntities: expect.arrayContaining([
          expect.objectContaining({ term: "中际旭创", type: "stock", label: "股票" }),
        ]),
        financeAuditMatchedTermsByType: expect.objectContaining({
          stock: expect.arrayContaining(["中际旭创"]),
        }),
      }),
    ]))
  })

  it("can LLM-review a small watch candidate set without writing status", async () => {
    const created = await createHypothesis({
      projectPath: tmpRoot,
      title: "CPO节奏放缓可能提升MPO高速连接器短期订单弹性",
      theme: "AI数据中心互联",
      segments: "MPO,CPO,高速连接器",
      status: "watching",
      write: true,
    })
    await appendWechatIncrementMessages({
      projectPath: tmpRoot,
      messages: [
        {
          schema: "wechat-increment-v1",
          messageId: "llm-review-1",
          chatId: "core",
          chatName: "核心群",
          senderAlias: "研究员E",
          sentAt: "2026-06-18 22:30:00",
          receivedAt: "2026-06-18 22:30:20",
          text: "昨晚卖方说 CPO 节奏放缓利好 MPO 高速连接器，先看明天量价和二次确认。",
          sourceTool: "wechat-extractor",
        },
      ],
      generatedAt: "2026-06-18 22:30:30",
    })
    await processWechatIncrementInbox({
      projectPath: tmpRoot,
      generatedAt: "2026-06-18 22:31:00",
    })
    const reviewAgent = vi.fn(async (input) => {
      expect(input.prompt).toContain("小批量候选")
      expect(input.prompt).toContain("llm-review-1")
      const eventId = input.prompt.match(/"itemId": "(hypoe_[^"]+)"/)?.[1]
      return JSON.stringify({
        reviews: [
          {
            itemId: eventId,
            signalType: "新催化",
            evidenceDelta: "catalyst_signal",
            suggestedStatus: "watching",
            reason: "这是 CPO 节奏放缓带来的交易催化，先跟踪量价和二次来源。",
            oneLineTradingImplication: "MPO 链先进入跟踪，不直接当成订单兑现。",
            askDeepDiveRecommended: true,
            confidence: "medium",
          },
        ],
      })
    })
    const dryRun = await runHypothesisWatch({
      projectPath: tmpRoot,
      since: "30m",
      sources: "wechat_incremental",
      generatedAt: "2026-06-18 22:32:00",
      limit: 20,
      llmReview: "auto",
      requestAgentText: reviewAgent,
    })

    expect(reviewAgent).toHaveBeenCalledTimes(1)
    expect(dryRun.llmReview).toMatchObject({
      status: "done",
      mode: "auto",
      reviewedCount: 1,
    })
    expect(dryRun.summary.reviewPipeline).toMatchObject({
      source: expect.objectContaining({
        status: "done",
        sourcesScanned: 1,
      }),
      rules: expect.objectContaining({
        status: "done",
        reviewableItems: 1,
      }),
      framework: expect.objectContaining({
        status: "done",
      }),
      llm: expect.objectContaining({
        status: "done",
        mode: "auto",
        reviewedCount: 1,
        candidateCount: 1,
      }),
    })
    expect(dryRun.events[0]).toMatchObject({
      hypothesisId: created.hypothesis.id,
      evidenceDelta: "catalyst_signal",
      signalType: "新催化",
      suggestedStatus: "watching",
      tradingImplication: "MPO 链先进入跟踪，不直接当成订单兑现。",
      askDeepDiveRecommended: true,
      llmReview: expect.objectContaining({
        reason: "这是 CPO 节奏放缓带来的交易催化，先跟踪量价和二次来源。",
      }),
    })
    expect(dryRun.alerts[0]).toMatchObject({
      evidenceDelta: "catalyst_signal",
      alertLevel: "important",
    })
    expect(JSON.parse(await read(path.join(tmpRoot, ".llm-wiki/hypotheses", `${created.hypothesis.id}.json`))).status).toBe("watching")
    await expect(fs.access(path.join(tmpRoot, ".llm-wiki/hypothesis-alerts"))).rejects.toThrow()
  })

  it("can return compact watch output for cockpit speed without losing action card context", async () => {
    const created = await createHypothesis({
      projectPath: tmpRoot,
      title: "CPO增速放缓可能推动MPO连接器量价齐升",
      theme: "AI数据中心互联",
      segments: "MPO,CPO,高速连接器",
      status: "watching",
      write: true,
      generatedAt: "2026-06-18 22:40:00",
    })
    await appendWechatIncrementMessages({
      projectPath: tmpRoot,
      messages: [
        {
          schema: "wechat-increment-v1",
          messageId: "compact-watch-1",
          chatId: "core",
          chatName: "核心群",
          senderAlias: "研究员G",
          sentAt: "2026-06-18 22:41:00",
          receivedAt: "2026-06-18 22:41:10",
          text: "CPO 节奏放缓继续扩散，MPO 高速连接器成为今日舆情新催化。",
          sourceTool: "wechat-extractor",
        },
      ],
      generatedAt: "2026-06-18 22:41:30",
    })
    await processWechatIncrementInbox({
      projectPath: tmpRoot,
      generatedAt: "2026-06-18 22:42:00",
    })

    const dryRun = await runHypothesisWatch({
      projectPath: tmpRoot,
      since: "30m",
      sources: "wechat_incremental",
      generatedAt: "2026-06-18 22:43:00",
      limit: 20,
      compact: true,
    })

    expect(dryRun.filters).toMatchObject({ compact: true })
    expect(dryRun.sources).toEqual([])
    expect(dryRun.summary).toMatchObject({
      sourcesScanned: 1,
      sourcesReturned: 0,
      compactOutput: true,
      eventsWritten: 0,
      alertsWritten: 0,
    })
    expect(dryRun.events[0]).toMatchObject({
      hypothesisId: created.hypothesis.id,
      sourceRef: expect.stringContaining(".llm-wiki/wechat-inbox/processed/"),
      sourceExcerpt: expect.stringContaining("MPO 高速连接器"),
    })
    expect(dryRun.alerts[0]).toMatchObject({
      sourceRef: dryRun.events[0].sourceRef,
      signalType: expect.any(String),
    })
  })

  it("routes tracked hypotheses through SAG finance entity segment aliases", async () => {
    await write(
      path.join(tmpRoot, "wiki/概念/CPO与MPO跟踪.md"),
      `${validFrontmatter("CPO与MPO跟踪")}# CPO与MPO跟踪\n\nMPO 光纤跳线、高速连接器和 AI 数据中心互联是同一条验证链。\n`,
    )
    await write(
      path.join(tmpRoot, ".llm-wiki/sag-entity-audit/full-wiki-finance-entities-test/project-entity-table.csv"),
      [
        "\uFEFF实体类型,中文名,实体名,归一名,别名,出现次数,覆盖页面数,平均置信度,代表页面,代表证据,建议动作",
        "product_line,产品线,MPO光纤跳线,MPO光纤跳线,MPO连接器 / MPO / 高速连接器 / 光纤跳线,12,8,0.92,wiki/概念/CPO与MPO跟踪.md,MPO光纤跳线与高速连接器同属AI数据中心互联链条,建议进入 SAG seed/词典",
        "tech_route,技术路线,CPO互联,CPO互联,CPO / 共封装光学,10,6,0.90,wiki/概念/CPO与MPO跟踪.md,CPO节奏变化会影响光互联链条节奏,建议进入 SAG seed/词典",
      ].join("\n"),
    )
    await write(
      path.join(tmpRoot, ".llm-wiki/sag-entity-audit/full-wiki-finance-entities-test/project-entity-stats.json"),
      JSON.stringify({
        processedFiles: 1,
        successfulFiles: 1,
        failedFiles: 0,
        entityRows: 2,
        typeCounts: {
          product_line: 1,
          tech_route: 1,
        },
      }, null, 2),
    )
    const created = await createHypothesis({
      projectPath: tmpRoot,
      title: "CPO节奏放缓可能推动MPO光纤跳线进入AI数据中心集采放量验证",
      theme: "AI数据中心互联",
      segments: "MPO光纤跳线,AI数据中心集采",
      status: "watching",
      write: true,
      generatedAt: "2026-06-21 09:00:00",
    })
    await appendWechatIncrementMessages({
      projectPath: tmpRoot,
      messages: [
        {
          schema: "wechat-increment-v1",
          messageId: "finance-alias-route-mpo-1",
          chatId: "core",
          chatName: "核心群",
          senderAlias: "研究员M",
          sentAt: "2026-06-21 09:10:00",
          receivedAt: "2026-06-21 09:10:10",
          text: "事件1：高速光模块放量直接带动MPO需求激增。MPO连接器是高速光模块的标准配套器件，光纤跳线采购需求扩张。",
          sourceTool: "wechat-extractor",
        },
      ],
      generatedAt: "2026-06-21 09:10:30",
    })
    await processWechatIncrementInbox({
      projectPath: tmpRoot,
      generatedAt: "2026-06-21 09:11:00",
    })

    const dryRun = await runHypothesisWatch({
      projectPath: tmpRoot,
      since: "30m",
      sources: "wechat_incremental",
      generatedAt: "2026-06-21 09:12:00",
      limit: 20,
      llmReview: "off",
      compact: true,
    })

    expect(dryRun.candidateHypotheses).toEqual([])
    expect(dryRun.events).toHaveLength(1)
    expect(dryRun.events[0]).toMatchObject({
      hypothesisId: created.hypothesis.id,
      sourceExcerpt: expect.stringContaining("MPO连接器"),
    })
    expect(dryRun.events[0].matchedEntities).toEqual(expect.arrayContaining(["MPO连接器"]))
    expect(dryRun.events[0].financeSignalEntities).toEqual(expect.arrayContaining([
      expect.objectContaining({ term: "MPO连接器", type: "product_line", label: "产品线" }),
    ]))
    expect(dryRun.summary.contextLoads).toMatchObject({
      financeEntityAudit: true,
      financeEntityAuditRows: 2,
      financeEntityAuditTableRef: expect.stringContaining("project-entity-table.csv"),
    })
  })

  it("does not route specific segment hypotheses from title-only finance acronyms", async () => {
    await write(
      path.join(tmpRoot, ".llm-wiki/sag-entity-audit/full-wiki-finance-entities-test/project-entity-table.csv"),
      [
        "\uFEFF实体类型,中文名,实体名,归一名,别名,出现次数,覆盖页面数,平均置信度,代表页面,代表证据,建议动作",
        "product_line,产品线,CPO,CPO,共封装光学,12,8,0.92,wiki/概念/CPO与MPO跟踪.md,CPO技术路线热度提升,建议进入 SAG seed/词典",
        "tech_route,技术路线,CPO互联,CPO互联,CPO / 共封装光学,10,6,0.90,wiki/概念/CPO与MPO跟踪.md,CPO节奏变化会影响光互联链条节奏,建议进入 SAG seed/词典",
        "sector,板块,CPO板块,CPO板块,CPO,8,5,0.88,wiki/概念/CPO与MPO跟踪.md,CPO板块交易热度提升,候选词典",
        "theme,主题,数据中心,数据中心,AI数据中心 / 算力中心,8,5,0.88,wiki/概念/CPO与MPO跟踪.md,数据中心是主题词但不能单独代表MPO细分,候选词典",
      ].join("\n"),
    )
    const created = await createHypothesis({
      projectPath: tmpRoot,
      title: "CPO节奏放缓可能推动MPO光纤跳线进入AI数据中心集采放量验证",
      theme: "AI数据中心互联",
      segments: "MPO光纤跳线,AI数据中心集采",
      status: "watching",
      write: true,
      generatedAt: "2026-06-21 10:00:00",
    })
    await appendWechatIncrementMessages({
      projectPath: tmpRoot,
      messages: [
        {
          schema: "wechat-increment-v1",
          messageId: "finance-title-acronym-only-1",
          chatId: "core",
          chatName: "核心群",
          senderAlias: "研究员M",
          sentAt: "2026-06-21 10:10:00",
          receivedAt: "2026-06-21 10:10:10",
          text: "CPO路线讨论升温，光模块龙头关注度继续扩散，但这条消息只停留在总路线热度。",
          sourceTool: "wechat-extractor",
        },
        {
          schema: "wechat-increment-v1",
          messageId: "finance-theme-only-1",
          chatId: "core",
          chatName: "核心群",
          senderAlias: "研究员M",
          sentAt: "2026-06-21 10:10:30",
          receivedAt: "2026-06-21 10:10:40",
          text: "下一代数据中心建设节奏继续被讨论，但这条消息没有落到具体互联物料。",
          sourceTool: "wechat-extractor",
        },
      ],
      generatedAt: "2026-06-21 10:10:30",
    })
    await processWechatIncrementInbox({
      projectPath: tmpRoot,
      generatedAt: "2026-06-21 10:11:00",
    })

    const dryRun = await runHypothesisWatch({
      projectPath: tmpRoot,
      since: "30m",
      sources: "wechat_incremental",
      generatedAt: "2026-06-21 10:12:00",
      limit: 20,
      hypothesisId: created.hypothesis.id,
      llmReview: "off",
      compact: true,
    })

    expect(dryRun.events).toEqual([])
    expect(dryRun.alerts).toEqual([])
  })

  it("does not turn dates and generic terms into pending wechat hypothesis actions", async () => {
    await createHypothesis({
      projectPath: tmpRoot,
      title: "2026-06-19",
      theme: "2026-06-19",
      segments: "建议",
      write: true,
    })
    await appendWechatIncrementMessages({
      projectPath: tmpRoot,
      messages: [
        {
          schema: "wechat-increment-v1",
          messageId: "date-noise-1",
          chatId: "core",
          chatName: "2026-06-19",
          senderAlias: "研究员F",
          sentAt: "2026-06-19 09:01:38",
          receivedAt: "2026-06-19 09:01:40",
          text: "整体公司合理市值370亿，对应当前市值近3倍空间，建议各位领导重点关注。",
          sourceTool: "wechat-extractor",
        },
      ],
      generatedAt: "2026-06-19 09:02:00",
    })
    await processWechatIncrementInbox({
      projectPath: tmpRoot,
      generatedAt: "2026-06-19 09:03:00",
    })

    const dryRun = await runHypothesisWatch({
      projectPath: tmpRoot,
      since: "30m",
      sources: "wechat_incremental",
      generatedAt: "2026-06-19 09:04:00",
      limit: 20,
    })

    expect(dryRun.events).toEqual([])
    expect(dryRun.alerts).toEqual([])
    expect(dryRun.candidateHypotheses).toEqual([])
    expect(dryRun.summary.contextLoads).toMatchObject({
      wikiIndustryTerms: false,
      wikiReferenceIndex: false,
      financeEntityAudit: false,
    })
  })

  it("extracts candidate catalyst segments from wiki industry terms", async () => {
    await write(
      path.join(tmpRoot, "wiki/概念/低介电玻纤布.md"),
      `${validFrontmatter("低介电玻纤布")}# 低介电玻纤布\n\n用于高速覆铜板和AI服务器PCB材料链。\n`,
    )
    await appendWechatIncrementMessages({
      projectPath: tmpRoot,
      messages: [
        {
          schema: "wechat-increment-v1",
          messageId: "catalyst-2",
          chatId: "core",
          chatName: "核心群",
          senderAlias: "研究员E",
          sentAt: "2026-06-16 23:10:00",
          receivedAt: "2026-06-16 23:10:10",
          text: "新增变量：台积电玻璃基板可能带动低介电玻纤布需求，先跟踪明天PCB材料链量价反应。",
          sourceTool: "wechat-extractor",
        },
      ],
      generatedAt: "2026-06-16 23:10:30",
    })
    await processWechatIncrementInbox({
      projectPath: tmpRoot,
      generatedAt: "2026-06-16 23:11:00",
    })

    const dryRun = await runHypothesisWatch({
      projectPath: tmpRoot,
      since: "30m",
      sources: "wechat_incremental",
      generatedAt: "2026-06-16 23:12:00",
      limit: 20,
    })

    expect(dryRun.events).toEqual([])
    expect(dryRun.alerts).toEqual([])
    expect(dryRun.candidateHypotheses[0]).toMatchObject({
      title: expect.stringContaining("新催化"),
      status: "seed",
      segments: expect.arrayContaining(["玻璃基板", "PCB", "低介电玻纤布"]),
      keyVariables: expect.arrayContaining(["台积电", "玻璃基板"]),
    })
    expect(dryRun.summary.contextLoads).toMatchObject({
      wikiIndustryTerms: true,
      wikiReferenceIndex: true,
      financeEntityAudit: false,
    })
  })

  it("uses SAG finance entity audit terms to route WeChat catalyst candidates", async () => {
    await write(
      path.join(tmpRoot, "wiki/概念/材料瓶颈页面.md"),
      `${validFrontmatter("材料瓶颈页面")}# 材料瓶颈页面\n\n这是一个空的材料节点占位页，相关产业词只来自实体审计表。\n`,
    )
    await write(
      path.join(tmpRoot, ".llm-wiki/sag-entity-audit/full-wiki-finance-entities-test/project-entity-table.csv"),
      [
        "\uFEFF实体类型,中文名,实体名,归一名,别名,出现次数,覆盖页面数,平均置信度,代表页面,代表证据,建议动作",
        "product_line,产品线,HVLP铜箔,hvlp铜箔,极低轮廓铜箔 / 高速铜箔,12,8,0.92,wiki/概念/材料瓶颈页面.md,HVLP铜箔供需缺口与认证壁垒,建议进入 SAG seed/词典",
        "catalyst,催化事件,批量订单,批量订单,,9,9,0.91,wiki/概念/材料瓶颈页面.md,客户认证通过后出现批量订单,建议进入 SAG seed/词典",
        "stock,证券标的,极低轮廓铜箔,极低轮廓铜箔,,5,5,0.88,wiki/股票/噪声标的页.md,同名实体在其他页面不应污染材料页类型,类型冲突待确认",
        "company,公司,诺德股份,诺德股份,诺德,6,6,0.90,wiki/股票/诺德股份.md,HVLP铜箔送样与客户验证,候选词典",
      ].join("\n"),
    )
    await write(
      path.join(tmpRoot, ".llm-wiki/sag-entity-audit/full-wiki-finance-entities-test/project-entity-stats.json"),
      JSON.stringify({
        processedFiles: 3,
        successfulFiles: 3,
        failedFiles: 0,
        entityRows: 3,
        typeCounts: {
          product_line: 1,
          catalyst: 1,
          company: 1,
        },
      }, null, 2),
    )
    await appendWechatIncrementMessages({
      projectPath: tmpRoot,
      messages: [
        {
          schema: "wechat-increment-v1",
          messageId: "finance-entity-audit-catalyst-1",
          chatId: "core",
          chatName: "核心群",
          senderAlias: "研究员K",
          sentAt: "2026-06-20 09:10:00",
          receivedAt: "2026-06-20 09:10:10",
          text: "新增变量：海外客户对极低轮廓铜箔批量订单和价格函加速，先看诺德股份和高端电子铜箔量价反应。",
          sourceTool: "wechat-extractor",
        },
      ],
      generatedAt: "2026-06-20 09:10:30",
    })
    await processWechatIncrementInbox({
      projectPath: tmpRoot,
      generatedAt: "2026-06-20 09:11:00",
    })

    const dryRun = await runHypothesisWatch({
      projectPath: tmpRoot,
      since: "30m",
      sources: "wechat_incremental",
      generatedAt: "2026-06-20 09:12:00",
      limit: 20,
    })

    expect(dryRun.candidateHypotheses).toHaveLength(1)
    const candidate = dryRun.candidateHypotheses[0]
    expect(candidate).toMatchObject({
      title: expect.stringContaining("极低轮廓铜箔批量订单"),
      status: "seed",
    })
    expect(candidate.segments).toEqual(expect.arrayContaining(["极低轮廓铜箔", "批量订单", "诺德股份"]))
    expect(candidate.financeSignalEntities).toEqual(expect.arrayContaining([
      expect.objectContaining({ term: "诺德股份", type: "company", label: "公司" }),
      expect.objectContaining({ term: "极低轮廓铜箔", type: "product_line", label: "产品线" }),
      expect.objectContaining({ term: "批量订单", type: "catalyst", label: "催化" }),
    ]))
    expect(candidate.financeAuditMatchedTermsByType).toMatchObject({
      company: expect.arrayContaining(["诺德股份"]),
      product_line: expect.arrayContaining(["极低轮廓铜箔"]),
      catalyst: expect.arrayContaining(["批量订单"]),
    })
    expect(candidate.relatedWikiPages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceRef: "wiki/概念/材料瓶颈页面.md",
        matchedTerms: expect.arrayContaining(["极低轮廓铜箔"]),
        financeAuditMatchedTerms: expect.arrayContaining(["极低轮廓铜箔"]),
        financeAuditMatchedEntities: expect.arrayContaining([
          expect.objectContaining({
            term: "极低轮廓铜箔",
            type: "product_line",
            label: "产品线",
          }),
        ]),
        financeAuditMatchedTermsByType: expect.objectContaining({
          product_line: expect.arrayContaining(["极低轮廓铜箔"]),
        }),
      }),
    ]))
    const materialPage = candidate.relatedWikiPages.find((page) => page.sourceRef === "wiki/概念/材料瓶颈页面.md")
    expect(materialPage).toBeTruthy()
    expect(materialPage.financeAuditMatchedEntities).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        term: "极低轮廓铜箔",
        type: "stock",
      }),
    ]))
    expect(candidate.relatedWikiPages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceRef: "wiki/概念/材料瓶颈页面.md",
        matchedTerms: expect.arrayContaining(["批量订单"]),
        financeAuditMatchedTerms: expect.arrayContaining(["批量订单"]),
        financeAuditMatchedEntities: expect.arrayContaining([
          expect.objectContaining({
            term: "批量订单",
            type: "catalyst",
            label: "催化",
          }),
        ]),
        financeAuditMatchedTermsByType: expect.objectContaining({
          catalyst: expect.arrayContaining(["批量订单"]),
        }),
      }),
    ]))
    expect(dryRun.summary.contextLoads).toMatchObject({
      wikiIndustryTerms: true,
      wikiReferenceIndex: true,
      financeEntityAudit: true,
      financeEntityAuditRows: 4,
      financeEntityAuditTableRef: expect.stringContaining("project-entity-table.csv"),
      financeEntityAuditTypeCounts: expect.objectContaining({
        product_line: 1,
        catalyst: 1,
        company: 1,
      }),
    })
  })

  it("deduplicates candidate segments case-insensitively when SAG terms repeat known acronyms", async () => {
    await write(
      path.join(tmpRoot, "wiki/概念/PCB材料链.md"),
      `${validFrontmatter("PCB材料链")}# PCB材料链\n\nPCB、层压机和载板厂是 AI 服务器材料链的跟踪框架。\n`,
    )
    await write(
      path.join(tmpRoot, ".llm-wiki/sag-entity-audit/full-wiki-finance-entities-test/project-entity-table.csv"),
      [
        "\uFEFF实体类型,中文名,实体名,归一名,别名,出现次数,覆盖页面数,平均置信度,代表页面,代表证据,建议动作",
        "product_line,产品线,PCB,pcb,Printed Circuit Board,20,12,0.94,wiki/概念/PCB材料链.md,PCB材料链高频出现,建议进入 SAG seed/词典",
        "product_line,产品线,层压机,层压机,,8,5,0.88,wiki/概念/PCB材料链.md,层压机交期拉长,建议进入 SAG seed/词典",
      ].join("\n"),
    )
    await appendWechatIncrementMessages({
      projectPath: tmpRoot,
      messages: [{
        schema: "wechat-increment-v1",
        messageId: "finance-segment-case-dedupe-1",
        chatId: "core",
        chatName: "核心群",
        senderAlias: "研究员P",
        sentAt: "2026-06-20 10:10:00",
        receivedAt: "2026-06-20 10:10:10",
        text: "新增变量：PCB 材料链出现涨价函，层压机交期拉长，先看载板厂和 PCB 量价扩散。",
        sourceTool: "wechat-extractor",
      }],
      generatedAt: "2026-06-20 10:10:30",
    })
    await processWechatIncrementInbox({
      projectPath: tmpRoot,
      generatedAt: "2026-06-20 10:11:00",
    })

    const dryRun = await runHypothesisWatch({
      projectPath: tmpRoot,
      since: "30m",
      sources: "wechat_incremental",
      generatedAt: "2026-06-20 10:12:00",
      limit: 20,
    })

    expect(dryRun.candidateHypotheses).toHaveLength(1)
    const segments = dryRun.candidateHypotheses[0].segments
    expect(segments).toEqual(expect.arrayContaining(["PCB", "层压机"]))
    expect(segments.filter((segment) => String(segment).toLowerCase() === "pcb")).toHaveLength(1)
  })

  it("does not promote embedded stock alias acronyms into standalone finance stock terms", async () => {
    await write(
      path.join(tmpRoot, "wiki/概念/DCI光互联.md"),
      `${validFrontmatter("DCI光互联")}# DCI光互联\n\nDCI、光缆和数据中心互联是当前观察框架。\n`,
    )
    await write(
      path.join(tmpRoot, "wiki/概念/PCB材料链.md"),
      `${validFrontmatter("PCB材料链")}# PCB材料链\n\nPCB、层压机和载板厂是 AI 服务器材料链的跟踪框架。\n`,
    )
    await write(
      path.join(tmpRoot, ".llm-wiki/sag-entity-audit/full-wiki-finance-entities-test/project-entity-table.csv"),
      [
        "\uFEFF实体类型,中文名,实体名,归一名,别名,出现次数,覆盖页面数,平均置信度,代表页面,代表证据,建议动作",
        ...Array.from({ length: 650 }, (_, index) => (
          `product_line,产品线,高频泛产品${index},高频泛产品${index},,999,999,0.90,wiki/概念/泛产品${index}.md,高频泛产品噪声,候选词典`
        )),
        "stock,证券标的,德科立,德科立,688205 / Google DCI滚动下单 / SH688205,9,9,0.94,wiki/股票/德科立.md,德科立 DCI 订单线索,类型冲突待确认",
        "stock,证券标的,南电,南电,南亚电路板 / Nan Ya PCB,8,8,0.93,wiki/股票/南电.md,南电 PCB 线索,类型冲突待确认",
        "product_line,产品线,TOP,top,Top / TOP,999,999,0.90,wiki/概念/泛产品.md,国内 Top 厂商语气词噪声,候选词典",
        "product_line,产品线,DCI,dci,数据中心互联 / Data Center Interconnect,12,10,0.92,wiki/概念/DCI光互联.md,DCI光缆价格催化,建议进入 SAG seed/词典",
        "product_line,产品线,PCB,pcb,Printed Circuit Board,20,12,0.94,wiki/概念/PCB材料链.md,PCB材料链高频出现,建议进入 SAG seed/词典",
        "catalyst,催化事件,涨价函,涨价函,提价函 / Price Increase Notice,10,8,0.91,wiki/概念/PCB材料链.md,涨价函催化,建议进入 SAG seed/词典",
      ].join("\n"),
    )
    await appendWechatIncrementMessages({
      projectPath: tmpRoot,
      messages: [{
        schema: "wechat-increment-v1",
        messageId: "finance-stock-alias-acronym-1",
        chatId: "core",
        chatName: "核心群",
        senderAlias: "研究员P",
        sentAt: "2026-06-20 10:20:00",
        receivedAt: "2026-06-20 10:20:10",
        text: "新增变量：藤仓 DCI 光缆涨价 30%，国内 Top 载板厂跟进，PCB 材料链也出现涨价函，先看数据中心互联和上游材料量价反馈。",
        sourceTool: "wechat-extractor",
      }],
      generatedAt: "2026-06-20 10:20:30",
    })
    await processWechatIncrementInbox({
      projectPath: tmpRoot,
      generatedAt: "2026-06-20 10:21:00",
    })

    const dryRun = await runHypothesisWatch({
      projectPath: tmpRoot,
      since: "30m",
      sources: "wechat_incremental",
      generatedAt: "2026-06-20 10:22:00",
      limit: 20,
    })

    expect(dryRun.candidateHypotheses).toHaveLength(1)
    const entities = dryRun.candidateHypotheses[0].financeSignalEntities
    expect(entities).toEqual(expect.arrayContaining([
      expect.objectContaining({ term: "DCI", type: "product_line", label: "产品线" }),
      expect.objectContaining({ term: "PCB", type: "product_line", label: "产品线" }),
      expect.objectContaining({ term: "涨价函", type: "catalyst", label: "催化" }),
    ]))
    expect(entities).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ term: "DCI", type: "stock" }),
      expect.objectContaining({ term: "PCB", type: "stock" }),
      expect.objectContaining({ term: "TOP", type: "product_line" }),
    ]))
    expect(entities.filter((entity) => String(entity.term).toLowerCase() === "pcb" && entity.type === "product_line")).toHaveLength(1)
  })

  it("keeps catalyst finance entities visible when many product terms match the same source", async () => {
    await write(
      path.join(tmpRoot, "wiki/概念/多产品涨价链.md"),
      `${validFrontmatter("多产品涨价链")}# 多产品涨价链\n\n多条产品线同时出现时，涨价函仍然是状态判断核心。\n`,
    )
    const productRows = Array.from({ length: 18 }, (_, index) => (
      `product_line,产品线,材料品类${index},材料品类${index},,20,10,0.92,wiki/概念/多产品涨价链.md,材料品类${index} 供应紧张,建议进入 SAG seed/词典`
    ))
    await write(
      path.join(tmpRoot, ".llm-wiki/sag-entity-audit/full-wiki-finance-entities-test/project-entity-table.csv"),
      [
        "\uFEFF实体类型,中文名,实体名,归一名,别名,出现次数,覆盖页面数,平均置信度,代表页面,代表证据,建议动作",
        ...productRows,
        "catalyst,催化事件,涨价函,涨价函,提价函 / 调价函,10,8,0.91,wiki/概念/多产品涨价链.md,涨价函催化,建议进入 SAG seed/词典",
      ].join("\n"),
    )
    await appendWechatIncrementMessages({
      projectPath: tmpRoot,
      messages: [{
        schema: "wechat-increment-v1",
        messageId: "finance-catalyst-visibility-1",
        chatId: "core",
        chatName: "核心群",
        senderAlias: "研究员P",
        sentAt: "2026-06-20 10:30:00",
        receivedAt: "2026-06-20 10:30:10",
        text: `新增变量：${Array.from({ length: 18 }, (_, index) => `材料品类${index}`).join("、")} 同时出现涨价函，先看量价反馈。`,
        sourceTool: "wechat-extractor",
      }],
      generatedAt: "2026-06-20 10:30:30",
    })
    await processWechatIncrementInbox({
      projectPath: tmpRoot,
      generatedAt: "2026-06-20 10:31:00",
    })

    const dryRun = await runHypothesisWatch({
      projectPath: tmpRoot,
      since: "30m",
      sources: "wechat_incremental",
      generatedAt: "2026-06-20 10:32:00",
      limit: 20,
    })

    expect(dryRun.candidateHypotheses).toHaveLength(1)
    const entities = dryRun.candidateHypotheses[0].financeSignalEntities
    expect(entities).toEqual(expect.arrayContaining([
      expect.objectContaining({ term: "涨价函", type: "catalyst", label: "催化" }),
    ]))
    expect(entities.filter((entity) => entity.type === "product_line").length).toBeLessThanOrEqual(5)
  })

  it("filters generic industry acronyms out of catalyst risk and trade-pattern signal types", async () => {
    await write(
      path.join(tmpRoot, "wiki/概念/实体类型冲突页.md"),
      `${validFrontmatter("实体类型冲突页")}# 实体类型冲突页\n\nCPO 和 PCB 是产业词，不应只因类型冲突变成催化、风险或交易模式。\n`,
    )
    await write(
      path.join(tmpRoot, ".llm-wiki/sag-entity-audit/full-wiki-finance-entities-test/project-entity-table.csv"),
      [
        "\uFEFF实体类型,中文名,实体名,归一名,别名,出现次数,覆盖页面数,平均置信度,代表页面,代表证据,建议动作",
        "product_line,产品线,CPO,cpo,共封装光学,20,10,0.92,wiki/概念/实体类型冲突页.md,CPO 产业词,建议进入 SAG seed/词典",
        "catalyst,催化事件,CPO,cpo,,18,9,0.88,wiki/概念/实体类型冲突页.md,CPO 类型冲突噪声,类型冲突待确认",
        "risk_factor,风险因子,PCB,pcb,,18,9,0.88,wiki/概念/实体类型冲突页.md,PCB 类型冲突噪声,类型冲突待确认",
        "trade_pattern,交易模式,PCB,pcb,,18,9,0.88,wiki/概念/实体类型冲突页.md,PCB 类型冲突噪声,类型冲突待确认",
        "catalyst,催化事件,业绩上修,业绩上修,指引上修,8,5,0.91,wiki/概念/实体类型冲突页.md,业绩上修是有效催化,建议进入 SAG seed/词典",
      ].join("\n"),
    )
    await appendWechatIncrementMessages({
      projectPath: tmpRoot,
      messages: [{
        schema: "wechat-increment-v1",
        messageId: "finance-signal-type-conflict-1",
        chatId: "core",
        chatName: "核心群",
        senderAlias: "研究员P",
        sentAt: "2026-06-20 10:40:00",
        receivedAt: "2026-06-20 10:40:10",
        text: "新增变量：CPO 和 PCB 舆情继续扩散，但真正催化是业绩上修，先看量价反馈。",
        sourceTool: "wechat-extractor",
      }],
      generatedAt: "2026-06-20 10:40:30",
    })
    await processWechatIncrementInbox({
      projectPath: tmpRoot,
      generatedAt: "2026-06-20 10:41:00",
    })

    const dryRun = await runHypothesisWatch({
      projectPath: tmpRoot,
      since: "30m",
      sources: "wechat_incremental",
      generatedAt: "2026-06-20 10:42:00",
      limit: 20,
    })

    expect(dryRun.candidateHypotheses).toHaveLength(1)
    const entities = dryRun.candidateHypotheses[0].financeSignalEntities
    expect(entities).toEqual(expect.arrayContaining([
      expect.objectContaining({ term: "CPO", type: "product_line", label: "产品线" }),
      expect.objectContaining({ term: "业绩上修", type: "catalyst", label: "催化" }),
    ]))
    expect(entities).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ term: "CPO", type: "catalyst" }),
      expect.objectContaining({ term: "PCB", type: "risk_factor" }),
      expect.objectContaining({ term: "PCB", type: "trade_pattern" }),
    ]))
  })

  it("deduplicates mixed English Chinese finance signal terms case-insensitively", async () => {
    await write(
      path.join(tmpRoot, "wiki/概念/DCI光缆涨价.md"),
      `${validFrontmatter("DCI光缆涨价")}# DCI光缆涨价\n\nDCI 光缆涨价是数据中心互联链条的催化。\n`,
    )
    await write(
      path.join(tmpRoot, ".llm-wiki/sag-entity-audit/full-wiki-finance-entities-test/project-entity-table.csv"),
      [
        "\uFEFF实体类型,中文名,实体名,归一名,别名,出现次数,覆盖页面数,平均置信度,代表页面,代表证据,建议动作",
        "catalyst,催化事件,dci 光缆涨价,dci 光缆涨价,,10,8,0.91,wiki/概念/DCI光缆涨价.md,小写缩写版本,候选词典",
        "catalyst,催化事件,DCI 光缆涨价,DCI 光缆涨价,,9,7,0.90,wiki/概念/DCI光缆涨价.md,大写缩写版本,候选词典",
        "product_line,产品线,DCI,dci,数据中心互联,12,10,0.92,wiki/概念/DCI光缆涨价.md,DCI产品线,建议进入 SAG seed/词典",
      ].join("\n"),
    )
    await appendWechatIncrementMessages({
      projectPath: tmpRoot,
      messages: [{
        schema: "wechat-increment-v1",
        messageId: "finance-signal-case-dedupe-1",
        chatId: "core",
        chatName: "核心群",
        senderAlias: "研究员P",
        sentAt: "2026-06-20 10:50:00",
        receivedAt: "2026-06-20 10:50:10",
        text: "新增变量：藤仓 DCI 光缆涨价 30%，先看数据中心互联链条反馈。",
        sourceTool: "wechat-extractor",
      }],
      generatedAt: "2026-06-20 10:50:30",
    })
    await processWechatIncrementInbox({
      projectPath: tmpRoot,
      generatedAt: "2026-06-20 10:51:00",
    })

    const dryRun = await runHypothesisWatch({
      projectPath: tmpRoot,
      since: "30m",
      sources: "wechat_incremental",
      generatedAt: "2026-06-20 10:52:00",
      limit: 20,
    })

    expect(dryRun.candidateHypotheses).toHaveLength(1)
    const entities = dryRun.candidateHypotheses[0].financeSignalEntities
    expect(entities.filter((entity) => entity.type === "catalyst" && String(entity.term).toLowerCase() === "dci 光缆涨价")).toHaveLength(1)
  })

  it("can use an external SAG finance entity audit root when the selected project has no local audit table", async () => {
    await write(
      path.join(tmpRoot, "wiki/概念/外部词表材料页.md"),
      `${validFrontmatter("外部词表材料页")}# 外部词表材料页\n\n这是一个依赖外部金融关键词表的材料节点。\n`,
    )
    const externalAuditRoot = path.join(tmpRoot, "external-finance-audit")
    await write(
      path.join(externalAuditRoot, "project-entity-table.csv"),
      [
        "\uFEFF实体类型,中文名,实体名,归一名,别名,出现次数,覆盖页面数,平均置信度,代表页面,代表证据,建议动作",
        "product_line,产品线,HVLP铜箔,hvlp铜箔,极低轮廓铜箔 / 高速铜箔,12,8,0.92,wiki/概念/外部词表材料页.md,HVLP铜箔供需缺口与认证壁垒,建议进入 SAG seed/词典",
        "catalyst,催化事件,批量订单,批量订单,,9,9,0.91,wiki/概念/外部词表材料页.md,客户认证通过后出现批量订单,建议进入 SAG seed/词典",
      ].join("\n"),
    )
    await write(
      path.join(externalAuditRoot, "project-entity-stats.json"),
      JSON.stringify({
        processedFiles: 2,
        successfulFiles: 2,
        failedFiles: 0,
        entityRows: 2,
        typeCounts: {
          product_line: 1,
          catalyst: 1,
        },
      }, null, 2),
    )
    await appendWechatIncrementMessages({
      projectPath: tmpRoot,
      messages: [
        {
          schema: "wechat-increment-v1",
          messageId: "external-finance-root-1",
          chatId: "core",
          chatName: "核心群",
          senderAlias: "研究员K",
          sentAt: "2026-06-20 09:20:00",
          receivedAt: "2026-06-20 09:20:10",
          text: "新增变量：海外客户对极低轮廓铜箔批量订单和价格函加速，先看高端电子铜箔量价反应。",
          sourceTool: "wechat-extractor",
        },
      ],
      generatedAt: "2026-06-20 09:20:30",
    })
    await processWechatIncrementInbox({
      projectPath: tmpRoot,
      generatedAt: "2026-06-20 09:21:00",
    })

    const dryRun = await runHypothesisWatch({
      projectPath: tmpRoot,
      since: "30m",
      sources: "wechat_incremental",
      generatedAt: "2026-06-20 09:22:00",
      limit: 20,
      financeEntityAuditRoots: externalAuditRoot,
    })

    expect(dryRun.candidateHypotheses).toHaveLength(1)
    expect(dryRun.candidateHypotheses[0]).toMatchObject({
      title: expect.stringContaining("极低轮廓铜箔批量订单"),
      relatedWikiPages: expect.arrayContaining([
        expect.objectContaining({
          sourceRef: "wiki/概念/外部词表材料页.md",
          financeAuditMatchedTerms: expect.arrayContaining(["极低轮廓铜箔", "批量订单"]),
          financeAuditMatchedTermsByType: expect.objectContaining({
            product_line: expect.arrayContaining(["极低轮廓铜箔"]),
            catalyst: expect.arrayContaining(["批量订单"]),
          }),
        }),
      ]),
    })
    expect(dryRun.summary.contextLoads).toMatchObject({
      financeEntityAudit: true,
      financeEntityAuditRows: 2,
      financeEntityAuditTableRef: "external-finance-audit/project-entity-table.csv",
      financeEntityAuditTypeCounts: expect.objectContaining({
        product_line: 1,
        catalyst: 1,
      }),
    })
  })

  it("falls back to the default SAG finance entity audit root for CLI-side keyword routing", async () => {
    await write(
      path.join(tmpRoot, "wiki/概念/默认词表材料页.md"),
      `${validFrontmatter("默认词表材料页")}# 默认词表材料页\n\n这是一个依赖默认金融关键词表的材料节点。\n`,
    )
    const defaultAuditRoot = path.join(tmpRoot, "default-finance-audit")
    await write(
      path.join(defaultAuditRoot, "project-entity-table.csv"),
      [
        "\uFEFF实体类型,中文名,实体名,归一名,别名,出现次数,覆盖页面数,平均置信度,代表页面,代表证据,建议动作",
        "product_line,产品线,低损耗树脂,低损耗树脂,PPO树脂 / PTFE树脂,13,9,0.93,wiki/概念/默认词表材料页.md,低损耗树脂涨价和交付紧张,建议进入 SAG seed/词典",
        "catalyst,催化事件,涨价函,涨价函,提价函 / 调价函,8,6,0.91,wiki/概念/默认词表材料页.md,供应商涨价函催化,建议进入 SAG seed/词典",
      ].join("\n"),
    )
    await write(
      path.join(defaultAuditRoot, "project-entity-stats.json"),
      JSON.stringify({
        processedFiles: 2,
        successfulFiles: 2,
        failedFiles: 0,
        entityRows: 2,
        typeCounts: {
          product_line: 1,
          catalyst: 1,
        },
      }, null, 2),
    )
    await appendWechatIncrementMessages({
      projectPath: tmpRoot,
      messages: [
        {
          schema: "wechat-increment-v1",
          messageId: "default-finance-root-1",
          chatId: "core",
          chatName: "核心群",
          senderAlias: "研究员R",
          sentAt: "2026-06-20 09:30:00",
          receivedAt: "2026-06-20 09:30:10",
          text: "新增变量：AI服务器 PCB 上游低损耗树脂出现涨价函，先看高频高速材料链量价反应。",
          sourceTool: "wechat-extractor",
        },
      ],
      generatedAt: "2026-06-20 09:30:30",
    })
    await processWechatIncrementInbox({
      projectPath: tmpRoot,
      generatedAt: "2026-06-20 09:31:00",
    })

    const dryRun = await runHypothesisWatch({
      projectPath: tmpRoot,
      since: "30m",
      sources: "wechat_incremental",
      generatedAt: "2026-06-20 09:32:00",
      limit: 20,
      defaultFinanceEntityAuditRoots: defaultAuditRoot,
    })

    expect(dryRun.candidateHypotheses).toHaveLength(1)
    expect(dryRun.candidateHypotheses[0]).toMatchObject({
      title: expect.stringContaining("低损耗树脂"),
      relatedWikiPages: expect.arrayContaining([
        expect.objectContaining({
          sourceRef: "wiki/概念/默认词表材料页.md",
          financeAuditMatchedTerms: expect.arrayContaining(["低损耗树脂", "涨价函"]),
          financeAuditMatchedTermsByType: expect.objectContaining({
            product_line: expect.arrayContaining(["低损耗树脂"]),
            catalyst: expect.arrayContaining(["涨价函"]),
          }),
        }),
      ]),
    })
    expect(dryRun.summary.contextLoads).toMatchObject({
      financeEntityAudit: true,
      financeEntityAuditRows: 2,
      financeEntityAuditTableRef: "default-finance-audit/project-entity-table.csv",
      financeEntityAuditTypeCounts: expect.objectContaining({
        product_line: 1,
        catalyst: 1,
      }),
    })
  })

  it("prefers the largest complete SAG finance entity audit table over a newer small sample", async () => {
    await write(
      path.join(tmpRoot, "wiki/概念/全量词表材料页.md"),
      `${validFrontmatter("全量词表材料页")}# 全量词表材料页\n\n这是一个依赖全量金融关键词表的材料节点。\n`,
    )
    const defaultAuditRoot = path.join(tmpRoot, "default-finance-audit")
    const fullAuditRoot = path.join(defaultAuditRoot, "full-wiki-finance-entities-20260623")
    const sampleAuditRoot = path.join(defaultAuditRoot, "human-feedback-sample")
    await write(
      path.join(fullAuditRoot, "project-entity-table.csv"),
      [
        "\uFEFF实体类型,中文名,实体名,归一名,别名,出现次数,覆盖页面数,平均置信度,代表页面,代表证据,建议动作",
        "product_line,产品线,原始噪声词,原始噪声词,,99,80,0.88,wiki/概念/噪声页.md,原始表未清洗噪声,类型冲突待确认",
        "catalyst,催化事件,低损耗树脂,低损耗树脂,,99,80,0.88,wiki/概念/噪声页.md,原始表类型冲突噪声,类型冲突待确认",
      ].join("\n"),
    )
    await write(
      path.join(fullAuditRoot, "generalized-cleaned-entity-table.csv"),
      [
        "\uFEFF实体类型,中文名,实体名,归一名,别名,出现次数,覆盖页面数,平均置信度,代表页面,代表证据,建议动作",
        "product_line,产品线,低损耗树脂,低损耗树脂,PPO树脂 / PTFE树脂,13,9,0.93,wiki/概念/全量词表材料页.md,低损耗树脂涨价和交付紧张,建议进入 SAG seed/词典",
        "catalyst,催化事件,涨价函,涨价函,提价函 / 调价函,8,6,0.91,wiki/概念/全量词表材料页.md,供应商涨价函催化,建议进入 SAG seed/词典",
      ].join("\n"),
    )
    await write(
      path.join(fullAuditRoot, "project-entity-stats.json"),
      JSON.stringify({
        processedFiles: 2996,
        successfulFiles: 2996,
        failedFiles: 0,
        entityRows: 22037,
        typeCounts: {
          product_line: 3176,
          catalyst: 2448,
        },
      }, null, 2),
    )
    await write(
      path.join(sampleAuditRoot, "project-entity-table.csv"),
      [
        "\uFEFF实体类型,中文名,实体名,归一名,别名,出现次数,覆盖页面数,平均置信度,代表页面,代表证据,建议动作",
        "product_line,产品线,样本噪声词,样本噪声词,,1,1,0.80,wiki/概念/样本页.md,人工反馈样本,人工确认",
      ].join("\n"),
    )
    await write(
      path.join(sampleAuditRoot, "project-entity-stats.json"),
      JSON.stringify({
        processedFiles: 5,
        successfulFiles: 5,
        failedFiles: 0,
        entityRows: 1,
        typeCounts: {
          product_line: 1,
        },
      }, null, 2),
    )
    await appendWechatIncrementMessages({
      projectPath: tmpRoot,
      messages: [
        {
          schema: "wechat-increment-v1",
          messageId: "default-finance-root-largest-1",
          chatId: "core",
          chatName: "核心群",
          senderAlias: "研究员R",
          sentAt: "2026-06-20 09:40:00",
          receivedAt: "2026-06-20 09:40:10",
          text: "新增变量：AI服务器 PCB 上游低损耗树脂出现涨价函，先看高频高速材料链量价反应。",
          sourceTool: "wechat-extractor",
        },
      ],
      generatedAt: "2026-06-20 09:40:30",
    })
    await processWechatIncrementInbox({
      projectPath: tmpRoot,
      generatedAt: "2026-06-20 09:41:00",
    })

    const dryRun = await runHypothesisWatch({
      projectPath: tmpRoot,
      since: "30m",
      sources: "wechat_incremental",
      generatedAt: "2026-06-20 09:42:00",
      limit: 20,
      defaultFinanceEntityAuditRoots: defaultAuditRoot,
    })

    expect(dryRun.candidateHypotheses).toHaveLength(1)
    expect(dryRun.candidateHypotheses[0]).toMatchObject({
      title: expect.stringContaining("低损耗树脂"),
      financeSignalEntities: expect.arrayContaining([
        expect.objectContaining({ term: "低损耗树脂", type: "product_line", label: "产品线" }),
        expect.objectContaining({ term: "涨价函", type: "catalyst", label: "催化" }),
      ]),
    })
    expect(dryRun.summary.contextLoads).toMatchObject({
      financeEntityAudit: true,
      financeEntityAuditRows: 2,
      financeEntityAuditTableRef: "default-finance-audit/full-wiki-finance-entities-20260623/generalized-cleaned-entity-table.csv",
      financeEntityAuditTypeCounts: expect.objectContaining({
        product_line: 3176,
        catalyst: 2448,
      }),
    })
  })

  it("keeps lower-count finance entity types from being crowded out by high-frequency generic terms", async () => {
    await write(
      path.join(tmpRoot, "wiki/概念/半导体特气供给扰动.md"),
      `${validFrontmatter("半导体特气供给扰动")}# 半导体特气供给扰动\n\n六氟化钨供给扰动、长协和国产替代是核心观察项。\n`,
    )
    const noisyRows = Array.from({ length: 3305 }, (_, index) => (
      `catalyst,催化事件,泛催化词${index},泛催化词${index},,999,999,0.90,wiki/概念/噪声${index}.md,泛化高频催化词,候选词典`
    ))
    await write(
      path.join(tmpRoot, ".llm-wiki/sag-entity-audit/full-wiki-finance-entities-test/project-entity-table.csv"),
      [
        "\uFEFF实体类型,中文名,实体名,归一名,别名,出现次数,覆盖页面数,平均置信度,代表页面,代表证据,建议动作",
        ...noisyRows,
        "product_line,产品线,六氟化钨,六氟化钨,WF6 / 高纯六氟化钨,1,1,0.95,wiki/概念/半导体特气供给扰动.md,六氟化钨供给扰动与长协验证,建议进入 SAG seed/词典",
      ].join("\n"),
    )
    await appendWechatIncrementMessages({
      projectPath: tmpRoot,
      messages: [
        {
          schema: "wechat-increment-v1",
          messageId: "finance-entity-type-quota-1",
          chatId: "core",
          chatName: "核心群",
          senderAlias: "研究员N",
          sentAt: "2026-06-20 12:10:00",
          receivedAt: "2026-06-20 12:10:10",
          text: "新增变量：六氟化钨长协和海外供给扰动继续发酵，先看半导体特气国产替代和相关标的量价反馈。",
          sourceTool: "wechat-extractor",
        },
      ],
      generatedAt: "2026-06-20 12:10:30",
    })
    await processWechatIncrementInbox({
      projectPath: tmpRoot,
      generatedAt: "2026-06-20 12:11:00",
    })

    const dryRun = await runHypothesisWatch({
      projectPath: tmpRoot,
      since: "30m",
      sources: "wechat_incremental",
      generatedAt: "2026-06-20 12:12:00",
      limit: 20,
    })

    expect(dryRun.candidateHypotheses).toHaveLength(1)
    expect(dryRun.candidateHypotheses[0]).toMatchObject({
      title: expect.stringContaining("六氟化钨"),
      segments: expect.arrayContaining(["六氟化钨"]),
      relatedWikiPages: expect.arrayContaining([
        expect.objectContaining({
        sourceRef: "wiki/概念/半导体特气供给扰动.md",
        matchedTerms: expect.arrayContaining(["六氟化钨"]),
        financeAuditMatchedTerms: expect.arrayContaining(["六氟化钨"]),
      }),
      ]),
    })
  })

  it("keeps candidate segments focused on the catalyst sentence instead of broad document background terms", async () => {
    await fs.rm(path.join(tmpRoot, "raw/研报新闻/2026-05-28-AI服务器电源.md"), { force: true })
    await write(
      path.join(tmpRoot, "wiki/概念/半导体特气供给扰动.md"),
      `${validFrontmatter("半导体特气供给扰动")}# 半导体特气供给扰动\n\n六氟化钨供给扰动、长协和国产替代是核心观察项。\n`,
    )
    await write(
      path.join(tmpRoot, ".llm-wiki/sag-entity-audit/full-wiki-finance-entities-test/project-entity-table.csv"),
      [
        "\uFEFF实体类型,中文名,实体名,归一名,别名,出现次数,覆盖页面数,平均置信度,代表页面,代表证据,建议动作",
        "product_line,产品线,六氟化钨,六氟化钨,WF6 / 高纯六氟化钨,10,8,0.95,wiki/概念/半导体特气供给扰动.md,六氟化钨供给扰动与长协验证,建议进入 SAG seed/词典",
        "product_line,产品线,六氟化钨查询噪声,六氟化钨,WF6,9,7,0.90,wiki/查询/六氟化钨查询记录.md,查询页不应作为投研框架,类型冲突待确认",
        "metric,指标,长协,长协,,8,6,0.88,wiki/查询/六氟化钨查询记录.md,查询页不应作为投研框架,类型冲突待确认",
        "risk_factor,风险因子,海外供给扰动,海外供给扰动,供给扰动,7,5,0.86,wiki/查询/六氟化钨查询记录.md,查询页不应作为投研框架,类型冲突待确认",
      ].join("\n"),
    )
    await write(
      path.join(tmpRoot, "raw/研报新闻/multi-topic-background-noise.md"),
      [
        "新增变量：六氟化钨长协和海外供给扰动继续发酵，先看半导体特气国产替代和量价反馈。",
        "背景池：今日盘前还同时提到 MPO、CPO、PCB、玻璃基板、光模块、AI数据中心，但这些不是本条核心催化。",
      ].join("\n\n"),
    )

    const dryRun = await runHypothesisWatch({
      projectPath: tmpRoot,
      since: "30d",
      sources: "raw",
      generatedAt: "2026-06-20 12:20:00",
      limit: 20,
    })

    expect(dryRun.candidateHypotheses).toHaveLength(1)
    const candidate = dryRun.candidateHypotheses[0]
    expect(candidate.title).toContain("六氟化钨")
    expect(candidate.segments).toEqual(expect.arrayContaining(["六氟化钨"]))
    expect(candidate.segments).not.toEqual(expect.arrayContaining([
      "MPO",
      "CPO",
      "PCB",
      "玻璃基板",
      "光模块",
      "AI数据中心",
    ]))
    expect(candidate.relatedWikiPages[0]).toMatchObject({
      sourceRef: "wiki/概念/半导体特气供给扰动.md",
      financeAuditMatchedTerms: expect.arrayContaining(["六氟化钨"]),
    })
  })

  it("does not route candidate related pages from a single generic finance metric term", async () => {
    await fs.rm(path.join(tmpRoot, "raw/研报新闻/2026-05-28-AI服务器电源.md"), { force: true })
    await write(
      path.join(tmpRoot, "wiki/概念/半导体特气供给扰动.md"),
      `${validFrontmatter("半导体特气供给扰动")}# 半导体特气供给扰动\n\n六氟化钨供给扰动、长协和国产替代是核心观察项。\n`,
    )
    await write(
      path.join(tmpRoot, "wiki/概念/EDA.md"),
      `${validFrontmatter("EDA")}# EDA\n\n这里是 EDA 产业链框架，历史材料里出现过在手订单这个指标词。\n`,
    )
    await write(
      path.join(tmpRoot, ".llm-wiki/sag-entity-audit/full-wiki-finance-entities-test/project-entity-table.csv"),
      [
        "\uFEFF实体类型,中文名,实体名,归一名,别名,出现次数,覆盖页面数,平均置信度,代表页面,代表证据,建议动作",
        "product_line,产品线,六氟化钨,六氟化钨,WF6 / 高纯六氟化钨,10,8,0.95,wiki/概念/半导体特气供给扰动.md,六氟化钨供给扰动与长协验证,建议进入 SAG seed/词典",
        "metric,指标,在手订单,在手订单,,20,12,0.87,wiki/概念/EDA.md,在手订单是泛财务指标,候选词典",
      ].join("\n"),
    )
    await write(
      path.join(tmpRoot, "raw/研报新闻/generic-metric-noise.md"),
      "新增变量：六氟化钨长协和海外供给扰动继续发酵，个别公司也提到在手订单，但核心是半导体特气国产替代和量价反馈。",
    )

    const dryRun = await runHypothesisWatch({
      projectPath: tmpRoot,
      since: "30d",
      sources: "raw",
      generatedAt: "2026-06-20 12:24:00",
      limit: 20,
    })

    expect(dryRun.candidateHypotheses).toHaveLength(1)
    const relatedRefs = dryRun.candidateHypotheses[0].relatedWikiPages.map((page) => page.sourceRef)
    expect(relatedRefs).toContain("wiki/概念/半导体特气供给扰动.md")
    expect(relatedRefs).not.toContain("wiki/概念/EDA.md")
  })

  it("keeps related wiki frames on the core catalyst when broad background terms are present", async () => {
    await fs.rm(path.join(tmpRoot, "raw/研报新闻/2026-05-28-AI服务器电源.md"), { force: true })
    await write(
      path.join(tmpRoot, "wiki/概念/机器人板块内部高低切.md"),
      `${validFrontmatter("机器人板块内部高低切")}# 机器人板块内部高低切\n\n特斯拉机器人、Optimus V3 和机器人供应链是核心跟踪框架。\n`,
    )
    await write(
      path.join(tmpRoot, "wiki/概念/储能.md"),
      `${validFrontmatter("储能")}# 储能\n\n储能和采购节奏是另一个框架，不能只靠单个旁支词混入机器人催化。\n`,
    )
    await write(
      path.join(tmpRoot, "wiki/概念/PCB上游材料预期差.md"),
      `${validFrontmatter("PCB上游材料预期差")}# PCB上游材料预期差\n\nPCB 上游材料、满产满销和供需紧张是另一个框架。\n`,
    )
    await write(
      path.join(tmpRoot, ".llm-wiki/sag-entity-audit/full-wiki-finance-entities-test/project-entity-table.csv"),
      [
        "\uFEFF实体类型,中文名,实体名,归一名,别名,出现次数,覆盖页面数,平均置信度,代表页面,代表证据,建议动作",
        "sector,板块,机器人,机器人,具身智能 / 人形机器人,20,18,0.92,wiki/概念/机器人板块内部高低切.md,Optimus V3 供应链催化,建议进入 SAG seed/词典",
        "product_line,产品线,Optimus V3,optimus v3,V3 / 特斯拉机器人,12,10,0.93,wiki/概念/机器人板块内部高低切.md,Optimus V3量产节奏,建议进入 SAG seed/词典",
        "concept,概念,储能,储能,,18,16,0.88,wiki/概念/储能.md,储能采购节奏,候选词典",
        "catalyst,催化事件,满产满销,满产满销,,14,12,0.87,wiki/概念/PCB上游材料预期差.md,满产满销是泛经营状态,候选词典",
      ].join("\n"),
    )
    await write(
      path.join(tmpRoot, "raw/研报新闻/optimus-background-noise.md"),
      "新增变量：特斯拉机器人Optimus V3正式投产，先看机器人供应链；盘前还提到储能采购和PCB满产满销，但核心催化是Optimus量产节奏。",
    )

    const dryRun = await runHypothesisWatch({
      projectPath: tmpRoot,
      since: "30d",
      sources: "raw",
      generatedAt: "2026-06-20 12:25:00",
      limit: 20,
    })

    expect(dryRun.candidateHypotheses).toHaveLength(1)
    const candidate = dryRun.candidateHypotheses[0]
    expect(candidate.title).toContain("Optimus V3")
    expect(candidate.segments).toEqual(expect.arrayContaining(["机器人", "Optimus V3"]))
    expect(candidate.segments).not.toEqual(expect.arrayContaining(["储能", "PCB", "满产满销"]))
    expect(candidate.keyVariables).not.toEqual(expect.arrayContaining(["PCB"]))
    const relatedRefs = candidate.relatedWikiPages.map((page) => page.sourceRef)
    expect(relatedRefs).toContain("wiki/概念/机器人板块内部高低切.md")
    expect(relatedRefs).not.toContain("wiki/概念/储能.md")
    expect(relatedRefs).not.toContain("wiki/概念/PCB上游材料预期差.md")
  })

  it("downranks Chinese query pages when choosing related wiki frames", async () => {
    await fs.rm(path.join(tmpRoot, "raw/研报新闻/2026-05-28-AI服务器电源.md"), { force: true })
    await write(
      path.join(tmpRoot, "wiki/概念/半导体特气供给扰动.md"),
      `${validFrontmatter("半导体特气供给扰动")}# 半导体特气供给扰动\n\n六氟化钨供给扰动、长协和国产替代是核心观察项。\n`,
    )
    await write(
      path.join(tmpRoot, "wiki/查询/六氟化钨查询记录.md"),
      `${validFrontmatter("六氟化钨查询记录")}# 六氟化钨查询记录\n\n六氟化钨 六氟化钨 六氟化钨 长协 供给扰动 在手订单。\n`,
    )
    await write(
      path.join(tmpRoot, ".llm-wiki/sag-entity-audit/full-wiki-finance-entities-test/project-entity-table.csv"),
      [
        "\uFEFF实体类型,中文名,实体名,归一名,别名,出现次数,覆盖页面数,平均置信度,代表页面,代表证据,建议动作",
        "product_line,产品线,六氟化钨,六氟化钨,WF6 / 高纯六氟化钨,10,8,0.95,wiki/概念/半导体特气供给扰动.md,六氟化钨供给扰动与长协验证,建议进入 SAG seed/词典",
      ].join("\n"),
    )
    await write(
      path.join(tmpRoot, "raw/研报新闻/chinese-query-page-noise.md"),
      "新增变量：六氟化钨长协和海外供给扰动继续发酵，先看半导体特气国产替代和量价反馈。",
    )

    const dryRun = await runHypothesisWatch({
      projectPath: tmpRoot,
      since: "30d",
      sources: "raw",
      generatedAt: "2026-06-20 12:26:00",
      limit: 20,
    })

    const relatedRefs = dryRun.candidateHypotheses[0].relatedWikiPages.map((page) => page.sourceRef)
    expect(relatedRefs[0]).toBe("wiki/概念/半导体特气供给扰动.md")
    expect(relatedRefs).not.toContain("wiki/查询/六氟化钨查询记录.md")
  })

  it("ranks specific SAG finance audit wiki pages ahead of broad hot frames", async () => {
    await write(
      path.join(tmpRoot, "wiki/概念/Rubin上游材料框架.md"),
      `${validFrontmatter("Rubin上游材料框架", "概念", "momentum: 热\n")}# Rubin上游材料框架\n\nRubin 上游材料是AI硬件活跃框架，但这里不沉淀六氟化钨的专门验证路径。\n`,
    )
    await write(
      path.join(tmpRoot, "wiki/概念/半导体特气供给扰动.md"),
      `${validFrontmatter("半导体特气供给扰动", "概念", "momentum: 热\n")}# 半导体特气供给扰动\n\n六氟化钨供给扰动、长协和国产替代是核心观察项。\n`,
    )
    await write(
      path.join(tmpRoot, "wiki/概念/B300型号跟踪.md"),
      `${validFrontmatter("B300型号跟踪", "概念", "momentum: 热\n")}# B300型号跟踪\n\nB300 是模型/型号类词，不能只因为出现在金融词表里就压过更具体的产业变量。\n`,
    )
    await write(
      path.join(tmpRoot, ".llm-wiki/sag-entity-audit/full-wiki-finance-entities-test/project-entity-table.csv"),
      [
        "\uFEFF实体类型,中文名,实体名,归一名,别名,出现次数,覆盖页面数,平均置信度,代表页面,代表证据,建议动作",
        "product_line,产品线,B300,b300,,100,30,0.88,wiki/概念/B300型号跟踪.md,B300代际升级,候选词典",
        "product_line,产品线,六氟化钨,六氟化钨,WF6 / 高纯六氟化钨,1,1,0.95,wiki/概念/半导体特气供给扰动.md,六氟化钨供给扰动与长协验证,建议进入 SAG seed/词典",
      ].join("\n"),
    )
    await appendWechatIncrementMessages({
      projectPath: tmpRoot,
      messages: [
        {
          schema: "wechat-increment-v1",
          messageId: "finance-audit-priority-rank-1",
          chatId: "core",
          chatName: "核心群",
          senderAlias: "研究员P",
          sentAt: "2026-06-20 12:30:00",
          receivedAt: "2026-06-20 12:30:10",
          text: "新增变量：Rubin上游材料里六氟化钨长协和海外供给扰动继续发酵，B300也有舆情提及，先看半导体特气国产替代和相关标的量价反馈。",
          sourceTool: "wechat-extractor",
        },
      ],
      generatedAt: "2026-06-20 12:30:30",
    })
    await processWechatIncrementInbox({
      projectPath: tmpRoot,
      generatedAt: "2026-06-20 12:31:00",
    })

    const dryRun = await runHypothesisWatch({
      projectPath: tmpRoot,
      since: "30m",
      sources: "wechat_incremental",
      generatedAt: "2026-06-20 12:32:00",
      limit: 20,
    })

    expect(dryRun.candidateHypotheses).toHaveLength(1)
    expect(dryRun.candidateHypotheses[0].relatedWikiPages[0]).toMatchObject({
      sourceRef: "wiki/概念/半导体特气供给扰动.md",
      financeAuditMatchedTerms: expect.arrayContaining(["六氟化钨"]),
    })
  })

  it("keeps active wiki header frames in related pages even when lexical score is lower", async () => {
    const staleFrontmatter = (title) => `---
schema_version: 1
title: ${title}
aliases: []
type: 概念
summary: 历史 CPO 旧框架，词面覆盖很强但当前已经不作为主动跟踪底座。
tags:
  - CPO增速放缓
  - MPO连接器
  - 价格函
related: []
sources: []
created: 2026-05-11 14:23:07
updated: 2026-05-11 14:23:07
last_reviewed: 2026-05-11 14:23:07
confidence: 低
status: 归档
momentum: 冷
---
`
    await write(
      path.join(tmpRoot, "wiki/概念/CPO旧框架A.md"),
      `${staleFrontmatter("CPO增速放缓")}# CPO增速放缓\n\nCPO增速放缓 MPO连接器 价格函 订单 AI数据中心 叙事扩散。\n`,
    )
    await write(
      path.join(tmpRoot, "wiki/概念/CPO旧框架B.md"),
      `${staleFrontmatter("CPO增速放缓")}# CPO增速放缓\n\nCPO增速放缓 MPO连接器 价格函 订单 AI数据中心 叙事扩散。\n`,
    )
    await write(
      path.join(tmpRoot, "wiki/概念/CPO旧框架C.md"),
      `${staleFrontmatter("CPO增速放缓")}# CPO增速放缓\n\nCPO增速放缓 MPO连接器 价格函 订单 AI数据中心 叙事扩散。\n`,
    )
    await write(
      path.join(tmpRoot, "wiki/概念/高速互联活跃框架.md"),
      `---
schema_version: 1
title: 高速互联活跃框架
aliases: []
type: 概念
summary: 当前活跃框架，跟踪 CPO 节奏变化、MPO连接器订单和高速互联量价反馈。
tags:
  - MPO连接器
  - 高速互联
related: []
sources:
  - raw/微信聊天/2026-06-20.md
catalysts:
  - MPO订单
created: 2026-06-20 09:00:00
updated: 2026-06-20 09:00:00
last_reviewed: 2026-06-20 09:00:00
confidence: 高
status: 活跃
momentum: 热
---
# 高速互联活跃框架

MPO连接器订单和高速互联量价反馈是当前跟踪主线。
`,
    )
    await appendWechatIncrementMessages({
      projectPath: tmpRoot,
      messages: [
        {
          schema: "wechat-increment-v1",
          messageId: "active-wiki-header-ranking-1",
          chatId: "core",
          chatName: "核心群",
          senderAlias: "研究员L",
          sentAt: "2026-06-20 10:10:00",
          receivedAt: "2026-06-20 10:10:10",
          text: "新增变量：CPO增速放缓后，MPO连接器订单和价格函在AI数据中心方向继续扩散，先看高速互联量价反馈。",
          sourceTool: "wechat-extractor",
        },
      ],
      generatedAt: "2026-06-20 10:10:30",
    })
    await processWechatIncrementInbox({
      projectPath: tmpRoot,
      generatedAt: "2026-06-20 10:11:00",
    })

    const dryRun = await runHypothesisWatch({
      projectPath: tmpRoot,
      since: "30m",
      sources: "wechat_incremental",
      generatedAt: "2026-06-20 10:12:00",
      limit: 20,
    })

    expect(dryRun.candidateHypotheses).toHaveLength(1)
    const relatedRefs = dryRun.candidateHypotheses[0].relatedWikiPages.map((page) => page.sourceRef)
    expect(relatedRefs[0]).toBe("wiki/概念/高速互联活跃框架.md")
    expect(relatedRefs).toContain("wiki/概念/高速互联活跃框架.md")
    expect(dryRun.candidateHypotheses[0].relatedWikiPages[0].wikiMeta).toMatchObject({
      status: "活跃",
      confidence: "高",
      momentum: "热",
    })
  })

  it("uses SAG finance entity audit representative pages beyond the wiki reference scan limit", async () => {
    for (let index = 0; index < 505; index += 1) {
      const name = `000-${String(index).padStart(3, "0")}-占位页`
      await write(
        path.join(tmpRoot, `wiki/概念/${name}.md`),
        `${validFrontmatter(name)}# ${name}\n\n占位页面，用来模拟大 wiki 下排序靠前但不相关的页面。\n`,
      )
    }
    await write(
      path.join(tmpRoot, "wiki/概念/zzz-材料瓶颈活跃页.md"),
      `---
schema_version: 1
title: 材料瓶颈活跃页
aliases: []
type: 概念
summary: 当前活跃框架，跟踪极低轮廓铜箔、批量订单和海外客户认证。
tags:
  - 极低轮廓铜箔
  - 批量订单
related: []
sources:
  - raw/微信聊天/2026-06-20.md
catalysts:
  - 海外客户订单
created: 2026-06-20 09:00:00
updated: 2026-06-20 09:00:00
last_reviewed: 2026-06-20 09:00:00
confidence: 高
status: 活跃
momentum: 热
---
# 材料瓶颈活跃页

极低轮廓铜箔和批量订单是当前需要跟踪的材料瓶颈。
`,
    )
    await write(
      path.join(tmpRoot, ".llm-wiki/sag-entity-audit/full-wiki-finance-entities-test/project-entity-table.csv"),
      [
        "\uFEFF实体类型,中文名,实体名,归一名,别名,出现次数,覆盖页面数,平均置信度,代表页面,代表证据,建议动作",
        "product_line,产品线,HVLP铜箔,hvlp铜箔,极低轮廓铜箔 / 高速铜箔,12,8,0.92,wiki/概念/zzz-材料瓶颈活跃页.md,HVLP铜箔供需缺口与认证壁垒,建议进入 SAG seed/词典",
        "catalyst,催化事件,批量订单,批量订单,,9,9,0.91,wiki/概念/zzz-材料瓶颈活跃页.md,客户认证通过后出现批量订单,建议进入 SAG seed/词典",
      ].join("\n"),
    )
    await appendWechatIncrementMessages({
      projectPath: tmpRoot,
      messages: [
        {
          schema: "wechat-increment-v1",
          messageId: "audit-representative-page-beyond-limit-1",
          chatId: "core",
          chatName: "核心群",
          senderAlias: "研究员M",
          sentAt: "2026-06-20 11:10:00",
          receivedAt: "2026-06-20 11:10:10",
          text: "新增变量：海外客户对极低轮廓铜箔批量订单加速，先看材料瓶颈和高端电子铜箔量价反应。",
          sourceTool: "wechat-extractor",
        },
      ],
      generatedAt: "2026-06-20 11:10:30",
    })
    await processWechatIncrementInbox({
      projectPath: tmpRoot,
      generatedAt: "2026-06-20 11:11:00",
    })

    const dryRun = await runHypothesisWatch({
      projectPath: tmpRoot,
      since: "30m",
      sources: "wechat_incremental",
      generatedAt: "2026-06-20 11:12:00",
      limit: 20,
    })

    expect(dryRun.candidateHypotheses).toHaveLength(1)
    expect(dryRun.candidateHypotheses[0].relatedWikiPages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceRef: "wiki/概念/zzz-材料瓶颈活跃页.md",
        matchedTerms: expect.arrayContaining(["极低轮廓铜箔", "批量订单"]),
        financeAuditMatchedTerms: expect.arrayContaining(["极低轮廓铜箔", "批量订单"]),
        wikiMeta: expect.objectContaining({
          status: "活跃",
          confidence: "高",
          momentum: "热",
        }),
      }),
    ]))
  })

  it("uses concrete WeChat catalyst text instead of broad theme-only candidate titles", async () => {
    await appendWechatIncrementMessages({
      projectPath: tmpRoot,
      messages: [
        {
          schema: "wechat-increment-v1",
          messageId: "concrete-catalyst-title-1",
          chatId: "core",
          chatName: "核心群",
          senderAlias: "研究员H",
          sentAt: "2026-06-19 09:00:50",
          receivedAt: "2026-06-19 09:01:00",
          text: "发酵/异动｜中国西电海外数据中心 SST 订单、王子新材 SST 薄膜送样通过与 Helion 核聚变订单、铝电容行业公司对比清单集中出现。",
          sourceTool: "wechat-extractor",
        },
      ],
      generatedAt: "2026-06-19 09:01:30",
    })
    await processWechatIncrementInbox({
      projectPath: tmpRoot,
      generatedAt: "2026-06-19 09:02:00",
    })

    const dryRun = await runHypothesisWatch({
      projectPath: tmpRoot,
      since: "30m",
      sources: "wechat_incremental",
      generatedAt: "2026-06-19 09:03:00",
      limit: 20,
    })

    expect(dryRun.candidateHypotheses).toHaveLength(1)
    expect(dryRun.candidateHypotheses[0]).toMatchObject({
      title: expect.stringContaining("中国西电海外数据中心 SST 订单"),
      theme: "AI数据中心",
      status: "seed",
      signalType: "新催化",
      reason: expect.stringContaining("未命中已有假设"),
      tradingImplication: expect.stringContaining("Ask 深挖"),
    })
    expect(dryRun.candidateHypotheses[0].title).not.toBe("新催化：AI数据中心")
  })

  it("cleans WeChat emoji bullets from concrete catalyst titles", async () => {
    await appendWechatIncrementMessages({
      projectPath: tmpRoot,
      messages: [
        {
          schema: "wechat-increment-v1",
          messageId: "emoji-catalyst-title-1",
          chatId: "core",
          chatName: "核心群",
          senderAlias: "研究员I",
          sentAt: "2026-06-19 09:10:00",
          receivedAt: "2026-06-19 09:10:10",
          text: "1️⃣光模块粘接胶，已送样国内最头部客户；",
          sourceTool: "wechat-extractor",
        },
      ],
      generatedAt: "2026-06-19 09:10:30",
    })
    await processWechatIncrementInbox({
      projectPath: tmpRoot,
      generatedAt: "2026-06-19 09:11:00",
    })

    const dryRun = await runHypothesisWatch({
      projectPath: tmpRoot,
      since: "30m",
      sources: "wechat_incremental",
      generatedAt: "2026-06-19 09:12:00",
      limit: 20,
    })

    expect(dryRun.candidateHypotheses).toHaveLength(1)
    expect(dryRun.candidateHypotheses[0].title).toContain("光模块粘接胶")
    expect(dryRun.candidateHypotheses[0].title).not.toContain("️⃣")
  })

  it("cleans markdown, heat suffixes, and source metadata from WeChat catalyst candidate titles", async () => {
    await appendWechatIncrementMessages({
      projectPath: tmpRoot,
      messages: [
        {
          schema: "wechat-increment-v1",
          messageId: "formatted-catalyst-title-1",
          chatId: "core",
          chatName: "核心群",
          senderAlias: "研究员K",
          sentAt: "2026-06-19 09:13:00",
          receivedAt: "2026-06-19 09:13:10",
          text: "**光纤/光通信上游涨价+供需紧俏｜热度：中高｜命中群：3（2026资讯",
          sourceTool: "wechat-extractor",
        },
        {
          schema: "wechat-increment-v1",
          messageId: "formatted-catalyst-title-2",
          chatId: "core",
          chatName: "核心群",
          senderAlias: "研究员K",
          sentAt: "2026-06-19 09:13:30",
          receivedAt: "2026-06-19 09:13:40",
          text: "[Gift]AI成长：PCB/CCL在AI时代的升级斜率明确，健滔涨价函继续扩散。",
          sourceTool: "wechat-extractor",
        },
        {
          schema: "wechat-increment-v1",
          messageId: "formatted-catalyst-title-3",
          chatId: "core",
          chatName: "核心群",
          senderAlias: "研究员K",
          sentAt: "2026-06-19 09:14:00",
          receivedAt: "2026-06-19 09:14:10",
          text: "代表来源：2026资讯 local_id 136435（长光华芯）涨价函扩散，光纤上游六氟化钨供需紧俏。",
          sourceTool: "wechat-extractor",
        },
        {
          schema: "wechat-increment-v1",
          messageId: "formatted-catalyst-title-4",
          chatId: "core",
          chatName: "核心群",
          senderAlias: "研究员K",
          sentAt: "2026-06-19 09:14:20",
          receivedAt: "2026-06-19 09:14:30",
          text: "/配套：薄膜铌酸锂（下一代调制器材料），玻璃基板催化继续扩散。",
          sourceTool: "wechat-extractor",
        },
      ],
      generatedAt: "2026-06-19 09:14:30",
    })
    await processWechatIncrementInbox({
      projectPath: tmpRoot,
      generatedAt: "2026-06-19 09:15:00",
    })

    const dryRun = await runHypothesisWatch({
      projectPath: tmpRoot,
      since: "30m",
      sources: "wechat_incremental",
      generatedAt: "2026-06-19 09:16:00",
      limit: 20,
    })
    const titles = dryRun.candidateHypotheses.map((item) => item.title)

    expect(titles).toEqual(expect.arrayContaining([
      expect.stringContaining("光纤/光通信上游涨价+供需紧俏"),
      expect.stringContaining("AI成长"),
      expect.stringContaining("长光华芯"),
      expect.stringContaining("薄膜铌酸锂"),
    ]))
    for (const title of titles) {
      expect(title).not.toMatch(/\*\*|\[Gift\]|热度|命中群|local_id/)
    }
  })

  it("does not create candidate cards from generic promotional catalyst phrases", async () => {
    await appendWechatIncrementMessages({
      projectPath: tmpRoot,
      messages: [
        {
          schema: "wechat-increment-v1",
          messageId: "generic-promo-catalyst-1",
          chatId: "core",
          chatName: "核心群",
          senderAlias: "研究员L",
          sentAt: "2026-06-19 09:15:00",
          receivedAt: "2026-06-19 09:15:10",
          text: "多年沉淀技术实力在高端场景得以认证，SST 相关配套值得关注。",
          sourceTool: "wechat-extractor",
        },
      ],
      generatedAt: "2026-06-19 09:15:30",
    })
    await processWechatIncrementInbox({
      projectPath: tmpRoot,
      generatedAt: "2026-06-19 09:16:00",
    })

    const dryRun = await runHypothesisWatch({
      projectPath: tmpRoot,
      since: "30m",
      sources: "wechat_incremental",
      generatedAt: "2026-06-19 09:17:00",
      limit: 20,
    })

    expect(dryRun.candidateHypotheses).toEqual([])
  })

  it("prioritizes harder catalyst candidates before pure market heat", async () => {
    await appendWechatIncrementMessages({
      projectPath: tmpRoot,
      messages: [
        {
          schema: "wechat-increment-v1",
          messageId: "candidate-priority-heat",
          chatId: "core",
          chatName: "核心群",
          senderAlias: "研究员J",
          sentAt: "2026-06-19 09:20:00",
          receivedAt: "2026-06-19 09:20:10",
          text: "催化｜AI数据中心美股盘中强势、SPCX/SpaceX 交易热度。",
          sourceTool: "wechat-extractor",
        },
        {
          schema: "wechat-increment-v1",
          messageId: "candidate-priority-order",
          chatId: "core",
          chatName: "核心群",
          senderAlias: "研究员J",
          sentAt: "2026-06-19 09:20:30",
          receivedAt: "2026-06-19 09:20:40",
          text: "催化｜AI服务器中国西电 13.8kVAC / 800VDC SST 海外订单、王子新材 Helion 数千万美元订单、SST 用量翻倍预期。",
          sourceTool: "wechat-extractor",
        },
      ],
      generatedAt: "2026-06-19 09:21:00",
    })
    await processWechatIncrementInbox({
      projectPath: tmpRoot,
      generatedAt: "2026-06-19 09:22:00",
    })

    const dryRun = await runHypothesisWatch({
      projectPath: tmpRoot,
      since: "30m",
      sources: "wechat_incremental",
      generatedAt: "2026-06-19 09:23:00",
      limit: 20,
    })

    expect(dryRun.candidateHypotheses.map((item) => item.title)).toEqual([
      expect.stringContaining("中国西电"),
      expect.stringContaining("美股盘中强势"),
    ])
  })

  it("merges related candidate catalyst messages into one signal cluster", async () => {
    await fs.rm(path.join(tmpRoot, "raw/研报新闻/2026-05-28-AI服务器电源.md"), { force: true })
    await write(path.join(tmpRoot, "raw/研报新闻/xd-sst-1.md"), "发酵/异动｜中国西电海外数据中心 SST 订单、王子新材 SST 薄膜送样通过与 Helion 核聚变订单。")
    await write(path.join(tmpRoot, "raw/研报新闻/xd-sst-2.md"), "催化｜中国西电 13.8kVAC / 800VDC SST 海外订单，SST 用量翻倍预期继续扩散。")

    const dryRun = await runHypothesisWatch({
      projectPath: tmpRoot,
      since: "30d",
      sources: "raw",
      generatedAt: "2026-06-19 09:33:00",
      limit: 20,
    })

    expect(dryRun.candidateHypotheses).toHaveLength(1)
    expect(dryRun.candidateHypotheses[0]).toMatchObject({
      title: expect.stringContaining("中国西电"),
      clusterKey: expect.stringContaining("中国西电"),
      clusterSourceCount: 2,
      priorityScore: expect.any(Number),
      priorityReasons: expect.arrayContaining(["硬催化", "多来源确认"]),
      sourceExcerpts: expect.arrayContaining([
        expect.stringContaining("中国西电海外数据中心 SST 订单"),
        expect.stringContaining("13.8kVAC / 800VDC SST 海外订单"),
      ]),
    })
  })

  it("marks pure trading heat as lower priority in candidate reasons", async () => {
    await appendWechatIncrementMessages({
      projectPath: tmpRoot,
      messages: [
        {
          schema: "wechat-increment-v1",
          messageId: "candidate-priority-heat-only",
          chatId: "core",
          chatName: "核心群",
          senderAlias: "研究员M",
          sentAt: "2026-06-19 09:40:00",
          receivedAt: "2026-06-19 09:40:10",
          text: "催化｜AI数据中心美股盘中强势、SPCX/SpaceX 交易热度。",
          sourceTool: "wechat-extractor",
        },
      ],
      generatedAt: "2026-06-19 09:40:30",
    })
    await processWechatIncrementInbox({
      projectPath: tmpRoot,
      generatedAt: "2026-06-19 09:41:00",
    })

    const dryRun = await runHypothesisWatch({
      projectPath: tmpRoot,
      since: "30m",
      sources: "wechat_incremental",
      generatedAt: "2026-06-19 09:42:00",
      limit: 20,
    })

    expect(dryRun.candidateHypotheses[0]).toMatchObject({
      title: expect.stringContaining("美股盘中强势"),
      priorityReasons: expect.arrayContaining(["交易热度靠后"]),
    })
  })

  it("lists hypothesis alerts and writes dashboard data", async () => {
    const mpo = await createHypothesis({
      projectPath: tmpRoot,
      title: "CPO增速放缓可能推动MPO连接器量价齐升",
      theme: "AI数据中心互联",
      segments: "MPO,CPO,高速连接器",
      write: true,
    })
    await write(
      path.join(tmpRoot, "raw/研报新闻/mpo-watchtower.md"),
      "# AI数据中心互联\n\nMPO CPO 高速连接器成交额放量，客户订单、中标公告、CNINFO公告、财报收入、ASP价格和交付均有验证。",
    )
    await runHypothesisWatch({
      projectPath: tmpRoot,
      since: "1d",
      sources: "raw",
      generatedAt: "2026-06-16 13:00:00",
      write: true,
    })

    const openAlerts = await listHypothesisAlerts({ projectPath: tmpRoot, status: "open", minAlertLevel: "watch" })
    expect(openAlerts).toMatchObject({
      schema: "trading-hypothesis-alert-list-v1",
      count: 1,
      writePolicy: { readOnly: true, wroteWiki: false, wroteRaw: false },
    })
    expect(openAlerts.alerts[0]).toMatchObject({
      hypothesisId: mpo.hypothesis.id,
      alertLevel: "important",
      status: "open",
    })

    const dryRun = await buildHypothesisDashboardData({
      projectPath: tmpRoot,
      generatedAt: "2026-06-16 13:05:00",
    })
    expect(dryRun).toMatchObject({
      schema: "trading-hypothesis-dashboard-run-v1",
      dryRun: true,
      dashboard: {
        schema: "trading-hypothesis-dashboard-v1",
        summary: {
          hypothesisCount: 1,
          openAlertCount: 1,
          triggeredTodayCount: 1,
          strengtheningCount: 0,
          pricedInRiskCount: 0,
          disconfirmedCount: 0,
        },
      },
      writeResult: null,
    })
    expect(dryRun.markdown).toContain("## 今日触发")
    expect(dryRun.dashboard.hypotheses[0].recentEvents[0]).toMatchObject({
      hypothesisId: mpo.hypothesis.id,
      evidenceDelta: "fundamental_delivery",
    })
    expect(dryRun.dashboard.hypotheses[0].openAlerts[0]).toMatchObject({
      hypothesisId: mpo.hypothesis.id,
      alertLevel: "important",
      status: "open",
    })

    const written = await buildHypothesisDashboardData({
      projectPath: tmpRoot,
      generatedAt: "2026-06-16 13:05:00",
      write: true,
    })
    expect(written.writeResult).toMatchObject({
      jsonRelativePath: ".llm-wiki/hypothesis-dashboard/latest.json",
      markdownRelativePath: ".llm-wiki/hypothesis-dashboard/latest.md",
      records: 1,
    })
    const json = JSON.parse(await read(written.writeResult.jsonPath))
    expect(json.summary.openAlertCount).toBe(1)
    expect(await read(written.writeResult.markdownPath)).toContain("## 重要提醒")
  })
})

describe("codex ingest apply", () => {
  it("dry-run does not write wiki files", async () => {
    const source = path.join(tmpRoot, "raw/研报新闻/2026-05-28-AI服务器电源.md")
    const sourceHash = (await prepareIngest({ projectPath: tmpRoot, sourcePath: source, noReport: true })).sourceHash
    const indexPath = path.join(tmpRoot, "wiki/index.md")
    const before = await read(indexPath)
    const manifestPath = path.join(tmpRoot, ".llm-wiki/codex-ingest/test-manifest/changes.json")

    await write(
      manifestPath,
      JSON.stringify({
        $schema: "codex-ingest-manifest-v1",
        projectPath: tmpRoot,
        sourcePath: source,
        sourceHash,
        writes: [
          {
            action: "update",
            path: "wiki/index.md",
            content: `${before}\n- [[概念/AI服务器电源涨价]] — 新增观察`,
          },
        ],
      }),
    )

    const report = await applyManifest({ manifestPath })
    expect(report.dryRun).toBe(true)
    expect(report.diffs[0].path).toBe("wiki/index.md")
    expect(await read(indexPath)).toBe(before)
  })

  it("collects target hashes for manifest writes", async () => {
    const source = path.join(tmpRoot, "raw/研报新闻/2026-05-28-AI服务器电源.md")
    const sourceHash = (await prepareIngest({ projectPath: tmpRoot, sourcePath: source, noReport: true })).sourceHash
    const indexPath = path.join(tmpRoot, "wiki/index.md")
    const before = await read(indexPath)
    const manifest = {
      $schema: "codex-ingest-manifest-v1",
      projectPath: tmpRoot,
      sourcePath: source,
      sourceHash,
      writes: [
        {
          action: "update",
          path: "wiki/index.md",
          content: `${before}\n- [[概念/AI服务器电源涨价]] — 新增观察`,
        },
        {
          action: "create",
          path: "wiki/概念/批量Hash测试新增页.md",
          content: `${validFrontmatter("批量Hash测试新增页")}# 批量Hash测试新增页\n`,
        },
      ],
    }

    const targets = await collectManifestTargetHashes(tmpRoot, manifest)

    expect(targets).toEqual([
      expect.objectContaining({
        path: "wiki/index.md",
        action: "update",
        baseExists: true,
        baseHash: expect.any(String),
        classification: "housekeeping",
      }),
      expect.objectContaining({
        path: "wiki/概念/批量Hash测试新增页.md",
        action: "create",
        baseExists: false,
        baseHash: null,
        classification: "core",
      }),
    ])
  })

  it("rejects stale target writes when expected target hashes are provided", async () => {
    const source = path.join(tmpRoot, "raw/研报新闻/2026-05-28-AI服务器电源.md")
    const sourceHash = (await prepareIngest({ projectPath: tmpRoot, sourcePath: source, noReport: true })).sourceHash
    const indexPath = path.join(tmpRoot, "wiki/index.md")
    const before = await read(indexPath)
    const manifestPath = path.join(tmpRoot, ".llm-wiki/codex-ingest/stale-target/changes.json")
    const manifest = {
      $schema: "codex-ingest-manifest-v1",
      projectPath: tmpRoot,
      sourcePath: source,
      sourceHash,
      writes: [
        {
          action: "update",
          path: "wiki/index.md",
          content: `${before}\n- [[概念/AI服务器电源涨价]] — 新增观察`,
        },
      ],
    }
    await write(manifestPath, JSON.stringify(manifest))
    const expectedTargetHashes = await collectManifestTargetHashes(tmpRoot, manifest)

    await write(indexPath, `${before}\n- somebody else wrote first\n`)

    const conflicts = await checkManifestTargetConflicts(tmpRoot, manifest, expectedTargetHashes)
    expect(conflicts).toEqual([
      expect.objectContaining({
        path: "wiki/index.md",
        classification: "housekeeping",
        reason: "hash_mismatch",
      }),
    ])
    await expect(
      applyManifest({ manifestPath, write: true, expectedTargetHashes }),
    ).rejects.toThrow(/Target conflict/)
  })

  it("rejects create actions when the target already exists under hash guard", async () => {
    const source = path.join(tmpRoot, "raw/研报新闻/2026-05-28-AI服务器电源.md")
    const sourceHash = (await prepareIngest({ projectPath: tmpRoot, sourcePath: source, noReport: true })).sourceHash
    const manifestPath = path.join(tmpRoot, ".llm-wiki/codex-ingest/create-existing-target/changes.json")
    const manifest = {
      $schema: "codex-ingest-manifest-v1",
      projectPath: tmpRoot,
      sourcePath: source,
      sourceHash,
      writes: [
        {
          action: "create",
          path: "wiki/概念/算电协同.md",
          content: `${validFrontmatter("算电协同")}# 算电协同\n`,
        },
      ],
    }
    await write(manifestPath, JSON.stringify(manifest))
    const expectedTargetHashes = await collectManifestTargetHashes(tmpRoot, manifest)

    const conflicts = await checkManifestTargetConflicts(tmpRoot, manifest, expectedTargetHashes)
    expect(conflicts).toEqual([
      expect.objectContaining({
        path: "wiki/概念/算电协同.md",
        classification: "core",
        reason: "create_target_exists",
      }),
    ])
    await expect(
      applyManifest({ manifestPath, write: true, expectedTargetHashes }),
    ).rejects.toThrow(/Target conflict/)
  })

  it("dry-run previews temporal fact writes without appending jsonl", async () => {
    const manifestPath = path.join(tmpRoot, ".llm-wiki/codex-ingest/facts-dry-run/changes.json")
    await write(
      manifestPath,
      JSON.stringify({
        $schema: "codex-ingest-manifest-v1",
        projectPath: tmpRoot,
        writes: [],
        factWrites: [
          {
            path: TEMPORAL_FACTS_RELATIVE_PATH,
            subject: "三孚新科",
            predicate: "HAS_ORDER",
            object: "mSAP电镀设备订单",
            claim: "三孚新科已有 mSAP 电镀设备订单事实待验证。",
            status: "active",
            validAt: "2026-05-28",
            sourcePath: "raw/研报新闻/2026-05-28-AI服务器电源.md",
            wikiPath: "wiki/股票/三孚新科.md",
          },
        ],
      }),
    )

    const report = await applyManifest({ manifestPath })
    expect(report.dryRun).toBe(true)
    expect(report.plannedFactWrites).toHaveLength(1)
    expect(report.plannedFactWrites[0]).toMatchObject({
      path: TEMPORAL_FACTS_RELATIVE_PATH,
      status: "active",
      subject: "三孚新科",
      predicate: "HAS_ORDER",
    })
    expect(report.factsWritten).toEqual([])
    await expect(fs.access(path.join(tmpRoot, TEMPORAL_FACTS_RELATIVE_PATH))).rejects.toThrow()
  })

  it("write mode appends temporal facts to the dedicated jsonl file", async () => {
    const manifestPath = path.join(tmpRoot, ".llm-wiki/codex-ingest/facts-write/changes.json")
    await write(
      manifestPath,
      JSON.stringify({
        $schema: "codex-ingest-manifest-v1",
        projectPath: tmpRoot,
        writes: [],
        factWrites: [
          {
            path: TEMPORAL_FACTS_RELATIVE_PATH,
            subject: "三孚新科",
            predicate: "HAS_ORDER",
            object: "mSAP电镀设备订单",
            claim: "三孚新科已有 mSAP 电镀设备订单事实待验证。",
            status: "active",
            validAt: "2026-05-28",
            sourcePath: "raw/研报新闻/2026-05-28-AI服务器电源.md",
            wikiPath: "wiki/股票/三孚新科.md",
          },
        ],
      }),
    )

    const report = await applyManifest({ manifestPath, write: true })
    const records = await readJsonl(path.join(tmpRoot, TEMPORAL_FACTS_RELATIVE_PATH))
    expect(report.factsWritten).toEqual([report.plannedFactWrites[0].id])
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      id: report.factsWritten[0],
      type: "temporal_fact",
      status: "active",
      entityKey: "stock:SH688359",
      canonicalSubject: "三孚新科",
      stockCode: "SH688359",
      subject: "三孚新科",
      predicate: "HAS_ORDER",
    })
    const index = JSON.parse(await read(path.join(tmpRoot, TEMPORAL_FACT_INDEX_RELATIVE_PATH)))
    expect(report.factIndex).toMatchObject({
      path: TEMPORAL_FACT_INDEX_RELATIVE_PATH,
      counts: { totalFacts: 1, activeFacts: 1, inactiveFacts: 0, entities: 1 },
    })
    expect(index.entities["stock:SH688359"].activeFactIds).toEqual([report.factsWritten[0]])
  })

  it("does not append duplicate temporal facts on rerun", async () => {
    const manifestPath = path.join(tmpRoot, ".llm-wiki/codex-ingest/facts-rerun/changes.json")
    const manifest = {
      $schema: "codex-ingest-manifest-v1",
      projectPath: tmpRoot,
      writes: [],
      factWrites: [
        {
          path: TEMPORAL_FACTS_RELATIVE_PATH,
          subject: "三孚新科",
          predicate: "HAS_ORDER",
          object: "mSAP电镀设备订单",
          claim: "三孚新科已有 mSAP 电镀设备订单事实待验证。",
          status: "active",
          validAt: "2026-05-28",
          sourcePath: "raw/研报新闻/2026-05-28-AI服务器电源.md",
          wikiPath: "wiki/股票/三孚新科.md",
        },
      ],
    }
    await write(manifestPath, JSON.stringify(manifest))

    const first = await applyManifest({ manifestPath, write: true })
    const second = await applyManifest({ manifestPath, write: true })
    const records = await readJsonl(path.join(tmpRoot, TEMPORAL_FACTS_RELATIVE_PATH))
    expect(first.factsWritten).toHaveLength(1)
    expect(second.factsWritten).toEqual([])
    expect(second.duplicateFacts).toHaveLength(1)
    expect(records).toHaveLength(1)
  })

  it("marks older temporal facts as superseded when a later source contradicts them", async () => {
    const firstManifestPath = path.join(tmpRoot, ".llm-wiki/codex-ingest/facts-contradiction-1/changes.json")
    await write(
      firstManifestPath,
      JSON.stringify({
        $schema: "codex-ingest-manifest-v1",
        projectPath: tmpRoot,
        writes: [],
        factWrites: [
          {
            path: TEMPORAL_FACTS_RELATIVE_PATH,
            subject: "三孚新科",
            predicate: "HAS_ORDER",
            object: "mSAP电镀设备订单",
            claim: "三孚新科 mSAP 电镀设备订单已经落地。",
            status: "active",
            validAt: "2026-05-28",
            sourcePath: "raw/研报新闻/2026-05-28-AI服务器电源.md",
          },
        ],
      }),
    )
    await applyManifest({ manifestPath: firstManifestPath, write: true })
    const [oldFact] = await readJsonl(path.join(tmpRoot, TEMPORAL_FACTS_RELATIVE_PATH))

    const secondManifestPath = path.join(tmpRoot, ".llm-wiki/codex-ingest/facts-contradiction-2/changes.json")
    await write(
      secondManifestPath,
      JSON.stringify({
        $schema: "codex-ingest-manifest-v1",
        projectPath: tmpRoot,
        writes: [],
        factWrites: [
          {
            path: TEMPORAL_FACTS_RELATIVE_PATH,
            subject: "三孚新科",
            predicate: "CONTRADICTS",
            object: "mSAP电镀设备订单",
            claim: "后续来源显示三孚新科 mSAP 电镀设备订单未被确认，旧订单结论需要撤下。",
            status: "active",
            validAt: "2026-05-29",
            sourcePath: "raw/研报新闻/2026-05-29-三孚新科澄清.md",
            supersedes: [oldFact.id],
          },
        ],
      }),
    )

    const dryRun = await applyManifest({ manifestPath: secondManifestPath })
    expect(dryRun.supersededFacts).toEqual([
      expect.objectContaining({ id: oldFact.id, found: true, line: 1 }),
    ])
    const writeReport = await applyManifest({ manifestPath: secondManifestPath, write: true })
    expect(writeReport.factsWritten).toHaveLength(1)

    const context = await buildAskRetrievalContext({
      projectPath: tmpRoot,
      query: "三孚新科 mSAP 电镀设备订单",
      sources: "facts",
      includeInvalidated: true,
    })
    expect(context.factsResults.map((item) => item.value.id)).toContain(writeReport.factsWritten[0])
    expect(context.factsResults.map((item) => item.value.id)).not.toContain(oldFact.id)
    const superseded = context.invalidatedFactsResults.find((item) => item.value.id === oldFact.id)
    expect(superseded).toMatchObject({ temporalStatus: "superseded" })
  })

  it("reports temporal fact validation warnings and rejects unknown predicates on write", async () => {
    const weakManifestPath = path.join(tmpRoot, ".llm-wiki/codex-ingest/facts-validation-warning/changes.json")
    await write(
      weakManifestPath,
      JSON.stringify({
        $schema: "codex-ingest-manifest-v1",
        projectPath: tmpRoot,
        writes: [],
        factWrites: [
          {
            path: TEMPORAL_FACTS_RELATIVE_PATH,
            subject: "三孚新科",
            predicate: "HAS_ORDER",
            object: "mSAP电镀设备订单",
            claim: "微信群传闻三孚新科有 mSAP 订单，仍待公告验证。",
            status: "active",
            evidenceLevel: "D",
            sourceKind: "social_chat",
            sourcePath: "raw/微信聊天/2026-05-28.md",
          },
        ],
      }),
    )
    const weakReport = await applyManifest({ manifestPath: weakManifestPath })
    expect(weakReport.fatalFactIssues).toEqual([])
    expect(weakReport.factValidation.map((issue) => issue.field)).toEqual(expect.arrayContaining(["validAt", "evidenceLevel", "sourceKind"]))

    const badManifestPath = path.join(tmpRoot, ".llm-wiki/codex-ingest/facts-validation-fatal/changes.json")
    await write(
      badManifestPath,
      JSON.stringify({
        $schema: "codex-ingest-manifest-v1",
        projectPath: tmpRoot,
        writes: [],
        factWrites: [
          {
            path: TEMPORAL_FACTS_RELATIVE_PATH,
            subject: "三孚新科",
            predicate: "ORDER_STATUS",
            object: "mSAP电镀设备订单",
            claim: "未知 predicate 应被拒绝。",
            status: "active",
            validAt: "2026-05-28",
          },
        ],
      }),
    )
    const badDryRun = await applyManifest({ manifestPath: badManifestPath })
    expect(badDryRun.fatalFactIssues).toHaveLength(1)
    expect(badDryRun.fatalFactIssues[0]).toMatchObject({ field: "predicate" })
    await expect(applyManifest({ manifestPath: badManifestPath, write: true })).rejects.toThrow(/Unknown temporal fact predicate/)
  })

  it("refuses temporal fact writes outside the dedicated jsonl file", async () => {
    const manifestPath = path.join(tmpRoot, ".llm-wiki/codex-ingest/facts-bad-path/changes.json")
    await write(
      manifestPath,
      JSON.stringify({
        $schema: "codex-ingest-manifest-v1",
        projectPath: tmpRoot,
        writes: [],
        factWrites: [
          {
            path: "data/facts/cases.jsonl",
            subject: "三孚新科",
            predicate: "HAS_ORDER",
            object: "mSAP电镀设备订单",
            claim: "错误路径不应写入。",
          },
        ],
      }),
    )

    await expect(applyManifest({ manifestPath, write: true })).rejects.toThrow(/temporal_edges\.jsonl/)
  })

  it("write mode creates pages, appends log, and preserves raw source", async () => {
    const source = path.join(tmpRoot, "raw/研报新闻/2026-05-28-AI服务器电源.md")
    const rawBefore = await read(source)
    const prepared = await prepareIngest({ projectPath: tmpRoot, sourcePath: source, noReport: true })
    const manifestPath = path.join(tmpRoot, ".llm-wiki/codex-ingest/write-manifest/changes.json")
    const newPage = `${validFrontmatter("AI服务器电源涨价")}
# AI服务器电源涨价

## 概念定义
AI 服务器电源涨价反映算力扩张下的供电瓶颈。

## 相关页面
- [[概念/算电协同]]
`

    await write(
      manifestPath,
      JSON.stringify({
        $schema: "codex-ingest-manifest-v1",
        projectPath: tmpRoot,
        sourcePath: source,
        sourceHash: prepared.sourceHash,
        writes: [
          { action: "create", path: "wiki/概念/AI服务器电源涨价.md", content: newPage },
          { action: "append", path: "wiki/logs/log-2026-05-28.md", content: "## [2026-05-28] ingest | AI服务器电源\n- 新增 [[概念/AI服务器电源涨价]]" },
        ],
      }),
    )

    const report = await applyManifest({ manifestPath, write: true })
    expect(report.written).toEqual(["wiki/概念/AI服务器电源涨价.md", "wiki/logs/log-2026-05-28.md"])
    expect(await read(source)).toBe(rawBefore)
    expect(await read(path.join(tmpRoot, "wiki/概念/AI服务器电源涨价.md"))).toContain("[[概念/算电协同]]")
    expect(await read(path.join(tmpRoot, "wiki/logs/log-2026-05-28.md"))).toContain("AI服务器电源")
  })

  it("sag sync filters successful apply reports down to formal wiki pages", () => {
    expect(isSagSyncableWikiPath("wiki/概念/算电协同.md")).toBe(true)
    expect(isSagSyncableWikiPath("wiki/logs/log-2026-05-28.md")).toBe(false)
    expect(isSagSyncableWikiPath("wiki/scripts/tool.md")).toBe(false)
    expect(isSagSyncableWikiPath("raw/研报新闻/a.md")).toBe(false)

    const paths = syncablePathsFromApplyReport({
      dryRun: false,
      fatalIssues: [],
      fatalFactIssues: [],
      sourceHashBefore: "a",
      sourceHashAfter: "a",
      written: [
        "wiki/概念/算电协同.md",
        "wiki/logs/log-2026-05-28.md",
        "wiki/概念/算电协同.md",
        "raw/研报新闻/a.md",
      ],
    })
    expect(paths).toEqual(["wiki/概念/算电协同.md"])
    expect(syncablePathsFromApplyReport({ dryRun: true, written: ["wiki/概念/算电协同.md"] })).toEqual([])
    expect(syncablePathsFromApplyReport({ dryRun: false, fatalIssues: [{ path: "wiki/a.md" }], written: ["wiki/a.md"] })).toEqual([])
    expect(syncablePathsFromApplyReport({ dryRun: false, sourceHashBefore: "a", sourceHashAfter: "b", written: ["wiki/a.md"] })).toEqual([])
  })

  it("sag sync indexes a wiki file once and archives the prior document after content changes", async () => {
    const { fetchImpl, state } = makeFakeSagFetch()
    const first = await syncWikiFileToSag("wiki/概念/算电协同.md", { projectPath: tmpRoot, fetchImpl })
    expect(first).toMatchObject({ status: "indexed", path: "wiki/概念/算电协同.md", documentId: "doc-1" })
    expect(state.documents).toHaveLength(1)
    expect(state.documents[0].metadata.wikiPath).toBe("wiki/概念/算电协同.md")

    const skipped = await syncWikiFileToSag("wiki/概念/算电协同.md", { projectPath: tmpRoot, fetchImpl })
    expect(skipped).toMatchObject({ status: "skipped", reason: "unchanged_state" })
    expect(state.documents).toHaveLength(1)

    await write(
      path.join(tmpRoot, "wiki/概念/算电协同.md"),
      `${validFrontmatter("算电协同")}# 算电协同\n\nAI服务器电源新增证据。\n`,
    )
    const changed = await syncWikiFileToSag("wiki/概念/算电协同.md", { projectPath: tmpRoot, fetchImpl })
    expect(changed).toMatchObject({ status: "indexed", documentId: "doc-2", archivedPrevious: 1 })
    expect(state.documents.find((item) => item.id === "doc-1").archivedAt).toBeTruthy()
    expect(state.documents.find((item) => item.id === "doc-2").archivedAt).toBeNull()
  })

  it("sag sync treats oversized wiki pages as permanent skips instead of pending failures", async () => {
    const { fetchImpl, state } = makeFakeSagFetch()
    await write(
      path.join(tmpRoot, "wiki/概念/超大页面.md"),
      `${validFrontmatter("超大页面")}# 超大页面\n\n${"过大内容".repeat(200)}`,
    )

    const result = await syncWikiFileToSag("wiki/概念/超大页面.md", {
      projectPath: tmpRoot,
      fetchImpl,
      maxContentBytes: 100,
    })

    expect(result).toMatchObject({
      status: "skipped",
      reason: "content_too_large",
      path: "wiki/概念/超大页面.md",
      maxContentBytes: 100,
    })
    expect(state.documents).toHaveLength(0)
    expect(await readJsonl(path.join(tmpRoot, ".llm-wiki/sag-sync/pending.jsonl"))).toEqual([])
    const status = await sagSyncStatus({ projectPath: tmpRoot, fetchImpl })
    expect(status).toMatchObject({ indexedFiles: 0, skippedTooLarge: 1, trackedFiles: 1, pending: 0 })
  })

  it("sag wiki scan limit advances past unchanged files", async () => {
    const { fetchImpl, state } = makeFakeSagFetch()
    await write(path.join(tmpRoot, "wiki/00-first.md"), `${validFrontmatter("first")}# first\n\nfirst`)
    await write(path.join(tmpRoot, "wiki/00-second.md"), `${validFrontmatter("second")}# second\n\nsecond`)
    await syncWikiFileToSag("wiki/00-first.md", { projectPath: tmpRoot, fetchImpl })

    const result = await syncWikiTreeToSag({ projectPath: tmpRoot, fetchImpl, limit: 1 })

    expect(result.selectedFiles).toBe(1)
    expect(result.results[0]).toMatchObject({ status: "indexed", path: "wiki/00-second.md" })
    expect(state.documents.map((item) => item.metadata.wikiPath)).toEqual(["wiki/00-first.md", "wiki/00-second.md"])
  })

  it("sag wiki scan force reindexes unchanged files", async () => {
    const { fetchImpl, state } = makeFakeSagFetch()
    await write(path.join(tmpRoot, "wiki/00-first.md"), `${validFrontmatter("first")}# first\n\nfirst`)
    await syncWikiFileToSag("wiki/00-first.md", { projectPath: tmpRoot, fetchImpl })

    const result = await syncWikiTreeToSag({ projectPath: tmpRoot, fetchImpl, force: true, limit: 1 })

    expect(result.selectedFiles).toBe(1)
    expect(result.results[0]).toMatchObject({
      status: "indexed",
      path: "wiki/00-first.md",
      documentId: "doc-2",
      archivedPrevious: 1,
    })
    expect(state.documents.find((item) => item.id === "doc-1").archivedAt).toBeTruthy()
    expect(state.documents.find((item) => item.id === "doc-2").archivedAt).toBeNull()
  })

  it("sag wiki scan offset selects resumable force batches", async () => {
    const { fetchImpl, state } = makeFakeSagFetch()
    await write(path.join(tmpRoot, "wiki/00-a.md"), `${validFrontmatter("a")}# a\n\na`)
    await write(path.join(tmpRoot, "wiki/00-b.md"), `${validFrontmatter("b")}# b\n\nb`)
    await write(path.join(tmpRoot, "wiki/00-c.md"), `${validFrontmatter("c")}# c\n\nc`)

    const result = await syncWikiTreeToSag({ projectPath: tmpRoot, fetchImpl, force: true, limit: 1, offset: 1 })

    expect(result).toMatchObject({ offset: 1, selectedFiles: 1 })
    expect(result.results[0]).toMatchObject({ status: "indexed", path: "wiki/00-b.md" })
    expect(state.documents.map((item) => item.metadata.wikiPath)).toEqual(["wiki/00-b.md"])
  })

  it("sag sync can isolate blue-green state with a custom sync root", async () => {
    const { fetchImpl, state } = makeFakeSagFetch()
    await write(path.join(tmpRoot, "wiki/00-v1.md"), `${validFrontmatter("v1")}# v1\n\nv1`)
    await write(path.join(tmpRoot, "wiki/00-v2.md"), `${validFrontmatter("v2")}# v2\n\nv2`)

    await syncWikiFileToSag("wiki/00-v1.md", { projectPath: tmpRoot, fetchImpl })
    await syncWikiFileToSag("wiki/00-v2.md", {
      projectPath: tmpRoot,
      fetchImpl,
      syncRoot: ".llm-wiki/sag-sync-v2",
      sagProjectName: "Trading Review Wiki - Wiki Sidecar v2",
    })

    const v1Status = await sagSyncStatus({ projectPath: tmpRoot, fetchImpl })
    const v2Status = await sagSyncStatus({
      projectPath: tmpRoot,
      fetchImpl,
      syncRoot: ".llm-wiki/sag-sync-v2",
    })

    expect(v1Status).toMatchObject({ indexedFiles: 1, trackedFiles: 1 })
    expect(v2Status).toMatchObject({
      sagProjectName: "Trading Review Wiki - Wiki Sidecar v2",
      indexedFiles: 1,
      trackedFiles: 1,
    })
    expect(await read(path.join(tmpRoot, ".llm-wiki/sag-sync/state.json"))).toContain("wiki/00-v1.md")
    expect(await read(path.join(tmpRoot, ".llm-wiki/sag-sync-v2/state.json"))).toContain("wiki/00-v2.md")
    expect(state.projects.map((item) => item.name).sort()).toEqual([
      "Trading Review Wiki - Wiki Sidecar",
      "Trading Review Wiki - Wiki Sidecar v2",
    ])
  })

  it("sag report sync records pending failures without blocking wiki apply", async () => {
    const { fetchImpl } = makeFakeSagFetch({ failPaths: new Set(["wiki/概念/算电协同.md"]) })
    const reportPath = path.join(tmpRoot, ".llm-wiki/codex-ingest/sag-fail/apply-report.json")
    await write(
      reportPath,
      JSON.stringify({
        projectPath: tmpRoot,
        dryRun: false,
        fatalIssues: [],
        fatalFactIssues: [],
        sourceHashBefore: "ok",
        sourceHashAfter: "ok",
        written: ["wiki/概念/算电协同.md", "wiki/logs/log-2026-05-28.md"],
      }),
    )

    const result = await syncApplyReportToSag(reportPath, { projectPath: tmpRoot, fetchImpl })
    expect(result.pendingCount).toBe(1)
    expect(result.results[0]).toMatchObject({ status: "pending", path: "wiki/概念/算电协同.md" })
    expect(await read(path.join(tmpRoot, ".llm-wiki/sag-sync/pending.jsonl"))).toContain("wiki/概念/算电协同.md")
    expect(await read(path.join(tmpRoot, ".llm-wiki/sag-sync/pending.jsonl"))).not.toContain("secret")
  })

  it("sag wiki scan skips deduped pending paths and continues later files", async () => {
    const failing = makeFakeSagFetch({ failPaths: new Set(["wiki/00-a.md"]) })
    await write(path.join(tmpRoot, "wiki/00-a.md"), `${validFrontmatter("a")}# a\n\na`)
    await write(path.join(tmpRoot, "wiki/00-b.md"), `${validFrontmatter("b")}# b\n\nb`)
    await syncWikiTreeToSag({ projectPath: tmpRoot, fetchImpl: failing.fetchImpl, limit: 1 })
    const result = await syncWikiTreeToSag({ projectPath: tmpRoot, fetchImpl: failing.fetchImpl, limit: 1 })

    const status = await sagSyncStatus({ projectPath: tmpRoot, fetchImpl: failing.fetchImpl })
    expect(status.pending).toBe(1)
    expect(result.results[0]).toMatchObject({ status: "indexed", path: "wiki/00-b.md" })
  })

  it("post-apply sag hook is opt-in and non-blocking", async () => {
    const previousEnabled = process.env.SAG_SYNC_ENABLED
    const previousFetch = globalThis.fetch
    const { fetchImpl, state } = makeFakeSagFetch()
    process.env.SAG_SYNC_ENABLED = "1"
    globalThis.fetch = fetchImpl
    try {
      const manifestPath = path.join(tmpRoot, ".llm-wiki/codex-ingest/sag-hook/changes.json")
      const page = `${validFrontmatter("SAG同步测试")}# SAG同步测试\n\n这是一个 post-apply SAG 同步测试页面。\n`
      await write(
        manifestPath,
        JSON.stringify({
          $schema: "codex-ingest-manifest-v1",
          projectPath: tmpRoot,
          writes: [
            { action: "create", path: "wiki/概念/SAG同步测试.md", content: page },
            { action: "append", path: "wiki/logs/log-2026-06-18.md", content: "- SAG 同步测试" },
          ],
        }),
      )

      const report = await applyManifest({ manifestPath, write: true })
      expect(report.written).toEqual(["wiki/概念/SAG同步测试.md", "wiki/logs/log-2026-06-18.md"])
      expect(state.documents.map((item) => item.metadata.wikiPath)).toEqual(["wiki/概念/SAG同步测试.md"])
      const status = await sagSyncStatus({ projectPath: tmpRoot, fetchImpl })
      expect(status.indexedFiles).toBe(1)
      expect(status.pending).toBe(0)
    } finally {
      if (previousEnabled == null) delete process.env.SAG_SYNC_ENABLED
      else process.env.SAG_SYNC_ENABLED = previousEnabled
      globalThis.fetch = previousFetch
    }
  })

  it("sag pending retry clears successfully indexed records", async () => {
    const failing = makeFakeSagFetch({ failPaths: new Set(["wiki/概念/算电协同.md"]) })
    await syncWikiFileToSag("wiki/概念/电力运营商重估.md", { projectPath: tmpRoot, fetchImpl: failing.fetchImpl })
    const reportPath = path.join(tmpRoot, ".llm-wiki/codex-ingest/sag-pending/apply-report.json")
    await write(
      reportPath,
      JSON.stringify({
        projectPath: tmpRoot,
        dryRun: false,
        fatalIssues: [],
        fatalFactIssues: [],
        written: ["wiki/概念/算电协同.md"],
      }),
    )
    await syncApplyReportToSag(reportPath, { projectPath: tmpRoot, fetchImpl: failing.fetchImpl })

    const passing = makeFakeSagFetch()
    const retried = await retryPendingSagSync({ projectPath: tmpRoot, fetchImpl: passing.fetchImpl })
    expect(retried).toMatchObject({ retried: 1, remaining: 0 })
    expect(await read(path.join(tmpRoot, ".llm-wiki/sag-sync/pending.jsonl"))).toBe("")
  })

  it("create collision fails instead of writing a suffixed filename", async () => {
    const source = path.join(tmpRoot, "raw/研报新闻/2026-05-28-AI服务器电源.md")
    const prepared = await prepareIngest({ projectPath: tmpRoot, sourcePath: source, noReport: true })
    const manifestPath = path.join(tmpRoot, ".llm-wiki/codex-ingest/collision/changes.json")
    const page = `${validFrontmatter("算电协同")}
# 算电协同

## 相关页面
- [[概念/算电协同]]
`

    await write(
      manifestPath,
      JSON.stringify({
        $schema: "codex-ingest-manifest-v1",
        projectPath: tmpRoot,
        sourcePath: source,
        sourceHash: prepared.sourceHash,
        writes: [
          { action: "create", path: "wiki/概念/算电协同.md", content: page },
          { action: "append", path: "wiki/logs/log-2026-05-28.md", content: "- 新增 [[概念/算电协同]]" },
        ],
      }),
    )

    await expect(applyManifest({ manifestPath, write: true })).rejects.toThrow(/Create target already exists/)
  })

  it("refuses writes to the legacy root log", async () => {
    const source = path.join(tmpRoot, "raw/研报新闻/2026-05-28-AI服务器电源.md")
    const prepared = await prepareIngest({ projectPath: tmpRoot, sourcePath: source, noReport: true })
    const manifestPath = path.join(tmpRoot, ".llm-wiki/codex-ingest/legacy-log/changes.json")
    await write(
      manifestPath,
      JSON.stringify({
        $schema: "codex-ingest-manifest-v1",
        projectPath: tmpRoot,
        sourcePath: source,
        sourceHash: prepared.sourceHash,
        writes: [{ action: "append", path: "wiki/log.md", content: "- legacy" }],
      }),
    )

    await expect(applyManifest({ manifestPath, write: true })).rejects.toThrow(/legacy wiki\/log\.md/)
  })

  it("marks large housekeeping shrinkage fatal", async () => {
    const source = path.join(tmpRoot, "raw/研报新闻/2026-05-28-AI服务器电源.md")
    const prepared = await prepareIngest({ projectPath: tmpRoot, sourcePath: source, noReport: true })
    const manifestPath = path.join(tmpRoot, ".llm-wiki/codex-ingest/shrink/changes.json")
    await write(path.join(tmpRoot, "wiki/index.md"), `${validFrontmatter("index", "总结")}${Array.from({ length: 80 }, (_, i) => `line ${i}`).join("\n")}`)
    await write(
      manifestPath,
      JSON.stringify({
        $schema: "codex-ingest-manifest-v1",
        projectPath: tmpRoot,
        sourcePath: source,
        sourceHash: prepared.sourceHash,
        writes: [{ action: "update", path: "wiki/index.md", content: `${validFrontmatter("index", "总结")}# tiny\n` }],
      }),
    )

    const report = await applyManifest({ manifestPath, write: false })
    expect(report.fatalIssues[0]).toMatchObject({ path: "wiki/index.md", field: "preserve_existing_content" })
    await expect(applyManifest({ manifestPath, write: true })).rejects.toThrow(/preserve_existing_content/)
  })
})

describe("codex ingest staged api-run", () => {
  it("batch-run dry-runs sources concurrently and applies in source order", async () => {
    const sourceA = path.join(tmpRoot, "raw/研报新闻/batch-a.md")
    const sourceB = path.join(tmpRoot, "raw/研报新闻/batch-b.md")
    const sourceC = path.join(tmpRoot, "raw/研报新闻/batch-c.md")
    await write(sourceA, "# A")
    await write(sourceB, "# B")
    await write(sourceC, "# C")
    const apiStarted = []
    const applyOrder = []
    const apiRunImpl = async ({ sourcePath }) => {
      apiStarted.push(path.basename(sourcePath))
      if (sourcePath === sourceA) await sleep(30)
      const reportDir = path.join(tmpRoot, ".llm-wiki/codex-ingest", `batch-${path.basename(sourcePath, ".md")}`)
      const manifestPath = path.join(reportDir, "changes.json")
      await write(
        manifestPath,
        JSON.stringify({
          $schema: "codex-ingest-manifest-v1",
          projectPath: tmpRoot,
          sourcePath,
          writes: [
            {
              action: "append",
              path: "wiki/logs/log-2026-06-21.md",
              content: `- ${path.basename(sourcePath)}`,
            },
          ],
        }),
      )
      await write(path.join(reportDir, "apply-dry-run.json"), JSON.stringify({ dryRun: true, diffs: [] }))
      return { reportDir, manifestPath, dryRunReport: { reportPath: path.join(reportDir, "apply-dry-run.json") } }
    }
    const finalizeImpl = async ({ reportDir }) => ({
      reportDir,
      manifestPath: path.join(reportDir, "changes.json"),
      dryRunReport: { reportPath: path.join(reportDir, "apply-dry-run.json") },
    })
    const applyImpl = async ({ manifestPath }) => {
      const manifest = JSON.parse(await read(manifestPath))
      applyOrder.push(path.basename(manifest.sourcePath))
      const reportPath = path.join(path.dirname(manifestPath), "apply-report.json")
      await write(reportPath, JSON.stringify({ dryRun: false, diffs: [], written: [] }))
      return { reportPath, dryRun: false, diffs: [], written: [] }
    }

    const batch = await runBatchIngest({
      projectPath: tmpRoot,
      sources: [sourceA, sourceB, sourceC],
      write: true,
      apiConcurrency: 2,
      apiRunImpl,
      finalizeImpl,
      applyImpl,
      batchId: "ordered",
    })

    expect(apiStarted.slice(0, 2).sort()).toEqual(["batch-a.md", "batch-b.md"])
    expect(applyOrder).toEqual(["batch-a.md", "batch-b.md", "batch-c.md"])
    expect(batch.writeConcurrency).toBe(1)
    expect(batch.status).toBe("ok")
    expect(JSON.parse(await read(path.join(batch.batchDir, "batch-manifest.json"))).counts).toEqual({ applied: 3 })
  })

  it("batch-run dry-run reports preflight target conflicts without writing", async () => {
    const source = path.join(tmpRoot, "raw/研报新闻/batch-preflight.md")
    await write(source, "# preflight")
    const apiRunImpl = async ({ sourcePath }) => {
      const reportDir = path.join(tmpRoot, ".llm-wiki/codex-ingest", "batch-preflight")
      const manifestPath = path.join(reportDir, "changes.json")
      await write(
        manifestPath,
        JSON.stringify({
          $schema: "codex-ingest-manifest-v1",
          projectPath: tmpRoot,
          sourcePath,
          writes: [
            {
              action: "create",
              path: "wiki/概念/算电协同.md",
              content: `${validFrontmatter("算电协同")}# 算电协同\n`,
            },
          ],
        }),
      )
      await write(path.join(reportDir, "apply-dry-run.json"), JSON.stringify({ dryRun: true, diffs: [] }))
      return { reportDir, manifestPath, dryRunReport: { reportPath: path.join(reportDir, "apply-dry-run.json") } }
    }

    const batch = await runBatchIngest({
      projectPath: tmpRoot,
      sources: [source],
      write: false,
      apiRunImpl,
      batchId: "dry-preflight",
    })

    expect(batch.status).toBe("needs_attention")
    expect(batch.tasks[0]).toMatchObject({
      status: "blocked",
      conflicts: [expect.objectContaining({ path: "wiki/概念/算电协同.md", reason: "create_target_exists" })],
    })
  })

  it("batch-run reruns a source once when a core page changed before write", async () => {
    const sourceA = path.join(tmpRoot, "raw/研报新闻/core-a.md")
    const sourceB = path.join(tmpRoot, "raw/研报新闻/core-b.md")
    await write(sourceA, "# A")
    await write(sourceB, "# B")
    const pagePath = path.join(tmpRoot, "wiki/概念/算电协同.md")
    const apiCounts = new Map()
    const apiRunImpl = async ({ sourcePath }) => {
      const count = (apiCounts.get(sourcePath) ?? 0) + 1
      apiCounts.set(sourcePath, count)
      const reportDir = path.join(tmpRoot, ".llm-wiki/codex-ingest", `${path.basename(sourcePath, ".md")}-${count}`)
      const manifestPath = path.join(reportDir, "changes.json")
      const before = await read(pagePath)
      const marker = sourcePath === sourceA ? "source-a" : count === 1 ? "source-b-first" : "source-b-rerun"
      await write(
        manifestPath,
        JSON.stringify({
          $schema: "codex-ingest-manifest-v1",
          projectPath: tmpRoot,
          sourcePath,
          writes: [
            {
              action: "update",
              path: "wiki/概念/算电协同.md",
              content: `${before}\n\n## ${marker}\n`,
            },
          ],
        }),
      )
      await write(path.join(reportDir, "apply-dry-run.json"), JSON.stringify({ dryRun: true, diffs: [] }))
      return { reportDir, manifestPath, dryRunReport: { reportPath: path.join(reportDir, "apply-dry-run.json") } }
    }
    const finalizeImpl = async ({ reportDir }) => ({
      reportDir,
      manifestPath: path.join(reportDir, "changes.json"),
      dryRunReport: { reportPath: path.join(reportDir, "apply-dry-run.json") },
    })

    const batch = await runBatchIngest({
      projectPath: tmpRoot,
      sources: [sourceA, sourceB],
      write: true,
      apiConcurrency: 2,
      apiRunImpl,
      finalizeImpl,
      batchId: "core-rerun",
    })

    const finalPage = await read(pagePath)
    expect(apiCounts.get(sourceB)).toBe(2)
    expect(finalPage).toContain("## source-a")
    expect(finalPage).toContain("## source-b-rerun")
    expect(finalPage).not.toContain("source-b-first")
    expect(batch.tasks[1]).toMatchObject({ status: "applied", rerunCount: 1 })
  })

  it("batch-run refreshes housekeeping hashes so sequential log appends do not block", async () => {
    const sourceA = path.join(tmpRoot, "raw/研报新闻/house-a.md")
    const sourceB = path.join(tmpRoot, "raw/研报新闻/house-b.md")
    await write(sourceA, "# A")
    await write(sourceB, "# B")
    const apiRunImpl = async ({ sourcePath }) => {
      const reportDir = path.join(tmpRoot, ".llm-wiki/codex-ingest", `house-${path.basename(sourcePath, ".md")}`)
      const manifestPath = path.join(reportDir, "changes.json")
      await write(
        manifestPath,
        JSON.stringify({
          $schema: "codex-ingest-manifest-v1",
          projectPath: tmpRoot,
          sourcePath,
          writes: [
            {
              action: "append",
              path: "wiki/logs/log-2026-06-21.md",
              content: `- ${path.basename(sourcePath)}`,
            },
          ],
        }),
      )
      await write(path.join(reportDir, "apply-dry-run.json"), JSON.stringify({ dryRun: true, diffs: [] }))
      return { reportDir, manifestPath, dryRunReport: { reportPath: path.join(reportDir, "apply-dry-run.json") } }
    }
    const finalizeImpl = async ({ reportDir }) => ({
      reportDir,
      manifestPath: path.join(reportDir, "changes.json"),
      dryRunReport: { reportPath: path.join(reportDir, "apply-dry-run.json") },
    })

    const batch = await runBatchIngest({
      projectPath: tmpRoot,
      sources: [sourceA, sourceB],
      write: true,
      apiConcurrency: 2,
      apiRunImpl,
      finalizeImpl,
      batchId: "housekeeping",
    })

    const log = await read(path.join(tmpRoot, "wiki/logs/log-2026-06-21.md"))
    expect(log).toContain("house-a.md")
    expect(log).toContain("house-b.md")
    expect(batch.tasks.map((task) => task.status)).toEqual(["applied", "applied"])
  })

  it("builds a safe non-interactive Codex exec invocation", () => {
    const invocation = buildCodexExecInvocation({
      codexBin: "/Applications/Codex.app/Contents/Resources/codex",
      projectPath: tmpRoot,
      outputPath: path.join(tmpRoot, ".llm-wiki/out.md"),
      model: "gpt-5-codex",
      profile: "default",
    })

    expect(invocation.command).toBe("/Applications/Codex.app/Contents/Resources/codex")
    expect(invocation.args).toEqual([
      "-m",
      "gpt-5-codex",
      "-p",
      "default",
      "-s",
      "read-only",
      "-a",
      "never",
      "exec",
      "--skip-git-repo-check",
      "-C",
      tmpRoot,
      "--output-last-message",
      path.join(tmpRoot, ".llm-wiki/out.md"),
      "-",
    ])
  })

  it("normalizes plan create/update entries based on real files", async () => {
    const plan = await normalizeIngestPlan(
      tmpRoot,
      {
        create: [{ path: "wiki/概念/算电协同.md", type: "概念", title: "算电协同", why: "已有页应更新" }],
        update: [{ path: "wiki/概念/新AIDC概念.md", why: "不存在页应新建" }],
      },
      "2026-05-28-AI服务器电源",
    )

    expect(plan.update.map((item) => item.path)).toContain("wiki/概念/算电协同.md")
    expect(plan.create.map((item) => item.path)).toContain("wiki/概念/新AIDC概念.md")
    expect(plan.create[0].path).toBe("wiki/sources/2026-05-28-AI服务器电源.md")
  })

  it("creates staged artifacts, manifest, source archive, updated page, and housekeeping dry-run", async () => {
    const source = path.join(tmpRoot, "raw/研报新闻/2026-05-28-AI服务器电源.md")
    const calls = []
    const page = (title, type = "概念", body = `# ${title}\n\n## 概念定义\n测试内容。`) => `${validFrontmatter(title, type)}${body}\n`

    const result = await apiRunIngest({
      projectPath: tmpRoot,
      sourcePath: source,
      reportId: "staged",
      requestText: async ({ stage, prompt }) => {
        calls.push(stage)
        if (stage === "analysis") {
          return [
            "# 2026-05-28 AI服务器电源核心结论",
            "",
            "## 建议更新已有页面",
            "- [[概念/算电协同]]",
            "",
            "## 建议新建页面",
            "- [[概念/新AIDC概念]]",
          ].join("\n")
        }
        if (stage === "plan") {
          return [
            "```json",
            JSON.stringify({
              create: [{ path: "wiki/概念/新AIDC概念.md", type: "概念", title: "新AIDC概念", why: "新概念" }],
              update: [{ path: "wiki/概念/算电协同.md", why: "追加 AI 服务器电源 evidence" }],
            }),
            "```",
          ].join("\n")
        }
        if (stage === "file" && prompt.includes("wiki/sources/2026-05-28-AI服务器电源.md")) {
          return `---FILE: wiki/sources/2026-05-28-AI服务器电源.md---\n${page("2026-05-28-AI服务器电源", "源文档", "# 2026-05-28 AI服务器电源源文档\n\n清洗后的证据归档。")}\n---END FILE---`
        }
        if (stage === "file" && prompt.includes("wiki/概念/算电协同.md")) {
          return `---FILE: wiki/概念/算电协同.md---\n${page("算电协同", "概念", "# 算电协同\n\nAI 服务器电源需求、数据中心供电和电力运营商重估共同构成观察框架。\n\n## 2026-05-28 新增验证\n本次 source 追加 AI 服务器电源 evidence。")}\n---END FILE---`
        }
        if (stage === "file" && prompt.includes("wiki/概念/新AIDC概念.md")) {
          return `---FILE: wiki/概念/新AIDC概念.md---\n${page("新AIDC概念", "概念", "# 新AIDC概念\n\n## 概念定义\nAIDC 新证据页。")}\n---END FILE---`
        }
        throw new Error(`unexpected stage ${stage}`)
      },
    })

    expect(calls).toEqual(["analysis", "plan", "file", "file", "file"])
    expect(await read(result.analysisPath)).toContain("核心结论")
    expect(JSON.parse(await read(result.planJsonPath)).create.map((item) => item.path)).toContain("wiki/概念/新AIDC概念.md")
    const manifest = JSON.parse(await read(result.manifestPath))
    const logPath = `wiki/logs/log-${result.createdAt.slice(0, 10)}.md`
    expect(manifest.writes.map((item) => item.path)).toEqual([
      "wiki/sources/2026-05-28-AI服务器电源.md",
      "wiki/概念/算电协同.md",
      "wiki/概念/新AIDC概念.md",
      "wiki/index.md",
      "wiki/overview.md",
      logPath,
    ])
    expect(result.dryRunReport.dryRun).toBe(true)
    await expect(fs.access(path.join(result.filesDir, "999-housekeeping.md"))).resolves.toBeUndefined()
    expect(await read(path.join(result.filesDir, "999-housekeeping.md"))).toContain(`---FILE: ${logPath}---`)
    expect(manifest.writes.find((item) => item.path === "wiki/index.md")?.content).toContain("[[概念/新AIDC概念]]")
    expect(manifest.writes.find((item) => item.path === "wiki/overview.md")?.content).toContain("## Recent Ingests")
    await expect(fs.access(path.join(tmpRoot, "wiki/概念/新AIDC概念.md"))).rejects.toThrow()
  })

  it("records soft plan-budget warnings without stopping broad ingests", async () => {
    const source = path.join(tmpRoot, "raw/研报新闻/2026-05-28-AI服务器电源.md")
    const calls = []
    const pageFor = (filePath) => {
      const title = path.basename(filePath, ".md")
      const type = filePath.startsWith("wiki/sources/") ? "源文档" : "概念"
      return `---FILE: ${filePath}---\n${validFrontmatter(title, type)}# ${title}\n\n## 摄入记录\n这是用于测试预算提示的页面内容，证明宽计划不会被页数保护直接中止。\n---END FILE---`
    }

    const result = await apiRunIngest({
      projectPath: tmpRoot,
      sourcePath: source,
      reportId: "budget-stop",
      maxPlanItems: 2,
      requestText: async ({ stage, prompt }) => {
        calls.push(stage)
        if (stage === "analysis") return "# analysis\n\n建议更新多个页面。"
        if (stage === "plan") {
          return [
            "```json",
            JSON.stringify({
              create: [{ path: "wiki/概念/新AIDC概念.md", type: "概念", title: "新AIDC概念", why: "新建" }],
              update: [
                { path: "wiki/概念/算电协同.md", why: "更新" },
                { path: "wiki/概念/AI应用板块.md", why: "更新" },
              ],
            }),
            "```",
          ].join("\n")
        }
        const filePath = prompt.match(/---FILE:\s*(wiki\/[^\n]+?)---/)?.[1]
        if (stage === "file" && filePath) return pageFor(filePath)
        throw new Error(`unexpected stage ${stage}`)
      },
    })

    expect(calls).toEqual(["analysis", "plan", "file", "file", "file", "file"])
    expect(result.planBudget.warnings[0]).toContain("exceeds --max-plan-items 2")
    expect(JSON.parse(await read(result.planBudgetPath)).warnings.length).toBeGreaterThan(0)
    await expect(fs.access(path.join(tmpRoot, ".llm-wiki/codex-ingest/budget-stop/plan.json"))).resolves.toBeUndefined()
    await expect(fs.access(path.join(tmpRoot, ".llm-wiki/codex-ingest/budget-stop/changes.json"))).resolves.toBeUndefined()
    await expect(fs.access(path.join(tmpRoot, ".llm-wiki/codex-ingest/budget-stop/files"))).resolves.toBeUndefined()
  })

  it("runs sharded WeChat analysis, merges one manifest, and injects source mainline index", async () => {
    const source = path.join(tmpRoot, "raw/微信聊天/2026-06-12.md")
    const windows = Array.from({ length: 12 }, (_, i) => {
      const hh = String(i).padStart(2, "0")
      return [
        `## ${hh}:00:00 舆情更新`,
        "",
        "### 主线归因",
        "",
        "主线｜热度｜命中群｜原文数",
        `- 分片主线${i + 1}/AI材料 | ★★★★ | 核心群(${i + 1}) | 1`,
        "",
        "### 完整调研原文",
        "```",
        `${"AI材料 分片主线 ".repeat(700)}`,
        "```",
      ].join("\n")
    })
    await write(source, ["# 2026-06-12 微信舆情", "", ...windows].join("\n\n"))

    const calls = []
    const page = (title, type = "概念", body = `# ${title}\n\n## 概念定义\n测试内容。`) => `${validFrontmatter(title, type)}${body}\n`
    const result = await apiRunIngest({
      projectPath: tmpRoot,
      sourcePath: source,
      reportId: "wechat-sharded-api-run",
      maxShardChars: 12000,
      shardConcurrency: 2,
      requestText: async ({ stage, prompt }) => {
        calls.push(stage)
        if (stage.startsWith("shard-")) {
          expect(prompt).toContain("分片主线索引")
          return `# ${stage} analysis\n\n覆盖本分片 AI材料 主线。`
        }
        if (stage === "analysis") {
          expect(prompt).toContain("Shard Analyses")
          expect(prompt).toContain("分片主线1/AI材料")
          return "# 合并分析\n\nAI材料主线需要更新算电协同，并归档 source。"
        }
        if (stage === "plan") {
          return [
            "```json",
            JSON.stringify({
              update: [{ path: "wiki/概念/算电协同.md", why: "追加 AI 材料与算力链 evidence" }],
              factWrites: [
                { path: "data/facts/temporal_edges.jsonl", subject: "AI材料", predicate: "HAS_PRICE_SIGNAL", object: "分片主线", claim: "微信群聊观察项：AI材料分片主线发酵，待验证。", status: "active", evidenceLevel: "C", sourceKind: "social_chat", sourceDate: "2026-06-12", wikiPath: "wiki/概念/算电协同.md" },
                { path: "data/facts/temporal_edges.jsonl", subject: "AI材料", predicate: "HAS_PRICE_SIGNAL", object: "分片主线", claim: "同一窗口随后出现反证讨论，AI材料分片主线需要降级观察。", status: "invalidated", evidenceLevel: "C", sourceKind: "social_chat", sourceDate: "2026-06-12", wikiPath: "wiki/概念/算电协同.md" },
              ],
            }),
            "```",
          ].join("\n")
        }
        if (stage === "file" && prompt.includes("wiki/sources/2026-06-12.md")) {
          return `---FILE: wiki/sources/2026-06-12.md---\n${page("2026-06-12", "源文档", "# 2026-06-12\n\n## 档案定位\n清洗后的微信舆情源文档。\n")}\n---END FILE---`
        }
        if (stage === "file" && prompt.includes("wiki/概念/算电协同.md")) {
          return `---FILE: wiki/概念/算电协同.md---\n${page("算电协同", "概念", "# 算电协同\n\nAI材料和算力链进入观察。\n")}\n---END FILE---`
        }
        throw new Error(`unexpected stage ${stage}`)
      },
    })

    expect(calls.filter((stage) => stage.startsWith("shard-")).length).toBeGreaterThan(1)
    expect(calls).toContain("analysis")
    expect(result.sourceSharding.enabled).toBe(true)
    expect(result.coverageReview.totalMainlines).toBe(12)
    expect(result.coverageReview.coveredMainlines).toBe(12)
    expect(result.plan.factWrites).toHaveLength(2)
    const manifest = JSON.parse(await read(result.manifestPath))
    expect(manifest.factWrites).toHaveLength(2)
    expect(result.dryRunReport.plannedFactWrites).toHaveLength(2)
    expect(result.dryRunReport.plannedFactWrites.map((item) => item.status).sort()).toEqual(["active", "invalidated"])
    const sourceWrite = manifest.writes.find((item) => item.path === "wiki/sources/2026-06-12.md")
    expect(sourceWrite.content).toContain("<!-- codex-source-mainline-index:start -->")
    expect(sourceWrite.content).toContain("分片主线12/AI材料")
    expect(manifest.writes.some((item) => item.path.startsWith("raw/"))).toBe(false)
    await expect(fs.access(path.join(result.reportDir, "source-coverage-review.json"))).resolves.toBeUndefined()
    await expect(fs.access(path.join(result.reportDir, "shard-analyses"))).resolves.toBeUndefined()
    expect(result.dryRunReport.fatalIssues).toEqual([])
  })
})

describe("wiki hygiene", () => {
  it("audits and plans without changing raw or formal wiki pages", async () => {
    const rawPath = path.join(tmpRoot, "raw/研报新闻/2026-05-28-AI服务器电源.md")
    const wikiPath = path.join(tmpRoot, "wiki/概念/算电协同.md")
    const rawBefore = await read(rawPath)
    const wikiBefore = await read(wikiPath)

    const oldReportDir = path.join(tmpRoot, ".llm-wiki/codex-ingest/old-success")
    await write(path.join(oldReportDir, "apply-report.json"), JSON.stringify({ dryRun: false, written: ["wiki/概念/X.md"] }))
    const oldDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    await fs.utimes(oldReportDir, oldDate, oldDate)

    const audit = await runHygiene({ projectPath: tmpRoot, action: "audit", keepDays: 14 })
    expect(audit.dryRun).toBe(true)
    expect(audit.audit.safety.rawWrites).toBe("never")

    const plan = await runHygiene({ projectPath: tmpRoot, action: "plan", keepDays: 14 })
    expect(plan.dryRun).toBe(true)
    expect(plan.plan.actions.map((item) => item.relativePath)).toContain(".llm-wiki/codex-ingest/old-success")

    const applyDryRun = await runHygiene({ projectPath: tmpRoot, action: "apply", keepDays: 14 })
    expect(applyDryRun.dryRun).toBe(true)
    await expect(fs.access(oldReportDir)).resolves.toBeUndefined()

    const applied = await runHygiene({ projectPath: tmpRoot, action: "apply", keepDays: 14, write: true })
    expect(applied.dryRun).toBe(false)
    expect(applied.applied.map((item) => item.relativePath)).toContain(".llm-wiki/codex-ingest/old-success")
    await expect(fs.access(oldReportDir)).rejects.toThrow()
    expect(await read(rawPath)).toBe(rawBefore)
    expect(await read(wikiPath)).toBe(wikiBefore)
  })
})

describe("company research", () => {
  function tushareResponse(fields, items) {
    return { code: 0, msg: null, data: { fields, items } }
  }

  it("writes a separate company research pack without leaking secrets or touching wiki/raw", async () => {
    await write(
      path.join(tmpRoot, "wiki/股票/洁美科技.md"),
      `${validFrontmatter("洁美科技", "股票", "code: SZ002859\nindustry: 电子元件\n")}# 洁美科技\n\nMLCC 离型膜和载带业务需要结合公告验证。\n`,
    )
    await write(
      path.join(tmpRoot, "wiki/概念/MLCC.md"),
      `${validFrontmatter("MLCC")}# MLCC\n\n被动元件上游材料和离型膜是潜在约束环节。\n`,
    )
    const wikiBefore = await read(path.join(tmpRoot, "wiki/股票/洁美科技.md"))
    const rawPath = path.join(tmpRoot, "raw/研报新闻/2026-05-28-AI服务器电源.md")
    const rawBefore = await read(rawPath)
    const tushareCalls = []

    const result = await runCompanyResearch({
      projectPath: tmpRoot,
      stock: "002859",
      from: "2026-01-01",
      to: "2026-06-07",
      reportId: "company-research-test",
      tushareToken: "fake-tushare-test-token",
      tavilyApiKey: "fake-tavily-test-key",
      cninfoClient: async () => ({
        status: "success",
        requests: [{ key: "洁美科技", url: "https://www.cninfo.com.cn/mock" }],
        announcements: [
          {
            id: "ann-annual",
            secCode: "002859",
            secName: "洁美科技",
            title: "洁美科技：2025年年度报告",
            date: "2026-04-22",
            announcementTime: Date.parse("2026-04-22"),
            adjunctType: "PDF",
            downloadUrl: "https://static.cninfo.com.cn/finalpage/mock-annual.pdf",
            type: "annual_report",
          },
          {
            id: "ann-event",
            secCode: "002859",
            secName: "洁美科技",
            title: "洁美科技：重大资产收购预案",
            date: "2026-06-02",
            announcementTime: Date.parse("2026-06-02"),
            adjunctType: "PDF",
            downloadUrl: "https://static.cninfo.com.cn/finalpage/mock-event.pdf",
            type: "event",
          },
        ],
      }),
      cninfoDownloader: async ({ announcement }) => Buffer.from(`%PDF-1.4\n${announcement.id}\n%%EOF\n`),
      tushareClient: async ({ apiName, params }) => {
        tushareCalls.push({ apiName, params })
        if (apiName === "stock_basic") {
          return tushareResponse(["ts_code", "symbol", "name", "area", "industry", "market", "list_date"], [["002859.SZ", "002859", "洁美科技", "浙江", "电子元件", "主板", "20170407"]])
        }
        if (apiName === "income") {
          return tushareResponse(["ts_code", "end_date", "revenue", "n_income_attr_p"], [["002859.SZ", "20251231", 2101000000, 235000000]])
        }
        if (apiName === "balancesheet") {
          return tushareResponse(["ts_code", "end_date", "total_assets", "total_liab"], [["002859.SZ", "20251231", 7200000000, 2500000000]])
        }
        if (apiName === "cashflow") {
          return tushareResponse(["ts_code", "end_date", "n_cashflow_act"], [["002859.SZ", "20251231", 350000000]])
        }
        if (apiName === "fina_indicator") {
          return tushareResponse(["ts_code", "end_date", "grossprofit_margin", "netprofit_margin", "roe"], [["002859.SZ", "20251231", 32.5, 11.2, 6.8]])
        }
        if (apiName === "daily_basic") {
          return tushareResponse(["ts_code", "trade_date", "close", "pe_ttm", "pb", "total_mv", "circ_mv"], [["002859.SZ", "20260605", 80.4, 148, 6.2, 3470000, 3300000]])
        }
        return tushareResponse(["ts_code", "ann_date"], [])
      },
      tavilyClient: async ({ query }) => ({
        results: [
          { title: `${query} result`, url: "https://example.com/research", content: "MLCC 离型膜 技术能力 对比", score: 0.91 },
        ],
      }),
      stockDailyColumns: ["ticker", "date", "close", "amount", "pct_cng"],
      stockDailyExecutor: async () => ({
        rows: [
          { ticker: "002859.SZ", date: "2026-06-04", close: 78.5, amount: 100000000, pct_cng: 2.1 },
          { ticker: "002859.SZ", date: "2026-06-05", close: 80.4, amount: 130000000, pct_cng: 2.42 },
        ],
        rowCount: 2,
      }),
    })

    expect(result.outputDir).toBe(".llm-wiki/company-research/company-research-test")
    expect(result.writePolicy).toMatchObject({ wroteRaw: false, wroteFormalWiki: false })
    expect(result.providers.tushare).toMatchObject({ configured: true, status: "success" })
    expect(result.providers.tavily).toMatchObject({ configured: true, status: "success" })
    expect(result.providers.cninfo.downloads).toBe(2)
    expect(tushareCalls.find((call) => call.apiName === "income")?.params.start_date).toBe("20210101")

    const report = await read(path.join(tmpRoot, result.outputs.report))
    expect(report).toContain("数据拉取确认表")
    expect(report).toContain("洁美科技")
    expect(report).toContain("基础财务模型只使用 A/B 级证据")

    const ledger = JSON.parse(await read(path.join(tmpRoot, result.outputs.evidenceLedger)))
    expect(ledger.rows.map((row) => row.evidenceLevel)).toEqual(expect.arrayContaining(["A", "B", "C"]))
    expect(ledger.rows.some((row) => row.tool === "cninfo_pdf_download" && row.status === "success")).toBe(true)

    const modelJson = JSON.parse(await read(path.join(tmpRoot, result.outputs.modelJson)))
    expect(modelJson.sheets).toEqual(expect.arrayContaining(["Summary", "Assumptions", "Historical", "Forecast", "Segment Model", "Valuation", "Sensitivity", "Evidence"]))
    const xlsx = await import("xlsx")
    const workbook = xlsx.readFile(path.join(tmpRoot, result.outputs.modelXlsx), { cellFormula: true })
    expect(workbook.SheetNames).toEqual(expect.arrayContaining(["Summary", "Valuation", "Evidence"]))
    expect(workbook.Sheets.Valuation.B2.f).toBe("Forecast!C4*0.85")

    const textOutputs = [
      await read(path.join(tmpRoot, result.outputs.runSummary)),
      await read(path.join(tmpRoot, result.outputs.evidencePack)),
      await read(path.join(tmpRoot, result.outputs.report)),
      await read(path.join(tmpRoot, result.outputs.wikiCandidates)),
    ].join("\n")
    expect(textOutputs).not.toContain("fake-tushare-test-token")
    expect(textOutputs).not.toContain("fake-tavily-test-key")
    expect(await read(path.join(tmpRoot, "wiki/股票/洁美科技.md"))).toBe(wikiBefore)
    expect(await read(rawPath)).toBe(rawBefore)
  })

  it("retries Tushare financial tables after resolving a stock name to ts_code", async () => {
    await write(
      path.join(tmpRoot, "wiki/股票/利通电子.md"),
      `${validFrontmatter("利通电子", "股票", "code: SH603629\nindustry: 元器件\n")}# 利通电子\n\n算力业务和精密结构件需要结合公告验证。\n`,
    )
    const calls = []
    const result = await runCompanyResearch({
      projectPath: tmpRoot,
      stock: "利通电子",
      from: "2026-01-01",
      to: "2026-06-15",
      reportId: "company-research-name-retry-test",
      tushareToken: "fake-tushare-test-token",
      disableSseFallback: true,
      cninfoClient: async () => ({
        status: "success",
        requests: [{ key: "利通电子", url: "https://www.cninfo.com.cn/mock" }],
        announcements: [],
      }),
      tushareClient: async ({ apiName, params }) => {
        calls.push({ apiName, params })
        if (apiName === "stock_basic") {
          return params.ts_code
            ? tushareResponse(["ts_code", "symbol", "name", "area", "industry", "market", "list_date"], [["603629.SH", "603629", "利通电子", "江苏", "元器件", "主板", "20181224"]])
            : tushareResponse(["ts_code", "symbol", "name", "area", "industry", "market", "list_date"], [["603629.SH", "603629", "利通电子", "江苏", "元器件", "主板", "20181224"]])
        }
        if (!params.ts_code) {
          return { code: -2001, msg: "必填参数, ts_code", data: { fields: [], items: [] } }
        }
        if (apiName === "income") {
          return tushareResponse(["ts_code", "end_date", "revenue", "operate_profit", "n_income_attr_p", "rd_exp"], [["603629.SH", "20251231", 3266000000, 315000000, 230000000, 41000000]])
        }
        if (apiName === "balancesheet") {
          return tushareResponse(["ts_code", "end_date", "total_assets", "total_liab", "fix_assets", "cip", "inventories", "accounts_receiv", "total_share"], [["603629.SH", "20251231", 6200000000, 3100000000, 1500000000, 180000000, 460000000, 520000000, 448000000]])
        }
        if (apiName === "cashflow") {
          return tushareResponse(["ts_code", "end_date", "n_cashflow_act", "c_pay_acq_const_fiolta"], [["603629.SH", "20251231", 260000000, 140000000]])
        }
        if (apiName === "fina_indicator") {
          return tushareResponse(["ts_code", "end_date", "grossprofit_margin", "netprofit_margin", "roe"], [["603629.SH", "20251231", 21.2, 7.04, 8.9]])
        }
        if (apiName === "daily_basic") {
          return tushareResponse(["ts_code", "trade_date", "close", "pe_ttm", "pb", "total_mv", "circ_mv"], [["603629.SH", "20260615", 13.28, 26.0, 2.3, 595900, 595900]])
        }
        return tushareResponse(["ts_code", "ann_date"], [])
      },
      stockDailyColumns: ["ticker", "date", "close"],
      stockDailyExecutor: async () => ({ rows: [], rowCount: 0 }),
    })

    expect(result.company).toMatchObject({ tsCode: "603629.SH", stockName: "利通电子" })
    expect(result.providerEvents.some((event) => event.stage === "tushare-resolved" && event.status === "success")).toBe(true)
    expect(calls.some((call) => call.apiName === "income" && !call.params.ts_code)).toBe(true)
    expect(calls.some((call) => call.apiName === "income" && call.params.ts_code === "603629.SH")).toBe(true)
    expect(result.financials.metrics.revenue).toBe(3266000000)
    const report = await read(path.join(tmpRoot, result.outputs.report))
    expect(report).toContain("营业收入")
    expect(report).not.toContain("fake-tushare-test-token")
  })

  it("times out a stuck company research provider and continues with degraded evidence", async () => {
    await write(
      path.join(tmpRoot, "wiki/股票/洁美科技.md"),
      `${validFrontmatter("洁美科技", "股票", "code: SZ002859\nindustry: 电子元件\n")}# 洁美科技\n\nMLCC 离型膜和载带业务需要结合公告验证。\n`,
    )
    const progress = []

    const result = await runCompanyResearch({
      projectPath: tmpRoot,
      stock: "002859",
      from: "2026-06-01",
      to: "2026-06-07",
      reportId: "company-research-timeout-test",
      companyProviderTimeoutMs: 20,
      disableSseFallback: true,
      onProgress: (message) => progress.push(message),
      cninfoClient: async () => new Promise(() => {}),
      tushareToken: "fake-tushare-test-token",
      tushareClient: async ({ apiName }) => {
        if (apiName === "stock_basic") {
          return tushareResponse(["ts_code", "symbol", "name", "area", "industry", "market", "list_date"], [["002859.SZ", "002859", "洁美科技", "浙江", "电子元件", "主板", "20170407"]])
        }
        if (apiName === "income") {
          return tushareResponse(["ts_code", "end_date", "revenue", "n_income_attr_p"], [["002859.SZ", "20251231", 2101000000, 235000000]])
        }
        return tushareResponse(["ts_code", "end_date"], [])
      },
      stockDailyColumns: ["ticker", "date", "close"],
      stockDailyExecutor: async () => ({ rows: [], rowCount: 0 }),
    })

    expect(result.providers.cninfo.status).toBe("failed")
    expect(result.providers.cninfo.error).toContain("timed out")
    expect(result.providerEvents.some((event) => event.stage === "cninfo" && event.status === "failed")).toBe(true)
    expect(progress.some((message) => message.includes("cninfo") && message.includes("failed"))).toBe(true)
    await expect(fs.access(path.join(tmpRoot, result.outputs.report))).resolves.toBeUndefined()
    const textOutputs = [
      await read(path.join(tmpRoot, result.outputs.runSummary)),
      await read(path.join(tmpRoot, result.outputs.evidencePack)),
    ].join("\n")
    expect(textOutputs).not.toContain("fake-tushare-test-token")
  })

  it("adds deep company research artifacts with manual-needed guardrails", async () => {
    await write(
      path.join(tmpRoot, "wiki/股票/洁美科技.md"),
      `${validFrontmatter("洁美科技", "股票", "code: SZ002859\nindustry: 电子元件\n")}# 洁美科技\n\nMLCC 离型膜和载带业务需要结合公告验证。\n`,
    )
    const wikiBefore = await read(path.join(tmpRoot, "wiki/股票/洁美科技.md"))
    const rawPath = path.join(tmpRoot, "raw/研报新闻/2026-05-28-AI服务器电源.md")
    const rawBefore = await read(rawPath)

    const result = await runCompanyResearch({
      projectPath: tmpRoot,
      stock: "002859",
      from: "2026-06-01",
      to: "2026-06-07",
      reportId: "company-research-deep-test",
      deep: true,
      cninfoDownloadLimit: 2,
      tushareToken: "fake-tushare-test-token",
      tavilyApiKey: "fake-tavily-test-key",
      cninfoClient: async () => ({
        status: "success",
        requests: [{ key: "洁美科技 年度报告", url: "https://www.cninfo.com.cn/mock" }],
        announcements: [
          {
            id: "ann-annual",
            secCode: "002859",
            secName: "洁美科技",
            title: "洁美科技：2025年年度报告",
            date: "2026-04-21",
            announcementTime: Date.parse("2026-04-21"),
            adjunctType: "PDF",
            downloadUrl: "https://static.cninfo.com.cn/finalpage/mock-annual.pdf",
            type: "annual_report",
          },
          {
            id: "ann-annual-old",
            secCode: "002859",
            secName: "洁美科技",
            title: "洁美科技：2024年年度报告",
            date: "2025-04-21",
            announcementTime: Date.parse("2025-04-21"),
            adjunctType: "PDF",
            downloadUrl: "https://static.cninfo.com.cn/finalpage/mock-annual-old.pdf",
            type: "annual_report",
          },
          {
            id: "ann-semi",
            secCode: "002859",
            secName: "洁美科技",
            title: "洁美科技：2025年半年度报告",
            date: "2025-08-12",
            announcementTime: Date.parse("2025-08-12"),
            adjunctType: "PDF",
            downloadUrl: "https://static.cninfo.com.cn/finalpage/mock-semi.pdf",
            type: "semiannual_report",
          },
        ],
      }),
      cninfoDownloader: async ({ announcement }) => Buffer.from(`%PDF-1.4\n${announcement.id}\n%%EOF\n`),
      tushareClient: async ({ apiName }) => {
        if (apiName === "stock_basic") {
          return tushareResponse(["ts_code", "symbol", "name", "area", "industry", "market", "list_date"], [["002859.SZ", "002859", "洁美科技", "浙江", "电子元件", "主板", "20170407"]])
        }
        if (apiName === "income") {
          return tushareResponse(["ts_code", "end_date", "revenue", "operate_profit", "n_income_attr_p", "rd_exp"], [["002859.SZ", "20260331", 507378438.43, 45664039.34, 47752907.14, 35053018.72]])
        }
        if (apiName === "balancesheet") {
          return tushareResponse(["ts_code", "end_date", "total_assets", "total_liab", "fix_assets", "cip", "inventories", "accounts_receiv", "total_share"], [["002859.SZ", "20260331", 7536877545.94, 4341361207.96, 2899226061.52, 1835995726.9, 640214752.18, 617971443.56, 431226531]])
        }
        if (apiName === "cashflow") {
          return tushareResponse(["ts_code", "end_date", "n_cashflow_act"], [["002859.SZ", "20260331", 25002545.7]])
        }
        if (apiName === "fina_indicator") {
          return tushareResponse(["ts_code", "end_date", "grossprofit_margin", "netprofit_margin", "roe"], [["002859.SZ", "20260331", 32.5851, 8.9547, 1.5156]])
        }
        if (apiName === "daily_basic") {
          return tushareResponse(["ts_code", "trade_date", "close", "pe_ttm", "pb", "total_mv", "circ_mv"], [["002859.SZ", "20260605", 86.56, 159.6216, 12.3474, 3732697.1726, 3513465.2497]])
        }
        return tushareResponse(["ts_code", "ann_date"], [])
      },
      tavilyClient: async ({ query }) => ({
        results: [
          { title: `${query} result`, url: "https://example.com/research", content: "MLCC 离型膜 技术能力 对比", score: 0.91 },
        ],
      }),
      stockDailyColumns: ["ticker", "date", "close", "amount", "pct_cng"],
      stockDailyExecutor: async () => ({
        rows: [
          { ticker: "002859.SZ", date: "2026-06-05", close: 86.56, amount: 130000000, pct_cng: 2.42 },
        ],
        rowCount: 1,
      }),
    })

    expect(result.deep.enabled).toBe(true)
    expect(result.deep.summary.noInventedFigures).toBe(true)
    expect(result.outputs.deepReport).toBe(".llm-wiki/company-research/company-research-deep-test/deep-company-report.md")

    const deepReport = await read(path.join(tmpRoot, result.outputs.deepReport))
    expect(deepReport).toContain("自动重建说明")
    expect(deepReport).toContain("一、业务地图")
    expect(deepReport).toContain("ASP 独立推算")
    expect(deepReport).toContain("子公司盈亏核实")
    expect(deepReport).toContain("三、产能规划与折旧压力")
    expect(deepReport).toContain("五、载带业务")
    expect(deepReport).toContain("六、重大事项/收购期权价值")
    expect(deepReport).toContain("七、三年财务模型（三情景）")
    expect(deepReport).toContain("九、PE/市值敏感性矩阵")
    expect(deepReport).toContain("十一、退出信号体系")
    expect(deepReport).toContain("十二、验证清单")
    expect(deepReport).toContain("manual_needed")

    const documentExtract = JSON.parse(await read(path.join(tmpRoot, result.outputs.documentExtract)))
    expect(documentExtract.summary.manualNeeded).toBe(2)
    expect(documentExtract.documents.map((doc) => doc.title)).toEqual(expect.arrayContaining(["洁美科技：2025年年度报告", "洁美科技：2025年半年度报告"]))
    expect(documentExtract.documents.map((doc) => doc.title)).not.toContain("洁美科技：2024年年度报告")
    const businessBreakdown = JSON.parse(await read(path.join(tmpRoot, result.outputs.businessBreakdown)))
    expect(businessBreakdown.productLines[0].status).toBe("manual_needed")
    expect(businessBreakdown.capex[0].amount).toBe(1835995726.9)
    const qualityAudit = JSON.parse(await read(path.join(tmpRoot, result.outputs.deepQualityAudit)))
    expect(qualityAudit.targetScore).toBe(0.9)
    expect(Array.isArray(qualityAudit.requirements)).toBe(true)
    const financialTemplate = JSON.parse(await read(path.join(tmpRoot, result.outputs.financialModelV2Template)))
    expect(financialTemplate.frameworkKind).toBe("electronic-materials")
    expect(financialTemplate.workbookArchitecture).toEqual(expect.arrayContaining(["Driver Assumptions", "Segment Drivers", "Checks", "Manual Inputs"]))
    expect(financialTemplate.sourceMap.some((row) => row.status === "provider_needed")).toBe(true)
    const financialModelJson = JSON.parse(await read(path.join(tmpRoot, result.outputs.financialModelV2Json)))
    expect(financialModelJson.schema).toBe("company-financial-model-v2")
    expect(financialModelJson.sheets).toEqual(expect.arrayContaining(["Financial Framework", "Historical IS", "Historical BS", "Historical CF", "Segment Drivers", "Working Capital", "Capex D&A", "Forecast", "Valuation v2", "Checks", "Manual Inputs"]))

    const xlsx = await import("xlsx")
    const workbook = xlsx.readFile(path.join(tmpRoot, result.outputs.deepModelXlsx), { cellFormula: true })
    expect(workbook.SheetNames).toEqual(expect.arrayContaining(["Product Lines", "Forecast", "Valuation", "Sensitivity", "Scenario Model", "Corporate Actions", "Valuation Matrix", "Exit Signals", "Validation Checklist", "Evidence"]))
    expect(workbook.Sheets.Valuation.B2.f).toBe("Forecast!C4*0.85")
    const financialWorkbook = xlsx.readFile(path.join(tmpRoot, result.outputs.financialModelV2Xlsx), { cellFormula: true })
    expect(financialWorkbook.SheetNames).toEqual(expect.arrayContaining(["Cover", "Financial Framework", "Driver Assumptions", "Segment Drivers", "Forecast", "Valuation v2", "Checks"]))
    expect(financialWorkbook.Sheets.Forecast.C2.f).toContain("SUM('Segment Drivers'")
    expect(financialWorkbook.Sheets["Valuation v2"].D8.f).toBe('IF(D7>0,D6/D7,"")')
    expect(financialWorkbook.Sheets.Checks.F2.f).toContain("COUNTIF")

    const textOutputs = [
      await read(path.join(tmpRoot, result.outputs.runSummary)),
      await read(path.join(tmpRoot, result.outputs.deepReport)),
      await read(path.join(tmpRoot, result.outputs.documentExtract)),
      await read(path.join(tmpRoot, result.outputs.businessBreakdown)),
      await read(path.join(tmpRoot, result.outputs.financialModelV2Json)),
      await read(path.join(tmpRoot, result.outputs.financialModelV2Template)),
    ].join("\n")
    expect(textOutputs).not.toContain("fake-tushare-test-token")
    expect(textOutputs).not.toContain("fake-tavily-test-key")
    expect(await read(path.join(tmpRoot, "wiki/股票/洁美科技.md"))).toBe(wikiBefore)
    expect(await read(rawPath)).toBe(rawBefore)
  })

  it("runs plugin review and optimization artifacts for deep company research without touching wiki/raw", async () => {
    await write(
      path.join(tmpRoot, "wiki/股票/利通电子.md"),
      `${validFrontmatter("利通电子", "股票", "code: SH603629\nindustry: 元器件\n")}# 利通电子\n\n算力业务和精密结构件需要结合公告验证。\n`,
    )
    const wikiBefore = await read(path.join(tmpRoot, "wiki/股票/利通电子.md"))
    const rawPath = path.join(tmpRoot, "raw/研报新闻/2026-05-28-AI服务器电源.md")
    const rawBefore = await read(rawPath)
    const pluginCalls = []
    const optimizerCalls = []

    const result = await runCompanyResearch({
      projectPath: tmpRoot,
      stock: "603629",
      from: "2026-06-01",
      to: "2026-06-15",
      reportId: "company-research-plugin-review-test",
      deep: true,
      pluginReview: true,
      pluginOptimize: true,
      disableSseFallback: true,
      tushareToken: "fake-tushare-test-token",
      tavilyApiKey: "fake-tavily-test-key",
      pluginReviewer: async ({ plugin, prompt }) => {
        pluginCalls.push({ plugin, prompt })
        return `# ${plugin} plugin review\n\n真实插件评审桩：${plugin}\n\n不通过：需要修复模型口径。\n`
      },
      pluginOptimizer: async ({ prompt }) => {
        optimizerCalls.push({ prompt })
        return [
          "# 发布候选稿",
          "",
          "## 发布门禁",
          "",
          "当前仍存在 manual_needed 阻断项，只能作为内部研究候选稿。",
          "",
          "## 一页结论",
          "",
          "已吸收 Data Analytics 和 Public Equity Investing 的修正意见。",
        ].join("\n")
      },
      cninfoClient: async () => ({
        status: "success",
        requests: [{ key: "利通电子 年度报告", url: "https://www.cninfo.com.cn/mock" }],
        announcements: [],
      }),
      tushareClient: async ({ apiName }) => {
        if (apiName === "stock_basic") {
          return tushareResponse(["ts_code", "symbol", "name", "area", "industry", "market", "list_date"], [["603629.SH", "603629", "利通电子", "江苏", "元器件", "主板", "20181224"]])
        }
        if (apiName === "income") {
          return tushareResponse(["ts_code", "end_date", "revenue", "operate_profit", "n_income_attr_p", "rd_exp"], [["603629.SH", "20260331", 997438307.3, 332000000, 271272956.39, 52000000]])
        }
        if (apiName === "balancesheet") {
          return tushareResponse(["ts_code", "end_date", "total_assets", "total_liab", "fix_assets", "cip", "inventories", "accounts_receiv", "total_share"], [["603629.SH", "20260331", 6700000000, 3200000000, 1510000000, 210000000, 480000000, 560000000, 262320000]])
        }
        if (apiName === "cashflow") {
          return tushareResponse(["ts_code", "end_date", "n_cashflow_act", "c_pay_acq_const_fiolta"], [["603629.SH", "20260331", 210000000, 90000000]])
        }
        if (apiName === "fina_indicator") {
          return tushareResponse(["ts_code", "end_date", "grossprofit_margin", "netprofit_margin", "roe"], [["603629.SH", "20260331", 46.2298, 27.376, 9.4]])
        }
        if (apiName === "daily_basic") {
          return tushareResponse(["ts_code", "trade_date", "close", "pe_ttm", "pb", "total_mv", "circ_mv"], [["603629.SH", "20260615", 167.37, 82.155, 19.5587, 4390449.84, 4390449.84]])
        }
        return tushareResponse(["ts_code", "ann_date"], [])
      },
      tavilyClient: async ({ query }) => ({
        results: [
          { title: `${query} result`, url: "https://example.com/litong", content: "算力租赁 精密结构件 数据中心", score: 0.9 },
        ],
      }),
      stockDailyColumns: ["ticker", "date", "close", "amount", "pct_cng"],
      stockDailyExecutor: async () => ({ rows: [], rowCount: 0 }),
    })

    expect(result.pluginReview.enabled).toBe(true)
    expect(pluginCalls.map((call) => call.plugin)).toEqual(["data-analytics", "public-equity-investing"])
    expect(pluginCalls[0].prompt).toContain("[@data-analytics](plugin://data-analytics@openai-curated-remote)")
    expect(pluginCalls[1].prompt).toContain("[@public-equity-investing](plugin://public-equity-investing@openai-curated-remote)")
    expect(result.pluginReview.calls.find((call) => call.plugin === "investment-banking")).toMatchObject({ status: "skipped" })

    const pluginSummary = JSON.parse(await read(path.join(tmpRoot, result.outputs.pluginReview)))
    expect(pluginSummary.schema).toBe("company-plugin-review-v1")
    expect(pluginSummary.calls.map((call) => call.status)).toEqual(["success", "success", "skipped"])
    const pluginInput = JSON.parse(await read(path.join(tmpRoot, result.outputs.pluginReviewInput)))
    expect(pluginInput.invocationPolicy.dataAnalytics).toContain("always_review")
    expect(pluginInput.invocationPolicy.investmentBanking).toContain("transaction")
    expect(await read(path.join(tmpRoot, result.outputs.dataAnalyticsReview))).toContain("data-analytics plugin review")
    expect(await read(path.join(tmpRoot, result.outputs.publicEquityReview))).toContain("public-equity-investing plugin review")
    expect(await read(path.join(tmpRoot, result.outputs.investmentBankingReview))).toContain("Investment Banking Review Skipped")
    expect(result.pluginOptimization).toMatchObject({ enabled: true, status: "success", publishable: false })
    expect(optimizerCalls).toHaveLength(1)
    expect(optimizerCalls[0].prompt).toContain("[@data-analytics](plugin://data-analytics@openai-curated-remote)")
    expect(optimizerCalls[0].prompt).toContain("[@public-equity-investing](plugin://public-equity-investing@openai-curated-remote)")
    expect(optimizerCalls[0].prompt).toContain("data-analytics plugin review")
    expect(optimizerCalls[0].prompt).toContain("public-equity-investing plugin review")
    expect(await read(path.join(tmpRoot, result.outputs.optimizedReport))).toContain("发布候选稿")
    const readiness = JSON.parse(await read(path.join(tmpRoot, result.outputs.publishReadiness)))
    expect(readiness.schema).toBe("company-publish-readiness-v1")
    expect(readiness.status).toBe("blocked")
    expect(readiness.blockers).toEqual(expect.arrayContaining(["optimized_report_contains_publish_blockers"]))

    const textOutputs = [
      await read(path.join(tmpRoot, result.outputs.pluginReview)),
      await read(path.join(tmpRoot, result.outputs.pluginReviewInput)),
      await read(path.join(tmpRoot, result.outputs.dataAnalyticsReview)),
      await read(path.join(tmpRoot, result.outputs.publicEquityReview)),
      await read(path.join(tmpRoot, result.outputs.optimizedReport)),
      await read(path.join(tmpRoot, result.outputs.publishReadiness)),
    ].join("\n")
    expect(textOutputs).not.toContain("fake-tushare-test-token")
    expect(textOutputs).not.toContain("fake-tavily-test-key")
    expect(await read(path.join(tmpRoot, "wiki/股票/利通电子.md"))).toBe(wikiBefore)
    expect(await read(rawPath)).toBe(rawBefore)
  })

  it("lets plugins lead the company deep report from evidence artifacts", async () => {
    await write(
      path.join(tmpRoot, "wiki/股票/利通电子.md"),
      `${validFrontmatter("利通电子", "股票", "code: SH603629\nindustry: 元器件\n")}# 利通电子\n\n算力业务和精密结构件需要结合公告验证。\n`,
    )
    const wikiBefore = await read(path.join(tmpRoot, "wiki/股票/利通电子.md"))
    const rawPath = path.join(tmpRoot, "raw/研报新闻/2026-05-28-AI服务器电源.md")
    const rawBefore = await read(rawPath)
    const pluginLedCalls = []

    const result = await runCompanyResearch({
      projectPath: tmpRoot,
      stock: "603629",
      from: "2026-06-01",
      to: "2026-06-15",
      reportId: "company-research-plugin-led-test",
      deep: true,
      pluginLed: true,
      disableSseFallback: true,
      tushareToken: "fake-tushare-test-token",
      tavilyApiKey: "fake-tavily-test-key",
      pluginLedRunner: async ({ plugin, stage, prompt }) => {
        pluginLedCalls.push({ plugin, stage, prompt })
        if (plugin === "data-analytics") {
          return "# Data Analytics 模型分析\n\nDATA ANALYTICS OUT：分部口径需要去重，公式需要重算。\n"
        }
        if (plugin === "public-equity-investing") {
          if (stage === "public-equity-company-report-complete") {
            const requiredSections = [
              "## 0. 发布门禁与报告使用说明",
              "## 1. 一页结论",
              "## 2. 数据拉取确认与证据等级",
              "## 3. 公司画像、历史沿革与股权/治理",
              "## 4. 业务结构全景",
              "## 5. 产品/服务收入、毛利率、销量/ASP/产能拆解",
              "## 6. 子公司、区域与组织口径核实",
              "## 7. 年报附注、公告原文与关键表格摘录",
              "## 8. 行业空间、竞争格局与同业对标",
              "## 9. 技术能力、供应链、客户与订单验证",
              "## 10. 财务三表与质量分析",
              "## 11. 分部模型与三年预测",
              "## 12. 估值框架、SOTP 与敏感性矩阵",
              "## 13. 催化剂、跟踪指标与验证节奏",
              "## 14. 风险、反证与下修条件",
              "## 15. 交易含义与仓位观察",
              "## 16. 仍需补数和人工复核清单",
              "## 17. wiki 写入候选",
              "## 附录 A. 证据索引",
              "## 附录 B. 模型检查与口径说明",
            ]
            const table = ["| 项目 | 内容 |", "|---|---|", "| 状态 | manual_needed |"].join("\n")
            return [
              "# 插件主导公司深度研究报告",
              "",
              ...requiredSections.flatMap((section) => [section, "", table, "", `PUBLIC EQUITY OUT：${section} 完整展开。`]),
              ...Array.from({ length: 230 }, (_, index) => `补充行 ${index + 1}：manual_needed 仍需人工复核，但报告正文保持完整。`),
            ].join("\n")
          }
          return "# 插件主导公司深度研究报告\n\n## 发布门禁\n\nmanual_needed 阻断，内部候选稿。\n\n## 一页结论\n\nPUBLIC EQUITY OUT。\n"
        }
        return `# ${plugin} output\n`
      },
      cninfoClient: async () => ({
        status: "success",
        requests: [{ key: "利通电子 年度报告", url: "https://www.cninfo.com.cn/mock" }],
        announcements: [],
      }),
      tushareClient: async ({ apiName }) => {
        if (apiName === "stock_basic") {
          return tushareResponse(["ts_code", "symbol", "name", "area", "industry", "market", "list_date"], [["603629.SH", "603629", "利通电子", "江苏", "元器件", "主板", "20181224"]])
        }
        if (apiName === "income") {
          return tushareResponse(["ts_code", "end_date", "revenue", "operate_profit", "n_income_attr_p", "rd_exp"], [["603629.SH", "20260331", 997438307.3, 332000000, 271272956.39, 52000000]])
        }
        if (apiName === "balancesheet") {
          return tushareResponse(["ts_code", "end_date", "total_assets", "total_liab", "fix_assets", "cip", "inventories", "accounts_receiv", "total_share"], [["603629.SH", "20260331", 6700000000, 3200000000, 1510000000, 210000, 480000000, 560000000, 262320000]])
        }
        if (apiName === "cashflow") {
          return tushareResponse(["ts_code", "end_date", "n_cashflow_act", "c_pay_acq_const_fiolta"], [["603629.SH", "20260331", 210000000, 90000000]])
        }
        if (apiName === "fina_indicator") {
          return tushareResponse(["ts_code", "end_date", "grossprofit_margin", "netprofit_margin", "roe"], [["603629.SH", "20260331", 46.2298, 27.376, 9.4]])
        }
        if (apiName === "daily_basic") {
          return tushareResponse(["ts_code", "trade_date", "close", "pe_ttm", "pb", "total_mv", "circ_mv"], [["603629.SH", "20260615", 167.37, 82.155, 19.5587, 4390449.84, 4390449.84]])
        }
        return tushareResponse(["ts_code", "ann_date"], [])
      },
      tavilyClient: async ({ query }) => ({
        results: [
          { title: `${query} result`, url: "https://example.com/litong", content: "算力租赁 精密结构件 数据中心", score: 0.9 },
        ],
      }),
      stockDailyColumns: ["ticker", "date", "close", "amount", "pct_cng"],
      stockDailyExecutor: async () => ({ rows: [], rowCount: 0 }),
    })

    expect(result.pluginLed.enabled).toBe(true)
    expect(result.pluginReview.enabled).toBe(false)
    expect(pluginLedCalls.map((call) => call.plugin)).toEqual([
      "data-analytics",
      "public-equity-investing",
      "public-equity-investing",
      "public-equity-investing",
      "public-equity-investing",
      "public-equity-investing",
    ])
    expect(pluginLedCalls.slice(1, 5).map((call) => call.stage)).toEqual([
      "public-equity-company-report-part-1",
      "public-equity-company-report-part-2",
      "public-equity-company-report-part-3",
      "public-equity-company-report-part-4",
    ])
    expect(pluginLedCalls[5].stage).toBe("public-equity-company-report-complete")
    expect(pluginLedCalls[0].prompt).toContain("[@data-analytics](plugin://data-analytics@openai-curated-remote)")
    expect(pluginLedCalls[0].prompt).toContain(".llm-wiki/company-research/company-research-plugin-led-test/evidence-pack.json")
    expect(pluginLedCalls[1].prompt).toContain("[@public-equity-investing](plugin://public-equity-investing@openai-curated-remote)")
    expect(pluginLedCalls[1].prompt).toContain("DATA ANALYTICS OUT")
    expect(pluginLedCalls[1].prompt).toContain("dataAnalyticsModelAnalysis")
    expect(pluginLedCalls[5].prompt).toContain("完整性校验结果")
    expect(result.pluginLed.calls.find((call) => call.plugin === "investment-banking")).toMatchObject({ status: "skipped" })

    const pluginLedSummary = JSON.parse(await read(path.join(tmpRoot, result.outputs.pluginLed)))
    expect(pluginLedSummary.schema).toBe("company-plugin-led-v1")
    expect(pluginLedSummary.calls.map((call) => call.status)).toEqual(["success", "skipped", "success", "success", "success", "success", "success"])
    expect(pluginLedSummary.reportCompleteness).toMatchObject({ complete: true, repairAttempted: true })
    expect(await read(path.join(tmpRoot, result.outputs.dataAnalyticsModelAnalysis))).toContain("Data Analytics 模型分析")
    expect(result.outputs.pluginLedDraftReport).toBe(".llm-wiki/company-research/company-research-plugin-led-test/plugin-led/plugin-led-company-report.md")
    expect(result.outputs.pluginLedReport).toBe(".llm-wiki/company-research/company-research-plugin-led-test/plugin-led/plugin-led-company-report-complete.md")
    expect(await read(path.join(tmpRoot, result.outputs.pluginLedReport))).toContain("## 附录 B. 模型检查与口径说明")
    expect(await read(path.join(tmpRoot, result.outputs.deepReport))).toContain("## 附录 B. 模型检查与口径说明")
    const completeness = JSON.parse(await read(path.join(tmpRoot, result.outputs.reportCompleteness)))
    expect(completeness.complete).toBe(true)
    expect(completeness.missingSections).toEqual([])
    const readiness = JSON.parse(await read(path.join(tmpRoot, result.outputs.publishReadiness)))
    expect(readiness.status).toBe("blocked")
    expect(readiness.publishable).toBe(false)
    expect(readiness.blockers).toEqual(expect.arrayContaining(["optimized_report_contains_publish_blockers"]))
    expect(readiness.requiredBeforeFormalPublish.join("\n")).toContain("company-research --deep --plugin-led")

    const textOutputs = [
      await read(path.join(tmpRoot, result.outputs.pluginLed)),
      await read(path.join(tmpRoot, result.outputs.pluginLedInput)),
      await read(path.join(tmpRoot, result.outputs.dataAnalyticsModelAnalysis)),
      await read(path.join(tmpRoot, result.outputs.pluginLedDraftReport)),
      await read(path.join(tmpRoot, result.outputs.pluginLedReport)),
      await read(path.join(tmpRoot, result.outputs.reportCompleteness)),
      await read(path.join(tmpRoot, result.outputs.publishReadiness)),
    ].join("\n")
    expect(textOutputs).not.toContain("fake-tushare-test-token")
    expect(textOutputs).not.toContain("fake-tavily-test-key")
    expect(await read(path.join(tmpRoot, "wiki/股票/利通电子.md"))).toBe(wikiBefore)
    expect(await read(rawPath)).toBe(rawBefore)
  })

  it("can force Investment Banking in plugin-led company research", async () => {
    const pluginLedCalls = []
    const result = await runCompanyResearch({
      projectPath: tmpRoot,
      stock: "002859",
      from: "2026-06-01",
      to: "2026-06-07",
      reportId: "company-research-plugin-led-ib-test",
      deep: true,
      pluginLed: true,
      forceInvestmentBankingReview: true,
      disableSseFallback: true,
      tushareToken: "fake-tushare-test-token",
      pluginLedRunner: async ({ plugin, stage, prompt }) => {
        pluginLedCalls.push({ plugin, stage, prompt })
        if (plugin === "data-analytics") return "# Data Analytics 模型分析\n"
        if (plugin === "investment-banking") return "# Investment Banking 交易事项分析\n"
        return "# 插件主导公司深度研究报告\n\n## 发布门禁\n\n不通过。\n"
      },
      cninfoClient: async () => ({
        status: "success",
        requests: [{ key: "洁美科技 重大资产收购", url: "https://www.cninfo.com.cn/mock" }],
        announcements: [],
      }),
      tushareClient: async ({ apiName }) => {
        if (apiName === "stock_basic") {
          return tushareResponse(["ts_code", "symbol", "name", "area", "industry", "market", "list_date"], [["002859.SZ", "002859", "洁美科技", "浙江", "电子元件", "主板", "20170407"]])
        }
        if (apiName === "income") {
          return tushareResponse(["ts_code", "end_date", "revenue", "operate_profit", "n_income_attr_p", "rd_exp"], [["002859.SZ", "20260331", 507378438.43, 45664039.34, 47752907.14, 35053018.72]])
        }
        if (apiName === "balancesheet") {
          return tushareResponse(["ts_code", "end_date", "total_assets", "total_liab", "fix_assets", "cip", "inventories", "accounts_receiv", "total_share"], [["002859.SZ", "20260331", 7536877545.94, 4341361207.96, 2899226061.52, 1835995726.9, 640214752.18, 617971443.56, 431226531]])
        }
        if (apiName === "cashflow") {
          return tushareResponse(["ts_code", "end_date", "n_cashflow_act"], [["002859.SZ", "20260331", 25002545.7]])
        }
        if (apiName === "fina_indicator") {
          return tushareResponse(["ts_code", "end_date", "grossprofit_margin", "netprofit_margin", "roe"], [["002859.SZ", "20260331", 32.5851, 8.9547, 1.5156]])
        }
        if (apiName === "daily_basic") {
          return tushareResponse(["ts_code", "trade_date", "close", "pe_ttm", "pb", "total_mv", "circ_mv"], [["002859.SZ", "20260605", 86.56, 159.6216, 12.3474, 3732697.1726, 3513465.2497]])
        }
        return tushareResponse(["ts_code", "ann_date"], [])
      },
      stockDailyColumns: ["ticker", "date", "close"],
      stockDailyExecutor: async () => ({ rows: [], rowCount: 0 }),
    })

    expect(pluginLedCalls.map((call) => call.plugin)).toEqual([
      "data-analytics",
      "investment-banking",
      "public-equity-investing",
      "public-equity-investing",
      "public-equity-investing",
      "public-equity-investing",
      "public-equity-investing",
    ])
    expect(pluginLedCalls[1].prompt).toContain("[@investment-banking](plugin://investment-banking@openai-curated-remote)")
    expect(pluginLedCalls[6].stage).toBe("public-equity-company-report-complete")
    expect(result.pluginLed.investmentBankingTriggered).toBe(true)
    expect(result.pluginLed.calls.find((call) => call.plugin === "investment-banking")).toMatchObject({ status: "success" })
  })

  it("can force Investment Banking plugin review for transaction-oriented company work", async () => {
    await write(
      path.join(tmpRoot, "wiki/股票/洁美科技.md"),
      `${validFrontmatter("洁美科技", "股票", "code: SZ002859\nindustry: 电子元件\n")}# 洁美科技\n\n重大资产收购预案需要条款复核。\n`,
    )
    const pluginCalls = []

    const result = await runCompanyResearch({
      projectPath: tmpRoot,
      stock: "002859",
      from: "2026-06-01",
      to: "2026-06-07",
      reportId: "company-research-plugin-review-ib-test",
      deep: true,
      pluginReview: true,
      forceInvestmentBankingReview: true,
      disableSseFallback: true,
      tushareToken: "fake-tushare-test-token",
      pluginReviewer: async ({ plugin, prompt }) => {
        pluginCalls.push({ plugin, prompt })
        return `# ${plugin} forced review\n`
      },
      cninfoClient: async () => ({
        status: "success",
        requests: [{ key: "洁美科技 重大资产收购", url: "https://www.cninfo.com.cn/mock" }],
        announcements: [],
      }),
      tushareClient: async ({ apiName }) => {
        if (apiName === "stock_basic") {
          return tushareResponse(["ts_code", "symbol", "name", "area", "industry", "market", "list_date"], [["002859.SZ", "002859", "洁美科技", "浙江", "电子元件", "主板", "20170407"]])
        }
        if (apiName === "income") {
          return tushareResponse(["ts_code", "end_date", "revenue", "operate_profit", "n_income_attr_p", "rd_exp"], [["002859.SZ", "20260331", 507378438.43, 45664039.34, 47752907.14, 35053018.72]])
        }
        if (apiName === "balancesheet") {
          return tushareResponse(["ts_code", "end_date", "total_assets", "total_liab", "fix_assets", "cip", "inventories", "accounts_receiv", "total_share"], [["002859.SZ", "20260331", 7536877545.94, 4341361207.96, 2899226061.52, 1835995726.9, 640214752.18, 617971443.56, 431226531]])
        }
        if (apiName === "cashflow") {
          return tushareResponse(["ts_code", "end_date", "n_cashflow_act"], [["002859.SZ", "20260331", 25002545.7]])
        }
        if (apiName === "fina_indicator") {
          return tushareResponse(["ts_code", "end_date", "grossprofit_margin", "netprofit_margin", "roe"], [["002859.SZ", "20260331", 32.5851, 8.9547, 1.5156]])
        }
        if (apiName === "daily_basic") {
          return tushareResponse(["ts_code", "trade_date", "close", "pe_ttm", "pb", "total_mv", "circ_mv"], [["002859.SZ", "20260605", 86.56, 159.6216, 12.3474, 3732697.1726, 3513465.2497]])
        }
        return tushareResponse(["ts_code", "ann_date"], [])
      },
      stockDailyColumns: ["ticker", "date", "close"],
      stockDailyExecutor: async () => ({ rows: [], rowCount: 0 }),
    })

    expect(pluginCalls.map((call) => call.plugin)).toEqual(["data-analytics", "public-equity-investing", "investment-banking"])
    expect(pluginCalls[2].prompt).toContain("[@investment-banking](plugin://investment-banking@openai-curated-remote)")
    expect(result.pluginReview.investmentBankingTriggered).toBe(true)
    expect(await read(path.join(tmpRoot, result.outputs.investmentBankingReview))).toContain("investment-banking forced review")
  })

  it("uses semiconductor driver pack for memory-chip companies instead of the JieMei material template", async () => {
    await write(
      path.join(tmpRoot, "wiki/股票/兆易创新.md"),
      `${validFrontmatter("兆易创新", "股票", "code: SH603986\nindustry: 半导体\n")}# 兆易创新\n\n存储芯片、MCU 和传感器业务需要结合公告和周期数据验证。\n`,
    )
    const wikiBefore = await read(path.join(tmpRoot, "wiki/股票/兆易创新.md"))
    const rawPath = path.join(tmpRoot, "raw/研报新闻/2026-05-28-AI服务器电源.md")
    const rawBefore = await read(rawPath)

    const result = await runCompanyResearch({
      projectPath: tmpRoot,
      stock: "603986",
      from: "2026-06-01",
      to: "2026-06-07",
      reportId: "company-research-deep-semiconductor-test",
      deep: true,
      tushareToken: "fake-tushare-test-token",
      tavilyApiKey: "fake-tavily-test-key",
      cninfoClient: async () => ({
        status: "success",
        requests: [{ key: "兆易创新 年度报告", url: "https://www.cninfo.com.cn/mock" }],
        announcements: [],
      }),
      tushareClient: async ({ apiName }) => {
        if (apiName === "stock_basic") {
          return tushareResponse(["ts_code", "symbol", "name", "area", "industry", "market", "list_date"], [["603986.SH", "603986", "兆易创新", "北京", "半导体", "主板", "20160818"]])
        }
        if (apiName === "income") {
          return tushareResponse(["ts_code", "end_date", "revenue", "operate_profit", "n_income_attr_p", "rd_exp"], [["603986.SH", "20260331", 1600000000, 260000000, 210000000, 310000000]])
        }
        if (apiName === "balancesheet") {
          return tushareResponse(["ts_code", "end_date", "total_assets", "total_liab", "fix_assets", "cip", "inventories", "accounts_receiv", "total_share"], [["603986.SH", "20260331", 22000000000, 4600000000, 1900000000, 350000000, 2800000000, 1200000000, 667000000]])
        }
        if (apiName === "cashflow") {
          return tushareResponse(["ts_code", "end_date", "n_cashflow_act", "c_pay_acq_const_fiolta"], [["603986.SH", "20260331", 320000000, 180000000]])
        }
        if (apiName === "fina_indicator") {
          return tushareResponse(["ts_code", "end_date", "grossprofit_margin", "netprofit_margin", "roe"], [["603986.SH", "20260331", 38.5, 13.1, 2.3]])
        }
        if (apiName === "daily_basic") {
          return tushareResponse(["ts_code", "trade_date", "close", "pe_ttm", "pb", "total_mv", "circ_mv"], [["603986.SH", "20260605", 126.8, 62.5, 5.8, 8450000, 8420000]])
        }
        return tushareResponse(["ts_code", "ann_date"], [])
      },
      tavilyClient: async ({ query }) => ({
        results: [
          { title: `${query} result`, url: "https://example.com/memory-cycle", content: "NOR Flash DRAM MCU 库存 周期", score: 0.89 },
        ],
      }),
      stockDailyColumns: ["ticker", "date", "close", "amount", "pct_cng"],
      stockDailyExecutor: async () => ({ rows: [], rowCount: 0 }),
    })

    expect(result.deep.summary.financialModelKind).toBe("semiconductor-memory")
    const template = JSON.parse(await read(path.join(tmpRoot, result.outputs.financialModelV2Template)))
    expect(template.frameworkName).toContain("半导体")
    expect(template.operatingDrivers).toEqual(expect.arrayContaining(["存储价格指数", "库存周转"]))
    expect(JSON.stringify(template)).toContain("DRAM/NOR Flash 价格指数")
    expect(JSON.stringify(template)).not.toContain("离型膜")

    const xlsx = await import("xlsx")
    const financialWorkbook = xlsx.readFile(path.join(tmpRoot, result.outputs.financialModelV2Xlsx), { cellFormula: true })
    expect(financialWorkbook.Sheets["Segment Drivers"].A2.v).toContain("存储芯片")
    expect(financialWorkbook.Sheets["Segment Drivers"].A3.v).toContain("微控制器")
    expect(financialWorkbook.Sheets.Forecast.C2.f).toContain("'Segment Drivers'")
    expect(await read(path.join(tmpRoot, "wiki/股票/兆易创新.md"))).toBe(wikiBefore)
    expect(await read(rawPath)).toBe(rawBefore)
  })
})

describe("wiki body soft line limit", () => {
  function contentWithBodyLines(lineCount) {
    const body = Array.from({ length: lineCount }, (_, i) => `line ${i + 1}`).join("\n")
    return `${validFrontmatter("长页面")}\n${body}\n`
  }

  it("allows 1999 and 2000 body lines without a line-limit warning", () => {
    expect(validateWikiContent("wiki/概念/长页面.md", contentWithBodyLines(PAGE_BODY_LINE_SOFT_LIMIT - 1))).not.toContainEqual(
      expect.objectContaining({ field: "body_lines" }),
    )
    expect(validateWikiContent("wiki/概念/长页面.md", contentWithBodyLines(PAGE_BODY_LINE_SOFT_LIMIT))).not.toContainEqual(
      expect.objectContaining({ field: "body_lines" }),
    )
  })

  it("warns but does not fail above 2000 body lines", () => {
    const issues = validateWikiContent("wiki/概念/长页面.md", contentWithBodyLines(PAGE_BODY_LINE_SOFT_LIMIT + 1))
    expect(issues).toContainEqual(
      expect.objectContaining({
        field: "body_lines",
        fatal: false,
      }),
    )
  })

  it("accepts Hong Kong stock codes", () => {
    const content = `${validFrontmatter("港股样本", "股票", "code: HK09992\nindustry: 潮玩\n")}\n# 港股样本\n`
    expect(validateWikiContent("wiki/股票/港股样本.md", content).filter((issue) => issue.fatal)).toEqual([])
  })

  it("accepts US stock tickers", () => {
    const content = `${validFrontmatter("美股样本", "股票", "code: AAPL\nindustry: 消费电子\n")}\n# 美股样本\n`
    expect(validateWikiContent("wiki/股票/美股样本.md", content).filter((issue) => issue.fatal)).toEqual([])
  })
})

describe("FILE block parser", () => {
  it("parses lenient FILE blocks for API fallback", () => {
    const blocks = parseFileBlocks("----FILE: **wiki/概念/X.md**----\nbody\n----END FILE----")
    expect(blocks).toEqual([{ path: "wiki/概念/X.md", content: "body" }])
  })

  it("parses fenced FILE blocks returned by Codex exec", () => {
    const blocks = parseFileBlocks("````FILE wiki/logs/log-2026-05-30.md\n## log\n```yaml\nx: y\n```\n````")
    expect(blocks).toEqual([{ path: "wiki/logs/log-2026-05-30.md", content: "## log\n```yaml\nx: y\n```" }])
  })
})

describe("codex ingest deep-research", () => {
  it("collects Tavily evidence, combines local wiki context, and saves the reviewed page shape", async () => {
    const prompts = []
    const result = await runDeepResearch({
      projectPath: tmpRoot,
      topic: "AI服务器电源",
      generatedAt: "2026-06-20 12:00:00",
      tavilyApiKey: "fake-tavily-test-key",
      tavilyClient: async ({ query, maxResults }) => ({
        results: [
          {
            title: `${query} 深度资料`,
            url: "https://example.com/ai-power",
            content: `AI服务器电源 新资料 max=${maxResults}`,
            score: 0.91,
          },
          {
            title: "重复资料",
            url: "https://example.com/ai-power",
            content: "duplicate",
            score: 0.8,
          },
        ],
      }),
      requestText: async ({ prompt }) => {
        prompts.push(prompt)
        expect(prompt).toContain("## Web Search Results")
        expect(prompt).toContain("AI服务器电源 新资料")
        expect(prompt).toContain("## Local Knowledge Base Context")
        expect(prompt).toContain("wiki/概念/算电协同.md")
        expect(prompt).not.toContain("fake-tavily-test-key")
        return "<think>internal scratchpad</think>\n## 结论\nAI服务器电源需要结合[[概念/算电协同]]继续跟踪。[T1][W1]"
      },
      maxResults: "3",
      sources: "wiki,raw,graph,facts,brain",
      write: true,
    })

    expect(prompts).toHaveLength(1)
    expect(result.outputDir).toBe(".llm-wiki/deep-research/20260620120000-AI服务器电源")
    expect(result.web).toMatchObject({ status: "success", resultCount: 1, queryCount: 1 })
    expect(result.localContext.counts.wikiMatches).toBeGreaterThan(0)
    expect(result.outputs.draft).toBe(".llm-wiki/deep-research/20260620120000-AI服务器电源/draft.md")
    expect(result.outputs.savedPath).toBe("wiki/queries/research-AI服务器电源-2026-06-20.md")
    expect(result.writePolicy).toMatchObject({
      wroteArtifacts: true,
      wroteWikiQuery: true,
      stagedIngest: false,
      appliedIngest: false,
      wroteRaw: false,
    })

    const draft = await read(path.join(tmpRoot, result.outputs.draft))
    expect(draft).not.toContain("<think>")
    expect(draft).toContain("[[概念/算电协同]]")

    const saved = await read(path.join(tmpRoot, result.outputs.savedPath))
    expect(saved).toContain("origin: deep-research")
    expect(saved).toContain("title: \"Research: AI服务器电源\"")
    expect(saved).toContain("## References")
    expect(saved).toContain("[AI服务器电源 深度资料](https://example.com/ai-power)")

    const manifest = JSON.parse(await read(path.join(tmpRoot, result.outputs.manifest)))
    expect(manifest.outputs.savedPath).toBe(result.outputs.savedPath)
    expect(JSON.stringify(manifest)).not.toContain("fake-tavily-test-key")
  })

  it("requires an explicit wiki save before staged ingest", async () => {
    await expect(runDeepResearch({
      projectPath: tmpRoot,
      topic: "AI服务器电源",
      generatedAt: "2026-06-20 12:00:00",
      tavilyClient: async () => ({
        results: [{ title: "资料", url: "https://example.com/one", content: "snippet" }],
      }),
      requestText: async () => "draft",
      sources: "wiki,raw,graph,facts,brain",
      ingest: true,
    })).rejects.toThrow("--ingest requires --write")

    await expect(runDeepResearch({
      projectPath: tmpRoot,
      topic: "AI服务器电源",
      tavilyClient: async () => ({
        results: [{ title: "资料", url: "https://example.com/two", content: "snippet" }],
      }),
      applyIngest: true,
    })).rejects.toThrow("--apply-ingest requires --ingest")

    await expect(runDeepResearch({
      projectPath: tmpRoot,
      topic: "AI服务器电源",
      tavilyClient: async () => ({
        results: [{ title: "资料", url: "https://example.com/three", content: "snippet" }],
      }),
      showContext: true,
      write: true,
    })).rejects.toThrow("--show-context cannot be combined")
  })
})

describe("codex ingest CLI structure", () => {
  it("keeps the legacy command surface behind the handler map", () => {
    expect(Object.keys(COMMAND_HANDLERS).sort()).toEqual([
      "api-run",
      "apply",
      "ask",
      "autoresearch",
      "batch-run",
      "brain",
      "company-research",
      "concepts",
      "convert-source",
      "daily-loop",
      "data-source",
      "deep-research",
      "embeddings",
      "export-samples",
      "finalize",
      "hygiene",
      "hypothesis",
      "market-validate",
      "prepare",
      "query",
      "research-os",
      "researchos",
      "sag-sync",
      "self-question",
      "self-train",
      "stock-feedback",
      "temporal-facts",
    ])
    expect(COMMAND_HANDLERS.query).toBe(COMMAND_HANDLERS.ask)
    expect(checkRecursiveAiPhase5ReadinessFromBrainApi).toBe(checkRecursiveAiPhase5Readiness)
    expect(getRecursiveAiPhaseStatusFromBrainApi).toBe(getRecursiveAiPhaseStatus)
    expect(runRecursiveAiPhaseAdvanceFromBrainApi).toBe(runRecursiveAiPhaseAdvance)
    expect(runRecursiveAiPhaseRunFromBrainApi).toBe(runRecursiveAiPhaseRun)
  })

  it("preserves legacy argument parsing behavior", () => {
    const args = parseArgs(["ask", "--query", "AI服务器电源", "--agentic", "--show-sources", "--agent-timeout-ms", "1000"])
    expect(args).toEqual({
      _: ["ask"],
      query: "AI服务器电源",
      agentic: true,
      "show-sources": true,
      "agent-timeout-ms": "1000",
    })
    expect(parseArgs(["company-research", "--stock", "688167", "--disable-sse-fallback"])).toMatchObject({
      _: ["company-research"],
      stock: "688167",
      "disable-sse-fallback": true,
    })
    expect(parseArgs(["company-research", "--stock", "603629", "--deep", "--plugin-review", "--plugin-optimize", "--plugin-review-timeout-ms", "600000", "--plugin-optimize-timeout-ms", "600000", "--force-investment-banking-review"])).toMatchObject({
      _: ["company-research"],
      stock: "603629",
      deep: true,
      "plugin-review": true,
      "plugin-optimize": true,
      "plugin-review-timeout-ms": "600000",
      "plugin-optimize-timeout-ms": "600000",
      "force-investment-banking-review": true,
    })
    expect(parseArgs(["company-research", "--stock", "603629", "--deep", "--plugin-led", "--plugin-led-timeout-ms", "600000", "--force-investment-banking-review"])).toMatchObject({
      _: ["company-research"],
      stock: "603629",
      deep: true,
      "plugin-led": true,
      "plugin-led-timeout-ms": "600000",
      "force-investment-banking-review": true,
    })
    expect(parseArgs(["deep-research", "--topic", "AI服务器电源", "--write", "--ingest", "--apply-ingest"])).toMatchObject({
      _: ["deep-research"],
      topic: "AI服务器电源",
      write: true,
      ingest: true,
      "apply-ingest": true,
    })
    expect(parseArgs(["self-question", "--no-llm-question-planner"])).toMatchObject({
      _: ["self-question"],
      "no-llm-question-planner": true,
    })
    expect(parseArgs(["self-question", "validate", "--id", "selfq-1", "--max-questions", "2"])).toMatchObject({
      _: ["self-question", "validate"],
      id: "selfq-1",
      "max-questions": "2",
    })
    expect(parseArgs(["self-question", "validate", "--allow-anchored-external-market"])).toMatchObject({
      _: ["self-question", "validate"],
      "allow-anchored-external-market": true,
    })
    expect(parseArgs(["self-question", "attribute", "--id", "selfq-val-1"])).toMatchObject({
      _: ["self-question", "attribute"],
      id: "selfq-val-1",
    })
    expect(parseArgs(["self-question", "phase-status", "--export-limit", "5"])).toMatchObject({
      _: ["self-question", "phase-status"],
      "export-limit": "5",
    })
    expect(parseArgs(["self-question", "phase-check", "--project", "/tmp/wiki"])).toMatchObject({
      _: ["self-question", "phase-check"],
      project: "/tmp/wiki",
    })
    expect(parseArgs(["self-question", "phase-advance", "--gate", "generate_self_questions", "--execute", "--write"])).toMatchObject({
      _: ["self-question", "phase-advance"],
      gate: "generate_self_questions",
      execute: true,
      write: true,
    })
    expect(parseArgs(["self-question", "phase-run", "--max-gates", "2", "--execute", "--write", "--no-phase-run-artifacts"])).toMatchObject({
      _: ["self-question", "phase-run"],
      "max-gates": "2",
      execute: true,
      write: true,
      "no-phase-run-artifacts": true,
    })
    expect(parseArgs(["autoresearch", "proposal", "--min-score-delta", "1", "--changed-artifacts", "segment_config,evidence_task_priority", "--write"])).toMatchObject({
      _: ["autoresearch", "proposal"],
      "min-score-delta": "1",
      "changed-artifacts": "segment_config,evidence_task_priority",
      write: true,
    })
    expect(parseArgs(["self-question", "loop", "--stages", "generate,validate", "--no-loop-artifacts", "--self-train-write"])).toMatchObject({
      _: ["self-question", "loop"],
      stages: "generate,validate",
      "no-loop-artifacts": true,
      "self-train-write": true,
    })
    expect(parseArgs(["self-question", "loop", "--stages", "policy-regression-apply", "--apply-policy-regression-patches"])).toMatchObject({
      _: ["self-question", "loop"],
      stages: "policy-regression-apply",
      "apply-policy-regression-patches": true,
    })
    expect(parseArgs(["ask", "--query", "AI服务器电源", "--profile", "local-max"])).toMatchObject({
      _: ["ask"],
      query: "AI服务器电源",
      profile: "local-max",
    })
    expect(() => parseArgs(["ask", "--query"])).toThrow("Missing value for --query")
    expect(() => requireArg({ _: [] }, "source")).toThrow("Missing required --source")
  })

  it("routes autoresearch proposal through the CLI handler", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {})
    try {
      await COMMAND_HANDLERS.autoresearch(parseArgs(["autoresearch", "proposal", "--project", tmpRoot, "--min-score-delta", "1"]))
      const printed = JSON.parse(String(log.mock.calls.at(-1)?.[0] ?? "{}"))
      expect(printed).toMatchObject({
        schema: "trading-autoresearch-policy-proposal-run-v1",
        mode: "autoresearch-policy-propose",
        dryRun: true,
        writeResult: null,
        writePolicy: {
          artifacts: ".llm-wiki/policy-proposals",
          wroteWiki: false,
          wroteRaw: false,
          autoApplied: false,
        },
      })
    } finally {
      log.mockRestore()
    }
  })

  it("routes hypothesis ask through agentic answer generation instead of context-only retrieval", async () => {
    const created = await createHypothesis({
      projectPath: tmpRoot,
      title: "CPO增速放缓可能推动MPO连接器量价齐升",
      theme: "AI数据中心互联",
      segments: ["MPO", "CPO", "高速连接器"],
      status: "watching",
      write: true,
    })
    await write(
      path.join(tmpRoot, "wiki/概念/CPO连接器与MPO.md"),
      `${validFrontmatter("CPO连接器与MPO")}# CPO连接器与MPO\n\nMPO 高速连接器可能受 CPO 节奏变化影响，需要关联股票、订单、量价和客户验证。\n`,
    )

    const log = vi.spyOn(console, "log").mockImplementation(() => {})
    try {
      const args = parseArgs([
        "hypothesis",
        "ask",
        "--project",
        tmpRoot,
        "--id",
        created.hypothesis.id,
        "--sources",
        "wiki,raw,graph,facts,brain",
        "--no-agent-artifacts",
      ])
      args.requestAgentText = async ({ stage, role }) => {
        if (stage.startsWith("ask-agent-")) return `# ${role}\n\n已读取 CPO/MPO 来源。`
        return [
          "## 结论",
          "CPO 放缓若被二次确认，MPO 高速连接器属于新催化跟踪，不等于订单兑现。",
          "## 证据链",
          "关联股票：唯特偶、立讯精密。",
          "## 分歧/反证",
          "短期上涨可能只是叙事扩散。",
          "## 后续验证",
          "最大缺口：订单、客户份额、ASP、交付和毛利率。",
          "## 交易含义",
          "利好排序：MPO连接器 > 高速连接器平台 > 泛光模块配套。",
          "## 引用来源",
          "- [W1] CPO连接器与MPO",
        ].join("\n")
      }

      await COMMAND_HANDLERS.hypothesis(args)
      const printed = JSON.parse(String(log.mock.calls.at(-1)?.[0] ?? "{}"))
      expect(printed).toMatchObject({
        schema: "trading-hypothesis-ask-run-v1",
        mode: "hypothesis-ask",
        hypothesis: {
          id: created.hypothesis.id,
        },
      })
      expect(printed.answer).toContain("关联股票：唯特偶、立讯精密")
      expect(printed.answer).toContain("利好排序")
      expect(printed.context.sourceRouting.mode).toBe("explicit")
      expect(printed.context.sourceRouting.selectedSources.map((source) => source.id)).not.toContain("stock_daily_sql")
      expect(printed.sources.wiki.length).toBeGreaterThan(0)
      expect(printed.sources.wiki[0]).toMatchObject({
        type: "概念",
        frontmatterTags: ["测试"],
        frontmatterUpdated: "2026-05-11 14:23:07",
        frontmatterUpdatedField: "updated",
      })
      expect(printed.writePolicy).toMatchObject({
        readOnly: true,
        wroteWiki: false,
        wroteRaw: false,
        wroteRealTrade: false,
      })
    } finally {
      log.mockRestore()
    }
  })

  it("routes observation draft writes through the hypothesis CLI handler", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {})
    try {
      await COMMAND_HANDLERS.hypothesis(parseArgs([
        "hypothesis",
        "observation-draft",
        "--project",
        tmpRoot,
        "--title",
        "CPO放缓推动MPO观察",
        "--stocks",
        "太辰光,天孚通信",
        "--wiki-frame-label",
        "AI数据中心互联",
        "--wiki-frame-source-ref",
        "wiki/概念/AI数据中心互联.md",
        "--write",
      ]))
      const printed = JSON.parse(String(log.mock.calls.at(-1)?.[0] ?? "{}"))
      expect(printed).toMatchObject({
        schema: "trading-observation-draft-create-run-v1",
        dryRun: false,
        draft: {
          schema: "trading-observation-draft-v1",
          stocks: ["太辰光", "天孚通信"],
          wikiFrame: {
            label: "AI数据中心互联",
            sourceRef: "wiki/概念/AI数据中心互联.md",
          },
        },
        writePolicy: {
          wroteWiki: false,
          wroteRaw: false,
          wroteRealTrade: false,
        },
      })
      expect(printed.writeResult.markdownRelativePath).toMatch(/^\.llm-wiki\/observation-drafts\//)
    } finally {
      log.mockRestore()
    }
  })

  it("routes observation draft list through the hypothesis CLI handler", async () => {
    await createObservationDraft({
      projectPath: tmpRoot,
      title: "今日MPO观察",
      stocks: "太辰光,天孚通信",
      generatedAt: "2026-06-20 09:30:00",
      write: true,
    })
    const log = vi.spyOn(console, "log").mockImplementation(() => {})
    try {
      await COMMAND_HANDLERS.hypothesis(parseArgs([
        "hypothesis",
        "observation-drafts",
        "--project",
        tmpRoot,
        "--date",
        "2026-06-20",
        "--limit",
        "3",
      ]))
      const printed = JSON.parse(String(log.mock.calls.at(-1)?.[0] ?? "{}"))
      expect(printed).toMatchObject({
        schema: "trading-observation-draft-list-run-v1",
        mode: "observation-draft-list",
        dryRun: true,
        filters: { date: "2026-06-20", limit: 3 },
        count: 1,
        writePolicy: {
          readOnly: true,
          wroteWiki: false,
          wroteRaw: false,
          wroteRealTrade: false,
        },
      })
      expect(printed.drafts[0].markdownRelativePath).toMatch(/^\.llm-wiki\/observation-drafts\//)

      await COMMAND_HANDLERS.hypothesis(parseArgs([
        "hypothesis",
        "observation-draft",
        "list",
        "--project",
        tmpRoot,
        "--date",
        "2026-06-20",
      ]))
      const aliasPrinted = JSON.parse(String(log.mock.calls.at(-1)?.[0] ?? "{}"))
      expect(aliasPrinted).toMatchObject({
        schema: "trading-observation-draft-list-run-v1",
        count: 1,
        writePolicy: {
          readOnly: true,
          wroteWiki: false,
          wroteRaw: false,
          wroteRealTrade: false,
        },
      })
    } finally {
      log.mockRestore()
    }
  })

  it("expands bounded local performance profiles without overriding explicit CLI args", () => {
    expect(resolveCliPerformanceProfile({})).toEqual({ name: null, defaults: {} })
    expect(resolveCliPerformanceProfile({ profile: "balanced" })).toEqual({ name: "balanced", defaults: {} })
    expect(resolveCliPerformanceProfile({ profile: "m5max" })).toEqual({
      name: "local-max",
      defaults: {
        agentConcurrency: 8,
        agentTimeoutMs: 180000,
        policyRegressionConcurrency: 8,
        exportVerifyConcurrency: 16,
        verifyConcurrency: 16,
      },
    })
    const args = { profile: "local-max", "agent-concurrency": "3" }
    const profile = resolveCliPerformanceProfile(args)
    const effectiveAgentConcurrency = args["agent-concurrency"] ?? profile.defaults.agentConcurrency
    expect(effectiveAgentConcurrency).toBe("3")
    expect(() => resolveCliPerformanceProfile({ profile: "gpu-cluster" })).toThrow("Unknown performance profile")
  })
})
