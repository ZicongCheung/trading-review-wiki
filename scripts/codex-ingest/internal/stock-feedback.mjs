import fs from "node:fs/promises"
import path from "node:path"

import {
  readBrainRecords,
} from "./brain-memory.mjs"

import {
  describeStockDailySqlSource,
  executeStockDailyQuery,
  quotePgIdentifier,
  stockDailyRowRef,
} from "./ask-market.mjs"

import {
  defaultSseAnnouncementClient,
  defaultTushareClient,
  normalizeTushareResponse,
  toTushareCode,
} from "./company-research.mjs"

import {
  tavilyDeepResearchSearch,
} from "./deep-research.mjs"

import {
  DEFAULT_PROJECT_PATH,
  ensureDirectory,
  formatSqlCell,
  listFilesRecursive,
  normalizePath,
  nowLocalTimestamp,
  numberFromSqlCell,
  parsePositiveInteger,
  projectRelative,
  readJsonlFile,
  roundMetric,
  safeErrorMessage,
  shortHash,
  stockCodeAlternatives,
} from "./core.mjs"

import {
  getCompanyResearchCredentials,
} from "./data-source.mjs"

export const STOCK_FEEDBACK_ROOT = ".llm-wiki/stock-feedback"
export const STOCK_FEEDBACK_TRAJECTORY_SCHEMA = "stock-feedback-trajectory-v1"
export const STOCK_VALIDATION_BENCHMARK_SCHEMA = "stock-validation-benchmark-v1"
export const STOCK_FEEDBACK_ADAPTER_CANDIDATE_SCHEMA = "stock-feedback-adapter-candidate-v1"
export const STOCK_FEEDBACK_LORA_READY_MANIFEST_SCHEMA = "stock-feedback-lora-ready-manifest-v1"
export const STOCK_FEEDBACK_LORA_READY_BATCH_REFRESH_DELTA_SCHEMA = "stock-feedback-lora-ready-batch-refresh-delta-v1"
export const STOCK_FEEDBACK_REVIEW_EVENT_SCHEMA = "stock-feedback-review-event-v1"
export const STOCK_FEEDBACK_DISTILLATION_PLAN_SCHEMA = "stock-feedback-distillation-plan-v1"
export const STOCK_FEEDBACK_COLLECTION_TASK_DRAFT_SCHEMA = "stock-feedback-collection-task-draft-v1"
export const STOCK_FEEDBACK_COLLECTION_RESULT_SCHEMA = "stock-feedback-collection-result-v1"
export const STOCK_FEEDBACK_PAPER_TRADE_SCHEMA = "stock-feedback-paper-trade-v1"
export const STOCK_FEEDBACK_PAPER_TRADE_PLANNING_SUMMARY_SCHEMA = "stock-feedback-paper-trade-planning-summary-v1"
export const STOCK_FEEDBACK_PAPER_TRADE_AGENT_CANDIDATE_SCHEMA = "stock-feedback-paper-trade-agent-candidate-v1"
export const STOCK_FEEDBACK_PAPER_TRADE_AGENT_MANIFEST_SCHEMA = "stock-feedback-paper-trade-agent-manifest-v1"
export const STOCK_FEEDBACK_EVIDENCE_TASK_SCHEMA = "stock-feedback-evidence-task-v1"
export const STOCK_FEEDBACK_EVIDENCE_RESULT_SCHEMA = "stock-feedback-evidence-result-v1"
export const STOCK_FEEDBACK_EVIDENCE_RUN_SCHEMA = "stock-feedback-evidence-run-v1"
export const STOCK_FEEDBACK_EVIDENCE_DLQ_SCHEMA = "stock-feedback-evidence-dlq-v1"
export const STOCK_FEEDBACK_EXECUTION_RESULT_SCHEMA = "research-os-execution-result-v1"

export const STOCK_FEEDBACK_VALIDATION_TARGETS = [
  "expectation_trade",
  "fundamental_closure",
  "priced_in_risk",
  "disconfirmation",
]

export const STOCK_FEEDBACK_QUALITY_GATES = [
  "expectation_validated",
  "fundamental_validated",
  "priced_in_validated",
  "disconfirmed_validated",
  "review_required",
  "needs_evidence",
]

export const STOCK_FEEDBACK_REVIEW_ACTIONS = [
  "approve_for_adapter",
  "approve_paper_adapter_candidate",
  "route_to_eval",
  "route_to_preference",
  "route_to_sft",
  "needs_evidence",
  "reject_for_adapter",
  "mark_entry_wrong",
  "mark_priced_in",
]

export const STOCK_FEEDBACK_COLLECTION_RESULTS = [
  "confirmed",
  "refuted",
  "insufficient",
]

export const STOCK_FEEDBACK_PAPER_TRADE_TRACKS = [
  "rule_baseline",
  "llm_discretionary",
]

export const STOCK_FEEDBACK_PAPER_TRADE_STATUSES = [
  "open",
  "closed",
  "cancelled",
]

export const STOCK_FEEDBACK_EVIDENCE_TASK_STATUSES = [
  "pending",
  "running",
  "awaiting_review",
  "completed",
  "failed",
  "dlq",
]

export const STOCK_FEEDBACK_EVIDENCE_RESULT_STATUSES = [
  "completed",
  "awaiting_review",
  "rejected",
  "failed",
]

export const STOCK_FEEDBACK_EXECUTION_RESULT_REVIEW_ACTIONS = [
  "confirm_realized_execution",
  "mark_partial_exit",
  "mark_holding_snapshot_only",
  "mark_needs_reconciliation",
  "reject_execution_result",
]

export const STOCK_FEEDBACK_EVIDENCE_TASK_SOURCES = [
  "hypothesis",
  "self_question",
  "stock_feedback",
  "manual",
]

export const STOCK_FEEDBACK_EVIDENCE_TASK_TYPES = [
  "financial_metrics",
  "announcement",
  "market_data",
  "tenders",
  "institutional_flow",
  "limit_up_analysis",
  "general",
]

export const STOCK_FEEDBACK_EVIDENCE_PRIORITIES = [
  "high",
  "normal",
  "low",
]

export const STOCK_FEEDBACK_EVIDENCE_RESULT_REVIEW_ACTIONS = [
  "approve",
  "reject",
  "needs_more_evidence",
]

export const STOCK_FEEDBACK_EVIDENCE_DLQ_STATUSES = [
  "open",
  "retried",
  "discarded",
]

export const STOCK_FEEDBACK_EVIDENCE_DLQ_ACTIONS = [
  "retry",
  "discard",
]

export const STOCK_FEEDBACK_MARKET_PATTERNS = [
  {
    id: "event_expectation_front_run",
    label: "事件预期先炒",
    adapterCapability: "expectation_trade_judgment",
    keywords: ["事件预期", "未落地", "预期", "front_run", "relative_strength", "theme_diffusion", "扩散", "相对强度"],
    distillationHint: "识别事实未落地前的资金预期、扩散和相对强度验证。",
  },
  {
    id: "low_absorption_breakout",
    label: "低位吸收转强",
    adapterCapability: "expectation_trade_judgment",
    keywords: ["low_absorption", "低位吸收", "吸收", "breakout", "转强", "小仓试错", "probe_then_add"],
    distillationHint: "识别低位吸收后的试错、转强和加仓节奏。",
  },
  {
    id: "priced_in_late_entry",
    label: "方向对但后手风险",
    adapterCapability: "priced_in_risk_judgment",
    keywords: ["priced_in", "priced in", "后手", "赔率压缩", "买点错", "entry_wrong", "late entry", "追涨风险"],
    distillationHint: "识别方向正确但赔率压缩、后手追涨风险升高的场景。",
  },
  {
    id: "failed_catalyst_one_day_hype",
    label: "伪催化/一日游",
    adapterCapability: "failed_expectation_attribution",
    keywords: ["一日游", "无承接", "证伪", "失败", "failed", "disconfirmed", "伪催化"],
    distillationHint: "识别没有扩散、没有承接或被证伪的失败预期。",
  },
  {
    id: "fundamental_closure_confirmation",
    label: "基本面兑现闭环",
    adapterCapability: "fundamental_closure_judgment",
    keywords: ["fundamental_validated", "订单", "公告", "财报", "毛利率", "asp", "兑现", "cninfo"],
    distillationHint: "识别订单、公告、财报、ASP 或毛利率兑现证据。",
  },
]

const STOCK_FEEDBACK_PROFIT_CREDIT_BUCKETS = [
  {
    id: "pattern_execution_supported",
    label: "收益支持手法执行",
    recommendedAction: "collect_profit_feedback",
    trainingUse: "adapter_candidate_after_review",
    adapterCapability: "expectation_trade_judgment",
    detail: "补充正收益、低回撤、进出场节奏清晰的样本，用于人审后提炼可复用执行策略。",
  },
  {
    id: "execution_risk_negative",
    label: "执行风险负样本",
    recommendedAction: "collect_entry_risk_loss_feedback",
    trainingUse: "eval_preference_negative",
    adapterCapability: "priced_in_risk_judgment",
    detail: "补充方向对但后手、追涨、仓位或止损导致亏损的样本，训练买点与赔率风控。",
  },
  {
    id: "failed_expectation_negative",
    label: "失败预期负样本",
    recommendedAction: "collect_failed_expectation_feedback",
    trainingUse: "eval_preference_negative",
    adapterCapability: "failed_expectation_attribution",
    detail: "补充无承接、一日游或预期被证伪的样本，训练伪催化和失败归因。",
  },
]

const TARGET_TO_CAPABILITY = {
  expectation_trade: "expectation_trade_judgment",
  fundamental_closure: "fundamental_closure_judgment",
  priced_in_risk: "priced_in_risk_judgment",
  disconfirmation: "failed_expectation_attribution",
}

const TARGET_TO_LABEL = {
  expectation_trade: "预期交易验证",
  fundamental_closure: "基本面兑现验证",
  priced_in_risk: "priced-in 风险验证",
  disconfirmation: "失败归因验证",
}

const GATE_TO_TRAINING_USE = {
  expectation_validated: ["eval", "sft"],
  fundamental_validated: ["eval", "sft"],
  priced_in_validated: ["eval", "preference"],
  disconfirmed_validated: ["eval", "preference"],
  review_required: ["eval"],
  needs_evidence: ["eval"],
}

function normalizeToken(value) {
  return String(value ?? "").trim().toLowerCase().replace(/-/g, "_")
}

export function parseStockFeedbackValidationTarget(value) {
  const raw = normalizeToken(value)
  if (!raw || raw === "all" || raw === "any") return null
  const aliases = new Map([
    ["expectation", "expectation_trade"],
    ["expectation_validated", "expectation_trade"],
    ["expectation_trade_validated", "expectation_trade"],
    ["market_expectation", "expectation_trade"],
    ["fundamental", "fundamental_closure"],
    ["fundamentals", "fundamental_closure"],
    ["fundamental_validated", "fundamental_closure"],
    ["fundamental_closure_validated", "fundamental_closure"],
    ["priced_in", "priced_in_risk"],
    ["priced_in_validated", "priced_in_risk"],
    ["entry_wrong", "priced_in_risk"],
    ["entry_risk", "priced_in_risk"],
    ["disconfirmed", "disconfirmation"],
    ["disconfirmed_validated", "disconfirmation"],
    ["failed_expectation", "disconfirmation"],
    ["negative", "disconfirmation"],
  ])
  const target = aliases.get(raw) ?? raw
  if (!STOCK_FEEDBACK_VALIDATION_TARGETS.includes(target)) {
    throw new Error(`--validation-target must be one of ${STOCK_FEEDBACK_VALIDATION_TARGETS.join(", ")}`)
  }
  return target
}

export function parseStockFeedbackQualityGate(value) {
  const raw = normalizeToken(value)
  if (!raw || raw === "all" || raw === "any") return null
  const aliases = new Map([
    ["expectation", "expectation_validated"],
    ["expectation_trade", "expectation_validated"],
    ["fundamental", "fundamental_validated"],
    ["fundamental_closure", "fundamental_validated"],
    ["priced_in", "priced_in_validated"],
    ["priced_in_risk", "priced_in_validated"],
    ["disconfirmed", "disconfirmed_validated"],
    ["disconfirmation", "disconfirmed_validated"],
  ])
  const gate = aliases.get(raw) ?? raw
  const allowed = [...STOCK_FEEDBACK_QUALITY_GATES, "high_confidence"]
  if (!allowed.includes(gate)) throw new Error(`--quality-gate must be all, high_confidence, or one of ${STOCK_FEEDBACK_QUALITY_GATES.join(", ")}`)
  return gate
}

export function parseStockFeedbackMarketPattern(value) {
  const raw = normalizeToken(value)
  if (!raw || raw === "all" || raw === "any") return null
  const aliases = new Map([
    ["event_expectation", "event_expectation_front_run"],
    ["front_run", "event_expectation_front_run"],
    ["expectation_front_run", "event_expectation_front_run"],
    ["low_absorption", "low_absorption_breakout"],
    ["absorption_breakout", "low_absorption_breakout"],
    ["priced_in", "priced_in_late_entry"],
    ["entry_wrong", "priced_in_late_entry"],
    ["late_entry", "priced_in_late_entry"],
    ["failed_catalyst", "failed_catalyst_one_day_hype"],
    ["one_day_hype", "failed_catalyst_one_day_hype"],
    ["disconfirmed", "failed_catalyst_one_day_hype"],
    ["fundamental", "fundamental_closure_confirmation"],
    ["fundamental_closure", "fundamental_closure_confirmation"],
  ])
  const pattern = aliases.get(raw) ?? raw
  const allowed = STOCK_FEEDBACK_MARKET_PATTERNS.map((item) => item.id)
  if (!allowed.includes(pattern)) {
    throw new Error(`--market-pattern must be all or one of ${allowed.join(", ")}`)
  }
  return pattern
}

export function parseStockFeedbackProfitCredit(value) {
  const raw = normalizeToken(value)
  if (!raw || raw === "all" || raw === "any") return null
  const aliases = new Map([
    ["positive", "pattern_execution_supported"],
    ["profitable", "pattern_execution_supported"],
    ["profit", "pattern_execution_supported"],
    ["pattern_execution", "pattern_execution_supported"],
    ["execution_supported", "pattern_execution_supported"],
    ["risk_negative", "execution_risk_negative"],
    ["entry_risk", "execution_risk_negative"],
    ["loss", "execution_risk_negative"],
    ["execution_risk", "execution_risk_negative"],
    ["failed", "failed_expectation_negative"],
    ["failure", "failed_expectation_negative"],
    ["disconfirmed", "failed_expectation_negative"],
    ["failed_expectation", "failed_expectation_negative"],
  ])
  const credit = aliases.get(raw) ?? raw
  const allowed = STOCK_FEEDBACK_PROFIT_CREDIT_BUCKETS.map((item) => item.id)
  if (!allowed.includes(credit)) {
    throw new Error(`--profit-credit must be all or one of ${allowed.join(", ")}`)
  }
  return credit
}

export function parseStockFeedbackReviewAction(value) {
  const raw = normalizeToken(value)
  const aliases = new Map([
    ["approve", "approve_for_adapter"],
    ["adapter", "approve_for_adapter"],
    ["lora", "approve_for_adapter"],
    ["paper_approve", "approve_paper_adapter_candidate"],
    ["paper_adapter", "approve_paper_adapter_candidate"],
    ["approve_paper", "approve_paper_adapter_candidate"],
    ["eval", "route_to_eval"],
    ["benchmark", "route_to_eval"],
    ["preference", "route_to_preference"],
    ["negative", "route_to_preference"],
    ["sft", "route_to_sft"],
    ["evidence", "needs_evidence"],
    ["needs_evidence_review", "needs_evidence"],
    ["needs_evidence", "needs_evidence"],
    ["reject", "reject_for_adapter"],
    ["exclude", "reject_for_adapter"],
    ["entry_wrong", "mark_entry_wrong"],
    ["priced_in", "mark_priced_in"],
  ])
  const action = aliases.get(raw) ?? raw
  if (!STOCK_FEEDBACK_REVIEW_ACTIONS.includes(action)) {
    throw new Error(`--action must be one of ${STOCK_FEEDBACK_REVIEW_ACTIONS.join(", ")}`)
  }
  return action
}

export function parseStockFeedbackCollectionResult(value) {
  const raw = normalizeToken(value)
  const aliases = new Map([
    ["confirm", "confirmed"],
    ["confirmed_evidence", "confirmed"],
    ["pass", "confirmed"],
    ["ok", "confirmed"],
    ["reject", "refuted"],
    ["rejected", "refuted"],
    ["refute", "refuted"],
    ["fail", "refuted"],
    ["insufficient_evidence", "insufficient"],
    ["needs_more_evidence", "insufficient"],
    ["pending", "insufficient"],
  ])
  const result = aliases.get(raw) ?? raw
  if (!STOCK_FEEDBACK_COLLECTION_RESULTS.includes(result)) {
    throw new Error(`--result must be one of ${STOCK_FEEDBACK_COLLECTION_RESULTS.join(", ")}`)
  }
  return result
}

export function parseStockFeedbackPaperTradeTrack(value) {
  const raw = normalizeToken(value)
  if (!raw || raw === "default") return "rule_baseline"
  const aliases = new Map([
    ["rule", "rule_baseline"],
    ["rules", "rule_baseline"],
    ["baseline", "rule_baseline"],
    ["fixed_rule", "rule_baseline"],
    ["fixed_rules", "rule_baseline"],
    ["llm", "llm_discretionary"],
    ["ai", "llm_discretionary"],
    ["agent", "llm_discretionary"],
    ["discretionary", "llm_discretionary"],
  ])
  const track = aliases.get(raw) ?? raw
  if (!STOCK_FEEDBACK_PAPER_TRADE_TRACKS.includes(track)) {
    throw new Error(`--track must be one of ${STOCK_FEEDBACK_PAPER_TRADE_TRACKS.join(", ")}`)
  }
  return track
}

export function parseStockFeedbackPaperTradeStatus(value) {
  const raw = normalizeToken(value)
  if (!raw) return null
  const aliases = new Map([
    ["active", "open"],
    ["holding", "open"],
    ["hold", "open"],
    ["done", "closed"],
    ["exit", "closed"],
    ["exited", "closed"],
    ["sold", "closed"],
    ["clear", "closed"],
    ["cleared", "closed"],
    ["cancel", "cancelled"],
    ["canceled", "cancelled"],
  ])
  const status = aliases.get(raw) ?? raw
  if (!STOCK_FEEDBACK_PAPER_TRADE_STATUSES.includes(status)) {
    throw new Error(`--status must be one of ${STOCK_FEEDBACK_PAPER_TRADE_STATUSES.join(", ")}`)
  }
  return status
}

export function parseStockFeedbackEvidenceTaskStatus(value) {
  const raw = normalizeToken(value)
  if (!raw || raw === "all" || raw === "any") return null
  const aliases = new Map([
    ["review", "awaiting_review"],
    ["needs_review", "awaiting_review"],
    ["done", "completed"],
    ["complete", "completed"],
    ["dead_letter", "dlq"],
    ["deadletter", "dlq"],
  ])
  const status = aliases.get(raw) ?? raw
  if (!STOCK_FEEDBACK_EVIDENCE_TASK_STATUSES.includes(status)) {
    throw new Error(`--status must be all or one of ${STOCK_FEEDBACK_EVIDENCE_TASK_STATUSES.join(", ")}`)
  }
  return status
}

export function parseStockFeedbackEvidenceTaskSource(value) {
  const raw = normalizeToken(value)
  if (!raw) return "manual"
  const aliases = new Map([
    ["self-question", "self_question"],
    ["selfquestion", "self_question"],
    ["stock-feedback", "stock_feedback"],
    ["stockfeedback", "stock_feedback"],
  ])
  const source = aliases.get(raw) ?? raw
  if (!STOCK_FEEDBACK_EVIDENCE_TASK_SOURCES.includes(source)) {
    throw new Error(`--source must be one of ${STOCK_FEEDBACK_EVIDENCE_TASK_SOURCES.join(", ")}`)
  }
  return source
}

export function parseStockFeedbackEvidenceTaskType(value) {
  const raw = normalizeToken(value)
  const aliases = new Map([
    ["financial", "financial_metrics"],
    ["finance", "financial_metrics"],
    ["fundamental", "financial_metrics"],
    ["fundamentals", "financial_metrics"],
    ["notice", "announcement"],
    ["ann", "announcement"],
    ["market", "market_data"],
    ["daily", "market_data"],
    ["price", "market_data"],
    ["tender", "tenders"],
    ["qcc", "tenders"],
    ["flow", "institutional_flow"],
    ["institutional", "institutional_flow"],
    ["limit", "limit_up_analysis"],
    ["limit_up", "limit_up_analysis"],
  ])
  const type = aliases.get(raw) ?? raw
  if (!STOCK_FEEDBACK_EVIDENCE_TASK_TYPES.includes(type)) {
    throw new Error(`--task-type must be one of ${STOCK_FEEDBACK_EVIDENCE_TASK_TYPES.join(", ")}`)
  }
  return type
}

export function parseStockFeedbackEvidencePriority(value) {
  const raw = normalizeToken(value)
  if (!raw) return "normal"
  const aliases = new Map([
    ["p0", "high"],
    ["urgent", "high"],
    ["medium", "normal"],
    ["med", "normal"],
    ["p1", "normal"],
    ["p2", "low"],
  ])
  const priority = aliases.get(raw) ?? raw
  if (!STOCK_FEEDBACK_EVIDENCE_PRIORITIES.includes(priority)) {
    throw new Error(`--priority must be one of ${STOCK_FEEDBACK_EVIDENCE_PRIORITIES.join(", ")}`)
  }
  return priority
}

export function parseStockFeedbackEvidenceResultReviewAction(value) {
  const raw = normalizeToken(value)
  const aliases = new Map([
    ["approved", "approve"],
    ["confirm", "approve"],
    ["confirmed", "approve"],
    ["ok", "approve"],
    ["reject_for_training", "reject"],
    ["rejected", "reject"],
    ["more", "needs_more_evidence"],
    ["needs_evidence", "needs_more_evidence"],
    ["insufficient", "needs_more_evidence"],
  ])
  const action = aliases.get(raw) ?? raw
  if (!STOCK_FEEDBACK_EVIDENCE_RESULT_REVIEW_ACTIONS.includes(action)) {
    throw new Error(`--action must be one of ${STOCK_FEEDBACK_EVIDENCE_RESULT_REVIEW_ACTIONS.join(", ")}`)
  }
  return action
}

export function parseStockFeedbackExecutionResultReviewAction(value) {
  const raw = normalizeToken(value)
  const aliases = new Map([
    ["confirm", "confirm_realized_execution"],
    ["approve", "confirm_realized_execution"],
    ["confirmed", "confirm_realized_execution"],
    ["partial", "mark_partial_exit"],
    ["partial_exit", "mark_partial_exit"],
    ["snapshot", "mark_holding_snapshot_only"],
    ["holding_snapshot", "mark_holding_snapshot_only"],
    ["reconcile", "mark_needs_reconciliation"],
    ["needs_reconciliation", "mark_needs_reconciliation"],
    ["reject", "reject_execution_result"],
  ])
  const action = aliases.get(raw) ?? raw
  if (!STOCK_FEEDBACK_EXECUTION_RESULT_REVIEW_ACTIONS.includes(action)) {
    throw new Error(`--action must be one of ${STOCK_FEEDBACK_EXECUTION_RESULT_REVIEW_ACTIONS.join(", ")}`)
  }
  return action
}

function compactString(value, max = 600) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim()
  if (text.length <= max) return text
  return `${text.slice(0, Math.max(max - 1, 0))}…`
}

function compactStringArray(value, maxItems = 12, maxChars = 240) {
  const items = Array.isArray(value) ? value : value == null ? [] : [value]
  return items
    .map((item) => compactString(item, maxChars))
    .filter(Boolean)
    .slice(0, maxItems)
}

function compactList(value, maxItems = 20, maxChars = 240) {
  const items = Array.isArray(value)
    ? value
    : String(value ?? "")
      .split(/[\n,，;；]+/)
      .map((item) => item.trim())
  return compactStringArray(items, maxItems, maxChars)
}

function collectSearchText(...items) {
  return items
    .map((item) => {
      if (!item) return ""
      if (typeof item === "string") return item
      try {
        return JSON.stringify(item)
      } catch {
        return String(item)
      }
    })
    .join("\n")
    .toLowerCase()
}

function includesAny(text, patterns) {
  return patterns.some((pattern) => {
    if (pattern instanceof RegExp) return pattern.test(text)
    return text.includes(String(pattern).toLowerCase())
  })
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    const parsed = finiteNumber(value)
    if (parsed !== null) return parsed
  }
  return null
}

function compactOptionalString(value, max = 160) {
  const text = compactString(value, max)
  return text || null
}

function firstCompactString(max = 160, ...values) {
  for (const value of values) {
    const text = compactString(value, max)
    if (text) return text
  }
  return ""
}

function selfQuestionId(record = {}) {
  return record.questionRecordId ?? record.questionId ?? record.targetId ?? record.id ?? null
}

function stockKey(record = {}) {
  const safe = record ?? {}
  return compactString([safe.stockName, safe.stockCode].filter(Boolean).join(" "), 120)
}

function recordTime(record = {}) {
  const safe = record ?? {}
  return safe.createdAt ?? safe.answeredAt ?? safe.updatedAt ?? safe.eventAt ?? safe.date ?? null
}

function normalizeAttributionLabel(record = {}) {
  return normalizeToken(record.attributionLabel ?? record.label ?? record.result ?? record.verdict)
}

function isPositiveMarketFeedback(record = {}, related = {}) {
  const label = normalizeAttributionLabel(record)
  const text = collectSearchText(record.verdict, record.result, record.reason, record.attributionReason, related.validation?.verdict, related.validation?.result)
  return (
    ["confirmed", "price_only", "success", "validated"].includes(label) ||
    includesAny(text, ["验证通过", "validated", "success", "market feedback", "量价反馈支持", "市场反馈支持"])
  )
}

function isDisconfirmedFeedback(record = {}, related = {}) {
  const label = normalizeAttributionLabel(record)
  const text = collectSearchText(record.verdict, record.result, record.reason, record.attributionReason, related.validation?.verdict, related.validation?.result)
  return (
    ["disconfirmed", "failure", "failed"].includes(label) ||
    includesAny(text, ["验证失败", "disconfirmed", "failed", "失败", "证伪", "无承接", "一日游"])
  )
}

function detectPricedIn(record = {}, related = {}) {
  const text = collectSearchText(record, related.validation, related.question)
  return includesAny(text, [
    "priced_in",
    "price-in",
    "priced in",
    "后手",
    "赔率压缩",
    "方向对但买点错",
    "买点错",
    "追涨风险",
    "entry_wrong",
    "avoid_late_entry",
    "late entry",
  ])
}

function marketSignals(record = {}, related = {}) {
  return [
    ...compactStringArray(record.marketSignals, 20, 120),
    ...compactStringArray(related.validation?.marketSignals, 20, 120),
    ...compactStringArray(related.question?.marketSignals, 20, 120),
  ]
}

function classifyMarketPatterns(target, record = {}, related = {}, qualityGate = {}) {
  const signals = marketSignals(record, related)
  const text = collectSearchText(
    record,
    related.validation,
    related.question,
    signals,
    qualityGate.status,
  )
  const matched = []
  const addPattern = (patternId) => {
    const pattern = STOCK_FEEDBACK_MARKET_PATTERNS.find((item) => item.id === patternId)
    if (pattern && !matched.some((item) => item.id === pattern.id)) {
      matched.push({
        id: pattern.id,
        label: pattern.label,
        adapterCapability: pattern.adapterCapability,
        distillationHint: pattern.distillationHint,
      })
    }
  }

  const patternAllowedForTarget = (patternId) => {
    if (["event_expectation_front_run", "low_absorption_breakout"].includes(patternId)) return target === "expectation_trade"
    if (patternId === "priced_in_late_entry") return target === "priced_in_risk"
    if (patternId === "failed_catalyst_one_day_hype") return target === "disconfirmation"
    if (patternId === "fundamental_closure_confirmation") return target === "fundamental_closure" && qualityGate.status === "fundamental_validated"
    return true
  }

  for (const pattern of STOCK_FEEDBACK_MARKET_PATTERNS) {
    if (!patternAllowedForTarget(pattern.id)) continue
    if (includesAny(text, pattern.keywords)) addPattern(pattern.id)
  }
  if (target === "expectation_trade" && isPositiveMarketFeedback(record, related)) {
    addPattern("event_expectation_front_run")
  }
  if (target === "fundamental_closure" && qualityGate.status === "fundamental_validated") {
    addPattern("fundamental_closure_confirmation")
  }
  if (target === "priced_in_risk") {
    addPattern("priced_in_late_entry")
  }
  if (target === "disconfirmation") {
    addPattern("failed_catalyst_one_day_hype")
  }
  return matched
}

function profitOutcomeFromPnl(realizedPnlPct, qualityGate = {}) {
  if (realizedPnlPct > 0) return "profitable"
  if (realizedPnlPct < 0) return "loss"
  if (realizedPnlPct === 0) return "flat"
  if (qualityGate.status === "expectation_validated") return "market_validated_unrealized"
  if (qualityGate.status === "priced_in_validated") return "direction_right_entry_risk"
  if (qualityGate.status === "disconfirmed_validated") return "failed_or_unprofitable"
  return "unknown"
}

function profitFeedbackFromRecord(record = {}, related = {}, qualityGate = {}) {
  const validation = related.validation ?? {}
  const realizedPnlPct = firstFiniteNumber(
    record.realizedPnlPct,
    record.realizedReturnPct,
    record.pnlPct,
    record.returnPct,
    record.profitPct,
    validation.realizedPnlPct,
    validation.pnlPct,
    validation.returnPct,
  )
  const maxDrawdownPct = firstFiniteNumber(
    record.maxDrawdownPct,
    record.drawdownPct,
    record.maxDdPct,
    validation.maxDrawdownPct,
    validation.drawdownPct,
  )
  const holdingDays = firstFiniteNumber(record.holdingDays, record.holdDays, validation.holdingDays, validation.holdDays)
  const result = {
    outcome: profitOutcomeFromPnl(realizedPnlPct, qualityGate),
    realizedPnlPct,
    maxDrawdownPct,
    holdingDays,
    entryTiming: compactOptionalString(record.entryTiming ?? validation.entryTiming, 120),
    exitTiming: compactOptionalString(record.exitTiming ?? validation.exitTiming, 120),
    positionSizing: compactOptionalString(record.positionSizing ?? validation.positionSizing, 120),
  }
  return Object.fromEntries(Object.entries(result).filter(([, value]) => value !== null && value !== undefined && value !== ""))
}

function includesToken(value, tokens = []) {
  const text = normalizeToken(value)
  return tokens.some((token) => text.includes(normalizeToken(token)))
}

function profitCreditAssignmentForFeedback({
  target,
  qualityGate = {},
  marketPatterns = [],
  profitFeedback = {},
}) {
  const outcome = profitFeedback.outcome ?? "unknown"
  const patternIds = (marketPatterns ?? []).map((item) => item.id).filter(Boolean)
  const adapterLearns = new Set()
  const failureModes = new Set()
  if (profitFeedback.entryTiming) adapterLearns.add("entry_timing")
  if (profitFeedback.positionSizing) adapterLearns.add("position_sizing")
  if (profitFeedback.exitTiming) adapterLearns.add("exit_discipline")
  if (profitFeedback.maxDrawdownPct !== undefined) adapterLearns.add("drawdown_control")
  if (patternIds.length > 0) adapterLearns.add("market_pattern_selection")
  if (includesToken(profitFeedback.entryTiming, ["late", "chase", "追涨", "后手"])) failureModes.add("late_entry_or_chase")
  if (includesToken(profitFeedback.positionSizing, ["oversize", "heavy", "满仓", "重仓", "过重"])) failureModes.add("oversized_position")
  if (includesToken(profitFeedback.exitTiming, ["failed_follow", "stop_loss", "止损", "无承接"])) failureModes.add("failed_follow_through_exit")
  const drawdown = Math.abs(Number(profitFeedback.maxDrawdownPct ?? 0))
  if (Number.isFinite(drawdown) && drawdown >= 8) failureModes.add("drawdown_breach")

  const isFailedExpectation = outcome === "failed_or_unprofitable" || qualityGate.status === "disconfirmed_validated" || target === "disconfirmation"
  let primaryCredit = "unsettled_feedback_pending"
  let trainingUse = "monitor_until_settled"
  if (isFailedExpectation) {
    primaryCredit = "failed_expectation_negative"
    trainingUse = "eval_preference_negative"
    adapterLearns.add("failure_attribution")
    failureModes.add("expectation_disconfirmed_or_no_follow_through")
  } else if (outcome === "profitable") {
    primaryCredit = "pattern_execution_supported"
    trainingUse = "adapter_candidate_after_review"
  } else if (["loss", "direction_right_entry_risk"].includes(outcome)) {
    primaryCredit = "execution_risk_negative"
    trainingUse = "eval_preference_negative"
    adapterLearns.add("entry_risk")
    adapterLearns.add("stop_loss_or_exit_discipline")
  }
  if (adapterLearns.size === 0) adapterLearns.add("feedback_monitoring")
  const reviewQuestions = [
    "收益来自可复用手法、买点和仓位，还是来自单只股票事实或行情 beta？",
    "亏损是否来自方向错误、后手买点、仓位过重、止损慢或无承接？",
    "adapter 是否只学习收益归因、执行纪律和工具习惯，而不存原文事实？",
  ]
  return {
    schema: "stock-feedback-profit-credit-assignment-v1",
    primaryCredit,
    trainingUse,
    adapterLearns: [...adapterLearns],
    failureModes: [...failureModes],
    marketPatternIds: patternIds,
    reviewQuestions,
    storesRawFacts: false,
    factsRemainIn: ["retrieval/tool state", "sourceRefs", "price SQL", "trade ledger"],
    summary: [
      `profit_credit=${primaryCredit}`,
      `training_use=${trainingUse}`,
      outcome ? `outcome=${outcome}` : "",
      profitFeedback.realizedPnlPct !== undefined ? `pnl=${profitFeedback.realizedPnlPct}%` : "",
      profitFeedback.maxDrawdownPct !== undefined ? `drawdown=${profitFeedback.maxDrawdownPct}%` : "",
    ].filter(Boolean).join(" / "),
  }
}

function attachProfitCreditAssignment(profitFeedback = {}, context = {}) {
  if (!profitFeedback || Object.keys(profitFeedback).length === 0) return profitFeedback
  return {
    ...profitFeedback,
    creditAssignment: profitCreditAssignmentForFeedback({
      ...context,
      profitFeedback,
    }),
  }
}

function distillationSignalsForTrajectory({
  target,
  qualityGate = {},
  marketPatterns = [],
  profitFeedback = {},
}) {
  const patternLabels = marketPatterns.map((item) => item.label).filter(Boolean)
  const hasLowAbsorption = marketPatterns.some((item) => item.id === "low_absorption_breakout")
  const hasPricedIn = marketPatterns.some((item) => item.id === "priced_in_late_entry")
  const hasFailure = marketPatterns.some((item) => item.id === "failed_catalyst_one_day_hype")
  const distillInto = ["behavior", "skill", "tool_habit", "decision_strategy"]
  const behavior =
    target === "expectation_trade"
      ? "把时间戳、扩散、相对强度、成交额和后续承接组合成预期交易验证行为。"
      : target === "fundamental_closure"
        ? "把订单、公告、财报、ASP 和毛利率证据组合成基本面兑现验证行为。"
        : target === "priced_in_risk"
          ? "把方向正确但赔率压缩的样本转入后手风险和偏好训练。"
          : "把无承接、一日游或证伪样本转入失败归因和负样本训练。"
  const decisionStrategy = [
    hasLowAbsorption ? "低位吸收后先小仓试错，转强和扩散确认后再加仓。" : "",
    hasPricedIn ? "方向对也要检查后手赔率、买点位置和承接质量。" : "",
    hasFailure ? "没有扩散或承接时降低假设权重，优先记录失败触发条件。" : "",
    patternLabels.length ? `手法模式：${patternLabels.join(" / ")}` : "",
  ].filter(Boolean).join(" ")
  const riskControl = [
    "用回撤、持有期和分批兑现检查收益质量。",
    profitFeedback.maxDrawdownPct !== undefined ? `样本最大回撤 ${profitFeedback.maxDrawdownPct}%。` : "",
    profitFeedback.positionSizing ? `仓位节奏：${profitFeedback.positionSizing}。` : "",
  ].filter(Boolean).join(" ")
  return {
    distillInto,
    skill: TARGET_TO_CAPABILITY[target],
    behavior,
    toolHabit: "先从 retrieval/tool state 读取事实、公告、价格、成交额和验证记录；adapter 只沉淀可复用判断路线。",
    decisionStrategy: decisionStrategy || "按训练目标拆分预期交易、基本面兑现、priced-in 风险和失败归因。",
    riskControl,
    profitCredit: profitFeedback.creditAssignment?.summary ?? "",
    preferenceUse: ["priced_in_validated", "disconfirmed_validated"].includes(qualityGate.status) ? "preference/eval" : "eval/sft",
    factBoundary: "raw facts remain in retrieval/tool state",
  }
}

function requiredToolStateForTrajectory(trajectory = {}) {
  const base = [
    "retrieval:sourceRefs",
    "tool-state:self-question-attribution",
    "market-data:price-volume-validation",
  ]
  if (trajectory.validationTarget === "expectation_trade") {
    base.push("market-data:relative-strength-turnover-follow-through")
    base.push("retrieval:theme-diffusion-sourceRefs")
  }
  if (trajectory.validationTarget === "fundamental_closure") {
    base.push("retrieval:announcements-orders-financials")
    base.push("tool-state:fundamental-evidence-confirmation")
  }
  if (trajectory.validationTarget === "priced_in_risk") {
    base.push("market-data:late-entry-odds-and-follow-through")
    base.push("tool-state:entry-risk-review")
  }
  if (trajectory.validationTarget === "disconfirmation") {
    base.push("market-data:no-follow-through-or-failed-diffusion")
    base.push("tool-state:negative-catalyst-review")
  }
  return [...new Set(base)]
}

function adapterLearnsForTrajectory(trajectory = {}) {
  const signals = trajectory.distillationSignals ?? {}
  return [
    { kind: "behavior", value: signals.behavior },
    { kind: "skill", value: signals.skill ?? trajectory.adapterCapability },
    { kind: "tool_habit", value: signals.toolHabit },
    { kind: "decision_strategy", value: signals.decisionStrategy },
    { kind: "risk_control", value: signals.riskControl },
    { kind: "profit_credit_assignment", value: signals.profitCredit },
  ].filter((item) => item.value)
}

function humanDecisionReasonsForTrajectory(trajectory = {}, adapterPriority = null) {
  return [
    ...compactStringArray(trajectory.qualityGate?.reasons, 8, 120),
    ...(trajectory.marketPatterns ?? []).map((pattern) => `market_pattern:${pattern.id}`).filter(Boolean),
    trajectory.profitFeedback?.outcome ? `profit_outcome:${trajectory.profitFeedback.outcome}` : "",
    ...compactStringArray(adapterPriority?.reasons, 8, 120),
  ].filter(Boolean)
}

function distillationPlanForTrajectory(trajectory = {}, reviewSignal = null, adapterPriority = null) {
  const gate = trajectory.qualityGate?.status ?? "review_required"
  const recommendedAction = reviewSignal?.recommendedAction ?? recommendedReviewAction(trajectory)
  const reasons = humanDecisionReasonsForTrajectory(trajectory, adapterPriority)
  return {
    schema: STOCK_FEEDBACK_DISTILLATION_PLAN_SCHEMA,
    planId: `distill_plan_${shortHash(`${trajectory.id}:${trajectory.validationTarget}:${gate}`)}`,
    sourceTrajectoryId: trajectory.id,
    validationTarget: trajectory.validationTarget,
    qualityGateStatus: gate,
    adapterCapability: trajectory.adapterCapability ?? TARGET_TO_CAPABILITY[trajectory.validationTarget],
    requiredToolState: requiredToolStateForTrajectory(trajectory),
    adapterLearns: adapterLearnsForTrajectory(trajectory),
    factBoundary: {
      storesRawFacts: false,
      factsRemainIn: ["retrieval/tool state", "sourceRefs", "price SQL", "wiki/raw/facts"],
      adapterDoesNotStore: ["raw_facts", "announcements_or_report_text", "price_rows_or_trade_records", "single_stock_fact_memory"],
      sourceRefs: compactStringArray(trajectory.sourceRefs, 20, 220),
    },
    humanDecision: {
      recommendedAction,
      recommendedActionLabel: reviewActionLabel(recommendedAction),
      latestAction: reviewSignal?.latestAction ?? null,
      latestResult: reviewSignal?.latestResult ?? null,
      why: [...new Set(reasons)].slice(0, 12),
      reviewQuestions: [
        "这个样本是否代表可复用手法，而不是单只股票事实？",
        "事实、公告、价格和成交额是否仍留在 retrieval/tool state？",
        "收益反馈是否支持这个判断路线，还是只适合 eval/preference？",
      ],
    },
    adapterCurriculum: adapterPriority ? {
      strategy: adapterPriority.strategy,
      bucket: adapterPriority.bucket,
      score: adapterPriority.score,
      benchmarkBucket: adapterPriority.benchmarkBucket,
      reasons: compactStringArray(adapterPriority.reasons, 12, 120),
    } : null,
  }
}

function expectationCheckResults(record = {}, related = {}) {
  const text = collectSearchText(record, related.validation, related.question)
  const signals = marketSignals(record, related)
  const signalText = collectSearchText(signals)
  const timestamp = Boolean(recordTime(record) ?? recordTime(related.validation) ?? recordTime(related.question))
  const marketReaction = isPositiveMarketFeedback(record, related)
  const relativeStrengthOrVolume = includesAny(`${text}\n${signalText}`, [
    "relative_strength",
    "turnover_expansion",
    "volume_price_confirmed",
    "成交额",
    "放量",
    "量价",
    "相对强度",
    "强于",
  ])
  const followThroughOrDiffusion = includesAny(`${text}\n${signalText}`, [
    "follow_through",
    "theme_diffusion",
    "diffusion",
    "承接",
    "扩散",
    "接力",
    "持续",
    "后续",
  ])
  return {
    timestamp,
    marketReaction,
    relativeStrengthOrVolume,
    followThroughOrDiffusion,
  }
}

function confirmedEvidenceResults(record = {}, evidenceResults = []) {
  const recordId = record.id
  const validationId = record.validationId
  const questionRecordId = record.questionRecordId
  const questionId = record.questionId
  return evidenceResults.filter((item) => {
    const value = item.value ?? item
    const result = normalizeToken(value.result ?? value.status)
    if (!["confirmed", "resolved", "success"].includes(result)) return false
    return (
      (recordId && value.attributionId === recordId) ||
      (validationId && value.validationId === validationId) ||
      (questionRecordId && value.questionRecordId === questionRecordId) ||
      (questionId && value.questionId === questionId)
    )
  }).map((item) => item.value ?? item)
}

function hasFundamentalEvidence(record = {}, evidenceResults = []) {
  const confirmed = confirmedEvidenceResults(record, evidenceResults)
  if (confirmed.length > 0) return true
  const text = collectSearchText(record)
  return includesAny(text, [
    "fundamental_validated",
    "cninfo:confirmed",
    "qcc:confirmed",
    "订单已确认",
    "公告补证已确认",
    "财报兑现",
    "毛利率兑现",
  ])
}

function evidenceRefsFor(record = {}, evidenceResults = []) {
  const refs = []
  for (const item of confirmedEvidenceResults(record, evidenceResults)) {
    refs.push(...compactStringArray(item.sourceRefs, 8, 200))
    if (item.id) refs.push(item.id)
  }
  refs.push(...compactStringArray(record.sourceRefs, 10, 200))
  return [...new Set(refs)].slice(0, 20)
}

function qualityGateForTarget(target, record = {}, related = {}) {
  const evidenceResults = related.evidenceResults ?? []
  if (target === "expectation_trade") {
    const checks = expectationCheckResults(record, related)
    const passed = Object.values(checks).every(Boolean)
    return {
      status: passed ? "expectation_validated" : "review_required",
      validationTarget: target,
      highConfidenceEligible: passed,
      requiredAction: passed ? null : "review_expectation_trade_checks",
      reasons: passed
        ? ["market_expectation_rule_confirmed"]
        : Object.entries(checks).filter(([, ok]) => !ok).map(([key]) => `missing_${key}`),
      checkResults: checks,
    }
  }
  if (target === "fundamental_closure") {
    const confirmed = hasFundamentalEvidence(record, evidenceResults)
    return {
      status: confirmed ? "fundamental_validated" : "needs_evidence",
      validationTarget: target,
      highConfidenceEligible: confirmed,
      requiredAction: confirmed ? null : "collect_fundamental_evidence",
      reasons: confirmed ? ["fundamental_evidence_confirmed"] : ["orders_announcements_financials_not_confirmed"],
      evidenceResultIds: confirmedEvidenceResults(record, evidenceResults).map((item) => item.id).filter(Boolean),
    }
  }
  if (target === "priced_in_risk") {
    const detected = detectPricedIn(record, related)
    return {
      status: detected ? "priced_in_validated" : "review_required",
      validationTarget: target,
      highConfidenceEligible: detected,
      requiredAction: detected ? "route_to_entry_risk_eval" : "review_entry_risk",
      reasons: detected ? ["direction_right_entry_risk_detected"] : ["priced_in_risk_not_detected"],
    }
  }
  if (target === "disconfirmation") {
    const disconfirmed = isDisconfirmedFeedback(record, related)
    return {
      status: disconfirmed ? "disconfirmed_validated" : "review_required",
      validationTarget: target,
      highConfidenceEligible: disconfirmed,
      requiredAction: disconfirmed ? "route_to_negative_eval" : "review_disconfirmation",
      reasons: disconfirmed ? ["failed_expectation_confirmed"] : ["disconfirmation_not_confirmed"],
    }
  }
  return {
    status: "review_required",
    validationTarget: target,
    highConfidenceEligible: false,
    requiredAction: "human_review",
    reasons: ["unknown_validation_target"],
  }
}

function compactMarketValidation(record = {}, related = {}) {
  const validation = related.validation ?? {}
  const source = record.marketValidation ?? validation.marketValidation ?? null
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return {
      verdict: compactString(record.verdict ?? validation.verdict ?? record.result ?? validation.result, 180),
      windowDays: record.windowDays ?? validation.windowDays ?? null,
      signals: marketSignals(record, related),
    }
  }
  return {
    status: compactString(source.status, 80),
    verdict: compactString(source.verdict ?? record.verdict ?? validation.verdict, 180),
    lookbackDays: source.lookbackDays ?? record.windowDays ?? validation.windowDays ?? null,
    pctChange: source.pctChange ?? source.pct ?? null,
    amountRatio: source.amountRatio ?? null,
    refs: compactStringArray(source.refs ?? source.sourceRefs, 10, 200),
    signals: marketSignals(record, related),
  }
}

function buildTrajectory({ target, record, related, generatedAt }) {
  const evidenceResults = related.evidenceResults ?? []
  const sourceRecordId = record.id ?? shortHash(JSON.stringify(record))
  const idSeed = `${sourceRecordId}:${target}:${record.validationId ?? ""}:${record.questionId ?? ""}`
  const qualityGate = qualityGateForTarget(target, record, related)
  const marketPatterns = classifyMarketPatterns(target, record, related, qualityGate)
  const profitFeedback = attachProfitCreditAssignment(
    profitFeedbackFromRecord(record, related, qualityGate),
    { target, qualityGate, marketPatterns },
  )
  const distillationSignals = distillationSignalsForTrajectory({
    target,
    qualityGate,
    marketPatterns,
    profitFeedback,
  })
  const sourceRefs = [
    record.path,
    related.question?.path,
    related.validation?.path,
    ...evidenceRefsFor(record, evidenceResults),
  ].filter(Boolean)
  const trajectory = {
    schema: STOCK_FEEDBACK_TRAJECTORY_SCHEMA,
    id: `stockfb_${shortHash(idSeed)}`,
    generatedAt,
    source: "self-question-attribution",
    sourceRecordId,
    validationTarget: target,
    validationTargetLabel: TARGET_TO_LABEL[target],
    qualityGate,
    adapterCapability: TARGET_TO_CAPABILITY[target],
    trainingUse: GATE_TO_TRAINING_USE[qualityGate.status] ?? ["eval"],
    questionRecordId: record.questionRecordId ?? related.question?.id ?? null,
    validationId: record.validationId ?? related.validation?.id ?? null,
    questionId: record.questionId ?? related.question?.questionId ?? related.question?.id ?? null,
    hypothesis: compactString(record.hypothesis ?? related.question?.hypothesis, 600),
    question: compactString(record.question ?? related.question?.question, 600),
    stock: {
      name: compactString(record.stockName ?? related.validation?.stockName ?? related.question?.stocks?.[0]?.name, 80),
      code: compactString(record.stockCode ?? related.validation?.stockCode ?? related.question?.stocks?.[0]?.code, 32),
      label: stockKey(record) || stockKey(related.validation),
    },
    eventTimeline: [
      { step: "question", at: recordTime(related.question), ref: related.question?.id ?? record.questionRecordId ?? null },
      { step: "market_validation", at: recordTime(related.validation), ref: related.validation?.id ?? record.validationId ?? null },
      { step: "attribution", at: recordTime(record), ref: record.id ?? null },
    ].filter((item) => item.at || item.ref),
    marketValidation: compactMarketValidation(record, related),
    marketPatterns,
    profitFeedback,
    distillationSignals,
    evidenceState: {
      attributionLabel: normalizeAttributionLabel(record) || null,
      confidenceImpact: compactString(record.confidenceImpact, 120),
      nextAction: compactString(record.nextAction, 180),
      evidenceGaps: compactStringArray(record.evidenceGaps, 12, 240),
      confirmedEvidenceRefs: evidenceRefsFor(record, evidenceResults),
      fundamentalEvidenceConfirmed: hasFundamentalEvidence(record, evidenceResults),
    },
    routing: {
      eval: true,
      sft: ["expectation_validated", "fundamental_validated"].includes(qualityGate.status),
      preference: ["priced_in_validated", "disconfirmed_validated"].includes(qualityGate.status),
      adapterCandidate: qualityGate.highConfidenceEligible === true && STOCK_FEEDBACK_QUALITY_GATES.includes(qualityGate.status),
    },
    sourceRefs: [...new Set(sourceRefs)].slice(0, 30),
    summary: compactString(record.attributionReason ?? record.reason ?? record.verdict ?? "", 700),
  }
  return {
    ...trajectory,
    distillationPlan: distillationPlanForTrajectory(trajectory),
  }
}

function gateForConfirmedCollectionTarget(target) {
  return {
    expectation_trade: "expectation_validated",
    fundamental_closure: "fundamental_validated",
    priced_in_risk: "priced_in_validated",
    disconfirmation: "disconfirmed_validated",
  }[target] ?? "review_required"
}

function effectiveTargetForCollectionResult(result = {}) {
  if (result.result === "refuted") return "disconfirmation"
  const target = result.validationTarget ?? validationTargetForMarketPattern(result.targetPatternId)
  return STOCK_FEEDBACK_VALIDATION_TARGETS.includes(target) ? target : "expectation_trade"
}

function qualityGateForCollectionResult(result = {}, target = effectiveTargetForCollectionResult(result)) {
  if (result.result === "confirmed") {
    const status = gateForConfirmedCollectionTarget(target)
    return {
      status,
      validationTarget: target,
      highConfidenceEligible: status !== "review_required",
      requiredAction: null,
      reasons: ["collection_result_confirmed", `source_pattern:${result.targetPatternId ?? "unknown"}`],
      evidenceResultIds: [result.id].filter(Boolean),
    }
  }
  if (result.result === "refuted") {
    return {
      status: "disconfirmed_validated",
      validationTarget: "disconfirmation",
      highConfidenceEligible: true,
      requiredAction: "route_to_negative_eval",
      reasons: ["collection_result_refuted", `refuted_pattern:${result.targetPatternId ?? "unknown"}`],
      evidenceResultIds: [result.id].filter(Boolean),
    }
  }
  return {
    status: "needs_evidence",
    validationTarget: target,
    highConfidenceEligible: false,
    requiredAction: "keep_collection_task_open",
    reasons: ["collection_result_insufficient", `source_pattern:${result.targetPatternId ?? "unknown"}`],
    evidenceResultIds: [result.id].filter(Boolean),
  }
}

function marketPatternSummary(patternId) {
  const pattern = STOCK_FEEDBACK_MARKET_PATTERNS.find((item) => item.id === patternId)
  if (!pattern) return null
  return {
    id: pattern.id,
    label: pattern.label,
    adapterCapability: pattern.adapterCapability,
    distillationHint: pattern.distillationHint,
  }
}

function marketPatternsForCollectionResult(result = {}, target) {
  const patternIds = []
  const confirmedFundamentalClosure = result.result === "confirmed" && target === "fundamental_closure"
  if (result.result === "refuted") {
    patternIds.push("failed_catalyst_one_day_hype")
  } else if (result.targetPatternId && (result.targetPatternId !== "fundamental_closure_confirmation" || confirmedFundamentalClosure)) {
    patternIds.push(result.targetPatternId)
  }
  if (confirmedFundamentalClosure) patternIds.push("fundamental_closure_confirmation")
  if (target === "priced_in_risk") patternIds.push("priced_in_late_entry")
  if (target === "disconfirmation") patternIds.push("failed_catalyst_one_day_hype")
  if (target === "expectation_trade" && patternIds.length === 0) patternIds.push("event_expectation_front_run")
  return [...new Set(patternIds)].map(marketPatternSummary).filter(Boolean)
}

function profitFeedbackFromCollectionResult(result = {}, qualityGate = {}) {
  if (qualityGate.status === "priced_in_validated") return { outcome: "direction_right_entry_risk" }
  if (qualityGate.status === "disconfirmed_validated") return { outcome: "failed_or_unprofitable" }
  if (qualityGate.status === "expectation_validated") return { outcome: "market_validated_unrealized" }
  return { outcome: "unknown" }
}

function trajectoryFromCollectionResult(result = {}, { generatedAt }) {
  const target = effectiveTargetForCollectionResult(result)
  const qualityGate = qualityGateForCollectionResult(result, target)
  const marketPatterns = marketPatternsForCollectionResult(result, target)
  const profitFeedback = attachProfitCreditAssignment(
    profitFeedbackFromCollectionResult(result, qualityGate),
    { target, qualityGate, marketPatterns },
  )
  const distillationSignals = distillationSignalsForTrajectory({
    target,
    qualityGate,
    marketPatterns,
    profitFeedback,
  })
  const evidenceRefs = compactStringArray(result.evidenceRefs, 30, 260)
  const sourceRefs = [
    result.artifactPath,
    ...evidenceRefs,
  ].filter(Boolean)
  const sourceRecordId = result.id ?? shortHash(JSON.stringify(result))
  const trajectory = {
    schema: STOCK_FEEDBACK_TRAJECTORY_SCHEMA,
    id: `stockfb_${shortHash(`${sourceRecordId}:${target}:collection_result`)}`,
    generatedAt,
    source: "stock-feedback-collection-result",
    sourceRecordId,
    validationTarget: target,
    validationTargetLabel: TARGET_TO_LABEL[target],
    qualityGate,
    adapterCapability: TARGET_TO_CAPABILITY[target],
    trainingUse: GATE_TO_TRAINING_USE[qualityGate.status] ?? ["eval"],
    questionRecordId: null,
    validationId: null,
    questionId: null,
    hypothesis: compactString(result.hypothesis || `${result.targetPatternLabel ?? result.targetPatternId ?? "补样本"}：${result.resultLabel ?? result.result}`, 600),
    question: compactString(result.intakeSummary || result.hypothesis || result.resultLabel || "", 600),
    stock: {
      name: compactString(result.stock?.name, 80),
      code: compactString(result.stock?.code, 32),
      label: compactString([result.stock?.name, result.stock?.code].filter(Boolean).join(" "), 120),
    },
    eventTimeline: [
      { step: "collection_result", at: result.generatedAt ?? generatedAt, ref: result.id ?? null },
      { step: "collection_task", at: null, ref: result.sourceTaskId ?? result.sourceDraftId ?? null },
    ].filter((item) => item.at || item.ref),
    marketValidation: {
      status: result.result,
      verdict: compactString(result.intakeSummary || result.resultLabel || result.result, 180),
      refs: evidenceRefs,
      signals: [
        `collection_result:${result.result}`,
        result.targetPatternId ? `target_pattern:${result.targetPatternId}` : "",
        result.validationTarget ? `requested_target:${result.validationTarget}` : "",
      ].filter(Boolean),
    },
    marketPatterns,
    profitFeedback,
    distillationSignals,
    evidenceState: {
      attributionLabel: result.result,
      confidenceImpact: result.result === "confirmed" ? "human_confirmed_collection_result" : result.result === "refuted" ? "human_refuted_collection_result" : "needs_more_collection_evidence",
      nextAction: result.nextAction ?? null,
      evidenceGaps: result.result === "insufficient" ? [`collection_result_insufficient:${result.targetPatternId ?? target}`] : [],
      confirmedEvidenceRefs: evidenceRefs,
      fundamentalEvidenceConfirmed: qualityGate.status === "fundamental_validated",
      collectionResultId: result.id ?? null,
      sourceDraftId: result.sourceDraftId ?? null,
      sourceTaskId: result.sourceTaskId ?? null,
      targetPatternId: result.targetPatternId ?? null,
      requestedValidationTarget: result.validationTarget ?? null,
    },
    routing: {
      eval: true,
      sft: ["expectation_validated", "fundamental_validated"].includes(qualityGate.status),
      preference: ["priced_in_validated", "disconfirmed_validated"].includes(qualityGate.status),
      adapterCandidate: qualityGate.highConfidenceEligible === true && STOCK_FEEDBACK_QUALITY_GATES.includes(qualityGate.status),
    },
    collectionState: {
      result: result.result ?? null,
      resultLabel: result.resultLabel ?? null,
      sourceDraftId: result.sourceDraftId ?? null,
      sourceTaskId: result.sourceTaskId ?? null,
      targetPatternId: result.targetPatternId ?? null,
      targetPatternLabel: result.targetPatternLabel ?? null,
      requestedValidationTarget: result.validationTarget ?? null,
      nextAction: result.nextAction ?? null,
      reviewer: result.reviewer ?? null,
    },
    sourceRefs: [...new Set(sourceRefs)].slice(0, 30),
    summary: compactString(result.intakeSummary || result.resultLabel || "", 700),
  }
  return {
    ...trajectory,
    distillationPlan: distillationPlanForTrajectory(trajectory),
  }
}

function stockFeedbackTrajectoriesFromCollectionResults(collectionResults = [], options = {}) {
  const generatedAt = options.generatedAt ?? nowLocalTimestamp()
  return collectionResults
    .filter((item) => item && typeof item === "object" && item.schema === STOCK_FEEDBACK_COLLECTION_RESULT_SCHEMA)
    .map((item) => trajectoryFromCollectionResult(item, { generatedAt }))
}

const DEFAULT_EXECUTION_RESULT_DELIVERY_DATES = [
  "2026-05-21",
  "2026-05-25",
  "2026-05-26",
  "2026-05-27",
]

function stripNumber(value) {
  const text = String(value ?? "")
    .replace(/[,\s，]/g, "")
    .replace(/[￥元股%]/g, "")
    .replace(/[+]/g, "")
    .trim()
  if (!text || text === "-" || text === "—") return null
  const parsed = Number(text.match(/-?\d+(?:\.\d+)?/)?.[0] ?? text)
  return Number.isFinite(parsed) ? parsed : null
}

function roundMoney(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : null
}

function roundPct(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Number(parsed.toFixed(4)) : null
}

function normalizeLocalStockCode(value) {
  const text = String(value ?? "").trim().toUpperCase()
  const digits = text.match(/\d{6}/)?.[0] ?? ""
  return digits || text
}

function normalizeSide(value) {
  const text = String(value ?? "").toLowerCase()
  if (text.includes("卖") || text.includes("sell")) return "sell"
  if (text.includes("买") || text.includes("buy")) return "buy"
  return null
}

function parseDateFromPath(filePath) {
  return String(filePath ?? "").match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null
}

function daysBetweenDates(startDate, endDate) {
  if (!startDate || !endDate) return null
  const start = Date.parse(`${startDate}T00:00:00Z`)
  const end = Date.parse(`${endDate}T00:00:00Z`)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  return Math.max(0, Math.round((end - start) / 86400000))
}

function parseMarkdownTableRows(content) {
  const lines = String(content ?? "").split(/\r?\n/)
  const tables = []
  let header = null
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) {
      header = null
      continue
    }
    const cells = trimmed.slice(1, -1).split("|").map((cell) => cell.trim())
    if (cells.every((cell) => /^:?-{2,}:?$/.test(cell))) continue
    if (!header) {
      header = cells
      continue
    }
    if (cells.length >= Math.max(header.length - 1, 1)) tables.push({ header, cells })
  }
  return tables
}

function columnValue(header, cells, aliases) {
  const normalizedAliases = aliases.map((item) => String(item).toLowerCase())
  const index = header.findIndex((name) => {
    const lower = String(name ?? "").toLowerCase()
    return normalizedAliases.some((alias) => lower.includes(alias))
  })
  return index >= 0 ? cells[index] : ""
}

function parseDeliveryNoteMarkdown(content, { filePath, projectPath }) {
  const tradeDate = parseDateFromPath(filePath)
  if (!tradeDate) return []
  const relativePath = projectRelative(projectPath, filePath)
  const rows = parseMarkdownTableRows(content)
  const fills = []
  for (const { header, cells } of rows) {
    const stockCode = normalizeLocalStockCode(columnValue(header, cells, ["代码", "证券代码", "stockCode", "stock code"]))
    const side = normalizeSide(columnValue(header, cells, ["方向", "买卖", "业务", "操作", "side"]))
    const quantity = stripNumber(columnValue(header, cells, ["数量", "成交数量", "发生数量", "quantity"]))
    const price = stripNumber(columnValue(header, cells, ["价格", "成交价格", "成交价", "price"]))
    if (!stockCode || !side || !quantity || !price) continue
    const stockName = compactString(columnValue(header, cells, ["名称", "证券名称", "股票名称", "stockName", "stock name"]), 80)
    const tradeTime = compactString(columnValue(header, cells, ["时间", "成交时间", "time"]), 32)
    const amount = stripNumber(columnValue(header, cells, ["金额", "成交金额", "发生金额", "amount"]))
    const commission = stripNumber(columnValue(header, cells, ["佣金", "手续费", "commission"]))
    const stampTax = stripNumber(columnValue(header, cells, ["印花税", "stamp"]))
    const transferFee = stripNumber(columnValue(header, cells, ["过户费", "transfer"]))
    const otherFee = stripNumber(columnValue(header, cells, ["其他", "杂费", "other"]))
    const feeTotal = [commission, stampTax, transferFee, otherFee].reduce((sum, item) => sum + (item ?? 0), 0)
    fills.push({
      fillId: `fill_${shortHash(`${relativePath}:${tradeDate}:${stockCode}:${stockName}:${side}:${quantity}:${price}:${tradeTime}:${fills.length}`)}`,
      tradeDate,
      tradeTime: tradeTime || undefined,
      side,
      stockCode,
      stockName,
      quantity,
      price,
      amount: amount ?? roundMoney(quantity * price),
      fees: {
        commission: commission ?? 0,
        stampTax: stampTax ?? 0,
        transferFee: transferFee ?? 0,
        other: otherFee ?? 0,
        total: roundMoney(feeTotal ?? 0) ?? 0,
      },
      sourceRefs: [relativePath],
      valueQuality: "exact",
    })
  }
  return fills
}

async function listDeliveryNoteMarkdownFiles(projectPath, dates = DEFAULT_EXECUTION_RESULT_DELIVERY_DATES) {
  const root = path.join(projectPath, "raw", "交割单")
  const files = await listFilesRecursive(root, {
    extensions: new Set([".md", ".markdown", ".txt"]),
    excludeDirNames: new Set([".git", "node_modules"]),
    maxBytes: 1024 * 1024 * 3,
  }).catch(() => [])
  const dateSet = new Set(compactStringArray(dates, 30, 24))
  return files
    .filter((filePath) => {
      const fileDate = parseDateFromPath(filePath)
      return !dateSet.size || dateSet.has(fileDate)
    })
    .sort()
}

function sourceRef(kind, ref, role, valueQuality = "exact", extra = {}) {
  return {
    kind,
    ref,
    role,
    reliability: extra.reliability ?? (kind === "raw_delivery_note" ? "high" : "medium"),
    valueQuality,
    ...(extra.note ? { note: compactString(extra.note, 240) } : {}),
    ...(extra.riskFlags?.length ? { riskFlags: compactStringArray(extra.riskFlags, 12, 120) } : {}),
  }
}

function executionResultTrainingBoundary({ pnlScope, pnlAbs, status, profitCredit }) {
  const isConfirmed = status === "confirmed"
  const isReviewed = status === "reviewed"
  const closedOrMatched = ["closed_position", "matched_lot"].includes(pnlScope)
  const positive = firstFiniteNumber(pnlAbs) !== null && firstFiniteNumber(pnlAbs) > 0
  if (isConfirmed && closedOrMatched && positive && profitCredit === "real_pattern_execution_supported") {
    return {
      loraFactPolicy: "no_raw_facts",
      allowedDestinations: ["eval", "sft", "adapter_candidate"],
      adapterCandidateWeight: "high",
      notes: "Confirmed real_trade closed-position profit can enter high-quality real execution curriculum after review.",
    }
  }
  if ((isReviewed || isConfirmed) && closedOrMatched && positive) {
    return {
      loraFactPolicy: "no_raw_facts",
      allowedDestinations: ["eval", "sft"],
      adapterCandidateWeight: "medium",
      notes: "Reviewed positive real execution is training-eligible but still needs explicit adapter approval for weight-up.",
    }
  }
  if ((isReviewed || isConfirmed) && closedOrMatched && firstFiniteNumber(pnlAbs) !== null && firstFiniteNumber(pnlAbs) < 0) {
    return {
      loraFactPolicy: "no_raw_facts",
      allowedDestinations: ["eval", "preference", "negative"],
      adapterCandidateWeight: "none",
      notes: "Reviewed losing real execution should feed negative/eval/preference, not positive adapter.",
    }
  }
  if (pnlScope === "partial_exit") {
    return {
      loraFactPolicy: "no_raw_facts",
      allowedDestinations: ["eval"],
      adapterCandidateWeight: "low",
      notes: "Partial exits are low-weight until the full lifecycle is reconciled.",
    }
  }
  return {
    loraFactPolicy: "no_raw_facts",
    allowedDestinations: ["none"],
    adapterCandidateWeight: "none",
    notes: "Not eligible for training weight until execution result is reviewed and reconciled.",
  }
}

function qualityGateForExecutionResult({ pnlScope, positionState, sourceRefs, discrepancies = [], pnlAbs = null, recordStatus = "reviewed" }) {
  const hasBrokerDeliveryNote = sourceRefs.some((ref) => ref.kind === "raw_delivery_note")
  const blocking = discrepancies.filter((item) => item.severity === "blocking")
  const passedRules = []
  if (hasBrokerDeliveryNote) passedRules.push("broker_delivery_note_present")
  if (!["account_daily", "holding_snapshot"].includes(pnlScope)) passedRules.push("not_account_or_snapshot_pnl")
  if (["closed_position", "matched_lot"].includes(pnlScope) && positionState === "closed") passedRules.push("closed_or_matched_lot")
  if (firstFiniteNumber(pnlAbs) !== null) passedRules.push("realized_pnl_computed_from_fills")
  if (!hasBrokerDeliveryNote && ["closed_position", "matched_lot", "partial_exit"].includes(pnlScope)) {
    return {
      status: "needs_evidence",
      humanReviewRequired: true,
      blockers: ["missing_broker_delivery_note"],
      passedRules,
      trainingWeight: "none",
    }
  }
  if (blocking.length || pnlScope === "partial_exit") {
    return {
      status: "needs_reconciliation",
      humanReviewRequired: true,
      blockers: blocking.map((item) => item.field).concat(pnlScope === "partial_exit" ? ["partial_exit_lifecycle_not_closed"] : []),
      passedRules,
      trainingWeight: "low",
    }
  }
  if (pnlScope === "holding_snapshot" || pnlScope === "account_daily") {
    return {
      status: "needs_reconciliation",
      humanReviewRequired: true,
      blockers: [`${pnlScope}_not_realized_pnl`],
      passedRules,
      trainingWeight: "none",
    }
  }
  return {
    status: recordStatus === "confirmed" ? "confirmed" : "review_ready",
    humanReviewRequired: recordStatus !== "confirmed",
    blockers: [],
    passedRules,
    trainingWeight: recordStatus === "confirmed" ? "high" : "medium",
  }
}

function buildExecutionResultFromMatchedSell({ stockCode, stockName, tsCode, matchedLots, sellFill, openQuantityAfter, generatedAt }) {
  const matchedQuantity = matchedLots.reduce((sum, item) => sum + item.quantity, 0)
  const buyCost = matchedLots.reduce((sum, item) => sum + item.quantity * item.buyFill.price, 0)
  const buyFees = matchedLots.reduce((sum, item) => sum + (item.buyFill.fees?.total ?? 0) * (item.quantity / item.buyFill.quantity), 0)
  const sellProceeds = matchedQuantity * sellFill.price
  const sellFees = (sellFill.fees?.total ?? 0) * (matchedQuantity / sellFill.quantity)
  const grossPnl = roundMoney(sellProceeds - buyCost)
  const netPnl = roundMoney((grossPnl ?? 0) - buyFees - sellFees)
  const entryDate = matchedLots[0]?.buyFill.tradeDate ?? sellFill.tradeDate
  const exitDate = sellFill.tradeDate
  const entryPrice = buyCost > 0 && matchedQuantity > 0 ? roundMoney(buyCost / matchedQuantity) : null
  const holdingDays = daysBetweenDates(entryDate, exitDate)
  const pnlScope = openQuantityAfter > 0 ? "partial_exit" : "closed_position"
  const positionState = openQuantityAfter > 0 ? "partial_exit" : "closed"
  const sourceRefs = [
    sourceRef("raw_delivery_note", matchedLots[0]?.buyFill.sourceRefs?.[0] ?? "", "entry_fill"),
    sourceRef("raw_delivery_note", sellFill.sourceRefs?.[0] ?? "", "exit_fill"),
  ].filter((item) => item.ref)
  const discrepancies = pnlScope === "partial_exit"
    ? [{
      field: "lotMatching.unmatchedQuantity",
      severity: "warning",
      summary: `Sold ${matchedQuantity} shares while ${openQuantityAfter} shares remained open after this exit.`,
      preferredSource: sellFill.sourceRefs?.[0] ?? null,
      resolution: "split_position_lifecycle",
      sourceRefs: sellFill.sourceRefs ?? [],
    }]
    : []
  const profitCredit = grossPnl !== null && grossPnl > 0 && pnlScope === "closed_position"
    ? "needs_review"
    : grossPnl !== null && grossPnl < 0 ? "failed_expectation_negative" : "needs_review"
  const qualityGate = qualityGateForExecutionResult({
    pnlScope,
    positionState,
    sourceRefs,
    discrepancies,
    pnlAbs: grossPnl,
    recordStatus: "reviewed",
  })
  return {
    schema: STOCK_FEEDBACK_EXECUTION_RESULT_SCHEMA,
    artifactId: `execres_real_${stockCode}_${entryDate?.replaceAll("-", "")}_${exitDate?.replaceAll("-", "")}_${shortHash(`${matchedQuantity}:${entryPrice}:${sellFill.price}`).slice(0, 6)}`,
    generatedAt,
    asOfDate: exitDate,
    ledgerKind: "real_trade",
    recordStatus: "reviewed",
    pnlScope,
    positionState,
    instrument: {
      stockCode,
      ...(tsCode ? { tsCode } : {}),
      stockName: stockName || stockCode,
      assetClass: "a_share",
    },
    tradeWindow: {
      entryDate,
      exitDate,
      holdingDays: holdingDays ?? 0,
      holdingDaysSource: "derived_from_trade_dates",
    },
    fills: [
      ...matchedLots.map((item) => ({
        fillId: item.buyFill.fillId,
        tradeDate: item.buyFill.tradeDate,
        ...(item.buyFill.tradeTime ? { tradeTime: item.buyFill.tradeTime } : {}),
        side: "buy",
        quantity: item.quantity,
        price: item.buyFill.price,
        amount: roundMoney(item.quantity * item.buyFill.price),
        fees: {
          commission: roundMoney((item.buyFill.fees?.commission ?? 0) * (item.quantity / item.buyFill.quantity)) ?? 0,
          stampTax: roundMoney((item.buyFill.fees?.stampTax ?? 0) * (item.quantity / item.buyFill.quantity)) ?? 0,
          transferFee: roundMoney((item.buyFill.fees?.transferFee ?? 0) * (item.quantity / item.buyFill.quantity)) ?? 0,
          other: roundMoney((item.buyFill.fees?.other ?? 0) * (item.quantity / item.buyFill.quantity)) ?? 0,
          total: roundMoney((item.buyFill.fees?.total ?? 0) * (item.quantity / item.buyFill.quantity)) ?? 0,
        },
        sourceRefs: item.buyFill.sourceRefs,
        valueQuality: "exact",
      })),
      {
        fillId: sellFill.fillId,
        tradeDate: sellFill.tradeDate,
        ...(sellFill.tradeTime ? { tradeTime: sellFill.tradeTime } : {}),
        side: "sell",
        quantity: matchedQuantity,
        price: sellFill.price,
        amount: roundMoney(sellProceeds),
        fees: {
          commission: roundMoney((sellFill.fees?.commission ?? 0) * (matchedQuantity / sellFill.quantity)) ?? 0,
          stampTax: roundMoney((sellFill.fees?.stampTax ?? 0) * (matchedQuantity / sellFill.quantity)) ?? 0,
          transferFee: roundMoney((sellFill.fees?.transferFee ?? 0) * (matchedQuantity / sellFill.quantity)) ?? 0,
          other: roundMoney((sellFill.fees?.other ?? 0) * (matchedQuantity / sellFill.quantity)) ?? 0,
          total: roundMoney(sellFees) ?? 0,
        },
        sourceRefs: sellFill.sourceRefs,
        valueQuality: "exact",
      },
    ],
    lotMatching: {
      method: "fifo",
      matchedQuantity,
      unmatchedQuantity: openQuantityAfter,
      notes: pnlScope === "partial_exit" ? "Partial exit: remaining position must be reconciled before high-weight training." : "FIFO matched from broker delivery-note fills.",
      matchedFillIds: [...matchedLots.map((item) => item.buyFill.fillId), sellFill.fillId],
    },
    prices: {
      entryPrice,
      exitPrice: sellFill.price,
      priceQuality: "exact",
    },
    pnl: {
      currency: "CNY",
      realizedGrossPnlAbs: grossPnl ?? 0,
      realizedNetPnlAbs: netPnl ?? grossPnl ?? 0,
      realizedPnlPct: buyCost > 0 && grossPnl !== null ? roundPct((grossPnl / buyCost) * 100) : 0,
      pnlQuality: "derived",
      fees: {
        commission: roundMoney(matchedLots.reduce((sum, item) => sum + (item.buyFill.fees?.commission ?? 0) * (item.quantity / item.buyFill.quantity), 0) + (sellFill.fees?.commission ?? 0) * (matchedQuantity / sellFill.quantity)) ?? 0,
        stampTax: roundMoney(matchedLots.reduce((sum, item) => sum + (item.buyFill.fees?.stampTax ?? 0) * (item.quantity / item.buyFill.quantity), 0) + (sellFill.fees?.stampTax ?? 0) * (matchedQuantity / sellFill.quantity)) ?? 0,
        transferFee: roundMoney(matchedLots.reduce((sum, item) => sum + (item.buyFill.fees?.transferFee ?? 0) * (item.quantity / item.buyFill.quantity), 0) + (sellFill.fees?.transferFee ?? 0) * (matchedQuantity / sellFill.quantity)) ?? 0,
        other: roundMoney(matchedLots.reduce((sum, item) => sum + (item.buyFill.fees?.other ?? 0) * (item.quantity / item.buyFill.quantity), 0) + (sellFill.fees?.other ?? 0) * (matchedQuantity / sellFill.quantity)) ?? 0,
        total: roundMoney(buyFees + sellFees) ?? 0,
      },
    },
    marketValidation: {
      provider: "unavailable",
      priceRangeChecks: [],
      sourceRefs: [],
    },
    attribution: {
      validationTarget: "expectation_trade",
      profitCredit,
      behaviorTags: ["collect_profit_feedback", "behavior", "skill", "tool_habit", "decision_strategy"],
    },
    evidence: {
      sourceRefs,
      evidenceSummary: "Broker delivery-note fills parsed and FIFO-matched; daily-review attribution and market path validation may be added by validate/review.",
      primaryEvidenceKind: "broker_delivery_note",
      sourceCoverage: {
        hasBrokerDeliveryNote: true,
        hasDailyReview: false,
        hasPositionTracking: false,
        hasMarketData: false,
      },
    },
    reconciliationPolicy: {
      primaryFactSource: "raw_delivery_note",
      positionTrackingRole: "summary_cross_check_only",
      conflictResolution: pnlScope === "partial_exit" ? "split_position_lifecycle" : "prefer_raw_delivery_note",
      suspiciousMarkers: pnlScope === "partial_exit" ? ["partial_exit_possible"] : [],
    },
    crossValidation: {
      status: discrepancies.length ? "passed_with_warnings" : "passed",
      checks: [{
        id: "broker_fill_fifo_match",
        status: "passed",
        summary: `Matched ${matchedQuantity} shares from broker delivery-note fills.`,
        sourceRefs: [...new Set(sourceRefs.map((item) => item.ref))],
      }],
      discrepancies,
    },
    qualityGate,
    trainingBoundary: executionResultTrainingBoundary({ pnlScope, pnlAbs: grossPnl, status: "reviewed", profitCredit }),
  }
}

function buildExecutionResultsFromFills(fills = [], { generatedAt }) {
  const byStock = new Map()
  for (const fill of fills) {
    const key = fill.stockCode
    if (!byStock.has(key)) byStock.set(key, [])
    byStock.get(key).push(fill)
  }
  const results = []
  for (const [stockCode, stockFills] of byStock) {
    const sorted = stockFills.slice().sort((a, b) => (
      String(a.tradeDate).localeCompare(String(b.tradeDate)) ||
      (a.side === "buy" ? -1 : 1) ||
      String(a.tradeTime ?? "").localeCompare(String(b.tradeTime ?? "")) ||
      a.fillId.localeCompare(b.fillId)
    ))
    const lots = []
    for (const fill of sorted) {
      if (fill.side === "buy") {
        lots.push({ buyFill: fill, remainingQuantity: fill.quantity })
        continue
      }
      let quantityToMatch = fill.quantity
      const matchedLots = []
      for (const lot of lots) {
        if (quantityToMatch <= 0) break
        if (lot.remainingQuantity <= 0) continue
        const matched = Math.min(lot.remainingQuantity, quantityToMatch)
        lot.remainingQuantity -= matched
        quantityToMatch -= matched
        matchedLots.push({ buyFill: lot.buyFill, quantity: matched })
      }
      if (matchedLots.length === 0) continue
      const openQuantityAfter = lots.reduce((sum, lot) => sum + lot.remainingQuantity, 0)
      const stockName = fill.stockName || matchedLots[0]?.buyFill.stockName || stockCode
      results.push(buildExecutionResultFromMatchedSell({
        stockCode,
        stockName,
        tsCode: toTushareCode(stockCode),
        matchedLots,
        sellFill: fill,
        openQuantityAfter,
        generatedAt,
      }))
    }
  }
  return results.sort((a, b) => (
    String(a.tradeWindow?.entryDate ?? "").localeCompare(String(b.tradeWindow?.entryDate ?? "")) ||
    String(a.tradeWindow?.exitDate ?? "").localeCompare(String(b.tradeWindow?.exitDate ?? "")) ||
    String(a.instrument?.stockCode ?? "").localeCompare(String(b.instrument?.stockCode ?? "")) ||
    a.artifactId.localeCompare(b.artifactId)
  ))
}

function parsePositionTrackingHoldingSnapshots(content, { projectPath, filePath, generatedAt }) {
  const rows = parseMarkdownTableRows(content)
  const relativePath = projectRelative(projectPath, filePath)
  const snapshots = []
  for (const { header, cells } of rows) {
    const stockCode = normalizeLocalStockCode(columnValue(header, cells, ["代码", "stockCode", "stock code"]))
    const stockName = compactString(columnValue(header, cells, ["标的", "股票", "名称", "stockName", "stock name"]), 80)
    const quantity = stripNumber(columnValue(header, cells, ["数量", "持仓", "shares", "quantity"]))
    const averageCost = stripNumber(columnValue(header, cells, ["成本", "成本价", "averageCost", "cost"]))
    const markPrice = stripNumber(columnValue(header, cells, ["当前", "收盘", "现价", "markPrice", "price"]))
    const floatingPnlAbs = stripNumber(columnValue(header, cells, ["浮动盈亏", "浮盈", "浮亏", "floating"]))
    if (!stockCode || !stockName || !quantity || !averageCost) continue
    const asOfDate = parseDateFromPath(content) ?? parseDateFromPath(filePath) ?? null
    const sourceRefs = [sourceRef("wiki_position_tracking", relativePath, "position_snapshot", "needs_review", {
      riskFlags: ["position_tracking_summary_only", "position_tracking_holding_snapshot_only"],
      note: "position-tracking holding snapshot is not realized PnL.",
    })]
    snapshots.push({
      schema: STOCK_FEEDBACK_EXECUTION_RESULT_SCHEMA,
      artifactId: `execres_snapshot_${stockCode}_${shortHash(`${relativePath}:${stockCode}:${quantity}:${averageCost}:${markPrice}`).slice(0, 8)}`,
      generatedAt,
      ...(asOfDate ? { asOfDate } : {}),
      ledgerKind: "broker_snapshot",
      recordStatus: "needs_review",
      pnlScope: "holding_snapshot",
      positionState: "open",
      instrument: {
        stockCode,
        ...(toTushareCode(stockCode) ? { tsCode: toTushareCode(stockCode) } : {}),
        stockName,
        assetClass: "a_share",
      },
      tradeWindow: {
        holdingDaysSource: "unknown",
      },
      lotMatching: {
        method: "unknown",
        matchedQuantity: 0,
        unmatchedQuantity: quantity,
        notes: "Holding snapshot only; no matched sell fill.",
        matchedFillIds: [],
      },
      prices: {
        averageCost,
        ...(markPrice ? { markPrice } : {}),
        priceQuality: "needs_review",
      },
      pnl: {
        currency: "CNY",
        ...(floatingPnlAbs !== null ? { floatingPnlAbs } : {}),
        pnlQuality: "needs_review",
      },
      marketValidation: {
        provider: "unavailable",
        priceRangeChecks: [],
        sourceRefs: [],
      },
      attribution: {
        validationTarget: "unknown",
        profitCredit: "needs_review",
        behaviorTags: ["risk_control"],
      },
      evidence: {
        sourceRefs,
        evidenceSummary: "Position-tracking holding snapshot; cannot become realized PnL without broker delivery-note exits.",
        primaryEvidenceKind: "position_tracking",
        sourceCoverage: {
          hasBrokerDeliveryNote: false,
          hasDailyReview: false,
          hasPositionTracking: true,
          hasMarketData: false,
        },
      },
      reconciliationPolicy: {
        primaryFactSource: "unknown",
        positionTrackingRole: "holding_snapshot_only",
        conflictResolution: "manual_review_required",
        suspiciousMarkers: ["holding_snapshot_not_realized"],
      },
      crossValidation: {
        status: "blocked",
        checks: [{
          id: "holding_snapshot_not_realized",
          status: "blocked",
          summary: "Holding snapshot cannot be treated as realized profit.",
          sourceRefs: [relativePath],
        }],
        discrepancies: [{
          field: "pnl.realizedGrossPnlAbs",
          severity: "blocking",
          summary: "No sell fill exists; floating PnL is not realized PnL.",
          preferredSource: relativePath,
          resolution: "manual_review_required",
          sourceRefs: [relativePath],
        }],
      },
      qualityGate: {
        status: "needs_reconciliation",
        humanReviewRequired: true,
        blockers: ["holding_snapshot_not_realized_pnl"],
        passedRules: ["position_tracking_snapshot_captured"],
        trainingWeight: "none",
      },
      trainingBoundary: executionResultTrainingBoundary({ pnlScope: "holding_snapshot", pnlAbs: null, status: "needs_review", profitCredit: "needs_review" }),
    })
  }
  return snapshots
}

async function importExecutionResultsFromDeliveryNotes(projectPath, options = {}) {
  const dates = compactStringArray(options.dates ?? DEFAULT_EXECUTION_RESULT_DELIVERY_DATES, 40, 24)
  const files = await listDeliveryNoteMarkdownFiles(projectPath, dates)
  const fills = []
  for (const filePath of files) {
    const content = await fs.readFile(filePath, "utf8").catch(() => "")
    fills.push(...parseDeliveryNoteMarkdown(content, { filePath, projectPath }))
  }
  const generatedAt = options.generatedAt ?? nowLocalTimestamp()
  return {
    files: files.map((filePath) => projectRelative(projectPath, filePath)),
    fills,
    executionResults: buildExecutionResultsFromFills(fills, { generatedAt }),
  }
}

async function importExecutionResultsFromPositionTracking(projectPath, options = {}) {
  const filePath = path.join(projectPath, "wiki", "position-tracking.md")
  const content = await fs.readFile(filePath, "utf8").catch(() => "")
  if (!content) return { files: [], executionResults: [] }
  return {
    files: [projectRelative(projectPath, filePath)],
    executionResults: parsePositionTrackingHoldingSnapshots(content, {
      projectPath,
      filePath,
      generatedAt: options.generatedAt ?? nowLocalTimestamp(),
    }),
  }
}

function latestExecutionResultStates(events = []) {
  const byId = new Map()
  for (const event of events) {
    const key = event.artifactId || `${event.artifactPath ?? "unknown"}:${event.artifactLine ?? 0}`
    const previous = byId.get(key)
    if (!previous || String(event.generatedAt ?? "") >= String(previous.generatedAt ?? "")) byId.set(key, event)
  }
  return [...byId.values()].sort((a, b) => (
    String(b.generatedAt ?? "").localeCompare(String(a.generatedAt ?? "")) ||
    String(a.artifactId ?? "").localeCompare(String(b.artifactId ?? ""))
  ))
}

async function readStockFeedbackExecutionResultEvents(projectPath) {
  return readStockFeedbackJsonlFamily(normalizePath(projectPath), "execution-results", STOCK_FEEDBACK_EXECUTION_RESULT_SCHEMA)
}

export async function readStockFeedbackExecutionResults(projectPath) {
  return latestExecutionResultStates(await readStockFeedbackExecutionResultEvents(projectPath))
}

function validateExecutionResultRecord(record = {}) {
  const issues = []
  if (record.schema !== STOCK_FEEDBACK_EXECUTION_RESULT_SCHEMA) issues.push({ severity: "error", code: "unexpected_execution_result_schema", id: record.artifactId ?? null })
  if (!record.artifactId) issues.push({ severity: "error", code: "execution_result_missing_artifact_id", id: null })
  if (!record.instrument?.stockCode || !record.instrument?.stockName) issues.push({ severity: "error", code: "execution_result_missing_instrument", id: record.artifactId ?? null })
  const sourceRefs = record.evidence?.sourceRefs ?? []
  if (!Array.isArray(sourceRefs) || sourceRefs.length === 0) issues.push({ severity: "error", code: "execution_result_missing_source_refs", id: record.artifactId ?? null })
  const hasBrokerDeliveryNote = sourceRefs.some((ref) => ref.kind === "raw_delivery_note")
  if (record.ledgerKind === "real_trade" && ["closed_position", "matched_lot", "partial_exit"].includes(record.pnlScope) && !hasBrokerDeliveryNote) {
    issues.push({ severity: "error", code: "execution_result_real_trade_missing_delivery_note", id: record.artifactId ?? null })
  }
  if (record.pnlScope === "holding_snapshot" && (record.pnl?.realizedGrossPnlAbs !== undefined || record.pnl?.realizedNetPnlAbs !== undefined || record.pnl?.realizedPnlPct !== undefined)) {
    issues.push({ severity: "error", code: "execution_result_holding_snapshot_has_realized_pnl", id: record.artifactId ?? null })
  }
  if (record.qualityGate?.status === "confirmed") {
    if (record.pnlScope === "holding_snapshot" || record.pnlScope === "account_daily") {
      issues.push({ severity: "error", code: "execution_result_confirmed_non_realized_scope", id: record.artifactId ?? null, pnlScope: record.pnlScope })
    }
    if (record.ledgerKind === "real_trade" && !hasBrokerDeliveryNote) {
      issues.push({ severity: "error", code: "execution_result_confirmed_without_delivery_note", id: record.artifactId ?? null })
    }
  }
  if (record.trainingBoundary?.loraFactPolicy !== "no_raw_facts" && record.trainingBoundary?.loraFactPolicy !== "references_only") {
    issues.push({ severity: "error", code: "execution_result_missing_lora_fact_policy", id: record.artifactId ?? null })
  }
  const leak = hasRawFactLeak(record)
  if (leak) issues.push({ severity: "error", code: "execution_result_contains_raw_fact_body", id: record.artifactId ?? null, ...leak })
  return issues
}

async function validateExecutionResultsWithMarketData(records = [], options = {}) {
  if (!options.autoMarketEvidence && !options["auto-market-evidence"]) return records
  const validated = []
  for (const record of records) {
    if (record.ledgerKind !== "real_trade" || !record.tradeWindow?.entryDate) {
      validated.push(record)
      continue
    }
    const market = await derivePaperTradeMarketEvidenceFromTushare({
      stockCode: record.instrument?.tsCode ?? record.instrument?.stockCode,
      entryDate: record.tradeWindow.entryDate,
      entryPrice: record.prices?.entryPrice ?? null,
      exitDate: record.tradeWindow.exitDate,
      options,
    })
    const marketEvidence = market.marketEvidence
    if (!marketEvidence) {
      validated.push({
        ...record,
        marketValidation: {
          provider: market.provider === "tushare" ? "tushare" : "unavailable",
          priceRangeChecks: record.marketValidation?.priceRangeChecks ?? [],
          sourceRefs: [],
        },
        evidence: {
          ...record.evidence,
          sourceRefs: [
            ...(record.evidence?.sourceRefs ?? []),
            sourceRef("market_data", `tushare:daily#${record.instrument?.tsCode ?? record.instrument?.stockCode}/${record.tradeWindow?.entryDate ?? ""}`, "market_validation", "unknown", {
              reliability: "medium",
              riskFlags: ["market_data_unavailable"],
              note: market.warning ?? "market validation unavailable",
            }),
          ],
          sourceCoverage: {
            ...(record.evidence?.sourceCoverage ?? {}),
            hasMarketData: false,
          },
        },
      })
      continue
    }
    const entryRange = marketEvidence.entryRow
      ? {
        tradeDate: record.tradeWindow.entryDate,
        price: record.prices?.entryPrice ?? 0,
        low: firstFiniteNumber(marketEvidence.entryRow.low),
        high: firstFiniteNumber(marketEvidence.entryRow.high),
        inRange: (record.prices?.entryPrice ?? 0) >= firstFiniteNumber(marketEvidence.entryRow.low) && (record.prices?.entryPrice ?? 0) <= firstFiniteNumber(marketEvidence.entryRow.high),
        ref: marketEvidence.priceSqlRef ?? null,
        note: "entry price checked against Tushare daily range",
      }
      : null
    const exitRange = marketEvidence.exitRow && record.tradeWindow.exitDate
      ? {
        tradeDate: record.tradeWindow.exitDate,
        price: record.prices?.exitPrice ?? 0,
        low: firstFiniteNumber(marketEvidence.exitRow.low),
        high: firstFiniteNumber(marketEvidence.exitRow.high),
        inRange: (record.prices?.exitPrice ?? 0) >= firstFiniteNumber(marketEvidence.exitRow.low) && (record.prices?.exitPrice ?? 0) <= firstFiniteNumber(marketEvidence.exitRow.high),
        ref: marketEvidence.priceSqlRef ?? null,
        note: "exit price checked against Tushare daily range",
      }
      : null
    validated.push({
      ...record,
      marketValidation: {
        provider: "tushare",
        priceRangeChecks: [entryRange, exitRange].filter(Boolean),
        maxDrawdownPct: firstFiniteNumber(marketEvidence.maxDrawdownInHolding) ?? undefined,
        followThrough: {
          return1dPct: firstFiniteNumber(marketEvidence.followThrough1d) ?? undefined,
          return3dPct: firstFiniteNumber(marketEvidence.followThrough3d) ?? undefined,
          return5dPct: firstFiniteNumber(marketEvidence.followThrough5d) ?? undefined,
        },
        relativeStrength: marketEvidence.relativeStrength !== null && marketEvidence.relativeStrength !== undefined
          ? {
            benchmarkCode: marketEvidence.benchmarkCode ?? "000001.SH",
            excessReturnPct: marketEvidence.relativeStrength,
            basis: marketEvidence.relativeStrengthBasis ?? "excess_return_pct",
          }
          : undefined,
        turnoverChange: firstFiniteNumber(marketEvidence.turnoverChange) ?? undefined,
        sourceRefs: compactStringArray([marketEvidence.priceSqlRef, marketEvidence.marketDataRef, marketEvidence.benchmarkRef], 8, 220),
      },
      evidence: {
        ...record.evidence,
        sourceRefs: [
          ...(record.evidence?.sourceRefs ?? []),
          sourceRef("market_data", marketEvidence.priceSqlRef ?? marketEvidence.marketDataRef ?? "tushare:daily", "market_validation", "derived"),
        ],
        sourceCoverage: {
          ...(record.evidence?.sourceCoverage ?? {}),
          hasMarketData: true,
        },
      },
    })
  }
  return validated
}

function executionResultImportSource(options = {}) {
  const fromDeliveryNotes = Boolean(options.fromDeliveryNotes ?? options["from-delivery-notes"])
  const fromPositionTracking = Boolean(options.fromPositionTracking ?? options["from-position-tracking"])
  if (!fromDeliveryNotes && !fromPositionTracking) {
    return { fromDeliveryNotes: true, fromPositionTracking: true }
  }
  return { fromDeliveryNotes, fromPositionTracking }
}

export async function importStockFeedbackExecutionResults(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const generatedAt = options.generatedAt ?? nowLocalTimestamp()
  const source = executionResultImportSource(options)
  const batches = []
  if (source.fromDeliveryNotes) batches.push(await importExecutionResultsFromDeliveryNotes(projectPath, { ...options, generatedAt }))
  if (source.fromPositionTracking) batches.push(await importExecutionResultsFromPositionTracking(projectPath, { ...options, generatedAt }))
  const executionResults = batches.flatMap((batch) => batch.executionResults ?? [])
  const files = [...new Set(batches.flatMap((batch) => batch.files ?? []))].sort()
  const fills = batches.flatMap((batch) => batch.fills ?? [])
  const validatedResults = await validateExecutionResultsWithMarketData(executionResults, options)
  const issues = validatedResults.flatMap((record) => validateExecutionResultRecord(record))
  const manifest = {
    schema: "research-os-execution-result-manifest-v1",
    generatedAt,
    projectPath,
    count: validatedResults.length,
    fillCount: fills.length,
    sourceFiles: files,
    sources: [
      source.fromDeliveryNotes ? "raw/交割单/*.md" : "",
      source.fromPositionTracking ? "wiki/position-tracking.md" : "",
    ].filter(Boolean),
    issueCount: issues.length,
    writeBoundary: {
      root: STOCK_FEEDBACK_ROOT,
      family: "execution-results",
      wroteWiki: false,
      wroteRaw: false,
      wroteBrain: false,
      wroteRealTradeLedger: false,
    },
  }
  let writeResult = null
  if (options.write) {
    writeResult = await writeJsonlWithManifest({
      projectPath,
      family: "execution-results",
      baseName: "stock-feedback-execution-results",
      records: validatedResults,
      manifest,
      generatedAt,
    })
  }
  return {
    schema: "stock-feedback-execution-result-import-result-v1",
    mode: "stock-feedback-execution-result-import",
    dryRun: !Boolean(options.write),
    projectPath,
    generatedAt,
    source,
    files,
    fills,
    fillCount: fills.length,
    executionResults: validatedResults,
    count: validatedResults.length,
    issues,
    manifest,
    writeResult: writeResult ? { executionResults: writeResult.jsonl, manifest: writeResult.manifest } : null,
    writePolicy: {
      wroteWiki: false,
      wroteRaw: false,
      wroteBrain: false,
      wroteRealTradeLedger: false,
      wroteArtifacts: Boolean(options.write),
      allowedRoot: STOCK_FEEDBACK_ROOT,
    },
  }
}

export async function validateStockFeedbackExecutionResults(options = {}) {
  const imported = await importStockFeedbackExecutionResults({
    ...options,
    fromDeliveryNotes: options.fromDeliveryNotes ?? options["from-delivery-notes"] ?? true,
    fromPositionTracking: options.fromPositionTracking ?? options["from-position-tracking"] ?? true,
  })
  return {
    ...imported,
    schema: "stock-feedback-execution-result-validate-result-v1",
    mode: "stock-feedback-execution-result-validate",
  }
}

function executionResultMatchesFilters(record = {}, filters = {}) {
  const status = compactString(filters.status, 80)
  if (status && record.recordStatus !== status && record.qualityGate?.status !== status) return false
  const stock = compactString(filters.stock ?? filters["stock-code"] ?? "", 80).toLowerCase()
  if (stock && !collectSearchText(record.instrument).includes(stock)) return false
  const scope = compactString(filters.pnlScope ?? filters["pnl-scope"] ?? "", 80)
  if (scope && record.pnlScope !== scope) return false
  return true
}

export async function listStockFeedbackExecutionResults(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const limit = parsePositiveInteger(options.limit ?? options["max-results"], 100)
  const executionResults = (await readStockFeedbackExecutionResults(projectPath))
    .filter((record) => executionResultMatchesFilters(record, options))
    .slice(0, limit)
  return {
    schema: "stock-feedback-execution-result-list-result-v1",
    mode: "stock-feedback-execution-result-list",
    projectPath,
    returned: executionResults.length,
    limit,
    executionResults,
    counts: {
      total: executionResults.length,
      confirmed: executionResults.filter((item) => item.recordStatus === "confirmed").length,
      needsReconciliation: executionResults.filter((item) => item.qualityGate?.status === "needs_reconciliation").length,
      realTrade: executionResults.filter((item) => item.ledgerKind === "real_trade").length,
      holdingSnapshot: executionResults.filter((item) => item.pnlScope === "holding_snapshot").length,
    },
    writePolicy: {
      readOnly: true,
      wroteWiki: false,
      wroteRaw: false,
      wroteBrain: false,
      wroteArtifacts: false,
    },
  }
}

function applyExecutionResultReviewAction(record = {}, action, { reviewer, note, generatedAt }) {
  const next = structuredClone(record)
  next.generatedAt = generatedAt
  const reviewNote = compactString([
    action,
    reviewer ? `reviewer:${reviewer}` : "",
    note ? `note:${note}` : "",
  ].filter(Boolean).join("; "), 500)
  if (action === "confirm_realized_execution") {
    if (!["closed_position", "matched_lot"].includes(next.pnlScope) || next.ledgerKind !== "real_trade") {
      next.recordStatus = "needs_review"
      next.qualityGate = {
        status: "needs_reconciliation",
        humanReviewRequired: true,
        blockers: ["confirm_requires_real_trade_closed_position_or_matched_lot"],
        passedRules: next.qualityGate?.passedRules ?? [],
        trainingWeight: "none",
      }
      next.trainingBoundary = executionResultTrainingBoundary({ pnlScope: next.pnlScope, pnlAbs: next.pnl?.realizedGrossPnlAbs, status: next.recordStatus, profitCredit: next.attribution?.profitCredit })
      return next
    }
    next.recordStatus = "confirmed"
    const positive = firstFiniteNumber(next.pnl?.realizedGrossPnlAbs, next.pnl?.realizedNetPnlAbs) > 0
    next.attribution = {
      ...(next.attribution ?? {}),
      validationTarget: next.attribution?.validationTarget ?? "expectation_trade",
      profitCredit: positive ? "real_pattern_execution_supported" : "failed_expectation_negative",
      ...(next.attribution?.exitReason || reviewNote ? { exitReason: next.attribution?.exitReason ?? reviewNote } : {}),
      behaviorTags: positive
        ? ["collect_profit_feedback", "behavior", "skill", "tool_habit", "decision_strategy"]
        : ["risk_control", "post_mortem", "decision_strategy"],
    }
    next.qualityGate = qualityGateForExecutionResult({
      pnlScope: next.pnlScope,
      positionState: next.positionState,
      sourceRefs: next.evidence?.sourceRefs ?? [],
      discrepancies: next.crossValidation?.discrepancies ?? [],
      pnlAbs: next.pnl?.realizedGrossPnlAbs,
      recordStatus: "confirmed",
    })
  } else if (action === "mark_partial_exit") {
    next.recordStatus = "reviewed"
    next.pnlScope = "partial_exit"
    next.positionState = "partial_exit"
    next.qualityGate = {
      status: "needs_reconciliation",
      humanReviewRequired: true,
      blockers: ["partial_exit_lifecycle_not_closed"],
      passedRules: next.qualityGate?.passedRules ?? [],
      trainingWeight: "low",
    }
    next.reconciliationPolicy = {
      ...(next.reconciliationPolicy ?? {}),
      primaryFactSource: next.reconciliationPolicy?.primaryFactSource ?? "raw_delivery_note",
      positionTrackingRole: next.reconciliationPolicy?.positionTrackingRole ?? "summary_cross_check_only",
      conflictResolution: "split_position_lifecycle",
      suspiciousMarkers: [...new Set([...(next.reconciliationPolicy?.suspiciousMarkers ?? []), "partial_exit_possible"])],
    }
  } else if (action === "mark_holding_snapshot_only") {
    next.recordStatus = "reviewed"
    next.pnlScope = "holding_snapshot"
    next.positionState = "open"
    next.qualityGate = {
      status: "needs_reconciliation",
      humanReviewRequired: true,
      blockers: ["holding_snapshot_not_realized_pnl"],
      passedRules: ["holding_snapshot_classified"],
      trainingWeight: "none",
    }
  } else if (action === "mark_needs_reconciliation") {
    next.recordStatus = "needs_review"
    next.qualityGate = {
      status: "needs_reconciliation",
      humanReviewRequired: true,
      blockers: [...new Set([...(next.qualityGate?.blockers ?? []), "manual_reconciliation_required"])],
      passedRules: next.qualityGate?.passedRules ?? [],
      trainingWeight: "none",
    }
  } else if (action === "reject_execution_result") {
    next.recordStatus = "rejected"
    next.qualityGate = {
      status: "rejected",
      humanReviewRequired: false,
      blockers: ["rejected_by_human_review"],
      passedRules: [],
      trainingWeight: "none",
    }
  }
  next.trainingBoundary = executionResultTrainingBoundary({
    pnlScope: next.pnlScope,
    pnlAbs: next.pnl?.realizedGrossPnlAbs,
    status: next.recordStatus,
    profitCredit: next.attribution?.profitCredit,
  })
  return next
}

export async function reviewStockFeedbackExecutionResult(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const artifactId = compactString(options.artifactId ?? options["artifact-id"] ?? options.id, 200)
  if (!artifactId) throw new Error("stock-feedback execution-result review requires --artifact-id")
  const action = parseStockFeedbackExecutionResultReviewAction(options.action)
  const generatedAt = options.generatedAt ?? nowLocalTimestamp()
  const records = await readStockFeedbackExecutionResults(projectPath)
  const record = records.find((item) => item.artifactId === artifactId)
  if (!record) throw new Error(`Execution result not found: ${artifactId}`)
  const reviewed = applyExecutionResultReviewAction(record, action, {
    reviewer: options.reviewer,
    note: options.note,
    generatedAt,
  })
  const issues = validateExecutionResultRecord(reviewed)
  let writeResult = null
  if (options.write) {
    writeResult = await writeJsonlWithManifest({
      projectPath,
      family: "execution-results",
      baseName: "stock-feedback-execution-results",
      records: [reviewed],
      manifest: {
        schema: "research-os-execution-result-review-manifest-v1",
        generatedAt,
        projectPath,
        count: 1,
        action,
        artifactId,
        issueCount: issues.length,
        writeBoundary: {
          root: STOCK_FEEDBACK_ROOT,
          family: "execution-results",
          wroteWiki: false,
          wroteRaw: false,
          wroteBrain: false,
          wroteRealTradeLedger: false,
        },
      },
      generatedAt,
    })
  }
  return {
    schema: "stock-feedback-execution-result-review-result-v1",
    mode: "stock-feedback-execution-result-review",
    dryRun: !Boolean(options.write),
    projectPath,
    generatedAt,
    action,
    executionResult: reviewed,
    issues,
    writeResult: writeResult ? { executionResult: writeResult.jsonl, manifest: writeResult.manifest } : null,
    writePolicy: {
      wroteWiki: false,
      wroteRaw: false,
      wroteBrain: false,
      wroteRealTradeLedger: false,
      wroteArtifacts: Boolean(options.write),
      allowedRoot: STOCK_FEEDBACK_ROOT,
    },
  }
}

export async function verifyStockFeedbackExecutionResults(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const executionResults = await readStockFeedbackExecutionResults(projectPath)
  const issues = executionResults.flatMap((record) => validateExecutionResultRecord(record))
  const errorCount = issues.filter((item) => item.severity === "error").length
  return {
    schema: "stock-feedback-execution-result-verify-result-v1",
    mode: "stock-feedback-execution-result-verify",
    projectPath,
    status: errorCount > 0 ? "failed" : "ok",
    checked: {
      executionResults: executionResults.length,
    },
    issueCount: issues.length,
    errorCount,
    issues,
  }
}

function isActionableExecutionResultReview(record = {}) {
  if (!record.artifactId) return false
  if (record.recordStatus === "confirmed" || record.recordStatus === "rejected") return false
  if (record.recordStatus === "reviewed" && record.pnlScope === "holding_snapshot") return false
  if (record.recordStatus === "reviewed" && record.pnlScope === "partial_exit") return false
  if (record.qualityGate?.status === "review_ready") return true
  if (record.recordStatus === "needs_review") return true
  if (record.qualityGate?.status === "needs_reconciliation") return true
  return false
}

function countExecutionResultsBy(records = [], selector) {
  const counts = {}
  for (const record of records) {
    const values = selector(record)
    for (const value of Array.isArray(values) ? values : [values]) {
      const key = compactString(value ?? "unknown", 120) || "unknown"
      counts[key] = (counts[key] ?? 0) + 1
    }
  }
  return counts
}

function buildExecutionResultReconciliationAudit(executionResults = []) {
  const reconciliationResults = executionResults.filter((item) => item.qualityGate?.status === "needs_reconciliation")
  const actionableReviews = reconciliationResults.filter(isActionableExecutionResultReview)
  const reviewedNonActionable = reconciliationResults.filter((item) => !isActionableExecutionResultReview(item) && item.recordStatus === "reviewed")
  const reviewedPartialExit = reviewedNonActionable.filter((item) => item.pnlScope === "partial_exit")
  const reviewedHoldingSnapshot = reviewedNonActionable.filter((item) => item.pnlScope === "holding_snapshot")
  return {
    schema: "stock-feedback-execution-result-reconciliation-audit-v1",
    status: actionableReviews.length > 0
      ? "action_required"
      : reconciliationResults.length > 0
        ? "reviewed_non_actionable"
        : "clear",
    summary: actionableReviews.length > 0
      ? "存在仍需人工复核的 execution-result reconciliation。"
      : reconciliationResults.length > 0
        ? "剩余 reconciliation 均已复核：分批/半仓退出保留低权重，持仓快照不作为 realized PnL。"
        : "没有 execution-result reconciliation 缺口。",
    counts: {
      total: reconciliationResults.length,
      actionableReviews: actionableReviews.length,
      reviewedNonActionable: reviewedNonActionable.length,
      reviewedPartialExit: reviewedPartialExit.length,
      reviewedHoldingSnapshot: reviewedHoldingSnapshot.length,
      trainingWeightLow: reconciliationResults.filter((item) => item.qualityGate?.trainingWeight === "low").length,
      trainingWeightNone: reconciliationResults.filter((item) => item.qualityGate?.trainingWeight === "none").length,
    },
    byRecordStatus: countExecutionResultsBy(reconciliationResults, (item) => item.recordStatus),
    byPnlScope: countExecutionResultsBy(reconciliationResults, (item) => item.pnlScope),
    byPositionState: countExecutionResultsBy(reconciliationResults, (item) => item.positionState),
    byBlocker: countExecutionResultsBy(reconciliationResults, (item) => item.qualityGate?.blockers ?? []),
    samples: reconciliationResults.slice(0, 12).map((item) => ({
      artifactId: item.artifactId ?? null,
      stock: item.instrument ? { code: item.instrument.stockCode, name: item.instrument.stockName } : null,
      recordStatus: item.recordStatus ?? null,
      pnlScope: item.pnlScope ?? null,
      positionState: item.positionState ?? null,
      qualityGateStatus: item.qualityGate?.status ?? null,
      blockers: item.qualityGate?.blockers ?? [],
      trainingWeight: item.qualityGate?.trainingWeight ?? null,
      nextAction: isActionableExecutionResultReview(item)
        ? "review_or_reconcile_execution_result"
        : item.pnlScope === "partial_exit"
          ? "keep_low_weight_until_full_lifecycle_closes"
          : item.pnlScope === "holding_snapshot"
            ? "exclude_from_realized_pnl_training"
            : "no_action_required",
    })),
  }
}

function executionEvidenceClassFromResult(result = {}) {
  const profitCredit = result.attribution?.profitCredit
  if (profitCredit === "real_pattern_execution_supported") return "real_pattern_execution_supported"
  if (profitCredit === "priced_in_late_entry") return "real_priced_in_late_entry"
  if (profitCredit === "entry_wrong") return "real_entry_wrong"
  if (profitCredit === "failed_expectation_negative") return "real_failed_expectation_negative"
  const pnlAbs = firstFiniteNumber(result.pnl?.realizedGrossPnlAbs, result.pnl?.realizedNetPnlAbs)
  if (pnlAbs !== null && pnlAbs < 0) return "real_failed_expectation_negative"
  if (pnlAbs !== null && pnlAbs > 0) return "real_pattern_execution_needs_review"
  return "real_execution_unclassified"
}

function qualityGateForExecutionTrajectory(result = {}) {
  if (result.qualityGate?.status === "confirmed" && ["closed_position", "matched_lot"].includes(result.pnlScope)) {
    const pnlAbs = firstFiniteNumber(result.pnl?.realizedGrossPnlAbs, result.pnl?.realizedNetPnlAbs)
    if (pnlAbs !== null && pnlAbs > 0) {
      return {
        status: "expectation_validated",
        validationTarget: "expectation_trade",
        highConfidenceEligible: true,
        requiredAction: null,
        reasons: ["confirmed_real_trade_profit", "broker_delivery_note_matched"],
        evidenceResultIds: [result.artifactId].filter(Boolean),
      }
    }
    if (pnlAbs !== null && pnlAbs < 0) {
      return {
        status: "disconfirmed_validated",
        validationTarget: "disconfirmation",
        highConfidenceEligible: true,
        requiredAction: "route_to_negative_eval",
        reasons: ["confirmed_real_trade_loss", "broker_delivery_note_matched"],
        evidenceResultIds: [result.artifactId].filter(Boolean),
      }
    }
  }
  if (result.qualityGate?.status === "needs_reconciliation" || result.pnlScope === "partial_exit") {
    return {
      status: "needs_evidence",
      validationTarget: "expectation_trade",
      highConfidenceEligible: false,
      requiredAction: "reconcile_execution_result",
      reasons: ["execution_result_needs_reconciliation", result.pnlScope === "partial_exit" ? "partial_exit_not_full_lifecycle" : ""].filter(Boolean),
      evidenceResultIds: [result.artifactId].filter(Boolean),
    }
  }
  return {
    status: "review_required",
    validationTarget: "expectation_trade",
    highConfidenceEligible: false,
    requiredAction: "human_review_execution_result",
    reasons: ["execution_result_review_required"],
    evidenceResultIds: [result.artifactId].filter(Boolean),
  }
}

function marketPatternsForExecutionResult(result = {}, target) {
  const credit = result.attribution?.profitCredit
  if (credit === "priced_in_late_entry") return [marketPatternSummary("priced_in_late_entry")].filter(Boolean)
  if (credit === "failed_expectation_negative") return [marketPatternSummary("failed_catalyst_one_day_hype")].filter(Boolean)
  if (target === "disconfirmation") return [marketPatternSummary("failed_catalyst_one_day_hype")].filter(Boolean)
  return [marketPatternSummary("event_expectation_front_run")].filter(Boolean)
}

function profitFeedbackFromExecutionResult(result = {}) {
  const pnlAbs = firstFiniteNumber(result.pnl?.realizedGrossPnlAbs, result.pnl?.realizedNetPnlAbs)
  const outcome = pnlAbs === null
    ? "unknown"
    : pnlAbs > 0 ? "profitable" : pnlAbs < 0 ? "loss" : "flat"
  return {
    outcome,
    executionMode: "real",
    ledgerKind: "real_trade",
    executionEvidenceClass: executionEvidenceClassFromResult(result),
    realizedPnlAbs: pnlAbs,
    realizedPnlPct: result.pnl?.realizedPnlPct ?? null,
    maxDrawdownPct: result.marketValidation?.maxDrawdownPct ?? null,
    holdingDays: result.tradeWindow?.holdingDays ?? null,
    entryTiming: result.attribution?.entryReason ?? null,
    positionSizing: result.lotMatching?.matchedQuantity ? `matchedQuantity=${result.lotMatching.matchedQuantity}` : null,
    exitTiming: result.attribution?.exitReason ?? null,
  }
}

function trajectoryFromExecutionResult(result = {}, { generatedAt }) {
  const qualityGate = qualityGateForExecutionTrajectory(result)
  const target = qualityGate.validationTarget ?? "expectation_trade"
  const marketPatterns = marketPatternsForExecutionResult(result, target)
  const profitFeedback = attachProfitCreditAssignment(
    profitFeedbackFromExecutionResult(result),
    { target, qualityGate, marketPatterns },
  )
  const distillationSignals = distillationSignalsForTrajectory({
    target,
    qualityGate,
    marketPatterns,
    profitFeedback,
  })
  const sourceRefs = [
    result.artifactPath,
    ...compactStringArray((result.evidence?.sourceRefs ?? []).map((ref) => ref.ref), 20, 260),
    ...compactStringArray(result.marketValidation?.sourceRefs, 10, 220),
  ].filter(Boolean)
  const trajectory = {
    schema: STOCK_FEEDBACK_TRAJECTORY_SCHEMA,
    id: `stockfb_${shortHash(`${result.artifactId}:execution_result:${target}`)}`,
    generatedAt,
    source: "stock-feedback-execution-result",
    sourceRecordId: result.artifactId,
    validationTarget: target,
    validationTargetLabel: TARGET_TO_LABEL[target],
    qualityGate,
    adapterCapability: TARGET_TO_CAPABILITY[target],
    trainingUse: profitFeedback.outcome === "loss" || target === "disconfirmation" ? ["eval", "preference"] : ["eval", "sft"],
    questionRecordId: result.attribution?.hypothesisId ?? null,
    validationId: null,
    questionId: result.attribution?.hypothesisId ?? null,
    hypothesis: compactString(result.attribution?.hypothesisText || `${result.instrument?.stockName ?? result.instrument?.stockCode} 真实交易执行结果`, 600),
    question: compactString(result.attribution?.expectedMove || result.attribution?.entryReason || "", 600),
    stock: {
      name: compactString(result.instrument?.stockName, 80),
      code: compactString(result.instrument?.stockCode, 32),
      label: compactString([result.instrument?.stockName, result.instrument?.stockCode].filter(Boolean).join(" "), 120),
    },
    eventTimeline: [
      { step: "real_trade_entry", at: result.tradeWindow?.entryDate ?? null, ref: result.artifactId },
      { step: "real_trade_exit", at: result.tradeWindow?.exitDate ?? null, ref: result.artifactId },
      { step: "execution_result_recorded", at: result.generatedAt ?? generatedAt, ref: result.artifactId },
    ].filter((item) => item.at || item.ref),
    marketValidation: {
      status: result.positionState ?? "unknown",
      verdict: compactString([
        `ledger:${result.ledgerKind}`,
        `scope:${result.pnlScope}`,
        profitFeedback.outcome ? `outcome:${profitFeedback.outcome}` : "",
        result.pnl?.realizedPnlPct !== undefined ? `pnl:${result.pnl.realizedPnlPct}%` : "",
        result.marketValidation?.maxDrawdownPct !== undefined ? `max_drawdown:${result.marketValidation.maxDrawdownPct}%` : "",
      ].filter(Boolean).join(" / "), 180),
      refs: sourceRefs,
      marketEvidence: result.marketValidation ?? null,
      signals: [
        `ledger_kind:${result.ledgerKind}`,
        `pnl_scope:${result.pnlScope}`,
        `execution_evidence:${profitFeedback.executionEvidenceClass}`,
        result.qualityGate?.status ? `execution_quality:${result.qualityGate.status}` : "",
      ].filter(Boolean),
    },
    marketPatterns,
    profitFeedback,
    distillationSignals,
    evidenceState: {
      attributionLabel: result.attribution?.profitCredit ?? null,
      confidenceImpact: result.recordStatus === "confirmed" ? "confirmed_real_execution_result" : "real_execution_result_needs_human_review",
      nextAction: qualityGate.requiredAction,
      evidenceGaps: qualityGate.status === "needs_evidence" ? (result.qualityGate?.blockers ?? ["execution_result_needs_evidence"]) : [],
      confirmedEvidenceRefs: sourceRefs,
      fundamentalEvidenceConfirmed: false,
      executionResultId: result.artifactId,
      ledgerKind: result.ledgerKind,
      pnlScope: result.pnlScope,
      positionState: result.positionState,
    },
    routing: {
      eval: true,
      sft: qualityGate.status === "expectation_validated" && profitFeedback.outcome === "profitable",
      preference: qualityGate.status === "disconfirmed_validated" || profitFeedback.outcome === "loss",
      adapterCandidate: qualityGate.highConfidenceEligible === true && result.recordStatus === "confirmed" && profitFeedback.outcome === "profitable",
    },
    executionResultState: {
      ledgerKind: result.ledgerKind,
      recordStatus: result.recordStatus,
      pnlScope: result.pnlScope,
      positionState: result.positionState,
      artifactId: result.artifactId,
      sourceCoverage: result.evidence?.sourceCoverage ?? null,
      reconciliationPolicy: result.reconciliationPolicy ?? null,
      crossValidationStatus: result.crossValidation?.status ?? null,
      executionEvidenceClass: profitFeedback.executionEvidenceClass,
    },
    executionPriceHint: {
      source: "research-os-execution-result-v1",
      entryPrice: firstFiniteNumber(result.prices?.entryPrice),
      exitPrice: firstFiniteNumber(result.prices?.exitPrice),
      priceQuality: result.prices?.priceQuality ?? null,
      sourceRefs: sourceRefs.slice(0, 6),
    },
    sourceRefs: [...new Set(sourceRefs)].slice(0, 30),
    summary: compactString([
      `${result.instrument?.stockName ?? result.instrument?.stockCode} ${result.pnlScope}`,
      profitFeedback.outcome ? `真实交易结果：${profitFeedback.outcome}` : "",
      result.pnl?.realizedPnlPct !== undefined ? `收益 ${result.pnl.realizedPnlPct}%` : "",
      result.pnl?.realizedGrossPnlAbs !== undefined ? `盈亏 ${result.pnl.realizedGrossPnlAbs}` : "",
      result.tradeWindow?.holdingDays !== undefined ? `持有 ${result.tradeWindow.holdingDays} 天` : "",
      result.attribution?.entryReason ? `买入：${result.attribution.entryReason}` : "",
      result.attribution?.exitReason ? `卖出：${result.attribution.exitReason}` : "",
    ].filter(Boolean).join("；"), 700),
  }
  return {
    ...trajectory,
    distillationPlan: distillationPlanForTrajectory(trajectory),
  }
}

function stockFeedbackTrajectoriesFromExecutionResults(executionResults = [], options = {}) {
  const generatedAt = options.generatedAt ?? nowLocalTimestamp()
  return executionResults
    .filter((item) => item && typeof item === "object" && item.schema === STOCK_FEEDBACK_EXECUTION_RESULT_SCHEMA)
    .filter((item) => item.recordStatus !== "rejected")
    .map((item) => trajectoryFromExecutionResult(item, { generatedAt }))
}

function paperTradeExecutionEvidenceClass(profitFeedback = {}) {
  if (profitFeedback.outcome === "profitable") return "paper_pattern_execution_supported"
  if (["loss", "direction_right_entry_risk"].includes(profitFeedback.outcome)) return "paper_execution_risk_negative"
  if (profitFeedback.outcome === "failed_or_unprofitable") return "paper_failed_expectation_negative"
  return "paper_execution_unsettled"
}

function paperTradePricedInRiskEvidence(trade = {}) {
  const microstructure = trade.marketMicrostructureEvidence ?? {}
  const signals = compactStringArray(microstructure.signals, 40, 160)
  const thsRank = firstFiniteNumber(microstructure.heat?.thsRank)
  const dcRank = firstFiniteNumber(microstructure.heat?.dcRank)
  const hasCrowdedHeat = (
    signals.includes("heat:crowded_top50") ||
    signals.includes("heat:crowded_top100") ||
    (thsRank !== null && thsRank <= 100) ||
    (dcRank !== null && dcRank <= 100)
  )
  const hasRelayEvidence = signals.some((signal) => [
    "limit_list:matched",
    "dragon_tiger:matched",
    "risk:high_board_relay",
    "limit_seal:one_shot",
  ].includes(signal))
  const profitFeedback = trade.profitFeedback ?? {}
  const realizedPnlPct = firstFiniteNumber(profitFeedback.realizedPnlPct)
  const maxDrawdownPct = firstFiniteNumber(profitFeedback.maxDrawdownPct, trade.marketEvidence?.maxDrawdownInHolding)
  const negativeExecution = (
    ["loss", "direction_right_entry_risk", "failed_or_unprofitable"].includes(profitFeedback.outcome) ||
    (realizedPnlPct !== null && realizedPnlPct < 0) ||
    (maxDrawdownPct !== null && Math.abs(maxDrawdownPct) >= 5)
  )
  const text = collectSearchText(
    trade.hypothesis,
    trade.expectedMove,
    trade.entry,
    trade.exit,
    trade.positionSizing,
    trade.sourceRefs,
    trade.evidenceRefs,
    microstructure,
  )
  const entryRiskText = includesAny(text, [
    "priced_in",
    "price-in",
    "后手",
    "追涨",
    "接力",
    "赔率压缩",
    "买点错",
    "承接转弱",
    "late_entry",
    "late entry",
    "entry_wrong",
  ])
  const reasons = [
    hasCrowdedHeat ? "paper_trade_heat_crowded" : "",
    hasRelayEvidence ? "paper_trade_relay_microstructure" : "",
    negativeExecution ? "paper_trade_negative_execution" : "",
    entryRiskText ? "paper_trade_entry_risk_text" : "",
  ].filter(Boolean)
  return {
    detected: hasCrowdedHeat && negativeExecution && (hasRelayEvidence || entryRiskText),
    reasons,
    checkResults: {
      crowdedHeat: hasCrowdedHeat,
      relayEvidence: hasRelayEvidence,
      negativeExecution,
      entryRiskText,
    },
  }
}

function qualityGateForPaperTrade(trade = {}, target = trade.validationTarget ?? "expectation_trade") {
  const evidenceRefs = compactStringArray(trade.evidenceRefs, 30, 260)
  if (trade.autoEvidenceGate?.blocksWrite === true) {
    return {
      status: "needs_evidence",
      validationTarget: target,
      highConfidenceEligible: false,
      requiredAction: "repair_paper_trade_auto_evidence",
      reasons: [
        "paper_trade_auto_evidence_gate_blocked",
        trade.autoEvidenceGate.status ? `auto_evidence_gate:${trade.autoEvidenceGate.status}` : "",
        `track:${trade.track ?? "unknown"}`,
      ].filter(Boolean),
      evidenceResultIds: [trade.id].filter(Boolean),
    }
  }
  if (evidenceRefs.length === 0) {
    return {
      status: "needs_evidence",
      validationTarget: target,
      highConfidenceEligible: false,
      requiredAction: "add_paper_trade_evidence_refs",
      reasons: ["paper_trade_missing_evidence_refs", `track:${trade.track ?? "unknown"}`],
      evidenceResultIds: [trade.id].filter(Boolean),
    }
  }
  if (target === "priced_in_risk") {
    const pricedInRisk = paperTradePricedInRiskEvidence(trade)
    return {
      status: pricedInRisk.detected ? "priced_in_validated" : "review_required",
      validationTarget: target,
      highConfidenceEligible: false,
      requiredAction: pricedInRisk.detected ? "review_priced_in_paper_trade" : "human_review_paper_trade",
      reasons: pricedInRisk.detected
        ? [...new Set([...pricedInRisk.reasons, "paper_trade_simulation", `track:${trade.track ?? "unknown"}`])]
        : ["paper_trade_simulation", `track:${trade.track ?? "unknown"}`, "paper_trade_priced_in_checks_not_met"],
      checkResults: pricedInRisk.checkResults,
      evidenceResultIds: [trade.id].filter(Boolean),
    }
  }
  return {
    status: "review_required",
    validationTarget: target,
    highConfidenceEligible: false,
    requiredAction: "human_review_paper_trade",
    reasons: ["paper_trade_simulation", `track:${trade.track ?? "unknown"}`],
    evidenceResultIds: [trade.id].filter(Boolean),
  }
}

function marketPatternsForPaperTrade(trade = {}, target) {
  const text = collectSearchText(
    trade.hypothesis,
    trade.expectedMove,
    trade.entry,
    trade.exit,
    trade.positionSizing,
    trade.marketEvidence,
    trade.marketMicrostructureEvidence,
    trade.sourceRefs,
    trade.evidenceRefs,
  )
  const patternIds = []
  if (includesAny(text, ["低位吸收", "low_absorption", "吸收", "breakout", "转强"])) patternIds.push("low_absorption_breakout")
  if (includesAny(text, ["priced_in", "后手", "追涨", "买点错", "late_entry"])) patternIds.push("priced_in_late_entry")
  if (includesAny(text, ["一日游", "无承接", "失败", "证伪", "failed"])) patternIds.push("failed_catalyst_one_day_hype")
  if (target === "expectation_trade" && patternIds.length === 0) patternIds.push("event_expectation_front_run")
  if (target === "priced_in_risk") patternIds.push("priced_in_late_entry")
  if (target === "disconfirmation") patternIds.push("failed_catalyst_one_day_hype")
  if (target === "fundamental_closure") patternIds.push("fundamental_closure_confirmation")
  return [...new Set(patternIds)].map(marketPatternSummary).filter(Boolean)
}

function profitFeedbackFromPaperTrade(trade = {}) {
  const profitFeedback = {
    ...(trade.profitFeedback ?? {}),
    executionMode: "paper",
    ledgerKind: "paper_trade",
  }
  return {
    ...profitFeedback,
    executionEvidenceClass: paperTradeExecutionEvidenceClass(profitFeedback),
  }
}

function trajectoryFromPaperTrade(trade = {}, { generatedAt }) {
  const target = parseStockFeedbackValidationTarget(trade.validationTarget ?? "expectation_trade") ?? "expectation_trade"
  const qualityGate = qualityGateForPaperTrade(trade, target)
  const marketPatterns = marketPatternsForPaperTrade(trade, target)
  const profitFeedback = attachProfitCreditAssignment(
    profitFeedbackFromPaperTrade(trade),
    { target, qualityGate, marketPatterns },
  )
  const distillationSignals = distillationSignalsForTrajectory({
    target,
    qualityGate,
    marketPatterns,
    profitFeedback,
  })
  const marketEvidence = trade.marketEvidence ?? null
  const marketMicrostructureEvidence = trade.marketMicrostructureEvidence ?? null
  const evidenceRefs = compactStringArray(trade.evidenceRefs, 30, 260)
  const sourceRefs = [
    trade.artifactPath,
    ...compactStringArray(trade.sourceRefs, 20, 260),
    ...evidenceRefs,
  ].filter(Boolean)
  const sourceRecordId = trade.id ?? shortHash(JSON.stringify(trade))
  const isProfitableClosedPaperTrade = (
    trade.status === "closed" &&
    profitFeedback.outcome === "profitable" &&
    evidenceRefs.length > 0 &&
    qualityGate.status !== "needs_evidence"
  )
  const isRiskOrLoss = ["loss", "direction_right_entry_risk", "failed_or_unprofitable"].includes(profitFeedback.outcome)
  const trajectory = {
    schema: STOCK_FEEDBACK_TRAJECTORY_SCHEMA,
    id: `stockfb_${shortHash(`${sourceRecordId}:${target}:paper_trade`)}`,
    generatedAt,
    source: "stock-feedback-paper-trade",
    sourceRecordId,
    validationTarget: target,
    validationTargetLabel: TARGET_TO_LABEL[target],
    qualityGate,
    adapterCapability: TARGET_TO_CAPABILITY[target],
    trainingUse: isRiskOrLoss ? ["eval", "preference"] : ["eval"],
    questionRecordId: trade.sourceQuestionId ?? null,
    validationId: null,
    questionId: trade.sourceQuestionId ?? null,
    hypothesis: compactString(trade.hypothesis || `${trade.stock?.name ?? trade.stock?.code ?? "paper trade"} 模拟交易收益归因`, 600),
    question: compactString(trade.expectedMove || trade.hypothesis || "", 600),
    stock: {
      name: compactString(trade.stock?.name, 80),
      code: compactString(trade.stock?.code, 32),
      label: compactString([trade.stock?.name, trade.stock?.code].filter(Boolean).join(" "), 120),
    },
    eventTimeline: [
      { step: "source_question", at: null, ref: trade.sourceQuestionId ?? null },
      { step: "paper_trade_entry", at: trade.entry?.date ?? null, ref: trade.id ?? null },
      { step: "paper_trade_exit", at: trade.exit?.date ?? null, ref: trade.id ?? null },
      { step: "paper_trade_recorded", at: trade.generatedAt ?? generatedAt, ref: trade.id ?? null },
    ].filter((item) => item.at || item.ref),
    marketValidation: {
      status: trade.status ?? "unknown",
      verdict: compactString([
        `paper_trade:${trade.track ?? "unknown"}`,
        profitFeedback.outcome ? `outcome:${profitFeedback.outcome}` : "",
        profitFeedback.realizedPnlPct !== undefined ? `pnl:${profitFeedback.realizedPnlPct}%` : "",
        profitFeedback.maxDrawdownPct !== undefined ? `max_drawdown:${profitFeedback.maxDrawdownPct}%` : "",
        marketEvidence?.relativeStrength !== undefined ? `rs:${marketEvidence.relativeStrength}` : "",
        marketEvidence?.turnoverChange !== undefined ? `turnover:${marketEvidence.turnoverChange}` : "",
        marketEvidence?.followThrough3d !== undefined ? `follow3d:${marketEvidence.followThrough3d}%` : "",
        marketMicrostructureEvidence?.limit ? "limit:matched" : "",
        marketMicrostructureEvidence?.limitStep ? `boards:${marketMicrostructureEvidence.limitStep.consecutiveBoards}` : "",
        marketMicrostructureEvidence?.dragonTiger ? "dragon_tiger:matched" : "",
        marketMicrostructureEvidence?.heat?.thsRank != null ? `ths_hot_rank:${marketMicrostructureEvidence.heat.thsRank}` : "",
        marketMicrostructureEvidence?.heat?.dcRank != null ? `dc_hot_rank:${marketMicrostructureEvidence.heat.dcRank}` : "",
      ].filter(Boolean).join(" / "), 180),
      refs: evidenceRefs,
      marketEvidence,
      marketMicrostructureEvidence,
      signals: [
        `paper_trade_track:${trade.track ?? "unknown"}`,
        `ledger_kind:${trade.ledgerKind ?? "unknown"}`,
        trade.status ? `paper_trade_status:${trade.status}` : "",
        profitFeedback.executionEvidenceClass ? `execution_evidence:${profitFeedback.executionEvidenceClass}` : "",
        marketEvidence?.relativeStrength !== undefined ? "market_evidence:relative_strength" : "",
        marketEvidence?.turnoverChange !== undefined ? "market_evidence:turnover_change" : "",
        marketEvidence?.followThrough1d !== undefined ? "market_evidence:follow_through_1d" : "",
        marketEvidence?.followThrough3d !== undefined ? "market_evidence:follow_through_3d" : "",
        marketEvidence?.followThrough5d !== undefined ? "market_evidence:follow_through_5d" : "",
        marketEvidence?.maxDrawdownInHolding !== undefined ? "market_evidence:max_drawdown_in_holding" : "",
        ...(marketMicrostructureEvidence?.signals ?? []).map((signal) => `microstructure:${signal}`),
      ].filter(Boolean),
    },
    marketPatterns,
    profitFeedback,
    distillationSignals,
    evidenceState: {
      attributionLabel: profitFeedback.outcome ?? null,
      confidenceImpact: "paper_trade_simulation_needs_human_review",
      nextAction: qualityGate.requiredAction,
      evidenceGaps: [
        evidenceRefs.length === 0 ? "paper_trade_missing_evidence_refs" : "",
        trade.autoEvidenceGate?.blocksWrite === true ? "paper_trade_auto_evidence_gate_blocked" : "",
      ].filter(Boolean),
      confirmedEvidenceRefs: evidenceRefs,
      marketEvidence,
      marketEvidenceWindow: trade.marketEvidenceWindow ?? null,
      marketMicrostructureEvidence,
      fundamentalEvidenceConfirmed: false,
      paperTradeId: trade.id ?? null,
      paperTradeTrack: trade.track ?? null,
      ledgerKind: trade.ledgerKind ?? null,
      asOfDate: trade.asOfDate ?? trade.evidenceCutoff?.asOfDate ?? null,
      sourceQuestionId: trade.sourceQuestionId ?? null,
      sourceTrajectoryId: trade.sourceTrajectoryId ?? null,
    },
    routing: {
      eval: true,
      sft: false,
      preference: isRiskOrLoss,
      adapterCandidate: isProfitableClosedPaperTrade,
    },
    paperTradeState: {
      ledgerKind: trade.ledgerKind ?? null,
      track: trade.track ?? null,
      status: trade.status ?? null,
      sourceQuestionId: trade.sourceQuestionId ?? null,
      sourceTrajectoryId: trade.sourceTrajectoryId ?? null,
      asOfDate: trade.asOfDate ?? trade.evidenceCutoff?.asOfDate ?? null,
      evidenceCutoff: trade.evidenceCutoff ?? null,
      marketEvidence,
      marketEvidenceWindow: trade.marketEvidenceWindow ?? null,
      marketEvidenceStatus: trade.marketEvidenceStatus ?? null,
      marketEvidenceWarning: trade.marketEvidenceWarning ?? null,
      marketMicrostructureEvidence,
      autoEvidenceGate: trade.autoEvidenceGate ?? null,
      microstructureEvidenceStatus: trade.microstructureEvidenceStatus ?? null,
      microstructureEvidenceWarning: trade.microstructureEvidenceWarning ?? null,
      entry: trade.entry ?? null,
      exit: trade.exit ?? null,
      positionSizing: trade.positionSizing ?? null,
      executionEvidenceClass: profitFeedback.executionEvidenceClass,
    },
    sourceRefs: [...new Set(sourceRefs)].slice(0, 30),
    summary: compactString([
      trade.hypothesis,
      trade.expectedMove ? `预期：${trade.expectedMove}` : "",
      profitFeedback.outcome ? `模拟结果：${profitFeedback.outcome}` : "",
      profitFeedback.realizedPnlPct !== undefined ? `收益 ${profitFeedback.realizedPnlPct}%` : "",
      profitFeedback.maxDrawdownPct !== undefined ? `最大回撤 ${profitFeedback.maxDrawdownPct}%` : "",
      profitFeedback.holdingDays !== undefined ? `持有 ${profitFeedback.holdingDays} 天` : "",
      marketEvidence?.relativeStrength !== undefined ? `相对强度 ${marketEvidence.relativeStrength}` : "",
      marketEvidence?.turnoverChange !== undefined ? `换手变化 ${marketEvidence.turnoverChange}` : "",
      marketEvidence?.followThrough3d !== undefined ? `3日承接 ${marketEvidence.followThrough3d}%` : "",
      marketMicrostructureEvidence?.limit ? "涨跌停证据匹配" : "",
      marketMicrostructureEvidence?.limitStep?.consecutiveBoards !== undefined ? `连板 ${marketMicrostructureEvidence.limitStep.consecutiveBoards}` : "",
      marketMicrostructureEvidence?.dragonTiger ? "龙虎榜证据匹配" : "",
      marketMicrostructureEvidence?.heat?.thsRank != null ? `THS热度 ${marketMicrostructureEvidence.heat.thsRank}` : "",
      marketMicrostructureEvidence?.heat?.dcRank != null ? `东财热度 ${marketMicrostructureEvidence.heat.dcRank}` : "",
    ].filter(Boolean).join("；"), 700),
  }
  return {
    ...trajectory,
    distillationPlan: distillationPlanForTrajectory(trajectory),
  }
}

function stockFeedbackTrajectoriesFromPaperTrades(paperTrades = [], options = {}) {
  const generatedAt = options.generatedAt ?? nowLocalTimestamp()
  return paperTrades
    .filter((item) => item && typeof item === "object" && item.schema === STOCK_FEEDBACK_PAPER_TRADE_SCHEMA)
    .map((item) => trajectoryFromPaperTrade(item, { generatedAt }))
}

function shouldBuildExpectation(record, related) {
  return isPositiveMarketFeedback(record, related) || expectationCheckResults(record, related).marketReaction
}

function shouldBuildFundamental(record, related) {
  const gaps = Array.isArray(record.evidenceGaps) ? record.evidenceGaps : []
  return gaps.some((gap) => String(gap).includes("fundamental")) || hasFundamentalEvidence(record, related.evidenceResults ?? [])
}

function shouldBuildDisconfirmation(record, related) {
  return isDisconfirmedFeedback(record, related)
}

function matchBy(records, predicate) {
  return records.find((item) => {
    try {
      return predicate(item.value ?? item)
    } catch {
      return false
    }
  })?.value ?? null
}

function buildRelatedRecords(record, records) {
  const questions = records.filter((item) => {
    const value = item.value
    return value?.schema === "self-question-v1" || value?.kind === "self-question" || value?.type === "question"
  })
  const validations = records.filter((item) => {
    const value = item.value
    return value?.validationMethod === "self_question_market_feedback_v1" || value?.kind === "self-question-market-validation" || value?.type === "validation"
  })
  const evidenceResults = records
    .filter((item) => (item.value?.schema === "self-question-evidence-result-v1" || item.value?.kind === "self-question-evidence-result" || item.value?.type === "evidence_result"))
    .map((item) => ({ ...item.value, path: item.path }))
  return {
    question: matchBy(questions, (item) => (
      item.id === record.questionRecordId ||
      item.questionId === record.questionId ||
      item.id === record.questionId
    )),
    validation: matchBy(validations, (item) => (
      item.id === record.validationId ||
      item.questionRecordId === record.questionRecordId ||
      item.questionId === record.questionId
    )),
    evidenceResults,
  }
}

export function stockFeedbackTrajectoriesFromRecords(records = [], options = {}) {
  const generatedAt = options.generatedAt ?? nowLocalTimestamp()
  const recordValues = records
    .map((item) => ({ value: item.value ?? item, path: item.path ?? item.relativePath ?? null }))
    .filter((item) => item.value && typeof item.value === "object" && !Array.isArray(item.value))
  const attributions = recordValues.filter((item) => {
    const value = item.value
    return value?.schema === "self-question-attribution-v1" || value?.kind === "self-question-attribution" || value?.type === "attribution"
  })
  const trajectories = []
  for (const item of attributions) {
    const record = { ...item.value, path: item.path }
    const related = buildRelatedRecords(record, recordValues)
    if (shouldBuildExpectation(record, related)) {
      trajectories.push(buildTrajectory({ target: "expectation_trade", record, related, generatedAt }))
    }
    if (shouldBuildFundamental(record, related)) {
      trajectories.push(buildTrajectory({ target: "fundamental_closure", record, related, generatedAt }))
    }
    if (detectPricedIn(record, related)) {
      trajectories.push(buildTrajectory({ target: "priced_in_risk", record, related, generatedAt }))
    }
    if (shouldBuildDisconfirmation(record, related)) {
      trajectories.push(buildTrajectory({ target: "disconfirmation", record, related, generatedAt }))
    }
  }
  trajectories.push(...stockFeedbackTrajectoriesFromCollectionResults(options.collectionResults ?? [], { generatedAt }))
  trajectories.push(...stockFeedbackTrajectoriesFromPaperTrades(options.paperTrades ?? [], { generatedAt }))
  trajectories.push(...stockFeedbackTrajectoriesFromExecutionResults(options.executionResults ?? [], { generatedAt }))
  return trajectories.sort((a, b) => (
    String(a.stock?.code ?? "").localeCompare(String(b.stock?.code ?? "")) ||
    a.validationTarget.localeCompare(b.validationTarget) ||
    a.id.localeCompare(b.id)
  ))
}

function summarizeTrajectories(trajectories = []) {
  const byValidationTarget = {}
  const byQualityGate = {}
  const byAdapterCapability = {}
  const byMarketPattern = {}
  const byProfitOutcome = {}
  const byProfitCredit = {}
  let highConfidenceEligible = 0
  for (const trajectory of trajectories) {
    byValidationTarget[trajectory.validationTarget] = (byValidationTarget[trajectory.validationTarget] ?? 0) + 1
    const gate = trajectory.qualityGate?.status ?? "unclassified"
    byQualityGate[gate] = (byQualityGate[gate] ?? 0) + 1
    const capability = trajectory.adapterCapability ?? "unknown"
    byAdapterCapability[capability] = (byAdapterCapability[capability] ?? 0) + 1
    for (const pattern of trajectory.marketPatterns ?? []) {
      if (!pattern?.id) continue
      byMarketPattern[pattern.id] = (byMarketPattern[pattern.id] ?? 0) + 1
    }
    const outcome = trajectory.profitFeedback?.outcome
    if (outcome) byProfitOutcome[outcome] = (byProfitOutcome[outcome] ?? 0) + 1
    const profitCredit = trajectory.profitFeedback?.creditAssignment?.primaryCredit
    if (profitCredit) byProfitCredit[profitCredit] = (byProfitCredit[profitCredit] ?? 0) + 1
    if (trajectory.qualityGate?.highConfidenceEligible === true) highConfidenceEligible += 1
  }
  return {
    total: trajectories.length,
    highConfidenceEligible,
    byValidationTarget,
    byQualityGate,
    byAdapterCapability,
    byMarketPattern,
    byProfitOutcome,
    byProfitCredit,
  }
}

function compactStamp(value = nowLocalTimestamp()) {
  return String(value).replace(/\D/g, "").slice(0, 14) || "run"
}

async function stockFeedbackArtifactPaths(projectPath, family, baseName, generatedAt) {
  const dir = path.join(projectPath, STOCK_FEEDBACK_ROOT, family)
  const stamp = compactStamp(generatedAt)
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const suffix = attempt === 0 ? stamp : `${stamp}-${attempt}`
    const base = `${baseName}-${suffix}`
    const jsonl = path.join(dir, `${base}.jsonl`)
    const manifest = path.join(dir, `${base}.manifest.json`)
    try {
      await fs.access(jsonl)
      continue
    } catch {}
    try {
      await fs.access(manifest)
      continue
    } catch {}
    return { dir, jsonl, manifest }
  }
  throw new Error(`Unable to allocate ${family} stock-feedback artifact path`)
}

async function writeJsonlWithManifest({ projectPath, family, baseName, records, manifest, generatedAt }) {
  const paths = await stockFeedbackArtifactPaths(projectPath, family, baseName, generatedAt)
  await ensureDirectory(paths.dir)
  await fs.writeFile(paths.jsonl, records.map((item) => JSON.stringify(item)).join("\n") + (records.length ? "\n" : ""), "utf8")
  await fs.writeFile(paths.manifest, `${JSON.stringify(manifest, null, 2)}\n`, "utf8")
  return {
    jsonl: {
      path: paths.jsonl,
      relativePath: projectRelative(projectPath, paths.jsonl),
      records: records.length,
    },
    manifest: {
      path: paths.manifest,
      relativePath: projectRelative(projectPath, paths.manifest),
    },
  }
}

export async function buildStockFeedbackTrajectories(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const generatedAt = options.generatedAt ?? nowLocalTimestamp()
  const records = await readBrainRecords(projectPath)
  const collectionResults = await readStockFeedbackCollectionResults(projectPath)
  const paperTrades = await readStockFeedbackPaperTrades(projectPath)
  const executionResults = await readStockFeedbackExecutionResults(projectPath)
  const trajectories = stockFeedbackTrajectoriesFromRecords(records, { generatedAt, collectionResults, paperTrades, executionResults })
  const manifest = {
    schema: "stock-feedback-trajectory-manifest-v1",
    generatedAt,
    projectPath,
    sourceFiles: [...new Set([
      ...records.map((item) => item.path).filter(Boolean),
      ...collectionResults.map((item) => item.artifactPath).filter(Boolean),
      ...paperTrades.map((item) => item.artifactPath).filter(Boolean),
      ...executionResults.map((item) => item.artifactPath).filter(Boolean),
    ])].sort(),
    count: trajectories.length,
    summary: summarizeTrajectories(trajectories),
    writeBoundary: {
      root: STOCK_FEEDBACK_ROOT,
      wroteWiki: false,
      wroteRaw: false,
      wroteBrain: false,
    },
    sources: [
      "data/brain/questions.jsonl",
      "data/brain/validations.jsonl",
      "data/brain/attributions.jsonl",
      "data/brain/evidence_results.jsonl",
      ".llm-wiki/stock-feedback/collection-results/*.jsonl",
      ".llm-wiki/stock-feedback/paper-trades/*.jsonl",
      ".llm-wiki/stock-feedback/execution-results/*.jsonl",
    ],
  }
  let writeResult = null
  if (options.write) {
    writeResult = await writeJsonlWithManifest({
      projectPath,
      family: "trajectories",
      baseName: "stock-feedback-trajectories",
      records: trajectories,
      manifest,
      generatedAt,
    })
  }
  return {
    schema: "stock-feedback-build-result-v1",
    mode: "stock-feedback-build-trajectories",
    dryRun: !Boolean(options.write),
    projectPath,
    generatedAt,
    trajectories,
    count: trajectories.length,
    summary: manifest.summary,
    manifest,
    writeResult: writeResult ? { trajectories: writeResult.jsonl, manifest: writeResult.manifest } : null,
    writePolicy: {
      wroteWiki: false,
      wroteRaw: false,
      wroteBrain: false,
      wroteArtifacts: Boolean(options.write),
      allowedRoot: STOCK_FEEDBACK_ROOT,
    },
  }
}

function latestStockFeedbackJsonlFile(files = []) {
  return files
    .slice()
    .sort((a, b) => (
      path.basename(a).localeCompare(path.basename(b)) ||
      a.localeCompare(b)
    ))
    .at(-1)
}

async function readStockFeedbackJsonlFamily(projectPath, family, schema, options = {}) {
  const root = path.join(projectPath, STOCK_FEEDBACK_ROOT, family)
  const files = await listFilesRecursive(root, {
    extensions: new Set([".jsonl"]),
    excludeDirNames: new Set([".git", "node_modules"]),
    maxBytes: 1024 * 1024 * 10,
  }).catch(() => [])
  const selectedFiles = options.latestOnly
    ? [latestStockFeedbackJsonlFile(files)].filter(Boolean)
    : files.sort()
  const records = []
  for (const filePath of selectedFiles) {
    const parsed = await readJsonlFile(filePath)
    for (const item of parsed) {
      if (!item.value || typeof item.value !== "object" || Array.isArray(item.value)) continue
      if (schema && item.value.schema !== schema) continue
      records.push({
        ...item.value,
        artifactPath: projectRelative(projectPath, filePath),
        artifactLine: item.line,
      })
    }
  }
  return records
}

async function readJsonlArtifactRoot(projectPath, relativeRoot, schema, options = {}) {
  const root = path.join(projectPath, relativeRoot)
  const files = await listFilesRecursive(root, {
    extensions: new Set([".jsonl"]),
    excludeDirNames: new Set([".git", "node_modules"]),
    maxBytes: 1024 * 1024 * 10,
  }).catch(() => [])
  const selectedFiles = options.latestOnly
    ? [latestStockFeedbackJsonlFile(files)].filter(Boolean)
    : files.sort()
  const records = []
  for (const filePath of selectedFiles) {
    const parsed = await readJsonlFile(filePath)
    for (const item of parsed) {
      if (!item.value || typeof item.value !== "object" || Array.isArray(item.value)) continue
      if (schema && item.value.schema !== schema) continue
      records.push({
        ...item.value,
        artifactPath: projectRelative(projectPath, filePath),
        artifactLine: item.line,
      })
    }
  }
  return records
}

async function readHypothesisEvidenceFeedbackRecords(projectPath) {
  return readJsonlArtifactRoot(projectPath, ".llm-wiki/hypothesis-evidence-feedback", "trading-hypothesis-evidence-feedback-v1", { latestOnly: true })
}

export async function readStockFeedbackTrajectories(projectPath) {
  return readStockFeedbackJsonlFamily(normalizePath(projectPath), "trajectories", STOCK_FEEDBACK_TRAJECTORY_SCHEMA, { latestOnly: true })
}

function trajectoryMatchesFilters(trajectory = {}, filters = {}) {
  const target = parseStockFeedbackValidationTarget(filters.validationTarget ?? filters["validation-target"])
  const gate = parseStockFeedbackQualityGate(filters.qualityGate ?? filters["quality-gate"])
  const marketPattern = parseStockFeedbackMarketPattern(filters.marketPattern ?? filters["market-pattern"])
  if (target && trajectory.validationTarget !== target) return false
  if (gate === "high_confidence") {
    if (trajectory.qualityGate?.highConfidenceEligible !== true) return false
  } else if (gate && trajectory.qualityGate?.status !== gate) {
    return false
  }
  if (marketPattern && !(trajectory.marketPatterns ?? []).some((pattern) => pattern.id === marketPattern)) return false
  const stock = compactString(filters.stock ?? "", 80).toLowerCase()
  if (stock) {
    const stockText = collectSearchText(trajectory.stock)
    if (!stockText.includes(stock.toLowerCase())) return false
  }
  const hypothesis = compactString(filters.hypothesis ?? "", 120).toLowerCase()
  if (hypothesis && !collectSearchText(trajectory.hypothesis, trajectory.question, trajectory.summary).includes(hypothesis)) return false
  const date = compactString(filters.date ?? "", 24)
  if (date && !collectSearchText(trajectory.eventTimeline, trajectory.generatedAt).includes(date.toLowerCase())) return false
  return true
}

export async function listStockFeedbackTrajectories(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const limit = parsePositiveInteger(options.limit ?? options["max-trajectories"], 100)
  const persisted = await readStockFeedbackTrajectories(projectPath)
  const includeDerived = options.persistedOnly || options["persisted-only"] ? false : true
  let sourceMode = "persisted"
  let trajectories = persisted
  if (includeDerived && trajectories.length === 0) {
    const built = await buildStockFeedbackTrajectories({ projectPath })
    trajectories = built.trajectories.map((item) => ({ ...item, artifactPath: null, artifactLine: null }))
    sourceMode = "derived"
  }
  const filtered = trajectories.filter((trajectory) => trajectoryMatchesFilters(trajectory, options))
  const returnedTrajectories = filtered
    .sort((a, b) => String(b.generatedAt ?? "").localeCompare(String(a.generatedAt ?? "")) || a.id.localeCompare(b.id))
    .slice(0, limit)
  return {
    schema: "stock-feedback-list-result-v1",
    mode: "stock-feedback-list",
    projectPath,
    sourceMode,
    total: trajectories.length,
    filtered: filtered.length,
    returned: returnedTrajectories.length,
    limit,
    filters: {
      validationTarget: parseStockFeedbackValidationTarget(options.validationTarget ?? options["validation-target"]),
      qualityGate: parseStockFeedbackQualityGate(options.qualityGate ?? options["quality-gate"]),
      marketPattern: parseStockFeedbackMarketPattern(options.marketPattern ?? options["market-pattern"]),
      stock: options.stock ?? null,
      hypothesis: options.hypothesis ?? null,
      date: options.date ?? null,
    },
    summary: summarizeTrajectories(filtered),
    trajectories: returnedTrajectories,
  }
}

async function readStockFeedbackReviewEvents(projectPath) {
  return readStockFeedbackJsonlFamily(normalizePath(projectPath), "reviews", STOCK_FEEDBACK_REVIEW_EVENT_SCHEMA)
}

function isPaperTradeTrajectory(trajectory = {}) {
  return (
    trajectory.source === "stock-feedback-paper-trade" ||
    trajectory.paperTradeState?.ledgerKind === "paper_trade" ||
    trajectory.profitFeedback?.ledgerKind === "paper_trade"
  )
}

function isProfitableClosedPaperTradeTrajectory(trajectory = {}) {
  return (
    isPaperTradeTrajectory(trajectory) &&
    trajectory.paperTradeState?.status === "closed" &&
    trajectory.profitFeedback?.outcome === "profitable" &&
    trajectory.profitFeedback?.ledgerKind === "paper_trade" &&
    trajectory.profitFeedback?.executionEvidenceClass === "paper_pattern_execution_supported"
  )
}

function isAdapterApprovalAction(action) {
  return action === "approve_for_adapter" || action === "approve_paper_adapter_candidate"
}

function isPaperAdapterApprovalAction(action) {
  return action === "approve_paper_adapter_candidate"
}

function reviewResultForAction(action) {
  if (action === "approve_paper_adapter_candidate") return "paper_approved"
  if (action === "approve_for_adapter") return "approved"
  if (action === "reject_for_adapter") return "rejected"
  if (action === "needs_evidence") return "needs_evidence"
  if (action === "mark_entry_wrong") return "entry_wrong"
  if (action === "mark_priced_in") return "priced_in"
  return "routed"
}

function recommendedReviewAction(trajectory = {}) {
  const gate = trajectory.qualityGate?.status ?? "review_required"
  const profitOutcome = trajectory.profitFeedback?.outcome ?? "unknown"
  if (isProfitableClosedPaperTradeTrajectory(trajectory)) return "approve_paper_adapter_candidate"
  if (gate === "priced_in_validated") return "mark_priced_in"
  if (profitOutcome === "direction_right_entry_risk") return "mark_entry_wrong"
  if (["loss", "failed_or_unprofitable"].includes(profitOutcome)) return "route_to_preference"
  if (gate === "expectation_validated" || gate === "fundamental_validated") return "approve_for_adapter"
  if (gate === "disconfirmed_validated") return "route_to_preference"
  if (gate === "needs_evidence") return "needs_evidence"
  return "route_to_eval"
}

function reviewActionLabel(action) {
  return {
    approve_for_adapter: "确认进入 adapter 候选",
    approve_paper_adapter_candidate: "人审 paper adapter 正样本",
    route_to_eval: "进入动态 eval",
    route_to_preference: "进入偏好/负样本",
    route_to_sft: "进入 SFT 样本",
    needs_evidence: "转补证",
    reject_for_adapter: "排除 adapter",
    mark_entry_wrong: "标记方向对但买点错",
    mark_priced_in: "标记 priced-in 风险",
  }[action] ?? action
}

function routingDecisionForReviewAction(action, trajectory = {}) {
  return {
    eval: ["approve_for_adapter", "approve_paper_adapter_candidate", "route_to_eval", "route_to_preference", "route_to_sft", "mark_entry_wrong", "mark_priced_in"].includes(action),
    sft: ["approve_for_adapter", "route_to_sft"].includes(action) && ["expectation_validated", "fundamental_validated"].includes(trajectory.qualityGate?.status),
    preference: ["route_to_preference", "mark_entry_wrong", "mark_priced_in"].includes(action),
    adapterCandidate: isAdapterApprovalAction(action),
    needsEvidence: action === "needs_evidence",
    rejectedForAdapter: action === "reject_for_adapter",
  }
}

function trainingWeightDecisionForReviewAction(action, trajectory = {}) {
  const gate = trajectory.qualityGate?.status ?? "review_required"
  const common = {
    schema: "stock-feedback-training-weight-decision-v1",
    source: "human_review",
    reviewAction: action,
    validationTarget: trajectory.validationTarget ?? null,
    qualityGateStatus: gate,
    allowWeightUpAfterReview: false,
  }
  if (action === "approve_paper_adapter_candidate") {
    return {
      ...common,
      state: "human_approved_paper_adapter_low_weight",
      defaultWeightMultiplier: 0.35,
      effectiveWeightMultiplier: 0.35,
      maxWeightMultiplierBeforeReview: 0.35,
      allowWeightUpAfterReview: false,
      reason: "human_paper_adapter_approval",
      note: "人工确认该 paper trade 可作为模拟收益支持的 adapter 候选；只沉淀行为、技能、工具习惯和决策策略，默认低权重且不得冒充真实盈利。",
    }
  }
  if (action === "approve_for_adapter") {
    return {
      ...common,
      state: "human_approved_upweight",
      defaultWeightMultiplier: 1,
      effectiveWeightMultiplier: 1,
      maxWeightMultiplierBeforeReview: 1,
      allowWeightUpAfterReview: true,
      reason: "human_adapter_approval",
      note: "人工确认该轨迹可复用，允许按标准权重进入 adapter 候选。",
    }
  }
  if (["route_to_preference", "mark_entry_wrong", "mark_priced_in"].includes(action)) {
    return {
      ...common,
      state: "human_risk_downweight",
      defaultWeightMultiplier: 0.75,
      effectiveWeightMultiplier: 0.75,
      maxWeightMultiplierBeforeReview: 0.75,
      reason: "human_risk_or_preference_route",
      note: "人工确认优先作为风控、偏好或负样本，降低 adapter 正样本权重。",
    }
  }
  if (action === "needs_evidence") {
    return {
      ...common,
      state: "evidence_gap_downweight",
      defaultWeightMultiplier: 0.25,
      effectiveWeightMultiplier: 0.25,
      maxWeightMultiplierBeforeReview: 0.25,
      reason: "human_requested_more_evidence",
      note: "证据不足，保留 eval 价值但暂不提升训练权重。",
    }
  }
  if (action === "reject_for_adapter") {
    return {
      ...common,
      state: "human_rejected_zero_weight",
      defaultWeightMultiplier: 0,
      effectiveWeightMultiplier: 0,
      maxWeightMultiplierBeforeReview: 0,
      reason: "human_rejected_adapter_candidate",
      note: "人工排除 adapter 候选，只保留审计或 eval 参考。",
    }
  }
  return {
    ...common,
    state: "human_routed_standard_review",
    defaultWeightMultiplier: 0.75,
    effectiveWeightMultiplier: 0.75,
    maxWeightMultiplierBeforeReview: 0.75,
    reason: "human_routed_non_adapter_review",
    note: "人工已分流但未确认 adapter 正样本，保持保守训练权重。",
  }
}

function defaultTrainingWeightDecisionForTrajectory(trajectory = {}) {
  return {
    schema: "stock-feedback-training-weight-decision-v1",
    state: "default_downweighted_pending_review",
    source: "system_default",
    reviewAction: null,
    validationTarget: trajectory.validationTarget ?? null,
    qualityGateStatus: trajectory.qualityGate?.status ?? "review_required",
    defaultWeightMultiplier: 0.5,
    effectiveWeightMultiplier: 0.5,
    maxWeightMultiplierBeforeReview: 0.5,
    allowWeightUpAfterReview: true,
    reason: "pending_human_review",
    note: "未人工确认前默认降权，避免未审样本直接放大 LoRA 训练影响。",
  }
}

function reviewActionIntent(action, trajectory = {}) {
  const gate = trajectory.qualityGate?.status ?? "review_required"
  if (action === "approve_for_adapter") return "确认这是可复用行为/技能样本，进入 adapter 候选，同时保留 eval/SFT 路由。"
  if (action === "approve_paper_adapter_candidate") return "人审确认模拟收益来自可复用执行手法；只以低权重进入 adapter 候选，不等同真实盈利样本。"
  if (action === "route_to_preference") return "作为偏好或负样本使用，训练模型识别方向对但买点错、伪催化或无承接。"
  if (action === "route_to_sft") return "作为监督样本使用，训练清晰表达验证目标、质量门和决策路线。"
  if (action === "needs_evidence") return "先转补证，不提升为高质量 adapter 样本。"
  if (action === "reject_for_adapter") return "排除 adapter 候选，只保留审计或 eval 价值。"
  if (action === "mark_entry_wrong") return "标记方向对但买点错误，优先进入 preference/eval 风控样本。"
  if (action === "mark_priced_in") return "标记 priced-in 风险，训练不要把后手追涨当成好决策。"
  if (gate === "review_required") return "先人工确认训练目标和质量门，再决定去向。"
  return "进入动态 eval，作为覆盖样本继续观察。"
}

function trainingUseForReviewRouting(routing = {}) {
  return [
    routing.eval ? "eval" : "",
    routing.sft ? "sft" : "",
    routing.preference ? "preference" : "",
    routing.adapterCandidate ? "adapter" : "",
    routing.needsEvidence ? "needs_evidence" : "",
    routing.rejectedForAdapter ? "audit" : "",
  ].filter(Boolean)
}

function reviewActionDisabledReason(action, trajectory = {}) {
  const gate = trajectory.qualityGate?.status ?? "review_required"
  const highConfidence = trajectory.qualityGate?.highConfidenceEligible === true
  if (action === "approve_paper_adapter_candidate" && !isProfitableClosedPaperTradeTrajectory(trajectory)) {
    return "只有已结算盈利、ledgerKind=paper_trade 且执行证据为 paper_pattern_execution_supported 的模拟交易，才能作为低权重 paper adapter 候选。"
  }
  if (action === "approve_for_adapter" && !highConfidence) {
    return "尚未通过当前训练目标的高置信质量门，不能直接提权进 adapter。"
  }
  if (action === "route_to_sft" && !["expectation_validated", "fundamental_validated"].includes(gate)) {
    return "SFT 正样本只接受预期交易或基本面兑现已经验证的轨迹。"
  }
  return null
}

function reviewActionOptionForTrajectory(action, trajectory = {}, recommendedAction = null) {
  const routing = routingDecisionForReviewAction(action, trajectory)
  const trainingWeightDecision = trainingWeightDecisionForReviewAction(action, trajectory)
  const disabledReason = reviewActionDisabledReason(action, trajectory)
  return {
    action,
    label: reviewActionLabel(action),
    recommended: action === recommendedAction,
    enabled: !disabledReason,
    disabledReason,
    intent: reviewActionIntent(action, trajectory),
    preview: {
      routing,
      trainingUse: trainingUseForReviewRouting(routing),
      trainingWeightDecision,
      peftBoundary: {
        storesRawFacts: false,
        factsRemainIn: ["retrieval/tool state", "sourceRefs", "price SQL"],
        adapterStores: ["behavior", "skill", "tool_habit", "decision_strategy"],
      },
    },
  }
}

function reviewActionOptionsForTrajectory(trajectory = {}, recommendedAction = recommendedReviewAction(trajectory)) {
  const actions = [
    recommendedAction,
    isPaperTradeTrajectory(trajectory) ? "approve_paper_adapter_candidate" : "",
    "approve_for_adapter",
    "route_to_eval",
    "route_to_preference",
    "route_to_sft",
    "needs_evidence",
    "reject_for_adapter",
    "mark_entry_wrong",
    "mark_priced_in",
  ].filter(Boolean)
  return [...new Set(actions)]
    .filter((action) => STOCK_FEEDBACK_REVIEW_ACTIONS.includes(action))
    .map((action) => reviewActionOptionForTrajectory(action, trajectory, recommendedAction))
}

function humanActionPlanForTrajectory(trajectory = {}, reviewSignal = null, adapterPriority = null) {
  const recommendedAction = reviewSignal?.recommendedAction ?? recommendedReviewAction(trajectory)
  const latestAction = reviewSignal?.latestAction ?? null
  return {
    schema: "stock-feedback-human-action-plan-v1",
    sourceTrajectoryId: trajectory.id ?? null,
    validationTarget: trajectory.validationTarget ?? null,
    qualityGateStatus: trajectory.qualityGate?.status ?? "review_required",
    adapterCapability: trajectory.adapterCapability ?? TARGET_TO_CAPABILITY[trajectory.validationTarget],
    recommendedAction,
    recommendedActionLabel: reviewActionLabel(recommendedAction),
    primaryButtonLabel: `执行推荐：${reviewActionLabel(recommendedAction)}`,
    intent: reviewActionIntent(recommendedAction, trajectory),
    alreadyReviewed: Boolean(reviewSignal?.reviewed),
    latestAction,
    latestActionLabel: latestAction ? reviewActionLabel(latestAction) : null,
    expectedRouting: routingDecisionForReviewAction(recommendedAction, trajectory),
    actionOptions: reviewActionOptionsForTrajectory(trajectory, recommendedAction),
    why: [...new Set(humanDecisionReasonsForTrajectory(trajectory, adapterPriority))].slice(0, 12),
    reviewQuestions: [
      "是否代表可复用手法，而不是单只股票事实？",
      "事实、公告、价格和成交额是否仍留在 retrieval/tool state？",
      "收益/回撤反馈是否支持该路由，还是只适合 eval/preference？",
    ],
    peftBoundary: {
      storesRawFacts: false,
      factsRemainIn: ["retrieval/tool state", "sourceRefs", "price SQL"],
      adapterStores: ["behavior", "skill", "tool_habit", "decision_strategy"],
    },
  }
}

function latestReviewByTrajectory(reviewEvents = []) {
  const byId = new Map()
  for (const event of reviewEvents) {
    const trajectoryId = event.sourceTrajectoryId
    if (!trajectoryId) continue
    const current = byId.get(trajectoryId)
    const currentTime = String(current?.generatedAt ?? "")
    const nextTime = String(event.generatedAt ?? "")
    if (!current || nextTime.localeCompare(currentTime) >= 0) byId.set(trajectoryId, event)
  }
  return byId
}

function reviewQueueItem(trajectory, latestReview = null) {
  const recommendedAction = recommendedReviewAction(trajectory)
  const reviewSignal = reviewSignalForTrajectory(trajectory, latestReview)
  const adapterPriority = adapterCandidatePriority(trajectory, reviewSignal, {})
  const humanActionPlan = humanActionPlanForTrajectory(trajectory, reviewSignal, adapterPriority)
  return {
    id: `stockfb_review_item_${shortHash(trajectory.id)}`,
    sourceTrajectoryId: trajectory.id,
    recommendedAction,
    recommendedActionLabel: reviewActionLabel(recommendedAction),
    reviewStatus: latestReview ? "reviewed" : "pending",
    latestReview,
    distillationPlan: distillationPlanForTrajectory(trajectory, reviewSignal, adapterPriority),
    humanActionPlan,
    trajectory,
    humanChecklist: [
      "确认 validationTarget 与 qualityGate 是否匹配",
      "确认收益/回撤反馈是否能代表这类手法",
      "确认原始事实仍留在 retrieval/tool state",
      "选择进入 adapter、eval/preference/SFT、补证或排除",
    ],
  }
}

function summarizeReviewQueue(items = [], reviewEvents = []) {
  const byRecommendedAction = {}
  const byReviewResult = {}
  for (const item of items) {
    byRecommendedAction[item.recommendedAction] = (byRecommendedAction[item.recommendedAction] ?? 0) + 1
  }
  for (const event of reviewEvents) {
    const result = event.result ?? "unknown"
    byReviewResult[result] = (byReviewResult[result] ?? 0) + 1
  }
  return {
    total: items.length,
    pending: items.filter((item) => item.reviewStatus === "pending").length,
    reviewed: items.filter((item) => item.reviewStatus === "reviewed").length,
    reviewEvents: reviewEvents.length,
    byRecommendedAction,
    byReviewResult,
  }
}

export async function listStockFeedbackReviewQueue(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const limit = parsePositiveInteger(options.limit ?? options["max-items"], 100)
  const includeReviewed = options.includeReviewed ?? options["include-reviewed"] ?? true
  const listed = await listStockFeedbackTrajectories({
    projectPath,
    validationTarget: options.validationTarget ?? options["validation-target"],
    qualityGate: options.qualityGate ?? options["quality-gate"],
    marketPattern: options.marketPattern ?? options["market-pattern"],
    stock: options.stock,
    hypothesis: options.hypothesis,
    date: options.date,
    limit: options.trajectoryLimit ?? options["trajectory-limit"] ?? 500,
  })
  const reviewEvents = await readStockFeedbackReviewEvents(projectPath)
  const latestById = latestReviewByTrajectory(reviewEvents)
  const allItems = listed.trajectories.map((trajectory) => reviewQueueItem(trajectory, latestById.get(trajectory.id) ?? null))
  const filtered = includeReviewed ? allItems : allItems.filter((item) => item.reviewStatus === "pending")
  const items = filtered
    .sort((a, b) => (
      a.reviewStatus.localeCompare(b.reviewStatus) ||
      String(b.trajectory.generatedAt ?? "").localeCompare(String(a.trajectory.generatedAt ?? "")) ||
      a.sourceTrajectoryId.localeCompare(b.sourceTrajectoryId)
    ))
    .slice(0, limit)
  return {
    schema: "stock-feedback-review-queue-v1",
    mode: "stock-feedback-review-queue",
    projectPath,
    sourceMode: listed.sourceMode,
    returned: items.length,
    limit,
    includeReviewed: Boolean(includeReviewed),
    filters: listed.filters,
    counts: summarizeReviewQueue(allItems, reviewEvents),
    items,
    writePolicy: {
      readOnly: true,
      wroteWiki: false,
      wroteRaw: false,
      wroteBrain: false,
      wroteArtifacts: false,
    },
  }
}

function buildReviewEvent({ trajectory, action, reviewer, note, generatedAt }) {
  const result = reviewResultForAction(action)
  return {
    schema: STOCK_FEEDBACK_REVIEW_EVENT_SCHEMA,
    eventType: "stock-feedback-review",
    id: `stockfb_review_${shortHash(`${trajectory.id}:${action}:${generatedAt}:${reviewer ?? ""}`)}`,
    generatedAt,
    sourceTrajectoryId: trajectory.id,
    sourceRecordId: trajectory.sourceRecordId ?? null,
    validationTarget: trajectory.validationTarget,
    qualityGateStatus: trajectory.qualityGate?.status ?? "review_required",
    adapterCapability: trajectory.adapterCapability ?? null,
    marketPatternIds: (trajectory.marketPatterns ?? []).map((pattern) => pattern.id).filter(Boolean),
    profitOutcome: trajectory.profitFeedback?.outcome ?? "unknown",
    action,
    actionLabel: reviewActionLabel(action),
    result,
    reviewer: compactString(reviewer ?? "manual", 80) || "manual",
    note: compactString(note, 500),
    stock: trajectory.stock ?? null,
    routingDecision: routingDecisionForReviewAction(action, trajectory),
    trainingWeightDecision: trainingWeightDecisionForReviewAction(action, trajectory),
    peftBoundary: {
      storesRawFacts: false,
      factsRemainIn: ["retrieval/tool state", "sourceRefs", "price SQL"],
      adapterStores: ["behavior", "skill", "tool_habit", "decision_strategy"],
    },
    references: {
      sourceRefs: compactStringArray(trajectory.sourceRefs, 20, 220),
      trajectoryId: trajectory.id,
    },
  }
}

function reviewSignalForTrajectory(trajectory, latestReview = null) {
  const trainingWeightDecision = latestReview
    ? (latestReview.trainingWeightDecision ?? trainingWeightDecisionForReviewAction(latestReview.action, trajectory))
    : null
  return {
    reviewed: Boolean(latestReview),
    latestAction: latestReview?.action ?? null,
    latestResult: latestReview?.result ?? null,
    reviewer: latestReview?.reviewer ?? null,
    reviewedAt: latestReview?.generatedAt ?? null,
    routingDecision: latestReview?.routingDecision ?? null,
    trainingWeightDecision,
    recommendedAction: recommendedReviewAction(trajectory),
  }
}

function stockFeedbackSourceKindLabel(sourceKind = "unknown") {
  return {
    "self-question-attribution": "自提问归因轨迹",
    "stock-feedback-collection-result": "补样本回流轨迹",
    "stock-feedback-paper-trade": "模拟交易回测轨迹",
    "stock-feedback-execution-result": "真实交易执行结果",
  }[sourceKind] ?? sourceKind
}

function sourceAuditForTrajectory(trajectory = {}) {
  const sourceKind = compactString(trajectory.source ?? "unknown", 120) || "unknown"
  const sourceKindLabel = stockFeedbackSourceKindLabel(sourceKind)
  const collectionState = trajectory.collectionState ? {
    result: trajectory.collectionState.result ?? null,
    resultLabel: trajectory.collectionState.resultLabel ?? null,
    sourceDraftId: trajectory.collectionState.sourceDraftId ?? null,
    sourceTaskId: trajectory.collectionState.sourceTaskId ?? null,
    targetPatternId: trajectory.collectionState.targetPatternId ?? null,
    targetPatternLabel: trajectory.collectionState.targetPatternLabel ?? null,
    requestedValidationTarget: trajectory.collectionState.requestedValidationTarget ?? null,
    nextAction: trajectory.collectionState.nextAction ?? null,
    reviewer: trajectory.collectionState.reviewer ?? null,
  } : null
  const paperTradeState = trajectory.paperTradeState ? {
    ledgerKind: trajectory.paperTradeState.ledgerKind ?? null,
    track: trajectory.paperTradeState.track ?? null,
    status: trajectory.paperTradeState.status ?? null,
    sourceQuestionId: trajectory.paperTradeState.sourceQuestionId ?? null,
    sourceTrajectoryId: trajectory.paperTradeState.sourceTrajectoryId ?? null,
    asOfDate: trajectory.paperTradeState.asOfDate ?? null,
    evidenceCutoff: trajectory.paperTradeState.evidenceCutoff ?? null,
    entry: trajectory.paperTradeState.entry ?? null,
    exit: trajectory.paperTradeState.exit ?? null,
    positionSizing: trajectory.paperTradeState.positionSizing ?? null,
    executionEvidenceClass: trajectory.paperTradeState.executionEvidenceClass ?? null,
  } : null
  const executionResultState = trajectory.executionResultState ? {
    ledgerKind: trajectory.executionResultState.ledgerKind ?? null,
    recordStatus: trajectory.executionResultState.recordStatus ?? null,
    pnlScope: trajectory.executionResultState.pnlScope ?? null,
    positionState: trajectory.executionResultState.positionState ?? null,
    artifactId: trajectory.executionResultState.artifactId ?? null,
    sourceCoverage: trajectory.executionResultState.sourceCoverage ?? null,
    crossValidationStatus: trajectory.executionResultState.crossValidationStatus ?? null,
    executionEvidenceClass: trajectory.executionResultState.executionEvidenceClass ?? null,
  } : null
  return {
    sourceKind,
    sourceKindLabel,
    collectionState,
    paperTradeState,
    executionResultState,
    collectionResultId: collectionState ? (trajectory.evidenceState?.collectionResultId ?? trajectory.sourceRecordId ?? null) : null,
    paperTradeId: paperTradeState ? (trajectory.evidenceState?.paperTradeId ?? trajectory.sourceRecordId ?? null) : null,
    executionResultId: executionResultState ? (trajectory.evidenceState?.executionResultId ?? trajectory.sourceRecordId ?? null) : null,
  }
}

function countBy(items = [], keyFn) {
  return items.reduce((counts, item) => {
    const key = keyFn(item)
    if (!key) return counts
    counts[key] = (counts[key] ?? 0) + 1
    return counts
  }, {})
}

function dynamicBenchmarkPriority(trajectory, reviewSignal = {}, patternCounts = {}) {
  const gate = trajectory.qualityGate?.status ?? "review_required"
  const profitOutcome = trajectory.profitFeedback?.outcome ?? "unknown"
  const reviewAction = reviewSignal.latestAction
  const reasons = []
  let score = 10
  let bucket = "coverage"
  if (reviewSignal.reviewed) {
    score += 30
    reasons.push("human_review")
  }
  if (reviewAction === "approve_for_adapter") {
    score += 25
    bucket = "adapter_approved"
    reasons.push("adapter_approved")
  }
  if (isPaperAdapterApprovalAction(reviewAction)) {
    score += 18
    bucket = "paper_adapter_approved"
    reasons.push("paper_adapter_approved")
  }
  if (["route_to_preference", "mark_entry_wrong", "mark_priced_in"].includes(reviewAction)) {
    score += 30
    bucket = "risk_negative"
    reasons.push("human_review_risk_negative")
  }
  if (["priced_in_validated", "disconfirmed_validated"].includes(gate) || ["loss", "failed_or_unprofitable", "direction_right_entry_risk"].includes(profitOutcome)) {
    score += 22
    bucket = "risk_negative"
    reasons.push("risk_negative")
  }
  if (gate === "needs_evidence" || reviewAction === "needs_evidence") {
    score += 12
    bucket = "evidence_gap"
    reasons.push("needs_evidence")
  }
  for (const pattern of trajectory.marketPatterns ?? []) {
    if (!pattern?.id) continue
    if ((patternCounts[pattern.id] ?? 0) <= 1) {
      score += 8
      reasons.push(`scarce_pattern:${pattern.id}`)
    }
  }
  if (trajectory.qualityGate?.highConfidenceEligible === true) {
    score += 5
    reasons.push("high_confidence")
  }
  if (profitOutcome === "profitable") reasons.push("profitable_feedback")
  if (reasons.length === 0) reasons.push("baseline_coverage")
  return {
    strategy: "review_weighted_market_pattern_curriculum_v1",
    score,
    bucket,
    reasons: [...new Set(reasons)],
  }
}

function dynamicBenchmarkCoverageGaps(trajectories = [], summary = summarizeTrajectories(trajectories)) {
  const gaps = []
  for (const target of STOCK_FEEDBACK_VALIDATION_TARGETS) {
    if ((summary.byValidationTarget?.[target] ?? 0) === 0) {
      gaps.push({
        bucket: "validation_target",
        id: target,
        label: TARGET_TO_LABEL[target] ?? target,
        recommendedAction: "collect_or_label_trajectory",
      })
    }
  }
  for (const pattern of STOCK_FEEDBACK_MARKET_PATTERNS) {
    if ((summary.byMarketPattern?.[pattern.id] ?? 0) === 0) {
      gaps.push({
        bucket: "market_pattern",
        id: pattern.id,
        label: pattern.label,
        recommendedAction: "collect_market_pattern_case",
      })
    }
  }
  for (const outcome of ["profitable", "loss"]) {
    if ((summary.byProfitOutcome?.[outcome] ?? 0) === 0) {
      gaps.push({
        bucket: "profit_outcome",
        id: outcome,
        label: outcome,
        recommendedAction: "collect_profit_feedback",
      })
    }
  }
  for (const credit of STOCK_FEEDBACK_PROFIT_CREDIT_BUCKETS) {
    if ((summary.byProfitCredit?.[credit.id] ?? 0) === 0) {
      gaps.push({
        bucket: "profit_credit",
        id: credit.id,
        label: credit.label,
        recommendedAction: credit.recommendedAction,
        trainingUse: credit.trainingUse,
        adapterCapability: credit.adapterCapability,
        detail: credit.detail,
      })
    }
  }
  return gaps
}

function buildDynamicBenchmarkSummary(cases = [], trajectories = [], summary = summarizeTrajectories(trajectories)) {
  return {
    strategy: "review_weighted_market_pattern_curriculum_v1",
    counts: {
      totalCases: cases.length,
      reviewedCases: cases.filter((item) => item.reviewSignal?.reviewed).length,
      negativeOrRiskCases: cases.filter((item) => item.dynamicPriority?.bucket === "risk_negative").length,
      adapterApprovedCases: cases.filter((item) => item.dynamicPriority?.bucket === "adapter_approved").length,
      paperAdapterApprovedCases: cases.filter((item) => item.dynamicPriority?.bucket === "paper_adapter_approved").length,
      evidenceGapCases: cases.filter((item) => item.dynamicPriority?.bucket === "evidence_gap").length,
    },
    buckets: countBy(cases, (item) => item.dynamicPriority?.bucket),
    profitCreditCounts: summary.byProfitCredit ?? {},
    requiredProfitCreditBuckets: STOCK_FEEDBACK_PROFIT_CREDIT_BUCKETS.map((bucket) => ({
      id: bucket.id,
      label: bucket.label,
      trainingUse: bucket.trainingUse,
      recommendedAction: bucket.recommendedAction,
      adapterCapability: bucket.adapterCapability,
    })),
    coverageGaps: dynamicBenchmarkCoverageGaps(trajectories, summary),
  }
}

function adapterCandidatePriority(trajectory, reviewSignal = {}, patternCounts = {}) {
  const benchmarkPriority = dynamicBenchmarkPriority(trajectory, reviewSignal, patternCounts)
  const profitOutcome = trajectory.profitFeedback?.outcome ?? "unknown"
  const reviewAction = reviewSignal.latestAction
  const reasons = [...benchmarkPriority.reasons]
  let score = benchmarkPriority.score
  let bucket = "coverage_builder"
  if (reviewAction === "approve_for_adapter") {
    score += 25
    bucket = "reviewed_reusable_skill"
    reasons.push("adapter_approved")
  }
  if (isPaperAdapterApprovalAction(reviewAction)) {
    score += 18
    bucket = "paper_reviewed_reusable_skill"
    reasons.push("paper_adapter_approved")
  }
  if (["route_to_preference", "mark_entry_wrong", "mark_priced_in"].includes(reviewAction) || benchmarkPriority.bucket === "risk_negative") {
    score += 12
    bucket = bucket === "reviewed_reusable_skill" ? bucket : "risk_control_skill"
    reasons.push("risk_control_skill")
  }
  if (profitOutcome === "profitable") {
    score += 8
    reasons.push("profitable_feedback")
  }
  if ((trajectory.marketPatterns ?? []).length > 0) {
    score += 4
    reasons.push("market_pattern_reusable")
  }
  return {
    strategy: "review_weighted_adapter_curriculum_v1",
    score,
    bucket,
    benchmarkBucket: benchmarkPriority.bucket,
    reasons: [...new Set(reasons)],
  }
}

function trainingWeightDecisionForCandidate(trajectory = {}, reviewSignal = {}) {
  return reviewSignal?.trainingWeightDecision ?? defaultTrainingWeightDecisionForTrajectory(trajectory)
}

function buildAdapterCurriculumSummary(candidates = [], trajectories = [], summary = summarizeTrajectories(trajectories)) {
  return {
    strategy: "review_weighted_adapter_curriculum_v1",
    counts: {
      totalCandidates: candidates.length,
      reviewedCandidates: candidates.filter((item) => item.reviewSignal?.reviewed).length,
      approvedCandidates: candidates.filter((item) => item.reviewSignal?.latestAction === "approve_for_adapter").length,
      paperApprovedCandidates: candidates.filter((item) => item.reviewSignal?.latestAction === "approve_paper_adapter_candidate").length,
      riskControlCandidates: candidates.filter((item) => item.curriculumBucket === "risk_control_skill").length,
      reusableSkillCandidates: candidates.filter((item) => item.curriculumBucket === "reviewed_reusable_skill").length,
      paperReusableSkillCandidates: candidates.filter((item) => item.curriculumBucket === "paper_reviewed_reusable_skill").length,
      realExecutionCandidates: candidates.filter((item) => item.sourceKind === "stock-feedback-execution-result").length,
      realPatternExecutionSupported: candidates.filter((item) => item.profitFeedback?.executionEvidenceClass === "real_pattern_execution_supported").length,
      realEntryWrong: candidates.filter((item) => item.profitFeedback?.executionEvidenceClass === "real_entry_wrong").length,
      realFailedExpectationNegative: candidates.filter((item) => item.profitFeedback?.executionEvidenceClass === "real_failed_expectation_negative").length,
      realPricedInLateEntry: candidates.filter((item) => item.profitFeedback?.executionEvidenceClass === "real_priced_in_late_entry").length,
      reviewedUpweightedCandidates: candidates.filter((item) => item.trainingWeightDecision?.state === "human_approved_upweight").length,
      reviewedPaperLowWeightCandidates: candidates.filter((item) => item.trainingWeightDecision?.state === "human_approved_paper_adapter_low_weight").length,
      defaultDownweightedCandidates: candidates.filter((item) => item.trainingWeightDecision?.state === "default_downweighted_pending_review").length,
    },
    buckets: countBy(candidates, (item) => item.curriculumBucket),
    trainingWeightDecisionCounts: countBy(candidates, (item) => item.trainingWeightDecision?.state),
    coverageGaps: dynamicBenchmarkCoverageGaps(trajectories, summary),
  }
}

function adapterBatchBucketSpec(state) {
  return {
    human_approved_upweight: {
      id: "human_approved_upweight",
      label: "人工确认可提权",
      recommendedSampling: "priority_include",
      selectionUse: ["sft", "adapter"],
      reviewGate: "human_approved",
    },
    human_approved_paper_adapter_low_weight: {
      id: "human_approved_paper_adapter_low_weight",
      label: "人审 paper 低权重",
      recommendedSampling: "low_weight_after_human_review",
      selectionUse: ["eval", "adapter_candidate_pool"],
      reviewGate: "human_approved_paper_simulation",
    },
    default_downweighted_pending_review: {
      id: "default_downweighted_pending_review",
      label: "未审默认降权",
      recommendedSampling: "downsample_until_review",
      selectionUse: ["eval", "adapter_candidate_pool"],
      reviewGate: "requires_human_review_before_weight_up",
    },
    human_risk_downweight: {
      id: "human_risk_downweight",
      label: "人审风控降权",
      recommendedSampling: "prefer_eval_and_negative_mix",
      selectionUse: ["preference", "negative", "eval"],
      reviewGate: "human_risk_route",
    },
    evidence_gap_downweight: {
      id: "evidence_gap_downweight",
      label: "补证降权",
      recommendedSampling: "hold_for_evidence",
      selectionUse: ["eval", "needs_evidence"],
      reviewGate: "requires_evidence",
    },
    human_rejected_zero_weight: {
      id: "human_rejected_zero_weight",
      label: "人工排除权重",
      recommendedSampling: "exclude_from_positive_adapter",
      selectionUse: ["audit", "negative_if_useful"],
      reviewGate: "human_rejected",
    },
    human_routed_standard_review: {
      id: "human_routed_standard_review",
      label: "人审保守权重",
      recommendedSampling: "standard_review_sample",
      selectionUse: ["eval", "sft_candidate"],
      reviewGate: "human_reviewed_not_adapter_approved",
    },
  }[state ?? ""] ?? {
    id: state ?? "unknown",
    label: state ?? "未知权重",
    recommendedSampling: "manual_review",
    selectionUse: ["manual_review"],
    reviewGate: "unknown",
  }
}

function effectiveTrainingWeight(candidate = {}) {
  const value = Number(candidate.trainingWeightDecision?.effectiveWeightMultiplier)
  return Number.isFinite(value) ? value : 1
}

function buildAdapterBatchRecipe(candidates = []) {
  const candidatesByState = new Map()
  for (const candidate of candidates) {
    const state = candidate.trainingWeightDecision?.state ?? "unknown"
    if (!candidatesByState.has(state)) candidatesByState.set(state, [])
    candidatesByState.get(state).push(candidate)
  }
  const stateOrder = [
    "human_approved_upweight",
    "human_approved_paper_adapter_low_weight",
    "human_routed_standard_review",
    "default_downweighted_pending_review",
    "human_risk_downweight",
    "evidence_gap_downweight",
    "human_rejected_zero_weight",
  ]
  const orderedStates = [
    ...stateOrder.filter((state) => candidatesByState.has(state)),
    ...[...candidatesByState.keys()].filter((state) => !stateOrder.includes(state)).sort(),
  ]
  const buckets = orderedStates.map((state) => {
    const bucketCandidates = candidatesByState.get(state) ?? []
    const spec = adapterBatchBucketSpec(state)
    const totalEffectiveWeight = bucketCandidates.reduce((sum, item) => sum + effectiveTrainingWeight(item), 0)
    const firstWeight = bucketCandidates.length ? effectiveTrainingWeight(bucketCandidates[0]) : null
    const sameWeight = firstWeight !== null && bucketCandidates.every((item) => effectiveTrainingWeight(item) === firstWeight)
    return {
      ...spec,
      count: bucketCandidates.length,
      effectiveWeightMultiplier: sameWeight ? firstWeight : null,
      totalEffectiveWeight: Number(totalEffectiveWeight.toFixed(2)),
      candidateIds: bucketCandidates.map((item) => item.id).filter(Boolean),
      validationTargetCounts: countBy(bucketCandidates, (item) => item.validationTarget),
      adapterCapabilityCounts: countBy(bucketCandidates, (item) => item.adapterCapability),
    }
  })
  const totalEffectiveWeight = candidates.reduce((sum, item) => sum + effectiveTrainingWeight(item), 0)
  return {
    schema: "stock-feedback-adapter-batch-recipe-v1",
    strategy: "human_review_weighted_peft_selection_v1",
    modelTrainingStarted: false,
    storesRawFacts: false,
    totalCandidates: candidates.length,
    weightedCandidateCount: candidates.filter((item) => effectiveTrainingWeight(item) > 0).length,
    totalEffectiveWeight: Number(totalEffectiveWeight.toFixed(2)),
    buckets,
    selectionPolicy: {
      priority: ["human_approved_upweight", "human_approved_paper_adapter_low_weight", "human_routed_standard_review", "default_downweighted_pending_review", "human_risk_downweight"],
      paperTradePolicy: "paper approvals remain low weight and never imply real realized PnL",
      defaultPendingReviewWeight: 0.5,
      humanReviewRequiredBeforeWeightUp: true,
      allowNegativeAndRiskSamplesForPreferenceEval: true,
    },
    peftBoundary: {
      modelTrainingStarted: false,
      storesRawFacts: false,
      factsRemainIn: ["wiki/raw/facts/tool-state", "stock price SQL", "sourceRefs"],
      adapterStores: ["behavior", "skill", "tool habit", "decision strategy"],
    },
  }
}

function loraReadyRefKey(ref = {}) {
  if (ref.id) return `candidate:${ref.id}`
  if (ref.sourceTrajectoryId) return `trajectory:${ref.sourceTrajectoryId}`
  return null
}

function loraReadyRefWeight(ref = {}, bucket = {}) {
  const refWeight = finiteNumber(ref.effectiveWeightMultiplier)
  if (refWeight !== null) return refWeight
  const bucketWeight = finiteNumber(bucket.effectiveWeightMultiplier)
  return bucketWeight
}

function compactLoraReadyRefForDelta(ref = {}, bucket = {}) {
  const bucketId = bucket.id ?? ref.trainingWeightState ?? null
  return {
    key: loraReadyRefKey(ref),
    id: ref.id ?? null,
    sourceTrajectoryId: ref.sourceTrajectoryId ?? null,
    validationTarget: ref.validationTarget ?? null,
    qualityGateStatus: ref.qualityGateStatus ?? null,
    adapterCapability: ref.adapterCapability ?? null,
    sourceKind: ref.sourceKind ?? "unknown",
    collectionResultId: ref.collectionResultId ?? null,
    collectionResult: ref.collectionResult ?? null,
    targetPatternId: ref.targetPatternId ?? null,
    bucketId,
    bucketLabel: bucket.label ?? adapterBatchBucketSpec(bucketId).label,
    trainingWeightState: ref.trainingWeightState ?? bucketId,
    effectiveWeightMultiplier: loraReadyRefWeight(ref, bucket),
    recommendedSampling: bucket.recommendedSampling ?? null,
    reviewed: ref.reviewed === true,
  }
}

function loraReadyRefContextsFromManifest(manifest = null) {
  const refsById = new Map(
    (manifest?.candidateRefs ?? [])
      .filter((ref) => ref?.id)
      .map((ref) => [ref.id, ref]),
  )
  const contexts = []
  const seen = new Set()
  const push = (context) => {
    if (!context?.key || seen.has(context.key)) return
    seen.add(context.key)
    contexts.push(context)
  }
  for (const bucket of manifest?.adapterBatchRecipe?.buckets ?? []) {
    for (const candidateId of bucket.candidateIds ?? []) {
      const ref = refsById.get(candidateId)
      if (ref) push(compactLoraReadyRefForDelta(ref, bucket))
    }
  }
  for (const ref of manifest?.candidateRefs ?? []) {
    push(compactLoraReadyRefForDelta(ref))
  }
  return contexts
}

function mapLoraReadyRefContexts(contexts = []) {
  const map = new Map()
  for (const context of contexts) {
    if (context.key && !map.has(context.key)) map.set(context.key, context)
  }
  return map
}

function loraRefreshMovement(before = null, after = null) {
  if (!before && after) return "moved_in"
  if (before && !after) return "moved_out"
  const beforeWeight = finiteNumber(before?.effectiveWeightMultiplier)
  const afterWeight = finiteNumber(after?.effectiveWeightMultiplier)
  if (beforeWeight !== null && afterWeight !== null && afterWeight > beforeWeight) return "upweighted"
  if (beforeWeight !== null && afterWeight !== null && afterWeight < beforeWeight) return "downweighted"
  if ((before?.bucketId ?? before?.trainingWeightState) !== (after?.bucketId ?? after?.trainingWeightState)) return "rerouted"
  return "unchanged"
}

const LORA_REFRESH_MOVEMENT_PRIORITY = new Map([
  ["upweighted", 0],
  ["downweighted", 1],
  ["rerouted", 2],
  ["moved_in", 3],
  ["moved_out", 4],
  ["unchanged", 5],
])

function compactLoraRefreshMovementState(state = null) {
  if (!state) return null
  return {
    bucketId: state.bucketId ?? null,
    bucketLabel: state.bucketLabel ?? null,
    trainingWeightState: state.trainingWeightState ?? null,
    effectiveWeightMultiplier: typeof state.effectiveWeightMultiplier === "number" ? state.effectiveWeightMultiplier : null,
    recommendedSampling: state.recommendedSampling ?? null,
  }
}

function compactLoraRefreshMovement(item = {}) {
  return {
    key: item?.key ?? null,
    id: item?.id ?? null,
    sourceTrajectoryId: item?.sourceTrajectoryId ?? null,
    validationTarget: item?.validationTarget ?? null,
    adapterCapability: item?.adapterCapability ?? null,
    movement: item?.movement ?? null,
    before: compactLoraRefreshMovementState(item?.before),
    after: compactLoraRefreshMovementState(item?.after),
  }
}

function sortLoraRefreshMovements(movements = []) {
  return movements
    .slice()
    .sort((left, right) => (LORA_REFRESH_MOVEMENT_PRIORITY.get(left?.movement) ?? 9) - (LORA_REFRESH_MOVEMENT_PRIORITY.get(right?.movement) ?? 9))
}

function buildLoraRefreshMovementIndex(movements = []) {
  const index = {}
  for (const movement of sortLoraRefreshMovements(movements)) {
    const sourceTrajectoryId = movement?.sourceTrajectoryId
    if (!sourceTrajectoryId || index[sourceTrajectoryId]) continue
    index[sourceTrajectoryId] = compactLoraRefreshMovement(movement)
  }
  return index
}

function compactLoraRefreshMovementIndex(index = {}) {
  const compacted = {}
  for (const [key, movement] of Object.entries(index ?? {})) {
    const sourceTrajectoryId = movement?.sourceTrajectoryId ?? key
    if (!sourceTrajectoryId) continue
    compacted[sourceTrajectoryId] = compactLoraRefreshMovement({
      ...movement,
      sourceTrajectoryId,
    })
  }
  return compacted
}

function loraRefreshMovementEqual(left = {}, right = {}) {
  return JSON.stringify(compactLoraRefreshMovement(left)) === JSON.stringify(compactLoraRefreshMovement(right))
}

function loraDeltaStateCount(contexts = [], states = [], samplings = []) {
  return contexts.filter((context) => {
    const stateValues = [context.bucketId, context.trainingWeightState].filter(Boolean)
    return stateValues.some((value) => states.includes(value))
      || Boolean(context.recommendedSampling && samplings.includes(context.recommendedSampling))
  }).length
}

function loraDeltaCounts(movements = [], afterContexts = []) {
  return {
    totalBefore: movements.filter((item) => item.before).length,
    totalAfter: movements.filter((item) => item.after).length,
    upweighted: movements.filter((item) => item.movement === "upweighted").length,
    downweighted: movements.filter((item) => item.movement === "downweighted").length,
    unchanged: movements.filter((item) => item.movement === "unchanged").length,
    rerouted: movements.filter((item) => item.movement === "rerouted").length,
    movedIn: movements.filter((item) => item.movement === "moved_in").length,
    movedOut: movements.filter((item) => item.movement === "moved_out").length,
    evidenceGap: loraDeltaStateCount(afterContexts, ["evidence_gap_downweight"], ["hold_for_evidence"]),
    rejected: loraDeltaStateCount(afterContexts, ["human_rejected_zero_weight"], ["exclude_from_positive_adapter"]),
    preferenceOrRisk: loraDeltaStateCount(afterContexts, ["human_risk_downweight"], ["prefer_eval_and_negative_mix"]),
    adapterApproved: loraDeltaStateCount(afterContexts, ["human_approved_upweight"], ["priority_include"]),
  }
}

function buildLoraReadyBatchRefreshDelta(previousManifest = null, currentManifest = null) {
  if (!previousManifest || previousManifest.schema !== STOCK_FEEDBACK_LORA_READY_MANIFEST_SCHEMA) return null
  if (!currentManifest || currentManifest.schema !== STOCK_FEEDBACK_LORA_READY_MANIFEST_SCHEMA) return null
  const beforeContexts = loraReadyRefContextsFromManifest(previousManifest)
  const afterContexts = loraReadyRefContextsFromManifest(currentManifest)
  if (beforeContexts.length === 0 && afterContexts.length === 0) return null
  const beforeByKey = mapLoraReadyRefContexts(beforeContexts)
  const afterByKey = mapLoraReadyRefContexts(afterContexts)
  const keys = [...new Set([...beforeByKey.keys(), ...afterByKey.keys()])].sort()
  const movements = keys.map((key) => {
    const before = beforeByKey.get(key) ?? null
    const after = afterByKey.get(key) ?? null
    return {
      key,
      id: after?.id ?? before?.id ?? null,
      sourceTrajectoryId: after?.sourceTrajectoryId ?? before?.sourceTrajectoryId ?? null,
      validationTarget: after?.validationTarget ?? before?.validationTarget ?? null,
      adapterCapability: after?.adapterCapability ?? before?.adapterCapability ?? null,
      movement: loraRefreshMovement(before, after),
      before: before ? {
        bucketId: before.bucketId,
        bucketLabel: before.bucketLabel,
        trainingWeightState: before.trainingWeightState,
        effectiveWeightMultiplier: before.effectiveWeightMultiplier,
        recommendedSampling: before.recommendedSampling,
      } : null,
      after: after ? {
        bucketId: after.bucketId,
        bucketLabel: after.bucketLabel,
        trainingWeightState: after.trainingWeightState,
        effectiveWeightMultiplier: after.effectiveWeightMultiplier,
        recommendedSampling: after.recommendedSampling,
      } : null,
    }
  })
  const counts = loraDeltaCounts(movements, afterContexts)
  const movementSummary = [
    counts.upweighted ? `upweighted=${counts.upweighted}` : "",
    counts.downweighted ? `downweighted=${counts.downweighted}` : "",
    counts.movedIn ? `moved_in=${counts.movedIn}` : "",
    counts.movedOut ? `moved_out=${counts.movedOut}` : "",
    counts.rejected ? `rejected=${counts.rejected}` : "",
    counts.preferenceOrRisk ? `preference_or_risk=${counts.preferenceOrRisk}` : "",
    counts.adapterApproved ? `adapter_approved=${counts.adapterApproved}` : "",
  ].filter(Boolean)
  return {
    schema: STOCK_FEEDBACK_LORA_READY_BATCH_REFRESH_DELTA_SCHEMA,
    strategy: "candidate_ref_weight_bucket_diff_v1",
    previousManifestPath: previousManifest.artifactPath ?? null,
    previousGeneratedAt: previousManifest.generatedAt ?? null,
    currentGeneratedAt: currentManifest.generatedAt ?? null,
    counts,
    movements,
    movementIndex: buildLoraRefreshMovementIndex(movements),
    summary: movementSummary.length
      ? movementSummary.join(" / ")
      : "no_material_candidate_weight_change",
    detail: "Compares candidate refs, adapter buckets and effective weights only; raw facts, announcement text and price rows remain in retrieval/tool state.",
    peftBoundary: {
      modelTrainingStarted: false,
      storesRawFacts: false,
      factsRemainIn: ["wiki/raw/facts/tool-state", "stock price SQL", "sourceRefs"],
      adapterStores: ["behavior", "skill", "tool habit", "decision strategy"],
    },
  }
}

function patternRadarStatus({ totalTrajectories, adapterCandidateCount, approvedCount, riskControlCount, profitableCount, lossCount, reviewedCount }) {
  if (totalTrajectories === 0) return { status: "missing", nextAction: "collect_market_pattern_case" }
  if (riskControlCount > 0 || lossCount > 0) return { status: "risk_control_ready", nextAction: "add_to_preference_eval" }
  if (approvedCount > 0 || adapterCandidateCount > 0) return { status: "adapter_ready", nextAction: "export_lora_ready_candidate" }
  if (profitableCount > 0) return { status: "needs_review", nextAction: "human_review_for_adapter" }
  if (reviewedCount === 0) return { status: "needs_review", nextAction: "human_review_pattern_case" }
  return { status: "covered", nextAction: "monitor_more_feedback" }
}

function validationTargetForMarketPattern(patternId) {
  if (["event_expectation_front_run", "low_absorption_breakout"].includes(patternId)) return "expectation_trade"
  if (patternId === "priced_in_late_entry") return "priced_in_risk"
  if (patternId === "failed_catalyst_one_day_hype") return "disconfirmation"
  if (patternId === "fundamental_closure_confirmation") return "fundamental_closure"
  return "expectation_trade"
}

function validationTargetForProfitCredit(creditId) {
  if (creditId === "pattern_execution_supported") return "expectation_trade"
  if (creditId === "execution_risk_negative") return "priced_in_risk"
  if (creditId === "failed_expectation_negative") return "disconfirmation"
  return "expectation_trade"
}

function profitFeedbackFilterForCredit(creditId) {
  if (creditId === "pattern_execution_supported") return "profitable"
  if (["execution_risk_negative", "failed_expectation_negative"].includes(creditId)) return "risk_negative"
  return "all"
}

function collectionTaskProfile(pattern = {}) {
  const commonBoundary = {
    storesRawFacts: false,
    factsRemainIn: ["retrieval/tool state", "sourceRefs", "price SQL", "wiki/raw/facts"],
    adapterStores: ["behavior", "skill", "tool_habit", "decision_strategy"],
  }
  const commonCriteria = [
    "sourceRefs point to retrieval/tool state instead of raw fact bodies",
    "adapter candidate only summarizes reusable behavior, skill, tool habit and decision strategy",
  ]
  if (pattern.id === "fundamental_closure_confirmation") {
    return {
      goal: "补齐订单、公告、财报、ASP 或毛利率兑现证据，形成基本面兑现闭环样本。",
      humanPrompt: "找一个基本面兑现样本：先保留公告/订单/财报原文在 retrieval/tool state，再只把判断路线沉淀给 adapter。",
      requiredToolState: ["retrieval:announcements-orders-financials", "tool-state:fundamental-evidence-confirmation", "retrieval:sourceRefs"],
      acceptanceCriteria: [
        "fundamentalEvidenceConfirmed=true",
        "order_or_announcement_or_financials_or_ASP_or_margin evidence exists",
        "short-term price move alone is not enough for fundamental_closure",
        ...commonCriteria,
      ],
      sampleMustInclude: ["confirmedEvidenceRefs", "qualityGate=fundamental_validated", "validationTarget=fundamental_closure"],
      peftBoundary: commonBoundary,
    }
  }
  if (pattern.id === "priced_in_late_entry") {
    return {
      goal: "补齐方向正确但赔率压缩、后手追涨风险升高的偏好/eval 样本。",
      humanPrompt: "找一个 priced-in 样本：方向被市场验证，但买点靠后、承接变差或回撤扩大，应训练模型降低追涨权重。",
      requiredToolState: ["market-data:late-entry-odds-and-follow-through", "tool-state:entry-risk-review", "retrieval:sourceRefs"],
      acceptanceCriteria: [
        "direction validated but entry risk increased",
        "priced_in_or_entry_wrong attribution is explicit",
        "loss_or_drawdown_or_risk_review exists when available",
        ...commonCriteria,
      ],
      sampleMustInclude: ["validationTarget=priced_in_risk", "qualityGate=priced_in_validated", "routeTo=preference/eval"],
      peftBoundary: commonBoundary,
    }
  }
  if (pattern.id === "failed_catalyst_one_day_hype") {
    return {
      goal: "补齐无承接、一日游或被证伪的失败预期样本。",
      humanPrompt: "找一个失败催化样本：记录为什么没有扩散、没有承接或被证伪，用作负样本和失败归因训练。",
      requiredToolState: ["market-data:no-follow-through-or-failed-diffusion", "tool-state:negative-catalyst-review", "retrieval:sourceRefs"],
      acceptanceCriteria: [
        "no_follow_through_or_failed_diffusion is explicit",
        "disconfirmed reason is timestamped",
        "routeTo=preference/eval negative sample",
        ...commonCriteria,
      ],
      sampleMustInclude: ["validationTarget=disconfirmation", "qualityGate=disconfirmed_validated", "failure attribution"],
      peftBoundary: commonBoundary,
    }
  }
  if (pattern.id === "low_absorption_breakout") {
    return {
      goal: "补齐低位吸收后转强、试错到加仓节奏的预期交易样本。",
      humanPrompt: "找一个低位吸收转强样本：先小仓试错，转强、扩散和承接确认后再加仓，事实仍留在 retrieval/tool state。",
      requiredToolState: ["market-data:relative-strength-turnover-follow-through", "retrieval:theme-diffusion-sourceRefs", "tool-state:self-question-attribution"],
      acceptanceCriteria: [
        "low_absorption signal appears before breakout",
        "relativeStrengthOrVolume=true",
        "followThroughOrDiffusion=true",
        "entryTiming_or_positionSizing captured when available",
        ...commonCriteria,
      ],
      sampleMustInclude: ["validationTarget=expectation_trade", "qualityGate=expectation_validated", "marketPattern=low_absorption_breakout"],
      peftBoundary: commonBoundary,
    }
  }
  return {
    goal: "补齐事件未落地前被资金交易验证的预期交易样本。",
    humanPrompt: "找一个事件预期先炒样本：订单/公告/财报未落地也可以训练预期交易判断，但必须有时间戳、相对强度、成交额、扩散和承接证据。",
    requiredToolState: ["market-data:price-volume-validation", "market-data:relative-strength-turnover-follow-through", "retrieval:theme-diffusion-sourceRefs"],
    acceptanceCriteria: [
      "timestamp exists before formal fundamental landing",
      "relativeStrengthOrVolume=true",
      "followThroughOrDiffusion=true",
      "market traded expectation is separated from fundamental closure",
      ...commonCriteria,
    ],
    sampleMustInclude: ["validationTarget=expectation_trade", "qualityGate=expectation_validated", "sourceRefs"],
    peftBoundary: commonBoundary,
  }
}

function profitCreditCollectionTaskProfile(credit = {}) {
  const commonBoundary = {
    storesRawFacts: false,
    factsRemainIn: ["retrieval/tool state", "sourceRefs", "price SQL", "trade ledger", "wiki/raw/facts"],
    adapterStores: ["behavior", "skill", "tool_habit", "decision_strategy"],
  }
  const commonCriteria = [
    "sourceRefs point to retrieval/tool state instead of raw fact bodies",
    "trade ledger or reviewed profit feedback is referenced, not copied as raw rows",
    "adapter candidate only summarizes reusable behavior, skill, tool habit and decision strategy",
  ]
  if (credit.id === "execution_risk_negative") {
    return {
      goal: "补齐方向正确但买点、仓位或止损导致亏损的执行风险负样本。",
      humanPrompt: "找一个执行风险负样本：方向或主题被市场交易过，但后手追涨、仓位过重、回撤扩大或止损慢造成亏损。",
      requiredToolState: ["market-data:late-entry-odds-and-follow-through", "trade ledger:realized-pnl-drawdown", "tool-state:entry-risk-review", "retrieval:sourceRefs"],
      acceptanceCriteria: [
        "primaryCredit=execution_risk_negative",
        "profitFeedback.outcome=loss_or_direction_right_entry_risk",
        "entryTiming_or_positionSizing_or_exitTiming explains the loss",
        "routeTo=eval/preference negative sample",
        ...commonCriteria,
      ],
      sampleMustInclude: ["validationTarget=priced_in_risk", "profitCredit=execution_risk_negative", "realizedPnlPct_or_maxDrawdownPct"],
      peftBoundary: commonBoundary,
    }
  }
  if (credit.id === "failed_expectation_negative") {
    return {
      goal: "补齐无承接、一日游或预期被证伪后的失败归因负样本。",
      humanPrompt: "找一个失败预期样本：记录为什么预期没有扩散、没有承接或被证伪，收益反馈只作为失败归因证据。",
      requiredToolState: ["market-data:no-follow-through-or-failed-diffusion", "trade ledger:realized-pnl-drawdown", "tool-state:negative-catalyst-review", "retrieval:sourceRefs"],
      acceptanceCriteria: [
        "primaryCredit=failed_expectation_negative",
        "disconfirmed reason is timestamped",
        "no_follow_through_or_failed_diffusion is explicit",
        "routeTo=eval/preference negative sample",
        ...commonCriteria,
      ],
      sampleMustInclude: ["validationTarget=disconfirmation", "profitCredit=failed_expectation_negative", "failure attribution"],
      peftBoundary: commonBoundary,
    }
  }
  return {
    goal: "补齐真实盈利、低回撤和进出场节奏清晰的正向执行样本。",
    humanPrompt: "找一个收益支持手法执行样本：收益来自可复用的买点、仓位和兑现纪律，而不是单只股票事实或行情 beta。",
    requiredToolState: ["trade ledger:realized-pnl-drawdown", "market-data:relative-strength-turnover-follow-through", "tool-state:self-question-attribution", "retrieval:sourceRefs"],
    acceptanceCriteria: [
      "primaryCredit=pattern_execution_supported",
      "profitFeedback.outcome=profitable",
      "drawdown_and_holding_period are reviewed",
      "entryTiming_or_positionSizing_or_exitTiming captures reusable execution",
      ...commonCriteria,
    ],
    sampleMustInclude: ["validationTarget=expectation_trade", "profitCredit=pattern_execution_supported", "realizedPnlPct>0"],
    peftBoundary: commonBoundary,
  }
}

function collectionTaskForPattern(pattern = {}, health = {}, counts = {}) {
  if (!["missing", "needs_review"].includes(health.status)) return null
  const validationTarget = validationTargetForMarketPattern(pattern.id)
  const profile = collectionTaskProfile(pattern)
  return {
    schema: "stock-feedback-collection-task-v1",
    taskId: `stockfb_collect_${shortHash(`${pattern.id}:${health.status}:${validationTarget}`)}`,
    targetPatternId: pattern.id,
    targetPatternLabel: pattern.label,
    validationTarget,
    adapterCapability: pattern.adapterCapability,
    recommendedAction: health.nextAction,
    priority: health.status === "missing" ? "high" : "medium",
    status: health.status,
    goal: profile.goal,
    humanPrompt: profile.humanPrompt,
    requiredToolState: profile.requiredToolState,
    acceptanceCriteria: profile.acceptanceCriteria,
    sampleMustInclude: profile.sampleMustInclude,
    suggestedFilters: {
      marketPattern: pattern.id,
      validationTarget,
      qualityGate: health.status === "missing" ? null : "review_required",
    },
    currentCounts: {
      totalTrajectories: counts.totalTrajectories ?? 0,
      reviewedTrajectories: counts.reviewedTrajectories ?? 0,
      adapterCandidates: counts.adapterCandidates ?? 0,
    },
    peftBoundary: profile.peftBoundary,
  }
}

function collectionTaskForProfitCredit(credit = {}, summary = {}) {
  if (!credit?.id) return null
  const validationTarget = validationTargetForProfitCredit(credit.id)
  const profile = profitCreditCollectionTaskProfile(credit)
  const count = summary.byProfitCredit?.[credit.id] ?? 0
  return {
    schema: "stock-feedback-collection-task-v1",
    bucket: "profit_credit",
    taskId: `stockfb_collect_profit_${shortHash(`${credit.id}:${validationTarget}`)}`,
    targetProfitCredit: credit.id,
    targetProfitCreditLabel: credit.label,
    targetPatternId: null,
    targetPatternLabel: null,
    validationTarget,
    adapterCapability: credit.adapterCapability ?? TARGET_TO_CAPABILITY[validationTarget],
    recommendedAction: credit.recommendedAction,
    priority: count === 0 ? "high" : "medium",
    status: count === 0 ? "missing" : "needs_review",
    goal: profile.goal,
    humanPrompt: profile.humanPrompt,
    requiredToolState: profile.requiredToolState,
    acceptanceCriteria: profile.acceptanceCriteria,
    sampleMustInclude: profile.sampleMustInclude,
    suggestedFilters: {
      profitCredit: credit.id,
      profitFeedback: profitFeedbackFilterForCredit(credit.id),
      validationTarget,
      qualityGate: null,
    },
    currentCounts: {
      profitCreditTrajectories: count,
      totalTrajectories: summary.total ?? 0,
    },
    peftBoundary: profile.peftBoundary,
  }
}

function buildPatternRadar(trajectories = [], latestReviewMap = new Map(), adapterCandidates = []) {
  const candidatePatternIds = new Set()
  for (const candidate of adapterCandidates) {
    for (const patternId of candidate.marketPatternIds ?? []) candidatePatternIds.add(patternId)
  }
  const items = STOCK_FEEDBACK_MARKET_PATTERNS.map((pattern) => {
    const patternTrajectories = trajectories.filter((trajectory) => (trajectory.marketPatterns ?? []).some((item) => item.id === pattern.id))
    const reviewSignals = patternTrajectories.map((trajectory) => reviewSignalForTrajectory(trajectory, latestReviewMap.get(trajectory.id) ?? null))
    const approvedCount = reviewSignals.filter((signal) => signal.latestAction === "approve_for_adapter").length
    const riskControlCount = reviewSignals.filter((signal) => ["route_to_preference", "mark_entry_wrong", "mark_priced_in"].includes(signal.latestAction)).length
    const profitableCount = patternTrajectories.filter((trajectory) => trajectory.profitFeedback?.outcome === "profitable").length
    const lossCount = patternTrajectories.filter((trajectory) => ["loss", "failed_or_unprofitable", "direction_right_entry_risk"].includes(trajectory.profitFeedback?.outcome)).length
    const adapterCandidateCount = patternTrajectories.filter((trajectory) => trajectory.routing?.adapterCandidate).length
    const reviewedCount = reviewSignals.filter((signal) => signal.reviewed).length
    const health = patternRadarStatus({
      totalTrajectories: patternTrajectories.length,
      adapterCandidateCount: adapterCandidateCount + (candidatePatternIds.has(pattern.id) ? 1 : 0),
      approvedCount,
      riskControlCount,
      profitableCount,
      lossCount,
      reviewedCount,
    })
    const counts = {
      totalTrajectories: patternTrajectories.length,
      reviewedTrajectories: reviewedCount,
      adapterCandidates: adapterCandidateCount,
      approvedTrajectories: approvedCount,
      riskControlTrajectories: riskControlCount,
      profitableTrajectories: profitableCount,
      lossTrajectories: lossCount,
    }
    const collectionTask = collectionTaskForPattern(pattern, health, counts)
    return {
      id: pattern.id,
      label: pattern.label,
      adapterCapability: pattern.adapterCapability,
      distillationHint: pattern.distillationHint,
      counts,
      health,
      collectionTask,
      evidenceRefs: [...new Set(patternTrajectories.flatMap((trajectory) => compactStringArray(trajectory.sourceRefs, 4, 180)))].slice(0, 8),
    }
  }).sort((a, b) => (
    (a.health.status === "missing" ? 1 : 0) - (b.health.status === "missing" ? 1 : 0) ||
    b.counts.totalTrajectories - a.counts.totalTrajectories ||
    a.id.localeCompare(b.id)
  ))
  const gaps = items
    .filter((item) => ["missing", "needs_review"].includes(item.health.status))
    .map((item) => ({
      bucket: "market_pattern",
      id: item.id,
      label: item.label,
      recommendedAction: item.health.nextAction,
      taskId: item.collectionTask?.taskId ?? null,
    }))
  const collectionTasks = items.map((item) => item.collectionTask).filter(Boolean)
  const topNextActions = Object.entries(countBy(items, (item) => item.health.nextAction))
    .map(([action, count]) => ({ action, count }))
    .sort((a, b) => b.count - a.count || a.action.localeCompare(b.action))
  return {
    schema: "stock-feedback-pattern-radar-v1",
    strategy: "market_pattern_health_v1",
    counts: {
      totalPatterns: items.length,
      coveredPatterns: items.filter((item) => item.counts.totalTrajectories > 0).length,
      missingPatterns: items.filter((item) => item.health.status === "missing").length,
      needsReviewPatterns: items.filter((item) => item.health.status === "needs_review").length,
      adapterReadyPatterns: items.filter((item) => item.health.status === "adapter_ready").length,
      riskControlPatterns: items.filter((item) => item.health.status === "risk_control_ready").length,
    },
    items,
    gaps,
    collectionTasks,
    topNextActions,
    peftBoundary: {
      storesRawFacts: false,
      factsRemainIn: ["retrieval/tool state", "sourceRefs", "price SQL"],
      adapterStores: ["behavior", "skill", "tool_habit", "decision_strategy"],
    },
  }
}

function collectionTaskDraftFromTask(task = {}, { projectPath, generatedAt }) {
  const targetPatternId = task.targetPatternId ?? task.suggestedFilters?.marketPattern ?? null
  const targetProfitCredit = task.targetProfitCredit ?? task.suggestedFilters?.profitCredit ?? null
  return {
    schema: STOCK_FEEDBACK_COLLECTION_TASK_DRAFT_SCHEMA,
    id: `stockfb_collection_draft_${shortHash(`${task.taskId ?? targetPatternId ?? targetProfitCredit}:${generatedAt}`)}`,
    generatedAt,
    taskId: task.taskId ?? null,
    targetPatternId,
    targetPatternLabel: task.targetPatternLabel ?? targetPatternId,
    targetProfitCredit,
    targetProfitCreditLabel: task.targetProfitCreditLabel ?? targetProfitCredit,
    validationTarget: task.validationTarget ?? null,
    adapterCapability: task.adapterCapability ?? null,
    priority: task.priority ?? "medium",
    status: "open",
    goal: task.goal ?? "",
    humanPrompt: task.humanPrompt ?? "",
    humanSteps: targetProfitCredit ? [
      "先确认这是要补的收益归因训练缺口，而不是单只股票事实沉淀。",
      "用 requiredToolState 在 retrieval/tool state 和 trade ledger 中找盈亏、回撤、买点、仓位和承接证据。",
      "采集单只填写 evidenceRefs、验证结论和可复用执行/风控判断路线，不复制原始公告/研报/价格明细正文。",
      "满足 acceptanceCriteria 后再由 stock-feedback build-trajectories/review/export-lora-ready 进入训练分流。",
    ] : [
      "先确认这是要补的手法模式样本，而不是单只股票事实沉淀。",
      "用 requiredToolState 在 retrieval/tool state 中找公告、订单、财报、价格、成交额或扩散证据。",
      "采集单只填写 evidenceRefs、验证结论和可复用判断路线，不复制原始公告/研报/价格明细正文。",
      "满足 acceptanceCriteria 后再由 stock-feedback build-trajectories/review/export-lora-ready 进入训练分流。",
    ],
    requiredToolState: task.requiredToolState ?? [],
    acceptanceCriteria: task.acceptanceCriteria ?? [],
    sampleMustInclude: task.sampleMustInclude ?? [],
    suggestedFilters: task.suggestedFilters ?? {
      marketPattern: targetPatternId,
      validationTarget: task.validationTarget ?? null,
      qualityGate: null,
    },
    intakeTemplate: {
      stockName: "",
      stockCode: "",
      hypothesis: "",
      observationWindow: "",
      evidenceRefs: [],
      marketSignals: [],
      profitFeedback: {
        realizedPnlPct: null,
        maxDrawdownPct: null,
        holdingDays: null,
      },
      humanNotes: "",
      rawFactBody: null,
      marketDataRows: null,
    },
    suggestedCommands: [
      targetProfitCredit ? `stock-feedback collection-task --profit-credit ${targetProfitCredit}` : `stock-feedback list --market-pattern ${targetPatternId}`,
      "stock-feedback build-trajectories --write",
      "stock-feedback review-queue --include-reviewed",
      "stock-feedback export-lora-ready --quality-gate high_confidence --write",
    ].filter((item) => !item.includes("null")),
    currentCounts: task.currentCounts ?? {},
    peftBoundary: task.peftBoundary ?? {
      storesRawFacts: false,
      factsRemainIn: ["retrieval/tool state", "sourceRefs", "price SQL", "wiki/raw/facts"],
      adapterStores: ["behavior", "skill", "tool_habit", "decision_strategy"],
    },
    writeBoundary: {
      projectPath,
      root: STOCK_FEEDBACK_ROOT,
      family: "collection-tasks",
      wroteWiki: false,
      wroteRaw: false,
      wroteBrain: false,
    },
  }
}

async function readStockFeedbackCollectionTaskDrafts(projectPath) {
  return readStockFeedbackJsonlFamily(normalizePath(projectPath), "collection-tasks", STOCK_FEEDBACK_COLLECTION_TASK_DRAFT_SCHEMA)
}

async function readStockFeedbackCollectionResults(projectPath) {
  return readStockFeedbackJsonlFamily(normalizePath(projectPath), "collection-results", STOCK_FEEDBACK_COLLECTION_RESULT_SCHEMA)
}

async function readStockFeedbackPaperTradeEvents(projectPath) {
  return readStockFeedbackJsonlFamily(normalizePath(projectPath), "paper-trades", STOCK_FEEDBACK_PAPER_TRADE_SCHEMA)
}

async function readStockFeedbackEvidenceTaskEvents(projectPath) {
  return readStockFeedbackJsonlFamily(normalizePath(projectPath), "evidence-tasks", STOCK_FEEDBACK_EVIDENCE_TASK_SCHEMA)
}

async function readStockFeedbackEvidenceResultEvents(projectPath) {
  return readStockFeedbackJsonlFamily(normalizePath(projectPath), "evidence-results", STOCK_FEEDBACK_EVIDENCE_RESULT_SCHEMA)
}

async function readStockFeedbackEvidenceRunEvents(projectPath) {
  return readStockFeedbackJsonlFamily(normalizePath(projectPath), "evidence-runs", STOCK_FEEDBACK_EVIDENCE_RUN_SCHEMA)
}

async function readStockFeedbackEvidenceDlqEvents(projectPath) {
  return readStockFeedbackJsonlFamily(normalizePath(projectPath), "evidence-dlq", STOCK_FEEDBACK_EVIDENCE_DLQ_SCHEMA)
}

function parseOptionalJsonObject(value, label = "json") {
  if (!value) return {}
  if (typeof value === "object" && !Array.isArray(value)) return value
  try {
    const parsed = JSON.parse(String(value))
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`${label} must be an object`)
    return parsed
  } catch (err) {
    throw new Error(`Invalid ${label}: ${safeErrorMessage(err)}`)
  }
}

function normalizeEvidenceSourceName(value) {
  const raw = normalizeToken(value)
  const aliases = new Map([
    ["tushare_pro", "tushare"],
    ["cn_info", "cninfo"],
    ["cn_info_announcement", "cninfo"],
    ["exchange", "cninfo"],
    ["exchange_announcement", "cninfo"],
    ["sse", "cninfo"],
    ["szse", "cninfo"],
    ["qichacha", "qcc"],
    ["tavily", "web"],
    ["manual_ref", "manual"],
  ])
  return aliases.get(raw) ?? raw
}

function defaultEvidenceSourcesForTask(task = {}) {
  const type = task.taskType
  if (type === "market_data") return ["tushare"]
  if (type === "limit_up_analysis") return ["tushare"]
  if (type === "institutional_flow") return ["tushare"]
  if (type === "financial_metrics") return ["cninfo", "tushare", "web"]
  if (type === "announcement") return ["cninfo", "web"]
  if (type === "tenders") return ["qcc", "web"]
  return ["web"]
}

function sourceReliabilityScore(source) {
  const name = normalizeEvidenceSourceName(source)
  return {
    cninfo: 95,
    tushare: 90,
    qcc: 84,
    web: 70,
    manual: 62,
  }[name] ?? 50
}

function evidenceTaskSortRank(task = {}) {
  const priorityRank = { high: 0, normal: 1, low: 2 }[task.priority] ?? 1
  return `${priorityRank}:${task.createdAt ?? task.generatedAt ?? ""}:${task.taskId ?? ""}`
}

function latestEvidenceTaskStates(events = []) {
  const ordered = events.slice().sort((left, right) => (
    String(left.updatedAt ?? left.generatedAt ?? "").localeCompare(String(right.updatedAt ?? right.generatedAt ?? "")) ||
    String(left.artifactPath ?? "").localeCompare(String(right.artifactPath ?? "")) ||
    Number(left.artifactLine ?? 0) - Number(right.artifactLine ?? 0) ||
    String(left.taskId ?? "").localeCompare(String(right.taskId ?? ""))
  ))
  const latest = new Map()
  for (const event of ordered) {
    if (!event.taskId) continue
    latest.set(event.taskId, event)
  }
  return [...latest.values()]
}

function latestEvidenceResultStates(events = []) {
  const ordered = events.slice().sort((left, right) => (
    String(left.updatedAt ?? left.generatedAt ?? "").localeCompare(String(right.updatedAt ?? right.generatedAt ?? "")) ||
    String(left.artifactPath ?? "").localeCompare(String(right.artifactPath ?? "")) ||
    Number(left.artifactLine ?? 0) - Number(right.artifactLine ?? 0) ||
    String(left.resultId ?? "").localeCompare(String(right.resultId ?? ""))
  ))
  const latest = new Map()
  for (const event of ordered) {
    if (!event.resultId) continue
    latest.set(event.resultId, event)
  }
  return [...latest.values()]
}

function latestEvidenceDlqStates(events = []) {
  const ordered = events.slice().sort((left, right) => (
    String(left.updatedAt ?? left.generatedAt ?? "").localeCompare(String(right.updatedAt ?? right.generatedAt ?? "")) ||
    String(left.artifactPath ?? "").localeCompare(String(right.artifactPath ?? "")) ||
    Number(left.artifactLine ?? 0) - Number(right.artifactLine ?? 0) ||
    String(left.id ?? "").localeCompare(String(right.id ?? ""))
  ))
  const latest = new Map()
  for (const event of ordered) {
    if (!event.id) continue
    latest.set(event.id, event)
  }
  return [...latest.values()]
}

function buildEvidenceTaskId({ generatedAt, stockCode, taskType, targetFields }) {
  const day = String(generatedAt ?? nowLocalTimestamp()).replace(/\D/g, "").slice(0, 8) || "00000000"
  const fingerprint = shortHash(`${stockCode}:${taskType}:${(targetFields ?? []).join(",")}:${generatedAt}`)
  return `ET-${day}-${fingerprint.slice(0, 8)}`
}

function compactEvidenceTask(task = {}) {
  return {
    taskId: task.taskId,
    status: task.status,
    source: task.source,
    sourceId: task.sourceId ?? null,
    stockCode: task.stockCode ?? null,
    stockName: task.stockName ?? null,
    taskType: task.taskType,
    targetFields: compactStringArray(task.targetFields, 20, 120),
    preferredSources: compactStringArray(task.preferredSources, 10, 80),
    priority: task.priority,
    overallConfidence: task.latestResultSummary?.overallConfidence ?? null,
    updatedAt: task.updatedAt ?? task.generatedAt ?? null,
    artifactPath: task.artifactPath ?? null,
  }
}

function isOfficialEvidenceRef(ref = "") {
  const text = String(ref ?? "").toLowerCase()
  if (/^(cninfo|sse|szse):announcement#/.test(text)) return true
  if (text.includes("static.cninfo.com.cn") || text.includes("static.sse.com.cn") || text.includes("disc.static.szse.cn") || text.includes("static.szse.cn")) return true
  return false
}

function evidenceResultHasHardSource(result = {}) {
  if ((result.sourceRefs ?? []).some(isOfficialEvidenceRef)) return true
  return (result.sources ?? []).some((source) => (
    source.status === "ok" &&
    (source.evidenceTier === "official_primary" || source.sourceKind === "official_disclosure" || (source.qualityFlags ?? []).includes("hard_source")) &&
    ((source.sourceRefs ?? []).some(isOfficialEvidenceRef) || (source.qualityFlags ?? []).includes("hard_source"))
  ))
}

function buildEvidenceResultReviewPlan(result = {}, context = {}) {
  const status = result.status ?? "unknown"
  const resultId = result.resultId ?? "<result-id>"
  const baseCommand = `stock-feedback evidence-result review --result-id ${resultId}`
  const hasHardSource = evidenceResultHasHardSource(result)
  const sameStockCompletedHardSource = Boolean(context.sameStockCompletedHardSource)
  if (status !== "awaiting_review") {
    return {
      status: "no_review_needed",
      riskLevel: "low",
      recommendedAction: "none",
      requiresHumanGate: false,
      approveCommand: null,
      rejectCommand: null,
      blockers: [],
    }
  }
  if (hasHardSource) {
    return {
      status: "hard_source_review_ready",
      riskLevel: "medium",
      recommendedAction: "approve_after_manual_source_check",
      requiresHumanGate: true,
      approveCommand: `${baseCommand} --action approve --reviewer <name> --note "采信官方硬源，人工确认后通过" --write`,
      rejectCommand: `${baseCommand} --action reject --reviewer <name> --note "官方硬源不匹配或口径不满足" --write`,
      blockers: [],
    }
  }
  if (sameStockCompletedHardSource) {
    return {
      status: "duplicate_web_lead_after_hard_source",
      riskLevel: "medium",
      recommendedAction: "reject_duplicate_or_mark_needs_more_evidence",
      requiresHumanGate: true,
      approveCommand: `${baseCommand} --action approve --reviewer <name> --note "人工确认该 web 线索补充硬源缺口" --write`,
      rejectCommand: `${baseCommand} --action reject --reviewer <name> --note "已有官方硬源覆盖，本 web 线索不提升证据权重" --write`,
      blockers: ["secondary_web_after_completed_hard_source"],
    }
  }
  return {
    status: "needs_manual_review_or_more_evidence",
    riskLevel: "high",
    recommendedAction: "seek_hard_source_before_approval",
    requiresHumanGate: true,
    approveCommand: `${baseCommand} --action approve --reviewer <name> --note "人工确认来源可靠且满足字段" --write`,
    rejectCommand: `${baseCommand} --action reject --reviewer <name> --note "缺少官方硬源或字段不满足" --write`,
    blockers: ["no_official_hard_source_detected"],
  }
}

function compactEvidenceResult(result = {}, context = {}) {
  return {
    resultId: result.resultId,
    taskId: result.taskId,
    status: result.status,
    stockCode: result.stockCode ?? null,
    stockName: result.stockName ?? null,
    taskType: result.taskType ?? null,
    overallConfidence: result.overallConfidence ?? null,
    sourceRefs: compactStringArray(result.sourceRefs, 8, 200),
    toolStateRefs: compactStringArray(result.toolStateRefs, 8, 200),
    evidenceRefs: compactStringArray(result.evidenceRefs, 8, 200),
    humanGate: result.humanGate ? {
      status: result.humanGate.status ?? null,
      action: result.humanGate.action ?? null,
      reviewer: result.humanGate.reviewer ?? null,
    } : null,
    updatedAt: result.updatedAt ?? result.generatedAt ?? null,
    artifactPath: result.artifactPath ?? null,
    reviewPlan: buildEvidenceResultReviewPlan(result, context),
  }
}

function completedHardSourceKeyForEvidenceResult(result = {}) {
  return `${result.stockCode ?? ""}:${result.taskType ?? ""}`
}

function buildEvidenceResultReviewAudit(evidenceResults = []) {
  const completedHardSourceKeys = new Set(evidenceResults
    .filter((result) => result.status === "completed" && evidenceResultHasHardSource(result))
    .map(completedHardSourceKeyForEvidenceResult))
  const awaiting = evidenceResults
    .filter((result) => result.status === "awaiting_review")
    .sort((a, b) => String(b.updatedAt ?? b.generatedAt ?? "").localeCompare(String(a.updatedAt ?? a.generatedAt ?? "")) || String(a.resultId).localeCompare(String(b.resultId)))
  const planned = awaiting.map((result) => compactEvidenceResult(result, {
    sameStockCompletedHardSource: completedHardSourceKeys.has(completedHardSourceKeyForEvidenceResult(result)),
  }))
  const reviewPlanCounts = {}
  for (const result of planned) {
    const planStatus = result.reviewPlan?.status ?? "unknown"
    reviewPlanCounts[planStatus] = (reviewPlanCounts[planStatus] ?? 0) + 1
  }
  return {
    schema: "stock-feedback-evidence-result-review-audit-v1",
    status: awaiting.length > 0 ? "human_review_required" : "clear",
    summary: awaiting.length > 0
      ? "EvidenceResult 仍有 HumanGate 待审；硬源可人工审批，重复 web 线索优先拒绝或降权。"
      : "没有 EvidenceResult 待审项。",
    counts: {
      awaitingReview: awaiting.length,
      hardSourceReviewReady: reviewPlanCounts.hard_source_review_ready ?? 0,
      duplicateWebLeadAfterHardSource: reviewPlanCounts.duplicate_web_lead_after_hard_source ?? 0,
      needsManualReviewOrMoreEvidence: reviewPlanCounts.needs_manual_review_or_more_evidence ?? 0,
      other: Object.entries(reviewPlanCounts)
        .filter(([key]) => !["hard_source_review_ready", "duplicate_web_lead_after_hard_source", "needs_manual_review_or_more_evidence"].includes(key))
        .reduce((sum, [, count]) => sum + count, 0),
    },
    reviewPlanCounts,
    items: planned.slice(0, 8),
  }
}

function normalizeEvidenceMockSources(task = {}, options = {}) {
  const adapterResults = options.adapterResults ?? options.sourceResults ?? null
  if (!adapterResults) return null
  if (Array.isArray(adapterResults)) return adapterResults
  if (adapterResults[task.taskId]) return adapterResults[task.taskId]
  if (adapterResults.default) return adapterResults.default
  return null
}

function normalizeEvidenceSourceResult(raw = {}, task = {}) {
  const source = normalizeEvidenceSourceName(raw.source ?? raw.name ?? raw.provider ?? "manual")
  const status = normalizeToken(raw.status ?? "ok") || "ok"
  const structuredData = raw.structuredData && typeof raw.structuredData === "object" && !Array.isArray(raw.structuredData)
    ? raw.structuredData
    : {}
  const sourceRefs = compactList(raw.sourceRefs ?? raw.sourceRef ?? raw.refs, 20, 260)
  const toolStateRefs = compactList(raw.toolStateRefs ?? raw.toolStateRef, 20, 260)
  return {
    source,
    status,
    sourceQuality: finiteNumber(raw.sourceQuality ?? raw.qualityScore) ?? sourceReliabilityScore(source),
    sourceKind: compactOptionalString(raw.sourceKind, 80),
    evidenceTier: compactOptionalString(raw.evidenceTier, 80),
    qualityFlags: compactStringArray(raw.qualityFlags, 20, 100),
    qualityNotes: compactStringArray(raw.qualityNotes, 10, 180),
    structuredData,
    summary: compactString(raw.summary ?? "", 500),
    sourceRefs,
    toolStateRefs,
    error: compactOptionalString(raw.error, 300),
    targetFields: compactStringArray(raw.targetFields ?? task.targetFields, 20, 120),
  }
}

function buildSyntheticEvidenceSourceResults(task = {}, options = {}) {
  const mock = normalizeEvidenceMockSources(task, options)
  if (mock) return mock.map((item) => normalizeEvidenceSourceResult(item, task))
  const sourceRefs = compactStringArray(task.sourceRefs, 20, 260)
  const toolStateRefs = compactStringArray(task.toolStateRefs, 20, 260)
  if (sourceRefs.length || toolStateRefs.length) {
    return [normalizeEvidenceSourceResult({
      source: "manual",
      status: "ok",
      sourceQuality: 62,
      structuredData: task.structuredData ?? {},
      summary: task.notes,
      sourceRefs,
      toolStateRefs,
    }, task)]
  }
  return (task.preferredSources?.length ? task.preferredSources : defaultEvidenceSourcesForTask(task))
    .map((source) => normalizeEvidenceSourceResult({
      source,
      status: "unavailable",
      error: "No adapter result or evidence refs were provided in this thin-slice runner.",
    }, task))
}

function tushareApiForEvidenceTask(task = {}) {
  if (task.taskType === "financial_metrics") return "fina_indicator"
  if (task.taskType === "institutional_flow") return "top_inst"
  if (task.taskType === "limit_up_analysis") return "limit_list_d"
  return "daily"
}

function tushareFieldsForEvidenceTask(task = {}, apiName = "daily") {
  const requested = compactStringArray(task.targetFields, 30, 80)
  const required = apiName === "daily"
    ? ["ts_code", "trade_date"]
    : ["ts_code"]
  return [...new Set([...required, ...requested])].join(",")
}

function compactTushareStructuredData(rows = [], targetFields = []) {
  const first = rows.find((row) => row && typeof row === "object") ?? null
  if (!first) return {}
  const fields = targetFields.length ? targetFields : Object.keys(first)
  const structuredData = {}
  for (const field of fields) {
    if (first[field] !== undefined && first[field] !== null && first[field] !== "") {
      structuredData[field] = first[field]
    }
  }
  return structuredData
}

async function buildTushareEvidenceSourceResult(task = {}, options = {}) {
  const tsCode = toTushareCode(task.stockCode)
  if (!tsCode) {
    return normalizeEvidenceSourceResult({
      source: "tushare",
      status: "failed",
      error: "Missing or invalid stock code for Tushare evidence task.",
    }, task)
  }
  const apiName = options.tushareApiName ?? options["tushare-api-name"] ?? tushareApiForEvidenceTask(task)
  const fields = tushareFieldsForEvidenceTask(task, apiName)
  const credentials = getCompanyResearchCredentials(options)
  const client = options.tushareClient ?? defaultTushareClient
  if (!credentials.tushareToken && !options.tushareClient) {
    return normalizeEvidenceSourceResult({
      source: "tushare",
      status: "failed",
      sourceQuality: 90,
      error: "Tushare token is not configured.",
      toolStateRefs: [`tool-state:tushare#${apiName}:auth=${credentials.status.tushare.auth}`],
    }, task)
  }
  try {
    const response = await client({
      apiName,
      token: credentials.tushareToken,
      params: { ts_code: tsCode },
      fields,
      timeoutMs: options.tushareTimeoutMs ?? options["tushare-timeout-ms"],
    })
    const normalized = normalizeTushareResponse(apiName, response)
    if (normalized.status !== "success") {
      return normalizeEvidenceSourceResult({
        source: "tushare",
        status: "failed",
        sourceQuality: 90,
        error: normalized.error ?? "Tushare request failed.",
        toolStateRefs: [`tool-state:tushare#${apiName}:status=failed`],
      }, task)
    }
    const rowCount = normalized.rows.length
    if (!rowCount) {
      return normalizeEvidenceSourceResult({
        source: "tushare",
        status: "failed",
        sourceQuality: 90,
        error: "Tushare returned no rows.",
        toolStateRefs: [`tool-state:tushare#${apiName}:rows=0`],
      }, task)
    }
    const structuredData = compactTushareStructuredData(normalized.rows, compactStringArray(task.targetFields, 30, 80))
    const refDate = normalized.rows[0]?.trade_date ?? normalized.rows[0]?.end_date ?? normalized.rows[0]?.ann_date ?? "latest"
    return normalizeEvidenceSourceResult({
      source: "tushare",
      status: "ok",
      sourceQuality: 90,
      structuredData,
      summary: `Tushare ${apiName} returned ${rowCount} rows for ${tsCode}.`,
      sourceRefs: [`tushare:${apiName}#${tsCode}/${refDate}`],
      toolStateRefs: [`tool-state:tushare#${apiName}:rows=${rowCount}:fields=${normalized.fields.length}`],
      targetFields: task.targetFields,
    }, task)
  } catch (err) {
    return normalizeEvidenceSourceResult({
      source: "tushare",
      status: "failed",
      sourceQuality: 90,
      error: safeErrorMessage(err),
      toolStateRefs: [`tool-state:tushare#${apiName}:status=error`],
    }, task)
  }
}

function buildTavilyEvidenceQuery(task = {}) {
  const stock = compactStringArray([task.stockName, task.stockCode], 2, 80).join(" ")
  const fields = compactStringArray(task.targetFields, 10, 80).join(" ")
  const notes = compactString(task.notes ?? "", 180)
  const taskTypeHints = {
    announcement: "公告 订单 客户 出货 收入确认 年报 季报",
    financial_metrics: "财务指标 毛利率 净利率 ROE 存货周转 年报 季报",
    tenders: "中标 招投标 采购 合同 客户",
    general: "公告 新闻 研报 业务进展",
  }
  const officialDisclosureHints = new Set(["announcement", "financial_metrics"]).has(task.taskType)
    ? "官方公告 巨潮资讯 上交所 深交所 年报 季报 PDF"
    : ""
  return compactString([
    stock,
    fields,
    taskTypeHints[task.taskType] ?? taskTypeHints.general,
    officialDisclosureHints,
    notes,
  ].filter(Boolean).join(" "), 500)
}

function exchangeColumnForStockCode(value = "") {
  const text = String(value ?? "").trim().toUpperCase()
  if (/\.SH$/.test(text) || /^SH/.test(text) || /^(6|9)/.test(text.replace(/\D/g, ""))) return "sse"
  if (/\.SZ$/.test(text) || /^SZ/.test(text) || /^(0|2|3)/.test(text.replace(/\D/g, ""))) return "szse"
  return ""
}

function cninfoAnnouncementQuery(task = {}) {
  const stock = compactStringArray([task.stockName, task.stockCode], 2, 80).join(" ")
  const fields = compactStringArray(task.targetFields, 10, 80)
    .flatMap((field) => tavilyTargetFieldAliases(field).slice(0, 3))
    .join(" ")
  const notes = compactString(task.notes ?? "", 120)
  return compactString([stock, fields, notes].filter(Boolean).join(" "), 300)
}

function cninfoPdfUrl(adjunctUrl = "") {
  const pathValue = String(adjunctUrl ?? "").trim().replace(/^\/+/, "")
  if (!pathValue) return ""
  if (/^https?:\/\//i.test(pathValue)) return pathValue
  return `https://static.cninfo.com.cn/${pathValue}`
}

function cninfoAnnouncementDate(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return null
  try {
    return new Date(numeric).toISOString().slice(0, 10)
  } catch {
    return null
  }
}

async function defaultCninfoAnnouncementClient({
  query,
  stockCode,
  pageSize = 8,
  timeoutMs = 12_000,
} = {}) {
  const column = exchangeColumnForStockCode(stockCode)
  const body = new URLSearchParams({
    stock: "",
    searchkey: query,
    plate: column,
    category: "",
    trade: "",
    column,
    columnTitle: "历史公告查询",
    pageNum: "1",
    pageSize: String(pageSize),
    tabName: "fulltext",
    sortName: "",
    sortType: "",
    limit: "",
    seDate: "",
  })
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch("https://www.cninfo.com.cn/new/hisAnnouncement/query", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "User-Agent": "Mozilla/5.0",
        "Referer": "https://www.cninfo.com.cn/new/commonUrl/pageOfSearch?url=disclosure/list/search",
      },
      body,
      signal: controller.signal,
    })
    const text = await response.text()
    if (!response.ok) throw new Error(`CNINFO request failed with HTTP ${response.status}`)
    return JSON.parse(text)
  } finally {
    clearTimeout(timer)
  }
}

function szsePdfUrl(attachPath = "") {
  const pathValue = String(attachPath ?? "").trim()
  if (!pathValue) return ""
  if (/^https?:\/\//i.test(pathValue)) return pathValue
  return `https://disc.static.szse.cn/download${pathValue.startsWith("/") ? pathValue : `/${pathValue}`}`
}

function szseAnnouncementDate(value) {
  const text = compactString(value ?? "", 40)
  const match = text.match(/(\d{4})[-/](\d{2})[-/](\d{2})/)
  if (match) return `${match[1]}-${match[2]}-${match[3]}`
  return cninfoAnnouncementDate(value)
}

async function defaultSzseAnnouncementClient({
  company = {},
  to,
  timeoutMs = 12_000,
  options = {},
} = {}) {
  const toDate = compactString(String(to ?? nowLocalTimestamp()).slice(0, 10), 20)
  const fromDate = compactString(options.szseStartDate ?? options["szse-start-date"] ?? addCalendarDays(toDate, -370), 20)
  const stockCode = compactString(company.stockCode ?? company.tsCode ?? company.stockInput ?? "", 32).replace(/\.(SZ|SH|BJ)$/i, "")
  const payload = {
    seDate: [fromDate, toDate],
    channelCode: ["fixed_disc"],
    pageSize: parsePositiveInteger(options.szsePageSize ?? options["szse-page-size"], 8),
    pageNum: 1,
    ...(stockCode ? { stock: [stockCode] } : {}),
    ...(company.stockName ? { keyword: compactString(company.stockName, 80) } : {}),
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`http://www.szse.cn/api/disc/announcement/annList?random=${Math.random()}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "User-Agent": "Mozilla/5.0",
        "Origin": "http://www.szse.cn",
        "Referer": "http://www.szse.cn/disclosure/listed/fixed/index.html",
        "X-Request-Type": "ajax",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    const text = await response.text()
    if (!response.ok) throw new Error(`SZSE request failed with HTTP ${response.status}`)
    const parsed = JSON.parse(text)
    const rows = Array.isArray(parsed?.data) ? parsed.data : []
    return {
      status: "success",
      announceCount: Number(parsed?.announceCount ?? rows.length) || rows.length,
      announcements: rows.map((item) => ({
        ...item,
        id: compactString(item?.annId ?? item?.id ?? "", 80),
        secCode: Array.isArray(item?.secCode) ? item.secCode[0] : item?.secCode,
        secName: Array.isArray(item?.secName) ? item.secName[0] : item?.secName,
        date: szseAnnouncementDate(item?.publishTime),
        downloadUrl: szsePdfUrl(item?.attachPath),
        source: "szse_public_web",
      })),
    }
  } finally {
    clearTimeout(timer)
  }
}

const TAVILY_OFFICIAL_EVIDENCE_DOMAINS = new Set([
  "cninfo.com.cn",
  "sse.com.cn",
  "szse.cn",
  "disc.static.szse.cn",
  "static.sse.com.cn",
  "static.szse.cn",
])

const TAVILY_SECONDARY_PORTAL_DOMAINS = new Set([
  "eastmoney.com",
  "finance.sina.com.cn",
  "vip.stock.finance.sina.com.cn",
  "q.stock.sohu.com",
  "sohu.com",
  "10jqka.com.cn",
  "hexun.com",
  "jrj.com.cn",
])

const TAVILY_SECONDARY_MEDIA_DOMAINS = new Set([
  "stcn.com",
  "cs.com.cn",
  "cnstock.com",
])

function hostnameMatches(hostname, domain) {
  if (!hostname || !domain) return false
  return hostname === domain || hostname.endsWith(`.${domain}`)
}

function hostnameMatchesAny(hostname, domains = new Set()) {
  for (const domain of domains) {
    if (hostnameMatches(hostname, domain)) return true
  }
  return false
}

function hostnameFromUrl(url) {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ""
  }
}

function officialDisclosureSourceRefFromUrl(url = "") {
  const normalizedUrl = compactString(url, 260)
  if (!normalizedUrl) return null
  const hostname = hostnameFromUrl(normalizedUrl)
  if (hostnameMatchesAny(hostname, new Set(["cninfo.com.cn"]))) return `cninfo:announcement#url:${shortHash(normalizedUrl)}`
  if (hostnameMatchesAny(hostname, new Set(["sse.com.cn", "static.sse.com.cn"]))) return `sse:announcement#url:${shortHash(normalizedUrl)}`
  if (hostnameMatchesAny(hostname, new Set(["szse.cn", "disc.static.szse.cn", "static.szse.cn"]))) return `szse:announcement#url:${shortHash(normalizedUrl)}`
  return null
}

function hasMojibakeText(value = "") {
  const text = String(value ?? "")
  if (!text) return false
  return /[�ÃÂ]/.test(text) || /(?:å|æ|ç)[^\s]{0,8}/.test(text)
}

function classifyTavilyEvidenceResult(result = {}) {
  const hostname = hostnameFromUrl(result.url)
  const qualityFlags = []
  let sourceKind = "unknown_web"
  let evidenceTier = "web_lead"
  let sourceQuality = 64

  if (hostnameMatchesAny(hostname, TAVILY_OFFICIAL_EVIDENCE_DOMAINS)) {
    sourceKind = "official_disclosure"
    evidenceTier = "official_primary"
    sourceQuality = 96
    qualityFlags.push("official_source")
    qualityFlags.push("hard_source")
    qualityFlags.push("discovered_via_web")
  } else if (hostnameMatchesAny(hostname, TAVILY_SECONDARY_MEDIA_DOMAINS)) {
    sourceKind = "secondary_media"
    evidenceTier = "secondary_media"
    sourceQuality = 64
    qualityFlags.push("secondary_media")
  } else if (hostnameMatchesAny(hostname, TAVILY_SECONDARY_PORTAL_DOMAINS)) {
    sourceKind = "secondary_portal"
    evidenceTier = "secondary_portal"
    sourceQuality = 58
    qualityFlags.push("secondary_portal")
  } else {
    qualityFlags.push("unverified_web_source")
  }

  if (hasMojibakeText(`${result.title ?? ""} ${result.content ?? ""}`)) {
    sourceQuality = Math.max(30, sourceQuality - 6)
    qualityFlags.push("text_quality_warning")
  }

  return {
    hostname,
    sourceKind,
    evidenceTier,
    sourceQuality,
    qualityFlags,
  }
}

const TAVILY_TARGET_FIELD_ALIASES = new Map([
  ["order", ["订单", "合同", "采购订单", "定点", "中标", "order", "contract"]],
  ["customer", ["客户", "大客户", "客户导入", "导入", "customer", "client"]],
  ["shipment", ["出货", "交付", "供货", "发货", "shipment", "delivery"]],
  ["revenue", ["收入", "营收", "收入确认", "revenue", "sales"]],
  ["annual_report", ["年度报告", "年报", "annual report"]],
  ["quarterly_report", ["季度报告", "一季度报告", "第一季度报告", "三季度报告", "第三季度报告", "季报", "quarterly report"]],
  ["semi_annual_report", ["半年度报告", "半年报", "中报", "semi-annual report", "interim report"]],
  ["announcement", ["公告", "披露", "报告", "报告摘要", "announcement", "disclosure"]],
  ["gross_margin", ["毛利率", "gross margin"]],
  ["net_profit", ["净利润", "归母净利润", "net profit"]],
  ["roe", ["roe", "净资产收益率"]],
  ["asp", ["asp", "均价", "单价"]],
])

function tavilyTargetFieldAliases(field) {
  const normalized = normalizeToken(field)
  const aliases = TAVILY_TARGET_FIELD_ALIASES.get(normalized) ?? []
  return [...new Set([String(field ?? ""), normalized, ...aliases].filter(Boolean))]
}

function tavilyEvidenceTextMatchesField(field, text) {
  const normalizedText = String(text ?? "").toLowerCase()
  return tavilyTargetFieldAliases(field).some((alias) => normalizedText.includes(String(alias).toLowerCase()))
}

function normalizeCninfoAnnouncementResults(response = {}) {
  const direct = Array.isArray(response?.announcements) ? response.announcements : []
  const classified = Array.isArray(response?.classifiedAnnouncements)
    ? response.classifiedAnnouncements.flatMap((group) => Array.isArray(group?.announcements) ? group.announcements : [])
    : []
  return [...direct, ...classified]
    .map((item, index) => {
      const announcementId = compactString(item?.announcementId ?? item?.id ?? "", 80)
      const secCode = compactString(item?.secCode ?? "", 32)
      const secName = compactString(item?.secName ?? "", 80)
      const title = compactString(String(item?.announcementTitle ?? "").replace(/<[^>]+>/g, ""), 180)
      const publishedDate = cninfoAnnouncementDate(item?.announcementTime)
      const pdfUrl = cninfoPdfUrl(item?.adjunctUrl)
      if (!announcementId && !title && !pdfUrl) return null
      return {
        rank: index + 1,
        announcementId,
        secCode,
        secName,
        title,
        publishedDate,
        pdfUrl,
        sourceRef: `cninfo:announcement#${secCode || "unknown"}/${announcementId || shortHash(pdfUrl || title)}`,
      }
    })
    .filter(Boolean)
}

function normalizeExchangeAnnouncementResults(response = {}) {
  return (Array.isArray(response?.announcements) ? response.announcements : [])
    .map((item, index) => {
      const source = compactString(item?.source ?? "", 80)
      const sourcePrefix = source.includes("sse") ? "sse" : source.includes("szse") ? "szse" : "exchange"
      const announcementId = compactString(item?.id ?? item?.announcementId ?? item?.annId ?? "", 80)
      const secCode = compactString(Array.isArray(item?.secCode) ? item.secCode[0] : item?.secCode ?? "", 32)
      const secName = compactString(Array.isArray(item?.secName) ? item.secName[0] : item?.secName ?? "", 80)
      const title = compactString(String(item?.title ?? item?.announcementTitle ?? "").replace(/<[^>]+>/g, ""), 180)
      const publishedDate = compactString(item?.date ?? szseAnnouncementDate(item?.publishTime) ?? cninfoAnnouncementDate(item?.announcementTime), 40) || null
      const pdfUrl = compactString(item?.downloadUrl || szsePdfUrl(item?.attachPath) || cninfoPdfUrl(item?.adjunctUrl), 260)
      if (!announcementId && !title && !pdfUrl) return null
      return {
        rank: index + 1,
        announcementId: announcementId || shortHash(`${secCode}:${title}:${pdfUrl}`),
        secCode,
        secName,
        title,
        publishedDate,
        pdfUrl,
        sourceRef: `${sourcePrefix}:announcement#${secCode || "unknown"}/${announcementId || shortHash(pdfUrl || title)}`,
      }
    })
    .filter(Boolean)
}

function compactCninfoStructuredData(results = [], targetFields = []) {
  const top = results[0] ?? null
  if (!top) return {}
  const fields = compactStringArray(targetFields, 20, 80)
  const evidenceText = compactString(results.slice(0, 5).map((item) => [item.title, item.secName].filter(Boolean).join(" ")).join("；"), 500)
  const matchedTargetFields = []
  const missingTargetFields = []
  const structuredData = {
    announcementCount: results.length,
    officialSourceCount: results.length,
    topTitle: top.title,
    topSecCode: top.secCode,
    topSecName: top.secName,
    topPublishedDate: top.publishedDate,
    topUrl: top.pdfUrl,
    topEvidenceTier: "official_primary",
    topSourceKind: "official_disclosure",
    cninfoSourceQualitySummary: results.slice(0, 5).map((item) => ({
      title: item.title,
      secCode: item.secCode,
      secName: item.secName,
      publishedDate: item.publishedDate,
      sourceRef: item.sourceRef,
      pdfUrl: item.pdfUrl,
    })),
  }
  for (const field of fields) {
    if (tavilyEvidenceTextMatchesField(field, evidenceText)) {
      matchedTargetFields.push(field)
      if (structuredData[field] === undefined) structuredData[field] = evidenceText
    } else {
      missingTargetFields.push(field)
    }
  }
  structuredData.cninfoMatchedTargetFields = matchedTargetFields
  structuredData.cninfoMissingTargetFields = missingTargetFields
  return structuredData
}

async function buildCninfoEvidenceSourceResult(task = {}, options = {}) {
  const query = compactString(options.cninfoQuery ?? options["cninfo-query"] ?? cninfoAnnouncementQuery(task), 300)
  if (!query) {
    return normalizeEvidenceSourceResult({
      source: "cninfo",
      status: "failed",
      sourceQuality: 95,
      error: "Missing stock name/code or target fields for CNINFO announcement query.",
    }, task)
  }
  const client = options.cninfoClient ?? defaultCninfoAnnouncementClient
  try {
    const fallbackQueries = [...new Set(compactStringArray([
      query,
      task.stockName ? `${task.stockName} 年度报告` : "",
      task.stockName ? `${task.stockName} 年度报告 公告` : "",
      task.stockName ? `${task.stockName} 业绩预告` : "",
      task.stockCode ? `${String(task.stockCode).replace(/\.(SH|SZ)$/i, "")} 年度报告` : "",
    ], 5, 300))]
    let results = []
    let usedQuery = query
    let hardSource = "cninfo"
    const zeroResultToolStateRefs = []
    for (const candidateQuery of fallbackQueries) {
      const response = await client({
        query: candidateQuery,
        stockCode: task.stockCode,
        stockName: task.stockName,
        pageSize: parsePositiveInteger(options.cninfoPageSize ?? options["cninfo-page-size"], 8),
        timeoutMs: options.cninfoTimeoutMs ?? options["cninfo-timeout-ms"],
      })
      results = normalizeCninfoAnnouncementResults(response)
      usedQuery = candidateQuery
      if (results.length) break
    }
    if (!results.length) {
      zeroResultToolStateRefs.push(`tool-state:cninfo#announcement:results=0:queries=${fallbackQueries.length}`)
      const column = exchangeColumnForStockCode(task.stockCode)
      if (["sse", "szse"].includes(column)) {
        const exchangeClient = options.exchangeAnnouncementClient
          ?? (column === "sse" ? options.sseAnnouncementClient : options.szseAnnouncementClient)
          ?? (column === "sse" ? defaultSseAnnouncementClient : defaultSzseAnnouncementClient)
        const exchangeResponse = await exchangeClient({
          company: {
            stockCode: task.stockCode,
            tsCode: task.stockCode,
            stockName: task.stockName,
            secName: task.stockName,
            stockInput: task.stockCode,
          },
          to: String(options.exchangeEndDate ?? options["exchange-end-date"] ?? options.generatedAt ?? nowLocalTimestamp()).slice(0, 10),
          timeoutMs: options.exchangeTimeoutMs ?? options["exchange-timeout-ms"] ?? options[`${column}TimeoutMs`] ?? options[`${column}-timeout-ms`] ?? options.cninfoTimeoutMs ?? options["cninfo-timeout-ms"],
          options: {
            ssePageSize: options.ssePageSize ?? options["sse-page-size"] ?? options.cninfoPageSize ?? options["cninfo-page-size"],
            sseTimeoutMs: options.sseTimeoutMs ?? options["sse-timeout-ms"] ?? options.exchangeTimeoutMs ?? options["exchange-timeout-ms"],
            szsePageSize: options.szsePageSize ?? options["szse-page-size"] ?? options.cninfoPageSize ?? options["cninfo-page-size"],
            szseTimeoutMs: options.szseTimeoutMs ?? options["szse-timeout-ms"] ?? options.exchangeTimeoutMs ?? options["exchange-timeout-ms"],
          },
        })
        const exchangeResults = normalizeExchangeAnnouncementResults(exchangeResponse)
        if (exchangeResults.length) {
          results = exchangeResults
          usedQuery = `${column}:${task.stockCode || task.stockName || query}`
          hardSource = "exchange"
        } else {
          zeroResultToolStateRefs.push(`tool-state:${column}#announcement:results=0:status=${exchangeResponse?.status ?? "unknown"}`)
        }
      }
    }
    if (!results.length) {
      return normalizeEvidenceSourceResult({
        source: "cninfo",
        status: "failed",
        sourceQuality: 95,
        error: "CNINFO returned no announcement records for the query.",
        toolStateRefs: zeroResultToolStateRefs.length ? zeroResultToolStateRefs : [`tool-state:cninfo#announcement:results=0:queries=${fallbackQueries.length}`],
      }, task)
    }
    const structuredData = {
      ...compactCninfoStructuredData(results, task.targetFields),
      ...(hardSource === "exchange" ? { exchangeFallback: `${exchangeColumnForStockCode(task.stockCode)}_public_web` } : {}),
    }
    const sourceRefs = [
      ...results.slice(0, 8).map((item) => item.sourceRef),
      ...results.slice(0, 3).map((item) => item.pdfUrl ? `web:${item.pdfUrl}` : "").filter(Boolean),
    ]
    return normalizeEvidenceSourceResult({
      source: hardSource,
      status: "ok",
      sourceQuality: 95,
      sourceKind: "official_disclosure",
      evidenceTier: "official_primary",
      qualityFlags: ["official_source", "hard_source", ...(hardSource === "exchange" ? ["exchange_fallback"] : [])],
      structuredData,
      summary: compactString(`${hardSource === "exchange" ? "Exchange fallback" : "CNINFO"} returned ${results.length} official announcement records. Top result: ${results[0]?.title || results[0]?.sourceRef}.`, 500),
      sourceRefs,
      toolStateRefs: [
        ...(hardSource === "exchange" ? zeroResultToolStateRefs : []),
        `tool-state:${hardSource === "exchange" ? exchangeColumnForStockCode(task.stockCode) || "exchange" : "cninfo"}#announcement:results=${results.length}:query=${shortHash(usedQuery)}`,
      ],
      targetFields: task.targetFields,
    }, task)
  } catch (err) {
    return normalizeEvidenceSourceResult({
      source: "cninfo",
      status: "failed",
      sourceQuality: 95,
      error: safeErrorMessage(err),
      toolStateRefs: ["tool-state:cninfo#announcement:status=error"],
    }, task)
  }
}

function normalizeTavilyEvidenceResults(response = {}) {
  return (Array.isArray(response?.results) ? response.results : [])
    .map((item, index) => {
      const url = compactString(item?.url ?? "", 260)
      if (!url) return null
      const normalized = {
        rank: index + 1,
        title: compactString(item?.title ?? "", 180),
        url,
        content: compactString(item?.content ?? item?.snippet ?? item?.raw_content ?? "", 500),
        score: finiteNumber(item?.score) ?? null,
        publishedDate: compactOptionalString(item?.published_date ?? item?.publishedDate, 40),
      }
      const classification = classifyTavilyEvidenceResult(normalized)
      return {
        ...normalized,
        ...classification,
      }
    })
    .filter(Boolean)
    .sort((left, right) => (
      (right.sourceQuality ?? 0) - (left.sourceQuality ?? 0) ||
      (right.score ?? 0) - (left.score ?? 0) ||
      left.rank - right.rank
    ))
}

function compactTavilyStructuredData(results = [], targetFields = []) {
  const top = results[0] ?? null
  if (!top) return {}
  const officialSourceCount = results.filter((item) => item.evidenceTier === "official_primary").length
  const evidenceText = compactString([top.title, top.content].filter(Boolean).join(" - "), 500)
  const fields = compactStringArray(targetFields, 20, 80)
  const matchedTargetFields = []
  const missingTargetFields = []
  const structuredData = {
    webResultCount: results.length,
    officialSourceCount,
    requiresOfficialConfirmation: officialSourceCount === 0,
    topTitle: top.title,
    topUrl: top.url,
    topSnippet: top.content,
    topEvidenceTier: top.evidenceTier,
    topSourceKind: top.sourceKind,
    topSourceQuality: top.sourceQuality,
    webSourceQualitySummary: results.slice(0, 5).map((item) => ({
      url: item.url,
      officialDisclosureRef: officialDisclosureSourceRefFromUrl(item.url),
      evidenceTier: item.evidenceTier,
      sourceKind: item.sourceKind,
      sourceQuality: item.sourceQuality,
      qualityFlags: item.qualityFlags,
    })),
  }
  for (const field of fields) {
    if (tavilyEvidenceTextMatchesField(field, evidenceText)) {
      matchedTargetFields.push(field)
      if (structuredData[field] === undefined) structuredData[field] = evidenceText
    } else {
      missingTargetFields.push(field)
    }
  }
  structuredData.webMatchedTargetFields = matchedTargetFields
  structuredData.webMissingTargetFields = missingTargetFields
  return structuredData
}

async function buildTavilyEvidenceSourceResult(task = {}, options = {}) {
  const credentials = getCompanyResearchCredentials(options)
  const apiKey = credentials.tavilyApiKey
  const client = options.tavilyClient ?? tavilyDeepResearchSearch
  if (!apiKey && !options.tavilyClient) {
    return normalizeEvidenceSourceResult({
      source: "web",
      status: "failed",
      sourceQuality: 70,
      error: "Tavily API key is not configured.",
      toolStateRefs: [`tool-state:tavily#search:auth=${credentials.status.tavily.auth}`],
    }, task)
  }
  const query = buildTavilyEvidenceQuery(task)
  try {
    const response = await client({
      query,
      apiKey,
      maxResults: parsePositiveInteger(options.tavilyMaxResults ?? options["tavily-max-results"], 5),
      timeoutMs: options.tavilyTimeoutMs ?? options["tavily-timeout-ms"],
    })
    const results = normalizeTavilyEvidenceResults(response)
    if (!results.length) {
      return normalizeEvidenceSourceResult({
        source: "web",
        status: "failed",
        sourceQuality: 70,
        error: "Tavily returned no usable web results.",
        toolStateRefs: ["tool-state:tavily#search:results=0"],
      }, task)
    }
    const sourceRefs = [...new Set(results.slice(0, 8).flatMap((item) => [
      officialDisclosureSourceRefFromUrl(item.url),
      `web:${item.url}`,
    ]).filter(Boolean))]
    const structuredData = compactTavilyStructuredData(results, task.targetFields)
    const topResult = results[0]
    return normalizeEvidenceSourceResult({
      source: "web",
      status: "ok",
      sourceQuality: topResult?.sourceQuality ?? 64,
      sourceKind: topResult?.sourceKind,
      evidenceTier: topResult?.evidenceTier,
      qualityFlags: topResult?.qualityFlags,
      structuredData,
      summary: compactString(`Tavily returned ${results.length} web results. Top result: ${topResult?.title || topResult?.url}. Evidence tier: ${topResult?.evidenceTier ?? "unknown"}.`, 500),
      sourceRefs,
      toolStateRefs: [`tool-state:tavily#search:results=${results.length}`],
      targetFields: task.targetFields,
    }, task)
  } catch (err) {
    return normalizeEvidenceSourceResult({
      source: "web",
      status: "failed",
      sourceQuality: 70,
      error: safeErrorMessage(err),
      toolStateRefs: ["tool-state:tavily#search:status=error"],
    }, task)
  }
}

async function buildEvidenceSourceResults(task = {}, options = {}) {
  const synthetic = buildSyntheticEvidenceSourceResults(task, options)
  const hasInjectedEvidence = synthetic.some((source) => source.status === "ok")
  if (hasInjectedEvidence || normalizeEvidenceMockSources(task, options)) return synthetic
  const preferredSources = task.preferredSources?.length ? task.preferredSources : defaultEvidenceSourcesForTask(task)
  const results = []
  for (const source of preferredSources) {
    const normalizedSource = normalizeEvidenceSourceName(source)
    const hasOfficialHardSource = results.some((item) => (
      item.status === "ok" &&
      item.evidenceTier === "official_primary" &&
      ["cninfo", "exchange"].includes(item.source)
    ))
    if (normalizedSource === "web" && hasOfficialHardSource && ["announcement", "financial_metrics"].includes(task.taskType)) {
      continue
    }
    if (normalizedSource === "cninfo") {
      results.push(await buildCninfoEvidenceSourceResult(task, options))
      continue
    }
    if (normalizedSource === "tushare") {
      results.push(await buildTushareEvidenceSourceResult(task, options))
      continue
    }
    if (normalizedSource === "web") {
      results.push(await buildTavilyEvidenceSourceResult(task, options))
      continue
    }
    results.push(normalizeEvidenceSourceResult({
      source: normalizedSource,
      status: "unavailable",
      error: "Adapter is not implemented in v0.13 P0; fallback keeps the task auditable.",
    }, task))
  }
  return results
}

function mergeStructuredEvidenceData(sources = []) {
  const merged = {}
  for (const source of sources) {
    if (source.status !== "ok") continue
    for (const [key, value] of Object.entries(source.structuredData ?? {})) {
      if (merged[key] === undefined || merged[key] === null || merged[key] === "") merged[key] = value
    }
  }
  return merged
}

function evidenceFieldCompleteness(structuredData = {}, targetFields = []) {
  const fields = targetFields.length ? targetFields : Object.keys(structuredData)
  if (!fields.length) return 0
  const present = fields.filter((field) => structuredData[field] !== undefined && structuredData[field] !== null && structuredData[field] !== "").length
  return roundMetric((present / fields.length) * 100, 2)
}

function crossValidateEvidenceSources(sources = [], targetFields = []) {
  const conflicts = []
  const fields = targetFields.length
    ? targetFields
    : [...new Set(sources.flatMap((source) => Object.keys(source.structuredData ?? {})))]
  for (const field of fields) {
    const values = sources
      .filter((source) => source.status === "ok" && source.structuredData?.[field] !== undefined && source.structuredData?.[field] !== null)
      .map((source) => ({ source: source.source, value: source.structuredData[field], sourceRefs: source.sourceRefs }))
    if (values.length < 2) continue
    const numeric = values.map((item) => ({ ...item, numeric: finiteNumber(item.value) })).filter((item) => item.numeric !== null)
    if (numeric.length === values.length) {
      const min = Math.min(...numeric.map((item) => item.numeric))
      const max = Math.max(...numeric.map((item) => item.numeric))
      const base = Math.max(Math.abs(min), 1)
      const diffPct = ((max - min) / base) * 100
      if (diffPct > 5) conflicts.push({ field, type: "numeric_divergence", diffPct: roundMetric(diffPct, 2), values })
      continue
    }
    const unique = new Set(values.map((item) => String(item.value)))
    if (unique.size > 1) conflicts.push({ field, type: "value_mismatch", values })
  }
  const consistencyScore = conflicts.length ? 45 : 100
  return {
    status: conflicts.length ? "conflict" : "consistent",
    consistencyScore,
    conflictCount: conflicts.length,
    conflicts,
  }
}

function buildEvidenceQualityReport({ task, sources, structuredData, crossValidation }) {
  const okSources = sources.filter((source) => source.status === "ok")
  const completeness = evidenceFieldCompleteness(structuredData, task.targetFields ?? [])
  const averageSourceQuality = okSources.length
    ? roundMetric(okSources.reduce((sum, source) => sum + (finiteNumber(source.sourceQuality) ?? 0), 0) / okSources.length, 2)
    : 0
  const qualityReport = {
    fieldCompleteness: completeness,
    valueValidity: crossValidation.conflictCount ? 55 : okSources.length ? 100 : 0,
    timeliness: okSources.length ? 80 : 0,
    formatConsistency: crossValidation.conflictCount ? 55 : okSources.length ? 100 : 0,
    sourceReliability: averageSourceQuality,
  }
  const overallConfidence = roundMetric(
    (crossValidation.consistencyScore * 0.4) +
    (averageSourceQuality * 0.3) +
    (completeness * 0.3),
    2,
  )
  return { qualityReport, overallConfidence }
}

function evidenceHumanGateForResult({ resultStatus, overallConfidence, crossValidation, okSourceCount }) {
  if (resultStatus === "failed") {
    return {
      status: "needs_more_evidence",
      reason: "No data source produced usable evidence.",
      autoReady: false,
    }
  }
  if (crossValidation.conflictCount > 0) {
    return {
      status: "awaiting_review",
      reason: "Conflicting source values require human review.",
      autoReady: false,
    }
  }
  if (overallConfidence >= 90 && okSourceCount > 0) {
    return {
      status: "auto_ready",
      reason: "High-confidence result; training promotion still requires human review.",
      autoReady: true,
    }
  }
  if (overallConfidence >= 60) {
    return {
      status: "awaiting_review",
      reason: "Medium-confidence result requires human confirmation.",
      autoReady: false,
    }
  }
  return {
    status: "needs_more_evidence",
    reason: "Low-confidence result needs more evidence.",
    autoReady: false,
  }
}

async function buildEvidenceResultForTask(task = {}, options = {}) {
  const generatedAt = options.generatedAt ?? nowLocalTimestamp()
  const runId = options.runId ?? `stockfb_evidence_run_${shortHash(`${generatedAt}:${task.taskId}`)}`
  const sources = await buildEvidenceSourceResults(task, options)
  const okSources = sources.filter((source) => source.status === "ok")
  const structuredData = mergeStructuredEvidenceData(sources)
  const crossValidation = crossValidateEvidenceSources(sources, task.targetFields ?? [])
  const { qualityReport, overallConfidence } = buildEvidenceQualityReport({ task, sources, structuredData, crossValidation })
  const sourceRefs = [...new Set(sources.flatMap((source) => source.sourceRefs ?? []))]
  const toolStateRefs = [...new Set([
    `tool-state:evidence-runner#${runId}`,
    ...sources.flatMap((source) => source.toolStateRefs ?? []),
  ])]
  const resultStatus = okSources.length === 0
    ? "failed"
    : crossValidation.conflictCount > 0
      ? "awaiting_review"
      : overallConfidence >= 90
        ? "completed"
        : "awaiting_review"
  const humanGate = evidenceHumanGateForResult({
    resultStatus,
    overallConfidence,
    crossValidation,
    okSourceCount: okSources.length,
  })
  const resultId = `stockfb_evidence_result_${shortHash(`${task.taskId}:${generatedAt}:${overallConfidence}:${crossValidation.status}`)}`
  return {
    schema: STOCK_FEEDBACK_EVIDENCE_RESULT_SCHEMA,
    resultId,
    taskId: task.taskId,
    generatedAt,
    updatedAt: generatedAt,
    status: resultStatus,
    sourceTaskStatus: task.status,
    source: task.source,
    sourceId: task.sourceId ?? null,
    stockCode: task.stockCode ?? null,
    stockName: task.stockName ?? null,
    taskType: task.taskType,
    targetFields: compactStringArray(task.targetFields, 20, 120),
    structuredData,
    summary: compactString(options.summary ?? [
      `${task.stockName ?? task.stockCode ?? "Evidence task"} ${task.taskType} evidence result.`,
      humanGate.reason,
    ].filter(Boolean).join(" "), 900),
    sources,
    sourceRefs,
    toolStateRefs,
    evidenceRefs: [...new Set([...sourceRefs, ...toolStateRefs])],
    qualityReport,
    crossValidation,
    overallConfidence,
    humanGate,
    writePolicy: {
      wroteWiki: false,
      wroteRaw: false,
      wroteBrain: false,
      wroteArtifacts: Boolean(options.write),
      allowedRoot: STOCK_FEEDBACK_ROOT,
    },
  }
}

function evidenceTaskStatusFromResult(result = {}) {
  if (result.status === "completed") return "completed"
  if (result.status === "awaiting_review") return "awaiting_review"
  if (result.status === "failed") return "dlq"
  return "failed"
}

function withEvidenceTaskStatus(task = {}, status, generatedAt, result = null) {
  return {
    ...task,
    schema: STOCK_FEEDBACK_EVIDENCE_TASK_SCHEMA,
    status,
    updatedAt: generatedAt,
    latestResultId: result?.resultId ?? task.latestResultId ?? null,
    latestResultSummary: result ? {
      status: result.status,
      overallConfidence: result.overallConfidence,
      humanGateStatus: result.humanGate?.status ?? null,
    } : task.latestResultSummary ?? null,
  }
}

function validateEvidenceTaskInput(options = {}) {
  const taskType = parseStockFeedbackEvidenceTaskType(options.taskType ?? options["task-type"] ?? options.type ?? "general")
  const targetFields = compactList(options.targetFields ?? options["target-fields"] ?? options.field ?? options.fields, 30, 120)
  const stockCode = compactString(options.stockCode ?? options["stock-code"], 32)
  if (!stockCode) throw new Error("stock-feedback evidence-task create requires --stock-code")
  if (targetFields.length === 0) throw new Error("stock-feedback evidence-task create requires --target-fields")
  return { taskType, targetFields, stockCode }
}

export async function createStockFeedbackEvidenceTask(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const generatedAt = options.generatedAt ?? nowLocalTimestamp()
  const { taskType, targetFields, stockCode } = validateEvidenceTaskInput(options)
  const stockName = compactString(options.stockName ?? options["stock-name"], 80) || null
  const preferredSources = compactList(options.preferredSources ?? options["preferred-sources"] ?? options.sources, 12, 80)
    .map(normalizeEvidenceSourceName)
  const structuredData = parseOptionalJsonObject(options.structuredDataJson ?? options["structured-data-json"] ?? options.structuredData, "structured data JSON")
  const task = {
    schema: STOCK_FEEDBACK_EVIDENCE_TASK_SCHEMA,
    taskId: compactString(options.taskId ?? options["task-id"], 80) || buildEvidenceTaskId({ generatedAt, stockCode, taskType, targetFields }),
    status: "pending",
    source: parseStockFeedbackEvidenceTaskSource(options.source),
    sourceId: compactOptionalString(options.sourceId ?? options["source-id"], 160),
    stockCode,
    stockName,
    taskType,
    targetFields,
    preferredSources: preferredSources.length ? preferredSources : defaultEvidenceSourcesForTask({ taskType }),
    priority: parseStockFeedbackEvidencePriority(options.priority),
    notes: compactString(options.notes ?? options.note ?? "", 700),
    sourceRefs: compactList(options.sourceRefs ?? options["source-refs"] ?? options.sourceRef ?? options["source-ref"], 30, 260),
    toolStateRefs: compactList(options.toolStateRefs ?? options["tool-state-refs"] ?? options.toolStateRef ?? options["tool-state-ref"], 30, 260),
    structuredData,
    createdAt: generatedAt,
    updatedAt: generatedAt,
    evidenceBoundary: {
      noWikiWrite: true,
      noRawWrite: true,
      noTradeAction: true,
    },
    writeBoundary: {
      projectPath,
      root: STOCK_FEEDBACK_ROOT,
      family: "evidence-tasks",
      wroteWiki: false,
      wroteRaw: false,
      wroteBrain: false,
    },
  }
  const manifest = {
    schema: "stock-feedback-evidence-task-manifest-v1",
    generatedAt,
    projectPath,
    count: 1,
    taskRefs: [{ taskId: task.taskId, status: task.status, taskType: task.taskType }],
    writeBoundary: {
      root: STOCK_FEEDBACK_ROOT,
      family: "evidence-tasks",
      wroteWiki: false,
      wroteRaw: false,
      wroteBrain: false,
    },
  }
  let writeResult = null
  if (options.write) {
    writeResult = await writeJsonlWithManifest({
      projectPath,
      family: "evidence-tasks",
      baseName: "stock-feedback-evidence-tasks",
      records: [task],
      manifest,
      generatedAt,
    })
  }
  return {
    schema: "stock-feedback-evidence-task-create-result-v1",
    mode: "stock-feedback-evidence-task-create",
    dryRun: !Boolean(options.write),
    projectPath,
    generatedAt,
    task,
    manifest,
    writeResult: writeResult ? { task: writeResult.jsonl, manifest: writeResult.manifest } : null,
    writePolicy: {
      wroteWiki: false,
      wroteRaw: false,
      wroteBrain: false,
      wroteArtifacts: Boolean(options.write),
      allowedRoot: STOCK_FEEDBACK_ROOT,
    },
  }
}

export async function listStockFeedbackEvidenceTasks(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const statusFilter = parseStockFeedbackEvidenceTaskStatus(options.status)
  const sourceFilter = options.source ? parseStockFeedbackEvidenceTaskSource(options.source) : null
  const taskTypeFilter = options.taskType || options["task-type"] ? parseStockFeedbackEvidenceTaskType(options.taskType ?? options["task-type"]) : null
  const stock = compactString(options.stock ?? options["stock-code"], 80).toLowerCase()
  const limit = parsePositiveInteger(options.limit, 100)
  const tasks = latestEvidenceTaskStates(await readStockFeedbackEvidenceTaskEvents(projectPath))
    .filter((task) => !statusFilter || task.status === statusFilter)
    .filter((task) => !sourceFilter || task.source === sourceFilter)
    .filter((task) => !taskTypeFilter || task.taskType === taskTypeFilter)
    .filter((task) => !stock || collectSearchText(task.stockCode, task.stockName).includes(stock))
    .sort((a, b) => evidenceTaskSortRank(a).localeCompare(evidenceTaskSortRank(b)))
  return {
    schema: "stock-feedback-evidence-task-list-result-v1",
    mode: "stock-feedback-evidence-task-list",
    projectPath,
    filters: {
      status: statusFilter,
      source: sourceFilter,
      taskType: taskTypeFilter,
      stock: stock || null,
    },
    count: tasks.length,
    tasks: tasks.slice(0, limit).map(compactEvidenceTask),
    writePolicy: { readOnly: true, wroteWiki: false, wroteRaw: false, wroteBrain: false, wroteArtifacts: false },
  }
}

export async function showStockFeedbackEvidenceTask(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const taskId = compactString(options.taskId ?? options["task-id"] ?? options.id, 120)
  if (!taskId) throw new Error("stock-feedback evidence-task show requires --task-id")
  const task = latestEvidenceTaskStates(await readStockFeedbackEvidenceTaskEvents(projectPath)).find((item) => item.taskId === taskId)
  if (!task) throw new Error(`Evidence task not found: ${taskId}`)
  const results = latestEvidenceResultStates(await readStockFeedbackEvidenceResultEvents(projectPath)).filter((item) => item.taskId === taskId)
  return {
    schema: "stock-feedback-evidence-task-show-result-v1",
    mode: "stock-feedback-evidence-task-show",
    projectPath,
    task,
    results: results.map(compactEvidenceResult),
    writePolicy: { readOnly: true, wroteWiki: false, wroteRaw: false, wroteBrain: false, wroteArtifacts: false },
  }
}

export async function runStockFeedbackEvidenceTaskQueue(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const generatedAt = options.generatedAt ?? nowLocalTimestamp()
  const runId = `stockfb_evidence_run_${shortHash(`${generatedAt}:${options.taskId ?? options["task-id"] ?? "queue"}`)}`
  const taskId = compactString(options.taskId ?? options["task-id"] ?? options.id, 120)
  const limit = parsePositiveInteger(options.limit, 10)
  const allTasks = latestEvidenceTaskStates(await readStockFeedbackEvidenceTaskEvents(projectPath))
  const selected = allTasks
    .filter((task) => task.status === "pending")
    .filter((task) => !taskId || task.taskId === taskId)
    .sort((a, b) => evidenceTaskSortRank(a).localeCompare(evidenceTaskSortRank(b)))
    .slice(0, limit)
  if (taskId && selected.length === 0) throw new Error(`Pending evidence task not found: ${taskId}`)
  const results = await Promise.all(selected.map((task) => buildEvidenceResultForTask(task, { ...options, generatedAt, runId })))
  const taskEvents = selected.map((task, index) => withEvidenceTaskStatus(task, evidenceTaskStatusFromResult(results[index]), generatedAt, results[index]))
  const dlqEvents = results
    .filter((result) => result.status === "failed")
    .map((result) => ({
      schema: STOCK_FEEDBACK_EVIDENCE_DLQ_SCHEMA,
      id: `stockfb_evidence_dlq_${shortHash(`${result.resultId}:${generatedAt}`)}`,
      generatedAt,
      updatedAt: generatedAt,
      taskId: result.taskId,
      resultId: result.resultId,
      status: "open",
      reason: result.humanGate?.reason ?? "Evidence task failed",
      retryCommand: `stock-feedback run-task-queue --task-id ${result.taskId} --write`,
      writeBoundary: {
        root: STOCK_FEEDBACK_ROOT,
        family: "evidence-dlq",
        wroteWiki: false,
        wroteRaw: false,
        wroteBrain: false,
      },
    }))
  const runRecord = {
    schema: STOCK_FEEDBACK_EVIDENCE_RUN_SCHEMA,
    runId,
    generatedAt,
    updatedAt: generatedAt,
    selectedTaskIds: selected.map((task) => task.taskId),
    resultIds: results.map((result) => result.resultId),
    dlqIds: dlqEvents.map((item) => item.id),
    summary: {
      selected: selected.length,
      completed: results.filter((item) => item.status === "completed").length,
      awaitingReview: results.filter((item) => item.status === "awaiting_review").length,
      failed: results.filter((item) => item.status === "failed").length,
      dlq: dlqEvents.length,
    },
    writeBoundary: {
      root: STOCK_FEEDBACK_ROOT,
      wroteWiki: false,
      wroteRaw: false,
      wroteBrain: false,
    },
  }
  const manifest = {
    schema: "stock-feedback-evidence-run-manifest-v1",
    generatedAt,
    projectPath,
    runId,
    selectedTaskIds: runRecord.selectedTaskIds,
    resultIds: runRecord.resultIds,
    summary: runRecord.summary,
    writeBoundary: {
      root: STOCK_FEEDBACK_ROOT,
      families: ["evidence-runs", "evidence-results", "evidence-tasks", "evidence-dlq"],
      wroteWiki: false,
      wroteRaw: false,
      wroteBrain: false,
    },
  }
  let writeResult = null
  if (options.write) {
    const runWrite = await writeJsonlWithManifest({
      projectPath,
      family: "evidence-runs",
      baseName: "stock-feedback-evidence-runs",
      records: [runRecord],
      manifest,
      generatedAt,
    })
    const resultWrite = await writeJsonlWithManifest({
      projectPath,
      family: "evidence-results",
      baseName: "stock-feedback-evidence-results",
      records: results,
      manifest: { ...manifest, schema: "stock-feedback-evidence-result-manifest-v1", count: results.length },
      generatedAt,
    })
    const taskWrite = await writeJsonlWithManifest({
      projectPath,
      family: "evidence-tasks",
      baseName: "stock-feedback-evidence-tasks",
      records: taskEvents,
      manifest: { ...manifest, schema: "stock-feedback-evidence-task-status-manifest-v1", count: taskEvents.length },
      generatedAt,
    })
    let dlqWrite = null
    if (dlqEvents.length > 0) {
      dlqWrite = await writeJsonlWithManifest({
        projectPath,
        family: "evidence-dlq",
        baseName: "stock-feedback-evidence-dlq",
        records: dlqEvents,
        manifest: { ...manifest, schema: "stock-feedback-evidence-dlq-manifest-v1", count: dlqEvents.length },
        generatedAt,
      })
    }
    writeResult = {
      run: runWrite.jsonl,
      runManifest: runWrite.manifest,
      results: resultWrite.jsonl,
      resultsManifest: resultWrite.manifest,
      taskEvents: taskWrite.jsonl,
      taskEventsManifest: taskWrite.manifest,
      dlq: dlqWrite?.jsonl ?? null,
      dlqManifest: dlqWrite?.manifest ?? null,
    }
  }
  return {
    schema: "stock-feedback-evidence-run-result-v1",
    mode: "stock-feedback-run-task-queue",
    dryRun: !Boolean(options.write),
    projectPath,
    generatedAt,
    run: runRecord,
    tasks: selected.map(compactEvidenceTask),
    results,
    dlqEvents,
    manifest,
    writeResult,
    writePolicy: {
      wroteWiki: false,
      wroteRaw: false,
      wroteBrain: false,
      wroteArtifacts: Boolean(options.write),
      allowedRoot: STOCK_FEEDBACK_ROOT,
    },
  }
}

export async function listStockFeedbackEvidenceResults(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const statusFilter = options.status ? normalizeToken(options.status) : null
  if (statusFilter && !STOCK_FEEDBACK_EVIDENCE_RESULT_STATUSES.includes(statusFilter)) {
    throw new Error(`--status must be one of ${STOCK_FEEDBACK_EVIDENCE_RESULT_STATUSES.join(", ")}`)
  }
  const taskId = compactString(options.taskId ?? options["task-id"], 120)
  const limit = parsePositiveInteger(options.limit, 100)
  const allResults = latestEvidenceResultStates(await readStockFeedbackEvidenceResultEvents(projectPath))
  const results = allResults
    .filter((result) => !statusFilter || result.status === statusFilter)
    .filter((result) => !taskId || result.taskId === taskId)
    .sort((a, b) => String(b.updatedAt ?? b.generatedAt ?? "").localeCompare(String(a.updatedAt ?? a.generatedAt ?? "")) || String(a.resultId).localeCompare(String(b.resultId)))
  const completedHardSourceKeys = new Set(allResults
    .filter((result) => result.status === "completed" && evidenceResultHasHardSource(result))
    .map((result) => `${result.stockCode ?? ""}:${result.taskType ?? ""}`))
  const compactResults = results.slice(0, limit).map((result) => compactEvidenceResult(result, {
    sameStockCompletedHardSource: completedHardSourceKeys.has(`${result.stockCode ?? ""}:${result.taskType ?? ""}`),
  }))
  const reviewPlanCounts = {}
  for (const result of compactResults) {
    const planStatus = result.reviewPlan?.status ?? "unknown"
    reviewPlanCounts[planStatus] = (reviewPlanCounts[planStatus] ?? 0) + 1
  }
  return {
    schema: "stock-feedback-evidence-result-list-result-v1",
    mode: "stock-feedback-evidence-result-list",
    projectPath,
    filters: { status: statusFilter, taskId: taskId || null },
    count: results.length,
    reviewPlanCounts,
    results: compactResults,
    writePolicy: { readOnly: true, wroteWiki: false, wroteRaw: false, wroteBrain: false, wroteArtifacts: false },
  }
}

export async function reviewStockFeedbackEvidenceResult(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const generatedAt = options.generatedAt ?? nowLocalTimestamp()
  const resultId = compactString(options.resultId ?? options["result-id"] ?? options.id, 140)
  if (!resultId) throw new Error("stock-feedback evidence-result review requires --result-id")
  const action = parseStockFeedbackEvidenceResultReviewAction(options.action)
  const current = latestEvidenceResultStates(await readStockFeedbackEvidenceResultEvents(projectPath)).find((item) => item.resultId === resultId)
  if (!current) throw new Error(`Evidence result not found: ${resultId}`)
  const hasApprovableEvidence = (current.sourceRefs ?? []).length > 0 || (current.sources ?? []).some((source) => source.status === "ok" && ((source.sourceRefs ?? []).length > 0 || (source.toolStateRefs ?? []).length > 0))
  if (action === "approve" && !hasApprovableEvidence) {
    throw new Error("approve evidence result requires sourceRefs or successful toolStateRefs")
  }
  const reviewed = {
    ...current,
    schema: STOCK_FEEDBACK_EVIDENCE_RESULT_SCHEMA,
    status: action === "approve" ? "completed" : action === "reject" ? "rejected" : "awaiting_review",
    updatedAt: generatedAt,
    humanGate: {
      ...(current.humanGate ?? {}),
      status: action === "approve" ? "approved" : action === "reject" ? "rejected" : "needs_more_evidence",
      action,
      reviewer: compactString(options.reviewer ?? "manual", 80) || "manual",
      reviewedAt: generatedAt,
      note: compactString(options.note ?? "", 500),
    },
    writePolicy: {
      ...(current.writePolicy ?? {}),
      wroteArtifacts: Boolean(options.write),
      wroteWiki: false,
      wroteRaw: false,
      wroteBrain: false,
      allowedRoot: STOCK_FEEDBACK_ROOT,
    },
  }
  const manifest = {
    schema: "stock-feedback-evidence-result-review-manifest-v1",
    generatedAt,
    projectPath,
    count: 1,
    resultId,
    action,
    writeBoundary: {
      root: STOCK_FEEDBACK_ROOT,
      family: "evidence-results",
      wroteWiki: false,
      wroteRaw: false,
      wroteBrain: false,
    },
  }
  let writeResult = null
  if (options.write) {
    writeResult = await writeJsonlWithManifest({
      projectPath,
      family: "evidence-results",
      baseName: "stock-feedback-evidence-results",
      records: [reviewed],
      manifest,
      generatedAt,
    })
  }
  return {
    schema: "stock-feedback-evidence-result-review-result-v1",
    mode: "stock-feedback-evidence-result-review",
    dryRun: !Boolean(options.write),
    projectPath,
    generatedAt,
    reviewed,
    manifest,
    writeResult: writeResult ? { result: writeResult.jsonl, manifest: writeResult.manifest } : null,
    writePolicy: {
      wroteWiki: false,
      wroteRaw: false,
      wroteBrain: false,
      wroteArtifacts: Boolean(options.write),
      allowedRoot: STOCK_FEEDBACK_ROOT,
    },
  }
}

export async function getStockFeedbackEvidenceSourceStatus(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const results = latestEvidenceResultStates(await readStockFeedbackEvidenceResultEvents(projectPath))
  const sourceStats = new Map()
  for (const result of results) {
    for (const source of result.sources ?? []) {
      const name = normalizeEvidenceSourceName(source.source)
      if (!sourceStats.has(name)) sourceStats.set(name, { source: name, total: 0, ok: 0, failed: 0, lastStatus: null, lastSeenAt: null })
      const stats = sourceStats.get(name)
      stats.total += 1
      if (source.status === "ok") stats.ok += 1
      else stats.failed += 1
      stats.lastStatus = source.status
      stats.lastSeenAt = result.updatedAt ?? result.generatedAt ?? null
    }
  }
  return {
    schema: "stock-feedback-evidence-source-status-v1",
    mode: "stock-feedback-source-status",
    projectPath,
    sources: [...sourceStats.values()].map((stats) => ({
      ...stats,
      successRate: stats.total ? roundMetric((stats.ok / stats.total) * 100, 2) : null,
      circuitStatus: stats.failed >= 3 && stats.ok === 0 ? "open" : "closed",
    })),
    writePolicy: { readOnly: true, wroteWiki: false, wroteRaw: false, wroteBrain: false, wroteArtifacts: false },
  }
}

export async function listStockFeedbackEvidenceDlq(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const status = compactString(options.status ?? "open", 80)
  const limit = parsePositiveInteger(options.limit, 100)
  const entries = latestEvidenceDlqStates(await readStockFeedbackEvidenceDlqEvents(projectPath))
    .filter((entry) => status === "all" || entry.status === status)
    .slice(0, limit)
  return {
    schema: "stock-feedback-evidence-dlq-list-result-v1",
    mode: "stock-feedback-dlq-list",
    projectPath,
    count: entries.length,
    entries,
    writePolicy: { readOnly: true, wroteWiki: false, wroteRaw: false, wroteBrain: false, wroteArtifacts: false },
  }
}

export async function updateStockFeedbackEvidenceDlqEntry(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const generatedAt = options.generatedAt ?? nowLocalTimestamp()
  const action = normalizeToken(options.action ?? options._action)
  if (!STOCK_FEEDBACK_EVIDENCE_DLQ_ACTIONS.includes(action)) {
    throw new Error(`stock-feedback dlq action must be one of ${STOCK_FEEDBACK_EVIDENCE_DLQ_ACTIONS.join(", ")}`)
  }
  const id = compactString(options.id ?? options["dlq-id"] ?? options.dlqId, 140)
  const taskId = compactString(options.taskId ?? options["task-id"], 140)
  if (!id && !taskId) throw new Error("stock-feedback dlq retry/discard requires --dlq-id or --task-id")
  const dlqEntries = latestEvidenceDlqStates(await readStockFeedbackEvidenceDlqEvents(projectPath))
  const current = dlqEntries.find((entry) => (id && entry.id === id) || (taskId && entry.taskId === taskId && entry.status === "open"))
  if (!current) throw new Error(`Evidence DLQ entry not found: ${id || taskId}`)
  if (current.status !== "open") {
    throw new Error(`Evidence DLQ entry is not open: ${current.id} (${current.status})`)
  }
  const tasks = latestEvidenceTaskStates(await readStockFeedbackEvidenceTaskEvents(projectPath))
  const task = tasks.find((item) => item.taskId === current.taskId) ?? null
  if (action === "retry" && !task) throw new Error(`Evidence task not found for DLQ retry: ${current.taskId}`)
  const note = compactString(options.note ?? "", 500)
  const dlqEvent = {
    ...current,
    schema: STOCK_FEEDBACK_EVIDENCE_DLQ_SCHEMA,
    status: action === "retry" ? "retried" : "discarded",
    updatedAt: generatedAt,
    action,
    reviewer: compactString(options.reviewer ?? "manual", 80) || "manual",
    note,
    previousStatus: current.status,
    writeBoundary: {
      root: STOCK_FEEDBACK_ROOT,
      family: "evidence-dlq",
      wroteWiki: false,
      wroteRaw: false,
      wroteBrain: false,
    },
  }
  const taskEvent = action === "retry" && task ? {
    ...task,
    schema: STOCK_FEEDBACK_EVIDENCE_TASK_SCHEMA,
    status: "pending",
    updatedAt: generatedAt,
    retryFromDlqId: current.id,
    retryFromResultId: current.resultId ?? null,
    retryNote: note,
    latestResultSummary: {
      ...(task.latestResultSummary ?? {}),
      status: "pending_retry",
    },
  } : null
  const manifest = {
    schema: "stock-feedback-evidence-dlq-action-manifest-v1",
    generatedAt,
    projectPath,
    action,
    dlqId: current.id,
    taskId: current.taskId,
    writeBoundary: {
      root: STOCK_FEEDBACK_ROOT,
      families: action === "retry" ? ["evidence-dlq", "evidence-tasks"] : ["evidence-dlq"],
      wroteWiki: false,
      wroteRaw: false,
      wroteBrain: false,
    },
  }
  let writeResult = null
  if (options.write) {
    const dlqWrite = await writeJsonlWithManifest({
      projectPath,
      family: "evidence-dlq",
      baseName: "stock-feedback-evidence-dlq",
      records: [dlqEvent],
      manifest,
      generatedAt,
    })
    let taskWrite = null
    if (taskEvent) {
      taskWrite = await writeJsonlWithManifest({
        projectPath,
        family: "evidence-tasks",
        baseName: "stock-feedback-evidence-tasks",
        records: [taskEvent],
        manifest: { ...manifest, schema: "stock-feedback-evidence-task-retry-manifest-v1", count: 1 },
        generatedAt,
      })
    }
    writeResult = {
      dlq: dlqWrite.jsonl,
      dlqManifest: dlqWrite.manifest,
      task: taskWrite?.jsonl ?? null,
      taskManifest: taskWrite?.manifest ?? null,
    }
  }
  return {
    schema: "stock-feedback-evidence-dlq-action-result-v1",
    mode: `stock-feedback-dlq-${action}`,
    dryRun: !Boolean(options.write),
    projectPath,
    generatedAt,
    action,
    dlq: dlqEvent,
    task: taskEvent ? compactEvidenceTask(taskEvent) : null,
    manifest,
    writeResult,
    writePolicy: {
      wroteWiki: false,
      wroteRaw: false,
      wroteBrain: false,
      wroteArtifacts: Boolean(options.write),
      allowedRoot: STOCK_FEEDBACK_ROOT,
    },
  }
}

function sortPaperTradeLedgerEvents(left = {}, right = {}) {
  return (
    String(left.generatedAt ?? "").localeCompare(String(right.generatedAt ?? "")) ||
    String(left.artifactPath ?? "").localeCompare(String(right.artifactPath ?? "")) ||
    Number(left.artifactLine ?? 0) - Number(right.artifactLine ?? 0) ||
    String(left.id ?? "").localeCompare(String(right.id ?? ""))
  )
}

function latestPaperTradeStates(paperTradeEvents = []) {
  const byId = new Map()
  for (const trade of paperTradeEvents.slice().sort(sortPaperTradeLedgerEvents)) {
    const key = trade.id || `${trade.artifactPath ?? "unknown"}:${trade.artifactLine ?? 0}`
    const previous = byId.get(key)
    byId.set(key, {
      ...trade,
      firstRecordedAt: previous?.firstRecordedAt ?? trade.generatedAt ?? null,
      ledgerEventCount: (previous?.ledgerEventCount ?? 0) + 1,
      previousArtifactPath: previous?.artifactPath ?? previous?.previousArtifactPath ?? null,
      previousGeneratedAt: previous?.generatedAt ?? previous?.previousGeneratedAt ?? null,
    })
  }
  return [...byId.values()].sort(sortPaperTradeLedgerEvents)
}

async function readStockFeedbackPaperTrades(projectPath) {
  return latestPaperTradeStates(await readStockFeedbackPaperTradeEvents(projectPath))
}

function inferPaperTradeStatus(options = {}, exitDate, exitPrice, realizedPnlPct) {
  const explicit = parseStockFeedbackPaperTradeStatus(options.status ?? options["trade-status"])
  if (explicit) return explicit
  if (exitDate || exitPrice !== null || realizedPnlPct !== null) return "closed"
  return "open"
}

function computedRealizedPnlPct(entryPrice, exitPrice) {
  if (entryPrice === null || exitPrice === null || entryPrice === 0) return null
  return Number((((exitPrice - entryPrice) / entryPrice) * 100).toFixed(4))
}

function parseBooleanLike(value, fallback = false) {
  if (value === true || value === false) return value
  if (value === undefined || value === null || value === "") return fallback
  const raw = String(value).trim().toLowerCase()
  if (["1", "true", "yes", "y", "on", "auto"].includes(raw)) return true
  if (["0", "false", "no", "n", "off"].includes(raw)) return false
  return fallback
}

function addCalendarDays(dateText, days) {
  const match = compactString(dateText, 32).match(/^(\d{4})-?(\d{2})-?(\d{2})$/)
  if (!match) return dateText
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function paperTradeDateOnly(value) {
  const match = compactString(value, 32).match(/(\d{4})-?(\d{2})-?(\d{2})/)
  return match ? `${match[1]}-${match[2]}-${match[3]}` : ""
}

function paperTradeDateKey(value) {
  return paperTradeDateOnly(value).replace(/-/g, "")
}

function comparePaperTradeDates(left, right) {
  const leftKey = paperTradeDateKey(left)
  const rightKey = paperTradeDateKey(right)
  if (!leftKey || !rightKey) return 0
  return leftKey.localeCompare(rightKey)
}

function paperTradeWindowLabel(startDate, endDate) {
  const start = paperTradeDateOnly(startDate)
  const end = paperTradeDateOnly(endDate)
  if (start && end) return `${start}..${end}`
  if (start) return `${start}..pending`
  return ""
}

function safePctChange(base, next) {
  if (base === null || next === null || base === 0) return null
  return roundMetric(((next - base) / base) * 100, 2)
}

function normalizeMarketEvidenceProvider(value) {
  const token = normalizeToken(value ?? "stock_daily_sql")
  if (["tushare", "tushare_http", "tushare_mcp"].includes(token)) return "tushare"
  if (["auto", "best_available"].includes(token)) return "auto"
  return "stock_daily_sql"
}

function buildPaperTradeAutoEvidenceGate({
  autoMarketEvidenceRequested,
  marketEvidenceProvider,
  autoMarketEvidenceResult,
  marketEvidenceWindow,
  autoMicrostructureEvidenceRequested,
  autoMicrostructureEvidenceResult,
}) {
  const checks = []
  if (autoMarketEvidenceRequested) {
    const status = autoMarketEvidenceResult?.status ?? "missing"
    checks.push({
      id: "market_evidence",
      provider: marketEvidenceProvider,
      status,
      warning: autoMarketEvidenceResult?.warning ?? null,
      passed: status === "ok",
    })
    if (marketEvidenceWindow?.exceededExpectedEnd === true) {
      checks.push({
        id: "market_evidence_window",
        provider: marketEvidenceProvider,
        status: "exceeded_expected_end",
        warning: `actual ${marketEvidenceWindow.actualWindow} exceeded expected ${marketEvidenceWindow.expectedWindow}`,
        passed: false,
      })
    }
  }
  if (autoMicrostructureEvidenceRequested) {
    const status = autoMicrostructureEvidenceResult?.status ?? "missing"
    checks.push({
      id: "microstructure_evidence",
      provider: "tushare",
      status,
      warning: autoMicrostructureEvidenceResult?.warning ?? null,
      passed: status === "ok",
    })
  }
  const failed = checks.filter((check) => check.passed !== true)
  return {
    status: failed.length > 0 ? "blocked" : checks.length > 0 ? "ready" : "not_requested",
    blocksWrite: failed.length > 0,
    checks,
    detail: failed.length > 0
      ? failed.map((check) => `${check.id}:${check.status}${check.warning ? `:${check.warning}` : ""}`).join("; ")
      : checks.length > 0 ? "automatic evidence sources are ready" : "automatic evidence was not requested",
  }
}

function toTushareDate(value) {
  const raw = compactString(value, 32)
  const match = raw.match(/(\d{4})-?(\d{2})-?(\d{2})/)
  return match ? `${match[1]}${match[2]}${match[3]}` : raw
}

function fromTushareDate(value) {
  const raw = compactString(value, 32)
  const match = raw.match(/^(\d{4})(\d{2})(\d{2})$/)
  return match ? `${match[1]}-${match[2]}-${match[3]}` : raw
}

function normalizeTushareBenchmarkCode(value) {
  const raw = compactString(value ?? "000001.SH", 32).trim()
  if (!raw) return null
  if (["0", "false", "off", "none", "null", "no"].includes(raw.toLowerCase())) return null
  const upper = raw.toUpperCase()
  if (/^\d{6}\.(SH|SZ)$/.test(upper)) return upper
  return toTushareCode(upper) ?? upper
}

async function fetchTushareNormalizedTable({ apiName, token, client, params, fields, timeoutMs }) {
  const response = await client({ apiName, token, params, fields, timeoutMs })
  return normalizeTushareResponse(apiName, response)
}

function mergeTushareDailyRows(dailyRows = [], dailyBasicRows = []) {
  const basicByDate = new Map(dailyBasicRows.map((row) => [String(row.trade_date ?? ""), row]))
  return dailyRows.map((row) => {
    const basic = basicByDate.get(String(row.trade_date ?? "")) ?? {}
    return {
      ticker: row.ts_code,
      date: fromTushareDate(row.trade_date),
      open: firstFiniteNumber(row.open),
      high: firstFiniteNumber(row.high),
      low: firstFiniteNumber(row.low),
      close: firstFiniteNumber(row.close),
      pct_cng: firstFiniteNumber(row.pct_chg),
      volume: firstFiniteNumber(row.vol),
      amount: firstFiniteNumber(row.amount),
      turnover: firstFiniteNumber(basic.turnover_rate_f, basic.turnover_rate),
      volumeRatio: firstFiniteNumber(basic.volume_ratio),
    }
  })
}

function tushareRowsForCode(rows = [], tsCode) {
  return rows.filter((row) => String(row.ts_code ?? "").toUpperCase() === String(tsCode ?? "").toUpperCase())
}

function sumFiniteRows(rows = [], field) {
  const values = rows.map((row) => firstFiniteNumber(row[field])).filter((value) => value !== null)
  return values.length ? roundMetric(values.reduce((sum, value) => sum + value, 0), 4) : null
}

function tushareRef(apiName, tsCode, tradeDate) {
  if (!apiName || !tsCode || !tradeDate) return null
  return `tushare:${apiName}#${tsCode}/${tradeDate}`
}

function heatCrowdingSignals(prefix, rank) {
  if (rank === null) return []
  return [
    `${prefix}_rank:${rank}`,
    rank <= 50 ? "heat:crowded_top50" : "",
    rank <= 100 ? "heat:crowded_top100" : "",
  ].filter(Boolean)
}

function buildTushareMicrostructureEvidence({
  tsCode,
  tradeDate,
  limitList = [],
  limitStep = [],
  topList = [],
  topInstRows = [],
  hotMoneyRows = [],
  thsHotRows = [],
  dcHotRows = [],
}) {
  const limitRow = limitList[0] ?? null
  const limitStepRow = limitStep[0] ?? null
  const topRow = topList[0] ?? null
  const thsHotRow = thsHotRows[0] ?? null
  const dcHotRow = dcHotRows[0] ?? null
  const instBuy = sumFiniteRows(topInstRows, "buy")
  const instSell = sumFiniteRows(topInstRows, "sell")
  const instNet = sumFiniteRows(topInstRows, "net_buy")
  const hotMoneyBuy = sumFiniteRows(hotMoneyRows, "buy_amount")
  const hotMoneySell = sumFiniteRows(hotMoneyRows, "sell_amount")
  const hotMoneyNet = sumFiniteRows(hotMoneyRows, "net_amount")
  const hotMoneyNames = compactStringArray([...new Set(hotMoneyRows.map((row) => row.hm_name).filter(Boolean))], 8, 80)
  const thsRank = firstFiniteNumber(thsHotRow?.rank)
  const dcRank = firstFiniteNumber(dcHotRow?.rank)
  const refs = {
    limitListRef: limitRow ? tushareRef("limit_list_d", tsCode, tradeDate) : null,
    limitStepRef: limitStepRow ? tushareRef("limit_step", tsCode, tradeDate) : null,
    topListRef: topRow ? tushareRef("top_list", tsCode, tradeDate) : null,
    topInstRef: topInstRows.length ? tushareRef("top_inst", tsCode, tradeDate) : null,
    hotMoneyRef: hotMoneyRows.length ? tushareRef("hm_detail", tsCode, tradeDate) : null,
    thsHotRef: thsHotRow ? tushareRef("ths_hot", tsCode, tradeDate) : null,
    dcHotRef: dcHotRow ? tushareRef("dc_hot", tsCode, tradeDate) : null,
  }
  const signals = [
    limitRow ? "limit_list:matched" : "",
    firstFiniteNumber(limitRow?.open_times) !== null ? `limit_open_times:${firstFiniteNumber(limitRow?.open_times)}` : "",
    firstFiniteNumber(limitRow?.open_times) === 0 ? "limit_seal:one_shot" : "",
    firstFiniteNumber(limitRow?.open_times) !== null && firstFiniteNumber(limitRow?.open_times) <= 1 ? "limit_seal:stable" : "",
    limitStepRow ? "limit_step:matched" : "",
    firstFiniteNumber(limitStepRow?.nums) !== null ? `consecutive_boards:${firstFiniteNumber(limitStepRow?.nums)}` : "",
    firstFiniteNumber(limitStepRow?.nums) !== null && firstFiniteNumber(limitStepRow?.nums) >= 3 ? "risk:high_board_relay" : "",
    topRow ? "dragon_tiger:matched" : "",
    instNet !== null && instNet > 0 ? "institution:net_buy" : "",
    instNet !== null && instNet < 0 ? "institution:net_sell" : "",
    hotMoneyNet !== null && hotMoneyNet > 0 ? "hot_money:net_buy" : "",
    hotMoneyNet !== null && hotMoneyNet < 0 ? "hot_money:net_sell" : "",
    thsHotRow ? "ths_hot:matched" : "",
    dcHotRow ? "dc_hot:matched" : "",
    ...heatCrowdingSignals("ths_hot", thsRank),
    ...heatCrowdingSignals("dc_hot", dcRank),
  ].filter(Boolean)
  const evidence = {
    schema: "stock-feedback-paper-trade-microstructure-evidence-v1",
    source: "tushare_http",
    stockCode: tsCode,
    tradeDate: fromTushareDate(tradeDate),
    ...refs,
    limit: limitRow ? {
      name: compactOptionalString(limitRow.name, 80),
      industry: compactOptionalString(limitRow.industry, 80),
      close: firstFiniteNumber(limitRow.close),
      pctChg: firstFiniteNumber(limitRow.pct_chg),
      amount: firstFiniteNumber(limitRow.amount),
      limitAmount: firstFiniteNumber(limitRow.limit_amount),
      fdAmount: firstFiniteNumber(limitRow.fd_amount),
      firstTime: compactOptionalString(limitRow.first_time, 32),
      lastTime: compactOptionalString(limitRow.last_time, 32),
      openTimes: firstFiniteNumber(limitRow.open_times),
      upStat: compactOptionalString(limitRow.up_stat, 32),
      limitTimes: firstFiniteNumber(limitRow.limit_times),
    } : null,
    limitStep: limitStepRow ? {
      name: compactOptionalString(limitStepRow.name, 80),
      consecutiveBoards: firstFiniteNumber(limitStepRow.nums),
    } : null,
    dragonTiger: topRow ? {
      reason: compactOptionalString(topRow.reason, 180),
      close: firstFiniteNumber(topRow.close),
      pctChange: firstFiniteNumber(topRow.pct_change),
      turnoverRate: firstFiniteNumber(topRow.turnover_rate),
      amount: firstFiniteNumber(topRow.amount),
      buyAmount: firstFiniteNumber(topRow.l_buy),
      sellAmount: firstFiniteNumber(topRow.l_sell),
      netAmount: firstFiniteNumber(topRow.net_amount),
    } : null,
    institution: topInstRows.length ? {
      rowCount: topInstRows.length,
      buyAmount: instBuy,
      sellAmount: instSell,
      netAmount: instNet,
    } : null,
    hotMoney: hotMoneyRows.length ? {
      rowCount: hotMoneyRows.length,
      names: hotMoneyNames,
      buyAmount: hotMoneyBuy,
      sellAmount: hotMoneySell,
      netAmount: hotMoneyNet,
    } : null,
    heat: thsHotRow || dcHotRow ? {
      thsRank,
      thsPctChange: firstFiniteNumber(thsHotRow?.pct_change),
      thsCurrentPrice: firstFiniteNumber(thsHotRow?.current_price),
      thsConcept: compactOptionalString(thsHotRow?.concept, 160),
      dcRank,
      dcPctChange: firstFiniteNumber(dcHotRow?.pct_change),
      dcCurrentPrice: firstFiniteNumber(dcHotRow?.current_price),
    } : null,
    signals: [...new Set(signals)],
  }
  const hasRef = Object.values(refs).some(Boolean)
  return hasRef ? evidence : null
}

async function derivePaperTradeMicrostructureFromTushare({ stockCode, entryDate, options = {} }) {
  if (!stockCode || !entryDate) return { status: "skipped", warning: "missing stockCode or entryDate", microstructureEvidence: null }
  const tsCode = toTushareCode(stockCode)
  if (!tsCode) return { status: "skipped", warning: "stockCode cannot be converted to Tushare ts_code", microstructureEvidence: null }
  const credentials = getCompanyResearchCredentials(options)
  const client = options.tushareClient ?? defaultTushareClient
  if (!credentials.tushareToken && !options.tushareClient) {
    return { status: "unavailable", warning: "Tushare token is not configured", auth: credentials.status?.tushare?.auth ?? "missing", microstructureEvidence: null }
  }
  const tradeDate = toTushareDate(options.microstructureDate ?? options["microstructure-date"] ?? entryDate)
  const timeoutMs = parsePositiveInteger(options.tushareTimeoutMs ?? options["tushare-timeout-ms"], 12000)
  try {
    const [limitList, limitStep, topList, topInst, hotMoney, thsHot, dcHot] = await Promise.all([
      fetchTushareNormalizedTable({
        apiName: "limit_list_d",
        token: credentials.tushareToken,
        client,
        params: { trade_date: tradeDate },
        fields: "trade_date,ts_code,name,industry,close,pct_chg,amount,limit_amount,fd_amount,first_time,last_time,open_times,up_stat,limit_times",
        timeoutMs,
      }),
      fetchTushareNormalizedTable({
        apiName: "limit_step",
        token: credentials.tushareToken,
        client,
        params: { trade_date: tradeDate },
        fields: "ts_code,name,trade_date,nums",
        timeoutMs,
      }),
      fetchTushareNormalizedTable({
        apiName: "top_list",
        token: credentials.tushareToken,
        client,
        params: { trade_date: tradeDate },
        fields: "trade_date,ts_code,name,close,pct_change,turnover_rate,amount,l_sell,l_buy,l_amount,net_amount,reason",
        timeoutMs,
      }),
      fetchTushareNormalizedTable({
        apiName: "top_inst",
        token: credentials.tushareToken,
        client,
        params: { trade_date: tradeDate },
        fields: "trade_date,ts_code,exalter,buy,buy_rate,sell,sell_rate,net_buy",
        timeoutMs,
      }),
      fetchTushareNormalizedTable({
        apiName: "hm_detail",
        token: credentials.tushareToken,
        client,
        params: { trade_date: tradeDate },
        fields: "trade_date,ts_code,ts_name,hm_name,buy_amount,sell_amount,net_amount",
        timeoutMs,
      }),
      fetchTushareNormalizedTable({
        apiName: "ths_hot",
        token: credentials.tushareToken,
        client,
        params: { trade_date: tradeDate },
        fields: "trade_date,ts_code,ts_name,rank,pct_change,current_price,concept",
        timeoutMs,
      }),
      fetchTushareNormalizedTable({
        apiName: "dc_hot",
        token: credentials.tushareToken,
        client,
        params: { trade_date: tradeDate },
        fields: "trade_date,ts_code,ts_name,rank,pct_change,current_price",
        timeoutMs,
      }),
    ])
    const warnings = [
      limitList.status !== "success" ? `Tushare limit_list_d failed: ${limitList.error}` : "",
      limitStep.status !== "success" ? `Tushare limit_step failed: ${limitStep.error}` : "",
      topList.status !== "success" ? `Tushare top_list failed: ${topList.error}` : "",
      topInst.status !== "success" ? `Tushare top_inst failed: ${topInst.error}` : "",
      hotMoney.status !== "success" ? `Tushare hm_detail failed: ${hotMoney.error}` : "",
      thsHot.status !== "success" ? `Tushare ths_hot failed: ${thsHot.error}` : "",
      dcHot.status !== "success" ? `Tushare dc_hot failed: ${dcHot.error}` : "",
    ].filter(Boolean)
    const microstructureEvidence = buildTushareMicrostructureEvidence({
      tsCode,
      tradeDate,
      limitList: limitList.status === "success" ? tushareRowsForCode(limitList.rows, tsCode) : [],
      limitStep: limitStep.status === "success" ? tushareRowsForCode(limitStep.rows, tsCode) : [],
      topList: topList.status === "success" ? tushareRowsForCode(topList.rows, tsCode) : [],
      topInstRows: topInst.status === "success" ? tushareRowsForCode(topInst.rows, tsCode) : [],
      hotMoneyRows: hotMoney.status === "success" ? tushareRowsForCode(hotMoney.rows, tsCode) : [],
      thsHotRows: thsHot.status === "success" ? tushareRowsForCode(thsHot.rows, tsCode) : [],
      dcHotRows: dcHot.status === "success" ? tushareRowsForCode(dcHot.rows, tsCode) : [],
    })
    return {
      status: microstructureEvidence ? "ok" : "no_match",
      warning: microstructureEvidence ? (warnings.join("; ") || null) : (warnings.join("; ") || "Tushare microstructure returned no matched rows"),
      provider: "tushare",
      auth: credentials.status?.tushare?.auth ?? (credentials.tushareToken ? "configured" : "custom_client"),
      nativeQuery: {
        language: "Tushare",
        summary: `limit_list_d + limit_step + top_list + top_inst + hm_detail + ths_hot + dc_hot ${tsCode} ${tradeDate}`,
        table: "tushare.limit_list_d+tushare.limit_step+tushare.top_list+tushare.top_inst+tushare.hm_detail+tushare.ths_hot+tushare.dc_hot",
        tickerCandidates: [tsCode],
      },
      microstructureEvidence,
    }
  } catch (err) {
    return { status: "error", warning: `Tushare microstructure failed: ${safeErrorMessage(err)}`, provider: "tushare", microstructureEvidence: null }
  }
}

async function derivePaperTradeMarketEvidenceFromTushare({ stockCode, entryDate, entryPrice, exitDate, options = {} }) {
  if (!stockCode || !entryDate) return { status: "skipped", warning: "missing stockCode or entryDate", marketEvidence: null }
  const tsCode = toTushareCode(stockCode)
  if (!tsCode) return { status: "skipped", warning: "stockCode cannot be converted to Tushare ts_code", marketEvidence: null }
  const credentials = getCompanyResearchCredentials(options)
  const client = options.tushareClient ?? defaultTushareClient
  if (!credentials.tushareToken && !options.tushareClient) {
    return { status: "unavailable", warning: "Tushare token is not configured", auth: credentials.status?.tushare?.auth ?? "missing", marketEvidence: null }
  }
  const lookaheadDays = parsePositiveInteger(options.marketEvidenceLookaheadDays ?? options["market-evidence-lookahead-days"], 7)
  const endDate = firstCompactString(32, options.marketEvidenceEndDate, options["market-evidence-end-date"], exitDate, addCalendarDays(entryDate, lookaheadDays))
  const benchmarkCode = normalizeTushareBenchmarkCode(options.marketEvidenceBenchmarkCode ?? options["market-evidence-benchmark-code"])
  const params = { ts_code: tsCode, start_date: toTushareDate(entryDate), end_date: toTushareDate(endDate) }
  const benchmarkParams = benchmarkCode ? { ts_code: benchmarkCode, start_date: params.start_date, end_date: params.end_date } : null
  const timeoutMs = parsePositiveInteger(options.tushareTimeoutMs ?? options["tushare-timeout-ms"], 12000)
  try {
    const [daily, dailyBasic, indexDaily] = await Promise.all([
      fetchTushareNormalizedTable({
        apiName: "daily",
        token: credentials.tushareToken,
        client,
        params,
        fields: "ts_code,trade_date,open,high,low,close,pct_chg,vol,amount",
        timeoutMs,
      }),
      fetchTushareNormalizedTable({
        apiName: "daily_basic",
        token: credentials.tushareToken,
        client,
        params,
        fields: "ts_code,trade_date,turnover_rate,turnover_rate_f,volume_ratio,total_mv,circ_mv",
        timeoutMs,
      }),
      benchmarkParams
        ? fetchTushareNormalizedTable({
          apiName: "index_daily",
          token: credentials.tushareToken,
          client,
          params: benchmarkParams,
          fields: "ts_code,trade_date,open,high,low,close,pct_chg,vol,amount",
          timeoutMs,
        })
        : Promise.resolve(null),
    ])
    if (daily.status !== "success") {
      return { status: "error", warning: `Tushare daily failed: ${daily.error}`, provider: "tushare", marketEvidence: null }
    }
    const rows = mergeTushareDailyRows(daily.rows, dailyBasic.status === "success" ? dailyBasic.rows : [])
    const columns = {
      ticker: "ticker",
      date: "date",
      open: "open",
      high: "high",
      low: "low",
      close: "close",
      pct_cng: "pct_cng",
      volume: "volume",
      amount: "amount",
      turnover: "turnover",
    }
    const evidence = calculatePaperTradeMarketEvidenceFromRows({
      rows,
      columns,
      stockCode: tsCode,
      entryDate,
      entryPrice,
      toDate: endDate,
      tableName: "tushare_daily",
    })
    const benchmarkRows = indexDaily?.status === "success"
      ? mergeTushareDailyRows(indexDaily.rows, [])
      : []
    const benchmarkEvidence = benchmarkRows.length > 0
      ? calculatePaperTradeMarketEvidenceFromRows({
        rows: benchmarkRows,
        columns,
        stockCode: benchmarkCode,
        entryDate,
        entryPrice: null,
        toDate: endDate,
        tableName: "tushare_index_daily",
      })
      : null
    const benchmarkReturnPct = firstFiniteNumber(benchmarkEvidence?.periodReturnPct)
    const relativeStrength = evidence?.periodReturnPct !== null && evidence?.periodReturnPct !== undefined && benchmarkReturnPct !== null
      ? roundMetric(evidence.periodReturnPct - benchmarkReturnPct, 2)
      : null
    const benchmarkRef = benchmarkEvidence && benchmarkCode
      ? `tushare:index_daily#${benchmarkCode}/${toTushareDate(benchmarkEvidence.endDate)}`
      : null
    const marketEvidence = evidence
      ? {
        ...evidence,
        priceSqlRef: `tushare:daily#${tsCode}/${toTushareDate(evidence.endDate)}`,
        marketDataRef: `tushare:daily+daily_basic:${tsCode}:${entryDate}..${evidence.endDate ?? endDate}`,
        benchmarkCode,
        benchmarkRef,
        benchmarkReturnPct,
        source: "tushare_http",
        relativeStrength,
        relativeStrengthBasis: relativeStrength !== null
          ? `excess_return_pct_vs_${benchmarkCode}`
          : evidence.relativeStrengthBasis ?? "not_computed_without_benchmark_source",
      }
      : null
    const warnings = [
      dailyBasic.status !== "success" ? `Tushare daily_basic failed: ${dailyBasic.error}` : "",
      benchmarkCode && indexDaily?.status !== "success" ? `Tushare index_daily failed: ${indexDaily?.error ?? "no response"}` : "",
      benchmarkCode && indexDaily?.status === "success" && !benchmarkEvidence ? "Tushare index_daily returned no benchmark rows" : "",
    ].filter(Boolean)
    return {
      status: marketEvidence ? "ok" : "no_rows",
      warning: marketEvidence ? (warnings.join("; ") || null) : "Tushare daily returned no rows for paper-trade window",
      provider: "tushare",
      auth: credentials.status?.tushare?.auth ?? (credentials.tushareToken ? "configured" : "custom_client"),
      nativeQuery: {
        language: "Tushare",
        summary: `daily + daily_basic ${tsCode} ${params.start_date}..${params.end_date}${benchmarkCode ? `; index_daily ${benchmarkCode}` : ""}`,
        table: benchmarkCode ? "tushare.daily+tushare.daily_basic+tushare.index_daily" : "tushare.daily+tushare.daily_basic",
        limit: rows.length,
        tickerCandidates: [tsCode, benchmarkCode].filter(Boolean),
      },
      marketEvidence,
    }
  } catch (err) {
    return { status: "error", warning: `Tushare market evidence failed: ${safeErrorMessage(err)}`, provider: "tushare", marketEvidence: null }
  }
}

function buildPaperTradeMarketEvidenceSqlQuery({ stockCode, fromDate, toDate, descriptor, limit = 20 }) {
  const columns = descriptor?.columns ?? {}
  const config = descriptor?.config ?? {}
  const selected = [
    columns.ticker,
    columns.date,
    columns.open,
    columns.high,
    columns.low,
    columns.close,
    columns.pctChange,
    columns.volume,
    columns.amount,
    columns.turnover,
  ].filter(Boolean)
  const uniqueSelected = [...new Set(selected)]
  const table = `${quotePgIdentifier(config.schema)}.${quotePgIdentifier(config.table)}`
  const sql = `
select ${uniqueSelected.map((column) => quotePgIdentifier(column)).join(", ")}
from ${table}
where ${quotePgIdentifier(columns.ticker)} = any($1::text[])
  and ${quotePgIdentifier(columns.date)} >= $2
  and ${quotePgIdentifier(columns.date)} <= $3
order by ${quotePgIdentifier(columns.date)} asc
limit $4
`.trim()
  return {
    language: "SQL",
    sql,
    params: [stockCodeAlternatives(stockCode), fromDate, toDate, limit],
    summary: `SELECT ${uniqueSelected.join(", ")} FROM ${config.schema}.${config.table} WHERE ${columns.ticker}=ANY($1) AND ${columns.date} BETWEEN ${fromDate} AND ${toDate}`,
    table: `${config.database}.${config.schema}.${config.table}`,
    limit,
    tickerCandidates: stockCodeAlternatives(stockCode),
  }
}

function calculatePaperTradeMarketEvidenceFromRows({ rows = [], columns = {}, stockCode, entryDate, entryPrice, toDate, tableName }) {
  const sorted = rows
    .slice()
    .sort((left, right) => String(formatSqlCell(left[columns.date])).localeCompare(String(formatSqlCell(right[columns.date]))))
  if (sorted.length === 0) return null
  const entryIndex = Math.max(0, sorted.findIndex((row) => formatSqlCell(row[columns.date]) >= entryDate))
  const entryRow = sorted[entryIndex] ?? sorted[0]
  const last = sorted[sorted.length - 1]
  const basePrice = firstFiniteNumber(entryPrice, numberFromSqlCell(entryRow?.[columns.close]))
  const closeAt = (offset) => {
    const row = sorted[Math.min(entryIndex + offset, sorted.length - 1)]
    return row ? numberFromSqlCell(row[columns.close]) : null
  }
  const lowValues = columns.low
    ? sorted.slice(entryIndex).map((row) => numberFromSqlCell(row[columns.low])).filter((value) => value !== null)
    : sorted.slice(entryIndex).map((row) => numberFromSqlCell(row[columns.close])).filter((value) => value !== null)
  const minLow = lowValues.length > 0 ? Math.min(...lowValues) : null
  const firstTurnover = columns.turnover ? numberFromSqlCell(entryRow?.[columns.turnover]) : null
  const lastTurnover = columns.turnover ? numberFromSqlCell(last?.[columns.turnover]) : null
  const firstClose = numberFromSqlCell(entryRow?.[columns.close])
  const lastClose = numberFromSqlCell(last?.[columns.close])
  return {
    priceSqlRef: stockDailyRowRef(last, columns, stockCode, tableName),
    marketDataRef: `stock-daily-sql:${stockCode}:${entryDate}..${formatSqlCell(last[columns.date]) || toDate}`,
    startDate: formatSqlCell(entryRow[columns.date]),
    endDate: formatSqlCell(last[columns.date]),
    rows: sorted.length,
    closeStart: roundMetric(firstClose, 4),
    closeEnd: roundMetric(lastClose, 4),
    periodReturnPct: safePctChange(basePrice, lastClose),
    turnoverChange: firstTurnover && lastTurnover ? roundMetric(lastTurnover / firstTurnover, 2) : null,
    followThrough1d: safePctChange(basePrice, closeAt(1)),
    followThrough3d: safePctChange(basePrice, closeAt(3)),
    followThrough5d: safePctChange(basePrice, closeAt(5)),
    maxDrawdownInHolding: basePrice && minLow !== null ? roundMetric(Math.max(0, ((basePrice - minLow) / basePrice) * 100), 2) : null,
    relativeStrength: null,
    relativeStrengthBasis: "not_computed_without_benchmark_source",
    source: "stock_daily_sql",
  }
}

async function derivePaperTradeMarketEvidenceFromSql({ projectPath, stockCode, entryDate, entryPrice, exitDate, options = {} }) {
  if (!stockCode || !entryDate) return { status: "skipped", warning: "missing stockCode or entryDate", marketEvidence: null }
  const lookaheadDays = parsePositiveInteger(options.marketEvidenceLookaheadDays ?? options["market-evidence-lookahead-days"], 7)
  const toDate = firstCompactString(32, options.marketEvidenceEndDate, options["market-evidence-end-date"], exitDate, addCalendarDays(entryDate, lookaheadDays))
  const descriptor = await describeStockDailySqlSource(options)
  if (!descriptor.ok) {
    return { status: "unavailable", warning: `stock daily SQL unavailable: ${descriptor.error}`, descriptor: { ok: descriptor.ok, error: descriptor.error, config: descriptor.config }, marketEvidence: null }
  }
  try {
    const nativeQuery = buildPaperTradeMarketEvidenceSqlQuery({
      stockCode,
      fromDate: entryDate,
      toDate,
      descriptor,
      limit: parsePositiveInteger(options.marketEvidenceSqlLimit ?? options["market-evidence-sql-limit"], 20),
    })
    const execution = await executeStockDailyQuery(nativeQuery, options)
    const rows = Array.isArray(execution?.rows) ? execution.rows : []
    const tableName = nativeQuery.table.split(".").slice(-1)[0]
    const marketEvidence = calculatePaperTradeMarketEvidenceFromRows({
      rows,
      columns: descriptor.columns,
      stockCode,
      entryDate,
      entryPrice,
      toDate,
      tableName,
    })
    return {
      status: marketEvidence ? "ok" : "no_rows",
      warning: marketEvidence ? null : "stock daily SQL returned no rows for paper-trade window",
      nativeQuery: {
        language: nativeQuery.language,
        summary: nativeQuery.summary,
        table: nativeQuery.table,
        limit: nativeQuery.limit,
        tickerCandidates: nativeQuery.tickerCandidates,
      },
      marketEvidence,
    }
  } catch (err) {
    return { status: "error", warning: `stock daily SQL failed: ${safeErrorMessage(err)}`, marketEvidence: null }
  }
}

function buildPaperTradeMarketEvidence(options = {}, profitFeedback = {}) {
  const priceSqlRef = compactOptionalString(options.priceSqlRef ?? options["price-sql-ref"], 260)
  const marketDataRef = compactOptionalString(options.marketDataRef ?? options["market-data-ref"], 260)
  const benchmarkRef = compactOptionalString(options.benchmarkRef ?? options["benchmark-ref"], 260)
  const relativeStrength = firstFiniteNumber(options.relativeStrength, options["relative-strength"])
  const benchmarkReturnPct = firstFiniteNumber(options.benchmarkReturnPct, options["benchmark-return-pct"])
  const turnoverChange = firstFiniteNumber(options.turnoverChange, options["turnover-change"])
  const followThrough1d = firstFiniteNumber(options.followThrough1d, options["follow-through-1d"])
  const followThrough3d = firstFiniteNumber(options.followThrough3d, options["follow-through-3d"])
  const followThrough5d = firstFiniteNumber(options.followThrough5d, options["follow-through-5d"])
  const explicitMaxDrawdownInHolding = firstFiniteNumber(options.maxDrawdownInHolding, options["max-drawdown-in-holding"])
  const hasExplicitMarketEvidence = Boolean(
    priceSqlRef ||
    marketDataRef ||
    benchmarkRef ||
    compactOptionalString(options.marketEvidenceSource ?? options["market-evidence-source"] ?? options.source, 80) ||
    compactOptionalString(options.marketEvidenceBenchmarkCode ?? options["market-evidence-benchmark-code"] ?? options.benchmarkCode, 32) ||
    compactOptionalString(options.marketEvidenceStartDate ?? options["market-evidence-start-date"] ?? options.startDate, 32) ||
    compactOptionalString(options.marketEvidenceEndDate ?? options["market-evidence-end-date"] ?? options.endDate, 32) ||
    firstFiniteNumber(options.marketEvidenceRows ?? options["market-evidence-rows"], options.rows) !== null ||
    firstFiniteNumber(options.periodReturnPct, options["period-return-pct"]) !== null ||
    relativeStrength !== null ||
    benchmarkReturnPct !== null ||
    turnoverChange !== null ||
    followThrough1d !== null ||
    followThrough3d !== null ||
    followThrough5d !== null ||
    explicitMaxDrawdownInHolding !== null,
  )
  const maxDrawdownInHolding = firstFiniteNumber(
    explicitMaxDrawdownInHolding,
    hasExplicitMarketEvidence ? profitFeedback.maxDrawdownPct : null,
  )
  const evidence = {
    schema: "stock-feedback-paper-trade-market-evidence-v1",
    priceSqlRef,
    marketDataRef,
    benchmarkRef,
    benchmarkCode: compactOptionalString(options.marketEvidenceBenchmarkCode ?? options["market-evidence-benchmark-code"] ?? options.benchmarkCode, 32),
    source: compactOptionalString(options.marketEvidenceSource ?? options["market-evidence-source"] ?? options.source, 80),
    startDate: compactOptionalString(options.marketEvidenceStartDate ?? options["market-evidence-start-date"] ?? options.startDate, 32),
    endDate: compactOptionalString(options.marketEvidenceEndDate ?? options["market-evidence-end-date"] ?? options.endDate, 32),
    rows: firstFiniteNumber(options.marketEvidenceRows ?? options["market-evidence-rows"], options.rows),
    periodReturnPct: firstFiniteNumber(options.periodReturnPct, options["period-return-pct"]),
    relativeStrength,
    benchmarkReturnPct,
    relativeStrengthBasis: compactOptionalString(options.relativeStrengthBasis ?? options["relative-strength-basis"], 120),
    turnoverChange,
    followThrough1d,
    followThrough3d,
    followThrough5d,
    maxDrawdownInHolding,
  }
  const clean = Object.fromEntries(Object.entries(evidence).filter(([, value]) => value !== null && value !== undefined && value !== ""))
  return Object.keys(clean).length > 1 ? clean : null
}

function buildPaperTradeMarketEvidenceWindow({ entryDate, exitDate, options = {}, marketEvidence = null, provider = null, autoMarketEvidenceRequested = false }) {
  if (!marketEvidence && !autoMarketEvidenceRequested) return null
  const lookaheadDays = parsePositiveInteger(options.marketEvidenceLookaheadDays ?? options["market-evidence-lookahead-days"], 7)
  const expectedStartDate = paperTradeDateOnly(entryDate)
  const expectedEndDate = paperTradeDateOnly(firstCompactString(
    32,
    options.marketEvidenceEndDate,
    options["market-evidence-end-date"],
    exitDate,
    expectedStartDate ? addCalendarDays(expectedStartDate, lookaheadDays) : "",
  ))
  const actualStartDate = paperTradeDateOnly(marketEvidence?.startDate) || expectedStartDate
  const actualEndDate = paperTradeDateOnly(marketEvidence?.endDate)
  const expectedWindow = paperTradeWindowLabel(expectedStartDate, expectedEndDate)
  const actualWindow = paperTradeWindowLabel(actualStartDate, actualEndDate || expectedEndDate)
  const exceededExpectedEnd = Boolean(actualEndDate && expectedEndDate && comparePaperTradeDates(actualEndDate, expectedEndDate) > 0)
  if (!expectedWindow && !actualWindow) return null
  return {
    schema: "stock-feedback-paper-trade-market-evidence-window-v1",
    provider: provider ?? null,
    expectedStartDate: expectedStartDate || null,
    expectedEndDate: expectedEndDate || null,
    expectedWindow: expectedWindow || null,
    actualStartDate: actualStartDate || null,
    actualEndDate: actualEndDate || null,
    actualWindow: actualWindow || null,
    lookaheadDays,
    exceededExpectedEnd,
    status: exceededExpectedEnd ? "exceeded_expected_end" : actualEndDate ? "ok" : "pending",
  }
}

function paperTradeMarketEvidenceRefs(marketEvidence = null) {
  if (!marketEvidence) return []
  return compactStringArray([
    marketEvidence.priceSqlRef,
    marketEvidence.marketDataRef,
    marketEvidence.benchmarkRef,
  ], 4, 260)
}

function paperTradeMicrostructureEvidenceRefs(microstructureEvidence = null) {
  if (!microstructureEvidence) return []
  return compactStringArray([
    microstructureEvidence.limitListRef,
    microstructureEvidence.limitStepRef,
    microstructureEvidence.topListRef,
    microstructureEvidence.topInstRef,
    microstructureEvidence.hotMoneyRef,
    microstructureEvidence.thsHotRef,
    microstructureEvidence.dcHotRef,
  ], 8, 260)
}

function summarizePaperTrades(paperTrades = []) {
  const byTrack = {}
  const byStatus = {}
  const byOutcome = {}
  const byValidationTarget = {}
  for (const trade of paperTrades) {
    const track = trade.track ?? "unknown"
    const status = trade.status ?? "unknown"
    const outcome = trade.profitFeedback?.outcome ?? "unknown"
    const target = trade.validationTarget ?? "unknown"
    byTrack[track] = (byTrack[track] ?? 0) + 1
    byStatus[status] = (byStatus[status] ?? 0) + 1
    byOutcome[outcome] = (byOutcome[outcome] ?? 0) + 1
    byValidationTarget[target] = (byValidationTarget[target] ?? 0) + 1
  }
  return {
    total: paperTrades.length,
    open: paperTrades.filter((trade) => trade.status === "open").length,
    closed: paperTrades.filter((trade) => trade.status === "closed").length,
    cancelled: paperTrades.filter((trade) => trade.status === "cancelled").length,
    profitable: paperTrades.filter((trade) => trade.profitFeedback?.outcome === "profitable").length,
    loss: paperTrades.filter((trade) => trade.profitFeedback?.outcome === "loss").length,
    flat: paperTrades.filter((trade) => trade.profitFeedback?.outcome === "flat").length,
    byTrack,
    byStatus,
    byOutcome,
    byValidationTarget,
  }
}

function paperTradeReviewPairKey(item = {}) {
  const stock = item.stock ?? {}
  return compactString(
    item.sourceTrajectoryId ??
    item.sourceQuestionId ??
    [
      stock.code ?? stock.name,
      item.asOfDate ?? item.entry?.date,
      item.validationTarget,
    ].filter(Boolean).join(":"),
    240,
  )
}

function paperTradeHasAsOfEvidenceRefs(trade = {}) {
  return (
    (trade.sourceRefs ?? []).length > 0 &&
    (trade.evidenceRefs ?? []).length > 0 &&
    trade.evidenceCutoff?.noFutureData === true &&
    Boolean(trade.asOfDate)
  )
}

function buildPaperTradeDiscretionaryReviewAudit({ paperTrades = [], paperTradeAgentCandidates = [] } = {}) {
  const llmAgentCandidates = paperTradeAgentCandidates.filter((item) => item.track === "llm_discretionary")
  const ruleAgentCandidates = paperTradeAgentCandidates.filter((item) => item.track === "rule_baseline")
  const llmTrades = paperTrades.filter((item) => item.track === "llm_discretionary")
  const ruleTrades = paperTrades.filter((item) => item.track === "rule_baseline")
  const ruleByKey = new Map()
  for (const trade of ruleTrades) {
    const key = paperTradeReviewPairKey(trade)
    if (!key) continue
    const current = ruleByKey.get(key)
    if (!current || (trade.status === "closed" && current.status !== "closed")) {
      ruleByKey.set(key, trade)
    }
  }
  const items = llmTrades
    .slice()
    .sort((a, b) => String(b.generatedAt ?? "").localeCompare(String(a.generatedAt ?? "")) || String(b.id ?? "").localeCompare(String(a.id ?? "")))
    .map((trade) => {
      const pairKey = paperTradeReviewPairKey(trade)
      const pairedRule = pairKey ? ruleByKey.get(pairKey) : null
      const evidenceCutoffOk = trade.evidenceCutoff?.noFutureData === true && Boolean(trade.asOfDate)
      const hasEvidenceRefs = paperTradeHasAsOfEvidenceRefs(trade)
      const readyForReview = trade.status === "closed" && pairedRule?.status === "closed" && hasEvidenceRefs
      const nextAction = !pairedRule
        ? "record_or_settle_rule_baseline_pair"
        : trade.status !== "closed"
          ? "settle_llm_discretionary_trade"
          : pairedRule.status !== "closed"
            ? "settle_rule_baseline_pair"
            : !hasEvidenceRefs
              ? "attach_asof_source_and_evidence_refs"
              : "ready_for_discretionary_review_runner"
      return {
        schema: "stock-feedback-discretionary-review-item-v1",
        paperTradeId: trade.id ?? null,
        pairKey: pairKey || null,
        stock: trade.stock ?? null,
        asOfDate: trade.asOfDate ?? null,
        status: trade.status ?? null,
        pairedRuleBaselineTradeId: pairedRule?.id ?? null,
        pairedRuleBaselineStatus: pairedRule?.status ?? null,
        sourceRefCount: (trade.sourceRefs ?? []).length,
        evidenceRefCount: (trade.evidenceRefs ?? []).length,
        evidenceCutoffOk,
        readyForReview,
        nextAction,
      }
    })
  const counts = {
    llmAgentCandidates: llmAgentCandidates.length,
    ruleAgentCandidates: ruleAgentCandidates.length,
    llmPaperTrades: llmTrades.length,
    ruleBaselinePaperTrades: ruleTrades.length,
    openLlmPaperTrades: llmTrades.filter((item) => item.status === "open").length,
    closedLlmPaperTrades: llmTrades.filter((item) => item.status === "closed").length,
    pairedRuleBaselineTrades: items.filter((item) => item.pairedRuleBaselineTradeId).length,
    missingEvidenceRefs: items.filter((item) => !item.evidenceCutoffOk || item.sourceRefCount <= 0 || item.evidenceRefCount <= 0).length,
    readyPairs: items.filter((item) => item.readyForReview).length,
  }
  const nextAction = counts.llmPaperTrades <= 0 && counts.llmAgentCandidates <= 0
    ? "build_paper_trade_agent_candidates"
    : counts.llmPaperTrades <= 0
      ? "record_llm_discretionary_paper_trades"
      : counts.openLlmPaperTrades > 0
        ? "settle_llm_discretionary_trade"
        : counts.pairedRuleBaselineTrades < counts.llmPaperTrades
          ? "record_or_settle_rule_baseline_pair"
          : counts.missingEvidenceRefs > 0
            ? "attach_asof_source_and_evidence_refs"
            : counts.readyPairs > 0
              ? "ready_for_discretionary_review_runner"
              : "review_discretionary_pair_gaps"
  const status = counts.readyPairs > 0
    ? "ready"
    : nextAction === "build_paper_trade_agent_candidates"
      ? "empty"
      : "blocked"
  return {
    schema: "stock-feedback-discretionary-review-audit-v1",
    status,
    counts,
    nextAction,
    items: items.slice(0, 8),
    writeBoundary: {
      readOnly: true,
      wroteWiki: false,
      wroteRaw: false,
      wroteBrain: false,
      wrotePaperTradeLedger: false,
      wroteRealTradeLedger: false,
    },
    peftBoundary: {
      modelTrainingStarted: false,
      storesRawFacts: false,
      factsRemainIn: ["sourceRefs", "evidenceRefs", "price SQL or Tushare", "paper trade ledger"],
      adapterStores: ["behavior", "skill", "tool_habit", "decision_strategy"],
    },
  }
}

function compareDiscretionaryPaperTradePair(llmTrade = {}, baselineTrade = {}) {
  const llmRealizedPnlPct = firstFiniteNumber(llmTrade.profitFeedback?.realizedPnlPct)
  const baselineRealizedPnlPct = firstFiniteNumber(baselineTrade.profitFeedback?.realizedPnlPct)
  let result = "unknown"
  if (llmRealizedPnlPct !== null && baselineRealizedPnlPct !== null) {
    if (llmRealizedPnlPct > baselineRealizedPnlPct) result = "llm_outperformed"
    else if (llmRealizedPnlPct < baselineRealizedPnlPct) result = "llm_underperformed"
    else result = "tie"
  }
  return {
    result,
    llmRealizedPnlPct,
    baselineRealizedPnlPct,
    deltaPct: llmRealizedPnlPct !== null && baselineRealizedPnlPct !== null
      ? Number((llmRealizedPnlPct - baselineRealizedPnlPct).toFixed(4))
      : null,
    llmMaxDrawdownPct: firstFiniteNumber(llmTrade.profitFeedback?.maxDrawdownPct),
    baselineMaxDrawdownPct: firstFiniteNumber(baselineTrade.profitFeedback?.maxDrawdownPct),
    llmHoldingDays: firstFiniteNumber(llmTrade.profitFeedback?.holdingDays),
    baselineHoldingDays: firstFiniteNumber(baselineTrade.profitFeedback?.holdingDays),
    llmOutcome: llmTrade.profitFeedback?.outcome ?? "unknown",
    baselineOutcome: baselineTrade.profitFeedback?.outcome ?? "unknown",
  }
}

function routeDiscretionaryPaperTradeReview(comparison = {}) {
  if (comparison.result === "llm_underperformed") {
    return {
      recommendedAction: "route_llm_underperformance_to_negative_preference",
      routeTo: ["eval", "preference", "negative"],
      confidence: 0.82,
      reason: "LLM discretionary paper trade underperformed the paired rule baseline; keep it as execution-risk preference/eval material.",
      risks: ["paper_trade_not_real_profit", "requires_human_review_before_any_adapter_use"],
    }
  }
  if (comparison.result === "llm_outperformed") {
    return {
      recommendedAction: "review_low_weight_paper_adapter_candidate",
      routeTo: ["eval", "preference", "paper_adapter_candidate_after_human_review"],
      confidence: 0.68,
      reason: "LLM discretionary paper trade outperformed the paired rule baseline, but paper profit can only become low-weight adapter material after human review.",
      risks: ["paper_trade_not_real_profit", "possible_overfit_to_single_path", "requires_human_review_before_adapter"],
    }
  }
  if (comparison.result === "tie") {
    return {
      recommendedAction: "keep_as_eval_control",
      routeTo: ["eval"],
      confidence: 0.64,
      reason: "LLM discretionary and rule baseline produced the same realized return; keep as an evaluation control.",
      risks: ["thin_signal", "paper_trade_not_real_profit"],
    }
  }
  return {
    recommendedAction: "needs_manual_discretionary_review",
    routeTo: ["eval", "review_required"],
    confidence: 0.35,
    reason: "The paper trade pair is ready but realized PnL comparison is incomplete.",
    risks: ["missing_pnl_comparison", "requires_human_review"],
  }
}

function buildPaperTradeDiscretionaryReviewDraft({ item = {}, llmTrade = {}, baselineTrade = {}, generatedAt }) {
  const comparison = compareDiscretionaryPaperTradePair(llmTrade, baselineTrade)
  const routing = routeDiscretionaryPaperTradeReview(comparison)
  const sourceRefs = compactStringArray([
    ...(llmTrade.sourceRefs ?? []),
    ...(baselineTrade.sourceRefs ?? []),
    llmTrade.id ? `paper-trade:${llmTrade.id}` : "",
    baselineTrade.id ? `paper-trade:${baselineTrade.id}` : "",
  ], 16, 260)
  const evidenceRefs = compactStringArray([
    ...(llmTrade.evidenceRefs ?? []),
    ...(baselineTrade.evidenceRefs ?? []),
  ], 24, 260)
  return {
    schema: "stock-feedback-paper-trade-discretionary-review-draft-v1",
    id: `stockfb_discretionary_review_${shortHash(`${llmTrade.id}:${baselineTrade.id}:${generatedAt}`)}`,
    generatedAt,
    status: "draft",
    sourceKind: "paper_trade_discretionary_review",
    validationTarget: llmTrade.validationTarget ?? baselineTrade.validationTarget ?? "expectation_trade",
    llmPaperTradeId: llmTrade.id ?? item.paperTradeId ?? null,
    pairedRuleBaselineTradeId: baselineTrade.id ?? item.pairedRuleBaselineTradeId ?? null,
    pairKey: item.pairKey ?? paperTradeReviewPairKey(llmTrade),
    stock: llmTrade.stock ?? baselineTrade.stock ?? item.stock ?? null,
    asOfDate: llmTrade.asOfDate ?? baselineTrade.asOfDate ?? item.asOfDate ?? null,
    evidenceCutoff: {
      asOfDate: llmTrade.asOfDate ?? baselineTrade.asOfDate ?? item.asOfDate ?? null,
      noFutureData: true,
      enforcement: "review_uses_settled_pair_refs_only",
    },
    comparison,
    recommendedAction: routing.recommendedAction,
    routeTo: routing.routeTo,
    confidence: routing.confidence,
    reason: routing.reason,
    risks: routing.risks,
    reviewPrompt: {
      role: "paper_trade_discretionary_reviewer",
      instruction: "Compare LLM discretionary paper trade against paired rule_baseline using only as-of refs and settlement metrics. Do not treat paper PnL as real profit.",
      requiredChecks: [
        "as_of_cutoff_present",
        "sourceRefs_present",
        "evidenceRefs_present",
        "paper_trade_not_real_profit",
        "human_review_before_adapter",
      ],
    },
    decisionInputs: {
      llm: {
        paperTradeId: llmTrade.id ?? null,
        status: llmTrade.status ?? null,
        outcome: llmTrade.profitFeedback?.outcome ?? null,
        realizedPnlPct: comparison.llmRealizedPnlPct,
        maxDrawdownPct: comparison.llmMaxDrawdownPct,
        holdingDays: comparison.llmHoldingDays,
      },
      baseline: {
        paperTradeId: baselineTrade.id ?? null,
        status: baselineTrade.status ?? null,
        outcome: baselineTrade.profitFeedback?.outcome ?? null,
        realizedPnlPct: comparison.baselineRealizedPnlPct,
        maxDrawdownPct: comparison.baselineMaxDrawdownPct,
        holdingDays: comparison.baselineHoldingDays,
      },
    },
    sourceRefs,
    evidenceRefs,
    peftBoundary: {
      modelTrainingStarted: false,
      storesRawFacts: false,
      factsRemainIn: ["sourceRefs", "evidenceRefs", "price SQL or Tushare", "paper trade ledger"],
      adapterStores: ["behavior", "skill", "tool_habit", "decision_strategy"],
    },
  }
}

export async function runStockFeedbackPaperTradeDiscretionaryReview(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const generatedAt = options.generatedAt ?? nowLocalTimestamp()
  const limit = parsePositiveInteger(options.limit, 8)
  const paperTrades = await readStockFeedbackPaperTrades(projectPath)
  const paperTradeAgentCandidates = await readStockFeedbackPaperTradeAgentCandidates(projectPath)
  const audit = buildPaperTradeDiscretionaryReviewAudit({ paperTrades, paperTradeAgentCandidates })
  const paperTradeById = new Map(paperTrades.map((trade) => [trade.id, trade]))
  const drafts = (audit.items ?? [])
    .filter((item) => item.readyForReview)
    .slice(0, limit)
    .map((item) => buildPaperTradeDiscretionaryReviewDraft({
      item,
      llmTrade: paperTradeById.get(item.paperTradeId) ?? {},
      baselineTrade: paperTradeById.get(item.pairedRuleBaselineTradeId) ?? {},
      generatedAt,
    }))
  const summary = {
    totalDrafts: drafts.length,
    llmOutperformed: drafts.filter((item) => item.comparison?.result === "llm_outperformed").length,
    llmUnderperformed: drafts.filter((item) => item.comparison?.result === "llm_underperformed").length,
    tied: drafts.filter((item) => item.comparison?.result === "tie").length,
    unknown: drafts.filter((item) => item.comparison?.result === "unknown").length,
    negativeRoutes: drafts.filter((item) => item.routeTo?.includes("negative")).length,
    lowWeightAdapterReviewRoutes: drafts.filter((item) => item.routeTo?.includes("paper_adapter_candidate_after_human_review")).length,
  }
  return {
    schema: "stock-feedback-paper-trade-discretionary-review-result-v1",
    mode: "stock-feedback-paper-trade-discretionary-review",
    dryRun: true,
    projectPath,
    generatedAt,
    count: drafts.length,
    audit,
    summary,
    drafts,
    nextAction: drafts.length
      ? "review drafts, then route losing LLM decisions to eval/preference/negative or human-review winning paper candidates as low-weight adapter material"
      : audit.nextAction,
    writePolicy: {
      readOnly: true,
      wroteWiki: false,
      wroteRaw: false,
      wroteBrain: false,
      wrotePaperTradeLedger: false,
      wroteRealTradeLedger: false,
      wroteArtifacts: false,
    },
    peftBoundary: {
      modelTrainingStarted: false,
      storesRawFacts: false,
      factsRemainIn: ["sourceRefs", "evidenceRefs", "price SQL or Tushare", "paper trade ledger"],
      adapterStores: ["behavior", "skill", "tool_habit", "decision_strategy"],
    },
  }
}

function firstPaperTradePlanningDate(trajectory = {}) {
  return paperTradeDateOnly(
    trajectory.evidenceState?.asOfDate ??
    trajectory.paperTradeState?.asOfDate ??
    trajectory.eventTimeline?.find((item) => paperTradeDateOnly(item?.at))?.at ??
    trajectory.generatedAt,
  )
}

function paperTradePlanSourceQuestionId(trajectory = {}) {
  return compactString(
    trajectory.evidenceState?.sourceDraftId ??
    trajectory.evidenceState?.sourceTaskId ??
    trajectory.questionRecordId ??
    trajectory.questionId ??
    trajectory.sourceRecordId ??
    trajectory.id,
    180,
  ) || null
}

function paperTradePlanRefs(trajectory = {}) {
  const sourceRefs = compactStringArray([
    ...(trajectory.sourceRefs ?? []),
    trajectory.sourceRecordId ? `trajectory-source:${trajectory.sourceRecordId}` : "",
  ], 10, 220)
  const confirmedEvidenceRefs = compactStringArray(trajectory.evidenceState?.confirmedEvidenceRefs, 10, 220)
  const evidenceRefs = confirmedEvidenceRefs.length
    ? confirmedEvidenceRefs
    : compactStringArray([
      ...(trajectory.evidenceRefs ?? []),
      ...sourceRefs,
      trajectory.artifactPath ? `${trajectory.artifactPath}${trajectory.artifactLine ? `#L${trajectory.artifactLine}` : ""}` : "",
    ], 10, 220)
  return { sourceRefs, evidenceRefs }
}

function paperTradeEntryPriceHint(trajectory = {}) {
  const entryPrice = firstFiniteNumber(
    trajectory.executionPriceHint?.entryPrice,
    trajectory.paperTradeState?.entryPrice,
  )
  if (entryPrice === null) return null
  return {
    entryPrice,
    priceSource: trajectory.executionPriceHint?.source
      ? "real_execution_result_entry_price"
      : "paper_trade_state_entry_price",
    priceQuality: trajectory.executionPriceHint?.priceQuality ?? null,
    sourceRefs: compactStringArray(trajectory.executionPriceHint?.sourceRefs, 6, 220),
  }
}

function paperTradeRecordCommandPreview(draft = {}) {
  const entryPrice = firstFiniteNumber(draft.entry?.price)
  const args = [
    "stock-feedback",
    "paper-trade",
    "record",
    "--track",
    draft.track,
    "--validation-target",
    draft.validationTarget,
    "--as-of-date",
    draft.asOfDate,
    "--source-trajectory-id",
    draft.sourceTrajectoryId,
    "--entry-date",
    draft.entry.date,
    "--entry-price",
    entryPrice === null ? "<market_price_required>" : String(entryPrice),
  ]
  if (draft.stock?.code) args.push("--stock-code", draft.stock.code)
  if (draft.stock?.name) args.push("--stock-name", draft.stock.name)
  if (draft.sourceQuestionId) args.push("--source-question-id", draft.sourceQuestionId)
  if (draft.sourceRefs?.length) args.push("--source-refs", draft.sourceRefs.join(","))
  if (draft.evidenceRefs?.length) args.push("--evidence-refs", draft.evidenceRefs.join(","))
  return args.join(" ")
}

function buildPaperTradePlanCandidate(trajectory = {}, track = "rule_baseline") {
  const asOfDate = firstPaperTradePlanningDate(trajectory)
  const { sourceRefs, evidenceRefs } = paperTradePlanRefs(trajectory)
  const priceHint = paperTradeEntryPriceHint(trajectory)
  const entryPrice = priceHint?.entryPrice ?? null
  const missingRequiredFields = []
  if (!asOfDate) missingRequiredFields.push("asOfDate")
  if (!trajectory.stock?.code && !trajectory.stock?.name) missingRequiredFields.push("stock")
  if (entryPrice === null) missingRequiredFields.push("entryPrice")
  const readinessStatus = missingRequiredFields.length === 0
    ? "ready"
    : missingRequiredFields.length === 1 && missingRequiredFields[0] === "entryPrice" ? "needs_market_price" : "blocked"
  const draft = {
    id: `stockfb_paper_plan_${shortHash(`${trajectory.id}:${track}:${asOfDate}`)}`,
    track,
    ledgerKind: "paper_trade",
    sourceTrajectoryId: trajectory.id ?? null,
    sourceRecordId: trajectory.sourceRecordId ?? null,
    sourceQuestionId: paperTradePlanSourceQuestionId(trajectory),
    validationTarget: trajectory.validationTarget ?? "expectation_trade",
    qualityGate: trajectory.qualityGate?.status ?? null,
    marketPatterns: (trajectory.marketPatterns ?? []).map((item) => ({ id: item.id, label: item.label })).filter((item) => item.id || item.label),
    stock: {
      name: compactString(trajectory.stock?.name ?? trajectory.stock?.label, 80) || null,
      code: compactString(trajectory.stock?.code, 32) || null,
    },
    asOfDate: asOfDate || null,
    hypothesis: compactString(trajectory.hypothesis ?? trajectory.question, 280),
    expectedMove: compactString(trajectory.summary ?? trajectory.distillationSignals?.decisionStrategy ?? trajectory.distillationSignals?.behavior, 220),
    entry: {
      date: asOfDate || null,
      price: entryPrice,
      priceSource: priceHint?.priceSource ?? "market_data_at_as_of_required",
      priceQuality: priceHint?.priceQuality ?? null,
      timing: compactString(trajectory.profitFeedback?.entryTiming, 140),
    },
    positionSizing: compactString(trajectory.profitFeedback?.positionSizing, 140),
    sourceRefs,
    evidenceRefs,
    readiness: {
      status: readinessStatus,
      missingRequiredFields,
      nextAction: readinessStatus === "ready"
        ? "record_paper_trade_candidate_with_existing_entry_price_and_auto_market_evidence"
        : "fill_entry_price_from_asof_market_data_then_record_paper_trade",
    },
    suggestedRecordCommand: "",
    peftBoundary: {
      storesRawFacts: false,
      factsRemainIn: ["retrieval/tool state", "sourceRefs", "price SQL or Tushare", "paper trade ledger"],
      adapterStores: ["behavior", "skill", "tool_habit", "decision_strategy"],
    },
  }
  return {
    ...draft,
    suggestedRecordCommand: paperTradeRecordCommandPreview(draft),
  }
}

function buildPaperTradePlanningSummary({ trajectories = [], paperTrades = [], limit = 6 } = {}) {
  const existingByTrajectoryTrack = new Set(
    paperTrades
      .map((trade) => trade.sourceTrajectoryId && trade.track ? `${trade.sourceTrajectoryId}:${trade.track}` : "")
      .filter(Boolean),
  )
  const eligibleTrajectories = trajectories
    .filter((trajectory) => trajectory.validationTarget === "expectation_trade")
    .filter((trajectory) => trajectory.source !== "stock-feedback-paper-trade")
    .filter((trajectory) => !trajectory.paperTradeState)
    .sort((a, b) => (
      Number(Boolean(b.qualityGate?.highConfidenceEligible)) - Number(Boolean(a.qualityGate?.highConfidenceEligible)) ||
      String(b.generatedAt ?? "").localeCompare(String(a.generatedAt ?? "")) ||
      String(a.id ?? "").localeCompare(String(b.id ?? ""))
    ))
  const candidates = []
  let skippedExisting = 0
  for (const trajectory of eligibleTrajectories) {
    for (const track of STOCK_FEEDBACK_PAPER_TRADE_TRACKS) {
      const key = `${trajectory.id}:${track}`
      if (existingByTrajectoryTrack.has(key)) {
        skippedExisting += 1
        continue
      }
      candidates.push(buildPaperTradePlanCandidate(trajectory, track))
      if (candidates.length >= limit) break
    }
    if (candidates.length >= limit) break
  }
  const missingEntryPrice = candidates.filter((candidate) => candidate.readiness?.missingRequiredFields?.includes("entryPrice")).length
  return {
    schema: STOCK_FEEDBACK_PAPER_TRADE_PLANNING_SUMMARY_SCHEMA,
    strategy: "trajectory_to_dual_track_paper_trade_plan_v1",
    counts: {
      eligibleTrajectories: eligibleTrajectories.length,
      candidates: candidates.length,
      skippedExisting,
      missingEntryPrice,
      readyToRecord: candidates.filter((candidate) => candidate.readiness?.status === "ready").length,
    },
    candidates,
    nextAction: candidates.length > 0
      ? "fill entryPrice from as-of market data, then record rule_baseline and llm_discretionary paper trades"
      : "collect or review expectation_trade trajectories before paper trade planning",
    writeBoundary: {
      readOnly: true,
      wroteWiki: false,
      wroteRaw: false,
      wroteBrain: false,
      wrotePaperTradeLedger: false,
      wroteRealTradeLedger: false,
    },
    peftBoundary: {
      modelTrainingStarted: false,
      storesRawFacts: false,
      factsRemainIn: ["retrieval/tool state", "sourceRefs", "price SQL or Tushare", "paper trade ledger"],
      adapterStores: ["behavior", "skill", "tool_habit", "decision_strategy"],
    },
  }
}

function isoDateFromStamp(value) {
  const text = String(value ?? "").trim()
  const match = text.match(/\d{4}-\d{2}-\d{2}/)
  return match?.[0] ?? null
}

function paperTradeAgentEntryPlan({ asOfDate, stock, sourceKind, evidenceRefs, expectedMove, entryPrice = null, priceSource = null, priceQuality = null }) {
  const numericEntryPrice = firstFiniteNumber(entryPrice)
  return {
    date: asOfDate,
    price: numericEntryPrice,
    priceSource: priceSource ?? "market_data_at_asof_required",
    priceQuality,
    reason: compactString(expectedMove || `Use as-of evidence from ${sourceKind} before opening paper trade.`, 220),
    evidenceRefs: compactStringArray(evidenceRefs, 8, 220),
    requiredMarketFields: ["entryPrice", "relativeStrength", "turnoverChange", "followThrough_1d", "followThrough_3d", "followThrough_5d"],
    stock,
  }
}

function paperTradeAgentExitPlan(track, invalidationCondition) {
  if (track === "rule_baseline") {
    return {
      track,
      rule: "exit on 5 trading days, invalidation trigger, or max drawdown breach; no discretionary future evidence",
      targetHoldingDays: 5,
      stopCondition: invalidationCondition || "follow-through fails or max drawdown exceeds planned risk",
    }
  }
  return {
    track,
    rule: "LLM discretionary hold/sell using only evidence available up to each review date",
    reviewCadence: "daily",
    stopCondition: invalidationCondition || "thesis invalidated, priced-in risk rises, or follow-through fails",
  }
}

function paperTradeAgentCandidateCommandPreview(candidate = {}) {
  const entryPrice = firstFiniteNumber(candidate.entryPlan?.price)
  const args = [
    "stock-feedback",
    "paper-trade",
    "record",
    "--track",
    candidate.track,
    "--validation-target",
    candidate.validationTarget,
    "--as-of-date",
    candidate.asOfDate,
    "--entry-date",
    candidate.entryPlan?.date,
    "--entry-price",
    entryPrice === null ? "<market_price_required>" : String(entryPrice),
  ]
  if (candidate.sourceTrajectoryId) args.push("--source-trajectory-id", candidate.sourceTrajectoryId)
  if (candidate.sourceQuestionId) args.push("--source-question-id", candidate.sourceQuestionId)
  if (candidate.stock?.code) args.push("--stock-code", candidate.stock.code)
  if (candidate.stock?.name) args.push("--stock-name", candidate.stock.name)
  if (candidate.hypothesis) args.push("--hypothesis", `"${candidate.hypothesis}"`)
  if (candidate.expectedCatalyst) args.push("--expected-move", `"${candidate.expectedCatalyst}"`)
  if (candidate.positionSizing) args.push("--position-sizing", `"${candidate.positionSizing}"`)
  if (candidate.sourceRefs?.length) args.push("--source-refs", candidate.sourceRefs.join(","))
  if (candidate.evidenceRefs?.length) args.push("--evidence-refs", candidate.evidenceRefs.join(","))
  args.push("--auto-market-evidence")
  return args.filter(Boolean).join(" ")
}

function buildPaperTradeAgentCandidateFromTrajectory(trajectory = {}, track = "rule_baseline") {
  const base = buildPaperTradePlanCandidate(trajectory, track)
  const invalidationCondition = compactString(trajectory.evidenceState?.evidenceGaps?.join("；") || trajectory.qualityGate?.reasons?.join("；"), 220)
  const expectedCatalyst = compactString(base.expectedMove || trajectory.distillationSignals?.decisionStrategy || trajectory.summary, 220)
  const candidate = {
    schema: STOCK_FEEDBACK_PAPER_TRADE_AGENT_CANDIDATE_SCHEMA,
    id: `stockfb_paper_agent_${shortHash(`trajectory:${base.sourceTrajectoryId}:${track}:${base.asOfDate}`)}`,
    generatedAt: nowLocalTimestamp(),
    sourceKind: "stock_feedback_trajectory",
    sourceTrajectoryId: base.sourceTrajectoryId,
    sourceRecordId: base.sourceRecordId,
    sourceQuestionId: base.sourceQuestionId,
    track,
    pairedTrack: track === "rule_baseline" ? "llm_discretionary" : "rule_baseline",
    ledgerKind: "paper_trade",
    validationTarget: base.validationTarget,
    asOfDate: base.asOfDate,
    evidenceCutoff: {
      asOfDate: base.asOfDate,
      noFutureData: true,
      enforcement: "candidate_requires_market_data_at_or_before_asOfDate",
    },
    stock: base.stock,
    hypothesis: base.hypothesis,
    expectedCatalyst,
    entryPlan: paperTradeAgentEntryPlan({
      asOfDate: base.asOfDate,
      stock: base.stock,
      sourceKind: "stock_feedback_trajectory",
      evidenceRefs: base.evidenceRefs,
      expectedMove: expectedCatalyst,
      entryPrice: base.entry?.price,
      priceSource: base.entry?.priceSource,
      priceQuality: base.entry?.priceQuality,
    }),
    exitPlan: paperTradeAgentExitPlan(track, invalidationCondition),
    positionSizing: base.positionSizing || "paper_trade_unit_risk_0.35x_until_reviewed",
    invalidationCondition,
    sourceRefs: base.sourceRefs,
    evidenceRefs: base.evidenceRefs,
    marketEvidenceRequest: {
      provider: "tushare_or_price_sql",
      asOfDate: base.asOfDate,
      fields: ["entryPrice", "maxDrawdown", "followThrough", "relativeStrength", "turnoverChange"],
    },
    readiness: base.readiness,
    suggestedRecordCommand: "",
    peftBoundary: base.peftBoundary,
  }
  return {
    ...candidate,
    suggestedRecordCommand: paperTradeAgentCandidateCommandPreview(candidate),
  }
}

function feedbackStockFromEvidence(feedback = {}) {
  const evidenceItems = Array.isArray(feedback.evidenceList) ? feedback.evidenceList : []
  const withStock = evidenceItems.find((item) => item?.stockCode || item?.stockName)
  const topLevelStock = Array.isArray(feedback.stocks)
    ? feedback.stocks.find((item) => item?.code || item?.stockCode || item?.name || item?.stockName)
    : null
  return {
    code: compactString(withStock?.stockCode ?? topLevelStock?.code ?? topLevelStock?.stockCode, 32) || null,
    name: compactString(withStock?.stockName ?? topLevelStock?.name ?? topLevelStock?.stockName, 80) || null,
  }
}

function buildPaperTradeAgentCandidateFromHypothesisFeedback(feedback = {}, track = "rule_baseline") {
  const asOfDate = isoDateFromStamp(feedback.generatedAt) ?? isoDateFromStamp(feedback.updatedAt)
  const stock = feedbackStockFromEvidence(feedback)
  const candidateFields = feedback.candidateFields ?? {}
  const evidenceRefs = compactStringArray([
    feedback.artifactPath,
    ...(feedback.evidenceRefs ?? []),
    ...(feedback.evidenceList ?? []).flatMap((item) => item.evidenceRefs ?? []),
  ], 16, 220)
  const sourceRefs = compactStringArray([
    ...(feedback.sourceRefs ?? []),
    ...(candidateFields.sourceRefs ?? []),
  ], 12, 220)
  const invalidationCondition = compactString((candidateFields.falsifiableConditions ?? []).join("；"), 220)
  const expectedCatalyst = compactString([
    ...(candidateFields.coreDrivers ?? []),
    feedback.watchtowerCandidate?.reason,
  ].filter(Boolean).join("；"), 220)
  const missingRequiredFields = []
  if (!asOfDate) missingRequiredFields.push("asOfDate")
  if (!stock.code && !stock.name) missingRequiredFields.push("stock")
  missingRequiredFields.push("entryPrice")
  const readinessStatus = missingRequiredFields.length === 1 && missingRequiredFields[0] === "entryPrice"
    ? "needs_market_price"
    : "blocked"
  const candidate = {
    schema: STOCK_FEEDBACK_PAPER_TRADE_AGENT_CANDIDATE_SCHEMA,
    id: `stockfb_paper_agent_${shortHash(`hypothesis:${feedback.hypothesisId}:${track}:${asOfDate}`)}`,
    generatedAt: nowLocalTimestamp(),
    sourceKind: "hypothesis_evidence_feedback",
    hypothesisId: feedback.hypothesisId ?? null,
    track,
    pairedTrack: track === "rule_baseline" ? "llm_discretionary" : "rule_baseline",
    ledgerKind: "paper_trade",
    validationTarget: "expectation_trade",
    asOfDate,
    evidenceCutoff: {
      asOfDate,
      noFutureData: true,
      enforcement: "candidate_built_from_hypothesis_feedback_generated_at",
    },
    stock,
    hypothesis: compactString(feedback.hypothesisTitle, 280),
    expectedCatalyst,
    entryPlan: paperTradeAgentEntryPlan({
      asOfDate,
      stock,
      sourceKind: "hypothesis_evidence_feedback",
      evidenceRefs,
      expectedMove: expectedCatalyst,
    }),
    exitPlan: paperTradeAgentExitPlan(track, invalidationCondition),
    positionSizing: "paper_trade_unit_risk_0.35x_until_reviewed",
    invalidationCondition,
    sourceRefs,
    evidenceRefs,
    evidenceScore: feedback.evidenceScore ?? null,
    watchtowerCandidate: feedback.watchtowerCandidate ?? null,
    humanGate: feedback.humanGate ?? null,
    marketEvidenceRequest: {
      provider: "tushare_or_price_sql",
      asOfDate,
      fields: ["entryPrice", "maxDrawdown", "followThrough", "relativeStrength", "turnoverChange"],
    },
    readiness: {
      status: readinessStatus,
      missingRequiredFields,
      nextAction: readinessStatus === "needs_market_price"
        ? "fill_entry_price_from_asof_market_data_then_record_paper_trade"
        : "attach stock code/name and as-of market data before paper trade",
    },
    suggestedRecordCommand: "",
    peftBoundary: {
      storesRawFacts: false,
      factsRemainIn: ["retrieval/tool state", "sourceRefs", "hypothesis evidence-feedback refs", "price SQL or Tushare", "paper trade ledger"],
      adapterStores: ["behavior", "skill", "tool_habit", "decision_strategy"],
    },
  }
  return {
    ...candidate,
    suggestedRecordCommand: paperTradeAgentCandidateCommandPreview(candidate),
  }
}

function summarizePaperTradeAgentCandidates(candidates = []) {
  const counts = {
    total: candidates.length,
    ruleBaseline: candidates.filter((item) => item.track === "rule_baseline").length,
    llmDiscretionary: candidates.filter((item) => item.track === "llm_discretionary").length,
    needsMarketPrice: candidates.filter((item) => item.readiness?.missingRequiredFields?.includes("entryPrice")).length,
    blocked: candidates.filter((item) => item.readiness?.status === "blocked").length,
    fromTrajectory: candidates.filter((item) => item.sourceKind === "stock_feedback_trajectory").length,
    fromHypothesisFeedback: candidates.filter((item) => item.sourceKind === "hypothesis_evidence_feedback").length,
  }
  return {
    schema: "stock-feedback-paper-trade-agent-summary-v1",
    strategy: "self_question_hypothesis_evidence_to_dual_track_paper_trade_candidate_v1",
    counts,
    candidates: candidates.slice(0, 12),
    nextAction: counts.total <= 0
      ? "refresh hypothesis evidence-feedback or generate expectation_trade trajectories before paper-trade-agent"
      : counts.needsMarketPrice > 0
      ? "fill entryPrice with as-of Tushare/price SQL, then record rule_baseline and llm_discretionary paper trades"
      : counts.blocked > 0
        ? "attach stock identity and sourceRefs before recording paper trades"
        : "record candidates through existing paper-trade record flow",
    writeBoundary: {
      readOnly: true,
      wroteWiki: false,
      wroteRaw: false,
      wroteBrain: false,
      wrotePaperTradeLedger: false,
      wroteRealTradeLedger: false,
    },
    peftBoundary: {
      modelTrainingStarted: false,
      storesRawFacts: false,
      factsRemainIn: ["retrieval/tool state", "sourceRefs", "price SQL or Tushare", "paper trade ledger"],
      adapterStores: ["behavior", "skill", "tool_habit", "decision_strategy"],
    },
  }
}

function buildPaperTradeAgentCurriculumSummary(candidates = []) {
  const counts = summarizePaperTradeAgentCandidates(candidates).counts
  return {
    schema: "stock-feedback-paper-trade-agent-curriculum-v1",
    modelTrainingStarted: false,
    defaultWeightMultiplier: 0.35,
    groups: [
      {
        id: "paper_trade_rule_baseline",
        label: "rule_baseline 模拟交易候选",
        count: counts.ruleBaseline,
        trainingUse: ["eval", "baseline_policy"],
        reviewGate: "record_and_settle_before_adapter",
      },
      {
        id: "paper_trade_llm_discretionary",
        label: "llm_discretionary 模拟交易候选",
        count: counts.llmDiscretionary,
        trainingUse: ["eval", "preference", "paper_adapter_candidate_after_review"],
        reviewGate: "compare_against_rule_baseline_before_weight_up",
      },
      {
        id: "paper_trade_blocked_evidence",
        label: "待补证/待补价格候选",
        count: counts.needsMarketPrice + counts.blocked,
        trainingUse: ["evidence_gap_queue"],
        reviewGate: "fill_asof_market_data_first",
      },
    ],
    counts,
    peftBoundary: {
      storesRawFacts: false,
      factsRemainIn: ["retrieval/tool state", "sourceRefs", "price SQL or Tushare", "paper trade ledger"],
      adapterStores: ["behavior", "skill", "tool_habit", "decision_strategy"],
    },
  }
}

function paperTradeDiscretionaryComparisonForCase(caseItem = {}) {
  const llmRealizedPnlPct = firstFiniteNumber(
    caseItem.expected?.llmRealizedPnlPct,
    caseItem.sourceAudit?.llmRealizedPnlPct,
    caseItem.profitFeedback?.realizedPnlPct,
  )
  const baselineRealizedPnlPct = firstFiniteNumber(
    caseItem.expected?.baselineRealizedPnlPct,
    caseItem.sourceAudit?.baselineRealizedPnlPct,
  )
  let result = "unknown"
  if (llmRealizedPnlPct !== null && baselineRealizedPnlPct !== null) {
    if (llmRealizedPnlPct > baselineRealizedPnlPct) result = "llm_outperformed"
    else if (llmRealizedPnlPct < baselineRealizedPnlPct) result = "llm_underperformed"
    else result = "tie"
  }
  return {
    result,
    llmRealizedPnlPct,
    baselineRealizedPnlPct,
    llmProfitable: llmRealizedPnlPct !== null && llmRealizedPnlPct > 0,
    baselineProfitable: baselineRealizedPnlPct !== null && baselineRealizedPnlPct > 0,
  }
}

function buildPaperTradeDiscretionaryReviewCurriculumSummary(cases = []) {
  const reviewCases = cases.filter((item) => item?.sourceKind === "paper_trade_discretionary_review")
  const comparisons = reviewCases.map(paperTradeDiscretionaryComparisonForCase)
  const counts = {
    total: reviewCases.length,
    llmWins: comparisons.filter((item) => item.result === "llm_outperformed").length,
    llmLosses: comparisons.filter((item) => item.result === "llm_underperformed").length,
    tied: comparisons.filter((item) => item.result === "tie").length,
    unknown: comparisons.filter((item) => item.result === "unknown").length,
    profitableLlmTrades: comparisons.filter((item) => item.llmProfitable).length,
    profitableBaselineTrades: comparisons.filter((item) => item.baselineProfitable).length,
  }
  return {
    schema: "stock-feedback-paper-trade-discretionary-review-curriculum-v1",
    modelTrainingStarted: false,
    highConfidenceEligible: false,
    defaultWeightMultiplier: 0.35,
    defaultRoute: ["eval", "preference", "paper_trade_discretionary_review"],
    groups: [
      {
        id: "paper_trade_discretionary_review_eval",
        label: "LLM discretionary vs rule_baseline 复盘",
        count: counts.total,
        trainingUse: ["eval", "preference", "paper_trade_discretionary_review"],
        reviewGate: "compare_asof_pair_before_adapter_use",
      },
      {
        id: "paper_trade_discretionary_review_llm_underperformed",
        label: "LLM 跑输规则基准",
        count: counts.llmLosses,
        trainingUse: ["eval", "preference", "negative"],
        reviewGate: "human_review_required_before_any_adapter_use",
      },
      {
        id: "paper_trade_discretionary_review_llm_outperformed",
        label: "LLM 跑赢规则基准",
        count: counts.llmWins,
        trainingUse: ["eval", "preference"],
        reviewGate: "human_review_required_before_low_weight_adapter_candidate",
      },
      {
        id: "paper_trade_discretionary_review_tie",
        label: "LLM 与规则基准持平",
        count: counts.tied,
        trainingUse: ["eval"],
        reviewGate: "keep_as_evaluation_control",
      },
    ],
    counts,
    policy: {
      paperTradeIsNotRealProfit: true,
      requiresHumanReviewBeforeAdapter: true,
      profitablePaperTradeDefaultUse: "low_weight_candidate_after_human_review_only",
      llmUnderperformanceDefaultUse: "negative_eval_preference",
    },
    peftBoundary: {
      storesRawFacts: false,
      factsRemainIn: ["retrieval/tool state", "sourceRefs", "price SQL or Tushare", "paper trade ledger", "benchmark cases"],
      adapterStores: ["behavior", "skill", "tool_habit", "decision_strategy"],
    },
  }
}

export async function buildStockFeedbackPaperTradeAgentCandidates(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const generatedAt = options.generatedAt ?? nowLocalTimestamp()
  const limit = parsePositiveInteger(options.limit, 12)
  const persisted = await readStockFeedbackTrajectories(projectPath)
  const trajectories = persisted.length ? persisted : (await buildStockFeedbackTrajectories({ projectPath, generatedAt })).trajectories
  const paperTrades = await readStockFeedbackPaperTrades(projectPath)
  const existingByTrajectoryTrack = new Set(
    paperTrades
      .map((trade) => trade.sourceTrajectoryId && trade.track ? `${trade.sourceTrajectoryId}:${trade.track}` : "")
      .filter(Boolean),
  )
  const trajectoryCandidates = []
  for (const trajectory of trajectories
    .filter((item) => item.validationTarget === "expectation_trade")
    .filter((item) => item.source !== "stock-feedback-paper-trade")
    .filter((item) => !item.paperTradeState)
    .slice(0, limit)) {
    for (const track of STOCK_FEEDBACK_PAPER_TRADE_TRACKS) {
      const key = `${trajectory.id}:${track}`
      if (existingByTrajectoryTrack.has(key)) continue
      trajectoryCandidates.push(buildPaperTradeAgentCandidateFromTrajectory(trajectory, track))
    }
  }
  const feedbackRecords = await readHypothesisEvidenceFeedbackRecords(projectPath)
  const hypothesisCandidates = []
  for (const feedback of feedbackRecords
    .filter((item) => item.watchtowerCandidate?.suggestedStatus !== "disconfirmed")
    .filter((item) => (item.trainingFlywheelRoutes ?? []).some((route) => route.route === "confirmed_evidence_to_trajectory"))
    .slice(0, limit)) {
    for (const track of STOCK_FEEDBACK_PAPER_TRADE_TRACKS) {
      hypothesisCandidates.push(buildPaperTradeAgentCandidateFromHypothesisFeedback(feedback, track))
    }
  }
  const hypothesisReserve = hypothesisCandidates.length > 0
    ? Math.min(hypothesisCandidates.length, Math.max(STOCK_FEEDBACK_PAPER_TRADE_TRACKS.length, Math.floor(limit / 3)))
    : 0
  const trajectoryBudget = Math.max(0, limit - hypothesisReserve)
  const orderedCandidates = [
    ...trajectoryCandidates.slice(0, trajectoryBudget),
    ...hypothesisCandidates.slice(0, hypothesisReserve),
    ...trajectoryCandidates.slice(trajectoryBudget),
    ...hypothesisCandidates.slice(hypothesisReserve),
  ]
  const deduped = []
  const seen = new Set()
  for (const candidate of orderedCandidates) {
    const key = [candidate.sourceKind, candidate.sourceTrajectoryId, candidate.hypothesisId, candidate.track, candidate.asOfDate].join(":")
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push({ ...candidate, generatedAt })
    if (deduped.length >= limit) break
  }
  const summary = summarizePaperTradeAgentCandidates(deduped)
  const manifest = {
    schema: STOCK_FEEDBACK_PAPER_TRADE_AGENT_MANIFEST_SCHEMA,
    generatedAt,
    projectPath,
    count: deduped.length,
    summary: summary.counts,
    sources: [
      "stock-feedback-trajectory-v1",
      "trading-hypothesis-evidence-feedback-v1",
      ".llm-wiki/stock-feedback/paper-trades/*.jsonl",
    ],
    writeBoundary: {
      root: STOCK_FEEDBACK_ROOT,
      family: "paper-trade-agent",
      wroteWiki: false,
      wroteRaw: false,
      wroteBrain: false,
      wrotePaperTradeLedger: false,
      wroteRealTradeLedger: false,
    },
  }
  let writeResult = null
  if (options.write) {
    writeResult = await writeJsonlWithManifest({
      projectPath,
      family: "paper-trade-agent",
      baseName: "stock-feedback-paper-trade-agent",
      records: deduped,
      manifest,
      generatedAt,
    })
  }
  return {
    schema: "stock-feedback-paper-trade-agent-result-v1",
    mode: "stock-feedback-paper-trade-agent",
    dryRun: !Boolean(options.write),
    projectPath,
    generatedAt,
    count: deduped.length,
    summary,
    candidates: deduped,
    manifest,
    writeResult: writeResult ? { candidates: writeResult.jsonl, manifest: writeResult.manifest } : null,
    writePolicy: {
      wroteWiki: false,
      wroteRaw: false,
      wroteBrain: false,
      wroteArtifacts: Boolean(options.write),
      wroteRealTradeLedger: false,
      allowedRoot: STOCK_FEEDBACK_ROOT,
    },
  }
}

async function readStockFeedbackPaperTradeAgentCandidates(projectPath) {
  return readStockFeedbackJsonlFamily(normalizePath(projectPath), "paper-trade-agent", STOCK_FEEDBACK_PAPER_TRADE_AGENT_CANDIDATE_SCHEMA, { latestOnly: true })
}

function compactPaperTrade(trade = {}) {
  return {
    id: trade.id ?? null,
    generatedAt: trade.generatedAt ?? null,
    firstRecordedAt: trade.firstRecordedAt ?? null,
    ledgerEventCount: trade.ledgerEventCount ?? null,
    asOfDate: trade.asOfDate ?? null,
    evidenceCutoff: trade.evidenceCutoff ?? null,
    ledgerKind: trade.ledgerKind ?? null,
    track: trade.track ?? null,
    status: trade.status ?? null,
    sourceQuestionId: trade.sourceQuestionId ?? null,
    sourceTrajectoryId: trade.sourceTrajectoryId ?? null,
    validationTarget: trade.validationTarget ?? null,
    stock: trade.stock ?? null,
    hypothesis: compactString(trade.hypothesis, 220),
    entry: trade.entry ?? null,
    exit: trade.exit ?? null,
    positionSizing: compactString(trade.positionSizing, 120),
    profitFeedback: trade.profitFeedback ?? null,
    marketEvidence: trade.marketEvidence ?? null,
    marketEvidenceWindow: trade.marketEvidenceWindow ?? null,
    marketEvidenceProvider: trade.marketEvidenceProvider ?? null,
    marketEvidenceStatus: trade.marketEvidenceStatus ?? null,
    marketEvidenceWarning: trade.marketEvidenceWarning ?? null,
    marketMicrostructureEvidence: trade.marketMicrostructureEvidence ?? null,
    microstructureEvidenceStatus: trade.microstructureEvidenceStatus ?? null,
    microstructureEvidenceWarning: trade.microstructureEvidenceWarning ?? null,
    settlement: trade.settlement ?? null,
    sourceRefs: compactStringArray(trade.sourceRefs, 8, 220),
    evidenceRefs: compactStringArray(trade.evidenceRefs, 8, 220),
    artifactPath: trade.artifactPath ?? null,
  }
}

function paperTradeSettlementCommandPreview(trade = {}) {
  return [
    "stock-feedback",
    "paper-trade",
    "settle",
    "--paper-trade-id",
    trade.id,
    "--exit-date",
    "<exit_date>",
    "--exit-price",
    "<exit_price>",
    "--evidence-refs",
    "<price_sql_or_tushare_ref>",
    "--write",
  ].filter(Boolean).join(" ")
}

function buildPaperTradeSettlementQueue(paperTrades = [], limit = 8) {
  const openTrades = paperTrades
    .filter((trade) => trade.status === "open" && trade.ledgerKind === "paper_trade")
    .slice()
    .sort((a, b) => (
      String(a.entry?.date ?? a.asOfDate ?? a.generatedAt ?? "").localeCompare(String(b.entry?.date ?? b.asOfDate ?? b.generatedAt ?? "")) ||
      String(a.id ?? "").localeCompare(String(b.id ?? ""))
    ))
  const items = openTrades.slice(0, limit).map((trade) => ({
    ...compactPaperTrade(trade),
    suggestedSettlementCommand: paperTradeSettlementCommandPreview(trade),
    requiredEvidence: ["exitDate", "exitPrice", "price SQL or Tushare settlement evidence", "maxDrawdownPct or marketEvidence.maxDrawdownInHolding"],
  }))
  return {
    schema: "stock-feedback-paper-trade-settlement-queue-v1",
    count: openTrades.length,
    items,
    nextAction: openTrades.length > 0
      ? "settle_open_paper_trades_with_asof_market_evidence"
      : "no_open_paper_trades_wait_for_new_agent_candidates_or_records",
    writeBoundary: {
      readOnly: true,
      wroteWiki: false,
      wroteRaw: false,
      wroteBrain: false,
      wrotePaperTradeLedger: false,
      wroteRealTradeLedger: false,
    },
  }
}

function buildPaperTradeSettlementArtifactRefreshPlan(paperTrade = {}, options = {}) {
  const wrote = Boolean(options.write)
  const status = wrote ? "needs_refresh_after_settlement" : "preview_only"
  const stages = [
    {
      id: "rebuild_trajectories",
      label: "重建轨迹",
      command: "stock-feedback build-trajectories --write",
      status: wrote ? "pending" : "preview_only",
      required: true,
      reason: "settled paper_trade must become stock-feedback trajectory before review, Benchmark, or adapter routing.",
    },
    {
      id: "human_review",
      label: "人审收益归因",
      command: "stock-feedback review-queue --include-reviewed",
      status: "blocked_until_trajectory",
      required: true,
      reason: "paper profit is low-weight only after human review and must not be treated as real realized PnL.",
    },
    {
      id: "build_benchmark",
      label: "生成 Benchmark",
      command: "stock-feedback bench --write",
      status: wrote ? "pending_after_trajectory" : "preview_only",
      required: true,
      reason: "settlement outcome should enter eval/preference coverage before LoRA-ready refresh.",
    },
    {
      id: "refresh_lora_ready",
      label: "刷新 LoRA-ready",
      command: "stock-feedback export-lora-ready --write",
      status: "blocked_until_human_review",
      required: true,
      reason: "profitable paper trade can only become a low-weight adapter candidate after explicit review.",
    },
    {
      id: "verify",
      label: "校验闭环",
      command: "stock-feedback verify",
      status: wrote ? "pending_after_refresh" : "preview_only",
      required: true,
      reason: "verify schema, refs, PEFT boundary, and paper-vs-real ledger separation after refresh.",
    },
  ]
  return {
    schema: "stock-feedback-paper-trade-settlement-refresh-plan-v1",
    status,
    paperTradeId: paperTrade.id ?? null,
    ledgerKind: "paper_trade",
    sourceRecordId: paperTrade.id ?? null,
    validationTarget: paperTrade.validationTarget ?? null,
    profitOutcome: paperTrade.profitFeedback?.outcome ?? null,
    executionEvidenceClass: paperTrade.profitFeedback?.executionEvidenceClass ?? null,
    staleArtifacts: wrote ? ["trajectories", "benchmark", "lora_ready"] : [],
    stages,
    commands: stages.map((stage) => stage.command),
    reviewGate: {
      paperTradeRequiresHumanReview: true,
      loraReadyRefreshBlockedUntilReview: true,
      reason: "Paper-trade profit is simulated evidence; LoRA-ready may only use it as a low-weight candidate after human approval.",
    },
    peftBoundary: {
      storesRawFacts: false,
      factsRemainIn: ["paper-trades", "sourceRefs", "evidenceRefs", "price SQL or Tushare refs"],
      adapterStores: ["behavior", "skill", "tool_habit", "decision_strategy"],
    },
    writeBoundary: {
      root: STOCK_FEEDBACK_ROOT,
      wroteWiki: false,
      wroteRaw: false,
      wroteBrain: false,
      wroteRealTradeLedger: false,
      modelTrainingStarted: false,
    },
  }
}

function buildPaperTradeSettlementRefreshAudit({
  paperTrades = [],
  trajectories = [],
  latestBenchmarkManifest = null,
  latestLoraReadyManifest = null,
  latestReviewMap = new Map(),
} = {}) {
  const trajectoryByPaperTradeId = new Map()
  for (const trajectory of trajectories) {
    const paperTradeId = trajectory.evidenceState?.paperTradeId ?? (
      trajectory.source === "stock-feedback-paper-trade" ? trajectory.sourceRecordId : null
    )
    if (paperTradeId && !trajectoryByPaperTradeId.has(paperTradeId)) {
      trajectoryByPaperTradeId.set(paperTradeId, trajectory)
    }
  }
  const benchmarkRefs = latestBenchmarkManifest?.caseRefs ?? []
  const loraReadyRefs = latestLoraReadyManifest?.candidateRefs ?? []
  const latestBenchmarkGeneratedAt = latestBenchmarkManifest?.generatedAt ?? null
  const latestLoraReadyGeneratedAt = latestLoraReadyManifest?.generatedAt ?? null
  const isBenchmarkCovered = (paperTradeId, trajectoryId) => benchmarkRefs.some((ref) => (
    Boolean(paperTradeId && ref.paperTradeId === paperTradeId) ||
    Boolean(trajectoryId && ref.sourceTrajectoryId === trajectoryId)
  ))
  const isLoraReadyCovered = (paperTradeId, trajectoryId) => loraReadyRefs.some((ref) => (
    Boolean(paperTradeId && ref.paperTradeId === paperTradeId) ||
    Boolean(trajectoryId && ref.sourceTrajectoryId === trajectoryId)
  ))
  const closedPaperTrades = paperTrades
    .filter((trade) => trade.ledgerKind === "paper_trade" && trade.status === "closed")
    .slice()
    .sort((a, b) => (
      String(b.settlement?.closedAt ?? b.generatedAt ?? "").localeCompare(String(a.settlement?.closedAt ?? a.generatedAt ?? "")) ||
      String(a.id ?? "").localeCompare(String(b.id ?? ""))
    ))
  const items = closedPaperTrades.map((trade) => {
    const trajectory = trajectoryByPaperTradeId.get(trade.id)
    const trajectoryId = trajectory?.id ?? null
    const review = trajectoryId ? (latestReviewMap.get(trajectoryId) ?? null) : null
    const benchmarkCovered = Boolean(trajectoryId && isBenchmarkCovered(trade.id, trajectoryId))
    const loraReadyCovered = Boolean(trajectoryId && isLoraReadyCovered(trade.id, trajectoryId))
    const paperAdapterEligible = (
      trade.profitFeedback?.outcome === "profitable" &&
      trade.profitFeedback?.executionEvidenceClass === "paper_pattern_execution_supported"
    )
    const approvedForPaperAdapter = review?.action === "approve_paper_adapter_candidate"
    const trajectoryStatus = trajectoryId ? "covered" : "missing"
    const benchmarkStatus = !trajectoryId ? "blocked_until_trajectory" : (benchmarkCovered ? "covered" : "missing")
    const reviewStatus = !trajectoryId ? "blocked_until_trajectory" : (review ? "reviewed" : "pending")
    const loraReadyStatus = !trajectoryId
      ? "blocked_until_trajectory"
      : !paperAdapterEligible
        ? "not_expected"
        : !approvedForPaperAdapter
          ? "blocked_until_human_review"
          : loraReadyCovered
            ? "covered"
            : "missing"
    const nextAction = !trajectoryId
      ? "rebuild_trajectories"
      : !benchmarkCovered
        ? "build_benchmark"
        : paperAdapterEligible && !approvedForPaperAdapter
          ? "review_paper_trade"
          : paperAdapterEligible && !loraReadyCovered
            ? "refresh_lora_ready"
            : "verify_complete"
    const refreshComplete = nextAction === "verify_complete"
    return {
      schema: "stock-feedback-paper-trade-settlement-refresh-audit-item-v1",
      paperTradeId: trade.id ?? null,
      trajectoryId,
      generatedAt: trade.generatedAt ?? null,
      settledAt: trade.settlement?.closedAt ?? trade.generatedAt ?? null,
      stock: trade.stock ?? null,
      track: trade.track ?? null,
      validationTarget: trade.validationTarget ?? null,
      profitOutcome: trade.profitFeedback?.outcome ?? "unknown",
      realizedPnlPct: trade.profitFeedback?.realizedPnlPct ?? null,
      executionEvidenceClass: trade.profitFeedback?.executionEvidenceClass ?? null,
      trajectoryStatus,
      benchmarkStatus,
      reviewStatus,
      loraReadyStatus,
      latestReviewAction: review?.action ?? null,
      nextAction,
      refreshComplete,
      latestBenchmarkGeneratedAt,
      latestLoraReadyGeneratedAt,
      artifactRefreshPlan: buildPaperTradeSettlementArtifactRefreshPlan(trade, { write: true }),
      writeBoundary: {
        readOnly: true,
        wroteWiki: false,
        wroteRaw: false,
        wroteBrain: false,
        wroteRealTradeLedger: false,
      },
    }
  })
  const pendingItems = items.filter((item) => !item.refreshComplete)
  return {
    schema: "stock-feedback-paper-trade-settlement-refresh-audit-v1",
    count: items.length,
    pending: pendingItems.length,
    completed: items.length - pendingItems.length,
    latestBenchmarkManifest: latestBenchmarkManifest?.artifactPath ?? null,
    latestLoraReadyManifest: latestLoraReadyManifest?.artifactPath ?? null,
    nextAction: pendingItems[0]?.nextAction ?? "no_settled_paper_trade_refresh_pending",
    items: items.slice(0, 8),
    writeBoundary: {
      readOnly: true,
      wroteWiki: false,
      wroteRaw: false,
      wroteBrain: false,
      wroteRealTradeLedger: false,
    },
  }
}

function buildStockFeedbackSampleDensityAudit({
  trajectories = [],
  upstreamInputs = {},
  paperTrades = [],
  paperTradeAgentSummary = null,
  paperTradeAgentWrittenCandidates = [],
  benchmarkManifests = [],
  loraManifests = [],
  latestReviewMap = new Map(),
  latestLoraReadyManifest = null,
} = {}) {
  const loraReadyBatches = loraManifests.filter((item) => item.schema === STOCK_FEEDBACK_LORA_READY_MANIFEST_SCHEMA).length
  const expectationTradeTrajectories = trajectories.filter((item) => item.validationTarget === "expectation_trade")
  const riskTrajectories = trajectories.filter((item) => (
    item.validationTarget === "priced_in_risk" ||
    item.validationTarget === "disconfirmation" ||
    item.profitFeedback?.profitCredit === "entry_wrong" ||
    item.profitFeedback?.executionEvidenceClass === "priced_in_late_entry"
  ))
  const fundamentalTrajectories = trajectories.filter((item) => item.validationTarget === "fundamental_closure")
  const openPaperTrades = paperTrades.filter((item) => item.ledgerKind === "paper_trade" && item.status === "open")
  const settledPaperTrades = paperTrades.filter((item) => item.ledgerKind === "paper_trade" && item.status === "closed")
  const profitablePaperTrades = settledPaperTrades.filter((item) => item.profitFeedback?.outcome === "profitable")
  const profitablePaperTrajectories = trajectories.filter(isProfitableClosedPaperTradeTrajectory)
  const reviewedPaperAdapterTrajectories = profitablePaperTrajectories.filter((item) => (
    latestReviewMap.get(item.id)?.action === "approve_paper_adapter_candidate"
  ))
  const loraReadyPaperRefs = latestLoraReadyManifest?.candidateRefs?.filter((item) => item.paperTradeId || item.sourceKind === "stock-feedback-paper-trade") ?? []
  const previewAgentCandidates = paperTradeAgentSummary?.counts?.total ?? 0
  const persistedAgentCandidates = paperTradeAgentWrittenCandidates.length
  const trajectorySourceInputCount = (
    (upstreamInputs.selfQuestionAttributions ?? 0) +
    (upstreamInputs.collectionResults ?? 0) +
    (upstreamInputs.paperTrades ?? 0) +
    (upstreamInputs.executionResults ?? 0)
  )
  const paperAgentSourceInputCount = (
    trajectories.length +
    trajectorySourceInputCount +
    (upstreamInputs.hypothesisEvidenceFeedback ?? 0)
  )
  const hasTrajectorySourceInput = trajectorySourceInputCount > 0
  const hasPaperAgentSourceInput = paperAgentSourceInputCount > 0
  const gaps = []
  const addGap = (condition, gap) => {
    if (condition) gaps.push(gap)
  }
  addGap(trajectories.length <= 0 && !hasTrajectorySourceInput, {
    id: "no_upstream_feedback_inputs",
    label: "缺少上游反馈输入",
    severity: "blocked",
    nextAction: "collect_self_question_or_hypothesis_feedback",
    command: "self-question loop --stages generate,validate,attribute --write",
    reason: "当前没有自提问归因、采集结果、真实 execution-result 或 paper trade 输入；直接 build-trajectories 只会空跑。",
  })
  addGap(trajectories.length <= 0 && hasTrajectorySourceInput, {
    id: "no_stock_feedback_trajectories",
    label: "缺少训练轨迹",
    severity: "blocked",
    nextAction: "build_trajectories_or_hypothesis_feedback",
    command: "stock-feedback build-trajectories --write",
    reason: "没有 stock-feedback-trajectory-v1 时，review、Benchmark 和 LoRA-ready 都没有稳定输入。",
  })
  addGap(expectationTradeTrajectories.length <= 0, {
    id: "no_expectation_trade_trajectories",
    label: "缺少预期交易轨迹",
    severity: "blocked",
    nextAction: "collect_expectation_trade_feedback",
    command: "stock-feedback list --validation-target expectation_trade",
    reason: "Paper Trade Agent 只从可审计的 expectation_trade 轨迹或假设证据反馈生成候选。",
  })
  addGap(previewAgentCandidates <= 0, {
    id: "no_paper_trade_agent_preview_candidates",
    label: "缺少 Agent 预览候选",
    severity: hasPaperAgentSourceInput ? "warn" : "blocked",
    nextAction: "refresh_hypothesis_feedback_or_agent_preview",
    command: hasPaperAgentSourceInput ? "stock-feedback paper-trade-agent candidates" : "hypothesis evidence-feedback --status watching --write",
    reason: hasPaperAgentSourceInput
      ? "已有上游输入但还没有 Paper Trade Agent 预览候选；先预览候选再写入持久化 candidate。"
      : "需要先让 self-question / Hypothesis / EvidenceResult 产出可转成双轨 paper trade 的候选。",
  })
  addGap(previewAgentCandidates > 0 && persistedAgentCandidates <= 0, {
    id: "paper_trade_agent_candidates_not_written",
    label: "Agent 候选未写入",
    severity: "warn",
    nextAction: "write_paper_trade_agent_candidates",
    command: "stock-feedback paper-trade-agent candidates --write",
    reason: "Benchmark 读取持久化 candidate；只有预览候选时，后续批次仍可能为空。",
  })
  addGap(paperTrades.length <= 0, {
    id: "no_paper_trades",
    label: "缺少模拟交易账本",
    severity: "warn",
    nextAction: "record_dual_track_paper_trades",
    command: "stock-feedback paper-trade record --track rule_baseline|llm_discretionary --write",
    reason: "需要把候选落到账本，才能进入 as-of 结算、收益归因和训练反馈。",
  })
  addGap(openPaperTrades.length > 0 && settledPaperTrades.length <= 0, {
    id: "open_paper_trades_not_settled",
    label: "模拟交易未结算",
    severity: "warn",
    nextAction: "settle_open_paper_trades",
    command: "stock-feedback paper-trade settle --paper-trade-id <id> --exit-date YYYY-MM-DD --exit-price <price> --write",
    reason: "open paper trade 只能作为监控样本，不能贡献 realizedPnlPct / maxDrawdownPct / holdingDays。",
  })
  addGap(settledPaperTrades.length > 0 && profitablePaperTrades.length <= 0, {
    id: "no_profitable_paper_trades",
    label: "缺少盈利模拟样本",
    severity: "warn",
    nextAction: "collect_profitable_or_negative_settlements",
    command: "stock-feedback paper-trade status",
    reason: "没有 profitable paper trade 时，执行手法正样本仍为空；亏损样本可先进 eval/preference。",
  })
  addGap(profitablePaperTrades.length > 0 && reviewedPaperAdapterTrajectories.length <= 0, {
    id: "profitable_paper_trades_not_reviewed",
    label: "盈利模拟样本未人审",
    severity: "blocked",
    nextAction: "approve_paper_adapter_candidate_after_review",
    command: "stock-feedback review --trajectory-id <id> --action approve_paper_adapter_candidate --write",
    reason: "paper profit 只能在人工确认后作为低权重 adapter candidate，不能自动冒充真实收益。",
  })
  addGap(benchmarkManifests.length <= 0, {
    id: "no_benchmark_batches",
    label: "缺少 Benchmark 批次",
    severity: "warn",
    nextAction: "build_benchmark_batch",
    command: "stock-feedback bench --write",
    reason: "没有 Benchmark 批次时，正负样本、entry_wrong 和 paper-trade-agent case 没有可回放评测入口。",
  })
  addGap(loraReadyBatches <= 0, {
    id: "no_lora_ready_batches",
    label: "缺少 LoRA-ready 批次",
    severity: "warn",
    nextAction: "export_lora_ready_manifest",
    command: "stock-feedback export-lora-ready --write",
    reason: "LoRA-ready 只输出行为、技能、工具习惯和决策策略候选；事实仍留在引用源。",
  })
  addGap(riskTrajectories.length <= 0, {
    id: "no_priced_in_or_negative_samples",
    label: "缺少风险/反例样本",
    severity: "info",
    nextAction: "collect_priced_in_entry_wrong_or_disconfirmed_samples",
    command: "stock-feedback list --validation-target priced_in_risk",
    reason: "训练闭环需要方向对但后手风险、entry_wrong 和失败归因样本，否则只会学会看多表达。",
  })
  addGap(fundamentalTrajectories.length <= 0, {
    id: "no_fundamental_closure_samples",
    label: "缺少基本面兑现样本",
    severity: "info",
    nextAction: "collect_fundamental_closure_evidence",
    command: "stock-feedback list --validation-target fundamental_closure",
    reason: "预期交易和基本面兑现是不同训练目标；订单、公告、财报等兑现证据需要单独闭环。",
  })
  const blocked = gaps.some((item) => item.severity === "blocked")
  const warnings = gaps.some((item) => item.severity === "warn")
  const status = blocked ? "blocked" : warnings ? "thin" : gaps.length > 0 ? "watch" : "ready"
  const primaryGap = gaps[0] ?? null
  const sourceInputNextCommands = hasPaperAgentSourceInput
    ? [
      ...(hasTrajectorySourceInput ? ["stock-feedback build-trajectories --write"] : []),
      "stock-feedback paper-trade-agent candidates",
    ]
    : [
      "self-question loop --stages generate,validate,attribute --write",
      "hypothesis evidence-feedback --status watching --write",
      "stock-feedback collection-task --write",
    ]
  const sourceInputPlan = {
    status: hasPaperAgentSourceInput ? "has_upstream_inputs" : "needs_upstream_inputs",
    hasTrajectorySourceInput,
    hasPaperAgentSourceInput,
    trajectorySourceInputs: ["self-question attribution", "stock-feedback collection result", "real execution result", "paper trade ledger"],
    paperAgentSourceInputs: ["stock-feedback trajectory", "hypothesis evidence-feedback"],
    nextCommands: sourceInputNextCommands,
  }
  const recommendedCommands = hasPaperAgentSourceInput
    ? gaps
      .filter((item) => item.command)
      .slice(0, 6)
      .map((item) => ({ id: item.id, label: item.label, command: item.command, nextAction: item.nextAction }))
    : sourceInputPlan.nextCommands.map((command, index) => ({
      id: index === 0 ? "collect_self_question_feedback" : index === 1 ? "collect_hypothesis_feedback" : "create_collection_task",
      label: index === 0 ? "生成自提问反馈" : index === 1 ? "生成假设证据反馈" : "创建补样本任务",
      command,
      nextAction: "collect_self_question_or_hypothesis_feedback",
    }))
  return {
    schema: "stock-feedback-sample-density-audit-v1",
    status,
    tone: status === "ready" ? "good" : blocked ? "danger" : "warn",
    headline: status === "ready"
      ? "样本密度满足当前闭环"
      : blocked
        ? "样本密度不足，训练闭环被阻塞"
        : "样本密度偏薄，先补关键批次",
    detail: primaryGap?.reason ?? "轨迹、Benchmark、LoRA-ready 和 paper trade 低权重边界均已形成可审计入口。",
    counts: {
      trajectories: trajectories.length,
      upstreamInputs: {
        brainRecords: upstreamInputs.brainRecords ?? 0,
        selfQuestionQuestions: upstreamInputs.selfQuestionQuestions ?? 0,
        selfQuestionValidations: upstreamInputs.selfQuestionValidations ?? 0,
        selfQuestionAttributions: upstreamInputs.selfQuestionAttributions ?? 0,
        selfQuestionEvidenceResults: upstreamInputs.selfQuestionEvidenceResults ?? 0,
        hypothesisEvidenceFeedback: upstreamInputs.hypothesisEvidenceFeedback ?? 0,
        collectionResults: upstreamInputs.collectionResults ?? 0,
        executionResults: upstreamInputs.executionResults ?? 0,
        paperTrades: upstreamInputs.paperTrades ?? 0,
        evidenceTasks: upstreamInputs.evidenceTasks ?? 0,
        evidenceResults: upstreamInputs.evidenceResults ?? 0,
      },
      hasTrajectorySourceInput,
      hasPaperAgentSourceInput,
      expectationTradeTrajectories: expectationTradeTrajectories.length,
      riskTrajectories: riskTrajectories.length,
      fundamentalTrajectories: fundamentalTrajectories.length,
      paperTradeAgentPreviewCandidates: previewAgentCandidates,
      paperTradeAgentWrittenCandidates: persistedAgentCandidates,
      paperTrades: paperTrades.length,
      openPaperTrades: openPaperTrades.length,
      settledPaperTrades: settledPaperTrades.length,
      profitablePaperTrades: profitablePaperTrades.length,
      profitablePaperTrajectories: profitablePaperTrajectories.length,
      reviewedPaperAdapterTrajectories: reviewedPaperAdapterTrajectories.length,
      loraReadyPaperRefs: loraReadyPaperRefs.length,
      benchmarkBatches: benchmarkManifests.length,
      loraReadyBatches,
    },
    nextAction: primaryGap?.nextAction ?? "continue_review_and_refresh_loop",
    recommendedCommands,
    sourceInputPlan,
    gaps,
    writeBoundary: {
      readOnly: true,
      wroteWiki: false,
      wroteRaw: false,
      wroteBrain: false,
      wroteArtifacts: false,
      wrotePaperTradeLedger: false,
      wroteRealTradeLedger: false,
    },
    peftBoundary: {
      modelTrainingStarted: false,
      storesRawFacts: false,
      factsRemainIn: ["retrieval/tool state", "sourceRefs", "price SQL or Tushare", "paper trade ledger"],
      adapterStores: ["behavior", "skill", "tool_habit", "decision_strategy"],
    },
  }
}

function validatePaperTrade(trade = {}) {
  const issues = []
  if (trade.schema !== STOCK_FEEDBACK_PAPER_TRADE_SCHEMA) {
    issues.push({ code: "unexpected_paper_trade_schema", id: trade.id ?? null })
  }
  if (trade.ledgerKind !== "paper_trade") {
    issues.push({
      code: "paper_trade_invalid_ledger_kind",
      id: trade.id ?? null,
      ledgerKind: trade.ledgerKind ?? null,
    })
  }
  if (!STOCK_FEEDBACK_PAPER_TRADE_TRACKS.includes(trade.track)) {
    issues.push({ code: "invalid_paper_trade_track", id: trade.id ?? null, track: trade.track ?? null })
  }
  if (!STOCK_FEEDBACK_PAPER_TRADE_STATUSES.includes(trade.status)) {
    issues.push({ code: "invalid_paper_trade_status", id: trade.id ?? null, status: trade.status ?? null })
  }
  if (trade.profitFeedback?.ledgerKind && trade.profitFeedback.ledgerKind !== "paper_trade") {
    issues.push({
      code: "paper_trade_profit_feedback_invalid_ledger_kind",
      id: trade.id ?? null,
      ledgerKind: trade.profitFeedback.ledgerKind,
    })
  }
  if (trade.profitFeedback?.executionMode && trade.profitFeedback.executionMode !== "paper") {
    issues.push({
      code: "paper_trade_profit_feedback_invalid_execution_mode",
      id: trade.id ?? null,
      executionMode: trade.profitFeedback.executionMode,
    })
  }
  if (!trade.asOfDate && !trade.evidenceCutoff?.asOfDate) {
    issues.push({ code: "paper_trade_missing_as_of_date", id: trade.id ?? null })
  }
  if (trade.evidenceCutoff && trade.evidenceCutoff.noFutureData !== true) {
    issues.push({ code: "paper_trade_missing_no_future_data_cutoff", id: trade.id ?? null })
  }
  if (trade.marketEvidence && !trade.marketEvidence.priceSqlRef && !trade.marketEvidence.marketDataRef) {
    issues.push({ code: "paper_trade_market_evidence_missing_ref", id: trade.id ?? null })
  }
  if (trade.marketEvidenceWindow?.exceededExpectedEnd === true) {
    issues.push({
      code: "paper_trade_market_evidence_window_exceeded",
      id: trade.id ?? null,
      expectedWindow: trade.marketEvidenceWindow.expectedWindow ?? null,
      actualWindow: trade.marketEvidenceWindow.actualWindow ?? null,
    })
  }
  if (trade.autoEvidenceGate?.blocksWrite === true) {
    issues.push({
      code: "paper_trade_auto_evidence_gate_blocked",
      id: trade.id ?? null,
      gateStatus: trade.autoEvidenceGate.status ?? null,
      detail: compactString(trade.autoEvidenceGate.detail, 500) || null,
    })
  }
  if (trade.peftBoundary?.storesRawFacts !== false) {
    issues.push({ code: "paper_trade_missing_peft_boundary", id: trade.id ?? null })
  }
  return issues
}

export async function getStockFeedbackPaperTradeStatus(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const generatedAt = nowLocalTimestamp()
  const paperTrades = await readStockFeedbackPaperTrades(projectPath)
  const summary = summarizePaperTrades(paperTrades)
  const limit = parsePositiveInteger(options.limit ?? 8, 8)
  const settlementQueue = buildPaperTradeSettlementQueue(paperTrades, limit)
  const recentPaperTrades = paperTrades
    .slice()
    .sort((a, b) => String(b.generatedAt ?? "").localeCompare(String(a.generatedAt ?? "")) || String(b.id ?? "").localeCompare(String(a.id ?? "")))
    .slice(0, limit)
    .map(compactPaperTrade)
  return {
    schema: "stock-feedback-paper-trade-status-v1",
    mode: "stock-feedback-paper-trade-status",
    generatedAt,
    projectPath,
    counts: summary,
    byTrack: summary.byTrack,
    byStatus: summary.byStatus,
    byOutcome: summary.byOutcome,
    byValidationTarget: summary.byValidationTarget,
    recentPaperTrades,
    settlementQueue,
    writePolicy: {
      readOnly: true,
      wroteWiki: false,
      wroteRaw: false,
      wroteBrain: false,
      wroteRealTradeLedger: false,
      wroteArtifacts: false,
    },
  }
}

export async function recordStockFeedbackPaperTrade(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const generatedAt = options.generatedAt ?? nowLocalTimestamp()
  const requestedLedgerKind = normalizeToken(options.ledgerKind ?? options["ledger-kind"] ?? "paper_trade")
  if (requestedLedgerKind && requestedLedgerKind !== "paper_trade") {
    throw new Error("--ledger-kind must be paper_trade; paper trade records cannot masquerade as a real trade ledger")
  }
  const track = parseStockFeedbackPaperTradeTrack(options.track ?? options.strategyTrack)
  const stockName = compactString(options.stockName ?? options["stock-name"], 80) || null
  const stockCode = compactString(options.stockCode ?? options["stock-code"], 32) || null
  if (!stockName && !stockCode) throw new Error("--stock-code or --stock-name is required")
  const entryDate = compactString(options.entryDate ?? options["entry-date"], 32)
  const entryPrice = firstFiniteNumber(options.entryPrice, options["entry-price"])
  if (!entryDate) throw new Error("--entry-date is required for paper trade record")
  if (entryPrice === null) throw new Error("--entry-price is required for paper trade record")
  const asOfDate = compactString(options.asOfDate ?? options["as-of-date"] ?? options.decisionDate ?? options["decision-date"] ?? entryDate, 32)
  const exitDate = compactString(options.exitDate ?? options["exit-date"], 32)
  const exitPrice = firstFiniteNumber(options.exitPrice, options["exit-price"])
  const realizedPnlPct = firstFiniteNumber(
    options.realizedPnlPct,
    options["realized-pnl-pct"],
    options.pnlPct,
    options["pnl-pct"],
    computedRealizedPnlPct(entryPrice, exitPrice),
  )
  const maxDrawdownPct = firstFiniteNumber(options.maxDrawdownPct, options["max-drawdown-pct"], options.drawdownPct, options["drawdown-pct"])
  const holdingDays = firstFiniteNumber(options.holdingDays, options["holding-days"], options.holdDays, options["hold-days"])
  const status = inferPaperTradeStatus(options, exitDate, exitPrice, realizedPnlPct)
  const validationTarget = parseStockFeedbackValidationTarget(options.validationTarget ?? options["validation-target"] ?? options.target ?? "expectation_trade") ?? "expectation_trade"
  const sourceRefs = compactList(options.sourceRefs ?? options["source-refs"] ?? options.sourceRef ?? options["source-ref"], 20, 260)
  const entryTiming = compactOptionalString(options.entryTiming ?? options["entry-timing"], 140)
  const exitTiming = compactOptionalString(options.exitTiming ?? options["exit-timing"], 140)
  const positionSizing = compactOptionalString(options.positionSizing ?? options["position-sizing"], 140)
  const exitReason = compactOptionalString(options.exitReason ?? options["exit-reason"], 220)
  const profitFeedback = {
    executionMode: "paper",
    ledgerKind: "paper_trade",
    outcome: status === "closed" ? profitOutcomeFromPnl(realizedPnlPct, {}) : "open",
    realizedPnlPct,
    maxDrawdownPct,
    holdingDays,
    entryTiming,
    exitTiming,
    positionSizing,
  }
  const cleanProfitFeedback = Object.fromEntries(Object.entries(profitFeedback).filter(([, value]) => value !== null && value !== undefined && value !== ""))
  const marketEvidenceProvider = normalizeMarketEvidenceProvider(options.marketEvidenceProvider ?? options["market-evidence-provider"])
  const autoMarketEvidenceRequested = parseBooleanLike(options.autoMarketEvidence ?? options["auto-market-evidence"], false)
  let autoMarketEvidenceResult = null
  if (autoMarketEvidenceRequested) {
    if (marketEvidenceProvider === "tushare") {
      autoMarketEvidenceResult = await derivePaperTradeMarketEvidenceFromTushare({
        stockCode,
        entryDate,
        entryPrice,
        exitDate,
        options,
      })
    } else {
      autoMarketEvidenceResult = await derivePaperTradeMarketEvidenceFromSql({
        projectPath,
        stockCode,
        entryDate,
        entryPrice,
        exitDate,
        options,
      })
      if (marketEvidenceProvider === "auto" && autoMarketEvidenceResult?.status !== "ok") {
        autoMarketEvidenceResult = await derivePaperTradeMarketEvidenceFromTushare({
          stockCode,
          entryDate,
          entryPrice,
          exitDate,
          options,
        })
      }
    }
  }
  const explicitMarketEvidenceOptions = Object.fromEntries(
    Object.entries(options).filter(([, value]) => value !== undefined && value !== null && value !== ""),
  )
  const marketEvidence = buildPaperTradeMarketEvidence({
    ...(autoMarketEvidenceResult?.marketEvidence ?? {}),
    ...explicitMarketEvidenceOptions,
  }, cleanProfitFeedback)
  const marketEvidenceStatus = autoMarketEvidenceResult?.status ?? (marketEvidence ? "provided" : "missing")
  const marketEvidenceWarning = autoMarketEvidenceResult?.warning ?? null
  const marketEvidenceNativeQuery = autoMarketEvidenceResult?.nativeQuery ?? null
  const marketEvidenceWindow = buildPaperTradeMarketEvidenceWindow({
    entryDate,
    exitDate,
    options,
    marketEvidence,
    provider: marketEvidenceProvider,
    autoMarketEvidenceRequested,
  })
  const autoMicrostructureEvidenceRequested = parseBooleanLike(options.autoMicrostructureEvidence ?? options["auto-microstructure-evidence"], false)
  const autoMicrostructureEvidenceResult = autoMicrostructureEvidenceRequested
    ? await derivePaperTradeMicrostructureFromTushare({
      stockCode,
      entryDate,
      options,
    })
    : null
  const marketMicrostructureEvidence = autoMicrostructureEvidenceResult?.microstructureEvidence ?? null
  const microstructureEvidenceStatus = autoMicrostructureEvidenceResult?.status ?? (marketMicrostructureEvidence ? "provided" : "missing")
  const microstructureEvidenceWarning = autoMicrostructureEvidenceResult?.warning ?? null
  const microstructureEvidenceNativeQuery = autoMicrostructureEvidenceResult?.nativeQuery ?? null
  const autoEvidenceGate = buildPaperTradeAutoEvidenceGate({
    autoMarketEvidenceRequested,
    marketEvidenceProvider,
    autoMarketEvidenceResult,
    marketEvidenceWindow,
    autoMicrostructureEvidenceRequested,
    autoMicrostructureEvidenceResult,
  })
  const evidenceRefs = [
    ...compactList(options.evidenceRefs ?? options["evidence-refs"] ?? options.evidenceRef ?? options["evidence-ref"], 30, 260),
    ...paperTradeMarketEvidenceRefs(marketEvidence),
    ...paperTradeMicrostructureEvidenceRefs(marketMicrostructureEvidence),
  ].filter(Boolean)
  const paperTrade = {
    schema: STOCK_FEEDBACK_PAPER_TRADE_SCHEMA,
    id: `stockfb_paper_trade_${shortHash(`${track}:${stockCode}:${stockName}:${entryDate}:${exitDate}:${generatedAt}:${options.sourceQuestionId ?? options["source-question-id"] ?? ""}`)}`,
    generatedAt,
    asOfDate,
    ledgerKind: "paper_trade",
    track,
    status,
    sourceQuestionId: compactString(options.sourceQuestionId ?? options["source-question-id"], 180) || null,
    sourceTrajectoryId: compactString(options.sourceTrajectoryId ?? options["source-trajectory-id"], 180) || null,
    validationTarget,
    stock: {
      name: stockName,
      code: stockCode,
    },
    hypothesis: compactString(options.hypothesis ?? "", 500),
    expectedMove: compactString(options.expectedMove ?? options["expected-move"] ?? "", 300),
    entry: {
      date: entryDate,
      price: entryPrice,
      timing: entryTiming,
    },
    exit: status === "closed"
      ? {
        date: exitDate || null,
        price: exitPrice,
        timing: exitTiming,
        reason: exitReason,
      }
      : null,
    positionSizing,
    profitFeedback: cleanProfitFeedback,
    marketEvidence,
    marketEvidenceWindow,
    marketEvidenceProvider,
    marketEvidenceStatus,
    marketEvidenceWarning,
    marketMicrostructureEvidence,
    microstructureEvidenceStatus,
    microstructureEvidenceWarning,
    autoEvidenceGate,
    sourceRefs,
    evidenceRefs,
    evidenceCutoff: {
      asOfDate,
      noFutureData: true,
      note: "Paper trade decisions must use retrieval/tool-state evidence available as of this date.",
    },
    nextAction: "rebuild_trajectories_then_review_paper_trade",
    suggestedCommands: [
      "stock-feedback build-trajectories --write",
      "stock-feedback review-queue --include-reviewed",
      "stock-feedback bench --write",
      "stock-feedback export-lora-ready --quality-gate high_confidence --write",
      "stock-feedback verify",
    ],
    peftBoundary: {
      storesRawFacts: false,
      factsRemainIn: ["retrieval/tool state", "sourceRefs", "price SQL", "Tushare market microstructure", "paper trade ledger"],
      adapterStores: ["behavior", "skill", "tool_habit", "decision_strategy"],
      modelTrainingStarted: false,
    },
    writeBoundary: {
      projectPath,
      root: STOCK_FEEDBACK_ROOT,
      family: "paper-trades",
      wroteWiki: false,
      wroteRaw: false,
      wroteBrain: false,
      wroteRealTradeLedger: false,
    },
  }
  const manifest = {
    schema: "stock-feedback-paper-trade-manifest-v1",
    generatedAt,
    projectPath,
    count: 1,
    ledgerKind: "paper_trade",
    track,
    status,
    validationTarget,
    asOfDate,
    sourceQuestionId: paperTrade.sourceQuestionId,
    sourceTrajectoryId: paperTrade.sourceTrajectoryId,
    evidenceRefCount: evidenceRefs.length,
    sourceRefCount: sourceRefs.length,
    marketEvidence,
    marketEvidenceWindow,
    marketEvidenceProvider,
    marketEvidenceStatus,
    marketEvidenceWarning,
    marketEvidenceNativeQuery,
    marketMicrostructureEvidence,
    microstructureEvidenceStatus,
    microstructureEvidenceWarning,
    microstructureEvidenceNativeQuery,
    autoEvidenceGate,
    summary: summarizePaperTrades([paperTrade]),
    sources: ["self-question", "price SQL", "paper trade simulator"],
    paperTradeRefs: [{ id: paperTrade.id, track, status, validationTarget }],
    evidenceCutoff: paperTrade.evidenceCutoff,
    peftBoundary: paperTrade.peftBoundary,
    writeBoundary: {
      root: STOCK_FEEDBACK_ROOT,
      family: "paper-trades",
      wroteWiki: false,
      wroteRaw: false,
      wroteBrain: false,
      wroteRealTradeLedger: false,
    },
  }
  let writeResult = null
  if (options.write) {
    if (autoEvidenceGate.blocksWrite) {
      throw new Error(`Paper trade automatic evidence gate blocked write: ${autoEvidenceGate.detail}`)
    }
    writeResult = await writeJsonlWithManifest({
      projectPath,
      family: "paper-trades",
      baseName: "stock-feedback-paper-trades",
      records: [paperTrade],
      manifest,
      generatedAt,
    })
  }
  return {
    schema: "stock-feedback-paper-trade-result-v1",
    mode: "stock-feedback-paper-trade-record",
    dryRun: !Boolean(options.write),
    projectPath,
    generatedAt,
    paperTrade,
    marketEvidenceProvider,
    marketEvidenceStatus,
    marketEvidenceWarning,
    marketEvidenceNativeQuery,
    marketEvidenceWindow,
    microstructureEvidenceStatus,
    microstructureEvidenceWarning,
    microstructureEvidenceNativeQuery,
    autoEvidenceGate,
    count: 1,
    manifest,
    writeResult: writeResult ? { paperTrade: writeResult.jsonl, manifest: writeResult.manifest } : null,
    writePolicy: {
      wroteWiki: false,
      wroteRaw: false,
      wroteBrain: false,
      wroteRealTradeLedger: false,
      wroteArtifacts: Boolean(options.write),
      allowedRoot: STOCK_FEEDBACK_ROOT,
    },
  }
}

export async function settleStockFeedbackPaperTrade(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const generatedAt = options.generatedAt ?? nowLocalTimestamp()
  const paperTradeId = compactString(
    options.paperTradeId ?? options["paper-trade-id"] ?? options.id ?? options["trade-id"],
    180,
  )
  if (!paperTradeId) throw new Error("--paper-trade-id is required for paper trade settlement")
  const exitDate = compactString(options.exitDate ?? options["exit-date"], 32)
  const exitPrice = firstFiniteNumber(options.exitPrice, options["exit-price"])
  if (!exitDate) throw new Error("--exit-date is required for paper trade settlement")
  if (exitPrice === null) throw new Error("--exit-price is required for paper trade settlement")

  const currentTrades = await readStockFeedbackPaperTrades(projectPath)
  const current = currentTrades.find((trade) => trade.id === paperTradeId)
  if (!current) throw new Error(`Paper trade not found: ${paperTradeId}`)
  if (current.ledgerKind !== "paper_trade") {
    throw new Error("Paper trade settlement can only update ledgerKind=paper_trade")
  }
  if (current.status === "closed" && !parseBooleanLike(options.force ?? options["force"], false)) {
    throw new Error(`Paper trade is already closed: ${paperTradeId}`)
  }
  if (current.status === "cancelled" && !parseBooleanLike(options.force ?? options["force"], false)) {
    throw new Error(`Paper trade is cancelled: ${paperTradeId}`)
  }

  const entryPrice = firstFiniteNumber(current.entry?.price)
  if (entryPrice === null) throw new Error(`Paper trade is missing entry.price: ${paperTradeId}`)
  const sourceRefs = [
    ...compactStringArray(current.sourceRefs, 20, 260),
    ...compactList(options.sourceRefs ?? options["source-refs"] ?? options.sourceRef ?? options["source-ref"], 20, 260),
  ].filter(Boolean)
  const requestedEvidenceRefs = compactList(options.evidenceRefs ?? options["evidence-refs"] ?? options.evidenceRef ?? options["evidence-ref"], 30, 260)
  const evidenceRefs = [
    ...compactStringArray(current.evidenceRefs, 30, 260),
    ...requestedEvidenceRefs,
  ].filter(Boolean)
  const realizedPnlPct = firstFiniteNumber(
    options.realizedPnlPct,
    options["realized-pnl-pct"],
    options.pnlPct,
    options["pnl-pct"],
    computedRealizedPnlPct(entryPrice, exitPrice),
  )
  const maxDrawdownPct = firstFiniteNumber(
    options.maxDrawdownPct,
    options["max-drawdown-pct"],
    options.drawdownPct,
    options["drawdown-pct"],
    current.profitFeedback?.maxDrawdownPct,
  )
  const holdingDays = firstFiniteNumber(options.holdingDays, options["holding-days"], options.holdDays, options["hold-days"], current.profitFeedback?.holdingDays)
  const exitTiming = compactOptionalString(options.exitTiming ?? options["exit-timing"] ?? current.profitFeedback?.exitTiming, 140)
  const exitReason = compactOptionalString(options.exitReason ?? options["exit-reason"] ?? current.exit?.reason, 220)
  const positionSizing = compactOptionalString(options.positionSizing ?? options["position-sizing"] ?? current.positionSizing ?? current.profitFeedback?.positionSizing, 140)
  const entryTiming = compactOptionalString(options.entryTiming ?? options["entry-timing"] ?? current.entry?.timing ?? current.profitFeedback?.entryTiming, 140)
  const marketEvidenceProvider = normalizeMarketEvidenceProvider(
    options.marketEvidenceProvider ?? options["market-evidence-provider"] ?? current.marketEvidenceProvider,
  )
  const autoMarketEvidenceRequested = parseBooleanLike(options.autoMarketEvidence ?? options["auto-market-evidence"], false)
  const autoMicrostructureEvidenceRequested = parseBooleanLike(options.autoMicrostructureEvidence ?? options["auto-microstructure-evidence"], false)
  const preview = await recordStockFeedbackPaperTrade({
    ...options,
    projectPath,
    track: current.track,
    status: "closed",
    sourceQuestionId: current.sourceQuestionId,
    sourceTrajectoryId: current.sourceTrajectoryId,
    validationTarget: current.validationTarget,
    asOfDate: current.asOfDate ?? current.evidenceCutoff?.asOfDate ?? current.entry?.date,
    stockName: current.stock?.name,
    stockCode: current.stock?.code,
    hypothesis: current.hypothesis,
    expectedMove: current.expectedMove,
    entryDate: current.entry?.date,
    entryPrice,
    entryTiming,
    exitDate,
    exitPrice,
    exitTiming,
    exitReason,
    positionSizing,
    realizedPnlPct,
    maxDrawdownPct,
    holdingDays,
    sourceRefs,
    evidenceRefs,
    marketEvidenceProvider,
    autoMarketEvidence: autoMarketEvidenceRequested,
    autoMicrostructureEvidence: autoMicrostructureEvidenceRequested,
    write: false,
    generatedAt,
  })
  const built = preview.paperTrade
  const finalEvidenceRefs = [
    ...evidenceRefs,
    ...compactStringArray(built.evidenceRefs, 30, 260),
  ].filter(Boolean)
  const outcome = profitOutcomeFromPnl(realizedPnlPct, {})
  const profitFeedback = Object.fromEntries(Object.entries({
    ...(current.profitFeedback ?? {}),
    ...(built.profitFeedback ?? {}),
    executionMode: "paper",
    ledgerKind: "paper_trade",
    outcome,
    realizedPnlPct,
    maxDrawdownPct,
    holdingDays,
    entryTiming,
    exitTiming,
    positionSizing,
    executionEvidenceClass: paperTradeExecutionEvidenceClass({ outcome }),
  }).filter(([, value]) => value !== null && value !== undefined && value !== ""))
  const marketEvidence = built.marketEvidence ?? current.marketEvidence ?? null
  const marketMicrostructureEvidence = built.marketMicrostructureEvidence ?? current.marketMicrostructureEvidence ?? null
  const paperTrade = {
    ...current,
    ...built,
    id: current.id,
    generatedAt,
    firstRecordedAt: current.firstRecordedAt ?? current.generatedAt ?? null,
    ledgerEventCount: (current.ledgerEventCount ?? 1) + 1,
    previousGeneratedAt: current.generatedAt ?? null,
    previousArtifactPath: current.artifactPath ?? null,
    status: "closed",
    sourceRefs: [...new Set(sourceRefs)].slice(0, 30),
    evidenceRefs: [...new Set(finalEvidenceRefs)].slice(0, 40),
    marketEvidence,
    marketEvidenceWindow: marketEvidence ? (built.marketEvidenceWindow ?? current.marketEvidenceWindow ?? null) : (current.marketEvidenceWindow ?? built.marketEvidenceWindow ?? null),
    marketEvidenceProvider,
    marketEvidenceStatus: marketEvidence ? (preview.marketEvidenceStatus ?? current.marketEvidenceStatus ?? "provided") : (current.marketEvidenceStatus ?? preview.marketEvidenceStatus ?? "missing"),
    marketEvidenceWarning: preview.marketEvidenceWarning ?? current.marketEvidenceWarning ?? null,
    marketMicrostructureEvidence,
    microstructureEvidenceStatus: marketMicrostructureEvidence ? (preview.microstructureEvidenceStatus ?? current.microstructureEvidenceStatus ?? "provided") : (current.microstructureEvidenceStatus ?? preview.microstructureEvidenceStatus ?? "missing"),
    microstructureEvidenceWarning: preview.microstructureEvidenceWarning ?? current.microstructureEvidenceWarning ?? null,
    entry: {
      ...(current.entry ?? {}),
      date: current.entry?.date ?? built.entry?.date ?? null,
      price: entryPrice,
      timing: entryTiming,
    },
    exit: {
      date: exitDate,
      price: exitPrice,
      timing: exitTiming,
      reason: exitReason,
    },
    positionSizing,
    profitFeedback,
    settlement: {
      action: "close",
      previousStatus: current.status ?? null,
      previousGeneratedAt: current.generatedAt ?? null,
      previousArtifactPath: current.artifactPath ?? null,
      closedAt: generatedAt,
      exitDate,
      exitPrice,
      realizedPnlPct,
      outcome,
      reviewer: compactString(options.reviewer ?? "manual", 80) || "manual",
      evidenceRefsAdded: requestedEvidenceRefs,
    },
    nextAction: "rebuild_trajectories_then_review_paper_trade_settlement",
    suggestedCommands: [
      "stock-feedback build-trajectories --write",
      "stock-feedback review-queue --include-reviewed",
      "stock-feedback bench --write",
      "stock-feedback export-lora-ready --write",
      "stock-feedback verify",
    ],
    writeBoundary: {
      projectPath,
      root: STOCK_FEEDBACK_ROOT,
      family: "paper-trades",
      wroteWiki: false,
      wroteRaw: false,
      wroteBrain: false,
      wroteRealTradeLedger: false,
    },
  }
  const autoEvidenceGate = built.autoEvidenceGate ?? current.autoEvidenceGate ?? null
  if (options.write && autoEvidenceGate?.blocksWrite === true) {
    throw new Error(`Paper trade settlement automatic evidence gate blocked write: ${autoEvidenceGate.detail}`)
  }
  const artifactRefreshPlan = buildPaperTradeSettlementArtifactRefreshPlan(paperTrade, { write: options.write })
  const manifest = {
    schema: "stock-feedback-paper-trade-settlement-manifest-v1",
    generatedAt,
    projectPath,
    count: 1,
    ledgerKind: "paper_trade",
    track: paperTrade.track,
    status: paperTrade.status,
    validationTarget: paperTrade.validationTarget,
    asOfDate: paperTrade.asOfDate,
    paperTradeId: paperTrade.id,
    previousGeneratedAt: current.generatedAt ?? null,
    previousArtifactPath: current.artifactPath ?? null,
    evidenceRefCount: paperTrade.evidenceRefs.length,
    sourceRefCount: paperTrade.sourceRefs.length,
    settlement: paperTrade.settlement,
    marketEvidence,
    marketEvidenceWindow: paperTrade.marketEvidenceWindow,
    marketEvidenceProvider,
    marketEvidenceStatus: paperTrade.marketEvidenceStatus,
    marketEvidenceWarning: paperTrade.marketEvidenceWarning,
    marketMicrostructureEvidence,
    microstructureEvidenceStatus: paperTrade.microstructureEvidenceStatus,
    microstructureEvidenceWarning: paperTrade.microstructureEvidenceWarning,
    autoEvidenceGate,
    artifactRefreshPlan,
    summary: summarizePaperTrades([paperTrade]),
    sources: ["stock-feedback-paper-trade-v1", "price SQL or Tushare settlement evidence"],
    paperTradeRefs: [{ id: paperTrade.id, track: paperTrade.track, status: paperTrade.status, validationTarget: paperTrade.validationTarget }],
    peftBoundary: paperTrade.peftBoundary,
    writeBoundary: {
      root: STOCK_FEEDBACK_ROOT,
      family: "paper-trades",
      wroteWiki: false,
      wroteRaw: false,
      wroteBrain: false,
      wroteRealTradeLedger: false,
    },
  }
  let writeResult = null
  if (options.write) {
    writeResult = await writeJsonlWithManifest({
      projectPath,
      family: "paper-trades",
      baseName: "stock-feedback-paper-trades",
      records: [paperTrade],
      manifest,
      generatedAt,
    })
  }
  return {
    schema: "stock-feedback-paper-trade-settlement-result-v1",
    mode: "stock-feedback-paper-trade-settle",
    dryRun: !Boolean(options.write),
    projectPath,
    generatedAt,
    paperTrade,
    previousPaperTrade: compactPaperTrade(current),
    marketEvidenceProvider,
    marketEvidenceStatus: paperTrade.marketEvidenceStatus,
    marketEvidenceWarning: paperTrade.marketEvidenceWarning,
    marketEvidenceNativeQuery: preview.marketEvidenceNativeQuery ?? null,
    marketEvidenceWindow: paperTrade.marketEvidenceWindow,
    microstructureEvidenceStatus: paperTrade.microstructureEvidenceStatus,
    microstructureEvidenceWarning: paperTrade.microstructureEvidenceWarning,
    microstructureEvidenceNativeQuery: preview.microstructureEvidenceNativeQuery ?? null,
    autoEvidenceGate,
    artifactRefreshPlan,
    count: 1,
    manifest,
    writeResult: writeResult ? { paperTrade: writeResult.jsonl, manifest: writeResult.manifest } : null,
    writePolicy: {
      wroteWiki: false,
      wroteRaw: false,
      wroteBrain: false,
      wroteRealTradeLedger: false,
      wroteArtifacts: Boolean(options.write),
      allowedRoot: STOCK_FEEDBACK_ROOT,
    },
  }
}

export async function planStockFeedbackCollectionTask(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const generatedAt = options.generatedAt ?? nowLocalTimestamp()
  const requestedPattern = parseStockFeedbackMarketPattern(options.marketPattern ?? options["market-pattern"] ?? options.pattern)
  const requestedProfitCredit = parseStockFeedbackProfitCredit(options.profitCredit ?? options["profit-credit"] ?? options.credit)
  const status = await getStockFeedbackStatus({ projectPath })
  if (requestedProfitCredit) {
    const credit = STOCK_FEEDBACK_PROFIT_CREDIT_BUCKETS.find((item) => item.id === requestedProfitCredit)
    const collectionTask = collectionTaskForProfitCredit(credit, status.summary ?? {})
    const draft = collectionTaskDraftFromTask(collectionTask, { projectPath, generatedAt })
    const manifest = {
      schema: "stock-feedback-collection-task-manifest-v1",
      generatedAt,
      projectPath,
      count: 1,
      taskId: collectionTask.taskId ?? null,
      targetPatternId: draft.targetPatternId,
      targetProfitCredit: draft.targetProfitCredit,
      validationTarget: draft.validationTarget,
      adapterCapability: draft.adapterCapability,
      sources: ["stock-feedback-dynamic-test-set-v1", "stock-feedback-profit-credit-assignment-v1"],
      draftRefs: [{ id: draft.id, taskId: draft.taskId, targetProfitCredit: draft.targetProfitCredit }],
      peftBoundary: draft.peftBoundary,
      writeBoundary: {
        root: STOCK_FEEDBACK_ROOT,
        family: "collection-tasks",
        wroteWiki: false,
        wroteRaw: false,
        wroteBrain: false,
      },
    }
    let writeResult = null
    if (options.write) {
      writeResult = await writeJsonlWithManifest({
        projectPath,
        family: "collection-tasks",
        baseName: "stock-feedback-collection-tasks",
        records: [draft],
        manifest,
        generatedAt,
      })
    }
    return {
      schema: "stock-feedback-collection-task-result-v1",
      mode: "stock-feedback-collection-task",
      dryRun: !Boolean(options.write),
      projectPath,
      generatedAt,
      collectionTask,
      draft,
      count: 1,
      manifest,
      writeResult: writeResult ? { draft: writeResult.jsonl, manifest: writeResult.manifest } : null,
      writePolicy: {
        wroteWiki: false,
        wroteRaw: false,
        wroteBrain: false,
        wroteArtifacts: Boolean(options.write),
        allowedRoot: STOCK_FEEDBACK_ROOT,
      },
    }
  }
  const items = status.patternRadar?.items ?? []
  const selectedItem = requestedPattern
    ? items.find((item) => item.id === requestedPattern)
    : items.find((item) => item.collectionTask)
  if (!selectedItem) {
    throw new Error(requestedPattern ? `Unknown stock-feedback market pattern: ${requestedPattern}` : "No stock-feedback collection task is available")
  }
  const collectionTask = selectedItem.collectionTask ?? null
  if (!collectionTask) {
    throw new Error(`No collection task is needed for market pattern: ${selectedItem.id}`)
  }
  const draft = collectionTaskDraftFromTask(collectionTask, { projectPath, generatedAt })
  const manifest = {
    schema: "stock-feedback-collection-task-manifest-v1",
    generatedAt,
    projectPath,
    count: 1,
    taskId: collectionTask.taskId ?? null,
    targetPatternId: draft.targetPatternId,
    validationTarget: draft.validationTarget,
    adapterCapability: draft.adapterCapability,
    sources: ["stock-feedback-pattern-radar-v1", "stock-feedback-collection-task-v1"],
    draftRefs: [{ id: draft.id, taskId: draft.taskId, targetPatternId: draft.targetPatternId }],
    peftBoundary: draft.peftBoundary,
    writeBoundary: {
      root: STOCK_FEEDBACK_ROOT,
      family: "collection-tasks",
      wroteWiki: false,
      wroteRaw: false,
      wroteBrain: false,
    },
  }
  let writeResult = null
  if (options.write) {
    writeResult = await writeJsonlWithManifest({
      projectPath,
      family: "collection-tasks",
      baseName: "stock-feedback-collection-tasks",
      records: [draft],
      manifest,
      generatedAt,
    })
  }
  return {
    schema: "stock-feedback-collection-task-result-v1",
    mode: "stock-feedback-collection-task",
    dryRun: !Boolean(options.write),
    projectPath,
    generatedAt,
    collectionTask,
    draft,
    count: 1,
    manifest,
    writeResult: writeResult ? { draft: writeResult.jsonl, manifest: writeResult.manifest } : null,
    writePolicy: {
      wroteWiki: false,
      wroteRaw: false,
      wroteBrain: false,
      wroteArtifacts: Boolean(options.write),
      allowedRoot: STOCK_FEEDBACK_ROOT,
    },
  }
}

function collectionResultNextAction(result) {
  if (result === "confirmed") return "rebuild_trajectories_then_review"
  if (result === "refuted") return "keep_as_negative_eval_or_close_gap"
  return "keep_collection_task_open"
}

async function resolveCollectionResultContext(projectPath, options = {}, generatedAt) {
  const drafts = await readStockFeedbackCollectionTaskDrafts(projectPath)
  const draftId = compactString(options.draftId ?? options["draft-id"], 180)
  const taskId = compactString(options.taskId ?? options["task-id"], 180)
  const requestedPattern = parseStockFeedbackMarketPattern(options.marketPattern ?? options["market-pattern"] ?? options.pattern)
  const requestedProfitCredit = parseStockFeedbackProfitCredit(options.profitCredit ?? options["profit-credit"] ?? options.credit)
  const matchingDraft = drafts
    .slice()
    .reverse()
    .find((draft) => (
      (draftId && draft.id === draftId) ||
      (taskId && draft.taskId === taskId) ||
      (requestedPattern && draft.targetPatternId === requestedPattern) ||
      (requestedProfitCredit && draft.targetProfitCredit === requestedProfitCredit)
    ))
  if (matchingDraft) return { draft: matchingDraft, collectionTask: null }

  const status = await getStockFeedbackStatus({ projectPath })
  if (requestedProfitCredit) {
    const credit = STOCK_FEEDBACK_PROFIT_CREDIT_BUCKETS.find((item) => item.id === requestedProfitCredit)
    return {
      draft: collectionTaskDraftFromTask(collectionTaskForProfitCredit(credit, status.summary ?? {}), { projectPath, generatedAt }),
      collectionTask: null,
    }
  }
  const item = requestedPattern
    ? status.patternRadar?.items?.find((pattern) => pattern.id === requestedPattern)
    : status.patternRadar?.items?.find((pattern) => pattern.collectionTask)
  const collectionTask = item?.collectionTask ?? null
  if (!collectionTask) {
    throw new Error(draftId || taskId || requestedPattern
      ? "Stock-feedback collection task context not found"
      : "No stock-feedback collection task context is available")
  }
  return {
    draft: collectionTaskDraftFromTask(collectionTask, { projectPath, generatedAt }),
    collectionTask,
  }
}

export async function recordStockFeedbackCollectionResult(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const generatedAt = options.generatedAt ?? nowLocalTimestamp()
  const result = parseStockFeedbackCollectionResult(options.result ?? options.status ?? "insufficient")
  const evidenceRefs = compactList(options.evidenceRefs ?? options["evidence-refs"] ?? options.evidenceRef ?? options["evidence-ref"], 30, 260)
  if (result === "confirmed" && evidenceRefs.length === 0) {
    throw new Error("confirmed collection result requires --evidence-refs")
  }
  const { draft, collectionTask } = await resolveCollectionResultContext(projectPath, options, generatedAt)
  const summary = compactString(options.summary ?? options.note ?? "", 700)
  const collectionResult = {
    schema: STOCK_FEEDBACK_COLLECTION_RESULT_SCHEMA,
    id: `stockfb_collection_result_${shortHash(`${draft.id}:${result}:${generatedAt}:${summary}`)}`,
    generatedAt,
    sourceDraftId: draft.id ?? null,
    sourceTaskId: draft.taskId ?? collectionTask?.taskId ?? null,
    targetPatternId: draft.targetPatternId ?? collectionTask?.targetPatternId ?? null,
    targetPatternLabel: draft.targetPatternLabel ?? collectionTask?.targetPatternLabel ?? null,
    targetProfitCredit: draft.targetProfitCredit ?? collectionTask?.targetProfitCredit ?? null,
    targetProfitCreditLabel: draft.targetProfitCreditLabel ?? collectionTask?.targetProfitCreditLabel ?? null,
    validationTarget: draft.validationTarget ?? collectionTask?.validationTarget ?? null,
    adapterCapability: draft.adapterCapability ?? collectionTask?.adapterCapability ?? null,
    result,
    resultLabel: {
      confirmed: "证据已确认",
      refuted: "证据反驳",
      insufficient: "证据不足",
    }[result],
    evidenceRefs,
    intakeSummary: summary,
    reviewer: compactString(options.reviewer ?? "manual", 80) || "manual",
    stock: {
      name: compactString(options.stockName ?? options["stock-name"], 80) || null,
      code: compactString(options.stockCode ?? options["stock-code"], 32) || null,
    },
    hypothesis: compactString(options.hypothesis ?? "", 500),
    nextAction: collectionResultNextAction(result),
    suggestedCommands: result === "confirmed"
      ? [
        "stock-feedback build-trajectories --write",
        "stock-feedback review-queue --include-reviewed",
        "stock-feedback export-lora-ready --quality-gate high_confidence --write",
      ]
      : [
        draft.targetProfitCredit
          ? `stock-feedback collection-task --profit-credit ${draft.targetProfitCredit}`
          : `stock-feedback collection-task --market-pattern ${draft.targetPatternId ?? collectionTask?.targetPatternId}`,
        "stock-feedback verify",
      ].filter((item) => !item.includes("undefined") && !item.includes("null")),
    peftBoundary: draft.peftBoundary ?? collectionTask?.peftBoundary ?? {
      storesRawFacts: false,
      factsRemainIn: ["retrieval/tool state", "sourceRefs", "price SQL", "wiki/raw/facts"],
      adapterStores: ["behavior", "skill", "tool_habit", "decision_strategy"],
    },
    writeBoundary: {
      projectPath,
      root: STOCK_FEEDBACK_ROOT,
      family: "collection-results",
      wroteWiki: false,
      wroteRaw: false,
      wroteBrain: false,
    },
  }
  const manifest = {
    schema: "stock-feedback-collection-result-manifest-v1",
    generatedAt,
    projectPath,
    count: 1,
    result,
    sourceDraftId: collectionResult.sourceDraftId,
    sourceTaskId: collectionResult.sourceTaskId,
    targetPatternId: collectionResult.targetPatternId,
    targetProfitCredit: collectionResult.targetProfitCredit,
    validationTarget: collectionResult.validationTarget,
    evidenceRefCount: evidenceRefs.length,
    sources: ["stock-feedback-collection-task-draft-v1", "retrieval/tool state refs"],
    resultRefs: [{ id: collectionResult.id, result, sourceDraftId: collectionResult.sourceDraftId }],
    peftBoundary: collectionResult.peftBoundary,
    writeBoundary: {
      root: STOCK_FEEDBACK_ROOT,
      family: "collection-results",
      wroteWiki: false,
      wroteRaw: false,
      wroteBrain: false,
    },
  }
  let writeResult = null
  if (options.write) {
    writeResult = await writeJsonlWithManifest({
      projectPath,
      family: "collection-results",
      baseName: "stock-feedback-collection-results",
      records: [collectionResult],
      manifest,
      generatedAt,
    })
  }
  return {
    schema: "stock-feedback-collection-result-result-v1",
    mode: "stock-feedback-collection-result",
    dryRun: !Boolean(options.write),
    projectPath,
    generatedAt,
    collectionResult,
    count: 1,
    manifest,
    writeResult: writeResult ? { collectionResult: writeResult.jsonl, manifest: writeResult.manifest } : null,
    writePolicy: {
      wroteWiki: false,
      wroteRaw: false,
      wroteBrain: false,
      wroteArtifacts: Boolean(options.write),
      allowedRoot: STOCK_FEEDBACK_ROOT,
    },
  }
}

export async function reviewStockFeedbackTrajectory(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const trajectoryId = compactString(options.trajectoryId ?? options.id ?? options["trajectory-id"], 160)
  if (!trajectoryId) throw new Error("--trajectory-id is required")
  const action = parseStockFeedbackReviewAction(options.action ?? options.review ?? options.result ?? "route_to_eval")
  const generatedAt = options.generatedAt ?? nowLocalTimestamp()
  const listed = await listStockFeedbackTrajectories({ projectPath, limit: options.limit ?? 1000 })
  const trajectory = listed.trajectories.find((item) => item.id === trajectoryId)
  if (!trajectory) throw new Error(`Stock feedback trajectory not found: ${trajectoryId}`)
  const reviewEvent = buildReviewEvent({
    trajectory,
    action,
    reviewer: options.reviewer,
    note: options.note,
    generatedAt,
  })
  let writeResult = null
  if (options.write) {
    writeResult = await writeJsonlWithManifest({
      projectPath,
      family: "reviews",
      baseName: "stock-feedback-reviews",
      records: [reviewEvent],
      manifest: {
        schema: "stock-feedback-review-manifest-v1",
        generatedAt,
        projectPath,
        count: 1,
        sources: ["stock-feedback-trajectory-v1"],
        reviewEventIds: [reviewEvent.id],
        writeBoundary: {
          root: STOCK_FEEDBACK_ROOT,
          wroteWiki: false,
          wroteRaw: false,
          wroteBrain: false,
        },
      },
      generatedAt,
    })
  }
  return {
    schema: "stock-feedback-review-result-v1",
    mode: "stock-feedback-review",
    dryRun: !Boolean(options.write),
    projectPath,
    generatedAt,
    reviewEvent,
    trajectory: {
      id: trajectory.id,
      validationTarget: trajectory.validationTarget,
      qualityGateStatus: trajectory.qualityGate?.status ?? "review_required",
      adapterCapability: trajectory.adapterCapability,
    },
    writeResult: writeResult ? { review: writeResult.jsonl, manifest: writeResult.manifest } : null,
    writePolicy: {
      wroteWiki: false,
      wroteRaw: false,
      wroteBrain: false,
      wroteArtifacts: Boolean(options.write),
      allowedRoot: STOCK_FEEDBACK_ROOT,
    },
  }
}

export async function buildStockFeedbackBenchmark(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const generatedAt = options.generatedAt ?? nowLocalTimestamp()
  const listed = await listStockFeedbackTrajectories({ projectPath, limit: options.limit ?? 200 })
  const trajectories = listed.trajectories
  const paperTradeAgentCandidates = await readStockFeedbackPaperTradeAgentCandidates(projectPath)
  const paperTrades = await readStockFeedbackPaperTrades(projectPath)
  const reviewEvents = await readStockFeedbackReviewEvents(projectPath)
  const latestReviews = latestReviewByTrajectory(reviewEvents)
  const trajectorySummary = summarizeTrajectories(trajectories)
  const patternCounts = trajectorySummary.byMarketPattern ?? {}
  const trajectoryCases = trajectories.map((trajectory) => {
    const marketPatternIds = (trajectory.marketPatterns ?? []).map((pattern) => pattern.id).filter(Boolean)
    const reviewSignal = reviewSignalForTrajectory(trajectory, latestReviews.get(trajectory.id) ?? null)
    const dynamicPriority = dynamicBenchmarkPriority(trajectory, reviewSignal, patternCounts)
    const sourceAudit = sourceAuditForTrajectory(trajectory)
    return {
      schema: STOCK_VALIDATION_BENCHMARK_SCHEMA,
      id: `stockfb_case_${shortHash(`${trajectory.id}:${trajectory.validationTarget}`)}`,
      generatedAt,
      sourceKind: sourceAudit.sourceKind,
      sourceKindLabel: sourceAudit.sourceKindLabel,
      collectionResultId: sourceAudit.collectionResultId,
      paperTradeId: sourceAudit.paperTradeId,
      executionResultId: sourceAudit.executionResultId,
      sourceTrajectoryId: trajectory.id,
      validationTarget: trajectory.validationTarget,
      qualityGateStatus: trajectory.qualityGate?.status ?? "review_required",
      adapterCapability: trajectory.adapterCapability,
      marketPatternIds,
      profitFeedback: trajectory.profitFeedback ?? null,
      distillationSignals: trajectory.distillationSignals ?? null,
      collectionState: sourceAudit.collectionState,
      paperTradeState: sourceAudit.paperTradeState,
      executionResultState: sourceAudit.executionResultState,
      sourceAudit,
      reviewSignal,
      dynamicPriority,
      question: [
        `判断这条股票研究轨迹是否完成${TARGET_TO_LABEL[trajectory.validationTarget] ?? trajectory.validationTarget}。`,
        `来源：${sourceAudit.sourceKindLabel}`,
        `假设：${trajectory.hypothesis}`,
        `市场验证：${trajectory.marketValidation?.verdict ?? ""}`,
        marketPatternIds.length ? `手法模式：${marketPatternIds.join(", ")}` : "",
        sourceAudit.collectionState?.result ? `补样本结果：${sourceAudit.collectionState.result}` : "",
        trajectory.profitFeedback?.outcome ? `收益反馈：${trajectory.profitFeedback.outcome}` : "",
        reviewSignal.reviewed ? `人工分流：${reviewSignal.latestAction ?? ""}` : "",
        `补证状态：${trajectory.evidenceState?.evidenceGaps?.join(", ") ?? ""}`,
      ].filter(Boolean).join("\n"),
      expected: {
        validationTarget: trajectory.validationTarget,
        qualityGateStatus: trajectory.qualityGate?.status ?? "review_required",
        highConfidenceEligible: trajectory.qualityGate?.highConfidenceEligible === true,
        routeTo: trajectory.trainingUse ?? [],
        marketPatternIds,
        profitOutcome: trajectory.profitFeedback?.outcome ?? "unknown",
        profitCredit: trajectory.profitFeedback?.creditAssignment ?? null,
        distillInto: trajectory.distillationSignals?.distillInto ?? [],
        reviewAction: reviewSignal.latestAction,
        dynamicBucket: dynamicPriority.bucket,
        sourceKind: sourceAudit.sourceKind,
        collectionResult: sourceAudit.collectionState?.result ?? null,
        paperTrade: sourceAudit.paperTradeState?.status ?? null,
        paperTradeLedgerKind: sourceAudit.paperTradeState?.ledgerKind ?? null,
        executionResult: sourceAudit.executionResultState?.recordStatus ?? null,
        executionResultLedgerKind: sourceAudit.executionResultState?.ledgerKind ?? null,
        executionResultPnlScope: sourceAudit.executionResultState?.pnlScope ?? null,
        targetPatternId: sourceAudit.collectionState?.targetPatternId ?? null,
      },
      sourceRefs: trajectory.sourceRefs ?? [],
    }
  })
  const paperTradeAgentCases = paperTradeAgentCandidates.map((candidate) => ({
    schema: STOCK_VALIDATION_BENCHMARK_SCHEMA,
    id: `stockfb_case_${shortHash(`${candidate.id}:paper_trade_agent`)}`,
    generatedAt,
    sourceKind: "paper_trade_agent_candidate",
    sourceKindLabel: "Paper Trade Agent 候选",
    collectionResultId: null,
    paperTradeId: null,
    paperTradeAgentCandidateId: candidate.id,
    sourceTrajectoryId: candidate.sourceTrajectoryId ?? null,
    hypothesisId: candidate.hypothesisId ?? null,
    validationTarget: candidate.validationTarget ?? "expectation_trade",
    qualityGateStatus: candidate.readiness?.status === "blocked" ? "needs_evidence" : "review_required",
    adapterCapability: "paper_trade_agent_planning",
    marketPatternIds: [],
    profitFeedback: null,
    distillationSignals: null,
    sourceAudit: {
      sourceKind: "paper_trade_agent_candidate",
      sourceKindLabel: "Paper Trade Agent 候选",
      paperTradeAgentCandidateId: candidate.id,
      paperTradeTrack: candidate.track,
      ledgerKind: candidate.ledgerKind,
      asOfDate: candidate.asOfDate,
      evidenceCutoff: candidate.evidenceCutoff,
    },
    reviewSignal: {
      reviewed: false,
      latestAction: null,
      requiredAction: "record_or_reject_paper_trade_candidate",
    },
    dynamicPriority: {
      bucket: "paper_trade_agent_case",
      score: candidate.track === "llm_discretionary" ? 72 : 68,
      reasons: ["paper_trade_agent_candidate", candidate.readiness?.status ?? "unknown"],
    },
    question: [
      "判断这条 Paper Trade Agent 候选是否能进入模拟交易记录。",
      `来源：${candidate.sourceKind}`,
      `轨道：${candidate.track}`,
      `asOfDate：${candidate.asOfDate ?? ""}`,
      `假设：${candidate.hypothesis ?? ""}`,
      `入场计划：${candidate.entryPlan?.reason ?? ""}`,
      `退出计划：${candidate.exitPlan?.rule ?? ""}`,
      `缺口：${candidate.readiness?.missingRequiredFields?.join(", ") ?? ""}`,
    ].filter(Boolean).join("\n"),
    expected: {
      validationTarget: candidate.validationTarget ?? "expectation_trade",
      qualityGateStatus: candidate.readiness?.status === "blocked" ? "needs_evidence" : "review_required",
      highConfidenceEligible: false,
      routeTo: ["eval", "paper_trade_agent"],
      profitOutcome: "pending_settlement",
      profitCredit: null,
      sourceKind: "paper_trade_agent_candidate",
      paperTradeAgentTrack: candidate.track,
      paperTradeAgentReadiness: candidate.readiness?.status ?? null,
      evidenceCutoff: candidate.evidenceCutoff ?? null,
      expectedCatalyst: candidate.expectedCatalyst ?? null,
    },
    sourceRefs: candidate.sourceRefs ?? [],
  }))
  const paperTradeById = new Map(paperTrades.map((trade) => [trade.id, trade]))
  const discretionaryReviewAudit = buildPaperTradeDiscretionaryReviewAudit({
    paperTrades,
    paperTradeAgentCandidates,
  })
  const discretionaryReviewCases = (discretionaryReviewAudit.items ?? [])
    .filter((item) => item.readyForReview)
    .map((item) => {
      const llmTrade = paperTradeById.get(item.paperTradeId)
      const baselineTrade = paperTradeById.get(item.pairedRuleBaselineTradeId)
      return {
        schema: STOCK_VALIDATION_BENCHMARK_SCHEMA,
        id: `stockfb_case_${shortHash(`${item.paperTradeId}:${item.pairedRuleBaselineTradeId}:discretionary_review`)}`,
        generatedAt,
        sourceKind: "paper_trade_discretionary_review",
        sourceKindLabel: "LLM discretionary 复盘",
        collectionResultId: null,
        paperTradeId: item.paperTradeId ?? null,
        pairedRuleBaselineTradeId: item.pairedRuleBaselineTradeId ?? null,
        sourceTrajectoryId: llmTrade?.sourceTrajectoryId ?? baselineTrade?.sourceTrajectoryId ?? null,
        validationTarget: llmTrade?.validationTarget ?? baselineTrade?.validationTarget ?? "expectation_trade",
        qualityGateStatus: "review_required",
        adapterCapability: "paper_trade_discretionary_review",
        marketPatternIds: [],
        profitFeedback: llmTrade?.profitFeedback ?? null,
        distillationSignals: null,
        sourceAudit: {
          sourceKind: "paper_trade_discretionary_review",
          sourceKindLabel: "LLM discretionary 复盘",
          llmPaperTradeId: item.paperTradeId ?? null,
          pairedRuleBaselineTradeId: item.pairedRuleBaselineTradeId ?? null,
          asOfDate: item.asOfDate ?? null,
          evidenceCutoff: llmTrade?.evidenceCutoff ?? null,
          llmOutcome: llmTrade?.profitFeedback?.outcome ?? null,
          baselineOutcome: baselineTrade?.profitFeedback?.outcome ?? null,
          llmRealizedPnlPct: llmTrade?.profitFeedback?.realizedPnlPct ?? null,
          baselineRealizedPnlPct: baselineTrade?.profitFeedback?.realizedPnlPct ?? null,
        },
        reviewSignal: {
          reviewed: false,
          latestAction: null,
          requiredAction: "compare_llm_discretionary_against_rule_baseline",
        },
        dynamicPriority: {
          bucket: "paper_trade_discretionary_review",
          score: 78,
          reasons: ["llm_discretionary_ready_pair", "eval_preference_only", "paper_trade_not_real_profit"],
        },
        question: [
          "比较这组 LLM discretionary 与 rule_baseline 模拟交易，判断 LLM 决策应进入正向偏好、负样本还是仅保留 eval。",
          `股票：${item.stock?.name ?? item.stock?.code ?? ""}`,
          `asOfDate：${item.asOfDate ?? ""}`,
          `LLM 结果：${llmTrade?.profitFeedback?.outcome ?? "unknown"} / ${llmTrade?.profitFeedback?.realizedPnlPct ?? "?"}%`,
          `规则基准：${baselineTrade?.profitFeedback?.outcome ?? "unknown"} / ${baselineTrade?.profitFeedback?.realizedPnlPct ?? "?"}%`,
          "边界：paper trade 不能作为真实收益提权，必须保留 as-of 证据引用。",
        ].filter(Boolean).join("\n"),
        expected: {
          validationTarget: llmTrade?.validationTarget ?? baselineTrade?.validationTarget ?? "expectation_trade",
          qualityGateStatus: "review_required",
          highConfidenceEligible: false,
          routeTo: ["eval", "preference", "paper_trade_discretionary_review"],
          profitOutcome: llmTrade?.profitFeedback?.outcome ?? "unknown",
          profitCredit: llmTrade?.profitFeedback?.creditAssignment ?? null,
          sourceKind: "paper_trade_discretionary_review",
          paperTrade: llmTrade?.status ?? null,
          pairedRuleBaselineStatus: item.pairedRuleBaselineStatus ?? null,
          llmOutcome: llmTrade?.profitFeedback?.outcome ?? null,
          baselineOutcome: baselineTrade?.profitFeedback?.outcome ?? null,
          llmRealizedPnlPct: llmTrade?.profitFeedback?.realizedPnlPct ?? null,
          baselineRealizedPnlPct: baselineTrade?.profitFeedback?.realizedPnlPct ?? null,
          evidenceCutoff: llmTrade?.evidenceCutoff ?? null,
        },
        sourceRefs: compactStringArray([
          ...(llmTrade?.sourceRefs ?? []),
          ...(baselineTrade?.sourceRefs ?? []),
          item.paperTradeId ? `paper-trade:${item.paperTradeId}` : "",
          item.pairedRuleBaselineTradeId ? `paper-trade:${item.pairedRuleBaselineTradeId}` : "",
        ], 12, 260),
      }
    })
  const cases = [...trajectoryCases, ...paperTradeAgentCases, ...discretionaryReviewCases].sort((a, b) => (
    (b.dynamicPriority?.score ?? 0) - (a.dynamicPriority?.score ?? 0) ||
    String(a.validationTarget ?? "").localeCompare(String(b.validationTarget ?? "")) ||
    a.id.localeCompare(b.id)
  ))
  const summary = trajectorySummary
  const dynamicTestSet = buildDynamicBenchmarkSummary(cases, trajectories, summary)
  const patternRadar = buildPatternRadar(trajectories, latestReviews)
  const coverage = {
    byValidationTarget: Object.fromEntries(STOCK_FEEDBACK_VALIDATION_TARGETS.map((target) => [
      target,
      cases.filter((item) => item.validationTarget === target).length,
    ])),
    byQualityGate: summary.byQualityGate,
    byMarketPattern: summary.byMarketPattern,
    byProfitOutcome: summary.byProfitOutcome,
    byProfitCredit: summary.byProfitCredit,
  }
  const manifest = {
    schema: "stock-validation-benchmark-manifest-v1",
    generatedAt,
    projectPath,
    count: cases.length,
    coverage,
    sourceKindCounts: cases.reduce((counts, item) => {
      const sourceKind = item.sourceKind ?? "unknown"
      counts[sourceKind] = (counts[sourceKind] ?? 0) + 1
      return counts
    }, {}),
    dynamicTestSet,
    patternRadar,
    sources: ["stock-feedback-trajectory-v1", "research-os-execution-result-v1", "stock-feedback-paper-trade-agent-candidate-v1", "stock-feedback-paper-trade-v1"],
    paperTradeAgentCandidateCount: paperTradeAgentCandidates.length,
    discretionaryReviewCaseCount: discretionaryReviewCases.length,
    caseRefs: cases.map((item) => ({
      id: item.id,
      sourceTrajectoryId: item.sourceTrajectoryId,
      paperTradeAgentCandidateId: item.paperTradeAgentCandidateId ?? null,
      pairedRuleBaselineTradeId: item.pairedRuleBaselineTradeId ?? null,
      validationTarget: item.validationTarget,
      qualityGateStatus: item.qualityGateStatus,
      sourceKind: item.sourceKind ?? "unknown",
      collectionResultId: item.collectionResultId ?? null,
      paperTradeId: item.paperTradeId ?? null,
      executionResultId: item.executionResultId ?? null,
      collectionResult: item.collectionState?.result ?? null,
      paperTrade: item.paperTradeState?.status ?? null,
      paperTradeLedgerKind: item.paperTradeState?.ledgerKind ?? null,
      executionResult: item.executionResultState?.recordStatus ?? null,
      executionResultLedgerKind: item.executionResultState?.ledgerKind ?? null,
      executionResultPnlScope: item.executionResultState?.pnlScope ?? null,
      targetPatternId: item.collectionState?.targetPatternId ?? null,
      dynamicBucket: item.dynamicPriority?.bucket ?? null,
      profitCredit: item.expected?.profitCredit?.primaryCredit ?? null,
    })),
  }
  let writeResult = null
  if (options.write) {
    writeResult = await writeJsonlWithManifest({
      projectPath,
      family: "benchmark",
      baseName: "stock-validation-benchmark",
      records: cases,
      manifest,
      generatedAt,
    })
  }
  return {
    schema: "stock-feedback-benchmark-result-v1",
    mode: "stock-feedback-bench",
    dryRun: !Boolean(options.write),
    projectPath,
    generatedAt,
    cases,
    count: cases.length,
    coverage,
    dynamicTestSet,
    patternRadar,
    manifest,
    writeResult: writeResult ? { benchmark: writeResult.jsonl, manifest: writeResult.manifest } : null,
  }
}

function compactQualityGateCheckResults(checkResults = null) {
  if (!checkResults || typeof checkResults !== "object") return null
  const entries = Object.entries(checkResults)
    .filter(([, value]) => typeof value === "boolean")
    .sort(([a], [b]) => a.localeCompare(b))
  if (entries.length === 0) return null
  return Object.fromEntries(entries)
}

function qualityGateCheckResultSummary(checkResults = null) {
  if (!checkResults || typeof checkResults !== "object") return []
  return Object.entries(checkResults).map(([key, value]) => `${key}=${value === true ? "passed" : "pending"}`)
}

export function sampleFromStockFeedbackTrajectory(trajectory, kind) {
  if (!trajectory || trajectory.schema !== STOCK_FEEDBACK_TRAJECTORY_SCHEMA) return null
  const gate = trajectory.qualityGate?.status ?? "review_required"
  const qualityGateCheckResults = compactQualityGateCheckResults(trajectory.qualityGate?.checkResults)
  const qualityGateCheckSummary = qualityGateCheckResultSummary(qualityGateCheckResults)
  const base = {
    source: "stock-feedback-trajectory",
    sourceRecordId: trajectory.id,
    validationTarget: trajectory.validationTarget,
    adapterCapability: trajectory.adapterCapability,
    trainingUse: trajectory.trainingUse ?? [],
    qualityGate: {
      status: gate,
      validationTarget: trajectory.validationTarget,
      highConfidenceEligible: trajectory.qualityGate?.highConfidenceEligible === true,
      requiredAction: trajectory.qualityGate?.requiredAction ?? null,
      reasons: compactStringArray(trajectory.qualityGate?.reasons, 12, 160),
      ...(qualityGateCheckResults ? { checkResults: qualityGateCheckResults } : {}),
    },
    ...(qualityGateCheckSummary.length ? { qualityGateCheckSummary } : {}),
    marketPatternIds: (trajectory.marketPatterns ?? []).map((pattern) => pattern.id).filter(Boolean),
    profitFeedback: trajectory.profitFeedback ?? null,
    distillationSignals: trajectory.distillationSignals ?? null,
  }
  if (kind === "eval") {
    return {
      ...base,
      kind,
      id: `eval_${trajectory.id}`,
      question: [
        `这条轨迹应该归入哪个训练目标：${trajectory.question ?? trajectory.hypothesis ?? ""}`,
        `候选目标：${STOCK_FEEDBACK_VALIDATION_TARGETS.join(", ")}`,
      ].join("\n"),
      expected: [
        `validationTarget=${trajectory.validationTarget}`,
        `qualityGate=${gate}`,
        `adapterCapability=${trajectory.adapterCapability}`,
      ].join("\n"),
      evidence: {
        stock: trajectory.stock ?? null,
        marketValidation: trajectory.marketValidation ?? null,
        marketPatterns: trajectory.marketPatterns ?? [],
        profitFeedback: trajectory.profitFeedback ?? null,
        distillationSignals: trajectory.distillationSignals ?? null,
        evidenceState: trajectory.evidenceState ?? null,
        sourceRefs: trajectory.sourceRefs ?? [],
      },
    }
  }
  if (kind === "sft" && ["expectation_validated", "fundamental_validated"].includes(gate)) {
    return {
      ...base,
      kind,
      id: `sft_${trajectory.id}`,
      input: [
        "根据股票研究轨迹做训练目标分流。",
        `假设：${trajectory.hypothesis ?? ""}`,
        `问题：${trajectory.question ?? ""}`,
        `市场验证：${trajectory.marketValidation?.verdict ?? ""}`,
      ].filter(Boolean).join("\n"),
      output: [
        `训练目标：${trajectory.validationTarget}`,
        `质量门：${gate}`,
        `可复用能力：${trajectory.adapterCapability}`,
        trajectory.profitFeedback?.outcome ? `收益反馈：${trajectory.profitFeedback.outcome}` : "",
        trajectory.distillationSignals?.decisionStrategy ? `策略路线：${trajectory.distillationSignals.decisionStrategy}` : "",
        `理由：${compactStringArray(trajectory.qualityGate?.reasons, 8, 160).join("；")}`,
      ].filter(Boolean).join("\n"),
    }
  }
  if (kind === "preference" && ["priced_in_validated", "disconfirmed_validated"].includes(gate)) {
    const accepted = gate === "priced_in_validated"
      ? "方向验证不等于买点成立；当预期已经交易并出现赔率压缩，应降低后手追涨权重，转入 entry risk eval。"
      : "降低假设权重，把失败预期作为负样本；需要解释无承接、未扩散或证伪证据。"
    return {
      ...base,
      kind,
      id: `pref_${trajectory.id}`,
      prompt: `如何处理这条股票反馈轨迹：${trajectory.hypothesis ?? trajectory.question ?? trajectory.id}`,
      accepted,
      rejected: "仅因短期上涨或题材热度继续提高置信度，不区分预期交易、买点风险和基本面兑现。",
    }
  }
  return null
}

export async function readStockFeedbackTrainingSamples(projectPath, kind) {
  const trajectories = await readStockFeedbackTrajectories(projectPath)
  return trajectories.map((trajectory) => sampleFromStockFeedbackTrajectory(trajectory, kind)).filter(Boolean)
}

function adapterCandidateFromTrajectory(trajectory, reviewSignal = null, adapterPriority = null) {
  if (!trajectory?.routing?.adapterCandidate) return null
  const signal = reviewSignal ?? reviewSignalForTrajectory(trajectory, null)
  const priority = adapterPriority ?? adapterCandidatePriority(trajectory, signal, {})
  const gate = trajectory.qualityGate?.status ?? "review_required"
  const marketPatternIds = (trajectory.marketPatterns ?? []).map((pattern) => pattern.id).filter(Boolean)
  const sourceAudit = sourceAuditForTrajectory(trajectory)
  const trainingWeightDecision = trainingWeightDecisionForCandidate(trajectory, signal)
  return {
    schema: STOCK_FEEDBACK_ADAPTER_CANDIDATE_SCHEMA,
    id: `adapter_candidate_${shortHash(`${trajectory.id}:${trajectory.adapterCapability}`)}`,
    sourceKind: sourceAudit.sourceKind,
    sourceKindLabel: sourceAudit.sourceKindLabel,
    sourceTrajectoryId: trajectory.id,
    validationTarget: trajectory.validationTarget,
    qualityGateStatus: gate,
    adapterCapability: trajectory.adapterCapability,
    recommendedAdapterFamily: trajectory.adapterCapability,
    trainingUse: trajectory.trainingUse ?? [],
    marketPatternIds,
    marketPatterns: (trajectory.marketPatterns ?? []).map((pattern) => ({
      id: pattern.id,
      label: pattern.label,
      distillationHint: pattern.distillationHint,
    })),
    reviewSignal: signal,
    adapterPriority: priority,
    trainingWeightDecision,
    curriculumBucket: priority.bucket,
    distillationPlan: distillationPlanForTrajectory(trajectory, signal, priority),
    profitFeedback: trajectory.profitFeedback ?? null,
    distillationSignals: trajectory.distillationSignals ?? null,
    collectionState: sourceAudit.collectionState,
    paperTradeState: sourceAudit.paperTradeState,
    executionResultState: sourceAudit.executionResultState,
    behaviorSummary: [
      `识别${TARGET_TO_LABEL[trajectory.validationTarget] ?? trajectory.validationTarget}`,
      `质量门：${gate}`,
      priority.bucket ? `课程桶：${priority.bucket}` : "",
      marketPatternIds.length ? `手法：${marketPatternIds.join(", ")}` : "",
      trajectory.profitFeedback?.outcome ? `收益反馈：${trajectory.profitFeedback.outcome}${trajectory.profitFeedback.realizedPnlPct !== undefined ? `/${trajectory.profitFeedback.realizedPnlPct}%` : ""}` : "",
      trajectory.distillationSignals?.decisionStrategy ? `策略：${compactString(trajectory.distillationSignals.decisionStrategy, 220)}` : "",
      trajectory.summary ? `归因：${compactString(trajectory.summary, 240)}` : "",
    ].filter(Boolean).join("；"),
    decisionPolicy: {
      keepFactsInRetrieval: true,
      adapterStores: "reusable_behavior_skill_tool_habit_and_decision_strategy",
      adapterDoesNotStore: "raw_facts_announcements_financial_reports_or_trade_data",
    },
    references: {
      sourceRefs: compactStringArray(trajectory.sourceRefs, 20, 220),
      sourceRecordId: trajectory.sourceRecordId,
      trajectoryId: trajectory.id,
      collectionResultId: sourceAudit.collectionResultId,
      paperTradeId: sourceAudit.paperTradeId,
      executionResultId: sourceAudit.executionResultId,
    },
  }
}

export async function exportStockFeedbackLoraReady(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const generatedAt = options.generatedAt ?? nowLocalTimestamp()
  const previousLoraReadyManifest = latestManifestBySchema(
    await readStockFeedbackManifestFamily(projectPath, "exports"),
    STOCK_FEEDBACK_LORA_READY_MANIFEST_SCHEMA,
  )
  const requestedQualityGate = options.qualityGate ?? options["quality-gate"] ?? "high_confidence"
  const listed = await listStockFeedbackTrajectories({
    projectPath,
    qualityGate: requestedQualityGate,
    validationTarget: options.validationTarget ?? options["validation-target"],
    limit: options.limit ?? 500,
  })
  const reviewEvents = await readStockFeedbackReviewEvents(projectPath)
  const latestReviews = latestReviewByTrajectory(reviewEvents)
  let exportTrajectories = listed.trajectories
  let reviewedPaperApprovalSupplementCount = 0
  if (requestedQualityGate === "high_confidence") {
    const allListed = await listStockFeedbackTrajectories({
      projectPath,
      validationTarget: options.validationTarget ?? options["validation-target"],
      marketPattern: options.marketPattern ?? options["market-pattern"],
      stock: options.stock,
      hypothesis: options.hypothesis,
      date: options.date,
      limit: options.trajectoryLimit ?? options["trajectory-limit"] ?? 1000,
    })
    const existingIds = new Set(exportTrajectories.map((trajectory) => trajectory.id).filter(Boolean))
    const reviewedPaperTrajectories = allListed.trajectories.filter((trajectory) => (
      !existingIds.has(trajectory.id) &&
      isProfitableClosedPaperTradeTrajectory(trajectory) &&
      latestReviews.get(trajectory.id)?.action === "approve_paper_adapter_candidate"
    ))
    reviewedPaperApprovalSupplementCount = reviewedPaperTrajectories.length
    exportTrajectories = [...exportTrajectories, ...reviewedPaperTrajectories]
  }
  const trajectorySummary = summarizeTrajectories(exportTrajectories)
  const patternCounts = trajectorySummary.byMarketPattern ?? {}
  const candidates = exportTrajectories
    .map((trajectory) => {
      const reviewSignal = reviewSignalForTrajectory(trajectory, latestReviews.get(trajectory.id) ?? null)
      const adapterPriority = adapterCandidatePriority(trajectory, reviewSignal, patternCounts)
      return adapterCandidateFromTrajectory(trajectory, reviewSignal, adapterPriority)
    })
    .filter(Boolean)
    .sort((a, b) => (
      (b.adapterPriority?.score ?? 0) - (a.adapterPriority?.score ?? 0) ||
      String(a.validationTarget ?? "").localeCompare(String(b.validationTarget ?? "")) ||
      a.id.localeCompare(b.id)
    ))
  const adapterCurriculum = buildAdapterCurriculumSummary(candidates, exportTrajectories, trajectorySummary)
  const paperTradeAgentCandidates = await readStockFeedbackPaperTradeAgentCandidates(projectPath)
  const paperTradeAgentCurriculum = buildPaperTradeAgentCurriculumSummary(paperTradeAgentCandidates)
  const benchmarkPreview = await buildStockFeedbackBenchmark({
    projectPath,
    generatedAt,
    limit: options.benchmarkLimit ?? options["benchmark-limit"] ?? options.limit ?? 500,
  })
  const paperTradeDiscretionaryReviewCurriculum = buildPaperTradeDiscretionaryReviewCurriculumSummary(
    benchmarkPreview.cases ?? [],
  )
  const adapterBatchRecipe = buildAdapterBatchRecipe(candidates)
  const patternRadar = buildPatternRadar(exportTrajectories, latestReviews, candidates)
  const manifest = {
    schema: STOCK_FEEDBACK_LORA_READY_MANIFEST_SCHEMA,
    generatedAt,
    projectPath,
    count: candidates.length,
    sources: [
      "stock-feedback-trajectory-v1",
      "research-os-execution-result-v1",
      "stock-feedback-paper-trade-agent-candidate-v1",
      "stock-feedback-paper-trade-v1",
      "stock-validation-benchmark-v1",
    ],
    filters: {
      ...listed.filters,
      reviewedPaperApprovalSupplementCount,
    },
    adapterCapabilityCounts: candidates.reduce((counts, item) => {
      counts[item.adapterCapability] = (counts[item.adapterCapability] ?? 0) + 1
      return counts
    }, {}),
    marketPatternCounts: candidates.reduce((counts, item) => {
      for (const patternId of item.marketPatternIds ?? []) {
        counts[patternId] = (counts[patternId] ?? 0) + 1
      }
      return counts
    }, {}),
    profitOutcomeCounts: candidates.reduce((counts, item) => {
      const outcome = item.profitFeedback?.outcome ?? "unknown"
      counts[outcome] = (counts[outcome] ?? 0) + 1
      return counts
    }, {}),
    sourceKindCounts: candidates.reduce((counts, item) => {
      const sourceKind = item.sourceKind ?? "unknown"
      counts[sourceKind] = (counts[sourceKind] ?? 0) + 1
      return counts
    }, {}),
    trainingWeightDecisionCounts: candidates.reduce((counts, item) => {
      const state = item.trainingWeightDecision?.state ?? "unknown"
      counts[state] = (counts[state] ?? 0) + 1
      return counts
    }, {}),
    adapterCurriculum: {
      ...adapterCurriculum,
      paperTradeAgent: paperTradeAgentCurriculum,
      paperTradeDiscretionaryReview: paperTradeDiscretionaryReviewCurriculum,
    },
    paperTradeAgentCurriculum,
    paperTradeDiscretionaryReviewCurriculum,
    adapterBatchRecipe,
    patternRadar,
    peftBoundary: {
      modelTrainingStarted: false,
      storesRawFacts: false,
      factsRemainIn: ["wiki/raw/facts/tool-state", "stock price SQL", "sourceRefs"],
      adapterStores: ["behavior", "skill", "tool habit", "decision strategy"],
    },
    candidateRefs: candidates.map((item) => ({
      id: item.id,
      sourceTrajectoryId: item.sourceTrajectoryId,
      adapterCapability: item.adapterCapability,
      validationTarget: item.validationTarget,
      qualityGateStatus: item.qualityGateStatus,
      marketPatternIds: item.marketPatternIds ?? [],
      profitOutcome: item.profitFeedback?.outcome ?? "unknown",
      sourceKind: item.sourceKind ?? "unknown",
      collectionResultId: item.references?.collectionResultId ?? null,
      paperTradeId: item.references?.paperTradeId ?? null,
      executionResultId: item.references?.executionResultId ?? null,
      paperTradeStatus: item.paperTradeState?.status ?? null,
      executionResultStatus: item.executionResultState?.recordStatus ?? null,
      executionResultPnlScope: item.executionResultState?.pnlScope ?? null,
      ledgerKind: item.executionResultState?.ledgerKind ?? item.paperTradeState?.ledgerKind ?? item.profitFeedback?.ledgerKind ?? null,
      realizedPnlPct: item.profitFeedback?.realizedPnlPct ?? null,
      maxDrawdownPct: item.profitFeedback?.maxDrawdownPct ?? null,
      holdingDays: item.profitFeedback?.holdingDays ?? null,
      collectionResult: item.collectionState?.result ?? null,
      targetPatternId: item.collectionState?.targetPatternId ?? null,
      reviewed: item.reviewSignal?.reviewed === true,
      curriculumBucket: item.curriculumBucket,
      adapterPriorityScore: item.adapterPriority?.score ?? 0,
      trainingWeightState: item.trainingWeightDecision?.state ?? "unknown",
      effectiveWeightMultiplier: item.trainingWeightDecision?.effectiveWeightMultiplier ?? null,
      trainingWeightSource: item.trainingWeightDecision?.source ?? null,
    })),
    batchRefreshDelta: null,
  }
  manifest.batchRefreshDelta = buildLoraReadyBatchRefreshDelta(previousLoraReadyManifest, manifest)
  let writeResult = null
  if (options.write) {
    writeResult = await writeJsonlWithManifest({
      projectPath,
      family: "exports",
      baseName: "lora-ready",
      records: candidates,
      manifest,
      generatedAt,
    })
  }
  return {
    schema: "stock-feedback-lora-ready-result-v1",
    mode: "stock-feedback-export-lora-ready",
    dryRun: !Boolean(options.write),
    projectPath,
    generatedAt,
    count: candidates.length,
    candidates,
    manifest,
    adapterCurriculum: manifest.adapterCurriculum,
    paperTradeAgentCurriculum,
    paperTradeDiscretionaryReviewCurriculum,
    adapterBatchRecipe,
    patternRadar,
    writeResult: writeResult ? { candidates: writeResult.jsonl, manifest: writeResult.manifest } : null,
    writePolicy: {
      wroteWiki: false,
      wroteRaw: false,
      wroteBrain: false,
      wroteArtifacts: Boolean(options.write),
      allowedRoot: STOCK_FEEDBACK_ROOT,
    },
  }
}

async function readTrainingExportLedgerEntries(projectPath) {
  const ledgerPath = path.join(projectPath, ".llm-wiki", "exports", "training", "export-ledger.jsonl")
  const parsed = await readJsonlFile(ledgerPath).catch(() => [])
  return parsed
    .map((item) => item.value)
    .filter((item) => item?.schema === "training-sample-export-ledger-entry-v1")
}

async function readStockFeedbackManifestFamily(projectPath, family) {
  const root = path.join(projectPath, STOCK_FEEDBACK_ROOT, family)
  const files = await listFilesRecursive(root, {
    extensions: new Set([".json"]),
    excludeDirNames: new Set([".git", "node_modules"]),
    maxBytes: 1024 * 1024 * 5,
  }).catch(() => [])
  const manifests = []
  for (const filePath of files.sort()) {
    try {
      const raw = await fs.readFile(filePath, "utf8")
      const parsed = JSON.parse(raw)
      manifests.push({ ...parsed, artifactPath: projectRelative(projectPath, filePath) })
    } catch {}
  }
  return manifests
}

function latestManifestBySchema(manifests = [], schema) {
  return manifests
    .filter((item) => !schema || item.schema === schema)
    .sort((a, b) => (
      String(b.generatedAt ?? "").localeCompare(String(a.generatedAt ?? "")) ||
      String(b.artifactPath ?? "").localeCompare(String(a.artifactPath ?? ""))
    ))[0] ?? null
}

function artifactSourceConcentrationFromManifest(manifest = null) {
  const counts = manifest?.sourceKindCounts ?? {}
  const entries = Object.entries(counts)
    .filter(([, count]) => Number(count) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]) || a[0].localeCompare(b[0]))
  if (entries.length === 0) return null
  const countedTotal = entries.reduce((sum, [, count]) => sum + Number(count), 0)
  const total = Number.isFinite(Number(manifest?.count)) && Number(manifest?.count) > 0
    ? Number(manifest.count)
    : countedTotal
  const [dominantSourceKind, dominantCountRaw] = entries[0]
  const dominantCount = Number(dominantCountRaw)
  const dominantSharePct = total > 0 ? Number(((dominantCount / total) * 100).toFixed(1)) : 0
  const singleSourceBatch = entries.length === 1 && dominantCount === total && total > 0
  const concentrated = singleSourceBatch || dominantSharePct >= 75
  const trainingWeightSuggestion = concentrated ? {
    action: "human_audit_before_weight_up",
    defaultWeightMultiplier: 0.5,
    maxWeightMultiplierBeforeReview: 0.5,
    allowWeightUpAfterReview: true,
    reason: "source_concentration_bias_risk",
    note: "来源过度集中时先降权进入 eval/preference 抽查，通过人工审核后再提高训练权重。",
  } : {
    action: "standard_weight_with_spot_check",
    defaultWeightMultiplier: 1,
    maxWeightMultiplierBeforeReview: 1,
    allowWeightUpAfterReview: false,
    reason: "diversified_source_mix",
    note: "来源分布较分散，保持标准权重并抽查代表样本。",
  }
  return {
    dominantSourceKind,
    dominantSourceKindLabel: stockFeedbackSourceKindLabel(dominantSourceKind),
    dominantCount,
    total,
    dominantSharePct,
    singleSourceBatch,
    needsHumanReview: concentrated,
    reviewHint: concentrated
      ? "来源集中，人工抽查是否样本偏置后再提升训练权重。"
      : "来源分布较分散，可按 refs 抽查代表样本。",
    trainingWeightSuggestion,
  }
}

function compactArtifactAuditRef(item = {}, refKind = "artifact_ref") {
  const sourceKind = item.sourceKind ?? "unknown"
  return {
    refKind,
    id: item.id ?? null,
    sourceTrajectoryId: item.sourceTrajectoryId ?? null,
    validationTarget: item.validationTarget ?? null,
    qualityGateStatus: item.qualityGateStatus ?? null,
    sourceKind,
    sourceKindLabel: stockFeedbackSourceKindLabel(sourceKind),
    collectionResultId: item.collectionResultId ?? null,
    paperTradeId: item.paperTradeId ?? null,
    executionResultId: item.executionResultId ?? null,
    collectionResult: item.collectionResult ?? null,
    executionResult: item.executionResult ?? null,
    executionResultPnlScope: item.executionResultPnlScope ?? null,
    targetPatternId: item.targetPatternId ?? null,
    dynamicBucket: item.dynamicBucket ?? null,
    curriculumBucket: item.curriculumBucket ?? null,
    adapterCapability: item.adapterCapability ?? null,
    profitOutcome: item.profitOutcome ?? null,
    reviewed: item.reviewed === true,
    adapterPriorityScore: typeof item.adapterPriorityScore === "number" ? item.adapterPriorityScore : null,
    trainingWeightState: item.trainingWeightState ?? null,
    effectiveWeightMultiplier: typeof item.effectiveWeightMultiplier === "number" ? item.effectiveWeightMultiplier : null,
    trainingWeightSource: item.trainingWeightSource ?? null,
    marketPatternIds: compactStringArray(item.marketPatternIds, 8, 120),
  }
}

function artifactAuditRefsFromManifest(manifest = null) {
  if (!manifest) return []
  if (Array.isArray(manifest.caseRefs)) {
    return manifest.caseRefs.slice(0, 8).map((item) => compactArtifactAuditRef(item, "benchmark_case"))
  }
  if (Array.isArray(manifest.candidateRefs)) {
    return manifest.candidateRefs.slice(0, 8).map((item) => compactArtifactAuditRef(item, "adapter_candidate"))
  }
  return []
}

function compactAdapterBatchRecipe(recipe = null, candidateRefs = []) {
  if (!recipe) return null
  const compactRefsById = new Map(
    (candidateRefs ?? [])
      .filter((item) => item?.id)
      .map((item) => [item.id, compactArtifactAuditRef(item, "adapter_candidate")]),
  )
  return {
    schema: recipe.schema ?? null,
    strategy: recipe.strategy ?? null,
    modelTrainingStarted: recipe.modelTrainingStarted ?? null,
    storesRawFacts: recipe.storesRawFacts ?? null,
    totalCandidates: recipe.totalCandidates ?? 0,
    weightedCandidateCount: recipe.weightedCandidateCount ?? 0,
    totalEffectiveWeight: typeof recipe.totalEffectiveWeight === "number" ? recipe.totalEffectiveWeight : null,
    buckets: (recipe.buckets ?? []).slice(0, 8).map((bucket) => {
      const candidateIds = (bucket.candidateIds ?? []).filter(Boolean)
      const bucketRefs = candidateIds
        .map((id) => compactRefsById.get(id))
        .filter(Boolean)
      return {
        id: bucket.id ?? null,
        label: bucket.label ?? null,
        count: bucket.count ?? 0,
        effectiveWeightMultiplier: typeof bucket.effectiveWeightMultiplier === "number" ? bucket.effectiveWeightMultiplier : null,
        totalEffectiveWeight: typeof bucket.totalEffectiveWeight === "number" ? bucket.totalEffectiveWeight : null,
        recommendedSampling: bucket.recommendedSampling ?? null,
        selectionUse: compactStringArray(bucket.selectionUse, 8, 80),
        reviewGate: bucket.reviewGate ?? null,
        candidateRefCount: bucketRefs.length,
        candidateRefs: bucketRefs.slice(0, 4),
      }
    }),
    peftBoundary: recipe.peftBoundary ? {
      modelTrainingStarted: recipe.peftBoundary.modelTrainingStarted ?? null,
      storesRawFacts: recipe.peftBoundary.storesRawFacts ?? null,
      factsRemainIn: compactStringArray(recipe.peftBoundary.factsRemainIn, 8, 120),
      adapterStores: compactStringArray(recipe.peftBoundary.adapterStores, 8, 120),
    } : null,
  }
}

function compactBatchRefreshDelta(delta = null) {
  if (!delta) return null
  const counts = delta.counts ?? {}
  const movements = sortLoraRefreshMovements(delta.movements ?? [])
    .slice(0, 8)
    .map((item) => compactLoraRefreshMovement(item))
  const movementSummary = [
    counts.upweighted ? `提权 ${counts.upweighted}` : "",
    counts.downweighted ? `降权 ${counts.downweighted}` : "",
    counts.rerouted ? `改分流 ${counts.rerouted}` : "",
    counts.movedIn ? `新增 ${counts.movedIn}` : "",
    counts.movedOut ? `转出 ${counts.movedOut}` : "",
    counts.evidenceGap ? `待补证 ${counts.evidenceGap}` : "",
    counts.rejected ? `排除 ${counts.rejected}` : "",
  ].filter(Boolean).join("，")
  return {
    headline: "批次刷新影响",
    detail: `${counts.totalBefore ?? 0} 条到 ${counts.totalAfter ?? 0} 条；${movementSummary || "训练权重结构暂无明显迁移"}。本次只比较训练配方与引用，不搬运原始事实；公告、交易数据和原文仍留在 retrieval/tool state。`,
    totalBefore: counts.totalBefore ?? 0,
    totalAfter: counts.totalAfter ?? 0,
    upweighted: counts.upweighted ?? 0,
    downweighted: counts.downweighted ?? 0,
    unchanged: counts.unchanged ?? 0,
    rerouted: counts.rerouted ?? 0,
    movedOut: counts.movedOut ?? 0,
    movedIn: counts.movedIn ?? 0,
    evidenceGap: counts.evidenceGap ?? 0,
    rejected: counts.rejected ?? 0,
    preferenceOrRisk: counts.preferenceOrRisk ?? 0,
    adapterApproved: counts.adapterApproved ?? 0,
    movements,
    movementIndex: Object.keys(delta.movementIndex ?? {}).length > 0
      ? compactLoraRefreshMovementIndex(delta.movementIndex)
      : buildLoraRefreshMovementIndex(delta.movements ?? []),
    source: "lora-ready-refresh",
  }
}

function artifactSourceMixFromManifest(manifest = null) {
  if (!manifest) return null
  return {
    schema: manifest.schema ?? null,
    artifactPath: manifest.artifactPath ?? null,
    generatedAt: manifest.generatedAt ?? null,
    count: manifest.count ?? 0,
    sourceKindCounts: manifest.sourceKindCounts ?? {},
    sourceConcentration: artifactSourceConcentrationFromManifest(manifest),
    refs: artifactAuditRefsFromManifest(manifest),
    adapterBatchRecipe: compactAdapterBatchRecipe(manifest.adapterBatchRecipe, manifest.candidateRefs ?? []),
    batchRefreshDelta: compactBatchRefreshDelta(manifest.batchRefreshDelta),
    peftBoundary: manifest.peftBoundary ? {
      modelTrainingStarted: manifest.peftBoundary.modelTrainingStarted ?? null,
      storesRawFacts: manifest.peftBoundary.storesRawFacts ?? null,
      factsRemainIn: compactStringArray(manifest.peftBoundary.factsRemainIn, 8, 120),
      adapterStores: compactStringArray(manifest.peftBoundary.adapterStores, 8, 120),
    } : null,
  }
}

export async function getStockFeedbackStatus(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const generatedAt = nowLocalTimestamp()
  const persisted = await readStockFeedbackTrajectories(projectPath)
  const derived = persisted.length ? [] : (await buildStockFeedbackTrajectories({ projectPath })).trajectories
  const trajectories = persisted.length ? persisted : derived
  const brainRecords = await readBrainRecords(projectPath)
  const brainValues = brainRecords.map((item) => item.value ?? item).filter((item) => item && typeof item === "object" && !Array.isArray(item))
  const trainingExports = await readTrainingExportLedgerEntries(projectPath)
  const loraManifests = await readStockFeedbackManifestFamily(projectPath, "exports")
  const benchmarkManifests = await readStockFeedbackManifestFamily(projectPath, "benchmark")
  const latestLoraReadyManifest = latestManifestBySchema(loraManifests, STOCK_FEEDBACK_LORA_READY_MANIFEST_SCHEMA)
  const latestBenchmarkManifest = latestManifestBySchema(benchmarkManifests, "stock-validation-benchmark-manifest-v1")
  const reviewEvents = await readStockFeedbackReviewEvents(projectPath)
  const collectionResults = await readStockFeedbackCollectionResults(projectPath)
  const paperTrades = await readStockFeedbackPaperTrades(projectPath)
  const executionResults = await readStockFeedbackExecutionResults(projectPath)
  const executionResultDeliveryNoteFiles = await listDeliveryNoteMarkdownFiles(projectPath).catch(() => [])
  const evidenceTasks = latestEvidenceTaskStates(await readStockFeedbackEvidenceTaskEvents(projectPath))
  const evidenceResults = latestEvidenceResultStates(await readStockFeedbackEvidenceResultEvents(projectPath))
  const evidenceDlq = await readStockFeedbackEvidenceDlqEvents(projectPath)
  const hypothesisEvidenceFeedbackRecords = await readHypothesisEvidenceFeedbackRecords(projectPath)
  const upstreamInputs = {
    brainRecords: brainRecords.length,
    selfQuestionQuestions: brainValues.filter((item) => item.schema === "self-question-v1" || item.kind === "self-question" || item.type === "question").length,
    selfQuestionValidations: brainValues.filter((item) => item.validationMethod === "self_question_market_feedback_v1" || item.kind === "self-question-market-validation" || item.type === "validation").length,
    selfQuestionAttributions: brainValues.filter((item) => item.schema === "self-question-attribution-v1" || item.kind === "self-question-attribution" || item.type === "attribution").length,
    selfQuestionEvidenceResults: brainValues.filter((item) => item.schema === "self-question-evidence-result-v1" || item.kind === "self-question-evidence-result" || item.type === "evidence_result").length,
    hypothesisEvidenceFeedback: hypothesisEvidenceFeedbackRecords.length,
    collectionResults: collectionResults.length,
    paperTrades: paperTrades.length,
    executionResults: executionResults.length,
    evidenceTasks: evidenceTasks.length,
    evidenceResults: evidenceResults.length,
  }
  const latestReviewMap = latestReviewByTrajectory(reviewEvents)
  const statusSummary = summarizeTrajectories(trajectories)
  const paperTradeSummary = summarizePaperTrades(paperTrades)
  const paperTradePlanning = buildPaperTradePlanningSummary({ trajectories, paperTrades })
  const paperTradeAgent = await buildStockFeedbackPaperTradeAgentCandidates({ projectPath, limit: 8, generatedAt })
  const paperTradeAgentWrittenCandidates = await readStockFeedbackPaperTradeAgentCandidates(projectPath)
  const paperTradeAgentAuditCandidates = [...paperTradeAgentWrittenCandidates]
  const paperTradeAgentAuditCandidateIds = new Set(paperTradeAgentAuditCandidates.map((item) => item.id).filter(Boolean))
  for (const candidate of paperTradeAgent.summary?.candidates ?? []) {
    if (candidate.id && paperTradeAgentAuditCandidateIds.has(candidate.id)) continue
    paperTradeAgentAuditCandidates.push(candidate)
    if (candidate.id) paperTradeAgentAuditCandidateIds.add(candidate.id)
  }
  const discretionaryReviewAudit = buildPaperTradeDiscretionaryReviewAudit({
    paperTrades,
    paperTradeAgentCandidates: paperTradeAgentAuditCandidates,
  })
  const patternCounts = statusSummary.byMarketPattern ?? {}
  const dynamicBenchmarkCases = trajectories.map((trajectory) => {
    const reviewSignal = reviewSignalForTrajectory(trajectory, latestReviewMap.get(trajectory.id) ?? null)
    return {
      reviewSignal,
      dynamicPriority: dynamicBenchmarkPriority(trajectory, reviewSignal, patternCounts),
    }
  })
  const dynamicBenchmark = buildDynamicBenchmarkSummary(dynamicBenchmarkCases, trajectories, statusSummary)
  const adapterCandidatePreview = trajectories
    .map((trajectory) => {
      const reviewSignal = reviewSignalForTrajectory(trajectory, latestReviewMap.get(trajectory.id) ?? null)
      const adapterPriority = adapterCandidatePriority(trajectory, reviewSignal, patternCounts)
      return adapterCandidateFromTrajectory(trajectory, reviewSignal, adapterPriority)
    })
    .filter(Boolean)
    .sort((a, b) => (
      (b.adapterPriority?.score ?? 0) - (a.adapterPriority?.score ?? 0) ||
      String(a.validationTarget ?? "").localeCompare(String(b.validationTarget ?? "")) ||
      a.id.localeCompare(b.id)
    ))
  const adapterCurriculum = buildAdapterCurriculumSummary(adapterCandidatePreview, trajectories, statusSummary)
  const patternRadar = buildPatternRadar(trajectories, latestReviewMap, adapterCandidatePreview)
  const reviewQueueSummary = summarizeReviewQueue(
    trajectories.map((trajectory) => reviewQueueItem(trajectory, latestReviewMap.get(trajectory.id) ?? null)),
    reviewEvents,
  )
  const trajectorySourceIds = new Set(trajectories.map((item) => item.sourceRecordId).filter(Boolean))
  const collectionResultsAwaitingTrajectory = collectionResults.filter((item) => item.id && !trajectorySourceIds.has(item.id)).length
  const recentCollectionResults = collectionResults
    .slice()
    .sort((a, b) => String(b.generatedAt ?? "").localeCompare(String(a.generatedAt ?? "")) || String(b.id ?? "").localeCompare(String(a.id ?? "")))
    .slice(0, 8)
    .map((item) => ({
      id: item.id,
      generatedAt: item.generatedAt ?? null,
      sourceDraftId: item.sourceDraftId ?? null,
      sourceTaskId: item.sourceTaskId ?? null,
      targetPatternId: item.targetPatternId ?? null,
      targetPatternLabel: item.targetPatternLabel ?? null,
      validationTarget: item.validationTarget ?? null,
      adapterCapability: item.adapterCapability ?? null,
      result: item.result ?? null,
      resultLabel: item.resultLabel ?? null,
      evidenceRefs: compactStringArray(item.evidenceRefs, 8, 220),
      evidenceRefCount: (item.evidenceRefs ?? []).length,
      intakeSummary: compactString(item.intakeSummary, 220),
      nextAction: item.nextAction ?? null,
      reviewer: item.reviewer ?? null,
      stock: item.stock ?? null,
      hypothesis: compactString(item.hypothesis, 220),
      artifactPath: item.artifactPath ?? null,
    }))
  const recentPaperTrades = paperTrades
    .slice()
    .sort((a, b) => String(b.generatedAt ?? "").localeCompare(String(a.generatedAt ?? "")) || String(b.id ?? "").localeCompare(String(a.id ?? "")))
    .slice(0, 8)
    .map(compactPaperTrade)
  const recentExecutionResults = executionResults
    .slice()
    .sort((a, b) => String(b.generatedAt ?? "").localeCompare(String(a.generatedAt ?? "")) || String(b.artifactId ?? "").localeCompare(String(a.artifactId ?? "")))
    .slice(0, 8)
    .map((item) => ({
      artifactId: item.artifactId,
      generatedAt: item.generatedAt ?? null,
      ledgerKind: item.ledgerKind ?? null,
      recordStatus: item.recordStatus ?? null,
      pnlScope: item.pnlScope ?? null,
      positionState: item.positionState ?? null,
      stock: item.instrument ? { code: item.instrument.stockCode, name: item.instrument.stockName } : null,
      realizedPnlAbs: item.pnl?.realizedGrossPnlAbs ?? item.pnl?.realizedNetPnlAbs ?? null,
      realizedPnlPct: item.pnl?.realizedPnlPct ?? null,
      qualityGateStatus: item.qualityGate?.status ?? null,
      sourceRefs: compactStringArray((item.evidence?.sourceRefs ?? []).map((ref) => ref.ref), 8, 220),
      artifactPath: item.artifactPath ?? null,
    }))
  const actionableExecutionResultReviews = executionResults.filter(isActionableExecutionResultReview)
  const executionResultReconciliationAudit = buildExecutionResultReconciliationAudit(executionResults)
  const evidenceResultReviewAudit = buildEvidenceResultReviewAudit(evidenceResults)
  const paperTradeSettlementQueue = buildPaperTradeSettlementQueue(paperTrades, 8)
  const paperTradeSettlementRefreshAudit = buildPaperTradeSettlementRefreshAudit({
    paperTrades,
    trajectories,
    latestBenchmarkManifest,
    latestLoraReadyManifest,
    latestReviewMap,
  })
  const sampleDensityAudit = buildStockFeedbackSampleDensityAudit({
    trajectories,
    upstreamInputs,
    paperTrades,
    paperTradeAgentSummary: paperTradeAgent.summary,
    paperTradeAgentWrittenCandidates,
    benchmarkManifests,
    loraManifests,
    latestReviewMap,
    latestLoraReadyManifest,
  })
  return {
    schema: "stock-feedback-status-v1",
    mode: "stock-feedback-status",
    generatedAt,
    projectPath,
    sourceMode: persisted.length ? "persisted" : "derived",
    counts: {
      trajectories: trajectories.length,
      persistedTrajectories: persisted.length,
      pendingEvidence: trajectories.filter((item) => item.qualityGate?.status === "needs_evidence").length,
      trainable: trajectories.filter((item) => item.qualityGate?.highConfidenceEligible === true).length,
      pricedInRisk: trajectories.filter((item) => item.validationTarget === "priced_in_risk").length,
      failedSamples: trajectories.filter((item) => item.validationTarget === "disconfirmation").length,
      marketPatternTrajectories: trajectories.filter((item) => (item.marketPatterns ?? []).length > 0).length,
      profitFeedbackTrajectories: trajectories.filter((item) => item.profitFeedback?.outcome && item.profitFeedback.outcome !== "unknown").length,
      pendingReviews: reviewQueueSummary.pending,
      reviewedTrajectories: reviewQueueSummary.reviewed,
      reviewEvents: reviewEvents.length,
      collectionResults: collectionResults.length,
      confirmedCollectionResults: collectionResults.filter((item) => item.result === "confirmed").length,
      collectionResultsAwaitingTrajectory,
      executionResults: executionResults.length,
      executionResultImportableDeliveryNotes: executionResultDeliveryNoteFiles.length,
      executionResultsConfirmed: executionResults.filter((item) => item.recordStatus === "confirmed").length,
      executionResultsNeedsReconciliation: executionResults.filter((item) => item.qualityGate?.status === "needs_reconciliation").length,
      executionResultsActionableReviews: actionableExecutionResultReviews.length,
      realTradeExecutionResults: executionResults.filter((item) => item.ledgerKind === "real_trade").length,
      realTradeProfitable: executionResults.filter((item) => item.ledgerKind === "real_trade" && firstFiniteNumber(item.pnl?.realizedGrossPnlAbs, item.pnl?.realizedNetPnlAbs) > 0).length,
      realTradeConfirmedProfitable: executionResults.filter((item) => item.ledgerKind === "real_trade" && item.recordStatus === "confirmed" && firstFiniteNumber(item.pnl?.realizedGrossPnlAbs, item.pnl?.realizedNetPnlAbs) > 0).length,
      paperTrades: paperTrades.length,
      paperTradeOpen: paperTradeSummary.open,
      paperTradeClosed: paperTradeSummary.closed,
      paperTradeProfitable: paperTradeSummary.profitable,
      paperTradePendingSettlement: paperTradeSettlementQueue.count,
      paperTradeSettlementRefreshPending: paperTradeSettlementRefreshAudit.pending,
      paperTradePlanCandidates: paperTradePlanning.counts.candidates,
      paperTradeAgentCandidates: paperTradeAgent.summary?.counts?.total ?? 0,
      paperTradeAgentWrittenCandidates: paperTradeAgentWrittenCandidates.length,
      llmDiscretionaryReviewReady: discretionaryReviewAudit.counts.readyPairs,
      llmDiscretionaryReviewGaps: discretionaryReviewAudit.items.filter((item) => !item.readyForReview).length,
      sampleDensityGaps: sampleDensityAudit.gaps.length,
      upstreamFeedbackInputs: sampleDensityAudit.counts.upstreamInputs.brainRecords
        + sampleDensityAudit.counts.upstreamInputs.hypothesisEvidenceFeedback
        + sampleDensityAudit.counts.upstreamInputs.collectionResults
        + sampleDensityAudit.counts.upstreamInputs.paperTrades
        + sampleDensityAudit.counts.upstreamInputs.executionResults,
      evidenceTasks: evidenceTasks.length,
      evidenceTasksPending: evidenceTasks.filter((item) => item.status === "pending").length,
      evidenceTasksAwaitingReview: evidenceTasks.filter((item) => item.status === "awaiting_review").length,
      evidenceTasksCompleted: evidenceTasks.filter((item) => item.status === "completed").length,
      evidenceResults: evidenceResults.length,
      evidenceResultsAwaitingReview: evidenceResults.filter((item) => item.status === "awaiting_review").length,
      evidenceResultsCompleted: evidenceResults.filter((item) => item.status === "completed").length,
      evidenceDlq: evidenceDlq.filter((item) => item.status !== "discarded").length,
      dynamicBenchmarkGaps: dynamicBenchmark.coverageGaps.length,
      adapterCurriculumGaps: adapterCurriculum.coverageGaps.length,
      patternRadarGaps: patternRadar.gaps.length,
      adapterCandidates: adapterCandidatePreview.length,
      reviewedAdapterCandidates: adapterCurriculum.counts.reviewedCandidates,
      benchmarkBatches: benchmarkManifests.length,
      loraReadyBatches: loraManifests.filter((item) => item.schema === STOCK_FEEDBACK_LORA_READY_MANIFEST_SCHEMA).length,
      trainingExportBatches: trainingExports.length,
    },
    summary: statusSummary,
    dynamicBenchmark,
    adapterCurriculum,
    patternRadar,
    sampleDensityAudit,
    discretionaryReviewAudit,
    recentCollectionResults,
    recentExecutionResults,
    evidenceRunner: {
      schema: "stock-feedback-evidence-runner-summary-v1",
      counts: {
        tasks: evidenceTasks.length,
        pending: evidenceTasks.filter((item) => item.status === "pending").length,
        awaitingReview: evidenceTasks.filter((item) => item.status === "awaiting_review").length,
        completed: evidenceTasks.filter((item) => item.status === "completed").length,
        results: evidenceResults.length,
        resultsAwaitingReview: evidenceResultReviewAudit.counts.awaitingReview,
        hardSourceReviewReady: evidenceResultReviewAudit.counts.hardSourceReviewReady,
        duplicateWebLeadAfterHardSource: evidenceResultReviewAudit.counts.duplicateWebLeadAfterHardSource,
        dlq: evidenceDlq.filter((item) => item.status !== "discarded").length,
      },
      reviewAudit: evidenceResultReviewAudit,
      recentTasks: evidenceTasks
        .slice()
        .sort((a, b) => String(b.updatedAt ?? b.generatedAt ?? "").localeCompare(String(a.updatedAt ?? a.generatedAt ?? "")))
        .slice(0, 8)
        .map(compactEvidenceTask),
      recentResults: evidenceResults
        .slice()
        .sort((a, b) => String(b.updatedAt ?? b.generatedAt ?? "").localeCompare(String(a.updatedAt ?? a.generatedAt ?? "")))
        .slice(0, 8)
        .map((item) => compactEvidenceResult(item)),
      writeBoundary: {
        root: STOCK_FEEDBACK_ROOT,
        families: ["evidence-tasks", "evidence-results", "evidence-runs", "evidence-dlq", "source-health"],
        wroteWiki: false,
        wroteRaw: false,
        wroteBrain: false,
      },
    },
    paperTradePlanning,
    executionResultLedger: {
      schema: "stock-feedback-execution-result-ledger-summary-v1",
      counts: {
        executionResults: executionResults.length,
        importableDeliveryNotes: executionResultDeliveryNoteFiles.length,
        confirmed: executionResults.filter((item) => item.recordStatus === "confirmed").length,
        needsReconciliation: executionResults.filter((item) => item.qualityGate?.status === "needs_reconciliation").length,
        actionableReviews: actionableExecutionResultReviews.length,
        realTrade: executionResults.filter((item) => item.ledgerKind === "real_trade").length,
        profitableRealTrade: executionResults.filter((item) => item.ledgerKind === "real_trade" && firstFiniteNumber(item.pnl?.realizedGrossPnlAbs, item.pnl?.realizedNetPnlAbs) > 0).length,
        confirmedProfitableRealTrade: executionResults.filter((item) => item.ledgerKind === "real_trade" && item.recordStatus === "confirmed" && firstFiniteNumber(item.pnl?.realizedGrossPnlAbs, item.pnl?.realizedNetPnlAbs) > 0).length,
      },
      reconciliationAudit: executionResultReconciliationAudit,
      recentExecutionResults,
      sourceFiles: executionResultDeliveryNoteFiles.slice(0, 8).map((filePath) => projectRelative(projectPath, filePath)),
      writeBoundary: {
        root: STOCK_FEEDBACK_ROOT,
        family: "execution-results",
        wroteWiki: false,
        wroteRaw: false,
        wroteBrain: false,
        wroteRealTradeLedger: false,
      },
    },
    paperTradeAgent: paperTradeAgent.summary,
    paperTradeLedger: {
      schema: "stock-feedback-paper-trade-ledger-summary-v1",
      counts: paperTradeSummary,
      summary: paperTradeSummary,
      recentPaperTrades,
      settlementQueue: paperTradeSettlementQueue,
      settlementRefreshAudit: paperTradeSettlementRefreshAudit,
      writeBoundary: {
        root: STOCK_FEEDBACK_ROOT,
        family: "paper-trades",
        wroteWiki: false,
        wroteRaw: false,
        wroteBrain: false,
        wroteRealTradeLedger: false,
      },
    },
    artifactSourceMix: {
      benchmark: artifactSourceMixFromManifest(latestBenchmarkManifest),
      loraReady: artifactSourceMixFromManifest(latestLoraReadyManifest),
    },
    latest: {
      trajectoryArtifact: persisted[0]?.artifactPath ?? null,
      loraReadyManifest: latestLoraReadyManifest?.artifactPath ?? null,
      benchmarkManifest: latestBenchmarkManifest?.artifactPath ?? null,
      trainingExport: trainingExports.at(-1)?.outputs ?? null,
    },
    writePolicy: {
      readOnly: true,
      wroteWiki: false,
      wroteRaw: false,
      wroteBrain: false,
      wroteArtifacts: false,
    },
  }
}

function validateTrajectory(trajectory = {}) {
  const issues = []
  if (trajectory.schema !== STOCK_FEEDBACK_TRAJECTORY_SCHEMA) issues.push({ code: "unexpected_trajectory_schema", id: trajectory.id ?? null })
  if (!STOCK_FEEDBACK_VALIDATION_TARGETS.includes(trajectory.validationTarget)) issues.push({ code: "invalid_validation_target", id: trajectory.id ?? null, validationTarget: trajectory.validationTarget ?? null })
  const gate = trajectory.qualityGate?.status
  if (!STOCK_FEEDBACK_QUALITY_GATES.includes(gate)) issues.push({ code: "invalid_quality_gate", id: trajectory.id ?? null, qualityGate: gate ?? null })
  if (trajectory.qualityGate?.highConfidenceEligible === true && trajectory.qualityGate?.validationTarget !== trajectory.validationTarget) {
    issues.push({ code: "high_confidence_missing_target_binding", id: trajectory.id ?? null })
  }
  if (gate === "fundamental_validated" && trajectory.evidenceState?.fundamentalEvidenceConfirmed !== true) {
    issues.push({ code: "fundamental_validated_without_fundamental_evidence", id: trajectory.id ?? null })
  }
  if (gate === "expectation_validated" && trajectory.validationTarget !== "expectation_trade") {
    issues.push({ code: "expectation_gate_on_wrong_target", id: trajectory.id ?? null })
  }
  return issues
}

function hasRawFactLeak(value, trail = []) {
  if (!value || typeof value !== "object") return null
  for (const [key, child] of Object.entries(value)) {
    const nextTrail = [...trail, key]
    const keyToken = normalizeToken(key)
    const keySnake = String(key ?? "")
      .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
      .trim()
      .toLowerCase()
      .replace(/-/g, "_")
    if (["raw", "raw_fact_body", "raw_body", "source_text", "full_text", "content", "body"].includes(keyToken) ||
      ["raw", "raw_fact_body", "raw_body", "source_text", "full_text", "content", "body"].includes(keySnake)) {
      const length = typeof child === "string" ? child.length : JSON.stringify(child ?? "").length
      if (length > 500) return { path: nextTrail.join("."), length }
    }
    if (child && typeof child === "object") {
      const nested = hasRawFactLeak(child, nextTrail)
      if (nested) return nested
    }
  }
  return null
}

function validateLoraReadyManifest(manifest = {}) {
  const issues = []
  if (manifest.schema !== STOCK_FEEDBACK_LORA_READY_MANIFEST_SCHEMA) return issues
  const leak = hasRawFactLeak(manifest)
  if (leak) issues.push({ severity: "error", code: "lora_ready_manifest_contains_raw_fact_body", id: manifest.artifactPath ?? null, ...leak })
  if (manifest.modelTrainingStarted === true || manifest.peftBoundary?.modelTrainingStarted === true) {
    issues.push({
      severity: "error",
      code: "lora_ready_manifest_model_training_started",
      id: manifest.artifactPath ?? null,
    })
  }
  if (manifest.storesRawFacts === true || manifest.peftBoundary?.storesRawFacts === true) {
    issues.push({
      severity: "error",
      code: "lora_ready_manifest_stores_raw_facts",
      id: manifest.artifactPath ?? null,
    })
  }
  const adapterBatchRecipe = manifest.adapterBatchRecipe
  if (adapterBatchRecipe?.modelTrainingStarted === true) {
    issues.push({
      severity: "error",
      code: "lora_ready_adapter_batch_model_training_started",
      id: manifest.artifactPath ?? null,
    })
  }
  if (adapterBatchRecipe?.storesRawFacts === true) {
    issues.push({
      severity: "error",
      code: "lora_ready_adapter_batch_stores_raw_facts",
      id: manifest.artifactPath ?? null,
    })
  }
  if (adapterBatchRecipe?.peftBoundary?.modelTrainingStarted === true) {
    issues.push({
      severity: "error",
      code: "lora_ready_adapter_batch_peft_boundary_model_training_started",
      id: manifest.artifactPath ?? null,
    })
  }
  if (adapterBatchRecipe?.peftBoundary?.storesRawFacts === true) {
    issues.push({
      severity: "error",
      code: "lora_ready_adapter_batch_peft_boundary_stores_raw_facts",
      id: manifest.artifactPath ?? null,
    })
  }
  issues.push(...validatePeftBoundaryAdapterStores(manifest.peftBoundary, {
    id: manifest.artifactPath ?? null,
    codePrefix: "lora_ready_manifest_peft_boundary",
  }))
  issues.push(...validatePeftBoundaryAdapterStores(adapterBatchRecipe?.peftBoundary, {
    id: manifest.artifactPath ?? null,
    codePrefix: "lora_ready_adapter_batch_peft_boundary",
  }))
  const discretionaryReviewCurricula = [
    ["paperTradeDiscretionaryReviewCurriculum", manifest.paperTradeDiscretionaryReviewCurriculum],
    ["adapterCurriculum.paperTradeDiscretionaryReview", manifest.adapterCurriculum?.paperTradeDiscretionaryReview],
  ].filter(([, curriculum]) => Boolean(curriculum))
  for (const [location, curriculum] of discretionaryReviewCurricula) {
    issues.push(...validatePaperTradeDiscretionaryReviewCurriculum(curriculum, {
      id: manifest.artifactPath ?? null,
      location,
    }))
  }
  issues.push(...validateLoraReadyPaperCandidateRefs(manifest, { id: manifest.artifactPath ?? null }))
  const delta = manifest.batchRefreshDelta
  if (!delta) return issues
  const movements = Array.isArray(delta.movements) ? delta.movements : []
  const movementIndex = delta.movementIndex && typeof delta.movementIndex === "object" && !Array.isArray(delta.movementIndex)
    ? delta.movementIndex
    : null
  const expectedIndex = buildLoraRefreshMovementIndex(movements)
  if (movements.length > 0 && !movementIndex) {
    issues.push({
      severity: "error",
      code: "lora_ready_batch_delta_missing_movement_index",
      id: manifest.artifactPath ?? null,
    })
    return issues
  }
  for (const [sourceTrajectoryId, expected] of Object.entries(expectedIndex)) {
    const actual = movementIndex?.[sourceTrajectoryId]
    if (!actual) {
      issues.push({
        severity: "error",
        code: "lora_ready_batch_delta_missing_movement_index_entry",
        id: manifest.artifactPath ?? null,
        sourceTrajectoryId,
      })
      continue
    }
    if (!loraRefreshMovementEqual(actual, expected)) {
      issues.push({
        severity: "error",
        code: "lora_ready_batch_delta_movement_index_entry_mismatch",
        id: manifest.artifactPath ?? null,
        sourceTrajectoryId,
      })
    }
  }
  for (const sourceTrajectoryId of Object.keys(movementIndex ?? {})) {
    if (!expectedIndex[sourceTrajectoryId]) {
      issues.push({
        severity: "error",
        code: "lora_ready_batch_delta_orphan_movement_index_entry",
        id: manifest.artifactPath ?? null,
        sourceTrajectoryId,
      })
    }
  }
  return issues
}

const LORA_READY_REF_LOCKED_FIELDS = [
  "paperTradeId",
  "sourceTrajectoryId",
  "sourceKind",
  "adapterCapability",
  "validationTarget",
  "trainingWeightState",
  "effectiveWeightMultiplier",
]

function loraReadyAdapterCandidateRecordRef(candidate = {}) {
  return {
    paperTradeId: candidate.references?.paperTradeId ?? candidate.paperTradeId ?? null,
    sourceTrajectoryId: candidate.sourceTrajectoryId ?? null,
    sourceKind: candidate.sourceKind ?? null,
    adapterCapability: candidate.adapterCapability ?? null,
    validationTarget: candidate.validationTarget ?? null,
    trainingWeightState: candidate.trainingWeightDecision?.state ?? null,
    effectiveWeightMultiplier: candidate.trainingWeightDecision?.effectiveWeightMultiplier ?? null,
  }
}

function pushLoraReadyRefMismatches(issues, {
  actualRef = {},
  expectedRef = {},
  code,
  id,
  bucketId = null,
}) {
  for (const field of LORA_READY_REF_LOCKED_FIELDS) {
    if (actualRef[field] === undefined || Object.is(actualRef[field], expectedRef[field])) continue
    issues.push({
      severity: "error",
      code,
      id,
      bucketId,
      candidateId: actualRef.id ?? null,
      field,
      expectedValue: expectedRef[field] ?? null,
      actualValue: actualRef[field] ?? null,
    })
  }
}

function validateLoraReadyManifestCandidateRecords(manifest = {}, candidateById = new Map()) {
  const issues = []
  if (manifest.schema !== STOCK_FEEDBACK_LORA_READY_MANIFEST_SCHEMA) return issues
  const seenCandidateIds = new Set()
  for (const ref of Array.isArray(manifest.candidateRefs) ? manifest.candidateRefs : []) {
    if (!ref?.id) continue
    if (seenCandidateIds.has(ref.id)) {
      issues.push({
        severity: "error",
        code: "lora_ready_manifest_duplicate_candidate_ref",
        id: manifest.artifactPath ?? null,
        candidateId: ref.id,
      })
      continue
    }
    seenCandidateIds.add(ref.id)
    const candidate = candidateById.get(ref.id)
    if (!candidate) {
      issues.push({
        severity: "error",
        code: "lora_ready_manifest_candidate_ref_missing_record",
        id: manifest.artifactPath ?? null,
        candidateId: ref.id,
        sourceTrajectoryId: ref.sourceTrajectoryId ?? null,
      })
      continue
    }
    pushLoraReadyRefMismatches(issues, {
      actualRef: ref,
      expectedRef: loraReadyAdapterCandidateRecordRef(candidate),
      code: "lora_ready_manifest_candidate_ref_record_mismatch",
      id: manifest.artifactPath ?? null,
    })
  }
  return issues
}

function loraReadyCandidateArtifactPathForManifest(manifest = {}) {
  const artifactPath = manifest.artifactPath
  if (!artifactPath || !artifactPath.endsWith(".manifest.json")) return null
  return `${artifactPath.slice(0, -".manifest.json".length)}.jsonl`
}

function loraReadyCandidateMapForManifest(candidates = [], manifest = {}) {
  const candidateArtifactPath = loraReadyCandidateArtifactPathForManifest(manifest)
  const scopedCandidates = candidateArtifactPath
    ? candidates.filter((candidate) => candidate.artifactPath === candidateArtifactPath)
    : candidates
  return new Map(scopedCandidates.map((candidate) => [candidate.id, candidate]).filter(([id]) => Boolean(id)))
}

function validateLoraReadyCandidateRecordUniqueness(candidates = []) {
  const issues = []
  const seenByArtifactAndId = new Map()
  for (const candidate of candidates) {
    if (!candidate?.id) continue
    const key = `${candidate.artifactPath ?? "unknown"}:${candidate.id}`
    const previous = seenByArtifactAndId.get(key)
    if (previous) {
      issues.push({
        severity: "error",
        code: "lora_ready_candidate_duplicate_record_id",
        id: candidate.id,
        candidateId: candidate.id,
        artifactPath: candidate.artifactPath ?? null,
        firstLine: previous.artifactLine ?? null,
        duplicateLine: candidate.artifactLine ?? null,
      })
      continue
    }
    seenByArtifactAndId.set(key, candidate)
  }
  return issues
}

function adapterBatchBucketRefCount(bucket = {}) {
  const keys = new Set()
  let anonymousCount = 0
  for (const id of Array.isArray(bucket.candidateIds) ? bucket.candidateIds : []) {
    if (id) keys.add(`id:${id}`)
  }
  for (const ref of Array.isArray(bucket.candidateRefs) ? bucket.candidateRefs : []) {
    const key = ref?.id ? `id:${ref.id}` : (ref?.paperTradeId ? `paper:${ref.paperTradeId}` : null)
    if (key) keys.add(key)
    else anonymousCount += 1
  }
  return keys.size + anonymousCount
}

function adapterBatchCandidateRefKey(ref = {}) {
  if (ref?.id) return `id:${ref.id}`
  if (ref?.paperTradeId) return `paper:${ref.paperTradeId}`
  return null
}

function adapterBatchResolvedWeightByKey(recipe = {}) {
  const weightByKey = new Map()
  for (const bucket of Array.isArray(recipe.buckets) ? recipe.buckets : []) {
    const bucketWeight = finiteNumber(bucket.effectiveWeightMultiplier)
    for (const candidateId of Array.isArray(bucket.candidateIds) ? bucket.candidateIds : []) {
      if (candidateId && bucketWeight !== null) weightByKey.set(`id:${candidateId}`, bucketWeight)
    }
    for (const ref of Array.isArray(bucket.candidateRefs) ? bucket.candidateRefs : []) {
      const key = adapterBatchCandidateRefKey(ref)
      if (!key) continue
      const refWeight = finiteNumber(ref.effectiveWeightMultiplier)
      const resolvedWeight = refWeight !== null ? refWeight : bucketWeight
      if (resolvedWeight !== null) weightByKey.set(key, resolvedWeight)
    }
  }
  return weightByKey
}

function adapterBatchRoundWeight(value) {
  return Number(value.toFixed(2))
}

function adapterBatchResolvedWeightForRef(ref = {}, weightByKey = null, fallbackWeight = null) {
  const refWeight = finiteNumber(ref?.effectiveWeightMultiplier)
  if (refWeight !== null) return refWeight
  const key = adapterBatchCandidateRefKey(ref)
  const routedWeight = key && weightByKey ? finiteNumber(weightByKey.get(key)) : null
  if (routedWeight !== null) return routedWeight
  return finiteNumber(fallbackWeight)
}

function adapterBatchManifestRefByKey(candidateRefs = []) {
  return new Map(
    candidateRefs
      .map((ref) => [adapterBatchCandidateRefKey(ref), ref])
      .filter(([key]) => Boolean(key)),
  )
}

function adapterBatchBucketTotalEffectiveWeight(bucket = {}, manifestRefByKey = new Map()) {
  const bucketWeight = finiteNumber(bucket.effectiveWeightMultiplier)
  const seen = new Set()
  let total = 0
  const add = (key, ref = {}) => {
    if (!key || seen.has(key)) return
    seen.add(key)
    const manifestRef = manifestRefByKey.get(key)
    const weight = adapterBatchResolvedWeightForRef(ref)
      ?? adapterBatchResolvedWeightForRef(manifestRef)
      ?? bucketWeight
    if (typeof weight === "number") total += weight
  }
  for (const candidateId of Array.isArray(bucket.candidateIds) ? bucket.candidateIds : []) {
    add(candidateId ? `id:${candidateId}` : null)
  }
  for (const ref of Array.isArray(bucket.candidateRefs) ? bucket.candidateRefs : []) {
    add(adapterBatchCandidateRefKey(ref), ref)
  }
  return adapterBatchRoundWeight(total)
}

function validateLoraReadyManifestCounts(manifest = {}) {
  const issues = []
  if (manifest.schema !== STOCK_FEEDBACK_LORA_READY_MANIFEST_SCHEMA) return issues
  const candidateRefs = Array.isArray(manifest.candidateRefs) ? manifest.candidateRefs : []
  const refCount = candidateRefs.length
  const manifestCount = finiteNumber(manifest.count)
  if (manifestCount === null || manifestCount !== refCount) {
    issues.push({
      severity: "error",
      code: "lora_ready_manifest_count_mismatch",
      id: manifest.artifactPath ?? null,
      count: manifest.count ?? null,
      candidateRefCount: refCount,
    })
  }
  const recipe = manifest.adapterBatchRecipe
  if (!recipe) return issues
  const recipeTotal = finiteNumber(recipe.totalCandidates)
  if (recipeTotal === null || recipeTotal !== refCount) {
    issues.push({
      severity: "error",
      code: "lora_ready_adapter_batch_total_mismatch",
      id: manifest.artifactPath ?? null,
      totalCandidates: recipe.totalCandidates ?? null,
      candidateRefCount: refCount,
    })
  }
  const weightedCount = finiteNumber(recipe.weightedCandidateCount)
  if (weightedCount !== null && weightedCount > refCount) {
    issues.push({
      severity: "error",
      code: "lora_ready_adapter_batch_weighted_count_exceeds_refs",
      id: manifest.artifactPath ?? null,
      weightedCandidateCount: recipe.weightedCandidateCount ?? null,
      candidateRefCount: refCount,
    })
  }
  if (weightedCount !== null) {
    const weightByKey = adapterBatchResolvedWeightByKey(recipe)
    const actualWeightedCount = candidateRefs.filter((ref) => {
      const directWeight = finiteNumber(ref?.effectiveWeightMultiplier)
      const key = adapterBatchCandidateRefKey(ref)
      const resolvedWeight = directWeight !== null ? directWeight : weightByKey.get(key)
      return typeof resolvedWeight === "number" && resolvedWeight > 0
    }).length
    if (weightedCount !== actualWeightedCount) {
      issues.push({
        severity: "error",
        code: "lora_ready_adapter_batch_weighted_count_mismatch",
        id: manifest.artifactPath ?? null,
        weightedCandidateCount: recipe.weightedCandidateCount ?? null,
        actualWeightedCandidateCount: actualWeightedCount,
      })
    }
  }
  const totalEffectiveWeight = finiteNumber(recipe.totalEffectiveWeight)
  if (totalEffectiveWeight !== null) {
    const weightByKey = adapterBatchResolvedWeightByKey(recipe)
    const actualTotalEffectiveWeight = adapterBatchRoundWeight(candidateRefs.reduce((sum, ref) => {
      const weight = adapterBatchResolvedWeightForRef(ref, weightByKey, null)
      return sum + (typeof weight === "number" ? weight : 0)
    }, 0))
    if (totalEffectiveWeight !== actualTotalEffectiveWeight) {
      issues.push({
        severity: "error",
        code: "lora_ready_adapter_batch_total_effective_weight_mismatch",
        id: manifest.artifactPath ?? null,
        totalEffectiveWeight: recipe.totalEffectiveWeight ?? null,
        actualTotalEffectiveWeight,
      })
    }
  }
  const manifestRefByKey = adapterBatchManifestRefByKey(candidateRefs)
  for (const bucket of Array.isArray(recipe.buckets) ? recipe.buckets : []) {
    const bucketCount = finiteNumber(bucket.count)
    const actualBucketRefCount = adapterBatchBucketRefCount(bucket)
    if (bucketCount !== null && bucketCount !== actualBucketRefCount) {
      issues.push({
        severity: "error",
        code: "lora_ready_adapter_batch_bucket_count_mismatch",
        id: manifest.artifactPath ?? null,
        bucketId: bucket.id ?? null,
        bucketCount: bucket.count ?? null,
        bucketRefCount: actualBucketRefCount,
      })
    }
    const bucketTotalEffectiveWeight = finiteNumber(bucket.totalEffectiveWeight)
    if (bucketTotalEffectiveWeight !== null) {
      const actualBucketTotalEffectiveWeight = adapterBatchBucketTotalEffectiveWeight(bucket, manifestRefByKey)
      if (bucketTotalEffectiveWeight !== actualBucketTotalEffectiveWeight) {
        issues.push({
          severity: "error",
          code: "lora_ready_adapter_batch_bucket_total_effective_weight_mismatch",
          id: manifest.artifactPath ?? null,
          bucketId: bucket.id ?? null,
          totalEffectiveWeight: bucket.totalEffectiveWeight ?? null,
          actualTotalEffectiveWeight: actualBucketTotalEffectiveWeight,
        })
      }
    }
  }
  return issues
}

function validateLoraReadyAdapterBatchMembership(manifest = {}) {
  const issues = []
  if (manifest.schema !== STOCK_FEEDBACK_LORA_READY_MANIFEST_SCHEMA) return issues
  const candidateRefs = Array.isArray(manifest.candidateRefs) ? manifest.candidateRefs : []
  const manifestCandidateIds = new Set(candidateRefs.map((ref) => ref?.id).filter(Boolean))
  const manifestPaperTradeIds = new Set(candidateRefs.map((ref) => ref?.paperTradeId).filter(Boolean))
  const manifestRefById = new Map(candidateRefs.map((ref) => [ref?.id, ref]).filter(([id]) => Boolean(id)))
  const recipeBuckets = Array.isArray(manifest.adapterBatchRecipe?.buckets) ? manifest.adapterBatchRecipe.buckets : []
  const candidateBucketByKey = new Map()
  for (const bucket of recipeBuckets) {
    const seenMissing = new Set()
    const bucketKeys = new Map()
    const reportMissing = (code, details) => {
      const key = `${code}:${details.candidateId ?? ""}:${details.paperTradeId ?? ""}:${details.field ?? ""}`
      if (seenMissing.has(key)) return
      seenMissing.add(key)
      issues.push({
        severity: "error",
        code,
        id: manifest.artifactPath ?? null,
        bucketId: bucket.id ?? null,
        ...details,
      })
    }
    const addBucketKey = (key, details) => {
      if (!key || bucketKeys.has(key)) return
      bucketKeys.set(key, details)
      const previousBucketId = candidateBucketByKey.get(key)
      if (previousBucketId && previousBucketId !== bucket.id) {
        issues.push({
          severity: "error",
          code: "lora_ready_adapter_batch_candidate_duplicate_bucket_ref",
          id: manifest.artifactPath ?? null,
          bucketId: bucket.id ?? null,
          previousBucketId,
          ...details,
        })
        return
      }
      candidateBucketByKey.set(key, bucket.id ?? "unknown")
    }
    for (const candidateId of Array.isArray(bucket.candidateIds) ? bucket.candidateIds : []) {
      if (candidateId) addBucketKey(`id:${candidateId}`, { candidateId })
      if (!candidateId || manifestCandidateIds.has(candidateId)) continue
      reportMissing("lora_ready_adapter_batch_candidate_missing_manifest_ref", { candidateId })
    }
    for (const ref of Array.isArray(bucket.candidateRefs) ? bucket.candidateRefs : []) {
      if (ref?.id) addBucketKey(`id:${ref.id}`, { candidateId: ref.id })
      else if (ref?.paperTradeId) addBucketKey(`paper:${ref.paperTradeId}`, { paperTradeId: ref.paperTradeId })
      if (ref?.id && !manifestCandidateIds.has(ref.id)) {
        reportMissing("lora_ready_adapter_batch_candidate_missing_manifest_ref", { candidateId: ref.id })
      }
      const manifestRef = ref?.id ? manifestRefById.get(ref.id) : null
      if (manifestRef) {
        pushLoraReadyRefMismatches(issues, {
          actualRef: ref,
          expectedRef: manifestRef,
          code: "lora_ready_adapter_batch_candidate_ref_mismatch",
          id: manifest.artifactPath ?? null,
          bucketId: bucket.id ?? null,
        })
      }
      if (!ref?.id && ref?.paperTradeId && !manifestPaperTradeIds.has(ref.paperTradeId)) {
        reportMissing("lora_ready_adapter_batch_paper_ref_missing_manifest_ref", { paperTradeId: ref.paperTradeId })
      }
    }
  }
  for (const ref of candidateRefs) {
    const key = adapterBatchCandidateRefKey(ref)
    if (!key || candidateBucketByKey.has(key)) continue
    issues.push({
      severity: "error",
      code: "lora_ready_adapter_batch_candidate_missing_bucket_ref",
      id: manifest.artifactPath ?? null,
      candidateId: ref.id ?? null,
      paperTradeId: ref.paperTradeId ?? null,
    })
  }
  return issues
}

function isLoraReadyPaperRef(ref = {}) {
  return Boolean(ref?.paperTradeId || ref?.sourceKind === "stock-feedback-paper-trade")
}

function hasLoraReadyPaperRefSettlementFields(ref = {}) {
  return Boolean(
    ref?.paperTradeId ||
    ref?.ledgerKind ||
    ref?.paperTradeStatus ||
    ref?.realizedPnlPct !== undefined ||
    ref?.maxDrawdownPct !== undefined ||
    ref?.holdingDays !== undefined
  )
}

function loraReadyPaperRefKey(ref = {}) {
  if (ref?.id) return `candidate:${ref.id}`
  if (ref?.paperTradeId) return `paper:${ref.paperTradeId}`
  return null
}

function validateLoraReadyPaperRef(ref = {}, issueBase = {}) {
  const issues = []
  const { codePrefix = "lora_ready_paper_ref", ...rest } = issueBase
  const base = { severity: "error", ...rest }
  if (ref.reviewed !== true) {
    issues.push({ ...base, code: `${codePrefix}_without_review`, candidateId: ref.id ?? null, paperTradeId: ref.paperTradeId ?? null })
  }
  if (ref.ledgerKind !== "paper_trade") {
    issues.push({
      ...base,
      code: `${codePrefix}_invalid_ledger_kind`,
      candidateId: ref.id ?? null,
      paperTradeId: ref.paperTradeId ?? null,
      ledgerKind: ref.ledgerKind ?? null,
    })
  }
  if (ref.paperTradeStatus !== "closed") {
    issues.push({
      ...base,
      code: `${codePrefix}_not_closed`,
      candidateId: ref.id ?? null,
      paperTradeId: ref.paperTradeId ?? null,
      paperTradeStatus: ref.paperTradeStatus ?? null,
    })
  }
  const realizedPnlPct = finiteNumber(ref.realizedPnlPct)
  if (ref.profitOutcome !== "profitable" || realizedPnlPct === null || realizedPnlPct <= 0) {
    issues.push({
      ...base,
      code: `${codePrefix}_not_profitable`,
      candidateId: ref.id ?? null,
      paperTradeId: ref.paperTradeId ?? null,
      profitOutcome: ref.profitOutcome ?? null,
      realizedPnlPct: ref.realizedPnlPct ?? null,
    })
  }
  if (finiteNumber(ref.maxDrawdownPct) === null || finiteNumber(ref.holdingDays) === null) {
    issues.push({
      ...base,
      code: `${codePrefix}_missing_settlement_metrics`,
      candidateId: ref.id ?? null,
      paperTradeId: ref.paperTradeId ?? null,
      maxDrawdownPct: ref.maxDrawdownPct ?? null,
      holdingDays: ref.holdingDays ?? null,
    })
  }
  if (ref.trainingWeightState !== "human_approved_paper_adapter_low_weight") {
    issues.push({
      ...base,
      code: `${codePrefix}_invalid_weight_state`,
      candidateId: ref.id ?? null,
      paperTradeId: ref.paperTradeId ?? null,
      trainingWeightState: ref.trainingWeightState ?? null,
    })
  }
  const weight = finiteNumber(ref.effectiveWeightMultiplier)
  if (weight === null || weight > 0.35) {
    issues.push({
      ...base,
      code: `${codePrefix}_weight_too_high`,
      candidateId: ref.id ?? null,
      paperTradeId: ref.paperTradeId ?? null,
      effectiveWeightMultiplier: ref.effectiveWeightMultiplier ?? null,
    })
  }
  return issues
}

function isLoraReadyPaperAdapterCandidate(candidate = {}) {
  return Boolean(
    candidate?.sourceKind === "stock-feedback-paper-trade" ||
    candidate?.references?.paperTradeId ||
    candidate?.paperTradeState?.ledgerKind === "paper_trade",
  )
}

function validateLoraReadyPaperAdapterCandidate(candidate = {}, issueBase = {}) {
  if (!isLoraReadyPaperAdapterCandidate(candidate)) return []
  return validateLoraReadyPaperRef({
    id: candidate.id ?? null,
    paperTradeId: candidate.references?.paperTradeId ?? candidate.paperTradeId ?? null,
    reviewed: candidate.reviewSignal?.reviewed === true,
    ledgerKind: candidate.paperTradeState?.ledgerKind ?? candidate.profitFeedback?.ledgerKind ?? null,
    paperTradeStatus: candidate.paperTradeState?.status ?? null,
    profitOutcome: candidate.profitFeedback?.outcome ?? null,
    realizedPnlPct: candidate.profitFeedback?.realizedPnlPct ?? null,
    maxDrawdownPct: candidate.profitFeedback?.maxDrawdownPct ?? null,
    holdingDays: candidate.profitFeedback?.holdingDays ?? null,
    trainingWeightState: candidate.trainingWeightDecision?.state ?? null,
    effectiveWeightMultiplier: candidate.trainingWeightDecision?.effectiveWeightMultiplier ?? null,
  }, {
    ...issueBase,
    codePrefix: "lora_ready_paper_candidate",
  })
}

function adapterBoundaryText(value) {
  if (Array.isArray(value)) return value.map((item) => String(item ?? "")).join(" ")
  if (value && typeof value === "object") return JSON.stringify(value)
  return String(value ?? "")
}

function adapterStoresRawFacts(adapterStoresText = "") {
  return /(raw[_\s-]?facts?|source[_\s-]?text|full[_\s-]?text|price[_\s-]?rows?|trade[_\s-]?records?|announcement|financial[_\s-]?reports?)/.test(adapterStoresText)
}

function adapterStoresFactMemory(adapterStoresText = "") {
  return /(single[_\s-]?stock[_\s-]?facts?|stock[_\s-]?facts?|fact[_\s-]?memory)/.test(adapterStoresText)
}

function validatePeftBoundaryAdapterStores(boundary = null, { id = null, codePrefix = "lora_ready_peft_boundary" } = {}) {
  const issues = []
  if (!boundary || typeof boundary !== "object") return issues
  const adapterStores = adapterBoundaryText(boundary.adapterStores).toLowerCase()
  if (adapterStoresRawFacts(adapterStores)) {
    issues.push({
      severity: "error",
      code: `${codePrefix}_adapter_stores_raw_facts`,
      id,
      adapterStores: boundary.adapterStores ?? null,
    })
  }
  if (adapterStoresFactMemory(adapterStores)) {
    issues.push({
      severity: "error",
      code: `${codePrefix}_adapter_stores_fact_memory`,
      id,
      adapterStores: boundary.adapterStores ?? null,
    })
  }
  return issues
}

function validateLoraReadyAdapterCandidateDecisionPolicy(candidate = {}, issueBase = {}) {
  const issues = []
  if (candidate.schema !== STOCK_FEEDBACK_ADAPTER_CANDIDATE_SCHEMA) return issues
  const base = { severity: "error", id: candidate.id ?? null, ...issueBase }
  const policy = candidate.decisionPolicy ?? {}
  if (policy.keepFactsInRetrieval !== true) {
    issues.push({
      ...base,
      code: "lora_ready_candidate_facts_not_kept_in_retrieval",
      keepFactsInRetrieval: policy.keepFactsInRetrieval ?? null,
    })
  }
  const adapterDoesNotStore = adapterBoundaryText(policy.adapterDoesNotStore).toLowerCase()
  if (!adapterDoesNotStore.includes("raw_fact") && !adapterDoesNotStore.includes("raw fact")) {
    issues.push({
      ...base,
      code: "lora_ready_candidate_missing_raw_fact_exclusion",
      adapterDoesNotStore: policy.adapterDoesNotStore ?? null,
    })
  }
  const adapterStores = adapterBoundaryText(policy.adapterStores).toLowerCase()
  if (adapterStoresRawFacts(adapterStores)) {
    issues.push({
      ...base,
      code: "lora_ready_candidate_adapter_stores_raw_facts",
      adapterStores: policy.adapterStores ?? null,
    })
  }
  if (adapterStoresFactMemory(adapterStores)) {
    issues.push({
      ...base,
      code: "lora_ready_candidate_adapter_stores_fact_memory",
      adapterStores: policy.adapterStores ?? null,
    })
  }
  return issues
}

function validateLoraReadyPaperCandidateRefs(manifest = {}, issueBase = {}) {
  const issues = []
  const base = { severity: "error", ...issueBase }
  const candidateRefs = Array.isArray(manifest.candidateRefs) ? manifest.candidateRefs : []
  const paperRefById = new Map()
  const validatedPaperRefKeys = new Set()
  for (const ref of candidateRefs) {
    if (!isLoraReadyPaperRef(ref)) continue
    if (!hasLoraReadyPaperRefSettlementFields(ref)) continue
    if (ref.id) paperRefById.set(ref.id, ref)
    const key = loraReadyPaperRefKey(ref)
    if (key) validatedPaperRefKeys.add(key)
    issues.push(...validateLoraReadyPaperRef(ref, base))
  }
  for (const bucket of manifest.adapterBatchRecipe?.buckets ?? []) {
    const bucketIds = new Set([
      ...(Array.isArray(bucket.candidateIds) ? bucket.candidateIds : []),
      ...(Array.isArray(bucket.candidateRefs) ? bucket.candidateRefs.map((ref) => ref?.id).filter(Boolean) : []),
    ])
    const bucketPaperRefs = []
    const seenBucketPaperRefs = new Set()
    const addBucketPaperRef = (ref) => {
      if (!ref) return
      const key = loraReadyPaperRefKey(ref)
      if (key && seenBucketPaperRefs.has(key)) return
      if (key) seenBucketPaperRefs.add(key)
      bucketPaperRefs.push(ref)
    }
    for (const ref of Array.isArray(bucket.candidateRefs) ? bucket.candidateRefs.filter((item) => isLoraReadyPaperRef(item) && hasLoraReadyPaperRefSettlementFields(item)) : []) {
      addBucketPaperRef(ref)
    }
    for (const id of bucketIds) addBucketPaperRef(paperRefById.get(id))
    if (!bucketPaperRefs.length) continue
    for (const ref of bucketPaperRefs) {
      const key = loraReadyPaperRefKey(ref)
      if (key && validatedPaperRefKeys.has(key)) continue
      if (key) validatedPaperRefKeys.add(key)
      issues.push(...validateLoraReadyPaperRef(ref, {
        ...base,
        location: "adapterBatchRecipe.bucket",
        bucketId: bucket.id ?? null,
      }))
    }
    const bucketWeight = finiteNumber(bucket.effectiveWeightMultiplier)
    if (bucket.id !== "human_approved_paper_adapter_low_weight" || bucketWeight === null || bucketWeight > 0.35) {
      for (const ref of bucketPaperRefs) {
        issues.push({
          ...base,
          code: "lora_ready_paper_ref_batch_bucket_not_low_weight",
          candidateId: ref.id ?? null,
          paperTradeId: ref.paperTradeId ?? null,
          bucketId: bucket.id ?? null,
          effectiveWeightMultiplier: bucket.effectiveWeightMultiplier ?? null,
        })
      }
    }
  }
  return issues
}

function validatePaperTradeDiscretionaryReviewCurriculum(curriculum = null, issueBase = {}) {
  const issues = []
  if (!curriculum) return issues
  const base = { severity: "error", ...issueBase }
  if (curriculum.schema !== "stock-feedback-paper-trade-discretionary-review-curriculum-v1") {
    issues.push({ ...base, code: "lora_ready_discretionary_review_invalid_schema", schema: curriculum.schema ?? null })
  }
  if (curriculum.highConfidenceEligible !== false) {
    issues.push({ ...base, code: "lora_ready_discretionary_review_high_confidence_enabled" })
  }
  const defaultRoute = Array.isArray(curriculum.defaultRoute) ? curriculum.defaultRoute : []
  if (!defaultRoute.includes("eval") || !defaultRoute.includes("preference")) {
    issues.push({ ...base, code: "lora_ready_discretionary_review_missing_eval_preference_route" })
  }
  if (defaultRoute.includes("adapter") || defaultRoute.includes("sft")) {
    issues.push({ ...base, code: "lora_ready_discretionary_review_direct_adapter_route" })
  }
  const groups = Array.isArray(curriculum.groups) ? curriculum.groups : []
  const underperformedGroup = groups.find((group) => group?.id === "paper_trade_discretionary_review_llm_underperformed")
  const underperformedTrainingUse = Array.isArray(underperformedGroup?.trainingUse) ? underperformedGroup.trainingUse : []
  if (!underperformedGroup || !underperformedTrainingUse.includes("negative")) {
    issues.push({ ...base, code: "lora_ready_discretionary_review_underperformed_missing_negative_route" })
  }
  const outperformedGroup = groups.find((group) => group?.id === "paper_trade_discretionary_review_llm_outperformed")
  const outperformedTrainingUse = Array.isArray(outperformedGroup?.trainingUse) ? outperformedGroup.trainingUse : []
  if (outperformedTrainingUse.includes("adapter") || outperformedTrainingUse.includes("sft")) {
    issues.push({ ...base, code: "lora_ready_discretionary_review_outperformed_direct_adapter_route" })
  }
  if (curriculum.policy?.paperTradeIsNotRealProfit !== true ||
    curriculum.policy?.requiresHumanReviewBeforeAdapter !== true) {
    issues.push({ ...base, code: "lora_ready_discretionary_review_promotes_paper_profit" })
  }
  if (curriculum.peftBoundary?.storesRawFacts !== false) {
    issues.push({ ...base, code: "lora_ready_discretionary_review_missing_peft_boundary" })
  }
  return issues
}

function validateProfitCreditBinding(item = {}, issueBase = {}) {
  const issues = []
  const { codePrefix = "profit_credit", ...base } = issueBase
  const targetProfitCredit = item.targetProfitCredit ?? item.suggestedFilters?.profitCredit ?? null
  if (!targetProfitCredit) return issues
  const allowed = STOCK_FEEDBACK_PROFIT_CREDIT_BUCKETS.map((bucket) => bucket.id)
  if (!allowed.includes(targetProfitCredit)) {
    issues.push({
      ...base,
      code: base.code ?? "invalid_profit_credit",
      id: item.id ?? null,
      targetProfitCredit,
    })
    return issues
  }
  const expectedTarget = validationTargetForProfitCredit(targetProfitCredit)
  if (item.validationTarget && item.validationTarget !== expectedTarget) {
    issues.push({
      ...base,
      code: `${codePrefix}_validation_target_mismatch`,
      id: item.id ?? null,
      targetProfitCredit,
      validationTarget: item.validationTarget,
      expectedValidationTarget: expectedTarget,
    })
  }
  if (item.suggestedFilters?.profitCredit && item.suggestedFilters.profitCredit !== targetProfitCredit) {
    issues.push({
      ...base,
      code: `${codePrefix}_suggested_filter_mismatch`,
      id: item.id ?? null,
      targetProfitCredit,
      suggestedProfitCredit: item.suggestedFilters.profitCredit,
    })
  }
  return issues
}

function validateEvidenceTaskArtifact(task = {}) {
  const issues = []
  if (task.schema !== STOCK_FEEDBACK_EVIDENCE_TASK_SCHEMA) issues.push({ code: "unexpected_evidence_task_schema", id: task.taskId ?? null })
  if (!STOCK_FEEDBACK_EVIDENCE_TASK_STATUSES.includes(task.status)) issues.push({ code: "invalid_evidence_task_status", id: task.taskId ?? null, status: task.status ?? null })
  if (!STOCK_FEEDBACK_EVIDENCE_TASK_SOURCES.includes(task.source)) issues.push({ code: "invalid_evidence_task_source", id: task.taskId ?? null, source: task.source ?? null })
  if (!STOCK_FEEDBACK_EVIDENCE_TASK_TYPES.includes(task.taskType)) issues.push({ code: "invalid_evidence_task_type", id: task.taskId ?? null, taskType: task.taskType ?? null })
  if (!compactString(task.stockCode, 32)) issues.push({ code: "evidence_task_missing_stock_code", id: task.taskId ?? null })
  if (!(task.targetFields ?? []).length) issues.push({ code: "evidence_task_missing_target_fields", id: task.taskId ?? null })
  if (task.evidenceBoundary?.noWikiWrite !== true || task.evidenceBoundary?.noRawWrite !== true || task.evidenceBoundary?.noTradeAction !== true) {
    issues.push({ code: "evidence_task_missing_boundary", id: task.taskId ?? null })
  }
  const leak = hasRawFactLeak(task)
  if (leak) issues.push({ code: "evidence_task_contains_raw_fact_body", id: task.taskId ?? null, ...leak })
  return issues
}

function validateEvidenceResultArtifact(result = {}) {
  const issues = []
  if (result.schema !== STOCK_FEEDBACK_EVIDENCE_RESULT_SCHEMA) issues.push({ code: "unexpected_evidence_result_schema", id: result.resultId ?? null })
  if (!STOCK_FEEDBACK_EVIDENCE_RESULT_STATUSES.includes(result.status)) issues.push({ code: "invalid_evidence_result_status", id: result.resultId ?? null, status: result.status ?? null })
  if (!result.taskId) issues.push({ code: "evidence_result_missing_task_id", id: result.resultId ?? null })
  if (!(result.evidenceRefs ?? []).length) issues.push({ code: "evidence_result_missing_evidence_refs", id: result.resultId ?? null })
  if (result.status === "completed" && result.humanGate?.status !== "auto_ready" && result.humanGate?.status !== "approved") {
    issues.push({ code: "completed_evidence_result_missing_human_gate", id: result.resultId ?? null, humanGate: result.humanGate?.status ?? null })
  }
  if (result.crossValidation?.conflictCount > 0 && result.status === "completed" && result.humanGate?.status !== "approved") {
    issues.push({ code: "conflicting_evidence_result_completed_without_review", id: result.resultId ?? null })
  }
  if (result.writePolicy?.wroteWiki || result.writePolicy?.wroteRaw || result.writePolicy?.wroteBrain) {
    issues.push({ code: "evidence_result_write_boundary_violation", id: result.resultId ?? null })
  }
  const leak = hasRawFactLeak(result)
  if (leak) issues.push({ code: "evidence_result_contains_raw_fact_body", id: result.resultId ?? null, ...leak })
  return issues
}

function validatePaperTradeAgentCandidate(candidate = {}) {
  const issues = []
  if (candidate.schema !== STOCK_FEEDBACK_PAPER_TRADE_AGENT_CANDIDATE_SCHEMA) issues.push({ code: "unexpected_paper_trade_agent_candidate_schema", id: candidate.id ?? null })
  if (!STOCK_FEEDBACK_PAPER_TRADE_TRACKS.includes(candidate.track)) issues.push({ code: "invalid_paper_trade_agent_track", id: candidate.id ?? null, track: candidate.track ?? null })
  if (candidate.ledgerKind !== "paper_trade") issues.push({ code: "paper_trade_agent_candidate_not_paper_ledger", id: candidate.id ?? null, ledgerKind: candidate.ledgerKind ?? null })
  if (!candidate.asOfDate || candidate.evidenceCutoff?.noFutureData !== true) issues.push({ code: "paper_trade_agent_missing_asof_cutoff", id: candidate.id ?? null, asOfDate: candidate.asOfDate ?? null })
  if (!candidate.entryPlan || !candidate.exitPlan || (!candidate.invalidationCondition && candidate.track === "llm_discretionary")) {
    issues.push({ code: "paper_trade_agent_missing_plan_fields", id: candidate.id ?? null })
  }
  if (!compactStringArray(candidate.sourceRefs, 20, 260).length) {
    issues.push({ code: "paper_trade_agent_missing_source_refs", id: candidate.id ?? null })
  }
  if (!compactStringArray(candidate.evidenceRefs, 30, 260).length && !compactStringArray(candidate.entryPlan?.evidenceRefs, 30, 260).length) {
    issues.push({ code: "paper_trade_agent_missing_evidence_refs", id: candidate.id ?? null })
  }
  if (!candidate.marketEvidenceRequest?.provider || !compactStringArray(candidate.marketEvidenceRequest?.fields, 12, 120).length) {
    issues.push({ code: "paper_trade_agent_missing_market_evidence_request", id: candidate.id ?? null })
  }
  const marketEvidenceFields = compactStringArray(candidate.marketEvidenceRequest?.fields, 12, 120)
  if (candidate.marketEvidenceRequest?.asOfDate && candidate.asOfDate && candidate.marketEvidenceRequest.asOfDate !== candidate.asOfDate) {
    issues.push({
      code: "paper_trade_agent_market_evidence_asof_mismatch",
      id: candidate.id ?? null,
      asOfDate: candidate.asOfDate ?? null,
      marketEvidenceAsOfDate: candidate.marketEvidenceRequest.asOfDate ?? null,
    })
  }
  const requiredMarketFields = ["entryPrice", "maxDrawdown", "followThrough", "relativeStrength", "turnoverChange"]
  const missingMarketFields = requiredMarketFields.filter((field) => !marketEvidenceFields.includes(field))
  if (marketEvidenceFields.length && missingMarketFields.length) {
    issues.push({
      code: "paper_trade_agent_incomplete_market_evidence_request",
      id: candidate.id ?? null,
      missingMarketFields,
    })
  }
  const missingRequiredFields = compactStringArray(candidate.readiness?.missingRequiredFields, 12, 80)
  if (missingRequiredFields.includes("entryPrice") && candidate.readiness?.status === "ready") {
    issues.push({
      code: "paper_trade_agent_ready_with_missing_entry_price",
      id: candidate.id ?? null,
      readinessStatus: candidate.readiness?.status ?? null,
    })
  }
  if (!missingRequiredFields.includes("entryPrice") && firstFiniteNumber(candidate.entryPlan?.price) === null) {
    issues.push({
      code: "paper_trade_agent_readiness_missing_entry_price_gap",
      id: candidate.id ?? null,
      readinessStatus: candidate.readiness?.status ?? null,
    })
  }
  const suggestedRecordCommand = String(candidate.suggestedRecordCommand ?? "")
  if (suggestedRecordCommand && !suggestedRecordCommand.includes("--entry-price")) {
    issues.push({ code: "paper_trade_agent_record_command_missing_entry_price", id: candidate.id ?? null })
  }
  if (suggestedRecordCommand && !suggestedRecordCommand.includes("--auto-market-evidence")) {
    issues.push({ code: "paper_trade_agent_record_command_missing_auto_market_evidence", id: candidate.id ?? null })
  }
  if (candidate.peftBoundary?.storesRawFacts !== false) issues.push({ code: "paper_trade_agent_missing_peft_boundary", id: candidate.id ?? null })
  const leak = hasRawFactLeak(candidate)
  if (leak) issues.push({ code: "paper_trade_agent_contains_raw_fact_body", id: candidate.id ?? null, ...leak })
  return issues
}

function validatePaperTradeAgentManifestCounts(manifest = null, candidates = []) {
  const issues = []
  if (!manifest) return issues
  const candidateCount = candidates.length
  const actualSummary = summarizePaperTradeAgentCandidates(candidates).counts
  const manifestCount = finiteNumber(manifest.count)
  if (manifestCount !== null && manifestCount !== candidateCount) {
    issues.push({
      code: "paper_trade_agent_manifest_count_mismatch",
      id: manifest.artifactPath ?? null,
      count: manifest.count ?? null,
      actualCount: candidateCount,
    })
  }
  const summaryTotal = finiteNumber(manifest.summary?.total)
  if (summaryTotal !== null && summaryTotal !== candidateCount) {
    issues.push({
      code: "paper_trade_agent_manifest_summary_total_mismatch",
      id: manifest.artifactPath ?? null,
      summaryTotal: manifest.summary?.total ?? null,
      actualCount: candidateCount,
    })
  }
  for (const field of ["ruleBaseline", "llmDiscretionary", "needsMarketPrice", "blocked", "fromTrajectory", "fromHypothesisFeedback"]) {
    const summaryCount = finiteNumber(manifest.summary?.[field])
    if (summaryCount !== null && summaryCount !== actualSummary[field]) {
      issues.push({
        code: "paper_trade_agent_manifest_summary_count_mismatch",
        id: manifest.artifactPath ?? null,
        field,
        summaryCount: manifest.summary?.[field] ?? null,
        actualCount: actualSummary[field],
      })
    }
  }
  return issues
}

function validateLoraReadyPaperTradeAgentCurriculum(curriculum = null, candidates = [], { id = null, location = "paperTradeAgentCurriculum" } = {}) {
  const issues = []
  if (!curriculum) return issues
  if (curriculum.schema !== "stock-feedback-paper-trade-agent-curriculum-v1") {
    issues.push({ severity: "error", code: "lora_ready_paper_trade_agent_curriculum_invalid_schema", id, location, schema: curriculum.schema ?? null })
    return issues
  }
  const expected = buildPaperTradeAgentCurriculumSummary(candidates)
  for (const field of ["total", "ruleBaseline", "llmDiscretionary", "needsMarketPrice", "blocked", "fromTrajectory", "fromHypothesisFeedback"]) {
    const count = finiteNumber(curriculum.counts?.[field])
    if (count !== null && count !== expected.counts[field]) {
      issues.push({
        severity: "error",
        code: "lora_ready_paper_trade_agent_curriculum_count_mismatch",
        id,
        location,
        field,
        count: curriculum.counts?.[field] ?? null,
        actualCount: expected.counts[field],
      })
    }
  }
  const expectedGroupCountById = new Map((expected.groups ?? []).map((group) => [group.id, group.count]))
  for (const group of Array.isArray(curriculum.groups) ? curriculum.groups : []) {
    if (!expectedGroupCountById.has(group?.id)) continue
    const count = finiteNumber(group.count)
    const actualCount = expectedGroupCountById.get(group.id)
    if (count !== null && count !== actualCount) {
      issues.push({
        severity: "error",
        code: "lora_ready_paper_trade_agent_curriculum_group_count_mismatch",
        id,
        location,
        groupId: group.id,
        count: group.count ?? null,
        actualCount,
      })
    }
  }
  return issues
}

function validateBenchmarkCase(caseItem = {}) {
  const issues = []
  if (caseItem.schema !== STOCK_VALIDATION_BENCHMARK_SCHEMA) {
    issues.push({ code: "unexpected_benchmark_case_schema", id: caseItem.id ?? null })
  }
  const leak = hasRawFactLeak(caseItem)
  if (leak) issues.push({ code: "benchmark_case_contains_raw_fact_body", id: caseItem.id ?? null, ...leak })
  if (caseItem.sourceKind === "paper_trade_agent_candidate") {
    const routeTo = Array.isArray(caseItem.expected?.routeTo) ? caseItem.expected.routeTo : []
    if (caseItem.expected?.highConfidenceEligible !== false) {
      issues.push({ code: "benchmark_paper_trade_agent_high_confidence_enabled", id: caseItem.id ?? null })
    }
    if (!routeTo.includes("eval") || !routeTo.includes("paper_trade_agent")) {
      issues.push({ code: "benchmark_paper_trade_agent_missing_eval_route", id: caseItem.id ?? null })
    }
    if (routeTo.includes("adapter") || routeTo.includes("sft")) {
      issues.push({ code: "benchmark_paper_trade_agent_direct_adapter_route", id: caseItem.id ?? null })
    }
    if (caseItem.expected?.profitOutcome !== "pending_settlement") {
      issues.push({
        code: "benchmark_paper_trade_agent_unsettled_profit_outcome",
        id: caseItem.id ?? null,
        profitOutcome: caseItem.expected?.profitOutcome ?? null,
      })
    }
    if (!caseItem.paperTradeAgentCandidateId) {
      issues.push({ code: "benchmark_paper_trade_agent_missing_candidate_id", id: caseItem.id ?? null })
    }
    if (caseItem.expected?.evidenceCutoff?.noFutureData !== true) {
      issues.push({ code: "benchmark_paper_trade_agent_missing_asof_cutoff", id: caseItem.id ?? null })
    }
    if (!STOCK_FEEDBACK_PAPER_TRADE_TRACKS.includes(caseItem.expected?.paperTradeAgentTrack)) {
      issues.push({
        code: "benchmark_paper_trade_agent_invalid_track",
        id: caseItem.id ?? null,
        track: caseItem.expected?.paperTradeAgentTrack ?? null,
      })
    }
    return issues
  }
  if (caseItem.sourceKind !== "paper_trade_discretionary_review") return issues

  const routeTo = Array.isArray(caseItem.expected?.routeTo) ? caseItem.expected.routeTo : []
  if (caseItem.expected?.highConfidenceEligible !== false) {
    issues.push({ code: "benchmark_discretionary_review_high_confidence_enabled", id: caseItem.id ?? null })
  }
  if (!routeTo.includes("eval") || !routeTo.includes("preference")) {
    issues.push({ code: "benchmark_discretionary_review_missing_eval_preference_route", id: caseItem.id ?? null })
  }
  if (routeTo.includes("adapter") || routeTo.includes("sft")) {
    issues.push({ code: "benchmark_discretionary_review_direct_adapter_route", id: caseItem.id ?? null })
  }
  if (!caseItem.paperTradeId || !caseItem.pairedRuleBaselineTradeId) {
    issues.push({
      code: "benchmark_discretionary_review_missing_paired_rule_baseline",
      id: caseItem.id ?? null,
      paperTradeId: caseItem.paperTradeId ?? null,
      pairedRuleBaselineTradeId: caseItem.pairedRuleBaselineTradeId ?? null,
    })
  }
  if (caseItem.expected?.paperTrade !== "closed" || caseItem.expected?.pairedRuleBaselineStatus !== "closed") {
    issues.push({
      code: "benchmark_discretionary_review_requires_closed_pair",
      id: caseItem.id ?? null,
      paperTrade: caseItem.expected?.paperTrade ?? null,
      pairedRuleBaselineStatus: caseItem.expected?.pairedRuleBaselineStatus ?? null,
    })
  }
  if (caseItem.expected?.evidenceCutoff?.noFutureData !== true) {
    issues.push({ code: "benchmark_discretionary_review_missing_asof_cutoff", id: caseItem.id ?? null })
  }
  if (!(caseItem.sourceRefs ?? []).length) {
    issues.push({ code: "benchmark_discretionary_review_missing_source_refs", id: caseItem.id ?? null })
  }
  return issues
}

export async function verifyStockFeedbackArtifacts(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const trajectories = await readStockFeedbackTrajectories(projectPath)
  const benchmarks = await readStockFeedbackJsonlFamily(projectPath, "benchmark", STOCK_VALIDATION_BENCHMARK_SCHEMA)
  const candidates = await readStockFeedbackJsonlFamily(projectPath, "exports", STOCK_FEEDBACK_ADAPTER_CANDIDATE_SCHEMA)
  const loraReadyManifests = (await readStockFeedbackManifestFamily(projectPath, "exports"))
    .filter((item) => item.schema === STOCK_FEEDBACK_LORA_READY_MANIFEST_SCHEMA)
  const reviewEvents = await readStockFeedbackReviewEvents(projectPath)
  const collectionTaskDrafts = await readStockFeedbackCollectionTaskDrafts(projectPath)
  const collectionResults = await readStockFeedbackCollectionResults(projectPath)
  const executionResults = await readStockFeedbackExecutionResults(projectPath)
  const paperTrades = await readStockFeedbackPaperTrades(projectPath)
  const paperTradeAgentCandidates = await readStockFeedbackPaperTradeAgentCandidates(projectPath)
  const paperTradeAgentManifests = (await readStockFeedbackManifestFamily(projectPath, "paper-trade-agent"))
    .filter((item) => item.schema === STOCK_FEEDBACK_PAPER_TRADE_AGENT_MANIFEST_SCHEMA)
  const evidenceTasks = latestEvidenceTaskStates(await readStockFeedbackEvidenceTaskEvents(projectPath))
  const evidenceResults = latestEvidenceResultStates(await readStockFeedbackEvidenceResultEvents(projectPath))
  const evidenceRuns = await readStockFeedbackEvidenceRunEvents(projectPath)
  const evidenceDlq = await readStockFeedbackEvidenceDlqEvents(projectPath)
  const latestLoraReadyManifest = latestManifestBySchema(loraReadyManifests, STOCK_FEEDBACK_LORA_READY_MANIFEST_SCHEMA)
  const issues = []
  if (trajectories.length === 0) issues.push({ severity: "warning", code: "no_stock_feedback_trajectories" })
  for (const trajectory of trajectories) {
    issues.push(...validateTrajectory(trajectory).map((issue) => ({ severity: "error", ...issue })))
  }
  for (const benchmarkCase of benchmarks) {
    issues.push(...validateBenchmarkCase(benchmarkCase).map((issue) => ({ severity: "error", ...issue })))
  }
  for (const candidate of candidates) {
    const leak = hasRawFactLeak(candidate)
    if (leak) issues.push({ severity: "error", code: "lora_ready_candidate_contains_raw_fact_body", id: candidate.id ?? null, ...leak })
    issues.push(...validateLoraReadyAdapterCandidateDecisionPolicy(candidate, { severity: "error", id: candidate.id ?? null }))
    issues.push(...validateLoraReadyPaperAdapterCandidate(candidate, { severity: "error", id: candidate.id ?? null }))
  }
  issues.push(...validateLoraReadyCandidateRecordUniqueness(candidates))
  for (const manifest of loraReadyManifests) {
    const candidateById = loraReadyCandidateMapForManifest(candidates, manifest)
    issues.push(...validateLoraReadyManifest(manifest))
    issues.push(...validateLoraReadyManifestCandidateRecords(manifest, candidateById))
    issues.push(...validateLoraReadyManifestCounts(manifest))
    issues.push(...validateLoraReadyAdapterBatchMembership(manifest))
    if (manifest === latestLoraReadyManifest) {
      issues.push(...validateLoraReadyPaperTradeAgentCurriculum(manifest.paperTradeAgentCurriculum, paperTradeAgentCandidates, {
        id: manifest.artifactPath ?? null,
        location: "paperTradeAgentCurriculum",
      }))
      issues.push(...validateLoraReadyPaperTradeAgentCurriculum(manifest.adapterCurriculum?.paperTradeAgent, paperTradeAgentCandidates, {
        id: manifest.artifactPath ?? null,
        location: "adapterCurriculum.paperTradeAgent",
      }))
    }
  }
  const trajectoryIds = new Set(trajectories.map((item) => item.id).filter(Boolean))
  for (const event of reviewEvents) {
    if (event.schema !== STOCK_FEEDBACK_REVIEW_EVENT_SCHEMA) issues.push({ severity: "error", code: "unexpected_review_event_schema", id: event.id ?? null })
    if (!STOCK_FEEDBACK_REVIEW_ACTIONS.includes(event.action)) issues.push({ severity: "error", code: "invalid_review_action", id: event.id ?? null, action: event.action ?? null })
    if (trajectoryIds.size > 0 && !trajectoryIds.has(event.sourceTrajectoryId)) {
      issues.push({ severity: "warning", code: "review_event_missing_source_trajectory", id: event.id ?? null, sourceTrajectoryId: event.sourceTrajectoryId ?? null })
    }
    const leak = hasRawFactLeak(event)
    if (leak) issues.push({ severity: "error", code: "review_event_contains_raw_fact_body", id: event.id ?? null, ...leak })
  }
  for (const draft of collectionTaskDrafts) {
    if (draft.schema !== STOCK_FEEDBACK_COLLECTION_TASK_DRAFT_SCHEMA) issues.push({ severity: "error", code: "unexpected_collection_task_draft_schema", id: draft.id ?? null })
    if (draft.peftBoundary?.storesRawFacts !== false) issues.push({ severity: "error", code: "collection_task_missing_peft_boundary", id: draft.id ?? null })
    issues.push(...validateProfitCreditBinding(draft, { severity: "error", code: "invalid_collection_task_profit_credit", codePrefix: "collection_task_profit_credit" }))
    const leak = hasRawFactLeak(draft)
    if (leak) issues.push({ severity: "error", code: "collection_task_contains_raw_fact_body", id: draft.id ?? null, ...leak })
  }
  for (const result of collectionResults) {
    if (result.schema !== STOCK_FEEDBACK_COLLECTION_RESULT_SCHEMA) issues.push({ severity: "error", code: "unexpected_collection_result_schema", id: result.id ?? null })
    if (!STOCK_FEEDBACK_COLLECTION_RESULTS.includes(result.result)) issues.push({ severity: "error", code: "invalid_collection_result", id: result.id ?? null, result: result.result ?? null })
    if (result.result === "confirmed" && (result.evidenceRefs ?? []).length === 0) issues.push({ severity: "error", code: "confirmed_collection_result_without_evidence_refs", id: result.id ?? null })
    if (result.peftBoundary?.storesRawFacts !== false) issues.push({ severity: "error", code: "collection_result_missing_peft_boundary", id: result.id ?? null })
    issues.push(...validateProfitCreditBinding(result, { severity: "error", code: "invalid_collection_result_profit_credit", codePrefix: "collection_result_profit_credit" }))
    const leak = hasRawFactLeak(result)
    if (leak) issues.push({ severity: "error", code: "collection_result_contains_raw_fact_body", id: result.id ?? null, ...leak })
  }
  for (const result of executionResults) {
    issues.push(...validateExecutionResultRecord(result))
  }
  for (const trade of paperTrades) {
    issues.push(...validatePaperTrade(trade).map((issue) => ({ severity: "error", ...issue })))
    if (trade.validationTarget && !STOCK_FEEDBACK_VALIDATION_TARGETS.includes(trade.validationTarget)) {
      issues.push({ severity: "error", code: "paper_trade_invalid_validation_target", id: trade.id ?? null, validationTarget: trade.validationTarget })
    }
    const leak = hasRawFactLeak(trade)
    if (leak) issues.push({ severity: "error", code: "paper_trade_contains_raw_fact_body", id: trade.id ?? null, ...leak })
  }
  for (const candidate of paperTradeAgentCandidates) {
    issues.push(...validatePaperTradeAgentCandidate(candidate).map((issue) => ({ severity: "error", ...issue })))
  }
  for (const manifest of paperTradeAgentManifests) {
    if (manifest.writeBoundary?.wroteWiki || manifest.writeBoundary?.wroteRaw || manifest.writeBoundary?.wroteBrain || manifest.writeBoundary?.wrotePaperTradeLedger || manifest.writeBoundary?.wroteRealTradeLedger) {
      issues.push({ severity: "error", code: "paper_trade_agent_manifest_boundary_violation", id: manifest.artifactPath ?? null })
    }
  }
  const latestPaperTradeAgentManifest = latestManifestBySchema(paperTradeAgentManifests, STOCK_FEEDBACK_PAPER_TRADE_AGENT_MANIFEST_SCHEMA)
  issues.push(...validatePaperTradeAgentManifestCounts(latestPaperTradeAgentManifest, paperTradeAgentCandidates).map((issue) => ({ severity: "error", ...issue })))
  const evidenceTaskIds = new Set(evidenceTasks.map((item) => item.taskId).filter(Boolean))
  for (const task of evidenceTasks) {
    issues.push(...validateEvidenceTaskArtifact(task).map((issue) => ({ severity: "error", ...issue })))
  }
  for (const result of evidenceResults) {
    issues.push(...validateEvidenceResultArtifact(result).map((issue) => ({ severity: "error", ...issue })))
    if (evidenceTaskIds.size > 0 && !evidenceTaskIds.has(result.taskId)) {
      issues.push({ severity: "warning", code: "evidence_result_missing_source_task", id: result.resultId ?? null, taskId: result.taskId ?? null })
    }
  }
  for (const run of evidenceRuns) {
    if (run.schema !== STOCK_FEEDBACK_EVIDENCE_RUN_SCHEMA) issues.push({ severity: "error", code: "unexpected_evidence_run_schema", id: run.runId ?? null })
    if (run.writeBoundary?.wroteWiki || run.writeBoundary?.wroteRaw || run.writeBoundary?.wroteBrain) {
      issues.push({ severity: "error", code: "evidence_run_write_boundary_violation", id: run.runId ?? null })
    }
  }
  for (const dlq of evidenceDlq) {
    if (dlq.schema !== STOCK_FEEDBACK_EVIDENCE_DLQ_SCHEMA) issues.push({ severity: "error", code: "unexpected_evidence_dlq_schema", id: dlq.id ?? null })
    if (!dlq.taskId) issues.push({ severity: "error", code: "evidence_dlq_missing_task_id", id: dlq.id ?? null })
    if (!STOCK_FEEDBACK_EVIDENCE_DLQ_STATUSES.includes(dlq.status)) issues.push({ severity: "error", code: "invalid_evidence_dlq_status", id: dlq.id ?? null, status: dlq.status ?? null })
    if (dlq.writeBoundary?.wroteWiki || dlq.writeBoundary?.wroteRaw || dlq.writeBoundary?.wroteBrain) {
      issues.push({ severity: "error", code: "evidence_dlq_write_boundary_violation", id: dlq.id ?? null })
    }
  }
  const benchmarkTargets = new Set(benchmarks.map((item) => item.validationTarget).filter(Boolean))
  for (const target of new Set(trajectories.map((item) => item.validationTarget))) {
    if (!benchmarkTargets.has(target) && benchmarks.length > 0) {
      issues.push({ severity: "warning", code: "benchmark_missing_target", validationTarget: target })
    }
  }
  const errorCount = issues.filter((item) => item.severity === "error").length
  return {
    schema: "stock-feedback-verify-result-v1",
    mode: "stock-feedback-verify",
    projectPath,
    status: errorCount > 0 ? "failed" : "ok",
    checked: {
      trajectories: trajectories.length,
      benchmarks: benchmarks.length,
      loraReadyCandidates: candidates.length,
      loraReadyManifests: loraReadyManifests.length,
      reviewEvents: reviewEvents.length,
      collectionTaskDrafts: collectionTaskDrafts.length,
      collectionResults: collectionResults.length,
      executionResults: executionResults.length,
      paperTrades: paperTrades.length,
      paperTradeAgentCandidates: paperTradeAgentCandidates.length,
      paperTradeAgentManifests: paperTradeAgentManifests.length,
      evidenceTasks: evidenceTasks.length,
      evidenceResults: evidenceResults.length,
      evidenceRuns: evidenceRuns.length,
      evidenceDlq: evidenceDlq.length,
    },
    issueCount: issues.length,
    errorCount,
    issues,
  }
}
