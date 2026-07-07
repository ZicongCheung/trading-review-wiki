import fs from "node:fs/promises"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { parse as parseYaml } from "yaml"

import {
  DEFAULT_PROJECT_PATH,
  ensureDirectory,
  listFilesRecursive,
  normalizePath,
  nowLocalTimestamp,
  projectRelative,
  readIfExists,
  runProcessWithStdin,
  safeErrorMessage,
  sha256Hex,
  shortHash,
  writeJson,
} from "./core.mjs"
import { requestAgenticText } from "./ask-flow.mjs"
import { buildSourceIntegrityAudit } from "./source-integrity.mjs"
import { createStockFeedbackEvidenceTask } from "./stock-feedback.mjs"

export const HYPOTHESIS_LIBRARY_SCHEMA = "trading-hypothesis-v1"
export const HYPOTHESIS_EVENT_SCHEMA = "trading-hypothesis-event-v1"
export const HYPOTHESIS_REPORT_SCHEMA = "trading-hypothesis-report-v1"
export const HYPOTHESIS_VALIDATION_SCHEMA = "trading-hypothesis-validation-v1"
export const HYPOTHESIS_DISCOVERY_SCHEMA = "trading-hypothesis-discover-run-v1"
export const OBSERVATION_DRAFT_SCHEMA = "trading-observation-draft-v1"
export const HYPOTHESIS_EVIDENCE_FEEDBACK_SCHEMA = "trading-hypothesis-evidence-feedback-v1"
export const HYPOTHESIS_EVIDENCE_FEEDBACK_MANIFEST_SCHEMA = "trading-hypothesis-evidence-feedback-manifest-v1"
export const HYPOTHESIS_EVIDENCE_TASK_DRAFT_SCHEMA = "trading-hypothesis-evidence-task-draft-v1"
export const HYPOTHESIS_EVIDENCE_TASK_DRAFT_MANIFEST_SCHEMA = "trading-hypothesis-evidence-task-draft-manifest-v1"
export const HYPOTHESIS_EVIDENCE_LINK_DRAFT_SCHEMA = "trading-hypothesis-evidence-link-draft-v1"
export const HYPOTHESIS_EVIDENCE_LINK_DRAFT_MANIFEST_SCHEMA = "trading-hypothesis-evidence-link-draft-manifest-v1"
export const HYPOTHESIS_EVIDENCE_LINK_SCHEMA = "trading-hypothesis-evidence-link-v1"
export const HYPOTHESIS_EVIDENCE_LINK_MANIFEST_SCHEMA = "trading-hypothesis-evidence-link-manifest-v1"
export const HYPOTHESIS_POST_MORTEM_DRAFT_SCHEMA = "trading-hypothesis-post-mortem-draft-v1"
export const HYPOTHESIS_VERIFY_SCHEMA = "trading-hypothesis-engine-verify-v1"
const STOCK_FEEDBACK_TRAJECTORY_SCHEMA = "stock-feedback-trajectory-v1"

export const HYPOTHESIS_ROOT = ".llm-wiki/hypotheses"
export const HYPOTHESIS_EVENTS_ROOT = ".llm-wiki/hypothesis-events"
export const HYPOTHESIS_REPORTS_ROOT = ".llm-wiki/hypothesis-reports"
export const HYPOTHESIS_ALERTS_ROOT = ".llm-wiki/hypothesis-alerts"
export const HYPOTHESIS_DASHBOARD_ROOT = ".llm-wiki/hypothesis-dashboard"
export const HYPOTHESIS_SUPPLEMENTS_ROOT = ".llm-wiki/hypothesis-supplements"
export const HYPOTHESIS_EVIDENCE_FEEDBACK_ROOT = ".llm-wiki/hypothesis-evidence-feedback"
export const HYPOTHESIS_EVIDENCE_TASK_DRAFTS_ROOT = ".llm-wiki/hypothesis-evidence-task-drafts"
export const HYPOTHESIS_EVIDENCE_LINK_DRAFTS_ROOT = ".llm-wiki/hypothesis-evidence-link-drafts"
export const HYPOTHESIS_EVIDENCE_LINKS_ROOT = ".llm-wiki/hypothesis-evidence-links"
export const HYPOTHESIS_POST_MORTEMS_ROOT = ".llm-wiki/hypothesis-post-mortems"
export const OBSERVATION_DRAFTS_ROOT = ".llm-wiki/observation-drafts"
export const WECHAT_INCREMENT_SCHEMA = "wechat-increment-v1"
export const WECHAT_INCREMENT_PROCESSED_SCHEMA = "wechat-increment-processed-v1"
export const WECHAT_INCREMENT_PROCESS_RUN_SCHEMA = "wechat-increment-process-run-v1"
export const WECHAT_INBOX_ROOT = ".llm-wiki/wechat-inbox"
export const WECHAT_INBOX_INCOMING_ROOT = `${WECHAT_INBOX_ROOT}/incoming`
export const WECHAT_INBOX_PROCESSED_ROOT = `${WECHAT_INBOX_ROOT}/processed`
export const WECHAT_INBOX_STATE_PATH = `${WECHAT_INBOX_ROOT}/state.json`
export const WECHAT_RAW_CHAT_DEFAULT_SOURCE = "raw/微信聊天"

export const HYPOTHESIS_STATUSES = [
  "seed",
  "watching",
  "strengthening",
  "actionable",
  "priced_in",
  "divergent",
  "disconfirmed",
  "archived",
]

const HYPOTHESIS_STATUS_SET = new Set(HYPOTHESIS_STATUSES)
const HYPOTHESIS_STATUS_LABELS = {
  seed: "初始观察",
  watching: "观察中",
  strengthening: "证据增强",
  actionable: "接近可下注",
  priced_in: "市场可能已充分定价",
  divergent: "走势和假设背离",
  disconfirmed: "被证伪",
  archived: "归档",
}

const KNOWN_SEGMENTS = [
  "MPO",
  "CPO",
  "CCL",
  "PCB",
  "FAU",
  "光纤",
  "光缆",
  "特种光纤",
  "高速连接器",
  "连接器",
  "跳线",
  "光模块",
  "交换机",
  "AI服务器电源",
  "SST",
  "800V",
  "电子布",
  "玻璃基板",
  "TGV",
  "ABF",
  "覆铜板",
  "CCL",
  "铜箔",
  "PCB",
  "存储",
  "HBM",
  "DRAM",
  "MLCC",
  "服务器BOM",
]

const POSITIVE_EVIDENCE_PATTERNS = [
  /订单/,
  /中标/,
  /招投标/,
  /交付/,
  /客户/,
  /ASP|涨价|价格上行/,
  /收入确认|收入增长|毛利率/,
  /财报|公告|CNINFO|Tushare|企查查/i,
  /验证|兑现|confirmed/i,
]

const NEGATIVE_EVIDENCE_PATTERNS = [
  /放缓|下修|降价|砍单|延期|不及预期/,
  /风险|证伪|反证|divergent|disconfirmed|refuted/i,
]

const MARKET_PATTERNS = [/放量|缩量|换手|成交额|涨幅|跌幅|量价|market|stock|price/i]
const FUNDAMENTAL_PATTERNS = [/订单|中标|招投标|客户|交付|财报|公告|收入|毛利率|ASP|CNINFO|Tushare|企查查/i]
const FUNDAMENTAL_GAP_PATTERNS = [/没有.*(订单|公告|财报|闭环)/, /缺少.*(订单|公告|财报|ASP|客户)/, /缺.*(订单|公告|财报|ASP|客户)/, /(订单|公告|财报|ASP|客户).*不足/]
const HARD_FUNDAMENTAL_PATTERNS = [/订单|中标|招投标|重大合同|CNINFO|交易所公告|财报|收入确认|交付|出货|客户验证/i]
const CATALYST_PATTERNS = [
  /新催化|催化|事件驱动|新变量|新增变量/,
  /涨价函|提价函|调价函|涨价|提价|价格上调/,
  /台积电|TSMC/i,
  /玻璃基板|TGV|先进封装基板/i,
  /健滔|建滔|Kingboard/i,
  /供给收缩|停产|扩产|良率突破|导入|送样|认证/,
  /传闻|小作文|消息称|市场传/i,
]
const WEAK_AUTOWATCH_EVIDENCE_DELTAS = new Set(["catalyst_signal", "market_feedback", "narrative_expansion", "mixed_signal", "new_context"])
const WATCH_FILE_EXTENSIONS = new Set([".md", ".markdown", ".txt", ".json", ".jsonl"])
const ALERT_LEVEL_RANK = { info: 0, watch: 1, important: 2, urgent: 3 }
const DEFAULT_WECHAT_INCREMENT_HTTP_PORT = 19828
const DEFAULT_WECHAT_INCREMENT_MAX_BODY_BYTES = 256 * 1024
const WECHAT_INCREMENT_TEXT_MAX_CHARS = 12000
const WECHAT_RAW_CHAT_DEFAULT_LIMIT = 200
const WECHAT_RAW_CHAT_MAX_FILES = 40
const WECHAT_RAW_CHAT_EXTENSIONS = new Set([".md", ".markdown", ".txt", ".text", ".json", ".jsonl"])
const WIKI_INDUSTRY_TERM_FILE_LIMIT = 1200
const WIKI_INDUSTRY_TERM_LIMIT = 1200
const WIKI_RELATED_PAGE_FILE_LIMIT = 500
const WIKI_RELATED_PAGE_LIMIT = 3
const FINANCE_ENTITY_AUDIT_ROOT = ".llm-wiki/sag-entity-audit"
const FINANCE_ENTITY_AUDIT_TABLE_FILES = [
  "generalized-cleaned-entity-table.csv",
  "cleaned-entity-table.csv",
  "project-entity-table.csv",
  "entity-summary.csv",
]
const FINANCE_ENTITY_AUDIT_ROOT_ENV = "TRADING_WIKI_FINANCE_ENTITY_AUDIT_ROOTS"
const FINANCE_ENTITY_AUDIT_ROOT_ENV_LEGACY = "TRADING_WIKI_FINANCE_ENTITY_AUDIT_ROOT"
const FINANCE_ENTITY_AUDIT_DEFAULT_ROOT_ENV = "TRADING_WIKI_DEFAULT_FINANCE_ENTITY_AUDIT_ROOTS"
const DEFAULT_FINANCE_ENTITY_AUDIT_ROOTS = [
  "/Users/jiegege/Desktop/杰杰杰/.llm-wiki/sag-entity-audit",
]
const FINANCE_ENTITY_AUDIT_TERM_LIMIT = 3200
const FINANCE_ENTITY_AUDIT_SIGNAL_TERM_LIMIT = 16000
const FINANCE_ENTITY_AUDIT_TERMS_PER_PAGE = 36
const FINANCE_ENTITY_AUDIT_REPRESENTATIVE_PAGE_LIMIT = 600
const FINANCE_ENTITY_AUDIT_TYPE_TERM_LIMITS = new Map([
  ["catalyst", 280],
  ["company", 520],
  ["concept", 280],
  ["fund_flow", 120],
  ["index", 120],
  ["institution", 120],
  ["location", 120],
  ["market_regime", 220],
  ["metric", 220],
  ["person", 80],
  ["policy", 200],
  ["product_line", 620],
  ["risk_factor", 280],
  ["sector", 240],
  ["source", 120],
  ["stock", 520],
  ["tech_route", 360],
  ["theme", 240],
  ["time", 120],
  ["trade_pattern", 280],
])
const FINANCE_ENTITY_AUDIT_TYPES = new Set([
  "catalyst",
  "company",
  "concept",
  "fund_flow",
  "index",
  "institution",
  "location",
  "market_regime",
  "metric",
  "person",
  "policy",
  "product_line",
  "risk_factor",
  "sector",
  "source",
  "stock",
  "supply_chain_role",
  "tech_route",
  "theme",
  "time",
  "trade_pattern",
])
const SEARCHABLE_FINANCE_ENTITY_AUDIT_TYPES = new Set([
  "catalyst",
  "company",
  "concept",
  "fund_flow",
  "index",
  "market_regime",
  "metric",
  "policy",
  "product_line",
  "risk_factor",
  "sector",
  "stock",
  "supply_chain_role",
  "tech_route",
  "theme",
  "trade_pattern",
])
const FINANCE_ENTITY_AUDIT_TYPE_LABELS = new Map([
  ["catalyst", "催化"],
  ["company", "公司"],
  ["concept", "概念"],
  ["fund_flow", "资金行为"],
  ["index", "指数"],
  ["institution", "机构"],
  ["location", "地区"],
  ["market_regime", "市场状态"],
  ["metric", "指标"],
  ["person", "人物"],
  ["policy", "政策"],
  ["product_line", "产品线"],
  ["risk_factor", "风险因子"],
  ["sector", "板块"],
  ["source", "来源"],
  ["stock", "股票"],
  ["supply_chain_role", "产业链位置"],
  ["tech_route", "技术路线"],
  ["theme", "主题"],
  ["time", "时间"],
  ["trade_pattern", "交易模式"],
])
const STRONG_RELATED_FINANCE_ENTITY_TYPES = new Set([
  "company",
  "concept",
  "index",
  "product_line",
  "sector",
  "stock",
  "supply_chain_role",
  "tech_route",
  "theme",
])
const WEAK_SINGLE_RELATED_FINANCE_ENTITY_TYPES = new Set([
  "catalyst",
  "fund_flow",
  "market_regime",
  "metric",
  "policy",
  "risk_factor",
  "trade_pattern",
])
const SIGNAL_FINANCE_ENTITY_TYPES = new Set([
  "catalyst",
  "company",
  "concept",
  "fund_flow",
  "index",
  "institution",
  "market_regime",
  "metric",
  "policy",
  "product_line",
  "risk_factor",
  "sector",
  "stock",
  "supply_chain_role",
  "tech_route",
  "theme",
  "trade_pattern",
])
const SIGNAL_FINANCE_ENTITY_TYPE_RANK = new Map([
  ["stock", 0],
  ["company", 1],
  ["catalyst", 2],
  ["risk_factor", 3],
  ["trade_pattern", 4],
  ["product_line", 5],
  ["tech_route", 6],
  ["supply_chain_role", 7],
  ["sector", 8],
  ["theme", 9],
  ["concept", 10],
  ["market_regime", 11],
  ["metric", 12],
  ["fund_flow", 13],
  ["policy", 14],
  ["index", 15],
  ["institution", 16],
])
const SIGNAL_FINANCE_ENTITY_TYPE_LIMITS = new Map([
  ["stock", 4],
  ["company", 4],
  ["catalyst", 4],
  ["risk_factor", 3],
  ["trade_pattern", 3],
  ["product_line", 5],
  ["tech_route", 4],
  ["supply_chain_role", 3],
  ["sector", 2],
  ["theme", 2],
  ["concept", 2],
  ["market_regime", 2],
  ["metric", 2],
  ["fund_flow", 2],
  ["policy", 2],
  ["index", 2],
  ["institution", 2],
])
const GENERIC_SINGLE_RELATED_WIKI_TERMS = new Set([
  "IPO",
  "业绩",
  "中标",
  "交付",
  "价格函",
  "价格上调",
  "供给扰动",
  "供给收缩",
  "客户",
  "客户认证",
  "客户导入",
  "客户验证",
  "在手订单",
  "市场反馈",
  "批量订单",
  "招投标",
  "提价",
  "提价函",
  "涨价",
  "涨价函",
  "满产",
  "满产满销",
  "订单",
  "认证",
  "财报",
  "采购",
  "采购订单",
  "送样",
  "量价",
  "量价反馈",
  "长协",
])
const FINANCE_ENTITY_ENGLISH_STOPWORDS = new Set([
  "customer",
  "customers",
  "increase",
  "letter",
  "notice",
  "order",
  "orders",
  "price",
  "rating",
  "source",
  "sources",
  "supply",
  "system",
  "top",
  "trade",
])
const STRONG_SHORT_RELATED_WIKI_TERMS = new Set(["ABF", "BMI", "CCL", "CPO", "CW", "DRAM", "FAU", "HBM", "INP", "MLCC", "MPO", "NPO", "PCB", "PPO", "PTFE", "SST", "TGV"])
const RELATED_WIKI_TERM_STOPWORDS = new Set([
  "ASP",
  "LED",
  "公告",
  "财报",
  "产能",
  "出货",
  "导入",
  "供货",
  "价格",
  "交付",
  "客户",
  "量产",
  "毛利率",
  "认证",
  "收入",
  "送样",
  "提价",
  "涨价",
  "中标",
  "市场",
  "材料",
  "半导体",
  "芯片",
  "产业",
  "行业",
  "主题",
  "逻辑",
  "环节",
  "供应链",
  "位置",
  "选择",
  "预期",
  "弹性",
  "空间",
  "机会",
])
const INDUSTRY_TERM_STOPWORDS = new Set([
  "source",
  "sources",
  "index",
  "readme",
  "复盘",
  "每日复盘",
  "市场复盘",
  "今天",
  "昨日",
  "明日",
  "公告",
  "调研",
  "纪要",
  "验证",
  "跟踪",
  "更新",
  "总结",
  "建议",
  "关注",
  "重点",
  "领导",
  "来源",
  "代表来源",
  "原文数",
  "local_id",
  "id",
  "主线",
  "上游",
  "配套",
  "发酵",
  "异动",
  "预期差",
  "物理",
  "订单",
  "中标",
  "客户",
  "财报",
  "收入",
  "交付",
  "to",
  "ai",
  "AI",
])

const HYPOTHESIS_MATCH_STOPWORDS = new Set([
  ...INDUSTRY_TERM_STOPWORDS,
  "公司",
  "整体",
  "合理",
  "市值",
  "空间",
  "今日",
  "昨晚",
  "明天",
  "消息",
  "增量",
  "微信",
  "chat",
  "sentat",
])
const WATCH_LLM_REVIEW_MODES = new Set(["off", "auto", "force"])
const WATCH_LLM_REVIEW_DEFAULT_MAX_ITEMS = 8
const EVIDENCE_DELTA_VALUES = new Set([
  "fundamental_delivery",
  "supporting_signal",
  "market_feedback",
  "narrative_expansion",
  "counter_signal",
  "mixed_signal",
  "new_context",
  "catalyst_signal",
])
const SIGNAL_TYPE_VALUES = new Set(["新催化", "二次确认", "市场反馈", "硬证据", "反证", "叙事扩散"])

function isDateLikeText(value) {
  const text = String(value ?? "").trim()
  return /^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(text) || /^\d{1,4}$/.test(text)
}

function isWeakAutoWatchTitle(value) {
  const text = safeErrorMessage(String(value ?? "").trim())
  if (!text) return true
  if (isDateLikeText(text)) return true
  const core = text
    .replace(/^(新催化|候选新假设|新增变量|核心变量|催化|发酵\/异动|发酵|异动|待验证|消息|事件)[｜|:：\s-]*/i, "")
    .trim()
  if (core && core !== text && isWeakAutoWatchTitle(core)) return true
  if (/^\d+\.$/.test(text)) return true
  if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}\s*(舆情|微信|资讯|复盘)?$/.test(text)) return true
  if (/^[\d\s./:：\-，,、.．]+$/.test(core || text)) return true
  return HYPOTHESIS_MATCH_STOPWORDS.has(text.toLowerCase()) || HYPOTHESIS_MATCH_STOPWORDS.has(text)
}

function isMeaningfulWatchToken(value) {
  const token = safeErrorMessage(String(value ?? "").trim())
  if (!token || token.length < 2) return false
  if (isDateLikeText(token)) return false
  if (/^\d+(\.\d+)?$/.test(token)) return false
  if (/^\d+\.$/.test(token)) return false
  if (HYPOTHESIS_MATCH_STOPWORDS.has(token.toLowerCase()) || HYPOTHESIS_MATCH_STOPWORDS.has(token)) return false
  return true
}

function normalizeLlmReviewMode(value) {
  const mode = safeErrorMessage(String(value ?? "off").trim().toLowerCase())
  return WATCH_LLM_REVIEW_MODES.has(mode) ? mode : "off"
}

function normalizeEvidenceDelta(value, fallback = "new_context") {
  const delta = safeErrorMessage(String(value ?? "").trim())
  return EVIDENCE_DELTA_VALUES.has(delta) ? delta : fallback
}

function signalTypeForEvidenceDelta(delta) {
  if (delta === "catalyst_signal") return "新催化"
  if (delta === "fundamental_delivery") return "硬证据"
  if (delta === "market_feedback") return "市场反馈"
  if (delta === "counter_signal") return "反证"
  if (delta === "supporting_signal" || delta === "mixed_signal") return "二次确认"
  return "叙事扩散"
}

function signalStrengthForEvidenceDelta(delta) {
  if (delta === "fundamental_delivery" || delta === "counter_signal") return "high"
  if (delta === "catalyst_signal" || delta === "market_feedback" || delta === "supporting_signal" || delta === "mixed_signal") return "medium"
  return "low"
}

function tradingImplicationForEvidenceDelta(delta) {
  if (delta === "fundamental_delivery") return "硬证据出现，优先核对公告、订单、收入确认和市场是否已经定价。"
  if (delta === "catalyst_signal") return "新催化出现，先看二次确认、关联股票排序和量价跟随，不直接当成订单兑现。"
  if (delta === "market_feedback") return "市场反馈已经出现，先判断是刚启动还是 priced-in 风险。"
  if (delta === "counter_signal") return "反证出现，优先检查原假设是否需要降级、冻结或重写。"
  if (delta === "supporting_signal" || delta === "mixed_signal") return "信号有支持但仍需区分兑现证据和叙事扩散。"
  return "新增上下文暂不足以改变状态，先保留为观察线索。"
}

function normalizeSignalType(value, delta) {
  const signalType = safeErrorMessage(String(value ?? "").trim())
  return SIGNAL_TYPE_VALUES.has(signalType) ? signalType : signalTypeForEvidenceDelta(delta)
}

function parseCsvList(value, fallback = []) {
  const values = Array.isArray(value) ? value : String(value ?? "").split(/[,;，；\n]+/g)
  const parsed = [...new Set(values.map((item) => safeErrorMessage(String(item ?? "").trim())).filter(Boolean))]
  return parsed.length ? parsed : fallback
}

function parseTextList(value) {
  return parseCsvList(value, [])
}

function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value ?? fallback)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, Math.trunc(parsed)))
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length)
  let nextIndex = 0
  const workerCount = Math.min(items.length, Math.max(1, concurrency))
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await mapper(items[index], index)
    }
  }))
  return results
}

function parseSourceFilters(value) {
  const parsed = parseCsvList(value, [])
  return parsed.length ? new Set(parsed.map((item) => item.toLowerCase())) : new Set(["raw", "wiki", "wechat", "gangtise", "daily_review", "agentic"])
}

function sourceFilterAllows(filters, sourceType) {
  if (filters.has("all")) return true
  if (sourceType === "wechat_incremental") return filters.has("wechat_incremental")
  if (sourceType === "hypothesis_supplement") return filters.has("hypothesis_supplement") || filters.has("supplement")
  if (sourceType === "raw_article") return filters.has("raw") || filters.has("raw_article")
  if (sourceType === "gangtise") return filters.has("raw") || filters.has("gangtise")
  if (sourceType === "wechat") return filters.has("raw") || filters.has("wechat")
  if (sourceType === "daily_review") return filters.has("raw") || filters.has("daily_review")
  if (sourceType === "wiki_article") return filters.has("wiki") || filters.has("wiki_article")
  if (sourceType === "agentic_run") return filters.has("agentic") || filters.has("agentic_run")
  return filters.has(sourceType)
}

function parseLooseTimestampMs(value) {
  if (value instanceof Date) return value.getTime()
  if (typeof value === "number" && Number.isFinite(value)) return value
  const raw = safeErrorMessage(String(value ?? "").trim())
  if (!raw) return null
  const normalized = raw.replace(/\//g, "-").replace(/^(\d{4}-\d{2}-\d{2})\s+/, "$1T")
  const ms = Date.parse(normalized)
  return Number.isFinite(ms) ? ms : null
}

function parseSinceCutoff(value, baseValue = Date.now()) {
  const raw = safeErrorMessage(String(value ?? "1d").trim())
  const baseMs = parseLooseTimestampMs(baseValue) ?? Date.now()
  const match = raw.match(/^(\d+)([smhdw])$/i)
  if (!match) return new Date(baseMs - 86400000)
  const amount = Number(match[1])
  const unit = match[2].toLowerCase()
  const multipliers = { s: 1000, m: 60000, h: 3600000, d: 86400000, w: 7 * 86400000 }
  return new Date(baseMs - amount * multipliers[unit])
}

function normalizeStatus(value, fallback = "watching") {
  const status = safeErrorMessage(String(value ?? fallback).trim())
  if (!HYPOTHESIS_STATUS_SET.has(status)) {
    throw new Error(`Unsupported hypothesis status: ${status}. Use one of: ${HYPOTHESIS_STATUSES.join(", ")}`)
  }
  return status
}

function normalizeConviction(value, fallback = 0) {
  const n = Number(value ?? fallback)
  if (!Number.isFinite(n)) return fallback
  return Math.max(0, Math.min(1, n))
}

function slugifyAscii(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
}

function stableHypothesisId({ title, theme, segments }) {
  const seed = `${title}:${theme}:${(segments ?? []).join(",")}`
  const slug = slugifyAscii(`${theme}-${title}`).slice(0, 32)
  return `hypo_${slug ? `${slug}_` : ""}${shortHash(seed).slice(0, 12)}`
}

function timestampForPath(generatedAt) {
  return String(generatedAt ?? nowLocalTimestamp()).replace(/[-: ]/g, "").slice(0, 14)
}

function hypothesisJsonPath(projectPath, id) {
  return path.join(projectPath, HYPOTHESIS_ROOT, `${id}.json`)
}

function hypothesisMarkdownPath(projectPath, id) {
  return path.join(projectPath, HYPOTHESIS_ROOT, `${id}.md`)
}

function hypothesisEventPath(projectPath, id) {
  return path.join(projectPath, HYPOTHESIS_EVENTS_ROOT, `${id}.jsonl`)
}

function hypothesisAlertPath(projectPath, date) {
  return path.join(projectPath, HYPOTHESIS_ALERTS_ROOT, `${date}.jsonl`)
}

function hypothesisDashboardJsonPath(projectPath) {
  return path.join(projectPath, HYPOTHESIS_DASHBOARD_ROOT, "latest.json")
}

function hypothesisDashboardMarkdownPath(projectPath) {
  return path.join(projectPath, HYPOTHESIS_DASHBOARD_ROOT, "latest.md")
}

function hypothesisSupplementBasePath(projectPath, generatedAt, supplementId) {
  const prefix = `${timestampForPath(generatedAt)}-${safeErrorMessage(String(supplementId ?? "supplement")).slice(0, 32)}`
  return path.join(projectPath, HYPOTHESIS_SUPPLEMENTS_ROOT, prefix)
}

function observationDraftBasePath(projectPath, generatedAt, draftId) {
  const date = String(generatedAt ?? nowLocalTimestamp()).slice(0, 10)
  const prefix = `${timestampForPath(generatedAt)}-${safeErrorMessage(String(draftId ?? "observation")).slice(0, 32)}`
  return path.join(projectPath, OBSERVATION_DRAFTS_ROOT, date, prefix)
}

function wechatInboxIncomingPath(projectPath, date) {
  return path.join(projectPath, WECHAT_INBOX_INCOMING_ROOT, `${date}.jsonl`)
}

function wechatInboxProcessedPath(projectPath, date) {
  return path.join(projectPath, WECHAT_INBOX_PROCESSED_ROOT, `${date}.jsonl`)
}

function wechatInboxStatePath(projectPath) {
  return path.join(projectPath, WECHAT_INBOX_STATE_PATH)
}

function resolveProjectInputPath(projectPath, inputPath) {
  const rawPath = safeErrorMessage(String(inputPath ?? "").trim())
  if (!rawPath) return ""
  return normalizePath(path.isAbsolute(rawPath) ? rawPath : path.join(projectPath, rawPath))
}

function projectRefOrAbsolute(projectPath, targetPath) {
  const relative = path.relative(projectPath, targetPath)
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative)
    ? projectRelative(projectPath, targetPath)
    : targetPath
}

function markdownList(items, fallback = "- none") {
  return (items ?? []).length ? items.map((item) => `- ${item}`).join("\n") : fallback
}

function markdownRelatedWikiPages(pages = []) {
  const rows = (Array.isArray(pages) ? pages : [])
    .map((page) => {
      if (page && typeof page === "object" && !Array.isArray(page)) {
        return page.title && page.title !== page.sourceRef
          ? `${page.title} (${page.sourceRef})`
          : page.sourceRef
      }
      return String(page ?? "").trim()
    })
    .filter(Boolean)
  return markdownList(rows)
}

function relatedWikiPageRefs(values) {
  const rows = []
  const candidates = Array.isArray(values) ? values : parseTextList(values)
  for (const item of candidates) {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      rows.push(item.sourceRef, item.path)
    } else {
      rows.push(item)
    }
  }
  return uniqueNonEmpty(rows).slice(0, 12)
}

function parseRelatedWikiPagesInput(value) {
  if (Array.isArray(value)) {
    return mergeRelatedWikiPages(value.map((item) => {
      if (item && typeof item === "object" && !Array.isArray(item)) return item
      const sourceRef = safeErrorMessage(String(item ?? "").trim())
      return sourceRef ? { sourceRef, title: sourceRef } : null
    }).filter(Boolean))
  }
  const raw = safeErrorMessage(String(value ?? "").trim())
  if (!raw) return []
  if (raw.startsWith("[") || raw.startsWith("{")) {
    try {
      const parsed = JSON.parse(raw)
      return parseRelatedWikiPagesInput(Array.isArray(parsed) ? parsed : [parsed])
    } catch {
      // Fall through to comma/newline parsing.
    }
  }
  return mergeRelatedWikiPages(parseTextList(raw).map((sourceRef) => ({ sourceRef, title: sourceRef })))
}

function hypothesisMarkdown(hypothesis) {
  return [
    `# ${hypothesis.title}`,
    "",
    "## Metadata",
    `- id: ${hypothesis.id}`,
    `- theme: ${hypothesis.theme || "n/a"}`,
    `- status: ${hypothesis.status}`,
    `- conviction: ${hypothesis.conviction}`,
    `- timeHorizon: ${hypothesis.timeHorizon || "n/a"}`,
    `- nextValidationDate: ${hypothesis.nextValidationDate || "n/a"}`,
    "",
    "## Segments",
    markdownList(hypothesis.segments),
    "",
    "## Key Variables",
    markdownList(hypothesis.keyVariables),
    "",
    "## Trigger Conditions",
    markdownList(hypothesis.triggerConditions),
    "",
    "## Invalidation Signals",
    markdownList(hypothesis.invalidationSignals ?? hypothesis.falsifiableConditions),
    "",
    "## Expected Evidence Path",
    markdownList(hypothesis.expectedEvidencePath),
    "",
    "## Related Wiki Pages",
    markdownRelatedWikiPages(hypothesis.relatedWikiPages),
    "",
    "## Evidence Refs",
    markdownList(hypothesis.evidenceRefs),
    "",
    "## Market Refs",
    markdownList(hypothesis.marketRefs),
    "",
    "## Risks",
    markdownList(hypothesis.risks),
    "",
    "## Write Boundary",
    "- managed artifact: .llm-wiki/hypotheses",
    "- forbidden: wiki/",
    "- forbidden: raw/",
    "- forbidden: real trading actions",
    "",
  ].join("\n")
}

function hypothesisSupplementMarkdown(supplement) {
  return [
    `# ${supplement.title}`,
    "",
    "## Metadata",
    `- schema: ${supplement.schema}`,
    `- kind: ${supplement.kind}`,
    `- hypothesisId: ${supplement.hypothesisId || "n/a"}`,
    `- createdAt: ${supplement.createdAt}`,
    "",
    "## Source Refs",
    markdownList(supplement.sourceRefs),
    "",
    "## Body",
    supplement.body || "n/a",
    "",
    "## Write Boundary",
    "- managed artifact: .llm-wiki/hypothesis-supplements",
    "- forbidden: wiki/",
    "- forbidden: raw/",
    "- forbidden: real trading actions",
    "",
  ].join("\n")
}

function observationDraftMarkdown(draft) {
  return [
    `# ${draft.title}`,
    "",
    "## Metadata",
    `- schema: ${draft.schema}`,
    `- id: ${draft.id}`,
    `- hypothesisId: ${draft.hypothesisId || "n/a"}`,
    `- createdAt: ${draft.createdAt}`,
    `- status: ${draft.status}`,
    "",
    "## Observation",
    `- stocks: ${draft.stocks.join("、") || "n/a"}`,
    `- ranking: ${draft.ranking || "n/a"}`,
    `- gap: ${draft.gap || "n/a"}`,
    `- nextAction: ${draft.nextAction || "n/a"}`,
    "",
    "## Wiki Frame",
    `- label: ${draft.wikiFrame.label || "n/a"}`,
    `- sourceRef: ${draft.wikiFrame.sourceRef || "n/a"}`,
    `- meta: ${draft.wikiFrame.metaLine || "n/a"}`,
    "",
    "## Source Refs",
    markdownList(draft.sourceRefs),
    "",
    "## Ask Query",
    draft.askQuery || "n/a",
    "",
    "## Copy Text",
    draft.copyText || "n/a",
    "",
    "## Write Boundary",
    "- managed artifact: .llm-wiki/observation-drafts",
    "- forbidden: wiki/",
    "- forbidden: raw/",
    "- forbidden: real trading actions",
    "",
  ].join("\n")
}

function reportMarkdown(report) {
  return [
    `# Hypothesis Report: ${report.hypothesis.title}`,
    "",
    "## State",
    `- id: ${report.hypothesis.id}`,
    `- status: ${report.hypothesis.status}`,
    `- theme: ${report.hypothesis.theme || "n/a"}`,
    `- segments: ${(report.hypothesis.segments ?? []).join(", ") || "none"}`,
    `- conviction: ${report.hypothesis.conviction}`,
    `- nextValidationDate: ${report.hypothesis.nextValidationDate || "n/a"}`,
    "",
    "## Evidence Chain",
    markdownList(report.evidenceChain.map((item) => `${item.createdAt}: ${item.evidenceDelta} (${item.confidenceImpact?.direction ?? "neutral"}) ${item.sourceRef ?? ""}`)),
    "",
    "## Market Feedback",
    markdownList(report.marketFeedback),
    "",
    "## Fundamental Evidence",
    markdownList(report.fundamentalEvidence),
    "",
    "## Evidence Gaps",
    markdownList(report.evidenceGaps),
    "",
    "## Risks",
    markdownList(report.hypothesis.risks),
    "",
    "## Lessons",
    markdownList(report.lessons),
    "",
    "## Policy Suggestions",
    markdownList(report.policySuggestions.map((item) => `${item.target}: ${item.suggestion}`)),
    "",
  ].join("\n")
}

function validationMarkdown(validation) {
  return [
    `# Hypothesis Validation: ${validation.hypothesis.id}`,
    "",
    `- result: ${validation.result}`,
    `- window: ${validation.window}`,
    `- confidenceChange: ${validation.confidenceChange}`,
    `- nextValidationDateSuggestion: ${validation.nextValidationDateSuggestion || "n/a"}`,
    "",
    "## Market Feedback",
    markdownList(validation.marketFeedback.signals),
    "",
    "## Fundamental Evidence",
    markdownList(validation.fundamentalEvidence.signals),
    "",
    "## Evidence Gaps",
    markdownList(validation.evidenceGaps),
    "",
    "## Guardrails",
    markdownList(validation.guardrails),
    "",
  ].join("\n")
}

function dashboardMarkdown(dashboard) {
  return [
    "# Hypothesis Watchtower",
    "",
    `- generatedAt: ${dashboard.generatedAt}`,
    `- hypothesisCount: ${dashboard.summary.hypothesisCount}`,
    `- openAlertCount: ${dashboard.summary.openAlertCount}`,
    `- triggeredTodayCount: ${dashboard.summary.triggeredTodayCount}`,
    `- pricedInRiskCount: ${dashboard.summary.pricedInRiskCount}`,
    "",
    "## 假设池总览",
    markdownList(dashboard.hypotheses.map((item) => `${item.id} | ${item.status} -> ${item.feedbackStatus ?? item.status} | ${item.title}`)),
    "",
    "## 今日触发",
    markdownList(dashboard.todayTriggers.map((item) => `${item.alertLevel}: ${item.hypothesisTitle || item.hypothesisId} <- ${item.sourceRef}`)),
    "",
    "## 重要提醒",
    markdownList(dashboard.openAlerts.filter((item) => ALERT_LEVEL_RANK[item.alertLevel] >= ALERT_LEVEL_RANK.important).map((item) => `${item.alertLevel}: ${item.alertReason} (${item.sourceRef})`)),
    "",
    "## 证据缺口",
    markdownList(dashboard.evidenceGapSummary.map((item) => `${item.gap}: ${item.count}`)),
    "",
    "## 叙事扩散但未闭环",
    markdownList(dashboard.openAlerts.filter((item) => item.flags?.includes("priced_in_risk") || item.evidenceDelta === "narrative_expansion").map((item) => `${item.hypothesisTitle || item.hypothesisId}: ${item.alertReason}`)),
    "",
    "## 接近 actionable",
    markdownList(dashboard.hypotheses.filter((item) => item.feedbackStatus === "strengthening" || item.feedbackStatus === "actionable").map((item) => `${item.id}: ${item.title}`)),
    "",
  ].join("\n")
}

async function readJsonFile(filePath) {
  const raw = await readIfExists(filePath)
  if (!raw.trim()) return null
  return JSON.parse(raw)
}

async function readHypothesisById(projectPath, id) {
  const normalizedId = safeErrorMessage(String(id ?? "").trim())
  if (!normalizedId) throw new Error("Missing required hypothesis id")
  const record = await readJsonFile(hypothesisJsonPath(projectPath, normalizedId))
  if (!record) throw new Error(`Hypothesis not found: ${normalizedId}`)
  return record
}

async function listHypothesisEventRecords(projectPath, id = null) {
  const files = id
    ? [hypothesisEventPath(projectPath, id)]
    : (await listFilesRecursive(path.join(projectPath, HYPOTHESIS_EVENTS_ROOT), { extensions: new Set([".jsonl"]) }).catch(() => []))
  const events = []
  for (const filePath of files) {
    const raw = await readIfExists(filePath)
    if (!raw.trim()) continue
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue
      try {
        events.push({ ...JSON.parse(line), sourceEventPath: projectRelative(projectPath, filePath) })
      } catch {
        events.push({ schema: HYPOTHESIS_EVENT_SCHEMA, parseError: true, sourceEventPath: projectRelative(projectPath, filePath), raw: line })
      }
    }
  }
  return events
}

async function listHypothesisAlertRecords(projectPath) {
  const files = await listFilesRecursive(path.join(projectPath, HYPOTHESIS_ALERTS_ROOT), { extensions: new Set([".jsonl"]) }).catch(() => [])
  const alerts = []
  for (const filePath of files.sort()) {
    const raw = await readIfExists(filePath)
    if (!raw.trim()) continue
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue
      try {
        alerts.push({ ...JSON.parse(line), sourceAlertPath: projectRelative(projectPath, filePath) })
      } catch {
        alerts.push({ schema: "trading-hypothesis-alert-v1", parseError: true, sourceAlertPath: projectRelative(projectPath, filePath), raw: line })
      }
    }
  }
  return alerts
}

export async function listHypotheses(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const status = safeErrorMessage(String(options.status ?? "").trim())
  const theme = safeErrorMessage(String(options.theme ?? "").trim())
  const segment = safeErrorMessage(String(options.segment ?? "").trim())
  const files = await listFilesRecursive(path.join(projectPath, HYPOTHESIS_ROOT), { extensions: new Set([".json"]) }).catch(() => [])
  const hypotheses = []
  for (const filePath of files.sort()) {
    const record = await readJsonFile(filePath).catch(() => null)
    if (!record || record.schema !== HYPOTHESIS_LIBRARY_SCHEMA) continue
    if (status && record.status !== status) continue
    if (theme && record.theme !== theme) continue
    if (segment && !(record.segments ?? []).includes(segment)) continue
    hypotheses.push({ ...record, relativePath: projectRelative(projectPath, filePath) })
  }
  return {
    schema: "trading-hypothesis-list-v1",
    projectPath,
    filters: { status: status || null, theme: theme || null, segment: segment || null },
    count: hypotheses.length,
    hypotheses,
    writePolicy: { readOnly: true, wroteWiki: false, wroteRaw: false },
  }
}

export async function listHypothesisAlerts(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const status = safeErrorMessage(String(options.status ?? "open").trim())
  const minAlertLevel = safeErrorMessage(String(options.minAlertLevel ?? options["min-alert-level"] ?? "info").trim())
  const minRank = ALERT_LEVEL_RANK[minAlertLevel] ?? ALERT_LEVEL_RANK.info
  const limit = Math.max(1, Number(options.limit ?? 100) || 100)
  const alerts = (await listHypothesisAlertRecords(projectPath))
    .filter((alert) => status === "all" || alert.status === status)
    .filter((alert) => (ALERT_LEVEL_RANK[alert.alertLevel] ?? 0) >= minRank)
    .sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")) || String(a.id ?? "").localeCompare(String(b.id ?? "")))
    .slice(0, limit)
  return {
    schema: "trading-hypothesis-alert-list-v1",
    projectPath,
    filters: { status, minAlertLevel, limit },
    count: alerts.length,
    alerts,
    writePolicy: { readOnly: true, wroteWiki: false, wroteRaw: false },
  }
}

function hypothesisQualityFieldValues(hypothesis = {}) {
  const invalidationSignals = parseTextList(
    hypothesis.invalidationSignals
      ?? hypothesis["invalidation-signals"]
      ?? hypothesis.falsifiableConditions
      ?? hypothesis.invalidators
      ?? hypothesis.risks,
  )
  const relatedWikiPages = relatedWikiPageRefs(hypothesis.relatedWikiPages ?? hypothesis["related-wiki-pages"] ?? hypothesis.wikiRefs)
  return {
    triggerConditions: parseTextList(hypothesis.triggerConditions ?? hypothesis["trigger-conditions"] ?? hypothesis.triggers),
    invalidationSignals,
    expectedEvidencePath: parseTextList(hypothesis.expectedEvidencePath ?? hypothesis["expected-evidence-path"] ?? hypothesis.evidencePath),
    relatedWikiPages,
    falsifiableConditions: invalidationSignals,
    coreDrivers: parseTextList(hypothesis.coreDrivers ?? hypothesis.keyVariables),
    marketMispricing: parseTextList(hypothesis.marketMispricing ?? hypothesis.mispricing ?? hypothesis.marketRefs),
    sourceRefs: uniqueNonEmpty([
      ...parseTextList(hypothesis.sourceRefs),
      ...parseTextList(hypothesis.evidenceRefs),
      ...parseTextList(hypothesis.marketRefs),
    ]),
  }
}

function textForHypothesisEvidenceTaskInference(hypothesis = {}, values = hypothesisQualityFieldValues(hypothesis)) {
  return [
    hypothesis.title,
    hypothesis.theme,
    ...(Array.isArray(hypothesis.segments) ? hypothesis.segments : parseTextList(hypothesis.segments)),
    ...values.triggerConditions,
    ...values.falsifiableConditions,
    ...values.expectedEvidencePath,
    ...values.relatedWikiPages,
    ...values.coreDrivers,
    ...values.marketMispricing,
  ].filter(Boolean).join(" ")
}

function inferHypothesisStockIdentity(hypothesis = {}) {
  const directCode = safeErrorMessage(String(hypothesis.stockCode ?? hypothesis.code ?? hypothesis.ticker ?? hypothesis.tsCode ?? "").trim())
  const directName = safeErrorMessage(String(hypothesis.stockName ?? hypothesis.name ?? hypothesis.companyName ?? "").trim())
  const text = [
    directCode,
    directName,
    hypothesis.title,
    ...(Array.isArray(hypothesis.segments) ? hypothesis.segments : parseTextList(hypothesis.segments)),
  ].filter(Boolean).join(" ")
  const matchedCode = text.match(/\b(?:\d{6}\.(?:SH|SZ|BJ)|(?:SH|SZ|BJ)\d{6})\b/i)?.[0] ?? ""
  const stockCode = (directCode || matchedCode).replace(/^(SH|SZ|BJ)(\d{6})$/i, "$2.$1").toUpperCase()
  return {
    stockCode: stockCode || null,
    stockName: directName || null,
  }
}

function addEvidenceTargetFields(targets, fields = []) {
  for (const field of fields) {
    const value = safeErrorMessage(String(field ?? "").trim())
    if (value) targets.add(value)
  }
}

function inferHypothesisEvidenceTaskIntent(hypothesis = {}, values = hypothesisQualityFieldValues(hypothesis)) {
  const text = textForHypothesisEvidenceTaskInference(hypothesis, values)
  const targets = new Set(values.coreDrivers.slice(0, 8))
  let taskType = "general"
  let preferredSources = ["web"]
  let priority = "normal"
  const hasLimitUp = /涨停|打板|连板|断板|封单|炸板|首板|二板|开板/i.test(text)
  const hasFlow = /龙虎榜|机构|游资|席位|净买入|主力资金|北向|资金流/i.test(text)
  const hasMarket = /相对强度|成交额|换手|承接|涨幅|跌幅|放量|缩量|低位|高位|赔率|priced[-_ ]?in|后手|回撤|买点|卖点|扩散/i.test(text)
  const hasFinancial = /财报|年报|季报|收入|营收|毛利|毛利率|净利|利润|ASP|业绩|指引|ROE|EPS/i.test(text)
  const hasAnnouncement = /公告|订单|合同|中标|招投标|客户|交付|出货|量产|认证|供货|兑现|交易所|CNINFO/i.test(text)
  const hasCounter = /反证|证伪|砍单|降价|下修|延期|失败|不及预期|替代|取消/i.test(text)
  if (hasLimitUp) {
    taskType = "limit_up_analysis"
    preferredSources = ["tushare", "web"]
    addEvidenceTargetFields(targets, ["limit_up", "turnover_rate", "amount", "seal_order", "follow_through", "max_drawdown"])
  } else if (hasFlow) {
    taskType = "institutional_flow"
    preferredSources = ["tushare", "web"]
    addEvidenceTargetFields(targets, ["institutional_flow", "net_buy", "seat", "amount", "follow_through"])
  } else if (hasMarket && !hasAnnouncement && !hasFinancial) {
    taskType = "market_data"
    preferredSources = ["tushare", "web"]
    addEvidenceTargetFields(targets, ["close", "pct_chg", "turnover_rate", "amount", "relative_strength", "follow_through", "max_drawdown"])
  } else if (hasFinancial) {
    taskType = "financial_metrics"
    preferredSources = ["cninfo", "tushare", "web"]
    addEvidenceTargetFields(targets, ["revenue", "gross_margin", "net_profit", "asp", "annual_report", "announcement"])
  } else if (hasAnnouncement) {
    taskType = "announcement"
    preferredSources = ["cninfo", "web"]
    addEvidenceTargetFields(targets, ["order", "customer", "shipment", "revenue", "annual_report", "announcement"])
  }
  if (hasCounter) {
    priority = "high"
    addEvidenceTargetFields(targets, ["counterevidence", "order_cancel", "price_cut", "delay", "technology_substitution"])
    if (taskType === "general") {
      taskType = "announcement"
      preferredSources = ["cninfo", "web"]
    }
  }
  if (values.marketMispricing.length && taskType === "general") {
    taskType = "market_data"
    preferredSources = ["tushare", "web"]
    addEvidenceTargetFields(targets, ["relative_strength", "turnover_rate", "follow_through", "max_drawdown"])
  }
  if (targets.size === 0) {
    addEvidenceTargetFields(targets, ["core_driver", "falsifiable_condition", "source_ref"])
  }
  return {
    taskType,
    targetFields: [...targets].slice(0, 12),
    preferredSources,
    priority,
    inferredFrom: {
      hasLimitUp,
      hasFlow,
      hasMarket,
      hasFinancial,
      hasAnnouncement,
      hasCounter,
    },
  }
}

function shellQuote(value) {
  const text = String(value ?? "")
  return `'${text.replace(/'/g, "'\\''")}'`
}

function stockFeedbackEvidenceTaskCommandArgs({ projectPath, draft }) {
  const task = draft.suggestedStockFeedbackEvidenceTask ?? {}
  return [
    "npm",
    "--silent",
    "run",
    "codex:ingest",
    "--",
    "stock-feedback",
    "evidence-task",
    "create",
    "--project",
    projectPath,
    "--source",
    "hypothesis",
    "--source-id",
    task.sourceId ?? draft.hypothesisId,
    "--stock-code",
    task.stockCode ?? "<stock-code>",
    "--task-type",
    task.taskType ?? "general",
    "--target-fields",
    (task.targetFields ?? []).join(","),
    "--preferred-sources",
    (task.preferredSources ?? []).join(","),
    "--priority",
    task.priority ?? "normal",
    "--notes",
    task.notes ?? "",
    "--source-refs",
    (task.sourceRefs ?? []).join(","),
  ].filter((item) => item !== "")
}

function evidenceTaskDraftFromHypothesis({ hypothesis = {}, generatedAt, projectPath }) {
  const qualityGate = qualityCheckHypothesisRecord(hypothesis)
  const values = hypothesisQualityFieldValues(hypothesis)
  const intent = inferHypothesisEvidenceTaskIntent(hypothesis, values)
  const stock = inferHypothesisStockIdentity(hypothesis)
  const sourceRefs = uniqueNonEmpty([
    ...values.sourceRefs,
    hypothesis.relativePath,
    hypothesis.id ? `hypothesis:${hypothesis.id}` : "",
  ]).slice(0, 12)
  const suggestedTask = {
    source: "hypothesis",
    sourceId: hypothesis.id,
    stockCode: stock.stockCode,
    stockName: stock.stockName,
    taskType: intent.taskType,
    targetFields: intent.targetFields,
    preferredSources: intent.preferredSources,
    priority: intent.priority,
    notes: [
      `Hypothesis evidence draft for ${hypothesis.title ?? hypothesis.id}.`,
      qualityGate.missing.length ? `Missing quality fields: ${qualityGate.missing.join(",")}.` : "Quality gate complete.",
      "Review stock identity and sourceRefs before writing formal EvidenceTask.",
    ].join(" "),
    sourceRefs,
  }
  const missingBeforeWrite = []
  if (!suggestedTask.stockCode) missingBeforeWrite.push("stockIdentity")
  if (!suggestedTask.targetFields.length) missingBeforeWrite.push("targetFields")
  if (!suggestedTask.sourceRefs.length) missingBeforeWrite.push("sourceRefs")
  const writeReady = missingBeforeWrite.length === 0
  const draft = {
    schema: HYPOTHESIS_EVIDENCE_TASK_DRAFT_SCHEMA,
    id: `hypothesis_evidence_task_draft_${shortHash(`${hypothesis.id}:${generatedAt}:${intent.taskType}:${suggestedTask.targetFields.join("|")}`)}`,
    generatedAt,
    hypothesisId: hypothesis.id,
    hypothesisTitle: hypothesis.title ?? hypothesis.id,
    status: hypothesis.status ?? null,
    qualityGate,
    candidateFields: values,
    inferredIntent: intent,
    suggestedStockFeedbackEvidenceTask: suggestedTask,
    readiness: {
      status: writeReady ? "write_ready_after_human_gate" : "blocked_missing_required_fields",
      writeReady,
      requiresHumanGate: true,
      missingBeforeWrite,
      nextAction: writeReady ? "review_then_create_stock_feedback_evidence_task" : "attach_stock_identity_or_source_refs_before_evidence_task_write",
    },
    humanGate: {
      required: true,
      recommendedAction: writeReady ? "confirm_single_evidence_task_create" : "complete_missing_fields",
      reason: writeReady
        ? "草案已有股票身份、targetFields 和 sourceRefs；仍需人工确认后才能创建正式 EvidenceTask。"
        : "草案缺少正式 EvidenceTask 必需字段；不能自动写入补证任务。",
    },
    peftBoundary: {
      storesRawFacts: false,
      factsRemainIn: ["hypothesis artifact", "sourceRefs", "EvidenceResult artifact refs"],
      adapterStores: ["behavior", "skill", "tool_habit", "decision_strategy"],
    },
    writePolicy: {
      recommendationOnly: true,
      wroteStockFeedbackEvidenceTask: false,
      wroteHypothesisStatus: false,
      wroteWiki: false,
      wroteRaw: false,
      wroteBrain: false,
      wroteArtifacts: false,
      allowedRoot: HYPOTHESIS_EVIDENCE_TASK_DRAFTS_ROOT,
    },
  }
  const commandArgs = stockFeedbackEvidenceTaskCommandArgs({ projectPath, draft })
  return {
    ...draft,
    suggestedCommandArgs: commandArgs,
    suggestedCommand: commandArgs.map(shellQuote).join(" "),
  }
}

function qualityCheckHypothesisRecord(hypothesis = {}) {
  const values = hypothesisQualityFieldValues(hypothesis)
  const intent = inferHypothesisEvidenceTaskIntent(hypothesis, values)
  const stock = inferHypothesisStockIdentity(hypothesis)
  const checks = [
    {
      id: "triggerConditions",
      label: "触发条件",
      passed: values.triggerConditions.length > 0,
      detail: values.triggerConditions.length
        ? `${values.triggerConditions.length} 条增强/触发条件`
        : "缺少触发条件；系统不知道什么新增信号值得升级这条假设。",
    },
    {
      id: "falsifiableConditions",
      label: "证伪信号",
      passed: values.falsifiableConditions.length > 0,
      detail: values.falsifiableConditions.length
        ? `${values.falsifiableConditions.length} 条失效/反证条件`
        : "缺少证伪信号；不能只写看好理由。",
    },
    {
      id: "expectedEvidencePath",
      label: "验证路径",
      passed: values.expectedEvidencePath.length > 0,
      detail: values.expectedEvidencePath.length
        ? `${values.expectedEvidencePath.length} 条后续验证路径`
        : "缺少验证路径；无法从新增资料继续走到 Ask、量价或基本面复核。",
    },
    {
      id: "relatedWikiPages",
      label: "关联 wiki 框架",
      passed: values.relatedWikiPages.length > 0,
      detail: values.relatedWikiPages.length
        ? `${values.relatedWikiPages.length} 个关联 wiki 页面`
        : "缺少关联 wiki 框架；新增舆情无法稳定接回知识树。",
    },
    {
      id: "coreDrivers",
      label: "核心驱动",
      passed: values.coreDrivers.length > 0,
      detail: values.coreDrivers.length
        ? `${values.coreDrivers.length} 个核心变量`
        : "缺少核心驱动；EvidenceTask 无法知道该补哪些字段。",
    },
    {
      id: "marketMispricing",
      label: "市场错价",
      passed: values.marketMispricing.length > 0,
      detail: values.marketMispricing.length
        ? `${values.marketMispricing.length} 条错价/赔率线索`
        : "缺少市场错价；无法区分好公司和好交易。",
    },
    {
      id: "sourceRefs",
      label: "证据引用",
      passed: values.sourceRefs.length > 0,
      detail: values.sourceRefs.length
        ? `${values.sourceRefs.length} 条 sourceRefs/evidenceRefs/marketRefs`
        : "缺少 sourceRefs；不能进入可审计补证链路。",
    },
  ]
  const missing = checks.filter((check) => !check.passed).map((check) => check.id)
  const score = Math.round((checks.filter((check) => check.passed).length / checks.length) * 100)
  const recommendation = missing.includes("triggerConditions")
    ? "add_trigger_conditions"
    : missing.includes("falsifiableConditions")
    ? "add_falsifiable_conditions"
    : missing.includes("expectedEvidencePath")
      ? "add_expected_evidence_path"
      : missing.includes("relatedWikiPages")
        ? "attach_related_wiki_pages"
        : missing.includes("sourceRefs")
          ? "attach_source_refs"
          : missing.includes("coreDrivers")
            ? "add_core_drivers"
            : missing.includes("marketMispricing")
              ? "add_market_mispricing"
              : "ready_for_evidence_runner"
  return {
    id: hypothesis.id,
    title: hypothesis.title,
    status: hypothesis.status ?? null,
    theme: hypothesis.theme ?? null,
    segments: hypothesis.segments ?? [],
    score,
    qualityGate: score === 100 ? "ready" : score >= 75 ? "review_required" : "needs_evidence",
    missing,
    recommendation,
    checks,
    suggestedEvidenceTask: {
      source: "hypothesis",
      sourceId: hypothesis.id,
      stockCode: stock.stockCode,
      stockName: stock.stockName,
      taskType: intent.taskType,
      targetFields: intent.targetFields.slice(0, 8),
      preferredSources: intent.preferredSources,
      sourceRefs: uniqueNonEmpty([...values.sourceRefs, hypothesis.relativePath, hypothesis.id ? `hypothesis:${hypothesis.id}` : ""]).slice(0, 8),
    },
  }
}

export async function qualityCheckHypotheses(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const id = safeErrorMessage(String(options.id ?? "").trim())
  const limit = Math.max(1, Number(options.limit ?? 100) || 100)
  const listed = await listHypotheses({
    projectPath,
    status: options.status,
    theme: options.theme,
    segment: options.segment,
  })
  const items = listed.hypotheses
    .filter((hypothesis) => !id || hypothesis.id === id)
    .slice(0, limit)
    .map(qualityCheckHypothesisRecord)
  if (id && items.length === 0) throw new Error(`Unknown hypothesis id: ${id}`)
  const counts = {
    total: items.length,
    ready: items.filter((item) => item.qualityGate === "ready").length,
    reviewRequired: items.filter((item) => item.qualityGate === "review_required").length,
    needsEvidence: items.filter((item) => item.qualityGate === "needs_evidence").length,
    missingTriggerConditions: items.filter((item) => item.missing.includes("triggerConditions")).length,
    missingFalsifiableConditions: items.filter((item) => item.missing.includes("falsifiableConditions")).length,
    missingExpectedEvidencePath: items.filter((item) => item.missing.includes("expectedEvidencePath")).length,
    missingRelatedWikiPages: items.filter((item) => item.missing.includes("relatedWikiPages")).length,
    missingCoreDrivers: items.filter((item) => item.missing.includes("coreDrivers")).length,
    missingMarketMispricing: items.filter((item) => item.missing.includes("marketMispricing")).length,
    missingSourceRefs: items.filter((item) => item.missing.includes("sourceRefs")).length,
  }
  return {
    schema: "trading-hypothesis-quality-check-v1",
    mode: "hypothesis-quality-check",
    projectPath,
    filters: { id: id || null, status: options.status ?? null, theme: options.theme ?? null, segment: options.segment ?? null, limit },
    count: items.length,
    counts,
    items,
    writePolicy: {
      readOnly: true,
      wroteWiki: false,
      wroteRaw: false,
      wroteBrain: false,
      wroteHypothesisStatus: false,
    },
  }
}

export async function draftHypothesisEvidenceTasks(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const generatedAt = String(options.generatedAt ?? nowLocalTimestamp())
  const id = safeErrorMessage(String(options.id ?? options["hypothesis-id"] ?? "").trim())
  const limit = Math.max(1, Number(options.limit ?? 100) || 100)
  const listed = await listHypotheses({
    projectPath,
    status: options.status,
    theme: options.theme,
    segment: options.segment,
  })
  let records = listed.hypotheses
    .filter((hypothesis) => !id || hypothesis.id === id)
    .slice(0, limit)
    .map((hypothesis) => evidenceTaskDraftFromHypothesis({ hypothesis, generatedAt, projectPath }))
  if (id && records.length === 0) throw new Error(`Unknown hypothesis id: ${id}`)
  if (options.write) {
    records = records.map((record) => ({
      ...record,
      writePolicy: {
        ...record.writePolicy,
        wroteArtifacts: true,
      },
    }))
  }
  const manifest = {
    schema: HYPOTHESIS_EVIDENCE_TASK_DRAFT_MANIFEST_SCHEMA,
    generatedAt,
    projectPath,
    count: records.length,
    filters: { id: id || null, status: options.status ?? null, theme: options.theme ?? null, segment: options.segment ?? null, limit },
    readinessCounts: records.reduce((counts, record) => {
      const status = record.readiness?.status ?? "unknown"
      counts[status] = (counts[status] ?? 0) + 1
      return counts
    }, {}),
    suggestedTaskTypeCounts: records.reduce((counts, record) => {
      const type = record.suggestedStockFeedbackEvidenceTask?.taskType ?? "unknown"
      counts[type] = (counts[type] ?? 0) + 1
      return counts
    }, {}),
    writeBoundary: {
      root: HYPOTHESIS_EVIDENCE_TASK_DRAFTS_ROOT,
      wroteStockFeedbackEvidenceTask: false,
      wroteHypothesisStatus: false,
      wroteWiki: false,
      wroteRaw: false,
      wroteBrain: false,
    },
    sources: [
      ".llm-wiki/hypotheses/*.json",
      ".llm-wiki/hypothesis-events/*.jsonl",
    ],
  }
  let writeResult = null
  if (options.write) {
    writeResult = await writeHypothesisJsonlWithManifest({
      projectPath,
      relativeRoot: HYPOTHESIS_EVIDENCE_TASK_DRAFTS_ROOT,
      baseName: "hypothesis-evidence-task-drafts",
      records,
      manifest,
      generatedAt,
    })
  }
  return {
    schema: "trading-hypothesis-evidence-task-draft-run-v1",
    mode: "hypothesis-evidence-task-drafts",
    dryRun: !Boolean(options.write),
    projectPath,
    generatedAt,
    count: records.length,
    drafts: records,
    manifest,
    writeResult: writeResult ? { drafts: writeResult.jsonl, manifest: writeResult.manifest } : null,
    writePolicy: {
      recommendationOnly: true,
      wroteStockFeedbackEvidenceTask: false,
      wroteHypothesisStatus: false,
      wroteWiki: false,
      wroteRaw: false,
      wroteBrain: false,
      wroteArtifacts: Boolean(options.write),
      allowedRoot: HYPOTHESIS_EVIDENCE_TASK_DRAFTS_ROOT,
    },
  }
}

function hypothesisEvidenceLinkText(hypothesis = {}) {
  const values = hypothesisQualityFieldValues(hypothesis)
  return [
    hypothesis.id,
    hypothesis.title,
    hypothesis.theme,
    ...(Array.isArray(hypothesis.segments) ? hypothesis.segments : parseTextList(hypothesis.segments)),
    ...values.falsifiableConditions,
    ...values.coreDrivers,
    ...values.marketMispricing,
    ...values.sourceRefs,
  ].filter(Boolean).join(" ")
}

function stockFeedbackEvidenceLinkText({ result = {}, task = {}, trajectory = null } = {}) {
  return [
    result.stockCode,
    result.stockName,
    task.stockCode,
    task.stockName,
    task.taskType,
    ...(task.targetFields ?? []),
    ...(task.sourceRefs ?? []),
    ...(result.sourceRefs ?? []),
    result.summary,
    JSON.stringify(result.structuredData ?? {}),
    trajectory?.hypothesis,
    trajectory?.question,
    trajectory?.summary,
    trajectory?.stock?.code,
    trajectory?.stock?.name,
    ...(trajectory?.sourceRefs ?? []),
  ].filter(Boolean).join(" ")
}

function sourceRefOverlapScore(left = [], right = []) {
  const leftSet = new Set(compactStringArray(left, 30, 260))
  if (!leftSet.size) return 0
  const overlap = compactStringArray(right, 30, 260).filter((ref) => leftSet.has(ref)).length
  return Math.min(25, overlap * 12)
}

function fieldOverlapScore(hypothesis = {}, task = {}) {
  const values = hypothesisQualityFieldValues(hypothesis)
  const fields = new Set(compactStringArray(task.targetFields, 20, 80).map((field) => normalizeFieldKey(field)))
  if (!fields.size) return 0
  const text = [...values.coreDrivers, ...values.falsifiableConditions, hypothesis.title].filter(Boolean).join(" ")
  let score = 0
  for (const field of fields) {
    if (field && normalizeFieldKey(text).includes(field)) score += 8
  }
  return Math.min(24, score)
}

function scoreHypothesisEvidenceLinkCandidate({ hypothesis = {}, result = {}, task = {}, trajectory = null } = {}) {
  const hypothesisText = hypothesisEvidenceLinkText(hypothesis)
  const evidenceText = stockFeedbackEvidenceLinkText({ result, task, trajectory })
  const hypothesisTextNorm = normalizeFieldKey(hypothesisText)
  const evidenceTextNorm = normalizeFieldKey(evidenceText)
  const reasons = []
  let score = 0
  const resultCode = normalizeStockCodeCandidate(result.stockCode ?? task.stockCode ?? trajectory?.stock?.code)
  const resultName = normalizeStockNameCandidate(result.stockName ?? task.stockName ?? trajectory?.stock?.name)
  if (resultCode && hypothesisText.toUpperCase().includes(resultCode)) {
    score += 80
    reasons.push("stock_code_match")
  }
  if (resultName && hypothesisText.includes(resultName)) {
    score += 80
    reasons.push("stock_name_match")
  }
  const segments = Array.isArray(hypothesis.segments) ? hypothesis.segments : parseTextList(hypothesis.segments)
  for (const segment of segments) {
    const term = normalizeFieldKey(segment)
    if (term && evidenceTextNorm.includes(term)) {
      score += 14
      reasons.push(`segment_overlap:${segment}`)
    }
  }
  const values = hypothesisQualityFieldValues(hypothesis)
  const sourceScore = sourceRefOverlapScore(values.sourceRefs, uniqueNonEmpty([
    ...(task.sourceRefs ?? []),
    ...(result.sourceRefs ?? []),
    ...(trajectory?.sourceRefs ?? []),
  ]))
  if (sourceScore > 0) {
    score += sourceScore
    reasons.push("source_ref_overlap")
  }
  const fieldScore = fieldOverlapScore(hypothesis, task)
  if (fieldScore > 0) {
    score += fieldScore
    reasons.push("target_field_overlap")
  }
  for (const term of ["存储", "AI", "订单", "客户", "交付", "收入", "公告", "财报", "光纤", "PCB"]) {
    const key = normalizeFieldKey(term)
    if (hypothesisTextNorm.includes(key) && evidenceTextNorm.includes(key)) {
      score += 6
      reasons.push(`theme_token:${term}`)
    }
  }
  score = Math.min(100, score)
  const confidence = score >= 70 ? "high" : score >= 45 ? "medium" : score > 0 ? "low" : "none"
  return {
    hypothesisId: hypothesis.id,
    hypothesisTitle: hypothesis.title ?? hypothesis.id,
    status: hypothesis.status ?? null,
    score,
    confidence,
    reasons: uniqueNonEmpty(reasons).slice(0, 12),
    sourceRefsToAttach: uniqueNonEmpty([
      trajectory?.id ? `stock-feedback-trajectory:${trajectory.id}` : "",
      result.resultId ? `stock-feedback-evidence-result:${result.resultId}` : "",
      result.artifactPath,
    ]).slice(0, 8),
  }
}

function evidenceLinkDraftForResult({ result = {}, task = {}, trajectory = null, hypotheses = [], generatedAt, projectPath }) {
  const candidates = hypotheses
    .map((hypothesis) => scoreHypothesisEvidenceLinkCandidate({ hypothesis, result, task, trajectory }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || String(a.hypothesisId).localeCompare(String(b.hypothesisId)))
    .slice(0, 5)
  const top = candidates[0] ?? null
  const status = top?.confidence === "high" || top?.confidence === "medium"
    ? "candidate_review_ready"
    : top
      ? "low_confidence_candidates"
      : "needs_hypothesis_mapping"
  const commandBase = [
    "npm", "--silent", "run", "codex:ingest", "--",
    "hypothesis", "evidence-link-review",
    "--project", projectPath,
    "--draft-id", `hypothesis_evidence_link_draft_${shortHash(`${result.resultId}:${trajectory?.id ?? ""}`)}`,
  ]
  const draft = {
    schema: HYPOTHESIS_EVIDENCE_LINK_DRAFT_SCHEMA,
    id: `hypothesis_evidence_link_draft_${shortHash(`${result.resultId}:${trajectory?.id ?? ""}`)}`,
    generatedAt,
    status,
    evidenceResultId: result.resultId ?? null,
    taskId: result.taskId ?? task.taskId ?? null,
    sourceKind: result.source ?? task.source ?? null,
    sourceId: result.sourceId ?? task.sourceId ?? null,
    sourceTrajectoryId: trajectory?.id ?? ((result.source ?? task.source) === "stock_feedback" ? (result.sourceId ?? task.sourceId ?? null) : null),
    stock: {
      code: result.stockCode ?? task.stockCode ?? trajectory?.stock?.code ?? null,
      name: result.stockName ?? task.stockName ?? trajectory?.stock?.name ?? null,
    },
    evidenceSummary: {
      taskType: result.taskType ?? task.taskType ?? null,
      targetFields: compactStringArray(result.targetFields ?? task.targetFields, 12, 80),
      sourceRefs: compactStringArray(result.sourceRefs, 12, 180),
      evidenceRefs: compactEvidenceRefs(result),
      artifactRef: result.artifactPath ? `${result.artifactPath}:${result.artifactLine ?? ""}`.replace(/:$/, "") : null,
    },
    candidates,
    selectedCandidate: top,
    readiness: {
      status,
      writeReady: Boolean(top && ["high", "medium"].includes(top.confidence)),
      requiresHumanGate: true,
      missingBeforeWrite: top ? [] : ["hypothesisMapping"],
      nextAction: top
        ? "review_candidate_then_write_hypothesis_evidence_link"
        : "choose_or_create_hypothesis_before_linking_evidence_result",
    },
    humanGate: {
      required: true,
      recommendedAction: "review_candidate_before_link",
      reason: "EvidenceResult -> Hypothesis 映射会影响后续 trajectory / paper trade / LoRA-ready 权重，必须人工确认。",
    },
    suggestedReviewCommand: [...commandBase, "--candidate-index", "1"].map(shellQuote).join(" "),
    suggestedWriteCommand: [...commandBase, "--candidate-index", "1", "--confirm-human-gate", "true", "--write"].map(shellQuote).join(" "),
    writePolicy: {
      recommendationOnly: true,
      wroteHypothesisEvidenceLink: false,
      wroteHypothesisStatus: false,
      wroteWiki: false,
      wroteRaw: false,
      wroteBrain: false,
      wroteArtifacts: false,
      allowedRoot: HYPOTHESIS_EVIDENCE_LINK_DRAFTS_ROOT,
    },
  }
  return draft
}

export async function draftHypothesisEvidenceLinks(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const generatedAt = String(options.generatedAt ?? nowLocalTimestamp())
  const limit = Math.max(1, Number(options.limit ?? 100) || 100)
  const listed = await listHypotheses({
    projectPath,
    status: options.status,
    theme: options.theme,
    segment: options.segment,
  })
  const hypotheses = listed.hypotheses
  const { tasksById, results, trajectoriesById } = await readStockFeedbackEvidenceForHypotheses(projectPath)
  const approvedLinks = await readHypothesisEvidenceLinkRecords(projectPath)
  const approvedResultIds = new Set(approvedLinks.map((link) => link.evidenceResultId).filter(Boolean))
  let records = results
    .map((result) => {
      const task = tasksById.get(result.taskId) ?? {}
      const source = result.source ?? task.source
      if (source !== "stock_feedback") return null
      if (approvedResultIds.has(result.resultId) && !options.includeLinked) return null
      const trajectory = stockFeedbackTrajectoryForEvidenceResult(result, task, trajectoriesById)
      return evidenceLinkDraftForResult({ result, task, trajectory, hypotheses, generatedAt, projectPath })
    })
    .filter(Boolean)
    .sort((a, b) => {
      const aScore = a.selectedCandidate?.score ?? 0
      const bScore = b.selectedCandidate?.score ?? 0
      return bScore - aScore || String(b.generatedAt ?? "").localeCompare(String(a.generatedAt ?? ""))
    })
    .slice(0, limit)
  if (options.write) {
    records = records.map((record) => ({
      ...record,
      writePolicy: {
        ...record.writePolicy,
        wroteArtifacts: true,
      },
    }))
  }
  const manifest = {
    schema: HYPOTHESIS_EVIDENCE_LINK_DRAFT_MANIFEST_SCHEMA,
    generatedAt,
    projectPath,
    count: records.length,
    filters: { status: options.status ?? null, theme: options.theme ?? null, segment: options.segment ?? null, limit },
    readinessCounts: records.reduce((counts, record) => {
      const status = record.readiness?.status ?? "unknown"
      counts[status] = (counts[status] ?? 0) + 1
      return counts
    }, {}),
    candidateConfidenceCounts: records.reduce((counts, record) => {
      const confidence = record.selectedCandidate?.confidence ?? "none"
      counts[confidence] = (counts[confidence] ?? 0) + 1
      return counts
    }, {}),
    writeBoundary: {
      root: HYPOTHESIS_EVIDENCE_LINK_DRAFTS_ROOT,
      wroteHypothesisEvidenceLink: false,
      wroteHypothesisStatus: false,
      wroteWiki: false,
      wroteRaw: false,
      wroteBrain: false,
    },
    sources: [
      ".llm-wiki/hypotheses/*.json",
      ".llm-wiki/stock-feedback/evidence-results/*.jsonl",
      ".llm-wiki/stock-feedback/trajectories/*.jsonl",
    ],
  }
  let writeResult = null
  if (options.write) {
    writeResult = await writeHypothesisJsonlWithManifest({
      projectPath,
      relativeRoot: HYPOTHESIS_EVIDENCE_LINK_DRAFTS_ROOT,
      baseName: "hypothesis-evidence-link-drafts",
      records,
      manifest,
      generatedAt,
    })
  }
  return {
    schema: "trading-hypothesis-evidence-link-draft-run-v1",
    mode: "hypothesis-evidence-link-drafts",
    dryRun: !Boolean(options.write),
    projectPath,
    generatedAt,
    count: records.length,
    drafts: records,
    manifest,
    writeResult: writeResult ? { drafts: writeResult.jsonl, manifest: writeResult.manifest } : null,
    writePolicy: {
      recommendationOnly: true,
      wroteHypothesisEvidenceLink: false,
      wroteHypothesisStatus: false,
      wroteWiki: false,
      wroteRaw: false,
      wroteBrain: false,
      wroteArtifacts: Boolean(options.write),
      allowedRoot: HYPOTHESIS_EVIDENCE_LINK_DRAFTS_ROOT,
    },
  }
}

async function findHypothesisEvidenceLinkDraft(projectPath, draftId) {
  const persisted = await readHypothesisEvidenceLinkDraftRecords(projectPath, { latestOnly: false })
  let draft = persisted.find((item) => item.id === draftId)
  if (draft) return draft
  const rebuilt = await draftHypothesisEvidenceLinks({ projectPath, limit: 1000 })
  draft = rebuilt.drafts.find((item) => item.id === draftId)
  return draft ?? null
}

function normalizeHumanGateConfirmation(value) {
  return value === true || String(value ?? "").trim().toLowerCase() === "true" || String(value ?? "").trim() === "1"
}

export async function reviewHypothesisEvidenceLinkDraft(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const generatedAt = String(options.generatedAt ?? nowLocalTimestamp())
  const draftId = safeErrorMessage(String(options.id ?? options.draftId ?? options["draft-id"] ?? "").trim())
  if (!draftId) throw new Error("hypothesis evidence-link-review requires --draft-id")
  const draft = await findHypothesisEvidenceLinkDraft(projectPath, draftId)
  if (!draft) throw new Error(`Unknown hypothesis evidence-link draft: ${draftId}`)
  const candidateIndex = Number(options.candidateIndex ?? options["candidate-index"] ?? 1)
  const explicitHypothesisId = safeErrorMessage(String(options.hypothesisId ?? options["hypothesis-id"] ?? "").trim())
  const candidate = explicitHypothesisId
    ? (draft.candidates ?? []).find((item) => item.hypothesisId === explicitHypothesisId)
    : (draft.candidates ?? [])[Math.max(0, candidateIndex - 1)]
  if (!candidate?.hypothesisId) throw new Error("hypothesis evidence-link-review requires a candidate-index or --hypothesis-id")
  const confirmed = normalizeHumanGateConfirmation(options.confirmHumanGate ?? options["confirm-human-gate"])
  if (options.write && !confirmed) throw new Error("hypothesis evidence-link-review --write requires --confirm-human-gate true")
  const reviewer = safeErrorMessage(String(options.reviewer ?? "codex").trim())
  const note = safeErrorMessage(String(options.note ?? "").trim())
  const sourceRefs = uniqueNonEmpty([
    ...(candidate.sourceRefsToAttach ?? []),
    ...(draft.evidenceSummary?.sourceRefs ?? []),
  ]).slice(0, 16)
  const evidenceRefs = compactStringArray(draft.evidenceSummary?.evidenceRefs, 20, 220)
  const sourceIntegrity = buildSourceIntegrityAudit({ sourceRefs, evidenceRefs })
  const link = {
    schema: HYPOTHESIS_EVIDENCE_LINK_SCHEMA,
    id: `hypothesis_evidence_link_${shortHash(`${candidate.hypothesisId}:${draft.evidenceResultId}:${draft.sourceTrajectoryId ?? ""}`)}`,
    generatedAt,
    status: "approved",
    hypothesisId: candidate.hypothesisId,
    hypothesisTitle: candidate.hypothesisTitle ?? null,
    evidenceResultId: draft.evidenceResultId,
    taskId: draft.taskId ?? null,
    sourceKind: draft.sourceKind ?? null,
    sourceId: draft.sourceId ?? null,
    sourceTrajectoryId: draft.sourceTrajectoryId ?? null,
    stock: draft.stock ?? null,
    sourceRefs,
    evidenceRefs,
    sourceIntegrity,
    candidateScore: candidate.score ?? 0,
    candidateConfidence: candidate.confidence ?? "unknown",
    candidateReasons: candidate.reasons ?? [],
    humanGate: {
      required: true,
      confirmed,
      status: confirmed ? "confirmed" : "pending_human_gate",
      reviewer,
      note,
      action: "approve_hypothesis_evidence_link",
    },
    peftBoundary: {
      storesRawFacts: false,
      factsRemainIn: ["retrieval/tool state", "sourceRefs", "EvidenceResult artifact refs"],
      adapterStores: ["behavior", "skill", "tool_habit", "decision_strategy"],
    },
    writePolicy: {
      wroteHypothesisEvidenceLink: Boolean(options.write),
      wroteHypothesisStatus: false,
      wroteWiki: false,
      wroteRaw: false,
      wroteBrain: false,
      wroteArtifacts: Boolean(options.write),
      allowedRoot: HYPOTHESIS_EVIDENCE_LINKS_ROOT,
    },
  }
  const manifest = {
    schema: HYPOTHESIS_EVIDENCE_LINK_MANIFEST_SCHEMA,
    generatedAt,
    projectPath,
    count: 1,
    draftId,
    writeBoundary: {
      root: HYPOTHESIS_EVIDENCE_LINKS_ROOT,
      wroteHypothesisStatus: false,
      wroteWiki: false,
      wroteRaw: false,
      wroteBrain: false,
    },
    sources: [
      HYPOTHESIS_EVIDENCE_LINK_DRAFTS_ROOT,
      ".llm-wiki/stock-feedback/evidence-results/*.jsonl",
      ".llm-wiki/stock-feedback/trajectories/*.jsonl",
    ],
  }
  let writeResult = null
  if (options.write) {
    writeResult = await writeHypothesisJsonlWithManifest({
      projectPath,
      relativeRoot: HYPOTHESIS_EVIDENCE_LINKS_ROOT,
      baseName: "hypothesis-evidence-links",
      records: [link],
      manifest,
      generatedAt,
    })
  }
  return {
    schema: "trading-hypothesis-evidence-link-review-v1",
    mode: "hypothesis-evidence-link-review",
    dryRun: !Boolean(options.write),
    projectPath,
    generatedAt,
    draft,
    selectedCandidate: candidate,
    sourceIntegrity,
    link,
    humanGate: {
      required: true,
      confirmed,
      status: confirmed ? "confirmed" : "pending_human_gate",
    },
    writeResult: writeResult ? { links: writeResult.jsonl, manifest: writeResult.manifest } : null,
    writePolicy: {
      wroteHypothesisEvidenceLink: Boolean(options.write),
      wroteHypothesisStatus: false,
      wroteWiki: false,
      wroteRaw: false,
      wroteBrain: false,
      wroteArtifacts: Boolean(options.write),
      allowedRoot: HYPOTHESIS_EVIDENCE_LINKS_ROOT,
    },
  }
}

async function readJsonlRecords(projectPath, relativeRoot, schema = null) {
  const files = await listFilesRecursive(path.join(projectPath, relativeRoot), {
    extensions: new Set([".jsonl"]),
    excludeDirNames: new Set([".git", "node_modules"]),
    maxBytes: 1024 * 1024 * 10,
  }).catch(() => [])
  const records = []
  for (const filePath of files.sort()) {
    const raw = await readIfExists(filePath)
    if (!raw.trim()) continue
    let lineNo = 0
    for (const line of raw.split(/\r?\n/)) {
      lineNo += 1
      if (!line.trim()) continue
      try {
        const parsed = JSON.parse(line)
        if (schema && parsed.schema !== schema) continue
        records.push({
          ...parsed,
          artifactPath: projectRelative(projectPath, filePath),
          artifactLine: lineNo,
        })
      } catch {
        records.push({
          schema: schema ?? "jsonl-parse-error",
          parseError: true,
          artifactPath: projectRelative(projectPath, filePath),
          artifactLine: lineNo,
        })
      }
    }
  }
  return records
}

async function readJsonManifestRecords(projectPath, relativeRoot, schema = null) {
  const files = await listFilesRecursive(path.join(projectPath, relativeRoot), {
    extensions: new Set([".json"]),
    excludeDirNames: new Set([".git", "node_modules"]),
    maxBytes: 1024 * 1024 * 5,
  }).catch(() => [])
  const records = []
  for (const filePath of files.sort()) {
    try {
      const parsed = JSON.parse(await fs.readFile(filePath, "utf8"))
      if (schema && parsed.schema !== schema) continue
      records.push({ ...parsed, artifactPath: projectRelative(projectPath, filePath) })
    } catch {}
  }
  return records
}

function latestById(records = [], idField) {
  const latest = new Map()
  for (const record of records) {
    const id = record?.[idField]
    if (!id) continue
    const existing = latest.get(id)
    const recordStamp = String(record.updatedAt ?? record.generatedAt ?? record.createdAt ?? record.artifactPath ?? "")
    const existingStamp = String(existing?.updatedAt ?? existing?.generatedAt ?? existing?.createdAt ?? existing?.artifactPath ?? "")
    if (!existing || recordStamp >= existingStamp) latest.set(id, record)
  }
  return latest
}

async function readStockFeedbackEvidenceForHypotheses(projectPath) {
  const taskEvents = await readJsonlRecords(projectPath, ".llm-wiki/stock-feedback/evidence-tasks", "stock-feedback-evidence-task-v1")
  const resultEvents = await readJsonlRecords(projectPath, ".llm-wiki/stock-feedback/evidence-results", "stock-feedback-evidence-result-v1")
  const trajectoryEvents = await readJsonlRecords(projectPath, ".llm-wiki/stock-feedback/trajectories", STOCK_FEEDBACK_TRAJECTORY_SCHEMA)
  return {
    tasksById: latestById(taskEvents, "taskId"),
    results: [...latestById(resultEvents, "resultId").values()],
    trajectoriesById: latestById(trajectoryEvents, "id"),
  }
}

async function readHypothesisEvidenceLinkRecords(projectPath, options = {}) {
  const records = await readJsonlRecords(projectPath, HYPOTHESIS_EVIDENCE_LINKS_ROOT, HYPOTHESIS_EVIDENCE_LINK_SCHEMA)
  const approvedOnly = options.approvedOnly !== false
  return approvedOnly
    ? records.filter((record) => record.status === "approved" && record.humanGate?.status === "confirmed")
    : records
}

function groupEvidenceLinksByResultId(records = []) {
  const grouped = new Map()
  for (const record of records) {
    if (!record.evidenceResultId) continue
    const list = grouped.get(record.evidenceResultId) ?? []
    list.push(record)
    grouped.set(record.evidenceResultId, list)
  }
  return grouped
}

async function readHypothesisEvidenceTaskDraftRecords(projectPath, options = {}) {
  const all = await readJsonlRecords(projectPath, HYPOTHESIS_EVIDENCE_TASK_DRAFTS_ROOT, HYPOTHESIS_EVIDENCE_TASK_DRAFT_SCHEMA)
  if (!options.latestOnly || all.length === 0) return all
  const latestGeneratedAt = all
    .map((record) => String(record.generatedAt ?? ""))
    .sort()
    .at(-1)
  return all.filter((record) => String(record.generatedAt ?? "") === latestGeneratedAt)
}

async function readHypothesisEvidenceLinkDraftRecords(projectPath, options = {}) {
  const all = await readJsonlRecords(projectPath, HYPOTHESIS_EVIDENCE_LINK_DRAFTS_ROOT, HYPOTHESIS_EVIDENCE_LINK_DRAFT_SCHEMA)
  if (!options.latestOnly || all.length === 0) return all
  const latestGeneratedAt = all
    .map((record) => String(record.generatedAt ?? ""))
    .sort()
    .at(-1)
  return all.filter((record) => String(record.generatedAt ?? "") === latestGeneratedAt)
}

function matchesHypothesisEvidenceTaskDraftFilters(draft = {}, filters = {}) {
  const id = safeErrorMessage(String(filters.id ?? filters.draftId ?? filters["draft-id"] ?? "").trim())
  if (id && draft.id !== id) return false
  const hypothesisId = safeErrorMessage(String(filters.hypothesisId ?? filters["hypothesis-id"] ?? "").trim())
  if (hypothesisId && draft.hypothesisId !== hypothesisId) return false
  const status = safeErrorMessage(String(filters.status ?? "").trim())
  if (status && draft.status !== status && draft.readiness?.status !== status) return false
  const taskType = safeErrorMessage(String(filters.taskType ?? filters["task-type"] ?? "").trim())
  if (taskType && draft.suggestedStockFeedbackEvidenceTask?.taskType !== taskType) return false
  const readiness = safeErrorMessage(String(filters.readiness ?? "").trim())
  if (readiness && draft.readiness?.status !== readiness) return false
  return true
}

function normalizeStockIdentityGateFilter(value = "") {
  const token = safeErrorMessage(String(value ?? "").trim().toLowerCase()).replace(/[\s-]+/g, "_")
  const aliases = new Map([
    ["needs_identity", "needs_stock_identity"],
    ["needs_stock", "needs_stock_identity"],
    ["missing_stock_identity", "needs_stock_identity"],
    ["low_confidence", "low_confidence_candidates"],
    ["low_confidence_candidate", "low_confidence_candidates"],
    ["ready", "candidate_review_ready"],
    ["review_ready", "candidate_review_ready"],
  ])
  return aliases.get(token) ?? token
}

function hypothesisEvidenceTaskDraftReviewPlan(draft = {}) {
  const gate = draft.stockIdentityCandidateGate ?? {}
  const candidates = draft.stockIdentityCandidates ?? []
  const recommendedIndex = gate.recommendedCandidateIndex ?? null
  const candidate = recommendedIndex ? candidates[Number(recommendedIndex) - 1] ?? null : candidates[0] ?? null
  const draftRef = `--draft-id ${draft.id ?? "<id>"}`
  const explicitStockArgs = "--stock-code <code> --stock-name <name>"
  const baseCommand = `hypothesis evidence-task-draft-review ${draftRef}`
  if (gate.status === "candidate_review_ready" && candidate?.code) {
    return {
      status: "candidate_review_ready",
      riskLevel: gate.confidence === "high" ? "low" : "medium",
      recommendedAction: "review_candidate_then_promote_with_candidate_index",
      recommendedCandidate: {
        index: recommendedIndex,
        code: candidate.code ?? null,
        name: candidate.name ?? null,
        confidence: candidate.confidence ?? null,
        score: candidate.score ?? null,
      },
      requiresHumanGate: true,
      requiresLowConfidenceConfirmation: false,
      dryRunCommand: `${baseCommand} --candidate-index ${recommendedIndex}`,
      writeCommand: `${baseCommand} --candidate-index ${recommendedIndex} --confirm-human-gate true --write`,
      saferAlternativeCommand: `${baseCommand} ${explicitStockArgs} --confirm-human-gate true --write`,
      blockers: [],
    }
  }
  if (gate.status === "low_confidence_candidates" && candidate?.code) {
    return {
      status: "low_confidence_candidates",
      riskLevel: "high",
      recommendedAction: "manual_confirm_candidate_or_provide_explicit_stock_identity",
      recommendedCandidate: {
        index: recommendedIndex,
        code: candidate.code ?? null,
        name: candidate.name ?? null,
        confidence: candidate.confidence ?? null,
        score: candidate.score ?? null,
      },
      requiresHumanGate: true,
      requiresLowConfidenceConfirmation: true,
      dryRunCommand: `${baseCommand} --candidate-index ${recommendedIndex}`,
      writeCommand: `${baseCommand} --candidate-index ${recommendedIndex} --confirm-human-gate true --confirm-low-confidence-candidate true --write`,
      saferAlternativeCommand: `${baseCommand} ${explicitStockArgs} --confirm-human-gate true --write`,
      blockers: ["low_confidence_stock_identity_candidate"],
    }
  }
  return {
    status: "needs_stock_identity",
    riskLevel: "high",
    recommendedAction: "provide_explicit_stock_code_and_stock_name",
    recommendedCandidate: null,
    requiresHumanGate: true,
    requiresLowConfidenceConfirmation: false,
    dryRunCommand: `${baseCommand} ${explicitStockArgs}`,
    writeCommand: `${baseCommand} ${explicitStockArgs} --confirm-human-gate true --write`,
    saferAlternativeCommand: `${baseCommand} ${explicitStockArgs} --confirm-human-gate true --write`,
    blockers: ["missing_stock_identity"],
  }
}

function compactHypothesisEvidenceTaskDraftForList(draft = {}) {
  const task = draft.suggestedStockFeedbackEvidenceTask ?? {}
  const stockIdentityCandidates = draft.stockIdentityCandidates ?? []
  const compact = {
    id: draft.id,
    generatedAt: draft.generatedAt ?? null,
    artifactPath: draft.artifactPath ?? null,
    hypothesisId: draft.hypothesisId ?? null,
    hypothesisTitle: draft.hypothesisTitle ?? null,
    status: draft.status ?? null,
    taskType: task.taskType ?? null,
    targetFields: task.targetFields ?? [],
    preferredSources: task.preferredSources ?? [],
    priority: task.priority ?? null,
    stockCode: task.stockCode ?? null,
    stockName: task.stockName ?? null,
    readiness: draft.readiness ?? null,
    humanGate: draft.humanGate ?? null,
    sourceRefs: task.sourceRefs ?? [],
    stockIdentityCandidates,
    stockIdentityCandidateGate: stockIdentityCandidateGate(stockIdentityCandidates),
  }
  return {
    ...compact,
    reviewPlan: hypothesisEvidenceTaskDraftReviewPlan(compact),
  }
}

function inferTsCodeSuffix(code) {
  const raw = String(code ?? "").replace(/\D/g, "")
  if (!/^\d{6}$/.test(raw)) return ""
  if (raw.startsWith("6")) return `${raw}.SH`
  if (raw.startsWith("0") || raw.startsWith("3")) return `${raw}.SZ`
  if (raw.startsWith("8") || raw.startsWith("4")) return `${raw}.BJ`
  return ""
}

function normalizeStockCodeCandidate(value) {
  const text = safeErrorMessage(String(value ?? "").trim()).toUpperCase()
  if (!text) return ""
  const prefixed = text.match(/^(SH|SZ|BJ)(\d{6})$/)
  if (prefixed) return `${prefixed[2]}.${prefixed[1]}`
  const suffixed = text.match(/^(\d{6})\.(SH|SZ|BJ)$/)
  if (suffixed) return `${suffixed[1]}.${suffixed[2]}`
  const bare = text.match(/^(\d{6})$/)
  if (bare) return inferTsCodeSuffix(bare[1])
  return ""
}

function normalizeStockNameCandidate(value) {
  const text = safeErrorMessage(String(value ?? "").trim())
    .replace(/^\[\[/, "")
    .replace(/\]\]$/, "")
    .replace(/^股票\//, "")
    .replace(/[()（）【】\[\]]/g, "")
    .trim()
  if (!text || text.length < 2 || text.length > 16) return ""
  if (!/[\u4e00-\u9fa5]/.test(text)) return ""
  if (/^\d+$/.test(text)) return ""
  if (/^(股票|代码|证券代码|证券名称|买入|卖出|来源|日期|板块|概念|今日|昨日)$/.test(text)) return ""
  return text
}

function stockIdentityKey(code, name) {
  return code || `name:${name}`
}

function addStockIdentityCandidate(map, input = {}) {
  const code = normalizeStockCodeCandidate(input.code ?? input.tsCode ?? input.stockCode)
  const name = normalizeStockNameCandidate(input.name ?? input.stockName)
  if (!code && !name) return
  const key = stockIdentityKey(code, name)
  const existing = map.get(key) ?? {
    code: code || null,
    name: name || null,
    sourceKinds: [],
    sourceRefs: [],
    contexts: [],
  }
  if (code && !existing.code) existing.code = code
  if (name && !existing.name) existing.name = name
  existing.sourceKinds = uniqueNonEmpty([...existing.sourceKinds, input.sourceKind]).slice(0, 8)
  existing.sourceRefs = uniqueNonEmpty([...existing.sourceRefs, input.sourceRef]).slice(0, 12)
  existing.contexts = uniqueNonEmpty([...existing.contexts, input.context]).slice(0, 8)
  map.set(stockIdentityKey(existing.code, existing.name), existing)
  if (key !== stockIdentityKey(existing.code, existing.name)) map.delete(key)
}

function stockIdentitySourceKindForRecord(record = {}, sourceRef = "") {
  const schema = String(record.schema ?? "").toLowerCase()
  const ref = String(sourceRef ?? "").toLowerCase()
  if (schema.includes("execution-result") || ref.includes("/execution-results/")) return "execution_result"
  if (schema.includes("paper-trade-agent") || ref.includes("/paper-trade-agent/")) return "paper_trade_agent"
  if (schema.includes("paper-trade") || ref.includes("/paper-trades/")) return "paper_trade"
  if (schema.includes("trajectory") || ref.includes("/trajectories/")) return "trajectory"
  if (schema.includes("evidence-task") || ref.includes("/evidence-tasks/")) return "evidence_task"
  return "artifact_record"
}

function addStockIdentityCandidatesFromRecord(map, record = {}, sourceRef = "") {
  const sourceKind = stockIdentitySourceKindForRecord(record, sourceRef)
  addStockIdentityCandidate(map, {
    code: record.stockCode ?? record.tsCode,
    name: record.stockName,
    sourceRef,
    sourceKind,
    context: [record.hypothesis, record.question, record.summary].filter(Boolean).join(" "),
  })
  addStockIdentityCandidate(map, {
    code: record.stock?.code,
    name: record.stock?.name,
    sourceRef,
    sourceKind,
    context: [record.hypothesis, record.question, record.summary].filter(Boolean).join(" "),
  })
  addStockIdentityCandidate(map, {
    code: record.instrument?.tsCode ?? record.instrument?.stockCode,
    name: record.instrument?.stockName,
    sourceRef,
    sourceKind,
    context: [record.attribution?.hypothesisText, record.executionSummary, record.review?.reason].filter(Boolean).join(" "),
  })
}

function extractStockPairsFromTextLine(line = "") {
  const text = safeErrorMessage(String(line ?? ""))
  const pairs = []
  const tableCells = text.includes("|")
    ? text.split("|").map((cell) => cell.trim()).filter(Boolean)
    : []
  for (let index = 0; index < tableCells.length; index += 1) {
    const code = normalizeStockCodeCandidate(tableCells[index])
    if (!code) continue
    const prev = normalizeStockNameCandidate(tableCells[index - 1])
    const next = normalizeStockNameCandidate(tableCells[index + 1])
    pairs.push({ code, name: next || prev })
  }
  const nameBeforeCode = /([\u4e00-\u9fa5A-Za-z]{2,16})\s*[（(]?\s*((?:SH|SZ|BJ)?\d{6}(?:\.(?:SH|SZ|BJ))?)\s*[）)]?/gi
  for (const match of text.matchAll(nameBeforeCode)) {
    const name = normalizeStockNameCandidate(match[1])
    const code = normalizeStockCodeCandidate(match[2])
    if (name && code) pairs.push({ code, name })
  }
  const codeBeforeName = /((?:SH|SZ|BJ)?\d{6}(?:\.(?:SH|SZ|BJ))?)\s*[）)]?\s*[,，、\s|：:]*\s*([\u4e00-\u9fa5A-Za-z]{2,16})/gi
  for (const match of text.matchAll(codeBeforeName)) {
    const code = normalizeStockCodeCandidate(match[1])
    const name = normalizeStockNameCandidate(match[2])
    if (name && code) pairs.push({ code, name })
  }
  return pairs
}

async function collectStockIdentityUniverse(projectPath) {
  const map = new Map()
  const artifactRoots = [
    ".llm-wiki/stock-feedback/evidence-tasks",
    ".llm-wiki/stock-feedback/execution-results",
    ".llm-wiki/stock-feedback/paper-trades",
    ".llm-wiki/stock-feedback/paper-trade-agent",
    ".llm-wiki/stock-feedback/trajectories",
  ]
  for (const root of artifactRoots) {
    const records = await readJsonlRecords(projectPath, root)
    for (const record of records) {
      addStockIdentityCandidatesFromRecord(map, record, record.artifactPath)
    }
  }
  const textRoots = [
    "raw/交割单",
    "raw/日复盘",
    "wiki/position-tracking.md",
    "wiki/sources",
  ]
  for (const relativeRoot of textRoots) {
    const fullPath = path.join(projectPath, relativeRoot)
    let files = []
    try {
      const stat = await fs.stat(fullPath)
      files = stat.isFile()
        ? [fullPath]
        : await listFilesRecursive(fullPath, { extensions: new Set([".md", ".markdown", ".txt"]), maxBytes: 1024 * 1024 * 3 })
    } catch {
      files = []
    }
    for (const filePath of files.slice(0, 600)) {
      const raw = await readIfExists(filePath)
      if (!raw.trim()) continue
      let lineNo = 0
      for (const line of raw.split(/\r?\n/)) {
        lineNo += 1
        const pairs = extractStockPairsFromTextLine(line)
        const sourceKind = relativeRoot.startsWith("raw/交割单")
          ? "delivery_note"
          : relativeRoot.startsWith("raw/日复盘")
            ? "daily_review"
            : relativeRoot === "wiki/position-tracking.md"
              ? "position_tracking"
              : "wiki_source"
        for (const pair of pairs) {
          addStockIdentityCandidate(map, {
            ...pair,
            sourceKind,
            sourceRef: `${projectRelative(projectPath, filePath)}:${lineNo}`,
            context: line.slice(0, 240),
          })
        }
      }
    }
  }
  return [...map.values()]
    .filter((item) => item.code || item.name)
    .sort((a, b) => String(a.name ?? a.code).localeCompare(String(b.name ?? b.code), "zh-Hans-CN"))
}

function stockCandidateDraftText(draft = {}) {
  const task = draft.suggestedStockFeedbackEvidenceTask ?? {}
  return [
    draft.hypothesisTitle,
    draft.status,
    task.taskType,
    ...(task.targetFields ?? []),
    ...(task.sourceRefs ?? []),
    ...(draft.qualityGate?.segments ?? []),
    draft.qualityGate?.theme,
    ...(draft.candidateFields?.coreDrivers ?? []),
    ...(draft.candidateFields?.marketMispricing ?? []),
    ...(draft.candidateFields?.falsifiableConditions ?? []),
  ].filter(Boolean).join(" ")
}

function extractResearchTokens(text = "") {
  const raw = safeErrorMessage(String(text ?? ""))
  return [
    "AI",
    "PCB",
    "CCL",
    "ABF",
    "CPO",
    "MPO",
    "PPO",
    "ASP",
    "HVLP",
    "HBM",
    "光纤",
    "光缆",
    "光模块",
    "高速",
    "互联",
    "连接器",
    "数据中心",
    "服务器",
    "订单",
    "交付",
    "客户",
    "收入",
    "毛利",
    "涨价",
    "顺价",
    "铜箔",
    "覆铜板",
    "树脂",
    "跳线",
    "集采",
    "反证",
    "降价",
    "砍单",
    "量价",
    "承接",
  ].filter((token) => raw.toLowerCase().includes(token.toLowerCase())).slice(0, 40)
}

const BROAD_RESEARCH_TOKENS = new Set(["AI", "订单", "客户", "收入", "毛利", "交付", "量价", "承接"])
const TOKEN_INFERENCE_SOURCE_KINDS = new Set(["daily_review", "wiki_source", "evidence_task", "trajectory", "paper_trade_agent"])

function scoreStockIdentityCandidateForDraft(draft = {}, candidate = {}) {
  const draftText = stockCandidateDraftText(draft)
  const lowerDraft = draftText.toLowerCase()
  const contextText = [candidate.name, candidate.code, ...(candidate.contexts ?? [])].filter(Boolean).join(" ")
  const lowerContext = contextText.toLowerCase()
  let score = 0
  const reasons = []
  let directMatch = false
  if (candidate.code && lowerDraft.includes(String(candidate.code).toLowerCase())) {
    score += 95
    reasons.push("code_direct_match")
    directMatch = true
  }
  if (candidate.name && draftText.includes(candidate.name)) {
    score += 85
    reasons.push("name_direct_match")
    directMatch = true
  }
  const tokens = extractResearchTokens(draftText)
  const matchedTokens = tokens.filter((token) => lowerContext.includes(String(token).toLowerCase()))
  const strongMatchedTokens = matchedTokens.filter((token) => !BROAD_RESEARCH_TOKENS.has(String(token)))
  const allowsTokenInference = (candidate.sourceKinds ?? []).some((kind) => TOKEN_INFERENCE_SOURCE_KINDS.has(String(kind)))
  if (!directMatch && !allowsTokenInference) {
    return {
      score: 0,
      confidence: "discard",
      reasons,
      matchedTokens,
      strongMatchedTokens,
    }
  }
  if (!directMatch && strongMatchedTokens.length === 0) {
    return {
      score: 0,
      confidence: "discard",
      reasons,
      matchedTokens,
      strongMatchedTokens,
    }
  }
  if (matchedTokens.length) {
    score += Math.min(45, matchedTokens.length * 8)
    reasons.push("research_token_overlap")
  }
  if ((candidate.sourceKinds ?? []).includes("delivery_note")) score += 8
  if ((candidate.sourceKinds ?? []).includes("execution_result")) score += 8
  if ((candidate.sourceKinds ?? []).includes("daily_review")) score += 5
  if ((candidate.sourceRefs ?? []).length >= 2) score += 5
  const confidence = score >= 85 ? "high" : score >= 45 ? "medium" : score >= 18 ? "low" : "discard"
  return {
    score,
    confidence,
    reasons,
    matchedTokens,
    strongMatchedTokens,
  }
}

async function stockIdentityCandidatesForDraft(projectPath, draft = {}, options = {}) {
  const limit = Math.max(1, Number(options.limit ?? 5) || 5)
  const universe = options.universe ?? await collectStockIdentityUniverse(projectPath)
  return universe
    .map((candidate) => {
      const scored = scoreStockIdentityCandidateForDraft(draft, candidate)
      return {
        code: candidate.code ?? null,
        name: candidate.name ?? null,
        score: scored.score,
        confidence: scored.confidence,
        reasons: scored.reasons,
        matchedTokens: scored.matchedTokens,
        strongMatchedTokens: scored.strongMatchedTokens,
        sourceKinds: candidate.sourceKinds ?? [],
        sourceRefs: (candidate.sourceRefs ?? []).slice(0, 8),
        contexts: (candidate.contexts ?? []).slice(0, 3),
      }
    })
    .filter((candidate) => candidate.confidence !== "discard")
    .sort((a, b) => Number(b.score ?? 0) - Number(a.score ?? 0) || String(a.name ?? a.code).localeCompare(String(b.name ?? b.code), "zh-Hans-CN"))
    .slice(0, limit)
}

function stockIdentityCandidateGate(candidates = []) {
  const usable = candidates.filter((candidate) => candidate.code)
  if (usable.length === 0) {
    return {
      status: "needs_stock_identity",
      recommendedAction: "provide_explicit_stock_code_and_stock_name",
      recommendedCandidateIndex: null,
      requiresExtraConfirmation: false,
    }
  }
  const top = usable[0]
  const recommendedCandidateIndex = candidates.findIndex((candidate) => candidate.code === top.code) + 1
  if (["high", "medium"].includes(top.confidence)) {
    return {
      status: "candidate_review_ready",
      recommendedAction: "review_candidate_then_promote_with_candidate_index",
      recommendedCandidateIndex,
      requiresExtraConfirmation: false,
      confidence: top.confidence,
    }
  }
  return {
    status: "low_confidence_candidates",
    recommendedAction: "manual_confirm_candidate_or_provide_explicit_stock_identity",
    recommendedCandidateIndex,
    requiresExtraConfirmation: true,
    confirmationFlag: "--confirm-low-confidence-candidate true",
    confidence: top.confidence,
  }
}

export async function listHypothesisEvidenceTaskDrafts(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const limit = Math.max(1, Number(options.limit ?? 100) || 100)
  const latestOnly = options.latestOnly !== false && options["all-batches"] !== true && !options.allBatches
  const includeStockCandidates = options.includeStockCandidates !== false && options["include-stock-candidates"] !== false
  const stockUniverse = includeStockCandidates ? await collectStockIdentityUniverse(projectPath) : []
  const stockIdentityGate = normalizeStockIdentityGateFilter(options.stockIdentityGate ?? options["stock-identity-gate"] ?? options.gate ?? "")
  const draftRecords = (await readHypothesisEvidenceTaskDraftRecords(projectPath, { latestOnly }))
    .filter((draft) => matchesHypothesisEvidenceTaskDraftFilters(draft, options))
    .sort((a, b) => String(b.generatedAt ?? "").localeCompare(String(a.generatedAt ?? "")) || String(a.hypothesisTitle ?? "").localeCompare(String(b.hypothesisTitle ?? "")))
  const drafts = []
  for (const draft of draftRecords) {
    const compact = compactHypothesisEvidenceTaskDraftForList({
      ...draft,
      stockIdentityCandidates: includeStockCandidates ? await stockIdentityCandidatesForDraft(projectPath, draft, { universe: stockUniverse, limit: options.candidateLimit ?? options["candidate-limit"] ?? 5 }) : [],
    })
    if (stockIdentityGate && compact.stockIdentityCandidateGate?.status !== stockIdentityGate) continue
    drafts.push(compact)
    if (drafts.length >= limit) break
  }
  return {
    schema: "trading-hypothesis-evidence-task-draft-list-v1",
    mode: "hypothesis-evidence-task-draft-list",
    projectPath,
    filters: {
      id: options.id ?? options.draftId ?? options["draft-id"] ?? null,
      hypothesisId: options.hypothesisId ?? options["hypothesis-id"] ?? null,
      status: options.status ?? null,
      taskType: options.taskType ?? options["task-type"] ?? null,
      readiness: options.readiness ?? null,
      stockIdentityGate: stockIdentityGate || null,
      latestOnly,
      includeStockCandidates,
      limit,
    },
    count: drafts.length,
    drafts,
    writePolicy: {
      readOnly: true,
      wroteStockFeedbackEvidenceTask: false,
      wroteHypothesisStatus: false,
      wroteWiki: false,
      wroteRaw: false,
      wroteBrain: false,
      wroteArtifacts: false,
    },
  }
}

function stockIdentityCandidateRequiresExtraConfirmation(candidate = null) {
  return Boolean(candidate?.code) && !["high", "medium"].includes(candidate.confidence)
}

export async function reviewHypothesisEvidenceTaskDraft(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const generatedAt = String(options.generatedAt ?? nowLocalTimestamp())
  const draftId = safeErrorMessage(String(options.id ?? options.draftId ?? options["draft-id"] ?? "").trim())
  const hypothesisId = safeErrorMessage(String(options.hypothesisId ?? options["hypothesis-id"] ?? "").trim())
  if (!draftId && !hypothesisId) throw new Error("hypothesis evidence-task-draft-review requires --draft-id or --hypothesis-id")
  const drafts = await readHypothesisEvidenceTaskDraftRecords(projectPath, { latestOnly: options.latestOnly !== false && options["all-batches"] !== true && !options.allBatches })
  const draft = drafts.find((item) => (draftId && item.id === draftId) || (hypothesisId && item.hypothesisId === hypothesisId))
  if (!draft) throw new Error(`Unknown hypothesis evidence-task draft: ${draftId || hypothesisId}`)
  const suggested = draft.suggestedStockFeedbackEvidenceTask ?? {}
  const candidateIndex = Number(options.candidateIndex ?? options["candidate-index"] ?? options.useCandidate ?? options["use-candidate"] ?? 0)
  let selectedCandidate = null
  if (!options.stockCode && !options["stock-code"] && candidateIndex > 0) {
    const candidates = await stockIdentityCandidatesForDraft(projectPath, draft, { limit: Math.max(5, candidateIndex) })
    selectedCandidate = candidates[candidateIndex - 1] ?? null
  }
  const stockCode = safeErrorMessage(String(options.stockCode ?? options["stock-code"] ?? selectedCandidate?.code ?? suggested.stockCode ?? "").trim())
  if (!stockCode) throw new Error("hypothesis evidence-task-draft-review requires --stock-code before promoting to stock-feedback evidence task")
  const stockName = safeErrorMessage(String(options.stockName ?? options["stock-name"] ?? selectedCandidate?.name ?? suggested.stockName ?? "").trim())
  const action = safeErrorMessage(String(options.action ?? "promote_to_evidence_task").trim())
  if (!["promote_to_evidence_task", "promote", "create_evidence_task"].includes(action)) throw new Error("--action must be promote_to_evidence_task")
  const confirmed = normalizeHumanGateConfirmation(options.confirmHumanGate ?? options["confirm-human-gate"])
  if (options.write && !confirmed) throw new Error("hypothesis evidence-task-draft-review --write requires --confirm-human-gate true")
  const lowConfidenceCandidateConfirmed = normalizeHumanGateConfirmation(options.confirmLowConfidenceCandidate ?? options["confirm-low-confidence-candidate"])
  const selectedCandidateGate = selectedCandidate
    ? {
        ...stockIdentityCandidateGate([selectedCandidate]),
        selectedCandidateIndex: candidateIndex || null,
        selectedConfidence: selectedCandidate.confidence ?? null,
      }
    : null
  if (options.write && stockIdentityCandidateRequiresExtraConfirmation(selectedCandidate) && !lowConfidenceCandidateConfirmed) {
    throw new Error("hypothesis evidence-task-draft-review --write with low-confidence --candidate-index requires --confirm-low-confidence-candidate true or explicit --stock-code/--stock-name")
  }
  const createResult = await createStockFeedbackEvidenceTask({
    projectPath,
    source: "hypothesis",
    sourceId: suggested.sourceId ?? draft.hypothesisId,
    stockCode,
    stockName,
    taskType: options.taskType ?? options["task-type"] ?? suggested.taskType,
    targetFields: options.targetFields ?? options["target-fields"] ?? suggested.targetFields,
    preferredSources: options.preferredSources ?? options["preferred-sources"] ?? suggested.preferredSources,
    priority: options.priority ?? suggested.priority,
    notes: options.notes ?? suggested.notes,
    sourceRefs: options.sourceRefs ?? options["source-refs"] ?? suggested.sourceRefs,
    generatedAt,
    write: Boolean(options.write),
  })
  return {
    schema: "trading-hypothesis-evidence-task-draft-review-v1",
    mode: "hypothesis-evidence-task-draft-review",
    dryRun: !Boolean(options.write),
    projectPath,
    generatedAt,
    action: "promote_to_evidence_task",
    draft: compactHypothesisEvidenceTaskDraftForList(draft),
    selectedStockIdentityCandidate: selectedCandidate,
    selectedStockIdentityCandidateGate: selectedCandidateGate,
    humanGate: {
      required: true,
      confirmed,
      status: confirmed ? "confirmed" : "pending_human_gate",
      reason: selectedCandidateGate?.requiresExtraConfirmation
        ? "Formal EvidenceTask creation uses a low-confidence stock candidate and needs explicit second confirmation before write."
        : "Formal EvidenceTask creation needs one-draft HumanGate confirmation.",
    },
    stockFeedbackEvidenceTask: createResult.task,
    stockFeedbackEvidenceTaskResult: {
      schema: createResult.schema,
      dryRun: createResult.dryRun,
      writeResult: createResult.writeResult,
      manifest: createResult.manifest,
    },
    writePolicy: {
      wroteStockFeedbackEvidenceTask: Boolean(options.write),
      wroteHypothesisStatus: false,
      wroteWiki: false,
      wroteRaw: false,
      wroteBrain: false,
      wroteArtifacts: Boolean(options.write),
      allowedRoot: ".llm-wiki/stock-feedback/evidence-tasks",
    },
  }
}

function scoreComponent(value, fallback = 0) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(0, Math.min(100, Math.round(n)))
}

function scoreTimeliness(generatedAt) {
  const ms = parseLooseTimestampMs(generatedAt)
  if (!ms) return 50
  const ageDays = Math.max(0, (Date.now() - ms) / 86400000)
  if (ageDays <= 3) return 95
  if (ageDays <= 14) return 85
  if (ageDays <= 45) return 70
  if (ageDays <= 120) return 55
  return 40
}

function normalizeFieldKey(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff]+/g, "")
}

function finiteNumericValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value
  const raw = String(value ?? "").trim().replace(/%$/, "")
  if (!raw) return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

function evidenceScoreForResult(result = {}, task = {}) {
  const sourceReliability = scoreComponent(result.qualityReport?.sourceReliability, result.status === "completed" ? 80 : 35)
  const okSources = (result.sources ?? []).filter((source) => source?.status === "ok")
  const sourceRefs = compactEvidenceRefs(result)
  const sampleSize = scoreComponent(Math.min(100, Math.max(okSources.length, sourceRefs.length) * 30), result.status === "completed" ? 60 : 20)
  const timeliness = scoreTimeliness(result.generatedAt ?? result.updatedAt)
  const directRelevance = scoreComponent(result.qualityReport?.fieldCompleteness, (task.targetFields ?? result.targetFields ?? []).length ? 60 : 45)
  const verifiability = scoreComponent(sourceRefs.length ? Math.min(100, sourceRefs.length * 35) : 0, 0)
  const total = scoreComponent(
    (sourceReliability * 0.25) +
    (sampleSize * 0.15) +
    (timeliness * 0.15) +
    (directRelevance * 0.25) +
    (verifiability * 0.2),
  )
  return { sourceReliability, sampleSize, timeliness, directRelevance, verifiability, total }
}

function compactEvidenceRefs(result = {}) {
  return uniqueNonEmpty([
    ...(result.evidenceRefs ?? []),
    ...(result.sourceRefs ?? []),
    ...(result.toolStateRefs ?? []),
    result.artifactPath,
  ]).slice(0, 16)
}

function evidenceTextForResult(result = {}, task = {}) {
  return [
    task.taskType,
    task.notes,
    task.targetFields?.join(" "),
    result.status,
    result.summary,
    result.humanGate?.reason,
    result.crossValidation?.status,
    JSON.stringify(result.structuredData ?? {}),
  ].filter(Boolean).join(" ")
}

function directionForEvidenceResult(result = {}, task = {}) {
  const text = evidenceTextForResult(result, task)
  if (result.status === "rejected" || result.status === "failed") return "weakening"
  if (result.crossValidation?.conflictCount > 0) return "neutral"
  if (NEGATIVE_EVIDENCE_PATTERNS.some((pattern) => pattern.test(text))) return "weakening"
  if (result.status === "completed" && (result.humanGate?.status === "auto_ready" || result.humanGate?.status === "approved")) return "strengthening"
  if (POSITIVE_EVIDENCE_PATTERNS.some((pattern) => pattern.test(text))) return "strengthening"
  return "neutral"
}

function compareNumeric(actual, operator, expected) {
  if (operator === ">") return actual > expected
  if (operator === ">=") return actual >= expected
  if (operator === "<") return actual < expected
  if (operator === "<=") return actual <= expected
  if (operator === "=" || operator === "==") return actual === expected
  return false
}

function detectNumericFalsifiableTrigger(condition, result = {}) {
  const match = String(condition ?? "").match(/([A-Za-z_\u4e00-\u9fff][\w\u4e00-\u9fff]*)\s*(<=|>=|==|=|<|>)\s*(-?\d+(?:\.\d+)?)(%?)/)
  if (!match) return null
  const [, fieldRaw, operator, expectedRaw] = match
  const expected = Number(expectedRaw)
  const fieldKey = normalizeFieldKey(fieldRaw)
  const entries = Object.entries(result.structuredData ?? {})
  const found = entries.find(([key]) => normalizeFieldKey(key) === fieldKey || normalizeFieldKey(key).includes(fieldKey) || fieldKey.includes(normalizeFieldKey(key)))
  if (!found) return {
    type: "numeric",
    condition,
    field: fieldRaw,
    operator,
    expected,
    triggered: false,
    reason: "structured data does not contain the numeric field yet",
  }
  const actual = finiteNumericValue(found[1])
  return {
    type: "numeric",
    condition,
    field: found[0],
    operator,
    expected,
    actual,
    triggered: actual !== null ? compareNumeric(actual, operator, expected) : false,
    reason: actual !== null ? `${found[0]}=${actual} ${operator} ${expected}` : "field is present but not numeric",
  }
}

function detectDateFalsifiableTrigger(condition, result = {}) {
  const match = String(condition ?? "").match(/(\d{4}-\d{2}-\d{2})/)
  if (!match) return null
  const deadline = match[1]
  const resultDate = String(result.generatedAt ?? result.updatedAt ?? "").slice(0, 10)
  if (!resultDate) return {
    type: "date",
    condition,
    deadline,
    triggered: false,
    reason: "evidence result has no comparable date",
  }
  const triggered = Date.parse(resultDate) >= Date.parse(deadline)
  return {
    type: "date",
    condition,
    deadline,
    evidenceDate: resultDate,
    triggered,
    reason: triggered ? `evidence date reached ${deadline}` : `evidence date is before ${deadline}`,
  }
}

function detectTextFalsifiableTrigger(condition, result = {}, task = {}) {
  const text = evidenceTextForResult(result, task)
  const explicit = String(condition ?? "").match(/(?:contains|包含|出现)[:：]?\s*([^,，；;\n]+)/i)
  const term = explicit?.[1]?.trim()
  if (!term) return null
  return {
    type: "text_contains",
    condition,
    term,
    triggered: text.includes(term),
    reason: text.includes(term) ? `evidence text contains ${term}` : `evidence text does not contain ${term}`,
  }
}

function detectFalsifiableTriggers(conditions = [], evidenceItems = []) {
  const triggers = []
  for (const condition of conditions) {
    for (const item of evidenceItems) {
      const result = item.rawResult ?? {}
      const task = item.rawTask ?? {}
      for (const trigger of [
        detectNumericFalsifiableTrigger(condition, result),
        detectDateFalsifiableTrigger(condition, result),
        detectTextFalsifiableTrigger(condition, result, task),
      ]) {
        if (trigger) {
          triggers.push({
            ...trigger,
            evidenceResultId: result.resultId ?? item.evidenceResultId ?? null,
            taskId: result.taskId ?? task.taskId ?? null,
          })
        }
      }
    }
  }
  return triggers
}

function linkedHypothesisIdForEvidenceResult(result = {}, tasksById = new Map()) {
  if (result.source === "hypothesis" && result.sourceId) return result.sourceId
  const task = tasksById.get(result.taskId)
  if (task?.source === "hypothesis" && task.sourceId) return task.sourceId
  return result.sourceId ?? task?.sourceId ?? null
}

function stockFeedbackTrajectoryForEvidenceResult(result = {}, task = {}, trajectoriesById = new Map()) {
  const source = result.source ?? task.source
  const sourceId = result.sourceId ?? task.sourceId
  if (source !== "stock_feedback" || !sourceId) return null
  return trajectoriesById.get(sourceId) ?? null
}

function hypothesisRefsTrajectory(hypothesis = {}, trajectory = {}) {
  const trajectoryId = safeErrorMessage(String(trajectory.id ?? "").trim())
  if (!trajectoryId) return false
  const values = hypothesisQualityFieldValues(hypothesis)
  const refs = uniqueNonEmpty([
    ...values.sourceRefs,
    hypothesis.relativePath,
  ])
  const tokens = uniqueNonEmpty([
    trajectoryId,
    `stock-feedback-trajectory:${trajectoryId}`,
    `stock-feedback:${trajectoryId}`,
    trajectory.sourceRecordId ? `self-question-attribution:${trajectory.sourceRecordId}` : "",
    trajectory.artifactPath,
  ])
  return refs.some((ref) => tokens.some((token) => ref === token || (token && ref.includes(token))))
}

function evidenceLinkageForHypothesis({ result = {}, task = {}, trajectory = null, hypothesis = {}, tasksById = new Map(), linksByEvidenceResultId = new Map() } = {}) {
  const approvedLink = (linksByEvidenceResultId.get(result.resultId) ?? []).find((link) => link.hypothesisId === hypothesis.id)
  if (approvedLink) {
    return {
      kind: "human_approved_evidence_link",
      confidence: "human_confirmed",
      evidenceLinkId: approvedLink.id ?? null,
      sourceTrajectoryId: approvedLink.sourceTrajectoryId ?? trajectory?.id ?? null,
    }
  }
  const linkedId = linkedHypothesisIdForEvidenceResult(result, tasksById)
  if (linkedId === hypothesis.id) {
    return {
      kind: task.source === "hypothesis" || result.source === "hypothesis" ? "hypothesis_evidence_task" : "explicit_hypothesis_ref",
      confidence: "explicit",
      sourceId: linkedId,
    }
  }
  if (trajectory && hypothesisRefsTrajectory(hypothesis, trajectory)) {
    return {
      kind: "stock_feedback_trajectory_ref",
      confidence: "explicit",
      sourceTrajectoryId: trajectory.id ?? null,
    }
  }
  return null
}

function compactHypothesisEvidenceItem(result = {}, task = {}, context = {}) {
  const score = evidenceScoreForResult(result, task)
  const direction = directionForEvidenceResult(result, task)
  const sourceKind = result.source ?? task.source ?? null
  const sourceId = result.sourceId ?? task.sourceId ?? null
  const sourceTrajectoryId = context.trajectory?.id ?? (sourceKind === "stock_feedback" ? sourceId : null)
  return {
    evidenceResultId: result.resultId ?? null,
    taskId: result.taskId ?? task.taskId ?? null,
    sourceKind,
    sourceId,
    sourceTrajectoryId,
    linkage: context.linkage ?? null,
    generatedAt: result.generatedAt ?? null,
    updatedAt: result.updatedAt ?? null,
    direction,
    score,
    status: result.status ?? null,
    stockCode: result.stockCode ?? task.stockCode ?? null,
    stockName: result.stockName ?? task.stockName ?? null,
    humanGate: result.humanGate ? {
      status: result.humanGate.status ?? null,
      action: result.humanGate.action ?? null,
      reviewer: result.humanGate.reviewer ?? null,
      reason: result.humanGate.reason ?? null,
    } : null,
    taskType: result.taskType ?? task.taskType ?? null,
    targetFields: compactStringArray(result.targetFields ?? task.targetFields, 12, 80),
    sourceRefs: compactStringArray(result.sourceRefs, 12, 180),
    evidenceRefs: compactEvidenceRefs(result),
    artifactRef: result.artifactPath ? `${result.artifactPath}:${result.artifactLine ?? ""}`.replace(/:$/, "") : null,
    summary: safeErrorMessage(String(result.summary ?? "")).slice(0, 500),
    rawResult: result,
    rawTask: task,
  }
}

function aggregateEvidenceScore(evidenceList = []) {
  if (!evidenceList.length) {
    return {
      sourceReliability: 0,
      sampleSize: 0,
      timeliness: 0,
      directRelevance: 0,
      verifiability: 0,
      total: 0,
    }
  }
  const fields = ["sourceReliability", "sampleSize", "timeliness", "directRelevance", "verifiability", "total"]
  return Object.fromEntries(fields.map((field) => [
    field,
    scoreComponent(evidenceList.reduce((sum, item) => sum + Number(item.score?.[field] ?? 0), 0) / evidenceList.length),
  ]))
}

function watchtowerCandidateForHypothesis({ hypothesis, evidenceList, evidenceScore, triggers }) {
  const directions = evidenceList.reduce((counts, item) => {
    counts[item.direction] = (counts[item.direction] ?? 0) + 1
    return counts
  }, {})
  const currentStatus = hypothesis.status ?? "watching"
  const hasTriggeredFalsifier = triggers.some((trigger) => trigger.triggered)
  const resultText = evidenceList.map((item) => item.summary).join(" ")
  let suggestedStatus = currentStatus
  let action = "keep_watching"
  let reason = "证据还不足以建议状态迁移。"
  if (hasTriggeredFalsifier || (directions.weakening ?? 0) > (directions.strengthening ?? 0)) {
    suggestedStatus = "disconfirmed"
    action = "recommend_disconfirm"
    reason = hasTriggeredFalsifier ? "可证伪条件被证据触发。" : "弱化证据多于强化证据。"
  } else if (/priced[_ -]?in|赔率压缩|后手|拥挤|追高|高位/.test(resultText)) {
    suggestedStatus = "priced_in"
    action = "recommend_priced_in"
    reason = "证据显示方向可能已被市场交易，后手赔率压缩。"
  } else if ((directions.strengthening ?? 0) > 0 && evidenceScore.total >= 70) {
    suggestedStatus = currentStatus === "actionable" ? "actionable" : "strengthening"
    action = "recommend_strengthen"
    reason = "EvidenceResult 证据质量和可验证性支持提高假设强度。"
  }
  return {
    source: "watchtower_evidence_candidate",
    recommendationOnly: true,
    currentStatus,
    suggestedStatus,
    action,
    confidence: scoreComponent(evidenceScore.total),
    reason,
    directions,
    risks: [
      "自动推荐不改正式 hypothesis 状态",
      "需要用户确认后才写 hypothesis event",
      evidenceScore.verifiability < 60 ? "证据引用偏少，需补 sourceRefs/toolStateRefs" : "",
    ].filter(Boolean),
  }
}

function humanGateRecommendationForHypothesis({ hypothesis, candidate, evidenceScore, triggers }) {
  const shouldChange = candidate.suggestedStatus && candidate.suggestedStatus !== (hypothesis.status ?? "watching")
  return {
    recommendedAction: shouldChange ? "confirm_status_update" : "keep_watch",
    targetStatus: candidate.suggestedStatus,
    confidence: scoreComponent((candidate.confidence ?? evidenceScore.total) - (triggers.some((item) => item.triggered) ? 0 : 5)),
    reason: shouldChange
      ? `建议 ${hypothesisStatusLabelLocal(hypothesis.status)} -> ${hypothesisStatusLabelLocal(candidate.suggestedStatus)}；${candidate.reason}`
      : candidate.reason,
    risks: candidate.risks ?? [],
    writeCommand: shouldChange
      ? `hypothesis status-update --id ${hypothesis.id} --status ${candidate.suggestedStatus} --reason "${candidate.reason}" --event-ref hypothesis-evidence-feedback:${hypothesis.id} --write`
      : null,
  }
}

function hypothesisStatusLabelLocal(status) {
  const labels = {
    seed: "seed",
    watching: "watching",
    strengthening: "strengthening",
    actionable: "actionable",
    priced_in: "priced_in",
    divergent: "divergent",
    disconfirmed: "disconfirmed",
    archived: "archived",
  }
  return labels[status] ?? status ?? "watching"
}

function trainingRoutesForHypothesisFeedback({ hypothesis, candidate, evidenceList, triggers }) {
  const routes = []
  const hasConfirmedEvidence = evidenceList.some((item) => item.direction === "strengthening" && item.score?.total >= 70)
  if (hasConfirmedEvidence) {
    routes.push({
      route: "confirmed_evidence_to_trajectory",
      target: "stock-feedback trajectory",
      reason: "confirmed EvidenceResult can seed a verifiable trajectory without copying raw facts",
    })
  }
  if (candidate.suggestedStatus === "disconfirmed" || triggers.some((item) => item.triggered)) {
    routes.push({
      route: "negative_eval",
      target: "eval/preference",
      reason: "disconfirmed hypothesis becomes falsification and failure-attribution training",
    })
  }
  if (candidate.suggestedStatus === "priced_in") {
    routes.push({
      route: "preference_entry_wrong",
      target: "preference/entry_wrong",
      reason: "priced-in result trains direction-right but entry-risk behavior",
    })
  }
  if (["archived", "disconfirmed", "priced_in"].includes(hypothesis.status)) {
    routes.push({
      route: "post_mortem_adapter_candidate",
      target: "adapter candidate",
      reason: "post-mortem contributes behavior and decision strategy only",
    })
  }
  return routes
}

function stockKeyForFeedback(item = {}) {
  return [item.stockCode ?? item.code, item.stockName ?? item.name].filter(Boolean).join("|")
}

function hypothesisFeedbackRefsAndStocks({ candidateFields = {}, evidenceList = [] } = {}) {
  const sourceRefs = uniqueNonEmpty([
    ...(candidateFields.sourceRefs ?? []),
    ...evidenceList.flatMap((item) => item.sourceRefs ?? []),
  ]).slice(0, 20)
  const evidenceRefs = uniqueNonEmpty([
    ...evidenceList.flatMap((item) => item.evidenceRefs ?? []),
    ...evidenceList.map((item) => item.artifactRef),
  ]).slice(0, 24)
  const seenStocks = new Set()
  const stocks = []
  for (const item of evidenceList) {
    const stock = {
      code: safeErrorMessage(String(item.stockCode ?? "").trim()) || null,
      name: safeErrorMessage(String(item.stockName ?? "").trim()) || null,
    }
    const key = stockKeyForFeedback(stock)
    if (!key || seenStocks.has(key)) continue
    seenStocks.add(key)
    stocks.push(stock)
  }
  return { sourceRefs, evidenceRefs, stocks: stocks.slice(0, 8) }
}

function readinessForHypothesisEvidenceFeedback({ evidenceList = [], sourceRefs = [], evidenceRefs = [], stocks = [], evidenceScore = {}, trainingFlywheelRoutes = [] } = {}) {
  const missing = []
  if (!evidenceList.length) missing.push("evidenceResults")
  if (!sourceRefs.length) missing.push("sourceRefs")
  if (!evidenceRefs.length) missing.push("evidenceRefs")
  if (!stocks.some((stock) => stock.code || stock.name)) missing.push("stockIdentity")
  const canSeedTrajectory = trainingFlywheelRoutes.some((item) => item.route === "confirmed_evidence_to_trajectory")
  const canSeedPaperTrade = canSeedTrajectory && !missing.includes("evidenceRefs") && !missing.includes("stockIdentity")
  return {
    status: canSeedPaperTrade ? "paper_trade_candidate_ready" : missing.length ? "needs_evidence" : "review_required",
    canSeedTrajectory,
    canSeedPaperTrade,
    missing,
    nextAction: canSeedPaperTrade
      ? "run stock-feedback paper-trade-agent candidates"
      : missing.includes("evidenceResults")
        ? "create and run stock-feedback evidence-task with source=hypothesis and source-id=this hypothesis"
        : missing.includes("sourceRefs") || missing.includes("evidenceRefs")
          ? "attach sourceRefs/evidenceRefs before training flywheel routing"
          : missing.includes("stockIdentity")
            ? "attach stockCode/stockName through EvidenceResult before paper trade"
            : "human review required before routing",
    score: scoreComponent(evidenceScore.total),
  }
}

function stripRawEvidenceForFeedback(item = {}) {
  const { rawResult, rawTask, ...rest } = item
  return rest
}

async function allocateHypothesisArtifactPath(projectPath, relativeRoot, baseName, generatedAt) {
  const dir = path.join(projectPath, relativeRoot)
  const stamp = timestampForPath(generatedAt) || "run"
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const suffix = attempt === 0 ? stamp : `${stamp}-${attempt}`
    const jsonl = path.join(dir, `${baseName}-${suffix}.jsonl`)
    const manifest = path.join(dir, `${baseName}-${suffix}.manifest.json`)
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
  throw new Error(`Unable to allocate hypothesis artifact path for ${relativeRoot}`)
}

async function writeHypothesisJsonlWithManifest({ projectPath, relativeRoot, baseName, records, manifest, generatedAt }) {
  const paths = await allocateHypothesisArtifactPath(projectPath, relativeRoot, baseName, generatedAt)
  await ensureDirectory(paths.dir)
  await fs.writeFile(paths.jsonl, records.map((record) => JSON.stringify(record)).join("\n") + (records.length ? "\n" : ""), "utf8")
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

export async function buildHypothesisEvidenceFeedback(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const generatedAt = String(options.generatedAt ?? nowLocalTimestamp())
  const id = safeErrorMessage(String(options.id ?? options["hypothesis-id"] ?? "").trim())
  const limit = Math.max(1, Number(options.limit ?? 100) || 100)
  const listed = await listHypotheses({
    projectPath,
    status: options.status,
    theme: options.theme,
    segment: options.segment,
  })
  const hypotheses = listed.hypotheses
    .filter((hypothesis) => !id || hypothesis.id === id)
    .slice(0, limit)
  if (id && hypotheses.length === 0) throw new Error(`Unknown hypothesis id: ${id}`)
  const { tasksById, results, trajectoriesById } = await readStockFeedbackEvidenceForHypotheses(projectPath)
  const linksByEvidenceResultId = groupEvidenceLinksByResultId(await readHypothesisEvidenceLinkRecords(projectPath))
  const records = hypotheses.map((hypothesis) => {
    const qualityGate = qualityCheckHypothesisRecord(hypothesis)
    const candidateFields = hypothesisQualityFieldValues(hypothesis)
    const relevantEvidence = results
      .map((result) => {
        const task = tasksById.get(result.taskId) ?? {}
        const trajectory = stockFeedbackTrajectoryForEvidenceResult(result, task, trajectoriesById)
        const linkage = evidenceLinkageForHypothesis({ result, task, trajectory, hypothesis, tasksById, linksByEvidenceResultId })
        return { result, task, trajectory, linkage }
      })
      .filter((item) => item.linkage)
      .sort((a, b) => String(b.result.updatedAt ?? b.result.generatedAt ?? "").localeCompare(String(a.result.updatedAt ?? a.result.generatedAt ?? "")))
      .map((item) => compactHypothesisEvidenceItem(item.result, item.task, { trajectory: item.trajectory, linkage: item.linkage }))
    const triggers = detectFalsifiableTriggers(candidateFields.falsifiableConditions, relevantEvidence)
    const evidenceScore = aggregateEvidenceScore(relevantEvidence)
    const watchtowerCandidate = watchtowerCandidateForHypothesis({ hypothesis, evidenceList: relevantEvidence, evidenceScore, triggers })
    const humanGate = humanGateRecommendationForHypothesis({ hypothesis, candidate: watchtowerCandidate, evidenceScore, triggers })
    const trainingFlywheelRoutes = trainingRoutesForHypothesisFeedback({
      hypothesis,
      candidate: watchtowerCandidate,
      evidenceList: relevantEvidence,
      triggers,
    })
    const refsAndStocks = hypothesisFeedbackRefsAndStocks({ candidateFields, evidenceList: relevantEvidence })
    const feedbackReadiness = readinessForHypothesisEvidenceFeedback({
      evidenceList: relevantEvidence,
      sourceRefs: refsAndStocks.sourceRefs,
      evidenceRefs: refsAndStocks.evidenceRefs,
      stocks: refsAndStocks.stocks,
      evidenceScore,
      trainingFlywheelRoutes,
    })
    return {
      schema: HYPOTHESIS_EVIDENCE_FEEDBACK_SCHEMA,
      id: `hypothesis_evidence_feedback_${shortHash(`${hypothesis.id}:${generatedAt}:${relevantEvidence.length}:${evidenceScore.total}`)}`,
      generatedAt,
      hypothesisId: hypothesis.id,
      hypothesisTitle: hypothesis.title ?? hypothesis.id,
      status: hypothesis.status ?? "watching",
      qualityGate,
      candidateFields,
      evidenceScore,
      sourceRefs: refsAndStocks.sourceRefs,
      evidenceRefs: refsAndStocks.evidenceRefs,
      stocks: refsAndStocks.stocks,
      readiness: feedbackReadiness,
      evidenceDirectionCounts: relevantEvidence.reduce((counts, item) => {
        counts[item.direction] = (counts[item.direction] ?? 0) + 1
        return counts
      }, {}),
      evidenceList: relevantEvidence.map(stripRawEvidenceForFeedback),
      falsifiableTriggerDetections: triggers.map((trigger) => ({
        ...trigger,
        triggerClass: trigger.triggered ? "triggered" : "not_triggered",
      })),
      watchtowerCandidate,
      humanGate,
      trainingFlywheelRoutes,
      postMortemRecommended: ["archived", "disconfirmed", "priced_in"].includes(hypothesis.status),
      peftBoundary: {
        storesRawFacts: false,
        factsRemainIn: ["retrieval/tool state", "sourceRefs", "EvidenceResult artifact refs"],
        adapterStores: ["behavior", "skill", "tool_habit", "decision_strategy"],
      },
      writePolicy: {
        recommendationOnly: true,
        wroteHypothesisStatus: false,
        wroteWiki: false,
        wroteRaw: false,
        wroteBrain: false,
        wroteArtifacts: Boolean(options.write),
        allowedRoot: HYPOTHESIS_EVIDENCE_FEEDBACK_ROOT,
      },
    }
  })
  const linkedEvidenceResultIds = new Set(records.flatMap((item) => (item.evidenceList ?? []).map((evidence) => evidence.evidenceResultId).filter(Boolean)))
  const stockFeedbackEvidenceResultIds = results
    .filter((result) => {
      const task = tasksById.get(result.taskId) ?? {}
      return (result.source ?? task.source) === "stock_feedback"
    })
    .map((result) => result.resultId)
    .filter(Boolean)
  const manifest = {
    schema: HYPOTHESIS_EVIDENCE_FEEDBACK_MANIFEST_SCHEMA,
    generatedAt,
    projectPath,
    count: records.length,
    filters: { id: id || null, status: options.status ?? null, theme: options.theme ?? null, segment: options.segment ?? null, limit },
    evidenceResultCount: records.reduce((sum, item) => sum + item.evidenceList.length, 0),
    evidenceLinkageCounts: records.reduce((counts, item) => {
      for (const evidence of item.evidenceList ?? []) {
        const kind = evidence.linkage?.kind ?? "unknown"
        counts[kind] = (counts[kind] ?? 0) + 1
      }
      return counts
    }, {}),
    evidenceInputDiagnostics: {
      stockFeedbackEvidenceResults: stockFeedbackEvidenceResultIds.length,
      linkedStockFeedbackEvidenceResults: stockFeedbackEvidenceResultIds.filter((resultId) => linkedEvidenceResultIds.has(resultId)).length,
      unlinkedStockFeedbackEvidenceResults: stockFeedbackEvidenceResultIds.filter((resultId) => !linkedEvidenceResultIds.has(resultId)).length,
    },
    recommendationCounts: records.reduce((counts, item) => {
      const action = item.humanGate?.recommendedAction ?? "unknown"
      counts[action] = (counts[action] ?? 0) + 1
      return counts
    }, {}),
    writeBoundary: {
      root: HYPOTHESIS_EVIDENCE_FEEDBACK_ROOT,
      wroteHypothesisStatus: false,
      wroteWiki: false,
      wroteRaw: false,
      wroteBrain: false,
    },
    sources: [
      ".llm-wiki/hypotheses/*.json",
      ".llm-wiki/stock-feedback/evidence-tasks/*.jsonl",
      ".llm-wiki/stock-feedback/evidence-results/*.jsonl",
    ],
  }
  let writeResult = null
  if (options.write) {
    writeResult = await writeHypothesisJsonlWithManifest({
      projectPath,
      relativeRoot: HYPOTHESIS_EVIDENCE_FEEDBACK_ROOT,
      baseName: "hypothesis-evidence-feedback",
      records,
      manifest,
      generatedAt,
    })
  }
  return {
    schema: "trading-hypothesis-evidence-feedback-run-v1",
    mode: "hypothesis-evidence-feedback",
    dryRun: !Boolean(options.write),
    projectPath,
    generatedAt,
    count: records.length,
    items: records,
    manifest,
    writeResult: writeResult ? { feedback: writeResult.jsonl, manifest: writeResult.manifest } : null,
    writePolicy: {
      recommendationOnly: true,
      wroteHypothesisStatus: false,
      wroteWiki: false,
      wroteRaw: false,
      wroteBrain: false,
      wroteArtifacts: Boolean(options.write),
      allowedRoot: HYPOTHESIS_EVIDENCE_FEEDBACK_ROOT,
    },
  }
}

function postMortemDraftFromFeedback(feedback = {}, hypothesis = {}) {
  const evidenceList = feedback.evidenceList ?? []
  const triggered = (feedback.falsifiableTriggerDetections ?? []).filter((item) => item.triggered)
  return {
    schema: HYPOTHESIS_POST_MORTEM_DRAFT_SCHEMA,
    id: `hypothesis_post_mortem_${shortHash(`${feedback.hypothesisId}:${feedback.generatedAt}:${feedback.status}`)}`,
    generatedAt: feedback.generatedAt,
    hypothesisId: feedback.hypothesisId,
    hypothesisTitle: feedback.hypothesisTitle,
    terminalStatus: feedback.status,
    whyBullishAtTheTime: [
      hypothesis.title,
      ...(feedback.candidateFields?.coreDrivers ?? []),
      ...(feedback.candidateFields?.marketMispricing ?? []),
    ].filter(Boolean).slice(0, 8),
    supportingEvidence: evidenceList
      .filter((item) => item.direction === "strengthening")
      .map((item) => ({
        evidenceResultId: item.evidenceResultId,
        score: item.score?.total ?? 0,
        refs: compactStringArray(item.evidenceRefs, 6, 180),
      }))
      .slice(0, 8),
    whatWentWrong: [
      ...triggered.map((item) => item.reason),
      ...evidenceList.filter((item) => item.direction === "weakening").map((item) => item.summary || item.status),
    ].filter(Boolean).slice(0, 8),
    marketValidation: {
      suggestedStatus: feedback.watchtowerCandidate?.suggestedStatus ?? feedback.status,
      evidenceDirectionCounts: feedback.evidenceDirectionCounts ?? {},
      evidenceScore: feedback.evidenceScore ?? null,
    },
    hindsightRewriteRisk: evidenceList.some((item) => String(item.generatedAt ?? item.updatedAt ?? "") > String(hypothesis.updatedAt ?? hypothesis.createdAt ?? "")),
    trainingUse: ["post_mortem", "failure_attribution", "decision_strategy"],
    peftBoundary: {
      storesRawFacts: false,
      factsRemainIn: ["retrieval/tool state", "sourceRefs", "EvidenceResult artifact refs"],
      adapterStores: ["behavior", "skill", "tool_habit", "decision_strategy"],
    },
  }
}

export async function draftHypothesisPostMortems(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const generatedAt = String(options.generatedAt ?? nowLocalTimestamp())
  const feedbackRun = await buildHypothesisEvidenceFeedback({
    ...options,
    projectPath,
    generatedAt,
    write: false,
  })
  const hypothesesById = new Map((await listHypotheses({ projectPath })).hypotheses.map((item) => [item.id, item]))
  const records = feedbackRun.items
    .filter((item) => ["archived", "disconfirmed", "priced_in"].includes(item.status))
    .map((item) => postMortemDraftFromFeedback(item, hypothesesById.get(item.hypothesisId) ?? {}))
  const manifest = {
    schema: "trading-hypothesis-post-mortem-draft-manifest-v1",
    generatedAt,
    projectPath,
    count: records.length,
    filters: feedbackRun.manifest.filters,
    writeBoundary: {
      root: HYPOTHESIS_POST_MORTEMS_ROOT,
      wroteHypothesisStatus: false,
      wroteWiki: false,
      wroteRaw: false,
      wroteBrain: false,
    },
    sources: [
      ".llm-wiki/hypotheses/*.json",
      ".llm-wiki/hypothesis-evidence-feedback/*.jsonl",
      ".llm-wiki/stock-feedback/evidence-results/*.jsonl",
    ],
  }
  let writeResult = null
  if (options.write) {
    writeResult = await writeHypothesisJsonlWithManifest({
      projectPath,
      relativeRoot: HYPOTHESIS_POST_MORTEMS_ROOT,
      baseName: "hypothesis-post-mortems",
      records,
      manifest,
      generatedAt,
    })
  }
  return {
    schema: "trading-hypothesis-post-mortem-draft-run-v1",
    mode: "hypothesis-post-mortem",
    dryRun: !Boolean(options.write),
    projectPath,
    generatedAt,
    count: records.length,
    drafts: records,
    manifest,
    writeResult: writeResult ? { postMortems: writeResult.jsonl, manifest: writeResult.manifest } : null,
    writePolicy: {
      wroteHypothesisStatus: false,
      wroteWiki: false,
      wroteRaw: false,
      wroteBrain: false,
      wroteArtifacts: Boolean(options.write),
      allowedRoot: HYPOTHESIS_POST_MORTEMS_ROOT,
    },
  }
}

function hasHypothesisRawFactLeak(value, trail = []) {
  if (!value || typeof value !== "object") return null
  for (const [key, child] of Object.entries(value)) {
    const nextTrail = [...trail, key]
    const normalized = normalizeFieldKey(key)
    if (["raw", "rawfactbody", "rawbody", "sourcetext", "fulltext", "content", "body"].includes(normalized)) {
      const length = typeof child === "string" ? child.length : JSON.stringify(child ?? "").length
      if (length > 500) return { path: nextTrail.join("."), length }
    }
    if (child && typeof child === "object") {
      const nested = hasHypothesisRawFactLeak(child, nextTrail)
      if (nested) return nested
    }
  }
  return null
}

function validateHypothesisEvidenceTaskDraftArtifact(record = {}, hypothesisIds = new Set()) {
  const issues = []
  if (record.schema !== HYPOTHESIS_EVIDENCE_TASK_DRAFT_SCHEMA) issues.push({ code: "unexpected_hypothesis_evidence_task_draft_schema", id: record.id ?? null })
  if (!record.hypothesisId) issues.push({ code: "hypothesis_evidence_task_draft_missing_hypothesis_id", id: record.id ?? null })
  if (hypothesisIds.size > 0 && record.hypothesisId && !hypothesisIds.has(record.hypothesisId)) issues.push({ code: "hypothesis_evidence_task_draft_unknown_hypothesis", id: record.id ?? null, hypothesisId: record.hypothesisId })
  const task = record.suggestedStockFeedbackEvidenceTask ?? {}
  if (task.source !== "hypothesis") issues.push({ code: "hypothesis_evidence_task_draft_invalid_source", id: record.id ?? null, source: task.source ?? null })
  if (task.sourceId !== record.hypothesisId) issues.push({ code: "hypothesis_evidence_task_draft_source_id_mismatch", id: record.id ?? null, sourceId: task.sourceId ?? null, hypothesisId: record.hypothesisId ?? null })
  if (!Array.isArray(task.targetFields) || task.targetFields.length === 0) issues.push({ code: "hypothesis_evidence_task_draft_missing_target_fields", id: record.id ?? null })
  if (!Array.isArray(task.preferredSources) || task.preferredSources.length === 0) issues.push({ code: "hypothesis_evidence_task_draft_missing_preferred_sources", id: record.id ?? null })
  if (record.readiness?.requiresHumanGate !== true) issues.push({ code: "hypothesis_evidence_task_draft_missing_human_gate", id: record.id ?? null })
  if (record.readiness?.writeReady && !task.stockCode) issues.push({ code: "hypothesis_evidence_task_draft_write_ready_without_stock", id: record.id ?? null })
  if (record.writePolicy?.wroteStockFeedbackEvidenceTask) issues.push({ code: "hypothesis_evidence_task_draft_wrote_formal_task", id: record.id ?? null })
  if (record.writePolicy?.wroteHypothesisStatus) issues.push({ code: "hypothesis_evidence_task_draft_wrote_status", id: record.id ?? null })
  if (record.writePolicy?.wroteWiki || record.writePolicy?.wroteRaw || record.writePolicy?.wroteBrain) issues.push({ code: "hypothesis_evidence_task_draft_boundary_violation", id: record.id ?? null })
  const leak = hasHypothesisRawFactLeak(record)
  if (leak) issues.push({ code: "hypothesis_evidence_task_draft_contains_raw_fact_body", id: record.id ?? null, ...leak })
  return issues
}

function validateHypothesisEvidenceLinkDraftArtifact(record = {}) {
  const issues = []
  if (record.schema !== HYPOTHESIS_EVIDENCE_LINK_DRAFT_SCHEMA) issues.push({ code: "unexpected_hypothesis_evidence_link_draft_schema", id: record.id ?? null })
  if (!record.evidenceResultId) issues.push({ code: "hypothesis_evidence_link_draft_missing_evidence_result", id: record.id ?? null })
  if (!record.taskId) issues.push({ code: "hypothesis_evidence_link_draft_missing_task_id", id: record.id ?? null })
  if (record.sourceKind !== "stock_feedback") issues.push({ code: "hypothesis_evidence_link_draft_invalid_source_kind", id: record.id ?? null, sourceKind: record.sourceKind ?? null })
  if (record.humanGate?.required !== true) issues.push({ code: "hypothesis_evidence_link_draft_missing_human_gate", id: record.id ?? null })
  if (record.writePolicy?.wroteHypothesisEvidenceLink) issues.push({ code: "hypothesis_evidence_link_draft_wrote_formal_link", id: record.id ?? null })
  if (record.writePolicy?.wroteHypothesisStatus) issues.push({ code: "hypothesis_evidence_link_draft_wrote_status", id: record.id ?? null })
  if (record.writePolicy?.wroteWiki || record.writePolicy?.wroteRaw || record.writePolicy?.wroteBrain) issues.push({ code: "hypothesis_evidence_link_draft_boundary_violation", id: record.id ?? null })
  const leak = hasHypothesisRawFactLeak(record)
  if (leak) issues.push({ code: "hypothesis_evidence_link_draft_contains_raw_fact_body", id: record.id ?? null, ...leak })
  return issues
}

function validateHypothesisEvidenceLinkArtifact(record = {}, hypothesisIds = new Set()) {
  const issues = []
  if (record.schema !== HYPOTHESIS_EVIDENCE_LINK_SCHEMA) issues.push({ code: "unexpected_hypothesis_evidence_link_schema", id: record.id ?? null })
  if (!record.hypothesisId) issues.push({ code: "hypothesis_evidence_link_missing_hypothesis_id", id: record.id ?? null })
  if (hypothesisIds.size > 0 && record.hypothesisId && !hypothesisIds.has(record.hypothesisId)) issues.push({ code: "hypothesis_evidence_link_unknown_hypothesis", id: record.id ?? null, hypothesisId: record.hypothesisId })
  if (!record.evidenceResultId) issues.push({ code: "hypothesis_evidence_link_missing_evidence_result", id: record.id ?? null })
  if (record.status !== "approved") issues.push({ code: "hypothesis_evidence_link_not_approved", id: record.id ?? null, status: record.status ?? null })
  if (record.humanGate?.status !== "confirmed") issues.push({ code: "hypothesis_evidence_link_missing_confirmed_human_gate", id: record.id ?? null })
  if (record.writePolicy?.wroteHypothesisStatus) issues.push({ code: "hypothesis_evidence_link_wrote_status", id: record.id ?? null })
  if (record.writePolicy?.wroteWiki || record.writePolicy?.wroteRaw || record.writePolicy?.wroteBrain) issues.push({ code: "hypothesis_evidence_link_boundary_violation", id: record.id ?? null })
  const leak = hasHypothesisRawFactLeak(record)
  if (leak) issues.push({ code: "hypothesis_evidence_link_contains_raw_fact_body", id: record.id ?? null, ...leak })
  return issues
}

function validateHypothesisFeedbackArtifact(record = {}, hypothesisIds = new Set()) {
  const issues = []
  if (record.schema !== HYPOTHESIS_EVIDENCE_FEEDBACK_SCHEMA) issues.push({ code: "unexpected_hypothesis_feedback_schema", id: record.id ?? null })
  if (!record.hypothesisId) issues.push({ code: "hypothesis_feedback_missing_hypothesis_id", id: record.id ?? null })
  if (hypothesisIds.size > 0 && record.hypothesisId && !hypothesisIds.has(record.hypothesisId)) issues.push({ code: "hypothesis_feedback_unknown_hypothesis", id: record.id ?? null, hypothesisId: record.hypothesisId })
  const score = record.evidenceScore ?? {}
  for (const field of ["sourceReliability", "sampleSize", "timeliness", "directRelevance", "verifiability", "total"]) {
    const n = Number(score[field])
    if (!Number.isFinite(n) || n < 0 || n > 100) issues.push({ code: "invalid_hypothesis_evidence_score", id: record.id ?? null, field, value: score[field] ?? null })
  }
  for (const item of record.evidenceList ?? []) {
    if (!["strengthening", "weakening", "neutral"].includes(item.direction)) {
      issues.push({ code: "invalid_hypothesis_evidence_direction", id: record.id ?? null, evidenceResultId: item.evidenceResultId ?? null, direction: item.direction ?? null })
    }
  }
  if (record.watchtowerCandidate?.recommendationOnly !== true) issues.push({ code: "watchtower_candidate_not_recommendation_only", id: record.id ?? null })
  if (record.writePolicy?.wroteHypothesisStatus) issues.push({ code: "hypothesis_feedback_wrote_status", id: record.id ?? null })
  const leak = hasHypothesisRawFactLeak(record)
  if (leak) issues.push({ code: "hypothesis_feedback_contains_raw_fact_body", id: record.id ?? null, ...leak })
  return issues
}

function validateHypothesisPostMortemArtifact(record = {}, hypothesisIds = new Set()) {
  const issues = []
  if (record.schema !== HYPOTHESIS_POST_MORTEM_DRAFT_SCHEMA) issues.push({ code: "unexpected_hypothesis_post_mortem_schema", id: record.id ?? null })
  if (!record.hypothesisId) issues.push({ code: "hypothesis_post_mortem_missing_hypothesis_id", id: record.id ?? null })
  if (hypothesisIds.size > 0 && record.hypothesisId && !hypothesisIds.has(record.hypothesisId)) issues.push({ code: "hypothesis_post_mortem_unknown_hypothesis", id: record.id ?? null, hypothesisId: record.hypothesisId })
  if (!["archived", "disconfirmed", "priced_in"].includes(record.terminalStatus)) issues.push({ code: "hypothesis_post_mortem_non_terminal_status", id: record.id ?? null, terminalStatus: record.terminalStatus ?? null })
  if (record.peftBoundary?.storesRawFacts !== false) issues.push({ code: "hypothesis_post_mortem_missing_peft_boundary", id: record.id ?? null })
  const leak = hasHypothesisRawFactLeak(record)
  if (leak) issues.push({ code: "hypothesis_post_mortem_contains_raw_fact_body", id: record.id ?? null, ...leak })
  return issues
}

export async function verifyHypothesisEngineArtifacts(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const hypothesisIds = new Set((await listHypotheses({ projectPath })).hypotheses.map((item) => item.id).filter(Boolean))
  const feedbackRecords = await readJsonlRecords(projectPath, HYPOTHESIS_EVIDENCE_FEEDBACK_ROOT, HYPOTHESIS_EVIDENCE_FEEDBACK_SCHEMA)
  const feedbackManifests = await readJsonManifestRecords(projectPath, HYPOTHESIS_EVIDENCE_FEEDBACK_ROOT, HYPOTHESIS_EVIDENCE_FEEDBACK_MANIFEST_SCHEMA)
  const evidenceTaskDrafts = await readJsonlRecords(projectPath, HYPOTHESIS_EVIDENCE_TASK_DRAFTS_ROOT, HYPOTHESIS_EVIDENCE_TASK_DRAFT_SCHEMA)
  const evidenceTaskDraftManifests = await readJsonManifestRecords(projectPath, HYPOTHESIS_EVIDENCE_TASK_DRAFTS_ROOT, HYPOTHESIS_EVIDENCE_TASK_DRAFT_MANIFEST_SCHEMA)
  const evidenceLinkDrafts = await readJsonlRecords(projectPath, HYPOTHESIS_EVIDENCE_LINK_DRAFTS_ROOT, HYPOTHESIS_EVIDENCE_LINK_DRAFT_SCHEMA)
  const evidenceLinkDraftManifests = await readJsonManifestRecords(projectPath, HYPOTHESIS_EVIDENCE_LINK_DRAFTS_ROOT, HYPOTHESIS_EVIDENCE_LINK_DRAFT_MANIFEST_SCHEMA)
  const evidenceLinks = await readJsonlRecords(projectPath, HYPOTHESIS_EVIDENCE_LINKS_ROOT, HYPOTHESIS_EVIDENCE_LINK_SCHEMA)
  const evidenceLinkManifests = await readJsonManifestRecords(projectPath, HYPOTHESIS_EVIDENCE_LINKS_ROOT, HYPOTHESIS_EVIDENCE_LINK_MANIFEST_SCHEMA)
  const postMortems = await readJsonlRecords(projectPath, HYPOTHESIS_POST_MORTEMS_ROOT, HYPOTHESIS_POST_MORTEM_DRAFT_SCHEMA)
  const postMortemManifests = await readJsonManifestRecords(projectPath, HYPOTHESIS_POST_MORTEMS_ROOT)
  const issues = []
  for (const record of feedbackRecords) {
    issues.push(...validateHypothesisFeedbackArtifact(record, hypothesisIds).map((issue) => ({ severity: "error", ...issue })))
  }
  for (const manifest of feedbackManifests) {
    if (manifest.writeBoundary?.wroteHypothesisStatus) issues.push({ severity: "error", code: "hypothesis_feedback_manifest_wrote_status", id: manifest.artifactPath ?? null })
    if (manifest.writeBoundary?.wroteWiki || manifest.writeBoundary?.wroteRaw || manifest.writeBoundary?.wroteBrain) issues.push({ severity: "error", code: "hypothesis_feedback_manifest_boundary_violation", id: manifest.artifactPath ?? null })
  }
  for (const record of evidenceTaskDrafts) {
    issues.push(...validateHypothesisEvidenceTaskDraftArtifact(record, hypothesisIds).map((issue) => ({ severity: "error", ...issue })))
  }
  for (const manifest of evidenceTaskDraftManifests) {
    if (manifest.writeBoundary?.wroteStockFeedbackEvidenceTask) issues.push({ severity: "error", code: "hypothesis_evidence_task_draft_manifest_wrote_formal_task", id: manifest.artifactPath ?? null })
    if (manifest.writeBoundary?.wroteHypothesisStatus) issues.push({ severity: "error", code: "hypothesis_evidence_task_draft_manifest_wrote_status", id: manifest.artifactPath ?? null })
    if (manifest.writeBoundary?.wroteWiki || manifest.writeBoundary?.wroteRaw || manifest.writeBoundary?.wroteBrain) issues.push({ severity: "error", code: "hypothesis_evidence_task_draft_manifest_boundary_violation", id: manifest.artifactPath ?? null })
  }
  for (const record of evidenceLinkDrafts) {
    issues.push(...validateHypothesisEvidenceLinkDraftArtifact(record).map((issue) => ({ severity: "error", ...issue })))
  }
  for (const manifest of evidenceLinkDraftManifests) {
    if (manifest.writeBoundary?.wroteHypothesisEvidenceLink) issues.push({ severity: "error", code: "hypothesis_evidence_link_draft_manifest_wrote_formal_link", id: manifest.artifactPath ?? null })
    if (manifest.writeBoundary?.wroteHypothesisStatus) issues.push({ severity: "error", code: "hypothesis_evidence_link_draft_manifest_wrote_status", id: manifest.artifactPath ?? null })
    if (manifest.writeBoundary?.wroteWiki || manifest.writeBoundary?.wroteRaw || manifest.writeBoundary?.wroteBrain) issues.push({ severity: "error", code: "hypothesis_evidence_link_draft_manifest_boundary_violation", id: manifest.artifactPath ?? null })
  }
  for (const record of evidenceLinks) {
    issues.push(...validateHypothesisEvidenceLinkArtifact(record, hypothesisIds).map((issue) => ({ severity: "error", ...issue })))
  }
  for (const manifest of evidenceLinkManifests) {
    if (manifest.writeBoundary?.wroteHypothesisStatus) issues.push({ severity: "error", code: "hypothesis_evidence_link_manifest_wrote_status", id: manifest.artifactPath ?? null })
    if (manifest.writeBoundary?.wroteWiki || manifest.writeBoundary?.wroteRaw || manifest.writeBoundary?.wroteBrain) issues.push({ severity: "error", code: "hypothesis_evidence_link_manifest_boundary_violation", id: manifest.artifactPath ?? null })
  }
  for (const record of postMortems) {
    issues.push(...validateHypothesisPostMortemArtifact(record, hypothesisIds).map((issue) => ({ severity: "error", ...issue })))
  }
  for (const manifest of postMortemManifests) {
    if (manifest.writeBoundary?.wroteHypothesisStatus) issues.push({ severity: "error", code: "hypothesis_post_mortem_manifest_wrote_status", id: manifest.artifactPath ?? null })
    if (manifest.writeBoundary?.wroteWiki || manifest.writeBoundary?.wroteRaw || manifest.writeBoundary?.wroteBrain) issues.push({ severity: "error", code: "hypothesis_post_mortem_manifest_boundary_violation", id: manifest.artifactPath ?? null })
  }
  const errorCount = issues.filter((item) => item.severity === "error").length
  return {
    schema: HYPOTHESIS_VERIFY_SCHEMA,
    mode: "hypothesis-verify",
    projectPath,
    status: errorCount > 0 ? "failed" : "ok",
    checked: {
      hypotheses: hypothesisIds.size,
      evidenceFeedback: feedbackRecords.length,
      evidenceFeedbackManifests: feedbackManifests.length,
      evidenceTaskDrafts: evidenceTaskDrafts.length,
      evidenceTaskDraftManifests: evidenceTaskDraftManifests.length,
      evidenceLinkDrafts: evidenceLinkDrafts.length,
      evidenceLinkDraftManifests: evidenceLinkDraftManifests.length,
      evidenceLinks: evidenceLinks.length,
      evidenceLinkManifests: evidenceLinkManifests.length,
      postMortems: postMortems.length,
      postMortemManifests: postMortemManifests.length,
    },
    issueCount: issues.length,
    errorCount,
    issues,
  }
}

export async function createHypothesis(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const generatedAt = String(options.generatedAt ?? nowLocalTimestamp())
  const title = safeErrorMessage(String(options.title ?? "").trim())
  if (!title) throw new Error("Missing required --title")
  const theme = safeErrorMessage(String(options.theme ?? "").trim())
  const segments = parseCsvList(options.segments ?? options.segment, [])
  const hypothesis = {
    schema: HYPOTHESIS_LIBRARY_SCHEMA,
    id: safeErrorMessage(String(options.id ?? "").trim()) || stableHypothesisId({ title, theme, segments }),
    title,
    theme,
    segments,
    status: normalizeStatus(options.status, "watching"),
    conviction: normalizeConviction(options.conviction, 0),
    timeHorizon: safeErrorMessage(String(options.timeHorizon ?? options["time-horizon"] ?? "").trim()),
    keyVariables: parseTextList(options.keyVariables ?? options["key-variables"]),
    triggerConditions: parseTextList(options.triggerConditions ?? options["trigger-conditions"] ?? options.triggers),
    invalidationSignals: parseTextList(options.invalidationSignals ?? options["invalidation-signals"] ?? options.falsifiableConditions ?? options.risks),
    expectedEvidencePath: parseTextList(options.expectedEvidencePath ?? options["expected-evidence-path"] ?? options.evidencePath),
    evidenceRefs: parseTextList(options.evidenceRefs ?? options["evidence-refs"]),
    marketRefs: parseTextList(options.marketRefs ?? options["market-refs"]),
    risks: parseTextList(options.risks),
    relatedWikiPages: parseRelatedWikiPagesInput(options.relatedWikiPages ?? options["related-wiki-pages"] ?? options.wikiRefs),
    nextValidationDate: safeErrorMessage(String(options.nextValidationDate ?? options["next-validation-date"] ?? "").trim()) || null,
    createdAt: generatedAt,
    updatedAt: generatedAt,
    writePolicy: {
      artifacts: ".llm-wiki/hypotheses only when --write is present",
      wroteWiki: false,
      wroteRaw: false,
      wroteRealTrade: false,
    },
  }

  const dryRun = !options.write
  let writeResult = null
  if (!dryRun) {
    const jsonPath = hypothesisJsonPath(projectPath, hypothesis.id)
    const markdownPath = hypothesisMarkdownPath(projectPath, hypothesis.id)
    await writeJson(jsonPath, hypothesis)
    await ensureDirectory(path.dirname(markdownPath))
    await fs.writeFile(markdownPath, hypothesisMarkdown(hypothesis), "utf8")
    writeResult = {
      jsonPath,
      markdownPath,
      jsonRelativePath: projectRelative(projectPath, jsonPath),
      markdownRelativePath: projectRelative(projectPath, markdownPath),
      records: 1,
    }
  }

  return {
    schema: "trading-hypothesis-create-run-v1",
    mode: "hypothesis-create",
    projectPath,
    dryRun,
    hypothesis,
    writeResult,
  }
}

export async function updateHypothesisStatus(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const generatedAt = String(options.generatedAt ?? nowLocalTimestamp())
  const id = safeErrorMessage(String(options.id ?? "").trim())
  if (!id) throw new Error("Missing required --id")
  const newStatus = normalizeStatus(options.status, "watching")
  const reason = safeErrorMessage(String(options.reason ?? "").trim()).slice(0, 500) || "manual status update"
  const eventRef = safeErrorMessage(String(options.eventRef ?? options["event-ref"] ?? "manual:research-cockpit-status-update").trim()).slice(0, 500)
  const askRunRef = safeErrorMessage(String(options.askRunRef ?? options["ask-run-ref"] ?? "").trim()).slice(0, 500) || null
  const jsonPath = hypothesisJsonPath(projectPath, id)
  const current = await readJsonFile(jsonPath).catch(() => null)
  if (!current || current.schema !== HYPOTHESIS_LIBRARY_SCHEMA) {
    throw new Error(`Unknown hypothesis id: ${id}`)
  }
  const previousStatus = normalizeStatus(current.status, "watching")
  const previousStatusLabel = HYPOTHESIS_STATUS_LABELS[previousStatus] ?? previousStatus
  const newStatusLabel = HYPOTHESIS_STATUS_LABELS[newStatus] ?? newStatus
  const updatedHypothesis = {
    ...current,
    status: newStatus,
    updatedAt: generatedAt,
  }
  const auditEvent = {
    schema: HYPOTHESIS_EVENT_SCHEMA,
    id: `hypoe_${shortHash(`${generatedAt}:${id}:${previousStatus}:${newStatus}:${reason}`)}`,
    hypothesisId: id,
    eventTime: generatedAt,
    createdAt: generatedAt,
    sourceRef: eventRef || "manual:research-cockpit-status-update",
    sourceType: "manual_review",
    sourceKind: "manual_review",
    sourceKindLabel: "人工确认",
    sourceTool: "research-cockpit",
    sourceHash: sha256Hex(`${id}:${previousStatus}:${newStatus}:${reason}:${eventRef}`),
    matchScore: null,
    matchedSegments: [],
    matchedEntities: [],
    evidenceDelta: "manual_status_update",
    signalType: "人工确认",
    signalStrength: "medium",
    confidenceImpact: { direction: "neutral", delta: 0, reason: "manual reviewer confirmed a persisted hypothesis status change" },
    statusBefore: previousStatus,
    suggestedStatus: newStatus,
    suggestedStatusReason: reason,
    reason,
    tradingImplication: `人工确认状态变化：${previousStatusLabel} -> ${newStatusLabel}。${reason}`,
    askRunRef,
    evidenceGaps: [],
    previousStatus,
    newStatus,
    summary: reason,
    selfTrainingHooks: {
      sampleEligible: true,
      outcomePending: true,
      labelSource: "manual_hypothesis_status_update",
    },
  }

  const dryRun = !options.write
  let writeResult = null
  if (!dryRun) {
    const markdownPath = hypothesisMarkdownPath(projectPath, id)
    await writeJson(jsonPath, updatedHypothesis)
    await ensureDirectory(path.dirname(markdownPath))
    await fs.writeFile(markdownPath, hypothesisMarkdown(updatedHypothesis), "utf8")
    const eventPath = hypothesisEventPath(projectPath, id)
    await ensureDirectory(path.dirname(eventPath))
    await fs.appendFile(eventPath, `${JSON.stringify(auditEvent)}\n`, "utf8")
    writeResult = {
      jsonPath,
      markdownPath,
      eventPath,
      jsonRelativePath: projectRelative(projectPath, jsonPath),
      markdownRelativePath: projectRelative(projectPath, markdownPath),
      eventRelativePath: projectRelative(projectPath, eventPath),
      records: 1,
    }
  }

  return {
    schema: "trading-hypothesis-status-update-run-v1",
    mode: "hypothesis-status-update",
    projectPath,
    dryRun,
    hypothesisId: id,
    previousStatus,
    newStatus,
    reason,
    eventRef,
    askRunRef,
    hypothesis: dryRun ? current : updatedHypothesis,
    updatedHypothesis,
    auditEvent,
    writeResult,
    writePolicy: {
      artifacts: ".llm-wiki/hypotheses and .llm-wiki/hypothesis-events only when --write is present",
      wroteWiki: false,
      wroteRaw: false,
      wroteRealTrade: false,
      autoAppliedPolicy: false,
    },
  }
}

export async function submitHypothesisSupplement(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const generatedAt = String(options.generatedAt ?? nowLocalTimestamp())
  const title = safeErrorMessage(String(options.title ?? "补充资料").trim()).slice(0, 120) || "补充资料"
  const body = safeErrorMessage(String(options.body ?? options.text ?? "").trim()).slice(0, 20000)
  if (!body) throw new Error("Missing required --body")
  const kind = safeErrorMessage(String(options.kind ?? "manual").trim()).slice(0, 48) || "manual"
  const hypothesisId = safeErrorMessage(String(options.hypothesisId ?? options["hypothesis-id"] ?? "").trim())
  const sourceRefs = parseTextList(options.sourceRefs ?? options["source-refs"])
  const supplement = {
    schema: "trading-hypothesis-supplement-v1",
    id: `hypos_${shortHash(`${generatedAt}:${title}:${body}`).slice(0, 12)}`,
    title,
    kind,
    hypothesisId: hypothesisId || null,
    body,
    sourceRefs,
    createdAt: generatedAt,
    writePolicy: {
      artifacts: ".llm-wiki/hypothesis-supplements only when --write is present",
      wroteWiki: false,
      wroteRaw: false,
      wroteRealTrade: false,
    },
  }
  const markdown = hypothesisSupplementMarkdown(supplement)
  const dryRun = !options.write
  let writeResult = null
  if (!dryRun) {
    const basePath = hypothesisSupplementBasePath(projectPath, generatedAt, supplement.id)
    const jsonPath = `${basePath}.json`
    const markdownPath = `${basePath}.md`
    await writeJson(jsonPath, supplement)
    await ensureDirectory(path.dirname(markdownPath))
    await fs.writeFile(markdownPath, markdown, "utf8")
    writeResult = {
      jsonPath,
      markdownPath,
      jsonRelativePath: projectRelative(projectPath, jsonPath),
      markdownRelativePath: projectRelative(projectPath, markdownPath),
      records: 1,
    }
  }
  return {
    schema: "trading-hypothesis-supplement-run-v1",
    mode: "hypothesis-supplement",
    projectPath,
    dryRun,
    supplement,
    markdown,
    writeResult,
    writePolicy: {
      artifacts: ".llm-wiki/hypothesis-supplements only when --write is present",
      wroteWiki: false,
      wroteRaw: false,
      wroteRealTrade: false,
      autoCreatedHypothesis: false,
      autoAppliedPolicy: false,
    },
  }
}

export async function createObservationDraft(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const generatedAt = String(options.generatedAt ?? nowLocalTimestamp())
  const title = safeErrorMessage(String(options.title ?? "").trim()).slice(0, 180)
  if (!title) throw new Error("Missing required --title")
  const hypothesisId = safeErrorMessage(String(options.hypothesisId ?? options["hypothesis-id"] ?? "").trim()).slice(0, 180)
  const stocks = parseTextList(options.stocks ?? options.stock).slice(0, 20)
  const ranking = safeErrorMessage(String(options.ranking ?? "").trim()).slice(0, 1000)
  const gap = safeErrorMessage(String(options.gap ?? "").trim()).slice(0, 1000)
  const nextAction = safeErrorMessage(String(options.nextAction ?? options["next-action"] ?? "").trim()).slice(0, 1000)
  const copyText = safeErrorMessage(String(options.copyText ?? options["copy-text"] ?? "").trim()).slice(0, 8000)
  const askQuery = safeErrorMessage(String(options.askQuery ?? options["ask-query"] ?? "").trim()).slice(0, 4000)
  const sourceRefs = parseTextList(options.sourceRefs ?? options["source-refs"]).slice(0, 20)
  const wikiFrame = {
    label: safeErrorMessage(String(options.wikiFrameLabel ?? options["wiki-frame-label"] ?? "").trim()).slice(0, 180),
    sourceRef: safeErrorMessage(String(options.wikiFrameSourceRef ?? options["wiki-frame-source-ref"] ?? "").trim()).slice(0, 400),
    metaLine: safeErrorMessage(String(options.wikiFrameMetaLine ?? options["wiki-frame-meta-line"] ?? "").trim()).slice(0, 1000),
  }
  const draft = {
    schema: OBSERVATION_DRAFT_SCHEMA,
    id: `obs_${shortHash(`${generatedAt}:${title}:${hypothesisId}:${stocks.join(",")}:${wikiFrame.sourceRef}`).slice(0, 14)}`,
    title,
    hypothesisId: hypothesisId || null,
    status: "draft",
    stocks,
    ranking,
    gap,
    nextAction,
    wikiFrame,
    sourceRefs,
    askQuery,
    copyText,
    createdAt: generatedAt,
    updatedAt: generatedAt,
    writePolicy: {
      artifacts: ".llm-wiki/observation-drafts only when --write is present",
      wroteWiki: false,
      wroteRaw: false,
      wroteRealTrade: false,
      autoAppliedPolicy: false,
    },
  }

  const dryRun = !options.write
  let writeResult = null
  if (!dryRun) {
    const basePath = observationDraftBasePath(projectPath, generatedAt, draft.id)
    const jsonPath = `${basePath}.json`
    const markdownPath = `${basePath}.md`
    await writeJson(jsonPath, draft)
    await ensureDirectory(path.dirname(markdownPath))
    await fs.writeFile(markdownPath, observationDraftMarkdown(draft), "utf8")
    writeResult = {
      jsonPath,
      markdownPath,
      jsonRelativePath: projectRelative(projectPath, jsonPath),
      markdownRelativePath: projectRelative(projectPath, markdownPath),
      records: 1,
    }
  }

  return {
    schema: "trading-observation-draft-create-run-v1",
    mode: "observation-draft-create",
    projectPath,
    dryRun,
    draft,
    markdown: observationDraftMarkdown(draft),
    writeResult,
    writePolicy: draft.writePolicy,
  }
}

export async function listObservationDrafts(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const rawDate = safeErrorMessage(String(options.date ?? "").trim()).slice(0, 10)
  const date = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : ""
  const rawLimit = Number(options.limit ?? 8)
  const limit = Math.max(1, Math.min(100, Number.isFinite(rawLimit) ? rawLimit : 8))
  const root = path.join(projectPath, OBSERVATION_DRAFTS_ROOT, date)
  const files = await listFilesRecursive(root, { extensions: new Set([".json"]) }).catch(() => [])
  const drafts = []

  for (const filePath of files) {
    const record = await readJsonFile(filePath).catch(() => null)
    if (!record || record.schema !== OBSERVATION_DRAFT_SCHEMA) continue
    const markdownPath = filePath.replace(/\.json$/i, ".md")
    const markdownExists = await fs.stat(markdownPath).then((stat) => stat.isFile()).catch(() => false)
    drafts.push({
      ...record,
      jsonRelativePath: projectRelative(projectPath, filePath),
      markdownRelativePath: markdownExists ? projectRelative(projectPath, markdownPath) : null,
      relativePath: projectRelative(projectPath, filePath),
    })
  }

  drafts.sort((a, b) => {
    const byUpdated = String(b.updatedAt ?? b.createdAt ?? "").localeCompare(String(a.updatedAt ?? a.createdAt ?? ""))
    if (byUpdated) return byUpdated
    return String(b.jsonRelativePath ?? "").localeCompare(String(a.jsonRelativePath ?? ""))
  })

  return {
    schema: "trading-observation-draft-list-run-v1",
    mode: "observation-draft-list",
    projectPath,
    dryRun: true,
    filters: { date: date || null, limit },
    count: drafts.slice(0, limit).length,
    totalCount: drafts.length,
    drafts: drafts.slice(0, limit),
    writePolicy: {
      readOnly: true,
      wroteWiki: false,
      wroteRaw: false,
      wroteRealTrade: false,
      autoAppliedPolicy: false,
    },
  }
}

function parseJsonObjectFromText(text) {
  const raw = String(text ?? "").trim()
  if (!raw) throw new Error("LLM returned empty supplement draft.")
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  const candidate = fenced ?? raw
  try {
    const parsed = JSON.parse(candidate)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("JSON root is not an object")
    return parsed
  } catch {
    const start = candidate.indexOf("{")
    const end = candidate.lastIndexOf("}")
    if (start >= 0 && end > start) {
      const parsed = JSON.parse(candidate.slice(start, end + 1))
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("JSON root is not an object")
      return parsed
    }
    throw new Error(`Unable to parse LLM supplement draft JSON: ${raw.slice(0, 300)}`)
  }
}

function sanitizeDraftList(value, limit = 12) {
  return parseTextList(value).slice(0, limit)
}

function normalizeSupplementDraft(parsed, { body, sourceRefs, selectedSources, hypothesis }) {
  const title = safeErrorMessage(String(parsed.title ?? "补充资料：LLM整理草稿").trim()).slice(0, 120) || "补充资料：LLM整理草稿"
  const kind = safeErrorMessage(String(parsed.kind ?? "manual").trim()).slice(0, 48) || "manual"
  const evidenceDelta = safeErrorMessage(String(parsed.evidenceDelta ?? "new_context").trim()).slice(0, 48) || "new_context"
  const extractedPoints = sanitizeDraftList(parsed.extractedPoints ?? parsed.points ?? [], 10)
  const evidenceGaps = sanitizeDraftList(parsed.evidenceGaps ?? [], 12)
  const suggestedSources = sanitizeDraftList(parsed.suggestedSources ?? parsed.sources ?? [], 12)
  const normalizedSourceRefs = [
    ...parseTextList(sourceRefs),
    ...sanitizeDraftList(parsed.sourceRefs ?? [], 12),
    ...parseTextList(selectedSources).map((item) => `selected-source:${item}`),
  ]
  const hypothesisLine = hypothesis?.id ? `${hypothesis.id} ${hypothesis.title ?? ""}`.trim() : "未指定"
  const normalizedBody = safeErrorMessage(String(parsed.normalizedBody ?? parsed.body ?? "").trim()).slice(0, 18000) || [
    `# LLM补证处理结果：${hypothesis?.title ?? "未指定假设"}`,
    "",
    `- hypothesis: ${hypothesisLine}`,
    `- evidenceDelta: ${evidenceDelta}`,
    `- kind: ${kind}`,
    `- evidenceGaps: ${evidenceGaps.join(", ") || "none"}`,
    "",
    "## LLM提取要点",
    ...(extractedPoints.length ? extractedPoints.map((item) => `- ${item}`) : ["- LLM未提取到明确要点。"]),
    "",
    "## 建议数据源",
    ...(suggestedSources.length ? suggestedSources.map((item) => `- ${item}`) : ["- LLM未给出建议数据源。"]),
    "",
    "## 原始资料",
    body,
  ].join("\n")
  return {
    title,
    kind,
    sourceRefs: [...new Set(normalizedSourceRefs)].join("\n"),
    normalizedBody,
    evidenceDelta,
    evidenceGaps,
    suggestedSources,
    extractedPoints,
    mode: "llm",
  }
}

function imaApiScriptPath() {
  return path.join(os.homedir(), ".codex", "skills", "ima-skill", "ima_api.cjs")
}

async function callImaOpenApi(apiPath, payload, options = {}) {
  const scriptPath = imaApiScriptPath()
  const stdout = await runProcessWithStdin(
    process.execPath,
    [scriptPath, apiPath, JSON.stringify(payload)],
    "",
    {
      cwd: path.dirname(scriptPath),
      timeoutMs: options.timeoutMs ?? 8000,
      maxBuffer: options.maxBuffer ?? 1024 * 1024 * 4,
    },
  ).then((result) => result.stdout)
  const response = JSON.parse(stdout)
  if (response?.code !== 0) throw new Error(`IMA OpenAPI ${apiPath} failed: ${response?.msg ?? "unknown error"}`)
  return response.data ?? {}
}

function supplementSearchQueries({ body, hypothesis }) {
  const seed = [
    hypothesis?.title,
    hypothesis?.theme,
    ...(hypothesis?.segments ?? []),
    body,
  ].filter(Boolean).join("\n")
  const segments = inferSegmentsFromText(seed)
  const tokens = tokenizeForMatch(seed).filter((item) => /[A-Za-z0-9]|[\u4e00-\u9fa5]/.test(item))
  return [...new Set([...segments, ...tokens.slice(0, 8)])].slice(0, 4)
}

function publicImaHit({ knowledgeBaseName, title, excerpt }) {
  return {
    source: "ima",
    knowledgeBaseName,
    title: safeErrorMessage(String(title ?? "")).slice(0, 180),
    excerpt: safeErrorMessage(String(excerpt ?? "").replace(/\s+/g, " ").trim()).slice(0, 1200),
  }
}

async function collectImaSupplementContext({
  body,
  hypothesis,
  selectedSources,
  maxKnowledgeBases = 2,
  maxHits = 3,
  maxQueries = 1,
  deadlineMs = 8000,
  imaApiCaller = callImaOpenApi,
}) {
  if (!parseTextList(selectedSources).includes("ima")) return { hits: [], warning: null }
  const startedAt = Date.now()
  const isTimedOut = () => Date.now() - startedAt >= deadlineMs
  const timeLeft = () => Math.max(1000, deadlineMs - (Date.now() - startedAt))
  try {
    const kbList = await imaApiCaller("openapi/wiki/v1/search_knowledge_base", {
      query: "",
      cursor: "",
      limit: maxKnowledgeBases,
    }, { timeoutMs: Math.min(8000, timeLeft()) })
    const knowledgeBases = Array.isArray(kbList.info_list) ? kbList.info_list.slice(0, maxKnowledgeBases) : []
    const queries = supplementSearchQueries({ body, hypothesis }).slice(0, maxQueries)
    const hits = []
    const seen = new Set()
    for (const kb of knowledgeBases) {
      if (hits.length >= maxHits) break
      if (isTimedOut()) break
      for (const query of queries) {
        if (hits.length >= maxHits) break
        if (isTimedOut()) break
        const searched = await imaApiCaller("openapi/wiki/v1/search_knowledge", {
          query,
          knowledge_base_id: kb.kb_id,
          cursor: "",
        }, { timeoutMs: Math.min(8000, timeLeft()) })
        const infoList = Array.isArray(searched.info_list) ? searched.info_list.slice(0, 3) : []
        for (const item of infoList) {
          if (hits.length >= maxHits) break
          const key = `${kb.kb_name}:${item.title}`
          if (seen.has(key)) continue
          seen.add(key)
          const excerpt = item.highlight_content || item.title || ""
          hits.push(publicImaHit({
            knowledgeBaseName: kb.kb_name,
            title: item.title,
            excerpt,
          }))
        }
      }
    }
    return { hits, warning: isTimedOut() ? "IMA search hit local time budget; partial results returned." : null }
  } catch (err) {
    return { hits: [], warning: err instanceof Error ? err.message : String(err) }
  }
}

export async function draftHypothesisSupplement(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const body = safeErrorMessage(String(options.body ?? options.text ?? "").trim()).slice(0, 20000)
  if (!body) throw new Error("Missing required --body")
  const hypothesisId = safeErrorMessage(String(options.hypothesisId ?? options["hypothesis-id"] ?? "").trim())
  const sourceRefs = options.sourceRefs ?? options["source-refs"]
  const selectedSources = options.selectedSources ?? options["selected-sources"] ?? ""
  const provider = options.provider ?? "codex"
  const model = options.model ?? (provider === "openai" ? process.env.OPENAI_MODEL : process.env.CODEX_MODEL)
  const listed = await listHypotheses({ projectPath })
  const hypothesis = hypothesisId
    ? listed.hypotheses.find((item) => item.id === hypothesisId)
    : null
  if (hypothesisId && !hypothesis) throw new Error(`Unknown hypothesis id: ${hypothesisId}`)
  const externalContext = options.collectExternalSources === false
    ? { ima: { hits: [], warning: null } }
    : { ima: await collectImaSupplementContext({
      body,
      hypothesis,
      selectedSources,
      maxKnowledgeBases: Number(options.imaMaxKnowledgeBases ?? options["ima-max-knowledge-bases"] ?? 2) || 2,
      maxHits: Number(options.imaMaxHits ?? options["ima-max-hits"] ?? 3) || 3,
      maxQueries: Number(options.imaMaxQueries ?? options["ima-max-queries"] ?? 1) || 1,
      deadlineMs: Number(options.imaTimeoutMs ?? options["ima-timeout-ms"] ?? 8000) || 8000,
      imaApiCaller: options.imaApiCaller,
    }) }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "hypothesis-supplement-draft-"))
  const outputPath = path.join(tmpDir, "draft.json")
  const prompt = [
    "你是买方研究系统的补证资料整理 agent。请把用户粘贴的资料整理成严格 JSON。",
    "",
    "目标：服务 Hypothesis Library。不要下投资建议，不要自动确认假设；只提取证据、缺口和下一步数据源。",
    "",
    "必须返回一个 JSON object，不能有 Markdown 包裹，字段如下：",
    "{",
    '  "title": "补充资料标题，120字以内",',
    '  "kind": "manual|roadshow|spreadsheet|announcement|tender_order|financial_market|wechat|research_report",',
    '  "evidenceDelta": "fundamental_delivery|supporting_signal|market_feedback|narrative_expansion|counter_signal|mixed_signal|new_context",',
    '  "extractedPoints": ["最多10条，要保留可验证事实"],',
    '  "evidenceGaps": ["fundamental:orders:not_checked 等"],',
    '  "suggestedSources": ["CNINFO公告/企查查招投标/Tushare财务/微信增量/路演文件 等"],',
    '  "sourceRefs": ["从输入中识别出的文件名、表格名、链接或来源"],',
    '  "normalizedBody": "可写入 .llm-wiki/hypothesis-supplements 的 Markdown，包含：关联假设、证据判断、提取要点、建议数据源、原始资料摘录"',
    "}",
    "",
    "判断要求：",
    "- 如果只是卖方看好、预计、有望，标为 narrative_expansion 或 supporting_signal，不得标为 fundamental_delivery。",
    "- 只有出现订单、中标、公告、财报、收入、毛利率、客户、交付、ASP 等硬证据，才可标为 fundamental_delivery。",
    "- 如果出现放缓、砍单、降价、延期、不及预期，标为 counter_signal 或 mixed_signal。",
    "- 明确列出缺口：订单/公告/财报/ASP/客户份额/市场定价等。",
    "",
    `关联假设：${hypothesis ? JSON.stringify(hypothesis) : "未指定"}`,
    `用户选择的数据源：${parseTextList(selectedSources).join(", ") || "未选择"}`,
    `用户来源引用：${parseTextList(sourceRefs).join(", ") || "未填写"}`,
    "",
    "已自动搜集的外部资料上下文（只读，不能泄露内部 ID；如为空则说明未找到或 provider 不可用）：",
    JSON.stringify(externalContext, null, 2),
    "",
    "用户粘贴资料：",
    body,
  ].join("\n")
  try {
    const rawOutput = await requestAgenticText({
      stage: "hypothesis-supplement-draft",
      role: "supplement-draft",
      prompt,
      instructions: "Return strict JSON only. Do not write files. Do not include markdown fences.",
      context: { projectPath },
      options: {
        provider,
        model,
        agentTimeoutMs: options.timeoutMs ?? options["timeout-ms"] ?? 300000,
        codexBin: options.codexBin,
        codexProfile: options.codexProfile,
        codexProfileV2: options.codexProfileV2,
        apiKey: options.apiKey,
        endpoint: options.endpoint,
        requestAgentText: options.requestAgentText,
      },
      outputPath,
    })
    const parsed = parseJsonObjectFromText(rawOutput)
    const draft = normalizeSupplementDraft(parsed, { body, sourceRefs, selectedSources, hypothesis })
    return {
      schema: "trading-hypothesis-supplement-draft-run-v1",
      mode: "hypothesis-supplement-draft",
      projectPath,
      provider,
      model: model ?? null,
      dryRun: true,
      hypothesisId: hypothesis?.id ?? null,
      draft,
      externalContext,
      rawOutput,
      writePolicy: {
        artifacts: "none; draft is read-only until supplement --write",
        wroteWiki: false,
        wroteRaw: false,
        wroteRealTrade: false,
        autoAppliedPolicy: false,
      },
    }
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
}

function textHasAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text))
}

function normalizeIndustryTerm(term) {
  const cleaned = safeErrorMessage(String(term ?? "")
    .replace(/\.[^.]+$/, "")
    .replace(/^Source[:：\s-]*/i, "")
    .replace(/^\d{4}[-/]\d{1,2}[-/]\d{1,2}[-_\s]*/, "")
    .replace(/^(概念|公司|行业|主题|Source)[:：\s-]*/i, "")
    .replace(/(验证|跟踪|复盘|研究|梳理|更新|专题|纪要|公告|合集)$/g, "")
    .trim())
  if (!cleaned || cleaned.length < 2 || cleaned.length > 28) return ""
  if (isDateLikeText(cleaned)) return ""
  if (/^\d+(\.\d+)?$/.test(cleaned)) return ""
  if (/^\d+\.$/.test(cleaned)) return ""
  if (INDUSTRY_TERM_STOPWORDS.has(cleaned.toLowerCase()) || INDUSTRY_TERM_STOPWORDS.has(cleaned)) return ""
  return cleaned
}

function addIndustryTermCandidates(target, value) {
  const raw = safeErrorMessage(String(value ?? "").trim())
  if (!raw) return
  const candidates = [
    raw,
    ...raw.split(/[\/\\|｜,，、;；\s\t\-_:：()[\]【】]+/g),
    ...(raw.match(/[A-Z][A-Z0-9-]{1,12}/g) ?? []),
  ]
  for (const candidate of candidates) {
    const term = normalizeIndustryTerm(candidate)
    if (term) target.add(term)
  }
}

const financeEntityAuditCache = new Map()

function parseCsvRow(line) {
  const values = []
  let current = ""
  let inQuotes = false
  const raw = String(line ?? "")
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index]
    const next = raw[index + 1]
    if (char === "\"") {
      if (inQuotes && next === "\"") {
        current += "\""
        index += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }
    if (char === "," && !inQuotes) {
      values.push(current)
      current = ""
      continue
    }
    current += char
  }
  values.push(current)
  return values.map((value) => safeErrorMessage(String(value ?? "").replace(/^\uFEFF/, "").trim()))
}

function parseCsvObjects(text) {
  const lines = String(text ?? "").split(/\r?\n/).filter((line) => line.trim())
  if (!lines.length) return []
  const headers = parseCsvRow(lines[0])
  return lines.slice(1).map((line) => {
    const values = parseCsvRow(line)
    const record = {}
    headers.forEach((header, index) => {
      if (header) record[header] = values[index] ?? ""
    })
    return record
  })
}

function rowValue(row, keys) {
  for (const key of keys) {
    const value = row?.[key]
    if (value != null && String(value).trim()) return safeErrorMessage(String(value).trim())
  }
  return ""
}

function parseFinanceEntityAliases(value) {
  return uniqueNonEmpty(String(value ?? "")
    .split(/\s*(?:\||｜|\/|／|,|，|、|;|；|\n)\s*/g)
    .map((item) => item.trim()))
}

function isUsefulFinanceEntityTerm(term) {
  const normalized = safeErrorMessage(String(term ?? "").trim())
  if (!normalized || !isMeaningfulWatchToken(normalized)) return false
  if (/^[A-Za-z]+$/.test(normalized) && FINANCE_ENTITY_ENGLISH_STOPWORDS.has(normalized.toLowerCase())) return false
  if (/^[A-Za-z]{2}$/.test(normalized) && !STRONG_SHORT_RELATED_WIKI_TERMS.has(normalized.toUpperCase())) return false
  return true
}

function financeEntityTermKey(term) {
  const normalized = safeErrorMessage(String(term ?? "").trim())
  return normalized.toUpperCase()
}

function financeEntityTermSetHas(terms, term) {
  const key = financeEntityTermKey(term)
  for (const existing of terms) {
    if (financeEntityTermKey(existing) === key) return true
  }
  return false
}

function addFinanceEntityTermCandidates(target, value, options = {}) {
  const raw = safeErrorMessage(String(value ?? "").trim())
  if (!raw) return
  const extractEmbeddedAcronyms = options.extractEmbeddedAcronyms !== false
  const candidates = [
    raw,
    ...parseFinanceEntityAliases(raw),
    ...(extractEmbeddedAcronyms ? (raw.match(/[A-Z][A-Z0-9-]{1,12}/g) ?? []) : []),
  ]
  for (const candidate of candidates) {
    const term = normalizeIndustryTerm(candidate)
    if (!isUsefulFinanceEntityTerm(term)) continue
    if (financeEntityTermSetHas(target, term)) continue
    target.add(term)
  }
}

function addFinanceEntityTermType(target, term, type) {
  const normalizedTerm = safeErrorMessage(String(term ?? "").trim())
  const normalizedType = safeErrorMessage(String(type ?? "").trim())
  if (!normalizedTerm || !FINANCE_ENTITY_AUDIT_TYPES.has(normalizedType)) return
  const existing = target.get(normalizedTerm) ?? []
  if (!existing.includes(normalizedType)) target.set(normalizedTerm, [...existing, normalizedType])
}

function addFinanceEntityPageTermType(target, pageRef, term, type) {
  const normalizedPageRef = normalizeFinanceEntityPageRef(pageRef)
  if (!normalizedPageRef) return
  const existing = target.get(normalizedPageRef) ?? new Map()
  addFinanceEntityTermType(existing, term, type)
  if (existing.size) target.set(normalizedPageRef, existing)
}

function financeEntityMatchedTypeRows(terms, termTypesByTerm) {
  const rows = []
  const seen = new Set()
  for (const term of uniqueNonEmpty(Array.isArray(terms) ? terms : [terms]).filter(isUsefulFinanceEntityTerm)) {
    for (const type of termTypesByTerm.get(term) ?? []) {
      const key = `${financeEntityTermKey(term)}\u0000${type}`
      if (seen.has(key)) continue
      seen.add(key)
      rows.push({
        term,
        type,
        label: FINANCE_ENTITY_AUDIT_TYPE_LABELS.get(type) ?? type,
      })
    }
  }
  return rows
}

function financeEntityMatchedTermsByType(rows) {
  const grouped = {}
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row?.type || !row?.term) continue
    grouped[row.type] = uniqueNonEmpty([...(grouped[row.type] ?? []), row.term]).slice(0, 4)
  }
  return grouped
}

function signalFinanceEntityTypeRank(type) {
  return SIGNAL_FINANCE_ENTITY_TYPE_RANK.get(String(type ?? "")) ?? SIGNAL_FINANCE_ENTITY_TYPE_RANK.size
}

function isUsefulSignalFinanceEntityTypeTerm(term, type) {
  const normalizedTerm = safeErrorMessage(String(term ?? "").trim())
  const normalizedType = safeErrorMessage(String(type ?? "").trim())
  if (!normalizedTerm || !normalizedType) return false
  if (normalizedType === "catalyst") {
    return textHasAny(normalizedTerm, [
      ...CATALYST_PATTERNS,
      /上修|业绩|指引|订单|中标|认证|送样|扩产|涨价|提价|调价|交付|导入|突破/,
    ])
  }
  if (normalizedType === "risk_factor") {
    return textHasAny(normalizedTerm, [
      ...NEGATIVE_EVIDENCE_PATTERNS,
      /风险|扰动|瓶颈|缺口|放缓|证伪|反证|拥挤|降价|砍单|延期|不及预期/,
    ])
  }
  if (normalizedType === "trade_pattern") {
    return textHasAny(normalizedTerm, [
      ...MARKET_PATTERNS,
      /分歧|一致|轮动|补涨|低吸|涨停|连板|反包|承接|放量|缩量|量价|突破|回流|兑现/,
    ])
  }
  return true
}

function textIncludesFinanceEntityTerm(text, term) {
  const haystack = String(text ?? "")
  const needle = String(term ?? "").trim()
  if (!haystack || !needle) return false
  if (/^[A-Za-z0-9+.-]+$/.test(needle)) {
    const pattern = new RegExp(`(^|[^A-Za-z0-9])${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Za-z0-9]|$)`, "i")
    return pattern.test(haystack)
  }
  return haystack.toLowerCase().includes(needle.toLowerCase())
}

function financeSignalEntitiesForText(text, financeEntityAudit, limit = 14) {
  const rows = []
  const seen = new Set()
  const terms = Array.isArray(financeEntityAudit?.signalTerms) && financeEntityAudit.signalTerms.length
    ? financeEntityAudit.signalTerms
    : Array.isArray(financeEntityAudit?.terms) && financeEntityAudit.terms.length
      ? financeEntityAudit.terms
      : [...(financeEntityAudit?.termTypesByTerm?.keys?.() ?? [])]
  for (const term of terms) {
    const normalizedTerm = safeErrorMessage(String(term ?? "").trim())
    if (!normalizedTerm || !isUsefulFinanceEntityTerm(normalizedTerm)) continue
    if (!textIncludesFinanceEntityTerm(text, normalizedTerm)) continue
    const types = financeEntityAudit?.termTypesByTerm?.get?.(normalizedTerm) ?? []
    for (const type of types) {
      if (!SIGNAL_FINANCE_ENTITY_TYPES.has(type)) continue
      if (!isUsefulSignalFinanceEntityTypeTerm(normalizedTerm, type)) continue
      const key = `${financeEntityTermKey(normalizedTerm)}\u0000${type}`
      if (seen.has(key)) continue
      seen.add(key)
      rows.push({
        term: normalizedTerm,
        type,
        label: FINANCE_ENTITY_AUDIT_TYPE_LABELS.get(type) ?? type,
      })
    }
  }
  const sorted = rows
    .sort((a, b) => signalFinanceEntityTypeRank(a.type) - signalFinanceEntityTypeRank(b.type)
      || b.term.length - a.term.length
      || a.term.localeCompare(b.term))
  const typeCounts = new Map()
  const selected = []
  for (const row of sorted) {
    const type = safeErrorMessage(String(row.type ?? "").trim())
    const typeLimit = SIGNAL_FINANCE_ENTITY_TYPE_LIMITS.get(type) ?? 2
    const currentCount = typeCounts.get(type) ?? 0
    if (currentCount >= typeLimit) continue
    selected.push(row)
    typeCounts.set(type, currentCount + 1)
    if (selected.length >= limit) break
  }
  return selected
}

function normalizeFinanceEntityPageRef(value) {
  const ref = safeErrorMessage(String(value ?? "")
    .replace(/^\[\[/, "")
    .replace(/\]\]$/, "")
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/^\/+/, "")
    .trim())
  if (!ref || !ref.startsWith("wiki/")) return ""
  return ref
}

function parseFinanceEntityAuditRootValues(value) {
  const values = Array.isArray(value) ? value : [value]
  return uniqueNonEmpty(values.flatMap((item) => String(item ?? "")
    .split(new RegExp(`[${path.delimiter === "\\" ? "\\\\" : path.delimiter};,\\n]+`, "g"))))
}

function defaultFinanceEntityAuditRootValues(options = {}) {
  const configuredDefaultRoots = options.defaultFinanceEntityAuditRoots
    ?? options["default-finance-entity-audit-roots"]
    ?? process.env[FINANCE_ENTITY_AUDIT_DEFAULT_ROOT_ENV]
  if (configuredDefaultRoots != null) return parseFinanceEntityAuditRootValues(configuredDefaultRoots)
  if (process.env.VITEST || process.env.NODE_ENV === "test") return []
  return DEFAULT_FINANCE_ENTITY_AUDIT_ROOTS
}

function financeEntityAuditSearchRoots(projectPath, options = {}) {
  const configuredRoots = parseFinanceEntityAuditRootValues(
    options.financeEntityAuditRoots
      ?? options["finance-entity-audit-roots"]
      ?? options.financeEntityAuditRoot
      ?? options["finance-entity-audit-root"]
      ?? process.env[FINANCE_ENTITY_AUDIT_ROOT_ENV]
      ?? process.env[FINANCE_ENTITY_AUDIT_ROOT_ENV_LEGACY],
  )
  const defaultRoots = defaultFinanceEntityAuditRootValues(options)
  const roots = []
  const addRoots = (values) => {
    for (const rawRoot of values) {
      const resolved = path.isAbsolute(rawRoot) ? rawRoot : path.join(projectPath, rawRoot)
      roots.push(resolved)
      if (!resolved.endsWith(FINANCE_ENTITY_AUDIT_ROOT)) {
        roots.push(path.join(resolved, FINANCE_ENTITY_AUDIT_ROOT))
      }
    }
  }
  addRoots(configuredRoots)
  addRoots([path.join(projectPath, FINANCE_ENTITY_AUDIT_ROOT)])
  addRoots(defaultRoots)
  return uniqueNonEmpty(roots.map(normalizePath))
}

async function latestFinanceEntityAuditTable(projectPath, options = {}) {
  const roots = financeEntityAuditSearchRoots(projectPath, options)
  const candidates = []
  const addCandidate = async (basePath, rootRank) => {
    if (!basePath) return
    const stats = await readJsonFile(path.join(basePath, "project-entity-stats.json")).catch(() => null)
    const entityRows = Number(stats?.entityRows ?? 0)
    const successfulFiles = Number(stats?.successfulFiles ?? 0)
    const failedFiles = Number(stats?.failedFiles ?? 0)
    const processedFiles = Number(stats?.processedFiles ?? 0)
    for (const fileName of FINANCE_ENTITY_AUDIT_TABLE_FILES) {
      const filePath = path.join(basePath, fileName)
      const stat = await fs.stat(filePath).catch(() => null)
      if (!stat?.isFile()) continue
      candidates.push({
        filePath,
        fileName,
        mtimeMs: stat.mtimeMs,
        size: stat.size,
        rootRank,
        priority: FINANCE_ENTITY_AUDIT_TABLE_FILES.indexOf(fileName),
        entityRows: Number.isFinite(entityRows) ? entityRows : 0,
        successfulFiles: Number.isFinite(successfulFiles) ? successfulFiles : 0,
        failedFiles: Number.isFinite(failedFiles) ? failedFiles : Number.MAX_SAFE_INTEGER,
        processedFiles: Number.isFinite(processedFiles) ? processedFiles : 0,
      })
    }
  }
  for (const [rootRank, root] of roots.entries()) {
    await addCandidate(root, rootRank)
    const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (entry.isDirectory()) await addCandidate(path.join(root, entry.name), rootRank)
    }
  }
  return candidates
    .sort((a, b) => a.rootRank - b.rootRank
      || b.entityRows - a.entityRows
      || b.successfulFiles - a.successfulFiles
      || a.failedFiles - b.failedFiles
      || b.processedFiles - a.processedFiles
      || a.priority - b.priority
      || b.mtimeMs - a.mtimeMs
      || a.filePath.localeCompare(b.filePath))
    [0] ?? null
}

function financeEntityAuditTableRef(projectPath, filePath) {
  const relative = projectRelative(projectPath, filePath)
  if (relative.startsWith("..")) return normalizePath(filePath)
  return relative
}

async function loadFinanceEntityAuditIndex(projectPath, options = {}) {
  const table = await latestFinanceEntityAuditTable(projectPath, options)
  if (!table) return { terms: [], signalTerms: [], pageTermsByRef: new Map(), pageTermTypesByRef: new Map(), termTypesByTerm: new Map(), tableRef: null, rowCount: 0, typeCounts: {} }
  const cacheKey = `${normalizePath(projectPath)}\u0000${financeEntityAuditSearchRoots(projectPath, options).join("\u0000")}`
  const cached = financeEntityAuditCache.get(cacheKey)
  if (cached?.filePath === table.filePath && cached?.mtimeMs === table.mtimeMs && cached?.size === table.size) return cached.index
  const stats = await readJsonFile(path.join(path.dirname(table.filePath), "project-entity-stats.json")).catch(() => null)
  const typeCounts = stats && typeof stats.typeCounts === "object" && !Array.isArray(stats.typeCounts)
    ? Object.fromEntries(Object.entries(stats.typeCounts)
      .filter(([type, count]) => FINANCE_ENTITY_AUDIT_TYPES.has(String(type)) && Number.isFinite(Number(count)))
      .map(([type, count]) => [type, Number(count)]))
    : {}
  const rows = parseCsvObjects(await readIfExists(table.filePath))
  const entries = rows
    .map((row, index) => {
      const type = rowValue(row, ["实体类型", "type"]).toLowerCase()
      const count = Number(rowValue(row, ["出现次数", "count"]) || 0) || 0
      return {
        index,
        type,
        count,
        name: rowValue(row, ["实体名", "name"]),
        normalizedName: rowValue(row, ["归一名", "normalizedName"]),
        aliases: rowValue(row, ["别名", "aliases"]),
        pageRef: normalizeFinanceEntityPageRef(rowValue(row, ["代表页面", "sampleWikiPath"])),
      }
    })
    .filter((entry) => FINANCE_ENTITY_AUDIT_TYPES.has(entry.type) && (entry.name || entry.normalizedName || entry.aliases))
    .sort((a, b) => b.count - a.count || a.index - b.index)

  const termSet = new Set()
  const signalTermSet = new Set()
  const typeTermCounts = new Map()
  const pageTermsByRef = new Map()
  const pageTermTypesByRef = new Map()
  const termTypesByTerm = new Map()
  for (const entry of entries) {
    if (!SEARCHABLE_FINANCE_ENTITY_AUDIT_TYPES.has(entry.type)) continue
    const entryTerms = new Set()
    addFinanceEntityTermCandidates(entryTerms, entry.name)
    addFinanceEntityTermCandidates(entryTerms, entry.normalizedName)
    addFinanceEntityTermCandidates(entryTerms, entry.aliases, {
      extractEmbeddedAcronyms: !["stock", "company"].includes(entry.type),
    })
    const usefulTerms = [...entryTerms].filter(isUsefulFinanceEntityTerm)
    for (const term of usefulTerms) {
      addFinanceEntityTermType(termTypesByTerm, term, entry.type)
      addFinanceEntityPageTermType(pageTermTypesByRef, entry.pageRef, term, entry.type)
      if (SIGNAL_FINANCE_ENTITY_TYPES.has(entry.type) && signalTermSet.size < FINANCE_ENTITY_AUDIT_SIGNAL_TERM_LIMIT) {
        signalTermSet.add(term)
      }
      if (termSet.has(term)) continue
      const typeLimit = FINANCE_ENTITY_AUDIT_TYPE_TERM_LIMITS.get(entry.type) ?? 120
      const typeCount = typeTermCounts.get(entry.type) ?? 0
      if (termSet.size < FINANCE_ENTITY_AUDIT_TERM_LIMIT && typeCount < typeLimit) {
        termSet.add(term)
        typeTermCounts.set(entry.type, typeCount + 1)
      }
    }
    if (entry.pageRef && usefulTerms.length) {
      const existing = pageTermsByRef.get(entry.pageRef) ?? []
      pageTermsByRef.set(entry.pageRef, uniqueNonEmpty([...existing, ...usefulTerms]).slice(0, FINANCE_ENTITY_AUDIT_TERMS_PER_PAGE))
    }
  }
  const index = {
    terms: [...termSet].slice(0, FINANCE_ENTITY_AUDIT_TERM_LIMIT),
    signalTerms: [...signalTermSet].slice(0, FINANCE_ENTITY_AUDIT_SIGNAL_TERM_LIMIT),
    pageTermsByRef,
    pageTermTypesByRef,
    termTypesByTerm,
    tableRef: financeEntityAuditTableRef(projectPath, table.filePath),
    rowCount: entries.length,
    typeCounts,
  }
  financeEntityAuditCache.set(cacheKey, { ...table, index })
  return index
}

async function resolveFinanceEntityAuditIndex(projectPath, options = {}) {
  if (Object.prototype.hasOwnProperty.call(options, "financeEntityAuditIndex") && options.financeEntityAuditIndex) {
    return options.financeEntityAuditIndex
  }
  if (Object.prototype.hasOwnProperty.call(options, "financeEntityAuditIndexPromise") && options.financeEntityAuditIndexPromise) {
    const index = await options.financeEntityAuditIndexPromise
    if (index) return index
  }
  return await loadFinanceEntityAuditIndex(projectPath, options)
}

function extractFrontmatterTermLines(text) {
  const fm = String(text ?? "").match(/^---\n([\s\S]*?)\n---/)
  if (!fm) return []
  return fm[1]
    .split(/\r?\n/)
    .filter((line) => /^(title|tags|aliases|segments|theme|industry|concept)\s*:/i.test(line.trim()))
    .map((line) => line.replace(/^[^:]+:\s*/, ""))
}

async function loadWikiIndustryTerms(projectPath, options = {}) {
  const terms = new Set(KNOWN_SEGMENTS.map(normalizeIndustryTerm).filter(Boolean))
  const financeEntityAudit = await resolveFinanceEntityAuditIndex(projectPath, options)
  for (const term of financeEntityAudit.terms) {
    if (terms.size >= WIKI_INDUSTRY_TERM_LIMIT) break
    if (isUsefulFinanceEntityTerm(term)) terms.add(term)
  }
  const wikiRoot = path.join(projectPath, "wiki")
  const files = (await listFilesRecursive(wikiRoot, { extensions: WATCH_FILE_EXTENSIONS }).catch(() => []))
    .sort((a, b) => a.localeCompare(b))
    .slice(0, WIKI_INDUSTRY_TERM_FILE_LIMIT)
  for (const filePath of files) {
    const relative = projectRelative(projectPath, filePath)
    for (const part of relative.split(/[\/\\]/g)) {
      addIndustryTermCandidates(terms, part)
    }
    const raw = (await readIfExists(filePath)).slice(0, 6000)
    for (const line of extractFrontmatterTermLines(raw)) {
      addIndustryTermCandidates(terms, line)
    }
    for (const match of raw.matchAll(/^#{1,3}\s+(.+)$/gm)) {
      addIndustryTermCandidates(terms, match[1])
      if (terms.size >= WIKI_INDUSTRY_TERM_LIMIT) break
    }
    if (terms.size >= WIKI_INDUSTRY_TERM_LIMIT) break
  }
  return [...terms].slice(0, WIKI_INDUSTRY_TERM_LIMIT)
}

function inferWikiPageTitle(text, filePath) {
  const frontmatterTitle = String(text ?? "").match(/^---\n[\s\S]*?^title\s*:\s*(.+)$/im)?.[1]
  const headingTitle = String(text ?? "").match(/^#\s+(.+)$/m)?.[1]
  return safeErrorMessage(String(frontmatterTitle ?? headingTitle ?? path.basename(filePath, path.extname(filePath))).trim()).slice(0, 120)
}

function wikiMetaScalar(value, limit = 180) {
  if (value == null) return ""
  if (value instanceof Date) return safeErrorMessage(value.toISOString().slice(0, 19).replace("T", " ")).slice(0, limit)
  if (Array.isArray(value) || typeof value === "object") return ""
  return safeErrorMessage(String(value).trim()).slice(0, limit)
}

function wikiMetaList(value, limit = 8) {
  if (value == null) return []
  const values = Array.isArray(value)
    ? value
    : String(value).split(/[,\n，、]+/g)
  return uniqueNonEmpty(values.map((item) => safeErrorMessage(String(item ?? "").trim()).slice(0, 120))).slice(0, limit)
}

function extractWikiFrontmatterMeta(raw) {
  const content = String(raw ?? "")
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  let fm = {}
  if (match) {
    try {
      const parsed = parseYaml(match[1])
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) fm = parsed
    } catch {
      fm = {}
    }
  }
  const body = match ? content.slice(match[0].length) : content
  const meta = {
    type: wikiMetaScalar(fm.type, 40),
    summary: wikiMetaScalar(fm.summary, 260),
    status: wikiMetaScalar(fm.status, 40),
    confidence: wikiMetaScalar(fm.confidence, 40),
    momentum: wikiMetaScalar(fm.momentum, 40),
    updated: wikiMetaScalar(fm.updated, 40),
    lastReviewed: wikiMetaScalar(fm.last_reviewed ?? fm.lastReviewed, 40),
    tags: wikiMetaList(fm.tags, 10),
    aliases: wikiMetaList(fm.aliases, 8),
    related: wikiMetaList(fm.related, 8),
    sources: wikiMetaList(fm.sources, 6),
    catalysts: wikiMetaList(fm.catalysts ?? fm.catalyst, 8),
  }
  for (const key of Object.keys(meta)) {
    if (Array.isArray(meta[key]) ? meta[key].length === 0 : !meta[key]) delete meta[key]
  }
  return { meta, body }
}

function wikiMetaFrameScore(meta) {
  if (!meta || typeof meta !== "object") return 0
  let score = 0
  const status = safeErrorMessage(String(meta.status ?? "").trim())
  const confidence = safeErrorMessage(String(meta.confidence ?? "").trim())
  const momentum = safeErrorMessage(String(meta.momentum ?? "").trim())
  if (status.includes("活跃")) score += 8
  if (status.includes("归档") || status.includes("证伪")) score -= 6
  if (confidence.includes("高")) score += 6
  else if (confidence.includes("中")) score += 3
  else if (confidence.includes("低")) score -= 2
  if (momentum.includes("热")) score += 6
  if (momentum.includes("冷")) score -= 2
  score += Math.min(8, wikiMetaList(meta.catalysts, 8).length * 3)
  score += Math.min(3, wikiMetaList(meta.sources, 6).length)
  if (wikiMetaScalar(meta.summary, 80)) score += 1
  return Math.max(-10, Math.min(18, score))
}

function financeAuditMatchedPriorityScore(terms) {
  const usefulTerms = uniqueNonEmpty(Array.isArray(terms) ? terms : [terms]).filter(isUsefulFinanceEntityTerm)
  let score = 0
  for (const term of usefulTerms) {
    const normalized = String(term ?? "").trim()
    const upper = normalized.toUpperCase()
    if (/[\u4e00-\u9fff]/.test(normalized) && normalized.length >= 4) score += 8
    else if (STRONG_SHORT_RELATED_WIKI_TERMS.has(upper)) score += 5
    else if (/\d/.test(normalized)) score += 1
    else if (normalized.length >= 4) score += 3
    else score += 1
  }
  return Math.min(12, score)
}

function normalizedRelatedWikiTermKey(term) {
  const normalized = safeErrorMessage(String(term ?? "").trim())
  if (!normalized) return ""
  return /^[A-Za-z0-9][A-Za-z0-9+.-]*$/.test(normalized)
    ? normalized.toUpperCase()
    : normalized
}

function isGenericSingleRelatedWikiTerm(term) {
  const normalized = normalizedRelatedWikiTermKey(term)
  if (!normalized) return true
  return GENERIC_SINGLE_RELATED_WIKI_TERMS.has(normalized)
    || GENERIC_SINGLE_RELATED_WIKI_TERMS.has(normalized.toUpperCase())
    || GENERIC_SINGLE_RELATED_WIKI_TERMS.has(normalized.toLowerCase())
}

function addWikiMetaTermCandidates(target, meta) {
  for (const field of ["type", "summary", "status", "confidence", "momentum"]) {
    addIndustryTermCandidates(target, meta?.[field])
  }
  for (const field of ["tags", "aliases", "related", "catalysts"]) {
    for (const value of meta?.[field] ?? []) addIndustryTermCandidates(target, value)
  }
}

function isNoisyWikiReferencePage(sourceRef, title) {
  const ref = safeErrorMessage(String(sourceRef ?? "").trim())
  const normalizedTitle = safeErrorMessage(String(title ?? "").trim())
  if (!ref || !normalizedTitle) return true
  if (/^<[^>]+>$/.test(normalizedTitle) || /<\/?think>/i.test(`${ref} ${normalizedTitle}`)) return true
  if (/(^|[/\\])(人物|个人|用户|内部)([/\\]|$)/.test(ref)) return true
  if (/^(杰哥|杰杰杰|用户|我)$/.test(normalizedTitle)) return true
  return false
}

function financeAuditRepresentativePageRank(sourceRef) {
  const ref = safeErrorMessage(String(sourceRef ?? ""))
  if (ref.startsWith("wiki/概念/")) return 0
  if (ref.startsWith("wiki/股票/")) return 1
  if (ref.startsWith("wiki/模式/")) return 2
  if (ref.startsWith("wiki/查询/")) return 3
  if (ref.startsWith("wiki/总结/")) return 4
  if (ref.startsWith("wiki/sources/") || ref.startsWith("wiki/queries/")) return 6
  return 5
}

async function loadWikiReferenceIndex(projectPath, options = {}) {
  const financeEntityAudit = await resolveFinanceEntityAuditIndex(projectPath, options)
  const wikiRoot = path.join(projectPath, "wiki")
  const files = (await listFilesRecursive(wikiRoot, { extensions: WATCH_FILE_EXTENSIONS }).catch(() => []))
    .sort((a, b) => a.localeCompare(b))
    .slice(0, WIKI_RELATED_PAGE_FILE_LIMIT)
  const pages = []
  const seenRefs = new Set()
  const addWikiReferencePage = async (filePath, extraTerms = []) => {
    const raw = (await readIfExists(filePath)).slice(0, 12000)
    if (!raw.trim()) return
    const { meta: wikiMeta, body } = extractWikiFrontmatterMeta(raw)
    const sourceRef = projectRelative(projectPath, filePath)
    if (seenRefs.has(sourceRef)) return
    const title = inferWikiPageTitle(raw, filePath)
    if (isNoisyWikiReferencePage(sourceRef, title)) return
    const terms = new Set()
    addIndustryTermCandidates(terms, title)
    for (const part of sourceRef.split(/[\/\\]/g)) {
      addIndustryTermCandidates(terms, part)
    }
    for (const term of extraTerms) {
      if (isUsefulFinanceEntityTerm(term)) terms.add(term)
    }
    for (const line of extractFrontmatterTermLines(raw)) {
      addIndustryTermCandidates(terms, line)
    }
    addWikiMetaTermCandidates(terms, wikiMeta)
    const financeAuditTerms = []
    const financeAuditTermTypes = {}
    const pageFinanceTermTypes = financeEntityAudit.pageTermTypesByRef.get(sourceRef) ?? new Map()
    for (const term of financeEntityAudit.pageTermsByRef.get(sourceRef) ?? []) {
      if (!isUsefulFinanceEntityTerm(term)) continue
      terms.add(term)
      financeAuditTerms.push(term)
      const types = pageFinanceTermTypes.get(term) ?? financeEntityAudit.termTypesByTerm.get(term) ?? []
      if (types.length) financeAuditTermTypes[term] = types
    }
    for (const match of raw.matchAll(/^#{1,3}\s+(.+)$/gm)) {
      addIndustryTermCandidates(terms, match[1])
    }
    const normalizedTerms = [...terms]
      .filter(isMeaningfulRelatedWikiTerm)
      .slice(0, 40)
    if (!normalizedTerms.length) return
    seenRefs.add(sourceRef)
    pages.push({
      sourceRef,
      title,
      pageType: wikiReferencePageType(sourceRef),
      terms: normalizedTerms,
      financeAuditTerms: uniqueNonEmpty(financeAuditTerms).slice(0, FINANCE_ENTITY_AUDIT_TERMS_PER_PAGE),
      financeAuditTermTypes,
      wikiMeta,
      excerpt: compactExcerpt(body || raw, 220),
    })
  }
  for (const filePath of files) {
    await addWikiReferencePage(filePath)
  }
  const auditRepresentativePageCandidates = []
  for (const [sourceRef, terms] of financeEntityAudit.pageTermsByRef.entries()) {
    if (seenRefs.has(sourceRef) || !sourceRef.startsWith("wiki/") || sourceRef.includes("..")) continue
    const filePath = path.join(projectPath, sourceRef)
    const stat = await fs.stat(filePath).catch(() => null)
    if (!stat?.isFile()) continue
    auditRepresentativePageCandidates.push({
      sourceRef,
      terms,
      rank: financeAuditRepresentativePageRank(sourceRef),
      termCount: terms.length,
    })
  }
  const auditRepresentativePages = auditRepresentativePageCandidates
    .sort((a, b) => a.rank - b.rank || b.termCount - a.termCount || a.sourceRef.localeCompare(b.sourceRef))
    .slice(0, FINANCE_ENTITY_AUDIT_REPRESENTATIVE_PAGE_LIMIT)
  for (const { sourceRef, terms } of auditRepresentativePages) {
    await addWikiReferencePage(path.join(projectPath, sourceRef), terms)
  }
  return pages
}

function wikiReferencePageType(sourceRef) {
  if (sourceRef.startsWith("wiki/概念/")) return "concept"
  if (sourceRef.startsWith("wiki/sources/")) return "source"
  if (sourceRef.startsWith("wiki/queries/")) return "source"
  if (sourceRef.startsWith("wiki/查询/")) return "source"
  if (sourceRef.startsWith("wiki/源文档/")) return "source"
  if (sourceRef.startsWith("wiki/总结/")) return "summary"
  return "wiki"
}

function isMeaningfulRelatedWikiTerm(term) {
  const normalized = safeErrorMessage(String(term ?? "").trim())
  if (!isMeaningfulWatchToken(normalized)) return false
  if (RELATED_WIKI_TERM_STOPWORDS.has(normalized) || RELATED_WIKI_TERM_STOPWORDS.has(normalized.toUpperCase())) return false
  if (isDateLikeText(normalized)) return false
  if (/^[A-Z]{2}$/i.test(normalized) && !STRONG_SHORT_RELATED_WIKI_TERMS.has(normalized.toUpperCase())) return false
  return true
}

function relatedWikiPagesForContext({ wikiReferenceIndex = [], sourceText = "", hypothesis = null, candidate = null, extraTerms = [] }) {
  if (!wikiReferenceIndex.length) return []
  const contextParts = [
    sourceText,
    hypothesis?.title,
    hypothesis?.theme,
    ...(hypothesis?.segments ?? []),
    ...(hypothesis?.keyVariables ?? []),
    candidate?.title,
    candidate?.theme,
    ...(candidate?.segments ?? []),
    ...(candidate?.keyVariables ?? []),
    ...(candidate?.catalystTags ?? []),
    ...(extraTerms ?? []),
  ]
  const context = contextParts.filter(Boolean).join(" ")
  const haystack = context.toLowerCase()
  const candidateTitleHaystack = String(candidate?.title ?? "").toLowerCase()
  const candidateCoreKeyVariables = (candidate?.keyVariables ?? [])
    .filter((term) => candidateTitleHaystack.includes(String(term ?? "").toLowerCase()))
  const candidateCoreCatalystTags = (candidate?.catalystTags ?? [])
    .filter((term) => candidateTitleHaystack.includes(String(term ?? "").toLowerCase()))
  const coreContextParts = [
    hypothesis?.title,
    hypothesis?.theme,
    ...(hypothesis?.keyVariables ?? []),
    candidate?.title,
    candidate?.theme,
    ...candidateCoreKeyVariables,
    ...candidateCoreCatalystTags,
  ]
  const coreHaystack = coreContextParts.filter(Boolean).join(" ").toLowerCase()
  const scored = []
  for (const page of wikiReferenceIndex) {
    const matchedTerms = []
    let score = 0
    let titleMatched = false
    let titleMatchedCore = false
    const titleTerm = normalizeIndustryTerm(page.title)
    if (titleTerm && isMeaningfulRelatedWikiTerm(titleTerm) && haystack.includes(titleTerm.toLowerCase())) {
      score += 5
      titleMatched = true
      titleMatchedCore = coreHaystack.includes(titleTerm.toLowerCase())
      matchedTerms.push(titleTerm)
    }
    for (const term of page.terms ?? []) {
      const normalized = String(term ?? "").trim()
      if (!normalized || matchedTerms.includes(normalized)) continue
      if (!haystack.includes(normalized.toLowerCase())) continue
      const isSpecific = normalized.length >= 4 || STRONG_SHORT_RELATED_WIKI_TERMS.has(normalized.toUpperCase())
      score += isSpecific ? 3 : 1
      matchedTerms.push(normalized)
    }
    if (page.pageType === "concept") score += 2
    if (page.pageType === "source") score -= 4
    if (page.pageType === "summary") score -= 5
    const strongMatchedCount = matchedTerms.filter((term) => {
      const normalized = String(term ?? "").trim()
      return normalized.length >= 4 || STRONG_SHORT_RELATED_WIKI_TERMS.has(normalized.toUpperCase())
    }).length
    const financeAuditMatchedTerms = matchedTerms.filter((term) => (page.financeAuditTerms ?? []).includes(term))
    const pageFinanceTermTypes = new Map(Object.entries(page.financeAuditTermTypes ?? {})
      .map(([term, types]) => [term, uniqueNonEmpty(Array.isArray(types) ? types : [types])]))
    const financeAuditMatchedEntities = financeEntityMatchedTypeRows(financeAuditMatchedTerms, pageFinanceTermTypes)
    const hasFinanceAuditTermMatched = financeAuditMatchedTerms.length > 0
    const hasStrongFinanceAuditRoute = financeAuditMatchedEntities.some((entity) => STRONG_RELATED_FINANCE_ENTITY_TYPES.has(entity.type))
    const coreMatchedTerms = matchedTerms.filter((term) => coreHaystack.includes(String(term ?? "").toLowerCase()))
    const coreStrongMatchedCount = coreMatchedTerms.filter((term) => {
      const normalized = String(term ?? "").trim()
      return normalized.length >= 4 || STRONG_SHORT_RELATED_WIKI_TERMS.has(normalized.toUpperCase())
    }).length
    const singleMatchedTerm = matchedTerms.length === 1 ? matchedTerms[0] : ""
    const onlyWeakFinanceRoute = hasFinanceAuditTermMatched
      && financeAuditMatchedEntities.length > 0
      && !hasStrongFinanceAuditRoute
      && financeAuditMatchedEntities.every((entity) => WEAK_SINGLE_RELATED_FINANCE_ENTITY_TYPES.has(entity.type))
    const singleWeakFinanceRoute = Boolean(singleMatchedTerm)
      && hasFinanceAuditTermMatched
      && !coreHaystack.includes(String(singleMatchedTerm).toLowerCase())
      && (onlyWeakFinanceRoute || isGenericSingleRelatedWikiTerm(singleMatchedTerm))
    const singleBroadTitleRoute = Boolean(singleMatchedTerm)
      && titleMatched
      && !titleMatchedCore
      && !hasFinanceAuditTermMatched
    if (singleWeakFinanceRoute || singleBroadTitleRoute) continue
    const minimumScore = page.pageType === "source" ? 10 : page.pageType === "summary" ? 10 : page.pageType === "concept" ? 5 : 6
    const hasCoreOrStrongFinanceRoute = coreStrongMatchedCount >= 1 || titleMatchedCore || hasStrongFinanceAuditRoute
    const hasEnoughSpecificity = titleMatchedCore
      || (strongMatchedCount >= 2 && hasCoreOrStrongFinanceRoute)
      || coreStrongMatchedCount >= 1
      || (score >= 8 && hasCoreOrStrongFinanceRoute)
      || (hasFinanceAuditTermMatched && hasStrongFinanceAuditRoute && page.pageType !== "source" && strongMatchedCount >= 1)
    if (!hasEnoughSpecificity) continue
    if (score >= minimumScore && matchedTerms.length) {
      const frameScore = wikiMetaFrameScore(page.wikiMeta)
      const financeAuditScore = financeAuditMatchedPriorityScore(financeAuditMatchedTerms)
      scored.push({
        sourceRef: page.sourceRef,
        title: page.title,
        score,
        priorityScore: score + frameScore + financeAuditScore,
        matchedTerms: matchedTerms.slice(0, 8),
        financeAuditMatchedTerms: financeAuditMatchedTerms.slice(0, 8),
        financeAuditMatchedEntities: financeAuditMatchedEntities.slice(0, 12),
        financeAuditMatchedTermsByType: financeEntityMatchedTermsByType(financeAuditMatchedEntities),
        excerpt: page.excerpt,
        wikiMeta: page.wikiMeta,
      })
    }
  }
  return scored
    .sort((a, b) => b.priorityScore - a.priorityScore || b.score - a.score || a.sourceRef.localeCompare(b.sourceRef))
    .map(({ priorityScore: _priorityScore, ...page }) => page)
    .slice(0, WIKI_RELATED_PAGE_LIMIT)
}

function catalystTagsFromText(text) {
  const raw = String(text ?? "")
  const tags = []
  const checks = [
    [/台积电|TSMC/i, "台积电"],
    [/玻璃基板|TGV|先进封装基板/i, "玻璃基板"],
    [/健滔|建滔|Kingboard/i, "建滔/健滔"],
    [/涨价函|提价函|调价函|涨价|提价|价格上调/, "涨价函/提价"],
    [/覆铜板|CCL/i, "覆铜板/CCL"],
    [/PCB/i, "PCB"],
    [/AI服务器|数据中心/, "AI数据中心"],
  ]
  for (const [pattern, label] of checks) {
    if (pattern.test(raw)) tags.push(label)
  }
  return [...new Set(tags)]
}

function stripWechatSourcePrefix(text) {
  return String(text ?? "")
    .replace(/^微信增量\s+chat=.*?\ssentAt=\d{4}[-/]\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{2}:\d{2}\s+/i, "")
    .trim()
}

function cleanCatalystTitlePhrase(value) {
  let text = safeErrorMessage(String(value ?? "").replace(/\s+/g, " ").trim())
  if (!text) return ""
  text = stripWechatSourcePrefix(text)
  const representativeEntity = text.match(/^代表来源[：:][\s\S]*?[（(]([^）)]{2,36})[）)]/)?.[1]
  if (representativeEntity) {
    text = representativeEntity
  }
  text = text
    .replace(/\*\*/g, "")
    .replace(/[`*_~]+/g, "")
    .replace(/\[[^\]]{1,24}\]/g, "")
    .replace(/[\uFE0F\u20E3]/g, "")
    .replace(/^[\s/\\\d①②③④⑤⑥⑦⑧⑨⑩、.．)）:：-]+/, "")
    .replace(/^[一二三四五六七八九十]+[、.．)）:：-]\s*/, "")
    .replace(/^(主线|上游|配套|方向|逻辑|新增变量|核心变量|催化|发酵\/异动|发酵|异动|待验证|消息|事件)[｜|:：\s-]*/i, "")
    .replace(/^[\s/\\]+/, "")
    .trim()
  if (/^(代表来源|来源|local_id)\b/i.test(text)) return ""
  if (!text) return ""
  const sentence = text.split(/[。\n\r；;]/)[0] ?? ""
  const coreSentence = sentence.split(/[｜|]/g)
    .map((part) => part.trim())
    .find((part) => part && !/^(热度|命中群|原文数|代表来源|来源|点评|结论)[：:\s]/.test(part)) ?? sentence
  const parts = sentence
    ? coreSentence
    .split(/[，,、]+/g)
    .map((part) => part.trim())
    .map((part) => part.replace(/[（(][^（）()]{0,40}$/g, "").trim())
    .filter((part) => part && !isWeakAutoWatchTitle(part))
    : []
  if (!parts.length) return ""
  let title = ""
  for (const part of parts) {
    const next = title ? `${title}、${part}` : part
    if (next.length > 36) break
    title = next
    if (title.length >= 14) break
  }
  title ||= parts[0]
  title = title
    .replace(/^(主线|上游|配套|方向|逻辑|新增变量|核心变量|催化|发酵\/异动|发酵|异动|待验证|消息|事件)[｜|:：\s-]*/i, "")
    .replace(/^#+\s*/, "")
    .replace(/(先跟踪|重点关注|建议关注|各位领导|催化明显).*$/g, "")
    .trim()
  if (isWeakCatalystPhrase(title)) return ""
  if (title.length > 42) title = `${title.slice(0, 42).trim()}...`
  if (title.length < 4 || isWeakAutoWatchTitle(title)) return ""
  return title
}

function isWeakCatalystPhrase(value) {
  const text = safeErrorMessage(String(value ?? "").trim())
  if (!text) return true
  return /多年沉淀|技术实力|高端场景|得以认证|值得关注|建议关注|重点关注|空间巨大|前景广阔/.test(text)
}

function concreteCatalystTitleFromText(text) {
  const raw = stripWechatSourcePrefix(text)
  const labeled = raw.match(/(?:新增变量|核心变量|催化|发酵\/异动|发酵|异动|待验证|消息|事件)[｜|:：]\s*([\s\S]{4,180})/i)?.[1]
  return cleanCatalystTitlePhrase(labeled || raw)
}

function candidateFocusTextFromArticle(text) {
  const raw = stripWechatSourcePrefix(String(text ?? "")
    .replace(/^---\n[\s\S]*?\n---\s*/m, "")
    .trim())
  if (!raw) return ""
  const concreteTitle = concreteCatalystTitleFromText(raw)
  const titleTokens = tokenizeForMatch(concreteTitle)
    .filter((token) => token.length >= 2)
    .slice(0, 10)
  const chunks = raw
    .split(/[\n\r]+|[。；;]/g)
    .map((chunk) => safeErrorMessage(String(chunk ?? "")
      .replace(/\*\*/g, "")
      .replace(/[`*_~]+/g, "")
      .replace(/[\uFE0F\u20E3]/g, "")
      .replace(/\s+/g, " ")
      .trim()))
    .filter((chunk) => chunk && chunk.length >= 4 && !isWeakAutoWatchTitle(chunk))
  const scored = chunks
    .map((chunk, index) => {
      const background = /背景池|其他|同时提到|还同时|顺带|一并|列表|昨日热点|不是本条核心|非本条核心/.test(chunk)
      const tokenHits = titleTokens.filter((token) => chunk.toLowerCase().includes(token.toLowerCase())).length
      let score = 0
      if (tokenHits) score += 8 + tokenHits
      if (textHasAny(chunk, HARD_FUNDAMENTAL_PATTERNS)) score += 5
      if (textHasAny(chunk, CATALYST_PATTERNS)) score += 4
      if (textHasAny(chunk, FUNDAMENTAL_PATTERNS)) score += 2
      if (background) score -= 10
      if (index === 0) score += 1
      return { chunk, score, index }
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 4)
    .sort((a, b) => a.index - b.index)
    .map((item) => item.chunk)
  const focused = uniqueNonEmpty([concreteTitle, ...scored])
    .join("\n")
    .slice(0, 1800)
  return focused || raw.replace(/\s+/g, " ").slice(0, 1800)
}

function ruleCandidateTradingImplication(text) {
  const raw = String(text ?? "")
  if (/订单|中标|招投标|重大合同|客户|送样|认证|导入|供货|量产|出货|交付/.test(raw)) {
    return "更接近可跟踪硬催化，建议 Ask 深挖关联股票、订单兑现路径和后续量价反馈。"
  }
  if (/涨价函|提价函|调价函|涨价|提价|价格上调/.test(raw)) {
    return "价格类新催化，建议 Ask 深挖受益链条、库存位置、涨价传导和相关标的排序。"
  }
  if (/交易热度|盘中强势|美股|IPO|配售|传闻|小作文|市场传/.test(raw)) {
    return "偏交易热度或传闻扩散，先观察二次确认和价格反馈，不直接当作基本面兑现。"
  }
  return "新增信息可形成候选假设，建议先加入观察或 Ask 深挖，确认是否值得进入假设池。"
}

function isCatalystSignal(text) {
  return textHasAny(text, CATALYST_PATTERNS)
}

function inferSegmentsFromText(text, extraTerms = []) {
  const upperText = String(text ?? "").toUpperCase()
  const terms = uniqueCaseInsensitiveNonEmpty([...KNOWN_SEGMENTS, ...extraTerms].map(normalizeIndustryTerm).filter(Boolean))
  return uniqueCaseInsensitiveNonEmpty(terms.filter((segment) => upperText.includes(segment.toUpperCase())))
}

function termMatchesCoreTitle(term, title) {
  const haystack = String(title ?? "").toLowerCase()
  if (!haystack) return false
  const raw = String(term ?? "").trim()
  if (!raw) return false
  if (haystack.includes(raw.toLowerCase())) return true
  const relaxedTerms = [
    raw.replace(/^AI/i, ""),
    raw.replace(/AI/ig, ""),
  ].filter((part) => part && part !== raw)
  if (relaxedTerms.some((part) => part.length >= 2 && haystack.includes(part.toLowerCase()))) return true
  return raw
    .split(/\s*(?:\/|／|、|,|，|\|)\s*/g)
    .filter((part) => part.length >= 2)
    .some((part) => haystack.includes(part.toLowerCase()))
}

function candidateActionContextFromText(text) {
  return String(text ?? "")
    .split(/[\n\r。；;]/g)
    .map((chunk) => safeErrorMessage(chunk.replace(/\s+/g, " ").trim()))
    .filter((chunk) => chunk
      && /(先看|先跟踪|重点看|重点跟踪|跟踪|关注|验证|量价反应|排序)/.test(chunk)
      && !/(背景池|不是本条核心|非本条核心|还提到|同时提到|顺带|一并)/.test(chunk))
    .join(" ")
    .slice(0, 500)
}

function isLikelyCompanyOrStockSegment(term) {
  const text = safeErrorMessage(String(term ?? "").trim())
  if (!text || text.length < 3 || text.length > 24) return false
  return /(股份|科技|电子|通信|光电|材料|能源|电气|化学|化工|半导体|集团|控股|证券|银行)$/.test(text)
}

function hypothesisGranularityIssue({ title = "", theme = "", segments = [], keyVariables = [] } = {}) {
  const text = [title, theme, ...(segments ?? []), ...(keyVariables ?? [])].join(" ")
  const normalizedTitle = safeErrorMessage(String(title ?? "").trim())
  const normalizedCoreTitle = normalizedTitle
    .replace(/^(新催化|候选新假设|新增变量|核心变量|催化|发酵\/异动|发酵|异动|待验证|消息|事件)[｜|:：\s-]*/i, "")
    .trim()
  const segmentCount = uniqueCaseInsensitiveNonEmpty(segments).length
  const broadCoreTitle = /^(AI算力|AI|PCB|国产替代|半导体|机器人|数据中心|新能源|消费电子|芯片)(继续景气|有投资机会|会受益|景气|机会)?$/i.test(normalizedCoreTitle)
    || /^(AI算力继续景气|PCB有投资机会|国产替代会受益)$/.test(normalizedCoreTitle)
    || (/^(AI算力|AI|PCB|国产替代|半导体|机器人|数据中心|新能源|消费电子|芯片)([\s，,、]*(预期差|自主可控|芯片|机会|关注|催化|扩散|受益))*$/i.test(normalizedCoreTitle) && segmentCount < 2)
  const broadTitle = broadCoreTitle
    || (/有投资机会|继续景气|会受益|全面受益/.test(normalizedCoreTitle || normalizedTitle) && segmentCount < 2)
  if (broadTitle) return "too_broad"

  const narrowSourceOnly = /某微信群|某篇文章|某一天|单一订单|某只股票放量|某股|今天群里|昨日群里|6月\d{1,2}日提到/.test(normalizedTitle)
  const midLevelMechanism = /(?:推动|带动).{0,24}(?:链条|产业链|细分|环节|量价|重估|扩散|弹性|验证链)|(?:提升|改善).{0,24}(?:订单|需求|渗透|弹性|盈利|毛利)|(?:进入).{0,16}(?:量价|重估|验证)|(?:产业化|涨价函|提价函).{0,24}(?:设备|材料|链条|细分|量价|重估)/.test(text)
  if (narrowSourceOnly && !midLevelMechanism) return "too_narrow"
  return ""
}

function trackingFieldsFromCandidate({ record = {}, title = "", theme = "", segments = [], keyVariables = [], sourceRefs = [] } = {}) {
  const triggerConditions = parseTextList(record.triggerConditions ?? record["trigger-conditions"] ?? record.triggers)
    .slice(0, 8)
  const invalidationSignals = parseTextList(record.invalidationSignals ?? record["invalidation-signals"] ?? record.falsifiers ?? record.risks)
    .slice(0, 8)
  const expectedEvidencePath = parseTextList(record.expectedEvidencePath ?? record["expected-evidence-path"] ?? record.evidencePath)
    .slice(0, 8)
  const relatedWikiPages = mergeRelatedWikiPages(compactObjectArray(record.relatedWikiPages ?? record["related-wiki-pages"]))
  const defaultTrigger = uniqueNonEmpty([
    ...triggerConditions,
    "新增资料出现同一细分的二次确认、价格/订单/客户/交付线索或市场量价反馈。",
  ]).slice(0, 8)
  const defaultInvalidation = uniqueNonEmpty([
    ...invalidationSignals,
    "核心变量被公告、财报、订单、客户反馈或持续量价背离证伪。",
  ]).slice(0, 8)
  const evidenceHints = uniqueNonEmpty([
    ...expectedEvidencePath,
    "新增资料 -> related wiki 框架 -> Ask 深挖关联股票/受益排序 -> 市场反馈或基本面证据复核。",
  ]).slice(0, 8)
  const granularityIssue = hypothesisGranularityIssue({ title, theme, segments, keyVariables })
  return {
    triggerConditions: defaultTrigger,
    invalidationSignals: defaultInvalidation,
    expectedEvidencePath: evidenceHints,
    relatedWikiPages,
    granularity: {
      status: granularityIssue ? "needs_review" : "trackable",
      issue: granularityIssue || null,
      rule: "中观投资假设：不是泛主题，不是单条消息；必须能被新增资料、wiki、Ask、市场反馈持续跟踪。",
    },
    sourceRefs: uniqueNonEmpty(sourceRefs).slice(0, 10),
  }
}

function filterCandidateTermsForCoreTitle(terms, title, options = {}) {
  const uniqueTerms = uniqueCaseInsensitiveNonEmpty(terms.map(normalizeIndustryTerm).filter(Boolean))
  const coreTerms = uniqueTerms.filter((term) => termMatchesCoreTitle(term, title))
  if (coreTerms.length) {
    return uniqueCaseInsensitiveNonEmpty([
      ...coreTerms,
      ...uniqueTerms.filter((term) => isLikelyCompanyOrStockSegment(term)),
    ])
  }
  if (options.fallback === false) return []
  return uniqueTerms
    .filter((term) => !isGenericSingleRelatedWikiTerm(term))
    .slice(0, 8)
}

function inferThemeFromText(text, sourcePath) {
  const firstHeading = String(text ?? "").match(/^#\s+(.+)$/m)?.[1]
  const heading = safeErrorMessage(String(firstHeading ?? "").trim()).slice(0, 80)
  if (heading && !isWeakAutoWatchTitle(heading)) return heading
  const basename = safeErrorMessage(path.basename(sourcePath ?? "source", path.extname(sourcePath ?? ""))).slice(0, 80)
  return isWeakAutoWatchTitle(basename) ? "" : basename
}

function inferEvidenceDelta(text) {
  const hasPositive = textHasAny(text, POSITIVE_EVIDENCE_PATTERNS)
  const hasNegative = textHasAny(text, NEGATIVE_EVIDENCE_PATTERNS)
  const hasMarket = textHasAny(text, MARKET_PATTERNS)
  const hasFundamental = textHasAny(text, FUNDAMENTAL_PATTERNS) && !textHasAny(text, FUNDAMENTAL_GAP_PATTERNS)
  const hasFundamentalGap = textHasAny(text, FUNDAMENTAL_GAP_PATTERNS)
  const hasCatalyst = isCatalystSignal(text)
  const hasHardFundamental = textHasAny(text, HARD_FUNDAMENTAL_PATTERNS)
  if (/反证|证伪|不及预期|砍单|延期|降价/.test(text)) return "counter_signal"
  if (hasCatalyst && !hasHardFundamental) return "catalyst_signal"
  if (hasFundamental && hasPositive && /订单|中标|招投标|公告|CNINFO|财报|收入|毛利率|ASP|客户|交付/.test(text)) return "fundamental_delivery"
  if (hasPositive && hasNegative && /利好|推动|转向|带动|受益|量价齐升/.test(text)) return "supporting_signal"
  if (hasPositive && hasNegative) return "mixed_signal"
  if (hasMarket && (!hasFundamental || hasFundamentalGap)) return "market_feedback"
  if (hasPositive) return "supporting_signal"
  if (hasNegative) return "counter_signal"
  if (/研报|卖方|预计|有望|空间|弹性|增速|景气|叙事|催化/.test(text)) return "narrative_expansion"
  return "new_context"
}

function confidenceImpactForDelta(delta) {
  if (delta === "fundamental_delivery") return { direction: "positive", delta: 0.12, reason: "source contains order/announcement/financial/customer delivery evidence" }
  if (delta === "catalyst_signal") return { direction: "positive", delta: 0.03, reason: "source contains a fresh tradable catalyst; follow price/volume and second confirmation before upgrading conviction" }
  if (delta === "market_feedback") return { direction: "neutral", delta: 0, reason: "market feedback is visible but fundamental closure is incomplete" }
  if (delta === "supporting_signal") return { direction: "positive", delta: 0.05, reason: "source contains order/customer/delivery/financial validation language" }
  if (delta === "counter_signal") return { direction: "negative", delta: -0.05, reason: "source contains slowdown/risk/refutation language" }
  if (delta === "mixed_signal") return { direction: "mixed", delta: 0, reason: "source contains both supportive and counterevidence language" }
  if (delta === "narrative_expansion") return { direction: "neutral", delta: 0, reason: "source expands narrative but does not close market/fundamental evidence" }
  return { direction: "neutral", delta: 0, reason: "source adds context but not enough validation evidence" }
}

function guardSuggestedStatusTransition({ delta, currentStatus, suggestedStatus, suggestedStatusReason }) {
  const status = normalizeStatus(currentStatus, "watching")
  const next = normalizeStatus(suggestedStatus, status)
  if (status === "archived" || status === "disconfirmed" || status === "actionable") {
    return {
      suggestedStatus: status,
      suggestedStatusReason: "persisted status is high-priority and should not be changed automatically",
    }
  }
  if (status === "divergent" && WEAK_AUTOWATCH_EVIDENCE_DELTAS.has(delta)) {
    return {
      suggestedStatus: "divergent",
      suggestedStatusReason: "divergent status requires hard supporting evidence or manual review before upgrade",
    }
  }
  if (status === "priced_in" && WEAK_AUTOWATCH_EVIDENCE_DELTAS.has(delta)) {
    return {
      suggestedStatus: "priced_in",
      suggestedStatusReason: "priced-in status should not be lowered by soft narrative or market context",
    }
  }
  if (status === "strengthening" && (delta === "narrative_expansion" || delta === "new_context")) {
    return {
      suggestedStatus: "strengthening",
      suggestedStatusReason: "existing strengthening status is stronger than generic new context",
    }
  }
  return {
    suggestedStatus: next,
    suggestedStatusReason,
  }
}

function suggestedStatusForEvidenceDelta(delta, currentStatus = "watching") {
  const status = normalizeStatus(currentStatus, "watching")
  let suggestion
  if (delta === "counter_signal") {
    suggestion = {
      suggestedStatus: "divergent",
      suggestedStatusReason: "counter signal appeared; route to divergence review before treating the hypothesis as stronger",
    }
  } else if (delta === "market_feedback") {
    suggestion = {
      suggestedStatus: "priced_in",
      suggestedStatusReason: "market feedback appeared before fundamental closure; treat as priced-in risk",
    }
  } else if (delta === "fundamental_delivery" || delta === "supporting_signal") {
    suggestion = {
      suggestedStatus: "strengthening",
      suggestedStatusReason: "supporting or fundamental evidence appeared; human review can upgrade from watching",
    }
  } else if (delta === "catalyst_signal") {
    suggestion = {
      suggestedStatus: "watching",
      suggestedStatusReason: "fresh catalyst should enter follow-through tracking before upgrading status",
    }
  } else {
    suggestion = {
      suggestedStatus: status === "seed" ? "watching" : status,
      suggestedStatusReason: "new context is not decisive enough to upgrade the hypothesis",
    }
  }
  return guardSuggestedStatusTransition({
    delta,
    currentStatus: status,
    suggestedStatus: suggestion.suggestedStatus,
    suggestedStatusReason: suggestion.suggestedStatusReason,
  })
}

function evidenceGapsForText(text) {
  if (isCatalystSignal(text) && !textHasAny(text, HARD_FUNDAMENTAL_PATTERNS)) {
    return [
      "catalyst:market_reaction:not_checked",
      "catalyst:follow_through:not_checked",
      "catalyst:second_source:not_checked",
    ]
  }
  const gaps = []
  const explicitGap = textHasAny(text, FUNDAMENTAL_GAP_PATTERNS)
  if (!/订单|中标|招投标/.test(text) || explicitGap) gaps.push("fundamental:orders:not_checked")
  if (!/公告|CNINFO|交易所/.test(text) || explicitGap) gaps.push("fundamental:announcement:not_checked")
  if (!/财报|收入|毛利率|现金流/.test(text) || explicitGap) gaps.push("fundamental:financials:not_checked")
  if (!/ASP|价格|单柜|用量|份额/.test(text)) gaps.push("industry:variables:not_checked")
  return gaps
}

function tokenizeForMatch(text) {
  return [...new Set(String(text ?? "")
    .split(/[^\p{L}\p{N}]+/gu)
    .map((item) => item.trim())
    .filter(isMeaningfulWatchToken)
    .slice(0, 80))]
}

function normalizeRouteToken(value) {
  return safeErrorMessage(String(value ?? "")
    .replace(/\s+/g, "")
    .trim()
    .toLowerCase())
}

function routeAcronymsFromText(value) {
  return [...new Set((String(value ?? "").match(/[A-Z][A-Z0-9-]{1,12}/g) ?? [])
    .map((token) => token.toUpperCase())
    .filter((token) => STRONG_SHORT_RELATED_WIKI_TERMS.has(token)))]
}

function expandedHypothesisRouteTerms(hypothesis) {
  const terms = new Set()
  const add = (value, options = {}) => {
    const raw = safeErrorMessage(String(value ?? "").trim())
    if (!raw) return
    const normalizedRaw = normalizeIndustryTerm(raw)
    if (normalizedRaw) terms.add(normalizedRaw)
    for (const part of raw.split(/[\/\\|｜,，、;；\s\t\-_:：()[\]【】]+/g)) {
      const normalizedPart = normalizeIndustryTerm(part)
      if (normalizedPart) terms.add(normalizedPart)
    }
    for (const token of tokenizeForMatch(raw)) terms.add(token)
    if (options.extractAcronyms !== false) {
      for (const acronym of routeAcronymsFromText(raw)) terms.add(acronym)
    }
  }
  let specificAnchorCount = 0
  for (const value of hypothesis?.segments ?? []) {
    const before = terms.size
    add(value)
    if (terms.size > before) specificAnchorCount += 1
  }
  for (const value of hypothesis?.keyVariables ?? []) {
    const before = terms.size
    add(value)
    if (terms.size > before) specificAnchorCount += 1
  }
  if (specificAnchorCount === 0) {
    add(hypothesis?.theme)
    add(hypothesis?.title)
  }
  return [...terms].filter(isMeaningfulWatchToken).slice(0, 80)
}

const FINANCE_ROUTE_SUBSTRING_TYPES = new Set([
  "product_line",
  "supply_chain_role",
  "tech_route",
])

function routeTokensOverlap(left, right, options = {}) {
  const leftKey = normalizeRouteToken(left)
  const rightKey = normalizeRouteToken(right)
  if (!leftKey || !rightKey) return false
  if (leftKey === rightKey) return true
  if (options.allowSubstring === false) return false
  if (leftKey.length >= 4 && rightKey.length >= 4 && (leftKey.includes(rightKey) || rightKey.includes(leftKey))) return true
  return false
}

function financeRouteForHypothesis(hypothesis, financeSignalEntities = []) {
  const hypothesisTerms = expandedHypothesisRouteTerms(hypothesis)
  if (!hypothesisTerms.length || !Array.isArray(financeSignalEntities) || !financeSignalEntities.length) {
    return { score: 0, matchedTerms: [] }
  }
  const hypothesisAcronyms = new Set(hypothesisTerms.flatMap(routeAcronymsFromText))
  let score = 0
  const matchedTerms = []
  const seen = new Set()
  for (const entity of financeSignalEntities) {
    const term = safeErrorMessage(String(entity?.term ?? "").trim())
    const type = safeErrorMessage(String(entity?.type ?? "").trim())
    if (!term || !SIGNAL_FINANCE_ENTITY_TYPES.has(type)) continue
    let entityScore = 0
    if (hypothesisTerms.some((hypothesisTerm) => routeTokensOverlap(hypothesisTerm, term, {
      allowSubstring: FINANCE_ROUTE_SUBSTRING_TYPES.has(type),
    }))) {
      entityScore += 2
    }
    const sharedAcronyms = routeAcronymsFromText(term).filter((token) => hypothesisAcronyms.has(token))
    if (sharedAcronyms.length) {
      entityScore += /^[A-Z][A-Z0-9-]{1,12}$/.test(term) ? 1 : 2
    }
    if (entityScore <= 0) continue
    if (STRONG_RELATED_FINANCE_ENTITY_TYPES.has(type)) entityScore += 1
    score += entityScore
    const key = financeEntityTermKey(term)
    if (!seen.has(key)) {
      seen.add(key)
      matchedTerms.push(term)
    }
  }
  return { score: Math.min(6, score), matchedTerms: matchedTerms.slice(0, 8) }
}

function isWeakAutoWatchHypothesis(hypothesis) {
  if (isWeakAutoWatchTitle(hypothesis?.title)) return true
  const meaningfulParts = [
    hypothesis?.title,
    hypothesis?.theme,
    ...(hypothesis?.segments ?? []),
    ...(hypothesis?.keyVariables ?? []),
  ].flatMap((item) => tokenizeForMatch(item))
  return meaningfulParts.length === 0
}

function scoreHypothesisMatch(hypothesis, text, options = {}) {
  const haystack = String(text ?? "").toLowerCase()
  let score = 0
  if (hypothesis.id && haystack.includes(String(hypothesis.id).toLowerCase())) score += 10
  if (hypothesis.theme && haystack.includes(String(hypothesis.theme).toLowerCase())) score += 3
  for (const segment of hypothesis.segments ?? []) {
    if (haystack.includes(String(segment).toLowerCase())) score += 2
  }
  for (const token of tokenizeForMatch(hypothesis.title)) {
    if (haystack.includes(token.toLowerCase())) score += 1
  }
  score += financeRouteForHypothesis(hypothesis, options.financeSignalEntities).score
  return score
}

function candidateHypothesisFromArticle({ text, sourcePath, generatedAt, wikiIndustryTerms = [] }) {
  const focusText = candidateFocusTextFromArticle(text) || text
  const matchedSegments = inferSegmentsFromText(focusText, wikiIndustryTerms)
  const rawCatalystTags = catalystTagsFromText(focusText)
  const isCatalyst = isCatalystSignal(focusText) || isCatalystSignal(text)
  const inferredTheme = inferThemeFromText(text, sourcePath)
  if (!isCatalyst && !inferredTheme) return null
  const concreteTitle = isCatalyst ? concreteCatalystTitleFromText(focusText) || concreteCatalystTitleFromText(text) : ""
  const coreTitle = uniqueNonEmpty([
    concreteTitle || inferredTheme,
    candidateActionContextFromText(focusText),
  ]).join(" ") || focusText
  const catalystTags = filterCandidateTermsForCoreTitle(rawCatalystTags, coreTitle, { fallback: false })
  const segments = filterCandidateTermsForCoreTitle([...matchedSegments, ...catalystTags], coreTitle).slice(0, 12)
  if (isCatalyst && !rawCatalystTags.length && !segments.length) return null
  const theme = inferredTheme || catalystTags[0] || segments[0] || ""
  const catalystTitleParts = catalystTags.length ? catalystTags : segments.slice(0, 4)
  if (isCatalyst && !concreteTitle && !catalystTags.length && segments.length <= 1) return null
  const title = isCatalyst
    ? `新催化：${concreteTitle || catalystTitleParts.slice(0, 4).join(" / ")}`
    : theme
  if (isWeakAutoWatchTitle(title)) return null
  const keyVariables = isCatalyst ? catalystTags : []
  const trackingFields = trackingFieldsFromCandidate({
    title,
    theme,
    segments,
    keyVariables,
  })
  if (trackingFields.granularity.issue) return null
  return {
    schema: HYPOTHESIS_LIBRARY_SCHEMA,
    id: stableHypothesisId({ title, theme, segments }),
    title,
    theme,
    segments,
    status: "seed",
    conviction: 0,
    timeHorizon: isCatalyst ? "未来1-6个月" : "未来3-12个月",
    keyVariables,
    triggerConditions: trackingFields.triggerConditions,
    invalidationSignals: trackingFields.invalidationSignals,
    expectedEvidencePath: trackingFields.expectedEvidencePath,
    evidenceRefs: trackingFields.sourceRefs,
    marketRefs: [],
    risks: [],
    relatedWikiPages: trackingFields.relatedWikiPages,
    granularity: trackingFields.granularity,
    nextValidationDate: null,
    createdAt: generatedAt,
    updatedAt: generatedAt,
    evidenceDelta: isCatalyst ? "catalyst_signal" : "new_context",
    signalType: isCatalyst ? "新催化" : "叙事扩散",
    reason: isCatalyst
      ? "新增舆情出现可跟踪催化，但未命中已有假设，需要人工决定是否加入跟踪。"
      : "新增资料更像独立主题，未命中已有假设，需要人工决定是否创建。",
    tradingImplication: isCatalyst ? ruleCandidateTradingImplication(focusText) : "先判断是否具备可跟踪变量，再决定是否加入假设池。",
    askDeepDiveRecommended: Boolean(isCatalyst),
    discoveryReason: isCatalyst ? "来自新增舆情的催化候选，需人工决定是否加入跟踪。" : "来自新增资料标题或主题的候选假设。",
  }
}

function dedupeCandidateHypotheses(candidates) {
  const byId = new Map()
  const firstSeen = new Map()
  candidates.forEach((candidate, index) => {
    if (!candidate?.id) return
    const key = candidateClusterKey(candidate) || `${candidate.title ?? ""}::${candidate.theme ?? ""}`.toLowerCase()
    if (!firstSeen.has(key)) firstSeen.set(key, index)
    if (!byId.has(key)) {
      byId.set(key, withCandidateClusterMetadata(candidate, key))
      return
    }
    const existing = byId.get(key)
    byId.set(key, mergeCandidateCluster(existing, candidate, key))
  })
  return [...byId.entries()]
    .map(([key, candidate]) => ({ key, candidate }))
    .sort((a, b) => candidatePriorityScore(b.candidate) - candidatePriorityScore(a.candidate)
      || (firstSeen.get(a.key) ?? 0) - (firstSeen.get(b.key) ?? 0)
      || String(a.candidate.title ?? "").localeCompare(String(b.candidate.title ?? "")))
    .map((item) => item.candidate)
}

function candidateClusterKey(candidate) {
  const text = [
    candidate?.title,
    candidate?.theme,
    ...(candidate?.segments ?? []),
    ...(candidate?.keyVariables ?? []),
    candidate?.sourceExcerpt,
  ].join(" ")
  const entities = [
    [/中国西电/i, "中国西电"],
    [/王子新材/i, "王子新材"],
    [/SpaceX|SPCX/i, "SpaceX"],
    [/台积电|TSMC/i, "台积电"],
    [/健滔|建滔|Kingboard/i, "建滔/健滔"],
    [/甬矽/i, "甬矽"],
    [/新益昌/i, "新益昌"],
    [/南通星辰/i, "南通星辰"],
    [/亚马逊|Amazon/i, "亚马逊"],
    [/村田|TDK|堺化学/i, "MLCC粉体认证"],
  ]
  const topics = [
    [/SST|800V|VDC|kVAC/i, "SST/800V"],
    [/MPO|CPO|NPO|硅光|光模块/i, "光互联"],
    [/MLCC/i, "MLCC"],
    [/玻璃基板|TGV/i, "玻璃基板"],
    [/覆铜板|CCL|PCB/i, "PCB材料"],
    [/SpaceX|SPCX|IPO/i, "SpaceX"],
  ]
  const entity = entities.find(([pattern]) => pattern.test(text))?.[1]
  if (!entity) return ""
  const topic = topics.find(([pattern]) => pattern.test(text))?.[1] || safeErrorMessage(String(candidate?.theme ?? "").trim())
  return `signal:${entity}:${topic}`.toLowerCase()
}

function withCandidateClusterMetadata(candidate, clusterKey) {
  const sourceExcerpts = uniqueNonEmpty([...(candidate.sourceExcerpts ?? []), candidate.sourceExcerpt]).slice(0, 5)
  const sourceRefs = uniqueNonEmpty([...(candidate.sourceRefs ?? []), candidate.discoverySourceRef, candidate.sourceRef]).slice(0, 10)
  return withCandidatePriority({
    ...candidate,
    clusterKey,
    clusterSourceCount: Math.max(sourceExcerpts.length, sourceRefs.length, 1),
    sourceExcerpts,
    sourceRefs,
    triggerConditions: uniqueNonEmpty(candidate.triggerConditions ?? []).slice(0, 8),
    invalidationSignals: uniqueNonEmpty(candidate.invalidationSignals ?? []).slice(0, 8),
    expectedEvidencePath: uniqueNonEmpty(candidate.expectedEvidencePath ?? []).slice(0, 8),
    relatedWikiPages: mergeRelatedWikiPages(candidate.relatedWikiPages ?? []),
  })
}

function mergeCandidateCluster(existing, candidate, clusterKey) {
  const incoming = withCandidateClusterMetadata(candidate, clusterKey)
  const existingScore = candidatePriorityScore(existing)
  const incomingScore = candidatePriorityScore(incoming)
  const chosen = incomingScore > existingScore ? incoming : existing
  const sourceExcerpts = uniqueNonEmpty([...(existing.sourceExcerpts ?? []), existing.sourceExcerpt, ...(incoming.sourceExcerpts ?? []), incoming.sourceExcerpt]).slice(0, 5)
  const sourceRefs = uniqueNonEmpty([...(existing.sourceRefs ?? []), existing.discoverySourceRef, existing.sourceRef, ...(incoming.sourceRefs ?? []), incoming.discoverySourceRef, incoming.sourceRef]).slice(0, 10)
  const financeSignalEntities = compactFinanceAuditMatchedEntities([
    ...(existing.financeSignalEntities ?? existing.financeAuditMatchedEntities ?? []),
    ...(incoming.financeSignalEntities ?? incoming.financeAuditMatchedEntities ?? []),
  ], 14)
  return withCandidatePriority({
    ...chosen,
    clusterKey,
    clusterSourceCount: Math.max(sourceExcerpts.length, sourceRefs.length, 1),
    sourceExcerpts,
    sourceRefs,
    segments: uniqueCaseInsensitiveNonEmpty([...(existing.segments ?? []), ...(incoming.segments ?? [])]),
    keyVariables: uniqueCaseInsensitiveNonEmpty([...(existing.keyVariables ?? []), ...(incoming.keyVariables ?? [])]),
    triggerConditions: uniqueNonEmpty([...(existing.triggerConditions ?? []), ...(incoming.triggerConditions ?? [])]).slice(0, 8),
    invalidationSignals: uniqueNonEmpty([...(existing.invalidationSignals ?? []), ...(incoming.invalidationSignals ?? [])]).slice(0, 8),
    expectedEvidencePath: uniqueNonEmpty([...(existing.expectedEvidencePath ?? []), ...(incoming.expectedEvidencePath ?? [])]).slice(0, 8),
    financeSignalEntities,
    financeAuditMatchedEntities: financeSignalEntities,
    financeAuditMatchedTermsByType: financeEntityMatchedTermsByType(financeSignalEntities),
    relatedWikiPages: mergeRelatedWikiPages(existing.relatedWikiPages ?? [], incoming.relatedWikiPages ?? []),
    sourceExcerpt: chosen.sourceExcerpt || sourceExcerpts[0] || "",
  })
}

function uniqueNonEmpty(values) {
  return [...new Set(values.map((value) => safeErrorMessage(String(value ?? "").trim())).filter(Boolean))]
}

function uniqueCaseInsensitiveNonEmpty(values) {
  const seen = new Set()
  const result = []
  for (const value of values ?? []) {
    const normalized = safeErrorMessage(String(value ?? "").trim())
    if (!normalized) continue
    const key = normalized.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(normalized)
  }
  return result
}

function compactObjectArray(values) {
  return (Array.isArray(values) ? values : [])
    .filter((item) => item && typeof item === "object" && !Array.isArray(item))
}

function compactStringArray(values, limit = 12, maxLength = 160) {
  const list = Array.isArray(values) ? values : parseTextList(values)
  return uniqueNonEmpty(list)
    .map((value) => value.slice(0, maxLength))
    .slice(0, limit)
}

function compactFinanceAuditMatchedEntities(values, limit = 12) {
  const rows = []
  const seen = new Set()
  for (const item of Array.isArray(values) ? values : []) {
    const term = safeErrorMessage(String(item?.term ?? item?.name ?? item?.normalizedName ?? "").trim())
    const type = safeErrorMessage(String(item?.type ?? "").trim())
    if (!term || !FINANCE_ENTITY_AUDIT_TYPES.has(type)) continue
    const key = `${term}\u0000${type}`
    if (seen.has(key)) continue
    seen.add(key)
    rows.push({
      term,
      type,
      label: safeErrorMessage(String(item?.label ?? FINANCE_ENTITY_AUDIT_TYPE_LABELS.get(type) ?? type).trim()),
    })
    if (rows.length >= limit) break
  }
  return rows
}

function mergeRelatedWikiPages(...groups) {
  const byRef = new Map()
  for (const page of groups.flat()) {
    if (!page?.sourceRef) continue
    const score = Number(page.score ?? 0)
    const wikiMeta = page.wikiMeta && typeof page.wikiMeta === "object" && !Array.isArray(page.wikiMeta) ? page.wikiMeta : undefined
    const financeAuditTerms = uniqueNonEmpty(Array.isArray(page.financeAuditMatchedTerms) ? page.financeAuditMatchedTerms : [page.financeAuditMatchedTerms]).slice(0, 8)
    const financeAuditEntities = compactFinanceAuditMatchedEntities(page.financeAuditMatchedEntities)
    const priorityScore = score + wikiMetaFrameScore(wikiMeta) + financeAuditMatchedPriorityScore(financeAuditTerms)
    const existing = byRef.get(page.sourceRef)
    const existingPriorityScore = existing
      ? Number(existing.score ?? 0) + wikiMetaFrameScore(existing.wikiMeta) + financeAuditMatchedPriorityScore(existing.financeAuditMatchedTerms)
      : Number.NEGATIVE_INFINITY
    if (!existing || priorityScore > existingPriorityScore || (priorityScore === existingPriorityScore && score > Number(existing.score ?? 0))) {
      byRef.set(page.sourceRef, {
        sourceRef: page.sourceRef,
        title: page.title ?? page.sourceRef,
        score,
        matchedTerms: uniqueNonEmpty(Array.isArray(page.matchedTerms) ? page.matchedTerms : [page.matchedTerms]).slice(0, 8),
        financeAuditMatchedTerms: financeAuditTerms,
        financeAuditMatchedEntities: financeAuditEntities,
        financeAuditMatchedTermsByType: Object.keys(page.financeAuditMatchedTermsByType ?? {}).length
          ? page.financeAuditMatchedTermsByType
          : financeEntityMatchedTermsByType(financeAuditEntities),
        excerpt: page.excerpt ?? "",
        ...(wikiMeta ? { wikiMeta } : {}),
      })
    }
  }
  return [...byRef.values()]
    .sort((a, b) => {
      const priorityDiff = (
        Number(b.score ?? 0) + wikiMetaFrameScore(b.wikiMeta) + financeAuditMatchedPriorityScore(b.financeAuditMatchedTerms)
      ) - (
        Number(a.score ?? 0) + wikiMetaFrameScore(a.wikiMeta) + financeAuditMatchedPriorityScore(a.financeAuditMatchedTerms)
      )
      return priorityDiff || Number(b.score ?? 0) - Number(a.score ?? 0) || String(a.sourceRef).localeCompare(String(b.sourceRef))
    })
    .slice(0, WIKI_RELATED_PAGE_LIMIT)
}

function withCandidatePriority(candidate) {
  const priority = candidatePriorityDetails(candidate)
  return {
    ...candidate,
    priorityScore: priority.score,
    priorityReasons: priority.reasons,
  }
}

function candidatePriorityScore(candidate) {
  return candidatePriorityDetails(candidate).score
}

function candidatePriorityDetails(candidate) {
  const text = [
    candidate?.title,
    candidate?.theme,
    ...(candidate?.segments ?? []),
    ...(candidate?.keyVariables ?? []),
    candidate?.sourceExcerpt,
  ].join(" ")
  let score = 0
  const reasons = []
  if (Number(candidate?.clusterSourceCount ?? 0) > 1) {
    score += 3
    reasons.push("多来源确认")
  }
  if (/订单|中标|招投标|重大合同|客户|送样|认证|导入|供货|量产|出货|交付/.test(text)) {
    score += 8
    reasons.push("硬催化")
  }
  if (/涨价函|提价函|调价函|涨价|提价|价格上调/.test(text)) {
    score += 7
    reasons.push("价格催化")
  }
  if (/财报|收入|毛利率|ASP|份额/.test(text)) {
    score += 5
    reasons.push("财务变量")
  }
  if (/\d+(\.\d+)?\s*(亿|万|G|T|V|%|kVAC|VDC)/i.test(text)) {
    score += 2
    reasons.push("量化信息")
  }
  if (/交易热度|盘中强势|美股|IPO|配售/.test(text)) {
    score -= 4
    reasons.push("交易热度靠后")
  }
  return { score, reasons: reasons.length ? [...new Set(reasons)] : ["普通新催化"] }
}

function watchReviewItems({ events, candidateHypotheses, hypothesisById }) {
  const eventItems = events.map((event) => {
    const hypothesis = hypothesisById.get(event.hypothesisId)
    return {
      itemId: event.id,
      itemType: "event",
      hypothesisId: event.hypothesisId,
      hypothesisTitle: hypothesis?.title ?? event.hypothesisId,
      currentStatus: hypothesis?.status ?? "watching",
      ruleEvidenceDelta: event.evidenceDelta,
      ruleSuggestedStatus: event.suggestedStatus,
      sourceType: event.sourceType,
      sourceKind: event.sourceKind ?? null,
      sourceKindLabel: event.sourceKindLabel ?? null,
      sourceRef: event.sourceRef,
      sourceExcerpt: event.sourceExcerpt,
      matchedEntities: event.matchedEntities ?? [],
      catalystTags: event.catalystTags ?? [],
      financeSignalEntities: event.financeSignalEntities ?? event.financeAuditMatchedEntities ?? [],
      relatedWikiPages: event.relatedWikiPages ?? [],
    }
  })
  const candidateItems = candidateHypotheses.map((candidate) => ({
    itemId: candidate.id,
    itemType: "candidate_hypothesis",
    candidateTitle: candidate.title,
    candidateTheme: candidate.theme,
    candidateSegments: candidate.segments ?? [],
    sourceType: candidate.sourceType ?? null,
    sourceKind: candidate.sourceKind ?? null,
    sourceKindLabel: candidate.sourceKindLabel ?? null,
    sourceRef: candidate.discoverySourceRef ?? null,
    sourceExcerpt: candidate.sourceExcerpt ?? "",
    financeSignalEntities: candidate.financeSignalEntities ?? candidate.financeAuditMatchedEntities ?? [],
    relatedWikiPages: candidate.relatedWikiPages ?? [],
  }))
  return [...eventItems, ...candidateItems]
}

function normalizeWatchReview(raw, item) {
  const evidenceDelta = normalizeEvidenceDelta(raw?.evidenceDelta ?? raw?.evidence_delta, item.ruleEvidenceDelta ?? "new_context")
  const suggestedStatus = item.itemType === "event"
    ? normalizeStatus(raw?.suggestedStatus ?? raw?.suggested_status, item.ruleSuggestedStatus ?? item.currentStatus ?? "watching")
    : normalizeStatus(raw?.suggestedStatus ?? raw?.suggested_status, "seed")
  return {
    itemId: safeErrorMessage(String(raw?.itemId ?? raw?.item_id ?? item.itemId).trim()) || item.itemId,
    itemType: item.itemType,
    matchedHypothesisId: safeErrorMessage(String(raw?.matchedHypothesisId ?? raw?.matched_hypothesis_id ?? item.hypothesisId ?? "").trim()) || null,
    signalType: normalizeSignalType(raw?.signalType ?? raw?.signal_type, evidenceDelta),
    evidenceDelta,
    suggestedStatus,
    reason: safeErrorMessage(String(raw?.reason ?? raw?.rationale ?? "").trim()).slice(0, 500) || "LLM复核认为该信号需要人工判断。",
    oneLineTradingImplication: safeErrorMessage(String(raw?.oneLineTradingImplication ?? raw?.tradingImplication ?? raw?.trading_implication ?? "").trim()).slice(0, 300),
    askDeepDiveRecommended: Boolean(raw?.askDeepDiveRecommended ?? raw?.ask_deep_dive_recommended),
    confidence: safeErrorMessage(String(raw?.confidence ?? "medium").trim()).slice(0, 40),
  }
}

async function runWatchLlmReview({ projectPath, generatedAt, events, candidateHypotheses, hypothesisById, options }) {
  const mode = normalizeLlmReviewMode(options.llmReview ?? options["llm-review"])
  const maxItems = boundedInteger(options.llmReviewMaxItems ?? options["llm-review-max-items"], WATCH_LLM_REVIEW_DEFAULT_MAX_ITEMS, 1, 20)
  const items = watchReviewItems({ events, candidateHypotheses, hypothesisById })
  if (mode === "off") {
    return { status: "off", mode, reviewedCount: 0, maxItems, reviews: [] }
  }
  if (!items.length) {
    return { status: "skipped", mode, reason: "no_candidate_items", reviewedCount: 0, maxItems, reviews: [] }
  }
  if (mode === "auto" && items.length > maxItems) {
    return { status: "skipped", mode, reason: "too_many_candidate_items", candidateCount: items.length, reviewedCount: 0, maxItems, reviews: [] }
  }

  const provider = safeErrorMessage(String(options.provider ?? "codex").trim()) || "codex"
  const model = options.model ?? (provider === "openai" ? process.env.OPENAI_MODEL : process.env.CODEX_MODEL)
  const selectedItems = items.slice(0, maxItems)
  const prompt = [
    "你是买方 PM 的舆情信号复核 agent。你只复核已经被规则层筛出来的小批量候选，不处理全量微信聊天。",
    "",
    "目标：判断新增信息对 Hypothesis Library 的影响。不要给买卖建议，不要自动确认状态，不要要求普通舆情先补齐完整财报闭环。",
    "",
    "只返回严格 JSON object，字段：",
    "{",
    '  "reviews": [',
    '    { "itemId": "候选 itemId", "signalType": "新催化|二次确认|市场反馈|硬证据|反证|叙事扩散", "evidenceDelta": "catalyst_signal|supporting_signal|market_feedback|fundamental_delivery|counter_signal|narrative_expansion|mixed_signal|new_context", "suggestedStatus": "seed|watching|strengthening|actionable|priced_in|divergent|disconfirmed|archived", "reason": "给基金经理看的中文原因", "oneLineTradingImplication": "一句话交易含义", "askDeepDiveRecommended": true, "confidence": "low|medium|high" }',
    "  ]",
    "}",
    "",
    "判断准则：",
    "- 涨价函、核心客户路线、技术路线变化、供应链传闻、突发主题为新催化，通常保持 watching，建议 Ask 深挖或看量价跟随。",
    "- 不同来源重复确认、产业链反馈增强为二次确认，可建议 strengthening。",
    "- 价格/成交额先动是市场反馈，可能建议 priced_in，但不能等同基本面兑现。",
    "- 订单、中标、公告、财报、收入、交付、ASP、客户份额属于硬证据，可建议 strengthening。",
    "- 放缓、砍单、降价、不及预期、路线替代为反证，可建议 divergent。",
    "- 卖方泛泛看好或概念扩散为叙事扩散，通常不升级状态。",
    "",
    `生成时间：${generatedAt}`,
    "候选 items：",
    JSON.stringify(selectedItems, null, 2),
  ].join("\n")

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "hypothesis-watch-llm-review-"))
  try {
    const rawOutput = await requestAgenticText({
      stage: "hypothesis-watch-llm-review",
      role: "signal-review",
      prompt,
      instructions: "Return strict JSON only. Do not write files. Do not include markdown fences.",
      context: { projectPath },
      options: {
        provider,
        model,
        agentTimeoutMs: options.llmReviewTimeoutMs ?? options["llm-review-timeout-ms"] ?? 120000,
        codexBin: options.codexBin,
        codexProfile: options.codexProfile,
        codexProfileV2: options.codexProfileV2,
        apiKey: options.apiKey,
        endpoint: options.endpoint,
        requestAgentText: options.requestAgentText,
      },
      outputPath: path.join(tmpDir, "review.json"),
    })
    const parsed = parseJsonObjectFromText(rawOutput)
    const rawReviews = Array.isArray(parsed.reviews) ? parsed.reviews : []
    const itemById = new Map(selectedItems.map((item) => [item.itemId, item]))
    const reviews = rawReviews
      .map((review) => {
        const itemId = safeErrorMessage(String(review?.itemId ?? review?.item_id ?? "").trim())
        const item = itemById.get(itemId)
        return item ? normalizeWatchReview(review, item) : null
      })
      .filter(Boolean)
    return {
      status: "done",
      mode,
      provider,
      model: model ?? null,
      reviewedCount: reviews.length,
      candidateCount: items.length,
      maxItems,
      reviews,
    }
  } catch (err) {
    return {
      status: "failed",
      mode,
      provider,
      model: model ?? null,
      reviewedCount: 0,
      candidateCount: items.length,
      maxItems,
      reviews: [],
      error: safeErrorMessage(err instanceof Error ? err.message : String(err)),
    }
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
}

function applyWatchLlmReview({ events, candidateHypotheses, llmReview }) {
  if (llmReview?.status !== "done" || !llmReview.reviews?.length) {
    return { events, candidateHypotheses }
  }
  const reviewById = new Map(llmReview.reviews.map((review) => [review.itemId, review]))
  const reviewedEvents = events.map((event) => {
    const review = reviewById.get(event.id)
    if (!review) return event
    const evidenceDelta = normalizeEvidenceDelta(review.evidenceDelta, event.evidenceDelta)
    return {
      ...event,
      evidenceDelta,
      confidenceImpact: confidenceImpactForDelta(evidenceDelta),
      suggestedStatus: normalizeStatus(review.suggestedStatus, event.suggestedStatus),
      suggestedStatusReason: review.reason || event.suggestedStatusReason,
      reason: review.reason || event.reason || event.suggestedStatusReason,
      signalType: review.signalType,
      signalStrength: signalStrengthForEvidenceDelta(evidenceDelta),
      tradingImplication: review.oneLineTradingImplication || event.tradingImplication,
      askDeepDiveRecommended: review.askDeepDiveRecommended,
      llmReview: review,
      summary: review.oneLineTradingImplication || event.summary,
    }
  })
  const reviewedCandidates = candidateHypotheses.map((candidate) => {
    const review = reviewById.get(candidate.id)
    if (!review) return candidate
    return {
      ...candidate,
      signalType: review.signalType,
      suggestedStatus: review.suggestedStatus,
      reason: review.reason,
      tradingImplication: review.oneLineTradingImplication,
      askDeepDiveRecommended: review.askDeepDiveRecommended,
      llmReview: review,
    }
  })
  return { events: reviewedEvents, candidateHypotheses: reviewedCandidates }
}

function normalizeDiscoveryCandidate(raw, { theme, generatedAt, fallbackSourceRefs = [], wikiIndustryTerms = [], question = "" }) {
  const record = raw && typeof raw === "object" ? raw : {}
  const title = safeErrorMessage(String(record.title ?? "").trim()).slice(0, 180)
  if (!title) return null
  const candidateTheme = safeErrorMessage(String(record.theme ?? theme ?? "").trim()).slice(0, 120)
  const keyVariables = parseTextList(record.keyVariables ?? record["key-variables"]).slice(0, 12)
  const textForSegments = [title, candidateTheme, keyVariables.join(" "), parseTextList(record.segments).join(" ")].join(" ")
  const segments = uniqueCaseInsensitiveNonEmpty(parseCsvList(record.segments, inferSegmentsFromText(textForSegments, wikiIndustryTerms))).slice(0, 12)
  if (hypothesisGranularityIssue({ title, theme: candidateTheme, segments, keyVariables })) return null
  const sourceRefs = parseTextList(record.sourceRefs ?? record["source-refs"])
  const risks = parseTextList(record.risks).slice(0, 12)
  const trackingFields = trackingFieldsFromCandidate({
    record,
    title,
    theme: candidateTheme,
    segments,
    keyVariables,
    sourceRefs: sourceRefs.length ? sourceRefs : fallbackSourceRefs,
  })
  return {
    schema: HYPOTHESIS_LIBRARY_SCHEMA,
    id: stableHypothesisId({ title, theme: candidateTheme, segments }),
    title,
    theme: candidateTheme,
    segments,
    status: "seed",
    conviction: normalizeConviction(record.conviction, 0),
    timeHorizon: safeErrorMessage(String(record.timeHorizon ?? record["time-horizon"] ?? "").trim()).slice(0, 80) || "未来3-12个月",
    keyVariables,
    triggerConditions: trackingFields.triggerConditions,
    invalidationSignals: trackingFields.invalidationSignals,
    expectedEvidencePath: trackingFields.expectedEvidencePath,
    evidenceRefs: trackingFields.sourceRefs.slice(0, 8),
    marketRefs: parseTextList(record.marketRefs ?? record["market-refs"]).slice(0, 8),
    risks: risks.length ? risks : trackingFields.invalidationSignals,
    relatedWikiPages: trackingFields.relatedWikiPages,
    granularity: trackingFields.granularity,
    nextValidationDate: safeErrorMessage(String(record.nextValidationDate ?? record["next-validation-date"] ?? "").trim()) || null,
    createdAt: generatedAt,
    updatedAt: generatedAt,
    discoveryQuestion: safeErrorMessage(String(record.question ?? question ?? "").trim()).slice(0, 240),
    discoveryReason: safeErrorMessage(String(record.reason ?? record.rationale ?? "").trim()).slice(0, 500),
  }
}

function discoverySourceContext(sources, limit = 10) {
  return sources.slice(0, limit).map((source, index) => ({
    ref: source.sourceRef,
    type: source.sourceType,
    title: source.title,
    excerpt: compactExcerpt(source.sourceText ?? source.textExcerpt, 700),
    index: index + 1,
  }))
}

function discoveryLanePrompt({ theme, angle, sourceContext, questionCount, index }) {
  return [
    "你是 AI-native 主动管理假设库的研究 agent。请基于本地 Trading Review Wiki 上下文，设计一个研究问题，并提出可跟踪假设。",
    "",
    "只返回严格 JSON object，不要 Markdown 包裹。",
    "字段：",
    "{",
    '  "question": "你设计的研究问题",',
    '  "hypotheses": [',
    '    { "title": "可跟踪投资假设", "theme": "主题", "segments": ["细分"], "timeHorizon": "周期", "keyVariables": ["跟踪变量"], "triggerConditions": ["什么新增信息会增强假设"], "invalidationSignals": ["什么信息会证伪假设"], "expectedEvidencePath": ["后续验证路径"], "risks": ["失效条件"], "sourceRefs": ["证据来源"], "reason": "为什么值得跟踪" }',
    "  ]",
    "}",
    "",
    "要求：",
    "- 假设要能被后续新增消息、公告、财报、订单、量价反馈验证。",
    "- 假设必须是中观投资判断：不要太宽，例如“AI算力继续景气 / PCB有投资机会 / 国产替代会受益”。",
    "- 假设也不要太细，例如“某微信群某天提到某公司 / 某一天某只股票放量”；细碎信息应作为事件，而不是新假设。",
    "- 合格例子：健滔涨价函可能推动 CCL/覆铜板链条进入量价重估；CPO节奏放缓可能提升MPO高速连接器短期订单弹性。",
    "- 不要输出投资建议，不要说买入卖出。",
    "- 新催化可以进入跟踪，不必强行要求完整财报闭环。",
    `- 最多输出 ${questionCount} 条假设，优先可操作、可跟踪、细分明确。`,
    "",
    `主题：${theme || "未指定"}`,
    `并发角度 ${index + 1}：${angle}`,
    "",
    "本地知识库上下文：",
    JSON.stringify(sourceContext, null, 2),
  ].join("\n")
}

export async function discoverHypotheses(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const generatedAt = String(options.generatedAt ?? nowLocalTimestamp())
  const theme = safeErrorMessage(String(options.theme ?? "").trim()).slice(0, 120)
  const questionCount = boundedInteger(options.questionCount ?? options["question-count"], 5, 1, 12)
  const concurrency = boundedInteger(options.concurrency, 3, 1, 8)
  const sourceLimit = boundedInteger(options.sourceLimit ?? options["source-limit"], 80, 1, 300)
  const perLaneHypotheses = boundedInteger(options.perLaneHypotheses ?? options["per-lane-hypotheses"], 2, 1, 5)
  const provider = safeErrorMessage(String(options.provider ?? "codex").trim()) || "codex"
  const model = options.model
  const timeoutMs = Number(options.timeoutMs ?? options["timeout-ms"] ?? 300000) || 300000
  const sources = await discoverHypothesisSources({
    projectPath,
    since: options.since ?? "3650d",
    sources: options.sources ?? "wiki,raw,wechat_incremental,hypothesis_supplement,agentic",
    limit: sourceLimit,
  })
  const wikiIndustryTerms = await loadWikiIndustryTerms(projectPath, options)
  const sourceContext = discoverySourceContext(sources, 12)
  const angles = [
    "找最新催化：涨价函、新客户、供应链传闻、技术路线变化、产业词突然高频出现。",
    "找订单兑现路径：订单、中标、公告、交付、收入确认、ASP和毛利率。",
    "找市场反馈：相关股票、细分环节、量价扩散、priced-in风险和领涨排序。",
    "找细分错位：大主题下被龙头遮蔽的小环节、瓶颈环节和替代受益。",
    "找反证：节奏放缓、降价、砍单、路线替代、叙事过热但基本面未兑现。",
    "找组合表达：同一假设下的上游材料、设备、连接器、PCB、CPO链条映射。",
  ]
  const lanes = Array.from({ length: questionCount }, (_, index) => ({
    index,
    angle: angles[index % angles.length],
  }))
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "hypothesis-discover-"))
  try {
    const laneResults = await mapWithConcurrency(lanes, concurrency, async (lane) => {
      const prompt = discoveryLanePrompt({ theme, angle: lane.angle, sourceContext, questionCount: perLaneHypotheses, index: lane.index })
      try {
        const rawOutput = await requestAgenticText({
          stage: "hypothesis-discover",
          role: `discover-${lane.index + 1}`,
          prompt,
          instructions: "Return strict JSON only. Do not write files. Do not include markdown fences.",
          context: { projectPath },
          options: {
            provider,
            model,
            agentTimeoutMs: timeoutMs,
            codexBin: options.codexBin,
            codexProfile: options.codexProfile,
            codexProfileV2: options.codexProfileV2,
            apiKey: options.apiKey,
            endpoint: options.endpoint,
            requestAgentText: options.requestAgentText,
          },
          outputPath: path.join(tmpDir, `discover-${lane.index + 1}.json`),
        })
        const parsed = parseJsonObjectFromText(rawOutput)
        const question = safeErrorMessage(String(parsed.question ?? "").trim()).slice(0, 240) || lane.angle
        const rawHypotheses = Array.isArray(parsed.hypotheses) ? parsed.hypotheses : []
        const candidates = rawHypotheses
          .map((item) => normalizeDiscoveryCandidate(item, {
            theme,
            generatedAt,
            fallbackSourceRefs: sourceContext.map((source) => source.ref),
            wikiIndustryTerms,
            question,
          }))
          .filter(Boolean)
        return {
          status: "done",
          index: lane.index,
          angle: lane.angle,
          question,
          rawOutput,
          candidateCount: candidates.length,
          candidates,
        }
      } catch (err) {
        return {
          status: "failed",
          index: lane.index,
          angle: lane.angle,
          question: lane.angle,
          error: safeErrorMessage(err instanceof Error ? err.message : String(err)),
          candidateCount: 0,
          candidates: [],
        }
      }
    })
    const candidatesById = new Map()
    for (const lane of laneResults) {
      for (const candidate of lane.candidates ?? []) {
        if (!candidatesById.has(candidate.id)) {
          candidatesById.set(candidate.id, {
            ...candidate,
            discoveryLanes: [lane.index + 1],
          })
        } else {
          candidatesById.get(candidate.id).discoveryLanes.push(lane.index + 1)
        }
      }
    }
    const candidates = [...candidatesById.values()]
      .sort((a, b) => b.discoveryLanes.length - a.discoveryLanes.length || a.title.localeCompare(b.title))
      .slice(0, boundedInteger(options.candidateLimit ?? options["candidate-limit"], 20, 1, 80))
    const failedLanes = laneResults.filter((lane) => lane.status === "failed")
    if (failedLanes.length === laneResults.length) {
      throw new Error(`All hypothesis discovery lanes failed: ${failedLanes.map((lane) => lane.error).join("; ")}`)
    }
    return {
      schema: HYPOTHESIS_DISCOVERY_SCHEMA,
      mode: "hypothesis-discover",
      projectPath,
      dryRun: true,
      generatedAt,
      theme,
      provider,
      model: model ?? null,
      filters: {
        sources: [...parseSourceFilters(options.sources ?? "wiki,raw,wechat_incremental,hypothesis_supplement,agentic")],
        since: safeErrorMessage(String(options.since ?? "3650d").trim()),
        sourceLimit,
        questionCount,
        concurrency,
      },
      sourceContext,
      questions: laneResults.map((lane) => ({
        index: lane.index + 1,
        status: lane.status,
        angle: lane.angle,
        question: lane.question,
        candidateCount: lane.candidateCount,
        error: lane.error ?? null,
      })),
      candidates,
      summary: {
        questionsDesigned: laneResults.filter((lane) => lane.status === "done").length,
        failedQuestions: failedLanes.length,
        sourcesScanned: sources.length,
        candidatesReturned: candidates.length,
        wroteWiki: false,
        wroteRaw: false,
        wroteRealTrade: false,
      },
      writePolicy: {
        artifacts: "none; candidates require explicit hypothesis create/write",
        wroteWiki: false,
        wroteRaw: false,
        wroteRealTrade: false,
        autoCreatedHypothesis: false,
      },
    }
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
}

function inferSourceType(sourceRef) {
  if (sourceRef.startsWith(".llm-wiki/wechat-inbox/processed/")) return "wechat_incremental"
  if (sourceRef.startsWith(`${HYPOTHESIS_SUPPLEMENTS_ROOT}/`)) return "hypothesis_supplement"
  if (sourceRef.startsWith(".llm-wiki/agent-runs/")) return "agentic_run"
  if (/gangtise|meeting-clues|投研线索/i.test(sourceRef)) return "gangtise"
  if (/微信|wechat|radar/i.test(sourceRef)) return "wechat"
  if (/每日复盘|daily-review|morning-review|复盘/i.test(sourceRef)) return "daily_review"
  if (sourceRef.startsWith("raw/")) return "raw_article"
  if (sourceRef.startsWith("wiki/")) return "wiki_article"
  return "unknown"
}

function inferSourceTitle(text, filePath) {
  return safeErrorMessage(String(text ?? "").match(/^#\s+(.+)$/m)?.[1] ?? path.basename(filePath, path.extname(filePath))).slice(0, 120)
}

function compactExcerpt(text, maxChars = 800) {
  return safeErrorMessage(String(text ?? "").replace(/\s+/g, " ").trim().slice(0, maxChars))
}

function datePartFromValue(value, fallback = nowLocalTimestamp()) {
  const raw = safeErrorMessage(String(value ?? "").trim())
  const match = raw.match(/\d{4}-\d{2}-\d{2}/)
  return match?.[0] ?? String(fallback).slice(0, 10)
}

function normalizeWechatTimestamp(value, fallback) {
  const raw = safeErrorMessage(String(value ?? "").trim())
  if (!raw) return fallback
  return raw.slice(0, 32)
}

function parseWechatMessageTimestampMs(value) {
  return parseLooseTimestampMs(value)
}

function wechatMessageTimeMs(message = {}) {
  const candidates = [message.sentAt, message.receivedAt, message.normalizedAt]
  for (const candidate of candidates) {
    const ms = parseWechatMessageTimestampMs(candidate)
    if (ms != null) return ms
  }
  return null
}

function normalizeWechatText(value) {
  return safeErrorMessage(String(value ?? "").replace(/\s+/g, " ").trim()).slice(0, WECHAT_INCREMENT_TEXT_MAX_CHARS)
}

function normalizeWechatIncrementMessage(input = {}, generatedAt = nowLocalTimestamp()) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Wechat increment message must be an object.")
  }
  const text = normalizeWechatText(input.text)
  if (!text) throw new Error("Wechat increment message text is required.")
  const messageId = safeErrorMessage(String(input.messageId ?? "").trim()).slice(0, 160)
  const chatId = safeErrorMessage(String(input.chatId ?? "").trim()).slice(0, 160)
  const sentAt = normalizeWechatTimestamp(input.sentAt, generatedAt)
  const receivedAt = normalizeWechatTimestamp(input.receivedAt, generatedAt)
  const fallbackKeySeed = `${chatId}:${sentAt}:${sha256Hex(text)}`
  const messageKey = messageId ? `msg:${messageId}` : `hash:${shortHash(fallbackKeySeed)}`
  const senderAlias = safeErrorMessage(String(input.senderAlias ?? "").trim()).slice(0, 160)
  const sourceMeta = signalSourceKindMetadata(input)
  return {
    schema: WECHAT_INCREMENT_PROCESSED_SCHEMA,
    messageKey,
    messageId: messageId || null,
    chatId: chatId || null,
    chatName: safeErrorMessage(String(input.chatName ?? "").trim()).slice(0, 160) || null,
    senderAliasHash: senderAlias ? `sender_${shortHash(senderAlias).slice(0, 12)}` : null,
    sentAt,
    receivedAt,
    text,
    textHash: sha256Hex(text),
    sourceTool: safeErrorMessage(String(input.sourceTool ?? "wechat-extractor").trim()).slice(0, 120) || "wechat-extractor",
    sourceKind: sourceMeta.sourceKind,
    sourceKindLabel: sourceMeta.sourceKindLabel,
    normalizedAt: generatedAt,
  }
}

function defaultWechatInboxState() {
  return {
    schema: "wechat-increment-inbox-state-v1",
    lastProcessedAt: null,
    messageCount: 0,
    duplicateCount: 0,
    errorCount: 0,
    incomingOffsets: {},
  }
}

async function readWechatInboxState(projectPath) {
  const raw = await readIfExists(wechatInboxStatePath(projectPath))
  if (!raw.trim()) return defaultWechatInboxState()
  try {
    const parsed = JSON.parse(raw)
    return {
      ...defaultWechatInboxState(),
      ...parsed,
      incomingOffsets: parsed?.incomingOffsets && typeof parsed.incomingOffsets === "object" ? parsed.incomingOffsets : {},
    }
  } catch {
    return defaultWechatInboxState()
  }
}

async function readProcessedWechatMessageKeys(projectPath) {
  const files = await listFilesRecursive(path.join(projectPath, WECHAT_INBOX_PROCESSED_ROOT), { extensions: new Set([".jsonl"]) }).catch(() => [])
  const keys = new Set()
  for (const filePath of files) {
    const raw = await readIfExists(filePath)
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue
      try {
        const parsed = JSON.parse(line)
        if (parsed?.messageKey) keys.add(parsed.messageKey)
      } catch {
        // Ignore damaged historical records; process errors are counted at the incoming boundary.
      }
    }
  }
  return keys
}

async function readIncomingWechatMessageKeys(projectPath) {
  const files = await listFilesRecursive(path.join(projectPath, WECHAT_INBOX_INCOMING_ROOT), { extensions: new Set([".jsonl"]) }).catch(() => [])
  const keys = new Set()
  for (const filePath of files) {
    const raw = await readIfExists(filePath)
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue
      try {
        const parsed = JSON.parse(line)
        const candidates = Array.isArray(parsed) ? parsed : [parsed]
        for (const candidate of candidates) {
          const normalized = normalizeWechatIncrementMessage(candidate)
          keys.add(normalized.messageKey)
        }
      } catch {
        // Malformed incoming lines are counted by processWechatIncrementInbox.
      }
    }
  }
  return keys
}

async function readAllWechatInboxMessageKeys(projectPath) {
  const [processed, incoming] = await Promise.all([
    readProcessedWechatMessageKeys(projectPath),
    readIncomingWechatMessageKeys(projectPath),
  ])
  return new Set([...processed, ...incoming])
}

function parseWechatIncrementPayload(text) {
  const trimmed = String(text ?? "").trim()
  if (!trimmed) return []
  try {
    const parsed = JSON.parse(trimmed)
    return Array.isArray(parsed) ? parsed : [parsed]
  } catch {
    return trimmed
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line))
  }
}

function inferWechatRawChatDate(filePath, stat, generatedAt) {
  const baseName = path.basename(filePath)
  const match = baseName.match(/(20\d{2})[-_.年](\d{1,2})[-_.月](\d{1,2})/)
  if (match) {
    const [, year, month, day] = match
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`
  }
  return datePartFromValue(stat?.mtime?.toISOString(), generatedAt)
}

function inferWechatRawChatTitle(text, filePath, fallbackDate) {
  const title = String(text ?? "").match(/^#\s+(.+)$/m)?.[1]
  if (title) return safeErrorMessage(title).slice(0, 120)
  const base = path.basename(filePath, path.extname(filePath)).trim()
  return safeErrorMessage(base || `微信聊天 ${fallbackDate}`).slice(0, 120)
}

function stripMarkdownFrontmatter(text) {
  const normalized = String(text ?? "").replace(/\r\n/g, "\n")
  if (!normalized.startsWith("---\n")) return normalized
  const end = normalized.indexOf("\n---", 4)
  return end > 0 ? normalized.slice(end + 4) : normalized
}

function normalizeWechatRawChatLine(line) {
  const trimmed = safeErrorMessage(String(line ?? "")
    .replace(/^\s*[-*+]\s+/, "")
    .replace(/^\s*>\s?/, "")
    .trim())
  if (!trimmed) return ""
  if (/^#{1,6}\s/.test(trimmed)) return ""
  if (/^```/.test(trimmed)) return ""
  if (/^【[^】]{1,30}】$/.test(trimmed)) return ""
  if (/^(core-sync|同步窗口|摘要窗口|本地库|radar\.db 最新)[：:]/i.test(trimmed)) return ""
  if (/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(trimmed)) return ""
  return trimmed
}

function splitWechatRawChatText(text) {
  return stripMarkdownFrontmatter(text)
    .split(/\r?\n/)
    .map(normalizeWechatRawChatLine)
    .filter((line) => line.length >= 2)
}

const GANGTISE_METADATA_LINE_RE = /^(theme_id|theme_date|type|type_code|name|id|uuid|created_at|updated_at|source|url|hot|score|seq|rank|page|pages)\s*[：:]/i
const GANGTISE_SIGNAL_LINE_RE = /^(今日叙事主线|核心观点|核心逻辑|核心标的|催化|风险提示|投资建议|产业链|新增变量|事件|结论|关注|验证|跟踪|复盘|变化)\s*[：:]/i

function decodeJsonStringFragment(value) {
  const raw = String(value ?? "")
  if (!raw) return ""
  try {
    return JSON.parse(`"${raw}"`)
  } catch {
    return raw
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, "\"")
  }
}

function gangtiseBodyFragments(text) {
  const fragments = []
  const raw = String(text ?? "")
  const bodyRe = /"body"\s*:\s*"((?:\\.|[^"\\])*)"/g
  let match
  while ((match = bodyRe.exec(raw))) {
    const decoded = decodeJsonStringFragment(match[1])
    if (decoded.trim()) fragments.push(decoded)
  }
  return fragments
}

function normalizeGangtiseThemeLine(line) {
  const trimmed = safeErrorMessage(String(line ?? "").trim())
    .replace(/^[\-*+]\s+/, "")
    .replace(/^\d+[.)、]\s*/, "")
    .trim()
  if (!trimmed) return ""
  if (/^#{1,6}\s/.test(trimmed)) return ""
  if (/^```/.test(trimmed)) return ""
  if (GANGTISE_METADATA_LINE_RE.test(trimmed)) return ""
  if (/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(trimmed)) return ""
  if (/^[{}[\],"]+$/.test(trimmed)) return ""
  return trimmed
}

function isGangtiseThemeSignalLine(line) {
  if (GANGTISE_SIGNAL_LINE_RE.test(line)) return true
  if (textHasAny(line, CATALYST_PATTERNS)) return true
  if (textHasAny(line, HARD_FUNDAMENTAL_PATTERNS)) return true
  if (/(涨价函|玻璃基板|TGV|CPO|MPO|PCB|CCL|HBM|服务器|数据中心|先进封装|光模块|高速连接器|光纤跳线)/i.test(line)) {
    return line.length >= 10
  }
  return false
}

function splitGangtiseThemeText(text) {
  const bodyFragments = gangtiseBodyFragments(text)
  const sourceText = bodyFragments.length ? bodyFragments.join("\n") : stripMarkdownFrontmatter(text)
  const seen = new Set()
  const rows = []
  for (const rawLine of sourceText.split(/\r?\n/)) {
    const line = normalizeGangtiseThemeLine(rawLine)
    if (!line || !isGangtiseThemeSignalLine(line)) continue
    const key = line.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    rows.push(line)
  }
  return rows
}

function classifyRawSignalSource(sourceRefOrPath = "") {
  const ref = String(sourceRefOrPath ?? "").replaceAll("\\", "/")
  if (/raw\/openclaw数据\/产业链复盘\/gangtise_themes/i.test(ref) || /gangtise_themes/i.test(ref)) {
    return {
      sourceKind: "gangtise_themes",
      sourceKindLabel: "Gangtise产业链复盘",
      chatId: "raw-gangtise-themes",
      sourceTool: "raw-gangtise-themes-file",
    }
  }
  if (/raw\/研报新闻/i.test(ref)) {
    return {
      sourceKind: "research_news",
      sourceKindLabel: "研报新闻",
      chatId: "raw-research-news",
      sourceTool: "raw-research-news-file",
    }
  }
  if (/raw\/微信聊天|wechat/i.test(ref)) {
    return {
      sourceKind: "wechat_chat",
      sourceKindLabel: "微信聊天",
      chatId: "raw-wechat-chat",
      sourceTool: "wechat-raw-chat-file",
    }
  }
  return {
    sourceKind: "raw_document",
    sourceKindLabel: "新增资料",
    chatId: "raw-signal-source",
    sourceTool: "raw-signal-source-file",
  }
}

function signalSourceKindMetadata(input = {}) {
  const explicitKind = safeErrorMessage(String(input?.sourceKind ?? "").trim()).slice(0, 80)
  const explicitLabel = safeErrorMessage(String(input?.sourceKindLabel ?? "").trim()).slice(0, 120)
  if (explicitKind) {
    return {
      sourceKind: explicitKind,
      sourceKindLabel: explicitLabel || explicitKind,
    }
  }
  const tool = safeErrorMessage(String(input?.sourceTool ?? "").trim())
  if (tool === "raw-research-news-file") return classifyRawSignalSource("raw/研报新闻")
  if (tool === "raw-gangtise-themes-file") return classifyRawSignalSource("raw/openclaw数据/产业链复盘/gangtise_themes")
  if (tool === "raw-signal-source-file") return classifyRawSignalSource("raw/新增资料")
  if (tool === "wechat-raw-chat-file" || tool === "wechat-extractor") return classifyRawSignalSource("raw/微信聊天")
  const sourceRef = safeErrorMessage(String(input?.sourceRef ?? input?.sourcePath ?? "").trim())
  return classifyRawSignalSource(sourceRef)
}

function signalSourceLabelForIncrement(message = {}) {
  const meta = signalSourceKindMetadata(message)
  if (meta.sourceKind === "wechat_chat") return "微信增量"
  return `${meta.sourceKindLabel}增量`
}

function sourceKindMetadataForWatchSource(source = {}) {
  if (source.sourceType === "wechat_incremental") {
    const meta = signalSourceKindMetadata(source)
    return {
      sourceKind: meta.sourceKind,
      sourceKindLabel: meta.sourceKindLabel,
      sourceTool: source.sourceTool ?? null,
    }
  }
  if (["raw_article", "wechat", "gangtise", "daily_review"].includes(source.sourceType)) {
    const meta = classifyRawSignalSource(source.sourceRef ?? source.sourcePath ?? "")
    return {
      sourceKind: meta.sourceKind,
      sourceKindLabel: meta.sourceKindLabel,
      sourceTool: meta.sourceTool,
    }
  }
  return {
    sourceKind: null,
    sourceKindLabel: null,
    sourceTool: null,
  }
}

function inferWechatRawChatSentAt(date, text, index) {
  const time = String(text ?? "").match(/(?:^|\s)([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?/)
  if (time) {
    const [, hour, minute, second = "00"] = time
    return `${date} ${hour.padStart(2, "0")}:${minute}:${second}`
  }
  const offset = index % 3600
  const minute = String(Math.floor(offset / 60)).padStart(2, "0")
  const second = String(offset % 60).padStart(2, "0")
  return `${date} 09:${minute}:${second}`
}

function normalizeWechatRawChatMessagesFromText({ text, filePath, sourceRef, stat, generatedAt, startIndex = 0 }) {
  const date = inferWechatRawChatDate(filePath, stat, generatedAt)
  const chatName = inferWechatRawChatTitle(text, filePath, date)
  const sourceHash = shortHash(sourceRef)
  const sourceKind = classifyRawSignalSource(sourceRef || filePath)
  const lines = sourceKind.sourceKind === "gangtise_themes"
    ? splitGangtiseThemeText(text)
    : splitWechatRawChatText(text)
  return lines.map((line, index) => {
    const absoluteIndex = startIndex + index
    return {
      schema: WECHAT_INCREMENT_SCHEMA,
      messageId: `raw:${sourceHash}:${shortHash(line)}`,
      chatId: sourceKind.chatId,
      chatName: sourceKind.sourceKind === "wechat_chat" ? chatName : `${sourceKind.sourceKindLabel} · ${chatName}`,
      senderAlias: "raw-file",
      sentAt: inferWechatRawChatSentAt(date, line, absoluteIndex),
      receivedAt: generatedAt,
      text: line,
      sourceTool: sourceKind.sourceTool,
      sourceKind: sourceKind.sourceKind,
      sourceKindLabel: sourceKind.sourceKindLabel,
    }
  })
}

async function listWechatRawChatFiles(sourcePath, stat, options = {}) {
  if (!stat) return []
  if (stat.isFile()) return [sourcePath]
  if (!stat.isDirectory()) return []
  return listFilesRecursive(sourcePath, {
    extensions: WECHAT_RAW_CHAT_EXTENSIONS,
    maxFiles: options.maxFiles,
    preferRecent: true,
  })
}

export async function listWechatRawChatSources(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const generatedAt = String(options.generatedAt ?? nowLocalTimestamp())
  const limit = Math.max(1, Math.min(100, Number(options.limit ?? 20) || 20))
  const maxFiles = Math.max(1, Math.min(200, Number(options.maxFiles ?? WECHAT_RAW_CHAT_MAX_FILES) || WECHAT_RAW_CHAT_MAX_FILES))
  const sourceInput = options.sourcePath ?? options.source ?? WECHAT_RAW_CHAT_DEFAULT_SOURCE
  const sourcePath = resolveProjectInputPath(projectPath, sourceInput)
  const sourceStat = sourcePath ? await fs.stat(sourcePath).catch(() => null) : null
  const files = await listWechatRawChatFiles(sourcePath, sourceStat, { maxFiles })
  const today = datePartFromValue(generatedAt, generatedAt)
  const sources = []

  for (const filePath of files) {
    const stat = await fs.stat(filePath).catch(() => null)
    if (!stat || !stat.isFile()) continue
    const raw = await readIfExists(filePath)
    const sourceRef = projectRefOrAbsolute(projectPath, filePath)
    const sourceDate = inferWechatRawChatDate(filePath, stat, generatedAt)
    const sourceKind = classifyRawSignalSource(sourceRef)
    sources.push({
      sourceRef,
      sourcePath: filePath,
      ...sourceKind,
      title: inferWechatRawChatTitle(raw, filePath, sourceDate),
      sourceDate,
      isToday: sourceDate === today,
      isSelectedCandidate: false,
      mtime: stat.mtime.toISOString(),
      sizeBytes: stat.size,
      sourceHash: sha256Hex(raw),
      messagePreviewCount: Math.min(5, (sourceKind.sourceKind === "gangtise_themes" ? splitGangtiseThemeText(raw) : splitWechatRawChatText(raw)).length),
      textExcerpt: compactExcerpt(raw, 220),
    })
  }

  sources.sort((a, b) => Number(b.isToday) - Number(a.isToday) || b.mtime.localeCompare(a.mtime) || a.sourceRef.localeCompare(b.sourceRef))
  const returned = sources.slice(0, limit)
  if (returned[0]) returned[0].isSelectedCandidate = true

  return {
    schema: "wechat-raw-chat-source-list-v1",
    mode: "wechat-raw-chat-source-list",
    projectPath,
    generatedAt,
    sourcePath: sourcePath ? projectRefOrAbsolute(projectPath, sourcePath) : WECHAT_RAW_CHAT_DEFAULT_SOURCE,
    sourceMissing: !sourceStat,
    defaultSourceRef: returned[0]?.sourceRef ?? null,
    sources: returned,
    summary: {
      sourcesScanned: sources.length,
      sourcesReturned: returned.length,
      todayFound: returned.some((source) => source.isToday),
      wroteWiki: false,
      wroteRaw: false,
      wroteRealTrade: false,
    },
    writePolicy: {
      readOnly: true,
      wroteWiki: false,
      wroteRaw: false,
      wroteRealTrade: false,
    },
  }
}

export async function importWechatRawChatMessages(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const generatedAt = String(options.generatedAt ?? nowLocalTimestamp())
  const dryRun = !Boolean(options.write)
  const limit = Math.max(1, Math.min(5000, Number(options.limit ?? WECHAT_RAW_CHAT_DEFAULT_LIMIT) || WECHAT_RAW_CHAT_DEFAULT_LIMIT))
  const maxFiles = Math.max(1, Math.min(200, Number(options.maxFiles ?? WECHAT_RAW_CHAT_MAX_FILES) || WECHAT_RAW_CHAT_MAX_FILES))
  const sourceInput = options.sourcePath ?? options.source ?? WECHAT_RAW_CHAT_DEFAULT_SOURCE
  const sourcePath = resolveProjectInputPath(projectPath, sourceInput)
  const sourceStat = sourcePath ? await fs.stat(sourcePath).catch(() => null) : null
  const cutoff = options.since ? parseSinceCutoff(options.since, generatedAt) : null
  const files = await listWechatRawChatFiles(sourcePath, sourceStat, { maxFiles })
  const messages = []
  const sourceFiles = []
  let filesScanned = 0

  for (const filePath of files) {
    if (messages.length >= limit) break
    const stat = await fs.stat(filePath).catch(() => null)
    if (!stat || (cutoff && stat.mtime < cutoff)) continue
    filesScanned += 1
    const ext = path.extname(filePath).toLowerCase()
    const raw = await readIfExists(filePath)
    if (!raw.trim()) continue
    const sourceRef = projectRefOrAbsolute(projectPath, filePath)
    const sourceKind = classifyRawSignalSource(sourceRef)
    let extracted = []
    if (ext === ".json" || ext === ".jsonl") {
      extracted = parseWechatIncrementPayload(raw).map((message, index) => ({
        ...message,
        chatId: message.chatId ?? sourceKind.chatId,
        chatName: message.chatName ?? sourceKind.sourceKindLabel,
        sourceTool: message.sourceTool ?? sourceKind.sourceTool,
        sourceKind: message.sourceKind ?? sourceKind.sourceKind,
        sourceKindLabel: message.sourceKindLabel ?? sourceKind.sourceKindLabel,
        messageId: message.messageId ?? `raw:${shortHash(sourceRef)}:${shortHash(message.text ?? raw)}`,
      }))
    } else {
      extracted = normalizeWechatRawChatMessagesFromText({
        text: raw,
        filePath,
        sourceRef,
        stat,
        generatedAt,
        startIndex: messages.length,
      })
    }
    if (!extracted.length) continue
    const remaining = limit - messages.length
    messages.push(...extracted.slice(0, remaining))
    sourceFiles.push({
      sourceRef,
      sourceHash: sha256Hex(raw),
      mtime: stat.mtime.toISOString(),
      messagesExtracted: Math.min(extracted.length, remaining),
      sourceKind: sourceKind.sourceKind,
      sourceKindLabel: sourceKind.sourceKindLabel,
    })
  }

  let appendMessages = messages
  let duplicateMessageCount = 0
  if (!dryRun && messages.length) {
    const existingKeys = await readAllWechatInboxMessageKeys(projectPath)
    const seenThisImport = new Set()
    appendMessages = []
    for (const message of messages) {
      const key = normalizeWechatIncrementMessage(message, generatedAt).messageKey
      if (existingKeys.has(key) || seenThisImport.has(key)) {
        duplicateMessageCount += 1
        continue
      }
      seenThisImport.add(key)
      appendMessages.push(message)
    }
  }

  const appendRun = !dryRun && appendMessages.length
    ? await appendWechatIncrementMessages({ projectPath, messages: appendMessages, generatedAt })
    : null

  return {
    schema: "wechat-raw-chat-import-run-v1",
    mode: "wechat-raw-chat-import",
    projectPath,
    dryRun,
    generatedAt,
    sourcePath: sourcePath ? projectRefOrAbsolute(projectPath, sourcePath) : WECHAT_RAW_CHAT_DEFAULT_SOURCE,
    sourceMissing: !sourceStat,
    sourceFiles,
    previewMessages: messages.slice(0, 5).map((message) => ({
      messageId: message.messageId,
      chatName: message.chatName,
      sentAt: message.sentAt,
      sourceTool: message.sourceTool,
      sourceKind: message.sourceKind,
      sourceKindLabel: message.sourceKindLabel,
      text: compactExcerpt(message.text, 220),
    })),
    writeResult: appendRun
      ? {
          incomingRelativePaths: appendRun.writeResult.incomingRelativePaths,
          records: appendRun.writeResult.records,
        }
      : null,
    summary: {
      filesScanned,
      messagesExtracted: messages.length,
      duplicateMessagesSkipped: duplicateMessageCount,
      recordsWritten: appendRun?.summary.recordsWritten ?? 0,
      wroteWiki: false,
      wroteRaw: false,
      wroteRealTrade: false,
    },
    writePolicy: {
      artifacts: dryRun ? "dry-run only" : ".llm-wiki/wechat-inbox/incoming only",
      wroteWiki: false,
      wroteRaw: false,
      wroteRealTrade: false,
    },
  }
}

export async function appendWechatIncrementMessages(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const generatedAt = String(options.generatedAt ?? nowLocalTimestamp())
  let messages = options.messages
  if (!messages && options.messageJson) messages = parseWechatIncrementPayload(options.messageJson)
  if (!messages && options.sourcePath) {
    const sourcePath = resolveProjectInputPath(projectPath, options.sourcePath)
    messages = parseWechatIncrementPayload(await readIfExists(sourcePath))
  }
  const list = Array.isArray(messages) ? messages : messages ? [messages] : []
  if (!list.length) throw new Error("No wechat increment messages provided.")

  const byDate = new Map()
  for (const input of list) {
    const processed = normalizeWechatIncrementMessage(input, generatedAt)
    const date = datePartFromValue(processed.receivedAt || processed.sentAt, generatedAt)
    const rawRecord = {
      schema: WECHAT_INCREMENT_SCHEMA,
      messageId: input.messageId ?? null,
      chatId: input.chatId ?? null,
      chatName: input.chatName ?? null,
      senderAlias: input.senderAlias ?? null,
      sentAt: input.sentAt ?? generatedAt,
      receivedAt: input.receivedAt ?? generatedAt,
      text: processed.text,
      sourceTool: processed.sourceTool,
      sourceKind: processed.sourceKind,
      sourceKindLabel: processed.sourceKindLabel,
      ingestedAt: generatedAt,
    }
    if (!byDate.has(date)) byDate.set(date, [])
    byDate.get(date).push(rawRecord)
  }

  const incomingRelativePaths = []
  for (const [date, records] of byDate.entries()) {
    const filePath = wechatInboxIncomingPath(projectPath, date)
    await ensureDirectory(path.dirname(filePath))
    await fs.appendFile(filePath, records.map((record) => JSON.stringify(record)).join("\n") + "\n", "utf8")
    incomingRelativePaths.push(projectRelative(projectPath, filePath))
  }

  return {
    schema: "wechat-increment-append-run-v1",
    mode: "wechat-inbox-append",
    projectPath,
    dryRun: false,
    generatedAt,
    writeResult: {
      incomingRelativePaths: [...new Set(incomingRelativePaths)],
      records: list.length,
    },
    summary: {
      recordsWritten: list.length,
      wroteWiki: false,
      wroteRaw: false,
      wroteRealTrade: false,
    },
    writePolicy: {
      artifacts: ".llm-wiki/wechat-inbox/incoming only",
      wroteWiki: false,
      wroteRaw: false,
      wroteRealTrade: false,
    },
  }
}

export async function processWechatIncrementInbox(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const generatedAt = String(options.generatedAt ?? nowLocalTimestamp())
  const dryRun = Boolean(options.dryRun)
  const incomingRoot = path.join(projectPath, WECHAT_INBOX_INCOMING_ROOT)
  const incomingFiles = (await listFilesRecursive(incomingRoot, { extensions: new Set([".jsonl"]) }).catch(() => []))
    .sort((a, b) => a.localeCompare(b))
  const state = await readWechatInboxState(projectPath)
  const processedKeys = await readProcessedWechatMessageKeys(projectPath)
  const seenThisRun = new Set()
  const recordsByDate = new Map()
  const errors = []
  let incomingLinesRead = 0
  let duplicateCount = 0

  const nextOffsets = { ...state.incomingOffsets }
  for (const filePath of incomingFiles) {
    const relativePath = projectRelative(projectPath, filePath)
    const raw = await readIfExists(filePath)
    const lines = raw.split(/\r?\n/)
    const effectiveLineCount = lines.at(-1) === "" ? lines.length - 1 : lines.length
    const startOffset = Math.max(0, Number(state.incomingOffsets?.[relativePath] ?? 0) || 0)
    for (let i = startOffset; i < effectiveLineCount; i++) {
      const line = lines[i].trim()
      if (!line) continue
      incomingLinesRead += 1
      let parsed
      try {
        parsed = JSON.parse(line)
      } catch (err) {
        errors.push({ sourceRef: relativePath, line: i + 1, error: safeErrorMessage(err instanceof Error ? err.message : String(err)) })
        continue
      }
      const candidates = Array.isArray(parsed) ? parsed : [parsed]
      for (const candidate of candidates) {
        let processed
        try {
          processed = normalizeWechatIncrementMessage(candidate, generatedAt)
        } catch (err) {
          errors.push({ sourceRef: relativePath, line: i + 1, error: safeErrorMessage(err instanceof Error ? err.message : String(err)) })
          continue
        }
        if (processedKeys.has(processed.messageKey) || seenThisRun.has(processed.messageKey)) {
          duplicateCount += 1
          continue
        }
        seenThisRun.add(processed.messageKey)
        const date = datePartFromValue(processed.receivedAt || processed.sentAt, generatedAt)
        if (!recordsByDate.has(date)) recordsByDate.set(date, [])
        recordsByDate.get(date).push(processed)
      }
    }
    nextOffsets[relativePath] = effectiveLineCount
  }

  const processedRelativePaths = []
  const records = [...recordsByDate.values()].flat()
  if (!dryRun) {
    for (const [date, messages] of recordsByDate.entries()) {
      const filePath = wechatInboxProcessedPath(projectPath, date)
      await ensureDirectory(path.dirname(filePath))
      await fs.appendFile(filePath, messages.map((record) => JSON.stringify(record)).join("\n") + "\n", "utf8")
      processedRelativePaths.push(projectRelative(projectPath, filePath))
    }
    const nextState = {
      ...defaultWechatInboxState(),
      ...state,
      lastProcessedAt: generatedAt,
      messageCount: Number(state.messageCount ?? 0) + records.length,
      duplicateCount: Number(state.duplicateCount ?? 0) + duplicateCount,
      errorCount: Number(state.errorCount ?? 0) + errors.length,
      incomingOffsets: nextOffsets,
    }
    await writeJson(wechatInboxStatePath(projectPath), nextState)
  }

  return {
    schema: WECHAT_INCREMENT_PROCESS_RUN_SCHEMA,
    mode: "wechat-inbox-process",
    projectPath,
    dryRun,
    generatedAt,
    incomingFiles: incomingFiles.map((filePath) => projectRelative(projectPath, filePath)),
    errors,
    writeResult: dryRun
      ? null
      : {
          processedRelativePaths: [...new Set(processedRelativePaths)],
          stateRelativePath: WECHAT_INBOX_STATE_PATH,
          records: records.length,
        },
    summary: {
      incomingLinesRead,
      messagesWritten: dryRun ? 0 : records.length,
      duplicateCount,
      errorCount: errors.length,
      wroteWiki: false,
      wroteRaw: false,
      wroteRealTrade: false,
    },
    writePolicy: {
      artifacts: ".llm-wiki/wechat-inbox/processed and .llm-wiki/wechat-inbox/state.json",
      wroteWiki: false,
      wroteRaw: false,
      wroteRealTrade: false,
    },
  }
}

export async function getWechatIncrementInboxStatus(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const state = await readWechatInboxState(projectPath)
  const incomingFiles = await listFilesRecursive(path.join(projectPath, WECHAT_INBOX_INCOMING_ROOT), { extensions: new Set([".jsonl"]) }).catch(() => [])
  const processedFiles = await listFilesRecursive(path.join(projectPath, WECHAT_INBOX_PROCESSED_ROOT), { extensions: new Set([".jsonl"]) }).catch(() => [])
  return {
    schema: "wechat-increment-inbox-status-v1",
    mode: "wechat-inbox-status",
    projectPath,
    state,
    counts: {
      incomingFiles: incomingFiles.length,
      processedFiles: processedFiles.length,
    },
    writePolicy: {
      readOnly: true,
      wroteWiki: false,
      wroteRaw: false,
      wroteRealTrade: false,
    },
  }
}

function verifyWechatIncrementToken(headers, expectedToken) {
  if (!expectedToken) return false
  const direct = headers["x-wechat-inbox-token"]
  const auth = headers.authorization
  return direct === expectedToken || auth === `Bearer ${expectedToken}`
}

function readRequestBodyWithLimit(request, maxBytes) {
  return new Promise((resolve, reject) => {
    let body = ""
    let size = 0
    let tooLarge = false
    request.setEncoding("utf8")
    request.on("data", (chunk) => {
      size += Buffer.byteLength(chunk)
      if (size > maxBytes) {
        tooLarge = true
        return
      }
      body += chunk
    })
    request.on("end", () => {
      if (tooLarge) {
        reject(Object.assign(new Error("Payload too large."), { code: "PAYLOAD_TOO_LARGE" }))
        return
      }
      resolve(body)
    })
    request.on("error", reject)
  })
}

function writeHttpJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "http://127.0.0.1",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, x-wechat-inbox-token, authorization",
  })
  response.end(JSON.stringify(body))
}

export async function startWechatIncrementServer(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const host = safeErrorMessage(String(options.host ?? "127.0.0.1").trim()) || "127.0.0.1"
  if (host !== "127.0.0.1" && host !== "localhost") throw new Error("Wechat increment server must bind to 127.0.0.1 or localhost.")
  const port = Number(options.port ?? DEFAULT_WECHAT_INCREMENT_HTTP_PORT)
  const token = String(options.token ?? process.env.WECHAT_INCREMENT_TOKEN ?? "").trim() || shortHash(`${projectPath}:${Date.now()}`)
  const maxBodyBytes = Math.max(1024, Number(options.maxBodyBytes ?? DEFAULT_WECHAT_INCREMENT_MAX_BODY_BYTES) || DEFAULT_WECHAT_INCREMENT_MAX_BODY_BYTES)

  const server = http.createServer(async (request, response) => {
    if (request.method === "OPTIONS") {
      writeHttpJson(response, 204, {})
      return
    }
    if (request.method === "GET" && request.url === "/status") {
      writeHttpJson(response, 200, { ok: true, schema: "wechat-increment-http-v1" })
      return
    }
    if (request.method !== "POST" || request.url !== "/wechat-inbox/increment") {
      writeHttpJson(response, 404, { ok: false, error: "not_found" })
      return
    }
    if (!verifyWechatIncrementToken(request.headers, token)) {
      writeHttpJson(response, 401, { ok: false, error: "unauthorized" })
      return
    }
    let body
    try {
      body = await readRequestBodyWithLimit(request, maxBodyBytes)
    } catch (err) {
      const code = err?.code === "PAYLOAD_TOO_LARGE" ? 413 : 400
      writeHttpJson(response, code, { ok: false, error: code === 413 ? "payload_too_large" : "invalid_body" })
      return
    }
    try {
      const messages = parseWechatIncrementPayload(body)
      const result = await appendWechatIncrementMessages({ projectPath, messages })
      writeHttpJson(response, 202, {
        ok: true,
        schema: "wechat-increment-http-accepted-v1",
        recordsWritten: result.summary.recordsWritten,
        incomingRelativePaths: result.writeResult.incomingRelativePaths,
      })
    } catch (err) {
      writeHttpJson(response, 422, { ok: false, error: "validation_error", message: safeErrorMessage(err instanceof Error ? err.message : String(err)) })
    }
  })

  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(port, host, resolve)
  })
  const address = server.address()
  const actualPort = typeof address === "object" && address ? address.port : port
  return {
    schema: "wechat-increment-http-server-v1",
    host,
    port: actualPort,
    url: `http://${host}:${actualPort}`,
    token,
    close: () => new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve())),
  }
}

function publicSourceRecord(source) {
  return {
    sourceRef: source.sourceRef,
    sourceType: source.sourceType,
    sourceKind: source.sourceKind ?? null,
    sourceKindLabel: source.sourceKindLabel ?? null,
    sourceTool: source.sourceTool ?? null,
    sourceHash: source.sourceHash,
    mtime: source.mtime,
    title: source.title,
    textExcerpt: source.textExcerpt,
  }
}

async function discoverHypothesisSources(options = {}) {
  const startedAt = Date.now()
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const filters = parseSourceFilters(options.sources)
  const cutoff = parseSinceCutoff(options.since, options.generatedAt)
  const limit = Math.max(1, Number(options.limit ?? 100) || 100)
  const sourceInput = safeErrorMessage(String(options.sourcePath ?? options.source ?? options["source-path"] ?? "").trim())
  let sourceFilterPath = null
  let sourceFilterStat = null
  let sourceFilterRef = null
  if (sourceInput) {
    sourceFilterPath = resolveProjectInputPath(projectPath, sourceInput)
    sourceFilterStat = sourceFilterPath ? await fs.stat(sourceFilterPath).catch(() => null) : null
    sourceFilterRef = sourceFilterPath ? projectRefOrAbsolute(projectPath, sourceFilterPath) : sourceInput
  }
  let roots = [
    { root: path.join(projectPath, "raw"), label: "raw", sourceTypes: ["raw_article", "gangtise", "wechat", "daily_review"], extensions: WATCH_FILE_EXTENSIONS },
    { root: path.join(projectPath, "wiki"), label: "wiki", sourceTypes: ["wiki_article"], extensions: WATCH_FILE_EXTENSIONS },
    { root: path.join(projectPath, ".llm-wiki/agent-runs"), label: "agentic", sourceTypes: ["agentic_run"], extensions: WATCH_FILE_EXTENSIONS },
    { root: path.join(projectPath, HYPOTHESIS_SUPPLEMENTS_ROOT), label: "hypothesis_supplement", sourceTypes: ["hypothesis_supplement"], extensions: new Set([".md", ".markdown", ".txt"]) },
  ]
  const sourceFilterSingleFile = Boolean(sourceFilterStat?.isFile())
  if (sourceInput && sourceFilterStat?.isDirectory()) {
    const rootSourceType = inferSourceType(sourceFilterRef ?? "")
    roots = [{
      root: sourceFilterPath,
      label: sourceFilterRef ?? sourceInput,
      sourceTypes: rootSourceType === "unknown"
        ? ["raw_article", "gangtise", "wechat", "daily_review", "wiki_article", "agentic_run", "hypothesis_supplement"]
        : [rootSourceType],
      extensions: WATCH_FILE_EXTENSIONS,
    }]
  } else if (sourceInput) {
    roots = []
  }
  const discovered = []
  const sourceDiscovery = {
    sourceFilterApplied: Boolean(sourceInput && sourceFilterStat),
    sourceFilterRef: sourceInput ? sourceFilterRef : null,
    sourceFilterMissing: Boolean(sourceInput && !sourceFilterStat),
    sourceFilterKind: sourceFilterStat?.isFile() ? "file" : sourceFilterStat?.isDirectory() ? "directory" : null,
    fileRootsScanned: 0,
    fileRootsSkipped: 0,
    skippedFileRoots: [],
    filesListed: 0,
    fileCandidatesAfterCutoff: 0,
    fileSourcesRead: 0,
    fileSourcesSkippedByLimit: 0,
    wechatIncrementalSources: 0,
    wechatIncrementalFilesListed: 0,
    wechatIncrementalFilesScanned: 0,
    wechatIncrementalLinesRead: 0,
    wechatIncrementalLimit: limit,
    durationMs: 0,
  }

  const fileCandidates = []
  if (sourceFilterSingleFile && sourceFilterPath && sourceFilterStat) {
    const ext = path.extname(sourceFilterPath).toLowerCase()
    const sourceRef = projectRefOrAbsolute(projectPath, sourceFilterPath)
    const sourceType = inferSourceType(sourceRef)
    sourceDiscovery.filesListed += 1
    if (WATCH_FILE_EXTENSIONS.has(ext) && sourceFilterStat.mtime >= cutoff && sourceFilterAllows(filters, sourceType)) {
      fileCandidates.push({
        sourcePath: sourceFilterPath,
        sourceRef,
        sourceType,
        mtime: sourceFilterStat.mtime.toISOString(),
        mtimeMs: sourceFilterStat.mtimeMs,
      })
    }
  }
  for (const { root, label, sourceTypes, extensions } of roots) {
    if (!sourceTypes.some((sourceType) => sourceFilterAllows(filters, sourceType))) {
      sourceDiscovery.fileRootsSkipped += 1
      sourceDiscovery.skippedFileRoots.push(label)
      continue
    }
    sourceDiscovery.fileRootsScanned += 1
    const files = await listFilesRecursive(root, { extensions }).catch(() => [])
    sourceDiscovery.filesListed += files.length
    for (const filePath of files) {
      const stat = await fs.stat(filePath).catch(() => null)
      if (!stat || stat.mtime < cutoff) continue
      const sourceRef = projectRelative(projectPath, filePath)
      const sourceType = inferSourceType(sourceRef)
      if (!sourceFilterAllows(filters, sourceType)) continue
      fileCandidates.push({
        sourcePath: filePath,
        sourceRef,
        sourceType,
        mtime: stat.mtime.toISOString(),
        mtimeMs: stat.mtimeMs,
      })
    }
  }
  sourceDiscovery.fileCandidatesAfterCutoff = fileCandidates.length
  fileCandidates.sort((a, b) => b.mtime.localeCompare(a.mtime) || a.sourceRef.localeCompare(b.sourceRef))
  for (const candidate of fileCandidates) {
    if (discovered.length >= limit) break
    sourceDiscovery.fileSourcesRead += 1
    const text = await readIfExists(candidate.sourcePath)
    if (!text.trim()) continue
    discovered.push({
      sourcePath: candidate.sourcePath,
      sourceRef: candidate.sourceRef,
      sourceType: candidate.sourceType,
      ...sourceKindMetadataForWatchSource(candidate),
      sourceHash: sha256Hex(text),
      mtime: candidate.mtime,
      title: inferSourceTitle(text, candidate.sourcePath),
      textExcerpt: compactExcerpt(text),
      sourceText: text,
    })
  }
  sourceDiscovery.fileSourcesSkippedByLimit = Math.max(0, fileCandidates.length - sourceDiscovery.fileSourcesRead)

  const wechatSources = await discoverWechatIncrementSources({ projectPath, filters, cutoff, limit, sourceDiscovery })
  sourceDiscovery.wechatIncrementalSources = wechatSources.length
  discovered.push(...wechatSources)

  const sources = discovered
    .sort((a, b) => b.mtime.localeCompare(a.mtime) || a.sourceRef.localeCompare(b.sourceRef))
    .slice(0, limit)
  sourceDiscovery.durationMs = Date.now() - startedAt
  Object.defineProperty(sources, "sourceDiscovery", {
    value: sourceDiscovery,
    enumerable: false,
  })
  return sources
}

async function discoverWechatIncrementSources({ projectPath, filters, cutoff, limit = 100, sourceDiscovery = null }) {
  if (!sourceFilterAllows(filters, "wechat_incremental")) return []
  const root = path.join(projectPath, WECHAT_INBOX_PROCESSED_ROOT)
  const files = await listFilesRecursive(root, { extensions: new Set([".jsonl"]) }).catch(() => [])
  if (sourceDiscovery) sourceDiscovery.wechatIncrementalFilesListed = files.length
  const fileEntries = []
  for (const filePath of files) {
    const stat = await fs.stat(filePath).catch(() => null)
    if (!stat || stat.mtime < cutoff) continue
    fileEntries.push({ filePath, stat })
  }
  fileEntries.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs || b.filePath.localeCompare(a.filePath))
  const sources = []
  const sourceLimit = Math.max(1, Number(limit) || 100)
  for (const { filePath, stat } of fileEntries) {
    if (sources.length >= sourceLimit) break
    if (sourceDiscovery) sourceDiscovery.wechatIncrementalFilesScanned += 1
    const sourceRefBase = projectRelative(projectPath, filePath)
    const raw = await readIfExists(filePath)
    const lines = raw.split(/\r?\n/)
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      if (sources.length >= sourceLimit) break
      const line = lines[i]
      if (!line.trim()) continue
      if (sourceDiscovery) sourceDiscovery.wechatIncrementalLinesRead += 1
      let message
      try {
        message = JSON.parse(line)
      } catch {
        continue
      }
      if (message?.schema !== WECHAT_INCREMENT_PROCESSED_SCHEMA || !message.messageKey || !message.text) continue
      const messageTime = wechatMessageTimeMs(message)
      if (cutoff && messageTime != null && messageTime < cutoff.getTime()) continue
      const sourceMeta = signalSourceKindMetadata(message)
      const sourceLabel = signalSourceLabelForIncrement(message)
      const sourceText = [
        sourceLabel,
        message.chatName ? `chat=${message.chatName}` : null,
        message.sentAt ? `sentAt=${message.sentAt}` : null,
        message.text,
      ].filter(Boolean).join(" ")
      const sourceHash = sha256Hex(`${message.messageKey}:${message.textHash ?? message.text}`)
      sources.push({
        sourcePath: filePath,
        sourceRef: `${sourceRefBase}#${message.messageKey}`,
        sourceType: "wechat_incremental",
        sourceKind: sourceMeta.sourceKind,
        sourceKindLabel: sourceMeta.sourceKindLabel,
        sourceTool: message.sourceTool ?? null,
        sourceHash,
        mtime: messageTime != null ? new Date(messageTime).toISOString() : stat.mtime.toISOString(),
        title: `${sourceLabel} ${message.chatName ?? ""} ${message.sentAt ?? ""}`.trim(),
        textExcerpt: compactExcerpt(sourceText),
        sourceText,
      })
    }
  }
  return sources
}

function matchedEntitiesForHypothesis(hypothesis, text, options = {}) {
  const candidates = [
    ...(hypothesis.keyVariables ?? []),
    ...(hypothesis.segments ?? []),
    ...tokenizeForMatch(hypothesis.title),
    ...financeRouteForHypothesis(hypothesis, options.financeSignalEntities).matchedTerms,
  ].filter(isMeaningfulWatchToken)
  const haystack = String(text ?? "").toLowerCase()
  return [...new Set(candidates.filter((item) => haystack.includes(String(item).toLowerCase())).slice(0, 12))]
}

function buildHypothesisEventFromSource({ hypothesis, source, score, generatedAt, wikiReferenceIndex = [], financeSignalEntities = [] }) {
  const evidenceDelta = inferEvidenceDelta(source.sourceText)
  const confidenceImpact = confidenceImpactForDelta(evidenceDelta)
  const evidenceGaps = evidenceGapsForText(source.sourceText)
  const catalystTags = catalystTagsFromText(source.sourceText)
  const matchedSegments = (hypothesis.segments ?? []).filter((segment) => source.sourceText.toLowerCase().includes(String(segment).toLowerCase()))
  const matchedEntities = matchedEntitiesForHypothesis(hypothesis, source.sourceText, { financeSignalEntities })
  const relatedWikiPages = relatedWikiPagesForContext({
    wikiReferenceIndex,
    sourceText: source.sourceText,
    hypothesis,
    extraTerms: [...matchedSegments, ...matchedEntities, ...catalystTags],
  })
  const suggested = suggestedStatusForEvidenceDelta(evidenceDelta, hypothesis.status)
  const statusBefore = hypothesis.status ?? "watching"
  const reason = suggested.suggestedStatusReason
  return {
    schema: HYPOTHESIS_EVENT_SCHEMA,
    id: `hypoe_${shortHash(`${generatedAt}:${hypothesis.id}:${source.sourceHash}:${score}`)}`,
    hypothesisId: hypothesis.id,
    createdAt: generatedAt,
    eventTime: source.mtime ?? generatedAt,
    sourceRef: source.sourceRef,
    sourceType: source.sourceType,
    sourceKind: source.sourceKind ?? null,
    sourceKindLabel: source.sourceKindLabel ?? null,
    sourceTool: source.sourceTool ?? null,
    sourceHash: source.sourceHash,
    matchScore: score,
    matchedSegments,
    matchedEntities,
    evidenceDelta,
    signalType: signalTypeForEvidenceDelta(evidenceDelta),
    signalStrength: signalStrengthForEvidenceDelta(evidenceDelta),
    tradingImplication: tradingImplicationForEvidenceDelta(evidenceDelta),
    confidenceImpact,
    statusBefore,
    suggestedStatus: suggested.suggestedStatus,
    suggestedStatusReason: suggested.suggestedStatusReason,
    reason,
    askRunRef: null,
    evidenceGaps,
    catalystTags,
    financeSignalEntities,
    financeAuditMatchedEntities: financeSignalEntities,
    financeAuditMatchedTermsByType: financeEntityMatchedTermsByType(financeSignalEntities),
    relatedWikiPages,
    sourceExcerpt: source.textExcerpt,
    summary: `Source matched hypothesis with score ${score}.`,
    selfTrainingHooks: {
      sampleEligible: true,
      outcomePending: true,
      labelSource: "hypothesis_watch_event",
    },
  }
}

function dedupeWatchEvents(events = []) {
  const byKey = new Map()
  for (const event of events) {
    const key = [
      event.hypothesisId,
      event.sourceHash,
      event.evidenceDelta,
    ].join("\u0000")
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, event)
      continue
    }
    const mergedSourceRefs = uniqueNonEmpty([
      existing.sourceRef,
      ...(existing.mergedSourceRefs ?? []),
      event.sourceRef,
      ...(event.mergedSourceRefs ?? []),
    ])
    byKey.set(key, {
      ...existing,
      mergedSourceRefs,
      duplicateSourceCount: mergedSourceRefs.length,
    })
  }
  return [...byKey.values()]
}

function alertForEvent(event, hypothesis, generatedAt) {
  let alertLevel = "info"
  let alertReason = "new context matched an existing hypothesis"
  const flags = []
  if (event.evidenceDelta === "fundamental_delivery") {
    alertLevel = "important"
    alertReason = "new order/announcement/financial/customer evidence may strengthen the hypothesis"
  } else if (event.evidenceDelta === "catalyst_signal") {
    alertLevel = "important"
    alertReason = "fresh tradable catalyst appeared; track price/volume follow-through before demanding fundamental closure"
    flags.push("catalyst_tracking")
  } else if (event.evidenceDelta === "counter_signal") {
    alertLevel = "important"
    alertReason = "counterevidence or divergence appeared"
  } else if (event.evidenceDelta === "market_feedback") {
    alertLevel = "watch"
    alertReason = "market feedback appeared before fundamental closure"
    flags.push("priced_in_risk")
  } else if (event.evidenceDelta === "supporting_signal" || event.evidenceDelta === "mixed_signal") {
    alertLevel = "watch"
    alertReason = event.evidenceDelta === "mixed_signal" ? "mixed supportive and counter signals appeared" : "supportive evidence appeared"
  } else if (event.evidenceDelta === "narrative_expansion") {
    alertReason = "narrative expanded without enough validation evidence"
  }
  if (hypothesis?.status === "strengthening" || hypothesis?.status === "actionable") {
    alertLevel = ALERT_LEVEL_RANK[alertLevel] < ALERT_LEVEL_RANK.important ? "important" : alertLevel
    alertReason = `${alertReason}; hypothesis is near actionable status`
  }
  return {
    schema: "trading-hypothesis-alert-v1",
    id: `alert_${shortHash(`${event.id}:${event.hypothesisId}:${event.sourceHash}:${event.evidenceDelta}`)}`,
    hypothesisId: event.hypothesisId,
    hypothesisTitle: hypothesis?.title ?? "",
    sourceRef: event.sourceRef,
    sourceType: event.sourceType,
    sourceKind: event.sourceKind ?? null,
    sourceKindLabel: event.sourceKindLabel ?? null,
    sourceTool: event.sourceTool ?? null,
    sourceHash: event.sourceHash,
    eventTime: event.eventTime ?? event.createdAt ?? generatedAt,
    alertLevel,
    alertReason,
    evidenceDelta: event.evidenceDelta,
    confidenceImpact: event.confidenceImpact,
    statusBefore: event.statusBefore ?? hypothesis?.status ?? "watching",
    suggestedStatus: event.suggestedStatus,
    suggestedStatusReason: event.suggestedStatusReason,
    reason: event.reason ?? event.suggestedStatusReason ?? alertReason,
    askRunRef: event.askRunRef ?? null,
    evidenceGaps: event.evidenceGaps,
    signalType: event.signalType ?? signalTypeForEvidenceDelta(event.evidenceDelta),
    signalStrength: event.signalStrength ?? signalStrengthForEvidenceDelta(event.evidenceDelta),
    tradingImplication: event.tradingImplication ?? "",
    askDeepDiveRecommended: Boolean(event.askDeepDiveRecommended),
    relatedWikiPages: event.relatedWikiPages ?? [],
    llmReview: event.llmReview ?? null,
    flags,
    status: "open",
    createdAt: generatedAt,
  }
}

function buildWatchReviewPipeline({ sources = [], sourceDiscovery = {}, contextLoads = {}, events = [], candidateHypotheses = [], llmReview = null }) {
  const reviewableItems = (Array.isArray(events) ? events.length : 0) + (Array.isArray(candidateHypotheses) ? candidateHypotheses.length : 0)
  const frameworkLoaded = Boolean(contextLoads.wikiIndustryTerms || contextLoads.wikiReferenceIndex)
  const financeLoaded = Boolean(contextLoads.financeEntityAudit)
  return {
    source: {
      status: sources.length > 0 ? "done" : "skipped",
      sourcesScanned: sources.length,
      fileCandidatesAfterCutoff: Number(sourceDiscovery.fileCandidatesAfterCutoff ?? 0) || 0,
      fileSourcesRead: Number(sourceDiscovery.fileSourcesRead ?? 0) || 0,
      wechatIncrementalSources: Number(sourceDiscovery.wechatIncrementalSources ?? 0) || 0,
      durationMs: Number(sourceDiscovery.durationMs ?? 0) || 0,
    },
    rules: {
      status: sources.length > 0 ? "done" : "skipped",
      reviewableItems,
      events: Array.isArray(events) ? events.length : 0,
      candidateHypotheses: Array.isArray(candidateHypotheses) ? candidateHypotheses.length : 0,
    },
    framework: {
      status: frameworkLoaded ? "done" : "skipped",
      wikiIndustryTerms: Boolean(contextLoads.wikiIndustryTerms),
      wikiReferenceIndex: Boolean(contextLoads.wikiReferenceIndex),
      financeEntityAudit: financeLoaded,
      financeEntityAuditRows: Number(contextLoads.financeEntityAuditRows ?? 0) || 0,
    },
    llm: {
      status: llmReview?.status ?? "off",
      mode: llmReview?.mode ?? "off",
      reason: llmReview?.reason ?? null,
      reviewedCount: Number(llmReview?.reviewedCount ?? 0) || 0,
      candidateCount: Number(llmReview?.candidateCount ?? reviewableItems) || 0,
      maxItems: Number(llmReview?.maxItems ?? 0) || 0,
    },
  }
}

async function existingSourceHashesForHypotheses(projectPath, hypothesisIds) {
  const byHypothesis = new Map()
  for (const id of hypothesisIds) {
    const records = await listHypothesisEventRecords(projectPath, id)
    byHypothesis.set(id, new Set(records.map((event) => event.sourceHash).filter(Boolean)))
  }
  return byHypothesis
}

export async function runHypothesisWatch(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const generatedAt = String(options.generatedAt ?? nowLocalTimestamp())
  const dryRun = !options.write
  const sinceFilter = safeErrorMessage(String(options.since ?? "1d").trim())
  const sourceFilters = [...parseSourceFilters(options.sources)]
  const limit = Math.max(1, Number(options.limit ?? 100) || 100)
  const hypothesisIdFilter = safeErrorMessage(String(options.hypothesisId ?? options["hypothesis-id"] ?? "").trim())
  const llmReviewMode = normalizeLlmReviewMode(options.llmReview ?? options["llm-review"])
  const llmReviewMaxItems = boundedInteger(options.llmReviewMaxItems ?? options["llm-review-max-items"], WATCH_LLM_REVIEW_DEFAULT_MAX_ITEMS, 1, 20)
  const compactOutput = Boolean(options.compact ?? options["compact"])
  const sources = await discoverHypothesisSources(options)
  const sourceDiscovery = sources.sourceDiscovery ?? {
    fileRootsScanned: 0,
    fileRootsSkipped: 0,
    skippedFileRoots: [],
    filesListed: 0,
    wechatIncrementalSources: 0,
    durationMs: 0,
  }
  if (!sources.length) {
    if (hypothesisIdFilter) {
      const listedForId = await listHypotheses({ projectPath })
      if (!listedForId.hypotheses.some((hypothesis) => hypothesis.id === hypothesisIdFilter)) {
        throw new Error(`Unknown hypothesis id: ${hypothesisIdFilter}`)
      }
    }
    const llmReviewStatus = llmReviewMode === "off" ? "off" : "skipped"
    const llmReview = {
      status: llmReviewStatus,
      mode: llmReviewMode,
      reason: "no_sources",
      reviewedCount: 0,
      maxItems: llmReviewMaxItems,
      reviews: [],
    }
    const emptyContextLoads = {
      wikiIndustryTerms: false,
      wikiReferenceIndex: false,
      financeEntityAudit: false,
      financeEntityAuditRows: 0,
      financeEntityAuditTableRef: null,
    }
    return {
      schema: "trading-hypothesis-watch-run-v1",
      mode: "hypothesis-watch",
      projectPath,
      dryRun,
      filters: {
        since: sinceFilter,
        sources: sourceFilters,
        limit,
        hypothesisId: hypothesisIdFilter || null,
        llmReview: llmReviewMode,
        compact: compactOutput,
      },
      sources: [],
      matchedHypotheses: [],
      events: [],
      alerts: [],
      duplicateEvents: [],
      duplicateAlerts: [],
      candidateHypotheses: [],
      llmReview,
      writeResult: null,
      summary: {
        sourcesScanned: 0,
        sourcesReturned: 0,
        compactOutput,
        skippedReason: "no_sources",
        sourceDiscovery,
        contextLoads: emptyContextLoads,
        reviewPipeline: buildWatchReviewPipeline({
          sources: [],
          sourceDiscovery,
          contextLoads: emptyContextLoads,
          events: [],
          candidateHypotheses: [],
          llmReview,
        }),
        matchedHypotheses: 0,
        eventsPending: 0,
        alertsPending: 0,
        candidateHypotheses: 0,
        llmReviewStatus,
        duplicateEvents: 0,
        duplicateAlerts: 0,
        eventsWritten: 0,
        alertsWritten: 0,
        dashboardJson: null,
        dashboardMarkdown: null,
        wroteWiki: false,
        wroteRaw: false,
        wroteFacts: false,
        wroteRealTrade: false,
      },
      writePolicy: {
        artifacts: ".llm-wiki/hypothesis-events and .llm-wiki/hypothesis-alerts only when --write is present",
        wroteWiki: false,
        wroteRaw: false,
        wroteFacts: false,
        wroteRealTrade: false,
        autoAppliedPolicy: false,
      },
    }
  }
  let wikiIndustryTerms = null
  let wikiReferenceIndex = null
  const contextLoads = {
    wikiIndustryTerms: false,
    wikiReferenceIndex: false,
    financeEntityAudit: false,
    financeEntityAuditRows: 0,
    financeEntityAuditTableRef: null,
    financeEntityAuditTypeCounts: {},
  }
  let financeEntityAuditIndexPromise = null
  const getFinanceEntityAuditIndex = async () => {
    if (!financeEntityAuditIndexPromise) {
      financeEntityAuditIndexPromise = loadFinanceEntityAuditIndex(projectPath, options)
    }
    return await financeEntityAuditIndexPromise
  }
  const recordFinanceEntityAuditContext = async () => {
    const audit = await getFinanceEntityAuditIndex()
    if (!audit.tableRef) return
    contextLoads.financeEntityAudit = true
    contextLoads.financeEntityAuditRows = audit.rowCount
    contextLoads.financeEntityAuditTableRef = audit.tableRef
    contextLoads.financeEntityAuditTypeCounts = audit.typeCounts ?? {}
  }
  const wikiContextOptions = () => ({
    ...options,
    financeEntityAuditIndexPromise,
  })
  const getWikiIndustryTerms = async () => {
    if (!wikiIndustryTerms) {
      contextLoads.wikiIndustryTerms = true
      await recordFinanceEntityAuditContext()
      wikiIndustryTerms = await loadWikiIndustryTerms(projectPath, wikiContextOptions())
    }
    return wikiIndustryTerms
  }
  const getWikiReferenceIndex = async () => {
    if (!wikiReferenceIndex) {
      contextLoads.wikiReferenceIndex = true
      await recordFinanceEntityAuditContext()
      wikiReferenceIndex = await loadWikiReferenceIndex(projectPath, wikiContextOptions())
    }
    return wikiReferenceIndex
  }
  const getFinanceSignalEntitiesForText = async (text) => {
    await recordFinanceEntityAuditContext()
    return financeSignalEntitiesForText(text, await getFinanceEntityAuditIndex())
  }
  const listed = await listHypotheses({ projectPath })
  const watchableHypotheses = listed.hypotheses.filter((hypothesis) => !isWeakAutoWatchHypothesis(hypothesis))
  const hypothesesToScan = hypothesisIdFilter
    ? listed.hypotheses.filter((hypothesis) => hypothesis.id === hypothesisIdFilter)
    : watchableHypotheses
  if (hypothesisIdFilter && hypothesesToScan.length === 0) {
    throw new Error(`Unknown hypothesis id: ${hypothesisIdFilter}`)
  }
  const events = []
  const candidateHypotheses = []
  for (const source of sources) {
    const financeSignalEntities = await getFinanceSignalEntitiesForText(source.sourceText)
    const scored = hypothesesToScan
      .map((hypothesis) => ({ hypothesis, score: scoreHypothesisMatch(hypothesis, source.sourceText, { financeSignalEntities }) }))
      .filter((item) => item.score >= 3)
      .sort((a, b) => b.score - a.score || a.hypothesis.id.localeCompare(b.hypothesis.id))
    if (!scored.length) {
      const mayBecomeCandidate = isCatalystSignal(source.sourceText) || Boolean(inferThemeFromText(source.sourceText, source.sourcePath))
      if (!mayBecomeCandidate) continue
      const candidate = candidateHypothesisFromArticle({
        text: source.sourceText,
        sourcePath: source.sourcePath,
        generatedAt,
        wikiIndustryTerms: await getWikiIndustryTerms(),
      })
      if (candidate) {
        const relatedWikiIndex = await getWikiReferenceIndex()
        const candidateFocusText = candidateFocusTextFromArticle(source.sourceText)
        candidateHypotheses.push({
          ...candidate,
          discoverySourceRef: source.sourceRef,
          sourceType: source.sourceType,
          sourceKind: source.sourceKind ?? null,
          sourceKindLabel: source.sourceKindLabel ?? null,
          sourceTool: source.sourceTool ?? null,
          sourceHash: source.sourceHash,
          sourceExcerpt: source.textExcerpt,
          financeSignalEntities,
          financeAuditMatchedEntities: financeSignalEntities,
          financeAuditMatchedTermsByType: financeEntityMatchedTermsByType(financeSignalEntities),
          relatedWikiPages: relatedWikiPagesForContext({
            wikiReferenceIndex: relatedWikiIndex,
            sourceText: candidateFocusText || source.sourceText,
            candidate,
          }),
        })
      }
      continue
    }
    const relatedWikiIndex = await getWikiReferenceIndex()
    for (const { hypothesis, score } of scored) {
      events.push(buildHypothesisEventFromSource({ hypothesis, source, score, generatedAt, wikiReferenceIndex: relatedWikiIndex, financeSignalEntities }))
    }
  }

  const hypothesisById = new Map(listed.hypotheses.map((hypothesis) => [hypothesis.id, hypothesis]))
  const uniqueEvents = dedupeWatchEvents(events)
  const uniqueCandidateHypotheses = dedupeCandidateHypotheses(candidateHypotheses)
  const llmReview = await runWatchLlmReview({
    projectPath,
    generatedAt,
    events: uniqueEvents,
    candidateHypotheses: uniqueCandidateHypotheses,
    hypothesisById,
    options,
  })
  const reviewed = applyWatchLlmReview({ events: uniqueEvents, candidateHypotheses: uniqueCandidateHypotheses, llmReview })
  const reviewedEvents = dedupeWatchEvents(reviewed.events)
  const reviewedCandidateHypotheses = reviewed.candidateHypotheses
  const alerts = reviewedEvents.map((event) => alertForEvent(event, hypothesisById.get(event.hypothesisId), generatedAt))
  const existingHashes = await existingSourceHashesForHypotheses(projectPath, [...new Set(reviewedEvents.map((event) => event.hypothesisId))])
  const newEvents = reviewedEvents.filter((event) => !existingHashes.get(event.hypothesisId)?.has(event.sourceHash))
  const duplicateEvents = reviewedEvents.filter((event) => existingHashes.get(event.hypothesisId)?.has(event.sourceHash))
  const newEventKeys = new Set(newEvents.map((event) => `${event.hypothesisId}:${event.sourceHash}`))
  const duplicateEventKeys = new Set(duplicateEvents.map((event) => `${event.hypothesisId}:${event.sourceHash}`))
  const newAlerts = alerts.filter((alert) => newEventKeys.has(`${alert.hypothesisId}:${alert.sourceHash}`))
  const duplicateAlerts = alerts.filter((alert) => duplicateEventKeys.has(`${alert.hypothesisId}:${alert.sourceHash}`))

  let writeResult = null
  if (!dryRun && newEvents.length) {
    const eventPaths = []
    for (const event of newEvents) {
      const filePath = hypothesisEventPath(projectPath, event.hypothesisId)
      await ensureDirectory(path.dirname(filePath))
      await fs.appendFile(filePath, `${JSON.stringify(event)}\n`, "utf8")
      eventPaths.push(projectRelative(projectPath, filePath))
    }
    const alertDate = generatedAt.slice(0, 10)
    const alertPath = hypothesisAlertPath(projectPath, alertDate)
    await ensureDirectory(path.dirname(alertPath))
    for (const alert of newAlerts) {
      await fs.appendFile(alertPath, `${JSON.stringify(alert)}\n`, "utf8")
    }
    writeResult = {
      eventRelativePaths: [...new Set(eventPaths)],
      alertsRelativePath: projectRelative(projectPath, alertPath),
      eventsWritten: newEvents.length,
      alertsWritten: newAlerts.length,
    }
  }

  const matchedHypothesisIds = [...new Set(reviewedEvents.map((event) => event.hypothesisId))]
  return {
    schema: "trading-hypothesis-watch-run-v1",
    mode: "hypothesis-watch",
    projectPath,
    dryRun,
    filters: {
      since: sinceFilter,
      sources: sourceFilters,
      limit,
      hypothesisId: hypothesisIdFilter || null,
      llmReview: llmReviewMode,
      compact: compactOutput,
    },
    sources: compactOutput ? [] : sources.map(publicSourceRecord),
    matchedHypotheses: matchedHypothesisIds.map((id) => ({ id, title: hypothesisById.get(id)?.title ?? "" })),
    events: newEvents,
    alerts: newAlerts,
    duplicateEvents,
    duplicateAlerts,
    candidateHypotheses: reviewedCandidateHypotheses,
    llmReview,
    writeResult,
    summary: {
      sourcesScanned: sources.length,
      sourcesReturned: compactOutput ? 0 : sources.length,
      compactOutput,
      sourceDiscovery,
      contextLoads,
      reviewPipeline: buildWatchReviewPipeline({
        sources,
        sourceDiscovery,
        contextLoads,
        events: reviewedEvents,
        candidateHypotheses: reviewedCandidateHypotheses,
        llmReview,
      }),
      matchedHypotheses: matchedHypothesisIds.length,
      eventsPending: newEvents.length,
      alertsPending: newAlerts.length,
      candidateHypotheses: reviewedCandidateHypotheses.length,
      llmReviewStatus: llmReview.status,
      duplicateEvents: duplicateEvents.length,
      duplicateAlerts: duplicateAlerts.length,
      eventsWritten: dryRun ? 0 : newEvents.length,
      alertsWritten: dryRun ? 0 : newAlerts.length,
      dashboardJson: null,
      dashboardMarkdown: null,
      wroteWiki: false,
      wroteRaw: false,
      wroteFacts: false,
      wroteRealTrade: false,
    },
    writePolicy: {
      artifacts: ".llm-wiki/hypothesis-events and .llm-wiki/hypothesis-alerts only when --write is present",
      wroteWiki: false,
      wroteRaw: false,
      wroteFacts: false,
      wroteRealTrade: false,
      autoAppliedPolicy: false,
    },
  }
}

export async function updateHypothesisFromArticle(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const sourcePath = resolveProjectInputPath(projectPath, options.sourcePath ?? options.source)
  if (!sourcePath) throw new Error("Missing required --source")
  const generatedAt = String(options.generatedAt ?? nowLocalTimestamp())
  const sourceText = await readIfExists(sourcePath)
  if (!sourceText.trim()) throw new Error(`Source is empty or unreadable: ${sourcePath}`)
  const sourceHash = sha256Hex(sourceText)
  const sourceRef = projectRefOrAbsolute(projectPath, sourcePath)
  const listed = await listHypotheses({ projectPath })
  const wikiIndustryTerms = await loadWikiIndustryTerms(projectPath, options)
  const scored = listed.hypotheses
    .map((hypothesis) => ({ hypothesis, score: scoreHypothesisMatch(hypothesis, sourceText) }))
    .filter((item) => item.score >= 3)
    .sort((a, b) => b.score - a.score || a.hypothesis.id.localeCompare(b.hypothesis.id))
  const evidenceDelta = inferEvidenceDelta(sourceText)
  const confidenceImpact = confidenceImpactForDelta(evidenceDelta)
  const evidenceGaps = evidenceGapsForText(sourceText)
  const dryRun = !options.write
  const events = scored.map(({ hypothesis, score }) => ({
    schema: HYPOTHESIS_EVENT_SCHEMA,
    id: `hypoe_${shortHash(`${generatedAt}:${hypothesis.id}:${sourceHash}:${score}`)}`,
    hypothesisId: hypothesis.id,
    createdAt: generatedAt,
    sourceRef,
    sourceHash,
    matchScore: score,
    matchedSegments: (hypothesis.segments ?? []).filter((segment) => sourceText.toLowerCase().includes(String(segment).toLowerCase())),
    evidenceDelta,
    confidenceImpact,
    evidenceGaps,
    sourceExcerpt: safeErrorMessage(sourceText.replace(/\s+/g, " ").slice(0, 600)),
    summary: safeErrorMessage(String(options.summary ?? "").trim()) || `Source matched hypothesis with score ${score}.`,
    selfTrainingHooks: {
      sampleEligible: true,
      outcomePending: true,
      labelSource: "hypothesis_update_event",
    },
  }))

  let writeResult = null
  if (!dryRun && events.length) {
    const written = []
    for (const event of events) {
      const filePath = hypothesisEventPath(projectPath, event.hypothesisId)
      await ensureDirectory(path.dirname(filePath))
      await fs.appendFile(filePath, `${JSON.stringify(event)}\n`, "utf8")
      written.push(projectRelative(projectPath, filePath))
    }
    writeResult = { records: events.length, relativePaths: [...new Set(written)] }
  }
  const candidate = scored.length ? null : candidateHypothesisFromArticle({ text: sourceText, sourcePath, generatedAt, wikiIndustryTerms })

  return {
    schema: "trading-hypothesis-update-from-article-run-v1",
    mode: "hypothesis-update-from-article",
    projectPath,
    dryRun,
    source: { path: sourcePath, ref: sourceRef, hash: sourceHash },
    matchedHypotheses: scored.map(({ hypothesis, score }) => ({ id: hypothesis.id, title: hypothesis.title, score })),
    events,
    candidateHypotheses: candidate ? [candidate] : [],
    writeResult,
    writePolicy: {
      artifacts: ".llm-wiki/hypothesis-events only when --write is present",
      wroteWiki: false,
      wroteRaw: false,
      autoCreatedHypothesis: false,
    },
  }
}

function signalStringsFromRefs(refs) {
  return (refs ?? []).map((item) => typeof item === "string" ? item : JSON.stringify(item))
}

function validationSignals(hypothesis, events) {
  const sourceTexts = [
    ...signalStringsFromRefs(hypothesis.evidenceRefs),
    ...signalStringsFromRefs(hypothesis.marketRefs),
    ...events.map((event) => [
      event.sourceRef,
      event.sourceExcerpt,
      event.evidenceDelta,
      event.summary,
      ...(event.evidenceGaps ?? []),
      ...(event.matchedSegments ?? []),
    ].filter(Boolean).join(" ")),
  ]
  const marketSignals = sourceTexts.filter((item) => textHasAny(item, MARKET_PATTERNS))
  const fundamentalSignals = sourceTexts.filter((item) => textHasAny(item, FUNDAMENTAL_PATTERNS))
  const counterSignals = sourceTexts.filter((item) => textHasAny(item, NEGATIVE_EVIDENCE_PATTERNS))
  const supportingSignals = sourceTexts.filter((item) => textHasAny(item, POSITIVE_EVIDENCE_PATTERNS))
  return { sourceTexts, marketSignals, fundamentalSignals, counterSignals, supportingSignals }
}

function currentValidationGaps(signals) {
  const combined = signals.sourceTexts.join("\n")
  return [
    signals.marketSignals.length ? null : "market:stock_daily_or_agentic_feedback:not_checked",
    /订单|中标|招投标/.test(combined) ? null : "fundamental:orders:not_checked",
    /公告|CNINFO|交易所/.test(combined) ? null : "fundamental:announcement:not_checked",
    /财报|收入|毛利率|现金流/.test(combined) ? null : "fundamental:financials:not_checked",
    /ASP|价格|单柜|用量|份额/.test(combined) ? null : "industry:variables:not_checked",
  ].filter(Boolean)
}

function nextDateFromNow(days = 30) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  const pad = (value) => String(value).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function classifyValidation({ signals, evidenceGaps, hypothesis }) {
  const hasMarket = signals.marketSignals.length > 0
  const hasFundamental = signals.fundamentalSignals.length > 0
  const hasCounter = signals.counterSignals.length > 0
  const hasSupport = signals.supportingSignals.length > 0
  const status = hypothesis.status
  if (status === "disconfirmed") return { result: "disconfirmed", confidenceChange: -0.2, reason: "hypothesis status is already disconfirmed" }
  if (status === "priced_in") return { result: "priced_in", confidenceChange: -0.05, reason: "hypothesis status is already priced_in" }
  if (hasCounter && hasFundamental) return { result: "disconfirmed", confidenceChange: -0.15, reason: "fundamental counterevidence is present" }
  if (hasCounter) return { result: "divergent", confidenceChange: -0.08, reason: "counterevidence exists but fundamental closure is incomplete" }
  if (hasMarket && !hasFundamental) return { result: "priced_in", confidenceChange: 0, reason: "market feedback exists without order/announcement/financial confirmation" }
  if (hasMarket && hasFundamental && hasSupport && !evidenceGaps.length) return { result: "confirmed", confidenceChange: 0.12, reason: "market and fundamental evidence are both present" }
  if (hasFundamental && hasSupport) return { result: "insufficient", confidenceChange: 0.04, reason: "supportive fundamental evidence exists but validation gaps remain" }
  return { result: "insufficient", confidenceChange: 0, reason: "not enough market and fundamental evidence to validate" }
}

export async function validateHypothesis(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const hypothesis = await readHypothesisById(projectPath, options.id ?? options.hypothesisId)
  const events = await listHypothesisEventRecords(projectPath, hypothesis.id)
  const signals = validationSignals(hypothesis, events)
  const historicalEvidenceGaps = [...new Set(events.flatMap((event) => event.evidenceGaps ?? []))]
  const evidenceGaps = [...new Set(currentValidationGaps(signals))]
  const classification = classifyValidation({ signals, evidenceGaps, hypothesis })
  const validation = {
    schema: HYPOTHESIS_VALIDATION_SCHEMA,
    mode: "hypothesis-validate",
    projectPath,
    dryRun: true,
    generatedAt: String(options.generatedAt ?? nowLocalTimestamp()),
    window: safeErrorMessage(String(options.window ?? "20d").trim()),
    hypothesis: {
      id: hypothesis.id,
      title: hypothesis.title,
      theme: hypothesis.theme,
      segments: hypothesis.segments,
      status: hypothesis.status,
      conviction: hypothesis.conviction,
    },
    result: classification.result,
    reason: classification.reason,
    marketFeedback: {
      status: signals.marketSignals.length ? "available" : "missing",
      signals: signals.marketSignals,
      warning: signals.marketSignals.length && !signals.fundamentalSignals.length
        ? "market feedback alone cannot confirm fundamental delivery"
        : null,
    },
    fundamentalEvidence: {
      status: signals.fundamentalSignals.length ? "available" : "missing",
      signals: signals.fundamentalSignals,
    },
    evidenceGaps,
    historicalEvidenceGaps,
    confidenceChange: classification.confidenceChange,
    nextValidationDateSuggestion: hypothesis.nextValidationDate ?? nextDateFromNow(30),
    guardrails: [
      "do_not_treat_short_term_price_move_as_confirmed",
      "fundamental_evidence_required_for_confirmed",
      "no_wiki_raw_or_trade_writes",
    ],
    selfTrainingHooks: {
      label: classification.result,
      eventRefs: events.map((event) => event.id).filter(Boolean),
      sampleEligible: true,
      requiresReviewForHighConfidence: classification.result === "confirmed",
    },
  }
  return {
    ...validation,
    markdown: validationMarkdown(validation),
  }
}

export async function buildHypothesisReport(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const generatedAt = String(options.generatedAt ?? nowLocalTimestamp())
  const hypothesis = await readHypothesisById(projectPath, options.id ?? options.hypothesisId)
  const events = await listHypothesisEventRecords(projectPath, hypothesis.id)
  const signals = validationSignals(hypothesis, events)
  const report = {
    schema: HYPOTHESIS_REPORT_SCHEMA,
    mode: "hypothesis-report",
    projectPath,
    generatedAt,
    hypothesis,
    evidenceChain: events,
    marketFeedback: signals.marketSignals,
    fundamentalEvidence: signals.fundamentalSignals,
    evidenceGaps: [...new Set([
      ...(hypothesis.evidenceRefs?.length ? [] : ["hypothesis:evidence_refs:missing"]),
      ...(hypothesis.marketRefs?.length ? [] : ["hypothesis:market_refs:missing"]),
      ...events.flatMap((event) => event.evidenceGaps ?? []),
    ])],
    lessons: events
      .filter((event) => event.confidenceImpact?.direction === "negative" || event.evidenceDelta === "counter_signal")
      .map((event) => `Review ${event.hypothesisId}: counterevidence from ${event.sourceRef}`),
    errorType: signals.marketSignals.length && !signals.fundamentalSignals.length ? "price_only_without_fundamental_evidence" : null,
    policySuggestions: [
      ...(signals.marketSignals.length && !signals.fundamentalSignals.length
        ? [{ target: "evidence_task_priority", suggestion: "raise order/announcement/financial evidence priority before increasing conviction" }]
        : []),
      ...(hypothesis.segments?.length ? [] : [{ target: "segment_config", suggestion: "add explicit segment tags before routing future article updates" }]),
    ],
    writePolicy: {
      artifacts: ".llm-wiki/hypothesis-reports only when --write is present",
      wroteWiki: false,
      wroteRaw: false,
      wroteRealTrade: false,
    },
  }
  const markdown = reportMarkdown(report)
  const dryRun = !options.write
  let writeResult = null
  if (!dryRun) {
    const outputDir = path.join(projectPath, HYPOTHESIS_REPORTS_ROOT)
    await ensureDirectory(outputDir)
    const prefix = `${timestampForPath(generatedAt)}-${hypothesis.id}`
    const jsonPath = path.join(outputDir, `${prefix}.json`)
    const markdownPath = path.join(outputDir, `${prefix}.md`)
    await writeJson(jsonPath, report)
    await fs.writeFile(markdownPath, markdown, "utf8")
    writeResult = {
      jsonPath,
      markdownPath,
      jsonRelativePath: projectRelative(projectPath, jsonPath),
      markdownRelativePath: projectRelative(projectPath, markdownPath),
      records: 1,
    }
  }
  return {
    schema: "trading-hypothesis-report-run-v1",
    mode: "hypothesis-report",
    projectPath,
    dryRun,
    report,
    markdown,
    writeResult,
  }
}

function deriveHypothesisFeedbackStatus({ hypothesis, events, openAlerts }) {
  const persistedStatus = normalizeStatus(hypothesis.status, "watching")
  if (persistedStatus === "archived" || persistedStatus === "disconfirmed" || persistedStatus === "actionable") {
    return {
      feedbackStatus: persistedStatus,
      feedbackReason: "persisted hypothesis status is authoritative",
      latestEvidenceDelta: null,
    }
  }

  const orderedEvents = [...events].sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")))
  const latestEvent = orderedEvents[0] ?? null
  const deltas = new Set(orderedEvents.map((event) => event.evidenceDelta).filter(Boolean))
  const hasPricedInAlert = openAlerts.some((alert) => alert.flags?.includes("priced_in_risk") || alert.evidenceDelta === "market_feedback")
  const signals = validationSignals(hypothesis, orderedEvents)
  const hasFundamentalEvidence = signals.fundamentalSignals.length > 0
  const hasMarketOnlyRisk = (hasPricedInAlert || deltas.has("market_feedback") || signals.marketSignals.length > 0) && !hasFundamentalEvidence

  if (persistedStatus === "divergent" || deltas.has("counter_signal")) {
    return {
      feedbackStatus: "divergent",
      feedbackReason: "counterevidence or divergence was routed to this hypothesis",
      latestEvidenceDelta: latestEvent?.evidenceDelta ?? "counter_signal",
    }
  }
  if (persistedStatus === "priced_in" || hasMarketOnlyRisk) {
    return {
      feedbackStatus: "priced_in",
      feedbackReason: "market feedback is visible before order/announcement/financial closure",
      latestEvidenceDelta: latestEvent?.evidenceDelta ?? "market_feedback",
    }
  }
  if (deltas.has("catalyst_signal")) {
    return {
      feedbackStatus: "watching",
      feedbackReason: "fresh catalyst is routed; wait for price/volume follow-through and second confirmation",
      latestEvidenceDelta: latestEvent?.evidenceDelta ?? "catalyst_signal",
    }
  }
  if (persistedStatus === "strengthening" || deltas.has("fundamental_delivery") || deltas.has("supporting_signal")) {
    return {
      feedbackStatus: "strengthening",
      feedbackReason: "supporting evidence or fundamental delivery signal is present",
      latestEvidenceDelta: latestEvent?.evidenceDelta ?? "supporting_signal",
    }
  }
  if (orderedEvents.length || persistedStatus === "watching") {
    return {
      feedbackStatus: "watching",
      feedbackReason: orderedEvents.length ? "new context exists but validation is not decisive" : "hypothesis is being tracked",
      latestEvidenceDelta: latestEvent?.evidenceDelta ?? null,
    }
  }
  return {
    feedbackStatus: persistedStatus || "seed",
    feedbackReason: "no routed evidence yet",
    latestEvidenceDelta: null,
  }
}

export async function buildHypothesisDashboardData(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const generatedAt = String(options.generatedAt ?? nowLocalTimestamp())
  const dryRun = !options.write
  const listed = await listHypotheses({ projectPath })
  const alerts = await listHypothesisAlertRecords(projectPath)
  const events = await listHypothesisEventRecords(projectPath)
  const hypothesisById = new Map(listed.hypotheses.map((hypothesis) => [hypothesis.id, hypothesis]))
  const generatedDate = generatedAt.slice(0, 10)
  const openAlerts = alerts.filter((alert) => alert.status === "open")
  const todayTriggers = alerts.filter((alert) => String(alert.createdAt ?? "").slice(0, 10) === generatedDate)
  const gapCounts = new Map()
  for (const event of events) {
    for (const gap of event.evidenceGaps ?? []) {
      gapCounts.set(gap, (gapCounts.get(gap) ?? 0) + 1)
    }
  }
  const dashboard = {
    schema: "trading-hypothesis-dashboard-v1",
    generatedAt,
    summary: {
      hypothesisCount: listed.count,
      openAlertCount: openAlerts.length,
      triggeredTodayCount: todayTriggers.length,
      strengtheningCount: listed.hypotheses.filter((item) => item.status === "strengthening" || item.status === "actionable").length,
      pricedInRiskCount: openAlerts.filter((alert) => alert.flags?.includes("priced_in_risk")).length,
      disconfirmedCount: listed.hypotheses.filter((item) => item.status === "disconfirmed").length,
    },
    hypotheses: listed.hypotheses.map((hypothesis) => {
      const eventsForHypothesis = events.filter((event) => event.hypothesisId === hypothesis.id)
      const openAlertsForHypothesis = openAlerts.filter((alert) => alert.hypothesisId === hypothesis.id)
      const recentEventsForHypothesis = [...eventsForHypothesis]
        .sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")))
        .slice(0, 5)
      const recentOpenAlertsForHypothesis = [...openAlertsForHypothesis]
        .sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")))
        .slice(0, 5)
      const feedback = deriveHypothesisFeedbackStatus({
        hypothesis,
        events: eventsForHypothesis,
        openAlerts: openAlertsForHypothesis,
      })
      return {
        id: hypothesis.id,
        title: hypothesis.title,
        theme: hypothesis.theme,
        segments: hypothesis.segments,
        status: hypothesis.status,
        feedbackStatus: feedback.feedbackStatus,
        feedbackReason: feedback.feedbackReason,
        latestEvidenceDelta: feedback.latestEvidenceDelta,
        conviction: hypothesis.conviction,
        openAlertCount: openAlertsForHypothesis.length,
        recentEvents: recentEventsForHypothesis,
        openAlerts: recentOpenAlertsForHypothesis,
        latestEventAt: eventsForHypothesis
          .map((event) => event.createdAt)
          .sort()
          .at(-1) ?? null,
      }
    }),
    todayTriggers: todayTriggers.map((alert) => ({
      ...alert,
      hypothesisTitle: alert.hypothesisTitle || hypothesisById.get(alert.hypothesisId)?.title || "",
    })),
    openAlerts: openAlerts.map((alert) => ({
      ...alert,
      hypothesisTitle: alert.hypothesisTitle || hypothesisById.get(alert.hypothesisId)?.title || "",
    })),
    evidenceGapSummary: [...gapCounts.entries()]
      .map(([gap, count]) => ({ gap, count }))
      .sort((a, b) => b.count - a.count || a.gap.localeCompare(b.gap)),
    writePolicy: {
      artifacts: ".llm-wiki/hypothesis-dashboard only when --write is present",
      wroteWiki: false,
      wroteRaw: false,
      wroteFacts: false,
      wroteRealTrade: false,
    },
  }
  const markdown = dashboardMarkdown(dashboard)
  let writeResult = null
  if (!dryRun) {
    const jsonPath = hypothesisDashboardJsonPath(projectPath)
    const markdownPath = hypothesisDashboardMarkdownPath(projectPath)
    await writeJson(jsonPath, dashboard)
    await ensureDirectory(path.dirname(markdownPath))
    await fs.writeFile(markdownPath, markdown, "utf8")
    writeResult = {
      jsonPath,
      markdownPath,
      jsonRelativePath: projectRelative(projectPath, jsonPath),
      markdownRelativePath: projectRelative(projectPath, markdownPath),
      records: 1,
    }
  }
  return {
    schema: "trading-hypothesis-dashboard-run-v1",
    mode: "hypothesis-dashboard-data",
    projectPath,
    dryRun,
    dashboard,
    markdown,
    writeResult,
    summary: {
      sourcesScanned: 0,
      matchedHypotheses: 0,
      eventsWritten: 0,
      alertsWritten: 0,
      dashboardJson: writeResult?.jsonRelativePath ?? null,
      dashboardMarkdown: writeResult?.markdownRelativePath ?? null,
      wroteWiki: false,
      wroteRaw: false,
      wroteRealTrade: false,
    },
  }
}
