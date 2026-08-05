import fs from "node:fs/promises"
import path from "node:path"

import {
  fetchDailyLoopExternalMarketMetrics,
  fetchDailyLoopStockMetrics,
  mergeDailyLoopMarketMetrics,
  parseDailyLoopMarketValidateMode,
  validationAnchorFromPrediction,
} from "./ask-market.mjs"

import {
  applySelfQuestionPolicyRegressionPatchCandidate,
  brainDir,
  brainFileForType,
  collectSelfQuestionEvidenceTasks,
  collectSelfQuestionPolicyRegressionFeedback,
  executeSelfQuestionPolicyRegressions,
  exportSelfQuestionPolicyRegressionPatchCandidates,
  exportSelfQuestionPolicyRegressions,
  listSelfTrainingActions,
  listActiveSelfQuestionPolicies,
  planSelfTrainingActions,
  proposeSelfQuestionPolicyRegressionRemediations,
  proposeSelfQuestionPolicies,
  readBrainRecords,
  runSelfTraining,
  validationResult,
  verifySelfTrainingPlans,
} from "./brain-memory.mjs"

import {
  DEFAULT_PROJECT_PATH,
  appendJsonl,
  ensureDirectory,
  normalizePath,
  normalizeStockCode,
  nowLocalTimestamp,
  parsePositiveInteger,
  projectRelative,
  safeErrorMessage,
  shortHash,
} from "./core.mjs"

import {
  findDailyLoopDuplicateQuestion,
  exportTrainingSamples,
  getRecursiveAiPhaseStatus,
  loadDailyLoopRecentCorpus,
  loadDailyLoopStockUniverse,
  parseTrainingSampleQualityGate,
  parseDailyLoopMode,
  parseDailyLoopWindows,
  planDailyLoopQuestions,
  scoreDailyLoopThemes,
  selectDailyLoopThemeStocks,
  validationRecordFromDailyMetric,
  verifyTrainingSampleExports,
} from "./daily-loop.mjs"
import { writeSelfQuestionCompound } from "./compound-feedback.mjs"

export const SELF_QUESTION_SCHEMA = "self-question-v1"
export const SELF_QUESTION_VALIDATION_METHOD = "self_question_market_feedback_v1"
export const SELF_QUESTION_ATTRIBUTION_SCHEMA = "self-question-attribution-v1"
export const SELF_QUESTION_ATTRIBUTION_METHOD = "self_question_attribution_v1"
export const SELF_QUESTION_LOOP_DEFAULT_STAGES = ["generate", "validate", "attribute", "self-train"]

export function parseSelfQuestionLoopStages(value) {
  const raw = Array.isArray(value)
    ? value
    : String(value ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
  const aliases = new Map([
    ["question", "generate"],
    ["questions", "generate"],
    ["validation", "validate"],
    ["attribution", "attribute"],
    ["train", "self-train"],
    ["selftrain", "self-train"],
    ["self-training", "self-train"],
    ["training-plan", "self-train-plan"],
    ["train-plan", "self-train-plan"],
    ["self-training-plan", "self-train-plan"],
    ["self_training_plan", "self-train-plan"],
    ["self-train-plans", "self-train-plan"],
    ["self-training-plans", "self-train-plan"],
    ["training-plan-verify", "self-train-plan-verify"],
    ["training-plan-verification", "self-train-plan-verify"],
    ["train-plan-verify", "self-train-plan-verify"],
    ["self-training-plan-verify", "self-train-plan-verify"],
    ["self_training_plan_verify", "self-train-plan-verify"],
    ["self-training-plan-verification", "self-train-plan-verify"],
    ["verify-training-plan", "self-train-plan-verify"],
    ["verify-self-training-plan", "self-train-plan-verify"],
    ["evidence-tasks", "evidence"],
    ["evidence_task", "evidence"],
    ["evidence_tasks", "evidence"],
    ["policies", "policy"],
    ["policy-proposals", "policy"],
    ["policy_proposals", "policy"],
    ["policy-regressions", "policy-regression"],
    ["policy_regressions", "policy-regression"],
    ["regression", "policy-regression"],
    ["regressions", "policy-regression"],
    ["policy-regression-execution", "policy-regression-execute"],
    ["policy_regression_execution", "policy-regression-execute"],
    ["policy-regression-executions", "policy-regression-execute"],
    ["policy_regression_executions", "policy-regression-execute"],
    ["policy_regression_execute", "policy-regression-execute"],
    ["regression-execute", "policy-regression-execute"],
    ["regression-execution", "policy-regression-execute"],
    ["policy-regression-feedback", "policy-regression-feedback"],
    ["policy_regression_feedback", "policy-regression-feedback"],
    ["regression-feedback", "policy-regression-feedback"],
    ["regression_failures", "policy-regression-feedback"],
    ["regression-failures", "policy-regression-feedback"],
    ["policy-regression-remediation", "policy-regression-remediation"],
    ["policy_regression_remediation", "policy-regression-remediation"],
    ["policy-regression-remediate", "policy-regression-remediation"],
    ["regression-remediation", "policy-regression-remediation"],
    ["regression-remediate", "policy-regression-remediation"],
    ["regression-fixes", "policy-regression-remediation"],
    ["policy-regression-patches", "policy-regression-patches"],
    ["policy_regression_patches", "policy-regression-patches"],
    ["regression-patches", "policy-regression-patches"],
    ["patch-candidates", "policy-regression-patches"],
    ["regression-patch-candidates", "policy-regression-patches"],
    ["policy-regression-apply", "policy-regression-apply"],
    ["policy_regression_apply", "policy-regression-apply"],
    ["policy-regression-patch-apply", "policy-regression-apply"],
    ["policy_regression_patch_apply", "policy-regression-apply"],
    ["regression-patch-apply", "policy-regression-apply"],
    ["apply-patches", "policy-regression-apply"],
    ["policy-regression-verify", "policy-regression-verify"],
    ["policy_regression_verify", "policy-regression-verify"],
    ["policy-regression-verification", "policy-regression-verify"],
    ["policy-regression-post-apply", "policy-regression-verify"],
    ["post-apply-regression", "policy-regression-verify"],
    ["post-apply-regressions", "policy-regression-verify"],
    ["regression-verify", "policy-regression-verify"],
    ["verify-regressions", "policy-regression-verify"],
    ["gate-events", "gate-event"],
    ["gate_summary_event", "gate-event"],
    ["gate-summary-event", "gate-event"],
    ["gate_summary_events", "gate-event"],
    ["gate-summary-events", "gate-event"],
    ["policy-regression-gate-event", "gate-event"],
    ["policy_regression_gate_event", "gate-event"],
    ["policy-regression-gate-events", "gate-event"],
    ["policy_regression_gate_events", "gate-event"],
    ["samples", "export"],
    ["exports", "export"],
    ["sample-verify", "export-verify"],
    ["sample_verify", "export-verify"],
    ["samples-verify", "export-verify"],
    ["samples_verify", "export-verify"],
    ["export_verify", "export-verify"],
    ["exports-verify", "export-verify"],
    ["exports_verify", "export-verify"],
    ["verify-exports", "export-verify"],
    ["verify_exports", "export-verify"],
  ])
  const stages = (raw.length > 0 ? raw : SELF_QUESTION_LOOP_DEFAULT_STAGES)
    .map((stage) => aliases.get(String(stage).trim().toLowerCase()) ?? String(stage).trim().toLowerCase())
    .filter(Boolean)
  const allowed = new Set(["generate", "validate", "attribute", "evidence", "policy", "policy-regression", "policy-regression-execute", "policy-regression-feedback", "policy-regression-remediation", "policy-regression-patches", "policy-regression-apply", "policy-regression-verify", "gate-event", "self-train", "self-train-plan", "self-train-plan-verify", "export", "export-verify"])
  const invalid = stages.filter((stage) => !allowed.has(stage))
  if (invalid.length > 0) throw new Error(`Unknown self-question loop stage(s): ${invalid.join(", ")}`)
  return [...new Set(stages)]
}

export function parseSelfQuestionExportKinds(value) {
  const kinds = (Array.isArray(value) ? value : String(value ?? "eval").split(","))
    .map((item) => String(item).trim().toLowerCase())
    .filter(Boolean)
  const allowed = new Set(["sft", "preference", "eval"])
  const invalid = kinds.filter((kind) => !allowed.has(kind))
  if (invalid.length > 0) throw new Error(`Unknown export kind(s): ${invalid.join(", ")}`)
  return [...new Set(kinds.length > 0 ? kinds : ["eval"])]
}

export function compactSelfQuestionStock(stock = {}) {
  return {
    name: stock.name,
    code: stock.code,
    path: stock.path,
    branch: stock.branch,
    matchedKeywords: (stock.matchedKeywords ?? []).slice(0, 8),
    metric: stock.metric ?? null,
  }
}

export function buildSelfQuestionHypothesis(question) {
  const branch = question.branch ?? "未命名细分"
  const move = question.expectedMove === "bearish" ? "可能被过度反映或需要降级" : "可能存在预期差或待验证机会"
  return `${branch}${move}，需要用量价、公告、订单/招投标和财报线索验证。`
}

export function compactActiveSelfQuestionPolicy(policy = {}) {
  return {
    policyId: policy.policyId ?? policy.id ?? null,
    scope: policy.scope ?? null,
    rule: policy.rule ?? null,
    trigger: policy.trigger ?? null,
    evidenceGap: policy.evidenceGap ?? null,
    proposedPolicy: policy.proposedPolicy ?? null,
    sourceProposalId: policy.sourceProposalId ?? null,
    regressionQuestions: Array.isArray(policy.regressionQuestions) ? policy.regressionQuestions.slice(0, 5) : [],
    regressionAssertions: policy.regressionAssertions ?? null,
    promptGuardrails: Array.isArray(policy.promptGuardrails) ? policy.promptGuardrails.slice(0, 5) : [],
    revision: policy.revision ?? null,
    approvedAt: policy.approvedAt ?? policy.createdAt ?? null,
  }
}

export function selfQuestionRecordFromDailyQuestion({ runId, question, createdAt, validationWindows }) {
  const windows = parseDailyLoopWindows(question.validationWindows ?? validationWindows)
  const stockRefs = (question.stocks ?? []).map((stock) => stock.path).filter(Boolean)
  return {
    schema: SELF_QUESTION_SCHEMA,
    id: `selfq_${shortHash(`${createdAt}:${question.question}:${(question.stocks ?? []).map((stock) => stock.code).join(",")}`)}`,
    type: "question",
    kind: "self-question",
    runId,
    questionId: question.id,
    questionType: question.type,
    theme: question.themeId ?? null,
    segment: question.branch ?? null,
    branch: question.branch ?? null,
    question: question.question,
    hypothesis: question.hypothesis ?? buildSelfQuestionHypothesis(question),
    expectedMove: question.expectedMove ?? "observe",
    validationWindows: windows.map((days) => `${days}d`),
    marketSignals: [
      "relative_strength",
      "turnover_expansion",
      "volume_price_confirmed",
      "segment_pool_divergence",
    ],
    fundamentalSignals: [
      "cninfo_announcement",
      "qcc_tender_or_order",
      "shipment_or_delivery",
      "revenue_and_margin",
    ],
    disconfirmIf: [
      "no_order_or_announcement_evidence",
      "price_only_without_fundamental_confirmation",
      "segment_pool_underperforms_broader_theme",
      "market_validation_failed",
    ],
    expectedOutput: "结论/证据链/分歧/反证/后续验证/交易含义/引用来源",
    stocks: (question.stocks ?? []).map(compactSelfQuestionStock),
    sourceRefs: [...new Set(stockRefs)],
    status: "planned",
    createdAt,
  }
}

export function isSelfQuestionRecord(record) {
  return record?.schema === SELF_QUESTION_SCHEMA || record?.kind === "self-question" || record?.type === "question"
}

export function isSelfQuestionValidationRecord(record) {
  return (
    record?.validationMethod === SELF_QUESTION_VALIDATION_METHOD ||
    record?.kind === "self-question-market-validation" ||
    (record?.type === "validation" && record?.targetType === "self-question")
  )
}

export function isActionableSelfQuestionValidationRecord(record) {
  if (!isSelfQuestionValidationRecord(record)) return false
  const marketStatus = String(record?.marketValidation?.status ?? record?.status ?? "").trim().toLowerCase()
  const rawResult = String(record?.result ?? record?.validationResult ?? record?.verdict ?? record?.marketValidation?.verdict ?? "").trim().toLowerCase()
  const nonActionable = new Set(["insufficient", "not_due", "no_rows", "missing", "unavailable", "skipped", "error"])
  if (nonActionable.has(marketStatus) || nonActionable.has(rawResult) || /证据不足/.test(rawResult)) return false
  if (["validated", "ready", "ok", "confirmed"].includes(marketStatus)) return true
  return ["success", "failure", "uncertain"].includes(validationResult(record))
}

export function isSelfQuestionAttributionRecord(record) {
  return (
    record?.schema === SELF_QUESTION_ATTRIBUTION_SCHEMA ||
    record?.attributionMethod === SELF_QUESTION_ATTRIBUTION_METHOD ||
    record?.kind === "self-question-attribution"
  )
}

export function selfQuestionMatchesId(record, id) {
  const needle = String(id ?? "").trim()
  if (!needle) return true
  return [record?.id, record?.questionId, record?.runId].some((value) => String(value ?? "") === needle)
}

export function selfQuestionValidationMatchesId(record, id) {
  const needle = String(id ?? "").trim()
  if (!needle) return true
  return [record?.id, record?.questionRecordId, record?.questionId, record?.sourceRunId, record?.runId].some((value) => String(value ?? "") === needle)
}

export function selfQuestionValidationKey({ questionRecordId, questionId, stockCode, windowDays }) {
  const questionKey = String(questionRecordId ?? questionId ?? "").trim()
  const stockKey = normalizeStockCode(stockCode)
  const windowKey = parsePositiveInteger(windowDays, null)
  if (!questionKey || !stockKey || !windowKey) return null
  return `${questionKey}:${stockKey}:${windowKey}`
}

export function allowAnchoredExternalMarket(options = {}) {
  const value = options.allowAnchoredExternalMarket ?? options["allow-anchored-external-market"] ?? options.anchoredExternalMarket ?? options["anchored-external-market"]
  if (typeof value === "boolean") return value
  const raw = String(value ?? "").trim().toLowerCase()
  return ["1", "true", "yes", "on"].includes(raw)
}

export function normalizeSelfQuestionStocks(question, maxStocks) {
  const limit = parsePositiveInteger(maxStocks, 6)
  const seen = new Set()
  const stocks = []
  for (const stock of Array.isArray(question?.stocks) ? question.stocks : []) {
    const code = normalizeStockCode(stock?.code)
    if (!code || seen.has(code)) continue
    seen.add(code)
    stocks.push({
      ...stock,
      code,
      name: stock?.name ?? code,
      branch: stock?.branch ?? question.branch ?? question.segment ?? null,
    })
    if (stocks.length >= limit) break
  }
  return stocks
}

export function validationRecordFromSelfQuestionMetric({ question, stock, metric, windowDays, priorWindowDays = [] }) {
  const base = validationRecordFromDailyMetric({
    prediction: {
      id: question.id,
      expectedMove: question.expectedMove,
      branch: question.branch ?? question.segment ?? question.theme,
      createdAt: question.createdAt,
    },
    stock,
    metric,
    windowDays,
    priorWindowDays,
  })
  const fundamentalSignals = Array.isArray(question.fundamentalSignals) ? question.fundamentalSignals.filter(Boolean) : []
  const evidenceGaps = fundamentalSignals.map((signal) => `fundamental:${signal}:not_checked`)
  const questionRecordId = question.id
  const questionId = question.questionId ?? question.id
  return {
    ...base,
    id: `brain_validation_${shortHash(`${questionRecordId}:${stock.code}:${windowDays}:${metric?.startDate ?? ""}:${metric?.endDate ?? ""}`)}`,
    kind: "self-question-market-validation",
    validationMethod: SELF_QUESTION_VALIDATION_METHOD,
    questionRecordId,
    questionId,
    sourceRunId: question.runId ?? null,
    question: question.question,
    hypothesis: question.hypothesis ?? null,
    expectedMove: question.expectedMove ?? "observe",
    target: question.branch ?? question.segment ?? question.theme ?? question.question,
    targetType: "self-question",
    sourceRefs: question.sourceRefs ?? [],
    evidenceGaps,
    evidenceStatus: {
      market: metric?.status === "ok" ? "checked" : "insufficient",
      fundamentals: Object.fromEntries(fundamentalSignals.map((signal) => [signal, "not_checked"])),
    },
    marketValidation: {
      ...base.marketValidation,
      validationMethod: SELF_QUESTION_VALIDATION_METHOD,
      questionRecordId,
      questionId,
    },
    horizonTrackKey: `${questionRecordId}:${stock.code}`,
  }
}

export function classifySelfQuestionValidationAttribution(validation) {
  const result = validationResult(validation)
  const evidenceGaps = Array.isArray(validation?.evidenceGaps) ? validation.evidenceGaps.filter(Boolean) : []
  const marketStatus = String(validation?.marketValidation?.status ?? "").toLowerCase()
  if (result === "success" && evidenceGaps.length === 0) {
    return {
      attributionLabel: "confirmed",
      confidenceImpact: "upgrade",
      nextAction: "promote_hypothesis",
      attributionReason: "量价反馈与假设一致，且没有记录中的基本面证据缺口。",
    }
  }
  if (result === "success") {
    return {
      attributionLabel: "price_only",
      confidenceImpact: "positive_but_unconfirmed",
      nextAction: "verify_fundamentals",
      attributionReason: "量价反馈支持假设，但公告、招投标、订单或财报闭环仍存在未验证缺口。",
    }
  }
  if (result === "failure") {
    return {
      attributionLabel: "disconfirmed",
      confidenceImpact: "downgrade",
      nextAction: "rewrite_or_downgrade_hypothesis",
      attributionReason: "市场反馈与原假设方向冲突，应降级或重写假设。",
    }
  }
  if (marketStatus === "ready") {
    return {
      attributionLabel: "divergent",
      confidenceImpact: "neutral",
      nextAction: "extend_window_or_compare_segment",
      attributionReason: "已有量价反馈但未达到明确验证阈值，需要延长窗口或比较细分候选池。",
    }
  }
  return {
    attributionLabel: "insufficient",
    confidenceImpact: "unknown",
    nextAction: "collect_more_evidence",
    attributionReason: "当前市场或基本面证据不足，不能归因为兑现或证伪。",
  }
}

export function attributionRecordFromSelfQuestionValidation(validation) {
  const classified = classifySelfQuestionValidationAttribution(validation)
  return {
    schema: SELF_QUESTION_ATTRIBUTION_SCHEMA,
    id: `selfqa_${shortHash(`${validation.id}:${classified.attributionLabel}`)}`,
    type: "attribution",
    kind: "self-question-attribution",
    attributionMethod: SELF_QUESTION_ATTRIBUTION_METHOD,
    validationId: validation.id,
    questionRecordId: validation.questionRecordId ?? null,
    questionId: validation.questionId ?? null,
    sourceRunId: validation.sourceRunId ?? validation.runId ?? null,
    question: validation.question ?? null,
    hypothesis: validation.hypothesis ?? null,
    target: validation.target ?? validation.branch ?? validation.segment ?? validation.question ?? null,
    stockName: validation.stockName ?? null,
    stockCode: validation.stockCode ?? null,
    windowDays: validation.windowDays ?? validation.marketValidation?.lookbackDays ?? null,
    verdict: validation.verdict ?? validation.result ?? null,
    result: validationResult(validation),
    reason: validation.reason ?? null,
    evidenceGaps: validation.evidenceGaps ?? [],
    marketValidation: validation.marketValidation ?? null,
    sourceRefs: validation.sourceRefs ?? [],
    validationCreatedAt: validation.createdAt ?? null,
    createdAt: nowLocalTimestamp(),
    ...classified,
  }
}

export async function loadRecentSelfQuestionHistory(projectPath, limit = 48) {
  const records = await readBrainRecords(projectPath)
  return records
    .map((item) => item.value)
    .filter((record) => record?.schema === SELF_QUESTION_SCHEMA || record?.kind === "self-question" || record?.type === "question")
    .filter((record) => record.question)
    .sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")))
    .slice(0, limit)
    .map((record) => ({
      runId: record.runId ?? null,
      createdAt: record.createdAt ?? null,
      questionType: record.questionType ?? null,
      branch: record.branch ?? record.segment ?? null,
      question: record.question,
    }))
}

export function filterNovelSelfQuestions(questions, recentQuestions, questionCount) {
  const accepted = []
  const duplicates = []
  for (const question of questions) {
    if (accepted.length >= questionCount) break
    const duplicate =
      findDailyLoopDuplicateQuestion(question, recentQuestions) ??
      findDailyLoopDuplicateQuestion(question, accepted.map((item) => ({
        question: item.question,
        branch: item.branch,
        questionType: item.type,
      })))
    if (duplicate) {
      duplicates.push({ question: question.question, branch: question.branch, score: duplicate.score, previous: duplicate.previous })
      continue
    }
    accepted.push(question)
  }
  return { questions: accepted, duplicates }
}

export async function validateSelfQuestions(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const id = String(options.id ?? options.questionId ?? "").trim()
  const maxQuestions = parsePositiveInteger(options.maxQuestions ?? options["max-questions"], 6)
  const maxStocksPerQuestion = parsePositiveInteger(options.maxStocksPerQuestion ?? options["max-stocks-per-question"], 6)
  const records = (await readBrainRecords(projectPath)).map((item) => item.value).filter((item) => item && typeof item === "object" && !Array.isArray(item))
  const inlineQuestions = Array.isArray(options.questionRecords) ? options.questionRecords.filter((item) => item && typeof item === "object" && !Array.isArray(item)) : []
  const questionRecords = inlineQuestions.length > 0 ? inlineQuestions : records
  const questions = questionRecords
    .filter(isSelfQuestionRecord)
    .filter((record) => record.status !== "closed")
    .filter((record) => selfQuestionMatchesId(record, id))
    .sort((a, b) => String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")))
  const selectedQuestions = id ? questions : questions.slice(-maxQuestions)
  const existingKeys = new Set(
    records
      .filter(isSelfQuestionValidationRecord)
      .filter(isActionableSelfQuestionValidationRecord)
      .map((record) =>
        selfQuestionValidationKey({
          questionRecordId: record.questionRecordId,
          questionId: record.questionId ?? record.predictionId,
          stockCode: record.stockCode,
          windowDays: record.windowDays,
        }),
      )
      .filter(Boolean),
  )

  const validationStats = {
    questions: selectedQuestions.length,
    tasks: 0,
    existing: 0,
    notDue: 0,
    skippedNoStocks: 0,
  }
  const validationTasks = []
  for (const question of selectedQuestions) {
    const stocks = normalizeSelfQuestionStocks(question, maxStocksPerQuestion)
    if (stocks.length === 0) {
      validationStats.skippedNoStocks += 1
      continue
    }
    const windows = parseDailyLoopWindows(options.validationWindows ?? options["validation-windows"] ?? question.validationWindows)
    const anchor = validationAnchorFromPrediction(question)
    for (const windowDays of windows) {
      const priorWindowDays = windows.filter((item) => item < windowDays)
      for (const stock of stocks) {
        const key = selfQuestionValidationKey({ questionRecordId: question.id, questionId: question.questionId, stockCode: stock.code, windowDays })
        if (existingKeys.has(key)) {
          validationStats.existing += 1
          continue
        }
        validationStats.tasks += 1
        validationTasks.push({ question, stock, windowDays, priorWindowDays, anchor })
      }
    }
  }

  const validations = []
  const groupedTasks = new Map()
  for (const task of validationTasks) {
    const key = `${task.anchor?.date ?? ""}:${task.anchor?.exclusive ? "1" : "0"}:${task.windowDays}`
    if (!groupedTasks.has(key)) groupedTasks.set(key, [])
    groupedTasks.get(key).push(task)
  }

  const sqlRuns = []
  const externalRuns = []
  for (const tasks of groupedTasks.values()) {
    const { anchor, windowDays } = tasks[0]
    const stocksForQuery = [...new Map(tasks.map((task) => [task.stock.code, task.stock])).values()]
    const metricResult = await fetchDailyLoopStockMetrics(stocksForQuery, {
      ...options,
      stockLookbackDays: windowDays,
      lookbackDays: windowDays,
      requiredRows: windowDays,
      validationAnchorDate: anchor?.date,
      validationAnchorExclusive: anchor?.exclusive,
    })
    const externalMarketResult = anchor && !allowAnchoredExternalMarket(options)
      ? { source: "off", status: "skipped", metrics: new Map(), okCount: 0, total: stocksForQuery.length, warning: "anchored self-question validation uses stock SQL only" }
      : await fetchDailyLoopExternalMarketMetrics(stocksForQuery, { ...options, stockLookbackDays: windowDays, lookbackDays: windowDays })
    const marketMetrics = mergeDailyLoopMarketMetrics(stocksForQuery, metricResult.metrics, externalMarketResult.metrics)
    sqlRuns.push({
      status: metricResult.status,
      warning: metricResult.warning ?? null,
      nativeQuery: metricResult.nativeQuery
        ? {
            language: metricResult.nativeQuery.language,
            summary: metricResult.nativeQuery.summary,
            table: metricResult.nativeQuery.table,
            limit: metricResult.nativeQuery.limit,
            tickerCount: metricResult.nativeQuery.normalizedCodes?.length ?? 0,
            validationAnchorDate: metricResult.nativeQuery.validationAnchorDate ?? null,
          }
        : null,
    })
    externalRuns.push({
      source: externalMarketResult.source ?? "off",
      status: externalMarketResult.status,
      okCount: externalMarketResult.okCount ?? 0,
      total: externalMarketResult.total ?? stocksForQuery.length,
      warning: externalMarketResult.warning ?? null,
    })
    for (const task of tasks) {
      const metric = marketMetrics.get(task.stock.code) ?? metricResult.metrics.get(task.stock.code) ?? { status: metricResult.status, warning: metricResult.warning }
      if (metric.status === "not_due") {
        validationStats.notDue += 1
        continue
      }
      validations.push(validationRecordFromSelfQuestionMetric({
        question: task.question,
        stock: task.stock,
        metric,
        windowDays: task.windowDays,
        priorWindowDays: task.priorWindowDays,
      }))
    }
  }

  const dryRun = !options.write
  let writeResult = null
  if (!dryRun && validations.length > 0) {
    const filePath = path.join(brainDir(projectPath), brainFileForType("validation"))
    await ensureDirectory(path.dirname(filePath))
    for (const validation of validations) await appendJsonl(filePath, validation)
    writeResult = { filePath, relativePath: projectRelative(projectPath, filePath), records: validations.length }
  }
  const generatedAt = nowLocalTimestamp()

  return {
    schema: "self-question-validation-run-v1",
    mode: "self-question-validate",
    runId: `self_question_validate_${generatedAt.replace(/[-: ]/g, "").slice(0, 14)}`,
    generatedAt,
    projectPath,
    dryRun,
    counts: {
      questions: selectedQuestions.length,
      validationTasks: validationStats.tasks,
      validations: validations.length,
      existing: validationStats.existing,
      notDue: validationStats.notDue,
      skippedNoStocks: validationStats.skippedNoStocks,
    },
    sql: {
      status: sqlRuns.length === 0 ? "skipped" : sqlRuns.some((run) => run.status === "ok") ? "ok" : sqlRuns[0].status,
      runs: sqlRuns,
    },
    marketValidation: {
      mode: parseDailyLoopMarketValidateMode(options.marketValidate ?? options.marketValidation ?? options.externalMarket),
      runs: externalRuns,
    },
    questions: selectedQuestions.map((question) => ({
      id: question.id,
      questionId: question.questionId ?? null,
      runId: question.runId ?? null,
      branch: question.branch ?? question.segment ?? null,
      question: question.question,
      stocks: normalizeSelfQuestionStocks(question, maxStocksPerQuestion).map(({ name, code, path, branch }) => ({ name, code, path, branch })),
    })),
    validations,
    writeResult,
  }
}

export async function attributeSelfQuestionValidations(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const id = String(options.id ?? options.validationId ?? options.questionId ?? "").trim()
  const maxValidations = parsePositiveInteger(options.maxValidations ?? options["max-validations"], 20)
  const records = (await readBrainRecords(projectPath)).map((item) => item.value).filter((item) => item && typeof item === "object" && !Array.isArray(item))
  const inlineValidations = Array.isArray(options.validationRecords) ? options.validationRecords.filter((item) => item && typeof item === "object" && !Array.isArray(item)) : []
  const validationRecords = inlineValidations.length > 0 ? inlineValidations : records
  const validations = validationRecords
    .filter(isSelfQuestionValidationRecord)
    .filter((record) => selfQuestionValidationMatchesId(record, id))
    .sort((a, b) => String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")))
  const selectedValidations = id ? validations : validations.slice(-maxValidations)
  const existingValidationIds = new Set(
    records
      .filter(isSelfQuestionAttributionRecord)
      .map((record) => String(record.validationId ?? "").trim())
      .filter(Boolean),
  )
  const attributions = []
  let existing = 0
  for (const validation of selectedValidations) {
    const validationId = String(validation.id ?? "").trim()
    if (validationId && existingValidationIds.has(validationId)) {
      existing += 1
      continue
    }
    attributions.push(attributionRecordFromSelfQuestionValidation(validation))
  }

  const dryRun = !options.write
  let writeResult = null
  if (!dryRun && attributions.length > 0) {
    const filePath = path.join(brainDir(projectPath), brainFileForType("attribution"))
    await ensureDirectory(path.dirname(filePath))
    for (const attribution of attributions) await appendJsonl(filePath, attribution)
    writeResult = { filePath, relativePath: projectRelative(projectPath, filePath), records: attributions.length }
  }
  const generatedAt = nowLocalTimestamp()
  return {
    schema: "self-question-attribution-run-v1",
    mode: "self-question-attribute",
    runId: `self_question_attribute_${generatedAt.replace(/[-: ]/g, "").slice(0, 14)}`,
    generatedAt,
    projectPath,
    dryRun,
    counts: {
      validations: selectedValidations.length,
      attributions: attributions.length,
      existing,
    },
    attributions,
    writeResult,
  }
}

export function compactSelfQuestionLoopStage(stage, status, result = null) {
  let counts = result?.counts ?? {}
  let output = null
  let verdict = null
  if (stage === "generate" || stage === "validate" || stage === "attribute" || stage === "evidence") {
    output = result?.writeResult?.relativePath ?? null
  }
  if (stage === "policy") output = result?.writeResult?.relativePath ?? null
  if (stage === "policy-regression") output = result?.writeResult?.relativePath ?? null
  if (stage === "policy-regression-execute") {
    counts = {
      cases: result?.counts?.cases ?? 0,
      planned: result?.counts?.planned ?? 0,
      completed: result?.counts?.completed ?? 0,
      failed: result?.counts?.failed ?? 0,
      timedOut: result?.counts?.timedOut ?? 0,
      evaluationPassed: result?.evaluation?.counts?.passed ?? 0,
      evaluationFailed: result?.evaluation?.counts?.failed ?? 0,
      evaluationSkipped: result?.evaluation?.counts?.skipped ?? 0,
    }
    output = result?.writeResult?.relativePath ?? null
    verdict = result?.verdict ?? null
  }
  if (stage === "policy-regression-feedback") {
    counts = {
      feedbackItems: result?.counts?.feedbackItems ?? 0,
      commandFailures: result?.counts?.commandFailures ?? 0,
      assertionFailures: result?.counts?.assertionFailures ?? 0,
      skippedCases: result?.counts?.skippedCases ?? 0,
    }
    output = result?.writeResult?.relativePath ?? null
  }
  if (stage === "policy-regression-remediation") {
    counts = {
      remediationProposals: result?.counts?.remediationProposals ?? 0,
      feedbackItems: result?.counts?.feedbackItems ?? 0,
      byRemediationType: result?.counts?.byRemediationType ?? {},
    }
    output = result?.writeResult?.relativePath ?? null
  }
  if (stage === "policy-regression-patches") {
    counts = {
      approvedReviewEvents: result?.counts?.approvedReviewEvents ?? 0,
      patchCandidates: result?.counts?.patchCandidates ?? 0,
      byPatchTarget: result?.counts?.byPatchTarget ?? {},
    }
    output = result?.writeResult?.relativePath ?? null
  }
  if (stage === "policy-regression-apply") {
    counts = {
      patchCandidates: result?.patchCandidate ? 1 : 0,
      activePolicyRevisions: result?.activePolicyRevision ? 1 : 0,
      applyEvents: result?.applyEvent ? 1 : 0,
      wrotePolicies: result?.writeResult?.policy?.records ?? 0,
      wroteEvents: result?.writeResult?.event?.records ?? 0,
      alreadyApplied: result?.alreadyApplied ? 1 : 0,
    }
    output = {
      policy: result?.writeResult?.policy?.relativePath ?? null,
      event: result?.writeResult?.event?.relativePath ?? null,
    }
  }
  if (stage === "policy-regression-verify") {
    counts = {
      cases: result?.counts?.cases ?? 0,
      executions: result?.counts?.executions ?? 0,
      planned: result?.counts?.planned ?? 0,
      completed: result?.counts?.completed ?? 0,
      failed: result?.counts?.failed ?? 0,
      timedOut: result?.counts?.timedOut ?? 0,
      evaluationPassed: result?.counts?.evaluationPassed ?? 0,
      evaluationFailed: result?.counts?.evaluationFailed ?? 0,
      evaluationSkipped: result?.counts?.evaluationSkipped ?? 0,
    }
    output = {
      regressions: result?.regressionRun?.writeResult?.relativePath ?? null,
      executions: result?.executionRun?.writeResult?.relativePath ?? null,
    }
    verdict = result?.verdict ?? null
  }
  if (stage === "gate-event") {
    counts = {
      gateResults: result?.counts?.gateResults ?? 0,
      events: result?.counts?.events ?? 0,
    }
    output = result?.writeResult?.relativePath ?? null
  }
  if (stage === "self-train-plan") {
    counts = {
      actions: result?.counts?.actions ?? 0,
      steps: result?.counts?.steps ?? 0,
      byRule: result?.counts?.byRule ?? {},
      byStepType: result?.counts?.byStepType ?? {},
    }
    output = result?.writeResult?.relativePath ?? null
  }
  if (stage === "self-train-plan-verify") {
    counts = {
      checked: result?.checked ?? 0,
      passed: result?.passed ?? 0,
      failed: result?.failed ?? 0,
      issues: result?.issueCount ?? 0,
    }
    output = {
      plans: (result?.plans ?? []).map((plan) => ({
        status: plan.status,
        relativePath: plan.relativePath,
        actionCount: plan.actionCount,
        stepCount: plan.stepCount,
        issues: plan.issues,
      })),
    }
    verdict = result?.verdict ?? null
  }
  if (stage === "export-verify") {
    counts = {
      checked: result?.checked ?? 0,
      passed: result?.passed ?? 0,
      failed: result?.failed ?? 0,
      issues: result?.issueCount ?? 0,
      concurrency: result?.concurrency ?? 0,
      totalEntries: result?.totalEntries ?? 0,
      filteredEntries: result?.filteredEntries ?? 0,
    }
    output = {
      ledger: result?.ledgerRelativePath ?? null,
      entries: (result?.entries ?? []).map((entry) => ({
        status: entry.status,
        kind: entry.kind,
        qualityGate: entry.qualityGate,
        outputs: entry.outputs,
        issues: entry.issues,
      })),
    }
    verdict = result?.verdict ?? null
  }
  const summary = {
    stage,
    status,
    counts,
    output,
  }
  if (verdict) summary.verdict = verdict
  return summary
}

function policyRegressionVerificationVerdict(executionRun = {}) {
  const counts = executionRun?.counts ?? {}
  const evaluationCounts = executionRun?.evaluation?.counts ?? {}
  const commandFailures = (counts.failed ?? 0) + (counts.timedOut ?? 0)
  const evaluationFailed = evaluationCounts.failed ?? 0
  const evaluationSkipped = evaluationCounts.skipped ?? 0

  if (!executionRun?.execute) {
    return {
      status: "planned",
      reason: "verification planned; pass --execute-policy-regressions to run cases",
      nextStages: ["policy-regression-verify"],
      commandFailures,
      evaluationFailed,
      evaluationSkipped,
    }
  }
  if (commandFailures > 0) {
    return {
      status: "needs_remediation",
      reason: "verification command failures or timeouts",
      nextStages: ["policy-regression-feedback", "policy-regression-remediation"],
      commandFailures,
      evaluationFailed,
      evaluationSkipped,
    }
  }
  if (evaluationFailed + evaluationSkipped > 0) {
    return {
      status: "needs_remediation",
      reason: "verification assertions failed or were skipped",
      nextStages: ["policy-regression-feedback", "policy-regression-remediation"],
      commandFailures,
      evaluationFailed,
      evaluationSkipped,
    }
  }
  return {
    status: "passed",
    reason: "verification executed and all evaluated assertions passed",
    nextStages: [],
    commandFailures: 0,
    evaluationFailed: 0,
    evaluationSkipped: 0,
  }
}

function policyRegressionVerificationStageStatus(verdict = {}) {
  if (verdict.status === "planned") return "planned"
  if (verdict.status === "needs_remediation") return "needs_remediation"
  return "ok"
}

function policyRegressionExecutionStageStatus(verdict = {}) {
  if (verdict.status === "planned") return "planned"
  if (verdict.status === "needs_remediation") return "needs_remediation"
  return "ok"
}

function trainingExportVerificationVerdict(result = {}) {
  const failed = result?.failed ?? 0
  const issueCount = result?.issueCount ?? 0
  if (failed > 0 || issueCount > 0) {
    return {
      status: "needs_remediation",
      reason: "training export integrity check found missing or inconsistent files",
      nextStages: ["export", "export-verify"],
      trainingExportFailures: failed,
      trainingExportIssues: issueCount,
      commandFailures: failed,
      evaluationFailed: issueCount,
      evaluationSkipped: 0,
    }
  }
  if ((result?.checked ?? 0) === 0) {
    return {
      status: "planned",
      reason: "no training exports were available to verify",
      nextStages: ["export", "export-verify"],
      trainingExportFailures: 0,
      trainingExportIssues: 0,
      commandFailures: 0,
      evaluationFailed: 0,
      evaluationSkipped: 0,
    }
  }
  return {
    status: "passed",
    reason: "training export ledger, jsonl, and manifest integrity verified",
    nextStages: [],
    trainingExportFailures: 0,
    trainingExportIssues: 0,
    commandFailures: 0,
    evaluationFailed: 0,
    evaluationSkipped: 0,
  }
}

function trainingExportVerificationStageStatus(verdict = {}) {
  if (verdict.status === "planned") return "planned"
  if (verdict.status === "needs_remediation") return "needs_remediation"
  return "ok"
}

function selfTrainingPlanVerificationVerdict(result = {}) {
  const failed = result?.failed ?? 0
  const issueCount = result?.issueCount ?? 0
  if (failed > 0 || issueCount > 0) {
    return {
      status: "needs_remediation",
      reason: "self-training plan safety check found unsafe or inconsistent plan artifacts",
      nextStages: ["self-train-plan", "self-train-plan-verify"],
      selfTrainingPlanFailures: failed,
      selfTrainingPlanIssues: issueCount,
      commandFailures: failed,
      evaluationFailed: issueCount,
      evaluationSkipped: 0,
    }
  }
  if ((result?.checked ?? 0) === 0) {
    return {
      status: "planned",
      reason: "no self-training plan artifacts were available to verify",
      nextStages: ["self-train-plan", "self-train-plan-verify"],
      selfTrainingPlanFailures: 0,
      selfTrainingPlanIssues: 0,
      commandFailures: 0,
      evaluationFailed: 0,
      evaluationSkipped: 0,
    }
  }
  return {
    status: "passed",
    reason: "self-training plan safety and count consistency verified",
    nextStages: [],
    selfTrainingPlanFailures: 0,
    selfTrainingPlanIssues: 0,
    commandFailures: 0,
    evaluationFailed: 0,
    evaluationSkipped: 0,
  }
}

function selfTrainingPlanVerificationStageStatus(verdict = {}) {
  if (verdict.status === "planned") return "planned"
  if (verdict.status === "needs_remediation") return "needs_remediation"
  return "ok"
}

function plannedSelfTrainingPlanVerificationRun(projectPath, limit = null) {
  return {
    schema: "self-training-action-plan-verify-v1",
    mode: "self-train-plan-verify",
    projectPath,
    status: "planned",
    checked: 0,
    passed: 0,
    failed: 0,
    issueCount: 0,
    filters: {
      planPath: null,
      limit,
    },
    plans: [],
  }
}

function selfQuestionLoopStatusFromStages(stages = []) {
  if (stages.some((stage) => stage.status === "needs_remediation")) return "needs_remediation"
  if (stages.some((stage) => stage.status === "planned")) return "planned"
  return "ok"
}

function uniqueNonEmptyStrings(values = []) {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))]
}

function selfQuestionLoopGateSummary(stages = []) {
  const results = stages
    .filter((stage) => stage?.verdict?.status)
    .map((stage) => ({
      stage: stage.stage,
      status: stage.verdict.status,
      reason: stage.verdict.reason ?? null,
      nextStages: Array.isArray(stage.verdict.nextStages) ? stage.verdict.nextStages : [],
      commandFailures: stage.verdict.commandFailures ?? 0,
      evaluationFailed: stage.verdict.evaluationFailed ?? 0,
      evaluationSkipped: stage.verdict.evaluationSkipped ?? 0,
      trainingExportFailures: stage.verdict.trainingExportFailures ?? 0,
      trainingExportIssues: stage.verdict.trainingExportIssues ?? 0,
      selfTrainingPlanFailures: stage.verdict.selfTrainingPlanFailures ?? 0,
      selfTrainingPlanIssues: stage.verdict.selfTrainingPlanIssues ?? 0,
    }))
  const actionable = results.filter((item) => item.status === "planned" || item.status === "needs_remediation")
  const status = results.some((item) => item.status === "needs_remediation")
    ? "needs_remediation"
    : results.some((item) => item.status === "planned")
      ? "planned"
      : results.some((item) => item.status === "passed")
        ? "passed"
        : "none"
  return {
    status,
    recommendedNextStages: uniqueNonEmptyStrings(actionable.flatMap((item) => item.nextStages)),
    results,
  }
}

function buildSelfQuestionLoopGateEvents({ gateSummary = {}, runId, createdAt }) {
  return (gateSummary.results ?? [])
    .filter((result) => result?.status === "planned" || result?.status === "needs_remediation")
    .map((result) => {
      const recommendedNextStages = uniqueNonEmptyStrings(result.nextStages ?? [])
      return {
        schema: "self-question-loop-gate-event-v1",
        id: `self_question_gate_${shortHash(JSON.stringify({
          runId,
          stage: result.stage,
          status: result.status,
          reason: result.reason ?? null,
          recommendedNextStages,
        }))}`,
        type: "event",
        eventType: "self-question-loop-gate",
        source: "self-question-loop",
        loopRunId: runId,
        stage: result.stage,
        status: result.status,
        gateStatus: result.status,
        gateSummaryStatus: gateSummary.status ?? "none",
        reason: result.reason ?? null,
        recommendedNextStages,
        commandFailures: result.commandFailures ?? 0,
        evaluationFailed: result.evaluationFailed ?? 0,
        evaluationSkipped: result.evaluationSkipped ?? 0,
        trainingExportFailures: result.trainingExportFailures ?? 0,
        trainingExportIssues: result.trainingExportIssues ?? 0,
        createdAt,
      }
    })
}

async function recordSelfQuestionLoopGateEvents({ projectPath, runId, gateSummary, write }) {
  const generatedAt = nowLocalTimestamp()
  const events = buildSelfQuestionLoopGateEvents({ gateSummary, runId, createdAt: generatedAt })
  const dryRun = !write
  let writeResult = null
  if (!dryRun && events.length > 0) {
    const filePath = path.join(brainDir(projectPath), brainFileForType("event"))
    for (const event of events) await appendJsonl(filePath, event)
    writeResult = { filePath, relativePath: projectRelative(projectPath, filePath), records: events.length }
  }
  return {
    schema: "self-question-loop-gate-events-run-v1",
    mode: "self-question-loop-gate-event",
    projectPath,
    runId,
    generatedAt,
    dryRun,
    gateSummary,
    counts: {
      gateResults: gateSummary?.results?.length ?? 0,
      events: events.length,
    },
    events,
    writePolicy: {
      events: "data/brain/self_training_events.jsonl only when --write is present",
      wroteWiki: false,
      wroteRaw: false,
    },
    writeResult,
  }
}

function beginSelfQuestionLoopTiming() {
  return { startedAt: nowLocalTimestamp(), startedMs: Date.now() }
}

function finishSelfQuestionLoopTiming(timing) {
  return {
    startedAt: timing.startedAt,
    finishedAt: nowLocalTimestamp(),
    durationMs: Date.now() - timing.startedMs,
  }
}

function recursiveAiPhaseInvocationForGate(gate, options = {}) {
  const limit = options.limit ?? options["max-items"] ?? options["max-actions"]
  const map = {
    generate_self_questions: {
      kind: "self-question-loop",
      stages: ["generate"],
      requiresWrite: true,
      options: { questionCount: options.questionCount ?? options["question-count"] ?? 3 },
    },
    validate_market_feedback: {
      kind: "self-question-loop",
      stages: ["validate"],
      requiresWrite: true,
      options: {},
    },
    attribute_market_feedback: {
      kind: "self-question-loop",
      stages: ["attribute"],
      requiresWrite: true,
      options: {},
    },
    create_self_training_actions: {
      kind: "self-question-loop",
      stages: ["self-train"],
      requiresWrite: true,
      options: { selfTrainWrite: true },
    },
    plan_self_training_handoffs: {
      kind: "self-train-plan",
      stages: ["self-train-plan"],
      requiresWrite: true,
      options: { limit: parsePositiveInteger(limit, 5) },
    },
    verify_self_training_plans: {
      kind: "self-train-plan-verify",
      stages: ["self-train-plan-verify"],
      requiresWrite: false,
      options: { limit: parsePositiveInteger(options.planLimit ?? options["plan-limit"] ?? limit, 20) },
    },
    export_review_required_eval_samples: {
      kind: "export-samples",
      stages: ["export"],
      requiresWrite: true,
      options: { kind: "eval", qualityGate: "review_required" },
    },
    verify_training_exports: {
      kind: "export-samples-verify",
      stages: ["export-verify"],
      requiresWrite: false,
      options: { kind: "eval", limit: parsePositiveInteger(options.exportLimit ?? options["export-limit"] ?? limit, 20) },
    },
    review_actions_for_high_confidence_labels: {
      kind: "self-train-actions",
      stages: ["self-train-actions"],
      requiresWrite: false,
      options: { status: "open", limit: parsePositiveInteger(limit, 20) },
    },
  }
  return map[gate] ?? null
}

function selectRecursiveAiPhaseAction(status, requestedGate = null, ignoredGates = new Set()) {
  const actions = Array.isArray(status?.nextActions) ? status.nextActions : []
  if (requestedGate) return actions.find((item) => item.gate === requestedGate) ?? null
  return actions.find((item) => !ignoredGates.has(item.gate)) ?? null
}

async function executeRecursiveAiPhaseInvocation(projectPath, action, invocation, options = {}) {
  if (invocation.kind === "self-question-loop") {
    return runSelfQuestionLoop({
      ...options,
      projectPath,
      stages: invocation.stages.join(","),
      ...invocation.options,
      write: Boolean(options.write),
      loopArtifacts: options.loopArtifacts ?? (options["no-loop-artifacts"] ? false : options["loop-artifacts"] ?? true),
    })
  }
  if (invocation.kind === "self-train-plan") {
    return planSelfTrainingActions({
      projectPath,
      limit: invocation.options.limit,
      write: Boolean(options.write),
    })
  }
  if (invocation.kind === "self-train-plan-verify") {
    return verifySelfTrainingPlans({
      projectPath,
      limit: invocation.options.limit,
    })
  }
  if (invocation.kind === "export-samples") {
    return exportTrainingSamples({
      projectPath,
      kind: invocation.options.kind,
      qualityGate: invocation.options.qualityGate,
    })
  }
  if (invocation.kind === "export-samples-verify") {
    return verifyTrainingSampleExports({
      projectPath,
      kind: invocation.options.kind,
      limit: invocation.options.limit,
      concurrency: options.verifyConcurrency ?? options["verify-concurrency"] ?? options.exportVerifyConcurrency ?? options["export-verify-concurrency"],
    })
  }
  if (invocation.kind === "self-train-actions") {
    return listSelfTrainingActions({
      projectPath,
      status: invocation.options.status,
      limit: invocation.options.limit,
      orderBy: "priority",
    })
  }
  throw new Error(`Unsupported recursive AI phase gate: ${action?.gate ?? "unknown"}`)
}

export async function runRecursiveAiPhaseAdvance(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const generatedAt = String(options.generatedAt ?? nowLocalTimestamp())
  const beforeStatus = await getRecursiveAiPhaseStatus({
    projectPath,
    actionLimit: options.actionLimit ?? options["action-limit"],
    planLimit: options.planLimit ?? options["plan-limit"],
    exportLimit: options.exportLimit ?? options["export-limit"],
  })
  const requestedGate = String(options.gate ?? options.nextGate ?? options["next-gate"] ?? "").trim() || null
  let selectedAction = selectRecursiveAiPhaseAction(beforeStatus, requestedGate)
  if (!selectedAction && requestedGate && recursiveAiPhaseInvocationForGate(requestedGate, options)) {
    selectedAction = {
      priority: null,
      gate: requestedGate,
      reason: "manual requested gate override",
      command: null,
      writePolicy: "requires explicit --write or remains read-only/dry-run",
    }
  }
  if (!selectedAction) {
    return {
      schema: "recursive-ai-phase-advance-v1",
      mode: "self-question-phase-advance",
      generatedAt,
      projectPath,
      status: "no_action",
      dryRun: true,
      executed: false,
      requestedGate,
      selectedAction: null,
      plannedInvocation: null,
      beforeStatus,
      result: null,
      afterStatus: null,
    }
  }
  const plannedInvocation = recursiveAiPhaseInvocationForGate(selectedAction.gate, options)
  if (!plannedInvocation) throw new Error(`Unsupported recursive AI phase gate: ${selectedAction.gate}`)
  const execute = Boolean(options.execute)
  if (execute && plannedInvocation.requiresWrite && !options.write) {
    throw new Error(`--write is required to execute recursive AI phase gate: ${selectedAction.gate}`)
  }
  const result = execute ? await executeRecursiveAiPhaseInvocation(projectPath, selectedAction, plannedInvocation, options) : null
  const afterStatus = execute ? await getRecursiveAiPhaseStatus({ projectPath }) : null
  return {
    schema: "recursive-ai-phase-advance-v1",
    mode: "self-question-phase-advance",
    generatedAt,
    projectPath,
    status: execute ? "executed" : "planned",
    dryRun: !execute,
    executed: execute,
    requestedGate,
    selectedAction,
    plannedInvocation,
    beforeStatus,
    result,
    afterStatus,
    writePolicy: {
      executeRequires: plannedInvocation.requiresWrite ? "--execute --write" : "--execute",
      wroteWiki: false,
      wroteRaw: false,
      writes: plannedInvocation.requiresWrite ? "declared stage output only" : "read-only",
    },
  }
}

function summarizeRecursiveAiPhaseResult(result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return null
  return {
    schema: result.schema ?? null,
    mode: result.mode ?? null,
    kind: result.kind ?? null,
    qualityGate: result.qualityGate ?? null,
    status: result.status ?? null,
    dryRun: typeof result.dryRun === "boolean" ? result.dryRun : null,
    count: Number.isFinite(result.count) ? result.count : null,
    counts: result.counts ?? null,
    checked: Number.isFinite(result.checked) ? result.checked : null,
    failed: Number.isFinite(result.failed) ? result.failed : null,
    issueCount: Number.isFinite(result.issueCount) ? result.issueCount : null,
    outputPath: result.outputPath ?? null,
    manifestPath: result.manifestPath ?? null,
    writeResult: result.writeResult ?? null,
  }
}

function summarizeRecursiveAiPhaseStep({ action, invocation, advance = null, dryRun = false }) {
  const selectedAction = advance?.selectedAction ?? action ?? null
  const plannedInvocation = advance?.plannedInvocation ?? invocation ?? null
  return {
    gate: selectedAction?.gate ?? null,
    priority: selectedAction?.priority ?? null,
    reason: selectedAction?.reason ?? null,
    status: advance?.status ?? (dryRun ? "planned" : null),
    dryRun: advance ? Boolean(advance.dryRun) : Boolean(dryRun),
    kind: plannedInvocation?.kind ?? null,
    stages: plannedInvocation?.stages ?? [],
    requiresWrite: Boolean(plannedInvocation?.requiresWrite),
    result: summarizeRecursiveAiPhaseResult(advance?.result ?? null),
    nextGate: advance?.afterStatus?.nextActions?.[0]?.gate ?? null,
  }
}

function planRecursiveAiPhaseRunSteps(status, maxGates, options = {}) {
  return (Array.isArray(status?.nextActions) ? status.nextActions : [])
    .slice(0, maxGates)
    .map((action) => summarizeRecursiveAiPhaseStep({
      action,
      invocation: recursiveAiPhaseInvocationForGate(action.gate, options),
      dryRun: true,
    }))
}

function recursiveAiPhaseRunArtifactsEnabled(options = {}) {
  return options.phaseRunArtifacts ?? (options["no-phase-run-artifacts"] ? false : options["phase-run-artifacts"] ?? true)
}

async function writeRecursiveAiPhaseRunManifest(result, options = {}) {
  const artifactsEnabled = recursiveAiPhaseRunArtifactsEnabled(options)
  if (artifactsEnabled === false) {
    return {
      ...result,
      manifestPath: null,
      manifestRelativePath: null,
    }
  }
  const stamp = String(result.generatedAt ?? nowLocalTimestamp()).replace(/[-: ]/g, "").slice(0, 14)
  let runDir = null
  for (let index = 1; index < 1000; index += 1) {
    const suffix = index === 1 ? "phase-run" : `${index}-phase-run`
    const candidate = path.join(result.projectPath, ".llm-wiki", "self-question-runs", `${stamp}-${suffix}`)
    try {
      await fs.access(path.join(candidate, "manifest.json"))
    } catch {
      runDir = candidate
      break
    }
  }
  if (!runDir) throw new Error("Unable to allocate recursive AI phase-run artifact path")
  await ensureDirectory(runDir)
  const manifestPath = path.join(runDir, "manifest.json")
  const manifestRelativePath = projectRelative(result.projectPath, manifestPath)
  const manifest = {
    ...result,
    manifestPath,
    manifestRelativePath,
  }
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8")
  return manifest
}

export async function runRecursiveAiPhaseRun(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const generatedAt = String(options.generatedAt ?? nowLocalTimestamp())
  const execute = Boolean(options.execute)
  const maxGates = parsePositiveInteger(options.maxGates ?? options["max-gates"] ?? options.limit, execute ? 1 : 3)
  const beforeStatus = await getRecursiveAiPhaseStatus({
    projectPath,
    actionLimit: options.actionLimit ?? options["action-limit"],
    planLimit: options.planLimit ?? options["plan-limit"],
    exportLimit: options.exportLimit ?? options["export-limit"],
  })
  if (!execute) {
    return writeRecursiveAiPhaseRunManifest({
      schema: "recursive-ai-phase-run-v1",
      mode: "self-question-phase-run",
      generatedAt,
      projectPath,
      status: "planned",
      dryRun: true,
      executed: false,
      maxGates,
      executedCount: 0,
      beforeStatus,
      afterStatus: null,
      steps: planRecursiveAiPhaseRunSteps(beforeStatus, maxGates, options),
      stopReason: "dry_run",
      writePolicy: {
        executeRequires: "pass --execute; write gates also require --write",
        wroteWiki: false,
        wroteRaw: false,
        writes: "none",
      },
    }, options)
  }

  const steps = []
  const seenGates = new Set()
  let currentStatus = beforeStatus
  let stopReason = "max_gates_reached"
  try {
    for (let index = 0; index < maxGates; index += 1) {
      const selectedAction = selectRecursiveAiPhaseAction(currentStatus, null, seenGates)
      if (!selectedAction) {
        stopReason = steps.length ? "repeated_gate" : "no_action"
        break
      }
      seenGates.add(selectedAction.gate)
      const advance = await runRecursiveAiPhaseAdvance({
        ...options,
        projectPath,
        gate: selectedAction.gate,
        execute: true,
        write: Boolean(options.write),
      })
      steps.push(summarizeRecursiveAiPhaseStep({ advance }))
      currentStatus = advance.afterStatus ?? await getRecursiveAiPhaseStatus({ projectPath })
      if (advance.status !== "executed") {
        stopReason = advance.status ?? "not_executed"
        break
      }
    }
  } catch (error) {
    const message = safeErrorMessage(error?.message ?? error)
    const failed = await writeRecursiveAiPhaseRunManifest({
      schema: "recursive-ai-phase-run-v1",
      mode: "self-question-phase-run",
      generatedAt,
      projectPath,
      status: "failed",
      dryRun: false,
      executed: steps.length > 0,
      maxGates,
      executedCount: steps.length,
      beforeStatus,
      afterStatus: currentStatus,
      steps,
      stopReason: "failed",
      error: message,
      writePolicy: {
        executeRequires: "phase-run was executed; write gates required --write",
        wroteWiki: false,
        wroteRaw: false,
        writes: steps.some((step) => step.requiresWrite) ? "declared stage outputs only" : "none",
      },
    }, options)
    const wrapped = new Error(message)
    wrapped.manifestPath = failed.manifestPath
    wrapped.manifestRelativePath = failed.manifestRelativePath
    wrapped.phaseRun = failed
    throw wrapped
  }

  return writeRecursiveAiPhaseRunManifest({
    schema: "recursive-ai-phase-run-v1",
    mode: "self-question-phase-run",
    generatedAt,
    projectPath,
    status: stopReason,
    dryRun: false,
    executed: steps.length > 0,
    maxGates,
    executedCount: steps.length,
    beforeStatus,
    afterStatus: currentStatus,
    steps,
    stopReason,
    writePolicy: {
      executeRequires: "phase-run was executed; write gates required --write",
      wroteWiki: false,
      wroteRaw: false,
      writes: steps.some((step) => step.requiresWrite) ? "declared stage outputs only" : "read-only",
    },
  }, options)
}

export async function runSelfQuestionLoop(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const generatedAt = nowLocalTimestamp()
  const runId = `self_question_loop_${generatedAt.replace(/[-: ]/g, "").slice(0, 14)}`
  const loopTiming = beginSelfQuestionLoopTiming()
  const dryRun = !options.write
  const loopOptions = { ...options, projectPath }
  const exportQualityGate = parseTrainingSampleQualityGate(options.exportQualityGate ?? options["export-quality-gate"] ?? options.qualityGate ?? options["quality-gate"])

  const stages = []
  let questionRun = null
  let validationRun = null
  let attributionRun = null
  let evidenceRun = null
  let policyRun = null
  let policyRegressionRun = null
  let policyRegressionExecutionRun = null
  let policyRegressionFeedbackRun = null
  let policyRegressionRemediationRun = null
  let policyRegressionPatchRun = null
  let policyRegressionPatchApplyRun = null
  let policyRegressionVerificationRun = null
  let gateEventRun = null
  let selfTraining = null
  let selfTrainingPlanRun = null
  let selfTrainingPlanVerificationRun = null
  let exportVerificationRun = null
  const exportedSamples = []
  let scopedQuestionRunId = String(options.id ?? options.questionRunId ?? "").trim() || null
  let manifestPath = null
  let manifestRelativePath = null
  let currentStage = "setup"
  let currentStageTiming = null

  const buildManifest = (status, error = null) => {
    const gateSummary = selfQuestionLoopGateSummary(stages)
    const counts = {
      questions: questionRun?.questions?.length ?? 0,
      validations: validationRun?.validations?.length ?? 0,
      attributions: attributionRun?.attributions?.length ?? 0,
      evidenceTasks: evidenceRun?.tasks?.length ?? 0,
      policyProposals: policyRun?.proposals?.length ?? 0,
      policyRegressionCases: policyRegressionRun?.cases?.length ?? policyRegressionExecutionRun?.counts?.cases ?? 0,
      policyRegressionExecutions: policyRegressionExecutionRun?.results?.length ?? 0,
      policyRegressionExecutionFailures: policyRegressionExecutionRun?.counts?.failed ?? 0,
      policyRegressionExecutionTimeouts: policyRegressionExecutionRun?.counts?.timedOut ?? 0,
      policyRegressionFeedbackItems: policyRegressionFeedbackRun?.feedbackItems?.length ?? 0,
      policyRegressionRemediationProposals: policyRegressionRemediationRun?.proposals?.length ?? 0,
      policyRegressionPatchCandidates: policyRegressionPatchRun?.patchCandidates?.length ?? 0,
      policyRegressionPatchApplyCandidates: policyRegressionPatchApplyRun?.patchCandidate ? 1 : 0,
      policyRegressionPatchPolicyRevisions: policyRegressionPatchApplyRun?.writeResult?.policy?.records ?? 0,
      policyRegressionPatchApplyEvents: policyRegressionPatchApplyRun?.writeResult?.event?.records ?? 0,
      policyRegressionPatchAlreadyApplied: policyRegressionPatchApplyRun?.alreadyApplied ? 1 : 0,
      policyRegressionVerificationCases: policyRegressionVerificationRun?.counts?.cases ?? 0,
      policyRegressionVerificationExecutions: policyRegressionVerificationRun?.counts?.executions ?? 0,
      policyRegressionVerificationFailures: policyRegressionVerificationRun?.counts?.failed ?? 0,
      policyRegressionVerificationTimeouts: policyRegressionVerificationRun?.counts?.timedOut ?? 0,
      policyRegressionVerificationEvaluationFailed: policyRegressionVerificationRun?.counts?.evaluationFailed ?? 0,
      policyRegressionVerificationEvaluationSkipped: policyRegressionVerificationRun?.counts?.evaluationSkipped ?? 0,
      gateEvents: gateEventRun?.events?.length ?? 0,
      selfTrainingActions: selfTraining?.actions?.length ?? 0,
      selfTrainingPlanActions: selfTrainingPlanRun?.counts?.actions ?? 0,
      selfTrainingPlanSteps: selfTrainingPlanRun?.counts?.steps ?? 0,
      selfTrainingPlanVerificationChecked: selfTrainingPlanVerificationRun?.checked ?? 0,
      selfTrainingPlanVerificationFailures: selfTrainingPlanVerificationRun?.failed ?? 0,
      selfTrainingPlanVerificationIssues: selfTrainingPlanVerificationRun?.issueCount ?? 0,
      exports: exportedSamples.length,
      exportVerificationChecked: exportVerificationRun?.checked ?? 0,
      exportVerificationFailures: exportVerificationRun?.failed ?? 0,
      exportVerificationIssues: exportVerificationRun?.issueCount ?? 0,
      exportVerificationConcurrency: exportVerificationRun?.concurrency ?? 0,
    }
    return {
      schema: "self-question-loop-run-v1",
      runId,
      status,
      generatedAt,
      projectPath,
      dryRun,
      timing: finishSelfQuestionLoopTiming(loopTiming),
      stages,
      gateSummary,
      counts,
      questionRunId: questionRun?.runId ?? scopedQuestionRunId,
      outputs: {
        questions: questionRun?.writeResult?.relativePath ?? null,
        validations: validationRun?.writeResult?.relativePath ?? null,
        attributions: attributionRun?.writeResult?.relativePath ?? null,
        evidenceTasks: evidenceRun?.writeResult?.relativePath ?? null,
        policyProposals: policyRun?.writeResult?.relativePath ?? null,
        policyRegressions: policyRegressionRun?.writeResult?.relativePath ?? null,
        policyRegressionExecutions: policyRegressionExecutionRun?.writeResult?.relativePath ?? null,
        policyRegressionFeedback: policyRegressionFeedbackRun?.writeResult?.relativePath ?? null,
        policyRegressionRemediation: policyRegressionRemediationRun?.writeResult?.relativePath ?? null,
        policyRegressionPatches: policyRegressionPatchRun?.writeResult?.relativePath ?? null,
        policyRegressionPatchApply: {
          policy: policyRegressionPatchApplyRun?.writeResult?.policy?.relativePath ?? null,
          event: policyRegressionPatchApplyRun?.writeResult?.event?.relativePath ?? null,
        },
        policyRegressionVerification: {
          regressions: policyRegressionVerificationRun?.regressionRun?.writeResult?.relativePath ?? null,
          executions: policyRegressionVerificationRun?.executionRun?.writeResult?.relativePath ?? null,
        },
        gateEvents: gateEventRun?.writeResult?.relativePath ?? null,
        selfTrainingPlan: selfTrainingPlanRun?.writeResult?.relativePath ?? null,
        selfTrainingPlanVerification: selfTrainingPlanVerificationRun
          ? {
              status: selfTrainingPlanVerificationRun.status,
              checked: selfTrainingPlanVerificationRun.checked,
              failed: selfTrainingPlanVerificationRun.failed,
              issueCount: selfTrainingPlanVerificationRun.issueCount,
              plans: selfTrainingPlanVerificationRun.plans?.map((plan) => ({
                status: plan.status,
                relativePath: plan.relativePath,
                actionCount: plan.actionCount,
                stepCount: plan.stepCount,
                issues: plan.issues,
              })) ?? [],
            }
          : null,
        exports: exportedSamples.map((item) => item.relativePath),
        exportManifests: exportedSamples.map((item) => item.manifestRelativePath),
        exportLedgers: [...new Set(exportedSamples.map((item) => item.ledgerRelativePath).filter(Boolean))],
        exportVerification: exportVerificationRun
          ? {
              status: exportVerificationRun.status,
              checked: exportVerificationRun.checked,
              failed: exportVerificationRun.failed,
              issueCount: exportVerificationRun.issueCount,
              concurrency: exportVerificationRun.concurrency,
              ledger: exportVerificationRun.ledgerRelativePath,
            }
          : null,
      },
      writePolicy: {
        questions: "data/brain/questions.jsonl",
        validations: "data/brain/validations.jsonl",
        attributions: "data/brain/attributions.jsonl",
        evidenceTasks: ".llm-wiki/evidence-tasks only when evidence stage runs with write enabled",
        policyProposals: ".llm-wiki/policy-proposals only when policy stage runs with write enabled",
        policyRegressions: ".llm-wiki/policy-regressions only when policy-regression stage runs with write enabled",
        policyRegressionExecutions: ".llm-wiki/policy-regression-executions only when policy-regression-execute stage runs with write enabled",
        policyRegressionFeedback: ".llm-wiki/policy-regression-feedback only when policy-regression-feedback stage runs with write enabled",
        policyRegressionRemediation: ".llm-wiki/policy-regression-remediations only when policy-regression-remediation stage runs with write enabled",
        policyRegressionPatches: ".llm-wiki/policy-regression-patches only when policy-regression-patches stage runs with write enabled",
        policyRegressionPatchApply: "data/brain/policies.jsonl and data/brain/self_training_events.jsonl only when policy-regression-apply stage runs with explicit apply confirmation and write enabled",
        policyRegressionVerification: ".llm-wiki/policy-regressions and .llm-wiki/policy-regression-executions only when policy-regression-verify stage runs with write enabled",
        gateEvents: "data/brain/self_training_events.jsonl only when gate-event stage runs with write enabled",
        selfTrainingEvents: "data/brain/self_training_events.jsonl only when selfTrainWrite is true",
        selfTrainingPlans: ".llm-wiki/self-training-plans only when self-train-plan stage runs with write enabled",
        selfTrainingPlanVerification: "read-only check of .llm-wiki/self-training-plans artifacts when self-train-plan-verify stage runs",
        exports: ".llm-wiki/exports/training JSONL plus sibling manifest and export-ledger.jsonl only when export-samples or loop export stage materializes samples",
        exportVerification: "read-only check of .llm-wiki/exports/training ledger/jsonl/manifest integrity when export-verify stage runs",
        artifacts: ".llm-wiki/self-question-runs",
      },
      error,
    }
  }

  const writeLoopManifest = async (manifest) => {
    if (options.loopArtifacts === false) return
    const runDir = path.join(projectPath, ".llm-wiki", "self-question-runs", `${generatedAt.replace(/[-: ]/g, "").slice(0, 14)}-loop`)
    await ensureDirectory(runDir)
    manifestPath = path.join(runDir, "manifest.json")
    await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8")
    manifestRelativePath = projectRelative(projectPath, manifestPath)
  }

  try {
    const stagesToRun = parseSelfQuestionLoopStages(options.stages ?? options.loopStages ?? options["loop-stages"])
    for (const stage of stagesToRun) {
      currentStage = stage
      currentStageTiming = beginSelfQuestionLoopTiming()
      if (stage === "generate") {
        questionRun = await runSelfQuestion(loopOptions)
        scopedQuestionRunId = questionRun.runId ?? scopedQuestionRunId
        stages.push({ ...compactSelfQuestionLoopStage(stage, "ok", questionRun), ...finishSelfQuestionLoopTiming(currentStageTiming) })
        continue
      }
      if (stage === "validate") {
        validationRun = await validateSelfQuestions({
          ...loopOptions,
          id: options.validationId ?? options.questionId ?? scopedQuestionRunId ?? options.id,
          questionRecords: questionRun?.questions,
        })
        stages.push({ ...compactSelfQuestionLoopStage(stage, "ok", validationRun), ...finishSelfQuestionLoopTiming(currentStageTiming) })
        continue
      }
      if (stage === "attribute") {
        const validationScope =
          options.validationId ??
          validationRun?.validations?.[0]?.sourceRunId ??
          validationRun?.validations?.[0]?.questionRecordId ??
          scopedQuestionRunId ??
          options.id
        attributionRun = await attributeSelfQuestionValidations({ ...loopOptions, id: validationScope, validationRecords: validationRun?.validations })
        stages.push({ ...compactSelfQuestionLoopStage(stage, "ok", attributionRun), ...finishSelfQuestionLoopTiming(currentStageTiming) })
        continue
      }
      if (stage === "evidence") {
        const explicitAttributionScope = options.attributionId ?? options["attribution-id"]
        const attributionScope =
          explicitAttributionScope ??
          (attributionRun?.attributions?.length > 0 ? null : (options.id ?? scopedQuestionRunId))
        evidenceRun = await collectSelfQuestionEvidenceTasks({
          ...loopOptions,
          id: attributionScope,
          attributionRecords: attributionRun?.attributions,
        })
        stages.push({ ...compactSelfQuestionLoopStage(stage, "ok", evidenceRun), ...finishSelfQuestionLoopTiming(currentStageTiming) })
        continue
      }
      if (stage === "policy") {
        policyRun = await proposeSelfQuestionPolicies({
          ...loopOptions,
          minOccurrences: options.policyMinOccurrences ?? options["policy-min-occurrences"],
          attributionRecords: attributionRun?.attributions,
        })
        stages.push({ ...compactSelfQuestionLoopStage(stage, "ok", policyRun), ...finishSelfQuestionLoopTiming(currentStageTiming) })
        continue
      }
      if (stage === "policy-regression") {
        policyRegressionRun = await exportSelfQuestionPolicyRegressions({
          ...loopOptions,
          maxPolicies: options.maxPolicies ?? options["max-policies"],
          maxQuestionsPerPolicy: options.maxQuestionsPerPolicy ?? options["max-questions-per-policy"],
        })
        stages.push({ ...compactSelfQuestionLoopStage(stage, "ok", policyRegressionRun), ...finishSelfQuestionLoopTiming(currentStageTiming) })
        continue
      }
      if (stage === "policy-regression-execute") {
        policyRegressionExecutionRun = await executeSelfQuestionPolicyRegressions({
          ...loopOptions,
          regressionRun: policyRegressionRun,
          regressionPath: options.regressionPath ?? options.regression ?? options["regression-path"],
          maxCases: options.policyRegressionMaxCases ?? options["policy-regression-max-cases"] ?? options.maxCases ?? options["max-cases"],
          timeoutMs: options.policyRegressionTimeoutMs ?? options["policy-regression-timeout-ms"] ?? options.timeoutMs ?? options["timeout-ms"],
          maxOutputBytes: options.policyRegressionMaxOutputBytes ?? options["policy-regression-max-output-bytes"] ?? options.maxOutputBytes ?? options["max-output-bytes"],
          concurrency: options.policyRegressionConcurrency ?? options["policy-regression-concurrency"] ?? options.concurrency,
          execute: Boolean(options.executePolicyRegressions ?? options["execute-policy-regressions"]),
          executor: options.policyRegressionExecutor,
        })
        stages.push({
          ...compactSelfQuestionLoopStage(stage, policyRegressionExecutionStageStatus(policyRegressionExecutionRun?.verdict), policyRegressionExecutionRun),
          ...finishSelfQuestionLoopTiming(currentStageTiming),
        })
        continue
      }
      if (stage === "policy-regression-feedback") {
        policyRegressionFeedbackRun = await collectSelfQuestionPolicyRegressionFeedback({
          ...loopOptions,
          executionRun: policyRegressionExecutionRun,
          executionPath: options.executionPath ?? options.execution ?? options["execution-path"],
        })
        stages.push({ ...compactSelfQuestionLoopStage(stage, "ok", policyRegressionFeedbackRun), ...finishSelfQuestionLoopTiming(currentStageTiming) })
        continue
      }
      if (stage === "policy-regression-remediation") {
        policyRegressionRemediationRun = await proposeSelfQuestionPolicyRegressionRemediations({
          ...loopOptions,
          feedbackRun: policyRegressionFeedbackRun,
          feedbackPath: options.feedbackPath ?? options.feedback ?? options["feedback-path"],
        })
        stages.push({ ...compactSelfQuestionLoopStage(stage, "ok", policyRegressionRemediationRun), ...finishSelfQuestionLoopTiming(currentStageTiming) })
        continue
      }
      if (stage === "policy-regression-patches") {
        policyRegressionPatchRun = await exportSelfQuestionPolicyRegressionPatchCandidates({
          ...loopOptions,
          remediationId: options.remediationId ?? options["remediation-id"],
        })
        stages.push({ ...compactSelfQuestionLoopStage(stage, "ok", policyRegressionPatchRun), ...finishSelfQuestionLoopTiming(currentStageTiming) })
        continue
      }
      if (stage === "policy-regression-apply") {
        const applyConfirmed = Boolean(options.applyPolicyRegressionPatches ?? options["apply-policy-regression-patches"])
        if (!applyConfirmed) {
          stages.push({
            stage,
            status: "skipped",
            counts: { patchCandidates: 0, activePolicyRevisions: 0, applyEvents: 0 },
            output: { policy: null, event: null },
            warning: "policy-regression-apply skipped; pass --apply-policy-regression-patches to apply reviewed patch candidates",
            ...finishSelfQuestionLoopTiming(currentStageTiming),
          })
          continue
        }
        const patchPath = options.patchPath ?? options.patch ?? options["patch-path"] ?? options.candidates ?? options["patch-candidates"] ?? policyRegressionPatchRun?.writeResult?.relativePath
        const patchCandidate = patchPath
          ? null
          : policyRegressionPatchRun?.patchCandidates?.length === 1
            ? policyRegressionPatchRun.patchCandidates[0]
            : null
        policyRegressionPatchApplyRun = await applySelfQuestionPolicyRegressionPatchCandidate({
          ...loopOptions,
          id: null,
          patchPath,
          patchCandidate,
          patchId: options.patchId ?? options["patch-id"] ?? options.candidateId ?? options["candidate-id"],
          remediationId: options.remediationId ?? options["remediation-id"],
          reviewer: options.reviewer,
          note: options.note,
          force: Boolean(options.force),
        })
        stages.push({ ...compactSelfQuestionLoopStage(stage, "ok", policyRegressionPatchApplyRun), ...finishSelfQuestionLoopTiming(currentStageTiming) })
        continue
      }
      if (stage === "policy-regression-verify") {
        const verificationRegressionRun = await exportSelfQuestionPolicyRegressions({
          ...loopOptions,
          maxPolicies: options.maxPolicies ?? options["max-policies"],
          maxQuestionsPerPolicy: options.maxQuestionsPerPolicy ?? options["max-questions-per-policy"],
        })
        const verificationExecutionRun = await executeSelfQuestionPolicyRegressions({
          ...loopOptions,
          regressionRun: verificationRegressionRun,
          maxCases: options.policyRegressionMaxCases ?? options["policy-regression-max-cases"] ?? options.maxCases ?? options["max-cases"],
          timeoutMs: options.policyRegressionTimeoutMs ?? options["policy-regression-timeout-ms"] ?? options.timeoutMs ?? options["timeout-ms"],
          maxOutputBytes: options.policyRegressionMaxOutputBytes ?? options["policy-regression-max-output-bytes"] ?? options.maxOutputBytes ?? options["max-output-bytes"],
          concurrency: options.policyRegressionConcurrency ?? options["policy-regression-concurrency"] ?? options.concurrency,
          execute: Boolean(options.executePolicyRegressions ?? options["execute-policy-regressions"]),
          executor: options.policyRegressionExecutor,
        })
        const verificationVerdict = policyRegressionVerificationVerdict(verificationExecutionRun)
        policyRegressionRun = verificationRegressionRun
        policyRegressionExecutionRun = verificationExecutionRun
        policyRegressionVerificationRun = {
          schema: "self-question-policy-regression-verification-run-v1",
          mode: "self-question-policy-regression-verify",
          sourcePatchApply: policyRegressionPatchApplyRun?.applyEvent
            ? {
                patchCandidateId: policyRegressionPatchApplyRun.applyEvent.patchCandidateId ?? null,
                policyId: policyRegressionPatchApplyRun.applyEvent.policyId ?? null,
                revision: policyRegressionPatchApplyRun.applyEvent.revision ?? null,
                activePolicyRevisionId: policyRegressionPatchApplyRun.applyEvent.activePolicyRevisionId ?? null,
                alreadyApplied: Boolean(policyRegressionPatchApplyRun.alreadyApplied),
              }
            : null,
          regressionRun: verificationRegressionRun,
          executionRun: verificationExecutionRun,
          counts: {
            cases: verificationRegressionRun?.cases?.length ?? 0,
            executions: verificationExecutionRun?.results?.length ?? 0,
            planned: verificationExecutionRun?.counts?.planned ?? 0,
            completed: verificationExecutionRun?.counts?.completed ?? 0,
            failed: verificationExecutionRun?.counts?.failed ?? 0,
            timedOut: verificationExecutionRun?.counts?.timedOut ?? 0,
            evaluationPassed: verificationExecutionRun?.evaluation?.counts?.passed ?? 0,
            evaluationFailed: verificationExecutionRun?.evaluation?.counts?.failed ?? 0,
            evaluationSkipped: verificationExecutionRun?.evaluation?.counts?.skipped ?? 0,
          },
          verdict: verificationVerdict,
        }
        stages.push({
          ...compactSelfQuestionLoopStage(stage, policyRegressionVerificationStageStatus(verificationVerdict), policyRegressionVerificationRun),
          ...finishSelfQuestionLoopTiming(currentStageTiming),
        })
        continue
      }
      if (stage === "gate-event") {
        gateEventRun = await recordSelfQuestionLoopGateEvents({
          projectPath,
          runId,
          gateSummary: selfQuestionLoopGateSummary(stages),
          write: options.write,
        })
        stages.push({ ...compactSelfQuestionLoopStage(stage, "ok", gateEventRun), ...finishSelfQuestionLoopTiming(currentStageTiming) })
        continue
      }
      if (stage === "self-train") {
        const selfTrainWrite = Boolean(options.selfTrainWrite ?? options["self-train-write"])
        const additionalRecords = selfTrainWrite || gateEventRun?.writeResult ? [] : (gateEventRun?.events ?? [])
        selfTraining = await runSelfTraining({
          projectPath,
          additionalRecords,
          write: selfTrainWrite,
        })
        stages.push({
          stage,
          status: "ok",
          counts: { actions: selfTraining.actions.length },
          output: selfTraining.dryRun ? null : brainFileForType("event"),
          ...finishSelfQuestionLoopTiming(currentStageTiming),
        })
        continue
      }
      if (stage === "self-train-plan") {
        selfTrainingPlanRun = await planSelfTrainingActions({
          projectPath,
          actions: selfTraining?.actions,
          status: options.selfTrainPlanStatus ?? options["self-train-plan-status"] ?? "open",
          limit: options.selfTrainPlanLimit ?? options["self-train-plan-limit"] ?? 5,
          rule: options.selfTrainPlanRule ?? options["self-train-plan-rule"],
          target: options.selfTrainPlanTarget ?? options["self-train-plan-target"],
          action: options.selfTrainPlanAction ?? options["self-train-plan-action"],
          write: Boolean(options.write),
        })
        stages.push({
          ...compactSelfQuestionLoopStage(stage, "ok", selfTrainingPlanRun),
          ...finishSelfQuestionLoopTiming(currentStageTiming),
        })
        continue
      }
      if (stage === "self-train-plan-verify") {
        const explicitPlanPath = options.selfTrainPlanPath ?? options["self-train-plan-path"] ?? options.planPath ?? options.plan
        const generatedPlanPath = selfTrainingPlanRun?.writeResult?.relativePath ?? null
        const verificationLimit = options.selfTrainPlanVerifyLimit ?? options["self-train-plan-verify-limit"] ?? options.selfTrainPlanLimit ?? options["self-train-plan-limit"]
        selfTrainingPlanVerificationRun = (!explicitPlanPath && selfTrainingPlanRun && !generatedPlanPath)
          ? plannedSelfTrainingPlanVerificationRun(projectPath, verificationLimit ?? null)
          : await verifySelfTrainingPlans({
            projectPath,
            planPath: explicitPlanPath ?? generatedPlanPath,
            limit: verificationLimit,
          })
        selfTrainingPlanVerificationRun.verdict = selfTrainingPlanVerificationVerdict(selfTrainingPlanVerificationRun)
        stages.push({
          ...compactSelfQuestionLoopStage(stage, selfTrainingPlanVerificationStageStatus(selfTrainingPlanVerificationRun.verdict), selfTrainingPlanVerificationRun),
          ...finishSelfQuestionLoopTiming(currentStageTiming),
        })
        continue
      }
      if (stage === "export") {
        if (!options.write && !options.exportInDryRun) {
          stages.push({
            stage,
            status: "skipped",
            counts: { exports: 0, samples: 0 },
            output: [],
            warning: "export stage skipped in dry-run; pass --write to materialize training sample files",
            ...finishSelfQuestionLoopTiming(currentStageTiming),
          })
          continue
        }
        for (const kind of parseSelfQuestionExportKinds(options.exportKinds ?? options["export-kinds"])) {
          const exported = await exportTrainingSamples({ projectPath, kind, qualityGate: exportQualityGate })
          exportedSamples.push({
            kind,
            qualityGate: exported.qualityGate,
            count: exported.count,
            outputPath: exported.outputPath,
            relativePath: exported.relativePath,
            manifestPath: exported.manifestPath,
            manifestRelativePath: exported.manifestRelativePath,
            ledgerPath: exported.ledgerPath,
            ledgerRelativePath: exported.ledgerRelativePath,
          })
        }
        stages.push({
          stage,
          status: "ok",
          counts: { exports: exportedSamples.length, samples: exportedSamples.reduce((sum, item) => sum + item.count, 0) },
          output: exportedSamples.map((item) => item.relativePath),
          manifests: exportedSamples.map((item) => item.manifestRelativePath),
          ledgers: [...new Set(exportedSamples.map((item) => item.ledgerRelativePath).filter(Boolean))],
          qualityGate: exportQualityGate,
          ...finishSelfQuestionLoopTiming(currentStageTiming),
        })
        continue
      }
      if (stage === "export-verify") {
        const exportKinds = parseSelfQuestionExportKinds(options.exportKinds ?? options["export-kinds"])
        const verificationKind = exportKinds.length === 1 ? exportKinds[0] : null
        const verificationLimit = options.exportVerifyLimit ?? options["export-verify-limit"] ?? options.limit ?? (exportedSamples.length > 0 ? exportedSamples.length : undefined)
        exportVerificationRun = await verifyTrainingSampleExports({
          projectPath,
          kind: verificationKind,
          qualityGate: exportQualityGate,
          limit: verificationLimit,
          concurrency: options.exportVerifyConcurrency ?? options["export-verify-concurrency"] ?? options.verifyConcurrency ?? options["verify-concurrency"],
        })
        exportVerificationRun.verdict = trainingExportVerificationVerdict(exportVerificationRun)
        stages.push({
          ...compactSelfQuestionLoopStage(stage, trainingExportVerificationStageStatus(exportVerificationRun.verdict), exportVerificationRun),
          ...finishSelfQuestionLoopTiming(currentStageTiming),
        })
      }
    }

    // E10 复利回灌：自训练演化动作 → wiki/进化/
    let compoundPath = null
    try {
      if (selfTraining?.actions?.length) {
        compoundPath = await writeSelfQuestionCompound({
          projectPath,
          generatedAt: createdAt,
          selfTraining,
        })
      }
    } catch (_) {
      // 复利回灌失败不阻断主流程
    }

    const manifest = buildManifest(selfQuestionLoopStatusFromStages(stages))
    await writeLoopManifest(manifest)

    return {
      ...manifest,
      manifestPath,
      manifestRelativePath,
      questionRun,
      validationRun,
      attributionRun,
      evidenceRun,
      policyRun,
      policyRegressionRun,
      policyRegressionExecutionRun,
      policyRegressionFeedbackRun,
      policyRegressionRemediationRun,
      policyRegressionPatchRun,
      policyRegressionPatchApplyRun,
      policyRegressionVerificationRun,
      gateEventRun,
      selfTraining,
      selfTrainingPlanRun,
      selfTrainingPlanVerificationRun,
      exportVerificationRun,
      exports: exportedSamples,
    }
  } catch (err) {
    const error = safeErrorMessage(err)
    const failedStageTiming = currentStageTiming ?? loopTiming
    stages.push({
      stage: currentStage,
      status: "failed",
      counts: {},
      output: null,
      error,
      ...finishSelfQuestionLoopTiming(failedStageTiming),
    })
    const manifest = buildManifest("failed", error)
    await writeLoopManifest(manifest)
    const wrapped = new Error(error)
    wrapped.manifestPath = manifestPath
    wrapped.manifestRelativePath = manifestRelativePath
    wrapped.runId = runId
    wrapped.loopManifest = manifest
    throw wrapped
  }
}

export async function runSelfQuestion(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const mode = parseDailyLoopMode(options.mode ?? "premarket")
  const questionCount = parsePositiveInteger(options.questionCount ?? options["question-count"], 3)
  const maxStocksPerQuestion = parsePositiveInteger(options.maxStocksPerQuestion ?? options["max-stocks-per-question"], 6)
  const lookbackDays = parsePositiveInteger(options.lookbackDays ?? options["lookback-days"], 30)
  const validationWindows = parseDailyLoopWindows(options.validationWindows ?? options["validation-windows"])
  const createdAt = nowLocalTimestamp()
  const runId = `self_question_${createdAt.replace(/[-: ]/g, "").slice(0, 14)}`

  const [stockUniverse, recentCorpus, policyRegistry] = await Promise.all([
    loadDailyLoopStockUniverse(projectPath),
    loadDailyLoopRecentCorpus(projectPath, lookbackDays),
    Array.isArray(options.activePolicies)
      ? Promise.resolve({ policies: options.activePolicies })
      : listActiveSelfQuestionPolicies({ projectPath }),
  ])
  const activePolicies = (policyRegistry.policies ?? []).map(compactActiveSelfQuestionPolicy)
  const themes = scoreDailyLoopThemes(recentCorpus)
  const stocksByTheme = selectDailyLoopThemeStocks(stockUniverse, themes, maxStocksPerQuestion)
  const candidateStocks = [...new Map([...stocksByTheme.values()].flat().map((stock) => [stock.code, stock])).values()]
  const sqlMetrics = await fetchDailyLoopStockMetrics(candidateStocks, { ...options, lookbackDays: 20, stockLookbackDays: 20 })
  const externalMetrics = await fetchDailyLoopExternalMarketMetrics(candidateStocks, { ...options, lookbackDays: 20, stockLookbackDays: 20 })
  const marketMetrics = mergeDailyLoopMarketMetrics(candidateStocks, sqlMetrics.metrics, externalMetrics.metrics)
  const planned = await planDailyLoopQuestions({
    mode,
    themes,
    stocksByTheme,
    metricsByCode: marketMetrics,
    questionCount: Math.max(questionCount * 2, questionCount + 3),
    maxStocksPerQuestion,
    recentCorpus,
    projectPath,
    options: {
      ...options,
      dailyLoopQuestionPlanner: options.selfQuestionPlanner ?? options.dailyLoopQuestionPlanner,
      useLlmQuestionPlanner: options.useLlmQuestionPlanner,
      activePolicies,
    },
  })
  const selfHistory = await loadRecentSelfQuestionHistory(projectPath)
  const filtered = filterNovelSelfQuestions(
    planned.questions.map((question) => ({ ...question, validationWindows })),
    selfHistory,
    questionCount,
  )
  const questions = filtered.questions.map((question, index) => ({ ...question, id: `self_q_${index + 1}` }))
  const records = questions.map((question) => selfQuestionRecordFromDailyQuestion({ runId, question, createdAt, validationWindows }))
  const dryRun = !options.write
  let writeResult = null
  if (!dryRun && records.length > 0) {
    const filePath = path.join(brainDir(projectPath), brainFileForType("question"))
    await ensureDirectory(path.dirname(filePath))
    for (const record of records) await appendJsonl(filePath, record)
    writeResult = { filePath, relativePath: projectRelative(projectPath, filePath), records: records.length }
  }

  return {
    schema: "self-question-run-v1",
    mode: "self-question",
    runId,
    generatedAt: createdAt,
    projectPath,
    dryRun,
    counts: {
      requested: questionCount,
      questions: records.length,
      candidateStocks: candidateStocks.length,
      themeCandidates: themes.filter((theme) => theme.score > 0).length,
      duplicateFiltered: filtered.duplicates.length,
    },
    planner: {
      ...planned.planner,
      selfQuestionHistoryCount: selfHistory.length,
      duplicateFilteredCount: (planned.planner?.duplicateFilteredCount ?? 0) + filtered.duplicates.length,
      duplicateSamples: filtered.duplicates.slice(0, 5),
      activePolicyCount: activePolicies.length,
      activePolicies,
    },
    sql: {
      status: sqlMetrics.status,
      warning: sqlMetrics.warning ?? null,
      nativeQuery: sqlMetrics.nativeQuery ?? null,
    },
    marketValidation: {
      externalStatus: externalMetrics.status,
      externalWarning: externalMetrics.warning ?? null,
    },
    questions: records,
    writeResult,
  }
}
