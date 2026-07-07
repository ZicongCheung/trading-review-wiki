import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  createStockFeedbackEvidenceTask,
  getStockFeedbackEvidenceSourceStatus,
  getStockFeedbackStatus,
  listStockFeedbackEvidenceDlq,
  listStockFeedbackEvidenceResults,
  listStockFeedbackEvidenceTasks,
  reviewStockFeedbackEvidenceResult,
  runStockFeedbackEvidenceTaskQueue,
  showStockFeedbackEvidenceTask,
  updateStockFeedbackEvidenceDlqEntry,
  verifyStockFeedbackArtifacts,
} from "./codex-ingest-lib.mjs"

let tmpRoot

async function read(filePath) {
  return fs.readFile(filePath, "utf8")
}

function tushareResponse(fields = ["ts_code", "trade_date", "close"], rows = [["300750.SZ", "20260619", 268.5]]) {
  return { code: 0, msg: "", data: { fields, items: rows } }
}

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "stock-feedback-evidence-runner-"))
})

afterEach(async () => {
  if (tmpRoot) await fs.rm(tmpRoot, { recursive: true, force: true })
})

describe("stock-feedback evidence runner thin slice", () => {
  it("creates evidence tasks as dry-run by default and writes only stock-feedback artifacts with --write", async () => {
    const preview = await createStockFeedbackEvidenceTask({
      projectPath: tmpRoot,
      stockCode: "300901.SZ",
      stockName: "样本科技A",
      taskType: "market_data",
      targetFields: "close,turnover_rate",
      preferredSources: "tushare",
      source: "stock_feedback",
      sourceId: "trajectory-001",
      sourceRefs: "stock-feedback:trajectory#trajectory-001",
      generatedAt: "2026-06-21 09:00:00",
    })

    expect(preview.dryRun).toBe(true)
    expect(preview.writeResult).toBeNull()
    expect(preview.task).toMatchObject({
      schema: "stock-feedback-evidence-task-v1",
      status: "pending",
      source: "stock_feedback",
      stockCode: "300901.SZ",
      taskType: "market_data",
      targetFields: ["close", "turnover_rate"],
      evidenceBoundary: {
        noWikiWrite: true,
        noRawWrite: true,
        noTradeAction: true,
      },
    })
    await expect(fs.access(path.join(tmpRoot, ".llm-wiki", "stock-feedback", "evidence-tasks"))).rejects.toThrow()

    const written = await createStockFeedbackEvidenceTask({
      ...preview.task,
      projectPath: tmpRoot,
      generatedAt: "2026-06-21 09:01:00",
      write: true,
    })
    expect(written.writePolicy).toMatchObject({
      wroteWiki: false,
      wroteRaw: false,
      wroteBrain: false,
      wroteArtifacts: true,
      allowedRoot: ".llm-wiki/stock-feedback",
    })

    const listed = await listStockFeedbackEvidenceTasks({ projectPath: tmpRoot })
    const shown = await showStockFeedbackEvidenceTask({ projectPath: tmpRoot, taskId: written.task.taskId })

    expect(listed.count).toBe(1)
    expect(listed.tasks[0]).toMatchObject({ taskId: written.task.taskId, status: "pending" })
    expect(shown.task.taskId).toBe(written.task.taskId)
    expect(await read(written.writeResult.task.path)).toContain("stock-feedback-evidence-task-v1")
  })

  it("runs a pending task into a completed evidence result and verify includes runner artifacts", async () => {
    const taskWrite = await createStockFeedbackEvidenceTask({
      projectPath: tmpRoot,
      stockCode: "300901.SZ",
      stockName: "样本科技A",
      taskType: "market_data",
      targetFields: "close,turnover_rate",
      preferredSources: "tushare,web",
      source: "manual",
      generatedAt: "2026-06-21 09:10:00",
      write: true,
    })

    const run = await runStockFeedbackEvidenceTaskQueue({
      projectPath: tmpRoot,
      taskId: taskWrite.task.taskId,
      adapterResults: {
        [taskWrite.task.taskId]: [
          {
            source: "tushare",
            status: "ok",
            sourceQuality: 95,
            structuredData: { close: 18.2, turnover_rate: 12.5 },
            sourceRefs: ["tushare:daily#300901.SZ/20260619"],
          },
          {
            source: "web",
            status: "ok",
            sourceQuality: 82,
            structuredData: { close: 18.21, turnover_rate: 12.4 },
            sourceRefs: ["web:https://example.com/300901-market-data"],
          },
        ],
      },
      generatedAt: "2026-06-21 09:11:00",
      write: true,
    })

    expect(run.run.summary).toMatchObject({ selected: 1, completed: 1, awaitingReview: 0, failed: 0, dlq: 0 })
    expect(run.results[0]).toMatchObject({
      schema: "stock-feedback-evidence-result-v1",
      status: "completed",
      taskId: taskWrite.task.taskId,
      structuredData: { close: 18.2, turnover_rate: 12.5 },
      crossValidation: { status: "consistent", conflictCount: 0 },
      humanGate: { status: "auto_ready" },
    })
    expect(run.results[0].overallConfidence).toBeGreaterThanOrEqual(90)

    const status = await getStockFeedbackStatus({ projectPath: tmpRoot })
    const sourceStatus = await getStockFeedbackEvidenceSourceStatus({ projectPath: tmpRoot })
    const verified = await verifyStockFeedbackArtifacts({ projectPath: tmpRoot })

    expect(status.counts.evidenceTasksCompleted).toBe(1)
    expect(status.counts.evidenceResultsCompleted).toBe(1)
    expect(sourceStatus.sources.map((item) => item.source).sort()).toEqual(["tushare", "web"])
    expect(verified.status).toBe("ok")
    expect(verified.checked).toMatchObject({
      evidenceTasks: 1,
      evidenceResults: 1,
      evidenceRuns: 1,
      evidenceDlq: 0,
    })
  })

  it("uses the Tushare adapter for market-data evidence without leaking the token", async () => {
    const secret = "redaction-sentinel-value"
    const taskWrite = await createStockFeedbackEvidenceTask({
      projectPath: tmpRoot,
      stockCode: "300750.SZ",
      stockName: "宁德时代",
      taskType: "market_data",
      targetFields: "close,vol",
      preferredSources: "tushare",
      generatedAt: "2026-06-21 09:20:00",
      write: true,
    })

    const run = await runStockFeedbackEvidenceTaskQueue({
      projectPath: tmpRoot,
      taskId: taskWrite.task.taskId,
      tushareToken: secret,
      tushareClient: async ({ apiName, token, params, fields }) => {
        expect(apiName).toBe("daily")
        expect(token).toBe(secret)
        expect(params).toMatchObject({ ts_code: "300750.SZ" })
        expect(fields).toContain("close")
        return tushareResponse(
          ["ts_code", "trade_date", "close", "vol"],
          [["300750.SZ", "20260619", 268.5, 1200000]],
        )
      },
      generatedAt: "2026-06-21 09:21:00",
      write: true,
    })
    const serialized = JSON.stringify(run)

    expect(run.results[0]).toMatchObject({
      status: "completed",
      structuredData: { close: 268.5, vol: 1200000 },
      sources: [
        expect.objectContaining({
          source: "tushare",
          status: "ok",
          sourceRefs: ["tushare:daily#300750.SZ/20260619"],
        }),
      ],
    })
    expect(serialized).not.toContain(secret)
  })

  it("uses the Tavily web adapter for official web evidence without leaking the API key", async () => {
    const secret = "tavily-redaction-sentinel"
    const taskWrite = await createStockFeedbackEvidenceTask({
      projectPath: tmpRoot,
      stockCode: "688525.SH",
      stockName: "佰维存储",
      taskType: "announcement",
      targetFields: "order,customer,shipment,revenue",
      preferredSources: "web",
      source: "stock_feedback",
      sourceId: "stockfb_1c2354aa2dad9c1a",
      notes: "验证佰维存储是否存在订单、客户出货、收入确认等基本面兑现线索。",
      generatedAt: "2026-06-21 09:25:00",
      write: true,
    })

    const run = await runStockFeedbackEvidenceTaskQueue({
      projectPath: tmpRoot,
      taskId: taskWrite.task.taskId,
      tavilyApiKey: secret,
      tavilyClient: async ({ query, apiKey, maxResults }) => {
        expect(apiKey).toBe(secret)
        expect(query).toContain("佰维存储")
        expect(query).toContain("订单")
        expect(query).toContain("官方公告")
        expect(query).toContain("巨潮资讯")
        expect(maxResults).toBeGreaterThan(0)
        return {
          results: [
            {
              title: "佰维存储2025年年度报告",
              url: "https://static.sse.com.cn/disclosure/listedinfo/announcement/c/new/2026-04-16/688525_20260416_annual.pdf",
              content: "佰维存储2025年年度报告披露企业级SSD订单、客户导入、出货进展和收入确认情况。",
              score: 0.95,
              published_date: "2026-04-16",
            },
          ],
        }
      },
      generatedAt: "2026-06-21 09:26:00",
      write: true,
    })
    const serialized = JSON.stringify(run)

    expect(run.run.summary).toMatchObject({ selected: 1, completed: 1, failed: 0, dlq: 0 })
    expect(run.results[0]).toMatchObject({
      status: "completed",
      humanGate: { status: "auto_ready" },
      sources: [
        expect.objectContaining({
          source: "web",
          status: "ok",
          evidenceTier: "official_primary",
          sourceQuality: 96,
          qualityFlags: expect.arrayContaining(["official_source", "hard_source", "discovered_via_web"]),
          sourceRefs: expect.arrayContaining([
            expect.stringMatching(/^sse:announcement#url:/),
            "web:https://static.sse.com.cn/disclosure/listedinfo/announcement/c/new/2026-04-16/688525_20260416_annual.pdf",
          ]),
        }),
      ],
    })
    expect(run.results[0].structuredData).toMatchObject({
      webResultCount: 1,
      officialSourceCount: 1,
      webMatchedTargetFields: ["order", "customer", "shipment", "revenue"],
      webMissingTargetFields: [],
      topTitle: "佰维存储2025年年度报告",
    })
    expect(serialized).not.toContain(secret)
  })

  it("uses the CNINFO hard-source adapter for official announcement evidence", async () => {
    const taskWrite = await createStockFeedbackEvidenceTask({
      projectPath: tmpRoot,
      stockCode: "002859.SZ",
      stockName: "洁美科技",
      taskType: "announcement",
      targetFields: "annual_report,announcement",
      preferredSources: "cninfo",
      source: "stock_feedback",
      sourceId: "stockfb_cninfo_hard_source_001",
      notes: "验证是否存在官方年报公告。",
      generatedAt: "2026-06-21 09:27:00",
      write: true,
    })

    const run = await runStockFeedbackEvidenceTaskQueue({
      projectPath: tmpRoot,
      taskId: taskWrite.task.taskId,
      cninfoClient: async ({ query, stockCode, pageSize }) => {
        expect(query).toContain("洁美科技")
        expect(query).toContain("年度报告")
        expect(stockCode).toBe("002859.SZ")
        expect(pageSize).toBeGreaterThan(0)
        return {
          totalAnnouncement: 1,
          announcements: [
            {
              secCode: "002859",
              secName: "洁美科技",
              announcementId: "1225129614",
              announcementTitle: "2025年年度报告摘要",
              announcementTime: 1776700800000,
              adjunctUrl: "finalpage/2026-04-21/1225129614.PDF",
              adjunctType: "PDF",
            },
          ],
        }
      },
      generatedAt: "2026-06-21 09:28:00",
      write: true,
    })

    expect(run.run.summary).toMatchObject({ selected: 1, completed: 1, failed: 0, dlq: 0 })
    expect(run.results[0]).toMatchObject({
      status: "completed",
      humanGate: { status: "auto_ready" },
      sources: [
        expect.objectContaining({
          source: "cninfo",
          status: "ok",
          evidenceTier: "official_primary",
          sourceKind: "official_disclosure",
          sourceRefs: expect.arrayContaining([
            "cninfo:announcement#002859/1225129614",
            "web:https://static.cninfo.com.cn/finalpage/2026-04-21/1225129614.PDF",
          ]),
        }),
      ],
      structuredData: {
        announcementCount: 1,
        officialSourceCount: 1,
        cninfoMatchedTargetFields: ["annual_report", "announcement"],
        cninfoMissingTargetFields: [],
        topTitle: "2025年年度报告摘要",
      },
    })
  })

  it("skips Tavily lead search when CNINFO hard-source evidence succeeds for disclosure tasks", async () => {
    const taskWrite = await createStockFeedbackEvidenceTask({
      projectPath: tmpRoot,
      stockCode: "688525.SH",
      stockName: "佰维存储",
      taskType: "announcement",
      targetFields: "annual_report,announcement",
      preferredSources: "cninfo,web",
      source: "stock_feedback",
      sourceId: "stockfb_cninfo_before_tavily_001",
      generatedAt: "2026-06-21 09:28:30",
      write: true,
    })
    let tavilyCalled = false

    const run = await runStockFeedbackEvidenceTaskQueue({
      projectPath: tmpRoot,
      taskId: taskWrite.task.taskId,
      cninfoClient: async () => ({
        totalAnnouncement: 1,
        announcements: [
          {
            secCode: "688525",
            secName: "佰维存储",
            announcementId: "1225020228",
            announcementTitle: "2025年年度报告摘要",
            announcementTime: 1773936000000,
            adjunctUrl: "finalpage/2026-03-20/1225020228.PDF",
          },
        ],
      }),
      tavilyApiKey: "should-not-be-used",
      tavilyClient: async () => {
        tavilyCalled = true
        return { results: [] }
      },
      generatedAt: "2026-06-21 09:28:40",
      write: true,
    })

    expect(tavilyCalled).toBe(false)
    expect(run.results[0].sources.map((item) => item.source)).toEqual(["cninfo"])
    expect(run.results[0].status).toBe("completed")
  })

  it("uses exchange announcement fallback before Tavily when CNINFO returns no records", async () => {
    const taskWrite = await createStockFeedbackEvidenceTask({
      projectPath: tmpRoot,
      stockCode: "688525.SH",
      stockName: "佰维存储",
      taskType: "announcement",
      targetFields: "annual_report,announcement",
      preferredSources: "cninfo,web",
      source: "stock_feedback",
      sourceId: "stockfb_exchange_before_tavily_001",
      generatedAt: "2026-06-21 09:28:45",
      write: true,
    })
    let tavilyCalled = false

    const run = await runStockFeedbackEvidenceTaskQueue({
      projectPath: tmpRoot,
      taskId: taskWrite.task.taskId,
      cninfoClient: async () => ({ announcements: [] }),
      sseAnnouncementClient: async ({ company }) => {
        expect(company.stockCode).toBe("688525.SH")
        return {
          status: "success",
          announcements: [
            {
              id: "sse-688525-annual-2025",
              secCode: "688525",
              secName: "佰维存储",
              title: "2025年年度报告摘要",
              date: "2026-03-20",
              downloadUrl: "https://static.sse.com.cn/disclosure/listedinfo/announcement/c/new/2026-03-20/688525_20260320_annual.pdf",
              source: "sse_public_web",
            },
          ],
        }
      },
      tavilyApiKey: "should-not-be-used",
      tavilyClient: async () => {
        tavilyCalled = true
        return { results: [] }
      },
      generatedAt: "2026-06-21 09:28:50",
      write: true,
    })

    expect(tavilyCalled).toBe(false)
    expect(run.results[0]).toMatchObject({
      status: "completed",
      humanGate: { status: "auto_ready" },
      sources: [
        expect.objectContaining({
          source: "cninfo",
          status: "ok",
          evidenceTier: "official_primary",
          sourceKind: "official_disclosure",
          qualityFlags: expect.arrayContaining(["official_source", "hard_source", "exchange_fallback"]),
          sourceRefs: expect.arrayContaining([
            "sse:announcement#688525/sse-688525-annual-2025",
            "web:https://static.sse.com.cn/disclosure/listedinfo/announcement/c/new/2026-03-20/688525_20260320_annual.pdf",
          ]),
          toolStateRefs: expect.arrayContaining([
            expect.stringMatching(/^tool-state:cninfo#announcement:results=0:queries=/),
            expect.stringMatching(/^tool-state:sse#announcement:results=1:query=/),
          ]),
        }),
      ],
      structuredData: {
        announcementCount: 1,
        officialSourceCount: 1,
        exchangeFallback: "sse_public_web",
        cninfoMatchedTargetFields: ["annual_report", "announcement"],
        cninfoMissingTargetFields: [],
      },
    })
  })

  it("uses SZSE announcement fallback before Tavily for Shenzhen listings", async () => {
    const taskWrite = await createStockFeedbackEvidenceTask({
      projectPath: tmpRoot,
      stockCode: "002463.SZ",
      stockName: "沪电股份",
      taskType: "announcement",
      targetFields: "quarterly_report,announcement",
      preferredSources: "cninfo,web",
      source: "stock_feedback",
      sourceId: "stockfb_szse_exchange_before_tavily_001",
      generatedAt: "2026-06-21 09:28:55",
      write: true,
    })
    let tavilyCalled = false

    const run = await runStockFeedbackEvidenceTaskQueue({
      projectPath: tmpRoot,
      taskId: taskWrite.task.taskId,
      cninfoClient: async () => ({ announcements: [] }),
      szseAnnouncementClient: async ({ company }) => {
        expect(company.stockCode).toBe("002463.SZ")
        return {
          status: "success",
          announcements: [
            {
              annId: "1225147393",
              secCode: ["002463"],
              secName: ["沪电股份"],
              title: "沪电股份：2026年一季度报告",
              publishTime: "2026-04-23 00:00:00",
              attachPath: "/disc/disk03/finalpage/2026-04-23/02948974-acd7-4c7c-8b27-b3e0159c2f01.PDF",
              source: "szse_public_web",
            },
          ],
        }
      },
      tavilyApiKey: "should-not-be-used",
      tavilyClient: async () => {
        tavilyCalled = true
        return { results: [] }
      },
      generatedAt: "2026-06-21 09:29:00",
      write: true,
    })

    expect(tavilyCalled).toBe(false)
    expect(run.results[0]).toMatchObject({
      status: "completed",
      humanGate: { status: "auto_ready" },
      sources: [
        expect.objectContaining({
          source: "cninfo",
          status: "ok",
          evidenceTier: "official_primary",
          sourceKind: "official_disclosure",
          qualityFlags: expect.arrayContaining(["official_source", "hard_source", "exchange_fallback"]),
          sourceRefs: expect.arrayContaining([
            "szse:announcement#002463/1225147393",
            "web:https://disc.static.szse.cn/download/disc/disk03/finalpage/2026-04-23/02948974-acd7-4c7c-8b27-b3e0159c2f01.PDF",
          ]),
          toolStateRefs: expect.arrayContaining([
            expect.stringMatching(/^tool-state:cninfo#announcement:results=0:queries=/),
            expect.stringMatching(/^tool-state:szse#announcement:results=1:query=/),
          ]),
        }),
      ],
      structuredData: {
        announcementCount: 1,
        officialSourceCount: 1,
        exchangeFallback: "szse_public_web",
        cninfoMatchedTargetFields: ["quarterly_report", "announcement"],
        cninfoMissingTargetFields: [],
      },
    })
  })

  it("does not treat an official annual report result as evidence for every missing target field", async () => {
    const taskWrite = await createStockFeedbackEvidenceTask({
      projectPath: tmpRoot,
      stockCode: "688525.SH",
      stockName: "佰维存储",
      taskType: "announcement",
      targetFields: "order,customer,shipment,revenue,annual_report,announcement",
      preferredSources: "web",
      source: "stock_feedback",
      sourceId: "stockfb_1c2354aa2dad9c1a",
      notes: "年报摘要只能证明公告/年报存在，不能自动证明订单、客户、出货或收入兑现。",
      generatedAt: "2026-06-21 09:26:30",
      write: true,
    })

    const run = await runStockFeedbackEvidenceTaskQueue({
      projectPath: tmpRoot,
      taskId: taskWrite.task.taskId,
      tavilyApiKey: "tavily-redaction-sentinel",
      tavilyClient: async () => ({
        results: [
          {
            title: "[PDF] 深圳佰维存储科技股份有限公司2025 年年度报告摘要",
            url: "https://static.cninfo.com.cn/finalpage/2026-03-20/1225020228.PDF",
            content: "深圳佰维存储科技股份有限公司2025年年度报告摘要。投资者应当到www.sse.com.cn网站仔细阅读2025年年度报告全文。",
            score: 0.95,
            published_date: "2026-03-20",
          },
        ],
      }),
      generatedAt: "2026-06-21 09:26:40",
      write: true,
    })

    expect(run.results[0]).toMatchObject({
      status: "awaiting_review",
      humanGate: { status: "awaiting_review" },
      structuredData: {
        officialSourceCount: 1,
        webMatchedTargetFields: ["annual_report", "announcement"],
        webMissingTargetFields: ["order", "customer", "shipment", "revenue"],
        webSourceQualitySummary: [
          expect.objectContaining({
            officialDisclosureRef: expect.stringMatching(/^cninfo:announcement#url:/),
          }),
        ],
      },
    })
    expect(run.results[0].qualityReport.fieldCompleteness).toBe(33.33)
  })

  it("keeps portal or garbled Tavily web evidence in human review instead of auto-ready", async () => {
    const taskWrite = await createStockFeedbackEvidenceTask({
      projectPath: tmpRoot,
      stockCode: "688525.SH",
      stockName: "佰维存储",
      taskType: "announcement",
      targetFields: "order,customer,shipment,revenue",
      preferredSources: "web",
      source: "stock_feedback",
      sourceId: "stockfb_1c2354aa2dad9c1a",
      notes: "验证佰维存储基本面兑现线索，但门户页不能替代正式公告。",
      generatedAt: "2026-06-21 09:27:00",
      write: true,
    })

    const run = await runStockFeedbackEvidenceTaskQueue({
      projectPath: tmpRoot,
      taskId: taskWrite.task.taskId,
      tavilyApiKey: "tavily-redaction-sentinel",
      tavilyClient: async () => ({
        results: [
          {
            title: "公司公告_佰维存储：2025年年度报告新浪财经",
            url: "https://vip.stock.finance.sina.com.cn/corp/view/vCB_AllBulletinDetail.php?CompanyCode=80964444&gather=1&id=12005837",
            content: "å…¬å‘Š å¹´åº¦ æŠ¥å‘Š 企业级SSD 客户 出货 收入确认",
            score: 0.92,
            published_date: "2026-04-16",
          },
        ],
      }),
      generatedAt: "2026-06-21 09:28:00",
      write: true,
    })

    expect(run.results[0]).toMatchObject({
      status: "awaiting_review",
      humanGate: { status: "awaiting_review" },
      sources: [
        expect.objectContaining({
          source: "web",
          status: "ok",
          evidenceTier: "secondary_portal",
          sourceQuality: 52,
          qualityFlags: expect.arrayContaining(["secondary_portal", "text_quality_warning"]),
        }),
      ],
    })
    expect(run.results[0].structuredData).toMatchObject({
      webResultCount: 1,
      officialSourceCount: 0,
      requiresOfficialConfirmation: true,
    })
  })

  it("routes missing Tushare credentials through the fallback failure path", async () => {
    const taskWrite = await createStockFeedbackEvidenceTask({
      projectPath: tmpRoot,
      stockCode: "300750.SZ",
      taskType: "market_data",
      targetFields: "close",
      preferredSources: "tushare",
      generatedAt: "2026-06-21 09:30:00",
      write: true,
    })

    const run = await runStockFeedbackEvidenceTaskQueue({
      projectPath: tmpRoot,
      taskId: taskWrite.task.taskId,
      tushareToken: "",
      generatedAt: "2026-06-21 09:31:00",
      write: true,
    })

    expect(run.run.summary).toMatchObject({ selected: 1, failed: 1, dlq: 1 })
    expect(run.results[0].sources[0]).toMatchObject({
      source: "tushare",
      status: "failed",
    })
    expect(JSON.stringify(run)).not.toContain("redaction-sentinel-value")
  })

  it("routes conflicting source values to review and supports explicit human approval", async () => {
    const taskWrite = await createStockFeedbackEvidenceTask({
      projectPath: tmpRoot,
      stockCode: "002859.SZ",
      stockName: "洁美科技",
      taskType: "financial_metrics",
      targetFields: "net_profit",
      preferredSources: "cninfo,tushare",
      source: "hypothesis",
      sourceId: "hypothesis-001",
      generatedAt: "2026-06-21 10:00:00",
      write: true,
    })

    const run = await runStockFeedbackEvidenceTaskQueue({
      projectPath: tmpRoot,
      taskId: taskWrite.task.taskId,
      adapterResults: {
        default: [
          {
            source: "cninfo",
            status: "ok",
            sourceQuality: 96,
            structuredData: { net_profit: 1228000000 },
            sourceRefs: ["cninfo:announcement#002859.SZ/2025Q4"],
          },
          {
            source: "tushare",
            status: "ok",
            sourceQuality: 90,
            structuredData: { net_profit: 1380000000 },
            sourceRefs: ["tushare:income#002859.SZ/20251231"],
          },
        ],
      },
      generatedAt: "2026-06-21 10:01:00",
      write: true,
    })

    expect(run.results[0]).toMatchObject({
      status: "awaiting_review",
      crossValidation: {
        status: "conflict",
        conflictCount: 1,
      },
      humanGate: {
        status: "awaiting_review",
      },
    })
    const awaiting = await listStockFeedbackEvidenceResults({ projectPath: tmpRoot, status: "awaiting_review" })
    expect(awaiting.results[0].reviewPlan).toMatchObject({
      status: "hard_source_review_ready",
      recommendedAction: "approve_after_manual_source_check",
      requiresHumanGate: true,
      approveCommand: expect.stringContaining(`stock-feedback evidence-result review --result-id ${run.results[0].resultId}`),
    })

    const reviewed = await reviewStockFeedbackEvidenceResult({
      projectPath: tmpRoot,
      resultId: run.results[0].resultId,
      action: "approve",
      reviewer: "analyst",
      note: "采信 CNINFO 正式公告，Tushare 可能有口径差异。",
      generatedAt: "2026-06-21 10:02:00",
      write: true,
    })
    const results = await listStockFeedbackEvidenceResults({ projectPath: tmpRoot, status: "completed" })
    const verified = await verifyStockFeedbackArtifacts({ projectPath: tmpRoot })

    expect(reviewed.reviewed).toMatchObject({
      status: "completed",
      humanGate: {
        status: "approved",
        action: "approve",
        reviewer: "analyst",
      },
    })
    expect(results.count).toBe(1)
    expect(verified.status).toBe("ok")
  })

  it("marks web-only awaiting evidence results as duplicate leads when hard-source evidence already completed", async () => {
    const hardTask = await createStockFeedbackEvidenceTask({
      projectPath: tmpRoot,
      stockCode: "688525.SH",
      stockName: "佰维存储",
      taskType: "announcement",
      targetFields: "annual_report,announcement",
      preferredSources: "cninfo",
      generatedAt: "2026-06-21 10:10:00",
      write: true,
    })
    await runStockFeedbackEvidenceTaskQueue({
      projectPath: tmpRoot,
      taskId: hardTask.task.taskId,
      adapterResults: {
        default: [{
          source: "cninfo",
          status: "ok",
          sourceQuality: 96,
          sourceKind: "official_disclosure",
          evidenceTier: "official_primary",
          qualityFlags: ["official_source", "hard_source"],
          structuredData: { annual_report: "2025年年度报告", announcement: "2025年年度报告" },
          sourceRefs: ["cninfo:announcement#688525/1225020228"],
        }],
      },
      generatedAt: "2026-06-21 10:11:00",
      write: true,
    })

    const webTask = await createStockFeedbackEvidenceTask({
      projectPath: tmpRoot,
      stockCode: "688525.SH",
      stockName: "佰维存储",
      taskType: "announcement",
      targetFields: "annual_report,announcement",
      preferredSources: "web",
      generatedAt: "2026-06-21 10:12:00",
      write: true,
    })
    const webRun = await runStockFeedbackEvidenceTaskQueue({
      projectPath: tmpRoot,
      taskId: webTask.task.taskId,
      adapterResults: {
        default: [{
          source: "web",
          status: "ok",
          sourceQuality: 50,
          structuredData: { annual_report: "2025年年度报告", announcement: "2025年年度报告" },
          sourceRefs: ["web:https://example.com/secondary-biwin-report"],
        }],
      },
      generatedAt: "2026-06-21 10:13:00",
      write: true,
    })

    expect(webRun.results[0].status).toBe("awaiting_review")
    const awaiting = await listStockFeedbackEvidenceResults({ projectPath: tmpRoot, status: "awaiting_review" })
    expect(awaiting.reviewPlanCounts).toMatchObject({
      duplicate_web_lead_after_hard_source: 1,
    })
    expect(awaiting.results[0].reviewPlan).toMatchObject({
      status: "duplicate_web_lead_after_hard_source",
      riskLevel: "medium",
      recommendedAction: "reject_duplicate_or_mark_needs_more_evidence",
      blockers: ["secondary_web_after_completed_hard_source"],
      rejectCommand: expect.stringContaining(`stock-feedback evidence-result review --result-id ${webRun.results[0].resultId} --action reject`),
    })
    const status = await getStockFeedbackStatus({ projectPath: tmpRoot })
    expect(status.evidenceRunner.reviewAudit).toMatchObject({
      status: "human_review_required",
      counts: {
        awaitingReview: 1,
        duplicateWebLeadAfterHardSource: 1,
      },
      reviewPlanCounts: {
        duplicate_web_lead_after_hard_source: 1,
      },
    })
    expect(status.evidenceRunner.counts).toMatchObject({
      resultsAwaitingReview: 1,
      duplicateWebLeadAfterHardSource: 1,
    })
  })

  it("puts tasks without usable evidence into DLQ and blocks approval", async () => {
    const taskWrite = await createStockFeedbackEvidenceTask({
      projectPath: tmpRoot,
      stockCode: "000001.SZ",
      taskType: "announcement",
      targetFields: "announcement_title",
      preferredSources: "cninfo",
      generatedAt: "2026-06-21 11:00:00",
      write: true,
    })

    const run = await runStockFeedbackEvidenceTaskQueue({
      projectPath: tmpRoot,
      taskId: taskWrite.task.taskId,
      adapterResults: {
        default: [{ source: "cninfo", status: "failed", error: "mock 503" }],
      },
      generatedAt: "2026-06-21 11:01:00",
      write: true,
    })
    const dlq = await listStockFeedbackEvidenceDlq({ projectPath: tmpRoot })

    expect(run.run.summary).toMatchObject({ selected: 1, failed: 1, dlq: 1 })
    expect(run.results[0]).toMatchObject({
      status: "failed",
      humanGate: {
        status: "needs_more_evidence",
      },
    })
    expect(dlq.count).toBe(1)
    await expect(reviewStockFeedbackEvidenceResult({
      projectPath: tmpRoot,
      resultId: run.results[0].resultId,
      action: "approve",
    })).rejects.toThrow("requires sourceRefs")
  })

  it("retries and discards DLQ entries without writing outside stock-feedback artifacts", async () => {
    const retryTask = await createStockFeedbackEvidenceTask({
      projectPath: tmpRoot,
      stockCode: "300750.SZ",
      taskType: "market_data",
      targetFields: "close",
      preferredSources: "tushare",
      generatedAt: "2026-06-21 12:00:00",
      write: true,
    })
    const failedRun = await runStockFeedbackEvidenceTaskQueue({
      projectPath: tmpRoot,
      taskId: retryTask.task.taskId,
      adapterResults: {
        default: [{ source: "tushare", status: "failed", error: "mock timeout" }],
      },
      generatedAt: "2026-06-21 12:01:00",
      write: true,
    })
    const openDlq = await listStockFeedbackEvidenceDlq({ projectPath: tmpRoot })
    expect(openDlq.count).toBe(1)

    const retry = await updateStockFeedbackEvidenceDlqEntry({
      projectPath: tmpRoot,
      dlqId: openDlq.entries[0].id,
      action: "retry",
      reviewer: "qa",
      note: "数据源恢复后重试",
      generatedAt: "2026-06-21 12:02:00",
      write: true,
    })
    const pendingTasks = await listStockFeedbackEvidenceTasks({ projectPath: tmpRoot, status: "pending" })
    const closedDlq = await listStockFeedbackEvidenceDlq({ projectPath: tmpRoot })
    const allDlqAfterRetry = await listStockFeedbackEvidenceDlq({ projectPath: tmpRoot, status: "all" })

    expect(retry.dryRun).toBe(false)
    expect(retry.writePolicy).toMatchObject({
      wroteWiki: false,
      wroteRaw: false,
      wroteBrain: false,
      wroteArtifacts: true,
      allowedRoot: ".llm-wiki/stock-feedback",
    })
    expect(pendingTasks.tasks.map((task) => task.taskId)).toContain(retryTask.task.taskId)
    expect(closedDlq.count).toBe(0)
    expect(allDlqAfterRetry.entries.find((entry) => entry.id === openDlq.entries[0].id)).toMatchObject({ status: "retried" })

    const retryRun = await runStockFeedbackEvidenceTaskQueue({
      projectPath: tmpRoot,
      taskId: retryTask.task.taskId,
      adapterResults: {
        default: [{ source: "tushare", status: "ok", sourceQuality: 94, structuredData: { close: 268.5 }, sourceRefs: ["tushare:daily#300750.SZ/20260619"] }],
      },
      generatedAt: "2026-06-21 12:03:00",
      write: true,
    })
    expect(retryRun.run.summary).toMatchObject({ selected: 1, completed: 1, failed: 0, dlq: 0 })

    const discardTask = await createStockFeedbackEvidenceTask({
      projectPath: tmpRoot,
      stockCode: "600519.SH",
      taskType: "announcement",
      targetFields: "announcement_title",
      preferredSources: "cninfo",
      generatedAt: "2026-06-21 12:10:00",
      write: true,
    })
    await runStockFeedbackEvidenceTaskQueue({
      projectPath: tmpRoot,
      taskId: discardTask.task.taskId,
      adapterResults: {
        default: [{ source: "cninfo", status: "failed", error: "mock not found" }],
      },
      generatedAt: "2026-06-21 12:11:00",
      write: true,
    })
    const secondOpenDlq = await listStockFeedbackEvidenceDlq({ projectPath: tmpRoot })
    const discard = await updateStockFeedbackEvidenceDlqEntry({
      projectPath: tmpRoot,
      taskId: discardTask.task.taskId,
      action: "discard",
      reviewer: "qa",
      note: "错误任务关闭",
      generatedAt: "2026-06-21 12:12:00",
      write: true,
    })
    const allDlqAfterDiscard = await listStockFeedbackEvidenceDlq({ projectPath: tmpRoot, status: "all" })
    const verified = await verifyStockFeedbackArtifacts({ projectPath: tmpRoot })

    expect(secondOpenDlq.count).toBe(1)
    expect(discard.dlq).toMatchObject({ status: "discarded", taskId: discardTask.task.taskId })
    expect(allDlqAfterDiscard.entries.find((entry) => entry.taskId === discardTask.task.taskId)).toMatchObject({ status: "discarded" })
    expect(verified.status).toBe("ok")
    expect(failedRun.writeResult.dlq.relativePath).toMatch(/^\.llm-wiki\/stock-feedback\/evidence-dlq\//)
  })
})
