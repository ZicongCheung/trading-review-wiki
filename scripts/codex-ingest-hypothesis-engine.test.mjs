import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  buildHypothesisEvidenceFeedback,
  createHypothesis,
  createStockFeedbackEvidenceTask,
  draftHypothesisEvidenceLinks,
  draftHypothesisEvidenceTasks,
  draftHypothesisPostMortems,
  listHypothesisEvidenceTaskDrafts,
  listHypotheses,
  reviewHypothesisEvidenceLinkDraft,
  reviewHypothesisEvidenceTaskDraft,
  runStockFeedbackEvidenceTaskQueue,
  updateHypothesisStatus,
  verifyHypothesisEngineArtifacts,
} from "./codex-ingest-lib.mjs"

let tmpRoot

async function readJsonl(filePath) {
  const raw = await fs.readFile(filePath, "utf8")
  return raw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
}

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "hypothesis-engine-"))
})

afterEach(async () => {
  if (tmpRoot) await fs.rm(tmpRoot, { recursive: true, force: true })
})

describe("hypothesis engine evidence feedback", () => {
  it("drafts evidence-task handoff artifacts for weak hypotheses without creating formal tasks", async () => {
    const created = await createHypothesis({
      projectPath: tmpRoot,
      title: "AI高速PCB主链订单可能进入兑现验证期",
      theme: "训练飞轮",
      segments: "PCB,订单兑现",
      status: "watching",
      generatedAt: "2026-06-21 08:00:00",
      write: true,
    })
    await fs.mkdir(path.join(tmpRoot, "raw", "日复盘"), { recursive: true })
    await fs.writeFile(
      path.join(tmpRoot, "raw", "日复盘", "2026-06-21-复盘.md"),
      "沪电股份（002463）AI高速PCB订单与客户验证需要用公告和后续承接确认。\n",
      "utf8",
    )
    await fs.mkdir(path.join(tmpRoot, "raw", "交割单"), { recursive: true })
    await fs.writeFile(
      path.join(tmpRoot, "raw", "交割单", "2026-06-21-交割单.md"),
      "| 名称 | 代码 | 备注 |\n| 达安基因 | 002030 | AI 主题历史成交 |\n",
      "utf8",
    )

    const preview = await draftHypothesisEvidenceTasks({
      projectPath: tmpRoot,
      id: created.hypothesis.id,
      generatedAt: "2026-06-21 08:05:00",
    })
    expect(preview).toMatchObject({
      schema: "trading-hypothesis-evidence-task-draft-run-v1",
      dryRun: true,
      count: 1,
      writeResult: null,
    })
    expect(preview.drafts[0]).toMatchObject({
      schema: "trading-hypothesis-evidence-task-draft-v1",
      hypothesisId: created.hypothesis.id,
      suggestedStockFeedbackEvidenceTask: {
        source: "hypothesis",
        sourceId: created.hypothesis.id,
        stockCode: null,
        taskType: "announcement",
        preferredSources: expect.arrayContaining(["cninfo"]),
        targetFields: expect.arrayContaining(["order", "customer", "shipment", "revenue", "annual_report", "announcement"]),
      },
      readiness: {
        status: "blocked_missing_required_fields",
        writeReady: false,
        requiresHumanGate: true,
        missingBeforeWrite: expect.arrayContaining(["stockIdentity"]),
      },
      writePolicy: {
        wroteStockFeedbackEvidenceTask: false,
        wroteWiki: false,
        wroteRaw: false,
      },
    })
    expect(preview.drafts[0].suggestedCommand).toContain("stock-feedback")
    expect(preview.drafts[0].suggestedCommand).toContain("--source-id")
    await expect(fs.access(path.join(tmpRoot, ".llm-wiki", "hypothesis-evidence-task-drafts"))).rejects.toThrow()

    const written = await draftHypothesisEvidenceTasks({
      projectPath: tmpRoot,
      id: created.hypothesis.id,
      generatedAt: "2026-06-21 08:06:00",
      write: true,
    })
    expect(written.writeResult.drafts.relativePath).toMatch(/^\.llm-wiki\/hypothesis-evidence-task-drafts\//)
    const records = await readJsonl(written.writeResult.drafts.path)
    expect(records[0]).toMatchObject({
      hypothesisId: created.hypothesis.id,
      writePolicy: {
        wroteArtifacts: true,
        wroteStockFeedbackEvidenceTask: false,
      },
    })

    const verified = await verifyHypothesisEngineArtifacts({ projectPath: tmpRoot })
    expect(verified.status).toBe("ok")
    expect(verified.checked).toMatchObject({
      evidenceTaskDrafts: 1,
      evidenceTaskDraftManifests: 1,
    })

    const listed = await listHypothesisEvidenceTaskDrafts({
      projectPath: tmpRoot,
      limit: 5,
    })
    expect(listed).toMatchObject({
      schema: "trading-hypothesis-evidence-task-draft-list-v1",
      count: 1,
      writePolicy: {
        readOnly: true,
        wroteStockFeedbackEvidenceTask: false,
      },
    })
    expect(listed.drafts[0]).toMatchObject({
      id: records[0].id,
      hypothesisId: created.hypothesis.id,
      taskType: "announcement",
      readiness: {
        status: "blocked_missing_required_fields",
      },
    })
    expect(listed.drafts[0].stockIdentityCandidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "002463.SZ",
        name: "沪电股份",
        confidence: expect.stringMatching(/high|medium|low/),
        matchedTokens: expect.arrayContaining(["AI", "PCB", "订单"]),
      }),
    ]))
    expect(listed.drafts[0].stockIdentityCandidates.map((item) => item.code)).not.toContain("002030.SZ")
    expect(listed.drafts[0].stockIdentityCandidateGate).toMatchObject({
      status: "low_confidence_candidates",
      requiresExtraConfirmation: true,
      confirmationFlag: "--confirm-low-confidence-candidate true",
    })
    expect(listed.drafts[0].reviewPlan).toMatchObject({
      status: "low_confidence_candidates",
      riskLevel: "high",
      recommendedAction: "manual_confirm_candidate_or_provide_explicit_stock_identity",
      requiresHumanGate: true,
      requiresLowConfidenceConfirmation: true,
      dryRunCommand: expect.stringContaining(`hypothesis evidence-task-draft-review --draft-id ${records[0].id} --candidate-index`),
      writeCommand: expect.stringContaining("--confirm-low-confidence-candidate true --write"),
      saferAlternativeCommand: expect.stringContaining("--stock-code <code> --stock-name <name>"),
      blockers: ["low_confidence_stock_identity_candidate"],
    })
    const lowConfidenceListed = await listHypothesisEvidenceTaskDrafts({
      projectPath: tmpRoot,
      gate: "low_confidence",
      limit: 5,
    })
    expect(lowConfidenceListed).toMatchObject({
      count: 1,
      filters: {
        stockIdentityGate: "low_confidence_candidates",
      },
    })
    const needsIdentityListed = await listHypothesisEvidenceTaskDrafts({
      projectPath: tmpRoot,
      gate: "needs_stock_identity",
      limit: 5,
    })
    expect(needsIdentityListed.count).toBe(0)
    const candidateIndex = listed.drafts[0].stockIdentityCandidates.findIndex((item) => item.code === "002463.SZ") + 1
    expect(candidateIndex).toBeGreaterThan(0)

    const reviewPreview = await reviewHypothesisEvidenceTaskDraft({
      projectPath: tmpRoot,
      id: records[0].id,
      candidateIndex,
      generatedAt: "2026-06-21 08:07:00",
    })
    expect(reviewPreview).toMatchObject({
      schema: "trading-hypothesis-evidence-task-draft-review-v1",
      dryRun: true,
      action: "promote_to_evidence_task",
      humanGate: {
        required: true,
        confirmed: false,
        status: "pending_human_gate",
      },
      selectedStockIdentityCandidateGate: {
        status: "low_confidence_candidates",
        requiresExtraConfirmation: true,
      },
      stockFeedbackEvidenceTask: {
        schema: "stock-feedback-evidence-task-v1",
        source: "hypothesis",
        sourceId: created.hypothesis.id,
        stockCode: "002463.SZ",
        stockName: "沪电股份",
        taskType: "announcement",
      },
      writePolicy: {
        wroteStockFeedbackEvidenceTask: false,
      },
    })
    await expect(fs.access(path.join(tmpRoot, ".llm-wiki", "stock-feedback", "evidence-tasks"))).rejects.toThrow()
    await expect(reviewHypothesisEvidenceTaskDraft({
      projectPath: tmpRoot,
      id: records[0].id,
      candidateIndex,
      write: true,
    })).rejects.toThrow(/confirm-human-gate/)
    await expect(reviewHypothesisEvidenceTaskDraft({
      projectPath: tmpRoot,
      id: records[0].id,
      candidateIndex,
      confirmHumanGate: true,
      write: true,
    })).rejects.toThrow(/low-confidence/)

    const reviewWritten = await reviewHypothesisEvidenceTaskDraft({
      projectPath: tmpRoot,
      id: records[0].id,
      candidateIndex,
      generatedAt: "2026-06-21 08:08:00",
      confirmHumanGate: true,
      confirmLowConfidenceCandidate: true,
      write: true,
    })
    expect(reviewWritten).toMatchObject({
      dryRun: false,
      humanGate: {
        confirmed: true,
        status: "confirmed",
      },
      writePolicy: {
        wroteStockFeedbackEvidenceTask: true,
      },
      stockFeedbackEvidenceTaskResult: {
        writeResult: {
          task: {
            relativePath: expect.stringMatching(/^\.llm-wiki\/stock-feedback\/evidence-tasks\//),
          },
        },
      },
    })
  })

  it("routes EvidenceResult into hypothesis lifecycle recommendations without changing status", async () => {
    const created = await createHypothesis({
      projectPath: tmpRoot,
      title: "样本科技短期预期交易可能扩散",
      theme: "训练飞轮",
      segments: "样本科技,预期交易",
      keyVariables: "相对强度,成交额承接",
      risks: "close < 20,包含:砍单",
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

    const preview = await buildHypothesisEvidenceFeedback({
      projectPath: tmpRoot,
      id: created.hypothesis.id,
      generatedAt: "2026-06-21 09:10:00",
    })
    expect(preview).toMatchObject({
      schema: "trading-hypothesis-evidence-feedback-run-v1",
      dryRun: true,
      count: 1,
      writeResult: null,
    })
    expect(preview.items[0]).toMatchObject({
      schema: "trading-hypothesis-evidence-feedback-v1",
      hypothesisId: created.hypothesis.id,
      evidenceDirectionCounts: { strengthening: 1 },
      watchtowerCandidate: {
        recommendationOnly: true,
        suggestedStatus: "disconfirmed",
        action: "recommend_disconfirm",
      },
      humanGate: {
        recommendedAction: "confirm_status_update",
        targetStatus: "disconfirmed",
      },
      sourceRefs: expect.arrayContaining(["tushare:daily#300901.SZ/20260620"]),
      evidenceRefs: expect.arrayContaining(["tushare:daily#300901.SZ/20260620"]),
      stocks: [
        {
          code: "300901.SZ",
          name: "样本科技",
        },
      ],
      readiness: {
        status: "paper_trade_candidate_ready",
        canSeedTrajectory: true,
        canSeedPaperTrade: true,
        missing: [],
      },
      peftBoundary: { storesRawFacts: false },
    })
    expect(preview.items[0].falsifiableTriggerDetections).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "numeric",
        field: "close",
        triggered: true,
      }),
    ]))
    expect(preview.items[0].trainingFlywheelRoutes.map((item) => item.route)).toEqual(expect.arrayContaining([
      "confirmed_evidence_to_trajectory",
      "negative_eval",
    ]))
    expect((await listHypotheses({ projectPath: tmpRoot, status: "watching" })).count).toBe(1)
    await expect(fs.access(path.join(tmpRoot, ".llm-wiki", "hypothesis-evidence-feedback"))).rejects.toThrow()

    const written = await buildHypothesisEvidenceFeedback({
      projectPath: tmpRoot,
      id: created.hypothesis.id,
      generatedAt: "2026-06-21 09:11:00",
      write: true,
    })
    expect(written.writeResult.feedback.relativePath).toMatch(/^\.llm-wiki\/hypothesis-evidence-feedback\//)
    expect((await readJsonl(written.writeResult.feedback.path))[0]).toMatchObject({
      hypothesisId: created.hypothesis.id,
      writePolicy: {
        wroteHypothesisStatus: false,
        wroteWiki: false,
        wroteRaw: false,
      },
    })

    const verified = await verifyHypothesisEngineArtifacts({ projectPath: tmpRoot })
    expect(verified.status).toBe("ok")
    expect(verified.checked).toMatchObject({
      evidenceFeedback: 1,
      evidenceFeedbackManifests: 1,
    })
  })

  it("routes stock-feedback EvidenceResult through an explicitly referenced trajectory", async () => {
    const trajectoryId = "stockfb_hypothesis_bridge_001"
    const created = await createHypothesis({
      projectPath: tmpRoot,
      title: "佰维存储存储订单兑现进入基本面验证期",
      theme: "训练飞轮",
      segments: "存储,AI数据基础设施",
      keyVariables: "订单,客户,交付,收入",
      risks: "包含:砍单",
      evidenceRefs: `stock-feedback-trajectory:${trajectoryId},wiki/股票/佰维存储.md`,
      status: "watching",
      generatedAt: "2026-06-21 10:00:00",
      write: true,
    })
    await fs.mkdir(path.join(tmpRoot, ".llm-wiki", "stock-feedback", "trajectories"), { recursive: true })
    await fs.writeFile(
      path.join(tmpRoot, ".llm-wiki", "stock-feedback", "trajectories", "bridge-trajectory.jsonl"),
      `${JSON.stringify({
        schema: "stock-feedback-trajectory-v1",
        id: trajectoryId,
        generatedAt: "2026-06-21 10:02:00",
        source: "self-question-attribution",
        sourceRecordId: "selfqa_bridge_001",
        validationTarget: "fundamental_closure",
        hypothesis: "存储/AI数据基础设施可能存在预期差，需要用订单、公告、客户与收入验证。",
        stock: { code: "SH688525", name: "佰维存储", label: "佰维存储 SH688525" },
        sourceRefs: ["wiki/股票/佰维存储.md"],
        evidenceState: {
          confirmedEvidenceRefs: ["wiki/股票/佰维存储.md"],
        },
      })}\n`,
      "utf8",
    )
    const task = await createStockFeedbackEvidenceTask({
      projectPath: tmpRoot,
      stockCode: "688525.SH",
      stockName: "佰维存储",
      taskType: "announcement",
      targetFields: "annual_report,announcement,order,customer,revenue",
      preferredSources: "cninfo,web",
      source: "stock_feedback",
      sourceId: trajectoryId,
      sourceRefs: `stock-feedback-trajectory:${trajectoryId},wiki/股票/佰维存储.md`,
      generatedAt: "2026-06-21 10:05:00",
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
            sourceQuality: 96,
            structuredData: { announcement: "公告订单验证", customer: "企业级SSD客户确认" },
            sourceRefs: ["cninfo:announcement#688525/1225020228"],
          },
        ],
      },
      generatedAt: "2026-06-21 10:06:00",
      write: true,
    })

    const preview = await buildHypothesisEvidenceFeedback({
      projectPath: tmpRoot,
      id: created.hypothesis.id,
      generatedAt: "2026-06-21 10:10:00",
    })

    expect(preview.manifest.evidenceResultCount).toBe(1)
    expect(preview.manifest.evidenceLinkageCounts).toMatchObject({
      stock_feedback_trajectory_ref: 1,
    })
    expect(preview.manifest.evidenceInputDiagnostics).toMatchObject({
      stockFeedbackEvidenceResults: 1,
      linkedStockFeedbackEvidenceResults: 1,
      unlinkedStockFeedbackEvidenceResults: 0,
    })
    expect(preview.items[0]).toMatchObject({
      hypothesisId: created.hypothesis.id,
      evidenceDirectionCounts: { strengthening: 1 },
      sourceRefs: expect.arrayContaining(["cninfo:announcement#688525/1225020228"]),
      evidenceRefs: expect.arrayContaining(["cninfo:announcement#688525/1225020228"]),
      stocks: [
        {
          code: "688525.SH",
          name: "佰维存储",
        },
      ],
      readiness: {
        status: "paper_trade_candidate_ready",
        canSeedTrajectory: true,
        canSeedPaperTrade: true,
      },
    })
    expect(preview.items[0].evidenceList[0]).toMatchObject({
      evidenceResultId: expect.any(String),
      taskId: task.task.taskId,
      sourceKind: "stock_feedback",
      sourceTrajectoryId: trajectoryId,
      linkage: {
        kind: "stock_feedback_trajectory_ref",
        confidence: "explicit",
      },
    })
  })

  it("uses HumanGate evidence-link drafts before routing stock-feedback EvidenceResult into hypothesis feedback", async () => {
    const trajectoryId = "stockfb_hypothesis_link_gate_001"
    const created = await createHypothesis({
      projectPath: tmpRoot,
      title: "佰维存储订单兑现进入基本面验证期",
      theme: "训练飞轮",
      segments: "存储,AI数据基础设施",
      keyVariables: "订单,客户,交付,收入",
      risks: "包含:砍单",
      evidenceRefs: "wiki/股票/佰维存储.md",
      status: "watching",
      generatedAt: "2026-06-21 10:20:00",
      write: true,
    })
    await fs.mkdir(path.join(tmpRoot, ".llm-wiki", "stock-feedback", "trajectories"), { recursive: true })
    await fs.writeFile(
      path.join(tmpRoot, ".llm-wiki", "stock-feedback", "trajectories", "link-gate-trajectory.jsonl"),
      `${JSON.stringify({
        schema: "stock-feedback-trajectory-v1",
        id: trajectoryId,
        generatedAt: "2026-06-21 10:21:00",
        source: "self-question-attribution",
        sourceRecordId: "selfqa_link_gate_001",
        validationTarget: "fundamental_closure",
        hypothesis: "佰维存储的企业级SSD客户、订单和收入确认需要公告硬源验证。",
        stock: { code: "SH688525", name: "佰维存储", label: "佰维存储 SH688525" },
        sourceRefs: ["wiki/股票/佰维存储.md"],
        evidenceState: { confirmedEvidenceRefs: ["wiki/股票/佰维存储.md"] },
      })}\n`,
      "utf8",
    )
    const task = await createStockFeedbackEvidenceTask({
      projectPath: tmpRoot,
      stockCode: "688525.SH",
      stockName: "佰维存储",
      taskType: "announcement",
      targetFields: "annual_report,announcement,order,customer,revenue",
      preferredSources: "cninfo,web",
      source: "stock_feedback",
      sourceId: trajectoryId,
      sourceRefs: "wiki/股票/佰维存储.md",
      generatedAt: "2026-06-21 10:22:00",
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
            sourceQuality: 96,
            structuredData: { announcement: "公告订单验证", customer: "企业级SSD客户确认" },
            sourceRefs: ["cninfo:announcement#688525/1225020228"],
          },
        ],
      },
      generatedAt: "2026-06-21 10:23:00",
      write: true,
    })

    const beforeLink = await buildHypothesisEvidenceFeedback({
      projectPath: tmpRoot,
      id: created.hypothesis.id,
      generatedAt: "2026-06-21 10:24:00",
    })
    expect(beforeLink.manifest.evidenceResultCount).toBe(0)

    const drafts = await draftHypothesisEvidenceLinks({
      projectPath: tmpRoot,
      status: "watching",
      generatedAt: "2026-06-21 10:25:00",
    })
    expect(drafts).toMatchObject({
      schema: "trading-hypothesis-evidence-link-draft-run-v1",
      dryRun: true,
      count: 1,
      writeResult: null,
    })
    expect(drafts.drafts[0]).toMatchObject({
      evidenceResultId: expect.any(String),
      taskId: task.task.taskId,
      sourceTrajectoryId: trajectoryId,
      humanGate: {
        required: true,
        recommendedAction: "review_candidate_before_link",
      },
      candidates: [
        expect.objectContaining({
          hypothesisId: created.hypothesis.id,
          confidence: "high",
        }),
      ],
      writePolicy: {
        wroteHypothesisEvidenceLink: false,
        wroteHypothesisStatus: false,
        wroteWiki: false,
        wroteRaw: false,
      },
    })
    await expect(fs.access(path.join(tmpRoot, ".llm-wiki", "hypothesis-evidence-links"))).rejects.toThrow()

    const preview = await reviewHypothesisEvidenceLinkDraft({
      projectPath: tmpRoot,
      draftId: drafts.drafts[0].id,
      candidateIndex: 1,
      generatedAt: "2026-06-21 10:25:30",
    })
    expect(preview).toMatchObject({
      dryRun: true,
      sourceIntegrity: {
        status: "hard_source_present",
        sourceProfile: "native_official_disclosure",
        recommendedEvidenceAction: "review_official_disclosure_before_link",
        officialSourceRefs: ["cninfo:announcement#688525/1225020228"],
        nativeOfficialSourceRefs: ["cninfo:announcement#688525/1225020228"],
      },
      link: {
        sourceIntegrity: {
          status: "hard_source_present",
          sourceProfile: "native_official_disclosure",
        },
      },
      writePolicy: {
        wroteHypothesisEvidenceLink: false,
        wroteArtifacts: false,
      },
    })

    const approved = await reviewHypothesisEvidenceLinkDraft({
      projectPath: tmpRoot,
      draftId: drafts.drafts[0].id,
      candidateIndex: 1,
      reviewer: "codex-test",
      note: "explicitly map stock-feedback evidence result to hypothesis after human review",
      confirmHumanGate: true,
      generatedAt: "2026-06-21 10:26:00",
      write: true,
    })
    expect(approved).toMatchObject({
      schema: "trading-hypothesis-evidence-link-review-v1",
      dryRun: false,
      humanGate: {
        confirmed: true,
        status: "confirmed",
      },
      link: {
        schema: "trading-hypothesis-evidence-link-v1",
        hypothesisId: created.hypothesis.id,
        evidenceResultId: drafts.drafts[0].evidenceResultId,
        sourceTrajectoryId: trajectoryId,
        sourceIntegrity: {
          status: "hard_source_present",
          sourceProfile: "native_official_disclosure",
          nativeOfficialSourceRefs: ["cninfo:announcement#688525/1225020228"],
        },
      },
      writePolicy: {
        wroteHypothesisEvidenceLink: true,
        wroteHypothesisStatus: false,
        wroteWiki: false,
        wroteRaw: false,
      },
    })

    const afterLink = await buildHypothesisEvidenceFeedback({
      projectPath: tmpRoot,
      id: created.hypothesis.id,
      generatedAt: "2026-06-21 10:27:00",
    })
    expect(afterLink.manifest.evidenceResultCount).toBe(1)
    expect(afterLink.items[0].evidenceList[0]).toMatchObject({
      evidenceResultId: drafts.drafts[0].evidenceResultId,
      sourceKind: "stock_feedback",
      sourceTrajectoryId: trajectoryId,
      linkage: {
        kind: "human_approved_evidence_link",
        confidence: "human_confirmed",
      },
    })

    const verified = await verifyHypothesisEngineArtifacts({ projectPath: tmpRoot })
    expect(verified.status).toBe("ok")
    expect(verified.checked).toMatchObject({
      evidenceLinkDrafts: 0,
      evidenceLinks: 1,
      evidenceLinkManifests: 1,
    })
  })

  it("drafts post-mortems only for terminal hypothesis states", async () => {
    const created = await createHypothesis({
      projectPath: tmpRoot,
      title: "方向正确但后手赔率压缩",
      theme: "训练飞轮",
      segments: "priced-in",
      keyVariables: "扩散,换手",
      risks: "后续承接不足",
      evidenceRefs: "wiki/priced-in.md",
      marketRefs: "stock_daily_sql:priced-in",
      status: "watching",
      generatedAt: "2026-06-21 09:20:00",
      write: true,
    })
    await updateHypothesisStatus({
      projectPath: tmpRoot,
      id: created.hypothesis.id,
      status: "priced_in",
      reason: "市场先炒预期，后手赔率压缩",
      generatedAt: "2026-06-21 09:25:00",
      write: true,
    })

    const preview = await draftHypothesisPostMortems({
      projectPath: tmpRoot,
      id: created.hypothesis.id,
      generatedAt: "2026-06-21 09:30:00",
    })
    expect(preview).toMatchObject({
      schema: "trading-hypothesis-post-mortem-draft-run-v1",
      dryRun: true,
      count: 1,
    })
    expect(preview.drafts[0]).toMatchObject({
      schema: "trading-hypothesis-post-mortem-draft-v1",
      hypothesisId: created.hypothesis.id,
      terminalStatus: "priced_in",
      peftBoundary: { storesRawFacts: false },
    })

    const written = await draftHypothesisPostMortems({
      projectPath: tmpRoot,
      id: created.hypothesis.id,
      generatedAt: "2026-06-21 09:31:00",
      write: true,
    })
    expect(written.writeResult.postMortems.relativePath).toMatch(/^\.llm-wiki\/hypothesis-post-mortems\//)
    const verified = await verifyHypothesisEngineArtifacts({ projectPath: tmpRoot })
    expect(verified.status).toBe("ok")
    expect(verified.checked.postMortems).toBe(1)
  })
})
