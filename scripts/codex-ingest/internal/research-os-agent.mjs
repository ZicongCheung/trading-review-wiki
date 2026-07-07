import fs from "node:fs/promises"
import path from "node:path"

import {
  DEFAULT_PROJECT_PATH,
  appendJsonl,
  normalizePath,
  nowLocalTimestamp,
  projectRelative,
  safeErrorMessage,
  shortHash,
  writeJson,
} from "./core.mjs"
import {
  buildStockFeedbackBenchmark,
  validateStockFeedbackExecutionResults,
  buildStockFeedbackPaperTradeAgentCandidates,
  buildStockFeedbackTrajectories,
  exportStockFeedbackLoraReady,
  getStockFeedbackStatus,
  verifyStockFeedbackArtifacts,
} from "./stock-feedback.mjs"
import {
  buildHypothesisEvidenceFeedback,
  draftHypothesisEvidenceLinks,
  draftHypothesisEvidenceTasks,
  listHypothesisEvidenceTaskDrafts,
  listHypotheses,
  verifyHypothesisEngineArtifacts,
} from "./hypothesis.mjs"
import {
  buildSourceIntegrityAudit,
  isOfficialDisclosureRef,
  sourceIntegrityPriority,
  sourceIntegrityProfileForAudit,
  summarizeSourceIntegrityAudits,
  summarizeSourceIntegrityProfiles,
} from "./source-integrity.mjs"

export const RESEARCH_OS_AGENT_CONTEXT_SCHEMA = "research-os-agent-context-v1"
export const RESEARCH_OS_AGENT_PLAN_SCHEMA = "research-os-agent-plan-v1"
export const RESEARCH_OS_AGENT_STEP_RESULT_SCHEMA = "research-os-agent-step-result-v1"
export const RESEARCH_OS_AGENT_RUN_MANIFEST_SCHEMA = "research-os-agent-run-manifest-v1"
export const RESEARCH_OS_AGENT_VERIFY_SCHEMA = "research-os-agent-verify-result-v1"
export const RESEARCH_OS_AGENT_ROOT = ".llm-wiki/research-os/agent-runs"

const FIXED_ACTIONS = Object.freeze({
  hypothesis_feedback_write: {
    fixedAction: "hypothesis-evidence-feedback-write",
    agentId: "HypothesisAgent",
    writeCommand: "hypothesis evidence-feedback --status watching --write",
    expectedArtifacts: [".llm-wiki/hypothesis-evidence-feedback/*.jsonl", ".llm-wiki/hypothesis-evidence-feedback/*.manifest.json"],
    allowedRoots: [".llm-wiki/hypothesis-evidence-feedback"],
  },
  hypothesis_evidence_task_drafts_write: {
    fixedAction: "hypothesis-evidence-task-drafts-write",
    agentId: "HypothesisAgent",
    writeCommand: "hypothesis evidence-task-drafts --status watching --write",
    expectedArtifacts: [".llm-wiki/hypothesis-evidence-task-drafts/*.jsonl", ".llm-wiki/hypothesis-evidence-task-drafts/*.manifest.json"],
    allowedRoots: [".llm-wiki/hypothesis-evidence-task-drafts"],
  },
  hypothesis_evidence_task_draft_review: {
    fixedAction: "hypothesis-evidence-task-draft-review",
    agentId: "EvidencePlanningAgent",
    writeCommand: "hypothesis evidence-task-draft-review --draft-id <id> --stock-code <code> --stock-name <name> --confirm-human-gate true --write",
    expectedArtifacts: [".llm-wiki/stock-feedback/evidence-tasks/*.jsonl"],
    allowedRoots: [".llm-wiki/stock-feedback/evidence-tasks"],
  },
  hypothesis_evidence_link_review: {
    fixedAction: "hypothesis-evidence-link-review",
    agentId: "HypothesisLinkAgent",
    writeCommand: "hypothesis evidence-link-review --draft-id <id> --candidate-index <n> --confirm-human-gate true --write",
    expectedArtifacts: [".llm-wiki/hypothesis-evidence-links/*.jsonl", ".llm-wiki/hypothesis-evidence-links/*.manifest.json"],
    allowedRoots: [".llm-wiki/hypothesis-evidence-links"],
  },
  paper_trade_agent_candidates: {
    fixedAction: "stock-feedback-paper-trade-agent-candidates",
    agentId: "PaperTradeAgent",
    writeCommand: "stock-feedback paper-trade-agent candidates --write",
    expectedArtifacts: [".llm-wiki/stock-feedback/paper-trade-agent/*.jsonl", ".llm-wiki/stock-feedback/paper-trade-agent/*.manifest.json"],
    allowedRoots: [".llm-wiki/stock-feedback/paper-trade-agent"],
  },
  execution_result_validate: {
    fixedAction: "stock-feedback-execution-result-validate",
    agentId: "ExecutionResultAgent",
    writeCommand: "stock-feedback execution-result validate --write",
    expectedArtifacts: [".llm-wiki/stock-feedback/execution-results/*.jsonl", ".llm-wiki/stock-feedback/execution-results/*.manifest.json"],
    allowedRoots: [".llm-wiki/stock-feedback/execution-results"],
  },
  build_trajectories: {
    fixedAction: "stock-feedback-build-trajectories",
    agentId: "AttributionAgent",
    writeCommand: "stock-feedback build-trajectories --write",
    expectedArtifacts: [".llm-wiki/stock-feedback/trajectories/*.jsonl"],
    allowedRoots: [".llm-wiki/stock-feedback/trajectories"],
  },
  build_benchmark: {
    fixedAction: "stock-feedback-bench",
    agentId: "BenchmarkAgent",
    writeCommand: "stock-feedback bench --write",
    expectedArtifacts: [".llm-wiki/stock-feedback/benchmark/*.jsonl", ".llm-wiki/stock-feedback/benchmark/*.manifest.json"],
    allowedRoots: [".llm-wiki/stock-feedback/benchmark"],
  },
  export_lora_ready: {
    fixedAction: "stock-feedback-export-lora-ready",
    agentId: "CurriculumAgent",
    writeCommand: "stock-feedback export-lora-ready --write",
    expectedArtifacts: [".llm-wiki/stock-feedback/exports/*.jsonl", ".llm-wiki/stock-feedback/exports/*.manifest.json"],
    allowedRoots: [".llm-wiki/stock-feedback/exports"],
  },
})

function timestampSlug(generatedAt) {
  return String(generatedAt ?? nowLocalTimestamp()).replace(/\D/g, "").slice(0, 14) || "00000000000000"
}

function runIdFor(generatedAt, seed = "research-os-agent") {
  return `ROA-${timestampSlug(generatedAt)}-${shortHash(`${seed}:${generatedAt}`).slice(0, 8)}`
}

function compactIssues(issues = [], limit = 8) {
  return issues.slice(0, limit).map((issue) => ({
    severity: issue.severity ?? null,
    code: issue.code ?? null,
    id: issue.id ?? null,
    message: issue.message ?? null,
  }))
}

function writePolicy(readOnly = true) {
  return {
    readOnly,
    allowedRoot: RESEARCH_OS_AGENT_ROOT,
    wroteWiki: false,
    wroteRaw: false,
    wroteBrain: false,
    wroteRealTrade: false,
    wroteArtifacts: !readOnly,
  }
}

function candidateConfidencePriority(confidence = "") {
  const ranks = {
    high: 0,
    medium: 1,
    low: 2,
    none: 3,
  }
  return ranks[String(confidence)] ?? 4
}

function compareEvidenceLinkReviewPriority(left = {}, right = {}) {
  return sourceIntegrityPriority(left.sourceIntegrity) - sourceIntegrityPriority(right.sourceIntegrity)
    || candidateConfidencePriority(left.selectedCandidate?.confidence ?? left.candidate?.confidence)
      - candidateConfidencePriority(right.selectedCandidate?.confidence ?? right.candidate?.confidence)
    || Number(right.selectedCandidate?.score ?? right.candidate?.score ?? 0)
      - Number(left.selectedCandidate?.score ?? left.candidate?.score ?? 0)
    || String(left.id ?? left.targetId ?? "").localeCompare(String(right.id ?? right.targetId ?? ""))
}

function evidenceReviewHumanGateAction(plan = {}) {
  if (plan.status === "hard_source_review_ready") return "approve_or_reject_after_manual_source_check"
  if (plan.status === "duplicate_web_lead_after_hard_source") return "reject_duplicate_or_request_more_evidence"
  if (plan.status === "needs_manual_review_or_more_evidence") return "request_hard_source_before_approval"
  return "manual_review_required"
}

function evidenceReviewPreferredCommand(plan = {}) {
  if (plan.status === "duplicate_web_lead_after_hard_source") return plan.rejectCommand ?? plan.approveCommand ?? null
  if (plan.status === "needs_manual_review_or_more_evidence") return plan.rejectCommand ?? plan.approveCommand ?? null
  return plan.approveCommand ?? plan.rejectCommand ?? null
}

function buildEvidenceResultReviewActionTable(samples = []) {
  return samples
    .filter((sample) => sample?.reviewPlan?.requiresHumanGate)
    .map((sample) => {
      const plan = sample.reviewPlan ?? {}
      const preferredCommand = evidenceReviewPreferredCommand(plan)
      return {
        targetType: "evidence_result",
        targetId: sample.resultId ?? null,
        taskId: sample.taskId ?? null,
        stockCode: sample.stockCode ?? null,
        stockName: sample.stockName ?? null,
        taskType: sample.taskType ?? null,
        reviewStatus: plan.status ?? null,
        riskLevel: plan.riskLevel ?? null,
        recommendedAction: plan.recommendedAction ?? null,
        humanGateAction: evidenceReviewHumanGateAction(plan),
        preferredCommand,
        alternativeCommands: [plan.approveCommand, plan.rejectCommand]
          .filter(Boolean)
          .filter((command) => command !== preferredCommand),
        blockers: plan.blockers ?? [],
        sourceRefCount: (sample.sourceRefs ?? []).length,
        officialSourceRefs: (sample.sourceRefs ?? []).filter(isOfficialDisclosureRef).slice(0, 3),
      }
    })
}

function evidenceTaskFollowupAction(task = {}) {
  if (task.status === "pending") return "run_pending_evidence_task"
  if (task.status === "awaiting_review") return "review_linked_evidence_result_first"
  return "inspect_evidence_task"
}

function evidenceTaskPreferredCommand(task = {}) {
  if (!task.taskId) return null
  if (task.status === "pending") return `stock-feedback run-task-queue --task-id ${task.taskId}`
  if (task.status === "awaiting_review") return `stock-feedback evidence-result list --status awaiting_review --task-id ${task.taskId}`
  return `stock-feedback evidence-task show --task-id ${task.taskId}`
}

function buildEvidenceTaskFollowupActionTable(tasks = []) {
  return tasks
    .filter((task) => ["pending", "awaiting_review"].includes(task?.status))
    .map((task) => {
      const preferredCommand = evidenceTaskPreferredCommand(task)
      const runWriteCommand = task.status === "pending" && task.taskId ? `stock-feedback run-task-queue --task-id ${task.taskId} --write` : null
      return {
        targetType: "evidence_task",
        targetId: task.taskId ?? null,
        stockCode: task.stockCode ?? null,
        stockName: task.stockName ?? null,
        taskType: task.taskType ?? null,
        status: task.status ?? null,
        priority: task.priority ?? null,
        humanGateAction: evidenceTaskFollowupAction(task),
        preferredCommand,
        alternativeCommands: [runWriteCommand, task.taskId ? `stock-feedback evidence-task show --task-id ${task.taskId}` : null]
          .filter(Boolean)
          .filter((command) => command !== preferredCommand),
        source: task.source ?? null,
        sourceId: task.sourceId ?? null,
        targetFields: task.targetFields ?? [],
        preferredSources: task.preferredSources ?? [],
      }
    })
}

function hypothesisDraftHumanGateAction(plan = {}) {
  if (plan.status === "candidate_review_ready") return "confirm_candidate_then_promote"
  if (plan.status === "low_confidence_candidates") return "explicit_stock_identity_preferred"
  if (plan.status === "needs_stock_identity") return "provide_explicit_stock_identity"
  return "manual_review_required"
}

function buildHypothesisDraftReviewActionTable(samples = []) {
  return samples
    .filter((sample) => sample?.reviewPlan?.requiresHumanGate)
    .map((sample) => {
      const plan = sample.reviewPlan ?? {}
      const candidate = plan.recommendedCandidate ?? sample.topCandidate ?? null
      const preferredCommand = plan.status === "low_confidence_candidates"
        ? plan.saferAlternativeCommand ?? plan.writeCommand ?? null
        : plan.writeCommand ?? plan.saferAlternativeCommand ?? null
      return {
        targetType: "hypothesis_evidence_task_draft",
        targetId: sample.id ?? sample.draftId ?? null,
        hypothesisId: sample.hypothesisId ?? null,
        hypothesisTitle: sample.hypothesisTitle ?? null,
        gateStatus: sample.gateStatus ?? plan.status ?? null,
        riskLevel: plan.riskLevel ?? null,
        recommendedAction: plan.recommendedAction ?? null,
        humanGateAction: hypothesisDraftHumanGateAction(plan),
        candidate: candidate ? {
          index: candidate.index ?? sample.recommendedCandidateIndex ?? null,
          code: candidate.code ?? null,
          name: candidate.name ?? null,
          confidence: candidate.confidence ?? null,
          score: candidate.score ?? null,
        } : null,
        requiresLowConfidenceConfirmation: Boolean(plan.requiresLowConfidenceConfirmation ?? sample.requiresExtraConfirmation),
        preferredCommand,
        alternativeCommands: [plan.dryRunCommand, plan.writeCommand, plan.saferAlternativeCommand]
          .filter(Boolean)
          .filter((command) => command !== preferredCommand)
          .filter((command, index, all) => all.indexOf(command) === index),
        blockers: plan.blockers ?? [],
      }
    })
}

function hypothesisEvidenceLinkHumanGateAction(sample = {}) {
  if (sample.status === "candidate_review_ready") return "confirm_hypothesis_link_candidate"
  if (sample.status === "low_confidence_candidates") return "review_candidate_before_link"
  if (sample.status === "needs_hypothesis_mapping") return "provide_explicit_hypothesis_mapping"
  return "manual_review_required"
}

function buildHypothesisEvidenceLinkReviewActionTable(samples = []) {
  return samples
    .filter((sample) => sample?.humanGate?.required !== false)
    .map((sample) => {
      const candidate = sample.selectedCandidate ?? null
      const sourceIntegrity = sample.sourceIntegrity ?? buildSourceIntegrityAudit({
        sourceRefs: sample.evidenceSummary?.sourceRefs ?? [],
        evidenceRefs: sample.evidenceSummary?.evidenceRefs ?? [],
      })
      const candidateIndex = candidate?.index ?? sample.recommendedCandidateIndex ?? 1
      const dryRunCommand = sample.id
        ? `hypothesis evidence-link-review --draft-id ${sample.id} --candidate-index ${candidateIndex}`
        : null
      const writeCommand = dryRunCommand
        ? `${dryRunCommand} --confirm-human-gate true --write`
        : null
      const explicitMappingWrite = sample.id
        ? `hypothesis evidence-link-review --draft-id ${sample.id} --hypothesis-id <hypothesis-id> --confirm-human-gate true --write`
        : null
      const preferredCommand = sample.status === "needs_hypothesis_mapping"
        ? explicitMappingWrite
        : dryRunCommand
      const lowConfidence = sample.status === "low_confidence_candidates" || candidate?.confidence === "low"
      return {
        targetType: "hypothesis_evidence_link_draft",
        targetId: sample.id ?? null,
        evidenceResultId: sample.evidenceResultId ?? null,
        taskId: sample.taskId ?? null,
        hypothesisId: candidate?.hypothesisId ?? null,
        hypothesisTitle: candidate?.hypothesisTitle ?? null,
        stockCode: sample.stock?.code ?? null,
        stockName: sample.stock?.name ?? null,
        gateStatus: sample.status ?? null,
        riskLevel: lowConfidence || sample.status === "needs_hypothesis_mapping" ? "high" : "medium",
        recommendedAction: sample.readiness?.nextAction ?? sample.humanGate?.recommendedAction ?? null,
        humanGateAction: hypothesisEvidenceLinkHumanGateAction(sample),
        candidate: candidate ? {
          index: candidateIndex,
          code: sample.stock?.code ?? null,
          name: sample.stock?.name ?? null,
          confidence: candidate.confidence ?? null,
          score: candidate.score ?? null,
        } : null,
        requiresLowConfidenceConfirmation: lowConfidence,
        preferredCommand,
        alternativeCommands: [writeCommand, explicitMappingWrite]
          .filter(Boolean)
          .filter((command) => command !== preferredCommand)
          .filter((command, index, all) => all.indexOf(command) === index),
        blockers: [
          sample.status === "needs_hypothesis_mapping" ? "missing_hypothesis_mapping" : "",
          lowConfidence ? "low_confidence_hypothesis_candidate" : "",
          sourceIntegrity.status === "web_lead_only" ? "hard_source_missing_for_link_review" : "",
          sourceIntegrity.status === "needs_source_refs" ? "source_refs_missing_for_link_review" : "",
        ].filter(Boolean),
        sourceIntegrity,
        sourceRefCount: (sample.evidenceSummary?.sourceRefs ?? []).length,
        officialSourceRefs: (sample.evidenceSummary?.sourceRefs ?? []).filter(isOfficialDisclosureRef).slice(0, 3),
      }
    })
    .sort(compareEvidenceLinkReviewPriority)
}

function agentWriteBoundary(allowedRoots = []) {
  return {
    allowedRoots,
    wroteWiki: false,
    wroteRaw: false,
    wroteBrain: false,
    wroteRealTrade: false,
    peftStoresRawFacts: false,
  }
}

function contextCounts(stockStatus = {}, hypothesisList = {}, hypothesisVerify = {}, stockVerify = {}) {
  const counts = stockStatus.counts ?? {}
  return {
    hypotheses: hypothesisList.count ?? 0,
    hypothesisEvidenceFeedback: hypothesisVerify.checked?.evidenceFeedback ?? 0,
    hypothesisEvidenceTaskDrafts: hypothesisVerify.checked?.evidenceTaskDrafts ?? 0,
    hypothesisEvidenceTaskDraftManifests: hypothesisVerify.checked?.evidenceTaskDraftManifests ?? 0,
    hypothesisEvidenceLinkDraftArtifacts: hypothesisVerify.checked?.evidenceLinkDrafts ?? 0,
    hypothesisEvidenceLinkDraftManifests: hypothesisVerify.checked?.evidenceLinkDraftManifests ?? 0,
    hypothesisEvidenceLinks: hypothesisVerify.checked?.evidenceLinks ?? 0,
    hypothesisEvidenceLinkManifests: hypothesisVerify.checked?.evidenceLinkManifests ?? 0,
    trajectories: counts.trajectories ?? 0,
    executionResults: counts.executionResults ?? 0,
    executionResultsNeedsReconciliation: counts.executionResultsNeedsReconciliation ?? 0,
    executionResultsActionableReviews: counts.executionResultsActionableReviews ?? 0,
    realTradeConfirmedProfitable: counts.realTradeConfirmedProfitable ?? 0,
    evidenceTasksPending: counts.evidenceTasksPending ?? 0,
    evidenceTasksAwaitingReview: counts.evidenceTasksAwaitingReview ?? 0,
    evidenceResultsCompleted: counts.evidenceResultsCompleted ?? 0,
    evidenceResultsAwaitingReview: counts.evidenceResultsAwaitingReview ?? 0,
    evidenceResultsHardSourceReviewReady: stockStatus.evidenceRunner?.reviewAudit?.counts?.hardSourceReviewReady ?? 0,
    evidenceResultsDuplicateWebLeadAfterHardSource: stockStatus.evidenceRunner?.reviewAudit?.counts?.duplicateWebLeadAfterHardSource ?? 0,
    evidenceResultsNeedsManualReviewOrMoreEvidence: stockStatus.evidenceRunner?.reviewAudit?.counts?.needsManualReviewOrMoreEvidence ?? 0,
    paperTradeOpen: counts.paperTradeOpen ?? 0,
    paperTradeClosed: counts.paperTradeClosed ?? 0,
    paperTradePendingSettlement: counts.paperTradePendingSettlement ?? 0,
    paperTradeAgentWrittenCandidates: counts.paperTradeAgentWrittenCandidates ?? 0,
    benchmarkBatches: counts.benchmarkBatches ?? 0,
    loraReadyBatches: counts.loraReadyBatches ?? 0,
    stockFeedbackVerifyErrors: stockVerify.errorCount ?? 0,
    hypothesisVerifyErrors: hypothesisVerify.errorCount ?? 0,
  }
}

function summarizeHypothesisEvidenceTaskDraftReview(draftList = null) {
  const drafts = draftList?.drafts ?? []
  const gateCounts = {
    candidateReviewReady: 0,
    lowConfidenceCandidates: 0,
    needsStockIdentity: 0,
    unknown: 0,
  }
  for (const draft of drafts) {
    const status = draft.stockIdentityCandidateGate?.status
    if (status === "candidate_review_ready") gateCounts.candidateReviewReady += 1
    else if (status === "low_confidence_candidates") gateCounts.lowConfidenceCandidates += 1
    else if (status === "needs_stock_identity") gateCounts.needsStockIdentity += 1
    else gateCounts.unknown += 1
  }
  return {
    schema: "research-os-hypothesis-evidence-task-draft-review-summary-v1",
    status: "ok",
    total: draftList?.count ?? drafts.length,
    gateCounts,
    samples: drafts.slice(0, 8).map((draft) => {
      const gate = draft.stockIdentityCandidateGate ?? {}
      const candidate = (draft.stockIdentityCandidates ?? [])[Math.max(0, Number(gate.recommendedCandidateIndex ?? 1) - 1)] ?? (draft.stockIdentityCandidates ?? [])[0] ?? null
      return {
        id: draft.id,
        hypothesisId: draft.hypothesisId ?? null,
        hypothesisTitle: draft.hypothesisTitle ?? null,
        readiness: draft.readiness ?? null,
        gateStatus: gate.status ?? "unknown",
        recommendedAction: gate.recommendedAction ?? null,
        recommendedCandidateIndex: gate.recommendedCandidateIndex ?? null,
        requiresExtraConfirmation: Boolean(gate.requiresExtraConfirmation),
        reviewPlan: draft.reviewPlan ?? null,
        topCandidate: candidate ? {
          code: candidate.code ?? null,
          name: candidate.name ?? null,
          confidence: candidate.confidence ?? null,
          score: candidate.score ?? null,
          reasons: candidate.reasons ?? [],
        } : null,
      }
    }),
  }
}

async function loadHypothesisEvidenceTaskDraftReview(projectPath, counts = {}) {
  if ((counts.hypothesisEvidenceTaskDrafts ?? 0) <= 0) {
    return summarizeHypothesisEvidenceTaskDraftReview({ count: 0, drafts: [] })
  }
  try {
    const draftList = await listHypothesisEvidenceTaskDrafts({
      projectPath,
      limit: 100,
      candidateLimit: 5,
    })
    return summarizeHypothesisEvidenceTaskDraftReview(draftList)
  } catch (error) {
    return {
      schema: "research-os-hypothesis-evidence-task-draft-review-summary-v1",
      status: "unavailable",
      total: counts.hypothesisEvidenceTaskDrafts ?? 0,
      gateCounts: {
        candidateReviewReady: 0,
        lowConfidenceCandidates: 0,
        needsStockIdentity: 0,
        unknown: counts.hypothesisEvidenceTaskDrafts ?? 0,
      },
      samples: [],
      error: safeErrorMessage(error instanceof Error ? error.message : String(error)),
    }
  }
}

function enrichCountsWithEvidenceTaskDraftReview(counts = {}, draftReview = {}) {
  const gates = draftReview.gateCounts ?? {}
  return {
    ...counts,
    hypothesisEvidenceTaskDraftCandidateReviewReady: gates.candidateReviewReady ?? 0,
    hypothesisEvidenceTaskDraftLowConfidenceCandidates: gates.lowConfidenceCandidates ?? 0,
    hypothesisEvidenceTaskDraftNeedsStockIdentity: gates.needsStockIdentity ?? 0,
    hypothesisEvidenceTaskDraftUnknownGate: gates.unknown ?? 0,
  }
}

function summarizeHypothesisEvidenceLinkDraftReview(draftRun = null) {
  const drafts = draftRun?.drafts ?? []
  const draftItems = drafts.map((draft) => ({
    draft,
    sourceIntegrity: buildSourceIntegrityAudit({
      sourceRefs: draft.evidenceSummary?.sourceRefs ?? [],
      evidenceRefs: draft.evidenceSummary?.evidenceRefs ?? [],
    }),
  }))
  const gateCounts = {
    candidateReviewReady: 0,
    lowConfidenceCandidates: 0,
    needsHypothesisMapping: 0,
    unknown: 0,
  }
  for (const draft of drafts) {
    const status = draft.readiness?.status ?? draft.status
    if (status === "candidate_review_ready") gateCounts.candidateReviewReady += 1
    else if (status === "low_confidence_candidates") gateCounts.lowConfidenceCandidates += 1
    else if (status === "needs_hypothesis_mapping") gateCounts.needsHypothesisMapping += 1
    else gateCounts.unknown += 1
  }
  return {
    schema: "research-os-hypothesis-evidence-link-draft-review-summary-v1",
    status: "ok",
    total: draftRun?.count ?? drafts.length,
    gateCounts,
    sourceIntegrityCounts: summarizeSourceIntegrityAudits(draftItems.map((item) => item.sourceIntegrity)),
    sourceIntegrityProfileCounts: summarizeSourceIntegrityProfiles(draftItems.map((item) => item.sourceIntegrity)),
    samples: draftItems
      .map((item) => ({
        ...item.draft,
        sourceIntegrity: item.sourceIntegrity,
      }))
      .sort(compareEvidenceLinkReviewPriority)
      .slice(0, 8)
      .map((draft) => {
      const selected = draft.selectedCandidate ?? null
      const candidateIndex = selected
        ? Math.max(1, (draft.candidates ?? []).findIndex((candidate) => candidate.hypothesisId === selected.hypothesisId) + 1)
        : null
      return {
        id: draft.id,
        status: draft.readiness?.status ?? draft.status ?? "unknown",
        evidenceResultId: draft.evidenceResultId ?? null,
        taskId: draft.taskId ?? null,
        sourceTrajectoryId: draft.sourceTrajectoryId ?? null,
        stock: draft.stock ?? null,
        evidenceSummary: draft.evidenceSummary ?? null,
        sourceIntegrity: draft.sourceIntegrity ?? buildSourceIntegrityAudit({
          sourceRefs: draft.evidenceSummary?.sourceRefs ?? [],
          evidenceRefs: draft.evidenceSummary?.evidenceRefs ?? [],
        }),
        readiness: draft.readiness ?? null,
        humanGate: draft.humanGate ?? null,
        recommendedCandidateIndex: candidateIndex,
        selectedCandidate: selected ? {
          ...selected,
          index: candidateIndex,
        } : null,
        candidateCount: (draft.candidates ?? []).length,
      }
    }),
  }
}

async function loadHypothesisEvidenceLinkDraftReview(projectPath, generatedAt) {
  try {
    const draftRun = await draftHypothesisEvidenceLinks({
      projectPath,
      status: "watching",
      limit: 100,
      generatedAt,
    })
    return summarizeHypothesisEvidenceLinkDraftReview(draftRun)
  } catch (error) {
    return {
      schema: "research-os-hypothesis-evidence-link-draft-review-summary-v1",
      status: "unavailable",
      total: 0,
      gateCounts: {
        candidateReviewReady: 0,
        lowConfidenceCandidates: 0,
        needsHypothesisMapping: 0,
        unknown: 0,
      },
      sourceIntegrityCounts: {},
      sourceIntegrityProfileCounts: {},
      samples: [],
      error: safeErrorMessage(error instanceof Error ? error.message : String(error)),
    }
  }
}

function enrichCountsWithEvidenceLinkDraftReview(counts = {}, linkReview = {}) {
  const gates = linkReview.gateCounts ?? {}
  return {
    ...counts,
    hypothesisEvidenceLinkDrafts: linkReview.total ?? 0,
    hypothesisEvidenceLinkDraftCandidateReviewReady: gates.candidateReviewReady ?? 0,
    hypothesisEvidenceLinkDraftLowConfidenceCandidates: gates.lowConfidenceCandidates ?? 0,
    hypothesisEvidenceLinkDraftNeedsHypothesisMapping: gates.needsHypothesisMapping ?? 0,
    hypothesisEvidenceLinkDraftUnknownGate: gates.unknown ?? 0,
  }
}

function buildEvidenceResultSecondaryQueue(counts = {}, stockStatus = {}) {
  const reviewAudit = stockStatus.evidenceRunner?.reviewAudit ?? {}
  const reviewCounts = reviewAudit.counts ?? {}
  return {
    schema: "research-os-agent-secondary-queue-v1",
    queueId: "evidence_result_review",
    agentId: "EvidenceAgent",
    stage: "evidence_result_review",
    status: "human_review_required",
    priority: "high",
    reason: "EvidenceResult 待 HumanGate 审核，硬源可审批，重复 web 线索需拒绝或补强。",
    counts: {
      awaitingReview: counts.evidenceResultsAwaitingReview ?? 0,
      hardSourceReviewReady: reviewCounts.hardSourceReviewReady ?? 0,
      duplicateWebLeadAfterHardSource: reviewCounts.duplicateWebLeadAfterHardSource ?? 0,
      needsManualReviewOrMoreEvidence: reviewCounts.needsManualReviewOrMoreEvidence ?? 0,
    },
    readCommands: ["stock-feedback evidence-result list --status awaiting_review --limit 20"],
    writeCommandTemplate: "stock-feedback evidence-result review --result-id <id> --action approve|reject|needs_more_evidence --reviewer <name> --note <note> --write",
    operatorGuidance: [
      "硬源待审结果可人工核对 PDF/公告后 approve；冲突或字段不匹配则 reject。",
      "已有硬源覆盖后的 web 线索默认不升权，优先 reject 或要求补更强 sourceRefs。",
    ],
    reviewSamples: (reviewAudit.items ?? []).slice(0, 5),
    writeBoundary: agentWriteBoundary([".llm-wiki/stock-feedback/evidence-results"]),
  }
}

function buildEvidenceTaskFollowupSecondaryQueue(counts = {}, stockStatus = {}) {
  const recentTasks = stockStatus.evidenceRunner?.recentTasks ?? []
  const actionTable = buildEvidenceTaskFollowupActionTable(recentTasks)
  return {
    schema: "research-os-agent-secondary-queue-v1",
    queueId: "evidence_task_followup",
    agentId: "EvidenceAgent",
    stage: "evidence_task_followup",
    status: "human_review_required",
    priority: (counts.evidenceTasksPending ?? 0) > 0 ? "medium" : "low",
    reason: "EvidenceTask 仍有 pending 或 awaiting_review；pending 先 dry-run 跑队列，awaiting_review 先审对应 EvidenceResult。",
    counts: {
      pending: counts.evidenceTasksPending ?? 0,
      awaitingReview: counts.evidenceTasksAwaitingReview ?? 0,
      completed: counts.evidenceTasksCompleted ?? 0,
    },
    readCommands: [
      "stock-feedback evidence-task list --status pending --limit 20",
      "stock-feedback evidence-task list --status awaiting_review --limit 20",
    ],
    writeCommandTemplate: "stock-feedback run-task-queue --task-id <id> --write",
    operatorGuidance: [
      "pending task 先跑不带 --write 的 run-task-queue 预检，再决定是否写入 evidence-runs/results。",
      "awaiting_review task 不直接升权，先处理 linked EvidenceResult 的 approve/reject/needs_more_evidence。",
    ],
    reviewSamples: recentTasks
      .filter((task) => ["pending", "awaiting_review"].includes(task.status))
      .slice(0, 5),
    reviewActionTable: actionTable.slice(0, 5),
    writeBoundary: agentWriteBoundary([".llm-wiki/stock-feedback/evidence-runs", ".llm-wiki/stock-feedback/evidence-results", ".llm-wiki/stock-feedback/evidence-tasks"]),
  }
}

function buildHypothesisDraftSecondaryQueue(counts = {}, draftReview = {}) {
  const gates = draftReview.gateCounts ?? {}
  const guidance = []
  if ((gates.lowConfidenceCandidates ?? 0) > 0) {
    guidance.push("低置信候选默认不升格；优先显式填写 --stock-code/--stock-name，只有二次人工确认后才使用 --confirm-low-confidence-candidate true。")
  }
  if ((gates.needsStockIdentity ?? 0) > 0) {
    guidance.push("缺股票身份的草案必须先补 stockCode/stockName，不能直接创建正式 EvidenceTask。")
  }
  return {
    schema: "research-os-agent-secondary-queue-v1",
    queueId: "hypothesis_evidence_task_review",
    agentId: "EvidencePlanningAgent",
    stage: "hypothesis_evidence_task_review",
    status: "human_review_required",
    priority: (gates.needsStockIdentity ?? 0) > 0 ? "high" : "medium",
    reason: "Hypothesis evidence-task drafts 需要人工确认股票身份后才能进入正式 EvidenceTask。",
    counts: {
      total: counts.hypothesisEvidenceTaskDrafts ?? 0,
      candidateReviewReady: gates.candidateReviewReady ?? 0,
      lowConfidenceCandidates: gates.lowConfidenceCandidates ?? 0,
      needsStockIdentity: gates.needsStockIdentity ?? 0,
      unknown: gates.unknown ?? 0,
    },
    readCommands: [
      "hypothesis evidence-task-draft-list --gate low_confidence_candidates --candidate-limit 5",
      "hypothesis evidence-task-draft-list --gate needs_stock_identity --candidate-limit 5",
    ],
    writeCommandTemplate: "hypothesis evidence-task-draft-review --draft-id <id> --stock-code <code> --stock-name <name> --confirm-human-gate true --write",
    operatorGuidance: guidance,
    reviewSamples: (draftReview.samples ?? []).slice(0, 5),
    reviewActionTable: buildHypothesisDraftReviewActionTable((draftReview.samples ?? []).slice(0, 5)),
    writeBoundary: agentWriteBoundary([".llm-wiki/stock-feedback/evidence-tasks"]),
  }
}

function buildHypothesisEvidenceLinkSecondaryQueue(counts = {}, linkReview = {}) {
  const gates = linkReview.gateCounts ?? {}
  const sourceCounts = linkReview.sourceIntegrityCounts ?? {}
  const sourceProfileCounts = linkReview.sourceIntegrityProfileCounts ?? {}
  const guidance = [
    "EvidenceResult -> Hypothesis link 只生成推荐，不自动改正式 hypothesis 状态。",
    "低置信候选必须人工确认 hypothesis 映射；不确定时先补 sourceRefs/evidenceRefs 或新建更具体假设。",
  ]
  if ((gates.needsHypothesisMapping ?? 0) > 0) {
    guidance.push("无候选映射的草案必须显式提供 --hypothesis-id，不能默认挂到最相近标题。")
  }
  if ((sourceCounts.web_lead_only ?? 0) > 0 || (sourceCounts.needs_source_refs ?? 0) > 0) {
    guidance.push("web/Tavily 线索不能直接替代公告硬源；优先补 CNINFO、交易所公告或可复核的结构化 sourceRefs。")
  }
  return {
    schema: "research-os-agent-secondary-queue-v1",
    queueId: "hypothesis_evidence_link_review",
    agentId: "HypothesisLinkAgent",
    stage: "hypothesis_evidence_link_review",
    status: "human_review_required",
    priority: (gates.candidateReviewReady ?? 0) > 0 || (gates.needsHypothesisMapping ?? 0) > 0 ? "high" : "medium",
    reason: "Stock-feedback EvidenceResult 可回流 Hypothesis，但 EvidenceResult -> Hypothesis 映射会影响后续 feedback、paper trade 和 LoRA-ready 权重，必须 HumanGate。",
    counts: {
      total: counts.hypothesisEvidenceLinkDrafts ?? 0,
      candidateReviewReady: gates.candidateReviewReady ?? 0,
      lowConfidenceCandidates: gates.lowConfidenceCandidates ?? 0,
      needsHypothesisMapping: gates.needsHypothesisMapping ?? 0,
      unknown: gates.unknown ?? 0,
      approvedLinks: counts.hypothesisEvidenceLinks ?? 0,
      hardSourcePresent: sourceCounts.hard_source_present ?? 0,
      nativeOfficialDisclosure: sourceProfileCounts.native_official_disclosure ?? 0,
      webOfficialPdf: sourceProfileCounts.web_official_pdf ?? 0,
      webOfficialPdfViaWebSearch: sourceProfileCounts.web_official_pdf_via_web_search ?? 0,
      webOfficialPdfAfterZeroResultToolState: sourceProfileCounts.web_official_pdf_after_zero_result_tool_state ?? 0,
      positiveOfficialToolStateOnly: sourceProfileCounts.positive_official_tool_state_only ?? 0,
      webLeadOnly: sourceCounts.web_lead_only ?? 0,
      structuredDataOnly: sourceCounts.structured_data_only ?? 0,
      needsSourceRefs: sourceCounts.needs_source_refs ?? 0,
    },
    readCommands: [
      "hypothesis evidence-link-drafts --status watching --limit 20",
    ],
    writeCommandTemplate: "hypothesis evidence-link-review --draft-id <id> --candidate-index <n> --confirm-human-gate true --write",
    operatorGuidance: guidance,
    reviewSamples: (linkReview.samples ?? []).slice(0, 5),
    reviewActionTable: buildHypothesisEvidenceLinkReviewActionTable((linkReview.samples ?? []).slice(0, 5)),
    writeBoundary: agentWriteBoundary([".llm-wiki/hypothesis-evidence-links"]),
  }
}

function buildExecutionResultReconciliationSecondaryQueue(counts = {}, stockStatus = {}) {
  const audit = stockStatus.executionResultLedger?.reconciliationAudit ?? {}
  const auditCounts = audit.counts ?? {}
  const actionable = (auditCounts.actionableReviews ?? counts.executionResultsActionableReviews ?? 0) > 0
  return {
    schema: "research-os-agent-secondary-queue-v1",
    queueId: "execution_result_reconciliation",
    agentId: "ExecutionResultAgent",
    stage: "real_execution_reconciliation",
    status: audit.status ?? (actionable ? "action_required" : "reviewed_non_actionable"),
    priority: actionable ? "high" : "low",
    reason: actionable
      ? "真实交易 execution-result 存在仍需人工复核的 reconciliation。"
      : "剩余真实交易 reconciliation 已复核为分批/半仓低权重或持仓快照不进 realized PnL。",
    counts: {
      total: counts.executionResultsNeedsReconciliation ?? auditCounts.total ?? 0,
      actionableReviews: counts.executionResultsActionableReviews ?? auditCounts.actionableReviews ?? 0,
      reviewedNonActionable: auditCounts.reviewedNonActionable ?? 0,
      reviewedPartialExit: auditCounts.reviewedPartialExit ?? 0,
      reviewedHoldingSnapshot: auditCounts.reviewedHoldingSnapshot ?? 0,
      trainingWeightLow: auditCounts.trainingWeightLow ?? 0,
      trainingWeightNone: auditCounts.trainingWeightNone ?? 0,
    },
    readCommands: ["stock-feedback execution-result list --status needs_reconciliation --limit 20"],
    writeCommandTemplate: "stock-feedback execution-result review --artifact-id <id> --action confirm_realized_execution|mark_partial_exit|mark_holding_snapshot_only|mark_needs_reconciliation|reject_execution_result --reviewer <name> --note <note> --write",
    operatorGuidance: actionable ? [
      "仅当交割单、复盘和 position-tracking 冲突已解释后，才允许确认真实 realized execution。",
      "半仓/分批未闭合默认保持低权重；持仓快照不得进入 realized PnL 训练。",
    ] : [
      "已复核的 partial_exit 保持低权重，等待完整生命周期闭合再升权。",
      "已复核的 holding_snapshot 只做持仓状态，不作为真实盈利/亏损训练样本。",
    ],
    reviewSamples: (audit.samples ?? audit.items ?? []).slice(0, 5),
    writeBoundary: agentWriteBoundary([".llm-wiki/stock-feedback/execution-results"]),
  }
}

function secondaryQueuePriorityRank(priority = "") {
  const ranks = { high: 0, medium: 1, low: 2 }
  return ranks[String(priority)] ?? 3
}

function secondaryQueueStatusRank(status = "") {
  const ranks = {
    action_required: 0,
    human_review_required: 1,
    reviewed_non_actionable: 2,
    clear: 3,
  }
  return ranks[String(status)] ?? 4
}

function sortSecondaryReviewQueues(queues = []) {
  return queues.slice().sort((left, right) => (
    secondaryQueuePriorityRank(left.priority) - secondaryQueuePriorityRank(right.priority)
    || secondaryQueueStatusRank(left.status) - secondaryQueueStatusRank(right.status)
    || String(left.queueId ?? "").localeCompare(String(right.queueId ?? ""))
  ))
}

function queueIdForReviewStep(item = {}) {
  const fixedAction = item.fixedAction ?? ""
  if (fixedAction === "stock-feedback-evidence-result-review") return "evidence_result_review"
  if (fixedAction === "stock-feedback-execution-result-review") return "execution_result_reconciliation"
  if (fixedAction === "hypothesis-evidence-task-draft-review") return "hypothesis_evidence_task_review"
  if (fixedAction === "hypothesis-evidence-link-review") return "hypothesis_evidence_link_review"
  return item.agentId ? `${String(item.agentId).replace(/Agent$/, "").toLowerCase()}_review` : "primary_review"
}

function reviewRowStatus(row = {}) {
  return row.reviewStatus ?? row.gateStatus ?? row.status ?? null
}

function rowRequiresExplicitConfirmation(row = {}, item = {}) {
  const commands = [row.preferredCommand, ...(row.alternativeCommands ?? [])].filter(Boolean)
  return Boolean(
    item.humanGateStatus === "pending_human_gate"
      || row.requiresLowConfidenceConfirmation
      || commands.some((command) => String(command).includes("--write")),
  )
}

function commandHasWriteFlag(command) {
  return /(?:^|\s)--write(?:\s|$)/.test(String(command ?? ""))
}

function commandHasHumanGateConfirmation(command) {
  return /(?:^|\s)--confirm-human-gate(?:\s|$)/.test(String(command ?? ""))
}

function dryRunCommandForReview(command) {
  if (!command) return null
  return String(command)
    .replace(/\s+--write(?:\s|$)/g, " ")
    .replace(/\s+--confirm-human-gate\s+(?:true|false|1|0|yes|no|approved)\b/g, "")
    .replace(/\s+--confirm-low-confidence-candidate\s+(?:true|false|1|0|yes|no|approved)\b/g, "")
    .replace(/--reviewer\s+<name>/g, "--reviewer manual")
    .replace(/--note\s+<note>/g, '--note "manual dry-run review note"')
    .replace(/\s+/g, " ")
    .trim()
}

function commandPlaceholders(command) {
  return uniqueCommands([...String(command ?? "").matchAll(/<([^<>]+)>/g)].map((match) => match[1]))
}

function shellQuote(value) {
  return `'${String(value ?? "").replace(/'/g, "'\\''")}'`
}

function shellCommandForReview(command, projectPath) {
  if (!command) return null
  return `npm --silent run codex:ingest -- ${command} --project ${shellQuote(projectPath)}`
}

function uniqueCommands(commands = []) {
  return commands
    .filter(Boolean)
    .filter((command, index, all) => all.indexOf(command) === index)
}

function reviewCommandSet(row = {}) {
  const preferredCommand = row.preferredCommand ?? null
  const alternativeCommands = row.alternativeCommands ?? []
  const dryRunCommand = dryRunCommandForReview(preferredCommand)
  const writeCommand = commandHasWriteFlag(preferredCommand) ? preferredCommand : null
  return {
    dryRunCommand,
    writeCommand,
    writeCommandRequiresHumanGate: commandHasHumanGateConfirmation(preferredCommand),
    dryRunCommandPlaceholders: commandPlaceholders(dryRunCommand),
    writeCommandPlaceholders: commandPlaceholders(writeCommand),
    alternativeDryRunCommands: uniqueCommands(alternativeCommands.map(dryRunCommandForReview)),
    alternativeWriteCommands: uniqueCommands(alternativeCommands.filter(commandHasWriteFlag)),
  }
}

function reviewCommandReadiness(commandSet = {}) {
  const dryRunPlaceholders = commandSet.dryRunCommandPlaceholders ?? []
  const writePlaceholders = commandSet.writeCommandPlaceholders ?? []
  const dryRunReady = Boolean(commandSet.dryRunCommand) && dryRunPlaceholders.length === 0
  const writeCommandReady = Boolean(commandSet.writeCommand) && writePlaceholders.length === 0
  let operatorNextStep = "inspect_context"
  if (commandSet.dryRunCommand && dryRunPlaceholders.length > 0) {
    operatorNextStep = "fill_placeholders_before_dry_run"
  } else if (dryRunReady) {
    operatorNextStep = "run_dry_run_command"
  }
  return {
    dryRunReady,
    writeCommandReady,
    dryRunInputsRequired: dryRunPlaceholders,
    writeInputsRequired: writePlaceholders,
    manualInputsRequired: uniqueCommands([...dryRunPlaceholders, ...writePlaceholders]),
    operatorNextStep,
  }
}

function flattenReviewActionRow({ row = {}, item = {}, queue = null, source, index, projectPath }) {
  const queueId = queue?.queueId ?? item.queueId ?? queueIdForReviewStep(item)
  const commandSet = reviewCommandSet(row)
  const readiness = reviewCommandReadiness(commandSet)
  const shellDryRunCommandTemplate = shellCommandForReview(commandSet.dryRunCommand, projectPath)
  const shellWriteCommandTemplate = shellCommandForReview(commandSet.writeCommand, projectPath)
  return {
    actionIndex: index,
    queueId,
    priority: queue?.priority ?? (source === "primary_step" ? "primary" : null),
    agentId: queue?.agentId ?? item.agentId ?? null,
    source,
    stepId: item.stepId ?? null,
    fixedAction: item.fixedAction ?? null,
    targetType: row.targetType ?? queue?.stage ?? item.fixedAction ?? null,
    targetId: row.targetId ?? null,
    taskId: row.taskId ?? null,
    hypothesisId: row.hypothesisId ?? null,
    stockCode: row.stockCode ?? row.candidate?.code ?? null,
    stockName: row.stockName ?? row.candidate?.name ?? null,
    status: reviewRowStatus(row),
    riskLevel: row.riskLevel ?? item.riskLevel ?? null,
    humanGateAction: row.humanGateAction ?? null,
    recommendedAction: row.recommendedAction ?? null,
    preferredCommand: row.preferredCommand ?? null,
    dryRunCommand: commandSet.dryRunCommand,
    writeCommand: commandSet.writeCommand,
    writeCommandRequiresHumanGate: commandSet.writeCommandRequiresHumanGate,
    shellDryRunCommand: readiness.dryRunReady ? shellDryRunCommandTemplate : null,
    shellDryRunCommandTemplate,
    shellWriteCommand: readiness.writeCommandReady ? shellWriteCommandTemplate : null,
    shellWriteCommandTemplate,
    dryRunCommandPlaceholders: commandSet.dryRunCommandPlaceholders,
    writeCommandPlaceholders: commandSet.writeCommandPlaceholders,
    alternativeCommands: row.alternativeCommands ?? [],
    alternativeDryRunCommands: commandSet.alternativeDryRunCommands,
    alternativeWriteCommands: commandSet.alternativeWriteCommands,
    sourceIntegrity: row.sourceIntegrity ?? null,
    sourceRefCount: row.sourceRefCount ?? null,
    officialSourceRefs: row.officialSourceRefs ?? [],
    dryRunReady: readiness.dryRunReady,
    writeCommandReady: readiness.writeCommandReady,
    dryRunInputsRequired: readiness.dryRunInputsRequired,
    writeInputsRequired: readiness.writeInputsRequired,
    manualInputsRequired: readiness.manualInputsRequired,
    operatorNextStep: readiness.operatorNextStep,
    blockers: row.blockers ?? [],
    requiresExplicitConfirmation: rowRequiresExplicitConfirmation(row, item),
  }
}

function buildNextHumanGateActions(items = [], secondaryQueues = [], { projectPath } = {}) {
  const rows = []
  for (const item of items) {
    const actionRows = item.reviewActionTable ?? []
    for (const row of actionRows) {
      rows.push(flattenReviewActionRow({
        row,
        item,
        source: "primary_step",
        index: rows.length + 1,
        projectPath,
      }))
    }
    if (actionRows.length === 0) {
      const fallbackCommandSet = {
        dryRunCommand: dryRunCommandForReview(item.writeCommand),
        writeCommand: commandHasWriteFlag(item.writeCommand) ? item.writeCommand : null,
        writeCommandRequiresHumanGate: commandHasHumanGateConfirmation(item.writeCommand),
        dryRunCommandPlaceholders: commandPlaceholders(dryRunCommandForReview(item.writeCommand)),
        writeCommandPlaceholders: commandPlaceholders(commandHasWriteFlag(item.writeCommand) ? item.writeCommand : null),
        alternativeDryRunCommands: [],
        alternativeWriteCommands: [],
      }
      const fallbackReadiness = reviewCommandReadiness(fallbackCommandSet)
      const shellDryRunCommandTemplate = shellCommandForReview(fallbackCommandSet.dryRunCommand, projectPath)
      const shellWriteCommandTemplate = shellCommandForReview(fallbackCommandSet.writeCommand, projectPath)
      rows.push({
        actionIndex: rows.length + 1,
        queueId: queueIdForReviewStep(item),
        priority: "primary",
        agentId: item.agentId ?? null,
        source: "primary_step",
        stepId: item.stepId ?? null,
        fixedAction: item.fixedAction ?? null,
        targetType: item.fixedAction ?? null,
        targetId: null,
        taskId: null,
        hypothesisId: null,
        stockCode: null,
        stockName: null,
        status: item.humanGateStatus ?? null,
        riskLevel: item.riskLevel ?? null,
        humanGateAction: item.humanGateStatus ?? null,
        recommendedAction: item.intent ?? null,
        preferredCommand: item.writeCommand ?? null,
        dryRunCommand: fallbackCommandSet.dryRunCommand,
        writeCommand: fallbackCommandSet.writeCommand,
        writeCommandRequiresHumanGate: fallbackCommandSet.writeCommandRequiresHumanGate,
        shellDryRunCommand: fallbackReadiness.dryRunReady ? shellDryRunCommandTemplate : null,
        shellDryRunCommandTemplate,
        shellWriteCommand: fallbackReadiness.writeCommandReady ? shellWriteCommandTemplate : null,
        shellWriteCommandTemplate,
        dryRunCommandPlaceholders: fallbackCommandSet.dryRunCommandPlaceholders,
        writeCommandPlaceholders: fallbackCommandSet.writeCommandPlaceholders,
        alternativeCommands: [],
        alternativeDryRunCommands: fallbackCommandSet.alternativeDryRunCommands,
        alternativeWriteCommands: fallbackCommandSet.alternativeWriteCommands,
        dryRunReady: fallbackReadiness.dryRunReady,
        writeCommandReady: fallbackReadiness.writeCommandReady,
        dryRunInputsRequired: fallbackReadiness.dryRunInputsRequired,
        writeInputsRequired: fallbackReadiness.writeInputsRequired,
        manualInputsRequired: fallbackReadiness.manualInputsRequired,
        operatorNextStep: fallbackReadiness.operatorNextStep,
        blockers: [],
        requiresExplicitConfirmation: item.humanGateStatus === "pending_human_gate",
      })
    }
  }
  for (const queue of secondaryQueues) {
    for (const row of (queue.reviewActionTable ?? [])) {
      rows.push(flattenReviewActionRow({
        row,
        item: {},
        queue,
        source: "secondary_queue",
        index: rows.length + 1,
        projectPath,
      }))
    }
  }
  return rows.map((row, index) => ({ ...row, actionIndex: index + 1 }))
}

function splitFilterValues(value) {
  if (Array.isArray(value)) return value.flatMap(splitFilterValues)
  if (value === undefined || value === null || value === "") return []
  return String(value).split(",").map((item) => item.trim()).filter(Boolean)
}

function positiveIntegerOrDefault(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback
  const number = Number.parseInt(String(value), 10)
  return Number.isFinite(number) && number > 0 ? number : fallback
}

function optionalBooleanFilter(value) {
  if (value === undefined || value === null || value === "") return null
  if (value === true || value === false) return value
  const raw = String(value).trim().toLowerCase()
  if (["1", "true", "yes", "y", "on"].includes(raw)) return true
  if (["0", "false", "no", "n", "off"].includes(raw)) return false
  return null
}

function normalizeReviewActionFilters(options = {}) {
  return {
    queueIds: splitFilterValues(options.queueId ?? options.queue),
    sources: splitFilterValues(options.source),
    operatorNextSteps: splitFilterValues(options.operatorNextStep ?? options["operator-next-step"]),
    dryRunReady: optionalBooleanFilter(options.dryRunReady ?? options["dry-run-ready"]),
    writeCommandReady: optionalBooleanFilter(options.writeCommandReady ?? options.writeReady ?? options["write-ready"]),
    limit: positiveIntegerOrDefault(options.actionLimit ?? options.limit, 20),
  }
}

function countByField(rows = [], field) {
  return rows.reduce((acc, row) => {
    const key = String(row[field] ?? "unknown")
    acc[key] = (acc[key] ?? 0) + 1
    return acc
  }, {})
}

function summarizeNextHumanGateActions(rows = []) {
  return {
    total: rows.length,
    dryRunReady: rows.filter((row) => row.dryRunReady).length,
    needsManualInputs: rows.filter((row) => (row.manualInputsRequired ?? []).length > 0).length,
    needsDryRunInputs: rows.filter((row) => (row.dryRunInputsRequired ?? []).length > 0).length,
    needsWriteInputs: rows.filter((row) => (row.writeInputsRequired ?? []).length > 0).length,
    writeCommandReady: rows.filter((row) => row.writeCommandReady).length,
    requiresExplicitConfirmation: rows.filter((row) => row.requiresExplicitConfirmation).length,
    byQueue: countByField(rows, "queueId"),
    byOperatorNextStep: countByField(rows, "operatorNextStep"),
  }
}

function compactRunbookAction(row = {}) {
  return {
    actionIndex: row.actionIndex ?? null,
    queueId: row.queueId ?? null,
    agentId: row.agentId ?? null,
    targetType: row.targetType ?? null,
    targetId: row.targetId ?? null,
    status: row.status ?? null,
    operatorNextStep: row.operatorNextStep ?? null,
    shellDryRunCommand: row.shellDryRunCommand ?? null,
    shellDryRunCommandTemplate: row.shellDryRunCommandTemplate ?? null,
    shellWriteCommand: row.shellWriteCommand ?? null,
    shellWriteCommandTemplate: row.shellWriteCommandTemplate ?? null,
    manualInputsRequired: row.manualInputsRequired ?? [],
    blockers: row.blockers ?? [],
    requiresExplicitConfirmation: Boolean(row.requiresExplicitConfirmation),
  }
}

function buildNextHumanGateActionRunbook({ actions = [], totalCount = 0, filteredCount = 0 } = {}) {
  const dryRunReady = actions.filter((row) => row.dryRunReady)
  const needsInputs = actions.filter((row) => !row.dryRunReady && (row.manualInputsRequired ?? []).length > 0)
  const writeTemplates = actions.filter((row) => row.shellWriteCommandTemplate)
  return {
    schema: "research-os-agent-review-runbook-v1",
    totalCount,
    filteredCount,
    returnedCount: actions.length,
    nextOperatorMove: dryRunReady.length > 0
      ? "run_ready_dry_runs_before_any_write"
      : needsInputs.length > 0
        ? "fill_required_inputs_then_dry_run"
        : "inspect_nested_review_context",
    sequencing: [
      "Run shellDryRunCommand first for ready rows.",
      "For rows with manualInputsRequired, fill those placeholders before dry-run.",
      "Only after dry-run review and explicit HumanGate should shellWriteCommandTemplate be filled and used.",
      "Run stock-feedback verify, hypothesis verify, and research-os agent verify after writes.",
    ],
    readyDryRunCommands: dryRunReady
      .map((row) => row.shellDryRunCommand)
      .filter(Boolean),
    readyDryRunActions: dryRunReady.map(compactRunbookAction),
    needsInputBeforeDryRun: needsInputs.map(compactRunbookAction),
    writeTemplates: writeTemplates.map(compactRunbookAction),
  }
}

function filterNextHumanGateActions(rows = [], filters = {}) {
  const filtered = rows.filter((row) => {
    if (filters.queueIds?.length && !filters.queueIds.includes(row.queueId)) return false
    if (filters.sources?.length && !filters.sources.includes(row.source)) return false
    if (filters.operatorNextSteps?.length && !filters.operatorNextSteps.includes(row.operatorNextStep)) return false
    if (filters.dryRunReady !== null && row.dryRunReady !== filters.dryRunReady) return false
    if (filters.writeCommandReady !== null && row.writeCommandReady !== filters.writeCommandReady) return false
    return true
  })
  return {
    filteredCount: filtered.length,
    summary: summarizeNextHumanGateActions(filtered),
    actions: filtered.slice(0, filters.limit).map((row, index) => ({ ...row, actionIndex: index + 1 })),
  }
}

function buildSecondaryReviewQueues({ counts = {}, stockStatus = {}, draftReview = {}, linkReview = {}, primaryStage = "" } = {}) {
  const queues = []
  if ((counts.executionResultsNeedsReconciliation ?? 0) > 0 && primaryStage !== "real_execution_review") {
    queues.push(buildExecutionResultReconciliationSecondaryQueue(counts, stockStatus))
  }
  if ((counts.evidenceTasksPending ?? 0) > 0 || (counts.evidenceTasksAwaitingReview ?? 0) > 0) {
    queues.push(buildEvidenceTaskFollowupSecondaryQueue(counts, stockStatus))
  }
  if ((counts.evidenceResultsAwaitingReview ?? 0) > 0 && primaryStage !== "evidence_result_review") {
    queues.push(buildEvidenceResultSecondaryQueue(counts, stockStatus))
  }
  if ((counts.hypothesisEvidenceTaskDrafts ?? 0) > 0 && primaryStage !== "hypothesis_evidence_task_review") {
    queues.push(buildHypothesisDraftSecondaryQueue(counts, draftReview))
  }
  if ((counts.hypothesisEvidenceLinkDrafts ?? 0) > 0 && primaryStage !== "hypothesis_evidence_link_review") {
    queues.push(buildHypothesisEvidenceLinkSecondaryQueue(counts, linkReview))
  }
  return sortSecondaryReviewQueues(
    queues.filter((queue) => Object.values(queue.counts ?? {}).some((value) => Number(value) > 0)),
  )
}

function determineNextOrchestration(counts = {}, stockStatus = {}) {
  if ((counts.executionResults ?? 0) <= 0 && (stockStatus.counts?.executionResultImportableDeliveryNotes ?? 0) > 0) {
    return {
      currentStage: "real_execution_import",
      nextAgent: "ExecutionResultAgent",
      nextAction: "validate_real_execution_results",
      blockedBy: "pending_human_gate",
    }
  }
  if ((counts.executionResultsActionableReviews ?? 0) > 0) {
    return {
      currentStage: "real_execution_review",
      nextAgent: "ExecutionResultAgent",
      nextAction: "review_or_reconcile_execution_results",
      blockedBy: "human_review_required",
    }
  }
  if ((counts.evidenceResultsAwaitingReview ?? 0) > 0) {
    return {
      currentStage: "evidence_result_review",
      nextAgent: "EvidenceAgent",
      nextAction: "review_evidence_results_by_review_plan",
      blockedBy: "human_review_required",
    }
  }
  if ((counts.paperTradePendingSettlement ?? 0) > 0 || (counts.paperTradeOpen ?? 0) > 0) {
    return {
      currentStage: "paper_trade_settlement",
      nextAgent: "SettlementAgent",
      nextAction: "settle_open_paper_trades",
      blockedBy: "human_exit_inputs_required",
    }
  }
  if ((counts.hypothesisEvidenceLinkDrafts ?? 0) > 0) {
    let nextAction = "review_hypothesis_evidence_link_drafts_before_feedback"
    if ((counts.hypothesisEvidenceLinkDraftLowConfidenceCandidates ?? 0) > 0) {
      nextAction = "review_low_confidence_hypothesis_evidence_link_drafts_before_feedback"
    } else if ((counts.hypothesisEvidenceLinkDraftNeedsHypothesisMapping ?? 0) > 0) {
      nextAction = "review_hypothesis_evidence_link_drafts_provide_hypothesis_mapping"
    } else if ((counts.hypothesisEvidenceLinkDraftCandidateReviewReady ?? 0) > 0) {
      nextAction = "review_hypothesis_evidence_link_drafts_promote_ready_candidates"
    }
    return {
      currentStage: "hypothesis_evidence_link_review",
      nextAgent: "HypothesisLinkAgent",
      nextAction,
      blockedBy: "human_review_required",
    }
  }
  if ((counts.paperTradeClosed ?? 0) > 0 && (counts.benchmarkBatches ?? 0) <= 0) {
    return {
      currentStage: "attribution_benchmark",
      nextAgent: "AttributionAgent",
      nextAction: "build_trajectories_then_benchmark",
      blockedBy: "pending_human_gate",
    }
  }
  if ((counts.benchmarkBatches ?? 0) > 0 && (counts.loraReadyBatches ?? 0) <= 0) {
    return {
      currentStage: "curriculum_export",
      nextAgent: "CurriculumAgent",
      nextAction: "export_lora_ready",
      blockedBy: "pending_human_gate",
    }
  }
  if ((counts.hypothesisEvidenceFeedback ?? 0) > 0 && (counts.paperTradeAgentWrittenCandidates ?? 0) <= 0) {
    return {
      currentStage: "paper_trade_candidate",
      nextAgent: "PaperTradeAgent",
      nextAction: "build_paper_trade_agent_candidates",
      blockedBy: "pending_human_gate",
    }
  }
  if ((counts.hypotheses ?? 0) > 0 && (counts.hypothesisEvidenceTaskDrafts ?? 0) <= 0) {
    return {
      currentStage: "hypothesis_evidence_task_drafting",
      nextAgent: "HypothesisAgent",
      nextAction: "draft_hypothesis_evidence_tasks",
      blockedBy: "pending_human_gate",
    }
  }
  if ((counts.hypothesisEvidenceTaskDrafts ?? 0) > 0) {
    let nextAction = "review_hypothesis_evidence_task_drafts_attach_stock_identity"
    if ((counts.hypothesisEvidenceTaskDraftLowConfidenceCandidates ?? 0) > 0) {
      nextAction = "review_low_confidence_hypothesis_evidence_task_drafts_before_promotion"
    } else if ((counts.hypothesisEvidenceTaskDraftNeedsStockIdentity ?? 0) > 0) {
      nextAction = "review_hypothesis_evidence_task_drafts_provide_stock_identity"
    } else if ((counts.hypothesisEvidenceTaskDraftCandidateReviewReady ?? 0) > 0) {
      nextAction = "review_hypothesis_evidence_task_drafts_promote_ready_candidates"
    }
    return {
      currentStage: "hypothesis_evidence_task_review",
      nextAgent: "EvidencePlanningAgent",
      nextAction,
      blockedBy: "human_review_required",
    }
  }
  if ((counts.trajectories ?? 0) > 0 && (counts.benchmarkBatches ?? 0) <= 0) {
    return {
      currentStage: "benchmark",
      nextAgent: "BenchmarkAgent",
      nextAction: "build_benchmark",
      blockedBy: "pending_human_gate",
    }
  }
  const sourcePlan = stockStatus.sampleDensityAudit?.sourceInputPlan
  const sourcePlanStatus = sourcePlan?.status ?? "needs_upstream_inputs"
  return {
    currentStage: "hypothesis_feedback",
    nextAgent: "HypothesisAgent",
    nextAction: sourcePlanStatus === "has_upstream_inputs" ? "refresh_hypothesis_feedback_or_build_trajectory" : "collect_hypothesis_evidence_feedback",
    blockedBy: "pending_human_gate",
  }
}

export async function buildResearchOsAgentStatus(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const generatedAt = String(options.generatedAt ?? nowLocalTimestamp())
  const stockFeedback = await getStockFeedbackStatus({ projectPath })
  const stockFeedbackVerify = await verifyStockFeedbackArtifacts({ projectPath })
  const hypothesis = await listHypotheses({ projectPath })
  const hypothesisVerify = await verifyHypothesisEngineArtifacts({ projectPath })
  const baseCounts = contextCounts(stockFeedback, hypothesis, hypothesisVerify, stockFeedbackVerify)
  const evidenceTaskDraftReview = await loadHypothesisEvidenceTaskDraftReview(projectPath, baseCounts)
  const evidenceLinkDraftReview = await loadHypothesisEvidenceLinkDraftReview(projectPath, generatedAt)
  const counts = enrichCountsWithEvidenceLinkDraftReview(
    enrichCountsWithEvidenceTaskDraftReview(baseCounts, evidenceTaskDraftReview),
    evidenceLinkDraftReview,
  )
  const orchestration = determineNextOrchestration(counts, stockFeedback)
  const secondaryQueues = buildSecondaryReviewQueues({
    counts,
    stockStatus: stockFeedback,
    draftReview: evidenceTaskDraftReview,
    linkReview: evidenceLinkDraftReview,
    primaryStage: orchestration.currentStage,
  })
  const context = {
    schema: RESEARCH_OS_AGENT_CONTEXT_SCHEMA,
    mode: "research-os-agent-status",
    generatedAt,
    projectPath,
    agentRuntime: {
      supervisor: "Codex chat window",
      llmInAppRuntime: false,
      orchestration: "codex_orchestrated_fixed_cli_actions",
    },
    counts,
    agentOrchestration: {
      ...orchestration,
      secondaryQueues,
      requiresHumanReview: true,
      writeBoundary: writePolicy(true),
      verifyCommands: [
        "stock-feedback verify",
        "hypothesis verify",
        "research-os agent verify",
      ],
    },
    stockFeedback: {
      schema: stockFeedback.schema,
      mode: stockFeedback.mode,
      sourceMode: stockFeedback.sourceMode,
      counts: stockFeedback.counts,
      sampleDensityAudit: stockFeedback.sampleDensityAudit,
      evidenceRunner: stockFeedback.evidenceRunner ? {
        counts: stockFeedback.evidenceRunner.counts,
        reviewAudit: stockFeedback.evidenceRunner.reviewAudit ?? null,
        recentTasks: stockFeedback.evidenceRunner.recentTasks,
        recentResults: stockFeedback.evidenceRunner.recentResults,
      } : null,
      executionResultLedger: stockFeedback.executionResultLedger ? {
        counts: stockFeedback.executionResultLedger.counts,
        reconciliationAudit: stockFeedback.executionResultLedger.reconciliationAudit ?? null,
        recentExecutionResults: stockFeedback.executionResultLedger.recentExecutionResults,
        sourceFiles: stockFeedback.executionResultLedger.sourceFiles,
      } : null,
      paperTradeLedger: stockFeedback.paperTradeLedger ? {
        counts: stockFeedback.paperTradeLedger.counts,
        settlementQueue: stockFeedback.paperTradeLedger.settlementQueue,
      } : null,
      latest: stockFeedback.latest,
    },
    hypothesis: {
      schema: hypothesis.schema,
      count: hypothesis.count,
      checked: hypothesisVerify.checked,
      evidenceTaskDraftReview,
      evidenceLinkDraftReview,
      recent: (hypothesis.hypotheses ?? []).slice(0, 8).map((item) => ({
        id: item.id,
        title: item.title,
        status: item.status,
        artifactPath: item.relativePath ?? null,
      })),
    },
    secondaryQueues,
    verify: {
      stockFeedback: {
        status: stockFeedbackVerify.status,
        errorCount: stockFeedbackVerify.errorCount,
        issueCount: stockFeedbackVerify.issueCount,
        issues: compactIssues(stockFeedbackVerify.issues),
      },
      hypothesis: {
        status: hypothesisVerify.status,
        errorCount: hypothesisVerify.errorCount,
        issueCount: hypothesisVerify.issueCount,
        issues: compactIssues(hypothesisVerify.issues),
      },
    },
    writePolicy: writePolicy(true),
  }
  if (options.write) {
    const writeResult = await writeResearchOsAgentContext(projectPath, context, generatedAt)
    return { ...context, writeResult, writePolicy: writePolicy(false) }
  }
  return context
}

function makeStep({
  generatedAt,
  order,
  actionKey,
  agentId,
  intent,
  inputRefs = [],
  sourceRefs = [],
  evidenceRefs = [],
  status = "blocked_human_gate",
  humanGateStatus = "pending_human_gate",
  riskLevel = "medium",
  writeCommand,
  expectedArtifacts,
  allowedRoots,
  fixedAction,
  readCommands = [],
  operatorGuidance = [],
  reviewSamples = [],
  reviewActionTable = null,
  counts = null,
  verifyCommands = ["stock-feedback verify", "hypothesis verify", "research-os agent verify"],
}) {
  const fixed = actionKey ? FIXED_ACTIONS[actionKey] : {}
  const actualAgentId = agentId ?? fixed.agentId
  const actualFixedAction = fixedAction ?? fixed.fixedAction ?? actionKey
  const stepId = `step-${order}-${actualAgentId}-${shortHash(`${generatedAt}:${order}:${actualFixedAction}:${intent}`).slice(0, 8)}`
  return {
    schema: "research-os-agent-plan-step-v1",
    stepId,
    order,
    agentId: actualAgentId,
    fixedAction: actualFixedAction,
    actionKey: actionKey ?? null,
    intent,
    status,
    humanGateStatus,
    requiresHumanReview: humanGateStatus !== "not_required",
    riskLevel,
    inputRefs,
    sourceRefs,
    evidenceRefs,
    readCommands,
    counts,
    operatorGuidance,
    reviewSamples,
    reviewActionTable: reviewActionTable ?? buildEvidenceResultReviewActionTable(reviewSamples),
    writeCommand: writeCommand ?? fixed.writeCommand ?? null,
    expectedArtifacts: expectedArtifacts ?? fixed.expectedArtifacts ?? [],
    writeBoundary: agentWriteBoundary(allowedRoots ?? fixed.allowedRoots ?? [RESEARCH_OS_AGENT_ROOT]),
    verifyCommands,
  }
}

function planStepsForContext(context = {}) {
  const generatedAt = context.generatedAt ?? nowLocalTimestamp()
  const counts = context.counts ?? {}
  const nextAgent = context.agentOrchestration?.nextAgent
  const draftReview = context.hypothesis?.evidenceTaskDraftReview ?? {}
  const linkReview = context.hypothesis?.evidenceLinkDraftReview ?? {}
  const settlementItems = context.stockFeedback?.paperTradeLedger?.settlementQueue?.items ?? []
  if (nextAgent === "SettlementAgent") {
    return [makeStep({
      generatedAt,
      order: 1,
      agentId: "SettlementAgent",
      fixedAction: "stock-feedback-paper-trade-settle",
      intent: "settle_open_paper_trades_with_human_exit_inputs",
      status: "blocked_human_input",
      humanGateStatus: "pending_human_gate",
      riskLevel: "high",
      inputRefs: settlementItems.map((item) => `paper-trade:${item.id}`).filter(Boolean),
      sourceRefs: settlementItems.flatMap((item) => item.sourceRefs ?? []).slice(0, 12),
      evidenceRefs: settlementItems.flatMap((item) => item.evidenceRefs ?? []).slice(0, 12),
      writeCommand: "stock-feedback paper-trade settle --paper-trade-id <id> --exit-date <exit_date> --exit-price <exit_price> --write",
      expectedArtifacts: [".llm-wiki/stock-feedback/paper-trades/*.jsonl"],
      allowedRoots: [".llm-wiki/stock-feedback/paper-trades"],
    })]
  }
  if (nextAgent === "ExecutionResultAgent") {
    const executionCounts = context.stockFeedback?.executionResultLedger?.counts ?? {}
    if ((executionCounts.executionResults ?? 0) <= 0) {
      return [makeStep({
        generatedAt,
        order: 1,
        actionKey: "execution_result_validate",
        intent: "import_and_validate_real_execution_results_from_delivery_notes_and_position_tracking",
        inputRefs: (context.stockFeedback?.executionResultLedger?.sourceFiles ?? []).slice(0, 12),
        riskLevel: "medium",
      })]
    }
    return [makeStep({
      generatedAt,
      order: 1,
      agentId: "ExecutionResultAgent",
      fixedAction: "stock-feedback-execution-result-review",
      intent: "review_or_reconcile_real_execution_results_one_by_one",
      status: "blocked_human_input",
      humanGateStatus: "pending_human_gate",
      riskLevel: "medium",
      inputRefs: (context.stockFeedback?.executionResultLedger?.recentExecutionResults ?? [])
        .map((item) => item.artifactId ? `execution-result:${item.artifactId}` : "")
        .filter(Boolean),
      writeCommand: "stock-feedback execution-result review --artifact-id <id> --action confirm_realized_execution|mark_partial_exit|mark_holding_snapshot_only|mark_needs_reconciliation --write",
      expectedArtifacts: [".llm-wiki/stock-feedback/execution-results/*.jsonl"],
      allowedRoots: [".llm-wiki/stock-feedback/execution-results"],
    })]
  }
  if (nextAgent === "EvidenceAgent") {
    const reviewAudit = context.stockFeedback?.evidenceRunner?.reviewAudit ?? {}
    const reviewCounts = reviewAudit.counts ?? {}
    const guidance = []
    if ((reviewCounts.hardSourceReviewReady ?? 0) > 0) {
      guidance.push("硬源待审结果可人工核对 PDF/公告后 approve；冲突或字段不匹配则 reject。")
    }
    if ((reviewCounts.duplicateWebLeadAfterHardSource ?? 0) > 0) {
      guidance.push("已有硬源覆盖后的 web 线索默认不升权，优先 reject 或要求补更强 sourceRefs。")
    }
    return [makeStep({
      generatedAt,
      order: 1,
      agentId: "EvidenceAgent",
      fixedAction: "stock-feedback-evidence-result-review",
      intent: "review_pending_evidence_results_before_promoting_or_rejecting_evidence_weight",
      status: "blocked_human_input",
      humanGateStatus: "pending_human_gate",
      riskLevel: "medium",
      inputRefs: [
        `evidence-results-awaiting-review:${counts.evidenceResultsAwaitingReview ?? 0}`,
        `hard-source-review-ready:${counts.evidenceResultsHardSourceReviewReady ?? 0}`,
        `duplicate-web-after-hard-source:${counts.evidenceResultsDuplicateWebLeadAfterHardSource ?? 0}`,
      ],
      readCommands: ["stock-feedback evidence-result list --status awaiting_review --limit 20"],
      writeCommand: "stock-feedback evidence-result review --result-id <id> --action approve|reject|needs_more_evidence --reviewer <name> --note <note> --write",
      expectedArtifacts: [".llm-wiki/stock-feedback/evidence-results/*.jsonl"],
      allowedRoots: [".llm-wiki/stock-feedback/evidence-results"],
      operatorGuidance: guidance,
      reviewSamples: (reviewAudit.items ?? []).slice(0, 5),
      reviewActionTable: buildEvidenceResultReviewActionTable((reviewAudit.items ?? []).slice(0, 5)),
    })]
  }
  if (nextAgent === "HypothesisLinkAgent") {
    const gates = linkReview.gateCounts ?? {}
    const sourceCounts = linkReview.sourceIntegrityCounts ?? {}
    const sourceProfileCounts = linkReview.sourceIntegrityProfileCounts ?? {}
    const guidance = [
      "EvidenceResult -> Hypothesis link 只生成推荐，不自动改正式 hypothesis 状态。",
      "低置信候选必须人工确认 hypothesis 映射；不确定时先补 sourceRefs/evidenceRefs 或新建更具体假设。",
    ]
    if ((gates.needsHypothesisMapping ?? 0) > 0) {
      guidance.push("无候选映射的草案必须显式提供 --hypothesis-id，不能默认挂到最相近标题。")
    }
    return [makeStep({
      generatedAt,
      order: 1,
      agentId: "HypothesisLinkAgent",
      fixedAction: "hypothesis-evidence-link-review",
      intent: "review_stock_feedback_evidence_result_to_hypothesis_links_before_feedback_refresh",
      status: "blocked_human_input",
      humanGateStatus: "pending_human_gate",
      riskLevel: (gates.candidateReviewReady ?? 0) > 0 || (gates.needsHypothesisMapping ?? 0) > 0 ? "high" : "medium",
      counts: {
        total: counts.hypothesisEvidenceLinkDrafts ?? 0,
        candidateReviewReady: gates.candidateReviewReady ?? 0,
        lowConfidenceCandidates: gates.lowConfidenceCandidates ?? 0,
        needsHypothesisMapping: gates.needsHypothesisMapping ?? 0,
        hardSourcePresent: sourceCounts.hard_source_present ?? 0,
        nativeOfficialDisclosure: sourceProfileCounts.native_official_disclosure ?? 0,
        webOfficialPdf: sourceProfileCounts.web_official_pdf ?? 0,
        webOfficialPdfViaWebSearch: sourceProfileCounts.web_official_pdf_via_web_search ?? 0,
        webOfficialPdfAfterZeroResultToolState: sourceProfileCounts.web_official_pdf_after_zero_result_tool_state ?? 0,
        structuredDataOnly: sourceCounts.structured_data_only ?? 0,
        webLeadOnly: sourceCounts.web_lead_only ?? 0,
        needsSourceRefs: sourceCounts.needs_source_refs ?? 0,
      },
      inputRefs: [
        `hypothesis-evidence-link-drafts:${counts.hypothesisEvidenceLinkDrafts ?? 0}`,
        `candidate-review-ready:${counts.hypothesisEvidenceLinkDraftCandidateReviewReady ?? 0}`,
        `low-confidence-candidates:${counts.hypothesisEvidenceLinkDraftLowConfidenceCandidates ?? 0}`,
        `needs-hypothesis-mapping:${counts.hypothesisEvidenceLinkDraftNeedsHypothesisMapping ?? 0}`,
      ],
      readCommands: ["hypothesis evidence-link-drafts --status watching --limit 20"],
      writeCommand: "hypothesis evidence-link-review --draft-id <id> --candidate-index <n> --confirm-human-gate true --write",
      expectedArtifacts: [".llm-wiki/hypothesis-evidence-links/*.jsonl", ".llm-wiki/hypothesis-evidence-links/*.manifest.json"],
      allowedRoots: [".llm-wiki/hypothesis-evidence-links"],
      operatorGuidance: guidance,
      reviewSamples: (linkReview.samples ?? []).slice(0, 5),
      reviewActionTable: buildHypothesisEvidenceLinkReviewActionTable((linkReview.samples ?? []).slice(0, 5)),
    })]
  }
  if (nextAgent === "AttributionAgent") {
    return [
      makeStep({
        generatedAt,
        order: 1,
        actionKey: "build_trajectories",
        intent: "convert_settled_feedback_into_stock_feedback_trajectories",
        riskLevel: "medium",
      }),
      makeStep({
        generatedAt,
        order: 2,
        actionKey: "build_benchmark",
        intent: "build_eval_preference_negative_cases_from_refreshed_trajectories",
        inputRefs: ["step:build_trajectories"],
        riskLevel: "medium",
      }),
    ]
  }
  if (nextAgent === "BenchmarkAgent") {
    return [makeStep({
      generatedAt,
      order: 1,
      actionKey: "build_benchmark",
      intent: "build_benchmark_cases_from_existing_trajectories",
      riskLevel: "medium",
    })]
  }
  if (nextAgent === "CurriculumAgent") {
    return [makeStep({
      generatedAt,
      order: 1,
      actionKey: "export_lora_ready",
      intent: "export_peft_ready_curriculum_without_raw_facts",
      riskLevel: "medium",
    })]
  }
  if (context.agentOrchestration?.nextAction === "draft_hypothesis_evidence_tasks") {
    return [makeStep({
      generatedAt,
      order: 1,
      actionKey: "hypothesis_evidence_task_drafts_write",
      intent: "draft_hypothesis_evidence_task_handoffs_before_formal_evidence_runner",
      riskLevel: "low",
    })]
  }
  if (nextAgent === "EvidencePlanningAgent") {
    const gateRefs = [
      `hypothesis-evidence-task-drafts:${counts.hypothesisEvidenceTaskDrafts ?? 0}`,
      `candidate-review-ready:${counts.hypothesisEvidenceTaskDraftCandidateReviewReady ?? 0}`,
      `low-confidence-candidates:${counts.hypothesisEvidenceTaskDraftLowConfidenceCandidates ?? 0}`,
      `needs-stock-identity:${counts.hypothesisEvidenceTaskDraftNeedsStockIdentity ?? 0}`,
    ]
    const guidance = []
    if ((counts.hypothesisEvidenceTaskDraftLowConfidenceCandidates ?? 0) > 0) {
      guidance.push("低置信候选默认不升格；优先显式填写 --stock-code/--stock-name，只有二次人工确认后才使用 --confirm-low-confidence-candidate true。")
    }
    if ((counts.hypothesisEvidenceTaskDraftNeedsStockIdentity ?? 0) > 0) {
      guidance.push("缺股票身份的草案必须先补 stockCode/stockName，不能直接创建正式 EvidenceTask。")
    }
    return [makeStep({
      generatedAt,
      order: 1,
      agentId: "EvidencePlanningAgent",
      fixedAction: "hypothesis-evidence-task-draft-review",
      intent: "review_hypothesis_evidence_task_drafts_and_attach_stock_identity_before_creating_formal_tasks",
      status: "blocked_human_input",
      humanGateStatus: "pending_human_gate",
      riskLevel: "medium",
      inputRefs: gateRefs,
      readCommands: [
        "hypothesis evidence-task-draft-list --gate low_confidence_candidates --candidate-limit 5",
        "hypothesis evidence-task-draft-list --gate needs_stock_identity --candidate-limit 5",
      ],
      writeCommand: "hypothesis evidence-task-draft-review --draft-id <id> --stock-code <code> --stock-name <name> --confirm-human-gate true --write",
      expectedArtifacts: [".llm-wiki/stock-feedback/evidence-tasks/*.jsonl"],
      allowedRoots: [".llm-wiki/stock-feedback/evidence-tasks"],
      operatorGuidance: guidance,
      reviewSamples: (draftReview.samples ?? []).slice(0, 5),
      reviewActionTable: buildHypothesisDraftReviewActionTable((draftReview.samples ?? []).slice(0, 5)),
    })]
  }
  if (nextAgent === "PaperTradeAgent") {
    return [makeStep({
      generatedAt,
      order: 1,
      actionKey: "paper_trade_agent_candidates",
      intent: "build_rule_and_llm_discretionary_paper_trade_candidates",
      inputRefs: [`hypothesis-evidence-feedback:${counts.hypothesisEvidenceFeedback ?? 0}`],
      riskLevel: "medium",
    })]
  }
  return [makeStep({
    generatedAt,
    order: 1,
    actionKey: "hypothesis_feedback_write",
    intent: "refresh_hypothesis_evidence_feedback_for_codex_supervisor",
    riskLevel: "medium",
  })]
}

export async function buildResearchOsAgentPlan(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const generatedAt = String(options.generatedAt ?? nowLocalTimestamp())
  const context = options.context ?? await buildResearchOsAgentStatus({ projectPath, generatedAt })
  const steps = planStepsForContext(context)
  const planId = runIdFor(generatedAt, `${projectPath}:${context.agentOrchestration?.nextAgent ?? "SupervisorAgent"}`)
  const plan = {
    schema: RESEARCH_OS_AGENT_PLAN_SCHEMA,
    mode: "research-os-agent-plan",
    planId,
    generatedAt,
    projectPath,
    dryRun: !Boolean(options.write),
    supervisor: {
      agentId: "SupervisorAgent",
      runtime: "Codex chat window",
      llmInAppRuntime: false,
    },
    currentStage: context.agentOrchestration?.currentStage ?? "unknown",
    nextAgent: context.agentOrchestration?.nextAgent ?? "SupervisorAgent",
    nextAction: context.agentOrchestration?.nextAction ?? "inspect_status",
    blockedBy: context.agentOrchestration?.blockedBy ?? null,
    steps,
    secondaryQueues: context.secondaryQueues ?? context.agentOrchestration?.secondaryQueues ?? [],
    humanGate: {
      required: steps.some((step) => step.requiresHumanReview),
      pending: steps.filter((step) => step.humanGateStatus === "pending_human_gate").map((step) => step.stepId),
      policy: "single_step_confirmation_required",
    },
    writeBoundary: {
      allowedRoot: RESEARCH_OS_AGENT_ROOT,
      wroteWiki: false,
      wroteRaw: false,
      wroteBrain: false,
      wroteRealTrade: false,
      peftStoresRawFacts: false,
    },
    verifyCommands: [
      "stock-feedback verify",
      "hypothesis verify",
      "research-os agent verify",
    ],
    contextSummary: {
      counts: context.counts,
      secondaryQueues: context.secondaryQueues ?? context.agentOrchestration?.secondaryQueues ?? [],
      hypothesisEvidenceTaskDraftReview: context.hypothesis?.evidenceTaskDraftReview ?? null,
      hypothesisEvidenceLinkDraftReview: context.hypothesis?.evidenceLinkDraftReview ?? null,
      stockFeedbackVerify: context.verify?.stockFeedback?.status ?? null,
      hypothesisVerify: context.verify?.hypothesis?.status ?? null,
    },
    writeResult: null,
  }
  if (options.write) {
    const writeResult = await writeResearchOsAgentPlan(projectPath, plan, generatedAt)
    return { ...plan, writeResult, dryRun: false }
  }
  return plan
}

async function writeResearchOsAgentContext(projectPath, context, generatedAt) {
  const outputDir = path.join(projectPath, RESEARCH_OS_AGENT_ROOT)
  const filePath = path.join(outputDir, `${timestampSlug(generatedAt)}-context.json`)
  await writeJson(filePath, context)
  return {
    filePath,
    relativePath: projectRelative(projectPath, filePath),
    records: 1,
  }
}

async function writeResearchOsAgentPlan(projectPath, plan, generatedAt) {
  const outputDir = path.join(projectPath, RESEARCH_OS_AGENT_ROOT)
  const planPath = path.join(outputDir, `${timestampSlug(generatedAt)}-plan.json`)
  const manifestPath = path.join(outputDir, `${timestampSlug(generatedAt)}-run-manifest.json`)
  const manifest = {
    schema: RESEARCH_OS_AGENT_RUN_MANIFEST_SCHEMA,
    mode: "research-os-agent-plan-manifest",
    generatedAt,
    projectPath,
    planId: plan.planId,
    planPath: projectRelative(projectPath, planPath),
    stepCount: plan.steps.length,
    secondaryQueueCount: plan.secondaryQueues?.length ?? 0,
    pendingHumanGate: plan.humanGate.pending,
    writeBoundary: plan.writeBoundary,
    verifyCommands: plan.verifyCommands,
  }
  await writeJson(planPath, { ...plan, writeResult: null })
  await writeJson(manifestPath, manifest)
  return {
    plan: { filePath: planPath, relativePath: projectRelative(projectPath, planPath), records: 1 },
    manifest: { filePath: manifestPath, relativePath: projectRelative(projectPath, manifestPath), records: 1 },
  }
}

async function writeResearchOsAgentStepResult(projectPath, result, generatedAt) {
  const outputDir = path.join(projectPath, RESEARCH_OS_AGENT_ROOT)
  const filePath = path.join(outputDir, `${timestampSlug(generatedAt)}-step-results.jsonl`)
  await appendJsonl(filePath, result)
  return {
    filePath,
    relativePath: projectRelative(projectPath, filePath),
    records: 1,
  }
}

async function executeFixedStep(step, { projectPath, write, options }) {
  if (step.actionKey === "hypothesis_feedback_write") {
    return buildHypothesisEvidenceFeedback({
      projectPath,
      status: options.status ?? "watching",
      generatedAt: options.generatedAt,
      write,
    })
  }
  if (step.actionKey === "hypothesis_evidence_task_drafts_write") {
    return draftHypothesisEvidenceTasks({
      projectPath,
      status: options.status ?? "watching",
      limit: options.limit,
      generatedAt: options.generatedAt,
      write,
    })
  }
  if (step.actionKey === "paper_trade_agent_candidates") {
    return buildStockFeedbackPaperTradeAgentCandidates({
      projectPath,
      limit: options.limit,
      generatedAt: options.generatedAt,
      write,
    })
  }
  if (step.actionKey === "execution_result_validate") {
    return validateStockFeedbackExecutionResults({
      projectPath,
      generatedAt: options.generatedAt,
      autoMarketEvidence: options.autoMarketEvidence,
      write,
    })
  }
  if (step.actionKey === "build_trajectories") {
    return buildStockFeedbackTrajectories({ projectPath, write })
  }
  if (step.actionKey === "build_benchmark") {
    return buildStockFeedbackBenchmark({ projectPath, limit: options.limit, generatedAt: options.generatedAt, write })
  }
  if (step.actionKey === "export_lora_ready") {
    return exportStockFeedbackLoraReady({ projectPath, limit: options.limit, write })
  }
  throw new Error(`Step ${step.stepId} is not executable by the fixed action map; it may require human-provided inputs.`)
}

export async function runResearchOsAgentStep(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const generatedAt = String(options.generatedAt ?? nowLocalTimestamp())
  const stepId = String(options.stepId ?? options.id ?? "").trim()
  const plan = options.plan
    ?? await findPersistedPlanByStepId(projectPath, stepId)
    ?? await buildResearchOsAgentPlan({ projectPath, generatedAt })
  const step = stepId
    ? plan.steps.find((item) => item.stepId === stepId)
    : plan.steps[0]
  if (!step) throw new Error(`Unknown research-os agent step id: ${stepId}`)
  const write = Boolean(options.write)
  const humanApproved = parseHumanGateApproval(options.humanApproved
    ?? options.humanGateConfirmed
    ?? options.confirmHumanGate
    ?? options.approved)
  if (write && step.requiresHumanReview && !humanApproved) {
    throw new Error(`HumanGate confirmation required before writing step ${step.stepId}. Pass humanGateConfirmed=true after user approval.`)
  }
  const commandResult = step.actionKey
    ? await executeFixedStep(step, { projectPath, write, options: { ...options, generatedAt } })
    : null
  const result = {
    schema: RESEARCH_OS_AGENT_STEP_RESULT_SCHEMA,
    mode: "research-os-agent-step",
    generatedAt,
    projectPath,
    planId: plan.planId,
    stepId: step.stepId,
    agentId: step.agentId,
    fixedAction: step.fixedAction,
    dryRun: !write,
    status: write ? "completed" : "dry_run_ready",
    humanGateStatus: humanApproved ? "approved" : step.humanGateStatus,
    commandResultSummary: summarizeCommandResult(commandResult),
    commandResult,
    writeBoundary: step.writeBoundary,
    writeResult: null,
  }
  if (write) {
    const writeResult = await writeResearchOsAgentStepResult(projectPath, { ...result, commandResult: summarizeCommandResult(commandResult) }, generatedAt)
    return { ...result, writeResult }
  }
  return result
}

function summarizeCommandResult(result) {
  if (!result || typeof result !== "object") return result ?? null
  return {
    schema: result.schema ?? null,
    mode: result.mode ?? null,
    dryRun: result.dryRun ?? null,
    count: result.count ?? result.summary?.count ?? result.summary?.total ?? null,
    status: result.status ?? null,
    writeResult: result.writeResult ? "present" : null,
  }
}

export async function listResearchOsAgentReviewItems(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const generatedAt = String(options.generatedAt ?? nowLocalTimestamp())
  const plan = await findLatestPersistedPlan(projectPath) ?? await buildResearchOsAgentPlan({ projectPath, generatedAt })
  const secondaryQueues = await resolveReviewSecondaryQueues(projectPath, generatedAt, plan)
  const latestStepResults = await readLatestStepResultsByStepId(projectPath)
  const items = plan.steps
    .filter((step) => step.requiresHumanReview)
    .filter((step) => !isCompletedApprovedStepResult(latestStepResults.get(step.stepId)))
    .map((step) => ({
      stepId: step.stepId,
      agentId: step.agentId,
      fixedAction: step.fixedAction,
      intent: step.intent,
      riskLevel: step.riskLevel,
      humanGateStatus: step.humanGateStatus,
      inputRefs: step.inputRefs ?? [],
      sourceRefs: step.sourceRefs ?? [],
      evidenceRefs: step.evidenceRefs ?? [],
      readCommands: step.readCommands ?? [],
      operatorGuidance: step.operatorGuidance ?? [],
      reviewSamples: step.reviewSamples ?? [],
      reviewActionTable: step.reviewActionTable ?? buildEvidenceResultReviewActionTable(step.reviewSamples ?? []),
      writeCommand: step.writeCommand,
      expectedArtifacts: step.expectedArtifacts ?? [],
      writeBoundary: step.writeBoundary,
    }))
  const allNextHumanGateActions = buildNextHumanGateActions(items, secondaryQueues, { projectPath })
  const nextHumanGateActionFilters = normalizeReviewActionFilters(options)
  const filteredNextHumanGateActions = filterNextHumanGateActions(allNextHumanGateActions, nextHumanGateActionFilters)
  const nextHumanGateActionRunbook = buildNextHumanGateActionRunbook({
    actions: filteredNextHumanGateActions.actions,
    totalCount: allNextHumanGateActions.length,
    filteredCount: filteredNextHumanGateActions.filteredCount,
  })
  return {
    schema: "research-os-agent-review-list-v1",
    mode: "research-os-agent-review",
    generatedAt,
    projectPath,
    count: items.length,
    items,
    secondaryQueueCount: secondaryQueues.length,
    secondaryQueues,
    nextHumanGateActionCount: filteredNextHumanGateActions.actions.length,
    nextHumanGateActionTotalCount: allNextHumanGateActions.length,
    nextHumanGateActionFilteredCount: filteredNextHumanGateActions.filteredCount,
    nextHumanGateActionSummary: summarizeNextHumanGateActions(allNextHumanGateActions),
    nextHumanGateActionFilteredSummary: filteredNextHumanGateActions.summary,
    nextHumanGateActionFilters,
    nextHumanGateActionRunbook,
    nextHumanGateActions: filteredNextHumanGateActions.actions,
    writePolicy: writePolicy(true),
  }
}

async function resolveReviewSecondaryQueues(projectPath, generatedAt, plan = {}) {
  if (Array.isArray(plan.secondaryQueues)) return plan.secondaryQueues
  const context = await buildResearchOsAgentStatus({ projectPath, generatedAt })
  return context.secondaryQueues ?? context.agentOrchestration?.secondaryQueues ?? []
}

async function listFilesRecursive(root) {
  const files = []
  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      const filePath = path.join(dir, entry.name)
      if (entry.isDirectory()) await walk(filePath)
      else files.push(filePath)
    }
  }
  await walk(root)
  return files
}

async function readJsonFile(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"))
}

async function findPersistedPlanByStepId(projectPath, stepId) {
  if (!stepId) return null
  const root = path.join(projectPath, RESEARCH_OS_AGENT_ROOT)
  const files = (await listFilesRecursive(root))
    .filter((filePath) => filePath.endsWith(".json"))
    .sort((left, right) => right.localeCompare(left))
  for (const filePath of files) {
    const record = await readJsonFile(filePath).catch(() => null)
    if (record?.schema !== RESEARCH_OS_AGENT_PLAN_SCHEMA) continue
    if ((record.steps ?? []).some((step) => step.stepId === stepId)) return record
  }
  return null
}

function parseHumanGateApproval(value) {
  if (value === true || value === false) return value
  if (value === undefined || value === null || value === "") return false
  const raw = String(value).trim().toLowerCase()
  return ["1", "true", "yes", "y", "on", "approved"].includes(raw)
}

async function findLatestPersistedPlan(projectPath) {
  const root = path.join(projectPath, RESEARCH_OS_AGENT_ROOT)
  const files = (await listFilesRecursive(root))
    .filter((filePath) => filePath.endsWith("-plan.json"))
    .sort((left, right) => right.localeCompare(left))
  for (const filePath of files) {
    const record = await readJsonFile(filePath).catch(() => null)
    if (record?.schema === RESEARCH_OS_AGENT_PLAN_SCHEMA) return record
  }
  return null
}

async function readLatestStepResultsByStepId(projectPath) {
  const root = path.join(projectPath, RESEARCH_OS_AGENT_ROOT)
  const files = (await listFilesRecursive(root))
    .filter((filePath) => filePath.endsWith("-step-results.jsonl"))
    .sort((left, right) => left.localeCompare(right))
  const latest = new Map()
  for (const filePath of files) {
    const records = await readJsonlFile(filePath).catch(() => [])
    for (const record of records) {
      if (record?.schema !== RESEARCH_OS_AGENT_STEP_RESULT_SCHEMA || !record.stepId) continue
      const previous = latest.get(record.stepId)
      if (!previous || String(record.generatedAt ?? "") >= String(previous.generatedAt ?? "")) {
        latest.set(record.stepId, record)
      }
    }
  }
  return latest
}

function isCompletedApprovedStepResult(result) {
  return result?.status === "completed" && result?.humanGateStatus === "approved"
}

async function readJsonlFile(filePath) {
  const raw = await fs.readFile(filePath, "utf8")
  return raw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
}

function containsSensitiveText(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "")
  return /(github_pat|token=|api[_ -]?token|secret|password|sk-[A-Za-z0-9]{8,})/i.test(text)
}

function validateAgentWriteBoundary(record, artifactPath) {
  const issues = []
  const boundary = record.writeBoundary ?? record.writePolicy ?? {}
  if (boundary.wroteWiki || boundary.wroteRaw || boundary.wroteBrain || boundary.wroteRealTrade || boundary.wroteRealTradeLedger) {
    issues.push({ severity: "error", code: "research_os_agent_write_boundary_violation", id: artifactPath })
  }
  if (boundary.peftStoresRawFacts === true || boundary.storesRawFacts === true) {
    issues.push({ severity: "error", code: "research_os_agent_peft_raw_fact_violation", id: artifactPath })
  }
  if (containsSensitiveText(record)) {
    issues.push({ severity: "error", code: "research_os_agent_sensitive_text_leak", id: artifactPath })
  }
  return issues
}

export async function verifyResearchOsAgentArtifacts(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const root = path.join(projectPath, RESEARCH_OS_AGENT_ROOT)
  const files = await listFilesRecursive(root)
  const issues = []
  const checked = {
    contexts: 0,
    plans: 0,
    stepResults: 0,
    manifests: 0,
  }
  for (const filePath of files.sort()) {
    const relativePath = projectRelative(projectPath, filePath)
    try {
      if (filePath.endsWith(".jsonl")) {
        const records = await readJsonlFile(filePath)
        for (const record of records) {
          if (record.schema === RESEARCH_OS_AGENT_STEP_RESULT_SCHEMA) checked.stepResults += 1
          else issues.push({ severity: "error", code: "research_os_agent_unknown_jsonl_schema", id: relativePath, schema: record.schema ?? null })
          issues.push(...validateAgentWriteBoundary(record, relativePath))
          if (record.dryRun === false && record.humanGateStatus !== "approved") {
            issues.push({ severity: "error", code: "research_os_agent_written_step_without_human_gate", id: relativePath, stepId: record.stepId ?? null })
          }
        }
      } else if (filePath.endsWith(".json")) {
        const record = await readJsonFile(filePath)
        if (record.schema === RESEARCH_OS_AGENT_CONTEXT_SCHEMA) checked.contexts += 1
        else if (record.schema === RESEARCH_OS_AGENT_PLAN_SCHEMA) checked.plans += 1
        else if (record.schema === RESEARCH_OS_AGENT_RUN_MANIFEST_SCHEMA) checked.manifests += 1
        else issues.push({ severity: "error", code: "research_os_agent_unknown_json_schema", id: relativePath, schema: record.schema ?? null })
        issues.push(...validateAgentWriteBoundary(record, relativePath))
        if (record.schema === RESEARCH_OS_AGENT_PLAN_SCHEMA) {
          for (const step of record.steps ?? []) {
            if (!step.agentId || !step.intent || !step.writeBoundary) {
              issues.push({ severity: "error", code: "research_os_agent_plan_step_missing_contract", id: relativePath, stepId: step.stepId ?? null })
            }
            if (step.writeCommand && !Object.values(FIXED_ACTIONS).some((action) => action.writeCommand === step.writeCommand) && !["SettlementAgent", "ExecutionResultAgent", "EvidenceAgent"].includes(step.agentId)) {
              issues.push({ severity: "error", code: "research_os_agent_plan_step_unmapped_write_command", id: relativePath, stepId: step.stepId ?? null })
            }
          }
        }
      }
    } catch (error) {
      issues.push({ severity: "error", code: "research_os_agent_artifact_parse_error", id: relativePath, message: error instanceof Error ? error.message : String(error) })
    }
  }
  const stockFeedbackVerify = await verifyStockFeedbackArtifacts({ projectPath })
  const hypothesisVerify = await verifyHypothesisEngineArtifacts({ projectPath })
  if (stockFeedbackVerify.status === "failed") issues.push({ severity: "error", code: "research_os_agent_downstream_stock_feedback_verify_failed" })
  if (hypothesisVerify.status === "failed") issues.push({ severity: "error", code: "research_os_agent_downstream_hypothesis_verify_failed" })
  const errorCount = issues.filter((item) => item.severity === "error").length
  return {
    schema: RESEARCH_OS_AGENT_VERIFY_SCHEMA,
    mode: "research-os-agent-verify",
    projectPath,
    status: errorCount > 0 ? "failed" : "ok",
    checked,
    downstream: {
      stockFeedback: { status: stockFeedbackVerify.status, errorCount: stockFeedbackVerify.errorCount },
      hypothesis: { status: hypothesisVerify.status, errorCount: hypothesisVerify.errorCount },
    },
    issueCount: issues.length,
    errorCount,
    issues,
  }
}
