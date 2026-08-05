export interface SourcePreview {
  meta: string
  body: string
  refLabel: string
}

export type SignalSourcePresetId = "wechat" | "research-news" | "gangtise-themes"

export interface SignalSourcePreset {
  id: SignalSourcePresetId
  label: string
  source: string
  detail: string
  badge: string
}

export interface SelectedSignalSourceBrief {
  label: string
  badge: string
  detail: string
  sourceLine: string
  tone: "wechat" | "research" | "theme" | "custom"
}

export interface SignalSourceListRun {
  sourcePath?: unknown
  sourceMissing?: unknown
  defaultSourceRef?: unknown
  sources?: unknown
  summary?: unknown
}

export function buildDefaultSignalSourcePresets(): SignalSourcePreset[] {
  return [
    {
      id: "wechat",
      label: "微信聊天",
      source: "raw/微信聊天",
      detail: "高噪声舆情、新催化和新说法，只用于提醒和更新已有假设状态。",
      badge: "状态更新",
    },
    {
      id: "research-news",
      label: "研报新闻",
      source: "raw/研报新闻",
      detail: "研报、公众号和新闻原文，用来补新催化、逻辑链、卖方表达、产业叙事和候选公司。",
      badge: "催化发现",
    },
    {
      id: "gangtise-themes",
      label: "产业链复盘",
      source: "raw/openclaw数据/产业链复盘/gangtise_themes",
      detail: "Gangtise 主题复盘，用来做链条验证，并跟踪细分环节、订单、客户、ASP、交付和收入兑现。",
      badge: "链条验证",
    },
  ]
}

export function resolveSignalSourceCandidateRoot(
  currentSource: unknown,
  presets: SignalSourcePreset[] = buildDefaultSignalSourcePresets(),
) {
  const fallback = "raw/微信聊天"
  const source = textValue(currentSource).trim().replace(/\\/g, "/")
  if (!source) return fallback

  for (const preset of presets) {
    const presetSource = preset.source.replace(/\\/g, "/")
    if (
      source === presetSource
      || source.startsWith(`${presetSource}/`)
      || source.endsWith(`/${presetSource}`)
      || source.includes(`/${presetSource}/`)
    ) {
      return preset.source
    }
  }

  return source
}

export function isSignalSourcePresetActive(
  currentSource: unknown,
  preset: SignalSourcePreset,
  presets: SignalSourcePreset[] = buildDefaultSignalSourcePresets(),
) {
  return resolveSignalSourceCandidateRoot(currentSource, presets) === preset.source
}

export function buildSelectedSignalSourceBrief({
  currentSource,
  selectedSource,
  presets = buildDefaultSignalSourcePresets(),
}: {
  currentSource?: unknown
  selectedSource?: unknown
  presets?: SignalSourcePreset[]
}): SelectedSignalSourceBrief {
  const sourceRecord = unknownRecord(selectedSource)
  const source = firstFilled(sourceRecord.sourceRef, sourceRecord.sourcePath, currentSource)
  const sourceText = compactDisplayText(source, "未选择资料源", 260)
  const root = resolveSignalSourceCandidateRoot(sourceText, presets)
  const preset = presets.find((item) => item.source === root)
  if (preset) {
    const toneById: Record<SignalSourcePresetId, SelectedSignalSourceBrief["tone"]> = {
      wechat: "wechat",
      "research-news": "research",
      "gangtise-themes": "theme",
    }
    return {
      label: preset.label,
      badge: preset.badge,
      detail: preset.detail,
      sourceLine: sourceRefLabel(sourceText),
      tone: toneById[preset.id],
    }
  }
  const sourceKindLabel = compactDisplayText(sourceRecord.sourceKindLabel, "", 40)
  return {
    label: sourceKindLabel || "自定义资料源",
    badge: "自定义",
    detail: "按新增资料处理；系统会导入、去重并尝试路由到已有假设，不自动确认状态。",
    sourceLine: sourceRefLabel(sourceText),
    tone: "custom",
  }
}

export function mergeSignalSourceListRuns(
  runs: SignalSourceListRun[],
  options: { preferredSource?: unknown } = {},
) {
  const preferredSource = textValue(options.preferredSource)
  const mergedSources: Array<Record<string, unknown>> = []
  const seen = new Set<string>()
  let sourcesScanned = 0
  let todayFound = false
  let anySourceExists = false
  for (const run of runs) {
    const summary = unknownRecord(run.summary)
    const runSources = arrayRecords(run.sources)
    sourcesScanned += Math.max(0, numberValue(summary.sourcesScanned))
    todayFound = todayFound || Boolean(summary.todayFound)
    anySourceExists = anySourceExists || run.sourceMissing === false || runSources.length > 0
    for (const source of runSources) {
      const key = textValue(source.sourceRef) || textValue(source.sourcePath)
      if (!key || seen.has(key)) continue
      seen.add(key)
      mergedSources.push(source)
    }
  }
  const preferredIndex = mergedSources.findIndex((source) => (
    preferredSource
      && (textValue(source.sourceRef) === preferredSource || textValue(source.sourcePath) === preferredSource)
  ))
  const freshestIndex = freshestSignalSourceIndex(mergedSources)
  const selectedCandidateIndex = mergedSources.findIndex((source) => Boolean(source.isSelectedCandidate))
  const defaultIndex = preferredIndex >= 0
    ? preferredIndex
    : freshestIndex >= 0
      ? freshestIndex
      : selectedCandidateIndex >= 0
        ? selectedCandidateIndex
        : 0
  const sources: Array<Record<string, unknown>> = mergedSources.map((source, index) => ({
    ...source,
    isSelectedCandidate: index === defaultIndex,
  }))
  const defaultSource = sources[defaultIndex] ?? null
  return {
    sourcePath: runs.map((run) => textValue(run.sourcePath)).filter(Boolean).join(","),
    sourceMissing: runs.length > 0 ? !anySourceExists : true,
    defaultSourceRef: defaultSource ? textValue(defaultSource.sourceRef, textValue(defaultSource.sourcePath, "")) : null,
    sources,
    summary: {
      sourcesScanned,
      sourcesReturned: sources.length,
      todayFound,
    },
  }
}

function freshestSignalSourceIndex(sources: Array<Record<string, unknown>>) {
  let bestIndex = -1
  let bestRank: [number, number, number] | null = null
  sources.forEach((source, index) => {
    const mtime = Date.parse(textValue(source.mtime))
    const rank: [number, number, number] = [
      Boolean(source.isToday) ? 1 : 0,
      Number.isFinite(mtime) ? mtime : 0,
      Boolean(source.isSelectedCandidate) ? 1 : 0,
    ]
    if (!bestRank || compareSignalSourceRank(rank, bestRank) > 0) {
      bestIndex = index
      bestRank = rank
    }
  })
  return bestIndex
}

function compareSignalSourceRank(left: [number, number, number], right: [number, number, number]) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index]
  }
  return 0
}

export interface PendingSignalPriorityInput {
  canConfirm?: boolean
  askDeepDiveRecommended?: boolean
  evidenceDelta?: unknown
  signalType?: unknown
  priorityScore?: unknown
  clusterSourceCount?: unknown
  relatedWikiCount?: unknown
  relatedWikiPages?: unknown
  financeEntityRecords?: unknown
}

export interface AskDeepDiveSummary {
  stocks: string
  directBeneficiary: string
  ranking: string
  stage: string
  gap: string
  conclusion: string
  nextAction: string
}

export interface AskDecisionSnapshot {
  tone: "actionable" | "verify" | "blocked"
  headline: string
  primaryAction: string
  focus: string
  risk: string
  evidenceState: string
}

export interface AskEvidenceStrength {
  tone: "ready" | "verify" | "weak"
  headline: string
  detail: string
  rankingState: string
  sourceState: string
  nextAction: string
  badges: Array<{ label: string; tone: "source" | "stock" | "gap" | "ready" }>
}

export interface AskResearchTicket {
  tone: "ready" | "verify" | "weak"
  label: string
  headline: string
  focus: string
  risk: string
  nextAction: string
  primaryActionLabel: string
  secondaryActionLabel: string
  guardrail: string
  badges: Array<{ label: string; tone: "source" | "stock" | "gap" | "ready" }>
}

export interface AskFollowUpAction {
  show: boolean
  tone: "weak" | "verify"
  headline: string
  detail: string
  prompt: string
  primaryLabel: string
  retryLabel: string
  retryEnabled: boolean
}

export interface AskStructureFeedback {
  show: boolean
  kind: "source_only" | "missing_stocks" | "partial_summary" | "ready"
  headline: string
  detail: string
  next: string
  tone: "warning" | "review" | "ready"
}

export interface AskSummaryTileValues {
  stocks: string
  directBeneficiary: string
  ranking: string
  stage: string
  gap: string
  conclusion: string
}

export interface AskSourceSnapshotItem {
  label: string
  detail: string
  sourceLine: string
}

export interface AskSourceSnapshotGroup {
  id: "wiki" | "raw" | "facts" | "brain" | "navigation" | "stockDaily"
  label: string
  count: number
  items: AskSourceSnapshotItem[]
  emptyText: string
}

export interface AskSourceSnapshot {
  show: boolean
  headline: string
  detail: string
  nextAction: string
  queryLine: string
  groups: AskSourceSnapshotGroup[]
}

export interface HypothesisTimelineItem {
  key: string
  kind: "event" | "alert" | "signal"
  badge: string
  transition: string
  detail: string
  excerpt: string
  sourceLabel: string
  sourceTypeLabel: string
  signalStrengthLabel: string
  sourceTitle: string
  askRunRef?: string
  mergedCount: number
  createdAt: string
  tone: "hot" | "support" | "market" | "risk" | "watch"
}

export interface HypothesisTimelineBrief {
  show: boolean
  title: string
  statusLabel: string
  headline: string
  detail: string
  trajectoryLine: string
  nextAction: string
  itemCount: number
  latest: HypothesisTimelineItem | null
  items: HypothesisTimelineItem[]
  tone: "hot" | "support" | "market" | "risk" | "watch" | "empty"
}

export interface HypothesisQualityBrief {
  tone: "ready" | "needs_work"
  label: string
  headline: string
  detail: string
  nextAction: string
  missingLabels: string[]
}

export interface HypothesisGranularityGate {
  passes: boolean
  reason: "mid_level_mechanism" | "too_broad" | "too_narrow" | "insufficient_structure"
  bucket: "primary" | "needs_definition" | "event_only" | "rejected"
  score: number
  matchedParts: string[]
  headline: string
  detail: string
  nextAction: string
}

export interface HypothesisDefinitionDraft {
  title: string
  kind: string
  sourceRefs: string
  body: string
  selectedSourceIds: string[]
  missingLabels: string[]
}

export interface AskPendingSkeletonTile {
  id: "stocks" | "beneficiary" | "ranking" | "answer"
  label: string
  placeholder: string
  detail: string
}

export interface AskResultMiniIndexItem {
  id: "summary" | "stocks" | "ranking" | "answer" | "sources"
  label: string
  detail: string
  available: boolean
  tone: "ready" | "pending" | "warning"
}

export interface AskResultReadingGuideStep {
  target: AskResultMiniIndexItem["id"]
  label: string
  detail: string
  tone: "primary" | "normal" | "warning" | "pending"
}

export interface AskResultReadingGuide {
  headline: string
  detail: string
  primaryTarget: AskResultMiniIndexItem["id"] | null
  primaryLabel: string
  guardrail: string
  steps: AskResultReadingGuideStep[]
  tone: "running" | "ready" | "warning" | "source_only"
}

export interface AskLiveTaskTicketStep {
  id: "wiki" | "raw" | "stock" | "agent"
  label: string
  detail: string
  status: "running" | "done" | "pending" | "warning"
}

export interface AskLiveTaskTicket {
  headline: string
  detail: string
  tone: "running" | "done" | "warning"
  steps: AskLiveTaskTicketStep[]
}

export interface AskObservationChecklistItem {
  label: string
  value: string
  tone: "stock" | "rank" | "action" | "gap" | "status"
}

export interface AskObservationChecklist {
  show: boolean
  headline: string
  detail: string
  items: AskObservationChecklistItem[]
  nextAction: string
  copyText: string
}

export interface AskObservationActionCopy {
  show: boolean
  tone: "ready" | "queued" | "saved" | "blocked"
  headline: string
  detail: string
  primaryLabel: string
  secondaryLabel: string
  statusLabel: string
  primaryAction: "queue" | "save" | "none"
  canPrimary: boolean
  canCopy: boolean
  savedPath: string
}

export interface AskResultActionGuide {
  show: boolean
  tone: "ready" | "queued" | "saved" | "verify" | "blocked"
  headline: string
  detail: string
  primaryLabel: string
  primaryTarget: "observation" | "followup" | "answer" | "sources"
  secondary: string
}

export interface ObservationQueueDraft {
  key: string
  hypothesisId: string
  title: string
  stocks: string
  ranking: string
  gap: string
  wikiFrameLabel: string
  wikiFrameSourceRef: string
  wikiFrameMetaLine: string
  sourceRefs: string[]
  askQuery: string
  status: "待跟踪"
  nextAction: string
  copyText: string
  createdAt: string
}

export interface ObservationQueueTableRow {
  key: string
  title: string
  stockLine: string
  focusStock: string
  rankingLine: string
  riskLine: string
  validationAction: string
  nextAction: string
  reviewWindow: string
  sourceLine: string
  createdAt: string
  statusLabel: string
  tone: "queued" | "saving" | "saved"
  savedPath: string
  canSave: boolean
}

export interface ObservationReviewBriefItem {
  key: string
  title: string
  stockLine: string
  reviewWindow: string
  nextAction: string
  openPath: string
}

export interface ObservationReviewBrief {
  show: boolean
  count: number
  totalCount: number
  label: string
  headline: string
  detail: string
  primaryTitle: string
  primaryStocks: string
  primaryPath: string
  reviewWindow: string
  tone: "review" | "action"
  items: ObservationReviewBriefItem[]
}

export interface AskResultPanelCopy {
  badge: string
  title: string
  detail: string
  steps: AskRunProgressStep[]
  tone: "running" | "done" | "warning"
}

export interface AskAnswerPanelCopy {
  badge: string
  title: string
  detail: string
  summaryLabel: string
  emptyText: string
  openByDefault: boolean
  tone: "done" | "warning" | "running"
}

export type AskRunProgressStepStatus = "done" | "running" | "pending" | "warning"

export interface AskRunProgressStep {
  id: "retrieval" | "summary" | "result"
  label: string
  detail: string
  status: AskRunProgressStepStatus
}

export interface AskResultJumpCopy {
  label: string
  detail: string
  buttonLabel: string
  tone: "running" | "done" | "warning"
}

export interface AskResultReuseCopy {
  show: boolean
  label: string
  detail: string
  actionLabel: string
  tone: "cached" | "fresh"
}

export interface AskResultLocatorCopy {
  label: string
  detail: string
  nextAction: string
  tone: "running" | "done" | "warning" | "cached"
}

export interface AskResultLocatedNoticeCopy {
  show: boolean
  label: string
  detail: string
  tone: "running" | "done" | "warning" | "cached"
}

export interface AskResultOriginCopy {
  show: boolean
  label: string
  title: string
  signalLine: string
  sourceLine: string
  detail: string
  guardrail: string
  tone: "tracked" | "candidate" | "manual"
}

export interface AskCacheStatusCopy {
  show: boolean
  badgeLabel: string
  helper: string
  actionLabel: string
  actionTitle: string
  cardHintLabel: string
  cardHintDetail: string
  cardHintAction: string
  tone: "cached" | "fresh"
}

export interface AskPendingVisibilityInput {
  optimisticPending?: unknown
  hasRunningAskAction?: unknown
  running?: unknown
  runningStageId?: unknown
  pendingTitle?: unknown
  hasResult?: unknown
}

export interface HypothesisAskQueryContext {
  relatedWikiCount?: unknown
  relatedWikiPages?: unknown
  sourceExcerpt?: unknown
  sourceRef?: unknown
  tradingImplication?: unknown
  evidenceDelta?: unknown
  signalType?: unknown
}

export interface CandidateAskPrecheckContext {
  title?: unknown
  theme?: unknown
  segments?: unknown
  timeHorizon?: unknown
  signalType?: unknown
  evidenceDelta?: unknown
  tradingImplication?: unknown
  reason?: unknown
  sourceExcerpt?: unknown
  sourceRef?: unknown
  relatedWikiCount?: unknown
}

export interface CandidatePrecheckAdoptionCopy {
  subtitle: string
  canAdopt: boolean
  canScan: boolean
  adoptedLabel: string
  detail: string
}

export interface ProgressStageInput {
  id: string
  label: string
  status: "pending" | "running" | "done" | "error"
  detail?: string
}

export interface ScanProgressSummary {
  currentStep: number
  totalSteps: number
  percent: number
  label: string
  detail: string
  phaseLabel: string
  phaseHint: string
  canActBeforeDone: boolean
  tone: "idle" | "running" | "done" | "error"
}

export interface TradingDeskScanBrief {
  label: string
  headline: string
  detail: string
  jumpLabel: string
  tone: "running" | "action" | "review" | "quiet" | "idle"
}

export interface TradingDeskScanBriefInput {
  running?: boolean
  runningStageLabel?: unknown
  runningStageDetail?: unknown
  latestLogLabel?: unknown
  latestLogDetail?: unknown
  selectedTitle?: unknown
  sourceCount?: unknown
  newMessageCount?: unknown
  matchedCount?: unknown
  pendingCount?: unknown
  confirmableCount?: unknown
  askRecommendedCount?: unknown
  candidateCount?: unknown
  nextAction?: unknown
  pmOpeningBrief?: PmOpeningBrief | null
}

export interface ScanScopeSummary {
  label: string
  detail: string
  tone: "all" | "scoped"
}

export interface ScanModeSummary {
  label: string
  shortLabel: string
  buttonLabel: string
  detail: string
  tone: "manual-ai" | "auto-rules"
}

export interface ScanKeyInput {
  rawChatSource?: unknown
  since?: unknown
  hypothesisId?: unknown
}

export interface RelatedWikiEmptyHint {
  label: string
  detail: string
}

export interface HypothesisAskActionLabel {
  label: string
  title: string
}

export interface ReviewModeSummary {
  label: string
  detail: string
  nextAction: string
  tone: "rules" | "pending" | "llm" | "error"
  canReviewWithLlm: boolean
}

export interface ReviewModeActionInput {
  hasSignals?: boolean
  running?: boolean
  tone?: ReviewModeSummary["tone"]
  canReviewWithLlm?: boolean
}

export interface EffectiveLlmReviewMode {
  mode: "off" | "auto" | "force"
  skipped: boolean
  reason: string
  detail: string
}

export interface WatchReviewPass {
  mode: "off" | "auto" | "force"
  phase: "rules" | "llm"
  label: string
}

export interface LlmReviewAfterRulesInput {
  reviewMode?: unknown
  eventCount?: unknown
  candidateCount?: unknown
}

export interface PmDecisionQueueSummary {
  tone: "idle" | "action" | "review" | "quiet"
  primaryActionKind: "scan" | "confirm" | "ask" | "create" | "none"
  headline: string
  detail: string
  frameLine: string
  targetTitle: string
  primaryAction: string
  secondary: string
}

export type SignalWorkSectionId = "confirm" | "counter" | "hard" | "market" | "catalyst" | "candidate" | "quiet"

export interface SignalWorkSectionInput {
  kind: "tracked" | "candidate"
  canConfirm?: boolean
  askDeepDiveRecommended?: boolean
  evidenceDelta?: unknown
  signalType?: unknown
}

export interface SignalWorkSectionHeader {
  id: SignalWorkSectionId
  label: string
  countLabel: string
  detail: string
  tone: "action" | "danger" | "strong" | "warn" | "review" | "quiet"
}

export interface SignalRunDigestInput {
  totalCount: number
  rawSignalCount: number
  confirmableCount: number
  askRecommendedCount: number
  catalystCount: number
  hardEvidenceCount: number
  counterCount: number
  marketFeedbackCount: number
  candidateCount: number
  quietCount: number
}

export interface SignalRunDigest {
  tone: "idle" | "action" | "review" | "quiet"
  headline: string
  detail: string
  badges: Array<{ label: string; value: number; tone?: "default" | "strong" | "warn" | "danger" }>
}

export interface SignalRunDigestAction {
  kind: PmDecisionQueueSummary["primaryActionKind"]
  label: string
  secondary: string
  variant: "default" | "outline"
  ariaLabel: string
}

export interface SignalRunDecisionCopy {
  headline: string
  detail: string
  supporting: string
  decisionParts: Array<{ label: string; value: string }>
}

export interface SignalScanContextCopy {
  show: boolean
  label: string
  detail: string
  expandedDetail?: string
  tone: "idle" | "light" | "framework" | "finance"
  badges: Array<{ label: string; title?: string; tone?: "default" | "finance" | "wiki" }>
}

export interface PmFocusBrief {
  label: string
  headline: string
  targetLabel: string
  targetTitle: string
  detail: string
  framework: string
  operatorHint: string
  locatorHint: string
  primaryOutcome: string
  guardrail: string
  tone: "idle" | "action" | "review" | "quiet"
}

export interface PmOpeningBrief {
  label: string
  headline: string
  detail: string
  actionLabel: string
  framework: string
  tone: "idle" | "action" | "review" | "quiet"
}

export interface SignalQueueDecisionItem {
  key?: unknown
  kind: "tracked" | "candidate"
  title?: unknown
  createdAt?: unknown
  score?: unknown
  priority?: unknown
  canConfirm?: unknown
  askDeepDiveRecommended?: unknown
  evidenceDelta?: unknown
  signalType?: unknown
  sourceCount?: unknown
  relatedWikiPages?: unknown
  financeEntityRecords?: unknown
}

export interface SignalLayerBrief {
  level: "L0" | "L1" | "L2" | "L3"
  label: "新催化" | "二次确认" | "市场反馈" | "硬证据" | "风险信号"
  detail: string
  conservativeStatusHint: string
  tone: "catalyst" | "confirm" | "market" | "evidence" | "risk"
}

export interface SignalQueueDecisionViewModel {
  totalCount: number
  rawSignalCount: number
  priorityCount: number
  quietCount: number
  confirmableCount: number
  askRecommendedCount: number
  trackedReviewCount: number
  candidateAskRecommendedCount: number
  candidateCount: number
  catalystCount: number
  hardEvidenceCount: number
  counterCount: number
  marketFeedbackCount: number
  digest: SignalRunDigest
  queueSummary: PmDecisionQueueSummary
  focusBrief: PmFocusBrief
  openingBrief: PmOpeningBrief
}

export interface AlphaFeedSummaryBadge {
  label: "今日优先" | "需要 Ask" | "建议确认" | "已折叠噪声"
  value: number
  tone: "action" | "ask" | "confirm" | "quiet"
}

export interface AlphaFeedSummary {
  title: string
  subtitle: string
  visibleLimit: number
  priorityVisibleCount: number
  todayPriorityCount: number
  askCount: number
  confirmCount: number
  foldedNoiseCount: number
  foldedOverflowCount: number
  totalFoldedCount: number
  hasPriority: boolean
  badges: AlphaFeedSummaryBadge[]
  emptyTitle: string
  emptyDetail: string
}

export interface EmptySignalTodoHint {
  title: string
  detail: string
  nextAction: string
  tone: "running" | "no-source" | "no-match" | "idle"
  primaryActionKind: "none" | "scan" | "expand-window" | "discover"
  primaryActionLabel: string
}

export interface SignalFocusBucketsInput {
  confirmableCount: number
  counterCount: number
  hardEvidenceCount: number
  marketFeedbackCount: number
  catalystCount: number
  candidateCount: number
  quietCount: number
}

export interface SignalFocusBucket {
  id: "confirm" | "counter" | "hard" | "market" | "catalyst" | "candidate" | "quiet"
  label: string
  value: number
  tone: "action" | "danger" | "strong" | "warn" | "review" | "quiet"
  guidance: string
}

export interface PmSignalTriageInput {
  confirmableCount?: unknown
  counterCount?: unknown
  hardEvidenceCount?: unknown
  marketFeedbackCount?: unknown
  askRecommendedCount?: unknown
  catalystCount?: unknown
  candidateCount?: unknown
  quietCount?: unknown
}

export type PmSignalTriageBucketId = "now" | "watch" | "noise"

export interface PmSignalTriageBucket {
  id: PmSignalTriageBucketId
  label: string
  value: number
  tone: "action" | "review" | "quiet"
  active: boolean
  detail: string
  nextAction: string
}

export interface PmSignalTriageBucketRouteInput {
  kind?: "tracked" | "candidate"
  canConfirm?: boolean
  askDeepDiveRecommended?: boolean
  evidenceDelta?: unknown
  signalType?: unknown
}

export interface WikiFrameCluster {
  key: string
  label: string
  detail: string
  sourceRef: string
  count: number
  tone: "hot" | "active" | "default" | "stale"
}

export interface QuietSignalsSummaryInput {
  quietTrackedCount: number
  quietCandidateCount: number
  quietRawSignalCount: number
  hiddenCount: number
  hasPriority?: boolean
  showQuietSignals: boolean
}

export interface QuietSignalVisibility {
  showQuietSignals: boolean
  showSummary: boolean
  reason: "expanded" | "mixed-priority" | "quiet-only" | "none"
}

export interface QuietSignalSummaryPlacement {
  position: "before-list" | "after-list" | "none"
}

export interface QuietSignalsSummary {
  headline: string
  detail: string
  decisionLabel: string
  nextAction: string
  badges: Array<{ label: string; value: number }>
  toggleLabel: string
}

export interface PendingCountLabelInput {
  totalCount: number
  priorityCount: number
  quietCount: number
  rawSignalCount: number
}

export interface RelatedWikiSummary {
  label: string
  tone: "support" | "catalyst" | "market" | "counter" | "narrative" | "relevant"
  count: number
  countText: string
  topTerms: string
  summary: string
}

export interface WikiMetaBadge {
  label: string
  title: string
  tone: "default" | "active" | "confidence" | "hot" | "source" | "catalyst" | "updated"
}

export interface WikiFrameMatchField {
  label: string
  terms: string[]
  tone: "tag" | "alias" | "catalyst" | "related" | "source" | "match"
}

export interface WikiFrameMatchExplanation {
  show: boolean
  headline: string
  detail: string
  fields: WikiFrameMatchField[]
}

export interface WikiFrameDecisionLineInput {
  pages?: unknown
  evidenceDelta?: unknown
  signalType?: unknown
  askDeepDiveRecommended?: boolean
}

export interface WikiFrameDecisionLine {
  show: boolean
  headline: string
  detail: string
  next: string
  tone: "hot" | "active" | "default" | "stale"
  badges: WikiMetaBadge[]
  match: WikiFrameMatchExplanation
}

export interface WikiFrameFirstLookCopy {
  show: boolean
  label: string
  detail: string
  next: string
  tone: WikiFrameDecisionLine["tone"]
}

export interface AskWikiFrameHintSource {
  label: string
  sourceRef: string
  metaLine: string
}

export interface AskWikiFrameHint {
  show: boolean
  headline: string
  detail: string
  next: string
  tone: "structured" | "stale" | "plain"
  sources: AskWikiFrameHintSource[]
}

export interface HypothesisWorkPriorityInput {
  status?: unknown
  suggestedStatus?: unknown
  evidenceDelta?: unknown
  signalType?: unknown
  askDeepDiveRecommended?: boolean
  relatedWikiPages?: unknown
}

export interface HypothesisWorkPriority {
  tier: "today" | "ask" | "watch" | "quiet"
  label: string
  reason: string
  score: number
}

export type HypothesisSignalById = Record<string, Record<string, unknown>>

export interface SignalDecisionSummaryInput {
  kind: "tracked" | "candidate"
  canConfirm?: boolean
  askDeepDiveRecommended?: boolean
  currentStatus?: unknown
  suggestedStatus?: unknown
  evidenceDelta?: unknown
  signalType?: unknown
  relatedWikiCount?: unknown
  relatedWikiPages?: unknown
  financeEntityRecords?: unknown
  clusterSourceCount?: unknown
  priorityReasons?: unknown
}

export interface SignalDecisionSummary {
  headline: string
  why: string
  next: string
  tone: "confirm" | "ask" | "support" | "catalyst" | "market" | "counter" | "candidate" | "quiet"
}

export interface SignalCardDecisionCopy {
  decision: string
  reason: string
  whyImportant: string
  affects: string
  nextAction: string
  tone: SignalDecisionSummary["tone"]
}

export interface SignalCardRankReasonInput extends SignalDecisionSummaryInput {
  sourceCount?: unknown
}

export interface SignalCardRankReason {
  show: boolean
  label: string
  detail: string
  tone: SignalDecisionSummary["tone"]
}

export interface SignalCardTradingBriefInput extends SignalCardRankReasonInput {
  title?: unknown
  financeEntityRecords?: unknown
}

export interface SignalCardTradingBrief {
  label: string
  headline: string
  detail: string
  action: string
  tone: SignalDecisionSummary["tone"]
}

export interface SignalCardPmActionLine {
  show: boolean
  lead: string
  impact: string
  action: string
  guardrail: string
  tone: SignalDecisionSummary["tone"]
}

export interface SignalCardQuestionChecklistInput extends SignalCardTradingBriefInput {
  title?: unknown
  reason?: unknown
  sourceExcerpt?: unknown
  sourceRef?: unknown
  sourceKindLabel?: unknown
  tradingImplication?: unknown
}

export interface SignalCardQuestionChecklistItem {
  key: "signal" | "hypothesis" | "status" | "reason" | "implication" | "next"
  label: string
  value: string
  tone: "source" | "hypothesis" | "status" | "reason" | "trade" | "action"
}

export interface SignalCardQuestionChecklist {
  show: boolean
  title: string
  headline: string
  detail: string
  primaryAction: string
  guardrail: string
  tone: SignalDecisionSummary["tone"]
  items: SignalCardQuestionChecklistItem[]
}

export interface SignalCardSurfacePolicy {
  showPmActionLine: boolean
  showQuestionChecklist: boolean
  showDecisionBlock: boolean
  showTradeLine: boolean
  detail: string
}

export interface SignalEvidenceToggleCopy {
  label: string
  detail: string
  title: string
}

export interface SignalInfoFlowCopy {
  source: string
  frame: string
  target: string
  action: string
  detail: string
  tone: SignalDecisionSummary["tone"]
}

export interface IgnoredSignalNoticeCopy {
  title: string
  detail: string
}

export interface StatusUpdateNoticeCopy {
  headline: string
  detail: string
  outcomeLabel: string
  outcomeDetail: string
  transitionLabel: string
  storageLine: string
  askEvidenceLine: string
  nextAction: string
  guardrail: string
  hypothesisPath: string
  eventPath: string
}

export interface SignalCardActionFeedback {
  show: boolean
  action?: SignalCardActionKind
  label: string
  detail: string
  nextAction?: string
  tone: "running" | "done" | "error"
  jumpTargetLabel?: string
}

export interface SignalCardAskResultBackfill {
  show: boolean
  label: string
  headline: string
  detail: string
  stockLine: string
  actionLine: string
  pmActionLabel: string
  pmActionDetail: string
  observationLine: string
  sourceLine: string
  tone: "running" | "ready" | "warning" | "error"
  jumpTargetLabel?: string
}

export interface DailyStatusActionFeedback {
  show: boolean
  label: string
  detail: string
  jumpLabel: string
  tone: "running" | "done" | "error"
}

export type SignalCardActionKind = "confirm" | "ask" | "ignore" | "precheck" | "track"

export interface SignalCardAction {
  kind: SignalCardActionKind
  label: string
  description: string
  variant: "default" | "outline" | "ghost"
  ariaLabel: string
}

export interface SignalCardActionPlan {
  primary: SignalCardAction
  secondary: SignalCardAction[]
}

export interface SignalCardActionButtonState {
  label: string
  busy: boolean
  disabled: boolean
  title: string
  ariaLabel: string
}

export interface SignalCardActionPanelCopy {
  label: string
  actionLine: string
  detail: string
  tone: "action" | "research" | "track" | "quiet"
}

export interface SignalCardSourceCopy {
  badge: string
  excerpt: string
  reason: string
  auditLabel: string
  auditTitle: string
}

export interface SignalCardTradeLineInput {
  tradingImplication?: unknown
  signalType?: unknown
  evidenceDelta?: unknown
  reason?: unknown
}

export interface SignalKeywordLineInput {
  segments?: unknown
  keyVariables?: unknown
  matchedSegments?: unknown
  matchedEntities?: unknown
  catalystTags?: unknown
  relatedWikiPages?: unknown
}

export interface SignalKeywordLine {
  show: boolean
  label: string
  terms: string[]
  layers: Array<{ label: string; terms: string[]; tone: "source" | "wiki" | "finance" }>
  detail: string
  tone: "entity" | "wiki" | "finance" | "weak"
}

export interface SignalFinanceEntityStrip {
  show: boolean
  label: string
  headline: string
  actionLabel: string
  detail: string
  decision: string
  groups: Array<{ label: string; terms: string[]; tone: "issuer" | "industry" | "catalyst" | "risk" | "market" | "context" }>
}

export interface SignalFinanceHeaderCue {
  show: boolean
  label: string
  headline: string
  actionLabel: string
  detail: string
  ariaLabel: string
  chips: Array<{ label: string; value: string; tone: SignalFinanceEntityStrip["groups"][number]["tone"]; title: string }>
}

export interface SignalCardActionInput {
  kind: "tracked" | "candidate"
  canConfirm?: boolean
  canAsk?: boolean
  askDeepDiveRecommended?: boolean
  askCacheStatus?: AskCacheStatusCopy
}

function textValue(value: unknown, fallback = "") {
  if (value == null || value === "") return fallback
  return String(value)
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function compactChineseCount(value: unknown) {
  const count = Math.max(0, numberValue(value))
  if (count >= 10000) {
    const wan = count / 10000
    return `${wan >= 10 ? Math.round(wan) : wan.toFixed(1).replace(/\.0$/, "")}万`
  }
  if (count >= 1000) return `${Math.round(count / 100) / 10}千`
  return count > 0 ? String(count) : ""
}

function compactDisplayText(value: unknown, fallback = "", limit = 320) {
  const text = textValue(value, fallback).replace(/\s+/g, " ").trim()
  if (text.length <= limit) return text
  return `${text.slice(0, limit)}...`
}

export function isSafeObservationDraftPath(value: unknown): value is string {
  const path = typeof value === "string" ? value.trim() : ""
  if (!path.startsWith(".llm-wiki/observation-drafts/")) return false
  if (path.startsWith("/") || path.includes("..") || path.includes("\\")) return false
  return path.endsWith(".md") || path.endsWith(".json")
}

export function readerFacingReason(value: unknown) {
  const text = compactDisplayText(value, "", 240)
  if (!text) return ""
  const labels: Record<string, string> = {
    "new context is not decisive enough to upgrade the hypothesis": "新增信息相关，但还不足以升级假设状态",
    "source adds context but not enough validation evidence": "只是新增上下文，缺少验证证据",
    "source expands narrative but does not close market/fundamental evidence": "叙事在扩散，但还没有市场或基本面闭环",
    "fresh catalyst should enter follow-through tracking before upgrading status": "新催化先进入跟踪，等量价或二次确认后再升级",
    "new context matched an existing hypothesis": "新增信息命中已有假设",
    "narrative expanded without enough validation evidence": "叙事扩散，但验证证据不足",
    "fresh tradable catalyst appeared; track price/volume follow-through before demanding fundamental closure": "出现可交易新催化，先跟踪量价和二次确认",
    "market feedback appeared before fundamental closure; treat as priced-in risk": "市场先反应，注意已定价风险",
    "source contains a fresh tradable catalyst; follow price/volume and second confirmation before upgrading conviction": "出现新催化，先看量价跟随和二次确认",
    "market feedback is visible but fundamental closure is incomplete": "已有市场反馈，但基本面闭环还不完整",
    "source contains order/announcement/financial/customer delivery evidence": "出现订单、公告、财务或客户交付证据",
    "source contains order/customer/delivery/financial validation language": "出现订单、客户、交付或财务验证表述",
    "source contains slowdown/risk/refutation language": "出现放缓、风险或反证表述",
    "source contains both supportive and counterevidence language": "支持和反向信息同时出现，需要拆开复核",
    "hypothesis is being tracked": "假设已在跟踪中，等待新的催化、二次确认或市场反馈",
    "counterevidence or divergence appeared": "出现反证或走势背离，需要先判断是否削弱原假设",
    "counterevidence or divergence": "出现反证或走势背离，需要先判断是否削弱原假设",
    "new catalyst but not enough follow-through": "出现新催化，但还缺少扩散强度、量价反馈或二次确认",
    "new context exists but validation is not decisive": "已有新增上下文，但还不足以改变假设状态",
    "no decisive update": "没有足够强的新变化，继续观察即可",
  }
  const lower = text.toLowerCase()
  if (lower.startsWith("hypothesis is being tracked")) return labels["hypothesis is being tracked"]
  if (lower.startsWith("counterevidence or divergence")) return labels["counterevidence or divergence"]
  if (lower.startsWith("new catalyst but not enough follow-through")) return labels["new catalyst but not enough follow-through"]
  if (lower.startsWith("new context exists but validation is not decisive")) return labels["new context exists but validation is not decisive"]
  if (labels[text]) return labels[text]
  const looksLikeInternalEnglish = /^[a-z][a-z0-9 ,.;:'"()/_-]+$/i.test(text)
    && /(^|\s)(new|source|hypothesis|context|catalyst|market|fundamental|validation|evidence|conviction|llm|review|status|upgrade|follow|through|matched|routes?|signal|candidate)(\s|$)/i.test(text)
  if (looksLikeInternalEnglish) return "新增信息相关，但需要人工复核后再决定是否处理"
  return text
}

const HYPOTHESIS_STATUS_COPY: Record<string, { label: string; body: string }> = {
  seed: { label: "初始观察", body: "只有观察或候选假设" },
  watching: { label: "观察中", body: "已进入跟踪，等待新增信号" },
  strengthening: { label: "证据增强", body: "出现支持性证据或多来源确认" },
  actionable: { label: "接近可下注", body: "需要人工决策仓位、赔率和风险" },
  priced_in: { label: "可能已定价", body: "市场先动，赔率可能被压缩" },
  divergent: { label: "走势背离", body: "价格或证据与原假设不一致" },
  disconfirmed: { label: "被证伪", body: "核心证据失效，需降级或归档" },
  archived: { label: "归档", body: "停止主动跟踪" },
}

export function hypothesisStatusLabel(value: unknown) {
  const status = compactDisplayText(value, "", 40)
  if (!status) return ""
  return HYPOTHESIS_STATUS_COPY[status]?.label ?? status
}

export function hypothesisStatusBody(value: unknown) {
  const status = compactDisplayText(value, "", 40)
  if (!status) return ""
  return HYPOTHESIS_STATUS_COPY[status]?.body ?? "未识别状态，保留原始状态码"
}

export function hypothesisStatusTransitionLabel(currentStatus: unknown, suggestedStatus: unknown) {
  const current = compactDisplayText(currentStatus, "", 40)
  const suggested = compactDisplayText(suggestedStatus, current, 40)
  if (!current && !suggested) return ""
  if (!current || current === suggested) return hypothesisStatusLabel(suggested || current)
  return `${hypothesisStatusLabel(current)} -> ${hypothesisStatusLabel(suggested)}`
}

function unknownRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function arrayRecords(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return []
  return value
    .map(unknownRecord)
    .filter((item) => Object.keys(item).length > 0)
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean)
  if (typeof value === "string") return value.split(/[,\n，、/]+/).map((item) => item.trim()).filter(Boolean)
  return []
}

function firstFilled(...values: unknown[]) {
  for (const value of values) {
    const text = textValue(value, "").trim()
    if (text) return text
  }
  return ""
}

function mergeStringArrays(...values: unknown[]) {
  return [...new Set(values.flatMap((value) => stringList(value)))].slice(0, 12)
}

function mergeRecordArrays(...values: unknown[]) {
  const byKey = new Map<string, Record<string, unknown>>()
  for (const record of values.flatMap(arrayRecords)) {
    const term = textValue(record.term, "")
    const type = textValue(record.type, "")
    const label = textValue(record.label, "")
    const sourceRef = textValue(record.sourceRef, "")
    const key = [term, type, label, sourceRef].filter(Boolean).join("\u0000") || JSON.stringify(record)
    if (!byKey.has(key)) byKey.set(key, record)
  }
  return [...byKey.values()].slice(0, 24)
}

function relatedWikiPathList(value: unknown): string[] {
  const rows = []
  for (const record of arrayRecords(value)) {
    rows.push(record.sourceRef, record.path)
  }
  if (typeof value === "string") {
    rows.push(...value.split(/[,\n，、]+/).map((item) => item.trim()))
  } else {
    rows.push(...stringList(value))
  }
  return [...new Set(rows
    .map((item) => compactDisplayText(item, "", 180))
    .filter((item) => item.includes("wiki/") || item.endsWith(".md")))]
    .slice(0, 8)
}

function inferHypothesisGranularityIssue(hypothesis: Record<string, unknown> = {}) {
  const title = compactDisplayText(hypothesis.title, "", 120)
  const theme = compactDisplayText(hypothesis.theme, "", 80)
  const segments = stringList(hypothesis.segments)
  const keyVariables = stringList(hypothesis.keyVariables)
  const text = [title, theme, ...segments, ...keyVariables].join(" ")
  const coreTitle = title
    .replace(/^(新催化|候选新假设|新增变量|核心变量|催化|发酵\/异动|发酵|异动|待验证|消息|事件)[｜|:：\s-]*/i, "")
    .trim()
  const segmentCount = new Set(segments.map((item) => item.toLowerCase())).size
  const broadCoreTitle = /^(AI算力|AI|PCB|国产替代|半导体|机器人|数据中心|新能源|消费电子|芯片)(继续景气|有投资机会|会受益|景气|机会)?$/i.test(coreTitle)
    || /^(AI算力继续景气|PCB有投资机会|国产替代会受益)$/.test(coreTitle)
    || (/^(AI算力|AI|PCB|国产替代|半导体|机器人|数据中心|新能源|消费电子|芯片)([\s，,、]*(预期差|自主可控|芯片|机会|关注|催化|扩散|受益))*$/i.test(coreTitle) && segmentCount < 2)
  if (broadCoreTitle || (/有投资机会|继续景气|会受益|全面受益/.test(coreTitle || title) && segmentCount < 2)) {
    return "too_broad"
  }

  const narrowSourceOnly = /某微信群|某篇文章|某一天|单一订单|某只股票放量|某股|今天群里|昨日群里|6月\d{1,2}日提到/.test(title)
  const midLevelMechanism = /(?:推动|带动).{0,24}(?:链条|产业链|细分|环节|量价|重估|扩散|弹性|验证链)|(?:提升|改善).{0,24}(?:订单|需求|渗透|弹性|盈利|毛利)|(?:进入).{0,16}(?:量价|重估|验证)|(?:产业化|涨价函|提价函).{0,24}(?:设备|材料|链条|细分|量价|重估)/.test(text)
  if (narrowSourceOnly && !midLevelMechanism) return "too_narrow"
  return ""
}

function hasHypothesisMechanismText(value: string) {
  return /(?:推动|带动|提升|改善|进入|加速|放缓|扩产|涨价函|提价函|订单|交付|验证|扩散|重估|弹性|量价|产业化)/.test(value)
}

function hasTrackableEvidencePath(hypothesis: Record<string, unknown> = {}) {
  return stringList(hypothesis.triggerConditions ?? hypothesis.triggers).length > 0
    || stringList(hypothesis.expectedEvidencePath ?? hypothesis.evidencePath).length > 0
    || stringList(hypothesis.keyVariables).length > 0
    || mergeStringArrays(
      hypothesis.sourceRefs,
      hypothesis.evidenceRefs,
      hypothesis.marketRefs,
      hypothesis.sourceRef,
      hypothesis.discoverySourceRef,
      hypothesis.sourcePath,
      hypothesis.url,
    ).length > 0
    || relatedWikiPathList(hypothesis.relatedWikiPages ?? hypothesis.wikiRefs).length > 0
    || Boolean(firstFilled(hypothesis.evidenceDelta, hypothesis.signalType, hypothesis.tradingImplication, hypothesis.reason))
}

export function buildHypothesisGranularityGate(hypothesis: Record<string, unknown> = {}): HypothesisGranularityGate {
  const title = compactDisplayText(hypothesis.title, "", 120)
  const theme = compactDisplayText(hypothesis.theme, "", 80)
  const segments = stringList(hypothesis.segments)
  const keyVariables = stringList(hypothesis.keyVariables)
  const relatedWikiPages = relatedWikiPathList(hypothesis.relatedWikiPages ?? hypothesis.wikiRefs)
  const financeEntities = financeEntityRecordsForSignal({
    financeEntityRecords: [hypothesis, ...arrayRecords(hypothesis.relatedWikiPages)],
    relatedWikiPages: hypothesis.relatedWikiPages,
  })
  const financeSegments = financeEntities
    .filter((record) => ["product_line", "tech_route", "sector", "theme", "catalyst"].includes(textValue(record.type, "")))
    .map((record) => textValue(record.term, ""))
    .filter(Boolean)
  const allSegments = [...new Set([...segments, ...keyVariables, ...financeSegments]
    .map((item) => compactDisplayText(item, "", 40))
    .filter(Boolean))]
  const text = [title, theme, ...allSegments, compactDisplayText(hypothesis.tradingImplication, "", 120), compactDisplayText(hypothesis.reason, "", 120)].join(" ")
  const explicitIssue = compactDisplayText(unknownRecord(hypothesis.granularity).issue, "", 40)
  const issue = explicitIssue || inferHypothesisGranularityIssue({
    ...hypothesis,
    segments: allSegments,
    keyVariables: [...keyVariables, ...financeSegments],
  })

  const matchedParts: string[] = []
  if (theme || relatedWikiPages.length || financeEntities.some((record) => ["sector", "theme"].includes(textValue(record.type, "")))) {
    matchedParts.push("产业方向")
  }
  if (allSegments.length >= 2 || financeEntities.some((record) => ["product_line", "tech_route"].includes(textValue(record.type, "")))) {
    matchedParts.push("细分环节")
  }
  if (hasHypothesisMechanismText(text)) {
    matchedParts.push("变化机制")
  }
  if (hasTrackableEvidencePath(hypothesis)) {
    matchedParts.push("可跟踪证据")
  }

  if (issue === "too_broad") {
    return {
      passes: false,
      reason: "too_broad",
      bucket: "rejected",
      score: matchedParts.length,
      matchedParts,
      headline: "太宽：更像主题入口，不是可跟踪假设",
      detail: "需要补到细分环节、变化机制和证据路径后再进入主候选。",
      nextAction: "折叠到低优先级；让 AI 重新收敛成中观机制假设。",
    }
  }
  if (issue === "too_narrow" || issue === "too_fine") {
    return {
      passes: false,
      reason: "too_narrow",
      bucket: "event_only",
      score: matchedParts.length,
      matchedParts,
      headline: "太细：更适合作为事件，不该直接建假设",
      detail: "单条消息、单一订单或单股异动应优先路由到已有假设轨迹。",
      nextAction: "折叠为事件线索；无法归入已有假设时再人工改写。",
    }
  }

  const score = matchedParts.length
  if (score >= 4) {
    return {
      passes: true,
      reason: "mid_level_mechanism",
      bucket: "primary",
      score,
      matchedParts,
      headline: "中观机制完整",
      detail: "具备产业方向、细分环节、变化机制和可跟踪证据，可以进入主候选。",
      nextAction: "可 Ask 预检或加入跟踪；状态仍需人工确认。",
    }
  }

  return {
    passes: false,
    reason: "insufficient_structure",
    bucket: "needs_definition",
    score,
    matchedParts,
    headline: "结构不足：先补成中观假设",
    detail: `当前只识别到 ${matchedParts.length ? matchedParts.join("、") : "零散线索"}，还不足以进入主候选。`,
    nextAction: "先补产业方向、细分环节、变化机制或证据路径。",
  }
}

function hypothesisGranularityBrief(hypothesis: Record<string, unknown> = {}) {
  const granularity = (hypothesis.granularity && typeof hypothesis.granularity === "object" && !Array.isArray(hypothesis.granularity))
    ? hypothesis.granularity as Record<string, unknown>
    : {}
  const issue = compactDisplayText(granularity.issue, "", 40) || inferHypothesisGranularityIssue(hypothesis)
  if (issue === "too_broad") {
    return {
      label: "假设颗粒度",
      headline: "假设太宽，容易变成主题口号",
      detail: "它需要收敛到细分环节、触发条件和可跟踪证据，例如涨价函、订单弹性、量价重估或验证链。",
      nextAction: "改成中观假设后再加入跟踪表；泛主题只适合作为检索入口。",
    }
  }
  if (issue === "too_narrow" || issue === "too_fine") {
    return {
      label: "假设颗粒度",
      headline: "假设太细，更适合作为事件",
      detail: "单条微信群消息、某篇文章、某一天某只股票放量或单一订单线索，应先作为事件路由到已有假设轨迹。",
      nextAction: "把它并入相关假设作为新催化/二次确认；只有形成细分链条判断后再创建新假设。",
    }
  }
  return null
}

export function buildHypothesisQualityBrief(hypothesis: Record<string, unknown> = {}): HypothesisQualityBrief {
  const missing: Array<{ label: string; fix: string }> = []
  const granularityBrief = hypothesisGranularityBrief(hypothesis)
  const triggerConditions = stringList(hypothesis.triggerConditions ?? hypothesis.triggers)
  const invalidationSignals = stringList(hypothesis.invalidationSignals ?? hypothesis.falsifiableConditions ?? hypothesis.risks)
  const expectedEvidencePath = stringList(hypothesis.expectedEvidencePath ?? hypothesis.evidencePath)
  const relatedWikiPages = relatedWikiPathList(hypothesis.relatedWikiPages ?? hypothesis.wikiRefs)

  if (granularityBrief) {
    missing.push({ label: granularityBrief.label, fix: granularityBrief.detail })
  }
  if (!triggerConditions.length) {
    missing.push({ label: "触发条件", fix: "什么新增资料会让它增强" })
  }
  if (!invalidationSignals.length) {
    missing.push({ label: "证伪信号", fix: "什么信息出现就该降级或停止跟踪" })
  }
  if (!expectedEvidencePath.length) {
    missing.push({ label: "验证路径", fix: "从新增资料到 Ask、量价或公告复核怎么走" })
  }
  if (!relatedWikiPages.length) {
    missing.push({ label: "wiki框架", fix: "接回哪个 wiki 页面或产业链框架" })
  }

  if (!missing.length) {
    return {
      tone: "ready",
      label: "可跟踪",
      headline: "定义完整，可以进入日常跟踪",
      detail: "新增资料可以按触发条件、证伪信号、验证路径和 wiki 框架回流到这条假设。",
      nextAction: "继续扫描新增资料；有强信号再 Ask 深挖或确认状态。",
      missingLabels: [],
    }
  }

  const missingLabels = missing.map((item) => item.label)
  if (granularityBrief) {
    const otherMissing = missingLabels.filter((label) => label !== granularityBrief.label)
    return {
      tone: "needs_work",
      label: "颗粒度待调",
      headline: otherMissing.length
        ? `${granularityBrief.headline}；另缺 ${otherMissing.join("、")}`
        : granularityBrief.headline,
      detail: [granularityBrief.detail, ...missing
        .filter((item) => item.label !== granularityBrief.label)
        .map((item) => `${item.label}：${item.fix}`)]
        .join("；"),
      nextAction: granularityBrief.nextAction,
      missingLabels,
    }
  }
  return {
    tone: "needs_work",
    label: "待补定义",
    headline: `缺 ${missing.length} 项：${missingLabels.join("、")}`,
    detail: missing.map((item) => `${item.label}：${item.fix}`).join("；"),
    nextAction: "先补齐假设定义，再让新增资料自动判断状态变化。",
    missingLabels,
  }
}

function recordSourceRefs(...values: unknown[]) {
  return [...new Set(values
    .flatMap(arrayRecords)
    .flatMap((record) => [
      record.sourceRef,
      record.sourcePath,
      record.path,
      record.url,
    ])
    .map((item) => compactDisplayText(item, "", 180))
    .filter(Boolean))]
}

function directSourceRefs(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === "string")
      .flatMap((item) => stringList(item))
  }
  return stringList(value)
}

export function buildHypothesisDefinitionDraft(
  hypothesis: Record<string, unknown> = {},
  qualityBrief = buildHypothesisQualityBrief(hypothesis),
): HypothesisDefinitionDraft {
  const hypothesisId = compactDisplayText(hypothesis.id, "", 80)
  const hypothesisTitle = compactDisplayText(hypothesis.title, hypothesisId || "未命名假设", 90)
  const theme = compactDisplayText(hypothesis.theme, "未填写", 80)
  const segments = stringList(hypothesis.segments).join("、") || "未填写"
  const timeHorizon = compactDisplayText(hypothesis.timeHorizon ?? hypothesis.horizon, "未填写", 80)
  const triggerConditions = stringList(hypothesis.triggerConditions ?? hypothesis.triggers)
  const invalidationSignals = stringList(hypothesis.invalidationSignals ?? hypothesis.falsifiableConditions ?? hypothesis.risks)
  const expectedEvidencePath = stringList(hypothesis.expectedEvidencePath ?? hypothesis.evidencePath)
  const relatedWikiPages = relatedWikiPathList(hypothesis.relatedWikiPages ?? hypothesis.wikiRefs)
  const sourceRefs = [...new Set([
    ...relatedWikiPages,
    ...directSourceRefs(hypothesis.sourceRefs ?? hypothesis.sources),
    ...recordSourceRefs(hypothesis.sourceRefs, hypothesis.sources),
    ...recordSourceRefs(hypothesis.evidenceRefs, hypothesis.marketRefs, hypothesis.recentEvents, hypothesis.openAlerts),
  ])].slice(0, 10)
  const missingLine = qualityBrief.missingLabels.length ? qualityBrief.missingLabels.join("、") : "无"
  const existingLine = (label: string, rows: string[]) => `${label}：${rows.length ? rows.join("；") : "待补"}`

  return {
    title: `补定义：${hypothesisTitle}`,
    kind: "hypothesis_definition",
    sourceRefs: sourceRefs.join(", "),
    selectedSourceIds: ["pasted_material", "wiki_incremental", "ima"],
    missingLabels: qualityBrief.missingLabels,
    body: [
      `# ${hypothesisTitle} 假设定义补齐`,
      "",
      "## 关联假设",
      `- 假设ID：${hypothesisId || "待补"}`,
      `- 标题：${hypothesisTitle}`,
      `- 主题：${theme}`,
      `- 细分：${segments}`,
      `- 周期：${timeHorizon}`,
      "",
      "## 当前定义完整度",
      `- 状态：${qualityBrief.label}`,
      `- 缺口：${missingLine}`,
      `- 说明：${qualityBrief.detail}`,
      "",
      "## 已有定义",
      `- ${existingLine("触发条件", triggerConditions)}`,
      `- ${existingLine("证伪信号", invalidationSignals)}`,
      `- ${existingLine("验证路径", expectedEvidencePath)}`,
      `- ${existingLine("相关 wiki 框架", relatedWikiPages)}`,
      "",
      "## 请补齐",
      "1. triggerConditions：什么新增舆情、公告、订单、量价或产业链信号会让假设增强。",
      "2. invalidationSignals：什么反证、延迟、价格透支或基本面不兑现会让假设降级。",
      "3. expectedEvidencePath：从新增资料到 Ask 深挖、量价验证、公告/财报/订单复核的最短路径。",
      "4. relatedWikiPages：这条假设应回流到哪些 wiki 页面或产业链框架。",
      "",
      "## 输出要求",
      "- 只补齐假设定义，不要直接给交易指令。",
      "- 区分“新催化 / 二次确认 / 市场反馈 / 硬证据 / 反证 / 叙事扩散”。",
      "- 如果资料不足，明确写待补字段和建议数据源。",
      "- 不要自动写 wiki/raw；只作为 Research Cockpit 的补定义草稿。",
    ].join("\n"),
  }
}

function mergeTermsByTypeRecords(...values: unknown[]) {
  const merged: Record<string, string[]> = {}
  for (const value of values) {
    const record = unknownRecord(value)
    for (const [type, terms] of Object.entries(record)) {
      const key = textValue(type, "")
      if (!key) continue
      merged[key] = mergeStringArrays(merged[key], terms).slice(0, 8)
    }
  }
  return merged
}

function mergeRelatedPageRecord(existing: Record<string, unknown>, incoming: Record<string, unknown>) {
  const existingScore = numberValue(existing.score)
  const incomingScore = numberValue(incoming.score)
  const base = incomingScore > existingScore ? incoming : existing
  const other = base === incoming ? existing : incoming
  return {
    ...other,
    ...base,
    score: Math.max(existingScore, incomingScore),
    title: firstFilled(base.title, other.title),
    sourceRef: firstFilled(base.sourceRef, other.sourceRef),
    path: firstFilled(base.path, other.path),
    matchedTerms: mergeStringArrays(existing.matchedTerms, incoming.matchedTerms),
    financeAuditMatchedTerms: mergeStringArrays(existing.financeAuditMatchedTerms, incoming.financeAuditMatchedTerms),
    matchedFinanceAuditTerms: mergeStringArrays(existing.matchedFinanceAuditTerms, incoming.matchedFinanceAuditTerms),
    financeAuditMatchedEntities: mergeRecordArrays(existing.financeAuditMatchedEntities, incoming.financeAuditMatchedEntities),
    financeSignalEntities: mergeRecordArrays(existing.financeSignalEntities, incoming.financeSignalEntities),
    financeAuditMatchedTermsByType: mergeTermsByTypeRecords(existing.financeAuditMatchedTermsByType, incoming.financeAuditMatchedTermsByType),
  }
}

function mergeRelatedPagesForSignalTodo(...groups: unknown[]) {
  const byRef = new Map<string, Record<string, unknown>>()
  for (const page of groups.flatMap(arrayRecords)) {
    const sourceRef = textValue(page.sourceRef, "")
    const title = textValue(page.title, sourceRef)
    const key = sourceRef || title
    if (!key) continue
    const existing = byRef.get(key)
    if (existing) {
      byRef.set(key, mergeRelatedPageRecord(existing, page))
    } else {
      byRef.set(key, page)
    }
  }
  return [...byRef.values()]
    .sort((a, b) => numberValue(b.score) - numberValue(a.score) || textValue(a.sourceRef, "").localeCompare(textValue(b.sourceRef, "")))
    .slice(0, 3)
}

function statusActionRank(value: unknown) {
  const status = textValue(value, "").trim()
  const ranks: Record<string, number> = {
    actionable: 90,
    strengthening: 80,
    priced_in: 72,
    divergent: 70,
    disconfirmed: 70,
    watching: 30,
    seed: 20,
    archived: 0,
  }
  return ranks[status] ?? 10
}

function pickStrongerSignalField(existing: unknown, incoming: unknown) {
  return statusActionRank(incoming) > statusActionRank(existing) ? incoming : existing
}

export function buildSignalTodoSourceKey(item: Record<string, unknown>) {
  const semanticKey = [
    textValue(item.hypothesisId, ""),
    textValue(item.sourceHash, ""),
    textValue(item.sourceRef, ""),
    textValue(item.evidenceDelta, ""),
  ].filter(Boolean).join(":")
  if (semanticKey) return semanticKey
  return [
    textValue(item.id, ""),
    textValue(item.hypothesisId, ""),
    textValue(item.sourceHash, ""),
    textValue(item.sourceRef, ""),
    textValue(item.evidenceDelta, ""),
  ].filter(Boolean).join(":") || JSON.stringify(item).slice(0, 120)
}

const SOFT_NO_CHANGE_SIGNAL_DELTAS = new Set([
  "catalyst_signal",
  "narrative_expansion",
  "new_context",
  "mixed_signal",
])

export function buildSignalTodoClusterKey(item: Record<string, unknown>) {
  const hypothesisKey = firstFilled(item.hypothesisId, item.hypothesisTitle)
  if (!hypothesisKey) return buildSignalTodoSourceKey(item)
  const evidenceDelta = textValue(item.evidenceDelta, "")
  const statusBefore = textValue(item.statusBefore, "")
  const suggestedStatus = textValue(item.suggestedStatus, "")
  const noStatusChange = Boolean(statusBefore && suggestedStatus && statusBefore === suggestedStatus)
  const softNoChange = noStatusChange && SOFT_NO_CHANGE_SIGNAL_DELTAS.has(evidenceDelta)
  return [
    hypothesisKey,
    softNoChange ? "soft_context" : evidenceDelta,
  ].filter(Boolean).join(":")
}

export function mergeSignalTodoRecord(existing: Record<string, unknown>, incoming: Record<string, unknown>) {
  const existingCreatedAt = textValue(existing.createdAt, "")
  const incomingCreatedAt = textValue(incoming.createdAt, "")
  const strongerStatus = pickStrongerSignalField(existing.suggestedStatus, incoming.suggestedStatus)
  const preferIncomingStatus = strongerStatus === incoming.suggestedStatus
  const mergedCount = Math.max(1, numberValue(existing.mergedCount)) + Math.max(1, numberValue(incoming.mergedCount))
  const mergedReason = firstFilled(
    preferIncomingStatus ? incoming.reason : existing.reason,
    preferIncomingStatus ? incoming.suggestedStatusReason : existing.suggestedStatusReason,
    preferIncomingStatus ? incoming.alertReason : existing.alertReason,
    preferIncomingStatus ? incoming.summary : existing.summary,
    preferIncomingStatus ? existing.reason : incoming.reason,
    preferIncomingStatus ? existing.suggestedStatusReason : incoming.suggestedStatusReason,
    preferIncomingStatus ? existing.alertReason : incoming.alertReason,
    preferIncomingStatus ? existing.summary : incoming.summary,
  )
  return {
    ...incoming,
    ...existing,
    mergedCount,
    suggestedStatus: strongerStatus,
    signalType: preferIncomingStatus ? firstFilled(incoming.signalType, existing.signalType) : firstFilled(existing.signalType, incoming.signalType),
    createdAt: existingCreatedAt >= incomingCreatedAt ? existingCreatedAt : incomingCreatedAt,
    reason: mergedReason,
    sourceExcerpt: firstFilled(existing.sourceExcerpt, incoming.sourceExcerpt),
    sourceKind: firstFilled(existing.sourceKind, incoming.sourceKind),
    sourceKindLabel: firstFilled(existing.sourceKindLabel, incoming.sourceKindLabel),
    sourceTool: firstFilled(existing.sourceTool, incoming.sourceTool),
    tradingImplication: firstFilled(existing.tradingImplication, incoming.tradingImplication),
    suggestedStatusReason: firstFilled(
      preferIncomingStatus ? incoming.suggestedStatusReason : existing.suggestedStatusReason,
      preferIncomingStatus ? incoming.alertReason : existing.alertReason,
      preferIncomingStatus ? incoming.summary : existing.summary,
      preferIncomingStatus ? existing.suggestedStatusReason : incoming.suggestedStatusReason,
      preferIncomingStatus ? existing.alertReason : incoming.alertReason,
      preferIncomingStatus ? existing.summary : incoming.summary,
    ),
    alertReason: firstFilled(existing.alertReason, incoming.alertReason),
    summary: firstFilled(existing.summary, incoming.summary),
    askDeepDiveRecommended: Boolean(existing.askDeepDiveRecommended || incoming.askDeepDiveRecommended),
    evidenceGaps: [...new Set([...stringList(existing.evidenceGaps), ...stringList(incoming.evidenceGaps)])],
    relatedWikiPages: mergeRelatedPagesForSignalTodo(existing.relatedWikiPages, incoming.relatedWikiPages),
  }
}

function candidateClusterPriorityScore(item: Record<string, unknown>) {
  return pendingCandidatePriorityScore({
    priorityScore: item.priorityScore,
    askDeepDiveRecommended: Boolean(item.askDeepDiveRecommended),
    evidenceDelta: item.evidenceDelta,
    signalType: item.signalType,
    clusterSourceCount: item.clusterSourceCount,
    relatedWikiCount: arrayRecords(item.relatedWikiPages).length,
    relatedWikiPages: item.relatedWikiPages,
    financeEntityRecords: [item, ...arrayRecords(item.relatedWikiPages)],
  })
}

export function buildCandidateSignalClusterKey(item: Record<string, unknown>) {
  const page = rankedWikiFramePages(item.relatedWikiPages)[0]
  const wikiKey = compactDisplayText(page?.sourceRef ?? page?.path ?? page?.ref ?? page?.title, "", 180)
  const signalKey = firstFilled(item.evidenceDelta, item.signalType)
  if (wikiKey) return ["wiki", wikiKey, signalKey].filter(Boolean).join(":")
  const explicitKey = firstFilled(item.clusterKey, item.hypothesisId)
  if (explicitKey) return ["explicit", explicitKey, signalKey].filter(Boolean).join(":")
  const theme = compactDisplayText(item.theme, "", 80)
  const segments = stringList(item.segments).slice(0, 3).join("/")
  const financeStrip = buildSignalFinanceEntityStrip([item, ...arrayRecords(item.relatedWikiPages)])
  const financeKey = financeStrip.headline || financeStrip.detail
  return [
    "candidate",
    theme,
    segments,
    financeKey,
    signalKey,
    compactDisplayText(item.title, "", 80),
  ].filter(Boolean).join(":") || JSON.stringify(item).slice(0, 120)
}

function candidateSourceRefs(item: Record<string, unknown>) {
  return mergeStringArrays(
    item.sourceRefs,
    item.evidenceRefs,
    item.marketRefs,
    item.discoverySourceRef,
    item.sourceRef,
  )
}

export function mergeCandidateSignalRecord(existing: Record<string, unknown>, incoming: Record<string, unknown>) {
  const existingScore = candidateClusterPriorityScore(existing)
  const incomingScore = candidateClusterPriorityScore(incoming)
  const existingCreatedAt = textValue(existing.createdAt, "")
  const incomingCreatedAt = textValue(incoming.createdAt, "")
  const preferIncoming = incomingScore > existingScore || (incomingScore === existingScore && incomingCreatedAt > existingCreatedAt)
  const primary = preferIncoming ? incoming : existing
  const secondary = preferIncoming ? existing : incoming
  const sourceRefs = mergeStringArrays(candidateSourceRefs(existing), candidateSourceRefs(incoming))
  const sourceCount = sourceRefs.length || Math.max(
    1,
    numberValue(existing.clusterSourceCount) + numberValue(incoming.clusterSourceCount),
  )
  return {
    ...secondary,
    ...primary,
    title: firstFilled(primary.title, secondary.title),
    theme: firstFilled(primary.theme, secondary.theme),
    evidenceDelta: firstFilled(primary.evidenceDelta, secondary.evidenceDelta),
    signalType: firstFilled(primary.signalType, secondary.signalType),
    createdAt: existingCreatedAt >= incomingCreatedAt ? existingCreatedAt : incomingCreatedAt,
    askDeepDiveRecommended: Boolean(existing.askDeepDiveRecommended || incoming.askDeepDiveRecommended),
    priorityScore: Math.max(numberValue(existing.priorityScore), numberValue(incoming.priorityScore)),
    clusterCandidateCount: Math.max(1, numberValue(existing.clusterCandidateCount) || 1)
      + Math.max(1, numberValue(incoming.clusterCandidateCount) || 1),
    clusterSourceCount: sourceCount,
    clusterTitles: mergeStringArrays(existing.clusterTitles, incoming.clusterTitles, existing.title, incoming.title),
    segments: mergeStringArrays(existing.segments, incoming.segments),
    keyVariables: mergeStringArrays(existing.keyVariables, incoming.keyVariables),
    risks: mergeStringArrays(existing.risks, incoming.risks),
    evidenceRefs: mergeStringArrays(existing.evidenceRefs, incoming.evidenceRefs),
    marketRefs: mergeStringArrays(existing.marketRefs, incoming.marketRefs),
    sourceRefs,
    sourceExcerpts: mergeStringArrays(existing.sourceExcerpts, incoming.sourceExcerpts, existing.sourceExcerpt, incoming.sourceExcerpt),
    priorityReasons: mergeStringArrays(existing.priorityReasons, incoming.priorityReasons),
    catalystTags: mergeStringArrays(existing.catalystTags, incoming.catalystTags),
    financeSignalEntities: mergeRecordArrays(existing.financeSignalEntities, incoming.financeSignalEntities),
    financeAuditMatchedEntities: mergeRecordArrays(existing.financeAuditMatchedEntities, incoming.financeAuditMatchedEntities),
    financeAuditMatchedTerms: mergeStringArrays(existing.financeAuditMatchedTerms, incoming.financeAuditMatchedTerms),
    matchedFinanceAuditTerms: mergeStringArrays(existing.matchedFinanceAuditTerms, incoming.matchedFinanceAuditTerms),
    financeAuditMatchedTermsByType: mergeTermsByTypeRecords(existing.financeAuditMatchedTermsByType, incoming.financeAuditMatchedTermsByType),
    relatedWikiPages: mergeRelatedPagesForSignalTodo(existing.relatedWikiPages, incoming.relatedWikiPages),
  }
}

export function buildCandidateSignalClusters(candidates: Array<Record<string, unknown>>) {
  const byKey = new Map<string, Record<string, unknown>>()
  for (const item of candidates) {
    const key = buildCandidateSignalClusterKey(item)
    const candidate = {
      ...item,
      clusterCandidateCount: Math.max(1, numberValue(item.clusterCandidateCount) || 1),
      clusterSourceCount: Math.max(1, numberValue(item.clusterSourceCount) || candidateSourceRefs(item).length || 1),
    }
    const existing = byKey.get(key)
    byKey.set(key, existing ? mergeCandidateSignalRecord(existing, candidate) : candidate)
  }
  return [...byKey.values()].sort((a, b) => candidateClusterPriorityScore(b) - candidateClusterPriorityScore(a)
    || textValue(a.title, "").localeCompare(textValue(b.title, "")))
}

export function buildCandidateThemeSegmentLine({ theme, segments }: { theme?: unknown; segments?: unknown }) {
  const themeText = compactDisplayText(theme, "", 80)
  const segmentText = stringList(segments).slice(0, 5).join("/")
  const parts = [
    themeText ? `主题：${themeText}` : "",
    segmentText ? `细分：${segmentText}` : "",
  ].filter(Boolean)
  return parts.join(" · ") || "待补主题/细分"
}

function firstWikiMeta(pages: unknown) {
  return rankedWikiFramePages(pages)
    .map((page) => unknownRecord(page.wikiMeta))
    .find((meta) => Object.keys(meta).length > 0) ?? {}
}

function wikiMetaPriorityBoost(pages: unknown) {
  const metas = arrayRecords(pages).map((page) => unknownRecord(page.wikiMeta)).filter((meta) => Object.keys(meta).length > 0)
  if (!metas.length) return 0
  let best = Number.NEGATIVE_INFINITY
  for (const meta of metas) {
    let score = 0
    const status = compactDisplayText(meta.status, "", 40)
    const confidence = compactDisplayText(meta.confidence, "", 40)
    const momentum = compactDisplayText(meta.momentum, "", 40)
    if (status.includes("活跃")) score += 8
    if (status.includes("归档") || status.includes("证伪")) score -= 6
    if (confidence.includes("高")) score += 6
    else if (confidence.includes("中")) score += 3
    else if (confidence.includes("低")) score -= 2
    if (momentum.includes("热")) score += 6
    if (momentum.includes("冷")) score -= 2
    score += Math.min(8, stringList(meta.catalysts).length * 3)
    score += Math.min(3, stringList(meta.sources).length)
    if (compactDisplayText(meta.summary, "", 40)) score += 1
    best = Math.max(best, Math.min(18, score))
  }
  return best
}

function rankedWikiFramePages(pages: unknown) {
  return arrayRecords(pages)
    .map((page, index) => ({
      page,
      index,
      headerScore: wikiMetaPriorityBoost([page]),
      matchScore: numberValue(page.score),
    }))
    .sort((a, b) => b.headerScore - a.headerScore || b.matchScore - a.matchScore || a.index - b.index)
    .map((item) => item.page)
}

function normalizedMatchNeedle(value: unknown) {
  return compactDisplayText(value, "", 48).toLowerCase()
}

function valueMatchesTerm(value: unknown, term: unknown) {
  const haystack = normalizedMatchNeedle(value)
  const needle = normalizedMatchNeedle(term)
  if (!haystack || !needle) return false
  return haystack.includes(needle) || needle.includes(haystack)
}

function wikiFrameTerms(page: Record<string, unknown>) {
  return compactSignalKeywords([
    page.matchedTerms,
    page.frontmatterMatches,
    page.financeAuditMatchedTerms,
    page.matchedFinanceAuditTerms,
  ], 8)
}

const FINANCE_ENTITY_TYPE_UI_LABELS: Record<string, string> = {
  catalyst: "催化",
  company: "公司",
  concept: "概念",
  fund_flow: "资金行为",
  group: "群体",
  index: "指数",
  institution: "机构",
  location: "地点",
  market_regime: "市场状态",
  metric: "指标",
  organization: "组织",
  person: "人物",
  policy: "政策",
  product: "产品",
  product_line: "产品线",
  risk_factor: "风险因子",
  sector: "板块",
  source: "来源",
  stock: "股票",
  subject: "主题对象",
  supply_chain_role: "产业链位置",
  tags: "标签",
  tech_route: "技术路线",
  theme: "主题",
  time: "时间",
  trade_pattern: "交易模式",
  action: "动作",
  work: "文档",
}

const FINANCE_ENTITY_TYPE_ORDER = [
  "stock",
  "company",
  "index",
  "product_line",
  "tech_route",
  "supply_chain_role",
  "catalyst",
  "risk_factor",
  "trade_pattern",
  "market_regime",
  "metric",
  "sector",
  "theme",
  "concept",
  "product",
  "subject",
  "policy",
  "fund_flow",
  "institution",
  "organization",
  "person",
  "action",
  "work",
  "group",
  "time",
  "location",
  "source",
  "tags",
]

function financeEntityTypeLabel(value: unknown) {
  const type = compactDisplayText(value, "", 40)
  return FINANCE_ENTITY_TYPE_UI_LABELS[type] ?? compactDisplayText(type, "", 12)
}

function financeEntityDisplayLabel(label: unknown, type: unknown) {
  const normalizedLabel = compactDisplayText(label, "", 40)
  if (normalizedLabel && FINANCE_ENTITY_TYPE_UI_LABELS[normalizedLabel]) {
    return FINANCE_ENTITY_TYPE_UI_LABELS[normalizedLabel]
  }
  return normalizedLabel || financeEntityTypeLabel(type)
}

function financeEntityTypeRank(label: string) {
  const type = Object.entries(FINANCE_ENTITY_TYPE_UI_LABELS)
    .find(([, itemLabel]) => itemLabel === label)?.[0] ?? label
  const rank = FINANCE_ENTITY_TYPE_ORDER.indexOf(type)
  return rank >= 0 ? rank : FINANCE_ENTITY_TYPE_ORDER.length
}

function financeEntityTypeGroups(pages: unknown, limit = 3) {
  const groups = new Map<string, Set<string>>()
  const records = Array.isArray(pages)
    ? arrayRecords(pages)
    : Object.keys(unknownRecord(pages)).length > 0
      ? [unknownRecord(pages)]
      : []
  for (const page of records) {
    for (const entity of arrayRecords(page.financeSignalEntities ?? page.financeAuditMatchedEntities ?? page.matchedFinanceAuditEntities)) {
      const term = meaningfulSignalKeyword(entity.term ?? entity.name ?? entity.normalizedName)
      const label = compactDisplayText(financeEntityDisplayLabel(entity.label, entity.type), "", 24)
      if (!term || !label) continue
      if (!groups.has(label)) groups.set(label, new Set())
      groups.get(label)?.add(term)
    }
    const typeTerms = unknownRecord(page.financeAuditMatchedTermsByType ?? page.matchedFinanceAuditTermsByType)
    for (const [type, terms] of Object.entries(typeTerms)) {
      const label = financeEntityTypeLabel(type)
      const usefulTerms = compactSignalKeywords([terms], 4)
      if (!label || !usefulTerms.length) continue
      if (!groups.has(label)) groups.set(label, new Set())
      for (const term of usefulTerms) groups.get(label)?.add(term)
    }
  }
  return [...groups.entries()]
    .map(([label, terms]) => ({ label, terms: [...terms] }))
    .filter((item) => item.terms.length > 0)
    .sort((a, b) => financeEntityTypeRank(a.label) - financeEntityTypeRank(b.label) || a.label.localeCompare(b.label))
    .reduce<Array<{ label: string; terms: string[] }>>((items, item) => {
      const usedTerms = new Set(items.flatMap((existing) => existing.terms))
      const terms = item.terms.filter((term) => !usedTerms.has(term)).slice(0, 2)
      if (terms.length) items.push({ ...item, terms })
      return items
    }, [])
    .slice(0, limit)
}

function financeEntityTypeSummary(pages: unknown) {
  const groups = financeEntityTypeGroups(pages)
  if (!groups.length) return ""
  return `金融类型：${groups.map((group) => `${group.label} ${group.terms.join("/")}`).join("，")}`
}

function financeEntityPriorityReason(pages: unknown) {
  const priorityLabels = new Set(["股票", "公司", "板块", "主题", "产品线", "技术路线", "产业链位置", "催化", "风险因子", "交易模式", "市场状态"])
  const groups = financeEntityTypeGroups(pages, 4)
    .filter((group) => priorityLabels.has(group.label))
    .slice(0, 3)
  if (!groups.length) return ""
  return `优先原因：命中${groups.map((group) => `${group.label} ${group.terms.join("/")}`).join("，")}`
}

const SIGNAL_FINANCE_ENTITY_DISPLAY_LABELS = new Set([
  "股票",
  "公司",
  "指数",
  "板块",
  "主题",
  "概念",
  "产品",
  "产品线",
  "技术路线",
  "产业链位置",
  "催化",
  "风险因子",
  "交易模式",
  "市场状态",
  "指标",
  "资金行为",
  "政策",
  "机构",
])

function signalFinanceEntityTone(label: string): SignalFinanceEntityStrip["groups"][number]["tone"] {
  if (label === "股票" || label === "公司" || label === "指数" || label === "机构") return "issuer"
  if (label === "产品线" || label === "产品" || label === "技术路线" || label === "产业链位置" || label === "板块" || label === "主题" || label === "概念") return "industry"
  if (label === "催化" || label === "政策") return "catalyst"
  if (label === "风险因子") return "risk"
  if (label === "交易模式" || label === "市场状态" || label === "资金行为") return "market"
  return "context"
}

export function buildSignalFinanceEntityStrip(pages: unknown): SignalFinanceEntityStrip {
  const groups = financeEntityTypeGroups(pages, 6)
    .filter((group) => SIGNAL_FINANCE_ENTITY_DISPLAY_LABELS.has(group.label))
    .map((group) => ({
      ...group,
      tone: signalFinanceEntityTone(group.label),
    }))
  if (!groups.length) {
    return {
      show: false,
      label: "项目金融词",
      headline: "",
      actionLabel: "",
      detail: "",
      decision: "",
      groups: [],
    }
  }
  return {
    show: true,
    label: "项目金融词",
    headline: financeEntityHeadline(groups),
    actionLabel: financeEntityActionLabel(groups),
    detail: groups.map((group) => `${group.label} ${group.terms.join("/")}`).join("，"),
    decision: financeEntityDecisionCue(groups),
    groups,
  }
}

export function buildSignalFinanceHeaderCue(pages: unknown): SignalFinanceHeaderCue {
  const strip = buildSignalFinanceEntityStrip(pages)
  if (!strip.show) {
    return {
      show: false,
      label: "项目金融词",
      headline: "",
      actionLabel: "",
      detail: "",
      ariaLabel: "",
      chips: [],
    }
  }
  const chips = strip.groups
    .filter((group) => group.terms.length > 0)
    .slice(0, 4)
    .map((group) => ({
      label: group.label,
      value: group.terms.join("/"),
      tone: group.tone,
      title: `${group.label}：${group.terms.join(" / ")}`,
    }))
  return {
    show: chips.length > 0,
    label: strip.label,
    headline: strip.headline,
    actionLabel: strip.actionLabel,
    detail: strip.detail,
    ariaLabel: `${strip.label}：${strip.detail}`,
    chips,
  }
}

function financeEntityHeadline(groups: SignalFinanceEntityStrip["groups"]) {
  const risks = financeEntityTermsForCue(groups, ["风险因子"], 1)
  if (risks.length) return `风险：${risks[0]}`
  const market = financeEntityTermsForCue(groups, ["交易模式", "市场状态", "资金行为"], 1)
  if (market.length) return `市场反馈：${market[0]}`
  const issuers = financeEntityTermsForCue(groups, ["股票", "公司", "指数", "机构"], 1)
  const industry = financeEntityTermsForCue(groups, ["产品线", "技术路线", "产业链位置", "板块", "主题", "概念", "产品"], 2)
  const catalysts = financeEntityTermsForCue(groups, ["催化", "政策"], 1)
  const terms = [...issuers, ...industry, ...catalysts].filter(Boolean).slice(0, 4)
  if (terms.length) return terms.join(" / ")
  return groups.flatMap((group) => group.terms).filter(Boolean).slice(0, 3).join(" / ")
}

function financeEntityActionLabel(groups: SignalFinanceEntityStrip["groups"]) {
  if (financeEntityTermsForCue(groups, ["风险因子"], 1).length) return "先反证"
  if (financeEntityTermsForCue(groups, ["交易模式", "市场状态", "资金行为"], 1).length) return "看定价"
  if (financeEntityTermsForCue(groups, ["催化", "政策"], 1).length) return "Ask 排序"
  if (financeEntityTermsForCue(groups, ["股票", "公司", "产品线", "技术路线", "产业链位置", "板块", "主题", "概念", "产品"], 1).length) return "回连 wiki"
  return "看来源"
}

function financeEntityTermsForCue(
  groups: SignalFinanceEntityStrip["groups"],
  labels: string[],
  limit = 2,
) {
  const labelSet = new Set(labels)
  return groups
    .filter((group) => labelSet.has(group.label))
    .flatMap((group) => group.terms)
    .filter(Boolean)
    .slice(0, limit)
}

function financeEntityCueParts(
  groups: SignalFinanceEntityStrip["groups"],
  labels: string[],
  limitPerGroup = 2,
) {
  const labelSet = new Set(labels)
  return groups
    .filter((group) => labelSet.has(group.label))
    .map((group) => {
      const terms = group.terms.filter(Boolean).slice(0, limitPerGroup)
      return terms.length ? `${group.label} ${terms.join("/")}` : ""
    })
    .filter(Boolean)
}

function financeEntityDecisionCue(groups: SignalFinanceEntityStrip["groups"]) {
  const issuerParts = financeEntityCueParts(groups, ["股票", "公司", "指数", "机构"], 2)
  const industryParts = financeEntityCueParts(groups, ["产品线", "技术路线", "产业链位置", "板块", "主题", "概念", "产品"], 2)
  const catalystParts = financeEntityCueParts(groups, ["催化", "政策"], 2)
  const issuers = financeEntityTermsForCue(groups, ["股票", "公司", "指数", "机构"], 2)
  const industry = financeEntityTermsForCue(groups, ["产品线", "技术路线", "产业链位置", "板块", "主题", "概念", "产品"], 3)
  const catalysts = financeEntityTermsForCue(groups, ["催化", "政策"], 2)
  const risks = financeEntityTermsForCue(groups, ["风险因子"], 2)
  const market = financeEntityTermsForCue(groups, ["交易模式", "市场状态", "资金行为"], 2)
  const decisionParts = [...issuerParts, ...industryParts, ...catalystParts]

  if ((issuers.length || industry.length) && catalysts.length) {
    return `为什么重要：命中${decisionParts.join("，")}；所以先 Ask 深挖，排关联股票、直接受益和利好传导。`
  }
  if (risks.length) {
    return `为什么重要：命中风险因子 ${risks.join("/")}；所以先做反证复核，不要直接当成利好。`
  }
  if (market.length) {
    return `为什么重要：命中市场反馈 ${market.join("/")}；所以先判断是刚扩散还是已经定价。`
  }
  if (issuers.length || industry.length) {
    return `为什么重要：命中${[...issuerParts, ...industryParts].join("，")}；先回连 wiki 框架，再决定是否 Ask 深挖。`
  }
  return "为什么重要：命中项目金融词；先判断它是新催化、二次确认、市场反馈还是噪声。"
}

const FINANCE_ENTITY_PRIORITY_BOOST_BY_TYPE: Record<string, number> = {
  stock: 5,
  company: 5,
  product_line: 6,
  tech_route: 6,
  supply_chain_role: 4,
  catalyst: 4,
  risk_factor: 4,
  trade_pattern: 3,
  market_regime: 3,
  sector: 2,
  theme: 2,
  concept: 2,
  product: 2,
  policy: 2,
  fund_flow: 2,
  index: 1,
  institution: 1,
  organization: 1,
  person: 1,
  metric: 1,
}

function financeEntityPriorityBoost(pages: unknown) {
  let bestScore = 0
  for (const page of arrayRecords(pages)) {
    const types = new Set<string>()
    for (const entity of arrayRecords(page.financeSignalEntities ?? page.financeAuditMatchedEntities ?? page.matchedFinanceAuditEntities)) {
      const type = compactDisplayText(entity.type, "", 40).toLowerCase()
      if (type) types.add(type)
    }
    const typeTerms = unknownRecord(page.financeAuditMatchedTermsByType ?? page.matchedFinanceAuditTermsByType)
    for (const [type, terms] of Object.entries(typeTerms)) {
      if (compactSignalKeywords([terms], 2).length) types.add(type.toLowerCase())
    }
    let score = 0
    for (const type of types) score += FINANCE_ENTITY_PRIORITY_BOOST_BY_TYPE[type] ?? 0
    const hasRoute = types.has("tech_route")
    const hasProduct = types.has("product_line")
    const hasIssuer = types.has("stock") || types.has("company")
    const hasCatalyst = types.has("catalyst") || types.has("risk_factor") || types.has("trade_pattern")
    if (hasProduct && hasRoute) score += 2
    if (hasIssuer && (hasProduct || hasRoute || hasCatalyst)) score += 2
    if (score <= 0 && compactSignalKeywords([
      page.financeAuditMatchedTerms,
      page.matchedFinanceAuditTerms,
    ], 3).length) {
      score += 2
    }
    bestScore = Math.max(bestScore, Math.min(14, score))
  }
  return bestScore
}

function financeEntityRecordsForSignal(input: { relatedWikiPages?: unknown; financeEntityRecords?: unknown }) {
  const directRecords = arrayRecords(input.financeEntityRecords)
  const pageRecords = arrayRecords(input.relatedWikiPages)
  if (!directRecords.length) return pageRecords
  return [...directRecords, ...pageRecords]
}

function matchingWikiMetaValues(values: unknown, terms: string[], limit = 3) {
  const list = stringList(values)
  const matches = list.filter((value) => terms.some((term) => valueMatchesTerm(value, term)))
  return Array.from(new Set(matches.map((value) => compactDisplayText(value, "", 42)))).slice(0, limit)
}

function pushWikiFrameMatchField(
  fields: WikiFrameMatchField[],
  field: WikiFrameMatchField,
) {
  if (!field.terms.length) return
  fields.push(field)
}

export function buildWikiFrameMatchExplanation(pages: unknown): WikiFrameMatchExplanation {
  const first = rankedWikiFramePages(pages)[0]
  if (!first) {
    return {
      show: false,
      headline: "",
      detail: "",
      fields: [],
    }
  }
  const meta = unknownRecord(first.wikiMeta)
  const terms = wikiFrameTerms(first)
  const fields: WikiFrameMatchField[] = []
  pushWikiFrameMatchField(fields, {
    label: "标签",
    terms: matchingWikiMetaValues(meta.tags ?? first.frontmatterTags, terms, 3),
    tone: "tag",
  })
  pushWikiFrameMatchField(fields, {
    label: "别名",
    terms: matchingWikiMetaValues(meta.aliases ?? first.frontmatterAliases, terms, 2),
    tone: "alias",
  })
  pushWikiFrameMatchField(fields, {
    label: "催化",
    terms: matchingWikiMetaValues(meta.catalysts ?? first.frontmatterCatalysts, terms, 2),
    tone: "catalyst",
  })
  pushWikiFrameMatchField(fields, {
    label: "相关页",
    terms: matchingWikiMetaValues(meta.related ?? first.frontmatterRelated, terms, 2),
    tone: "related",
  })
  pushWikiFrameMatchField(fields, {
    label: "来源",
    terms: matchingWikiMetaValues(meta.sources ?? first.frontmatterSources, terms, 2),
    tone: "source",
  })
  if (!fields.length && terms.length) {
    pushWikiFrameMatchField(fields, {
      label: "页面命中",
      terms: terms.slice(0, 4),
      tone: "match",
    })
  }
  const detail = fields
    .map((field) => `${field.label}：${field.terms.join("/")}`)
    .join(" · ")
  return {
    show: fields.length > 0,
    headline: fields.length > 0 ? "命中表头字段" : "未识别表头字段",
    detail,
    fields,
  }
}

export function buildWikiMetaBadges(pages: unknown): WikiMetaBadge[] {
  const meta = firstWikiMeta(pages)
  const badges: WikiMetaBadge[] = []
  const type = compactDisplayText(meta.type, "", 24)
  const status = compactDisplayText(meta.status, "", 24)
  const confidence = compactDisplayText(meta.confidence, "", 24)
  const momentum = compactDisplayText(meta.momentum, "", 24)
  const updated = compactDisplayText(meta.updated ?? meta.lastReviewed, "", 40)
  const catalysts = stringList(meta.catalysts)
  const sources = stringList(meta.sources)
  const summary = compactDisplayText(meta.summary, "", 180)
  if (type) badges.push({ label: type, title: summary || `wiki 类型：${type}`, tone: "default" })
  if (status) badges.push({ label: status, title: summary || `wiki 状态：${status}`, tone: status.includes("活跃") ? "active" : "default" })
  if (confidence) badges.push({ label: `${confidence}置信`, title: summary || `wiki 置信度：${confidence}`, tone: "confidence" })
  if (momentum) badges.push({ label: momentum, title: summary || `wiki 动量：${momentum}`, tone: momentum.includes("热") ? "hot" : "default" })
  if (updated) badges.push({ label: `更新 ${updated.slice(0, 10)}`, title: `wiki 最近更新：${updated}`, tone: "updated" })
  if (catalysts.length) badges.push({ label: `催化 ${catalysts.length}`, title: catalysts.slice(0, 4).join(" / "), tone: "catalyst" })
  if (sources.length) badges.push({ label: `来源 ${sources.length}`, title: sources.slice(0, 4).join(" / "), tone: "source" })
  return badges.slice(0, 6)
}

export function buildWikiFrameDecisionLine({
  pages,
  evidenceDelta,
  signalType,
  askDeepDiveRecommended,
}: WikiFrameDecisionLineInput): WikiFrameDecisionLine {
  const visible = rankedWikiFramePages(pages)
  const first = visible[0]
  if (!first) {
    return {
      show: false,
      headline: "",
      detail: "",
      next: "",
      tone: "default",
      badges: [],
      match: buildWikiFrameMatchExplanation([]),
    }
  }
  const meta = firstWikiMeta(visible)
  const title = relatedWikiFrameLabel(first)
  const frame = relatedWikiFrameContext(visible)
  const summary = compactDisplayText(meta.summary, "", 140)
  const tone = wikiFrameClusterTone(visible)
  const delta = compactDisplayText(evidenceDelta, "", 40)
  const signal = compactDisplayText(signalType, "", 40)
  const headlineParts = [`Wiki框架：${title}`]
  if (frame) headlineParts.push(frame)
  const headline = headlineParts.join(" · ")
  const detail = summary || (frame ? `表头提示：${frame}` : "已回连 wiki 框架，可作为本轮信号的判断底座。")
  let next = "把它作为上下文框架，等待二次确认、量价反馈或更硬的证据。"
  if (tone === "stale") {
    next = "表头偏冷或已归档，除非出现硬证据或强反转信号，否则不要直接升级。"
  } else if (delta === "counter_signal" || signal === "反证") {
    next = "先按这个框架复核反向变量，判断是否需要降级或冻结假设。"
  } else if (delta === "market_feedback" || signal === "市场反馈") {
    next = "结合这个框架判断市场是刚开始扩散，还是已经充分定价。"
  } else if (delta === "fundamental_delivery" || signal === "硬证据") {
    next = "按这个框架回查公告、订单、客户、交付和财报确认。"
  } else if (askDeepDiveRecommended || tone === "hot" || tone === "active" || delta === "catalyst_signal" || signal === "新催化") {
    next = "用这个框架 Ask 深挖：关联股票、直接受益、利好排序和来源。"
  }
  return {
    show: true,
    headline,
    detail,
    next,
    tone,
    badges: buildWikiMetaBadges(visible).slice(0, 5),
    match: buildWikiFrameMatchExplanation(visible),
  }
}

export function buildWikiFrameFirstLookCopy(line: WikiFrameDecisionLine): WikiFrameFirstLookCopy {
  if (!line.show) {
    return {
      show: false,
      label: "",
      detail: "",
      next: "",
      tone: "default",
    }
  }
  const labelByTone: Record<WikiFrameDecisionLine["tone"], string> = {
    hot: "热框架",
    active: "活跃框架",
    default: "wiki框架",
    stale: "旧框架复核",
  }
  const frameLabel = compactDisplayText(line.headline.replace(/^Wiki框架：/, ""), "wiki框架", 80)
  const badgeText = line.badges.slice(0, 3).map((badge) => badge.label).join("/")
  const matchTerms = Array.from(new Set(
    line.match.fields.flatMap((field) => field.terms.map((term) => compactDisplayText(term, "", 24)).filter(Boolean)),
  )).slice(0, 4).join("/")
  const detailParts = [
    frameLabel,
    badgeText ? `表头：${badgeText}` : "",
    matchTerms ? `命中：${matchTerms}` : "",
  ].filter(Boolean)
  return {
    show: true,
    label: labelByTone[line.tone],
    detail: compactDisplayText(detailParts.join(" · "), line.detail, 180),
    next: compactDisplayText(line.next, "", 120),
    tone: line.tone,
  }
}

function askWikiSourceRef(page: Record<string, unknown>) {
  return compactDisplayText(page.sourceRef ?? page.path ?? page.ref, "", 180)
}

function askWikiMetaLine(page: Record<string, unknown>) {
  const wikiMeta = unknownRecord(page.wikiMeta)
  const tags = stringList(page.frontmatterTags ?? wikiMeta.tags).slice(0, 4)
  const related = stringList(page.frontmatterRelated ?? wikiMeta.related).slice(0, 3)
  const sources = stringList(page.frontmatterSources ?? wikiMeta.sources).slice(0, 3)
  const matches = stringList(page.frontmatterMatches).slice(0, 3)
  const updated = compactDisplayText(page.frontmatterUpdated ?? wikiMeta.updated ?? wikiMeta.lastReviewed, "", 40)
  const staleDays = numberValue(page.staleDays)
  const parts: string[] = []
  if (tags.length) parts.push(`标签 ${tags.join("/")}`)
  if (related.length) parts.push(`关联 ${related.join("/")}`)
  if (sources.length) parts.push(`来源 ${sources.length}`)
  if (matches.length) parts.push(`命中 ${matches.join("/")}`)
  if (updated) parts.push(`更新 ${updated}`)
  if (staleDays > 0) parts.push(`${staleDays} 天未更新`)
  return parts.join("，")
}

export function buildAskWikiFrameHint(wikiSources: unknown): AskWikiFrameHint {
  const pages = arrayRecords(wikiSources)
  if (!pages.length) {
    return {
      show: false,
      headline: "",
      detail: "",
      next: "",
      tone: "plain",
      sources: [],
    }
  }

  const sources = pages.slice(0, 4).map((page) => {
    const sourceRef = askWikiSourceRef(page)
    const label = relatedWikiFrameLabel({
      title: page.title,
      sourceRef,
      path: page.path,
      ref: page.ref,
      wikiMeta: page.wikiMeta,
    })
    return {
      label,
      sourceRef,
      metaLine: askWikiMetaLine(page),
    }
  })
  const first = pages[0]
  const firstSource = sources[0]
  const type = compactDisplayText(first.type ?? unknownRecord(first.wikiMeta).type, "", 40)
  const staleDays = Math.max(...pages.map((page) => numberValue(page.staleDays)))
  const structuredCount = sources.filter((source) => source.metaLine).length
  const headline = `Ask 命中 wiki 框架：${firstSource?.label ?? "wiki"}${type ? ` · ${type}` : ""}${pages.length > 1 ? ` 等 ${pages.length} 张` : ""}`
  const detail = firstSource?.metaLine
    ? `表头提示：${firstSource.metaLine}`
    : "Ask 返回了 wiki 来源，但没有结构化表头字段；先打开页面看摘要、标签、相关页和来源。"
  const stale = staleDays >= 180
  const tone = stale ? "stale" : structuredCount > 0 ? "structured" : "plain"
  const next = stale
    ? "这张 wiki 表头较久未更新，先核对是否过期；不要只凭旧框架升级假设。"
    : structuredCount > 0
      ? "先打开这张 wiki，沿表头里的标签、相关页和来源查证，再确认状态或加入今日观察。"
      : "先打开命中的 wiki 页面，补齐表头字段后再让系统做更稳的框架判断。"

  return {
    show: true,
    headline,
    detail,
    next,
    tone,
    sources,
  }
}

export function buildHypothesisWorkPriority(input: HypothesisWorkPriorityInput): HypothesisWorkPriority {
  const status = compactDisplayText(input.status, "watching", 40)
  const suggestedStatus = compactDisplayText(input.suggestedStatus, status, 40)
  const delta = compactDisplayText(input.evidenceDelta, "", 40)
  const signal = compactDisplayText(input.signalType, "", 40)
  const meta = firstWikiMeta(input.relatedWikiPages)
  const wikiStatus = compactDisplayText(meta.status, "", 40)
  const wikiConfidence = compactDisplayText(meta.confidence, "", 40)
  const wikiMomentum = compactDisplayText(meta.momentum, "", 40)
  const catalysts = stringList(meta.catalysts)
  const activeFramework = wikiStatus.includes("活跃") || wikiMomentum.includes("热") || catalysts.length > 0
  const stateChanged = Boolean(suggestedStatus && suggestedStatus !== status)

  if (["archived", "disconfirmed"].includes(status) && !stateChanged) {
    return {
      tier: "quiet",
      label: "休眠",
      reason: "已归档或证伪，除非出现强反转信号，否则不占用今日注意力。",
      score: -10,
    }
  }

  if (stateChanged) {
    return {
      tier: "today",
      label: "今天先看",
      reason: `新增信号建议确认状态变化：${hypothesisStatusTransitionLabel(status, suggestedStatus)}。`,
      score: 100,
    }
  }

  if (delta === "counter_signal" || signal === "反证") {
    return {
      tier: "today",
      label: "今天先看",
      reason: "出现反证线索，先判断是否削弱原假设。",
      score: 88,
    }
  }

  if (input.askDeepDiveRecommended || delta === "fundamental_delivery" || signal === "硬证据") {
    return {
      tier: "ask",
      label: "Ask 深挖",
      reason: activeFramework
        ? `命中活跃框架${wikiConfidence ? `、${wikiConfidence}置信` : ""}，适合排关联股票和受益链条。`
        : "信号值得研究，但还需要 Ask 排关联股票、受益链条和证据缺口。",
      score: 72,
    }
  }

  if (delta === "market_feedback" || signal === "市场反馈") {
    return {
      tier: "ask",
      label: "Ask 深挖",
      reason: "出现市场反馈，先判断是刚扩散还是已经定价。",
      score: 68,
    }
  }

  if (delta === "catalyst_signal" || signal === "新催化") {
    return {
      tier: activeFramework ? "ask" : "watch",
      label: activeFramework ? "Ask 深挖" : "继续观察",
      reason: activeFramework
        ? "新催化命中活跃框架，适合快速查股票、链条和来源。"
        : "新催化还缺强框架支撑，先看二次确认和扩散强度。",
      score: activeFramework ? 62 : 35,
    }
  }

  if (["strengthening", "actionable"].includes(status)) {
    return {
      tier: "watch",
      label: "继续观察",
      reason: "假设已有一定强度，等待新的量价、订单或反证触发。",
      score: 30,
    }
  }

  return {
    tier: "watch",
    label: "继续观察",
    reason: "当前没有足够强的新信号，保持跟踪即可。",
    score: 10,
  }
}

export function buildHypothesisWorkbenchRows(rows: unknown, signalsById: HypothesisSignalById = {}) {
  return arrayRecords(rows)
    .map((row, index) => {
      const id = textValue(row.id, "")
      const signal = unknownRecord(id ? signalsById[id] : undefined)
      const suggestedStatus = signal.suggestedStatus ?? row.feedbackStatus ?? row.status
      const priority = buildHypothesisWorkPriority({
        status: row.status,
        suggestedStatus,
        evidenceDelta: signal.evidenceDelta ?? row.latestEvidenceDelta,
        signalType: signal.signalType,
        askDeepDiveRecommended: Boolean(signal.askDeepDiveRecommended),
        relatedWikiPages: signal.relatedWikiPages,
      })
      const updatedAt = compactDisplayText(row.updatedAt ?? row.updated ?? row.lastReviewed ?? row.createdAt, "", 40)
      return { row, index, priority, updatedAt }
    })
    .sort((a, b) => b.priority.score - a.priority.score || b.updatedAt.localeCompare(a.updatedAt) || a.index - b.index)
    .map((item) => item.row)
}

function signalBadgeLabel({ signalType, evidenceDelta }: { signalType?: unknown; evidenceDelta?: unknown }) {
  const signal = compactDisplayText(signalType, "", 40)
  if (signal) return signal
  const delta = compactDisplayText(evidenceDelta, "", 40)
  if (delta === "catalyst_signal") return "新催化"
  if (delta === "fundamental_delivery") return "硬证据"
  if (delta === "market_feedback") return "市场反馈"
  if (delta === "counter_signal") return "反证"
  if (delta === "narrative_expansion") return "叙事扩散"
  if (delta === "supporting_signal" || delta === "mixed_signal") return "二次确认"
  return "新增信号"
}

export function buildSignalLayerBrief({
  signalType,
  evidenceDelta,
  suggestedStatus,
}: {
  signalType?: unknown
  evidenceDelta?: unknown
  suggestedStatus?: unknown
} = {}): SignalLayerBrief {
  const signal = signalBadgeLabel({ signalType, evidenceDelta })
  const delta = compactDisplayText(evidenceDelta, "", 40)
  const status = compactDisplayText(suggestedStatus, "", 40)
  if (delta === "counter_signal" || signal === "反证" || status === "divergent" || status === "disconfirmed") {
    return {
      level: "L2",
      label: "风险信号",
      detail: "与原假设背离或削弱，优先复核来源，不自动证伪。",
      conservativeStatusHint: "建议先看 Ask/来源；人工确认后才进入 divergent 或 disconfirmed。",
      tone: "risk",
    }
  }
  if (delta === "fundamental_delivery" || signal === "硬证据") {
    return {
      level: "L3",
      label: "硬证据",
      detail: "出现公告、订单、交付、财报或招投标线索，才可能支撑 actionable。",
      conservativeStatusHint: status === "actionable"
        ? "可提示接近可下注，但仍需人工确认状态和赔率。"
        : "先复核原文；确认后最多进入 strengthening。",
      tone: "evidence",
    }
  }
  if (delta === "market_feedback" || signal === "市场反馈" || status === "priced_in") {
    return {
      level: "L2",
      label: "市场反馈",
      detail: "价格/成交/扩散已经反应，适合 Ask 深挖，也要提示 priced-in 风险。",
      conservativeStatusHint: "不要把上涨直接当兑现；先判断是否已充分定价。",
      tone: "market",
    }
  }
  if (delta === "supporting_signal" || delta === "mixed_signal" || signal === "二次确认") {
    return {
      level: "L1",
      label: "二次确认",
      detail: "多个来源重复出现，可考虑从 watching 升到 strengthening。",
      conservativeStatusHint: "只建议 evidence strengthening，不直接 actionable。",
      tone: "confirm",
    }
  }
  return {
    level: "L0",
    label: "新催化",
    detail: "有新信息，值得看，但普通舆情不直接升级假设。",
    conservativeStatusHint: "默认保持 watching；等二次确认、市场反馈或硬证据。",
    tone: "catalyst",
  }
}

function hypothesisTimelineTone({ signalType, evidenceDelta, suggestedStatus }: Record<string, unknown>): HypothesisTimelineItem["tone"] {
  const signal = compactDisplayText(signalType, "", 40)
  const delta = compactDisplayText(evidenceDelta, "", 40)
  const status = compactDisplayText(suggestedStatus, "", 40)
  if (delta === "counter_signal" || signal === "反证" || status === "divergent" || status === "disconfirmed") return "risk"
  if (delta === "market_feedback" || signal === "市场反馈" || status === "priced_in") return "market"
  if (delta === "fundamental_delivery" || delta === "supporting_signal" || delta === "manual_status_update" || signal === "硬证据" || signal === "二次确认" || signal === "人工确认" || status === "strengthening" || status === "actionable") return "support"
  if (delta === "catalyst_signal" || signal === "新催化") return "hot"
  return "watch"
}

function hypothesisTimelineKey(item: Record<string, unknown>) {
  const sourceIdentity = [
    compactDisplayText(item.sourceHash, "", 80),
    compactDisplayText(item.sourceRef, "", 180),
    compactDisplayText(item.eventRef, "", 180),
    compactDisplayText(item.alertRef, "", 180),
    compactDisplayText(item.id, "", 80),
  ].filter(Boolean)
  if (sourceIdentity.length > 0) {
    return [
      compactDisplayText(item.hypothesisId, "", 80),
      ...sourceIdentity,
      compactDisplayText(item.evidenceDelta, "", 80),
      compactDisplayText(item.signalType, "", 80),
    ].filter(Boolean).join(":")
  }
  return [
    compactDisplayText(item.hypothesisId, "", 80),
    compactDisplayText(item.eventTime, "", 80),
    compactDisplayText(item.createdAt, "", 80),
    compactDisplayText(item.evidenceDelta, "", 80),
    compactDisplayText(item.signalType, "", 80),
    compactDisplayText(item.summary ?? item.alertReason ?? item.suggestedStatusReason, "", 120),
  ].filter(Boolean).join(":")
}

function hypothesisTimelineGroupKey(item: Record<string, unknown>) {
  const stableSource = firstFilled(item.sourceHash, item.sourceRef)
  if (stableSource) {
    return [
      compactDisplayText(item.hypothesisId, "", 80),
      compactDisplayText(stableSource, "", 220),
      compactDisplayText(item.evidenceDelta, "", 80),
      compactDisplayText(item.signalType, "", 80),
    ].filter(Boolean).join(":")
  }
  return hypothesisTimelineKey(item)
}

function hypothesisTimelineTimeValue(value: unknown) {
  const text = compactDisplayText(value, "", 80)
  const match = text.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s]+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/)
  if (match) {
    const [, year, month, day, hour = "0", minute = "0", second = "0"] = match
    return Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
    )
  }
  const parsed = Date.parse(text)
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY
}

function compareHypothesisTimelineItemsAsc(left: HypothesisTimelineItem, right: HypothesisTimelineItem) {
  const timeDiff = hypothesisTimelineTimeValue(left.createdAt) - hypothesisTimelineTimeValue(right.createdAt)
  if (timeDiff !== 0) return timeDiff
  return left.createdAt.localeCompare(right.createdAt) || left.key.localeCompare(right.key)
}

function compareHypothesisTimelineItemsDesc(left: HypothesisTimelineItem, right: HypothesisTimelineItem) {
  return compareHypothesisTimelineItemsAsc(right, left)
}

function hypothesisTimelineSourceTypeLabel(item: Record<string, unknown>) {
  const explicit = compactDisplayText(item.sourceType, "", 40)
  const sourceKind = compactDisplayText(item.sourceKindLabel, "", 40)
  const ref = compactDisplayText(item.sourceRef ?? item.discoverySourceRef ?? item.eventRef, "", 260)
  const map: Record<string, string> = {
    wechat: "微信",
    wechat_incremental: "微信",
    research_news: "研报新闻",
    research: "研报新闻",
    gangtise_theme: "产业链复盘",
    gangtise: "产业链复盘",
    announcement: "公告",
    cninfo: "公告",
    tender: "招投标",
    qcc: "招投标",
    financial_report: "财报",
    finance: "财报",
    market: "市场",
    manual_review: "人工确认",
  }
  if (map[explicit]) return map[explicit]
  if (sourceKind) return sourceKind
  if (ref.includes("raw/研报新闻/")) return "研报新闻"
  if (ref.includes("raw/openclaw数据/产业链复盘/gangtise_themes/") || ref.includes("gangtise_themes/")) return "产业链复盘"
  if (ref.includes("raw/微信聊天/") || ref.includes("wechat-inbox/")) return "微信"
  if (/cninfo|公告/i.test(ref)) return "公告"
  if (/qcc|企查查|招投标/.test(ref)) return "招投标"
  if (compactDisplayText(item.evidenceDelta, "", 40) === "market_feedback") return "市场"
  return "新增资料"
}

function hypothesisTimelineSignalStrengthLabel(item: Record<string, unknown>) {
  const explicit = compactDisplayText(item.signalStrength, "", 40).toLowerCase()
  const explicitMap: Record<string, string> = {
    low: "低强度",
    medium: "中强度",
    mid: "中强度",
    high: "高强度",
    weak: "低强度",
    strong: "高强度",
    "低": "低强度",
    "中": "中强度",
    "高": "高强度",
  }
  if (explicitMap[explicit]) return explicitMap[explicit]
  const signal = signalBadgeLabel({ signalType: item.signalType, evidenceDelta: item.evidenceDelta })
  const delta = compactDisplayText(item.evidenceDelta, "", 40)
  const status = compactDisplayText(item.suggestedStatus ?? item.newStatus ?? item.feedbackStatus, "", 40)
  if (delta === "fundamental_delivery" || signal === "硬证据" || status === "actionable") return "高强度"
  if (delta === "counter_signal" || signal === "反证" || status === "disconfirmed" || status === "divergent") return "高强度"
  if (delta === "market_feedback" || delta === "supporting_signal" || delta === "mixed_signal" || signal === "市场反馈" || signal === "二次确认" || status === "priced_in" || status === "strengthening") return "中强度"
  return "低强度"
}

function normalizeHypothesisTimelineRecord(
  kind: HypothesisTimelineItem["kind"],
  hypothesis: Record<string, unknown>,
  item: Record<string, unknown>,
): HypothesisTimelineItem {
  const source = sourcePreview(item.sourceExcerpt, item.sourceRef)
  const askRunRef = compactDisplayText(item.askRunRef, "", 260)
  const currentStatus = item.currentStatus ?? item.statusBefore ?? item.previousStatus ?? item.status ?? hypothesis.status
  const suggestedStatus = item.suggestedStatus ?? item.newStatus ?? item.feedbackStatus ?? item.status ?? hypothesis.status
  const manualReview = textValue(item.sourceType) === "manual_review" || textValue(item.sourceKindLabel) === "人工确认"
  const reason = manualReview
    ? firstFilled(item.reason, item.suggestedStatusReason, item.alertReason, item.summary, item.tradingImplication)
    : firstFilled(item.tradingImplication, item.reason, item.suggestedStatusReason, item.alertReason, item.summary)
  const detail = manualReview
    ? firstFilled(readerFacingReason(reason), item.tradingImplication)
    : firstFilled(
      item.tradingImplication,
      readerFacingReason(reason),
      buildSignalCardTradeLine({
        tradingImplication: item.tradingImplication,
        signalType: item.signalType,
        evidenceDelta: item.evidenceDelta,
        reason,
      }),
    )
  return {
    key: `${kind}:${hypothesisTimelineKey(item)}`,
    kind,
    badge: signalBadgeLabel({ signalType: item.signalType, evidenceDelta: item.evidenceDelta }),
    transition: hypothesisStatusTransitionLabel(currentStatus, suggestedStatus),
    detail: compactDisplayText(detail, "", 180),
    excerpt: compactDisplayText(source.body, "", 180),
    sourceLabel: manualReview ? "人工确认" : sourceBadgeWithKind(source.meta || source.refLabel, item.sourceKindLabel),
    sourceTypeLabel: manualReview ? "人工确认" : hypothesisTimelineSourceTypeLabel(item),
    signalStrengthLabel: hypothesisTimelineSignalStrengthLabel(item),
    sourceTitle: compactDisplayText(item.sourceRef, "", 260),
    askRunRef: askRunRef || undefined,
    mergedCount: 1,
    createdAt: compactDisplayText(item.eventTime ?? item.createdAt ?? item.updatedAt, "", 80),
    tone: hypothesisTimelineTone({ signalType: item.signalType, evidenceDelta: item.evidenceDelta, suggestedStatus }),
  }
}

export function buildHypothesisTimelineItems(
  hypothesis: unknown,
  signal: unknown = {},
  options: { limit?: number } = {},
): HypothesisTimelineItem[] {
  const record = unknownRecord(hypothesis)
  const signalRecord = unknownRecord(signal)
  const records: Array<{ kind: HypothesisTimelineItem["kind"]; item: Record<string, unknown> }> = [
    ...arrayRecords(record.recentEvents ?? record.events).map((item) => ({ kind: "event" as const, item })),
    ...arrayRecords(record.openAlerts).map((item) => ({ kind: "alert" as const, item })),
  ]
  if (firstFilled(signalRecord.sourceRef, signalRecord.sourceExcerpt, signalRecord.eventRef, signalRecord.eventTime, signalRecord.createdAt, signalRecord.tradingImplication)) {
    records.push({ kind: "signal", item: signalRecord })
  }

  const byKey = new Map<string, HypothesisTimelineItem>()
  for (const { kind, item } of records) {
    const normalized = normalizeHypothesisTimelineRecord(kind, record, item)
    const semanticKey = hypothesisTimelineGroupKey(item)
    const existing = byKey.get(semanticKey)
    const mergedCount = (existing?.mergedCount ?? 0) + 1
    if (!existing || compareHypothesisTimelineItemsDesc(normalized, existing) < 0 || (existing.kind === "alert" && normalized.kind === "event")) {
      normalized.mergedCount = mergedCount
      byKey.set(semanticKey, normalized)
    } else {
      byKey.set(semanticKey, { ...existing, mergedCount })
    }
  }

  const limit = Math.max(1, Math.min(8, Math.floor(numberValue(options.limit) || 3)))
  return [...byKey.values()]
    .sort(compareHypothesisTimelineItemsDesc)
    .slice(0, limit)
}

function hypothesisTimelineNextAction(latest: HypothesisTimelineItem | null) {
  if (!latest) return "先扫描新增资料；有新催化、二次确认或市场反馈后，再决定是否 Ask 深挖。"
  if (latest.tone === "market") return "点 Ask 深挖，先判断这是 priced-in 风险还是刚开始扩散。"
  if (latest.tone === "risk") return "先看反证来源，必要时不要确认升级，改做背离复核。"
  if (latest.tone === "support") return "可以考虑确认状态变化，但先复核来源、公告/订单和量价反馈。"
  if (latest.tone === "hot") return "点 Ask 深挖，先排关联股票、直接受益和利好排序。"
  return "继续观察；等待更强的新催化、硬证据或市场反馈。"
}

function hypothesisTimelineTrajectoryLine(status: unknown, items: HypothesisTimelineItem[]) {
  const labels: string[] = []
  const chronological = [...items].sort(compareHypothesisTimelineItemsAsc)
  for (const item of chronological) {
    const parts = item.transition.split("->").map((part) => part.trim()).filter(Boolean)
    if (parts.length === 0) continue
    labels.push(...parts)
  }
  if (labels.length === 0) labels.push(hypothesisStatusLabel(status))
  const compact = labels.filter(Boolean).filter((label, index, rows) => index === 0 || label !== rows[index - 1])
  return compact.length ? compact.join(" -> ") : "状态待补"
}

export function buildHypothesisTimelineBrief(
  hypothesis: unknown,
  signal: unknown = {},
  options: { limit?: number } = {},
): HypothesisTimelineBrief {
  const record = unknownRecord(hypothesis)
  const title = compactDisplayText(record.title, "已选假设", 120)
  const statusLabel = hypothesisStatusLabel(record.status)
  const items = buildHypothesisTimelineItems(record, signal, { limit: options.limit ?? 5 })
  const latest = items[0] ?? null
  if (!latest) {
    return {
      show: Boolean(title),
      title,
      statusLabel,
      headline: "还没有新增资料轨迹",
      detail: `「${title}」目前只有假设卡本身；先扫描新增资料或 Ask 深挖，后续命中会沉淀为轨迹。`,
      trajectoryLine: hypothesisTimelineTrajectoryLine(record.status, []),
      nextAction: hypothesisTimelineNextAction(null),
      itemCount: 0,
      latest: null,
      items: [],
      tone: "empty",
    }
  }
  const source = latest.sourceLabel || latest.createdAt || "来源待补"
  const latestDetail = latest.detail || latest.excerpt || "暂无摘要"
  return {
    show: true,
    title,
    statusLabel,
    headline: `最新：${latest.badge} · ${latest.transition}`,
    detail: `状态路径：${latest.transition}；${source}：${latestDetail}`,
    trajectoryLine: hypothesisTimelineTrajectoryLine(record.status, items),
    nextAction: hypothesisTimelineNextAction(latest),
    itemCount: items.length,
    latest,
    items,
    tone: latest.tone,
  }
}

export function sourceRefLabel(sourceRef: unknown) {
  const ref = textValue(sourceRef).trim()
  if (!ref) return ""
  const wechatMatch = ref.match(/wechat-inbox\/processed\/(\d{4}-\d{2}-\d{2})\.jsonl#msg:([^:]+):([^:]+):([^#\s]+)/)
  if (wechatMatch) return `微信已处理 ${wechatMatch[1]} · ${wechatMatch[2]}`
  const agentMatch = ref.match(/agent-runs\/([^/]+)\//)
  if (agentMatch) return `agent-run ${agentMatch[1]}`
  const basename = ref.split(/[\\/]/).filter(Boolean).at(-1) ?? ref
  if (ref.includes("raw/研报新闻/")) return `研报新闻 · ${basename}`
  if (ref.includes("raw/openclaw数据/产业链复盘/gangtise_themes/") || ref.includes("gangtise_themes/")) return `产业链复盘 · ${basename}`
  if (ref.includes("raw/微信聊天/")) return `微信文档 · ${basename}`
  return ref.replace(/^\.llm-wiki\//, "").slice(0, 120)
}

export function sourcePreview(excerpt: unknown, sourceRef?: unknown): SourcePreview {
  const rawExcerpt = compactDisplayText(excerpt, "", 280)
  const refLabel = sourceRefLabel(sourceRef)
  const incrementMatch = rawExcerpt.match(/^(微信增量|研报新闻增量|产业链复盘增量|新增资料)\s+chat=(.+?)\s+sentAt=(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\s+([\s\S]*)$/)
  if (incrementMatch) {
    const [, sourceLabel, chatName, sentAt, body] = incrementMatch
    const sourceName = sourceLabel.replace(/增量$/, "")
    const metaSource = chatName === sourceName || chatName.startsWith(`${sourceName} ·`)
      ? chatName
      : `${sourceName} ${chatName}`
    return {
      meta: `${metaSource} · ${sentAt}`,
      body: compactDisplayText(body, "", 240),
      refLabel,
    }
  }
  return {
    meta: refLabel,
    body: rawExcerpt,
    refLabel,
  }
}

function pmSourceBadge(preview: SourcePreview) {
  const meta = compactDisplayText(preview.meta, "", 120)
  if (!meta) return ""
  const wechatProcessed = meta.match(/^微信(?:已处理| processed) (\d{4}-\d{2}-\d{2})/)
  if (wechatProcessed) return `微信 ${wechatProcessed[1]}`
  if (meta.startsWith("agent-run ")) return `多智能体 ${meta.replace(/^agent-run\s+/, "")}`
  if (meta.includes("/") || meta.includes(".jsonl") || meta.includes(".llm-wiki")) return "审计来源"
  return meta
}

function sourceBadgeWithKind(base: unknown, sourceKindLabel?: unknown) {
  const label = compactDisplayText(sourceKindLabel, "", 60)
  const badge = compactDisplayText(base, "", 120)
  if (!label) return badge
  if (!badge || badge === "审计来源") return label
  if (/^微信/.test(label) && /^微信/.test(badge)) return badge
  if (/^微信(已处理| processed|\s+\d{4}-\d{2}-\d{2})/.test(badge)) return label
  if (badge.includes(label)) return badge
  return `${label} · ${badge}`
}

function sourceAuditDisplayLabel(preview: SourcePreview, sourceKindLabel?: unknown) {
  const label = compactDisplayText(preview.refLabel, "", 160)
  const kind = compactDisplayText(sourceKindLabel, "", 60)
  if (!label) return ""
  if (label.includes("hypothesis-events")) return "审计来源 · hypothesis-events"
  if (label.includes("hypothesis-alerts")) return "审计来源 · hypothesis-alerts"
  if (label.includes("agent-runs")) return "审计来源 · agent-runs"
  const processedMatch = label.match(/^微信(?:已处理| processed) (\d{4}-\d{2}-\d{2})(.*)$/)
  if (processedMatch && kind && !/^微信/.test(kind)) return `${kind} · 已处理 ${processedMatch[1]}${processedMatch[2]}`
  if (label.includes("/") || label.includes(".jsonl") || label.includes(".llm-wiki")) return pmSourceBadge(preview) || "审计来源"
  return label
}

export function buildSignalCardSourceCopy({
  sourceExcerpt,
  sourceRef,
  sourceKindLabel,
  reason,
}: {
  sourceExcerpt?: unknown
  sourceRef?: unknown
  sourceKindLabel?: unknown
  reason?: unknown
}): SignalCardSourceCopy {
  const preview = sourcePreview(sourceExcerpt, sourceRef)
  const visibleReason = readerFacingReason(reason)
  return {
    badge: sourceBadgeWithKind(pmSourceBadge(preview), sourceKindLabel),
    excerpt: compactDisplayText(preview.body, "", 220),
    reason: compactDisplayText(visibleReason, "", 180),
    auditLabel: sourceAuditDisplayLabel(preview, sourceKindLabel),
    auditTitle: compactDisplayText(sourceRef, "", 260),
  }
}

export function buildSignalCardTradeLine({
  tradingImplication,
  signalType,
  evidenceDelta,
  reason,
}: SignalCardTradeLineInput) {
  const explicit = compactDisplayText(tradingImplication, "", 180)
  if (explicit) return explicit
  const signal = compactDisplayText(signalType, "", 40)
  const delta = compactDisplayText(evidenceDelta, "", 40)
  if (signal === "新催化" || delta === "catalyst_signal") {
    return "新催化进入跟踪，先看扩散强度、量价反馈和二次来源。"
  }
  if (signal === "二次确认" || delta === "supporting_signal") {
    return "二次确认增强关注度，下一步看是否能推动状态升级。"
  }
  if (signal === "市场反馈" || delta === "market_feedback") {
    return "市场已经开始反应，重点判断是早期扩散还是已经定价。"
  }
  if (signal === "硬证据" || delta === "fundamental_delivery") {
    return "出现硬证据线索，先复核原文，再看订单、交付或收入确认。"
  }
  if (signal === "反证" || delta === "counter_signal") {
    return "出现反向信息，先暂停当作利好，必要时下调假设状态。"
  }
  if (signal === "叙事扩散" || delta === "narrative_expansion") {
    return "目前更像叙事扩散，先观察，不急着升级假设。"
  }
  return compactDisplayText(readerFacingReason(reason), "相关但不急，等待更明确的新催化、市场反馈或硬证据。", 180)
}

export function buildSignalEvidenceToggleCopy({
  relatedWikiPages,
  sourceExcerpt,
  sourceRef,
  reason,
  matchedSegments,
  matchedEntities,
  catalystTags,
  priorityReasons,
}: {
  relatedWikiPages?: unknown
  sourceExcerpt?: unknown
  sourceRef?: unknown
  reason?: unknown
  matchedSegments?: unknown
  matchedEntities?: unknown
  catalystTags?: unknown
  priorityReasons?: unknown
}): SignalEvidenceToggleCopy {
  const wikiCount = arrayRecords(relatedWikiPages).length
  const source = buildSignalCardSourceCopy({ sourceExcerpt, sourceRef, reason })
  const hasSource = Boolean(source.badge || source.excerpt || source.auditLabel)
  const hasReason = Boolean(source.reason)
  const segmentCount = stringList(matchedSegments).length
  const entityCount = stringList(matchedEntities).length
  const catalystCount = stringList(catalystTags).length
  const priorityCount = stringList(priorityReasons).length
  const parts = [
    wikiCount > 0 ? `wiki框架 ${wikiCount}` : "",
    hasSource ? "来源原文" : "",
    segmentCount + entityCount + catalystCount > 0 ? "SAG词" : "",
    priorityCount > 0 ? "优先级理由" : "",
    hasReason ? "判断理由" : "",
  ].filter(Boolean)
  const shortParts = parts.slice(0, 3)
  return {
    label: shortParts.length ? `证据和来源 · ${shortParts.join(" / ")}` : "证据和来源",
    detail: parts.length
      ? "来源、wiki命中、关键词和理由已收起；展开只用于复核，不影响当前主动作。"
      : "暂无结构化证据细节；先看交易含义和下一步动作。",
    title: parts.length ? parts.join("；") : "暂无结构化证据细节",
  }
}

export function signalSourceSummary({
  tradingImplication,
  sourceExcerpt,
  sourceRef,
  reason,
}: {
  tradingImplication?: unknown
  sourceExcerpt?: unknown
  sourceRef?: unknown
  reason?: unknown
}) {
  const preview = sourcePreview(sourceExcerpt, sourceRef)
  return compactDisplayText(tradingImplication, "", 180)
    || compactDisplayText(preview.body, "", 180)
    || compactDisplayText(readerFacingReason(reason), "", 180)
    || preview.meta
}

function meaningfulSignalKeyword(value: unknown) {
  const text = compactDisplayText(value, "", 32)
  if (!text) return ""
  if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(text)) return ""
  if (/^\d+[.)、]?$/.test(text)) return ""
  if (/^(AI|ai|A股|产业链|公司|市场|来源|消息|今日|昨天|明天|建议|关注|预期差)$/.test(text)) return ""
  return text
}

function compactSignalKeywords(values: unknown[], limit = 4) {
  const rawTerms = values
    .flatMap((value) => stringList(value))
    .map(meaningfulSignalKeyword)
    .filter(Boolean)
  const deduped = Array.from(new Set(rawTerms))
  const withoutSubsumed = deduped.filter((term) => {
    if (term.length >= 4) return true
    return !deduped.some((other) => other !== term && other.includes(term) && other.length > term.length)
  })
  return withoutSubsumed.slice(0, limit)
}

function signalKeywordsExcluding(values: unknown[], excluded: Set<string>, limit = 3) {
  return compactSignalKeywords(values, limit + excluded.size)
    .filter((term) => !excluded.has(term))
    .slice(0, limit)
}

export function buildSignalKeywordLine(input: SignalKeywordLineInput): SignalKeywordLine {
  const relatedPages = arrayRecords(input.relatedWikiPages)
  const relatedTerms = relatedPages.flatMap((page) => stringList(page.matchedTerms))
  const financeTerms = compactSignalKeywords([
    relatedPages.flatMap((page) => stringList(page.financeAuditMatchedTerms)),
    relatedPages.flatMap((page) => stringList(page.matchedFinanceAuditTerms)),
  ], 3)
  const financeSet = new Set(financeTerms)
  const wikiTerms = signalKeywordsExcluding([relatedTerms], financeSet, 3)
  const wikiSet = new Set([...financeSet, ...wikiTerms])
  const sourceTerms = signalKeywordsExcluding([
    input.matchedSegments,
    input.matchedEntities,
    input.segments,
    input.keyVariables,
    input.catalystTags,
  ], wikiSet, 3)
  const layers: SignalKeywordLine["layers"] = []
  if (sourceTerms.length) layers.push({ label: "原文/假设词", terms: sourceTerms, tone: "source" })
  if (wikiTerms.length) layers.push({ label: "wiki表头/页面", terms: wikiTerms, tone: "wiki" })
  if (financeTerms.length) layers.push({ label: "SAG金融词", terms: financeTerms, tone: "finance" })
  const terms = compactSignalKeywords([financeTerms, wikiTerms, sourceTerms])
  if (!terms.length) {
    return {
      show: false,
      label: "命中关键词",
      terms: [],
      layers: [],
      detail: "还没有足够明确的产业词，先看原文摘录或用 Ask 建框架。",
      tone: "weak",
    }
  }
  const hasWikiBacklink = relatedPages.length > 0
  const hasFinanceLayer = financeTerms.length > 0
  return {
    show: true,
    label: "命中关键词",
    terms,
    detail: hasWikiBacklink
      ? hasFinanceLayer
        ? "已把原文信号回连到 wiki，并用 SAG 金融词表补强细分产业词；Ask 会围绕对应框架排关联股票、直接受益和利好顺序。"
        : "已用这些词回连 wiki；Ask 会围绕对应框架排关联股票、直接受益和利好顺序。"
      : "只识别到产业词，尚未回连 wiki；Ask 可先建框架，再决定是否加入跟踪。",
    layers,
    tone: hasFinanceLayer ? "finance" : hasWikiBacklink ? "wiki" : "entity",
  }
}

export function pendingTodoPriorityScore(input: PendingSignalPriorityInput) {
  const evidenceDelta = textValue(input.evidenceDelta)
  const signalType = textValue(input.signalType)
  const relatedWikiCount = Math.max(numberValue(input.relatedWikiCount), arrayRecords(input.relatedWikiPages).length)
  let score = 0
  if (input.canConfirm) score += 100
  if (input.askDeepDiveRecommended) score += 50
  if (evidenceDelta === "fundamental_delivery") score += 30
  if (evidenceDelta === "catalyst_signal") score += 24
  if (evidenceDelta === "supporting_signal") score += 20
  if (evidenceDelta === "market_feedback") score += 18
  if (evidenceDelta === "counter_signal") score += 18
  if (signalType === "硬证据") score += 18
  if (signalType === "新催化") score += 12
  if (signalType === "二次确认") score += 10
  if (relatedWikiCount > 0) score += 4
  score += wikiMetaPriorityBoost(input.relatedWikiPages)
  score += financeEntityPriorityBoost(financeEntityRecordsForSignal(input))
  if (evidenceDelta === "narrative_expansion" || signalType === "叙事扩散") score -= 8
  return score
}

export function pendingCandidatePriorityScore(input: PendingSignalPriorityInput) {
  const evidenceDelta = textValue(input.evidenceDelta)
  const signalType = textValue(input.signalType)
  const relatedWikiCount = Math.max(numberValue(input.relatedWikiCount), arrayRecords(input.relatedWikiPages).length)
  let score = numberValue(input.priorityScore)
  if (input.askDeepDiveRecommended) score += 50
  if (evidenceDelta === "catalyst_signal") score += 20
  if (signalType === "新催化") score += 12
  if (signalType === "硬证据") score += 18
  if (numberValue(input.clusterSourceCount) > 1) score += 12
  if (relatedWikiCount > 0) score += 4
  score += wikiMetaPriorityBoost(input.relatedWikiPages)
  score += financeEntityPriorityBoost(financeEntityRecordsForSignal(input))
  if (evidenceDelta === "narrative_expansion" || signalType === "叙事扩散") score -= 8
  return score
}

export function isPriorityPendingSignal(score: number) {
  return score >= 20
}

export function isWeakSignalTitle(value: unknown) {
  const title = compactDisplayText(value, "", 120)
  if (!title) return true
  if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(title)) return true
  if (/^\d+[.)、]?$/.test(title)) return true
  if (/^[一二三四五六七八九十]+[.)、]?$/.test(title)) return true
  const parts = title.split(/[\s,，、/|｜]+/).map((part) => part.trim()).filter(Boolean)
  const broadTerms = new Set([
    "ai",
    "AI",
    "A股",
    "个股",
    "产业链",
    "预期差",
    "自主可控",
    "芯片",
    "半导体",
    "上海",
    "涨停",
    "情绪",
    "机器人",
  ])
  if (parts.length > 0 && parts.every((part) => broadTerms.has(part))) return true
  return title.length <= 2 && !/[A-Za-z]{3,}/.test(title)
}

export function buildRelatedWikiSummary({
  pages,
  evidenceDelta,
  signalType,
}: {
  pages: unknown
  evidenceDelta?: unknown
  signalType?: unknown
}): RelatedWikiSummary {
  const visiblePages = arrayRecords(pages)
  const count = visiblePages.length
  const delta = textValue(evidenceDelta)
  const signal = textValue(signalType)
  const relation = (() => {
    if (delta === "counter_signal" || signal === "反证") {
      return {
        label: "反证回连",
        tone: "counter" as const,
        summary: "新增信息与既有 wiki 发生反向关联，优先复核是否削弱原假设。",
      }
    }
    if (delta === "fundamental_delivery" || signal === "硬证据") {
      return {
        label: "支撑回连",
        tone: "support" as const,
        summary: "新增信息回连到既有 wiki 的订单、公告、交付或财务线索，可作为证据增强入口。",
      }
    }
    if (delta === "catalyst_signal" || signal === "新催化") {
      return {
        label: "催化回连",
        tone: "catalyst" as const,
        summary: "新增催化已回连到既有 wiki 主题，先看二次确认、扩散强度和量价反馈。",
      }
    }
    if (delta === "market_feedback" || signal === "市场反馈") {
      return {
        label: "市场回连",
        tone: "market" as const,
        summary: "新增信息更像市场反馈回连，注意区分价格先动和基本面兑现。",
      }
    }
    if (delta === "narrative_expansion" || signal === "叙事扩散") {
      return {
        label: "扩散回连",
        tone: "narrative" as const,
        summary: "新增信息回连到既有叙事，但暂时不足以证明订单或财报兑现。",
      }
    }
    return {
      label: "仅相关",
      tone: "relevant" as const,
      summary: "新增信息只证明和既有 wiki 主题相关，还不能判断支持或反证。",
    }
  })()
  const topTerms = Array.from(new Set(
    visiblePages.flatMap((page) => stringList(page.matchedTerms)),
  )).slice(0, 3).join("/")
  return {
    ...relation,
    count,
    countText: `${count} 个 wiki`,
    topTerms,
  }
}

export function buildRelatedWikiEmptyHint({
  evidenceDelta,
  signalType,
}: {
  evidenceDelta?: unknown
  signalType?: unknown
}): RelatedWikiEmptyHint {
  const delta = textValue(evidenceDelta)
  const signal = textValue(signalType)
  if (delta === "catalyst_signal" || signal === "新催化") {
    return {
      label: "无强 wiki 回连",
      detail: "这更像新变量；先 Ask 深挖，或把它加入假设池后补一个概念框架。",
    }
  }
  if (delta === "market_feedback" || signal === "市场反馈") {
    return {
      label: "无强 wiki 回连",
      detail: "价格先动但缺少框架页；先确认标的和主题归属，再判断是否 priced-in。",
    }
  }
  if (delta === "counter_signal" || signal === "反证") {
    return {
      label: "无强 wiki 回连",
      detail: "反向信息未命中既有框架；先 Ask 查证来源，再决定是否影响假设。",
    }
  }
  return {
    label: "未命中强框架",
    detail: "系统没有找到足够具体的 wiki 页面；宁可留空，也不硬连泛页面。",
  }
}

function hasHypothesisAskSignalContext(context: HypothesisAskQueryContext) {
  return Boolean(
    textValue(context.sourceExcerpt)
    || textValue(context.tradingImplication)
    || textValue(context.signalType)
    || textValue(context.evidenceDelta),
  )
}

export function buildHypothesisAskActionLabel(context: HypothesisAskQueryContext = {}): HypothesisAskActionLabel {
  if (numberValue(context.relatedWikiCount) === 0 && hasHypothesisAskSignalContext(context)) {
    return {
      label: "Ask 建框架",
      title: "新增信号没有强 wiki 回连，先生成主题框架、关联股票和验证变量。",
    }
  }
  return {
    label: "Ask 深挖",
    title: "基于既有假设做多源检索，检查关联股票、利好排序、阶段和缺口。",
  }
}

export function buildHypothesisAskQuery(
  hypothesis: Record<string, unknown>,
  context: HypothesisAskQueryContext = {},
) {
  const relatedWikiCount = Math.max(numberValue(context.relatedWikiCount), arrayRecords(context.relatedWikiPages).length)
  const noStrongWiki = relatedWikiCount === 0 && hasHypothesisAskSignalContext(context)
  const lines = [
    `围绕假设「${textValue(hypothesis.title)}」做多源检索深挖。`,
    noStrongWiki
      ? "当前新增信号没有强 wiki 回连，请先补一版主题框架：产业链位置、受益环节、候选股票、验证变量和后续应建的 wiki 框架页。"
      : "请优先回答：关联股票有哪些、谁最直接受益、利好排序如何、是否已有量价反馈、是否只是新催化或叙事扩散。",
    "回答保留六段结构：结论、证据链、分歧/反证、后续验证、交易含义、引用来源。",
    `主题：${textValue(hypothesis.theme, "n/a")}`,
    `细分：${stringList(hypothesis.segments).join(", ") || "n/a"}`,
    `当前状态：${textValue(hypothesis.status, "n/a")}；反馈状态：${textValue(hypothesis.feedbackStatus, "n/a")}`,
  ]
  const signalType = textValue(context.signalType)
  const tradingImplication = compactDisplayText(context.tradingImplication, "", 160)
  const sourceExcerpt = compactDisplayText(context.sourceExcerpt, "", 220)
  const sourceRef = compactDisplayText(context.sourceRef, "", 160)
  const wikiFrame = buildWikiFrameFirstLookCopy(buildWikiFrameDecisionLine({
    pages: context.relatedWikiPages,
    evidenceDelta: context.evidenceDelta,
    signalType: context.signalType,
    askDeepDiveRecommended: true,
  }))
  if (signalType) lines.push(`新增信号类型：${signalType}`)
  if (tradingImplication) lines.push(`当前交易含义：${tradingImplication}`)
  if (sourceExcerpt) lines.push(`新增信号摘录：${sourceExcerpt}`)
  if (sourceRef) lines.push(`新增来源：${sourceRef}`)
  if (relatedWikiCount > 0) lines.push(`已回连 wiki：${relatedWikiCount} 个；请优先基于这些框架判断。`)
  if (wikiFrame.show) {
    lines.push(`wiki表头框架：${wikiFrame.label} · ${wikiFrame.detail}`)
    if (wikiFrame.next) lines.push(`wiki表头动作：${wikiFrame.next}`)
  }
  return compactDisplayText(lines.join("\n"), "", 980)
}

export function buildCandidateAskPrecheckQuery(candidate: CandidateAskPrecheckContext) {
  const relatedWikiCount = numberValue(candidate.relatedWikiCount)
  const title = textValue(candidate.title, "未命名候选假设")
  const lines = [
    `请对候选假设「${title}」做 Ask 预检。`,
    "注意：这是候选信号筛选，不要把它当作已入池假设；请判断它是否值得加入跟踪。",
    relatedWikiCount > 0
      ? `已有 ${relatedWikiCount} 个 wiki 回连，请优先检查这些框架是否支持它。`
      : "当前没有强 wiki 回连，请先补主题框架，再判断是否值得入池。",
    "先给结构化摘要：关联股票、最直接受益、利好排序、当前阶段、最大缺口、一句话结论、是否建议加入跟踪。",
    "再保留六段结构：结论、证据链、分歧/反证、后续验证、交易含义、引用来源。",
    `主题：${textValue(candidate.theme, "n/a")}`,
    `细分：${stringList(candidate.segments).join(", ") || "n/a"}`,
    `周期：${textValue(candidate.timeHorizon, "n/a")}`,
  ]
  const signalType = textValue(candidate.signalType)
  const tradingImplication = compactDisplayText(candidate.tradingImplication, "", 160)
  const reason = compactDisplayText(candidate.reason, "", 160)
  const sourceExcerpt = compactDisplayText(candidate.sourceExcerpt, "", 220)
  const sourceRef = compactDisplayText(candidate.sourceRef, "", 160)
  if (signalType) lines.push(`新增信号类型：${signalType}`)
  if (tradingImplication) lines.push(`当前交易含义：${tradingImplication}`)
  if (reason) lines.push(`规则层理由：${reason}`)
  if (sourceExcerpt) lines.push(`新增信号摘录：${sourceExcerpt}`)
  if (sourceRef) lines.push(`新增来源：${sourceRef}`)
  return compactDisplayText(lines.join("\n"), "", 980)
}

export function buildCandidatePrecheckAdoptionCopy({
  isPrecheck,
  hasCandidate,
  adoptedId,
  adoptedTitle,
}: {
  isPrecheck?: boolean
  hasCandidate?: boolean
  adoptedId?: unknown
  adoptedTitle?: unknown
}): CandidatePrecheckAdoptionCopy {
  if (!isPrecheck) {
    return {
      subtitle: "",
      canAdopt: false,
      canScan: false,
      adoptedLabel: "",
      detail: "",
    }
  }
  const adopted = compactDisplayText(adoptedId, "", 80) || compactDisplayText(adoptedTitle, "", 80)
  if (adopted) {
    return {
      subtitle: "候选信号已加入跟踪；后续可用新增资料继续更新状态。",
      canAdopt: false,
      canScan: true,
      adoptedLabel: `已采纳：${adopted}`,
      detail: "下一步可只扫这条假设；状态变化仍需人工确认。",
    }
  }
  return {
    subtitle: "候选信号仍未入池；看完预检后再决定是否加入跟踪。",
    canAdopt: Boolean(hasCandidate),
    canScan: false,
    adoptedLabel: "",
    detail: "确认后只写假设库，不写 wiki/raw。",
  }
}

export function buildScanScopeSummary({
  selectedId,
  selectedTitle,
}: {
  selectedId?: unknown
  selectedTitle?: unknown
}): ScanScopeSummary {
  const id = compactDisplayText(selectedId, "", 120)
  if (!id) {
    return {
      label: "扫描全部假设",
      detail: "适合每天开盘前或收盘后扫全部新增资料；噪声会更多。",
      tone: "all",
    }
  }
  const title = compactDisplayText(selectedTitle, id, 34)
  return {
    label: "只扫当前假设",
    detail: `本轮只把新增资料路由到「${title}」，反馈更快、噪声更少。`,
    tone: "scoped",
  }
}

export function buildScanKey({ rawChatSource, since, hypothesisId }: ScanKeyInput) {
  return [
    compactDisplayText(rawChatSource, "raw/微信聊天", 240).trim() || "raw/微信聊天",
    compactDisplayText(since, "30m", 40).trim() || "30m",
    compactDisplayText(hypothesisId, "*", 120).trim() || "*",
  ].join("|")
}

export function buildScanModeSummary({ autoRefresh, scoped }: { autoRefresh?: boolean; scoped?: boolean }): ScanModeSummary {
  if (autoRefresh) {
    if (scoped) {
      return {
        label: "自动只扫当前",
        shortLabel: "只扫规则",
        buttonLabel: "自动跟踪",
        detail: "每 30 秒只检查新增资料变化，并把新增资料规则路由到当前假设；不自动调用 LLM，也不自动改状态。",
        tone: "auto-rules",
      }
    }
    return {
      label: "自动规则快扫",
      shortLabel: "规则快扫",
      buttonLabel: "自动跟踪",
      detail: "每 30 秒只做文件变化检查、导入、去重和规则路由；不自动调用 LLM，也不自动改状态。",
      tone: "auto-rules",
    }
  }
  if (scoped) {
    return {
      label: "只扫当前+AI复核",
      shortLabel: "只扫+AI",
      buttonLabel: "只扫这条+AI复核",
      detail: "点击后只把新增资料路由到当前假设，再让 LLM 复核少量候选；反馈更快、噪声更少。",
      tone: "manual-ai",
    }
  }
  return {
    label: "手动扫描+AI复核",
    shortLabel: "AI复核",
    buttonLabel: "扫描+AI复核",
    detail: "点击后先导入新增资料，再只把规则层筛出的少量候选交给 LLM 判断；状态仍需人工确认。",
    tone: "manual-ai",
  }
}

export function buildEffectiveLlmReviewMode({
  requestedMode,
  rawRecordsWritten,
  processedMessagesWritten,
  repeatedScan,
}: {
  requestedMode?: unknown
  rawRecordsWritten?: unknown
  processedMessagesWritten?: unknown
  repeatedScan?: boolean
}): EffectiveLlmReviewMode {
  const modeText = compactDisplayText(requestedMode, "auto", 20).toLowerCase()
  const mode = modeText === "force" ? "force" : modeText === "off" ? "off" : "auto"
  if (mode === "force") {
    return {
      mode,
      skipped: false,
      reason: "",
      detail: "强制 LLM 复核候选卡片；不会自动改状态。",
    }
  }
  if (mode === "off") {
    return {
      mode,
      skipped: false,
      reason: "",
      detail: "本轮只做规则快扫；不会调用 LLM。",
    }
  }

  const imported = numberValue(rawRecordsWritten)
  const processed = numberValue(processedMessagesWritten)
  if (repeatedScan && imported <= 0 && processed <= 0) {
    return {
      mode: "off",
      skipped: true,
      reason: "no_new_signal_messages",
      detail: "同一范围没有新增资料，跳过 LLM 复核；仍执行规则扫描。",
    }
  }
  return {
    mode: "auto",
    skipped: false,
    reason: "",
    detail: "有新增资料，只把规则层候选交给 LLM 复核。",
  }
}

export function buildWatchReviewPasses({
  writeAlerts,
  reviewMode,
}: {
  writeAlerts?: boolean
  reviewMode?: unknown
}): WatchReviewPass[] {
  const modeText = compactDisplayText(reviewMode, "auto", 20).toLowerCase()
  const mode = modeText === "force" ? "force" : modeText === "off" ? "off" : "auto"
  if (writeAlerts) {
    return [{ mode: "off", phase: "rules", label: "确认写入" }]
  }
  if (mode === "auto") {
    return [
      { mode: "off", phase: "rules", label: "规则快扫" },
      { mode: "auto", phase: "llm", label: "LLM复核" },
    ]
  }
  return [{
    mode,
    phase: mode === "force" ? "llm" : "rules",
    label: mode === "force" ? "LLM复核" : "规则快扫",
  }]
}

export function shouldRunLlmReviewAfterRules({
  reviewMode,
  eventCount,
  candidateCount,
}: LlmReviewAfterRulesInput) {
  const mode = compactDisplayText(reviewMode, "", 20).toLowerCase()
  if (mode !== "auto") return false
  return numberValue(eventCount) + numberValue(candidateCount) > 0
}

export function buildReviewModeSummary({
  llmReviewStatus,
  llmReviewReason,
  llmReviewError,
  autoRefresh,
  running,
  runningKind,
  ruleResultCount,
}: {
  llmReviewStatus?: unknown
  llmReviewReason?: unknown
  llmReviewError?: unknown
  autoRefresh?: boolean
  running?: boolean
  runningKind?: unknown
  ruleResultCount?: unknown
}): ReviewModeSummary {
  const status = compactDisplayText(llmReviewStatus, "", 40).toLowerCase()
  const reason = compactDisplayText(llmReviewReason, "", 80).toLowerCase()
  const kind = compactDisplayText(runningKind, "", 40).toLowerCase()
  const visibleRuleResults = Math.max(0, numberValue(ruleResultCount))
  if (running) {
    if (kind !== "llm") {
      return {
        label: kind === "operation" ? "操作执行中" : "扫描更新中",
        detail: kind === "operation"
          ? "当前操作正在执行；完成后会刷新待处理卡片和假设状态。"
        : "正在导入、去重并路由新增资料；完成前先不要处理旧卡片。",
        nextAction: "等本轮完成后，再处理新生成的待处理卡片。",
        tone: "pending",
        canReviewWithLlm: false,
      }
    }
    if (visibleRuleResults > 0) {
      return {
        label: "规则卡已出，LLM增强中",
        detail: `规则快扫已先显示 ${visibleRuleResults} 张卡片；LLM 只复核这些候选，不会重新读取全部原文，也不会自动改状态。`,
        nextAction: "可以先看当前卡片；等 LLM 补完信号类型、交易含义和 Ask 建议后再确认状态。",
        tone: "pending",
        canReviewWithLlm: false,
      }
    }
    return {
      label: "LLM复核中",
      detail: "正在复核规则层筛出的候选卡片；不会重新读取全部原文，也不会自动改状态。",
      nextAction: "等复核完成后，再确认状态、Ask 深挖或忽略。",
      tone: "pending",
      canReviewWithLlm: false,
    }
  }
  if (status === "done") {
    return {
      label: "已LLM复核",
      detail: "规则层先筛出少量候选，LLM已复核候选集；状态仍需你手动确认。",
      nextAction: "先处理卡片：需要变更的点「确认状态」，不确定的点「Ask 深挖」。",
      tone: "llm",
      canReviewWithLlm: false,
    }
  }
  if (status === "error" || status === "failed") {
    const errorDetail = compactDisplayText(llmReviewError, "", 200)
    return {
      label: "LLM复核失败",
      detail: errorDetail
        ? `规则扫描结果仍可看；复核失败原因：${errorDetail}`
        : "规则扫描结果仍可看；需要时可重试 LLM 复核。",
      nextAction: errorDetail
        ? `失败原因：${errorDetail}。可检查 LLM 配置后重试，或先按规则结果处理卡片。`
        : "可以先按规则结果处理高优先级卡片，或重试 LLM 复核。",
      tone: "error",
      canReviewWithLlm: true,
    }
  }
  if (status === "skipped") {
    if (reason === "too_many_candidate_items") {
      return {
        label: "规则结果待复核",
        detail: "候选卡片超过自动复核上限；当前是规则快扫结果，可先看聚合桶或手动点 LLM 复核。",
        nextAction: "建议先缩小范围到单条假设，或手动点「LLM复核这些卡片」。",
        tone: "pending",
        canReviewWithLlm: true,
      }
    }
    if (reason === "no_new_signal_messages") {
      return {
        label: "规则快扫",
        detail: "同一资料源没有新增内容，本轮跳过 LLM 复核；规则扫描仍已完成。",
        nextAction: "无需处理旧卡片；继续自动跟踪，或切换资料源/扩大窗口后再扫。",
        tone: "rules",
        canReviewWithLlm: false,
      }
    }
    return {
      label: "规则快扫",
      detail: "本轮没有候选需要 LLM 复核；当前结果来自解析、去重和规则路由。",
      nextAction: "无需处理；继续自动跟踪，等待新催化、硬证据或市场反馈。",
      tone: "rules",
      canReviewWithLlm: false,
    }
  }
  if (status === "auto" || status === "pending") {
    if (visibleRuleResults > 0) {
      return {
        label: "规则卡已出，待LLM增强",
        detail: `已有 ${visibleRuleResults} 张规则卡可以先看；LLM 增强只负责补充信号含义、交易含义和 Ask 建议。`,
        nextAction: "可以先处理强信号，或点「LLM增强判断」让模型复核这些候选卡。",
        tone: "pending",
        canReviewWithLlm: true,
      }
    }
    return {
      label: "等待LLM复核",
      detail: "当前先用规则解析、去重和路由；点 LLM 复核后，只会把候选卡片交给模型判断。",
      nextAction: "点「LLM增强判断」，让模型判断信号含义和下一步。",
      tone: "pending",
      canReviewWithLlm: true,
    }
  }
  if (autoRefresh) {
    return {
      label: "规则快扫",
      detail: "自动跟踪只做解析、去重和规则路由；发现候选后再人工触发 LLM 复核。",
      nextAction: "有候选卡片时点「LLM复核这些卡片」；没卡片就继续自动跟踪。",
      tone: "rules",
      canReviewWithLlm: true,
    }
  }
  return {
    label: "规则快扫",
    detail: "本轮未启用 LLM；这里只是解析、去重和规则路由结果，可点 LLM 复核让模型判断信号含义。",
    nextAction: "先看待处理卡片质量，再判断有无必要复核。",
    tone: "rules",
    canReviewWithLlm: true,
  }
}

export function shouldShowReviewModeAction({ hasSignals, running, tone, canReviewWithLlm = true }: ReviewModeActionInput) {
  return Boolean(hasSignals && !running && tone !== "llm" && canReviewWithLlm)
}

export function buildEmptySignalTodoHint({
  running,
  hasScanned,
  sourceCount,
  newMessageCount,
  totalCount,
}: {
  running?: boolean
  hasScanned?: boolean
  sourceCount?: unknown
  newMessageCount?: unknown
  totalCount?: unknown
}): EmptySignalTodoHint {
  const sources = numberValue(sourceCount)
  const newMessages = numberValue(newMessageCount)
  const total = numberValue(totalCount)
  if (running) {
    return {
      title: "正在扫描新增资料",
      detail: "系统正在导入、去重并路由到假设池，完成后这里会出现待处理卡片。",
      nextAction: "先等这一轮完成。",
      tone: "running",
      primaryActionKind: "none",
      primaryActionLabel: "",
    }
  }
  if (!hasScanned) {
    return {
      title: "还没有扫描新增资料",
      detail: "先选择新增资料或文件夹，然后扫一次；命中假设后这里会变成待处理卡片。",
      nextAction: "先扫描新增资料。",
      tone: "idle",
      primaryActionKind: "scan",
      primaryActionLabel: "扫描新增资料",
    }
  }
  if (total > 0) {
    return {
      title: "有结果等待处理",
      detail: "当前已有待处理卡片，优先处理可确认、反证、硬证据和市场反馈。",
      nextAction: "先看上方主动作。",
      tone: "idle",
      primaryActionKind: "none",
      primaryActionLabel: "",
    }
  }
  if (sources === 0 && newMessages === 0) {
    return {
      title: "这个窗口没有新增资料",
      detail: "没有进入 Watchtower 的新增资料。确认资料文件已更新，或把窗口从 30m 调到 1d 后再扫。",
      nextAction: "检查信号源或放大窗口。",
      tone: "no-source",
      primaryActionKind: "expand-window",
      primaryActionLabel: "改为 1d 并重扫",
    }
  }
  if (sources > 0 || newMessages > 0) {
    return {
      title: "已扫描，但没有命中假设",
      detail: "新增资料可能只是噪声，也可能是假设池还没有覆盖这个主题。",
      nextAction: "可以点 AI 并发发现假设，或手工建一条假设再扫。",
      tone: "no-match",
      primaryActionKind: "discover",
      primaryActionLabel: "AI 并发发现假设",
    }
  }
  return {
    title: "暂无待处理",
    detail: "点“扫描新增资料”后，这里会显示命中假设、建议状态和原因。",
    nextAction: "先扫描新增资料。",
    tone: "idle",
    primaryActionKind: "scan",
    primaryActionLabel: "扫描新增资料",
  }
}

export function shouldShowSignalQueueDetails({ totalCount }: { totalCount?: unknown } = {}) {
  return numberValue(totalCount) > 0
}

function relatedWikiFrameContext(pages: unknown) {
  const meta = firstWikiMeta(pages)
  if (Object.keys(meta).length === 0) return ""
  const parts: string[] = []
  const status = compactDisplayText(meta.status, "", 40)
  const confidence = compactDisplayText(meta.confidence, "", 40)
  const momentum = compactDisplayText(meta.momentum, "", 40)
  const catalysts = stringList(meta.catalysts)
  if (status) parts.push(status.includes("活跃") ? "活跃框架" : `${status}框架`)
  if (confidence) parts.push(`${confidence}置信`)
  if (momentum) parts.push(`${momentum}动量`)
  if (catalysts.length > 0) parts.push(`催化 ${catalysts.slice(0, 2).join("/")}`)
  return parts.slice(0, 4).join("，")
}

function relatedWikiFrameLabel(page: Record<string, unknown>) {
  const title = compactDisplayText(page.title ?? page.name, "", 42)
  if (title) return title
  const source = compactDisplayText(page.sourceRef ?? page.path ?? page.ref, "", 120)
  if (source) return sourceRefLabel(source).split("/").pop()?.replace(/\.md$/i, "") || sourceRefLabel(source)
  const meta = unknownRecord(page.wikiMeta)
  return compactDisplayText(meta.type ?? meta.summary, "未命名 wiki 框架", 42)
}

function wikiFrameClusterTone(pages: unknown): WikiFrameCluster["tone"] {
  const meta = firstWikiMeta(pages)
  const status = compactDisplayText(meta.status, "", 40)
  const momentum = compactDisplayText(meta.momentum, "", 40)
  if (status.includes("归档") || status.includes("证伪") || momentum.includes("冷")) return "stale"
  if (momentum.includes("热")) return "hot"
  if (status.includes("活跃")) return "active"
  return "default"
}

function relatedWikiPagesFromSignalItem(item: unknown) {
  const record = unknownRecord(item)
  const signal = unknownRecord(record.signal)
  const directPages = arrayRecords(record.relatedWikiPages)
  const signalPages = arrayRecords(signal.relatedWikiPages)
  return signalPages.length > 0 ? signalPages : directPages
}

export function buildWikiFrameClusters(items: unknown, limit = 4): WikiFrameCluster[] {
  const clusters = new Map<string, WikiFrameCluster & { score: number }>()
  for (const item of Array.isArray(items) ? items : []) {
    const pages = relatedWikiPagesFromSignalItem(item)
    const page = rankedWikiFramePages(pages)[0]
    if (!page) continue
    const source = compactDisplayText(page.sourceRef ?? page.path ?? page.ref, "", 160)
    const label = relatedWikiFrameLabel(page)
    const key = source || label
    if (!key) continue
    const existing = clusters.get(key)
    const pageSet = [page]
    const detail = relatedWikiFrameContext(pageSet) || compactDisplayText(unknownRecord(page.wikiMeta).summary, "已命中 wiki 框架", 72)
    const tone = wikiFrameClusterTone(pageSet)
    const score = Math.max(0, wikiMetaPriorityBoost(pageSet))
    if (existing) {
      existing.count += 1
      existing.score = Math.max(existing.score, score)
      if (!existing.detail && detail) existing.detail = detail
      if (existing.tone === "default" && tone !== "default") existing.tone = tone
      continue
    }
    clusters.set(key, {
      key,
      label,
      detail,
      sourceRef: source,
      count: 1,
      tone,
      score,
    })
  }
  return [...clusters.values()]
    .sort((a, b) => b.count - a.count || b.score - a.score || a.label.localeCompare(b.label))
    .slice(0, Math.max(0, limit))
    .map(({ score: _score, ...cluster }) => cluster)
}

function relatedWikiSuffix(count: unknown, pages?: unknown, financeEntityRecords?: unknown) {
  const relatedWikiCount = Math.max(numberValue(count), arrayRecords(pages).length)
  const financeRecords = financeEntityRecordsForSignal({ relatedWikiPages: pages, financeEntityRecords })
  const financeParts: string[] = []
  const financeReason = financeEntityPriorityReason(financeRecords)
  if (financeReason) financeParts.push(financeReason)
  const financeLayer = buildSignalKeywordLine({ relatedWikiPages: financeRecords }).layers.find((layer) => layer.tone === "finance")
  if (financeLayer?.terms.length) {
    financeParts.push(`SAG金融词 ${financeLayer.terms.slice(0, 2).join("/")}`)
  }
  const financeType = financeEntityTypeSummary(financeRecords)
  if (financeType) financeParts.push(financeType)
  if (relatedWikiCount <= 0) return financeParts.length ? `，${financeParts.join("；")}` : ""
  const frame = relatedWikiFrameContext(pages)
  const parts = [`回连 ${relatedWikiCount} 个 wiki${frame ? `：${frame}` : ""}`]
  const match = buildWikiFrameMatchExplanation(pages)
  if (match.show) {
    const fieldSummary = match.fields
      .slice(0, 3)
      .map((field) => `${field.label} ${field.terms.slice(0, 2).join("/")}`)
      .join("，")
    if (match.fields.length === 1 && match.fields[0]?.label === "标签") {
      parts.push(`只命中标签 ${match.fields[0].terms.slice(0, 2).join("/")}`)
    } else if (fieldSummary) {
      parts.push(`命中表头：${fieldSummary}`)
    }
  }
  parts.push(...financeParts)
  return `，${parts.join("；")}`
}

export function buildSignalDecisionSummary(input: SignalDecisionSummaryInput): SignalDecisionSummary {
  const evidenceDelta = textValue(input.evidenceDelta)
  const signalType = textValue(input.signalType)
  const wikiSuffix = relatedWikiSuffix(input.relatedWikiCount, input.relatedWikiPages, input.financeEntityRecords)
  if (input.kind === "candidate") {
    const reasons = stringList(input.priorityReasons)
    const clusterCount = numberValue(input.clusterSourceCount)
    const whyParts = []
    if (reasons.length > 0) whyParts.push(reasons.slice(0, 3).join(" / "))
    if (clusterCount > 1) whyParts.push(`${clusterCount} 条来源合并`)
    if (wikiSuffix) whyParts.push(wikiSuffix.replace(/^，/, ""))
    return {
      headline: input.askDeepDiveRecommended ? "候选新假设，先 Ask 预检" : "候选新假设，先判断要不要跟踪",
      why: whyParts.length ? whyParts.join("，") : "未命中已有假设，但像一条可跟踪的新变量",
      next: input.askDeepDiveRecommended
        ? "点“Ask 预检”，不写入假设库；先看关联股票、链条、来源和是否值得入池，确认后再加入跟踪。"
        : "只把能持续跟踪的变量加入假设池；泛舆情先忽略。",
      tone: "candidate",
    }
  }
  const currentStatus = textValue(input.currentStatus, "watching")
  const nextStatus = textValue(input.suggestedStatus, currentStatus)
  const signalMergeSuffix = numberValue(input.clusterSourceCount) > 1 ? `，${numberValue(input.clusterSourceCount)} 条信号合并` : ""
  if (input.canConfirm) {
    return {
      headline: "先确认状态变化",
      why: `建议 ${hypothesisStatusTransitionLabel(currentStatus, nextStatus)}${wikiSuffix}${signalMergeSuffix}`,
      next: "复核来源可信度；认可后点“确认”写入假设记忆。",
      tone: "confirm",
    }
  }
  if (input.askDeepDiveRecommended) {
    return {
      headline: "先 Ask 排股票和链条",
      why: `信号需要扩展到关联股票、直接受益和利好排序${wikiSuffix}${signalMergeSuffix}`,
      next: "点 Ask 深挖，先看关联股票、直接受益、利好排序和来源。",
      tone: "ask",
    }
  }
  if (evidenceDelta === "fundamental_delivery" || signalType === "硬证据") {
    return {
      headline: "硬证据，先复核原文",
      why: `出现订单、公告、客户、财报或交付线索${wikiSuffix}${signalMergeSuffix}`,
      next: "复核原文后再确认状态，后续跟踪收入确认和量价反馈。",
      tone: "support",
    }
  }
  if (evidenceDelta === "catalyst_signal" || signalType === "新催化") {
    return {
      headline: "新催化，先看扩散",
      why: `新增变量可能改变短期关注度${wikiSuffix}${signalMergeSuffix}`,
      next: "先观察 1-5 个交易日扩散和二次来源；需要标的排序时再 Ask。",
      tone: "catalyst",
    }
  }
  if (evidenceDelta === "market_feedback" || signalType === "市场反馈") {
    return {
      headline: "市场先动，防已定价",
      why: `价格或交易热度已经先反应${wikiSuffix}${signalMergeSuffix}`,
      next: "重点判断是刚开始扩散，还是已经充分定价。",
      tone: "market",
    }
  }
  if (evidenceDelta === "counter_signal" || signalType === "反证") {
    return {
      headline: "出现反证，先别当利好",
      why: `新增信息可能削弱原假设${wikiSuffix}${signalMergeSuffix}`,
      next: "先做反证复核；必要时再确认“走势背离”或“被证伪”。",
      tone: "counter",
    }
  }
  return {
    headline: "相关但不急，先观察",
    why: `新增信息相关，但暂时不足以改变状态${wikiSuffix}${signalMergeSuffix}`,
    next: "保留观察；连续二次确认或量价反馈出现后再处理。",
    tone: "quiet",
  }
}

export function buildSignalCardDecisionCopy({
  summary,
  title,
  currentStatus,
  suggestedStatus,
  kind,
}: {
  summary: SignalDecisionSummary
  title?: unknown
  currentStatus?: unknown
  suggestedStatus?: unknown
  kind?: "tracked" | "candidate"
}): SignalCardDecisionCopy {
  const displayTitle = compactDisplayText(title, kind === "candidate" ? "候选新假设" : "未命名假设", 80)
  const current = compactDisplayText(currentStatus, "", 40)
  const suggested = compactDisplayText(suggestedStatus, "", 40)
  const statusText = current && suggested && current !== suggested ? ` · ${hypothesisStatusTransitionLabel(current, suggested)}` : ""
  const reason = compactDisplayText(summary.why, "新增信息相关，等待进一步确认。", 150)
  return {
    decision: compactDisplayText(summary.headline, "继续观察", 80),
    reason,
    whyImportant: compactDisplayText(`${summary.headline}：${summary.why}`, summary.headline, 180),
    affects: kind === "candidate"
      ? `可能新建：${displayTitle}`
      : `影响假设：${displayTitle}${statusText}`,
    nextAction: compactDisplayText(summary.next, "继续观察；需要标的排序时再 Ask。", 220),
    tone: summary.tone,
  }
}

function signalRankTone(input: SignalCardRankReasonInput): SignalDecisionSummary["tone"] {
  const evidenceDelta = textValue(input.evidenceDelta)
  const signalType = textValue(input.signalType)
  if (input.canConfirm) return "confirm"
  if (evidenceDelta === "counter_signal" || signalType === "反证") return "counter"
  if (input.askDeepDiveRecommended) return input.kind === "candidate" ? "candidate" : "ask"
  if (evidenceDelta === "fundamental_delivery" || signalType === "硬证据") return "support"
  if (evidenceDelta === "market_feedback" || signalType === "市场反馈") return "market"
  if (evidenceDelta === "catalyst_signal" || signalType === "新催化") return "catalyst"
  return "quiet"
}

export function buildSignalCardRankReason(input: SignalCardRankReasonInput): SignalCardRankReason {
  const evidenceDelta = textValue(input.evidenceDelta)
  const signalType = textValue(input.signalType)
  const relatedPages = arrayRecords(input.relatedWikiPages)
  const financeRecords = financeEntityRecordsForSignal(input)
  const parts: string[] = []

  if (input.canConfirm) parts.push("状态可确认")
  if (input.askDeepDiveRecommended) {
    parts.push(input.kind === "candidate" ? "建议 Ask 预检" : "建议 Ask 深挖")
  }
  if (evidenceDelta === "fundamental_delivery" || signalType === "硬证据") parts.push("硬证据")
  else if (evidenceDelta === "market_feedback" || signalType === "市场反馈") parts.push("市场反馈")
  else if (evidenceDelta === "counter_signal" || signalType === "反证") parts.push("反证")
  else if (evidenceDelta === "supporting_signal" || signalType === "二次确认") parts.push("二次确认")
  else if (evidenceDelta === "catalyst_signal" || signalType === "新催化") parts.push("新催化")
  else if (evidenceDelta === "narrative_expansion" || signalType === "叙事扩散") parts.push("叙事扩散已降权")

  const sourceCount = Math.max(numberValue(input.sourceCount), numberValue(input.clusterSourceCount))
  if (sourceCount > 1) parts.push(`多来源 ${sourceCount} 条`)

  const meta = firstWikiMeta(relatedPages)
  const status = compactDisplayText(meta.status, "", 24)
  const confidence = compactDisplayText(meta.confidence, "", 24)
  const momentum = compactDisplayText(meta.momentum, "", 24)
  if (status.includes("活跃")) parts.push("活跃 wiki 框架")
  if (confidence) parts.push(`${confidence}置信`)
  if (momentum.includes("热")) parts.push("热动量")

  const priorityLabels = new Set(["股票", "公司", "产品线", "技术路线", "产业链位置", "催化", "风险因子", "交易模式"])
  for (const group of financeEntityTypeGroups(financeRecords, 4).filter((item) => priorityLabels.has(item.label)).slice(0, 3)) {
    parts.push(`${group.label} ${group.terms.slice(0, 2).join("/")}`)
  }

  const priorityReasons = stringList(input.priorityReasons).slice(0, 2)
  if (priorityReasons.length) parts.push(`规则 ${priorityReasons.join("/")}`)

  const detail = compactDisplayText(parts.join(" · "), "没有强排序因素，暂时观察。", 220)
  return {
    show: true,
    label: "排序原因",
    detail,
    tone: signalRankTone(input),
  }
}

function signalCardLabel(input: SignalCardTradingBriefInput) {
  const signalType = compactDisplayText(input.signalType, "", 24)
  const evidenceDelta = textValue(input.evidenceDelta)
  if (signalType) return signalType
  if (evidenceDelta === "fundamental_delivery") return "硬证据"
  if (evidenceDelta === "market_feedback") return "市场反馈"
  if (evidenceDelta === "counter_signal") return "反证"
  if (evidenceDelta === "supporting_signal") return "二次确认"
  if (evidenceDelta === "catalyst_signal") return "新催化"
  if (evidenceDelta === "narrative_expansion") return "叙事扩散"
  return input.kind === "candidate" ? "候选" : "信号"
}

function signalCardBriefTone(input: SignalCardTradingBriefInput): SignalDecisionSummary["tone"] {
  if (input.canConfirm) return "confirm"
  if (input.askDeepDiveRecommended) return input.kind === "candidate" ? "candidate" : "ask"
  return signalRankTone(input)
}

function signalCardAction(input: SignalCardTradingBriefInput, tone: SignalDecisionSummary["tone"]) {
  if (input.canConfirm) return input.kind === "candidate" ? "加入跟踪" : "确认状态"
  if (input.askDeepDiveRecommended) return input.kind === "candidate" ? "Ask 预检" : "Ask 深挖"
  if (tone === "support") return "复核原文"
  if (tone === "market") return "判断定价"
  if (tone === "counter") return "反证复核"
  if (tone === "catalyst") return "观察扩散"
  return "继续观察"
}

export function buildSignalCardTradingBrief(input: SignalCardTradingBriefInput): SignalCardTradingBrief {
  const tone = signalCardBriefTone(input)
  const label = signalCardLabel(input)
  const strip = buildSignalFinanceEntityStrip(input.financeEntityRecords ?? input.relatedWikiPages)
  const financeLine = strip.groups
    .slice(0, 3)
    .map((group) => `${group.label} ${group.terms.slice(0, 2).join("/")}`)
    .join(" · ")
  const action = signalCardAction(input, tone)
  const headline = compactDisplayText(
    [label, financeLine || compactDisplayText(input.title, "", 48), action].filter(Boolean).join(" · "),
    `${label} · ${action}`,
    130,
  )
  const current = compactDisplayText(input.currentStatus, "", 40)
  const suggested = compactDisplayText(input.suggestedStatus, "", 40)
  const transition = current && suggested && current !== suggested ? hypothesisStatusTransitionLabel(current, suggested) : ""
  const sourceCount = Math.max(numberValue(input.sourceCount), numberValue(input.clusterSourceCount))
  const sourceLine = sourceCount > 1 ? `${sourceCount} 条来源` : ""
  let detail = ""
  if (input.canConfirm) {
    detail = `人工确认后才写入假设记忆${transition ? `；${transition}` : ""}${sourceLine ? `；${sourceLine}` : ""}。`
  } else if (input.askDeepDiveRecommended) {
    detail = input.kind === "candidate"
      ? "先做 Ask 预检，确认关联股票、来源和是否值得入池。"
      : "先排关联股票、直接受益和利好排序，确认后再决定是否升级状态。"
  } else if (tone === "support") {
    detail = "先复核订单、公告、客户、交付或财报原文，再考虑状态升级。"
  } else if (tone === "market") {
    detail = "市场已有反馈，先判断是刚扩散还是已经充分定价。"
  } else if (tone === "counter") {
    detail = "先做反证复核，暂停把它当作利好催化。"
  } else if (tone === "catalyst") {
    detail = "先看 1-5 个交易日扩散和二次来源，需要标的排序时再 Ask。"
  } else {
    detail = "暂不升级；等二次确认、硬证据或市场反馈后再处理。"
  }
  return {
    label,
    headline,
    detail,
    action,
    tone,
  }
}

export function buildSignalCardPmActionLine(input: SignalCardQuestionChecklistInput): SignalCardPmActionLine {
  const brief = buildSignalCardTradingBrief(input)
  const signalLabel = brief.label || signalCardLabel(input)
  const targetLabel = input.kind === "candidate" ? "候选新假设" : "已跟踪假设"
  const title = compactDisplayText(input.title, input.kind === "candidate" ? "候选新假设" : "未命名假设", 70)
  const strip = buildSignalFinanceEntityStrip(input.financeEntityRecords ?? input.relatedWikiPages)
  const financeLine = strip.show
    ? strip.groups
      .slice(0, 2)
      .map((group) => `${group.label} ${group.terms.slice(0, 2).join("/")}`)
      .join("，")
    : ""
  const current = compactDisplayText(input.currentStatus, "", 40)
  const suggested = compactDisplayText(input.suggestedStatus, "", 40)
  const transition = current && suggested && current !== suggested ? hypothesisStatusTransitionLabel(current, suggested) : ""
  const mergedCount = Math.max(numberValue(input.sourceCount), numberValue(input.clusterSourceCount))
  const mergedLine = mergedCount > 1 ? `${mergedCount} 条信号合并，` : ""

  let lead = `${signalLabel}命中${targetLabel}`
  if (input.canConfirm) lead = `${signalLabel}推动状态建议`
  else if (input.kind === "candidate") lead = `${signalLabel}生成候选新假设`

  let action = brief.action
  let guardrail = `${mergedLine}本卡只生成处理建议，不会自动确认状态、不写 wiki/raw。`
  if (input.canConfirm) {
    action = "确认后写入假设记忆"
    guardrail = `${mergedLine}只有点击确认才写入 .llm-wiki 假设记忆，不写 wiki/raw。`
  } else if (input.askDeepDiveRecommended) {
    action = input.kind === "candidate" ? "先 Ask 预检" : "先 Ask 深挖"
    guardrail = `${mergedLine}Ask 只生成研究材料，不会自动确认状态、不写 wiki/raw。`
  } else if (brief.tone === "quiet") {
    action = "本轮先观察"
    guardrail = `${mergedLine}不升级状态；等二次确认、硬证据或市场反馈。`
  }

  const impactParts = [
    title,
    transition,
    financeLine,
  ].filter(Boolean)

  return {
    show: Boolean(title || signalLabel),
    lead: compactDisplayText(lead, "新增信号命中假设", 48),
    impact: compactDisplayText(impactParts.join(" · "), title, 150),
    action,
    guardrail,
    tone: brief.tone,
  }
}

function signalCardQuestionStatus(input: SignalCardQuestionChecklistInput) {
  if (input.kind === "candidate") return "候选假设，尚未加入跟踪"
  const current = compactDisplayText(input.currentStatus, "", 40)
  const suggested = compactDisplayText(input.suggestedStatus, "", 40)
  if (current && suggested && current !== suggested) return hypothesisStatusTransitionLabel(current, suggested)
  if (current) return `${hypothesisStatusLabel(current) || current} 不变`
  return "暂无状态变化建议"
}

function signalCardQuestionNext(input: SignalCardQuestionChecklistInput, brief: SignalCardTradingBrief) {
  if (input.kind === "candidate") {
    if (input.askDeepDiveRecommended) return "先 Ask 预检，确认关联股票和来源后再决定是否加入跟踪。"
    return "先判断是否值得入池；不确认就忽略本轮候选。"
  }
  const status = signalCardQuestionStatus(input)
  if (input.canConfirm) return `点“确认”才写入假设状态：${status}。`
  if (input.askDeepDiveRecommended) return "点“Ask 深挖”获取关联股票、直接受益、利好排序和六段回答。"
  if (brief.tone === "counter") return "先做反证复核；确认前不要把它当成利好。"
  if (brief.tone === "market") return "先判断是否已经定价；需要标的排序时再 Ask。"
  return "继续观察；出现二次确认、硬证据或量价反馈后再处理。"
}

function signalCardQuestionGuardrail(input: SignalCardQuestionChecklistInput) {
  if (input.kind === "candidate") {
    if (input.askDeepDiveRecommended) return "Ask 预检只生成研究材料，不会自动加入跟踪；加入跟踪仍需你手动点击。"
    return "候选不会自动加入跟踪；只有你点“加入跟踪”才进入假设池。"
  }
  if (input.canConfirm) return "不会自动确认状态；只有你点“确认”才写入 .llm-wiki 假设记忆。"
  if (input.askDeepDiveRecommended) return "Ask 只生成研究材料，不会自动确认状态；确认仍需人工点击。"
  return "本卡只提供处理建议，不会自动确认状态、不写 wiki/raw。"
}

export function buildSignalCardQuestionChecklist(input: SignalCardQuestionChecklistInput): SignalCardQuestionChecklist {
  const title = compactDisplayText(input.title, input.kind === "candidate" ? "候选新假设" : "未命名假设", 90)
  const source = buildSignalCardSourceCopy({
    sourceExcerpt: input.sourceExcerpt,
    sourceRef: input.sourceRef,
    sourceKindLabel: input.sourceKindLabel,
    reason: input.reason,
  })
  const brief = buildSignalCardTradingBrief(input)
  const summary = buildSignalDecisionSummary(input)
  const signalSource = source.excerpt || source.badge || source.auditLabel
  const reason = source.reason || readerFacingReason(input.reason) || summary.why
  const implication = buildSignalCardTradeLine({
    tradingImplication: input.tradingImplication,
    signalType: input.signalType,
    evidenceDelta: input.evidenceDelta,
    reason: input.reason,
  })
  const items: SignalCardQuestionChecklistItem[] = [
    {
      key: "signal",
      label: "这是什么信号",
      value: compactDisplayText([brief.label, signalSource].filter(Boolean).join(" · "), brief.label || "新增信号", 150),
      tone: "source",
    },
    {
      key: "hypothesis",
      label: "影响哪条假设",
      value: input.kind === "candidate" ? `候选新假设：${title}` : title,
      tone: "hypothesis",
    },
    {
      key: "status",
      label: "状态建议",
      value: signalCardQuestionStatus(input),
      tone: "status",
    },
    {
      key: "reason",
      label: "为什么重要",
      value: compactDisplayText(reason, "新增信息相关，但还不足以改变状态。", 170),
      tone: "reason",
    },
    {
      key: "implication",
      label: "交易含义",
      value: compactDisplayText(implication, brief.detail, 180),
      tone: "trade",
    },
    {
      key: "next",
      label: "下一步",
      value: compactDisplayText(signalCardQuestionNext(input, brief), brief.detail, 180),
      tone: "action",
    },
  ]
  return {
    show: items.some((item) => Boolean(item.value)),
    title: "PM 处理要点",
    headline: compactDisplayText(summary.headline, brief.headline, 90),
    detail: compactDisplayText(summary.why || reason, reason || brief.detail, 160),
    primaryAction: compactDisplayText(brief.action, summary.next || brief.detail, 32),
    guardrail: signalCardQuestionGuardrail(input),
    tone: summary.tone,
    items,
  }
}

export function buildSignalCardSurfacePolicy({
  pmActionLine,
  questionChecklist,
  verbose = false,
}: {
  pmActionLine?: SignalCardPmActionLine
  questionChecklist?: SignalCardQuestionChecklist
  verbose?: boolean
}): SignalCardSurfacePolicy {
  const showPmActionLine = Boolean(pmActionLine?.show)
  const showQuestionChecklist = Boolean(questionChecklist?.show)
  const compactMainCard = !verbose && showPmActionLine && showQuestionChecklist

  return {
    showPmActionLine,
    showQuestionChecklist,
    showDecisionBlock: !compactMainCard,
    showTradeLine: !compactMainCard,
    detail: compactMainCard
      ? "主卡片只保留 PM 结论和处理要点；来源、证据和链路细节放入展开区。"
      : "缺少 PM 结论或处理要点时，保留决策块和交易线，避免卡片信息不足。",
  }
}

function signalInfoFlowBridgeText({
  financeEntityRecords,
  relatedWikiPages,
  matchedSegments,
  matchedEntities,
  catalystTags,
}: {
  financeEntityRecords?: unknown
  relatedWikiPages?: unknown
  matchedSegments?: unknown
  matchedEntities?: unknown
  catalystTags?: unknown
}) {
  const strip = buildSignalFinanceEntityStrip(financeEntityRecords ?? relatedWikiPages)
  if (strip.show) {
    return `SAG实体：${strip.groups
      .slice(0, 3)
      .map((group) => `${group.label} ${group.terms.slice(0, 2).join("/")}`)
      .join("，")}`
  }
  const keywordLine = buildSignalKeywordLine({
    matchedSegments,
    matchedEntities,
    catalystTags,
    relatedWikiPages,
  })
  if (keywordLine.show && keywordLine.terms.length) {
    return `命中词：${keywordLine.terms.slice(0, 3).join("/")}`
  }
  return ""
}

export function buildSignalInfoFlowCopy({
  kind,
  title,
  sourceExcerpt,
  sourceRef,
  sourceKindLabel,
  relatedWikiPages,
  signalType,
  evidenceDelta,
  currentStatus,
  suggestedStatus,
  canConfirm,
  askDeepDiveRecommended,
  financeEntityRecords,
  matchedSegments,
  matchedEntities,
  catalystTags,
}: {
  kind: "tracked" | "candidate"
  title?: unknown
  sourceExcerpt?: unknown
  sourceRef?: unknown
  sourceKindLabel?: unknown
  relatedWikiPages?: unknown
  signalType?: unknown
  evidenceDelta?: unknown
  currentStatus?: unknown
  suggestedStatus?: unknown
  canConfirm?: boolean
  askDeepDiveRecommended?: boolean
  financeEntityRecords?: unknown
  matchedSegments?: unknown
  matchedEntities?: unknown
  catalystTags?: unknown
}): SignalInfoFlowCopy {
  const source = buildSignalCardSourceCopy({ sourceExcerpt, sourceRef, sourceKindLabel }).badge || "新增信息"
  const frame = relatedWikiFrameContext(relatedWikiPages) || "无强 wiki 回连"
  const displayTitle = compactDisplayText(title, kind === "candidate" ? "候选新假设" : "未命名假设", 48)
  const transition = hypothesisStatusTransitionLabel(currentStatus, suggestedStatus)
  const delta = textValue(evidenceDelta)
  const signal = textValue(signalType)
  let action = kind === "candidate" ? "决定是否加入跟踪" : "继续观察"
  let tone: SignalDecisionSummary["tone"] = kind === "candidate" ? "candidate" : "quiet"

  if (canConfirm) {
    action = transition ? `确认状态：${transition}` : "确认状态变化"
    tone = "confirm"
  } else if (askDeepDiveRecommended) {
    action = kind === "candidate" ? "Ask 预检" : "Ask 深挖"
    tone = kind === "candidate" ? "candidate" : "ask"
  } else if (delta === "counter_signal" || signal === "反证") {
    action = "反证复核"
    tone = "counter"
  } else if (delta === "market_feedback" || signal === "市场反馈") {
    action = "判断是否已定价"
    tone = "market"
  } else if (delta === "fundamental_delivery" || signal === "硬证据") {
    action = "复核原文证据"
    tone = "support"
  } else if (delta === "catalyst_signal" || signal === "新催化") {
    action = "看扩散和二次确认"
    tone = "catalyst"
  }

  const target = kind === "candidate" ? `候选：${displayTitle}` : `假设：${displayTitle}`
  const bridge = signalInfoFlowBridgeText({
    financeEntityRecords,
    relatedWikiPages,
    matchedSegments,
    matchedEntities,
    catalystTags,
  })
  const detail = frame === "无强 wiki 回连"
    ? `先不要硬升级；缺少可复用框架时，优先 Ask 建框架或补 wiki 表头。${bridge ? `当前只识别到${bridge}。` : ""}`
    : `新增信息${bridge ? `通过${bridge}` : ""}已回连到 ${frame}，下一步直接围绕这条链路处理。`

  return {
    source,
    frame,
    target,
    action,
    detail,
    tone,
  }
}

export function buildIgnoredSignalNoticeCopy(title?: unknown): IgnoredSignalNoticeCopy {
  const displayTitle = compactDisplayText(title, "这条信号", 64)
  return {
    title: `已本轮忽略：${displayTitle}`,
    detail: "只在当前工作台隐藏，不写入假设状态、不写 wiki/raw；下次重新扫描仍可再看到。",
  }
}

export function buildStatusUpdateNoticeCopy({
  title,
  previousStatus,
  newStatus,
  markdownRelativePath,
  eventRelativePath,
  askRunRef,
}: {
  title?: unknown
  previousStatus?: unknown
  newStatus?: unknown
  markdownRelativePath?: unknown
  eventRelativePath?: unknown
  askRunRef?: unknown
}): StatusUpdateNoticeCopy {
  const displayTitle = compactDisplayText(title, "这条假设", 72)
  const previousStatusCode = compactDisplayText(previousStatus, "", 40)
  const newStatusCode = compactDisplayText(newStatus, previousStatusCode, 40)
  const transition = hypothesisStatusTransitionLabel(previousStatusCode, newStatusCode)
  const previousStatusLabel = hypothesisStatusLabel(previousStatusCode)
  const newStatusLabel = hypothesisStatusLabel(newStatusCode)
  const statusChanged = Boolean(previousStatusCode && newStatusCode && previousStatusCode !== newStatusCode)
  const statusKnownButUnchanged = Boolean((previousStatusCode || newStatusCode) && !statusChanged)
  const hypothesisPath = compactDisplayText(markdownRelativePath, "假设卡片路径未返回", 180)
  const eventPath = compactDisplayText(eventRelativePath, "审计事件路径未返回", 180)
  const askEvidencePath = compactDisplayText(askRunRef, "", 180)
  const outcomeLabel = statusChanged
    ? "正式状态已更新"
    : statusKnownButUnchanged && newStatusLabel
      ? "状态未变化"
      : "已写审计记录"
  const outcomeDetail = statusChanged
    ? `Hypothesis Library 持久状态已从“${previousStatusLabel || previousStatusCode}”更新为“${newStatusLabel || newStatusCode}”。`
    : statusKnownButUnchanged && newStatusLabel
      ? `这条假设当前已经是“${newStatusLabel}”；本次不代表新的状态迁移，只保留人工确认和来源记录。`
      : "本次只保留人工确认和来源记录，没有拿到明确的新状态。"
  return {
    headline: statusChanged
      ? `已写入正式状态：${displayTitle} · ${transition}`
      : statusKnownButUnchanged
        ? `已确认但状态未变化：${displayTitle}`
        : `已写入审计记录：${displayTitle}`,
    detail: `${outcomeDetail} 这不是自动交易，也没有写 wiki/raw。`,
    outcomeLabel,
    outcomeDetail,
    transitionLabel: transition || (newStatusLabel ? `更新为 ${newStatusLabel}` : "状态已确认"),
    storageLine: `已写入假设卡片和审计事件：${hypothesisPath}；${eventPath}`,
    askEvidenceLine: askEvidencePath
      ? `已关联 Ask 深挖证据：${askEvidencePath}`
      : "本次确认未关联 Ask 深挖结果；如需股票、链条和来源排序，可以继续点 Ask 深挖。",
    nextAction: newStatusLabel
      ? `下一步：按“${newStatusLabel}”状态继续扫描新增资料；需要股票和链条排序时再 Ask 深挖。`
      : "下一步：继续扫描新增资料；需要股票和链条排序时再 Ask 深挖。",
    guardrail: "只更新 Hypothesis Library 记忆，不写正式 wiki/raw，不触发真实交易。",
    hypothesisPath,
    eventPath,
  }
}

const SIGNAL_CARD_ACTION_DESCRIPTIONS: Record<SignalCardActionKind, string> = {
  confirm: "把建议状态写入假设记忆，并生成审计事件；不写 wiki/raw。",
  ask: "调用 Ask 深挖，先看关联股票、受益链条、利好排序和来源。",
  precheck: "先做 Ask 预检，不加入跟踪；看清股票、链条和来源后再决定。",
  track: "把候选假设加入跟踪表，后续由新增资料继续扫描。",
  ignore: "本轮隐藏这张卡，不更新假设状态，也不写入正式知识库。",
}

const SIGNAL_CARD_ACTION_LABELS: Record<SignalCardActionKind, string> = {
  confirm: "确认状态",
  ask: "Ask 深挖",
  precheck: "Ask 预检",
  track: "加入跟踪",
  ignore: "本轮忽略",
}

function normalizeSignalCardActionKind(value: unknown): SignalCardActionKind | null {
  const kind = textValue(value)
  return kind === "confirm"
    || kind === "ask"
    || kind === "precheck"
    || kind === "track"
    || kind === "ignore"
    ? kind
    : null
}

export function buildSignalCardActionFeedback(input: {
  action?: unknown
  status?: unknown
  title?: unknown
  detail?: unknown
  previousStatus?: unknown
  newStatus?: unknown
} = {}): SignalCardActionFeedback {
  const action = normalizeSignalCardActionKind(input.action)
  const status = textValue(input.status)
  if (!action || (status !== "running" && status !== "done" && status !== "error")) {
    return { show: false, label: "", detail: "", tone: "done" }
  }
  const actionLabel = SIGNAL_CARD_ACTION_LABELS[action]
  const displayTitle = compactDisplayText(input.title, "", 48)
  const titlePrefix = displayTitle ? `${displayTitle}：` : ""
  if (status === "error") {
    const retryAction: Record<SignalCardActionKind, string> = {
      confirm: "检查失败原因后按本卡片动作重试；未成功前不会改假设状态。",
      ask: "按本卡片动作重试，或把问题收窄到单一股票、细分或证据缺口。",
      precheck: "按本卡片动作重试；如果仍失败，先加入跟踪后再从假设表 Ask。",
      track: "按本卡片动作重试；先补标题、主题或细分，未成功前不会入池。",
      ignore: "按本卡片动作重试；失败不会写入假设状态。",
    }
    return {
      show: true,
      action,
      label: `${actionLabel}失败`,
      detail: compactDisplayText(input.detail, "请查看顶部错误或阶段输出后重试。", 180),
      nextAction: retryAction[action],
      tone: "error",
      jumpTargetLabel: action === "ask" || action === "precheck" ? "查看失败原因" : undefined,
    }
  }
  if (status === "running") {
    const detailByAction: Record<SignalCardActionKind, string> = {
      confirm: "正在写入假设记忆和审计事件；不写 wiki/raw，也不会触发交易。",
      ask: "正在调用多源检索；完成后会自动定位到下方 Ask 结果区，先看摘要、股票、来源和六段回答。",
      precheck: "正在判断候选是否值得入池；完成后会自动定位到下方 Ask 结果区，先看股票、链条和来源。",
      track: "正在写入 .llm-wiki/hypotheses；加入后可用新增资料继续跟踪。",
      ignore: "正在从当前工作台隐藏；不写入正式状态。",
    }
    const nextActionByAction: Record<SignalCardActionKind, string> = {
      confirm: "等待写入完成；完成后看状态是否真的变化。",
      ask: "等待 Ask 返回；完成后点“查看 Ask 结果”看摘要、股票和来源。",
      precheck: "等待预检返回；完成后判断是否加入跟踪。",
      track: "等待入池完成；完成后扫描新增资料继续跟踪。",
      ignore: "等待本轮隐藏完成；之后继续处理剩余卡片。",
    }
    return {
      show: true,
      action,
      label: `${actionLabel}中`,
      detail: `${titlePrefix}${detailByAction[action]}`,
      nextAction: nextActionByAction[action],
      tone: "running",
      jumpTargetLabel: action === "ask" || action === "precheck" ? "查看 Ask 结果" : undefined,
    }
  }
  const previousStatusCode = compactDisplayText(input.previousStatus, "", 40)
  const newStatusCode = compactDisplayText(input.newStatus, previousStatusCode, 40)
  const statusChanged = action === "confirm" && Boolean(previousStatusCode && newStatusCode && previousStatusCode !== newStatusCode)
  const statusNoChange = action === "confirm" && Boolean(previousStatusCode && newStatusCode && previousStatusCode === newStatusCode)
  const statusTransition = hypothesisStatusTransitionLabel(previousStatusCode, newStatusCode)
  const labelByAction: Record<SignalCardActionKind, string> = {
    confirm: statusChanged ? "状态已正式更新" : statusNoChange ? "状态未变化" : "已确认状态",
    ask: "Ask 已返回",
    precheck: "预检已返回",
    track: "已加入跟踪",
    ignore: "已本轮忽略",
  }
  const detailByAction: Record<SignalCardActionKind, string> = {
    confirm: statusChanged
      ? `Hypothesis Library 已写入正式迁移：${statusTransition}；没有写 wiki/raw，也没有触发交易。`
      : statusNoChange
        ? `当前已经是${hypothesisStatusLabel(newStatusCode) || newStatusCode}；本次只保留人工确认记录，没有写 wiki/raw，也没有触发交易。`
        : "状态已写入假设记忆；没有写 wiki/raw，也没有触发交易。",
    ask: "结果已进入下方 Ask 结果区；先看结构化摘要，再展开关联股票、来源和完整六段回答。",
    precheck: "预检结果已进入下方 Ask 结果区；先看结构化摘要，再判断是否加入跟踪。",
    track: "候选已写入 .llm-wiki/hypotheses 并进入假设表；不写 wiki/raw，也不触发交易。",
    ignore: "只隐藏当前卡片；不写入假设状态、不写 wiki/raw。",
  }
  const nextActionByAction: Record<SignalCardActionKind, string> = {
    confirm: statusChanged
      ? "继续扫描新增资料，观察这条假设是否出现二次确认、市场反馈或反证。"
      : statusNoChange
        ? "不需要重复确认；继续扫描新增资料，等待更强信号。"
        : "继续扫描新增资料；需要股票和链条排序时再 Ask 深挖。",
    ask: "点查看 Ask 结果，先读摘要和股票排序；确认状态仍需人工点击。",
    precheck: "点查看 Ask 结果，判断候选是否值得加入跟踪。",
    track: "扫描新增资料或点 Ask 深挖，让新假设进入同一套跟踪闭环。",
    ignore: "继续处理剩余卡片；如果后续出现二次确认，它还可以重新出现。",
  }
  return {
    show: true,
    action,
    label: labelByAction[action],
    detail: `${titlePrefix}${detailByAction[action]}`,
    nextAction: nextActionByAction[action],
    tone: "done",
    jumpTargetLabel: action === "ask" || action === "precheck" ? "查看 Ask 结果" : undefined,
  }
}

export function buildSignalCardAskResultBackfill(input: {
  action?: unknown
  status?: unknown
  title?: unknown
  detail?: unknown
  summary?: Partial<AskDeepDiveSummary> | null
  decision?: Partial<AskDecisionSnapshot> | null
  sourceCount?: unknown
} = {}): SignalCardAskResultBackfill {
  const action = normalizeSignalCardActionKind(input.action)
  const status = textValue(input.status)
  if ((action !== "ask" && action !== "precheck") || (status !== "running" && status !== "done" && status !== "error")) {
    return {
      show: false,
      label: "",
      headline: "",
      detail: "",
      stockLine: "",
      actionLine: "",
      pmActionLabel: "",
      pmActionDetail: "",
      observationLine: "",
      sourceLine: "",
      tone: "warning",
    }
  }
  const actionLabel = action === "precheck" ? "Ask 预检" : "Ask 深挖"
  const title = compactDisplayText(input.title, action === "precheck" ? "候选新假设" : "这条假设", 56)
  if (status === "running") {
    return {
      show: true,
      label: `${actionLabel}运行中`,
      headline: "正在生成这张卡的研究结果",
      detail: `${title}：完成后会把首屏判断、关联股票和下一步动作回填到本卡片。`,
      stockLine: "关联股票：抽取中",
      actionLine: "下一步：等待 Ask 返回",
      pmActionLabel: "等待 Ask",
      pmActionDetail: "Ask 返回前不要确认状态，也不要生成观察草稿。",
      observationLine: "观察口径：等待股票池、来源和缺口。",
      sourceLine: "来源：检索中",
      tone: "running",
      jumpTargetLabel: "查看 Ask 结果",
    }
  }
  if (status === "error") {
    return {
      show: true,
      label: `${actionLabel}失败`,
      headline: "这张卡还没有可用 Ask 结果",
      detail: compactDisplayText(input.detail, "请查看顶部错误或阶段输出后重试。", 160),
      stockLine: "关联股票：未返回",
      actionLine: "下一步：重试 Ask 或先收窄问题",
      pmActionLabel: "重试或收窄",
      pmActionDetail: "先把问题缩小到单一细分、单一股票或单一证据缺口，再重试。",
      observationLine: "观察口径：暂无可跟踪股票池。",
      sourceLine: "来源：未返回",
      tone: "error",
      jumpTargetLabel: "查看失败原因",
    }
  }

  const summary = unknownRecord(input.summary)
  const decision = unknownRecord(input.decision)
  const stocks = usableAskSummaryText(summary.stocks, 120)
  const ranking = usableAskSummaryText(summary.ranking, 130)
  const beneficiary = usableAskSummaryText(summary.directBeneficiary, 110)
  const conclusion = usableAskSummaryText(summary.conclusion, 140)
  const stage = compactDisplayText(summary.stage, "", 80)
  const gap = compactDisplayText(summary.gap, "", 140)
  const decisionHeadline = compactDisplayText(decision.headline, "", 80)
  const focus = compactDisplayText(decision.focus, ranking || beneficiary || stocks || stage || conclusion, 150)
  const primaryAction = compactDisplayText(decision.primaryAction, (summary.nextAction || "") as string, 110)
  const risk = compactDisplayText(decision.risk, gap || "仍需回看来源、公告、量价和二次确认。", 150)
  const sourceCount = Math.max(0, numberValue(input.sourceCount))
  const ready = Boolean(stocks)
  const headline = decisionHeadline || (ready ? "已回填 Ask 判断" : "已回填 Ask，但缺关联股票")
  const stockLine = ready
    ? `关联股票：${stocks}`
    : "关联股票：未抽出；先展开 Ask 全文或把问题缩小到单一细分/股票。"
  const actionLine = primaryAction
    ? `下一步：${primaryAction}`
    : ready
      ? "下一步：按股票池验证量价、公告和二次来源。"
      : "下一步：补来源或重试 Ask。"
  const pmActionLabel = ready ? "可转观察清单" : "先补来源"
  const pmActionDetail = ready
    ? "去完整 Ask 结果区点“加入观察队列”；保存草稿仍只写 .llm-wiki，不改假设状态。"
    : "没有股票池时不要入观察队列；先补 wiki/公告/订单/单一细分来源，再重试 Ask。"
  const observationLine = ready
    ? `观察口径：1-5 个交易日跟踪 ${stringList(stocks).slice(0, 3).join("、") || stocks} 的量价扩散、公告订单和二次来源。`
    : "观察口径：没有股票池，先不要生成日内观察。"
  const detail = compactDisplayText([focus, risk].filter(Boolean).join("；"), "Ask 已返回，但结构化摘要仍不完整。", 220)
  return {
    show: true,
    label: action === "precheck" ? "预检已回填" : "已 Ask 回填",
    headline,
    detail,
    stockLine,
    actionLine,
    pmActionLabel,
    pmActionDetail,
    observationLine,
    sourceLine: sourceCount > 0 ? `来源：${sourceCount} 个` : "来源：未返回",
    tone: ready ? "ready" : "warning",
    jumpTargetLabel: "查看完整 Ask",
  }
}

export function shouldShowSignalCardActionFeedback(
  feedback?: SignalCardActionFeedback,
  backfill?: SignalCardAskResultBackfill,
) {
  if (!feedback?.show) return false
  const isAskAction = feedback.action === "ask" || feedback.action === "precheck"
  const hasDecisionBackfill = Boolean(backfill?.show && (backfill.tone === "ready" || backfill.tone === "warning"))
  if (isAskAction && feedback.tone === "done" && hasDecisionBackfill) return false
  return true
}

export function buildDailyStatusActionFeedback(input: {
  action?: unknown
  status?: unknown
  title?: unknown
  detail?: unknown
  previousStatus?: unknown
  newStatus?: unknown
}): DailyStatusActionFeedback {
  const feedback = buildSignalCardActionFeedback(input)
  if (!feedback.show) {
    return { show: false, label: "", detail: "", jumpLabel: "", tone: "done" }
  }
  return {
    show: true,
    label: feedback.label,
    detail: feedback.detail,
    jumpLabel: feedback.jumpTargetLabel ?? "",
    tone: feedback.tone,
  }
}

export function buildSignalCardActionButtonState({
  action,
  feedback,
  running,
}: {
  action: SignalCardAction
  feedback?: SignalCardActionFeedback
  running?: boolean
}): SignalCardActionButtonState {
  const feedbackIsRunning = Boolean(feedback?.show && feedback.tone === "running")
  const isThisActionRunning = Boolean(feedbackIsRunning && feedback?.action === action.kind)
  const cachedAskIsOpening = isThisActionRunning && action.kind === "ask" && action.label === "秒开 Ask"
  const label = isThisActionRunning ? (cachedAskIsOpening ? "打开缓存中" : `${action.label}中`) : action.label
  const runningHint = isThisActionRunning ? "正在执行这一步，完成后会更新卡片反馈。" : ""
  const title = [runningHint, action.description].filter(Boolean).join(" ")
  return {
    label,
    busy: isThisActionRunning,
    disabled: Boolean(running || feedbackIsRunning),
    title,
    ariaLabel: isThisActionRunning ? `正在执行待处理卡片动作：${action.label}` : action.ariaLabel,
  }
}

function cardAction(
  kind: SignalCardActionKind,
  label: string,
  variant: SignalCardAction["variant"],
  descriptionOverride?: string,
): SignalCardAction {
  const description = descriptionOverride ?? SIGNAL_CARD_ACTION_DESCRIPTIONS[kind]
  return {
    kind,
    label,
    description,
    variant,
    ariaLabel: `执行待处理卡片动作：${label}。${description}`,
  }
}

export function buildSignalCardActions(input: SignalCardActionInput): SignalCardActionPlan {
  const ignore = cardAction("ignore", "本轮忽略", "ghost")
  if (input.kind === "candidate") {
    const precheck = cardAction("precheck", "Ask 预检", "outline")
    const track = cardAction("track", "加入跟踪", "outline")
    return input.askDeepDiveRecommended
      ? { primary: precheck, secondary: [track, ignore] }
      : { primary: track, secondary: [precheck, ignore] }
  }

  const ask = cardAction(
    "ask",
    input.askCacheStatus?.show ? input.askCacheStatus.actionLabel : "Ask 深挖",
    "outline",
    input.askCacheStatus?.show ? input.askCacheStatus.actionTitle : undefined,
  )
  if (input.canConfirm) {
    const secondary = input.canAsk ? [ask, ignore] : [ignore]
    return { primary: cardAction("confirm", "确认状态", "default"), secondary }
  }
  if (input.canAsk) {
    return { primary: ask, secondary: [ignore] }
  }
  return { primary: ignore, secondary: [] }
}

export function buildSignalCardActionPanelCopy(plan: SignalCardActionPlan): SignalCardActionPanelCopy {
  const primaryKind = plan.primary.kind
  if (primaryKind === "confirm") {
    return {
      label: "主动作：确认状态",
      actionLine: "现在该做：确认状态；确认后写入假设记忆。",
      detail: "确认后才写入假设记忆；不写 wiki/raw，也不触发交易。",
      tone: "action",
    }
  }
  if (primaryKind === "ask" || primaryKind === "precheck") {
    if (primaryKind === "ask" && plan.primary.label === "秒开 Ask") {
      return {
        label: "主动作：秒开结果",
        actionLine: "现在该做：打开缓存 Ask；先看上次摘要再决定是否重跑。",
        detail: "已缓存同一条信号的 Ask 摘要；打开后可重新检索最新资料。",
        tone: "research",
      }
    }
    return {
      label: primaryKind === "precheck" ? "主动作：先预检" : "主动作：先研究",
      actionLine: primaryKind === "precheck"
        ? "现在该做：Ask 预检；确认值得跟踪再入池。"
        : "现在该做：Ask 深挖；先看股票、链条、来源和利好排序。",
      detail: "结果会出现在 Ask 结果区；先看关联股票、利好排序和来源，再决定是否确认或入池。",
      tone: "research",
    }
  }
  if (primaryKind === "track") {
    return {
      label: "主动作：加入跟踪",
      actionLine: "现在该做：加入跟踪；后续用新增资料继续验证。",
      detail: "入池后由新增资料和 wiki 增量继续跟踪，不自动下结论。",
      tone: "track",
    }
  }
  return {
    label: "低优先级：可忽略",
    actionLine: "现在该做：本轮忽略；不改变假设状态。",
    detail: "本轮只隐藏卡片，不改变假设状态，也不写 wiki/raw。",
    tone: "quiet",
  }
}

export function buildSignalRunDigest(input: SignalRunDigestInput): SignalRunDigest {
  const totalCount = Math.max(0, numberValue(input.totalCount))
  const rawSignalCount = Math.max(totalCount, numberValue(input.rawSignalCount))
  const confirmableCount = Math.max(0, numberValue(input.confirmableCount))
  const askRecommendedCount = Math.max(0, numberValue(input.askRecommendedCount))
  const catalystCount = Math.max(0, numberValue(input.catalystCount))
  const hardEvidenceCount = Math.max(0, numberValue(input.hardEvidenceCount))
  const counterCount = Math.max(0, numberValue(input.counterCount))
  const marketFeedbackCount = Math.max(0, numberValue(input.marketFeedbackCount))
  const candidateCount = Math.max(0, numberValue(input.candidateCount))
  const quietCount = Math.max(0, numberValue(input.quietCount))
  const badges = [
    { label: "新催化", value: catalystCount, tone: "strong" as const },
    { label: "可确认", value: confirmableCount, tone: "strong" as const },
    { label: "建议 Ask", value: askRecommendedCount, tone: "default" as const },
    { label: "硬证据", value: hardEvidenceCount, tone: "strong" as const },
    { label: "市场反馈", value: marketFeedbackCount, tone: "warn" as const },
    { label: "反证", value: counterCount, tone: "danger" as const },
    { label: "候选", value: candidateCount, tone: "default" as const },
  ].filter((item) => item.value > 0)

  if (totalCount === 0) {
    return {
      tone: "idle",
      headline: "本轮暂无待处理信号",
      detail: "扫描后没有发现能改变假设状态的新增资料；可以继续自动跟踪。",
      badges: [],
    }
  }
  if (confirmableCount > 0) {
    return {
      tone: "action",
      headline: `今天先处理 ${confirmableCount} 条状态变化`,
      detail: "先确认真实状态变化，再决定是否 Ask 深挖或补材料。",
      badges,
    }
  }
  if (hardEvidenceCount > 0 || counterCount > 0) {
    return {
      tone: "action",
      headline: counterCount > 0 ? `出现 ${counterCount} 条反证，先复核` : `出现 ${hardEvidenceCount} 条硬证据，先看原文`,
      detail: "这类信号比普通舆情更重要，但仍需要人工确认后才写入假设状态。",
      badges,
    }
  }
  if (askRecommendedCount > 0) {
    return {
      tone: "review",
      headline: `有 ${askRecommendedCount} 条值得 Ask 深挖`,
      detail: "先用 Ask 排关联股票、受益链条和利好排序，再决定是否确认或入池。",
      badges,
    }
  }
  if (catalystCount > 0 || candidateCount > 0) {
    return {
      tone: "review",
      headline: `${catalystCount + candidateCount} 条新催化/候选线索`,
      detail: "先看是否有二次来源、wiki 回连和量价扩散；泛舆情不用急着确认。",
      badges,
    }
  }
  return {
    tone: "quiet",
    headline: "主要是叙事扩散，先观察",
    detail: `${quietCount || totalCount} 条低优先级信号暂不改变假设，等二次确认或市场反馈再处理。`,
    badges: rawSignalCount > totalCount ? [{ label: "合并信号", value: rawSignalCount }] : [],
  }
}

export function buildSignalFocusBuckets(input: SignalFocusBucketsInput): SignalFocusBucket[] {
  const buckets: SignalFocusBucket[] = [
    {
      id: "confirm",
      label: "可确认",
      value: Math.max(0, numberValue(input.confirmableCount)),
      tone: "action",
      guidance: "先确认状态变化，写入假设记忆。",
    },
    {
      id: "counter",
      label: "反证",
      value: Math.max(0, numberValue(input.counterCount)),
      tone: "danger",
      guidance: "先排除误判，避免把坏消息当利好。",
    },
    {
      id: "hard",
      label: "硬证据",
      value: Math.max(0, numberValue(input.hardEvidenceCount)),
      tone: "strong",
      guidance: "先看原文，确认订单、公告、交付或财报口径。",
    },
    {
      id: "market",
      label: "市场反馈",
      value: Math.max(0, numberValue(input.marketFeedbackCount)),
      tone: "warn",
      guidance: "先判断刚扩散还是已经 priced-in。",
    },
    {
      id: "catalyst",
      label: "新催化",
      value: Math.max(0, numberValue(input.catalystCount)),
      tone: "review",
      guidance: "先看二次来源、wiki 回连和 1-5 日扩散。",
    },
    {
      id: "candidate",
      label: "候选",
      value: Math.max(0, numberValue(input.candidateCount)),
      tone: "review",
      guidance: "只把可跟踪变量加入假设池。",
    },
    {
      id: "quiet",
      label: "低优先级",
      value: Math.max(0, numberValue(input.quietCount)),
      tone: "quiet",
      guidance: "叙事扩散先收起，等二次确认。",
    },
  ]
  return buckets.filter((bucket) => bucket.value > 0)
}

export function buildPmSignalTriageBuckets(input: PmSignalTriageInput): PmSignalTriageBucket[] {
  const confirmable = Math.max(0, numberValue(input.confirmableCount))
  const counter = Math.max(0, numberValue(input.counterCount))
  const hard = Math.max(0, numberValue(input.hardEvidenceCount))
  const market = Math.max(0, numberValue(input.marketFeedbackCount))
  const ask = Math.max(0, numberValue(input.askRecommendedCount))
  const catalyst = Math.max(0, numberValue(input.catalystCount))
  const candidate = Math.max(0, numberValue(input.candidateCount))
  const quiet = Math.max(0, numberValue(input.quietCount))
  const now = confirmable + counter + hard + market + ask
  const watch = Math.max(0, catalyst + candidate - ask)
  return [
    {
      id: "now",
      label: "马上看",
      value: now,
      tone: "action",
      active: now > 0,
      detail: now > 0
        ? "确认/反证/硬证据/市场反馈/Ask 已经足够进入人工处理。"
        : "暂无必须马上处理的状态变化或强验证信号。",
      nextAction: now > 0
        ? "先处理这些卡：确认状态、Ask 深挖或排除反证。"
        : "等出现状态变化、硬证据、市场反馈或建议 Ask。",
    },
    {
      id: "watch",
      label: "可观察",
      value: watch,
      tone: "review",
      active: watch > 0,
      detail: watch > 0
        ? "新催化/候选线索先观察二次来源、wiki 回连和量价扩散。"
        : "暂无需要建新假设或观察的新催化候选。",
      nextAction: watch > 0
        ? "只把能跟踪变量和来源的候选加入假设池。"
        : "保持假设池，等待新增催化。",
    },
    {
      id: "noise",
      label: "噪声/待二次确认",
      value: quiet,
      tone: "quiet",
      active: quiet > 0,
      detail: quiet > 0
        ? "叙事扩散、弱候选和重复来源先收起，不改变假设状态。"
        : "没有明显低优先级噪声堆积。",
      nextAction: quiet > 0
        ? "继续自动跟踪；等二次确认、硬证据或市场反馈再处理。"
        : "继续扫描新增资料即可。",
    },
  ]
}

export function buildQuietSignalVisibility({
  hasPriority,
  quietCount,
  showQuietSignals,
}: {
  hasPriority?: boolean
  quietCount?: unknown
  showQuietSignals?: boolean
}): QuietSignalVisibility {
  const count = Math.max(0, numberValue(quietCount))
  if (count <= 0) {
    return {
      showQuietSignals: false,
      showSummary: false,
      reason: "none",
    }
  }
  if (showQuietSignals) {
    return {
      showQuietSignals: true,
      showSummary: true,
      reason: "expanded",
    }
  }
  return {
    showQuietSignals: false,
    showSummary: true,
    reason: hasPriority ? "mixed-priority" : "quiet-only",
  }
}

export function buildQuietSignalSummaryPlacement({
  visibility,
  hiddenCount,
}: {
  visibility: QuietSignalVisibility
  hiddenCount?: unknown
}): QuietSignalSummaryPlacement {
  if (visibility.showSummary && visibility.reason !== "none") return { position: "before-list" }
  if (Math.max(0, numberValue(hiddenCount)) > 0) return { position: "after-list" }
  return { position: "none" }
}

export function buildQuietSignalsSummary(input: QuietSignalsSummaryInput): QuietSignalsSummary {
  const quietTrackedCount = Math.max(0, numberValue(input.quietTrackedCount))
  const quietCandidateCount = Math.max(0, numberValue(input.quietCandidateCount))
  const quietCount = quietTrackedCount + quietCandidateCount
  const rawCount = Math.max(quietCount, numberValue(input.quietRawSignalCount))
  const duplicateCount = Math.max(0, rawCount - quietCount)
  const hiddenCount = Math.max(0, numberValue(input.hiddenCount))
  const badges = [
    { label: "叙事扩散", value: quietTrackedCount },
    { label: "弱候选", value: quietCandidateCount },
    { label: "重复来源", value: duplicateCount },
  ].filter((item) => item.value > 0)

  if (quietCount <= 0) {
    return {
      headline: "优先卡片较多，先处理当前可见项",
      detail: hiddenCount > 0 ? `仍有 ${hiddenCount} 条未展开；先处理当前可见的高优先级信号。` : "当前没有低优先级噪声堆积。",
      decisionLabel: hiddenCount > 0 ? "先处理优先卡片" : "无低优先级噪声",
      nextAction: hiddenCount > 0 ? "处理完优先卡片后，再展开抽查剩余项。" : "继续扫描新增资料即可。",
      badges: [],
      toggleLabel: "展开更多",
    }
  }

  const parts = [
    quietTrackedCount > 0 ? `${quietTrackedCount} 条叙事扩散/弱相关命中` : "",
    quietCandidateCount > 0 ? `${quietCandidateCount} 条弱候选` : "",
    duplicateCount > 0 ? `${duplicateCount} 条重复来源` : "",
  ].filter(Boolean)
  const hasPriority = Boolean(input.hasPriority)
  const decisionLabel = input.showQuietSignals
    ? "正在复核低优先级"
    : hasPriority
      ? "先处理优先卡片"
      : "可以先不处理"
  const nextAction = input.showQuietSignals
    ? "只挑有二次来源、硬证据或市场反馈的卡片处理，其余继续观察。"
    : hasPriority
      ? "处理完优先卡片后，可展开抽查低优先级来源。"
      : "保持自动跟踪；出现二次确认、硬证据或市场反馈后会进入优先区。"
  return {
    headline: input.showQuietSignals
      ? `正在显示 ${quietCount} 条低优先级信号`
      : hasPriority
        ? `默认收起 ${quietCount} 条低优先级信号`
        : `本轮只有 ${quietCount} 条低优先级信号`,
    detail: `${parts.join("，") || "低优先级信号"}；这些信号暂不改变状态，等二次确认、硬证据或市场反馈再处理。`,
    decisionLabel,
    nextAction,
    badges,
    toggleLabel: input.showQuietSignals ? "收起低优先级" : "展开低优先级",
  }
}

export function buildPendingCountLabel({
  totalCount,
  priorityCount,
  quietCount,
  rawSignalCount,
}: PendingCountLabelInput) {
  const total = Math.max(0, numberValue(totalCount))
  const priority = Math.max(0, numberValue(priorityCount))
  const quiet = Math.max(0, numberValue(quietCount))
  const raw = Math.max(total, numberValue(rawSignalCount))
  const rawSuffix = raw > total ? ` / 合并 ${raw} 条` : ""
  if (total <= 0) return "0 组"
  if (priority > 0 && quiet > 0) return `${priority} 个优先 / 折叠 ${quiet} 个低优先级${rawSuffix}`
  if (priority > 0) return `${priority} 个优先${rawSuffix}`
  if (quiet > 0) return `${quiet} 个低优先级${rawSuffix}`
  return `${total} 组${rawSuffix}`
}

export function signalWorkSectionFor(input: SignalWorkSectionInput): SignalWorkSectionId {
  const evidenceDelta = textValue(input.evidenceDelta)
  const signalType = textValue(input.signalType)
  if (input.canConfirm) return "confirm"
  if (evidenceDelta === "counter_signal" || signalType === "反证") return "counter"
  if (evidenceDelta === "fundamental_delivery" || signalType === "硬证据") return "hard"
  if (evidenceDelta === "market_feedback" || signalType === "市场反馈") return "market"
  if (input.kind === "candidate") return "candidate"
  if (input.askDeepDiveRecommended || evidenceDelta === "catalyst_signal" || signalType === "新催化") return "catalyst"
  return "quiet"
}

export function pmSignalTriageBucketForSignal(input: PmSignalTriageBucketRouteInput): PmSignalTriageBucketId {
  const section = signalWorkSectionFor({
    ...input,
    kind: input.kind ?? "tracked",
  })
  if (section === "confirm" || section === "counter" || section === "hard" || section === "market") return "now"
  if (input.askDeepDiveRecommended) return "now"
  if (section === "candidate" || section === "catalyst") return "watch"
  return "noise"
}

const SIGNAL_WORK_SECTION_COPY: Record<SignalWorkSectionId, Omit<SignalWorkSectionHeader, "id" | "countLabel">> = {
  confirm: {
    label: "待确认状态",
    detail: "会改变假设状态，先复核来源可信度，再写入假设记忆。",
    tone: "action",
  },
  counter: {
    label: "反证 / 风险",
    detail: "先排除误判，避免把坏消息当利好；必要时降级假设。",
    tone: "danger",
  },
  hard: {
    label: "硬证据",
    detail: "先看原文，确认订单、公告、交付或财报口径。",
    tone: "strong",
  },
  market: {
    label: "市场反馈",
    detail: "价格或热度已经先动，判断刚扩散还是已经 priced-in。",
    tone: "warn",
  },
  catalyst: {
    label: "新催化 / Ask",
    detail: "先 Ask 排股票和链条，再看二次来源和 1-5 日扩散。",
    tone: "review",
  },
  candidate: {
    label: "候选新假设",
    detail: "先 Ask 预检，预检后再入池；泛舆情直接忽略。",
    tone: "review",
  },
  quiet: {
    label: "低优先级",
    detail: "叙事扩散或弱相关先收起，等二次确认、硬证据或市场反馈。",
    tone: "quiet",
  },
}

export function buildSignalWorkSectionHeader({
  id,
  count,
}: {
  id: SignalWorkSectionId
  count?: unknown
}): SignalWorkSectionHeader {
  const copy = SIGNAL_WORK_SECTION_COPY[id] ?? SIGNAL_WORK_SECTION_COPY.quiet
  const numericCount = Math.max(0, numberValue(count))
  return {
    id,
    label: copy.label,
    countLabel: `${numericCount} 条`,
    detail: copy.detail,
    tone: copy.tone,
  }
}

export function buildSignalRunDigestAction(summary: PmDecisionQueueSummary): SignalRunDigestAction | null {
  if (summary.primaryActionKind === "none" || summary.primaryActionKind === "scan") return null
  return {
    kind: summary.primaryActionKind,
    label: summary.primaryAction,
    secondary: summary.secondary,
    variant: summary.primaryActionKind === "confirm" ? "default" : "outline",
    ariaLabel: `执行本轮信号主行动：${summary.primaryAction}`,
  }
}

function splitPmDecisionDetail(detail: string): SignalRunDecisionCopy["decisionParts"] {
  const labels = ["为什么重要", "影响", "现在动作"]
  const parts: SignalRunDecisionCopy["decisionParts"] = []
  for (let index = 0; index < labels.length; index += 1) {
    const label = labels[index]
    const nextLabel = labels[index + 1]
    const startToken = `${label}：`
    const start = detail.indexOf(startToken)
    if (start < 0) continue
    const valueStart = start + startToken.length
    const end = nextLabel ? detail.indexOf(`${nextLabel}：`, valueStart) : -1
    const raw = detail.slice(valueStart, end >= 0 ? end : undefined)
    const value = compactDisplayText(raw.replace(/[。；\s]+$/g, ""), "", 120)
    if (value) parts.push({ label, value })
  }
  return parts.length === labels.length ? parts : []
}

export function buildSignalRunDecisionCopy({
  digest,
  queueSummary,
}: {
  digest: SignalRunDigest
  queueSummary?: PmDecisionQueueSummary
}): SignalRunDecisionCopy {
  if (queueSummary && queueSummary.primaryActionKind !== "scan") {
    return {
      headline: `下一步：${queueSummary.headline}`,
      detail: queueSummary.detail,
      supporting: digest.detail,
      decisionParts: splitPmDecisionDetail(queueSummary.detail),
    }
  }
  return {
    headline: digest.headline,
    detail: digest.detail,
    supporting: queueSummary?.detail ?? "",
    decisionParts: [],
  }
}

const FINANCE_TYPE_COVERAGE_LABELS = [
  ["stock", "股票"],
  ["company", "公司"],
  ["sector", "行业"],
  ["theme", "主题"],
  ["product_line", "产品线"],
  ["tech_route", "技术路线"],
  ["catalyst", "催化词"],
  ["trade_pattern", "交易模式"],
  ["market_regime", "市场状态"],
  ["risk_factor", "风险反证"],
] as const

function financeTypeCoverageBadges(typeCounts: Record<string, unknown>): SignalScanContextCopy["badges"] {
  return FINANCE_TYPE_COVERAGE_LABELS
    .map(([key, label]) => {
      const value = numberValue(typeCounts[key])
      return value > 0 ? { label, title: `${label} ${value}`, tone: "finance" as const } : null
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
}

function financeTypeCoverageParts(typeCounts: Record<string, unknown>) {
  return FINANCE_TYPE_COVERAGE_LABELS
    .map(([key, label]) => {
      const value = numberValue(typeCounts[key])
      return value > 0 ? `${label} ${value}` : ""
    })
    .filter(Boolean)
}

function financeEntityAuditTableName(value: unknown) {
  const table = compactDisplayText(value, "", 160)
  if (!table) return ""
  const parts = table.split(/[\\/]+/).filter(Boolean)
  return compactDisplayText(parts.at(-1) || table, table, 48)
}

function financeEntityAuditTableKind(value: unknown) {
  const table = financeEntityAuditTableName(value)
  if (table === "generalized-cleaned-entity-table.csv") {
    return {
      badgeLabel: "清洗版金融词表",
      inlineLabel: "清洗版金融词表",
      expandedLabel: "SAG 清洗泛化金融关键词表",
      titleLabel: "清洗泛化表",
    }
  }
  if (table === "cleaned-entity-table.csv") {
    return {
      badgeLabel: "清洗金融词表",
      inlineLabel: "清洗金融词表",
      expandedLabel: "SAG 清洗金融关键词表",
      titleLabel: "清洗表",
    }
  }
  return {
    badgeLabel: "全量金融词表",
    inlineLabel: "全量金融词表",
    expandedLabel: "SAG 金融关键词表",
    titleLabel: "词表",
  }
}

export function buildSignalScanContextCopy(summary: unknown): SignalScanContextCopy {
  const record = unknownRecord(summary)
  if (!Object.keys(record).length) {
    return {
      show: false,
      label: "",
      detail: "",
      tone: "idle",
      badges: [],
    }
  }
  const contextLoads = unknownRecord(record.contextLoads)
  const sourceDiscovery = unknownRecord(record.sourceDiscovery)
  const reviewPipeline = unknownRecord(record.reviewPipeline)
  const llmStage = unknownRecord(reviewPipeline.llm)
  const skippedReason = textValue(record.skippedReason)
  const wikiIndustryTerms = Boolean(contextLoads.wikiIndustryTerms)
  const wikiReferenceIndex = Boolean(contextLoads.wikiReferenceIndex)
  const financeEntityAudit = Boolean(contextLoads.financeEntityAudit)
  const financeRows = numberValue(contextLoads.financeEntityAuditRows)
  const financeTable = financeEntityAuditTableName(contextLoads.financeEntityAuditTableRef)
  const financeTableKind = financeEntityAuditTableKind(contextLoads.financeEntityAuditTableRef)
  const financeTypeCounts = unknownRecord(contextLoads.financeEntityAuditTypeCounts)
  const financeCoverage = financeTypeCoverageParts(financeTypeCounts)
  const financeCoverageBadges = financeTypeCoverageBadges(financeTypeCounts)
  const fileRootsSkipped = numberValue(sourceDiscovery.fileRootsSkipped)
  const fileCandidates = numberValue(sourceDiscovery.fileCandidatesAfterCutoff)
  const fileSourcesRead = numberValue(sourceDiscovery.fileSourcesRead)
  const fileSourcesSkippedByLimit = numberValue(sourceDiscovery.fileSourcesSkippedByLimit)
  const discoveryMs = numberValue(sourceDiscovery.durationMs)
  const wechatSources = numberValue(sourceDiscovery.wechatIncrementalSources)
  const wechatLinesRead = numberValue(sourceDiscovery.wechatIncrementalLinesRead)
  const llmStatus = compactDisplayText(llmStage.status ?? record.llmReviewStatus, "", 40).toLowerCase()
  const llmReason = compactDisplayText(llmStage.reason, "", 80).toLowerCase()
  const llmReviewedCount = numberValue(llmStage.reviewedCount)
  const llmCandidateCount = numberValue(llmStage.candidateCount)
  const llmMaxItems = numberValue(llmStage.maxItems)
  const llmDone = llmStatus === "done"
  const llmNeedsReview = llmStatus === "skipped" && llmReason === "too_many_candidate_items"
  const speedBadges: SignalScanContextCopy["badges"] = []
  if (fileRootsSkipped > 0) speedBadges.push({ label: `跳过文件根 ${fileRootsSkipped}` })
  if (fileCandidates > 0) speedBadges.push({ label: `文件候选 ${fileCandidates}` })
  if (fileSourcesRead > 0) speedBadges.push({ label: `读取文件 ${fileSourcesRead}` })
  if (fileSourcesSkippedByLimit > 0) speedBadges.push({ label: `限额跳过 ${fileSourcesSkippedByLimit}` })
  if (wechatSources > 0) speedBadges.push({ label: `资料源 ${wechatSources}` })
  if (wechatLinesRead > 0) speedBadges.push({ label: `资料读行 ${wechatLinesRead}` })
  if (discoveryMs > 0) speedBadges.push({ label: `源发现 ${discoveryMs}ms` })
  if (llmDone) speedBadges.push({ label: `LLM复核 ${llmReviewedCount}/${Math.max(llmCandidateCount, llmReviewedCount)}` })
  if (llmNeedsReview) speedBadges.push({ label: `待LLM复核 ${llmCandidateCount || llmMaxItems}` })
  const badges: SignalScanContextCopy["badges"] = []
  if (wikiIndustryTerms) badges.push({ label: "已读 wiki 词典", tone: "wiki" })
  if (wikiReferenceIndex) badges.push({ label: "已回连 wiki 页面", tone: "wiki" })
  if (financeEntityAudit) badges.push({
    label: financeRows > 0 ? `${financeTableKind.badgeLabel} ${compactChineseCount(financeRows)}` : "SAG金融词",
    title: [
      financeRows > 0 ? `SAG金融词 ${financeRows} 行` : "",
      financeTable ? `${financeTableKind.titleLabel} ${financeTable}` : "",
    ].filter(Boolean).join("；") || undefined,
    tone: "finance",
  })
  badges.push(...financeCoverageBadges.slice(0, 4))

  if (skippedReason === "no_sources") {
    return {
      show: true,
      label: "无新增资料",
      detail: "本轮没有可扫描的新来源，系统没有加载 wiki 或金融词表；自动跟踪可以继续等下一批增量。",
      tone: "idle",
      badges: [{ label: "未加载上下文" }, ...speedBadges],
    }
  }

  if (!wikiIndustryTerms && !wikiReferenceIndex) {
    return {
      show: true,
      label: "轻扫描",
      detail: "本轮只做去重、规则过滤和已有假设匹配；没有必要加载 wiki 框架，反馈会更快。",
      tone: "light",
      badges: [{ label: "快速路径" }, ...speedBadges],
    }
  }

	  if (financeEntityAudit) {
	    const coverageLine = financeCoverage.length ? `覆盖：${financeCoverage.join("、")}。` : ""
	    const decisionLine = "这次不是普通关键词匹配，会按股票、公司、行业、主题、产品线、技术路线、催化、交易模式、市场状态和风险反证来路由新增资料，用来生成待处理卡片与 Ask 深挖入口。"
    const llmLine = llmDone
      ? `LLM 已复核 ${llmReviewedCount} 条规则候选，状态仍需人工确认。`
      : llmNeedsReview
        ? `规则结果待复核：候选 ${llmCandidateCount} 条超过自动复核上限${llmMaxItems > 0 ? ` ${llmMaxItems}` : ""}，建议缩小到单条假设或手动复核。`
        : ""
	    return {
	      show: true,
	      label: llmDone ? "框架扫描+LLM复核" : "框架扫描",
	      detail: `已用 wiki 框架和${financeTableKind.inlineLabel}路由新增资料；下一步看待处理卡片或点 LLM 复核。`,
	      expandedDetail: financeTable
	        ? `已结合 wiki 页面和 ${financeTableKind.expandedLabel}路由信号。${decisionLine}${coverageLine}${llmLine}已加载${financeTableKind.titleLabel} ${financeTable}。`
	        : `已结合 wiki 页面和 ${financeTableKind.expandedLabel}路由信号。${decisionLine}${coverageLine}${llmLine}`,
	      tone: "finance",
	      badges: [...badges, ...financeCoverageBadges.slice(4, 8), ...speedBadges],
	    }
  }

  const frameworkLlmLine = llmDone
    ? `LLM 已复核 ${llmReviewedCount} 条规则候选，状态仍需人工确认。`
    : llmNeedsReview
      ? `规则结果待复核：候选 ${llmCandidateCount} 条超过自动复核上限。`
      : ""
  return {
    show: true,
    label: llmDone ? "框架扫描+LLM复核" : "框架扫描",
    detail: "已用 wiki 词典和相关页面定位新增资料；下一步看命中假设和待处理卡片。",
    expandedDetail: `已加载 wiki 词典和相关页面，用来判断新增资料命中了哪个假设或概念框架。${frameworkLlmLine}`,
    tone: "framework",
    badges: [...badges, ...speedBadges],
  }
}

export function buildSignalSourceCapabilityCopy(summary: unknown): SignalScanContextCopy {
  const copy = buildSignalScanContextCopy(summary)
  if (copy.show) return copy
  return {
    show: true,
    label: "等待扫描",
    detail: "点击「扫描新增资料」后，这里会显示本轮是否加载 wiki 框架和 SAG 金融关键词表。",
    tone: "idle",
    badges: [{ label: "未加载上下文" }],
  }
}

export function buildPmFocusBrief({
  queueSummary,
  digest,
}: {
  queueSummary: PmDecisionQueueSummary
  digest: SignalRunDigest
}): PmFocusBrief {
  const detail = compactDisplayText(queueSummary.detail || digest.detail, digest.detail, 220)
  const framework = compactDisplayText(queueSummary.frameLine, "", 140)
  const targetTitle = pmFocusTargetTitle(queueSummary)
  if (queueSummary.primaryActionKind === "confirm") {
    return {
      label: "今天先确认",
      headline: queueSummary.headline,
      targetLabel: "主目标",
      targetTitle,
      detail,
      framework,
      operatorHint: "操作：点「确认状态」前先看来源/理由；确认后只写入假设记忆和审计事件。",
      locatorHint: "下方蓝框已标出今日先手卡片；可直接点右侧「确认状态」，或先展开卡片看来源/理由。",
      primaryOutcome: "点完会写入假设状态和审计事件，并刷新假设表；不会写 wiki/raw。",
      guardrail: "确认才写入 .llm-wiki 假设记忆；不写 wiki/raw，也不触发交易。",
      tone: "action",
    }
  }
  if (queueSummary.primaryActionKind === "ask") {
    const actionLabel = queueSummary.primaryAction || "Ask 深挖"
    return {
      label: "今天先研究",
      headline: queueSummary.headline,
      targetLabel: "研究目标",
      targetTitle,
      detail,
      framework,
      operatorHint: `操作：点「${actionLabel}」，先拿关联股票、最直接受益、利好排序和证据来源。`,
      locatorHint: "下方蓝框已标出今日先手卡片；点 Ask 后看 Ask 结果区的摘要、股票和六段回答。",
      primaryOutcome: "点完会在下方显示结构化摘要、关联股票、利好排序、六段回答和来源。",
      guardrail: "Ask 只生成研究材料和来源，不自动改假设状态。",
      tone: "review",
    }
  }
  if (queueSummary.primaryActionKind === "create") {
    return {
      label: "今天先筛选",
      headline: queueSummary.headline,
      targetLabel: "候选目标",
      targetTitle,
      detail,
      framework,
      operatorHint: "操作：候选先做 Ask 预检；只有能跟踪变量、来源和股票链条的才加入跟踪。",
      locatorHint: "下方蓝框已标出候选卡片；先 Ask 预检，确认值得跟踪后再点「加入跟踪」。",
      primaryOutcome: "点完会先把候选变成可复核研究材料；加入跟踪后才进入假设池。",
      guardrail: "候选只有加入跟踪后才进入假设池；泛舆情可以忽略。",
      tone: "review",
    }
  }
  if (queueSummary.primaryActionKind === "scan") {
    return {
      label: "等待新信号",
      headline: queueSummary.headline,
      targetLabel: "信号源",
      targetTitle,
      detail,
      framework,
      operatorHint: "操作：先点「扫描新增资料」或开启自动跟踪；没有新增时不需要处理。",
      locatorHint: "顶部主按钮区点「扫描新增资料」；扫描完成后，下方待处理区会出现今日先手卡片。",
      primaryOutcome: "点完会导入、去重并扫描新增资料，生成待处理卡片。",
      guardrail: "先扫描新增资料或开启自动跟踪，系统只生成建议。",
      tone: "idle",
    }
  }
  return {
    label: "今天先观察",
    headline: queueSummary.headline || digest.headline,
    targetLabel: "观察对象",
    targetTitle,
    detail,
    framework,
    operatorHint: "操作：暂不确认，等二次确认、硬证据或市场反馈；必要时只展开低优先级查看。",
    locatorHint: "暂无需要处理的蓝框先手卡片；保持自动跟踪，或从顶部发起 AI 并发找假设。",
    primaryOutcome: "现在不需要写入；保持观察，等更强信号进入待处理区。",
    guardrail: "低优先级信号不需要确认，等二次来源、硬证据或市场反馈。",
    tone: "quiet",
  }
}

export function buildPmOpeningBrief({
  queueSummary,
  digest,
}: {
  queueSummary: PmDecisionQueueSummary
  digest: SignalRunDigest
}): PmOpeningBrief {
  const targetTitle = pmFocusTargetTitle(queueSummary)
  const target = compactDisplayText(targetTitle, "", 56)
  const targetText = target ? `「${target}」` : ""
  const framework = compactDisplayText(queueSummary.frameLine, "", 120)
  const parts = splitPmDecisionDetail(queueSummary.detail)
  const why = compactDisplayText(parts.find((part) => part.label === "为什么重要")?.value, "", 100)
  const impact = compactDisplayText(parts.find((part) => part.label === "影响")?.value, target, 100)
  const action = compactDisplayText(parts.find((part) => part.label === "现在动作")?.value, queueSummary.primaryAction, 110)
  const frameworkDetail = framework ? `命中框架：${framework}。` : ""
  const secondary = compactDisplayText(queueSummary.secondary, "", 80)
  const secondaryDetail = secondary ? `${secondary}。` : ""

  if (queueSummary.primaryActionKind === "confirm") {
    return {
      label: "PM一句话",
      headline: `今天先确认${targetText}：${action || "复核来源后写入状态变化"}`,
      detail: `${frameworkDetail}${why || digest.detail}；${impact ? `影响：${impact}。` : ""}${secondaryDetail}确认才写入假设记忆，不写 wiki/raw。`,
      actionLabel: queueSummary.primaryAction || "确认状态",
      framework,
      tone: "action",
    }
  }
  if (queueSummary.primaryActionKind === "ask") {
    return {
      label: "PM一句话",
      headline: `今天先 Ask${targetText}：${action || "排关联股票、直接受益和利好排序"}`,
      detail: `${frameworkDetail}${why || digest.detail}；${impact ? `影响：${impact}。` : ""}${secondaryDetail}Ask 只生成研究材料，不自动改状态。`,
      actionLabel: queueSummary.primaryAction || "Ask 深挖",
      framework,
      tone: "review",
    }
  }
  if (queueSummary.primaryActionKind === "create") {
    return {
      label: "PM一句话",
      headline: `今天先筛${targetText}：${action || "候选先预检，能持续跟踪再入池"}`,
      detail: `${frameworkDetail}${why || "出现候选新假设"}；${secondaryDetail}候选不会自动入池，加入跟踪后才进入假设表。`,
      actionLabel: queueSummary.primaryAction || "创建或忽略",
      framework,
      tone: "review",
    }
  }
  if (queueSummary.primaryActionKind === "scan") {
    return {
      label: "PM一句话",
      headline: "先扫描新增：今天还没有需要处理的信号",
      detail: "点击扫描新增资料或开启自动跟踪；系统只生成建议，状态仍需人工确认。",
      actionLabel: queueSummary.primaryAction || "扫描新增资料",
      framework,
      tone: "idle",
    }
  }
  return {
    label: "PM一句话",
    headline: target ? `今天先观察${targetText}：主要是叙事扩散` : "今天先观察：主要是叙事扩散",
    detail: `${frameworkDetail}${why || digest.detail}；${secondaryDetail}暂不确认，等二次来源、硬证据或市场反馈。`,
    actionLabel: queueSummary.primaryAction || "无需立刻确认",
    framework,
    tone: "quiet",
  }
}

function queueDecisionSignalKind(item: SignalQueueDecisionItem, kind: "catalyst" | "hard" | "counter" | "market") {
  const delta = textValue(item.evidenceDelta, "")
  const signal = textValue(item.signalType, "")
  if (kind === "catalyst") return delta === "catalyst_signal" || signal === "新催化"
  if (kind === "hard") return delta === "fundamental_delivery" || signal === "硬证据"
  if (kind === "counter") return delta === "counter_signal" || signal === "反证"
  return delta === "market_feedback" || signal === "市场反馈"
}

function normalizedSignalQueueItems(items: SignalQueueDecisionItem[]) {
  return items
    .map((item, index) => ({
      ...item,
      key: textValue(item.key, `${index}`),
      title: textValue(item.title, ""),
      createdAt: textValue(item.createdAt, ""),
      score: numberValue(item.score),
      priority: Boolean(item.priority),
      canConfirm: Boolean(item.canConfirm),
      askDeepDiveRecommended: Boolean(item.askDeepDiveRecommended),
      sourceCount: Math.max(1, numberValue(item.sourceCount)),
      relatedWikiPages: arrayRecords(item.relatedWikiPages),
      financeEntityRecords: arrayRecords(item.financeEntityRecords),
    }))
    .sort((a, b) => b.score - a.score || b.createdAt.localeCompare(a.createdAt) || a.key.localeCompare(b.key))
}

export function buildAlphaFeedSummary({
  items,
  visibleLimit = 5,
}: {
  items: SignalQueueDecisionItem[]
  visibleLimit?: number
}): AlphaFeedSummary {
  const safeLimit = Math.max(3, Math.min(5, Math.floor(numberValue(visibleLimit)) || 5))
  const sortedItems = normalizedSignalQueueItems(items)
  const priorityItems = sortedItems.filter((item) => item.priority)
  const quietItems = sortedItems.filter((item) => !item.priority)
  const priorityVisibleCount = Math.min(safeLimit, priorityItems.length)
  const askCount = priorityItems.filter((item) => item.askDeepDiveRecommended).length
  const confirmCount = priorityItems.filter((item) => item.canConfirm).length
  const foldedOverflowCount = Math.max(0, priorityItems.length - priorityVisibleCount)
  const foldedNoiseCount = quietItems.length
  const totalFoldedCount = foldedNoiseCount + foldedOverflowCount
  const hasPriority = priorityItems.length > 0
  const title = sortedItems.length <= 0
    ? "今天还没有 Alpha 待办"
    : hasPriority
      ? `今日优先 ${priorityVisibleCount} 条`
      : "今天主要是低优先级噪声"
  const subtitle = sortedItems.length <= 0
    ? "先扫描新增资料，或用 AI 并发找中观假设。"
    : hasPriority
      ? "先处理可确认、建议 Ask、硬证据或市场反馈；其余信号默认折叠。"
      : "本轮还没有足够强的投研动作，低优先级信号先折叠等待二次确认。"
  return {
    title,
    subtitle,
    visibleLimit: safeLimit,
    priorityVisibleCount,
    todayPriorityCount: priorityItems.length,
    askCount,
    confirmCount,
    foldedNoiseCount,
    foldedOverflowCount,
    totalFoldedCount,
    hasPriority,
    badges: [
      { label: "今日优先", value: priorityItems.length, tone: "action" },
      { label: "需要 Ask", value: askCount, tone: "ask" },
      { label: "建议确认", value: confirmCount, tone: "confirm" },
      { label: "已折叠噪声", value: foldedNoiseCount, tone: "quiet" },
    ],
    emptyTitle: "今天还没有 Alpha 待办",
    emptyDetail: "先扫描微信/研报/Gangtise 增量，或用 AI 并发找中观假设后加入跟踪。",
  }
}

export function buildSignalQueueDecisionViewModel({
  items,
}: {
  items: SignalQueueDecisionItem[]
}): SignalQueueDecisionViewModel {
  const sortedItems = normalizedSignalQueueItems(items)
  const priorityItems = sortedItems.filter((item) => item.priority)
  const quietItems = sortedItems.filter((item) => !item.priority)
  const priorityTrackedItems = priorityItems.filter((item) => item.kind === "tracked")
  const priorityCandidateItems = priorityItems.filter((item) => item.kind === "candidate")
  const totalCount = sortedItems.length
  const rawSignalCount = sortedItems.reduce((sum, item) => sum + item.sourceCount, 0)
  const confirmableCount = sortedItems.filter((item) => item.canConfirm).length
  const trackedAskRecommendedCount = priorityTrackedItems.filter((item) => item.askDeepDiveRecommended).length
  const trackedReviewCount = Math.max(0, priorityTrackedItems.length - trackedAskRecommendedCount)
  const candidateAskRecommendedCount = priorityCandidateItems.filter((item) => item.askDeepDiveRecommended).length
  const askRecommendedCount = trackedAskRecommendedCount + candidateAskRecommendedCount
  const catalystCount = priorityItems.filter((item) => queueDecisionSignalKind(item, "catalyst")).length
  const hardEvidenceCount = priorityItems.filter((item) => queueDecisionSignalKind(item, "hard")).length
  const counterCount = priorityItems.filter((item) => queueDecisionSignalKind(item, "counter")).length
  const marketFeedbackCount = priorityItems.filter((item) => queueDecisionSignalKind(item, "market")).length
  const digest = buildSignalRunDigest({
    totalCount,
    rawSignalCount,
    confirmableCount,
    askRecommendedCount,
    catalystCount,
    hardEvidenceCount,
    counterCount,
    marketFeedbackCount,
    candidateCount: priorityCandidateItems.length,
    quietCount: quietItems.length,
  })
  const primaryConfirmItem = sortedItems.find((item) => item.canConfirm)
  const primaryAskItem = sortedItems.find((item) => item.kind === "tracked" && item.askDeepDiveRecommended)
    ?? priorityTrackedItems[0]
  const primaryAskCandidate = sortedItems.find((item) => item.kind === "candidate" && item.askDeepDiveRecommended)
  const primaryCreateCandidate = priorityCandidateItems[0]
  const summaryAnchorTracked = primaryConfirmItem ?? primaryAskItem ?? priorityTrackedItems[0] ?? sortedItems.find((item) => item.kind === "tracked")
  const summaryAnchorCandidate = primaryAskCandidate ?? primaryCreateCandidate
  const reviewableAskCount = askRecommendedCount + trackedReviewCount
  const summaryAnchor = confirmableCount > 0
    ? summaryAnchorTracked
    : reviewableAskCount > 0
      ? summaryAnchorTracked ?? summaryAnchorCandidate
      : (priorityCandidateItems.length > 0 || sortedItems.some((item) => item.kind === "candidate"))
        ? summaryAnchorCandidate
        : summaryAnchorTracked
  const topRelatedWikiPages = summaryAnchor?.relatedWikiPages ?? []
  const topFinanceEntityRecords = summaryAnchor
    ? (summaryAnchor.financeEntityRecords.length > 0
      ? summaryAnchor.financeEntityRecords
      : [summaryAnchor, ...topRelatedWikiPages])
    : []
  const queueSummary = buildPmDecisionQueueSummary({
    totalCount,
    priorityCount: priorityItems.length,
    confirmableCount,
    askRecommendedCount,
    trackedReviewCount,
    candidateAskRecommendedCount,
    candidateCount: priorityCandidateItems.length,
    quietCount: quietItems.length,
    topTitle: summaryAnchor?.title,
    topSignalType: summaryAnchor?.signalType,
    topRelatedWikiPages,
    topFinanceEntityRecords,
  })
  return {
    totalCount,
    rawSignalCount,
    priorityCount: priorityItems.length,
    quietCount: quietItems.length,
    confirmableCount,
    askRecommendedCount,
    trackedReviewCount,
    candidateAskRecommendedCount,
    candidateCount: priorityCandidateItems.length,
    catalystCount,
    hardEvidenceCount,
    counterCount,
    marketFeedbackCount,
    digest,
    queueSummary,
    focusBrief: buildPmFocusBrief({ queueSummary, digest }),
    openingBrief: buildPmOpeningBrief({ queueSummary, digest }),
  }
}

function pmFocusTargetTitle(queueSummary: PmDecisionQueueSummary) {
  const title = compactDisplayText(queueSummary.targetTitle, "", 96)
  if (title) return title
  if (queueSummary.primaryActionKind === "scan") return "新增资料"
  if (queueSummary.primaryActionKind === "confirm") return "可确认状态变化"
  if (queueSummary.primaryActionKind === "ask") return "待深挖信号"
  if (queueSummary.primaryActionKind === "create") return "候选新假设"
  return "低优先级信号"
}

export function buildPmDecisionQueueSummary({
  totalCount,
  confirmableCount,
  askRecommendedCount,
  trackedReviewCount = 0,
  candidateAskRecommendedCount = 0,
  candidateCount,
  quietCount,
  topTitle,
  topSignalType,
  topRelatedWikiPages,
  topFinanceEntityRecords,
}: {
  totalCount: number
  priorityCount: number
  confirmableCount: number
  askRecommendedCount: number
  trackedReviewCount?: number
  candidateAskRecommendedCount?: number
  candidateCount: number
  quietCount: number
  topTitle?: unknown
  topSignalType?: unknown
  topRelatedWikiPages?: unknown
  topFinanceEntityRecords?: unknown
}): PmDecisionQueueSummary {
  const title = compactDisplayText(topTitle, "", 72)
  const signalType = compactDisplayText(topSignalType, "", 24)
  const topFrame = relatedWikiFrameContext(topRelatedWikiPages)
  const financeRecords = financeEntityRecordsForSignal({
    relatedWikiPages: topRelatedWikiPages,
    financeEntityRecords: topFinanceEntityRecords,
  })
  const financeType = financeEntityTypeSummary(financeRecords)
  const financeDecision = buildSignalFinanceEntityStrip(financeRecords).decision
  const frameLine = [topFrame, financeType].filter(Boolean).join("；")
  const quietText = quietCount > 0 ? `${quietCount} 条低优先级已折叠` : "没有低优先级堆积"
  const impactText = title ? `优先看「${title}」${signalType ? `（${signalType}）` : ""}` : "本轮重点信号"
  const frameText = financeDecision || (frameLine ? `命中${frameLine}` : "")
  const decisionDetail = ({
    why,
    action,
  }: {
    why: string
    action: string
  }) => {
    const whyText = compactDisplayText(frameText || why, why, 260)
    const actionText = compactDisplayText(action, action, 130)
    const whyLine = whyText.startsWith("为什么重要") ? whyText : `为什么重要：${whyText}`
    const whySentence = whyLine.endsWith("。") ? whyLine : `${whyLine}。`
    const actionSentence = actionText.endsWith("。") ? actionText : `${actionText}。`
    return `${whySentence}影响：${impactText}。现在动作：${actionSentence}`
  }
  if (totalCount <= 0) {
    return {
      tone: "idle",
      primaryActionKind: "scan",
      headline: "暂无待处理",
      detail: "今天还没有新的假设信号，先扫描新增资料或用 AI 并发发现假设。",
      frameLine: "",
      targetTitle: "",
      primaryAction: "扫描新增资料",
      secondary: "没有噪声堆积",
    }
  }
  if (confirmableCount > 0) {
    return {
      tone: "action",
      primaryActionKind: "confirm",
      headline: `先确认 ${confirmableCount} 条状态变化`,
      detail: decisionDetail({
        why: "这些卡片会改变假设状态",
        action: "先复核来源可信度；认可后点确认状态，写入假设记忆。",
      }),
      frameLine,
      targetTitle: title,
      primaryAction: "确认状态",
      secondary: quietText,
    }
  }
  const reviewableAskCount = Math.max(0, numberValue(askRecommendedCount)) + Math.max(0, numberValue(trackedReviewCount))
  if (reviewableAskCount > 0) {
    const allAskTargetsAreCandidates = candidateAskRecommendedCount >= reviewableAskCount
    const someAskTargetsAreCandidates = candidateAskRecommendedCount > 0
    const actionLabel = allAskTargetsAreCandidates ? "Ask 预检" : someAskTargetsAreCandidates ? "Ask 预检/深挖" : "Ask 深挖"
    return {
      tone: "review",
      primaryActionKind: "ask",
      headline: `先 ${actionLabel} ${reviewableAskCount} 条信号`,
      detail: decisionDetail({
        why: "当前更像新催化或链条扩散",
        action: `${actionLabel}，输出关联股票、直接受益、利好排序和证据来源；候选信号预检后再决定是否入池。`,
      }),
      frameLine,
      targetTitle: title,
      primaryAction: actionLabel,
      secondary: quietText,
    }
  }
  if (candidateCount > 0) {
    const visibleCandidateCount = Math.max(candidateCount, 1)
    return {
      tone: "review",
      primaryActionKind: "create",
      headline: `先筛 ${visibleCandidateCount} 条候选`,
      detail: decisionDetail({
        why: "出现候选新假设",
        action: "创建或忽略；只把能持续跟踪的变量加入假设池，泛舆情先忽略。",
      }),
      frameLine,
      targetTitle: title,
      primaryAction: "创建或忽略",
      secondary: quietText,
    }
  }
  return {
    tone: "quiet",
    primaryActionKind: "none",
    headline: "主要是叙事扩散，先观察",
    detail: "为什么重要：这些信息暂时不足以改变假设状态。影响：当前没有需要升级的核心假设。现在动作：先观察，不必做财报级验证。",
    frameLine,
    targetTitle: title,
    primaryAction: "无需立刻确认",
    secondary: quietText,
  }
}

function cleanAnswerLine(value: string) {
  return value
    .replace(/^[-*#>\s\d.、)）]+/, "")
    .replace(/\*\*/g, "")
    .trim()
}

function stripLabelPrefix(line: string, labels: string[]) {
  const cleaned = cleanAnswerLine(line)
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const direct = cleaned.match(new RegExp(`^${escaped}\\s*[:：-]\\s*(.+)$`, "i"))
    if (direct?.[1]) return direct[1].trim()
    const loose = cleaned.match(new RegExp(`^${escaped}\\s+(.+)$`, "i"))
    if (loose?.[1]) return loose[1].trim()
  }
  return cleaned
}

function markdownTableValue(line: string, labels: string[]) {
  if (!line.includes("|")) return ""
  const cells = line
    .split("|")
    .map((cell) => cleanAnswerLine(cell))
    .filter(Boolean)
    .filter((cell) => !/^:?-{2,}:?$/.test(cell))
  if (cells.length < 2) return ""
  for (let index = 0; index < cells.length - 1; index += 1) {
    const cell = cells[index]
    if (!labels.some((label) => cell.includes(label))) continue
    const value = cells.slice(index + 1).find((item) => (
      item && !labels.some((label) => item.includes(label))
    ))
    if (value) return compactDisplayText(value, "", 220)
  }
  return ""
}

function extractMarkdownSection(lines: string[], labels: string[]) {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const heading = line.match(/^#{1,4}\s+(.+)$/)
    if (!heading) continue
    const title = cleanAnswerLine(heading[1])
    if (!labels.some((label) => title.includes(label))) continue
    const body: string[] = []
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const next = lines[cursor]
      if (/^#{1,4}\s+/.test(next) && body.length > 0) break
      const cleaned = cleanAnswerLine(next)
      if (cleaned) body.push(cleaned)
      if (body.join(" ").length >= 220) break
    }
    const section = body.join(" ")
    if (section) return compactDisplayText(stripLabelPrefix(section, labels), "", 220)
  }
  return ""
}

export function extractAskAnswerField(answer: unknown, labels: string[]) {
  const lines = String(answer ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  for (const line of lines) {
    const cleaned = cleanAnswerLine(line)
    const tableValue = markdownTableValue(cleaned, labels)
    if (tableValue) return tableValue
    const afterLabel = stripLabelPrefix(cleaned, labels)
    if (afterLabel !== cleaned && afterLabel && !labels.includes(afterLabel)) return compactDisplayText(afterLabel, "", 220)
  }
  return extractMarkdownSection(lines, labels)
}

function isWeakAskExtractionLine(line: string) {
  return /(缺口|缺少|主要缺|还缺|没有|未抽出|未返回|暂无|待补|不能|无法|尚未)/u.test(line)
}

function extractAskAnswerHintLine(answer: unknown, hints: RegExp[], { skipWeak = false }: { skipWeak?: boolean } = {}) {
  const lines = String(answer ?? "").split(/\r?\n/).map((line) => cleanAnswerLine(line)).filter(Boolean)
  for (const line of lines) {
    if (skipWeak && isWeakAskExtractionLine(line)) continue
    if (hints.some((hint) => hint.test(line))) return compactDisplayText(line, "", 220)
  }
  return ""
}

function stripAskIntro(value: string, intro: RegExp) {
  const text = cleanAnswerLine(value)
  const match = text.match(intro)
  const stripped = match?.[1] ? match[1] : text
  return compactDisplayText(stripped.trim(), "", 220)
}

function extractChineseCompanyListFromLine(line: string) {
  const cleaned = cleanAnswerLine(line)
  const afterIntro = cleaned
    .replace(/^.*?(?:资料|线索|证据|来源|回答)?(?:反复)?(?:指向|包括|涉及|关注|对应|相关公司|相关标的|候选股票|股票池|受益标的)\s*/u, "")
    .replace(/这类.*$/u, "")
    .replace(/等(?:公司|标的|个股|股票)?.*$/u, "")
    .replace(/[。；;].*$/u, "")
    .trim()
  if (!/[、,，>]/.test(afterIntro)) return ""
  const names = afterIntro
    .split(/[、,，>]/)
    .map((item) => item.trim())
    .map((item) => item.replace(/\s*(?:A股|港股|公司|标的|股票|个股|链条|相关).*$/u, "").trim())
    .filter((item) => /^[\u4e00-\u9fa5A-Za-z0-9（）()]{2,12}$/.test(item))
  return names.length >= 2 ? names.join("、") : ""
}

function extractAskStocksHeuristic(answer: unknown) {
  const lines = String(answer ?? "").split(/\r?\n/).map((line) => cleanAnswerLine(line)).filter(Boolean)
  for (const line of lines) {
    if (isWeakAskExtractionLine(line)) continue
    if (!/(股票|标的|公司|A股|受益股|候选|指向|涉及|关注)/u.test(line)) continue
    const list = extractChineseCompanyListFromLine(line)
    if (list) return compactDisplayText(list, "", 220)
  }
  return ""
}

function extractAskRankingHeuristic(answer: unknown) {
  const line = extractAskAnswerHintLine(answer, [/排序/u, /受益强度/u, /弹性强度/u, /优先级/u], { skipWeak: true })
  if (!line) return ""
  return stripAskIntro(line, /(?:排序|受益强度|弹性强度|优先级)(?:大致)?(?:是|为|：|:)?\s*(.+)$/u)
}

function extractAskStageHeuristic(answer: unknown) {
  const line = extractAskAnswerHintLine(answer, [/阶段/u, /当前处于/u, /处于.*(?:催化|验证|兑现|扩散)/u], { skipWeak: true })
  if (!line) return ""
  return stripAskIntro(line, /(?:当前)?(?:处于|阶段(?:是|为|：|:)?|所处阶段(?:是|为|：|:)?)\s*(.+)$/u)
}

function extractAskGapHeuristic(answer: unknown) {
  const line = extractAskAnswerHintLine(answer, [/缺口/u, /主要缺/u, /还缺/u, /待验证/u, /需要验证/u])
  if (!line) return ""
  return stripAskIntro(line, /(?:最大缺口|证据缺口|验证缺口|关键缺口|主要缺|还缺|缺少|待验证|需要验证)(?:是|为|：|:)?\s*(.+)$/u)
}

export function buildAskDeepDiveSummary(answer: unknown): AskDeepDiveSummary {
  const summary = {
    stocks: extractAskAnswerField(answer, ["关联股票", "相关股票", "候选股票", "股票池", "受益标的", "标的"]) || extractAskStocksHeuristic(answer),
    directBeneficiary: extractAskAnswerField(answer, ["最直接受益", "直接受益", "受益链条", "受益标的", "核心受益"])
      || extractAskAnswerHintLine(answer, [/直接受益/u, /最.*受益/u, /受益.*(?:环节|链条|供应链)/u], { skipWeak: true }),
    ranking: extractAskAnswerField(answer, ["利好排序", "受益排序", "弹性排序", "标的排序", "排序"]) || extractAskRankingHeuristic(answer),
    stage: extractAskAnswerField(answer, ["当前阶段", "交易阶段", "兑现阶段", "所处阶段", "阶段"]) || extractAskStageHeuristic(answer),
    gap: extractAskAnswerField(answer, ["最大缺口", "证据缺口", "验证缺口", "关键缺口", "缺口"]) || extractAskGapHeuristic(answer),
    conclusion: extractAskAnswerField(answer, ["一句话结论", "买方结论", "交易结论", "结论"]),
  }
  const usableStocks = usableAskSummaryText(summary.stocks, 120)
  const nextAction = summary.gap
    ? `先补 ${compactDisplayText(summary.gap, "", 80)}，再决定是否确认状态。`
    : usableStocks
      ? "先用量价、公告和二次来源验证关联股票排序。"
      : "先看完整回答来源；必要时缩小到单一细分或股票再 Ask。"
  return { ...summary, nextAction }
}

function usableAskSummaryText(value: unknown, maxChars = 160) {
  const text = compactDisplayText(value, "", maxChars)
  if (!text) return ""
  if (/(未抽出|没有抽出|未返回|未提股票|暂无|待补|等待|先拿到|先展开|见下方|见下文|查看完整|不能排序|无法排序|结论未显式|阶段未显式|缺口未显式|尚未形成|未形成排序)/.test(text)) return ""
  return text
}

export function buildAskStructureFeedback({
  summary,
  sourceCount,
  hasAnswer,
}: {
  summary: AskDeepDiveSummary
  sourceCount?: unknown
  hasAnswer?: boolean
}): AskStructureFeedback {
  const sources = Math.max(0, numberValue(sourceCount))
  const hasStocks = Boolean(usableAskSummaryText(summary.stocks, 120))
  const hasRanking = Boolean(usableAskSummaryText(summary.ranking, 120))
  const hasConclusion = Boolean(usableAskSummaryText(summary.conclusion, 120))
  const sourceText = sources > 0 ? `已有 ${sources} 个来源，` : ""
  if (!hasAnswer) {
    return {
      show: true,
      kind: "source_only",
      headline: "只有检索来源，还没有六段回答",
      detail: `${sourceText}但本轮没有生成可读答案；不能据此做标的排序。`,
      next: "重试 Ask 深挖；如果仍为空，把问题缩小到单一细分、单一股票或单一证据缺口。",
      tone: "warning",
    }
  }
  if (!hasStocks) {
    return {
      show: true,
      kind: "missing_stocks",
      headline: "结构化摘要不完整：缺关联股票",
      detail: `${sourceText}但没有抽出关联股票和可执行观察清单；当前更适合当作主题线索。`,
      next: "先展开完整回答看来源；如果里面也没有，重试 Ask 并缩小到单一细分或股票。",
      tone: "warning",
    }
  }
  if (!hasRanking || !hasConclusion) {
    return {
      show: true,
      kind: "partial_summary",
      headline: hasRanking ? "已有标的，结论待补" : "已有标的，利好排序待补",
      detail: `${sourceText}已抽出关联股票，但还没有形成清晰排序或一句话结论。`,
      next: "用同一假设再 Ask 一次，要求只输出直接受益、利好排序、最大缺口和下一步验证。",
      tone: "review",
    }
  }
  return {
    show: false,
    kind: "ready",
    headline: "",
    detail: "",
    next: "",
    tone: "ready",
  }
}

export function buildAskSummaryTileValues(summary: AskDeepDiveSummary): AskSummaryTileValues {
  const hasStocks = Boolean(usableAskSummaryText(summary.stocks, 120))
  return {
    stocks: summary.stocks || "未抽出关联股票；先展开完整回答，必要时重试并缩小到单一细分/股票。",
    directBeneficiary: summary.directBeneficiary || (hasStocks ? "按关联股票继续判断直接受益。" : "先拿到关联股票，再判断最直接受益。"),
    ranking: summary.ranking || (hasStocks ? "已有标的但未排序；下一步要求 Ask 输出利好排序。" : "先拿到关联股票，再做利好排序。"),
    stage: summary.stage || "阶段未显式抽出；先按新催化/验证中处理。",
    gap: summary.gap || "缺口未显式抽出；至少复核来源、公告、订单、量价和二次确认。",
    conclusion: summary.conclusion || "结论未显式抽出；不要直接确认状态，先看完整回答和来源。",
  }
}

function askSourceSnapshotItem(input: unknown): AskSourceSnapshotItem {
  const record = unknownRecord(input)
  const sourceRef = compactDisplayText(
    record.sourceRef ?? record.path ?? record.filePath ?? record.file ?? record.url ?? record.href,
    "",
    180,
  )
  const preview = sourcePreview(
    record.excerpt ?? record.snippet ?? record.summary ?? record.text ?? record.content ?? record.body ?? record.title ?? record.name,
    sourceRef,
  )
  const label = compactDisplayText(
    record.title ?? record.name ?? record.heading ?? record.symbol ?? preview.meta ?? preview.refLabel ?? sourceRef,
    "未命名来源",
    90,
  )
  const detail = compactDisplayText(preview.body || record.snippet || record.summary || preview.meta, "该来源没有可读摘要，先打开来源复核。", 160)
  const auditishSource = /(^|\/)(wechat-inbox|hypothesis-events|hypothesis-alerts|agent-runs)\//.test(sourceRef)
    || sourceRef.includes(".llm-wiki/")
    || sourceRef.includes(".jsonl")
  const auditLine = auditishSource ? sourceAuditDisplayLabel(preview, record.sourceKindLabel) : ""
  const sourceLine = compactDisplayText(
    auditLine || preview.meta || preview.refLabel || sourceRef,
    "来源未标注",
    120,
  )
  return { label, detail, sourceLine }
}

export function countAskResultSources(run: unknown): number {
  const record = unknownRecord(run)
  const sources = unknownRecord(record.sources)
  const groupCount = (sourceItems: unknown, fallbackItems: unknown) => Math.max(
    arrayRecords(sourceItems).length,
    arrayRecords(fallbackItems).length,
  )
  return groupCount(sources.navigation, record.navigation)
    + groupCount(sources.wiki, record.wikiResults)
    + groupCount(sources.raw, record.rawResults)
    + groupCount(sources.facts, record.factsResults)
    + groupCount(sources.brain, record.brainResults)
    + groupCount(sources.stockDaily, record.stockDailyResults)
}

export function buildAskSourceSnapshot({
  wiki,
  raw,
  facts,
  brain,
  navigation,
  stockDaily,
  query,
  hasAnswer,
}: {
  wiki?: unknown
  raw?: unknown
  facts?: unknown
  brain?: unknown
  navigation?: unknown
  stockDaily?: unknown
  query?: unknown
  hasAnswer?: unknown
} = {}): AskSourceSnapshot {
  const wikiItems = arrayRecords(wiki)
  const rawItems = arrayRecords(raw)
  const factsItems = arrayRecords(facts)
  const brainItems = arrayRecords(brain)
  const navigationItems = arrayRecords(navigation)
  const stockItems = arrayRecords(stockDaily)
  const total = wikiItems.length + rawItems.length + factsItems.length + brainItems.length + navigationItems.length + stockItems.length
  const answered = Boolean(hasAnswer)
  const groups: AskSourceSnapshotGroup[] = [
    {
      id: "wiki",
      label: "wiki 框架",
      count: wikiItems.length,
      items: wikiItems.slice(0, 3).map(askSourceSnapshotItem),
      emptyText: "没有命中 wiki 页面；这会削弱链条解释和历史上下文。",
    },
    {
      id: "raw",
      label: "raw / 新增资料",
      count: rawItems.length,
      items: rawItems.slice(0, 3).map(askSourceSnapshotItem),
      emptyText: "没有命中新增资料；这更像旧框架复述，不像新催化。",
    },
    {
      id: "facts",
      label: "事实 / facts",
      count: factsItems.length,
      items: factsItems.slice(0, 3).map(askSourceSnapshotItem),
      emptyText: "没有命中结构化事实；财报、公告或时序事实仍需补。",
    },
    {
      id: "brain",
      label: "记忆 / brain",
      count: brainItems.length,
      items: brainItems.slice(0, 3).map(askSourceSnapshotItem),
      emptyText: "没有命中历史判断记忆；需要人工回看旧假设或复盘。",
    },
    {
      id: "navigation",
      label: "导航 / 相关页",
      count: navigationItems.length,
      items: navigationItems.slice(0, 3).map(askSourceSnapshotItem),
      emptyText: "没有额外导航页；先以直接命中的 wiki/raw 来源为主。",
    },
    {
      id: "stockDaily",
      label: "行情 / 量价",
      count: stockItems.length,
      items: stockItems.slice(0, 3).map(askSourceSnapshotItem),
      emptyText: "没有行情结果；不能判断市场是否已经扩散或 priced-in。",
    },
  ]
  return {
    show: total > 0,
    headline: answered ? "本次 Ask 的来源快照" : "先看来源快照：本轮没有生成完整回答",
    detail: answered
      ? `已汇总 ${total} 个来源，可用来复核摘要里的股票、排序和缺口。`
      : `已拿到 ${total} 个来源，但没有生成六段回答；这不是完成态结论，只能作为下一轮收窄问题的证据底稿。`,
    nextAction: answered
      ? "先用来源复核关联股票和利好排序；不确定时再收窄到单一细分或股票。"
      : "先看哪些来源命中，再重试 Ask 深挖；如果仍为空，把问题收窄到单一股票、单一细分或单一证据缺口。",
    queryLine: compactDisplayText(query, "查询未记录", 220),
    groups,
  }
}

export function buildAskPendingSkeletonTiles({ isPrecheck }: { isPrecheck?: unknown } = {}): AskPendingSkeletonTile[] {
  const answerLabel = isPrecheck ? "预检回答" : "六段回答"
  return [
    {
      id: "stocks",
      label: "关联股票",
      placeholder: "正在抽取股票池",
      detail: "从 wiki、raw、行情和信号来源里找 A 股相关标的。",
    },
    {
      id: "beneficiary",
      label: "最直接受益",
      placeholder: "等待受益链条",
      detail: "区分直接订单/价格弹性和弱外溢叙事。",
    },
    {
      id: "ranking",
      label: "利好排序",
      placeholder: "等待排序",
      detail: "按受益强度、验证难度和市场是否已反应排序。",
    },
    {
      id: "answer",
      label: answerLabel,
      placeholder: `等待${answerLabel}`,
      detail: isPrecheck ? "预检会判断候选是否值得加入跟踪。" : "完整回答会保留结论、证据链、反证、后续验证、交易含义和来源。",
    },
  ]
}

export function buildAskResultMiniIndex({
  pending,
  isPrecheck,
  summary,
  sourceCount,
  hasAnswer,
}: {
  pending?: unknown
  isPrecheck?: unknown
  summary?: Partial<AskDeepDiveSummary> | null
  sourceCount?: unknown
  hasAnswer?: unknown
} = {}): AskResultMiniIndexItem[] {
  const answerLabel = isPrecheck ? "预检全文" : "六段全文"
  const sources = Math.max(0, numberValue(sourceCount))
  const answerReady = Boolean(hasAnswer)
  const stocks = usableAskSummaryText(summary?.stocks, 36)
  const ranking = usableAskSummaryText(summary?.ranking, 42)
  const conclusion = usableAskSummaryText(summary?.conclusion, 44)
    || compactDisplayText(summary?.stage || summary?.gap, "", 44)
  if (pending) {
    return [
      { id: "summary", label: "摘要", detail: "生成中", available: false, tone: "pending" },
      { id: "stocks", label: "关联股票", detail: "抽取中", available: false, tone: "pending" },
      { id: "ranking", label: "利好排序", detail: "排序中", available: false, tone: "pending" },
      { id: "answer", label: answerLabel, detail: "等待回答", available: false, tone: "pending" },
      { id: "sources", label: "来源", detail: "检索中", available: false, tone: "pending" },
    ]
  }
  return [
    {
      id: "summary",
      label: "摘要",
      detail: answerReady ? (conclusion || "看阶段和缺口") : "待生成",
      available: answerReady,
      tone: answerReady ? "ready" : "warning",
    },
    {
      id: "stocks",
      label: "关联股票",
      detail: stocks || "待补股票池",
      available: Boolean(stocks),
      tone: stocks ? "ready" : "warning",
    },
    {
      id: "ranking",
      label: "利好排序",
      detail: ranking || "待补排序",
      available: Boolean(ranking),
      tone: ranking ? "ready" : "warning",
    },
    {
      id: "answer",
      label: answerLabel,
      detail: answerReady ? "已生成" : "未生成",
      available: answerReady,
      tone: answerReady ? "ready" : "warning",
    },
    {
      id: "sources",
      label: "来源",
      detail: sources > 0 ? `${sources} 个来源` : "暂无来源",
      available: sources > 0,
      tone: sources > 0 ? "ready" : "warning",
    },
  ]
}

export function buildAskResultReadingGuide({
  pending,
  isPrecheck,
  summary,
  sourceCount,
  hasAnswer,
}: {
  pending?: unknown
  isPrecheck?: unknown
  summary?: Partial<AskDeepDiveSummary> | null
  sourceCount?: unknown
  hasAnswer?: unknown
} = {}): AskResultReadingGuide {
  const subject = isPrecheck ? "Ask 预检" : "Ask 深挖"
  const sources = Math.max(0, numberValue(sourceCount))
  const readiness = askSummaryReadiness(summary)
  if (pending) {
    return {
      headline: `${subject}正在生成`,
      detail: "先看运行进度和等待槽位；完成后这里会切换成摘要、全文和来源阅读顺序。",
      primaryTarget: null,
      primaryLabel: "等待结果",
      guardrail: "运行中不会写 wiki/raw，也不会自动确认假设状态。",
      tone: "running",
      steps: [
        { target: "summary", label: "等结构化摘要", detail: "关联股票、受益链条和排序还在生成。", tone: "pending" },
        { target: "answer", label: "等完整回答", detail: "六段回答生成后会自动展示在结果区下方。", tone: "pending" },
        { target: "sources", label: "等来源汇总", detail: "wiki、raw 和行情来源会一起落到来源区。", tone: "pending" },
      ],
    }
  }
  if (!hasAnswer) {
    return {
      headline: "本轮只有来源，没有可读回答",
      detail: `系统拿到 ${sources} 个来源，但没有生成六段回答；这不是完成态，不能按空摘要做决策。`,
      primaryTarget: sources > 0 ? "sources" : null,
      primaryLabel: sources > 0 ? "先看来源" : "重新 Ask",
      guardrail: "先不要确认状态；建议重试或把问题收窄到单一股票、细分或证据缺口。",
      tone: "source_only",
      steps: [
        { target: "sources", label: "先看来源", detail: sources > 0 ? `${sources} 个来源可复核。` : "本轮来源也不足，需要重试。", tone: sources > 0 ? "warning" : "pending" },
        { target: "answer", label: "再重试全文", detail: "如果来源相关，重试 Ask 或收窄问题后再要六段回答。", tone: "warning" },
        { target: "summary", label: "最后看摘要", detail: "等回答生成后再看关联股票和排序。", tone: "pending" },
      ],
    }
  }
  if (!readiness.usable) {
    return {
      headline: `回答已返回，但${readiness.label}`,
      detail: `已有 ${sources} 个来源和完整回答；结构化摘要还不够交易化，先展开全文查股票和排序线索。`,
      primaryTarget: "answer",
      primaryLabel: "先看完整回答",
      guardrail: "不要按缺字段摘要直接确认状态；必要时复制追问，把问题收窄后再 Ask。",
      tone: "warning",
      steps: [
        { target: "answer", label: "先看完整回答", detail: `检查全文里是否藏有股票、排序或${readiness.label}的线索。`, tone: "primary" },
        { target: "sources", label: "再核来源", detail: sources > 0 ? `复核 ${sources} 个来源是否真的支持结论。` : "来源不足，结论可信度低。", tone: "normal" },
        { target: "summary", label: "最后补摘要", detail: "把股票、排序和一句话结论补齐后再沉淀观察。", tone: "warning" },
      ],
    }
  }
  return {
    headline: "这次 Ask 可以按摘要先读",
    detail: `已返回 ${sources} 个来源和可用摘要；适合先看关联股票、受益链条、利好排序，再核全文和来源。`,
    primaryTarget: "summary",
    primaryLabel: "先看摘要",
    guardrail: "Ask 只是研究结论，不会自动确认假设状态；确认仍需人工点击。",
    tone: "ready",
    steps: [
      { target: "summary", label: "先看摘要", detail: "关联股票、最直接受益、利好排序和最大缺口。", tone: "primary" },
      { target: "answer", label: "再读全文", detail: "核对六段回答里的证据链、反证和交易含义。", tone: "normal" },
      { target: "sources", label: "最后核来源", detail: sources > 0 ? `检查 ${sources} 个来源是否能支撑结论。` : "本轮来源较少，需要谨慎。", tone: sources > 0 ? "normal" : "warning" },
    ],
  }
}

export function buildAskObservationChecklist(summary: AskDeepDiveSummary): AskObservationChecklist {
  const usableStocks = usableAskSummaryText(summary.stocks, 240)
  const stocks = stringList(usableStocks).slice(0, 8)
  if (stocks.length === 0) {
    return {
      show: false,
      headline: "还不能生成观察清单",
      detail: "Ask 没有抽出关联股票，暂时只能当作主题线索。",
      items: [],
      nextAction: "先缩小到单一细分或股票再 Ask，再生成观察清单。",
      copyText: "",
    }
  }
  const stockLine = stocks.join("、")
  const ranking = usableAskSummaryText(summary.ranking, 220)
    || usableAskSummaryText(summary.directBeneficiary, 220)
    || "尚未形成利好排序，先按关联度和量价反馈排序。"
  const validation = "1-5 个交易日量价扩散；公告/订单/客户/交付；二次来源确认；判断是否已充分定价。"
  const gap = summary.gap || "缺口未显式抽出；至少复核来源、公告、订单、量价和二次确认。"
  const stage = summary.stage || "阶段未显式抽出；先按新催化/验证中处理。"
  const conclusion = summary.conclusion || "先观察，不直接确认假设升级。"
  const items: AskObservationChecklistItem[] = [
    { label: "观察标的", value: stockLine, tone: "stock" },
    { label: "排序依据", value: ranking, tone: "rank" },
    { label: "验证动作", value: validation, tone: "action" },
    { label: "最大缺口", value: gap, tone: "gap" },
    { label: "状态口径", value: `${stage}；${conclusion}`, tone: "status" },
  ]
  const copyText = [
    "## 观察清单草稿",
    `- 观察标的：${stockLine}`,
    `- 排序依据：${ranking}`,
    `- 验证动作：${validation}`,
    `- 最大缺口：${gap}`,
    `- 状态口径：${stage}；${conclusion}`,
    `- 下一步：${summary.nextAction || "先按观察清单跟踪。"}`
  ].join("\n")
  return {
    show: true,
    headline: `观察清单草稿：${stocks.slice(0, 3).join(" / ")}`,
    detail: stocks.length > 3 ? `已抽出 ${stocks.length} 个候选标的，先处理前三个直接受益方向。` : "已抽出候选标的，可进入量价和证据跟踪。",
    items,
    nextAction: summary.nextAction || "先按观察清单跟踪量价、公告和二次来源。",
    copyText,
  }
}

export function buildAskObservationActionCopy({
  checklist,
  queued,
  saving,
  savedPath,
}: {
  checklist: AskObservationChecklist
  queued?: unknown
  saving?: unknown
  savedPath?: unknown
}): AskObservationActionCopy {
  const path = compactDisplayText(savedPath, "", 180)
  if (!checklist.show) {
    return {
      show: true,
      tone: "blocked",
      headline: "还不能形成观察动作",
      detail: "Ask 没有抽出关联股票，先不要排观察清单。建议把问题缩小到单一细分、单一股票或补充来源后重试 Ask。",
      primaryLabel: "先收窄 Ask",
      secondaryLabel: "暂无草稿",
      statusLabel: "缺少关联股票",
      primaryAction: "none",
      canPrimary: false,
      canCopy: false,
      savedPath: "",
    }
  }
  if (path) {
    return {
      show: true,
      tone: "saved",
      headline: "观察草稿已保存",
      detail: `已写入 ${path}。它只是观察草稿，不会自动确认假设状态，也不会写 wiki/raw。`,
      primaryLabel: "已保存草稿",
      secondaryLabel: "复制草稿",
      statusLabel: "已沉淀",
      primaryAction: "none",
      canPrimary: false,
      canCopy: Boolean(checklist.copyText),
      savedPath: path,
    }
  }
  if (queued) {
    const isSaving = Boolean(saving)
    return {
      show: true,
      tone: "queued",
      headline: "已进入今日观察，下一步保存草稿",
      detail: "观察队列现在只在页面内临时排队；点保存后才写 .llm-wiki/observation-drafts，仍不写 wiki/raw、不改假设状态。",
      primaryLabel: isSaving ? "保存中" : "保存观察草稿",
      secondaryLabel: "复制草稿",
      statusLabel: "待保存",
      primaryAction: "save",
      canPrimary: !isSaving,
      canCopy: Boolean(checklist.copyText),
      savedPath: "",
    }
  }
  return {
    show: true,
    tone: "ready",
    headline: "下一步：把 Ask 结果变成观察动作",
    detail: "先加入观察队列，在页面内临时排队；确认有用后再保存草稿。保存也只写 .llm-wiki，不会写正式 wiki/raw。",
    primaryLabel: "加入观察队列",
    secondaryLabel: "复制草稿",
    statusLabel: "可跟踪",
    primaryAction: "queue",
    canPrimary: true,
    canCopy: Boolean(checklist.copyText),
    savedPath: "",
  }
}

export function buildAskResultActionGuide({
  observation,
  followUp,
  structure,
}: {
  observation: AskObservationActionCopy
  followUp?: AskFollowUpAction
  structure?: AskStructureFeedback
}): AskResultActionGuide {
  if (observation.tone === "saved") {
    return {
      show: true,
      tone: "saved",
      headline: "观察草稿已沉淀",
      detail: observation.detail || "已经进入观察草稿，后续用新增舆情和量价反馈回看。",
      primaryLabel: "查看草稿入口",
      primaryTarget: "observation",
      secondary: "不自动确认假设状态；仍需你在待处理卡片里人工确认。",
    }
  }
  if (observation.tone === "queued") {
    return {
      show: true,
      tone: "queued",
      headline: observation.primaryAction === "save" ? "下一步：保存观察草稿" : "观察清单已排队",
      detail: "已经有可跟踪标的和验证动作；保存后只写 .llm-wiki/observation-drafts，方便后续回看。",
      primaryLabel: observation.primaryLabel || "保存观察草稿",
      primaryTarget: "observation",
      secondary: "保存草稿不是交易建议，也不会写正式 wiki/raw。",
    }
  }
  if (observation.tone === "ready") {
    return {
      show: true,
      tone: "ready",
      headline: "下一步：加入观察队列",
      detail: "Ask 已抽出候选股票和验证动作；先转成日内观察，不自动确认假设状态。",
      primaryLabel: observation.primaryLabel || "加入观察队列",
      primaryTarget: "observation",
      secondary: "后续用新增舆情、量价和公告反馈验证排序。",
    }
  }
  if (followUp?.show) {
    return {
      show: true,
      tone: followUp.tone === "weak" ? "blocked" : "verify",
      headline: followUp.headline,
      detail: `${followUp.detail}；暂时不能加入观察，先把下一问收窄。`,
      primaryLabel: followUp.primaryLabel,
      primaryTarget: "followup",
      secondary: "复制后可以重新 Ask，或手工补资料再扫。",
    }
  }
  if (structure?.show) {
    if (structure.kind === "source_only") {
      return {
        show: true,
        tone: "blocked",
        headline: structure.headline,
        detail: structure.detail,
        primaryLabel: "看来源",
        primaryTarget: "sources",
        secondary: structure.next,
      }
    }
    return {
      show: true,
      tone: structure.tone === "warning" ? "blocked" : "verify",
      headline: structure.headline,
      detail: structure.detail,
      primaryLabel: structure.tone === "warning" ? "看完整回答" : "看摘要缺口",
      primaryTarget: structure.tone === "warning" ? "answer" : "answer",
      secondary: structure.next,
    }
  }
  return {
    show: true,
    tone: "verify",
    headline: "先看摘要和来源",
    detail: "本轮 Ask 已返回，先看关联股票、利好排序、最大缺口和完整来源，再决定是否确认状态。",
    primaryLabel: "看六段回答",
    primaryTarget: "answer",
    secondary: "不要只凭一句话结论确认状态。",
  }
}

export function buildObservationQueueDraft({
  checklist,
  hypothesisId,
  hypothesisTitle,
  wikiFrameHint,
  sourceRefs,
  askQuery,
  createdAt,
}: {
  checklist: AskObservationChecklist
  hypothesisId?: unknown
  hypothesisTitle?: unknown
  wikiFrameHint?: AskWikiFrameHint
  sourceRefs?: unknown
  askQuery?: unknown
  createdAt?: unknown
}): ObservationQueueDraft {
  const title = compactDisplayText(hypothesisTitle, "未命名观察", 120)
  const stocks = checklist.items.find((item) => item.label === "观察标的")?.value ?? ""
  const ranking = checklist.items.find((item) => item.label === "排序依据")?.value ?? ""
  const gap = checklist.items.find((item) => item.label === "最大缺口")?.value ?? ""
  const id = compactDisplayText(hypothesisId, "", 120)
  const fallbackKey = `${title}:${stocks}`.replace(/\s+/g, "").slice(0, 160) || "observation"
  const wikiFrame = wikiFrameHint?.sources?.[0]
  const refs = [...new Set([
    ...stringList(sourceRefs),
    wikiFrame?.sourceRef,
  ].filter((item): item is string => Boolean(item)))]
  return {
    key: id || fallbackKey,
    hypothesisId: id,
    title,
    stocks,
    ranking,
    gap,
    wikiFrameLabel: wikiFrame?.label ?? "",
    wikiFrameSourceRef: wikiFrame?.sourceRef ?? "",
    wikiFrameMetaLine: wikiFrame?.metaLine ?? "",
    sourceRefs: refs,
    askQuery: compactDisplayText(askQuery, "", 4000),
    status: "待跟踪",
    nextAction: checklist.nextAction,
    copyText: checklist.copyText,
    createdAt: compactDisplayText(createdAt, "", 40) || new Date(0).toISOString(),
  }
}

export function upsertObservationQueue(queue: unknown, draft: ObservationQueueDraft, limit = 8): ObservationQueueDraft[] {
  const existing = Array.isArray(queue) ? queue : []
  return [
    draft,
    ...existing.filter((item): item is ObservationQueueDraft => {
      const record = unknownRecord(item)
      return Boolean(record.key && record.key !== draft.key)
    }),
  ].slice(0, Math.max(1, limit))
}

function observationDraftSavedPath(savedRun: unknown) {
  const run = unknownRecord(savedRun)
  const writeResult = unknownRecord(run.writeResult)
  return compactDisplayText(firstFilled(writeResult.markdownRelativePath, writeResult.jsonRelativePath, writeResult.relativePath), "", 180)
}

function observationReviewWindowFromText(value: unknown) {
  const text = String(value ?? "").replace(/\s+/g, " ")
  const explicit = text.match(/(\d+\s*[-~至到]\s*\d+\s*个?交易日)/)
  if (explicit) return explicit[1].replace(/\s+/g, " ")
  if (/量价|扩散|市场|交易日/.test(text)) return "1-5 个交易日"
  if (/公告|订单|交付|客户|财报|收入|毛利/.test(text)) return "1-2 周"
  return "下一次新增信号"
}

function observationReviewWindow(item: ObservationQueueDraft) {
  return observationReviewWindowFromText(`${item.nextAction} ${item.copyText}`)
}

function observationSourceLine(item: ObservationQueueDraft) {
  const wiki = compactDisplayText(item.wikiFrameLabel, "", 80)
  const source = item.sourceRefs.map(sourceRefLabel).filter(Boolean)[0]
  if (wiki && source) return `wiki：${wiki} · ${source}`
  if (wiki) return `wiki：${wiki}`
  if (source) return source
  return "Ask 深挖结果"
}

function observationValidationAction(item: ObservationQueueDraft) {
  const match = item.copyText.match(/验证动作[:：]\s*([^\n]+)/)
  const explicit = compactDisplayText(match?.[1], "", 180)
  if (explicit) return explicit
  return compactDisplayText(item.nextAction, "先按观察清单跟踪量价、公告和二次来源。", 180)
}

export function buildObservationQueueTableRows({
  items,
  savingKey,
  savedRuns,
  limit = 5,
}: {
  items: ObservationQueueDraft[]
  savingKey?: unknown
  savedRuns?: unknown
  limit?: unknown
}): ObservationQueueTableRow[] {
  const saveKey = compactDisplayText(savingKey, "", 160)
  const savedRunByKey = unknownRecord(savedRuns)
  const maxRows = Math.max(1, Math.min(12, numberValue(limit) || 5))
  return (Array.isArray(items) ? items : [])
    .filter((item) => Boolean(item?.key))
    .slice(0, maxRows)
    .map((item) => {
      const savedPath = observationDraftSavedPath(savedRunByKey[item.key])
      const saving = !savedPath && saveKey === item.key
      const stockList = stringList(item.stocks)
      const stockLine = compactDisplayText(item.stocks, "未提股票", 180)
      const rankingLine = compactDisplayText(item.ranking, "未形成排序，先按关联度和量价反馈排序。", 180)
      const riskLine = compactDisplayText(item.gap, "缺口未写入；至少复核来源、公告、订单、量价和二次确认。", 180)
      const nextAction = compactDisplayText(item.nextAction, "先按观察清单跟踪量价、公告和二次来源。", 180)
      const validationAction = observationValidationAction(item)
      return {
        key: item.key,
        title: compactDisplayText(item.title, "未命名观察", 120),
        stockLine,
        focusStock: stockList[0] || stockLine,
        rankingLine,
        riskLine,
        validationAction,
        nextAction,
        reviewWindow: observationReviewWindow(item),
        sourceLine: observationSourceLine(item),
        createdAt: compactDisplayText(item.createdAt, "", 40),
        statusLabel: savedPath ? "已保存" : saving ? "保存中" : "待保存",
        tone: savedPath ? "saved" : saving ? "saving" : "queued",
        savedPath,
        canSave: !savedPath && !saving,
      }
    })
}

function observationDraftOpenPath(draft: Record<string, unknown>) {
  return compactDisplayText(firstFilled(draft.markdownRelativePath, draft.jsonRelativePath, draft.relativePath), "", 180)
}

function observationDraftStockLine(draft: Record<string, unknown>) {
  const stocks = stringList(draft.stocks).slice(0, 6)
  return stocks.length ? stocks.join("、") : "未提股票"
}

function observationDraftNextAction(draft: Record<string, unknown>) {
  return compactDisplayText(
    firstFilled(draft.nextAction, draft.ranking, draft.gap, draft.copyText),
    "等待新增舆情、量价反馈或二次来源。",
    180,
  )
}

export function buildObservationReviewBrief(drafts: unknown, limit = 3): ObservationReviewBrief {
  const maxItems = Math.max(1, Math.min(6, numberValue(limit) || 3))
  const items = arrayRecords(drafts)
    .map((draft, index) => {
      const title = compactDisplayText(draft.title, `观察草稿 ${index + 1}`, 120)
      const openPath = observationDraftOpenPath(draft)
      return {
        key: compactDisplayText(firstFilled(draft.id, openPath, title), `${title}:${index}`, 180),
        title,
        stockLine: observationDraftStockLine(draft),
        reviewWindow: observationReviewWindowFromText(`${draft.nextAction ?? ""} ${draft.copyText ?? ""} ${draft.gap ?? ""}`),
        nextAction: observationDraftNextAction(draft),
        openPath,
      }
    })
    .filter((item) => item.title)
  const visibleItems = items.slice(0, maxItems)
  if (!visibleItems.length) {
    return {
      show: false,
      count: 0,
      totalCount: 0,
      label: "",
      headline: "",
      detail: "",
      primaryTitle: "",
      primaryStocks: "",
      primaryPath: "",
      reviewWindow: "",
      tone: "review",
      items: [],
    }
  }
  const primary = visibleItems[0]
  const count = items.length
  const stockLine = primary.stockLine && primary.stockLine !== "未提股票" ? `，先看 ${primary.stockLine}` : ""
  return {
    show: true,
    count,
    totalCount: count,
    label: `观察 ${count}`,
    headline: `有 ${count} 条观察待复核`,
    detail: `优先复核「${primary.title}」${stockLine}；窗口：${primary.reviewWindow}。`,
    primaryTitle: primary.title,
    primaryStocks: primary.stockLine,
    primaryPath: primary.openPath,
    reviewWindow: primary.reviewWindow,
    tone: count >= 3 ? "action" : "review",
    items: visibleItems,
  }
}

export function buildAskDecisionSnapshot(summary: AskDeepDiveSummary): AskDecisionSnapshot {
  const hasStocks = Boolean(usableAskSummaryText(summary.stocks, 120))
  const hasRanking = Boolean(usableAskSummaryText(summary.ranking, 120))
  const gap = compactDisplayText(summary.gap, "", 160)
  const stage = compactDisplayText(summary.stage, "", 80)
  const focus = usableAskSummaryText(summary.ranking, 160)
    || usableAskSummaryText(summary.directBeneficiary, 160)
    || usableAskSummaryText(summary.stocks, 160)
    || stage
    || "等待 Ask 摘要"
  if (!hasStocks) {
    return {
      tone: "blocked",
      headline: "先补证据，再谈排序",
      primaryAction: "补来源",
      focus,
      risk: gap || "Ask 没有抽出关联股票，暂时不能进入标的排序。",
      evidenceState: stage || "证据不足",
    }
  }
  if (gap) {
    return {
      tone: "verify",
      headline: "有标的线索，先验证缺口",
      primaryAction: hasRanking ? "按排序验证" : "按股票验证",
      focus,
      risk: gap,
      evidenceState: stage || "待验证",
    }
  }
  return {
    tone: "actionable",
    headline: "先看直接受益和利好排序",
    primaryAction: hasRanking ? "建立观察清单" : "补利好排序",
    focus,
    risk: "Ask 未显式列出最大缺口，仍需回看来源和量价反馈。",
    evidenceState: stage || "可进入观察",
  }
}

export function buildAskEvidenceStrength({
  summary,
  hasAnswer,
  wikiSourceCount,
  rawSourceCount,
  stockDailySourceCount,
}: {
  summary: AskDeepDiveSummary
  hasAnswer?: boolean
  wikiSourceCount?: unknown
  rawSourceCount?: unknown
  stockDailySourceCount?: unknown
}): AskEvidenceStrength {
  const wiki = Math.max(0, numberValue(wikiSourceCount))
  const raw = Math.max(0, numberValue(rawSourceCount))
  const stockDaily = Math.max(0, numberValue(stockDailySourceCount))
  const hasStocks = Boolean(usableAskSummaryText(summary.stocks, 120))
  const hasRanking = Boolean(usableAskSummaryText(summary.ranking, 120))
  const hasGap = Boolean(compactDisplayText(summary.gap, "", 120))
  const sourceState = `来源覆盖：wiki ${wiki}、raw ${raw}、量价 ${stockDaily}`
  const badges: AskEvidenceStrength["badges"] = [
    { label: `wiki ${wiki}`, tone: "source" },
    { label: `raw ${raw}`, tone: "source" },
    { label: `量价 ${stockDaily}`, tone: stockDaily > 0 ? "stock" : "gap" },
  ]
  if (hasStocks && hasRanking) badges.push({ label: "有股票排序", tone: "ready" })
  else if (hasStocks) badges.push({ label: "有股票未排序", tone: "stock" })
  else badges.push({ label: "未抽出股票", tone: "gap" })

  if (!hasAnswer) {
    return {
      tone: "weak",
      headline: "只有来源，不能形成标的排序",
      detail: `${sourceState}；本轮没有六段回答，先不要用它做交易判断。`,
      rankingState: "没有可读回答，股票排序不可用。",
      sourceState,
      nextAction: "重试 Ask 深挖；如果仍为空，把问题缩小到单一股票、细分或证据缺口。",
      badges,
    }
  }

  if (!hasStocks) {
    return {
      tone: "weak",
      headline: "更像主题线索，暂不进入股票观察",
      detail: `${sourceState}；回答没有抽出关联股票，先把问题收窄到具体产业环节。`,
      rankingState: "未抽出关联股票，不能排序。",
      sourceState,
      nextAction: "缩小到单一细分或股票再 Ask；必要时先补 wiki 框架页。",
      badges,
    }
  }

  if (!hasRanking || stockDaily <= 0) {
    return {
      tone: "verify",
      headline: hasRanking ? "有股票排序，先补量价验证" : "有股票线索，利好排序待补",
      detail: `${sourceState}；${hasRanking ? "排序可做初筛，但还缺量价交叉验证。" : "已有股票但排序不清，暂不确认优先级。"}`,
      rankingState: hasRanking ? "已有股票和利好排序，但未完成量价验证。" : "已有股票线索，但利好排序不足。",
      sourceState,
      nextAction: stockDaily <= 0
        ? "补量价验证；再看公告、订单或二次来源是否同步确认。"
        : "让 Ask 只输出直接受益、利好排序和最大缺口。",
      badges,
    }
  }

  return {
    tone: "ready",
    headline: hasGap ? "可进入观察清单，但按缺口验证" : "可进入观察清单",
    detail: `${sourceState}；已有股票、排序和量价来源，适合先进入人工观察，不自动确认状态。`,
    rankingState: "已有股票和利好排序，可做人工初筛。",
    sourceState,
    nextAction: summary.nextAction || "按排序跟踪量价扩散、公告/订单和二次来源。",
    badges,
  }
}

export function buildAskResearchTicket({
  summary,
  evidence,
  checklist,
  sourceCount,
}: {
  summary: AskDeepDiveSummary
  evidence: AskEvidenceStrength
  checklist: AskObservationChecklist
  sourceCount?: unknown
}): AskResearchTicket {
  const sources = Math.max(0, numberValue(sourceCount))
  const stocks = usableAskSummaryText(summary.stocks, 140)
  const ranking = usableAskSummaryText(summary.ranking, 160)
  const direct = usableAskSummaryText(summary.directBeneficiary, 160)
  const gap = compactDisplayText(summary.gap, "", 160)
  const stage = compactDisplayText(summary.stage, "", 120)
  const conclusion = usableAskSummaryText(summary.conclusion, 180)
  const focus = ranking || direct || stocks || "未抽出关联股票；先看完整回答或收窄问题。"
  const risk = gap || evidence.rankingState || "缺口未显式抽出；仍需复核来源、量价和二次确认。"
  const badges: AskResearchTicket["badges"] = [
    { label: `来源 ${sources}`, tone: "source" },
    ...evidence.badges.slice(0, 4),
  ]
  if (checklist.show) badges.push({ label: "有观察清单", tone: "ready" })
  if (stage) badges.push({ label: stage, tone: evidence.tone === "weak" ? "gap" : "stock" })

  if (evidence.tone === "weak") {
    return {
      tone: "weak",
      label: "研究票据",
      headline: "Ask 还不能形成标的票据",
      focus,
      risk,
      nextAction: evidence.nextAction,
      primaryActionLabel: "重试/收窄 Ask",
      secondaryActionLabel: "展开完整回答",
      guardrail: "只有来源或主题线索时，不确认状态、不建观察清单。",
      badges,
    }
  }

  if (evidence.tone === "verify") {
    return {
      tone: "verify",
      label: "研究票据",
      headline: ranking ? "有股票排序，先补验证" : "有股票线索，先补排序",
      focus,
      risk,
      nextAction: evidence.nextAction || summary.nextAction,
      primaryActionLabel: evidence.nextAction.includes("量价") ? "补量价验证" : "补排序/缺口",
      secondaryActionLabel: checklist.show ? "加入观察" : "重试 Ask",
      guardrail: "这是研究票据，不自动确认状态；补完量价/公告/二次来源后再判断。",
      badges,
    }
  }

  return {
    tone: "ready",
    label: "研究票据",
    headline: "可进入今日观察",
    focus,
    risk,
    nextAction: summary.nextAction || evidence.nextAction,
    primaryActionLabel: checklist.show ? "加入今日观察" : "建立观察清单",
    secondaryActionLabel: "复制票据",
    guardrail: `${conclusion ? `${conclusion}；` : ""}只进入人工观察，不自动确认状态、不触发交易。`,
    badges,
  }
}

export function buildAskFollowUpAction({
  summary,
  evidence,
  title,
  isPrecheck,
  hasAnswer,
  canRetry = true,
}: {
  summary: AskDeepDiveSummary
  evidence: AskEvidenceStrength
  title?: unknown
  isPrecheck?: unknown
  hasAnswer?: unknown
  canRetry?: unknown
}): AskFollowUpAction {
  const askTitle = compactDisplayText(title, isPrecheck ? "候选假设" : "当前假设", 120)
  const stocks = usableAskSummaryText(summary.stocks, 160)
  const ranking = usableAskSummaryText(summary.ranking, 160)
  const gap = compactDisplayText(summary.gap, "", 160)
  const retryLabel = isPrecheck ? "重试预检" : "重试 Ask"
  const retryEnabled = Boolean(canRetry)
  const baseInstruction = [
    `围绕「${askTitle}」重新做一次买方 Ask 深挖。`,
    "请不要泛泛讲行业，直接输出以下六项：",
    "1. 关联股票/股票池",
    "2. 最直接受益",
    "3. 利好排序",
    "4. 当前阶段",
    "5. 最大缺口",
    "6. 一句话结论",
  ]

  if (!hasAnswer || !stocks) {
    return {
      show: true,
      tone: "weak",
      headline: "先收窄问题，再 Ask 一次",
      detail: "本轮没有抽出可用股票池，暂时不能做利好排序或状态确认。",
      prompt: [
        ...baseInstruction,
        "重点先找 A 股相关股票、产业链位置和是否只是舆情催化；没有股票就明确说没有。",
      ].join("\n"),
      primaryLabel: "复制收窄问题",
      retryLabel,
      retryEnabled,
    }
  }

  if (!ranking) {
    return {
      show: true,
      tone: "verify",
      headline: "已有股票，补利好排序",
      detail: "本轮已经有股票线索，但还没有形成直接受益和弹性排序。",
      prompt: [
        ...baseInstruction,
        `已知候选股票：${stocks}`,
        "请只按直接受益程度、收入弹性、验证难度和市场是否已反应做排序。",
      ].join("\n"),
      primaryLabel: "复制排序追问",
      retryLabel,
      retryEnabled,
    }
  }

  if (evidence.tone === "verify") {
    return {
      show: true,
      tone: "verify",
      headline: evidence.nextAction.includes("量价") ? "下一步补量价验证" : "下一步补证据缺口",
      detail: gap || evidence.rankingState || "已有股票和排序，但还需要补验证后再确认状态。",
      prompt: [
        `围绕「${askTitle}」继续验证，不要重新泛化主题。`,
        `候选股票：${stocks}`,
        `当前排序：${ranking}`,
        gap ? `最大缺口：${gap}` : "",
        "请补：最近 20 个交易日量价反馈、公告/订单/客户/交付线索、是否已 priced-in，以及是否支持假设状态升级。",
      ].filter(Boolean).join("\n"),
      primaryLabel: evidence.nextAction.includes("量价") ? "复制量价追问" : "复制补证追问",
      retryLabel,
      retryEnabled,
    }
  }

  return {
    show: false,
    tone: "verify",
    headline: "",
    detail: "",
    prompt: "",
    primaryLabel: "",
    retryLabel,
    retryEnabled: false,
  }
}

export function buildAskRunProgressSteps({
  pending,
  sourceCount,
  hasAnswer,
}: {
  pending?: unknown
  sourceCount?: unknown
  hasAnswer?: unknown
}): AskRunProgressStep[] {
  const sources = Math.max(0, numberValue(sourceCount))
  if (pending) {
    return [
      {
        id: "retrieval",
        label: "正在检索资料",
        detail: "检索 wiki、raw、行情和假设上下文。",
        status: "running",
      },
      {
        id: "summary",
        label: "等待结构化摘要",
        detail: "完成检索后抽取关联股票、受益链条和利好排序。",
        status: "pending",
      },
      {
        id: "result",
        label: "等待六段回答",
        detail: "完成后会自动定位到 Ask 结果区。",
        status: "pending",
      },
    ]
  }
  if (hasAnswer) {
    return [
      {
        id: "retrieval",
        label: "资料检索完成",
        detail: sources > 0 ? `已返回 ${sources} 个来源。` : "已完成上下文检索。",
        status: "done",
      },
      {
        id: "summary",
        label: "结构化摘要完成",
        detail: "已生成关联股票、直接受益、利好排序、阶段和缺口。",
        status: "done",
      },
      {
        id: "result",
        label: "六段回答已落地",
        detail: "先看摘要，再展开完整回答和来源。",
        status: "done",
      },
    ]
  }
  return [
    {
      id: "retrieval",
      label: sources > 0 ? "资料检索完成" : "资料检索不足",
      detail: sources > 0 ? `已返回 ${sources} 个来源。` : "没有拿到足够来源，建议缩小问题后重试。",
      status: sources > 0 ? "done" : "warning",
    },
    {
      id: "summary",
      label: "摘要未生成",
      detail: "没有形成关联股票、受益排序或完整六段回答。",
      status: "warning",
    },
    {
      id: "result",
      label: "先看来源或重试",
      detail: "不能直接按空摘要决策；先看来源，再重试或收窄到单一股票/细分。",
      status: "warning",
    },
  ]
}

function askSummaryReadiness(summary?: Partial<AskDeepDiveSummary> | null) {
  if (!summary) return { checked: false, usable: true, missingStocks: false, missingRanking: false, label: "" }
  const hasStocks = Boolean(usableAskSummaryText(summary.stocks, 120))
  const hasRanking = Boolean(usableAskSummaryText(summary.ranking, 120))
  const hasConclusion = Boolean(usableAskSummaryText(summary.conclusion, 120))
  if (!hasStocks) {
    return {
      checked: true,
      usable: false,
      missingStocks: true,
      missingRanking: true,
      label: "没有抽出关联股票",
    }
  }
  if (!hasRanking || !hasConclusion) {
    return {
      checked: true,
      usable: false,
      missingStocks: false,
      missingRanking: !hasRanking,
      label: hasRanking ? "一句话结论待补" : "利好排序待补",
    }
  }
  return { checked: true, usable: true, missingStocks: false, missingRanking: false, label: "" }
}

function askSummaryPendingSteps(steps: AskRunProgressStep[], label: string): AskRunProgressStep[] {
  return steps.map((step) => {
    if (step.id !== "summary") return step
    return {
      ...step,
      label: "结构化摘要待补",
      detail: `${label}；完整回答已返回，但不能直接按摘要做股票排序。`,
      status: "warning",
    }
  })
}

export function buildAskLiveTaskTicket({
  pending,
  hasAnswer,
  wikiSourceCount,
  rawSourceCount,
  stockDailySourceCount,
}: {
  pending?: unknown
  hasAnswer?: unknown
  wikiSourceCount?: unknown
  rawSourceCount?: unknown
  stockDailySourceCount?: unknown
} = {}): AskLiveTaskTicket {
  const wiki = Math.max(0, numberValue(wikiSourceCount))
  const raw = Math.max(0, numberValue(rawSourceCount))
  const stock = Math.max(0, numberValue(stockDailySourceCount))
  if (pending) {
    return {
      headline: "正在查 wiki、raw 和行情",
      detail: "这不是卡住：后端正在把假设回连到知识库、原文和量价材料，完成后再交给多智能体综合。",
      tone: "running",
      steps: [
        { id: "wiki", label: "wiki 框架", detail: "检索相关页面、表头和产业词。", status: "running" },
        { id: "raw", label: "新增资料原文", detail: "回看微信、研报新闻、产业链复盘和纪要原文片段。", status: "running" },
        { id: "stock", label: "行情/量价", detail: "尝试补股票池和近期市场反馈。", status: "running" },
        { id: "agent", label: "多智能体综合", detail: "等待来源汇总后生成摘要和六段回答。", status: "pending" },
      ],
    }
  }

  const sourceStep = (
    id: AskLiveTaskTicketStep["id"],
    label: string,
    count: number,
    fallback: string,
  ): AskLiveTaskTicketStep => ({
    id,
    label,
    detail: count > 0 ? `已返回 ${count} 条。` : fallback,
    status: count > 0 ? "done" : "warning",
  })

  if (hasAnswer) {
    return {
      headline: "Ask 检索链路完成",
      detail: "来源和多智能体回答已经落到下方；先看摘要和股票，再核来源。",
      tone: "done",
      steps: [
        sourceStep("wiki", "wiki 框架", wiki, "本轮没有 wiki 来源。"),
        sourceStep("raw", "新增资料原文", raw, "本轮没有新增资料来源。"),
        sourceStep("stock", "行情/量价", stock, "本轮没有 stock daily 来源。"),
        { id: "agent", label: "多智能体综合", detail: "已生成结构化摘要和完整回答。", status: "done" },
      ],
    }
  }

  return {
    headline: "来源已返回，但回答不完整",
    detail: "可以先看来源判断是否要收窄问题；不要把空摘要当作结论。",
    tone: "warning",
    steps: [
      sourceStep("wiki", "wiki 框架", wiki, "没有 wiki 来源。"),
      sourceStep("raw", "新增资料原文", raw, "没有新增资料来源。"),
      sourceStep("stock", "行情/量价", stock, "没有 stock daily 来源。"),
      { id: "agent", label: "多智能体综合", detail: "没有生成完整回答，建议重试或缩小到单一细分/股票。", status: "warning" },
    ],
  }
}

export function buildAskResultPanelCopy({
  pending,
  isPrecheck,
  title,
  sourceCount,
  hasAnswer,
  summary,
}: {
  pending?: unknown
  isPrecheck?: unknown
  title?: unknown
  sourceCount?: unknown
  hasAnswer?: unknown
  summary?: Partial<AskDeepDiveSummary> | null
}): AskResultPanelCopy {
  const displayTitle = compactDisplayText(title, isPrecheck ? "候选假设" : "当前假设", 72)
  const sources = Math.max(0, numberValue(sourceCount))
  const steps = buildAskRunProgressSteps({ pending, sourceCount: sources, hasAnswer })
  const readiness = askSummaryReadiness(summary)
  if (pending) {
    return {
      badge: "Ask 运行中",
      title: `正在深挖：${displayTitle}`,
      detail: "结果区会自动定位到这里；完成后先看结构化摘要，再展开完整六段回答和来源。",
      steps,
      tone: "running",
    }
  }
  if (!hasAnswer) {
    return {
      badge: "只返回来源",
      title: `${isPrecheck ? "Ask 预检" : "Ask 深挖"}没有生成完整回答`,
      detail: `已拿到 ${sources} 个来源，但没有生成六段回答；先不要按摘要决策，建议重试或缩小到单一股票/细分。`,
      steps,
      tone: "warning",
    }
  }
  if (hasAnswer && !readiness.usable) {
    return {
      badge: "摘要待补",
      title: `${isPrecheck ? "Ask 预检" : "Ask 深挖"}已返回，但${readiness.label}`,
      detail: `已拿到 ${sources} 个来源和完整回答，但结构化摘要不够可交易；先展开全文或复制追问，把问题收窄到单一股票/细分。`,
      steps: askSummaryPendingSteps(steps, readiness.label),
      tone: "warning",
    }
  }
  return {
    badge: isPrecheck ? "预检已完成" : "Ask 已完成",
    title: `${isPrecheck ? "候选预检" : "假设深挖"}：${displayTitle}`,
    detail: `已汇总 ${sources} 个来源；先看结构化摘要、关联股票和利好排序，再展开完整六段回答。`,
    steps,
    tone: "done",
  }
}

export function buildAskAnswerPanelCopy({
  pending,
  isPrecheck,
  sourceCount,
  hasAnswer,
}: {
  pending?: unknown
  isPrecheck?: unknown
  sourceCount?: unknown
  hasAnswer?: unknown
} = {}): AskAnswerPanelCopy {
  const sources = Math.max(0, numberValue(sourceCount))
  const mode = isPrecheck ? "Ask 预检" : "Ask 深挖"
  if (pending) {
    return {
      badge: "等待回答",
      title: `${mode}正在生成完整回答`,
      detail: "结果返回后这里会自动展开全文；先看上方进度和来源快照。",
      summaryLabel: isPrecheck ? "等待预检全文" : "等待完整六段回答",
      emptyText: "正在等待后端返回回答；完成后这里会显示全文。",
      openByDefault: true,
      tone: "running",
    }
  }
  const emptyText = sources > 0
    ? `本次没有生成六段回答；已返回 ${sources} 个来源。先看右侧来源，或重试 Ask 深挖并把问题缩小到单一股票/细分。`
    : "本次没有生成六段回答；请重试 Ask 深挖，或先用右侧来源判断是否需要缩小到单一股票/细分再问。"
  if (!hasAnswer) {
    return {
      badge: "只有来源",
      title: `${mode}没有生成完整回答`,
      detail: sources > 0
        ? `已返回 ${sources} 个来源，但没有六段回答；不要把空摘要当结论。`
        : "没有拿到完整回答；先重试或收窄问题。",
      summaryLabel: isPrecheck ? "预检全文未生成 / 先看来源" : "完整六段回答未生成 / 先看来源",
      emptyText,
      openByDefault: true,
      tone: "warning",
    }
  }
  return {
    badge: "答案在这里",
    title: isPrecheck ? "预检全文已展开" : "完整六段回答已展开",
    detail: `下面就是 ${mode}返回的全文；先看摘要卡片，再在这里核对关联股票、利好排序、反证和来源。`,
    summaryLabel: isPrecheck ? "完整预检回答 / 关联股票 / 入池判断" : "完整六段回答 / 关联股票 / 利好排序",
    emptyText,
    openByDefault: true,
    tone: "done",
  }
}

export function buildAskResultJumpCopy({
  pending,
  isPrecheck,
  title,
  sourceCount,
  hasAnswer,
  summary,
  errorMessage,
}: {
  pending?: unknown
  isPrecheck?: unknown
  title?: unknown
  sourceCount?: unknown
  hasAnswer?: unknown
  summary?: Partial<AskDeepDiveSummary> | null
  errorMessage?: unknown
}): AskResultJumpCopy {
  const displayTitle = compactDisplayText(title, isPrecheck ? "候选假设" : "当前假设", 48)
  const sources = Math.max(0, numberValue(sourceCount))
  const readiness = askSummaryReadiness(summary)
  const errorText = compactDisplayText(errorMessage, "", 120)
  if (pending) {
    return {
      label: `${isPrecheck ? "Ask 预检" : "Ask 深挖"}正在跑：${displayTitle}`,
      detail: "结果会出现在下方第 3 区；完成后先看结构化摘要，再展开完整六段回答。",
      buttonLabel: "查看运行状态",
      tone: "running",
    }
  }
  if (errorText) {
    return {
      label: `${isPrecheck ? "Ask 预检" : "Ask 深挖"}失败：${displayTitle}`,
      detail: `${errorText}；页面不会自动确认状态，也不会写 wiki/raw。点开错误卡看原因和下一步。`,
      buttonLabel: "查看失败原因",
      tone: "warning",
    }
  }
  if (!hasAnswer) {
    return {
      label: `${isPrecheck ? "Ask 预检" : "Ask 深挖"}只返回来源：${displayTitle}`,
      detail: `已返回 ${sources} 个来源但没有六段回答；可以先看来源，再重试或缩小问题。`,
      buttonLabel: "查看来源",
      tone: "warning",
    }
  }
  if (hasAnswer && !readiness.usable) {
    return {
      label: `${isPrecheck ? "Ask 预检" : "Ask 深挖"}摘要待补：${displayTitle}`,
      detail: `已返回 ${sources} 个来源和完整回答，但${readiness.label}；先看全文或收窄问题再问一次。`,
      buttonLabel: "查看并收窄",
      tone: "warning",
    }
  }
  return {
    label: `${isPrecheck ? "Ask 预检" : "Ask 深挖"}已返回：${displayTitle}`,
    detail: `已汇总 ${sources} 个来源；下一步看关联股票、直接受益、利好排序和证据缺口。`,
    buttonLabel: "查看结果",
    tone: "done",
  }
}

export function buildAskResultLocatorCopy({
  pending,
  isPrecheck,
  title,
  sourceCount,
  hasAnswer,
  reused,
  summary,
}: {
  pending?: unknown
  isPrecheck?: unknown
  title?: unknown
  sourceCount?: unknown
  hasAnswer?: unknown
  reused?: unknown
  summary?: Partial<AskDeepDiveSummary> | null
}): AskResultLocatorCopy {
  const displayTitle = compactDisplayText(title, isPrecheck ? "候选假设" : "当前假设", 56)
  const sources = Math.max(0, numberValue(sourceCount))
  const subject = isPrecheck ? "Ask 预检" : "Ask 深挖"
  const readiness = askSummaryReadiness(summary)
  if (pending) {
    return {
      label: "回答会显示在这里",
      detail: `你刚点的 ${subject} 正在处理「${displayTitle}」；结果会落在第 3 区，不会写 wiki/raw。`,
      nextAction: "先等进度条完成；完成后看结构化摘要、关联股票和完整六段回答。",
      tone: "running",
    }
  }
  if (!hasAnswer) {
    return {
      label: "这里没有六段回答，不是你没找到",
      detail: `本轮只拿到 ${sources} 个来源，后端没有生成完整回答；先不要按空摘要做判断。`,
      nextAction: "点重新检索，或把问题收窄到单一股票/细分后再 Ask。",
      tone: "warning",
    }
  }
  if (hasAnswer && !readiness.usable) {
    return {
      label: "回答在这里，但摘要待补",
      detail: `「${displayTitle}」已返回 ${sources} 个来源和完整回答，但${readiness.label}；先不要按摘要排序。`,
      nextAction: "展开完整回答看是否藏有股票；如果没有，把问题收窄到单一股票/细分后重试。",
      tone: "warning",
    }
  }
  if (reused) {
    return {
      label: "已打开上次 Ask 结果",
      detail: `这里显示的是「${displayTitle}」最近一次结构化摘要和六段回答，共 ${sources} 个来源。`,
      nextAction: "需要最新舆情或行情时，点右上角重新检索。",
      tone: "cached",
    }
  }
  return {
    label: "你点的 Ask 回答就在这里",
    detail: `「${displayTitle}」已完成，共 ${sources} 个来源；先看摘要卡片，再展开完整六段回答。`,
    nextAction: "下一步看关联股票、直接受益、利好排序和最大缺口。",
    tone: "done",
  }
}

export function buildAskResultLocatedNoticeCopy({
  located,
  pending,
  isPrecheck,
  sourceCount,
  hasAnswer,
  reused,
}: {
  located?: unknown
  pending?: unknown
  isPrecheck?: unknown
  sourceCount?: unknown
  hasAnswer?: unknown
  reused?: unknown
}): AskResultLocatedNoticeCopy {
  if (!located) return { show: false, label: "", detail: "", tone: "done" }
  const subject = isPrecheck ? "Ask 预检" : "Ask 深挖"
  const sources = Math.max(0, numberValue(sourceCount))
  if (pending) {
    return {
      show: true,
      label: "已跳到第 3 区",
      detail: `${subject}正在这里生成结果；先看进度和四个等待槽位。`,
      tone: "running",
    }
  }
  if (!hasAnswer) {
    return {
      show: true,
      label: "已跳到来源结果",
      detail: `这里有 ${sources} 个来源，但本轮没有生成完整回答。`,
      tone: "warning",
    }
  }
  if (reused) {
    return {
      show: true,
      label: "已打开缓存结果",
      detail: `这里是最近一次 ${subject} 结果；需要最新材料时点重新检索。`,
      tone: "cached",
    }
  }
  return {
    show: true,
    label: "已跳到 Ask 结果",
    detail: "结构化摘要、关联股票、利好排序和六段回答就在这里。",
    tone: "done",
  }
}

export function buildAskResultOriginCopy(input: {
  kind?: unknown
  action?: unknown
  title?: unknown
  hypothesisId?: unknown
  signalType?: unknown
  sourceRef?: unknown
  sourceExcerpt?: unknown
} = {}): AskResultOriginCopy {
  const kind = compactDisplayText(input.kind, "tracked", 20)
  const action = compactDisplayText(input.action, "ask", 20)
  const isPrecheck = action === "precheck"
  const actionLabel = isPrecheck ? "Ask 预检" : "Ask 深挖"
  const title = compactDisplayText(input.title, kind === "candidate" ? "候选新假设" : "这条假设", 96)
  const id = compactDisplayText(input.hypothesisId, "", 80)
  const signalType = compactDisplayText(input.signalType, "", 36)
  const sourceLabel = compactDisplayText(sourceRefLabel(input.sourceRef), "", 160)
  const sourceLine = sourceLabel ? `来源卡：${sourceLabel}` : ""
  const excerpt = compactDisplayText(input.sourceExcerpt, "", 180)
  const signalLine = [actionLabel, signalType].filter(Boolean).join(" · ")

  if (kind === "candidate") {
    return {
      show: true,
      label: "来自候选卡",
      title,
      signalLine: signalLine || "Ask 预检",
      sourceLine: sourceLine || "来源卡：候选信号",
      detail: excerpt
        ? `${excerpt}；候选还没入池，先看预检结果再决定是否加入跟踪。`
        : "候选还没入池，先看预检结果再决定是否加入跟踪。",
      guardrail: "预检不会自动创建假设，也不会写 wiki/raw。",
      tone: "candidate",
    }
  }

  if (kind === "manual") {
    return {
      show: true,
      label: "来自假设表",
      title,
      signalLine: signalLine || "Ask 深挖",
      sourceLine: "来源卡：未绑定新增资料信号",
      detail: id ? `你从假设表直接打开 ${id} 的研究结果。` : "你从假设表直接打开这条假设的研究结果。",
      guardrail: "这次 Ask 只用于研究，不会自动确认状态或写 wiki/raw。",
      tone: "manual",
    }
  }

  return {
    show: true,
    label: "来自待处理卡",
    title,
    signalLine: signalLine || "Ask 深挖",
    sourceLine: sourceLine || "来源卡：待处理信号",
    detail: excerpt
      ? `${excerpt}；这只是把待处理卡展开成完整研究，不会自动确认状态。`
      : "这只是把待处理卡展开成完整研究，不会自动确认状态。",
    guardrail: "Ask 结果用于辅助判断，不会自动确认状态；确认状态仍需要你点“确认”。",
    tone: "tracked",
  }
}

export function buildAskResultReuseCopy({
  reused,
  title,
  cachedAt,
  sourceCount,
}: {
  reused?: unknown
  title?: unknown
  cachedAt?: unknown
  sourceCount?: unknown
}): AskResultReuseCopy {
  const displayTitle = compactDisplayText(title, "当前假设", 72)
  const time = compactDisplayText(cachedAt, "", 40)
  const sources = Math.max(0, numberValue(sourceCount))
  if (!reused) {
    return {
      show: false,
      label: "",
      detail: "",
      actionLabel: "重新检索",
      tone: "fresh",
    }
  }
  return {
    show: true,
    label: "已显示最近 Ask 结果",
    detail: [
      `为了更快反馈，先复用「${displayTitle}」的上次结构化摘要。`,
      time ? `缓存时间：${time}。` : "",
      sources > 0 ? `上次来源 ${sources} 个。` : "",
      "需要最新资料时点“重新检索”。",
    ].filter(Boolean).join(""),
    actionLabel: "重新检索",
    tone: "cached",
  }
}

export function buildAskCacheStatusCopy({
  cached,
  cachedAt,
  sourceCount,
}: {
  cached?: unknown
  cachedAt?: unknown
  sourceCount?: unknown
}): AskCacheStatusCopy {
  const time = compactDisplayText(cachedAt, "", 32)
  const sources = Math.max(0, numberValue(sourceCount))
  if (!cached) {
    return {
      show: false,
      badgeLabel: "",
      helper: "首次会调用 ask --agentic，完成后下次同问题可秒开。",
      actionLabel: "Ask 深挖",
      actionTitle: "调用 ask --agentic 检索 wiki/raw/行情并生成结构化摘要。",
      cardHintLabel: "",
      cardHintDetail: "",
      cardHintAction: "",
      tone: "fresh",
    }
  }
  const sourceLine = sources > 0 ? `，上次来源 ${sources} 个` : ""
  const cardSourceLine = sources > 0 ? `上次 Ask 已引用 ${sources} 个来源。` : "上次 Ask 结果可直接打开。"
  return {
    show: true,
    badgeLabel: time ? `已缓存 ${time}` : "已缓存",
    helper: "点 Ask 会秒开上次结果；要最新资料，在结果区点重新检索。",
    actionLabel: "秒开 Ask",
    actionTitle: `复用最近 Ask 结果${sourceLine}。如需最新舆情或行情，打开结果区后点重新检索。`,
    cardHintLabel: "这条信号已 Ask 过",
    cardHintDetail: `${cardSourceLine}点“秒开 Ask”会直接跳到结构化摘要和六段回答，不会重新跑慢检索。`,
    cardHintAction: "需要最新舆情/行情时，到 Ask 结果区点“重新检索”。",
    tone: "cached",
  }
}

export function shouldShowAskPendingPanel({
  optimisticPending,
  hasRunningAskAction,
  running,
  runningStageId,
  pendingTitle,
  hasResult,
}: AskPendingVisibilityInput) {
  if (hasResult) return false
  if (optimisticPending || hasRunningAskAction) return true
  const title = compactDisplayText(pendingTitle, "", 120)
  return Boolean(title && running && compactDisplayText(runningStageId, "", 40) === "agentic")
}

export function buildScanProgressSummary({
  stages,
  running,
  sourceCount = 0,
  newMessageCount = 0,
  matchedCount = 0,
  pendingCount = 0,
}: {
  stages: ProgressStageInput[]
  running: boolean
  sourceCount?: number
  newMessageCount?: number
  matchedCount?: number
  pendingCount?: number
}): ScanProgressSummary {
  const visibleStages = stages.filter((stage) => ["ingest", "hypothesis", "validation", "review"].includes(stage.id))
  const totalSteps = visibleStages.length || 4
  const errorStage = visibleStages.find((stage) => stage.status === "error")
  const runningStage = visibleStages.find((stage) => stage.status === "running")
  const doneCount = visibleStages.filter((stage) => stage.status === "done").length
  const activeIndex = runningStage ? visibleStages.indexOf(runningStage) : Math.max(0, Math.min(doneCount, totalSteps - 1))
  const tone = errorStage ? "error" : running || runningStage ? "running" : doneCount >= totalSteps ? "done" : "idle"
  const current = errorStage ?? runningStage ?? visibleStages[Math.min(activeIndex, visibleStages.length - 1)]
  const currentStep = Math.max(1, Math.min(totalSteps, (runningStage ? activeIndex : doneCount) + 1))
  const percent = tone === "error"
    ? Math.max(5, Math.round((doneCount / totalSteps) * 100))
    : tone === "done"
      ? 100
      : Math.max(5, Math.min(95, Math.round(((runningStage ? activeIndex + 0.35 : doneCount) / totalSteps) * 100)))
  const countParts = []
  if (sourceCount > 0) countParts.push(`来源 ${sourceCount}`)
  if (newMessageCount > 0) countParts.push(`新增 ${newMessageCount}`)
  if (matchedCount > 0) countParts.push(`命中 ${matchedCount}`)
  if (pendingCount > 0) countParts.push(`待处理 ${pendingCount}`)
  const detail = [
    current?.detail || (tone === "idle" ? "等待扫描新增资料" : "处理中"),
    countParts.join(" · "),
  ].filter(Boolean).join(" · ")
  const currentId = current?.id ?? ""
  const currentDetail = current?.detail ?? ""
  const phaseBase = `${currentStep}/${totalSteps}`
  const hasActionableCards = pendingCount > 0
  const isLlmReview = /LLM|复核/i.test(currentDetail)
  let phaseLabel = `${phaseBase} ${current?.label || "等待扫描"}`
  let phaseHint = tone === "idle"
    ? "选择新增资料后扫描，系统会先给出待处理卡片。"
    : "正在处理新增资料。"
  let canActBeforeDone = false
  if (tone === "error") {
    phaseLabel = `${phaseBase} ${current?.label || "扫描失败"}`
    phaseHint = "这一步失败了，先看错误信息，再重新扫描。"
  } else if (currentId === "ingest" && tone === "running") {
    phaseLabel = `${phaseBase} 导入资料`
    phaseHint = "正在读取和去重新增资料，先别按旧卡片确认状态。"
  } else if (currentId === "hypothesis" && tone === "running") {
    phaseLabel = `${phaseBase} 规则快扫${isLlmReview ? "/LLM复核" : ""}`
    if (hasActionableCards) {
      phaseHint = `已生成 ${pendingCount} 张待处理卡，可以先看；LLM 复核只补充信号类型、交易含义和 Ask 建议。`
      canActBeforeDone = true
    } else {
      phaseHint = isLlmReview
        ? "规则快扫已完成，正在让 LLM 复核候选卡片。"
        : "正在把新增资料路由到已有假设和候选新假设。"
    }
  } else if (currentId === "validation" && tone === "running") {
    phaseLabel = `${phaseBase} 整理信号`
    phaseHint = hasActionableCards
      ? `已形成 ${pendingCount} 张待处理卡，正在整理状态建议和来源。`
      : "正在整理 alerts、候选假设和来源摘要。"
    canActBeforeDone = hasActionableCards
  } else if (currentId === "review" && tone === "running") {
    phaseLabel = `${phaseBase} 人工确认`
    phaseHint = hasActionableCards
      ? `待处理卡片已生成，确认才会写入假设状态。`
      : "本轮没有需要确认的状态变化。"
    canActBeforeDone = hasActionableCards
  } else if (tone === "done") {
    phaseLabel = hasActionableCards ? `${totalSteps}/${totalSteps} 待处理` : `${totalSteps}/${totalSteps} 完成`
    phaseHint = hasActionableCards
      ? `已生成 ${pendingCount} 张待处理卡，先处理今日先手，再决定 Ask 深挖或忽略。`
      : matchedCount > 0
        ? "有命中但没有状态变化，适合继续观察或点 Ask 深挖。"
        : "本轮没有关键假设变化，保持自动跟踪即可。"
    canActBeforeDone = hasActionableCards
  }
  return {
    currentStep,
    totalSteps,
    percent,
    label: current?.label || "等待扫描",
    detail,
    phaseLabel,
    phaseHint,
    canActBeforeDone,
    tone,
  }
}

export function buildTradingDeskScanBrief({
  running,
  runningStageLabel,
  runningStageDetail,
  latestLogDetail,
  selectedTitle,
  sourceCount,
  newMessageCount,
  matchedCount,
  pendingCount,
  confirmableCount,
  askRecommendedCount,
  candidateCount,
  nextAction,
  pmOpeningBrief,
}: TradingDeskScanBriefInput): TradingDeskScanBrief {
  const sources = Math.max(0, numberValue(sourceCount))
  const newMessages = Math.max(0, numberValue(newMessageCount))
  const matched = Math.max(0, numberValue(matchedCount))
  const pending = Math.max(0, numberValue(pendingCount))
  const confirmable = Math.max(0, numberValue(confirmableCount))
  const ask = Math.max(0, numberValue(askRecommendedCount))
  const candidates = Math.max(0, numberValue(candidateCount))
  const scope = compactDisplayText(selectedTitle, "", 72)
  const scopeText = scope ? `当前假设：${scope}` : "全部假设"
  if (running) {
    const stage = compactDisplayText(runningStageLabel, "扫描中", 60)
    const detail = compactDisplayText(runningStageDetail, compactDisplayText(latestLogDetail, "正在处理新增信息", 120), 120)
    const counts = [
      newMessages > 0 ? `新增 ${newMessages}` : "",
      sources > 0 ? `来源 ${sources}` : "",
    ].filter(Boolean).join(" · ")
    return {
      label: "扫描中",
      headline: `${stage}：${detail}`,
      detail: [counts, "先等本轮完成，再处理优先卡片。"].filter(Boolean).join(" · "),
      jumpLabel: "",
      tone: "running",
    }
  }
  if (pmOpeningBrief) {
    const action = compactDisplayText(pmOpeningBrief.actionLabel, "", 24)
    const jumpAction = action.startsWith("Ask") ? `去 ${action}` : `去${action.replace(/^去/, "")}`
    return {
      label: pmOpeningBrief.label,
      headline: pmOpeningBrief.headline,
      detail: pmOpeningBrief.detail,
      jumpLabel: action && action !== "扫描新增资料" && action !== "无需立刻确认" ? jumpAction : "",
      tone: pmOpeningBrief.tone,
    }
  }
  if (confirmable > 0) {
    return {
      label: "先确认",
      headline: `${confirmable} 条状态变化待确认`,
      detail: `${scopeText}；确认才写入假设记忆，不写 wiki/raw。`,
      jumpLabel: "去确认",
      tone: "action",
    }
  }
  if (ask > 0) {
    return {
      label: "先 Ask",
      headline: `${ask} 条值得深挖`,
      detail: `${scopeText}；先排关联股票、受益链条和利好排序。`,
      jumpLabel: "去 Ask",
      tone: "review",
    }
  }
  if (pending > 0 || candidates > 0) {
    return {
      label: candidates > 0 ? "先筛选" : "待处理",
      headline: `${Math.max(pending, candidates)} 条待处理信号`,
      detail: candidates > 0
        ? "候选只在加入跟踪后入池；泛舆情可以本轮忽略。"
        : "先看是否有二次来源、硬证据或市场反馈。",
      jumpLabel: candidates > 0 ? "去筛选" : "去处理",
      tone: "review",
    }
  }
  if (matched > 0) {
    return {
      label: "有命中",
      headline: `命中 ${matched} 条，但暂不升级`,
      detail: "新增信息相关但不够决定性，继续等二次确认或量价反馈。",
      jumpLabel: "",
      tone: "quiet",
    }
  }
  if (newMessages > 0) {
    return {
      label: "无关键变化",
      headline: `新增 ${newMessages} 条，未触发优先卡片`,
      detail: "继续自动跟踪；有硬催化、反证或市场反馈时再处理。",
      jumpLabel: "",
      tone: "quiet",
    }
  }
  const fallback = compactDisplayText(nextAction, compactDisplayText(latestLogDetail, "扫描新增资料或开启自动跟踪。", 120), 120)
  return {
    label: "等待信号",
    headline: fallback,
    detail: "系统只生成建议，状态更新仍需人工确认。",
    jumpLabel: "",
    tone: "idle",
  }
}
