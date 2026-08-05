import { forwardRef, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { open } from "@tauri-apps/plugin-dialog"
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  Brain,
  ChevronDown,
  CheckCircle2,
  ClipboardList,
  Clock,
  Database,
  FilePlus2,
  FileCheck2,
  FolderOpen,
  GitBranch,
  Lightbulb,
  Loader2,
  Play,
  PlusCircle,
  Radio,
  Save,
  SearchCheck,
  ShieldCheck,
  Sparkles,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { runResearchCockpitCommand, type ResearchCockpitAction } from "@/commands/research-cockpit"
import { useWikiStore } from "@/stores/wiki-store"
import { cn } from "@/lib/utils"
import {
  buildAlphaFeedSummary,
  buildAskDecisionSnapshot,
  buildAskDeepDiveSummary,
  buildAskEvidenceStrength,
  buildAskFollowUpAction,
  buildAskObservationActionCopy,
  buildAskObservationChecklist,
  buildAskPendingSkeletonTiles,
  buildAskResearchTicket,
  buildAskLiveTaskTicket,
  buildAskResultPanelCopy,
  buildAskResultJumpCopy,
  buildAskResultLocatedNoticeCopy,
  buildAskResultLocatorCopy,
  buildAskResultMiniIndex,
  buildAskResultOriginCopy,
  buildAskResultActionGuide,
  buildAskAnswerPanelCopy,
  buildAskResultReadingGuide,
  buildAskResultReuseCopy,
  buildAskSourceSnapshot,
  buildAskStructureFeedback,
  buildAskSummaryTileValues,
  buildAskCacheStatusCopy,
  buildAskWikiFrameHint,
  countAskResultSources,
  buildObservationQueueDraft,
  buildObservationReviewBrief,
  buildObservationQueueTableRows,
  buildCandidateAskPrecheckQuery,
  buildCandidatePrecheckAdoptionCopy,
  buildCandidateSignalClusters,
  buildCandidateThemeSegmentLine,
  buildDailyStatusActionFeedback,
  buildDefaultSignalSourcePresets,
  buildEffectiveLlmReviewMode,
  buildEmptySignalTodoHint,
  buildHypothesisAskActionLabel,
  buildHypothesisAskQuery,
  buildHypothesisDefinitionDraft,
  buildHypothesisGranularityGate,
  buildHypothesisQualityBrief,
  buildHypothesisTimelineBrief,
  buildHypothesisTimelineItems,
  buildHypothesisWorkbenchRows,
  buildIgnoredSignalNoticeCopy,
  buildPendingCountLabel,
  buildPmFocusBrief,
  buildPmDecisionQueueSummary,
  buildPmOpeningBrief,
  buildPmSignalTriageBuckets,
  buildQuietSignalSummaryPlacement,
  buildQuietSignalVisibility,
  buildQuietSignalsSummary,
  buildReviewModeSummary,
  buildRelatedWikiEmptyHint,
  buildRelatedWikiSummary,
  buildScanKey,
  buildScanProgressSummary,
  buildScanModeSummary,
  buildScanScopeSummary,
  buildSignalTodoClusterKey,
  buildSignalTodoSourceKey,
  buildTradingDeskScanBrief,
  buildSignalCardActions,
  buildSignalCardActionFeedback,
  buildSignalCardAskResultBackfill,
  buildSignalCardActionButtonState,
  buildSignalCardActionPanelCopy,
  buildSignalCardDecisionCopy,
  buildSignalCardPmActionLine,
  buildSignalCardQuestionChecklist,
  buildSignalCardRankReason,
  buildSignalCardSourceCopy,
  buildSignalCardSurfacePolicy,
  buildSignalCardTradeLine,
  buildSignalDecisionSummary,
  buildSignalEvidenceToggleCopy,
  buildSignalFinanceHeaderCue,
  buildSignalFocusBuckets,
  buildSignalInfoFlowCopy,
  buildSignalKeywordLine,
  buildSignalLayerBrief,
  buildHypothesisWorkPriority,
  buildSignalRunDecisionCopy,
  buildSignalRunDigest,
  buildSignalRunDigestAction,
  buildSignalScanContextCopy,
  buildSignalSourceCapabilityCopy,
  buildSelectedSignalSourceBrief,
  buildSignalWorkSectionHeader,
  buildStatusUpdateNoticeCopy,
  buildWikiFrameDecisionLine,
  buildWikiFrameFirstLookCopy,
  buildWikiFrameClusters,
  buildWatchReviewPasses,
  buildWikiMetaBadges,
  hypothesisStatusBody,
  hypothesisStatusLabel,
  hypothesisStatusTransitionLabel,
  isSafeObservationDraftPath,
  isSignalSourcePresetActive,
  mergeSignalSourceListRuns,
  mergeSignalTodoRecord,
  buildSignalQueueDecisionViewModel,
  pmSignalTriageBucketForSignal,
  type PmSignalTriageBucketId,
  type SignalQueueDecisionItem,
  type SignalSourcePreset,
  type ScanProgressSummary,
  isPriorityPendingSignal,
  isWeakSignalTitle,
  pendingCandidatePriorityScore,
  pendingTodoPriorityScore,
  readerFacingReason,
  resolveSignalSourceCandidateRoot,
  signalSourceSummary,
  shouldShowSignalCardActionFeedback,
  shouldShowAskPendingPanel,
  shouldShowSignalQueueDetails,
  signalWorkSectionFor,
  shouldShowReviewModeAction,
  shouldRunLlmReviewAfterRules,
  sourcePreview,
  type ObservationQueueDraft,
  type SignalWorkSectionId,
  upsertObservationQueue,
} from "./research-cockpit-helpers"

type StageStatus = "pending" | "running" | "done" | "error"

interface CockpitStage {
  id: string
  label: string
  status: StageStatus
  detail?: string
}

interface DashboardRun {
  dashboard?: {
    summary?: {
      hypothesisCount?: number
      openAlertCount?: number
      triggeredTodayCount?: number
      strengtheningCount?: number
      pricedInRiskCount?: number
      disconfirmedCount?: number
    }
    hypotheses?: Array<Record<string, unknown>>
    openAlerts?: Array<Record<string, unknown>>
    todayTriggers?: Array<Record<string, unknown>>
    evidenceGapSummary?: Array<{ gap: string; count: number }>
  }
}

interface WatchRun {
  dryRun?: boolean
  sources?: Array<Record<string, unknown>>
  events?: Array<Record<string, unknown>>
  alerts?: Array<Record<string, unknown>>
  candidateHypotheses?: Array<Record<string, unknown>>
  llmReview?: Record<string, unknown>
  summary?: {
    sourcesScanned?: number
    matchedHypotheses?: number
    eventsWritten?: number
    alertsWritten?: number
    candidateHypotheses?: number
    llmReviewStatus?: string
  }
}

interface DiscoverRun {
  dryRun?: boolean
  questions?: Array<Record<string, unknown>>
  candidates?: Array<Record<string, unknown>>
  sourceContext?: Array<Record<string, unknown>>
  summary?: {
    questionsDesigned?: number
    failedQuestions?: number
    sourcesScanned?: number
    candidatesReturned?: number
  }
}

interface StatusUpdateRun {
  dryRun?: boolean
  hypothesisId?: string
  previousStatus?: string
  newStatus?: string
  reason?: string
  askRunRef?: string | null
  writeResult?: {
    jsonRelativePath?: string
    markdownRelativePath?: string
    eventRelativePath?: string
  } | null
}

interface HypothesisAskRun {
  mode?: "hypothesis-ask" | "candidate-precheck"
  hypothesis?: Record<string, unknown>
  query?: string
  answer?: string
  sources?: Record<string, Array<Record<string, unknown>>>
  navigation?: Array<Record<string, unknown>>
  wikiResults?: Array<Record<string, unknown>>
  rawResults?: Array<Record<string, unknown>>
  factsResults?: Array<Record<string, unknown>>
  brainResults?: Array<Record<string, unknown>>
  stockDailyResults?: Array<Record<string, unknown>>
  marketValidation?: Record<string, unknown>
  stockDaily?: Record<string, unknown>
  agentRun?: Record<string, unknown>
}

interface AskErrorState {
  title: string
  message: string
  mode: "hypothesis-ask" | "candidate-precheck"
  at: string
}

type SignalActionFeedbackState = {
  action: string
  status: string
  title?: string
  detail?: string
  previousStatus?: string
  newStatus?: string
  askSummary?: ReturnType<typeof buildAskDeepDiveSummary>
  askDecision?: ReturnType<typeof buildAskDecisionSnapshot>
  sourceCount?: number
}

type AskResultOriginState = {
  kind: "tracked" | "candidate" | "manual"
  action: "ask" | "precheck"
  title?: string
  hypothesisId?: string
  signalType?: string
  sourceRef?: string
  sourceExcerpt?: string
}

interface ObservationDraftRun {
  dryRun?: boolean
  draft?: Record<string, unknown>
  writeResult?: {
    jsonRelativePath?: string
    markdownRelativePath?: string
    records?: number
  } | null
}

interface ObservationDraftListRun {
  dryRun?: boolean
  count?: number
  totalCount?: number
  drafts?: Array<Record<string, unknown>>
}

interface ProcessRun {
  summary?: {
    incomingLinesRead?: number
    messagesWritten?: number
    duplicateCount?: number
    errorCount?: number
  }
}

interface RawChatImportRun {
  dryRun?: boolean
  sourcePath?: string
  sourceMissing?: boolean
  sourceFiles?: Array<Record<string, unknown>>
  previewMessages?: Array<Record<string, unknown>>
  summary?: {
    filesScanned?: number
    messagesExtracted?: number
    recordsWritten?: number
    wroteWiki?: boolean
    wroteRaw?: boolean
    wroteRealTrade?: boolean
  }
}

interface WechatSourcesRun {
  sourcePath?: string
  sourceMissing?: boolean
  defaultSourceRef?: string | null
  sources?: Array<Record<string, unknown>>
  summary?: {
    sourcesScanned?: number
    sourcesReturned?: number
    todayFound?: boolean
  }
}

interface SupplementRun {
  dryRun?: boolean
  supplement?: Record<string, unknown>
  writeResult?: {
    jsonRelativePath?: string
    markdownRelativePath?: string
    records?: number
  } | null
}

interface SupplementDraft {
  title: string
  kind: string
  sourceRefs: string
  normalizedBody: string
  evidenceDelta: string
  evidenceGaps: string[]
  suggestedSources: string[]
  extractedPoints: string[]
  mode: "llm"
}

interface SupplementDraftRun {
  dryRun?: boolean
  provider?: string
  model?: string | null
  hypothesisId?: string | null
  draft?: SupplementDraft
  externalContext?: {
    ima?: {
      hits?: Array<Record<string, unknown>>
      warning?: string | null
    }
  }
  rawOutput?: string
}

interface CreateHypothesisRun {
  dryRun?: boolean
  hypothesis?: Record<string, unknown>
  writeResult?: {
    jsonRelativePath?: string
    markdownRelativePath?: string
    records?: number
  } | null
}

interface HypothesisEvidenceFeedbackRun {
  dryRun?: boolean
  count?: number
  items?: Array<Record<string, unknown>>
  manifest?: Record<string, unknown>
  writeResult?: Record<string, unknown> | null
}

interface HypothesisPostMortemRun {
  dryRun?: boolean
  count?: number
  drafts?: Array<Record<string, unknown>>
  writeResult?: Record<string, unknown> | null
}

interface HypothesisVerifyRun {
  status?: string
  checked?: Record<string, unknown>
  issueCount?: number
  errorCount?: number
  issues?: Array<Record<string, unknown>>
}

interface InboxStatus {
  state?: {
    lastProcessedAt?: string | null
    messageCount?: number
    duplicateCount?: number
    errorCount?: number
  }
  counts?: {
    incomingFiles?: number
    processedFiles?: number
  }
}

interface ActivityLogEntry {
  id: number
  at: string
  stage: string
  status: "running" | "done" | "error"
  detail: string
}

type WatchAnswerTone = "neutral" | "support" | "warning" | "danger"

interface WatchAnswer {
  tone: WatchAnswerTone
  verdict: string
  conclusion: string
  reason: string
  sourceRef: string
  sourceExcerpt: string
  evidenceDelta: string
  evidenceGaps: string[]
  nextAction: string
  relatedWikiPages?: Array<Record<string, unknown>>
}

interface EvidenceGapInfo {
  code: string
  label: string
  description: string
  sources: string[]
  sourceIds: string[]
  prompt: string
}

const STAGE_TEMPLATE: CockpitStage[] = [
  { id: "ingest", label: "信息摄入", status: "pending" },
  { id: "hypothesis", label: "假设生成/更新", status: "pending" },
  { id: "agentic", label: "多智能体推演", status: "pending" },
  { id: "validation", label: "市场/财报/订单/公告验证", status: "pending" },
  { id: "ledger", label: "实验账本", status: "pending" },
  { id: "proposal", label: "策略改进建议", status: "pending" },
  { id: "review", label: "人工审核", status: "pending" },
  { id: "training", label: "自训练样本沉淀", status: "pending" },
]

const WATCH_SOURCES = "all"

const SUPPLEMENT_SOURCE_OPTIONS = [
  { id: "pasted_material", label: "粘贴资料", status: "可处理", body: "路演、表格、公告、纪要原文" },
  { id: "wiki_incremental", label: "知识库新增", status: "可扫描", body: "wiki/raw 新增内容" },
  { id: "wechat_raw", label: "微信聊天", status: "可导入", body: "raw/微信聊天 fallback" },
  { id: "ima", label: "IMA知识库", status: "可快搜", body: "从 IMA 知识库搜索资料标题和高亮" },
  { id: "cninfo", label: "CNINFO公告", status: "待自动接入", body: "公告、定增、订单披露" },
  { id: "qichacha", label: "企查查招投标", status: "待自动接入", body: "中标、采购、客户线索" },
  { id: "tushare", label: "Tushare", status: "待自动接入", body: "行情、财务、交易验证" },
  { id: "roadshow", label: "路演/调研/PDF", status: "人工粘贴", body: "纪要、表格、卖方深度" },
]

const EVIDENCE_GAP_DEFINITIONS: Record<string, Omit<EvidenceGapInfo, "code">> = {
  "fundamental:orders:not_checked": {
    label: "订单真实性未核验",
    description: "还没看到客户订单、采购订单、重大合同或中标结果能支撑假设。",
    sources: ["IMA知识库", "企查查招投标", "CNINFO公告", "路演/调研"],
    sourceIds: ["ima", "qichacha", "cninfo", "roadshow"],
    prompt: "补充客户订单、采购订单、重大合同或中标结果，区分传闻、卖方判断和可核验证据。",
  },
  "fundamental:tender_original:not_checked": {
    label: "招投标原文未核验",
    description: "还没拿到招标、中标、采购主体、金额、产品规格等原始记录。",
    sources: ["企查查招投标", "IMA知识库"],
    sourceIds: ["qichacha", "ima"],
    prompt: "补充招投标原文、采购主体、中标金额、产品规格和交付周期。",
  },
  "fundamental:announcement:not_checked": {
    label: "上市公司公告未核验",
    description: "还没用 CNINFO 或交易所公告确认合同、订单、定期报告或投资者问答。",
    sources: ["CNINFO公告", "IMA知识库"],
    sourceIds: ["cninfo", "ima"],
    prompt: "补充 CNINFO/交易所公告、定期报告、投资者问答或重大合同披露。",
  },
  "fundamental:cninfo_announcement:not_checked": {
    label: "CNINFO公告未核验",
    description: "还没从 CNINFO 找到公告级证据。",
    sources: ["CNINFO公告"],
    sourceIds: ["cninfo"],
    prompt: "从 CNINFO 补充公告级证据，并说明公告标题、日期和与假设的关系。",
  },
  "fundamental:delivery:not_checked": {
    label: "交付/出货节奏未核验",
    description: "还没确认订单是否已经进入交付、出货或客户导入阶段。",
    sources: ["IMA知识库", "路演/调研/PDF", "微信聊天"],
    sourceIds: ["ima", "roadshow", "wechat_raw"],
    prompt: "补充交付、出货、客户导入、产能排期或供应链反馈。",
  },
  "fundamental:revenue_recognition:not_checked": {
    label: "收入确认未核验",
    description: "还没确认订单是否进入收入、业绩指引或财报科目。",
    sources: ["Tushare", "CNINFO公告", "IMA知识库"],
    sourceIds: ["tushare", "cninfo", "ima"],
    prompt: "补充收入确认、业绩指引、财报收入、分业务收入或订单转收入节奏。",
  },
  "fundamental:financials:not_checked": {
    label: "财务兑现未核验",
    description: "还没看到收入、利润、现金流或分业务数据能验证。",
    sources: ["Tushare", "CNINFO公告", "IMA知识库"],
    sourceIds: ["tushare", "cninfo", "ima"],
    prompt: "补充财报收入、利润、现金流、分业务数据和同比/环比变化。",
  },
  "fundamental:revenue_and_margin:not_checked": {
    label: "收入和毛利率未核验",
    description: "还没验证收入确认和毛利率是否改善。",
    sources: ["Tushare", "CNINFO公告"],
    sourceIds: ["tushare", "cninfo"],
    prompt: "补充收入确认、毛利率、产品结构和价格变化证据。",
  },
  "fundamental:asp:not_checked": {
    label: "ASP/单价未核验",
    description: "还没确认产品单价、ASP、涨价或价格弹性。",
    sources: ["IMA知识库", "路演/调研/PDF", "微信聊天"],
    sourceIds: ["ima", "roadshow", "wechat_raw"],
    prompt: "补充 ASP、单价、报价、涨价幅度、价格条款或客户价格反馈。",
  },
  "fundamental:gross_margin:not_checked": {
    label: "毛利率改善未核验",
    description: "还没确认价格、产品结构或规模效应是否带来毛利率改善。",
    sources: ["Tushare", "CNINFO公告", "路演/调研/PDF"],
    sourceIds: ["tushare", "cninfo", "roadshow"],
    prompt: "补充毛利率、产品结构、规模效应、原材料成本和价格传导。",
  },
  "fundamental:customer_share:not_checked": {
    label: "客户份额未核验",
    description: "还没确认客户侧份额提升、新客户导入或供应商替代。",
    sources: ["IMA知识库", "路演/调研/PDF", "微信聊天"],
    sourceIds: ["ima", "roadshow", "wechat_raw"],
    prompt: "补充客户名单、份额变化、新客户导入、供应商替代和验证口径。",
  },
  "fundamental:cpo_slowdown:not_checked": {
    label: "CPO放缓前提未核验",
    description: "还没确认 CPO 节奏放缓本身是否成立，以及是否会真实外溢到 MPO。",
    sources: ["IMA知识库", "路演/调研/PDF", "微信聊天"],
    sourceIds: ["ima", "roadshow", "wechat_raw"],
    prompt: "补充 CPO 节奏、客户路线图、光模块/CPO厂商反馈，以及放缓是否利好 MPO。",
  },
  "market:pricing_feedback:not_checked": {
    label: "市场定价反馈未核验",
    description: "还没确认股价、相对强弱、成交额是否已经提前反映。",
    sources: ["Tushare", "知识库新增"],
    sourceIds: ["tushare", "wiki_incremental"],
    prompt: "补充股价、相对强弱、成交额、主题扩散和是否已 priced-in。",
  },
  "market:volume_price_confirmation:not_checked": {
    label: "量价确认未核验",
    description: "还没做最近窗口的涨跌幅、成交额、换手和板块相对表现验证。",
    sources: ["Tushare"],
    sourceIds: ["tushare"],
    prompt: "补充最近 20 个交易日量价验证、成交额变化、相对板块表现和拥挤度。",
  },
  "market:pricing:not_checked": {
    label: "价格反馈未核验",
    description: "还没确认市场是否已经开始定价或充分定价。",
    sources: ["Tushare"],
    sourceIds: ["tushare"],
    prompt: "补充市场价格反馈、相对强弱和成交额验证。",
  },
  "catalyst:market_reaction:not_checked": {
    label: "催化后的市场反应未跟踪",
    description: "这类信息先按交易催化处理，重点看相关股票/板块是否放量、扩散、持续走强。",
    sources: ["Tushare", "微信聊天", "知识库新增"],
    sourceIds: ["tushare", "wechat_raw", "wiki_incremental"],
    prompt: "补充催化出现后 1-5 个交易日的量价、扩散、领涨标的和回落失效条件。",
  },
  "catalyst:follow_through:not_checked": {
    label: "催化持续性未跟踪",
    description: "还没确认催化是一日游、扩散交易，还是能持续形成主题主线。",
    sources: ["微信聊天", "Tushare", "IMA知识库"],
    sourceIds: ["wechat_raw", "tushare", "ima"],
    prompt: "补充催化次日/三日持续性、资金扩散路径、是否出现二次发酵或退潮。",
  },
  "catalyst:second_source:not_checked": {
    label: "二次来源未确认",
    description: "新催化可以先跟踪，但最好再找一个独立来源确认，不必等完整财报闭环。",
    sources: ["IMA知识库", "微信聊天", "路演/调研/PDF"],
    sourceIds: ["ima", "wechat_raw", "roadshow"],
    prompt: "补充第二来源：卖方、产业链、公司互动、渠道反馈或更清晰的原文出处。",
  },
  "technical:mpc_definition:not_checked": {
    label: "技术术语/口径未核验",
    description: "这里可能是 LLM 把 MPO/CPO 误写成 MPC；需要先确认术语、产品边界和用量口径。",
    sources: ["IMA知识库", "路演/调研/PDF"],
    sourceIds: ["ima", "roadshow"],
    prompt: "先核对 MPO/CPO 等技术术语、产品定义、单柜用量和产业链边界；如 MPC 是误写，请修正。",
  },
  "industry:variables:not_checked": {
    label: "产业变量未核验",
    description: "单柜用量、ASP、客户份额、交付节奏等关键变量还不完整。",
    sources: ["IMA知识库", "路演/调研/PDF", "微信聊天"],
    sourceIds: ["ima", "roadshow", "wechat_raw"],
    prompt: "补充单柜用量、ASP、客户份额、订单、交付和财报闭环。",
  },
}

const HYPOTHESIS_STATUS_LABELS: Array<{ status: string; label: string; body: string }> = [
  "seed",
  "watching",
  "strengthening",
  "actionable",
  "priced_in",
  "divergent",
  "disconfirmed",
  "archived",
].map((status) => ({ status, label: hypothesisStatusLabel(status), body: hypothesisStatusBody(status) }))

function todayWechatSource() {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
  return `raw/微信聊天/${formatter.format(new Date())}.md`
}

function freshStages() {
  return STAGE_TEMPLATE.map((stage) => ({ ...stage }))
}

function textValue(value: unknown, fallback = "-") {
  if (value == null || value === "") return fallback
  return String(value)
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function countArray(value: unknown) {
  return Array.isArray(value) ? value.length : 0
}

function firstArray(record: Record<string, unknown> | null, keys: string[]) {
  if (!record) return []
  for (const key of keys) {
    const value = record[key]
    if (Array.isArray(value)) return value as Record<string, unknown>[]
  }
  return []
}

function listText(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean).join(", ")
  if (typeof value === "string") return value
  return ""
}

function arrayRecords(value: unknown) {
  return Array.isArray(value) ? value.map(recordValue) : []
}

function buildSignalAskQueryContext(signal: Record<string, unknown>): Parameters<typeof buildHypothesisAskQuery>[1] {
  return {
    relatedWikiCount: arrayRecords(signal.relatedWikiPages).length,
    relatedWikiPages: signal.relatedWikiPages,
    sourceExcerpt: signal.sourceExcerpt,
    sourceRef: signal.sourceRef,
    tradingImplication: signal.tradingImplication,
    evidenceDelta: signal.evidenceDelta,
    signalType: signal.signalType,
  }
}

function askRunRefForStatusUpdate(run: HypothesisAskRun | null, hypothesisId: string) {
  if (!run || run.mode === "candidate-precheck") return ""
  const runHypothesisId = textValue(run.hypothesis?.id, "")
  if (!hypothesisId || runHypothesisId !== hypothesisId) return ""
  const agentRun = recordValue(run.agentRun)
  const artifact = recordValue(agentRun.artifact)
  return textValue(
    artifact.relativeManifestPath
      ?? artifact.manifestPath
      ?? artifact.relativeFinalPath
      ?? artifact.finalPath
      ?? (agentRun.runId ? `agent-run:${textValue(agentRun.runId, "")}` : ""),
    "",
  )
}

function stringList(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean)
  if (typeof value === "string") return value.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean)
  return []
}

function candidateWorkbenchKey(item: Record<string, unknown>) {
  const id = textValue(item.id, "")
  if (id) return id
  return [
    textValue(item.title, ""),
    textValue(item.theme, ""),
    listText(item.segments),
    textValue(item.discoverySourceRef ?? item.sourceRef, ""),
  ].filter(Boolean).join("|")
}

function firstRecord(...values: Array<Record<string, unknown> | null | undefined>) {
  return values.find((value) => value && typeof value === "object") ?? null
}

function compactText(value: unknown, fallback = "", limit = 320) {
  const text = textValue(value, fallback).replace(/\s+/g, " ").trim()
  if (text.length <= limit) return text
  return `${text.slice(0, limit)}...`
}

function fallbackGapLabel(code: string) {
  const core = code
    .replace(/:not_checked$/, "")
    .replace(/_/g, " ")
    .replace(/:/g, " / ")
  return `${core} 未核验`
}

function describeEvidenceGap(code: unknown): EvidenceGapInfo {
  const normalized = String(code ?? "").trim()
  const definition = EVIDENCE_GAP_DEFINITIONS[normalized]
  if (definition) return { code: normalized, ...definition }
  return {
    code: normalized,
    label: fallbackGapLabel(normalized || "unknown"),
    description: "系统识别到一个尚未核验的证据缺口，需要人工补充来源和验证口径。",
    sources: ["IMA知识库", "知识库新增"],
    sourceIds: ["ima", "wiki_incremental"],
    prompt: `补充并解释这个证据缺口：${normalized}`,
  }
}

function uniqueEvidenceGapInfos(codes: unknown[]) {
  const seen = new Set<string>()
  const gaps: EvidenceGapInfo[] = []
  for (const code of codes) {
    const info = describeEvidenceGap(code)
    if (!info.code || seen.has(info.code)) continue
    seen.add(info.code)
    gaps.push(info)
  }
  return gaps
}

function evidenceGapLabels(value: unknown) {
  const codes = stringList(value)
  if (!codes.length) return ""
  return uniqueEvidenceGapInfos(codes).map((gap) => gap.label).join(", ")
}

function buildWatchAnswer({
  watchRun,
  selectedTitle,
  canConfirmAlerts,
  displayableCandidateCount,
}: {
  watchRun: WatchRun | null
  selectedTitle: string
  canConfirmAlerts: boolean
  displayableCandidateCount?: number
}): WatchAnswer {
  if (!watchRun) {
    return {
      tone: "neutral",
      verdict: "还没有验证回答",
      conclusion: "先点“扫描新增资料”，系统会读取选中的新增资料增量，再给出当前判断。",
      reason: "尚未运行 Watchtower。",
      sourceRef: "",
      sourceExcerpt: "",
      evidenceDelta: "not_run",
      evidenceGaps: [],
      nextAction: "点“扫描新增资料”或开启“自动跟踪”。",
      relatedWikiPages: [],
    }
  }

  const primaryAlert = watchRun.alerts?.[0] ? recordValue(watchRun.alerts[0]) : null
  const primaryEvent = watchRun.events?.[0] ? recordValue(watchRun.events[0]) : null
  const primary = firstRecord(primaryAlert, primaryEvent)
  const sourcesScanned = watchRun.summary?.sourcesScanned ?? 0
  const candidateCount = displayableCandidateCount ?? (watchRun.candidateHypotheses ?? []).filter((item) => !isWeakSignalTitle(recordValue(item).title)).length

  if (!primary) {
    return {
      tone: "neutral",
      verdict: candidateCount > 0 ? "发现候选新假设" : "证据不足",
      conclusion: candidateCount > 0
        ? `扫描了 ${sourcesScanned} 个来源，但没有命中当前假设；系统发现了候选新假设，需要人工决定是否另建。`
        : `扫描了 ${sourcesScanned} 个来源，暂时没有找到能改变“${selectedTitle}”状态的新增证据。`,
      reason: candidateCount > 0 ? "新增信息更像另一条独立假设，而不是当前假设的验证材料。" : "没有产生 event 或 alert。",
      sourceRef: "",
      sourceExcerpt: "",
      evidenceDelta: candidateCount > 0 ? "candidate_hypothesis" : "insufficient",
      evidenceGaps: ["fundamental:orders:not_checked", "fundamental:financials:not_checked", "market:pricing:not_checked"],
      nextAction: candidateCount > 0 ? "查看下方“候选新假设”，确认是否创建新假设。" : "补充订单、公告、财报、ASP、客户份额或路演纪要后再扫。",
      relatedWikiPages: [],
    }
  }

  const evidenceDelta = textValue(primary.evidenceDelta, textValue(primaryEvent?.evidenceDelta, "matched_context"))
  const sourceRef = textValue(primary.sourceRef, textValue(primaryEvent?.sourceRef, "未记录来源"))
  const sourceExcerpt = compactText(primaryEvent?.sourceExcerpt ?? primary.sourceExcerpt, "", 420)
  const relatedWikiPages = arrayRecords(primary.relatedWikiPages ?? primaryEvent?.relatedWikiPages).slice(0, 3)
  const alertReason = textValue(primary.alertReason, "")
  const gaps = [...new Set([
    ...stringList(primary.evidenceGaps),
    ...stringList(primaryEvent?.evidenceGaps),
  ])].slice(0, 8)

  let tone: WatchAnswerTone = "neutral"
  let verdict = "有新增相关证据"
  let conclusion = "新增信息命中了当前假设，但还需要结合证据缺口判断能否更新状态。"
  let reason = alertReason || "新增来源与当前假设发生匹配。"
  let nextAction = canConfirmAlerts ? "复核来源和缺口后，点“确认更新状态”。" : "继续观察或补充更硬的验证材料。"

  if (evidenceDelta === "fundamental_delivery") {
    tone = "support"
    verdict = gaps.length > 0 ? "初步支持，但仍有闭环缺口" : "初步支持：证据增强"
    conclusion = gaps.length > 0
      ? "这更像订单、公告、客户、财报等基本面兑现线索，不只是叙事扩散；但因为仍有缺口，不能直接升级成最终确认。"
      : "新增证据同时具备较强基本面兑现特征，可以作为状态增强的候选。"
    reason = alertReason || "出现订单、公告、客户、财报或交付类证据。"
    nextAction = canConfirmAlerts ? "可以确认写入事件；之后继续补 CNINFO、企查查、财报和 ASP 证据。" : "补齐公告、订单、财报和 ASP 后再确认。"
  } else if (evidenceDelta === "catalyst_signal") {
    tone = "support"
    verdict = "新催化：先跟踪市场反应"
    conclusion = "这类信息不需要先做完整订单/财报闭环；它更适合进入交易催化跟踪，先看相关细分和股票的量价反应、扩散强度和二次确认。"
    reason = alertReason || "出现新变量、涨价函、核心客户路线、产业链传闻或主题催化。"
    nextAction = canConfirmAlerts
      ? "可以确认写入“新催化”事件；接下来跟踪 1-5 个交易日量价、扩散和二次来源。"
      : "先看候选股票/板块量价和第二来源，不必马上补完整财报闭环。"
  } else if (evidenceDelta === "supporting_signal") {
    tone = "support"
    verdict = "弱支持：出现支持信号"
    conclusion = "这条信息支持假设方向，但还不到订单兑现或财报验证级别。"
    reason = alertReason || "出现调研、产业链反馈或方向性支持材料。"
  } else if (evidenceDelta === "market_feedback") {
    tone = "warning"
    verdict = "市场先反应：注意已定价风险"
    conclusion = "价格或交易热度已经先动，但这不等于基本面兑现，需要防止把短期涨跌误判成确认。"
    reason = alertReason || "新增信息偏向市场反馈，缺少基本面闭环。"
    nextAction = "先看公告、订单、财报和交付节奏；若价格已充分反应，状态更接近“可能已定价”。"
  } else if (evidenceDelta === "narrative_expansion") {
    tone = "warning"
    verdict = "叙事扩散：还不是订单兑现"
    conclusion = "新增信息更像主题扩散或卖方叙事增强，暂时不能证明假设进入兑现期。"
    reason = alertReason || "有叙事扩散，但缺少订单、公告、财报、ASP 或客户份额验证。"
    nextAction = "补充硬证据；暂时不要把它当作“接近可下注”的依据。"
  } else if (evidenceDelta === "counter_signal") {
    tone = "danger"
    verdict = "出现反证：需要复核"
    conclusion = "新增信息可能削弱或反驳当前假设，不能按证据增强处理。"
    reason = alertReason || "出现反向订单、价格、需求、竞争或财报信号。"
    nextAction = "进入反证审核，必要时把状态改为“走势背离”或“被证伪”。"
  } else if (evidenceDelta === "mixed_signal") {
    tone = "warning"
    verdict = "信号混合：暂不升级"
    conclusion = "新增材料同时包含支持和反证，需要拆开看，暂时不适合直接提高置信度。"
    reason = alertReason || "支持性证据和反向证据同时出现。"
    nextAction = "补充更明确的订单、交付、财务或价格链路，再决定状态。"
  }

  if (gaps.length > 0 && tone === "support" && evidenceDelta !== "catalyst_signal") {
    nextAction = canConfirmAlerts
      ? "可以先确认写入“证据增强”事件，但下一步必须补齐缺口，避免把线索当结论。"
      : "先补齐缺口，再确认状态变化。"
  }

  return {
    tone,
    verdict,
    conclusion,
    reason,
    sourceRef,
    sourceExcerpt,
    evidenceDelta,
    evidenceGaps: gaps,
    nextAction,
    relatedWikiPages,
  }
}

function latestSignalForHypothesis(hypothesis: Record<string, unknown>, watchRun: WatchRun | null) {
  const id = textValue(hypothesis.id, "")
  const records = [
    ...(watchRun?.alerts ?? []),
    ...(watchRun?.events ?? []),
  ]
    .map(recordValue)
    .filter((item) => textValue(item.hypothesisId, "") === id)
    .sort((a, b) => textValue(b.createdAt, "").localeCompare(textValue(a.createdAt, "")))
  const primary = records[0]
  if (!primary) {
    return {
      evidenceDelta: textValue(hypothesis.latestEvidenceDelta, "none"),
      signalType: signalStrengthLabel(hypothesis.latestEvidenceDelta),
      suggestedStatus: textValue(hypothesis.feedbackStatus ?? hypothesis.status, "watching"),
      reason: textValue(hypothesis.feedbackReason, "暂无新增命中"),
      tradingImplication: "",
      askDeepDiveRecommended: false,
      sourceRef: "",
      eventRef: "",
      sourceExcerpt: "",
      relatedWikiPages: [],
    }
  }
  return signalFromWatchRecord(primary, hypothesis)
}

function signalFromWatchRecord(item: Record<string, unknown>, hypothesis?: Record<string, unknown> | null) {
  return {
    evidenceDelta: textValue(item.evidenceDelta, "new_context"),
    signalType: textValue(item.signalType, signalStrengthLabel(item.evidenceDelta)),
    suggestedStatus: textValue(item.suggestedStatus, textValue(hypothesis?.feedbackStatus ?? hypothesis?.status, "watching")),
    reason: reasonLabel(item.reason ?? item.suggestedStatusReason ?? item.alertReason ?? item.summary) || "新增信息命中假设",
    tradingImplication: textValue(item.tradingImplication, ""),
    askDeepDiveRecommended: Boolean(item.askDeepDiveRecommended),
    sourceRef: textValue(item.sourceRef, ""),
    eventRef: textValue(item.id, "") ? `${textValue(item.sourceRef, "source")}#${textValue(item.id)}` : textValue(item.sourceRef, ""),
    sourceExcerpt: compactText(item.sourceExcerpt, "", 220),
    relatedWikiPages: arrayRecords(item.relatedWikiPages).slice(0, 3),
  }
}

function reasonLabel(value: unknown) {
  return readerFacingReason(value)
}

function signalStrengthLabel(delta: unknown) {
  const value = textValue(delta, "matched_context")
  if (value === "catalyst_signal") return "新催化"
  if (value === "fundamental_delivery") return "硬证据"
  if (value === "market_feedback") return "市场反馈"
  if (value === "counter_signal") return "反证"
  if (value === "narrative_expansion") return "叙事扩散"
  if (value === "supporting_signal") return "二次确认"
  if (value === "mixed_signal") return "二次确认"
  return "新催化"
}

type SignalTodo = {
  key: string
  item: Record<string, unknown>
  hypothesis: Record<string, unknown> | null
  signal: ReturnType<typeof latestSignalForHypothesis> & {
    sourceKindLabel?: unknown
    matchedSegments?: unknown
    matchedEntities?: unknown
    catalystTags?: unknown
  }
  sourceCount: number
  signalCount: number
}

function buildSignalTodos({
  watchRun,
  hypothesisRows,
  ignoredKeys,
}: {
  watchRun: WatchRun | null
  hypothesisRows: Array<Record<string, unknown>>
  ignoredKeys: Set<string>
}): SignalTodo[] {
  const byId = new Map(hypothesisRows.map((item) => [textValue(item.id, ""), item]))
  const records = [
    ...arrayRecords(watchRun?.alerts),
    ...arrayRecords(watchRun?.events),
  ]
  const byKey = new Map<string, { item: Record<string, unknown>; sourceKeys: Set<string> }>()
  for (const item of records
    .map(recordValue)
    .sort((a, b) => textValue(b.createdAt, "").localeCompare(textValue(a.createdAt, "")))) {
    const sourceKey = buildSignalTodoSourceKey(item)
    const key = buildSignalTodoClusterKey(item)
    if (!key || ignoredKeys.has(key) || ignoredKeys.has(sourceKey)) continue
    const existing = byKey.get(key)
    if (existing) {
      existing.item = mergeSignalTodoRecord(existing.item, item)
      existing.sourceKeys.add(sourceKey || key)
    } else {
      byKey.set(key, {
        item,
        sourceKeys: new Set([sourceKey || key]),
      })
    }
  }
  const todos: SignalTodo[] = []
  for (const [key, cluster] of byKey.entries()) {
    const item = cluster.item
    const hypothesis = byId.get(textValue(item.hypothesisId, "")) ?? null
    const signalCount = Math.max(cluster.sourceKeys.size, numberValue(item.mergedCount))
    todos.push({
      key,
      item,
      hypothesis,
      signal: signalFromWatchRecord(item, hypothesis),
      sourceCount: cluster.sourceKeys.size,
      signalCount,
    })
  }
  return todos.sort((a, b) => todoActionScore(b) - todoActionScore(a)
    || textValue(b.item.createdAt, "").localeCompare(textValue(a.item.createdAt, ""))
    || a.key.localeCompare(b.key))
}

function todoCanConfirm(todo: SignalTodo) {
  const status = textValue(todo.hypothesis?.status, "watching")
  return Boolean(todo.hypothesis) && todo.signal.suggestedStatus !== status
}

function todoActionScore(todo: SignalTodo) {
  return pendingTodoPriorityScore({
    canConfirm: todoCanConfirm(todo),
    askDeepDiveRecommended: todo.signal.askDeepDiveRecommended,
    evidenceDelta: todo.signal.evidenceDelta,
    signalType: todo.signal.signalType,
    clusterSourceCount: Math.max(todo.sourceCount, todo.signalCount),
    relatedWikiCount: arrayRecords(todo.signal.relatedWikiPages).length,
    relatedWikiPages: todo.signal.relatedWikiPages,
    financeEntityRecords: [todo.signal, ...arrayRecords(todo.signal.relatedWikiPages)],
  })
}

function candidateActionScore(item: Record<string, unknown>) {
  const gate = buildHypothesisGranularityGate(item)
  const baseScore = pendingCandidatePriorityScore({
    priorityScore: item.priorityScore,
    askDeepDiveRecommended: Boolean(item.askDeepDiveRecommended),
    evidenceDelta: item.evidenceDelta,
    signalType: item.signalType,
    clusterSourceCount: item.clusterSourceCount,
    relatedWikiCount: arrayRecords(item.relatedWikiPages).length,
    relatedWikiPages: item.relatedWikiPages,
    financeEntityRecords: [item, ...arrayRecords(item.relatedWikiPages)],
  })
  return gate.passes ? baseScore : Math.min(baseScore, 9)
}

function isPriorityTodo(todo: ReturnType<typeof buildSignalTodos>[number]) {
  return todoCanConfirm(todo) || todo.signal.askDeepDiveRecommended || isPriorityPendingSignal(todoActionScore(todo))
}

function isPriorityCandidate(item: Record<string, unknown>) {
  const gate = buildHypothesisGranularityGate(item)
  if (!gate.passes) return false
  return Boolean(item.askDeepDiveRecommended) || isPriorityPendingSignal(candidateActionScore(item))
}

function buildSignalQueueDecisionItems(
  todos: Array<ReturnType<typeof buildSignalTodos>[number]>,
  candidates: Array<Record<string, unknown>>,
): SignalQueueDecisionItem[] {
  return [
    ...todos.map((todo) => ({
      key: todo.key,
      kind: "tracked" as const,
      title: textValue(todo.hypothesis?.title, textValue(todo.item.hypothesisTitle, "")),
      createdAt: todo.item.createdAt,
      score: todoActionScore(todo),
      priority: isPriorityTodo(todo),
      canConfirm: todoCanConfirm(todo),
      askDeepDiveRecommended: Boolean(todo.signal.askDeepDiveRecommended),
      evidenceDelta: todo.signal.evidenceDelta,
      signalType: todo.signal.signalType,
      sourceCount: Math.max(todo.sourceCount, todo.signalCount),
      relatedWikiPages: todo.signal.relatedWikiPages,
      financeEntityRecords: [todo.signal, ...arrayRecords(todo.signal.relatedWikiPages)],
    })),
    ...candidates.map((item, index) => ({
      key: candidateWorkbenchKey(item) || `${textValue(item.title, "")}:${index}`,
      kind: "candidate" as const,
      title: item.title,
      createdAt: item.createdAt,
      score: candidateActionScore(item),
      priority: isPriorityCandidate(item),
      canConfirm: false,
      askDeepDiveRecommended: Boolean(item.askDeepDiveRecommended),
      evidenceDelta: item.evidenceDelta,
      signalType: item.signalType,
      sourceCount: 1,
      relatedWikiPages: item.relatedWikiPages,
      financeEntityRecords: [item, ...arrayRecords(item.relatedWikiPages)],
    })),
  ]
}

const SIGNAL_WORK_SECTION_ORDER: SignalWorkSectionId[] = ["confirm", "counter", "hard", "market", "catalyst", "candidate", "quiet"]

function groupBySignalWorkSection<T>(
  items: T[],
  getSectionId: (item: T) => SignalWorkSectionId,
) {
  const bySection = new Map<SignalWorkSectionId, T[]>()
  for (const item of items) {
    const sectionId = getSectionId(item)
    bySection.set(sectionId, [...(bySection.get(sectionId) ?? []), item])
  }
  return SIGNAL_WORK_SECTION_ORDER
    .map((id) => ({ id, items: bySection.get(id) ?? [] }))
    .filter((section) => section.items.length > 0)
}

function todoWorkSectionId(todo: ReturnType<typeof buildSignalTodos>[number]) {
  return signalWorkSectionFor({
    kind: "tracked",
    canConfirm: todoCanConfirm(todo),
    askDeepDiveRecommended: Boolean(todo.signal.askDeepDiveRecommended),
    evidenceDelta: todo.signal.evidenceDelta,
    signalType: todo.signal.signalType,
  })
}

function candidateWorkSectionId(item: Record<string, unknown>) {
  return signalWorkSectionFor({
    kind: "candidate",
    askDeepDiveRecommended: Boolean(item.askDeepDiveRecommended),
    evidenceDelta: item.evidenceDelta,
    signalType: item.signalType,
  })
}

function todoTriageBucketId(todo: ReturnType<typeof buildSignalTodos>[number]) {
  return pmSignalTriageBucketForSignal({
    kind: "tracked",
    canConfirm: todoCanConfirm(todo),
    askDeepDiveRecommended: Boolean(todo.signal.askDeepDiveRecommended),
    evidenceDelta: todo.signal.evidenceDelta,
    signalType: todo.signal.signalType,
  })
}

function candidateTriageBucketId(item: Record<string, unknown>) {
  return pmSignalTriageBucketForSignal({
    kind: "candidate",
    askDeepDiveRecommended: Boolean(item.askDeepDiveRecommended),
    evidenceDelta: item.evidenceDelta,
    signalType: item.signalType,
  })
}

function todoActionSummary(todo: ReturnType<typeof buildSignalTodos>[number]) {
  const currentStatus = textValue(todo.hypothesis?.status, "watching")
  return buildSignalDecisionSummary({
    kind: "tracked",
    canConfirm: todoCanConfirm(todo),
    askDeepDiveRecommended: todo.signal.askDeepDiveRecommended,
    currentStatus,
    suggestedStatus: todo.signal.suggestedStatus,
    evidenceDelta: todo.signal.evidenceDelta,
    signalType: todo.signal.signalType,
    relatedWikiCount: arrayRecords(todo.signal.relatedWikiPages).length,
    relatedWikiPages: todo.signal.relatedWikiPages,
    financeEntityRecords: [todo.signal, ...arrayRecords(todo.signal.relatedWikiPages)],
  })
}

function candidateActionSummary(item: Record<string, unknown>) {
  return buildSignalDecisionSummary({
    kind: "candidate",
    askDeepDiveRecommended: Boolean(item.askDeepDiveRecommended),
    evidenceDelta: item.evidenceDelta,
    signalType: item.signalType,
    relatedWikiCount: arrayRecords(item.relatedWikiPages).length,
    relatedWikiPages: item.relatedWikiPages,
    financeEntityRecords: [item, ...arrayRecords(item.relatedWikiPages)],
    clusterSourceCount: item.clusterSourceCount,
    priorityReasons: item.priorityReasons,
  })
}

function findWechatSourceRecord(run: WechatSourcesRun | null, rawChatSource: string) {
  const source = rawChatSource.trim()
  const records = run?.sources ?? []
  return records.find((item) => textValue(item.sourceRef, "") === source || textValue(item.sourcePath, "") === source)
    ?? records.find((item) => Boolean(item.isSelectedCandidate))
    ?? records[0]
    ?? null
}

function wechatSourceSignature(run: WechatSourcesRun | null, rawChatSource: string) {
  const record = findWechatSourceRecord(run, rawChatSource)
  if (!record) return ""
  return [
    textValue(record.sourceRef, ""),
    textValue(record.sourceHash, ""),
    textValue(record.mtime, ""),
  ].join("|")
}

function rawImportSourceSignature(run: RawChatImportRun | null, rawChatSource: string) {
  const source = rawChatSource.trim()
  const records = run?.sourceFiles ?? []
  const record = records.find((item) => textValue(item.sourceRef, "") === source || textValue(item.sourcePath, "") === source)
    ?? records[0]
    ?? null
  if (!record) return ""
  return [
    textValue(record.sourceRef, ""),
    textValue(record.sourceHash, ""),
    textValue(record.mtime, ""),
  ].join("|")
}

export function ResearchCockpitView() {
  const project = useWikiStore((s) => s.project)
  const [since, setSince] = useState("30m")
  const [rawChatSource, setRawChatSource] = useState(() => todayWechatSource())
  const [deepQuestion, setDeepQuestion] = useState("未来三年数据中心对光纤、连接器、PCB、CPO产业链的真实订单兑现路径，哪些细分环节最可能先出现财报验证？")
  const [discoveryQuestionCount, setDiscoveryQuestionCount] = useState("5")
  const [discoveryConcurrency, setDiscoveryConcurrency] = useState("3")
  const [hypothesisTitle, setHypothesisTitle] = useState("")
  const [hypothesisTheme, setHypothesisTheme] = useState("AI数据中心互联")
  const [hypothesisSegments, setHypothesisSegments] = useState("")
  const [hypothesisTimeHorizon] = useState("未来6-12个月")
  const [selectedHypothesisId, setSelectedHypothesisId] = useState("")
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [supplementTitle, setSupplementTitle] = useState("补充资料：")
  const [supplementKind, setSupplementKind] = useState("manual")
  const [supplementHypothesisId, setSupplementHypothesisId] = useState("")
  const [supplementRefs, setSupplementRefs] = useState("")
  const [supplementBody, setSupplementBody] = useState("")
  const [selectedSupplementSources, setSelectedSupplementSources] = useState<string[]>(["pasted_material", "wiki_incremental", "ima", "cninfo", "qichacha", "tushare"])
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [running, setRunning] = useState(false)
  const [stages, setStages] = useState<CockpitStage[]>(freshStages)
  const [activityLog, setActivityLog] = useState<ActivityLogEntry[]>([])
  const [dashboardRun, setDashboardRun] = useState<DashboardRun | null>(null)
  const [watchRun, setWatchRun] = useState<WatchRun | null>(null)
  const [discoverRun, setDiscoverRun] = useState<DiscoverRun | null>(null)
  const [statusUpdateRun, setStatusUpdateRun] = useState<StatusUpdateRun | null>(null)
  const [hypothesisEvidenceFeedback, setHypothesisEvidenceFeedback] = useState<HypothesisEvidenceFeedbackRun | null>(null)
  const [hypothesisPostMortemRun, setHypothesisPostMortemRun] = useState<HypothesisPostMortemRun | null>(null)
  const [hypothesisVerifyRun, setHypothesisVerifyRun] = useState<HypothesisVerifyRun | null>(null)
  const [hypothesisAskRun, setHypothesisAskRun] = useState<HypothesisAskRun | null>(null)
  const [askErrorState, setAskErrorState] = useState<AskErrorState | null>(null)
  const [askRunCacheByHypothesisId, setAskRunCacheByHypothesisId] = useState<Record<string, { run: HypothesisAskRun; cachedAt: string }>>({})
  const [reusedAskCache, setReusedAskCache] = useState<{ hypothesisId: string; cachedAt: string } | null>(null)
  const [pendingAskTitle, setPendingAskTitle] = useState("")
  const [askPendingRequested, setAskPendingRequested] = useState(false)
  const [askResultLocatedAt, setAskResultLocatedAt] = useState(0)
  const [askResultOrigin, setAskResultOrigin] = useState<AskResultOriginState | null>(null)
  const [askFollowUpCopied, setAskFollowUpCopied] = useState(false)
  const [observationChecklistCopied, setObservationChecklistCopied] = useState(false)
  const [observationQueue, setObservationQueue] = useState<ObservationQueueDraft[]>([])
  const [observationDraftSavingKey, setObservationDraftSavingKey] = useState("")
  const [observationDraftRuns, setObservationDraftRuns] = useState<Record<string, ObservationDraftRun>>({})
  const [observationDraftList, setObservationDraftList] = useState<ObservationDraftListRun | null>(null)
  const [observationDraftListLoading, setObservationDraftListLoading] = useState(false)
  const [candidateAskPrecheckSource, setCandidateAskPrecheckSource] = useState<Record<string, unknown> | null>(null)
  const [candidateAskPrecheckAdopted, setCandidateAskPrecheckAdopted] = useState<Record<string, unknown> | null>(null)
  const [processRun, setProcessRun] = useState<ProcessRun | null>(null)
  const [rawChatImportRun, setRawChatImportRun] = useState<RawChatImportRun | null>(null)
  const [wechatSourcesRun, setWechatSourcesRun] = useState<WechatSourcesRun | null>(null)
  const [, setCreateHypothesisRun] = useState<CreateHypothesisRun | null>(null)
  const [supplementRun, setSupplementRun] = useState<SupplementRun | null>(null)
  const [supplementDraftRun, setSupplementDraftRun] = useState<SupplementDraftRun | null>(null)
  const [inboxStatus, setInboxStatus] = useState<InboxStatus | null>(null)
  const [agenticRun, setAgenticRun] = useState<Record<string, unknown> | null>(null)
  const [selfQuestionStatus, setSelfQuestionStatus] = useState<Record<string, unknown> | null>(null)
  const [selfQuestionLoop, setSelfQuestionLoop] = useState<Record<string, unknown> | null>(null)
  const [autoresearchStatus, setAutoresearchStatus] = useState<Record<string, unknown> | null>(null)
  const [autoresearchLedger, setAutoresearchLedger] = useState<Record<string, unknown> | null>(null)
  const [policyProposal, setPolicyProposal] = useState<Record<string, unknown> | null>(null)
  const [selfTrainNext, setSelfTrainNext] = useState<Record<string, unknown> | null>(null)
  const [selfTrainPlan, setSelfTrainPlan] = useState<Record<string, unknown> | null>(null)
  const [exportSamples, setExportSamples] = useState<Record<string, unknown> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastRunAt, setLastRunAt] = useState<string | null>(null)
  const [lastDryRunSince, setLastDryRunSince] = useState<string | null>(null)
  const [ignoredSignalKeys, setIgnoredSignalKeys] = useState<Set<string>>(() => new Set())
  const [ignoredSignalNotice, setIgnoredSignalNotice] = useState<{ title: string; detail: string } | null>(null)
  const [signalActionFeedbackByKey, setSignalActionFeedbackByKey] = useState<Record<string, SignalActionFeedbackState>>({})
  const [latestSignalActionFeedback, setLatestSignalActionFeedback] = useState<SignalActionFeedbackState | null>(null)
  const [statusUpdateNoticeTitle, setStatusUpdateNoticeTitle] = useState("")
  const [adoptedCandidateKeys, setAdoptedCandidateKeys] = useState<Set<string>>(() => new Set())
  const [nextAutoScanAt, setNextAutoScanAt] = useState<number | null>(null)
  const [autoTick, setAutoTick] = useState(() => Date.now())
  const runningRef = useRef(false)
  const logSeqRef = useRef(0)
  const lastAutoSourceSignatureRef = useRef("")
  const lastDryRunScanKeyRef = useRef("")
  const askResultRef = useRef<HTMLElement | null>(null)
  const signalTodoListRef = useRef<HTMLDivElement | null>(null)
  const supplementSectionRef = useRef<HTMLElement | null>(null)

  const jumpToAskResult = useCallback(() => {
    setAskResultLocatedAt(Date.now())
    askResultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
  }, [])

  const jumpToAskResultSection = useCallback((section: ReturnType<typeof buildAskResultMiniIndex>[number]["id"]) => {
    setAskResultLocatedAt(Date.now())
    if (typeof document === "undefined") return
    document.getElementById(`ask-result-${section}`)?.scrollIntoView({ behavior: "smooth", block: "start" })
  }, [])

  const projectPath = project?.path ?? ""
  const summary = dashboardRun?.dashboard?.summary
  const dryRunAlerts = watchRun?.dryRun ? watchRun.alerts ?? [] : []
  const dryRunEvents = watchRun?.dryRun ? watchRun.events ?? [] : []
  const openAlerts = dashboardRun?.dashboard?.openAlerts?.slice(0, 6) ?? []
  const currentScanKey = buildScanKey({
    rawChatSource,
    since,
    hypothesisId: selectedHypothesisId,
  })
  const canConfirmAlerts = dryRunAlerts.length > 0 && lastDryRunSince === since && lastDryRunScanKeyRef.current === currentScanKey
  const candidateHypotheses = watchRun?.candidateHypotheses ?? []
  const discoveryCandidates = discoverRun?.candidates ?? []
  const visibleCandidateHypotheses = useMemo(() => {
    const seen = new Set<string>()
    return [...discoveryCandidates, ...candidateHypotheses].filter((item, index) => {
      if (isWeakSignalTitle(item.title)) return false
      const key = candidateWorkbenchKey(item) || `${textValue(item.title, "")}:${index}`
      if (adoptedCandidateKeys.has(key)) return false
      if (ignoredSignalKeys.has(key)) return false
      if (seen.has(key)) return false
      seen.add(key)
      return true
    }).sort((a, b) => candidateActionScore(b) - candidateActionScore(a)
      || textValue(a.title, "").localeCompare(textValue(b.title, "")))
  }, [adoptedCandidateKeys, candidateHypotheses, discoveryCandidates, ignoredSignalKeys])
  const evidenceGaps = dashboardRun?.dashboard?.evidenceGapSummary ?? []
  const selfQuestionCounts = recordValue(selfQuestionStatus?.counts)
  const autoresearchCounts = recordValue(autoresearchStatus?.counts)
  const selfTrainActions = countArray(selfTrainNext?.actions)
  const proposalItems = countArray(policyProposal?.proposals) || countArray(policyProposal?.proposalItems) || countArray(policyProposal?.policyProposals)
  const exportEntries = numberValue(exportSamples?.returned) || countArray(exportSamples?.entries)
  const agenticSourceCount = countArray(agenticRun?.sources)
  const loopStageCount = countArray(selfQuestionLoop?.stages)
  const trainingPlanItemCount = countArray(selfTrainPlan?.actions ?? selfTrainPlan?.planItems ?? selfTrainPlan?.items)
  const proposalList = firstArray(policyProposal, ["proposals", "proposalItems", "policyProposals"])
  const selfTrainActionList = firstArray(selfTrainNext, ["actions", "items"])
  const experimentList = firstArray(autoresearchLedger, ["entries", "experiments", "records"])
  const rawChatFiles = rawChatImportRun?.summary?.filesScanned ?? 0
  const rawChatMessages = rawChatImportRun?.summary?.messagesExtracted ?? 0
  const rawChatRecordsWritten = rawChatImportRun?.summary?.recordsWritten ?? 0
  const hypothesisRows = dashboardRun?.dashboard?.hypotheses ?? []
  const hypothesisSignalsById = useMemo(() => Object.fromEntries(
    hypothesisRows
      .map((item) => [textValue(item.id, ""), latestSignalForHypothesis(item, watchRun)] as const)
      .filter(([id]) => Boolean(id)),
  ), [hypothesisRows, watchRun])
  const workbenchHypothesisRows = useMemo(
    () => buildHypothesisWorkbenchRows(hypothesisRows, hypothesisSignalsById),
    [hypothesisRows, hypothesisSignalsById],
  )
  const wechatSourceCandidates = wechatSourcesRun?.sources ?? []
  const selectedWechatSource = wechatSourceCandidates.find((item) => textValue(item.sourceRef, "") === rawChatSource || textValue(item.sourcePath, "") === rawChatSource) ?? null
  const todaySourceFound = wechatSourcesRun?.summary?.todayFound ?? Boolean(selectedWechatSource?.isToday)
  const usingRecentWechatFallback = Boolean(wechatSourcesRun && selectedWechatSource && !todaySourceFound && !selectedWechatSource.isToday)
  const signalTodos = useMemo(() => buildSignalTodos({
    watchRun,
    hypothesisRows,
    ignoredKeys: ignoredSignalKeys,
  }), [ignoredSignalKeys, hypothesisRows, watchRun])
  const hasSupplementBody = supplementBody.trim().length > 0
  const hasLlmSupplementDraft = Boolean(supplementDraftRun?.draft)
  const canCreateHypothesis = hypothesisTitle.trim().length > 0
  const selectedHypothesis = hypothesisRows.find((item) => textValue(item.id, "") === selectedHypothesisId)
  const selectedHypothesisTitle = textValue(selectedHypothesis?.title, selectedHypothesisId || "全部假设")
  const selectedSignal = selectedHypothesis ? latestSignalForHypothesis(selectedHypothesis, watchRun) : null
  const selectedTimelineBrief = useMemo(
    () => selectedHypothesis ? buildHypothesisTimelineBrief(selectedHypothesis, selectedSignal, { limit: 5 }) : null,
    [selectedHypothesis, selectedSignal],
  )
  const selectedWikiFrameCopy = useMemo(() => {
    if (!selectedHypothesis) {
      return buildWikiFrameFirstLookCopy(buildWikiFrameDecisionLine({ pages: [] }))
    }
    const signalPages = arrayRecords(selectedSignal?.relatedWikiPages)
    const pages = signalPages.length ? signalPages : selectedHypothesis.relatedWikiPages
    return buildWikiFrameFirstLookCopy(buildWikiFrameDecisionLine({
      pages,
      evidenceDelta: selectedSignal?.evidenceDelta,
      signalType: selectedSignal?.signalType,
      askDeepDiveRecommended: Boolean(selectedSignal?.askDeepDiveRecommended),
    }))
  }, [selectedHypothesis, selectedSignal])
  const selectedTimelineCanConfirm = Boolean(
    selectedHypothesis
      && selectedSignal
      && selectedSignal.suggestedStatus
      && selectedSignal.suggestedStatus !== textValue(selectedHypothesis.status, ""),
  )
  const selectedHypothesisFeedback = useMemo(() => {
    const items = hypothesisEvidenceFeedback?.items ?? []
    if (!selectedHypothesisId) return items[0] ?? null
    return items.find((item) => textValue(item.hypothesisId, "") === selectedHypothesisId) ?? items[0] ?? null
  }, [hypothesisEvidenceFeedback, selectedHypothesisId])
  const selectedPostMortemDraft = useMemo(() => {
    const drafts = hypothesisPostMortemRun?.drafts ?? []
    if (!selectedHypothesisId) return drafts[0] ?? null
    return drafts.find((item) => textValue(item.hypothesisId, "") === selectedHypothesisId) ?? drafts[0] ?? null
  }, [hypothesisPostMortemRun, selectedHypothesisId])
  const runningStage = stages.find((stage) => stage.status === "running")
  const hasRunningAskActionFeedback = useMemo(
    () => Object.values(signalActionFeedbackByKey).some((item) => (
      item.status === "running" && (item.action === "ask" || item.action === "precheck")
    )),
    [signalActionFeedbackByKey],
  )
  const askDeepDivePending = shouldShowAskPendingPanel({
    optimisticPending: askPendingRequested,
    hasRunningAskAction: hasRunningAskActionFeedback,
    running,
    runningStageId: runningStage?.id,
    pendingTitle: pendingAskTitle,
    hasResult: Boolean(hypothesisAskRun),
  })
  const latestLog = activityLog[0]
  const pendingAlertCount = dryRunAlerts.length || openAlerts.length
  const scannedSourceCount = watchRun?.summary?.sourcesScanned ?? 0
  const matchedHypothesisCount = watchRun?.summary?.matchedHypotheses ?? 0
  const newMessageCount = processRun?.summary?.messagesWritten ?? rawChatRecordsWritten
  const prioritySignalTodos = signalTodos.filter(isPriorityTodo)
  const priorityCandidateHypotheses = visibleCandidateHypotheses.filter(isPriorityCandidate)
  const pendingWorkbenchCount = prioritySignalTodos.length + priorityCandidateHypotheses.length
  const confirmableTodoCount = signalTodos.filter(todoCanConfirm).length
  const askRecommendedCount = prioritySignalTodos.filter((todo) => todo.signal.askDeepDiveRecommended || Boolean(todo.hypothesis)).length
    + priorityCandidateHypotheses.filter((item) => Boolean(item.askDeepDiveRecommended)).length
  const topSignalDecisionModel = useMemo(() => buildSignalQueueDecisionViewModel({
    items: buildSignalQueueDecisionItems(signalTodos, visibleCandidateHypotheses),
  }), [signalTodos, visibleCandidateHypotheses])
  const topPmOpeningBrief = topSignalDecisionModel.openingBrief
  const dailyStatusActionFeedback = useMemo(
    () => buildDailyStatusActionFeedback(latestSignalActionFeedback ?? {}),
    [latestSignalActionFeedback],
  )
  const autoScanSeconds = nextAutoScanAt ? Math.max(0, Math.ceil((nextAutoScanAt - autoTick) / 1000)) : null
  const askDeepDiveSummary = useMemo(() => buildAskDeepDiveSummary(hypothesisAskRun?.answer), [hypothesisAskRun])
  const askResultIsPrecheck = hypothesisAskRun?.mode === "candidate-precheck"
  const askAnswerText = textValue(hypothesisAskRun?.answer, "")
  const askNavigationSourceCount = Math.max(countArray(hypothesisAskRun?.sources?.navigation), countArray(hypothesisAskRun?.navigation))
  const askWikiSourceCount = Math.max(countArray(hypothesisAskRun?.sources?.wiki), countArray(hypothesisAskRun?.wikiResults))
  const askRawSourceCount = Math.max(countArray(hypothesisAskRun?.sources?.raw), countArray(hypothesisAskRun?.rawResults))
  const askFactsSourceCount = Math.max(countArray(hypothesisAskRun?.sources?.facts), countArray(hypothesisAskRun?.factsResults))
  const askBrainSourceCount = Math.max(countArray(hypothesisAskRun?.sources?.brain), countArray(hypothesisAskRun?.brainResults))
  const askStockDailySourceCount = Math.max(countArray(hypothesisAskRun?.sources?.stockDaily), countArray(hypothesisAskRun?.stockDailyResults))
  const askSourceSnapshot = useMemo(() => buildAskSourceSnapshot({
    navigation: countArray(hypothesisAskRun?.sources?.navigation) > 0 ? hypothesisAskRun?.sources?.navigation : hypothesisAskRun?.navigation,
    wiki: countArray(hypothesisAskRun?.sources?.wiki) > 0 ? hypothesisAskRun?.sources?.wiki : hypothesisAskRun?.wikiResults,
    raw: countArray(hypothesisAskRun?.sources?.raw) > 0 ? hypothesisAskRun?.sources?.raw : hypothesisAskRun?.rawResults,
    facts: countArray(hypothesisAskRun?.sources?.facts) > 0 ? hypothesisAskRun?.sources?.facts : hypothesisAskRun?.factsResults,
    brain: countArray(hypothesisAskRun?.sources?.brain) > 0 ? hypothesisAskRun?.sources?.brain : hypothesisAskRun?.brainResults,
    stockDaily: countArray(hypothesisAskRun?.sources?.stockDaily) > 0 ? hypothesisAskRun?.sources?.stockDaily : hypothesisAskRun?.stockDailyResults,
    query: hypothesisAskRun?.query,
    hasAnswer: Boolean(askAnswerText),
  }), [askAnswerText, hypothesisAskRun])
  const askEvidenceStrength = useMemo(() => buildAskEvidenceStrength({
    summary: askDeepDiveSummary,
    hasAnswer: Boolean(askAnswerText),
    wikiSourceCount: askWikiSourceCount,
    rawSourceCount: askRawSourceCount,
    stockDailySourceCount: askStockDailySourceCount,
  }), [askAnswerText, askDeepDiveSummary, askRawSourceCount, askStockDailySourceCount, askWikiSourceCount])
  const askObservationChecklist = useMemo(() => buildAskObservationChecklist(askDeepDiveSummary), [askDeepDiveSummary])
  const askDecisionSnapshot = useMemo(() => buildAskDecisionSnapshot(askDeepDiveSummary), [askDeepDiveSummary])
  const askWikiFrameHint = useMemo(
    () => buildAskWikiFrameHint(hypothesisAskRun?.sources?.wiki ?? hypothesisAskRun?.wikiResults),
    [hypothesisAskRun],
  )
  const askSummaryTiles = useMemo(() => buildAskSummaryTileValues(askDeepDiveSummary), [askDeepDiveSummary])
  const askAnswerMissing = Boolean(hypothesisAskRun && !askAnswerText)
  const askReturnedSourceCount = countAskResultSources(hypothesisAskRun)
  const askResultMiniIndex = useMemo(() => buildAskResultMiniIndex({
    pending: askDeepDivePending,
    isPrecheck: askResultIsPrecheck,
    summary: askDeepDiveSummary,
    sourceCount: askReturnedSourceCount,
    hasAnswer: Boolean(askAnswerText),
  }), [askAnswerText, askDeepDivePending, askDeepDiveSummary, askResultIsPrecheck, askReturnedSourceCount])
  const askResultReadingGuide = useMemo(() => buildAskResultReadingGuide({
    pending: askDeepDivePending,
    isPrecheck: askResultIsPrecheck,
    summary: askDeepDiveSummary,
    sourceCount: askReturnedSourceCount,
    hasAnswer: Boolean(askAnswerText),
  }), [askAnswerText, askDeepDivePending, askDeepDiveSummary, askResultIsPrecheck, askReturnedSourceCount])
  const askLiveTaskTicket = useMemo(() => buildAskLiveTaskTicket({
    pending: askDeepDivePending,
    hasAnswer: Boolean(askAnswerText),
    wikiSourceCount: askWikiSourceCount,
    rawSourceCount: askRawSourceCount,
    stockDailySourceCount: askStockDailySourceCount,
  }), [askAnswerText, askDeepDivePending, askRawSourceCount, askStockDailySourceCount, askWikiSourceCount])
  const askResearchTicket = useMemo(() => buildAskResearchTicket({
    summary: askDeepDiveSummary,
    evidence: askEvidenceStrength,
    checklist: askObservationChecklist,
    sourceCount: askReturnedSourceCount,
  }), [askDeepDiveSummary, askEvidenceStrength, askObservationChecklist, askReturnedSourceCount])
  const precheckAdoptionCopy = useMemo(() => buildCandidatePrecheckAdoptionCopy({
    isPrecheck: askResultIsPrecheck,
    hasCandidate: Boolean(candidateAskPrecheckSource),
    adoptedId: candidateAskPrecheckAdopted?.id,
    adoptedTitle: candidateAskPrecheckAdopted?.title,
  }), [askResultIsPrecheck, candidateAskPrecheckAdopted, candidateAskPrecheckSource])
  const askResultTitle = askResultIsPrecheck ? "3. Ask 预检结果" : "3. Ask 深挖结果"
  const askResultSubtitle = askResultIsPrecheck
    ? precheckAdoptionCopy.subtitle
    : textValue(hypothesisAskRun?.hypothesis?.title, selectedHypothesisTitle)
  const askDisplayTitle = askDeepDivePending ? pendingAskTitle || selectedHypothesisTitle : askResultSubtitle
  const askResultOriginCopy = useMemo(
    () => buildAskResultOriginCopy(askResultOrigin ?? {
      kind: askResultIsPrecheck ? "candidate" : "manual",
      action: askResultIsPrecheck ? "precheck" : "ask",
      title: askDisplayTitle,
      hypothesisId: textValue(hypothesisAskRun?.hypothesis?.id, selectedHypothesisId),
    }),
    [askDisplayTitle, askResultIsPrecheck, askResultOrigin, hypothesisAskRun?.hypothesis?.id, selectedHypothesisId],
  )
  const askFollowUpAction = useMemo(() => buildAskFollowUpAction({
    summary: askDeepDiveSummary,
    evidence: askEvidenceStrength,
    title: askDisplayTitle,
    isPrecheck: askResultIsPrecheck,
    hasAnswer: Boolean(askAnswerText),
    canRetry: askResultIsPrecheck ? Boolean(candidateAskPrecheckSource) : Boolean(hypothesisAskRun?.hypothesis),
  }), [askAnswerText, askDeepDiveSummary, askDisplayTitle, askEvidenceStrength, askResultIsPrecheck, candidateAskPrecheckSource, hypothesisAskRun?.hypothesis])
  const askStructureFeedback = useMemo(() => buildAskStructureFeedback({
    summary: askDeepDiveSummary,
    sourceCount: askReturnedSourceCount,
    hasAnswer: Boolean(askAnswerText),
  }), [askAnswerText, askDeepDiveSummary, askReturnedSourceCount])
  const askObservationDraft = useMemo(() => buildObservationQueueDraft({
    checklist: askObservationChecklist,
    hypothesisId: textValue(hypothesisAskRun?.hypothesis?.id, selectedHypothesisId),
    hypothesisTitle: askDisplayTitle,
    wikiFrameHint: askWikiFrameHint,
    askQuery: hypothesisAskRun?.query,
  }), [askDisplayTitle, askObservationChecklist, askWikiFrameHint, hypothesisAskRun?.hypothesis?.id, hypothesisAskRun?.query, selectedHypothesisId])
  const askObservationQueued = observationQueue.some((item) => item.key === askObservationDraft.key)
  const askObservationSavedRun = observationDraftRuns[askObservationDraft.key]
  const askObservationDraftSavedPath = askObservationSavedRun?.writeResult?.markdownRelativePath
    ?? askObservationSavedRun?.writeResult?.jsonRelativePath
    ?? ""
  const askObservationDraftSaving = observationDraftSavingKey === askObservationDraft.key
  const askObservationActionCopy = useMemo(() => buildAskObservationActionCopy({
    checklist: askObservationChecklist,
    queued: askObservationQueued,
    saving: askObservationDraftSaving,
    savedPath: askObservationDraftSavedPath,
  }), [askObservationChecklist, askObservationDraftSavedPath, askObservationDraftSaving, askObservationQueued])
  const askResultActionGuide = useMemo(() => buildAskResultActionGuide({
    observation: askObservationActionCopy,
    followUp: askFollowUpAction,
    structure: askStructureFeedback,
  }), [askFollowUpAction, askObservationActionCopy, askStructureFeedback])
  const askPanelCopy = useMemo(() => buildAskResultPanelCopy({
    pending: askDeepDivePending,
    isPrecheck: askResultIsPrecheck,
    title: askDisplayTitle,
    sourceCount: askReturnedSourceCount,
    hasAnswer: Boolean(askAnswerText),
    summary: askDeepDiveSummary,
  }), [askAnswerText, askDeepDivePending, askDeepDiveSummary, askDisplayTitle, askResultIsPrecheck, askReturnedSourceCount])
  const askAnswerPanelCopy = useMemo(() => buildAskAnswerPanelCopy({
    pending: askDeepDivePending,
    isPrecheck: askResultIsPrecheck,
    sourceCount: askReturnedSourceCount,
    hasAnswer: Boolean(askAnswerText),
  }), [askAnswerText, askDeepDivePending, askResultIsPrecheck, askReturnedSourceCount])
  const askErrorVisible = Boolean(askErrorState && !askDeepDivePending && !hypothesisAskRun)
  const askReuseCopy = useMemo(() => buildAskResultReuseCopy({
    reused: Boolean(reusedAskCache),
    title: askDisplayTitle,
    cachedAt: reusedAskCache?.cachedAt,
    sourceCount: askReturnedSourceCount,
  }), [askDisplayTitle, askReturnedSourceCount, reusedAskCache])
  const askJumpCopy = useMemo(() => buildAskResultJumpCopy({
    pending: askDeepDivePending,
    isPrecheck: askResultIsPrecheck,
    title: askDisplayTitle,
    sourceCount: askReturnedSourceCount,
    hasAnswer: Boolean(askAnswerText),
    summary: askDeepDiveSummary,
    errorMessage: askErrorVisible ? askErrorState?.message : "",
  }), [askAnswerText, askDeepDivePending, askDeepDiveSummary, askDisplayTitle, askErrorState?.message, askErrorVisible, askResultIsPrecheck, askReturnedSourceCount])
  const askLocatorCopy = useMemo(() => buildAskResultLocatorCopy({
    pending: askDeepDivePending,
    isPrecheck: askResultIsPrecheck,
    title: askDisplayTitle,
    sourceCount: askReturnedSourceCount,
    hasAnswer: Boolean(askAnswerText),
    reused: Boolean(reusedAskCache),
    summary: askDeepDiveSummary,
  }), [askAnswerText, askDeepDivePending, askDeepDiveSummary, askDisplayTitle, askResultIsPrecheck, askReturnedSourceCount, reusedAskCache])
  const askLocatedNoticeCopy = useMemo(() => buildAskResultLocatedNoticeCopy({
    located: Boolean(askResultLocatedAt),
    pending: askDeepDivePending,
    isPrecheck: askResultIsPrecheck,
    sourceCount: askReturnedSourceCount,
    hasAnswer: Boolean(askAnswerText),
    reused: Boolean(reusedAskCache),
  }), [askAnswerText, askDeepDivePending, askResultIsPrecheck, askReturnedSourceCount, askResultLocatedAt, reusedAskCache])
  const statusUpdateNotice = useMemo(() => buildStatusUpdateNoticeCopy({
    title: statusUpdateNoticeTitle || selectedHypothesisTitle || statusUpdateRun?.hypothesisId,
    previousStatus: statusUpdateRun?.previousStatus,
    newStatus: statusUpdateRun?.newStatus,
    markdownRelativePath: statusUpdateRun?.writeResult?.markdownRelativePath,
    eventRelativePath: statusUpdateRun?.writeResult?.eventRelativePath,
    askRunRef: statusUpdateRun?.askRunRef,
  }), [selectedHypothesisTitle, statusUpdateNoticeTitle, statusUpdateRun])
  useEffect(() => {
    setObservationChecklistCopied(false)
  }, [askObservationChecklist.copyText])
  useEffect(() => {
    setAskFollowUpCopied(false)
  }, [askFollowUpAction.prompt])
  const copyAskObservationChecklist = useCallback(() => {
    if (!askObservationChecklist.copyText || typeof navigator === "undefined" || !navigator.clipboard) return
    void navigator.clipboard.writeText(askObservationChecklist.copyText).then(() => {
      setObservationChecklistCopied(true)
    })
  }, [askObservationChecklist.copyText])
  const copyAskFollowUpPrompt = useCallback(() => {
    if (!askFollowUpAction.prompt || typeof navigator === "undefined" || !navigator.clipboard) return
    void navigator.clipboard.writeText(askFollowUpAction.prompt).then(() => {
      setAskFollowUpCopied(true)
    })
  }, [askFollowUpAction.prompt])
  const addAskObservationToQueue = useCallback(() => {
    if (!askObservationChecklist.show) return
    const draft = { ...askObservationDraft, createdAt: new Date().toISOString() }
    setObservationQueue((items) => upsertObservationQueue(items, draft))
  }, [askObservationChecklist.show, askObservationDraft])
  const scanScopeSummary = useMemo(() => buildScanScopeSummary({
    selectedId: selectedHypothesisId,
    selectedTitle: selectedHypothesisTitle,
  }), [selectedHypothesisId, selectedHypothesisTitle])
  const scanModeSummary = useMemo(() => buildScanModeSummary({
    autoRefresh,
    scoped: Boolean(selectedHypothesisId),
  }), [autoRefresh, selectedHypothesisId])
  const signalSourceCapability = useMemo(() => buildSignalSourceCapabilityCopy(watchRun?.summary), [watchRun?.summary])
  const signalSourcePresets = useMemo(() => buildDefaultSignalSourcePresets(), [])
  const observationReviewBrief = useMemo(() => (
    buildObservationReviewBrief(observationDraftList?.drafts ?? [])
  ), [observationDraftList?.drafts])
  const reviewRunningKind = useMemo(() => {
    if (!running) return ""
    const stageId = textValue(runningStage?.id, "")
    const stageLabel = textValue(runningStage?.label, "")
    if (stageLabel.includes("LLM复核")) return "llm"
    if (stageId === "ingest" || stageId === "hypothesis" || stageId === "validation" || stageLabel.includes("扫描") || stageLabel.includes("导入") || stageLabel.includes("微信")) return "scan"
    return "operation"
  }, [running, runningStage])
  const reviewModeSummary = useMemo(() => buildReviewModeSummary({
    llmReviewStatus: watchRun?.summary?.llmReviewStatus ?? watchRun?.llmReview?.status,
    llmReviewReason: watchRun?.llmReview?.reason,
    llmReviewError: watchRun?.llmReview?.error,
    autoRefresh,
    running,
    runningKind: reviewRunningKind,
    ruleResultCount: pendingWorkbenchCount,
  }), [autoRefresh, pendingWorkbenchCount, reviewRunningKind, running, watchRun])
  const scanProgress = useMemo(() => buildScanProgressSummary({
    stages,
    running,
    sourceCount: scannedSourceCount,
    newMessageCount,
    matchedCount: matchedHypothesisCount,
    pendingCount: pendingWorkbenchCount,
  }), [matchedHypothesisCount, newMessageCount, pendingWorkbenchCount, running, scannedSourceCount, stages])
  const nextActionText = running
    ? `正在${runningStage?.label ?? "运行"}`
    : selectedSignal && selectedHypothesis && selectedSignal.suggestedStatus !== textValue(selectedHypothesis.status, "")
      ? `建议状态：${hypothesisStatusTransitionLabel(selectedHypothesis.status, selectedSignal.suggestedStatus)}`
      : canConfirmAlerts
      ? "发现可写入的状态变化，下一步点“确认更新状态”"
      : pendingAlertCount > 0
        ? "已有 alerts，先复核后确认"
        : "下一步点“扫描新增资料”或开启自动跟踪"
  const watchAnswer = useMemo(() => buildWatchAnswer({
    watchRun,
    selectedTitle: selectedHypothesisTitle,
    canConfirmAlerts,
    displayableCandidateCount: visibleCandidateHypotheses.length,
  }), [canConfirmAlerts, selectedHypothesisTitle, visibleCandidateHypotheses.length, watchRun])

  useEffect(() => {
    if (!askResultLocatedAt) return
    const timer = window.setTimeout(() => setAskResultLocatedAt(0), 3500)
    return () => window.clearTimeout(timer)
  }, [askResultLocatedAt])

  useEffect(() => {
    if (!askDeepDivePending && !hypothesisAskRun && !askErrorVisible) return
    const timer = window.setTimeout(() => {
      jumpToAskResult()
    }, 80)
    return () => window.clearTimeout(timer)
  }, [askDeepDivePending, askErrorVisible, hypothesisAskRun, jumpToAskResult])

  useEffect(() => {
    if (!ignoredSignalNotice) return
    const timer = window.setTimeout(() => setIgnoredSignalNotice(null), 5000)
    return () => window.clearTimeout(timer)
  }, [ignoredSignalNotice])

  const setStage = useCallback((id: string, status: StageStatus, detail?: string) => {
    setStages((current) => current.map((stage) => stage.id === id ? { ...stage, status, detail } : stage))
  }, [])

  const appendLog = useCallback((stage: string, status: ActivityLogEntry["status"], detail: string) => {
    const entry: ActivityLogEntry = {
      id: ++logSeqRef.current,
      at: new Date().toLocaleTimeString(),
      stage,
      status,
      detail,
    }
    setActivityLog((current) => [entry, ...current].slice(0, 60))
  }, [])

  const markSignalActionFeedback = useCallback((
    key: string,
    action: string,
    status: "running" | "done" | "error",
    title?: string,
    detail?: string,
    extras?: Partial<Omit<SignalActionFeedbackState, "action" | "status" | "title" | "detail">>,
  ) => {
    if (!key) return
    const next = { action, status, title, detail, ...extras }
    setLatestSignalActionFeedback(next)
    setSignalActionFeedbackByKey((current) => ({
      ...current,
      [key]: next,
    }))
  }, [])

  const buildAskActionFeedbackExtras = useCallback((run: HypothesisAskRun | null) => {
    if (!run) return undefined
    const summary = buildAskDeepDiveSummary(run.answer)
    return {
      askSummary: summary,
      askDecision: buildAskDecisionSnapshot(summary),
      sourceCount: countAskResultSources(run),
    }
  }, [])

  const refreshObservationDrafts = useCallback(async () => {
    if (!projectPath) return
    setObservationDraftListLoading(true)
    try {
      const result = await runResearchCockpitCommand<ObservationDraftListRun>(projectPath, "observation-draft-list", ["--limit", "8"])
      setObservationDraftList(result)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      appendLog("读取观察草稿失败", "error", message.slice(0, 180))
    } finally {
      setObservationDraftListLoading(false)
    }
  }, [appendLog, projectPath])

  useEffect(() => {
    void refreshObservationDrafts()
  }, [refreshObservationDrafts])

  const saveObservationDraft = useCallback(async (item: ObservationQueueDraft) => {
    if (!projectPath || observationDraftSavingKey) return
    setObservationDraftSavingKey(item.key)
    setError(null)
    try {
      const args = [
        "--title",
        item.title,
        "--stocks",
        item.stocks,
        "--ranking",
        item.ranking,
        "--gap",
        item.gap,
        "--next-action",
        item.nextAction,
        "--ask-query",
        item.askQuery,
        "--copy-text",
        item.copyText,
      ]
      if (item.hypothesisId) args.push("--hypothesis-id", item.hypothesisId)
      if (item.wikiFrameLabel) args.push("--wiki-frame-label", item.wikiFrameLabel)
      if (item.wikiFrameSourceRef) args.push("--wiki-frame-source-ref", item.wikiFrameSourceRef)
      if (item.wikiFrameMetaLine) args.push("--wiki-frame-meta-line", item.wikiFrameMetaLine)
      if (item.sourceRefs.length) args.push("--source-refs", item.sourceRefs.join(","))
      const result = await runResearchCockpitCommand<ObservationDraftRun>(projectPath, "observation-draft-write", args)
      setObservationDraftRuns((current) => ({ ...current, [item.key]: result }))
      appendLog("保存观察草稿", "done", result.writeResult?.markdownRelativePath ?? result.writeResult?.jsonRelativePath ?? item.title)
      void refreshObservationDrafts()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      appendLog("保存观察草稿失败", "error", message.slice(0, 180))
    } finally {
      setObservationDraftSavingKey("")
    }
  }, [appendLog, observationDraftSavingKey, projectPath, refreshObservationDrafts])

  const runAskObservationPrimaryAction = useCallback(() => {
    if (!askObservationActionCopy.canPrimary) return
    if (askObservationActionCopy.primaryAction === "queue") {
      addAskObservationToQueue()
      return
    }
    if (askObservationActionCopy.primaryAction === "save") {
      void saveObservationDraft(askObservationDraft)
    }
  }, [addAskObservationToQueue, askObservationActionCopy.canPrimary, askObservationActionCopy.primaryAction, askObservationDraft, saveObservationDraft])
  const runAskResultGuidePrimaryAction = useCallback(() => {
    if (askResultActionGuide.primaryTarget === "observation") {
      if (askObservationActionCopy.canPrimary) {
        runAskObservationPrimaryAction()
        return
      }
      if (typeof document !== "undefined") {
        document.getElementById("ask-result-observation-action")?.scrollIntoView({ behavior: "smooth", block: "center" })
      }
      return
    }
    if (askResultActionGuide.primaryTarget === "followup") {
      copyAskFollowUpPrompt()
      return
    }
    jumpToAskResultSection(askResultActionGuide.primaryTarget)
  }, [askObservationActionCopy.canPrimary, askResultActionGuide.primaryTarget, copyAskFollowUpPrompt, jumpToAskResultSection, runAskObservationPrimaryAction])

  const selectHypothesis = useCallback((id: string, title?: string) => {
    setSelectedHypothesisId(id)
    setSupplementHypothesisId(id)
    appendLog("选择假设", "done", id ? `${title || id}` : "全部假设")
  }, [appendLog])

  const toggleSupplementSource = useCallback((id: string) => {
    setSelectedSupplementSources((current) => (
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id]
    ))
    setSupplementDraftRun(null)
  }, [])

  const prepareSupplementForGap = useCallback((gapCode: string) => {
    const gap = describeEvidenceGap(gapCode)
    setSelectedSupplementSources((current) => [...new Set([...current, ...gap.sourceIds])])
    setSupplementHypothesisId(selectedHypothesisId)
    setSupplementTitle(`补充资料：${gap.label}`)
    setSupplementKind(gap.code.startsWith("market:") ? "financial_market" : gap.code.includes("tender") || gap.code.includes("orders") ? "tender_order" : "manual")
    setSupplementRefs(gap.sources.join(", "))
    setSupplementBody([
      `请围绕假设「${selectedHypothesisTitle}」补证：${gap.label}`,
      "",
      `缺口说明：${gap.description}`,
      `需要检索/调用的数据源：${gap.sources.join("、")}`,
      "",
      "请输出：",
      "1. 找到了哪些原始证据或线索",
      "2. 这些证据支持、反驳，还是只能算叙事扩散",
      "3. 仍缺什么硬证据",
      "4. 是否影响假设状态",
      "",
      gap.prompt,
    ].join("\n"))
    setSupplementDraftRun(null)
    appendLog("准备补证", "done", `${gap.label} -> ${gap.sources.join(", ")}`)
  }, [appendLog, selectedHypothesisId, selectedHypothesisTitle])

  const prepareHypothesisDefinitionDraft = useCallback((hypothesis: Record<string, unknown>) => {
    const qualityBrief = buildHypothesisQualityBrief(hypothesis)
    const draft = buildHypothesisDefinitionDraft(hypothesis, qualityBrief)
    setShowAdvanced(true)
    setSelectedSupplementSources((current) => [...new Set([...current, ...draft.selectedSourceIds])])
    setSupplementHypothesisId(textValue(hypothesis.id, ""))
    setSupplementTitle(draft.title)
    setSupplementKind(draft.kind)
    setSupplementRefs(draft.sourceRefs)
    setSupplementBody(draft.body)
    setSupplementDraftRun(null)
    appendLog("准备补定义", "done", `${textValue(hypothesis.title, textValue(hypothesis.id, "假设"))}：${qualityBrief.headline}`)
    if (typeof window !== "undefined") {
      window.setTimeout(() => {
        supplementSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
      }, 0)
    }
  }, [appendLog])

  const runStep = useCallback(async <T,>(
    stageId: string,
    label: string,
    action: ResearchCockpitAction,
    args: string[],
    onSuccess: (result: T) => void,
    summarize: (result: T) => string,
  ) => {
    setStage(stageId, "running", label)
    appendLog(label, "running", "开始")
    const result = await runResearchCockpitCommand<T>(projectPath, action, args)
    onSuccess(result)
    const summaryText = summarize(result)
    setStage(stageId, "done", summaryText)
    appendLog(label, "done", summaryText)
    return result
  }, [appendLog, projectPath, setStage])

  const loadSignalSourceCandidates = useCallback(async (
    sources: string[] = ["raw/微信聊天"],
    applyDefault = false,
    preferredSource = "",
  ) => {
    if (!projectPath) return null
    try {
      const results = await Promise.allSettled(sources.map((source) => (
        runResearchCockpitCommand<WechatSourcesRun>(projectPath, "wechat-source-list", [
          "--source",
          source,
          "--limit",
          "20",
        ])
      )))
      const successfulRuns = results
        .filter((r): r is PromiseFulfilledResult<WechatSourcesRun> => r.status === "fulfilled")
        .map((r) => r.value)
      const firstRejected = results.find((r): r is PromiseRejectedResult => r.status === "rejected")
      const result = mergeSignalSourceListRuns(successfulRuns, { preferredSource }) as WechatSourcesRun
      setWechatSourcesRun(result)
      const defaultRef = textValue(result.defaultSourceRef, "")
      if (applyDefault && defaultRef) {
        setRawChatSource(defaultRef)
      }
      if (firstRejected && successfulRuns.length === 0) {
        throw firstRejected.reason instanceof Error ? firstRejected.reason : new Error(String(firstRejected.reason))
      }
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      appendLog("资料源列表失败", "error", message.slice(0, 180))
      return null
    }
  }, [appendLog, projectPath])

  const loadWechatSources = useCallback(async (source = "raw/微信聊天", applyDefault = false) => (
    loadSignalSourceCandidates([source], applyDefault, source)
  ), [loadSignalSourceCandidates])

  const loadCurrentSignalSourceCandidates = useCallback(() => {
    const root = resolveSignalSourceCandidateRoot(rawChatSource.trim(), signalSourcePresets)
    void loadSignalSourceCandidates([root], true, root)
  }, [loadSignalSourceCandidates, rawChatSource, signalSourcePresets])

  const chooseWechatSource = useCallback(async (directory = false) => {
    try {
      const selected = await open({
        directory,
        multiple: false,
        filters: directory ? undefined : [
          { name: "Signal source", extensions: ["md", "markdown", "txt", "json", "jsonl"] },
        ],
      })
      if (typeof selected !== "string" || !selected.trim()) return
      setRawChatSource(selected)
      appendLog("选择资料源", "done", selected)
      if (directory) {
        await loadWechatSources(selected)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      appendLog("选择资料源失败", "error", message.slice(0, 180))
    }
  }, [appendLog, loadWechatSources])

  const ignoreSignalTodo = useCallback((key: string, title?: string) => {
    setIgnoredSignalKeys((current) => new Set([...current, key]))
    const notice = buildIgnoredSignalNoticeCopy(title)
    setIgnoredSignalNotice(notice)
    appendLog("忽略信号", "done", notice.detail)
  }, [appendLog])

  const createHypothesis = useCallback(async (write = true) => {
    if (!projectPath || runningRef.current) return
    if (!hypothesisTitle.trim()) {
      setError("请先写一条假设。")
      return
    }
    runningRef.current = true
    setRunning(true)
    setError(null)
    try {
      const args = [
        "--title",
        hypothesisTitle.trim(),
        "--theme",
        hypothesisTheme.trim(),
        "--segments",
        hypothesisSegments.trim(),
        "--time-horizon",
        hypothesisTimeHorizon.trim(),
        "--status",
        "watching",
      ]
      const result = await runStep<CreateHypothesisRun>(
        "hypothesis",
        write ? "创建假设" : "预览假设",
        write ? "hypothesis-create-write" : "hypothesis-create-dry-run",
        args,
        setCreateHypothesisRun,
        (run) => {
          const id = textValue((run as CreateHypothesisRun).hypothesis?.id, "")
          return run.dryRun ? `dry-run ${id}` : `已创建 ${id}`
        },
      )
      const id = textValue(result.hypothesis?.id, "")
      if (id) {
        selectHypothesis(id, textValue(result.hypothesis?.title, id))
      }
      await runStep("hypothesis", "刷新假设列表", "dashboard-data", [], setDashboardRun, (dashboardResult) => {
        const count = (dashboardResult as DashboardRun).dashboard?.summary?.hypothesisCount ?? 0
        return `${count} 条假设`
      })
      setLastRunAt(new Date().toLocaleTimeString())
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      setStage("hypothesis", "error", message.slice(0, 120))
      appendLog("创建假设失败", "error", message.slice(0, 180))
    } finally {
      runningRef.current = false
      setRunning(false)
    }
  }, [appendLog, hypothesisSegments, hypothesisTheme, hypothesisTimeHorizon, hypothesisTitle, projectPath, runStep, selectHypothesis, setStage])

  const discoverHypothesesFromWiki = useCallback(async () => {
    if (!projectPath || runningRef.current) return
    runningRef.current = true
    setRunning(true)
    setError(null)
    setStages(freshStages())
    setDiscoverRun(null)
    setIgnoredSignalKeys(new Set())
    setIgnoredSignalNotice(null)
    setStatusUpdateNoticeTitle("")
    setStatusUpdateRun(null)
    setSignalActionFeedbackByKey({})
    setActivityLog([])
    try {
      const llmConfig = useWikiStore.getState().llmConfig
      const result = await runStep<DiscoverRun>(
        "hypothesis",
        "AI 并发发现假设",
        "hypothesis-discover-dry-run",
        [
          "--theme",
          hypothesisTheme.trim() || "AI数据中心互联",
          "--question-count",
          discoveryQuestionCount.trim() || "5",
          "--concurrency",
          discoveryConcurrency.trim() || "3",
          "--sources",
          "wiki,raw,wechat_incremental,hypothesis_supplement,agentic",
          "--since",
          "3650d",
          "--timeout-ms",
          "300000",
          "--provider",
          llmConfig.provider === "codex" ? "codex" : "openai",
          "--api-key",
          llmConfig.apiKey ?? "",
          "--endpoint",
          llmConfig.customEndpoint ?? "",
          "--model",
          llmConfig.model ?? "",
        ],
        setDiscoverRun,
        (run) => `${run.summary?.questionsDesigned ?? 0} 个问题，${run.summary?.candidatesReturned ?? 0} 条候选`,
      )
      setStage("review", "done", result.candidates?.length ? "候选假设等待加入跟踪" : "暂无候选假设")
      setLastRunAt(new Date().toLocaleTimeString())
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      setStage("hypothesis", "error", message.slice(0, 120))
      appendLog("AI 发现假设失败", "error", message.slice(0, 180))
    } finally {
      runningRef.current = false
      setRunning(false)
    }
  }, [appendLog, discoveryConcurrency, discoveryQuestionCount, hypothesisTheme, projectPath, runStep, setStage])

  const runAskDeepDiveForHypothesis = useCallback(async (hypothesis: Record<string, unknown>, queryContext: Parameters<typeof buildHypothesisAskQuery>[1] = {}) => {
    const id = textValue(hypothesis.id, "")
    if (!id) return null
    const askAction = buildHypothesisAskActionLabel(queryContext)
    const askQuery = buildHypothesisAskQuery(hypothesis, queryContext)
    const cacheKey = `${id}\u0000${askQuery}`
    setHypothesisAskRun(null)
    setAskErrorState(null)
    setCandidateAskPrecheckSource(null)
    setCandidateAskPrecheckAdopted(null)
    setReusedAskCache(null)
    setPendingAskTitle(textValue(hypothesis.title, id))
    setAskPendingRequested(true)
    selectHypothesis(id, textValue(hypothesis.title, id))
    try {
      const result = await runStep<HypothesisAskRun>(
        "agentic",
        askAction.label,
        "hypothesis-ask",
        [
          "--id",
          id,
          "--query",
          askQuery,
          "--agent-concurrency",
          "3",
          "--agent-timeout-ms",
          "300000",
        ],
        (run) => {
          setHypothesisAskRun(run)
          setAskRunCacheByHypothesisId((current) => ({
            ...current,
            [cacheKey]: { run, cachedAt: new Date().toLocaleTimeString() },
          }))
          setAskPendingRequested(false)
        },
        (run) => `${countAskResultSources(run)} 个检索来源`,
      )
      appendLog(`${askAction.label}完成`, "done", textValue(result.hypothesis?.title, id))
      setLastRunAt(new Date().toLocaleTimeString())
      return result
    } finally {
      setAskPendingRequested(false)
    }
  }, [appendLog, runStep, selectHypothesis])

  const runCandidateAskPrecheck = useCallback(async (candidate: Record<string, unknown>) => {
    if (!projectPath || runningRef.current) return null
    runningRef.current = true
    setRunning(true)
    setError(null)
    const candidateTitle = textValue(candidate.title, "候选假设")
    setHypothesisAskRun(null)
    setAskErrorState(null)
    setCandidateAskPrecheckSource(null)
    setCandidateAskPrecheckAdopted(null)
    setReusedAskCache(null)
    setPendingAskTitle(candidateTitle)
    setAskPendingRequested(true)
    try {
      const query = buildCandidateAskPrecheckQuery({
        title: candidate.title,
        theme: candidate.theme,
        segments: candidate.segments,
        timeHorizon: candidate.timeHorizon,
        signalType: candidate.signalType,
        evidenceDelta: candidate.evidenceDelta,
        tradingImplication: candidate.tradingImplication,
        reason: candidate.reason ?? candidate.discoveryReason,
        sourceExcerpt: candidate.sourceExcerpt,
        sourceRef: candidate.discoverySourceRef ?? candidate.sourceRef,
        relatedWikiCount: arrayRecords(candidate.relatedWikiPages).length,
      })
      const result = await runStep<HypothesisAskRun>(
        "agentic",
        "Ask 预检",
        "candidate-ask-precheck",
        [
          "--query",
          query,
          "--agent-concurrency",
          "2",
          "--agent-timeout-ms",
          "180000",
        ],
        (run) => {
          setHypothesisAskRun({
            ...run,
            mode: "candidate-precheck",
            hypothesis: {
              title: candidateTitle,
              theme: textValue(candidate.theme, hypothesisTheme),
              segments: stringList(candidate.segments),
              status: "候选未入池",
            },
            query: textValue(run.query, query),
            sources: {
              ...(run.sources ?? {}),
              wiki: arrayRecords(run.sources?.wiki ?? run.wikiResults),
              raw: arrayRecords(run.sources?.raw ?? run.rawResults),
              stockDaily: arrayRecords(run.sources?.stockDaily ?? run.stockDailyResults),
            },
          })
          setCandidateAskPrecheckSource(candidate)
          setAskPendingRequested(false)
        },
        (run) => `${countAskResultSources(run)} 个检索来源`,
      )
      appendLog("Ask 预检完成", "done", candidateTitle)
      setLastRunAt(new Date().toLocaleTimeString())
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      setAskErrorState({
        title: candidateTitle,
        message,
        mode: "candidate-precheck",
        at: new Date().toLocaleTimeString(),
      })
      appendLog("Ask 预检失败", "error", message.slice(0, 180))
      return null
    } finally {
      setAskPendingRequested(false)
      runningRef.current = false
      setRunning(false)
    }
  }, [appendLog, hypothesisTheme, projectPath, runStep])

  const trackCandidateHypothesis = useCallback(async (candidate: Record<string, unknown>) => {
    if (!projectPath || runningRef.current) return null
    runningRef.current = true
    setRunning(true)
    setError(null)
    try {
      const result = await runStep<CreateHypothesisRun>(
        "hypothesis",
        "加入跟踪",
        "hypothesis-create-write",
        [
          "--title",
          textValue(candidate.title, ""),
          "--theme",
          textValue(candidate.theme, hypothesisTheme),
          "--segments",
          listText(candidate.segments),
          "--time-horizon",
          textValue(candidate.timeHorizon, ""),
          "--status",
          "watching",
        ],
        setCreateHypothesisRun,
        (run) => `已加入 ${textValue(run.hypothesis?.id, "")}`,
      )
      const id = textValue(result.hypothesis?.id, "")
      if (id) selectHypothesis(id, textValue(result.hypothesis?.title, id))
      await runStep("hypothesis", "刷新假设表", "dashboard-data", [], setDashboardRun, (dashboardResult) => `${(dashboardResult as DashboardRun).dashboard?.summary?.hypothesisCount ?? 0} 条假设`)
      const adoptedKey = candidateWorkbenchKey(candidate)
      if (adoptedKey) {
        setAdoptedCandidateKeys((current) => new Set([...current, adoptedKey]))
      }
      setLastRunAt(new Date().toLocaleTimeString())
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      appendLog("加入跟踪失败", "error", message.slice(0, 180))
      return null
    } finally {
      runningRef.current = false
      setRunning(false)
    }
  }, [appendLog, hypothesisTheme, projectPath, runStep, selectHypothesis])

  const adoptCandidateAskPrecheck = useCallback(async () => {
    if (!candidateAskPrecheckSource || runningRef.current) return
    const result = await trackCandidateHypothesis(candidateAskPrecheckSource)
    if (result?.hypothesis) {
      setCandidateAskPrecheckAdopted(result.hypothesis)
      setCandidateAskPrecheckSource(null)
      appendLog("预检已采纳", "done", textValue(result.hypothesis.title, result.hypothesis.id as string))
    }
  }, [appendLog, candidateAskPrecheckSource, trackCandidateHypothesis])

  const confirmHypothesisStatus = useCallback(async (hypothesis: Record<string, unknown>, signal: ReturnType<typeof latestSignalForHypothesis>) => {
    if (!projectPath || runningRef.current || !hypothesis || !signal) return null
    const id = textValue(hypothesis.id, "")
    const title = textValue(hypothesis.title, id)
    const currentStatus = textValue(hypothesis.status, "watching")
    if (!id || signal.suggestedStatus === currentStatus) {
      setError("当前没有可确认的状态变化。")
      return null
    }
    runningRef.current = true
    setRunning(true)
    setError(null)
    try {
      const askRunRef = askRunRefForStatusUpdate(hypothesisAskRun, id)
      const statusArgs = [
        "--id",
        id,
        "--status",
        signal.suggestedStatus,
        "--reason",
        signal.reason,
        "--event-ref",
        signal.eventRef || signal.sourceRef || "manual:research-cockpit-status-update",
      ]
      if (askRunRef) {
        statusArgs.push("--ask-run-ref", askRunRef)
      }
      const result = await runStep<StatusUpdateRun>(
        "review",
        "确认状态变化",
        "hypothesis-status-update-write",
        statusArgs,
        setStatusUpdateRun,
        (run) => hypothesisStatusTransitionLabel(run.previousStatus ?? currentStatus, run.newStatus ?? signal.suggestedStatus),
      )
      setStatusUpdateNoticeTitle(title)
      appendLog("状态已更新", "done", `${title}: ${hypothesisStatusTransitionLabel(result.previousStatus, result.newStatus)}`)
      await runStep("hypothesis", "刷新假设表", "dashboard-data", [], setDashboardRun, (dashboardResult) => `${(dashboardResult as DashboardRun).dashboard?.summary?.hypothesisCount ?? 0} 条假设`)
      setLastRunAt(new Date().toLocaleTimeString())
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      appendLog("确认状态失败", "error", message.slice(0, 180))
      return null
    } finally {
      runningRef.current = false
      setRunning(false)
    }
  }, [appendLog, hypothesisAskRun, projectPath, runStep])

  const confirmHypothesisStatusWithFeedback = useCallback(async (
    hypothesis: Record<string, unknown>,
    signal: ReturnType<typeof latestSignalForHypothesis>,
    keyPrefix = "hypothesis",
  ) => {
    const id = textValue(hypothesis?.id, "")
    const title = textValue(hypothesis?.title, id || "这条假设")
    const key = `${keyPrefix}:${id || title}:confirm`
    markSignalActionFeedback(key, "confirm", "running", title)
    const result = await confirmHypothesisStatus(hypothesis, signal)
    markSignalActionFeedback(
      key,
      "confirm",
      result ? "done" : "error",
      title,
      result ? undefined : "确认状态失败；请查看顶部错误或阶段输出后重试。",
      result
        ? {
            previousStatus: result.previousStatus,
            newStatus: result.newStatus,
          }
        : undefined,
    )
    return result
  }, [confirmHypothesisStatus, markSignalActionFeedback])

  const confirmSelectedStatus = useCallback(async () => {
    if (!selectedHypothesis || !selectedSignal) return
    await confirmHypothesisStatusWithFeedback(selectedHypothesis, selectedSignal, "selected-hypothesis")
  }, [confirmHypothesisStatusWithFeedback, selectedHypothesis, selectedSignal])

  const refreshHypothesisEvidenceFeedback = useCallback(async (write = false) => {
    if (!projectPath || runningRef.current) return
    runningRef.current = true
    setRunning(true)
    setError(null)
    try {
      const args = ["--limit", "80"]
      if (selectedHypothesisId) args.push("--id", selectedHypothesisId)
      const result = await runStep<HypothesisEvidenceFeedbackRun>(
        "hypothesis",
        write ? "写入证据反馈" : "刷新证据反馈",
        write ? "hypothesis-evidence-feedback-write" : "hypothesis-evidence-feedback-dry-run",
        args,
        setHypothesisEvidenceFeedback,
        (run) => `${run.count ?? 0} 条反馈，${write ? "已写 artifact" : "dry-run"}`,
      )
      if (write) {
        const verified = await runStep<HypothesisVerifyRun>(
          "validation",
          "校验 Hypothesis Engine",
          "hypothesis-verify",
          [],
          setHypothesisVerifyRun,
          (run) => `${run.status ?? "unknown"} · ${run.errorCount ?? 0} errors`,
        )
        appendLog("Hypothesis Engine 校验", verified.status === "ok" ? "done" : "error", `${verified.status ?? "unknown"} · ${verified.issueCount ?? 0} issues`)
      }
      setLastRunAt(new Date().toLocaleTimeString())
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      appendLog("证据反馈刷新失败", "error", message.slice(0, 180))
      return null
    } finally {
      runningRef.current = false
      setRunning(false)
    }
  }, [appendLog, projectPath, runStep, selectedHypothesisId])

  const draftSelectedPostMortem = useCallback(async (write = false) => {
    if (!projectPath || runningRef.current) return
    runningRef.current = true
    setRunning(true)
    setError(null)
    try {
      const args = ["--limit", "80"]
      if (selectedHypothesisId) args.push("--id", selectedHypothesisId)
      const result = await runStep<HypothesisPostMortemRun>(
        "review",
        write ? "写入 Post-Mortem 草稿" : "生成 Post-Mortem 草稿",
        write ? "hypothesis-post-mortem-write" : "hypothesis-post-mortem-dry-run",
        args,
        setHypothesisPostMortemRun,
        (run) => `${run.count ?? 0} 条草稿，${write ? "已写 artifact" : "dry-run"}`,
      )
      if (write) {
        await runStep<HypothesisVerifyRun>(
          "validation",
          "校验 Hypothesis Engine",
          "hypothesis-verify",
          [],
          setHypothesisVerifyRun,
          (run) => `${run.status ?? "unknown"} · ${run.errorCount ?? 0} errors`,
        )
      }
      setLastRunAt(new Date().toLocaleTimeString())
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      appendLog("Post-Mortem 草稿失败", "error", message.slice(0, 180))
      return null
    } finally {
      runningRef.current = false
      setRunning(false)
    }
  }, [appendLog, projectPath, runStep, selectedHypothesisId])

  const confirmFeedbackRecommendation = useCallback(async () => {
    if (!selectedHypothesis || !selectedHypothesisFeedback) return
    const humanGate = recordValue(selectedHypothesisFeedback.humanGate)
    const targetStatus = textValue(humanGate.targetStatus, "")
    const currentStatus = textValue(selectedHypothesis.status, "watching")
    if (!targetStatus || targetStatus === currentStatus) {
      setError("当前证据反馈没有需要确认的状态迁移。")
      return
    }
    await confirmHypothesisStatus(selectedHypothesis, {
      suggestedStatus: targetStatus,
      reason: textValue(humanGate.reason, "Hypothesis Engine evidence feedback recommendation"),
      sourceRef: `hypothesis-evidence-feedback:${textValue(selectedHypothesisFeedback.id, textValue(selectedHypothesisFeedback.hypothesisId, ""))}`,
      eventRef: `hypothesis-evidence-feedback:${textValue(selectedHypothesisFeedback.id, textValue(selectedHypothesisFeedback.hypothesisId, ""))}`,
      evidenceDelta: "hypothesis_evidence_feedback",
      signalType: "证据回流",
      tradingImplication: "",
      sourceExcerpt: "",
      relatedWikiPages: [],
      askDeepDiveRecommended: false,
    })
  }, [confirmHypothesisStatus, selectedHypothesis, selectedHypothesisFeedback])

  const askSelectedHypothesis = useCallback(async (
    hypothesis: Record<string, unknown>,
    queryContext: Parameters<typeof buildHypothesisAskQuery>[1] = {},
    options: { forceRefresh?: boolean } = {},
  ) => {
    if (!projectPath) return null
    const id = textValue(hypothesis.id, "")
    if (!id) return null
    const askQuery = buildHypothesisAskQuery(hypothesis, queryContext)
    const cacheKey = `${id}\u0000${askQuery}`
    const cached = options.forceRefresh ? null : askRunCacheByHypothesisId[cacheKey]
    if (cached) {
      const title = textValue(hypothesis.title, id)
      setHypothesisAskRun(cached.run)
      setAskErrorState(null)
      setCandidateAskPrecheckSource(null)
      setCandidateAskPrecheckAdopted(null)
      setPendingAskTitle(title)
      setAskPendingRequested(false)
      setReusedAskCache({ hypothesisId: id, cachedAt: cached.cachedAt })
      selectHypothesis(id, title)
      appendLog("复用最近 Ask", "done", `${title} · ${cached.cachedAt}`)
      window.setTimeout(jumpToAskResult, 80)
      return cached.run
    }
    if (runningRef.current) return null
    runningRef.current = true
    setRunning(true)
    setError(null)
    try {
      return await runAskDeepDiveForHypothesis(hypothesis, queryContext)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      setAskErrorState({
        title: textValue(hypothesis.title, id),
        message,
        mode: "hypothesis-ask",
        at: new Date().toLocaleTimeString(),
      })
      appendLog("Ask 深挖失败", "error", message.slice(0, 180))
      return null
    } finally {
      runningRef.current = false
      setRunning(false)
    }
  }, [appendLog, askRunCacheByHypothesisId, jumpToAskResult, projectPath, runAskDeepDiveForHypothesis, selectHypothesis])

  const askHypothesisWithFeedback = useCallback(async (
    hypothesis: Record<string, unknown>,
    signal?: ReturnType<typeof latestSignalForHypothesis>,
    keyPrefix = "hypothesis",
  ) => {
    const id = textValue(hypothesis?.id, "")
    const title = textValue(hypothesis?.title, id || "这条假设")
    const key = `${keyPrefix}:${id || title}:ask`
    const queryContext = signal ? buildSignalAskQueryContext(signal) : {}
    setAskResultOrigin({
      kind: "manual",
      action: "ask",
      title,
      hypothesisId: id,
      signalType: textValue(signal?.signalType, signalStrengthLabel(signal?.evidenceDelta)),
      sourceRef: textValue(signal?.sourceRef, ""),
      sourceExcerpt: textValue(signal?.sourceExcerpt, ""),
    })
    markSignalActionFeedback(key, "ask", "running", title)
    const result = await askSelectedHypothesis(hypothesis, queryContext)
    markSignalActionFeedback(
      key,
      "ask",
      result ? "done" : "error",
      title,
      result ? undefined : "Ask 深挖失败；请查看顶部错误或阶段输出后重试。",
      result ? buildAskActionFeedbackExtras(result) : undefined,
    )
    return result
  }, [askSelectedHypothesis, buildAskActionFeedbackExtras, markSignalActionFeedback])

  const askCacheStatusForHypothesis = useCallback((
    hypothesis: Record<string, unknown>,
    queryContext: Parameters<typeof buildHypothesisAskQuery>[1] = {},
  ) => {
    const id = textValue(hypothesis.id, "")
    if (!id) return buildAskCacheStatusCopy({ cached: false })
    const query = buildHypothesisAskQuery(hypothesis, queryContext)
    const cacheKey = `${id}\u0000${query}`
    const cached = askRunCacheByHypothesisId[cacheKey]
    const sourceCount = cached ? countAskResultSources(cached.run) : 0
    return buildAskCacheStatusCopy({
      cached: Boolean(cached),
      cachedAt: cached?.cachedAt,
      sourceCount,
    })
  }, [askRunCacheByHypothesisId])

  const retryAskFollowUp = useCallback(() => {
    if (askResultIsPrecheck) {
      if (!candidateAskPrecheckSource) return
      void runCandidateAskPrecheck(candidateAskPrecheckSource)
      return
    }
    const hypothesis = hypothesisAskRun?.hypothesis
    if (!hypothesis) return
    void askSelectedHypothesis(hypothesis, {}, { forceRefresh: true })
  }, [askResultIsPrecheck, askSelectedHypothesis, candidateAskPrecheckSource, hypothesisAskRun?.hypothesis, runCandidateAskPrecheck])

  const buildWatchArgs = useCallback((limit = "100", llmReviewMode = "auto", hypothesisIdOverride?: string) => {
    const hypothesisId = hypothesisIdOverride ?? selectedHypothesisId
    const llmConfig = useWikiStore.getState().llmConfig
    const args = [
      "--since",
      since,
      "--sources",
      WATCH_SOURCES,
      "--limit",
      limit,
      "--llm-review",
      llmReviewMode,
      "--llm-review-max-items",
      "12",
      "--llm-review-timeout-ms",
      "120000",
      "--compact",
      "--provider",
      llmConfig.provider === "codex" ? "codex" : "openai",
      "--api-key",
      llmConfig.apiKey ?? "",
      "--endpoint",
      llmConfig.customEndpoint ?? "",
      "--model",
      llmConfig.model ?? "",
    ]
    if (hypothesisId) {
      args.push("--hypothesis-id", hypothesisId)
    }
    return args
  }, [selectedHypothesisId, since])

  const processSupplementWithLlm = useCallback(async () => {
    if (!projectPath || runningRef.current) return
    if (!supplementBody.trim()) {
      setError("请先粘贴资料或输入要补证的问题。")
      return
    }
    runningRef.current = true
    setRunning(true)
    setError(null)
    try {
      const llmConfig = useWikiStore.getState().llmConfig
      const args = [
        "--body",
        supplementBody.trim(),
        "--selected-sources",
        selectedSupplementSources.join(","),
        "--provider",
        llmConfig.provider === "codex" ? "codex" : "openai",
        "--api-key",
        llmConfig.apiKey ?? "",
        "--endpoint",
        llmConfig.customEndpoint ?? "",
        "--model",
        llmConfig.model ?? "",
        "--timeout-ms",
        "120000",
        "--ima-timeout-ms",
        "8000",
        "--ima-max-knowledge-bases",
        "2",
        "--ima-max-hits",
        "3",
        "--ima-max-queries",
        "1",
      ]
      if (supplementRefs.trim()) {
        args.push("--source-refs", supplementRefs.trim())
      }
      if (supplementHypothesisId.trim()) {
        args.push("--hypothesis-id", supplementHypothesisId.trim())
      }
      const result = await runStep<SupplementDraftRun>(
        "ingest",
        "LLM整理补证资料",
        "hypothesis-supplement-draft",
        args,
        setSupplementDraftRun,
        (run) => {
          const draft = (run as SupplementDraftRun).draft
          const imaHits = (run as SupplementDraftRun).externalContext?.ima?.hits?.length ?? 0
          return draft ? `${draft.evidenceDelta}，${draft.evidenceGaps?.length ?? 0} 个缺口，IMA命中 ${imaHits} 条` : "LLM草稿已返回"
        },
      )
      if (result.draft) {
        setSupplementTitle(result.draft.title || "补充资料：LLM整理草稿")
        setSupplementKind(result.draft.kind || "manual")
        setSupplementRefs(result.draft.sourceRefs || supplementRefs)
        setSupplementBody(result.draft.normalizedBody || supplementBody)
      }
      setLastRunAt(new Date().toLocaleTimeString())
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      setStage("ingest", "error", message.slice(0, 120))
      appendLog("LLM整理补证失败", "error", message.slice(0, 180))
    } finally {
      runningRef.current = false
      setRunning(false)
    }
  }, [appendLog, projectPath, runStep, selectedSupplementSources, setStage, supplementBody, supplementHypothesisId, supplementRefs])

  const refresh = useCallback(async (
    writeAlerts = false,
    llmReviewMode = "auto",
    options: { skipIfSourceUnchanged?: boolean; hypothesisId?: string; hypothesisTitle?: string; sinceOverride?: string } = {},
  ) => {
    if (!projectPath || runningRef.current) return
    const effectiveSince = options.sinceOverride?.trim() || since
    runningRef.current = true
    setRunning(true)
    setError(null)
    setStages(freshStages())
    if (!options.skipIfSourceUnchanged) {
      setSignalActionFeedbackByKey({})
      setActivityLog([])
    }
    let checkedAutoSourceSignature = ""
    const scopedHypothesisId = options.hypothesisId?.trim() || selectedHypothesisId
    const scopedHypothesisLabel = options.hypothesisTitle?.trim() || scopedHypothesisId
    const scanKey = buildScanKey({
      rawChatSource,
      since: effectiveSince,
      hypothesisId: scopedHypothesisId,
    })
    try {
      if (options.skipIfSourceUnchanged) {
        setStage("ingest", "running", "检查新增资料更新")
        appendLog("自动跟踪", "running", "先检查新增资料是否变化")
        const sourceResult = await runResearchCockpitCommand<WechatSourcesRun>(projectPath, "wechat-source-list", [
          "--source",
          rawChatSource.trim() || "raw/微信聊天",
          "--limit",
          "20",
        ])
        setWechatSourcesRun(sourceResult)
        const signature = wechatSourceSignature(sourceResult, rawChatSource)
        if (signature && signature === lastAutoSourceSignatureRef.current) {
          setStage("ingest", "done", "资料源未变化，跳过扫描")
          setStage("hypothesis", "done", "等待下一轮")
          appendLog("自动跟踪", "done", "新增资料未变化，跳过 import/process/watch")
          setLastRunAt(new Date().toLocaleTimeString())
          setNextAutoScanAt(Date.now() + 30000)
          return
        }
        checkedAutoSourceSignature = signature
        setSignalActionFeedbackByKey({})
        setActivityLog([])
        appendLog("自动跟踪", "running", signature ? "新增资料有更新，开始导入和扫描" : "未拿到文件签名，执行完整扫描")
      }

      setIgnoredSignalKeys(new Set())
      setIgnoredSignalNotice(null)
      setStatusUpdateNoticeTitle("")
      setStatusUpdateRun(null)
      const importResult = await runStep<RawChatImportRun>(
        "ingest",
        "导入新增资料",
        "wechat-import-raw-write",
        [
          "--source",
          rawChatSource.trim() || "raw/微信聊天",
          "--limit",
          "500",
        ],
        setRawChatImportRun,
        (run) => {
          const summary = run.summary
          return `${summary?.filesScanned ?? 0} 个文件，新增写入 ${summary?.recordsWritten ?? 0}/${summary?.messagesExtracted ?? 0} 条`
        },
      )
      const importedSignature = rawImportSourceSignature(importResult, rawChatSource) || checkedAutoSourceSignature
      if (importedSignature) {
        lastAutoSourceSignatureRef.current = importedSignature
      }

      setStage("ingest", "running", "规范化 inbox")
      appendLog("信息摄入", "running", "规范化新增资料 inbox")
      const processResult = await runResearchCockpitCommand<ProcessRun>(projectPath, "wechat-process")
      setProcessRun(processResult)
      const ingestSummary = `${processResult.summary?.incomingLinesRead ?? 0} 行，新增 ${processResult.summary?.messagesWritten ?? 0} 条`
      setStage("ingest", "done", ingestSummary)
      appendLog("信息摄入", "done", ingestSummary)

      const statusResult = await runResearchCockpitCommand<InboxStatus>(projectPath, "wechat-status")
      setInboxStatus(statusResult)
      const reviewPlan = buildEffectiveLlmReviewMode({
        requestedMode: llmReviewMode,
        rawRecordsWritten: importResult.summary?.recordsWritten,
        processedMessagesWritten: processResult.summary?.messagesWritten,
        repeatedScan: lastDryRunScanKeyRef.current === scanKey,
      })
      if (reviewPlan.skipped) {
        appendLog("LLM复核", "done", reviewPlan.detail)
      }

      const watchAction = writeAlerts ? "watch-write" : "watch-dry-run"
      const llmConfig = useWikiStore.getState().llmConfig
      const buildLocalWatchArgs = (mode: "off" | "auto" | "force") => {
        const args = [
          "--since",
          effectiveSince,
          "--sources",
          "wechat_incremental",
          "--limit",
          "100",
          "--llm-review",
          mode,
          "--llm-review-max-items",
          "12",
          "--llm-review-timeout-ms",
          "120000",
          "--compact",
          "--provider",
          llmConfig.provider === "codex" ? "codex" : "openai",
          "--api-key",
          llmConfig.apiKey ?? "",
          "--endpoint",
          llmConfig.customEndpoint ?? "",
          "--model",
          llmConfig.model ?? "",
        ]
        if (scopedHypothesisId) args.push("--hypothesis-id", scopedHypothesisId)
        return args
      }
      const reviewPasses = buildWatchReviewPasses({ writeAlerts, reviewMode: writeAlerts ? "off" : reviewPlan.mode })
      let watchResult: WatchRun | null = null
      let ranLlmReview = false
      for (const pass of reviewPasses) {
        if (pass.phase === "llm" && watchResult && !shouldRunLlmReviewAfterRules({
          reviewMode: pass.mode,
          eventCount: watchResult.events?.length ?? 0,
          candidateCount: watchResult.candidateHypotheses?.length ?? watchResult.summary?.candidateHypotheses,
        })) {
          appendLog("LLM复核", "done", "规则快扫没有可复核卡片，跳过 LLM")
          continue
        }

        const stageDetail = pass.phase === "rules"
          ? (scopedHypothesisId ? `规则快扫 ${scopedHypothesisLabel}` : `规则快扫 ${effectiveSince} 内新增资料`)
          : "规则结果已先显示，正在 LLM 复核候选卡片"
        setStage("hypothesis", "running", stageDetail)
        appendLog(pass.label, "running", stageDetail)

        const currentWatchResult = await runResearchCockpitCommand<WatchRun>(projectPath, watchAction, buildLocalWatchArgs(pass.mode))
        watchResult = currentWatchResult
        setWatchRun(currentWatchResult)
        if (!writeAlerts) {
          setLastDryRunSince(effectiveSince)
          lastDryRunScanKeyRef.current = scanKey
        }
        if (pass.phase === "rules" && reviewPasses.length > 1) {
          const ruleEventCount = currentWatchResult.events?.length ?? 0
          const ruleCandidateCount = currentWatchResult.candidateHypotheses?.length ?? currentWatchResult.summary?.candidateHypotheses ?? 0
          const ruleSummary = `${currentWatchResult.summary?.sourcesScanned ?? 0} 个来源，${currentWatchResult.summary?.matchedHypotheses ?? 0} 个命中，${ruleEventCount + ruleCandidateCount} 个候选复核项`
          const willReview = shouldRunLlmReviewAfterRules({
            reviewMode: reviewPasses[1]?.mode,
            eventCount: ruleEventCount,
            candidateCount: ruleCandidateCount,
          })
          appendLog("规则快扫", "done", willReview ? `${ruleSummary}，结果已先显示` : `${ruleSummary}，无须 LLM 复核`)
          if (willReview) {
            setStage("hypothesis", "running", `${ruleSummary}，正在 LLM 复核`)
          }
        }
        if (pass.phase === "llm") {
          ranLlmReview = true
        }
      }
      if (!watchResult) {
        throw new Error("watch did not return a result")
      }
      const reviewStatus = textValue(watchResult.summary?.llmReviewStatus, textValue(watchResult.llmReview?.status, "off"))
      const reviewSuffix = reviewPlan.skipped ? "（无新增，跳过AI）" : reviewPasses.length > 1 && !ranLlmReview ? "（规则无候选，跳过AI）" : ""
      const hypothesisSummary = `${watchResult.summary?.sourcesScanned ?? 0} 个来源，${watchResult.summary?.matchedHypotheses ?? 0} 个命中，LLM复核 ${reviewStatus}${reviewSuffix}`
      setStage("hypothesis", "done", hypothesisSummary)
      appendLog("假设生成/更新", "done", hypothesisSummary)
      const alertCount = writeAlerts ? watchResult.summary?.alertsWritten ?? 0 : watchResult.alerts?.length ?? 0
      setStage("validation", "done", `${alertCount} 条 alerts`)
      setStage("review", "done", writeAlerts ? "alerts 已写入" : alertCount > 0 ? "alerts 待确认" : "无待确认 alerts")
      appendLog("人工审核", writeAlerts ? "done" : "running", writeAlerts ? "已确认写入 alerts" : alertCount > 0 ? "有 alerts 等待确认写入" : "无待确认 alerts")

      const dashboardResult = await runResearchCockpitCommand<DashboardRun>(projectPath, "dashboard-data")
      setDashboardRun(dashboardResult)
      appendLog("假设库状态", "done", `假设 ${dashboardResult.dashboard?.summary?.hypothesisCount ?? 0} 条`)
      setLastRunAt(new Date().toLocaleTimeString())
      setNextAutoScanAt(autoRefresh ? Date.now() + 30000 : null)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      setStage("review", "error", message.slice(0, 120))
      appendLog("刷新失败", "error", message.slice(0, 180))
    } finally {
      runningRef.current = false
      setRunning(false)
    }
  }, [appendLog, autoRefresh, projectPath, rawChatSource, runStep, selectedHypothesisId, setStage, since])

  const expandWatchWindowAndScan = useCallback(() => {
    const nextSince = "1d"
    setSince(nextSince)
    void refresh(false, "auto", { sinceOverride: nextSince })
  }, [refresh])

  const scanAdoptedPrecheckHypothesis = useCallback(async () => {
    const hypothesis = candidateAskPrecheckAdopted
    const id = textValue(hypothesis?.id, "")
    const title = textValue(hypothesis?.title, id)
    if (!id || runningRef.current) return
    selectHypothesis(id, title)
    await refresh(false, "auto", { hypothesisId: id, hypothesisTitle: title })
  }, [candidateAskPrecheckAdopted, refresh, selectHypothesis])

  const importRawChat = useCallback(async (write = false) => {
    if (!projectPath || runningRef.current) return
    runningRef.current = true
    setRunning(true)
    setError(null)
    try {
      const label = write ? "导入新增资料" : "预览新增资料"
      const importResult = await runStep<RawChatImportRun>(
        "ingest",
        label,
        write ? "wechat-import-raw-write" : "wechat-import-raw-dry-run",
        [
          "--source",
          rawChatSource.trim() || "raw/微信聊天",
          "--limit",
          "200",
        ],
        setRawChatImportRun,
        (result) => {
          const summary = (result as RawChatImportRun).summary
          const files = summary?.filesScanned ?? 0
          const messages = summary?.messagesExtracted ?? 0
          const records = summary?.recordsWritten ?? 0
          return write ? `${files} 个文件，写入 ${records}/${messages} 条` : `${files} 个文件，预览 ${messages} 条`
        },
      )
      if (write && (importResult.summary?.recordsWritten ?? 0) > 0) {
        setIgnoredSignalKeys(new Set())
        setIgnoredSignalNotice(null)
        setStatusUpdateNoticeTitle("")
        setStatusUpdateRun(null)
        await runStep("ingest", "规范化 inbox", "wechat-process", [], setProcessRun, (result) => {
          const summary = (result as ProcessRun).summary
          return `${summary?.incomingLinesRead ?? 0} 行，新增 ${summary?.messagesWritten ?? 0} 条`
        })
        const statusResult = await runResearchCockpitCommand<InboxStatus>(projectPath, "wechat-status")
        setInboxStatus(statusResult)
        await runStep("hypothesis", "扫描导入消息", "watch-dry-run", buildWatchArgs("100"), setWatchRun, (result) => {
          const run = result as WatchRun
          return `${run.summary?.matchedHypotheses ?? 0} 个命中，${run.alerts?.length ?? 0} 条 alerts 待确认`
        })
        await runStep("hypothesis", "刷新假设库", "dashboard-data", [], setDashboardRun, (result) => {
          const count = (result as DashboardRun).dashboard?.summary?.hypothesisCount ?? 0
          return `${count} 条假设`
        })
      }
      setLastRunAt(new Date().toLocaleTimeString())
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      setStage("ingest", "error", message.slice(0, 120))
      appendLog("新增资料导入失败", "error", message.slice(0, 180))
    } finally {
      runningRef.current = false
      setRunning(false)
    }
  }, [appendLog, buildWatchArgs, projectPath, rawChatSource, runStep, setStage])

  const submitSupplement = useCallback(async (write = false) => {
    if (!projectPath || runningRef.current) return
    if (!supplementBody.trim()) {
      setError("请先填写补充资料内容。")
      return
    }
    runningRef.current = true
    setRunning(true)
    setError(null)
    try {
      const action = write ? "hypothesis-supplement-write" : "hypothesis-supplement-dry-run"
      const supplementArgs = [
        "--title",
        supplementTitle.trim() || "补充资料",
        "--body",
        supplementBody.trim(),
        "--kind",
        supplementKind.trim() || "manual",
      ]
      if (supplementRefs.trim()) {
        supplementArgs.push("--source-refs", supplementRefs.trim())
      }
      if (supplementHypothesisId.trim()) {
        supplementArgs.push("--hypothesis-id", supplementHypothesisId.trim())
      }
      const supplementResult = await runStep<SupplementRun>(
        "ingest",
        write ? "提交补充资料" : "预览补充资料",
        action,
        supplementArgs,
        setSupplementRun,
        (result) => {
          const run = result as SupplementRun
          const path = run.writeResult?.markdownRelativePath
          return run.dryRun ? "dry-run 未落盘" : `已写 ${path ?? "supplement"}`
        },
      )
      if (write && supplementResult.writeResult) {
        await runStep("ingest", "规范化 inbox", "wechat-process", [], setProcessRun, (result) => {
          const summary = (result as ProcessRun).summary
          return `${summary?.incomingLinesRead ?? 0} 行，新增 ${summary?.messagesWritten ?? 0} 条`
        })
        const statusResult = await runResearchCockpitCommand<InboxStatus>(projectPath, "wechat-status")
        setInboxStatus(statusResult)
        await runStep("hypothesis", "扫描增量和补资料", "watch-dry-run", buildWatchArgs("100"), setWatchRun, (result) => {
          const run = result as WatchRun
          return `${run.summary?.matchedHypotheses ?? 0} 个命中，${run.alerts?.length ?? 0} 条 alerts 待确认`
        })
        setLastDryRunSince(since)
        await runStep("hypothesis", "刷新假设库", "dashboard-data", [], setDashboardRun, (result) => {
          const count = (result as DashboardRun).dashboard?.summary?.hypothesisCount ?? 0
          return `${count} 条假设`
        })
      }
      setLastRunAt(new Date().toLocaleTimeString())
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      setStage("ingest", "error", message.slice(0, 120))
      appendLog("补充资料失败", "error", message.slice(0, 180))
    } finally {
      runningRef.current = false
      setRunning(false)
    }
  }, [appendLog, buildWatchArgs, projectPath, runStep, setStage, since, supplementBody, supplementHypothesisId, supplementKind, supplementRefs, supplementTitle])

  const refreshLoopState = useCallback(async () => {
    if (!projectPath || runningRef.current) return
    runningRef.current = true
    setRunning(true)
    setError(null)
    setActivityLog([])
    try {
      await runStep("hypothesis", "假设库总览", "dashboard-data", [], setDashboardRun, (result) => {
        const count = (result as DashboardRun).dashboard?.summary?.hypothesisCount ?? 0
        return `${count} 条假设`
      })
      await runStep("validation", "自提问阶段状态", "self-question-status", [], setSelfQuestionStatus, (result) => {
        const data = recordValue(result)
        return textValue(data.phase ?? data.status ?? data.currentPhase, "已读取")
      })
      await runStep("ledger", "实验账本状态", "autoresearch-status", [], setAutoresearchStatus, (result) => {
        const counts = recordValue(recordValue(result).counts)
        return `${numberValue(counts.experimentCount ?? counts.experiments)} 个实验`
      })
      await runStep("ledger", "实验账本列表", "autoresearch-ledger", [], setAutoresearchLedger, (result) => {
        const data = recordValue(result)
        return `${numberValue(data.returned ?? data.totalEntries) || countArray(data.entries ?? data.experiments)} 条记录`
      })
      await runStep("review", "人工审核队列", "self-train-next", ["--limit", "8"], setSelfTrainNext, (result) => {
        return `${countArray(recordValue(result).actions)} 个待审动作`
      })
      await runStep("training", "训练样本账本", "export-samples-list", ["--limit", "8"], setExportSamples, (result) => {
        const data = recordValue(result)
        return `${numberValue(data.returned) || countArray(data.entries)} 个样本批次`
      })
      setLastRunAt(new Date().toLocaleTimeString())
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      appendLog("闭环状态刷新失败", "error", message.slice(0, 180))
    } finally {
      runningRef.current = false
      setRunning(false)
    }
  }, [appendLog, projectPath, runStep])

  const runFullDryLoop = useCallback(async () => {
    if (!projectPath || runningRef.current) return
    runningRef.current = true
    setRunning(true)
    setError(null)
    setStages(freshStages())
    setActivityLog([])
    try {
      await runStep("ingest", "新增资料预览", "wechat-import-raw-dry-run", [
        "--source",
        rawChatSource.trim() || "raw/微信聊天",
        "--limit",
        "200",
      ], setRawChatImportRun, (result) => {
        const summary = (result as RawChatImportRun).summary
        return `${summary?.filesScanned ?? 0} 个文件，预览 ${summary?.messagesExtracted ?? 0} 条`
      })
      await runStep("ingest", "信息摄入", "wechat-process", [], setProcessRun, (result) => {
        const summary = (result as ProcessRun).summary
        return `${summary?.incomingLinesRead ?? 0} 行，新增 ${summary?.messagesWritten ?? 0} 条`
      })
      const statusResult = await runResearchCockpitCommand<InboxStatus>(projectPath, "wechat-status")
      setInboxStatus(statusResult)
      await runStep("hypothesis", "假设扫描", "watch-dry-run", buildWatchArgs("100"), setWatchRun, (result) => {
        const run = result as WatchRun
        return `${run.summary?.matchedHypotheses ?? 0} 个命中，${run.alerts?.length ?? 0} 条 alerts`
      })
      const question = deepQuestion.trim()
      if (question) {
        await runStep("agentic", "多智能体推演", "agentic-ask", [
          "--query",
          question,
          "--agent-concurrency",
          "3",
          "--agent-timeout-ms",
          "300000",
        ], setAgenticRun, (result) => {
          const data = recordValue(result)
          return `${countArray(data.sources)} 个来源摘要`
        })
      } else {
        setStage("agentic", "done", "未填写深度问题，跳过")
        appendLog("多智能体推演", "done", "未填写深度问题，跳过")
      }
      await runStep("validation", "自提问闭环 dry-run", "self-question-loop-dry-run", [
        "--stages",
        "generate,validate,attribute,evidence,policy,self-train,self-train-plan,export",
      ], setSelfQuestionLoop, (result) => {
        const data = recordValue(result)
        return textValue(data.status ?? data.mode, "dry-run 完成")
      })
      await runStep("ledger", "实验账本读取", "autoresearch-ledger", [], setAutoresearchLedger, (result) => {
        const data = recordValue(result)
        return `${numberValue(data.returned ?? data.totalEntries) || countArray(data.entries ?? data.experiments)} 条记录`
      })
      await runStep("proposal", "策略建议 dry-run", "policy-proposal-dry-run", [], setPolicyProposal, (result) => {
        const data = recordValue(result)
        return `${countArray(data.proposals ?? data.proposalItems ?? data.policyProposals)} 条建议`
      })
      await runStep("review", "人工审核队列", "self-train-next", ["--limit", "8"], setSelfTrainNext, (result) => {
        return `${countArray(recordValue(result).actions)} 个待审动作`
      })
      await runStep("training", "自训练计划 dry-run", "self-train-plan-dry-run", ["--limit", "5"], setSelfTrainPlan, (result) => {
        const data = recordValue(result)
        return `${countArray(data.actions ?? data.planItems ?? data.items)} 个计划项`
      })
      const exportResult = await runResearchCockpitCommand<Record<string, unknown>>(projectPath, "export-samples-list", ["--limit", "8"])
      setExportSamples(exportResult)
      appendLog("训练样本账本", "done", `${numberValue(exportResult.returned) || countArray(exportResult.entries)} 个样本批次`)
      setLastRunAt(new Date().toLocaleTimeString())
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      appendLog("完整 dry-run 闭环失败", "error", message.slice(0, 180))
    } finally {
      runningRef.current = false
      setRunning(false)
    }
  }, [appendLog, buildWatchArgs, deepQuestion, projectPath, rawChatSource, runStep, setStage])

  const proposePolicy = useCallback(async (write = false) => {
    if (!projectPath || runningRef.current) return
    runningRef.current = true
    setRunning(true)
    setError(null)
    try {
      await runStep("proposal", write ? "确认写入策略建议" : "策略建议 dry-run", write ? "policy-proposal-write" : "policy-proposal-dry-run", [], setPolicyProposal, (result) => {
        const data = recordValue(result)
        return `${countArray(data.proposals ?? data.proposalItems ?? data.policyProposals)} 条建议`
      })
      setLastRunAt(new Date().toLocaleTimeString())
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      appendLog("策略建议失败", "error", message.slice(0, 180))
    } finally {
      runningRef.current = false
      setRunning(false)
    }
  }, [appendLog, projectPath, runStep])

  const planSelfTraining = useCallback(async (write = false) => {
    if (!projectPath || runningRef.current) return
    runningRef.current = true
    setRunning(true)
    setError(null)
    try {
      await runStep("training", write ? "确认写入自训练计划" : "自训练计划 dry-run", write ? "self-train-plan-write" : "self-train-plan-dry-run", ["--limit", "5"], setSelfTrainPlan, (result) => {
        const data = recordValue(result)
        return `${countArray(data.actions ?? data.planItems ?? data.items)} 个计划项`
      })
      setLastRunAt(new Date().toLocaleTimeString())
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      appendLog("自训练计划失败", "error", message.slice(0, 180))
    } finally {
      runningRef.current = false
      setRunning(false)
    }
  }, [appendLog, projectPath, runStep])

  const refreshDashboardData = useCallback(async () => {
    if (!projectPath || runningRef.current) return
    runningRef.current = true
    setRunning(true)
    setError(null)
    try {
      await runStep("hypothesis", "刷新假设表", "dashboard-data", [], setDashboardRun, (result) => {
        const count = (result as DashboardRun).dashboard?.summary?.hypothesisCount ?? 0
        return `${count} 条假设`
      })
      setLastRunAt(new Date().toLocaleTimeString())
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      appendLog("刷新假设表失败", "error", message.slice(0, 180))
    } finally {
      runningRef.current = false
      setRunning(false)
    }
  }, [appendLog, projectPath, runStep])

  const reviewTodaySignalsWithLlm = useCallback(async () => {
    if (!projectPath || runningRef.current) return
    runningRef.current = true
    setRunning(true)
    setError(null)
    try {
      setStage("hypothesis", "running", selectedHypothesisId ? `LLM复核 ${selectedHypothesisTitle}` : "LLM复核今日信号")
      appendLog("LLM复核今日信号", "running", "只复核规则层筛出的候选卡片，不重新导入全部原文")
      await runStep("hypothesis", "LLM复核今日信号", "watch-dry-run", buildWatchArgs("100", "force"), setWatchRun, (result) => {
        const run = result as WatchRun
        const reviewStatus = textValue(run.summary?.llmReviewStatus, textValue(run.llmReview?.status, "off"))
        return `${run.summary?.matchedHypotheses ?? 0} 个命中，${run.alerts?.length ?? 0} 条建议，LLM复核 ${reviewStatus}`
      })
      setStage("hypothesis", "done", "LLM复核完成")
      setLastDryRunSince(since)
      lastDryRunScanKeyRef.current = currentScanKey
      setLastRunAt(new Date().toLocaleTimeString())
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      setStage("hypothesis", "error", message.slice(0, 120))
      appendLog("LLM复核失败", "error", message.slice(0, 180))
    } finally {
      runningRef.current = false
      setRunning(false)
    }
  }, [appendLog, buildWatchArgs, currentScanKey, projectPath, runStep, selectedHypothesisId, selectedHypothesisTitle, setStage, since])

  useEffect(() => {
    if (!projectPath) return
    void loadSignalSourceCandidates(signalSourcePresets.map((preset) => preset.source), true)
  }, [loadSignalSourceCandidates, projectPath, signalSourcePresets])

  useEffect(() => {
    lastAutoSourceSignatureRef.current = ""
  }, [projectPath, rawChatSource])

  useEffect(() => {
    if (!autoRefresh) {
      setNextAutoScanAt(null)
      return
    }
    setNextAutoScanAt((current) => current ?? Date.now() + 30000)
  }, [autoRefresh])

  useEffect(() => {
    if (!autoRefresh || !projectPath) return
    const timer = window.setInterval(() => {
      const now = Date.now()
      setAutoTick(now)
      if (!runningRef.current && nextAutoScanAt && now >= nextAutoScanAt) {
        setNextAutoScanAt(now + 30000)
        void refresh(false, "off", { skipIfSourceUnchanged: true })
      }
    }, 1000)
    return () => window.clearInterval(timer)
  }, [autoRefresh, nextAutoScanAt, projectPath, refresh])

  const topAlerts = useMemo(() => dryRunAlerts.slice(0, 6), [dryRunAlerts])

  if (!project) {
    return (
      <div className="flex h-[55vh] items-center justify-center text-sm text-muted-foreground">
        请先打开一个交易复盘项目
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* 假设管理已迁移到「假设演化台」（左侧导航 GitBranch 图标） */}
      <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span>假设管理（发现/验证/状态/候选/微信导入/政策提议/观测草稿/样本导出/数据源探测）已迁移到「假设演化台」，请在左侧导航点击 GitBranch 图标进入。本面板保留信号扫描、补证、自训练等非假设功能。</span>
      </div>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-xl font-semibold">今日投研工作台</h2>
          <p className="mt-1 text-sm text-muted-foreground">今天有什么新信号，会不会改变正在跟踪的假设</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => refresh(false, "auto")} disabled={running}>
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <SearchCheck className="h-3.5 w-3.5" />}
            {scanModeSummary.buttonLabel}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setAutoRefresh((value) => !value)}>
            <Radio className={cn("h-3.5 w-3.5", autoRefresh && "text-emerald-500")} />
            {autoRefresh ? `自动跟踪 ${autoScanSeconds ?? 30}s` : "自动跟踪"}
          </Button>
          <Button variant="outline" size="sm" onClick={refreshDashboardData} disabled={running}>
            <Database className="h-3.5 w-3.5" />
            刷新
          </Button>
        </div>
      </div>

      <DailyStatusBar
        selectedTitle={selectedHypothesisTitle}
        selectedId={selectedHypothesisId}
        autoRefresh={autoRefresh}
        running={running}
        runningStage={runningStage}
        latestLog={latestLog}
        sourceCount={scannedSourceCount}
        matchedCount={matchedHypothesisCount}
        eventCount={dryRunEvents.length}
        alertCount={pendingAlertCount}
        newMessageCount={newMessageCount}
        pendingCount={pendingWorkbenchCount}
        confirmableCount={confirmableTodoCount}
        askRecommendedCount={askRecommendedCount}
        candidateCount={priorityCandidateHypotheses.length}
        autoScanSeconds={autoScanSeconds}
        answer={watchAnswer}
        progress={scanProgress}
        scope={scanScopeSummary}
        reviewMode={reviewModeSummary}
        scanMode={scanModeSummary}
        pmOpeningBrief={topPmOpeningBrief}
        actionFeedback={dailyStatusActionFeedback}
        nextAction={nextActionText}
        onJumpToSignals={() => signalTodoListRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
        onJumpToAskResult={jumpToAskResult}
      />

      <ObservationReviewStrip
        brief={observationReviewBrief}
        loading={observationDraftListLoading}
        onRefresh={refreshObservationDrafts}
      />

      {(askDeepDivePending || hypothesisAskRun || askErrorVisible) && (
        <AskResultJumpBar
          copy={askJumpCopy}
          steps={askPanelCopy.steps}
          onJump={jumpToAskResult}
        />
      )}

      <div className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
        <TodaySignalSourcePanel
          rawChatSource={rawChatSource}
          onRawChatSourceChange={setRawChatSource}
          sourcePresets={signalSourcePresets}
          onSelectPreset={(source) => {
            setRawChatSource(source)
            void loadWechatSources(source, true)
          }}
          selectedSource={selectedWechatSource}
          candidates={wechatSourceCandidates}
          sourceMissing={Boolean(rawChatImportRun?.sourceMissing || wechatSourcesRun?.sourceMissing)}
          usingRecentFallback={usingRecentWechatFallback}
          lastRunAt={lastRunAt}
          autoRefresh={autoRefresh}
          autoScanSeconds={autoScanSeconds}
          since={since}
          running={running}
          rawChatFiles={rawChatFiles}
          rawChatMessages={rawChatMessages}
          newMessageCount={newMessageCount}
          matchedCount={matchedHypothesisCount}
          pendingCount={pendingWorkbenchCount}
          scanScope={scanScopeSummary}
          scanMode={scanModeSummary}
          capability={signalSourceCapability}
          processRun={processRun}
          inboxStatus={inboxStatus}
          onSinceChange={setSince}
          onChooseFile={() => chooseWechatSource(false)}
          onChooseFolder={() => chooseWechatSource(true)}
          onLoadCandidates={loadCurrentSignalSourceCandidates}
          onScan={() => refresh(false, "auto")}
        />
        <div ref={signalTodoListRef}>
          <SignalTodoList
            todos={signalTodos}
            candidateHypotheses={visibleCandidateHypotheses}
            running={running}
            reviewMode={reviewModeSummary}
            watchSummary={watchRun?.summary}
            hasScanned={Boolean(watchRun)}
            sourceCount={scannedSourceCount}
            newMessageCount={newMessageCount}
            ignoredNotice={ignoredSignalNotice}
            actionFeedbackByKey={signalActionFeedbackByKey}
            askCacheStatusForHypothesis={askCacheStatusForHypothesis}
            onConfirm={async (todo) => {
              if (!todo.hypothesis) return
              const title = textValue(todo.hypothesis.title, textValue(todo.hypothesis.id, "这条假设"))
              markSignalActionFeedback(todo.key, "confirm", "running", title)
              const result = await confirmHypothesisStatus(todo.hypothesis, todo.signal)
              markSignalActionFeedback(
                todo.key,
                "confirm",
                result ? "done" : "error",
                title,
                result ? undefined : "确认状态失败；请查看顶部错误或阶段输出后重试。",
                result
                  ? {
                      previousStatus: result.previousStatus,
                      newStatus: result.newStatus,
                    }
                  : undefined,
              )
            }}
            onAsk={async (todo) => {
              if (todo.hypothesis) {
                const title = textValue(todo.hypothesis.title, textValue(todo.hypothesis.id, "这条假设"))
                markSignalActionFeedback(todo.key, "ask", "running", title)
                setAskResultOrigin({
                  kind: "tracked",
                  action: "ask",
                  title,
                  hypothesisId: textValue(todo.hypothesis.id, ""),
                  signalType: textValue(todo.signal.signalType, signalStrengthLabel(todo.signal.evidenceDelta)),
                  sourceRef: textValue(todo.signal.sourceRef, ""),
                  sourceExcerpt: textValue(todo.signal.sourceExcerpt, ""),
                })
                const result = await askSelectedHypothesis(todo.hypothesis, buildSignalAskQueryContext(todo.signal))
                markSignalActionFeedback(
                  todo.key,
                  "ask",
                  result ? "done" : "error",
                  title,
                  result ? undefined : "Ask 深挖失败；请查看顶部错误或阶段输出后重试。",
                  result ? buildAskActionFeedbackExtras(result) : undefined,
                )
              }
            }}
            onIgnore={(key, title) => {
              markSignalActionFeedback(key, "ignore", "done", title)
              ignoreSignalTodo(key, title)
            }}
            onTrackCandidate={async (candidate, key) => {
              const title = textValue(candidate.title, "候选新假设")
              markSignalActionFeedback(key, "track", "running", title)
              const result = await trackCandidateHypothesis(candidate)
              markSignalActionFeedback(
                key,
                "track",
                result ? "done" : "error",
                title,
                result ? undefined : "加入跟踪失败；请查看顶部错误或阶段输出后重试。",
              )
            }}
            onPrecheckCandidate={async (candidate, key) => {
              const title = textValue(candidate.title, "候选新假设")
              markSignalActionFeedback(key, "precheck", "running", title)
              setAskResultOrigin({
                kind: "candidate",
                action: "precheck",
                title,
                signalType: textValue(candidate.signalType, "候选新假设"),
                sourceRef: textValue(candidate.discoverySourceRef ?? candidate.sourceRef, ""),
                sourceExcerpt: textValue(candidate.sourceExcerpt, ""),
              })
              const result = await runCandidateAskPrecheck(candidate)
              markSignalActionFeedback(
                key,
                "precheck",
                result ? "done" : "error",
                title,
                result ? undefined : "Ask 预检失败；请查看顶部错误或阶段输出后重试。",
                result ? buildAskActionFeedbackExtras(result) : undefined,
              )
            }}
            onReviewWithLlm={reviewTodaySignalsWithLlm}
            onScan={() => refresh(false, "auto")}
            onExpandWindowScan={expandWatchWindowAndScan}
            onDiscover={discoverHypothesesFromWiki}
            onJumpToAskResult={jumpToAskResult}
          />
        </div>
      </div>

      <section className={cn("rounded-lg border bg-card p-4", !showAdvanced && "hidden")}>
        <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
          <div>
            <div className="mb-3">
              <h3 className="font-medium">假设入口 / 参数</h3>
              <p className="mt-1 text-xs text-muted-foreground">日常直接用顶部按钮；这里仅用于调整主题、问题数、并发或手工建假设。</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-[1fr_90px_90px_auto] sm:items-end">
              <label className="block">
                <span className="text-xs font-medium text-muted-foreground">主题</span>
                <Input
                  value={hypothesisTheme}
                  onChange={(event) => setHypothesisTheme(event.target.value)}
                  className="mt-2 h-9 text-xs"
                  aria-label="发现假设主题"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-muted-foreground">问题数</span>
                <Input
                  value={discoveryQuestionCount}
                  onChange={(event) => setDiscoveryQuestionCount(event.target.value)}
                  className="mt-2 h-9 text-xs"
                  aria-label="AI发现问题数"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-muted-foreground">并发</span>
                <Input
                  value={discoveryConcurrency}
                  onChange={(event) => setDiscoveryConcurrency(event.target.value)}
                  className="mt-2 h-9 text-xs"
                  aria-label="AI发现并发数"
                />
              </label>
              <Button size="sm" className="h-9" onClick={discoverHypothesesFromWiki} disabled={running}>
                {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                开始发现
              </Button>
            </div>
          </div>

          <div>
            <div className="mb-3">
              <h3 className="font-medium">手动新增</h3>
              <p className="mt-1 text-xs text-muted-foreground">你也可以直接写一条假设，保存后进入同一张跟踪表。</p>
            </div>
            <div className="grid gap-3 lg:grid-cols-[1fr_180px_auto] lg:items-end">
              <label className="block">
                <span className="text-xs font-medium text-muted-foreground">假设</span>
                <Input
                  value={hypothesisTitle}
                  onChange={(event) => setHypothesisTitle(event.target.value)}
                  className="mt-2 h-9"
                  placeholder="例如：台积电玻璃基板催化可能扩散到PCB材料链"
                  aria-label="新建假设标题"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-muted-foreground">细分</span>
                <Input
                  value={hypothesisSegments}
                  onChange={(event) => setHypothesisSegments(event.target.value)}
                  className="mt-2 h-9 text-xs"
                  placeholder="玻璃基板,PCB,CCL"
                  aria-label="新建假设细分环节"
                />
              </label>
              <Button size="sm" className="h-9" onClick={() => createHypothesis(true)} disabled={running || !canCreateHypothesis}>
                <PlusCircle className="h-3.5 w-3.5" />
                创建并跟踪
              </Button>
            </div>
          </div>
        </div>

        {discoveryCandidates.length > 0 && (
          <div className="mt-4 rounded-lg border bg-background p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="text-sm font-medium">候选假设</div>
              <div className="text-xs text-muted-foreground">
                {discoverRun?.summary?.questionsDesigned ?? 0} 个问题 · {discoverRun?.summary?.sourcesScanned ?? 0} 个来源
              </div>
            </div>
            <div className="grid gap-2 lg:grid-cols-2">
              {discoveryCandidates.slice(0, 6).map((item, index) => (
                <CandidateHypothesisCard
                  key={textValue(item.id, String(index))}
                  item={item}
                  running={running}
                  onTrack={() => trackCandidateHypothesis(item)}
                  onPrecheck={() => {
                    setAskResultOrigin({
                      kind: "candidate",
                      action: "precheck",
                      title: textValue(item.title, "候选新假设"),
                      signalType: textValue(item.signalType, "候选新假设"),
                      sourceRef: textValue(item.discoverySourceRef ?? item.sourceRef, ""),
                      sourceExcerpt: textValue(item.sourceExcerpt, ""),
                    })
                    void runCandidateAskPrecheck(item)
                  }}
                />
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="rounded-lg border bg-card p-4">
        <div className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="font-medium">2. 假设跟踪表</h3>
            <p className="mt-1 text-xs text-muted-foreground">新增资料进来后点“扫描新增资料”；表格会显示建议状态，确认后才写入假设库。</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => selectHypothesis("", "全部假设")} disabled={running || !selectedHypothesisId}>
              <Database className="h-3.5 w-3.5" />
              全部假设
            </Button>
            <Button variant="outline" size="sm" onClick={() => refresh(false, "auto")} disabled={running}>
              {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <SearchCheck className="h-3.5 w-3.5" />}
              {scanModeSummary.buttonLabel}
            </Button>
            <Button size="sm" onClick={confirmSelectedStatus} disabled={running || !selectedHypothesis || !selectedSignal || selectedSignal.suggestedStatus === textValue(selectedHypothesis.status, "")}>
              <Save className="h-3.5 w-3.5" />
              确认状态
            </Button>
          </div>
        </div>

        {hypothesisRows.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-background p-6 text-center">
            <div className="text-sm text-muted-foreground">暂无假设。先点“AI 并发发现假设”，或手动创建一条。</div>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => setShowAdvanced(true)}>
              <PlusCircle className="h-3.5 w-3.5" />
              手动创建入口
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <div className="grid min-w-[1120px] grid-cols-[minmax(280px,1.3fr)_130px_130px_minmax(280px,1fr)_220px] border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
              <div>假设</div>
              <div>当前状态</div>
              <div>建议状态</div>
              <div>最新信号 / 轨迹</div>
              <div className="text-right">操作</div>
            </div>
            <div className="divide-y">
              {workbenchHypothesisRows.map((item, index) => (
                <HypothesisTrackingRow
                  key={textValue(item.id, String(index))}
                  item={item}
                  signal={hypothesisSignalsById[textValue(item.id, "")] ?? latestSignalForHypothesis(item, watchRun)}
                  selected={textValue(item.id, "") === selectedHypothesisId}
                  running={running}
                  askCache={askCacheStatusForHypothesis(item)}
                  onSelect={() => selectHypothesis(textValue(item.id, ""), textValue(item.title))}
                  onAsk={() => {
                    const signal = hypothesisSignalsById[textValue(item.id, "")] ?? latestSignalForHypothesis(item, watchRun)
                    void askHypothesisWithFeedback(item, signal, "hypothesis-row")
                  }}
                  onConfirm={() => confirmHypothesisStatusWithFeedback(item, hypothesisSignalsById[textValue(item.id, "")] ?? latestSignalForHypothesis(item, watchRun), "hypothesis-row")}
                  onPrepareDefinition={() => prepareHypothesisDefinitionDraft(item)}
                />
              ))}
            </div>
          </div>
        )}

        {selectedHypothesis && selectedTimelineBrief && (
          <HypothesisTimelineDetailPanel
            brief={selectedTimelineBrief}
            qualityBrief={buildHypothesisQualityBrief(selectedHypothesis)}
            wikiFrameCopy={selectedWikiFrameCopy}
            running={running}
            canConfirm={selectedTimelineCanConfirm}
            onAsk={() => {
              void askHypothesisWithFeedback(selectedHypothesis, selectedSignal ?? undefined, "selected-hypothesis")
            }}
            onConfirm={confirmSelectedStatus}
            onScan={() => refresh(false, "auto")}
            onPrepareDefinition={() => prepareHypothesisDefinitionDraft(selectedHypothesis)}
          />
        )}

        {statusUpdateRun?.writeResult && (
          <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100" role="status" aria-live="polite">
            <div className="flex items-center gap-1.5 font-medium">
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>{statusUpdateNotice.headline}</span>
            </div>
            <div className="mt-2 grid gap-2 lg:grid-cols-3">
              <div className="rounded-md bg-background/60 px-2 py-1.5">
                <div className="font-medium">{statusUpdateNotice.outcomeLabel}</div>
                <div className="mt-0.5 leading-5 opacity-85">{statusUpdateNotice.transitionLabel}</div>
              </div>
              <div className="rounded-md bg-background/60 px-2 py-1.5">
                <div className="font-medium">下一步</div>
                <div className="mt-0.5 leading-5 opacity-85">{statusUpdateNotice.nextAction}</div>
              </div>
              <div className="rounded-md bg-background/60 px-2 py-1.5">
                <div className="font-medium">边界</div>
                <div className="mt-0.5 leading-5 opacity-85">{statusUpdateNotice.guardrail}</div>
              </div>
            </div>
            <div className="mt-2 leading-5 font-medium opacity-90">{statusUpdateNotice.outcomeDetail}</div>
            <div className="mt-2 leading-5 opacity-80">{statusUpdateNotice.detail}</div>
            <div className="mt-2 rounded-md bg-background/60 px-2 py-1.5 leading-5 opacity-85">
              {statusUpdateNotice.storageLine}
            </div>
            <div className="mt-2 grid gap-1 leading-5 sm:grid-cols-[72px_minmax(0,1fr)]">
              <span className="font-medium opacity-75">假设卡片</span>
              <span className="truncate" title={statusUpdateNotice.hypothesisPath}>{statusUpdateNotice.hypothesisPath}</span>
              <span className="font-medium opacity-75">审计事件</span>
              <span className="truncate" title={statusUpdateNotice.eventPath}>{statusUpdateNotice.eventPath}</span>
              <span className="font-medium opacity-75">Ask证据</span>
              <span className="truncate" title={statusUpdateRun.askRunRef || statusUpdateNotice.askEvidenceLine}>{statusUpdateNotice.askEvidenceLine}</span>
            </div>
          </div>
        )}

        <HypothesisEnginePanel
          selectedHypothesis={selectedHypothesis ?? null}
          feedback={selectedHypothesisFeedback}
          postMortemDraft={selectedPostMortemDraft}
          verifyRun={hypothesisVerifyRun}
          running={running}
          onRefresh={() => void refreshHypothesisEvidenceFeedback(false)}
          onWriteFeedback={() => void refreshHypothesisEvidenceFeedback(true)}
          onConfirmRecommendation={() => void confirmFeedbackRecommendation()}
          onDraftPostMortem={() => void draftSelectedPostMortem(false)}
          onWritePostMortem={() => void draftSelectedPostMortem(true)}
        />
      </section>

      <div className={cn(!showAdvanced && "hidden")}>
        <WatchAnswerCard answer={watchAnswer} onPrepareGap={prepareSupplementForGap} />
      </div>

      {askDeepDivePending && (
        <AskPendingCard
          ref={askResultRef}
          copy={askPanelCopy}
          locator={askLocatorCopy}
          located={askLocatedNoticeCopy}
          readingGuide={askResultReadingGuide}
          liveTask={askLiveTaskTicket}
          slots={buildAskPendingSkeletonTiles({ isPrecheck: askResultIsPrecheck })}
          title={askDisplayTitle}
          detail={runningStage?.detail || latestLog?.detail || "正在调用 ask --agentic，多智能体会先检索 wiki/raw/行情，再生成六段回答。"}
        />
      )}

      {askErrorVisible && askErrorState && (
        <AskErrorCard
          ref={askResultRef}
          state={askErrorState}
          title={askDisplayTitle}
          onBackToSignals={() => signalTodoListRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
        />
      )}

      {hypothesisAskRun && (
        <section ref={askResultRef} id="ask-result" aria-live="polite" className="scroll-mt-4 rounded-lg border bg-card p-4">
          <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn(
                  "rounded-md px-2 py-1 text-xs font-medium",
                  askPanelCopy.tone === "done" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
                  askPanelCopy.tone === "warning" && "bg-amber-500/10 text-amber-800 dark:text-amber-200",
                  askPanelCopy.tone === "running" && "bg-primary/10 text-primary",
                )}>
                  {askPanelCopy.badge}
                </span>
                <span className="text-xs text-muted-foreground">{askResultTitle}</span>
              </div>
              <h3 className="mt-2 font-medium">{askPanelCopy.title}</h3>
              <p className="mt-1 text-xs text-muted-foreground">{askPanelCopy.detail}</p>
              {askResultIsPrecheck && (
                <p className="mt-1 text-xs text-muted-foreground">候选：{textValue(hypothesisAskRun.hypothesis?.title, "未命名候选")}</p>
              )}
            </div>
            {askResultIsPrecheck && (
              <div className="flex shrink-0 flex-col items-start gap-1 lg:items-end">
                {precheckAdoptionCopy.adoptedLabel ? (
                  <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                    <div className="rounded-md bg-emerald-500/10 px-2 py-1 text-xs text-emerald-700 dark:text-emerald-300">
                      {precheckAdoptionCopy.adoptedLabel}
                    </div>
                    {precheckAdoptionCopy.canScan && (
                      <Button variant="outline" size="sm" onClick={() => void scanAdoptedPrecheckHypothesis()} disabled={running}>
                        <SearchCheck className="h-3.5 w-3.5" />
                        只扫这条假设
                      </Button>
                    )}
                  </div>
                ) : (
                  <Button size="sm" onClick={() => void adoptCandidateAskPrecheck()} disabled={running || !precheckAdoptionCopy.canAdopt}>
                    <PlusCircle className="h-3.5 w-3.5" />
                    采纳并加入跟踪
                  </Button>
                )}
                <div className="text-xs text-muted-foreground">{precheckAdoptionCopy.detail}</div>
              </div>
            )}
            {!askResultIsPrecheck && hypothesisAskRun.hypothesis && (
              <div className="flex shrink-0 flex-col items-start gap-1 lg:items-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void askSelectedHypothesis(hypothesisAskRun.hypothesis ?? {}, {}, { forceRefresh: true })}
                  disabled={running}
                  title="忽略本地最近结果，重新调用 ask --agentic 检索 wiki/raw/行情。"
                >
                  {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <SearchCheck className="h-3.5 w-3.5" />}
                  {askReuseCopy.actionLabel}
                </Button>
                <div className="text-xs text-muted-foreground">需要最新资料或来源变化时再点</div>
              </div>
            )}
          </div>
          <AskResultLocatorStrip copy={askLocatorCopy} located={askLocatedNoticeCopy} />
          <AskResultReadingGuideCard guide={askResultReadingGuide} onJump={jumpToAskResultSection} />
          <AskResultOriginCard copy={askResultOriginCopy} />
          <AskLiveTaskTicketCard ticket={askLiveTaskTicket} />
          <AskResultActionGuideCard
            guide={askResultActionGuide}
            copied={askFollowUpCopied}
            onPrimary={runAskResultGuidePrimaryAction}
          />
          <AskDecisionCard
            snapshot={askDecisionSnapshot}
            conclusion={askDeepDiveSummary.conclusion}
            nextAction={askDeepDiveSummary.nextAction}
          />
          <AskResultMiniIndex items={askResultMiniIndex} onJump={jumpToAskResultSection} />
          {askReuseCopy.show && (
            <div className="mb-3 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs leading-5 text-blue-900 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-100" role="status" aria-live="polite">
              <div className="font-medium">{askReuseCopy.label}</div>
              <div className="mt-0.5 opacity-85">{askReuseCopy.detail}</div>
            </div>
          )}
          {askPanelCopy.steps.length > 0 && (
            <div className="mb-3">
              <AskProgressSteps steps={askPanelCopy.steps} />
            </div>
          )}
          {askAnswerMissing && (
            <AskAnswerMissingNotice sourceCount={askReturnedSourceCount} />
          )}
          <AskSourceSnapshotCard snapshot={askSourceSnapshot} />
          <AskObservationActionBar
            copy={askObservationActionCopy}
            onPrimary={runAskObservationPrimaryAction}
            onCopy={copyAskObservationChecklist}
          />
          <AskResearchTicketCard
            ticket={askResearchTicket}
            checklist={askObservationChecklist}
            copied={observationChecklistCopied}
            queued={askObservationQueued}
            onCopy={copyAskObservationChecklist}
            onQueue={addAskObservationToQueue}
          />
          <AskFollowUpActionCard
            action={askFollowUpAction}
            copied={askFollowUpCopied}
            running={running}
            onCopy={copyAskFollowUpPrompt}
            onRetry={retryAskFollowUp}
          />
          <AskWikiFrameHintCard hint={askWikiFrameHint} />
          <AskStructureFeedbackNotice feedback={askStructureFeedback} />
          <div id="ask-result-summary" className="mb-3 grid scroll-mt-20 gap-2 md:grid-cols-2 xl:grid-cols-3">
            <SummaryTile id="ask-result-stocks" label="关联股票" value={askSummaryTiles.stocks} />
            <SummaryTile label="最直接受益" value={askSummaryTiles.directBeneficiary} />
            <SummaryTile id="ask-result-ranking" label="利好排序" value={askSummaryTiles.ranking} />
            <SummaryTile label="当前阶段" value={askSummaryTiles.stage} />
            <SummaryTile label="最大缺口" value={askSummaryTiles.gap} />
            <SummaryTile label="一句话结论" value={askSummaryTiles.conclusion} />
          </div>
          <AskObservationChecklistCard
            checklist={askObservationChecklist}
            copied={observationChecklistCopied}
            queued={askObservationQueued}
            onCopy={copyAskObservationChecklist}
            onQueue={addAskObservationToQueue}
          />
          <ObservationQueuePanel
            items={observationQueue}
            savingKey={observationDraftSavingKey}
            savedRuns={observationDraftRuns}
            onSave={saveObservationDraft}
          />
          <SavedObservationDraftsPanel
            run={observationDraftList}
            loading={observationDraftListLoading}
            onRefresh={refreshObservationDrafts}
          />
          <div className="grid gap-3 lg:grid-cols-[1fr_260px]">
            <details id="ask-result-answer" open={askAnswerPanelCopy.openByDefault} className="scroll-mt-20 min-w-0 rounded-md border bg-background p-3">
              <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                {askAnswerPanelCopy.summaryLabel}
              </summary>
              <AskAnswerPanelHeader copy={askAnswerPanelCopy} />
              <pre className="mt-3 max-h-[520px] whitespace-pre-wrap break-words text-xs leading-6">{askAnswerText || askAnswerPanelCopy.emptyText}</pre>
            </details>
            <div id="ask-result-sources" className="scroll-mt-20 space-y-3">
              <SmallStat label="导航页" value={askNavigationSourceCount} />
              <SmallStat label="wiki 框架" value={askWikiSourceCount} />
              <SmallStat label="新增资料" value={askRawSourceCount} />
              <SmallStat label="结构化事实" value={askFactsSourceCount} />
              <SmallStat label="历史记忆" value={askBrainSourceCount} />
              <SmallStat label="行情量价" value={askStockDailySourceCount} />
              <div className="rounded-md border bg-background p-3">
                <div className="text-xs font-medium text-muted-foreground">查询</div>
                <div className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground">
                  {hypothesisAskRun.query}
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      <section className="rounded-lg border bg-card p-4">
        <button
          type="button"
          onClick={() => setShowAdvanced((value) => !value)}
          className="flex w-full items-center justify-between text-left"
          aria-expanded={showAdvanced}
        >
          <span>
            <span className="font-medium">高级实验室</span>
            <span className="ml-2 text-xs text-muted-foreground">补证、实验账本、proposal、自训练和完整阶段日志</span>
          </span>
          <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", showAdvanced && "rotate-180")} />
        </button>
        {showAdvanced && (
          <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
            <label className="block">
              <span className="text-xs font-medium text-muted-foreground">深度问题 / agentic ask 任务</span>
              <Input
                value={deepQuestion}
                onChange={(event) => setDeepQuestion(event.target.value)}
                className="mt-2"
                aria-label="深度问题"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={refreshLoopState} disabled={running}>
                <GitBranch className="h-3.5 w-3.5" />
                闭环状态
              </Button>
              <Button variant="outline" size="sm" onClick={runFullDryLoop} disabled={running}>
                <Play className="h-3.5 w-3.5" />
                dry-run 闭环
              </Button>
              <Button variant="outline" size="sm" onClick={() => proposePolicy(false)} disabled={running}>
                <Lightbulb className="h-3.5 w-3.5" />
                策略建议 dry-run
              </Button>
              <Button variant="outline" size="sm" onClick={() => planSelfTraining(false)} disabled={running}>
                <Brain className="h-3.5 w-3.5" />
                自训练计划 dry-run
              </Button>
              <Button variant="outline" size="sm" onClick={() => planSelfTraining(true)} disabled={running || selfTrainActions === 0}>
                <FileCheck2 className="h-3.5 w-3.5" />
                写入训练计划
              </Button>
              <Button size="sm" onClick={() => proposePolicy(true)} disabled={running || proposalItems === 0}>
                <Save className="h-3.5 w-3.5" />
                写入 proposal
              </Button>
            </div>
          </div>
        )}
      </section>

      <section ref={supplementSectionRef} className={cn("rounded-lg border bg-card p-4", !showAdvanced && "hidden")}>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="font-medium">补证对话 / 数据源搜集</h3>
            <p className="mt-1 text-xs text-muted-foreground">先把资料丢进来，LLM 整理成补证草稿；再提交给 Watchtower 扫描假设。</p>
          </div>
          <span className="text-xs text-muted-foreground">{supplementRun?.writeResult?.markdownRelativePath ?? "必须先 LLM 处理"}</span>
        </div>

        <label className="block">
          <span className="text-xs font-medium text-muted-foreground">资料 / 问题 / API搜集指令</span>
          <textarea
            value={supplementBody}
            onChange={(event) => {
              setSupplementBody(event.target.value)
              setSupplementDraftRun(null)
            }}
            className="mt-2 min-h-36 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
            placeholder="粘贴路演要点、表格摘要、公告片段、调研结论；也可以写：请去 IMA 知识库/CNINFO/企查查/Tushare 补 MPO 订单、ASP、客户份额、财报验证。"
            aria-label="补证对话输入"
          />
        </label>

        <div className="mt-3">
          <div className="mb-2 text-xs font-medium text-muted-foreground">选择数据源能力</div>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
            {SUPPLEMENT_SOURCE_OPTIONS.map((item) => (
              <SupplementSourceOption
                key={item.id}
                option={item}
                selected={selectedSupplementSources.includes(item.id)}
                onToggle={() => toggleSupplementSource(item.id)}
              />
            ))}
          </div>
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_180px_140px]">
          <label className="block">
            <span className="text-xs font-medium text-muted-foreground">LLM草稿标题</span>
            <Input
              value={supplementTitle}
              onChange={(event) => setSupplementTitle(event.target.value)}
              className="mt-2 h-8 text-xs"
              aria-label="补充资料标题"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-muted-foreground">假设 ID</span>
            <Input
              value={supplementHypothesisId}
              onChange={(event) => setSupplementHypothesisId(event.target.value)}
              className="mt-2 h-8 text-xs"
              placeholder="可选"
              aria-label="补充资料关联假设 ID"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-muted-foreground">类型</span>
            <Input
              value={supplementKind}
              onChange={(event) => setSupplementKind(event.target.value)}
              className="mt-2 h-8 text-xs"
              aria-label="补充资料类型"
            />
          </label>
        </div>
        <label className="mt-3 block">
          <span className="text-xs font-medium text-muted-foreground">来源 / 文件 / 表格引用</span>
          <Input
            value={supplementRefs}
            onChange={(event) => {
              setSupplementRefs(event.target.value)
              setSupplementDraftRun(null)
            }}
            className="mt-2 h-8 text-xs"
            placeholder="IMA知识库名、/path/to/roadshow.pdf、表格名、CNINFO公告链接、企查查线索"
            aria-label="补充资料来源引用"
          />
        </label>

        {supplementDraftRun?.draft && (
          <div className="mt-3 rounded-md border bg-background p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              <span className="text-sm font-medium">LLM 已整理</span>
              <span className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">{supplementDraftRun.draft.evidenceDelta}</span>
              <span className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">{supplementDraftRun.provider ?? "codex"}</span>
            </div>
            <div className="mt-3 grid gap-3 lg:grid-cols-3">
              <div>
                <div className="text-xs font-medium text-muted-foreground">提取要点</div>
                <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
                  {(supplementDraftRun.draft.extractedPoints ?? []).slice(0, 4).map((item, index) => <li key={index}>- {item}</li>)}
                </ul>
              </div>
              <div>
                <div className="text-xs font-medium text-muted-foreground">证据缺口</div>
                <EvidenceGapTaskList
                  codes={supplementDraftRun.draft.evidenceGaps ?? []}
                  onPrepareGap={prepareSupplementForGap}
                  compact
                />
              </div>
              <div>
                <div className="text-xs font-medium text-muted-foreground">建议数据源</div>
                <div className="mt-1 text-xs text-muted-foreground">{supplementDraftRun.draft.suggestedSources?.join(", ") || "暂无"}</div>
              </div>
            </div>
            {supplementDraftRun.externalContext?.ima && (
              <div className="mt-3 rounded-md border bg-muted/30 p-3 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <Database className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="font-medium">IMA 快搜</span>
                  <span className="text-muted-foreground">命中 {supplementDraftRun.externalContext.ima.hits?.length ?? 0} 条</span>
                  {supplementDraftRun.externalContext.ima.warning && (
                    <span className="text-amber-600">{supplementDraftRun.externalContext.ima.warning}</span>
                  )}
                </div>
                {(supplementDraftRun.externalContext.ima.hits ?? []).slice(0, 3).map((hit, index) => (
                  <div key={index} className="mt-2 min-w-0 rounded-md bg-background px-2 py-1">
                    <div className="truncate font-medium">{textValue(hit.title, "IMA 命中资料")}</div>
                    <div className="mt-0.5 truncate text-muted-foreground">{textValue(hit.knowledgeBaseName, "knowledge base")}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={processSupplementWithLlm} disabled={running || !hasSupplementBody}>
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            LLM处理资料
          </Button>
          <Button variant="outline" size="sm" onClick={() => submitSupplement(false)} disabled={running || !hasLlmSupplementDraft}>
            <FilePlus2 className="h-3.5 w-3.5" />
            预览补资料
          </Button>
          <Button size="sm" onClick={() => submitSupplement(true)} disabled={running || !hasLlmSupplementDraft}>
            <Save className="h-3.5 w-3.5" />
            提交并扫描
          </Button>
          {supplementRun?.dryRun === false && (
            <span className="text-xs text-muted-foreground">已进入补证队列，alerts 仍需确认写入。</span>
          )}
        </div>
      </section>

      <div className={cn("grid gap-3 md:grid-cols-2 xl:grid-cols-5", !showAdvanced && "hidden")}>
        <Metric icon={Database} label="假设数" value={summary?.hypothesisCount ?? 0} />
        <Metric icon={Bell} label="open alerts" value={summary?.openAlertCount ?? 0} />
        <Metric icon={Clock} label="今日触发" value={summary?.triggeredTodayCount ?? 0} />
        <Metric icon={ShieldCheck} label="接近可下注" value={summary?.strengtheningCount ?? 0} />
        <Metric icon={AlertTriangle} label="priced-in 风险" value={summary?.pricedInRiskCount ?? 0} />
      </div>

      <div className={cn("grid gap-3 md:grid-cols-2 xl:grid-cols-5", !showAdvanced && "hidden")}>
        <Metric icon={Sparkles} label="自提问阶段" value={numberValue(selfQuestionCounts.questions ?? selfQuestionCounts.questionCount) || loopStageCount} />
        <Metric icon={FileCheck2} label="实验记录" value={numberValue(autoresearchCounts.experimentCount ?? autoresearchLedger?.totalEntries)} />
        <Metric icon={Lightbulb} label="策略建议" value={proposalItems} />
        <Metric icon={ClipboardList} label="待审动作" value={selfTrainActions || trainingPlanItemCount} />
        <Metric icon={Brain} label="样本/agent" value={exportEntries || agenticSourceCount} />
      </div>

      <section className={cn("rounded-lg border bg-card p-4", !showAdvanced && "hidden")}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-medium">假设状态列表</h3>
          <span className="text-xs text-muted-foreground">persisted status / feedback status</span>
        </div>
        {hypothesisRows.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-background p-6 text-center text-sm text-muted-foreground">
            暂无假设，先用 hypothesis create 或自提问生成种子假设。
          </div>
        ) : (
          <div className="grid gap-2 lg:grid-cols-2">
            {hypothesisRows.map((item, index) => (
              <HypothesisStateRow
                key={textValue(item.id, String(index))}
                item={item}
                selected={textValue(item.id, "") === selectedHypothesisId}
                onSelect={() => selectHypothesis(textValue(item.id, ""), textValue(item.title))}
              />
            ))}
          </div>
        )}
        <div className="mt-4 grid gap-2 md:grid-cols-4">
          {HYPOTHESIS_STATUS_LABELS.map((item) => (
            <div key={item.status} className="rounded-lg border bg-background p-2">
              <div className="flex items-center gap-2">
                <StatusBadge status={item.status} />
                <span className="text-xs font-medium">{item.label}</span>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">{item.body}</div>
            </div>
          ))}
        </div>
      </section>

      <div className={cn("grid gap-5 xl:grid-cols-[1fr_1.25fr]", !showAdvanced && "hidden")}>
        <section className="rounded-lg border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-medium">阶段进度</h3>
            <span className="text-xs text-muted-foreground">{lastRunAt ? `上次 ${lastRunAt}` : "未运行"}</span>
          </div>
          <div className="space-y-2">
            {stages.map((stage) => (
              <StageRow key={stage.id} stage={stage} />
            ))}
          </div>
          {error && (
            <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
              {error}
            </div>
          )}
        </section>

        <section className="rounded-lg border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-medium">新增资料观察</h3>
            <span className="text-xs text-muted-foreground">30 秒轮询</span>
          </div>
          <div className="mb-4 grid gap-2 lg:grid-cols-[1fr_auto] lg:items-end">
            <label className="block">
              <span className="text-xs font-medium text-muted-foreground">未登录 fallback 文件源</span>
              <Input
                value={rawChatSource}
                onChange={(event) => setRawChatSource(event.target.value)}
                className="mt-2 h-8 text-xs"
                aria-label="新增资料文件源"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => importRawChat(false)} disabled={running}>
                <FolderOpen className="h-3.5 w-3.5" />
                raw 预览
              </Button>
              <Button variant="outline" size="sm" onClick={() => importRawChat(true)} disabled={running}>
                <Save className="h-3.5 w-3.5" />
                导入并扫描
              </Button>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-4">
            <SmallStat label="已处理" value={inboxStatus?.state?.messageCount ?? 0} />
            <SmallStat label="new" value={processRun?.summary?.messagesWritten ?? 0} />
            <SmallStat label="duplicate" value={inboxStatus?.state?.duplicateCount ?? 0} />
            <SmallStat label="errors" value={inboxStatus?.state?.errorCount ?? 0} tone="warn" />
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <SmallStat label="raw files" value={rawChatFiles} />
            <SmallStat label="原始条目" value={rawChatMessages} />
            <SmallStat label="raw written" value={rawChatRecordsWritten} />
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <SmallStat label="dry-run events" value={dryRunEvents.length} />
            <SmallStat label="dry-run alerts" value={dryRunAlerts.length} />
            <SmallStat label="candidate hypotheses" value={visibleCandidateHypotheses.length} />
          </div>
          {rawChatImportRun?.sourceMissing && (
            <div className="mt-3 rounded-lg border border-dashed bg-background p-3 text-xs text-muted-foreground">
              当前没有找到这个 fallback 源：{textValue(rawChatImportRun.sourcePath, rawChatSource)}
            </div>
          )}
        </section>
      </div>

      <div className={cn("grid gap-5 xl:grid-cols-[1fr_1fr]", !showAdvanced && "hidden")}>
        <section className="rounded-lg border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-medium">阶段输出</h3>
            <span className="text-xs text-muted-foreground">阶段级，不做 token 流</span>
          </div>
          {activityLog.length === 0 ? (
            <div className="rounded-lg border border-dashed bg-background p-6 text-center text-sm text-muted-foreground">
              运行刷新、dry-run 闭环或确认写入后，这里会显示每个阶段的输出。
            </div>
          ) : (
            <div className="max-h-72 space-y-2 overflow-auto pr-1">
              {activityLog.map((entry) => (
                <ActivityLogRow key={entry.id} entry={entry} />
              ))}
            </div>
          )}
        </section>

        <section className="rounded-lg border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-medium">Hypothesis Library</h3>
            <span className="text-xs text-muted-foreground">生命周期对象</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <RoleTile icon={Database} title="主观投资里的因子库" body="每条假设有状态、证据链、赔率变化和失效条件。" />
            <RoleTile icon={Brain} title="自训练系统的记忆体" body="验证、归因、错误类型和经验教训可沉淀为样本。" />
            <RoleTile icon={Sparkles} title="多智能体研究任务池" body="agentic ask、反证、市场验证围绕假设发起任务。" />
            <RoleTile icon={GitBranch} title="反馈和归因承载对象" body="价格、公告、订单、财报和调研反馈回到同一条假设。" />
          </div>
        </section>
      </div>

      <div className={cn("grid gap-5 xl:grid-cols-2", !showAdvanced && "hidden")}>
        <ListPanel
          title="待确认 alerts"
          empty="暂无待确认 alerts"
          items={topAlerts.length ? topAlerts : openAlerts}
          render={(item) => (
            <AlertItem item={item} onPrepareGap={prepareSupplementForGap} />
          )}
        />
        <ListPanel
          title="候选新假设"
          empty="暂无候选新假设"
          items={visibleCandidateHypotheses.slice(0, 6)}
          render={(item) => {
            const metaLine = buildCandidateThemeSegmentLine({ theme: item.theme, segments: item.segments })
            return (
              <div>
                <div className="font-medium">{textValue(item.title)}</div>
                <div className="mt-1 text-xs text-muted-foreground">{metaLine}</div>
              </div>
            )
          }}
        />
      </div>

      <div className={cn("grid gap-5 xl:grid-cols-3", !showAdvanced && "hidden")}>
        <ListPanel
          title="策略改进建议"
          empty="暂无策略建议，先运行策略建议 dry-run"
          items={proposalList.slice(0, 6)}
          render={(item) => (
            <div>
              <div className="font-medium">{textValue(item.changedArtifact || item.artifact || item.target, "policy proposal")}</div>
              <div className="mt-1 text-xs text-muted-foreground">{textValue(item.reason || item.rationale || item.summary || item.decision, "等待证据闭环")}</div>
              <div className="mt-2 text-xs text-amber-600">{textValue(item.risk || item.risks, "") || evidenceGapLabels(item.evidenceGaps)}</div>
            </div>
          )}
        />
        <ListPanel
          title="自训练待审动作"
          empty="暂无待审动作，先运行自训练计划 dry-run"
          items={selfTrainActionList.slice(0, 6)}
          render={(item) => (
            <div>
              <div className="font-medium">{textValue(item.action || item.title || item.rule, "self-training action")}</div>
              <div className="mt-1 text-xs text-muted-foreground">{textValue(item.target || item.reason || item.description, "等待人工审核")}</div>
              <div className="mt-2 text-xs text-muted-foreground">{textValue(item.status || item.quality || item.priority, "")}</div>
            </div>
          )}
        />
        <ListPanel
          title="实验账本"
          empty="暂无实验记录"
          items={experimentList.slice(0, 6)}
          render={(item) => (
            <div>
              <div className="font-medium">{textValue(item.hypothesis || item.programId || item.id, "experiment")}</div>
              <div className="mt-1 text-xs text-muted-foreground">{textValue(item.changedArtifact || item.decision || item.status, "review_required")}</div>
              <div className="mt-2 text-xs text-muted-foreground">{textValue(item.scoreDelta || item.newScore || item.baselineScore, "")}</div>
            </div>
          )}
        />
      </div>

      {showAdvanced && (
        <ListPanel
          title="证据缺口"
          empty="暂无证据缺口统计"
          items={evidenceGaps.slice(0, 8)}
          render={(item) => (
            <EvidenceGapTaskRow
              info={describeEvidenceGap(item.gap)}
              count={item.count}
              onPrepareGap={prepareSupplementForGap}
            />
          )}
        />
      )}
    </div>
  )
}

function TodaySignalSourcePanel({
  rawChatSource,
  onRawChatSourceChange,
  sourcePresets,
  onSelectPreset,
  selectedSource,
  candidates,
  sourceMissing,
  usingRecentFallback,
  lastRunAt,
  autoRefresh,
  autoScanSeconds,
  since,
  running,
  rawChatFiles,
  rawChatMessages,
  newMessageCount,
  matchedCount,
  pendingCount,
  scanScope,
  scanMode,
  capability,
  processRun,
  inboxStatus,
  onSinceChange,
  onChooseFile,
  onChooseFolder,
  onLoadCandidates,
  onScan,
}: {
  rawChatSource: string
  onRawChatSourceChange: (value: string) => void
  sourcePresets: SignalSourcePreset[]
  onSelectPreset: (source: string) => void
  selectedSource: Record<string, unknown> | null
  candidates: Array<Record<string, unknown>>
  sourceMissing: boolean
  usingRecentFallback: boolean
  lastRunAt: string | null
  autoRefresh: boolean
  autoScanSeconds: number | null
  since: string
  running: boolean
  rawChatFiles: number
  rawChatMessages: number
  newMessageCount: number
  matchedCount: number
  pendingCount: number
  scanScope: ReturnType<typeof buildScanScopeSummary>
  scanMode: ReturnType<typeof buildScanModeSummary>
  capability: ReturnType<typeof buildSignalSourceCapabilityCopy>
  processRun: ProcessRun | null
  inboxStatus: InboxStatus | null
  onSinceChange: (value: string) => void
  onChooseFile: () => void
  onChooseFolder: () => void
  onLoadCandidates: () => void
  onScan: () => void
}) {
  const sourceBrief = buildSelectedSignalSourceBrief({
    currentSource: rawChatSource,
    selectedSource,
    presets: sourcePresets,
  })
  const sourceBriefClass: Record<typeof sourceBrief.tone, string> = {
    wechat: "border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-100",
    research: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100",
    theme: "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100",
    custom: "border-muted bg-muted/30 text-muted-foreground",
  }
  return (
    <section className="rounded-lg border bg-card p-4">
      <div className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h3 className="font-medium">今日信号源</h3>
          <p className="mt-1 text-xs text-muted-foreground">新增资料只用于生成假设变化建议；不替代 AI 并发找假设，不自动确认状态。</p>
          <div className={cn(
            "mt-2 inline-flex max-w-full rounded-md px-2 py-0.5 text-[11px]",
            scanScope.tone === "scoped" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
          )} title={scanScope.detail}>
            <span className="truncate">{scanScope.label} · {scanScope.detail}</span>
          </div>
        </div>
        <span className={cn(
          "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs",
          scanMode.tone === "auto-rules" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200" : "bg-primary/10 text-primary",
        )} title={scanMode.detail}>
          <Radio className="h-3.5 w-3.5" />
          {autoRefresh ? `${scanMode.label}，${autoScanSeconds ?? 30}s 后轮询` : scanMode.label}
        </span>
      </div>

      <div className="mb-3">
        <SignalScanContextNotice copy={capability} />
      </div>

      <div className="mb-3 grid gap-2 md:grid-cols-3">
        {sourcePresets.map((preset) => {
          const active = isSignalSourcePresetActive(rawChatSource, preset, sourcePresets)
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => onSelectPreset(preset.source)}
              disabled={running}
              className={cn(
                "rounded-lg border p-3 text-left transition hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-60",
                active ? "border-primary bg-primary/10 text-primary" : "bg-background",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">{preset.label}</span>
                <span className={cn(
                  "rounded-md px-2 py-0.5 text-[11px]",
                  active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                )}>
                  {active ? "当前" : preset.badge}
                </span>
              </div>
              <p className={cn("mt-1 text-xs leading-5", active ? "text-primary/80" : "text-muted-foreground")}>{preset.detail}</p>
              <p className="mt-1 truncate text-[11px] text-muted-foreground">{preset.source}</p>
            </button>
          )
        })}
      </div>

      <div className={cn("mb-3 rounded-md border px-3 py-2 text-xs leading-5", sourceBriefClass[sourceBrief.tone])}>
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="font-medium">
              当前扫描：{sourceBrief.label} · {sourceBrief.badge}
            </div>
            <div className="mt-0.5 opacity-85">{sourceBrief.detail}</div>
          </div>
          <div className="max-w-full shrink-0 truncate rounded bg-background/70 px-2 py-0.5 opacity-85 sm:max-w-[42%]" title={sourceBrief.sourceLine}>
            {sourceBrief.sourceLine}
          </div>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_92px_auto] lg:items-end">
        <label className="block">
          <span className="text-xs font-medium text-muted-foreground">当前资料文档 / 文件夹</span>
          <Input
            value={rawChatSource}
            onChange={(event) => onRawChatSourceChange(event.target.value)}
            className="mt-2 h-9 text-xs"
            aria-label="当前新增资料文档"
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-muted-foreground">窗口</span>
          <Input
            value={since}
            onChange={(event) => onSinceChange(event.target.value)}
            className="mt-2 h-9 text-xs"
            aria-label="扫描时间窗口"
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={onChooseFile} disabled={running}>
            <FolderOpen className="h-3.5 w-3.5" />
            选择文档
          </Button>
          <Button variant="outline" size="sm" onClick={onChooseFolder} disabled={running}>
            <FolderOpen className="h-3.5 w-3.5" />
            文件夹
          </Button>
          <Button variant="outline" size="sm" onClick={onLoadCandidates} disabled={running}>
            <Database className="h-3.5 w-3.5" />
            候选
          </Button>
          <Button size="sm" onClick={onScan} disabled={running}>
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <SearchCheck className="h-3.5 w-3.5" />}
            {scanMode.buttonLabel}
          </Button>
        </div>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <SmallStat label="最近修改" value={textValue(selectedSource?.mtime, sourceMissing ? "未找到" : "-")} tone={sourceMissing ? "warn" : "default"} />
        <SmallStat label="上次扫描" value={lastRunAt ?? "-"} />
        <SmallStat label="新增资料" value={newMessageCount} />
        <SmallStat label="命中假设" value={matchedCount} tone={matchedCount > 0 ? "warn" : "default"} />
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <SmallStat label="待处理" value={pendingCount} tone={pendingCount > 0 ? "warn" : "default"} />
        <SmallStat label="文件数" value={rawChatFiles} />
        <SmallStat label="累计已处理" value={inboxStatus?.state?.messageCount ?? 0} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>解析条目 {rawChatMessages}</span>
        <span>本轮已处理 {processRun?.summary?.messagesWritten ?? 0}</span>
        {usingRecentFallback && (
          <span className="rounded-md bg-amber-100 px-2 py-0.5 text-amber-700 dark:bg-amber-950 dark:text-amber-200">
            今天文件未找到，正在使用最近资料
          </span>
        )}
      </div>

      {candidates.length > 0 && (
        <div className="mt-3 rounded-md border bg-background p-2">
          <div className="mb-2 text-xs font-medium text-muted-foreground">候选新增资料</div>
          <div className="max-h-32 space-y-1 overflow-auto">
            {candidates.slice(0, 8).map((item, index) => {
              const sourceRef = textValue(item.sourceRef, "")
              const sourceKindLabel = textValue(item.sourceKindLabel, "新增资料")
              return (
                <button
                  type="button"
                  key={sourceRef || index}
                  onClick={() => onRawChatSourceChange(sourceRef)}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted",
                    sourceRef === rawChatSource && "bg-primary/10 text-primary",
                  )}
                >
                  <span className="min-w-0 truncate">{sourceRef || textValue(item.sourcePath)}</span>
                  <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{sourceKindLabel}</span>
                  <span className="shrink-0 text-muted-foreground">{textValue(item.mtime, "-")}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </section>
  )
}

function relatedWikiToneClass(tone: ReturnType<typeof buildRelatedWikiSummary>["tone"]) {
  if (tone === "support") return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
  if (tone === "catalyst") return "bg-primary/10 text-primary"
  if (tone === "market") return "bg-amber-500/10 text-amber-700 dark:text-amber-300"
  if (tone === "counter") return "bg-destructive/10 text-destructive"
  return "bg-muted text-muted-foreground"
}

function wikiMetaBadgeClass(tone: ReturnType<typeof buildWikiMetaBadges>[number]["tone"]) {
  if (tone === "active") return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
  if (tone === "confidence") return "bg-sky-500/10 text-sky-700 dark:text-sky-300"
  if (tone === "hot") return "bg-amber-500/10 text-amber-700 dark:text-amber-300"
  if (tone === "catalyst") return "bg-primary/10 text-primary"
  if (tone === "updated") return "bg-background/80 text-muted-foreground"
  if (tone === "source") return "bg-muted text-muted-foreground"
  return "bg-background text-muted-foreground"
}

function wikiFrameFirstLookClass(tone: ReturnType<typeof buildWikiFrameFirstLookCopy>["tone"]) {
  if (tone === "hot") return "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100"
  if (tone === "active") return "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100"
  if (tone === "stale") return "border-muted bg-muted/60 text-muted-foreground"
  return "border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-100"
}

function workPriorityClass(tier: ReturnType<typeof buildHypothesisWorkPriority>["tier"]) {
  if (tier === "today") return "border-primary/30 bg-primary/10 text-primary"
  if (tier === "ask") return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
  if (tier === "quiet") return "border-muted bg-muted text-muted-foreground"
  return "border-border bg-background text-muted-foreground"
}

function RelatedWikiPages({
  pages,
  evidenceDelta,
  signalType,
}: {
  pages: Array<Record<string, unknown>>
  evidenceDelta?: unknown
  signalType?: unknown
}) {
  const project = useWikiStore((s) => s.project)
  const setSelectedFile = useWikiStore((s) => s.setSelectedFile)
  const visible = arrayRecords(pages).slice(0, 3)
  if (!visible.length) {
    const empty = buildRelatedWikiEmptyHint({ evidenceDelta, signalType })
    return (
      <div className="mt-2 flex items-start gap-1.5 rounded-md bg-muted/40 px-2 py-1.5 text-[11px] leading-5 text-muted-foreground">
        <Database className="mt-0.5 h-3 w-3 shrink-0" />
        <div>
          <span className="font-medium">{empty.label}：</span>
          <span>{empty.detail}</span>
        </div>
      </div>
    )
  }
  const summary = buildRelatedWikiSummary({ pages: visible, evidenceDelta, signalType })
  const metaBadges = buildWikiMetaBadges(visible)
  const openWikiPage = (sourceRef: string) => {
    if (!project?.path || !sourceRef.startsWith("wiki/") || sourceRef.includes("..")) return
    setSelectedFile(`${project.path}/${sourceRef}`)
  }
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
      <span
        className={cn("inline-flex items-center gap-1 rounded-md px-2 py-0.5", relatedWikiToneClass(summary.tone))}
        title={summary.summary}
      >
        <Database className="h-3 w-3" />
        {summary.label}
        <span className="opacity-80">{summary.countText}</span>
        {summary.topTerms && <span className="max-w-24 truncate opacity-80">{summary.topTerms}</span>}
      </span>
      {metaBadges.map((badge) => (
        <span
          key={`${badge.label}:${badge.title}`}
          className={cn("inline-flex max-w-[140px] items-center rounded-md px-2 py-0.5", wikiMetaBadgeClass(badge.tone))}
          title={badge.title}
        >
          <span className="truncate">{badge.label}</span>
        </span>
      ))}
      {visible.map((page) => {
        const title = textValue(page.title, textValue(page.sourceRef, "wiki"))
        const terms = stringList(page.matchedTerms).slice(0, 3).join("/")
        const sourceRef = textValue(page.sourceRef, "")
        const canOpen = Boolean(project?.path && sourceRef.startsWith("wiki/") && !sourceRef.includes(".."))
        return (
          <button
            key={sourceRef || title}
            type="button"
            disabled={!canOpen}
            onClick={() => openWikiPage(sourceRef)}
            className={cn(
              "max-w-[260px] truncate rounded-md border bg-background px-2 py-0.5 text-left transition-colors",
              canOpen ? "hover:border-primary/40 hover:bg-primary/5 hover:text-primary" : "cursor-default opacity-70",
            )}
            title={`右侧预览：${sourceRef || title}${terms ? ` · ${terms}` : ""}`}
          >
            {title}{terms ? ` · ${terms}` : ""}
          </button>
        )
      })}
    </div>
  )
}

function RelatedWikiMiniLinks({
  pages,
  evidenceDelta,
  signalType,
}: {
  pages: Array<Record<string, unknown>>
  evidenceDelta?: unknown
  signalType?: unknown
}) {
  const project = useWikiStore((s) => s.project)
  const setSelectedFile = useWikiStore((s) => s.setSelectedFile)
  const visible = arrayRecords(pages).slice(0, 2)
  if (!visible.length) return null
  const summary = buildRelatedWikiSummary({ pages: visible, evidenceDelta, signalType })
  const metaBadges = buildWikiMetaBadges(visible).slice(0, 3)
  const openWikiPage = (sourceRef: string) => {
    if (!project?.path || !sourceRef.startsWith("wiki/") || sourceRef.includes("..")) return
    setSelectedFile(`${project.path}/${sourceRef}`)
  }
  return (
    <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
      <span
        className={cn("shrink-0 rounded-md px-1.5 py-0.5", relatedWikiToneClass(summary.tone))}
        title={summary.summary}
      >
        {summary.label}
      </span>
      {metaBadges.map((badge) => (
        <span
          key={`${badge.label}:${badge.title}`}
          className={cn("shrink-0 rounded-md px-1.5 py-0.5", wikiMetaBadgeClass(badge.tone))}
          title={badge.title}
        >
          {badge.label}
        </span>
      ))}
      {visible.map((page) => {
        const title = textValue(page.title, textValue(page.sourceRef, "wiki"))
        const sourceRef = textValue(page.sourceRef, "")
        const canOpen = Boolean(project?.path && sourceRef.startsWith("wiki/") && !sourceRef.includes(".."))
        return (
          <button
            key={sourceRef || title}
            type="button"
            disabled={!canOpen}
            onClick={() => openWikiPage(sourceRef)}
            className={cn(
              "min-w-0 truncate rounded-md border bg-background px-1.5 py-0.5 text-left",
              canOpen ? "hover:border-primary/40 hover:bg-primary/5 hover:text-primary" : "cursor-default opacity-70",
            )}
            title={`右侧预览：${sourceRef || title}`}
          >
            {title}
          </button>
        )
      })}
    </div>
  )
}

function SignalKeywordLineView({ line }: { line: ReturnType<typeof buildSignalKeywordLine> }) {
  if (!line.show) return null
  const toneClass = line.tone === "finance"
    ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100"
    : line.tone === "wiki"
      ? "border-primary/20 bg-primary/5 text-primary"
      : line.tone === "entity"
        ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
        : "border-border bg-muted text-muted-foreground"
  const layerClass: Record<ReturnType<typeof buildSignalKeywordLine>["layers"][number]["tone"], string> = {
    source: "bg-muted text-muted-foreground",
    wiki: "bg-primary/10 text-primary",
    finance: "bg-emerald-500/10 text-emerald-800 dark:text-emerald-200",
  }
  return (
    <div
      className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5 text-[11px]"
      title={line.detail}
      aria-label={`${line.label}：${line.layers.map((layer) => `${layer.label}${layer.terms.join("、")}`).join("；") || line.terms.join("、")}`}
    >
      <span className={cn("shrink-0 rounded-md border px-2 py-0.5 font-medium", toneClass)}>
        {line.label}
      </span>
      {line.layers.length > 0
        ? line.layers.map((layer) => (
          <span
            key={`${layer.label}:${layer.terms.join("/")}`}
            className={cn("max-w-[240px] truncate rounded-md px-2 py-0.5", layerClass[layer.tone])}
            title={`${layer.label}: ${layer.terms.join(" / ")}`}
          >
            {layer.label}: {layer.terms.join("/")}
          </span>
        ))
        : line.terms.map((term) => (
          <span key={term} className="max-w-[140px] truncate rounded-md bg-muted px-2 py-0.5 text-muted-foreground">
            {term}
          </span>
        ))}
      <span className="min-w-[180px] flex-1 truncate text-muted-foreground">
        {line.detail}
      </span>
    </div>
  )
}

function SignalFinanceHeaderCueView({ cue }: { cue: ReturnType<typeof buildSignalFinanceHeaderCue> }) {
  if (!cue.show) return null
  const groupClass: Record<ReturnType<typeof buildSignalFinanceHeaderCue>["chips"][number]["tone"], string> = {
    issuer: "bg-sky-500/10 text-sky-800 dark:text-sky-200",
    industry: "bg-primary/10 text-primary",
    catalyst: "bg-emerald-500/10 text-emerald-800 dark:text-emerald-200",
    risk: "bg-destructive/10 text-destructive",
    market: "bg-amber-500/10 text-amber-800 dark:text-amber-200",
    context: "bg-muted text-muted-foreground",
  }
  return (
    <div
      className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5 text-[11px]"
      role="note"
      title={cue.detail}
      aria-label={cue.ariaLabel}
    >
      <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-medium text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">
        <Database className="h-3 w-3" />
        金融词
      </span>
      {cue.headline && (
        <span className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-md bg-background px-2 py-0.5 font-medium text-foreground ring-1 ring-border">
          <span className="truncate">{cue.headline}</span>
          {cue.actionLabel && (
            <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-primary">
              {cue.actionLabel}
            </span>
          )}
        </span>
      )}
      {cue.chips.map((chip) => (
        <span
          key={`${chip.label}:${chip.value}`}
          className={cn("inline-flex max-w-[220px] items-center rounded-md px-2 py-0.5 font-medium", groupClass[chip.tone])}
          title={chip.title}
        >
          <span className="shrink-0 opacity-80">{chip.label}</span>
          <span className="ml-1 truncate">{chip.value}</span>
        </span>
      ))}
    </div>
  )
}

function SignalCardPmActionLineView({ line }: { line: ReturnType<typeof buildSignalCardPmActionLine> }) {
  if (!line.show) return null
  const toneClass: Record<ReturnType<typeof buildSignalCardPmActionLine>["tone"], string> = {
    confirm: "border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100",
    ask: "border-primary/20 bg-primary/5 text-primary",
    support: "border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100",
    catalyst: "border-primary/20 bg-primary/5 text-primary",
    market: "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100",
    counter: "border-destructive/20 bg-destructive/10 text-destructive",
    candidate: "border-primary/20 bg-primary/5 text-primary",
    quiet: "border-muted bg-muted/30 text-muted-foreground",
  }
  return (
    <div className={cn("mt-2 rounded-md border px-2.5 py-2 text-xs", toneClass[line.tone])} role="status" aria-live="polite">
      <div className="flex flex-col gap-1.5 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1.5 font-semibold">
            <ClipboardList className="h-3.5 w-3.5 shrink-0" />
            <span className="shrink-0">{line.lead}</span>
            <span className="min-w-0 truncate opacity-85">· {line.impact}</span>
          </div>
          <div className="mt-1 line-clamp-2 leading-5 opacity-85">{line.guardrail}</div>
        </div>
        <span className="inline-flex shrink-0 items-center self-start rounded-md bg-background/75 px-2 py-1 font-medium">
          {line.action}
        </span>
      </div>
    </div>
  )
}

function SignalCardQuestionChecklistView({
  checklist,
}: {
  checklist: ReturnType<typeof buildSignalCardQuestionChecklist>
}) {
  if (!checklist.show) return null
  const headerToneClass: Record<ReturnType<typeof buildSignalCardQuestionChecklist>["tone"], string> = {
    confirm: "bg-emerald-500/10 text-emerald-950 ring-emerald-500/20 dark:text-emerald-100",
    ask: "bg-primary/10 text-primary ring-primary/20",
    support: "bg-emerald-500/10 text-emerald-950 ring-emerald-500/20 dark:text-emerald-100",
    catalyst: "bg-primary/10 text-primary ring-primary/20",
    market: "bg-amber-500/10 text-amber-950 ring-amber-500/20 dark:text-amber-100",
    counter: "bg-destructive/10 text-destructive ring-destructive/20",
    candidate: "bg-primary/10 text-primary ring-primary/20",
    quiet: "bg-muted/50 text-foreground ring-border",
  }
  const toneClass: Record<ReturnType<typeof buildSignalCardQuestionChecklist>["items"][number]["tone"], string> = {
    source: "bg-blue-500/5 text-blue-950 ring-blue-500/15 dark:text-blue-100",
    hypothesis: "bg-primary/5 text-primary ring-primary/15",
    status: "bg-emerald-500/5 text-emerald-950 ring-emerald-500/15 dark:text-emerald-100",
    reason: "bg-muted/40 text-foreground ring-border",
    trade: "bg-amber-500/10 text-amber-950 ring-amber-500/20 dark:text-amber-100",
    action: "bg-primary/5 text-primary ring-primary/20",
  }
  return (
    <div className="mt-2 rounded-md border bg-background/70 px-2.5 py-2 text-xs" aria-label={checklist.title}>
      <div className="mb-1.5 flex items-center gap-1.5 font-medium text-foreground">
        <ClipboardList className="h-3.5 w-3.5" />
        <span>{checklist.title}</span>
      </div>
      <div className={cn("mb-1.5 rounded-md px-2 py-1.5 ring-1", headerToneClass[checklist.tone])}>
        <div className="flex flex-col gap-1.5 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="font-semibold leading-5">{checklist.headline}</div>
            <div className="mt-0.5 line-clamp-2 leading-5 opacity-90" title={checklist.detail}>{checklist.detail}</div>
          </div>
          <span className="inline-flex max-w-full shrink-0 self-start whitespace-normal rounded-md bg-background/75 px-2 py-1 text-left font-medium leading-5 sm:max-w-[180px]">
            {checklist.primaryAction}
          </span>
        </div>
        <div className="mt-1 leading-5 opacity-80">{checklist.guardrail}</div>
      </div>
      <div className="grid gap-1.5 md:grid-cols-2 xl:grid-cols-3">
        {checklist.items.map((item) => (
          <div key={item.key} className={cn("min-w-0 rounded-md px-2 py-1.5 ring-1", toneClass[item.tone])}>
            <div className="text-[11px] font-medium opacity-70">{item.label}</div>
            <div className="mt-0.5 line-clamp-2 leading-5" title={item.value}>{item.value}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function SignalLayerBadge({ brief }: { brief: ReturnType<typeof buildSignalLayerBrief> }) {
  const toneClass = {
    catalyst: "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-200",
    confirm: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200",
    market: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
    evidence: "bg-lime-100 text-lime-800 dark:bg-lime-950 dark:text-lime-200",
    risk: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-200",
  }[brief.tone]
  return (
    <span
      className={cn("rounded-md px-2 py-0.5 text-xs font-medium", toneClass)}
      title={`${brief.detail} ${brief.conservativeStatusHint}`}
    >
      {brief.level} {brief.label}
    </span>
  )
}

function SignalTodoList({
  todos,
  candidateHypotheses,
  running,
  reviewMode,
  watchSummary,
  hasScanned,
  sourceCount,
  newMessageCount,
  ignoredNotice,
  actionFeedbackByKey,
  askCacheStatusForHypothesis,
  onConfirm,
  onAsk,
  onIgnore,
  onTrackCandidate,
  onPrecheckCandidate,
  onReviewWithLlm,
  onScan,
  onExpandWindowScan,
  onDiscover,
  onJumpToAskResult,
}: {
  todos: Array<ReturnType<typeof buildSignalTodos>[number]>
  candidateHypotheses: Array<Record<string, unknown>>
  running: boolean
  reviewMode: ReturnType<typeof buildReviewModeSummary>
  watchSummary?: unknown
  hasScanned: boolean
  sourceCount: number
  newMessageCount: number
  ignoredNotice: ReturnType<typeof buildIgnoredSignalNoticeCopy> | null
  actionFeedbackByKey: Record<string, SignalActionFeedbackState>
  askCacheStatusForHypothesis: (
    hypothesis: Record<string, unknown>,
    queryContext?: Parameters<typeof buildHypothesisAskQuery>[1],
  ) => ReturnType<typeof buildAskCacheStatusCopy>
  onConfirm: (todo: ReturnType<typeof buildSignalTodos>[number]) => void
  onAsk: (todo: ReturnType<typeof buildSignalTodos>[number]) => void
  onIgnore: (key: string, title?: string) => void
  onTrackCandidate: (candidate: Record<string, unknown>, key: string) => void | Promise<void>
  onPrecheckCandidate: (candidate: Record<string, unknown>, key: string) => void | Promise<void>
  onReviewWithLlm: () => void
  onScan: () => void
  onExpandWindowScan: () => void
  onDiscover: () => void
  onJumpToAskResult: () => void
}) {
  const [showQuietSignals, setShowQuietSignals] = useState(false)
  const [activeTriageBucket, setActiveTriageBucket] = useState<PmSignalTriageBucketId | "all">("all")
  const sortedTodos = [...todos].sort((a, b) => todoActionScore(b) - todoActionScore(a)
    || textValue(b.item.createdAt, "").localeCompare(textValue(a.item.createdAt, ""))
    || a.key.localeCompare(b.key))
  const sortedCandidates = buildCandidateSignalClusters(candidateHypotheses).sort((a, b) => candidateActionScore(b) - candidateActionScore(a)
    || textValue(a.title, "").localeCompare(textValue(b.title, "")))
  const priorityTodos = sortedTodos.filter(isPriorityTodo)
  const priorityCandidates = sortedCandidates.filter(isPriorityCandidate)
  const quietTodos = sortedTodos.filter((todo) => !isPriorityTodo(todo))
  const quietCandidates = sortedCandidates.filter((item) => !isPriorityCandidate(item))
  const hasPriority = priorityTodos.length + priorityCandidates.length > 0
  const quietCount = quietTodos.length + quietCandidates.length
  const quietVisibility = buildQuietSignalVisibility({
    hasPriority,
    quietCount,
    showQuietSignals,
  })
  const hasActiveTriageFilter = activeTriageBucket !== "all"
  const triageFilteredTodos = hasActiveTriageFilter
    ? sortedTodos.filter((todo) => todoTriageBucketId(todo) === activeTriageBucket)
    : sortedTodos
  const triageFilteredCandidates = hasActiveTriageFilter
    ? sortedCandidates.filter((item) => candidateTriageBucketId(item) === activeTriageBucket)
    : sortedCandidates
  const triageBucketCounts = [...sortedTodos.map(todoTriageBucketId), ...sortedCandidates.map(candidateTriageBucketId)]
    .reduce<Record<PmSignalTriageBucketId, number>>((counts, bucketId) => {
      counts[bucketId] += 1
      return counts
    }, { now: 0, watch: 0, noise: 0 })
  const activeTodos = hasActiveTriageFilter
    ? triageFilteredTodos
    : quietVisibility.showQuietSignals
      ? sortedTodos
      : hasPriority
        ? priorityTodos
        : []
  const activeCandidates = hasActiveTriageFilter
    ? triageFilteredCandidates
    : quietVisibility.showQuietSignals
      ? sortedCandidates
      : hasPriority
        ? priorityCandidates
        : []
  const signalQueueItems = buildSignalQueueDecisionItems(sortedTodos, sortedCandidates)
  const alphaFeedSummary = buildAlphaFeedSummary({
    items: signalQueueItems,
    visibleLimit: 5,
  })
  const expandedList = showQuietSignals || hasActiveTriageFilter
  const visibleTodos = activeTodos.slice(0, expandedList ? 12 : alphaFeedSummary.visibleLimit)
  const visibleCandidateLimit = expandedList
    ? 6
    : Math.max(0, alphaFeedSummary.visibleLimit - visibleTodos.length)
  const visibleCandidates = activeCandidates.slice(0, visibleCandidateLimit)
  const visibleTodoSections = groupBySignalWorkSection(visibleTodos, todoWorkSectionId)
  const visibleCandidateSections = groupBySignalWorkSection(visibleCandidates, candidateWorkSectionId)
  const visibleWorkSections = SIGNAL_WORK_SECTION_ORDER
    .map((id) => ({
      id,
      todos: visibleTodoSections.find((section) => section.id === id)?.items ?? [],
      candidates: visibleCandidateSections.find((section) => section.id === id)?.items ?? [],
    }))
    .filter((section) => section.todos.length > 0 || section.candidates.length > 0)
  const totalCount = sortedTodos.length + sortedCandidates.length
  const trackedRawSignalCount = sortedTodos.reduce((sum, todo) => sum + Math.max(1, todo.signalCount), 0)
  const candidateRawSignalCount = sortedCandidates.reduce((sum, item) => sum + Math.max(1, numberValue(item.clusterSourceCount) || numberValue(item.clusterCandidateCount)), 0)
  const rawSignalCount = trackedRawSignalCount + candidateRawSignalCount
  const activeCount = activeTodos.length + activeCandidates.length
  const showQueueDetails = shouldShowSignalQueueDetails({ totalCount })
  const hiddenCount = Math.max(0, activeCount - visibleTodos.length - visibleCandidates.length)
  const quietRawSignalCount = quietTodos.reduce((sum, todo) => sum + Math.max(1, todo.signalCount), 0)
    + quietCandidates.reduce((sum, item) => sum + Math.max(1, numberValue(item.clusterSourceCount) || numberValue(item.clusterCandidateCount)), 0)
  const quietSummary = buildQuietSignalsSummary({
    quietTrackedCount: quietTodos.length,
    quietCandidateCount: quietCandidates.length,
    quietRawSignalCount,
    hiddenCount,
    hasPriority,
    showQuietSignals,
  })
  const hasCollapsibleQuietSignals = quietVisibility.showSummary
  const quietSummaryPlacement = hasActiveTriageFilter ? { position: "none" as const } : buildQuietSignalSummaryPlacement({
    visibility: quietVisibility,
    hiddenCount,
  })
  const actionableCount = priorityTodos.length + priorityCandidates.length
  const pendingCountLabel = buildPendingCountLabel({
    totalCount,
    priorityCount: actionableCount,
    quietCount,
    rawSignalCount,
  })
  const queueDecision = buildSignalQueueDecisionViewModel({
    items: signalQueueItems,
  })
  const focusBuckets = buildSignalFocusBuckets({
    confirmableCount: queueDecision.confirmableCount,
    counterCount: queueDecision.counterCount,
    hardEvidenceCount: queueDecision.hardEvidenceCount,
    marketFeedbackCount: queueDecision.marketFeedbackCount,
    catalystCount: queueDecision.catalystCount,
    candidateCount: queueDecision.candidateCount,
    quietCount: queueDecision.quietCount,
  })
  const triageBuckets = buildPmSignalTriageBuckets({
    confirmableCount: triageBucketCounts.now,
    catalystCount: triageBucketCounts.watch,
    quietCount: triageBucketCounts.noise,
  })
  const selectedTriageBucket = activeTriageBucket === "all"
    ? null
    : triageBuckets.find((bucket) => bucket.id === activeTriageBucket) ?? null
  const selectedTriageVisibleCount = visibleTodos.length + visibleCandidates.length
  const runDigest = queueDecision.digest
  const scanContextCopy = buildSignalScanContextCopy(watchSummary)
  const wikiFrameClusters = buildWikiFrameClusters([...sortedTodos, ...sortedCandidates])
  const primaryConfirmTodo = sortedTodos.find(todoCanConfirm)
  const primaryAskTodo = sortedTodos.find((todo) => todo.signal.askDeepDiveRecommended && todo.hypothesis)
    ?? priorityTodos.find((todo) => Boolean(todo.hypothesis))
  const primaryAskCandidate = sortedCandidates.find((item) => Boolean(item.askDeepDiveRecommended))
  const primaryCreateCandidate = priorityCandidates[0]
  const queueSummary = queueDecision.queueSummary
  const pmFocusBrief = queueDecision.focusBrief
  const pmOpeningBrief = queueDecision.openingBrief
  const emptyHint = buildEmptySignalTodoHint({
    running,
    hasScanned,
    sourceCount,
    newMessageCount,
    totalCount,
  })
  const hasPrimaryQueueTarget = (
    (queueSummary.primaryActionKind === "confirm" && Boolean(primaryConfirmTodo)) ||
    (queueSummary.primaryActionKind === "ask" && Boolean(primaryAskTodo || primaryAskCandidate)) ||
    (queueSummary.primaryActionKind === "create" && Boolean(primaryCreateCandidate))
  )
  const primaryTodoForAction = queueSummary.primaryActionKind === "confirm"
    ? primaryConfirmTodo
    : queueSummary.primaryActionKind === "ask"
      ? primaryAskTodo
      : null
  const primaryCandidateForAction = queueSummary.primaryActionKind === "ask" && !primaryAskTodo
    ? primaryAskCandidate
    : queueSummary.primaryActionKind === "create"
      ? primaryCreateCandidate
      : null
  const primaryCandidateActionKey = primaryCandidateForAction
    ? candidateWorkbenchKey(primaryCandidateForAction) || textValue(primaryCandidateForAction.title, "候选新假设")
    : ""
  const runPrimaryQueueAction = () => {
    if (queueSummary.primaryActionKind === "confirm" && primaryConfirmTodo) {
      onConfirm(primaryConfirmTodo)
      return
    }
    if (queueSummary.primaryActionKind === "ask") {
      if (primaryAskTodo) {
        onAsk(primaryAskTodo)
        return
      }
      if (primaryAskCandidate) {
        onPrecheckCandidate(primaryAskCandidate, primaryCandidateActionKey || candidateWorkbenchKey(primaryAskCandidate) || textValue(primaryAskCandidate.title, "候选新假设"))
      }
      return
    }
    if (queueSummary.primaryActionKind === "create" && primaryCreateCandidate) {
      onTrackCandidate(primaryCreateCandidate, primaryCandidateActionKey || candidateWorkbenchKey(primaryCreateCandidate) || textValue(primaryCreateCandidate.title, "候选新假设"))
    }
  }
  const runEmptyHintAction = () => {
    if (emptyHint.primaryActionKind === "scan") onScan()
    if (emptyHint.primaryActionKind === "expand-window") onExpandWindowScan()
    if (emptyHint.primaryActionKind === "discover") onDiscover()
  }
  const focusAction = hasPrimaryQueueTarget ? buildSignalRunDigestAction(queueSummary) : null
  const focusActionFeedback = primaryTodoForAction
    ? buildSignalCardActionFeedback(actionFeedbackByKey[primaryTodoForAction.key])
    : primaryCandidateActionKey
      ? buildSignalCardActionFeedback(actionFeedbackByKey[primaryCandidateActionKey])
      : buildSignalCardActionFeedback({})
  const emptyHintIcon = emptyHint.primaryActionKind === "discover"
    ? <Sparkles className="h-3.5 w-3.5" />
    : emptyHint.primaryActionKind === "expand-window"
      ? <Clock className="h-3.5 w-3.5" />
      : <SearchCheck className="h-3.5 w-3.5" />
  const quietSummaryBlock = quietSummaryPlacement.position !== "none" ? (
    <QuietSignalSummaryBlock
      summary={quietSummary}
      canToggle={hasCollapsibleQuietSignals}
      onToggle={() => setShowQuietSignals((value) => !value)}
    />
  ) : null
  const triageFilterNotice = selectedTriageBucket ? (
    <div className="flex flex-col gap-2 rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-primary sm:flex-row sm:items-center sm:justify-between" role="status" aria-live="polite">
      <div className="min-w-0">
        <span className="font-medium">正在只看：{selectedTriageBucket.label}</span>
        <span className="ml-2 text-primary/80">
          显示 {selectedTriageVisibleCount}/{selectedTriageBucket.value} 条；再次点击该桶或点“看全部”恢复。
        </span>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 self-start px-2 text-xs text-primary hover:text-primary sm:self-auto"
        onClick={() => setActiveTriageBucket("all")}
      >
        看全部
      </Button>
    </div>
  ) : null
  const alphaBadgeToneClass: Record<ReturnType<typeof buildAlphaFeedSummary>["badges"][number]["tone"], string> = {
    action: "bg-primary/10 text-primary",
    ask: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
    confirm: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    quiet: "bg-muted text-muted-foreground",
  }
  return (
    <section className="rounded-lg border bg-card p-4">
      <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-medium">Alpha Feed</h3>
            <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
              {alphaFeedSummary.title}
            </span>
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            今天有什么新信号，会不会改变我正在跟踪的假设。{alphaFeedSummary.subtitle}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-1.5 text-xs lg:justify-end">
          {alphaFeedSummary.badges.map((badge) => (
            <span key={badge.label} className={cn("rounded-md px-2 py-1 font-medium", alphaBadgeToneClass[badge.tone])}>
              {badge.label} {badge.value}
            </span>
          ))}
          <span className="rounded-md bg-muted px-2 py-1 text-muted-foreground">{pendingCountLabel}</span>
        </div>
      </div>
      {ignoredNotice && (
        <div className="mb-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100" role="status" aria-live="polite">
          <div className="flex items-center gap-1.5 font-medium">
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span>{ignoredNotice.title}</span>
          </div>
          <div className="mt-1 leading-5 opacity-80">{ignoredNotice.detail}</div>
        </div>
      )}

      {!showQueueDetails ? (
        <div className="space-y-2">
          <div className="rounded-lg border border-dashed bg-background p-6 text-center text-sm">
            <div className="font-medium text-foreground">{emptyHint.title}</div>
            <p className="mx-auto mt-2 max-w-xl leading-6 text-muted-foreground">{emptyHint.detail}</p>
            <div className="mt-3 text-xs font-medium text-primary">{emptyHint.nextAction}</div>
            {emptyHint.primaryActionKind !== "none" && (
              <Button
                type="button"
                size="sm"
                className="mt-4"
                onClick={runEmptyHintAction}
                disabled={running}
              >
                {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : emptyHintIcon}
                {emptyHint.primaryActionLabel}
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="max-h-[420px] space-y-2 overflow-auto pr-1">
          <PmOpeningBriefCard
            opening={pmOpeningBrief}
            brief={pmFocusBrief}
            action={focusAction}
            actionFeedback={focusActionFeedback}
            onAction={focusAction ? runPrimaryQueueAction : undefined}
            actionDisabled={running || (focusActionFeedback.show && focusActionFeedback.tone === "running")}
            actionBusy={running || (focusActionFeedback.show && focusActionFeedback.tone === "running")}
          />
          <div className="flex flex-col gap-2 rounded-md border bg-background px-3 py-2 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 leading-5">
              默认只展示最该看的 {alphaFeedSummary.visibleLimit} 条；已折叠 {alphaFeedSummary.totalFoldedCount} 条低优先级或溢出信号。
            </div>
            {alphaFeedSummary.totalFoldedCount > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 shrink-0 px-2 text-xs"
                onClick={() => {
                  if (expandedList) {
                    setShowQuietSignals(false)
                    setActiveTriageBucket("all")
                  } else {
                    setShowQuietSignals(true)
                  }
                }}
              >
                {expandedList ? "回到 Alpha Feed" : "展开后台明细"}
              </Button>
            )}
          </div>
          {expandedList && (
            <>
              <SignalRunDigestBar
                digest={runDigest}
                queueSummary={queueSummary}
                suppressActionLabel={Boolean(focusAction)}
              />
              <SignalScanContextNotice copy={scanContextCopy} />
              <ReviewModeNotice reviewMode={reviewMode} hasSignals={totalCount > 0} running={running} onReviewWithLlm={onReviewWithLlm} />
              <PmSignalTriageBuckets
                buckets={triageBuckets}
                activeBucket={activeTriageBucket}
                onSelect={(id) => setActiveTriageBucket((value) => value === id ? "all" : id)}
              />
              {triageFilterNotice}
              <SignalFocusBuckets buckets={focusBuckets} />
              <WikiFrameClusterStrip clusters={wikiFrameClusters} />
              {quietSummaryPlacement.position === "before-list" && quietSummaryBlock}
            </>
          )}
          {visibleWorkSections.map((section) => {
            const header = buildSignalWorkSectionHeader({
              id: section.id,
              count: section.todos.length + section.candidates.length,
            })
            return (
              <div key={section.id} className="space-y-2">
                <SignalWorkSectionHeaderView header={header} />
                {section.todos.map((todo) => {
            const status = textValue(todo.hypothesis?.status, "watching")
            const title = textValue(todo.hypothesis?.title, textValue(todo.item.hypothesisTitle, "未命名假设"))
            const canConfirm = todoCanConfirm(todo)
            const signalCount = Math.max(todo.sourceCount, todo.signalCount)
            const actionSummary = todoActionSummary(todo)
            const askCacheStatus = todo.hypothesis
              ? askCacheStatusForHypothesis(todo.hypothesis, buildSignalAskQueryContext(todo.signal))
              : buildAskCacheStatusCopy({ cached: false })
            const actionPlan = buildSignalCardActions({
              kind: "tracked",
              canConfirm,
              canAsk: Boolean(todo.hypothesis),
              askDeepDiveRecommended: Boolean(todo.signal.askDeepDiveRecommended),
              askCacheStatus,
            })
            const rankReason = buildSignalCardRankReason({
              kind: "tracked",
              canConfirm,
              askDeepDiveRecommended: Boolean(todo.signal.askDeepDiveRecommended),
              currentStatus: status,
              suggestedStatus: todo.signal.suggestedStatus,
              evidenceDelta: todo.signal.evidenceDelta,
              signalType: todo.signal.signalType,
              sourceCount: signalCount,
              relatedWikiPages: todo.signal.relatedWikiPages,
              financeEntityRecords: [todo.signal, ...arrayRecords(todo.signal.relatedWikiPages)],
            })
            const pmActionLine = buildSignalCardPmActionLine({
              kind: "tracked",
              canConfirm,
              askDeepDiveRecommended: Boolean(todo.signal.askDeepDiveRecommended),
              currentStatus: status,
              suggestedStatus: todo.signal.suggestedStatus,
              evidenceDelta: todo.signal.evidenceDelta,
              signalType: todo.signal.signalType,
              sourceCount: signalCount,
              title,
              sourceExcerpt: todo.signal.sourceExcerpt,
              sourceRef: todo.signal.sourceRef,
              relatedWikiPages: todo.signal.relatedWikiPages,
              financeEntityRecords: [todo.signal, ...arrayRecords(todo.signal.relatedWikiPages)],
            })
            const questionChecklist = buildSignalCardQuestionChecklist({
              kind: "tracked",
              canConfirm,
              askDeepDiveRecommended: Boolean(todo.signal.askDeepDiveRecommended),
              currentStatus: status,
              suggestedStatus: todo.signal.suggestedStatus,
              evidenceDelta: todo.signal.evidenceDelta,
              signalType: todo.signal.signalType,
              sourceCount: signalCount,
              title,
              reason: todo.signal.reason,
              sourceExcerpt: todo.signal.sourceExcerpt,
              sourceRef: todo.signal.sourceRef,
              sourceKindLabel: todo.signal.sourceKindLabel,
              tradingImplication: todo.signal.tradingImplication,
              relatedWikiPages: todo.signal.relatedWikiPages,
              financeEntityRecords: [todo.signal, ...arrayRecords(todo.signal.relatedWikiPages)],
            })
            const surfacePolicy = buildSignalCardSurfacePolicy({ pmActionLine, questionChecklist })
            const source = buildSignalCardSourceCopy({
              sourceExcerpt: todo.signal.sourceExcerpt,
              sourceRef: todo.signal.sourceRef,
              sourceKindLabel: todo.signal.sourceKindLabel,
              reason: todo.signal.reason,
            })
            const tradeLine = buildSignalCardTradeLine({
              tradingImplication: todo.signal.tradingImplication,
              signalType: todo.signal.signalType,
              evidenceDelta: todo.signal.evidenceDelta,
              reason: todo.signal.reason,
            })
            const signalLayer = buildSignalLayerBrief({
              signalType: todo.signal.signalType,
              evidenceDelta: todo.signal.evidenceDelta,
              suggestedStatus: todo.signal.suggestedStatus,
            })
            const infoFlow = buildSignalInfoFlowCopy({
              kind: "tracked",
              title,
              sourceExcerpt: todo.signal.sourceExcerpt,
              sourceRef: todo.signal.sourceRef,
              sourceKindLabel: todo.signal.sourceKindLabel,
              relatedWikiPages: todo.signal.relatedWikiPages,
              signalType: todo.signal.signalType,
              evidenceDelta: todo.signal.evidenceDelta,
              currentStatus: status,
              suggestedStatus: todo.signal.suggestedStatus,
              canConfirm,
              askDeepDiveRecommended: Boolean(todo.signal.askDeepDiveRecommended),
              financeEntityRecords: [todo.signal, ...arrayRecords(todo.signal.relatedWikiPages)],
              matchedSegments: todo.signal.matchedSegments,
              matchedEntities: todo.signal.matchedEntities,
              catalystTags: todo.signal.catalystTags,
            })
            const keywordLine = buildSignalKeywordLine({
              matchedSegments: todo.signal.matchedSegments,
              matchedEntities: todo.signal.matchedEntities,
              catalystTags: todo.signal.catalystTags,
              relatedWikiPages: todo.signal.relatedWikiPages,
            })
            const financeHeaderCue = buildSignalFinanceHeaderCue([todo.signal, ...arrayRecords(todo.signal.relatedWikiPages)])
            const actionFeedbackState = actionFeedbackByKey[todo.key]
            const actionFeedback = buildSignalCardActionFeedback(actionFeedbackState)
            const askResultBackfill = buildSignalCardAskResultBackfill(actionFeedbackState)
            const showActionFeedback = shouldShowSignalCardActionFeedback(actionFeedback, askResultBackfill)
            const wikiDecision = buildWikiFrameDecisionLine({
              pages: todo.signal.relatedWikiPages,
              evidenceDelta: todo.signal.evidenceDelta,
              signalType: todo.signal.signalType,
              askDeepDiveRecommended: Boolean(todo.signal.askDeepDiveRecommended),
            })
            const wikiFirstLook = buildWikiFrameFirstLookCopy(wikiDecision)
            const evidenceToggle = buildSignalEvidenceToggleCopy({
              relatedWikiPages: todo.signal.relatedWikiPages,
              sourceExcerpt: todo.signal.sourceExcerpt,
              sourceRef: todo.signal.sourceRef,
              reason: todo.signal.reason,
              matchedSegments: todo.signal.matchedSegments,
              matchedEntities: todo.signal.matchedEntities,
              catalystTags: todo.signal.catalystTags,
            })
            const isPrimaryAction = primaryTodoForAction?.key === todo.key
            return (
              <div key={todo.key} className={cn("rounded-md border bg-background p-3", isPrimaryAction && "border-primary bg-primary/5 ring-1 ring-primary/20")}>
                <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      {isPrimaryAction && <span className="rounded-md bg-primary px-2 py-0.5 text-xs text-primary-foreground">今日先手</span>}
                      <SignalLayerBadge brief={signalLayer} />
                      <span className="rounded-md bg-muted px-2 py-0.5 text-xs">{todo.signal.signalType || signalStrengthLabel(todo.signal.evidenceDelta)}</span>
                      <span className="text-xs text-muted-foreground" title={`${status} -> ${todo.signal.suggestedStatus}`}>
                        {hypothesisStatusTransitionLabel(status, todo.signal.suggestedStatus)}
                      </span>
                      {signalCount > 1 && (
                        <span className="rounded-md bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-700 dark:text-emerald-300">
                          合并 {signalCount} 条信号
                        </span>
                      )}
                      {todo.signal.askDeepDiveRecommended && <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs text-primary">建议 Ask</span>}
                      {askCacheStatus.show && (
                        <span className="rounded-md bg-blue-500/10 px-2 py-0.5 text-xs text-blue-700 dark:text-blue-300" title={askCacheStatus.helper}>
                          {askCacheStatus.badgeLabel || "已缓存 Ask"}
                        </span>
                      )}
                    </div>
                    {source.badge && (
                      <div className="mt-2 inline-flex max-w-full items-center gap-1.5 rounded-md bg-muted px-2 py-0.5 text-[11px] text-muted-foreground" title={source.auditTitle || source.auditLabel}>
                        <Clock className="h-3 w-3 shrink-0" />
                        <span className="truncate">{source.badge}</span>
                      </div>
                    )}
                    <SignalFinanceHeaderCueView cue={financeHeaderCue} />
                    <div className="mt-2 line-clamp-2 text-sm font-medium">{title}</div>
                    {surfacePolicy.showPmActionLine && <SignalCardPmActionLineView line={pmActionLine} />}
                    {surfacePolicy.showQuestionChecklist && <SignalCardQuestionChecklistView checklist={questionChecklist} />}
                    <WikiFrameFirstLookStrip copy={wikiFirstLook} />
                    {surfacePolicy.showDecisionBlock && (
                      <SignalDecisionBlock copy={buildSignalCardDecisionCopy({
                        summary: actionSummary,
                        title,
                        currentStatus: status,
                        suggestedStatus: todo.signal.suggestedStatus,
                        kind: "tracked",
                      })} rankReason={rankReason} />
                    )}
                    {showActionFeedback && <SignalCardActionFeedbackView feedback={actionFeedback} onJump={onJumpToAskResult} />}
                    <SignalCardAskResultBackfillView backfill={askResultBackfill} onJump={onJumpToAskResult} />
                    {askCacheStatus.show && !actionFeedback.show && !askResultBackfill.show && (
                      <div role="status" aria-live="polite" className="mt-2 rounded-md border border-blue-200 bg-blue-50 px-2.5 py-2 text-xs leading-5 text-blue-950 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-100">
                        <div className="flex flex-wrap items-center gap-1.5 font-medium">
                          <span>{askCacheStatus.cardHintLabel}</span>
                          <span className="font-normal opacity-80">{askCacheStatus.cardHintDetail}</span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <span className="rounded bg-background/60 px-2 py-0.5 opacity-85">{askCacheStatus.cardHintAction}</span>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 bg-background/70 px-2 text-xs"
                            onClick={onJumpToAskResult}
                          >
                            <ArrowRight className="h-3.5 w-3.5" />
                            查看上次 Ask
                          </Button>
                        </div>
                      </div>
                    )}
                    {surfacePolicy.showTradeLine && (
                      <div className="mt-2 line-clamp-2 rounded-md bg-primary/5 px-2 py-1 text-xs leading-5 text-primary">{tradeLine}</div>
                    )}
                    <SignalEvidenceDetails copy={evidenceToggle}>
                      <SignalInfoFlowPath flow={infoFlow} />
                      <SignalKeywordLineView line={keywordLine} />
                      <WikiFrameDecisionHint line={wikiDecision} />
                      <SignalSourceDetails source={source} />
                      <RelatedWikiPages
                        pages={arrayRecords(todo.signal.relatedWikiPages)}
                        evidenceDelta={todo.signal.evidenceDelta}
                        signalType={todo.signal.signalType}
                      />
                    </SignalEvidenceDetails>
                  </div>
                  <SignalCardActions
                    plan={actionPlan}
                    running={running}
                    feedback={actionFeedback}
                    onAction={(kind) => {
                      if (kind === "confirm") onConfirm(todo)
                      if (kind === "ask") onAsk(todo)
                      if (kind === "ignore") onIgnore(todo.key, title)
                    }}
                  />
                </div>
              </div>
            )
          })}

          {section.candidates.map((item, index) => {
            const actionSummary = candidateActionSummary(item)
            const actionPlan = buildSignalCardActions({
              kind: "candidate",
              askDeepDiveRecommended: Boolean(item.askDeepDiveRecommended),
            })
            const rankReason = buildSignalCardRankReason({
              kind: "candidate",
              askDeepDiveRecommended: Boolean(item.askDeepDiveRecommended),
              evidenceDelta: item.evidenceDelta,
              signalType: item.signalType,
              clusterSourceCount: item.clusterSourceCount,
              priorityReasons: item.priorityReasons,
              relatedWikiPages: item.relatedWikiPages,
              financeEntityRecords: [item, ...arrayRecords(item.relatedWikiPages)],
            })
            const pmActionLine = buildSignalCardPmActionLine({
              kind: "candidate",
              askDeepDiveRecommended: Boolean(item.askDeepDiveRecommended),
              evidenceDelta: item.evidenceDelta,
              signalType: item.signalType,
              clusterSourceCount: item.clusterSourceCount,
              priorityReasons: item.priorityReasons,
              title: item.title,
              sourceExcerpt: item.sourceExcerpt,
              sourceRef: item.discoverySourceRef ?? item.sourceRef,
              relatedWikiPages: item.relatedWikiPages,
              financeEntityRecords: [item, ...arrayRecords(item.relatedWikiPages)],
            })
            const questionChecklist = buildSignalCardQuestionChecklist({
              kind: "candidate",
              askDeepDiveRecommended: Boolean(item.askDeepDiveRecommended),
              evidenceDelta: item.evidenceDelta,
              signalType: item.signalType,
              clusterSourceCount: item.clusterSourceCount,
              priorityReasons: item.priorityReasons,
              title: item.title,
              reason: item.reason,
              sourceExcerpt: item.sourceExcerpt,
              sourceRef: item.discoverySourceRef ?? item.sourceRef,
              sourceKindLabel: item.sourceKindLabel,
              tradingImplication: item.tradingImplication,
              relatedWikiPages: item.relatedWikiPages,
              financeEntityRecords: [item, ...arrayRecords(item.relatedWikiPages)],
            })
            const surfacePolicy = buildSignalCardSurfacePolicy({ pmActionLine, questionChecklist })
            const source = buildSignalCardSourceCopy({
              sourceExcerpt: item.sourceExcerpt,
              sourceRef: item.discoverySourceRef ?? item.sourceRef,
              sourceKindLabel: item.sourceKindLabel,
              reason: item.reason,
            })
            const tradeLine = buildSignalCardTradeLine({
              tradingImplication: item.tradingImplication,
              signalType: item.signalType,
              evidenceDelta: item.evidenceDelta,
              reason: item.reason,
            })
            const signalLayer = buildSignalLayerBrief({
              signalType: item.signalType,
              evidenceDelta: item.evidenceDelta,
              suggestedStatus: item.suggestedStatus,
            })
            const infoFlow = buildSignalInfoFlowCopy({
              kind: "candidate",
              title: item.title,
              sourceExcerpt: item.sourceExcerpt,
              sourceRef: item.discoverySourceRef ?? item.sourceRef,
              sourceKindLabel: item.sourceKindLabel,
              relatedWikiPages: item.relatedWikiPages,
              signalType: item.signalType,
              evidenceDelta: item.evidenceDelta,
              askDeepDiveRecommended: Boolean(item.askDeepDiveRecommended),
              financeEntityRecords: [item, ...arrayRecords(item.relatedWikiPages)],
              matchedSegments: item.segments,
              matchedEntities: item.keyVariables,
              catalystTags: item.catalystTags,
            })
            const keywordLine = buildSignalKeywordLine({
              segments: item.segments,
              keyVariables: item.keyVariables,
              catalystTags: item.catalystTags,
              relatedWikiPages: item.relatedWikiPages,
            })
            const financeHeaderCue = buildSignalFinanceHeaderCue([item, ...arrayRecords(item.relatedWikiPages)])
            const wikiDecision = buildWikiFrameDecisionLine({
              pages: item.relatedWikiPages,
              evidenceDelta: item.evidenceDelta,
              signalType: item.signalType,
              askDeepDiveRecommended: Boolean(item.askDeepDiveRecommended),
            })
            const wikiFirstLook = buildWikiFrameFirstLookCopy(wikiDecision)
            const evidenceToggle = buildSignalEvidenceToggleCopy({
              relatedWikiPages: item.relatedWikiPages,
              sourceExcerpt: item.sourceExcerpt,
              sourceRef: item.discoverySourceRef ?? item.sourceRef,
              reason: item.reason,
              matchedSegments: item.segments,
              matchedEntities: item.keyVariables,
              catalystTags: item.catalystTags,
              priorityReasons: item.priorityReasons,
            })
            const isPrimaryAction = primaryCandidateForAction === item
            const candidateKey = candidateWorkbenchKey(item) || `${textValue(item.title, "")}:${index}`
            const actionFeedbackState = actionFeedbackByKey[candidateKey]
            const actionFeedback = buildSignalCardActionFeedback(actionFeedbackState)
            const askResultBackfill = buildSignalCardAskResultBackfill(actionFeedbackState)
            const showActionFeedback = shouldShowSignalCardActionFeedback(actionFeedback, askResultBackfill)
            const metaLine = buildCandidateThemeSegmentLine({ theme: item.theme, segments: item.segments })
            return (
              <div key={candidateKey} className={cn("rounded-md border border-dashed bg-background p-3", isPrimaryAction && "border-primary bg-primary/5 ring-1 ring-primary/20")}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      {isPrimaryAction && <span className="rounded-md bg-primary px-2 py-0.5 text-xs text-primary-foreground">今日先手</span>}
                      <span className="rounded-md bg-muted px-2 py-0.5 text-xs">候选新假设</span>
                      <SignalLayerBadge brief={signalLayer} />
                      <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs text-primary">
                        {textValue(item.signalType, "新催化")}
                      </span>
                      {numberValue(item.clusterSourceCount) > 1 && (
                        <span className="rounded-md bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-700 dark:text-emerald-300">
                          合并 {numberValue(item.clusterSourceCount)} 条来源
                        </span>
                      )}
                      {numberValue(item.clusterCandidateCount) > 1 && (
                        <span className="rounded-md bg-blue-500/10 px-2 py-0.5 text-xs text-blue-700 dark:text-blue-300">
                          合并 {numberValue(item.clusterCandidateCount)} 个候选
                        </span>
                      )}
                      {Boolean(item.askDeepDiveRecommended) && <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs text-primary">建议 Ask</span>}
                    </div>
                    {source.badge && (
                      <div className="mt-2 inline-flex max-w-full items-center gap-1.5 rounded-md bg-muted px-2 py-0.5 text-[11px] text-muted-foreground" title={source.auditTitle || source.auditLabel}>
                        <Clock className="h-3 w-3 shrink-0" />
                        <span className="truncate">{source.badge}</span>
                      </div>
                    )}
                    <SignalFinanceHeaderCueView cue={financeHeaderCue} />
                    <div className="mt-2 line-clamp-2 text-sm font-medium">{textValue(item.title)}</div>
                    <div className="mt-1 truncate text-xs text-muted-foreground" title={metaLine}>
                      {metaLine}
                    </div>
                    {surfacePolicy.showPmActionLine && <SignalCardPmActionLineView line={pmActionLine} />}
                    {surfacePolicy.showQuestionChecklist && <SignalCardQuestionChecklistView checklist={questionChecklist} />}
                    <WikiFrameFirstLookStrip copy={wikiFirstLook} />
                    {surfacePolicy.showDecisionBlock && (
                      <SignalDecisionBlock copy={buildSignalCardDecisionCopy({
                        summary: actionSummary,
                        title: item.title,
                        kind: "candidate",
                      })} rankReason={rankReason} />
                    )}
                    {showActionFeedback && <SignalCardActionFeedbackView feedback={actionFeedback} onJump={onJumpToAskResult} />}
                    <SignalCardAskResultBackfillView backfill={askResultBackfill} onJump={onJumpToAskResult} />
                    {surfacePolicy.showTradeLine && (
                      <div className="mt-2 line-clamp-2 rounded-md bg-primary/5 px-2 py-1 text-xs leading-5 text-primary">{tradeLine}</div>
                    )}
                    <SignalEvidenceDetails copy={evidenceToggle}>
                      {stringList(item.priorityReasons).length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {stringList(item.priorityReasons).slice(0, 4).map((reason) => (
                            <span key={reason} className="rounded-md bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                              {reason}
                            </span>
                          ))}
                        </div>
                      )}
                      <SignalInfoFlowPath flow={infoFlow} />
                      <SignalKeywordLineView line={keywordLine} />
                      <WikiFrameDecisionHint line={wikiDecision} />
                      <SignalSourceDetails source={source} />
                      <RelatedWikiPages
                        pages={arrayRecords(item.relatedWikiPages)}
                        evidenceDelta={item.evidenceDelta}
                        signalType={item.signalType}
                      />
                    </SignalEvidenceDetails>
                  </div>
                  <SignalCardActions
                    plan={actionPlan}
                    running={running}
                    feedback={actionFeedback}
                    onAction={(kind) => {
                      if (kind === "precheck") onPrecheckCandidate(item, candidateKey)
                      if (kind === "track") onTrackCandidate(item, candidateKey)
                      if (kind === "ignore") onIgnore(candidateKey, textValue(item.title, "候选新假设"))
                    }}
                  />
                </div>
              </div>
            )
          })}
              </div>
            )
          })}

          {quietSummaryPlacement.position === "after-list" && quietSummaryBlock}
        </div>
      )}
    </section>
  )
}

function QuietSignalSummaryBlock({
  summary,
  canToggle,
  onToggle,
}: {
  summary: ReturnType<typeof buildQuietSignalsSummary>
  canToggle: boolean
  onToggle: () => void
}) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-dashed bg-muted/30 px-3 py-2 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="font-medium text-foreground">{summary.headline}</div>
        <div className="mt-1 leading-5">{summary.detail}</div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 leading-5">
          <span className="rounded-md bg-background px-2 py-0.5 font-medium text-foreground">
            {summary.decisionLabel}
          </span>
          <span>{summary.nextAction}</span>
        </div>
        {summary.badges.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1.5">
            {summary.badges.map((badge) => (
              <span key={badge.label} className="rounded-md bg-background px-2 py-0.5 text-[11px]">
                {badge.label} {badge.value}
              </span>
            ))}
          </div>
        )}
      </div>
      {canToggle && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 self-start px-2 text-xs sm:self-auto"
          onClick={onToggle}
        >
          {summary.toggleLabel}
        </Button>
      )}
    </div>
  )
}

function SignalWorkSectionHeaderView({
  header,
}: {
  header: ReturnType<typeof buildSignalWorkSectionHeader>
}) {
  const toneClass: Record<ReturnType<typeof buildSignalWorkSectionHeader>["tone"], string> = {
    action: "border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100",
    danger: "border-destructive/20 bg-destructive/10 text-destructive",
    strong: "border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100",
    warn: "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100",
    review: "border-primary/20 bg-primary/5 text-primary",
    quiet: "border-muted bg-muted/30 text-muted-foreground",
  }
  return (
    <div className={cn("rounded-md border px-2.5 py-2 text-xs", toneClass[header.tone])}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{header.label}</span>
        <span className="rounded bg-background/70 px-1.5 py-0.5 text-[11px]">{header.countLabel}</span>
      </div>
      <div className="mt-1 leading-5 opacity-85">{header.detail}</div>
    </div>
  )
}

function PmOpeningBriefCard({
  opening,
  brief,
  action,
  actionFeedback,
  onAction,
  actionDisabled,
  actionBusy,
}: {
  opening: ReturnType<typeof buildPmOpeningBrief>
  brief: ReturnType<typeof buildPmFocusBrief>
  action?: ReturnType<typeof buildSignalRunDigestAction> | null
  actionFeedback?: ReturnType<typeof buildSignalCardActionFeedback>
  onAction?: () => void
  actionDisabled?: boolean
  actionBusy?: boolean
}) {
  const toneClass: Record<ReturnType<typeof buildPmOpeningBrief>["tone"], string> = {
    idle: "border-muted bg-muted/30 text-muted-foreground",
    action: "border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100",
    review: "border-primary/20 bg-primary/5 text-foreground",
    quiet: "border-muted bg-muted/30 text-muted-foreground",
  }
  const runningFeedback = actionFeedback?.show && actionFeedback.tone === "running" ? actionFeedback : null
  const actionLabel = runningFeedback?.label || action?.label
  const actionTitle = runningFeedback?.detail || action?.ariaLabel
  const actionAriaLabel = runningFeedback
    ? `正在执行今天先手：${runningFeedback.label}`
    : actionBusy && action
      ? `正在执行今天先手：${action.label}`
      : action?.ariaLabel
  return (
    <div className={cn("rounded-md border px-3 py-2 text-xs", toneClass[opening.tone])}>
      <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 font-medium">
            <Lightbulb className="h-3.5 w-3.5 shrink-0" />
            <span>{opening.label}</span>
            <span className="rounded-md bg-background/70 px-2 py-0.5 text-[11px]">{opening.actionLabel}</span>
          </div>
          <div className="mt-1 text-sm font-semibold leading-5">{opening.headline}</div>
          <div className="mt-1 line-clamp-2 leading-5 opacity-85">{opening.detail}</div>
          <div className="mt-1 inline-flex max-w-full items-center gap-1.5 rounded-md bg-background/70 px-2 py-0.5 leading-5">
            <GitBranch className="h-3 w-3 shrink-0" />
            <span className="shrink-0 text-muted-foreground">{brief.targetLabel}</span>
            <span className="truncate font-medium" title={brief.targetTitle}>{brief.targetTitle}</span>
          </div>
          <details className="mt-1">
            <summary className="cursor-pointer text-[11px] font-medium opacity-75 hover:opacity-100">怎么操作</summary>
            <div className="mt-1 grid gap-1.5 text-[11px] leading-5 md:grid-cols-2">
              <div className="flex items-start gap-1.5 rounded-md bg-background/60 px-2 py-1 text-muted-foreground">
                <ArrowRight className="mt-0.5 h-3 w-3 shrink-0" />
                <span>{brief.locatorHint}</span>
              </div>
              <div className="rounded-md bg-background/70 px-2 py-1 font-medium">
                {brief.operatorHint}
              </div>
              <div className="flex items-start gap-1.5 rounded-md bg-background/60 px-2 py-1 text-muted-foreground">
                <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0" />
                <span>{brief.primaryOutcome}</span>
              </div>
              <div className="rounded-md bg-background/70 px-2 py-1">
                {brief.guardrail}
              </div>
            </div>
          </details>
          {opening.framework && (
            <div className="mt-1 inline-flex max-w-full items-center gap-1.5 rounded-md bg-background/70 px-2 py-0.5 leading-5">
              <Database className="h-3 w-3 shrink-0" />
              <span className="shrink-0 opacity-70">Wiki/金融词</span>
              <span className="truncate font-medium" title={opening.framework}>{opening.framework}</span>
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-col gap-2 xl:max-w-[320px] xl:items-end">
          {action && onAction && (
            <Button
              type="button"
              size="sm"
              variant={action.variant}
              className="h-8 w-full justify-center px-3 text-xs xl:w-auto"
              onClick={onAction}
              disabled={actionDisabled}
              aria-label={actionBusy ? actionAriaLabel : action?.ariaLabel}
              title={actionTitle}
            >
              {actionBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {actionLabel}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

function ReviewModeNotice({
  reviewMode,
  hasSignals,
  running,
  onReviewWithLlm,
}: {
  reviewMode: ReturnType<typeof buildReviewModeSummary>
  hasSignals: boolean
  running: boolean
  onReviewWithLlm: () => void
}) {
  const toneClass: Record<ReturnType<typeof buildReviewModeSummary>["tone"], string> = {
    rules: "border-slate-200 bg-slate-50 text-slate-800 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100",
    pending: "border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-100",
    llm: "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100",
    error: "border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100",
  }
  const canReview = shouldShowReviewModeAction({
    hasSignals,
    running,
    tone: reviewMode.tone,
    canReviewWithLlm: reviewMode.canReviewWithLlm,
  })
  return (
    <div className={cn("flex flex-col gap-2 rounded-md border px-3 py-2 text-xs sm:flex-row sm:items-center sm:justify-between", toneClass[reviewMode.tone])}>
      <div className="min-w-0">
        <div className="font-medium">{reviewMode.label}</div>
        <div className="mt-0.5 line-clamp-2 leading-5 opacity-80">{reviewMode.detail}</div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 leading-5">
          <span className="rounded-md bg-background/70 px-2 py-0.5 font-medium">下一步</span>
          <span className="opacity-90">{reviewMode.nextAction}</span>
        </div>
      </div>
      {canReview && (
        <Button
          variant="outline"
          size="sm"
          className="h-7 shrink-0 bg-background/70 px-2 text-xs"
          onClick={onReviewWithLlm}
          disabled={running}
        >
          {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Brain className="h-3.5 w-3.5" />}
          LLM增强判断
        </Button>
      )}
    </div>
  )
}

function SignalScanContextNotice({
  copy,
}: {
  copy: ReturnType<typeof buildSignalScanContextCopy>
}) {
  if (!copy.show) return null
  const toneClass: Record<typeof copy.tone, string> = {
    idle: "border-muted bg-muted/30 text-muted-foreground",
    light: "border-sky-200 bg-sky-50 text-sky-950 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-100",
    framework: "border-primary/20 bg-primary/5 text-foreground",
    finance: "border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100",
  }
  const badgeClass: Record<NonNullable<(typeof copy.badges)[number]["tone"]>, string> = {
    default: "bg-background/70 text-foreground",
    finance: "bg-emerald-500/10 text-emerald-800 dark:text-emerald-200",
    wiki: "bg-primary/10 text-primary",
  }
  return (
    <div className={cn("rounded-md border px-3 py-2 text-xs", toneClass[copy.tone])} role="status" aria-live="polite">
      <div className="flex flex-col gap-2 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 font-medium">
            <SearchCheck className="h-3.5 w-3.5 shrink-0" />
            <span>{copy.label}</span>
          </div>
          <div className="mt-1 line-clamp-2 leading-5 opacity-80" title={copy.expandedDetail ?? copy.detail}>{copy.detail}</div>
          {copy.expandedDetail && (
            <details className="mt-1">
              <summary className="cursor-pointer text-[11px] font-medium opacity-70 hover:opacity-100">扫描细节</summary>
              <div className="mt-1 max-w-3xl leading-5 opacity-75">{copy.expandedDetail}</div>
            </details>
          )}
        </div>
        {copy.badges.length > 0 && (
          <div className="flex shrink-0 flex-wrap gap-1.5">
            {copy.badges.map((badge) => (
              <span
                key={badge.label}
                className={cn("rounded-md px-2 py-1 font-medium", badgeClass[badge.tone ?? "default"])}
                title={badge.title ?? badge.label}
              >
                {badge.label}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function SignalRunDigestBar({
  digest,
  queueSummary,
  onPrimaryAction,
  primaryActionDisabled,
  primaryActionBusy,
  suppressActionLabel,
}: {
  digest: ReturnType<typeof buildSignalRunDigest>
  queueSummary?: ReturnType<typeof buildPmDecisionQueueSummary>
  onPrimaryAction?: () => void
  primaryActionDisabled?: boolean
  primaryActionBusy?: boolean
  suppressActionLabel?: boolean
}) {
  const toneClass: Record<ReturnType<typeof buildSignalRunDigest>["tone"], string> = {
    idle: "border-muted bg-muted/30 text-muted-foreground",
    action: "border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100",
    review: "border-primary/20 bg-primary/5 text-foreground",
    quiet: "border-muted bg-muted/30 text-muted-foreground",
  }
  const badgeClass: Record<NonNullable<ReturnType<typeof buildSignalRunDigest>["badges"][number]["tone"]>, string> = {
    default: "bg-background/70 text-foreground",
    strong: "bg-emerald-500/10 text-emerald-800 dark:text-emerald-200",
    warn: "bg-amber-500/10 text-amber-800 dark:text-amber-200",
    danger: "bg-destructive/10 text-destructive",
  }
  const action = queueSummary ? buildSignalRunDigestAction(queueSummary) : null
  const showAction = Boolean(action && onPrimaryAction)
  const copy = buildSignalRunDecisionCopy({ digest, queueSummary })
  return (
    <div className={cn("rounded-md border px-3 py-2", toneClass[digest.tone])}>
      <div className="flex flex-col gap-2 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Lightbulb className="h-4 w-4 shrink-0" />
            <span className="truncate">{copy.headline}</span>
          </div>
          {copy.decisionParts.length > 0 ? (
            <div className="mt-1 grid gap-1 text-xs leading-5 sm:grid-cols-3">
              {copy.decisionParts.map((part) => (
                <div key={part.label} className="min-w-0 rounded-md bg-background/60 px-2 py-1">
                  <div className="text-[11px] font-medium opacity-70">{part.label}</div>
                  <div className="line-clamp-2">{part.value}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-0.5 line-clamp-2 text-xs leading-5 opacity-85">{copy.detail}</div>
          )}
          {copy.supporting && (
            <div className="mt-1 line-clamp-2 text-xs leading-5 opacity-75">{copy.supporting}</div>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 text-xs">
          {digest.badges.slice(0, 7).map((badge) => (
            <span key={badge.label} className={cn("rounded-md px-2 py-1", badgeClass[badge.tone ?? "default"])}>
              {badge.label} {badge.value}
            </span>
          ))}
          {action && !showAction && !suppressActionLabel && (
            <span className="rounded-md bg-background/70 px-2 py-1 font-medium">{action.label}</span>
          )}
          {showAction && action && (
            <Button
              type="button"
              size="sm"
              variant={action.variant}
              className="h-7 px-2 text-xs"
              onClick={onPrimaryAction}
              disabled={primaryActionDisabled}
              aria-label={primaryActionBusy ? `正在执行本轮信号主行动：${action.label}` : action.ariaLabel}
            >
              {primaryActionBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {action.label}
            </Button>
          )}
          {action && <span className="rounded-md bg-background/50 px-2 py-1">{action.secondary}</span>}
        </div>
      </div>
    </div>
  )
}

function SignalFocusBuckets({ buckets }: { buckets: ReturnType<typeof buildSignalFocusBuckets> }) {
  if (buckets.length === 0) return null
  const toneClass: Record<ReturnType<typeof buildSignalFocusBuckets>[number]["tone"], string> = {
    action: "border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100",
    danger: "border-destructive/20 bg-destructive/10 text-destructive",
    strong: "border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100",
    warn: "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100",
    review: "border-primary/20 bg-primary/5 text-primary",
    quiet: "border-muted bg-muted/30 text-muted-foreground",
  }
  return (
    <div className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-4">
      {buckets.slice(0, 7).map((bucket) => (
        <div
          key={bucket.id}
          className={cn("rounded-md border px-2.5 py-2", toneClass[bucket.tone])}
          title={bucket.guidance}
        >
          <div className="flex items-center justify-between gap-2 text-xs font-medium">
            <span>{bucket.label}</span>
            <span>{bucket.value}</span>
          </div>
          <div className="mt-0.5 line-clamp-1 text-[11px] opacity-80">{bucket.guidance}</div>
        </div>
      ))}
    </div>
  )
}

function PmSignalTriageBuckets({
  buckets,
  activeBucket = "all",
  onSelect,
}: {
  buckets: ReturnType<typeof buildPmSignalTriageBuckets>
  activeBucket?: PmSignalTriageBucketId | "all"
  onSelect?: (id: PmSignalTriageBucketId) => void
}) {
  if (buckets.length === 0) return null
  const toneClass: Record<ReturnType<typeof buildPmSignalTriageBuckets>[number]["tone"], string> = {
    action: "border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100",
    review: "border-primary/20 bg-primary/5 text-primary",
    quiet: "border-muted bg-muted/30 text-muted-foreground",
  }
  return (
    <div className="grid gap-2 lg:grid-cols-3" aria-label="PM三桶处理顺序">
      {buckets.map((bucket) => {
        const selected = activeBucket === bucket.id
        const disabled = !bucket.active || !onSelect
        return (
          <button
            key={bucket.id}
            type="button"
            className={cn(
              "rounded-md border px-3 py-2 text-left text-xs transition hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
              toneClass[bucket.tone],
              selected && "border-primary ring-2 ring-primary/25",
              disabled && "cursor-default opacity-60 hover:border-current",
            )}
            title={`${bucket.detail} ${bucket.nextAction}`}
            aria-pressed={selected}
            disabled={disabled}
            onClick={() => onSelect?.(bucket.id)}
          >
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">{bucket.label}</span>
            <span className={cn(
              "rounded-md px-2 py-0.5 font-semibold",
              bucket.active ? "bg-background/70" : "bg-muted/60",
            )}>
              {bucket.value}
            </span>
          </div>
          <div className="mt-1 line-clamp-2 leading-5 opacity-85">{bucket.detail}</div>
          <div className="mt-1 line-clamp-1 font-medium opacity-90">下一步：{bucket.nextAction}</div>
          </button>
        )
      })}
    </div>
  )
}

function WikiFrameClusterStrip({ clusters }: { clusters: ReturnType<typeof buildWikiFrameClusters> }) {
  const project = useWikiStore((s) => s.project)
  const setSelectedFile = useWikiStore((s) => s.setSelectedFile)
  const [openedFrame, setOpenedFrame] = useState<{ label: string; sourceRef: string } | null>(null)
  useEffect(() => {
    if (!openedFrame) return
    const timer = window.setTimeout(() => setOpenedFrame(null), 5000)
    return () => window.clearTimeout(timer)
  }, [openedFrame])
  if (clusters.length === 0) return null
  const toneClass: Record<ReturnType<typeof buildWikiFrameClusters>[number]["tone"], string> = {
    hot: "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100",
    active: "border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100",
    default: "border-muted bg-muted/30 text-foreground",
    stale: "border-muted bg-muted/20 text-muted-foreground",
  }
  const openWikiPage = (cluster: ReturnType<typeof buildWikiFrameClusters>[number]) => {
    const sourceRef = cluster.sourceRef
    if (!project?.path || !sourceRef.startsWith("wiki/") || sourceRef.includes("..")) return
    setSelectedFile(`${project.path}/${sourceRef}`)
    setOpenedFrame({ label: cluster.label, sourceRef })
  }
  return (
    <div className="rounded-md border bg-background px-3 py-2">
      <div className="flex flex-col gap-2 xl:flex-row xl:items-start">
        <div className="shrink-0 text-xs font-medium text-muted-foreground xl:w-20">今日框架</div>
        <div className="grid min-w-0 flex-1 gap-1.5 sm:grid-cols-2 xl:grid-cols-4">
          {clusters.map((cluster) => {
            const canOpen = Boolean(project?.path && cluster.sourceRef.startsWith("wiki/") && !cluster.sourceRef.includes(".."))
            const content = (
              <>
                <div className="flex items-center justify-between gap-2 text-xs font-medium">
                  <span className="truncate">{cluster.label}</span>
                  <span className="shrink-0 rounded bg-background/70 px-1.5 py-0.5">{cluster.count}</span>
                </div>
                <div className="mt-0.5 line-clamp-1 text-[11px] opacity-80">{cluster.detail || "已命中 wiki 框架"}</div>
              </>
            )
            if (!canOpen) {
              return (
                <div
                  key={cluster.key}
                  className={cn("rounded-md border px-2.5 py-2", toneClass[cluster.tone])}
                  title={cluster.detail}
                >
                  {content}
                </div>
              )
            }
            return (
              <button
                key={cluster.key}
                type="button"
                className={cn("rounded-md border px-2.5 py-2 text-left transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary", toneClass[cluster.tone])}
                title={`打开 wiki 框架：${cluster.sourceRef}${cluster.detail ? ` · ${cluster.detail}` : ""}`}
                onClick={() => openWikiPage(cluster)}
              >
                {content}
              </button>
            )
          })}
        </div>
      </div>
      {openedFrame && (
        <div
          className="mt-2 flex items-center gap-1.5 rounded-md bg-primary/10 px-2 py-1 text-xs text-primary"
          role="status"
          aria-live="polite"
          title={openedFrame.sourceRef}
        >
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">已打开右侧预览：{openedFrame.label}</span>
        </div>
      )}
    </div>
  )
}

function wikiFrameDecisionClass(tone: ReturnType<typeof buildWikiFrameDecisionLine>["tone"]) {
  if (tone === "hot") return "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100"
  if (tone === "active") return "border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100"
  if (tone === "stale") return "border-muted bg-muted/30 text-muted-foreground"
  return "border-primary/20 bg-primary/5 text-foreground"
}

function wikiFrameMatchFieldClass(tone: ReturnType<typeof buildWikiFrameDecisionLine>["match"]["fields"][number]["tone"]) {
  if (tone === "tag") return "bg-primary/10 text-primary"
  if (tone === "alias") return "bg-sky-500/10 text-sky-700 dark:text-sky-300"
  if (tone === "catalyst") return "bg-amber-500/10 text-amber-800 dark:text-amber-200"
  if (tone === "related") return "bg-emerald-500/10 text-emerald-800 dark:text-emerald-200"
  if (tone === "source") return "bg-muted text-muted-foreground"
  return "bg-background/80 text-muted-foreground"
}

function WikiFrameFirstLookStrip({ copy }: { copy: ReturnType<typeof buildWikiFrameFirstLookCopy> }) {
  if (!copy.show) return null
  return (
    <div className={cn("mt-2 rounded-md border px-2 py-1.5 text-xs", wikiFrameDecisionClass(copy.tone))} aria-label="wiki 表头首屏提示">
      <div className="flex min-w-0 items-center gap-1.5">
        <Database className="h-3.5 w-3.5 shrink-0" />
        <span className="shrink-0 rounded-md bg-background/70 px-1.5 py-0.5 font-medium">{copy.label}</span>
        <span className="line-clamp-1 min-w-0 leading-5">{copy.detail}</span>
      </div>
      {copy.next && <div className="mt-1 line-clamp-1 pl-5 leading-5 font-medium opacity-90">{copy.next}</div>}
    </div>
  )
}

function WikiFrameDecisionHint({ line }: { line: ReturnType<typeof buildWikiFrameDecisionLine> }) {
  if (!line.show) return null
  return (
    <div className={cn("mt-2 rounded-md border px-2 py-1.5 text-xs", wikiFrameDecisionClass(line.tone))}>
      <div className="flex items-center gap-1.5 font-medium">
        <Database className="h-3.5 w-3.5 shrink-0" />
        <span className="line-clamp-1">{line.headline}</span>
      </div>
      {line.badges.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {line.badges.map((badge) => (
            <span
              key={`${badge.label}:${badge.title}`}
              className={cn("inline-flex max-w-[132px] items-center rounded-md px-1.5 py-0.5 text-[11px]", wikiMetaBadgeClass(badge.tone))}
              title={badge.title}
            >
              <span className="truncate">{badge.label}</span>
            </span>
          ))}
        </div>
      )}
      {line.match.show && (
        <div className="mt-1 flex flex-wrap items-center gap-1">
          <span className="text-[11px] font-medium opacity-80">{line.match.headline}</span>
          {line.match.fields.slice(0, 4).map((field) => (
            <span
              key={`${field.label}:${field.terms.join("/")}`}
              className={cn("inline-flex max-w-[180px] items-center rounded-md px-1.5 py-0.5 text-[11px]", wikiFrameMatchFieldClass(field.tone))}
              title={`${field.label}：${field.terms.join(" / ")}`}
            >
              <span className="shrink-0 font-medium">{field.label}</span>
              <span className="ml-1 truncate opacity-80">{field.terms.join("/")}</span>
            </span>
          ))}
        </div>
      )}
      <div className="mt-1 line-clamp-2 leading-5 opacity-85">{line.detail}</div>
      <div className="mt-1 line-clamp-2 leading-5 font-medium opacity-90">{line.next}</div>
    </div>
  )
}

function SignalCardActionFeedbackView({
  feedback,
  onJump,
}: {
  feedback: ReturnType<typeof buildSignalCardActionFeedback>
  onJump?: () => void
}) {
  if (!feedback.show) return null
  const toneClass = feedback.tone === "running"
    ? "border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-100"
    : feedback.tone === "error"
      ? "border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100"
      : "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100"
  const Icon = feedback.tone === "running"
    ? Loader2
    : feedback.tone === "error"
      ? AlertTriangle
      : CheckCircle2
  return (
    <div role="status" aria-live="polite" className={cn("mt-2 rounded-md border px-2 py-1.5 text-xs leading-5", toneClass)}>
      <div className="flex items-center gap-1.5 font-medium">
        <Icon className={cn("h-3.5 w-3.5", feedback.tone === "running" && "animate-spin")} />
        <span>{feedback.label}</span>
      </div>
      <div className="mt-0.5 opacity-85">{feedback.detail}</div>
      {feedback.nextAction && (
        <div className="mt-1 rounded bg-background/60 px-2 py-1 font-medium opacity-95">
          下一步：{feedback.nextAction}
        </div>
      )}
      {feedback.jumpTargetLabel && onJump && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-2 h-7 bg-background/70 px-2 text-xs"
          onClick={onJump}
        >
          <ArrowRight className="h-3.5 w-3.5" />
          {feedback.jumpTargetLabel}
        </Button>
      )}
    </div>
  )
}

function SignalCardAskResultBackfillView({
  backfill,
  onJump,
}: {
  backfill: ReturnType<typeof buildSignalCardAskResultBackfill>
  onJump?: () => void
}) {
  if (!backfill.show || backfill.tone === "running" || backfill.tone === "error") return null
  const toneClass = backfill.tone === "ready"
    ? "border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100"
    : "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100"
  const Icon = backfill.tone === "ready" ? CheckCircle2 : Lightbulb
  return (
    <div role="status" aria-live="polite" className={cn("mt-2 rounded-md border px-2.5 py-2 text-xs leading-5", toneClass)}>
      <div className="flex flex-wrap items-center gap-1.5 font-medium">
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span>{backfill.label}</span>
        <span className="font-normal opacity-80">{backfill.headline}</span>
      </div>
      <div className="mt-1 grid gap-1.5 sm:grid-cols-2">
        <div className="rounded bg-background/60 px-2 py-1" title={backfill.stockLine}>{backfill.stockLine}</div>
        <div className="rounded bg-background/60 px-2 py-1" title={backfill.actionLine}>{backfill.actionLine}</div>
      </div>
      <div className="mt-1 rounded-md border border-current/10 bg-background/60 px-2 py-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rounded bg-primary/10 px-1.5 py-0.5 font-medium text-primary">{backfill.pmActionLabel}</span>
          <span className="opacity-85">{backfill.pmActionDetail}</span>
        </div>
        <div className="mt-1 line-clamp-2 opacity-80" title={backfill.observationLine}>{backfill.observationLine}</div>
      </div>
      <div className="mt-1 line-clamp-2 opacity-85" title={backfill.detail}>{backfill.detail}</div>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <span className="rounded bg-background/60 px-2 py-0.5 opacity-80">{backfill.sourceLine}</span>
        {backfill.jumpTargetLabel && onJump && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 bg-background/70 px-2 text-xs"
            onClick={onJump}
          >
            <ArrowRight className="h-3.5 w-3.5" />
            {backfill.jumpTargetLabel}
          </Button>
        )}
      </div>
    </div>
  )
}

function SignalEvidenceDetails({
  copy,
  children,
}: {
  copy: ReturnType<typeof buildSignalEvidenceToggleCopy>
  children: ReactNode
}) {
  return (
    <details className="mt-2 rounded-md border border-dashed bg-muted/20 px-2 py-1.5 text-xs">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-1.5 font-medium text-muted-foreground">
        <ClipboardList className="h-3.5 w-3.5 shrink-0" />
        <span title={copy.title}>{copy.label}</span>
        <span className="font-normal opacity-75">{copy.detail}</span>
      </summary>
      <div className="mt-2 space-y-2">
        {children}
      </div>
    </details>
  )
}

function SignalCardActions({
  plan,
  running,
  feedback,
  onAction,
}: {
  plan: ReturnType<typeof buildSignalCardActions>
  running: boolean
  feedback?: ReturnType<typeof buildSignalCardActionFeedback>
  onAction: (kind: ReturnType<typeof buildSignalCardActions>["primary"]["kind"]) => void
}) {
  const panelCopy = buildSignalCardActionPanelCopy(plan)
  const panelToneClass: Record<ReturnType<typeof buildSignalCardActionPanelCopy>["tone"], string> = {
    action: "border-primary/20 bg-primary/5 text-primary",
    research: "border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-100",
    track: "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100",
    quiet: "border-muted bg-muted/40 text-muted-foreground",
  }
  const renderAction = (action: ReturnType<typeof buildSignalCardActions>["primary"], primary = false) => {
    const state = buildSignalCardActionButtonState({ action, feedback, running })
    return (
      <Button
        key={action.kind}
        type="button"
        size="sm"
        variant={action.variant}
        className={cn("h-7 px-2 text-xs", primary && "min-w-[104px] font-semibold")}
        onClick={() => onAction(action.kind)}
        disabled={state.disabled}
        aria-label={state.ariaLabel}
        title={state.title}
      >
        {state.busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        {state.label}
      </Button>
    )
  }
  return (
    <div className="flex shrink-0 flex-wrap justify-end gap-1.5 lg:w-[164px] lg:flex-col lg:items-stretch">
      <div className={cn("rounded-md border px-2 py-1 text-[11px] leading-4", panelToneClass[panelCopy.tone])} title={panelCopy.detail}>
        <div className="font-semibold">{panelCopy.label}</div>
        <div className="mt-0.5 opacity-80">{panelCopy.detail}</div>
      </div>
      {renderAction(plan.primary, true)}
      <div className={cn("rounded-md border px-2 py-1 text-[11px] font-medium leading-4", panelToneClass[panelCopy.tone])}>
        {panelCopy.actionLine}
      </div>
      {plan.secondary.length > 0 && (
        <div className="flex flex-wrap justify-end gap-1.5 lg:justify-start">
          {plan.secondary.map((action) => renderAction(action))}
        </div>
      )}
    </div>
  )
}

function SignalSourceDetails({ source }: { source: ReturnType<typeof buildSignalCardSourceCopy> }) {
  if (!source.excerpt && !source.reason && !source.auditLabel) return null
  return (
    <details className="mt-2 rounded-md bg-muted/40 px-2 py-1 text-xs text-muted-foreground">
      <summary className="cursor-pointer select-none font-medium text-foreground/70">来源/理由</summary>
      <div className="mt-2 space-y-1.5 leading-5">
        {source.excerpt && (
          <div className="grid gap-1 sm:grid-cols-[56px_minmax(0,1fr)]">
            <span className="font-medium opacity-75">摘录</span>
            <span className="break-words">{source.excerpt}</span>
          </div>
        )}
        {source.reason && (
          <div className="grid gap-1 sm:grid-cols-[56px_minmax(0,1fr)]">
            <span className="font-medium opacity-75">判断</span>
            <span className="break-words">{source.reason}</span>
          </div>
        )}
        {source.auditLabel && (
          <div className="grid gap-1 sm:grid-cols-[56px_minmax(0,1fr)]">
            <span className="font-medium opacity-75">审计</span>
            <span className="truncate" title={source.auditTitle || source.auditLabel}>{source.auditLabel}</span>
          </div>
        )}
      </div>
    </details>
  )
}

function SignalInfoFlowPath({ flow }: { flow: ReturnType<typeof buildSignalInfoFlowCopy> }) {
  const toneClass: Record<ReturnType<typeof buildSignalInfoFlowCopy>["tone"], string> = {
    confirm: "border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100",
    ask: "border-primary/20 bg-primary/5 text-primary",
    support: "border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100",
    catalyst: "border-primary/20 bg-primary/5 text-primary",
    market: "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100",
    counter: "border-destructive/20 bg-destructive/10 text-destructive",
    candidate: "border-primary/20 bg-primary/5 text-primary",
    quiet: "border-muted bg-muted/30 text-muted-foreground",
  }
  const steps = [
    { label: "来源", value: flow.source },
    { label: "框架", value: flow.frame },
    { label: "对象", value: flow.target },
    { label: "动作", value: flow.action },
  ]
  return (
    <div className={cn("mt-2 rounded-md border px-2 py-1.5 text-xs", toneClass[flow.tone])}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center gap-1 font-medium">
          <GitBranch className="h-3.5 w-3.5" />
          信息流
        </span>
        {steps.map((step, index) => (
          <span key={step.label} className="inline-flex min-w-0 items-center gap-1">
            {index > 0 && <ArrowRight className="h-3 w-3 shrink-0 opacity-60" aria-hidden="true" />}
            <span className="shrink-0 opacity-70">{step.label}</span>
            <span className="max-w-[220px] truncate rounded bg-background/70 px-1.5 py-0.5 font-medium" title={step.value}>
              {step.value}
            </span>
          </span>
        ))}
      </div>
      <div className="mt-1 line-clamp-2 text-[11px] leading-5 opacity-80">{flow.detail}</div>
    </div>
  )
}

function SignalDecisionBlock({
  copy,
  rankReason,
}: {
  copy: ReturnType<typeof buildSignalCardDecisionCopy>
  rankReason?: ReturnType<typeof buildSignalCardRankReason>
}) {
  const toneClass: Record<ReturnType<typeof buildSignalCardDecisionCopy>["tone"], { box: string; badge: string }> = {
    confirm: {
      box: "border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100",
      badge: "bg-emerald-600 text-white dark:bg-emerald-500 dark:text-emerald-950",
    },
    ask: {
      box: "border-primary/20 bg-primary/5 text-primary",
      badge: "bg-primary text-primary-foreground",
    },
    support: {
      box: "border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100",
      badge: "bg-emerald-600 text-white dark:bg-emerald-500 dark:text-emerald-950",
    },
    catalyst: {
      box: "border-primary/20 bg-primary/5 text-primary",
      badge: "bg-primary text-primary-foreground",
    },
    market: {
      box: "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100",
      badge: "bg-amber-500 text-amber-950",
    },
    counter: {
      box: "border-destructive/20 bg-destructive/10 text-destructive",
      badge: "bg-destructive text-destructive-foreground",
    },
    candidate: {
      box: "border-primary/20 bg-primary/5 text-primary",
      badge: "bg-primary text-primary-foreground",
    },
    quiet: {
      box: "border-muted bg-muted/30 text-muted-foreground",
      badge: "bg-muted text-foreground",
    },
  }
  const tone = toneClass[copy.tone]
  const rows = [
    ...(rankReason?.show ? [[rankReason.label, rankReason.detail]] : []),
    ["为什么重要", copy.whyImportant],
    ["影响假设", copy.affects],
    ["现在动作", copy.nextAction],
  ]
  return (
    <div className={cn("mt-2 rounded-md border px-2.5 py-2 text-xs", tone.box)}>
      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-2">
        <span className={cn("inline-flex shrink-0 items-center rounded-md px-2 py-1 font-medium", tone.badge)}>
          {copy.decision}
        </span>
        <span className="line-clamp-2 leading-5 font-medium">{copy.reason}</span>
      </div>
      <div className="mt-2 space-y-1 border-t border-current/10 pt-1.5 opacity-85">
        {rows.map(([label, value]) => (
          <div key={label} className="grid gap-1 leading-5 sm:grid-cols-[72px_minmax(0,1fr)]">
            <span className="font-medium opacity-75">{label}</span>
            <span className="line-clamp-2">{value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function DailyStatusBar({
  selectedTitle,
  selectedId,
  autoRefresh,
  running,
  runningStage,
  latestLog,
  sourceCount,
  matchedCount,
  eventCount,
  alertCount,
  newMessageCount,
  pendingCount,
  confirmableCount,
  askRecommendedCount,
  candidateCount,
  autoScanSeconds,
  answer,
  progress,
  scope,
  reviewMode,
  scanMode,
  pmOpeningBrief,
  actionFeedback,
  nextAction,
  onJumpToSignals,
  onJumpToAskResult,
}: {
  selectedTitle: string
  selectedId: string
  autoRefresh: boolean
  running: boolean
  runningStage?: CockpitStage
  latestLog?: ActivityLogEntry
  sourceCount: number
  matchedCount: number
  eventCount: number
  alertCount: number
  newMessageCount: number
  pendingCount: number
  confirmableCount: number
  askRecommendedCount: number
  candidateCount: number
  autoScanSeconds: number | null
  answer: WatchAnswer
  progress: ScanProgressSummary
  scope: ReturnType<typeof buildScanScopeSummary>
  reviewMode: ReturnType<typeof buildReviewModeSummary>
  scanMode: ReturnType<typeof buildScanModeSummary>
  pmOpeningBrief: ReturnType<typeof buildPmOpeningBrief>
  actionFeedback: ReturnType<typeof buildDailyStatusActionFeedback>
  nextAction: string
  onJumpToSignals?: () => void
  onJumpToAskResult?: () => void
}) {
  const hasAction = confirmableCount > 0 || askRecommendedCount > 0 || pendingCount > 0
  const progressToneClass: Record<ScanProgressSummary["tone"], string> = {
    idle: "bg-muted",
    running: "bg-primary",
    done: "bg-emerald-500",
    error: "bg-destructive",
  }
  const reviewModeClass: Record<ReturnType<typeof buildReviewModeSummary>["tone"], string> = {
    rules: "bg-muted text-muted-foreground",
    pending: "bg-primary/10 text-primary",
    llm: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
    error: "bg-destructive/10 text-destructive",
  }
  const deskBrief = buildTradingDeskScanBrief({
    running,
    runningStageLabel: runningStage?.label,
    runningStageDetail: runningStage?.detail,
    latestLogLabel: latestLog?.stage,
    latestLogDetail: latestLog?.detail,
    selectedTitle: selectedId ? selectedTitle : "",
    sourceCount,
    newMessageCount,
    matchedCount,
    pendingCount,
    confirmableCount,
    askRecommendedCount,
    candidateCount,
    pmOpeningBrief,
    nextAction,
  })
  const deskBriefClass: Record<ReturnType<typeof buildTradingDeskScanBrief>["tone"], string> = {
    running: "border-primary/20 bg-primary/5 text-primary",
    action: "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100",
    review: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100",
    quiet: "border-muted bg-muted/40 text-muted-foreground",
    idle: "border-muted bg-muted/30 text-muted-foreground",
  }
  const actionFeedbackClass: Record<ReturnType<typeof buildDailyStatusActionFeedback>["tone"], string> = {
    running: "bg-primary/10 text-primary",
    done: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
    error: "bg-destructive/10 text-destructive",
  }
  return (
    <section className="sticky top-0 z-20 rounded-lg border bg-background/95 px-3 py-2 shadow-sm backdrop-blur" aria-live="polite">
      <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className={cn(
              "inline-flex items-center gap-2 rounded-md px-2 py-1 font-medium",
              running ? "bg-primary/10 text-primary" : autoRefresh ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200" : "bg-primary/10 text-primary",
            )} title={scanMode.detail}>
              {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : autoRefresh ? <Radio className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}
              {running ? "运行中" : scanMode.shortLabel}
            </span>
            <span className="rounded-md bg-muted px-2 py-1 font-medium">来源 {sourceCount}</span>
            <span className="rounded-md bg-muted px-2 py-1 font-medium">新增 {newMessageCount}</span>
            <span className={cn("rounded-md px-2 py-1 font-medium", matchedCount > 0 ? "bg-primary/10 text-primary" : "bg-muted")}>命中 {matchedCount}</span>
            <span className={cn("rounded-md px-2 py-1 font-medium", pendingCount > 0 ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200" : "bg-muted")}>待处理 {pendingCount}</span>
            {confirmableCount > 0 && (
              <span className="rounded-md bg-emerald-100 px-2 py-1 font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">可确认 {confirmableCount}</span>
            )}
            {askRecommendedCount > 0 && (
              <span className="rounded-md bg-primary/10 px-2 py-1 font-medium text-primary">建议 Ask {askRecommendedCount}</span>
            )}
            {candidateCount > 0 && (
              <span className="rounded-md bg-muted px-2 py-1 font-medium">候选 {candidateCount}</span>
            )}
            {autoRefresh && autoScanSeconds != null && (
              <span className="rounded-md bg-emerald-100 px-2 py-1 font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">下轮 {autoScanSeconds}s</span>
            )}
            <span className={cn("rounded-md px-2 py-1 font-medium", reviewModeClass[reviewMode.tone])} title={reviewMode.detail}>
              {reviewMode.label}
            </span>
            {(eventCount > 0 || alertCount > 0) && (
              <span className="text-muted-foreground">events {eventCount} / alerts {alertCount}</span>
            )}
          </div>
          <div
            className={cn(
              "mt-1 flex max-w-full flex-wrap items-center gap-1.5 rounded-md border px-2 py-1 text-xs",
              deskBriefClass[deskBrief.tone],
            )}
            title={`${deskBrief.headline}｜${deskBrief.detail}｜${answer.conclusion}`}
          >
            <span className="shrink-0 rounded-md bg-background/70 px-2 py-0.5 font-medium">{deskBrief.label}</span>
            <span className="min-w-0 truncate font-medium">{deskBrief.headline}</span>
            <span className="hidden min-w-0 truncate opacity-85 md:inline">{deskBrief.detail}</span>
          </div>
          <div className={cn(
            "mt-1 inline-flex max-w-full rounded-md px-2 py-0.5 text-[11px]",
            scope.tone === "scoped" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
          )} title={scope.detail}>
            <span className="truncate">{scope.label} · {scope.detail}</span>
          </div>
          <div className="mt-2 grid gap-1.5 sm:grid-cols-[1fr_auto] sm:items-center">
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className={cn("h-full rounded-full transition-all duration-300", progressToneClass[progress.tone])}
                style={{ width: `${progress.percent}%` }}
              />
            </div>
            <div className="truncate text-[11px] text-muted-foreground">
              {progress.currentStep}/{progress.totalSteps} · {progress.label} · {progress.detail}
            </div>
          </div>
          <div
            className={cn(
              "mt-1 flex max-w-full flex-wrap items-center gap-1.5 rounded-md px-2 py-1 text-[11px]",
              progress.tone === "error"
                ? "bg-destructive/10 text-destructive"
                : progress.canActBeforeDone
                  ? "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100"
                  : "bg-muted/60 text-muted-foreground",
            )}
            title={progress.phaseHint}
          >
            <span className="shrink-0 font-medium">{progress.phaseLabel}</span>
            <span className="min-w-0 truncate">{progress.phaseHint}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-xs">
          {actionFeedback.show && (
            <span
              className={cn("max-w-sm truncate rounded-md px-2 py-1 font-medium", actionFeedbackClass[actionFeedback.tone])}
              title={actionFeedback.detail}
            >
              {actionFeedback.label}：{actionFeedback.detail}
            </span>
          )}
          {actionFeedback.show && actionFeedback.jumpLabel && onJumpToAskResult && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs"
              onClick={onJumpToAskResult}
              aria-label={`跳转到 Ask 结果区：${actionFeedback.jumpLabel}`}
            >
              <ArrowRight className="h-3.5 w-3.5" />
              {actionFeedback.jumpLabel}
            </Button>
          )}
          {deskBrief.jumpLabel && onJumpToSignals && (
            <Button
              type="button"
              size="sm"
              variant={deskBrief.tone === "action" ? "default" : "outline"}
              className="h-7 px-2 text-xs"
              onClick={onJumpToSignals}
              aria-label={`跳转到待处理区：${deskBrief.jumpLabel}`}
            >
              <ArrowRight className="h-3.5 w-3.5" />
              {deskBrief.jumpLabel}
            </Button>
          )}
          <span className={cn(
            "max-w-md truncate rounded-md px-2 py-1",
            hasAction ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
          )}>
            {actionFeedback.show
              ? actionFeedback.tone === "running"
                ? "正在执行这一步，结果会回写到卡片和顶部"
                : actionFeedback.tone === "error"
                  ? "这一步失败了，先看错误后重试"
                  : "操作完成后可继续处理下一张卡片"
              : runningStage
                ? `${runningStage.label}：${runningStage.detail ?? "处理中"}`
                : latestLog
                  ? `${latestLog.stage}：${latestLog.detail}`
                  : nextAction}
          </span>
        </div>
      </div>
    </section>
  )
}

function WatchAnswerCard({ answer, onPrepareGap }: { answer: WatchAnswer; onPrepareGap?: (gapCode: string) => void }) {
  const Icon = answer.tone === "support" ? CheckCircle2 : answer.tone === "neutral" ? SearchCheck : AlertTriangle
  const toneClass: Record<WatchAnswerTone, string> = {
    neutral: "border-slate-200 bg-slate-50 text-slate-800 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100",
    support: "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100",
    warning: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100",
    danger: "border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100",
  }
  const mutedClass: Record<WatchAnswerTone, string> = {
    neutral: "text-slate-600 dark:text-slate-300",
    support: "text-emerald-700 dark:text-emerald-200",
    warning: "text-amber-700 dark:text-amber-200",
    danger: "text-red-700 dark:text-red-200",
  }

  return (
    <section className={cn("rounded-lg border p-4", toneClass[answer.tone])}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Icon className="h-4 w-4 shrink-0" />
            <h3 className="font-medium">验证回答</h3>
            <span className="rounded-md bg-background/70 px-2 py-0.5 text-xs">{answer.evidenceDelta}</span>
          </div>
          <div className="mt-3 text-lg font-semibold">{answer.verdict}</div>
          <p className={cn("mt-2 max-w-5xl text-sm leading-6", mutedClass[answer.tone])}>{answer.conclusion}</p>
        </div>
        <div className="shrink-0 rounded-md bg-background/70 px-3 py-2 text-xs">
          <div className="font-medium">下一步</div>
          <div className={cn("mt-1 max-w-sm leading-5", mutedClass[answer.tone])}>{answer.nextAction}</div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <div className="rounded-md bg-background/70 p-3">
          <div className="text-xs font-medium">为什么</div>
          <div className={cn("mt-1 text-xs leading-5", mutedClass[answer.tone])}>{answer.reason}</div>
        </div>
        <div className="rounded-md bg-background/70 p-3">
          <div className="text-xs font-medium">来源</div>
          <div className={cn("mt-1 break-words text-xs leading-5", mutedClass[answer.tone])}>{answer.sourceRef || "暂无来源"}</div>
          <RelatedWikiPages
            pages={arrayRecords(answer.relatedWikiPages)}
            evidenceDelta={answer.evidenceDelta}
          />
        </div>
        <div className="rounded-md bg-background/70 p-3">
          <div className="text-xs font-medium">还缺什么</div>
          <div className="mt-2">
            <EvidenceGapTaskList
              codes={answer.evidenceGaps}
              onPrepareGap={onPrepareGap}
              compact
              empty="暂无结构化缺口"
            />
          </div>
        </div>
      </div>

      {answer.sourceExcerpt && (
        <div className="mt-3 rounded-md bg-background/70 p-3">
          <div className="text-xs font-medium">命中摘录</div>
          <div className={cn("mt-1 break-words text-xs leading-5", mutedClass[answer.tone])}>{answer.sourceExcerpt}</div>
        </div>
      )}
    </section>
  )
}

function EvidenceGapTaskList({
  codes,
  onPrepareGap,
  compact = false,
  empty = "暂无",
}: {
  codes: unknown[]
  onPrepareGap?: (gapCode: string) => void
  compact?: boolean
  empty?: string
}) {
  const gaps = uniqueEvidenceGapInfos(codes).slice(0, compact ? 4 : 8)
  if (gaps.length === 0) return <div className="text-xs text-muted-foreground">{empty}</div>
  return (
    <div className={cn("space-y-2", compact && "space-y-1.5")}>
      {gaps.map((gap) => (
        <EvidenceGapTaskRow
          key={gap.code}
          info={gap}
          onPrepareGap={onPrepareGap}
          compact={compact}
        />
      ))}
    </div>
  )
}

function EvidenceGapTaskRow({
  info,
  count,
  onPrepareGap,
  compact = false,
}: {
  info: EvidenceGapInfo
  count?: number
  onPrepareGap?: (gapCode: string) => void
  compact?: boolean
}) {
  return (
    <div className={cn(
      "min-w-0 rounded-md border bg-background/80",
      compact ? "px-2 py-1.5" : "p-3",
    )}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className={cn("font-medium", compact ? "text-xs" : "text-sm")}>{info.label}</div>
          {!compact && <div className="mt-1 text-xs leading-5 text-muted-foreground">{info.description}</div>}
          <div className="mt-1 flex flex-wrap gap-1">
            {info.sources.slice(0, compact ? 2 : 4).map((source) => (
              <span key={source} className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                {source}
              </span>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {typeof count === "number" && (
            <span className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">{count}</span>
          )}
          {onPrepareGap && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => onPrepareGap(info.code)}
            >
              补这个
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

function SupplementSourceOption({
  option,
  selected,
  onToggle,
}: {
  option: { id: string; label: string; status: string; body: string }
  selected: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "rounded-md border bg-background p-3 text-left transition-colors hover:border-primary/40",
        selected && "border-primary bg-primary/5 ring-1 ring-primary/20",
      )}
      aria-pressed={selected}
    >
      <div className="flex items-start gap-2">
        <span className={cn(
          "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border",
          selected ? "border-primary bg-primary text-primary-foreground" : "border-input",
        )}>
          {selected && <CheckCircle2 className="h-3 w-3" />}
        </span>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{option.label}</div>
          <div className="mt-1 text-xs text-muted-foreground">{option.body}</div>
          <div className="mt-2 text-[11px] text-muted-foreground">{option.status}</div>
        </div>
      </div>
    </button>
  )
}

function CandidateHypothesisCard({
  item,
  running,
  onTrack,
  onPrecheck,
}: {
  item: Record<string, unknown>
  running: boolean
  onTrack: () => void
  onPrecheck: () => void
}) {
  const metaLine = buildCandidateThemeSegmentLine({ theme: item.theme, segments: item.segments })
  return (
    <div className="rounded-md border bg-card p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="line-clamp-2 text-sm font-medium">{textValue(item.title)}</div>
          <div className="mt-1 truncate text-xs text-muted-foreground" title={metaLine}>
            {metaLine}
          </div>
        </div>
        <StatusBadge status={textValue(item.status, "seed")} />
      </div>
      <div className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">{textValue(item.discoveryReason || item.discoveryQuestion, "来自 AI 并发发现")}</div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <div className="truncate text-xs text-muted-foreground">{listText(item.evidenceRefs) || "候选未落盘"}</div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          <Button size="sm" className="h-7 px-2 text-xs" onClick={onPrecheck} disabled={running} title="只读 Ask 预检，不写入假设库。">
            <SearchCheck className="h-3.5 w-3.5" />
            Ask 预检
          </Button>
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={onTrack} disabled={running}>
            <PlusCircle className="h-3.5 w-3.5" />
            加入跟踪
          </Button>
        </div>
      </div>
    </div>
  )
}

function timelineToneClass(tone: string) {
  if (tone === "risk") return "border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-100"
  if (tone === "market") return "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100"
  if (tone === "support") return "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100"
  if (tone === "hot") return "border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-100"
  return "border-muted bg-muted/30 text-muted-foreground"
}

function HypothesisTimelineMiniList({
  items,
}: {
  items: ReturnType<typeof buildHypothesisTimelineItems>
}) {
  if (!items.length) {
    return (
      <div className="mt-2 rounded-md border border-dashed bg-background px-2 py-1.5 text-[11px] text-muted-foreground">
        暂无轨迹；先扫描新增资料或 Ask 深挖。
      </div>
    )
  }
  return (
    <div className="mt-2 space-y-1.5" aria-label="假设最近轨迹">
      {items.slice(0, 2).map((timeline) => (
        <div key={timeline.key} className={cn("rounded-md border px-2 py-1.5", timelineToneClass(timeline.tone))}>
          <div className="flex min-w-0 items-center gap-1.5 text-[10px]">
            <span className="shrink-0 font-medium">{timeline.badge}</span>
            <span className="shrink-0 text-muted-foreground/80">{timeline.transition}</span>
            <span className="truncate text-muted-foreground/80" title={timeline.sourceTitle || timeline.sourceLabel}>
              {timeline.sourceLabel || timeline.createdAt || "来源待补"}
            </span>
            {timeline.askRunRef && (
              <span className="shrink-0 rounded bg-background/70 px-1 py-0.5 font-medium text-primary" title={timeline.askRunRef}>
                Ask证据
              </span>
            )}
            {timeline.mergedCount > 1 && (
              <span className="shrink-0 rounded bg-background/70 px-1 py-0.5 font-medium" title="同一来源、同一信号类型已合并展示">
                合并{timeline.mergedCount}条
              </span>
            )}
          </div>
          <div className="mt-1 line-clamp-2 text-[11px] leading-4" title={timeline.detail || timeline.excerpt}>
            {timeline.detail || timeline.excerpt || "暂无摘要"}
          </div>
        </div>
      ))}
    </div>
  )
}

function HypothesisTimelineDetailPanel({
  brief,
  qualityBrief,
  wikiFrameCopy,
  running,
  canConfirm,
  onAsk,
  onConfirm,
  onScan,
  onPrepareDefinition,
}: {
  brief: ReturnType<typeof buildHypothesisTimelineBrief>
  qualityBrief: ReturnType<typeof buildHypothesisQualityBrief>
  wikiFrameCopy: ReturnType<typeof buildWikiFrameFirstLookCopy>
  running: boolean
  canConfirm: boolean
  onAsk: () => void
  onConfirm: () => void
  onScan: () => void
  onPrepareDefinition: () => void
}) {
  if (!brief.show) return null
  return (
    <div className="mt-3 rounded-lg border bg-background p-3" aria-live="polite">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn("rounded-md border px-2 py-1 text-xs font-medium", brief.tone === "empty" ? "bg-muted text-muted-foreground" : timelineToneClass(brief.tone))}>
              假设轨迹
            </span>
            <span className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">{brief.statusLabel}</span>
            <span className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">{brief.itemCount} 条</span>
          </div>
          <h4 className="mt-2 line-clamp-2 font-medium">{brief.title}</h4>
          <div className="mt-1 text-sm font-medium">{brief.headline}</div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{brief.detail}</p>
          <div className="mt-2 rounded-md border border-dashed bg-card px-2 py-1.5 text-xs leading-5">
            <span className="font-medium text-muted-foreground">生命线：</span>
            <span>{brief.trajectoryLine}</span>
          </div>
          <p className="mt-2 rounded-md bg-muted/60 px-2 py-1.5 text-xs leading-5">
            下一步：{brief.nextAction}
          </p>
          <div className={cn(
            "mt-2 rounded-md border px-2 py-1.5 text-xs leading-5",
            qualityBrief.tone === "ready"
              ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100"
              : "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100",
          )}>
            <div className="font-medium">{qualityBrief.label}：{qualityBrief.headline}</div>
            <div className="mt-0.5 opacity-80">{qualityBrief.detail}</div>
            <div className="mt-0.5 font-medium opacity-90">建议：{qualityBrief.nextAction}</div>
          </div>
          {wikiFrameCopy.show && (
            <div className={cn("mt-2 rounded-md border px-2 py-1.5 text-xs leading-5", wikiFrameFirstLookClass(wikiFrameCopy.tone))}>
              <div className="font-medium">{wikiFrameCopy.label}：{wikiFrameCopy.detail}</div>
              <div className="mt-0.5 opacity-90">建议：{wikiFrameCopy.next}</div>
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2 lg:justify-end">
          {qualityBrief.tone === "needs_work" && (
            <Button variant="outline" size="sm" onClick={onPrepareDefinition} disabled={running}>
              <FilePlus2 className="h-3.5 w-3.5" />
              补定义
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={onScan} disabled={running}>
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Clock className="h-3.5 w-3.5" />}
            扫描新增资料
          </Button>
          <Button variant="outline" size="sm" onClick={onAsk} disabled={running}>
            <SearchCheck className="h-3.5 w-3.5" />
            Ask 深挖
          </Button>
          <Button size="sm" onClick={onConfirm} disabled={running || !canConfirm}>
            <Save className="h-3.5 w-3.5" />
            确认状态
          </Button>
        </div>
      </div>
      {brief.items.length > 0 ? (
        <div className="mt-3 grid gap-2 lg:grid-cols-2" aria-label="选中假设轨迹详情">
          {brief.items.map((item) => (
            <div key={item.key} className={cn("rounded-md border px-3 py-2", timelineToneClass(item.tone))}>
              <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs">
                <span className="font-medium">{item.badge}</span>
                <span className="text-muted-foreground/80">{item.transition}</span>
                <span className="truncate text-muted-foreground/80" title={item.sourceTitle || item.sourceLabel}>
                  {item.sourceLabel || item.createdAt || "来源待补"}
                </span>
                <span className="shrink-0 rounded bg-background/70 px-1.5 py-0.5 text-[11px] font-medium">
                  {item.sourceTypeLabel}
                </span>
                <span className="shrink-0 rounded bg-background/70 px-1.5 py-0.5 text-[11px] font-medium">
                  {item.signalStrengthLabel}
                </span>
                {item.askRunRef && (
                  <span className="shrink-0 rounded bg-background/70 px-1.5 py-0.5 text-[11px] font-medium text-primary" title={item.askRunRef}>
                    Ask证据
                  </span>
                )}
                {item.mergedCount > 1 && (
                  <span className="shrink-0 rounded bg-background/70 px-1.5 py-0.5 text-[11px] font-medium" title="同一来源、同一信号类型已合并展示">
                    合并{item.mergedCount}条信号
                  </span>
                )}
              </div>
              <div className="mt-1 line-clamp-2 text-xs leading-5" title={item.detail || item.excerpt}>
                {item.detail || item.excerpt || "暂无摘要"}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-3 rounded-md border border-dashed px-3 py-3 text-xs leading-5 text-muted-foreground">
          这条假设还没有新增资料轨迹。先点“扫描新增资料”，或直接 Ask 深挖生成第一条研究线索。
        </div>
      )}
    </div>
  )
}

function HypothesisTrackingRow({
  item,
  signal,
  selected,
  running,
  askCache,
  onSelect,
  onAsk,
  onConfirm,
  onPrepareDefinition,
}: {
  item: Record<string, unknown>
  signal: ReturnType<typeof latestSignalForHypothesis>
  selected?: boolean
  running: boolean
  askCache: ReturnType<typeof buildAskCacheStatusCopy>
  onSelect: () => void
  onAsk: () => void
  onConfirm: () => void
  onPrepareDefinition: () => void
}) {
  const status = textValue(item.status, "watching")
  const feedbackStatus = textValue(item.feedbackStatus, status)
  const suggestedStatus = signal.suggestedStatus || feedbackStatus
  const canConfirm = suggestedStatus !== status
  const source = sourcePreview(signal.sourceExcerpt, signal.sourceRef)
  const signalSummary = signalSourceSummary({
    tradingImplication: signal.tradingImplication,
    sourceExcerpt: signal.sourceExcerpt,
    sourceRef: signal.sourceRef,
    reason: signal.reason,
  })
  const rowRelatedWikiPages = arrayRecords(signal.relatedWikiPages).length ? signal.relatedWikiPages : item.relatedWikiPages
  const relatedWikiSummary = buildRelatedWikiSummary({
    pages: rowRelatedWikiPages,
    evidenceDelta: signal.evidenceDelta,
    signalType: signal.signalType,
  })
  const relatedWikiCount = relatedWikiSummary.count
  const timelineItems = buildHypothesisTimelineItems(item, signal, { limit: 2 })
  const qualityBrief = buildHypothesisQualityBrief(item)
  const workPriority = buildHypothesisWorkPriority({
    status,
    suggestedStatus,
    evidenceDelta: signal.evidenceDelta,
    signalType: signal.signalType,
    askDeepDiveRecommended: signal.askDeepDiveRecommended,
    relatedWikiPages: rowRelatedWikiPages,
  })
  const metaLine = buildCandidateThemeSegmentLine({ theme: item.theme, segments: item.segments })
  return (
    <div className={cn("grid min-w-[1120px] grid-cols-[minmax(280px,1.3fr)_130px_130px_minmax(280px,1fr)_220px] items-center gap-3 px-3 py-3 text-sm", selected && "bg-primary/5")}>
      <button type="button" onClick={onSelect} className="min-w-0 text-left">
        <div className="truncate font-medium">{textValue(item.title)}</div>
        <div className="mt-1 truncate text-xs text-muted-foreground" title={metaLine}>
          {metaLine}
        </div>
        <div className="mt-1 flex min-w-0 items-center gap-1.5">
          <span
            className={cn("shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-medium", workPriorityClass(workPriority.tier))}
            title={workPriority.reason}
          >
            {workPriority.label}
          </span>
          <span className="truncate text-[10px] text-muted-foreground" title={workPriority.reason}>
            {workPriority.reason}
          </span>
        </div>
        <div className="mt-1 flex min-w-0 items-center gap-1.5">
          <span
            className={cn(
              "shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium",
              qualityBrief.tone === "ready"
                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                : "bg-amber-500/10 text-amber-800 dark:text-amber-200",
            )}
            title={qualityBrief.detail}
          >
            {qualityBrief.label}
          </span>
          <span className="truncate text-[10px] text-muted-foreground" title={qualityBrief.detail}>
            {qualityBrief.headline}
          </span>
        </div>
      </button>
      <div className="flex flex-wrap items-center gap-1">
        <StatusBadge status={status} />
        {feedbackStatus !== status && <span className="text-[11px] text-muted-foreground">反馈 {hypothesisStatusLabel(feedbackStatus)}</span>}
      </div>
      <StatusBadge status={suggestedStatus} />
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-xs font-medium">{signal.signalType || signalStrengthLabel(signal.evidenceDelta)}</span>
          {relatedWikiCount > 0 && (
            <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {relatedWikiSummary.label} {relatedWikiCount}
            </span>
          )}
        </div>
        <div className="mt-1 truncate text-[11px] text-muted-foreground" title={signalSummary}>{signalSummary}</div>
        {source.meta && (
          <div className="mt-1 truncate text-[10px] text-muted-foreground" title={signal.sourceRef}>
            {source.meta}
          </div>
        )}
        <RelatedWikiMiniLinks
          pages={arrayRecords(rowRelatedWikiPages)}
          evidenceDelta={signal.evidenceDelta}
          signalType={signal.signalType}
        />
        <HypothesisTimelineMiniList items={timelineItems} />
      </div>
      <div className="flex flex-col items-end gap-1">
        {askCache.show ? (
          <div className="max-w-[210px] truncate rounded-md bg-blue-500/10 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:text-blue-300" title={askCache.helper}>
            {askCache.badgeLabel}
          </div>
        ) : (
          <div className="max-w-[210px] truncate text-[10px] text-muted-foreground" title={askCache.helper}>
            首次较慢
          </div>
        )}
        <div className="flex justify-end gap-2">
          {qualityBrief.tone === "needs_work" && (
            <Button variant="outline" size="sm" className="h-8 px-2 text-xs" onClick={onPrepareDefinition} disabled={running} title={qualityBrief.nextAction}>
              <FilePlus2 className="h-3.5 w-3.5" />
              补定义
            </Button>
          )}
          <Button variant="outline" size="sm" className="h-8 px-2 text-xs" onClick={onAsk} disabled={running} title={askCache.actionTitle}>
            <SearchCheck className="h-3.5 w-3.5" />
            {askCache.actionLabel}
          </Button>
          <Button size="sm" className="h-8 px-2 text-xs" onClick={onConfirm} disabled={running || !canConfirm}>
            <Save className="h-3.5 w-3.5" />
            确认
          </Button>
        </div>
      </div>
    </div>
  )
}

function HypothesisEnginePanel({
  selectedHypothesis,
  feedback,
  postMortemDraft,
  verifyRun,
  running,
  onRefresh,
  onWriteFeedback,
  onConfirmRecommendation,
  onDraftPostMortem,
  onWritePostMortem,
}: {
  selectedHypothesis: Record<string, unknown> | null
  feedback: Record<string, unknown> | null
  postMortemDraft: Record<string, unknown> | null
  verifyRun: HypothesisVerifyRun | null
  running: boolean
  onRefresh: () => void
  onWriteFeedback: () => void
  onConfirmRecommendation: () => void
  onDraftPostMortem: () => void
  onWritePostMortem: () => void
}) {
  const qualityGate = recordValue(feedback?.qualityGate)
  const candidateFields = recordValue(feedback?.candidateFields)
  const evidenceScore = recordValue(feedback?.evidenceScore)
  const evidenceList = arrayRecords(feedback?.evidenceList)
  const triggers = arrayRecords(feedback?.falsifiableTriggerDetections)
  const watchtowerCandidate = recordValue(feedback?.watchtowerCandidate)
  const humanGate = recordValue(feedback?.humanGate)
  const routes = arrayRecords(feedback?.trainingFlywheelRoutes)
  const currentStatus = textValue(selectedHypothesis?.status, "")
  const targetStatus = textValue(humanGate.targetStatus, "")
  const canConfirm = Boolean(selectedHypothesis && targetStatus && targetStatus !== currentStatus && textValue(humanGate.recommendedAction, "") === "confirm_status_update")
  const terminal = ["archived", "disconfirmed", "priced_in"].includes(currentStatus)
  const scoreTotal = numberValue(evidenceScore.total)

  return (
    <div className="mt-4 rounded-lg border bg-background p-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-primary/10 px-2 py-1 text-xs font-medium text-primary">Hypothesis Engine</span>
            {feedback && <span className="rounded-md border px-2 py-1 text-xs text-muted-foreground">Evidence Score {scoreTotal}</span>}
            {verifyRun && (
              <span className={cn(
                "rounded-md px-2 py-1 text-xs font-medium",
                verifyRun.status === "ok" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-amber-500/10 text-amber-800 dark:text-amber-200",
              )}>
                verify {verifyRun.status ?? "unknown"} · {verifyRun.errorCount ?? 0} errors
              </span>
            )}
          </div>
          <h4 className="mt-2 font-medium">{selectedHypothesis ? textValue(selectedHypothesis.title, textValue(selectedHypothesis.id, "已选假设")) : "选择一条假设查看证据回流"}</h4>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">EvidenceResult 回流只生成推荐、评分和训练路线；正式状态需要 HumanGate 确认后才写 event。</p>
        </div>
        <div className="flex flex-wrap gap-2 lg:justify-end">
          <Button variant="outline" size="sm" onClick={onRefresh} disabled={running}>
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <SearchCheck className="h-3.5 w-3.5" />}
            刷新证据反馈
          </Button>
          <Button variant="outline" size="sm" onClick={onWriteFeedback} disabled={running || !selectedHypothesis}>
            <FileCheck2 className="h-3.5 w-3.5" />
            写入反馈
          </Button>
          <Button size="sm" onClick={onConfirmRecommendation} disabled={running || !canConfirm}>
            <ShieldCheck className="h-3.5 w-3.5" />
            确认推荐
          </Button>
          <Button variant="outline" size="sm" onClick={onDraftPostMortem} disabled={running || !selectedHypothesis || !terminal}>
            <ClipboardList className="h-3.5 w-3.5" />
            复盘草稿
          </Button>
          <Button variant="outline" size="sm" onClick={onWritePostMortem} disabled={running || !postMortemDraft}>
            <Save className="h-3.5 w-3.5" />
            写入复盘
          </Button>
        </div>
      </div>

      {!selectedHypothesis ? (
        <div className="mt-3 rounded-md border border-dashed p-4 text-sm text-muted-foreground">先在上方表格选择一条假设，再刷新证据反馈；没有 EvidenceResult 时也会显示 Quality Gate 和补证方向。</div>
      ) : !feedback ? (
        <div className="mt-3 rounded-md border border-dashed p-4 text-sm text-muted-foreground">尚未刷新 Hypothesis Engine。点击“刷新证据反馈”读取 v0.13 EvidenceResult，并生成 Watchtower / HumanGate 推荐。</div>
      ) : (
        <div className="mt-3 grid gap-3 xl:grid-cols-[0.9fr_1.1fr]">
          <div className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <SummaryTile label="质量门" value={`${textValue(qualityGate.qualityGate, "unknown")} · ${numberValue(qualityGate.score)}分`} />
              <SummaryTile label="推荐迁移" value={targetStatus ? `${currentStatus || "unknown"} -> ${targetStatus}` : textValue(watchtowerCandidate.action, "keep_watching")} />
              <SummaryTile label="HumanGate" value={`${textValue(humanGate.recommendedAction, "keep_watch")} · ${numberValue(humanGate.confidence)}分`} />
              <SummaryTile label="训练回流" value={routes.length ? routes.map((item) => textValue(item.route, "")).join("，") : "等待证据或人审"} />
            </div>
            <div className="rounded-md border bg-card p-3">
              <div className="text-xs font-medium text-muted-foreground">Quality Gate 字段</div>
              <div className="mt-2 grid gap-2 text-xs leading-5 sm:grid-cols-2">
                <HypothesisFieldList label="可证伪条件" values={candidateFields.falsifiableConditions} />
                <HypothesisFieldList label="核心驱动" values={candidateFields.coreDrivers} />
                <HypothesisFieldList label="市场错价" values={candidateFields.marketMispricing} />
                <HypothesisFieldList label="证据引用" values={candidateFields.sourceRefs} />
              </div>
            </div>
            <div className="rounded-md border bg-card p-3">
              <div className="text-xs font-medium text-muted-foreground">Evidence Score</div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
                {["sourceReliability", "sampleSize", "timeliness", "directRelevance", "verifiability", "total"].map((field) => (
                  <div key={field} className="rounded border px-2 py-1.5">
                    <div className="truncate text-muted-foreground">{field}</div>
                    <div className="mt-0.5 font-semibold">{numberValue(evidenceScore[field])}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <div className="rounded-md border bg-card p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-xs font-medium text-muted-foreground">证据时间线</div>
                <span className="text-xs text-muted-foreground">{evidenceList.length} 条 EvidenceResult</span>
              </div>
              {evidenceList.length === 0 ? (
                <div className="rounded border border-dashed p-3 text-xs text-muted-foreground">还没有关联到 `source=hypothesis` 的 EvidenceResult。</div>
              ) : (
                <div className="max-h-72 space-y-2 overflow-auto pr-1">
                  {evidenceList.slice(0, 8).map((item, index) => (
                    <div key={textValue(item.evidenceResultId, String(index))} className="rounded border px-3 py-2 text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className={cn(
                          "rounded px-1.5 py-0.5 font-medium",
                          item.direction === "strengthening" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
                          item.direction === "weakening" && "bg-red-500/10 text-red-700 dark:text-red-300",
                          item.direction === "neutral" && "bg-muted text-muted-foreground",
                        )}>{textValue(item.direction, "neutral")}</span>
                        <span className="text-muted-foreground">score {numberValue(recordValue(item.score).total)}</span>
                      </div>
                      <div className="mt-1 line-clamp-2 leading-5">{textValue(item.summary, "无摘要")}</div>
                      <div className="mt-1 truncate text-muted-foreground" title={listText(item.evidenceRefs)}>{listText(item.evidenceRefs) || textValue(item.artifactRef, "")}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              <div className="rounded-md border bg-card p-3">
                <div className="text-xs font-medium text-muted-foreground">可证伪触发</div>
                <div className="mt-2 space-y-2">
                  {triggers.length === 0 ? (
                    <div className="text-xs text-muted-foreground">未检测到 numeric / date / text contains 触发。</div>
                  ) : triggers.slice(0, 5).map((item, index) => (
                    <div key={`${textValue(item.type, "")}-${index}`} className="rounded border px-2 py-1.5 text-xs">
                      <div className={cn("font-medium", item.triggered ? "text-red-600" : "text-muted-foreground")}>{textValue(item.type, "trigger")} · {item.triggered ? "triggered" : "not triggered"}</div>
                      <div className="mt-1 line-clamp-2 text-muted-foreground">{textValue(item.reason, "")}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-md border bg-card p-3">
                <div className="text-xs font-medium text-muted-foreground">HumanGate 推荐</div>
                <div className="mt-2 text-xs leading-5">
                  <div className="font-medium">{textValue(humanGate.reason, "暂无迁移建议")}</div>
                  <div className="mt-1 text-muted-foreground">{listText(humanGate.risks) || "无额外风险"}</div>
                  {textValue(humanGate.writeCommand, "") && (
                    <div className="mt-2 truncate rounded border bg-background px-2 py-1 font-mono text-[11px] text-muted-foreground" title={textValue(humanGate.writeCommand, "")}>
                      {textValue(humanGate.writeCommand, "")}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {postMortemDraft && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
                <div className="font-medium">Post-Mortem 草稿已生成</div>
                <div className="mt-1 leading-5">状态：{textValue(postMortemDraft.terminalStatus, "")}；训练去向：{listText(postMortemDraft.trainingUse)}</div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function HypothesisFieldList({ label, values }: { label: string; values: unknown }) {
  const items = stringList(values)
  return (
    <div className="min-w-0 rounded border px-2 py-1.5">
      <div className="font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 line-clamp-3">{items.length ? items.join("，") : "待补"}</div>
    </div>
  )
}

function Metric({ icon: Icon, label, value }: { icon: typeof Database; label: string; value: number }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
    </div>
  )
}

function SummaryTile({ id, label, value }: { id?: string; label: string; value: ReactNode }) {
  return (
    <div id={id} className="scroll-mt-20 min-w-0 rounded-md border bg-background p-3">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 line-clamp-3 text-sm leading-5">{value}</div>
    </div>
  )
}

function AskResultOriginCard({ copy }: { copy: ReturnType<typeof buildAskResultOriginCopy> }) {
  if (!copy.show) return null
  const toneClass: Record<ReturnType<typeof buildAskResultOriginCopy>["tone"], string> = {
    tracked: "border-blue-200 bg-blue-50/80 text-blue-950 dark:border-blue-900 dark:bg-blue-950/50 dark:text-blue-100",
    candidate: "border-violet-200 bg-violet-50/80 text-violet-950 dark:border-violet-900 dark:bg-violet-950/50 dark:text-violet-100",
    manual: "border-muted bg-muted/35 text-foreground",
  }
  return (
    <section className={cn("mb-3 rounded-md border px-3 py-2 text-xs leading-5", toneClass[copy.tone])} aria-label="Ask 结果来源">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1.5 font-semibold">
            <GitBranch className="h-3.5 w-3.5 shrink-0" />
            <span className="shrink-0">{copy.label}</span>
            <span className="truncate opacity-90">· {copy.title}</span>
          </div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <span className="rounded border bg-background/70 px-1.5 py-0.5 font-medium">{copy.signalLine}</span>
            <span className="max-w-full break-all rounded border bg-background/70 px-1.5 py-0.5">{copy.sourceLine}</span>
          </div>
          <div className="mt-1.5 line-clamp-2 opacity-85">{copy.detail}</div>
        </div>
        <div className="flex min-w-0 items-start gap-1.5 rounded-md border bg-background/70 px-2 py-1.5 lg:max-w-[360px]">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0">{copy.guardrail}</span>
        </div>
      </div>
    </section>
  )
}

function AskLiveTaskTicketCard({ ticket }: { ticket: ReturnType<typeof buildAskLiveTaskTicket> }) {
  const toneClass: Record<ReturnType<typeof buildAskLiveTaskTicket>["tone"], string> = {
    running: "border-primary/20 bg-primary/5",
    done: "border-emerald-200 bg-emerald-50/70 dark:border-emerald-900 dark:bg-emerald-950/40",
    warning: "border-amber-200 bg-amber-50/80 dark:border-amber-900 dark:bg-amber-950/40",
  }
  const stepClass: Record<ReturnType<typeof buildAskLiveTaskTicket>["steps"][number]["status"], string> = {
    running: "border-primary/20 bg-background text-primary",
    done: "border-emerald-200 bg-background text-emerald-800 dark:border-emerald-900 dark:text-emerald-200",
    pending: "border-muted bg-background text-muted-foreground",
    warning: "border-amber-200 bg-background text-amber-900 dark:border-amber-900 dark:text-amber-100",
  }
  const iconFor = (status: ReturnType<typeof buildAskLiveTaskTicket>["steps"][number]["status"]) => {
    if (status === "running") return <Loader2 className="h-3.5 w-3.5 animate-spin" />
    if (status === "done") return <CheckCircle2 className="h-3.5 w-3.5" />
    if (status === "warning") return <AlertTriangle className="h-3.5 w-3.5" />
    return <Clock className="h-3.5 w-3.5" />
  }
  return (
    <section className={cn("mb-3 rounded-md border px-3 py-2", toneClass[ticket.tone])} aria-label="Ask 本轮任务状态">
      <div className="flex flex-col gap-2 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <div className="text-sm font-semibold">{ticket.headline}</div>
          <div className="mt-0.5 text-xs leading-5 text-muted-foreground">{ticket.detail}</div>
        </div>
        <div className="grid gap-1.5 sm:grid-cols-2 xl:w-[680px] xl:grid-cols-4">
          {ticket.steps.map((step) => (
            <div key={step.id} className={cn("rounded-md border px-2 py-1.5 text-xs", stepClass[step.status])} title={step.detail}>
              <div className="flex min-w-0 items-center gap-1.5 font-medium">
                <span className="shrink-0">{iconFor(step.status)}</span>
                <span className="truncate">{step.label}</span>
              </div>
              <div className="mt-1 line-clamp-2 leading-5 opacity-85">{step.detail}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function AskResultActionGuideCard({
  guide,
  copied,
  onPrimary,
}: {
  guide: ReturnType<typeof buildAskResultActionGuide>
  copied?: boolean
  onPrimary: () => void
}) {
  if (!guide.show) return null
  const toneClass: Record<ReturnType<typeof buildAskResultActionGuide>["tone"], string> = {
    ready: "border-primary/20 bg-primary/5 text-foreground",
    queued: "border-blue-200 bg-blue-50 text-blue-950 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-100",
    saved: "border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100",
    verify: "border-sky-200 bg-sky-50 text-sky-950 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-100",
    blocked: "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100",
  }
  const Icon = guide.tone === "saved"
    ? FileCheck2
    : guide.primaryTarget === "followup" || guide.primaryTarget === "observation"
      ? ClipboardList
      : SearchCheck
  const label = guide.primaryTarget === "followup" && copied ? "已复制" : guide.primaryLabel
  return (
    <section className={cn("mb-3 rounded-md border p-3 text-sm", toneClass[guide.tone])} aria-label="Ask 结果下一步">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 font-semibold">
            <ArrowRight className="h-4 w-4 shrink-0" />
            <span>{guide.headline}</span>
          </div>
          <div className="mt-1 text-xs leading-5 opacity-85">{guide.detail}</div>
          <div className="mt-1 text-xs leading-5 font-medium opacity-90">{guide.secondary}</div>
        </div>
        <Button type="button" size="sm" className="h-8 shrink-0" onClick={onPrimary}>
          <Icon className="h-3.5 w-3.5" />
          {label}
        </Button>
      </div>
    </section>
  )
}

function AskResultMiniIndex({
  items,
  onJump,
}: {
  items: ReturnType<typeof buildAskResultMiniIndex>
  onJump: (section: ReturnType<typeof buildAskResultMiniIndex>[number]["id"]) => void
}) {
  const toneClass: Record<ReturnType<typeof buildAskResultMiniIndex>[number]["tone"], string> = {
    ready: "border-emerald-200 bg-emerald-50 text-emerald-950 hover:bg-emerald-100 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100",
    pending: "border-muted bg-muted/40 text-muted-foreground",
    warning: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100",
  }
  return (
    <nav className="mb-3 rounded-md border bg-background/70 px-3 py-2" aria-label="Ask 结果导航">
      <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0">
          <div className="text-xs font-semibold">结果导航</div>
          <div className="mt-0.5 text-xs text-muted-foreground">先看摘要和股票；需要核来源时点“来源”。灰色或黄色说明本轮还没抽出来。</div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              disabled={!item.available}
              onClick={() => onJump(item.id)}
              title={item.detail}
              className={cn(
                "inline-flex min-h-8 max-w-[190px] items-center gap-1.5 rounded-md border px-2 py-1 text-left text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-65",
                toneClass[item.tone],
              )}
            >
              {item.available ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> : item.tone === "pending" ? <Clock className="h-3.5 w-3.5 shrink-0" /> : <AlertTriangle className="h-3.5 w-3.5 shrink-0" />}
              <span className="min-w-0">
                <span className="block truncate font-medium">{item.label}</span>
                <span className="block truncate opacity-80">{item.detail}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </nav>
  )
}

function AskResultJumpBar({
  copy,
  steps,
  onJump,
}: {
  copy: ReturnType<typeof buildAskResultJumpCopy>
  steps?: ReturnType<typeof buildAskResultPanelCopy>["steps"]
  onJump: () => void
}) {
  const toneClass: Record<ReturnType<typeof buildAskResultJumpCopy>["tone"], string> = {
    running: "border-primary/20 bg-primary/5 text-primary",
    done: "border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100",
    warning: "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100",
  }
  return (
    <section className={cn("rounded-lg border px-3 py-2", toneClass[copy.tone])} aria-live="polite">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium">
            {copy.tone === "running" ? <Loader2 className="h-4 w-4 animate-spin" /> : <SearchCheck className="h-4 w-4" />}
            <span className="truncate">{copy.label}</span>
          </div>
          <div className="mt-0.5 line-clamp-2 text-xs leading-5 opacity-80">{copy.detail}</div>
          {steps && steps.length > 0 && (
            <div className="mt-2 max-w-4xl">
              <AskProgressSteps steps={steps} compact />
            </div>
          )}
        </div>
        <Button type="button" variant="outline" size="sm" className="shrink-0 bg-background/70" onClick={onJump}>
          {copy.buttonLabel}
        </Button>
      </div>
    </section>
  )
}

function AskResultLocatorStrip({
  copy,
  located,
}: {
  copy: ReturnType<typeof buildAskResultLocatorCopy>
  located?: ReturnType<typeof buildAskResultLocatedNoticeCopy>
}) {
  const toneClass: Record<ReturnType<typeof buildAskResultLocatorCopy>["tone"], string> = {
    running: "border-primary/20 bg-primary/5 text-primary",
    done: "border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100",
    cached: "border-blue-200 bg-blue-50 text-blue-950 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-100",
    warning: "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100",
  }
  const locatedToneClass: Record<ReturnType<typeof buildAskResultLocatedNoticeCopy>["tone"], string> = {
    running: "border-primary/20 bg-background text-primary",
    done: "border-emerald-200 bg-background text-emerald-800 dark:border-emerald-900 dark:text-emerald-200",
    cached: "border-blue-200 bg-background text-blue-800 dark:border-blue-900 dark:text-blue-200",
    warning: "border-amber-200 bg-background text-amber-900 dark:border-amber-900 dark:text-amber-100",
  }
  const Icon = copy.tone === "running"
    ? Loader2
    : copy.tone === "warning"
      ? AlertTriangle
      : SearchCheck
  const LocatedIcon = located?.tone === "running"
    ? Loader2
    : located?.tone === "warning"
      ? AlertTriangle
      : CheckCircle2
  return (
    <div className={cn("mb-3 rounded-md border px-3 py-2 text-xs leading-5", toneClass[copy.tone])} role="status" aria-live="polite">
      {located?.show && (
        <div className={cn("mb-2 flex min-w-0 items-start gap-2 rounded-md border px-2 py-1.5", locatedToneClass[located.tone])}>
          <LocatedIcon className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", located.tone === "running" && "animate-spin")} />
          <div className="min-w-0">
            <div className="font-semibold">{located.label}</div>
            <div className="mt-0.5 leading-5 opacity-85">{located.detail}</div>
          </div>
        </div>
      )}
      <div className="flex min-w-0 items-center gap-1.5 font-semibold">
        <Icon className={cn("h-3.5 w-3.5 shrink-0", copy.tone === "running" && "animate-spin")} />
        <span className="truncate">{copy.label}</span>
      </div>
      <div className="mt-1 opacity-85">{copy.detail}</div>
      <div className="mt-1 font-medium opacity-95">下一步：{copy.nextAction}</div>
    </div>
  )
}

function AskResultReadingGuideCard({
  guide,
  onJump,
}: {
  guide: ReturnType<typeof buildAskResultReadingGuide>
  onJump?: (section: ReturnType<typeof buildAskResultMiniIndex>[number]["id"]) => void
}) {
  const toneClass: Record<ReturnType<typeof buildAskResultReadingGuide>["tone"], string> = {
    running: "border-primary/20 bg-primary/5 text-primary",
    ready: "border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100",
    warning: "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100",
    source_only: "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100",
  }
  const stepClass: Record<ReturnType<typeof buildAskResultReadingGuide>["steps"][number]["tone"], string> = {
    primary: "bg-background text-foreground ring-primary/25",
    normal: "bg-background/70 text-foreground/90 ring-border",
    warning: "bg-background/70 text-amber-950 ring-amber-500/20 dark:text-amber-100",
    pending: "bg-background/60 text-muted-foreground ring-border",
  }
  return (
    <div className={cn("mb-3 rounded-md border px-3 py-2 text-xs leading-5", toneClass[guide.tone])}>
      <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 font-semibold">
            <ClipboardList className="h-3.5 w-3.5 shrink-0" />
            <span>{guide.headline}</span>
          </div>
          <div className="mt-1 opacity-85">{guide.detail}</div>
          <div className="mt-1 font-medium opacity-95">{guide.guardrail}</div>
        </div>
        <Button
          type="button"
          size="sm"
          variant={guide.primaryTarget && onJump ? "outline" : "ghost"}
          className="h-8 shrink-0 bg-background/70 px-2 text-xs"
          disabled={!guide.primaryTarget || !onJump}
          onClick={() => guide.primaryTarget && onJump?.(guide.primaryTarget)}
        >
          <ArrowRight className="h-3.5 w-3.5" />
          {guide.primaryLabel}
        </Button>
      </div>
      <div className="mt-2 grid gap-1.5 md:grid-cols-3">
        {guide.steps.map((step, index) => (
          <button
            key={`${step.target}:${step.label}`}
            type="button"
            disabled={step.tone === "pending" || !onJump}
            onClick={() => onJump?.(step.target)}
            className={cn(
              "min-h-16 rounded-md px-2 py-1.5 text-left ring-1 transition-colors disabled:cursor-not-allowed disabled:opacity-70",
              stepClass[step.tone],
            )}
            title={step.detail}
          >
            <div className="flex items-center gap-1.5 font-medium">
              <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{index + 1}</span>
              <span className="truncate">{step.label}</span>
            </div>
            <div className="mt-1 line-clamp-2 opacity-80">{step.detail}</div>
          </button>
        ))}
      </div>
    </div>
  )
}

function AskProgressSteps({
  steps,
  compact = false,
}: {
  steps: ReturnType<typeof buildAskResultPanelCopy>["steps"]
  compact?: boolean
}) {
  if (steps.length === 0) return null
  const statusClass: Record<ReturnType<typeof buildAskResultPanelCopy>["steps"][number]["status"], string> = {
    done: "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100",
    running: "border-primary/20 bg-primary/5 text-primary",
    pending: "border-muted bg-background/70 text-muted-foreground",
    warning: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100",
  }
  const iconFor = (status: ReturnType<typeof buildAskResultPanelCopy>["steps"][number]["status"]) => {
    if (status === "done") return <CheckCircle2 className="h-3.5 w-3.5" />
    if (status === "running") return <Loader2 className="h-3.5 w-3.5 animate-spin" />
    if (status === "warning") return <AlertTriangle className="h-3.5 w-3.5" />
    return <Clock className="h-3.5 w-3.5" />
  }
  return (
    <div className={cn("grid gap-2", compact ? "sm:grid-cols-3" : "md:grid-cols-3")}>
      {steps.map((step) => (
        <div
          key={step.id}
          className={cn(
            "rounded-md border text-xs",
            compact ? "px-2 py-1.5" : "px-2.5 py-2",
            statusClass[step.status],
          )}
          title={step.detail}
        >
          <div className="flex min-w-0 items-center gap-1.5 font-medium">
            <span className="shrink-0">{iconFor(step.status)}</span>
            <span className="truncate">{step.label}</span>
          </div>
          {!compact && <div className="mt-1 leading-5 opacity-85">{step.detail}</div>}
        </div>
      ))}
    </div>
  )
}

const AskPendingCard = forwardRef<HTMLElement, {
  copy: ReturnType<typeof buildAskResultPanelCopy>
  locator: ReturnType<typeof buildAskResultLocatorCopy>
  located: ReturnType<typeof buildAskResultLocatedNoticeCopy>
  readingGuide: ReturnType<typeof buildAskResultReadingGuide>
  liveTask: ReturnType<typeof buildAskLiveTaskTicket>
  slots: ReturnType<typeof buildAskPendingSkeletonTiles>
  title: string
  detail: string
}>(function AskPendingCard({ copy, locator, located, readingGuide, liveTask, slots, title, detail }, ref) {
  return (
    <section ref={ref} id="ask-result" aria-live="polite" className="scroll-mt-4 rounded-lg border bg-card p-4">
      <AskResultLocatorStrip copy={locator} located={located} />
      <AskResultReadingGuideCard guide={readingGuide} />
      <AskLiveTaskTicketCard ticket={liveTask} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-md bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {copy.badge}
            </span>
            <span className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">预计较慢</span>
          </div>
          <h3 className="mt-3 truncate text-base font-medium">{copy.title || title}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {copy.detail}
          </p>
          {copy.steps.length > 0 && (
            <div className="mt-3">
              <AskProgressSteps steps={copy.steps} />
            </div>
          )}
        </div>
        <div className="rounded-md border bg-background p-3 text-xs leading-5 text-muted-foreground sm:w-[320px]">
          {detail}
        </div>
      </div>
      {slots.length > 0 && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4" aria-label="Ask 等待中的结构化输出槽位">
          {slots.map((slot) => (
            <div key={slot.id} className="rounded-md border bg-background/70 p-2.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-muted-foreground">{slot.label}</span>
                <span className="h-1.5 w-10 rounded-full bg-muted animate-pulse" aria-hidden="true" />
              </div>
              <div className="mt-1 font-medium">{slot.placeholder}</div>
              <div className="mt-1 line-clamp-2 leading-5 text-muted-foreground">{slot.detail}</div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
})

const AskErrorCard = forwardRef<HTMLElement, {
  state: AskErrorState
  title: string
  onBackToSignals: () => void
}>(function AskErrorCard({ state, title, onBackToSignals }, ref) {
  const isPrecheck = state.mode === "candidate-precheck"
  return (
    <section ref={ref} id="ask-result" aria-live="assertive" className="scroll-mt-4 rounded-lg border border-destructive/30 bg-card p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="inline-flex items-center gap-1.5 rounded-md bg-destructive/10 px-2 py-1 text-xs font-medium text-destructive">
            <AlertTriangle className="h-3.5 w-3.5" />
            {isPrecheck ? "Ask 预检失败" : "Ask 深挖失败"}
          </div>
          <h3 className="mt-3 font-medium">{isPrecheck ? "候选预检没有跑通" : "这次 Ask 没有生成结果"}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            你刚点的是「{state.title || title || "这条假设"}」。失败时间 {state.at}，页面不会写 wiki/raw，也不会确认状态。
          </p>
          <div className="mt-3 rounded-md border bg-background p-3 text-xs leading-5 text-muted-foreground">
            <div className="font-medium text-foreground">失败原因</div>
            <div className="mt-1 break-words">{state.message || "后端没有返回可读错误。"}</div>
          </div>
        </div>
        <div className="rounded-md border bg-background p-3 text-xs leading-5 text-muted-foreground lg:w-[340px]">
          <div className="font-medium text-foreground">下一步</div>
          <ol className="mt-2 list-decimal space-y-1 pl-4">
            <li>回到待处理卡或假设表，重新点一次 Ask 深挖。</li>
            <li>如果再次失败，把问题收窄到单一细分、单一股票或一个证据缺口。</li>
            <li>仍失败时看顶部错误和阶段输出，确认是否是 provider 或超时问题。</li>
          </ol>
          <Button type="button" variant="outline" size="sm" className="mt-3" onClick={onBackToSignals}>
            回到待处理
          </Button>
        </div>
      </div>
    </section>
  )
})

function AskAnswerMissingNotice({ sourceCount }: { sourceCount: number }) {
  return (
    <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
      <div className="font-medium">本次拿到了检索材料，但没有生成六段回答</div>
      <div className="mt-1 text-xs leading-5">
        已返回 {sourceCount} 个来源。先不要按摘要决策；可以重试 Ask 深挖，或把问题缩小到单一股票/细分环节再问。
      </div>
    </div>
  )
}

function AskAnswerPanelHeader({ copy }: { copy: ReturnType<typeof buildAskAnswerPanelCopy> }) {
  const toneClass: Record<ReturnType<typeof buildAskAnswerPanelCopy>["tone"], string> = {
    done: "border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100",
    warning: "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100",
    running: "border-primary/20 bg-primary/5 text-primary",
  }
  return (
    <div className={cn("mt-3 rounded-md border px-3 py-2 text-xs leading-5", toneClass[copy.tone])} role="status" aria-live="polite">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-md bg-background/70 px-2 py-0.5 font-semibold">{copy.badge}</span>
        <span className="font-medium">{copy.title}</span>
      </div>
      <div className="mt-1 opacity-85">{copy.detail}</div>
    </div>
  )
}

function AskSourceSnapshotCard({ snapshot }: { snapshot: ReturnType<typeof buildAskSourceSnapshot> }) {
  if (!snapshot.show) return null
  return (
    <div className="mb-3 rounded-md border bg-background p-3 text-sm">
      <div className="flex items-start gap-2">
        <Database className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="font-medium">{snapshot.headline}</div>
          <div className="mt-1 text-xs leading-5 text-muted-foreground">{snapshot.detail}</div>
          <div className="mt-1 text-xs font-medium leading-5">{snapshot.nextAction}</div>
          <div className="mt-3 grid gap-2 lg:grid-cols-3">
            {snapshot.groups.map((group) => (
              <div key={group.id} className="rounded-md border bg-card p-2.5">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-medium">{group.label}</span>
                  <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">{group.count}</span>
                </div>
                {group.items.length > 0 ? (
                  <div className="mt-2 space-y-2">
                    {group.items.map((item, index) => (
                      <div key={`${group.id}:${index}`} className="rounded border bg-background/70 px-2 py-1.5">
                        <div className="line-clamp-1 text-xs font-medium">{item.label}</div>
                        <div className="mt-0.5 line-clamp-2 text-xs leading-5 text-muted-foreground">{item.detail}</div>
                        <div className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground/80">{item.sourceLine}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-2 rounded border border-dashed px-2 py-2 text-xs leading-5 text-muted-foreground">
                    {group.emptyText}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="mt-3 rounded-md bg-muted/50 px-2 py-1.5 text-xs leading-5 text-muted-foreground">
            查询：{snapshot.queryLine}
          </div>
        </div>
      </div>
    </div>
  )
}

function AskStructureFeedbackNotice({ feedback }: { feedback: ReturnType<typeof buildAskStructureFeedback> }) {
  if (!feedback.show) return null
  const toneClass: Record<ReturnType<typeof buildAskStructureFeedback>["tone"], string> = {
    warning: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100",
    review: "border-primary/20 bg-primary/5 text-foreground",
    ready: "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100",
  }
  return (
    <div className={cn("mb-3 rounded-md border p-3 text-sm", toneClass[feedback.tone])}>
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0">
          <div className="font-medium">{feedback.headline}</div>
          <div className="mt-1 text-xs leading-5 opacity-85">{feedback.detail}</div>
          <div className="mt-1 text-xs font-medium leading-5">{feedback.next}</div>
        </div>
      </div>
    </div>
  )
}

function AskWikiFrameHintCard({ hint }: { hint: ReturnType<typeof buildAskWikiFrameHint> }) {
  const project = useWikiStore((s) => s.project)
  const setSelectedFile = useWikiStore((s) => s.setSelectedFile)
  if (!hint.show) return null
  const toneClass: Record<ReturnType<typeof buildAskWikiFrameHint>["tone"], string> = {
    structured: "border-sky-200 bg-sky-50 text-sky-950 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-100",
    stale: "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100",
    plain: "border-muted bg-muted/30 text-foreground",
  }
  const openWikiPage = (sourceRef: string) => {
    if (!project?.path || !sourceRef.startsWith("wiki/") || sourceRef.includes("..")) return
    setSelectedFile(`${project.path}/${sourceRef}`)
  }
  return (
    <div className={cn("mb-3 rounded-md border p-3 text-sm", toneClass[hint.tone])}>
      <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 font-medium">
            <Database className="h-4 w-4 shrink-0" />
            <span className="line-clamp-1">{hint.headline}</span>
          </div>
          <div className="mt-1 text-xs leading-5 opacity-85">{hint.detail}</div>
          <div className="mt-1 text-xs font-medium leading-5 opacity-90">{hint.next}</div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-1.5 lg:max-w-[420px] lg:justify-end">
          {hint.sources.slice(0, 3).map((source) => {
            const canOpen = Boolean(project?.path && source.sourceRef.startsWith("wiki/") && !source.sourceRef.includes(".."))
            return (
              <button
                key={`${source.sourceRef}:${source.label}`}
                type="button"
                disabled={!canOpen}
                onClick={() => openWikiPage(source.sourceRef)}
                className={cn(
                  "max-w-[220px] truncate rounded-md border bg-background/75 px-2 py-1 text-left text-xs transition-colors",
                  canOpen ? "hover:border-primary/40 hover:bg-primary/5 hover:text-primary" : "cursor-default opacity-70",
                )}
                title={`${source.sourceRef || source.label}${source.metaLine ? ` · ${source.metaLine}` : ""}`}
              >
                {source.label}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function AskFollowUpActionCard({
  action,
  copied,
  running,
  onCopy,
  onRetry,
}: {
  action: ReturnType<typeof buildAskFollowUpAction>
  copied: boolean
  running: boolean
  onCopy: () => void
  onRetry: () => void
}) {
  if (!action.show) return null
  const toneClass: Record<ReturnType<typeof buildAskFollowUpAction>["tone"], string> = {
    weak: "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100",
    verify: "border-primary/20 bg-primary/5 text-foreground",
  }
  return (
    <div className={cn("mb-3 rounded-md border p-3 text-sm", toneClass[action.tone])} aria-live="polite">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 font-medium">
            <ArrowRight className="h-4 w-4 shrink-0" />
            <span>{action.headline}</span>
          </div>
          <div className="mt-1 text-xs leading-5 opacity-85">{action.detail}</div>
          <div className="mt-2 line-clamp-2 rounded-md bg-background/70 px-2 py-1.5 text-xs leading-5 text-muted-foreground">
            {action.prompt}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2 lg:justify-end">
          <Button type="button" size="sm" className="h-8" onClick={onCopy} disabled={!action.prompt}>
            <ClipboardList className="h-3.5 w-3.5" />
            {copied ? "已复制" : action.primaryLabel}
          </Button>
          <Button type="button" variant="outline" size="sm" className="h-8 bg-background/70" onClick={onRetry} disabled={running || !action.retryEnabled}>
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <SearchCheck className="h-3.5 w-3.5" />}
            {action.retryLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}

function AskObservationActionBar({
  copy,
  onPrimary,
  onCopy,
}: {
  copy: ReturnType<typeof buildAskObservationActionCopy>
  onPrimary: () => void
  onCopy: () => void
}) {
  const project = useWikiStore((s) => s.project)
  const setSelectedFile = useWikiStore((s) => s.setSelectedFile)
  if (!copy.show) return null
  const toneClass: Record<ReturnType<typeof buildAskObservationActionCopy>["tone"], string> = {
    ready: "border-primary/20 bg-primary/5 text-foreground",
    queued: "border-blue-200 bg-blue-50 text-blue-950 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-100",
    saved: "border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100",
    blocked: "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100",
  }
  const Icon = copy.tone === "saved"
    ? FileCheck2
    : copy.tone === "blocked"
      ? AlertTriangle
      : copy.primaryAction === "save"
        ? Save
        : ClipboardList
  const openSavedDraft = () => {
    if (!project?.path || !isSafeObservationDraftPath(copy.savedPath)) return
    setSelectedFile(`${project.path}/${copy.savedPath}`)
  }
  return (
    <div id="ask-result-observation-action" className={cn("mb-3 scroll-mt-20 rounded-md border p-3", toneClass[copy.tone])} aria-live="polite">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-md bg-background/75 px-2 py-1 text-xs font-medium">
              <Icon className="h-3.5 w-3.5" />
              {copy.statusLabel}
            </span>
            <span className="text-sm font-semibold">{copy.headline}</span>
          </div>
          <div className="mt-1 text-xs leading-5 opacity-85">{copy.detail}</div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2 lg:justify-end">
          <Button type="button" size="sm" className="h-8" onClick={onPrimary} disabled={!copy.canPrimary}>
            <Icon className={cn("h-3.5 w-3.5", copy.primaryLabel === "保存中" && "animate-spin")} />
            {copy.primaryLabel}
          </Button>
          {copy.savedPath && isSafeObservationDraftPath(copy.savedPath) ? (
            <Button type="button" variant="outline" size="sm" className="h-8 bg-background/70" onClick={openSavedDraft}>
              <FileCheck2 className="h-3.5 w-3.5" />
              打开草稿
            </Button>
          ) : (
            <Button type="button" variant="outline" size="sm" className="h-8 bg-background/70" onClick={onCopy} disabled={!copy.canCopy}>
              <ClipboardList className="h-3.5 w-3.5" />
              {copy.secondaryLabel}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

function AskResearchTicketCard({
  ticket,
  checklist,
  copied,
  queued,
  onCopy,
  onQueue,
}: {
  ticket: ReturnType<typeof buildAskResearchTicket>
  checklist: ReturnType<typeof buildAskObservationChecklist>
  copied: boolean
  queued: boolean
  onCopy: () => void
  onQueue: () => void
}) {
  const toneClass: Record<ReturnType<typeof buildAskResearchTicket>["tone"], string> = {
    ready: "border-emerald-200 bg-emerald-500/5 text-emerald-950 dark:border-emerald-900/60 dark:text-emerald-100",
    verify: "border-amber-200 bg-amber-500/10 text-amber-950 dark:border-amber-900/60 dark:text-amber-100",
    weak: "border-border bg-muted/40 text-foreground",
  }
  const badgeClass: Record<ReturnType<typeof buildAskResearchTicket>["badges"][number]["tone"], string> = {
    source: "bg-background/75 text-muted-foreground",
    stock: "bg-primary/10 text-primary",
    gap: "bg-muted text-muted-foreground",
    ready: "bg-emerald-500/10 text-emerald-800 dark:text-emerald-200",
  }
  const canQueue = checklist.show && ticket.tone !== "weak"
  const canCopy = checklist.show
  return (
    <div className={cn("mb-3 rounded-md border p-3", toneClass[ticket.tone])}>
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1.5 rounded-md bg-background/75 px-2 py-1 text-xs font-medium">
              <SearchCheck className="h-3.5 w-3.5" />
              {ticket.label}
            </span>
            {ticket.badges.slice(0, 6).map((badge) => (
              <span key={`${badge.tone}:${badge.label}`} className={cn("rounded-md px-2 py-1 text-xs", badgeClass[badge.tone])}>
                {badge.label}
              </span>
            ))}
          </div>
          <div className="mt-2 text-base font-semibold leading-6">{ticket.headline}</div>
          <div className="mt-1 line-clamp-2 text-sm leading-6">{ticket.focus}</div>
          <div className="mt-2 rounded-md bg-background/70 px-2 py-1.5 text-xs leading-5 text-muted-foreground">
            <ShieldCheck className="mr-1 inline h-3.5 w-3.5" />
            {ticket.guardrail}
          </div>
        </div>
        <div className="grid shrink-0 gap-2 text-xs sm:grid-cols-3 xl:w-[620px]">
          <div className="rounded-md bg-background/75 p-2">
            <div className="font-medium text-muted-foreground">最大风险</div>
            <div className="mt-1 line-clamp-3 leading-5">{ticket.risk}</div>
          </div>
          <div className="rounded-md bg-background/75 p-2">
            <div className="font-medium text-muted-foreground">下一步</div>
            <div className="mt-1 line-clamp-3 leading-5">{ticket.nextAction}</div>
          </div>
          <div className="rounded-md bg-background/75 p-2">
            <div className="font-medium text-muted-foreground">操作</div>
            <div className="mt-1 flex flex-col gap-1.5">
              <Button type="button" size="sm" className="h-7 px-2 text-xs" disabled={!canQueue} onClick={onQueue}>
                <ClipboardList className="h-3.5 w-3.5" />
                {queued ? "已加入观察" : ticket.primaryActionLabel}
              </Button>
              <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" disabled={!canCopy} onClick={onCopy}>
                {copied ? "已复制" : ticket.secondaryActionLabel}
              </Button>
            </div>
          </div>
        </div>
      </div>
      {!canQueue && (
        <div className="mt-3 rounded-md bg-background/70 px-2 py-1.5 text-xs leading-5 text-muted-foreground">
          还没有形成可加入观察的标的清单。先展开完整回答看来源，或把问题收窄到单一细分/股票后重试 Ask。
        </div>
      )}
    </div>
  )
}

function AskObservationChecklistCard({
  checklist,
  copied,
  queued,
  onCopy,
  onQueue,
}: {
  checklist: ReturnType<typeof buildAskObservationChecklist>
  copied: boolean
  queued: boolean
  onCopy: () => void
  onQueue: () => void
}) {
  if (!checklist.show) return null
  const toneClass: Record<ReturnType<typeof buildAskObservationChecklist>["items"][number]["tone"], string> = {
    stock: "bg-primary/10 text-primary",
    rank: "bg-amber-500/10 text-amber-800 dark:text-amber-200",
    action: "bg-emerald-500/10 text-emerald-800 dark:text-emerald-200",
    gap: "bg-muted text-muted-foreground",
    status: "bg-background text-foreground",
  }
  return (
    <div className="mb-3 rounded-md border bg-background p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-primary" />
            <div className="line-clamp-1 text-sm font-medium">{checklist.headline}</div>
          </div>
          <div className="mt-1 text-xs leading-5 text-muted-foreground">{checklist.detail}</div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-1.5">
          <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={onQueue}>
            {queued ? "已加入" : "加入今日观察"}
          </Button>
          <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={onCopy}>
            {copied ? "已复制" : "复制草稿"}
          </Button>
        </div>
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        {checklist.items.map((item) => (
          <div key={item.label} className={cn("rounded-md px-2 py-1.5 text-xs", toneClass[item.tone])}>
            <div className="font-medium opacity-75">{item.label}</div>
            <div className="mt-1 line-clamp-2 leading-5">{item.value}</div>
          </div>
        ))}
      </div>
      <div className="mt-2 rounded-md bg-muted/40 px-2 py-1 text-xs leading-5 text-muted-foreground">
        下一步：{checklist.nextAction}
      </div>
    </div>
  )
}

function ObservationReviewStrip({
  brief,
  loading,
  onRefresh,
}: {
  brief: ReturnType<typeof buildObservationReviewBrief>
  loading?: boolean
  onRefresh?: () => void
}) {
  const project = useWikiStore((s) => s.project)
  const setSelectedFile = useWikiStore((s) => s.setSelectedFile)
  if (!brief.show) return null
  const canOpenPrimary = Boolean(project?.path && isSafeObservationDraftPath(brief.primaryPath))
  const openPrimary = () => {
    if (!project?.path || !isSafeObservationDraftPath(brief.primaryPath)) return
    setSelectedFile(`${project.path}/${brief.primaryPath}`)
  }
  return (
    <div className={cn(
      "rounded-lg border bg-card px-4 py-3",
      brief.tone === "action" && "border-amber-300 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/30",
    )}>
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
              <FileCheck2 className="h-3.5 w-3.5" />
              {brief.label}
            </span>
            <span className="text-sm font-medium">{brief.headline}</span>
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{brief.detail}</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            观察草稿只提醒复核，不自动改假设状态；确认状态仍走待处理卡片。
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" className="h-8 px-2 text-xs" disabled={!canOpenPrimary} onClick={openPrimary}>
            <FileCheck2 className="h-3.5 w-3.5" />
            打开首条
          </Button>
          <Button type="button" variant="outline" size="sm" className="h-8 px-2 text-xs" disabled={loading} onClick={onRefresh}>
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Database className="h-3.5 w-3.5" />}
            刷新观察
          </Button>
        </div>
      </div>
      {brief.items.length > 0 && (
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {brief.items.slice(0, 2).map((item) => (
            <div key={item.key} className="rounded-md border bg-background px-3 py-2 text-xs">
              <div className="line-clamp-1 text-sm font-medium">{item.title}</div>
              <div className="mt-1 line-clamp-1 text-primary">{item.stockLine}</div>
              <div className="mt-1 flex flex-wrap gap-1 text-[11px] text-muted-foreground">
                <span className="rounded-md bg-muted px-1.5 py-0.5">窗口：{item.reviewWindow}</span>
                <span className="rounded-md bg-muted px-1.5 py-0.5">{item.nextAction}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function SavedObservationDraftsPanel({
  run,
  loading,
  onRefresh,
}: {
  run?: ObservationDraftListRun | null
  loading?: boolean
  onRefresh?: () => void
}) {
  const project = useWikiStore((s) => s.project)
  const setSelectedFile = useWikiStore((s) => s.setSelectedFile)
  const drafts = run?.drafts ?? []
  const openSavedObservationDraft = (artifactPath: string) => {
    if (!project?.path || !isSafeObservationDraftPath(artifactPath)) return
    setSelectedFile(`${project.path}/${artifactPath}`)
  }
  return (
    <div className="mb-3 rounded-md border bg-card p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <FileCheck2 className="h-4 w-4 text-primary" />
            <div className="text-sm font-medium">最近保存观察</div>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            Ask 深挖后沉淀的判断草稿，只读展示；继续写正式假设状态仍需人工确认。
          </div>
        </div>
        <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={onRefresh} disabled={loading}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Database className="h-3.5 w-3.5" />}
          刷新草稿
        </Button>
      </div>
      {drafts.length === 0 ? (
        <div className="mt-3 rounded-md border border-dashed bg-background px-3 py-3 text-xs text-muted-foreground">
          还没有保存的观察。点 Ask 深挖后，把摘要加入观察队列，再点“保存草稿”。
        </div>
      ) : (
        <div className="mt-3 grid gap-2">
          {drafts.slice(0, 6).map((draft, index) => {
            const markdownPath = textValue(draft.markdownRelativePath, "")
            const jsonPath = textValue(draft.jsonRelativePath ?? draft.relativePath, "")
            const openPath = markdownPath || jsonPath
            const stocks = listText(draft.stocks) || "未提股票"
            const title = textValue(draft.title, `观察草稿 ${index + 1}`)
            const wikiFrame = recordValue(draft.wikiFrame)
            const wikiLabel = textValue(wikiFrame.label, "")
            return (
              <div key={textValue(draft.id, `${openPath}:${index}`)} className="rounded-md border bg-background px-3 py-2 text-xs">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="line-clamp-1 text-sm font-medium">{title}</div>
                    <div className="mt-1 line-clamp-1 text-primary">{stocks}</div>
                    <div className="mt-1 flex flex-wrap gap-1 text-[11px] text-muted-foreground">
                      {wikiLabel && <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-primary">wiki：{wikiLabel}</span>}
                      <span className="rounded-md bg-muted px-1.5 py-0.5">{textValue(draft.createdAt, "未记录时间")}</span>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 shrink-0 px-2 text-xs"
                    disabled={!isSafeObservationDraftPath(openPath)}
                    onClick={() => openSavedObservationDraft(openPath)}
                  >
                    打开草稿
                  </Button>
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                  <div className="rounded-md bg-muted/40 px-2 py-1">
                    <div className="font-medium text-muted-foreground">排序</div>
                    <div className="mt-1 line-clamp-2 leading-5">{textValue(draft.ranking, "未写入")}</div>
                  </div>
                  <div className="rounded-md bg-muted/40 px-2 py-1">
                    <div className="font-medium text-muted-foreground">缺口</div>
                    <div className="mt-1 line-clamp-2 leading-5">{textValue(draft.gap, "未写入")}</div>
                  </div>
                  <div className="rounded-md bg-muted/40 px-2 py-1">
                    <div className="font-medium text-muted-foreground">下一步</div>
                    <div className="mt-1 line-clamp-2 leading-5">{textValue(draft.nextAction, "未写入")}</div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function ObservationQueuePanel({
  items,
  savingKey = "",
  savedRuns = {},
  onSave,
}: {
  items: ObservationQueueDraft[]
  savingKey?: string
  savedRuns?: Record<string, ObservationDraftRun>
  onSave?: (item: ObservationQueueDraft) => void
}) {
  const project = useWikiStore((s) => s.project)
  const setSelectedFile = useWikiStore((s) => s.setSelectedFile)
  if (items.length === 0) return null
  const rows = buildObservationQueueTableRows({ items, savingKey, savedRuns, limit: 5 })
  const itemByKey = new Map(items.map((item) => [item.key, item] as const))
  const openWikiPage = (sourceRef: string) => {
    if (!project?.path || !sourceRef.startsWith("wiki/") || sourceRef.includes("..")) return
    setSelectedFile(`${project.path}/${sourceRef}`)
  }
  const openSavedObservationDraft = (artifactPath: string) => {
    if (!project?.path || !isSafeObservationDraftPath(artifactPath)) return
    setSelectedFile(`${project.path}/${artifactPath}`)
  }
  return (
    <div className="mb-3 rounded-md border bg-card p-3">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-primary" />
          <div className="text-sm font-medium">今日观察队列</div>
        </div>
        <div className="text-xs text-muted-foreground">Ask 后的日内跟踪表；保存才写 .llm-wiki/observation-drafts，不写 wiki/raw</div>
      </div>
      <div className="mt-3 overflow-hidden rounded-md border bg-background">
        <div className="hidden grid-cols-[1.25fr_1fr_1.2fr_0.8fr_0.72fr] gap-0 border-b bg-muted/40 px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground lg:grid">
          <div>假设 / 标的</div>
          <div>今日验证动作</div>
          <div>来源 / 缺口</div>
          <div>复核窗口</div>
          <div className="text-right">操作</div>
        </div>
        <div className="divide-y">
          {rows.map((row) => {
            const item = itemByKey.get(row.key)
            if (!item) return null
            return (
              <div key={row.key} className="grid gap-3 px-3 py-3 text-xs lg:grid-cols-[1.25fr_1fr_1.2fr_0.8fr_0.72fr] lg:items-start">
                <div className="min-w-0">
                  <div className="line-clamp-1 text-sm font-medium">{row.title}</div>
                  <div className="mt-1 line-clamp-1 text-primary">{row.stockLine}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <span className={cn(
                      "rounded-md px-1.5 py-0.5 text-[11px]",
                      row.tone === "saved" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
                      row.tone === "saving" && "bg-blue-500/10 text-blue-700 dark:text-blue-300",
                      row.tone === "queued" && "bg-primary/10 text-primary",
                    )}>
                      {row.statusLabel}
                    </span>
                    <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">核心：{row.focusStock}</span>
                  </div>
                </div>
                <div className="min-w-0 rounded-md bg-muted/30 px-2 py-1.5 lg:bg-transparent lg:px-0 lg:py-0">
                  <div className="font-medium text-muted-foreground lg:hidden">今日验证动作</div>
                  <div className="mt-1 line-clamp-3 leading-5 lg:mt-0">{row.validationAction}</div>
                  <div className="mt-1 line-clamp-2 text-muted-foreground">排序：{row.rankingLine}</div>
                </div>
                <div className="min-w-0 rounded-md bg-muted/30 px-2 py-1.5 lg:bg-transparent lg:px-0 lg:py-0">
                  <div className="font-medium text-muted-foreground lg:hidden">来源 / 缺口</div>
                  <div className="mt-1 line-clamp-2 leading-5 lg:mt-0">{row.sourceLine}</div>
                  <div className="mt-1 line-clamp-2 text-muted-foreground">缺口：{row.riskLine}</div>
                  {item.wikiFrameLabel && (
                  <button
                    type="button"
                    disabled={!item.wikiFrameSourceRef.startsWith("wiki/") || item.wikiFrameSourceRef.includes("..")}
                    onClick={() => openWikiPage(item.wikiFrameSourceRef)}
                    className="mt-1 inline-flex max-w-full items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 text-left text-[11px] text-primary disabled:cursor-default disabled:opacity-70"
                    title={`${item.wikiFrameSourceRef || item.wikiFrameLabel}${item.wikiFrameMetaLine ? ` · ${item.wikiFrameMetaLine}` : ""}`}
                  >
                    <Database className="h-3 w-3 shrink-0" />
                    <span className="truncate">wiki 框架：{item.wikiFrameLabel}</span>
                  </button>
                  )}
                </div>
                <div className="min-w-0 rounded-md bg-muted/30 px-2 py-1.5 lg:bg-transparent lg:px-0 lg:py-0">
                  <div className="font-medium text-muted-foreground lg:hidden">复核窗口</div>
                  <div className="mt-1 font-medium leading-5 lg:mt-0">{row.reviewWindow}</div>
                  <div className="mt-1 line-clamp-2 text-muted-foreground">{row.nextAction}</div>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2 lg:justify-end">
                  {onSave && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      disabled={!row.canSave}
                      onClick={() => onSave(item)}
                    >
                      {row.statusLabel === "已保存" ? "已保存" : row.statusLabel === "保存中" ? "保存中" : "保存草稿"}
                    </Button>
                  )}
                  {row.savedPath && isSafeObservationDraftPath(row.savedPath) && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 shrink-0 px-2 text-xs"
                      onClick={() => openSavedObservationDraft(row.savedPath)}
                      title={row.savedPath}
                    >
                      打开草稿
                    </Button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function AskDecisionCard({
  snapshot,
  conclusion,
  nextAction,
}: {
  snapshot: ReturnType<typeof buildAskDecisionSnapshot>
  conclusion: string
  nextAction: string
}) {
  const toneClass: Record<ReturnType<typeof buildAskDecisionSnapshot>["tone"], string> = {
    actionable: "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100",
    verify: "border-primary/20 bg-primary/5 text-foreground",
    blocked: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100",
  }
  return (
    <div className={cn("mb-3 rounded-md border p-3", toneClass[snapshot.tone])}>
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-md bg-background/70 px-2 py-1 text-xs font-medium">
              <SearchCheck className="h-3.5 w-3.5" />
              首屏判断
            </span>
            <span className="rounded-md bg-background/70 px-2 py-1 text-xs font-medium">{snapshot.primaryAction}</span>
          </div>
          <div className="mt-2 text-base font-semibold leading-6">{snapshot.headline}</div>
          <div className="mt-1 line-clamp-2 text-sm leading-6">{conclusion || snapshot.focus}</div>
        </div>
        <div className="grid shrink-0 gap-2 text-xs sm:grid-cols-3 xl:w-[620px]">
          <div className="rounded-md bg-background/70 p-2">
            <div className="font-medium text-muted-foreground">先看</div>
            <div className="mt-1 line-clamp-2 leading-5">{snapshot.focus}</div>
          </div>
          <div className="rounded-md bg-background/70 p-2">
            <div className="font-medium text-muted-foreground">缺口</div>
            <div className="mt-1 line-clamp-2 leading-5">{snapshot.risk}</div>
          </div>
          <div className="rounded-md bg-background/70 p-2">
            <div className="font-medium text-muted-foreground">下一步</div>
            <div className="mt-1 line-clamp-2 leading-5">{nextAction || snapshot.evidenceState}</div>
          </div>
        </div>
      </div>
    </div>
  )
}

function SmallStat({ label, value, tone = "default" }: { label: string; value: ReactNode; tone?: "default" | "warn" }) {
  const warn = tone === "warn" && typeof value === "number" && value > 0
  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("mt-1 truncate text-lg font-semibold", warn && "text-amber-600")}>{value}</div>
    </div>
  )
}

function StageRow({ stage }: { stage: CockpitStage }) {
  const Icon = stage.status === "running" ? Loader2 : stage.status === "done" ? CheckCircle2 : stage.status === "error" ? AlertTriangle : Clock
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-background px-3 py-2">
      <Icon className={cn(
        "h-4 w-4 shrink-0",
        stage.status === "running" && "animate-spin text-primary",
        stage.status === "done" && "text-emerald-500",
        stage.status === "error" && "text-destructive",
        stage.status === "pending" && "text-muted-foreground",
      )} />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{stage.label}</div>
        {stage.detail && <div className="truncate text-xs text-muted-foreground">{stage.detail}</div>}
      </div>
    </div>
  )
}

function ActivityLogRow({ entry }: { entry: ActivityLogEntry }) {
  const Icon = entry.status === "running" ? Loader2 : entry.status === "done" ? CheckCircle2 : AlertTriangle
  return (
    <div className="flex gap-3 rounded-lg border bg-background px-3 py-2">
      <Icon className={cn(
        "mt-0.5 h-4 w-4 shrink-0",
        entry.status === "running" && "animate-spin text-primary",
        entry.status === "done" && "text-emerald-500",
        entry.status === "error" && "text-destructive",
      )} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3">
          <div className="truncate text-sm font-medium">{entry.stage}</div>
          <div className="shrink-0 text-xs text-muted-foreground">{entry.at}</div>
        </div>
        <div className="mt-1 break-words text-xs text-muted-foreground">{entry.detail}</div>
      </div>
    </div>
  )
}

function RoleTile({ icon: Icon, title, body }: { icon: typeof Database; title: string; body: string }) {
  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-primary" />
        <div className="text-sm font-medium">{title}</div>
      </div>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">{body}</p>
    </div>
  )
}

function ListPanel<T>({ title, empty, items, render }: { title: string; empty: string; items: T[]; render: (item: T) => ReactNode }) {
  return (
    <section className="rounded-lg border bg-card p-4">
      <h3 className="mb-3 font-medium">{title}</h3>
      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-background p-6 text-center text-sm text-muted-foreground">{empty}</div>
      ) : (
        <div className="space-y-2">
          {items.map((item, index) => (
            <div key={index} className="rounded-lg border bg-background p-3">
              {render(item)}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function StatusBadge({ status }: { status: string }) {
  const tones: Record<string, string> = {
    seed: "bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-200",
    watching: "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-200",
    strengthening: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200",
    actionable: "bg-lime-100 text-lime-800 dark:bg-lime-950 dark:text-lime-200",
    priced_in: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
    divergent: "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200",
    disconfirmed: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-200",
    archived: "bg-muted text-muted-foreground",
  }
  return (
    <span
      className={cn("inline-flex shrink-0 items-center rounded-md px-2 py-0.5 text-[11px] font-medium", tones[status] ?? "bg-muted text-muted-foreground")}
      title={`${status}：${hypothesisStatusBody(status)}`}
    >
      {hypothesisStatusLabel(status)}
    </span>
  )
}

function HypothesisStateRow({ item, selected, onSelect }: { item: Record<string, unknown>; selected?: boolean; onSelect?: () => void }) {
  const status = textValue(item.status, "seed")
  const feedbackStatus = textValue(item.feedbackStatus, status)
  const metaLine = buildCandidateThemeSegmentLine({ theme: item.theme, segments: item.segments })
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "w-full rounded-lg border bg-background p-3 text-left transition-colors hover:border-primary/40 hover:bg-accent/30",
        selected && "border-primary bg-primary/5 ring-1 ring-primary/30",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{textValue(item.title)}</div>
          <div className="mt-1 truncate text-xs text-muted-foreground" title={metaLine}>
            {metaLine}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <StatusBadge status={feedbackStatus} />
          {feedbackStatus !== status && <span className="text-[11px] text-muted-foreground">原 {hypothesisStatusLabel(status)}</span>}
          {selected && <span className="text-[11px] text-primary">已选中</span>}
        </div>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <SmallStat label="alerts" value={numberValue(item.openAlertCount)} />
        <SmallStat label="conviction" value={Math.round(numberValue(item.conviction) * 100)} />
        <SmallStat label="events" value={item.latestEventAt ? 1 : 0} />
      </div>
      <div className="mt-2 text-xs text-muted-foreground">{textValue(item.feedbackReason, "等待新证据")}</div>
      {(item.latestEvidenceDelta && (
        <div className="mt-2 text-xs text-amber-600">{textValue(item.latestEvidenceDelta)}</div>
      )) as ReactNode}
    </button>
  )
}

function AlertItem({ item, onPrepareGap }: { item: Record<string, unknown>; onPrepareGap?: (gapCode: string) => void }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 truncate font-medium">{textValue(item.hypothesisTitle || item.hypothesisId)}</div>
        <span className="shrink-0 rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">{textValue(item.alertLevel)}</span>
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{textValue(item.alertReason || item.evidenceDelta)}</div>
      {Array.isArray(item.evidenceGaps) && item.evidenceGaps.length > 0 && (
        <div className="mt-2">
          <EvidenceGapTaskList codes={item.evidenceGaps} onPrepareGap={onPrepareGap} compact />
        </div>
      )}
    </div>
  )
}
