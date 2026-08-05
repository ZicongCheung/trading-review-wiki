import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock,
  Database,
  FileText,
  Filter,
  GitCompareArrows,
  ListChecks,
  Loader2,
  Play,
  RefreshCw,
  Save,
  ShieldCheck,
  Target,
  TrendingUp,
  X,
  type LucideIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { runResearchCockpitCommand, type ResearchCockpitAction } from "@/commands/research-cockpit"
import { TrainingFlywheelExtras } from "@/components/training/training-flywheel-extras"
import { useWikiStore } from "@/stores/wiki-store"
import { cn } from "@/lib/utils"

type ValidationTarget = "all" | "expectation_trade" | "fundamental_closure" | "priced_in_risk" | "disconfirmation"
export type AuditBatchRefreshMovementFilter = "all" | "upweighted" | "downweighted" | "rerouted" | "moved_in" | "moved_out"
export type ProfitFeedbackSignalFilter = "all" | "profitable" | "risk_negative" | "pending"
export type ReviewActionFilter = "all" | "route_to_preference" | "needs_evidence" | "approve_for_adapter" | "approve_paper_adapter_candidate"

export interface BenchmarkGapAction {
  id: string
  bucket?: string
  label: string
  detail: string
  primaryActionLabel: string
  tone: "neutral" | "good" | "warn" | "danger"
  target?: ValidationTarget
  profitFeedbackFilter?: ProfitFeedbackSignalFilter
  profitCredit?: string
  patternId?: string
  recommendedAction?: string
}

export interface QualityGateCheckEntry {
  id: string
  label: string
  passed: boolean
  detail: string
}

export interface DynamicTestSetPlanStep {
  id: string
  rank: number
  label: string
  bucket?: string
  bucketLabel: string
  detail: string
  reason: string
  routeLabel: string
  primaryActionLabel: string
  tone: BenchmarkGapAction["tone"]
  target?: ValidationTarget
  profitFeedbackFilter?: ProfitFeedbackSignalFilter
  profitCredit?: string
  patternId?: string
  recommendedAction?: string
  action: BenchmarkGapAction
}

export interface DynamicTestSetPlan {
  headline: string
  detail: string
  totalGaps: number
  counts: Record<string, number>
  steps: DynamicTestSetPlanStep[]
}

export interface ProfitLedgerSeparationSummary {
  headline: string
  detail: string
  nextAction: string
  tone: "good" | "warn"
  realPatternExecutionSamples: number
  profitableOutcomeSamples: number
  confirmedCollectionResults: number
  paperTrades: number
  paperProfitable: number
  paperPatternExecutionSamples: number
  blocksHighConfidenceProfit: boolean
  paperOnly: boolean
}

export interface BenchmarkBatchGateSummary {
  headline: string
  detail: string
  nextAction: string
  tone: "good" | "warn"
  persistedBatches: number
  dynamicCases: number
  coverageGaps: number
  reviewedCases: number
  manifest: string | null
  blocksArtifactClosure: boolean
}

export interface ReviewBacklogGateSummary {
  headline: string
  detail: string
  nextAction: string
  tone: "good" | "warn"
  primaryActionKind: "refresh_lora_ready" | "select_next_review" | "verify"
  pending: number
  reviewed: number
  reviewEvents: number
  routeToPreference: number
  needsEvidence: number
  approveForAdapter: number
  paperAdapterCandidates: number
  pendingTrainableRefreshes: number
  blocksReviewClosure: boolean
  primaryActionLabel: string
}

export interface CollectionTaskReviewOption {
  result: "confirmed" | "insufficient" | "refuted"
  label: string
  tone: "good" | "warn" | "danger"
  routeLabel: string
  detail: string
  nextStep: string
  noteDraft: string
}

export interface CollectionTaskReviewGuide {
  headline: string
  detail: string
  targetLabel: string
  primaryRouteLabel: string
  peftStatus: "clean" | "needs_review"
  peftDetail: string
  resultOptions: CollectionTaskReviewOption[]
}

export interface CollectionTaskDistillationPreflightCheck {
  id: "evidence_refs" | "summary" | "peft_boundary" | "training_route"
  label: string
  status: "passed" | "missing" | "warning" | "blocked"
  detail: string
}

export interface CollectionTaskDistillationPreflight {
  status: "ready" | "needs_evidence" | "needs_boundary" | "blocked"
  tone: "good" | "warn" | "danger"
  headline: string
  detail: string
  nextAction: string
  routeLabel: string
  canRecordConfirmed: boolean
  checks: CollectionTaskDistillationPreflightCheck[]
}

interface StockFeedbackCurriculum {
  strategy?: string
  counts?: {
    totalCases?: number
    reviewedCases?: number
    negativeOrRiskCases?: number
    adapterApprovedCases?: number
    evidenceGapCases?: number
    totalCandidates?: number
    reviewedCandidates?: number
    approvedCandidates?: number
    riskControlCandidates?: number
    reusableSkillCandidates?: number
  }
  buckets?: Record<string, number>
  profitCreditCounts?: Record<string, number>
  requiredProfitCreditBuckets?: Array<{ id?: string; label?: string; trainingUse?: string; recommendedAction?: string; adapterCapability?: string }>
  coverageGaps?: Array<{ bucket?: string; id?: string; label?: string; recommendedAction?: string; trainingUse?: string; adapterCapability?: string; detail?: string }>
}

interface StockFeedbackPatternRadar {
  schema?: string
  strategy?: string
  counts?: {
    totalPatterns?: number
    coveredPatterns?: number
    missingPatterns?: number
    needsReviewPatterns?: number
    adapterReadyPatterns?: number
    riskControlPatterns?: number
  }
  items?: Array<{
    id?: string
    label?: string
    adapterCapability?: string
    distillationHint?: string
    counts?: Record<string, number>
    health?: { status?: string; nextAction?: string }
    collectionTask?: StockFeedbackCollectionTask | null
    evidenceRefs?: string[]
  }>
  gaps?: Array<{ bucket?: string; id?: string; label?: string; recommendedAction?: string }>
  collectionTasks?: StockFeedbackCollectionTask[]
  topNextActions?: Array<{ action?: string; count?: number }>
}

interface StockFeedbackSampleDensityAuditGap {
  id?: string
  label?: string
  severity?: "blocked" | "warn" | "info"
  nextAction?: string
  command?: string
  reason?: string
}

interface StockFeedbackSampleDensityAudit {
  schema?: string
  status?: "blocked" | "thin" | "watch" | "ready"
  tone?: "good" | "warn" | "danger"
  headline?: string
  detail?: string
  counts?: {
    trajectories?: number
    upstreamInputs?: {
      brainRecords?: number
      selfQuestionQuestions?: number
      selfQuestionValidations?: number
      selfQuestionAttributions?: number
      selfQuestionEvidenceResults?: number
      hypothesisEvidenceFeedback?: number
      collectionResults?: number
      paperTrades?: number
      evidenceTasks?: number
      evidenceResults?: number
    }
    hasTrajectorySourceInput?: boolean
    hasPaperAgentSourceInput?: boolean
    expectationTradeTrajectories?: number
    riskTrajectories?: number
    fundamentalTrajectories?: number
    paperTradeAgentPreviewCandidates?: number
    paperTradeAgentWrittenCandidates?: number
    paperTrades?: number
    openPaperTrades?: number
    settledPaperTrades?: number
    profitablePaperTrades?: number
    profitablePaperTrajectories?: number
    reviewedPaperAdapterTrajectories?: number
    loraReadyPaperRefs?: number
    benchmarkBatches?: number
    loraReadyBatches?: number
  }
  nextAction?: string | null
  recommendedCommands?: Array<{ id?: string; label?: string; command?: string; nextAction?: string }>
  sourceInputPlan?: {
    status?: "has_upstream_inputs" | "needs_upstream_inputs"
    hasTrajectorySourceInput?: boolean
    hasPaperAgentSourceInput?: boolean
    trajectorySourceInputs?: string[]
    paperAgentSourceInputs?: string[]
    nextCommands?: string[]
  }
  gaps?: StockFeedbackSampleDensityAuditGap[]
  writeBoundary?: {
    readOnly?: boolean
    wroteWiki?: boolean
    wroteRaw?: boolean
    wroteBrain?: boolean
    wrotePaperTradeLedger?: boolean
    wroteRealTradeLedger?: boolean
  }
  peftBoundary?: {
    storesRawFacts?: boolean
    factsRemainIn?: string[]
    adapterStores?: string[]
  }
}

interface StockFeedbackCollectionTask {
  schema?: string
  taskId?: string
  draftId?: string | null
  bucket?: string
  targetPatternId?: string | null
  targetPatternLabel?: string | null
  targetProfitCredit?: string | null
  targetProfitCreditLabel?: string | null
  validationTarget?: string | null
  adapterCapability?: string | null
  recommendedAction?: string
  priority?: string
  status?: string
  goal?: string
  humanPrompt?: string
  requiredToolState?: string[]
  acceptanceCriteria?: string[]
  sampleMustInclude?: string[]
  suggestedFilters?: {
    marketPattern?: string
    profitCredit?: string
    profitFeedback?: string
    validationTarget?: string
    qualityGate?: string | null
  }
  currentCounts?: Record<string, number>
  peftBoundary?: {
    storesRawFacts?: boolean
    factsRemainIn?: string[]
    adapterStores?: string[]
  }
}

interface StockFeedbackCollectionTaskDraft {
  schema?: string
  id?: string
  taskId?: string
  targetPatternId?: string | null
  targetPatternLabel?: string | null
  targetProfitCredit?: string | null
  targetProfitCreditLabel?: string | null
  validationTarget?: string | null
  adapterCapability?: string | null
  priority?: string
  status?: string
  goal?: string
  humanPrompt?: string
  requiredToolState?: string[]
  acceptanceCriteria?: string[]
  sampleMustInclude?: string[]
  suggestedFilters?: StockFeedbackCollectionTask["suggestedFilters"]
  currentCounts?: Record<string, number>
  intakeTemplate?: {
    evidenceRefs?: string[]
    rawFactBody?: string | null
    marketDataRows?: unknown[] | null
  }
  peftBoundary?: StockFeedbackCollectionTask["peftBoundary"]
}

interface StockFeedbackCollectionResult {
  schema?: string
  id?: string
  generatedAt?: string | null
  sourceDraftId?: string | null
  sourceTaskId?: string | null
  targetPatternId?: string | null
  targetPatternLabel?: string | null
  targetProfitCredit?: string | null
  targetProfitCreditLabel?: string | null
  validationTarget?: string
  adapterCapability?: string
  result?: string
  resultLabel?: string
  evidenceRefs?: string[]
  evidenceRefCount?: number
  intakeSummary?: string
  nextAction?: string
  reviewer?: string | null
  stock?: { name?: string | null; code?: string | null }
  hypothesis?: string
  artifactPath?: string | null
  peftBoundary?: StockFeedbackCollectionTask["peftBoundary"]
}

interface StockFeedbackDistillationPlan {
  schema?: string
  planId?: string
  sourceTrajectoryId?: string
  validationTarget?: string
  qualityGateStatus?: string
  adapterCapability?: string
  requiredToolState?: string[]
  adapterLearns?: Array<{ kind?: string; value?: string }>
  factBoundary?: {
    storesRawFacts?: boolean
    factsRemainIn?: string[]
    adapterDoesNotStore?: string[]
    sourceRefs?: string[]
  }
  humanDecision?: {
    recommendedAction?: string
    recommendedActionLabel?: string
    latestAction?: string | null
    latestResult?: string | null
    why?: string[]
    reviewQuestions?: string[]
  }
  adapterCurriculum?: {
    strategy?: string
    bucket?: string
    score?: number
    benchmarkBucket?: string
    reasons?: string[]
  } | null
}

export interface PeftBoundaryReview {
  status: "clean" | "needs_review" | "blocked"
  tone: "good" | "warn" | "danger"
  headline: string
  detail: string
  learns: Array<{ label: string; value: string }>
  factStores: string[]
  adapterDoesNotStore: string[]
  sourceRefs: string[]
  toolState: string[]
  reviewChecks: string[]
}

export interface PeftBoundaryActionHint {
  tone: "good" | "warn" | "danger"
  headline: string
  detail: string
  recommendedAction: string
  recommendedActionLabel: string
  noteDraft: string
  locksAdapterApproval: boolean
}

interface TrainingWeightDecision {
  state?: string | null
  source?: string | null
  reviewAction?: string | null
  defaultWeightMultiplier?: number | null
  effectiveWeightMultiplier?: number | null
  maxWeightMultiplierBeforeReview?: number | null
  allowWeightUpAfterReview?: boolean
  reason?: string | null
  note?: string | null
}

interface StockFeedbackStatus {
  sourceMode?: string
  counts?: {
    trajectories?: number
    pendingEvidence?: number
    trainable?: number
    pricedInRisk?: number
    failedSamples?: number
    marketPatternTrajectories?: number
    profitFeedbackTrajectories?: number
    pendingReviews?: number
    reviewedTrajectories?: number
    reviewEvents?: number
    collectionResults?: number
    confirmedCollectionResults?: number
    collectionResultsAwaitingTrajectory?: number
    paperTrades?: number
    paperTradeOpen?: number
    paperTradeClosed?: number
    paperTradeProfitable?: number
    paperTradePendingSettlement?: number
    paperTradeSettlementRefreshPending?: number
    paperTradePlanCandidates?: number
    paperTradeAgentCandidates?: number
    paperTradeAgentWrittenCandidates?: number
    llmDiscretionaryReviewReady?: number
    llmDiscretionaryReviewGaps?: number
    sampleDensityGaps?: number
    upstreamFeedbackInputs?: number
    dynamicBenchmarkGaps?: number
    adapterCurriculumGaps?: number
    patternRadarGaps?: number
    adapterCandidates?: number
    reviewedAdapterCandidates?: number
    benchmarkBatches?: number
    loraReadyBatches?: number
    trainingExportBatches?: number
    evidenceTasks?: number
    evidenceTasksPending?: number
    evidenceTasksAwaitingReview?: number
    evidenceTasksCompleted?: number
    evidenceTasksDlq?: number
    evidenceResults?: number
    evidenceResultsAwaitingReview?: number
    evidenceResultsCompleted?: number
    evidenceDlq?: number
  }
  summary?: {
    byValidationTarget?: Record<string, number>
    byQualityGate?: Record<string, number>
    byMarketPattern?: Record<string, number>
    byProfitOutcome?: Record<string, number>
    byProfitCredit?: Record<string, number>
  }
  latest?: {
    trajectoryArtifact?: string | null
    loraReadyManifest?: string | null
    benchmarkManifest?: string | null
  }
  artifactSourceMix?: {
    benchmark?: ArtifactSourceMix | null
    loraReady?: ArtifactSourceMix | null
  }
  dynamicBenchmark?: StockFeedbackCurriculum
  adapterCurriculum?: StockFeedbackCurriculum
  patternRadar?: StockFeedbackPatternRadar
  sampleDensityAudit?: StockFeedbackSampleDensityAudit
  recentCollectionResults?: StockFeedbackCollectionResult[]
  discretionaryReviewAudit?: StockFeedbackDiscretionaryReviewAudit | null
  paperTradeLedger?: StockFeedbackPaperTradeLedger | null
  paperTradePlanning?: StockFeedbackPaperTradePlanning | null
  paperTradeAgent?: StockFeedbackPaperTradeAgentSummary | null
}

interface StockFeedbackPaperTradePlanning {
  schema?: string
  counts?: {
    eligibleTrajectories?: number
    candidates?: number
    skippedExisting?: number
    missingEntryPrice?: number
    readyToRecord?: number
  }
  candidates?: StockFeedbackPaperTradePlanCandidate[]
  nextAction?: string | null
}

interface StockFeedbackPaperTradeAgentSummary {
  schema?: string
  counts?: {
    total?: number
    ruleBaseline?: number
    llmDiscretionary?: number
    needsMarketPrice?: number
    blocked?: number
    fromTrajectory?: number
    fromHypothesisFeedback?: number
  }
  candidates?: StockFeedbackPaperTradeAgentCandidate[]
  nextAction?: string | null
}

export interface StockFeedbackPaperTradePlanCandidate {
  id?: string | null
  track?: string | null
  sourceTrajectoryId?: string | null
  sourceQuestionId?: string | null
  validationTarget?: string | null
  qualityGate?: string | null
  stock?: {
    name?: string | null
    code?: string | null
  } | null
  asOfDate?: string | null
  hypothesis?: string | null
  expectedMove?: string | null
  entry?: {
    date?: string | null
    price?: number | null
    priceSource?: string | null
    timing?: string | null
  } | null
  positionSizing?: string | null
  sourceRefs?: string[]
  evidenceRefs?: string[]
  readiness?: {
    status?: string | null
    missingRequiredFields?: string[]
    nextAction?: string | null
  } | null
}

interface StockFeedbackPaperTradeAgentCandidate extends StockFeedbackPaperTradePlanCandidate {
  sourceKind?: string | null
  hypothesisId?: string | null
  expectedCatalyst?: string | null
  entryPlan?: {
    date?: string | null
    price?: number | null
    priceSource?: string | null
    timing?: string | null
    reason?: string | null
    requiredMarketFields?: string[]
  } | null
  exitPlan?: {
    track?: string | null
    rule?: string | null
    targetHoldingDays?: number | null
    reviewCadence?: string | null
    stopCondition?: string | null
  } | null
  invalidationCondition?: string | null
  evidenceCutoff?: {
    asOfDate?: string | null
    noFutureData?: boolean
    enforcement?: string | null
  } | null
}

interface StockFeedbackDiscretionaryReviewAudit {
  schema?: string
  status?: "empty" | "blocked" | "ready" | string
  counts?: {
    llmAgentCandidates?: number
    ruleAgentCandidates?: number
    llmPaperTrades?: number
    ruleBaselinePaperTrades?: number
    openLlmPaperTrades?: number
    closedLlmPaperTrades?: number
    pairedRuleBaselineTrades?: number
    missingEvidenceRefs?: number
    readyPairs?: number
  }
  nextAction?: string | null
  items?: Array<{
    paperTradeId?: string | null
    pairKey?: string | null
    stock?: { name?: string | null; code?: string | null } | null
    asOfDate?: string | null
    status?: string | null
    pairedRuleBaselineTradeId?: string | null
    pairedRuleBaselineStatus?: string | null
    sourceRefCount?: number
    evidenceRefCount?: number
    evidenceCutoffOk?: boolean
    readyForReview?: boolean
    nextAction?: string | null
  }>
  peftBoundary?: {
    modelTrainingStarted?: boolean
    storesRawFacts?: boolean
    factsRemainIn?: string[]
    adapterStores?: string[]
  }
  writeBoundary?: {
    readOnly?: boolean
    wroteWiki?: boolean
    wroteRaw?: boolean
    wroteBrain?: boolean
    wrotePaperTradeLedger?: boolean
    wroteRealTradeLedger?: boolean
  }
}

interface StockFeedbackPaperTradeLedger {
  schema?: string
  counts?: StockFeedbackPaperTradeCounts
  summary?: StockFeedbackPaperTradeCounts
  recentPaperTrades?: StockFeedbackPaperTradeSummary[]
  settlementQueue?: StockFeedbackPaperTradeSettlementQueue
  settlementRefreshAudit?: StockFeedbackPaperTradeSettlementRefreshAudit
}

interface StockFeedbackPaperTradeSettlementQueue {
  schema?: string
  count?: number
  items?: StockFeedbackPaperTradeSummary[]
  nextAction?: string | null
  writeBoundary?: {
    readOnly?: boolean
    wrotePaperTradeLedger?: boolean
    wroteRealTradeLedger?: boolean
  }
}

interface StockFeedbackPaperTradeSettlementRefreshAudit {
  schema?: string
  count?: number
  pending?: number
  completed?: number
  latestBenchmarkManifest?: string | null
  latestLoraReadyManifest?: string | null
  nextAction?: string | null
  items?: StockFeedbackPaperTradeSettlementRefreshAuditItem[]
}

interface StockFeedbackPaperTradeSettlementRefreshAuditItem {
  schema?: string
  paperTradeId?: string | null
  trajectoryId?: string | null
  generatedAt?: string | null
  settledAt?: string | null
  stock?: { name?: string | null; code?: string | null } | null
  track?: string | null
  validationTarget?: string | null
  profitOutcome?: string | null
  realizedPnlPct?: number | null
  executionEvidenceClass?: string | null
  trajectoryStatus?: string | null
  benchmarkStatus?: string | null
  reviewStatus?: string | null
  loraReadyStatus?: string | null
  latestReviewAction?: string | null
  nextAction?: string | null
  refreshComplete?: boolean
}

interface StockFeedbackPaperTradeCounts {
  total?: number
  open?: number
  closed?: number
  cancelled?: number
  profitable?: number
  loss?: number
  flat?: number
  byTrack?: Record<string, number>
  byStatus?: Record<string, number>
  byOutcome?: Record<string, number>
  byValidationTarget?: Record<string, number>
}

interface StockFeedbackMarketEvidence {
  schema?: string | null
  priceSqlRef?: string | null
  marketDataRef?: string | null
  benchmarkRef?: string | null
  benchmarkCode?: string | null
  source?: string | null
  startDate?: string | null
  endDate?: string | null
  rows?: number | null
  closeStart?: number | null
  closeEnd?: number | null
  periodReturnPct?: number | null
  relativeStrength?: number | null
  benchmarkReturnPct?: number | null
  relativeStrengthBasis?: string | null
  turnoverChange?: number | null
  followThrough1d?: number | null
  followThrough3d?: number | null
  followThrough5d?: number | null
  maxDrawdownInHolding?: number | null
}

interface StockFeedbackMarketEvidenceWindow {
  schema?: string | null
  provider?: string | null
  expectedStartDate?: string | null
  expectedEndDate?: string | null
  expectedWindow?: string | null
  actualStartDate?: string | null
  actualEndDate?: string | null
  actualWindow?: string | null
  lookaheadDays?: number | null
  exceededExpectedEnd?: boolean | null
  status?: string | null
}

interface StockFeedbackMicrostructureEvidence {
  schema?: string | null
  source?: string | null
  stockCode?: string | null
  tradeDate?: string | null
  limitListRef?: string | null
  limitStepRef?: string | null
  topListRef?: string | null
  topInstRef?: string | null
  hotMoneyRef?: string | null
  thsHotRef?: string | null
  dcHotRef?: string | null
  limit?: {
    firstTime?: string | null
    lastTime?: string | null
    openTimes?: number | null
    upStat?: string | null
    limitTimes?: number | null
    pctChg?: number | null
  } | null
  limitStep?: {
    consecutiveBoards?: number | null
  } | null
  dragonTiger?: {
    reason?: string | null
    netAmount?: number | null
    turnoverRate?: number | null
  } | null
  institution?: {
    rowCount?: number | null
    netAmount?: number | null
  } | null
  hotMoney?: {
    rowCount?: number | null
    names?: string[]
    netAmount?: number | null
  } | null
  heat?: {
    thsRank?: number | null
    thsPctChange?: number | null
    thsCurrentPrice?: number | null
    thsConcept?: string | null
    dcRank?: number | null
    dcPctChange?: number | null
    dcCurrentPrice?: number | null
  } | null
  signals?: string[]
}

export interface PaperTradeAutoEvidenceGateCheck {
  id?: string | null
  provider?: string | null
  status?: string | null
  warning?: string | null
  passed?: boolean | null
}

export interface PaperTradeAutoEvidenceGate {
  status?: string | null
  blocksWrite?: boolean | null
  checks?: PaperTradeAutoEvidenceGateCheck[] | null
  detail?: string | null
}

export interface PaperTradeAutoEvidenceGateEntry {
  id: string
  label: string
  providerLabel: string
  status: string
  statusLabel: string
  passed: boolean
  detail: string
  tone: "neutral" | "good" | "warn" | "danger"
}

export interface PaperTradeAutoEvidenceGateSummary {
  tone: "neutral" | "good" | "warn" | "danger"
  headline: string
  detail: string
  badge: string
  blocksWrite: boolean
  entries: PaperTradeAutoEvidenceGateEntry[]
}

interface StockFeedbackPaperTradeSummary {
  id?: string | null
  generatedAt?: string | null
  firstRecordedAt?: string | null
  ledgerEventCount?: number | null
  asOfDate?: string | null
  evidenceCutoff?: {
    asOfDate?: string | null
    noFutureData?: boolean | null
    note?: string | null
  } | null
  ledgerKind?: string | null
  track?: string | null
  status?: string | null
  sourceQuestionId?: string | null
  sourceTrajectoryId?: string | null
  validationTarget?: string | null
  stock?: { name?: string | null; code?: string | null }
  entry?: { date?: string | null; price?: number | null; timing?: string | null } | null
  exit?: { date?: string | null; price?: number | null; timing?: string | null; reason?: string | null } | null
  positionSizing?: string | null
  profitFeedback?: StockFeedbackTrajectory["profitFeedback"] | null
  marketEvidence?: StockFeedbackMarketEvidence | null
  marketEvidenceWindow?: StockFeedbackMarketEvidenceWindow | null
  marketEvidenceProvider?: string | null
  marketEvidenceStatus?: string | null
  marketEvidenceWarning?: string | null
  marketMicrostructureEvidence?: StockFeedbackMicrostructureEvidence | null
  microstructureEvidenceStatus?: string | null
  microstructureEvidenceWarning?: string | null
  autoEvidenceGate?: PaperTradeAutoEvidenceGate | null
  settlement?: {
    action?: string | null
    previousStatus?: string | null
    closedAt?: string | null
    exitDate?: string | null
    exitPrice?: number | null
    realizedPnlPct?: number | null
    outcome?: string | null
  } | null
  artifactRefreshPlan?: PaperTradeArtifactRefreshPlan | null
  suggestedSettlementCommand?: string | null
  requiredEvidence?: string[]
  sourceRefs?: string[]
  evidenceRefs?: string[]
  artifactPath?: string | null
}

interface ArtifactSourceMix {
  schema?: string | null
  artifactPath?: string | null
  generatedAt?: string | null
  count?: number
  sourceKindCounts?: Record<string, number>
  adapterBatchRecipe?: AdapterBatchRecipeSummary | null
  sourceConcentration?: {
    dominantSourceKind?: string | null
    dominantSourceKindLabel?: string | null
    dominantCount?: number
    total?: number
    dominantSharePct?: number
    singleSourceBatch?: boolean
    needsHumanReview?: boolean
    reviewHint?: string
    trainingWeightSuggestion?: TrainingWeightDecision & { action?: string }
  } | null
  refs?: ArtifactAuditRef[]
  batchRefreshDelta?: AuditBatchRefreshSummary | null
  peftBoundary?: {
    modelTrainingStarted?: boolean | null
    storesRawFacts?: boolean | null
    factsRemainIn?: string[]
    adapterStores?: string[]
  } | null
}

interface AdapterBatchRecipeSummary {
  schema?: string | null
  strategy?: string | null
  modelTrainingStarted?: boolean | null
  storesRawFacts?: boolean | null
  totalCandidates?: number
  weightedCandidateCount?: number
  totalEffectiveWeight?: number | null
  buckets?: AdapterBatchRecipeBucket[]
  peftBoundary?: {
    modelTrainingStarted?: boolean | null
    storesRawFacts?: boolean | null
    factsRemainIn?: string[]
    adapterStores?: string[]
  } | null
}

interface AdapterBatchRecipeBucket {
  id?: string | null
  label?: string | null
  count?: number
  effectiveWeightMultiplier?: number | null
  totalEffectiveWeight?: number | null
  recommendedSampling?: string | null
  selectionUse?: string[]
  reviewGate?: string | null
  candidateRefCount?: number
  candidateRefs?: ArtifactAuditRef[]
}

interface ArtifactAuditRef {
  refKind?: "benchmark_case" | "adapter_candidate" | string
  id?: string | null
  sourceTrajectoryId?: string | null
  validationTarget?: string | null
  qualityGateStatus?: string | null
  sourceKind?: string | null
  sourceKindLabel?: string | null
  collectionResultId?: string | null
  paperTradeId?: string | null
  collectionResult?: string | null
  targetPatternId?: string | null
  dynamicBucket?: string | null
  curriculumBucket?: string | null
  adapterCapability?: string | null
  profitOutcome?: string | null
  reviewed?: boolean
  adapterPriorityScore?: number | null
  trainingWeightState?: string | null
  effectiveWeightMultiplier?: number | null
  trainingWeightSource?: string | null
  bucketId?: string | null
  bucketLabel?: string | null
  sampling?: string | null
  recommendedSampling?: string | null
  marketPatternIds?: string[]
}

export interface AuditSelectionContext {
  sourceTitle?: string
  sourceTrajectoryId?: string | null
  refKind?: string | null
  refId?: string | null
  bucketId?: string | null
  bucketLabel?: string | null
  sampling?: string | null
  effectiveWeightMultiplier?: number | null
  trainingWeightState?: string | null
  sourceKindLabel?: string | null
  collectionResultId?: string | null
  paperTradeId?: string | null
  adapterCapability?: string | null
}

export interface AuditReviewPrompt {
  headline: string
  detail: string
  actionHint: string
  noteDraft: string
  tone: "neutral" | "good" | "warn" | "danger"
}

export interface AuditSubmissionEvent {
  action?: string | null
  actionLabel?: string | null
  result?: string | null
  reviewer?: string | null
  generatedAt?: string | null
}

export interface AuditSubmissionNotice {
  key: string
  headline: string
  detail: string
  action?: string | null
  actionLabel: string
  resultLabel: string
  nextStep: string
  refreshLabel?: string | null
  tone: "neutral" | "good" | "warn" | "danger"
}

export interface ReviewRefreshPrompt {
  headline: string
  detail: string
  action?: string | null
  actionLabel: string
  resultLabel: string
  nextStep: string
  refreshLabel?: string | null
  tone: "neutral" | "good" | "warn" | "danger"
}

export interface CollectionResultFollowUp {
  headline: string
  detail: string
  resultLabel: string
  nextStep: string
  primaryAction: "rebuild_trajectories" | "continue_collection" | "build_benchmark"
  primaryActionLabel: string
  refreshLoraReadyLabel?: string | null
  keepCollectionOpen: boolean
  tone: "neutral" | "good" | "warn" | "danger"
}

export interface CollectionResultReviewRoutePreview {
  headline: string
  detail: string
  recommendedAction: string
  recommendedActionLabel: string
  routeLabels: string[]
  peftBoundaryLabel: string
  reviewChecklist: string[]
  tone: "good" | "warn" | "danger"
}

export interface CollectionResultActionRoadmapStep {
  id: "record_result" | "resolve_evidence" | "rebuild_trajectory" | "human_review" | "refresh_artifacts"
  label: string
  status: "done" | "active" | "pending" | "blocked"
  detail: string
  action?: {
    label: string
    auditContext: AuditSelectionContext
  }
}

export interface CollectionResultActionRoadmap {
  headline: string
  detail: string
  activeStepId: CollectionResultActionRoadmapStep["id"]
  tone: "good" | "warn" | "danger"
  steps: CollectionResultActionRoadmapStep[]
}

export interface CollectionResultHumanReviewBridge {
  headline: string
  detail: string
  actionLabel: string
  recommendedAction: string
  recommendedActionLabel: string
  routeLabels: string[]
  peftBoundaryLabel: string
  tone: "good" | "warn" | "danger"
  step: CollectionResultActionRoadmapStep | null
}

export type CollectionResultNextActionKind =
  | "rebuild_trajectories"
  | "select_human_review"
  | "refresh_lora_ready"
  | "continue_collection"
  | "build_benchmark"
  | "none"

export interface CollectionResultNextAction {
  headline: string
  detail: string
  actionLabel: string
  actionKind: CollectionResultNextActionKind
  tone: CollectionResultFollowUp["tone"]
  step: CollectionResultActionRoadmapStep | null
}

export interface CollectionResultActionRoadmapContext {
  trajectories?: StockFeedbackTrajectory[]
  benchmark?: ArtifactSourceMix | null
  loraReady?: ArtifactSourceMix | null
}

interface CollectionResultFocusNotice {
  headline: string
  detail: string
  trajectoryId?: string | null
  collectionResultId?: string | null
  tone: "neutral" | "good" | "warn" | "danger"
}

export interface ReviewRefreshResult {
  headline: string
  detail: string
  movementLabel: string
  beforeLabel: string
  afterLabel: string
  tone: "neutral" | "good" | "warn" | "danger"
}

export interface ReviewRefreshCompletionSummary {
  headline: string
  detail: string
  movementLabel: string
  beforeLabel: string
  afterLabel: string
  actionLabel: string
  tone: ReviewRefreshResult["tone"]
  chips: string[]
}

export interface PaperTradeReviewClosureSummary {
  headline: string
  detail: string
  movementLabel: string
  beforeLabel: string
  afterLabel: string
  actionLabel: string
  tone: ReviewRefreshResult["tone"]
  chips: string[]
}

export interface NextHumanReviewSuggestion {
  trajectoryId: string
  label: string
  detail: string
  actionLabel: string
  tone: "neutral" | "good" | "warn" | "danger"
  source: "pending_review" | "risk_feedback" | "evidence_gap"
}

export interface ReviewCycleGate {
  locked: boolean
  source: "audit_submission" | "trajectory_review" | "latest_review"
  headline: string
  detail: string
  action?: string | null
  actionLabel: string
  nextSteps: string[]
  refreshLabel?: string | null
  tone: "neutral" | "good" | "warn" | "danger"
}

export interface ReviewCycleGateCollectionBridge {
  headline: string
  detail: string
  actionLabel: string
  task: StockFeedbackCollectionTask
}

export type ReviewCycleNextActionKind =
  | "refresh_lora_ready"
  | "create_collection_task"
  | "wait_evidence"
  | "none"

export interface ReviewCycleNextAction {
  headline: string
  detail: string
  actionLabel: string
  actionKind: ReviewCycleNextActionKind
  tone: ReviewCycleGate["tone"]
}

export interface AuditRefreshDiff {
  key: string
  headline: string
  beforeLabel: string
  afterLabel: string
  detail: string
  tone: "neutral" | "good" | "warn" | "danger"
}

export interface ReviewActionStatusHint {
  headline: string
  detail: string
  tone: "neutral" | "good" | "warn" | "danger"
  chips: string[]
}

export interface AuditBatchRefreshMovementState {
  bucketId?: string | null
  bucketLabel?: string | null
  trainingWeightState?: string | null
  effectiveWeightMultiplier?: number | null
  recommendedSampling?: string | null
}

export interface AuditBatchRefreshMovement {
  key?: string | null
  id?: string | null
  sourceTrajectoryId?: string | null
  validationTarget?: string | null
  adapterCapability?: string | null
  movement?: string | null
  before?: AuditBatchRefreshMovementState | null
  after?: AuditBatchRefreshMovementState | null
}

export interface BatchRefreshReviewAction {
  filter: Exclude<AuditBatchRefreshMovementFilter, "all">
  count: number
  priority: "high" | "medium" | "low"
  headline: string
  detail: string
  recommendedAction: string
  actionLabel: string
}

export interface ProfitFeedbackDistillationHint {
  headline: string
  detail: string
  tone: "neutral" | "good" | "warn" | "danger"
  trainingUse: "adapter_candidate_after_review" | "eval_preference_negative" | "monitor_until_settled"
}

export interface ProfitFeedbackListSignal {
  label: string
  detail: string
  tone: "neutral" | "good" | "warn" | "danger"
  trainingUse: ProfitFeedbackDistillationHint["trainingUse"]
}

export interface ProfitFeedbackReadinessCheck {
  id: "settled_pnl" | "drawdown" | "holding_period" | "credit_assignment" | "tool_state_refs" | "peft_boundary"
  label: string
  status: "passed" | "missing" | "warning" | "blocked"
  detail: string
}

export interface ProfitFeedbackDistillationReadiness {
  headline: string
  detail: string
  status: "ready" | "monitor_until_settled" | "needs_profit_evidence" | "needs_credit_assignment" | "needs_boundary"
  tone: "neutral" | "good" | "warn" | "danger"
  routeLabel: string
  canPromoteAdapter: boolean
  missing: string[]
  checks: ProfitFeedbackReadinessCheck[]
  nextAction: string
}

export type ProfitFeedbackReviewWorklistId = "profitable" | "entry_risk" | "loss_negative" | "pending"

export interface ProfitFeedbackReviewWorklistItem {
  id: ProfitFeedbackReviewWorklistId
  label: string
  detail: string
  count: number
  pendingCount: number
  reviewedCount: number
  filter: ProfitFeedbackSignalFilter
  firstTrajectoryId: string | null
  recommendedAction: string
  actionLabel: string
  tone: "neutral" | "good" | "warn" | "danger"
}

export interface AuditBatchRefreshSummary {
  headline: string
  detail: string
  totalBefore: number
  totalAfter: number
  upweighted: number
  downweighted: number
  unchanged: number
  rerouted?: number
  movedOut: number
  movedIn: number
  evidenceGap: number
  rejected: number
  preferenceOrRisk: number
  adapterApproved: number
  movements?: AuditBatchRefreshMovement[]
  movementIndex?: Record<string, AuditBatchRefreshMovement>
  source: "lora-ready-refresh"
}

interface StockFeedbackTrajectory {
  id: string
  source?: string
  sourceKind?: string
  sourceRecordId?: string | null
  validationTarget: string
  validationTargetLabel?: string
  adapterCapability?: string
  trainingUse?: string[]
  hypothesis?: string
  question?: string
  summary?: string
  stock?: { name?: string; code?: string; label?: string }
  qualityGate?: {
    status?: string
    highConfidenceEligible?: boolean
    requiredAction?: string | null
    reasons?: string[]
    checkResults?: Record<string, boolean>
  }
  eventTimeline?: Array<{ step?: string; at?: string; ref?: string }>
  marketValidation?: Record<string, unknown>
  marketPatterns?: Array<{ id?: string; label?: string; distillationHint?: string }>
  profitFeedback?: {
    outcome?: string
    executionMode?: string
    ledgerKind?: string
    executionEvidenceClass?: string
    realizedPnlPct?: number
    maxDrawdownPct?: number
    holdingDays?: number
    entryTiming?: string
    exitTiming?: string
    positionSizing?: string
    creditAssignment?: {
      primaryCredit?: string
      trainingUse?: string
      adapterLearns?: string[]
      failureModes?: string[]
      summary?: string
      storesRawFacts?: boolean
    }
  }
  distillationSignals?: {
    distillInto?: string[]
    skill?: string
    behavior?: string
    toolHabit?: string
    decisionStrategy?: string
    riskControl?: string
    profitCredit?: string
    factBoundary?: string
  }
  distillationPlan?: StockFeedbackDistillationPlan
  evidenceState?: {
    attributionLabel?: string
    nextAction?: string
    evidenceGaps?: string[]
    confirmedEvidenceRefs?: string[]
    fundamentalEvidenceConfirmed?: boolean
    collectionResultId?: string | null
    sourceDraftId?: string | null
    sourceTaskId?: string | null
    paperTradeId?: string | null
    paperTradeTrack?: string | null
    ledgerKind?: string | null
    asOfDate?: string | null
    marketEvidence?: StockFeedbackMarketEvidence | null
    marketEvidenceWindow?: StockFeedbackMarketEvidenceWindow | null
    marketMicrostructureEvidence?: StockFeedbackMicrostructureEvidence | null
  }
  collectionState?: {
    result?: string | null
    resultLabel?: string | null
    sourceDraftId?: string | null
    sourceTaskId?: string | null
    targetPatternId?: string | null
    targetPatternLabel?: string | null
    requestedValidationTarget?: string | null
    nextAction?: string | null
    reviewer?: string | null
  } | null
  paperTradeState?: {
    ledgerKind?: string | null
    track?: string | null
    status?: string | null
    sourceQuestionId?: string | null
    sourceTrajectoryId?: string | null
    asOfDate?: string | null
    evidenceCutoff?: StockFeedbackPaperTradeSummary["evidenceCutoff"]
    entry?: StockFeedbackPaperTradeSummary["entry"]
    exit?: StockFeedbackPaperTradeSummary["exit"]
    positionSizing?: string | null
    executionEvidenceClass?: string | null
    marketEvidence?: StockFeedbackMarketEvidence | null
    marketEvidenceWindow?: StockFeedbackMarketEvidenceWindow | null
    marketEvidenceStatus?: string | null
    marketEvidenceWarning?: string | null
    marketMicrostructureEvidence?: StockFeedbackMicrostructureEvidence | null
    microstructureEvidenceStatus?: string | null
    microstructureEvidenceWarning?: string | null
    autoEvidenceGate?: PaperTradeAutoEvidenceGate | null
  } | null
  sourceRefs?: string[]
  artifactPath?: string | null
}

interface StockFeedbackReviewEvent {
  id?: string
  action?: string
  actionLabel?: string
  result?: string
  reviewer?: string
  note?: string
  generatedAt?: string
  trainingWeightDecision?: TrainingWeightDecision
}

interface ReviewActionOption {
  action?: string
  label?: string
  recommended?: boolean
  enabled?: boolean
  disabledReason?: string | null
  intent?: string
  preview?: {
    routing?: {
      eval?: boolean
      sft?: boolean
      preference?: boolean
      adapterCandidate?: boolean
      needsEvidence?: boolean
      rejectedForAdapter?: boolean
    }
    trainingUse?: string[]
    trainingWeightDecision?: TrainingWeightDecision
    peftBoundary?: {
      storesRawFacts?: boolean
      factsRemainIn?: string[]
      adapterStores?: string[]
    }
  }
}

interface StockFeedbackReviewQueueItem {
  sourceTrajectoryId?: string
  recommendedAction?: string
  recommendedActionLabel?: string
  reviewStatus?: "pending" | "reviewed"
  latestReview?: StockFeedbackReviewEvent | null
  humanActionPlan?: {
    schema?: string
    recommendedAction?: string
    recommendedActionLabel?: string
    primaryButtonLabel?: string
    intent?: string
    alreadyReviewed?: boolean
    latestAction?: string | null
    latestActionLabel?: string | null
    expectedRouting?: {
      eval?: boolean
      sft?: boolean
      preference?: boolean
      adapterCandidate?: boolean
      needsEvidence?: boolean
      rejectedForAdapter?: boolean
    }
    actionOptions?: ReviewActionOption[]
    why?: string[]
  }
  distillationPlan?: StockFeedbackDistillationPlan
  trajectory?: StockFeedbackTrajectory
}

interface StockFeedbackReviewQueueResult {
  counts?: {
    total?: number
    pending?: number
    reviewed?: number
    reviewEvents?: number
    byRecommendedAction?: Record<string, number>
    byReviewResult?: Record<string, number>
  }
  items?: StockFeedbackReviewQueueItem[]
}

type HumanActionPlan = NonNullable<StockFeedbackReviewQueueItem["humanActionPlan"]>

type EvidenceTaskStatus = "pending" | "running" | "awaiting_review" | "completed" | "failed" | "dlq"
type EvidenceResultStatus = "completed" | "awaiting_review" | "rejected" | "failed"

interface StockFeedbackEvidenceTask {
  taskId?: string
  status?: EvidenceTaskStatus | string
  source?: string
  sourceId?: string | null
  stockCode?: string | null
  stockName?: string | null
  taskType?: string
  targetFields?: string[]
  preferredSources?: string[]
  priority?: string
  overallConfidence?: number | null
  updatedAt?: string | null
  artifactPath?: string | null
}

interface StockFeedbackEvidenceTaskListResult {
  count?: number
  tasks?: StockFeedbackEvidenceTask[]
}

interface StockFeedbackEvidenceResult {
  resultId?: string
  taskId?: string
  status?: EvidenceResultStatus | string
  stockCode?: string | null
  stockName?: string | null
  taskType?: string | null
  overallConfidence?: number | null
  sourceRefs?: string[]
  toolStateRefs?: string[]
  evidenceRefs?: string[]
  humanGate?: {
    status?: string | null
    action?: string | null
    reviewer?: string | null
  } | null
  updatedAt?: string | null
  artifactPath?: string | null
}

interface StockFeedbackEvidenceResultListResult {
  count?: number
  results?: StockFeedbackEvidenceResult[]
}

interface StockFeedbackEvidenceSourceHealth {
  source?: string
  total?: number
  ok?: number
  failed?: number
  lastStatus?: string | null
  lastSeenAt?: string | null
  successRate?: number | null
  circuitStatus?: "open" | "closed" | string
}

interface StockFeedbackEvidenceSourceStatusResult {
  sources?: StockFeedbackEvidenceSourceHealth[]
}

interface StockFeedbackEvidenceDlqEntry {
  id?: string
  taskId?: string
  resultId?: string | null
  status?: "open" | "retried" | "discarded" | string
  reason?: string | null
  retryCommand?: string | null
  updatedAt?: string | null
  generatedAt?: string | null
}

interface StockFeedbackEvidenceDlqListResult {
  count?: number
  entries?: StockFeedbackEvidenceDlqEntry[]
}

export interface EvidenceQueueSummary {
  pending: number
  running: number
  awaitingReview: number
  completed: number
  failed: number
  dlq: number
  openDlq: number
  sourceTotal: number
  sourceOpenCircuits: number
  nextAction: "run_queue" | "review_results" | "repair_dlq" | "watch_sources" | "idle"
  headline: string
  detail: string
  tone: "good" | "warn" | "danger" | "neutral"
}

interface StockFeedbackListResult {
  sourceMode?: string
  returned?: number
  summary?: StockFeedbackStatus["summary"]
  trajectories?: StockFeedbackTrajectory[]
}

interface CommandResult {
  schema?: string
  dryRun?: boolean
  count?: number
  status?: string
  issueCount?: number
  writeResult?: Record<string, unknown> | null
  reviewEvent?: StockFeedbackReviewEvent
  draft?: StockFeedbackCollectionTaskDraft
  collectionTask?: StockFeedbackCollectionTask
  collectionResult?: StockFeedbackCollectionResult
  paperTrade?: StockFeedbackPaperTradeSummary
  marketEvidenceProvider?: string | null
  marketEvidenceStatus?: string | null
  marketEvidenceWarning?: string | null
  marketEvidenceNativeQuery?: PaperTradeNativeQuery | null
  microstructureEvidenceStatus?: string | null
  microstructureEvidenceWarning?: string | null
  microstructureEvidenceNativeQuery?: PaperTradeNativeQuery | null
  autoEvidenceGate?: PaperTradeAutoEvidenceGate | null
  artifactRefreshPlan?: PaperTradeArtifactRefreshPlan | null
  dynamicTestSet?: StockFeedbackStatus["dynamicBenchmark"]
  adapterCurriculum?: StockFeedbackStatus["adapterCurriculum"]
  patternRadar?: StockFeedbackPatternRadar
  coverage?: {
    byValidationTarget?: Record<string, number>
    byMarketPattern?: Record<string, number>
    byProfitOutcome?: Record<string, number>
    byProfitCredit?: Record<string, number>
  }
  summary?: {
    totalDrafts?: number
    llmOutperformed?: number
    llmUnderperformed?: number
    tied?: number
    unknown?: number
    negativeRoutes?: number
    lowWeightAdapterReviewRoutes?: number
  }
}

interface DataSourceProbeEndpoint {
  api?: string
  purpose?: string
  status?: string
  rowCount?: number
  fieldCount?: number
  message?: string | null
}

export interface DataSourceProbeResult {
  schema?: string
  provider?: string
  status?: string
  query?: {
    stockCode?: string | null
    tradeDate?: string | null
  }
  credentialStatus?: {
    configured?: boolean
    auth?: string
  }
  endpoints?: DataSourceProbeEndpoint[]
  entryPriceSuggestion?: DataSourceEntryPriceSuggestion | null
  coverage?: {
    total?: number
    ok?: number
    failed?: number
    skipped?: number
  }
  writePolicy?: {
    wroteFiles?: boolean
    wroteSecrets?: boolean
    returnedRows?: boolean
  }
}

export interface DataSourceEntryPriceSuggestion {
  schema?: string
  provider?: string | null
  source?: string | null
  ref?: string | null
  stockCode?: string | null
  tradeDate?: string | null
  asOfDate?: string | null
  priceType?: "open" | "close" | string | null
  price?: number | string | null
  close?: number | string | null
  open?: number | string | null
  pctChg?: number | string | null
  amount?: number | string | null
  rowCount?: number | null
  rawRowsReturned?: boolean
}

export interface EntryPriceSuggestionPresentation {
  label: string
  detail: string
  value: string
  ref: string
  provider: string
  source: string
  rowCount: number | null
}

export interface DataSourceProbeContext {
  stock?: { code?: string | null; name?: string | null; label?: string | null } | null
  evidenceState?: { asOfDate?: string | null } | null
  eventTimeline?: Array<{ at?: string | null }>
}

export interface DataSourceProbeSummary {
  tone: "neutral" | "good" | "warn" | "danger"
  headline: string
  detail: string
  badge: string
}

export interface PaperTradeDataSourceGate {
  status: "not_applicable" | "ready" | "needs_check" | "blocked" | "warning"
  tone: "neutral" | "good" | "warn" | "danger"
  headline: string
  detail: string
  blocksWrite: boolean
}

export interface PaperTradeWriteFollowUp {
  tone: "neutral" | "good" | "warn" | "danger"
  headline: string
  detail: string
  badge: string
  paperTradeId: string | null
  matchedTrajectoryId: string | null
  artifactRefreshPlan?: PaperTradeArtifactRefreshPlan | null
  nextSteps: string[]
  actions: PaperTradeWriteFollowUpAction[]
}

export interface PaperTradeArtifactRefreshPlan {
  schema?: string | null
  status?: string | null
  paperTradeId?: string | null
  ledgerKind?: string | null
  sourceRecordId?: string | null
  validationTarget?: string | null
  profitOutcome?: string | null
  executionEvidenceClass?: string | null
  staleArtifacts?: string[]
  stages?: PaperTradeArtifactRefreshPlanStage[]
  commands?: string[]
  reviewGate?: {
    paperTradeRequiresHumanReview?: boolean
    loraReadyRefreshBlockedUntilReview?: boolean
    reason?: string | null
  } | null
  peftBoundary?: {
    storesRawFacts?: boolean
    factsRemainIn?: string[]
    adapterStores?: string[]
  } | null
}

export interface PaperTradeArtifactRefreshPlanStage {
  id?: string | null
  label?: string | null
  command?: string | null
  status?: string | null
  required?: boolean
  reason?: string | null
}

export interface PaperTradePreviewSettlementSuggestion {
  headline: string
  detail: string
  badge: string
  patch: Partial<PaperTradeRecordDraft>
  diff: PaperTradePreviewSettlementDiff[]
}

export interface PaperTradeSettlementAppliedNotice {
  headline: string
  detail: string
  badge: string
  appliedFieldCount: number
  fieldLabels: string[]
}

export interface PaperTradePreviewSettlementDiff {
  field: string
  label: string
  before: string
  after: string
  action: "fill" | "update"
}

export interface PaperTradeWriteFollowUpAction {
  id: "build_benchmark" | "refresh_lora_ready_after_review" | "verify_refs"
  label: string
  detail: string
  enabled: boolean
  tone: "neutral" | "good" | "warn" | "danger"
}

export function collectionTaskFromCommandResult(result?: CommandResult | null): StockFeedbackCollectionTask | null {
  if (!result) return null
  if (result.collectionTask) {
    return {
      ...result.collectionTask,
      draftId: result.collectionTask.draftId ?? result.draft?.id ?? null,
      targetPatternId: result.collectionTask.targetPatternId ?? result.draft?.targetPatternId ?? null,
      targetPatternLabel: result.collectionTask.targetPatternLabel ?? result.draft?.targetPatternLabel ?? null,
      targetProfitCredit: result.collectionTask.targetProfitCredit ?? result.draft?.targetProfitCredit ?? null,
      targetProfitCreditLabel: result.collectionTask.targetProfitCreditLabel ?? result.draft?.targetProfitCreditLabel ?? null,
      validationTarget: result.collectionTask.validationTarget ?? result.draft?.validationTarget ?? null,
      adapterCapability: result.collectionTask.adapterCapability ?? result.draft?.adapterCapability ?? null,
      priority: result.collectionTask.priority ?? result.draft?.priority,
      status: result.collectionTask.status ?? result.draft?.status,
      goal: result.collectionTask.goal ?? result.draft?.goal,
      humanPrompt: result.collectionTask.humanPrompt ?? result.draft?.humanPrompt,
      requiredToolState: result.collectionTask.requiredToolState ?? result.draft?.requiredToolState,
      acceptanceCriteria: result.collectionTask.acceptanceCriteria ?? result.draft?.acceptanceCriteria,
      sampleMustInclude: result.collectionTask.sampleMustInclude ?? result.draft?.sampleMustInclude,
      suggestedFilters: result.collectionTask.suggestedFilters ?? result.draft?.suggestedFilters,
      currentCounts: result.collectionTask.currentCounts ?? result.draft?.currentCounts,
      peftBoundary: result.collectionTask.peftBoundary ?? result.draft?.peftBoundary,
    }
  }
  const draft = result.draft
  if (!draft) return null
  const targetPatternId = draft.targetPatternId ?? draft.suggestedFilters?.marketPattern ?? null
  const targetProfitCredit = draft.targetProfitCredit ?? draft.suggestedFilters?.profitCredit ?? null
  if (!targetPatternId && !targetProfitCredit) return null
  return {
    schema: "stock-feedback-collection-task-v1",
    taskId: draft.taskId ?? undefined,
    draftId: draft.id ?? null,
    targetPatternId,
    targetPatternLabel: draft.targetPatternLabel ?? targetPatternId,
    targetProfitCredit,
    targetProfitCreditLabel: draft.targetProfitCreditLabel ?? targetProfitCredit,
    validationTarget: draft.validationTarget ?? draft.suggestedFilters?.validationTarget ?? null,
    adapterCapability: draft.adapterCapability ?? null,
    priority: draft.priority ?? "medium",
    status: draft.status,
    goal: draft.goal,
    humanPrompt: draft.humanPrompt,
    requiredToolState: draft.requiredToolState,
    acceptanceCriteria: draft.acceptanceCriteria,
    sampleMustInclude: draft.sampleMustInclude,
    suggestedFilters: draft.suggestedFilters,
    currentCounts: draft.currentCounts,
    peftBoundary: draft.peftBoundary,
  }
}

function collectionTaskTargetArgs(task: StockFeedbackCollectionTask) {
  const profitCredit = task.targetProfitCredit ?? task.suggestedFilters?.profitCredit
  if (profitCredit) return ["--profit-credit", profitCredit]
  const patternId = task.targetPatternId ?? task.suggestedFilters?.marketPattern
  if (patternId) return ["--market-pattern", patternId]
  return []
}

function collectionResultContextArgs(task: StockFeedbackCollectionTask) {
  const args: string[] = []
  if (task.draftId) args.push("--draft-id", task.draftId)
  if (task.taskId) args.push("--task-id", task.taskId)
  args.push(...collectionTaskTargetArgs(task))
  return args
}

function sameCollectionTask(a?: StockFeedbackCollectionTask | null, b?: StockFeedbackCollectionTask | null) {
  if (!a || !b) return false
  if (a.draftId && b.draftId && a.draftId === b.draftId) return true
  if (a.taskId && b.taskId && a.taskId === b.taskId) return true
  const aProfitCredit = a.targetProfitCredit ?? a.suggestedFilters?.profitCredit
  const bProfitCredit = b.targetProfitCredit ?? b.suggestedFilters?.profitCredit
  if (aProfitCredit && bProfitCredit && aProfitCredit === bProfitCredit) return true
  const aPatternId = a.targetPatternId ?? a.suggestedFilters?.marketPattern
  const bPatternId = b.targetPatternId ?? b.suggestedFilters?.marketPattern
  return Boolean(aPatternId && bPatternId && aPatternId === bPatternId)
}

function collectionResultTargetLabel(result?: StockFeedbackCollectionResult | null) {
  if (!result) return "补样本"
  return result.targetPatternLabel
    ?? result.targetPatternId
    ?? result.targetProfitCreditLabel
    ?? profitCreditBucketLabel(result.targetProfitCredit)
}

function collectionResultEvidenceCount(result?: StockFeedbackCollectionResult | null) {
  return result?.evidenceRefCount ?? result?.evidenceRefs?.length ?? 0
}

export function buildCollectionResultFollowUp(result?: StockFeedbackCollectionResult | null): CollectionResultFollowUp | null {
  if (!result?.result) return null
  const target = collectionResultTargetLabel(result)
  const resultLabel = collectionResultLabel(result.result, result.resultLabel)
  const refCount = collectionResultEvidenceCount(result)
  const refText = `${refCount} 个 evidence ref`
  const peftBoundary = result.peftBoundary?.storesRawFacts === false
    ? "；adapter 只沉淀行为、技能、工具习惯和决策策略，不存原始事实"
    : ""
  if (result.result === "confirmed") {
    return {
      headline: "补样本已确认",
      detail: `${target} 已记录为 ${resultLabel}，带 ${refText}${peftBoundary}。`,
      resultLabel,
      nextStep: "下一步：重建轨迹，把 collection-result 回流到 review 队列，再决定进入 adapter、eval 或 preference。",
      primaryAction: "rebuild_trajectories",
      primaryActionLabel: "重建轨迹",
      refreshLoraReadyLabel: "重建并刷新 LoRA-ready",
      keepCollectionOpen: false,
      tone: "good",
    }
  }
  if (result.result === "refuted") {
    return {
      headline: "证据反驳，转负样本复核",
      detail: `${target} 已记录为 ${resultLabel}，带 ${refText}；保留为反证和负样本候选，避免把伪催化或失败预期提升为正向 adapter。`,
      resultLabel,
      nextStep: "下一步：生成 Benchmark，检查它是否进入 eval/preference 的失败归因或风险控制覆盖。",
      primaryAction: "build_benchmark",
      primaryActionLabel: "生成 Benchmark",
      refreshLoraReadyLabel: null,
      keepCollectionOpen: false,
      tone: "danger",
    }
  }
  return {
    headline: "证据不足，采集单保持打开",
    detail: `${target} 仍是 ${resultLabel}；不要提升训练权重，也不要进入 high_confidence。`,
    resultLabel,
    nextStep: "下一步：补齐 retrieval/tool state、价格/成交额或 trade ledger refs 后，再重新提交确认。",
    primaryAction: "continue_collection",
    primaryActionLabel: "继续补证",
    refreshLoraReadyLabel: null,
    keepCollectionOpen: true,
    tone: "warn",
  }
}

export function buildCollectionResultReviewRoutePreview(
  result?: StockFeedbackCollectionResult | null,
): CollectionResultReviewRoutePreview | null {
  if (!result?.result) return null
  const target = collectionResultTargetLabel(result)
  const refCount = collectionResultEvidenceCount(result)
  const factStores = result.peftBoundary?.factsRemainIn?.filter(Boolean) ?? []
  const adapterStores = result.peftBoundary?.adapterStores?.filter(Boolean) ?? []
  const peftClean = result.peftBoundary?.storesRawFacts === false
  const peftBlocked = result.peftBoundary?.storesRawFacts === true
  const factStoreLabel = factStores.slice(0, 3).join(" / ") || "retrieval/tool state"
  const adapterStoreLabel = adapterStores.slice(0, 3).join(" / ") || result.adapterCapability || "可复用判断策略"
  const peftBoundaryLabel = peftClean
    ? `事实留在 ${factStoreLabel}`
    : peftBlocked
      ? "阻断：storesRawFacts=true"
      : "待补：storesRawFacts=false / factsRemainIn / adapterStores"
  const boundaryChecklist = [
    "核对收益、回撤、持有周期是否来自 retrieval/tool state 或 trade ledger",
    "确认 adapter 不存原始事实、公告正文、价格行或交易流水",
  ]

  if (result.result === "insufficient") {
    return {
      headline: "人审预案：继续补证",
      detail: `${target} 证据不足；保持采集单打开，不提升训练权重，也不进入 high_confidence。`,
      recommendedAction: "needs_evidence",
      recommendedActionLabel: reviewActionLabel("needs_evidence"),
      routeLabels: ["补证"],
      peftBoundaryLabel,
      reviewChecklist: [
        "补 retrieval/tool state、sourceRefs、价格路径或真实交易反馈引用",
        "证据满足前不得进入 adapter、SFT 或高权重正样本",
      ],
      tone: "warn",
    }
  }

  if (result.result === "refuted") {
    return {
      headline: "人审预案：转负样本和失败归因",
      detail: `${target} 已被反证引用覆盖；不进入正向 adapter，优先训练伪催化识别、失败归因和风险控制。`,
      recommendedAction: "route_to_preference",
      recommendedActionLabel: reviewActionLabel("route_to_preference"),
      routeLabels: ["preference", "eval", "排除 adapter"],
      peftBoundaryLabel,
      reviewChecklist: [
        "确认反证 refs 覆盖无承接、一日游、预期证伪或亏损反馈",
        "抽取失败归因、风险控制和补证路线，不抽取原始事实正文",
      ],
      tone: "danger",
    }
  }

  if (!peftClean) {
    return {
      headline: "人审预案：先修 PEFT 边界",
      detail: `${target} 已确认但 ${peftBoundaryLabel}；先修边界，不能把 storesRawFacts=true 的样本提升为正向 adapter。`,
      recommendedAction: "needs_evidence",
      recommendedActionLabel: reviewActionLabel("needs_evidence"),
      routeLabels: ["补证", "排除 adapter"],
      peftBoundaryLabel,
      reviewChecklist: [
        "先把事实、公告、价格行和交易流水移回 retrieval/tool state",
        "补 storesRawFacts=false、factsRemainIn 和 adapterStores 后再分流",
      ],
      tone: peftBlocked ? "danger" : "warn",
    }
  }

  const profitCredit = result.targetProfitCredit ?? ""
  const validationTarget = result.validationTarget ?? ""
  if (profitCredit === "execution_risk_negative" || validationTarget === "priced_in_risk") {
    return {
      headline: "人审预案：进风险/买点负样本",
      detail: `${target} 是方向与买点/赔率拆分样本；优先训练 priced-in 风险、买点错误和仓位控制，不提升正向 adapter。`,
      recommendedAction: "mark_entry_wrong",
      recommendedActionLabel: reviewActionLabel("mark_entry_wrong"),
      routeLabels: ["preference", "eval", "排除 adapter"],
      peftBoundaryLabel,
      reviewChecklist: [
        ...boundaryChecklist,
        "确认模型学习的是买点、赔率和风险控制，而不是个股事实",
      ],
      tone: "warn",
    }
  }

  if (profitCredit === "failed_expectation_negative" || validationTarget === "disconfirmation") {
    return {
      headline: "人审预案：转负样本和失败归因",
      detail: `${target} 是失败预期或伪催化样本；进入 eval/preference，训练反证识别与补证路线。`,
      recommendedAction: "route_to_preference",
      recommendedActionLabel: reviewActionLabel("route_to_preference"),
      routeLabels: ["preference", "eval", "排除 adapter"],
      peftBoundaryLabel,
      reviewChecklist: [
        ...boundaryChecklist,
        "确认失败归因可复用，不把单只股票事实写进 adapter",
      ],
      tone: "danger",
    }
  }

  if (profitCredit === "pattern_execution_supported") {
    return {
      headline: "人审预案：复核后进 adapter 候选",
      detail: `${target} 带 ${refCount} 个 evidence ref；人审只沉淀可复用的行为、技能、工具习惯和决策策略，事实留在 ${factStoreLabel}，adapter 学 ${adapterStoreLabel}。`,
      recommendedAction: "approve_for_adapter",
      recommendedActionLabel: reviewActionLabel("approve_for_adapter"),
      routeLabels: ["adapter", "eval"],
      peftBoundaryLabel,
      reviewChecklist: [
        ...boundaryChecklist,
        "复核收益为正、回撤可接受且执行路径可复用后再提升权重",
      ],
      tone: "good",
    }
  }

  return {
    headline: "人审预案：先进入动态 eval",
    detail: `${target} 已确认但收益归因桶不明确；先进入 eval，等待人工确认是否可转 adapter、SFT 或 preference。`,
    recommendedAction: "route_to_eval",
    recommendedActionLabel: reviewActionLabel("route_to_eval"),
    routeLabels: ["eval"],
    peftBoundaryLabel,
    reviewChecklist: boundaryChecklist,
    tone: "warn",
  }
}

function sourceMixCoversCollectionResult(
  sourceMix: ArtifactSourceMix | null | undefined,
  result: StockFeedbackCollectionResult,
  trajectoryId?: string | null,
) {
  return Boolean(findCollectionResultAuditContextInSourceMix(sourceMix, result, trajectoryId))
}

function sourceMixRefCoversCollectionResult(
  ref: ArtifactAuditRef,
  result: StockFeedbackCollectionResult,
  trajectoryId?: string | null,
) {
  const resultId = result.id ?? null
  return (
    Boolean(resultId && ref.collectionResultId === resultId) ||
    Boolean(trajectoryId && ref.sourceTrajectoryId === trajectoryId)
  )
}

function auditContextFromCollectionResultTrajectory(
  result: StockFeedbackCollectionResult,
  trajectory?: StockFeedbackTrajectory | null,
): AuditSelectionContext | null {
  if (!trajectory?.id) return null
  return {
    sourceTitle: "补样本回流轨迹",
    sourceTrajectoryId: trajectory.id,
    refKind: "trajectory",
    refId: trajectory.id,
    collectionResultId: result.id ?? trajectory.evidenceState?.collectionResultId ?? null,
    sourceKindLabel: "补样本回流轨迹",
  }
}

function findCollectionResultAuditContextInSourceMix(
  sourceMix: ArtifactSourceMix | null | undefined,
  result: StockFeedbackCollectionResult,
  trajectoryId?: string | null,
  sourceTitle = "产物来源",
): AuditSelectionContext | null {
  if (!sourceMix) return null
  for (const bucket of sourceMix.adapterBatchRecipe?.buckets ?? []) {
    const label = bucket.label ?? adapterBatchRecipeBucketLabel(bucket.id)
    for (const ref of bucket.candidateRefs ?? []) {
      if (!sourceMixRefCoversCollectionResult(ref, result, trajectoryId)) continue
      return auditContextFromRef(ref, {
        sourceTitle,
        sourceTrajectoryId: ref.sourceTrajectoryId ?? trajectoryId ?? null,
        collectionResultId: ref.collectionResultId ?? result.id ?? null,
        bucketId: bucket.id,
        bucketLabel: label,
        sampling: bucket.recommendedSampling,
        effectiveWeightMultiplier: bucket.effectiveWeightMultiplier,
      })
    }
  }
  for (const ref of sourceMix.refs ?? []) {
    if (!sourceMixRefCoversCollectionResult(ref, result, trajectoryId)) continue
    return auditContextFromRef(ref, {
      sourceTitle,
      sourceTrajectoryId: ref.sourceTrajectoryId ?? trajectoryId ?? null,
      collectionResultId: ref.collectionResultId ?? result.id ?? null,
    })
  }
  return null
}

function collectionResultRoadmapAction(
  label: string,
  auditContext?: AuditSelectionContext | null,
): CollectionResultActionRoadmapStep["action"] {
  if (!auditContext) return undefined
  return { label, auditContext }
}

export function buildCollectionResultActionRoadmap(
  result?: StockFeedbackCollectionResult | null,
  context: CollectionResultActionRoadmapContext = {},
): CollectionResultActionRoadmap | null {
  if (!result?.result) return null
  const target = collectionResultTargetLabel(result)
  const resultLabel = collectionResultLabel(result.result, result.resultLabel)
  const refCount = collectionResultEvidenceCount(result)
  const peftClean = result.peftBoundary?.storesRawFacts === false
  const peftBlocked = result.peftBoundary?.storesRawFacts === true
  const factStores = result.peftBoundary?.factsRemainIn?.slice(0, 2).join(" / ") || "retrieval/tool state"
  const matchedTrajectory = findTrajectoryForCollectionResult(context.trajectories ?? [], result)
  const trajectoryAuditContext = auditContextFromCollectionResultTrajectory(result, matchedTrajectory)
  const benchmarkAuditContext = findCollectionResultAuditContextInSourceMix(context.benchmark, result, matchedTrajectory?.id, "Benchmark 来源")
  const loraReadyAuditContext = findCollectionResultAuditContextInSourceMix(context.loraReady, result, matchedTrajectory?.id, "LoRA-ready 来源")
  const trajectoryAction = collectionResultRoadmapAction("定位轨迹", trajectoryAuditContext)
  const benchmarkAction = collectionResultRoadmapAction("定位 Benchmark", benchmarkAuditContext)
  const loraReadyAction = collectionResultRoadmapAction("定位 LoRA-ready", loraReadyAuditContext)
  const benchmarkCovered = sourceMixCoversCollectionResult(context.benchmark, result, matchedTrajectory?.id)
  const loraReadyCovered = sourceMixCoversCollectionResult(context.loraReady, result, matchedTrajectory?.id)

  if (result.result === "confirmed") {
    const refreshStatus: CollectionResultActionRoadmapStep["status"] = peftBlocked || !peftClean ? "blocked" : "pending"
    const refreshDetail = peftBlocked
      ? "阻断：storesRawFacts=true，先把事实移回 retrieval/tool state。"
      : peftClean
        ? `刷新 Benchmark / LoRA-ready；只输出行为策略，不带原始事实，事实留在 ${factStores}。`
        : "先补 storesRawFacts=false、factsRemainIn、adapterStores，再刷新 LoRA-ready。"
    if (loraReadyCovered) {
      return {
        headline: "回流路线图：训练产物已覆盖",
        detail: `${target} 已被 LoRA-ready 产物覆盖；继续用 artifact source mix 复核权重和事实边界。`,
        activeStepId: "refresh_artifacts",
        tone: "good",
        steps: [
          { id: "record_result", label: "记录结果", status: "done", detail: "collection-result 已写入工具态引用" },
          { id: "resolve_evidence", label: "证据闭环", status: "done", detail: `${refCount} 个 evidence ref 已绑定` },
          { id: "rebuild_trajectory", label: "重建轨迹", status: "done", detail: matchedTrajectory?.id ? `轨迹 ${matchedTrajectory.id}` : "轨迹已覆盖该结果", action: trajectoryAction },
          { id: "human_review", label: "人审分流", status: "done", detail: benchmarkCovered ? "Benchmark 已覆盖，人审链路可复核" : "已进入训练产物来源审计", action: benchmarkAction ?? loraReadyAction ?? trajectoryAction },
          { id: "refresh_artifacts", label: "刷新产物", status: "done", detail: "LoRA-ready 已覆盖；adapter 候选仍不携带原始事实", action: loraReadyAction ?? benchmarkAction ?? trajectoryAction },
        ],
      }
    }
    if (benchmarkCovered) {
      return {
        headline: "回流路线图：刷新训练产物",
        detail: `${target} 已有轨迹和 Benchmark 覆盖；下一步刷新 LoRA-ready 或复核权重变化。`,
        activeStepId: "refresh_artifacts",
        tone: "good",
        steps: [
          { id: "record_result", label: "记录结果", status: "done", detail: "collection-result 已写入工具态引用" },
          { id: "resolve_evidence", label: "证据闭环", status: "done", detail: `${refCount} 个 evidence ref 已绑定` },
          { id: "rebuild_trajectory", label: "重建轨迹", status: "done", detail: matchedTrajectory?.id ? `轨迹 ${matchedTrajectory.id}` : "轨迹已覆盖该结果", action: trajectoryAction },
          { id: "human_review", label: "人审分流", status: "done", detail: "Benchmark 已覆盖，等待 LoRA-ready 刷新或权重复核", action: benchmarkAction ?? trajectoryAction },
          { id: "refresh_artifacts", label: "刷新产物", status: refreshStatus === "blocked" ? "blocked" : "active", detail: refreshDetail },
        ],
      }
    }
    if (matchedTrajectory) {
      return {
        headline: "回流路线图：进入人审分流",
        detail: `${target} 已重建为轨迹；下一步生成 Benchmark 或人工 review 分流。`,
        activeStepId: "human_review",
        tone: "good",
        steps: [
          { id: "record_result", label: "记录结果", status: "done", detail: "collection-result 已写入工具态引用" },
          { id: "resolve_evidence", label: "证据闭环", status: "done", detail: `${refCount} 个 evidence ref 已绑定` },
          { id: "rebuild_trajectory", label: "重建轨迹", status: "done", detail: `轨迹 ${matchedTrajectory.id}`, action: trajectoryAction },
          { id: "human_review", label: "人审分流", status: "active", detail: "确认 adapter / eval / preference / SFT 路线", action: trajectoryAction },
          { id: "refresh_artifacts", label: "刷新产物", status: refreshStatus, detail: refreshDetail },
        ],
      }
    }
    return {
      headline: "回流路线图：先重建轨迹",
      detail: `${target} 已记录为 ${resultLabel}，带 ${refCount} 个 evidence ref；下一步把结果回流为可 review 的轨迹。`,
      activeStepId: "rebuild_trajectory",
      tone: "good",
      steps: [
        { id: "record_result", label: "记录结果", status: "done", detail: "collection-result 已写入工具态引用" },
        { id: "resolve_evidence", label: "证据闭环", status: "done", detail: `${refCount} 个 evidence ref 已绑定` },
        { id: "rebuild_trajectory", label: "重建轨迹", status: "active", detail: "把结果并入 stock-feedback trajectory 和 review 队列" },
        { id: "human_review", label: "人审分流", status: "pending", detail: "确认 adapter / eval / preference / SFT 路线" },
        { id: "refresh_artifacts", label: "刷新产物", status: refreshStatus, detail: refreshDetail },
      ],
    }
  }

  if (result.result === "refuted") {
    return {
      headline: "回流路线图：转负样本 Benchmark",
      detail: `${target} 已被证据反驳；优先进入失败归因、伪催化识别和风险控制覆盖。`,
      activeStepId: "human_review",
      tone: "danger",
      steps: [
        { id: "record_result", label: "记录反证", status: "done", detail: `${resultLabel} 已保留为反证来源` },
        { id: "resolve_evidence", label: "反证引用", status: "done", detail: `${refCount} 个 evidence ref 已绑定` },
        { id: "rebuild_trajectory", label: "补负样本轨迹", status: "pending", detail: "可重建为 disconfirmation / priced-in 风险轨迹" },
        { id: "human_review", label: "负样本复核", status: "active", detail: "生成 Benchmark，进入 eval/preference 的失败归因覆盖" },
        { id: "refresh_artifacts", label: "正向 LoRA", status: "blocked", detail: "不进入正向 adapter；只允许负样本/eval/preference 路线" },
      ],
    }
  }

  return {
    headline: "回流路线图：继续补证",
    detail: `${target} 仍是 ${resultLabel}；先补证据，不提升训练权重。`,
    activeStepId: "resolve_evidence",
    tone: "warn",
    steps: [
      { id: "record_result", label: "记录状态", status: "done", detail: "已记录为证据不足" },
      { id: "resolve_evidence", label: "继续补证", status: "active", detail: "补 retrieval/tool state、sourceRefs、价格路径或交易反馈" },
      { id: "rebuild_trajectory", label: "重建轨迹", status: "blocked", detail: "证据不足前不回流训练轨迹" },
      { id: "human_review", label: "人审分流", status: "blocked", detail: "等待证据满足采集单验收标准" },
      { id: "refresh_artifacts", label: "刷新产物", status: "blocked", detail: "不得刷新训练权重或进入 high_confidence" },
    ],
  }
}

export function buildCollectionResultHumanReviewBridge(
  roadmap?: CollectionResultActionRoadmap | null,
  reviewPreview?: CollectionResultReviewRoutePreview | null,
): CollectionResultHumanReviewBridge | null {
  if (!roadmap || !reviewPreview) return null
  const humanStep = roadmap.steps.find((step) => step.id === "human_review") ?? null
  if (!humanStep || humanStep.status === "blocked") return null
  const base = {
    recommendedAction: reviewPreview.recommendedAction,
    recommendedActionLabel: reviewPreview.recommendedActionLabel,
    routeLabels: reviewPreview.routeLabels,
    peftBoundaryLabel: reviewPreview.peftBoundaryLabel,
    tone: reviewPreview.tone,
  }
  if (humanStep.action?.auditContext.sourceTrajectoryId) {
    return {
      ...base,
      headline: "人审入口：定位回流轨迹",
      detail: `已重建为可 review 轨迹；定位后在右侧人工分流提交 ${reviewPreview.recommendedActionLabel}，事实和原始引用仍留在 retrieval/tool state。`,
      actionLabel: "定位并人审",
      step: humanStep,
    }
  }
  return {
    ...base,
    headline: "人审入口：先重建轨迹",
    detail: `完成重建后再进入右侧人工分流提交 ${reviewPreview.recommendedActionLabel}；${reviewPreview.peftBoundaryLabel}。`,
    actionLabel: "等待重建",
    step: null,
  }
}

function collectionResultFallbackNextAction(
  followUp: CollectionResultFollowUp,
  step: CollectionResultActionRoadmapStep | null,
): CollectionResultNextAction {
  return {
    headline: `当前下一步：${followUp.primaryActionLabel}`,
    detail: followUp.nextStep,
    actionLabel: followUp.primaryActionLabel,
    actionKind: followUp.primaryAction,
    tone: followUp.tone,
    step,
  }
}

export function buildCollectionResultNextAction(
  followUp?: CollectionResultFollowUp | null,
  roadmap?: CollectionResultActionRoadmap | null,
  reviewBridge?: CollectionResultHumanReviewBridge | null,
): CollectionResultNextAction | null {
  if (!followUp) return null
  const activeStep = roadmap?.steps.find((step) => step.id === roadmap.activeStepId)
    ?? roadmap?.steps.find((step) => step.status === "active")
    ?? null

  if (!roadmap || !activeStep) return collectionResultFallbackNextAction(followUp, activeStep)

  const allDone = roadmap.steps.length > 0 && roadmap.steps.every((step) => step.status === "done")
  if (allDone) {
    return {
      headline: "当前下一步：已覆盖",
      detail: "该 collection-result 已进入训练产物来源；继续在 source mix 和人审记录里复核权重，不重复重建。",
      actionLabel: "已闭环",
      actionKind: "none",
      tone: "good",
      step: activeStep,
    }
  }

  if (activeStep.status === "blocked") {
    return {
      headline: "当前下一步：人工排查",
      detail: activeStep.detail,
      actionLabel: "等待处理",
      actionKind: "none",
      tone: roadmap.tone,
      step: activeStep,
    }
  }

  if (activeStep.id === "resolve_evidence") {
    return {
      headline: "当前下一步：继续补证",
      detail: "先补 retrieval/tool state、sourceRefs、价格路径或真实交易反馈，再重新记录结果。",
      actionLabel: "继续补证",
      actionKind: "continue_collection",
      tone: "warn",
      step: activeStep,
    }
  }

  if (activeStep.id === "rebuild_trajectory") {
    return {
      headline: "当前下一步：重建轨迹",
      detail: "把 collection-result 回流为 stock-feedback trajectory，随后定位到人审分流和 Benchmark 覆盖。",
      actionLabel: "重建轨迹",
      actionKind: "rebuild_trajectories",
      tone: roadmap.tone,
      step: activeStep,
    }
  }

  if (activeStep.id === "human_review") {
    if (reviewBridge?.step?.action?.auditContext.sourceTrajectoryId) {
      return {
        headline: "当前下一步：定位并人审",
        detail: `定位右侧回流轨迹，提交 ${reviewBridge.recommendedActionLabel}；之后刷新 Benchmark / LoRA-ready 覆盖。`,
        actionLabel: reviewBridge.actionLabel,
        actionKind: "select_human_review",
        tone: reviewBridge.tone,
        step: reviewBridge.step,
      }
    }
    if (followUp.primaryAction === "build_benchmark") {
      return {
        headline: "当前下一步：生成 Benchmark",
        detail: "把反证或失败归因先落成 eval/preference 覆盖，避免进入正向 adapter。",
        actionLabel: followUp.primaryActionLabel,
        actionKind: "build_benchmark",
        tone: followUp.tone,
        step: activeStep,
      }
    }
    return collectionResultFallbackNextAction(followUp, activeStep)
  }

  if (activeStep.id === "refresh_artifacts") {
    if (activeStep.status === "active") {
      return {
        headline: "当前下一步：刷新训练产物",
        detail: "轨迹与 Benchmark 已覆盖；刷新 LoRA-ready/source mix 后再复核权重变化和 PEFT 边界。",
        actionLabel: followUp.refreshLoraReadyLabel ?? "重建并刷新 LoRA-ready",
        actionKind: "refresh_lora_ready",
        tone: roadmap.tone,
        step: activeStep,
      }
    }
    return {
      headline: "当前下一步：等待产物刷新",
      detail: activeStep.detail,
      actionLabel: "等待处理",
      actionKind: "none",
      tone: roadmap.tone,
      step: activeStep,
    }
  }

  return collectionResultFallbackNextAction(followUp, activeStep)
}

function collectionTaskTargetLabel(task?: StockFeedbackCollectionTask | null) {
  return task?.targetPatternLabel
    ?? task?.targetPatternId
    ?? task?.targetProfitCreditLabel
    ?? profitCreditBucketLabel(task?.targetProfitCredit)
}

function collectionTaskPrimaryRouteLabel(task?: StockFeedbackCollectionTask | null) {
  if (!task) return "补样本 -> 轨迹 -> Benchmark"
  if (["execution_risk_negative", "failed_expectation_negative"].includes(task.targetProfitCredit ?? "")) return "eval/preference/负样本"
  if (task.targetProfitCredit === "pattern_execution_supported") return "人审后 adapter 正样本"
  if (task.targetProfitCredit) return "收益反馈 -> 归因 -> 分流"
  if (task.targetPatternId) return "采集单 -> 轨迹 -> Benchmark"
  return "补样本 -> 轨迹 -> Benchmark"
}

function collectionTaskPeftStatus(task?: StockFeedbackCollectionTask | null): CollectionTaskReviewGuide["peftStatus"] {
  return task?.peftBoundary?.storesRawFacts === false ? "clean" : "needs_review"
}

export function buildCollectionTaskReviewGuide(task: StockFeedbackCollectionTask): CollectionTaskReviewGuide {
  const targetLabel = collectionTaskTargetLabel(task)
  const primaryRouteLabel = collectionTaskPrimaryRouteLabel(task)
  const peftStatus = collectionTaskPeftStatus(task)
  const peftDetail = peftStatus === "clean"
    ? "PEFT 边界已声明：LoRA 不存原始事实，只沉淀行为、技能、工具习惯和决策策略。"
    : "先补 PEFT 边界：需要 storesRawFacts=false、factsRemainIn 和 adapterStores，再记录为训练候选。"
  const factStore = (task.peftBoundary?.factsRemainIn ?? []).slice(0, 2).join(" / ") || "retrieval/tool state"
  const adapterStores = (task.peftBoundary?.adapterStores ?? []).slice(0, 3).join(" / ") || "行为/技能/工具习惯/决策策略"
  const evidenceNeeds = uniqueTextParts([
    ...(task.sampleMustInclude ?? []),
    ...(task.requiredToolState ?? []).slice(0, 2),
  ]).slice(0, 3).join("；")
  const confirmedNote = peftStatus === "clean"
    ? `补样本确认：${targetLabel}。结果分流：${primaryRouteLabel}。证据引用已人工确认，事实留在 ${factStore}；adapter 只学习 ${adapterStores}。`
    : `补样本确认前需补 PEFT 边界：${targetLabel}。请补 storesRawFacts=false / factsRemainIn / adapterStores 后再进入训练分流。`
  return {
    headline: `采集单质检：${targetLabel}`,
    targetLabel,
    primaryRouteLabel,
    peftStatus,
    peftDetail,
    detail: `先验证证据引用和验收标准，再记录结果；${peftDetail}`,
    resultOptions: [
      {
        result: "confirmed",
        label: "确认证据",
        tone: "good",
        routeLabel: primaryRouteLabel,
        detail: evidenceNeeds ? `证据满足：${evidenceNeeds}` : "证据满足采集单要求，可以回流重建轨迹。",
        nextStep: "写入 collection result 后重建轨迹，再进入 review / Benchmark / LoRA-ready 刷新。",
        noteDraft: confirmedNote,
      },
      {
        result: "insufficient",
        label: "证据不足",
        tone: "warn",
        routeLabel: "继续补证",
        detail: "证据引用不足或验收标准未满足，不能提升训练权重。",
        nextStep: "保持采集单打开，继续补 retrieval/tool state、sourceRefs、价格或交易反馈。",
        noteDraft: `证据不足：${targetLabel}。保持采集单打开，继续补 retrieval/tool state/sourceRefs；当前不进入 adapter 或正向训练权重。`,
      },
      {
        result: "refuted",
        label: "证据反驳",
        tone: "danger",
        routeLabel: "负样本复核",
        detail: "证据反向或假设被证伪，应转为失败归因、负样本或关闭缺口。",
        nextStep: "生成 Benchmark 或进入 eval/preference，用来训练反证识别与失败归因。",
        noteDraft: `证据反驳：${targetLabel}。转负样本复核或失败归因；事实仍留在 retrieval/tool state，不写入 LoRA。`,
      },
    ],
  }
}

function evidenceRefCount(evidenceRefs?: string | null) {
  return (evidenceRefs ?? "")
    .split(/[\n,;，；]+/)
    .map((ref) => ref.trim())
    .filter(Boolean)
    .length
}

export function buildCollectionTaskDistillationPreflight(
  task: StockFeedbackCollectionTask,
  input: { evidenceRefs?: string | null; summary?: string | null } = {},
): CollectionTaskDistillationPreflight {
  const targetLabel = collectionTaskTargetLabel(task)
  const routeLabel = collectionTaskPrimaryRouteLabel(task)
  const refs = evidenceRefCount(input.evidenceRefs)
  const hasEvidenceRefs = refs > 0
  const hasSummary = Boolean(input.summary?.trim())
  const storesRawFacts = task.peftBoundary?.storesRawFacts
  const adapterStores = task.peftBoundary?.adapterStores ?? []
  const factsRemainIn = task.peftBoundary?.factsRemainIn ?? []
  const peftBlocked = storesRawFacts === true
  const peftClean = storesRawFacts === false && adapterStores.length > 0
  const factStoreLabel = factsRemainIn.slice(0, 2).join(" / ") || "retrieval/tool state"

  const status: CollectionTaskDistillationPreflight["status"] = peftBlocked
    ? "blocked"
    : !hasEvidenceRefs
      ? "needs_evidence"
      : !peftClean
        ? "needs_boundary"
        : "ready"

  const tone: CollectionTaskDistillationPreflight["tone"] = status === "ready"
    ? "good"
    : status === "blocked"
      ? "danger"
      : "warn"
  const headline = {
    ready: "蒸馏预检：可回流训练分流",
    needs_evidence: "蒸馏预检：等待证据引用",
    needs_boundary: "蒸馏预检：先补 PEFT 边界",
    blocked: "蒸馏预检：阻断事实泄漏",
  }[status]
  const detail = {
    ready: `证据引用和 PEFT 边界已满足，确认后可回流到 ${routeLabel}；原始事实仍留在 ${factStoreLabel}。`,
    needs_evidence: `先给 ${targetLabel} 补至少一个 retrieval/tool state、价格 SQL 或 trade ledger 引用，不能用摘要替代证据。`,
    needs_boundary: "证据已有，可以记录 collection-result；但进入训练分流前要补 storesRawFacts=false、factsRemainIn 和 adapterStores。",
    blocked: "当前边界声明会把原始事实放进 adapter，必须改回 retrieval/tool state 后再进入训练候选。",
  }[status]
  const nextAction = {
    ready: "下一步：确认后重建轨迹，再进入 review、Benchmark 或 LoRA-ready 刷新。",
    needs_evidence: "下一步：补 retrieval/tool state、sourceRefs、价格路径或真实交易反馈引用。",
    needs_boundary: "下一步：补 storesRawFacts=false / factsRemainIn / adapterStores，再决定 adapter、eval 或 preference。",
    blocked: "下一步：排除 adapter 正向提升，先修正事实边界并转人工复核。",
  }[status]

  return {
    status,
    tone,
    headline,
    detail,
    nextAction,
    routeLabel,
    canRecordConfirmed: hasEvidenceRefs,
    checks: [
      {
        id: "evidence_refs",
        label: "证据引用",
        status: hasEvidenceRefs ? "passed" : "missing",
        detail: hasEvidenceRefs ? `${refs} 条 refs` : "等待 sourceRefs / price SQL / trade ledger",
      },
      {
        id: "summary",
        label: "人工摘要",
        status: hasSummary ? "passed" : "warning",
        detail: hasSummary ? "已填摘要" : "建议用质检摘要说明判断边界",
      },
      {
        id: "peft_boundary",
        label: "PEFT 边界",
        status: peftBlocked ? "blocked" : peftClean ? "passed" : "warning",
        detail: peftBlocked
          ? "storesRawFacts=true"
          : peftClean
            ? `事实留在 ${factStoreLabel}`
            : "缺 storesRawFacts=false / adapterStores",
      },
      {
        id: "training_route",
        label: "训练去向",
        status: status === "blocked" ? "blocked" : status === "needs_evidence" ? "missing" : "passed",
        detail: routeLabel,
      },
    ],
  }
}

export function collectionTaskFromCollectionResult(result?: StockFeedbackCollectionResult | null): StockFeedbackCollectionTask | null {
  if (!result) return null
  const targetPatternId = result.targetPatternId ?? null
  const targetProfitCredit = result.targetProfitCredit ?? null
  if (!targetPatternId && !targetProfitCredit) return null
  return {
    schema: "stock-feedback-collection-task-v1",
    taskId: result.sourceTaskId ?? undefined,
    draftId: result.sourceDraftId ?? null,
    targetPatternId,
    targetPatternLabel: result.targetPatternLabel ?? targetPatternId,
    targetProfitCredit,
    targetProfitCreditLabel: result.targetProfitCreditLabel ?? targetProfitCredit,
    validationTarget: result.validationTarget ?? null,
    adapterCapability: result.adapterCapability ?? null,
    suggestedFilters: {
      marketPattern: targetPatternId ?? undefined,
      profitCredit: targetProfitCredit ?? undefined,
      validationTarget: result.validationTarget ?? undefined,
      qualityGate: null,
    },
    peftBoundary: result.peftBoundary,
  }
}

function collectionResultRefreshActionFromRoadmap(
  roadmap?: CollectionResultActionRoadmap | null,
): CollectionResultActionRoadmapStep["action"] {
  if (!roadmap) return undefined
  const preferredStepIds: CollectionResultActionRoadmapStep["id"][] = [
    "refresh_artifacts",
    "human_review",
    "rebuild_trajectory",
  ]
  for (const stepId of preferredStepIds) {
    const action = roadmap.steps.find((step) => step.id === stepId)?.action
    if (action?.auditContext.sourceTrajectoryId) return action
  }
  return roadmap.steps.find((step) => step.action?.auditContext.sourceTrajectoryId)?.action
}

export function buildCollectionResultHistoryCard(
  result: StockFeedbackCollectionResult,
  context: CollectionResultActionRoadmapContext = {},
) {
  const roadmap = buildCollectionResultActionRoadmap(result, context)
  const reviewPreview = buildCollectionResultReviewRoutePreview(result)
  const followUp = buildCollectionResultFollowUp(result)
  const humanReviewBridge = buildCollectionResultHumanReviewBridge(roadmap, reviewPreview)
  const targetLabel = result.targetPatternLabel
    ?? result.targetPatternId
    ?? result.targetProfitCreditLabel
    ?? profitCreditBucketLabel(result.targetProfitCredit)
    ?? "未标注采集任务"
  const stockLabel = [result.stock?.name, result.stock?.code].filter(Boolean).join(" ")
  return {
    targetLabel,
    stockLabel,
    evidenceRefCount: collectionResultEvidenceCount(result),
    followUp,
    roadmap,
    reviewPreview,
    humanReviewBridge,
    nextAction: buildCollectionResultNextAction(followUp, roadmap, humanReviewBridge),
    refreshAction: collectionResultRefreshActionFromRoadmap(roadmap),
    collectionTask: collectionTaskFromCollectionResult(result),
  }
}

type CollectionResultHistoryCard = ReturnType<typeof buildCollectionResultHistoryCard>

export function findTrajectoryForCollectionResult<T extends {
  id?: string | null
  sourceRecordId?: string | null
  evidenceState?: {
    collectionResultId?: string | null
    sourceDraftId?: string | null
    sourceTaskId?: string | null
  } | null
  collectionState?: {
    sourceDraftId?: string | null
    sourceTaskId?: string | null
  } | null
}>(trajectories: T[] = [], result?: StockFeedbackCollectionResult | null): T | null {
  if (!result) return null
  const resultId = result.id ?? null
  const draftId = result.sourceDraftId ?? null
  const taskId = result.sourceTaskId ?? null
  if (resultId) {
    const direct = trajectories.find((trajectory) => (
      trajectory.sourceRecordId === resultId ||
      trajectory.evidenceState?.collectionResultId === resultId
    ))
    if (direct) return direct
  }
  return trajectories.find((trajectory) => (
    Boolean(draftId && (trajectory.evidenceState?.sourceDraftId === draftId || trajectory.collectionState?.sourceDraftId === draftId)) ||
    Boolean(taskId && (trajectory.evidenceState?.sourceTaskId === taskId || trajectory.collectionState?.sourceTaskId === taskId))
  )) ?? null
}

const TARGETS: Array<{ id: ValidationTarget; label: string }> = [
  { id: "all", label: "全部" },
  { id: "expectation_trade", label: "预期交易" },
  { id: "fundamental_closure", label: "基本面兑现" },
  { id: "priced_in_risk", label: "priced-in" },
  { id: "disconfirmation", label: "失败归因" },
]

const TARGET_LABELS: Record<string, string> = {
  expectation_trade: "预期交易",
  fundamental_closure: "基本面兑现",
  priced_in_risk: "priced-in",
  disconfirmation: "失败归因",
}

const GATE_LABELS: Record<string, string> = {
  expectation_validated: "预期已交易",
  fundamental_validated: "基本面兑现",
  priced_in_validated: "后手风险",
  disconfirmed_validated: "失败样本",
  needs_evidence: "待补证",
  review_required: "待复核",
}

const QUALITY_GATE_CHECK_LABELS: Record<string, { label: string; detail: string }> = {
  crowdedHeat: {
    label: "热度拥挤",
    detail: "THS/东财热度 top100 或 crowded heat signal",
  },
  relayEvidence: {
    label: "接力证据",
    detail: "涨停、龙虎榜、连板或封单结构命中",
  },
  negativeExecution: {
    label: "负反馈",
    detail: "亏损、方向对买点错、失败或大回撤",
  },
  entryRiskText: {
    label: "后手文本",
    detail: "假设/离场理由含后手、追涨、接力或赔率压缩",
  },
}

const QUALITY_GATE_CHECK_ORDER = ["crowdedHeat", "relayEvidence", "negativeExecution", "entryRiskText"]

export function qualityGateCheckEntries(checkResults?: Record<string, boolean> | null): QualityGateCheckEntry[] {
  if (!checkResults) return []
  const keys = [
    ...QUALITY_GATE_CHECK_ORDER.filter((key) => key in checkResults),
    ...Object.keys(checkResults).filter((key) => !QUALITY_GATE_CHECK_ORDER.includes(key)).sort(),
  ]
  return keys.map((key) => {
    const copy = QUALITY_GATE_CHECK_LABELS[key]
    return {
      id: key,
      label: copy?.label ?? key,
      passed: checkResults[key] === true,
      detail: copy?.detail ?? "质量门检查项",
    }
  })
}

const PROFIT_OUTCOME_LABELS: Record<string, string> = {
  profitable: "收益为正",
  loss: "亏损",
  flat: "持平",
  market_validated_unrealized: "已验证未结算",
  direction_right_entry_risk: "方向对但买点风险",
  failed_or_unprofitable: "失败/未盈利",
  unknown: "未记录",
}

const PROFIT_FILTERS: Array<{ id: ProfitFeedbackSignalFilter; label: string }> = [
  { id: "all", label: "全部反馈" },
  { id: "profitable", label: "盈利支持" },
  { id: "risk_negative", label: "风险/负样本" },
  { id: "pending", label: "待结算" },
]

const REVIEW_ACTION_FILTERS: Array<{
  id: ReviewActionFilter
  label: string
  detail: string
  tone: "neutral" | "good" | "warn"
}> = [
  { id: "all", label: "全部待审", detail: "全部 pending review", tone: "neutral" },
  { id: "route_to_preference", label: "偏好/负样本", detail: "失败、priced-in、买点错优先进入 eval/preference", tone: "warn" },
  { id: "needs_evidence", label: "补证", detail: "先补 sourceRefs、价格路径和 tool state", tone: "warn" },
  { id: "approve_for_adapter", label: "adapter 正样本", detail: "仅人审确认后进入正向 adapter 候选", tone: "good" },
  { id: "approve_paper_adapter_candidate", label: "paper 正样本", detail: "模拟盈利经人审后低权重进入 adapter 候选", tone: "warn" },
]

const REVIEW_ACTION_FILTER_ACTIONS: Record<Exclude<ReviewActionFilter, "all">, string[]> = {
  route_to_preference: ["route_to_preference", "mark_priced_in", "mark_entry_wrong", "reject_for_adapter"],
  needs_evidence: ["needs_evidence"],
  approve_for_adapter: ["approve_for_adapter"],
  approve_paper_adapter_candidate: ["approve_paper_adapter_candidate"],
}

const VISIBLE_REVIEW_ACTIONS = new Set([
  "approve_for_adapter",
  "approve_paper_adapter_candidate",
  "route_to_eval",
  "route_to_preference",
  "route_to_sft",
  "needs_evidence",
  "reject_for_adapter",
  "mark_entry_wrong",
  "mark_priced_in",
])

const PROFIT_REVIEW_WORKLIST_DEFINITIONS: Array<{
  id: ProfitFeedbackReviewWorklistId
  label: string
  filter: ProfitFeedbackSignalFilter
  outcomes: string[]
  fallbackAction: string
  tone: ProfitFeedbackReviewWorklistItem["tone"]
}> = [
  {
    id: "profitable",
    label: "盈利支持",
    filter: "profitable",
    outcomes: ["profitable"],
    fallbackAction: "approve_for_adapter",
    tone: "good",
  },
  {
    id: "entry_risk",
    label: "买点/赔率风险",
    filter: "risk_negative",
    outcomes: ["direction_right_entry_risk"],
    fallbackAction: "mark_entry_wrong",
    tone: "warn",
  },
  {
    id: "loss_negative",
    label: "亏损负样本",
    filter: "risk_negative",
    outcomes: ["loss", "failed_or_unprofitable"],
    fallbackAction: "route_to_preference",
    tone: "danger",
  },
  {
    id: "pending",
    label: "待结算",
    filter: "pending",
    outcomes: ["flat", "market_validated_unrealized"],
    fallbackAction: "route_to_eval",
    tone: "neutral",
  },
]

const BENCHMARK_GAP_BUCKET_PRIORITY: Record<string, number> = {
  profit_credit: 0,
  market_pattern: 1,
  validation_target: 2,
  profit_outcome: 3,
}

function validationTargetFromId(id?: string | null): ValidationTarget | undefined {
  return TARGETS.some((item) => item.id === id && item.id !== "all") ? id as ValidationTarget : undefined
}

export function buildBenchmarkGapActions(
  dynamicBenchmark?: StockFeedbackStatus["dynamicBenchmark"] | null,
  radar?: StockFeedbackPatternRadar | null,
): BenchmarkGapAction[] {
  const gaps = dynamicBenchmark?.coverageGaps ?? []
  const patternById = new Map((radar?.items ?? []).map((item) => [item.id, item]))
  return gaps.map((gap): BenchmarkGapAction => {
    const id = gap.id ?? `${gap.bucket ?? "gap"}`
    const label = gap.label || profitCreditBucketLabel(gap.id)
    if (gap.bucket === "profit_credit") {
      const configs: Record<string, Partial<BenchmarkGapAction>> = {
        pattern_execution_supported: {
          detail: "缺真实盈利、低回撤和进出场节奏闭环；人审后再提升 adapter 权重。",
          primaryActionLabel: "筛选盈利反馈",
          tone: "good",
          target: "expectation_trade",
          profitFeedbackFilter: "profitable",
        },
        execution_risk_negative: {
          detail: "缺方向对但买点、仓位或止损导致亏损的负样本；优先进入 eval/preference。",
          primaryActionLabel: "筛选风险负样本",
          tone: "warn",
          target: "priced_in_risk",
          profitFeedbackFilter: "risk_negative",
        },
        failed_expectation_negative: {
          detail: "缺无承接、一日游或预期证伪的失败归因样本；训练模型识别伪催化。",
          primaryActionLabel: "切到失败归因",
          tone: "danger",
          target: "disconfirmation",
          profitFeedbackFilter: "risk_negative",
        },
      }
      const config = configs[id] ?? {}
      return {
        id: `profit_credit:${id}`,
        bucket: gap.bucket,
        label,
        detail: gap.detail || config.detail || "补齐收益归因样本后，再让 LoRA 学可复用执行策略。",
        primaryActionLabel: config.primaryActionLabel ?? "筛选收益反馈",
        tone: config.tone ?? "neutral",
        target: config.target,
        profitFeedbackFilter: config.profitFeedbackFilter,
        profitCredit: id,
        recommendedAction: gap.recommendedAction,
      }
    }
    if (gap.bucket === "market_pattern") {
      const pattern = patternById.get(id)
      return {
        id: `market_pattern:${id}`,
        bucket: gap.bucket,
        label,
        detail: pattern?.collectionTask?.goal || pattern?.distillationHint || "缺少该手法模式样本，可从模式雷达生成补样本任务。",
        primaryActionLabel: "查看模式任务",
        tone: "warn",
        target: validationTargetFromId(pattern?.collectionTask?.validationTarget ?? undefined),
        patternId: id,
        recommendedAction: gap.recommendedAction,
      }
    }
    if (gap.bucket === "validation_target") {
      const target = validationTargetFromId(id)
      return {
        id: `validation_target:${id}`,
        bucket: gap.bucket,
        label: target ? TARGET_LABELS[target] ?? label : label,
        detail: "缺少该训练目标的 benchmark case，先切到对应目标检查是否需要补证或重建轨迹。",
        primaryActionLabel: "切到目标",
        tone: "neutral",
        target,
        recommendedAction: gap.recommendedAction,
      }
    }
    if (gap.bucket === "profit_outcome") {
      const profitFeedbackFilter: ProfitFeedbackSignalFilter = id === "profitable"
        ? "profitable"
        : id === "loss"
          ? "risk_negative"
          : "pending"
      return {
        id: `profit_outcome:${id}`,
        bucket: gap.bucket,
        label: PROFIT_OUTCOME_LABELS[id] ?? label,
        detail: "缺少真实盈亏反馈，先筛收益反馈并把样本分流到 adapter、eval 或 preference。",
        primaryActionLabel: "筛选收益反馈",
        tone: id === "profitable" ? "good" : "warn",
        profitFeedbackFilter,
        recommendedAction: gap.recommendedAction,
      }
    }
    return {
      id: `${gap.bucket ?? "gap"}:${id}`,
      bucket: gap.bucket,
      label,
      detail: gap.detail || "补齐该覆盖缺口后再生成 benchmark。",
      primaryActionLabel: "查看缺口",
      tone: "neutral",
      recommendedAction: gap.recommendedAction,
    }
  }).sort((a, b) => (
    (BENCHMARK_GAP_BUCKET_PRIORITY[a.bucket ?? ""] ?? 9) - (BENCHMARK_GAP_BUCKET_PRIORITY[b.bucket ?? ""] ?? 9) ||
    a.label.localeCompare(b.label)
  ))
}

const DYNAMIC_TEST_SET_BUCKET_PRIORITY: Record<string, number> = {
  profit_credit: 0,
  profit_outcome: 1,
  market_pattern: 2,
  validation_target: 3,
}

const DYNAMIC_TEST_SET_PROFIT_CREDIT_PRIORITY: Record<string, number> = {
  execution_risk_negative: 0,
  failed_expectation_negative: 1,
  pattern_execution_supported: 2,
  unsettled_feedback_pending: 3,
}

function dynamicTestSetActionPriority(action: BenchmarkGapAction) {
  const bucketPriority = DYNAMIC_TEST_SET_BUCKET_PRIORITY[action.bucket ?? ""] ?? 9
  if (action.bucket === "profit_credit") {
    return bucketPriority * 100 + (DYNAMIC_TEST_SET_PROFIT_CREDIT_PRIORITY[action.profitCredit ?? ""] ?? 50)
  }
  if (action.bucket === "profit_outcome") {
    if (action.profitFeedbackFilter === "risk_negative") return bucketPriority * 100
    if (action.profitFeedbackFilter === "profitable") return bucketPriority * 100 + 10
  }
  return bucketPriority * 100 + action.label.localeCompare(action.id)
}

function dynamicTestSetRouteLabel(action: BenchmarkGapAction) {
  if (action.profitCredit === "pattern_execution_supported") return "人审后 adapter 正样本"
  if (["execution_risk_negative", "failed_expectation_negative"].includes(action.profitCredit ?? "")) return "eval/preference/负样本"
  if (action.bucket === "profit_outcome") return "收益反馈 -> 归因 -> 分流"
  if (action.bucket === "market_pattern") return "采集单 -> 轨迹 -> Benchmark"
  if (action.bucket === "validation_target") return "目标筛选 -> 补证/标注 -> Benchmark"
  return "补样本 -> Benchmark"
}

function dynamicTestSetReason(action: BenchmarkGapAction) {
  if (action.profitCredit === "execution_risk_negative") {
    return "先补方向对但买点、仓位或止损错误的真实反馈，避免模型把追涨当成好决策。"
  }
  if (action.profitCredit === "failed_expectation_negative") {
    return "补无承接、一日游或预期证伪样本，让模型学会识别伪催化。"
  }
  if (action.profitCredit === "pattern_execution_supported") {
    return "补真实盈利、低回撤和进出场节奏，正向 adapter 只学习可复用执行纪律。"
  }
  if (action.bucket === "profit_outcome") {
    return "真实盈亏反馈能把同一方向拆成正样本、买点错和失败归因。"
  }
  if (action.bucket === "market_pattern") {
    return "手法模式缺样本会让 Benchmark 只会考主题方向，不会考买点、承接和扩散节奏。"
  }
  if (action.bucket === "validation_target") {
    return "训练目标缺口会让 eval 失衡，先补齐目标后再比较 adapter 行为。"
  }
  return "补齐覆盖缺口后再让训练批次吸收该类行为。"
}

export function buildDynamicTestSetPlan(actions: BenchmarkGapAction[] = []): DynamicTestSetPlan {
  const sorted = actions.slice().sort((left, right) => (
    dynamicTestSetActionPriority(left) - dynamicTestSetActionPriority(right) ||
    left.label.localeCompare(right.label)
  ))
  const counts = actions.reduce<Record<string, number>>((acc, action) => {
    const key = action.bucket ?? "coverage"
    acc[key] = (acc[key] ?? 0) + 1
    return acc
  }, {})
  const hasProfitFeedbackGap = sorted.some((action) => ["profit_credit", "profit_outcome"].includes(action.bucket ?? ""))
  const hasPatternGap = sorted.some((action) => action.bucket === "market_pattern")
  const headline = hasProfitFeedbackGap
    ? "下一批先补收益/风险反馈"
    : hasPatternGap
      ? "下一批先补手法模式覆盖"
      : sorted.length > 0
        ? "下一批先补训练目标覆盖"
        : "动态测试集覆盖暂稳"
  const detail = sorted.length > 0
    ? "按真实收益反馈、手法模式和训练目标缺口排优先级；事实和交易数据仍留在 retrieval/tool state，只让样本沉淀可复用行为。"
    : "暂未发现 Benchmark 覆盖缺口；继续等待新轨迹、收益反馈和人工 review 回流。"
  return {
    headline,
    detail,
    totalGaps: actions.length,
    counts,
    steps: sorted.slice(0, 6).map((action, index) => ({
      id: action.id,
      rank: index + 1,
      label: action.label,
      bucket: action.bucket,
      bucketLabel: benchmarkGapBucketLabel(action.bucket),
      detail: action.detail,
      reason: dynamicTestSetReason(action),
      routeLabel: dynamicTestSetRouteLabel(action),
      primaryActionLabel: action.primaryActionLabel,
      tone: action.tone,
      target: action.target,
      profitFeedbackFilter: action.profitFeedbackFilter,
      profitCredit: action.profitCredit,
      patternId: action.patternId,
      recommendedAction: action.recommendedAction,
      action,
    })),
  }
}

export function visibleReviewActionOptions<T extends { action?: string | null }>(actionOptions: T[] = []) {
  return actionOptions.filter((option) => VISIBLE_REVIEW_ACTIONS.has(option.action ?? ""))
}

export interface PaperTradeRecordDraft {
  track: "rule_baseline" | "llm_discretionary"
  validationTarget: Exclude<ValidationTarget, "all">
  stockCode: string
  stockName: string
  asOfDate: string
  sourceQuestionId: string
  sourceTrajectoryId: string
  hypothesis: string
  expectedMove: string
  entryDate: string
  entryPrice: string
  entryTiming: string
  exitDate: string
  exitPrice: string
  exitTiming: string
  exitReason: string
  positionSizing: string
  realizedPnlPct: string
  maxDrawdownPct: string
  holdingDays: string
  autoMarketEvidence: boolean
  autoMicrostructureEvidence: boolean
  microstructureDate: string
  marketEvidenceProvider: "stock_daily_sql" | "tushare" | "auto"
  marketEvidenceBenchmarkCode: string
  priceSqlRef: string
  marketDataRef: string
  marketEvidenceSource: string
  marketEvidenceEndDate: string
  marketEvidenceLookaheadDays: string
  marketEvidenceRows: string
  periodReturnPct: string
  relativeStrength: string
  relativeStrengthBasis: string
  turnoverChange: string
  followThrough1d: string
  followThrough3d: string
  followThrough5d: string
  maxDrawdownInHolding: string
  sourceRefs: string
  evidenceRefs: string
}

export interface PaperTradeSettlementDraft {
  paperTradeId: string
  exitDate: string
  exitPrice: string
  exitTiming: string
  exitReason: string
  positionSizing: string
  entryTiming: string
  realizedPnlPct: string
  maxDrawdownPct: string
  holdingDays: string
  autoMarketEvidence: boolean
  autoMicrostructureEvidence: boolean
  marketEvidenceProvider: "stock_daily_sql" | "tushare" | "auto"
  marketEvidenceBenchmarkCode: string
  marketEvidenceEndDate: string
  marketEvidenceLookaheadDays: string
  priceSqlRef: string
  marketDataRef: string
  marketEvidenceSource: string
  marketEvidenceRows: string
  periodReturnPct: string
  relativeStrength: string
  relativeStrengthBasis: string
  turnoverChange: string
  followThrough1d: string
  followThrough3d: string
  followThrough5d: string
  maxDrawdownInHolding: string
  sourceRefs: string
  evidenceRefs: string
}

export interface PaperTradeRecordReadiness {
  ready: boolean
  missing: string[]
  detail: string
}

interface PaperTradeNativeQuery {
  language?: string | null
  summary?: string | null
  table?: string | null
  limit?: number | null
  tickerCandidates?: string[] | null
}

export interface PaperTradeEvidenceWindowSummary {
  tone: "neutral" | "good" | "warn" | "danger"
  label: string
  expectedWindow: string
  displayedWindow: string
  rowLabel: string
  noFutureDataLabel: string
  nativeQuery: string
  detail: string
}

export interface PaperTradePrefillTrajectory {
  id: string
  sourceRecordId?: string | null
  validationTarget?: string | null
  hypothesis?: string | null
  question?: string | null
  summary?: string | null
  stock?: { name?: string | null; code?: string | null; label?: string | null } | null
  sourceRefs?: string[]
  eventTimeline?: Array<{ at?: string | null; ref?: string | null }>
  evidenceState?: {
    asOfDate?: string | null
    sourceDraftId?: string | null
    sourceTaskId?: string | null
    confirmedEvidenceRefs?: string[]
    marketEvidence?: StockFeedbackMarketEvidence | null
  } | null
  paperTradeState?: {
    marketEvidence?: StockFeedbackMarketEvidence | null
  } | null
  profitFeedback?: {
    entryTiming?: string | null
    exitTiming?: string | null
    positionSizing?: string | null
    realizedPnlPct?: number | null
    maxDrawdownPct?: number | null
    holdingDays?: number | null
  } | null
  distillationSignals?: {
    decisionStrategy?: string | null
    behavior?: string | null
  } | null
}

function normalizeProbeDate(value?: string | null) {
  const text = String(value ?? "").trim()
  const compact = text.match(/\d{4}-?\d{2}-?\d{2}/)?.[0]?.replace(/-/g, "")
  if (!compact || compact.length !== 8) return ""
  return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`
}

function compactProbeDate(value?: string | null) {
  return normalizeProbeDate(value).replace(/-/g, "")
}

function normalizeProbeStockCode(value?: string | null) {
  const text = String(value ?? "").trim().toUpperCase()
  const prefixed = text.match(/^(SZ|SH|BJ)(\d{6})$/)
  if (prefixed) return `${prefixed[2]}.${prefixed[1]}`
  const dotted = text.match(/^(\d{6})\.(SZ|SH|BJ)$/)
  if (dotted) return `${dotted[1]}.${dotted[2]}`
  return text
}

export function buildTushareDataSourceProbeArgs(context?: DataSourceProbeContext | null) {
  const args: string[] = ["--tushare-timeout-ms", "15000"]
  const stockCode = String(context?.stock?.code ?? "").trim()
  if (stockCode) args.push("--stock-code", stockCode)
  const eventDate = context?.eventTimeline?.find((item) => normalizeProbeDate(item.at))?.at ?? ""
  const tradeDate = normalizeProbeDate(context?.evidenceState?.asOfDate) || normalizeProbeDate(eventDate)
  if (tradeDate) args.push("--trade-date", tradeDate)
  return args
}

export function summarizeDataSourceProbe(probe?: DataSourceProbeResult | null): DataSourceProbeSummary {
  if (!probe) {
    return {
      tone: "neutral",
      headline: "Tushare 待检查",
      detail: "等待外部行情、热榜和龙虎榜数据源健康检查",
      badge: "待检查",
    }
  }
  const coverage = probe.coverage
  const total = coverage?.total ?? probe.endpoints?.length ?? 0
  const ok = coverage?.ok ?? probe.endpoints?.filter((endpoint) => endpoint.status === "ok").length ?? 0
  const auth = probe.credentialStatus?.auth ?? "unknown"
  const query = [probe.query?.stockCode, probe.query?.tradeDate].filter(Boolean).join(" / ")
  const coverageText = total > 0 ? `${ok}/${total} 通过` : "无 endpoint 覆盖"
  const suffix = [coverageText, `auth=${auth}`, query].filter(Boolean).join(" · ")
  if (probe.status === "ok") {
    return { tone: "good", headline: "Tushare 可用", detail: suffix, badge: "可用" }
  }
  if (probe.status === "partial") {
    return { tone: "warn", headline: "Tushare 部分可用", detail: suffix, badge: "部分" }
  }
  if (probe.status === "unavailable" || probe.credentialStatus?.configured === false) {
    return { tone: "danger", headline: "Tushare 未配置", detail: suffix, badge: "未配置" }
  }
  return { tone: "danger", headline: "Tushare 检查失败", detail: suffix, badge: "失败" }
}

export function buildEvidenceQueueSummary({
  tasks = [],
  results = [],
  dlq = [],
  sources = [],
}: {
  tasks?: StockFeedbackEvidenceTask[]
  results?: StockFeedbackEvidenceResult[]
  dlq?: StockFeedbackEvidenceDlqEntry[]
  sources?: StockFeedbackEvidenceSourceHealth[]
}): EvidenceQueueSummary {
  const pending = tasks.filter((task) => task.status === "pending").length
  const running = tasks.filter((task) => task.status === "running").length
  const awaitingReviewTasks = tasks.filter((task) => task.status === "awaiting_review").length
  const completed = tasks.filter((task) => task.status === "completed").length
  const failed = tasks.filter((task) => task.status === "failed").length
  const dlqTasks = tasks.filter((task) => task.status === "dlq").length
  const awaitingReviewResults = results.filter((result) => result.status === "awaiting_review").length
  const openDlq = dlq.filter((entry) => entry.status === "open").length
  const sourceOpenCircuits = sources.filter((source) => source.circuitStatus === "open").length
  const awaitingReview = awaitingReviewTasks + awaitingReviewResults

  if (openDlq > 0 || dlqTasks > 0) {
    return {
      pending,
      running,
      awaitingReview,
      completed,
      failed,
      dlq: dlqTasks,
      openDlq,
      sourceTotal: sources.length,
      sourceOpenCircuits,
      nextAction: "repair_dlq",
      headline: "Evidence Queue 有死信待处理",
      detail: `DLQ ${openDlq} 条；先 retry 恢复可补证任务，或 discard 关闭错误任务。`,
      tone: "danger",
    }
  }
  if (awaitingReview > 0) {
    return {
      pending,
      running,
      awaitingReview,
      completed,
      failed,
      dlq: dlqTasks,
      openDlq,
      sourceTotal: sources.length,
      sourceOpenCircuits,
      nextAction: "review_results",
      headline: "Evidence Queue 等待人审",
      detail: `${awaitingReview} 条结果需要确认、拒绝或继续补证后再进入训练分流。`,
      tone: "warn",
    }
  }
  if (pending > 0 || running > 0) {
    return {
      pending,
      running,
      awaitingReview,
      completed,
      failed,
      dlq: dlqTasks,
      openDlq,
      sourceTotal: sources.length,
      sourceOpenCircuits,
      nextAction: "run_queue",
      headline: "Evidence Queue 可以运行",
      detail: `${pending} 条 pending；运行后会生成 EvidenceResult，再由 quality gate 和 HumanGate 分流。`,
      tone: "neutral",
    }
  }
  if (sourceOpenCircuits > 0) {
    return {
      pending,
      running,
      awaitingReview,
      completed,
      failed,
      dlq: dlqTasks,
      openDlq,
      sourceTotal: sources.length,
      sourceOpenCircuits,
      nextAction: "watch_sources",
      headline: "数据源健康需要观察",
      detail: `${sourceOpenCircuits} 个 source circuit open；先检查外部接口或降级 fallback。`,
      tone: "warn",
    }
  }
  return {
    pending,
    running,
    awaitingReview,
    completed,
    failed,
    dlq: dlqTasks,
    openDlq,
    sourceTotal: sources.length,
    sourceOpenCircuits,
    nextAction: "idle",
    headline: completed > 0 ? "Evidence Queue 当前闭环" : "Evidence Queue 暂无任务",
    detail: completed > 0 ? `${completed} 条 task 已完成；可继续 review / Benchmark / LoRA-ready。` : "从假设、自提问或补证任务生成 EvidenceTask 后再运行队列。",
    tone: completed > 0 ? "good" : "neutral",
  }
}

export function buildEntryPriceSuggestionFromProbe(
  probe?: DataSourceProbeResult | null,
  draft?: Pick<PaperTradeRecordDraft, "stockCode" | "entryDate" | "asOfDate"> | null,
): EntryPriceSuggestionPresentation | null {
  const suggestion = probe?.entryPriceSuggestion
  const price = Number(suggestion?.price)
  if (!suggestion || !Number.isFinite(price) || price <= 0) return null
  const suggestionStock = normalizeProbeStockCode(suggestion.stockCode)
  const draftStock = normalizeProbeStockCode(draft?.stockCode)
  if (draftStock && suggestionStock && draftStock !== suggestionStock) return null
  const suggestionDate = compactProbeDate(suggestion.tradeDate ?? suggestion.asOfDate)
  const draftDate = compactProbeDate(draft?.entryDate) || compactProbeDate(draft?.asOfDate)
  if (draftDate && suggestionDate && draftDate !== suggestionDate) return null
  const value = String(price)
  const priceTypeLabel = suggestion.priceType === "open" ? "开盘价" : "收盘价"
  const ref = String(suggestion.ref ?? "").trim()
  const source = String(suggestion.source ?? "tushare:daily").trim()
  const provider = String(suggestion.provider ?? "tushare").trim()
  const target = [suggestionStock, suggestionDate].filter(Boolean).join("/")
  return {
    label: `${priceTypeLabel} ${value}`,
    detail: [provider, target, ref].filter(Boolean).join(" · "),
    value,
    ref,
    provider,
    source,
    rowCount: typeof suggestion.rowCount === "number" && Number.isFinite(suggestion.rowCount) ? suggestion.rowCount : null,
  }
}

export function buildPaperTradeEntryPriceSuggestionPatch(
  draft: Pick<PaperTradeRecordDraft, "priceSqlRef" | "marketEvidenceSource">,
  suggestion: EntryPriceSuggestionPresentation,
): Partial<PaperTradeRecordDraft> {
  return {
    entryPrice: suggestion.value,
    priceSqlRef: draft.priceSqlRef?.trim() ? draft.priceSqlRef : suggestion.ref,
    marketEvidenceProvider: "tushare",
    marketEvidenceSource: draft.marketEvidenceSource?.trim() ? draft.marketEvidenceSource : suggestion.source,
    autoMarketEvidence: true,
  }
}

export function buildPaperTradeDataSourceGate(
  draft: Pick<PaperTradeRecordDraft, "autoMarketEvidence" | "autoMicrostructureEvidence" | "marketEvidenceProvider">,
  probe?: DataSourceProbeResult | null,
): PaperTradeDataSourceGate {
  const needsTushare = draft.autoMicrostructureEvidence || (draft.autoMarketEvidence && draft.marketEvidenceProvider === "tushare")
  if (!needsTushare) {
    return {
      status: "not_applicable",
      tone: "neutral",
      headline: "数据源门控未启用",
      detail: "当前自动证据不强依赖 Tushare",
      blocksWrite: false,
    }
  }
  if (!probe) {
    return {
      status: "needs_check",
      tone: "warn",
      headline: "建议先检查 Tushare",
      detail: "自动行情或打板证据需要外部数据源；未检查不阻断，但失败会阻断写入。",
      blocksWrite: false,
    }
  }
  const summary = summarizeDataSourceProbe(probe)
  if (probe.status === "ok") {
    return {
      status: "ready",
      tone: "good",
      headline: "Tushare 证据源就绪",
      detail: summary.detail,
      blocksWrite: false,
    }
  }
  if (probe.status === "unavailable" || probe.status === "failed" || probe.credentialStatus?.configured === false) {
    return {
      status: "blocked",
      tone: "danger",
      headline: "Tushare 证据源不可用",
      detail: `${summary.detail}；请先修复 Keychain/API 或改用手工 evidenceRefs。`,
      blocksWrite: true,
    }
  }
  return {
    status: "warning",
    tone: "warn",
    headline: "Tushare 证据源部分可用",
    detail: summary.detail,
    blocksWrite: false,
  }
}

function autoEvidenceCheckLabel(id?: string | null) {
  return {
    market_evidence: "行情证据",
    microstructure_evidence: "微结构证据",
  }[id ?? ""] ?? id ?? "自动证据"
}

function autoEvidenceProviderLabel(provider?: string | null) {
  return {
    tushare: "Tushare",
    tushare_http: "Tushare",
    tushare_mcp: "Tushare MCP",
    stock_daily_sql: "price SQL",
    auto: "自动选择",
  }[provider ?? ""] ?? provider ?? "未标注来源"
}

function autoEvidenceStatusLabel(status?: string | null) {
  return {
    ok: "通过",
    ready: "就绪",
    blocked: "阻断",
    unavailable: "不可用",
    failed: "失败",
    missing: "缺失",
    skipped: "跳过",
    partial: "部分可用",
    not_requested: "未请求",
  }[status ?? ""] ?? status ?? "未知"
}

function autoEvidenceEntryTone(check: PaperTradeAutoEvidenceGateCheck): PaperTradeAutoEvidenceGateEntry["tone"] {
  if (check.passed === true) return "good"
  if (["unavailable", "failed", "missing", "blocked"].includes(check.status ?? "")) return "danger"
  return "warn"
}

export function autoEvidenceGateCheckEntries(gate?: PaperTradeAutoEvidenceGate | null): PaperTradeAutoEvidenceGateEntry[] {
  return (gate?.checks ?? []).map((check, index) => {
    const id = check.id ?? `auto_evidence_${index + 1}`
    const label = autoEvidenceCheckLabel(check.id)
    const providerLabel = autoEvidenceProviderLabel(check.provider)
    const status = check.status ?? (check.passed === true ? "ok" : "missing")
    const statusLabel = autoEvidenceStatusLabel(status)
    const warning = check.warning ? ` · ${check.warning}` : ""
    return {
      id,
      label,
      providerLabel,
      status,
      statusLabel,
      passed: check.passed === true,
      detail: `${providerLabel} · ${statusLabel}${warning}`,
      tone: autoEvidenceEntryTone(check),
    }
  })
}

export function summarizePaperTradeAutoEvidenceGate(gate?: PaperTradeAutoEvidenceGate | null): PaperTradeAutoEvidenceGateSummary {
  const entries = autoEvidenceGateCheckEntries(gate)
  const detail = gate?.detail?.trim() || (entries.length > 0
    ? entries.map((entry) => `${entry.label}:${entry.statusLabel}`).join("；")
    : "等待 paper trade 自动证据回流")
  if (!gate) {
    return {
      tone: "neutral",
      headline: "自动证据未回流",
      detail,
      badge: "待回流",
      blocksWrite: false,
      entries,
    }
  }
  if (gate.blocksWrite === true || gate.status === "blocked") {
    return {
      tone: "danger",
      headline: "自动证据阻断",
      detail,
      badge: "阻断写入",
      blocksWrite: true,
      entries,
    }
  }
  if (gate.status === "ready") {
    return {
      tone: "good",
      headline: "自动证据就绪",
      detail,
      badge: "可复核",
      blocksWrite: false,
      entries,
    }
  }
  if (gate.status === "not_requested") {
    return {
      tone: "neutral",
      headline: "未请求自动证据",
      detail,
      badge: "未请求",
      blocksWrite: false,
      entries,
    }
  }
  return {
    tone: "warn",
    headline: "自动证据待确认",
    detail,
    badge: autoEvidenceStatusLabel(gate.status),
    blocksWrite: false,
    entries,
  }
}

export function buildPaperTradeWriteFollowUp(
  result?: CommandResult | null,
  context: { writeCompleted?: boolean; matchedTrajectoryId?: string | null } = {},
): PaperTradeWriteFollowUp | null {
  const trade = result?.paperTrade
  if (!trade) return null
  const paperTradeId = trade.id ?? null
  const matchedTrajectoryId = context.matchedTrajectoryId ?? null
  const wrote = context.writeCompleted === true || result?.dryRun === false || Boolean(result?.writeResult)
  const gateSummary = summarizePaperTradeAutoEvidenceGate(trade.autoEvidenceGate ?? result?.autoEvidenceGate ?? null)
  const artifactRefreshPlan = result?.artifactRefreshPlan ?? trade.artifactRefreshPlan ?? null

  if (!wrote) {
    if (gateSummary.blocksWrite) {
      return {
        tone: "danger",
        headline: "预览发现自动证据阻断",
        detail: `${gateSummary.detail}；先补 sourceRefs / price SQL / Tushare 后再写入，避免把无证据收益推入训练。`,
        badge: "不能写入",
        paperTradeId,
        matchedTrajectoryId: null,
        artifactRefreshPlan,
        nextSteps: [
          "补齐 sourceRefs / evidenceRefs / price SQL / Tushare 数据源",
          "重新预览，确认自动证据不再阻断",
          "再写入 paper_trade 并重建 trajectory",
        ],
        actions: [],
      }
    }
    return {
      tone: "neutral",
      headline: "模拟交易预览已生成",
      detail: "当前只是 dry-run；确认 asOfDate、noFutureData、收益/回撤/持有期和证据引用后，再写入并重建轨迹。",
      badge: "dry-run",
      paperTradeId,
      matchedTrajectoryId: null,
      artifactRefreshPlan,
      nextSteps: [
        "检查假设、买卖理由和 sourceRefs 是否只使用当时可见信息",
        "确认收益、最大回撤、持有天数和执行纪律字段",
        "点击写入并重建，生成可人审的 stock-feedback trajectory",
      ],
      actions: [],
    }
  }

  if (matchedTrajectoryId) {
    return {
      tone: "good",
      headline: "已写入并定位训练轨迹",
      detail: `paper_trade 已重建为 ${matchedTrajectoryId}；下一步在右侧详情做人审分流，再刷新 Benchmark / LoRA-ready。`,
      badge: "轨迹已选中",
      paperTradeId,
      matchedTrajectoryId,
      artifactRefreshPlan,
      nextSteps: [
        "在右侧详情复核自动证据闸门、收益归因和 PEFT 边界",
        "人审决定进入 adapter 候选、eval/preference 或继续补证",
        "人审后重建轨迹并刷新 LoRA-ready，检查 batch delta",
      ],
      actions: [
        {
          id: "build_benchmark",
          label: "生成 Benchmark",
          detail: "先把 paper_trade 回流轨迹纳入 eval/preference 覆盖。",
          enabled: true,
          tone: "neutral",
        },
        {
          id: "refresh_lora_ready_after_review",
          label: "人审后刷新 LoRA-ready",
          detail: "右侧提交 review 后再刷新，避免未审 paper trade 被直接提权。",
          enabled: false,
          tone: "warn",
        },
      ],
    }
  }

  return {
    tone: "warn",
    headline: "已写入但未定位到训练轨迹",
    detail: "paper_trade 已写入并触发重建，但当前列表未找到对应 trajectory；不要直接提升训练权重，先检查回流引用。",
    badge: "待核对",
    paperTradeId,
    matchedTrajectoryId: null,
    artifactRefreshPlan,
    nextSteps: [
      "运行 stock-feedback verify 检查 paper_trade 与 trajectory 引用",
      "确认 sourceRecordId 或 evidenceState.paperTradeId 能匹配 paper_trade id",
      "重新 build-trajectories --write 后再做人审和 LoRA-ready 刷新",
    ],
    actions: [
      {
        id: "verify_refs",
        label: "先核对引用",
        detail: "未定位 trajectory 前不能进入 Benchmark 或 LoRA-ready 提权。",
        enabled: false,
        tone: "warn",
      },
    ],
  }
}

export function initialPaperTradeRecordDraft(): PaperTradeRecordDraft {
  return {
    track: "rule_baseline",
    validationTarget: "expectation_trade",
    stockCode: "",
    stockName: "",
    asOfDate: "",
    sourceQuestionId: "",
    sourceTrajectoryId: "",
    hypothesis: "",
    expectedMove: "",
    entryDate: "",
    entryPrice: "",
    entryTiming: "",
    exitDate: "",
    exitPrice: "",
    exitTiming: "",
    exitReason: "",
    positionSizing: "",
    realizedPnlPct: "",
    maxDrawdownPct: "",
    holdingDays: "",
    autoMarketEvidence: true,
    autoMicrostructureEvidence: false,
    microstructureDate: "",
    marketEvidenceProvider: "stock_daily_sql",
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
    followThrough3d: "",
    followThrough5d: "",
    maxDrawdownInHolding: "",
    sourceRefs: "",
    evidenceRefs: "",
  }
}

export function buildPaperTradeRecordReadiness(draft: PaperTradeRecordDraft): PaperTradeRecordReadiness {
  const hasEvidenceRefs = Boolean(draft.evidenceRefs.trim())
  const hasMarketEvidence = draft.autoMarketEvidence || Boolean(draft.priceSqlRef.trim() || draft.marketDataRef.trim())
  const checks = [
    { label: "股票代码或名称", passed: Boolean(draft.stockCode.trim() || draft.stockName.trim()) },
    { label: "asOfDate 证据截止日", passed: Boolean(draft.asOfDate.trim()) },
    { label: "入场日期", passed: Boolean(draft.entryDate.trim()) },
    { label: "入场价格", passed: Boolean(draft.entryPrice.trim()) },
    { label: "sourceRefs", passed: Boolean(draft.sourceRefs.trim()) },
    { label: "evidenceRefs 或行情证据", passed: hasEvidenceRefs || hasMarketEvidence },
  ]
  const missing = checks.filter((check) => !check.passed).map((check) => check.label)
  return {
    ready: missing.length === 0,
    missing,
    detail: missing.length === 0
      ? "可预览或写入 paper_trade；写入后会重建轨迹，但仍需人审后才进入训练权重。"
      : `还缺 ${missing.join("、")}。`,
  }
}

function pushPaperTradeArg(args: string[], flag: string, value?: string | null) {
  const trimmed = value?.trim()
  if (!trimmed) return
  args.push(flag, trimmed)
}

function draftNumber(value?: number | string | null) {
  if (value === null || value === undefined || value === "") return ""
  return String(value)
}

function joinDraftRefs(...refs: Array<string[] | string | null | undefined>) {
  const parts = refs.flatMap((value) => {
    if (Array.isArray(value)) return value
    return String(value ?? "").split(",")
  })
  return [...new Set(parts.map((item) => item.trim()).filter(Boolean))].join(",")
}

export function initialPaperTradeSettlementDraft(): PaperTradeSettlementDraft {
  return {
    paperTradeId: "",
    exitDate: "",
    exitPrice: "",
    exitTiming: "",
    exitReason: "",
    positionSizing: "",
    entryTiming: "",
    realizedPnlPct: "",
    maxDrawdownPct: "",
    holdingDays: "",
    autoMarketEvidence: true,
    autoMicrostructureEvidence: false,
    marketEvidenceProvider: "stock_daily_sql",
    marketEvidenceBenchmarkCode: "000001.SH",
    marketEvidenceEndDate: "",
    marketEvidenceLookaheadDays: "7",
    priceSqlRef: "",
    marketDataRef: "",
    marketEvidenceSource: "",
    marketEvidenceRows: "",
    periodReturnPct: "",
    relativeStrength: "",
    relativeStrengthBasis: "",
    turnoverChange: "",
    followThrough1d: "",
    followThrough3d: "",
    followThrough5d: "",
    maxDrawdownInHolding: "",
    sourceRefs: "",
    evidenceRefs: "",
  }
}

function settlementMarketEvidenceProvider(value?: string | null): PaperTradeSettlementDraft["marketEvidenceProvider"] {
  if (value === "tushare" || value === "auto" || value === "stock_daily_sql") return value
  if (value === "tushare_http" || value === "tushare_mcp") return "tushare"
  return "stock_daily_sql"
}

export function buildPaperTradeSettlementDraftFromTrade(
  trade?: StockFeedbackPaperTradeSummary | null,
  current: PaperTradeSettlementDraft = initialPaperTradeSettlementDraft(),
): PaperTradeSettlementDraft {
  if (!trade) return current
  return {
    ...current,
    paperTradeId: trade.id ?? current.paperTradeId,
    exitDate: trade.exit?.date ?? current.exitDate,
    exitPrice: draftNumber(trade.exit?.price) || current.exitPrice,
    exitTiming: trade.exit?.timing ?? current.exitTiming,
    exitReason: trade.exit?.reason ?? current.exitReason,
    positionSizing: trade.positionSizing ?? current.positionSizing,
    entryTiming: trade.entry?.timing ?? current.entryTiming,
    realizedPnlPct: draftNumber(trade.profitFeedback?.realizedPnlPct) || current.realizedPnlPct,
    maxDrawdownPct: draftNumber(trade.profitFeedback?.maxDrawdownPct ?? trade.marketEvidence?.maxDrawdownInHolding) || current.maxDrawdownPct,
    holdingDays: draftNumber(trade.profitFeedback?.holdingDays) || current.holdingDays,
    autoMarketEvidence: true,
    autoMicrostructureEvidence: current.autoMicrostructureEvidence,
    marketEvidenceProvider: settlementMarketEvidenceProvider(trade.marketEvidenceProvider ?? trade.marketEvidence?.source ?? current.marketEvidenceProvider),
    marketEvidenceBenchmarkCode: trade.marketEvidence?.benchmarkCode ?? (current.marketEvidenceBenchmarkCode || "000001.SH"),
    marketEvidenceEndDate: current.marketEvidenceEndDate,
    marketEvidenceLookaheadDays: current.marketEvidenceLookaheadDays || "7",
    priceSqlRef: trade.marketEvidence?.priceSqlRef ?? current.priceSqlRef,
    marketDataRef: trade.marketEvidence?.marketDataRef ?? current.marketDataRef,
    marketEvidenceSource: trade.marketEvidence?.source ?? current.marketEvidenceSource,
    marketEvidenceRows: draftNumber(trade.marketEvidence?.rows) || current.marketEvidenceRows,
    periodReturnPct: draftNumber(trade.marketEvidence?.periodReturnPct) || current.periodReturnPct,
    relativeStrength: draftNumber(trade.marketEvidence?.relativeStrength) || current.relativeStrength,
    relativeStrengthBasis: trade.marketEvidence?.relativeStrengthBasis ?? current.relativeStrengthBasis,
    turnoverChange: draftNumber(trade.marketEvidence?.turnoverChange) || current.turnoverChange,
    followThrough1d: draftNumber(trade.marketEvidence?.followThrough1d) || current.followThrough1d,
    followThrough3d: draftNumber(trade.marketEvidence?.followThrough3d) || current.followThrough3d,
    followThrough5d: draftNumber(trade.marketEvidence?.followThrough5d) || current.followThrough5d,
    maxDrawdownInHolding: draftNumber(trade.marketEvidence?.maxDrawdownInHolding) || current.maxDrawdownInHolding,
    sourceRefs: joinDraftRefs(current.sourceRefs, trade.sourceRefs),
    evidenceRefs: joinDraftRefs(current.evidenceRefs, trade.evidenceRefs),
  }
}

export function buildPaperTradeSettlementReadiness(draft: PaperTradeSettlementDraft): PaperTradeRecordReadiness {
  const hasEvidenceRefs = Boolean(draft.evidenceRefs.trim())
  const hasMarketEvidence = draft.autoMarketEvidence || Boolean(draft.priceSqlRef.trim() || draft.marketDataRef.trim())
  const checks = [
    { label: "paperTradeId", passed: Boolean(draft.paperTradeId.trim()) },
    { label: "出场日期", passed: Boolean(draft.exitDate.trim()) },
    { label: "出场价格", passed: Boolean(draft.exitPrice.trim()) },
    { label: "evidenceRefs 或行情证据", passed: hasEvidenceRefs || hasMarketEvidence },
  ]
  const missing = checks.filter((check) => !check.passed).map((check) => check.label)
  return {
    ready: missing.length === 0,
    missing,
    detail: missing.length === 0
      ? "可预览或写入 paper_trade 结算；写入后会重建轨迹，但模拟盈利仍需人审后才进入 adapter 候选。"
      : `还缺 ${missing.join("、")}。`,
  }
}

export function buildPaperTradeSettlementArgs(draft: PaperTradeSettlementDraft) {
  const args = [
    "--paper-trade-id",
    draft.paperTradeId.trim(),
    "--exit-date",
    draft.exitDate.trim(),
    "--exit-price",
    draft.exitPrice.trim(),
  ]
  pushPaperTradeArg(args, "--exit-timing", draft.exitTiming)
  pushPaperTradeArg(args, "--exit-reason", draft.exitReason)
  pushPaperTradeArg(args, "--position-sizing", draft.positionSizing)
  pushPaperTradeArg(args, "--entry-timing", draft.entryTiming)
  pushPaperTradeArg(args, "--realized-pnl-pct", draft.realizedPnlPct)
  pushPaperTradeArg(args, "--max-drawdown-pct", draft.maxDrawdownPct)
  pushPaperTradeArg(args, "--holding-days", draft.holdingDays)
  pushPaperTradeArg(args, "--source-refs", draft.sourceRefs)
  pushPaperTradeArg(args, "--evidence-refs", draft.evidenceRefs)
  if (draft.autoMarketEvidence) args.push("--auto-market-evidence")
  if (draft.autoMicrostructureEvidence) args.push("--auto-microstructure-evidence")
  pushPaperTradeArg(args, "--market-evidence-provider", draft.marketEvidenceProvider)
  pushPaperTradeArg(args, "--market-evidence-benchmark-code", draft.marketEvidenceBenchmarkCode)
  pushPaperTradeArg(args, "--market-evidence-lookahead-days", draft.marketEvidenceLookaheadDays)
  pushPaperTradeArg(args, "--market-evidence-end-date", draft.marketEvidenceEndDate)
  pushPaperTradeArg(args, "--price-sql-ref", draft.priceSqlRef)
  pushPaperTradeArg(args, "--market-data-ref", draft.marketDataRef)
  pushPaperTradeArg(args, "--market-evidence-source", draft.marketEvidenceSource)
  pushPaperTradeArg(args, "--market-evidence-rows", draft.marketEvidenceRows)
  pushPaperTradeArg(args, "--period-return-pct", draft.periodReturnPct)
  pushPaperTradeArg(args, "--relative-strength", draft.relativeStrength)
  pushPaperTradeArg(args, "--relative-strength-basis", draft.relativeStrengthBasis)
  pushPaperTradeArg(args, "--turnover-change", draft.turnoverChange)
  pushPaperTradeArg(args, "--follow-through-1d", draft.followThrough1d)
  pushPaperTradeArg(args, "--follow-through-3d", draft.followThrough3d)
  pushPaperTradeArg(args, "--follow-through-5d", draft.followThrough5d)
  pushPaperTradeArg(args, "--max-drawdown-in-holding", draft.maxDrawdownInHolding)
  return args
}

function paperTradeRecordTarget(value?: string | null): PaperTradeRecordDraft["validationTarget"] {
  if (value === "expectation_trade" || value === "fundamental_closure" || value === "priced_in_risk" || value === "disconfirmation") {
    return value
  }
  return "expectation_trade"
}

function paperTradePlanCandidateNeedsEntryPrice(candidate?: StockFeedbackPaperTradePlanCandidate | null) {
  const missing = candidate?.readiness?.missingRequiredFields ?? []
  return candidate?.entry?.price == null || missing.includes("entryPrice")
}

function dateOnly(value?: string | null) {
  return value?.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? ""
}

function compactDateOnly(value?: string | null) {
  const raw = String(value ?? "").trim()
  const match = raw.match(/(\d{4})-?(\d{2})-?(\d{2})/)
  return match ? `${match[1]}-${match[2]}-${match[3]}` : ""
}

function addCalendarDaysUtc(dateText: string, days: number) {
  const match = compactDateOnly(dateText).match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return ""
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function parsePositiveIntText(value: string | number | null | undefined, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback
}

function paperTradeWindowText(startDate?: string | null, endDate?: string | null) {
  const start = compactDateOnly(startDate)
  const end = compactDateOnly(endDate)
  if (start && end) return `${start}..${end}`
  if (start) return `${start}..待定`
  return "等待入场日期"
}

function paperTradeNativeQueryText(query?: PaperTradeNativeQuery | null) {
  if (!query) return ""
  const body = String(query.summary ?? query.table ?? "").trim()
  if (!body) return ""
  const language = String(query.language ?? "").trim()
  return language ? `${language}: ${body}` : body
}

export function buildPaperTradeEvidenceWindow(
  draft: Pick<PaperTradeRecordDraft, "autoMarketEvidence" | "entryDate" | "exitDate" | "marketEvidenceEndDate" | "marketEvidenceLookaheadDays" | "asOfDate">,
  preview?: Pick<CommandResult, "paperTrade" | "marketEvidenceNativeQuery"> | null,
): PaperTradeEvidenceWindowSummary {
  const entryDate = compactDateOnly(draft.entryDate)
  const lookaheadDays = parsePositiveIntText(draft.marketEvidenceLookaheadDays, 7)
  const expectedEndDate = compactDateOnly(draft.marketEvidenceEndDate)
    || compactDateOnly(draft.exitDate)
    || (entryDate ? addCalendarDaysUtc(entryDate, lookaheadDays) : "")
  const expectedWindow = paperTradeWindowText(entryDate, expectedEndDate)
  const trade = preview?.paperTrade
  const marketEvidence = trade?.marketEvidence
  const actualStartDate = compactDateOnly(marketEvidence?.startDate)
  const actualEndDate = compactDateOnly(marketEvidence?.endDate)
  const hasActualWindow = Boolean(actualStartDate || actualEndDate)
  const displayedWindow = hasActualWindow ? paperTradeWindowText(actualStartDate || entryDate, actualEndDate || expectedEndDate) : expectedWindow
  const noFutureData = trade?.evidenceCutoff?.noFutureData === true
  const asOfDate = compactDateOnly(trade?.asOfDate) || compactDateOnly(trade?.evidenceCutoff?.asOfDate) || compactDateOnly(draft.asOfDate)
  const noFutureDataLabel = [noFutureData ? "noFutureData=true" : "", asOfDate ? `asOf=${asOfDate}` : ""].filter(Boolean).join(" · ")
  const rowCount = typeof marketEvidence?.rows === "number" && Number.isFinite(marketEvidence.rows) ? marketEvidence.rows : null
  const nativeQuery = paperTradeNativeQueryText(preview?.marketEvidenceNativeQuery)
  const exceedsExpectedWindow = Boolean(actualEndDate && expectedEndDate && actualEndDate > expectedEndDate)
  if (exceedsExpectedWindow) {
    return {
      tone: "warn",
      label: "实际行情窗口",
      expectedWindow,
      displayedWindow,
      rowLabel: rowCount !== null ? `${rowCount} 行` : "",
      noFutureDataLabel,
      nativeQuery,
      detail: "实际返回窗口超过预期查询范围，写入前请改行情截止日或检查 provider。",
    }
  }
  if (hasActualWindow) {
    return {
      tone: "good",
      label: "实际行情窗口",
      expectedWindow,
      displayedWindow,
      rowLabel: rowCount !== null ? `${rowCount} 行` : "",
      noFutureDataLabel,
      nativeQuery,
      detail: "自动证据已回流；核对实际返回窗口没有越过预期查询范围。",
    }
  }
  return {
    tone: "neutral",
    label: "预计行情窗口",
    expectedWindow,
    displayedWindow: expectedWindow,
    rowLabel: "",
    noFutureDataLabel,
    nativeQuery,
    detail: draft.autoMarketEvidence
      ? "未预览，写入前将按该窗口请求行情证据。"
      : "未启用自动行情证据；如用手工证据，请核对 priceSqlRef / marketDataRef。",
  }
}

function refsText(refs: string[] = []) {
  return Array.from(new Set(refs.map((ref) => ref.trim()).filter(Boolean))).join(",")
}

function keepCurrentOr(next: string | number | null | undefined, current: string) {
  const normalized = next === null || next === undefined ? "" : String(next)
  return normalized.trim() || current
}

function draftNumberText(value?: number | string | null, digits = 4) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return ""
  const factor = 10 ** digits
  return String(Math.round(parsed * factor) / factor)
}

function uniqueCsvText(...values: Array<string | string[] | null | undefined>) {
  const parts = values.flatMap((value) => Array.isArray(value) ? value : String(value ?? "").split(","))
  return Array.from(new Set(parts.map((part) => part.trim()).filter(Boolean))).join(",")
}

function daysBetweenDates(start?: string | null, end?: string | null) {
  const startDate = compactDateOnly(start)
  const endDate = compactDateOnly(end)
  if (!startDate || !endDate) return ""
  const startMs = Date.parse(`${startDate}T00:00:00Z`)
  const endMs = Date.parse(`${endDate}T00:00:00Z`)
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return ""
  return String(Math.max(0, Math.round((endMs - startMs) / 86_400_000)))
}

const PAPER_TRADE_SETTLEMENT_FIELD_LABELS: Partial<Record<keyof PaperTradeRecordDraft, string>> = {
  exitDate: "出场日期",
  exitPrice: "出场价格",
  realizedPnlPct: "收益率",
  maxDrawdownPct: "最大回撤",
  holdingDays: "持有天数",
  marketEvidenceEndDate: "行情截止日",
  marketEvidenceRows: "行情行数",
  priceSqlRef: "价格引用",
  marketDataRef: "行情引用",
  marketEvidenceSource: "行情来源",
  periodReturnPct: "区间收益",
  relativeStrength: "相对强度",
  relativeStrengthBasis: "相对强度口径",
  turnoverChange: "换手变化",
  followThrough1d: "1日承接",
  followThrough3d: "3日承接",
  followThrough5d: "5日承接",
  maxDrawdownInHolding: "持有期回撤",
  evidenceRefs: "证据引用",
  exitTiming: "出场节奏",
  exitReason: "卖出原因",
}

function buildPaperTradeSettlementDiff(
  draft: PaperTradeRecordDraft,
  patch: Partial<PaperTradeRecordDraft>,
): PaperTradePreviewSettlementDiff[] {
  return Object.entries(patch)
    .map(([field, value]) => {
      const key = field as keyof PaperTradeRecordDraft
      const before = String(draft[key] ?? "").trim()
      const after = String(value ?? "").trim()
      if (!after || before === after) return null
      return {
        field,
        label: PAPER_TRADE_SETTLEMENT_FIELD_LABELS[key] ?? field,
        before,
        after,
        action: before ? "update" as const : "fill" as const,
      }
    })
    .filter((item): item is PaperTradePreviewSettlementDiff => Boolean(item))
}

export function buildPaperTradePreviewSettlementSuggestion(
  draft: PaperTradeRecordDraft,
  preview?: CommandResult | null,
): PaperTradePreviewSettlementSuggestion | null {
  const trade = preview?.paperTrade
  const marketEvidence = trade?.marketEvidence
  if (!trade || !marketEvidence) return null
  if (trade.autoEvidenceGate?.blocksWrite === true || trade.marketEvidenceWindow?.exceededExpectedEnd === true) return null
  const exitDate = compactDateOnly(marketEvidence.endDate) || compactDateOnly(trade.exit?.date)
  const exitPrice = draftNumberText(marketEvidence.closeEnd ?? trade.exit?.price)
  const realizedPnlPct = draftNumberText(marketEvidence.periodReturnPct ?? trade.profitFeedback?.realizedPnlPct, 2)
  const maxDrawdownPct = draftNumberText(marketEvidence.maxDrawdownInHolding ?? trade.profitFeedback?.maxDrawdownPct, 2)
  if (!exitDate || !exitPrice || !realizedPnlPct) return null
  const holdingDays = daysBetweenDates(draft.entryDate || trade.entry?.date, exitDate)
  const evidenceRefs = uniqueCsvText(draft.evidenceRefs, trade.evidenceRefs, [
    marketEvidence.priceSqlRef ?? "",
    marketEvidence.marketDataRef ?? "",
    marketEvidence.benchmarkRef ?? "",
  ])
  const patch: Partial<PaperTradeRecordDraft> = {
    exitDate,
    exitPrice,
    realizedPnlPct,
    maxDrawdownPct: maxDrawdownPct || draft.maxDrawdownPct,
    holdingDays: holdingDays || draft.holdingDays,
    marketEvidenceEndDate: exitDate,
    marketEvidenceRows: draftNumberText(marketEvidence.rows, 0) || draft.marketEvidenceRows,
    priceSqlRef: draft.priceSqlRef || marketEvidence.priceSqlRef || "",
    marketDataRef: draft.marketDataRef || marketEvidence.marketDataRef || "",
    marketEvidenceSource: draft.marketEvidenceSource || marketEvidence.source || "",
    periodReturnPct: realizedPnlPct,
    relativeStrength: draftNumberText(marketEvidence.relativeStrength, 2) || draft.relativeStrength,
    relativeStrengthBasis: draft.relativeStrengthBasis || marketEvidence.relativeStrengthBasis || "",
    turnoverChange: draftNumberText(marketEvidence.turnoverChange, 2) || draft.turnoverChange,
    followThrough1d: draftNumberText(marketEvidence.followThrough1d, 2) || draft.followThrough1d,
    followThrough3d: draftNumberText(marketEvidence.followThrough3d, 2) || draft.followThrough3d,
    followThrough5d: draftNumberText(marketEvidence.followThrough5d, 2) || draft.followThrough5d,
    maxDrawdownInHolding: maxDrawdownPct || draft.maxDrawdownInHolding,
    evidenceRefs,
  }
  if (!draft.exitTiming.trim()) patch.exitTiming = "market_evidence_window_close"
  if (!draft.exitReason.trim()) patch.exitReason = "按预览行情窗口结算，用于 paper_trade 训练闭环"
  const diff = buildPaperTradeSettlementDiff(draft, patch)
  if (diff.length === 0) return null
  const detailParts = [
    `exit ${exitDate} @ ${exitPrice}`,
    `pnl ${realizedPnlPct}%`,
    maxDrawdownPct ? `drawdown ${maxDrawdownPct}%` : "",
    holdingDays ? `hold ${holdingDays}d` : "",
  ].filter(Boolean)
  return {
    headline: "可应用预览收益",
    detail: detailParts.join(" · "),
    badge: marketEvidence.source ?? preview?.marketEvidenceProvider ?? "market_evidence",
    patch,
    diff,
  }
}

export function buildPaperTradeSettlementAppliedNotice(
  suggestion?: PaperTradePreviewSettlementSuggestion | null,
): PaperTradeSettlementAppliedNotice | null {
  if (!suggestion || suggestion.diff.length === 0) return null
  const fieldLabels = suggestion.diff.slice(0, 4).map((item) => item.label)
  const extraCount = Math.max(0, suggestion.diff.length - fieldLabels.length)
  const labelText = fieldLabels.length
    ? `包括 ${fieldLabels.join("、")}${extraCount > 0 ? ` 等 ${suggestion.diff.length} 项` : ""}`
    : ""
  return {
    headline: "已应用预览收益",
    detail: [
      `已回填 ${suggestion.diff.length} 个字段`,
      labelText,
      "下一步可预览确认或写入并重建",
    ].filter(Boolean).join("；"),
    badge: suggestion.badge,
    appliedFieldCount: suggestion.diff.length,
    fieldLabels,
  }
}

export function buildPaperTradeDraftFromTrajectory(
  trajectory: PaperTradePrefillTrajectory,
  current: PaperTradeRecordDraft = initialPaperTradeRecordDraft(),
): PaperTradeRecordDraft {
  const asOfDate = dateOnly(trajectory.evidenceState?.asOfDate)
    || dateOnly(trajectory.eventTimeline?.[0]?.at)
  const sourceRefs = refsText([
    ...(trajectory.sourceRefs ?? []),
    trajectory.sourceRecordId ? `trajectory-source:${trajectory.sourceRecordId}` : "",
  ])
  const evidenceRefs = refsText(trajectory.evidenceState?.confirmedEvidenceRefs ?? [])
  const marketEvidence = trajectory.evidenceState?.marketEvidence ?? trajectory.paperTradeState?.marketEvidence ?? null
  return {
    ...current,
    validationTarget: paperTradeRecordTarget(trajectory.validationTarget),
    stockCode: keepCurrentOr(trajectory.stock?.code, current.stockCode),
    stockName: keepCurrentOr(trajectory.stock?.name ?? trajectory.stock?.label, current.stockName),
    asOfDate: keepCurrentOr(asOfDate, current.asOfDate),
    sourceTrajectoryId: keepCurrentOr(trajectory.id, current.sourceTrajectoryId),
    sourceQuestionId: keepCurrentOr(
      trajectory.evidenceState?.sourceDraftId
        ?? trajectory.evidenceState?.sourceTaskId
        ?? trajectory.sourceRecordId
        ?? trajectory.id,
      current.sourceQuestionId,
    ),
    hypothesis: keepCurrentOr(trajectory.hypothesis ?? trajectory.question, current.hypothesis),
    expectedMove: keepCurrentOr(trajectory.summary ?? trajectory.distillationSignals?.decisionStrategy ?? trajectory.distillationSignals?.behavior, current.expectedMove),
    entryDate: keepCurrentOr(asOfDate, current.entryDate),
    entryTiming: keepCurrentOr(trajectory.profitFeedback?.entryTiming, current.entryTiming),
    exitTiming: keepCurrentOr(trajectory.profitFeedback?.exitTiming, current.exitTiming),
    positionSizing: keepCurrentOr(trajectory.profitFeedback?.positionSizing, current.positionSizing),
    realizedPnlPct: keepCurrentOr(trajectory.profitFeedback?.realizedPnlPct, current.realizedPnlPct),
    maxDrawdownPct: keepCurrentOr(trajectory.profitFeedback?.maxDrawdownPct, current.maxDrawdownPct),
    holdingDays: keepCurrentOr(trajectory.profitFeedback?.holdingDays, current.holdingDays),
    priceSqlRef: keepCurrentOr(marketEvidence?.priceSqlRef, current.priceSqlRef),
    marketDataRef: keepCurrentOr(marketEvidence?.marketDataRef, current.marketDataRef),
    marketEvidenceBenchmarkCode: keepCurrentOr(marketEvidence?.benchmarkCode, current.marketEvidenceBenchmarkCode),
    marketEvidenceSource: keepCurrentOr(marketEvidence?.source, current.marketEvidenceSource),
    marketEvidenceEndDate: keepCurrentOr(marketEvidence?.endDate, current.marketEvidenceEndDate),
    marketEvidenceRows: keepCurrentOr(marketEvidence?.rows, current.marketEvidenceRows),
    periodReturnPct: keepCurrentOr(marketEvidence?.periodReturnPct, current.periodReturnPct),
    relativeStrength: keepCurrentOr(marketEvidence?.relativeStrength, current.relativeStrength),
    relativeStrengthBasis: keepCurrentOr(marketEvidence?.relativeStrengthBasis, current.relativeStrengthBasis),
    turnoverChange: keepCurrentOr(marketEvidence?.turnoverChange, current.turnoverChange),
    followThrough1d: keepCurrentOr(marketEvidence?.followThrough1d, current.followThrough1d),
    followThrough3d: keepCurrentOr(marketEvidence?.followThrough3d, current.followThrough3d),
    followThrough5d: keepCurrentOr(marketEvidence?.followThrough5d, current.followThrough5d),
    maxDrawdownInHolding: keepCurrentOr(marketEvidence?.maxDrawdownInHolding, current.maxDrawdownInHolding),
    sourceRefs: keepCurrentOr(sourceRefs, current.sourceRefs),
    evidenceRefs: keepCurrentOr(evidenceRefs, current.evidenceRefs),
  }
}

export function buildPaperTradeDraftFromPlanCandidate(
  candidate: StockFeedbackPaperTradePlanCandidate,
  current: PaperTradeRecordDraft = initialPaperTradeRecordDraft(),
): PaperTradeRecordDraft {
  const entryDate = dateOnly(candidate.entry?.date) || dateOnly(candidate.asOfDate)
  const sourceRefs = refsText(candidate.sourceRefs ?? [])
  const evidenceRefs = refsText(candidate.evidenceRefs ?? [])
  const needsMarketEntryPrice = paperTradePlanCandidateNeedsEntryPrice(candidate)
  return {
    ...current,
    track: candidate.track === "llm_discretionary" ? "llm_discretionary" : "rule_baseline",
    validationTarget: paperTradeRecordTarget(candidate.validationTarget),
    stockCode: keepCurrentOr(candidate.stock?.code, ""),
    stockName: keepCurrentOr(candidate.stock?.name, ""),
    asOfDate: keepCurrentOr(candidate.asOfDate, ""),
    sourceQuestionId: keepCurrentOr(candidate.sourceQuestionId, ""),
    sourceTrajectoryId: keepCurrentOr(candidate.sourceTrajectoryId, ""),
    hypothesis: keepCurrentOr(candidate.hypothesis, ""),
    expectedMove: keepCurrentOr(candidate.expectedMove, ""),
    entryDate: keepCurrentOr(entryDate, ""),
    entryPrice: candidate.entry?.price == null ? "" : String(candidate.entry.price),
    entryTiming: keepCurrentOr(candidate.entry?.timing, ""),
    exitDate: "",
    exitPrice: "",
    exitTiming: "",
    exitReason: "",
    positionSizing: keepCurrentOr(candidate.positionSizing, ""),
    realizedPnlPct: "",
    maxDrawdownPct: "",
    holdingDays: "",
    sourceRefs,
    evidenceRefs,
    autoMarketEvidence: needsMarketEntryPrice ? true : current.autoMarketEvidence,
    autoMicrostructureEvidence: current.autoMicrostructureEvidence,
    microstructureDate: needsMarketEntryPrice ? keepCurrentOr(entryDate, current.microstructureDate) : current.microstructureDate,
    marketEvidenceProvider: needsMarketEntryPrice ? "tushare" : current.marketEvidenceProvider,
  }
}

export function buildPaperTradePlanCandidateProbeContext(
  candidate?: StockFeedbackPaperTradePlanCandidate | null,
): DataSourceProbeContext | null {
  const stockCode = String(candidate?.stock?.code ?? "").trim()
  const probeDate = dateOnly(candidate?.entry?.date) || dateOnly(candidate?.asOfDate)
  if (!stockCode || !probeDate) return null
  return {
    stock: {
      code: stockCode,
      name: candidate?.stock?.name ?? "",
    },
    evidenceState: { asOfDate: probeDate },
    eventTimeline: [{ at: probeDate }],
  }
}

export function buildPaperTradeRecordArgs(draft: PaperTradeRecordDraft) {
  const args = [
    "--track",
    draft.track,
    "--validation-target",
    draft.validationTarget,
    "--as-of-date",
    draft.asOfDate.trim(),
    "--entry-date",
    draft.entryDate.trim(),
    "--entry-price",
    draft.entryPrice.trim(),
    "--source-refs",
    draft.sourceRefs.trim(),
    "--evidence-refs",
    draft.evidenceRefs.trim(),
  ]
  pushPaperTradeArg(args, "--stock-code", draft.stockCode)
  pushPaperTradeArg(args, "--stock-name", draft.stockName)
  pushPaperTradeArg(args, "--source-question-id", draft.sourceQuestionId)
  pushPaperTradeArg(args, "--source-trajectory-id", draft.sourceTrajectoryId)
  pushPaperTradeArg(args, "--hypothesis", draft.hypothesis)
  pushPaperTradeArg(args, "--expected-move", draft.expectedMove)
  pushPaperTradeArg(args, "--entry-timing", draft.entryTiming)
  pushPaperTradeArg(args, "--exit-date", draft.exitDate)
  pushPaperTradeArg(args, "--exit-price", draft.exitPrice)
  pushPaperTradeArg(args, "--exit-timing", draft.exitTiming)
  pushPaperTradeArg(args, "--exit-reason", draft.exitReason)
  pushPaperTradeArg(args, "--position-sizing", draft.positionSizing)
  pushPaperTradeArg(args, "--realized-pnl-pct", draft.realizedPnlPct)
  pushPaperTradeArg(args, "--max-drawdown-pct", draft.maxDrawdownPct)
  pushPaperTradeArg(args, "--holding-days", draft.holdingDays)
  if (draft.autoMarketEvidence) args.push("--auto-market-evidence")
  if (draft.autoMicrostructureEvidence) args.push("--auto-microstructure-evidence")
  pushPaperTradeArg(args, "--microstructure-date", draft.microstructureDate)
  pushPaperTradeArg(args, "--market-evidence-provider", draft.marketEvidenceProvider)
  pushPaperTradeArg(args, "--market-evidence-benchmark-code", draft.marketEvidenceBenchmarkCode)
  pushPaperTradeArg(args, "--market-evidence-lookahead-days", draft.marketEvidenceLookaheadDays)
  pushPaperTradeArg(args, "--market-evidence-end-date", draft.marketEvidenceEndDate)
  pushPaperTradeArg(args, "--price-sql-ref", draft.priceSqlRef)
  pushPaperTradeArg(args, "--market-data-ref", draft.marketDataRef)
  pushPaperTradeArg(args, "--market-evidence-source", draft.marketEvidenceSource)
  pushPaperTradeArg(args, "--market-evidence-rows", draft.marketEvidenceRows)
  pushPaperTradeArg(args, "--period-return-pct", draft.periodReturnPct)
  pushPaperTradeArg(args, "--relative-strength", draft.relativeStrength)
  pushPaperTradeArg(args, "--relative-strength-basis", draft.relativeStrengthBasis)
  pushPaperTradeArg(args, "--turnover-change", draft.turnoverChange)
  pushPaperTradeArg(args, "--follow-through-1d", draft.followThrough1d)
  pushPaperTradeArg(args, "--follow-through-3d", draft.followThrough3d)
  pushPaperTradeArg(args, "--follow-through-5d", draft.followThrough5d)
  pushPaperTradeArg(args, "--max-drawdown-in-holding", draft.maxDrawdownInHolding)
  return args
}

export function TrainingFlywheelView() {
  const project = useWikiStore((s) => s.project)
  const [status, setStatus] = useState<StockFeedbackStatus | null>(null)
  const [listResult, setListResult] = useState<StockFeedbackListResult | null>(null)
  const [reviewQueue, setReviewQueue] = useState<StockFeedbackReviewQueueResult | null>(null)
  const [evidenceTasks, setEvidenceTasks] = useState<StockFeedbackEvidenceTaskListResult | null>(null)
  const [evidenceResults, setEvidenceResults] = useState<StockFeedbackEvidenceResultListResult | null>(null)
  const [evidenceSourceStatus, setEvidenceSourceStatus] = useState<StockFeedbackEvidenceSourceStatusResult | null>(null)
  const [evidenceDlq, setEvidenceDlq] = useState<StockFeedbackEvidenceDlqListResult | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedEvidenceTaskId, setSelectedEvidenceTaskId] = useState<string | null>(null)
  const [selectedAuditContext, setSelectedAuditContext] = useState<AuditSelectionContext | null>(null)
  const [target, setTarget] = useState<ValidationTarget>("all")
  const [selectedPatternId, setSelectedPatternId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [running, setRunning] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastResult, setLastResult] = useState<CommandResult | null>(null)
  const [submittedAuditReviews, setSubmittedAuditReviews] = useState<Record<string, AuditSubmissionNotice>>({})
  const [submittedReviewPrompts, setSubmittedReviewPrompts] = useState<Record<string, ReviewRefreshPrompt>>({})
  const [submittedReviewResults, setSubmittedReviewResults] = useState<Record<string, ReviewRefreshResult>>({})
  const [auditRefreshDiffs, setAuditRefreshDiffs] = useState<Record<string, AuditRefreshDiff>>({})
  const [auditBatchRefreshSummary, setAuditBatchRefreshSummary] = useState<AuditBatchRefreshSummary | null>(null)
  const [batchRefreshMovementFilter, setBatchRefreshMovementFilter] = useState<AuditBatchRefreshMovementFilter>("all")
  const [profitFeedbackFilter, setProfitFeedbackFilter] = useState<ProfitFeedbackSignalFilter>("all")
  const [reviewActionFilter, setReviewActionFilter] = useState<ReviewActionFilter>("all")
  const [collectionResultFocusNotice, setCollectionResultFocusNotice] = useState<CollectionResultFocusNotice | null>(null)
  const [paperTradeDraft, setPaperTradeDraft] = useState<PaperTradeRecordDraft>(() => initialPaperTradeRecordDraft())
  const [paperTradePreview, setPaperTradePreview] = useState<CommandResult | null>(null)
  const [paperTradeFollowUp, setPaperTradeFollowUp] = useState<PaperTradeWriteFollowUp | null>(null)
  const [paperTradeSettlementNotice, setPaperTradeSettlementNotice] = useState<PaperTradeSettlementAppliedNotice | null>(null)
  const [paperTradeSettlementDraft, setPaperTradeSettlementDraft] = useState<PaperTradeSettlementDraft>(() => initialPaperTradeSettlementDraft())
  const [paperTradeSettlementPreview, setPaperTradeSettlementPreview] = useState<CommandResult | null>(null)
  const [paperTradeSettlementFollowUp, setPaperTradeSettlementFollowUp] = useState<PaperTradeWriteFollowUp | null>(null)
  const [dataSourceProbe, setDataSourceProbe] = useState<DataSourceProbeResult | null>(null)

  const projectPath = project?.path ?? ""

  const load = useCallback(async (overrides?: { target?: ValidationTarget; selectedPatternId?: string | null }) => {
    if (!projectPath) return
    setLoading(true)
    setError(null)
    try {
      const activeTarget = overrides?.target ?? target
      const activePatternId = overrides?.selectedPatternId ?? selectedPatternId
      const args = ["--limit", "80"]
      if (activeTarget !== "all") args.push("--validation-target", activeTarget)
      if (activePatternId) args.push("--market-pattern", activePatternId)
      const reviewArgs = ["--limit", "120"]
      if (activePatternId) reviewArgs.push("--market-pattern", activePatternId)
      const [statusResult, trajectories, reviews, taskList, resultList, sourceHealth, dlqList] = await Promise.all([
        runResearchCockpitCommand<StockFeedbackStatus>(projectPath, "stock-feedback-status"),
        runResearchCockpitCommand<StockFeedbackListResult>(projectPath, "stock-feedback-list", args),
        runResearchCockpitCommand<StockFeedbackReviewQueueResult>(projectPath, "stock-feedback-review-queue", reviewArgs),
        runResearchCockpitCommand<StockFeedbackEvidenceTaskListResult>(projectPath, "stock-feedback-evidence-task-list", ["--status", "all", "--limit", "80"]),
        runResearchCockpitCommand<StockFeedbackEvidenceResultListResult>(projectPath, "stock-feedback-evidence-result-list", ["--limit", "80"]),
        runResearchCockpitCommand<StockFeedbackEvidenceSourceStatusResult>(projectPath, "stock-feedback-source-status"),
        runResearchCockpitCommand<StockFeedbackEvidenceDlqListResult>(projectPath, "stock-feedback-dlq-list", ["--status", "all", "--limit", "80"]),
      ])
      setStatus(statusResult)
      setListResult(trajectories)
      setReviewQueue(reviews)
      setEvidenceTasks(taskList)
      setEvidenceResults(resultList)
      setEvidenceSourceStatus(sourceHealth)
      setEvidenceDlq(dlqList)
      const next = trajectories.trajectories?.[0]?.id ?? null
      setSelectedId((current) => {
        if (current && trajectories.trajectories?.some((item) => item.id === current)) return current
        return next
      })
      setSelectedEvidenceTaskId((current) => {
        if (current && taskList.tasks?.some((item) => item.taskId === current)) return current
        return taskList.tasks?.[0]?.taskId ?? null
      })
      return { statusResult, trajectories, reviews, taskList, resultList, sourceHealth, dlqList }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return null
    } finally {
      setLoading(false)
    }
  }, [projectPath, selectedPatternId, target])

  useEffect(() => {
    load()
  }, [load])

  const trajectories = listResult?.trajectories ?? []
  const evidenceTaskRows = evidenceTasks?.tasks ?? []
  const evidenceResultRows = evidenceResults?.results ?? []
  const evidenceSourceRows = evidenceSourceStatus?.sources ?? []
  const evidenceDlqRows = evidenceDlq?.entries ?? []
  const evidenceQueueSummary = useMemo(
    () => buildEvidenceQueueSummary({
      tasks: evidenceTaskRows,
      results: evidenceResultRows,
      sources: evidenceSourceRows,
      dlq: evidenceDlqRows,
    }),
    [evidenceDlqRows, evidenceResultRows, evidenceSourceRows, evidenceTaskRows],
  )
  const selectedEvidenceTask = useMemo(
    () => selectedEvidenceTaskId ? evidenceTaskRows.find((item) => item.taskId === selectedEvidenceTaskId) ?? null : null,
    [evidenceTaskRows, selectedEvidenceTaskId],
  )
  const selectedEvidenceResults = useMemo(
    () => selectedEvidenceTask?.taskId ? evidenceResultRows.filter((item) => item.taskId === selectedEvidenceTask.taskId) : [],
    [evidenceResultRows, selectedEvidenceTask?.taskId],
  )
  const selected = useMemo(
    () => selectedId ? trajectories.find((item) => item.id === selectedId) ?? null : null,
    [selectedId, trajectories],
  )
  const selectedPattern = useMemo(
    () => status?.patternRadar?.items?.find((item) => item.id === selectedPatternId) ?? null,
    [selectedPatternId, status?.patternRadar?.items],
  )
  const activeCollectionTask = useMemo(
    () => collectionTaskFromCommandResult(lastResult),
    [lastResult],
  )
  const inlineProfitCollectionTask = shouldInlineProfitCollectionTask(activeCollectionTask, selected)
    ? activeCollectionTask
    : null
  const showActiveCollectionTask = Boolean(
    activeCollectionTask &&
    !sameCollectionTask(activeCollectionTask, selectedPattern?.collectionTask) &&
    !inlineProfitCollectionTask,
  )
  const collectionResultFollowUp = useMemo(
    () => buildCollectionResultFollowUp(lastResult?.collectionResult),
    [lastResult?.collectionResult],
  )
  const collectionResultReviewPreview = useMemo(
    () => buildCollectionResultReviewRoutePreview(lastResult?.collectionResult),
    [lastResult?.collectionResult],
  )
  const collectionResultRoadmapContext = useMemo<CollectionResultActionRoadmapContext>(
    () => ({
      trajectories,
      benchmark: status?.artifactSourceMix?.benchmark,
      loraReady: status?.artifactSourceMix?.loraReady,
    }),
    [status?.artifactSourceMix?.benchmark, status?.artifactSourceMix?.loraReady, trajectories],
  )
  const collectionResultRoadmap = useMemo(
    () => buildCollectionResultActionRoadmap(lastResult?.collectionResult, collectionResultRoadmapContext),
    [collectionResultRoadmapContext, lastResult?.collectionResult],
  )
  const collectionResultTask = useMemo(
    () => collectionTaskFromCollectionResult(lastResult?.collectionResult),
    [lastResult?.collectionResult],
  )
  const inlineCollectionResult = shouldInlineCollectionResultFollowUp(lastResult?.collectionResult, selected)
    ? lastResult?.collectionResult ?? null
    : null
  const inlineCollectionResultFollowUp = inlineCollectionResult ? collectionResultFollowUp : null
  const inlineCollectionResultRoadmap = inlineCollectionResult ? collectionResultRoadmap : null
  const inlineCollectionResultTask = inlineCollectionResult ? collectionResultTask : null
  const inlineCollectionResultReviewPreview = inlineCollectionResult ? collectionResultReviewPreview : null
  const reviewByTrajectory = useMemo(() => {
    const map = new Map<string, StockFeedbackReviewQueueItem>()
    for (const item of reviewQueue?.items ?? []) {
      if (item.sourceTrajectoryId) map.set(item.sourceTrajectoryId, item)
    }
    return map
  }, [reviewQueue])
  const profitFeedbackWorklist = useMemo(
    () => buildProfitFeedbackReviewWorklist(trajectories, reviewByTrajectory),
    [reviewByTrajectory, trajectories],
  )
  const nextHumanReviewSuggestion = useMemo(
    () => buildNextHumanReviewSuggestion({
      trajectories,
      reviewByTrajectory,
      currentTrajectoryId: selectedId,
    }),
    [reviewByTrajectory, selectedId, trajectories],
  )
  const pendingReviewRefreshes = useMemo(
    () => [
      ...Object.values(submittedReviewPrompts),
      ...Object.values(submittedAuditReviews),
    ].filter((item) => Boolean(item.refreshLabel)),
    [submittedAuditReviews, submittedReviewPrompts],
  )
  const benchmarkGapActions = useMemo(
    () => buildBenchmarkGapActions(status?.dynamicBenchmark, status?.patternRadar),
    [status?.dynamicBenchmark, status?.patternRadar],
  )
  const dynamicTestSetPlan = useMemo(
    () => buildDynamicTestSetPlan(benchmarkGapActions),
    [benchmarkGapActions],
  )
  const benchmarkBatchGateSummary = useMemo(
    () => buildBenchmarkBatchGateSummary(status),
    [status],
  )
  const reviewBacklogGateSummary = useMemo(
    () => buildReviewBacklogGateSummary({
      status,
      reviewQueue,
      nextSuggestion: nextHumanReviewSuggestion,
      pendingRefreshes: pendingReviewRefreshes,
    }),
    [nextHumanReviewSuggestion, pendingReviewRefreshes, reviewQueue, status],
  )
  const reviewActionFilterOptions = useMemo(
    () => buildReviewActionFilterOptions(reviewQueue),
    [reviewQueue],
  )
  const reviewActionBatchPreview = useMemo(
    () => buildReviewActionBatchPreview(trajectories, reviewByTrajectory, reviewActionFilter, { limit: 4 }),
    [reviewActionFilter, reviewByTrajectory, trajectories],
  )
  const selectedReviewBucketContext = useMemo(
    () => buildReviewBucketContext(trajectories, reviewByTrajectory, reviewActionFilter, selectedId),
    [reviewActionFilter, reviewByTrajectory, selectedId, trajectories],
  )
  const selectedReview = selected ? reviewByTrajectory.get(selected.id) ?? null : null
  const selectedSubmissionNotice = selectedAuditContext
    ? submittedAuditReviews[auditSubmissionKey(selectedAuditContext) ?? ""] ?? null
    : null
  const selectedReviewRefreshPrompt = selectedId ? submittedReviewPrompts[selectedId] ?? null : null
  const selectedReviewRefreshResult = selectedId ? submittedReviewResults[selectedId] ?? null : null
  const selectedRefreshDiff = selectedAuditContext
    ? auditRefreshDiffs[auditSubmissionKey(selectedAuditContext) ?? ""] ?? null
    : null
  const activeAuditBatchRefreshSummary = auditBatchRefreshSummary ?? status?.artifactSourceMix?.loraReady?.batchRefreshDelta ?? null
  const movementFilteredTrajectories = useMemo(
    () => filterTrajectoriesByBatchRefreshMovement(trajectories, activeAuditBatchRefreshSummary, batchRefreshMovementFilter),
    [activeAuditBatchRefreshSummary, batchRefreshMovementFilter, trajectories],
  )
  const reviewActionFilteredTrajectories = useMemo(
    () => filterTrajectoriesByReviewAction(movementFilteredTrajectories, reviewByTrajectory, reviewActionFilter),
    [movementFilteredTrajectories, reviewActionFilter, reviewByTrajectory],
  )
  const visibleTrajectories = useMemo(
    () => filterTrajectoriesByProfitFeedbackSignal(reviewActionFilteredTrajectories, profitFeedbackFilter),
    [profitFeedbackFilter, reviewActionFilteredTrajectories],
  )
  const batchRefreshMovementFilterLabel = batchRefreshMovementFilter === "all"
    ? ""
    : auditBatchRefreshMovementLabel(batchRefreshMovementFilter)
  const profitFeedbackFilterLabel = profitFeedbackFilter === "all"
    ? ""
    : PROFIT_FILTERS.find((item) => item.id === profitFeedbackFilter)?.label ?? profitFeedbackFilter
  const reviewActionFilterLabel = reviewActionFilter === "all"
    ? ""
    : REVIEW_ACTION_FILTERS.find((item) => item.id === reviewActionFilter)?.label ?? reviewActionFilter
  const activeClientFilterText = [batchRefreshMovementFilterLabel, reviewActionFilterLabel, profitFeedbackFilterLabel].filter(Boolean).join(" · ")
  const paperTradeTrajectoryCount = useMemo(
    () => trajectories.filter((item) => item.source === "stock-feedback-paper-trade" || item.sourceKind === "stock-feedback-paper-trade").length,
    [trajectories],
  )
  const profitLedgerSeparationSummary = useMemo(
    () => buildProfitLedgerSeparationSummary(status),
    [status],
  )
  const paperTradeReadiness = useMemo(
    () => buildPaperTradeRecordReadiness(paperTradeDraft),
    [paperTradeDraft],
  )
  const paperTradeDataSourceGate = useMemo(
    () => buildPaperTradeDataSourceGate(paperTradeDraft, dataSourceProbe),
    [dataSourceProbe, paperTradeDraft],
  )
  const paperTradeSettlementReadiness = useMemo(
    () => buildPaperTradeSettlementReadiness(paperTradeSettlementDraft),
    [paperTradeSettlementDraft],
  )
  const dataSourceProbeContext = useMemo<DataSourceProbeContext | null>(() => {
    const draftStockCode = paperTradeDraft.stockCode.trim()
    const draftStockName = paperTradeDraft.stockName.trim()
    const draftDate = normalizeProbeDate(paperTradeDraft.entryDate) || normalizeProbeDate(paperTradeDraft.asOfDate)
    if (draftStockCode || draftStockName || draftDate) {
      return {
        stock: { code: draftStockCode, name: draftStockName },
        evidenceState: { asOfDate: draftDate },
        eventTimeline: draftDate ? [{ at: draftDate }] : [],
      }
    }
    return selected
  }, [paperTradeDraft.asOfDate, paperTradeDraft.entryDate, paperTradeDraft.stockCode, paperTradeDraft.stockName, selected])
  const dataSourceProbeArgs = useMemo(
    () => buildTushareDataSourceProbeArgs(dataSourceProbeContext),
    [dataSourceProbeContext],
  )
  const dataSourceProbeContextLabel = useMemo(() => {
    const stockLabel = [dataSourceProbeContext?.stock?.name, dataSourceProbeContext?.stock?.code].filter(Boolean).join(" ")
    const tradeDate = normalizeProbeDate(dataSourceProbeContext?.evidenceState?.asOfDate)
      || normalizeProbeDate(dataSourceProbeContext?.eventTimeline?.find((item) => normalizeProbeDate(item.at))?.at)
    return [stockLabel || "默认样本", tradeDate].filter(Boolean).join(" · ")
  }, [dataSourceProbeContext])
  const trajectoryCountText = loading
    ? "加载中..."
    : activeClientFilterText
      ? `${visibleTrajectories.length}/${trajectories.length} 条 · ${activeClientFilterText}`
      : `${listResult?.returned ?? trajectories.length} 条 · ${listResult?.sourceMode ?? status?.sourceMode ?? "persisted"}`
  useEffect(() => {
    if (loading) return
    if (visibleTrajectories.length === 0) {
      if (selectedId) setSelectedId(null)
      return
    }
    if (!selectedId || !visibleTrajectories.some((item) => item.id === selectedId)) {
      setSelectedId(visibleTrajectories[0]?.id ?? null)
      setSelectedAuditContext(null)
    }
  }, [loading, selectedId, visibleTrajectories])

  useEffect(() => {
    if (loading) return
    if (evidenceTaskRows.length === 0) {
      if (selectedEvidenceTaskId) setSelectedEvidenceTaskId(null)
      return
    }
    if (!selectedEvidenceTaskId || !evidenceTaskRows.some((item) => item.taskId === selectedEvidenceTaskId)) {
      setSelectedEvidenceTaskId(evidenceTaskRows[0]?.taskId ?? null)
    }
  }, [evidenceTaskRows, loading, selectedEvidenceTaskId])

  useEffect(() => {
    if (selected?.id && selectedAuditContext?.sourceTrajectoryId && selectedAuditContext.sourceTrajectoryId !== selected.id) {
      setSelectedAuditContext(null)
    }
  }, [selected?.id, selectedAuditContext?.sourceTrajectoryId])

  const selectBatchRefreshMovementFilter = useCallback((filter: AuditBatchRefreshMovementFilter) => {
    const nextFilter = batchRefreshMovementFilter === filter ? "all" : filter
    setBatchRefreshMovementFilter(nextFilter)
    if (nextFilter === "all") return
    setTarget("all")
    setSelectedPatternId(null)
    setProfitFeedbackFilter("all")
    setReviewActionFilter("all")
    const nextMovement = lookupAuditBatchRefreshMovements(activeAuditBatchRefreshSummary).find(
      (movement) => movement.movement === nextFilter && movement.sourceTrajectoryId,
    )
    if (nextMovement?.sourceTrajectoryId) {
      setSelectedId(nextMovement.sourceTrajectoryId)
      setSelectedAuditContext(auditContextFromBatchRefreshMovement(nextMovement))
    } else {
      setSelectedAuditContext(null)
    }
  }, [activeAuditBatchRefreshSummary, batchRefreshMovementFilter])

  const selectReviewActionFilter = useCallback((filter: ReviewActionFilter) => {
    const nextFilter = reviewActionFilter === filter ? "all" : filter
    setReviewActionFilter(nextFilter)
    setSelectedAuditContext(null)
    if (nextFilter === "all") return
    setTarget("all")
    setSelectedPatternId(null)
    setBatchRefreshMovementFilter("all")
    setProfitFeedbackFilter("all")
    const nextTrajectory = filterTrajectoriesByReviewAction(trajectories, reviewByTrajectory, nextFilter)[0]
    setSelectedId(nextTrajectory?.id ?? null)
  }, [reviewActionFilter, reviewByTrajectory, trajectories])

  const selectProfitFeedbackWorklistItem = useCallback((item: ProfitFeedbackReviewWorklistItem) => {
    setBatchRefreshMovementFilter("all")
    setReviewActionFilter("all")
    setProfitFeedbackFilter(item.filter)
    setSelectedId(item.firstTrajectoryId)
    setSelectedAuditContext(null)
  }, [])

  const selectNextHumanReviewSuggestion = useCallback((suggestion: NextHumanReviewSuggestion) => {
    setTarget("all")
    setSelectedPatternId(null)
    setBatchRefreshMovementFilter("all")
    setProfitFeedbackFilter("all")
    setReviewActionFilter("all")
    setSelectedId(suggestion.trajectoryId)
    setSelectedAuditContext(null)
    setCollectionResultFocusNotice({
      headline: "已切到下一条人审",
      detail: `${suggestion.actionLabel}：${suggestion.detail}`,
      trajectoryId: suggestion.trajectoryId,
      tone: suggestion.tone,
    })
  }, [])

  const selectBenchmarkGapAction = useCallback((action: BenchmarkGapAction) => {
    if (action.target) setTarget(action.target)
    if (action.profitFeedbackFilter) setProfitFeedbackFilter(action.profitFeedbackFilter)
    else setProfitFeedbackFilter("all")
    if (action.patternId) setSelectedPatternId(action.patternId)
    else setSelectedPatternId(null)
    setBatchRefreshMovementFilter("all")
    setReviewActionFilter("all")
    setSelectedId(null)
    setSelectedAuditContext(null)
  }, [])

  const selectCollectionResultRoadmapStep = useCallback((step: CollectionResultActionRoadmapStep) => {
    const context = step.action?.auditContext ?? null
    if (!context?.sourceTrajectoryId) return
    setSelectedPatternId(null)
    setTarget("all")
    setBatchRefreshMovementFilter("all")
    setProfitFeedbackFilter("all")
    setReviewActionFilter("all")
    setSelectedId(context.sourceTrajectoryId)
    setSelectedAuditContext(context)
    setCollectionResultFocusNotice({
      headline: `${step.action?.label ?? "已定位"}：${step.label}`,
      detail: `${context.sourceTitle ?? "来源审计"} 已定位到右侧详情；可以继续复核证据、权重和 PEFT 边界。`,
      trajectoryId: context.sourceTrajectoryId,
      collectionResultId: context.collectionResultId ?? null,
      tone: step.status === "blocked" ? "warn" : "good",
    })
  }, [])

  const focusAuditContext = useCallback((
    context: AuditSelectionContext,
    notice: {
      headline: string
      detail: string
      tone?: CollectionResultFocusNotice["tone"]
    },
  ) => {
    if (!context.sourceTrajectoryId) return
    setSelectedPatternId(null)
    setTarget("all")
    setBatchRefreshMovementFilter("all")
    setProfitFeedbackFilter("all")
    setReviewActionFilter("all")
    setSelectedId(context.sourceTrajectoryId)
    setSelectedAuditContext(context)
    setCollectionResultFocusNotice({
      headline: notice.headline,
      detail: notice.detail,
      trajectoryId: context.sourceTrajectoryId,
      collectionResultId: context.collectionResultId ?? null,
      tone: notice.tone ?? "good",
    })
  }, [])

  function planProfitCreditGapAction(action: BenchmarkGapAction, write: boolean) {
    if (!action.profitCredit) return
    return runCollectionTask({
      targetProfitCredit: action.profitCredit,
      targetProfitCreditLabel: action.label,
      validationTarget: action.target,
      recommendedAction: action.recommendedAction,
      suggestedFilters: {
        profitCredit: action.profitCredit,
        profitFeedback: action.profitFeedbackFilter,
        validationTarget: action.target,
        qualityGate: null,
      },
    }, write)
  }

  async function runAction(label: string, action: ResearchCockpitAction, args: string[] = [], loadOptions?: { target?: ValidationTarget; selectedPatternId?: string | null }) {
    if (!projectPath) return null
    setRunning(label)
    setError(null)
    try {
      const result = await runResearchCockpitCommand<CommandResult>(projectPath, action, args)
      setLastResult(result)
      const loaded = await load(loadOptions)
      return { result, loaded }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return null
    } finally {
      setRunning(null)
    }
  }

  async function buildPaperTradeAgentCandidates(write = false) {
    return runAction(
      write ? "paper-trade-agent-write" : "paper-trade-agent-dry",
      write ? "stock-feedback-paper-trade-agent-write" : "stock-feedback-paper-trade-agent-dry-run",
      ["--limit", "12"],
    )
  }

  async function runPaperTradeDiscretionaryReview() {
    return runAction(
      "paper-trade-discretionary-review",
      "stock-feedback-paper-trade-discretionary-review",
      ["--limit", "8"],
    )
  }

  async function runDataSourceProbe(argsOverride?: string[]) {
    if (!projectPath) return null
    setRunning("data-source-probe")
    setError(null)
    setPaperTradeSettlementNotice(null)
    try {
      const result = await runResearchCockpitCommand<DataSourceProbeResult>(
        projectPath,
        "data-source-tushare-probe",
        argsOverride ?? dataSourceProbeArgs,
      )
      setDataSourceProbe(result)
      return result
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return null
    } finally {
      setRunning(null)
    }
  }

  async function runEvidenceTaskQueue(write: boolean, taskId?: string | null) {
    const args = ["--limit", "10"]
    if (taskId) args.push("--task-id", taskId)
    await runAction(
      write ? "evidence-run-write" : "evidence-run-dry",
      write ? "stock-feedback-run-task-queue-write" : "stock-feedback-run-task-queue-dry-run",
      args,
    )
  }

  async function reviewEvidenceResult(resultId: string, action: "approve" | "reject" | "needs_more_evidence") {
    await runAction(
      `evidence-review-${action}`,
      "stock-feedback-evidence-result-review-write",
      ["--result-id", resultId, "--action", action, "--reviewer", "ui"],
    )
  }

  async function updateEvidenceDlq(entry: StockFeedbackEvidenceDlqEntry, action: "retry" | "discard") {
    const args = ["--reviewer", "ui"]
    if (entry.id) args.push("--dlq-id", entry.id)
    else if (entry.taskId) args.push("--task-id", entry.taskId)
    if (action === "retry") args.push("--note", "UI retry: 数据源或证据补齐后重新排队")
    if (action === "discard") args.push("--note", "UI discard: 关闭错误或重复补证任务")
    await runAction(
      `evidence-dlq-${action}`,
      action === "retry" ? "stock-feedback-dlq-retry-write" : "stock-feedback-dlq-discard-write",
      args,
    )
  }

  async function runCollectionTask(task: StockFeedbackCollectionTask, write: boolean) {
    const targetArgs = collectionTaskTargetArgs(task)
    if (targetArgs.length === 0) return
    await runAction(
      write ? "collection-write" : "collection-dry",
      write ? "stock-feedback-collection-task-write" : "stock-feedback-collection-task-dry-run",
      targetArgs,
    )
  }

  async function runCollectionResult(task: StockFeedbackCollectionTask, result: string, evidenceRefs: string, summary: string) {
    const contextArgs = collectionResultContextArgs(task)
    if (contextArgs.length === 0) return
    const args = [...contextArgs, "--result", result, "--reviewer", "ui"]
    if (evidenceRefs.trim()) args.push("--evidence-refs", evidenceRefs.trim())
    if (summary.trim()) args.push("--summary", summary.trim())
    await runAction(`collection-result-${result}`, "stock-feedback-collection-result-write", args)
  }

  function updatePaperTradeDraft(patch: Partial<PaperTradeRecordDraft>) {
    setPaperTradeDraft((current) => ({ ...current, ...patch }))
    setPaperTradePreview(null)
    setPaperTradeFollowUp(null)
    setPaperTradeSettlementNotice(null)
  }

  function updatePaperTradeSettlementDraft(patch: Partial<PaperTradeSettlementDraft>) {
    setPaperTradeSettlementDraft((current) => ({ ...current, ...patch }))
    setPaperTradeSettlementPreview(null)
    setPaperTradeSettlementFollowUp(null)
    setPaperTradeSettlementNotice(null)
  }

  function prefillPaperTradeSettlementFromTrade(trade: StockFeedbackPaperTradeSummary) {
    setPaperTradeSettlementDraft((current) => buildPaperTradeSettlementDraftFromTrade(trade, current))
    setPaperTradeSettlementPreview(null)
    setPaperTradeSettlementFollowUp(null)
    setPaperTradeSettlementNotice(null)
    setError(null)
  }

  function prefillPaperTradeFromSelected() {
    if (!selected) return
    setPaperTradeDraft((current) => buildPaperTradeDraftFromTrajectory(selected, current))
    setPaperTradePreview(null)
    setPaperTradeFollowUp(null)
    setPaperTradeSettlementNotice(null)
    setError(null)
  }

  async function prefillPaperTradeFromPlanCandidate(
    candidate: StockFeedbackPaperTradePlanCandidate,
    options: { probeEntryPrice?: boolean } = {},
  ) {
    const nextDraft = buildPaperTradeDraftFromPlanCandidate(candidate, paperTradeDraft)
    setPaperTradeDraft(nextDraft)
    setPaperTradePreview(null)
    setPaperTradeFollowUp(null)
    setPaperTradeSettlementNotice(null)
    setDataSourceProbe(null)
    setError(null)
    if (candidate.sourceTrajectoryId) {
      setSelectedId(candidate.sourceTrajectoryId)
      setSelectedAuditContext(null)
    }
    if (options.probeEntryPrice) {
      const probeContext = buildPaperTradePlanCandidateProbeContext(candidate)
      if (!probeContext) {
        setError("候选缺少股票代码或 asOfDate，不能自动补入口价。")
        return
      }
      const result = await runDataSourceProbe(buildTushareDataSourceProbeArgs(probeContext))
      const suggestion = buildEntryPriceSuggestionFromProbe(result, nextDraft)
      if (!suggestion) {
        setError("Tushare 已检查，但没有返回匹配当前候选的入口价；请手工核对股票和 asOfDate。")
        return
      }
      setPaperTradeDraft((current) => {
        const sameCandidate = current.sourceTrajectoryId === nextDraft.sourceTrajectoryId
          && current.stockCode === nextDraft.stockCode
          && current.entryDate === nextDraft.entryDate
        if (!sameCandidate) return current
        return {
          ...current,
          ...buildPaperTradeEntryPriceSuggestionPatch(current, suggestion),
        }
      })
      setCollectionResultFocusNotice({
        headline: "已补入口价",
        detail: `${[candidate.stock?.name, candidate.stock?.code].filter(Boolean).join(" ") || "paper trade 候选"} 已回填 ${suggestion.label}；下一步预览模拟交易，确认收益窗口后再写入并重建。`,
        trajectoryId: candidate.sourceTrajectoryId ?? null,
        tone: "good",
      })
    }
  }

  function applyPaperTradeSettlementSuggestion(suggestion: PaperTradePreviewSettlementSuggestion) {
    setPaperTradeDraft((current) => ({ ...current, ...suggestion.patch }))
    setPaperTradePreview(null)
    setPaperTradeFollowUp(null)
    setPaperTradeSettlementNotice(buildPaperTradeSettlementAppliedNotice(suggestion))
    setError(null)
  }

  async function runPaperTradeRecord(write: boolean) {
    if (!projectPath) return
    const readiness = buildPaperTradeRecordReadiness(paperTradeDraft)
    if (!readiness.ready) {
      setError(readiness.detail)
      return
    }
    const dataSourceGate = buildPaperTradeDataSourceGate(paperTradeDraft, dataSourceProbe)
    if (dataSourceGate.blocksWrite) {
      setError(dataSourceGate.detail)
      return
    }
    setRunning(write ? "paper-trade-write" : "paper-trade-dry")
    setError(null)
    setPaperTradeSettlementNotice(null)
    try {
      const result = await runResearchCockpitCommand<CommandResult>(
        projectPath,
        write ? "stock-feedback-paper-trade-record-write" : "stock-feedback-paper-trade-record-dry-run",
        buildPaperTradeRecordArgs(paperTradeDraft),
      )
      setLastResult(result)
      setPaperTradePreview(result)
      if (!write) {
        setPaperTradeFollowUp(buildPaperTradeWriteFollowUp(result))
        return
      }

      await runResearchCockpitCommand<CommandResult>(projectPath, "stock-feedback-build-write")
      setTarget("all")
      setSelectedPatternId(null)
      setBatchRefreshMovementFilter("all")
      setProfitFeedbackFilter("all")
      setReviewActionFilter("all")
      const loaded = await load({ target: "all", selectedPatternId: null })
      const paperTradeId = result.paperTrade?.id
      const matched = paperTradeId
        ? loaded?.trajectories?.trajectories?.find((item) => item.sourceRecordId === paperTradeId || item.evidenceState?.paperTradeId === paperTradeId)
        : null
      setPaperTradeFollowUp(buildPaperTradeWriteFollowUp(result, {
        writeCompleted: true,
        matchedTrajectoryId: matched?.id ?? null,
      }))
      if (matched?.id) {
        setSelectedId(matched.id)
        setSelectedAuditContext(null)
        setCollectionResultFocusNotice({
          headline: "已写入模拟交易并重建轨迹",
          detail: "paper_trade 已进入 stock-feedback trajectory；下一步做人审、Benchmark 或 LoRA-ready 低权重刷新。",
          trajectoryId: matched.id,
          tone: "good",
        })
      } else {
        setCollectionResultFocusNotice({
          headline: "模拟交易已写入，等待轨迹定位",
          detail: "paper_trade 已写入并重建，但当前列表未匹配到轨迹；先跑 verify 或检查 paperTradeId 回流字段，再进入训练权重。",
          tone: "warn",
        })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRunning(null)
    }
  }

  async function runPaperTradeSettlement(write: boolean) {
    if (!projectPath) return
    const readiness = buildPaperTradeSettlementReadiness(paperTradeSettlementDraft)
    if (!readiness.ready) {
      setError(readiness.detail)
      return
    }
    setRunning(write ? "paper-trade-settle-write" : "paper-trade-settle-dry")
    setError(null)
    setPaperTradeSettlementNotice(null)
    try {
      const result = await runResearchCockpitCommand<CommandResult>(
        projectPath,
        write ? "stock-feedback-paper-trade-settle-write" : "stock-feedback-paper-trade-settle-dry-run",
        buildPaperTradeSettlementArgs(paperTradeSettlementDraft),
      )
      setLastResult(result)
      setPaperTradeSettlementPreview(result)
      if (!write) {
        setPaperTradeSettlementFollowUp(buildPaperTradeWriteFollowUp(result))
        return
      }

      await runResearchCockpitCommand<CommandResult>(projectPath, "stock-feedback-build-write")
      setTarget("all")
      setSelectedPatternId(null)
      setBatchRefreshMovementFilter("all")
      setProfitFeedbackFilter("all")
      setReviewActionFilter("all")
      const loaded = await load({ target: "all", selectedPatternId: null })
      const paperTradeId = result.paperTrade?.id
      const matched = paperTradeId
        ? loaded?.trajectories?.trajectories?.find((item) => item.sourceRecordId === paperTradeId || item.evidenceState?.paperTradeId === paperTradeId)
        : null
      setPaperTradeSettlementFollowUp(buildPaperTradeWriteFollowUp(result, {
        writeCompleted: true,
        matchedTrajectoryId: matched?.id ?? null,
      }))
      if (matched?.id) {
        setSelectedId(matched.id)
        setSelectedAuditContext(null)
        setCollectionResultFocusNotice({
          headline: "已结算模拟交易并重建轨迹",
          detail: "closed paper_trade 已回流 profitFeedback；下一步做人审，paper 盈利默认低于真实交易权重。",
          trajectoryId: matched.id,
          tone: "good",
        })
      } else {
        setCollectionResultFocusNotice({
          headline: "模拟交易已结算，等待轨迹定位",
          detail: "settlement 已写入并重建，但当前列表未匹配到轨迹；先跑 verify 或检查 paperTradeId 回流字段。",
          tone: "warn",
        })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRunning(null)
    }
  }

  async function rebuildTrajectoriesForCollectionResult(result?: StockFeedbackCollectionResult | null) {
    if (!result) {
      await runAction("write", "stock-feedback-build-write")
      return
    }
    setCollectionResultFocusNotice(null)
    setTarget("all")
    setSelectedPatternId(null)
    setBatchRefreshMovementFilter("all")
    setProfitFeedbackFilter("all")
    setReviewActionFilter("all")
    setSelectedAuditContext(null)
    const outcome = await runAction("write", "stock-feedback-build-write", [], { target: "all", selectedPatternId: null })
    const matched = findTrajectoryForCollectionResult(outcome?.loaded?.trajectories?.trajectories ?? [], result)
    const targetLabel = collectionResultTargetLabel(result)
    if (matched?.id) {
      setSelectedId(matched.id)
      setSelectedAuditContext({
        sourceTitle: "补样本回流轨迹",
        sourceTrajectoryId: matched.id,
        collectionResultId: result.id ?? null,
        sourceKindLabel: "补样本回流轨迹",
      })
      setCollectionResultFocusNotice({
        headline: "已定位回流轨迹",
        detail: `${targetLabel} 已重建为训练轨迹；可以继续人工 review、生成 Benchmark 或刷新 LoRA-ready。`,
        trajectoryId: matched.id,
        collectionResultId: result.id ?? null,
        tone: "good",
      })
      return
    }
    setCollectionResultFocusNotice({
      headline: "已重建，暂未定位到回流轨迹",
      detail: `${targetLabel} 的 collection-result 已触发重建，但当前列表未找到对应轨迹；可检查 verify 或确认 result schema/source id 是否完整。`,
      collectionResultId: result.id ?? null,
      tone: "warn",
    })
  }

  async function submitReview(action: string, note: string) {
    if (!projectPath || !selected) return
    const auditContextAtSubmit = selectedAuditContext
    setRunning(`review-${action}`)
    setError(null)
    try {
      const args = [
        "--trajectory-id",
        selected.id,
        "--action",
        action,
        "--reviewer",
        "ui",
      ]
      if (note.trim()) args.push("--note", note.trim())
      const result = await runResearchCockpitCommand<CommandResult>(projectPath, "stock-feedback-review-write", args)
      setLastResult(result)
      setSubmittedReviewResults((current) => {
        const next = { ...current }
        delete next[selected.id]
        return next
      })
      const submissionNotice = buildAuditSubmissionNotice(auditContextAtSubmit, result.reviewEvent)
      if (submissionNotice) {
        setSubmittedAuditReviews((current) => ({
          ...current,
          [submissionNotice.key]: submissionNotice,
        }))
      } else {
        const reviewPrompt = buildReviewRefreshPrompt(result.reviewEvent)
        if (reviewPrompt) {
          setSubmittedReviewPrompts((current) => ({
            ...current,
            [selected.id]: reviewPrompt,
          }))
        }
      }
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRunning(null)
    }
  }

  async function rebuildAndRefreshLoraReady(options?: { auditContext?: AuditSelectionContext | null; allValidationTargets?: boolean }) {
    if (!projectPath) return
    const auditContextBeforeRefresh = options?.auditContext ?? selectedAuditContext
    const selectedTrajectoryIdBeforeRefresh = auditContextBeforeRefresh?.sourceTrajectoryId ?? selected?.id ?? null
    const selectedTrajectoryBeforeRefresh = selectedTrajectoryIdBeforeRefresh
      ? trajectories.find((item) => item.id === selectedTrajectoryIdBeforeRefresh) ?? selected
      : selected
    const auditKey = auditSubmissionKey(auditContextBeforeRefresh)
    const loraReadyBeforeRefresh = status?.artifactSourceMix?.loraReady ?? null
    const exportArgs = options?.allValidationTargets
      ? []
      : selectedTrajectoryBeforeRefresh?.validationTarget ? ["--validation-target", selectedTrajectoryBeforeRefresh.validationTarget] : []
    setRunning("refresh-lora-ready")
    setError(null)
    setAuditBatchRefreshSummary(null)
    try {
      await runResearchCockpitCommand<CommandResult>(projectPath, "stock-feedback-build-write")
      const result = await runResearchCockpitCommand<CommandResult>(projectPath, "stock-feedback-export-lora-ready", exportArgs)
      setLastResult({ ...result, status: "rebuilt-lora-ready" })
      const loaded = await load()
      const nextBatchRefreshSummary = loaded?.statusResult?.artifactSourceMix?.loraReady?.batchRefreshDelta
        ?? buildAuditBatchRefreshSummary(loraReadyBeforeRefresh, loaded?.statusResult?.artifactSourceMix?.loraReady)
      setAuditBatchRefreshSummary(nextBatchRefreshSummary)
      const refreshedContext = findAuditContextInStatus(loaded?.statusResult, auditContextBeforeRefresh)
      const refreshDiff = buildAuditRefreshDiff(auditContextBeforeRefresh, refreshedContext)
      if (refreshDiff) {
        setAuditRefreshDiffs((current) => ({
          ...current,
          [refreshDiff.key]: refreshDiff,
        }))
      }
      if (refreshedContext) {
        setSelectedAuditContext(refreshedContext)
      }
      if (auditKey) {
        setSubmittedAuditReviews((current) => {
          const next = { ...current }
          delete next[auditKey]
          return next
        })
      }
      if (selectedTrajectoryIdBeforeRefresh) {
        const reviewRefreshResult = buildReviewRefreshResult(nextBatchRefreshSummary, selectedTrajectoryIdBeforeRefresh)
        if (reviewRefreshResult) {
          setSubmittedReviewResults((current) => ({
            ...current,
            [selectedTrajectoryIdBeforeRefresh]: reviewRefreshResult,
          }))
        }
        setSubmittedReviewPrompts((current) => {
          const next = { ...current }
          delete next[selectedTrajectoryIdBeforeRefresh]
          return next
        })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRunning(null)
    }
  }

  function refreshLoraReadyForCollectionResult(card: CollectionResultHistoryCard) {
    const context = card.refreshAction?.auditContext ?? null
    if (context?.sourceTrajectoryId) {
      focusAuditContext(context, {
        headline: `${card.refreshAction?.label ?? "已定位"}：刷新 LoRA-ready`,
        detail: `${context.sourceTitle ?? "来源审计"} 已绑定为本次刷新上下文；重建后会用 batch delta 复核权重变化。`,
      })
      return rebuildAndRefreshLoraReady({ auditContext: context })
    }
    setCollectionResultFocusNotice({
      headline: "先刷新 LoRA-ready",
      detail: `${card.targetLabel} 暂未找到可定位轨迹；将按当前选中上下文刷新，完成后请检查 verify 和回流轨迹。`,
      tone: "warn",
    })
    return rebuildAndRefreshLoraReady()
  }

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        请先打开一个交易复盘项目
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto bg-background">
      <div className="mx-auto flex min-h-full max-w-7xl flex-col gap-5 p-5">
        <header className="flex flex-col gap-3 border-b pb-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-normal">训练飞轮</h1>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              把自提问、市场验证、补证和人工分流沉淀成 stock-feedback 轨迹，再导出 PEFT-ready adapter 候选。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <ActionButton icon={RefreshCw} label="刷新" busy={loading} onClick={load} />
            <ActionButton icon={Play} label="Dry-run" busy={running === "dry"} onClick={() => runAction("dry", "stock-feedback-build-dry-run")} variant="outline" />
            <ActionButton icon={Save} label="写入轨迹" busy={running === "write"} onClick={() => runAction("write", "stock-feedback-build-write")} />
            <ActionButton icon={Target} label="Benchmark" busy={running === "bench"} onClick={() => runAction("bench", "stock-feedback-bench")} variant="outline" />
            <ActionButton icon={Database} label="LoRA-ready" busy={running === "export"} onClick={() => runAction("export", "stock-feedback-export-lora-ready")} variant="outline" />
            <ActionButton icon={ShieldCheck} label="校验" busy={running === "verify"} onClick={() => runAction("verify", "stock-feedback-verify")} variant="outline" />
            <ActionButton icon={Database} label="数据源" busy={running === "data-source-probe"} onClick={runDataSourceProbe} variant="outline" />
          </div>
        </header>

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {collectionResultFocusNotice && (
          <CollectionResultFocusNoticePanel
            notice={collectionResultFocusNotice}
            onDismiss={() => setCollectionResultFocusNotice(null)}
          />
        )}

        <DataSourceHealthPanel
          probe={dataSourceProbe}
          contextLabel={dataSourceProbeContextLabel}
          busy={running === "data-source-probe"}
          onCheck={runDataSourceProbe}
        />

        <EvidenceQueuePanel
          summary={evidenceQueueSummary}
          tasks={evidenceTaskRows}
          results={evidenceResultRows}
          sources={evidenceSourceRows}
          dlq={evidenceDlqRows}
          selectedTask={selectedEvidenceTask}
          selectedResults={selectedEvidenceResults}
          loading={loading}
          running={running}
          onSelectTask={(taskId) => setSelectedEvidenceTaskId(taskId)}
          onRunQueue={(write, taskId) => runEvidenceTaskQueue(write, taskId)}
          onReviewResult={reviewEvidenceResult}
          onUpdateDlq={updateEvidenceDlq}
        />

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <MetricTile label="今日轨迹" value={status?.counts?.trajectories ?? trajectories.length} icon={TrendingUp} />
          <MetricTile label="待补证" value={status?.counts?.pendingEvidence ?? 0} icon={Clock} tone="warn" />
          <MetricTile label="可进入训练" value={status?.counts?.trainable ?? 0} icon={CheckCircle2} tone="good" />
          <MetricTile label="priced-in 风险" value={status?.counts?.pricedInRisk ?? 0} icon={Filter} tone="neutral" />
          <MetricTile label="失败样本" value={status?.counts?.failedSamples ?? 0} icon={AlertTriangle} tone="danger" />
          <MetricTile label="模拟交易" value={status?.counts?.paperTrades ?? status?.paperTradeLedger?.counts?.total ?? 0} icon={Play} tone="neutral" />
          <MetricTile
            label="待结算"
            value={status?.counts?.paperTradePendingSettlement ?? status?.paperTradeLedger?.settlementQueue?.count ?? 0}
            icon={Clock}
            tone={(status?.counts?.paperTradePendingSettlement ?? status?.paperTradeLedger?.settlementQueue?.count ?? 0) > 0 ? "warn" : "neutral"}
          />
          <MetricTile
            label="待刷新"
            value={status?.counts?.paperTradeSettlementRefreshPending ?? status?.paperTradeLedger?.settlementRefreshAudit?.pending ?? 0}
            icon={RefreshCw}
            tone={(status?.counts?.paperTradeSettlementRefreshPending ?? status?.paperTradeLedger?.settlementRefreshAudit?.pending ?? 0) > 0 ? "warn" : "neutral"}
          />
          <MetricTile label="模拟候选" value={status?.counts?.paperTradePlanCandidates ?? status?.paperTradePlanning?.counts?.candidates ?? 0} icon={ListChecks} tone="neutral" />
          <MetricTile label="Agent 候选" value={status?.counts?.paperTradeAgentCandidates ?? status?.paperTradeAgent?.counts?.total ?? 0} icon={Bot} tone="neutral" />
          <MetricTile
            label="LLM复盘"
            value={status?.counts?.llmDiscretionaryReviewReady ?? status?.discretionaryReviewAudit?.counts?.readyPairs ?? 0}
            icon={GitCompareArrows}
            tone={(status?.counts?.llmDiscretionaryReviewReady ?? status?.discretionaryReviewAudit?.counts?.readyPairs ?? 0) > 0 ? "good" : "neutral"}
          />
        </section>

        <ProfitLedgerSeparationPanel summary={profitLedgerSeparationSummary} />

        <SampleDensityAuditPanel
          audit={status?.sampleDensityAudit}
          running={running}
          onPreviewSelfQuestion={() => runAction("self-question-preview", "self-question-loop-dry-run", ["--stages", "generate,validate,attribute"])}
          onWriteHypothesisFeedback={() => runAction("hypothesis-feedback-write", "hypothesis-evidence-feedback-write", ["--status", "watching"])}
          onCreateCollectionTask={() => runAction("collection-task-write", "stock-feedback-collection-task-write")}
          onBuildTrajectories={() => runAction("write", "stock-feedback-build-write")}
          onPreviewAgentCandidates={() => buildPaperTradeAgentCandidates(false)}
          onWriteAgentCandidates={() => buildPaperTradeAgentCandidates(true)}
          onBuildBenchmark={() => runAction("bench", "stock-feedback-bench")}
          onExportLoraReady={() => runAction("export", "stock-feedback-export-lora-ready")}
        />

        <BenchmarkBatchGatePanel
          summary={benchmarkBatchGateSummary}
          running={running === "bench"}
          onBuildBenchmark={() => runAction("bench", "stock-feedback-bench")}
        />

        <ReviewBacklogGatePanel
          summary={reviewBacklogGateSummary}
          onRefreshTrainable={reviewBacklogGateSummary.primaryActionKind === "refresh_lora_ready" ? () => rebuildAndRefreshLoraReady({ allValidationTargets: true }) : undefined}
          onSelectNextReview={nextHumanReviewSuggestion ? () => selectNextHumanReviewSuggestion(nextHumanReviewSuggestion) : undefined}
        />

        <ReviewActionFilterPanel
          options={reviewActionFilterOptions}
          value={reviewActionFilter}
          onChange={selectReviewActionFilter}
        />

        <ReviewActionBatchPreviewPanel
          preview={reviewActionBatchPreview}
          selectedTrajectoryId={selectedId}
          onSelectTrajectory={(trajectoryId) => {
            setSelectedId(trajectoryId)
            setSelectedAuditContext(null)
          }}
        />

        <PaperTradeLedgerPanel
          ledger={status?.paperTradeLedger}
          planning={status?.paperTradePlanning}
          agent={status?.paperTradeAgent}
          discretionaryReviewAudit={status?.discretionaryReviewAudit}
          trajectoryCount={paperTradeTrajectoryCount}
          running={running}
          onSelectPaperTrade={(paperTradeId) => {
            const matched = trajectories.find((item) => item.sourceRecordId === paperTradeId || item.evidenceState?.paperTradeId === paperTradeId)
            if (matched) {
              setSelectedId(matched.id)
              setSelectedAuditContext(null)
            }
          }}
          onSettlePaperTrade={prefillPaperTradeSettlementFromTrade}
          onUsePlanCandidate={prefillPaperTradeFromPlanCandidate}
          onProbePlanCandidate={(candidate) => prefillPaperTradeFromPlanCandidate(candidate, { probeEntryPrice: true })}
          onBuildAgentCandidates={() => buildPaperTradeAgentCandidates(false)}
          onWriteAgentCandidates={() => buildPaperTradeAgentCandidates(true)}
          onRunDiscretionaryReview={runPaperTradeDiscretionaryReview}
        />

        <PaperTradeSettlementPanel
          draft={paperTradeSettlementDraft}
          readiness={paperTradeSettlementReadiness}
          preview={paperTradeSettlementPreview}
          followUp={paperTradeSettlementFollowUp}
          running={running}
          onChange={updatePaperTradeSettlementDraft}
          onDryRun={() => runPaperTradeSettlement(false)}
          onWrite={() => runPaperTradeSettlement(true)}
          onBuildBenchmark={() => runAction("bench", "stock-feedback-bench")}
          onRefreshLoraReady={rebuildAndRefreshLoraReady}
        />

        <PaperTradeRecordPanel
          draft={paperTradeDraft}
          readiness={paperTradeReadiness}
          dataSourceGate={paperTradeDataSourceGate}
          probe={dataSourceProbe}
          preview={paperTradePreview}
          followUp={paperTradeFollowUp}
          settlementNotice={paperTradeSettlementNotice}
          running={running}
          prefillSourceLabel={selected ? [selected.stock?.name, selected.stock?.code].filter(Boolean).join(" ") || selected.hypothesis || selected.id : ""}
          onChange={updatePaperTradeDraft}
          onApplySettlement={applyPaperTradeSettlementSuggestion}
          onPrefillFromSelected={selected ? prefillPaperTradeFromSelected : undefined}
          onDryRun={() => runPaperTradeRecord(false)}
          onWrite={() => runPaperTradeRecord(true)}
          onBuildBenchmark={() => runAction("bench", "stock-feedback-bench")}
          onRefreshLoraReady={rebuildAndRefreshLoraReady}
        />

        <DynamicTestSetPlanPanel
          plan={dynamicTestSetPlan}
          running={running}
          onSelectStep={(step) => selectBenchmarkGapAction(step.action)}
          onPlanProfitCredit={(step, write) => planProfitCreditGapAction(step.action, write)}
        />

        <BenchmarkGapActionPanel
          actions={benchmarkGapActions}
          running={running}
          onSelectAction={selectBenchmarkGapAction}
          onPlanProfitCredit={planProfitCreditGapAction}
          onBuildBenchmark={() => runAction("bench", "stock-feedback-bench")}
        />

        {showActiveCollectionTask && activeCollectionTask && (
          <CollectionTaskPanel
            task={activeCollectionTask}
            running={running}
            onPlan={(task, write) => runCollectionTask(task, write)}
            onRecordResult={runCollectionResult}
          />
        )}

        {collectionResultFollowUp && !inlineCollectionResult && (
          <CollectionResultFollowUpPanel
            followUp={collectionResultFollowUp}
            roadmap={collectionResultRoadmap}
            reviewPreview={collectionResultReviewPreview}
            running={running}
            canContinueCollection={Boolean(collectionResultTask)}
            onContinueCollection={() => collectionResultTask && runCollectionTask(collectionResultTask, false)}
            onBuildBenchmark={() => runAction("bench", "stock-feedback-bench")}
            onRebuild={() => rebuildTrajectoriesForCollectionResult(lastResult?.collectionResult)}
            onRefreshLoraReady={rebuildAndRefreshLoraReady}
            onSelectRoadmapStep={selectCollectionResultRoadmapStep}
          />
        )}

        {status?.patternRadar && (
          <PatternRadarStrip
            radar={status.patternRadar}
            activePatternId={selectedPatternId}
            onSelectPattern={(patternId) => {
              setSelectedPatternId((current) => current === patternId ? null : patternId)
              setBatchRefreshMovementFilter("all")
              setProfitFeedbackFilter("all")
              setReviewActionFilter("all")
              setSelectedId(null)
              setSelectedAuditContext(null)
            }}
          />
        )}

        {(status?.recentCollectionResults?.length ?? 0) > 0 && (
          <CollectionResultsStrip
            results={status?.recentCollectionResults ?? []}
            roadmapContext={collectionResultRoadmapContext}
            pendingRebuilds={status?.counts?.collectionResultsAwaitingTrajectory ?? 0}
            running={running}
            onSelectPattern={(patternId) => {
              setSelectedPatternId((current) => current === patternId ? null : patternId)
              setBatchRefreshMovementFilter("all")
              setProfitFeedbackFilter("all")
              setReviewActionFilter("all")
              setSelectedId(null)
              setSelectedAuditContext(null)
            }}
            onContinueCollection={(task) => runCollectionTask(task, false)}
            onBuildBenchmark={() => runAction("bench", "stock-feedback-bench")}
            onRebuild={(result) => rebuildTrajectoriesForCollectionResult(result)}
            onRefreshLoraReady={refreshLoraReadyForCollectionResult}
            onSelectRoadmapStep={selectCollectionResultRoadmapStep}
          />
        )}

        <ArtifactSourceAuditPanel
          benchmark={status?.artifactSourceMix?.benchmark}
          loraReady={status?.artifactSourceMix?.loraReady}
          selectedTrajectoryId={selectedId}
          submittedAuditReviews={submittedAuditReviews}
          auditRefreshDiffs={auditRefreshDiffs}
          auditBatchRefreshSummary={activeAuditBatchRefreshSummary}
          batchRefreshMovementFilter={batchRefreshMovementFilter}
          onSelectBatchRefreshMovementFilter={selectBatchRefreshMovementFilter}
          onSelectTrajectory={(trajectoryId, context) => {
            setSelectedPatternId(null)
            setTarget("all")
            setBatchRefreshMovementFilter("all")
            setProfitFeedbackFilter("all")
            setReviewActionFilter("all")
            setSelectedId(trajectoryId)
            setSelectedAuditContext(context ?? null)
          }}
        />

        <ProfitFeedbackReviewWorklistPanel
          items={profitFeedbackWorklist}
          selectedTrajectoryId={selectedId}
          onSelect={selectProfitFeedbackWorklistItem}
        />

        <main className="grid min-h-[620px] gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <section className="flex min-w-0 flex-col gap-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 flex-col gap-2">
                <div className="flex flex-wrap gap-1 rounded-md border bg-muted/40 p-1">
                  {TARGETS.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setTarget(item.id)
                        setBatchRefreshMovementFilter("all")
                        setProfitFeedbackFilter("all")
                        setReviewActionFilter("all")
                        setSelectedAuditContext(null)
                      }}
                      className={cn(
                        "h-8 rounded px-2.5 text-sm transition-colors",
                        target === item.id
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:bg-background/70 hover:text-foreground",
                      )}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-1 rounded-md border bg-muted/25 p-1">
                  {PROFIT_FILTERS.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setProfitFeedbackFilter(item.id)
                        setReviewActionFilter("all")
                        setSelectedAuditContext(null)
                      }}
                      className={cn(
                        "h-7 rounded px-2 text-xs transition-colors",
                        profitFeedbackFilter === item.id
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:bg-background/70 hover:text-foreground",
                      )}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="text-sm text-muted-foreground sm:text-right">
                {trajectoryCountText}
              </div>
            </div>

            {selectedPattern && (
              <div className="space-y-2">
                <div className="flex flex-col gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <span className="font-medium">当前模式：{selectedPattern.label ?? selectedPattern.id}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {patternActionLabel(selectedPattern.health?.nextAction)}
                    </span>
                  </div>
                  <Button type="button" size="sm" variant="outline" onClick={() => {
                    setSelectedPatternId(null)
                    setBatchRefreshMovementFilter("all")
                    setProfitFeedbackFilter("all")
                    setReviewActionFilter("all")
                    setSelectedAuditContext(null)
                  }}>
                    <X className="h-4 w-4" />
                    清除模式
                  </Button>
                </div>
                {selectedPattern.collectionTask && (
                  <CollectionTaskPanel
                    task={selectedPattern.collectionTask}
                    running={running}
                    onPlan={(task, write) => runCollectionTask(task, write)}
                    onRecordResult={runCollectionResult}
                  />
                )}
              </div>
            )}

            {batchRefreshMovementFilter !== "all" && (
              <div className="flex flex-col gap-2 rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <span className="font-medium">变化筛选：{batchRefreshMovementFilterLabel}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {visibleTrajectories.length}/{trajectories.length} 条轨迹；用于优先复核刚被调权或改分流的候选。
                  </span>
                </div>
                <Button type="button" size="sm" variant="outline" onClick={() => {
                  setBatchRefreshMovementFilter("all")
                  setSelectedAuditContext(null)
                }}>
                  <X className="h-4 w-4" />
                  清除变化
                </Button>
              </div>
            )}

            {reviewActionFilter !== "all" && (
              <div className="flex flex-col gap-2 rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <span className="font-medium">Review 队列：{reviewActionFilterLabel}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {visibleTrajectories.length}/{movementFilteredTrajectories.length} 条轨迹；用于把待审样本按人审动作优先处理。
                  </span>
                </div>
                <Button type="button" size="sm" variant="outline" onClick={() => {
                  setReviewActionFilter("all")
                  setSelectedAuditContext(null)
                }}>
                  <X className="h-4 w-4" />
                  清除队列
                </Button>
              </div>
            )}

            {profitFeedbackFilter !== "all" && (
              <div className="flex flex-col gap-2 rounded-md border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <span className="font-medium">收益筛选：{profitFeedbackFilterLabel}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {visibleTrajectories.length}/{movementFilteredTrajectories.length} 条轨迹；用于把真实收益反馈分流到 adapter、eval 或 preference。
                  </span>
                </div>
                <Button type="button" size="sm" variant="outline" onClick={() => {
                  setProfitFeedbackFilter("all")
                  setSelectedAuditContext(null)
                }}>
                  <X className="h-4 w-4" />
                  清除收益
                </Button>
              </div>
            )}

            <div className="overflow-hidden rounded-md border">
              <div className="grid grid-cols-[120px_minmax(220px,1fr)_128px_108px] border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
                <span>训练目标</span>
                <span>假设 / 标的</span>
                <span>质量门</span>
                <span>去向</span>
              </div>
              <div className="max-h-[520px] overflow-auto">
                {loading && visibleTrajectories.length === 0 && (
                  <div className="flex h-48 items-center justify-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    正在读取训练轨迹
                  </div>
                )}
                {!loading && visibleTrajectories.length === 0 && (
                  <div className="flex h-48 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                    <FileText className="h-8 w-8 opacity-60" />
                    {batchRefreshMovementFilter !== "all"
                      ? `当前批次暂无 ${activeClientFilterText} 对应轨迹`
                      : reviewActionFilter !== "all"
                        ? `当前列表暂无 ${reviewActionFilterLabel} 待审轨迹`
                      : profitFeedbackFilter !== "all"
                        ? `当前列表暂无 ${profitFeedbackFilterLabel} 对应轨迹`
                      : selectedPattern
                        ? `暂无 ${selectedPattern.label ?? selectedPattern.id} 轨迹，模式雷达建议：${patternActionLabel(selectedPattern.health?.nextAction)}`
                        : "暂无轨迹，先运行 Dry-run 或写入轨迹"}
                  </div>
                )}
                {visibleTrajectories.map((item) => {
                  const profitSignal = buildProfitFeedbackListSignal(item.profitFeedback)
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setSelectedId(item.id)
                        setSelectedAuditContext(null)
                      }}
                      className={cn(
                        "grid w-full grid-cols-[120px_minmax(220px,1fr)_128px_108px] items-start gap-3 border-b px-3 py-3 text-left text-sm transition-colors last:border-b-0 hover:bg-muted/40",
                        selected?.id === item.id && "bg-muted/60",
                      )}
                    >
                      <span className="font-medium">{TARGET_LABELS[item.validationTarget] ?? item.validationTarget}</span>
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{item.hypothesis || item.question || item.id}</span>
                        <span className="mt-1 block truncate text-xs text-muted-foreground">
                          {[item.stock?.name, item.stock?.code].filter(Boolean).join(" ") || "未标注个股"}
                        </span>
                        {(item.source === "stock-feedback-paper-trade" || item.sourceKind === "stock-feedback-paper-trade") && (
                          <span className="mt-1 inline-flex w-fit rounded border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">
                            模拟交易轨迹 · {paperTradeTrackLabel(item.paperTradeState?.track ?? item.evidenceState?.paperTradeTrack)}
                          </span>
                        )}
                        {profitSignal && <ProfitFeedbackListSignalPill signal={profitSignal} />}
                        {(item.marketPatterns?.length ?? 0) > 0 && (
                          <span className="mt-1 block truncate text-xs text-muted-foreground">
                            {item.marketPatterns?.map((pattern) => pattern.label ?? pattern.id).filter(Boolean).join(" / ")}
                          </span>
                        )}
                      </span>
                      <GateBadge gate={item.qualityGate?.status} highConfidence={item.qualityGate?.highConfidenceEligible} />
                      <span className="text-xs text-muted-foreground">{(item.trainingUse ?? []).join(" / ") || "eval"}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          </section>

          <aside className="min-w-0 border-l pl-5">
          <TrajectoryDetail
            trajectory={selected}
            reviewItem={selectedReview}
            auditContext={selectedAuditContext}
            reviewBucketContext={selectedReviewBucketContext}
            submissionNotice={selectedSubmissionNotice}
            reviewRefreshPrompt={selectedReviewRefreshPrompt}
            reviewRefreshResult={selectedReviewRefreshResult}
            refreshDiff={selectedRefreshDiff}
            latestTrainableArtifactGeneratedAt={status?.artifactSourceMix?.loraReady?.generatedAt ?? null}
            nextReviewSuggestion={nextHumanReviewSuggestion}
            runningReview={running?.startsWith("review-") ? running : null}
            refreshingLoraReady={running === "refresh-lora-ready"}
            onExportCandidate={() => runAction("export", "stock-feedback-export-lora-ready", selected ? ["--validation-target", selected.validationTarget] : [])}
            onBuildBenchmark={() => runAction("bench", "stock-feedback-bench")}
            onRebuild={() => runAction("write", "stock-feedback-build-write")}
            onRefreshLoraReady={rebuildAndRefreshLoraReady}
            onSelectNextReview={selectNextHumanReviewSuggestion}
            inlineCollectionTask={inlineProfitCollectionTask}
            inlineCollectionResultFollowUp={inlineCollectionResultFollowUp}
            inlineCollectionResultRoadmap={inlineCollectionResultRoadmap}
            inlineCollectionResultTask={inlineCollectionResultTask}
            inlineCollectionResultReviewPreview={inlineCollectionResultReviewPreview}
            collectionTaskRunning={running}
            onCreateProfitCollectionTask={(task) => runCollectionTask(task, false)}
            onPlanCollectionTask={(task, write) => runCollectionTask(task, write)}
            onRecordCollectionResult={runCollectionResult}
            onContinueCollectionResultCollection={() => inlineCollectionResultTask && runCollectionTask(inlineCollectionResultTask, false)}
            onRebuildCollectionResult={() => rebuildTrajectoriesForCollectionResult(lastResult?.collectionResult)}
            onSelectCollectionResultRoadmapStep={selectCollectionResultRoadmapStep}
            onReview={submitReview}
          />
          </aside>
        </main>

        <TrainingFlywheelExtras />

        <footer className="grid gap-3 border-t pt-4 md:grid-cols-5">
          <StatusPanel title="Benchmark 覆盖" value={status?.counts?.benchmarkBatches ?? 0} detail={benchmarkDetail(status?.dynamicBenchmark, status?.latest?.benchmarkManifest, status?.artifactSourceMix?.benchmark)} />
          <StatusPanel title="LoRA-ready 准备度" value={status?.counts?.adapterCandidates ?? 0} detail={loraReadyDetail(status?.adapterCurriculum, status?.counts?.loraReadyBatches, status?.latest?.loraReadyManifest, status?.artifactSourceMix?.loraReady)} />
          <StatusPanel title="模式雷达" value={status?.patternRadar?.counts?.coveredPatterns ?? 0} detail={patternRadarDetail(status?.patternRadar)} />
          <StatusPanel title="待人工 review" value={status?.counts?.pendingReviews ?? reviewQueue?.counts?.pending ?? 0} detail={`${status?.counts?.reviewEvents ?? reviewQueue?.counts?.reviewEvents ?? 0} 条 review event`} />
          <StatusPanel title="最近动作" value={lastResult?.count ?? lastResult?.issueCount ?? 0} detail={lastResult ? resultDetail(lastResult) : "等待下一次构建或校验"} />
        </footer>
      </div>
    </div>
  )
}

function ActionButton({
  icon: Icon,
  label,
  busy,
  onClick,
  variant = "default",
}: {
  icon: LucideIcon
  label: string
  busy?: boolean
  onClick: () => void
  variant?: "default" | "outline"
}) {
  return (
    <Button type="button" variant={variant} onClick={onClick} disabled={busy} className="min-w-0">
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
      <span>{label}</span>
    </Button>
  )
}

function DataSourceHealthPanel({
  probe,
  contextLabel,
  busy,
  onCheck,
}: {
  probe?: DataSourceProbeResult | null
  contextLabel: string
  busy?: boolean
  onCheck: () => void
}) {
  const summary = summarizeDataSourceProbe(probe)
  const targetLabel = probe?.query
    ? [probe.query.stockCode, probe.query.tradeDate].filter(Boolean).join(" · ")
    : contextLabel
  const toneClass = {
    neutral: "border-border bg-muted text-muted-foreground",
    good: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700",
    warn: "border-amber-500/30 bg-amber-500/10 text-amber-700",
    danger: "border-destructive/30 bg-destructive/10 text-destructive",
  }[summary.tone]
  const endpoints = (probe?.endpoints ?? []).slice(0, 6)
  const entryPriceSuggestion = buildEntryPriceSuggestionFromProbe(probe)

  return (
    <section className="rounded-md border bg-card p-3">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded border", toneClass)}>
            <Database className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium">{summary.headline}</p>
              <span className={cn("rounded border px-2 py-0.5 text-xs", toneClass)}>{summary.badge}</span>
            </div>
            <p className="mt-1 break-words text-xs text-muted-foreground">
              {[summary.detail, targetLabel].filter(Boolean).join(" · ")}
            </p>
          </div>
        </div>
        <Button type="button" variant="outline" onClick={onCheck} disabled={busy} className="h-8 shrink-0">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          <span>检查</span>
        </Button>
      </div>
      {endpoints.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {endpoints.map((endpoint) => (
            <span
              key={endpoint.api ?? endpoint.purpose}
              className={cn(
                "rounded border px-2 py-1 text-xs",
                endpoint.status === "ok"
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700"
                  : endpoint.status === "skipped"
                    ? "border-border bg-muted text-muted-foreground"
                    : "border-amber-500/30 bg-amber-500/10 text-amber-700",
              )}
            >
              {endpoint.api ?? endpoint.purpose}: {endpoint.status ?? "unknown"} · {endpoint.rowCount ?? 0}
            </span>
          ))}
        </div>
      )}
      {entryPriceSuggestion && (
        <div className="mt-2 rounded-md border border-primary/20 bg-primary/5 px-2 py-1.5 text-xs text-primary">
          建议入场价：{entryPriceSuggestion.label}
          <span className="ml-2 text-muted-foreground">{entryPriceSuggestion.ref}</span>
        </div>
      )}
    </section>
  )
}

function EvidenceQueuePanel({
  summary,
  tasks,
  results,
  sources,
  dlq,
  selectedTask,
  selectedResults,
  loading,
  running,
  onSelectTask,
  onRunQueue,
  onReviewResult,
  onUpdateDlq,
}: {
  summary: EvidenceQueueSummary
  tasks: StockFeedbackEvidenceTask[]
  results: StockFeedbackEvidenceResult[]
  sources: StockFeedbackEvidenceSourceHealth[]
  dlq: StockFeedbackEvidenceDlqEntry[]
  selectedTask: StockFeedbackEvidenceTask | null
  selectedResults: StockFeedbackEvidenceResult[]
  loading: boolean
  running: string | null
  onSelectTask: (taskId: string) => void
  onRunQueue: (write: boolean, taskId?: string | null) => void
  onReviewResult: (resultId: string, action: "approve" | "reject" | "needs_more_evidence") => void
  onUpdateDlq: (entry: StockFeedbackEvidenceDlqEntry, action: "retry" | "discard") => void
}) {
  const toneClass = {
    good: "border-emerald-500/30 bg-emerald-500/10 text-emerald-800",
    warn: "border-amber-500/30 bg-amber-500/10 text-amber-800",
    danger: "border-destructive/30 bg-destructive/10 text-destructive",
    neutral: "border-primary/20 bg-primary/5 text-primary",
  }[summary.tone]
  const busyDry = running === "evidence-run-dry"
  const busyWrite = running === "evidence-run-write"
  const selectedTaskId = selectedTask?.taskId ?? null
  const recentResults = selectedResults.length > 0
    ? selectedResults
    : results.slice(0, 3)
  const openDlq = dlq.filter((entry) => entry.status === "open")

  return (
    <section className="rounded-md border bg-card">
      <div className="flex flex-col gap-3 border-b p-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-medium">Evidence Queue</h2>
            <span className={cn("rounded border px-2 py-0.5 text-xs", toneClass)}>{summary.headline}</span>
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{summary.detail}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => onRunQueue(false, selectedTaskId)} disabled={busyDry || tasks.length === 0}>
            {busyDry ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            <span>预览队列</span>
          </Button>
          <Button type="button" size="sm" onClick={() => onRunQueue(true, selectedTaskId)} disabled={busyWrite || tasks.length === 0}>
            {busyWrite ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            <span>写入运行</span>
          </Button>
        </div>
      </div>

      <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 border-b lg:border-b-0 lg:border-r">
          <div className="grid grid-cols-3 gap-2 border-b bg-muted/30 p-3 text-xs md:grid-cols-6">
            <EvidenceQueueCount label="pending" value={summary.pending} />
            <EvidenceQueueCount label="running" value={summary.running} />
            <EvidenceQueueCount label="review" value={summary.awaitingReview} />
            <EvidenceQueueCount label="done" value={summary.completed} />
            <EvidenceQueueCount label="failed" value={summary.failed} />
            <EvidenceQueueCount label="DLQ" value={summary.openDlq} tone={summary.openDlq > 0 ? "danger" : "neutral"} />
          </div>

          <div className="border-b px-3 py-2">
            <div className="flex flex-wrap gap-1">
              {sources.length === 0 && (
                <span className="rounded border bg-muted px-2 py-1 text-xs text-muted-foreground">source health 待生成</span>
              )}
              {sources.slice(0, 6).map((source) => (
                <span
                  key={source.source}
                  className={cn("rounded border px-2 py-1 text-xs", evidenceSourceTone(source))}
                  title={`${source.source ?? "source"} · ok ${source.ok ?? 0}/${source.total ?? 0}`}
                >
                  {source.source ?? "source"} · {source.lastStatus ?? "unknown"} · {source.successRate ?? 0}%
                </span>
              ))}
            </div>
          </div>

          <div className="max-h-[360px] overflow-auto">
            {loading && tasks.length === 0 && (
              <div className="flex h-32 items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                正在读取 EvidenceTask
              </div>
            )}
            {!loading && tasks.length === 0 && (
              <div className="flex h-32 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                <ListChecks className="h-8 w-8 opacity-60" />
                暂无 EvidenceTask
              </div>
            )}
            {tasks.map((task) => (
              <button
                key={task.taskId}
                type="button"
                onClick={() => task.taskId && onSelectTask(task.taskId)}
                className={cn(
                  "grid w-full grid-cols-[104px_minmax(160px,1fr)_112px] items-start gap-3 border-b px-3 py-3 text-left text-sm transition-colors last:border-b-0 hover:bg-muted/40",
                  selectedTask?.taskId === task.taskId && "bg-muted/60",
                )}
              >
                <span className={cn("w-fit rounded border px-2 py-0.5 text-xs", evidenceStatusTone(task.status))}>
                  {evidenceTaskStatusLabel(task.status)}
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-medium">{[task.stockName, task.stockCode].filter(Boolean).join(" ") || task.taskId}</span>
                  <span className="mt-1 block truncate text-xs text-muted-foreground">
                    {[task.taskType, task.targetFields?.join(", ")].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span className="text-xs text-muted-foreground">
                  {(task.preferredSources ?? []).slice(0, 3).join(" / ") || "source 待定"}
                </span>
              </button>
            ))}
          </div>
        </div>

        <aside className="min-w-0 p-3">
          {selectedTask ? (
            <div className="space-y-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="truncate text-sm font-medium">{[selectedTask.stockName, selectedTask.stockCode].filter(Boolean).join(" ") || selectedTask.taskId}</h3>
                  <span className={cn("rounded border px-2 py-0.5 text-xs", evidenceStatusTone(selectedTask.status))}>
                    {evidenceTaskStatusLabel(selectedTask.status)}
                  </span>
                </div>
                <p className="mt-1 break-words text-xs text-muted-foreground">
                  {selectedTask.taskId} · {selectedTask.taskType ?? "general"} · {(selectedTask.targetFields ?? []).join(", ") || "targetFields 待补"}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => onRunQueue(false, selectedTask.taskId)} disabled={busyDry}>
                  {busyDry ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                  <span>预览</span>
                </Button>
                <Button type="button" size="sm" onClick={() => onRunQueue(true, selectedTask.taskId)} disabled={busyWrite}>
                  {busyWrite ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  <span>写入</span>
                </Button>
              </div>

              <div className="space-y-2">
                <h4 className="text-xs font-medium text-muted-foreground">EvidenceResult</h4>
                {recentResults.length === 0 && (
                  <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">暂无结果</div>
                )}
                {recentResults.map((result) => (
                  <EvidenceResultRow
                    key={result.resultId}
                    result={result}
                    running={running}
                    onReview={onReviewResult}
                  />
                ))}
              </div>
            </div>
          ) : (
            <div className="flex h-full min-h-40 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
              <FileText className="h-8 w-8 opacity-60" />
              选择一条 EvidenceTask 查看详情
            </div>
          )}
        </aside>
      </div>

      {openDlq.length > 0 && (
        <div className="border-t bg-destructive/5 p-3">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-destructive">
            <AlertTriangle className="h-4 w-4" />
            DLQ 待处理
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            {openDlq.slice(0, 4).map((entry) => (
              <div key={entry.id ?? entry.taskId} className="flex min-w-0 flex-col gap-2 rounded-md border bg-background p-2 text-xs">
                <div className="min-w-0">
                  <div className="truncate font-medium">{entry.taskId ?? entry.id}</div>
                  <div className="mt-1 line-clamp-2 text-muted-foreground">{entry.reason ?? "未记录原因"}</div>
                </div>
                <div className="flex gap-2">
                  <Button type="button" size="sm" variant="outline" className="h-7" onClick={() => onUpdateDlq(entry, "retry")} disabled={running === "evidence-dlq-retry"}>
                    {running === "evidence-dlq-retry" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    <span>retry</span>
                  </Button>
                  <Button type="button" size="sm" variant="outline" className="h-7" onClick={() => onUpdateDlq(entry, "discard")} disabled={running === "evidence-dlq-discard"}>
                    {running === "evidence-dlq-discard" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                    <span>discard</span>
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

function EvidenceQueueCount({
  label,
  value,
  tone = "neutral",
}: {
  label: string
  value: number
  tone?: "neutral" | "danger"
}) {
  return (
    <div className={cn("rounded border bg-background px-2 py-1.5", tone === "danger" && "border-destructive/30 bg-destructive/10")}>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-1 text-base font-semibold tabular-nums">{value}</div>
    </div>
  )
}

function EvidenceResultRow({
  result,
  running,
  onReview,
}: {
  result: StockFeedbackEvidenceResult
  running: string | null
  onReview: (resultId: string, action: "approve" | "reject" | "needs_more_evidence") => void
}) {
  const resultId = result.resultId ?? ""
  const awaitingReview = result.status === "awaiting_review"
  return (
    <div className="rounded-md border bg-background p-2 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={cn("rounded border px-2 py-0.5", evidenceStatusTone(result.status))}>{evidenceResultStatusLabel(result.status)}</span>
        <span className="text-muted-foreground">conf {result.overallConfidence ?? "-"}</span>
      </div>
      <div className="mt-2 break-words text-muted-foreground">
        {(result.evidenceRefs ?? result.sourceRefs ?? []).slice(0, 3).join(" · ") || "等待 evidence refs"}
      </div>
      {awaitingReview && resultId && (
        <div className="mt-2 flex flex-wrap gap-1">
          <Button type="button" size="sm" className="h-7" onClick={() => onReview(resultId, "approve")} disabled={running === "evidence-review-approve"}>
            确认
          </Button>
          <Button type="button" size="sm" variant="outline" className="h-7" onClick={() => onReview(resultId, "needs_more_evidence")} disabled={running === "evidence-review-needs_more_evidence"}>
            补证
          </Button>
          <Button type="button" size="sm" variant="outline" className="h-7" onClick={() => onReview(resultId, "reject")} disabled={running === "evidence-review-reject"}>
            拒绝
          </Button>
        </div>
      )}
    </div>
  )
}

function evidenceTaskStatusLabel(status?: string) {
  return {
    pending: "pending",
    running: "running",
    awaiting_review: "review",
    completed: "done",
    failed: "failed",
    dlq: "DLQ",
  }[status ?? ""] ?? status ?? "unknown"
}

function evidenceResultStatusLabel(status?: string) {
  return {
    awaiting_review: "review",
    completed: "done",
    rejected: "rejected",
    failed: "failed",
  }[status ?? ""] ?? status ?? "unknown"
}

function evidenceStatusTone(status?: string) {
  if (status === "completed") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700"
  if (status === "awaiting_review" || status === "pending" || status === "running") return "border-amber-500/30 bg-amber-500/10 text-amber-700"
  if (status === "failed" || status === "dlq" || status === "rejected") return "border-destructive/30 bg-destructive/10 text-destructive"
  return "border-border bg-muted text-muted-foreground"
}

function evidenceSourceTone(source: StockFeedbackEvidenceSourceHealth) {
  if (source.circuitStatus === "open") return "border-destructive/30 bg-destructive/10 text-destructive"
  if (source.lastStatus === "ok") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700"
  return "border-amber-500/30 bg-amber-500/10 text-amber-700"
}

function MetricTile({
  label,
  value,
  icon: Icon,
  tone = "neutral",
}: {
  label: string
  value: number
  icon: LucideIcon
  tone?: "neutral" | "good" | "warn" | "danger"
}) {
  const toneClass = {
    neutral: "text-primary bg-primary/10",
    good: "text-emerald-600 bg-emerald-500/10",
    warn: "text-amber-600 bg-amber-500/10",
    danger: "text-destructive bg-destructive/10",
  }[tone]
  return (
    <div className="rounded-md border bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className={cn("flex h-7 w-7 items-center justify-center rounded", toneClass)}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  )
}

function ProfitLedgerSeparationPanel({
  summary,
}: {
  summary: ProfitLedgerSeparationSummary
}) {
  const toneClass = summary.tone === "good"
    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-800"
    : "border-amber-500/30 bg-amber-500/10 text-amber-800"
  const gateLabel = summary.blocksHighConfidenceProfit ? "真实 high-confidence 阻断" : "真实样本可人审"
  return (
    <section className={cn("rounded-md border px-3 py-2", toneClass)}>
      <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-medium">收益账本隔离门</h2>
            <span className="rounded border border-current/20 bg-background/60 px-1.5 py-0.5 text-xs">
              {gateLabel}
            </span>
            {summary.paperOnly && (
              <span className="rounded border border-current/20 bg-background/60 px-1.5 py-0.5 text-xs">
                paper-only
              </span>
            )}
          </div>
          <p className="mt-1 text-xs leading-5">
            {summary.headline}；{summary.detail}
          </p>
        </div>
        <div className="flex flex-wrap gap-1 text-xs">
          <span className="rounded border border-current/20 bg-background/60 px-1.5 py-0.5">真实手法 {summary.realPatternExecutionSamples}</span>
          <span className="rounded border border-current/20 bg-background/60 px-1.5 py-0.5">盈利结果 {summary.profitableOutcomeSamples}</span>
          <span className="rounded border border-current/20 bg-background/60 px-1.5 py-0.5">确认采集 {summary.confirmedCollectionResults}</span>
          <span className="rounded border border-current/20 bg-background/60 px-1.5 py-0.5">paper {summary.paperTrades}</span>
          <span className="rounded border border-current/20 bg-background/60 px-1.5 py-0.5">paper 盈利 {summary.paperProfitable}</span>
        </div>
      </div>
      <div className="mt-2 grid gap-2 border-t border-current/20 pt-2 text-xs md:grid-cols-3">
        <div>
          <div className="font-medium">真实收益提权</div>
          <div className="mt-1 leading-5 opacity-80">
            {summary.blocksHighConfidenceProfit ? "必须先有真实 ledger / sourceRefs / price SQL 证据。" : "可进入 review 后再提升训练权重。"}
          </div>
        </div>
        <div>
          <div className="font-medium">paper trade 去向</div>
          <div className="mt-1 leading-5 opacity-80">
            模拟收益只能进入 eval/SFT/adapter 候选低权重，不能冒充真实盈利。
          </div>
        </div>
        <div>
          <div className="font-medium">下一步</div>
          <div className="mt-1 leading-5 opacity-80">{summary.nextAction}</div>
        </div>
      </div>
    </section>
  )
}

function SampleDensityAuditPanel({
  audit,
  running,
  onPreviewSelfQuestion,
  onWriteHypothesisFeedback,
  onCreateCollectionTask,
  onBuildTrajectories,
  onPreviewAgentCandidates,
  onWriteAgentCandidates,
  onBuildBenchmark,
  onExportLoraReady,
}: {
  audit?: StockFeedbackSampleDensityAudit | null
  running?: string | null
  onPreviewSelfQuestion?: () => void
  onWriteHypothesisFeedback?: () => void
  onCreateCollectionTask?: () => void
  onBuildTrajectories?: () => void
  onPreviewAgentCandidates?: () => void
  onWriteAgentCandidates?: () => void
  onBuildBenchmark?: () => void
  onExportLoraReady?: () => void
}) {
  if (!audit) return null
  const counts = audit.counts ?? {}
  const gaps = audit.gaps ?? []
  const actionAvailability = sampleDensityActionAvailability(audit)
  const sourceInputSteps = sampleDensitySourceInputSteps(audit)
  const rebuildSteps = sampleDensityRebuildSteps(audit)
  const firstSampleGuide = sampleDensityFirstSampleGuide(audit)
  const toneClass = audit.tone === "good"
    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-800"
    : audit.tone === "danger"
      ? "border-destructive/30 bg-destructive/10 text-destructive"
      : "border-amber-500/30 bg-amber-500/10 text-amber-800"
  const statusLabel = {
    blocked: "阻塞",
    thin: "偏薄",
    watch: "观察",
    ready: "可推进",
  }[(audit.status ?? "") as string] ?? "未知"
  const previewCount = counts.paperTradeAgentPreviewCandidates ?? 0
  const renderFirstSampleGuideButton = (
    action: SampleDensityFirstSampleGuideAction,
    label: string,
    variant: "default" | "outline" = "outline",
  ): ReactNode => {
    if (action === "idle" || !label) return null
    const config: {
      onClick?: () => void
      runningKey: string
      icon: LucideIcon
      disabled?: boolean
    } | null = {
      hypothesis_feedback_write: {
        onClick: onWriteHypothesisFeedback,
        runningKey: "hypothesis-feedback-write",
        icon: Save,
      },
      build_trajectories_write: {
        onClick: onBuildTrajectories,
        runningKey: "write",
        icon: Save,
        disabled: !actionAvailability.canBuildTrajectories,
      },
      paper_trade_agent_preview: {
        onClick: onPreviewAgentCandidates,
        runningKey: "paper-trade-agent-dry",
        icon: Bot,
      },
      manual_self_question_preview: {
        onClick: onPreviewSelfQuestion,
        runningKey: "self-question-preview",
        icon: Play,
      },
      collection_task_write: {
        onClick: onCreateCollectionTask,
        runningKey: "collection-task-write",
        icon: ListChecks,
      },
      idle: null,
    }[action]
    if (!config) return null
    const Icon = config.icon
    const isRunning = running === config.runningKey
    return (
      <Button
        type="button"
        size="sm"
        variant={variant}
        className={cn("h-8", variant === "outline" && "bg-background/70")}
        onClick={config.onClick}
        disabled={!config.onClick || config.disabled || isRunning}
      >
        {isRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />}
        {label}
      </Button>
    )
  }
  return (
    <section className={cn("rounded-md border px-3 py-2", toneClass)}>
      <div className="flex flex-col gap-2 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-medium">样本密度审计</h2>
            <span className="rounded border border-current/20 bg-background/60 px-1.5 py-0.5 text-xs">{statusLabel}</span>
            <span className="rounded border border-current/20 bg-background/60 px-1.5 py-0.5 text-xs">缺口 {gaps.length}</span>
            {audit.writeBoundary?.readOnly && (
              <span className="rounded border border-current/20 bg-background/60 px-1.5 py-0.5 text-xs">只读</span>
            )}
          </div>
          <p className="mt-1 text-xs leading-5">
            {sampleDensityAuditDetail(audit)}
          </p>
        </div>
        <div className="flex flex-wrap gap-1 text-xs">
          <span className="rounded border border-current/20 bg-background/60 px-1.5 py-0.5">轨迹 {counts.trajectories ?? 0}</span>
          <span className="rounded border border-current/20 bg-background/60 px-1.5 py-0.5">输入 {sampleDensityUpstreamInputTotal(audit)}</span>
          <span className="rounded border border-current/20 bg-background/60 px-1.5 py-0.5">预期 {counts.expectationTradeTrajectories ?? 0}</span>
          <span className="rounded border border-current/20 bg-background/60 px-1.5 py-0.5">Agent 预览 {previewCount}</span>
          <span className="rounded border border-current/20 bg-background/60 px-1.5 py-0.5">Agent 已写 {counts.paperTradeAgentWrittenCandidates ?? 0}</span>
          <span className="rounded border border-current/20 bg-background/60 px-1.5 py-0.5">paper closed {counts.settledPaperTrades ?? 0}</span>
          <span className="rounded border border-current/20 bg-background/60 px-1.5 py-0.5">人审 paper {counts.reviewedPaperAdapterTrajectories ?? 0}</span>
          <span className="rounded border border-current/20 bg-background/60 px-1.5 py-0.5">Benchmark {counts.benchmarkBatches ?? 0}</span>
          <span className="rounded border border-current/20 bg-background/60 px-1.5 py-0.5">LoRA {counts.loraReadyBatches ?? 0}</span>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" className="h-8 bg-background/70" onClick={onBuildTrajectories} disabled={!onBuildTrajectories || !actionAvailability.canBuildTrajectories || running === "write"}>
          {running === "write" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          写入轨迹
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-8 bg-background/70" onClick={onWriteAgentCandidates} disabled={!onWriteAgentCandidates || !actionAvailability.canWriteAgentCandidates || running === "paper-trade-agent-write"}>
          {running === "paper-trade-agent-write" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bot className="h-3.5 w-3.5" />}
          写入 Agent 候选
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-8 bg-background/70" onClick={onBuildBenchmark} disabled={!onBuildBenchmark || !actionAvailability.canBuildBenchmark || running === "bench"}>
          {running === "bench" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Target className="h-3.5 w-3.5" />}
          生成 Benchmark
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-8 bg-background/70" onClick={onExportLoraReady} disabled={!onExportLoraReady || !actionAvailability.canExportLoraReady || running === "export"}>
          {running === "export" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Database className="h-3.5 w-3.5" />}
          刷新 LoRA-ready
        </Button>
      </div>
      <div className="mt-2 flex flex-wrap gap-1 text-xs">
        <span className="rounded border border-current/20 bg-background/60 px-1.5 py-0.5">{actionAvailability.buildTrajectoriesReason}</span>
        <span className="rounded border border-current/20 bg-background/60 px-1.5 py-0.5">{actionAvailability.writeAgentCandidatesReason}</span>
        <span className="rounded border border-current/20 bg-background/60 px-1.5 py-0.5">{actionAvailability.buildBenchmarkReason}</span>
        <span className="rounded border border-current/20 bg-background/60 px-1.5 py-0.5">{actionAvailability.exportLoraReadyReason}</span>
      </div>
      <div className="mt-2 rounded-md border border-current/20 bg-background/60 p-2 text-xs">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">第一条样本向导</span>
              <span className="rounded border border-current/20 px-1.5 py-0.5 opacity-80">{firstSampleGuide.status}</span>
            </div>
            <div className="mt-1 font-medium">{firstSampleGuide.headline}</div>
            <div className="mt-1 leading-5 opacity-80">{firstSampleGuide.detail}</div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {renderFirstSampleGuideButton(firstSampleGuide.primaryAction, firstSampleGuide.primaryLabel, "default")}
            {renderFirstSampleGuideButton(firstSampleGuide.secondaryAction, firstSampleGuide.secondaryLabel)}
          </div>
        </div>
      </div>
      {sourceInputSteps.length > 0 && (
        <div className="mt-2 rounded-md border border-current/20 bg-background/50 p-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">补输入路线</span>
            <span className="rounded border border-current/20 px-1.5 py-0.5 opacity-80">先补输入，再重建轨迹</span>
          </div>
          <div className="mt-2 grid gap-2 md:grid-cols-3">
            {sourceInputSteps.map((step, index) => (
              <div key={`${step.command}-${index}`} className="rounded border border-current/20 bg-background/70 px-2 py-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{index + 1}. {step.label}</span>
                  <span className="rounded border border-current/20 px-1.5 py-0.5 opacity-80">{sampleDensitySourceInputActionLabel(step.actionKind)}</span>
                </div>
                <div className="mt-1 truncate font-mono text-[11px] opacity-80">{step.command}</div>
                {step.actionKind !== "manual_command" && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="mt-2 h-7 bg-background/70 text-xs"
                    onClick={step.actionKind === "hypothesis_feedback_write" ? onWriteHypothesisFeedback : onCreateCollectionTask}
                    disabled={
                      (step.actionKind === "hypothesis_feedback_write" && (!onWriteHypothesisFeedback || running === "hypothesis-feedback-write")) ||
                      (step.actionKind === "collection_task_write" && (!onCreateCollectionTask || running === "collection-task-write"))
                    }
                  >
                    {(
                      (step.actionKind === "hypothesis_feedback_write" && running === "hypothesis-feedback-write") ||
                      (step.actionKind === "collection_task_write" && running === "collection-task-write")
                    ) ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                    执行
                  </Button>
                )}
                {step.actionKind === "manual_command" && onPreviewSelfQuestion && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="mt-2 h-7 bg-background/70 text-xs"
                    onClick={onPreviewSelfQuestion}
                    disabled={running === "self-question-preview"}
                  >
                    {running === "self-question-preview" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                    预览
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {rebuildSteps.length > 0 && (
        <div className="mt-2 rounded-md border border-current/20 bg-background/50 p-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">重建路线</span>
            <span className="rounded border border-current/20 px-1.5 py-0.5 opacity-80">已有输入，先轨迹后候选</span>
          </div>
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            {rebuildSteps.map((step, index) => (
              <div key={`${step.command}-${index}`} className="rounded border border-current/20 bg-background/70 px-2 py-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{index + 1}. {step.label}</span>
                  <span className="rounded border border-current/20 px-1.5 py-0.5 opacity-80">{sampleDensitySourceInputActionLabel(step.actionKind)}</span>
                </div>
                <div className="mt-1 truncate font-mono text-[11px] opacity-80">{step.command}</div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="mt-2 h-7 bg-background/70 text-xs"
                  onClick={step.actionKind === "build_trajectories_write" ? onBuildTrajectories : onPreviewAgentCandidates}
                  disabled={
                    (step.actionKind === "build_trajectories_write" && (!onBuildTrajectories || running === "write")) ||
                    (step.actionKind === "paper_trade_agent_preview" && (!onPreviewAgentCandidates || running === "paper-trade-agent-dry"))
                  }
                >
                  {(
                    (step.actionKind === "build_trajectories_write" && running === "write") ||
                    (step.actionKind === "paper_trade_agent_preview" && running === "paper-trade-agent-dry")
                  ) ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : step.actionKind === "paper_trade_agent_preview" ? <Bot className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
                  {step.actionKind === "paper_trade_agent_preview" ? "预览" : "执行"}
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
      {gaps.length > 0 && (
        <div className="mt-2 grid gap-2 border-t border-current/20 pt-2 text-xs lg:grid-cols-2">
          {gaps.slice(0, 4).map((gap) => (
            <div key={gap.id ?? gap.label} className="rounded border border-current/20 bg-background/60 px-2 py-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{gap.label ?? gap.id}</span>
                <span className="rounded border border-current/20 px-1.5 py-0.5 opacity-80">{sampleDensityGapSeverityLabel(gap.severity)}</span>
              </div>
              <div className="mt-1 leading-5 opacity-80">{gap.reason}</div>
              {gap.command && (
                <div className="mt-1 truncate font-mono text-[11px] opacity-80">{gap.command}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function BenchmarkBatchGatePanel({
  summary,
  running,
  onBuildBenchmark,
}: {
  summary: BenchmarkBatchGateSummary
  running?: boolean
  onBuildBenchmark: () => void
}) {
  const toneClass = summary.tone === "good"
    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-800"
    : "border-amber-500/30 bg-amber-500/10 text-amber-800"
  return (
    <section className={cn("rounded-md border px-3 py-2", toneClass)}>
      <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-medium">Benchmark 批次门</h2>
            <span className="rounded border border-current/20 bg-background/60 px-1.5 py-0.5 text-xs">
              {summary.blocksArtifactClosure ? "等待落批次" : "已落批次"}
            </span>
            {summary.manifest && (
              <span className="max-w-full truncate rounded border border-current/20 bg-background/60 px-1.5 py-0.5 text-xs">
                {summary.manifest}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs leading-5">
            {summary.headline}；{summary.detail}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1 text-xs">
          <span className="rounded border border-current/20 bg-background/60 px-1.5 py-0.5">批次 {summary.persistedBatches}</span>
          <span className="rounded border border-current/20 bg-background/60 px-1.5 py-0.5">动态 case {summary.dynamicCases}</span>
          <span className="rounded border border-current/20 bg-background/60 px-1.5 py-0.5">缺口 {summary.coverageGaps}</span>
          <span className="rounded border border-current/20 bg-background/60 px-1.5 py-0.5">已 review {summary.reviewedCases}</span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={running}
            onClick={onBuildBenchmark}
            className="h-7 bg-background/70 px-2 text-xs"
          >
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Target className="h-3.5 w-3.5" />}
            生成 Benchmark
          </Button>
        </div>
      </div>
      <div className="mt-2 border-t border-current/20 pt-2 text-xs leading-5 opacity-85">
        {summary.nextAction}
      </div>
    </section>
  )
}

function ReviewBacklogGatePanel({
  summary,
  onRefreshTrainable,
  onSelectNextReview,
}: {
  summary: ReviewBacklogGateSummary
  onRefreshTrainable?: () => void
  onSelectNextReview?: () => void
}) {
  const toneClass = summary.tone === "good"
    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-800"
    : "border-amber-500/30 bg-amber-500/10 text-amber-800"
  const primaryAction = summary.primaryActionKind === "refresh_lora_ready"
    ? onRefreshTrainable
    : summary.primaryActionKind === "select_next_review"
      ? onSelectNextReview
      : undefined
  const PrimaryIcon = summary.primaryActionKind === "refresh_lora_ready" ? RefreshCw : ShieldCheck
  return (
    <section className={cn("rounded-md border px-3 py-2", toneClass)}>
      <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-medium">Review backlog 门</h2>
            <span className="rounded border border-current/20 bg-background/60 px-1.5 py-0.5 text-xs">
              {summary.blocksReviewClosure ? "阻断闭环" : "已清空"}
            </span>
            <span className="rounded border border-current/20 bg-background/60 px-1.5 py-0.5 text-xs">
              event {summary.reviewEvents}
            </span>
          </div>
          <p className="mt-1 text-xs leading-5">
            {summary.headline}；{summary.detail}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1 text-xs">
          <span className="rounded border border-current/20 bg-background/60 px-1.5 py-0.5">待审 {summary.pending}</span>
          <span className="rounded border border-current/20 bg-background/60 px-1.5 py-0.5">已审 {summary.reviewed}</span>
          <span className="rounded border border-current/20 bg-background/60 px-1.5 py-0.5">偏好/负样本 {summary.routeToPreference}</span>
          <span className="rounded border border-current/20 bg-background/60 px-1.5 py-0.5">补证 {summary.needsEvidence}</span>
          <span className="rounded border border-current/20 bg-background/60 px-1.5 py-0.5">adapter {summary.approveForAdapter}</span>
          <span className="rounded border border-current/20 bg-background/60 px-1.5 py-0.5">paper {summary.paperAdapterCandidates}</span>
          {summary.pendingTrainableRefreshes > 0 && (
            <span className="rounded border border-current/20 bg-background/60 px-1.5 py-0.5">待刷新 {summary.pendingTrainableRefreshes}</span>
          )}
          {primaryAction && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={primaryAction}
              className="h-7 bg-background/70 px-2 text-xs"
            >
              <PrimaryIcon className="h-3.5 w-3.5" />
              {summary.primaryActionLabel}
            </Button>
          )}
        </div>
      </div>
      <div className="mt-2 grid gap-2 border-t border-current/20 pt-2 text-xs md:grid-cols-3">
        <div>
          <div className="font-medium">人审目的</div>
          <div className="mt-1 leading-5 opacity-80">
            只确认路由和训练权重，不把事实、价格行或交易明细写进 adapter。
          </div>
        </div>
        <div>
          <div className="font-medium">当前优先级</div>
          <div className="mt-1 leading-5 opacity-80">
            先处理 preference/eval 风控样本，再处理补证，最后复核正向 adapter 样本。
          </div>
        </div>
        <div>
          <div className="font-medium">下一步</div>
          <div className="mt-1 leading-5 opacity-80">{summary.nextAction}</div>
        </div>
      </div>
    </section>
  )
}

function ReviewActionFilterPanel({
  options,
  value,
  onChange,
}: {
  options: ReviewActionFilterOption[]
  value: ReviewActionFilter
  onChange: (filter: ReviewActionFilter) => void
}) {
  const total = options.find((option) => option.id === "all")?.count ?? 0
  if (total <= 0 && value === "all") return null
  return (
    <section className="rounded-md border bg-muted/20 px-3 py-2">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-medium">Review 分流队列</h2>
            <span className="rounded border bg-background px-1.5 py-0.5 text-xs text-muted-foreground">待审 {total}</span>
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            按推荐人审动作切换列表；只改变当前可视化队列，不写 review ledger。
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          {options.map((option) => {
            const active = value === option.id
            const toneClass = option.tone === "good"
              ? "border-emerald-500/30 text-emerald-700"
              : option.tone === "warn"
                ? "border-amber-500/30 text-amber-700"
                : "border-border text-muted-foreground"
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => onChange(option.id)}
                className={cn(
                  "h-8 rounded border px-2.5 text-xs transition-colors hover:bg-background",
                  toneClass,
                  active ? "bg-background shadow-sm" : "bg-transparent",
                )}
                title={option.detail}
              >
                <span className="font-medium">{option.label}</span>
                <span className="ml-1 rounded bg-muted px-1 py-0.5 text-[11px] text-muted-foreground">{option.count}</span>
              </button>
            )
          })}
        </div>
      </div>
    </section>
  )
}

function ReviewActionBatchPreviewPanel({
  preview,
  selectedTrajectoryId,
  onSelectTrajectory,
}: {
  preview?: ReviewActionBatchPreview | null
  selectedTrajectoryId?: string | null
  onSelectTrajectory: (trajectoryId: string) => void
}) {
  if (!preview) return null
  const toneClass = preview.tone === "good"
    ? "border-emerald-500/30 bg-emerald-500/5"
    : preview.tone === "warn"
      ? "border-amber-500/30 bg-amber-500/5"
      : "border-border bg-muted/20"
  const actionSummary = Object.entries(preview.actionCounts)
    .map(([action, count]) => `${reviewActionLabel(action)} ${count}`)
    .join(" / ")
  return (
    <section className={cn("rounded-md border px-3 py-2", toneClass)}>
      <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-medium">当前队列安全预览</h2>
            <span className="rounded border bg-background px-1.5 py-0.5 text-xs text-muted-foreground">{preview.label}</span>
            <span className="rounded border bg-background px-1.5 py-0.5 text-xs text-muted-foreground">待审 {preview.count}</span>
            <span className="rounded border bg-background px-1.5 py-0.5 text-xs text-muted-foreground">不批量写入</span>
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {preview.guardrail}
          </p>
          {actionSummary && (
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              动作分布：{actionSummary}
            </p>
          )}
        </div>
        {preview.firstTrajectoryId && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => preview.firstTrajectoryId && onSelectTrajectory(preview.firstTrajectoryId)}
            className="shrink-0"
          >
            <Target className="h-4 w-4" />
            {preview.nextActionLabel}
          </Button>
        )}
      </div>
      <div className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        {preview.items.map((item) => {
          const active = selectedTrajectoryId === item.trajectoryId
          return (
            <button
              key={item.trajectoryId}
              type="button"
              onClick={() => onSelectTrajectory(item.trajectoryId)}
              className={cn(
                "min-h-[92px] rounded-md border bg-background/70 px-3 py-2 text-left text-xs transition-colors hover:bg-background",
                active && "border-primary/40 bg-primary/5",
              )}
            >
              <span className="block truncate font-medium text-foreground">{item.title}</span>
              <span className="mt-1 block truncate text-muted-foreground">{item.stockLabel || item.targetLabel}</span>
              <span className="mt-2 flex flex-wrap gap-1">
                <span className="rounded border bg-muted px-1.5 py-0.5 text-muted-foreground">{item.actionLabel}</span>
                <span className="rounded border bg-muted px-1.5 py-0.5 text-muted-foreground">{item.gateLabel}</span>
              </span>
            </button>
          )
        })}
      </div>
      {preview.hiddenCount > 0 && (
        <div className="mt-2 text-xs text-muted-foreground">
          还有 {preview.hiddenCount} 条未展开；继续在下方列表逐条定位。
        </div>
      )}
    </section>
  )
}

function PaperTradeLedgerPanel({
  ledger,
  planning,
  agent,
  discretionaryReviewAudit,
  trajectoryCount,
  running,
  onSelectPaperTrade,
  onSettlePaperTrade,
  onUsePlanCandidate,
  onProbePlanCandidate,
  onBuildAgentCandidates,
  onWriteAgentCandidates,
  onRunDiscretionaryReview,
}: {
  ledger?: StockFeedbackPaperTradeLedger | null
  planning?: StockFeedbackPaperTradePlanning | null
  agent?: StockFeedbackPaperTradeAgentSummary | null
  discretionaryReviewAudit?: StockFeedbackDiscretionaryReviewAudit | null
  trajectoryCount: number
  running?: string | null
  onSelectPaperTrade?: (paperTradeId: string) => void
  onSettlePaperTrade?: (trade: StockFeedbackPaperTradeSummary) => void
  onUsePlanCandidate?: (candidate: StockFeedbackPaperTradePlanCandidate) => void
  onProbePlanCandidate?: (candidate: StockFeedbackPaperTradePlanCandidate) => void
  onBuildAgentCandidates?: () => void
  onWriteAgentCandidates?: () => void
  onRunDiscretionaryReview?: () => void
}) {
  const counts = ledger?.counts ?? ledger?.summary
  const total = counts?.total ?? 0
  const settlementQueueItems = ledger?.settlementQueue?.items ?? []
  const recent = settlementQueueItems.length > 0 ? settlementQueueItems : (ledger?.recentPaperTrades ?? [])
  const planCounts = planning?.counts
  const planCandidates = planning?.candidates ?? []
  const agentCounts = agent?.counts
  const agentCandidates = agent?.candidates ?? []
  const refreshAudit = ledger?.settlementRefreshAudit
  const refreshAuditItems = (refreshAudit?.items ?? []).filter((item) => !item.refreshComplete)
  const discretionaryReviewItems = (discretionaryReviewAudit?.items ?? []).slice(0, 3)
  const discretionaryRunnerAction = paperTradeDiscretionaryReviewRunnerAction(discretionaryReviewAudit)
  if (!ledger && total === 0 && planCandidates.length === 0 && agentCandidates.length === 0) return null
  const trackParts = [
    (counts?.byTrack?.rule_baseline ?? 0) > 0 ? `规则 ${counts?.byTrack?.rule_baseline}` : "",
    (counts?.byTrack?.llm_discretionary ?? 0) > 0 ? `LLM ${counts?.byTrack?.llm_discretionary}` : "",
  ].filter(Boolean)
  return (
    <section className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-medium">模拟交易闭环</h2>
            <span className="rounded border bg-background/70 px-1.5 py-0.5 text-xs text-muted-foreground">
              ledgerKind=paper_trade
            </span>
            <span className="rounded border bg-background/70 px-1.5 py-0.5 text-xs text-muted-foreground">
              轨迹 {trajectoryCount}
            </span>
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {paperTradeLedgerDetail(ledger)}
          </p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {paperTradePlanningDetail(planning)}
          </p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {paperTradeAgentDetail(agent)}
          </p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {paperTradeDiscretionaryReviewDetail(discretionaryReviewAudit)}
          </p>
        </div>
        <div className="flex flex-wrap gap-1 text-xs">
          <span className="rounded border bg-background/70 px-1.5 py-0.5">总数 {total}</span>
          <span className="rounded border bg-background/70 px-1.5 py-0.5">open {counts?.open ?? 0}</span>
          <span className="rounded border bg-background/70 px-1.5 py-0.5">closed {counts?.closed ?? 0}</span>
          <span className="rounded border bg-background/70 px-1.5 py-0.5 text-emerald-700">盈利 {counts?.profitable ?? 0}</span>
          {(refreshAudit?.pending ?? 0) > 0 && (
            <span className="rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-amber-700">待刷新 {refreshAudit?.pending}</span>
          )}
          <span className="rounded border bg-background/70 px-1.5 py-0.5 text-primary">候选 {planCounts?.candidates ?? 0}</span>
          <span className="rounded border bg-background/70 px-1.5 py-0.5 text-primary">Agent {agentCounts?.total ?? 0}</span>
          <span className="rounded border bg-background/70 px-1.5 py-0.5 text-primary">LLM复盘 {discretionaryReviewAudit?.counts?.readyPairs ?? 0}</span>
          {trackParts.length > 0 && (
            <span className="rounded border bg-background/70 px-1.5 py-0.5 text-primary">{trackParts.join(" / ")}</span>
          )}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 bg-background/70"
          onClick={onBuildAgentCandidates}
          disabled={!onBuildAgentCandidates || running === "paper-trade-agent-dry"}
        >
          {running === "paper-trade-agent-dry" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bot className="h-3.5 w-3.5" />}
          预览 Agent 候选
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 bg-background/70"
          onClick={onWriteAgentCandidates}
          disabled={!onWriteAgentCandidates || running === "paper-trade-agent-write"}
        >
          {running === "paper-trade-agent-write" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          写入 Agent 候选
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 bg-background/70"
          title={discretionaryRunnerAction.detail}
          onClick={onRunDiscretionaryReview}
          disabled={!onRunDiscretionaryReview || !discretionaryRunnerAction.enabled || running === "paper-trade-discretionary-review"}
        >
          {running === "paper-trade-discretionary-review" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ListChecks className="h-3.5 w-3.5" />}
          {discretionaryRunnerAction.label}
        </Button>
      </div>
      {discretionaryReviewItems.length > 0 && (
        <div className="mt-2 rounded-md border bg-background/60 px-3 py-2">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-medium text-foreground">LLM复盘预检</span>
            <span className="rounded border bg-muted px-1.5 py-0.5 text-muted-foreground">只读</span>
            <span className="rounded border bg-muted px-1.5 py-0.5 text-muted-foreground">eval/preference</span>
          </div>
          <div className="mt-2 grid gap-2 lg:grid-cols-3">
            {discretionaryReviewItems.map((item) => {
              const tone = paperTradeDiscretionaryReviewItemTone(item)
              const toneClass = tone === "good"
                ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-800"
                : tone === "danger"
                  ? "border-destructive/30 bg-destructive/5 text-destructive"
                  : "border-amber-500/30 bg-amber-500/5 text-amber-800"
              return (
                <div key={item.paperTradeId ?? item.pairKey ?? item.nextAction} className={cn("rounded-md border px-2 py-1.5 text-xs", toneClass)}>
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="font-medium">{item.stock?.name ?? item.stock?.code ?? item.paperTradeId ?? "LLM paper trade"}</span>
                    <span className="rounded border border-current/20 bg-background/60 px-1.5 py-0.5">{item.status ?? "unknown"}</span>
                    <span className="rounded border border-current/20 bg-background/60 px-1.5 py-0.5">{item.asOfDate ?? "as-of?"}</span>
                  </div>
                  <div className="mt-1 leading-5 opacity-90">{paperTradeDiscretionaryReviewItemLabel(item)}</div>
                  <div className="mt-1 flex flex-wrap gap-1 opacity-80">
                    <span className="rounded border border-current/20 bg-background/60 px-1.5 py-0.5">rule {item.pairedRuleBaselineStatus ?? "missing"}</span>
                    <span className="rounded border border-current/20 bg-background/60 px-1.5 py-0.5">sourceRefs {item.sourceRefCount ?? 0}</span>
                    <span className="rounded border border-current/20 bg-background/60 px-1.5 py-0.5">evidenceRefs {item.evidenceRefCount ?? 0}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
      {refreshAuditItems.length > 0 && (
        <div className="mt-2 divide-y rounded-md border border-amber-200 bg-amber-50/60">
          {refreshAuditItems.slice(0, 3).map((item) => {
            const title = [item.stock?.name, item.stock?.code].filter(Boolean).join(" ") || item.paperTradeId || "paper trade"
            return (
              <div key={item.paperTradeId ?? `${item.trajectoryId}-${item.settledAt}`} className="grid gap-2 px-2 py-2 text-xs sm:grid-cols-[minmax(0,1fr)_auto]">
                <span className="min-w-0">
                  <span className="block truncate font-medium text-amber-900">{title}</span>
                  <span className="mt-1 block truncate text-amber-800/80">
                    {[
                      item.trajectoryStatus === "covered" ? "轨迹已回流" : "待重建轨迹",
                      item.benchmarkStatus === "covered" ? "Benchmark 已覆盖" : "待 Benchmark",
                      item.reviewStatus === "reviewed" ? "已人审" : "待人审",
                      item.loraReadyStatus === "covered" ? "LoRA-ready 已覆盖" : item.loraReadyStatus === "blocked_until_human_review" ? "LoRA-ready 等人审" : "待 LoRA-ready",
                    ].join(" · ")}
                  </span>
                </span>
                <span className="flex items-center gap-2 sm:justify-end">
                  <span className="rounded border border-amber-300 bg-background/70 px-1.5 py-0.5 text-amber-800">
                    {paperTradeSettlementRefreshActionLabel(item.nextAction)}
                  </span>
                </span>
              </div>
            )
          })}
        </div>
      )}
      {recent.length > 0 && (
        <div className="mt-2 divide-y rounded-md border bg-background/70">
          {recent.slice(0, 3).map((trade) => {
            const title = [trade.stock?.name, trade.stock?.code].filter(Boolean).join(" ") || trade.id || "paper trade"
            const matched = Boolean(trade.id && onSelectPaperTrade)
            const canSettle = trade.status === "open" && Boolean(trade.id && onSettlePaperTrade)
            return (
              <div
                key={trade.id ?? `${trade.stock?.code}-${trade.generatedAt}`}
                className="grid gap-2 px-2 py-2 text-xs sm:grid-cols-[minmax(0,1fr)_auto]"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{title}</span>
                  <span className="mt-1 block truncate text-muted-foreground">
                    {[
                      paperTradeTrackLabel(trade.track),
                      paperTradeStatusLabel(trade.status),
                      trade.asOfDate ? `asOf ${trade.asOfDate}` : "",
                      formatPercent(trade.profitFeedback?.realizedPnlPct),
                      trade.ledgerEventCount && trade.ledgerEventCount > 1 ? `事件 ${trade.ledgerEventCount}` : "",
                      trade.generatedAt,
                    ].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span className="flex flex-wrap items-center gap-2 sm:justify-end">
                  {canSettle && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 bg-background/70"
                      onClick={() => onSettlePaperTrade?.(trade)}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      结算复盘
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 bg-background/70"
                    disabled={!matched}
                    onClick={() => trade.id && onSelectPaperTrade?.(trade.id)}
                  >
                    <Target className="h-3.5 w-3.5" />
                    {matched ? "定位轨迹" : "等待重建"}
                  </Button>
                </span>
              </div>
            )
          })}
        </div>
      )}
      {agentCandidates.length > 0 && (
        <div className="mt-2 divide-y rounded-md border bg-background/70">
          {agentCandidates.slice(0, 3).map((candidate) => {
            const normalized = paperTradePlanCandidateFromAgent(candidate)
            const title = [candidate.stock?.name, candidate.stock?.code].filter(Boolean).join(" ") || candidate.hypothesisId || candidate.sourceTrajectoryId || "paper trade agent"
            const missing = candidate.readiness?.missingRequiredFields?.join(", ") || "待复核"
            const probeContext = buildPaperTradePlanCandidateProbeContext(normalized)
            const needsEntryPrice = paperTradePlanCandidateNeedsEntryPrice(normalized)
            const canProbe = Boolean(probeContext && onProbePlanCandidate)
            const probing = running === "data-source-probe"
            return (
              <div
                key={candidate.id ?? `${candidate.sourceKind}-${candidate.track}-${candidate.asOfDate}`}
                className="grid gap-2 px-2 py-2 text-xs sm:grid-cols-[minmax(0,1fr)_auto]"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{title}</span>
                    <span className="rounded border px-1.5 py-0.5 text-muted-foreground">{paperTradeTrackLabel(candidate.track)}</span>
                    <span className="rounded border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-primary">{candidate.sourceKind ?? "agent"}</span>
                    <span className={cn(
                      "rounded border px-1.5 py-0.5",
                      canProbe ? "border-primary/20 bg-primary/10 text-primary" : "border-amber-300 bg-amber-50 text-amber-700",
                    )}>
                      {needsEntryPrice ? `补 ${missing}` : "可预览"}
                    </span>
                  </div>
                  <div className="mt-1 text-muted-foreground">
                    as-of {candidate.asOfDate ?? "待定"} · {candidate.evidenceCutoff?.noFutureData ? "已声明 noFutureData" : "等待截断声明"} · {candidate.expectedCatalyst ?? "等待催化说明"}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 bg-background/70"
                    disabled={!onUsePlanCandidate}
                    onClick={() => onUsePlanCandidate?.(normalized)}
                  >
                    <Bot className="h-3.5 w-3.5" />
                    使用 Agent
                  </Button>
                  {needsEntryPrice && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 bg-background/70"
                      disabled={!canProbe || probing}
                      onClick={() => onProbePlanCandidate?.(normalized)}
                      title={canProbe ? "带入 Agent 候选并调用 Tushare 入口价探测" : "候选缺少股票代码或 as-of 日期"}
                    >
                      {probing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Database className="h-3.5 w-3.5" />}
                      补入口价
                    </Button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
      {planCandidates.length > 0 && (
        <div className="mt-2 divide-y rounded-md border bg-background/70">
          {planCandidates.slice(0, 3).map((candidate) => {
            const title = [candidate.stock?.name, candidate.stock?.code].filter(Boolean).join(" ") || candidate.sourceTrajectoryId || "paper trade candidate"
            const missing = candidate.readiness?.missingRequiredFields?.join(", ") || "待复核"
            const probeContext = buildPaperTradePlanCandidateProbeContext(candidate)
            const needsEntryPrice = paperTradePlanCandidateNeedsEntryPrice(candidate)
            const canProbe = Boolean(probeContext && onProbePlanCandidate)
            const probing = running === "data-source-probe"
            return (
              <div
                key={candidate.id ?? `${candidate.sourceTrajectoryId}-${candidate.track}`}
                className="grid gap-2 px-2 py-2 text-xs sm:grid-cols-[minmax(0,1fr)_auto]"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{title}</span>
                    <span className="rounded border px-1.5 py-0.5 text-muted-foreground">{paperTradeTrackLabel(candidate.track)}</span>
                    <span className={cn(
                      "rounded border px-1.5 py-0.5",
                      canProbe ? "border-primary/20 bg-primary/10 text-primary" : "border-amber-300 bg-amber-50 text-amber-700",
                    )}>
                      {needsEntryPrice ? `补 ${missing}` : "可预览"}
                    </span>
                  </div>
                  <div className="mt-1 text-muted-foreground">
                    as-of {candidate.asOfDate ?? "待定"} · entry {candidate.entry?.date ?? "待定"}
                    {needsEntryPrice && (
                      <>
                        {" · "}
                        {canProbe ? "可用 Tushare 取 as-of 入口价" : "缺股票代码或日期，需先人工补齐"}
                      </>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 bg-background/70"
                    disabled={!onUsePlanCandidate}
                    onClick={() => onUsePlanCandidate?.(candidate)}
                  >
                    <FileText className="h-3.5 w-3.5" />
                    使用候选
                  </Button>
                  {needsEntryPrice && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 bg-background/70"
                      disabled={!canProbe || probing}
                      onClick={() => onProbePlanCandidate?.(candidate)}
                      title={canProbe ? "带入候选并调用 Tushare 入口价探测" : "候选缺少股票代码或 as-of 日期"}
                    >
                      {probing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Database className="h-3.5 w-3.5" />}
                      补入口价
                    </Button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

function PaperTradeSettlementPanel({
  draft,
  readiness,
  preview,
  followUp,
  running,
  onChange,
  onDryRun,
  onWrite,
  onBuildBenchmark,
  onRefreshLoraReady,
}: {
  draft: PaperTradeSettlementDraft
  readiness: PaperTradeRecordReadiness
  preview?: CommandResult | null
  followUp?: PaperTradeWriteFollowUp | null
  running?: string | null
  onChange: (patch: Partial<PaperTradeSettlementDraft>) => void
  onDryRun: () => void
  onWrite: () => void
  onBuildBenchmark?: () => void
  onRefreshLoraReady?: () => void
}) {
  const dryRunning = running === "paper-trade-settle-dry"
  const writeRunning = running === "paper-trade-settle-write"
  const actionDisabled = !readiness.ready || dryRunning || writeRunning
  const previewTrade = preview?.paperTrade
  const showPanel = Boolean(draft.paperTradeId || previewTrade || followUp)
  if (!showPanel) return null
  return (
    <section className="rounded-md border bg-card p-3 text-sm">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-medium">模拟交易结算</h2>
            <span className={cn(
              "rounded border px-1.5 py-0.5 text-xs",
              readiness.ready ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700",
            )}>
              {readiness.ready ? "可结算" : "等待退出证据"}
            </span>
            <span className="rounded border bg-background/70 px-1.5 py-0.5 text-xs text-muted-foreground">
              只写 paper_trade
            </span>
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {readiness.detail}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={onDryRun} disabled={actionDisabled}>
            {dryRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
            预览结算
          </Button>
          <Button type="button" size="sm" onClick={onWrite} disabled={actionDisabled}>
            {writeRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            写入结算并重建
          </Button>
        </div>
      </div>

      <div className="mt-3 grid gap-2 md:grid-cols-4">
        <PaperTradeTextInput label="paperTradeId" value={draft.paperTradeId} placeholder="stockfb_paper_trade_..." onChange={(value) => onChange({ paperTradeId: value })} />
        <PaperTradeTextInput label="出场日期" type="date" value={draft.exitDate} onChange={(value) => onChange({ exitDate: value })} />
        <PaperTradeTextInput label="出场价格" value={draft.exitPrice} placeholder="10.80" inputMode="decimal" onChange={(value) => onChange({ exitPrice: value })} />
        <PaperTradeTextInput label="收益率 %" value={draft.realizedPnlPct} placeholder="自动计算或手工填写" inputMode="decimal" onChange={(value) => onChange({ realizedPnlPct: value })} />
        <PaperTradeTextInput label="最大回撤 %" value={draft.maxDrawdownPct} placeholder="1.2" inputMode="decimal" onChange={(value) => onChange({ maxDrawdownPct: value })} />
        <PaperTradeTextInput label="持有天数" value={draft.holdingDays} placeholder="3" inputMode="numeric" onChange={(value) => onChange({ holdingDays: value })} />
        <PaperTradeTextInput label="出场节奏" value={draft.exitTiming} placeholder="兑现/止损/承接转弱" onChange={(value) => onChange({ exitTiming: value })} />
        <PaperTradeTextInput label="仓位纪律" value={draft.positionSizing} placeholder="probe_15pct" onChange={(value) => onChange({ positionSizing: value })} />
      </div>

      <div className="mt-3 rounded-md border bg-muted/20 p-2">
        <label className="flex items-center gap-2 text-xs font-medium">
          <input
            type="checkbox"
            checked={draft.autoMarketEvidence}
            onChange={(event) => onChange({ autoMarketEvidence: event.target.checked })}
            className="h-4 w-4 rounded border"
          />
          结算时自动刷新行情证据
        </label>
        <label className="mt-2 flex items-center gap-2 text-xs font-medium">
          <input
            type="checkbox"
            checked={draft.autoMicrostructureEvidence}
            onChange={(event) => onChange({ autoMicrostructureEvidence: event.target.checked })}
            className="h-4 w-4 rounded border"
          />
          同步补微结构证据
        </label>
        <div className="mt-2 grid gap-2 md:grid-cols-4">
          <label className="grid gap-1 text-xs">
            <span className="text-muted-foreground">自动来源</span>
            <select
              value={draft.marketEvidenceProvider}
              onChange={(event) => onChange({ marketEvidenceProvider: event.target.value as PaperTradeSettlementDraft["marketEvidenceProvider"] })}
              className="h-9 rounded-md border bg-background px-2 outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="stock_daily_sql">本地 SQL</option>
              <option value="tushare">Tushare</option>
              <option value="auto">SQL 后备 Tushare</option>
            </select>
          </label>
          <PaperTradeTextInput label="基准指数" value={draft.marketEvidenceBenchmarkCode} placeholder="000001.SH" onChange={(value) => onChange({ marketEvidenceBenchmarkCode: value })} />
          <PaperTradeTextInput label="行情截止日" type="date" value={draft.marketEvidenceEndDate} onChange={(value) => onChange({ marketEvidenceEndDate: value })} />
          <PaperTradeTextInput label="行情窗口天数" value={draft.marketEvidenceLookaheadDays} placeholder="7" inputMode="numeric" onChange={(value) => onChange({ marketEvidenceLookaheadDays: value })} />
          <PaperTradeTextInput label="priceSqlRef" value={draft.priceSqlRef} placeholder="tushare:daily#..." onChange={(value) => onChange({ priceSqlRef: value })} />
          <PaperTradeTextInput label="marketDataRef" value={draft.marketDataRef} placeholder="tushare:daily+daily_basic:..." onChange={(value) => onChange({ marketDataRef: value })} />
          <PaperTradeTextInput label="相对强度" value={draft.relativeStrength} placeholder="6" inputMode="decimal" onChange={(value) => onChange({ relativeStrength: value })} />
          <PaperTradeTextInput label="3日承接 %" value={draft.followThrough3d} placeholder="8" inputMode="decimal" onChange={(value) => onChange({ followThrough3d: value })} />
          <PaperTradeTextInput label="持有期回撤 %" value={draft.maxDrawdownInHolding} placeholder="1.2" inputMode="decimal" onChange={(value) => onChange({ maxDrawdownInHolding: value })} />
        </div>
      </div>

      <div className="mt-3 grid gap-2 lg:grid-cols-2">
        <PaperTradeTextarea label="evidenceRefs" value={draft.evidenceRefs} placeholder="price-sql:... / tushare:daily#... / trade-ledger:paper-settlement" onChange={(value) => onChange({ evidenceRefs: value })} />
        <PaperTradeTextarea label="卖出原因" value={draft.exitReason} placeholder="目标达到、承接转弱、赔率压缩、预期证伪。" onChange={(value) => onChange({ exitReason: value })} />
      </div>

      {previewTrade && (
        <div className="mt-3 grid gap-2 rounded-md border bg-muted/30 p-2 text-xs sm:grid-cols-4">
          <KeyValue label="结算状态" value={`${paperTradeStatusLabel(previewTrade.status)} · ${paperTradeTrackLabel(previewTrade.track)}`} />
          <KeyValue label="paperTradeId" value={previewTrade.id ?? ""} />
          <KeyValue label="收益" value={formatPercent(previewTrade.profitFeedback?.realizedPnlPct)} />
          <KeyValue label="结果" value={String(previewTrade.profitFeedback?.outcome ?? "")} />
          <KeyValue label="最大回撤" value={formatPercent(previewTrade.profitFeedback?.maxDrawdownPct)} />
          <KeyValue label="持有天数" value={formatCompactNumber(previewTrade.profitFeedback?.holdingDays)} />
          <KeyValue label="执行类别" value={String(previewTrade.profitFeedback?.executionEvidenceClass ?? "")} />
          <KeyValue label="写入边界" value="paper-trades + trajectory rebuild" />
        </div>
      )}

      {followUp && (
        <PaperTradeWriteFollowUpPanel
          followUp={followUp}
          running={running}
          onBuildBenchmark={onBuildBenchmark}
          onRefreshLoraReady={onRefreshLoraReady}
        />
      )}
    </section>
  )
}

function PaperTradeRecordPanel({
  draft,
  readiness,
  dataSourceGate,
  probe,
  preview,
  followUp,
  settlementNotice,
  running,
  prefillSourceLabel,
  onChange,
  onApplySettlement,
  onPrefillFromSelected,
  onDryRun,
  onWrite,
  onBuildBenchmark,
  onRefreshLoraReady,
}: {
  draft: PaperTradeRecordDraft
  readiness: PaperTradeRecordReadiness
  dataSourceGate: PaperTradeDataSourceGate
  probe?: DataSourceProbeResult | null
  preview?: CommandResult | null
  followUp?: PaperTradeWriteFollowUp | null
  settlementNotice?: PaperTradeSettlementAppliedNotice | null
  running?: string | null
  prefillSourceLabel?: string | null
  onChange: (patch: Partial<PaperTradeRecordDraft>) => void
  onApplySettlement?: (suggestion: PaperTradePreviewSettlementSuggestion) => void
  onPrefillFromSelected?: () => void
  onDryRun: () => void
  onWrite: () => void
  onBuildBenchmark?: () => void
  onRefreshLoraReady?: () => void
}) {
  const dryRunning = running === "paper-trade-dry"
  const writeRunning = running === "paper-trade-write"
  const actionDisabled = !readiness.ready || dataSourceGate.blocksWrite || dryRunning || writeRunning
  const previewTrade = preview?.paperTrade
  const previewMarketEvidence = previewTrade?.marketEvidence
  const previewMicrostructure = previewTrade?.marketMicrostructureEvidence
  const evidenceWindow = buildPaperTradeEvidenceWindow(draft, preview)
  const entryPriceSuggestion = buildEntryPriceSuggestionFromProbe(probe, draft)
  const settlementSuggestion = buildPaperTradePreviewSettlementSuggestion(draft, preview)
  const dataSourceGateClass = {
    neutral: "border-border bg-muted text-muted-foreground",
    good: "border-emerald-200 bg-emerald-50 text-emerald-700",
    warn: "border-amber-200 bg-amber-50 text-amber-700",
    danger: "border-destructive/30 bg-destructive/10 text-destructive",
  }[dataSourceGate.tone]
  return (
    <section className="rounded-md border bg-card p-3 text-sm">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-medium">模拟交易录入</h2>
            <span className={cn(
              "rounded border px-1.5 py-0.5 text-xs",
              readiness.ready ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700",
            )}>
              {readiness.ready ? "证据边界就绪" : "等待必填字段"}
            </span>
            {dataSourceGate.status !== "not_applicable" && (
              <span className={cn("rounded border px-1.5 py-0.5 text-xs", dataSourceGateClass)}>
                {dataSourceGate.headline}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {readiness.detail}
          </p>
          {dataSourceGate.status !== "not_applicable" && (
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {dataSourceGate.detail}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {onPrefillFromSelected && (
            <Button type="button" size="sm" variant="outline" onClick={onPrefillFromSelected} title={prefillSourceLabel ?? ""}>
              <FileText className="h-4 w-4" />
              从当前轨迹带入
            </Button>
          )}
          <Button type="button" size="sm" variant="outline" onClick={onDryRun} disabled={actionDisabled}>
            {dryRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
            预览模拟交易
          </Button>
          <Button type="button" size="sm" onClick={onWrite} disabled={actionDisabled}>
            {writeRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            写入并重建
          </Button>
        </div>
      </div>

      <div className="mt-3 grid gap-2 md:grid-cols-4">
        <label className="grid gap-1 text-xs">
          <span className="text-muted-foreground">交易轨道</span>
          <select
            value={draft.track}
            onChange={(event) => onChange({ track: event.target.value as PaperTradeRecordDraft["track"] })}
            className="h-9 rounded-md border bg-background px-2 outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="rule_baseline">规则基准</option>
            <option value="llm_discretionary">LLM 自主</option>
          </select>
        </label>
        <label className="grid gap-1 text-xs">
          <span className="text-muted-foreground">训练目标</span>
          <select
            value={draft.validationTarget}
            onChange={(event) => onChange({ validationTarget: event.target.value as PaperTradeRecordDraft["validationTarget"] })}
            className="h-9 rounded-md border bg-background px-2 outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="expectation_trade">预期交易</option>
            <option value="priced_in_risk">priced-in 风险</option>
            <option value="disconfirmation">失败归因</option>
            <option value="fundamental_closure">基本面兑现</option>
          </select>
        </label>
        <PaperTradeTextInput label="股票代码" value={draft.stockCode} placeholder="SZ300901" onChange={(value) => onChange({ stockCode: value })} />
        <PaperTradeTextInput label="股票名称" value={draft.stockName} placeholder="样本科技" onChange={(value) => onChange({ stockName: value })} />
        <PaperTradeTextInput label="asOfDate" type="date" value={draft.asOfDate} onChange={(value) => onChange({ asOfDate: value })} />
        <PaperTradeTextInput label="入场日期" type="date" value={draft.entryDate} onChange={(value) => onChange({ entryDate: value })} />
        <PaperTradeTextInput label="入场价格" value={draft.entryPrice} placeholder="10.00" inputMode="decimal" onChange={(value) => onChange({ entryPrice: value })} />
        <PaperTradeTextInput label="仓位纪律" value={draft.positionSizing} placeholder="probe_15pct" onChange={(value) => onChange({ positionSizing: value })} />
        <PaperTradeTextInput label="出场日期" type="date" value={draft.exitDate} onChange={(value) => onChange({ exitDate: value })} />
        <PaperTradeTextInput label="出场价格" value={draft.exitPrice} placeholder="10.80" inputMode="decimal" onChange={(value) => onChange({ exitPrice: value })} />
        <PaperTradeTextInput label="收益率 %" value={draft.realizedPnlPct} placeholder="8" inputMode="decimal" onChange={(value) => onChange({ realizedPnlPct: value })} />
        <PaperTradeTextInput label="最大回撤 %" value={draft.maxDrawdownPct} placeholder="1.6" inputMode="decimal" onChange={(value) => onChange({ maxDrawdownPct: value })} />
        <PaperTradeTextInput label="持有天数" value={draft.holdingDays} placeholder="3" inputMode="numeric" onChange={(value) => onChange({ holdingDays: value })} />
        <PaperTradeTextInput label="sourceQuestionId" value={draft.sourceQuestionId} placeholder="self-question id" onChange={(value) => onChange({ sourceQuestionId: value })} />
        <PaperTradeTextInput label="入场节奏" value={draft.entryTiming} placeholder="低吸/突破/回踩确认" onChange={(value) => onChange({ entryTiming: value })} />
        <PaperTradeTextInput label="出场节奏" value={draft.exitTiming} placeholder="兑现/止损/承接转弱" onChange={(value) => onChange({ exitTiming: value })} />
      </div>

      {entryPriceSuggestion && (
        <div className="mt-2 flex flex-col gap-2 rounded-md border border-primary/20 bg-primary/5 p-2 text-xs sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="font-medium text-primary">Tushare 建议价：{entryPriceSuggestion.label}</div>
            <div className="mt-1 truncate text-muted-foreground" title={entryPriceSuggestion.detail}>
              {entryPriceSuggestion.detail}
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 shrink-0 bg-background/70"
            onClick={() => onChange(buildPaperTradeEntryPriceSuggestionPatch(draft, entryPriceSuggestion))}
          >
            <Database className="h-3.5 w-3.5" />
            使用建议价
          </Button>
        </div>
      )}

      <div className="mt-3 rounded-md border bg-muted/20 p-2">
        <label className="flex items-center gap-2 text-xs font-medium">
          <input
            type="checkbox"
            checked={draft.autoMarketEvidence}
            onChange={(event) => onChange({ autoMarketEvidence: event.target.checked })}
            className="h-4 w-4 rounded border"
          />
          自动补行情证据
        </label>
        <label className="mt-2 flex items-center gap-2 text-xs font-medium">
          <input
            type="checkbox"
            checked={draft.autoMicrostructureEvidence}
            onChange={(event) => onChange({ autoMicrostructureEvidence: event.target.checked })}
            className="h-4 w-4 rounded border"
          />
          自动补打板/龙虎榜证据
        </label>
        <div className="mt-2 grid gap-2 md:grid-cols-4">
          <label className="grid gap-1 text-xs">
            <span className="text-muted-foreground">自动来源</span>
            <select
              value={draft.marketEvidenceProvider}
              onChange={(event) => onChange({ marketEvidenceProvider: event.target.value as PaperTradeRecordDraft["marketEvidenceProvider"] })}
              className="h-9 rounded-md border bg-background px-2 outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="stock_daily_sql">本地 SQL</option>
              <option value="tushare">Tushare</option>
              <option value="auto">SQL 后备 Tushare</option>
            </select>
          </label>
          <PaperTradeTextInput label="基准指数" value={draft.marketEvidenceBenchmarkCode} placeholder="000001.SH" onChange={(value) => onChange({ marketEvidenceBenchmarkCode: value })} />
          <PaperTradeTextInput label="行情窗口天数" value={draft.marketEvidenceLookaheadDays} placeholder="7" inputMode="numeric" onChange={(value) => onChange({ marketEvidenceLookaheadDays: value })} />
          <PaperTradeTextInput label="行情截止日" type="date" value={draft.marketEvidenceEndDate} onChange={(value) => onChange({ marketEvidenceEndDate: value })} />
          <PaperTradeTextInput label="微观证据日" type="date" value={draft.microstructureDate} onChange={(value) => onChange({ microstructureDate: value })} />
          <PaperTradeTextInput label="priceSqlRef" value={draft.priceSqlRef} placeholder="sql:cn_stock_price_daily_wind#..." onChange={(value) => onChange({ priceSqlRef: value })} />
          <PaperTradeTextInput label="marketDataRef" value={draft.marketDataRef} placeholder="stock-daily-sql:..." onChange={(value) => onChange({ marketDataRef: value })} />
          <PaperTradeTextInput label="证据来源" value={draft.marketEvidenceSource} placeholder="stock_daily_sql / tushare_mcp" onChange={(value) => onChange({ marketEvidenceSource: value })} />
          <PaperTradeTextInput label="行数" value={draft.marketEvidenceRows} placeholder="5" inputMode="numeric" onChange={(value) => onChange({ marketEvidenceRows: value })} />
          <PaperTradeTextInput label="区间收益 %" value={draft.periodReturnPct} placeholder="8" inputMode="decimal" onChange={(value) => onChange({ periodReturnPct: value })} />
          <PaperTradeTextInput label="相对强度" value={draft.relativeStrength} placeholder="1.2" inputMode="decimal" onChange={(value) => onChange({ relativeStrength: value })} />
          <PaperTradeTextInput label="相对强度口径" value={draft.relativeStrengthBasis} placeholder="vs_index_000300" onChange={(value) => onChange({ relativeStrengthBasis: value })} />
          <PaperTradeTextInput label="换手变化" value={draft.turnoverChange} placeholder="1.6" inputMode="decimal" onChange={(value) => onChange({ turnoverChange: value })} />
          <PaperTradeTextInput label="1日承接 %" value={draft.followThrough1d} placeholder="2.1" inputMode="decimal" onChange={(value) => onChange({ followThrough1d: value })} />
          <PaperTradeTextInput label="3日承接 %" value={draft.followThrough3d} placeholder="6.2" inputMode="decimal" onChange={(value) => onChange({ followThrough3d: value })} />
          <PaperTradeTextInput label="5日承接 %" value={draft.followThrough5d} placeholder="9.5" inputMode="decimal" onChange={(value) => onChange({ followThrough5d: value })} />
          <PaperTradeTextInput label="持有期回撤 %" value={draft.maxDrawdownInHolding} placeholder="1.6" inputMode="decimal" onChange={(value) => onChange({ maxDrawdownInHolding: value })} />
        </div>
        <PaperTradeEvidenceWindowPanel summary={evidenceWindow} />
      </div>

      <div className="mt-3 grid gap-2 lg:grid-cols-2">
        <PaperTradeTextarea label="当时为什么看好 / 假设" value={draft.hypothesis} placeholder="只写当时可见的判断，不写后验事实。" onChange={(value) => onChange({ hypothesis: value })} />
        <PaperTradeTextarea label="预期路径" value={draft.expectedMove} placeholder="预期扩散、承接或兑现路径。" onChange={(value) => onChange({ expectedMove: value })} />
        <PaperTradeTextarea label="sourceRefs" value={draft.sourceRefs} placeholder="self-question:... / retrieval:sourceRefs#..." onChange={(value) => onChange({ sourceRefs: value })} />
        <PaperTradeTextarea label="evidenceRefs" value={draft.evidenceRefs} placeholder="price-sql:... / tool-state:... / paper-trade-ledger:..." onChange={(value) => onChange({ evidenceRefs: value })} />
        <PaperTradeTextarea label="卖出原因" value={draft.exitReason} placeholder="止盈、止损、承接弱、赔率压缩、预期证伪。" onChange={(value) => onChange({ exitReason: value })} />
      </div>

      {previewTrade && (
        <div className="mt-3 grid gap-2 rounded-md border bg-muted/30 p-2 text-xs sm:grid-cols-4">
          <KeyValue label="预览状态" value={`${paperTradeStatusLabel(previewTrade.status)} · ${paperTradeTrackLabel(previewTrade.track)}`} />
          <KeyValue label="证据截止" value={previewTrade.asOfDate ?? previewTrade.evidenceCutoff?.asOfDate ?? ""} />
          <KeyValue label="收益" value={formatPercent(previewTrade.profitFeedback?.realizedPnlPct)} />
          <KeyValue label="自动来源" value={preview?.marketEvidenceProvider ?? previewTrade.marketEvidenceProvider ?? ""} />
          <KeyValue label="行情证据" value={preview?.marketEvidenceStatus ?? previewTrade.marketEvidenceStatus ?? ""} />
          <KeyValue label="相对强度" value={formatPercent(previewMarketEvidence?.relativeStrength)} />
          <KeyValue label="基准收益" value={formatPercent(previewMarketEvidence?.benchmarkReturnPct)} />
          <KeyValue label="3日承接" value={formatPercent(previewMarketEvidence?.followThrough3d)} />
          <KeyValue label="换手变化" value={formatCompactNumber(previewMarketEvidence?.turnoverChange)} />
          <KeyValue label="持有期回撤" value={formatPercent(previewMarketEvidence?.maxDrawdownInHolding)} />
          <KeyValue label="打板证据" value={preview?.microstructureEvidenceStatus ?? previewTrade.microstructureEvidenceStatus ?? ""} />
          <KeyValue label="连板高度" value={formatCompactNumber(previewMicrostructure?.limitStep?.consecutiveBoards)} />
          <KeyValue label="THS热度" value={formatCompactNumber(previewMicrostructure?.heat?.thsRank)} />
          <KeyValue label="东财热度" value={formatCompactNumber(previewMicrostructure?.heat?.dcRank)} />
          <KeyValue label="龙虎榜净额" value={formatCompactNumber(previewMicrostructure?.dragonTiger?.netAmount)} />
          <KeyValue label="机构净额" value={formatCompactNumber(previewMicrostructure?.institution?.netAmount)} />
          <KeyValue label="写入边界" value="paper-trades + trajectory rebuild" />
        </div>
      )}
      {settlementSuggestion && (
        <div className="mt-2 flex flex-col gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 p-2 text-xs text-emerald-800">
          <div className="min-w-0">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{settlementSuggestion.headline}</span>
                  <span className="rounded border border-current/20 bg-background/60 px-1.5 py-0.5">{settlementSuggestion.badge}</span>
                  <span className="rounded border border-current/20 bg-background/60 px-1.5 py-0.5">变更 {settlementSuggestion.diff.length}</span>
                </div>
                <div className="mt-1 truncate text-muted-foreground" title={settlementSuggestion.detail}>
                  {settlementSuggestion.detail}
                </div>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 shrink-0 bg-background/70"
                onClick={() => {
                  if (onApplySettlement) onApplySettlement(settlementSuggestion)
                  else onChange(settlementSuggestion.patch)
                }}
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                应用预览收益
              </Button>
            </div>
            <div className="mt-2 grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
              {settlementSuggestion.diff.slice(0, 6).map((item) => (
                <div key={item.field} className="min-w-0 rounded border border-current/20 bg-background/70 px-2 py-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{item.label}</span>
                    <span className="rounded bg-muted px-1 py-0.5 text-[11px] text-muted-foreground">
                      {item.action === "fill" ? "填入" : "更新"}
                    </span>
                  </div>
                  <div className="mt-0.5 truncate text-muted-foreground" title={`${item.before || "空"} -> ${item.after}`}>
                    {item.before || "空"} -&gt; {item.after}
                  </div>
                </div>
              ))}
              {settlementSuggestion.diff.length > 6 && (
                <div className="rounded border border-current/20 bg-background/70 px-2 py-1 text-muted-foreground">
                  还有 {settlementSuggestion.diff.length - 6} 个字段会随按钮同步回填
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {settlementNotice && (
        <div className="mt-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 p-2 text-xs text-emerald-800">
          <div className="flex flex-wrap items-center gap-2">
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span className="font-medium">{settlementNotice.headline}</span>
            <span className="rounded border border-current/20 bg-background/60 px-1.5 py-0.5">
              字段 {settlementNotice.appliedFieldCount}
            </span>
            <span className="rounded border border-current/20 bg-background/60 px-1.5 py-0.5">
              {settlementNotice.badge}
            </span>
          </div>
          <div className="mt-1 text-muted-foreground">
            {settlementNotice.detail}
          </div>
        </div>
      )}
      {followUp && (
        <PaperTradeWriteFollowUpPanel
          followUp={followUp}
          running={running}
          onBuildBenchmark={onBuildBenchmark}
          onRefreshLoraReady={onRefreshLoraReady}
        />
      )}
    </section>
  )
}

function PaperTradeEvidenceWindowPanel({ summary }: { summary: PaperTradeEvidenceWindowSummary }) {
  const toneClass = {
    neutral: "border-border bg-background text-muted-foreground",
    good: "border-emerald-200 bg-emerald-50 text-emerald-700",
    warn: "border-amber-200 bg-amber-50 text-amber-700",
    danger: "border-destructive/30 bg-destructive/10 text-destructive",
  }[summary.tone]
  return (
    <div className={cn("mt-2 rounded-md border p-2 text-xs", toneClass)}>
      <div className="grid gap-2 sm:grid-cols-4">
        <KeyValue label={summary.label} value={summary.displayedWindow} />
        <KeyValue label="预计窗口" value={summary.expectedWindow} />
        <KeyValue label="返回行数" value={summary.rowLabel} />
        <KeyValue label="防后验" value={summary.noFutureDataLabel} />
      </div>
      {summary.nativeQuery && (
        <div className="mt-1 truncate rounded border bg-background/70 px-2 py-1" title={summary.nativeQuery}>
          {summary.nativeQuery}
        </div>
      )}
      <div className="mt-1 leading-5 opacity-90">
        {summary.detail}
      </div>
    </div>
  )
}

function PaperTradeWriteFollowUpPanel({
  followUp,
  running,
  onBuildBenchmark,
  onRefreshLoraReady,
}: {
  followUp: PaperTradeWriteFollowUp
  running?: string | null
  onBuildBenchmark?: () => void
  onRefreshLoraReady?: () => void
}) {
  const toneClass = {
    neutral: "border-primary/20 bg-primary/5 text-foreground",
    good: "border-emerald-500/30 bg-emerald-500/10 text-emerald-800",
    warn: "border-amber-500/30 bg-amber-500/10 text-amber-800",
    danger: "border-destructive/30 bg-destructive/10 text-destructive",
  }[followUp.tone]
  const Icon = followUp.tone === "good" ? CheckCircle2 : followUp.tone === "danger" ? AlertTriangle : Clock
  const actionToneClass: Record<PaperTradeWriteFollowUpAction["tone"], string> = {
    neutral: "border-border bg-background/70 text-muted-foreground",
    good: "border-emerald-500/30 bg-background/70 text-emerald-800",
    warn: "border-amber-500/30 bg-background/70 text-amber-800",
    danger: "border-destructive/30 bg-background/70 text-destructive",
  }
  const actionHandler = (action: PaperTradeWriteFollowUpAction) => {
    if (action.id === "build_benchmark") return onBuildBenchmark
    if (action.id === "refresh_lora_ready_after_review") return onRefreshLoraReady
    return undefined
  }
  const actionBusy = (action: PaperTradeWriteFollowUpAction) => (
    (action.id === "build_benchmark" && running === "bench") ||
    (action.id === "refresh_lora_ready_after_review" && running === "refresh-lora-ready")
  )
  const refreshStages = followUp.artifactRefreshPlan?.stages?.filter((stage) => stage.id || stage.label || stage.command).slice(0, 5) ?? []
  const stageToneClass = (status?: string | null) => {
    if (status?.includes("blocked")) return "border-amber-500/30 bg-amber-500/10 text-amber-800"
    if (status?.includes("pending")) return "border-primary/20 bg-primary/5 text-primary"
    return "border-border bg-background/70 text-muted-foreground"
  }
  return (
    <div className={cn("mt-3 rounded-md border p-2 text-xs", toneClass)}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1">
            <Icon className="h-3.5 w-3.5 shrink-0" />
            <span className="font-medium">{followUp.headline}</span>
            <span className="rounded border bg-background/70 px-1.5 py-0.5 text-muted-foreground">
              {followUp.badge}
            </span>
            {followUp.matchedTrajectoryId && (
              <span className="max-w-full truncate rounded border bg-background/70 px-1.5 py-0.5 text-muted-foreground" title={followUp.matchedTrajectoryId}>
                {followUp.matchedTrajectoryId}
              </span>
            )}
          </div>
          <p className="mt-1 leading-5 opacity-90">{followUp.detail}</p>
          {followUp.paperTradeId && (
            <p className="mt-1 truncate leading-5 text-muted-foreground" title={followUp.paperTradeId}>
              paperTradeId：{followUp.paperTradeId}
            </p>
          )}
        </div>
      </div>
      <div className="mt-2 grid gap-1 sm:grid-cols-3">
        {followUp.nextSteps.slice(0, 3).map((step, index) => (
          <div key={`${index}-${step}`} className="rounded border bg-background/70 px-2 py-1 leading-5 text-muted-foreground">
            {index + 1}. {step}
          </div>
        ))}
      </div>
      {refreshStages.length > 0 && (
        <div className="mt-2 grid gap-1 md:grid-cols-5">
          {refreshStages.map((stage) => (
            <div
              key={`${stage.id ?? stage.label}-${stage.status ?? ""}`}
              className={cn("min-w-0 rounded border px-2 py-1", stageToneClass(stage.status))}
              title={stage.command ?? stage.reason ?? undefined}
            >
              <div className="truncate font-medium">{stage.label || stage.id || "刷新阶段"}</div>
              <div className="mt-0.5 truncate opacity-80">{stage.status || "pending"}</div>
            </div>
          ))}
        </div>
      )}
      {followUp.actions.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {followUp.actions.map((action) => {
            const handler = actionHandler(action)
            const busy = actionBusy(action)
            const disabled = !action.enabled || !handler || busy
            return (
              <Button
                key={action.id}
                type="button"
                size="sm"
                variant={action.enabled ? "outline" : "ghost"}
                onClick={() => handler?.()}
                disabled={disabled}
                title={action.detail}
                className={cn("bg-background/70", !action.enabled && actionToneClass[action.tone])}
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : action.id === "build_benchmark" ? <Target className="h-3.5 w-3.5" /> : <RefreshCw className="h-3.5 w-3.5" />}
                {action.label}
              </Button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function PaperTradeTextInput({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  inputMode,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  type?: string
  inputMode?: "text" | "decimal" | "numeric"
}) {
  return (
    <label className="grid gap-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <input
        type={type}
        inputMode={inputMode}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-9 rounded-md border bg-background px-2 outline-none focus:ring-2 focus:ring-ring"
      />
    </label>
  )
}

function PaperTradeTextarea({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
}) {
  return (
    <label className="grid gap-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={2}
        placeholder={placeholder}
        className="min-h-16 resize-y rounded-md border bg-background px-2 py-1.5 outline-none focus:ring-2 focus:ring-ring"
      />
    </label>
  )
}

function GateBadge({ gate, highConfidence }: { gate?: string; highConfidence?: boolean }) {
  const label = GATE_LABELS[gate ?? ""] ?? gate ?? "未分类"
  const tone =
    gate === "needs_evidence" ? "border-amber-500/30 bg-amber-500/10 text-amber-700"
      : gate === "review_required" ? "border-border bg-muted text-muted-foreground"
        : gate === "disconfirmed_validated" ? "border-destructive/30 bg-destructive/10 text-destructive"
          : "border-emerald-500/30 bg-emerald-500/10 text-emerald-700"
  return (
    <span className={cn("inline-flex w-fit items-center gap-1 rounded border px-2 py-0.5 text-xs", tone)}>
      {label}
      {highConfidence && <CheckCircle2 className="h-3 w-3" />}
    </span>
  )
}

function ProfitFeedbackListSignalPill({ signal }: { signal: ProfitFeedbackListSignal }) {
  const toneClass = {
    neutral: "border-primary/20 bg-primary/5 text-primary",
    good: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700",
    warn: "border-amber-500/30 bg-amber-500/10 text-amber-700",
    danger: "border-destructive/30 bg-destructive/10 text-destructive",
  }[signal.tone]
  return (
    <span className={cn("mt-1 inline-flex max-w-full items-center gap-1 rounded border px-1.5 py-0.5 text-xs", toneClass)}>
      <span className="shrink-0 font-medium">{signal.label}</span>
      <span className="truncate text-muted-foreground" title={signal.detail}>{signal.detail}</span>
    </span>
  )
}

function ProfitFeedbackReviewWorklistPanel({
  items,
  selectedTrajectoryId,
  onSelect,
}: {
  items: ProfitFeedbackReviewWorklistItem[]
  selectedTrajectoryId?: string | null
  onSelect: (item: ProfitFeedbackReviewWorklistItem) => void
}) {
  if (items.length === 0) return null
  return (
    <section className="space-y-2 border-t pt-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-medium">收益反馈 review</h2>
          <p className="mt-1 text-xs text-muted-foreground">按真实盈亏、买点风险和结算状态进入人工分流</p>
        </div>
        <span className="text-xs text-muted-foreground">
          {items.reduce((sum, item) => sum + item.pendingCount, 0)} 待审
        </span>
      </div>
      <div className="grid gap-2 md:grid-cols-4">
        {items.map((item) => {
          const active = Boolean(item.firstTrajectoryId && selectedTrajectoryId === item.firstTrajectoryId)
          const toneClass = {
            neutral: "border-primary/20 bg-primary/5",
            good: "border-emerald-500/30 bg-emerald-500/10",
            warn: "border-amber-500/30 bg-amber-500/10",
            danger: "border-destructive/30 bg-destructive/10",
          }[item.tone]
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item)}
              disabled={!item.firstTrajectoryId}
              className={cn(
                "min-w-0 rounded-md border p-3 text-left transition-colors hover:bg-muted/40 disabled:cursor-default disabled:opacity-70",
                toneClass,
                active && "border-primary bg-primary/10",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{item.label}</div>
                  <div className="mt-1 truncate text-xs text-muted-foreground" title={item.actionLabel}>
                    {item.actionLabel}
                  </div>
                </div>
                <span className="shrink-0 text-lg font-semibold tabular-nums">{item.count}</span>
              </div>
              <div className="mt-3 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span className="truncate" title={item.detail}>{item.detail}</span>
                <span className="shrink-0 tabular-nums">{item.pendingCount}/{item.reviewedCount}</span>
              </div>
            </button>
          )
        })}
      </div>
    </section>
  )
}

function PatternPill({ label }: { label: string }) {
  return (
    <span className="rounded border border-primary/20 bg-primary/10 px-2 py-0.5 text-xs text-primary">
      {label}
    </span>
  )
}

function PatternRadarStrip({
  radar,
  activePatternId,
  onSelectPattern,
}: {
  radar: StockFeedbackPatternRadar
  activePatternId: string | null
  onSelectPattern: (patternId: string) => void
}) {
  const counts = radar.counts ?? {}
  const items = radar.items ?? []
  const actionText = radar.topNextActions
    ?.slice(0, 2)
    .map((item) => `${patternActionLabel(item.action)} ${item.count ?? 0}`)
    .join(" · ")
  return (
    <section className="space-y-3 border-t pt-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-medium">模式雷达</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {`覆盖 ${counts.coveredPatterns ?? 0}/${counts.totalPatterns ?? 0} · adapter ${counts.adapterReadyPatterns ?? 0} · 风控 ${counts.riskControlPatterns ?? 0} · 缺口 ${radar.gaps?.length ?? 0}`}
          </p>
        </div>
        {actionText && <div className="text-xs text-muted-foreground">{actionText}</div>}
      </div>
      <div className="grid gap-2 md:grid-cols-5">
        {items.slice(0, 5).map((item) => {
          const patternId = item.id ?? ""
          const active = Boolean(patternId && activePatternId === patternId)
          return (
          <button
            key={item.id ?? item.label}
            type="button"
            aria-pressed={active}
            disabled={!patternId}
            onClick={() => patternId && onSelectPattern(patternId)}
            className={cn(
              "min-w-0 rounded-md border p-3 text-left transition-colors hover:bg-muted/40 disabled:cursor-default disabled:opacity-80",
              active && "border-primary bg-primary/10",
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium" title={item.label ?? item.id}>{item.label ?? item.id}</div>
                <div className="mt-1 truncate text-xs text-muted-foreground" title={item.adapterCapability}>
                  {item.adapterCapability}
                </div>
              </div>
              <span className={cn("shrink-0 rounded border px-1.5 py-0.5 text-xs", patternHealthTone(item.health?.status))}>
                {patternHealthLabel(item.health?.status)}
              </span>
            </div>
            <div className="mt-3 flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>{patternActionLabel(item.health?.nextAction)}</span>
              <span className="tabular-nums">{item.counts?.totalTrajectories ?? 0}</span>
            </div>
          </button>
          )
        })}
      </div>
    </section>
  )
}

function CollectionResultsStrip({
  results,
  roadmapContext,
  pendingRebuilds,
  running,
  onSelectPattern,
  onContinueCollection,
  onBuildBenchmark,
  onRebuild,
  onRefreshLoraReady,
  onSelectRoadmapStep,
}: {
  results: StockFeedbackCollectionResult[]
  roadmapContext?: CollectionResultActionRoadmapContext
  pendingRebuilds?: number
  running?: string | null
  onSelectPattern: (patternId: string) => void
  onContinueCollection: (task: StockFeedbackCollectionTask) => void
  onBuildBenchmark: () => void
  onRebuild: (result: StockFeedbackCollectionResult) => void
  onRefreshLoraReady: (card: CollectionResultHistoryCard) => void
  onSelectRoadmapStep?: (step: CollectionResultActionRoadmapStep) => void
}) {
  const visible = results.slice(0, 6)
  if (visible.length === 0) return null
  return (
    <section className="space-y-2 border-t pt-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-medium">最近补样本结果</h2>
          <p className="mt-1 text-xs text-muted-foreground">只展示人工结论、引用数量和模式，不展示原始事实正文</p>
        </div>
        <span className="text-xs text-muted-foreground">
          {visible.length} 条{pendingRebuilds ? ` · 待重建 ${pendingRebuilds}` : ""}
        </span>
      </div>
      <div className="grid gap-2 lg:grid-cols-3">
        {visible.map((item) => {
          const patternId = item.targetPatternId ?? ""
          const card = buildCollectionResultHistoryCard(item, roadmapContext)
          return (
            <div
              key={item.id ?? `${item.targetPatternId ?? item.targetProfitCredit}-${item.generatedAt}`}
              className="min-w-0 rounded-md border p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium" title={card.targetLabel}>
                    {card.targetLabel}
                  </div>
                  <div className="mt-1 truncate text-xs text-muted-foreground" title={item.intakeSummary ?? item.hypothesis}>
                    {item.intakeSummary || item.hypothesis || card.stockLabel || "等待摘要"}
                  </div>
                </div>
                <span className={cn("shrink-0 rounded border px-1.5 py-0.5 text-xs", collectionResultTone(item.result))}>
                  {collectionResultLabel(item.result, item.resultLabel)}
                </span>
              </div>
              <div className="mt-3 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span className="truncate">{[TARGET_LABELS[item.validationTarget ?? ""], card.stockLabel].filter(Boolean).join(" · ") || item.validationTarget}</span>
                <span className="shrink-0 tabular-nums">{card.evidenceRefCount} refs</span>
              </div>
              {card.roadmap && (
                <CollectionResultActionRoadmapPanel
                  roadmap={card.roadmap}
                  onSelectStep={onSelectRoadmapStep}
                  compact
                />
              )}
              {card.nextAction && (
                <CollectionResultNextActionPanel
                  nextAction={card.nextAction}
                  running={running}
                  canContinueCollection={Boolean(card.collectionTask)}
                  onContinueCollection={() => card.collectionTask && onContinueCollection(card.collectionTask)}
                  onBuildBenchmark={onBuildBenchmark}
                  onRebuild={() => onRebuild(item)}
                  onRefreshLoraReady={() => onRefreshLoraReady(card)}
                  onSelectStep={onSelectRoadmapStep}
                />
              )}
              {card.humanReviewBridge && (
                <CollectionResultHumanReviewBridgePanel
                  bridge={card.humanReviewBridge}
                  onSelectStep={onSelectRoadmapStep}
                />
              )}
              {card.followUp && (
                <CollectionResultMiniActions
                  followUp={card.followUp}
                  running={running}
                  hasPattern={Boolean(patternId)}
                  canContinueCollection={Boolean(card.collectionTask)}
                  onSelectPattern={() => patternId && onSelectPattern(patternId)}
                  onContinueCollection={() => card.collectionTask && onContinueCollection(card.collectionTask)}
                  onBuildBenchmark={onBuildBenchmark}
                  onRebuild={() => onRebuild(item)}
                  onRefreshLoraReady={() => onRefreshLoraReady(card)}
                  showPrimaryActions={!card.nextAction}
                />
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

function CollectionResultNextActionPanel({
  nextAction,
  running,
  canContinueCollection,
  onContinueCollection,
  onBuildBenchmark,
  onRebuild,
  onRefreshLoraReady,
  onSelectStep,
}: {
  nextAction: CollectionResultNextAction
  running?: string | null
  canContinueCollection?: boolean
  onContinueCollection: () => void
  onBuildBenchmark: () => void
  onRebuild: () => void
  onRefreshLoraReady: () => void
  onSelectStep?: (step: CollectionResultActionRoadmapStep) => void
}) {
  const toneClass = {
    neutral: "border-primary/20 bg-background/70 text-foreground",
    good: "border-emerald-500/30 bg-emerald-500/10 text-emerald-800",
    warn: "border-amber-500/30 bg-amber-500/10 text-amber-800",
    danger: "border-destructive/30 bg-destructive/10 text-destructive",
  }[nextAction.tone]
  const runningKind =
    (nextAction.actionKind === "rebuild_trajectories" && running === "write") ||
    (nextAction.actionKind === "build_benchmark" && running === "bench") ||
    (nextAction.actionKind === "continue_collection" && running === "collection-dry") ||
    (nextAction.actionKind === "refresh_lora_ready" && running === "refresh-lora-ready")
  const canSelectReview = Boolean(nextAction.step?.action?.auditContext.sourceTrajectoryId && onSelectStep)
  const disabled =
    runningKind ||
    nextAction.actionKind === "none" ||
    (nextAction.actionKind === "continue_collection" && !canContinueCollection) ||
    (nextAction.actionKind === "select_human_review" && !canSelectReview)
  const Icon: LucideIcon =
    runningKind
      ? Loader2
      : nextAction.actionKind === "select_human_review"
        ? Play
        : nextAction.actionKind === "refresh_lora_ready"
          ? Database
          : nextAction.actionKind === "continue_collection"
            ? FileText
            : nextAction.actionKind === "build_benchmark"
              ? Target
              : nextAction.actionKind === "none"
                ? CheckCircle2
                : RefreshCw
  const handleClick = () => {
    if (nextAction.actionKind === "rebuild_trajectories") onRebuild()
    else if (nextAction.actionKind === "build_benchmark") onBuildBenchmark()
    else if (nextAction.actionKind === "continue_collection") onContinueCollection()
    else if (nextAction.actionKind === "refresh_lora_ready") onRefreshLoraReady()
    else if (nextAction.actionKind === "select_human_review" && nextAction.step) onSelectStep?.(nextAction.step)
  }
  const actionLabel = nextAction.actionKind === "continue_collection" && !canContinueCollection
    ? "缺少采集上下文"
    : nextAction.actionLabel
  return (
    <div className={cn("mt-2 rounded-md border p-2 text-xs", toneClass)}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1">
            <span className="font-medium">{nextAction.headline}</span>
            {nextAction.step && (
              <span className="rounded border bg-background/70 px-1.5 py-0.5 text-muted-foreground">
                {nextAction.step.label}
              </span>
            )}
          </div>
          <p className="mt-1 leading-5 opacity-90">{nextAction.detail}</p>
        </div>
        {nextAction.actionKind === "none" ? (
          <span className="shrink-0 rounded border bg-background/70 px-2 py-1 font-medium text-muted-foreground">
            {nextAction.actionLabel}
          </span>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={handleClick}
            className="shrink-0 bg-background/70"
          >
            <Icon className={cn("h-4 w-4", runningKind && "animate-spin")} />
            {actionLabel}
          </Button>
        )}
      </div>
    </div>
  )
}

function CollectionResultMiniActions({
  followUp,
  running,
  hasPattern,
  canContinueCollection,
  onSelectPattern,
  onContinueCollection,
  onBuildBenchmark,
  onRebuild,
  onRefreshLoraReady,
  showPrimaryActions = true,
}: {
  followUp: CollectionResultFollowUp
  running?: string | null
  hasPattern?: boolean
  canContinueCollection?: boolean
  onSelectPattern: () => void
  onContinueCollection: () => void
  onBuildBenchmark: () => void
  onRebuild: () => void
  onRefreshLoraReady: () => void
  showPrimaryActions?: boolean
}) {
  if (!showPrimaryActions && !hasPattern) return null
  const primaryRunning =
    (followUp.primaryAction === "rebuild_trajectories" && running === "write") ||
    (followUp.primaryAction === "build_benchmark" && running === "bench") ||
    (followUp.primaryAction === "continue_collection" && running === "collection-dry")
  const primaryDisabled = primaryRunning || (followUp.primaryAction === "continue_collection" && !canContinueCollection)
  const runPrimary = () => {
    if (followUp.primaryAction === "rebuild_trajectories") onRebuild()
    else if (followUp.primaryAction === "build_benchmark") onBuildBenchmark()
    else onContinueCollection()
  }
  return (
    <div className="mt-3 space-y-2 border-t pt-2">
      {showPrimaryActions && (
        <div className="break-words text-xs leading-5 text-muted-foreground" title={followUp.nextStep}>
          {followUp.nextStep}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {showPrimaryActions && (
          <Button type="button" size="sm" variant="outline" onClick={runPrimary} disabled={primaryDisabled}>
            {primaryRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : followUp.primaryAction === "build_benchmark" ? <Target className="h-4 w-4" /> : followUp.primaryAction === "continue_collection" ? <FileText className="h-4 w-4" /> : <RefreshCw className="h-4 w-4" />}
            {followUp.primaryAction === "continue_collection" && !canContinueCollection ? "缺少上下文" : followUp.primaryActionLabel}
          </Button>
        )}
        {showPrimaryActions && followUp.refreshLoraReadyLabel && (
          <Button type="button" size="sm" variant="outline" onClick={onRefreshLoraReady} disabled={running === "refresh-lora-ready"}>
            {running === "refresh-lora-ready" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
            定位并刷新
          </Button>
        )}
        {hasPattern && (
          <Button type="button" size="sm" variant="ghost" onClick={onSelectPattern}>
            <Filter className="h-4 w-4" />
            查看模式
          </Button>
        )}
      </div>
    </div>
  )
}

function BenchmarkGapActionPanel({
  actions,
  running,
  onSelectAction,
  onPlanProfitCredit,
  onBuildBenchmark,
}: {
  actions: BenchmarkGapAction[]
  running?: string | null
  onSelectAction: (action: BenchmarkGapAction) => void
  onPlanProfitCredit: (action: BenchmarkGapAction, write: boolean) => void | Promise<void>
  onBuildBenchmark: () => void
}) {
  if (actions.length === 0) return null
  const benchmarkRunning = running === "bench"
  const dryRunning = running === "collection-dry"
  const writeRunning = running === "collection-write"
  return (
    <section className="space-y-3 border-t pt-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-sm font-medium">Benchmark 缺口行动</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            优先补齐会影响 eval/preference/adapter 分流的覆盖缺口，事实仍留在 retrieval/tool state。
          </p>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={onBuildBenchmark} disabled={benchmarkRunning}>
          {benchmarkRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Target className="h-4 w-4" />}
          生成 Benchmark
        </Button>
      </div>
      <div className="grid gap-2 md:grid-cols-4">
        {actions.slice(0, 4).map((action) => (
          <div
            key={action.id}
            className={cn(
              "min-w-0 rounded-md border p-3",
              benchmarkGapToneClass(action.tone),
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium" title={action.label}>{action.label}</div>
                <div className="mt-1 truncate text-xs text-muted-foreground" title={action.detail}>{action.detail}</div>
              </div>
              <span className="shrink-0 rounded border bg-background/70 px-1.5 py-0.5 text-[11px] text-muted-foreground">
                {benchmarkGapBucketLabel(action.bucket)}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="truncate text-muted-foreground">
                {[action.target ? TARGET_LABELS[action.target] : "", action.profitFeedbackFilter ? PROFIT_FILTERS.find((item) => item.id === action.profitFeedbackFilter)?.label : ""].filter(Boolean).join(" · ") || "检查覆盖"}
              </span>
              <button
                type="button"
                onClick={() => onSelectAction(action)}
                className="shrink-0 rounded border bg-background/70 px-2 py-1 font-medium transition-colors hover:bg-background"
              >
                {action.primaryActionLabel}
              </button>
            </div>
            {action.profitCredit && (
              <div className="mt-2 flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => onPlanProfitCredit(action, false)} disabled={dryRunning || writeRunning}>
                  {dryRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                  预览采集单
                </Button>
                <Button type="button" size="sm" onClick={() => onPlanProfitCredit(action, true)} disabled={dryRunning || writeRunning}>
                  {writeRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  写入采集单
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

function DynamicTestSetPlanPanel({
  plan,
  running,
  onSelectStep,
  onPlanProfitCredit,
}: {
  plan: DynamicTestSetPlan
  running?: string | null
  onSelectStep: (step: DynamicTestSetPlanStep) => void
  onPlanProfitCredit: (step: DynamicTestSetPlanStep, write: boolean) => void | Promise<void>
}) {
  if (plan.steps.length === 0) return null
  const dryRunning = running === "collection-dry"
  const visibleSteps = plan.steps.slice(0, 4)
  return (
    <section className="space-y-3 border-t pt-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-sm font-medium">下一批动态测试集</h2>
          <p className="mt-1 text-xs text-muted-foreground">{plan.detail}</p>
        </div>
        <span className="text-xs text-muted-foreground">
          {plan.headline} · 缺口 {plan.totalGaps}
        </span>
      </div>
      <div className="divide-y rounded-md border">
        {visibleSteps.map((step) => (
          <DynamicTestSetPlanRow
            key={step.id}
            step={step}
            dryRunning={dryRunning}
            onSelectStep={onSelectStep}
            onPlanProfitCredit={onPlanProfitCredit}
          />
        ))}
      </div>
    </section>
  )
}

function DynamicTestSetPlanRow({
  step,
  dryRunning,
  onSelectStep,
  onPlanProfitCredit,
}: {
  step: DynamicTestSetPlanStep
  dryRunning?: boolean
  onSelectStep: (step: DynamicTestSetPlanStep) => void
  onPlanProfitCredit: (step: DynamicTestSetPlanStep, write: boolean) => void | Promise<void>
}) {
  return (
    <div className="grid gap-3 px-3 py-3 text-xs lg:grid-cols-[minmax(0,1fr)_220px] lg:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1">
          <span className={cn("rounded border px-1.5 py-0.5 tabular-nums", benchmarkGapToneClass(step.tone))}>
            #{step.rank}
          </span>
          <span className="font-medium">{step.label}</span>
          <span className="rounded border bg-background px-1.5 py-0.5 text-muted-foreground">{step.bucketLabel}</span>
          <span className="rounded border bg-background px-1.5 py-0.5 text-muted-foreground">{step.routeLabel}</span>
        </div>
        <div className="mt-1 leading-5 text-muted-foreground">{step.reason}</div>
      </div>
      <div className="flex flex-wrap gap-2 lg:justify-end">
        <Button type="button" size="sm" variant="outline" onClick={() => onSelectStep(step)}>
          <Target className="h-4 w-4" />
          {step.primaryActionLabel}
        </Button>
        {step.profitCredit && (
          <Button type="button" size="sm" variant="outline" onClick={() => onPlanProfitCredit(step, false)} disabled={dryRunning}>
            {dryRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
            预览采集单
          </Button>
        )}
      </div>
    </div>
  )
}

function benchmarkGapToneClass(tone: BenchmarkGapAction["tone"]) {
  return {
    neutral: "border-primary/20 bg-primary/5",
    good: "border-emerald-500/30 bg-emerald-500/10",
    warn: "border-amber-500/30 bg-amber-500/10",
    danger: "border-destructive/30 bg-destructive/10",
  }[tone]
}

function benchmarkGapBucketLabel(bucket?: string | null) {
  return {
    profit_credit: "归因",
    market_pattern: "模式",
    validation_target: "目标",
    profit_outcome: "收益",
  }[bucket ?? ""] ?? "覆盖"
}

function ArtifactSourceAuditPanel({
  benchmark,
  loraReady,
  selectedTrajectoryId,
  submittedAuditReviews,
  auditRefreshDiffs,
  auditBatchRefreshSummary,
  batchRefreshMovementFilter,
  onSelectBatchRefreshMovementFilter,
  onSelectTrajectory,
}: {
  benchmark?: ArtifactSourceMix | null
  loraReady?: ArtifactSourceMix | null
  selectedTrajectoryId?: string | null
  submittedAuditReviews?: Record<string, AuditSubmissionNotice>
  auditRefreshDiffs?: Record<string, AuditRefreshDiff>
  auditBatchRefreshSummary?: AuditBatchRefreshSummary | null
  batchRefreshMovementFilter?: AuditBatchRefreshMovementFilter
  onSelectBatchRefreshMovementFilter?: (filter: AuditBatchRefreshMovementFilter) => void
  onSelectTrajectory?: (trajectoryId: string, context?: AuditSelectionContext) => void
}) {
  const items = [
    { key: "benchmark", title: "Benchmark 来源", icon: Target, mix: benchmark },
    { key: "lora-ready", title: "LoRA-ready 来源", icon: Database, mix: loraReady },
  ].filter((item) => item.mix)
  if (items.length === 0) return null
  return (
    <section className="space-y-3 border-t pt-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-sm font-medium">训练批次来源审计</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            最近批次只展示样本 refs、来源结构和分流状态，原始事实继续留在 retrieval/tool state。
          </p>
        </div>
        <span className="text-xs text-muted-foreground">人工抽查来源偏置后再提升训练权重</span>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {items.map((item) => (
          <ArtifactSourceAuditCard
            key={item.key}
            title={item.title}
            icon={item.icon}
            mix={item.mix}
            selectedTrajectoryId={selectedTrajectoryId}
            submittedAuditReviews={submittedAuditReviews}
            auditRefreshDiffs={auditRefreshDiffs}
            batchRefreshSummary={item.key === "lora-ready" ? auditBatchRefreshSummary : null}
            batchRefreshMovementFilter={item.key === "lora-ready" ? batchRefreshMovementFilter : "all"}
            onSelectBatchRefreshMovementFilter={item.key === "lora-ready" ? onSelectBatchRefreshMovementFilter : undefined}
            onSelectTrajectory={onSelectTrajectory}
          />
        ))}
      </div>
    </section>
  )
}

function ArtifactSourceAuditCard({
  title,
  icon: Icon,
  mix,
  selectedTrajectoryId,
  submittedAuditReviews,
  auditRefreshDiffs,
  batchRefreshSummary,
  batchRefreshMovementFilter,
  onSelectBatchRefreshMovementFilter,
  onSelectTrajectory,
}: {
  title: string
  icon: LucideIcon
  mix?: ArtifactSourceMix | null
  selectedTrajectoryId?: string | null
  submittedAuditReviews?: Record<string, AuditSubmissionNotice>
  auditRefreshDiffs?: Record<string, AuditRefreshDiff>
  batchRefreshSummary?: AuditBatchRefreshSummary | null
  batchRefreshMovementFilter?: AuditBatchRefreshMovementFilter
  onSelectBatchRefreshMovementFilter?: (filter: AuditBatchRefreshMovementFilter) => void
  onSelectTrajectory?: (trajectoryId: string, context?: AuditSelectionContext) => void
}) {
  if (!mix) return null
  const refs = (mix.refs ?? []).slice(0, 4)
  const concentration = mix.sourceConcentration
  const sourceDetail = sourceMixDetail(mix)
  const recipeDetail = adapterBatchRecipeDetail(mix.adapterBatchRecipe)
  const recipeBuckets = (mix.adapterBatchRecipe?.buckets ?? []).filter((bucket) => (bucket.candidateRefs?.length ?? 0) > 0)
  return (
    <div className="min-w-0 rounded-md border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded border bg-muted/40">
              <Icon className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <h3 className="truncate text-sm font-medium">{title}</h3>
              <p className="mt-0.5 truncate text-xs text-muted-foreground" title={mix.artifactPath ?? ""}>
                {mix.artifactPath ?? "尚未写入 manifest"}
              </p>
            </div>
          </div>
        </div>
        <span className="shrink-0 text-lg font-semibold tabular-nums">{mix.count ?? 0}</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-1 text-xs">
        {sourceDetail && <span className="rounded border bg-background px-2 py-0.5 text-muted-foreground">{sourceDetail}</span>}
        {mix.generatedAt && <span className="rounded border bg-background px-2 py-0.5 text-muted-foreground">{mix.generatedAt}</span>}
        {mix.peftBoundary?.storesRawFacts === false && (
          <span className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-emerald-700">不存原始事实</span>
        )}
        {concentration?.trainingWeightSuggestion && (
          <span className="rounded border bg-background px-2 py-0.5 text-muted-foreground">
            {trainingWeightLabel(concentration.trainingWeightSuggestion)}
          </span>
        )}
        {recipeDetail && <span className="rounded border bg-background px-2 py-0.5 text-muted-foreground">{recipeDetail}</span>}
      </div>
      {batchRefreshSummary && (
        <AuditBatchRefreshSummaryPanel
          summary={batchRefreshSummary}
          className="mt-3"
          selectedTrajectoryId={selectedTrajectoryId}
          activeMovementFilter={batchRefreshMovementFilter}
          onSelectMovementFilter={onSelectBatchRefreshMovementFilter}
          onSelectTrajectory={onSelectTrajectory}
        />
      )}
      {concentration?.needsHumanReview && (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-700">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 break-words">
            {concentration.dominantSourceKindLabel ?? trajectorySourceLabel(concentration.dominantSourceKind ?? undefined)}
            {` 占 ${concentration.dominantSharePct ?? 0}% · ${concentration.trainingWeightSuggestion?.note ?? concentration.reviewHint ?? "需要人工抽查来源偏置"}`}
          </span>
        </div>
      )}
      {recipeBuckets.length > 0 && (
        <AdapterBatchBucketAuditList
          buckets={recipeBuckets}
          sourceTitle={title}
          selectedTrajectoryId={selectedTrajectoryId}
          submittedAuditReviews={submittedAuditReviews}
          auditRefreshDiffs={auditRefreshDiffs}
          onSelectTrajectory={onSelectTrajectory}
        />
      )}
      <div className="mt-3 divide-y">
        {refs.length > 0 ? refs.map((ref) => {
          const auditContext = auditContextFromRef(ref, { sourceTitle: title })
          const submissionNotice = submittedAuditReviews?.[auditSubmissionKey(auditContext) ?? ""]
          const refreshDiff = auditRefreshDiffs?.[auditSubmissionKey(auditContext) ?? ""]
          return (
            <ArtifactAuditRefRow
              key={ref.id ?? `${ref.refKind}-${ref.sourceTrajectoryId}`}
              refItem={ref}
              auditContext={auditContext}
              submissionNotice={submissionNotice}
              refreshDiff={refreshDiff}
              selected={Boolean(ref.sourceTrajectoryId && ref.sourceTrajectoryId === selectedTrajectoryId)}
              onSelectTrajectory={onSelectTrajectory}
            />
          )
        }) : (
          <div className="py-3 text-xs text-muted-foreground">暂无 refs，可先生成 Benchmark 或 LoRA-ready 批次</div>
        )}
      </div>
    </div>
  )
}

function AdapterBatchBucketAuditList({
  buckets,
  sourceTitle,
  selectedTrajectoryId,
  submittedAuditReviews,
  auditRefreshDiffs,
  onSelectTrajectory,
}: {
  buckets: AdapterBatchRecipeBucket[]
  sourceTitle?: string
  selectedTrajectoryId?: string | null
  submittedAuditReviews?: Record<string, AuditSubmissionNotice>
  auditRefreshDiffs?: Record<string, AuditRefreshDiff>
  onSelectTrajectory?: (trajectoryId: string, context?: AuditSelectionContext) => void
}) {
  return (
    <div className="mt-3 space-y-2">
      <div className="text-xs font-medium text-muted-foreground">批次桶抽样</div>
      <div className="divide-y border-y">
        {buckets.slice(0, 4).map((bucket) => {
          const label = bucket.label ?? adapterBatchRecipeBucketLabel(bucket.id)
          const refs = (bucket.candidateRefs ?? []).slice(0, 2)
          const hidden = Math.max(0, (bucket.candidateRefCount ?? bucket.candidateRefs?.length ?? 0) - refs.length)
          const weight = typeof bucket.effectiveWeightMultiplier === "number"
            ? `${bucket.effectiveWeightMultiplier.toFixed(1)}x`
            : "混合权重"
          return (
            <div key={bucket.id ?? label} className="py-2">
              <div className="flex flex-wrap items-center justify-between gap-2 px-2 text-xs">
                <div className="min-w-0">
                  <span className="font-medium">{label}</span>
                  <span className="ml-2 text-muted-foreground">
                    {bucket.count ?? 0} 条 · {weight}
                  </span>
                </div>
                {bucket.recommendedSampling && (
                  <span className="shrink-0 rounded border bg-background px-1.5 py-0.5 text-[11px] text-muted-foreground">
                    {samplingLabel(bucket.recommendedSampling)}
                  </span>
                )}
              </div>
              <div className="mt-1 divide-y">
                {refs.map((ref) => {
                  const auditContext = auditContextFromRef(ref, {
                      sourceTitle,
                      bucketId: bucket.id,
                      bucketLabel: label,
                      sampling: bucket.recommendedSampling,
                      effectiveWeightMultiplier: bucket.effectiveWeightMultiplier,
                    })
                  const submissionNotice = submittedAuditReviews?.[auditSubmissionKey(auditContext) ?? ""]
                  const refreshDiff = auditRefreshDiffs?.[auditSubmissionKey(auditContext) ?? ""]
                  return (
                    <ArtifactAuditRefRow
                      key={`${bucket.id}-${ref.id ?? ref.sourceTrajectoryId}`}
                      refItem={ref}
                      auditContext={auditContext}
                      submissionNotice={submissionNotice}
                      refreshDiff={refreshDiff}
                      selected={Boolean(ref.sourceTrajectoryId && ref.sourceTrajectoryId === selectedTrajectoryId)}
                      onSelectTrajectory={onSelectTrajectory}
                    />
                  )
                })}
              </div>
              {hidden > 0 && <div className="px-2 pt-1 text-xs text-muted-foreground">还有 {hidden} 条 refs，可在导出 manifest 中继续抽查</div>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ArtifactAuditRefRow({
  refItem,
  auditContext,
  submissionNotice,
  refreshDiff,
  selected,
  onSelectTrajectory,
}: {
  refItem: ArtifactAuditRef
  auditContext?: AuditSelectionContext
  submissionNotice?: AuditSubmissionNotice | null
  refreshDiff?: AuditRefreshDiff | null
  selected?: boolean
  onSelectTrajectory?: (trajectoryId: string, context?: AuditSelectionContext) => void
}) {
  const title = uniqueTextParts([
    artifactRefKindLabel(refItem.refKind),
    TARGET_LABELS[refItem.validationTarget ?? ""] ?? refItem.validationTarget,
    GATE_LABELS[refItem.qualityGateStatus ?? ""] ?? refItem.qualityGateStatus,
  ]).join(" · ")
  const subline = uniqueTextParts([
    refItem.sourceKindLabel ?? trajectorySourceLabel(refItem.sourceKind ?? undefined),
    refItem.collectionResult ? collectionResultLabel(refItem.collectionResult) : "",
    refItem.targetPatternId,
    refItem.curriculumBucket ?? refItem.dynamicBucket,
  ]).join(" · ")
  const rightLabel = refItem.refKind === "adapter_candidate"
    ? refItem.adapterCapability ?? "adapter"
    : refItem.dynamicBucket ?? "case"
  const weightLabel = refItem.effectiveWeightMultiplier !== null && refItem.effectiveWeightMultiplier !== undefined
    ? `权重 ${refItem.effectiveWeightMultiplier.toFixed(1)}x`
    : ""
  const weightState = trainingWeightStateLabel(refItem.trainingWeightState ?? undefined)
  const canSelect = Boolean(refItem.sourceTrajectoryId && onSelectTrajectory)
  const content = (
    <>
      <div className="min-w-0">
        <div className="truncate font-medium" title={title}>{title || refItem.id || "未命名 ref"}</div>
        <div className="mt-1 truncate text-muted-foreground" title={subline}>{subline || refItem.sourceTrajectoryId || ""}</div>
        {refItem.collectionResultId && (
          <div className="mt-1 truncate text-muted-foreground" title={refItem.collectionResultId}>{refItem.collectionResultId}</div>
        )}
      </div>
      <div className="min-w-0 text-right text-muted-foreground">
        <div className="truncate" title={rightLabel}>{rightLabel}</div>
        {typeof refItem.adapterPriorityScore === "number" && refItem.adapterPriorityScore > 0 && (
          <div className="mt-1 tabular-nums">{refItem.adapterPriorityScore}</div>
        )}
        {weightLabel && <div className="mt-1 tabular-nums">{weightLabel}</div>}
        <div className={cn("mt-1", submissionNotice || refreshDiff ? "text-emerald-700" : selected ? "text-emerald-700" : "text-primary")}>
          {submissionNotice ? "已提交 review" : refreshDiff ? "已刷新权重" : selected ? "已定位" : canSelect ? "查看轨迹" : weightState || (refItem.reviewed ? "已审" : "")}
        </div>
        {submissionNotice && <div className="mt-1 text-emerald-700">待重建批次</div>}
        {refreshDiff && <div className="mt-1 truncate text-emerald-700" title={`${refreshDiff.beforeLabel} -> ${refreshDiff.afterLabel}`}>权重已更新</div>}
        {selected && weightState && <div className="mt-1 text-emerald-700">{weightState}</div>}
      </div>
    </>
  )
  if (canSelect) {
    return (
      <button
        type="button"
        onClick={() => refItem.sourceTrajectoryId && onSelectTrajectory?.(refItem.sourceTrajectoryId, auditContext ?? auditContextFromRef(refItem))}
        aria-pressed={selected}
        aria-label={`定位轨迹 ${refItem.sourceTrajectoryId}`}
        className={cn(
          "grid w-full grid-cols-[minmax(0,1fr)_88px] gap-3 px-2 py-2 text-left text-xs transition-colors hover:bg-muted/40",
          selected && "bg-primary/10",
          submissionNotice && "bg-emerald-500/10",
          refreshDiff && "bg-emerald-500/10",
        )}
      >
        {content}
      </button>
    )
  }
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_88px] gap-3 py-2 text-xs">
      {content}
    </div>
  )
}

function uniqueTextParts(parts: Array<string | null | undefined>) {
  const seen = new Set<string>()
  return parts
    .map((part) => part?.trim())
    .filter((part): part is string => {
      if (!part || seen.has(part)) return false
      seen.add(part)
      return true
    })
}

function uniqueNormalizedBoundaryTexts(parts: Array<string | null | undefined>) {
  const seen = new Set<string>()
  return parts
    .map(normalizeBoundaryText)
    .filter((part): part is string => {
      if (!part || seen.has(part)) return false
      seen.add(part)
      return true
    })
}

function CollectionResultFocusNoticePanel({
  notice,
  onDismiss,
}: {
  notice: CollectionResultFocusNotice
  onDismiss: () => void
}) {
  const toneClass = notice.tone === "good"
    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-800"
    : "border-amber-500/30 bg-amber-500/10 text-amber-800"
  return (
    <section className={cn("rounded-md border p-3 text-sm", toneClass)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{notice.headline}</span>
            {notice.trajectoryId && (
              <span className="rounded border bg-background/70 px-2 py-0.5 text-xs text-muted-foreground">{notice.trajectoryId}</span>
            )}
          </div>
          <p className="mt-1 leading-5 opacity-90">{notice.detail}</p>
        </div>
        <Button type="button" size="sm" variant="ghost" onClick={onDismiss} className="shrink-0">
          <X className="h-4 w-4" />
          关闭
        </Button>
      </div>
    </section>
  )
}

function CollectionResultFollowUpPanel({
  followUp,
  roadmap,
  reviewPreview,
  running,
  canContinueCollection,
  compact = false,
  onContinueCollection,
  onBuildBenchmark,
  onRebuild,
  onRefreshLoraReady,
  onSelectRoadmapStep,
}: {
  followUp: CollectionResultFollowUp
  roadmap?: CollectionResultActionRoadmap | null
  reviewPreview?: CollectionResultReviewRoutePreview | null
  running?: string | null
  canContinueCollection?: boolean
  compact?: boolean
  onContinueCollection: () => void
  onBuildBenchmark: () => void
  onRebuild: () => void
  onRefreshLoraReady: () => void
  onSelectRoadmapStep?: (step: CollectionResultActionRoadmapStep) => void
}) {
  const toneClass = {
    neutral: "border-primary/20 bg-primary/5 text-foreground",
    good: "border-emerald-500/30 bg-emerald-500/10 text-emerald-800",
    warn: "border-amber-500/30 bg-amber-500/10 text-amber-800",
    danger: "border-destructive/30 bg-destructive/10 text-destructive",
  }[followUp.tone]
  const primaryRunning =
    (followUp.primaryAction === "rebuild_trajectories" && running === "write") ||
    (followUp.primaryAction === "build_benchmark" && running === "bench") ||
    (followUp.primaryAction === "continue_collection" && running === "collection-dry")
  const primaryDisabled = primaryRunning || (followUp.primaryAction === "continue_collection" && !canContinueCollection)
  const handlePrimary = () => {
    if (followUp.primaryAction === "rebuild_trajectories") onRebuild()
    else if (followUp.primaryAction === "build_benchmark") onBuildBenchmark()
    else onContinueCollection()
  }
  const reviewBridge = buildCollectionResultHumanReviewBridge(roadmap, reviewPreview)
  const nextAction = buildCollectionResultNextAction(followUp, roadmap, reviewBridge)
  return (
    <section className={cn("rounded-md border text-sm", compact ? "p-2" : "p-3", toneClass)}>
      <div className={cn(
        "flex flex-col gap-3",
        compact ? "sm:flex-row sm:items-start sm:justify-between" : "lg:flex-row lg:items-start lg:justify-between",
      )}>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{followUp.headline}</span>
            <span className="rounded border bg-background/70 px-2 py-0.5 text-xs text-muted-foreground">{followUp.resultLabel}</span>
            {followUp.keepCollectionOpen && (
              <span className="rounded border bg-background/70 px-2 py-0.5 text-xs text-muted-foreground">保持采集单打开</span>
            )}
          </div>
          <p className="mt-1 leading-5 opacity-90">{followUp.detail}</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{followUp.nextStep}</p>
          {nextAction && (
            <CollectionResultNextActionPanel
              nextAction={nextAction}
              running={running}
              canContinueCollection={canContinueCollection}
              onContinueCollection={onContinueCollection}
              onBuildBenchmark={onBuildBenchmark}
              onRebuild={onRebuild}
              onRefreshLoraReady={onRefreshLoraReady}
              onSelectStep={onSelectRoadmapStep}
            />
          )}
          {roadmap && <CollectionResultActionRoadmapPanel roadmap={roadmap} onSelectStep={onSelectRoadmapStep} compact={compact} />}
          {reviewPreview && <CollectionResultReviewRoutePreviewPanel preview={reviewPreview} />}
          {reviewBridge && (
            <CollectionResultHumanReviewBridgePanel
              bridge={reviewBridge}
              onSelectStep={onSelectRoadmapStep}
            />
          )}
        </div>
        {!nextAction && (
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button type="button" size="sm" onClick={handlePrimary} disabled={primaryDisabled} className="bg-background/70">
              {primaryRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : followUp.primaryAction === "build_benchmark" ? <Target className="h-4 w-4" /> : followUp.primaryAction === "continue_collection" ? <FileText className="h-4 w-4" /> : <RefreshCw className="h-4 w-4" />}
              {followUp.primaryAction === "continue_collection" && !canContinueCollection ? "缺少采集上下文" : followUp.primaryActionLabel}
            </Button>
            {followUp.refreshLoraReadyLabel && (
              <Button type="button" size="sm" variant="outline" onClick={onRefreshLoraReady} disabled={running === "refresh-lora-ready"} className="bg-background/70">
                {running === "refresh-lora-ready" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
                {followUp.refreshLoraReadyLabel}
              </Button>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

function CollectionResultActionRoadmapPanel({
  roadmap,
  onSelectStep,
  compact = false,
}: {
  roadmap: CollectionResultActionRoadmap
  onSelectStep?: (step: CollectionResultActionRoadmapStep) => void
  compact?: boolean
}) {
  return (
    <div className={cn("mt-3 text-xs", compact && "border-t pt-2")}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{roadmap.headline}</span>
        <span className={cn("rounded border bg-background/70 px-1.5 py-0.5 text-muted-foreground", compact && "max-w-full truncate")} title={roadmap.detail}>
          {roadmap.detail}
        </span>
      </div>
      <div className={compact ? "mt-2 flex flex-wrap gap-1" : "mt-2 grid gap-1 md:grid-cols-5"}>
        {roadmap.steps.map((step) => (
          <CollectionResultActionRoadmapStepPill
            key={step.id}
            step={step}
            active={roadmap.activeStepId === step.id}
            onSelect={onSelectStep}
            compact={compact}
          />
        ))}
      </div>
    </div>
  )
}

function CollectionResultReviewRoutePreviewPanel({
  preview,
}: {
  preview: CollectionResultReviewRoutePreview
}) {
  const toneClass = {
    good: "text-emerald-800",
    warn: "text-amber-800",
    danger: "text-destructive",
  }[preview.tone]
  return (
    <div className="mt-3 border-t pt-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn("font-medium", toneClass)}>{preview.headline}</span>
        <span className="rounded border bg-background/70 px-1.5 py-0.5 text-muted-foreground">
          {preview.recommendedActionLabel}
        </span>
        <span className="rounded border bg-background/70 px-1.5 py-0.5 text-muted-foreground">
          {preview.peftBoundaryLabel}
        </span>
      </div>
      <p className="mt-1 leading-5 text-muted-foreground">{preview.detail}</p>
      <div className="mt-2 flex flex-wrap gap-1">
        {preview.routeLabels.map((label) => (
          <span key={label} className="rounded border bg-background px-1.5 py-0.5 text-muted-foreground">{label}</span>
        ))}
      </div>
      <ul className="mt-2 space-y-1 text-muted-foreground">
        {preview.reviewChecklist.slice(0, 3).map((item) => (
          <li key={item} className="flex gap-1">
            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-60" />
            <span className="min-w-0">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function CollectionResultHumanReviewBridgePanel({
  bridge,
  onSelectStep,
}: {
  bridge: CollectionResultHumanReviewBridge
  onSelectStep?: (step: CollectionResultActionRoadmapStep) => void
}) {
  const toneClass = {
    good: "border-emerald-500/30 bg-emerald-500/10 text-emerald-800",
    warn: "border-amber-500/30 bg-amber-500/10 text-amber-800",
    danger: "border-destructive/30 bg-destructive/10 text-destructive",
  }[bridge.tone]
  const canSelect = Boolean(bridge.step && onSelectStep)
  return (
    <div className={cn("mt-2 rounded-md border p-2 text-xs", toneClass)}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1">
            <span className="font-medium">{bridge.headline}</span>
            <span className="rounded border bg-background/70 px-1.5 py-0.5 text-muted-foreground">
              {bridge.recommendedActionLabel}
            </span>
          </div>
          <p className="mt-1 leading-5 opacity-90">{bridge.detail}</p>
          <div className="mt-2 flex flex-wrap gap-1">
            {bridge.routeLabels.map((label) => (
              <span key={label} className="rounded border bg-background/70 px-1.5 py-0.5 text-muted-foreground">{label}</span>
            ))}
          </div>
        </div>
        <Button
          type="button"
          size="sm"
          variant={canSelect ? "default" : "outline"}
          disabled={!canSelect}
          onClick={() => bridge.step && onSelectStep?.(bridge.step)}
          className="shrink-0 bg-background/70"
        >
          {canSelect ? <Play className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
          {bridge.actionLabel}
        </Button>
      </div>
    </div>
  )
}

function CollectionResultActionRoadmapStepPill({
  step,
  active,
  onSelect,
  compact = false,
}: {
  step: CollectionResultActionRoadmapStep
  active?: boolean
  onSelect?: (step: CollectionResultActionRoadmapStep) => void
  compact?: boolean
}) {
  const toneClass = {
    done: "border-emerald-500/30 bg-background/70 text-emerald-800",
    active: "border-primary/30 bg-background/70 text-primary",
    pending: "border-border bg-background/70 text-muted-foreground",
    blocked: "border-destructive/30 bg-background/70 text-destructive",
  }[step.status]
  const Icon = step.status === "done" ? CheckCircle2 : step.status === "blocked" ? AlertTriangle : step.status === "active" ? RefreshCw : Clock
  const canSelect = Boolean(step.action?.auditContext.sourceTrajectoryId && onSelect)
  const content = (
    <>
      <div className="flex items-center gap-1 font-medium">
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{step.label}</span>
      </div>
      <div className="mt-0.5 truncate text-muted-foreground" title={step.detail}>{step.detail}</div>
      {canSelect && (
        <div className="mt-1 truncate font-medium text-primary" title={step.action?.label}>{step.action?.label}</div>
      )}
    </>
  )
  const className = cn(
    "min-w-0 rounded border px-2 py-1",
    toneClass,
    active && "ring-1 ring-current",
    compact && "min-w-[112px] flex-1",
    canSelect && "text-left transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
  )
  if (canSelect) {
    return (
      <button
        type="button"
        className={className}
        onClick={() => onSelect?.(step)}
        aria-label={`${step.action?.label}：${step.label}`}
      >
        {content}
      </button>
    )
  }
  return (
    <div className={className}>
      {content}
    </div>
  )
}

function CollectionTaskPanel({
  task,
  running,
  onPlan,
  onRecordResult,
  compact = false,
}: {
  task: StockFeedbackCollectionTask
  running?: string | null
  onPlan: (task: StockFeedbackCollectionTask, write: boolean) => void
  onRecordResult: (task: StockFeedbackCollectionTask, result: string, evidenceRefs: string, summary: string) => void
  compact?: boolean
}) {
  const [evidenceRefs, setEvidenceRefs] = useState("")
  const [summary, setSummary] = useState("")
  const dryRunning = running === "collection-dry"
  const writeRunning = running === "collection-write"
  const resultRunning = running?.startsWith("collection-result-") === true
  const reviewGuide = buildCollectionTaskReviewGuide(task)
  const preflight = buildCollectionTaskDistillationPreflight(task, { evidenceRefs, summary })
  const canConfirm = preflight.canRecordConfirmed && !resultRunning
  return (
    <section className={cn("rounded-md border text-sm", compact ? "p-2" : "p-3")}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="font-medium">补样本任务：{task.targetPatternLabel ?? task.targetPatternId ?? task.targetProfitCreditLabel ?? profitCreditBucketLabel(task.targetProfitCredit)}</div>
          {task.goal && <p className="mt-1 leading-5 text-muted-foreground">{task.goal}</p>}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <span className="flex h-8 w-fit items-center rounded border bg-background px-2 text-xs text-muted-foreground">
            {collectionPriorityLabel(task.priority)}
          </span>
          <Button type="button" size="sm" variant="outline" onClick={() => onPlan(task, false)} disabled={dryRunning || writeRunning}>
            {dryRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
            预览采集单
          </Button>
          <Button type="button" size="sm" onClick={() => onPlan(task, true)} disabled={dryRunning || writeRunning}>
            {writeRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            写入采集单
          </Button>
        </div>
      </div>
      {task.humanPrompt && <p className="mt-3 rounded-md bg-muted/40 p-2 text-xs leading-5 text-muted-foreground">{task.humanPrompt}</p>}
      <div className={cn("mt-3 grid gap-3", compact ? "grid-cols-1" : "md:grid-cols-3")}>
        <TaskListBlock title="验收标准" items={task.acceptanceCriteria} />
        <TaskListBlock title="工具态" items={task.requiredToolState} />
        <TaskListBlock title="样本必须包含" items={task.sampleMustInclude} />
      </div>
      <div className="mt-3 flex flex-wrap gap-1 text-xs">
        <span className="rounded border bg-background px-2 py-0.5 text-muted-foreground">{TARGET_LABELS[task.validationTarget ?? ""] ?? task.validationTarget}</span>
        <span className="rounded border bg-background px-2 py-0.5 text-muted-foreground">{patternActionLabel(task.recommendedAction)}</span>
        {(task.peftBoundary?.adapterStores ?? []).slice(0, 4).map((item) => (
          <span key={item} className="rounded border bg-background px-2 py-0.5 text-muted-foreground">{item}</span>
        ))}
      </div>
      <CollectionTaskReviewGuidePanel
        guide={reviewGuide}
        onUseNote={(note) => setSummary(note)}
      />
      <div className={cn("mt-3 grid gap-2", compact ? "grid-cols-1" : "md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]")}>
        <textarea
          value={evidenceRefs}
          onChange={(event) => setEvidenceRefs(event.target.value)}
          rows={2}
          aria-label="补样本证据引用"
          className="min-h-16 resize-none rounded-md border bg-background px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-ring"
          placeholder="retrieval:... 或 price-sql:..."
        />
        <textarea
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
          rows={2}
          aria-label="补样本结果摘要"
          className="min-h-16 resize-none rounded-md border bg-background px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-ring"
          placeholder="人工摘要"
        />
      </div>
      <CollectionTaskDistillationPreflightPanel preflight={preflight} />
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        <Button type="button" size="sm" onClick={() => onRecordResult(task, "confirmed", evidenceRefs, summary)} disabled={!canConfirm}>
          {running === "collection-result-confirmed" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          确认证据
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => onRecordResult(task, "insufficient", evidenceRefs, summary)} disabled={resultRunning}>
          {running === "collection-result-insufficient" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clock className="h-4 w-4" />}
          证据不足
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => onRecordResult(task, "refuted", evidenceRefs, summary)} disabled={resultRunning}>
          {running === "collection-result-refuted" ? <Loader2 className="h-4 w-4 animate-spin" /> : <AlertTriangle className="h-4 w-4" />}
          证据反驳
        </Button>
      </div>
    </section>
  )
}

function CollectionTaskReviewGuidePanel({
  guide,
  onUseNote,
}: {
  guide: CollectionTaskReviewGuide
  onUseNote: (note: string) => void
}) {
  const peftClass = guide.peftStatus === "clean"
    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-800"
    : "border-amber-500/30 bg-amber-500/10 text-amber-800"
  return (
    <div className="mt-3 rounded-md border bg-muted/20 p-2 text-xs">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="font-medium">{guide.headline}</div>
          <div className="mt-1 leading-5 text-muted-foreground">{guide.detail}</div>
        </div>
        <span className={cn("shrink-0 rounded border px-1.5 py-0.5", peftClass)}>
          {guide.peftStatus === "clean" ? "PEFT clean" : "补 PEFT 边界"}
        </span>
      </div>
      <div className="mt-2 divide-y rounded border bg-background/70">
        {guide.resultOptions.map((option) => (
          <CollectionTaskReviewOptionRow
            key={option.result}
            option={option}
            onUseNote={onUseNote}
          />
        ))}
      </div>
    </div>
  )
}

function CollectionTaskReviewOptionRow({
  option,
  onUseNote,
}: {
  option: CollectionTaskReviewOption
  onUseNote: (note: string) => void
}) {
  const toneClass = {
    good: "border-emerald-500/30 bg-emerald-500/10 text-emerald-800",
    warn: "border-amber-500/30 bg-amber-500/10 text-amber-800",
    danger: "border-destructive/30 bg-destructive/10 text-destructive",
  }[option.tone]
  return (
    <div className="grid gap-2 px-2 py-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1">
          <span className="font-medium">{option.label}</span>
          <span className={cn("rounded border px-1.5 py-0.5", toneClass)}>{option.routeLabel}</span>
        </div>
        <div className="mt-1 leading-5 text-muted-foreground">{option.detail}</div>
        <div className="mt-1 leading-5 text-muted-foreground">{option.nextStep}</div>
      </div>
      <Button type="button" size="sm" variant="outline" onClick={() => onUseNote(option.noteDraft)}>
        使用摘要
      </Button>
    </div>
  )
}

function CollectionTaskDistillationPreflightPanel({
  preflight,
}: {
  preflight: CollectionTaskDistillationPreflight
}) {
  const toneClass = {
    good: "border-emerald-500/30 bg-emerald-500/10 text-emerald-800",
    warn: "border-amber-500/30 bg-amber-500/10 text-amber-800",
    danger: "border-destructive/30 bg-destructive/10 text-destructive",
  }[preflight.tone]
  return (
    <div className={cn("mt-3 rounded-md border p-2 text-xs", toneClass)}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="font-medium">{preflight.headline}</div>
          <div className="mt-1 leading-5 opacity-90">{preflight.detail}</div>
          <div className="mt-1 leading-5 opacity-80">{preflight.nextAction}</div>
        </div>
        <span className="shrink-0 rounded border bg-background/70 px-1.5 py-0.5 text-muted-foreground">
          {preflight.routeLabel}
        </span>
      </div>
      <div className="mt-2 grid gap-1 sm:grid-cols-4">
        {preflight.checks.map((check) => (
          <CollectionTaskDistillationCheckPill key={check.id} check={check} />
        ))}
      </div>
    </div>
  )
}

function CollectionTaskDistillationCheckPill({
  check,
}: {
  check: CollectionTaskDistillationPreflightCheck
}) {
  const toneClass = {
    passed: "border-emerald-500/30 bg-background/70 text-emerald-800",
    missing: "border-amber-500/30 bg-background/70 text-amber-800",
    warning: "border-amber-500/30 bg-background/70 text-amber-800",
    blocked: "border-destructive/30 bg-background/70 text-destructive",
  }[check.status]
  const Icon = check.status === "passed" ? CheckCircle2 : check.status === "blocked" ? AlertTriangle : Clock
  return (
    <div className={cn("min-w-0 rounded border px-2 py-1", toneClass)}>
      <div className="flex items-center gap-1 font-medium">
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{check.label}</span>
      </div>
      <div className="mt-0.5 truncate text-muted-foreground" title={check.detail}>{check.detail}</div>
    </div>
  )
}

function TaskListBlock({ title, items }: { title: string; items?: string[] }) {
  const visible = (items ?? []).slice(0, 4)
  if (visible.length === 0) return null
  return (
    <div className="min-w-0">
      <div className="text-xs font-medium text-muted-foreground">{title}</div>
      <div className="mt-1 space-y-1">
        {visible.map((item) => (
          <div key={item} className="break-words text-xs leading-5 text-muted-foreground">{item}</div>
        ))}
      </div>
    </div>
  )
}

function collectionPriorityLabel(priority?: string) {
  return {
    high: "高优先级",
    medium: "中优先级",
    low: "低优先级",
  }[priority ?? ""] ?? priority ?? "待定"
}

function profitOutcomeLabel(outcome?: string) {
  if (!outcome) return ""
  return PROFIT_OUTCOME_LABELS[outcome] ?? outcome
}

function formatPercent(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return ""
  return `${value.toFixed(1)}%`
}

function formatCompactNumber(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return ""
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

function formatDays(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return ""
  return `${value} 天`
}

export function paperTradeMarketEvidenceWindowDisplay(window?: StockFeedbackMarketEvidenceWindow | null) {
  if (!window) return null
  const actualWindow = window.actualWindow ?? [window.actualStartDate, window.actualEndDate].filter(Boolean).join("..")
  const expectedWindow = window.expectedWindow ?? [window.expectedStartDate, window.expectedEndDate].filter(Boolean).join("..")
  const exceeded = window.exceededExpectedEnd === true || window.status === "exceeded_expected_end"
  return {
    label: exceeded ? "窗口越界" : window.status === "pending" ? "窗口待回流" : "窗口正常",
    value: actualWindow || expectedWindow || "",
    detail: expectedWindow ? `计划 ${expectedWindow}` : "",
    tone: exceeded ? "warn" as const : window.status === "pending" ? "neutral" as const : "good" as const,
  }
}

export function buildProfitFeedbackDistillationHint(
  profitFeedback?: StockFeedbackTrajectory["profitFeedback"] | null,
): ProfitFeedbackDistillationHint | null {
  const outcome = profitFeedback?.outcome
  if (!outcome || outcome === "unknown") return null
  const pnl = formatPercent(profitFeedback.realizedPnlPct)
  const drawdown = formatPercent(profitFeedback.maxDrawdownPct)
  const hold = formatDays(profitFeedback.holdingDays)
  const rhythm = uniqueTextParts([
    pnl ? `收益 ${pnl}` : "",
    drawdown ? `回撤 ${drawdown}` : "",
    hold ? `持有 ${hold}` : "",
    profitFeedback.entryTiming ? `进场 ${profitFeedback.entryTiming}` : "",
    profitFeedback.positionSizing ? `仓位 ${profitFeedback.positionSizing}` : "",
  ]).join(" · ")
  const credit = profitFeedbackCreditDetail(profitFeedback)

  if (outcome === "profitable") {
    return {
      headline: "收益支持该手法",
      detail: `${rhythm || "已记录正收益"}。${credit ? `收益归因：${credit}。` : ""}可作为正向 adapter 候选，但仍要复核回撤、仓位和进出场节奏；LoRA 不存原始事实，只学习可复用决策方式。`,
      tone: "good",
      trainingUse: "adapter_candidate_after_review",
    }
  }
  if (["loss", "failed_or_unprofitable", "direction_right_entry_risk"].includes(outcome)) {
    const entryRiskText = outcome === "direction_right_entry_risk"
      ? "方向对但买点或赔率暴露风险。"
      : "亏损或未盈利反馈说明买点、赔率或承接存在问题。"
    return {
      headline: "优先进入风险/负样本",
      detail: `${entryRiskText}${rhythm ? ` ${rhythm}。` : " "}${credit ? `收益归因：${credit}。` : ""}优先进入 eval/preference/negative，用来训练买点、回撤和伪催化识别。`,
      tone: "danger",
      trainingUse: "eval_preference_negative",
    }
  }
  return {
    headline: "等待收益闭环",
    detail: `${rhythm || "收益反馈尚未完全结算"}。先保留为观察样本，等真实收益、回撤和持有期稳定后再决定 adapter/eval/preference 分流。`,
    tone: "warn",
    trainingUse: "monitor_until_settled",
  }
}

const SETTLED_PROFIT_OUTCOMES = ["profitable", "loss", "failed_or_unprofitable", "direction_right_entry_risk"]

function isRiskProfitOutcome(outcome?: string | null) {
  return ["loss", "failed_or_unprofitable", "direction_right_entry_risk"].includes(outcome ?? "")
}

function isPresentFiniteNumber(value?: number) {
  return typeof value === "number" && Number.isFinite(value)
}

function profitReadinessCheck(
  id: ProfitFeedbackReadinessCheck["id"],
  label: string,
  passed: boolean,
  detailWhenPassed: string,
  detailWhenMissing: string,
  statusWhenMissing: ProfitFeedbackReadinessCheck["status"] = "missing",
): ProfitFeedbackReadinessCheck {
  return {
    id,
    label,
    status: passed ? "passed" : statusWhenMissing,
    detail: passed ? detailWhenPassed : detailWhenMissing,
  }
}

export function buildProfitFeedbackDistillationReadiness(
  trajectory: Pick<StockFeedbackTrajectory, "id" | "validationTarget" | "qualityGate" | "profitFeedback" | "evidenceState" | "sourceRefs">,
): ProfitFeedbackDistillationReadiness {
  const feedback = trajectory.profitFeedback
  const outcome = feedback?.outcome
  const credit = feedback?.creditAssignment
  const settledOutcome = SETTLED_PROFIT_OUTCOMES.includes(outcome ?? "")
  const riskOutcome = isRiskProfitOutcome(outcome)
  const positiveOutcome = outcome === "profitable"
  const hasPnl = isPresentFiniteNumber(feedback?.realizedPnlPct)
  const hasDrawdown = isPresentFiniteNumber(feedback?.maxDrawdownPct)
  const hasHolding = isPresentFiniteNumber(feedback?.holdingDays)
  const hasCredit = Boolean(credit?.primaryCredit && credit?.trainingUse)
  const toolRefs = uniqueTextParts([
    ...(trajectory.sourceRefs ?? []),
    ...(trajectory.evidenceState?.confirmedEvidenceRefs ?? []),
  ])
  const hasToolRefs = toolRefs.length > 0
  const peftClean = credit?.storesRawFacts === false
  const peftBlocked = credit?.storesRawFacts === true
  const routeLabel = positiveOutcome
    ? "复核后 adapter"
    : riskOutcome
      ? "eval/preference/负样本"
      : "继续观察"

  const checks: ProfitFeedbackReadinessCheck[] = [
    profitReadinessCheck(
      "settled_pnl",
      "真实盈亏",
      hasPnl,
      `已记录 ${formatPercent(feedback?.realizedPnlPct)}`,
      "缺真实盈亏，不能判断收益是否支持该手法",
    ),
    profitReadinessCheck(
      "drawdown",
      "最大回撤",
      hasDrawdown,
      `已记录 ${formatPercent(feedback?.maxDrawdownPct)}`,
      "缺最大回撤，无法训练买点/风控/仓位纪律",
    ),
    profitReadinessCheck(
      "holding_period",
      "持有期",
      hasHolding,
      `已记录 ${formatDays(feedback?.holdingDays)}`,
      "缺持有期，无法区分一日游、趋势段和后手承接",
    ),
    profitReadinessCheck(
      "credit_assignment",
      "收益归因",
      hasCredit,
      profitFeedbackCreditDetail(feedback) || "已归因",
      "缺收益归因，不能决定进入 adapter、eval 还是 preference",
    ),
    profitReadinessCheck(
      "tool_state_refs",
      "工具态引用",
      hasToolRefs,
      toolRefs.slice(0, 2).join(" / "),
      "缺 price SQL、trade ledger 或 retrieval/sourceRefs 引用",
    ),
    profitReadinessCheck(
      "peft_boundary",
      "PEFT 边界",
      peftClean,
      "storesRawFacts=false，事实留在 retrieval/tool state",
      peftBlocked ? "storesRawFacts=true，必须先移回 retrieval/tool state" : "缺 storesRawFacts=false 的明确声明",
      peftBlocked ? "blocked" : "missing",
    ),
  ]

  const missing = checks
    .filter((check) => check.status !== "passed")
    .map((check) => check.label)
  const hasProfitEvidenceGap = !hasPnl || !hasDrawdown || !hasHolding || !hasToolRefs
  const settledMetricsReady = settledOutcome && !hasProfitEvidenceGap
  const canPromoteAdapter = Boolean(
    positiveOutcome &&
    settledMetricsReady &&
    hasCredit &&
    peftClean &&
    credit?.trainingUse === "adapter_candidate_after_review" &&
    trajectory.qualityGate?.highConfidenceEligible === true,
  )

  if (!settledOutcome) {
    return {
      headline: "等待收益闭环",
      detail: "收益反馈尚未结算完整。先把真实盈亏、最大回撤、持有期、收益归因和工具态引用补齐，再决定 adapter/eval/preference 分流。",
      status: "monitor_until_settled",
      tone: "warn",
      routeLabel,
      canPromoteAdapter: false,
      missing,
      checks,
      nextAction: "补交易收益、最大回撤、持有期、收益归因和工具态引用；事实和交易数据继续留在 retrieval/tool state。",
    }
  }

  if (peftBlocked || (settledMetricsReady && hasCredit && !peftClean)) {
    return {
      headline: "收益反馈边界待修正",
      detail: "收益反馈已具备部分市场证据，但 PEFT 边界未通过；不得进入正向 adapter，先确认 LoRA 不存原始事实。",
      status: "needs_boundary",
      tone: peftBlocked ? "danger" : "warn",
      routeLabel,
      canPromoteAdapter: false,
      missing,
      checks,
      nextAction: "先补 storesRawFacts=false、factsRemainIn/sourceRefs，再重建 LoRA-ready。",
    }
  }

  if (hasProfitEvidenceGap) {
    return {
      headline: "收益证据未闭合",
      detail: "市场方向可能已经验证，但真实收益、回撤、持有期或工具态引用不足；不能把收益归因提权为训练策略。",
      status: "needs_profit_evidence",
      tone: "warn",
      routeLabel,
      canPromoteAdapter: false,
      missing,
      checks,
      nextAction: "补齐 price SQL、trade ledger、收益/回撤/持有期后再人审分流。",
    }
  }

  if (!hasCredit) {
    return {
      headline: "收益归因未完成",
      detail: "真实收益反馈已经可读，但缺少 primaryCredit/trainingUse，无法决定进入 adapter、eval 或 preference。",
      status: "needs_credit_assignment",
      tone: "warn",
      routeLabel,
      canPromoteAdapter: false,
      missing,
      checks,
      nextAction: "补收益归因：说明是手法执行、买点错误、仓位纪律、止盈止损还是伪催化。",
    }
  }

  if (riskOutcome) {
    return {
      headline: "收益风险反馈可蒸馏",
      detail: `${outcome === "direction_right_entry_risk" ? "方向对但买点错" : "亏损/未盈利"} 已经有真实收益反馈和归因；优先进入 eval/preference/负样本，用于训练风险控制、回撤和伪催化识别。`,
      status: "ready",
      tone: "danger",
      routeLabel,
      canPromoteAdapter: false,
      missing,
      checks,
      nextAction: "进入 eval/preference/负样本；不要把风险反馈提升为正向 adapter。",
    }
  }

  return {
    headline: "收益反馈可蒸馏",
    detail: "真实收益、回撤、持有期、收益归因和工具态引用已闭合。LoRA 只学习可复用行为、技能、工具习惯和决策策略；事实、公告、交易数据仍留在 retrieval/tool state。",
    status: "ready",
    tone: canPromoteAdapter ? "good" : "warn",
    routeLabel,
    canPromoteAdapter,
    missing,
    checks,
    nextAction: canPromoteAdapter
      ? "人工复核后可进入 adapter 候选；提交后重建并刷新 LoRA-ready。"
      : "保持人审降权，确认质量门和收益归因后再决定是否进入正向 adapter。",
  }
}

function profitFeedbackCollectionTaskCredit(
  trajectory: Pick<StockFeedbackTrajectory, "validationTarget" | "qualityGate" | "profitFeedback">,
) {
  const outcome = trajectory.profitFeedback?.outcome
  if (trajectory.validationTarget === "disconfirmation" || trajectory.qualityGate?.status === "disconfirmed_validated") {
    return "failed_expectation_negative"
  }
  if (isRiskProfitOutcome(outcome)) return "execution_risk_negative"
  return "pattern_execution_supported"
}

function profitFeedbackCollectionTaskValidationTarget(creditId: string, fallback?: string | null) {
  if (creditId === "execution_risk_negative") return "priced_in_risk"
  if (creditId === "failed_expectation_negative") return "disconfirmation"
  return fallback ?? "expectation_trade"
}

function profitFeedbackCollectionTaskAdapterCapability(creditId: string) {
  if (creditId === "execution_risk_negative") return "priced_in_risk_judgment"
  if (creditId === "failed_expectation_negative") return "failed_expectation_attribution"
  return "expectation_trade_judgment"
}

function profitFeedbackCollectionTaskSignalFilter(outcome?: string | null): ProfitFeedbackSignalFilter {
  if (outcome === "profitable") return "profitable"
  if (isRiskProfitOutcome(outcome)) return "risk_negative"
  return "pending"
}

function requiredToolStateForProfitReadiness(readiness: ProfitFeedbackDistillationReadiness) {
  const missing = new Set(readiness.missing)
  const items = [
    (missing.has("真实盈亏") || missing.has("最大回撤") || missing.has("持有期")) ? "price_sql" : "",
    (missing.has("真实盈亏") || missing.has("最大回撤") || missing.has("持有期")) ? "trade_ledger" : "",
    missing.has("工具态引用") ? "retrieval_source_refs" : "",
    missing.has("收益归因") ? "profit_credit_assignment" : "",
    missing.has("PEFT 边界") ? "peft_boundary" : "",
  ]
  return uniqueTextParts(items.length > 0 ? items : ["price_sql", "trade_ledger", "retrieval_source_refs"])
}

export function buildProfitFeedbackCollectionTask(
  trajectory: Pick<StockFeedbackTrajectory, "id" | "validationTarget" | "qualityGate" | "profitFeedback" | "evidenceState" | "sourceRefs">,
  readiness = buildProfitFeedbackDistillationReadiness(trajectory),
): StockFeedbackCollectionTask | null {
  if (readiness.status === "ready") return null
  const creditId = profitFeedbackCollectionTaskCredit(trajectory)
  const validationTarget = profitFeedbackCollectionTaskValidationTarget(creditId, trajectory.validationTarget)
  const adapterCapability = profitFeedbackCollectionTaskAdapterCapability(creditId)
  const missingText = readiness.missing.length > 0 ? readiness.missing.join(" / ") : "收益反馈证据"
  const feedbackFilter = profitFeedbackCollectionTaskSignalFilter(trajectory.profitFeedback?.outcome)
  const label = profitCreditBucketLabel(creditId)
  const routeLabel = creditId === "pattern_execution_supported"
    ? "人审后 adapter 正样本"
    : "eval/preference/负样本"

  return {
    targetProfitCredit: creditId,
    targetProfitCreditLabel: label,
    validationTarget,
    adapterCapability,
    recommendedAction: "collect_profit_feedback_review",
    priority: "high",
    status: "draft",
    goal: `补齐收益反馈蒸馏缺口：${missingText}；用于 ${routeLabel}，不把原始事实写入 LoRA。`,
    humanPrompt: `围绕轨迹 ${trajectory.id} 补 ${missingText}。请引用 price SQL、trade ledger、retrieval/sourceRefs，并确认 PEFT 边界 storesRawFacts=false。`,
    requiredToolState: requiredToolStateForProfitReadiness(readiness),
    acceptanceCriteria: [
      "至少绑定一条 sourceRefs、price SQL 或 trade ledger 引用",
      "补齐 realizedPnlPct、maxDrawdownPct、holdingDays 或说明尚未结算",
      "写清 primaryCredit/trainingUse，区分正向执行、买点风险、失败预期",
      "事实、公告、价格行和交易记录保留在 retrieval/tool state",
    ],
    sampleMustInclude: [
      `validationTarget=${validationTarget}`,
      `profitCredit=${creditId}`,
      "realizedPnlPct",
      "maxDrawdownPct",
      "holdingDays",
      "sourceRefs_or_trade_ledger",
      "storesRawFacts=false",
    ],
    suggestedFilters: {
      profitCredit: creditId,
      profitFeedback: feedbackFilter,
      validationTarget,
      qualityGate: trajectory.qualityGate?.status ?? null,
    },
    peftBoundary: {
      storesRawFacts: false,
      factsRemainIn: ["retrieval/tool state"],
      adapterStores: [adapterCapability],
    },
  }
}

export function shouldInlineProfitCollectionTask(
  task?: StockFeedbackCollectionTask | null,
  trajectory?: Pick<StockFeedbackTrajectory, "id" | "validationTarget" | "qualityGate" | "profitFeedback" | "evidenceState" | "sourceRefs"> | null,
) {
  if (!task || !trajectory) return false
  const readiness = buildProfitFeedbackDistillationReadiness(trajectory)
  const expectedTask = buildProfitFeedbackCollectionTask(trajectory, readiness)
  return Boolean(expectedTask && sameCollectionTask(task, expectedTask))
}

export function shouldInlineCollectionResultFollowUp(
  result?: StockFeedbackCollectionResult | null,
  trajectory?: Pick<StockFeedbackTrajectory, "id" | "validationTarget" | "qualityGate" | "profitFeedback" | "evidenceState" | "sourceRefs"> | null,
) {
  if (!result || !trajectory) return false
  const task = collectionTaskFromCollectionResult(result)
  return shouldInlineProfitCollectionTask(task, trajectory)
}

function profitFeedbackCreditDetail(profitFeedback?: StockFeedbackTrajectory["profitFeedback"] | null) {
  const credit = profitFeedback?.creditAssignment
  if (!credit) return ""
  return uniqueTextParts([
    credit.primaryCredit,
    credit.trainingUse,
    (credit.adapterLearns ?? []).length ? `学习 ${credit.adapterLearns?.join("/")}` : "",
    (credit.failureModes ?? []).length ? `风险 ${credit.failureModes?.join("/")}` : "",
    credit.storesRawFacts === false ? "不存原始事实" : "",
  ]).join(" · ")
}

export function buildProfitFeedbackListSignal(
  profitFeedback?: StockFeedbackTrajectory["profitFeedback"] | null,
): ProfitFeedbackListSignal | null {
  const outcome = profitFeedback?.outcome
  if (!outcome || outcome === "unknown") return null
  const detail = uniqueTextParts([
    formatPercent(profitFeedback.realizedPnlPct),
    profitFeedback.maxDrawdownPct !== undefined ? `回撤 ${formatPercent(profitFeedback.maxDrawdownPct)}` : "",
    formatDays(profitFeedback.holdingDays),
    profitFeedback.entryTiming,
  ]).join(" · ")

  if (outcome === "profitable") {
    return {
      label: "盈利支持",
      detail: detail || "正收益",
      tone: "good",
      trainingUse: "adapter_candidate_after_review",
    }
  }
  if (outcome === "direction_right_entry_risk") {
    return {
      label: "买点风险",
      detail: detail || "方向对但买点风险",
      tone: "warn",
      trainingUse: "eval_preference_negative",
    }
  }
  if (["loss", "failed_or_unprofitable"].includes(outcome)) {
    return {
      label: "亏损负样本",
      detail: detail || "亏损/未盈利",
      tone: "danger",
      trainingUse: "eval_preference_negative",
    }
  }
  return {
    label: "待结算",
    detail: detail || profitOutcomeLabel(outcome),
    tone: "warn",
    trainingUse: "monitor_until_settled",
  }
}

function profitFeedbackMatchesFilter(
  profitFeedback?: StockFeedbackTrajectory["profitFeedback"] | null,
  filter: ProfitFeedbackSignalFilter = "all",
) {
  if (filter === "all") return true
  const outcome = profitFeedback?.outcome
  if (filter === "profitable") return outcome === "profitable"
  if (filter === "risk_negative") return ["loss", "failed_or_unprofitable", "direction_right_entry_risk"].includes(outcome ?? "")
  if (filter === "pending") return Boolean(outcome && !["unknown", "profitable", "loss", "failed_or_unprofitable", "direction_right_entry_risk"].includes(outcome))
  return true
}

export function filterTrajectoriesByProfitFeedbackSignal<T extends { profitFeedback?: StockFeedbackTrajectory["profitFeedback"] | null }>(
  trajectories: T[],
  filter: ProfitFeedbackSignalFilter = "all",
) {
  if (filter === "all") return trajectories
  return trajectories.filter((trajectory) => profitFeedbackMatchesFilter(trajectory.profitFeedback, filter))
}

export interface ReviewActionFilterOption {
  id: ReviewActionFilter
  label: string
  detail: string
  tone: "neutral" | "good" | "warn"
  count: number
}

export interface ReviewActionBatchPreviewItem {
  trajectoryId: string
  title: string
  stockLabel: string
  targetLabel: string
  gateLabel: string
  action: string
  actionLabel: string
}

export interface ReviewActionBatchPreview {
  filter: ReviewActionFilter
  label: string
  detail: string
  tone: "neutral" | "good" | "warn"
  count: number
  hiddenCount: number
  firstTrajectoryId: string | null
  canBulkWrite: false
  guardrail: string
  nextActionLabel: string
  actionCounts: Record<string, number>
  items: ReviewActionBatchPreviewItem[]
}

export interface ReviewBucketContext {
  filter: ReviewActionFilter
  label: string
  detail: string
  tone: "neutral" | "good" | "warn"
  selectedTrajectoryId: string
  selectedAction: string
  selectedActionLabel: string
  selectedReviewStatus: "pending" | "reviewed" | "unknown"
  totalCount: number
  pendingCount: number
  reviewedCount: number
  position: number
  completionPct: number
  completionLabel: string
}

function reviewActionMatchesFilter(action: string | null | undefined, filter: ReviewActionFilter) {
  if (filter === "all") return true
  return REVIEW_ACTION_FILTER_ACTIONS[filter].includes(action ?? "")
}

function reviewActionFilterCount(actionCounts: Record<string, number>, filter: ReviewActionFilter) {
  if (filter === "all") {
    return Object.values(actionCounts).reduce((sum, count) => sum + count, 0)
  }
  return REVIEW_ACTION_FILTER_ACTIONS[filter].reduce((sum, action) => sum + (actionCounts[action] ?? 0), 0)
}

export function buildReviewActionFilterOptions(reviewQueue?: StockFeedbackReviewQueueResult | null): ReviewActionFilterOption[] {
  const queueCounts = reviewQueue?.counts ?? {}
  const actionCounts = queueCounts.byRecommendedAction ?? reviewQueueRecommendedActionCounts(reviewQueue?.items)
  const pending = queueCounts.pending ?? reviewActionFilterCount(actionCounts, "all")
  return REVIEW_ACTION_FILTERS.map((definition) => ({
    ...definition,
    count: definition.id === "all" ? pending : reviewActionFilterCount(actionCounts, definition.id),
  }))
}

export function filterTrajectoriesByReviewAction<T extends { id: string }>(
  trajectories: T[],
  reviewByTrajectory?: Map<string, StockFeedbackReviewQueueItem> | Record<string, StockFeedbackReviewQueueItem>,
  filter: ReviewActionFilter = "all",
) {
  if (filter === "all") return trajectories
  return trajectories.filter((trajectory) => {
    const reviewItem = reviewItemFromLookup(reviewByTrajectory, trajectory.id)
    if (!reviewItem || isReviewedFeedbackItem(reviewItem)) return false
    return reviewActionMatchesFilter(recommendedActionForReviewItem(reviewItem), filter)
  })
}

export function buildReviewActionBatchPreview<T extends {
  id: string
  hypothesis?: string
  question?: string
  validationTarget?: string
  qualityGate?: StockFeedbackTrajectory["qualityGate"]
  stock?: StockFeedbackTrajectory["stock"]
}>(
  trajectories: T[],
  reviewByTrajectory?: Map<string, StockFeedbackReviewQueueItem> | Record<string, StockFeedbackReviewQueueItem>,
  filter: ReviewActionFilter = "all",
  options: { limit?: number } = {},
): ReviewActionBatchPreview | null {
  if (filter === "all") return null
  const definition = REVIEW_ACTION_FILTERS.find((item) => item.id === filter)
  if (!definition) return null
  const matching = filterTrajectoriesByReviewAction(trajectories, reviewByTrajectory, filter)
  if (matching.length === 0) return null
  const limit = Math.max(1, Math.min(options.limit ?? 4, 8))
  const actionCounts: Record<string, number> = {}
  const previewItems = matching.slice(0, limit).map((trajectory) => {
    const reviewItem = reviewItemFromLookup(reviewByTrajectory, trajectory.id)
    const action = recommendedActionForReviewItem(reviewItem)
    actionCounts[action] = (actionCounts[action] ?? 0) + 1
    const title = trajectory.hypothesis ?? trajectory.question ?? trajectory.id
    const stockLabel = [trajectory.stock?.name, trajectory.stock?.code].filter(Boolean).join(" ")
    const targetLabel = TARGET_LABELS[trajectory.validationTarget ?? ""] ?? trajectory.validationTarget ?? "待复核"
    const gateLabel = GATE_LABELS[trajectory.qualityGate?.status ?? ""] ?? trajectory.qualityGate?.status ?? "待判定"
    return {
      trajectoryId: trajectory.id,
      title,
      stockLabel,
      targetLabel,
      gateLabel,
      action,
      actionLabel: reviewItem?.humanActionPlan?.recommendedActionLabel ?? reviewItem?.recommendedActionLabel ?? reviewActionLabel(action),
    }
  })
  for (const trajectory of matching.slice(limit)) {
    const action = recommendedActionForReviewItem(reviewItemFromLookup(reviewByTrajectory, trajectory.id))
    actionCounts[action] = (actionCounts[action] ?? 0) + 1
  }
  return {
    filter,
    label: definition.label,
    detail: definition.detail,
    tone: definition.tone,
    count: matching.length,
    hiddenCount: Math.max(0, matching.length - previewItems.length),
    firstTrajectoryId: matching[0]?.id ?? null,
    canBulkWrite: false,
    guardrail: "安全预览：不批量写 review ledger；逐条打开右侧详情，确认 evidence、PEFT boundary 和训练去向后再提交。",
    nextActionLabel: "定位第一条逐条确认",
    actionCounts,
    items: previewItems,
  }
}

function reviewEntriesForFilter<T extends { id: string }>(
  trajectories: T[],
  reviewByTrajectory: Map<string, StockFeedbackReviewQueueItem> | Record<string, StockFeedbackReviewQueueItem> | undefined,
  filter: ReviewActionFilter,
) {
  if (filter === "all") return []
  return trajectories.flatMap((trajectory, index) => {
    const reviewItem = reviewItemFromLookup(reviewByTrajectory, trajectory.id)
    if (!reviewItem) return []
    const action = recommendedActionForReviewItem(reviewItem)
    if (!reviewActionMatchesFilter(action, filter)) return []
    return [{ trajectory, reviewItem, action, index }]
  })
}

export function buildReviewBucketContext<T extends { id: string }>(
  trajectories: T[],
  reviewByTrajectory: Map<string, StockFeedbackReviewQueueItem> | Record<string, StockFeedbackReviewQueueItem> | undefined,
  filter: ReviewActionFilter,
  selectedTrajectoryId?: string | null,
): ReviewBucketContext | null {
  if (filter === "all" || !selectedTrajectoryId) return null
  const definition = REVIEW_ACTION_FILTERS.find((item) => item.id === filter)
  if (!definition) return null
  const entries = reviewEntriesForFilter(trajectories, reviewByTrajectory, filter)
  if (entries.length === 0) return null
  const selectedIndex = entries.findIndex((entry) => entry.trajectory.id === selectedTrajectoryId)
  if (selectedIndex < 0) return null
  const selected = entries[selectedIndex]
  const reviewedCount = entries.filter((entry) => isReviewedFeedbackItem(entry.reviewItem)).length
  const totalCount = entries.length
  const pendingCount = Math.max(0, totalCount - reviewedCount)
  const completionPct = totalCount > 0 ? Math.round((reviewedCount / totalCount) * 100) : 0
  const reviewStatus = isReviewedFeedbackItem(selected.reviewItem)
    ? "reviewed"
    : selected.reviewItem.reviewStatus === "pending"
      ? "pending"
      : "unknown"
  return {
    filter,
    label: definition.label,
    detail: definition.detail,
    tone: definition.tone,
    selectedTrajectoryId,
    selectedAction: selected.action,
    selectedActionLabel: selected.reviewItem.humanActionPlan?.recommendedActionLabel ?? selected.reviewItem.recommendedActionLabel ?? reviewActionLabel(selected.action),
    selectedReviewStatus: reviewStatus,
    totalCount,
    pendingCount,
    reviewedCount,
    position: selectedIndex + 1,
    completionPct,
    completionLabel: `已审 ${reviewedCount}/${totalCount}`,
  }
}

function reviewItemFromLookup(
  reviewByTrajectory: Map<string, StockFeedbackReviewQueueItem> | Record<string, StockFeedbackReviewQueueItem> | undefined,
  trajectoryId: string,
) {
  if (!reviewByTrajectory) return null
  if (reviewByTrajectory instanceof Map) return reviewByTrajectory.get(trajectoryId) ?? null
  return reviewByTrajectory[trajectoryId] ?? null
}

function isReviewedFeedbackItem(reviewItem?: StockFeedbackReviewQueueItem | null) {
  return reviewItem?.reviewStatus === "reviewed" || Boolean(reviewItem?.latestReview) || reviewItem?.humanActionPlan?.alreadyReviewed === true
}

function recommendedActionForReviewItem(reviewItem?: StockFeedbackReviewQueueItem | null, fallbackAction = "route_to_eval") {
  return reviewItem?.humanActionPlan?.recommendedAction ?? reviewItem?.recommendedAction ?? fallbackAction
}

function mostCommonAction(actions: string[], fallbackAction: string) {
  if (actions.length === 0) return fallbackAction
  const counts = new Map<string, number>()
  for (const action of actions) counts.set(action, (counts.get(action) ?? 0) + 1)
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? fallbackAction
}

export function buildProfitFeedbackReviewWorklist<T extends { id: string; profitFeedback?: StockFeedbackTrajectory["profitFeedback"] | null }>(
  trajectories: T[],
  reviewByTrajectory?: Map<string, StockFeedbackReviewQueueItem> | Record<string, StockFeedbackReviewQueueItem>,
): ProfitFeedbackReviewWorklistItem[] {
  return PROFIT_REVIEW_WORKLIST_DEFINITIONS.map((definition) => {
    const matching = trajectories.filter((trajectory) => definition.outcomes.includes(trajectory.profitFeedback?.outcome ?? ""))
    if (matching.length === 0) return null
    const reviewed = matching.filter((trajectory) => isReviewedFeedbackItem(reviewItemFromLookup(reviewByTrajectory, trajectory.id)))
    const pending = matching.filter((trajectory) => !isReviewedFeedbackItem(reviewItemFromLookup(reviewByTrajectory, trajectory.id)))
    const first = pending[0] ?? matching[0] ?? null
    const recommendedAction = mostCommonAction(
      matching.map((trajectory) => recommendedActionForReviewItem(reviewItemFromLookup(reviewByTrajectory, trajectory.id), definition.fallbackAction)),
      definition.fallbackAction,
    )
    const actionLabel = reviewActionLabel(recommendedAction)
    return {
      id: definition.id,
      label: definition.label,
      detail: `${pending.length} 待审 / ${reviewed.length} 已审 · ${actionLabel}`,
      count: matching.length,
      pendingCount: pending.length,
      reviewedCount: reviewed.length,
      filter: definition.filter,
      firstTrajectoryId: first?.id ?? null,
      recommendedAction,
      actionLabel,
      tone: definition.tone,
    }
  }).filter((item): item is NonNullable<typeof item> => Boolean(item))
}

function fallbackReviewActionForTrajectory(
  trajectory: { validationTarget?: string; qualityGate?: StockFeedbackTrajectory["qualityGate"] },
) {
  const gate = trajectory.qualityGate?.status
  if (gate === "needs_evidence") return "needs_evidence"
  if (gate === "priced_in_validated" || trajectory.validationTarget === "priced_in_risk") return "mark_priced_in"
  if (gate === "disconfirmed_validated" || trajectory.validationTarget === "disconfirmation") return "route_to_preference"
  if (trajectory.qualityGate?.highConfidenceEligible === true) return "approve_for_adapter"
  return "route_to_eval"
}

function nextReviewSuggestionSource(
  action: string,
  trajectory: { validationTarget?: string; qualityGate?: StockFeedbackTrajectory["qualityGate"] },
): NextHumanReviewSuggestion["source"] {
  const gate = trajectory.qualityGate?.status
  if (action === "needs_evidence" || gate === "needs_evidence") return "evidence_gap"
  if (
    ["mark_priced_in", "mark_entry_wrong", "route_to_preference", "reject_for_adapter"].includes(action) ||
    gate === "priced_in_validated" ||
    gate === "disconfirmed_validated" ||
    trajectory.validationTarget === "priced_in_risk" ||
    trajectory.validationTarget === "disconfirmation"
  ) {
    return "risk_feedback"
  }
  return "pending_review"
}

function nextReviewSuggestionPriority(source: NextHumanReviewSuggestion["source"], action: string) {
  if (source === "risk_feedback") {
    return action === "mark_priced_in" || action === "mark_entry_wrong" ? 0 : 1
  }
  if (source === "evidence_gap") return 2
  if (action === "approve_for_adapter") return 3
  return 4
}

function nextReviewSuggestionTone(source: NextHumanReviewSuggestion["source"], action: string): NextHumanReviewSuggestion["tone"] {
  if (action === "reject_for_adapter") return "danger"
  if (source === "risk_feedback" || source === "evidence_gap") return "warn"
  if (action === "approve_for_adapter") return "good"
  return "neutral"
}

function nextReviewSuggestionDetail(source: NextHumanReviewSuggestion["source"], actionLabel: string) {
  if (source === "risk_feedback") {
    return `${actionLabel} 优先复核方向对但后手错、买点错、priced-in 或失败承接，避免把方向对但后手错写成正向 adapter。`
  }
  if (source === "evidence_gap") {
    return `${actionLabel} 前先补 sourceRefs、价格路径和 retrieval/tool state；未补齐前不提升 adapter 权重。`
  }
  return `${actionLabel} 前继续复核 PEFT 边界：adapter 只学可复用行为、技能、工具习惯和决策策略。`
}

export function buildNextHumanReviewSuggestion<T extends {
  id: string
  hypothesis?: string
  question?: string
  validationTarget?: string
  qualityGate?: StockFeedbackTrajectory["qualityGate"]
  stock?: StockFeedbackTrajectory["stock"]
}>({
  trajectories,
  reviewByTrajectory,
  currentTrajectoryId,
}: {
  trajectories: T[]
  reviewByTrajectory?: Map<string, StockFeedbackReviewQueueItem> | Record<string, StockFeedbackReviewQueueItem>
  currentTrajectoryId?: string | null
}): NextHumanReviewSuggestion | null {
  const suggestions = trajectories.flatMap((trajectory, index) => {
    if (!trajectory.id || trajectory.id === currentTrajectoryId) return []
    const reviewItem = reviewItemFromLookup(reviewByTrajectory, trajectory.id)
    if (isReviewedFeedbackItem(reviewItem)) return []
    const hasPendingReview = reviewItem?.reviewStatus === "pending" || Boolean(reviewItem?.recommendedAction || reviewItem?.humanActionPlan)
    const gate = trajectory.qualityGate?.status
    const hasRouteableGate = ["needs_evidence", "priced_in_validated", "disconfirmed_validated", "review_required"].includes(gate ?? "")
    if (!hasPendingReview && !hasRouteableGate) return []
    const action = recommendedActionForReviewItem(reviewItem, fallbackReviewActionForTrajectory(trajectory))
    const actionLabel = reviewItem?.humanActionPlan?.recommendedActionLabel ?? reviewItem?.recommendedActionLabel ?? reviewActionLabel(action)
    const source = nextReviewSuggestionSource(action, trajectory)
    const targetLabel = TARGET_LABELS[trajectory.validationTarget ?? ""] ?? trajectory.validationTarget ?? "待复核"
    const stockLabel = [trajectory.stock?.name, trajectory.stock?.code].filter(Boolean).join(" ")
    const label = uniqueTextParts([
      trajectory.hypothesis ?? trajectory.question ?? trajectory.id,
      stockLabel,
      targetLabel,
    ]).slice(0, 3).join(" · ")
    return [{
      trajectoryId: trajectory.id,
      label,
      detail: nextReviewSuggestionDetail(source, actionLabel),
      actionLabel,
      tone: nextReviewSuggestionTone(source, action),
      source,
      priority: nextReviewSuggestionPriority(source, action),
      index,
    }]
  })

  const next = suggestions.sort((left, right) => left.priority - right.priority || left.index - right.index)[0]
  if (!next) return null
  return {
    trajectoryId: next.trajectoryId,
    label: next.label,
    detail: next.detail,
    actionLabel: next.actionLabel,
    tone: next.tone,
    source: next.source,
  }
}

function artifactRefKindLabel(kind?: string) {
  return {
    benchmark_case: "Benchmark case",
    adapter_candidate: "Adapter 候选",
  }[kind ?? ""] ?? kind ?? "Ref"
}

function trainingWeightLabel(suggestion?: NonNullable<ArtifactSourceMix["sourceConcentration"]>["trainingWeightSuggestion"]) {
  if (!suggestion) return ""
  const weight = typeof suggestion.defaultWeightMultiplier === "number"
    ? suggestion.defaultWeightMultiplier.toFixed(1)
    : "待定"
  const max = typeof suggestion.maxWeightMultiplierBeforeReview === "number"
    ? suggestion.maxWeightMultiplierBeforeReview.toFixed(1)
    : weight
  return `训练权重 ${weight}x / 人审前上限 ${max}x`
}

function trainingWeightStateLabel(state?: string) {
  return {
    human_approved_upweight: "已人工提权",
    human_approved_paper_adapter_low_weight: "paper 低权重",
    default_downweighted_pending_review: "默认降权",
    human_risk_downweight: "风控降权",
    evidence_gap_downweight: "补证降权",
    human_rejected_zero_weight: "已排除权重",
    human_routed_standard_review: "保守权重",
  }[state ?? ""] ?? state ?? ""
}

function trainingWeightDecisionDetail(decision?: TrainingWeightDecision) {
  if (!decision) return ""
  const label = trainingWeightStateLabel(decision.state ?? undefined)
  const weight = typeof decision.effectiveWeightMultiplier === "number"
    ? `权重 ${decision.effectiveWeightMultiplier.toFixed(1)}x`
    : ""
  return [label, weight, decision.reason].filter(Boolean).join(" · ")
}

function adapterBatchRecipeBucketLabel(id?: string | null) {
  return {
    human_approved_upweight: "人工确认可提权",
    human_approved_paper_adapter_low_weight: "人审 paper 低权重",
    default_downweighted_pending_review: "未审默认降权",
    human_risk_downweight: "人审风控降权",
    evidence_gap_downweight: "补证降权",
    human_rejected_zero_weight: "人工排除权重",
    human_routed_standard_review: "人审保守权重",
  }[id ?? ""] ?? id ?? "未知配方"
}

function samplingLabel(value?: string | null) {
  return {
    priority_include: "优先纳入",
    downsample_until_review: "人审前降采样",
    prefer_eval_and_negative_mix: "偏 eval/负样本",
    hold_for_evidence: "等待补证",
    exclude_from_positive_adapter: "排除正样本",
    standard_review_sample: "保守抽样",
    manual_review: "人工复核",
  }[value ?? ""] ?? value ?? ""
}

export function buildAuditReviewPrompt(
  context?: AuditSelectionContext | null,
  options: {
    recommendedAction?: string | null
    recommendedActionLabel?: string | null
    gate?: string | null
    canExport?: boolean
  } = {},
): AuditReviewPrompt | null {
  if (!context) return null
  const bucketId = context.bucketId ?? context.trainingWeightState ?? ""
  const bucket = context.bucketLabel ?? adapterBatchRecipeBucketLabel(context.bucketId)
  const sampling = samplingLabel(context.sampling)
  const weight = typeof context.effectiveWeightMultiplier === "number"
    ? `权重 ${context.effectiveWeightMultiplier.toFixed(1)}x`
    : ""
  const weightState = trainingWeightStateLabel(context.trainingWeightState ?? undefined)
  const contextText = uniqueTextParts([
    context.sourceTitle,
    bucket,
    sampling,
    weight,
    weightState,
    context.adapterCapability,
  ]).join(" / ")
  const recommendedLabel = options.recommendedActionLabel ?? reviewActionLabel(options.recommendedAction ?? undefined)
  const canPromote = options.canExport === true
  const isPendingDownweight = bucketId === "default_downweighted_pending_review"
    || context.trainingWeightState === "default_downweighted_pending_review"
    || context.sampling === "downsample_until_review"
  const isEvidenceGap = bucketId === "evidence_gap_downweight"
    || context.sampling === "hold_for_evidence"
    || options.gate === "needs_evidence"
  const isRiskDownweight = bucketId === "human_risk_downweight"
    || context.sampling === "prefer_eval_and_negative_mix"
    || context.trainingWeightState === "human_risk_downweight"
  const isRejected = bucketId === "human_rejected_zero_weight"
    || context.sampling === "exclude_from_positive_adapter"
    || context.trainingWeightState === "human_rejected_zero_weight"
  const isApproved = bucketId === "human_approved_upweight"
    || context.trainingWeightState === "human_approved_upweight"
    || context.sampling === "priority_include"

  if (isPendingDownweight) {
    return {
      headline: "抽查建议：先审后提权",
      detail: "这条来自未审降权/人审前降采样桶，默认低权重参与；本次人审要判断它是可复用行为，还是事实噪声或后手风险。adapter 只学习行为、技能、工具习惯和决策策略。",
      actionHint: canPromote
        ? `若确认可复用且证据边界清楚，再执行 ${recommendedLabel}。`
        : "当前不满足 high-confidence，先转 eval/preference 或补证，不要提权。",
      noteDraft: `抽查复核：${contextText || "未审降权样本"}。结论：先审后提权，只在确认可复用行为且不夹带原始事实后调整训练权重。`,
      tone: "warn",
    }
  }
  if (isEvidenceGap) {
    return {
      headline: "抽查建议：先补证",
      detail: "这条来自补证降权桶，适合验证证据路径和工具调用习惯；事实、公告和交易数据仍留在 retrieval/tool state，未补齐前不要作为正向 adapter 样本。",
      actionHint: "优先执行转补证或进入 eval，等补证回流后再重建轨迹。",
      noteDraft: `抽查复核：${contextText || "补证降权样本"}。结论：证据链不足，先补证或进入 eval，不提升 adapter 权重。`,
      tone: "warn",
    }
  }
  if (isRiskDownweight) {
    return {
      headline: "抽查建议：保留负样本价值",
      detail: "这条来自风控降权/负样本混合桶，优先确认是否属于方向对但买点错、priced-in 或承接失败，用来训练风险识别而不是正向追涨。",
      actionHint: "优先进入 preference/eval；只有复核后确认可复用风控策略，才考虑保守 adapter 候选。",
      noteDraft: `抽查复核：${contextText || "风控降权样本"}。结论：保留为风险/负样本，重点学习买点、赔率和承接判断。`,
      tone: "danger",
    }
  }
  if (isRejected) {
    return {
      headline: "抽查建议：确认排除原因",
      detail: "这条已被排除正向 adapter，复核重点是失败归因是否清楚，以及是否仍可作为 eval/negative/preference 的反例。",
      actionHint: "若排除原因成立，继续排除 adapter；若只是证据不足，改转补证。",
      noteDraft: `抽查复核：${contextText || "排除权重样本"}。结论：复核排除原因，必要时转为 eval/negative/preference 反例。`,
      tone: "danger",
    }
  }
  if (isApproved) {
    return {
      headline: "抽查建议：复核提权依据",
      detail: "这条来自人工确认提权桶，抽查重点是正样本是否真的只沉淀行为/技能/工具习惯/决策策略，而不是把原始事实写进 adapter。",
      actionHint: `若边界仍清楚，保持 ${recommendedLabel}；若证据或事实泄漏风险上升，降级到 eval/preference。`,
      noteDraft: `抽查复核：${contextText || "人工提权样本"}。结论：复核提权依据，只沉淀行为/技能/工具习惯/决策策略，不存原始事实。`,
      tone: "good",
    }
  }
  return {
    headline: "抽查建议：按当前分流复核",
    detail: "这条来自训练批次抽样，重点确认来源偏置、权重和 PEFT 边界；事实仍在 retrieval/tool state，adapter 只学习可复用决策方式。",
    actionHint: `按当前建议动作 ${recommendedLabel} 处理，并记录是否需要调权。`,
    noteDraft: `抽查复核：${contextText || "训练批次样本"}。结论：按当前分流处理，确认来源偏置和 PEFT 边界。`,
    tone: "neutral",
  }
}

export function auditSubmissionKey(context?: AuditSelectionContext | null) {
  if (!context) return null
  if (context.refId) return `ref:${context.refKind ?? "audit"}:${context.refId}`
  if (context.sourceTrajectoryId) return `trajectory:${context.sourceTrajectoryId}`
  if (context.collectionResultId) return `collection:${context.collectionResultId}`
  return null
}

export function buildAuditSubmissionNotice(
  context?: AuditSelectionContext | null,
  event?: AuditSubmissionEvent | null,
): AuditSubmissionNotice | null {
  const key = auditSubmissionKey(context)
  if (!key || !event) return null
  const actionLabel = event.actionLabel ?? reviewActionLabel(event.action ?? undefined)
  const resultLabel = event.result ?? "recorded"
  const tone: AuditSubmissionNotice["tone"] =
    event.action === "approve_for_adapter" ? "good"
      : event.action === "reject_for_adapter" ? "danger"
        : event.action === "needs_evidence" ? "warn"
          : "neutral"
  const nextStep =
    event.action === "needs_evidence"
      ? "下一步：补证回流后重建轨迹，再重新导出 LoRA-ready。"
      : event.action === "reject_for_adapter"
        ? "下一步：重建轨迹并重导出批次，让该样本从正向 adapter 权重中退出。"
        : event.action === "route_to_preference" || event.action === "mark_entry_wrong" || event.action === "mark_priced_in"
          ? "下一步：重建轨迹并刷新 preference/eval 权重，保留风险或买点错误样本价值。"
          : "下一步：重建轨迹并重导出 LoRA-ready，让人审权重进入新批次。"
  const refreshLabel = event.action === "needs_evidence"
    ? null
    : "重建并刷新 LoRA-ready"
  const source = uniqueTextParts([
    context?.sourceTitle,
    context?.bucketLabel ?? (context?.bucketId ? adapterBatchRecipeBucketLabel(context.bucketId) : ""),
    context?.refId,
  ]).join(" / ")
  return {
    key,
    headline: "已提交 review，等待刷新训练权重",
    detail: `${source || "当前抽查样本"} 已记录为 ${actionLabel}；当前批次 manifest 仍显示提交前权重，重建轨迹/重导出后会刷新 bucket 和有效权重。`,
    action: event.action ?? null,
    actionLabel,
    resultLabel,
    nextStep,
    refreshLabel,
    tone,
  }
}

export function buildReviewRefreshPrompt(event?: AuditSubmissionEvent | null): ReviewRefreshPrompt | null {
  if (!event?.action) return null
  const actionLabel = event.actionLabel ?? reviewActionLabel(event.action ?? undefined)
  const resultLabel = event.result ?? "recorded"
  const riskAction = ["route_to_preference", "mark_entry_wrong", "mark_priced_in"].includes(event.action)
  const tone: ReviewRefreshPrompt["tone"] =
    event.action === "approve_for_adapter" ? "good"
      : event.action === "reject_for_adapter" ? "danger"
        : event.action === "needs_evidence" || riskAction ? "warn"
          : "neutral"
  const nextStep =
    event.action === "needs_evidence"
      ? "下一步：等补证回流后重建轨迹，再重新导出训练产物。"
      : riskAction
        ? "下一步：重建轨迹并刷新 LoRA-ready，用 batch delta 查看该样本是否进入 eval/preference 风控权重。"
        : event.action === "reject_for_adapter"
          ? "下一步：重建轨迹并刷新 LoRA-ready，用 batch delta 确认该样本退出 adapter 权重。"
          : "下一步：重建轨迹并刷新 LoRA-ready，用 batch delta 查看人审权重变化。"
  const refreshLabel = event.action === "needs_evidence"
    ? null
    : "重建并刷新 LoRA-ready"
  const detail =
    event.action === "approve_for_adapter"
      ? `${actionLabel} 已记录；刷新后会把该轨迹作为复核后的 adapter 候选进入新批次。`
      : riskAction
        ? `${actionLabel} 已记录；刷新后会优先体现为 eval/preference 风控或负样本权重，而不是正向 adapter。`
        : event.action === "reject_for_adapter"
          ? `${actionLabel} 已记录；刷新后会从 adapter 候选权重中移出，保留审计价值。`
          : `${actionLabel} 已记录；刷新后会把最新人工分流写入训练批次状态。`
  return {
    headline: "已记录人工分流",
    detail,
    action: event.action,
    actionLabel,
    resultLabel,
    nextStep,
    refreshLabel,
    tone,
  }
}

function reviewCycleGateNextSteps(action?: string | null): string[] {
  if (action === "needs_evidence") {
    return [
      "补齐 evidence/sourceRefs/retrieval 工具态",
      "补证回流后重建轨迹",
      "重新导出训练产物并检查 verify",
      "未补齐前不提升 adapter 权重",
    ]
  }
  if (action === "approve_for_adapter") {
    return [
      "重建轨迹并刷新 LoRA-ready",
      "查看 batch delta 是否从未审降权提到人工确认权重",
      "复核 PEFT 边界仍为 storesRawFacts=false",
      "确认 facts/sourceRefs 仍留在 retrieval/tool state",
    ]
  }
  if (action === "reject_for_adapter") {
    return [
      "重建轨迹并刷新 LoRA-ready",
      "查看 batch delta 是否退出正向 adapter 权重",
      "保留失败归因、eval 或 negative 审计价值",
      "确认原始事实不写入 adapter",
    ]
  }
  if (["route_to_preference", "mark_entry_wrong", "mark_priced_in"].includes(action ?? "")) {
    return [
      "重建轨迹并刷新 LoRA-ready",
      "查看 batch delta 是否进入 eval/preference 风控权重",
      "复核方向对但买点错或 priced-in 归因",
      "确认交易数据仍留在 retrieval/tool state",
    ]
  }
  return [
    "重建轨迹并刷新训练产物",
    "查看 batch delta 里的权重或分流变化",
    "确认训练只沉淀可复用行为和决策策略",
  ]
}

export function buildReviewCycleGate({
  submissionNotice,
  reviewRefreshPrompt,
  reviewRefreshResult,
  refreshDiff,
  latestReview,
  latestTrainableArtifactGeneratedAt,
}: {
  submissionNotice?: AuditSubmissionNotice | null
  reviewRefreshPrompt?: ReviewRefreshPrompt | null
  reviewRefreshResult?: ReviewRefreshResult | null
  refreshDiff?: AuditRefreshDiff | null
  latestReview?: StockFeedbackReviewEvent | null
  latestTrainableArtifactGeneratedAt?: string | null
}): ReviewCycleGate | null {
  if (reviewRefreshResult || refreshDiff) return null
  if (submissionNotice) {
    return {
      locked: true,
      source: "audit_submission",
      headline: "已记录，先刷新训练批次",
      detail: `${submissionNotice.actionLabel} 已写入 review ledger；刷新训练批次前继续提交会造成重复分流。请先按下一步完成重建、刷新或补证回流。`,
      action: submissionNotice.action ?? null,
      actionLabel: submissionNotice.actionLabel,
      nextSteps: reviewCycleGateNextSteps(submissionNotice.action),
      refreshLabel: submissionNotice.refreshLabel ?? null,
      tone: submissionNotice.tone,
    }
  }
  if (reviewRefreshPrompt) {
    return {
      locked: true,
      source: "trajectory_review",
      headline: "已记录，先刷新训练批次",
      detail: `${reviewRefreshPrompt.actionLabel} 已写入 review ledger；刷新训练批次前继续提交会造成重复分流。请先用 batch delta 确认新权重或等待补证回流。`,
      action: reviewRefreshPrompt.action ?? null,
      actionLabel: reviewRefreshPrompt.actionLabel,
      nextSteps: reviewCycleGateNextSteps(reviewRefreshPrompt.action),
      refreshLabel: reviewRefreshPrompt.refreshLabel ?? null,
      tone: reviewRefreshPrompt.tone,
    }
  }
  if (latestReviewNeedsTrainableRefresh(latestReview, latestTrainableArtifactGeneratedAt)) {
    const actionLabel = latestReview?.actionLabel ?? reviewActionLabel(latestReview?.action)
    const riskAction = ["route_to_preference", "mark_entry_wrong", "mark_priced_in"].includes(latestReview?.action ?? "")
    const tone: ReviewCycleGate["tone"] =
      latestReview?.action === "approve_for_adapter" ? "good"
        : latestReview?.action === "reject_for_adapter" ? "danger"
          : riskAction ? "warn"
            : "neutral"
    return {
      locked: true,
      source: "latest_review",
      headline: "已记录，先刷新训练批次",
      detail: `${actionLabel} 已写入 review ledger；最新 LoRA-ready 批次早于该 review，刷新前继续提交会造成重复分流。`,
      action: latestReview?.action ?? null,
      actionLabel,
      nextSteps: reviewCycleGateNextSteps(latestReview?.action),
      refreshLabel: "重建并刷新 LoRA-ready",
      tone,
    }
  }
  return null
}

export function buildReviewCycleGateCollectionBridge(
  gate?: ReviewCycleGate | null,
  task?: StockFeedbackCollectionTask | null,
): ReviewCycleGateCollectionBridge | null {
  if (!gate?.locked || gate.action !== "needs_evidence" || !task) return null
  const target = task.targetPatternLabel
    ?? task.targetPatternId
    ?? task.targetProfitCreditLabel
    ?? profitCreditBucketLabel(task.targetProfitCredit)
    ?? "当前轨迹"
  return {
    headline: "补证入口：生成采集单",
    detail: `为 ${target} 补 retrieval/tool state、sourceRefs、价格路径或真实交易反馈；未补齐前不提升 adapter 权重。`,
    actionLabel: "生成补证任务",
    task,
  }
}

export function buildReviewCycleNextAction(
  gate?: ReviewCycleGate | null,
  collectionBridge?: ReviewCycleGateCollectionBridge | null,
): ReviewCycleNextAction | null {
  if (!gate?.locked) return null
  if (gate.action === "needs_evidence") {
    if (collectionBridge) {
      return {
        headline: "当前下一步：生成补证任务",
        detail: collectionBridge.detail,
        actionLabel: collectionBridge.actionLabel,
        actionKind: "create_collection_task",
        tone: "warn",
      }
    }
    return {
      headline: "当前下一步：等待补证",
      detail: "先补齐 evidence/sourceRefs/retrieval 工具态；补证回流前不刷新正向训练权重，也不提升 adapter。",
      actionLabel: "补证后回流",
      actionKind: "wait_evidence",
      tone: "warn",
    }
  }
  if (gate.refreshLabel) {
    return {
      headline: "当前下一步：刷新训练批次",
      detail: "重建轨迹并刷新 LoRA-ready；用 batch delta 确认权重/分流变化，同时复核 PEFT 边界仍不存原始事实。",
      actionLabel: gate.refreshLabel,
      actionKind: "refresh_lora_ready",
      tone: gate.tone,
    }
  }
  return {
    headline: "当前下一步：按清单处理",
    detail: gate.detail,
    actionLabel: "等待处理",
    actionKind: "none",
    tone: gate.tone,
  }
}

export function buildReviewActionStatusHint({
  auditContext,
  auditPrompt,
  peftActionHint,
  reviewCycleGate,
  reviewRefreshResult,
  refreshDiff,
  recommendedAction,
  recommendedActionLabel,
  canExport,
  peftAllowsAdapter,
}: {
  auditContext?: AuditSelectionContext | null
  auditPrompt?: AuditReviewPrompt | null
  peftActionHint?: PeftBoundaryActionHint | null
  reviewCycleGate?: ReviewCycleGate | null
  reviewRefreshResult?: ReviewRefreshResult | null
  refreshDiff?: AuditRefreshDiff | null
  recommendedAction?: string | null
  recommendedActionLabel?: string | null
  canExport?: boolean
  peftAllowsAdapter?: boolean
}): ReviewActionStatusHint {
  const recommendedLabel = recommendedActionLabel ?? reviewActionLabel(recommendedAction ?? undefined)
  if (reviewCycleGate?.locked) {
    return {
      headline: "人审已锁定，先刷新训练批次",
      detail: reviewCycleGate.detail,
      tone: reviewCycleGate.tone,
      chips: uniqueTextParts([
        reviewCycleGate.actionLabel,
        reviewCycleGate.refreshLabel,
      ]),
    }
  }
  if (refreshDiff) {
    return {
      headline: "权重刷新已确认",
      detail: `${refreshDiff.beforeLabel} -> ${refreshDiff.afterLabel}。可以继续下一次人审，原始事实仍留在 retrieval/tool state。`,
      tone: refreshDiff.tone,
      chips: uniqueTextParts([
        refreshDiff.headline,
        recommendedLabel,
      ]),
    }
  }
  if (reviewRefreshResult) {
    return {
      headline: "批次刷新已确认",
      detail: `${reviewRefreshResult.beforeLabel || "未进入"} -> ${reviewRefreshResult.afterLabel || "未进入"}。${reviewRefreshResult.detail}`,
      tone: reviewRefreshResult.tone,
      chips: uniqueTextParts([
        reviewRefreshResult.headline,
        recommendedLabel,
      ]),
    }
  }
  if (auditContext) {
    const weightLabel = typeof auditContext.effectiveWeightMultiplier === "number"
      ? `权重 ${auditContext.effectiveWeightMultiplier.toFixed(1)}x`
      : ""
    const stateLabel = auditContext.bucketLabel ?? trainingWeightStateLabel(auditContext.trainingWeightState ?? undefined)
    const headline = stateLabel ? `提交前：${stateLabel}` : "提交前：确认训练分流"
    const canDirectAdapter = recommendedAction === "approve_for_adapter" && canExport === true && peftAllowsAdapter === true
    const adapterGuard = recommendedAction === "approve_for_adapter" && !canDirectAdapter
      ? "当前不满足直接 adapter 条件，先按 PEFT/证据闸门处理；提交后先重建并刷新 LoRA-ready，用 batch delta 确认权重没有误提。"
      : "提交后先重建并刷新 LoRA-ready，再用 batch delta 确认权重变化。"
    return {
      headline,
      detail: `建议动作：${recommendedLabel}。${adapterGuard}`,
      tone: auditPrompt?.tone ?? peftActionHint?.tone ?? (canDirectAdapter ? "good" : "warn"),
      chips: uniqueTextParts([
        weightLabel,
        samplingLabel(auditContext.sampling),
        auditPrompt?.headline,
        peftActionHint?.headline,
      ]),
    }
  }
  if (peftActionHint?.locksAdapterApproval) {
    return {
      headline: "PEFT 闸门锁住正向 adapter",
      detail: peftActionHint.detail,
      tone: peftActionHint.tone,
      chips: uniqueTextParts([
        peftActionHint.recommendedActionLabel,
        recommendedLabel,
      ]),
    }
  }
  return {
    headline: "提交前：确认训练分流",
    detail: `建议动作：${recommendedLabel}。提交后根据 review ledger 重建轨迹/刷新训练产物。`,
    tone: "neutral",
    chips: uniqueTextParts([recommendedLabel]),
  }
}

export function buildAdapterApprovalDisabledHint({
  gate,
  recommendedActionLabel,
  canExport,
  peftAllowsAdapter,
}: {
  gate?: string | null
  recommendedActionLabel?: string | null
  canExport?: boolean
  peftAllowsAdapter?: boolean
}) {
  const actionLabel = recommendedActionLabel ?? "当前推荐动作"
  if (peftAllowsAdapter === false) {
    return `PEFT 闸门锁住正向 adapter：先确认原始事实、公告、价格行和交易记录仍留在 retrieval/tool state，补齐 sourceRefs 与 storesRawFacts=false 后再复核。`
  }
  if (canExport !== false) return null
  if (gate === "priced_in_validated") {
    return `质量门不允许正向 adapter：当前应执行 ${actionLabel}，优先进入 eval/preference，训练“方向对但后手风险高”。`
  }
  if (gate === "disconfirmed_validated") {
    return `质量门不允许正向 adapter：当前应执行 ${actionLabel}，优先进入失败归因、负样本或 preference。`
  }
  if (gate === "needs_evidence") {
    return `质量门不允许正向 adapter：当前应执行 ${actionLabel}，先补 retrieval/tool state、sourceRefs 和验证路径。`
  }
  return `质量门不允许正向 adapter：当前应执行 ${actionLabel}，确认训练目标、人工 review 和 PEFT 边界后再提权。`
}

export function buildAdapterApprovalButtonPresentation(disabledHint?: string | null): {
  variant: "default" | "outline"
  className: string
} {
  if (!disabledHint) {
    return {
      variant: "default",
      className: "",
    }
  }
  return {
    variant: "outline",
    className: "border-amber-500/30 bg-amber-500/5 text-amber-900 !opacity-100 hover:bg-amber-500/5",
  }
}

export function buildReviewRefreshCompletionSummary({
  reviewRefreshResult,
  refreshDiff,
  recommendedActionLabel,
}: {
  reviewRefreshResult?: ReviewRefreshResult | null
  refreshDiff?: AuditRefreshDiff | null
  recommendedActionLabel?: string | null
}): ReviewRefreshCompletionSummary | null {
  const recommendedLabel = recommendedActionLabel ?? ""
  if (refreshDiff) {
    return {
      headline: "刷新结果已确认",
      detail: `${refreshDiff.detail} 可以继续下一次人审；原始事实仍留在 retrieval/tool state，adapter 只保留可复用行为、技能、工具习惯和决策策略。`,
      movementLabel: "权重变化",
      beforeLabel: refreshDiff.beforeLabel,
      afterLabel: refreshDiff.afterLabel,
      actionLabel: "继续下一次人审",
      tone: refreshDiff.tone,
      chips: uniqueTextParts([
        refreshDiff.headline,
        recommendedLabel,
      ]),
    }
  }
  if (reviewRefreshResult) {
    return {
      headline: "刷新结果已确认",
      detail: `${reviewRefreshResult.detail} 可以继续下一次人审；原始事实仍留在 retrieval/tool state，adapter 只保留可复用行为、技能、工具习惯和决策策略。`,
      movementLabel: reviewRefreshResult.movementLabel,
      beforeLabel: reviewRefreshResult.beforeLabel,
      afterLabel: reviewRefreshResult.afterLabel,
      actionLabel: "继续下一次人审",
      tone: reviewRefreshResult.tone,
      chips: uniqueTextParts([
        recommendedLabel,
      ]),
    }
  }
  return null
}

function isPaperTradeTrajectory(trajectory?: Pick<StockFeedbackTrajectory, "source" | "sourceKind" | "paperTradeState" | "profitFeedback"> | null) {
  if (!trajectory) return false
  return trajectory.source === "stock-feedback-paper-trade"
    || trajectory.sourceKind === "stock-feedback-paper-trade"
    || Boolean(trajectory.paperTradeState)
    || trajectory.profitFeedback?.ledgerKind === "paper_trade"
}

export function buildPaperTradeReviewClosureSummary({
  trajectory,
  reviewRefreshPrompt,
  reviewRefreshResult,
  refreshDiff,
}: {
  trajectory?: Pick<StockFeedbackTrajectory, "source" | "sourceKind" | "paperTradeState" | "profitFeedback"> | null
  reviewRefreshPrompt?: ReviewRefreshPrompt | null
  reviewRefreshResult?: ReviewRefreshResult | null
  refreshDiff?: AuditRefreshDiff | null
}): PaperTradeReviewClosureSummary | null {
  if (!isPaperTradeTrajectory(trajectory)) return null
  const ledgerKind = trajectory?.paperTradeState?.ledgerKind ?? trajectory?.profitFeedback?.ledgerKind ?? "paper_trade"
  const trackLabel = paperTradeTrackLabel(trajectory?.paperTradeState?.track)
  const statusLabel = paperTradeStatusLabel(trajectory?.paperTradeState?.status)
  const baseChips = uniqueTextParts([ledgerKind, trackLabel, statusLabel])

  if (refreshDiff || reviewRefreshResult) {
    const result = refreshDiff ? {
      movementLabel: "权重变化",
      beforeLabel: refreshDiff.beforeLabel,
      afterLabel: refreshDiff.afterLabel,
      detail: refreshDiff.detail,
      tone: refreshDiff.tone,
      headline: refreshDiff.headline,
    } : {
      movementLabel: reviewRefreshResult?.movementLabel ?? "批次变化",
      beforeLabel: reviewRefreshResult?.beforeLabel ?? "",
      afterLabel: reviewRefreshResult?.afterLabel ?? "",
      detail: reviewRefreshResult?.detail ?? "",
      tone: reviewRefreshResult?.tone ?? "neutral",
      headline: reviewRefreshResult?.headline ?? "",
    }
    return {
      headline: "模拟交易训练批次已刷新",
      detail: `${result.detail} paper_trade 只是模拟收益证据，不能等同真实盈利样本；adapter 只学习可复用执行行为、工具习惯和决策策略。`,
      movementLabel: result.movementLabel,
      beforeLabel: result.beforeLabel,
      afterLabel: result.afterLabel,
      actionLabel: "继续下一条人审",
      tone: result.tone,
      chips: uniqueTextParts([
        ...baseChips,
        result.headline,
        "paper trade 低权重边界",
      ]),
    }
  }

  if (reviewRefreshPrompt) {
    return {
      headline: "模拟交易已人审，等待训练批次刷新",
      detail: `${reviewRefreshPrompt.actionLabel} 已写入 review ledger；先重建并刷新 LoRA-ready，再看 batch delta 是否提权、降权、转 eval/preference 或退出正向 adapter。`,
      movementLabel: "等待 batch delta",
      beforeLabel: "review 已记录",
      afterLabel: "等待 LoRA-ready 刷新",
      actionLabel: reviewRefreshPrompt.refreshLabel ?? "重建并刷新 LoRA-ready",
      tone: reviewRefreshPrompt.tone,
      chips: uniqueTextParts([
        ...baseChips,
        reviewRefreshPrompt.actionLabel,
        "先人审后训练",
      ]),
    }
  }

  return null
}

function latestReviewNeedsTrainableRefresh(
  latestReview?: StockFeedbackReviewEvent | null,
  latestTrainableArtifactGeneratedAt?: string | null,
) {
  if (!latestReview?.action || latestReview.action === "needs_evidence") return false
  const reviewStamp = comparableTimestamp(latestReview.generatedAt)
  if (!reviewStamp) return false
  const artifactStamp = comparableTimestamp(latestTrainableArtifactGeneratedAt)
  if (!artifactStamp) return true
  return reviewStamp > artifactStamp
}

function comparableTimestamp(value?: string | null) {
  return String(value ?? "").replace(/\D/g, "").slice(0, 14)
}

export function auditContextTrainingWeightLabel(context?: AuditSelectionContext | null) {
  if (!context) return "未进入 LoRA-ready 批次"
  const bucket = context.bucketLabel ?? (context.bucketId ? adapterBatchRecipeBucketLabel(context.bucketId) : "")
  const sampling = samplingLabel(context.sampling)
  const weight = typeof context.effectiveWeightMultiplier === "number"
    ? `权重 ${context.effectiveWeightMultiplier.toFixed(1)}x`
    : ""
  const state = trainingWeightStateLabel(context.trainingWeightState ?? undefined)
  return uniqueTextParts([bucket, sampling, weight, state]).join(" / ") || "未标注训练权重"
}

export function buildAuditRefreshDiff(
  before?: AuditSelectionContext | null,
  after?: AuditSelectionContext | null,
): AuditRefreshDiff | null {
  const key = auditSubmissionKey(before) ?? auditSubmissionKey(after)
  if (!key || !before) return null
  const beforeLabel = auditContextTrainingWeightLabel(before)
  const afterLabel = after ? auditContextTrainingWeightLabel(after) : "未进入 LoRA-ready 批次"
  const beforeWeight = typeof before.effectiveWeightMultiplier === "number" ? before.effectiveWeightMultiplier : null
  const afterWeight = typeof after?.effectiveWeightMultiplier === "number" ? after.effectiveWeightMultiplier : null
  const tone: AuditRefreshDiff["tone"] = !after
    ? "warn"
    : beforeWeight !== null && afterWeight !== null && afterWeight > beforeWeight
      ? "good"
      : beforeWeight !== null && afterWeight !== null && afterWeight < beforeWeight
        ? "warn"
        : "neutral"
  const headline = after ? "训练权重已刷新" : "刷新后未进入 LoRA-ready"
  const detail = after
    ? `${beforeLabel} -> ${afterLabel}。这只更新训练配方和权重视图；原始事实、公告和交易数据仍留在 retrieval/tool state。`
    : `${beforeLabel} -> 未进入 LoRA-ready 批次。可能已按人审结果转入补证、eval/preference 或排除正向 adapter；原始事实不会写入 LoRA。`
  return {
    key,
    headline,
    beforeLabel,
    afterLabel,
    detail,
    tone,
  }
}

function reviewRefreshResultTone(movement?: string | null): ReviewRefreshResult["tone"] {
  if (movement === "upweighted" || movement === "moved_in") return "good"
  if (movement === "downweighted" || movement === "moved_out") return "warn"
  return "neutral"
}

export function buildReviewRefreshResult(
  summary?: AuditBatchRefreshSummary | null,
  trajectoryId?: string | null,
): ReviewRefreshResult | null {
  if (!summary || !trajectoryId) return null
  const movement = summary.movementIndex?.[trajectoryId]
    ?? (summary.movements ?? []).find((item) => item.sourceTrajectoryId === trajectoryId)
  if (!movement) {
    return {
      headline: "训练批次已刷新",
      movementLabel: "未在变化样本中",
      beforeLabel: "",
      afterLabel: "",
      detail: `当前轨迹未出现在本次 batch delta 的优先变化样本中；整体批次 ${summary.totalBefore} -> ${summary.totalAfter}，可到训练批次来源审计查看全局变化。原始事实仍留在 retrieval/tool state。`,
      tone: "neutral",
    }
  }
  const movementLabel = auditBatchRefreshMovementLabel(movement.movement)
  const beforeLabel = auditBatchRefreshMovementStateLabel(movement.before)
  const afterLabel = auditBatchRefreshMovementStateLabel(movement.after)
  return {
    headline: `刷新结果：${movementLabel}`,
    movementLabel,
    beforeLabel,
    afterLabel,
    detail: `${beforeLabel} -> ${afterLabel}。这次刷新只更新训练配方、bucket 和权重视图；原始事实、公告和交易数据仍留在 retrieval/tool state。`,
    tone: reviewRefreshResultTone(movement.movement),
  }
}

export function collectAuditContextsFromSourceMix(
  mix?: ArtifactSourceMix | null,
  sourceTitle = "LoRA-ready 来源",
) {
  const contexts: AuditSelectionContext[] = []
  const seen = new Set<string>()
  const pushContext = (context: AuditSelectionContext) => {
    const key = auditSubmissionKey(context)
    if (!key || seen.has(key)) return
    seen.add(key)
    contexts.push(context)
  }

  for (const bucket of mix?.adapterBatchRecipe?.buckets ?? []) {
    const label = bucket.label ?? adapterBatchRecipeBucketLabel(bucket.id)
    for (const ref of bucket.candidateRefs ?? []) {
      pushContext(auditContextFromRef(ref, {
        sourceTitle,
        bucketId: bucket.id,
        bucketLabel: label,
        sampling: bucket.recommendedSampling,
        effectiveWeightMultiplier: bucket.effectiveWeightMultiplier,
        trainingWeightState: bucket.id,
      }))
    }
  }
  for (const ref of mix?.refs ?? []) {
    pushContext(auditContextFromRef(ref, { sourceTitle }))
  }
  return contexts
}

export function buildAuditBatchRefreshSummary(
  beforeMix?: ArtifactSourceMix | null,
  afterMix?: ArtifactSourceMix | null,
): AuditBatchRefreshSummary | null {
  const before = collectAuditContextsFromSourceMix(beforeMix)
  const after = collectAuditContextsFromSourceMix(afterMix)
  if (before.length === 0 && after.length === 0) return null

  const beforeByKey = keyedAuditContexts(before)
  const afterByKey = keyedAuditContexts(after)
  let upweighted = 0
  let downweighted = 0
  let unchanged = 0
  let rerouted = 0
  let movedOut = 0
  const movements: AuditBatchRefreshMovement[] = []

  for (const [key, beforeContext] of beforeByKey) {
    const afterContext = afterByKey.get(key)
    if (!afterContext) {
      movedOut += 1
      movements.push(auditBatchRefreshMovementFromContexts("moved_out", beforeContext, null))
      continue
    }
    const beforeWeight = auditContextWeight(beforeContext)
    const afterWeight = auditContextWeight(afterContext)
    if (beforeWeight !== null && afterWeight !== null && afterWeight > beforeWeight) {
      upweighted += 1
      movements.push(auditBatchRefreshMovementFromContexts("upweighted", beforeContext, afterContext))
    } else if (beforeWeight !== null && afterWeight !== null && afterWeight < beforeWeight) {
      downweighted += 1
      movements.push(auditBatchRefreshMovementFromContexts("downweighted", beforeContext, afterContext))
    } else {
      const beforeBucket = beforeContext.bucketId ?? beforeContext.trainingWeightState
      const afterBucket = afterContext.bucketId ?? afterContext.trainingWeightState
      if (beforeBucket !== afterBucket) {
        rerouted += 1
        movements.push(auditBatchRefreshMovementFromContexts("rerouted", beforeContext, afterContext))
      } else {
        unchanged += 1
        movements.push(auditBatchRefreshMovementFromContexts("unchanged", beforeContext, afterContext))
      }
    }
  }

  let movedIn = 0
  for (const key of afterByKey.keys()) {
    if (!beforeByKey.has(key)) {
      movedIn += 1
      movements.push(auditBatchRefreshMovementFromContexts("moved_in", null, afterByKey.get(key) ?? null))
    }
  }

  const evidenceGap = countContextsInState(after, ["evidence_gap_downweight"], ["hold_for_evidence"])
  const rejected = countContextsInState(after, ["human_rejected_zero_weight"], ["exclude_from_positive_adapter"])
  const preferenceOrRisk = countContextsInState(after, ["human_risk_downweight"], ["prefer_eval_and_negative_mix"])
  const adapterApproved = countContextsInState(after, ["human_approved_upweight"], ["priority_include"])
  const movement = uniqueTextParts([
    upweighted ? `提权 ${upweighted}` : "",
    downweighted ? `降权 ${downweighted}` : "",
    rerouted ? `改分流 ${rerouted}` : "",
    movedIn ? `新增 ${movedIn}` : "",
    movedOut ? `转出 ${movedOut}` : "",
    evidenceGap ? `待补证 ${evidenceGap}` : "",
    rejected ? `排除 ${rejected}` : "",
  ]).join("，")

  return {
    headline: "批次刷新影响",
    detail: `${before.length} 条到 ${after.length} 条；${movement || "训练权重结构暂无明显迁移"}。本次只比较训练配方与引用，不搬运原始事实；公告、交易数据和原文仍留在 retrieval/tool state。`,
    totalBefore: before.length,
    totalAfter: after.length,
    upweighted,
    downweighted,
    unchanged,
    rerouted,
    movedOut,
    movedIn,
    evidenceGap,
    rejected,
    preferenceOrRisk,
    adapterApproved,
    movements: prioritizeAuditBatchRefreshMovements(movements).slice(0, 8),
    movementIndex: buildAuditBatchRefreshMovementIndex(movements),
    source: "lora-ready-refresh",
  }
}

function lookupAuditBatchRefreshMovements(summary?: AuditBatchRefreshSummary | null) {
  const seen = new Set<string>()
  const movements: AuditBatchRefreshMovement[] = []
  const push = (movement?: AuditBatchRefreshMovement | null) => {
    if (!movement) return
    const key = movement.sourceTrajectoryId ?? movement.id ?? movement.key
    if (!key || seen.has(key)) return
    seen.add(key)
    movements.push(movement)
  }
  for (const movement of Object.values(summary?.movementIndex ?? {})) push(movement)
  for (const movement of summary?.movements ?? []) push(movement)
  return movements
}

export function batchRefreshMovementTrajectoryIds(
  summary?: AuditBatchRefreshSummary | null,
  filter: AuditBatchRefreshMovementFilter = "all",
) {
  const ids = new Set<string>()
  if (filter === "all") return ids
  for (const movement of lookupAuditBatchRefreshMovements(summary)) {
    if (movement.movement === filter && movement.sourceTrajectoryId) ids.add(movement.sourceTrajectoryId)
  }
  return ids
}

export function filterTrajectoriesByBatchRefreshMovement<T extends { id?: string | null }>(
  trajectories: T[],
  summary?: AuditBatchRefreshSummary | null,
  filter: AuditBatchRefreshMovementFilter = "all",
) {
  if (filter === "all") return trajectories
  const ids = batchRefreshMovementTrajectoryIds(summary, filter)
  if (ids.size === 0) return []
  return trajectories.filter((trajectory) => Boolean(trajectory.id && ids.has(trajectory.id)))
}

export function buildBatchRefreshReviewActions(summary?: AuditBatchRefreshSummary | null): BatchRefreshReviewAction[] {
  if (!summary) return []
  const actions: BatchRefreshReviewAction[] = [
    {
      filter: "downweighted",
      count: summary.downweighted,
      priority: "high",
      headline: "优先复核降权样本",
      detail: "确认是否属于 priced-in、方向对但买点错、承接失败或伪催化；优先转 preference/eval，而不是正向 adapter。",
      recommendedAction: "route_to_preference_or_priced_in_review",
      actionLabel: "看降权",
    },
    {
      filter: "moved_out",
      count: summary.movedOut,
      priority: "high",
      headline: "确认转出后去向",
      detail: "复核转出样本是被排除正向 adapter、转补证，还是进入 eval/negative；不要让失败样本从训练账本里消失。",
      recommendedAction: "confirm_exclusion_evidence_or_negative_eval",
      actionLabel: "看转出",
    },
    {
      filter: "rerouted",
      count: summary.rerouted ?? 0,
      priority: "medium",
      headline: "确认能力桶迁移",
      detail: "同权重但能力桶变化时，重点确认 adapter 能力、训练目标和 benchmark 分流是否被人审正确改写。",
      recommendedAction: "review_adapter_capability_bucket",
      actionLabel: "看改分流",
    },
    {
      filter: "moved_in",
      count: summary.movedIn,
      priority: "medium",
      headline: "抽查新增候选",
      detail: "新增样本先确认来源、证据边界和行为可复用性，再决定是否保持候选或降级到 eval/preference。",
      recommendedAction: "review_new_adapter_candidate",
      actionLabel: "看新增",
    },
    {
      filter: "upweighted",
      count: summary.upweighted,
      priority: "low",
      headline: "复核提权边界",
      detail: "提权样本要再次检查 PEFT 边界：LoRA 不存原始事实，只沉淀行为、技能、工具习惯和决策策略。",
      recommendedAction: "audit_peft_boundary_before_adapter",
      actionLabel: "看提权",
    },
  ]
  return actions.filter((action) => action.count > 0)
}

function auditBatchRefreshMovementState(context?: AuditSelectionContext | null): AuditBatchRefreshMovementState | null {
  if (!context) return null
  return {
    bucketId: context.bucketId ?? null,
    bucketLabel: context.bucketLabel ?? null,
    trainingWeightState: context.trainingWeightState ?? null,
    effectiveWeightMultiplier: typeof context.effectiveWeightMultiplier === "number" ? context.effectiveWeightMultiplier : null,
    recommendedSampling: context.sampling ?? null,
  }
}

function auditBatchRefreshMovementFromContexts(
  movement: string,
  before?: AuditSelectionContext | null,
  after?: AuditSelectionContext | null,
): AuditBatchRefreshMovement {
  return {
    key: auditSubmissionKey(before) ?? auditSubmissionKey(after),
    id: after?.refId ?? before?.refId ?? null,
    sourceTrajectoryId: after?.sourceTrajectoryId ?? before?.sourceTrajectoryId ?? null,
    adapterCapability: after?.adapterCapability ?? before?.adapterCapability ?? null,
    movement,
    before: auditBatchRefreshMovementState(before),
    after: auditBatchRefreshMovementState(after),
  }
}

function prioritizeAuditBatchRefreshMovements(movements: AuditBatchRefreshMovement[]) {
  const priority: Record<string, number> = {
    upweighted: 0,
    downweighted: 1,
    rerouted: 2,
    moved_in: 3,
    moved_out: 4,
    unchanged: 5,
  }
  return movements.slice().sort((left, right) => (priority[left.movement ?? ""] ?? 9) - (priority[right.movement ?? ""] ?? 9))
}

function buildAuditBatchRefreshMovementIndex(movements: AuditBatchRefreshMovement[]) {
  const index: Record<string, AuditBatchRefreshMovement> = {}
  for (const movement of prioritizeAuditBatchRefreshMovements(movements)) {
    const trajectoryId = movement.sourceTrajectoryId
    if (!trajectoryId || index[trajectoryId]) continue
    index[trajectoryId] = movement
  }
  return index
}

function keyedAuditContexts(contexts: AuditSelectionContext[]) {
  const map = new Map<string, AuditSelectionContext>()
  for (const context of contexts) {
    const key = auditSubmissionKey(context)
    if (key && !map.has(key)) map.set(key, context)
  }
  return map
}

function auditContextWeight(context?: AuditSelectionContext | null) {
  const weight = context?.effectiveWeightMultiplier
  return typeof weight === "number" && Number.isFinite(weight) ? weight : null
}

function countContextsInState(contexts: AuditSelectionContext[], states: string[], samplings: string[]) {
  return contexts.filter((context) => {
    const stateValues = [context.bucketId, context.trainingWeightState].filter(Boolean)
    return stateValues.some((value) => states.includes(value ?? ""))
      || Boolean(context.sampling && samplings.includes(context.sampling))
  }).length
}

function findAuditContextInStatus(status?: StockFeedbackStatus | null, previous?: AuditSelectionContext | null) {
  return findAuditContextInSourceMix(status?.artifactSourceMix?.loraReady, previous, "LoRA-ready 来源")
}

function findAuditContextInSourceMix(
  mix?: ArtifactSourceMix | null,
  previous?: AuditSelectionContext | null,
  sourceTitle = "LoRA-ready 来源",
) {
  if (!mix || !previous) return null
  const key = auditSubmissionKey(previous)
  const matches = (context: AuditSelectionContext) => (
    Boolean(key && auditSubmissionKey(context) === key)
    || Boolean(previous.sourceTrajectoryId && context.sourceTrajectoryId === previous.sourceTrajectoryId)
  )
  for (const bucket of mix.adapterBatchRecipe?.buckets ?? []) {
    const label = bucket.label ?? adapterBatchRecipeBucketLabel(bucket.id)
    for (const ref of bucket.candidateRefs ?? []) {
      const context = auditContextFromRef(ref, {
        sourceTitle,
        bucketId: bucket.id,
        bucketLabel: label,
        sampling: bucket.recommendedSampling,
        effectiveWeightMultiplier: bucket.effectiveWeightMultiplier,
      })
      if (matches(context)) return context
    }
  }
  for (const ref of mix.refs ?? []) {
    const context = auditContextFromRef(ref, { sourceTitle })
    if (matches(context)) return context
  }
  return null
}

function auditContextFromRef(ref: ArtifactAuditRef, extra: Partial<AuditSelectionContext> = {}): AuditSelectionContext {
  return {
    sourceTitle: extra.sourceTitle,
    sourceTrajectoryId: ref.sourceTrajectoryId ?? extra.sourceTrajectoryId ?? null,
    refKind: ref.refKind ?? null,
    refId: ref.id ?? null,
    bucketId: extra.bucketId ?? ref.bucketId ?? null,
    bucketLabel: extra.bucketLabel ?? ref.bucketLabel ?? null,
    sampling: extra.sampling ?? ref.sampling ?? ref.recommendedSampling ?? null,
    effectiveWeightMultiplier: extra.effectiveWeightMultiplier ?? ref.effectiveWeightMultiplier ?? null,
    trainingWeightState: ref.trainingWeightState ?? extra.trainingWeightState ?? null,
    sourceKindLabel: ref.sourceKindLabel ?? extra.sourceKindLabel ?? trajectorySourceLabel(ref.sourceKind ?? undefined),
    collectionResultId: ref.collectionResultId ?? extra.collectionResultId ?? null,
    paperTradeId: ref.paperTradeId ?? extra.paperTradeId ?? null,
    adapterCapability: ref.adapterCapability ?? extra.adapterCapability ?? null,
  }
}

function adapterBatchRecipeDetail(recipe?: AdapterBatchRecipeSummary | null) {
  const buckets = recipe?.buckets?.filter((bucket) => (bucket.count ?? 0) > 0) ?? []
  if (buckets.length === 0) return ""
  const bucketText = buckets.slice(0, 3).map((bucket) => {
    const label = bucket.label ?? adapterBatchRecipeBucketLabel(bucket.id)
    const count = bucket.count ?? 0
    const weight = typeof bucket.effectiveWeightMultiplier === "number"
      ? ` @${bucket.effectiveWeightMultiplier.toFixed(1)}x`
      : ""
    return `${label} ${count}${weight}`
  }).join(" / ")
  const totalWeight = typeof recipe?.totalEffectiveWeight === "number"
    ? ` · 有效权重 ${recipe.totalEffectiveWeight.toFixed(1)}`
    : ""
  return `配方 ${bucketText}${totalWeight}`
}

function profitCreditBucketLabel(id?: string | null) {
  return {
    pattern_execution_supported: "收益支持手法执行",
    execution_risk_negative: "执行风险负样本",
    failed_expectation_negative: "失败预期负样本",
    unsettled_feedback_pending: "待结算收益反馈",
  }[id ?? ""] ?? id ?? "未标注归因"
}

function profitCreditActionLabel(action?: string | null) {
  return {
    collect_profit_feedback: "补正收益执行样本",
    collect_entry_risk_loss_feedback: "补买点/仓位亏损样本",
    collect_failed_expectation_feedback: "补预期失败样本",
    collect_profit_feedback_review: "复核收益反馈",
  }[action ?? ""] ?? ""
}

export function benchmarkProfitCreditGapDetail(dynamicBenchmark?: StockFeedbackStatus["dynamicBenchmark"] | null) {
  if (!dynamicBenchmark) return ""
  const profitCreditGaps = (dynamicBenchmark.coverageGaps ?? []).filter((gap) => gap.bucket === "profit_credit")
  if (profitCreditGaps.length > 0) {
    const labels = profitCreditGaps.slice(0, 2).map((gap) => gap.label || profitCreditBucketLabel(gap.id))
    const more = profitCreditGaps.length > labels.length ? ` 等 ${profitCreditGaps.length} 类` : ""
    const actions = [...new Set(profitCreditGaps.map((gap) => profitCreditActionLabel(gap.recommendedAction)).filter(Boolean))].slice(0, 2)
    const actionText = actions.length ? `；下一步 ${actions.join(" / ")}` : ""
    return `收益归因缺：${labels.join(" / ")}${more}${actionText}`
  }
  const entries = Object.entries(dynamicBenchmark.profitCreditCounts ?? {})
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 2)
  if (entries.length === 0) return ""
  return `收益归因覆盖：${entries.map(([id, count]) => `${profitCreditBucketLabel(id)} ${count}`).join(" / ")}`
}

function benchmarkDetail(dynamicBenchmark?: StockFeedbackStatus["dynamicBenchmark"], manifest?: string | null, sourceMix?: ArtifactSourceMix | null) {
  if (!dynamicBenchmark) return manifest ?? "尚未写入 benchmark manifest"
  const gaps = dynamicBenchmark.coverageGaps?.length ?? 0
  const risk = dynamicBenchmark.counts?.negativeOrRiskCases ?? 0
  const reviewed = dynamicBenchmark.counts?.reviewedCases ?? 0
  const parts = [`缺口 ${gaps}`, `风险/负样本 ${risk}`, `已 review ${reviewed}`]
  const profitCreditGap = benchmarkProfitCreditGapDetail(dynamicBenchmark)
  if (profitCreditGap) parts.push(profitCreditGap)
  const mix = sourceMixDetail(sourceMix)
  if (mix) parts.push(mix)
  else if (manifest) parts.push(manifest)
  return parts.join(" · ")
}

function loraReadyDetail(adapterCurriculum?: StockFeedbackStatus["adapterCurriculum"], batches = 0, manifest?: string | null, sourceMix?: ArtifactSourceMix | null) {
  if (!adapterCurriculum) return manifest ?? "候选只存策略与引用，不存原始事实"
  const gaps = adapterCurriculum.coverageGaps?.length ?? 0
  const reviewed = adapterCurriculum.counts?.reviewedCandidates ?? 0
  const approved = adapterCurriculum.counts?.approvedCandidates ?? 0
  const reusable = adapterCurriculum.counts?.reusableSkillCandidates ?? 0
  const parts = [`已 review ${reviewed}`, `确认 ${approved}`, `可复用 ${reusable}`, `缺口 ${gaps}`, `批次 ${batches}`]
  const recipe = adapterBatchRecipeDetail(sourceMix?.adapterBatchRecipe)
  if (recipe) parts.push(recipe)
  const mix = sourceMixDetail(sourceMix)
  if (mix) parts.push(mix)
  else if (manifest) parts.push(manifest)
  return parts.join(" · ")
}

function sourceMixDetail(sourceMix?: ArtifactSourceMix | null) {
  const counts = sourceMix?.sourceKindCounts ?? {}
  const entries = Object.entries(counts)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  if (entries.length === 0) return ""
  const total = sourceMix?.count ?? entries.reduce((sum, [, count]) => sum + count, 0)
  const mix = entries.slice(0, 3).map(([kind, count]) => `${trajectorySourceLabel(kind)} ${count}`).join(" / ")
  return `来源 ${mix}${total ? ` / 共 ${total}` : ""}`
}

function patternRadarDetail(radar?: StockFeedbackPatternRadar) {
  if (!radar) return "等待模式雷达"
  const counts = radar.counts ?? {}
  return [
    `覆盖 ${counts.coveredPatterns ?? 0}/${counts.totalPatterns ?? 0}`,
    `adapter ${counts.adapterReadyPatterns ?? 0}`,
    `风控 ${counts.riskControlPatterns ?? 0}`,
    `缺口 ${radar.gaps?.length ?? 0}`,
  ].join(" · ")
}

function patternHealthLabel(status?: string) {
  return {
    adapter_ready: "可导出",
    risk_control_ready: "风控",
    needs_review: "待复核",
    missing: "缺口",
    covered: "已覆盖",
  }[status ?? ""] ?? status ?? "待定"
}

function patternHealthTone(status?: string) {
  return {
    adapter_ready: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700",
    risk_control_ready: "border-sky-500/30 bg-sky-500/10 text-sky-700",
    needs_review: "border-amber-500/30 bg-amber-500/10 text-amber-700",
    missing: "border-border bg-muted text-muted-foreground",
    covered: "border-primary/20 bg-primary/10 text-primary",
  }[status ?? ""] ?? "border-border bg-muted text-muted-foreground"
}

function patternActionLabel(action?: string) {
  return {
    collect_market_pattern_case: "补模式样本",
    export_lora_ready_candidate: "导出候选",
    add_to_preference_eval: "进偏好/eval",
    human_review_for_adapter: "人工确认",
    human_review_pattern_case: "人工复核",
    monitor_more_feedback: "继续观察",
  }[action ?? ""] ?? action ?? "待定"
}

function collectionResultLabel(result?: string, fallback?: string) {
  return fallback || {
    confirmed: "已确认",
    refuted: "已反驳",
    insufficient: "证据不足",
  }[result ?? ""] || result || "待定"
}

function collectionResultTone(result?: string) {
  return {
    confirmed: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700",
    refuted: "border-destructive/30 bg-destructive/10 text-destructive",
    insufficient: "border-amber-500/30 bg-amber-500/10 text-amber-700",
  }[result ?? ""] ?? "border-border bg-muted text-muted-foreground"
}

function trajectorySourceLabel(source?: string) {
  return {
    "self-question-attribution": "自提问归因轨迹",
    "stock-feedback-collection-result": "补样本回流轨迹",
    "stock-feedback-paper-trade": "模拟交易回测轨迹",
  }[source ?? ""] ?? source ?? "未标注"
}

function paperTradeTrackLabel(track?: string | null) {
  return {
    rule_baseline: "规则基准",
    llm_discretionary: "LLM 自主",
  }[track ?? ""] ?? track ?? "未分轨"
}

function paperTradeStatusLabel(status?: string | null) {
  return {
    open: "持仓中",
    closed: "已平仓",
    cancelled: "已取消",
  }[status ?? ""] ?? status ?? "未结算"
}

function paperTradeExecutionClassLabel(value?: string | null) {
  return {
    paper_pattern_execution_supported: "模拟收益支持手法",
    paper_execution_risk_negative: "模拟执行风险",
    paper_failed_expectation_negative: "模拟失败预期",
    paper_execution_unsettled: "模拟待结算",
  }[value ?? ""] ?? value ?? ""
}

function paperTradePointLabel(point?: StockFeedbackPaperTradeSummary["entry"] | StockFeedbackPaperTradeSummary["exit"] | null) {
  if (!point) return ""
  const reason = "reason" in point && typeof point.reason === "string" ? point.reason : ""
  return [
    point.date,
    typeof point.price === "number" ? point.price.toFixed(2) : "",
    point.timing,
    reason,
  ].filter(Boolean).join(" · ")
}

export function paperTradeLedgerDetail(ledger?: StockFeedbackPaperTradeLedger | null) {
  const counts = ledger?.counts ?? ledger?.summary
  if (!counts) return "等待 paper trade ledger；模拟交易只写入 .llm-wiki/stock-feedback/paper-trades，不写真实交易账本。"
  const total = counts.total ?? 0
  const pendingSettlement = ledger?.settlementQueue?.count ?? counts.open ?? 0
  const pendingRefresh = ledger?.settlementRefreshAudit?.pending ?? 0
  const trackParts = [
    (counts.byTrack?.rule_baseline ?? 0) > 0 ? `规则 ${counts.byTrack?.rule_baseline}` : "",
    (counts.byTrack?.llm_discretionary ?? 0) > 0 ? `LLM ${counts.byTrack?.llm_discretionary}` : "",
  ].filter(Boolean)
  const outcomeParts = [
    `盈利 ${counts.profitable ?? 0}`,
    (counts.loss ?? 0) > 0 ? `亏损 ${counts.loss}` : "",
    (counts.flat ?? 0) > 0 ? `持平 ${counts.flat}` : "",
  ].filter(Boolean)
  if (total === 0) return "暂无模拟交易；下一步接 self-question -> rule_baseline / llm_discretionary 双轨 paper trade。"
  return [
    `模拟 ${total}`,
    `open ${counts.open ?? 0}`,
    pendingSettlement > 0 ? `待结算 ${pendingSettlement}` : "",
    pendingRefresh > 0 ? `待刷新 ${pendingRefresh}` : "",
    `closed ${counts.closed ?? 0}`,
    outcomeParts.join(" / "),
    trackParts.length ? `双轨 ${trackParts.join(" / ")}` : "",
    "默认不进入 high-confidence",
  ].filter(Boolean).join(" · ")
}

export function paperTradeSettlementRefreshActionLabel(action?: string | null) {
  return {
    rebuild_trajectories: "重建轨迹",
    build_benchmark: "生成 Benchmark",
    review_paper_trade: "人审模拟收益",
    refresh_lora_ready: "刷新 LoRA-ready",
    verify_complete: "已闭环",
    no_settled_paper_trade_refresh_pending: "无待办",
  }[action ?? ""] ?? (action || "等待刷新")
}

export function paperTradePlanningDetail(planning?: StockFeedbackPaperTradePlanning | null) {
  const counts = planning?.counts
  if (!counts) return "等待从 expectation_trade 轨迹生成 rule_baseline / llm_discretionary 双轨模拟候选。"
  const candidates = counts.candidates ?? 0
  if (candidates <= 0) {
    return "暂无模拟候选；先补 expectation_trade 轨迹或完成 review，再进入双轨 paper trade。"
  }
  const parts = [
    `候选 ${candidates}`,
    `轨迹 ${counts.eligibleTrajectories ?? 0}`,
    (counts.missingEntryPrice ?? 0) > 0 ? `待补 entryPrice ${counts.missingEntryPrice}` : "",
    (counts.skippedExisting ?? 0) > 0 ? `已跳过 ${counts.skippedExisting}` : "",
  ].filter(Boolean)
  return `${parts.join(" · ")}；下一步用 as-of 行情补入口价，再写入 paper_trade 账本，仍不触碰真实交易。`
}

export function paperTradeAgentDetail(agent?: StockFeedbackPaperTradeAgentSummary | null) {
  const counts = agent?.counts
  if (!counts) return "Paper Trade Agent 等待 Hypothesis / EvidenceResult 回流后生成候选。"
  const total = counts.total ?? 0
  if (total <= 0) return "Paper Trade Agent 暂无候选；先刷新 hypothesis evidence-feedback 或生成 expectation_trade 轨迹。"
  return [
    `Agent 候选 ${total}`,
    `规则 ${counts.ruleBaseline ?? 0}`,
    `LLM ${counts.llmDiscretionary ?? 0}`,
    `来自轨迹 ${counts.fromTrajectory ?? 0}`,
    `来自假设反馈 ${counts.fromHypothesisFeedback ?? 0}`,
    (counts.needsMarketPrice ?? 0) > 0 ? `待补入口价 ${counts.needsMarketPrice}` : "",
    (counts.blocked ?? 0) > 0 ? `blocked ${counts.blocked}` : "",
  ].filter(Boolean).join(" · ")
}

function discretionaryReviewNextActionLabel(action?: string | null) {
  return {
    build_paper_trade_agent_candidates: "先生成 Paper Trade Agent 候选",
    record_llm_discretionary_paper_trades: "先记录 LLM 自主模拟交易",
    settle_llm_discretionary_trade: "先结算 LLM 自主样本",
    record_or_settle_rule_baseline_pair: "补齐同源 rule_baseline 基准",
    settle_rule_baseline_pair: "先结算同源 rule_baseline 基准",
    attach_asof_source_and_evidence_refs: "补齐 as-of sourceRefs / evidenceRefs",
    ready_for_discretionary_review_runner: "可进入 LLM vs rule baseline 复盘",
    review_discretionary_pair_gaps: "复核 LLM / 规则基准配对缺口",
  }[action ?? ""] ?? "等待复盘预检"
}

type DiscretionaryReviewItem = NonNullable<StockFeedbackDiscretionaryReviewAudit["items"]>[number]

export function paperTradeDiscretionaryReviewItemLabel(item?: DiscretionaryReviewItem | null) {
  if (!item) return "等待 LLM discretionary paper trade 预检。"
  const actionLabel = discretionaryReviewNextActionLabel(item.nextAction)
  if (item.readyForReview) return `${actionLabel}；同源 rule_baseline 已结算，引用满足 as-of 边界。`
  if (item.nextAction === "settle_llm_discretionary_trade") return `${actionLabel}；当前 LLM 样本仍是 open。`
  if (item.nextAction === "record_or_settle_rule_baseline_pair") return `${actionLabel}；缺少可比较的规则基准。`
  if (item.nextAction === "settle_rule_baseline_pair") return `${actionLabel}；基准未结算，不能比较收益归因。`
  if (item.nextAction === "attach_asof_source_and_evidence_refs") return `${actionLabel}；不能用摘要替代证据引用。`
  return actionLabel
}

export function paperTradeDiscretionaryReviewItemTone(item?: DiscretionaryReviewItem | null) {
  if (item?.readyForReview) return "good"
  if (item?.nextAction === "attach_asof_source_and_evidence_refs" || item?.evidenceCutoffOk === false) return "danger"
  return "warn"
}

export function paperTradeDiscretionaryReviewDetail(audit?: StockFeedbackDiscretionaryReviewAudit | null) {
  const counts = audit?.counts
  if (!counts) return "LLM discretionary 复盘等待 paper trade ledger；只比较模拟双轨，不触发真实交易。"
  const parts = [
    `LLM 候选 ${counts.llmAgentCandidates ?? 0}`,
    `LLM 账本 ${counts.llmPaperTrades ?? 0}`,
    `成对基准 ${counts.pairedRuleBaselineTrades ?? 0}`,
    (counts.openLlmPaperTrades ?? 0) > 0 ? `open ${counts.openLlmPaperTrades}` : "",
    (counts.missingEvidenceRefs ?? 0) > 0 ? `待补引用 ${counts.missingEvidenceRefs}` : "",
    `ready ${counts.readyPairs ?? 0}`,
  ].filter(Boolean)
  const route = (counts.readyPairs ?? 0) > 0
    ? "进入 eval/preference 对比，不自动提权"
    : discretionaryReviewNextActionLabel(audit?.nextAction)
  const boundary = audit?.peftBoundary?.storesRawFacts === false ? "PEFT clean" : "PEFT 待确认"
  return `${parts.join(" · ")}；${route}；${boundary}。`
}

export function paperTradeDiscretionaryReviewRunnerAction(audit?: StockFeedbackDiscretionaryReviewAudit | null) {
  const readyPairs = audit?.counts?.readyPairs ?? 0
  const enabled = readyPairs > 0 && audit?.writeBoundary?.readOnly === true
  if (enabled) {
    return {
      enabled,
      label: "预览 LLM 复盘",
      detail: `ready ${readyPairs}；生成只读草案，路线仅 eval/preference/negative，不写 paper ledger。`,
    }
  }
  return {
    enabled: false,
    label: "等待 LLM 复盘",
    detail: discretionaryReviewNextActionLabel(audit?.nextAction),
  }
}

function paperTradePlanCandidateFromAgent(candidate: StockFeedbackPaperTradeAgentCandidate): StockFeedbackPaperTradePlanCandidate {
  return {
    ...candidate,
    expectedMove: candidate.expectedMove ?? candidate.expectedCatalyst,
    entry: candidate.entry ?? candidate.entryPlan ?? null,
    qualityGate: candidate.qualityGate ?? candidate.readiness?.status ?? null,
  }
}

export function sampleDensityGapSeverityLabel(severity?: string | null) {
  return {
    blocked: "阻塞",
    warn: "待补",
    info: "观察",
  }[severity ?? ""] ?? "待确认"
}

export function sampleDensitySourceInputActionLabel(actionKind?: string | null) {
  return {
    manual_command: "手动命令",
    hypothesis_feedback_write: "固定写入",
    collection_task_write: "固定写入",
    build_trajectories_write: "固定写入",
    paper_trade_agent_preview: "只读预览",
  }[actionKind ?? ""] ?? "路线"
}

export function sampleDensityUpstreamInputTotal(audit?: StockFeedbackSampleDensityAudit | null) {
  const inputs = audit?.counts?.upstreamInputs ?? {}
  return (inputs.brainRecords ?? 0)
    + (inputs.hypothesisEvidenceFeedback ?? 0)
    + (inputs.collectionResults ?? 0)
    + (inputs.paperTrades ?? 0)
}

export type SampleDensityFirstSampleGuideAction =
  | "hypothesis_feedback_write"
  | "build_trajectories_write"
  | "paper_trade_agent_preview"
  | "manual_self_question_preview"
  | "collection_task_write"
  | "idle"

export interface SampleDensityFirstSampleGuide {
  status: "empty" | "needs_input" | "agent_source" | "rebuild" | "ready"
  headline: string
  detail: string
  primaryAction: SampleDensityFirstSampleGuideAction
  primaryLabel: string
  secondaryAction: SampleDensityFirstSampleGuideAction
  secondaryLabel: string
}

export function sampleDensityFirstSampleGuide(audit?: StockFeedbackSampleDensityAudit | null): SampleDensityFirstSampleGuide {
  if (!audit) {
    return {
      status: "empty",
      headline: "等待样本密度审计",
      detail: "先刷新 stock-feedback status，再选择第一条样本入口。",
      primaryAction: "idle",
      primaryLabel: "等待状态",
      secondaryAction: "idle",
      secondaryLabel: "",
    }
  }

  const counts = audit.counts ?? {}
  const trajectories = counts.trajectories ?? 0
  const agentPreviewCandidates = counts.paperTradeAgentPreviewCandidates ?? 0
  const hasTrajectorySourceInput = Boolean(counts.hasTrajectorySourceInput || audit.sourceInputPlan?.hasTrajectorySourceInput)
  const hasPaperAgentSourceInput = Boolean(counts.hasPaperAgentSourceInput || audit.sourceInputPlan?.hasPaperAgentSourceInput)

  if (trajectories > 0) {
    const needsAgentPreview = hasPaperAgentSourceInput && agentPreviewCandidates <= 0
    return {
      status: "ready",
      headline: "已有训练轨迹",
      detail: `已有 ${trajectories} 条 stock-feedback-trajectory-v1；下一步可生成 Benchmark 或刷新 LoRA-ready。`,
      primaryAction: needsAgentPreview ? "paper_trade_agent_preview" : "idle",
      primaryLabel: needsAgentPreview ? "预览 Agent 候选" : "继续审计",
      secondaryAction: "idle",
      secondaryLabel: "",
    }
  }

  if (hasTrajectorySourceInput) {
    return {
      status: "rebuild",
      headline: "已有上游输入，可以生成第一条训练轨迹",
      detail: "检测到 self-question attribution、collection result 或 paper trade ledger，先写入 stock-feedback-trajectory-v1。",
      primaryAction: "build_trajectories_write",
      primaryLabel: "写入第一条轨迹",
      secondaryAction: hasPaperAgentSourceInput ? "paper_trade_agent_preview" : "idle",
      secondaryLabel: hasPaperAgentSourceInput ? "预览 Agent 候选" : "",
    }
  }

  if (hasPaperAgentSourceInput) {
    return {
      status: "agent_source",
      headline: "已有 Hypothesis evidence-feedback，可以先生成 Agent 候选",
      detail: "仅有 hypothesis evidence-feedback 时，先预览 Paper Trade Agent 候选，再回流成可审计样本。",
      primaryAction: "paper_trade_agent_preview",
      primaryLabel: "预览 Agent 候选",
      secondaryAction: "hypothesis_feedback_write",
      secondaryLabel: "刷新假设证据反馈",
    }
  }

  return {
    status: "needs_input",
    headline: "先生成第一条假设证据反馈",
    detail: "空态下优先写入 Hypothesis evidence-feedback，把 EvidenceResult 回流到 Hypothesis，再进入轨迹或 Agent 候选。",
    primaryAction: "hypothesis_feedback_write",
    primaryLabel: "生成假设证据反馈",
    secondaryAction: "manual_self_question_preview",
    secondaryLabel: "预览自提问链路",
  }
}

export function sampleDensitySourceInputSteps(audit?: StockFeedbackSampleDensityAudit | null) {
  if (audit?.sourceInputPlan?.status !== "needs_upstream_inputs") return []
  const commands = audit.sourceInputPlan.nextCommands?.length
    ? audit.sourceInputPlan.nextCommands
    : (audit.recommendedCommands ?? []).map((item) => item.command).filter(Boolean) as string[]
  const labelByCommand = new Map((audit.recommendedCommands ?? []).map((item) => [item.command, item.label]))
  return commands
    .filter(Boolean)
    .slice(0, 3)
    .map((command) => {
      const actionKind = command.startsWith("hypothesis evidence-feedback")
        ? "hypothesis_feedback_write"
        : command.startsWith("stock-feedback collection-task")
          ? "collection_task_write"
          : "manual_command"
      return {
        command,
        actionKind,
        label: labelByCommand.get(command) ?? (
          actionKind === "hypothesis_feedback_write"
            ? "生成假设证据反馈"
            : actionKind === "collection_task_write"
              ? "创建补样本任务"
              : "生成自提问反馈"
        ),
      }
    })
}

export function sampleDensityRebuildSteps(audit?: StockFeedbackSampleDensityAudit | null) {
  if (audit?.sourceInputPlan?.status !== "has_upstream_inputs") return []
  const counts = audit.counts ?? {}
  const hasTrajectorySourceInput = Boolean(counts.hasTrajectorySourceInput || audit.sourceInputPlan?.hasTrajectorySourceInput)
  const hasPaperAgentSourceInput = Boolean(counts.hasPaperAgentSourceInput || audit.sourceInputPlan?.hasPaperAgentSourceInput)
  const needsTrajectoryBuild = hasTrajectorySourceInput && (counts.trajectories ?? 0) <= 0
  const needsAgentPreview = hasPaperAgentSourceInput && (counts.paperTradeAgentPreviewCandidates ?? 0) <= 0
  if (!needsTrajectoryBuild && !needsAgentPreview) return []
  const commands = audit.sourceInputPlan.nextCommands?.length
    ? audit.sourceInputPlan.nextCommands
    : (audit.recommendedCommands ?? []).map((item) => item.command).filter(Boolean) as string[]
  const labelByCommand = new Map((audit.recommendedCommands ?? []).map((item) => [item.command, item.label]))
  return commands
    .filter(Boolean)
    .map((command) => {
      const actionKind = command.startsWith("stock-feedback build-trajectories")
        ? "build_trajectories_write"
        : command.startsWith("stock-feedback paper-trade-agent candidates")
          ? "paper_trade_agent_preview"
          : null
      return actionKind ? { command, actionKind, label: labelByCommand.get(command) ?? (
        actionKind === "build_trajectories_write" ? "写入训练轨迹" : "预览 Agent 候选"
      ) } : null
    })
    .filter((step): step is { command: string; actionKind: string; label: string } => {
      if (!step) return false
      if (step.actionKind === "build_trajectories_write") return needsTrajectoryBuild
      if (step.actionKind === "paper_trade_agent_preview") return needsAgentPreview
      return false
    })
    .slice(0, 2)
}

export function sampleDensityActionAvailability(audit?: StockFeedbackSampleDensityAudit | null) {
  const counts = audit?.counts ?? {}
  const trajectories = counts.trajectories ?? 0
  const hasTrajectorySourceInput = Boolean(counts.hasTrajectorySourceInput || audit?.sourceInputPlan?.hasTrajectorySourceInput)
  const agentPreviewCandidates = counts.paperTradeAgentPreviewCandidates ?? 0
  const agentWrittenCandidates = counts.paperTradeAgentWrittenCandidates ?? 0
  const reviewedPaperAdapterTrajectories = counts.reviewedPaperAdapterTrajectories ?? 0
  const benchmarkInputReady = trajectories > 0 || agentWrittenCandidates > 0
  const loraInputReady = trajectories > 0 || reviewedPaperAdapterTrajectories > 0
  return {
    canBuildTrajectories: trajectories > 0 || hasTrajectorySourceInput,
    canWriteAgentCandidates: agentPreviewCandidates > 0,
    canBuildBenchmark: benchmarkInputReady,
    canExportLoraReady: loraInputReady,
    buildTrajectoriesReason: trajectories > 0
      ? "可重建轨迹"
      : hasTrajectorySourceInput
        ? "已有上游输入，可写入轨迹"
        : "等待自提问归因、采集结果或 paper trade 输入",
    writeAgentCandidatesReason: agentPreviewCandidates > 0
      ? `可写入 Agent 候选 ${agentPreviewCandidates}`
      : "等待 Agent 预览候选",
    buildBenchmarkReason: benchmarkInputReady
      ? "可生成 Benchmark"
      : "等待轨迹或已写 Agent 候选",
    exportLoraReadyReason: loraInputReady
      ? "可刷新 LoRA-ready"
      : "等待可导出的轨迹或人审 paper 样本",
  }
}

export function sampleDensityAuditDetail(audit?: StockFeedbackSampleDensityAudit | null) {
  if (!audit) return "等待 stock-feedback status 返回样本密度审计。"
  const counts = audit.counts ?? {}
  const gaps = audit.gaps ?? []
  const upstreamInputTotal = sampleDensityUpstreamInputTotal(audit)
  const headline = audit.headline || "样本密度审计"
  const primaryGap = gaps[0]
  const parts = [
    headline,
    `上游输入 ${upstreamInputTotal}`,
    `轨迹 ${counts.trajectories ?? 0}`,
    `预期交易 ${counts.expectationTradeTrajectories ?? 0}`,
    `Agent 预览 ${counts.paperTradeAgentPreviewCandidates ?? 0}`,
    `Agent 已写 ${counts.paperTradeAgentWrittenCandidates ?? 0}`,
    `paper closed ${counts.settledPaperTrades ?? 0}`,
    `Benchmark ${counts.benchmarkBatches ?? 0}`,
    `LoRA-ready ${counts.loraReadyBatches ?? 0}`,
  ]
  const boundary = audit.peftBoundary?.storesRawFacts === false
    ? "PEFT clean：adapter 只存行为、技能、工具习惯和决策策略"
    : "检查 PEFT 边界"
  const next = primaryGap
    ? `下一步：${primaryGap.label ?? primaryGap.nextAction}${primaryGap.command ? ` / ${primaryGap.command}` : ""}`
    : `下一步：${audit.nextAction ?? "continue_review_and_refresh_loop"}`
  return `${parts.join(" · ")}；${boundary}；${next}。`
}

export function buildProfitLedgerSeparationSummary(status?: StockFeedbackStatus | null): ProfitLedgerSeparationSummary {
  const counts = status?.counts ?? {}
  const summary = status?.summary ?? {}
  const profitCredit = summary.byProfitCredit ?? {}
  const profitOutcome = summary.byProfitOutcome ?? {}
  const ledgerCounts: StockFeedbackPaperTradeCounts = status?.paperTradeLedger?.counts ?? status?.paperTradeLedger?.summary ?? {}
  const realPatternExecutionSamples = (profitCredit.real_pattern_execution_supported ?? 0)
    + (profitCredit.pattern_execution_supported ?? 0)
  const paperPatternExecutionSamples = profitCredit.paper_pattern_execution_supported ?? 0
  const profitableOutcomeSamples = profitOutcome.profitable ?? 0
  const confirmedCollectionResults = counts.confirmedCollectionResults ?? 0
  const paperTrades = counts.paperTrades ?? ledgerCounts.total ?? 0
  const paperProfitable = counts.paperTradeProfitable ?? ledgerCounts.profitable ?? 0
  const realHighConfidenceReady = realPatternExecutionSamples > 0
    && profitableOutcomeSamples > 0
    && confirmedCollectionResults > 0
  const paperOnly = !realHighConfidenceReady && (paperTrades > 0 || paperProfitable > 0 || paperPatternExecutionSamples > 0)

  if (realHighConfidenceReady) {
    return {
      headline: "真实执行样本可人审提权",
      detail: "已同时看到 pattern_execution_supported、profitable 和 confirmed collection result，仍需逐条核验证据来源后再上调权重",
      nextAction: "进入 review / Benchmark / LoRA-ready 刷新，并保留原始事实在 retrieval/tool state。",
      tone: "good",
      realPatternExecutionSamples,
      profitableOutcomeSamples,
      confirmedCollectionResults,
      paperTrades,
      paperProfitable,
      paperPatternExecutionSamples,
      blocksHighConfidenceProfit: false,
      paperOnly: false,
    }
  }

  if (paperOnly) {
    return {
      headline: "仅有模拟收益或 paper trade 线索",
      detail: "paper_pattern_execution_supported 可补训练密度，但默认不能进入真实盈利 high-confidence 样本",
      nextAction: "补真实 trade ledger 或把 paper 结果明确路由到 eval/SFT/adapter 低权重候选。",
      tone: "warn",
      realPatternExecutionSamples,
      profitableOutcomeSamples,
      confirmedCollectionResults,
      paperTrades,
      paperProfitable,
      paperPatternExecutionSamples,
      blocksHighConfidenceProfit: true,
      paperOnly: true,
    }
  }

  return {
    headline: "等待真实盈利执行样本",
    detail: "当前还没有 confirmed collection result + profitable + pattern_execution_supported 的三件套",
    nextAction: "先用 collection-result 补 sourceRefs / price SQL / trade ledger，再重建轨迹并进入 review。",
    tone: "warn",
    realPatternExecutionSamples,
    profitableOutcomeSamples,
    confirmedCollectionResults,
    paperTrades,
    paperProfitable,
    paperPatternExecutionSamples,
    blocksHighConfidenceProfit: true,
    paperOnly: false,
  }
}

export function buildBenchmarkBatchGateSummary(status?: StockFeedbackStatus | null): BenchmarkBatchGateSummary {
  const dynamicBenchmark = status?.dynamicBenchmark
  const persistedBatches = status?.counts?.benchmarkBatches ?? 0
  const manifest = status?.latest?.benchmarkManifest ?? status?.artifactSourceMix?.benchmark?.artifactPath ?? null
  const hasPersistedBenchmark = persistedBatches > 0 || Boolean(manifest)
  const dynamicCases = dynamicBenchmark?.counts?.totalCases ?? 0
  const coverageGaps = dynamicBenchmark?.coverageGaps?.length ?? status?.counts?.dynamicBenchmarkGaps ?? 0
  const reviewedCases = dynamicBenchmark?.counts?.reviewedCases ?? 0

  if (hasPersistedBenchmark) {
    return {
      headline: "Benchmark 批次已落地",
      detail: "动态 eval/preference 覆盖已经有持久 manifest，可用于后续 review、LoRA-ready source mix 和 verify",
      nextAction: "继续处理 pending review；新增 collection-result 或 paper trade 后再刷新 Benchmark 批次。",
      tone: "good",
      persistedBatches: Math.max(persistedBatches, 1),
      dynamicCases,
      coverageGaps,
      reviewedCases,
      manifest,
      blocksArtifactClosure: false,
    }
  }

  if (dynamicCases > 0) {
    return {
      headline: "Benchmark 仍是临时计算",
      detail: `${dynamicCases} 个 case 已能生成，但还没有写入 benchmark manifest，LoRA-ready/source mix 无法引用这批 eval 覆盖`,
      nextAction: "点击生成 Benchmark，写入 .llm-wiki/stock-feedback/benchmark 后再跑 verify 和 LoRA-ready 刷新。",
      tone: "warn",
      persistedBatches,
      dynamicCases,
      coverageGaps,
      reviewedCases,
      manifest,
      blocksArtifactClosure: true,
    }
  }

  return {
    headline: "等待轨迹后生成 Benchmark",
    detail: "当前还没有可落批次的 dynamic benchmark case",
    nextAction: "先运行写入轨迹或补 collection-result，再生成 Benchmark 批次。",
    tone: "warn",
    persistedBatches,
    dynamicCases,
    coverageGaps,
    reviewedCases,
    manifest,
    blocksArtifactClosure: true,
  }
}

function reviewQueueRecommendedActionCounts(items?: StockFeedbackReviewQueueItem[]) {
  return (items ?? []).reduce<Record<string, number>>((counts, item) => {
    if (isReviewedFeedbackItem(item)) return counts
    const action = recommendedActionForReviewItem(item, item?.humanActionPlan?.recommendedAction ?? "route_to_eval")
    counts[action] = (counts[action] ?? 0) + 1
    return counts
  }, {})
}

export function buildReviewBacklogGateSummary({
  status,
  reviewQueue,
  nextSuggestion,
  pendingRefreshes,
}: {
  status?: StockFeedbackStatus | null
  reviewQueue?: StockFeedbackReviewQueueResult | null
  nextSuggestion?: NextHumanReviewSuggestion | null
  pendingRefreshes?: Array<Pick<ReviewRefreshPrompt | AuditSubmissionNotice, "refreshLabel" | "actionLabel">> | number
}): ReviewBacklogGateSummary {
  const queueCounts = reviewQueue?.counts ?? {}
  const actionCounts = queueCounts.byRecommendedAction ?? reviewQueueRecommendedActionCounts(reviewQueue?.items)
  const pending = queueCounts.pending ?? status?.counts?.pendingReviews ?? 0
  const reviewed = queueCounts.reviewed ?? status?.counts?.reviewedTrajectories ?? 0
  const reviewEvents = queueCounts.reviewEvents ?? status?.counts?.reviewEvents ?? 0
  const routeToPreference = actionCounts.route_to_preference ?? 0
  const needsEvidence = actionCounts.needs_evidence ?? 0
  const approveForAdapter = actionCounts.approve_for_adapter ?? 0
  const paperAdapterCandidates = actionCounts.approve_paper_adapter_candidate ?? 0
  const pendingRefreshItems = Array.isArray(pendingRefreshes)
    ? pendingRefreshes.filter((item) => Boolean(item.refreshLabel))
    : []
  const pendingTrainableRefreshes = typeof pendingRefreshes === "number"
    ? pendingRefreshes
    : pendingRefreshItems.length
  const refreshActionLabel = pendingRefreshItems[0]?.refreshLabel ?? "重建并刷新 LoRA-ready"
  const primaryActionLabel = pendingTrainableRefreshes > 0
    ? refreshActionLabel
    : nextSuggestion?.actionLabel ?? (pending > 0 ? "定位下一条人审" : "刷新 verify")

  if (pendingTrainableRefreshes > 0) {
    return {
      headline: "先刷新训练批次",
      detail: `${pendingTrainableRefreshes} 条 review 已写入 review ledger，但 Benchmark / LoRA-ready 仍可能是旧权重；继续人审前先刷新训练批次`,
      nextAction: "先重建轨迹并刷新 LoRA-ready，用 batch delta 确认权重/分流变化，再继续处理 review backlog。",
      tone: "warn",
      primaryActionKind: "refresh_lora_ready",
      pending,
      reviewed,
      reviewEvents,
      routeToPreference,
      needsEvidence,
      approveForAdapter,
      paperAdapterCandidates,
      pendingTrainableRefreshes,
      blocksReviewClosure: true,
      primaryActionLabel,
    }
  }

  if (pending <= 0) {
    return {
      headline: "Review backlog 已清空",
      detail: `${reviewed} 条轨迹已有 review 结论，${reviewEvents} 条 review event 可作为训练权重审计输入`,
      nextAction: "刷新 Benchmark / LoRA-ready 后跑 verify，确认批次和 source mix 已闭合。",
      tone: "good",
      primaryActionKind: "verify",
      pending,
      reviewed,
      reviewEvents,
      routeToPreference,
      needsEvidence,
      approveForAdapter,
      paperAdapterCandidates,
      pendingTrainableRefreshes,
      blocksReviewClosure: false,
      primaryActionLabel,
    }
  }

  if (routeToPreference > 0) {
    return {
      headline: "先审风险/负样本",
      detail: `${pending} 条待审里有 ${routeToPreference} 条建议进入 preference/eval 负样本；先确认失败归因、priced-in 或买点错，避免误提权为正向 adapter`,
      nextAction: "先处理 route_to_preference，再刷新 Benchmark / LoRA-ready 并跑 verify。",
      tone: "warn",
      primaryActionKind: "select_next_review",
      pending,
      reviewed,
      reviewEvents,
      routeToPreference,
      needsEvidence,
      approveForAdapter,
      paperAdapterCandidates,
      pendingTrainableRefreshes,
      blocksReviewClosure: true,
      primaryActionLabel,
    }
  }

  if (needsEvidence > 0) {
    return {
      headline: "先处理补证样本",
      detail: `${pending} 条待审里有 ${needsEvidence} 条需要补 sourceRefs、price SQL 或 retrieval/tool state；人工摘要不能替代证据引用`,
      nextAction: "先补 collection-result 或外部证据引用，重建轨迹后再回到 review / Benchmark / LoRA-ready。",
      tone: "warn",
      primaryActionKind: "select_next_review",
      pending,
      reviewed,
      reviewEvents,
      routeToPreference,
      needsEvidence,
      approveForAdapter,
      paperAdapterCandidates,
      pendingTrainableRefreshes,
      blocksReviewClosure: true,
      primaryActionLabel,
    }
  }

  if (paperAdapterCandidates > 0) {
    return {
      headline: "复核 paper adapter 正样本",
      detail: `${pending} 条待审里有 ${paperAdapterCandidates} 条模拟收益支持手法执行；只能作为低权重 adapter 候选，不等同真实盈利样本`,
      nextAction: "逐条确认 approve_paper_adapter_candidate，刷新 LoRA-ready 后检查 paper 低权重 bucket。",
      tone: "warn",
      primaryActionKind: "select_next_review",
      pending,
      reviewed,
      reviewEvents,
      routeToPreference,
      needsEvidence,
      approveForAdapter,
      paperAdapterCandidates,
      pendingTrainableRefreshes,
      blocksReviewClosure: true,
      primaryActionLabel,
    }
  }

  if (approveForAdapter > 0) {
    return {
      headline: "复核 adapter 正样本",
      detail: `${pending} 条待审里有 ${approveForAdapter} 条建议进入 adapter 候选；先确认 PEFT 边界和证据引用，再允许提权`,
      nextAction: "逐条确认 approve_for_adapter 后刷新 LoRA-ready source mix。",
      tone: "warn",
      primaryActionKind: "select_next_review",
      pending,
      reviewed,
      reviewEvents,
      routeToPreference,
      needsEvidence,
      approveForAdapter,
      paperAdapterCandidates,
      pendingTrainableRefreshes,
      blocksReviewClosure: true,
      primaryActionLabel,
    }
  }

  return {
    headline: "待人工 review",
    detail: `${pending} 条轨迹还没有人工路由；Benchmark 与 LoRA-ready 批次只能作为待审输入，不能证明训练闭环完成`,
    nextAction: "进入 review queue，按风控、补证、正向 adapter 的顺序处理。",
    tone: "warn",
    primaryActionKind: "select_next_review",
    pending,
    reviewed,
    reviewEvents,
    routeToPreference,
    needsEvidence,
    approveForAdapter,
    paperAdapterCandidates,
    pendingTrainableRefreshes,
    blocksReviewClosure: true,
    primaryActionLabel,
  }
}

function reviewActionLabel(action?: string) {
  return {
    approve_for_adapter: "确认进入 adapter 候选",
    approve_paper_adapter_candidate: "人审 paper adapter 正样本",
    route_to_eval: "进入动态 eval",
    route_to_preference: "进入偏好/负样本",
    route_to_sft: "进入 SFT 样本",
    needs_evidence: "转补证",
    reject_for_adapter: "排除 adapter",
    mark_entry_wrong: "标记买点错",
    mark_priced_in: "标记 priced-in",
  }[action ?? ""] ?? action ?? "执行推荐"
}

function routingLabels(routing?: HumanActionPlan["expectedRouting"]) {
  if (!routing) return []
  return [
    routing.adapterCandidate ? "adapter" : "",
    routing.sft ? "SFT" : "",
    routing.preference ? "preference" : "",
    routing.eval ? "eval" : "",
    routing.needsEvidence ? "补证" : "",
    routing.rejectedForAdapter ? "排除 adapter" : "",
  ].filter(Boolean)
}

function trainingUseLabel(use?: string) {
  return {
    eval: "eval",
    sft: "SFT",
    preference: "preference",
    adapter: "adapter",
    needs_evidence: "补证",
    audit: "审计",
  }[use ?? ""] ?? use ?? ""
}

function reviewActionOptionDetail(option?: ReviewActionOption) {
  if (!option) return ""
  const weight = option.preview?.trainingWeightDecision
    ? trainingWeightDecisionDetail(option.preview.trainingWeightDecision)
    : ""
  const uses = (option.preview?.trainingUse ?? []).map(trainingUseLabel).filter(Boolean).join(" / ")
  return [weight, uses].filter(Boolean).join(" · ")
}

function distillationKindLabel(kind?: string) {
  return {
    behavior: "行为",
    skill: "技能",
    tool_habit: "工具",
    decision_strategy: "策略",
    risk_control: "风控",
    profit_credit: "收益归因",
    adapter_capability: "能力",
  }[kind ?? ""] ?? kind ?? "项目"
}

function normalizeBoundaryText(value?: string | null) {
  return value?.replace(/[_-]+/g, " ").trim() ?? ""
}

function addUniqueLearningSignal(
  target: PeftBoundaryReview["learns"],
  seen: Set<string>,
  label: string,
  value?: string | null,
) {
  const text = value?.trim()
  if (!text) return
  const key = `${label}:${text}`
  if (seen.has(key)) return
  seen.add(key)
  target.push({ label, value: text })
}

function peftBoundaryStoresRawFacts(plan?: StockFeedbackDistillationPlan | null) {
  return plan?.factBoundary?.storesRawFacts
}

export function buildPeftBoundaryReview(
  trajectory?: StockFeedbackTrajectory | null,
  planOverride?: StockFeedbackDistillationPlan | null,
): PeftBoundaryReview | null {
  if (!trajectory && !planOverride) return null
  const plan = planOverride ?? trajectory?.distillationPlan ?? null
  const boundary = plan?.factBoundary
  const storesRawFacts = peftBoundaryStoresRawFacts(plan)
  const learns: PeftBoundaryReview["learns"] = []
  const seenLearning = new Set<string>()

  for (const item of plan?.adapterLearns ?? []) {
    addUniqueLearningSignal(learns, seenLearning, distillationKindLabel(item.kind), item.value)
  }
  addUniqueLearningSignal(learns, seenLearning, "能力", plan?.adapterCapability ?? trajectory?.adapterCapability)
  addUniqueLearningSignal(learns, seenLearning, "技能", trajectory?.distillationSignals?.skill)
  addUniqueLearningSignal(learns, seenLearning, "行为", trajectory?.distillationSignals?.behavior)
  addUniqueLearningSignal(learns, seenLearning, "工具习惯", trajectory?.distillationSignals?.toolHabit)
  addUniqueLearningSignal(learns, seenLearning, "决策策略", trajectory?.distillationSignals?.decisionStrategy)
  addUniqueLearningSignal(learns, seenLearning, "风控", trajectory?.distillationSignals?.riskControl)
  addUniqueLearningSignal(learns, seenLearning, "收益归因", trajectory?.distillationSignals?.profitCredit)
  for (const signal of trajectory?.profitFeedback?.creditAssignment?.adapterLearns ?? []) {
    addUniqueLearningSignal(learns, seenLearning, "收益反馈", normalizeBoundaryText(signal))
  }

  const factStores = uniqueTextParts([
    ...(boundary?.factsRemainIn ?? []),
    trajectory?.distillationSignals?.factBoundary,
    ...(storesRawFacts === false ? ["retrieval/tool state", "sourceRefs", "price SQL", "wiki/raw/facts"] : []),
  ])
  const adapterDoesNotStore = uniqueNormalizedBoundaryTexts([
    ...(boundary?.adapterDoesNotStore ?? []),
    ...(storesRawFacts === false ? ["raw_facts", "announcements_or_report_text", "price_rows_or_trade_records", "single_stock_fact_memory"] : []),
  ])
  const sourceRefs = uniqueTextParts([
    ...(boundary?.sourceRefs ?? []),
    ...(trajectory?.evidenceState?.confirmedEvidenceRefs ?? []),
    ...(trajectory?.sourceRefs ?? []),
  ]).slice(0, 8)
  const toolState = uniqueTextParts(plan?.requiredToolState ?? []).slice(0, 8)
  const reviewChecks = [
    "确认 adapter 只学习行为、技能、工具习惯和决策策略",
    "确认公告、财报、订单、价格行和交易记录仍在 retrieval/tool state",
    sourceRefs.length > 0 ? "确认 sourceRefs 可追溯到原始证据" : "补齐 sourceRefs 后再提升训练权重",
  ]
  if (trajectory?.validationTarget === "expectation_trade") {
    reviewChecks.push("市场预期交易可作为一等训练目标，但不得伪装成基本面兑现")
  }
  if ((learns.length ?? 0) === 0) reviewChecks.push("补充可复用行为信号，否则只适合 eval 或补证")

  if (storesRawFacts === true) {
    return {
      status: "blocked",
      tone: "danger",
      headline: "阻断：候选声明会存原始事实",
      detail: "先把原文、公告、财报、价格行和交易记录移回 retrieval/tool state；LoRA-ready 只能保留可复用判断方式和引用。",
      learns,
      factStores,
      adapterDoesNotStore,
      sourceRefs,
      toolState,
      reviewChecks,
    }
  }

  if (storesRawFacts !== false) {
    return {
      status: "needs_review",
      tone: "warn",
      headline: "需要补 PEFT 边界声明",
      detail: "缺少 storesRawFacts=false 的明确声明。人工 review 前只能按待审候选处理，不能直接提权进入正向 adapter。",
      learns,
      factStores,
      adapterDoesNotStore,
      sourceRefs,
      toolState,
      reviewChecks,
    }
  }

  const missingLearning = learns.length === 0
  return {
    status: missingLearning ? "needs_review" : "clean",
    tone: missingLearning ? "warn" : "good",
    headline: missingLearning ? "边界干净，但缺少可复用学习信号" : "PEFT 边界清楚",
    detail: missingLearning
      ? "事实边界已经声明清楚，但还需要补充行为、技能、工具习惯或决策策略，避免把单一股票事实误当成训练能力。"
      : "这条候选可以进入人审分流：adapter 学可复用研究动作和决策策略，事实、公告、财报、价格与交易数据继续留在 retrieval/tool state。",
    learns,
    factStores,
    adapterDoesNotStore,
    sourceRefs,
    toolState,
    reviewChecks,
  }
}

export function peftBoundaryAllowsAdapterApproval(review?: PeftBoundaryReview | null) {
  return review?.status === "clean"
}

export function buildPeftBoundaryActionHint(
  review?: PeftBoundaryReview | null,
  context: {
    recommendedAction?: string | null
    canExport?: boolean
    adapterCapability?: string | null
  } = {},
): PeftBoundaryActionHint | null {
  if (!review) return null
  const capability = context.adapterCapability ? `能力：${context.adapterCapability}。` : ""
  const factStoreText = review.factStores.length ? `事实留在 ${review.factStores.slice(0, 3).join(" / ")}。` : "事实驻留位置待补。"
  const learningText = review.learns.length ? `可学 ${review.learns.slice(0, 3).map((item) => `${item.label}:${item.value}`).join(" / ")}。` : "缺少可复用学习信号。"

  if (review.status === "blocked") {
    return {
      tone: "danger",
      headline: "PEFT 闸门：阻断正向 adapter",
      detail: "该候选声明会把原始事实写入 adapter，必须先排除正向 LoRA-ready，或重建为只含行为策略与引用的候选。",
      recommendedAction: "reject_for_adapter",
      recommendedActionLabel: "排除 adapter",
      locksAdapterApproval: true,
      noteDraft: `PEFT 边界阻断：storesRawFacts=true，${capability}${factStoreText}先排除正向 adapter；重建前只允许进入 eval/negative 或补证队列。`,
    }
  }

  if (review.status === "needs_review") {
    const missingRefs = review.sourceRefs.length === 0
    const missingFacts = review.factStores.length === 0
    const recommendedAction = missingRefs || missingFacts ? "needs_evidence" : "route_to_eval"
    return {
      tone: "warn",
      headline: "PEFT 闸门：先补边界再提权",
      detail: "这条样本不能直接确认 adapter；先补 storesRawFacts=false、sourceRefs、事实驻留位置或可复用行为信号，再重新进入人审。",
      recommendedAction,
      recommendedActionLabel: recommendedAction === "needs_evidence" ? "转补证" : "偏好/eval",
      locksAdapterApproval: true,
      noteDraft: `PEFT 边界待审：补 storesRawFacts=false / sourceRefs / retrieval-tool-state 边界。${capability}${learningText}${factStoreText}当前不直接提权进入正向 adapter。`,
    }
  }

  return {
    tone: "good",
    headline: context.canExport ? "PEFT 闸门：可继续确认 adapter" : "PEFT 闸门：边界干净，等待质量门",
    detail: context.canExport
      ? "边界已经清楚，可以继续按人工分流确认；LoRA 只沉淀可复用行为、技能、工具习惯和决策策略。"
      : "边界已经清楚，但仍需质量门或人审结果决定是否进入正向 adapter。",
    recommendedAction: context.recommendedAction ?? (context.canExport ? "approve_for_adapter" : "route_to_eval"),
    recommendedActionLabel: context.canExport ? "确认 adapter" : reviewActionLabel(context.recommendedAction ?? "route_to_eval"),
    locksAdapterApproval: false,
    noteDraft: `PEFT 边界清楚：${capability}${learningText}${factStoreText}adapter 不存原始事实，只沉淀行为/技能/工具习惯/决策策略。`,
  }
}

function DistillationPlanPanel({ plan }: { plan?: StockFeedbackDistillationPlan }) {
  if (!plan) {
    return <p className="text-sm text-muted-foreground">等待生成蒸馏计划</p>
  }
  const learns = plan.adapterLearns ?? []
  const curriculum = plan.adapterCurriculum
  const curriculumText = curriculum
    ? [curriculum.bucket, typeof curriculum.score === "number" ? `分数 ${curriculum.score}` : "", curriculum.benchmarkBucket].filter(Boolean).join(" · ")
    : ""
  return (
    <div className="space-y-3 text-sm">
      <div className="rounded-md border bg-muted/30 p-2">
        <KeyValue label="推荐" value={plan.humanDecision?.recommendedActionLabel ?? plan.humanDecision?.recommendedAction ?? ""} />
        <KeyValue label="课程" value={curriculumText} />
        <KeyValue label="工具态" value={(plan.requiredToolState ?? []).join(" / ")} />
        <KeyValue label="不学" value={(plan.factBoundary?.adapterDoesNotStore ?? []).join(" / ")} />
      </div>
      {learns.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs font-medium text-muted-foreground">LoRA 学习对象</div>
          {learns.slice(0, 5).map((item, index) => (
            <div key={`${item.kind ?? "learn"}-${index}`} className="grid grid-cols-[52px_minmax(0,1fr)] gap-2 text-xs leading-5">
              <span className="text-muted-foreground">{distillationKindLabel(item.kind)}</span>
              <span className="min-w-0 break-words">{item.value}</span>
            </div>
          ))}
        </div>
      )}
      {(plan.humanDecision?.why?.length ?? 0) > 0 && (
        <div className="flex flex-wrap gap-1">
          {plan.humanDecision?.why?.slice(0, 8).map((reason) => (
            <span key={reason} className="rounded border bg-background px-2 py-0.5 text-xs text-muted-foreground">{reason}</span>
          ))}
        </div>
      )}
      {(plan.humanDecision?.reviewQuestions?.length ?? 0) > 0 && (
        <div className="space-y-1 text-xs text-muted-foreground">
          {plan.humanDecision?.reviewQuestions?.slice(0, 3).map((question) => (
            <div key={question}>{question}</div>
          ))}
        </div>
      )}
    </div>
  )
}

function PeftBoundaryReviewPanel({ review }: { review: PeftBoundaryReview | null }) {
  if (!review) {
    return <p className="text-sm text-muted-foreground">等待生成 PEFT 边界审查</p>
  }
  const toneClass = {
    good: "border-emerald-500/30 bg-emerald-500/10 text-emerald-800",
    warn: "border-amber-500/30 bg-amber-500/10 text-amber-800",
    danger: "border-destructive/30 bg-destructive/10 text-destructive",
  }[review.tone]
  const Icon = review.tone === "good" ? ShieldCheck : AlertTriangle
  return (
    <div className={cn("space-y-3 rounded-md border p-2 text-xs", toneClass)}>
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0">
          <div className="font-medium">{review.headline}</div>
          <div className="mt-1 leading-5 opacity-90">{review.detail}</div>
        </div>
      </div>
      <div className="grid gap-2 text-foreground lg:grid-cols-2">
        <div className="rounded border bg-background/70 p-2">
          <div className="mb-1 font-medium text-muted-foreground">LoRA 可学习</div>
          {review.learns.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {review.learns.slice(0, 8).map((item, index) => (
                <span key={`${item.label}-${item.value}-${index}`} className="rounded border bg-background px-1.5 py-0.5">
                  {item.label}：{item.value}
                </span>
              ))}
            </div>
          ) : (
            <div className="text-muted-foreground">暂无可复用行为信号</div>
          )}
        </div>
        <div className="rounded border bg-background/70 p-2">
          <div className="mb-1 font-medium text-muted-foreground">事实保留在</div>
          {review.factStores.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {review.factStores.slice(0, 8).map((item) => (
                <span key={item} className="rounded border bg-background px-1.5 py-0.5">{item}</span>
              ))}
            </div>
          ) : (
            <div className="text-muted-foreground">等待补充 retrieval/tool state 边界</div>
          )}
        </div>
      </div>
      {review.adapterDoesNotStore.length > 0 && (
        <div className="flex flex-wrap gap-1 text-foreground">
          <span className="py-0.5 font-medium text-muted-foreground">不写入 adapter</span>
          {review.adapterDoesNotStore.slice(0, 6).map((item) => (
            <span key={item} className="rounded border bg-background/70 px-1.5 py-0.5">{item}</span>
          ))}
        </div>
      )}
      <div className="space-y-1 leading-5 text-foreground">
        {review.reviewChecks.slice(0, 5).map((check) => (
          <div key={check} className="flex items-start gap-1.5">
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-700" />
            <span>{check}</span>
          </div>
        ))}
      </div>
      <div className="grid gap-2 text-muted-foreground sm:grid-cols-2">
        {review.toolState.length > 0 && (
          <div className="truncate" title={review.toolState.join(" / ")}>工具态：{review.toolState.join(" / ")}</div>
        )}
        {review.sourceRefs.length > 0 && (
          <div className="truncate" title={review.sourceRefs.join(" / ")}>引用：{review.sourceRefs.length} 条可追溯</div>
        )}
      </div>
    </div>
  )
}

function AuditContextPanel({
  context,
  submissionNotice,
  refreshDiff,
  refreshingLoraReady,
  onRefreshLoraReady,
}: {
  context: AuditSelectionContext
  submissionNotice?: AuditSubmissionNotice | null
  refreshDiff?: AuditRefreshDiff | null
  refreshingLoraReady?: boolean
  onRefreshLoraReady?: () => void
}) {
  const bucket = context.bucketLabel ?? adapterBatchRecipeBucketLabel(context.bucketId)
  const sampling = samplingLabel(context.sampling)
  const weight = typeof context.effectiveWeightMultiplier === "number"
    ? `${context.effectiveWeightMultiplier.toFixed(1)}x`
    : ""
  const weightState = trainingWeightStateLabel(context.trainingWeightState ?? undefined)
  const parts = [
    context.sourceTitle,
    bucket,
    sampling,
    weight ? `权重 ${weight}` : "",
    weightState,
  ].filter(Boolean)
  return (
    <div className="rounded-md border border-primary/20 bg-primary/5 p-2 text-xs">
      <div className="flex flex-wrap items-center gap-1">
        <span className="font-medium text-primary">当前抽查上下文</span>
        {parts.map((part) => (
          <span key={part} className="rounded border bg-background px-1.5 py-0.5 text-muted-foreground">{part}</span>
        ))}
      </div>
      <div className="mt-2 grid gap-1 text-muted-foreground">
        <div className="truncate" title={context.refId ?? ""}>ref：{context.refId ?? context.refKind ?? "未标注"}</div>
        {context.collectionResultId && <div className="truncate" title={context.collectionResultId}>补样本：{context.collectionResultId}</div>}
        {context.adapterCapability && <div className="truncate" title={context.adapterCapability}>能力：{context.adapterCapability}</div>}
        {context.sourceKindLabel && <div className="truncate" title={context.sourceKindLabel}>来源：{context.sourceKindLabel}</div>}
      </div>
      {submissionNotice && (
        <AuditSubmissionNoticePanel
          notice={submissionNotice}
          refreshing={refreshingLoraReady}
          onRefreshLoraReady={onRefreshLoraReady}
          className="mt-2"
        />
      )}
      {refreshDiff && (
        <AuditRefreshDiffPanel diff={refreshDiff} className="mt-2" />
      )}
    </div>
  )
}

function ProfitFeedbackHintPanel({ hint }: { hint: ProfitFeedbackDistillationHint }) {
  const toneClass = {
    neutral: "border-primary/20 bg-primary/5 text-foreground",
    good: "border-emerald-500/30 bg-emerald-500/10 text-emerald-800",
    warn: "border-amber-500/30 bg-amber-500/10 text-amber-800",
    danger: "border-destructive/30 bg-destructive/10 text-destructive",
  }[hint.tone]
  return (
    <div className={cn("mb-2 rounded-md border p-2 text-xs", toneClass)}>
      <div className="flex flex-wrap items-center gap-1">
        <span className="font-medium">{hint.headline}</span>
        <span className="rounded border bg-background/70 px-1.5 py-0.5 text-muted-foreground">
          {profitTrainingUseLabel(hint.trainingUse)}
        </span>
      </div>
      <div className="mt-1 leading-5 opacity-90">{hint.detail}</div>
    </div>
  )
}

function ProfitFeedbackReadinessPanel({
  readiness,
  collectionTask,
  creating,
  onCreateCollectionTask,
}: {
  readiness: ProfitFeedbackDistillationReadiness
  collectionTask?: StockFeedbackCollectionTask | null
  creating?: boolean
  onCreateCollectionTask?: (task: StockFeedbackCollectionTask) => void
}) {
  const toneClass = {
    neutral: "border-primary/20 bg-primary/5 text-foreground",
    good: "border-emerald-500/30 bg-emerald-500/10 text-emerald-800",
    warn: "border-amber-500/30 bg-amber-500/10 text-amber-800",
    danger: "border-destructive/30 bg-destructive/10 text-destructive",
  }[readiness.tone]
  const checkToneClass: Record<ProfitFeedbackReadinessCheck["status"], string> = {
    passed: "border-emerald-500/30 bg-emerald-500/10 text-emerald-800",
    missing: "border-amber-500/30 bg-amber-500/10 text-amber-800",
    warning: "border-amber-500/30 bg-amber-500/10 text-amber-800",
    blocked: "border-destructive/30 bg-destructive/10 text-destructive",
  }
  const Icon = readiness.tone === "good" ? CheckCircle2 : readiness.tone === "danger" ? AlertTriangle : Clock
  return (
    <div className={cn("rounded-md border p-2 text-xs", toneClass)}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          <Icon className="h-3.5 w-3.5 shrink-0" />
          <span className="font-medium">{readiness.headline}</span>
          <span className="rounded border bg-background/70 px-1.5 py-0.5 text-muted-foreground">{readiness.routeLabel}</span>
          <span className="rounded border bg-background/70 px-1.5 py-0.5 text-muted-foreground">
            {readiness.canPromoteAdapter ? "可人审提权" : "不可直接提权"}
          </span>
        </div>
        {collectionTask && onCreateCollectionTask && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onCreateCollectionTask(collectionTask)}
            disabled={creating}
            className="shrink-0 bg-background/70"
          >
            {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
            生成补证任务
          </Button>
        )}
      </div>
      <div className="mt-1 leading-5 opacity-90">{readiness.detail}</div>
      <div className="mt-2 grid grid-cols-2 gap-1">
        {readiness.checks.map((check) => (
          <div
            key={check.id}
            className={cn("min-w-0 rounded border px-1.5 py-1", checkToneClass[check.status])}
          >
            <div className="truncate font-medium" title={check.label}>{check.label}</div>
            <div className="mt-0.5 truncate text-muted-foreground" title={check.detail}>{check.detail}</div>
          </div>
        ))}
      </div>
      <div className="mt-2 leading-5 text-muted-foreground">{readiness.nextAction}</div>
    </div>
  )
}

function profitTrainingUseLabel(use?: ProfitFeedbackDistillationHint["trainingUse"]) {
  return {
    adapter_candidate_after_review: "复核后 adapter",
    eval_preference_negative: "eval/preference/负样本",
    monitor_until_settled: "继续观察",
  }[(use ?? "") as string] ?? use ?? ""
}

function TrajectoryDetail({
  trajectory,
  reviewItem,
  auditContext,
  reviewBucketContext,
  submissionNotice,
  reviewRefreshPrompt,
  reviewRefreshResult,
  refreshDiff,
  latestTrainableArtifactGeneratedAt,
  nextReviewSuggestion,
  runningReview,
  refreshingLoraReady,
  inlineCollectionTask,
  inlineCollectionResultFollowUp,
  inlineCollectionResultRoadmap,
  inlineCollectionResultTask,
  inlineCollectionResultReviewPreview,
  collectionTaskRunning,
  onExportCandidate,
  onBuildBenchmark,
  onRebuild,
  onRefreshLoraReady,
  onSelectNextReview,
  onCreateProfitCollectionTask,
  onPlanCollectionTask,
  onRecordCollectionResult,
  onContinueCollectionResultCollection,
  onRebuildCollectionResult,
  onSelectCollectionResultRoadmapStep,
  onReview,
}: {
  trajectory: StockFeedbackTrajectory | null
  reviewItem: StockFeedbackReviewQueueItem | null
  auditContext?: AuditSelectionContext | null
  reviewBucketContext?: ReviewBucketContext | null
  submissionNotice?: AuditSubmissionNotice | null
  reviewRefreshPrompt?: ReviewRefreshPrompt | null
  reviewRefreshResult?: ReviewRefreshResult | null
  refreshDiff?: AuditRefreshDiff | null
  latestTrainableArtifactGeneratedAt?: string | null
  nextReviewSuggestion?: NextHumanReviewSuggestion | null
  runningReview: string | null
  refreshingLoraReady?: boolean
  inlineCollectionTask?: StockFeedbackCollectionTask | null
  inlineCollectionResultFollowUp?: CollectionResultFollowUp | null
  inlineCollectionResultRoadmap?: CollectionResultActionRoadmap | null
  inlineCollectionResultTask?: StockFeedbackCollectionTask | null
  inlineCollectionResultReviewPreview?: CollectionResultReviewRoutePreview | null
  collectionTaskRunning?: string | null
  onExportCandidate: () => void
  onBuildBenchmark: () => void
  onRebuild: () => void
  onRefreshLoraReady: () => void
  onSelectNextReview?: (suggestion: NextHumanReviewSuggestion) => void
  onCreateProfitCollectionTask: (task: StockFeedbackCollectionTask) => void
  onPlanCollectionTask: (task: StockFeedbackCollectionTask, write: boolean) => void
  onRecordCollectionResult: (task: StockFeedbackCollectionTask, result: string, evidenceRefs: string, summary: string) => void
  onContinueCollectionResultCollection: () => void
  onRebuildCollectionResult: () => void
  onSelectCollectionResultRoadmapStep?: (step: CollectionResultActionRoadmapStep) => void
  onReview: (action: string, note: string) => void
}) {
  if (!trajectory) {
    return (
      <div className="flex h-full min-h-[360px] items-center justify-center text-sm text-muted-foreground">
        选择一条轨迹查看事件时间线和分流状态
      </div>
    )
  }
  const profitHint = buildProfitFeedbackDistillationHint(trajectory.profitFeedback)
  const profitReadiness = buildProfitFeedbackDistillationReadiness(trajectory)
  const profitCollectionTask = buildProfitFeedbackCollectionTask(trajectory, profitReadiness)
  const distillationPlan = reviewItem?.distillationPlan ?? trajectory.distillationPlan
  const peftBoundaryReview = buildPeftBoundaryReview(trajectory, distillationPlan)
  const autoEvidenceGateGap = (trajectory.evidenceState?.evidenceGaps ?? []).includes("paper_trade_auto_evidence_gate_blocked")
  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold">{TARGET_LABELS[trajectory.validationTarget] ?? trajectory.validationTarget}</h2>
          <GateBadge gate={trajectory.qualityGate?.status} highConfidence={trajectory.qualityGate?.highConfidenceEligible} />
        </div>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{trajectory.hypothesis || trajectory.question}</p>
      </div>

      {auditContext && (
        <AuditContextPanel
          context={auditContext}
          submissionNotice={submissionNotice}
          refreshDiff={refreshDiff}
          refreshingLoraReady={refreshingLoraReady}
          onRefreshLoraReady={onRefreshLoraReady}
        />
      )}

      <DetailBlock title="事件时间线">
        <div className="space-y-2">
          {(trajectory.eventTimeline ?? []).map((item, index) => (
            <div key={`${item.step}-${index}`} className="flex items-start gap-2 text-sm">
              <span className="mt-1 h-2 w-2 rounded-full bg-primary" />
              <div>
                <div className="font-medium">{item.step}</div>
                <div className="text-xs text-muted-foreground">{[item.at, item.ref].filter(Boolean).join(" · ")}</div>
              </div>
            </div>
          ))}
        </div>
      </DetailBlock>

      <DetailBlock title="市场验证">
        <KeyValue label="标的" value={[trajectory.stock?.name, trajectory.stock?.code].filter(Boolean).join(" ")} />
        <KeyValue label="结果" value={String(trajectory.marketValidation?.verdict ?? trajectory.summary ?? "待确认")} />
        <KeyValue label="能力" value={trajectory.adapterCapability ?? ""} />
      </DetailBlock>

      <DetailBlock title="来源状态">
        <KeyValue label="来源" value={trajectorySourceLabel(trajectory.source ?? trajectory.sourceKind)} />
        <KeyValue label="补样本" value={collectionResultLabel(trajectory.collectionState?.result ?? undefined, trajectory.collectionState?.resultLabel ?? undefined)} />
        <KeyValue label="模式" value={trajectory.collectionState?.targetPatternLabel ?? trajectory.collectionState?.targetPatternId ?? ""} />
        <KeyValue label="人审" value={trajectory.collectionState?.reviewer ?? ""} />
        {trajectory.paperTradeState && (
          <PaperTradeStateSummary
            state={trajectory.paperTradeState}
            profitFeedback={trajectory.profitFeedback}
          />
        )}
      </DetailBlock>

      <DetailBlock title="手法模式">
        {(trajectory.marketPatterns?.length ?? 0) > 0 ? (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1">
              {trajectory.marketPatterns?.map((pattern, index) => (
                <PatternPill key={`${pattern.id ?? pattern.label ?? "pattern"}-${index}`} label={pattern.label ?? pattern.id ?? "未命名"} />
              ))}
            </div>
            {trajectory.marketPatterns?.slice(0, 2).map((pattern, index) => (
              <p key={`${pattern.id ?? pattern.label ?? "hint"}-${index}`} className="text-xs leading-5 text-muted-foreground">
                {pattern.distillationHint}
              </p>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">等待人工复核或更多市场反馈后归类</p>
        )}
      </DetailBlock>

      <DetailBlock title="收益反馈">
        <ProfitFeedbackReadinessPanel
          readiness={profitReadiness}
          collectionTask={inlineCollectionTask ? null : profitCollectionTask}
          creating={collectionTaskRunning === "collection-dry"}
          onCreateCollectionTask={onCreateProfitCollectionTask}
        />
        {inlineCollectionTask && (
          <div className="mt-3">
            <CollectionTaskPanel
              task={inlineCollectionTask}
              running={collectionTaskRunning}
              onPlan={onPlanCollectionTask}
              onRecordResult={onRecordCollectionResult}
              compact
            />
          </div>
        )}
        {inlineCollectionResultFollowUp && (
          <div className="mt-3">
            <CollectionResultFollowUpPanel
              followUp={inlineCollectionResultFollowUp}
              roadmap={inlineCollectionResultRoadmap}
              reviewPreview={inlineCollectionResultReviewPreview}
              running={collectionTaskRunning}
              canContinueCollection={Boolean(inlineCollectionResultTask)}
              onContinueCollection={onContinueCollectionResultCollection}
              onBuildBenchmark={onBuildBenchmark}
              onRebuild={onRebuildCollectionResult}
              onRefreshLoraReady={onRefreshLoraReady}
              onSelectRoadmapStep={onSelectCollectionResultRoadmapStep}
              compact
            />
          </div>
        )}
        {profitHint && <ProfitFeedbackHintPanel hint={profitHint} />}
        <KeyValue label="结果" value={profitOutcomeLabel(trajectory.profitFeedback?.outcome)} />
        <KeyValue label="收益" value={formatPercent(trajectory.profitFeedback?.realizedPnlPct)} />
        <KeyValue label="回撤" value={formatPercent(trajectory.profitFeedback?.maxDrawdownPct)} />
        <KeyValue label="持有" value={formatDays(trajectory.profitFeedback?.holdingDays)} />
        <KeyValue label="进场" value={trajectory.profitFeedback?.entryTiming ?? ""} />
        <KeyValue label="离场" value={trajectory.profitFeedback?.exitTiming ?? ""} />
        <KeyValue label="仓位" value={trajectory.profitFeedback?.positionSizing ?? ""} />
        <KeyValue label="归因" value={profitFeedbackCreditDetail(trajectory.profitFeedback)} />
      </DetailBlock>

      <DetailBlock title="蒸馏边界">
        <KeyValue label="技能" value={trajectory.distillationSignals?.skill ?? trajectory.adapterCapability ?? ""} />
        <KeyValue label="策略" value={trajectory.distillationSignals?.decisionStrategy ?? ""} />
        <KeyValue label="风控" value={trajectory.distillationSignals?.riskControl ?? ""} />
        <KeyValue label="工具" value={trajectory.distillationSignals?.toolHabit ?? ""} />
      </DetailBlock>

      <DetailBlock title="LoRA 学习边界">
        <PeftBoundaryReviewPanel review={peftBoundaryReview} />
      </DetailBlock>

      <DetailBlock title="蒸馏决策">
        <DistillationPlanPanel plan={distillationPlan} />
      </DetailBlock>

      <DetailBlock title="补证状态">
        <KeyValue label="归因" value={trajectory.evidenceState?.attributionLabel ?? ""} />
        <KeyValue label="下一步" value={trajectory.evidenceState?.nextAction ?? trajectory.qualityGate?.requiredAction ?? ""} />
        <PaperTradeAutoEvidenceGatePanel
          gate={trajectory.paperTradeState?.autoEvidenceGate}
          forceVisible={autoEvidenceGateGap}
        />
        <QualityGateCheckList checkResults={trajectory.qualityGate?.checkResults} />
        <div className="mt-2 flex flex-wrap gap-1">
          {(trajectory.evidenceState?.evidenceGaps ?? []).slice(0, 6).map((gap) => (
            <span key={gap} className="rounded border bg-muted px-2 py-0.5 text-xs text-muted-foreground">{gap}</span>
          ))}
        </div>
      </DetailBlock>

      <DetailBlock title="人工分流">
        <HumanRoutingPanel
          trajectory={trajectory}
          reviewItem={reviewItem}
          peftBoundaryReview={peftBoundaryReview}
          auditContext={auditContext}
          reviewBucketContext={reviewBucketContext}
          submissionNotice={submissionNotice}
          reviewRefreshPrompt={reviewRefreshPrompt}
          reviewRefreshResult={reviewRefreshResult}
          refreshDiff={refreshDiff}
          latestTrainableArtifactGeneratedAt={latestTrainableArtifactGeneratedAt}
          nextReviewSuggestion={nextReviewSuggestion}
          runningReview={runningReview}
          refreshingLoraReady={refreshingLoraReady}
          evidenceCollectionTask={profitCollectionTask}
          collectionTaskRunning={collectionTaskRunning}
          onExportCandidate={onExportCandidate}
          onBuildBenchmark={onBuildBenchmark}
          onRebuild={onRebuild}
          onRefreshLoraReady={onRefreshLoraReady}
          onSelectNextReview={onSelectNextReview}
          onCreateEvidenceCollectionTask={onCreateProfitCollectionTask}
          onReview={onReview}
        />
      </DetailBlock>

      <DetailBlock title="引用">
        <div className="space-y-1">
          {(trajectory.sourceRefs ?? []).slice(0, 8).map((ref) => (
            <div key={ref} className="truncate text-xs text-muted-foreground" title={ref}>{ref}</div>
          ))}
        </div>
      </DetailBlock>
    </div>
  )
}

function HumanRoutingPanel({
  trajectory,
  reviewItem,
  peftBoundaryReview,
  auditContext,
  reviewBucketContext,
  submissionNotice,
  reviewRefreshPrompt,
  reviewRefreshResult,
  refreshDiff,
  latestTrainableArtifactGeneratedAt,
  nextReviewSuggestion,
  runningReview,
  refreshingLoraReady,
  evidenceCollectionTask,
  collectionTaskRunning,
  onExportCandidate,
  onBuildBenchmark,
  onRebuild,
  onRefreshLoraReady,
  onSelectNextReview,
  onCreateEvidenceCollectionTask,
  onReview,
}: {
  trajectory: StockFeedbackTrajectory
  reviewItem: StockFeedbackReviewQueueItem | null
  peftBoundaryReview?: PeftBoundaryReview | null
  auditContext?: AuditSelectionContext | null
  reviewBucketContext?: ReviewBucketContext | null
  submissionNotice?: AuditSubmissionNotice | null
  reviewRefreshPrompt?: ReviewRefreshPrompt | null
  reviewRefreshResult?: ReviewRefreshResult | null
  refreshDiff?: AuditRefreshDiff | null
  latestTrainableArtifactGeneratedAt?: string | null
  nextReviewSuggestion?: NextHumanReviewSuggestion | null
  runningReview: string | null
  refreshingLoraReady?: boolean
  evidenceCollectionTask?: StockFeedbackCollectionTask | null
  collectionTaskRunning?: string | null
  onExportCandidate: () => void
  onBuildBenchmark: () => void
  onRebuild: () => void
  onRefreshLoraReady: () => void
  onSelectNextReview?: (suggestion: NextHumanReviewSuggestion) => void
  onCreateEvidenceCollectionTask?: (task: StockFeedbackCollectionTask) => void
  onReview: (action: string, note: string) => void
}) {
  const [note, setNote] = useState("")
  const lastAutoNoteRef = useRef("")
  const gate = trajectory.qualityGate?.status ?? "review_required"
  const message =
    gate === "expectation_validated"
      ? "这条可以作为“市场先交易预期”的高质量样本；不要求订单/公告/财报已经落地。"
      : gate === "fundamental_validated"
        ? "这条已经有基本面兑现证据，可以进入基本面兑现判断样本。"
        : gate === "priced_in_validated"
          ? "方向正确但赔率压缩，优先进入 eval/preference，训练不要把追涨误判为好决策。"
          : gate === "disconfirmed_validated"
            ? "预期失败或无承接，优先进入负样本和失败归因。"
            : gate === "needs_evidence"
              ? "先补公告、订单、招投标或财报证据；不要提升为基本面兑现高质量样本。"
              : "需要人工复核后再进入训练或候选 adapter。"
  const qualityGateCanExport = trajectory.qualityGate?.highConfidenceEligible === true
  const peftAllowsAdapter = peftBoundaryAllowsAdapterApproval(peftBoundaryReview)
  const canExport = qualityGateCanExport && peftAllowsAdapter
  const latestReview = reviewItem?.latestReview ?? null
  const latestReviewWeightDetail = trainingWeightDecisionDetail(latestReview?.trainingWeightDecision)
  const actionPlan = reviewItem?.humanActionPlan ?? null
  const rawRecommendedAction = actionPlan?.recommendedAction ?? reviewItem?.recommendedAction ?? (qualityGateCanExport ? "approve_for_adapter" : "route_to_eval")
  const peftActionHint = buildPeftBoundaryActionHint(peftBoundaryReview, {
    recommendedAction: rawRecommendedAction,
    canExport: qualityGateCanExport,
    adapterCapability: trajectory.adapterCapability,
  })
  const recommendedAction = peftActionHint?.locksAdapterApproval && rawRecommendedAction === "approve_for_adapter"
    ? peftActionHint.recommendedAction
    : rawRecommendedAction
  const auditPrompt = buildAuditReviewPrompt(auditContext, {
    recommendedAction,
    recommendedActionLabel: actionPlan?.recommendedActionLabel ?? reviewItem?.recommendedActionLabel,
    gate,
    canExport,
  })
  const defaultNote = `人工分流：${reviewItem?.recommendedActionLabel ?? recommendedAction}`
  const submit = (action: string) => onReview(action, note || auditPrompt?.noteDraft || peftActionHint?.noteDraft || defaultNote)
  const actionOptions = actionPlan?.actionOptions ?? []
  const actionOptionByAction = new Map(actionOptions.map((option) => [option.action, option]))
  const visibleActionOptions = visibleReviewActionOptions(actionOptions)
  const recommendedOption = recommendedAction ? actionOptionByAction.get(recommendedAction) : null
  const reviewCycleGate = buildReviewCycleGate({
    submissionNotice,
    reviewRefreshPrompt,
    reviewRefreshResult,
    refreshDiff,
    latestReview,
    latestTrainableArtifactGeneratedAt,
  })
  const reviewActionsLocked = reviewCycleGate?.locked === true
  const effectiveRecommendationLabel = peftActionHint?.locksAdapterApproval && rawRecommendedAction === "approve_for_adapter"
    ? peftActionHint.recommendedActionLabel
    : actionPlan?.recommendedActionLabel ?? reviewItem?.recommendedActionLabel ?? reviewActionLabel(recommendedAction)
  const reviewActionStatusHint = buildReviewActionStatusHint({
    auditContext,
    auditPrompt,
    peftActionHint,
    reviewCycleGate,
    reviewRefreshResult,
    refreshDiff,
    recommendedAction,
    recommendedActionLabel: effectiveRecommendationLabel,
    canExport,
    peftAllowsAdapter,
  })
  const reviewRefreshCompletionSummary = buildReviewRefreshCompletionSummary({
    reviewRefreshResult,
    refreshDiff,
    recommendedActionLabel: effectiveRecommendationLabel,
  })
  const paperTradeReviewClosureSummary = buildPaperTradeReviewClosureSummary({
    trajectory,
    reviewRefreshPrompt,
    reviewRefreshResult,
    refreshDiff,
  })
  const hasActionOption = (action: string) => actionOptionByAction.has(action)
  const primaryReviewButtonLabel = peftActionHint?.locksAdapterApproval && rawRecommendedAction === "approve_for_adapter"
    ? `执行 PEFT 建议：${peftActionHint.recommendedActionLabel}`
    : actionPlan?.primaryButtonLabel ?? `执行推荐：${reviewActionLabel(recommendedAction)}`
  const actionPlanTitle = peftActionHint?.locksAdapterApproval && rawRecommendedAction === "approve_for_adapter"
    ? `PEFT 建议：${peftActionHint.recommendedActionLabel}`
    : actionPlan?.primaryButtonLabel ?? actionPlan?.recommendedActionLabel ?? recommendedAction
  const isPositiveAdapterAction = (action: string) => action === "approve_for_adapter" || action === "approve_paper_adapter_candidate"
  const isActionDisabled = (action: string, fallback = false) => (
    Boolean(runningReview) ||
    reviewActionsLocked ||
    fallback ||
    (isPositiveAdapterAction(action) && !peftAllowsAdapter) ||
    actionOptionByAction.get(action)?.enabled === false
  )
  const recommendedDisabled = (
    Boolean(runningReview) ||
    reviewActionsLocked ||
    !recommendedAction ||
    recommendedOption?.enabled === false ||
    (recommendedAction === "approve_for_adapter" && !canExport) ||
    (recommendedAction === "approve_paper_adapter_candidate" && !peftAllowsAdapter)
  )
  const adapterApprovalDisabledHint = buildAdapterApprovalDisabledHint({
    gate,
    recommendedActionLabel: effectiveRecommendationLabel,
    canExport,
    peftAllowsAdapter,
  })
  const adapterApprovalButtonPresentation = buildAdapterApprovalButtonPresentation(adapterApprovalDisabledHint)
  useEffect(() => {
    const nextDraft = auditPrompt?.noteDraft ?? ""
    if (!nextDraft) return
    setNote((current) => {
      const shouldReplace = !current.trim() || current === lastAutoNoteRef.current
      lastAutoNoteRef.current = nextDraft
      return shouldReplace ? nextDraft : current
    })
  }, [auditPrompt?.noteDraft])
  return (
    <div className="space-y-3">
      {reviewBucketContext && <ReviewBucketContextPanel context={reviewBucketContext} />}
      <p className="text-sm leading-6 text-muted-foreground">{message}</p>
      {auditPrompt && (
        <AuditReviewPromptPanel
          prompt={auditPrompt}
          onUseNote={() => setNote(auditPrompt.noteDraft)}
        />
      )}
      {peftActionHint && (
        <PeftBoundaryActionHintPanel
          hint={peftActionHint}
          onUseNote={() => setNote(peftActionHint.noteDraft)}
        />
      )}
      {actionPlan && (
        <div className="rounded-md border bg-muted/30 p-2 text-xs">
          <div className="font-medium">{actionPlanTitle}</div>
          {actionPlan.intent && <div className="mt-1 leading-5 text-muted-foreground">{actionPlan.intent}</div>}
          <div className="mt-2 flex flex-wrap gap-1">
            {routingLabels(actionPlan.expectedRouting).map((label) => (
              <span key={label} className="rounded border bg-background px-2 py-0.5 text-muted-foreground">{label}</span>
            ))}
          </div>
        </div>
      )}
      {visibleActionOptions.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs font-medium text-muted-foreground">提交前预览</div>
          <div className="divide-y rounded-md border">
            {visibleActionOptions.map((option) => {
              const peftDisabled = isPositiveAdapterAction(option.action ?? "") && !peftAllowsAdapter
              const disabled = option.enabled === false || peftDisabled
              const detail = reviewActionOptionDetail(option)
              return (
                <div
                  key={option.action ?? option.label}
                  className={cn(
                    "grid grid-cols-[minmax(0,1fr)_auto] gap-2 px-2 py-2 text-xs",
                    disabled && "bg-muted/30 text-muted-foreground",
                  )}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1">
                      <span className="font-medium">{option.label ?? reviewActionLabel(option.action)}</span>
                      {option.recommended && <span className="rounded border bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">推荐</span>}
                      {disabled && <span className="rounded border bg-muted px-1.5 py-0.5 text-[11px]">不可直接提交</span>}
                    </div>
                    {detail && <div className="mt-1 truncate text-muted-foreground" title={detail}>{detail}</div>}
                    {disabled && option.disabledReason && (
                      <div className="mt-1 break-words text-muted-foreground">{option.disabledReason}</div>
                    )}
                    {peftDisabled && (
                      <div className="mt-1 break-words text-muted-foreground">PEFT 闸门锁住正向 adapter；先处理边界审查建议。</div>
                    )}
                  </div>
                  <div className="flex max-w-[120px] flex-wrap justify-end gap-1">
                    {routingLabels(option.preview?.routing).map((label) => (
                      <span key={label} className="rounded border bg-background px-1.5 py-0.5 text-[11px] text-muted-foreground">{label}</span>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
      {latestReview ? (
        <div className="rounded-md border bg-muted/40 p-2 text-xs">
          <div className="font-medium">最近 review：{latestReview.actionLabel ?? latestReview.action}</div>
          <div className="mt-1 text-muted-foreground">
            {[latestReview.result, latestReview.reviewer, latestReview.generatedAt].filter(Boolean).join(" · ")}
          </div>
          {latestReviewWeightDetail && (
            <div className="mt-1 text-emerald-700">
              {latestReviewWeightDetail}
            </div>
          )}
          {latestReview.note && <div className="mt-1 text-muted-foreground">{latestReview.note}</div>}
        </div>
      ) : (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-700">
          推荐动作：{effectiveRecommendationLabel}
        </div>
      )}
      {reviewRefreshPrompt && (
        <ReviewRefreshPromptPanel
          prompt={reviewRefreshPrompt}
          refreshing={refreshingLoraReady}
          onRefreshLoraReady={reviewCycleGate ? undefined : onRefreshLoraReady}
        />
      )}
      {reviewRefreshCompletionSummary ? (
        <ReviewRefreshCompletionSummaryPanel
          summary={reviewRefreshCompletionSummary}
          nextReviewSuggestion={nextReviewSuggestion}
          onSelectNextReview={onSelectNextReview}
        />
      ) : reviewRefreshResult && (
        <ReviewRefreshResultPanel result={reviewRefreshResult} />
      )}
      {paperTradeReviewClosureSummary && (
        <PaperTradeReviewClosureSummaryPanel summary={paperTradeReviewClosureSummary} />
      )}
      {reviewCycleGate && (
        <ReviewCycleGatePanel
          gate={reviewCycleGate}
          refreshing={refreshingLoraReady}
          collectionBridge={buildReviewCycleGateCollectionBridge(reviewCycleGate, evidenceCollectionTask)}
          collectionRunning={collectionTaskRunning === "collection-dry"}
          onRefreshLoraReady={onRefreshLoraReady}
          onCreateCollectionTask={onCreateEvidenceCollectionTask}
        />
      )}
      <textarea
        value={note}
        onChange={(event) => setNote(event.target.value)}
        rows={2}
        aria-label="人工分流备注"
        className="w-full resize-none rounded-md border bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
        placeholder="人工备注：为什么进入 adapter / 偏好 / 补证 / 排除"
      />
      {!reviewRefreshCompletionSummary && <ReviewActionStatusHintPanel hint={reviewActionStatusHint} />}
      <Button type="button" className="w-full justify-center" onClick={() => recommendedAction && submit(recommendedAction)} disabled={recommendedDisabled}>
        {runningReview === `review-${recommendedAction}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
        {primaryReviewButtonLabel}
      </Button>
      {adapterApprovalDisabledHint && (
        <div className="flex items-start gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-xs leading-5 text-amber-800">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{adapterApprovalDisabledHint}</span>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          size="sm"
          variant={adapterApprovalButtonPresentation.variant}
          className={adapterApprovalButtonPresentation.className}
          onClick={() => submit("approve_for_adapter")}
          disabled={isActionDisabled("approve_for_adapter", !canExport)}
        >
          {runningReview === "review-approve_for_adapter" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          确认 adapter
        </Button>
        {hasActionOption("approve_paper_adapter_candidate") && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => submit("approve_paper_adapter_candidate")}
            disabled={isActionDisabled("approve_paper_adapter_candidate")}
          >
            {runningReview === "review-approve_paper_adapter_candidate" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            paper adapter
          </Button>
        )}
        <Button type="button" size="sm" variant="outline" onClick={() => submit("route_to_preference")} disabled={isActionDisabled("route_to_preference")}>
          {runningReview === "review-route_to_preference" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Target className="h-4 w-4" />}
          偏好/eval
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => submit("needs_evidence")} disabled={isActionDisabled("needs_evidence")}>
          {runningReview === "review-needs_evidence" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
          转补证
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => submit("reject_for_adapter")} disabled={isActionDisabled("reject_for_adapter")}>
          {runningReview === "review-reject_for_adapter" ? <Loader2 className="h-4 w-4 animate-spin" /> : <AlertTriangle className="h-4 w-4" />}
          排除 adapter
        </Button>
        {hasActionOption("mark_entry_wrong") && (
          <Button type="button" size="sm" variant="outline" onClick={() => submit("mark_entry_wrong")} disabled={isActionDisabled("mark_entry_wrong")}>
            {runningReview === "review-mark_entry_wrong" ? <Loader2 className="h-4 w-4 animate-spin" /> : <AlertTriangle className="h-4 w-4" />}
            买点错
          </Button>
        )}
        {hasActionOption("mark_priced_in") && (
          <Button type="button" size="sm" variant="outline" onClick={() => submit("mark_priced_in")} disabled={isActionDisabled("mark_priced_in")}>
            {runningReview === "review-mark_priced_in" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Filter className="h-4 w-4" />}
            Priced-in
          </Button>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={onExportCandidate} disabled={!canExport}>
          <Database className="h-4 w-4" />
          导出候选
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onBuildBenchmark}>
          <Target className="h-4 w-4" />
          生成用例
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onRebuild}>
          <RefreshCw className="h-4 w-4" />
          重建轨迹
        </Button>
      </div>
    </div>
  )
}

function AuditReviewPromptPanel({
  prompt,
  onUseNote,
}: {
  prompt: AuditReviewPrompt
  onUseNote: () => void
}) {
  const toneClass = {
    neutral: "border-primary/20 bg-primary/5 text-foreground",
    good: "border-emerald-500/30 bg-emerald-500/10 text-emerald-800",
    warn: "border-amber-500/30 bg-amber-500/10 text-amber-800",
    danger: "border-destructive/30 bg-destructive/10 text-destructive",
  }[prompt.tone]
  return (
    <div className={cn("rounded-md border p-2 text-xs", toneClass)}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="font-medium">{prompt.headline}</div>
          <div className="mt-1 leading-5 opacity-90">{prompt.detail}</div>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={onUseNote} className="shrink-0 bg-background/70">
          使用抽查备注
        </Button>
      </div>
      <div className="mt-2 rounded border bg-background/70 px-2 py-1 leading-5 text-muted-foreground">
        {prompt.actionHint}
      </div>
    </div>
  )
}

function PeftBoundaryActionHintPanel({
  hint,
  onUseNote,
}: {
  hint: PeftBoundaryActionHint
  onUseNote: () => void
}) {
  const toneClass = {
    good: "border-emerald-500/30 bg-emerald-500/10 text-emerald-800",
    warn: "border-amber-500/30 bg-amber-500/10 text-amber-800",
    danger: "border-destructive/30 bg-destructive/10 text-destructive",
  }[hint.tone]
  const Icon = hint.tone === "good" ? ShieldCheck : AlertTriangle
  return (
    <div className={cn("rounded-md border p-2 text-xs", toneClass)}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1">
            <Icon className="h-3.5 w-3.5" />
            <span className="font-medium">{hint.headline}</span>
            <span className="rounded border bg-background/70 px-1.5 py-0.5 text-muted-foreground">
              建议：{hint.recommendedActionLabel}
            </span>
            {hint.locksAdapterApproval && (
              <span className="rounded border bg-background/70 px-1.5 py-0.5 text-muted-foreground">
                锁住正向 adapter
              </span>
            )}
          </div>
          <div className="mt-1 leading-5 opacity-90">{hint.detail}</div>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={onUseNote} className="shrink-0 bg-background/70">
          使用边界备注
        </Button>
      </div>
    </div>
  )
}

function ReviewBucketContextPanel({ context }: { context: ReviewBucketContext }) {
  const toneClass = context.tone === "good"
    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-800"
    : context.tone === "warn"
      ? "border-amber-500/30 bg-amber-500/10 text-amber-800"
      : "border-primary/20 bg-primary/5 text-foreground"
  return (
    <div className={cn("rounded-md border px-2 py-1.5 text-xs", toneClass)}>
      <div className="flex flex-wrap items-center gap-1">
        <span className="font-medium">来自 review 桶</span>
        <span className="rounded border bg-background/70 px-1.5 py-0.5 text-muted-foreground">{context.label}</span>
        <span className="rounded border bg-background/70 px-1.5 py-0.5 text-muted-foreground">{context.selectedActionLabel}</span>
        <span className="rounded border bg-background/70 px-1.5 py-0.5 text-muted-foreground">
          第 {context.position}/{context.totalCount} 条
        </span>
        <span className="rounded border bg-background/70 px-1.5 py-0.5 text-muted-foreground">
          {context.completionLabel}
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-background/70">
        <div
          className="h-full rounded-full bg-current"
          style={{ width: `${Math.max(0, Math.min(100, context.completionPct))}%` }}
        />
      </div>
      <div className="mt-1 leading-5 opacity-90">
        待审 {context.pendingCount} 条；当前状态 {context.selectedReviewStatus === "reviewed" ? "已审" : context.selectedReviewStatus === "pending" ? "待审" : "待确认"}。{context.detail}
      </div>
    </div>
  )
}

function AuditSubmissionNoticePanel({
  notice,
  refreshing,
  onRefreshLoraReady,
  className,
}: {
  notice: AuditSubmissionNotice
  refreshing?: boolean
  onRefreshLoraReady?: () => void
  className?: string
}) {
  const toneClass = {
    neutral: "border-primary/20 bg-primary/5 text-foreground",
    good: "border-emerald-500/30 bg-emerald-500/10 text-emerald-800",
    warn: "border-amber-500/30 bg-amber-500/10 text-amber-800",
    danger: "border-destructive/30 bg-destructive/10 text-destructive",
  }[notice.tone]
  return (
    <div className={cn("rounded-md border px-2 py-1.5 text-xs", toneClass, className)}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          <span className="font-medium">{notice.headline}</span>
          <span className="rounded border bg-background/70 px-1.5 py-0.5 text-muted-foreground">{notice.actionLabel}</span>
          <span className="rounded border bg-background/70 px-1.5 py-0.5 text-muted-foreground">{notice.resultLabel}</span>
        </div>
        {notice.refreshLabel && onRefreshLoraReady && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onRefreshLoraReady}
            disabled={refreshing}
            className="shrink-0 bg-background/70"
          >
            {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {notice.refreshLabel}
          </Button>
        )}
      </div>
      <div className="mt-1 leading-5 opacity-90">{notice.detail}</div>
      <div className="mt-1 leading-5 text-muted-foreground">{notice.nextStep}</div>
    </div>
  )
}

function ReviewRefreshPromptPanel({
  prompt,
  refreshing,
  onRefreshLoraReady,
}: {
  prompt: ReviewRefreshPrompt
  refreshing?: boolean
  onRefreshLoraReady?: () => void
}) {
  const toneClass = {
    neutral: "border-primary/20 bg-primary/5 text-foreground",
    good: "border-emerald-500/30 bg-emerald-500/10 text-emerald-800",
    warn: "border-amber-500/30 bg-amber-500/10 text-amber-800",
    danger: "border-destructive/30 bg-destructive/10 text-destructive",
  }[prompt.tone]
  return (
    <div className={cn("rounded-md border px-2 py-1.5 text-xs", toneClass)}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          <span className="font-medium">{prompt.headline}</span>
          <span className="rounded border bg-background/70 px-1.5 py-0.5 text-muted-foreground">{prompt.actionLabel}</span>
          <span className="rounded border bg-background/70 px-1.5 py-0.5 text-muted-foreground">{prompt.resultLabel}</span>
        </div>
        {prompt.refreshLabel && onRefreshLoraReady && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onRefreshLoraReady}
            disabled={refreshing}
            className="shrink-0 bg-background/70"
          >
            {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {prompt.refreshLabel}
          </Button>
        )}
      </div>
      <div className="mt-1 leading-5 opacity-90">{prompt.detail}</div>
      <div className="mt-1 leading-5 text-muted-foreground">{prompt.nextStep}</div>
    </div>
  )
}

function ReviewRefreshResultPanel({ result }: { result: ReviewRefreshResult }) {
  const toneClass = {
    neutral: "border-primary/20 bg-primary/5 text-foreground",
    good: "border-emerald-500/30 bg-emerald-500/10 text-emerald-800",
    warn: "border-amber-500/30 bg-amber-500/10 text-amber-800",
    danger: "border-destructive/30 bg-destructive/10 text-destructive",
  }[result.tone]
  return (
    <div className={cn("rounded-md border px-2 py-1.5 text-xs", toneClass)}>
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        <span className="font-medium">{result.headline}</span>
        <span className="rounded border bg-background/70 px-1.5 py-0.5 text-muted-foreground">{result.movementLabel}</span>
      </div>
      {(result.beforeLabel || result.afterLabel) && (
        <div className="mt-1 truncate text-muted-foreground" title={`${result.beforeLabel} -> ${result.afterLabel}`}>
          {result.beforeLabel || "未进入"} {"->"} {result.afterLabel || "未进入"}
        </div>
      )}
      <div className="mt-1 leading-5 opacity-90">{result.detail}</div>
    </div>
  )
}

function ReviewRefreshCompletionSummaryPanel({
  summary,
  nextReviewSuggestion,
  onSelectNextReview,
}: {
  summary: ReviewRefreshCompletionSummary
  nextReviewSuggestion?: NextHumanReviewSuggestion | null
  onSelectNextReview?: (suggestion: NextHumanReviewSuggestion) => void
}) {
  const toneClass = {
    neutral: "border-primary/20 bg-primary/5 text-foreground",
    good: "border-emerald-500/30 bg-emerald-500/10 text-emerald-800",
    warn: "border-amber-500/30 bg-amber-500/10 text-amber-800",
    danger: "border-destructive/30 bg-destructive/10 text-destructive",
  }[summary.tone]
  const canSelectNext = Boolean(nextReviewSuggestion && onSelectNextReview)
  return (
    <div className={cn("rounded-md border px-2 py-1.5 text-xs", toneClass)}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1">
            <span className="font-medium">{summary.headline}</span>
            <span className="rounded border bg-background/70 px-1.5 py-0.5 text-muted-foreground">
              {summary.movementLabel}
            </span>
            {summary.chips.slice(0, 3).map((chip) => (
              <span key={chip} className="rounded border bg-background/70 px-1.5 py-0.5 text-muted-foreground">
                {chip}
              </span>
            ))}
          </div>
          {(summary.beforeLabel || summary.afterLabel) && (
            <div className="mt-1 truncate text-muted-foreground" title={`${summary.beforeLabel} -> ${summary.afterLabel}`}>
              {summary.beforeLabel || "未进入"} {"->"} {summary.afterLabel || "未进入"}
            </div>
          )}
          <div className="mt-1 leading-5 opacity-90">{summary.detail}</div>
          {nextReviewSuggestion && (
            <div className="mt-1 truncate text-muted-foreground" title={`${nextReviewSuggestion.actionLabel}：${nextReviewSuggestion.label}`}>
              下一条：{nextReviewSuggestion.actionLabel} · {nextReviewSuggestion.label}
            </div>
          )}
        </div>
        {canSelectNext && nextReviewSuggestion ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onSelectNextReview?.(nextReviewSuggestion)}
            className="shrink-0 bg-background/70"
          >
            <Target className="h-3.5 w-3.5" />
            下一条人审
          </Button>
        ) : (
          <span className="shrink-0 rounded border bg-background/70 px-2 py-1 font-medium text-muted-foreground">
            {summary.actionLabel}
          </span>
        )}
      </div>
    </div>
  )
}

function PaperTradeReviewClosureSummaryPanel({ summary }: { summary: PaperTradeReviewClosureSummary }) {
  const toneClass = {
    neutral: "border-primary/20 bg-primary/5 text-foreground",
    good: "border-emerald-500/30 bg-emerald-500/10 text-emerald-800",
    warn: "border-amber-500/30 bg-amber-500/10 text-amber-800",
    danger: "border-destructive/30 bg-destructive/10 text-destructive",
  }[summary.tone]
  const Icon = summary.tone === "good" ? ShieldCheck : summary.tone === "danger" ? AlertTriangle : Clock
  return (
    <div className={cn("rounded-md border px-2 py-1.5 text-xs", toneClass)}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1">
            <Icon className="h-3.5 w-3.5 shrink-0" />
            <span className="font-medium">{summary.headline}</span>
            <span className="rounded border bg-background/70 px-1.5 py-0.5 text-muted-foreground">
              {summary.movementLabel}
            </span>
            {summary.chips.slice(0, 4).map((chip) => (
              <span key={chip} className="rounded border bg-background/70 px-1.5 py-0.5 text-muted-foreground">
                {chip}
              </span>
            ))}
          </div>
          {(summary.beforeLabel || summary.afterLabel) && (
            <div className="mt-1 truncate text-muted-foreground" title={`${summary.beforeLabel} -> ${summary.afterLabel}`}>
              {summary.beforeLabel || "未进入"} {"->"} {summary.afterLabel || "未进入"}
            </div>
          )}
          <div className="mt-1 leading-5 opacity-90">{summary.detail}</div>
        </div>
        <span className="shrink-0 rounded border bg-background/70 px-2 py-1 font-medium text-muted-foreground">
          {summary.actionLabel}
        </span>
      </div>
    </div>
  )
}

function ReviewActionStatusHintPanel({ hint }: { hint: ReviewActionStatusHint }) {
  const toneClass = {
    neutral: "border-primary/20 bg-primary/5 text-foreground",
    good: "border-emerald-500/30 bg-emerald-500/10 text-emerald-800",
    warn: "border-amber-500/30 bg-amber-500/10 text-amber-800",
    danger: "border-destructive/30 bg-destructive/10 text-destructive",
  }[hint.tone]
  return (
    <div className={cn("rounded-md border px-2 py-1.5 text-xs", toneClass)}>
      <div className="flex flex-wrap items-center gap-1">
        <span className="font-medium">{hint.headline}</span>
        {hint.chips.slice(0, 4).map((chip) => (
          <span key={chip} className="rounded border bg-background/70 px-1.5 py-0.5 text-muted-foreground">{chip}</span>
        ))}
      </div>
      <div className="mt-1 leading-5 opacity-90">{hint.detail}</div>
    </div>
  )
}

function ReviewCycleGatePanel({
  gate,
  refreshing,
  collectionBridge,
  collectionRunning,
  onRefreshLoraReady,
  onCreateCollectionTask,
}: {
  gate: ReviewCycleGate
  refreshing?: boolean
  collectionBridge?: ReviewCycleGateCollectionBridge | null
  collectionRunning?: boolean
  onRefreshLoraReady?: () => void
  onCreateCollectionTask?: (task: StockFeedbackCollectionTask) => void
}) {
  const toneClass = {
    neutral: "border-primary/20 bg-primary/5 text-foreground",
    good: "border-emerald-500/30 bg-emerald-500/10 text-emerald-800",
    warn: "border-amber-500/30 bg-amber-500/10 text-amber-800",
    danger: "border-destructive/30 bg-destructive/10 text-destructive",
  }[gate.tone]
  const nextAction = buildReviewCycleNextAction(gate, collectionBridge)
  return (
    <div className={cn("rounded-md border px-2 py-1.5 text-xs", toneClass)}>
      <div className="flex flex-col gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1">
            <span className="font-medium">{gate.headline}</span>
            <span className="rounded border bg-background/70 px-1.5 py-0.5 text-muted-foreground">{gate.actionLabel}</span>
          </div>
          <div className="mt-1 leading-5 opacity-90">{gate.detail}</div>
          {nextAction && (
            <ReviewCycleNextActionPanel
              nextAction={nextAction}
              refreshing={refreshing}
              collectionRunning={collectionRunning}
              onRefreshLoraReady={onRefreshLoraReady}
              onCreateCollectionTask={collectionBridge && onCreateCollectionTask
                ? () => onCreateCollectionTask(collectionBridge.task)
                : undefined}
            />
          )}
          <ol className="mt-2 grid gap-1 text-muted-foreground">
            {gate.nextSteps.map((step, index) => (
              <li key={step} className="flex gap-1.5 leading-5">
                <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border bg-background/70 text-[10px] tabular-nums">
                  {index + 1}
                </span>
                <span className="min-w-0">{step}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  )
}

function ReviewCycleNextActionPanel({
  nextAction,
  refreshing,
  collectionRunning,
  onRefreshLoraReady,
  onCreateCollectionTask,
}: {
  nextAction: ReviewCycleNextAction
  refreshing?: boolean
  collectionRunning?: boolean
  onRefreshLoraReady?: () => void
  onCreateCollectionTask?: () => void
}) {
  const toneClass = {
    neutral: "border-primary/20 bg-background/70 text-foreground",
    good: "border-emerald-500/30 bg-background/70 text-emerald-800",
    warn: "border-amber-500/30 bg-background/70 text-amber-800",
    danger: "border-destructive/30 bg-background/70 text-destructive",
  }[nextAction.tone]
  const isRefresh = nextAction.actionKind === "refresh_lora_ready"
  const isCollection = nextAction.actionKind === "create_collection_task"
  const busy = (isRefresh && refreshing) || (isCollection && collectionRunning)
  const disabled =
    nextAction.actionKind === "none" ||
    nextAction.actionKind === "wait_evidence" ||
    (isRefresh && (!onRefreshLoraReady || refreshing)) ||
    (isCollection && (!onCreateCollectionTask || collectionRunning))
  const Icon: LucideIcon = busy
    ? Loader2
    : isCollection
      ? FileText
      : isRefresh
        ? RefreshCw
        : Clock
  const handleClick = () => {
    if (isRefresh) onRefreshLoraReady?.()
    else if (isCollection) onCreateCollectionTask?.()
  }
  return (
    <div className={cn("mt-2 rounded-md border p-2", toneClass)}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1">
            <span className="font-medium">{nextAction.headline}</span>
            <span className="rounded border bg-background/70 px-1.5 py-0.5 text-muted-foreground">
              {nextAction.actionLabel}
            </span>
          </div>
          <div className="mt-1 leading-5 opacity-90">{nextAction.detail}</div>
        </div>
        {nextAction.actionKind === "wait_evidence" || nextAction.actionKind === "none" ? (
          <span className="shrink-0 rounded border bg-background/70 px-2 py-1 font-medium text-muted-foreground">
            {nextAction.actionLabel}
          </span>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={handleClick}
            className="shrink-0 bg-background/70"
          >
            <Icon className={cn("h-3.5 w-3.5", busy && "animate-spin")} />
            {nextAction.actionLabel}
          </Button>
        )}
      </div>
    </div>
  )
}

function AuditBatchRefreshSummaryPanel({
  summary,
  className,
  selectedTrajectoryId,
  activeMovementFilter = "all",
  onSelectMovementFilter,
  onSelectTrajectory,
}: {
  summary: AuditBatchRefreshSummary
  className?: string
  selectedTrajectoryId?: string | null
  activeMovementFilter?: AuditBatchRefreshMovementFilter
  onSelectMovementFilter?: (filter: AuditBatchRefreshMovementFilter) => void
  onSelectTrajectory?: (trajectoryId: string, context?: AuditSelectionContext) => void
}) {
  const chips = [
    { label: "提权", value: summary.upweighted, tone: "text-emerald-700", filter: "upweighted" as const },
    { label: "降权", value: summary.downweighted, tone: "text-amber-700", filter: "downweighted" as const },
    { label: "改分流", value: summary.rerouted ?? 0, tone: "text-primary", filter: "rerouted" as const },
    { label: "新增", value: summary.movedIn, tone: "text-primary", filter: "moved_in" as const },
    { label: "转出", value: summary.movedOut, tone: "text-amber-700", filter: "moved_out" as const },
    { label: "持平", value: summary.unchanged, tone: "text-muted-foreground", filter: null },
    { label: "补证", value: summary.evidenceGap, tone: "text-amber-700", filter: null },
    { label: "排除", value: summary.rejected, tone: "text-destructive", filter: null },
    { label: "风控/负样本", value: summary.preferenceOrRisk, tone: "text-amber-700", filter: null },
    { label: "确认", value: summary.adapterApproved, tone: "text-emerald-700", filter: null },
  ].filter((chip) => chip.value > 0)
  const visibleMovements = (summary.movements ?? [])
    .filter((movement) => movement.movement !== "unchanged")
    .slice(0, 4)
  const indexedMovementCount = lookupAuditBatchRefreshMovements(summary)
    .filter((movement) => movement.movement !== "unchanged")
    .length
  const reviewActions = buildBatchRefreshReviewActions(summary).slice(0, 3)

  return (
    <div className={cn("rounded-md border border-primary/20 bg-primary/5 p-2 text-xs", className)}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="font-medium text-primary">{summary.headline}</div>
          <div className="mt-1 text-muted-foreground">
            {summary.totalBefore} 条 {"->"} {summary.totalAfter} 条
          </div>
        </div>
        <span className="shrink-0 rounded border bg-background/70 px-1.5 py-0.5 text-muted-foreground">
          LoRA-ready
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {chips.length > 0 ? chips.map((chip) => {
          const filter = chip.filter ?? null
          const active = Boolean(filter && activeMovementFilter === filter)
          const className = cn(
            "rounded border bg-background/70 px-1.5 py-0.5 tabular-nums",
            chip.tone,
            active && "border-primary bg-primary/10 text-primary",
          )
          if (filter && onSelectMovementFilter) {
            return (
              <button
                key={chip.label}
                type="button"
                aria-pressed={active}
                onClick={() => onSelectMovementFilter(filter)}
                className={cn(className, "transition-colors hover:bg-muted/70")}
              >
                {chip.label} {chip.value}
              </button>
            )
          }
          return (
            <span key={chip.label} className={className}>
              {chip.label} {chip.value}
            </span>
          )
        }) : (
          <span className="rounded border bg-background/70 px-1.5 py-0.5 text-muted-foreground">暂无结构变化</span>
        )}
      </div>
      <div className="mt-2 leading-5 text-muted-foreground">{summary.detail}</div>
      {reviewActions.length > 0 && (
        <div className="mt-2 divide-y border-y bg-background/50">
          {reviewActions.map((action) => (
            <BatchRefreshReviewActionRow
              key={action.filter}
              action={action}
              active={activeMovementFilter === action.filter}
              onSelectMovementFilter={onSelectMovementFilter}
            />
          ))}
        </div>
      )}
      {visibleMovements.length > 0 && (
        <div className="mt-2 overflow-hidden rounded border bg-background/70">
          <div className="flex items-center justify-between gap-2 border-b px-2 py-1 text-[11px] text-muted-foreground">
            <span>变化样本</span>
            <span className="tabular-nums">{visibleMovements.length}/{indexedMovementCount || visibleMovements.length}</span>
          </div>
          <div className="divide-y">
            {visibleMovements.map((movement) => (
              <AuditBatchRefreshMovementRow
                key={movement.key ?? `${movement.id}-${movement.movement}`}
                movement={movement}
                selected={Boolean(movement.sourceTrajectoryId && movement.sourceTrajectoryId === selectedTrajectoryId)}
                onSelectTrajectory={onSelectTrajectory}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function BatchRefreshReviewActionRow({
  action,
  active,
  onSelectMovementFilter,
}: {
  action: BatchRefreshReviewAction
  active?: boolean
  onSelectMovementFilter?: (filter: AuditBatchRefreshMovementFilter) => void
}) {
  const priorityClass = {
    high: "border-amber-500/30 bg-amber-500/10 text-amber-700",
    medium: "border-primary/20 bg-primary/10 text-primary",
    low: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700",
  }[action.priority]
  return (
    <div className="flex flex-col gap-2 px-2 py-2 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1">
          <span className="font-medium">{action.headline}</span>
          <span className={cn("rounded border px-1.5 py-0.5 tabular-nums", priorityClass)}>
            {action.count} 条
          </span>
        </div>
        <div className="mt-1 leading-5 text-muted-foreground">{action.detail}</div>
      </div>
      {onSelectMovementFilter && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-pressed={active}
          onClick={() => onSelectMovementFilter(action.filter)}
          className={cn("shrink-0 bg-background/80", active && "border-primary text-primary")}
        >
          {action.actionLabel}
        </Button>
      )}
    </div>
  )
}

function AuditBatchRefreshMovementRow({
  movement,
  selected,
  onSelectTrajectory,
}: {
  movement: AuditBatchRefreshMovement
  selected?: boolean
  onSelectTrajectory?: (trajectoryId: string, context?: AuditSelectionContext) => void
}) {
  const label = auditBatchRefreshMovementLabel(movement.movement)
  const tone = auditBatchRefreshMovementTone(movement.movement)
  const title = uniqueTextParts([
    movement.adapterCapability,
    TARGET_LABELS[movement.validationTarget ?? ""] ?? movement.validationTarget,
    movement.id,
    movement.sourceTrajectoryId,
  ]).join(" · ")
  const beforeLabel = auditBatchRefreshMovementStateLabel(movement.before)
  const afterLabel = auditBatchRefreshMovementStateLabel(movement.after)
  const context = auditContextFromBatchRefreshMovement(movement)
  const canSelect = Boolean(context?.sourceTrajectoryId && onSelectTrajectory)
  const content = (
    <>
      <span className={cn("h-fit w-fit rounded border px-1.5 py-0.5", tone)}>
        {label}
      </span>
      <div className="min-w-0">
        <div className="truncate font-medium" title={title}>{title || "未命名候选"}</div>
        <div className="mt-1 truncate text-muted-foreground" title={`${beforeLabel} -> ${afterLabel}`}>
          {beforeLabel} {"->"} {afterLabel}
        </div>
        {canSelect && (
          <div className={cn("mt-1", selected ? "text-emerald-700" : "text-primary")}>
            {selected ? "已定位轨迹" : "点击定位轨迹"}
          </div>
        )}
      </div>
    </>
  )
  if (canSelect) {
    return (
      <button
        type="button"
        onClick={() => context?.sourceTrajectoryId && onSelectTrajectory?.(context.sourceTrajectoryId, context)}
        aria-pressed={selected}
        aria-label={`定位刷新候选 ${context?.sourceTrajectoryId}`}
        className={cn(
          "grid w-full gap-2 px-2 py-2 text-left transition-colors hover:bg-muted/40 sm:grid-cols-[88px_minmax(0,1fr)]",
          selected && "bg-primary/10",
        )}
      >
        {content}
      </button>
    )
  }
  return (
    <div className="grid gap-2 px-2 py-2 sm:grid-cols-[88px_minmax(0,1fr)]">
      {content}
    </div>
  )
}

export function auditContextFromBatchRefreshMovement(
  movement?: AuditBatchRefreshMovement | null,
  sourceTitle = "LoRA-ready 刷新",
): AuditSelectionContext | null {
  if (!movement?.sourceTrajectoryId) return null
  const state = movement.after ?? movement.before ?? null
  return {
    sourceTitle,
    sourceTrajectoryId: movement.sourceTrajectoryId,
    refKind: "adapter_candidate",
    refId: movement.id ?? null,
    bucketId: state?.bucketId ?? null,
    bucketLabel: state?.bucketLabel ?? null,
    sampling: state?.recommendedSampling ?? null,
    effectiveWeightMultiplier: typeof state?.effectiveWeightMultiplier === "number" ? state.effectiveWeightMultiplier : null,
    trainingWeightState: state?.trainingWeightState ?? null,
    adapterCapability: movement.adapterCapability ?? null,
  }
}

function auditBatchRefreshMovementLabel(movement?: string | null) {
  return {
    upweighted: "提权",
    downweighted: "降权",
    rerouted: "改分流",
    moved_in: "新增",
    moved_out: "转出",
    unchanged: "持平",
  }[movement ?? ""] ?? "变化"
}

function auditBatchRefreshMovementTone(movement?: string | null) {
  return {
    upweighted: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700",
    downweighted: "border-amber-500/30 bg-amber-500/10 text-amber-700",
    rerouted: "border-primary/20 bg-primary/10 text-primary",
    moved_in: "border-primary/20 bg-primary/10 text-primary",
    moved_out: "border-amber-500/30 bg-amber-500/10 text-amber-700",
    unchanged: "border-border bg-muted text-muted-foreground",
  }[movement ?? ""] ?? "border-border bg-muted text-muted-foreground"
}

function auditBatchRefreshMovementStateLabel(state?: AuditBatchRefreshMovementState | null) {
  if (!state) return "未进入 LoRA-ready"
  const bucket = state.bucketLabel ?? (state.bucketId ? adapterBatchRecipeBucketLabel(state.bucketId) : "")
  const sampling = samplingLabel(state.recommendedSampling)
  const weight = typeof state.effectiveWeightMultiplier === "number" ? `权重 ${state.effectiveWeightMultiplier.toFixed(1)}x` : ""
  const trainingState = trainingWeightStateLabel(state.trainingWeightState ?? undefined)
  return uniqueTextParts([bucket, sampling, weight, trainingState]).join(" / ") || "未标注权重"
}

function AuditRefreshDiffPanel({
  diff,
  className,
}: {
  diff: AuditRefreshDiff
  className?: string
}) {
  const toneClass = {
    neutral: "border-primary/20 bg-primary/5 text-foreground",
    good: "border-emerald-500/30 bg-emerald-500/10 text-emerald-800",
    warn: "border-amber-500/30 bg-amber-500/10 text-amber-800",
    danger: "border-destructive/30 bg-destructive/10 text-destructive",
  }[diff.tone]
  return (
    <div className={cn("rounded-md border px-2 py-1.5 text-xs", toneClass, className)}>
      <div className="font-medium">{diff.headline}</div>
      <div className="mt-2 grid gap-1 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center">
        <span className="min-w-0 rounded border bg-background/70 px-1.5 py-0.5 text-muted-foreground">{diff.beforeLabel}</span>
        <span className="hidden text-muted-foreground sm:inline">{"->"}</span>
        <span className="min-w-0 rounded border bg-background/70 px-1.5 py-0.5 text-muted-foreground">{diff.afterLabel}</span>
      </div>
      <div className="mt-2 leading-5 opacity-90">{diff.detail}</div>
    </div>
  )
}

function DetailBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t pt-3">
      <h3 className="mb-2 text-sm font-medium">{title}</h3>
      {children}
    </section>
  )
}

function KeyValue({ label, value, valueClassName }: { label: string; value: string; valueClassName?: string }) {
  if (!value) return null
  return (
    <div className="grid grid-cols-[64px_minmax(0,1fr)] gap-2 py-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("min-w-0 break-words", valueClassName)}>{value}</span>
    </div>
  )
}

function QualityGateCheckList({ checkResults }: { checkResults?: Record<string, boolean> | null }) {
  const entries = qualityGateCheckEntries(checkResults)
  if (entries.length === 0) return null
  return (
    <div className="mt-2 grid gap-1 sm:grid-cols-2">
      {entries.map((entry) => {
        const Icon = entry.passed ? CheckCircle2 : Clock
        return (
          <div
            key={entry.id}
            className={cn(
              "rounded-md border bg-background/70 px-2 py-1.5 text-xs",
              entry.passed ? "border-emerald-500/30 text-emerald-800" : "border-amber-500/30 text-amber-800",
            )}
          >
            <div className="flex items-center gap-1.5 font-medium">
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span>{entry.label}</span>
              <span className="ml-auto rounded border bg-background/80 px-1.5 py-0.5 text-[11px]">
                {entry.passed ? "通过" : "待确认"}
              </span>
            </div>
            <div className="mt-1 leading-5 text-muted-foreground">{entry.detail}</div>
          </div>
        )
      })}
    </div>
  )
}

function PaperTradeAutoEvidenceGatePanel({
  gate,
  forceVisible = false,
}: {
  gate?: PaperTradeAutoEvidenceGate | null
  forceVisible?: boolean
}) {
  if (!gate && !forceVisible) return null
  const summary = summarizePaperTradeAutoEvidenceGate(gate)
  const Icon = summary.tone === "good" ? CheckCircle2 : summary.tone === "danger" ? AlertTriangle : Clock
  const toneClass = {
    neutral: "border-primary/20 bg-primary/5 text-foreground",
    good: "border-emerald-500/30 bg-emerald-500/10 text-emerald-800",
    warn: "border-amber-500/30 bg-amber-500/10 text-amber-800",
    danger: "border-destructive/30 bg-destructive/10 text-destructive",
  }[summary.tone]
  const entryToneClass: Record<PaperTradeAutoEvidenceGateEntry["tone"], string> = {
    neutral: "border-border bg-background/70 text-muted-foreground",
    good: "border-emerald-500/30 bg-background/70 text-emerald-800",
    warn: "border-amber-500/30 bg-background/70 text-amber-800",
    danger: "border-destructive/30 bg-background/70 text-destructive",
  }
  return (
    <div className={cn("mt-2 rounded-md border p-2 text-xs", toneClass)}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1">
            <Icon className="h-3.5 w-3.5 shrink-0" />
            <span className="font-medium">{summary.headline}</span>
            <span className="rounded border bg-background/70 px-1.5 py-0.5 text-muted-foreground">{summary.badge}</span>
          </div>
          <div className="mt-1 leading-5 opacity-90">{summary.detail}</div>
        </div>
        {summary.blocksWrite && (
          <span className="shrink-0 rounded border bg-background/70 px-1.5 py-0.5 text-destructive">
            转补证
          </span>
        )}
      </div>
      {summary.entries.length > 0 && (
        <div className="mt-2 grid gap-1 sm:grid-cols-2">
          {summary.entries.map((entry) => {
            const EntryIcon = entry.passed ? CheckCircle2 : AlertTriangle
            return (
              <div
                key={entry.id}
                className={cn("min-w-0 rounded border px-2 py-1.5", entryToneClass[entry.tone])}
              >
                <div className="flex items-center gap-1.5">
                  <EntryIcon className="h-3.5 w-3.5 shrink-0" />
                  <span className="min-w-0 truncate font-medium" title={entry.label}>{entry.label}</span>
                  <span className="ml-auto rounded border bg-background px-1.5 py-0.5 text-[11px]">
                    {entry.statusLabel}
                  </span>
                </div>
                <div className="mt-1 truncate leading-5 text-muted-foreground" title={entry.detail}>{entry.detail}</div>
              </div>
            )
          })}
        </div>
      )}
      <p className="mt-2 leading-5 text-muted-foreground">
        原始价格、热榜、龙虎榜和交易明细仍留在 retrieval/tool state；这里仅用于人审判断自动证据是否足够。
      </p>
    </div>
  )
}

function PaperTradeStateSummary({
  state,
  profitFeedback,
}: {
  state: NonNullable<StockFeedbackTrajectory["paperTradeState"]>
  profitFeedback?: StockFeedbackTrajectory["profitFeedback"]
}) {
  const marketEvidence = state.marketEvidence
  const evidenceWindow = paperTradeMarketEvidenceWindowDisplay(state.marketEvidenceWindow)
  const microstructure = state.marketMicrostructureEvidence
  const evidenceWindowValueClass = evidenceWindow?.tone === "warn" ? "text-amber-700" : undefined
  return (
    <div className="mt-2 rounded-md border border-primary/20 bg-primary/5 p-2 text-xs">
      <div className="flex flex-wrap items-center gap-1">
        <span className="font-medium text-primary">模拟交易</span>
        <span className="rounded border bg-background/70 px-1.5 py-0.5 text-muted-foreground">
          {paperTradeTrackLabel(state.track)}
        </span>
        <span className="rounded border bg-background/70 px-1.5 py-0.5 text-muted-foreground">
          {paperTradeStatusLabel(state.status)}
        </span>
        <span className="rounded border bg-background/70 px-1.5 py-0.5 text-muted-foreground">
          {state.ledgerKind ?? "paper_trade"}
        </span>
      </div>
      <div className="mt-2 grid gap-1 sm:grid-cols-2">
        <KeyValue label="证据截止" value={state.asOfDate ?? state.evidenceCutoff?.asOfDate ?? ""} />
        <KeyValue label="防后验" value={state.evidenceCutoff?.noFutureData === true ? "noFutureData=true" : ""} />
        <KeyValue label="入场" value={paperTradePointLabel(state.entry)} />
        <KeyValue label="出场" value={paperTradePointLabel(state.exit)} />
        <KeyValue label="收益" value={formatPercent(profitFeedback?.realizedPnlPct)} />
        <KeyValue label="回撤" value={formatPercent(profitFeedback?.maxDrawdownPct)} />
        <KeyValue label="仓位" value={state.positionSizing ?? profitFeedback?.positionSizing ?? ""} />
        <KeyValue label="类别" value={paperTradeExecutionClassLabel(state.executionEvidenceClass ?? profitFeedback?.executionEvidenceClass)} />
        <KeyValue label="行情来源" value={marketEvidence?.source ?? state.marketEvidenceStatus ?? ""} />
        <KeyValue label={evidenceWindow?.label ?? "行情窗口"} value={evidenceWindow?.value ?? ""} valueClassName={evidenceWindowValueClass} />
        <KeyValue label="计划窗口" value={evidenceWindow?.detail ?? ""} />
        <KeyValue label="相对强度" value={formatPercent(marketEvidence?.relativeStrength)} />
        <KeyValue label="基准收益" value={formatPercent(marketEvidence?.benchmarkReturnPct)} />
        <KeyValue label="3日承接" value={formatPercent(marketEvidence?.followThrough3d)} />
        <KeyValue label="换手变化" value={formatCompactNumber(marketEvidence?.turnoverChange)} />
        <KeyValue label="持有期回撤" value={formatPercent(marketEvidence?.maxDrawdownInHolding)} />
        <KeyValue label="涨停打开" value={formatCompactNumber(microstructure?.limit?.openTimes)} />
        <KeyValue label="连板高度" value={formatCompactNumber(microstructure?.limitStep?.consecutiveBoards)} />
        <KeyValue label="THS热度" value={formatCompactNumber(microstructure?.heat?.thsRank)} />
        <KeyValue label="东财热度" value={formatCompactNumber(microstructure?.heat?.dcRank)} />
        <KeyValue label="热度概念" value={microstructure?.heat?.thsConcept ?? ""} />
        <KeyValue label="龙虎榜净额" value={formatCompactNumber(microstructure?.dragonTiger?.netAmount)} />
        <KeyValue label="机构净额" value={formatCompactNumber(microstructure?.institution?.netAmount)} />
        <KeyValue label="游资净额" value={formatCompactNumber(microstructure?.hotMoney?.netAmount)} />
      </div>
      {state.marketEvidenceWarning && (
        <p className="mt-2 leading-5 text-amber-700">
          {state.marketEvidenceWarning}
        </p>
      )}
      {state.microstructureEvidenceWarning && (
        <p className="mt-2 leading-5 text-amber-700">
          {state.microstructureEvidenceWarning}
        </p>
      )}
      <p className="mt-2 leading-5 text-muted-foreground">
        模拟收益可进入 eval 或低权重 adapter 候选池，但不等同真实盈利样本；事实、价格和交易明细仍留在 sourceRefs / tool state。
      </p>
    </div>
  )
}

function StatusPanel({ title, value, detail }: { title: string; value: number; detail: string }) {
  return (
    <div className="rounded-md border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-lg font-semibold tabular-nums">{value}</span>
      </div>
      <div className="mt-1 truncate text-xs text-muted-foreground" title={detail}>{detail}</div>
    </div>
  )
}

function resultDetail(result: CommandResult) {
  if (result.reviewEvent) return `review=${result.reviewEvent.action ?? "unknown"} · ${result.reviewEvent.result ?? "recorded"}`
  if (result.draft) return `${result.dryRun ? "采集单预览" : "采集单写入"} · ${result.draft.targetPatternLabel ?? result.draft.targetPatternId ?? result.draft.targetProfitCreditLabel ?? profitCreditBucketLabel(result.draft.targetProfitCredit)}`
  if (result.collectionResult) return `补样本=${result.collectionResult.resultLabel ?? result.collectionResult.result ?? "recorded"} · ${result.collectionResult.targetPatternLabel ?? result.collectionResult.targetPatternId ?? result.collectionResult.targetProfitCreditLabel ?? profitCreditBucketLabel(result.collectionResult.targetProfitCredit) ?? "collection"}`
  if (result.paperTrade) return `模拟交易=${paperTradeStatusLabel(result.paperTrade.status)} · ${paperTradeTrackLabel(result.paperTrade.track)} · ${formatPercent(result.paperTrade.profitFeedback?.realizedPnlPct) || "待结算"}`
  if (result.schema === "stock-feedback-paper-trade-discretionary-review-result-v1") {
    const summary = result.summary ?? {}
    return `LLM复盘草案 ${result.count ?? summary.totalDrafts ?? 0} · 跑赢 ${summary.llmOutperformed ?? 0} · 跑输 ${summary.llmUnderperformed ?? 0} · 负样本 ${summary.negativeRoutes ?? 0}`
  }
  if (result.dynamicTestSet) return benchmarkDetail(result.dynamicTestSet)
  if (result.adapterCurriculum) return loraReadyDetail(result.adapterCurriculum)
  if (result.status) return `status=${result.status} · issues=${result.issueCount ?? 0}`
  if (result.dryRun) return `dry-run · count=${result.count ?? 0}`
  return `write · count=${result.count ?? 0}`
}
