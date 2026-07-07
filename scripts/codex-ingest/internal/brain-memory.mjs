import fs from "node:fs/promises"
import https from "node:https"
import os from "node:os"
import path from "node:path"
import vm from "node:vm"
import { createHash } from "node:crypto"
import { execFile, execFileSync, spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { parse as parseYaml, stringify as stringifyYaml } from "yaml"
import { promisify } from "node:util"
import { readFileSync } from "node:fs"

import {
  buildStockDailyMarketValidation,
  parseStockLookbackDays,
  searchAskStockDaily,
} from "./ask-market.mjs"

import {
  ASK_BRAIN_EXCERPT_CHARS,
  ASK_DEFAULT_TOP_BRAIN,
  BRAIN_TYPE_TO_FILE,
  DAILY_LOOP_VALIDATION_METHOD,
  DEFAULT_PROJECT_PATH,
  SELF_TRAIN_RULES,
  appendJsonl,
  ensureDirectory,
  exists,
  jsonLineSearchText,
  listFilesRecursive,
  normalizePath,
  nowLocalTimestamp,
  parsePositiveInteger,
  projectRelative,
  readJsonlFile,
  safeErrorMessage,
  shortHash,
  stableJsonString,
  mapWithConcurrency,
} from "./core.mjs"

import {
  excerptForPrompt,
  getRecencyBoost,
  sortSearchResults,
  tokenMatchScore,
} from "./knowledge.mjs"

export function brainDir(projectPath) {
  return path.join(normalizePath(projectPath), "data", "brain")
}

export function brainFileForType(type) {
  const normalized = String(type ?? "").trim().toLowerCase().replace(/-/g, "_")
  const fileName = BRAIN_TYPE_TO_FILE.get(normalized)
  if (!fileName) throw new Error(`Unknown brain memory type: ${type}`)
  return fileName
}

export function normalizeBrainTags(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean)
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}

export function normalizeBrainResult(result) {
  const raw = String(result ?? "").trim().toLowerCase()
  const aliases = new Map([
    ["success", "success"],
    ["pass", "success"],
    ["passed", "success"],
    ["验证通过", "success"],
    ["成功", "success"],
    ["failure", "failure"],
    ["fail", "failure"],
    ["failed", "failure"],
    ["验证失败", "failure"],
    ["失败", "failure"],
    ["uncertain", "uncertain"],
    ["pending", "uncertain"],
    ["观察", "uncertain"],
    ["待继续观察", "uncertain"],
    ["存疑", "uncertain"],
  ])
  return aliases.get(raw) ?? raw
}

export function resultToValidationVerdict(result) {
  const normalized = normalizeBrainResult(result)
  if (normalized === "success") return "验证通过"
  if (normalized === "failure") return "验证失败"
  if (normalized === "uncertain") return "待继续观察"
  return String(result ?? "证据不足")
}

export function makeBrainRecordId(type, seed) {
  return `brain_${String(type).replace(/[^a-z0-9_-]+/gi, "-")}_${shortHash(`${nowLocalTimestamp()} ${seed ?? ""} ${Math.random()}`)}`
}

export function buildBrainRecord({ type, text, title, status, source, tags, related, metadata }) {
  const cleanType = String(type ?? "").trim().toLowerCase().replace(/-/g, "_")
  if (!BRAIN_TYPE_TO_FILE.has(cleanType)) throw new Error(`Unknown brain memory type: ${type}`)
  const body = String(text ?? "").trim()
  if (!body && !metadata?.prediction) throw new Error("Missing brain memory text")
  const now = nowLocalTimestamp()
  return {
    id: metadata?.id ?? makeBrainRecordId(cleanType, body || metadata?.prediction),
    type: cleanType,
    title: String(title ?? metadata?.title ?? body.slice(0, 48) ?? cleanType).trim(),
    text: body,
    status: String(status ?? metadata?.status ?? (cleanType === "thread" ? "open" : "active")),
    source: source ? String(source) : metadata?.source ?? "manual",
    tags: normalizeBrainTags(tags ?? metadata?.tags),
    related: normalizeBrainTags(related ?? metadata?.related),
    createdAt: metadata?.createdAt ?? now,
    updatedAt: metadata?.updatedAt ?? now,
    ...Object.fromEntries(Object.entries(metadata ?? {}).filter(([key]) => !["id", "title", "status", "source", "tags", "related", "createdAt", "updatedAt"].includes(key))),
  }
}

export async function rememberBrainMemory(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const record = buildBrainRecord(options)
  const fileName = brainFileForType(record.type)
  const filePath = path.join(brainDir(projectPath), fileName)
  await appendJsonl(filePath, record)
  return { projectPath, filePath, relativePath: projectRelative(projectPath, filePath), record }
}

export async function listBrainFiles(projectPath) {
  return listFilesRecursive(brainDir(projectPath), {
    extensions: new Set([".jsonl"]),
    excludeDirNames: new Set([".git", "node_modules"]),
    maxBytes: 1024 * 1024 * 5,
  }).catch(() => [])
}

export async function readBrainRecords(projectPath) {
  const pp = normalizePath(projectPath)
  const files = await listBrainFiles(pp)
  const records = []
  for (const filePath of files) {
    const relativePath = projectRelative(pp, filePath)
    const parsed = await readJsonlFile(filePath)
    for (const item of parsed) {
      records.push({
        ...item,
        path: relativePath,
        filePath,
      })
    }
  }
  return records
}

export async function searchAskBrain(projectPath, query, tokens, options = {}) {
  const pp = normalizePath(projectPath)
  const topBrain = parsePositiveInteger(options.topBrain, ASK_DEFAULT_TOP_BRAIN)
  const records = await readBrainRecords(pp)
  const results = []
  for (const item of records) {
    const parsed = item.value
    const searchText = `${item.path}\n${jsonLineSearchText(parsed)}`
    const score = tokenMatchScore(searchText, tokens) + getRecencyBoost(`${item.path}:${item.line}`, query)
    if (score <= 0) continue
    const title =
      (parsed && typeof parsed === "object" && !Array.isArray(parsed) && (parsed.title ?? parsed.subject ?? parsed.id ?? parsed.type ?? parsed.createdAt)) ||
      `${path.basename(item.path)}:${item.line}`
    results.push({
      sourceId: "brain_memory",
      path: `brain:${item.path}:${item.line}`,
      title: String(title),
      score: score + 4,
      type: "BRAIN",
      nativeQuery: `JSONL memory filter over ${item.path}`,
      excerpt: excerptForPrompt(typeof parsed === "string" ? parsed : JSON.stringify(parsed, null, 2), ASK_BRAIN_EXCERPT_CHARS),
      value: parsed,
    })
  }
  return sortSearchResults(results).slice(0, topBrain)
}

export async function getBrainStatus(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const records = await readBrainRecords(projectPath)
  const byFile = {}
  const byType = {}
  const byStatus = {}
  for (const item of records) {
    const value = item.value && typeof item.value === "object" && !Array.isArray(item.value) ? item.value : {}
    byFile[item.path] = (byFile[item.path] ?? 0) + 1
    byType[value.type ?? "unknown"] = (byType[value.type ?? "unknown"] ?? 0) + 1
    byStatus[value.status ?? "unknown"] = (byStatus[value.status ?? "unknown"] ?? 0) + 1
  }
  return { projectPath, total: records.length, byFile, byType, byStatus }
}

export async function resolveBrainMemory(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const targetId = String(options.id ?? options.targetId ?? "").trim()
  const result = normalizeBrainResult(options.result)
  if (!targetId) throw new Error("Missing brain memory id")
  if (!["success", "failure", "uncertain"].includes(result)) throw new Error("Brain resolve result must be success, failure, or uncertain")
  const record = {
    id: makeBrainRecordId("event", targetId),
    type: "event",
    eventType: "manual-resolution",
    targetId,
    result,
    verdict: resultToValidationVerdict(result),
    note: String(options.note ?? "").trim(),
    createdAt: nowLocalTimestamp(),
  }
  const filePath = path.join(brainDir(projectPath), brainFileForType("event"))
  await appendJsonl(filePath, record)
  return { projectPath, filePath, relativePath: projectRelative(projectPath, filePath), record }
}

export function validationTarget(record) {
  return String(record.target ?? record.subject ?? record.concept ?? record.pattern ?? record.stockCode ?? record.stockName ?? record.prediction ?? record.id ?? "unknown")
}

export function validationResult(record) {
  const raw = record.result ?? record.validationResult ?? record.verdict ?? record.marketValidation?.verdict
  const normalized = normalizeBrainResult(raw)
  if (normalized === "success" || normalized === "failure" || normalized === "uncertain") return normalized
  if (/通过|成功|确认/.test(String(raw ?? ""))) return "success"
  if (/失败|证伪|反向/.test(String(raw ?? ""))) return "failure"
  return "uncertain"
}

export function validationHorizonTrackKey(record) {
  const explicit = record.horizonTrackKey ?? record.supersessionKey
  if (explicit) return String(explicit)
  if (record.predictionId && record.stockCode) return `${record.predictionId}:${record.stockCode}`
  return null
}

export function isCurrentDailyValidationRecord(record) {
  return record.validationMethod === DAILY_LOOP_VALIDATION_METHOD
}

export function validationWindowSortValue(record) {
  const n = Number(record.windowDays ?? record.marketValidation?.lookbackDays)
  if (Number.isFinite(n)) return n
  return 0
}

export function collapseValidationHorizonTracks(records) {
  const passthrough = []
  const byTrack = new Map()
  for (const record of records) {
    const trackKey = validationHorizonTrackKey(record)
    if (!trackKey) {
      passthrough.push(record)
      continue
    }
    if (!byTrack.has(trackKey)) byTrack.set(trackKey, [])
    byTrack.get(trackKey).push(record)
  }
  const collapsed = [...passthrough]
  for (const [trackKey, items] of byTrack.entries()) {
    const currentMethodItems = items.filter(isCurrentDailyValidationRecord)
    const effectiveItems = currentMethodItems.length > 0 ? currentMethodItems : items
    const ordered = [...effectiveItems].sort(
      (a, b) =>
        validationWindowSortValue(a) - validationWindowSortValue(b) ||
        String(a.validationEndDate ?? a.createdAt ?? "").localeCompare(String(b.validationEndDate ?? b.createdAt ?? "")),
    )
    const concreteResults = new Set(ordered.map(validationResult).filter((item) => item === "success" || item === "failure"))
    const latest = ordered[ordered.length - 1]
    if (concreteResults.has("success") && concreteResults.has("failure")) {
      collapsed.push({
        ...latest,
        id: latest.id ? `${latest.id}_horizon_conflict` : `horizon_conflict_${shortHash(trackKey)}`,
        result: "uncertain",
        verdict: "窗口冲突待归因",
        conflict: true,
        eventType: "horizon-conflict",
        horizonTrackKey: trackKey,
        horizonResults: ordered.map((item) => ({
          id: item.id,
          windowDays: item.windowDays ?? item.marketValidation?.lookbackDays ?? null,
          result: validationResult(item),
          verdict: item.verdict ?? item.marketValidation?.verdict ?? null,
          validationStartDate: item.validationStartDate ?? item.marketValidation?.firstDate ?? null,
          validationEndDate: item.validationEndDate ?? item.marketValidation?.lastDate ?? null,
        })),
      })
    } else {
      collapsed.push({ ...latest, horizonTrackKey: trackKey })
    }
  }
  return collapsed
}

export function daysSince(value) {
  const date = new Date(String(value ?? "").slice(0, 10))
  if (Number.isNaN(date.getTime())) return null
  return Math.floor((Date.now() - date.getTime()) / 86400000)
}

export function shellArg(value) {
  return `'${String(value ?? "").replace(/'/g, "'\\''")}'`
}

export function evidenceTaskFromFundamentalGap(gap, record = {}) {
  const match = String(gap ?? "").match(/^fundamental:([^:]+):not_checked$/)
  if (!match) return null
  const signal = match[1]
  const stock = record.stockCode ?? record.stockName ?? "<stock>"
  const keyword = record.target ?? record.question ?? record.stockName ?? "<keyword>"
  const base = { signal, gap, stockCode: record.stockCode ?? null, stockName: record.stockName ?? null }
  if (signal === "cninfo_announcement") {
    return {
      ...base,
      provider: "cninfo",
      evidenceType: "announcement",
      priority: 1,
      command: `npm run codex:ingest -- company-research --stock ${shellArg(stock)} --deep --cninfo-event-from 2025-01-01`,
    }
  }
  if (signal === "qcc_tender_or_order") {
    return {
      ...base,
      provider: "qichacha",
      evidenceType: "tender_or_order",
      priority: 2,
      command: `npm run codex:ingest -- data-source qcc-tenders --keyword ${shellArg(keyword)} --msg-type 4`,
    }
  }
  if (signal === "revenue_and_margin") {
    return {
      ...base,
      provider: "tushare_or_cninfo",
      evidenceType: "financials",
      priority: 3,
      command: `npm run codex:ingest -- company-research --stock ${shellArg(stock)} --deep`,
    }
  }
  return {
    ...base,
    provider: "manual_or_external",
    evidenceType: signal,
    priority: 9,
    command: `npm run codex:ingest -- company-research --stock ${shellArg(stock)} --deep`,
  }
}

export function evidenceTasksFromFundamentalGaps(gaps, record = {}) {
  return [...new Map(
    (Array.isArray(gaps) ? gaps : [])
      .map((gap) => evidenceTaskFromFundamentalGap(gap, record))
      .filter(Boolean)
      .map((task) => [`${task.signal}:${task.provider}`, task]),
  ).values()].sort((a, b) => a.priority - b.priority || a.signal.localeCompare(b.signal))
}

export function isSelfQuestionAttributionLike(record) {
  return (
    record?.schema === "self-question-attribution-v1" ||
    record?.kind === "self-question-attribution" ||
    record?.attributionMethod === "self_question_attribution_v1"
  )
}

export function attributionRecordMatchesId(record, id) {
  const needle = String(id ?? "").trim()
  if (!needle) return true
  return [record?.id, record?.validationId, record?.questionRecordId, record?.questionId, record?.sourceRunId].some((value) => String(value ?? "") === needle)
}

function attributionEvidenceTaskKey(attribution, task) {
  const attributionKey = attribution?.id ?? attribution?.validationId ?? attribution?.questionRecordId ?? attribution?.questionId ?? stableJsonString({
    question: attribution?.question,
    target: attribution?.target,
    stockCode: attribution?.stockCode,
    stockName: attribution?.stockName,
  })
  return `${attributionKey}:${task.signal}:${task.provider}`
}

function attributionRecordIdentityKey(attribution) {
  return attribution?.id ?? attribution?.validationId ?? attribution?.questionRecordId ?? attribution?.questionId ?? stableJsonString({
    question: attribution?.question,
    target: attribution?.target,
    stockCode: attribution?.stockCode,
    stockName: attribution?.stockName,
    attributionLabel: attribution?.attributionLabel,
  })
}

export async function collectSelfQuestionEvidenceTasks(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const id = String(options.id ?? options.attributionId ?? options["attribution-id"] ?? options.questionId ?? "").trim()
  const maxTasks = parsePositiveInteger(options.maxTasks ?? options["max-tasks"], 100)
  const generatedAt = nowLocalTimestamp()
  const runId = `self_question_evidence_${generatedAt.replace(/[-: ]/g, "").slice(0, 14)}`
  const brainRecords = (await readBrainRecords(projectPath)).map((item) => item.value)
  const inlineAttributions = Array.isArray(options.attributionRecords) ? options.attributionRecords : []
  const records = [...brainRecords, ...inlineAttributions].filter((item) => item && typeof item === "object" && !Array.isArray(item))
  const attributions = [...new Map(records
    .filter(isSelfQuestionAttributionLike)
    .filter((record) => record.attributionLabel === "price_only")
    .filter((record) => attributionRecordMatchesId(record, id))
    .filter((record) => Array.isArray(record.evidenceGaps) && record.evidenceGaps.length > 0)
    .sort((a, b) => String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")))
    .map((record) => [attributionRecordIdentityKey(record), record])).values()]

  const taskMap = new Map()
  for (const attribution of attributions) {
    for (const task of evidenceTasksFromFundamentalGaps(attribution.evidenceGaps, attribution)) {
      const taskId = `evidence_task_${shortHash(attributionEvidenceTaskKey(attribution, task))}`
      if (taskMap.has(taskId)) continue
      taskMap.set(taskId, {
        id: taskId,
        type: "fundamental-evidence-task",
        status: "pending",
        createdAt: generatedAt,
        attributionId: attribution.id ?? null,
        validationId: attribution.validationId ?? null,
        questionRecordId: attribution.questionRecordId ?? null,
        questionId: attribution.questionId ?? null,
        question: attribution.question ?? null,
        target: attribution.target ?? attribution.question ?? attribution.stockName ?? attribution.stockCode ?? null,
        ...task,
      })
    }
  }

  const tasks = [...taskMap.values()].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id)).slice(0, maxTasks)
  const byProvider = Object.fromEntries(
    [...tasks.reduce((map, task) => map.set(task.provider, (map.get(task.provider) ?? 0) + 1), new Map()).entries()].sort(([a], [b]) => a.localeCompare(b)),
  )
  const dryRun = !options.write
  const run = {
    schema: "self-question-evidence-task-run-v1",
    mode: "self-question-evidence",
    runId,
    generatedAt,
    projectPath,
    dryRun,
    counts: {
      attributions: attributions.length,
      tasks: tasks.length,
      byProvider,
    },
    tasks,
    writePolicy: {
      artifacts: ".llm-wiki/evidence-tasks",
      wroteWiki: false,
      wroteRaw: false,
      wroteBrain: false,
    },
    writeResult: null,
  }
  if (!dryRun) {
    const outputDir = path.join(projectPath, ".llm-wiki", "evidence-tasks")
    await ensureDirectory(outputDir)
    const outputPath = path.join(outputDir, `${generatedAt.replace(/[-: ]/g, "").slice(0, 14)}-fundamental-evidence-tasks.json`)
    run.writeResult = { filePath: outputPath, relativePath: projectRelative(projectPath, outputPath), records: tasks.length }
    await fs.writeFile(outputPath, `${JSON.stringify(run, null, 2)}\n`, "utf8")
  }
  return run
}

function suggestedCommandsForRegressionGate(nextStages = []) {
  const commands = []
  const normalizedStages = [...new Set(nextStages.map((stage) => String(stage ?? "").trim()).filter(Boolean))]
  for (const stage of normalizedStages) {
    if (stage === "policy-regression-execute") {
      commands.push("npm run codex:ingest -- self-question loop --stages policy-regression,policy-regression-execute --execute-policy-regressions --write")
      continue
    }
    if (stage === "policy-regression-feedback") {
      commands.push("npm run codex:ingest -- self-question loop --stages policy-regression-execute,policy-regression-feedback --write")
      continue
    }
    if (stage === "policy-regression-remediation") {
      commands.push("npm run codex:ingest -- self-question loop --stages policy-regression-feedback,policy-regression-remediation --write")
      continue
    }
    if (stage === "policy-regression-verify") {
      commands.push("npm run codex:ingest -- self-question loop --stages policy-regression-verify --execute-policy-regressions --write")
      continue
    }
  }
  return commands
}

function selfTrainingActionFingerprint(action = {}) {
  return shortHash(stableJsonString({
    rule: action.rule ?? null,
    target: action.target ?? null,
    action: action.action ?? null,
    affectedIds: Array.isArray(action.affectedIds) ? action.affectedIds : [],
    evidenceGaps: Array.isArray(action.evidenceGaps) ? action.evidenceGaps : [],
    gateStatus: action.gateStatus ?? null,
    nextStages: Array.isArray(action.nextStages) ? action.nextStages : [],
  }))
}

function selfTrainingExistingActionKeys(records = []) {
  const keys = new Set()
  for (const record of records) {
    const value = record?.value
    if (!value || typeof value !== "object" || Array.isArray(value)) continue
    if (value.type !== "event" || value.eventType !== "self-training-action") continue
    if (value.id) keys.add(String(value.id))
    if (value.actionFingerprint) keys.add(String(value.actionFingerprint))
  }
  return keys
}

function normalizeSelfTrainingActionReview(value) {
  const raw = String(value ?? "").trim().toLowerCase()
  if (["approve", "approved", "accept", "accepted"].includes(raw)) return "approve"
  if (["reject", "rejected", "decline", "dismiss"].includes(raw)) return "reject"
  if (["resolve", "resolved", "close", "closed", "done"].includes(raw)) return "resolve"
  throw new Error("Self-training action review must be approve, reject, or resolve")
}

function selfTrainingActionReviewResult(action) {
  if (action === "approve") return "approved"
  if (action === "reject") return "rejected"
  return "resolved"
}

function normalizeSelfTrainingActionListStatus(value) {
  const raw = String(value ?? "all").trim().toLowerCase()
  if (!raw || raw === "all") return "all"
  if (["open", "reviewed", "approved", "rejected", "resolved"].includes(raw)) return raw
  throw new Error("Self-training action status must be open, reviewed, approved, rejected, resolved, or all")
}

function normalizeSelfTrainingActionOrder(value) {
  const raw = String(value ?? "createdAt").trim().toLowerCase()
  if (!raw || ["createdat", "created_at", "newest", "recent"].includes(raw)) return "createdAt"
  if (["priority", "next"].includes(raw)) return "priority"
  throw new Error("Self-training action order must be createdAt or priority")
}

function isSelfTrainingActionRecord(record) {
  const value = record?.value
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && value.type === "event" && value.eventType === "self-training-action")
}

function isSelfTrainingActionReviewRecord(record) {
  const value = record?.value
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && value.type === "event" && value.eventType === "self-training-action-review")
}

function selfTrainingRecordIdentity(record) {
  const value = record?.value ?? {}
  return `${record?.path ?? ""}:${record?.line ?? ""}:${value.id ?? ""}:${value.actionFingerprint ?? ""}`
}

function compareSelfTrainingRecordDesc(a, b) {
  return String(b?.value?.createdAt ?? "").localeCompare(String(a?.value?.createdAt ?? ""))
    || String(b?.path ?? "").localeCompare(String(a?.path ?? ""))
    || Number(b?.line ?? 0) - Number(a?.line ?? 0)
    || String(b?.value?.id ?? "").localeCompare(String(a?.value?.id ?? ""))
}

function selfTrainingReviewLedgerStatus(review) {
  if (!review) return "open"
  const result = String(review.result ?? "").trim().toLowerCase()
  if (["approved", "rejected", "resolved"].includes(result)) return result
  const reviewAction = String(review.reviewAction ?? "").trim().toLowerCase()
  if (reviewAction === "approve") return "approved"
  if (reviewAction === "reject") return "rejected"
  if (reviewAction === "resolve") return "resolved"
  return "reviewed"
}

function selfTrainingLedgerString(value, fallback = null) {
  const raw = String(value ?? "").trim()
  return raw ? safeErrorMessage(raw) : fallback
}

function selfTrainingLedgerArray(value) {
  return Array.isArray(value) ? sanitizePolicyRegressionFeedbackValue(value) : []
}

function summarizeSelfTrainingActionReviewRecord(record) {
  const review = record?.value ?? {}
  return sanitizePolicyRegressionFeedbackValue({
    id: review.id ?? null,
    result: selfTrainingReviewLedgerStatus(review),
    reviewAction: review.reviewAction ?? null,
    actionId: review.actionId ?? null,
    actionFingerprint: review.actionFingerprint ?? null,
    reviewer: review.reviewer ?? null,
    note: review.note ?? null,
    reviewQuality: review.reviewQuality ?? null,
    evidenceRefs: Array.isArray(review.evidenceRefs) ? review.evidenceRefs : [],
    createdAt: review.createdAt ?? null,
    path: record?.path ?? null,
    line: record?.line ?? null,
  })
}

function compareSelfTrainingLedgerItemDesc(a, b) {
  return String(b?.createdAt ?? "").localeCompare(String(a?.createdAt ?? ""))
    || String(b?.path ?? "").localeCompare(String(a?.path ?? ""))
    || Number(b?.line ?? 0) - Number(a?.line ?? 0)
    || String(b?.id ?? "").localeCompare(String(a?.id ?? ""))
}

function selfTrainingActionPriority(action = {}) {
  const rule = String(action.rule ?? "").trim()
  const gateStatus = String(action.gateStatus ?? "").trim().toLowerCase()
  if (rule === "R9-open-regression-gate" && gateStatus === "needs_remediation") {
    return { rank: 10, label: "repair-regression-gate", reason: "回归门控已经失败或需要修复，优先进入 feedback/remediation/verify 闭环" }
  }
  if (rule === "R9-open-regression-gate") {
    return { rank: 20, label: "execute-regression-gate", reason: "回归门控仍未执行，优先补齐验证而不是继续产出训练样本" }
  }
  if (rule === "R8-attribution-fundamental-gap") {
    return { rank: 30, label: "verify-fundamentals", reason: "量价先行但基本面闭环未完成，优先补公告、招投标、订单或财报证据" }
  }
  if (rule === "R4-cognitive-conflict" || String(action.action ?? "") === "create-review-task") {
    return { rank: 40, label: "review-conflict", reason: "认知冲突需要先人工复核，避免把矛盾经验写入训练样本" }
  }
  if (rule === "R6-error-guardrail-escalation") {
    return { rank: 50, label: "escalate-guardrail", reason: "重复错误需要沉淀为 guardrail 候选" }
  }
  return { rank: 80, label: "review-action", reason: "普通自训练动作，按时间顺序处理" }
}

function compareSelfTrainingLedgerPriority(a, b) {
  return Number(a?.priority?.rank ?? 999) - Number(b?.priority?.rank ?? 999)
    || compareSelfTrainingLedgerItemDesc(a, b)
}

function selfTrainingActionPlanStepId(action, seed) {
  return `self_training_step_${shortHash(`${action.id ?? action.actionFingerprint ?? ""}:${seed}`)}`
}

function selfTrainingActionPlanSteps(action = {}) {
  const evidenceTasks = Array.isArray(action.evidenceTasks) ? action.evidenceTasks : []
  if (evidenceTasks.length > 0) {
    return evidenceTasks.map((task, index) => sanitizePolicyRegressionFeedbackValue({
      id: selfTrainingActionPlanStepId(action, `evidence:${task.id ?? task.signal ?? index}`),
      type: "evidence-task",
      status: "planned",
      autoExecute: false,
      provider: task.provider ?? null,
      signal: task.signal ?? null,
      evidenceType: task.evidenceType ?? null,
      command: task.command ? safeErrorMessage(task.command) : null,
      sourceTask: task,
    }))
  }
  const commands = Array.isArray(action.suggestedCommands) ? action.suggestedCommands.filter(Boolean) : []
  if (commands.length > 0) {
    return commands.map((command, index) => sanitizePolicyRegressionFeedbackValue({
      id: selfTrainingActionPlanStepId(action, `command:${index}:${command}`),
      type: "command",
      status: "planned",
      autoExecute: false,
      command: safeErrorMessage(command),
      requiresExplicitWrite: /\s--write(?:\s|$)/.test(String(command)),
    }))
  }
  return [sanitizePolicyRegressionFeedbackValue({
    id: selfTrainingActionPlanStepId(action, "manual-review"),
    type: "manual-review",
    status: "planned",
    autoExecute: false,
    instruction: "Review this self-training action and close it with self-train review after the evidence or remediation is handled.",
    command: action.id ? `npm run codex:ingest -- self-train review --id ${shellArg(action.id)} --action resolve --write` : null,
  })]
}

async function resolveSelfTrainingPlanPath(projectPath, generatedAt) {
  const outputDir = path.join(projectPath, ".llm-wiki", "self-training-plans")
  const compactStamp = String(generatedAt ?? nowLocalTimestamp()).replace(/\D/g, "").slice(0, 14) || nowLocalTimestamp().replace(/\D/g, "").slice(0, 14)
  let attempt = 0
  while (true) {
    const suffix = attempt === 0 ? compactStamp : `${compactStamp}-${attempt}`
    const outputPath = path.join(outputDir, `${suffix}-self-training-plan.json`)
    if (!(await exists(outputPath))) return { outputDir, outputPath }
    attempt += 1
  }
}

function selfTrainingPlanPathSequence(relativePath) {
  const match = path.basename(String(relativePath ?? "")).match(/^\d{14}(?:-(\d+))?-self-training-plan\.json$/)
  return match?.[1] ? Number(match[1]) : 0
}

function resolveSelfTrainingPlanInputPath(projectPath, input) {
  const raw = String(input ?? "").trim()
  if (!raw) return { filePath: null, relativePath: null, outsideProject: false }
  const filePath = normalizePath(path.isAbsolute(raw) ? raw : path.join(projectPath, raw))
  const relativeNative = path.relative(projectPath, filePath)
  const outsideProject = relativeNative === ".." || relativeNative.startsWith(`..${path.sep}`) || path.isAbsolute(relativeNative)
  return {
    filePath,
    relativePath: projectRelative(projectPath, filePath),
    outsideProject,
  }
}

function selfTrainingPlanVerifyIssue(code, message, details = {}) {
  return sanitizePolicyRegressionFeedbackValue({ code, message, ...details })
}

function selfTrainingPlanValueHasSecret(value) {
  const text = String(value ?? "")
  if (!text.trim()) return false
  const assignmentPattern = /\b(?:pass(?:word|wd)?|pwd|token|api[_-]?key|access[_-]?secret|secret(?:[_-]?key|key)?)\s*=\s*(?!\[redacted\]\b)[^\s,;]+/i
  const flagPattern = /--(?:api-key|token|pass(?:word|wd)?|pwd|secret-key)\s+(?!\[redacted\]\b)[^\s,;]+/i
  return assignmentPattern.test(text) || flagPattern.test(text)
}

function selfTrainingPlanActionSteps(action) {
  return Array.isArray(action?.steps) ? action.steps : []
}

function summarizeSelfTrainingPlanIssues(parsed) {
  const issues = []
  if (parsed?.schema !== "self-training-action-plan-run-v1") {
    issues.push(selfTrainingPlanVerifyIssue("invalid_schema", "Plan artifact schema is not self-training-action-plan-run-v1.", {
      actualSchema: parsed?.schema ?? null,
    }))
  }
  if (parsed?.mode !== "self-train-plan") {
    issues.push(selfTrainingPlanVerifyIssue("invalid_mode", "Plan artifact mode is not self-train-plan.", {
      actualMode: parsed?.mode ?? null,
    }))
  }
  const actions = Array.isArray(parsed?.actions) ? parsed.actions : []
  if (!Array.isArray(parsed?.actions)) {
    issues.push(selfTrainingPlanVerifyIssue("actions_not_array", "Plan artifact actions must be an array."))
  }
  const stepCount = actions.reduce((sum, action) => sum + selfTrainingPlanActionSteps(action).length, 0)
  if (Number(parsed?.counts?.actions) !== actions.length) {
    issues.push(selfTrainingPlanVerifyIssue("action_count_mismatch", "Plan action count does not match actions.length.", {
      declared: parsed?.counts?.actions ?? null,
      actual: actions.length,
    }))
  }
  if (Number(parsed?.counts?.steps) !== stepCount) {
    issues.push(selfTrainingPlanVerifyIssue("step_count_mismatch", "Plan step count does not match the sum of action steps.", {
      declared: parsed?.counts?.steps ?? null,
      actual: stepCount,
    }))
  }
  const writePolicy = parsed?.writePolicy ?? {}
  for (const key of ["wroteWiki", "wroteRaw", "wroteBrain", "autoExecuted"]) {
    if (writePolicy[key] !== false) {
      issues.push(selfTrainingPlanVerifyIssue("write_policy_not_read_only", "Plan writePolicy must keep wiki/raw/brain writes and auto execution disabled.", {
        field: `writePolicy.${key}`,
        actual: writePolicy[key] ?? null,
      }))
    }
  }
  actions.forEach((action, actionIndex) => {
    if (action?.status !== "planned") {
      issues.push(selfTrainingPlanVerifyIssue("unexpected_action_status", "Plan action status must stay planned.", {
        actionIndex,
        actionId: action?.id ?? null,
        actualStatus: action?.status ?? null,
      }))
    }
    if (!action?.sourceActionId && !action?.sourceActionFingerprint) {
      issues.push(selfTrainingPlanVerifyIssue("missing_source_action_ref", "Plan action must retain a source action id or fingerprint.", {
        actionIndex,
        actionId: action?.id ?? null,
      }))
    }
    if (!Array.isArray(action?.steps) || action.steps.length === 0) {
      issues.push(selfTrainingPlanVerifyIssue("missing_action_steps", "Plan action must include at least one planned step.", {
        actionIndex,
        actionId: action?.id ?? null,
      }))
    }
    if (selfTrainingPlanValueHasSecret(action?.reviewCommand)) {
      issues.push(selfTrainingPlanVerifyIssue("secret_pattern_detected", "Plan reviewCommand appears to contain an unredacted secret.", {
        actionIndex,
        actionId: action?.id ?? null,
        field: "reviewCommand",
      }))
    }
    selfTrainingPlanActionSteps(action).forEach((step, stepIndex) => {
      if (!step?.type) {
        issues.push(selfTrainingPlanVerifyIssue("missing_step_type", "Plan step must declare a type.", {
          actionIndex,
          stepIndex,
          stepId: step?.id ?? null,
        }))
      }
      if (step?.status !== "planned") {
        issues.push(selfTrainingPlanVerifyIssue("unexpected_step_status", "Plan step status must stay planned.", {
          actionIndex,
          stepIndex,
          stepId: step?.id ?? null,
          actualStatus: step?.status ?? null,
        }))
      }
      if (step?.autoExecute !== false) {
        issues.push(selfTrainingPlanVerifyIssue("auto_execute_enabled", "Plan steps must never enable autoExecute.", {
          actionIndex,
          stepIndex,
          stepId: step?.id ?? null,
          actualAutoExecute: step?.autoExecute ?? null,
        }))
      }
      if ((step?.type === "command" || step?.type === "evidence-task") && !String(step?.command ?? "").trim()) {
        issues.push(selfTrainingPlanVerifyIssue("missing_step_command", "Command and evidence-task steps must include an explicit command for human handoff.", {
          actionIndex,
          stepIndex,
          stepId: step?.id ?? null,
          stepType: step?.type ?? null,
        }))
      }
      if (selfTrainingPlanValueHasSecret(step?.command)) {
        issues.push(selfTrainingPlanVerifyIssue("secret_pattern_detected", "Plan command appears to contain an unredacted secret.", {
          actionIndex,
          stepIndex,
          stepId: step?.id ?? null,
          field: "command",
        }))
      }
    })
  })
  return {
    issues,
    actionCount: actions.length,
    stepCount,
  }
}

async function verifySelfTrainingPlanFile(projectPath, filePath, preflightIssues = []) {
  const relativePath = projectRelative(projectPath, filePath)
  const issues = [...preflightIssues]
  if (preflightIssues.length > 0) {
    return sanitizePolicyRegressionFeedbackValue({
      status: "needs_remediation",
      relativePath,
      filePath,
      schema: null,
      mode: null,
      runId: null,
      generatedAt: null,
      actionCount: 0,
      stepCount: 0,
      issues,
    })
  }
  try {
    const text = await fs.readFile(filePath, "utf8")
    const parsed = JSON.parse(text)
    const summary = summarizeSelfTrainingPlanIssues(parsed)
    const status = summary.issues.length > 0 ? "needs_remediation" : "ok"
    return sanitizePolicyRegressionFeedbackValue({
      status,
      relativePath,
      filePath,
      schema: parsed?.schema ?? null,
      mode: parsed?.mode ?? null,
      runId: parsed?.runId ?? null,
      generatedAt: parsed?.generatedAt ?? null,
      actionCount: summary.actionCount,
      stepCount: summary.stepCount,
      counts: parsed?.counts ?? null,
      writePolicy: parsed?.writePolicy ?? null,
      issues: summary.issues,
    })
  } catch (error) {
    return sanitizePolicyRegressionFeedbackValue({
      status: "needs_remediation",
      relativePath,
      filePath,
      schema: null,
      mode: null,
      runId: null,
      generatedAt: null,
      actionCount: 0,
      stepCount: 0,
      issues: [
        selfTrainingPlanVerifyIssue("plan_read_or_parse_failed", "Plan artifact could not be read or parsed.", {
          error: safeErrorMessage(error?.message ?? error),
        }),
      ],
    })
  }
}

async function listSelfTrainingPlanVerifyFiles(projectPath, limit) {
  const planDir = path.join(projectPath, ".llm-wiki", "self-training-plans")
  const files = await listFilesRecursive(planDir, {
    extensions: new Set([".json"]),
    excludeDirNames: new Set([".git", "node_modules"]),
    maxBytes: 1024 * 1024 * 5,
  }).catch(() => [])
  const entries = []
  for (const filePath of files) {
    const relativePath = projectRelative(projectPath, filePath)
    try {
      const stat = await fs.stat(filePath)
      entries.push({ filePath, relativePath, mtimeMs: stat.mtimeMs })
    } catch {
      entries.push({ filePath, relativePath, mtimeMs: 0 })
    }
  }
  return entries.sort((a, b) => Number(b.mtimeMs ?? 0) - Number(a.mtimeMs ?? 0)
    || Number(selfTrainingPlanPathSequence(b.relativePath)) - Number(selfTrainingPlanPathSequence(a.relativePath))
    || String(b.relativePath ?? "").localeCompare(String(a.relativePath ?? "")))
    .slice(0, limit)
}

function selfTrainingReviewedActionKeys(records = []) {
  const keys = new Set()
  for (const record of records) {
    const value = record?.value
    if (!value || typeof value !== "object" || Array.isArray(value)) continue
    if (value.type !== "event" || value.eventType !== "self-training-action-review") continue
    if (value.actionId) keys.add(String(value.actionId))
    if (value.actionFingerprint) keys.add(String(value.actionFingerprint))
  }
  return keys
}

function findSelfTrainingActionRecord(records = [], options = {}) {
  const actionId = String(options.actionId ?? options.id ?? "").trim()
  const actionFingerprint = String(options.actionFingerprint ?? options.fingerprint ?? "").trim()
  if (!actionId && !actionFingerprint) throw new Error("Missing --id or --action-fingerprint")
  const matches = records
    .map((record) => record?.value)
    .filter((value) => value && typeof value === "object" && !Array.isArray(value))
    .filter((value) => value.type === "event" && value.eventType === "self-training-action")
    .filter((value) => {
      if (actionId && value.id === actionId) return true
      if (actionFingerprint && value.actionFingerprint === actionFingerprint) return true
      return false
    })
  if (matches.length === 0) throw new Error(actionId ? `Self-training action not found: ${actionId}` : `Self-training action not found for fingerprint: ${actionFingerprint}`)
  if (matches.length > 1) throw new Error("Multiple self-training actions matched; pass a unique --id")
  return matches[0]
}

export function buildSelfTrainingActionsFromRecords(records) {
  const validationRecords = records
    .map((item) => item.value)
    .filter((item) => item && typeof item === "object" && !Array.isArray(item))
    .filter((item) => item.type === "validation" || item.kind === "validation" || item.marketValidation)
  const collapsedValidationRecords = collapseValidationHorizonTracks(validationRecords)
  const correctionRecords = records
    .map((item) => item.value)
    .filter((item) => item && typeof item === "object" && !Array.isArray(item))
    .filter((item) => item.type === "correction" || item.type === "guardrail" || item.kind === "mistake-case")
  const attributionRecords = records
    .map((item) => item.value)
    .filter((item) => item && typeof item === "object" && !Array.isArray(item))
    .filter((item) => item.type === "attribution" || item.kind === "self-question-attribution" || item.attributionMethod)
  const openGateEventRecords = records
    .map((item) => item.value)
    .filter((item) => item && typeof item === "object" && !Array.isArray(item))
    .filter((item) => item.type === "event" && item.eventType === "self-question-loop-gate")
    .filter((item) => ["planned", "needs_remediation"].includes(String(item.gateStatus ?? item.status ?? "").trim().toLowerCase()))
  const actions = []
  const byTarget = new Map()
  for (const record of collapsedValidationRecords) {
    const target = validationTarget(record)
    if (!byTarget.has(target)) byTarget.set(target, [])
    byTarget.get(target).push(record)
  }
  for (const [target, items] of byTarget.entries()) {
    const ordered = [...items].sort((a, b) => String(a.createdAt ?? a.date ?? "").localeCompare(String(b.createdAt ?? b.date ?? "")))
    const results = ordered.map(validationResult)
    const trailing = []
    for (let i = results.length - 1; i >= 0; i--) {
      if (results[i] === "uncertain") break
      if (trailing.length > 0 && results[i] !== trailing[0]) break
      trailing.push(results[i])
    }
    const successCount = results.filter((item) => item === "success").length
    const failureCount = results.filter((item) => item === "failure").length
    const winRate = results.length > 0 ? successCount / results.length : 0
    const latest = ordered[ordered.length - 1]
    if (trailing[0] === "success" && trailing.length >= 3) {
      actions.push({ rule: "R1-concept-upgrade", target, action: "upgrade-confidence", reason: "连续 3 次验证成功", affectedIds: ordered.slice(-3).map((item) => item.id).filter(Boolean) })
    }
    if (trailing[0] === "failure" && trailing.length >= 2) {
      actions.push({ rule: "R2-concept-downgrade", target, action: "downgrade-confidence", reason: "连续 2 次验证失败", affectedIds: ordered.slice(-2).map((item) => item.id).filter(Boolean) })
    }
    if (/模式|pattern/i.test(String(latest?.targetType ?? latest?.type ?? latest?.kind ?? target)) && results.length >= 5 && winRate > 0.8) {
      actions.push({ rule: "R3-pattern-solidify", target, action: "solidify-pattern", reason: `模式验证 ${results.length} 次且胜率 ${Math.round(winRate * 100)}%`, affectedIds: ordered.map((item) => item.id).filter(Boolean) })
    }
    if (ordered.some((item) => item.conflict || item.eventType === "cognitive-conflict")) {
      actions.push({ rule: "R4-cognitive-conflict", target, action: "create-review-task", reason: "出现认知冲突记录", affectedIds: ordered.map((item) => item.id).filter(Boolean) })
    }
    const stale = ordered.find((item) => ["open", "pending", "active"].includes(String(item.status ?? "").toLowerCase()) && daysSince(item.lastValidatedAt ?? item.updatedAt ?? item.createdAt ?? item.date) >= 15)
    if (stale) {
      actions.push({ rule: "R5-stale-validation-decay", target, action: "decay-to-observe", reason: "超过 15 天无验证更新", affectedIds: [stale.id].filter(Boolean) })
    }
    if (failureCount >= 3) {
      actions.push({ rule: "R7-hypothesis-review", target, action: "review-hypothesis", reason: "多次被市场反向验证", affectedIds: ordered.filter((item) => validationResult(item) === "failure").map((item) => item.id).filter(Boolean) })
    }
  }
  const correctionBuckets = new Map()
  for (const record of correctionRecords) {
    const key = String(record.errorType ?? record.subject ?? record.title ?? record.text ?? "unknown")
    if (!correctionBuckets.has(key)) correctionBuckets.set(key, [])
    correctionBuckets.get(key).push(record)
  }
  for (const [target, items] of correctionBuckets.entries()) {
    if (items.length >= 2) {
      actions.push({ rule: "R6-error-guardrail-escalation", target, action: "escalate-guardrail", reason: "同一错误类型重复出现，升级为 L4 卫语句候选", affectedIds: items.map((item) => item.id).filter(Boolean) })
    }
  }
  for (const record of attributionRecords) {
    const evidenceGaps = Array.isArray(record.evidenceGaps) ? record.evidenceGaps.filter(Boolean) : []
    if (record.attributionLabel === "price_only" && evidenceGaps.length > 0) {
      const evidenceTasks = evidenceTasksFromFundamentalGaps(evidenceGaps, record)
      actions.push({
        rule: "R8-attribution-fundamental-gap",
        target: String(record.target ?? record.question ?? record.stockName ?? record.stockCode ?? "unknown"),
        action: "verify-fundamentals",
        reason: "归因为量价先行但基本面闭环未完成，需要补公告、招投标、订单或财报证据",
        affectedIds: [record.id].filter(Boolean),
        evidenceGaps,
        evidenceTasks,
        nextAction: record.nextAction ?? "verify_fundamentals",
      })
    }
  }
  for (const record of openGateEventRecords) {
    const gateStatus = String(record.gateStatus ?? record.status ?? "").trim().toLowerCase()
    const nextStages = Array.isArray(record.recommendedNextStages) ? record.recommendedNextStages.filter(Boolean) : []
    actions.push({
      rule: "R9-open-regression-gate",
      target: String(record.stage ?? "policy-regression-gate"),
      action: gateStatus === "planned" ? "execute-regression-gate" : "repair-regression-gate",
      reason: gateStatus === "planned"
        ? "回归门控仍是 planned，需要执行回归验证后才能宣称闭环"
        : "回归门控需要修复，需要进入 feedback/remediation 后再复验",
      affectedIds: [record.id].filter(Boolean),
      loopRunId: record.loopRunId ?? null,
      gateStatus,
      nextStages,
      suggestedCommands: suggestedCommandsForRegressionGate(nextStages),
      commandFailures: record.commandFailures ?? 0,
      evaluationFailed: record.evaluationFailed ?? 0,
      evaluationSkipped: record.evaluationSkipped ?? 0,
    })
  }
  return actions.map((action) => {
    const actionFingerprint = selfTrainingActionFingerprint(action)
    return {
      id: `self_train_${actionFingerprint}`,
      actionFingerprint,
      createdAt: nowLocalTimestamp(),
      ...action,
    }
  })
}

export async function proposeSelfQuestionPolicies(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const minOccurrences = parsePositiveInteger(options.minOccurrences ?? options["min-occurrences"], 2)
  const generatedAt = nowLocalTimestamp()
  const runId = `self_question_policy_${generatedAt.replace(/[-: ]/g, "").slice(0, 14)}`
  const brainRecords = (await readBrainRecords(projectPath)).map((item) => item.value)
  const inlineAttributions = Array.isArray(options.attributionRecords) ? options.attributionRecords : []
  const records = [...brainRecords, ...inlineAttributions].filter((item) => item && typeof item === "object" && !Array.isArray(item))
  const attributions = [...new Map(records
    .filter(isSelfQuestionAttributionLike)
    .filter((record) => record.attributionLabel === "price_only")
    .filter((record) => Array.isArray(record.evidenceGaps) && record.evidenceGaps.length > 0)
    .sort((a, b) => String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")))
    .map((record) => [attributionRecordIdentityKey(record), record])).values()]

  const byGap = new Map()
  for (const attribution of attributions) {
    for (const gap of [...new Set(attribution.evidenceGaps.filter(Boolean))]) {
      if (!byGap.has(gap)) byGap.set(gap, [])
      byGap.get(gap).push(attribution)
    }
  }

  const proposals = [...byGap.entries()]
    .filter(([, items]) => items.length >= minOccurrences)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([evidenceGap, items]) => {
      const sourceAttributionIds = items.map((item) => item.id).filter(Boolean)
      const regressionQuestions = [...new Set(items.map((item) => item.question ?? item.hypothesis ?? item.target).filter(Boolean))].slice(0, 8)
      const affectedTargets = [...new Set(items.map((item) => item.target ?? item.stockName ?? item.stockCode).filter(Boolean))].slice(0, 12)
      return {
        schema: "trading-ai-policy-proposal-v1",
        policyId: `policy_proposal_${shortHash(`price_only:${evidenceGap}:${sourceAttributionIds.join(",")}`)}`,
        status: "proposed",
        scope: "self-question.validation_policy",
        rule: "must_run_evidence_stage_before_high_confidence",
        trigger: `attributionLabel=price_only evidenceGap=${evidenceGap}`,
        evidenceGap,
        occurrenceCount: items.length,
        rationale: "重复出现量价先行但基本面证据未闭环，下一轮高置信结论前必须先生成或完成补证任务。",
        proposedPolicy: {
          requireEvidenceStage: true,
          blockHighConfidenceWhenQualityGate: "needs_evidence",
          requiredEvidenceGap: evidenceGap,
        },
        affectedTargets,
        sourceAttributionIds,
        regressionQuestions,
      }
    })

  const dryRun = !options.write
  const run = {
    schema: "trading-ai-policy-proposal-run-v1",
    mode: "self-question-policy",
    runId,
    generatedAt,
    projectPath,
    dryRun,
    counts: {
      attributions: attributions.length,
      proposals: proposals.length,
      minOccurrences,
    },
    proposals,
    writePolicy: {
      artifacts: ".llm-wiki/policy-proposals",
      wroteWiki: false,
      wroteRaw: false,
      wroteBrain: false,
    },
    writeResult: null,
  }
  if (!dryRun) {
    const outputDir = path.join(projectPath, ".llm-wiki", "policy-proposals")
    await ensureDirectory(outputDir)
    const outputPath = path.join(outputDir, `${generatedAt.replace(/[-: ]/g, "").slice(0, 14)}-policy-proposals.json`)
    run.writeResult = { filePath: outputPath, relativePath: projectRelative(projectPath, outputPath), records: proposals.length }
    await fs.writeFile(outputPath, `${JSON.stringify(run, null, 2)}\n`, "utf8")
  }
  return run
}

function normalizeEvidenceResult(value) {
  const raw = String(value ?? "").trim().toLowerCase()
  const aliases = new Map([
    ["confirm", "confirmed"],
    ["confirmed", "confirmed"],
    ["success", "confirmed"],
    ["pass", "confirmed"],
    ["验证通过", "confirmed"],
    ["refute", "refuted"],
    ["refuted", "refuted"],
    ["reject", "refuted"],
    ["failure", "refuted"],
    ["fail", "refuted"],
    ["证伪", "refuted"],
    ["insufficient", "insufficient"],
    ["unknown", "insufficient"],
    ["uncertain", "insufficient"],
    ["证据不足", "insufficient"],
  ])
  const result = aliases.get(raw) ?? raw
  if (!["confirmed", "refuted", "insufficient"].includes(result)) throw new Error("Evidence result must be confirmed, refuted, or insufficient")
  return result
}

function normalizeEvidenceResultSourceRefs(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean)
  return String(value ?? "")
    .split(/[,，\n|]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

export async function recordSelfQuestionEvidenceResult(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const task = options.task && typeof options.task === "object" && !Array.isArray(options.task) ? options.task : {}
  const taskId = String(options.taskId ?? options["task-id"] ?? options.id ?? task.id ?? "").trim()
  if (!taskId) throw new Error("Missing evidence task id")
  const result = normalizeEvidenceResult(options.result ?? options.status)
  const createdAt = nowLocalTimestamp()
  const evidenceGap = String(options.evidenceGap ?? options["evidence-gap"] ?? task.evidenceGap ?? (task.signal ? `fundamental:${task.signal}:not_checked` : "")).trim() || null
  const record = {
    schema: "self-question-evidence-result-v1",
    id: `evidence_result_${shortHash(`${createdAt}:${taskId}:${result}:${String(options.summary ?? "")}`)}`,
    type: "evidence_result",
    kind: "self-question-evidence-result",
    taskId,
    attributionId: options.attributionId ?? options["attribution-id"] ?? task.attributionId ?? null,
    validationId: options.validationId ?? options["validation-id"] ?? task.validationId ?? null,
    questionRecordId: options.questionRecordId ?? options["question-record-id"] ?? task.questionRecordId ?? null,
    questionId: options.questionId ?? options["question-id"] ?? task.questionId ?? null,
    provider: options.provider ?? task.provider ?? null,
    signal: options.signal ?? task.signal ?? null,
    evidenceGap,
    stockCode: options.stockCode ?? options["stock-code"] ?? task.stockCode ?? null,
    stockName: options.stockName ?? options["stock-name"] ?? task.stockName ?? null,
    target: options.target ?? task.target ?? null,
    command: options.command ?? task.command ?? null,
    result,
    status: result === "insufficient" ? "insufficient" : "resolved",
    summary: String(options.summary ?? options.note ?? "").trim(),
    sourceRefs: normalizeEvidenceResultSourceRefs(options.sourceRefs ?? options["source-refs"] ?? options.sourceRef ?? options.source),
    createdAt,
  }
  const dryRun = !options.write
  let writeResult = null
  if (!dryRun) {
    const filePath = path.join(brainDir(projectPath), brainFileForType("evidence_result"))
    await appendJsonl(filePath, record)
    writeResult = { filePath, relativePath: projectRelative(projectPath, filePath), records: 1 }
  }
  return {
    schema: "self-question-evidence-result-run-v1",
    mode: "self-question-evidence-result",
    projectPath,
    dryRun,
    record,
    writePolicy: {
      evidenceResults: "data/brain/evidence_results.jsonl only when --write is present",
      wroteWiki: false,
      wroteRaw: false,
    },
    writeResult,
  }
}

function normalizePolicyReviewAction(value) {
  const raw = String(value ?? "").trim().toLowerCase()
  if (["approve", "approved", "accept", "activate"].includes(raw)) return "approve"
  if (["reject", "rejected", "decline", "dismiss"].includes(raw)) return "reject"
  throw new Error("Policy review action must be approve or reject")
}

function resolveProjectFile(projectPath, maybeRelativePath) {
  const raw = String(maybeRelativePath ?? "").trim()
  if (!raw) return null
  return normalizePath(path.isAbsolute(raw) ? raw : path.join(projectPath, raw))
}

function activePolicyIdForProposal(proposal, options = {}) {
  const explicit = String(options.activePolicyId ?? options["active-policy-id"] ?? "").trim()
  if (explicit) return explicit
  const proposalId = String(proposal?.policyId ?? "").trim()
  if (proposalId.startsWith("policy_proposal_")) return proposalId.replace(/^policy_proposal_/, "policy_")
  return `policy_${shortHash(`${proposal?.scope ?? ""}:${proposal?.rule ?? ""}:${proposal?.evidenceGap ?? proposalId}`)}`
}

function policyProposalRunCandidates(raw) {
  if (Array.isArray(raw?.proposals)) return raw.proposals
  if (raw?.schema === "trading-ai-policy-proposal-v1") return [raw]
  return []
}

async function readPolicyProposalCandidates(filePath) {
  const raw = JSON.parse(await fs.readFile(filePath, "utf8"))
  return policyProposalRunCandidates(raw)
}

async function findSelfQuestionPolicyProposal(projectPath, options = {}) {
  const policyId = String(options.policyId ?? options.id ?? "").trim()
  const proposalPath = resolveProjectFile(projectPath, options.proposalPath ?? options.proposal ?? options["proposal-path"])
  const files = proposalPath
    ? [proposalPath]
    : (await listFilesRecursive(path.join(projectPath, ".llm-wiki", "policy-proposals"), {
      extensions: new Set([".json"]),
      excludeDirNames: new Set([".git", "node_modules"]),
      maxBytes: 1024 * 1024 * 5,
    }).catch(() => [])).sort().reverse()

  const matches = []
  for (const filePath of files) {
    let proposals = []
    try {
      proposals = await readPolicyProposalCandidates(filePath)
    } catch (err) {
      if (proposalPath) throw err
      continue
    }
    for (const proposal of proposals) {
      if (!proposal || typeof proposal !== "object" || Array.isArray(proposal)) continue
      if (policyId && proposal.policyId !== policyId) continue
      matches.push({ proposal, filePath })
    }
  }
  if (matches.length === 0) throw new Error(policyId ? `Policy proposal not found: ${policyId}` : "Policy proposal not found")
  if (!policyId && matches.length > 1) throw new Error("Multiple policy proposals found; pass --policy-id")
  return matches[0]
}

function buildActivePolicyFromProposal(proposal, options = {}, reviewedAt = nowLocalTimestamp()) {
  const policyId = activePolicyIdForProposal(proposal, options)
  return {
    schema: "trading-ai-policy-v1",
    id: policyId,
    type: "policy",
    policyId,
    status: "active",
    scope: proposal.scope ?? "self-question.validation_policy",
    rule: proposal.rule,
    trigger: proposal.trigger,
    evidenceGap: proposal.evidenceGap ?? null,
    proposedPolicy: proposal.proposedPolicy ?? null,
    rationale: proposal.rationale ?? null,
    sourceProposalId: proposal.policyId ?? null,
    sourceAttributionIds: Array.isArray(proposal.sourceAttributionIds) ? proposal.sourceAttributionIds : [],
    regressionQuestions: Array.isArray(proposal.regressionQuestions) ? proposal.regressionQuestions : [],
    affectedTargets: Array.isArray(proposal.affectedTargets) ? proposal.affectedTargets : [],
    reviewer: String(options.reviewer ?? "").trim() || "manual",
    reviewNote: String(options.note ?? "").trim(),
    approvedAt: reviewedAt,
    createdAt: reviewedAt,
    updatedAt: reviewedAt,
  }
}

function isActivePolicyRecord(record) {
  return record?.schema === "trading-ai-policy-v1" && record?.type === "policy" && record?.status === "active"
}

function isPolicyReviewEvent(record) {
  return record?.type === "event" && record?.eventType === "policy-review"
}

export async function listActiveSelfQuestionPolicies(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const records = (await readBrainRecords(projectPath)).map((item) => item.value).filter((item) => item && typeof item === "object" && !Array.isArray(item))
  const policyMap = new Map()
  for (const policy of records.filter(isActivePolicyRecord)) {
    policyMap.set(policy.policyId ?? policy.id, policy)
  }
  const policies = [...policyMap.values()].sort((a, b) => String(a.approvedAt ?? a.createdAt ?? "").localeCompare(String(b.approvedAt ?? b.createdAt ?? "")) || String(a.policyId ?? "").localeCompare(String(b.policyId ?? "")))
  const reviewEvents = records
    .filter(isPolicyReviewEvent)
    .sort((a, b) => String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")))
  return {
    projectPath,
    counts: {
      active: policies.length,
      reviewEvents: reviewEvents.length,
    },
    policies,
    reviewEvents,
  }
}

export function activePolicyRegressionQuestions(policy = {}, options = {}) {
  const maxQuestions = parsePositiveInteger(options.maxQuestionsPerPolicy ?? options["max-questions-per-policy"], 8)
  const questions = Array.isArray(policy.regressionQuestions)
    ? policy.regressionQuestions.map((item) => String(item ?? "").trim()).filter(Boolean)
    : []
  if (questions.length > 0) return [...new Set(questions)].slice(0, maxQuestions)
  const gap = String(policy.evidenceGap ?? "required_evidence:not_checked").trim()
  const rule = String(policy.rule ?? (policy.proposedPolicy ? stableJsonString(policy.proposedPolicy) : "active policy")).trim()
  return [`当 ${gap} 未完成时，${rule} 是否会先披露证据缺口、降低置信度，并避免直接给高置信交易结论？`]
}

function normalizePolicyRegressionAssertions(value = {}) {
  const normalized = {}
  const add = (caseType, assertion) => {
    const key = String(caseType ?? "all").trim() || "all"
    const clean = sanitizePolicyRegressionString(assertion, null)
    if (!clean) return
    if (!normalized[key]) normalized[key] = []
    normalized[key].push(clean)
  }
  if (Array.isArray(value)) {
    for (const assertion of value) add("all", assertion)
  } else if (value && typeof value === "object") {
    for (const [caseType, assertions] of Object.entries(value)) {
      if (Array.isArray(assertions)) {
        for (const assertion of assertions) add(caseType, assertion)
      } else {
        add(caseType, assertions)
      }
    }
  }
  return Object.fromEntries(
    Object.entries(normalized)
      .map(([caseType, assertions]) => [caseType, [...new Set(assertions)]])
      .filter(([, assertions]) => assertions.length > 0)
      .sort(([a], [b]) => a.localeCompare(b)),
  )
}

function policyRegressionExpectedAssertions(policy = {}, caseType, defaults = []) {
  const assertionMap = normalizePolicyRegressionAssertions(policy.regressionAssertions)
  return [...new Set([
    ...defaults,
    ...(assertionMap.all ?? []),
    ...(assertionMap[caseType] ?? []),
  ].filter(Boolean))]
}

export function buildActivePolicyRegressionCases(policy = {}, options = {}) {
  const policyId = String(policy.policyId ?? policy.id ?? "unknown-policy")
  const questions = activePolicyRegressionQuestions(policy, options)
  const base = {
    policyId,
    scope: policy.scope ?? null,
    rule: policy.rule ?? null,
    evidenceGap: policy.evidenceGap ?? null,
    proposedPolicy: policy.proposedPolicy ?? null,
    sourceProposalId: policy.sourceProposalId ?? null,
  }
  return questions.flatMap((question, questionIndex) => {
    const common = {
      schema: "trading-ai-policy-regression-case-v1",
      type: "eval_case",
      ...base,
      sourceQuestion: question,
      questionIndex: questionIndex + 1,
    }
    return [
      {
        ...common,
        id: `policy_reg_${shortHash(`${policyId}:ask:${question}`)}`,
        caseType: "ask-answer",
        query: question,
        commandTemplate: "npm run codex:ingest -- ask --query <query> --sources wiki,raw,brain,stock-price --show-sources",
        expectedAssertions: policyRegressionExpectedAssertions(policy, "ask-answer", [
          "disclose_evidence_gap",
          "lower_confidence_when_evidence_missing",
          "cite_or_request_required_sources",
        ]),
      },
      {
        ...common,
        id: `policy_reg_${shortHash(`${policyId}:daily-loop:${question}`)}`,
        caseType: "daily-loop-planner",
        query: question,
        commandTemplate: "npm run codex:ingest -- daily-loop --mode premarket --show-context",
        expectedAssertions: policyRegressionExpectedAssertions(policy, "daily-loop-planner", [
          "planner_receives_active_policy",
          "answer_discloses_policy_guardrail",
          "report_lists_active_policy",
        ]),
      },
      {
        ...common,
        id: `policy_reg_${shortHash(`${policyId}:sample-quality:${question}`)}`,
        caseType: "training-sample-quality",
        query: question,
        commandTemplate: "npm run codex:ingest -- export-samples --kind eval --quality-gate eligible",
        expectedAssertions: policyRegressionExpectedAssertions(policy, "training-sample-quality", [
          "block_high_confidence_without_confirmed_evidence",
          "attach_quality_gate",
          "require_evidence_result_for_upgrade",
        ]),
      },
    ]
  })
}

export async function exportSelfQuestionPolicyRegressions(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const generatedAt = nowLocalTimestamp()
  const runId = `self_question_policy_regression_${generatedAt.replace(/[-: ]/g, "").slice(0, 14)}`
  const registry = Array.isArray(options.activePolicies)
    ? { policies: options.activePolicies, counts: { active: options.activePolicies.length, reviewEvents: 0 }, reviewEvents: [] }
    : await listActiveSelfQuestionPolicies({ projectPath })
  const maxPolicies = parsePositiveInteger(options.maxPolicies ?? options["max-policies"], registry.policies.length)
  const policies = registry.policies.slice(0, maxPolicies)
  const cases = policies.flatMap((policy) => buildActivePolicyRegressionCases(policy, options))
  const byCaseType = Object.fromEntries(
    [...cases.reduce((map, item) => map.set(item.caseType, (map.get(item.caseType) ?? 0) + 1), new Map()).entries()].sort(([a], [b]) => a.localeCompare(b)),
  )
  const dryRun = !options.write
  const run = {
    schema: "trading-ai-policy-regression-run-v1",
    mode: "self-question-policy-regression",
    runId,
    generatedAt,
    projectPath,
    dryRun,
    counts: {
      activePolicies: policies.length,
      regressionQuestions: policies.reduce((sum, policy) => sum + activePolicyRegressionQuestions(policy, options).length, 0),
      cases: cases.length,
      byCaseType,
    },
    policies: policies.map((policy) => ({
      policyId: policy.policyId ?? policy.id ?? null,
      status: policy.status ?? null,
      scope: policy.scope ?? null,
      rule: policy.rule ?? null,
      evidenceGap: policy.evidenceGap ?? null,
      sourceProposalId: policy.sourceProposalId ?? null,
      approvedAt: policy.approvedAt ?? policy.createdAt ?? null,
      regressionQuestions: activePolicyRegressionQuestions(policy, options),
    })),
    cases,
    writePolicy: {
      artifacts: ".llm-wiki/policy-regressions",
      wroteWiki: false,
      wroteRaw: false,
      wroteBrain: false,
    },
    writeResult: null,
  }
  if (!dryRun) {
    const outputDir = path.join(projectPath, ".llm-wiki", "policy-regressions")
    await ensureDirectory(outputDir)
    const outputPath = path.join(outputDir, `${generatedAt.replace(/[-: ]/g, "").slice(0, 14)}-policy-regressions.json`)
    run.writeResult = { filePath: outputPath, relativePath: projectRelative(projectPath, outputPath), records: cases.length }
    await fs.writeFile(outputPath, `${JSON.stringify(run, null, 2)}\n`, "utf8")
  }
  return run
}

function policyRegressionOutputText(value) {
  if (value == null) return ""
  if (typeof value === "string") return value
  if (typeof value === "object" && !Array.isArray(value)) {
    const fields = [value.output, value.text, value.stdout, value.answer, value.report, value.summary].filter((item) => item != null)
    if (fields.length > 0) return fields.map(policyRegressionOutputText).join("\n")
  }
  return stableJsonString(value)
}

function hasPolicyRegressionText(text, patterns = []) {
  const normalized = String(text ?? "").toLowerCase()
  return patterns.some((pattern) => normalized.includes(String(pattern).toLowerCase()))
}

export function evaluatePolicyRegressionAssertion(assertion, outputText, regressionCase = {}) {
  const text = policyRegressionOutputText(outputText)
  const evidenceGap = String(regressionCase.evidenceGap ?? "").trim()
  const policyId = String(regressionCase.policyId ?? "").trim()
  const rule = String(regressionCase.rule ?? "").trim()
  const checks = {
    disclose_evidence_gap: [
      "证据缺口",
      "补证",
      evidenceGap,
    ],
    lower_confidence_when_evidence_missing: [
      "降低置信",
      "降置信",
      "低置信",
      "不高置信",
      "不能高置信",
      "needs_evidence",
    ],
    cite_or_request_required_sources: [
      "引用来源",
      "cninfo",
      "公告",
      "企查查",
      "招投标",
      "tushare",
      "财报",
      "待查",
    ],
    planner_receives_active_policy: [
      "planner_receives_active_policy",
      "active policy",
      "active_policy",
      policyId,
      rule,
    ],
    answer_discloses_policy_guardrail: [
      "policy guardrail",
      "guardrail",
      "策略约束",
      "active policy",
      "补证规则",
    ],
    report_lists_active_policy: [
      "## active policies",
      "active policies",
      policyId,
    ],
    block_high_confidence_without_confirmed_evidence: [
      "needs_evidence",
      "block high confidence",
      "不能高置信",
      "不进入高置信",
      "high_confidence=false",
    ],
    attach_quality_gate: [
      "qualitygate",
      "quality_gate",
      "质量门槛",
    ],
    require_evidence_result_for_upgrade: [
      "evidence_results",
      "confirmed required",
      "required for upgrade",
      "补证结果",
      "升级",
    ],
  }
  const patterns = (checks[assertion] ?? [assertion]).filter(Boolean)
  const passed = hasPolicyRegressionText(text, patterns)
  return {
    assertion,
    status: passed ? "passed" : "failed",
    reason: passed ? "matched expected output evidence" : `missing expected output evidence: ${assertion}`,
  }
}

async function readJsonFile(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"))
}

function normalizeRegressionCaseOutputs(raw = {}) {
  const source = raw?.caseOutputs ?? raw?.outputs ?? raw?.results ?? raw
  if (Array.isArray(source)) {
    return Object.fromEntries(source.map((item) => [item.caseId ?? item.id, item.output ?? item.text ?? item.stdout ?? item]).filter(([id]) => id))
  }
  if (source && typeof source === "object") return source
  return {}
}

async function loadRegressionCaseOutputs(projectPath, options = {}) {
  const outputPath = resolveProjectFile(projectPath, options.outputsPath ?? options.outputs ?? options["outputs-path"])
  if (outputPath) return normalizeRegressionCaseOutputs(await readJsonFile(outputPath))
  return normalizeRegressionCaseOutputs(options.caseOutputs ?? options.outputsMap ?? {})
}

async function loadPolicyRegressionRun(projectPath, options = {}) {
  if (options.regressionRun) return { run: options.regressionRun, filePath: null, relativePath: null }
  const explicitPath = resolveProjectFile(projectPath, options.regressionPath ?? options.regression ?? options["regression-path"])
  const files = explicitPath
    ? [explicitPath]
    : (await listFilesRecursive(path.join(projectPath, ".llm-wiki", "policy-regressions"), {
      extensions: new Set([".json"]),
      excludeDirNames: new Set([".git", "node_modules"]),
      maxBytes: 1024 * 1024 * 5,
    }).catch(() => [])).sort().reverse()
  for (const filePath of files) {
    const run = await readJsonFile(filePath)
    if (Array.isArray(run?.cases)) return { run, filePath, relativePath: projectRelative(projectPath, filePath) }
  }
  if (Array.isArray(options.cases)) {
    return {
      run: {
        schema: "trading-ai-policy-regression-run-v1",
        runId: `inline_policy_regression_${shortHash(stableJsonString(options.cases))}`,
        cases: options.cases,
      },
      filePath: null,
      relativePath: null,
    }
  }
  throw new Error("Policy regression run not found; pass --regression or generate one with self-question policy regression --write")
}

function appendBoundedText(current, chunk, maxBytes) {
  const next = `${current}${chunk}`
  if (Buffer.byteLength(next, "utf8") <= maxBytes) return { text: next, truncated: false }
  return { text: next.slice(0, maxBytes), truncated: true }
}

export function renderPolicyRegressionCaseCommand(regressionCase = {}, options = {}) {
  const template = String(regressionCase.commandTemplate ?? "").trim()
  if (!template) return ""
  const query = regressionCase.query ?? regressionCase.sourceQuestion ?? ""
  let command = template.replaceAll("<query>", shellArg(query))
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  if (!/(^|\s)--project(?:=|\s)/.test(command)) command = `${command} --project ${shellArg(projectPath)}`
  return command
}

async function executePolicyRegressionShellCommand({ command, cwd, timeoutMs, maxOutputBytes }) {
  return new Promise((resolve) => {
    const startedMs = Date.now()
    const child = spawn("bash", ["-lc", command], {
      cwd: cwd || process.cwd(),
      env: { ...process.env, FORCE_COLOR: "0" },
    })
    let stdout = ""
    let stderr = ""
    let stdoutTruncated = false
    let stderrTruncated = false
    let timedOut = false
    let settled = false
    let killTimer = null
    const finish = (result) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      if (killTimer) clearTimeout(killTimer)
      resolve({
        ...result,
        stdout,
        stderr,
        stdoutTruncated,
        stderrTruncated,
        timedOut,
        durationMs: Date.now() - startedMs,
      })
    }
    const timer = timeoutMs > 0
      ? setTimeout(() => {
        timedOut = true
        child.kill("SIGTERM")
        killTimer = setTimeout(() => child.kill("SIGKILL"), 2000)
      }, timeoutMs)
      : null
    child.stdout?.on("data", (chunk) => {
      const appended = appendBoundedText(stdout, chunk.toString("utf8"), maxOutputBytes)
      stdout = appended.text
      stdoutTruncated = stdoutTruncated || appended.truncated
    })
    child.stderr?.on("data", (chunk) => {
      const appended = appendBoundedText(stderr, chunk.toString("utf8"), maxOutputBytes)
      stderr = appended.text
      stderrTruncated = stderrTruncated || appended.truncated
    })
    child.on("error", (err) => {
      const appended = appendBoundedText(stderr, safeErrorMessage(err), maxOutputBytes)
      stderr = appended.text
      stderrTruncated = stderrTruncated || appended.truncated
      finish({ exitCode: null, signal: null, error: safeErrorMessage(err) })
    })
    child.on("close", (code, signal) => {
      finish({ exitCode: code, signal, error: null })
    })
  })
}

function normalizePolicyRegressionCommandResult(result = {}, durationMs = 0) {
  const exitCode = result.exitCode ?? result.code ?? 0
  const timedOut = Boolean(result.timedOut)
  return {
    exitCode,
    signal: result.signal ?? null,
    timedOut,
    status: timedOut ? "timed_out" : Number(exitCode) === 0 ? "completed" : "failed",
    durationMs: Number(result.durationMs ?? durationMs ?? 0),
    stdout: String(result.stdout ?? result.output ?? ""),
    stderr: String(result.stderr ?? result.error ?? ""),
    stdoutTruncated: Boolean(result.stdoutTruncated),
    stderrTruncated: Boolean(result.stderrTruncated),
  }
}

function policyRegressionExecutionVerdict({ execute = false, counts = {}, evaluation = null } = {}) {
  const evaluationCounts = evaluation?.counts ?? {}
  const commandFailures = (counts.failed ?? 0) + (counts.timedOut ?? 0)
  const evaluationFailed = evaluationCounts.failed ?? 0
  const evaluationSkipped = evaluationCounts.skipped ?? 0

  if (!execute) {
    return {
      status: "planned",
      reason: "regression execution planned; pass --execute to run cases",
      nextStages: ["policy-regression-execute"],
      commandFailures,
      evaluationFailed,
      evaluationSkipped,
    }
  }
  if (commandFailures > 0) {
    return {
      status: "needs_remediation",
      reason: "regression command failures or timeouts",
      nextStages: ["policy-regression-feedback", "policy-regression-remediation"],
      commandFailures,
      evaluationFailed,
      evaluationSkipped,
    }
  }
  if (evaluationFailed + evaluationSkipped > 0) {
    return {
      status: "needs_remediation",
      reason: "regression assertions failed or were skipped",
      nextStages: ["policy-regression-feedback", "policy-regression-remediation"],
      commandFailures,
      evaluationFailed,
      evaluationSkipped,
    }
  }
  return {
    status: "passed",
    reason: "regression execution completed and all evaluated assertions passed",
    nextStages: [],
    commandFailures: 0,
    evaluationFailed: 0,
    evaluationSkipped: 0,
  }
}

export async function executeSelfQuestionPolicyRegressions(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const generatedAt = nowLocalTimestamp()
  const runId = `self_question_policy_regression_exec_${generatedAt.replace(/[-: ]/g, "").slice(0, 14)}`
  const { run: regressionRun, relativePath: regressionRelativePath } = await loadPolicyRegressionRun(projectPath, options)
  const allCases = Array.isArray(regressionRun.cases) ? regressionRun.cases : []
  const maxCases = parsePositiveInteger(options.maxCases ?? options["max-cases"], allCases.length)
  const cases = allCases.slice(0, maxCases)
  const timeoutMs = parsePositiveInteger(options.timeoutMs ?? options["timeout-ms"] ?? options.caseTimeoutMs ?? options["case-timeout-ms"], 120000)
  const maxOutputBytes = parsePositiveInteger(options.maxOutputBytes ?? options["max-output-bytes"], 200000)
  const concurrency = parsePositiveInteger(options.concurrency ?? options["concurrency"] ?? options.policyRegressionConcurrency ?? options["policy-regression-concurrency"], 1)
  const shouldExecute = Boolean(options.execute)
  const executor = options.executor ?? executePolicyRegressionShellCommand
  const executeCase = async (regressionCase) => {
    const command = renderPolicyRegressionCaseCommand(regressionCase, { projectPath })
    if (!shouldExecute) {
      return {
        caseId: regressionCase.id,
        policyId: regressionCase.policyId ?? null,
        caseType: regressionCase.caseType ?? null,
        status: "planned",
        command: safeErrorMessage(command),
        exitCode: null,
        durationMs: 0,
        stdoutSummary: null,
        stderrSummary: null,
        rawOutput: null,
      }
    }

    const startedMs = Date.now()
    let commandResult
    try {
      commandResult = await executor({
        command,
        regressionCase,
        projectPath,
        cwd: options.cwd ?? process.cwd(),
        timeoutMs,
        maxOutputBytes,
      })
    } catch (err) {
      commandResult = { exitCode: 1, stdout: "", stderr: safeErrorMessage(err) }
    }
    const normalized = normalizePolicyRegressionCommandResult(commandResult, Date.now() - startedMs)
    return {
      caseId: regressionCase.id,
      policyId: regressionCase.policyId ?? null,
      caseType: regressionCase.caseType ?? null,
      status: normalized.status,
      command: safeErrorMessage(command),
      exitCode: normalized.exitCode,
      signal: normalized.signal,
      timedOut: normalized.timedOut,
      durationMs: normalized.durationMs,
      stdoutSummary: normalized.stdout ? excerptForPrompt(safeErrorMessage(normalized.stdout), 600) : null,
      stderrSummary: normalized.stderr ? excerptForPrompt(safeErrorMessage(normalized.stderr), 600) : null,
      stdoutTruncated: normalized.stdoutTruncated,
      stderrTruncated: normalized.stderrTruncated,
      rawOutput: normalized.status === "completed" ? { stdout: normalized.stdout, stderr: normalized.stderr } : null,
    }
  }
  const executedResults = shouldExecute
    ? await mapWithConcurrency(cases, concurrency, executeCase)
    : cases.map((regressionCase) => {
      const command = renderPolicyRegressionCaseCommand(regressionCase, { projectPath })
      return {
        caseId: regressionCase.id,
        policyId: regressionCase.policyId ?? null,
        caseType: regressionCase.caseType ?? null,
        status: "planned",
        command: safeErrorMessage(command),
        exitCode: null,
        durationMs: 0,
        stdoutSummary: null,
        stderrSummary: null,
        rawOutput: null,
      }
    })
  const rawOutputs = new Map(executedResults.filter((item) => item.rawOutput).map((item) => [item.caseId, item.rawOutput]))
  const results = executedResults.map(({ rawOutput, ...item }) => item)

  const executedRegressionRun = { ...regressionRun, cases }
  const evaluation = shouldExecute
    ? await evaluateSelfQuestionPolicyRegressions({
      projectPath,
      regressionRun: executedRegressionRun,
      caseOutputs: Object.fromEntries(rawOutputs.entries()),
    })
    : null
  const counts = {
    cases: results.length,
    planned: results.filter((item) => item.status === "planned").length,
    completed: results.filter((item) => item.status === "completed").length,
    failed: results.filter((item) => item.status === "failed").length,
    timedOut: results.filter((item) => item.status === "timed_out").length,
  }
  const verdict = policyRegressionExecutionVerdict({ execute: shouldExecute, counts, evaluation })
  const dryRun = !shouldExecute
  const run = {
    schema: "trading-ai-policy-regression-execution-run-v1",
    mode: "self-question-policy-regression-execute",
    runId,
    generatedAt,
    projectPath,
    dryRun,
    execute: shouldExecute,
    sourceRegressionRunId: regressionRun.runId ?? null,
    sourceRegressionPath: regressionRelativePath,
    timeoutMs,
    maxOutputBytes,
    concurrency,
    counts,
    results,
    evaluation,
    verdict,
    writePolicy: {
      artifacts: ".llm-wiki/policy-regression-executions",
      wroteWiki: false,
      wroteRaw: false,
      wroteBrain: false,
    },
    writeResult: null,
  }
  if (options.write) {
    const outputDir = path.join(projectPath, ".llm-wiki", "policy-regression-executions")
    await ensureDirectory(outputDir)
    const outputPath = path.join(outputDir, `${generatedAt.replace(/[-: ]/g, "").slice(0, 14)}-policy-regression-execution.json`)
    run.writeResult = { filePath: outputPath, relativePath: projectRelative(projectPath, outputPath), records: results.length }
    await fs.writeFile(outputPath, `${JSON.stringify(run, null, 2)}\n`, "utf8")
  }
  return run
}

export async function evaluateSelfQuestionPolicyRegressions(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const generatedAt = nowLocalTimestamp()
  const runId = `self_question_policy_regression_eval_${generatedAt.replace(/[-: ]/g, "").slice(0, 14)}`
  const { run: regressionRun, relativePath: regressionRelativePath } = await loadPolicyRegressionRun(projectPath, options)
  const outputMap = await loadRegressionCaseOutputs(projectPath, options)
  const cases = Array.isArray(regressionRun.cases) ? regressionRun.cases : []
  const results = cases.map((regressionCase) => {
    const rawOutput = outputMap[regressionCase.id]
    const outputText = policyRegressionOutputText(rawOutput)
    const expectedAssertions = Array.isArray(regressionCase.expectedAssertions) ? regressionCase.expectedAssertions : []
    if (!outputText) {
      return {
        caseId: regressionCase.id,
        policyId: regressionCase.policyId ?? null,
        caseType: regressionCase.caseType ?? null,
        status: "skipped",
        assertions: expectedAssertions.map((assertion) => ({ assertion, status: "skipped", reason: "case output missing" })),
        outputSummary: null,
      }
    }
    const assertions = expectedAssertions.map((assertion) => evaluatePolicyRegressionAssertion(assertion, outputText, regressionCase))
    const failed = assertions.filter((item) => item.status === "failed")
    return {
      caseId: regressionCase.id,
      policyId: regressionCase.policyId ?? null,
      caseType: regressionCase.caseType ?? null,
      status: failed.length > 0 ? "failed" : "passed",
      assertions,
      outputSummary: excerptForPrompt(safeErrorMessage(outputText), 360),
    }
  })
  const counts = {
    cases: results.length,
    passed: results.filter((item) => item.status === "passed").length,
    failed: results.filter((item) => item.status === "failed").length,
    skipped: results.filter((item) => item.status === "skipped").length,
  }
  const dryRun = !options.write
  const evaluationRun = {
    schema: "trading-ai-policy-regression-evaluation-run-v1",
    mode: "self-question-policy-regression-evaluate",
    runId,
    generatedAt,
    projectPath,
    dryRun,
    sourceRegressionRunId: regressionRun.runId ?? null,
    sourceRegressionPath: regressionRelativePath,
    counts,
    results,
    writePolicy: {
      artifacts: ".llm-wiki/policy-regression-results",
      wroteWiki: false,
      wroteRaw: false,
      wroteBrain: false,
    },
    writeResult: null,
  }
  if (!dryRun) {
    const outputDir = path.join(projectPath, ".llm-wiki", "policy-regression-results")
    await ensureDirectory(outputDir)
    const outputPath = path.join(outputDir, `${generatedAt.replace(/[-: ]/g, "").slice(0, 14)}-policy-regression-results.json`)
    evaluationRun.writeResult = { filePath: outputPath, relativePath: projectRelative(projectPath, outputPath), records: results.length }
    await fs.writeFile(outputPath, `${JSON.stringify(evaluationRun, null, 2)}\n`, "utf8")
  }
  return evaluationRun
}

async function loadPolicyRegressionExecutionRun(projectPath, options = {}) {
  if (options.executionRun) return { run: options.executionRun, filePath: null, relativePath: null }
  const explicitPath = resolveProjectFile(projectPath, options.executionPath ?? options.execution ?? options["execution-path"])
  const files = explicitPath
    ? [explicitPath]
    : (await listFilesRecursive(path.join(projectPath, ".llm-wiki", "policy-regression-executions"), {
      extensions: new Set([".json"]),
      excludeDirNames: new Set([".git", "node_modules"]),
      maxBytes: 1024 * 1024 * 5,
    }).catch(() => [])).sort().reverse()
  for (const filePath of files) {
    const run = await readJsonFile(filePath)
    if (Array.isArray(run?.results)) return { run, filePath, relativePath: projectRelative(projectPath, filePath) }
  }
  throw new Error("Policy regression execution run not found; pass --execution or run self-question policy regression execute --write")
}

function buildPolicyRegressionFeedbackId(parts = []) {
  return `policy_reg_feedback_${shortHash(parts.filter(Boolean).join(":"))}`
}

function summarizePolicyRegressionFeedbackEvidence(value) {
  return value ? excerptForPrompt(safeErrorMessage(value), 600) : null
}

function commandFailureFeedbackItems(executionRun = {}) {
  return (executionRun.results ?? [])
    .filter((item) => item.status === "failed" || item.status === "timed_out")
    .map((item) => ({
      schema: "trading-ai-policy-regression-feedback-v1",
      id: buildPolicyRegressionFeedbackId([executionRun.runId, item.caseId, "command", item.status]),
      type: "policy_regression_feedback",
      status: "proposed",
      feedbackType: item.status === "timed_out" ? "command_timeout" : "command_failed",
      severity: "blocking",
      policyId: item.policyId ?? null,
      caseId: item.caseId ?? null,
      caseType: item.caseType ?? null,
      assertion: null,
      issue: item.status === "timed_out" ? "Policy regression command timed out before output could be evaluated." : "Policy regression command failed before output could be evaluated.",
      suggestedAction: "repair_regression_command_or_provider",
      evidence: {
        exitCode: item.exitCode ?? null,
        timedOut: Boolean(item.timedOut),
        command: summarizePolicyRegressionFeedbackEvidence(item.command),
        stdoutSummary: summarizePolicyRegressionFeedbackEvidence(item.stdoutSummary),
        stderrSummary: summarizePolicyRegressionFeedbackEvidence(item.stderrSummary),
      },
    }))
}

function skippedEvaluationFeedbackItems(executionRun = {}) {
  return (executionRun.evaluation?.results ?? [])
    .filter((item) => item.status === "skipped")
    .map((item) => ({
      schema: "trading-ai-policy-regression-feedback-v1",
      id: buildPolicyRegressionFeedbackId([executionRun.runId, item.caseId, "evaluation", "skipped"]),
      type: "policy_regression_feedback",
      status: "proposed",
      feedbackType: "case_output_missing",
      severity: "blocking",
      policyId: item.policyId ?? null,
      caseId: item.caseId ?? null,
      caseType: item.caseType ?? null,
      assertion: null,
      issue: "Policy regression case produced no evaluable output.",
      suggestedAction: "rerun_or_repair_regression_case_output",
      evidence: {
        skippedAssertions: (item.assertions ?? []).filter((assertion) => assertion.status === "skipped").map((assertion) => assertion.assertion),
        outputSummary: summarizePolicyRegressionFeedbackEvidence(item.outputSummary),
      },
    }))
}

function failedAssertionFeedbackItems(executionRun = {}) {
  const items = []
  for (const result of executionRun.evaluation?.results ?? []) {
    if (result.status !== "failed") continue
    for (const assertion of result.assertions ?? []) {
      if (assertion.status !== "failed") continue
      items.push({
        schema: "trading-ai-policy-regression-feedback-v1",
        id: buildPolicyRegressionFeedbackId([executionRun.runId, result.caseId, "assertion", assertion.assertion]),
        type: "policy_regression_feedback",
        status: "proposed",
        feedbackType: "assertion_failed",
        severity: "review",
        policyId: result.policyId ?? null,
        caseId: result.caseId ?? null,
        caseType: result.caseType ?? null,
        assertion: assertion.assertion ?? null,
        issue: `Policy regression output missed required assertion: ${assertion.assertion ?? "unknown"}.`,
        suggestedAction: "tighten_policy_prompt_or_training_sample",
        evidence: {
          reason: summarizePolicyRegressionFeedbackEvidence(assertion.reason),
          outputSummary: summarizePolicyRegressionFeedbackEvidence(result.outputSummary),
        },
      })
    }
  }
  return items
}

export async function collectSelfQuestionPolicyRegressionFeedback(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const generatedAt = nowLocalTimestamp()
  const runId = `self_question_policy_regression_feedback_${generatedAt.replace(/[-: ]/g, "").slice(0, 14)}`
  const { run: executionRun, relativePath: executionRelativePath } = await loadPolicyRegressionExecutionRun(projectPath, options)
  const commandItems = commandFailureFeedbackItems(executionRun)
  const skippedItems = skippedEvaluationFeedbackItems(executionRun)
  const assertionItems = failedAssertionFeedbackItems(executionRun)
  const feedbackItems = [...commandItems, ...skippedItems, ...assertionItems]
  const dryRun = !options.write
  const run = {
    schema: "trading-ai-policy-regression-feedback-run-v1",
    mode: "self-question-policy-regression-feedback",
    runId,
    generatedAt,
    projectPath,
    dryRun,
    sourceExecutionRunId: executionRun.runId ?? null,
    sourceExecutionPath: executionRelativePath,
    counts: {
      cases: executionRun.counts?.cases ?? executionRun.results?.length ?? 0,
      commandFailures: commandItems.length,
      assertionFailures: assertionItems.length,
      skippedCases: skippedItems.length,
      feedbackItems: feedbackItems.length,
    },
    feedbackItems,
    writePolicy: {
      artifacts: ".llm-wiki/policy-regression-feedback",
      wroteWiki: false,
      wroteRaw: false,
      wroteBrain: false,
    },
    writeResult: null,
  }
  if (!dryRun) {
    const outputDir = path.join(projectPath, ".llm-wiki", "policy-regression-feedback")
    await ensureDirectory(outputDir)
    const outputPath = path.join(outputDir, `${generatedAt.replace(/[-: ]/g, "").slice(0, 14)}-policy-regression-feedback.json`)
    run.writeResult = { filePath: outputPath, relativePath: projectRelative(projectPath, outputPath), records: feedbackItems.length }
    await fs.writeFile(outputPath, `${JSON.stringify(run, null, 2)}\n`, "utf8")
  }
  return run
}

async function loadPolicyRegressionFeedbackRun(projectPath, options = {}) {
  if (options.feedbackRun) return { run: options.feedbackRun, filePath: null, relativePath: null }
  if (Array.isArray(options.feedbackItems)) {
    return {
      run: {
        schema: "trading-ai-policy-regression-feedback-run-v1",
        runId: `inline_policy_regression_feedback_${shortHash(stableJsonString(options.feedbackItems))}`,
        feedbackItems: options.feedbackItems,
      },
      filePath: null,
      relativePath: null,
    }
  }
  const explicitPath = resolveProjectFile(projectPath, options.feedbackPath ?? options.feedback ?? options["feedback-path"])
  const files = explicitPath
    ? [explicitPath]
    : (await listFilesRecursive(path.join(projectPath, ".llm-wiki", "policy-regression-feedback"), {
      extensions: new Set([".json"]),
      excludeDirNames: new Set([".git", "node_modules"]),
      maxBytes: 1024 * 1024 * 5,
    }).catch(() => [])).sort().reverse()
  for (const filePath of files) {
    const run = await readJsonFile(filePath)
    if (Array.isArray(run?.feedbackItems)) return { run, filePath, relativePath: projectRelative(projectPath, filePath) }
  }
  throw new Error("Policy regression feedback run not found; pass --feedback or run self-question policy regression feedback --write")
}

function policyRegressionRemediationType(feedbackType) {
  if (feedbackType === "command_failed" || feedbackType === "command_timeout") return "execution_repair"
  if (feedbackType === "case_output_missing") return "case_output_repair"
  if (feedbackType === "assertion_failed") return "policy_or_prompt_patch"
  return "feedback_review"
}

function policyRegressionRemediationAction(remediationType) {
  const actions = {
    execution_repair: "repair_command_provider_or_timeout",
    case_output_repair: "rerun_case_or_make_output_evaluable",
    policy_or_prompt_patch: "tighten_policy_prompt_or_regression_assertion",
    feedback_review: "review_feedback_item",
  }
  return actions[remediationType] ?? "review_feedback_item"
}

function sanitizePolicyRegressionFeedbackValue(value) {
  if (value == null) return value
  if (typeof value === "string") return safeErrorMessage(value)
  if (typeof value === "number" || typeof value === "boolean") return value
  if (Array.isArray(value)) return value.map(sanitizePolicyRegressionFeedbackValue)
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizePolicyRegressionFeedbackValue(item)]))
  }
  return safeErrorMessage(value)
}

function sanitizePolicyRegressionString(value, fallback = null) {
  const raw = String(value ?? "").trim()
  return raw ? safeErrorMessage(raw) : fallback
}

function normalizeSelfTrainingReviewQuality(value) {
  const raw = String(value ?? "reviewed").trim().toLowerCase().replace(/-/g, "_")
  const aliases = new Map([
    ["default", "reviewed"],
    ["manual", "reviewed"],
    ["human_reviewed", "reviewed"],
    ["highconfidence", "high_confidence"],
    ["high_confidence_only", "high_confidence"],
    ["evidence_backed", "high_confidence"],
  ])
  const quality = aliases.get(raw) ?? raw
  const allowed = new Set(["reviewed", "eligible", "review_required", "high_confidence"])
  if (!allowed.has(quality)) throw new Error("--quality must be reviewed, eligible, review_required, or high_confidence")
  return quality
}

function parseSelfTrainingReviewEvidenceRefs(options = {}) {
  const value = options.evidenceRefs ?? options["evidence-refs"] ?? options.evidenceRef ?? options["evidence-ref"] ?? options.sourceRefs ?? options["source-refs"]
  const values = Array.isArray(value) ? value : String(value ?? "").split(/[,;\n]+/g)
  return [...new Set(values.map((item) => safeErrorMessage(String(item ?? "").trim())).filter(Boolean))]
}

function policyRegressionRemediationQuestion(item = {}, remediationType) {
  const policyId = sanitizePolicyRegressionString(item.policyId, "unknown-policy")
  const caseType = sanitizePolicyRegressionString(item.caseType, "unknown-case")
  const assertion = sanitizePolicyRegressionString(item.assertion, "")
  if (remediationType === "execution_repair") {
    return `为什么 ${policyId} 的 ${caseType} 回归命令未能产出可评估结果？需要优先修复 provider、命令模板、超时还是环境依赖？`
  }
  if (remediationType === "case_output_repair") {
    return `为什么 ${policyId} 的 ${caseType} 回归 case 没有可评估输出？是否需要重跑、补输出映射，还是调整 case 的最小可验证格式？`
  }
  if (remediationType === "policy_or_prompt_patch") {
    return `为什么 ${policyId} 的 ${caseType} 输出没有满足 ${assertion || "required assertion"}？需要改 ask/daily-loop prompt、active policy 文案，还是增加训练样本约束？`
  }
  return `如何处理 ${policyId} 的 ${caseType} 回归反馈 ${sanitizePolicyRegressionString(item.feedbackType, "unknown_feedback")}？`
}

function buildPolicyRegressionRemediationProposal(item = {}, sourceRunId, index) {
  const feedbackType = sanitizePolicyRegressionString(item.feedbackType, "unknown_feedback")
  const remediationType = policyRegressionRemediationType(feedbackType)
  const assertion = sanitizePolicyRegressionString(item.assertion, null)
  const policyId = sanitizePolicyRegressionString(item.policyId, null)
  const caseId = sanitizePolicyRegressionString(item.caseId, null)
  const caseType = sanitizePolicyRegressionString(item.caseType, null)
  const sourceFeedbackId = sanitizePolicyRegressionString(item.id, null)
  const proposedPolicyPatch = remediationType === "policy_or_prompt_patch" && assertion
    ? {
      policyId,
      caseType,
      addRegressionAssertion: assertion,
      promptGuardrail: `Output must explicitly satisfy ${assertion} before the policy can pass this regression case.`,
      sourceFeedbackId,
      reviewRequired: true,
    }
    : null
  return {
    schema: "trading-ai-policy-regression-remediation-v1",
    id: `policy_reg_remediation_${shortHash([sourceRunId, item.id, feedbackType, index].filter(Boolean).join(":"))}`,
    type: "policy_regression_remediation",
    status: "proposed",
    reviewStatus: "needs_review",
    remediationType,
    feedbackType,
    severity: sanitizePolicyRegressionString(item.severity, "review"),
    policyId,
    caseId,
    caseType,
    assertion,
    sourceFeedbackId,
    proposedAction: policyRegressionRemediationAction(remediationType),
    proposedQuestion: policyRegressionRemediationQuestion(item, remediationType),
    proposedPolicyPatch,
    rationale: summarizePolicyRegressionFeedbackEvidence(item.issue) ?? "Policy regression feedback requires review before it can change prompts, policies, or samples.",
    evidence: sanitizePolicyRegressionFeedbackValue(item.evidence ?? {}),
  }
}

function countPolicyRegressionRemediationTypes(proposals = []) {
  return Object.fromEntries(
    [...proposals.reduce((map, item) => map.set(item.remediationType, (map.get(item.remediationType) ?? 0) + 1), new Map()).entries()]
      .sort(([a], [b]) => a.localeCompare(b)),
  )
}

export async function proposeSelfQuestionPolicyRegressionRemediations(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const generatedAt = nowLocalTimestamp()
  const runId = `self_question_policy_regression_remediation_${generatedAt.replace(/[-: ]/g, "").slice(0, 14)}`
  const { run: feedbackRun, relativePath: feedbackRelativePath } = await loadPolicyRegressionFeedbackRun(projectPath, options)
  const feedbackItems = (feedbackRun.feedbackItems ?? []).filter((item) => item && typeof item === "object" && !Array.isArray(item))
  const proposals = feedbackItems.map((item, index) => buildPolicyRegressionRemediationProposal(item, feedbackRun.runId ?? null, index))
  const dryRun = !options.write
  const run = {
    schema: "trading-ai-policy-regression-remediation-run-v1",
    mode: "self-question-policy-regression-remediation",
    runId,
    generatedAt,
    projectPath,
    dryRun,
    sourceFeedbackRunId: feedbackRun.runId ?? null,
    sourceFeedbackPath: feedbackRelativePath,
    counts: {
      feedbackItems: feedbackItems.length,
      remediationProposals: proposals.length,
      byRemediationType: countPolicyRegressionRemediationTypes(proposals),
    },
    proposals,
    writePolicy: {
      artifacts: ".llm-wiki/policy-regression-remediations",
      wroteWiki: false,
      wroteRaw: false,
      wroteBrain: false,
    },
    writeResult: null,
  }
  if (!dryRun) {
    const outputDir = path.join(projectPath, ".llm-wiki", "policy-regression-remediations")
    await ensureDirectory(outputDir)
    const outputPath = path.join(outputDir, `${generatedAt.replace(/[-: ]/g, "").slice(0, 14)}-policy-regression-remediations.json`)
    run.writeResult = { filePath: outputPath, relativePath: projectRelative(projectPath, outputPath), records: proposals.length }
    await fs.writeFile(outputPath, `${JSON.stringify(run, null, 2)}\n`, "utf8")
  }
  return run
}

function policyRegressionRemediationRunCandidates(raw) {
  if (Array.isArray(raw?.proposals)) return raw.proposals
  if (raw?.schema === "trading-ai-policy-regression-remediation-v1") return [raw]
  return []
}

async function readPolicyRegressionRemediationCandidates(filePath) {
  const raw = JSON.parse(await fs.readFile(filePath, "utf8"))
  return policyRegressionRemediationRunCandidates(raw)
}

async function findSelfQuestionPolicyRegressionRemediation(projectPath, options = {}) {
  const remediationId = String(options.remediationId ?? options["remediation-id"] ?? options.id ?? "").trim()
  const remediationPath = resolveProjectFile(projectPath, options.remediationPath ?? options.remediation ?? options["remediation-path"])
  const files = remediationPath
    ? [remediationPath]
    : (await listFilesRecursive(path.join(projectPath, ".llm-wiki", "policy-regression-remediations"), {
      extensions: new Set([".json"]),
      excludeDirNames: new Set([".git", "node_modules"]),
      maxBytes: 1024 * 1024 * 5,
    }).catch(() => [])).sort().reverse()

  const matches = []
  for (const filePath of files) {
    let proposals = []
    try {
      proposals = await readPolicyRegressionRemediationCandidates(filePath)
    } catch (err) {
      if (remediationPath) throw err
      continue
    }
    for (const proposal of proposals) {
      if (!proposal || typeof proposal !== "object" || Array.isArray(proposal)) continue
      if (remediationId && proposal.id !== remediationId) continue
      matches.push({ remediation: proposal, filePath })
    }
  }
  if (matches.length === 0) throw new Error(remediationId ? `Policy regression remediation not found: ${remediationId}` : "Policy regression remediation not found")
  if (!remediationId && matches.length > 1) throw new Error("Multiple policy regression remediations found; pass --remediation-id")
  return matches[0]
}

export async function reviewSelfQuestionPolicyRegressionRemediation(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const action = normalizePolicyReviewAction(options.action ?? options.result ?? options.review)
  const reviewedAt = nowLocalTimestamp()
  const { remediation, filePath: remediationFilePath } = await findSelfQuestionPolicyRegressionRemediation(projectPath, options)
  const sanitizedRemediation = sanitizePolicyRegressionFeedbackValue(remediation)
  const reviewer = safeErrorMessage(String(options.reviewer ?? "").trim() || "manual")
  const note = safeErrorMessage(String(options.note ?? "").trim())
  const reviewEvent = {
    id: makeBrainRecordId("event", `${action}:${remediation.id ?? ""}`),
    type: "event",
    eventType: "policy-regression-remediation-review",
    result: action === "approve" ? "approved" : "rejected",
    remediationId: sanitizePolicyRegressionString(remediation.id, null),
    remediationType: sanitizePolicyRegressionString(remediation.remediationType, null),
    feedbackType: sanitizePolicyRegressionString(remediation.feedbackType, null),
    severity: sanitizePolicyRegressionString(remediation.severity, null),
    policyId: sanitizePolicyRegressionString(remediation.policyId, null),
    caseId: sanitizePolicyRegressionString(remediation.caseId, null),
    caseType: sanitizePolicyRegressionString(remediation.caseType, null),
    assertion: sanitizePolicyRegressionString(remediation.assertion, null),
    sourceFeedbackId: sanitizePolicyRegressionString(remediation.sourceFeedbackId, null),
    proposedAction: sanitizePolicyRegressionString(remediation.proposedAction, null),
    proposedQuestion: sanitizePolicyRegressionString(remediation.proposedQuestion, null),
    proposedPolicyPatch: sanitizePolicyRegressionFeedbackValue(remediation.proposedPolicyPatch ?? null),
    remediationPath: remediationFilePath ? projectRelative(projectPath, remediationFilePath) : null,
    reviewer,
    note,
    autoApplied: false,
    createdAt: reviewedAt,
  }

  const dryRun = !options.write
  const writeResult = { event: null }
  if (!dryRun) {
    const eventFilePath = path.join(brainDir(projectPath), brainFileForType("event"))
    await appendJsonl(eventFilePath, reviewEvent)
    writeResult.event = { filePath: eventFilePath, relativePath: projectRelative(projectPath, eventFilePath), records: 1 }
  }

  return {
    schema: "trading-ai-policy-regression-remediation-review-run-v1",
    mode: "self-question-policy-regression-remediation-review",
    projectPath,
    dryRun,
    action,
    remediation: sanitizedRemediation,
    remediationPath: remediationFilePath ? projectRelative(projectPath, remediationFilePath) : null,
    reviewEvent,
    writePolicy: {
      reviewEvents: "data/brain/self_training_events.jsonl only when --write is present",
      autoApplied: false,
      wroteWiki: false,
      wroteRaw: false,
      wrotePolicies: false,
    },
    writeResult,
  }
}

function approvedPolicyRegressionRemediationReviewEvents(records = [], remediationId = "") {
  const needle = String(remediationId ?? "").trim()
  return records
    .map((record) => record?.value ?? record)
    .filter((event) => event && typeof event === "object" && !Array.isArray(event))
    .filter((event) => event.eventType === "policy-regression-remediation-review")
    .filter((event) => event.result === "approved")
    .filter((event) => event.autoApplied === false)
    .filter((event) => !needle || event.remediationId === needle || event.id === needle)
}

function policyRegressionPatchTarget(reviewEvent = {}) {
  if (reviewEvent.remediationType === "policy_or_prompt_patch" || reviewEvent.proposedPolicyPatch) return "prompt_or_policy"
  if (reviewEvent.remediationType === "execution_repair") return "execution_environment"
  if (reviewEvent.remediationType === "case_output_repair") return "regression_case_output"
  return "manual_review"
}

function policyRegressionPatchCandidateNextCommand(reviewEvent = {}) {
  const remediationId = sanitizePolicyRegressionString(reviewEvent.remediationId, "<remediation-id>")
  return `npm run codex:ingest -- self-question policy regression remediation patches --remediation-id ${shellArg(remediationId)} --write`
}

function buildPolicyRegressionPatchCandidate(reviewEvent = {}) {
  const sanitizedEvent = sanitizePolicyRegressionFeedbackValue(reviewEvent)
  const patchTarget = policyRegressionPatchTarget(sanitizedEvent)
  return {
    schema: "trading-ai-policy-regression-patch-candidate-v1",
    id: `policy_reg_patch_${shortHash(stableJsonString({
      reviewEventId: sanitizedEvent.id,
      remediationId: sanitizedEvent.remediationId,
      proposedPolicyPatch: sanitizedEvent.proposedPolicyPatch,
      patchTarget,
    }))}`,
    type: "policy_regression_patch_candidate",
    status: "candidate",
    reviewEventId: sanitizePolicyRegressionString(sanitizedEvent.id, null),
    remediationId: sanitizePolicyRegressionString(sanitizedEvent.remediationId, null),
    remediationType: sanitizePolicyRegressionString(sanitizedEvent.remediationType, null),
    feedbackType: sanitizePolicyRegressionString(sanitizedEvent.feedbackType, null),
    severity: sanitizePolicyRegressionString(sanitizedEvent.severity, null),
    policyId: sanitizePolicyRegressionString(sanitizedEvent.policyId, null),
    caseId: sanitizePolicyRegressionString(sanitizedEvent.caseId, null),
    caseType: sanitizePolicyRegressionString(sanitizedEvent.caseType, null),
    assertion: sanitizePolicyRegressionString(sanitizedEvent.assertion, null),
    sourceFeedbackId: sanitizePolicyRegressionString(sanitizedEvent.sourceFeedbackId, null),
    remediationPath: sanitizePolicyRegressionString(sanitizedEvent.remediationPath, null),
    patchTarget,
    proposedAction: sanitizePolicyRegressionString(sanitizedEvent.proposedAction, null),
    proposedQuestion: sanitizePolicyRegressionString(sanitizedEvent.proposedQuestion, null),
    proposedPolicyPatch: sanitizePolicyRegressionFeedbackValue(sanitizedEvent.proposedPolicyPatch ?? null),
    sourceRefs: [sanitizedEvent.remediationPath, sanitizedEvent.sourceFeedbackId].filter(Boolean).map((item) => safeErrorMessage(item)),
    applyMode: "manual_required",
    reviewRequired: true,
    autoApplied: false,
    reviewer: sanitizePolicyRegressionString(sanitizedEvent.reviewer, null),
    reviewNote: sanitizePolicyRegressionString(sanitizedEvent.note, null),
    reviewedAt: sanitizePolicyRegressionString(sanitizedEvent.createdAt, null),
    nextCommand: policyRegressionPatchCandidateNextCommand(sanitizedEvent),
  }
}

function countPolicyRegressionPatchTargets(candidates = []) {
  return Object.fromEntries(
    [...candidates.reduce((map, item) => map.set(item.patchTarget, (map.get(item.patchTarget) ?? 0) + 1), new Map()).entries()]
      .sort(([a], [b]) => a.localeCompare(b)),
  )
}

export async function exportSelfQuestionPolicyRegressionPatchCandidates(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const generatedAt = nowLocalTimestamp()
  const runId = `self_question_policy_regression_patches_${generatedAt.replace(/[-: ]/g, "").slice(0, 14)}`
  const remediationId = String(options.remediationId ?? options["remediation-id"] ?? options.id ?? "").trim()
  const reviewRecords = Array.isArray(options.reviewEvents)
    ? options.reviewEvents
    : await readBrainRecords(projectPath)
  const approvedEvents = approvedPolicyRegressionRemediationReviewEvents(reviewRecords, remediationId)
  const patchCandidates = approvedEvents.map(buildPolicyRegressionPatchCandidate)
  const dryRun = !options.write
  const run = {
    schema: "trading-ai-policy-regression-patch-candidate-run-v1",
    mode: "self-question-policy-regression-patch-candidates",
    runId,
    generatedAt,
    projectPath,
    dryRun,
    sourceBrainPath: "data/brain/self_training_events.jsonl",
    remediationId: remediationId || null,
    counts: {
      approvedReviewEvents: approvedEvents.length,
      patchCandidates: patchCandidates.length,
      byPatchTarget: countPolicyRegressionPatchTargets(patchCandidates),
    },
    patchCandidates,
    writePolicy: {
      artifacts: ".llm-wiki/policy-regression-patches",
      wroteWiki: false,
      wroteRaw: false,
      wroteBrain: false,
      autoApplied: false,
    },
    writeResult: null,
  }
  if (!dryRun) {
    const outputDir = path.join(projectPath, ".llm-wiki", "policy-regression-patches")
    await ensureDirectory(outputDir)
    const outputPath = path.join(outputDir, `${generatedAt.replace(/[-: ]/g, "").slice(0, 14)}-policy-regression-patches.json`)
    run.writeResult = { filePath: outputPath, relativePath: projectRelative(projectPath, outputPath), records: patchCandidates.length }
    await fs.writeFile(outputPath, `${JSON.stringify(run, null, 2)}\n`, "utf8")
  }
  return run
}

function policyRegressionPatchCandidateRunCandidates(raw) {
  if (Array.isArray(raw?.patchCandidates)) return raw.patchCandidates
  if (raw?.schema === "trading-ai-policy-regression-patch-candidate-v1") return [raw]
  return []
}

async function readPolicyRegressionPatchCandidates(filePath) {
  const raw = await readJsonFile(filePath)
  return policyRegressionPatchCandidateRunCandidates(raw)
}

async function findSelfQuestionPolicyRegressionPatchCandidate(projectPath, options = {}) {
  if (options.patchCandidate && typeof options.patchCandidate === "object" && !Array.isArray(options.patchCandidate)) {
    return { candidate: options.patchCandidate, filePath: null }
  }
  const patchId = String(options.patchId ?? options["patch-id"] ?? options.candidateId ?? options["candidate-id"] ?? options.id ?? "").trim()
  const remediationId = String(options.remediationId ?? options["remediation-id"] ?? "").trim()
  const patchPath = resolveProjectFile(projectPath, options.patchPath ?? options.patch ?? options["patch-path"] ?? options.candidates ?? options["patch-candidates"])
  const files = patchPath
    ? [patchPath]
    : (await listFilesRecursive(path.join(projectPath, ".llm-wiki", "policy-regression-patches"), {
      extensions: new Set([".json"]),
      excludeDirNames: new Set([".git", "node_modules"]),
      maxBytes: 1024 * 1024 * 5,
    }).catch(() => [])).sort().reverse()

  const matches = []
  for (const filePath of files) {
    let candidates = []
    try {
      candidates = await readPolicyRegressionPatchCandidates(filePath)
    } catch (err) {
      if (patchPath) throw err
      continue
    }
    for (const candidate of candidates) {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue
      if (patchId && candidate.id !== patchId) continue
      if (!patchId && remediationId && candidate.remediationId !== remediationId) continue
      matches.push({ candidate, filePath })
    }
  }
  if (matches.length === 0) {
    const id = patchId || remediationId
    throw new Error(id ? `Policy regression patch candidate not found: ${id}` : "Policy regression patch candidate not found")
  }
  if (!patchId && !remediationId && matches.length > 1) throw new Error("Multiple policy regression patch candidates found; pass --patch-id or --remediation-id")
  if (!patchId && remediationId && matches.length > 1) throw new Error("Multiple policy regression patch candidates found for remediation; pass --patch-id")
  return matches[0]
}

function policyPatchArray(value) {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === "object" && !Array.isArray(item)) : []
}

function sanitizedPromptGuardrails(policy = {}, patch = {}) {
  const guardrails = Array.isArray(policy.promptGuardrails)
    ? policy.promptGuardrails
    : policy.promptGuardrail
      ? [policy.promptGuardrail]
      : []
  if (patch.promptGuardrail) guardrails.push(patch.promptGuardrail)
  return [...new Set(guardrails.map((item) => sanitizePolicyRegressionString(item, null)).filter(Boolean))]
}

function buildActivePolicyRevisionFromPatchCandidate({ candidate, activePolicy, reviewer, note, appliedAt }) {
  const sanitizedCandidate = sanitizePolicyRegressionFeedbackValue(candidate)
  const patchTarget = policyRegressionPatchTarget(sanitizedCandidate)
  if (patchTarget !== "prompt_or_policy") throw new Error(`Policy regression patch target is not supported for active policy apply: ${patchTarget}`)
  const patch = sanitizePolicyRegressionFeedbackValue(sanitizedCandidate.proposedPolicyPatch ?? {})
  const policyId = sanitizePolicyRegressionString(patch.policyId ?? sanitizedCandidate.policyId, null)
  if (!policyId) throw new Error("Patch candidate is missing policyId")
  if (!activePolicy) throw new Error(`Active policy not found for patch candidate: ${policyId}`)
  const caseType = sanitizePolicyRegressionString(patch.caseType ?? sanitizedCandidate.caseType, "all")
  const addRegressionAssertion = sanitizePolicyRegressionString(patch.addRegressionAssertion ?? sanitizedCandidate.assertion, null)
  const regressionAssertions = normalizePolicyRegressionAssertions(activePolicy.regressionAssertions)
  if (addRegressionAssertion) {
    regressionAssertions[caseType] = [...new Set([...(regressionAssertions[caseType] ?? []), addRegressionAssertion])]
  }
  const promptGuardrails = sanitizedPromptGuardrails(activePolicy, patch)
  const regressionQuestions = [...new Set([
    ...(Array.isArray(activePolicy.regressionQuestions) ? activePolicy.regressionQuestions : []),
    sanitizedCandidate.proposedQuestion,
  ].map((item) => sanitizePolicyRegressionString(item, null)).filter(Boolean))]
  const previousRevision = Number(activePolicy.revision ?? activePolicy.policyRevision ?? 1)
  const revision = Number.isFinite(previousRevision) ? previousRevision + 1 : 2
  const patchRecord = {
    patchCandidateId: sanitizePolicyRegressionString(sanitizedCandidate.id, null),
    reviewEventId: sanitizePolicyRegressionString(sanitizedCandidate.reviewEventId, null),
    remediationId: sanitizePolicyRegressionString(sanitizedCandidate.remediationId, null),
    patchTarget,
    caseType,
    addRegressionAssertion,
    promptGuardrail: sanitizePolicyRegressionString(patch.promptGuardrail, null),
    appliedAt,
  }
  return {
    ...sanitizePolicyRegressionFeedbackValue(activePolicy),
    schema: "trading-ai-policy-v1",
    id: `${policyId}_rev_${shortHash(stableJsonString({ policyId, revision, patchCandidateId: sanitizedCandidate.id, appliedAt }))}`,
    type: "policy",
    policyId,
    status: "active",
    revision,
    regressionAssertions,
    promptGuardrails,
    regressionQuestions,
    sourcePatchCandidateId: patchRecord.patchCandidateId,
    sourcePatchReviewEventId: patchRecord.reviewEventId,
    sourceRemediationId: patchRecord.remediationId,
    sourceFeedbackId: sanitizePolicyRegressionString(sanitizedCandidate.sourceFeedbackId, null),
    patchTarget,
    policyPatches: [...policyPatchArray(activePolicy.policyPatches).map(sanitizePolicyRegressionFeedbackValue), patchRecord].slice(-20),
    reviewer,
    reviewNote: note,
    patchedAt: appliedAt,
    updatedAt: appliedAt,
  }
}

function findAppliedPolicyRegressionPatchEvent(records = [], patchCandidateId) {
  return records
    .map((record) => record?.value ?? record)
    .filter((event) => event && typeof event === "object" && !Array.isArray(event))
    .find((event) => (
      event.type === "event" &&
      event.eventType === "policy-regression-patch-apply" &&
      event.result === "applied" &&
      event.patchCandidateId === patchCandidateId
    ))
}

export async function applySelfQuestionPolicyRegressionPatchCandidate(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const appliedAt = nowLocalTimestamp()
  const { candidate, filePath: patchFilePath } = await findSelfQuestionPolicyRegressionPatchCandidate(projectPath, options)
  const sanitizedCandidate = sanitizePolicyRegressionFeedbackValue(candidate)
  const policyId = sanitizePolicyRegressionString(sanitizedCandidate.proposedPolicyPatch?.policyId ?? sanitizedCandidate.policyId, null)
  const records = await readBrainRecords(projectPath)
  const activePolicy = (await listActiveSelfQuestionPolicies({ projectPath })).policies.find((policy) => (policy.policyId ?? policy.id) === policyId)
  const reviewer = safeErrorMessage(String(options.reviewer ?? "").trim() || "manual")
  const note = safeErrorMessage(String(options.note ?? "").trim())
  const alreadyAppliedEvent = findAppliedPolicyRegressionPatchEvent(records, sanitizedCandidate.id)
  const alreadyApplied = Boolean(alreadyAppliedEvent) && !options.force
  const activePolicyRevision = alreadyApplied
    ? null
    : buildActivePolicyRevisionFromPatchCandidate({ candidate: sanitizedCandidate, activePolicy, reviewer, note, appliedAt })
  const applyEvent = alreadyApplied
    ? sanitizePolicyRegressionFeedbackValue(alreadyAppliedEvent)
    : {
      schema: "trading-ai-policy-regression-patch-apply-event-v1",
      id: makeBrainRecordId("event", `apply:${sanitizedCandidate.id ?? ""}`),
      type: "event",
      eventType: "policy-regression-patch-apply",
      result: "applied",
      patchCandidateId: sanitizePolicyRegressionString(sanitizedCandidate.id, null),
      patchTarget: sanitizePolicyRegressionString(activePolicyRevision.patchTarget, null),
      policyId: activePolicyRevision.policyId,
      activePolicyRevisionId: activePolicyRevision.id,
      revision: activePolicyRevision.revision,
      reviewEventId: sanitizePolicyRegressionString(sanitizedCandidate.reviewEventId, null),
      remediationId: sanitizePolicyRegressionString(sanitizedCandidate.remediationId, null),
      sourceFeedbackId: sanitizePolicyRegressionString(sanitizedCandidate.sourceFeedbackId, null),
      patchPath: patchFilePath ? projectRelative(projectPath, patchFilePath) : null,
      reviewer,
      note,
      autoApplied: false,
      createdAt: appliedAt,
    }

  const dryRun = !options.write
  const writeResult = { policy: null, event: null }
  if (!dryRun && !alreadyApplied) {
    const policyFilePath = path.join(brainDir(projectPath), brainFileForType("policy"))
    await appendJsonl(policyFilePath, activePolicyRevision)
    writeResult.policy = { filePath: policyFilePath, relativePath: projectRelative(projectPath, policyFilePath), records: 1 }
    const eventFilePath = path.join(brainDir(projectPath), brainFileForType("event"))
    await appendJsonl(eventFilePath, applyEvent)
    writeResult.event = { filePath: eventFilePath, relativePath: projectRelative(projectPath, eventFilePath), records: 1 }
  }

  return {
    schema: "trading-ai-policy-regression-patch-apply-run-v1",
    mode: "self-question-policy-regression-patch-apply",
    projectPath,
    dryRun,
    alreadyApplied,
    patchPath: patchFilePath ? projectRelative(projectPath, patchFilePath) : null,
    patchCandidate: sanitizedCandidate,
    activePolicyRevision,
    applyEvent,
    writePolicy: {
      activePolicies: "data/brain/policies.jsonl only when --write is present and patch is not already applied",
      reviewEvents: "data/brain/self_training_events.jsonl only when --write is present and patch is not already applied",
      wroteWiki: false,
      wroteRaw: false,
      autoApplied: false,
    },
    writeResult,
  }
}

export async function reviewSelfQuestionPolicyProposal(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const action = normalizePolicyReviewAction(options.action ?? options.result ?? options.review)
  const reviewedAt = nowLocalTimestamp()
  const { proposal, filePath: proposalFilePath } = await findSelfQuestionPolicyProposal(projectPath, options)
  const activePolicy = action === "approve" ? buildActivePolicyFromProposal(proposal, options, reviewedAt) : null
  const reviewEvent = {
    id: makeBrainRecordId("event", `${action}:${proposal.policyId ?? ""}`),
    type: "event",
    eventType: "policy-review",
    result: action === "approve" ? "approved" : "rejected",
    proposalPolicyId: proposal.policyId ?? null,
    activePolicyId: activePolicy?.policyId ?? null,
    scope: proposal.scope ?? null,
    rule: proposal.rule ?? null,
    evidenceGap: proposal.evidenceGap ?? null,
    proposalPath: projectRelative(projectPath, proposalFilePath),
    reviewer: String(options.reviewer ?? "").trim() || "manual",
    note: String(options.note ?? "").trim(),
    createdAt: reviewedAt,
  }

  const dryRun = !options.write
  const writeResult = { policy: null, event: null }
  if (!dryRun) {
    if (activePolicy) {
      const existing = await listActiveSelfQuestionPolicies({ projectPath })
      const alreadyActive = existing.policies.find((policy) => policy.policyId === activePolicy.policyId || policy.sourceProposalId === proposal.policyId)
      if (!alreadyActive) {
        const policyFilePath = path.join(brainDir(projectPath), brainFileForType("policy"))
        await appendJsonl(policyFilePath, activePolicy)
        writeResult.policy = { filePath: policyFilePath, relativePath: projectRelative(projectPath, policyFilePath), records: 1 }
      }
    }
    const eventFilePath = path.join(brainDir(projectPath), brainFileForType("event"))
    await appendJsonl(eventFilePath, reviewEvent)
    writeResult.event = { filePath: eventFilePath, relativePath: projectRelative(projectPath, eventFilePath), records: 1 }
  }

  return {
    schema: "trading-ai-policy-review-run-v1",
    mode: "self-question-policy-review",
    projectPath,
    dryRun,
    action,
    proposal,
    proposalPath: projectRelative(projectPath, proposalFilePath),
    activePolicy,
    reviewEvent,
    writePolicy: {
      activePolicies: "data/brain/policies.jsonl only when action=approve and --write is present",
      reviewEvents: "data/brain/self_training_events.jsonl only when --write is present",
      wroteWiki: false,
      wroteRaw: false,
    },
    writeResult,
  }
}

export async function listSelfTrainingActions(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const statusFilter = normalizeSelfTrainingActionListStatus(options.status)
  const orderBy = normalizeSelfTrainingActionOrder(options.orderBy ?? options["order-by"])
  const limit = parsePositiveInteger(options.limit ?? options.maxActions ?? options["max-actions"], 50)
  const ruleFilter = String(options.rule ?? "").trim().toLowerCase()
  const targetFilter = String(options.target ?? "").trim().toLowerCase()
  const actionFilter = String(options.action ?? "").trim().toLowerCase()
  const records = await readBrainRecords(projectPath)
  const actionRecords = records.filter(isSelfTrainingActionRecord)
  const reviewRecords = records.filter(isSelfTrainingActionReviewRecord).sort(compareSelfTrainingRecordDesc)
  const reviewsByActionKey = new Map()
  for (const reviewRecord of reviewRecords) {
    const review = reviewRecord.value
    const keys = [review.actionId, review.actionFingerprint].map((item) => String(item ?? "").trim()).filter(Boolean)
    for (const key of keys) {
      if (!reviewsByActionKey.has(key)) reviewsByActionKey.set(key, [])
      reviewsByActionKey.get(key).push(reviewRecord)
    }
  }

  const actionSummaries = actionRecords.map((record) => {
    const action = record.value
    const keys = [action.id, action.actionFingerprint].map((item) => String(item ?? "").trim()).filter(Boolean)
    const matchedReviews = new Map()
    for (const key of keys) {
      for (const reviewRecord of reviewsByActionKey.get(key) ?? []) {
        matchedReviews.set(selfTrainingRecordIdentity(reviewRecord), reviewRecord)
      }
    }
    const reviews = [...matchedReviews.values()].sort(compareSelfTrainingRecordDesc)
    const latestReview = reviews[0] ? summarizeSelfTrainingActionReviewRecord(reviews[0]) : null
    const reviewStatus = latestReview?.result ?? "open"
    return sanitizePolicyRegressionFeedbackValue({
      id: action.id ?? null,
      actionFingerprint: action.actionFingerprint ?? null,
      rule: action.rule ?? null,
      target: action.target ?? null,
      action: action.action ?? null,
      reason: action.reason ?? null,
      gateStatus: action.gateStatus ?? null,
      nextAction: action.nextAction ?? null,
      nextStages: selfTrainingLedgerArray(action.nextStages),
      suggestedCommands: selfTrainingLedgerArray(action.suggestedCommands),
      evidenceGaps: selfTrainingLedgerArray(action.evidenceGaps),
      evidenceTasks: selfTrainingLedgerArray(action.evidenceTasks),
      affectedIds: selfTrainingLedgerArray(action.affectedIds),
      priority: selfTrainingActionPriority(action),
      createdAt: action.createdAt ?? null,
      path: record.path ?? null,
      line: record.line ?? null,
      reviewStatus,
      reviewed: Boolean(latestReview),
      latestReview,
      reviewCount: reviews.length,
    })
  }).sort(orderBy === "priority" ? compareSelfTrainingLedgerPriority : compareSelfTrainingLedgerItemDesc)

  const fieldFiltered = actionSummaries.filter((item) => {
    if (ruleFilter && !String(item.rule ?? "").toLowerCase().includes(ruleFilter)) return false
    if (targetFilter && !String(item.target ?? "").toLowerCase().includes(targetFilter)) return false
    if (actionFilter && !String(item.action ?? "").toLowerCase().includes(actionFilter)) return false
    return true
  })
  const statusFiltered = fieldFiltered.filter((item) => {
    if (statusFilter === "all") return true
    if (statusFilter === "open") return item.reviewStatus === "open"
    if (statusFilter === "reviewed") return item.reviewed
    return item.reviewStatus === statusFilter
  })
  const actions = statusFiltered.slice(0, limit)
  const countStatus = (status) => fieldFiltered.filter((item) => item.reviewStatus === status).length
  const reviewedCount = fieldFiltered.filter((item) => item.reviewed).length

  return {
    schema: "self-training-action-ledger-v1",
    mode: "self-train-actions",
    projectPath,
    statusFilter,
    orderBy,
    filters: {
      rule: selfTrainingLedgerString(options.rule),
      target: selfTrainingLedgerString(options.target),
      action: selfTrainingLedgerString(options.action),
    },
    limit,
    counts: {
      actions: actionSummaries.length,
      matchingFilters: fieldFiltered.length,
      open: countStatus("open"),
      reviewed: reviewedCount,
      approved: countStatus("approved"),
      rejected: countStatus("rejected"),
      resolved: countStatus("resolved"),
      reviewEvents: reviewRecords.length,
      returned: actions.length,
    },
    actions,
  }
}

function selfTrainingLedgerSummaryFromAction(action = {}, index = 0) {
  const actionFingerprint = action.actionFingerprint ?? selfTrainingActionFingerprint(action)
  return sanitizePolicyRegressionFeedbackValue({
    id: action.id ?? `self_train_${actionFingerprint}`,
    actionFingerprint,
    rule: action.rule ?? null,
    target: action.target ?? null,
    action: action.action ?? null,
    reason: action.reason ?? null,
    gateStatus: action.gateStatus ?? null,
    nextAction: action.nextAction ?? null,
    nextStages: selfTrainingLedgerArray(action.nextStages),
    suggestedCommands: selfTrainingLedgerArray(action.suggestedCommands),
    evidenceGaps: selfTrainingLedgerArray(action.evidenceGaps),
    evidenceTasks: selfTrainingLedgerArray(action.evidenceTasks),
    affectedIds: selfTrainingLedgerArray(action.affectedIds),
    priority: action.priority ?? selfTrainingActionPriority(action),
    createdAt: action.createdAt ?? null,
    path: action.path ?? "in-memory",
    line: action.line ?? index + 1,
    reviewStatus: action.reviewStatus ?? "open",
    reviewed: Boolean(action.reviewed),
    latestReview: action.latestReview ?? null,
    reviewCount: action.reviewCount ?? 0,
  })
}

function listProvidedSelfTrainingActions(projectPath, actionsInput = [], options = {}) {
  const statusFilter = normalizeSelfTrainingActionListStatus(options.status)
  const orderBy = normalizeSelfTrainingActionOrder(options.orderBy ?? options["order-by"])
  const limit = parsePositiveInteger(options.limit ?? options.maxActions ?? options["max-actions"], 50)
  const ruleFilter = String(options.rule ?? "").trim().toLowerCase()
  const targetFilter = String(options.target ?? "").trim().toLowerCase()
  const actionFilter = String(options.action ?? "").trim().toLowerCase()
  const actionSummaries = actionsInput
    .map((action, index) => selfTrainingLedgerSummaryFromAction(action, index))
    .sort(orderBy === "priority" ? compareSelfTrainingLedgerPriority : compareSelfTrainingLedgerItemDesc)
  const fieldFiltered = actionSummaries.filter((item) => {
    if (ruleFilter && !String(item.rule ?? "").toLowerCase().includes(ruleFilter)) return false
    if (targetFilter && !String(item.target ?? "").toLowerCase().includes(targetFilter)) return false
    if (actionFilter && !String(item.action ?? "").toLowerCase().includes(actionFilter)) return false
    return true
  })
  const statusFiltered = fieldFiltered.filter((item) => {
    if (statusFilter === "all") return true
    if (statusFilter === "open") return item.reviewStatus === "open"
    if (statusFilter === "reviewed") return item.reviewed
    return item.reviewStatus === statusFilter
  })
  const actions = statusFiltered.slice(0, limit)
  const countStatus = (status) => fieldFiltered.filter((item) => item.reviewStatus === status).length
  const reviewedCount = fieldFiltered.filter((item) => item.reviewed).length
  return {
    schema: "self-training-action-ledger-v1",
    mode: "self-train-actions",
    source: "in-memory-self-training-actions",
    projectPath,
    statusFilter,
    orderBy,
    filters: {
      rule: selfTrainingLedgerString(options.rule),
      target: selfTrainingLedgerString(options.target),
      action: selfTrainingLedgerString(options.action),
    },
    limit,
    counts: {
      actions: actionSummaries.length,
      matchingFilters: fieldFiltered.length,
      open: countStatus("open"),
      reviewed: reviewedCount,
      approved: countStatus("approved"),
      rejected: countStatus("rejected"),
      resolved: countStatus("resolved"),
      reviewEvents: 0,
      returned: actions.length,
    },
    actions,
  }
}

export async function planSelfTrainingActions(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const generatedAt = String(options.generatedAt ?? nowLocalTimestamp())
  const runId = `self_training_plan_${generatedAt.replace(/[-: ]/g, "").slice(0, 14)}`
  const status = options.status ?? "open"
  const limit = parsePositiveInteger(options.limit ?? options.maxActions ?? options["max-actions"], 5)
  const providedActions = Array.isArray(options.actions) ? options.actions : null
  const ledgerOptions = {
    status,
    limit,
    rule: options.rule,
    target: options.target,
    action: options.action,
    orderBy: "priority",
  }
  const ledger = providedActions
    ? listProvidedSelfTrainingActions(projectPath, providedActions, ledgerOptions)
    : await listSelfTrainingActions({ projectPath, ...ledgerOptions })
  const actions = ledger.actions.map((action, index) => {
    const steps = selfTrainingActionPlanSteps(action)
    return sanitizePolicyRegressionFeedbackValue({
      id: `self_training_plan_item_${shortHash(action.id ?? action.actionFingerprint ?? `${index}`)}`,
      sequence: index + 1,
      status: "planned",
      createdAt: generatedAt,
      sourceActionId: action.id ?? null,
      sourceActionFingerprint: action.actionFingerprint ?? null,
      sourceRule: action.rule ?? null,
      sourceTarget: action.target ?? null,
      sourceAction: action.action ?? null,
      sourceReason: action.reason ?? null,
      reviewStatus: action.reviewStatus ?? "open",
      priority: action.priority ?? null,
      evidenceGaps: action.evidenceGaps ?? [],
      affectedIds: action.affectedIds ?? [],
      gateStatus: action.gateStatus ?? null,
      nextStages: action.nextStages ?? [],
      steps,
      reviewCommand: action.id ? `npm run codex:ingest -- self-train review --id ${shellArg(action.id)} --action resolve --write` : null,
    })
  })
  const byRule = Object.fromEntries([...actions.reduce((map, item) => {
    const key = String(item.sourceRule ?? "unknown")
    map.set(key, (map.get(key) ?? 0) + 1)
    return map
  }, new Map()).entries()].sort(([a], [b]) => a.localeCompare(b)))
  const byStepType = Object.fromEntries([...actions.flatMap((item) => item.steps ?? []).reduce((map, step) => {
    const key = String(step.type ?? "unknown")
    map.set(key, (map.get(key) ?? 0) + 1)
    return map
  }, new Map()).entries()].sort(([a], [b]) => a.localeCompare(b)))
  const dryRun = !options.write
  const run = {
    schema: "self-training-action-plan-run-v1",
    mode: "self-train-plan",
    runId,
    generatedAt,
    projectPath,
    dryRun,
    sourceLedger: {
      schema: ledger.schema,
      source: ledger.source ?? "persisted-self-training-actions",
      statusFilter: ledger.statusFilter,
      orderBy: ledger.orderBy,
      filters: ledger.filters,
      limit: ledger.limit,
      counts: ledger.counts,
    },
    counts: {
      actions: actions.length,
      steps: actions.reduce((sum, item) => sum + (item.steps?.length ?? 0), 0),
      byRule,
      byStepType,
    },
    actions,
    writePolicy: {
      artifacts: ".llm-wiki/self-training-plans only when --write is present",
      wroteWiki: false,
      wroteRaw: false,
      wroteBrain: false,
      autoExecuted: false,
    },
    writeResult: null,
  }
  if (!dryRun) {
    const { outputDir, outputPath } = await resolveSelfTrainingPlanPath(projectPath, generatedAt)
    await ensureDirectory(outputDir)
    run.writeResult = { filePath: outputPath, relativePath: projectRelative(projectPath, outputPath), records: actions.length }
    await fs.writeFile(outputPath, `${JSON.stringify(run, null, 2)}\n`, "utf8")
  }
  return run
}

export async function listSelfTrainingPlans(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const limit = parsePositiveInteger(options.limit ?? options.maxPlans ?? options["max-plans"], 20)
  const planDir = path.join(projectPath, ".llm-wiki", "self-training-plans")
  const files = await listFilesRecursive(planDir, {
    extensions: new Set([".json"]),
    excludeDirNames: new Set([".git", "node_modules"]),
    maxBytes: 1024 * 1024 * 5,
  }).catch(() => [])
  const plans = []
  const issues = []
  for (const filePath of files) {
    const relativePath = projectRelative(projectPath, filePath)
    try {
      const text = await fs.readFile(filePath, "utf8")
      const parsed = JSON.parse(text)
      if (parsed?.schema !== "self-training-action-plan-run-v1") continue
      const stat = await fs.stat(filePath)
      plans.push(sanitizePolicyRegressionFeedbackValue({
        schema: parsed.schema,
        mode: parsed.mode,
        runId: parsed.runId ?? null,
        generatedAt: parsed.generatedAt ?? null,
        relativePath,
        filePath,
        mtimeMs: stat.mtimeMs,
        sequence: selfTrainingPlanPathSequence(relativePath),
        dryRun: Boolean(parsed.dryRun),
        counts: parsed.counts ?? {},
        sourceLedger: parsed.sourceLedger ?? null,
        writePolicy: parsed.writePolicy ?? null,
        actionPreview: Array.isArray(parsed.actions)
          ? parsed.actions.slice(0, 10).map((item) => ({
            id: item.id ?? null,
            sourceActionId: item.sourceActionId ?? null,
            sourceRule: item.sourceRule ?? null,
            sourceTarget: item.sourceTarget ?? null,
            priority: item.priority ?? null,
            steps: Array.isArray(item.steps) ? item.steps.length : 0,
          }))
          : [],
      }))
    } catch (error) {
      issues.push({ relativePath, error: safeErrorMessage(error?.message ?? error) })
    }
  }
  const sortedPlans = plans.sort((a, b) => Number(b.mtimeMs ?? 0) - Number(a.mtimeMs ?? 0)
    || String(b.generatedAt ?? "").localeCompare(String(a.generatedAt ?? ""))
    || Number(b.sequence ?? 0) - Number(a.sequence ?? 0)
    || String(b.relativePath ?? "").localeCompare(String(a.relativePath ?? "")))
  return {
    schema: "self-training-action-plan-list-v1",
    mode: "self-train-plan-list",
    projectPath,
    totalPlans: sortedPlans.length,
    returned: Math.min(sortedPlans.length, limit),
    limit,
    issues,
    plans: sortedPlans.slice(0, limit),
  }
}

export async function verifySelfTrainingPlans(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const limit = parsePositiveInteger(options.limit ?? options.maxPlans ?? options["max-plans"], 20)
  const planPath = options.planPath ?? options.plan ?? options["plan-path"] ?? null
  let planTargets = []
  let resolvedPlanPath = null
  if (planPath) {
    const resolved = resolveSelfTrainingPlanInputPath(projectPath, planPath)
    resolvedPlanPath = resolved.relativePath
    const preflightIssues = []
    if (!resolved.filePath) {
      preflightIssues.push(selfTrainingPlanVerifyIssue("missing_plan_path", "Plan path was not provided."))
    }
    if (resolved.outsideProject) {
      preflightIssues.push(selfTrainingPlanVerifyIssue("plan_outside_project", "Plan path must stay inside the project root.", {
        relativePath: resolved.relativePath,
      }))
    }
    if (resolved.filePath) {
      planTargets = [{ filePath: resolved.filePath, preflightIssues }]
    }
  } else {
    planTargets = (await listSelfTrainingPlanVerifyFiles(projectPath, limit)).map((item) => ({
      filePath: item.filePath,
      preflightIssues: [],
    }))
  }
  const plans = []
  for (const target of planTargets) {
    plans.push(await verifySelfTrainingPlanFile(projectPath, target.filePath, target.preflightIssues))
  }
  const failed = plans.filter((item) => item.status !== "ok").length
  const issueCount = plans.reduce((sum, item) => sum + (Array.isArray(item.issues) ? item.issues.length : 0), 0)
  return sanitizePolicyRegressionFeedbackValue({
    schema: "self-training-action-plan-verify-v1",
    mode: "self-train-plan-verify",
    projectPath,
    status: failed > 0 ? "needs_remediation" : "ok",
    checked: plans.length,
    passed: plans.length - failed,
    failed,
    issueCount,
    filters: {
      planPath: resolvedPlanPath,
      limit,
    },
    plans,
  })
}

export async function runSelfTraining(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const records = await readBrainRecords(projectPath)
  const additionalRecords = (Array.isArray(options.additionalRecords) ? options.additionalRecords : [])
    .map((record, index) => record?.value
      ? record
      : { value: record, path: "in-memory", line: index + 1 })
  const actionRecords = additionalRecords.length > 0 ? [...records, ...additionalRecords] : records
  const reviewedActionKeys = selfTrainingReviewedActionKeys(actionRecords)
  const includeReviewed = Boolean(options.includeReviewed ?? options["include-reviewed"])
  const generatedActions = buildSelfTrainingActionsFromRecords(actionRecords)
  const actions = includeReviewed
    ? generatedActions
    : generatedActions.filter((action) => !reviewedActionKeys.has(action.id) && !reviewedActionKeys.has(action.actionFingerprint))
  const dryRun = !options.write
  let writeResult = null
  if (!dryRun) {
    const existingActionKeys = selfTrainingExistingActionKeys(records)
    const filePath = path.join(brainDir(projectPath), brainFileForType("event"))
    const actionsToWrite = actions.filter((action) => !existingActionKeys.has(action.id) && !existingActionKeys.has(action.actionFingerprint))
    for (const action of actionsToWrite) {
      await appendJsonl(filePath, { ...action, type: "event", eventType: "self-training-action", rulesVersion: "mpa-v1" })
    }
    writeResult = {
      filePath,
      relativePath: projectRelative(projectPath, filePath),
      records: actionsToWrite.length,
      skippedExisting: actions.length - actionsToWrite.length,
      skippedReviewed: generatedActions.length - actions.length,
    }
  }
  return { projectPath, dryRun, rules: SELF_TRAIN_RULES, actions, reviewedActionCount: generatedActions.length - actions.length, writeResult }
}

export async function reviewSelfTrainingAction(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const records = await readBrainRecords(projectPath)
  const action = normalizeSelfTrainingActionReview(options.action ?? options.result ?? options.review)
  const actionRecord = findSelfTrainingActionRecord(records, options)
  const reviewer = safeErrorMessage(String(options.reviewer ?? "").trim() || "manual")
  const note = safeErrorMessage(String(options.note ?? "").trim())
  const reviewQuality = normalizeSelfTrainingReviewQuality(options.quality ?? options.reviewQuality ?? options["review-quality"])
  const evidenceRefs = parseSelfTrainingReviewEvidenceRefs(options)
  if (reviewQuality === "high_confidence" && !evidenceRefs.length) {
    throw new Error("--evidence-ref is required when --quality high_confidence")
  }
  const reviewedAt = nowLocalTimestamp()
  const reviewEvent = {
    id: makeBrainRecordId("event", `self-training-action-review:${action}:${actionRecord.id ?? actionRecord.actionFingerprint ?? ""}`),
    type: "event",
    eventType: "self-training-action-review",
    reviewAction: action,
    result: selfTrainingActionReviewResult(action),
    actionId: actionRecord.id ?? null,
    actionFingerprint: actionRecord.actionFingerprint ?? null,
    sourceRule: actionRecord.rule ?? null,
    sourceTarget: actionRecord.target ?? null,
    sourceAction: actionRecord.action ?? null,
    reviewer,
    note,
    reviewQuality,
    evidenceRefs,
    createdAt: reviewedAt,
  }

  const dryRun = !options.write
  const writeResult = { event: null }
  if (!dryRun) {
    const eventFilePath = path.join(brainDir(projectPath), brainFileForType("event"))
    await appendJsonl(eventFilePath, reviewEvent)
    writeResult.event = { filePath: eventFilePath, relativePath: projectRelative(projectPath, eventFilePath), records: 1 }
  }

  return {
    schema: "self-training-action-review-run-v1",
    mode: "self-train-review",
    projectPath,
    dryRun,
    action,
    actionRecord: sanitizePolicyRegressionFeedbackValue(actionRecord),
    reviewEvent,
    writePolicy: {
      reviewEvents: "data/brain/self_training_events.jsonl only when --write is present",
      wroteWiki: false,
      wroteRaw: false,
    },
    writeResult,
  }
}

export async function marketValidatePrediction(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const prediction = String(options.prediction ?? options.text ?? "").trim()
  const stock = String(options.stock ?? "").trim()
  if (!prediction) throw new Error("Missing --prediction")
  if (!stock) throw new Error("Missing --stock")
  const windowDays = parsePositiveInteger(String(options.window ?? "").replace(/\D+/g, ""), parseStockLookbackDays(prediction))
  const query = `${prediction} ${stock} 最近${windowDays}个交易日 涨跌幅 成交量`
  const stockDaily = await searchAskStockDaily(projectPath, query, { ...options, sqlLimit: windowDays })
  const marketValidation = buildStockDailyMarketValidation(stockDaily, query)
  const record = {
    id: makeBrainRecordId("validation", `${prediction}:${stock}:${windowDays}`),
    type: "validation",
    kind: "market-validation",
    prediction,
    stock,
    stockCode: marketValidation?.stockCode ?? stockDaily.intent?.stockCode ?? null,
    stockName: marketValidation?.stockName ?? stockDaily.intent?.stockName ?? null,
    windowDays,
    result: normalizeBrainResult(marketValidation?.verdict),
    verdict: marketValidation?.verdict ?? stockDaily.warning ?? "证据不足",
    reason: marketValidation?.reason ?? stockDaily.warning ?? null,
    marketValidation,
    sqlRefs: marketValidation?.refs ?? [],
    createdAt: nowLocalTimestamp(),
  }
  let writeResult = null
  if (options.write) {
    const filePath = path.join(brainDir(projectPath), brainFileForType("validation"))
    await appendJsonl(filePath, record)
    writeResult = { filePath, relativePath: projectRelative(projectPath, filePath) }
  }
  return { projectPath, query, stockDaily, marketValidation, record, writeResult, dryRun: !options.write }
}
