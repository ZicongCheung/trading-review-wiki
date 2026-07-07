import { describe, expect, it } from "vitest"

import {
  auditSubmissionKey,
  auditContextFromBatchRefreshMovement,
  benchmarkProfitCreditGapDetail,
  buildBenchmarkGapActions,
  buildDynamicTestSetPlan,
  buildAuditBatchRefreshSummary,
  buildAuditRefreshDiff,
  buildAuditReviewPrompt,
  buildAuditSubmissionNotice,
  buildBatchRefreshReviewActions,
  buildProfitFeedbackDistillationHint,
  buildProfitFeedbackDistillationReadiness,
  buildProfitFeedbackCollectionTask,
  buildProfitFeedbackListSignal,
  buildPeftBoundaryReview,
  buildPeftBoundaryActionHint,
  buildAdapterApprovalDisabledHint,
  buildAdapterApprovalButtonPresentation,
  buildProfitFeedbackReviewWorklist,
  buildReviewCycleGate,
  buildReviewCycleGateCollectionBridge,
  buildReviewCycleNextAction,
  buildReviewActionStatusHint,
  buildReviewRefreshCompletionSummary,
  buildReviewRefreshPrompt,
  buildReviewRefreshResult,
  buildPaperTradeReviewClosureSummary,
  buildBenchmarkBatchGateSummary,
  buildProfitLedgerSeparationSummary,
  buildReviewBacklogGateSummary,
  buildNextHumanReviewSuggestion,
  buildPaperTradeRecordArgs,
  buildPaperTradeRecordReadiness,
  buildPaperTradeSettlementArgs,
  buildPaperTradeSettlementDraftFromTrade,
  buildPaperTradeSettlementReadiness,
  buildPaperTradeDraftFromPlanCandidate,
  buildPaperTradePlanCandidateProbeContext,
  buildPaperTradeDraftFromTrajectory,
  buildPaperTradeDataSourceGate,
  buildPaperTradeEvidenceWindow,
  buildPaperTradeEntryPriceSuggestionPatch,
  buildPaperTradePreviewSettlementSuggestion,
  buildPaperTradeSettlementAppliedNotice,
  buildPaperTradeWriteFollowUp,
  buildEntryPriceSuggestionFromProbe,
  buildEvidenceQueueSummary,
  buildTushareDataSourceProbeArgs,
  buildReviewActionFilterOptions,
  buildReviewActionBatchPreview,
  buildReviewBucketContext,
  autoEvidenceGateCheckEntries,
  buildCollectionResultFollowUp,
  buildCollectionResultActionRoadmap,
  buildCollectionResultHistoryCard,
  buildCollectionResultHumanReviewBridge,
  buildCollectionResultNextAction,
  buildCollectionResultReviewRoutePreview,
  buildCollectionTaskDistillationPreflight,
  buildCollectionTaskReviewGuide,
  collectionTaskFromCollectionResult,
  collectionTaskFromCommandResult,
  findTrajectoryForCollectionResult,
  filterTrajectoriesByProfitFeedbackSignal,
  filterTrajectoriesByReviewAction,
  filterTrajectoriesByBatchRefreshMovement,
  peftBoundaryAllowsAdapterApproval,
  paperTradeMarketEvidenceWindowDisplay,
  paperTradeAgentDetail,
  paperTradeDiscretionaryReviewDetail,
  paperTradeDiscretionaryReviewRunnerAction,
  paperTradeDiscretionaryReviewItemLabel,
  paperTradeDiscretionaryReviewItemTone,
  paperTradeLedgerDetail,
  paperTradePlanningDetail,
  sampleDensityActionAvailability,
  sampleDensityAuditDetail,
  sampleDensityFirstSampleGuide,
  sampleDensityGapSeverityLabel,
  sampleDensityRebuildSteps,
  sampleDensitySourceInputSteps,
  sampleDensityUpstreamInputTotal,
  qualityGateCheckEntries,
  summarizePaperTradeAutoEvidenceGate,
  summarizeDataSourceProbe,
  shouldInlineCollectionResultFollowUp,
  shouldInlineProfitCollectionTask,
  visibleReviewActionOptions,
  type PaperTradeRecordDraft,
  type AuditSelectionContext,
} from "../training-flywheel-view"

describe("buildAuditReviewPrompt", () => {
  it("keeps pending downweighted LoRA refs in human review before upweighting", () => {
    const context: AuditSelectionContext = {
      sourceTitle: "LoRA-ready 来源",
      bucketId: "default_downweighted_pending_review",
      bucketLabel: "未审默认降权",
      sampling: "downsample_until_review",
      effectiveWeightMultiplier: 0.25,
      trainingWeightState: "default_downweighted_pending_review",
      refId: "adapter_candidate_context_smoke",
      adapterCapability: "预期交易判断",
    }

    const prompt = buildAuditReviewPrompt(context, {
      recommendedAction: "approve_for_adapter",
      recommendedActionLabel: "确认进入 adapter 候选",
      gate: "expectation_validated",
      canExport: true,
    })

    expect(prompt?.headline).toBe("抽查建议：先审后提权")
    expect(prompt?.detail).toContain("默认低权重")
    expect(prompt?.detail).toContain("adapter 只学习行为、技能、工具习惯和决策策略")
    expect(prompt?.actionHint).toContain("确认进入 adapter 候选")
    expect(prompt?.noteDraft).toContain("未审默认降权")
    expect(prompt?.noteDraft).toContain("权重 0.3x")
  })

  it("routes evidence-gap bucket samples toward补证 instead of positive adapter weight", () => {
    const prompt = buildAuditReviewPrompt({
      sourceTitle: "LoRA-ready 来源",
      bucketId: "evidence_gap_downweight",
      bucketLabel: "补证降权",
      sampling: "hold_for_evidence",
      effectiveWeightMultiplier: 0.2,
      trainingWeightState: "evidence_gap_downweight",
      adapterCapability: "基本面兑现判断",
    }, {
      recommendedAction: "needs_evidence",
      gate: "needs_evidence",
      canExport: false,
    })

    expect(prompt?.headline).toBe("抽查建议：先补证")
    expect(prompt?.detail).toContain("事实、公告和交易数据仍留在 retrieval/tool state")
    expect(prompt?.actionHint).toContain("转补证")
    expect(prompt?.noteDraft).toContain("不提升 adapter 权重")
  })

  it("audits approved upweight samples for PEFT fact-boundary leakage", () => {
    const prompt = buildAuditReviewPrompt({
      sourceTitle: "LoRA-ready 来源",
      bucketId: "human_approved_upweight",
      bucketLabel: "人工确认可提权",
      sampling: "priority_include",
      effectiveWeightMultiplier: 1.5,
      trainingWeightState: "human_approved_upweight",
      adapterCapability: "priced-in 风险识别",
    }, {
      recommendedAction: "approve_for_adapter",
      recommendedActionLabel: "确认进入 adapter 候选",
      gate: "priced_in_validated",
      canExport: true,
    })

    expect(prompt?.headline).toBe("抽查建议：复核提权依据")
    expect(prompt?.detail).toContain("不是把原始事实写进 adapter")
    expect(prompt?.actionHint).toContain("确认进入 adapter 候选")
    expect(prompt?.noteDraft).toContain("只沉淀行为/技能/工具习惯/决策策略")
  })
})

describe("paperTradeLedgerDetail", () => {
  it("keeps paper-trade ledger separate from high-confidence real profit samples", () => {
    const detail = paperTradeLedgerDetail({
      counts: {
        total: 3,
        open: 1,
        closed: 2,
        profitable: 1,
        loss: 1,
        flat: 0,
        byTrack: {
          rule_baseline: 1,
          llm_discretionary: 2,
        },
      },
      settlementQueue: {
        schema: "stock-feedback-paper-trade-settlement-queue-v1",
        count: 1,
        items: [{ id: "paper_open_001", status: "open" }],
      },
      settlementRefreshAudit: {
        schema: "stock-feedback-paper-trade-settlement-refresh-audit-v1",
        count: 2,
        pending: 1,
        completed: 1,
        items: [{ paperTradeId: "paper_closed_001", nextAction: "build_benchmark" }],
      },
    })

    expect(detail).toContain("模拟 3")
    expect(detail).toContain("待结算 1")
    expect(detail).toContain("待刷新 1")
    expect(detail).toContain("盈利 1")
    expect(detail).toContain("规则 1 / LLM 2")
    expect(detail).toContain("默认不进入 high-confidence")
  })

  it("explains the empty state as the next V2 paper-trade loop", () => {
    expect(paperTradeLedgerDetail({ counts: { total: 0 } })).toContain("self-question -> rule_baseline / llm_discretionary")
  })
})

describe("buildEvidenceQueueSummary", () => {
  it("prioritizes DLQ repair before review or queue runs", () => {
    const summary = buildEvidenceQueueSummary({
      tasks: [
        { taskId: "ET-1", status: "pending" },
        { taskId: "ET-2", status: "dlq" },
      ],
      results: [{ resultId: "ER-1", taskId: "ET-1", status: "awaiting_review" }],
      dlq: [{ id: "DLQ-1", taskId: "ET-2", status: "open" }],
    })

    expect(summary.nextAction).toBe("repair_dlq")
    expect(summary.tone).toBe("danger")
    expect(summary.openDlq).toBe(1)
  })

  it("routes conflicting or low-confidence results to human review", () => {
    const summary = buildEvidenceQueueSummary({
      tasks: [{ taskId: "ET-1", status: "awaiting_review" }],
      results: [{ resultId: "ER-1", taskId: "ET-1", status: "awaiting_review" }],
      dlq: [],
    })

    expect(summary.nextAction).toBe("review_results")
    expect(summary.awaitingReview).toBe(2)
    expect(summary.detail).toContain("确认")
  })

  it("treats pending tasks as runnable queue work", () => {
    const summary = buildEvidenceQueueSummary({
      tasks: [{ taskId: "ET-1", status: "pending" }],
      results: [],
      dlq: [],
    })

    expect(summary.nextAction).toBe("run_queue")
    expect(summary.pending).toBe(1)
  })

  it("shows an idle empty state when no evidence work exists", () => {
    const summary = buildEvidenceQueueSummary({})

    expect(summary.nextAction).toBe("idle")
    expect(summary.headline).toContain("暂无任务")
  })
})

describe("paperTradePlanningDetail", () => {
  it("shows the dual-track paper-trade candidate gap before ledgers exist", () => {
    const detail = paperTradePlanningDetail({
      counts: {
        eligibleTrajectories: 1,
        candidates: 2,
        missingEntryPrice: 2,
      },
    })

    expect(detail).toContain("候选 2")
    expect(detail).toContain("轨迹 1")
    expect(detail).toContain("待补 entryPrice 2")
    expect(detail).toContain("paper_trade 账本")
    expect(detail).toContain("不触碰真实交易")
  })

  it("keeps the empty planning state pointed at expectation_trade review", () => {
    expect(paperTradePlanningDetail({ counts: { candidates: 0 } })).toContain("expectation_trade")
  })
})

describe("paperTradeAgentDetail", () => {
  it("summarizes the V2 agent candidate queue without treating it as real profit", () => {
    const detail = paperTradeAgentDetail({
      schema: "stock-feedback-paper-trade-agent-summary-v1",
      strategy: "self_question_hypothesis_evidence_to_dual_track_paper_trade_candidate_v1",
      counts: {
        total: 4,
        ruleBaseline: 2,
        llmDiscretionary: 2,
        needsMarketPrice: 3,
        blocked: 1,
        fromTrajectory: 2,
        fromHypothesisFeedback: 2,
      },
    })

    expect(detail).toContain("Agent 候选 4")
    expect(detail).toContain("规则 2")
    expect(detail).toContain("LLM 2")
    expect(detail).toContain("来自轨迹 2")
    expect(detail).toContain("来自假设反馈 2")
    expect(detail).toContain("待补入口价 3")
    expect(detail).toContain("blocked 1")
  })

  it("keeps the empty agent state pointed at hypothesis feedback or expectation trajectories", () => {
    expect(paperTradeAgentDetail({ counts: { total: 0 } })).toContain("hypothesis evidence-feedback")
  })
})

describe("paperTradeDiscretionaryReviewDetail", () => {
  it("keeps the discretionary runner gated until paired settled evidence exists", () => {
    const detail = paperTradeDiscretionaryReviewDetail({
      schema: "stock-feedback-discretionary-review-audit-v1",
      status: "blocked",
      counts: {
        llmAgentCandidates: 2,
        llmPaperTrades: 1,
        pairedRuleBaselineTrades: 1,
        openLlmPaperTrades: 1,
        readyPairs: 0,
      },
      nextAction: "settle_llm_discretionary_trade",
      writeBoundary: { readOnly: true },
    })

    expect(detail).toContain("LLM 账本 1")
    expect(detail).toContain("成对基准 1")
    expect(detail).toContain("open 1")
    expect(detail).toContain("先结算 LLM 自主样本")
  })

  it("labels paired closed discretionary samples as eval-ready rather than adapter truth", () => {
    const detail = paperTradeDiscretionaryReviewDetail({
      schema: "stock-feedback-discretionary-review-audit-v1",
      status: "ready",
      counts: {
        llmAgentCandidates: 2,
        llmPaperTrades: 1,
        pairedRuleBaselineTrades: 1,
        openLlmPaperTrades: 0,
        readyPairs: 1,
      },
      nextAction: "ready_for_discretionary_review_runner",
      peftBoundary: { storesRawFacts: false },
      writeBoundary: { readOnly: true },
    })

    expect(detail).toContain("ready 1")
    expect(detail).toContain("eval/preference")
    expect(detail).toContain("不自动提权")
  })

  it("enables the read-only discretionary review runner only for ready pairs", () => {
    expect(paperTradeDiscretionaryReviewRunnerAction({
      schema: "stock-feedback-discretionary-review-audit-v1",
      status: "ready",
      counts: {
        readyPairs: 2,
        llmPaperTrades: 2,
        pairedRuleBaselineTrades: 2,
      },
      nextAction: "ready_for_discretionary_review_runner",
      writeBoundary: { readOnly: true },
    })).toMatchObject({
      enabled: true,
      label: "预览 LLM 复盘",
      detail: expect.stringContaining("ready 2"),
    })

    expect(paperTradeDiscretionaryReviewRunnerAction({
      schema: "stock-feedback-discretionary-review-audit-v1",
      status: "blocked",
      counts: {
        readyPairs: 0,
        llmPaperTrades: 1,
        openLlmPaperTrades: 1,
      },
      nextAction: "settle_llm_discretionary_trade",
      writeBoundary: { readOnly: true },
    })).toMatchObject({
      enabled: false,
      label: "等待 LLM 复盘",
      detail: expect.stringContaining("先结算 LLM 自主样本"),
    })
  })

  it("labels discretionary review item blockers with stable tones", () => {
    expect(paperTradeDiscretionaryReviewItemLabel({
      nextAction: "record_or_settle_rule_baseline_pair",
    })).toContain("补齐同源 rule_baseline 基准")
    expect(paperTradeDiscretionaryReviewItemTone({
      nextAction: "settle_llm_discretionary_trade",
      readyForReview: false,
    })).toBe("warn")
    expect(paperTradeDiscretionaryReviewItemTone({
      nextAction: "attach_asof_source_and_evidence_refs",
      readyForReview: false,
    })).toBe("danger")
    expect(paperTradeDiscretionaryReviewItemTone({
      nextAction: "ready_for_discretionary_review_runner",
      readyForReview: true,
    })).toBe("good")
  })
})

describe("sampleDensityAuditDetail", () => {
  it("keeps write actions guarded until sample-density prerequisites exist", () => {
    const availability = sampleDensityActionAvailability({
      status: "blocked",
      counts: {
        trajectories: 0,
        paperTradeAgentPreviewCandidates: 0,
        paperTradeAgentWrittenCandidates: 0,
        reviewedPaperAdapterTrajectories: 0,
      },
    })

    expect(availability).toMatchObject({
      canBuildTrajectories: false,
      canWriteAgentCandidates: false,
      canBuildBenchmark: false,
      canExportLoraReady: false,
    })
    expect(availability.buildTrajectoriesReason).toContain("等待自提问归因")
    expect(availability.writeAgentCandidatesReason).toContain("等待 Agent 预览候选")
    expect(availability.buildBenchmarkReason).toContain("等待轨迹或已写 Agent 候选")
    expect(availability.exportLoraReadyReason).toContain("等待可导出的轨迹")
  })

  it("opens benchmark only after trajectories or persisted agent candidates exist", () => {
    const availability = sampleDensityActionAvailability({
      status: "thin",
      counts: {
        trajectories: 0,
        paperTradeAgentPreviewCandidates: 2,
        paperTradeAgentWrittenCandidates: 2,
        reviewedPaperAdapterTrajectories: 0,
      },
    })

    expect(availability).toMatchObject({
      canWriteAgentCandidates: true,
      canBuildBenchmark: true,
      canExportLoraReady: false,
    })
    expect(availability.buildBenchmarkReason).toContain("可生成 Benchmark")
  })

  it("allows trajectory build only after upstream feedback inputs exist", () => {
    const availability = sampleDensityActionAvailability({
      status: "blocked",
      counts: {
        trajectories: 0,
        hasTrajectorySourceInput: true,
        paperTradeAgentPreviewCandidates: 0,
        paperTradeAgentWrittenCandidates: 0,
      },
    })

    expect(availability.canBuildTrajectories).toBe(true)
    expect(availability.buildTrajectoriesReason).toContain("已有上游输入")
  })

  it("summarizes upstream input counts separately from trajectories", () => {
    expect(sampleDensityUpstreamInputTotal({
      counts: {
        upstreamInputs: {
          brainRecords: 2,
          hypothesisEvidenceFeedback: 3,
          collectionResults: 1,
          paperTrades: 4,
        },
      },
    })).toBe(10)
  })

  it("points a fully empty audit at the first hypothesis evidence-feedback write", () => {
    const guide = sampleDensityFirstSampleGuide({
      status: "blocked",
      counts: {
        trajectories: 0,
        paperTradeAgentPreviewCandidates: 0,
        upstreamInputs: {
          brainRecords: 0,
          hypothesisEvidenceFeedback: 0,
          collectionResults: 0,
          paperTrades: 0,
        },
      },
      sourceInputPlan: {
        status: "needs_upstream_inputs",
      },
    })

    expect(guide).toMatchObject({
      status: "needs_input",
      primaryAction: "hypothesis_feedback_write",
      primaryLabel: "生成假设证据反馈",
      secondaryAction: "manual_self_question_preview",
    })
    expect(guide.detail).toContain("Hypothesis evidence-feedback")
  })

  it("points existing trajectory source input at writing the first stock-feedback trajectory", () => {
    const guide = sampleDensityFirstSampleGuide({
      status: "blocked",
      counts: {
        trajectories: 0,
        hasTrajectorySourceInput: true,
        hasPaperAgentSourceInput: true,
        paperTradeAgentPreviewCandidates: 0,
      },
      sourceInputPlan: {
        status: "has_upstream_inputs",
        hasTrajectorySourceInput: true,
        hasPaperAgentSourceInput: true,
      },
    })

    expect(guide).toMatchObject({
      status: "rebuild",
      primaryAction: "build_trajectories_write",
      primaryLabel: "写入第一条轨迹",
      secondaryAction: "paper_trade_agent_preview",
    })
    expect(guide.detail).toContain("stock-feedback-trajectory-v1")
  })

  it("routes hypothesis evidence-feedback only input to paper trade agent preview", () => {
    const guide = sampleDensityFirstSampleGuide({
      status: "blocked",
      counts: {
        trajectories: 0,
        hasPaperAgentSourceInput: true,
        paperTradeAgentPreviewCandidates: 0,
      },
      sourceInputPlan: {
        status: "has_upstream_inputs",
        hasPaperAgentSourceInput: true,
      },
    })

    expect(guide).toMatchObject({
      status: "agent_source",
      primaryAction: "paper_trade_agent_preview",
      primaryLabel: "预览 Agent 候选",
      secondaryAction: "hypothesis_feedback_write",
    })
  })

  it("turns no-input audit commands into a focused source-input route", () => {
    const steps = sampleDensitySourceInputSteps({
      sourceInputPlan: {
        status: "needs_upstream_inputs",
        nextCommands: [
          "self-question loop --stages generate,validate,attribute --write",
          "hypothesis evidence-feedback --status watching --write",
          "stock-feedback collection-task --write",
        ],
      },
      recommendedCommands: [
        { id: "collect_self_question_feedback", label: "生成自提问反馈", command: "self-question loop --stages generate,validate,attribute --write" },
        { id: "collect_hypothesis_feedback", label: "生成假设证据反馈", command: "hypothesis evidence-feedback --status watching --write" },
        { id: "create_collection_task", label: "创建补样本任务", command: "stock-feedback collection-task --write" },
      ],
    })

    expect(steps.map((item) => item.command)).toEqual([
      "self-question loop --stages generate,validate,attribute --write",
      "hypothesis evidence-feedback --status watching --write",
      "stock-feedback collection-task --write",
    ])
    expect(steps.map((item) => item.actionKind)).toEqual([
      "manual_command",
      "hypothesis_feedback_write",
      "collection_task_write",
    ])
    expect(steps.map((item) => item.label)).toEqual([
      "生成自提问反馈",
      "生成假设证据反馈",
      "创建补样本任务",
    ])
  })

  it("turns trajectory source inputs into a focused rebuild route", () => {
    const steps = sampleDensityRebuildSteps({
      counts: {
        trajectories: 0,
        hasTrajectorySourceInput: true,
        paperTradeAgentPreviewCandidates: 0,
      },
      sourceInputPlan: {
        status: "has_upstream_inputs",
        hasTrajectorySourceInput: true,
        hasPaperAgentSourceInput: true,
        nextCommands: [
          "stock-feedback build-trajectories --write",
          "stock-feedback paper-trade-agent candidates",
        ],
      },
      recommendedCommands: [
        { id: "no_stock_feedback_trajectories", label: "缺少训练轨迹", command: "stock-feedback build-trajectories --write" },
        { id: "no_paper_trade_agent_preview_candidates", label: "缺少 Agent 预览候选", command: "stock-feedback paper-trade-agent candidates" },
      ],
    })

    expect(steps.map((item) => item.command)).toEqual([
      "stock-feedback build-trajectories --write",
      "stock-feedback paper-trade-agent candidates",
    ])
    expect(steps.map((item) => item.actionKind)).toEqual([
      "build_trajectories_write",
      "paper_trade_agent_preview",
    ])
    expect(steps.map((item) => item.label)).toEqual([
      "缺少训练轨迹",
      "缺少 Agent 预览候选",
    ])
  })

  it("keeps sample-density guidance pointed at the next closed-loop command", () => {
    const detail = sampleDensityAuditDetail({
      schema: "stock-feedback-sample-density-audit-v1",
      status: "blocked",
      tone: "danger",
      headline: "样本密度不足，训练闭环被阻塞",
      counts: {
        upstreamInputs: {
          brainRecords: 0,
          hypothesisEvidenceFeedback: 0,
          collectionResults: 0,
          paperTrades: 0,
        },
        trajectories: 0,
        expectationTradeTrajectories: 0,
        paperTradeAgentPreviewCandidates: 0,
        paperTradeAgentWrittenCandidates: 0,
        settledPaperTrades: 0,
        benchmarkBatches: 0,
        loraReadyBatches: 0,
      },
      gaps: [
        {
          id: "no_stock_feedback_trajectories",
          label: "缺少上游反馈输入",
          severity: "blocked",
          nextAction: "collect_self_question_or_hypothesis_feedback",
          command: "self-question loop --stages generate,validate,attribute --write",
        },
      ],
      peftBoundary: {
        storesRawFacts: false,
      },
    })

    expect(detail).toContain("样本密度不足")
    expect(detail).toContain("上游输入 0")
    expect(detail).toContain("轨迹 0")
    expect(detail).toContain("Agent 已写 0")
    expect(detail).toContain("self-question loop")
    expect(detail).toContain("adapter 只存行为、技能、工具习惯和决策策略")
  })

  it("labels blocked and warning sample-density gaps for the panel", () => {
    expect(sampleDensityGapSeverityLabel("blocked")).toBe("阻塞")
    expect(sampleDensityGapSeverityLabel("warn")).toBe("待补")
    expect(sampleDensityGapSeverityLabel("info")).toBe("观察")
  })
})

describe("paperTradeMarketEvidenceWindowDisplay", () => {
  it("summarizes normal and exceeded paper-trade evidence windows for review", () => {
    expect(paperTradeMarketEvidenceWindowDisplay({
      expectedWindow: "2026-06-03..2026-06-10",
      actualWindow: "2026-06-03..2026-06-07",
      status: "ok",
      exceededExpectedEnd: false,
    })).toMatchObject({
      label: "窗口正常",
      value: "2026-06-03..2026-06-07",
      detail: "计划 2026-06-03..2026-06-10",
      tone: "good",
    })

    expect(paperTradeMarketEvidenceWindowDisplay({
      expectedWindow: "2026-06-03..2026-06-10",
      actualWindow: "2026-06-03..2026-06-18",
      status: "exceeded_expected_end",
      exceededExpectedEnd: true,
    })).toMatchObject({
      label: "窗口越界",
      value: "2026-06-03..2026-06-18",
      detail: "计划 2026-06-03..2026-06-10",
      tone: "warn",
    })
  })
})

describe("buildProfitLedgerSeparationSummary", () => {
  it("blocks real high-confidence promotion when no profitable execution evidence exists", () => {
    const summary = buildProfitLedgerSeparationSummary({
      counts: {
        confirmedCollectionResults: 0,
        paperTrades: 0,
      },
      summary: {
        byProfitCredit: {},
        byProfitOutcome: {},
      },
    })

    expect(summary.headline).toBe("等待真实盈利执行样本")
    expect(summary.blocksHighConfidenceProfit).toBe(true)
    expect(summary.paperOnly).toBe(false)
    expect(summary.nextAction).toContain("collection-result")
  })

  it("keeps profitable paper trades out of real high-confidence samples", () => {
    const summary = buildProfitLedgerSeparationSummary({
      counts: {
        confirmedCollectionResults: 0,
        paperTrades: 2,
        paperTradeProfitable: 1,
      },
      summary: {
        byProfitCredit: {
          paper_pattern_execution_supported: 1,
        },
        byProfitOutcome: {
          profitable: 1,
        },
      },
      paperTradeLedger: {
        counts: {
          total: 2,
          profitable: 1,
        },
      },
    })

    expect(summary.headline).toBe("仅有模拟收益或 paper trade 线索")
    expect(summary.blocksHighConfidenceProfit).toBe(true)
    expect(summary.paperOnly).toBe(true)
    expect(summary.paperProfitable).toBe(1)
    expect(summary.detail).toContain("不能进入真实盈利 high-confidence")
  })

  it("allows real execution samples to proceed only after confirmation", () => {
    const summary = buildProfitLedgerSeparationSummary({
      counts: {
        confirmedCollectionResults: 1,
      },
      summary: {
        byProfitCredit: {
          pattern_execution_supported: 1,
        },
        byProfitOutcome: {
          profitable: 1,
        },
      },
    })

    expect(summary.headline).toBe("真实执行样本可人审提权")
    expect(summary.blocksHighConfidenceProfit).toBe(false)
    expect(summary.realPatternExecutionSamples).toBe(1)
    expect(summary.nextAction).toContain("LoRA-ready")
  })
})

describe("buildBenchmarkBatchGateSummary", () => {
  it("blocks artifact closure when dynamic cases have not been persisted", () => {
    const summary = buildBenchmarkBatchGateSummary({
      counts: {
        benchmarkBatches: 0,
        dynamicBenchmarkGaps: 7,
      },
      dynamicBenchmark: {
        counts: {
          totalCases: 47,
          reviewedCases: 2,
        },
        coverageGaps: [
          { bucket: "profit_credit", id: "pattern_execution_supported", label: "收益支持手法执行" },
        ],
      },
      latest: {
        benchmarkManifest: null,
      },
    })

    expect(summary.headline).toBe("Benchmark 仍是临时计算")
    expect(summary.blocksArtifactClosure).toBe(true)
    expect(summary.dynamicCases).toBe(47)
    expect(summary.coverageGaps).toBe(1)
    expect(summary.detail).toContain("没有写入 benchmark manifest")
  })

  it("marks persisted benchmark batches as usable source mix inputs", () => {
    const summary = buildBenchmarkBatchGateSummary({
      counts: {
        benchmarkBatches: 0,
      },
      dynamicBenchmark: {
        counts: {
          totalCases: 12,
          reviewedCases: 3,
        },
        coverageGaps: [],
      },
      latest: {
        benchmarkManifest: ".llm-wiki/stock-feedback/benchmarks/benchmark-20260620.manifest.json",
      },
    })

    expect(summary.headline).toBe("Benchmark 批次已落地")
    expect(summary.blocksArtifactClosure).toBe(false)
    expect(summary.persistedBatches).toBe(1)
    expect(summary.manifest).toContain("benchmark-20260620")
    expect(summary.nextAction).toContain("pending review")
  })
})

describe("buildReviewBacklogGateSummary", () => {
  it("blocks the top-level loop when review events still need trainable batch refresh", () => {
    const summary = buildReviewBacklogGateSummary({
      reviewQueue: {
        counts: {
          pending: 44,
          reviewed: 3,
          reviewEvents: 4,
          byRecommendedAction: {
            route_to_preference: 19,
            needs_evidence: 25,
          },
        },
      },
      pendingRefreshes: [
        {
          headline: "已记录人工分流",
          detail: "标记 priced-in 已记录",
          action: "mark_priced_in",
          actionLabel: "标记 priced-in",
          resultLabel: "priced_in",
          nextStep: "下一步：重建轨迹并刷新 LoRA-ready。",
          refreshLabel: "重建并刷新 LoRA-ready",
          tone: "warn",
        },
      ],
    })

    expect(summary.headline).toBe("先刷新训练批次")
    expect(summary.blocksReviewClosure).toBe(true)
    expect(summary.pendingTrainableRefreshes).toBe(1)
    expect(summary.primaryActionKind).toBe("refresh_lora_ready")
    expect(summary.primaryActionLabel).toBe("重建并刷新 LoRA-ready")
    expect(summary.detail).toContain("review ledger")
    expect(summary.nextAction).toContain("batch delta")
  })

  it("prioritizes preference and negative review routing when risk samples are pending", () => {
    const summary = buildReviewBacklogGateSummary({
      reviewQueue: {
        counts: {
          total: 47,
          pending: 45,
          reviewed: 2,
          reviewEvents: 3,
          byRecommendedAction: {
            route_to_preference: 20,
            needs_evidence: 25,
            approve_for_adapter: 2,
          },
        },
      },
      nextSuggestion: {
        trajectoryId: "stockfb_risk",
        label: "失败预期样本",
        detail: "进入偏好/负样本",
        actionLabel: "进入偏好/负样本",
        tone: "warn",
        source: "risk_feedback",
      },
    })

    expect(summary.headline).toBe("先审风险/负样本")
    expect(summary.blocksReviewClosure).toBe(true)
    expect(summary.pending).toBe(45)
    expect(summary.routeToPreference).toBe(20)
    expect(summary.primaryActionLabel).toBe("进入偏好/负样本")
    expect(summary.nextAction).toContain("LoRA-ready")
  })

  it("routes evidence-only backlog toward sourceRefs and tool-state补证", () => {
    const summary = buildReviewBacklogGateSummary({
      status: {
        counts: {
          pendingReviews: 12,
          reviewedTrajectories: 4,
          reviewEvents: 5,
        },
      },
      reviewQueue: {
        counts: {
          pending: 12,
          byRecommendedAction: {
            needs_evidence: 12,
          },
        },
      },
    })

    expect(summary.headline).toBe("先处理补证样本")
    expect(summary.blocksReviewClosure).toBe(true)
    expect(summary.needsEvidence).toBe(12)
    expect(summary.detail).toContain("retrieval/tool state")
    expect(summary.nextAction).toContain("collection-result")
  })

  it("prioritizes reviewed paper adapter candidates as low-weight simulation positives", () => {
    const summary = buildReviewBacklogGateSummary({
      reviewQueue: {
        counts: {
          pending: 3,
          reviewed: 4,
          reviewEvents: 4,
          byRecommendedAction: {
            approve_paper_adapter_candidate: 3,
          },
        },
      },
      nextSuggestion: {
        trajectoryId: "stockfb_paper",
        label: "paper trade 盈利样本",
        detail: "模拟收益支持手法，但只允许低权重进入 adapter 候选",
        actionLabel: "人审 paper adapter 正样本",
        tone: "warn",
        source: "paper_trade",
      },
    })

    expect(summary.headline).toBe("复核 paper adapter 正样本")
    expect(summary.blocksReviewClosure).toBe(true)
    expect(summary.paperAdapterCandidates).toBe(3)
    expect(summary.detail).toContain("模拟收益")
    expect(summary.nextAction).toContain("低权重")
    expect(summary.primaryActionLabel).toBe("人审 paper adapter 正样本")
  })

  it("marks the review gate clear when no pending review remains", () => {
    const summary = buildReviewBacklogGateSummary({
      status: {
        counts: {
          pendingReviews: 0,
          reviewedTrajectories: 47,
          reviewEvents: 50,
        },
      },
      reviewQueue: {
        counts: {
          pending: 0,
          reviewed: 47,
          reviewEvents: 50,
          byRecommendedAction: {},
        },
      },
    })

    expect(summary.headline).toBe("Review backlog 已清空")
    expect(summary.tone).toBe("good")
    expect(summary.blocksReviewClosure).toBe(false)
    expect(summary.nextAction).toContain("verify")
  })
})

describe("review action filters", () => {
  it("builds actionable review queue buckets from recommended actions", () => {
    const options = buildReviewActionFilterOptions({
      counts: {
        pending: 45,
        reviewed: 2,
          byRecommendedAction: {
            route_to_preference: 20,
            mark_priced_in: 1,
            mark_entry_wrong: 1,
            needs_evidence: 25,
            approve_for_adapter: 2,
            approve_paper_adapter_candidate: 3,
          },
        },
      })

    expect(options.map((option) => [option.id, option.count])).toEqual([
      ["all", 45],
      ["route_to_preference", 22],
      ["needs_evidence", 25],
      ["approve_for_adapter", 2],
      ["approve_paper_adapter_candidate", 3],
    ])
    expect(options.find((option) => option.id === "route_to_preference")).toMatchObject({
      label: "偏好/负样本",
      tone: "warn",
    })
  })

  it("falls back to pending queue items when aggregate counts are absent", () => {
    const options = buildReviewActionFilterOptions({
      items: [
        { sourceTrajectoryId: "risk", recommendedAction: "route_to_preference", reviewStatus: "pending" },
        { sourceTrajectoryId: "priced", recommendedAction: "mark_priced_in", reviewStatus: "pending" },
        { sourceTrajectoryId: "evidence", recommendedAction: "needs_evidence", reviewStatus: "pending" },
        { sourceTrajectoryId: "paper", recommendedAction: "approve_paper_adapter_candidate", reviewStatus: "pending" },
        { sourceTrajectoryId: "approved", recommendedAction: "approve_for_adapter", reviewStatus: "reviewed" },
      ],
    })

    expect(options.map((option) => [option.id, option.count])).toEqual([
      ["all", 4],
      ["route_to_preference", 2],
      ["needs_evidence", 1],
      ["approve_for_adapter", 0],
      ["approve_paper_adapter_candidate", 1],
    ])
  })

  it("filters visible trajectories by pending review action", () => {
    const trajectories = [
      { id: "risk" },
      { id: "priced" },
      { id: "entry" },
      { id: "evidence" },
      { id: "adapter" },
      { id: "paper" },
      { id: "reviewed" },
    ]
    const reviewByTrajectory = new Map([
      ["risk", { sourceTrajectoryId: "risk", recommendedAction: "route_to_preference", reviewStatus: "pending" }],
      ["priced", { sourceTrajectoryId: "priced", recommendedAction: "mark_priced_in", reviewStatus: "pending" }],
      ["entry", { sourceTrajectoryId: "entry", humanActionPlan: { recommendedAction: "mark_entry_wrong" }, reviewStatus: "pending" }],
      ["evidence", { sourceTrajectoryId: "evidence", recommendedAction: "needs_evidence", reviewStatus: "pending" }],
      ["adapter", { sourceTrajectoryId: "adapter", recommendedAction: "approve_for_adapter", reviewStatus: "pending" }],
      ["paper", { sourceTrajectoryId: "paper", recommendedAction: "approve_paper_adapter_candidate", reviewStatus: "pending" }],
      ["reviewed", { sourceTrajectoryId: "reviewed", recommendedAction: "route_to_preference", reviewStatus: "reviewed" }],
    ])

    expect(filterTrajectoriesByReviewAction(trajectories, reviewByTrajectory, "all").map((item) => item.id)).toEqual([
      "risk",
      "priced",
      "entry",
      "evidence",
      "adapter",
      "paper",
      "reviewed",
    ])
    expect(filterTrajectoriesByReviewAction(trajectories, reviewByTrajectory, "route_to_preference").map((item) => item.id)).toEqual([
      "risk",
      "priced",
      "entry",
    ])
    expect(filterTrajectoriesByReviewAction(trajectories, reviewByTrajectory, "needs_evidence").map((item) => item.id)).toEqual(["evidence"])
    expect(filterTrajectoriesByReviewAction(trajectories, reviewByTrajectory, "approve_for_adapter").map((item) => item.id)).toEqual(["adapter"])
    expect(filterTrajectoriesByReviewAction(trajectories, reviewByTrajectory, "approve_paper_adapter_candidate").map((item) => item.id)).toEqual(["paper"])
  })

  it("builds a no-bulk-write safety preview for the active review action bucket", () => {
    const trajectories = [
      {
        id: "risk",
        hypothesis: "冲高回落后无承接",
        validationTarget: "disconfirmation",
        qualityGate: { status: "disconfirmed_validated" },
        stock: { name: "样本A", code: "000001.SZ" },
      },
      {
        id: "priced",
        question: "方向对但后手风险",
        validationTarget: "priced_in_risk",
        qualityGate: { status: "priced_in_validated" },
        stock: { name: "样本B", code: "000002.SZ" },
      },
      {
        id: "entry",
        hypothesis: "追高后回撤扩大",
        validationTarget: "expectation_trade",
        qualityGate: { status: "review_required" },
      },
      {
        id: "evidence",
        hypothesis: "证据缺口",
        validationTarget: "expectation_trade",
        qualityGate: { status: "needs_evidence" },
      },
    ]
    const reviewByTrajectory = new Map([
      ["risk", { sourceTrajectoryId: "risk", recommendedAction: "route_to_preference", reviewStatus: "pending" }],
      ["priced", { sourceTrajectoryId: "priced", recommendedAction: "mark_priced_in", reviewStatus: "pending" }],
      ["entry", { sourceTrajectoryId: "entry", humanActionPlan: { recommendedAction: "mark_entry_wrong" }, reviewStatus: "pending" }],
      ["evidence", { sourceTrajectoryId: "evidence", recommendedAction: "needs_evidence", reviewStatus: "pending" }],
    ])

    const preview = buildReviewActionBatchPreview(trajectories, reviewByTrajectory, "route_to_preference", { limit: 2 })

    expect(preview).toMatchObject({
      filter: "route_to_preference",
      label: "偏好/负样本",
      count: 3,
      hiddenCount: 1,
      firstTrajectoryId: "risk",
      canBulkWrite: false,
      tone: "warn",
    })
    expect(preview?.guardrail).toContain("不批量写")
    expect(preview?.actionCounts).toEqual({
      route_to_preference: 1,
      mark_priced_in: 1,
      mark_entry_wrong: 1,
    })
    expect(preview?.items.map((item) => [item.trajectoryId, item.title, item.actionLabel, item.targetLabel, item.gateLabel])).toEqual([
      ["risk", "冲高回落后无承接", "进入偏好/负样本", "失败归因", "失败样本"],
      ["priced", "方向对但后手风险", "标记 priced-in", "priced-in", "后手风险"],
    ])
  })

  it("does not show a batch preview without an active bucket or matching pending reviews", () => {
    const trajectories = [{ id: "reviewed", hypothesis: "已处理" }]
    const reviewByTrajectory = new Map([
      ["reviewed", { sourceTrajectoryId: "reviewed", recommendedAction: "approve_for_adapter", reviewStatus: "reviewed" }],
    ])

    expect(buildReviewActionBatchPreview(trajectories, reviewByTrajectory, "all")).toBeNull()
    expect(buildReviewActionBatchPreview(trajectories, reviewByTrajectory, "approve_for_adapter")).toBeNull()
  })

  it("builds right-detail context only when the selected trajectory belongs to the active bucket", () => {
    const trajectories = [
      { id: "risk", hypothesis: "失败承接", validationTarget: "disconfirmation", qualityGate: { status: "disconfirmed_validated" } },
      { id: "priced", hypothesis: "后手拥挤", validationTarget: "priced_in_risk", qualityGate: { status: "priced_in_validated" } },
      { id: "evidence", hypothesis: "等待补证", validationTarget: "expectation_trade", qualityGate: { status: "needs_evidence" } },
    ]
    const reviewByTrajectory = new Map([
      ["risk", { sourceTrajectoryId: "risk", recommendedAction: "route_to_preference", reviewStatus: "pending" }],
      ["priced", { sourceTrajectoryId: "priced", recommendedAction: "mark_priced_in", reviewStatus: "reviewed" }],
      ["evidence", { sourceTrajectoryId: "evidence", recommendedAction: "needs_evidence", reviewStatus: "pending" }],
    ])

    const context = buildReviewBucketContext(trajectories, reviewByTrajectory, "route_to_preference", "risk")

    expect(context).toMatchObject({
      filter: "route_to_preference",
      label: "偏好/负样本",
      selectedTrajectoryId: "risk",
      selectedAction: "route_to_preference",
      selectedActionLabel: "进入偏好/负样本",
      totalCount: 2,
      pendingCount: 1,
      reviewedCount: 1,
      position: 1,
      completionPct: 50,
      completionLabel: "已审 1/2",
      selectedReviewStatus: "pending",
    })

    expect(buildReviewBucketContext(trajectories, reviewByTrajectory, "route_to_preference", "evidence")).toBeNull()
    expect(buildReviewBucketContext(trajectories, reviewByTrajectory, "all", "risk")).toBeNull()
  })
})

describe("paper trade record form helpers", () => {
  const baseDraft: PaperTradeRecordDraft = {
    track: "llm_discretionary",
    validationTarget: "expectation_trade",
    stockCode: "SZ300901",
    stockName: "样本科技A",
    asOfDate: "2026-06-03",
    sourceQuestionId: "question_asof_001",
    sourceTrajectoryId: "trajectory_asof_001",
    hypothesis: "只使用 asOfDate 前可见的扩散和承接证据。",
    expectedMove: "预期后续 3 日继续相对强势。",
    entryDate: "2026-06-03",
    entryPrice: "10.00",
    entryTiming: "低吸确认",
    exitDate: "2026-06-06",
    exitPrice: "10.80",
    exitTiming: "承接转弱兑现",
    exitReason: "赔率压缩",
    positionSizing: "probe_15pct",
    realizedPnlPct: "8",
    maxDrawdownPct: "1.6",
    holdingDays: "3",
    autoMarketEvidence: true,
    autoMicrostructureEvidence: true,
    microstructureDate: "2026-06-04",
    marketEvidenceProvider: "tushare",
    marketEvidenceBenchmarkCode: "000001.SH",
    priceSqlRef: "",
    marketDataRef: "",
    marketEvidenceSource: "",
    marketEvidenceEndDate: "",
    marketEvidenceLookaheadDays: "7",
    marketEvidenceRows: "",
    periodReturnPct: "",
    relativeStrength: "",
    relativeStrengthBasis: "",
    turnoverChange: "",
    followThrough1d: "",
    followThrough3d: "6.2",
    followThrough5d: "",
    maxDrawdownInHolding: "",
    sourceRefs: "self-question:question_asof_001",
    evidenceRefs: "price-sql:SZ300901:asof-2026-06-03",
  }

  it("blocks paper-trade record writes until the evidence cutoff and refs are present", () => {
    const readiness = buildPaperTradeRecordReadiness({
      ...baseDraft,
      asOfDate: "",
      sourceRefs: "",
      evidenceRefs: "",
      autoMarketEvidence: false,
    })

    expect(readiness.ready).toBe(false)
    expect(readiness.missing).toEqual(expect.arrayContaining(["asOfDate 证据截止日", "sourceRefs", "evidenceRefs 或行情证据"]))
    expect(readiness.detail).toContain("还缺")
  })

  it("allows automatic market evidence to satisfy paper-trade evidence refs", () => {
    const readiness = buildPaperTradeRecordReadiness({
      ...baseDraft,
      evidenceRefs: "",
      autoMarketEvidence: true,
      marketEvidenceProvider: "tushare",
    })

    expect(readiness.ready).toBe(true)
  })

  it("builds fixed paper-trade record args with asOfDate and evidence refs", () => {
    const args = buildPaperTradeRecordArgs(baseDraft)

    expect(args).toEqual(expect.arrayContaining([
      "--track",
      "llm_discretionary",
      "--validation-target",
      "expectation_trade",
      "--as-of-date",
      "2026-06-03",
      "--source-trajectory-id",
      "trajectory_asof_001",
      "--source-refs",
      "self-question:question_asof_001",
      "--evidence-refs",
      "price-sql:SZ300901:asof-2026-06-03",
      "--max-drawdown-pct",
      "1.6",
      "--auto-market-evidence",
      "--auto-microstructure-evidence",
      "--microstructure-date",
      "2026-06-04",
      "--market-evidence-provider",
      "tushare",
      "--market-evidence-benchmark-code",
      "000001.SH",
      "--follow-through-3d",
      "6.2",
    ]))
    expect(args).not.toContain("")
  })

  it("builds a focused settlement draft and args from an open paper trade", () => {
    const draft = buildPaperTradeSettlementDraftFromTrade({
      id: "stockfb_paper_trade_001",
      status: "open",
      stock: { name: "样本科技A", code: "SZ300901" },
      entry: { date: "2026-06-03", price: 10 },
      marketEvidenceProvider: "tushare",
      evidenceRefs: ["tushare:daily#300901.SZ/20260603"],
    })

    expect(draft).toMatchObject({
      paperTradeId: "stockfb_paper_trade_001",
      exitDate: "",
      exitPrice: "",
      autoMarketEvidence: true,
      marketEvidenceProvider: "tushare",
      marketEvidenceBenchmarkCode: "000001.SH",
      evidenceRefs: "tushare:daily#300901.SZ/20260603",
    })

    const readyDraft = {
      ...draft,
      exitDate: "2026-06-06",
      exitPrice: "10.80",
      maxDrawdownPct: "1.2",
      holdingDays: "3",
      exitReason: "规则目标达到后止盈",
      evidenceRefs: `${draft.evidenceRefs},price-sql:SZ300901:exit-2026-06-06`,
    }
    expect(buildPaperTradeSettlementReadiness(readyDraft)).toMatchObject({
      ready: true,
      missing: [],
    })
    const args = buildPaperTradeSettlementArgs(readyDraft)

    expect(args).toEqual(expect.arrayContaining([
      "--paper-trade-id",
      "stockfb_paper_trade_001",
      "--exit-date",
      "2026-06-06",
      "--exit-price",
      "10.80",
      "--max-drawdown-pct",
      "1.2",
      "--holding-days",
      "3",
      "--exit-reason",
      "规则目标达到后止盈",
      "--evidence-refs",
      "tushare:daily#300901.SZ/20260603,price-sql:SZ300901:exit-2026-06-06",
      "--auto-market-evidence",
      "--market-evidence-provider",
      "tushare",
    ]))
    expect(args).not.toContain("")
  })

  it("builds a settlement patch from paper-trade dry-run market evidence", () => {
    const suggestion = buildPaperTradePreviewSettlementSuggestion({
      ...baseDraft,
      exitDate: "",
      exitPrice: "",
      realizedPnlPct: "",
      maxDrawdownPct: "",
      holdingDays: "",
      priceSqlRef: "",
      marketDataRef: "",
      evidenceRefs: "self-question:question_asof_001",
      exitTiming: "",
      exitReason: "",
    }, {
      dryRun: true,
      marketEvidenceProvider: "tushare",
      paperTrade: {
        id: "stockfb_paper_trade_preview",
        evidenceRefs: ["tushare:daily#300901.SZ/20260606", "tushare:index_daily#000001.SH/20260606"],
        entry: { date: "2026-06-03", price: 10 },
        marketEvidence: {
          source: "tushare_http",
          priceSqlRef: "tushare:daily#300901.SZ/20260606",
          marketDataRef: "tushare:daily+daily_basic:300901.SZ:2026-06-03..2026-06-06",
          benchmarkRef: "tushare:index_daily#000001.SH/20260606",
          startDate: "2026-06-03",
          endDate: "2026-06-06",
          rows: 4,
          closeEnd: 10.8,
          periodReturnPct: 8,
          relativeStrength: 6,
          relativeStrengthBasis: "excess_return_pct_vs_000001.SH",
          turnoverChange: 2,
          followThrough1d: 2,
          followThrough3d: 8,
          followThrough5d: 8,
          maxDrawdownInHolding: 1.6,
        },
        marketEvidenceWindow: {
          exceededExpectedEnd: false,
        },
      },
    })

    expect(suggestion).toMatchObject({
      headline: "可应用预览收益",
      badge: "tushare_http",
      diff: expect.arrayContaining([
        expect.objectContaining({
          field: "exitDate",
          label: "出场日期",
          before: "",
          after: "2026-06-06",
          action: "fill",
        }),
        expect.objectContaining({
          field: "exitPrice",
          label: "出场价格",
          before: "",
          after: "10.8",
          action: "fill",
        }),
        expect.objectContaining({
          field: "evidenceRefs",
          label: "证据引用",
          before: "self-question:question_asof_001",
          action: "update",
        }),
      ]),
      patch: {
        exitDate: "2026-06-06",
        exitPrice: "10.8",
        realizedPnlPct: "8",
        maxDrawdownPct: "1.6",
        holdingDays: "3",
        marketEvidenceRows: "4",
        priceSqlRef: "tushare:daily#300901.SZ/20260606",
        marketDataRef: "tushare:daily+daily_basic:300901.SZ:2026-06-03..2026-06-06",
        marketEvidenceSource: "tushare_http",
        periodReturnPct: "8",
        relativeStrength: "6",
        turnoverChange: "2",
        followThrough3d: "8",
        maxDrawdownInHolding: "1.6",
        exitTiming: "market_evidence_window_close",
        exitReason: "按预览行情窗口结算，用于 paper_trade 训练闭环",
      },
    })
    expect(suggestion?.patch.evidenceRefs).toContain("self-question:question_asof_001")
    expect(suggestion?.patch.evidenceRefs).toContain("tushare:daily#300901.SZ/20260606")
    expect(suggestion?.detail).toContain("pnl 8%")
    expect(suggestion?.diff.some((item) => item.field === "entryPrice")).toBe(false)
    expect(buildPaperTradeSettlementAppliedNotice(suggestion)).toMatchObject({
      headline: "已应用预览收益",
      badge: "tushare_http",
      appliedFieldCount: suggestion?.diff.length,
      fieldLabels: expect.arrayContaining(["出场日期", "出场价格", "收益率"]),
    })
    expect(buildPaperTradeSettlementAppliedNotice(suggestion)?.detail).toContain("下一步可预览确认或写入并重建")
  })

  it("does not offer settlement patches when automatic evidence is blocked", () => {
    const suggestion = buildPaperTradePreviewSettlementSuggestion(baseDraft, {
      dryRun: true,
      paperTrade: {
        id: "stockfb_paper_trade_blocked",
        autoEvidenceGate: {
          status: "blocked",
          blocksWrite: true,
          detail: "market_evidence_window exceeded expected end",
        },
        marketEvidenceWindow: {
          exceededExpectedEnd: true,
        },
        marketEvidence: {
          endDate: "2026-06-18",
          closeEnd: 11.2,
          periodReturnPct: 12,
        },
      },
    })

    expect(suggestion).toBeNull()
    expect(buildPaperTradeSettlementAppliedNotice(suggestion)).toBeNull()
  })

  it("does not keep offering a settlement action after all preview fields are already applied", () => {
    const suggestion = buildPaperTradePreviewSettlementSuggestion({
      ...baseDraft,
      exitDate: "2026-06-06",
      exitPrice: "10.8",
      realizedPnlPct: "8",
      maxDrawdownPct: "1.6",
      holdingDays: "3",
      marketEvidenceEndDate: "2026-06-06",
      marketEvidenceRows: "4",
      priceSqlRef: "tushare:daily#300901.SZ/20260606",
      marketDataRef: "tushare:daily+daily_basic:300901.SZ:2026-06-03..2026-06-06",
      marketEvidenceSource: "tushare_http",
      periodReturnPct: "8",
      relativeStrength: "6",
      relativeStrengthBasis: "excess_return_pct_vs_000001.SH",
      turnoverChange: "2",
      followThrough1d: "2",
      followThrough3d: "8",
      followThrough5d: "8",
      maxDrawdownInHolding: "1.6",
      evidenceRefs: "self-question:question_asof_001,tushare:daily#300901.SZ/20260606,tushare:index_daily#000001.SH/20260606,tushare:daily+daily_basic:300901.SZ:2026-06-03..2026-06-06",
      exitTiming: "market_evidence_window_close",
      exitReason: "按预览行情窗口结算，用于 paper_trade 训练闭环",
    }, {
      dryRun: true,
      marketEvidenceProvider: "tushare",
      paperTrade: {
        id: "stockfb_paper_trade_preview",
        evidenceRefs: ["tushare:daily#300901.SZ/20260606", "tushare:index_daily#000001.SH/20260606"],
        entry: { date: "2026-06-03", price: 10 },
        marketEvidence: {
          source: "tushare_http",
          priceSqlRef: "tushare:daily#300901.SZ/20260606",
          marketDataRef: "tushare:daily+daily_basic:300901.SZ:2026-06-03..2026-06-06",
          benchmarkRef: "tushare:index_daily#000001.SH/20260606",
          startDate: "2026-06-03",
          endDate: "2026-06-06",
          rows: 4,
          closeEnd: 10.8,
          periodReturnPct: 8,
          relativeStrength: 6,
          relativeStrengthBasis: "excess_return_pct_vs_000001.SH",
          turnoverChange: 2,
          followThrough1d: 2,
          followThrough3d: 8,
          followThrough5d: 8,
          maxDrawdownInHolding: 1.6,
        },
        marketEvidenceWindow: {
          exceededExpectedEnd: false,
        },
      },
    })

    expect(suggestion).toBeNull()
  })

  it("prefills paper-trade record context from the selected trajectory without overwriting manual prices", () => {
    const draft = buildPaperTradeDraftFromTrajectory({
      id: "trajectory_001",
      sourceRecordId: "self_question_001",
      validationTarget: "priced_in_risk",
      hypothesis: "当时看好扩散承接。",
      summary: "预期 3 日内继续放量。",
      stock: { code: "SZ300901", name: "样本科技A" },
      sourceRefs: ["retrieval:sourceRefs#001"],
      eventTimeline: [{ at: "2026-06-03 09:40:00" }],
      evidenceState: {
        confirmedEvidenceRefs: ["price-sql:SZ300901:asof-2026-06-03"],
        marketEvidence: {
          source: "tushare_http",
          priceSqlRef: "tushare:daily#300901.SZ/20260606",
          benchmarkCode: "000001.SH",
          followThrough3d: 6.2,
          turnoverChange: 1.5,
          maxDrawdownInHolding: 1.4,
        },
      },
      profitFeedback: {
        entryTiming: "低吸确认",
        positionSizing: "probe_15pct",
        realizedPnlPct: 8,
      },
    }, {
      ...baseDraft,
      stockCode: "",
      stockName: "",
      asOfDate: "",
      entryDate: "",
      entryPrice: "9.90",
      sourceRefs: "",
      evidenceRefs: "",
    })

    expect(draft.validationTarget).toBe("priced_in_risk")
    expect(draft.stockCode).toBe("SZ300901")
    expect(draft.asOfDate).toBe("2026-06-03")
    expect(draft.entryDate).toBe("2026-06-03")
    expect(draft.entryPrice).toBe("9.90")
    expect(draft.sourceQuestionId).toBe("self_question_001")
    expect(draft.sourceRefs).toContain("retrieval:sourceRefs#001")
    expect(draft.evidenceRefs).toContain("price-sql:SZ300901:asof-2026-06-03")
    expect(draft.positionSizing).toBe("probe_15pct")
    expect(draft.priceSqlRef).toBe("tushare:daily#300901.SZ/20260606")
    expect(draft.marketEvidenceBenchmarkCode).toBe("000001.SH")
    expect(draft.marketEvidenceSource).toBe("tushare_http")
    expect(draft.followThrough3d).toBe("6.2")
    expect(draft.turnoverChange).toBe("1.5")
  })

  it("summarizes expected and actual market evidence windows for preflight review", () => {
    const planned = buildPaperTradeEvidenceWindow({
      ...baseDraft,
      status: "open",
      exitDate: "",
      entryDate: "2024-06-03",
      marketEvidenceEndDate: "",
      marketEvidenceLookaheadDays: "7",
    })

    expect(planned).toMatchObject({
      tone: "neutral",
      label: "预计行情窗口",
      expectedWindow: "2024-06-03..2024-06-10",
      displayedWindow: "2024-06-03..2024-06-10",
      noFutureDataLabel: "asOf=2026-06-03",
      detail: "未预览，写入前将按该窗口请求行情证据。",
    })

    const actual = buildPaperTradeEvidenceWindow({
      ...baseDraft,
      exitDate: "",
    }, {
      marketEvidenceNativeQuery: {
        language: "Tushare",
        summary: "daily + daily_basic 300901.SZ 20240603..20240610; index_daily 000001.SH",
        table: "tushare.daily+tushare.daily_basic+tushare.index_daily",
        limit: 5,
        tickerCandidates: ["300901.SZ", "000001.SH"],
      },
      paperTrade: {
        asOfDate: "2026-06-03",
        evidenceCutoff: { asOfDate: "2026-06-03", noFutureData: true },
        marketEvidence: {
          source: "tushare_http",
          startDate: "2024-06-03",
          endDate: "2024-06-07",
          marketDataRef: "tushare:daily+daily_basic:300901.SZ:2024-06-03..2024-06-07",
          rows: 5,
        },
      },
    })

    expect(actual).toMatchObject({
      tone: "good",
      label: "实际行情窗口",
      expectedWindow: "2026-06-03..2026-06-10",
      displayedWindow: "2024-06-03..2024-06-07",
      rowLabel: "5 行",
      noFutureDataLabel: "noFutureData=true · asOf=2026-06-03",
      nativeQuery: "Tushare: daily + daily_basic 300901.SZ 20240603..20240610; index_daily 000001.SH",
      detail: "自动证据已回流；核对实际返回窗口没有越过预期查询范围。",
    })

    const leaked = buildPaperTradeEvidenceWindow(baseDraft, {
      paperTrade: {
        asOfDate: "2026-06-03",
        evidenceCutoff: { asOfDate: "2026-06-03", noFutureData: true },
        marketEvidence: {
          startDate: "2026-06-03",
          endDate: "2026-06-18",
          rows: 12,
        },
      },
    })

    expect(leaked).toMatchObject({
      tone: "warn",
      displayedWindow: "2026-06-03..2026-06-18",
      detail: "实际返回窗口超过预期查询范围，写入前请改行情截止日或检查 provider。",
    })
  })

  it("turns a paper-trade planning candidate into a clean record draft", () => {
    const candidate = {
      track: "rule_baseline",
      sourceTrajectoryId: "stockfb_plan_traj_001",
      sourceQuestionId: "selfq_plan_001",
      validationTarget: "expectation_trade",
      stock: {
        code: "SH688017",
        name: "绿的谐波",
      },
      asOfDate: "2026-06-15",
      hypothesis: "机器人预期先于订单落地。",
      expectedMove: "预期 3 日内相对强度继续扩散。",
      entry: {
        date: "2026-06-15",
        price: null,
        timing: "as-of 价待补",
      },
      positionSizing: "probe_then_add",
      sourceRefs: ["data/brain/attributions.jsonl", "trajectory-source:selfqa_1"],
      evidenceRefs: ["wiki/股票/绿的谐波.md"],
      readiness: {
        status: "needs_market_price",
        missingRequiredFields: ["entryPrice"],
      },
    }
    const draft = buildPaperTradeDraftFromPlanCandidate(candidate, {
      ...baseDraft,
      entryPrice: "99.99",
      exitDate: "2026-06-20",
      exitPrice: "88.88",
      realizedPnlPct: "-10",
      autoMarketEvidence: false,
      autoMicrostructureEvidence: false,
      marketEvidenceProvider: "stock_daily_sql",
    })

    expect(draft).toMatchObject({
      track: "rule_baseline",
      validationTarget: "expectation_trade",
      stockCode: "SH688017",
      stockName: "绿的谐波",
      asOfDate: "2026-06-15",
      sourceQuestionId: "selfq_plan_001",
      sourceTrajectoryId: "stockfb_plan_traj_001",
      entryDate: "2026-06-15",
      entryPrice: "",
      exitDate: "",
      exitPrice: "",
      realizedPnlPct: "",
      autoMarketEvidence: true,
      autoMicrostructureEvidence: false,
      microstructureDate: "2026-06-15",
      marketEvidenceProvider: "tushare",
      sourceRefs: "data/brain/attributions.jsonl,trajectory-source:selfqa_1",
      evidenceRefs: "wiki/股票/绿的谐波.md",
    })
    expect(buildTushareDataSourceProbeArgs(buildPaperTradePlanCandidateProbeContext(candidate))).toEqual([
      "--tushare-timeout-ms",
      "15000",
      "--stock-code",
      "SH688017",
      "--trade-date",
      "2026-06-15",
    ])
    expect(buildPaperTradeDraftFromPlanCandidate(candidate, {
      ...baseDraft,
      autoMicrostructureEvidence: true,
      marketEvidenceProvider: "stock_daily_sql",
    })).toMatchObject({
      autoMarketEvidence: true,
      autoMicrostructureEvidence: true,
      marketEvidenceProvider: "tushare",
    })
  })
})

describe("paper trade write follow-up helpers", () => {
  it("keeps dry-run previews out of the training loop until written and rebuilt", () => {
    const followUp = buildPaperTradeWriteFollowUp({
      dryRun: true,
      paperTrade: {
        id: "stockfb_paper_trade_preview",
        track: "llm_discretionary",
        status: "closed",
        asOfDate: "2026-06-03",
      },
    })

    expect(followUp).toMatchObject({
      tone: "neutral",
      headline: "模拟交易预览已生成",
      badge: "dry-run",
      paperTradeId: "stockfb_paper_trade_preview",
      matchedTrajectoryId: null,
    })
    expect(followUp?.detail).toContain("当前只是 dry-run")
    expect(followUp?.nextSteps).toEqual(expect.arrayContaining([
      "点击写入并重建，生成可人审的 stock-feedback trajectory",
    ]))
    expect(followUp?.actions).toEqual([])
  })

  it("routes blocked automatic evidence previews back to evidence repair", () => {
    const followUp = buildPaperTradeWriteFollowUp({
      dryRun: true,
      paperTrade: {
        id: "stockfb_paper_trade_blocked",
        autoEvidenceGate: {
          status: "blocked",
          blocksWrite: true,
          detail: "market_evidence:unavailable:Tushare token is not configured",
          checks: [{ id: "market_evidence", provider: "tushare", status: "unavailable", passed: false }],
        },
      },
    })

    expect(followUp).toMatchObject({
      tone: "danger",
      headline: "预览发现自动证据阻断",
      badge: "不能写入",
    })
    expect(followUp?.detail).toContain("避免把无证据收益推入训练")
    expect(followUp?.nextSteps[0]).toContain("sourceRefs")
    expect(followUp?.actions).toEqual([])
  })

  it("points successful writes at the matched trajectory and human review loop", () => {
    const followUp = buildPaperTradeWriteFollowUp({
      dryRun: false,
      writeResult: { paperTrade: ".llm-wiki/stock-feedback/paper-trades/stock-feedback-paper-trades.jsonl" },
      artifactRefreshPlan: {
        schema: "stock-feedback-paper-trade-settlement-refresh-plan-v1",
        status: "needs_refresh_after_settlement",
        paperTradeId: "stockfb_paper_trade_written",
        staleArtifacts: ["trajectories", "benchmark", "lora_ready"],
        stages: [
          { id: "rebuild_trajectories", label: "重建轨迹", command: "stock-feedback build-trajectories --write", status: "pending" },
          { id: "build_benchmark", label: "生成 Benchmark", command: "stock-feedback bench --write", status: "pending_after_trajectory" },
          { id: "refresh_lora_ready", label: "刷新 LoRA-ready", command: "stock-feedback export-lora-ready --write", status: "blocked_until_human_review" },
        ],
        reviewGate: {
          paperTradeRequiresHumanReview: true,
          loraReadyRefreshBlockedUntilReview: true,
          reason: "paper trade requires human review before LoRA-ready weight refresh",
        },
      },
      paperTrade: {
        id: "stockfb_paper_trade_written",
        track: "rule_baseline",
        status: "closed",
      },
    }, {
      writeCompleted: true,
      matchedTrajectoryId: "stockfb_traj_paper_trade_written",
    })

    expect(followUp).toMatchObject({
      tone: "good",
      headline: "已写入并定位训练轨迹",
      badge: "轨迹已选中",
      paperTradeId: "stockfb_paper_trade_written",
      matchedTrajectoryId: "stockfb_traj_paper_trade_written",
      artifactRefreshPlan: {
        status: "needs_refresh_after_settlement",
        staleArtifacts: ["trajectories", "benchmark", "lora_ready"],
      },
    })
    expect(followUp?.detail).toContain("右侧详情做人审分流")
    expect(followUp?.nextSteps).toEqual(expect.arrayContaining([
      "人审后重建轨迹并刷新 LoRA-ready，检查 batch delta",
    ]))
    expect(followUp?.actions).toEqual([
      expect.objectContaining({
        id: "build_benchmark",
        label: "生成 Benchmark",
        enabled: true,
      }),
      expect.objectContaining({
        id: "refresh_lora_ready_after_review",
        label: "人审后刷新 LoRA-ready",
        enabled: false,
      }),
    ])
  })

  it("warns when a written paper trade is not matched back into trajectories", () => {
    const followUp = buildPaperTradeWriteFollowUp({
      dryRun: false,
      writeResult: { paperTrade: ".llm-wiki/stock-feedback/paper-trades/stock-feedback-paper-trades.jsonl" },
      paperTrade: {
        id: "stockfb_paper_trade_orphan",
      },
    }, {
      writeCompleted: true,
      matchedTrajectoryId: null,
    })

    expect(followUp).toMatchObject({
      tone: "warn",
      headline: "已写入但未定位到训练轨迹",
      badge: "待核对",
      matchedTrajectoryId: null,
    })
    expect(followUp?.nextSteps).toEqual(expect.arrayContaining([
      "运行 stock-feedback verify 检查 paper_trade 与 trajectory 引用",
    ]))
    expect(followUp?.actions).toEqual([
      expect.objectContaining({
        id: "verify_refs",
        enabled: false,
      }),
    ])
  })
})

describe("Tushare data source probe helpers", () => {
  it("builds a bounded probe command from the selected trajectory context", () => {
    const args = buildTushareDataSourceProbeArgs({
      stock: { code: "SZ300901", name: "样本科技A" },
      evidenceState: { asOfDate: "2026-06-03" },
      eventTimeline: [{ at: "2026-06-01 09:35:00" }],
    })

    expect(args).toEqual([
      "--tushare-timeout-ms",
      "15000",
      "--stock-code",
      "SZ300901",
      "--trade-date",
      "2026-06-03",
    ])
  })

  it("summarizes Tushare coverage without exposing endpoint rows", () => {
    const summary = summarizeDataSourceProbe({
      status: "ok",
      query: { stockCode: "300901.SZ", tradeDate: "20260604" },
      credentialStatus: { configured: true, auth: "keychain" },
      coverage: { total: 10, ok: 10, failed: 0, skipped: 0 },
      endpoints: [{ api: "daily", status: "ok", rowCount: 1, fieldCount: 7 }],
      writePolicy: { wroteSecrets: false, returnedRows: false },
    })

    expect(summary).toMatchObject({
      tone: "good",
      headline: "Tushare 可用",
      badge: "可用",
    })
    expect(summary.detail).toContain("10/10 通过")
    expect(summary.detail).toContain("auth=keychain")
    expect(summary.detail).toContain("300901.SZ")
  })

  it("builds a paper-trade entry price suggestion from a matched Tushare probe", () => {
    const suggestion = buildEntryPriceSuggestionFromProbe({
      status: "ok",
      query: { stockCode: "300901.SZ", tradeDate: "20260604" },
      credentialStatus: { configured: true, auth: "keychain" },
      entryPriceSuggestion: {
        provider: "tushare",
        source: "tushare:daily",
        ref: "tushare:daily#300901.SZ/20260604",
        stockCode: "300901.SZ",
        tradeDate: "20260604",
        priceType: "close",
        price: 10.8,
        rowCount: 1,
        rawRowsReturned: false,
      },
    }, {
      stockCode: "SZ300901",
      entryDate: "2026-06-04",
      asOfDate: "2026-06-03",
    })

    expect(suggestion).toMatchObject({
      label: "收盘价 10.8",
      value: "10.8",
      ref: "tushare:daily#300901.SZ/20260604",
      provider: "tushare",
      source: "tushare:daily",
      rowCount: 1,
    })
    expect(suggestion?.detail).toContain("300901.SZ/20260604")
  })

  it("builds a reusable patch for applying Tushare entry price suggestions", () => {
    expect(buildPaperTradeEntryPriceSuggestionPatch({
      entryPrice: "",
      priceSqlRef: "",
      marketEvidenceProvider: "stock_daily_sql",
      marketEvidenceSource: "",
    }, {
      label: "收盘价 10.8",
      detail: "tushare",
      value: "10.8",
      ref: "tushare:daily#300901.SZ/20260604",
      provider: "tushare",
      source: "tushare:daily",
      rowCount: 1,
    })).toEqual({
      entryPrice: "10.8",
      priceSqlRef: "tushare:daily#300901.SZ/20260604",
      marketEvidenceProvider: "tushare",
      marketEvidenceSource: "tushare:daily",
      autoMarketEvidence: true,
    })

    expect(buildPaperTradeEntryPriceSuggestionPatch({
      priceSqlRef: "manual:price-ref",
      marketEvidenceSource: "manual_source",
    }, {
      label: "收盘价 10.8",
      detail: "tushare",
      value: "10.8",
      ref: "tushare:daily#300901.SZ/20260604",
      provider: "tushare",
      source: "tushare:daily",
      rowCount: 1,
    })).toMatchObject({
      entryPrice: "10.8",
      priceSqlRef: "manual:price-ref",
      marketEvidenceSource: "manual_source",
    })
  })

  it("hides stale Tushare entry price suggestions when draft stock or date differs", () => {
    const probe = {
      status: "ok",
      entryPriceSuggestion: {
        ref: "tushare:daily#300901.SZ/20260604",
        stockCode: "300901.SZ",
        tradeDate: "20260604",
        price: 10.8,
      },
    }

    expect(buildEntryPriceSuggestionFromProbe(probe, {
      stockCode: "SH688017",
      entryDate: "2026-06-04",
      asOfDate: "",
    })).toBeNull()
    expect(buildEntryPriceSuggestionFromProbe(probe, {
      stockCode: "SZ300901",
      entryDate: "2026-06-05",
      asOfDate: "",
    })).toBeNull()
  })

  it("marks missing Tushare credentials as a blocking data-source issue", () => {
    const summary = summarizeDataSourceProbe({
      status: "unavailable",
      credentialStatus: { configured: false, auth: "missing" },
      endpoints: [{ api: "daily", status: "skipped", rowCount: 0, fieldCount: 0 }],
      writePolicy: { wroteSecrets: false, returnedRows: false },
    })

    expect(summary.tone).toBe("danger")
    expect(summary.headline).toBe("Tushare 未配置")
    expect(summary.badge).toBe("未配置")
  })

  it("warns before Tushare-dependent paper trade writes have been checked", () => {
    const gate = buildPaperTradeDataSourceGate({
      autoMarketEvidence: true,
      autoMicrostructureEvidence: false,
      marketEvidenceProvider: "tushare",
    })

    expect(gate).toMatchObject({
      status: "needs_check",
      tone: "warn",
      blocksWrite: false,
    })
    expect(gate.detail).toContain("未检查不阻断")
  })

  it("blocks Tushare-dependent paper trade writes when credentials are unavailable", () => {
    const gate = buildPaperTradeDataSourceGate({
      autoMarketEvidence: false,
      autoMicrostructureEvidence: true,
      marketEvidenceProvider: "stock_daily_sql",
    }, {
      status: "unavailable",
      credentialStatus: { configured: false, auth: "missing" },
      endpoints: [{ api: "limit_list_d", status: "skipped", rowCount: 0 }],
      writePolicy: { wroteSecrets: false, returnedRows: false },
    })

    expect(gate).toMatchObject({
      status: "blocked",
      tone: "danger",
      blocksWrite: true,
    })
    expect(gate.detail).toContain("改用手工 evidenceRefs")
  })
})

describe("paper trade auto evidence gate helpers", () => {
  it("summarizes blocked automatic evidence checks for human补证 review", () => {
    const summary = summarizePaperTradeAutoEvidenceGate({
      status: "blocked",
      blocksWrite: true,
      detail: "market_evidence:unavailable:Tushare token is not configured",
      checks: [
        {
          id: "market_evidence",
          provider: "tushare",
          status: "unavailable",
          warning: "Tushare token is not configured",
          passed: false,
        },
      ],
    })

    expect(summary).toMatchObject({
      tone: "danger",
      headline: "自动证据阻断",
      badge: "阻断写入",
      blocksWrite: true,
    })
    expect(summary.detail).toContain("market_evidence:unavailable")
    expect(summary.entries[0]).toMatchObject({
      label: "行情证据",
      providerLabel: "Tushare",
      statusLabel: "不可用",
      passed: false,
      tone: "danger",
    })
  })

  it("keeps ready automatic evidence as review context rather than raw fact storage", () => {
    const entries = autoEvidenceGateCheckEntries({
      status: "ready",
      blocksWrite: false,
      checks: [
        { id: "market_evidence", provider: "stock_daily_sql", status: "ok", passed: true },
        { id: "microstructure_evidence", provider: "tushare", status: "ok", passed: true },
      ],
    })
    const summary = summarizePaperTradeAutoEvidenceGate({
      status: "ready",
      blocksWrite: false,
      checks: [
        { id: "market_evidence", provider: "stock_daily_sql", status: "ok", passed: true },
        { id: "microstructure_evidence", provider: "tushare", status: "ok", passed: true },
      ],
    })

    expect(summary).toMatchObject({
      tone: "good",
      headline: "自动证据就绪",
      badge: "可复核",
      blocksWrite: false,
    })
    expect(entries.map((entry) => [entry.label, entry.providerLabel, entry.statusLabel, entry.passed])).toEqual([
      ["行情证据", "price SQL", "通过", true],
      ["微结构证据", "Tushare", "通过", true],
    ])
  })

  it("renders missing historical gate payloads as pending回流 instead of adapter evidence", () => {
    const summary = summarizePaperTradeAutoEvidenceGate(null)

    expect(summary).toMatchObject({
      tone: "neutral",
      headline: "自动证据未回流",
      badge: "待回流",
      blocksWrite: false,
      entries: [],
    })
    expect(summary.detail).toContain("等待 paper trade 自动证据回流")
  })
})

describe("qualityGateCheckEntries", () => {
  it("turns priced-in risk check results into ordered review labels", () => {
    const entries = qualityGateCheckEntries({
      negativeExecution: true,
      crowdedHeat: true,
      entryRiskText: false,
      relayEvidence: true,
    })

    expect(entries.map((entry) => [entry.id, entry.label, entry.passed])).toEqual([
      ["crowdedHeat", "热度拥挤", true],
      ["relayEvidence", "接力证据", true],
      ["negativeExecution", "负反馈", true],
      ["entryRiskText", "后手文本", false],
    ])
    expect(entries[0].detail).toContain("THS/东财")
    expect(entries[3].detail).toContain("后手")
  })
})

describe("audit submission feedback", () => {
  it("keys submitted reviews by ref id before falling back to trajectory id", () => {
    expect(auditSubmissionKey({
      refKind: "adapter_candidate",
      refId: "adapter_candidate_1",
      sourceTrajectoryId: "trajectory_1",
    })).toBe("ref:adapter_candidate:adapter_candidate_1")

    expect(auditSubmissionKey({
      sourceTrajectoryId: "trajectory_1",
    })).toBe("trajectory:trajectory_1")
  })

  it("shows submitted adapter reviews as waiting for rebuilt LoRA-ready weights", () => {
    const notice = buildAuditSubmissionNotice({
      sourceTitle: "LoRA-ready 来源",
      bucketId: "default_downweighted_pending_review",
      bucketLabel: "未审默认降权",
      refKind: "adapter_candidate",
      refId: "adapter_candidate_1",
    }, {
      action: "approve_for_adapter",
      result: "recorded",
    })

    expect(notice?.key).toBe("ref:adapter_candidate:adapter_candidate_1")
    expect(notice?.headline).toBe("已提交 review，等待刷新训练权重")
    expect(notice?.detail).toContain("当前批次 manifest 仍显示提交前权重")
    expect(notice?.detail).toContain("重建轨迹/重导出后会刷新 bucket 和有效权重")
    expect(notice?.nextStep).toContain("重导出 LoRA-ready")
    expect(notice?.refreshLabel).toBe("重建并刷新 LoRA-ready")
    expect(notice?.tone).toBe("good")
  })

  it("keeps evidence review submissions pointed at补证回流 before retraining", () => {
    const notice = buildAuditSubmissionNotice({
      sourceTitle: "Benchmark 来源",
      sourceTrajectoryId: "trajectory_needs_evidence",
      bucketId: "evidence_gap_downweight",
      bucketLabel: "补证降权",
    }, {
      action: "needs_evidence",
      actionLabel: "转补证",
      result: "recorded",
    })

    expect(notice?.key).toBe("trajectory:trajectory_needs_evidence")
    expect(notice?.actionLabel).toBe("转补证")
    expect(notice?.nextStep).toContain("补证回流后重建轨迹")
    expect(notice?.refreshLabel).toBeNull()
    expect(notice?.tone).toBe("warn")
  })

  it("prompts regular trajectory reviews to refresh trainable artifacts after routing changes", () => {
    const adapterPrompt = buildReviewRefreshPrompt({
      action: "approve_for_adapter",
      actionLabel: "确认进入 adapter 候选",
      result: "approved",
    })
    expect(adapterPrompt).toMatchObject({
      headline: "已记录人工分流",
      actionLabel: "确认进入 adapter 候选",
      refreshLabel: "重建并刷新 LoRA-ready",
      tone: "good",
    })
    expect(adapterPrompt?.detail).toContain("adapter")
    expect(adapterPrompt?.nextStep).toContain("batch delta")

    const riskPrompt = buildReviewRefreshPrompt({
      action: "mark_priced_in",
      result: "priced_in",
    })
    expect(riskPrompt).toMatchObject({
      actionLabel: "标记 priced-in",
      refreshLabel: "重建并刷新 LoRA-ready",
      tone: "warn",
    })
    expect(riskPrompt?.detail).toContain("eval/preference")

    const evidencePrompt = buildReviewRefreshPrompt({
      action: "needs_evidence",
      result: "needs_evidence",
    })
    expect(evidencePrompt).toMatchObject({
      refreshLabel: null,
      tone: "warn",
    })
    expect(evidencePrompt?.nextStep).toContain("补证回流")
  })

  it("summarizes pending LoRA weights beside human review actions", () => {
    const auditContext: AuditSelectionContext = {
      sourceTitle: "LoRA-ready 来源",
      bucketId: "default_downweighted_pending_review",
      bucketLabel: "未审默认降权",
      sampling: "downsample_until_review",
      effectiveWeightMultiplier: 0.25,
      trainingWeightState: "default_downweighted_pending_review",
      refKind: "adapter_candidate",
      refId: "adapter_candidate_1",
      sourceTrajectoryId: "trajectory_1",
      adapterCapability: "预期交易判断",
    }
    const auditPrompt = buildAuditReviewPrompt(auditContext, {
      recommendedAction: "approve_for_adapter",
      recommendedActionLabel: "确认进入 adapter 候选",
      gate: "expectation_validated",
      canExport: true,
    })

    const hint = buildReviewActionStatusHint({
      auditContext,
      auditPrompt,
      recommendedAction: "approve_for_adapter",
      recommendedActionLabel: "确认进入 adapter 候选",
      canExport: true,
      peftAllowsAdapter: true,
    })

    expect(hint).toMatchObject({
      headline: "提交前：未审默认降权",
      tone: "warn",
    })
    expect(hint.detail).toContain("确认进入 adapter 候选")
    expect(hint.detail).toContain("提交后先重建并刷新 LoRA-ready")
    expect(hint.chips).toEqual(expect.arrayContaining(["权重 0.3x", "人审前降采样", "抽查建议：先审后提权"]))
  })

  it("keeps refresh guidance visible when adapter approval is gated", () => {
    const auditContext: AuditSelectionContext = {
      sourceTitle: "LoRA-ready 来源",
      bucketId: "default_downweighted_pending_review",
      bucketLabel: "未审默认降权",
      sampling: "downsample_until_review",
      effectiveWeightMultiplier: 0.25,
      trainingWeightState: "default_downweighted_pending_review",
      refKind: "adapter_candidate",
      refId: "adapter_candidate_1",
      sourceTrajectoryId: "trajectory_1",
    }

    const hint = buildReviewActionStatusHint({
      auditContext,
      recommendedAction: "approve_for_adapter",
      recommendedActionLabel: "确认进入 adapter 候选",
      canExport: false,
      peftAllowsAdapter: true,
    })

    expect(hint).toMatchObject({
      headline: "提交前：未审默认降权",
      tone: "warn",
    })
    expect(hint.detail).toContain("当前不满足直接 adapter 条件")
    expect(hint.detail).toContain("提交后先重建并刷新 LoRA-ready")
    expect(hint.detail).toContain("权重没有误提")
  })

  it("shows review actions as locked until a refresh result is visible", () => {
    const prompt = buildReviewRefreshPrompt({
      action: "approve_for_adapter",
      actionLabel: "确认进入 adapter 候选",
      result: "approved",
    })
    const gate = buildReviewCycleGate({ reviewRefreshPrompt: prompt })

    const hint = buildReviewActionStatusHint({
      reviewCycleGate: gate,
      recommendedAction: "approve_for_adapter",
      recommendedActionLabel: "确认进入 adapter 候选",
    })

    expect(hint).toMatchObject({
      headline: "人审已锁定，先刷新训练批次",
      tone: "good",
    })
    expect(hint.detail).toContain("重复分流")
    expect(hint.chips).toEqual(expect.arrayContaining(["确认进入 adapter 候选", "重建并刷新 LoRA-ready"]))
  })

  it("shows refreshed LoRA weights before the next human review action", () => {
    const hint = buildReviewActionStatusHint({
      refreshDiff: {
        key: "ref:adapter_candidate:adapter_candidate_1",
        headline: "训练权重已刷新",
        beforeLabel: "未审默认降权 / 权重 0.3x",
        afterLabel: "人工确认可提权 / 权重 1.2x",
        detail: "已刷新",
        tone: "good",
      },
      recommendedAction: "approve_for_adapter",
      recommendedActionLabel: "确认进入 adapter 候选",
    })

    expect(hint).toMatchObject({
      headline: "权重刷新已确认",
      tone: "good",
    })
    expect(hint.detail).toContain("未审默认降权 / 权重 0.3x -> 人工确认可提权 / 权重 1.2x")
    expect(hint.chips).toEqual(expect.arrayContaining(["训练权重已刷新", "确认进入 adapter 候选"]))
  })

  it("locks repeated human routing after a review is recorded until refresh evidence arrives", () => {
    const prompt = buildReviewRefreshPrompt({
      action: "mark_priced_in",
      result: "priced_in",
    })
    const gate = buildReviewCycleGate({ reviewRefreshPrompt: prompt })

    expect(gate).toMatchObject({
      locked: true,
      headline: "已记录，先刷新训练批次",
      actionLabel: "标记 priced-in",
      refreshLabel: "重建并刷新 LoRA-ready",
      tone: "warn",
    })
    expect(gate?.detail).toContain("重复分流")
    expect(gate?.detail).toContain("review ledger")
  })

  it("keeps an explicit post-review refresh checklist for approved adapter samples", () => {
    const prompt = buildReviewRefreshPrompt({
      action: "approve_for_adapter",
      actionLabel: "确认进入 adapter 候选",
      result: "approved",
    })
    const gate = buildReviewCycleGate({ reviewRefreshPrompt: prompt })

    expect(gate?.nextSteps).toEqual([
      "重建轨迹并刷新 LoRA-ready",
      "查看 batch delta 是否从未审降权提到人工确认权重",
      "复核 PEFT 边界仍为 storesRawFacts=false",
      "确认 facts/sourceRefs 仍留在 retrieval/tool state",
    ])
  })

  it("surfaces a single post-review action to refresh trainable batches", () => {
    const prompt = buildReviewRefreshPrompt({
      action: "approve_for_adapter",
      actionLabel: "确认进入 adapter 候选",
      result: "approved",
    })
    const gate = buildReviewCycleGate({ reviewRefreshPrompt: prompt })

    expect(buildReviewCycleNextAction(gate)).toMatchObject({
      headline: "当前下一步：刷新训练批次",
      actionKind: "refresh_lora_ready",
      actionLabel: "重建并刷新 LoRA-ready",
      tone: "good",
    })
    expect(buildReviewCycleNextAction(gate)?.detail).toContain("batch delta")
    expect(buildReviewCycleNextAction(gate)?.detail).toContain("PEFT 边界")
  })

  it("routes evidence review gates to補证 instead of a positive adapter refresh", () => {
    const prompt = buildReviewRefreshPrompt({
      action: "needs_evidence",
      actionLabel: "转补证",
      result: "needs_evidence",
    })
    const gate = buildReviewCycleGate({ reviewRefreshPrompt: prompt })

    expect(gate).toMatchObject({
      locked: true,
      refreshLabel: null,
      tone: "warn",
    })
    expect(gate?.nextSteps).toEqual([
      "补齐 evidence/sourceRefs/retrieval 工具态",
      "补证回流后重建轨迹",
      "重新导出训练产物并检查 verify",
      "未补齐前不提升 adapter 权重",
    ])
  })

  it("bridges evidence review gates into an executable collection task", () => {
    const prompt = buildReviewRefreshPrompt({
      action: "needs_evidence",
      actionLabel: "转补证",
      result: "needs_evidence",
    })
    const gate = buildReviewCycleGate({ reviewRefreshPrompt: prompt })
    const task = buildProfitFeedbackCollectionTask({
      id: "needs-evidence-trajectory",
      validationTarget: "expectation_trade",
      qualityGate: { status: "needs_evidence" },
      profitFeedback: {
        outcome: "market_validated_unrealized",
      },
    })

    const bridge = buildReviewCycleGateCollectionBridge(gate, task)

    expect(bridge).toMatchObject({
      headline: "补证入口：生成采集单",
      actionLabel: "生成补证任务",
      task,
    })
    expect(bridge?.detail).toContain("补 retrieval/tool state")
    expect(bridge?.detail).toContain("不提升 adapter 权重")
  })

  it("surfaces the evidence collection task as the next review-cycle action", () => {
    const prompt = buildReviewRefreshPrompt({
      action: "needs_evidence",
      actionLabel: "转补证",
      result: "needs_evidence",
    })
    const gate = buildReviewCycleGate({ reviewRefreshPrompt: prompt })
    const task = buildProfitFeedbackCollectionTask({
      id: "needs-evidence-trajectory",
      validationTarget: "expectation_trade",
      qualityGate: { status: "needs_evidence" },
      profitFeedback: {
        outcome: "market_validated_unrealized",
      },
    })
    const bridge = buildReviewCycleGateCollectionBridge(gate, task)

    expect(buildReviewCycleNextAction(gate, bridge)).toMatchObject({
      headline: "当前下一步：生成补证任务",
      actionKind: "create_collection_task",
      actionLabel: "生成补证任务",
      tone: "warn",
    })
    expect(buildReviewCycleNextAction(gate, bridge)?.detail).toContain("不提升 adapter 权重")
  })

  it("keeps needs-evidence review cycles waiting when no collection context exists", () => {
    const prompt = buildReviewRefreshPrompt({
      action: "needs_evidence",
      actionLabel: "转补证",
      result: "needs_evidence",
    })
    const gate = buildReviewCycleGate({ reviewRefreshPrompt: prompt })

    expect(buildReviewCycleNextAction(gate)).toMatchObject({
      headline: "当前下一步：等待补证",
      actionKind: "wait_evidence",
      actionLabel: "补证后回流",
      tone: "warn",
    })
  })

  it("does not show a collection bridge for adapter refresh gates", () => {
    const prompt = buildReviewRefreshPrompt({
      action: "approve_for_adapter",
      result: "approved",
    })
    const gate = buildReviewCycleGate({ reviewRefreshPrompt: prompt })
    const task = buildProfitFeedbackCollectionTask({
      id: "pending-profit",
      validationTarget: "expectation_trade",
      profitFeedback: {
        outcome: "market_validated_unrealized",
      },
    })

    expect(buildReviewCycleGateCollectionBridge(gate, task)).toBeNull()
  })

  it("unlocks human routing once the refresh result is visible", () => {
    const prompt = buildReviewRefreshPrompt({
      action: "approve_for_adapter",
      result: "approved",
    })
    const gate = buildReviewCycleGate({
      reviewRefreshPrompt: prompt,
      reviewRefreshResult: {
        headline: "刷新结果：提权",
        detail: "已更新训练配方",
        movementLabel: "提权",
        beforeLabel: "未审默认降权",
        afterLabel: "人工确认可提权",
        tone: "good",
      },
    })

    expect(gate).toBeNull()
  })

  it("merges a review refresh result into one completion summary", () => {
    const summary = buildReviewRefreshCompletionSummary({
      reviewRefreshResult: {
        headline: "刷新结果：提权",
        detail: "未审默认降权 -> 人工确认可提权；这次刷新只更新训练配方、bucket 和权重视图。",
        movementLabel: "提权",
        beforeLabel: "未审默认降权 / 权重 0.3x",
        afterLabel: "人工确认可提权 / 权重 1.5x",
        tone: "good",
      },
      recommendedActionLabel: "确认进入 adapter 候选",
    })

    expect(summary).toMatchObject({
      headline: "刷新结果已确认",
      movementLabel: "提权",
      beforeLabel: "未审默认降权 / 权重 0.3x",
      afterLabel: "人工确认可提权 / 权重 1.5x",
      actionLabel: "继续下一次人审",
      tone: "good",
    })
    expect(summary?.detail).toContain("这次刷新只更新训练配方")
    expect(summary?.detail).toContain("原始事实仍留在 retrieval/tool state")
    expect(summary?.chips).toEqual(["确认进入 adapter 候选"])
  })

  it("uses audit refresh diff as the same completion summary shape", () => {
    const summary = buildReviewRefreshCompletionSummary({
      refreshDiff: {
        key: "ref:adapter_candidate:adapter_candidate_1",
        headline: "训练权重已刷新",
        beforeLabel: "未审默认降权 / 权重 0.3x",
        afterLabel: "人工确认可提权 / 权重 1.5x",
        detail: "已从低权重抽样移动到人工确认提权桶。",
        tone: "good",
      },
      recommendedActionLabel: "确认进入 adapter 候选",
    })

    expect(summary).toMatchObject({
      headline: "刷新结果已确认",
      movementLabel: "权重变化",
      beforeLabel: "未审默认降权 / 权重 0.3x",
      afterLabel: "人工确认可提权 / 权重 1.5x",
      actionLabel: "继续下一次人审",
      tone: "good",
    })
    expect(summary?.detail).toContain("已从低权重抽样移动到人工确认提权桶")
    expect(summary?.chips).toEqual(expect.arrayContaining(["训练权重已刷新", "确认进入 adapter 候选"]))
  })

  it("does not show paper-trade closure for regular trajectories", () => {
    expect(buildPaperTradeReviewClosureSummary({
      trajectory: {
        source: "stock-feedback-trajectory",
      },
      reviewRefreshPrompt: buildReviewRefreshPrompt({
        action: "approve_for_adapter",
        result: "approved",
      }),
    })).toBeNull()
  })

  it("keeps reviewed paper trades waiting for LoRA-ready batch delta", () => {
    const summary = buildPaperTradeReviewClosureSummary({
      trajectory: {
        source: "stock-feedback-paper-trade",
        paperTradeState: {
          ledgerKind: "paper_trade",
          track: "llm_discretionary",
          status: "closed",
        },
      },
      reviewRefreshPrompt: buildReviewRefreshPrompt({
        action: "approve_for_adapter",
        actionLabel: "确认进入 adapter 候选",
        result: "approved",
      }),
    })

    expect(summary).toMatchObject({
      headline: "模拟交易已人审，等待训练批次刷新",
      movementLabel: "等待 batch delta",
      beforeLabel: "review 已记录",
      afterLabel: "等待 LoRA-ready 刷新",
      actionLabel: "重建并刷新 LoRA-ready",
      tone: "good",
    })
    expect(summary?.detail).toContain("先重建并刷新 LoRA-ready")
    expect(summary?.chips).toEqual(expect.arrayContaining(["paper_trade", "LLM 自主", "已平仓", "先人审后训练"]))
  })

  it("explains refreshed paper-trade batch movement without treating it as real profit", () => {
    const summary = buildPaperTradeReviewClosureSummary({
      trajectory: {
        sourceKind: "stock-feedback-paper-trade",
        paperTradeState: {
          ledgerKind: "paper_trade",
          track: "rule_baseline",
          status: "closed",
        },
      },
      reviewRefreshResult: {
        headline: "刷新结果：提权",
        detail: "未审默认降权 -> 人工确认可提权；这次刷新只更新训练配方。",
        movementLabel: "提权",
        beforeLabel: "未审默认降权 / 权重 0.3x",
        afterLabel: "人工确认可提权 / 权重 1.5x",
        tone: "good",
      },
    })

    expect(summary).toMatchObject({
      headline: "模拟交易训练批次已刷新",
      movementLabel: "提权",
      beforeLabel: "未审默认降权 / 权重 0.3x",
      afterLabel: "人工确认可提权 / 权重 1.5x",
      actionLabel: "继续下一条人审",
      tone: "good",
    })
    expect(summary?.detail).toContain("paper_trade 只是模拟收益证据")
    expect(summary?.detail).toContain("不能等同真实盈利样本")
    expect(summary?.detail).toContain("adapter 只学习可复用执行行为")
    expect(summary?.chips).toEqual(expect.arrayContaining(["paper_trade", "规则基准", "paper trade 低权重边界"]))
  })

  it("selects a risk sample as the next human review after refresh", () => {
    const suggestion = buildNextHumanReviewSuggestion({
      currentTrajectoryId: "trajectory_1",
      trajectories: [
        { id: "trajectory_1", validationTarget: "expectation_trade", hypothesis: "已完成的人审样本" },
        { id: "trajectory_2", validationTarget: "expectation_trade", hypothesis: "普通 adapter 待审样本" },
        {
          id: "trajectory_3",
          validationTarget: "priced_in_risk",
          hypothesis: "方向对但赔率压缩，后手风险高",
          qualityGate: { status: "priced_in_validated" },
          stock: { name: "风险股份", code: "300003" },
        },
      ],
      reviewByTrajectory: {
        trajectory_2: {
          sourceTrajectoryId: "trajectory_2",
          reviewStatus: "pending",
          recommendedAction: "approve_for_adapter",
          recommendedActionLabel: "确认进入 adapter 候选",
        },
        trajectory_3: {
          sourceTrajectoryId: "trajectory_3",
          reviewStatus: "pending",
          recommendedAction: "mark_priced_in",
          recommendedActionLabel: "标记 priced-in",
        },
      },
    })

    expect(suggestion).toMatchObject({
      trajectoryId: "trajectory_3",
      source: "risk_feedback",
      actionLabel: "标记 priced-in",
      tone: "warn",
    })
    expect(suggestion?.detail).toContain("避免把方向对但后手错写成正向 adapter")
  })

  it("routes the next human review to evidence collection when only evidence gaps remain", () => {
    const suggestion = buildNextHumanReviewSuggestion({
      currentTrajectoryId: "trajectory_1",
      trajectories: [
        { id: "trajectory_1", validationTarget: "expectation_trade", hypothesis: "已完成的人审样本" },
        {
          id: "trajectory_4",
          validationTarget: "fundamental_closure",
          hypothesis: "缺少订单和公告兑现证据",
          qualityGate: { status: "needs_evidence" },
          stock: { name: "补证股份", code: "300004" },
        },
      ],
      reviewByTrajectory: {
        trajectory_4: {
          sourceTrajectoryId: "trajectory_4",
          reviewStatus: "pending",
          recommendedAction: "needs_evidence",
          recommendedActionLabel: "转补证",
        },
      },
    })

    expect(suggestion).toMatchObject({
      trajectoryId: "trajectory_4",
      source: "evidence_gap",
      actionLabel: "转补证",
      tone: "warn",
    })
    expect(suggestion?.detail).toContain("retrieval/tool state")
  })

  it("does not recommend a next human review when all remaining samples are reviewed", () => {
    const suggestion = buildNextHumanReviewSuggestion({
      currentTrajectoryId: "trajectory_1",
      trajectories: [
        { id: "trajectory_1", validationTarget: "expectation_trade", hypothesis: "已完成的人审样本" },
        { id: "trajectory_2", validationTarget: "expectation_trade", hypothesis: "已审样本" },
      ],
      reviewByTrajectory: {
        trajectory_2: {
          sourceTrajectoryId: "trajectory_2",
          reviewStatus: "reviewed",
          latestReview: {
            action: "approve_for_adapter",
            result: "approved",
          },
        },
      },
    })

    expect(suggestion).toBeNull()
  })

  it("explains why positive adapter approval is locked for priced-in samples", () => {
    const hint = buildAdapterApprovalDisabledHint({
      gate: "priced_in_validated",
      recommendedActionLabel: "标记 priced-in",
      canExport: false,
      peftAllowsAdapter: true,
    })

    expect(hint).toContain("质量门不允许正向 adapter")
    expect(hint).toContain("eval/preference")
    expect(hint).toContain("标记 priced-in")
  })

  it("explains PEFT boundary locks before quality-gate locks", () => {
    const hint = buildAdapterApprovalDisabledHint({
      gate: "expectation_validated",
      recommendedActionLabel: "确认进入 adapter 候选",
      canExport: true,
      peftAllowsAdapter: false,
    })

    expect(hint).toContain("PEFT 闸门锁住正向 adapter")
    expect(hint).toContain("原始事实")
    expect(hint).toContain("retrieval/tool state")
  })

  it("weakens the positive adapter button when adapter approval is locked", () => {
    const presentation = buildAdapterApprovalButtonPresentation("质量门不允许正向 adapter")

    expect(presentation.variant).toBe("outline")
    expect(presentation.className).toContain("bg-amber-500/5")
    expect(presentation.className).toContain("text-amber-900")
    expect(presentation.className).toContain("!opacity-100")
  })

  it("keeps the positive adapter button primary when it is not locked", () => {
    const presentation = buildAdapterApprovalButtonPresentation(null)

    expect(presentation.variant).toBe("default")
    expect(presentation.className).toBe("")
  })

  it("locks audit-sourced reviews until their weight diff is refreshed", () => {
    const notice = buildAuditSubmissionNotice({
      sourceTitle: "LoRA-ready 来源",
      bucketId: "default_downweighted_pending_review",
      bucketLabel: "未审默认降权",
      refKind: "adapter_candidate",
      refId: "adapter_candidate_1",
    }, {
      action: "approve_for_adapter",
      result: "recorded",
    })

    expect(buildReviewCycleGate({ submissionNotice: notice })).toMatchObject({
      locked: true,
      actionLabel: "确认进入 adapter 候选",
      source: "audit_submission",
    })
    expect(buildReviewCycleGate({
      submissionNotice: notice,
      refreshDiff: {
        key: "ref:adapter_candidate:adapter_candidate_1",
        headline: "训练权重已刷新",
        beforeLabel: "未审默认降权",
        afterLabel: "人工确认可提权",
        detail: "已刷新",
        tone: "good",
      },
    })).toBeNull()
  })

  it("locks persisted latest reviews when LoRA-ready artifacts are older than the review", () => {
    const gate = buildReviewCycleGate({
      latestReview: {
        action: "approve_for_adapter",
        actionLabel: "确认进入 adapter 候选",
        result: "approved",
        generatedAt: "2026-06-20 14:10:00",
      },
      latestTrainableArtifactGeneratedAt: "2026-06-20 14:09:00",
    })

    expect(gate).toMatchObject({
      locked: true,
      source: "latest_review",
      actionLabel: "确认进入 adapter 候选",
      refreshLabel: "重建并刷新 LoRA-ready",
      tone: "good",
    })
    expect(gate?.detail).toContain("最新 LoRA-ready 批次早于该 review")
  })

  it("does not lock persisted reviews once LoRA-ready artifacts cover the review", () => {
    expect(buildReviewCycleGate({
      latestReview: {
        action: "approve_for_adapter",
        generatedAt: "2026-06-20 14:10:00",
      },
      latestTrainableArtifactGeneratedAt: "2026-06-20 14:12:00",
    })).toBeNull()

    expect(buildReviewCycleGate({
      latestReview: {
        action: "needs_evidence",
        generatedAt: "2026-06-20 14:10:00",
      },
      latestTrainableArtifactGeneratedAt: "2026-06-20 14:09:00",
    })).toBeNull()
  })
})

describe("audit refresh diff", () => {
  it("explains weight changes after LoRA-ready is rebuilt", () => {
    const diff = buildAuditRefreshDiff({
      sourceTitle: "LoRA-ready 来源",
      bucketId: "default_downweighted_pending_review",
      bucketLabel: "未审默认降权",
      sampling: "downsample_until_review",
      effectiveWeightMultiplier: 0.25,
      trainingWeightState: "default_downweighted_pending_review",
      refKind: "adapter_candidate",
      refId: "adapter_candidate_1",
      sourceTrajectoryId: "trajectory_1",
    }, {
      sourceTitle: "LoRA-ready 来源",
      bucketId: "human_approved_upweight",
      bucketLabel: "人工确认可提权",
      sampling: "priority_include",
      effectiveWeightMultiplier: 1.5,
      trainingWeightState: "human_approved_upweight",
      refKind: "adapter_candidate",
      refId: "adapter_candidate_1",
      sourceTrajectoryId: "trajectory_1",
    })

    expect(diff?.key).toBe("ref:adapter_candidate:adapter_candidate_1")
    expect(diff?.headline).toBe("训练权重已刷新")
    expect(diff?.beforeLabel).toContain("未审默认降权")
    expect(diff?.beforeLabel).toContain("权重 0.3x")
    expect(diff?.afterLabel).toContain("人工确认可提权")
    expect(diff?.afterLabel).toContain("权重 1.5x")
    expect(diff?.detail).toContain("原始事实、公告和交易数据仍留在 retrieval/tool state")
    expect(diff?.tone).toBe("good")
  })

  it("explains when a reviewed sample leaves the LoRA-ready batch", () => {
    const diff = buildAuditRefreshDiff({
      sourceTitle: "LoRA-ready 来源",
      bucketId: "human_rejected_zero_weight",
      bucketLabel: "人工排除权重",
      sampling: "exclude_from_positive_adapter",
      effectiveWeightMultiplier: 0,
      trainingWeightState: "human_rejected_zero_weight",
      refKind: "adapter_candidate",
      refId: "adapter_candidate_rejected",
    }, null)

    expect(diff?.headline).toBe("刷新后未进入 LoRA-ready")
    expect(diff?.afterLabel).toBe("未进入 LoRA-ready 批次")
    expect(diff?.detail).toContain("补证、eval/preference 或排除正向 adapter")
    expect(diff?.detail).toContain("原始事实不会写入 LoRA")
    expect(diff?.tone).toBe("warn")
  })

  it("explains the refreshed batch delta for a regular reviewed trajectory", () => {
    const result = buildReviewRefreshResult({
      headline: "已刷新 LoRA-ready 批次",
      detail: "batch refreshed",
      totalBefore: 1,
      totalAfter: 1,
      upweighted: 1,
      downweighted: 0,
      unchanged: 0,
      movedOut: 0,
      movedIn: 0,
      evidenceGap: 0,
      rejected: 0,
      preferenceOrRisk: 0,
      adapterApproved: 1,
      source: "lora-ready-refresh",
      movements: [{
        sourceTrajectoryId: "trajectory_1",
        movement: "upweighted",
        before: {
          bucketLabel: "未审默认降权",
          effectiveWeightMultiplier: 0.25,
          trainingWeightState: "default_downweighted_pending_review",
        },
        after: {
          bucketLabel: "人工确认可提权",
          effectiveWeightMultiplier: 1.5,
          trainingWeightState: "human_approved_upweight",
        },
      }],
    }, "trajectory_1")

    expect(result).toMatchObject({
      headline: "刷新结果：提权",
      movementLabel: "提权",
      tone: "good",
    })
    expect(result?.beforeLabel).toContain("未审默认降权")
    expect(result?.afterLabel).toContain("人工确认可提权")
    expect(result?.detail).toContain("retrieval/tool state")
  })

  it("explains when a refreshed regular review is not in the visible movement sample", () => {
    const result = buildReviewRefreshResult({
      headline: "已刷新 LoRA-ready 批次",
      detail: "batch refreshed",
      totalBefore: 4,
      totalAfter: 4,
      upweighted: 0,
      downweighted: 0,
      unchanged: 4,
      movedOut: 0,
      movedIn: 0,
      evidenceGap: 0,
      rejected: 0,
      preferenceOrRisk: 0,
      adapterApproved: 0,
      source: "lora-ready-refresh",
      movements: [],
    }, "trajectory_missing")

    expect(result).toMatchObject({
      headline: "训练批次已刷新",
      movementLabel: "未在变化样本中",
      tone: "neutral",
    })
    expect(result?.detail).toContain("当前轨迹未出现在本次 batch delta")
    expect(result?.detail).toContain("原始事实仍留在 retrieval/tool state")
  })

  it("uses the movement index to explain a reviewed trajectory outside the visible sample", () => {
    const result = buildReviewRefreshResult({
      headline: "已刷新 LoRA-ready 批次",
      detail: "batch refreshed",
      totalBefore: 12,
      totalAfter: 12,
      upweighted: 8,
      downweighted: 1,
      unchanged: 3,
      movedOut: 0,
      movedIn: 0,
      evidenceGap: 0,
      rejected: 0,
      preferenceOrRisk: 1,
      adapterApproved: 8,
      source: "lora-ready-refresh",
      movements: [],
      movementIndex: {
        trajectory_reviewed: {
          sourceTrajectoryId: "trajectory_reviewed",
          movement: "downweighted",
          before: {
            bucketLabel: "未审默认降权",
            effectiveWeightMultiplier: 0.5,
            trainingWeightState: "default_downweighted_pending_review",
          },
          after: {
            bucketLabel: "人审风控降权",
            effectiveWeightMultiplier: 0.2,
            trainingWeightState: "human_risk_downweight",
          },
        },
      },
    }, "trajectory_reviewed")

    expect(result).toMatchObject({
      headline: "刷新结果：降权",
      movementLabel: "降权",
      tone: "warn",
    })
    expect(result?.beforeLabel).toContain("未审默认降权")
    expect(result?.afterLabel).toContain("人审风控降权")
    expect(result?.detail).toContain("retrieval/tool state")
  })
})

describe("audit batch refresh summary", () => {
  it("summarizes LoRA-ready batch movement after review rebuilds", () => {
    const summary = buildAuditBatchRefreshSummary({
      adapterBatchRecipe: {
        buckets: [
          {
            id: "default_downweighted_pending_review",
            label: "未审默认降权",
            recommendedSampling: "downsample_until_review",
            effectiveWeightMultiplier: 0.25,
            candidateRefs: [
              {
                refKind: "adapter_candidate",
                id: "candidate_up",
                sourceTrajectoryId: "trajectory_up",
                adapterCapability: "预期交易判断",
              },
            ],
          },
          {
            id: "human_approved_upweight",
            label: "人工确认可提权",
            recommendedSampling: "priority_include",
            effectiveWeightMultiplier: 1,
            candidateRefs: [
              {
                refKind: "adapter_candidate",
                id: "candidate_down",
                sourceTrajectoryId: "trajectory_down",
                adapterCapability: "priced-in 风险识别",
              },
            ],
          },
          {
            id: "evidence_gap_downweight",
            label: "补证降权",
            recommendedSampling: "hold_for_evidence",
            effectiveWeightMultiplier: 0.2,
            candidateRefs: [
              {
                refKind: "adapter_candidate",
                id: "candidate_out",
                sourceTrajectoryId: "trajectory_out",
                adapterCapability: "基本面兑现判断",
              },
            ],
          },
          {
            id: "human_routed_standard_review",
            label: "人审保守权重",
            recommendedSampling: "standard_review_sample",
            effectiveWeightMultiplier: 0.8,
            candidateRefs: [
              {
                refKind: "adapter_candidate",
                id: "candidate_route",
                sourceTrajectoryId: "trajectory_route",
                adapterCapability: "补证路线",
              },
            ],
          },
        ],
      },
    }, {
      adapterBatchRecipe: {
        buckets: [
          {
            id: "human_approved_upweight",
            label: "人工确认可提权",
            recommendedSampling: "priority_include",
            effectiveWeightMultiplier: 1.5,
            candidateRefs: [
              {
                refKind: "adapter_candidate",
                id: "candidate_up",
                sourceTrajectoryId: "trajectory_up",
                adapterCapability: "预期交易判断",
              },
              {
                refKind: "adapter_candidate",
                id: "candidate_new",
                sourceTrajectoryId: "trajectory_new",
                adapterCapability: "失败归因",
              },
            ],
          },
          {
            id: "human_routed_expression_review",
            label: "人审表达复核",
            recommendedSampling: "standard_review_sample",
            effectiveWeightMultiplier: 0.8,
            candidateRefs: [
              {
                refKind: "adapter_candidate",
                id: "candidate_route",
                sourceTrajectoryId: "trajectory_route",
                adapterCapability: "补证路线",
              },
            ],
          },
          {
            id: "human_risk_downweight",
            label: "人审风控降权",
            recommendedSampling: "prefer_eval_and_negative_mix",
            effectiveWeightMultiplier: 0.4,
            candidateRefs: [
              {
                refKind: "adapter_candidate",
                id: "candidate_down",
                sourceTrajectoryId: "trajectory_down",
                adapterCapability: "priced-in 风险识别",
              },
            ],
          },
        ],
      },
    })

    expect(summary?.headline).toBe("批次刷新影响")
    expect(summary?.totalBefore).toBe(4)
    expect(summary?.totalAfter).toBe(4)
    expect(summary?.upweighted).toBe(1)
    expect(summary?.downweighted).toBe(1)
    expect(summary?.rerouted).toBe(1)
    expect(summary?.movedIn).toBe(1)
    expect(summary?.movedOut).toBe(1)
    expect(summary?.adapterApproved).toBe(2)
    expect(summary?.preferenceOrRisk).toBe(1)
    expect(summary?.movements).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "candidate_up",
        sourceTrajectoryId: "trajectory_up",
        adapterCapability: "预期交易判断",
        movement: "upweighted",
        before: expect.objectContaining({
          bucketId: "default_downweighted_pending_review",
          effectiveWeightMultiplier: 0.25,
        }),
        after: expect.objectContaining({
          bucketId: "human_approved_upweight",
          effectiveWeightMultiplier: 1.5,
        }),
      }),
      expect.objectContaining({
        id: "candidate_down",
        sourceTrajectoryId: "trajectory_down",
        movement: "downweighted",
        after: expect.objectContaining({
          bucketId: "human_risk_downweight",
          effectiveWeightMultiplier: 0.4,
        }),
      }),
      expect.objectContaining({
        id: "candidate_new",
        sourceTrajectoryId: "trajectory_new",
        movement: "moved_in",
        before: null,
      }),
      expect.objectContaining({
        id: "candidate_route",
        sourceTrajectoryId: "trajectory_route",
        movement: "rerouted",
        before: expect.objectContaining({
          bucketId: "human_routed_standard_review",
          effectiveWeightMultiplier: 0.8,
        }),
        after: expect.objectContaining({
          bucketId: "human_routed_expression_review",
          effectiveWeightMultiplier: 0.8,
        }),
      }),
      expect.objectContaining({
        id: "candidate_out",
        sourceTrajectoryId: "trajectory_out",
        movement: "moved_out",
        after: null,
      }),
    ]))
    expect(summary?.movementIndex?.trajectory_up).toMatchObject({
      id: "candidate_up",
      movement: "upweighted",
    })
    expect(summary?.movementIndex?.trajectory_out).toMatchObject({
      id: "candidate_out",
      movement: "moved_out",
    })
    expect(summary?.detail).toContain("提权 1")
    expect(summary?.detail).toContain("降权 1")
    expect(summary?.detail).toContain("改分流 1")
    expect(summary?.detail).toContain("新增 1")
    expect(summary?.detail).toContain("转出 1")
    expect(summary?.detail).toContain("不搬运原始事实")
    expect(summary?.detail).toContain("retrieval/tool state")
  })

  it("maps batch refresh movements back to clickable audit contexts", () => {
    const context = auditContextFromBatchRefreshMovement({
      id: "candidate_up",
      sourceTrajectoryId: "trajectory_up",
      adapterCapability: "预期交易判断",
      movement: "upweighted",
      before: {
        bucketId: "default_downweighted_pending_review",
        bucketLabel: "未审默认降权",
        effectiveWeightMultiplier: 0.25,
        recommendedSampling: "downsample_until_review",
      },
      after: {
        bucketId: "human_approved_upweight",
        bucketLabel: "人工确认可提权",
        trainingWeightState: "human_approved_upweight",
        effectiveWeightMultiplier: 1.5,
        recommendedSampling: "priority_include",
      },
    })

    expect(context).toMatchObject({
      sourceTitle: "LoRA-ready 刷新",
      sourceTrajectoryId: "trajectory_up",
      refKind: "adapter_candidate",
      refId: "candidate_up",
      bucketId: "human_approved_upweight",
      bucketLabel: "人工确认可提权",
      sampling: "priority_include",
      effectiveWeightMultiplier: 1.5,
      trainingWeightState: "human_approved_upweight",
      adapterCapability: "预期交易判断",
    })

    const movedOutContext = auditContextFromBatchRefreshMovement({
      id: "candidate_out",
      sourceTrajectoryId: "trajectory_out",
      movement: "moved_out",
      before: {
        bucketId: "evidence_gap_downweight",
        bucketLabel: "补证降权",
        effectiveWeightMultiplier: 0.2,
        recommendedSampling: "hold_for_evidence",
      },
      after: null,
    })

    expect(movedOutContext).toMatchObject({
      sourceTrajectoryId: "trajectory_out",
      refId: "candidate_out",
      bucketId: "evidence_gap_downweight",
      sampling: "hold_for_evidence",
      effectiveWeightMultiplier: 0.2,
    })
  })

  it("filters trajectory rows by selected batch refresh movement", () => {
    const trajectories = [
      { id: "trajectory_up", validationTarget: "expectation_trade" },
      { id: "trajectory_down", validationTarget: "priced_in_risk" },
      { id: "trajectory_route", validationTarget: "fundamental_closure" },
      { id: "trajectory_other", validationTarget: "disconfirmation" },
    ]
    const summary = {
      headline: "批次刷新影响",
      detail: "测试",
      totalBefore: 4,
      totalAfter: 4,
      upweighted: 1,
      downweighted: 1,
      unchanged: 0,
      rerouted: 1,
      movedOut: 0,
      movedIn: 0,
      evidenceGap: 0,
      rejected: 0,
      preferenceOrRisk: 0,
      adapterApproved: 1,
      source: "lora-ready-refresh" as const,
      movements: [
        { sourceTrajectoryId: "trajectory_up", movement: "upweighted" },
        { sourceTrajectoryId: "trajectory_route", movement: "rerouted" },
      ],
      movementIndex: {
        trajectory_down: { sourceTrajectoryId: "trajectory_down", movement: "downweighted" },
      },
    }

    expect(filterTrajectoriesByBatchRefreshMovement(trajectories, summary, "all").map((item) => item.id)).toEqual([
      "trajectory_up",
      "trajectory_down",
      "trajectory_route",
      "trajectory_other",
    ])
    expect(filterTrajectoriesByBatchRefreshMovement(trajectories, summary, "downweighted").map((item) => item.id)).toEqual(["trajectory_down"])
    expect(filterTrajectoriesByBatchRefreshMovement(trajectories, summary, "rerouted").map((item) => item.id)).toEqual(["trajectory_route"])
  })

  it("prioritizes batch refresh movements into human review actions", () => {
    const actions = buildBatchRefreshReviewActions({
      headline: "批次刷新影响",
      detail: "测试",
      totalBefore: 5,
      totalAfter: 5,
      upweighted: 1,
      downweighted: 2,
      unchanged: 0,
      rerouted: 1,
      movedOut: 1,
      movedIn: 1,
      evidenceGap: 0,
      rejected: 0,
      preferenceOrRisk: 0,
      adapterApproved: 1,
      source: "lora-ready-refresh",
      movements: [
        { sourceTrajectoryId: "trajectory_up", movement: "upweighted" },
        { sourceTrajectoryId: "trajectory_down", movement: "downweighted" },
        { sourceTrajectoryId: "trajectory_route", movement: "rerouted" },
        { sourceTrajectoryId: "trajectory_out", movement: "moved_out" },
        { sourceTrajectoryId: "trajectory_new", movement: "moved_in" },
      ],
    })

    expect(actions.map((item) => item.filter)).toEqual([
      "downweighted",
      "moved_out",
      "rerouted",
      "moved_in",
      "upweighted",
    ])
    expect(actions[0]).toMatchObject({
      filter: "downweighted",
      count: 2,
      priority: "high",
      recommendedAction: "route_to_preference_or_priced_in_review",
    })
    expect(actions[0].detail).toContain("priced-in")
    expect(actions[1].detail).toContain("补证")
    expect(actions[2].detail).toContain("能力桶")
    expect(actions[4].detail).toContain("不存原始事实")
  })
})

describe("buildPeftBoundaryReview", () => {
  it("keeps expectation-trade learning clean while facts stay in tool state", () => {
    const review = buildPeftBoundaryReview({
      id: "trajectory_expectation",
      validationTarget: "expectation_trade",
      adapterCapability: "预期交易判断",
      sourceRefs: ["raw/news/expectation.md"],
      distillationSignals: {
        decisionStrategy: "先验证扩散与承接，再决定是否提高仓位",
        toolHabit: "价格相对强度 + 成交额二次确认",
        factBoundary: "raw facts remain in retrieval/tool state",
      },
      distillationPlan: {
        requiredToolState: ["price_sql", "evidence_refs"],
        adapterLearns: [
          { kind: "decision_strategy", value: "预期扩散后等待承接验证" },
          { kind: "tool_habit", value: "相对强度和成交额共振后再复核" },
        ],
        factBoundary: {
          storesRawFacts: false,
          factsRemainIn: ["retrieval/tool state", "price SQL"],
          adapterDoesNotStore: ["raw_facts", "raw facts", "announcements_or_report_text"],
          sourceRefs: ["wiki/theme/expectation.md"],
        },
      },
    })

    expect(review).toMatchObject({
      status: "clean",
      tone: "good",
      headline: "PEFT 边界清楚",
    })
    expect(review?.learns.map((item) => item.value)).toEqual(expect.arrayContaining([
      "预期扩散后等待承接验证",
      "相对强度和成交额共振后再复核",
      "预期交易判断",
    ]))
    expect(review?.factStores).toEqual(expect.arrayContaining(["retrieval/tool state", "price SQL"]))
    expect(review?.adapterDoesNotStore).toEqual(expect.arrayContaining(["raw facts", "announcements or report text"]))
    expect(review?.adapterDoesNotStore.filter((item) => item === "raw facts")).toHaveLength(1)
    expect(review?.reviewChecks).toContain("市场预期交易可作为一等训练目标，但不得伪装成基本面兑现")
    expect(peftBoundaryAllowsAdapterApproval(review)).toBe(true)

    const hint = buildPeftBoundaryActionHint(review, {
      recommendedAction: "approve_for_adapter",
      canExport: true,
      adapterCapability: "预期交易判断",
    })

    expect(hint).toMatchObject({
      locksAdapterApproval: false,
      recommendedAction: "approve_for_adapter",
      recommendedActionLabel: "确认 adapter",
    })
    expect(hint?.noteDraft).toContain("PEFT 边界清楚")
    expect(hint?.noteDraft).toContain("事实留在 retrieval/tool state")
  })

  it("holds candidates for review when the PEFT raw-fact boundary is missing", () => {
    const review = buildPeftBoundaryReview({
      id: "trajectory_missing_boundary",
      validationTarget: "fundamental_closure",
      adapterCapability: "基本面兑现判断",
      distillationSignals: {
        skill: "订单/公告/财报兑现对照",
      },
    })

    expect(review).toMatchObject({
      status: "needs_review",
      tone: "warn",
      headline: "需要补 PEFT 边界声明",
    })
    expect(review?.detail).toContain("storesRawFacts=false")
    expect(review?.reviewChecks).toContain("补齐 sourceRefs 后再提升训练权重")
    expect(peftBoundaryAllowsAdapterApproval(review)).toBe(false)

    const hint = buildPeftBoundaryActionHint(review, {
      recommendedAction: "approve_for_adapter",
      canExport: true,
      adapterCapability: "基本面兑现判断",
    })

    expect(hint).toMatchObject({
      locksAdapterApproval: true,
      recommendedAction: "needs_evidence",
      recommendedActionLabel: "转补证",
    })
    expect(hint?.detail).toContain("不能直接确认 adapter")
    expect(hint?.noteDraft).toContain("补 storesRawFacts=false")
  })

  it("blocks LoRA-ready promotion when a plan declares raw facts in adapter", () => {
    const review = buildPeftBoundaryReview({
      id: "trajectory_fact_leak",
      validationTarget: "priced_in_risk",
      adapterCapability: "priced-in 风险识别",
      distillationPlan: {
        adapterLearns: [{ kind: "risk_control", value: "方向对但赔率压缩时降级到 eval" }],
        factBoundary: {
          storesRawFacts: true,
          factsRemainIn: ["adapter"],
          adapterDoesNotStore: [],
        },
      },
    })

    expect(review).toMatchObject({
      status: "blocked",
      tone: "danger",
      headline: "阻断：候选声明会存原始事实",
    })
    expect(review?.detail).toContain("移回 retrieval/tool state")
    expect(review?.learns.map((item) => item.value)).toContain("方向对但赔率压缩时降级到 eval")
    expect(peftBoundaryAllowsAdapterApproval(review)).toBe(false)

    const hint = buildPeftBoundaryActionHint(review, {
      recommendedAction: "approve_for_adapter",
      canExport: true,
      adapterCapability: "priced-in 风险识别",
    })

    expect(hint).toMatchObject({
      locksAdapterApproval: true,
      recommendedAction: "reject_for_adapter",
      recommendedActionLabel: "排除 adapter",
    })
    expect(hint?.headline).toContain("阻断正向 adapter")
    expect(hint?.noteDraft).toContain("storesRawFacts=true")
  })
})

describe("profit feedback distillation hints", () => {
  it("summarizes missing profit-credit benchmark buckets as actionable sampling gaps", () => {
    const detail = benchmarkProfitCreditGapDetail({
      coverageGaps: [
        {
          bucket: "profit_credit",
          id: "execution_risk_negative",
          label: "执行风险负样本",
          recommendedAction: "collect_entry_risk_loss_feedback",
          trainingUse: "eval_preference_negative",
        },
        {
          bucket: "profit_credit",
          id: "failed_expectation_negative",
          label: "失败预期负样本",
          recommendedAction: "collect_failed_expectation_feedback",
          trainingUse: "eval_preference_negative",
        },
      ],
      profitCreditCounts: {
        pattern_execution_supported: 1,
      },
    })

    expect(detail).toContain("收益归因缺")
    expect(detail).toContain("执行风险负样本")
    expect(detail).toContain("失败预期负样本")
    expect(detail).toContain("补买点/仓位亏损样本")
    expect(detail).toContain("补预期失败样本")
  })

  it("summarizes covered profit-credit buckets when no benchmark gap remains", () => {
    expect(benchmarkProfitCreditGapDetail({
      coverageGaps: [],
      profitCreditCounts: {
        pattern_execution_supported: 2,
        execution_risk_negative: 1,
      },
    })).toBe("收益归因覆盖：收益支持手法执行 2 / 执行风险负样本 1")
  })

  it("turns benchmark coverage gaps into prioritized UI actions", () => {
    const actions = buildBenchmarkGapActions({
      coverageGaps: [
        {
          bucket: "market_pattern",
          id: "low_absorption_breakout",
          label: "低位吸收转强",
          recommendedAction: "collect_market_pattern_case",
        },
        {
          bucket: "profit_credit",
          id: "execution_risk_negative",
          label: "执行风险负样本",
          recommendedAction: "collect_entry_risk_loss_feedback",
          trainingUse: "eval_preference_negative",
        },
        {
          bucket: "validation_target",
          id: "fundamental_closure",
          label: "基本面兑现验证",
          recommendedAction: "collect_or_label_trajectory",
        },
      ],
    }, {
      items: [
        {
          id: "low_absorption_breakout",
          label: "低位吸收转强",
          distillationHint: "识别低位吸收后的试错和加仓节奏。",
          collectionTask: {
            targetPatternId: "low_absorption_breakout",
            targetPatternLabel: "低位吸收转强",
            validationTarget: "expectation_trade",
            goal: "补齐低位吸收后转强样本。",
          },
        },
      ],
    })

    expect(actions.map((item) => item.id)).toEqual([
      "profit_credit:execution_risk_negative",
      "market_pattern:low_absorption_breakout",
      "validation_target:fundamental_closure",
    ])
    expect(actions[0]).toMatchObject({
      label: "执行风险负样本",
      primaryActionLabel: "筛选风险负样本",
      target: "priced_in_risk",
      profitFeedbackFilter: "risk_negative",
      profitCredit: "execution_risk_negative",
      tone: "warn",
    })
    expect(actions[1]).toMatchObject({
      primaryActionLabel: "查看模式任务",
      target: "expectation_trade",
      patternId: "low_absorption_breakout",
    })
    expect(actions[2]).toMatchObject({
      primaryActionLabel: "切到目标",
      target: "fundamental_closure",
    })
  })

  it("builds a next-batch dynamic test-set plan from benchmark gaps", () => {
    const actions = buildBenchmarkGapActions({
      coverageGaps: [
        {
          bucket: "profit_credit",
          id: "pattern_execution_supported",
          label: "收益支持手法执行",
          recommendedAction: "collect_profit_feedback",
          trainingUse: "adapter_candidate_after_review",
        },
        {
          bucket: "profit_credit",
          id: "execution_risk_negative",
          label: "执行风险负样本",
          recommendedAction: "collect_entry_risk_loss_feedback",
          trainingUse: "eval_preference_negative",
        },
        {
          bucket: "market_pattern",
          id: "low_absorption_breakout",
          label: "低位吸收转强",
          recommendedAction: "collect_market_pattern_case",
        },
        {
          bucket: "profit_outcome",
          id: "loss",
          label: "loss",
          recommendedAction: "collect_profit_feedback",
        },
      ],
    }, {
      items: [
        {
          id: "low_absorption_breakout",
          label: "低位吸收转强",
          collectionTask: {
            targetPatternId: "low_absorption_breakout",
            targetPatternLabel: "低位吸收转强",
            validationTarget: "expectation_trade",
            goal: "补低位吸收转强样本",
          },
        },
      ],
    })

    const plan = buildDynamicTestSetPlan(actions)

    expect(plan).toMatchObject({
      headline: "下一批先补收益/风险反馈",
      totalGaps: 4,
    })
    expect(plan.steps.map((step) => step.id)).toEqual([
      "profit_credit:execution_risk_negative",
      "profit_credit:pattern_execution_supported",
      "profit_outcome:loss",
      "market_pattern:low_absorption_breakout",
    ])
    expect(plan.steps[0]).toMatchObject({
      rank: 1,
      routeLabel: "eval/preference/负样本",
      reason: "先补方向对但买点、仓位或止损错误的真实反馈，避免模型把追涨当成好决策。",
      primaryActionLabel: "筛选风险负样本",
    })
    expect(plan.steps[1]).toMatchObject({
      routeLabel: "人审后 adapter 正样本",
    })
    expect(plan.steps[3]).toMatchObject({
      routeLabel: "采集单 -> 轨迹 -> Benchmark",
      target: "expectation_trade",
      patternId: "low_absorption_breakout",
    })
    expect(plan.detail).toContain("事实和交易数据仍留在 retrieval/tool state")
  })

  it("keeps profit-credit collection tasks active after dry-run command results", () => {
    const task = collectionTaskFromCommandResult({
      dryRun: true,
      collectionTask: {
        schema: "stock-feedback-collection-task-v1",
        taskId: "stockfb_collect_profit_entry_risk",
        bucket: "profit_credit",
        targetProfitCredit: "execution_risk_negative",
        targetProfitCreditLabel: "执行风险负样本",
        validationTarget: "priced_in_risk",
        adapterCapability: "priced_in_risk_judgment",
        recommendedAction: "collect_entry_risk_loss_feedback",
        suggestedFilters: {
          profitCredit: "execution_risk_negative",
          profitFeedback: "risk_negative",
          validationTarget: "priced_in_risk",
          qualityGate: null,
        },
        peftBoundary: {
          storesRawFacts: false,
          factsRemainIn: ["retrieval/tool state"],
          adapterStores: ["entry_timing", "position_sizing", "drawdown_control"],
        },
      },
      draft: {
        id: "stockfb_collection_draft_entry_risk",
        taskId: "stockfb_collect_profit_entry_risk",
        targetProfitCredit: "execution_risk_negative",
        validationTarget: "priced_in_risk",
        priority: "high",
        requiredToolState: ["trade ledger", "late-entry price path"],
        acceptanceCriteria: ["primaryCredit=execution_risk_negative"],
      },
    })

    expect(task).toMatchObject({
      taskId: "stockfb_collect_profit_entry_risk",
      draftId: "stockfb_collection_draft_entry_risk",
      targetProfitCredit: "execution_risk_negative",
      targetProfitCreditLabel: "执行风险负样本",
      validationTarget: "priced_in_risk",
      adapterCapability: "priced_in_risk_judgment",
      priority: "high",
      suggestedFilters: {
        profitCredit: "execution_risk_negative",
        profitFeedback: "risk_negative",
      },
      peftBoundary: {
        storesRawFacts: false,
        adapterStores: ["entry_timing", "position_sizing", "drawdown_control"],
      },
    })
  })

  it("reconstructs a profit-credit collection task from draft-only command results", () => {
    const task = collectionTaskFromCommandResult({
      draft: {
        schema: "stock-feedback-collection-task-draft-v1",
        id: "stockfb_collection_draft_failed_expectation",
        taskId: "stockfb_collect_profit_failed_expectation",
        targetProfitCredit: "failed_expectation_negative",
        targetProfitCreditLabel: "失败预期负样本",
        validationTarget: "disconfirmation",
        adapterCapability: "failure_attribution",
        priority: "high",
        status: "open",
        goal: "补齐预期失败、无承接或一日游样本。",
        humanPrompt: "确认失败归因来自预期证伪，而不是复制原始事实。",
        requiredToolState: ["sourceRefs", "post-event price path"],
        acceptanceCriteria: ["primaryCredit=failed_expectation_negative"],
        sampleMustInclude: ["validationTarget=disconfirmation", "profitCredit=failed_expectation_negative"],
        suggestedFilters: {
          profitCredit: "failed_expectation_negative",
          profitFeedback: "risk_negative",
          validationTarget: "disconfirmation",
          qualityGate: null,
        },
        currentCounts: {
          profitCreditTrajectories: 0,
        },
        peftBoundary: {
          storesRawFacts: false,
          factsRemainIn: ["retrieval/tool state", "sourceRefs", "price SQL"],
          adapterStores: ["failure_attribution", "counter_evidence_routing"],
        },
      },
    })

    expect(task).toMatchObject({
      schema: "stock-feedback-collection-task-v1",
      taskId: "stockfb_collect_profit_failed_expectation",
      draftId: "stockfb_collection_draft_failed_expectation",
      targetProfitCredit: "failed_expectation_negative",
      targetProfitCreditLabel: "失败预期负样本",
      validationTarget: "disconfirmation",
      adapterCapability: "failure_attribution",
      priority: "high",
      goal: "补齐预期失败、无承接或一日游样本。",
      humanPrompt: "确认失败归因来自预期证伪，而不是复制原始事实。",
      acceptanceCriteria: ["primaryCredit=failed_expectation_negative"],
      sampleMustInclude: ["validationTarget=disconfirmation", "profitCredit=failed_expectation_negative"],
      suggestedFilters: {
        profitCredit: "failed_expectation_negative",
        profitFeedback: "risk_negative",
      },
      currentCounts: {
        profitCreditTrajectories: 0,
      },
      peftBoundary: {
        storesRawFacts: false,
        adapterStores: ["failure_attribution", "counter_evidence_routing"],
      },
    })
  })

  it("ignores command results without a collection task context", () => {
    expect(collectionTaskFromCommandResult({ dryRun: true, count: 3 })).toBeNull()
    expect(collectionTaskFromCommandResult({
      draft: {
        id: "stockfb_collection_draft_without_target",
      },
    })).toBeNull()
  })

  it("previews collection task review outcomes before humans record results", () => {
    const guide = buildCollectionTaskReviewGuide({
      targetProfitCredit: "execution_risk_negative",
      targetProfitCreditLabel: "执行风险负样本",
      validationTarget: "priced_in_risk",
      adapterCapability: "priced-in 风险识别",
      requiredToolState: ["trade ledger:realized-pnl-drawdown", "retrieval:sourceRefs"],
      acceptanceCriteria: ["primaryCredit=execution_risk_negative", "routeTo=eval/preference negative sample"],
      sampleMustInclude: ["realizedPnlPct_or_maxDrawdownPct"],
      peftBoundary: {
        storesRawFacts: false,
        factsRemainIn: ["retrieval/tool state", "trade ledger"],
        adapterStores: ["behavior", "risk_control", "decision_strategy"],
      },
    })

    expect(guide).toMatchObject({
      headline: "采集单质检：执行风险负样本",
      peftStatus: "clean",
      primaryRouteLabel: "eval/preference/负样本",
    })
    expect(guide.detail).toContain("先验证证据引用")
    expect(guide.resultOptions.map((option) => option.result)).toEqual(["confirmed", "insufficient", "refuted"])
    expect(guide.resultOptions[0]).toMatchObject({
      result: "confirmed",
      label: "确认证据",
      routeLabel: "eval/preference/负样本",
      tone: "good",
    })
    expect(guide.resultOptions[0].noteDraft).toContain("执行风险负样本")
    expect(guide.resultOptions[0].noteDraft).toContain("事实留在 retrieval/tool state")
    expect(guide.resultOptions[1].nextStep).toContain("保持采集单打开")
    expect(guide.resultOptions[2].routeLabel).toBe("负样本复核")
  })

  it("warns when collection task PEFT boundary is missing before recording results", () => {
    const guide = buildCollectionTaskReviewGuide({
      targetPatternId: "low_absorption_breakout",
      targetPatternLabel: "低位吸收转强",
      validationTarget: "expectation_trade",
      adapterCapability: "预期交易判断",
      requiredToolState: ["price SQL", "sourceRefs"],
    })

    expect(guide).toMatchObject({
      peftStatus: "needs_review",
      primaryRouteLabel: "采集单 -> 轨迹 -> Benchmark",
    })
    expect(guide.detail).toContain("补 PEFT 边界")
    expect(guide.resultOptions[0].noteDraft).toContain("补 storesRawFacts=false")
  })

  it("holds collection task confirmation until evidence refs are present", () => {
    const preflight = buildCollectionTaskDistillationPreflight({
      targetProfitCredit: "execution_risk_negative",
      targetProfitCreditLabel: "执行风险负样本",
      validationTarget: "priced_in_risk",
      peftBoundary: {
        storesRawFacts: false,
        factsRemainIn: ["retrieval/tool state", "trade ledger"],
        adapterStores: ["entry_timing", "risk_control"],
      },
    }, { evidenceRefs: "", summary: "" })

    expect(preflight).toMatchObject({
      status: "needs_evidence",
      tone: "warn",
      canRecordConfirmed: false,
      routeLabel: "eval/preference/负样本",
      headline: "蒸馏预检：等待证据引用",
    })
    expect(preflight.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "evidence_refs", status: "missing" }),
      expect.objectContaining({ id: "peft_boundary", status: "passed" }),
    ]))
    expect(preflight.nextAction).toContain("补 retrieval/tool state")
  })

  it("keeps confirmed collection results out of training promotion when PEFT boundary is missing", () => {
    const preflight = buildCollectionTaskDistillationPreflight({
      targetPatternId: "low_absorption_breakout",
      targetPatternLabel: "低位吸收转强",
      validationTarget: "expectation_trade",
      adapterCapability: "预期交易判断",
      requiredToolState: ["price SQL", "sourceRefs"],
    }, { evidenceRefs: "price-sql:low-absorption-1", summary: "确认低位吸收后转强" })

    expect(preflight).toMatchObject({
      status: "needs_boundary",
      tone: "warn",
      canRecordConfirmed: true,
      routeLabel: "采集单 -> 轨迹 -> Benchmark",
      headline: "蒸馏预检：先补 PEFT 边界",
    })
    expect(preflight.detail).toContain("可以记录 collection-result")
    expect(preflight.nextAction).toContain("storesRawFacts=false")
    expect(preflight.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "evidence_refs", status: "passed" }),
      expect.objectContaining({ id: "peft_boundary", status: "warning" }),
    ]))
  })

  it("prompts confirmed collection results to rebuild trainable artifacts", () => {
    const followUp = buildCollectionResultFollowUp({
      result: "confirmed",
      resultLabel: "证据已确认",
      targetProfitCredit: "execution_risk_negative",
      targetProfitCreditLabel: "执行风险负样本",
      sourceDraftId: "stockfb_collection_draft_entry_risk",
      evidenceRefs: ["trade-ledger:entry-risk-1"],
      evidenceRefCount: 1,
      nextAction: "rebuild_trajectories_then_review",
      peftBoundary: {
        storesRawFacts: false,
      },
    })

    expect(followUp).toMatchObject({
      headline: "补样本已确认",
      tone: "good",
      primaryAction: "rebuild_trajectories",
      primaryActionLabel: "重建轨迹",
      refreshLoraReadyLabel: "重建并刷新 LoRA-ready",
      keepCollectionOpen: false,
    })
    expect(followUp?.detail).toContain("执行风险负样本")
    expect(followUp?.detail).toContain("1 个 evidence ref")
    expect(followUp?.detail).toContain("不存原始事实")
    expect(followUp?.nextStep).toContain("review 队列")
  })

  it("maps confirmed collection results into an explicit rebuild-review-export roadmap", () => {
    const roadmap = buildCollectionResultActionRoadmap({
      result: "confirmed",
      resultLabel: "证据已确认",
      targetProfitCredit: "execution_risk_negative",
      targetProfitCreditLabel: "执行风险负样本",
      evidenceRefs: ["trade-ledger:entry-risk-1"],
      peftBoundary: {
        storesRawFacts: false,
        factsRemainIn: ["retrieval/tool state", "trade ledger"],
        adapterStores: ["entry_timing", "risk_control"],
      },
    })

    expect(roadmap).toMatchObject({
      headline: "回流路线图：先重建轨迹",
      activeStepId: "rebuild_trajectory",
      tone: "good",
    })
    expect(roadmap.steps.map((step) => [step.id, step.status])).toEqual([
      ["record_result", "done"],
      ["resolve_evidence", "done"],
      ["rebuild_trajectory", "active"],
      ["human_review", "pending"],
      ["refresh_artifacts", "pending"],
    ])
    expect(roadmap.steps.at(-1)?.detail).toContain("LoRA-ready")
    expect(roadmap.steps.at(-1)?.detail).toContain("不带原始事实")
  })

  it("previews human review routing for confirmed profit-supported collection results", () => {
    const preview = buildCollectionResultReviewRoutePreview({
      result: "confirmed",
      resultLabel: "证据已确认",
      targetProfitCredit: "pattern_execution_supported",
      targetProfitCreditLabel: "收益支持手法执行",
      validationTarget: "expectation_trade",
      evidenceRefs: ["trade-ledger:positive-1", "price-sql:positive-1"],
      peftBoundary: {
        storesRawFacts: false,
        factsRemainIn: ["retrieval/tool state", "trade ledger"],
        adapterStores: ["expectation_trade_judgment"],
      },
    })

    expect(preview).toMatchObject({
      headline: "人审预案：复核后进 adapter 候选",
      tone: "good",
      recommendedAction: "approve_for_adapter",
      recommendedActionLabel: "确认进入 adapter 候选",
      routeLabels: ["adapter", "eval"],
      peftBoundaryLabel: "事实留在 retrieval/tool state / trade ledger",
    })
    expect(preview?.detail).toContain("只沉淀可复用的行为")
    expect(preview?.reviewChecklist).toEqual(expect.arrayContaining([
      "核对收益、回撤、持有周期是否来自 retrieval/tool state 或 trade ledger",
      "确认 adapter 不存原始事实、公告正文、价格行或交易流水",
    ]))
  })

  it("locks confirmed collection results out of positive adapter routing when PEFT boundary stores facts", () => {
    const preview = buildCollectionResultReviewRoutePreview({
      result: "confirmed",
      resultLabel: "证据已确认",
      targetProfitCredit: "pattern_execution_supported",
      targetProfitCreditLabel: "收益支持手法执行",
      validationTarget: "expectation_trade",
      evidenceRefs: ["trade-ledger:positive-1"],
      peftBoundary: {
        storesRawFacts: true,
        factsRemainIn: ["adapter"],
        adapterStores: ["raw_trade_rows"],
      },
    })

    expect(preview).toMatchObject({
      headline: "人审预案：先修 PEFT 边界",
      tone: "danger",
      recommendedAction: "needs_evidence",
      routeLabels: ["补证", "排除 adapter"],
    })
    expect(preview?.detail).toContain("storesRawFacts=true")
    expect(preview?.reviewChecklist).toEqual(expect.arrayContaining([
      "先把事实、公告、价格行和交易流水移回 retrieval/tool state",
    ]))
  })

  it("routes refuted collection results toward negative eval and preference instead of adapter", () => {
    const preview = buildCollectionResultReviewRoutePreview({
      result: "refuted",
      resultLabel: "证据反驳",
      targetProfitCredit: "failed_expectation_negative",
      targetProfitCreditLabel: "失败预期负样本",
      validationTarget: "disconfirmation",
      evidenceRefs: ["retrieval:failed-1"],
      peftBoundary: {
        storesRawFacts: false,
        factsRemainIn: ["retrieval/tool state"],
        adapterStores: ["failure_attribution"],
      },
    })

    expect(preview).toMatchObject({
      headline: "人审预案：转负样本和失败归因",
      tone: "danger",
      recommendedAction: "route_to_preference",
      routeLabels: ["preference", "eval", "排除 adapter"],
    })
    expect(preview?.detail).toContain("不进入正向 adapter")
  })

  it("advances confirmed collection roadmap when trajectory and benchmark artifacts already cover it", () => {
    const roadmap = buildCollectionResultActionRoadmap({
      id: "stockfb_collection_result_entry_risk_1",
      result: "confirmed",
      resultLabel: "证据已确认",
      sourceDraftId: "stockfb_collection_draft_entry_risk",
      sourceTaskId: "stockfb_collect_profit_entry_risk",
      targetProfitCredit: "execution_risk_negative",
      targetProfitCreditLabel: "执行风险负样本",
      evidenceRefs: ["trade-ledger:entry-risk-1"],
      peftBoundary: {
        storesRawFacts: false,
        factsRemainIn: ["retrieval/tool state"],
        adapterStores: ["risk_control"],
      },
    }, {
      trajectories: [{
        id: "traj_from_result",
        validationTarget: "priced_in_risk",
        sourceRecordId: "stockfb_collection_result_entry_risk_1",
        evidenceState: {
          collectionResultId: "stockfb_collection_result_entry_risk_1",
        },
      }],
      benchmark: {
        refs: [{
          id: "bench_entry_risk_1",
          refKind: "benchmark_case",
          collectionResultId: "stockfb_collection_result_entry_risk_1",
        }],
      },
    })

    expect(roadmap).toMatchObject({
      headline: "回流路线图：刷新训练产物",
      activeStepId: "refresh_artifacts",
    })
    expect(roadmap.steps.map((step) => [step.id, step.status])).toEqual([
      ["record_result", "done"],
      ["resolve_evidence", "done"],
      ["rebuild_trajectory", "done"],
      ["human_review", "done"],
      ["refresh_artifacts", "active"],
    ])
    expect(roadmap.steps.find((step) => step.id === "human_review")?.detail).toContain("Benchmark 已覆盖")
    expect(roadmap.steps.find((step) => step.id === "rebuild_trajectory")?.action).toMatchObject({
      label: "定位轨迹",
      auditContext: {
        sourceTitle: "补样本回流轨迹",
        sourceTrajectoryId: "traj_from_result",
        collectionResultId: "stockfb_collection_result_entry_risk_1",
      },
    })
    expect(roadmap.steps.find((step) => step.id === "human_review")?.action).toMatchObject({
      label: "定位 Benchmark",
      auditContext: {
        sourceTitle: "Benchmark 来源",
        sourceTrajectoryId: "traj_from_result",
        refKind: "benchmark_case",
        refId: "bench_entry_risk_1",
        collectionResultId: "stockfb_collection_result_entry_risk_1",
      },
    })
  })

  it("builds a visible bridge into trajectory human review after collection result has a matched trajectory", () => {
    const result = {
      id: "stockfb_collection_result_positive_1",
      result: "confirmed",
      resultLabel: "证据已确认",
      sourceDraftId: "stockfb_profit_task_positive",
      targetProfitCredit: "pattern_execution_supported",
      targetProfitCreditLabel: "收益支持手法执行",
      validationTarget: "expectation_trade",
      evidenceRefs: ["trade-ledger:positive-1"],
      peftBoundary: {
        storesRawFacts: false,
        factsRemainIn: ["retrieval/tool state"],
        adapterStores: ["expectation_trade_judgment"],
      },
    }
    const roadmap = buildCollectionResultActionRoadmap(result, {
      trajectories: [{
        id: "traj_from_positive_result",
        validationTarget: "expectation_trade",
        sourceRecordId: "stockfb_collection_result_positive_1",
      }],
    })
    const preview = buildCollectionResultReviewRoutePreview(result)
    const bridge = buildCollectionResultHumanReviewBridge(roadmap, preview)

    expect(bridge).toMatchObject({
      headline: "人审入口：定位回流轨迹",
      actionLabel: "定位并人审",
      recommendedAction: "approve_for_adapter",
      recommendedActionLabel: "确认进入 adapter 候选",
      routeLabels: ["adapter", "eval"],
      peftBoundaryLabel: "事实留在 retrieval/tool state",
      tone: "good",
      step: {
        id: "human_review",
        status: "active",
        action: {
          label: "定位轨迹",
          auditContext: {
            sourceTrajectoryId: "traj_from_positive_result",
            collectionResultId: "stockfb_collection_result_positive_1",
          },
        },
      },
    })
    expect(bridge?.detail).toContain("右侧人工分流")
    expect(bridge?.detail).toContain("确认进入 adapter 候选")
  })

  it("keeps the human review bridge non-clickable before collection results are rebuilt into trajectories", () => {
    const result = {
      id: "stockfb_collection_result_positive_1",
      result: "confirmed",
      resultLabel: "证据已确认",
      targetProfitCredit: "pattern_execution_supported",
      targetProfitCreditLabel: "收益支持手法执行",
      validationTarget: "expectation_trade",
      evidenceRefs: ["trade-ledger:positive-1"],
      peftBoundary: {
        storesRawFacts: false,
        factsRemainIn: ["retrieval/tool state"],
        adapterStores: ["expectation_trade_judgment"],
      },
    }
    const roadmap = buildCollectionResultActionRoadmap(result)
    const preview = buildCollectionResultReviewRoutePreview(result)

    expect(buildCollectionResultHumanReviewBridge(roadmap, preview)).toMatchObject({
      headline: "人审入口：先重建轨迹",
      actionLabel: "等待重建",
      step: null,
      recommendedAction: "approve_for_adapter",
    })
  })

  it("derives the current next action for rebuild, human review, artifact refresh, and補证 states", () => {
    const confirmedResult = {
      id: "stockfb_collection_result_positive_1",
      result: "confirmed",
      resultLabel: "证据已确认",
      sourceDraftId: "stockfb_profit_task_positive",
      targetProfitCredit: "pattern_execution_supported",
      targetProfitCreditLabel: "收益支持手法执行",
      validationTarget: "expectation_trade",
      evidenceRefs: ["trade-ledger:positive-1"],
      peftBoundary: {
        storesRawFacts: false,
        factsRemainIn: ["retrieval/tool state"],
        adapterStores: ["expectation_trade_judgment"],
      },
    }

    const rebuildFollowUp = buildCollectionResultFollowUp(confirmedResult)
    const rebuildRoadmap = buildCollectionResultActionRoadmap(confirmedResult)
    expect(buildCollectionResultNextAction(rebuildFollowUp, rebuildRoadmap, null)).toMatchObject({
      headline: "当前下一步：重建轨迹",
      actionKind: "rebuild_trajectories",
      actionLabel: "重建轨迹",
      tone: "good",
      step: {
        id: "rebuild_trajectory",
        status: "active",
      },
    })

    const humanRoadmap = buildCollectionResultActionRoadmap(confirmedResult, {
      trajectories: [{
        id: "traj_from_positive_result",
        validationTarget: "expectation_trade",
        sourceRecordId: "stockfb_collection_result_positive_1",
      }],
    })
    const humanBridge = buildCollectionResultHumanReviewBridge(
      humanRoadmap,
      buildCollectionResultReviewRoutePreview(confirmedResult),
    )
    expect(buildCollectionResultNextAction(rebuildFollowUp, humanRoadmap, humanBridge)).toMatchObject({
      headline: "当前下一步：定位并人审",
      actionKind: "select_human_review",
      actionLabel: "定位并人审",
      step: {
        id: "human_review",
        status: "active",
        action: {
          auditContext: {
            sourceTrajectoryId: "traj_from_positive_result",
          },
        },
      },
    })

    const refreshRoadmap = buildCollectionResultActionRoadmap(confirmedResult, {
      trajectories: [{
        id: "traj_from_positive_result",
        validationTarget: "expectation_trade",
        sourceRecordId: "stockfb_collection_result_positive_1",
      }],
      benchmark: {
        refs: [{
          id: "bench_positive_1",
          refKind: "benchmark_case",
          collectionResultId: "stockfb_collection_result_positive_1",
          sourceTrajectoryId: "traj_from_positive_result",
        }],
      },
    })
    expect(buildCollectionResultNextAction(rebuildFollowUp, refreshRoadmap, null)).toMatchObject({
      headline: "当前下一步：刷新训练产物",
      actionKind: "refresh_lora_ready",
      actionLabel: "重建并刷新 LoRA-ready",
      step: {
        id: "refresh_artifacts",
        status: "active",
      },
    })

    const insufficientResult = {
      result: "insufficient",
      resultLabel: "证据不足",
      targetPatternId: "fundamental_closure_confirmation",
      targetPatternLabel: "基本面兑现确认",
      evidenceRefs: [],
    }
    expect(buildCollectionResultNextAction(
      buildCollectionResultFollowUp(insufficientResult),
      buildCollectionResultActionRoadmap(insufficientResult),
      null,
    )).toMatchObject({
      headline: "当前下一步：继续补证",
      actionKind: "continue_collection",
      actionLabel: "继续补证",
      tone: "warn",
      step: {
        id: "resolve_evidence",
        status: "active",
      },
    })
  })

  it("marks confirmed collection roadmap complete when LoRA-ready artifacts cover the result", () => {
    const roadmap = buildCollectionResultActionRoadmap({
      id: "stockfb_collection_result_entry_risk_1",
      result: "confirmed",
      resultLabel: "证据已确认",
      targetProfitCredit: "execution_risk_negative",
      targetProfitCreditLabel: "执行风险负样本",
      evidenceRefs: ["trade-ledger:entry-risk-1"],
      peftBoundary: {
        storesRawFacts: false,
        factsRemainIn: ["retrieval/tool state"],
        adapterStores: ["risk_control"],
      },
    }, {
      trajectories: [{
        id: "traj_from_result",
        validationTarget: "priced_in_risk",
        sourceRecordId: "stockfb_collection_result_entry_risk_1",
      }],
      benchmark: {
        refs: [{
          id: "bench_entry_risk_1",
          collectionResultId: "stockfb_collection_result_entry_risk_1",
        }],
      },
      loraReady: {
        refs: [{
          id: "adapter_entry_risk_1",
          refKind: "adapter_candidate",
          collectionResultId: "stockfb_collection_result_entry_risk_1",
          sourceTrajectoryId: "traj_from_result",
          sourceKind: "stock-feedback-collection-result",
          bucketId: "default_downweighted_pending_review",
          bucketLabel: "未审默认降权",
          sampling: "downsample_until_review",
          effectiveWeightMultiplier: 0.25,
        }],
      },
    })

    expect(roadmap).toMatchObject({
      headline: "回流路线图：训练产物已覆盖",
      activeStepId: "refresh_artifacts",
    })
    expect(roadmap.steps.map((step) => [step.id, step.status])).toEqual([
      ["record_result", "done"],
      ["resolve_evidence", "done"],
      ["rebuild_trajectory", "done"],
      ["human_review", "done"],
      ["refresh_artifacts", "done"],
    ])
    expect(roadmap.steps.at(-1)?.detail).toContain("LoRA-ready 已覆盖")
    expect(roadmap.steps.find((step) => step.id === "refresh_artifacts")?.action).toMatchObject({
      label: "定位 LoRA-ready",
      auditContext: {
        sourceTitle: "LoRA-ready 来源",
        sourceTrajectoryId: "traj_from_result",
        refKind: "adapter_candidate",
        refId: "adapter_entry_risk_1",
        collectionResultId: "stockfb_collection_result_entry_risk_1",
      },
    })
  })

  it("builds actionable roadmaps for persisted recent collection result cards", () => {
    const card = buildCollectionResultHistoryCard({
      id: "stockfb_collection_result_entry_risk_1",
      result: "confirmed",
      resultLabel: "证据已确认",
      targetProfitCredit: "execution_risk_negative",
      targetProfitCreditLabel: "执行风险负样本",
      evidenceRefs: ["trade-ledger:entry-risk-1"],
      peftBoundary: {
        storesRawFacts: false,
        factsRemainIn: ["retrieval/tool state"],
        adapterStores: ["risk_control"],
      },
    }, {
      trajectories: [{
        id: "traj_from_result",
        validationTarget: "priced_in_risk",
        sourceRecordId: "stockfb_collection_result_entry_risk_1",
      }],
      loraReady: {
        refs: [{
          id: "adapter_entry_risk_1",
          refKind: "adapter_candidate",
          collectionResultId: "stockfb_collection_result_entry_risk_1",
          sourceTrajectoryId: "traj_from_result",
          sourceKind: "stock-feedback-collection-result",
          bucketId: "default_downweighted_pending_review",
          bucketLabel: "未审默认降权",
          sampling: "downsample_until_review",
          effectiveWeightMultiplier: 0.25,
        }],
      },
    })

    expect(card.targetLabel).toBe("执行风险负样本")
    expect(card.evidenceRefCount).toBe(1)
    expect(card.collectionTask).toMatchObject({
      targetProfitCredit: "execution_risk_negative",
      targetProfitCreditLabel: "执行风险负样本",
    })
    expect(card.followUp).toMatchObject({
      primaryAction: "rebuild_trajectories",
      refreshLoraReadyLabel: "重建并刷新 LoRA-ready",
    })
    expect(card.roadmap).toMatchObject({
      headline: "回流路线图：训练产物已覆盖",
      activeStepId: "refresh_artifacts",
    })
    expect(card.roadmap?.steps.find((step) => step.id === "refresh_artifacts")?.action).toMatchObject({
      label: "定位 LoRA-ready",
      auditContext: {
        sourceTitle: "LoRA-ready 来源",
        sourceTrajectoryId: "traj_from_result",
        refId: "adapter_entry_risk_1",
        bucketLabel: "未审默认降权",
        sampling: "downsample_until_review",
        effectiveWeightMultiplier: 0.25,
      },
    })
    expect(card.refreshAction).toMatchObject({
      label: "定位 LoRA-ready",
      auditContext: {
        sourceTitle: "LoRA-ready 来源",
        sourceTrajectoryId: "traj_from_result",
        refId: "adapter_entry_risk_1",
        bucketLabel: "未审默认降权",
        sampling: "downsample_until_review",
        effectiveWeightMultiplier: 0.25,
      },
    })
    expect(card.nextAction).toMatchObject({
      headline: "当前下一步：已覆盖",
      actionKind: "none",
      actionLabel: "已闭环",
      tone: "good",
      step: {
        id: "refresh_artifacts",
        status: "done",
      },
    })
    expect(card.reviewPreview).toMatchObject({
      recommendedAction: "mark_entry_wrong",
      recommendedActionLabel: "标记买点错",
    })
    expect(card.humanReviewBridge).toMatchObject({
      headline: "人审入口：定位回流轨迹",
      actionLabel: "定位并人审",
      step: {
        id: "human_review",
        action: {
          auditContext: {
            sourceTrajectoryId: "traj_from_result",
          },
        },
      },
    })
  })

  it("keeps insufficient collection results in补证 instead of trainable refresh", () => {
    const followUp = buildCollectionResultFollowUp({
      result: "insufficient",
      resultLabel: "证据不足",
      targetPatternId: "fundamental_closure_confirmation",
      targetPatternLabel: "基本面兑现确认",
      evidenceRefs: [],
      nextAction: "keep_collection_task_open",
    })

    expect(followUp).toMatchObject({
      headline: "证据不足，采集单保持打开",
      tone: "warn",
      primaryAction: "continue_collection",
      primaryActionLabel: "继续补证",
      refreshLoraReadyLabel: null,
      keepCollectionOpen: true,
    })
    expect(followUp?.detail).toContain("基本面兑现确认")
    expect(followUp?.detail).toContain("不要提升训练权重")
    expect(followUp?.nextStep).toContain("补齐 retrieval/tool state")
  })

  it("blocks training roadmap when collection results still need evidence", () => {
    const roadmap = buildCollectionResultActionRoadmap({
      result: "insufficient",
      resultLabel: "证据不足",
      targetPatternId: "fundamental_closure_confirmation",
      targetPatternLabel: "基本面兑现确认",
      evidenceRefs: [],
    })

    expect(roadmap).toMatchObject({
      headline: "回流路线图：继续补证",
      activeStepId: "resolve_evidence",
      tone: "warn",
    })
    expect(roadmap.steps.map((step) => [step.id, step.status])).toEqual([
      ["record_result", "done"],
      ["resolve_evidence", "active"],
      ["rebuild_trajectory", "blocked"],
      ["human_review", "blocked"],
      ["refresh_artifacts", "blocked"],
    ])
    expect(roadmap.steps.at(-1)?.detail).toContain("不得刷新训练权重")
  })

  it("routes refuted collection results toward negative benchmark review", () => {
    const followUp = buildCollectionResultFollowUp({
      result: "refuted",
      resultLabel: "证据反驳",
      targetProfitCredit: "failed_expectation_negative",
      targetProfitCreditLabel: "失败预期负样本",
      evidenceRefs: ["retrieval:counter-evidence-1", "price-sql:no-follow-through"],
      evidenceRefCount: 2,
      nextAction: "keep_as_negative_eval_or_close_gap",
    })

    expect(followUp).toMatchObject({
      headline: "证据反驳，转负样本复核",
      tone: "danger",
      primaryAction: "build_benchmark",
      primaryActionLabel: "生成 Benchmark",
      refreshLoraReadyLabel: null,
      keepCollectionOpen: false,
    })
    expect(followUp?.detail).toContain("失败预期负样本")
    expect(followUp?.detail).toContain("负样本")
    expect(followUp?.nextStep).toContain("eval/preference")
  })

  it("routes refuted collection results to negative benchmark instead of positive LoRA", () => {
    const roadmap = buildCollectionResultActionRoadmap({
      result: "refuted",
      resultLabel: "证据反驳",
      targetProfitCredit: "failed_expectation_negative",
      targetProfitCreditLabel: "失败预期负样本",
      evidenceRefs: ["retrieval:counter-evidence-1", "price-sql:no-follow-through"],
      evidenceRefCount: 2,
    })

    expect(roadmap).toMatchObject({
      headline: "回流路线图：转负样本 Benchmark",
      activeStepId: "human_review",
      tone: "danger",
    })
    expect(roadmap.steps.map((step) => [step.id, step.status])).toEqual([
      ["record_result", "done"],
      ["resolve_evidence", "done"],
      ["rebuild_trajectory", "pending"],
      ["human_review", "active"],
      ["refresh_artifacts", "blocked"],
    ])
    expect(roadmap.steps.at(-1)?.detail).toContain("不进入正向 adapter")
  })

  it("reconstructs collection context from persisted recent collection results", () => {
    const task = collectionTaskFromCollectionResult({
      result: "insufficient",
      sourceDraftId: "stockfb_collection_draft_entry_risk",
      sourceTaskId: "stockfb_collect_profit_entry_risk",
      targetProfitCredit: "execution_risk_negative",
      targetProfitCreditLabel: "执行风险负样本",
      validationTarget: "priced_in_risk",
      adapterCapability: "priced_in_risk_judgment",
      peftBoundary: {
        storesRawFacts: false,
        adapterStores: ["behavior", "skill", "tool_habit", "decision_strategy"],
      },
    })

    expect(task).toMatchObject({
      draftId: "stockfb_collection_draft_entry_risk",
      taskId: "stockfb_collect_profit_entry_risk",
      targetProfitCredit: "execution_risk_negative",
      targetProfitCreditLabel: "执行风险负样本",
      validationTarget: "priced_in_risk",
      adapterCapability: "priced_in_risk_judgment",
      suggestedFilters: {
        profitCredit: "execution_risk_negative",
        validationTarget: "priced_in_risk",
        qualityGate: null,
      },
      peftBoundary: {
        storesRawFacts: false,
      },
    })
  })

  it("finds rebuilt trajectories for collection results by result id before draft fallback", () => {
    const trajectories = [
      {
        id: "draft-fallback",
        sourceRecordId: "other_result",
        evidenceState: {
          sourceDraftId: "stockfb_collection_draft_entry_risk",
        },
      },
      {
        id: "direct-result",
        sourceRecordId: "stockfb_collection_result_entry_risk",
        evidenceState: {
          collectionResultId: "stockfb_collection_result_entry_risk",
          sourceDraftId: "stockfb_collection_draft_entry_risk",
        },
      },
    ]

    expect(findTrajectoryForCollectionResult(trajectories, {
      id: "stockfb_collection_result_entry_risk",
      sourceDraftId: "stockfb_collection_draft_entry_risk",
    })?.id).toBe("direct-result")
  })

  it("falls back to source draft or task when rebuilt trajectory omits sourceRecordId", () => {
    const trajectories = [
      {
        id: "unrelated",
        collectionState: {
          sourceTaskId: "other_task",
        },
      },
      {
        id: "task-match",
        collectionState: {
          sourceDraftId: "stockfb_collection_draft_entry_risk",
          sourceTaskId: "stockfb_collect_profit_entry_risk",
        },
      },
    ]

    expect(findTrajectoryForCollectionResult(trajectories, {
      sourceDraftId: "stockfb_collection_draft_entry_risk",
      sourceTaskId: "stockfb_collect_profit_entry_risk",
    })?.id).toBe("task-match")
    expect(findTrajectoryForCollectionResult(trajectories, {
      sourceDraftId: "missing_draft",
      sourceTaskId: "missing_task",
    })).toBeNull()
  })

  it("builds compact list signals for real profit feedback", () => {
    expect(buildProfitFeedbackListSignal({
      outcome: "profitable",
      realizedPnlPct: 12.4,
      maxDrawdownPct: 5.8,
      holdingDays: 4,
    })).toMatchObject({
      label: "盈利支持",
      tone: "good",
      trainingUse: "adapter_candidate_after_review",
    })

    expect(buildProfitFeedbackListSignal({
      outcome: "loss",
      realizedPnlPct: -4.6,
      maxDrawdownPct: 7.2,
      entryTiming: "late_chase",
    })).toMatchObject({
      label: "亏损负样本",
      tone: "danger",
      trainingUse: "eval_preference_negative",
    })

    expect(buildProfitFeedbackListSignal({
      outcome: "direction_right_entry_risk",
      realizedPnlPct: 1.2,
      maxDrawdownPct: 9.5,
    })).toMatchObject({
      label: "买点风险",
      tone: "warn",
      trainingUse: "eval_preference_negative",
    })

    expect(buildProfitFeedbackListSignal({ outcome: "unknown" })).toBeNull()
  })

  it("filters trajectory rows by profit feedback signal", () => {
    const trajectories = [
      { id: "win", profitFeedback: { outcome: "profitable", realizedPnlPct: 8.2 } },
      { id: "loss", profitFeedback: { outcome: "loss", realizedPnlPct: -3.1 } },
      { id: "entry-risk", profitFeedback: { outcome: "direction_right_entry_risk", realizedPnlPct: 1.2 } },
      { id: "pending", profitFeedback: { outcome: "market_validated_unrealized" } },
      { id: "unknown", profitFeedback: { outcome: "unknown" } },
    ]

    expect(filterTrajectoriesByProfitFeedbackSignal(trajectories, "all").map((item) => item.id)).toEqual([
      "win",
      "loss",
      "entry-risk",
      "pending",
      "unknown",
    ])
    expect(filterTrajectoriesByProfitFeedbackSignal(trajectories, "profitable").map((item) => item.id)).toEqual(["win"])
    expect(filterTrajectoriesByProfitFeedbackSignal(trajectories, "risk_negative").map((item) => item.id)).toEqual(["loss", "entry-risk"])
    expect(filterTrajectoriesByProfitFeedbackSignal(trajectories, "pending").map((item) => item.id)).toEqual(["pending"])
  })

  it("keeps entry-wrong and priced-in review actions visible for profit-feedback driven routing", () => {
    const visible = visibleReviewActionOptions([
      { action: "approve_for_adapter" },
      { action: "approve_paper_adapter_candidate" },
      { action: "mark_entry_wrong" },
      { action: "mark_priced_in" },
      { action: "unsupported_action" },
    ]).map((option) => option.action)

    expect(visible).toEqual(["approve_for_adapter", "approve_paper_adapter_candidate", "mark_entry_wrong", "mark_priced_in"])
  })

  it("builds a profit-feedback review worklist from real outcomes and human action plans", () => {
    const trajectories = [
      { id: "win", profitFeedback: { outcome: "profitable", realizedPnlPct: 8.2 } },
      { id: "loss", profitFeedback: { outcome: "loss", realizedPnlPct: -3.1 } },
      { id: "entry-risk", profitFeedback: { outcome: "direction_right_entry_risk", realizedPnlPct: 1.2 } },
      { id: "pending", profitFeedback: { outcome: "market_validated_unrealized" } },
      { id: "unknown", profitFeedback: { outcome: "unknown" } },
    ]
    const reviewByTrajectory = new Map([
      ["win", { sourceTrajectoryId: "win", recommendedAction: "approve_for_adapter", reviewStatus: "pending" }],
      ["loss", { sourceTrajectoryId: "loss", recommendedAction: "route_to_preference", reviewStatus: "pending" }],
      ["entry-risk", { sourceTrajectoryId: "entry-risk", humanActionPlan: { recommendedAction: "mark_entry_wrong" }, reviewStatus: "reviewed" }],
      ["pending", { sourceTrajectoryId: "pending", recommendedAction: "route_to_eval", reviewStatus: "pending" }],
    ])

    const worklist = buildProfitFeedbackReviewWorklist(trajectories, reviewByTrajectory)

    expect(worklist.map((item) => item.id)).toEqual(["profitable", "entry_risk", "loss_negative", "pending"])
    expect(worklist).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "profitable",
        count: 1,
        pendingCount: 1,
        filter: "profitable",
        firstTrajectoryId: "win",
        recommendedAction: "approve_for_adapter",
      }),
      expect.objectContaining({
        id: "entry_risk",
        count: 1,
        reviewedCount: 1,
        filter: "risk_negative",
        firstTrajectoryId: "entry-risk",
        recommendedAction: "mark_entry_wrong",
      }),
      expect.objectContaining({
        id: "loss_negative",
        count: 1,
        pendingCount: 1,
        filter: "risk_negative",
        firstTrajectoryId: "loss",
        recommendedAction: "route_to_preference",
      }),
      expect.objectContaining({
        id: "pending",
        count: 1,
        pendingCount: 1,
        filter: "pending",
        firstTrajectoryId: "pending",
        recommendedAction: "route_to_eval",
      }),
    ]))
  })

  it("keeps profitable feedback positive but bounded by drawdown and sizing review", () => {
    const hint = buildProfitFeedbackDistillationHint({
      outcome: "profitable",
      realizedPnlPct: 12.4,
      maxDrawdownPct: 5.8,
      holdingDays: 4,
      entryTiming: "low_absorption_then_breakout",
      positionSizing: "small_probe_then_add",
      creditAssignment: {
        primaryCredit: "pattern_execution_supported",
        trainingUse: "adapter_candidate_after_review",
        adapterLearns: ["entry_timing", "position_sizing", "exit_discipline", "drawdown_control"],
        storesRawFacts: false,
        summary: "profit_credit=pattern_execution_supported / training_use=adapter_candidate_after_review",
      },
    })

    expect(hint).toMatchObject({
      headline: "收益支持该手法",
      tone: "good",
      trainingUse: "adapter_candidate_after_review",
    })
    expect(hint?.detail).toContain("回撤 5.8%")
    expect(hint?.detail).toContain("仓位")
    expect(hint?.detail).toContain("pattern_execution_supported")
    expect(hint?.detail).toContain("不存原始事实")
  })

  it("routes loss and entry-risk feedback toward eval or preference", () => {
    const loss = buildProfitFeedbackDistillationHint({
      outcome: "loss",
      realizedPnlPct: -4.6,
      maxDrawdownPct: 7.2,
      holdingDays: 2,
      entryTiming: "late_chase",
      creditAssignment: {
        primaryCredit: "execution_risk_negative",
        trainingUse: "eval_preference_negative",
        adapterLearns: ["entry_risk", "position_sizing", "stop_loss_or_exit_discipline"],
        failureModes: ["late_entry_or_chase"],
        storesRawFacts: false,
        summary: "profit_credit=execution_risk_negative / training_use=eval_preference_negative",
      },
    })
    const entryRisk = buildProfitFeedbackDistillationHint({
      outcome: "direction_right_entry_risk",
      realizedPnlPct: 1.2,
      maxDrawdownPct: 9.5,
      holdingDays: 3,
    })

    expect(loss).toMatchObject({
      headline: "优先进入风险/负样本",
      tone: "danger",
      trainingUse: "eval_preference_negative",
    })
    expect(loss?.detail).toContain("亏损")
    expect(loss?.detail).toContain("买点")
    expect(loss?.detail).toContain("execution_risk_negative")
    expect(entryRisk?.detail).toContain("方向对但买点")
    expect(entryRisk?.trainingUse).toBe("eval_preference_negative")
  })

  it("summarizes whether profit feedback is ready for distillation", () => {
    const profitable = buildProfitFeedbackDistillationReadiness({
      id: "profit-ready",
      validationTarget: "expectation_trade",
      qualityGate: { status: "expectation_validated", highConfidenceEligible: true },
      profitFeedback: {
        outcome: "profitable",
        realizedPnlPct: 12.4,
        maxDrawdownPct: 5.8,
        holdingDays: 4,
        entryTiming: "low_absorption_then_breakout",
        exitTiming: "trend_fade_exit",
        positionSizing: "small_probe_then_add",
        creditAssignment: {
          primaryCredit: "pattern_execution_supported",
          trainingUse: "adapter_candidate_after_review",
          adapterLearns: ["entry_timing", "position_sizing", "drawdown_control"],
          storesRawFacts: false,
        },
      },
      evidenceState: {
        confirmedEvidenceRefs: ["trade-ledger:profit-ready"],
      },
      sourceRefs: ["price-sql:profit-ready"],
    })

    expect(profitable).toMatchObject({
      headline: "收益反馈可蒸馏",
      status: "ready",
      tone: "good",
      canPromoteAdapter: true,
      routeLabel: "复核后 adapter",
    })
    expect(profitable.detail).toContain("LoRA 只学习")
    expect(profitable.detail).toContain("retrieval/tool state")
    expect(profitable.checks.map((check) => [check.id, check.status])).toEqual([
      ["settled_pnl", "passed"],
      ["drawdown", "passed"],
      ["holding_period", "passed"],
      ["credit_assignment", "passed"],
      ["tool_state_refs", "passed"],
      ["peft_boundary", "passed"],
    ])
    expect(profitable.nextAction).toContain("人工复核后")
  })

  it("blocks positive adapter promotion when profit feedback lacks evidence or PEFT boundary", () => {
    const pending = buildProfitFeedbackDistillationReadiness({
      id: "pending-profit",
      validationTarget: "expectation_trade",
      profitFeedback: {
        outcome: "market_validated_unrealized",
      },
    })

    expect(pending).toMatchObject({
      headline: "等待收益闭环",
      status: "monitor_until_settled",
      tone: "warn",
      canPromoteAdapter: false,
      routeLabel: "继续观察",
    })
    expect(pending.missing).toEqual(expect.arrayContaining(["真实盈亏", "最大回撤", "持有期", "收益归因", "工具态引用", "PEFT 边界"]))
    expect(pending.nextAction).toContain("补交易收益")

    const unsafe = buildProfitFeedbackDistillationReadiness({
      id: "unsafe-profit",
      validationTarget: "expectation_trade",
      profitFeedback: {
        outcome: "profitable",
        realizedPnlPct: 8.1,
        maxDrawdownPct: 4.2,
        holdingDays: 3,
        creditAssignment: {
          primaryCredit: "pattern_execution_supported",
          trainingUse: "adapter_candidate_after_review",
          storesRawFacts: true,
        },
      },
      sourceRefs: ["trade-ledger:unsafe-profit"],
    })

    expect(unsafe).toMatchObject({
      headline: "收益反馈边界待修正",
      status: "needs_boundary",
      tone: "danger",
      canPromoteAdapter: false,
    })
    expect(unsafe.missing).toEqual(expect.arrayContaining(["PEFT 边界"]))
    expect(unsafe.detail).toContain("不得进入正向 adapter")
  })

  it("routes settled loss feedback as ready negative distillation instead of adapter promotion", () => {
    const readiness = buildProfitFeedbackDistillationReadiness({
      id: "loss-ready",
      validationTarget: "priced_in_risk",
      profitFeedback: {
        outcome: "direction_right_entry_risk",
        realizedPnlPct: 1.2,
        maxDrawdownPct: 9.5,
        holdingDays: 3,
        creditAssignment: {
          primaryCredit: "execution_risk_negative",
          trainingUse: "eval_preference_negative",
          adapterLearns: ["entry_risk", "drawdown_control"],
          failureModes: ["late_entry_or_chase"],
          storesRawFacts: false,
        },
      },
      sourceRefs: ["trade-ledger:entry-risk"],
    })

    expect(readiness).toMatchObject({
      headline: "收益风险反馈可蒸馏",
      status: "ready",
      tone: "danger",
      canPromoteAdapter: false,
      routeLabel: "eval/preference/负样本",
    })
    expect(readiness.detail).toContain("方向对但买点错")
    expect(readiness.detail).toContain("风险控制")
  })

  it("builds a collection task from missing positive profit readiness checks", () => {
    const trajectory = {
      id: "pending-profit",
      validationTarget: "expectation_trade",
      profitFeedback: {
        outcome: "market_validated_unrealized",
      },
      qualityGate: { status: "expectation_validated" },
    }
    const readiness = buildProfitFeedbackDistillationReadiness(trajectory)
    const task = buildProfitFeedbackCollectionTask(trajectory, readiness)

    expect(task).toMatchObject({
      targetProfitCredit: "pattern_execution_supported",
      targetProfitCreditLabel: "收益支持手法执行",
      validationTarget: "expectation_trade",
      adapterCapability: "expectation_trade_judgment",
      recommendedAction: "collect_profit_feedback_review",
      priority: "high",
      suggestedFilters: {
        profitCredit: "pattern_execution_supported",
        profitFeedback: "pending",
        validationTarget: "expectation_trade",
        qualityGate: "expectation_validated",
      },
      peftBoundary: {
        storesRawFacts: false,
        factsRemainIn: ["retrieval/tool state"],
      },
    })
    expect(task?.goal).toContain("补齐收益反馈蒸馏缺口")
    expect(task?.humanPrompt).toContain("真实盈亏")
    expect(task?.requiredToolState).toEqual(expect.arrayContaining(["price_sql", "trade_ledger", "retrieval_source_refs"]))
    expect(task?.sampleMustInclude).toEqual(expect.arrayContaining(["realizedPnlPct", "sourceRefs_or_trade_ledger"]))
  })

  it("builds a risk collection task when profit feedback cannot be promoted", () => {
    const trajectory = {
      id: "risk-missing-boundary",
      validationTarget: "priced_in_risk",
      qualityGate: { status: "priced_in_validated" },
      profitFeedback: {
        outcome: "direction_right_entry_risk",
        realizedPnlPct: 1.2,
        maxDrawdownPct: 9.5,
        holdingDays: 3,
        creditAssignment: {
          primaryCredit: "execution_risk_negative",
          trainingUse: "eval_preference_negative",
          storesRawFacts: true,
        },
      },
    }
    const readiness = buildProfitFeedbackDistillationReadiness(trajectory)
    const task = buildProfitFeedbackCollectionTask(trajectory, readiness)

    expect(task).toMatchObject({
      targetProfitCredit: "execution_risk_negative",
      targetProfitCreditLabel: "执行风险负样本",
      validationTarget: "priced_in_risk",
      adapterCapability: "priced_in_risk_judgment",
      suggestedFilters: {
        profitCredit: "execution_risk_negative",
        profitFeedback: "risk_negative",
        validationTarget: "priced_in_risk",
      },
      peftBoundary: {
        storesRawFacts: false,
        factsRemainIn: ["retrieval/tool state"],
      },
    })
    expect(task?.humanPrompt).toContain("PEFT 边界")
    expect(task?.acceptanceCriteria).toEqual(expect.arrayContaining([
      "事实、公告、价格行和交易记录保留在 retrieval/tool state",
    ]))
  })

  it("does not build a new collection task when positive profit feedback is already adapter-ready", () => {
    const trajectory = {
      id: "ready-profit",
      validationTarget: "expectation_trade",
      qualityGate: { status: "expectation_validated", highConfidenceEligible: true },
      profitFeedback: {
        outcome: "profitable",
        realizedPnlPct: 8.1,
        maxDrawdownPct: 3.2,
        holdingDays: 5,
        creditAssignment: {
          primaryCredit: "pattern_execution_supported",
          trainingUse: "adapter_candidate_after_review",
          storesRawFacts: false,
        },
      },
      sourceRefs: ["trade-ledger:ready-profit"],
    }
    const readiness = buildProfitFeedbackDistillationReadiness(trajectory)

    expect(buildProfitFeedbackCollectionTask(trajectory, readiness)).toBeNull()
  })

  it("inlines the active collection task when it belongs to the selected profit readiness gap", () => {
    const trajectory = {
      id: "pending-profit",
      validationTarget: "expectation_trade",
      qualityGate: { status: "expectation_validated" },
      profitFeedback: {
        outcome: "market_validated_unrealized",
      },
    }
    const task = buildProfitFeedbackCollectionTask(
      trajectory,
      buildProfitFeedbackDistillationReadiness(trajectory),
    )

    expect(shouldInlineProfitCollectionTask(task, trajectory)).toBe(true)
    expect(shouldInlineProfitCollectionTask({
      targetProfitCredit: "execution_risk_negative",
      targetProfitCreditLabel: "执行风险负样本",
      validationTarget: "priced_in_risk",
    }, trajectory)).toBe(false)
    expect(shouldInlineProfitCollectionTask(task, {
      id: "ready-profit",
      validationTarget: "expectation_trade",
      qualityGate: { status: "expectation_validated", highConfidenceEligible: true },
      profitFeedback: {
        outcome: "profitable",
        realizedPnlPct: 8.1,
        maxDrawdownPct: 3.2,
        holdingDays: 5,
        creditAssignment: {
          primaryCredit: "pattern_execution_supported",
          trainingUse: "adapter_candidate_after_review",
          storesRawFacts: false,
        },
      },
      sourceRefs: ["trade-ledger:ready-profit"],
    })).toBe(false)
  })

  it("inlines collection-result follow-up when it belongs to the selected profit gap", () => {
    const trajectory = {
      id: "pending-profit",
      validationTarget: "expectation_trade",
      qualityGate: { status: "expectation_validated" },
      profitFeedback: {
        outcome: "market_validated_unrealized",
      },
    }
    const result = {
      id: "stockfb_collection_result_pending_profit",
      sourceDraftId: "stockfb_profit_task_pending_preview",
      sourceTaskId: "stockfb_collect_profit_preview",
      targetProfitCredit: "pattern_execution_supported",
      targetProfitCreditLabel: "收益支持手法执行",
      validationTarget: "expectation_trade",
      result: "confirmed",
      resultLabel: "证据已确认",
      evidenceRefs: ["trade-ledger:pending-profit"],
      peftBoundary: {
        storesRawFacts: false,
        factsRemainIn: ["retrieval/tool state"],
        adapterStores: ["expectation_trade_judgment"],
      },
    }

    expect(shouldInlineCollectionResultFollowUp(result, trajectory)).toBe(true)
    expect(shouldInlineCollectionResultFollowUp({
      ...result,
      targetProfitCredit: "execution_risk_negative",
      targetProfitCreditLabel: "执行风险负样本",
      validationTarget: "priced_in_risk",
    }, trajectory)).toBe(false)
    expect(shouldInlineCollectionResultFollowUp(result, {
      id: "ready-profit",
      validationTarget: "expectation_trade",
      qualityGate: { status: "expectation_validated", highConfidenceEligible: true },
      profitFeedback: {
        outcome: "profitable",
        realizedPnlPct: 8.1,
        maxDrawdownPct: 3.2,
        holdingDays: 5,
        creditAssignment: {
          primaryCredit: "pattern_execution_supported",
          trainingUse: "adapter_candidate_after_review",
          storesRawFacts: false,
        },
      },
      sourceRefs: ["trade-ledger:ready-profit"],
    })).toBe(false)
  })
})
