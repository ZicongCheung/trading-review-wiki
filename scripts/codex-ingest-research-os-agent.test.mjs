import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  buildHypothesisEvidenceFeedback,
  buildResearchOsAgentPlan,
  buildResearchOsAgentStatus,
  createHypothesis,
  createStockFeedbackEvidenceTask,
  draftHypothesisEvidenceTasks,
  listResearchOsAgentReviewItems,
  recordStockFeedbackPaperTrade,
  runResearchOsAgentStep,
  runStockFeedbackEvidenceTaskQueue,
  settleStockFeedbackPaperTrade,
  verifyResearchOsAgentArtifacts,
} from "./codex-ingest-lib.mjs"

const execFileAsync = promisify(execFile)

let tmpRoot

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "research-os-agent-"))
})

afterEach(async () => {
  if (tmpRoot) await fs.rm(tmpRoot, { recursive: true, force: true })
})

async function write(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, content, "utf8")
}

async function seedHypothesisEvidenceFeedback() {
  const created = await createHypothesis({
    projectPath: tmpRoot,
    title: "样本科技预期交易验证",
    theme: "训练飞轮",
    segments: "样本科技,预期交易",
    keyVariables: "相对强度,成交额承接",
    risks: "close < 20",
    evidenceRefs: "wiki/样本科技.md",
    marketRefs: "stock_daily_sql:样本科技相对强度",
    status: "watching",
    generatedAt: "2026-06-21 09:00:00",
    write: true,
  })
  const task = await createStockFeedbackEvidenceTask({
    projectPath: tmpRoot,
    stockCode: "300901.SZ",
    stockName: "样本科技",
    taskType: "market_data",
    targetFields: "close,turnover_rate",
    preferredSources: "tushare,web",
    source: "hypothesis",
    sourceId: created.hypothesis.id,
    sourceRefs: "wiki/样本科技.md",
    generatedAt: "2026-06-21 09:05:00",
    write: true,
  })
  await runStockFeedbackEvidenceTaskQueue({
    projectPath: tmpRoot,
    taskId: task.task.taskId,
    adapterResults: {
      [task.task.taskId]: [
        {
          source: "tushare",
          status: "ok",
          sourceQuality: 95,
          structuredData: { close: 18.2, turnover_rate: 12.5 },
          sourceRefs: ["tushare:daily#300901.SZ/20260620"],
        },
        {
          source: "web",
          status: "ok",
          sourceQuality: 90,
          structuredData: { close: 18.2, turnover_rate: 12.5 },
          sourceRefs: ["web:https://example.com/sample-tech"],
        },
      ],
    },
    generatedAt: "2026-06-21 09:06:00",
    write: true,
  })
  await buildHypothesisEvidenceFeedback({
    projectPath: tmpRoot,
    id: created.hypothesis.id,
    generatedAt: "2026-06-21 09:10:00",
    write: true,
  })
  return created
}

describe("research-os Codex-orchestrated agent backend", () => {
  it("builds a read-only context and an empty-state plan without writing artifacts", async () => {
    const status = await buildResearchOsAgentStatus({
      projectPath: tmpRoot,
      generatedAt: "2026-06-21 10:00:00",
    })

    expect(status).toMatchObject({
      schema: "research-os-agent-context-v1",
      mode: "research-os-agent-status",
      projectPath: tmpRoot,
      writePolicy: {
        readOnly: true,
        wroteWiki: false,
        wroteRaw: false,
        wroteRealTrade: false,
      },
    })
    expect(status.stockFeedback.counts.trajectories).toBe(0)
    expect(status.hypothesis.checked.hypotheses).toBe(0)
    expect(status.agentOrchestration.nextAgent).toMatch(/HypothesisAgent|EvidenceAgent/)

    const plan = await buildResearchOsAgentPlan({
      projectPath: tmpRoot,
      generatedAt: "2026-06-21 10:01:00",
    })

    expect(plan).toMatchObject({
      schema: "research-os-agent-plan-v1",
      dryRun: true,
      nextAgent: "HypothesisAgent",
      writeResult: null,
      writeBoundary: {
        allowedRoot: ".llm-wiki/research-os/agent-runs",
        wroteWiki: false,
        wroteRaw: false,
        wroteRealTrade: false,
      },
    })
    expect(plan.steps[0]).toMatchObject({
      agentId: "HypothesisAgent",
      humanGateStatus: "pending_human_gate",
      status: "blocked_human_gate",
      writeCommand: "hypothesis evidence-feedback --status watching --write",
      writeBoundary: {
        allowedRoots: [".llm-wiki/hypothesis-evidence-feedback"],
      },
    })
    await expect(fs.access(path.join(tmpRoot, ".llm-wiki", "research-os", "agent-runs"))).rejects.toThrow()
  })

  it("routes hypothesis evidence-feedback to PaperTradeAgent", async () => {
    await seedHypothesisEvidenceFeedback()

    const plan = await buildResearchOsAgentPlan({
      projectPath: tmpRoot,
      generatedAt: "2026-06-21 10:10:00",
    })

    expect(plan).toMatchObject({
      nextAgent: "PaperTradeAgent",
      currentStage: "paper_trade_candidate",
    })
    expect(plan.steps[0]).toMatchObject({
      agentId: "PaperTradeAgent",
      fixedAction: "stock-feedback-paper-trade-agent-candidates",
      writeCommand: "stock-feedback paper-trade-agent candidates --write",
    })
  })

  it("routes weak hypotheses to evidence-task draft handoff before formal evidence tasks", async () => {
    await createHypothesis({
      projectPath: tmpRoot,
      title: "AI高速PCB订单兑现需要先补硬源",
      theme: "训练飞轮",
      segments: "PCB,订单兑现",
      status: "watching",
      generatedAt: "2026-06-21 10:07:00",
      write: true,
    })

    const status = await buildResearchOsAgentStatus({
      projectPath: tmpRoot,
      generatedAt: "2026-06-21 10:08:00",
    })
    expect(status.counts.hypothesisEvidenceTaskDrafts).toBe(0)

    const plan = await buildResearchOsAgentPlan({
      projectPath: tmpRoot,
      generatedAt: "2026-06-21 10:09:00",
    })

    expect(plan).toMatchObject({
      nextAgent: "HypothesisAgent",
      currentStage: "hypothesis_evidence_task_drafting",
    })
    expect(plan.steps[0]).toMatchObject({
      agentId: "HypothesisAgent",
      fixedAction: "hypothesis-evidence-task-drafts-write",
      writeCommand: "hypothesis evidence-task-drafts --status watching --write",
      writeBoundary: {
        allowedRoots: [".llm-wiki/hypothesis-evidence-task-drafts"],
      },
    })
  })

  it("routes existing evidence-task drafts to EvidencePlanningAgent human review", async () => {
    await createHypothesis({
      projectPath: tmpRoot,
      title: "AI高速PCB订单兑现需要先补硬源",
      theme: "训练飞轮",
      segments: "PCB,订单兑现",
      status: "watching",
      generatedAt: "2026-06-21 10:11:00",
      write: true,
    })
    await draftHypothesisEvidenceTasks({
      projectPath: tmpRoot,
      status: "watching",
      generatedAt: "2026-06-21 10:12:00",
      write: true,
    })

    const plan = await buildResearchOsAgentPlan({
      projectPath: tmpRoot,
      generatedAt: "2026-06-21 10:13:00",
    })

    expect(plan).toMatchObject({
      nextAgent: "EvidencePlanningAgent",
      currentStage: "hypothesis_evidence_task_review",
      nextAction: "review_hypothesis_evidence_task_drafts_provide_stock_identity",
    })
    expect(plan.steps[0]).toMatchObject({
      agentId: "EvidencePlanningAgent",
      fixedAction: "hypothesis-evidence-task-draft-review",
      status: "blocked_human_input",
      inputRefs: expect.arrayContaining([
        "hypothesis-evidence-task-drafts:1",
        "needs-stock-identity:1",
      ]),
      readCommands: [
        "hypothesis evidence-task-draft-list --gate low_confidence_candidates --candidate-limit 5",
        "hypothesis evidence-task-draft-list --gate needs_stock_identity --candidate-limit 5",
      ],
      writeCommand: expect.stringContaining("hypothesis evidence-task-draft-review"),
      writeBoundary: {
        allowedRoots: [".llm-wiki/stock-feedback/evidence-tasks"],
      },
      reviewActionTable: [
        expect.objectContaining({
          targetType: "hypothesis_evidence_task_draft",
          gateStatus: "needs_stock_identity",
          humanGateAction: "provide_explicit_stock_identity",
          preferredCommand: expect.stringContaining("--stock-code <code> --stock-name <name>"),
          blockers: expect.arrayContaining(["missing_stock_identity"]),
        }),
      ],
    })

    await buildResearchOsAgentPlan({
      projectPath: tmpRoot,
      generatedAt: "2026-06-21 10:13:01",
      write: true,
    })
    const verified = await verifyResearchOsAgentArtifacts({ projectPath: tmpRoot })
    expect(verified.status).toBe("ok")
  })

  it("surfaces stock-feedback evidence link drafts before refreshing hypothesis feedback", async () => {
    await createHypothesis({
      projectPath: tmpRoot,
      title: "AI订单客户证据是否支持预期交易",
      theme: "训练飞轮",
      segments: "预期交易",
      status: "watching",
      generatedAt: "2026-06-21 10:20:00",
      write: true,
    })
    const structuredOnlyTask = await createStockFeedbackEvidenceTask({
      projectPath: tmpRoot,
      stockCode: "688525.SH",
      stockName: "佰维存储",
      taskType: "financial_metrics",
      targetFields: "order,customer,announcement",
      preferredSources: "tushare",
      source: "stock_feedback",
      sourceId: "stockfb_link_structured_only_fixture",
      sourceRefs: "stock-feedback-trajectory:stockfb_link_structured_only_fixture",
      generatedAt: "2026-06-21 10:20:30",
      write: true,
    })
    await runStockFeedbackEvidenceTaskQueue({
      projectPath: tmpRoot,
      taskId: structuredOnlyTask.task.taskId,
      adapterResults: {
        [structuredOnlyTask.task.taskId]: [
          {
            source: "tushare",
            status: "ok",
            sourceQuality: 100,
            structuredData: {
              order: "AI存储订单待人工核对",
              customer: "客户导入待人工核对",
              announcement: "订单客户公告待人工核对",
            },
            sourceRefs: ["tushare:fina_indicator#688525.SH/20260331"],
          },
        ],
      },
      generatedAt: "2026-06-21 10:20:45",
      write: true,
    })
    const zeroResultCninfoTask = await createStockFeedbackEvidenceTask({
      projectPath: tmpRoot,
      stockCode: "688525.SH",
      stockName: "佰维存储",
      taskType: "announcement",
      targetFields: "order,customer,announcement",
      preferredSources: "cninfo",
      source: "stock_feedback",
      sourceId: "stockfb_link_zero_result_cninfo_fixture",
      sourceRefs: "stock-feedback-trajectory:stockfb_link_zero_result_cninfo_fixture",
      generatedAt: "2026-06-21 10:20:46",
      write: true,
    })
    await runStockFeedbackEvidenceTaskQueue({
      projectPath: tmpRoot,
      taskId: zeroResultCninfoTask.task.taskId,
      adapterResults: {
        [zeroResultCninfoTask.task.taskId]: [
          {
            source: "cninfo",
            status: "ok",
            sourceQuality: 90,
            structuredData: {
              order: "未检出",
              customer: "未检出",
              announcement: "未检出",
            },
            sourceRefs: [],
            toolStateRefs: ["tool-state:cninfo#announcement:results=0:queries=4"],
          },
        ],
      },
      generatedAt: "2026-06-21 10:20:47",
      write: true,
    })
    const webStaticCninfoTask = await createStockFeedbackEvidenceTask({
      projectPath: tmpRoot,
      stockCode: "688525.SH",
      stockName: "佰维存储",
      taskType: "announcement",
      targetFields: "order,customer,announcement",
      preferredSources: "web",
      source: "stock_feedback",
      sourceId: "stockfb_link_web_static_cninfo_fixture",
      sourceRefs: "stock-feedback-trajectory:stockfb_link_web_static_cninfo_fixture",
      generatedAt: "2026-06-21 10:20:50",
      write: true,
    })
    await runStockFeedbackEvidenceTaskQueue({
      projectPath: tmpRoot,
      taskId: webStaticCninfoTask.task.taskId,
      adapterResults: {
        [webStaticCninfoTask.task.taskId]: [
          {
            source: "web",
            status: "ok",
            sourceQuality: 100,
            structuredData: {
              order: "AI存储订单待人工核对",
              customer: "客户导入待人工核对",
              announcement: "订单客户公告待人工核对",
            },
            sourceRefs: ["web:https://static.cninfo.com.cn/finalpage/2026-03-20/1225020228.PDF"],
          },
        ],
      },
      generatedAt: "2026-06-21 10:20:55",
      write: true,
    })
    const task = await createStockFeedbackEvidenceTask({
      projectPath: tmpRoot,
      stockCode: "688525.SH",
      stockName: "佰维存储",
      taskType: "announcement",
      targetFields: "order,customer,announcement",
      preferredSources: "cninfo,web",
      source: "stock_feedback",
      sourceId: "stockfb_link_fixture",
      sourceRefs: "stock-feedback-trajectory:stockfb_link_fixture",
      generatedAt: "2026-06-21 10:21:00",
      write: true,
    })
    await runStockFeedbackEvidenceTaskQueue({
      projectPath: tmpRoot,
      taskId: task.task.taskId,
      adapterResults: {
        [task.task.taskId]: [
          {
            source: "cninfo",
            status: "ok",
            sourceQuality: 100,
            structuredData: {
              order: "AI存储订单待人工核对",
              customer: "客户导入待人工核对",
              announcement: "订单客户公告待人工核对",
            },
            sourceRefs: ["cninfo:announcement#688525/fixture"],
          },
          {
            source: "web",
            status: "ok",
            sourceQuality: 100,
            structuredData: {
              order: "AI存储订单待人工核对",
              customer: "客户导入待人工核对",
              announcement: "订单客户公告待人工核对",
            },
            sourceRefs: ["web:https://example.com/biwin-order"],
          },
        ],
      },
      generatedAt: "2026-06-21 10:22:00",
      write: true,
    })

    const status = await buildResearchOsAgentStatus({
      projectPath: tmpRoot,
      generatedAt: "2026-06-21 10:23:00",
    })
    expect(status.counts).toMatchObject({
      hypothesisEvidenceLinkDrafts: 4,
      hypothesisEvidenceLinkDraftLowConfidenceCandidates: 4,
      hypothesisEvidenceLinkDraftNeedsHypothesisMapping: 0,
    })
    expect(status.agentOrchestration).toMatchObject({
      currentStage: "hypothesis_evidence_link_review",
      nextAgent: "HypothesisLinkAgent",
      nextAction: "review_low_confidence_hypothesis_evidence_link_drafts_before_feedback",
      blockedBy: "human_review_required",
    })
    expect(status.hypothesis.evidenceLinkDraftReview.sourceIntegrityProfileCounts).toMatchObject({
      native_official_disclosure: 1,
      web_official_pdf: 1,
      structured_data_only: 1,
      needs_source_refs: 1,
    })
    expect(status.hypothesis.evidenceLinkDraftReview.samples[0]).toMatchObject({
      status: "low_confidence_candidates",
      evidenceResultId: expect.any(String),
      sourceIntegrity: expect.objectContaining({
        status: "hard_source_present",
        sourceProfile: "native_official_disclosure",
        officialSourceRefs: ["cninfo:announcement#688525/fixture"],
        recommendedEvidenceAction: "review_official_disclosure_before_link",
      }),
      selectedCandidate: expect.objectContaining({
        confidence: "low",
      }),
    })

    const plan = await buildResearchOsAgentPlan({
      projectPath: tmpRoot,
      generatedAt: "2026-06-21 10:24:00",
    })
    expect(plan).toMatchObject({
      currentStage: "hypothesis_evidence_link_review",
      nextAgent: "HypothesisLinkAgent",
      nextAction: "review_low_confidence_hypothesis_evidence_link_drafts_before_feedback",
    })
    expect(plan.steps[0]).toMatchObject({
      agentId: "HypothesisLinkAgent",
      fixedAction: "hypothesis-evidence-link-review",
      status: "blocked_human_input",
      counts: expect.objectContaining({
        nativeOfficialDisclosure: 1,
        webOfficialPdf: 1,
        structuredDataOnly: 1,
        needsSourceRefs: 1,
      }),
      inputRefs: expect.arrayContaining([
        "hypothesis-evidence-link-drafts:4",
        "low-confidence-candidates:4",
      ]),
      readCommands: ["hypothesis evidence-link-drafts --status watching --limit 20"],
      writeCommand: "hypothesis evidence-link-review --draft-id <id> --candidate-index <n> --confirm-human-gate true --write",
      writeBoundary: {
        allowedRoots: [".llm-wiki/hypothesis-evidence-links"],
      },
    })
    expect(plan.steps[0].reviewActionTable[0]).toMatchObject({
      targetType: "hypothesis_evidence_link_draft",
      humanGateAction: "review_candidate_before_link",
      preferredCommand: expect.stringContaining("hypothesis evidence-link-review --draft-id"),
      alternativeCommands: expect.arrayContaining([
        expect.stringContaining("--confirm-human-gate true --write"),
      ]),
      sourceIntegrity: expect.objectContaining({
        status: "hard_source_present",
        sourceProfile: "native_official_disclosure",
        recommendedEvidenceAction: "review_official_disclosure_before_link",
        officialSourceRefs: ["cninfo:announcement#688525/fixture"],
      }),
      requiresLowConfidenceConfirmation: true,
    })
    expect(plan.steps[0].reviewActionTable[1].sourceIntegrity).toMatchObject({
      status: "hard_source_present",
      sourceProfile: "web_official_pdf",
      officialSourceRefs: ["web:https://static.cninfo.com.cn/finalpage/2026-03-20/1225020228.PDF"],
    })
    expect(plan.steps[0].reviewActionTable[2].sourceIntegrity).toMatchObject({
      status: "structured_data_only",
      sourceProfile: "structured_data_only",
    })
    expect(plan.steps[0].reviewActionTable[3].sourceIntegrity).toMatchObject({
      status: "needs_source_refs",
      sourceProfile: "needs_source_refs",
      cninfoOrExchangeRefs: [],
    })

    await buildResearchOsAgentPlan({
      projectPath: tmpRoot,
      generatedAt: "2026-06-21 10:24:01",
      write: true,
    })
    const review = await listResearchOsAgentReviewItems({
      projectPath: tmpRoot,
      generatedAt: "2026-06-21 10:24:02",
    })
    expect(review.nextHumanGateActions[0]).toMatchObject({
      queueId: "hypothesis_evidence_link_review",
      targetType: "hypothesis_evidence_link_draft",
      sourceIntegrity: expect.objectContaining({
        status: "hard_source_present",
        recommendedEvidenceAction: "review_official_disclosure_before_link",
      }),
    })
    const verified = await verifyResearchOsAgentArtifacts({ projectPath: tmpRoot })
    expect(verified.status).toBe("ok")
  })

  it("routes pending evidence results to EvidenceAgent human review before drafting more tasks", async () => {
    await createHypothesis({
      projectPath: tmpRoot,
      title: "AI高速PCB订单兑现需要先补硬源",
      theme: "训练飞轮",
      segments: "PCB,订单兑现",
      status: "watching",
      generatedAt: "2026-06-21 10:16:00",
      write: true,
    })
    await draftHypothesisEvidenceTasks({
      projectPath: tmpRoot,
      status: "watching",
      generatedAt: "2026-06-21 10:17:00",
      write: true,
    })
    const task = await createStockFeedbackEvidenceTask({
      projectPath: tmpRoot,
      stockCode: "002859.SZ",
      stockName: "洁美科技",
      taskType: "financial_metrics",
      targetFields: "net_profit",
      preferredSources: "cninfo,tushare",
      source: "hypothesis",
      sourceId: "hypothesis-evidence-review-001",
      generatedAt: "2026-06-21 10:18:00",
      write: true,
    })
    await runStockFeedbackEvidenceTaskQueue({
      projectPath: tmpRoot,
      taskId: task.task.taskId,
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
      generatedAt: "2026-06-21 10:19:00",
      write: true,
    })

    const status = await buildResearchOsAgentStatus({
      projectPath: tmpRoot,
      generatedAt: "2026-06-21 10:20:00",
    })
    expect(status.agentOrchestration).toMatchObject({
      currentStage: "evidence_result_review",
      nextAgent: "EvidenceAgent",
      nextAction: "review_evidence_results_by_review_plan",
      blockedBy: "human_review_required",
    })
    expect(status.stockFeedback.evidenceRunner.reviewAudit).toMatchObject({
      status: "human_review_required",
      counts: {
        awaitingReview: 1,
        hardSourceReviewReady: 1,
      },
    })
    expect(status.secondaryQueues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        queueId: "evidence_task_followup",
        agentId: "EvidenceAgent",
        counts: expect.objectContaining({
          awaitingReview: 1,
          pending: 0,
        }),
        reviewActionTable: [
          expect.objectContaining({
            targetType: "evidence_task",
            status: "awaiting_review",
            humanGateAction: "review_linked_evidence_result_first",
            preferredCommand: expect.stringContaining("stock-feedback evidence-result list --status awaiting_review --task-id"),
            alternativeCommands: [
              expect.stringContaining("stock-feedback evidence-task show --task-id"),
            ],
          }),
        ],
      }),
      expect.objectContaining({
        queueId: "hypothesis_evidence_task_review",
        agentId: "EvidencePlanningAgent",
        status: "human_review_required",
        counts: expect.objectContaining({
          total: 1,
          needsStockIdentity: 1,
        }),
        readCommands: expect.arrayContaining([
          "hypothesis evidence-task-draft-list --gate needs_stock_identity --candidate-limit 5",
        ]),
        writeBoundary: expect.objectContaining({
          allowedRoots: [".llm-wiki/stock-feedback/evidence-tasks"],
        }),
      }),
    ]))
    expect(status.agentOrchestration.secondaryQueues).toHaveLength(2)
    expect(status.secondaryQueues.map((queue) => queue.queueId)).toEqual([
      "hypothesis_evidence_task_review",
      "evidence_task_followup",
    ])

    const plan = await buildResearchOsAgentPlan({
      projectPath: tmpRoot,
      generatedAt: "2026-06-21 10:21:00",
    })
    expect(plan).toMatchObject({
      nextAgent: "EvidenceAgent",
      currentStage: "evidence_result_review",
    })
    expect(plan.steps[0]).toMatchObject({
      agentId: "EvidenceAgent",
      fixedAction: "stock-feedback-evidence-result-review",
      status: "blocked_human_input",
      inputRefs: expect.arrayContaining([
        "evidence-results-awaiting-review:1",
        "hard-source-review-ready:1",
      ]),
      readCommands: ["stock-feedback evidence-result list --status awaiting_review --limit 20"],
      writeCommand: expect.stringContaining("stock-feedback evidence-result review --result-id <id>"),
      reviewSamples: [
        expect.objectContaining({
          reviewPlan: expect.objectContaining({
            status: "hard_source_review_ready",
          }),
        }),
      ],
      reviewActionTable: [
        expect.objectContaining({
          targetType: "evidence_result",
          targetId: expect.any(String),
          taskId: expect.any(String),
          reviewStatus: "hard_source_review_ready",
          recommendedAction: "approve_after_manual_source_check",
          humanGateAction: "approve_or_reject_after_manual_source_check",
          preferredCommand: expect.stringContaining("--action approve"),
          officialSourceRefs: expect.arrayContaining([
            "cninfo:announcement#002859.SZ/2025Q4",
          ]),
        }),
      ],
    })
    expect(plan.secondaryQueues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        queueId: "evidence_task_followup",
        agentId: "EvidenceAgent",
        counts: expect.objectContaining({ awaitingReview: 1 }),
      }),
      expect.objectContaining({
        queueId: "hypothesis_evidence_task_review",
        agentId: "EvidencePlanningAgent",
        counts: expect.objectContaining({ total: 1 }),
      }),
    ]))
    expect(plan.secondaryQueues.map((queue) => queue.queueId)).toEqual([
      "hypothesis_evidence_task_review",
      "evidence_task_followup",
    ])
    expect(plan.contextSummary.secondaryQueues.find((queue) => queue.queueId === "hypothesis_evidence_task_review")).toMatchObject({
      queueId: "hypothesis_evidence_task_review",
      stage: "hypothesis_evidence_task_review",
    })

    await buildResearchOsAgentPlan({
      projectPath: tmpRoot,
      generatedAt: "2026-06-21 10:22:00",
      write: true,
    })
    const review = await listResearchOsAgentReviewItems({
      projectPath: tmpRoot,
      generatedAt: "2026-06-21 10:22:30",
    })
    expect(review.secondaryQueueCount).toBe(2)
    expect(review.secondaryQueues.find((queue) => queue.queueId === "hypothesis_evidence_task_review")).toMatchObject({
      queueId: "hypothesis_evidence_task_review",
      agentId: "EvidencePlanningAgent",
      counts: expect.objectContaining({ total: 1 }),
    })
    expect(review.secondaryQueues.find((queue) => queue.queueId === "evidence_task_followup")).toMatchObject({
      queueId: "evidence_task_followup",
      counts: expect.objectContaining({ awaitingReview: 1 }),
    })
    expect(review.secondaryQueues.map((queue) => queue.queueId)).toEqual([
      "hypothesis_evidence_task_review",
      "evidence_task_followup",
    ])
    expect(review.nextHumanGateActions).toEqual([
      expect.objectContaining({
        actionIndex: 1,
        source: "primary_step",
        queueId: "evidence_result_review",
        agentId: "EvidenceAgent",
        fixedAction: "stock-feedback-evidence-result-review",
        targetType: "evidence_result",
        taskId: expect.any(String),
        status: "hard_source_review_ready",
        humanGateAction: "approve_or_reject_after_manual_source_check",
        preferredCommand: expect.stringContaining("--action approve"),
        dryRunCommand: expect.not.stringContaining("--write"),
        shellDryRunCommand: expect.stringContaining("npm --silent run codex:ingest -- stock-feedback evidence-result review"),
        shellDryRunCommandTemplate: expect.stringContaining(`--project '${tmpRoot}'`),
        dryRunCommandPlaceholders: [],
        writeCommand: expect.stringContaining("--write"),
        shellWriteCommand: null,
        shellWriteCommandTemplate: expect.stringContaining("--write"),
        writeCommandPlaceholders: ["name"],
        writeCommandRequiresHumanGate: false,
        alternativeDryRunCommands: [
          expect.not.stringContaining("--write"),
        ],
        alternativeWriteCommands: [
          expect.stringContaining("--write"),
        ],
        dryRunReady: true,
        writeCommandReady: false,
        dryRunInputsRequired: [],
        writeInputsRequired: ["name"],
        manualInputsRequired: ["name"],
        operatorNextStep: "run_dry_run_command",
        requiresExplicitConfirmation: true,
      }),
      expect.objectContaining({
        source: "secondary_queue",
        queueId: "hypothesis_evidence_task_review",
        agentId: "EvidencePlanningAgent",
        targetType: "hypothesis_evidence_task_draft",
        humanGateAction: "provide_explicit_stock_identity",
        preferredCommand: expect.stringContaining("--stock-code <code> --stock-name <name>"),
        dryRunCommand: expect.not.stringContaining("--confirm-human-gate true"),
        shellDryRunCommand: null,
        shellDryRunCommandTemplate: expect.stringContaining("--stock-code <code> --stock-name <name>"),
        dryRunCommandPlaceholders: ["code", "name"],
        writeCommand: expect.stringContaining("--confirm-human-gate true --write"),
        shellWriteCommand: null,
        shellWriteCommandTemplate: expect.stringContaining("--confirm-human-gate true --write"),
        writeCommandPlaceholders: ["code", "name"],
        writeCommandRequiresHumanGate: true,
        dryRunReady: false,
        writeCommandReady: false,
        dryRunInputsRequired: ["code", "name"],
        writeInputsRequired: ["code", "name"],
        manualInputsRequired: ["code", "name"],
        operatorNextStep: "fill_placeholders_before_dry_run",
      }),
      expect.objectContaining({
        source: "secondary_queue",
        queueId: "evidence_task_followup",
        agentId: "EvidenceAgent",
        targetType: "evidence_task",
        status: "awaiting_review",
        humanGateAction: "review_linked_evidence_result_first",
        preferredCommand: expect.stringContaining("stock-feedback evidence-result list --status awaiting_review --task-id"),
        dryRunCommand: expect.stringContaining("stock-feedback evidence-result list --status awaiting_review --task-id"),
        shellDryRunCommand: expect.stringContaining("npm --silent run codex:ingest -- stock-feedback evidence-result list"),
        shellDryRunCommandTemplate: expect.stringContaining(`--project '${tmpRoot}'`),
        dryRunCommandPlaceholders: [],
        writeCommand: null,
        shellWriteCommand: null,
        shellWriteCommandTemplate: null,
        writeCommandPlaceholders: [],
        writeCommandRequiresHumanGate: false,
        dryRunReady: true,
        writeCommandReady: false,
        dryRunInputsRequired: [],
        writeInputsRequired: [],
        manualInputsRequired: [],
        operatorNextStep: "run_dry_run_command",
      }),
    ])
    expect(review.nextHumanGateActionCount).toBe(3)
    expect(review.nextHumanGateActionTotalCount).toBe(3)
    expect(review.nextHumanGateActionFilteredCount).toBe(3)
    expect(review.nextHumanGateActionFilters).toMatchObject({
      queueIds: [],
      sources: [],
      operatorNextSteps: [],
      dryRunReady: null,
      writeCommandReady: null,
      limit: 20,
    })
    expect(review.nextHumanGateActionSummary).toMatchObject({
      total: 3,
      dryRunReady: 2,
      needsManualInputs: 2,
      needsDryRunInputs: 1,
      needsWriteInputs: 2,
      writeCommandReady: 0,
      requiresExplicitConfirmation: 2,
      byOperatorNextStep: {
        run_dry_run_command: 2,
        fill_placeholders_before_dry_run: 1,
      },
    })
    expect(review.nextHumanGateActionFilteredSummary).toMatchObject({
      total: 3,
      dryRunReady: 2,
      needsManualInputs: 2,
      needsDryRunInputs: 1,
      needsWriteInputs: 2,
    })
    expect(review.nextHumanGateActionRunbook).toMatchObject({
      schema: "research-os-agent-review-runbook-v1",
      totalCount: 3,
      filteredCount: 3,
      returnedCount: 3,
      nextOperatorMove: "run_ready_dry_runs_before_any_write",
    })
    expect(review.nextHumanGateActionRunbook.readyDryRunCommands).toHaveLength(2)
    expect(review.nextHumanGateActionRunbook.readyDryRunCommands[0]).toContain("npm --silent run codex:ingest --")
    expect(review.nextHumanGateActionRunbook.needsInputBeforeDryRun).toEqual([
      expect.objectContaining({
        queueId: "hypothesis_evidence_task_review",
        manualInputsRequired: ["code", "name"],
        shellDryRunCommand: null,
        shellDryRunCommandTemplate: expect.stringContaining("--stock-code <code> --stock-name <name>"),
      }),
    ])

    const hypothesisOnlyReview = await listResearchOsAgentReviewItems({
      projectPath: tmpRoot,
      generatedAt: "2026-06-21 10:22:45",
      queueId: "hypothesis_evidence_task_review",
      actionLimit: 1,
    })
    expect(hypothesisOnlyReview.nextHumanGateActionCount).toBe(1)
    expect(hypothesisOnlyReview.nextHumanGateActionFilteredCount).toBe(1)
    expect(hypothesisOnlyReview.nextHumanGateActionTotalCount).toBe(3)
    expect(hypothesisOnlyReview.nextHumanGateActionFilters).toMatchObject({
      queueIds: ["hypothesis_evidence_task_review"],
      sources: [],
      operatorNextSteps: [],
      dryRunReady: null,
      writeCommandReady: null,
      limit: 1,
    })
    expect(hypothesisOnlyReview.nextHumanGateActions).toEqual([
      expect.objectContaining({
        actionIndex: 1,
        source: "secondary_queue",
        queueId: "hypothesis_evidence_task_review",
        targetType: "hypothesis_evidence_task_draft",
        dryRunCommand: expect.not.stringContaining("--write"),
        writeCommand: expect.stringContaining("--write"),
      }),
    ])

    const primaryOnlyReview = await listResearchOsAgentReviewItems({
      projectPath: tmpRoot,
      generatedAt: "2026-06-21 10:22:46",
      source: "primary_step",
    })
    expect(primaryOnlyReview.nextHumanGateActionCount).toBe(1)
    expect(primaryOnlyReview.nextHumanGateActionFilteredCount).toBe(1)
    expect(primaryOnlyReview.nextHumanGateActions[0]).toMatchObject({
      source: "primary_step",
      queueId: "evidence_result_review",
    })

    const needsInputReview = await listResearchOsAgentReviewItems({
      projectPath: tmpRoot,
      generatedAt: "2026-06-21 10:22:47",
      operatorNextStep: "fill_placeholders_before_dry_run",
      dryRunReady: false,
    })
    expect(needsInputReview.nextHumanGateActionCount).toBe(1)
    expect(needsInputReview.nextHumanGateActionFilteredCount).toBe(1)
    expect(needsInputReview.nextHumanGateActionFilters).toMatchObject({
      operatorNextSteps: ["fill_placeholders_before_dry_run"],
      dryRunReady: false,
    })
    expect(needsInputReview.nextHumanGateActionFilteredSummary).toMatchObject({
      total: 1,
      dryRunReady: 0,
      needsManualInputs: 1,
      needsDryRunInputs: 1,
      needsWriteInputs: 1,
      byOperatorNextStep: {
        fill_placeholders_before_dry_run: 1,
      },
    })
    expect(needsInputReview.nextHumanGateActions[0]).toMatchObject({
      queueId: "hypothesis_evidence_task_review",
      dryRunReady: false,
      dryRunInputsRequired: ["code", "name"],
      writeInputsRequired: ["code", "name"],
      manualInputsRequired: ["code", "name"],
    })
    expect(review.items[0]).toMatchObject({
      agentId: "EvidenceAgent",
      fixedAction: "stock-feedback-evidence-result-review",
      inputRefs: expect.arrayContaining([
        "evidence-results-awaiting-review:1",
        "hard-source-review-ready:1",
      ]),
      readCommands: ["stock-feedback evidence-result list --status awaiting_review --limit 20"],
      operatorGuidance: expect.arrayContaining([
        expect.stringContaining("硬源待审"),
      ]),
      reviewSamples: [
        expect.objectContaining({
          resultId: expect.any(String),
          reviewPlan: expect.objectContaining({
            status: "hard_source_review_ready",
          }),
        }),
      ],
      reviewActionTable: [
        expect.objectContaining({
          reviewStatus: "hard_source_review_ready",
          humanGateAction: "approve_or_reject_after_manual_source_check",
          preferredCommand: expect.stringContaining("--action approve"),
        }),
      ],
      expectedArtifacts: [".llm-wiki/stock-feedback/evidence-results/*.jsonl"],
    })

    const verified = await verifyResearchOsAgentArtifacts({ projectPath: tmpRoot })
    expect(verified.status).toBe("ok")
  })

  it("surfaces low-confidence stock candidates before evidence-task draft promotion", async () => {
    await write(
      path.join(tmpRoot, "raw/日复盘/2026-06-20.md"),
      "沪电股份 002463：AI 高速 PCB 订单兑现仍需公告或交易所问询后的硬源确认。\n",
    )
    await createHypothesis({
      projectPath: tmpRoot,
      title: "AI高速PCB订单兑现需要先补硬源",
      theme: "训练飞轮",
      segments: "PCB,订单兑现",
      status: "watching",
      generatedAt: "2026-06-21 10:14:00",
      write: true,
    })
    await draftHypothesisEvidenceTasks({
      projectPath: tmpRoot,
      status: "watching",
      generatedAt: "2026-06-21 10:15:00",
      write: true,
    })

    const status = await buildResearchOsAgentStatus({
      projectPath: tmpRoot,
      generatedAt: "2026-06-21 10:16:00",
    })
    expect(status.counts).toMatchObject({
      hypothesisEvidenceTaskDrafts: 1,
      hypothesisEvidenceTaskDraftLowConfidenceCandidates: 1,
      hypothesisEvidenceTaskDraftNeedsStockIdentity: 0,
    })
    expect(status.agentOrchestration).toMatchObject({
      nextAgent: "EvidencePlanningAgent",
      nextAction: "review_low_confidence_hypothesis_evidence_task_drafts_before_promotion",
      blockedBy: "human_review_required",
    })
    expect(status.hypothesis.evidenceTaskDraftReview.samples[0]).toMatchObject({
      gateStatus: "low_confidence_candidates",
      requiresExtraConfirmation: true,
      topCandidate: {
        code: "002463.SZ",
        name: "沪电股份",
        confidence: "low",
      },
    })

    const plan = await buildResearchOsAgentPlan({
      projectPath: tmpRoot,
      generatedAt: "2026-06-21 10:17:00",
    })
    expect(plan).toMatchObject({
      nextAgent: "EvidencePlanningAgent",
      nextAction: "review_low_confidence_hypothesis_evidence_task_drafts_before_promotion",
    })
    expect(plan.steps[0]).toMatchObject({
      inputRefs: expect.arrayContaining([
        "hypothesis-evidence-task-drafts:1",
        "low-confidence-candidates:1",
      ]),
      operatorGuidance: expect.arrayContaining([
        expect.stringContaining("低置信候选默认不升格"),
      ]),
      reviewSamples: [
        expect.objectContaining({
          gateStatus: "low_confidence_candidates",
          reviewPlan: expect.objectContaining({
            requiresLowConfidenceConfirmation: true,
          }),
          topCandidate: expect.objectContaining({
            code: "002463.SZ",
            confidence: "low",
          }),
        }),
      ],
      reviewActionTable: [
        expect.objectContaining({
          targetType: "hypothesis_evidence_task_draft",
          gateStatus: "low_confidence_candidates",
          humanGateAction: "explicit_stock_identity_preferred",
          requiresLowConfidenceConfirmation: true,
          candidate: expect.objectContaining({
            code: "002463.SZ",
            confidence: "low",
          }),
          preferredCommand: expect.stringContaining("--stock-code <code> --stock-name <name>"),
          alternativeCommands: expect.arrayContaining([
            expect.stringContaining("--confirm-low-confidence-candidate true"),
          ]),
          blockers: expect.arrayContaining(["low_confidence_stock_identity_candidate"]),
        }),
      ],
    })
  })

  it("routes importable broker delivery notes to ExecutionResultAgent before downstream training steps", async () => {
    await write(
      path.join(tmpRoot, "raw/交割单/2026-05-25-交割单.md"),
      `# 2026-05-25 交割单

| 成交时间 | 证券代码 | 证券名称 | 买卖方向 | 成交数量 | 成交价格 |
|---|---|---|---|---:|---:|
| 09:45:00 | 002049 | 紫光国微 | 买入 | 3400 | 82.14 |
| 14:55:00 | 002049 | 紫光国微 | 卖出 | 3400 | 84.46 |
`,
    )

    const status = await buildResearchOsAgentStatus({
      projectPath: tmpRoot,
      generatedAt: "2026-06-21 10:05:00",
    })
    expect(status.counts.executionResults).toBe(0)
    expect(status.stockFeedback.executionResultLedger.counts.importableDeliveryNotes).toBe(1)

    const plan = await buildResearchOsAgentPlan({
      projectPath: tmpRoot,
      generatedAt: "2026-06-21 10:06:00",
    })

    expect(plan).toMatchObject({
      nextAgent: "ExecutionResultAgent",
      currentStage: "real_execution_import",
    })
    expect(plan.steps[0]).toMatchObject({
      agentId: "ExecutionResultAgent",
      fixedAction: "stock-feedback-execution-result-validate",
      writeCommand: "stock-feedback execution-result validate --write",
      writeBoundary: {
        allowedRoots: [".llm-wiki/stock-feedback/execution-results"],
      },
    })
  })

  it("does not keep routing reviewed snapshot or partial-exit execution results back to review", async () => {
    await write(
      path.join(tmpRoot, ".llm-wiki/stock-feedback/execution-results/stock-feedback-execution-results-20260621110000.jsonl"),
      [
        {
          schema: "research-os-execution-result-v1",
          artifactId: "execres_snapshot_002348_fixture",
          generatedAt: "2026-06-21 11:00:00",
          asOfDate: "2026-05-26",
          ledgerKind: "broker_snapshot",
          recordStatus: "reviewed",
          pnlScope: "holding_snapshot",
          positionState: "open",
          instrument: { stockCode: "002348", tsCode: "002348.SZ", stockName: "高乐股份", assetClass: "a_share" },
          pnl: { currency: "CNY", floatingPnlAbs: -1200, pnlQuality: "needs_review" },
          evidence: {
            sourceRefs: [
              { kind: "wiki_position_tracking", ref: "wiki/position-tracking.md", role: "position_snapshot", reliability: "medium", valueQuality: "needs_review" },
            ],
          },
          qualityGate: {
            status: "needs_reconciliation",
            humanReviewRequired: true,
            blockers: ["holding_snapshot_not_realized_pnl"],
            passedRules: ["holding_snapshot_classified"],
            trainingWeight: "none",
          },
          trainingBoundary: { loraFactPolicy: "no_raw_facts", allowedDestinations: ["none"], adapterCandidateWeight: "none" },
        },
        {
          schema: "research-os-execution-result-v1",
          artifactId: "execres_real_000564_partial_fixture",
          generatedAt: "2026-06-21 11:00:01",
          asOfDate: "2026-05-26",
          ledgerKind: "real_trade",
          recordStatus: "reviewed",
          pnlScope: "partial_exit",
          positionState: "partial_exit",
          instrument: { stockCode: "000564", tsCode: "000564.SZ", stockName: "供销大集", assetClass: "a_share" },
          pnl: { currency: "CNY", realizedGrossPnlAbs: 1000, realizedPnlPct: 3.1, pnlQuality: "derived" },
          evidence: {
            sourceRefs: [
              { kind: "raw_delivery_note", ref: "raw/交割单/2026-05-26-交割单.md", role: "exit_fill", reliability: "high", valueQuality: "exact" },
            ],
          },
          qualityGate: {
            status: "needs_reconciliation",
            humanReviewRequired: true,
            blockers: ["partial_exit_lifecycle_not_closed"],
            passedRules: ["broker_delivery_note_present"],
            trainingWeight: "low",
          },
          trainingBoundary: { loraFactPolicy: "no_raw_facts", allowedDestinations: ["eval"], adapterCandidateWeight: "low" },
        },
      ].map((record) => JSON.stringify(record)).join("\n") + "\n",
    )

    const status = await buildResearchOsAgentStatus({
      projectPath: tmpRoot,
      generatedAt: "2026-06-21 11:01:00",
    })
    expect(status.counts.executionResultsNeedsReconciliation).toBe(2)
    expect(status.counts.executionResultsActionableReviews).toBe(0)
    expect(status.stockFeedback.executionResultLedger.reconciliationAudit).toMatchObject({
      status: "reviewed_non_actionable",
      counts: {
        total: 2,
        actionableReviews: 0,
        reviewedNonActionable: 2,
      },
    })
    expect(status.secondaryQueues).toEqual([
      expect.objectContaining({
        queueId: "execution_result_reconciliation",
        agentId: "ExecutionResultAgent",
        status: "reviewed_non_actionable",
        priority: "low",
        counts: expect.objectContaining({
          total: 2,
          actionableReviews: 0,
          reviewedNonActionable: 2,
          reviewedPartialExit: 1,
          reviewedHoldingSnapshot: 1,
        }),
        readCommands: ["stock-feedback execution-result list --status needs_reconciliation --limit 20"],
        operatorGuidance: expect.arrayContaining([
          expect.stringContaining("partial_exit"),
          expect.stringContaining("holding_snapshot"),
        ]),
      }),
    ])

    const plan = await buildResearchOsAgentPlan({
      projectPath: tmpRoot,
      generatedAt: "2026-06-21 11:02:00",
    })
    expect(plan.currentStage).not.toBe("real_execution_review")
    expect(plan.nextAgent).not.toBe("ExecutionResultAgent")
    expect(plan.secondaryQueues[0]).toMatchObject({
      queueId: "execution_result_reconciliation",
      priority: "low",
      counts: expect.objectContaining({ total: 2 }),
    })
  })

  it("routes open paper trades to SettlementAgent and settled trades to AttributionAgent/BenchmarkAgent", async () => {
    const opened = await recordStockFeedbackPaperTrade({
      projectPath: tmpRoot,
      track: "rule_baseline",
      asOfDate: "2026-06-03",
      sourceQuestionId: "question_research_os_001",
      validationTarget: "expectation_trade",
      stockName: "样本科技A",
      stockCode: "SZ300901",
      hypothesis: "低位吸收后观察承接，按规则模拟买入。",
      expectedMove: "3 日内相对强度扩散。",
      entryDate: "2026-06-03",
      entryPrice: "10.00",
      entryTiming: "放量转强首日试错",
      positionSizing: "probe_15pct",
      sourceRefs: "self-question:question_research_os_001,retrieval:sourceRefs#agent",
      evidenceRefs: "price-sql:SZ300901:entry-2026-06-03,tool-state:self-question-attribution",
      generatedAt: "2026-06-21 10:20:00",
      write: true,
    })

    const openPlan = await buildResearchOsAgentPlan({
      projectPath: tmpRoot,
      generatedAt: "2026-06-21 10:21:00",
    })
    expect(openPlan).toMatchObject({
      nextAgent: "SettlementAgent",
      currentStage: "paper_trade_settlement",
    })
    expect(openPlan.steps[0].inputRefs).toContain(`paper-trade:${opened.paperTrade.id}`)

    await settleStockFeedbackPaperTrade({
      projectPath: tmpRoot,
      paperTradeId: opened.paperTrade.id,
      exitDate: "2026-06-06",
      exitPrice: "10.80",
      maxDrawdownPct: "1.2",
      holdingDays: "3",
      exitTiming: "3 日承接兑现后分批止盈",
      exitReason: "规则目标达到，避免后手拥挤",
      evidenceRefs: "price-sql:SZ300901:exit-2026-06-06,trade-ledger:paper-settlement",
      generatedAt: "2026-06-21 10:22:00",
      write: true,
    })

    const settledPlan = await buildResearchOsAgentPlan({
      projectPath: tmpRoot,
      generatedAt: "2026-06-21 10:23:00",
    })
    expect(settledPlan.nextAgent).toMatch(/AttributionAgent|BenchmarkAgent/)
    expect(settledPlan.steps.map((step) => step.agentId)).toEqual(expect.arrayContaining([
      "AttributionAgent",
      "BenchmarkAgent",
    ]))
  })

  it("blocks write steps without explicit HumanGate confirmation and verifies written agent artifacts", async () => {
    const plan = await buildResearchOsAgentPlan({
      projectPath: tmpRoot,
      generatedAt: "2026-06-21 10:30:00",
      write: true,
    })

    await expect(runResearchOsAgentStep({
      projectPath: tmpRoot,
      stepId: plan.steps[0].stepId,
      generatedAt: "2026-06-21 10:31:00",
      write: true,
    })).rejects.toThrow(/HumanGate/)

    const preview = await runResearchOsAgentStep({
      projectPath: tmpRoot,
      stepId: plan.steps[0].stepId,
      generatedAt: "2026-06-21 10:32:00",
    })
    expect(preview).toMatchObject({
      schema: "research-os-agent-step-result-v1",
      dryRun: true,
      humanGateStatus: "pending_human_gate",
      writeResult: null,
    })

    const verify = await verifyResearchOsAgentArtifacts({ projectPath: tmpRoot })
    expect(verify).toMatchObject({
      schema: "research-os-agent-verify-result-v1",
      status: "ok",
      errorCount: 0,
    })
    expect(verify.checked.plans).toBe(1)
  })

  it("lists HumanGate review items from the latest persisted plan", async () => {
    const plan = await buildResearchOsAgentPlan({
      projectPath: tmpRoot,
      generatedAt: "2026-06-21 10:35:00",
      write: true,
    })

    const review = await listResearchOsAgentReviewItems({
      projectPath: tmpRoot,
      generatedAt: "2026-06-21 10:36:00",
    })

    expect(review).toMatchObject({
      schema: "research-os-agent-review-list-v1",
      count: 1,
      secondaryQueueCount: 0,
      secondaryQueues: [],
      items: [
        expect.objectContaining({
          stepId: plan.steps[0].stepId,
          agentId: "HypothesisAgent",
          humanGateStatus: "pending_human_gate",
        }),
      ],
    })

    await runResearchOsAgentStep({
      projectPath: tmpRoot,
      stepId: plan.steps[0].stepId,
      generatedAt: "2026-06-21 10:37:00",
      write: true,
      humanGateConfirmed: true,
    })

    const clearedReview = await listResearchOsAgentReviewItems({
      projectPath: tmpRoot,
      generatedAt: "2026-06-21 10:38:00",
    })
    expect(clearedReview).toMatchObject({
      schema: "research-os-agent-review-list-v1",
      count: 0,
      items: [],
    })
  })

  it("exposes research-os agent status through the CLI", async () => {
    const { stdout } = await execFileAsync(process.execPath, [
      "scripts/codex-ingest.mjs",
      "research-os",
      "agent",
      "status",
      "--project",
      tmpRoot,
      "--generated-at",
      "2026-06-21 10:40:00",
    ], {
      cwd: process.cwd(),
      timeout: 30000,
      maxBuffer: 1024 * 1024 * 8,
    })
    const parsed = JSON.parse(stdout)
    expect(parsed).toMatchObject({
      schema: "research-os-agent-context-v1",
      mode: "research-os-agent-status",
      projectPath: tmpRoot,
      agentRuntime: {
        supervisor: "Codex chat window",
        llmInAppRuntime: false,
      },
    })
  })

  it("rejects CLI step writes when HumanGate confirmation is explicitly false", async () => {
    const { stdout } = await execFileAsync(process.execPath, [
      "scripts/codex-ingest.mjs",
      "research-os",
      "agent",
      "plan",
      "--project",
      tmpRoot,
      "--generated-at",
      "2026-06-21 10:45:00",
      "--write",
    ], {
      cwd: process.cwd(),
      timeout: 30000,
      maxBuffer: 1024 * 1024 * 8,
    })
    const plan = JSON.parse(stdout)

    await expect(execFileAsync(process.execPath, [
      "scripts/codex-ingest.mjs",
      "research-os",
      "agent",
      "step",
      "--project",
      tmpRoot,
      "--step-id",
      plan.steps[0].stepId,
      "--generated-at",
      "2026-06-21 10:46:00",
      "--write",
      "--confirm-human-gate",
      "false",
    ], {
      cwd: process.cwd(),
      timeout: 30000,
      maxBuffer: 1024 * 1024 * 8,
    })).rejects.toMatchObject({
      stderr: expect.stringContaining("HumanGate confirmation required"),
    })
  })
})
