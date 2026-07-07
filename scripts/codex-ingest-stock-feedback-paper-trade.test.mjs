import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  buildHypothesisEvidenceFeedback,
  buildStockFeedbackBenchmark,
  buildStockFeedbackPaperTradeAgentCandidates,
  buildStockFeedbackTrajectories,
  createHypothesis,
  createStockFeedbackEvidenceTask,
  getStockFeedbackPaperTradeStatus,
  getStockFeedbackStatus,
  listStockFeedbackReviewQueue,
  readStockFeedbackTrainingSamples,
  exportStockFeedbackLoraReady,
  recordStockFeedbackPaperTrade,
  reviewStockFeedbackTrajectory,
  runStockFeedbackPaperTradeDiscretionaryReview,
  runStockFeedbackEvidenceTaskQueue,
  settleStockFeedbackPaperTrade,
  verifyStockFeedbackArtifacts,
} from "./codex-ingest-lib.mjs"

let tmpRoot

async function write(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, content, "utf8")
}

async function read(filePath) {
  return fs.readFile(filePath, "utf8")
}

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "stock-feedback-paper-trade-"))
})

afterEach(async () => {
  if (tmpRoot) await fs.rm(tmpRoot, { recursive: true, force: true })
})

describe("stock-feedback paper-trade as-of evidence cutoff", () => {
  it("audits sample density gaps without writing stock-feedback artifacts", async () => {
    const status = await getStockFeedbackStatus({ projectPath: tmpRoot })

    expect(status.sampleDensityAudit).toMatchObject({
      schema: "stock-feedback-sample-density-audit-v1",
      status: "blocked",
      counts: {
        trajectories: 0,
        upstreamInputs: {
          brainRecords: 0,
          selfQuestionAttributions: 0,
          hypothesisEvidenceFeedback: 0,
          collectionResults: 0,
          paperTrades: 0,
        },
        hasTrajectorySourceInput: false,
        hasPaperAgentSourceInput: false,
        expectationTradeTrajectories: 0,
        paperTradeAgentPreviewCandidates: 0,
        paperTradeAgentWrittenCandidates: 0,
        paperTrades: 0,
        benchmarkBatches: 0,
        loraReadyBatches: 0,
      },
      writeBoundary: {
        readOnly: true,
        wroteWiki: false,
        wroteRaw: false,
        wroteRealTradeLedger: false,
      },
    })
    expect(status.counts).toMatchObject({
      sampleDensityGaps: status.sampleDensityAudit.gaps.length,
      paperTradeAgentWrittenCandidates: 0,
      upstreamFeedbackInputs: 0,
    })
    expect(status.sampleDensityAudit.nextAction).toBe("collect_self_question_or_hypothesis_feedback")
    expect(status.sampleDensityAudit.gaps[0]).toMatchObject({
      id: "no_upstream_feedback_inputs",
      command: "self-question loop --stages generate,validate,attribute --write",
    })
    expect(status.sampleDensityAudit.gaps.map((item) => item.id)).toEqual(expect.arrayContaining([
      "no_upstream_feedback_inputs",
      "no_expectation_trade_trajectories",
      "no_paper_trade_agent_preview_candidates",
      "no_benchmark_batches",
      "no_lora_ready_batches",
    ]))
    expect(status.sampleDensityAudit.recommendedCommands[0].command).toBe("self-question loop --stages generate,validate,attribute --write")
    expect(status.sampleDensityAudit.recommendedCommands.map((item) => item.command)).not.toContain("stock-feedback bench --write")
    expect(status.sampleDensityAudit.sourceInputPlan).toMatchObject({
      status: "needs_upstream_inputs",
      hasTrajectorySourceInput: false,
      hasPaperAgentSourceInput: false,
      nextCommands: expect.arrayContaining([
        "hypothesis evidence-feedback --status watching --write",
        "stock-feedback collection-task --write",
      ]),
    })
    await expect(fs.access(path.join(tmpRoot, ".llm-wiki", "stock-feedback"))).rejects.toThrow()
  })

  it("surfaces paper-trade plan candidates from eligible expectation trajectories without writing ledgers", async () => {
    await write(
      path.join(tmpRoot, ".llm-wiki/stock-feedback/trajectories/seed-trajectories.jsonl"),
      `${JSON.stringify({
        schema: "stock-feedback-trajectory-v1",
        id: "stockfb_seed_expectation_001",
        generatedAt: "2026-06-20 15:00:00",
        source: "self-question-attribution",
        sourceRecordId: "attribution_seed_001",
        validationTarget: "expectation_trade",
        qualityGate: {
          status: "expectation_validated",
          validationTarget: "expectation_trade",
          highConfidenceEligible: true,
        },
        questionRecordId: "question_seed_001",
        questionId: "question-seed-001",
        hypothesis: "低位吸收后，资金预期先于订单落地交易样本科技A。",
        summary: "预期 3 日内相对强度继续扩散。",
        stock: {
          name: "样本科技A",
          code: "SZ300901",
          label: "样本科技A SZ300901",
        },
        eventTimeline: [
          { step: "question", at: "2026-06-03 09:20:00", ref: "question_seed_001" },
          { step: "market_validation", at: "2026-06-03 15:00:00", ref: "validation_seed_001" },
        ],
        profitFeedback: {
          entryTiming: "先小仓试错，转强后再加仓",
          positionSizing: "probe_then_add",
        },
        evidenceState: {
          confirmedEvidenceRefs: ["tool-state:self-question-attribution#question_seed_001"],
          nextAction: "seed_paper_trade",
        },
        sourceRefs: ["data/brain/attributions.jsonl", "wiki/股票/样本科技A.md"],
      })}\n`,
    )

    const status = await getStockFeedbackStatus({ projectPath: tmpRoot })

    expect(status.counts.paperTrades).toBe(0)
    expect(status.paperTradePlanning).toMatchObject({
      schema: "stock-feedback-paper-trade-planning-summary-v1",
      counts: {
        eligibleTrajectories: 1,
        candidates: 2,
        missingEntryPrice: 2,
      },
      writeBoundary: {
        wroteRealTradeLedger: false,
        wrotePaperTradeLedger: false,
      },
    })
    expect(status.paperTradePlanning.candidates.map((item) => item.track).sort()).toEqual([
      "llm_discretionary",
      "rule_baseline",
    ])
    expect(status.paperTradePlanning.candidates[0]).toMatchObject({
      sourceTrajectoryId: "stockfb_seed_expectation_001",
      sourceQuestionId: "question_seed_001",
      validationTarget: "expectation_trade",
      stock: {
        code: "SZ300901",
      },
      entry: {
        date: "2026-06-03",
        price: null,
      },
      readiness: {
        status: "needs_market_price",
        missingRequiredFields: ["entryPrice"],
      },
    })
    expect(JSON.stringify(status.paperTradePlanning)).toContain("--source-trajectory-id stockfb_seed_expectation_001")
    await expect(fs.access(path.join(tmpRoot, ".llm-wiki", "stock-feedback", "paper-trades"))).rejects.toThrow()
  })

  it("reads only the latest trajectory snapshot instead of summing historical rebuilds", async () => {
    const trajectoryRoot = path.join(tmpRoot, ".llm-wiki/stock-feedback/trajectories")
    await write(
      path.join(trajectoryRoot, "stock-feedback-trajectories-20260620120000.jsonl"),
      `${JSON.stringify({
        schema: "stock-feedback-trajectory-v1",
        id: "stockfb_old_snapshot",
        generatedAt: "2026-06-20 12:00:00",
        source: "self-question-attribution",
        sourceRecordId: "old-source",
        validationTarget: "expectation_trade",
        qualityGate: {
          status: "expectation_validated",
          validationTarget: "expectation_trade",
          highConfidenceEligible: true,
        },
        stock: { name: "旧样本", code: "SZ300001", label: "旧样本 SZ300001" },
        eventTimeline: [{ step: "question", at: "2026-06-20 09:30:00", ref: "old" }],
        sourceRefs: ["old-ref"],
        evidenceState: { confirmedEvidenceRefs: ["old-ref"] },
      })}\n`,
    )
    await write(
      path.join(trajectoryRoot, "stock-feedback-trajectories-20260620130000.jsonl"),
      `${JSON.stringify({
        schema: "stock-feedback-trajectory-v1",
        id: "stockfb_latest_snapshot",
        generatedAt: "2026-06-20 13:00:00",
        source: "self-question-attribution",
        sourceRecordId: "latest-source",
        validationTarget: "expectation_trade",
        qualityGate: {
          status: "expectation_validated",
          validationTarget: "expectation_trade",
          highConfidenceEligible: true,
        },
        stock: { name: "新样本", code: "SZ300002", label: "新样本 SZ300002" },
        eventTimeline: [{ step: "question", at: "2026-06-20 10:30:00", ref: "latest" }],
        sourceRefs: ["latest-ref"],
        evidenceState: { confirmedEvidenceRefs: ["latest-ref"] },
      })}\n`,
    )

    const status = await getStockFeedbackStatus({ projectPath: tmpRoot })
    const verified = await verifyStockFeedbackArtifacts({ projectPath: tmpRoot })

    expect(status.counts.trajectories).toBe(1)
    expect(status.counts.persistedTrajectories).toBe(1)
    expect(status.latest.trajectoryArtifact).toBe(".llm-wiki/stock-feedback/trajectories/stock-feedback-trajectories-20260620130000.jsonl")
    expect(status.paperTradePlanning.candidates.every((item) => item.sourceTrajectoryId === "stockfb_latest_snapshot")).toBe(true)
    expect(JSON.stringify(status)).not.toContain("stockfb_old_snapshot")
    expect(verified.checked.trajectories).toBe(1)
    expect(verified.status).toBe("ok")
  })

  it("records asOfDate in the paper-trade ledger, manifest, and derived trajectory", async () => {
    const written = await recordStockFeedbackPaperTrade({
      projectPath: tmpRoot,
      track: "llm_discretionary",
      asOfDate: "2026-06-03",
      sourceQuestionId: "question_asof_001",
      validationTarget: "expectation_trade",
      stockName: "样本科技A",
      stockCode: "SZ300901",
      hypothesis: "只使用 2026-06-03 之前可见的扩散和承接证据做模拟买入。",
      expectedMove: "预期后续 3 日继续相对强势。",
      entryDate: "2026-06-03",
      entryPrice: "10.00",
      exitDate: "2026-06-06",
      exitPrice: "10.80",
      realizedPnlPct: "8",
      maxDrawdownPct: "1.6",
      holdingDays: "3",
      positionSizing: "probe_15pct",
      sourceRefs: "self-question:question_asof_001,retrieval:sourceRefs#asof",
      evidenceRefs: "price-sql:SZ300901:asof-2026-06-03,tool-state:self-question-attribution",
      generatedAt: "2026-06-20 16:00:00",
      write: true,
    })

    expect(written.paperTrade).toMatchObject({
      schema: "stock-feedback-paper-trade-v1",
      asOfDate: "2026-06-03",
      ledgerKind: "paper_trade",
      evidenceCutoff: {
        asOfDate: "2026-06-03",
        noFutureData: true,
      },
    })

    const manifest = JSON.parse(await read(written.writeResult.manifest.path))
    expect(manifest).toMatchObject({
      schema: "stock-feedback-paper-trade-manifest-v1",
      asOfDate: "2026-06-03",
      evidenceCutoff: {
        asOfDate: "2026-06-03",
        noFutureData: true,
      },
    })

    const built = await buildStockFeedbackTrajectories({
      projectPath: tmpRoot,
      generatedAt: "2026-06-20 16:01:00",
    })
    const trajectory = built.trajectories.find((item) => item.sourceRecordId === written.paperTrade.id)
    expect(trajectory).toMatchObject({
      source: "stock-feedback-paper-trade",
      evidenceState: expect.objectContaining({
        asOfDate: "2026-06-03",
        paperTradeId: written.paperTrade.id,
      }),
      paperTradeState: expect.objectContaining({
        asOfDate: "2026-06-03",
        evidenceCutoff: expect.objectContaining({
          noFutureData: true,
        }),
      }),
    })

    const verified = await verifyStockFeedbackArtifacts({ projectPath: tmpRoot })
    expect(verified.status).toBe("ok")
    expect(verified.checked.paperTrades).toBe(1)
  })

  it("audits llm_discretionary review readiness against paired settled rule baselines", async () => {
    await recordStockFeedbackPaperTrade({
      projectPath: tmpRoot,
      track: "rule_baseline",
      asOfDate: "2026-06-03",
      sourceQuestionId: "question_discretionary_pair_001",
      sourceTrajectoryId: "stockfb_pair_001",
      validationTarget: "expectation_trade",
      stockName: "样本科技A",
      stockCode: "SZ300901",
      hypothesis: "同一假设下生成规则基准模拟交易。",
      expectedMove: "3 日内相对强度扩散。",
      entryDate: "2026-06-03",
      entryPrice: "10.00",
      exitDate: "2026-06-06",
      exitPrice: "10.60",
      realizedPnlPct: "6",
      maxDrawdownPct: "1.2",
      holdingDays: "3",
      positionSizing: "probe_15pct",
      sourceRefs: "self-question:question_discretionary_pair_001,retrieval:sourceRefs#baseline",
      evidenceRefs: "price-sql:SZ300901:baseline-entry,price-sql:SZ300901:baseline-exit",
      generatedAt: "2026-06-20 16:30:00",
      write: true,
    })
    const llmOpened = await recordStockFeedbackPaperTrade({
      projectPath: tmpRoot,
      track: "llm_discretionary",
      asOfDate: "2026-06-03",
      sourceQuestionId: "question_discretionary_pair_001",
      sourceTrajectoryId: "stockfb_pair_001",
      validationTarget: "expectation_trade",
      stockName: "样本科技A",
      stockCode: "SZ300901",
      hypothesis: "同一假设下生成 LLM 自主模拟交易。",
      expectedMove: "3 日内相对强度扩散。",
      entryDate: "2026-06-03",
      entryPrice: "10.00",
      positionSizing: "probe_15pct",
      sourceRefs: "self-question:question_discretionary_pair_001,retrieval:sourceRefs#llm",
      evidenceRefs: "price-sql:SZ300901:llm-entry,tool-state:self-question-attribution",
      generatedAt: "2026-06-20 16:31:00",
      write: true,
    })

    const blocked = await getStockFeedbackStatus({ projectPath: tmpRoot })
    expect(blocked.discretionaryReviewAudit).toMatchObject({
      schema: "stock-feedback-discretionary-review-audit-v1",
      status: "blocked",
      counts: {
        llmPaperTrades: 1,
        pairedRuleBaselineTrades: 1,
        openLlmPaperTrades: 1,
        readyPairs: 0,
      },
      nextAction: "settle_llm_discretionary_trade",
      writeBoundary: {
        readOnly: true,
        wrotePaperTradeLedger: false,
        wroteRealTradeLedger: false,
      },
    })

    await settleStockFeedbackPaperTrade({
      projectPath: tmpRoot,
      paperTradeId: llmOpened.paperTrade.id,
      exitDate: "2026-06-06",
      exitPrice: "10.40",
      maxDrawdownPct: "1.6",
      holdingDays: "3",
      exitTiming: "LLM 判断承接放缓后止盈",
      exitReason: "自主复盘需要和规则基准比较",
      evidenceRefs: "price-sql:SZ300901:llm-exit,trade-ledger:paper-settlement",
      generatedAt: "2026-06-20 16:35:00",
      write: true,
    })

    const ready = await getStockFeedbackStatus({ projectPath: tmpRoot })
    expect(ready.discretionaryReviewAudit).toMatchObject({
      schema: "stock-feedback-discretionary-review-audit-v1",
      status: "ready",
      counts: {
        llmPaperTrades: 1,
        pairedRuleBaselineTrades: 1,
        closedLlmPaperTrades: 1,
        readyPairs: 1,
      },
      nextAction: "ready_for_discretionary_review_runner",
      peftBoundary: {
        storesRawFacts: false,
      },
    })
    expect(ready.discretionaryReviewAudit.items[0]).toMatchObject({
      paperTradeId: llmOpened.paperTrade.id,
      pairedRuleBaselineStatus: "closed",
      evidenceCutoffOk: true,
      readyForReview: true,
    })

    const reviewDrafts = await runStockFeedbackPaperTradeDiscretionaryReview({
      projectPath: tmpRoot,
      generatedAt: "2026-06-20 16:35:30",
      limit: 4,
    })
    expect(reviewDrafts).toMatchObject({
      schema: "stock-feedback-paper-trade-discretionary-review-result-v1",
      mode: "stock-feedback-paper-trade-discretionary-review",
      dryRun: true,
      count: 1,
      summary: {
        totalDrafts: 1,
        llmUnderperformed: 1,
        negativeRoutes: 1,
      },
      writePolicy: {
        readOnly: true,
        wrotePaperTradeLedger: false,
        wroteRealTradeLedger: false,
        wroteArtifacts: false,
      },
    })
    expect(reviewDrafts.drafts[0]).toMatchObject({
      schema: "stock-feedback-paper-trade-discretionary-review-draft-v1",
      llmPaperTradeId: llmOpened.paperTrade.id,
      recommendedAction: "route_llm_underperformance_to_negative_preference",
      routeTo: ["eval", "preference", "negative"],
      comparison: {
        result: "llm_underperformed",
        llmRealizedPnlPct: 4,
        baselineRealizedPnlPct: 6,
        deltaPct: -2,
      },
      peftBoundary: {
        storesRawFacts: false,
      },
    })
    expect(reviewDrafts.drafts[0].sourceRefs.length).toBeGreaterThan(0)
    expect(reviewDrafts.drafts[0].evidenceRefs.length).toBeGreaterThan(0)
    expect(JSON.stringify(reviewDrafts)).toContain("paper_trade_not_real_profit")

    const benchmark = await buildStockFeedbackBenchmark({
      projectPath: tmpRoot,
      generatedAt: "2026-06-20 16:36:00",
      limit: 10,
    })
    const discretionaryCases = benchmark.cases.filter((item) => item.sourceKind === "paper_trade_discretionary_review")
    expect(discretionaryCases).toHaveLength(1)
    expect(discretionaryCases[0]).toMatchObject({
      adapterCapability: "paper_trade_discretionary_review",
      paperTradeId: llmOpened.paperTrade.id,
      validationTarget: "expectation_trade",
      expected: expect.objectContaining({
        routeTo: ["eval", "preference", "paper_trade_discretionary_review"],
        highConfidenceEligible: false,
        sourceKind: "paper_trade_discretionary_review",
        paperTrade: "closed",
        pairedRuleBaselineStatus: "closed",
        llmOutcome: "profitable",
        baselineOutcome: "profitable",
        evidenceCutoff: expect.objectContaining({ noFutureData: true }),
      }),
    })

    const loraReady = await exportStockFeedbackLoraReady({
      projectPath: tmpRoot,
      generatedAt: "2026-06-20 16:37:00",
      qualityGate: "all",
    })
    expect(loraReady.manifest.paperTradeDiscretionaryReviewCurriculum).toMatchObject({
      schema: "stock-feedback-paper-trade-discretionary-review-curriculum-v1",
      modelTrainingStarted: false,
      highConfidenceEligible: false,
      defaultRoute: ["eval", "preference", "paper_trade_discretionary_review"],
      counts: {
        total: 1,
        llmWins: 0,
        llmLosses: 1,
        tied: 0,
        profitableLlmTrades: 1,
        profitableBaselineTrades: 1,
      },
      peftBoundary: {
        storesRawFacts: false,
      },
    })
    expect(loraReady.manifest.adapterCurriculum.paperTradeDiscretionaryReview.groups.map((item) => item.id)).toEqual([
      "paper_trade_discretionary_review_eval",
      "paper_trade_discretionary_review_llm_underperformed",
      "paper_trade_discretionary_review_llm_outperformed",
      "paper_trade_discretionary_review_tie",
    ])
    expect(loraReady.manifest.adapterCurriculum.paperTradeDiscretionaryReview.groups[1]).toMatchObject({
      count: 1,
      trainingUse: ["eval", "preference", "negative"],
      reviewGate: "human_review_required_before_any_adapter_use",
    })
    expect(loraReady.manifest.adapterCurriculum.paperTradeDiscretionaryReview.peftBoundary.storesRawFacts).toBe(false)
  })

  it("fails verify for unsafe discretionary review LoRA-ready curriculum manifests", async () => {
    await write(path.join(tmpRoot, ".llm-wiki/stock-feedback/exports/lora-ready-bad-discretionary.manifest.json"), `${JSON.stringify({
      schema: "stock-feedback-lora-ready-manifest-v1",
      generatedAt: "2026-06-20 16:38:00",
      projectPath: tmpRoot,
      count: 0,
      paperTradeDiscretionaryReviewCurriculum: {
        schema: "stock-feedback-paper-trade-discretionary-review-curriculum-v1",
        modelTrainingStarted: false,
        highConfidenceEligible: true,
        defaultRoute: ["adapter"],
        groups: [
          {
            id: "paper_trade_discretionary_review_llm_underperformed",
            label: "LLM 跑输规则基准",
            count: 1,
            trainingUse: ["adapter"],
            reviewGate: "auto_promote",
          },
        ],
        counts: {
          total: 1,
          llmWins: 0,
          llmLosses: 1,
          tied: 0,
          unknown: 0,
          profitableLlmTrades: 1,
          profitableBaselineTrades: 1,
        },
        policy: {
          paperTradeIsNotRealProfit: false,
          requiresHumanReviewBeforeAdapter: false,
        },
        peftBoundary: {
          storesRawFacts: true,
        },
      },
    }, null, 2)}\n`)

    const verified = await verifyStockFeedbackArtifacts({ projectPath: tmpRoot })
    expect(verified.status).toBe("failed")
    expect(verified.issues.map((item) => item.code)).toEqual(expect.arrayContaining([
      "lora_ready_discretionary_review_high_confidence_enabled",
      "lora_ready_discretionary_review_missing_eval_preference_route",
      "lora_ready_discretionary_review_underperformed_missing_negative_route",
      "lora_ready_discretionary_review_promotes_paper_profit",
      "lora_ready_discretionary_review_missing_peft_boundary",
    ]))
  })

  it("fails verify when LoRA-ready manifest or adapter batch violates PEFT boundaries", async () => {
    await write(path.join(tmpRoot, ".llm-wiki/stock-feedback/exports/lora-ready-bad-peft-boundary.manifest.json"), `${JSON.stringify({
      schema: "stock-feedback-lora-ready-manifest-v1",
      generatedAt: "2026-06-20 16:38:10",
      projectPath: tmpRoot,
      count: 0,
      candidateRefs: [],
      adapterBatchRecipe: {
        schema: "stock-feedback-adapter-batch-recipe-v1",
        modelTrainingStarted: true,
        storesRawFacts: true,
        totalCandidates: 0,
        weightedCandidateCount: 0,
        totalEffectiveWeight: 0,
        buckets: [],
        peftBoundary: {
          modelTrainingStarted: true,
          storesRawFacts: true,
        },
      },
      peftBoundary: {
        modelTrainingStarted: true,
        storesRawFacts: true,
      },
    }, null, 2)}\n`)

    const verified = await verifyStockFeedbackArtifacts({ projectPath: tmpRoot })
    expect(verified.status).toBe("failed")
    expect(verified.issues.map((item) => item.code)).toEqual(expect.arrayContaining([
      "lora_ready_manifest_model_training_started",
      "lora_ready_manifest_stores_raw_facts",
      "lora_ready_adapter_batch_model_training_started",
      "lora_ready_adapter_batch_stores_raw_facts",
      "lora_ready_adapter_batch_peft_boundary_model_training_started",
      "lora_ready_adapter_batch_peft_boundary_stores_raw_facts",
    ]))
  })

  it("fails verify when LoRA-ready PEFT boundary adapterStores facts", async () => {
    await write(path.join(tmpRoot, ".llm-wiki/stock-feedback/exports/lora-ready-bad-peft-adapter-stores.manifest.json"), `${JSON.stringify({
      schema: "stock-feedback-lora-ready-manifest-v1",
      generatedAt: "2026-06-20 16:38:15",
      projectPath: tmpRoot,
      count: 0,
      candidateRefs: [],
      adapterBatchRecipe: {
        schema: "stock-feedback-adapter-batch-recipe-v1",
        modelTrainingStarted: false,
        storesRawFacts: false,
        totalCandidates: 0,
        weightedCandidateCount: 0,
        totalEffectiveWeight: 0,
        buckets: [],
        peftBoundary: {
          modelTrainingStarted: false,
          storesRawFacts: false,
          adapterStores: ["behavior", "raw_facts"],
        },
      },
      peftBoundary: {
        modelTrainingStarted: false,
        storesRawFacts: false,
        adapterStores: ["skill", "stock_fact_memory"],
      },
    }, null, 2)}\n`)

    const verified = await verifyStockFeedbackArtifacts({ projectPath: tmpRoot })
    expect(verified.status).toBe("failed")
    expect(verified.issues.map((item) => item.code)).toEqual(expect.arrayContaining([
      "lora_ready_manifest_peft_boundary_adapter_stores_fact_memory",
      "lora_ready_adapter_batch_peft_boundary_adapter_stores_raw_facts",
    ]))
  })

  it("fails verify when LoRA-ready paper-trade-agent curriculum drifts from candidates", async () => {
    await write(
      path.join(tmpRoot, ".llm-wiki/stock-feedback/paper-trade-agent/stock-feedback-paper-trade-agent-20260620163820.jsonl"),
      `${JSON.stringify({
        schema: "stock-feedback-paper-trade-agent-candidate-v1",
        id: "stockfb_paper_agent_lora_curriculum_once",
        generatedAt: "2026-06-20 16:38:20",
        sourceKind: "stock_feedback_trajectory",
        sourceTrajectoryId: "stockfb_lora_curriculum_source",
        track: "rule_baseline",
        pairedTrack: "llm_discretionary",
        ledgerKind: "paper_trade",
        validationTarget: "expectation_trade",
        asOfDate: "2026-06-03",
        evidenceCutoff: {
          asOfDate: "2026-06-03",
          noFutureData: true,
        },
        stock: {
          name: "样本科技A",
          code: "SZ300901",
        },
        hypothesis: "低位吸收后观察承接。",
        expectedCatalyst: "市场预期扩散",
        entryPlan: {
          date: "2026-06-03",
          price: null,
          priceSource: "market_data_at_asof_required",
          reason: "等待 as-of 价格证据",
          evidenceRefs: ["tool-state:self-question-attribution#lora_curriculum_source"],
          requiredMarketFields: ["entryPrice", "relativeStrength"],
        },
        exitPlan: {
          track: "rule_baseline",
          rule: "exit on 5 trading days",
          targetHoldingDays: 5,
        },
        positionSizing: "paper_trade_unit_risk_0.35x_until_reviewed",
        sourceRefs: ["self-question:lora-curriculum-source"],
        evidenceRefs: ["tool-state:self-question-attribution#lora_curriculum_source"],
        marketEvidenceRequest: {
          provider: "tushare_or_price_sql",
          asOfDate: "2026-06-03",
          fields: ["entryPrice", "relativeStrength"],
        },
        readiness: {
          status: "needs_market_price",
          missingRequiredFields: ["entryPrice"],
        },
        peftBoundary: {
          storesRawFacts: false,
          factsRemainIn: ["retrieval/tool state", "sourceRefs", "price SQL or Tushare", "paper trade ledger"],
          adapterStores: ["behavior", "skill", "tool_habit", "decision_strategy"],
        },
      })}\n`,
    )
    await write(path.join(tmpRoot, ".llm-wiki/stock-feedback/exports/lora-ready-bad-paper-agent-curriculum.manifest.json"), `${JSON.stringify({
      schema: "stock-feedback-lora-ready-manifest-v1",
      generatedAt: "2026-06-20 16:38:20",
      projectPath: tmpRoot,
      count: 0,
      candidateRefs: [],
      adapterBatchRecipe: {
        schema: "stock-feedback-adapter-batch-recipe-v1",
        modelTrainingStarted: false,
        storesRawFacts: false,
        totalCandidates: 0,
        weightedCandidateCount: 0,
        totalEffectiveWeight: 0,
        buckets: [],
      },
      paperTradeAgentCurriculum: {
        schema: "stock-feedback-paper-trade-agent-curriculum-v1",
        modelTrainingStarted: false,
        defaultWeightMultiplier: 0.35,
        counts: {
          total: 2,
          ruleBaseline: 0,
          llmDiscretionary: 2,
          needsMarketPrice: 0,
          blocked: 1,
          fromTrajectory: 0,
          fromHypothesisFeedback: 1,
        },
        groups: [
          {
            id: "paper_trade_rule_baseline",
            count: 0,
            trainingUse: ["eval", "baseline_policy"],
          },
          {
            id: "paper_trade_llm_discretionary",
            count: 2,
            trainingUse: ["eval", "preference"],
          },
          {
            id: "paper_trade_blocked_evidence",
            count: 0,
            trainingUse: ["evidence_gap_queue"],
          },
        ],
        peftBoundary: {
          storesRawFacts: false,
          factsRemainIn: ["retrieval/tool state", "sourceRefs", "price SQL or Tushare", "paper trade ledger"],
          adapterStores: ["behavior", "skill", "tool_habit", "decision_strategy"],
        },
      },
      adapterCurriculum: {
        paperTradeAgent: {
          schema: "stock-feedback-paper-trade-agent-curriculum-v1",
          counts: {
            total: 2,
            ruleBaseline: 0,
          },
          groups: [
            {
              id: "paper_trade_rule_baseline",
              count: 0,
            },
          ],
          peftBoundary: {
            storesRawFacts: false,
          },
        },
      },
      peftBoundary: {
        modelTrainingStarted: false,
        storesRawFacts: false,
      },
    }, null, 2)}\n`)

    const verified = await verifyStockFeedbackArtifacts({ projectPath: tmpRoot })

    expect(verified.status).toBe("failed")
    expect(verified.issues.map((item) => item.code)).toEqual(expect.arrayContaining([
      "lora_ready_paper_trade_agent_curriculum_count_mismatch",
      "lora_ready_paper_trade_agent_curriculum_group_count_mismatch",
    ]))
  })

  it("keeps historical LoRA-ready paper-trade-agent curriculum snapshots from failing current verify", async () => {
    await write(
      path.join(tmpRoot, ".llm-wiki/stock-feedback/paper-trade-agent/stock-feedback-paper-trade-agent-20260620163820.jsonl"),
      `${JSON.stringify({
        schema: "stock-feedback-paper-trade-agent-candidate-v1",
        id: "stockfb_paper_agent_lora_curriculum_current",
        generatedAt: "2026-06-20 16:38:20",
        sourceKind: "stock_feedback_trajectory",
        sourceTrajectoryId: "stockfb_lora_curriculum_source",
        track: "rule_baseline",
        pairedTrack: "llm_discretionary",
        ledgerKind: "paper_trade",
        validationTarget: "expectation_trade",
        asOfDate: "2026-06-03",
        evidenceCutoff: {
          asOfDate: "2026-06-03",
          noFutureData: true,
        },
        stock: {
          name: "样本科技A",
          code: "SZ300901",
        },
        hypothesis: "低位吸收后观察承接。",
        expectedCatalyst: "市场预期扩散",
        entryPlan: {
          date: "2026-06-03",
          price: null,
          priceSource: "market_data_at_asof_required",
          reason: "等待 as-of 价格证据",
          evidenceRefs: ["tool-state:self-question-attribution#lora_curriculum_source"],
          requiredMarketFields: ["entryPrice", "relativeStrength", "turnoverChange", "followThrough_1d", "followThrough_3d", "followThrough_5d"],
        },
        exitPlan: {
          track: "rule_baseline",
          rule: "exit on 5 trading days",
          targetHoldingDays: 5,
        },
        positionSizing: "paper_trade_unit_risk_0.35x_until_reviewed",
        sourceRefs: ["self-question:lora-curriculum-source"],
        evidenceRefs: ["tool-state:self-question-attribution#lora_curriculum_source"],
        marketEvidenceRequest: {
          provider: "tushare_or_price_sql",
          asOfDate: "2026-06-03",
          fields: ["entryPrice", "maxDrawdown", "followThrough", "relativeStrength", "turnoverChange"],
        },
        readiness: {
          status: "needs_market_price",
          missingRequiredFields: ["entryPrice"],
        },
        peftBoundary: {
          storesRawFacts: false,
          factsRemainIn: ["retrieval/tool state", "sourceRefs", "price SQL or Tushare", "paper trade ledger"],
          adapterStores: ["behavior", "skill", "tool_habit", "decision_strategy"],
        },
      })}\n`,
    )
    const loraManifest = (generatedAt, counts) => ({
      schema: "stock-feedback-lora-ready-manifest-v1",
      generatedAt,
      projectPath: tmpRoot,
      count: 0,
      candidateRefs: [],
      adapterBatchRecipe: {
        schema: "stock-feedback-adapter-batch-recipe-v1",
        modelTrainingStarted: false,
        storesRawFacts: false,
        totalCandidates: 0,
        weightedCandidateCount: 0,
        totalEffectiveWeight: 0,
        buckets: [],
      },
      paperTradeAgentCurriculum: {
        schema: "stock-feedback-paper-trade-agent-curriculum-v1",
        modelTrainingStarted: false,
        defaultWeightMultiplier: 0.35,
        counts,
        groups: [
          { id: "paper_trade_rule_baseline", count: counts.ruleBaseline },
          { id: "paper_trade_llm_discretionary", count: counts.llmDiscretionary },
          { id: "paper_trade_blocked_evidence", count: counts.needsMarketPrice + counts.blocked },
        ],
        peftBoundary: {
          storesRawFacts: false,
          factsRemainIn: ["retrieval/tool state", "sourceRefs", "price SQL or Tushare", "paper trade ledger"],
          adapterStores: ["behavior", "skill", "tool_habit", "decision_strategy"],
        },
      },
      adapterCurriculum: {
        paperTradeAgent: {
          schema: "stock-feedback-paper-trade-agent-curriculum-v1",
          counts,
          groups: [
            { id: "paper_trade_rule_baseline", count: counts.ruleBaseline },
            { id: "paper_trade_llm_discretionary", count: counts.llmDiscretionary },
            { id: "paper_trade_blocked_evidence", count: counts.needsMarketPrice + counts.blocked },
          ],
          peftBoundary: {
            storesRawFacts: false,
            factsRemainIn: ["retrieval/tool state", "sourceRefs", "price SQL or Tushare", "paper trade ledger"],
            adapterStores: ["behavior", "skill", "tool_habit", "decision_strategy"],
          },
        },
      },
      peftBoundary: {
        modelTrainingStarted: false,
        storesRawFacts: false,
        adapterStores: ["behavior", "skill", "tool_habit", "decision_strategy"],
      },
    })
    await write(
      path.join(tmpRoot, ".llm-wiki/stock-feedback/exports/lora-ready-old-paper-agent-curriculum.manifest.json"),
      `${JSON.stringify(loraManifest("2026-06-20 16:38:20", {
        total: 0,
        ruleBaseline: 0,
        llmDiscretionary: 0,
        needsMarketPrice: 0,
        blocked: 0,
        fromTrajectory: 0,
        fromHypothesisFeedback: 0,
      }), null, 2)}\n`,
    )
    await write(
      path.join(tmpRoot, ".llm-wiki/stock-feedback/exports/lora-ready-current-paper-agent-curriculum.manifest.json"),
      `${JSON.stringify(loraManifest("2026-06-20 16:39:20", {
        total: 1,
        ruleBaseline: 1,
        llmDiscretionary: 0,
        needsMarketPrice: 1,
        blocked: 0,
        fromTrajectory: 1,
        fromHypothesisFeedback: 0,
      }), null, 2)}\n`,
    )

    const verified = await verifyStockFeedbackArtifacts({ projectPath: tmpRoot })
    expect(verified.status).toBe("ok")
  })

  it("fails verify for unsafe paper-trade LoRA-ready candidate refs", async () => {
    await write(path.join(tmpRoot, ".llm-wiki/stock-feedback/exports/lora-ready-bad-paper-ref.manifest.json"), `${JSON.stringify({
      schema: "stock-feedback-lora-ready-manifest-v1",
      generatedAt: "2026-06-20 16:38:30",
      projectPath: tmpRoot,
      count: 1,
      candidateRefs: [
        {
          id: "adapter_candidate_bad_paper_ref",
          sourceTrajectoryId: "stockfb_paper_bad_ref",
          adapterCapability: "expectation_trade_judgment",
          validationTarget: "expectation_trade",
          qualityGateStatus: "review_required",
          profitOutcome: "profitable",
          sourceKind: "stock-feedback-paper-trade",
          paperTradeId: "paper_trade_bad_ref",
          reviewed: false,
          trainingWeightState: "human_approved_upweight",
          effectiveWeightMultiplier: 1,
          trainingWeightSource: "review_event",
        },
      ],
      adapterBatchRecipe: {
        schema: "stock-feedback-adapter-batch-recipe-v1",
        buckets: [
          {
            id: "human_approved_upweight",
            effectiveWeightMultiplier: 1,
            candidateRefs: [
              {
                id: "adapter_candidate_bad_paper_ref",
                paperTradeId: "paper_trade_bad_ref",
                trainingWeightState: "human_approved_upweight",
                effectiveWeightMultiplier: 1,
              },
            ],
          },
        ],
      },
      peftBoundary: {
        storesRawFacts: false,
      },
    }, null, 2)}\n`)

    const verified = await verifyStockFeedbackArtifacts({ projectPath: tmpRoot })
    expect(verified.status).toBe("failed")
    expect(verified.issues.map((item) => item.code)).toEqual(expect.arrayContaining([
      "lora_ready_paper_ref_without_review",
      "lora_ready_paper_ref_invalid_weight_state",
      "lora_ready_paper_ref_weight_too_high",
      "lora_ready_paper_ref_batch_bucket_not_low_weight",
    ]))
  })

  it("fails verify when paper-trade LoRA-ready refs are not settled profitable samples", async () => {
    await write(path.join(tmpRoot, ".llm-wiki/stock-feedback/exports/lora-ready-unsettled-paper-ref.manifest.json"), `${JSON.stringify({
      schema: "stock-feedback-lora-ready-manifest-v1",
      generatedAt: "2026-06-20 16:38:45",
      projectPath: tmpRoot,
      count: 1,
      candidateRefs: [
        {
          id: "adapter_candidate_unsettled_paper_ref",
          sourceTrajectoryId: "stockfb_paper_unsettled_ref",
          adapterCapability: "expectation_trade_judgment",
          validationTarget: "expectation_trade",
          qualityGateStatus: "review_required",
          profitOutcome: "pending_settlement",
          sourceKind: "stock-feedback-paper-trade",
          paperTradeId: "paper_trade_unsettled_ref",
          paperTradeStatus: "open",
          ledgerKind: "paper_trade",
          reviewed: true,
          trainingWeightState: "human_approved_paper_adapter_low_weight",
          effectiveWeightMultiplier: 0.35,
          trainingWeightSource: "human_review",
        },
      ],
      adapterBatchRecipe: {
        schema: "stock-feedback-adapter-batch-recipe-v1",
        buckets: [
          {
            id: "human_approved_paper_adapter_low_weight",
            effectiveWeightMultiplier: 0.35,
            candidateIds: ["adapter_candidate_unsettled_paper_ref"],
          },
        ],
      },
      peftBoundary: {
        storesRawFacts: false,
      },
    }, null, 2)}\n`)

    const verified = await verifyStockFeedbackArtifacts({ projectPath: tmpRoot })
    expect(verified.status).toBe("failed")
    expect(verified.issues.map((item) => item.code)).toEqual(expect.arrayContaining([
      "lora_ready_paper_ref_not_closed",
      "lora_ready_paper_ref_not_profitable",
      "lora_ready_paper_ref_missing_settlement_metrics",
    ]))
  })

  it("fails verify for unsafe bucket-only paper-trade LoRA-ready refs", async () => {
    await write(path.join(tmpRoot, ".llm-wiki/stock-feedback/exports/lora-ready-bucket-only-paper-ref.manifest.json"), `${JSON.stringify({
      schema: "stock-feedback-lora-ready-manifest-v1",
      generatedAt: "2026-06-20 16:39:00",
      projectPath: tmpRoot,
      count: 1,
      candidateRefs: [],
      adapterBatchRecipe: {
        schema: "stock-feedback-adapter-batch-recipe-v1",
        buckets: [
          {
            id: "human_approved_paper_adapter_low_weight",
            effectiveWeightMultiplier: 0.35,
            candidateRefs: [
              {
                id: "adapter_candidate_bucket_only_paper_ref",
                paperTradeId: "paper_trade_bucket_only_ref",
                sourceKind: "stock-feedback-paper-trade",
                paperTradeStatus: "open",
                ledgerKind: "paper_trade",
                profitOutcome: "pending_settlement",
                reviewed: true,
                trainingWeightState: "human_approved_paper_adapter_low_weight",
                effectiveWeightMultiplier: 0.35,
              },
            ],
          },
        ],
      },
      peftBoundary: {
        storesRawFacts: false,
      },
    }, null, 2)}\n`)

    const verified = await verifyStockFeedbackArtifacts({ projectPath: tmpRoot })
    expect(verified.status).toBe("failed")
    expect(verified.issues.map((item) => item.code)).toEqual(expect.arrayContaining([
      "lora_ready_paper_ref_not_closed",
      "lora_ready_paper_ref_not_profitable",
      "lora_ready_paper_ref_missing_settlement_metrics",
    ]))
  })

  it("fails verify for unsafe paper-trade LoRA-ready candidate records", async () => {
    await write(path.join(tmpRoot, ".llm-wiki/stock-feedback/exports/lora-ready-bad-paper-candidate.jsonl"), `${JSON.stringify({
      schema: "stock-feedback-adapter-candidate-v1",
      id: "adapter_candidate_bad_paper_record",
      sourceKind: "stock-feedback-paper-trade",
      sourceTrajectoryId: "stockfb_paper_bad_candidate",
      validationTarget: "expectation_trade",
      qualityGateStatus: "review_required",
      adapterCapability: "expectation_trade_judgment",
      reviewSignal: {
        reviewed: false,
        latestAction: "approve_for_adapter",
      },
      trainingWeightDecision: {
        state: "human_approved_upweight",
        effectiveWeightMultiplier: 1,
      },
      paperTradeState: {
        ledgerKind: "paper_trade",
        status: "open",
      },
      profitFeedback: {
        outcome: "pending_settlement",
        ledgerKind: "paper_trade",
      },
      references: {
        paperTradeId: "paper_trade_bad_candidate",
      },
      decisionPolicy: {
        keepFactsInRetrieval: true,
        adapterDoesNotStore: "raw_facts_announcements_financial_reports_or_trade_data",
      },
    })}\n`)

    const verified = await verifyStockFeedbackArtifacts({ projectPath: tmpRoot })
    expect(verified.status).toBe("failed")
    expect(verified.issues.map((item) => item.code)).toEqual(expect.arrayContaining([
      "lora_ready_paper_candidate_without_review",
      "lora_ready_paper_candidate_not_closed",
      "lora_ready_paper_candidate_not_profitable",
      "lora_ready_paper_candidate_missing_settlement_metrics",
      "lora_ready_paper_candidate_invalid_weight_state",
      "lora_ready_paper_candidate_weight_too_high",
    ]))
  })

  it("fails verify for LoRA-ready candidate records that violate adapter fact boundaries", async () => {
    await write(path.join(tmpRoot, ".llm-wiki/stock-feedback/exports/lora-ready-bad-candidate-policy.jsonl"), `${JSON.stringify({
      schema: "stock-feedback-adapter-candidate-v1",
      id: "adapter_candidate_bad_policy",
      sourceKind: "stock-feedback-trajectory",
      sourceTrajectoryId: "stockfb_bad_policy",
      validationTarget: "expectation_trade",
      qualityGateStatus: "expectation_validated",
      adapterCapability: "expectation_trade_judgment",
      reviewSignal: {
        reviewed: true,
        latestAction: "approve_for_adapter",
      },
      trainingWeightDecision: {
        state: "human_approved_upweight",
        effectiveWeightMultiplier: 1,
      },
      decisionPolicy: {
        keepFactsInRetrieval: false,
        adapterStores: ["behavior", "raw_facts"],
        adapterDoesNotStore: "announcements_financial_reports",
      },
    })}\n`)

    const verified = await verifyStockFeedbackArtifacts({ projectPath: tmpRoot })
    expect(verified.status).toBe("failed")
    expect(verified.issues.map((item) => item.code)).toEqual(expect.arrayContaining([
      "lora_ready_candidate_facts_not_kept_in_retrieval",
      "lora_ready_candidate_missing_raw_fact_exclusion",
      "lora_ready_candidate_adapter_stores_raw_facts",
    ]))
  })

  it("fails verify when LoRA-ready candidate policy stores single-stock fact memory", async () => {
    await write(path.join(tmpRoot, ".llm-wiki/stock-feedback/exports/lora-ready-bad-fact-memory-policy.jsonl"), `${JSON.stringify({
      schema: "stock-feedback-adapter-candidate-v1",
      id: "adapter_candidate_bad_fact_memory_policy",
      sourceKind: "stock-feedback-trajectory",
      sourceTrajectoryId: "stockfb_bad_fact_memory_policy",
      validationTarget: "expectation_trade",
      qualityGateStatus: "expectation_validated",
      adapterCapability: "expectation_trade_judgment",
      reviewSignal: {
        reviewed: true,
        latestAction: "approve_for_adapter",
      },
      trainingWeightDecision: {
        state: "human_approved_upweight",
        effectiveWeightMultiplier: 1,
      },
      decisionPolicy: {
        keepFactsInRetrieval: true,
        adapterStores: ["behavior", "single_stock_fact_memory"],
        adapterDoesNotStore: "raw_facts_announcements_financial_reports_or_trade_data",
      },
    })}\n`)

    const verified = await verifyStockFeedbackArtifacts({ projectPath: tmpRoot })
    expect(verified.status).toBe("failed")
    expect(verified.issues.map((item) => item.code)).toEqual(expect.arrayContaining([
      "lora_ready_candidate_adapter_stores_fact_memory",
    ]))
  })

  it("fails verify when LoRA-ready manifest candidate refs miss candidate JSONL records", async () => {
    await write(path.join(tmpRoot, ".llm-wiki/stock-feedback/exports/lora-ready-missing-candidate-record.manifest.json"), `${JSON.stringify({
      schema: "stock-feedback-lora-ready-manifest-v1",
      generatedAt: "2026-06-20 16:39:15",
      projectPath: tmpRoot,
      count: 1,
      candidateRefs: [
        {
          id: "adapter_candidate_missing_jsonl_record",
          sourceTrajectoryId: "stockfb_paper_missing_jsonl_record",
          adapterCapability: "expectation_trade_judgment",
          validationTarget: "expectation_trade",
          qualityGateStatus: "review_required",
          profitOutcome: "profitable",
          sourceKind: "stock-feedback-paper-trade",
          paperTradeId: "paper_trade_missing_jsonl_record",
          paperTradeStatus: "closed",
          ledgerKind: "paper_trade",
          realizedPnlPct: 6.2,
          maxDrawdownPct: 1.4,
          holdingDays: 4,
          reviewed: true,
          trainingWeightState: "human_approved_paper_adapter_low_weight",
          effectiveWeightMultiplier: 0.35,
          trainingWeightSource: "human_review",
        },
      ],
      adapterBatchRecipe: {
        schema: "stock-feedback-adapter-batch-recipe-v1",
        buckets: [
          {
            id: "human_approved_paper_adapter_low_weight",
            effectiveWeightMultiplier: 0.35,
            candidateIds: ["adapter_candidate_missing_jsonl_record"],
          },
        ],
      },
      peftBoundary: {
        storesRawFacts: false,
      },
    }, null, 2)}\n`)

    const verified = await verifyStockFeedbackArtifacts({ projectPath: tmpRoot })
    expect(verified.status).toBe("failed")
    expect(verified.issues.map((item) => item.code)).toEqual(expect.arrayContaining([
      "lora_ready_manifest_candidate_ref_missing_record",
    ]))
  })

  it("fails verify when LoRA-ready manifest candidate refs disagree with candidate JSONL records", async () => {
    await write(path.join(tmpRoot, ".llm-wiki/stock-feedback/exports/lora-ready-manifest-record-mismatch.jsonl"), `${JSON.stringify({
      schema: "stock-feedback-adapter-candidate-v1",
      id: "adapter_candidate_manifest_record_mismatch",
      sourceKind: "stock-feedback-paper-trade",
      references: {
        paperTradeId: "paper_trade_record_ref",
      },
      sourceTrajectoryId: "stockfb_manifest_record_mismatch",
      validationTarget: "expectation_trade",
      qualityGateStatus: "review_required",
      adapterCapability: "paper_trade_execution_judgment",
      paperTradeState: {
        ledgerKind: "paper_trade",
        status: "closed",
      },
      profitFeedback: {
        outcome: "profitable",
        realizedPnlPct: 5.1,
        maxDrawdownPct: 1.6,
        holdingDays: 4,
      },
      trainingWeightDecision: {
        state: "human_approved_paper_adapter_low_weight",
        effectiveWeightMultiplier: 0.35,
      },
      reviewSignal: {
        reviewed: true,
        latestAction: "approve_paper_adapter_candidate",
      },
      peftBoundary: {
        storesRawFacts: false,
      },
    })}\n`)
    await write(path.join(tmpRoot, ".llm-wiki/stock-feedback/exports/lora-ready-manifest-record-mismatch.manifest.json"), `${JSON.stringify({
      schema: "stock-feedback-lora-ready-manifest-v1",
      generatedAt: "2026-06-20 16:39:20",
      projectPath: tmpRoot,
      count: 1,
      candidateRefs: [
        {
          id: "adapter_candidate_manifest_record_mismatch",
          sourceTrajectoryId: "stockfb_manifest_record_mismatch",
          adapterCapability: "paper_trade_execution_judgment",
          validationTarget: "expectation_trade",
          qualityGateStatus: "review_required",
          profitOutcome: "profitable",
          sourceKind: "stock-feedback-paper-trade",
          paperTradeId: "paper_trade_manifest_mismatch",
          paperTradeStatus: "closed",
          ledgerKind: "paper_trade",
          realizedPnlPct: 5.1,
          maxDrawdownPct: 1.6,
          holdingDays: 4,
          reviewed: true,
          trainingWeightState: "human_approved_paper_adapter_low_weight",
          effectiveWeightMultiplier: 0.35,
          trainingWeightSource: "human_review",
        },
      ],
      adapterBatchRecipe: {
        schema: "stock-feedback-adapter-batch-recipe-v1",
        totalCandidates: 1,
        weightedCandidateCount: 1,
        buckets: [
          {
            id: "human_approved_paper_adapter_low_weight",
            count: 1,
            effectiveWeightMultiplier: 0.35,
            candidateIds: ["adapter_candidate_manifest_record_mismatch"],
          },
        ],
      },
      peftBoundary: {
        storesRawFacts: false,
      },
    }, null, 2)}\n`)

    const verified = await verifyStockFeedbackArtifacts({ projectPath: tmpRoot })
    expect(verified.status).toBe("failed")
    expect(verified.issues.map((item) => item.code)).toEqual(expect.arrayContaining([
      "lora_ready_manifest_candidate_ref_record_mismatch",
    ]))
  })

  it("fails verify when one LoRA-ready candidate JSONL repeats an adapter candidate id", async () => {
    const duplicateRecord = {
      schema: "stock-feedback-adapter-candidate-v1",
      id: "adapter_candidate_duplicate_record",
      sourceKind: "stock-feedback-trajectory",
      sourceTrajectoryId: "stockfb_duplicate_record",
      validationTarget: "expectation_trade",
      qualityGateStatus: "expectation_validated",
      adapterCapability: "expectation_trade_judgment",
      trainingWeightDecision: {
        state: "human_approved_upweight",
        effectiveWeightMultiplier: 1,
      },
      reviewSignal: {
        reviewed: true,
        latestAction: "approve_for_adapter",
      },
      decisionPolicy: {
        keepFactsInRetrieval: true,
        adapterDoesNotStore: "raw_facts_announcements_financial_reports_or_trade_data",
      },
    }
    await write(path.join(tmpRoot, ".llm-wiki/stock-feedback/exports/lora-ready-duplicate-record.jsonl"), [
      JSON.stringify(duplicateRecord),
      JSON.stringify(duplicateRecord),
      "",
    ].join("\n"))
    await write(path.join(tmpRoot, ".llm-wiki/stock-feedback/exports/lora-ready-duplicate-record.manifest.json"), `${JSON.stringify({
      schema: "stock-feedback-lora-ready-manifest-v1",
      generatedAt: "2026-06-20 16:39:25",
      projectPath: tmpRoot,
      count: 1,
      candidateRefs: [
        {
          id: "adapter_candidate_duplicate_record",
          sourceTrajectoryId: "stockfb_duplicate_record",
          adapterCapability: "expectation_trade_judgment",
          validationTarget: "expectation_trade",
          qualityGateStatus: "expectation_validated",
          profitOutcome: "unknown",
          sourceKind: "stock-feedback-trajectory",
          reviewed: true,
          trainingWeightState: "human_approved_upweight",
          effectiveWeightMultiplier: 1,
        },
      ],
      adapterBatchRecipe: {
        schema: "stock-feedback-adapter-batch-recipe-v1",
        totalCandidates: 1,
        weightedCandidateCount: 1,
        buckets: [
          {
            id: "human_approved_upweight",
            count: 1,
            effectiveWeightMultiplier: 1,
            candidateIds: ["adapter_candidate_duplicate_record"],
          },
        ],
      },
      peftBoundary: {
        storesRawFacts: false,
      },
    }, null, 2)}\n`)

    const verified = await verifyStockFeedbackArtifacts({ projectPath: tmpRoot })
    expect(verified.status).toBe("failed")
    expect(verified.issues.map((item) => item.code)).toEqual(expect.arrayContaining([
      "lora_ready_candidate_duplicate_record_id",
    ]))
  })

  it("fails verify when LoRA-ready manifest counts drift from candidate refs", async () => {
    await write(path.join(tmpRoot, ".llm-wiki/stock-feedback/exports/lora-ready-count-drift.jsonl"), `${JSON.stringify({
      schema: "stock-feedback-adapter-candidate-v1",
      id: "adapter_candidate_count_drift",
      sourceKind: "stock-feedback-trajectory",
      sourceTrajectoryId: "stockfb_count_drift",
      validationTarget: "expectation_trade",
      qualityGateStatus: "expectation_validated",
      adapterCapability: "expectation_trade_judgment",
      trainingWeightDecision: {
        state: "human_approved_upweight",
        effectiveWeightMultiplier: 1,
      },
      reviewSignal: {
        reviewed: true,
        latestAction: "approve_for_adapter",
      },
      decisionPolicy: {
        keepFactsInRetrieval: true,
        adapterDoesNotStore: "raw_facts_announcements_financial_reports_or_trade_data",
      },
    })}\n`)
    await write(path.join(tmpRoot, ".llm-wiki/stock-feedback/exports/lora-ready-count-drift.manifest.json"), `${JSON.stringify({
      schema: "stock-feedback-lora-ready-manifest-v1",
      generatedAt: "2026-06-20 16:39:30",
      projectPath: tmpRoot,
      count: 2,
      candidateRefs: [
        {
          id: "adapter_candidate_count_drift",
          sourceTrajectoryId: "stockfb_count_drift",
          adapterCapability: "expectation_trade_judgment",
          validationTarget: "expectation_trade",
          qualityGateStatus: "expectation_validated",
          profitOutcome: "unknown",
          sourceKind: "stock-feedback-trajectory",
          reviewed: true,
          trainingWeightState: "human_approved_upweight",
          effectiveWeightMultiplier: 1,
        },
      ],
      adapterBatchRecipe: {
        schema: "stock-feedback-adapter-batch-recipe-v1",
        totalCandidates: 2,
        weightedCandidateCount: 2,
        buckets: [
          {
            id: "human_approved_upweight",
            count: 2,
            effectiveWeightMultiplier: 1,
            candidateIds: ["adapter_candidate_count_drift"],
          },
        ],
      },
      peftBoundary: {
        storesRawFacts: false,
      },
    }, null, 2)}\n`)

    const verified = await verifyStockFeedbackArtifacts({ projectPath: tmpRoot })
    expect(verified.status).toBe("failed")
    expect(verified.issues.map((item) => item.code)).toEqual(expect.arrayContaining([
      "lora_ready_manifest_count_mismatch",
      "lora_ready_adapter_batch_total_mismatch",
      "lora_ready_adapter_batch_bucket_count_mismatch",
    ]))
  })

  it("fails verify when LoRA-ready weighted candidate count drifts from positive-weight refs", async () => {
    const weightedRecord = {
      schema: "stock-feedback-adapter-candidate-v1",
      id: "adapter_candidate_weighted_count_positive",
      sourceKind: "stock-feedback-trajectory",
      sourceTrajectoryId: "stockfb_weighted_count_positive",
      validationTarget: "expectation_trade",
      qualityGateStatus: "expectation_validated",
      adapterCapability: "expectation_trade_judgment",
      trainingWeightDecision: {
        state: "human_approved_upweight",
        effectiveWeightMultiplier: 1,
      },
      reviewSignal: {
        reviewed: true,
        latestAction: "approve_for_adapter",
      },
      decisionPolicy: {
        keepFactsInRetrieval: true,
        adapterDoesNotStore: "raw_facts_announcements_financial_reports_or_trade_data",
      },
    }
    const zeroWeightRecord = {
      ...weightedRecord,
      id: "adapter_candidate_weighted_count_zero",
      sourceTrajectoryId: "stockfb_weighted_count_zero",
      trainingWeightDecision: {
        state: "human_rejected_zero_weight",
        effectiveWeightMultiplier: 0,
      },
      reviewSignal: {
        reviewed: true,
        latestAction: "reject_adapter_candidate",
      },
    }
    await write(path.join(tmpRoot, ".llm-wiki/stock-feedback/exports/lora-ready-weighted-count-drift.jsonl"), [
      JSON.stringify(weightedRecord),
      JSON.stringify(zeroWeightRecord),
      "",
    ].join("\n"))
    await write(path.join(tmpRoot, ".llm-wiki/stock-feedback/exports/lora-ready-weighted-count-drift.manifest.json"), `${JSON.stringify({
      schema: "stock-feedback-lora-ready-manifest-v1",
      generatedAt: "2026-06-20 16:39:31",
      projectPath: tmpRoot,
      count: 2,
      candidateRefs: [
        {
          id: "adapter_candidate_weighted_count_positive",
          sourceTrajectoryId: "stockfb_weighted_count_positive",
          adapterCapability: "expectation_trade_judgment",
          validationTarget: "expectation_trade",
          qualityGateStatus: "expectation_validated",
          profitOutcome: "unknown",
          sourceKind: "stock-feedback-trajectory",
          reviewed: true,
          trainingWeightState: "human_approved_upweight",
          effectiveWeightMultiplier: 1,
        },
        {
          id: "adapter_candidate_weighted_count_zero",
          sourceTrajectoryId: "stockfb_weighted_count_zero",
          adapterCapability: "expectation_trade_judgment",
          validationTarget: "expectation_trade",
          qualityGateStatus: "expectation_validated",
          profitOutcome: "unknown",
          sourceKind: "stock-feedback-trajectory",
          reviewed: true,
          trainingWeightState: "human_rejected_zero_weight",
          effectiveWeightMultiplier: 0,
        },
      ],
      adapterBatchRecipe: {
        schema: "stock-feedback-adapter-batch-recipe-v1",
        totalCandidates: 2,
        weightedCandidateCount: 2,
        buckets: [
          {
            id: "human_approved_upweight",
            count: 1,
            effectiveWeightMultiplier: 1,
            candidateIds: ["adapter_candidate_weighted_count_positive"],
          },
          {
            id: "human_rejected_zero_weight",
            count: 1,
            effectiveWeightMultiplier: 0,
            candidateIds: ["adapter_candidate_weighted_count_zero"],
          },
        ],
      },
      peftBoundary: {
        storesRawFacts: false,
      },
    }, null, 2)}\n`)

    const verified = await verifyStockFeedbackArtifacts({ projectPath: tmpRoot })
    expect(verified.status).toBe("failed")
    expect(verified.issues.map((item) => item.code)).toEqual(expect.arrayContaining([
      "lora_ready_adapter_batch_weighted_count_mismatch",
    ]))
  })

  it("fails verify when LoRA-ready total effective weights drift from candidate refs", async () => {
    const upweightRecord = {
      schema: "stock-feedback-adapter-candidate-v1",
      id: "adapter_candidate_weight_total_upweight",
      sourceKind: "stock-feedback-trajectory",
      sourceTrajectoryId: "stockfb_weight_total_upweight",
      validationTarget: "expectation_trade",
      qualityGateStatus: "expectation_validated",
      adapterCapability: "expectation_trade_judgment",
      trainingWeightDecision: {
        state: "human_approved_upweight",
        effectiveWeightMultiplier: 1,
      },
      reviewSignal: {
        reviewed: true,
        latestAction: "approve_for_adapter",
      },
      decisionPolicy: {
        keepFactsInRetrieval: true,
        adapterDoesNotStore: "raw_facts_announcements_financial_reports_or_trade_data",
      },
    }
    const riskRecord = {
      ...upweightRecord,
      id: "adapter_candidate_weight_total_risk",
      sourceTrajectoryId: "stockfb_weight_total_risk",
      trainingWeightDecision: {
        state: "human_risk_downweight",
        effectiveWeightMultiplier: 0.25,
      },
      reviewSignal: {
        reviewed: true,
        latestAction: "route_to_preference",
      },
    }
    await write(path.join(tmpRoot, ".llm-wiki/stock-feedback/exports/lora-ready-total-weight-drift.jsonl"), [
      JSON.stringify(upweightRecord),
      JSON.stringify(riskRecord),
      "",
    ].join("\n"))
    await write(path.join(tmpRoot, ".llm-wiki/stock-feedback/exports/lora-ready-total-weight-drift.manifest.json"), `${JSON.stringify({
      schema: "stock-feedback-lora-ready-manifest-v1",
      generatedAt: "2026-06-20 16:39:32",
      projectPath: tmpRoot,
      count: 2,
      candidateRefs: [
        {
          id: "adapter_candidate_weight_total_upweight",
          sourceTrajectoryId: "stockfb_weight_total_upweight",
          adapterCapability: "expectation_trade_judgment",
          validationTarget: "expectation_trade",
          qualityGateStatus: "expectation_validated",
          profitOutcome: "unknown",
          sourceKind: "stock-feedback-trajectory",
          reviewed: true,
          trainingWeightState: "human_approved_upweight",
          effectiveWeightMultiplier: 1,
        },
        {
          id: "adapter_candidate_weight_total_risk",
          sourceTrajectoryId: "stockfb_weight_total_risk",
          adapterCapability: "expectation_trade_judgment",
          validationTarget: "expectation_trade",
          qualityGateStatus: "expectation_validated",
          profitOutcome: "unknown",
          sourceKind: "stock-feedback-trajectory",
          reviewed: true,
          trainingWeightState: "human_risk_downweight",
          effectiveWeightMultiplier: 0.25,
        },
      ],
      adapterBatchRecipe: {
        schema: "stock-feedback-adapter-batch-recipe-v1",
        totalCandidates: 2,
        weightedCandidateCount: 2,
        totalEffectiveWeight: 2,
        buckets: [
          {
            id: "human_approved_upweight",
            count: 1,
            effectiveWeightMultiplier: 1,
            totalEffectiveWeight: 2,
            candidateIds: ["adapter_candidate_weight_total_upweight"],
          },
          {
            id: "human_risk_downweight",
            count: 1,
            effectiveWeightMultiplier: 0.25,
            totalEffectiveWeight: 0.25,
            candidateIds: ["adapter_candidate_weight_total_risk"],
          },
        ],
      },
      peftBoundary: {
        storesRawFacts: false,
      },
    }, null, 2)}\n`)

    const verified = await verifyStockFeedbackArtifacts({ projectPath: tmpRoot })
    expect(verified.status).toBe("failed")
    expect(verified.issues.map((item) => item.code)).toEqual(expect.arrayContaining([
      "lora_ready_adapter_batch_total_effective_weight_mismatch",
      "lora_ready_adapter_batch_bucket_total_effective_weight_mismatch",
    ]))
  })

  it("fails verify when LoRA-ready manifest candidate refs duplicate an adapter candidate", async () => {
    await write(path.join(tmpRoot, ".llm-wiki/stock-feedback/exports/lora-ready-duplicate-ref.jsonl"), `${JSON.stringify({
      schema: "stock-feedback-adapter-candidate-v1",
      id: "adapter_candidate_duplicate_ref",
      sourceKind: "stock-feedback-trajectory",
      sourceTrajectoryId: "stockfb_duplicate_ref",
      validationTarget: "expectation_trade",
      qualityGateStatus: "expectation_validated",
      adapterCapability: "expectation_trade_judgment",
      trainingWeightDecision: {
        state: "human_approved_upweight",
        effectiveWeightMultiplier: 1,
      },
      reviewSignal: {
        reviewed: true,
        latestAction: "approve_for_adapter",
      },
      decisionPolicy: {
        keepFactsInRetrieval: true,
        adapterDoesNotStore: "raw_facts_announcements_financial_reports_or_trade_data",
      },
    })}\n`)
    const duplicateRef = {
      id: "adapter_candidate_duplicate_ref",
      sourceTrajectoryId: "stockfb_duplicate_ref",
      adapterCapability: "expectation_trade_judgment",
      validationTarget: "expectation_trade",
      qualityGateStatus: "expectation_validated",
      profitOutcome: "unknown",
      sourceKind: "stock-feedback-trajectory",
      reviewed: true,
      trainingWeightState: "human_approved_upweight",
      effectiveWeightMultiplier: 1,
    }
    await write(path.join(tmpRoot, ".llm-wiki/stock-feedback/exports/lora-ready-duplicate-ref.manifest.json"), `${JSON.stringify({
      schema: "stock-feedback-lora-ready-manifest-v1",
      generatedAt: "2026-06-20 16:39:35",
      projectPath: tmpRoot,
      count: 2,
      candidateRefs: [duplicateRef, duplicateRef],
      adapterBatchRecipe: {
        schema: "stock-feedback-adapter-batch-recipe-v1",
        totalCandidates: 2,
        weightedCandidateCount: 2,
        buckets: [
          {
            id: "human_approved_upweight",
            count: 1,
            effectiveWeightMultiplier: 1,
            candidateIds: ["adapter_candidate_duplicate_ref"],
          },
        ],
      },
      peftBoundary: {
        storesRawFacts: false,
      },
    }, null, 2)}\n`)

    const verified = await verifyStockFeedbackArtifacts({ projectPath: tmpRoot })
    expect(verified.status).toBe("failed")
    expect(verified.issues.map((item) => item.code)).toEqual(expect.arrayContaining([
      "lora_ready_manifest_duplicate_candidate_ref",
    ]))
  })

  it("fails verify when adapter batch routes one candidate into multiple buckets", async () => {
    await write(path.join(tmpRoot, ".llm-wiki/stock-feedback/exports/lora-ready-multi-bucket-ref.jsonl"), `${JSON.stringify({
      schema: "stock-feedback-adapter-candidate-v1",
      id: "adapter_candidate_multi_bucket_ref",
      sourceKind: "stock-feedback-trajectory",
      sourceTrajectoryId: "stockfb_multi_bucket_ref",
      validationTarget: "expectation_trade",
      qualityGateStatus: "expectation_validated",
      adapterCapability: "expectation_trade_judgment",
      trainingWeightDecision: {
        state: "human_approved_upweight",
        effectiveWeightMultiplier: 1,
      },
      reviewSignal: {
        reviewed: true,
        latestAction: "approve_for_adapter",
      },
      decisionPolicy: {
        keepFactsInRetrieval: true,
        adapterDoesNotStore: "raw_facts_announcements_financial_reports_or_trade_data",
      },
    })}\n`)
    await write(path.join(tmpRoot, ".llm-wiki/stock-feedback/exports/lora-ready-multi-bucket-ref.manifest.json"), `${JSON.stringify({
      schema: "stock-feedback-lora-ready-manifest-v1",
      generatedAt: "2026-06-20 16:39:40",
      projectPath: tmpRoot,
      count: 1,
      candidateRefs: [
        {
          id: "adapter_candidate_multi_bucket_ref",
          sourceTrajectoryId: "stockfb_multi_bucket_ref",
          adapterCapability: "expectation_trade_judgment",
          validationTarget: "expectation_trade",
          qualityGateStatus: "expectation_validated",
          profitOutcome: "unknown",
          sourceKind: "stock-feedback-trajectory",
          reviewed: true,
          trainingWeightState: "human_approved_upweight",
          effectiveWeightMultiplier: 1,
        },
      ],
      adapterBatchRecipe: {
        schema: "stock-feedback-adapter-batch-recipe-v1",
        totalCandidates: 1,
        weightedCandidateCount: 1,
        buckets: [
          {
            id: "human_approved_upweight",
            count: 1,
            effectiveWeightMultiplier: 1,
            candidateIds: ["adapter_candidate_multi_bucket_ref"],
          },
          {
            id: "evidence_gap_downweight",
            count: 1,
            effectiveWeightMultiplier: 0.25,
            candidateIds: ["adapter_candidate_multi_bucket_ref"],
          },
        ],
      },
      peftBoundary: {
        storesRawFacts: false,
      },
    }, null, 2)}\n`)

    const verified = await verifyStockFeedbackArtifacts({ projectPath: tmpRoot })
    expect(verified.status).toBe("failed")
    expect(verified.issues.map((item) => item.code)).toEqual(expect.arrayContaining([
      "lora_ready_adapter_batch_candidate_duplicate_bucket_ref",
    ]))
  })

  it("fails verify when adapter batch omits a manifest candidate from all buckets", async () => {
    const firstRecord = {
      schema: "stock-feedback-adapter-candidate-v1",
      id: "adapter_candidate_bucket_covered",
      sourceKind: "stock-feedback-trajectory",
      sourceTrajectoryId: "stockfb_bucket_covered",
      validationTarget: "expectation_trade",
      qualityGateStatus: "expectation_validated",
      adapterCapability: "expectation_trade_judgment",
      trainingWeightDecision: {
        state: "human_approved_upweight",
        effectiveWeightMultiplier: 1,
      },
      reviewSignal: {
        reviewed: true,
        latestAction: "approve_for_adapter",
      },
      decisionPolicy: {
        keepFactsInRetrieval: true,
        adapterDoesNotStore: "raw_facts_announcements_financial_reports_or_trade_data",
      },
    }
    const omittedRecord = {
      ...firstRecord,
      id: "adapter_candidate_bucket_omitted",
      sourceTrajectoryId: "stockfb_bucket_omitted",
    }
    await write(path.join(tmpRoot, ".llm-wiki/stock-feedback/exports/lora-ready-missing-bucket-ref.jsonl"), [
      JSON.stringify(firstRecord),
      JSON.stringify(omittedRecord),
      "",
    ].join("\n"))
    await write(path.join(tmpRoot, ".llm-wiki/stock-feedback/exports/lora-ready-missing-bucket-ref.manifest.json"), `${JSON.stringify({
      schema: "stock-feedback-lora-ready-manifest-v1",
      generatedAt: "2026-06-20 16:39:42",
      projectPath: tmpRoot,
      count: 2,
      candidateRefs: [
        {
          id: "adapter_candidate_bucket_covered",
          sourceTrajectoryId: "stockfb_bucket_covered",
          adapterCapability: "expectation_trade_judgment",
          validationTarget: "expectation_trade",
          qualityGateStatus: "expectation_validated",
          profitOutcome: "unknown",
          sourceKind: "stock-feedback-trajectory",
          reviewed: true,
          trainingWeightState: "human_approved_upweight",
          effectiveWeightMultiplier: 1,
        },
        {
          id: "adapter_candidate_bucket_omitted",
          sourceTrajectoryId: "stockfb_bucket_omitted",
          adapterCapability: "expectation_trade_judgment",
          validationTarget: "expectation_trade",
          qualityGateStatus: "expectation_validated",
          profitOutcome: "unknown",
          sourceKind: "stock-feedback-trajectory",
          reviewed: true,
          trainingWeightState: "human_approved_upweight",
          effectiveWeightMultiplier: 1,
        },
      ],
      adapterBatchRecipe: {
        schema: "stock-feedback-adapter-batch-recipe-v1",
        totalCandidates: 2,
        weightedCandidateCount: 2,
        buckets: [
          {
            id: "human_approved_upweight",
            count: 1,
            effectiveWeightMultiplier: 1,
            candidateIds: ["adapter_candidate_bucket_covered"],
          },
        ],
      },
      peftBoundary: {
        storesRawFacts: false,
      },
    }, null, 2)}\n`)

    const verified = await verifyStockFeedbackArtifacts({ projectPath: tmpRoot })
    expect(verified.status).toBe("failed")
    expect(verified.issues.map((item) => item.code)).toEqual(expect.arrayContaining([
      "lora_ready_adapter_batch_candidate_missing_bucket_ref",
    ]))
  })

  it("fails verify when adapter batch buckets reference candidates outside the manifest", async () => {
    await write(path.join(tmpRoot, ".llm-wiki/stock-feedback/exports/lora-ready-bucket-orphan.jsonl"), `${JSON.stringify({
      schema: "stock-feedback-adapter-candidate-v1",
      id: "adapter_candidate_manifest_ref",
      sourceKind: "stock-feedback-trajectory",
      sourceTrajectoryId: "stockfb_manifest_ref",
      validationTarget: "expectation_trade",
      qualityGateStatus: "expectation_validated",
      adapterCapability: "expectation_trade_judgment",
      trainingWeightDecision: {
        state: "human_approved_upweight",
        effectiveWeightMultiplier: 1,
      },
      reviewSignal: {
        reviewed: true,
        latestAction: "approve_for_adapter",
      },
      decisionPolicy: {
        keepFactsInRetrieval: true,
        adapterDoesNotStore: "raw_facts_announcements_financial_reports_or_trade_data",
      },
    })}\n`)
    await write(path.join(tmpRoot, ".llm-wiki/stock-feedback/exports/lora-ready-bucket-orphan.manifest.json"), `${JSON.stringify({
      schema: "stock-feedback-lora-ready-manifest-v1",
      generatedAt: "2026-06-20 16:39:30",
      projectPath: tmpRoot,
      count: 1,
      candidateRefs: [
        {
          id: "adapter_candidate_manifest_ref",
          sourceTrajectoryId: "stockfb_manifest_ref",
          adapterCapability: "expectation_trade_judgment",
          validationTarget: "expectation_trade",
          qualityGateStatus: "expectation_validated",
          profitOutcome: "unknown",
          sourceKind: "stock-feedback-trajectory",
          reviewed: true,
          trainingWeightState: "human_approved_upweight",
          effectiveWeightMultiplier: 1,
        },
      ],
      adapterBatchRecipe: {
        schema: "stock-feedback-adapter-batch-recipe-v1",
        totalCandidates: 1,
        weightedCandidateCount: 1,
        buckets: [
          {
            id: "human_approved_upweight",
            count: 1,
            effectiveWeightMultiplier: 1,
            candidateIds: ["adapter_candidate_bucket_orphan"],
          },
        ],
      },
      peftBoundary: {
        storesRawFacts: false,
      },
    }, null, 2)}\n`)

    const verified = await verifyStockFeedbackArtifacts({ projectPath: tmpRoot })
    expect(verified.status).toBe("failed")
    expect(verified.issues.map((item) => item.code)).toEqual(expect.arrayContaining([
      "lora_ready_adapter_batch_candidate_missing_manifest_ref",
    ]))
  })

  it("fails verify when adapter batch candidate refs disagree with top-level manifest refs", async () => {
    await write(path.join(tmpRoot, ".llm-wiki/stock-feedback/exports/lora-ready-bucket-ref-mismatch.jsonl"), `${JSON.stringify({
      schema: "stock-feedback-adapter-candidate-v1",
      id: "adapter_candidate_bucket_ref_mismatch",
      sourceKind: "stock-feedback-paper-trade",
      references: {
        paperTradeId: "paper_trade_manifest_ref",
      },
      sourceTrajectoryId: "stockfb_bucket_ref_mismatch",
      validationTarget: "expectation_trade",
      qualityGateStatus: "review_required",
      adapterCapability: "paper_trade_execution_judgment",
      paperTradeState: {
        ledgerKind: "paper_trade",
        status: "closed",
      },
      profitFeedback: {
        outcome: "profitable",
        realizedPnlPct: 4.8,
        maxDrawdownPct: 1.2,
        holdingDays: 3,
      },
      trainingWeightDecision: {
        state: "human_approved_paper_adapter_low_weight",
        effectiveWeightMultiplier: 0.35,
      },
      reviewSignal: {
        reviewed: true,
        latestAction: "approve_paper_adapter_candidate",
      },
      peftBoundary: {
        storesRawFacts: false,
      },
    })}\n`)
    await write(path.join(tmpRoot, ".llm-wiki/stock-feedback/exports/lora-ready-bucket-ref-mismatch.manifest.json"), `${JSON.stringify({
      schema: "stock-feedback-lora-ready-manifest-v1",
      generatedAt: "2026-06-20 16:39:45",
      projectPath: tmpRoot,
      count: 1,
      candidateRefs: [
        {
          id: "adapter_candidate_bucket_ref_mismatch",
          sourceTrajectoryId: "stockfb_bucket_ref_mismatch",
          adapterCapability: "paper_trade_execution_judgment",
          validationTarget: "expectation_trade",
          qualityGateStatus: "review_required",
          profitOutcome: "profitable",
          sourceKind: "stock-feedback-paper-trade",
          paperTradeId: "paper_trade_manifest_ref",
          paperTradeStatus: "closed",
          ledgerKind: "paper_trade",
          realizedPnlPct: 4.8,
          maxDrawdownPct: 1.2,
          holdingDays: 3,
          reviewed: true,
          trainingWeightState: "human_approved_paper_adapter_low_weight",
          effectiveWeightMultiplier: 0.35,
        },
      ],
      adapterBatchRecipe: {
        schema: "stock-feedback-adapter-batch-recipe-v1",
        totalCandidates: 1,
        weightedCandidateCount: 1,
        buckets: [
          {
            id: "human_approved_paper_adapter_low_weight",
            count: 1,
            effectiveWeightMultiplier: 0.35,
            candidateRefs: [
              {
                id: "adapter_candidate_bucket_ref_mismatch",
                sourceKind: "stock-feedback-paper-trade",
                paperTradeId: "paper_trade_bucket_mismatch",
                paperTradeStatus: "closed",
                ledgerKind: "paper_trade",
                profitOutcome: "profitable",
                realizedPnlPct: 4.8,
                maxDrawdownPct: 1.2,
                holdingDays: 3,
                reviewed: true,
                trainingWeightState: "human_approved_paper_adapter_low_weight",
                effectiveWeightMultiplier: 0.35,
              },
            ],
          },
        ],
      },
      peftBoundary: {
        storesRawFacts: false,
      },
    }, null, 2)}\n`)

    const verified = await verifyStockFeedbackArtifacts({ projectPath: tmpRoot })
    expect(verified.status).toBe("failed")
    expect(verified.issues.map((item) => item.code)).toEqual(expect.arrayContaining([
      "lora_ready_adapter_batch_candidate_ref_mismatch",
    ]))
  })

  it("fails verify for unsafe discretionary review benchmark cases", async () => {
    await write(path.join(tmpRoot, ".llm-wiki/stock-feedback/benchmark/stock-validation-benchmark-bad-discretionary.jsonl"), `${JSON.stringify({
      schema: "stock-validation-benchmark-v1",
      id: "stockfb_case_bad_discretionary_review",
      generatedAt: "2026-06-20 16:39:00",
      sourceKind: "paper_trade_discretionary_review",
      adapterCapability: "paper_trade_discretionary_review",
      paperTradeId: "paper_trade_llm_without_pair",
      pairedRuleBaselineTradeId: null,
      validationTarget: "expectation_trade",
      qualityGateStatus: "review_required",
      expected: {
        validationTarget: "expectation_trade",
        qualityGateStatus: "review_required",
        highConfidenceEligible: true,
        routeTo: ["adapter"],
        sourceKind: "paper_trade_discretionary_review",
        paperTrade: "open",
        pairedRuleBaselineStatus: "missing",
        evidenceCutoff: { noFutureData: false },
      },
      sourceRefs: [],
    })}\n`)

    const verified = await verifyStockFeedbackArtifacts({ projectPath: tmpRoot })
    expect(verified.status).toBe("failed")
    expect(verified.issues.map((item) => item.code)).toEqual(expect.arrayContaining([
      "benchmark_discretionary_review_high_confidence_enabled",
      "benchmark_discretionary_review_missing_eval_preference_route",
      "benchmark_discretionary_review_direct_adapter_route",
      "benchmark_discretionary_review_missing_paired_rule_baseline",
      "benchmark_discretionary_review_requires_closed_pair",
      "benchmark_discretionary_review_missing_asof_cutoff",
      "benchmark_discretionary_review_missing_source_refs",
    ]))
  })

  it("fails verify for unsafe paper-trade-agent planning benchmark cases", async () => {
    await write(path.join(tmpRoot, ".llm-wiki/stock-feedback/benchmark/stock-validation-benchmark-bad-agent.jsonl"), `${JSON.stringify({
      schema: "stock-validation-benchmark-v1",
      id: "stockfb_case_bad_paper_trade_agent",
      generatedAt: "2026-06-20 16:40:00",
      sourceKind: "paper_trade_agent_candidate",
      adapterCapability: "paper_trade_agent_planning",
      paperTradeAgentCandidateId: null,
      validationTarget: "expectation_trade",
      qualityGateStatus: "review_required",
      expected: {
        validationTarget: "expectation_trade",
        qualityGateStatus: "review_required",
        highConfidenceEligible: true,
        routeTo: ["adapter"],
        profitOutcome: "profitable",
        sourceKind: "paper_trade_agent_candidate",
        paperTradeAgentTrack: "llm_discretionary",
        paperTradeAgentReadiness: "ready",
        evidenceCutoff: { noFutureData: false },
      },
      sourceRefs: ["paper-trade-agent:bad"],
    })}\n`)

    const verified = await verifyStockFeedbackArtifacts({ projectPath: tmpRoot })
    expect(verified.status).toBe("failed")
    expect(verified.issues.map((item) => item.code)).toEqual(expect.arrayContaining([
      "benchmark_paper_trade_agent_high_confidence_enabled",
      "benchmark_paper_trade_agent_missing_eval_route",
      "benchmark_paper_trade_agent_direct_adapter_route",
      "benchmark_paper_trade_agent_unsettled_profit_outcome",
      "benchmark_paper_trade_agent_missing_candidate_id",
      "benchmark_paper_trade_agent_missing_asof_cutoff",
    ]))
  })

  it("surfaces open paper trades as a read-only settlement queue", async () => {
    const opened = await recordStockFeedbackPaperTrade({
      projectPath: tmpRoot,
      track: "rule_baseline",
      asOfDate: "2026-06-03",
      sourceQuestionId: "question_settlement_queue_001",
      validationTarget: "expectation_trade",
      stockName: "样本科技A",
      stockCode: "SZ300901",
      hypothesis: "低位吸收后观察承接，按规则模拟买入。",
      expectedMove: "3 日内相对强度扩散。",
      entryDate: "2026-06-03",
      entryPrice: "10.00",
      entryTiming: "放量转强首日试错",
      positionSizing: "probe_15pct",
      sourceRefs: "self-question:question_settlement_queue_001,retrieval:sourceRefs#queue",
      evidenceRefs: "price-sql:SZ300901:entry-2026-06-03,tool-state:self-question-attribution",
      generatedAt: "2026-06-20 16:10:00",
      write: true,
    })

    const status = await getStockFeedbackPaperTradeStatus({ projectPath: tmpRoot, limit: 3 })

    expect(status.settlementQueue).toMatchObject({
      schema: "stock-feedback-paper-trade-settlement-queue-v1",
      count: 1,
      nextAction: "settle_open_paper_trades_with_asof_market_evidence",
      writeBoundary: {
        readOnly: true,
        wrotePaperTradeLedger: false,
        wroteRealTradeLedger: false,
      },
    })
    expect(status.settlementQueue.items[0]).toMatchObject({
      id: opened.paperTrade.id,
      status: "open",
      ledgerKind: "paper_trade",
      entry: {
        date: "2026-06-03",
        price: 10,
      },
    })
    expect(status.settlementQueue.items[0].suggestedSettlementCommand).toContain(`--paper-trade-id ${opened.paperTrade.id}`)
    expect(status.settlementQueue.items[0].suggestedSettlementCommand).toContain("--exit-date <exit_date>")
    expect(status.writePolicy).toMatchObject({
      readOnly: true,
      wroteRealTradeLedger: false,
    })

    const flywheelStatus = await getStockFeedbackStatus({ projectPath: tmpRoot })
    expect(flywheelStatus.counts).toMatchObject({
      paperTradeOpen: 1,
      paperTradePendingSettlement: 1,
    })
    expect(flywheelStatus.paperTradeLedger.settlementQueue).toMatchObject({
      count: 1,
      items: [expect.objectContaining({ id: opened.paperTrade.id })],
    })
  })

  it("settles an open paper trade as the latest ledger state and feeds profitable paper execution into trajectories", async () => {
    const opened = await recordStockFeedbackPaperTrade({
      projectPath: tmpRoot,
      track: "rule_baseline",
      asOfDate: "2026-06-03",
      sourceQuestionId: "question_settle_001",
      sourceTrajectoryId: "stockfb_seed_expectation_001",
      validationTarget: "expectation_trade",
      stockName: "样本科技A",
      stockCode: "SZ300901",
      hypothesis: "低位吸收后观察承接，按规则模拟买入。",
      expectedMove: "3 日内相对强度扩散。",
      entryDate: "2026-06-03",
      entryPrice: "10.00",
      entryTiming: "放量转强首日试错",
      positionSizing: "probe_15pct",
      sourceRefs: "self-question:question_settle_001,retrieval:sourceRefs#settle",
      evidenceRefs: "price-sql:SZ300901:entry-2026-06-03,tool-state:self-question-attribution",
      generatedAt: "2026-06-20 16:00:00",
      write: true,
    })

    const settled = await settleStockFeedbackPaperTrade({
      projectPath: tmpRoot,
      paperTradeId: opened.paperTrade.id,
      exitDate: "2026-06-06",
      exitPrice: "10.80",
      maxDrawdownPct: "1.2",
      holdingDays: "3",
      exitTiming: "3 日承接兑现后分批止盈",
      exitReason: "规则目标达到，避免后手拥挤",
      evidenceRefs: "price-sql:SZ300901:exit-2026-06-06,trade-ledger:paper-settlement",
      generatedAt: "2026-06-20 16:05:00",
      write: true,
    })

    expect(settled).toMatchObject({
      schema: "stock-feedback-paper-trade-settlement-result-v1",
      dryRun: false,
      artifactRefreshPlan: {
        schema: "stock-feedback-paper-trade-settlement-refresh-plan-v1",
        status: "needs_refresh_after_settlement",
        paperTradeId: opened.paperTrade.id,
        staleArtifacts: ["trajectories", "benchmark", "lora_ready"],
        reviewGate: {
          paperTradeRequiresHumanReview: true,
          loraReadyRefreshBlockedUntilReview: true,
        },
        stages: expect.arrayContaining([
          expect.objectContaining({
            id: "rebuild_trajectories",
            command: "stock-feedback build-trajectories --write",
          }),
          expect.objectContaining({
            id: "build_benchmark",
            command: "stock-feedback bench --write",
          }),
          expect.objectContaining({
            id: "refresh_lora_ready",
            command: "stock-feedback export-lora-ready --write",
            status: "blocked_until_human_review",
          }),
        ]),
      },
      paperTrade: {
        id: opened.paperTrade.id,
        status: "closed",
        settlement: {
          action: "close",
          previousStatus: "open",
        },
        exit: {
          date: "2026-06-06",
          price: 10.8,
          timing: "3 日承接兑现后分批止盈",
          reason: "规则目标达到，避免后手拥挤",
        },
        profitFeedback: {
          outcome: "profitable",
          realizedPnlPct: 8,
          maxDrawdownPct: 1.2,
          holdingDays: 3,
          executionEvidenceClass: "paper_pattern_execution_supported",
        },
      },
    })
    expect(settled.manifest.artifactRefreshPlan).toMatchObject({
      paperTradeId: opened.paperTrade.id,
      writeBoundary: {
        wroteWiki: false,
        wroteRaw: false,
        wroteRealTradeLedger: false,
      },
    })

    const status = await getStockFeedbackPaperTradeStatus({ projectPath: tmpRoot })
    expect(status.counts).toMatchObject({
      total: 1,
      open: 0,
      closed: 1,
      profitable: 1,
    })
    expect(status.recentPaperTrades[0]).toMatchObject({
      id: opened.paperTrade.id,
      status: "closed",
      profitFeedback: expect.objectContaining({
        outcome: "profitable",
        realizedPnlPct: 8,
      }),
    })

    const built = await buildStockFeedbackTrajectories({
      projectPath: tmpRoot,
      generatedAt: "2026-06-20 16:06:00",
    })
    const trajectory = built.trajectories.find((item) => item.sourceRecordId === opened.paperTrade.id)
    expect(trajectory).toMatchObject({
      source: "stock-feedback-paper-trade",
      routing: {
        eval: true,
        adapterCandidate: true,
      },
      paperTradeState: expect.objectContaining({
        status: "closed",
        executionEvidenceClass: "paper_pattern_execution_supported",
      }),
      profitFeedback: expect.objectContaining({
        executionMode: "paper",
        ledgerKind: "paper_trade",
        outcome: "profitable",
        realizedPnlPct: 8,
        maxDrawdownPct: 1.2,
        holdingDays: 3,
        executionEvidenceClass: "paper_pattern_execution_supported",
      }),
    })

    const verified = await verifyStockFeedbackArtifacts({ projectPath: tmpRoot })
    expect(verified.status).toBe("ok")
    expect(verified.checked.paperTrades).toBe(1)

    const statusAfterSettlement = await getStockFeedbackStatus({ projectPath: tmpRoot })
    expect(statusAfterSettlement.counts).toMatchObject({
      paperTradeSettlementRefreshPending: 1,
    })
    expect(statusAfterSettlement.paperTradeLedger.settlementRefreshAudit).toMatchObject({
      schema: "stock-feedback-paper-trade-settlement-refresh-audit-v1",
      count: 1,
      pending: 1,
      items: [
        expect.objectContaining({
          paperTradeId: opened.paperTrade.id,
          trajectoryId: trajectory.id,
          trajectoryStatus: "covered",
          benchmarkStatus: "missing",
          reviewStatus: "pending",
          loraReadyStatus: "blocked_until_human_review",
          nextAction: "build_benchmark",
        }),
      ],
    })

    await buildStockFeedbackBenchmark({
      projectPath: tmpRoot,
      generatedAt: "2026-06-20 16:07:00",
      write: true,
    })
    const statusAfterBenchmark = await getStockFeedbackStatus({ projectPath: tmpRoot })
    expect(statusAfterBenchmark.paperTradeLedger.settlementRefreshAudit.items[0]).toMatchObject({
      paperTradeId: opened.paperTrade.id,
      benchmarkStatus: "covered",
      reviewStatus: "pending",
      nextAction: "review_paper_trade",
    })
  })

  it("requires human paper approval before exporting profitable paper trades as low-weight adapter candidates", async () => {
    const opened = await recordStockFeedbackPaperTrade({
      projectPath: tmpRoot,
      track: "rule_baseline",
      asOfDate: "2026-06-03",
      sourceQuestionId: "question_paper_adapter_001",
      validationTarget: "expectation_trade",
      stockName: "样本科技A",
      stockCode: "SZ300901",
      hypothesis: "低位吸收后，按承接规则模拟买入。",
      expectedMove: "3 日内相对强度扩散。",
      entryDate: "2026-06-03",
      entryPrice: "10.00",
      entryTiming: "低位吸收后放量转强首日试错",
      positionSizing: "probe_15pct",
      sourceRefs: "self-question:question_paper_adapter_001,retrieval:sourceRefs#paper-adapter",
      evidenceRefs: "price-sql:SZ300901:entry-2026-06-03,tool-state:self-question-attribution",
      generatedAt: "2026-06-20 16:20:00",
      write: true,
    })
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
      generatedAt: "2026-06-20 16:25:00",
      write: true,
    })
    const built = await buildStockFeedbackTrajectories({
      projectPath: tmpRoot,
      generatedAt: "2026-06-20 16:26:00",
      write: true,
    })
    const trajectory = built.trajectories.find((item) => item.sourceRecordId === opened.paperTrade.id)
    expect(trajectory).toMatchObject({
      qualityGate: expect.objectContaining({
        status: "review_required",
        highConfidenceEligible: false,
      }),
      routing: expect.objectContaining({
        adapterCandidate: true,
      }),
      profitFeedback: expect.objectContaining({
        outcome: "profitable",
        ledgerKind: "paper_trade",
        executionEvidenceClass: "paper_pattern_execution_supported",
      }),
    })

    const reviewQueue = await listStockFeedbackReviewQueue({ projectPath: tmpRoot, includeReviewed: false })
    const reviewItem = reviewQueue.items.find((item) => item.sourceTrajectoryId === trajectory.id)
    expect(reviewItem).toMatchObject({
      recommendedAction: "approve_paper_adapter_candidate",
      recommendedActionLabel: "人审 paper adapter 正样本",
      humanActionPlan: expect.objectContaining({
        recommendedAction: "approve_paper_adapter_candidate",
        actionOptions: expect.arrayContaining([
          expect.objectContaining({
            action: "approve_paper_adapter_candidate",
            enabled: true,
            preview: expect.objectContaining({
              routing: expect.objectContaining({
                eval: true,
                adapterCandidate: true,
              }),
              trainingWeightDecision: expect.objectContaining({
                state: "human_approved_paper_adapter_low_weight",
                effectiveWeightMultiplier: 0.35,
              }),
            }),
          }),
        ]),
      }),
    })

    const beforeReview = await exportStockFeedbackLoraReady({
      projectPath: tmpRoot,
      generatedAt: "2026-06-20 16:27:00",
    })
    expect(beforeReview.candidates.some((item) => item.sourceKind === "stock-feedback-paper-trade")).toBe(false)

    const review = await reviewStockFeedbackTrajectory({
      projectPath: tmpRoot,
      trajectoryId: trajectory.id,
      action: "approve_paper_adapter_candidate",
      reviewer: "paper-adapter-test",
      note: "人审确认只作为模拟收益低权重 adapter 候选，真实事实继续留在 sourceRefs / price SQL / paper ledger。",
      generatedAt: "2026-06-20 16:28:00",
      write: true,
    })
    expect(review.reviewEvent).toMatchObject({
      action: "approve_paper_adapter_candidate",
      result: "paper_approved",
      routingDecision: expect.objectContaining({
        eval: true,
        sft: false,
        adapterCandidate: true,
      }),
      trainingWeightDecision: expect.objectContaining({
        state: "human_approved_paper_adapter_low_weight",
        defaultWeightMultiplier: 0.35,
        effectiveWeightMultiplier: 0.35,
        allowWeightUpAfterReview: false,
      }),
    })

    await buildStockFeedbackBenchmark({
      projectPath: tmpRoot,
      generatedAt: "2026-06-20 16:28:30",
      write: true,
    })

    const afterReview = await exportStockFeedbackLoraReady({
      projectPath: tmpRoot,
      generatedAt: "2026-06-20 16:29:00",
      write: true,
    })
    const paperCandidate = afterReview.candidates.find((item) => item.sourceKind === "stock-feedback-paper-trade")
    expect(paperCandidate).toMatchObject({
      sourceKind: "stock-feedback-paper-trade",
      sourceTrajectoryId: trajectory.id,
      paperTradeState: expect.objectContaining({
        ledgerKind: "paper_trade",
        status: "closed",
      }),
      reviewSignal: expect.objectContaining({
        latestAction: "approve_paper_adapter_candidate",
      }),
      trainingWeightDecision: expect.objectContaining({
        state: "human_approved_paper_adapter_low_weight",
        effectiveWeightMultiplier: 0.35,
      }),
      decisionPolicy: expect.objectContaining({
        keepFactsInRetrieval: true,
        adapterDoesNotStore: "raw_facts_announcements_financial_reports_or_trade_data",
      }),
    })
    expect(afterReview.manifest).toMatchObject({
      sourceKindCounts: expect.objectContaining({
        "stock-feedback-paper-trade": 1,
      }),
      trainingWeightDecisionCounts: expect.objectContaining({
        human_approved_paper_adapter_low_weight: 1,
      }),
      adapterCurriculum: expect.objectContaining({
        counts: expect.objectContaining({
          paperApprovedCandidates: 1,
          reviewedPaperLowWeightCandidates: 1,
        }),
      }),
      candidateRefs: expect.arrayContaining([
        expect.objectContaining({
          sourceTrajectoryId: trajectory.id,
          paperTradeId: opened.paperTrade.id,
          sourceKind: "stock-feedback-paper-trade",
          paperTradeStatus: "closed",
          ledgerKind: "paper_trade",
          profitOutcome: "profitable",
          realizedPnlPct: 8,
          maxDrawdownPct: 1.2,
          holdingDays: 3,
          trainingWeightState: "human_approved_paper_adapter_low_weight",
        }),
      ]),
    })
    expect(afterReview.adapterBatchRecipe).toMatchObject({
      buckets: expect.arrayContaining([
        expect.objectContaining({
          id: "human_approved_paper_adapter_low_weight",
          effectiveWeightMultiplier: 0.35,
          selectionUse: expect.arrayContaining(["adapter_candidate_pool"]),
        }),
      ]),
    })
    const verified = await verifyStockFeedbackArtifacts({ projectPath: tmpRoot })
    expect(verified.status).toBe("ok")
    const completedStatus = await getStockFeedbackStatus({ projectPath: tmpRoot })
    expect(completedStatus.counts).toMatchObject({
      paperTradeSettlementRefreshPending: 0,
    })
    expect(completedStatus.paperTradeLedger.settlementRefreshAudit).toMatchObject({
      count: 1,
      pending: 0,
      completed: 1,
      nextAction: "no_settled_paper_trade_refresh_pending",
      items: [
        expect.objectContaining({
          paperTradeId: opened.paperTrade.id,
          trajectoryId: trajectory.id,
          benchmarkStatus: "covered",
          reviewStatus: "reviewed",
          latestReviewAction: "approve_paper_adapter_candidate",
          loraReadyStatus: "covered",
          nextAction: "verify_complete",
          refreshComplete: true,
        }),
      ],
    })
    expect(JSON.stringify(afterReview)).not.toContain("trade-ledger:real")
    expect(JSON.stringify(afterReview)).not.toContain("price,volume")
  })

  it("uses the lookahead end date for open Tushare market evidence", async () => {
    const tushareCalls = []
    const tushareClient = async ({ apiName, params }) => {
      tushareCalls.push({ apiName, params })
      if (apiName === "daily") {
        return {
          code: 0,
          msg: "",
          data: {
            fields: ["ts_code", "trade_date", "open", "high", "low", "close", "pct_chg", "vol", "amount"],
            items: [
              ["300901.SZ", "20260610", 10.6, 10.9, 10.3, 10.8, 1.89, 130000, 140000],
              ["300901.SZ", "20260603", 9.95, 10.08, 9.9, 10.0, 1.0, 80000, 82000],
            ],
          },
        }
      }
      if (apiName === "daily_basic") {
        return {
          code: 0,
          msg: "",
          data: {
            fields: ["ts_code", "trade_date", "turnover_rate", "turnover_rate_f", "volume_ratio", "total_mv", "circ_mv"],
            items: [
              ["300901.SZ", "20260610", 1.8, 2.0, 1.5, 1000000, 900000],
              ["300901.SZ", "20260603", 0.9, 1.0, 1.0, 930000, 830000],
            ],
          },
        }
      }
      return { code: 0, msg: "", data: { fields: [], items: [] } }
    }

    const preview = await recordStockFeedbackPaperTrade({
      projectPath: tmpRoot,
      track: "rule_baseline",
      asOfDate: "2026-06-03",
      validationTarget: "expectation_trade",
      stockCode: "SZ300901",
      entryDate: "2026-06-03",
      entryPrice: "10.00",
      sourceRefs: "self-question:question_asof_001",
      autoMarketEvidence: true,
      marketEvidenceProvider: "tushare",
      marketEvidenceBenchmarkCode: "none",
      tushareToken: "fake-tushare-test-token",
      tushareClient,
      generatedAt: "2026-06-20 19:46:00",
    })

    expect(preview.marketEvidenceStatus).toBe("ok")
    expect(tushareCalls).toEqual(expect.arrayContaining([
      expect.objectContaining({
        apiName: "daily",
        params: expect.objectContaining({ start_date: "20260603", end_date: "20260610" }),
      }),
      expect.objectContaining({
        apiName: "daily_basic",
        params: expect.objectContaining({ start_date: "20260603", end_date: "20260610" }),
      }),
    ]))
    expect(preview.paperTrade.marketEvidence).toMatchObject({
      priceSqlRef: "tushare:daily#300901.SZ/20260610",
      marketDataRef: "tushare:daily+daily_basic:300901.SZ:2026-06-03..2026-06-10",
      endDate: "2026-06-10",
      rows: 2,
    })
    expect(preview.marketEvidenceNativeQuery.summary).toContain("20260603..20260610")
    expect(JSON.stringify(preview)).not.toContain("fake-tushare-test-token")
  })

  it("blocks paper-trade writes when automatic market evidence exceeds the requested window", async () => {
    const tushareClient = async ({ apiName }) => {
      if (apiName === "daily") {
        return {
          code: 0,
          msg: "",
          data: {
            fields: ["ts_code", "trade_date", "open", "high", "low", "close", "pct_chg", "vol", "amount"],
            items: [
              ["300901.SZ", "20260618", 10.8, 11.5, 10.6, 11.2, 3.7, 180000, 210000],
              ["300901.SZ", "20260603", 9.95, 10.08, 9.9, 10.0, 1.0, 80000, 82000],
            ],
          },
        }
      }
      if (apiName === "daily_basic") {
        return {
          code: 0,
          msg: "",
          data: {
            fields: ["ts_code", "trade_date", "turnover_rate", "turnover_rate_f", "volume_ratio", "total_mv", "circ_mv"],
            items: [
              ["300901.SZ", "20260618", 2.4, 2.6, 1.8, 1100000, 1000000],
              ["300901.SZ", "20260603", 0.9, 1.0, 1.0, 930000, 830000],
            ],
          },
        }
      }
      return { code: 0, msg: "", data: { fields: [], items: [] } }
    }

    const draft = {
      projectPath: tmpRoot,
      track: "rule_baseline",
      asOfDate: "2026-06-03",
      validationTarget: "expectation_trade",
      stockCode: "SZ300901",
      entryDate: "2026-06-03",
      entryPrice: "10.00",
      sourceRefs: "self-question:question_asof_001",
      autoMarketEvidence: true,
      marketEvidenceProvider: "tushare",
      marketEvidenceBenchmarkCode: "none",
      tushareToken: "fake-tushare-test-token",
      tushareClient,
      generatedAt: "2026-06-20 20:08:00",
    }

    const preview = await recordStockFeedbackPaperTrade(draft)

    expect(preview.paperTrade.marketEvidenceWindow).toMatchObject({
      expectedWindow: "2026-06-03..2026-06-10",
      actualWindow: "2026-06-03..2026-06-18",
      exceededExpectedEnd: true,
    })
    expect(preview.autoEvidenceGate).toMatchObject({
      status: "blocked",
      blocksWrite: true,
      checks: expect.arrayContaining([
        expect.objectContaining({
          id: "market_evidence_window",
          provider: "tushare",
          status: "exceeded_expected_end",
          passed: false,
        }),
      ]),
    })

    await expect(recordStockFeedbackPaperTrade({ ...draft, write: true }))
      .rejects
      .toThrow("automatic evidence gate blocked write")

    await expect(fs.access(path.join(tmpRoot, ".llm-wiki", "stock-feedback", "paper-trades")))
      .rejects
      .toThrow()
  })

  it("derives paper-trade market evidence from Tushare daily rows without leaking the token", async () => {
    const tushareCalls = []
    const tushareClient = async ({ apiName, params }) => {
      tushareCalls.push({ apiName, params })
      if (apiName === "daily") {
        return {
          code: 0,
          msg: "",
          data: {
            fields: ["ts_code", "trade_date", "open", "high", "low", "close", "pct_chg", "vol", "amount"],
            items: [
              ["300901.SZ", "20260606", 10.55, 10.9, 10.6, 10.8, 2.86, 130000, 140000],
              ["300901.SZ", "20260605", 10.25, 10.55, 10.2, 10.5, 2.94, 110000, 120000],
              ["300901.SZ", "20260604", 10.05, 10.3, 9.84, 10.2, 2.0, 100000, 105000],
              ["300901.SZ", "20260603", 9.95, 10.08, 9.9, 10.0, 1.0, 80000, 82000],
            ],
          },
        }
      }
      if (apiName === "daily_basic") {
        return {
          code: 0,
          msg: "",
          data: {
            fields: ["ts_code", "trade_date", "turnover_rate", "turnover_rate_f", "volume_ratio", "total_mv", "circ_mv"],
            items: [
              ["300901.SZ", "20260606", 1.8, 2.0, 1.5, 1000000, 900000],
              ["300901.SZ", "20260605", 1.4, 1.6, 1.3, 980000, 880000],
              ["300901.SZ", "20260604", 1.1, 1.2, 1.1, 950000, 850000],
              ["300901.SZ", "20260603", 0.9, 1.0, 1.0, 930000, 830000],
            ],
          },
        }
      }
      if (apiName === "index_daily") {
        return {
          code: 0,
          msg: "",
          data: {
            fields: ["ts_code", "trade_date", "open", "high", "low", "close", "pct_chg", "vol", "amount"],
            items: [
              ["000001.SH", "20260606", 101, 102.5, 101, 102, 1.0, 500000, 600000],
              ["000001.SH", "20260605", 100, 101.5, 99.5, 101, 1.0, 480000, 580000],
              ["000001.SH", "20260604", 99.8, 100.5, 99.2, 100, 0.0, 450000, 560000],
              ["000001.SH", "20260603", 99.5, 100.2, 99.2, 100, 0.2, 430000, 540000],
            ],
          },
        }
      }
      if (apiName === "limit_list_d") {
        return {
          code: 0,
          msg: "",
          data: {
            fields: ["trade_date", "ts_code", "name", "industry", "close", "pct_chg", "amount", "limit_amount", "fd_amount", "first_time", "last_time", "open_times", "up_stat", "limit_times"],
            items: [["20260604", "300901.SZ", "样本科技A", "专用设备", 10, 20, 82000, 1200, 800, "093100", "143000", 0, "1/1", 1]],
          },
        }
      }
      if (apiName === "limit_step") {
        return {
          code: 0,
          msg: "",
          data: {
            fields: ["ts_code", "name", "trade_date", "nums"],
            items: [["300901.SZ", "样本科技A", "20260604", "3"]],
          },
        }
      }
      if (apiName === "top_list") {
        return {
          code: 0,
          msg: "",
          data: {
            fields: ["trade_date", "ts_code", "name", "close", "pct_change", "turnover_rate", "amount", "l_sell", "l_buy", "l_amount", "net_amount", "reason"],
            items: [["20260604", "300901.SZ", "样本科技A", 10, 20, 18, 82000, 1200, 3600, 4800, 2400, "日涨幅达到15%的证券"]],
          },
        }
      }
      if (apiName === "top_inst") {
        return {
          code: 0,
          msg: "",
          data: {
            fields: ["trade_date", "ts_code", "exalter", "buy", "buy_rate", "sell", "sell_rate", "net_buy"],
            items: [["20260604", "300901.SZ", "机构专用", 2000, 10, 500, 2, 1500]],
          },
        }
      }
      if (apiName === "hm_detail") {
        return {
          code: 0,
          msg: "",
          data: {
            fields: ["trade_date", "ts_code", "ts_name", "hm_name", "buy_amount", "sell_amount", "net_amount"],
            items: [["20260604", "300901.SZ", "样本科技A", "量化打板", 1800, 600, 1200]],
          },
        }
      }
      if (apiName === "ths_hot") {
        return {
          code: 0,
          msg: "",
          data: {
            fields: ["trade_date", "ts_code", "ts_name", "rank", "pct_change", "current_price", "concept"],
            items: [["20260604", "300901.SZ", "样本科技A", 12, 20, 10, "机器人;高端装备"]],
          },
        }
      }
      if (apiName === "dc_hot") {
        return {
          code: 0,
          msg: "",
          data: {
            fields: ["trade_date", "ts_code", "ts_name", "rank", "pct_change", "current_price"],
            items: [["20260604", "300901.SZ", "样本科技A", 35, 20, 10]],
          },
        }
      }
      return { code: 0, msg: "", data: { fields: [], items: [] } }
    }

    const written = await recordStockFeedbackPaperTrade({
      projectPath: tmpRoot,
      track: "rule_baseline",
      asOfDate: "2026-06-03",
      validationTarget: "expectation_trade",
      stockCode: "SZ300901",
      hypothesis: "只使用 asOfDate 前的预期扩散证据做模拟买入。",
      entryDate: "2026-06-03",
      entryPrice: "10.00",
      exitDate: "2026-06-06",
      exitPrice: "10.80",
      sourceRefs: "self-question:question_asof_001",
      autoMarketEvidence: true,
      autoMicrostructureEvidence: true,
      microstructureDate: "2026-06-04",
      marketEvidenceProvider: "tushare",
      marketEvidenceBenchmarkCode: "000001.SH",
      tushareToken: "fake-tushare-test-token",
      tushareClient,
      generatedAt: "2026-06-20 16:03:00",
      write: true,
    })

    expect(written.marketEvidenceStatus).toBe("ok")
    expect(written.paperTrade.marketEvidence).toMatchObject({
      source: "tushare_http",
      priceSqlRef: "tushare:daily#300901.SZ/20260606",
      marketDataRef: "tushare:daily+daily_basic:300901.SZ:2026-06-03..2026-06-06",
      benchmarkCode: "000001.SH",
      benchmarkRef: "tushare:index_daily#000001.SH/20260606",
      benchmarkReturnPct: 2,
      relativeStrength: 6,
      relativeStrengthBasis: "excess_return_pct_vs_000001.SH",
      followThrough3d: 8,
      maxDrawdownInHolding: 1.6,
      turnoverChange: 2,
    })
    expect(written.paperTrade.evidenceRefs).toEqual(expect.arrayContaining([
      "tushare:daily#300901.SZ/20260606",
      "tushare:daily+daily_basic:300901.SZ:2026-06-03..2026-06-06",
      "tushare:index_daily#000001.SH/20260606",
      "tushare:limit_list_d#300901.SZ/20260604",
      "tushare:limit_step#300901.SZ/20260604",
      "tushare:top_list#300901.SZ/20260604",
      "tushare:top_inst#300901.SZ/20260604",
      "tushare:hm_detail#300901.SZ/20260604",
      "tushare:ths_hot#300901.SZ/20260604",
      "tushare:dc_hot#300901.SZ/20260604",
    ]))
    expect(written.paperTrade.marketMicrostructureEvidence).toMatchObject({
      source: "tushare_http",
      tradeDate: "2026-06-04",
      limitListRef: "tushare:limit_list_d#300901.SZ/20260604",
      limitStepRef: "tushare:limit_step#300901.SZ/20260604",
      topListRef: "tushare:top_list#300901.SZ/20260604",
      thsHotRef: "tushare:ths_hot#300901.SZ/20260604",
      dcHotRef: "tushare:dc_hot#300901.SZ/20260604",
      limit: expect.objectContaining({ openTimes: 0, upStat: "1/1" }),
      limitStep: expect.objectContaining({ consecutiveBoards: 3 }),
      dragonTiger: expect.objectContaining({ netAmount: 2400 }),
      institution: expect.objectContaining({ netAmount: 1500 }),
      hotMoney: expect.objectContaining({ netAmount: 1200 }),
      heat: expect.objectContaining({ thsRank: 12, thsConcept: "机器人;高端装备", dcRank: 35 }),
      signals: expect.arrayContaining(["limit_list:matched", "limit_step:matched", "risk:high_board_relay", "dragon_tiger:matched", "institution:net_buy", "hot_money:net_buy", "ths_hot:matched", "dc_hot:matched", "heat:crowded_top50"]),
    })
    for (const apiName of ["limit_list_d", "limit_step", "top_list", "top_inst", "hm_detail", "ths_hot", "dc_hot"]) {
      expect(tushareCalls).toContainEqual(expect.objectContaining({
        apiName,
        params: expect.objectContaining({ trade_date: "20260604" }),
      }))
    }
    expect(JSON.stringify(written)).not.toContain("fake-tushare-test-token")

    const status = await getStockFeedbackPaperTradeStatus({ projectPath: tmpRoot, limit: 3 })
    expect(status.recentPaperTrades[0]?.marketEvidenceWindow).toMatchObject({
      expectedWindow: "2026-06-03..2026-06-06",
      actualWindow: "2026-06-03..2026-06-06",
      exceededExpectedEnd: false,
    })

    const built = await buildStockFeedbackTrajectories({
      projectPath: tmpRoot,
      generatedAt: "2026-06-20 16:04:00",
    })
    const trajectory = built.trajectories.find((item) => item.sourceRecordId === written.paperTrade.id)
    expect(trajectory?.paperTradeState?.marketEvidence).toMatchObject({
      source: "tushare_http",
      followThrough3d: 8,
      relativeStrength: 6,
      turnoverChange: 2,
    })
    expect(trajectory?.paperTradeState?.marketEvidenceWindow).toMatchObject({
      expectedWindow: "2026-06-03..2026-06-06",
      actualWindow: "2026-06-03..2026-06-06",
      exceededExpectedEnd: false,
    })
    expect(trajectory?.paperTradeState?.marketMicrostructureEvidence?.signals).toEqual(expect.arrayContaining([
      "limit_list:matched",
      "dragon_tiger:matched",
      "ths_hot:matched",
    ]))

    const verified = await verifyStockFeedbackArtifacts({ projectPath: tmpRoot })
    expect(verified.status).toBe("ok")
  })

  it("blocks paper-trade writes when requested automatic evidence cannot be collected", async () => {
    const draft = {
      projectPath: tmpRoot,
      track: "rule_baseline",
      asOfDate: "2026-06-03",
      validationTarget: "expectation_trade",
      stockName: "样本科技A",
      stockCode: "SZ300901",
      hypothesis: "预期扩散继续，但必须有自动行情证据。",
      expectedMove: "预期后续 3 日相对强势。",
      entryDate: "2026-06-03",
      entryPrice: "10.00",
      sourceRefs: "self-question:question_asof_001",
      autoMarketEvidence: true,
      marketEvidenceProvider: "tushare",
      generatedAt: "2026-06-20 17:40:00",
    }

    const preview = await recordStockFeedbackPaperTrade(draft)
    expect(preview.autoEvidenceGate).toMatchObject({
      status: "blocked",
      blocksWrite: true,
      checks: [
        expect.objectContaining({
          id: "market_evidence",
          provider: "tushare",
          status: "unavailable",
          passed: false,
        }),
      ],
    })

    await expect(recordStockFeedbackPaperTrade({ ...draft, write: true }))
      .rejects
      .toThrow("automatic evidence gate blocked write")

    await expect(fs.access(path.join(tmpRoot, ".llm-wiki", "stock-feedback", "paper-trades")))
      .rejects
      .toThrow()
  })

  it("fails verify for paper-trade records without an as-of evidence cutoff", async () => {
    await write(
      path.join(tmpRoot, ".llm-wiki/stock-feedback/paper-trades/missing-as-of.jsonl"),
      `${JSON.stringify({
        schema: "stock-feedback-paper-trade-v1",
        id: "missing_asof_paper_trade",
        generatedAt: "2026-06-20 16:02:00",
        ledgerKind: "paper_trade",
        track: "rule_baseline",
        status: "closed",
        validationTarget: "expectation_trade",
        stock: { code: "SZ300902" },
        entry: { date: "2026-06-03", price: 10 },
        exit: { date: "2026-06-04", price: 10.2 },
        profitFeedback: {
          executionMode: "paper",
          ledgerKind: "paper_trade",
          outcome: "profitable",
          realizedPnlPct: 2,
        },
        peftBoundary: {
          storesRawFacts: false,
          factsRemainIn: ["retrieval/tool state", "sourceRefs", "price SQL", "paper trade ledger"],
          adapterStores: ["behavior", "skill", "tool_habit", "decision_strategy"],
        },
      })}\n`,
    )

    const verified = await verifyStockFeedbackArtifacts({ projectPath: tmpRoot })
    expect(verified.status).toBe("failed")
    expect(verified.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: "error",
        code: "paper_trade_missing_as_of_date",
        id: "missing_asof_paper_trade",
      }),
    ]))
  })

  it("fails verify for historical paper-trade records with blocked automatic evidence gate", async () => {
    await write(
      path.join(tmpRoot, ".llm-wiki/stock-feedback/paper-trades/blocked-auto-evidence.jsonl"),
      `${JSON.stringify({
        schema: "stock-feedback-paper-trade-v1",
        id: "blocked_auto_evidence_paper_trade",
        generatedAt: "2026-06-20 17:50:00",
        asOfDate: "2026-06-03",
        ledgerKind: "paper_trade",
        track: "rule_baseline",
        status: "closed",
        validationTarget: "expectation_trade",
        stock: { code: "SZ300901" },
        entry: { date: "2026-06-03", price: 10 },
        exit: { date: "2026-06-04", price: 10.2 },
        profitFeedback: {
          executionMode: "paper",
          ledgerKind: "paper_trade",
          outcome: "profitable",
          realizedPnlPct: 2,
        },
        marketEvidenceProvider: "tushare",
        marketEvidenceStatus: "unavailable",
        autoEvidenceGate: {
          status: "blocked",
          blocksWrite: true,
          detail: "market_evidence:unavailable:Tushare token is not configured",
          checks: [
            {
              id: "market_evidence",
              provider: "tushare",
              status: "unavailable",
              passed: false,
            },
          ],
        },
        evidenceCutoff: {
          asOfDate: "2026-06-03",
          noFutureData: true,
        },
        peftBoundary: {
          storesRawFacts: false,
          factsRemainIn: ["retrieval/tool state", "sourceRefs", "price SQL", "paper trade ledger"],
          adapterStores: ["behavior", "skill", "tool_habit", "decision_strategy"],
        },
      })}\n`,
    )

    const verified = await verifyStockFeedbackArtifacts({ projectPath: tmpRoot })
    expect(verified.status).toBe("failed")
    expect(verified.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: "error",
        code: "paper_trade_auto_evidence_gate_blocked",
        id: "blocked_auto_evidence_paper_trade",
      }),
    ]))
  })

  it("fails verify for paper-trade records whose market evidence window exceeded the planned cutoff", async () => {
    await write(
      path.join(tmpRoot, ".llm-wiki/stock-feedback/paper-trades/window-exceeded.jsonl"),
      `${JSON.stringify({
        schema: "stock-feedback-paper-trade-v1",
        id: "window_exceeded_paper_trade",
        generatedAt: "2026-06-20 20:10:00",
        asOfDate: "2026-06-03",
        ledgerKind: "paper_trade",
        track: "rule_baseline",
        status: "open",
        validationTarget: "expectation_trade",
        stock: { code: "SZ300901" },
        entry: { date: "2026-06-03", price: 10 },
        exit: null,
        profitFeedback: {
          executionMode: "paper",
          ledgerKind: "paper_trade",
          outcome: "open",
        },
        marketEvidence: {
          priceSqlRef: "tushare:daily#300901.SZ/20260618",
          marketDataRef: "tushare:daily+daily_basic:300901.SZ:2026-06-03..2026-06-18",
          startDate: "2026-06-03",
          endDate: "2026-06-18",
          rows: 12,
        },
        marketEvidenceWindow: {
          expectedStartDate: "2026-06-03",
          expectedEndDate: "2026-06-10",
          expectedWindow: "2026-06-03..2026-06-10",
          actualStartDate: "2026-06-03",
          actualEndDate: "2026-06-18",
          actualWindow: "2026-06-03..2026-06-18",
          exceededExpectedEnd: true,
        },
        autoEvidenceGate: {
          status: "ready",
          blocksWrite: false,
          checks: [
            { id: "market_evidence", provider: "tushare", status: "ok", passed: true },
          ],
        },
        evidenceCutoff: {
          asOfDate: "2026-06-03",
          noFutureData: true,
        },
        peftBoundary: {
          storesRawFacts: false,
          factsRemainIn: ["retrieval/tool state", "sourceRefs", "price SQL", "paper trade ledger"],
          adapterStores: ["behavior", "skill", "tool_habit", "decision_strategy"],
        },
      })}\n`,
    )

    const verified = await verifyStockFeedbackArtifacts({ projectPath: tmpRoot })
    expect(verified.status).toBe("failed")
    expect(verified.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: "error",
        code: "paper_trade_market_evidence_window_exceeded",
        id: "window_exceeded_paper_trade",
      }),
    ]))
  })

  it("routes blocked automatic-evidence paper trades into needs-evidence trajectories", async () => {
    await write(
      path.join(tmpRoot, ".llm-wiki/stock-feedback/paper-trades/blocked-auto-evidence-with-ref.jsonl"),
      `${JSON.stringify({
        schema: "stock-feedback-paper-trade-v1",
        id: "blocked_auto_evidence_with_ref",
        generatedAt: "2026-06-20 17:55:00",
        asOfDate: "2026-06-03",
        ledgerKind: "paper_trade",
        track: "rule_baseline",
        status: "closed",
        validationTarget: "expectation_trade",
        stock: { code: "SZ300901" },
        entry: { date: "2026-06-03", price: 10 },
        exit: { date: "2026-06-04", price: 10.2 },
        profitFeedback: {
          executionMode: "paper",
          ledgerKind: "paper_trade",
          outcome: "profitable",
          realizedPnlPct: 2,
        },
        marketEvidenceProvider: "tushare",
        marketEvidenceStatus: "unavailable",
        autoEvidenceGate: {
          status: "blocked",
          blocksWrite: true,
          detail: "market_evidence:unavailable:Tushare token is not configured",
          checks: [
            { id: "market_evidence", provider: "tushare", status: "unavailable", passed: false },
          ],
        },
        evidenceRefs: ["self-question:question_asof_001"],
        evidenceCutoff: {
          asOfDate: "2026-06-03",
          noFutureData: true,
        },
        peftBoundary: {
          storesRawFacts: false,
          factsRemainIn: ["retrieval/tool state", "sourceRefs", "price SQL", "paper trade ledger"],
          adapterStores: ["behavior", "skill", "tool_habit", "decision_strategy"],
        },
      })}\n`,
    )

    const built = await buildStockFeedbackTrajectories({
      projectPath: tmpRoot,
      generatedAt: "2026-06-20 17:56:00",
    })
    const trajectory = built.trajectories.find((item) => item.sourceRecordId === "blocked_auto_evidence_with_ref")

    expect(trajectory).toMatchObject({
      qualityGate: expect.objectContaining({
        status: "needs_evidence",
        requiredAction: "repair_paper_trade_auto_evidence",
        reasons: expect.arrayContaining(["paper_trade_auto_evidence_gate_blocked"]),
      }),
      evidenceState: expect.objectContaining({
        evidenceGaps: expect.arrayContaining(["paper_trade_auto_evidence_gate_blocked"]),
      }),
      routing: expect.objectContaining({
        adapterCandidate: false,
      }),
    })
  })

  it("routes crowded losing paper trades into priced-in risk review and benchmark", async () => {
    const tushareClient = async ({ apiName }) => {
      if (apiName === "limit_list_d") {
        return {
          code: 0,
          msg: "",
          data: {
            fields: ["trade_date", "ts_code", "name", "industry", "close", "pct_chg", "amount", "limit_amount", "fd_amount", "first_time", "last_time", "open_times", "up_stat", "limit_times"],
            items: [["20260610", "688485.SH", "九州一轨", "轨交设备", 56.83, 20, 675421280, null, 72612486, "141816", "141816", 0, "1/1", 1]],
          },
        }
      }
      if (apiName === "limit_step") return { code: 0, msg: "", data: { fields: ["ts_code", "name", "trade_date", "nums"], items: [] } }
      if (apiName === "top_list") {
        return {
          code: 0,
          msg: "",
          data: {
            fields: ["trade_date", "ts_code", "name", "close", "pct_change", "turnover_rate", "amount", "l_sell", "l_buy", "l_amount", "net_amount", "reason"],
            items: [["20260610", "688485.SH", "九州一轨", 56.83, 20, 14.62, 675421300, 82097280.66, 144590071.42, 226687352.08, 62492790.76, "有价格涨跌幅限制的日收盘价格涨幅达到15%的前五只证券"]],
          },
        }
      }
      if (apiName === "top_inst") {
        return {
          code: 0,
          msg: "",
          data: {
            fields: ["trade_date", "ts_code", "exalter", "buy", "buy_rate", "sell", "sell_rate", "net_buy"],
            items: [["20260610", "688485.SH", "机构专用", 144590071.42, 12, 82097280.66, 7, 62492790.76]],
          },
        }
      }
      if (apiName === "hm_detail") {
        return {
          code: 0,
          msg: "",
          data: {
            fields: ["trade_date", "ts_code", "ts_name", "hm_name", "buy_amount", "sell_amount", "net_amount"],
            items: [["20260610", "688485.SH", "九州一轨", "量化基金", 83201400, 66698300, 16503100]],
          },
        }
      }
      if (apiName === "ths_hot") return { code: 0, msg: "", data: { fields: ["trade_date", "ts_code", "ts_name", "rank", "pct_change", "current_price", "concept"], items: [] } }
      if (apiName === "dc_hot") {
        return {
          code: 0,
          msg: "",
          data: {
            fields: ["trade_date", "ts_code", "ts_name", "rank", "pct_change", "current_price"],
            items: [["20260610", "688485.SH", "九州一轨", 3, 20, 56.83]],
          },
        }
      }
      return { code: 0, msg: "", data: { fields: [], items: [] } }
    }

    const written = await recordStockFeedbackPaperTrade({
      projectPath: tmpRoot,
      track: "rule_baseline",
      status: "closed",
      asOfDate: "2026-06-10",
      validationTarget: "priced_in_risk",
      stockCode: "SH688485",
      stockName: "九州一轨",
      hypothesis: "热度和打板证据已经拥挤，后手追涨风险高。",
      expectedMove: "方向可能仍对，但买点赔率已经压缩。",
      entryDate: "2026-06-10",
      entryPrice: "56.83",
      exitDate: "2026-06-12",
      exitPrice: "54.00",
      exitReason: "后手接力失败，承接转弱止损。",
      maxDrawdownPct: "8.2",
      sourceRefs: "self-question:priced-in-asof-001",
      autoMicrostructureEvidence: true,
      microstructureDate: "2026-06-10",
      marketEvidenceProvider: "tushare",
      tushareToken: "fake-tushare-test-token",
      tushareClient,
      generatedAt: "2026-06-20 17:10:00",
      write: true,
    })

    const built = await buildStockFeedbackTrajectories({
      projectPath: tmpRoot,
      generatedAt: "2026-06-20 17:11:00",
      write: true,
    })
    const trajectory = built.trajectories.find((item) => item.sourceRecordId === written.paperTrade.id)

    expect(trajectory).toMatchObject({
      validationTarget: "priced_in_risk",
      qualityGate: expect.objectContaining({
        status: "priced_in_validated",
        highConfidenceEligible: false,
        requiredAction: "review_priced_in_paper_trade",
        reasons: expect.arrayContaining(["paper_trade_heat_crowded", "paper_trade_negative_execution"]),
      }),
      profitFeedback: expect.objectContaining({
        outcome: "loss",
      }),
      routing: expect.objectContaining({
        eval: true,
        preference: true,
        adapterCandidate: false,
      }),
    })
    expect(trajectory?.marketValidation?.signals).toEqual(expect.arrayContaining([
      "microstructure:dc_hot:matched",
      "microstructure:heat:crowded_top50",
    ]))

    const reviewQueue = await listStockFeedbackReviewQueue({ projectPath: tmpRoot, includeReviewed: false })
    const reviewItem = reviewQueue.items.find((item) => item.sourceTrajectoryId === trajectory?.id)
    expect(reviewItem).toMatchObject({
      recommendedAction: "mark_priced_in",
      recommendedActionLabel: "标记 priced-in 风险",
    })

    const benchmark = await buildStockFeedbackBenchmark({ projectPath: tmpRoot, limit: 10 })
    const benchmarkCase = benchmark.cases.find((item) => item.sourceTrajectoryId === trajectory?.id)
    expect(benchmarkCase).toMatchObject({
      validationTarget: "priced_in_risk",
      qualityGateStatus: "priced_in_validated",
      dynamicPriority: expect.objectContaining({
        bucket: "risk_negative",
        reasons: expect.arrayContaining(["risk_negative"]),
      }),
    })

    const preferenceSamples = await readStockFeedbackTrainingSamples(tmpRoot, "preference")
    const preferenceSample = preferenceSamples.find((item) => item.sourceRecordId === trajectory?.id)
    expect(preferenceSample).toMatchObject({
      kind: "preference",
      validationTarget: "priced_in_risk",
      qualityGate: expect.objectContaining({
        status: "priced_in_validated",
        checkResults: expect.objectContaining({
          crowdedHeat: true,
          relayEvidence: true,
          negativeExecution: true,
        }),
      }),
      qualityGateCheckSummary: expect.arrayContaining([
        "crowdedHeat=passed",
        "negativeExecution=passed",
      ]),
    })
    expect(JSON.stringify(preferenceSample)).not.toContain("675421300")
  })
})

describe("stock-feedback paper-trade agent candidates", () => {
  it("generates dual-track agent candidates from expectation trajectories and keeps dry-run ledger clean", async () => {
    await write(
      path.join(tmpRoot, ".llm-wiki/stock-feedback/trajectories/agent-seed-trajectories.jsonl"),
      `${JSON.stringify({
        schema: "stock-feedback-trajectory-v1",
        id: "stockfb_agent_seed_expectation_001",
        generatedAt: "2026-06-21 10:00:00",
        source: "self-question-attribution",
        sourceRecordId: "agent_seed_attr_001",
        validationTarget: "expectation_trade",
        qualityGate: {
          status: "expectation_validated",
          validationTarget: "expectation_trade",
          highConfidenceEligible: true,
          reasons: ["relative_strength_expansion_confirmed"],
        },
        questionRecordId: "agent_question_record_001",
        questionId: "agent-question-001",
        hypothesis: "低位吸收后，资金预期先于订单落地交易样本科技A。",
        summary: "预期 3 日内相对强度继续扩散。",
        stock: {
          name: "样本科技A",
          code: "300901.SZ",
          label: "样本科技A 300901.SZ",
        },
        eventTimeline: [
          { step: "question", at: "2026-06-03 09:20:00", ref: "agent_question_record_001" },
          { step: "market_validation", at: "2026-06-03 15:00:00", ref: "agent_validation_001" },
        ],
        profitFeedback: {
          entryTiming: "先小仓试错，转强后再加仓",
          positionSizing: "probe_then_add",
        },
        distillationSignals: {
          decisionStrategy: "低位吸收后只在承接确认时试错，不把短线涨幅当基本面兑现。",
          distillInto: ["behavior", "skill", "tool_habit", "decision_strategy"],
        },
        evidenceState: {
          confirmedEvidenceRefs: ["tool-state:self-question-attribution#agent_question_record_001"],
          evidenceGaps: ["close < 18 invalidates"],
        },
        sourceRefs: ["self-question:agent-question-001", "price-sql:300901.SZ:2026-06-03"],
      })}\n`,
    )

    const preview = await buildStockFeedbackPaperTradeAgentCandidates({
      projectPath: tmpRoot,
      generatedAt: "2026-06-21 10:05:00",
      limit: 4,
    })

    expect(preview).toMatchObject({
      schema: "stock-feedback-paper-trade-agent-result-v1",
      dryRun: true,
      count: 2,
      writeResult: null,
      writePolicy: {
        wroteWiki: false,
        wroteRaw: false,
        wroteBrain: false,
        wroteRealTradeLedger: false,
      },
    })
    expect(preview.summary).toMatchObject({
      counts: {
        total: 2,
        ruleBaseline: 1,
        llmDiscretionary: 1,
        needsMarketPrice: 2,
        fromTrajectory: 2,
      },
      writeBoundary: {
        wrotePaperTradeLedger: false,
        wroteRealTradeLedger: false,
      },
      peftBoundary: {
        storesRawFacts: false,
      },
    })
    expect(preview.candidates.map((item) => item.track).sort()).toEqual(["llm_discretionary", "rule_baseline"])
    expect(preview.candidates[0]).toMatchObject({
      schema: "stock-feedback-paper-trade-agent-candidate-v1",
      sourceKind: "stock_feedback_trajectory",
      sourceTrajectoryId: "stockfb_agent_seed_expectation_001",
      ledgerKind: "paper_trade",
      validationTarget: "expectation_trade",
      asOfDate: "2026-06-03",
      evidenceCutoff: {
        asOfDate: "2026-06-03",
        noFutureData: true,
      },
      marketEvidenceRequest: {
        provider: "tushare_or_price_sql",
        fields: expect.arrayContaining(["entryPrice", "maxDrawdown", "followThrough", "relativeStrength", "turnoverChange"]),
      },
      readiness: {
        status: "needs_market_price",
        missingRequiredFields: ["entryPrice"],
      },
      peftBoundary: {
        storesRawFacts: false,
      },
    })
    expect(JSON.stringify(preview)).toContain("--auto-market-evidence")
    await expect(fs.access(path.join(tmpRoot, ".llm-wiki", "stock-feedback", "paper-trades"))).rejects.toThrow()

    const written = await buildStockFeedbackPaperTradeAgentCandidates({
      projectPath: tmpRoot,
      generatedAt: "2026-06-21 10:06:00",
      limit: 4,
      write: true,
    })
    expect(written.writeResult.candidates.relativePath).toMatch(/^\.llm-wiki\/stock-feedback\/paper-trade-agent\//)
    expect(written.manifest).toMatchObject({
      schema: "stock-feedback-paper-trade-agent-manifest-v1",
      count: 2,
      writeBoundary: {
        root: ".llm-wiki/stock-feedback",
        family: "paper-trade-agent",
        wrotePaperTradeLedger: false,
        wroteRealTradeLedger: false,
      },
    })

    const verified = await verifyStockFeedbackArtifacts({ projectPath: tmpRoot })
    expect(verified.status).toBe("ok")
    expect(verified.checked).toMatchObject({
      trajectories: 1,
      paperTradeAgentCandidates: 2,
      paperTradeAgentManifests: 1,
    })
    const status = await getStockFeedbackStatus({ projectPath: tmpRoot })
    expect(status.sampleDensityAudit).toMatchObject({
      schema: "stock-feedback-sample-density-audit-v1",
      status: "thin",
      counts: {
        trajectories: 1,
        hasTrajectorySourceInput: false,
        hasPaperAgentSourceInput: true,
        expectationTradeTrajectories: 1,
        paperTradeAgentPreviewCandidates: 2,
        paperTradeAgentWrittenCandidates: 2,
        paperTrades: 0,
      },
    })
    expect(status.sampleDensityAudit.gaps.map((item) => item.id)).not.toContain("no_stock_feedback_trajectories")
    expect(status.sampleDensityAudit.gaps.map((item) => item.id)).not.toContain("paper_trade_agent_candidates_not_written")
    expect(status.sampleDensityAudit.gaps.map((item) => item.id)).toContain("no_paper_trades")

    const benchmark = await buildStockFeedbackBenchmark({ projectPath: tmpRoot, generatedAt: "2026-06-21 10:07:00", limit: 10 })
    const agentCases = benchmark.cases.filter((item) => item.sourceKind === "paper_trade_agent_candidate")
    expect(agentCases).toHaveLength(2)
    expect(agentCases[0]).toMatchObject({
      adapterCapability: "paper_trade_agent_planning",
      expected: expect.objectContaining({
        routeTo: ["eval", "paper_trade_agent"],
        highConfidenceEligible: false,
        profitOutcome: "pending_settlement",
        evidenceCutoff: expect.objectContaining({ noFutureData: true }),
      }),
    })

    const loraReady = await exportStockFeedbackLoraReady({
      projectPath: tmpRoot,
      generatedAt: "2026-06-21 10:08:00",
      qualityGate: "all",
    })
    expect(loraReady.manifest.paperTradeAgentCurriculum).toMatchObject({
      schema: "stock-feedback-paper-trade-agent-curriculum-v1",
      defaultWeightMultiplier: 0.35,
      counts: {
        total: 2,
        ruleBaseline: 1,
        llmDiscretionary: 1,
      },
      peftBoundary: {
        storesRawFacts: false,
      },
    })
    expect(loraReady.manifest.adapterCurriculum.paperTradeAgent.groups.map((item) => item.id)).toEqual([
      "paper_trade_rule_baseline",
      "paper_trade_llm_discretionary",
      "paper_trade_blocked_evidence",
    ])
  })

  it("reuses real execution entry price hints for paper-trade-agent candidates", async () => {
    await write(
      path.join(tmpRoot, ".llm-wiki/stock-feedback/trajectories/agent-execution-trajectories.jsonl"),
      `${JSON.stringify({
        schema: "stock-feedback-trajectory-v1",
        id: "stockfb_agent_execution_expectation_001",
        generatedAt: "2026-06-21 11:00:00",
        source: "stock-feedback-execution-result",
        sourceRecordId: "execres_real_000564_fixture",
        validationTarget: "expectation_trade",
        qualityGate: {
          status: "expectation_validated",
          validationTarget: "expectation_trade",
          highConfidenceEligible: true,
        },
        hypothesis: "真实执行样本可作为模拟交易候选的 as-of 决策输入。",
        summary: "供销大集真实买入价已由交割单确认。",
        stock: {
          name: "供销大集",
          code: "000564",
          label: "供销大集 000564",
        },
        eventTimeline: [
          { step: "real_trade_entry", at: "2026-05-25", ref: "execres_real_000564_fixture" },
          { step: "real_trade_exit", at: "2026-05-26", ref: "execres_real_000564_fixture" },
        ],
        profitFeedback: {
          outcome: "profitable",
          executionMode: "real",
          ledgerKind: "real_trade",
          positionSizing: "matchedQuantity=84900",
        },
        executionPriceHint: {
          source: "research-os-execution-result-v1",
          entryPrice: 1.8,
          exitPrice: 1.86,
          priceQuality: "exact",
          sourceRefs: [".llm-wiki/stock-feedback/execution-results/execres-real-fixture.jsonl"],
        },
        evidenceState: {
          confirmedEvidenceRefs: [
            ".llm-wiki/stock-feedback/execution-results/execres-real-fixture.jsonl",
            "raw/交割单/2026-05-25-交割单.md",
          ],
        },
        sourceRefs: [
          ".llm-wiki/stock-feedback/execution-results/execres-real-fixture.jsonl",
          "raw/交割单/2026-05-25-交割单.md",
        ],
      })}\n`,
    )

    const preview = await buildStockFeedbackPaperTradeAgentCandidates({
      projectPath: tmpRoot,
      generatedAt: "2026-06-21 11:05:00",
      limit: 4,
    })

    expect(preview.summary.counts).toMatchObject({
      total: 2,
      needsMarketPrice: 0,
      blocked: 0,
    })
    expect(preview.candidates.map((item) => item.track).sort()).toEqual(["llm_discretionary", "rule_baseline"])
    for (const candidate of preview.candidates) {
      expect(candidate).toMatchObject({
        sourceKind: "stock_feedback_trajectory",
        sourceTrajectoryId: "stockfb_agent_execution_expectation_001",
        entryPlan: {
          date: "2026-05-25",
          price: 1.8,
          priceSource: "real_execution_result_entry_price",
          priceQuality: "exact",
        },
        readiness: {
          status: "ready",
          missingRequiredFields: [],
          nextAction: "record_paper_trade_candidate_with_existing_entry_price_and_auto_market_evidence",
        },
      })
      expect(candidate.suggestedRecordCommand).toContain("--entry-price 1.8")
      expect(candidate.suggestedRecordCommand).not.toContain("<market_price_required>")
      expect(candidate.suggestedRecordCommand).toContain("--auto-market-evidence")
    }
  })

  it("fails verify when paper-trade-agent candidates lack evidence references and market evidence requests", async () => {
    await write(
      path.join(tmpRoot, ".llm-wiki/stock-feedback/paper-trade-agent/bad-agent-candidate.jsonl"),
      `${JSON.stringify({
        schema: "stock-feedback-paper-trade-agent-candidate-v1",
        id: "stockfb_paper_agent_missing_refs",
        generatedAt: "2026-06-21 10:09:00",
        sourceKind: "stock_feedback_trajectory",
        sourceTrajectoryId: "stockfb_missing_refs",
        track: "rule_baseline",
        pairedTrack: "llm_discretionary",
        ledgerKind: "paper_trade",
        validationTarget: "expectation_trade",
        asOfDate: "2026-06-03",
        evidenceCutoff: {
          asOfDate: "2026-06-03",
          noFutureData: true,
        },
        stock: {
          name: "样本科技A",
          code: "SZ300901",
        },
        hypothesis: "缺少证据引用的模拟交易候选不能进入闭环。",
        expectedCatalyst: "市场预期扩散",
        entryPlan: {
          date: "2026-06-03",
          price: null,
          priceSource: "market_data_at_asof_required",
          reason: "等待 as-of 价格证据",
          evidenceRefs: [],
          requiredMarketFields: ["entryPrice", "relativeStrength"],
        },
        exitPlan: {
          track: "rule_baseline",
          rule: "exit on 5 trading days",
          targetHoldingDays: 5,
        },
        positionSizing: "paper_trade_unit_risk_0.35x_until_reviewed",
        sourceRefs: [],
        evidenceRefs: [],
        readiness: {
          status: "needs_market_price",
          missingRequiredFields: ["entryPrice"],
        },
        peftBoundary: {
          storesRawFacts: false,
          factsRemainIn: ["retrieval/tool state", "sourceRefs", "price SQL or Tushare", "paper trade ledger"],
          adapterStores: ["behavior", "skill", "tool_habit", "decision_strategy"],
        },
      })}\n`,
    )

    const verified = await verifyStockFeedbackArtifacts({ projectPath: tmpRoot })

    expect(verified.status).toBe("failed")
    expect(verified.issues.map((item) => item.code)).toEqual(expect.arrayContaining([
      "paper_trade_agent_missing_source_refs",
      "paper_trade_agent_missing_evidence_refs",
      "paper_trade_agent_missing_market_evidence_request",
    ]))
  })

  it("fails verify when paper-trade-agent readiness bypasses as-of market evidence", async () => {
    await write(
      path.join(tmpRoot, ".llm-wiki/stock-feedback/paper-trade-agent/bad-agent-readiness.jsonl"),
      `${JSON.stringify({
        schema: "stock-feedback-paper-trade-agent-candidate-v1",
        id: "stockfb_paper_agent_bad_readiness",
        generatedAt: "2026-06-21 10:09:30",
        sourceKind: "stock_feedback_trajectory",
        sourceTrajectoryId: "stockfb_bad_readiness",
        track: "rule_baseline",
        pairedTrack: "llm_discretionary",
        ledgerKind: "paper_trade",
        validationTarget: "expectation_trade",
        asOfDate: "2026-06-03",
        evidenceCutoff: {
          asOfDate: "2026-06-03",
          noFutureData: true,
        },
        stock: {
          name: "样本科技A",
          code: "SZ300901",
        },
        hypothesis: "模拟交易候选不能缺入口价却直接标记 ready。",
        expectedCatalyst: "市场预期扩散",
        entryPlan: {
          date: "2026-06-03",
          price: null,
          priceSource: "market_data_at_asof_required",
          reason: "等待 as-of 价格证据",
          evidenceRefs: ["tool-state:self-question-attribution#bad-readiness"],
          requiredMarketFields: ["entryPrice", "relativeStrength"],
        },
        exitPlan: {
          track: "rule_baseline",
          rule: "exit on 5 trading days",
          targetHoldingDays: 5,
        },
        positionSizing: "paper_trade_unit_risk_0.35x_until_reviewed",
        sourceRefs: ["self-question:bad-readiness"],
        evidenceRefs: ["tool-state:self-question-attribution#bad-readiness"],
        marketEvidenceRequest: {
          provider: "tushare_or_price_sql",
          asOfDate: "2026-06-04",
          fields: ["entryPrice", "relativeStrength"],
        },
        readiness: {
          status: "ready",
          missingRequiredFields: ["entryPrice"],
        },
        suggestedRecordCommand: "stock-feedback paper-trade record --entry-price <market_price_required>",
        peftBoundary: {
          storesRawFacts: false,
          factsRemainIn: ["retrieval/tool state", "sourceRefs", "price SQL or Tushare", "paper trade ledger"],
          adapterStores: ["behavior", "skill", "tool_habit", "decision_strategy"],
        },
      })}\n`,
    )

    const verified = await verifyStockFeedbackArtifacts({ projectPath: tmpRoot })

    expect(verified.status).toBe("failed")
    expect(verified.issues.map((item) => item.code)).toEqual(expect.arrayContaining([
      "paper_trade_agent_market_evidence_asof_mismatch",
      "paper_trade_agent_incomplete_market_evidence_request",
      "paper_trade_agent_ready_with_missing_entry_price",
      "paper_trade_agent_record_command_missing_auto_market_evidence",
    ]))
  })

  it("fails verify when paper-trade-agent manifest claims paper ledger writes", async () => {
    await write(
      path.join(tmpRoot, ".llm-wiki/stock-feedback/paper-trade-agent/bad-agent-manifest.manifest.json"),
      `${JSON.stringify({
        schema: "stock-feedback-paper-trade-agent-manifest-v1",
        generatedAt: "2026-06-21 10:10:00",
        projectPath: tmpRoot,
        count: 0,
        summary: {
          total: 0,
        },
        writeBoundary: {
          root: ".llm-wiki/stock-feedback",
          family: "paper-trade-agent",
          wroteWiki: false,
          wroteRaw: false,
          wroteBrain: false,
          wrotePaperTradeLedger: true,
          wroteRealTradeLedger: false,
        },
      }, null, 2)}\n`,
    )

    const verified = await verifyStockFeedbackArtifacts({ projectPath: tmpRoot })

    expect(verified.status).toBe("failed")
    expect(verified.issues.map((item) => item.code)).toEqual(expect.arrayContaining([
      "paper_trade_agent_manifest_boundary_violation",
    ]))
  })

  it("fails verify when paper-trade-agent manifest counts drift from latest candidates", async () => {
    await write(
      path.join(tmpRoot, ".llm-wiki/stock-feedback/paper-trade-agent/stock-feedback-paper-trade-agent-20260621101100.jsonl"),
      `${JSON.stringify({
        schema: "stock-feedback-paper-trade-agent-candidate-v1",
        id: "stockfb_paper_agent_counted_once",
        generatedAt: "2026-06-21 10:11:00",
        sourceKind: "stock_feedback_trajectory",
        sourceTrajectoryId: "stockfb_agent_count_source",
        track: "rule_baseline",
        pairedTrack: "llm_discretionary",
        ledgerKind: "paper_trade",
        validationTarget: "expectation_trade",
        asOfDate: "2026-06-03",
        evidenceCutoff: {
          asOfDate: "2026-06-03",
          noFutureData: true,
        },
        stock: {
          name: "样本科技A",
          code: "SZ300901",
        },
        hypothesis: "低位吸收后观察承接。",
        expectedCatalyst: "市场预期扩散",
        entryPlan: {
          date: "2026-06-03",
          price: null,
          priceSource: "market_data_at_asof_required",
          reason: "等待 as-of 价格证据",
          evidenceRefs: ["tool-state:self-question-attribution#agent_count_source"],
          requiredMarketFields: ["entryPrice", "relativeStrength"],
        },
        exitPlan: {
          track: "rule_baseline",
          rule: "exit on 5 trading days",
          targetHoldingDays: 5,
        },
        positionSizing: "paper_trade_unit_risk_0.35x_until_reviewed",
        sourceRefs: ["self-question:agent-count-source"],
        evidenceRefs: ["tool-state:self-question-attribution#agent_count_source"],
        marketEvidenceRequest: {
          provider: "tushare_or_price_sql",
          asOfDate: "2026-06-03",
          fields: ["entryPrice", "relativeStrength"],
        },
        readiness: {
          status: "needs_market_price",
          missingRequiredFields: ["entryPrice"],
        },
        peftBoundary: {
          storesRawFacts: false,
          factsRemainIn: ["retrieval/tool state", "sourceRefs", "price SQL or Tushare", "paper trade ledger"],
          adapterStores: ["behavior", "skill", "tool_habit", "decision_strategy"],
        },
      })}\n`,
    )
    await write(
      path.join(tmpRoot, ".llm-wiki/stock-feedback/paper-trade-agent/stock-feedback-paper-trade-agent-20260621101100.manifest.json"),
      `${JSON.stringify({
        schema: "stock-feedback-paper-trade-agent-manifest-v1",
        generatedAt: "2026-06-21 10:11:00",
        projectPath: tmpRoot,
        count: 2,
        summary: {
          total: 2,
          ruleBaseline: 2,
        },
        writeBoundary: {
          root: ".llm-wiki/stock-feedback",
          family: "paper-trade-agent",
          wroteWiki: false,
          wroteRaw: false,
          wroteBrain: false,
          wrotePaperTradeLedger: false,
          wroteRealTradeLedger: false,
        },
      }, null, 2)}\n`,
    )

    const verified = await verifyStockFeedbackArtifacts({ projectPath: tmpRoot })

    expect(verified.status).toBe("failed")
    expect(verified.issues.map((item) => item.code)).toEqual(expect.arrayContaining([
      "paper_trade_agent_manifest_count_mismatch",
      "paper_trade_agent_manifest_summary_total_mismatch",
    ]))
  })

  it("fails verify when paper-trade-agent manifest summary distribution drifts", async () => {
    await write(
      path.join(tmpRoot, ".llm-wiki/stock-feedback/paper-trade-agent/stock-feedback-paper-trade-agent-20260621101200.jsonl"),
      `${JSON.stringify({
        schema: "stock-feedback-paper-trade-agent-candidate-v1",
        id: "stockfb_paper_agent_distribution_once",
        generatedAt: "2026-06-21 10:12:00",
        sourceKind: "stock_feedback_trajectory",
        sourceTrajectoryId: "stockfb_agent_distribution_source",
        track: "rule_baseline",
        pairedTrack: "llm_discretionary",
        ledgerKind: "paper_trade",
        validationTarget: "expectation_trade",
        asOfDate: "2026-06-03",
        evidenceCutoff: {
          asOfDate: "2026-06-03",
          noFutureData: true,
        },
        stock: {
          name: "样本科技A",
          code: "SZ300901",
        },
        hypothesis: "低位吸收后观察承接。",
        expectedCatalyst: "市场预期扩散",
        entryPlan: {
          date: "2026-06-03",
          price: null,
          priceSource: "market_data_at_asof_required",
          reason: "等待 as-of 价格证据",
          evidenceRefs: ["tool-state:self-question-attribution#agent_distribution_source"],
          requiredMarketFields: ["entryPrice", "relativeStrength"],
        },
        exitPlan: {
          track: "rule_baseline",
          rule: "exit on 5 trading days",
          targetHoldingDays: 5,
        },
        positionSizing: "paper_trade_unit_risk_0.35x_until_reviewed",
        sourceRefs: ["self-question:agent-distribution-source"],
        evidenceRefs: ["tool-state:self-question-attribution#agent_distribution_source"],
        marketEvidenceRequest: {
          provider: "tushare_or_price_sql",
          asOfDate: "2026-06-03",
          fields: ["entryPrice", "relativeStrength"],
        },
        readiness: {
          status: "needs_market_price",
          missingRequiredFields: ["entryPrice"],
        },
        peftBoundary: {
          storesRawFacts: false,
          factsRemainIn: ["retrieval/tool state", "sourceRefs", "price SQL or Tushare", "paper trade ledger"],
          adapterStores: ["behavior", "skill", "tool_habit", "decision_strategy"],
        },
      })}\n`,
    )
    await write(
      path.join(tmpRoot, ".llm-wiki/stock-feedback/paper-trade-agent/stock-feedback-paper-trade-agent-20260621101200.manifest.json"),
      `${JSON.stringify({
        schema: "stock-feedback-paper-trade-agent-manifest-v1",
        generatedAt: "2026-06-21 10:12:00",
        projectPath: tmpRoot,
        count: 1,
        summary: {
          total: 1,
          ruleBaseline: 0,
          llmDiscretionary: 1,
          needsMarketPrice: 0,
          blocked: 1,
          fromTrajectory: 0,
          fromHypothesisFeedback: 1,
        },
        writeBoundary: {
          root: ".llm-wiki/stock-feedback",
          family: "paper-trade-agent",
          wroteWiki: false,
          wroteRaw: false,
          wroteBrain: false,
          wrotePaperTradeLedger: false,
          wroteRealTradeLedger: false,
        },
      }, null, 2)}\n`,
    )

    const verified = await verifyStockFeedbackArtifacts({ projectPath: tmpRoot })

    expect(verified.status).toBe("failed")
    expect(verified.issues.map((item) => item.code)).toEqual(expect.arrayContaining([
      "paper_trade_agent_manifest_summary_count_mismatch",
    ]))
    expect(verified.issues.filter((item) => item.code === "paper_trade_agent_manifest_summary_count_mismatch").map((item) => item.field)).toEqual(expect.arrayContaining([
      "ruleBaseline",
      "needsMarketPrice",
      "fromTrajectory",
    ]))
  })

  it("generates agent candidates from hypothesis evidence-feedback without auto-changing hypothesis state", async () => {
    const created = await createHypothesis({
      projectPath: tmpRoot,
      title: "样本科技A 预期交易可能继续扩散",
      theme: "训练飞轮",
      segments: "样本科技A,预期交易",
      keyVariables: "相对强度,成交额承接",
      risks: "close < 18",
      evidenceRefs: "self-question:hypothesis-agent-001",
      marketRefs: "price-sql:300901.SZ:2026-06-03",
      status: "watching",
      generatedAt: "2026-06-21 11:00:00",
      write: true,
    })
    const task = await createStockFeedbackEvidenceTask({
      projectPath: tmpRoot,
      stockCode: "300901.SZ",
      stockName: "样本科技A",
      taskType: "market_data",
      targetFields: "close,turnover_rate,relative_strength",
      preferredSources: "tushare,price_sql",
      source: "hypothesis",
      sourceId: created.hypothesis.id,
      sourceRefs: "self-question:hypothesis-agent-001,price-sql:300901.SZ:2026-06-03",
      generatedAt: "2026-06-21 11:05:00",
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
            structuredData: { close: 22.1, turnover_rate: 9.2, relative_strength: 5.4 },
            sourceRefs: ["tushare:daily#300901.SZ/20260621"],
          },
          {
            source: "price_sql",
            status: "ok",
            sourceQuality: 92,
            structuredData: { close: 22.1, turnover_rate: 9.2, relative_strength: 5.4 },
            sourceRefs: ["price-sql:300901.SZ:2026-06-21"],
          },
        ],
      },
      generatedAt: "2026-06-21 11:06:00",
      write: true,
    })
    const feedback = await buildHypothesisEvidenceFeedback({
      projectPath: tmpRoot,
      id: created.hypothesis.id,
      generatedAt: "2026-06-21 11:10:00",
      write: true,
    })
    expect(feedback.items[0]).toMatchObject({
      status: "watching",
      watchtowerCandidate: {
        recommendationOnly: true,
        suggestedStatus: "strengthening",
      },
      humanGate: {
        recommendedAction: "confirm_status_update",
        targetStatus: "strengthening",
      },
    })
    expect(feedback.items[0].trainingFlywheelRoutes.map((item) => item.route)).toContain("confirmed_evidence_to_trajectory")

    const status = await getStockFeedbackStatus({ projectPath: tmpRoot })
    expect(status.sampleDensityAudit.sourceInputPlan).toMatchObject({
      status: "has_upstream_inputs",
      hasTrajectorySourceInput: false,
      hasPaperAgentSourceInput: true,
      nextCommands: ["stock-feedback paper-trade-agent candidates"],
    })
    expect(status.sampleDensityAudit.sourceInputPlan.nextCommands).not.toContain("stock-feedback build-trajectories --write")

    const preview = await buildStockFeedbackPaperTradeAgentCandidates({
      projectPath: tmpRoot,
      generatedAt: "2026-06-21 11:15:00",
      limit: 4,
    })

    expect(preview.count).toBe(2)
    expect(preview.summary.counts).toMatchObject({
      fromHypothesisFeedback: 2,
      fromTrajectory: 0,
      needsMarketPrice: 2,
    })
    expect(preview.candidates.map((item) => item.sourceKind)).toEqual([
      "hypothesis_evidence_feedback",
      "hypothesis_evidence_feedback",
    ])
    expect(preview.candidates[0]).toMatchObject({
      hypothesisId: created.hypothesis.id,
      ledgerKind: "paper_trade",
      stock: {
        code: "300901.SZ",
        name: "样本科技A",
      },
      evidenceCutoff: {
        asOfDate: "2026-06-21",
        noFutureData: true,
      },
      entryPlan: expect.objectContaining({
        date: "2026-06-21",
        priceSource: "market_data_at_asof_required",
        requiredMarketFields: expect.arrayContaining(["entryPrice", "relativeStrength", "turnoverChange"]),
      }),
      exitPlan: expect.objectContaining({
        stopCondition: "close < 18",
      }),
      positionSizing: "paper_trade_unit_risk_0.35x_until_reviewed",
      readiness: {
        status: "needs_market_price",
        missingRequiredFields: ["entryPrice"],
      },
      peftBoundary: {
        storesRawFacts: false,
      },
    })
    expect(JSON.stringify(preview)).not.toContain("raw facts")
    await expect(fs.access(path.join(tmpRoot, ".llm-wiki", "stock-feedback", "paper-trade-agent"))).rejects.toThrow()
  })

  it("reserves paper-trade-agent candidate slots for hypothesis evidence-feedback", async () => {
    await write(
      path.join(tmpRoot, ".llm-wiki/stock-feedback/trajectories/agent-mixed-source-trajectories.jsonl"),
      [
        {
          id: "stockfb_agent_mixed_traj_001",
          stock: { name: "样本科技A", code: "300901.SZ", label: "样本科技A 300901.SZ" },
          summary: "轨迹候选一。",
        },
        {
          id: "stockfb_agent_mixed_traj_002",
          stock: { name: "样本科技B", code: "300902.SZ", label: "样本科技B 300902.SZ" },
          summary: "轨迹候选二。",
        },
      ].map((item) => JSON.stringify({
        schema: "stock-feedback-trajectory-v1",
        generatedAt: "2026-06-21 12:00:00",
        source: "self-question-attribution",
        sourceRecordId: `${item.id}_source`,
        validationTarget: "expectation_trade",
        qualityGate: {
          status: "expectation_validated",
          validationTarget: "expectation_trade",
          highConfidenceEligible: true,
        },
        hypothesis: "低位吸收后预期扩散。",
        eventTimeline: [{ step: "question", at: "2026-06-21", ref: `${item.id}_question` }],
        sourceRefs: [`self-question:${item.id}`],
        evidenceState: { confirmedEvidenceRefs: [`self-question:${item.id}`] },
        ...item,
      })).join("\n") + "\n",
    )
    await write(
      path.join(tmpRoot, ".llm-wiki/hypothesis-evidence-feedback/mixed-source-feedback.jsonl"),
      `${JSON.stringify({
        schema: "trading-hypothesis-evidence-feedback-v1",
        id: "hypothesis_evidence_feedback_mixed_001",
        generatedAt: "2026-06-21 12:05:00",
        hypothesisId: "hypo_mixed_feedback_001",
        hypothesisTitle: "样本科技C 证据反馈可进入模拟交易候选",
        status: "watching",
        candidateFields: {
          falsifiableConditions: ["close < 18"],
          coreDrivers: ["相对强度扩散"],
          sourceRefs: ["self-question:hypo-mixed-feedback"],
        },
        evidenceScore: { total: 82 },
        sourceRefs: ["self-question:hypo-mixed-feedback"],
        evidenceRefs: ["tushare:daily#300903.SZ/20260621"],
        stocks: [{ code: "300903.SZ", name: "样本科技C" }],
        evidenceList: [
          {
            evidenceId: "evidence_mixed_feedback_001",
            stockCode: "300903.SZ",
            stockName: "样本科技C",
            evidenceRefs: ["tushare:daily#300903.SZ/20260621"],
          },
        ],
        watchtowerCandidate: {
          recommendationOnly: true,
          suggestedStatus: "strengthening",
          reason: "证据反馈支持继续观察模拟交易。",
        },
        humanGate: { recommendedAction: "confirm_status_update" },
        trainingFlywheelRoutes: [{ route: "confirmed_evidence_to_trajectory" }],
        peftBoundary: { storesRawFacts: false },
      })}\n`,
    )

    const preview = await buildStockFeedbackPaperTradeAgentCandidates({
      projectPath: tmpRoot,
      generatedAt: "2026-06-21 12:10:00",
      limit: 4,
    })

    expect(preview.summary.counts).toMatchObject({
      total: 4,
      fromTrajectory: 2,
      fromHypothesisFeedback: 2,
    })
    expect(preview.candidates.map((item) => item.sourceKind)).toEqual([
      "stock_feedback_trajectory",
      "stock_feedback_trajectory",
      "hypothesis_evidence_feedback",
      "hypothesis_evidence_feedback",
    ])
    expect(preview.candidates.filter((item) => item.sourceKind === "hypothesis_evidence_feedback")).toHaveLength(2)
  })
})
