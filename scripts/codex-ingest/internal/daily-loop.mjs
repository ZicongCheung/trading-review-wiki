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
  askWiki,
} from "./ask-flow.mjs"

import {
  attachDailyLoopMetrics,
  fetchDailyLoopExternalMarketMetrics,
  fetchDailyLoopStockMetrics,
  mergeDailyLoopMarketMetrics,
  parseDailyLoopMarketValidateMode,
  validationAnchorFromPrediction,
  verdictFromMarketMove,
} from "./ask-market.mjs"

import {
  getAutoresearchReadiness,
} from "./autoresearch.mjs"

import {
  brainDir,
  brainFileForType,
  daysSince,
  evidenceTasksFromFundamentalGaps,
  isCurrentDailyValidationRecord,
  listSelfTrainingActions,
  listSelfTrainingPlans,
  listActiveSelfQuestionPolicies,
  makeBrainRecordId,
  normalizeBrainResult,
  readBrainRecords,
  runSelfTraining,
  shellArg,
  verifySelfTrainingPlans,
} from "./brain-memory.mjs"

import {
  AGENT_RUNS_ROOT,
  DAILY_LOOP_DEFAULT_VALIDATION_WINDOWS,
  DAILY_LOOP_MODE_DEFAULT_COUNTS,
  DAILY_LOOP_QUESTION_TYPES_BY_MODE,
  DAILY_LOOP_QUESTION_TYPE_LABELS,
  DAILY_LOOP_THEME_PROFILES,
  DAILY_LOOP_VALIDATION_METHOD,
  DEFAULT_PROJECT_PATH,
  appendJsonl,
  ensureDirectory,
  exists,
  listFilesRecursive,
  mapWithConcurrency,
  normalizePath,
  normalizeStockCode,
  nowLocalTimestamp,
  parseJsonObjectFromModelText,
  parsePositiveInteger,
  projectRelative,
  readJsonlFile,
  readIfExists,
  requestCodexExecText,
  requestResponsesText,
  roundMetric,
  safeErrorMessage,
  shortHash,
} from "./core.mjs"

import {
  excerptForPrompt,
  parseFrontmatter,
  tokenizeQuery,
} from "./knowledge.mjs"

import {
  STOCK_FEEDBACK_QUALITY_GATES,
  readStockFeedbackTrainingSamples,
} from "./stock-feedback.mjs"

export function parseDailyLoopMode(value) {
  const mode = String(value ?? "full").trim().toLowerCase()
  if (!["premarket", "postclose", "full"].includes(mode)) throw new Error("--mode must be premarket, postclose, or full")
  return mode
}

export function parseDailyLoopWindows(value) {
  const parseWindow = (item) => parsePositiveInteger(String(item ?? "").trim().replace(/d$/i, ""), null)
  if (Array.isArray(value)) return value.map(parseWindow).filter(Boolean)
  const raw = String(value ?? "").trim()
  if (!raw) return DAILY_LOOP_DEFAULT_VALIDATION_WINDOWS
  const parsed = raw
    .split(",")
    .map(parseWindow)
    .filter(Boolean)
  return parsed.length > 0 ? [...new Set(parsed)] : DAILY_LOOP_DEFAULT_VALIDATION_WINDOWS
}

export function compactDailyLoopActivePolicy(policy = {}) {
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

export function isDailyLoopRecentPath(relativePath, lookbackDays) {
  const match = String(relativePath).match(/(20\d{2}-\d{2}-\d{2})/)
  if (!match) return false
  const age = daysSince(`${match[1]} 00:00:00`)
  return age == null || age <= Math.max(lookbackDays, 1)
}

export function codeFromFrontmatterLike(fm = {}) {
  const direct = normalizeStockCode(fm.code)
  if (direct) return direct
  const aliases = Array.isArray(fm.aliases) ? fm.aliases : fm.aliases ? [fm.aliases] : []
  for (const alias of aliases) {
    const code = normalizeStockCode(alias)
    if (code) return code
  }
  return null
}

export async function loadDailyLoopStockUniverse(projectPath) {
  const pp = normalizePath(projectPath)
  const stockDir = path.join(pp, "wiki", "股票")
  const files = await listFilesRecursive(stockDir, {
    extensions: new Set([".md"]),
    excludeDirNames: new Set([".git", ".conflicts", "scripts"]),
  }).catch(() => [])
  const stocks = []
  for (const filePath of files) {
    try {
      const content = await fs.readFile(filePath, "utf8")
      const relativePath = projectRelative(pp, filePath)
      const { fm, body } = parseFrontmatter(content)
      const name = typeof fm.title === "string" && fm.title.trim() ? fm.title.trim() : path.basename(filePath, ".md")
      const code = codeFromFrontmatterLike(fm)
      if (!code) continue
      const tags = Array.isArray(fm.tags) ? fm.tags.map(String) : []
      const related = Array.isArray(fm.related) ? fm.related.map(String) : []
      const sources = Array.isArray(fm.sources) ? fm.sources.map(String) : []
      const searchText = [name, code, fm.summary, tags.join(" "), related.join(" "), sources.join(" "), body.slice(0, 12000)].filter(Boolean).join("\n")
      stocks.push({
        name,
        code,
        path: relativePath,
        tags,
        related,
        sources,
        status: fm.status ?? null,
        confidence: fm.confidence ?? null,
        summary: fm.summary ?? "",
        updated: fm.updated ?? fm.last_reviewed ?? null,
        searchText,
      })
    } catch {}
  }
  const byCode = new Map()
  for (const stock of stocks) {
    const old = byCode.get(stock.code)
    if (!old || stock.searchText.length > old.searchText.length) byCode.set(stock.code, stock)
  }
  return [...byCode.values()]
}

export async function loadDailyLoopRecentCorpus(projectPath, lookbackDays) {
  const pp = normalizePath(projectPath)
  const roots = [
    path.join(pp, "wiki", "总结"),
    path.join(pp, "wiki", "模式"),
    path.join(pp, "wiki", "概念"),
    path.join(pp, "raw", "微信聊天"),
    path.join(pp, "raw", "研报新闻"),
    path.join(pp, "raw", "openclaw数据", "产业链复盘"),
    path.join(pp, "data", "facts"),
  ]
  const files = []
  for (const root of roots) {
    const found = await listFilesRecursive(root, {
      extensions: new Set([".md", ".txt", ".jsonl"]),
      excludeDirNames: new Set([".git", "node_modules", ".llm-wiki"]),
      maxBytes: 1024 * 1024 * 3,
    }).catch(() => [])
    files.push(...found)
  }
  const snippets = []
  for (const filePath of files) {
    const relativePath = projectRelative(pp, filePath)
    if (!isDailyLoopRecentPath(relativePath, lookbackDays) && !relativePath.startsWith("data/facts/")) continue
    const raw = await readIfExists(filePath)
    if (!raw.trim()) continue
    snippets.push({ path: relativePath, text: raw.slice(0, 20000) })
  }
  return snippets
}

export function scoreDailyLoopThemes(recentCorpus) {
  const wholeText = recentCorpus.map((item) => `${item.path}\n${item.text}`).join("\n")
  return DAILY_LOOP_THEME_PROFILES.map((theme) => {
    let score = 0
    const matched = []
    for (const keyword of theme.keywords) {
      const count = (wholeText.match(new RegExp(escapeRegExp(keyword), "gi")) ?? []).length
      if (count > 0) {
        score += count
        matched.push(keyword)
      }
    }
    return { ...theme, score, matchedKeywords: matched }
  }).sort((a, b) => b.score - a.score || a.branch.localeCompare(b.branch, "zh"))
}

export function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export function scoreStockForTheme(stock, theme) {
  let score = 0
  const matched = []
  for (const keyword of theme.keywords) {
    if (stock.searchText.toLowerCase().includes(keyword.toLowerCase())) {
      score += keyword.length > 3 ? 4 : 2
      matched.push(keyword)
    }
  }
  if (String(stock.status ?? "").includes("活跃")) score += 2
  if (String(stock.status ?? "").includes("观察")) score += 1
  if (String(stock.confidence ?? "").includes("高")) score += 2
  if (String(stock.confidence ?? "").includes("中")) score += 1
  score += Math.min(stock.sources.length, 8) * 0.3
  return { ...stock, branch: theme.branch, themeId: theme.id, themeScore: theme.score, stockThemeScore: roundMetric(score, 2), matchedKeywords: matched }
}

export function selectDailyLoopThemeStocks(stockUniverse, themes, maxStocksPerQuestion) {
  const byTheme = new Map()
  for (const theme of themes) {
    const scored = stockUniverse
      .map((stock) => scoreStockForTheme(stock, theme))
      .filter((stock) => stock.stockThemeScore > 0)
      .sort((a, b) => b.stockThemeScore - a.stockThemeScore || a.name.localeCompare(b.name, "zh"))
      .slice(0, Math.max(maxStocksPerQuestion * 2, maxStocksPerQuestion))
    byTheme.set(theme.id, scored)
  }
  return byTheme
}

export function underReflectedScore(stock) {
  const metric = stock.metric ?? {}
  const pct = metric.pct20
  const amountRatio = metric.amountRatio ?? 1
  if (pct == null) return stock.stockThemeScore
  return stock.stockThemeScore + Math.max(0, 18 - pct) * 0.8 + Math.max(0, amountRatio - 1) * 4
}

export function strongMovedScore(stock) {
  const metric = stock.metric ?? {}
  const pct = metric.pct20 ?? 0
  return stock.stockThemeScore + Math.max(0, pct - 20) * 0.8 + Math.max(0, (metric.amountRatio ?? 1) - 1) * 2
}

export function compactDailyStocks(stocks, maxCount) {
  return stocks.slice(0, maxCount).map((stock) => ({
    name: stock.name,
    code: stock.code,
    path: stock.path,
    branch: stock.branch,
    matchedKeywords: stock.matchedKeywords ?? [],
    metric: stock.metric ?? null,
  }))
}

export function stockLabel(stock) {
  return `${stock.name}(${stock.code})`
}

export function buildDailyLoopQuestion({ type, mode, theme, stocks, index }) {
  const branch = theme.branch
  const questionByType = {
    expected_difference: `最近一个月，AI硬件里的 ${branch} 是否属于知识库反复出现但股价还没充分反映的补涨方向？请结合原始材料、图谱关系、产业卡脖子程度和近20日量价做排序。`,
    bottleneck_supplier: `参考知识库里的热门赛道，${branch} 里哪些细分颗粒度方向更接近“卡脖子、不可替代、供货商议价权强”？请结合产业链位置、客户/订单线索、替代难度和股价反映程度找机会。`,
    weak_to_strong_low_buy: `最近市场热门方向里，${branch} 有没有从强转弱后的低吸机会？请区分情绪退潮、产业逻辑未坏和量价承接仍在的候选，并给出低吸条件与反证。`,
    risk_counter: `${branch} 里哪些细分机会可能已经被股价过度反映，容易演化成强一致接盘或高开回落？请结合近20日量价、知识库错误模式和原始材料反证排序。`,
    postclose_validation: `盘后验证 ${branch}：今日和近20日量价是否支持此前“补涨/卡脖子/供货商不可替代”的假设？哪些方向应升级、降级或继续观察？`,
    correction: `结合最近交易错误和 ${branch} 的机会挖掘，哪些提问或买入逻辑容易诱发追高、强一致接盘或低质量补涨？请输出下一轮防守语句和验证清单。`,
    wiki_feedback: `把今日 ${branch} 的证据、量价、反证和验证结果整理成待审核 wiki 反哺建议：哪些概念页、股票页、错误页需要更新？股票页仅限公司研究、催化和验证框架，不写个人买卖流水。`,
  }
  return {
    id: `daily_q_${index + 1}`,
    type,
    mode,
    branch,
    themeId: theme.id,
    question: questionByType[type] ?? questionByType.expected_difference,
    stocks: compactDailyStocks(stocks, stocks.length),
    expectedMove: type === "risk_counter" ? "bearish" : "bullish",
    validationWindows: DAILY_LOOP_DEFAULT_VALIDATION_WINDOWS,
  }
}

export function buildDailyLoopAskQuery(question) {
  const stockContext = question.stocks
    .map((stock) => {
      const metric = stock.metric ?? {}
      const metricText =
        metric.status === "ok"
          ? `近20日${metric.pct20 ?? "NA"}%，成交额比${metric.amountRatio ?? "NA"}x，换手${metric.avgTurnoverLast5 ?? "NA"}，行情验证${metric.marketValidation?.status ?? "unknown"}，${(metric.refs ?? [metric.sqlRef, metric.externalRef]).filter(Boolean).join(" ")}`
          : "日线不足"
      return `${stock.name}(${stock.code}) ${stock.branch ?? question.branch} ${metricText} 来源:${stock.path ?? ""}`
    })
    .join("\n")
  return `${question.question}

候选股票池和量价验证材料如下。请只把它当作可验证对象，不要把问题改写成单票复盘：
${stockContext}

回答时请优先做分支/细分方向排序，再落到上市公司验证，保留 wiki/raw/graph/facts/sql 引用。`
}

export function dailyLoopQuestionTypesForMode(mode) {
  return DAILY_LOOP_QUESTION_TYPES_BY_MODE.get(mode) ?? DAILY_LOOP_QUESTION_TYPES_BY_MODE.get("full")
}

export function normalizeDailyLoopQuestionType(value, fallback = "expected_difference") {
  const raw = String(value ?? "").trim()
  if (Object.hasOwn(DAILY_LOOP_QUESTION_TYPE_LABELS, raw)) return raw
  return fallback
}

export function scoreRecentCorpusForTheme(item, theme) {
  const text = `${item.path}\n${item.text}`.toLowerCase()
  let score = 0
  for (const keyword of theme.keywords ?? []) {
    const lowered = keyword.toLowerCase()
    if (text.includes(lowered)) score += keyword.length > 3 ? 3 : 1
  }
  if (isDailyLoopRecentPath(item.path, 7)) score += 2
  return score
}

export function compactDailyLoopMetric(metric = {}) {
  if (metric.status !== "ok") return { status: metric.status ?? "missing" }
  return {
    status: "ok",
    source: metric.source ?? "stock_daily_sql",
    startDate: metric.startDate,
    endDate: metric.endDate,
    pct20: metric.pct20,
    amountRatio: metric.amountRatio,
    volumeRatio: metric.volumeRatio,
    avgTurnoverLast5: metric.avgTurnoverLast5,
    sqlRef: metric.sqlRef,
    externalRef: metric.externalRef,
    refs: metric.refs,
    marketValidation: metric.marketValidation,
  }
}

export function compactDailyLoopStockForPlanner(stock) {
  return {
    name: stock.name,
    code: stock.code,
    branch: stock.branch,
    path: stock.path,
    matchedKeywords: (stock.matchedKeywords ?? []).slice(0, 8),
    stockThemeScore: stock.stockThemeScore,
    summary: excerptForPrompt(stock.summary || stock.searchText || "", 240),
    metric: compactDailyLoopMetric(stock.metric),
  }
}

export function compactDailyLoopHistoricalQuestion(record) {
  return {
    runId: record.runId ?? null,
    createdAt: record.createdAt ?? null,
    questionType: record.questionType ?? null,
    branch: record.branch ?? null,
    question: excerptForPrompt(record.question ?? "", 260),
  }
}

export async function loadRecentDailyLoopQuestionHistory(projectPath, { mode, limit = 24 } = {}) {
  const records = await readBrainRecords(projectPath)
  return records
    .map((item) => item.value)
    .filter((record) => record?.type === "prediction" && record.kind === "daily-discovery")
    .filter((record) => !mode || record.mode === mode)
    .filter((record) => record.question)
    .sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")))
    .slice(0, limit)
    .map(compactDailyLoopHistoricalQuestion)
}

export function dailyLoopQuestionTokenSet(question) {
  return new Set(tokenizeQuery(question).filter((token) => token.length > 1))
}

export function dailyLoopQuestionSimilarity(left, right) {
  const leftTokens = dailyLoopQuestionTokenSet(left)
  const rightTokens = dailyLoopQuestionTokenSet(right)
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0
  let intersection = 0
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersection += 1
  }
  const union = leftTokens.size + rightTokens.size - intersection
  const jaccard = union > 0 ? intersection / union : 0
  const containment = intersection / Math.min(leftTokens.size, rightTokens.size)
  return Math.max(jaccard, containment * 0.75)
}

export function findDailyLoopDuplicateQuestion(question, recentQuestions) {
  const text = String(question.question ?? "").trim()
  if (!text) return null
  for (const previous of recentQuestions ?? []) {
    const score = dailyLoopQuestionSimilarity(text, previous.question)
    const sameBranch = question.branch && previous.branch && String(question.branch) === String(previous.branch)
    const sameType = question.type && previous.questionType && String(question.type) === String(previous.questionType)
    if (score >= 0.52 || (sameBranch && score >= 0.48) || (sameBranch && sameType && score >= 0.42)) {
      return { previous, score }
    }
  }
  return null
}

export function dedupeDailyLoopQuestions(questions, recentQuestions, questionCount) {
  const accepted = []
  let duplicateFilteredCount = 0
  for (const question of questions) {
    if (accepted.length >= questionCount) break
    const duplicate = findDailyLoopDuplicateQuestion(question, recentQuestions)
    if (duplicate) {
      duplicateFilteredCount += 1
      continue
    }
    accepted.push(question)
  }
  return { questions: accepted, duplicateFilteredCount }
}

export function renumberDailyLoopQuestions(questions) {
  return questions.map((question, index) => ({ ...question, id: `daily_q_${index + 1}` }))
}

export function buildDailyLoopQuestionPlannerPrompt({ mode, questionCount, themes, stocksByTheme, metricsByCode, recentCorpus, maxStocksPerQuestion, recentQuestions = [], activePolicies = [] }) {
  const questionTypes = dailyLoopQuestionTypesForMode(mode).slice(0, questionCount)
  while (questionTypes.length < questionCount) questionTypes.push(dailyLoopQuestionTypesForMode(mode)[questionTypes.length % dailyLoopQuestionTypesForMode(mode).length])
  const activeThemes = themes
    .filter((theme) => (stocksByTheme.get(theme.id) ?? []).length > 0)
    .slice(0, 8)
    .map((theme) => {
      const stocks = attachDailyLoopMetrics(stocksByTheme.get(theme.id) ?? [], metricsByCode)
        .sort((a, b) => underReflectedScore(b) - underReflectedScore(a))
        .slice(0, Math.max(maxStocksPerQuestion * 2, maxStocksPerQuestion))
        .map(compactDailyLoopStockForPlanner)
      const evidence = recentCorpus
        .map((item) => ({ path: item.path, score: scoreRecentCorpusForTheme(item, theme), excerpt: excerptForPrompt(item.text, 420) }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score || b.path.localeCompare(a.path))
        .slice(0, 4)
      return {
        id: theme.id,
        branch: theme.branch,
        score: theme.score,
        matchedKeywords: (theme.matchedKeywords ?? []).slice(0, 16),
        stocks,
        evidence,
      }
    })
  return [
    "# Daily Trading Research Question Planner",
    "",
    `mode: ${mode}`,
    `question_count: ${questionCount}`,
    "",
    "You are planning deep daily research questions for a Chinese A-share trading knowledge base.",
    "Generate questions by thinking from the evidence, not by filling a template.",
    "",
    "Hard requirements:",
    "- Questions must be deep industry/trading research questions, not shallow single-stock price questions.",
    "- Each question should first ask about branch/sub-sector opportunity, expectation gap, bottleneck supplier, low-buy setup, risk counterevidence, validation, correction, or wiki feedback.",
    "- Put concrete stocks only in stockCodes; the question text may mention branches but should not become a list of tickers.",
    "- Every question must select 1-8 stockCodes from the provided candidate pools so later SQL validation can run.",
    "- Prefer questions similar in depth to: 最近一个月，AI硬件里MLCC、PCB材料、光模块、电源管理这些分支，哪些是知识库里反复出现但股价还没充分反映的补涨方向？请结合原始材料、图谱关系和近20日量价给我排序。",
    "- Do not repeat or lightly paraphrase recent daily-loop questions. A valid new question must introduce a materially new variable, branch angle, verification method, stock pool, or counterevidence path.",
    "- Avoid reusing the same branch + questionType framing from recent history unless the new question is clearly orthogonal.",
    "- If evidence is weak, ask a risk/反证/待验证 question instead of fabricating certainty.",
    "",
    "Active trading AI policies:",
    "```json",
    JSON.stringify(activePolicies, null, 2),
    "```",
    "",
    "Recent daily-loop questions to avoid:",
    "```json",
    JSON.stringify(recentQuestions, null, 2),
    "```",
    "",
    "Requested mix:",
    "```json",
    JSON.stringify(questionTypes.map((type, index) => ({ index: index + 1, questionType: type, label: DAILY_LOOP_QUESTION_TYPE_LABELS[type] })), null, 2),
    "```",
    "",
    "Candidate themes, corpus evidence, stock pools and SQL metrics:",
    "```json",
    JSON.stringify(activeThemes, null, 2),
    "```",
    "",
    "Return only JSON:",
    '{"questions":[{"questionType":"expected_difference","themeId":"ai-pcb-materials","branch":"PCB材料/工艺链","question":"...","expectedMove":"bullish","stockCodes":["SH600183"],"reason":"..."}]}',
  ].join("\n")
}

export async function requestDailyLoopQuestionsWithLlm({ mode, questionCount, themes, stocksByTheme, metricsByCode, recentCorpus, maxStocksPerQuestion, recentQuestions, projectPath, options }) {
  const activePolicies = Array.isArray(options.activePolicies) ? options.activePolicies : []
  const prompt = buildDailyLoopQuestionPlannerPrompt({ mode, questionCount, themes, stocksByTheme, metricsByCode, recentCorpus, maxStocksPerQuestion, recentQuestions, activePolicies })
  const instructions = "You are a daily A-share research question planner. Return only the requested JSON object. Do not edit files."
  let text
  if (options.dailyLoopQuestionPlanner) {
    const planned = await options.dailyLoopQuestionPlanner({ stage: "daily-loop-question-planner", prompt, instructions, mode, questionCount, themes, stocksByTheme, activePolicies })
    if (typeof planned === "string") text = planned
    else return Array.isArray(planned?.questions) ? planned.questions : Array.isArray(planned) ? planned : []
  } else if ((options.provider ?? "codex") === "codex") {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "trading-wiki-daily-planner-"))
    const outputPath = path.join(tmpDir, "questions.json")
    try {
      text = await requestCodexExecText({
        stage: "daily-loop-question-planner",
        prompt,
        instructions,
        model: options.model,
        prepared: { projectPath },
        outputPath,
        codexBin: options.codexBin,
        codexProfile: options.codexProfile,
        codexProfileV2: options.codexProfileV2,
        codexTimeoutMs: options.codexTimeoutMs,
      })
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    }
  } else if ((options.provider ?? "") === "openai") {
    const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY
    const model = options.model ?? process.env.OPENAI_MODEL
    if (!apiKey || !model) throw new Error("OpenAI daily-loop planner skipped because api key/model is missing")
    text = await requestResponsesText({
      apiKey,
      endpoint: options.endpoint,
      model,
      prompt,
      instructions,
      reasoningEffort: options.reasoningEffort ?? "high",
    })
  } else {
    throw new Error(`Unsupported daily-loop planner provider: ${options.provider}`)
  }
  const parsed = parseJsonObjectFromModelText(text)
  return Array.isArray(parsed.questions) ? parsed.questions : []
}

export function resolveDailyLoopPlannedQuestions({ planned, mode, themes, stocksByTheme, metricsByCode, questionCount, maxStocksPerQuestion }) {
  const activeThemes = themes.filter((theme) => (stocksByTheme.get(theme.id) ?? []).length > 0)
  const themeById = new Map(activeThemes.map((theme) => [theme.id, theme]))
  const allStocks = [...stocksByTheme.values()].flat()
  const stockByCode = new Map(attachDailyLoopMetrics(allStocks, metricsByCode).map((stock) => [stock.code, stock]))
  const fallbackTypes = dailyLoopQuestionTypesForMode(mode)
  const resolved = []

  for (const item of planned ?? []) {
    if (resolved.length >= questionCount) break
    const fallbackType = fallbackTypes[resolved.length % fallbackTypes.length]
    const type = normalizeDailyLoopQuestionType(item.questionType ?? item.type, fallbackType)
    const theme =
      themeById.get(String(item.themeId ?? "")) ??
      activeThemes.find((candidate) => String(item.branch ?? "").includes(candidate.branch) || candidate.branch.includes(String(item.branch ?? ""))) ??
      activeThemes[resolved.length % Math.max(activeThemes.length, 1)]
    if (!theme) continue
    const themeStocks = attachDailyLoopMetrics(stocksByTheme.get(theme.id) ?? [], metricsByCode)
    const ranked =
      type === "risk_counter"
        ? [...themeStocks].sort((a, b) => strongMovedScore(b) - strongMovedScore(a))
        : [...themeStocks].sort((a, b) => underReflectedScore(b) - underReflectedScore(a))
    const requestedCodes = Array.isArray(item.stockCodes) ? item.stockCodes.map(normalizeStockCode).filter(Boolean) : []
    const picked = []
    for (const code of requestedCodes) {
      const stock = ranked.find((candidate) => candidate.code === code) ?? stockByCode.get(code)
      if (stock && !picked.some((candidate) => candidate.code === stock.code)) picked.push(stock)
    }
    for (const stock of ranked) {
      if (picked.length >= maxStocksPerQuestion) break
      if (!picked.some((candidate) => candidate.code === stock.code)) picked.push(stock)
    }
    if (picked.length === 0) continue
    const questionText = String(item.question ?? "").replace(/\s+/g, " ").trim()
    const fallback = buildDailyLoopQuestion({ type, mode, theme, stocks: picked.slice(0, maxStocksPerQuestion), index: resolved.length })
    resolved.push({
      ...fallback,
      question: questionText.length >= 20 ? questionText : fallback.question,
      branch: item.branch ? String(item.branch).trim() : fallback.branch,
      expectedMove: ["bullish", "bearish", "observe"].includes(String(item.expectedMove ?? "")) ? String(item.expectedMove) : fallback.expectedMove,
      plannerReason: item.reason ? String(item.reason).trim() : null,
    })
  }

  if (resolved.length < questionCount) {
    const fallback = pickDailyLoopQuestions({ mode, themes, stocksByTheme, metricsByCode, questionCount, maxStocksPerQuestion })
    for (const item of fallback) {
      if (resolved.length >= questionCount) break
      if (resolved.some((existing) => existing.question === item.question)) continue
      resolved.push({ ...item, id: `daily_q_${resolved.length + 1}` })
    }
  }

  return resolved.slice(0, questionCount).map((item, index) => ({ ...item, id: `daily_q_${index + 1}` }))
}

export async function planDailyLoopQuestions({ mode, themes, stocksByTheme, metricsByCode, questionCount, maxStocksPerQuestion, recentCorpus, projectPath, options }) {
  const recentQuestions = await loadRecentDailyLoopQuestionHistory(projectPath, { mode })
  let duplicateFilteredCount = 0
  const fallbackQuestions = (existingQuestions = []) => {
    const rawFallback = pickDailyLoopQuestions({ mode, themes, stocksByTheme, metricsByCode, questionCount, maxStocksPerQuestion })
    const deduped = dedupeDailyLoopQuestions([...existingQuestions, ...rawFallback], recentQuestions, questionCount)
    duplicateFilteredCount += deduped.duplicateFilteredCount
    return deduped.questions
  }
  if (options.useLlmQuestionPlanner === false) {
    return { questions: renumberDailyLoopQuestions(fallbackQuestions()), planner: { status: "fallback", mode: "rules", warning: "LLM question planner disabled", historyCount: recentQuestions.length, duplicateFilteredCount } }
  }
  try {
    const planned = await requestDailyLoopQuestionsWithLlm({ mode, questionCount, themes, stocksByTheme, metricsByCode, recentCorpus, maxStocksPerQuestion, recentQuestions, projectPath, options })
    const resolved = resolveDailyLoopPlannedQuestions({ planned, mode, themes, stocksByTheme, metricsByCode, questionCount, maxStocksPerQuestion })
    const deduped = dedupeDailyLoopQuestions(resolved, recentQuestions, questionCount)
    duplicateFilteredCount += deduped.duplicateFilteredCount
    const questions = renumberDailyLoopQuestions(deduped.questions.length < questionCount ? fallbackQuestions(deduped.questions) : deduped.questions)
    if (questions.length > 0) {
      return { questions, planner: { status: "llm", mode: options.provider ?? "codex", warning: null, plannedCount: planned.length, historyCount: recentQuestions.length, duplicateFilteredCount } }
    }
    return { questions: renumberDailyLoopQuestions(fallbackQuestions()), planner: { status: "fallback", mode: "rules", warning: "LLM planner returned no usable non-duplicate questions", historyCount: recentQuestions.length, duplicateFilteredCount } }
  } catch (err) {
    return { questions: renumberDailyLoopQuestions(fallbackQuestions()), planner: { status: "fallback", mode: "rules", warning: `LLM question planner failed: ${safeErrorMessage(err)}`, historyCount: recentQuestions.length, duplicateFilteredCount } }
  }
}

export function pickDailyLoopQuestions({ mode, themes, stocksByTheme, metricsByCode, questionCount, maxStocksPerQuestion }) {
  const activeThemes = themes.filter((theme) => (stocksByTheme.get(theme.id) ?? []).length > 0)
  const questions = []
  const templates = dailyLoopQuestionTypesForMode(mode)
  for (let i = 0; questions.length < questionCount; i++) {
    const type = templates[i % templates.length]
    const theme = activeThemes[i % Math.max(activeThemes.length, 1)]
    if (!theme) break
    const themeStocks = attachDailyLoopMetrics(stocksByTheme.get(theme.id) ?? [], metricsByCode)
    const sorted =
      type === "risk_counter"
        ? themeStocks.sort((a, b) => strongMovedScore(b) - strongMovedScore(a))
        : type === "weak_to_strong_low_buy"
          ? themeStocks.sort((a, b) => underReflectedScore(b) - underReflectedScore(a))
          : themeStocks.sort((a, b) => underReflectedScore(b) - underReflectedScore(a))
    const picked = sorted.filter((stock) => stock.code).slice(0, maxStocksPerQuestion)
    if (picked.length === 0) continue
    questions.push(buildDailyLoopQuestion({ type, mode, theme, stocks: picked, index: questions.length }))
    if (i > questionCount * 3) break
  }
  return questions
}

export function summarizeAskAnswer(answer) {
  const text = String(answer ?? "").replace(/\r/g, "").trim()
  if (!text) return "未生成回答"
  const firstMeaningful = text
    .split("\n")
    .map((line) => line.replace(/^#+\s*/, "").trim())
    .filter((line) => line && !["结论", "证据链", "引用来源"].includes(line))[0]
  return excerptForPrompt(firstMeaningful ?? text, 260)
}

export function predictionRecordFromDailyQuestion({ runId, mode, question, answer, createdAt }) {
  return {
    id: makeBrainRecordId("prediction", `${runId}:${question.id}`),
    type: "prediction",
    kind: "daily-discovery",
    runId,
    mode,
    question: question.question,
    questionType: question.type,
    answerSummary: summarizeAskAnswer(answer),
    thesis: summarizeAskAnswer(answer),
    branch: question.branch,
    stocks: question.stocks,
    expectedMove: question.expectedMove,
    validationWindows: question.validationWindows,
    status: "pending",
    evidenceRefs: question.stocks.map((stock) => stock.path).filter(Boolean),
    sqlRefs: question.stocks.flatMap((stock) => stock.metric?.refs ?? [stock.metric?.sqlRef]).filter(Boolean),
    marketRefs: question.stocks.flatMap((stock) => stock.metric?.refs ?? [stock.metric?.sqlRef, stock.metric?.externalRef]).filter(Boolean),
    createdAt,
  }
}

export async function answerDailyLoopQuestion(question, options = {}) {
  if (options.dailyLoopAnswerer) return options.dailyLoopAnswerer({ question, options })
  const result = await askWiki({
    ...options,
    query: buildDailyLoopAskQuery(question),
    projectPath: options.projectPath,
    provider: options.provider ?? "codex",
    sources: options.sources ?? "auto",
    sourceK: options.sourceK ?? 5,
    topWiki: options.topWiki ?? 10,
    topRaw: options.topRaw ?? 10,
    topBrain: options.topBrain ?? 6,
    graphNeighbors: options.graphNeighbors ?? 8,
    graphDepth: options.graphDepth,
    sqlLimit: options.sqlLimit ?? 200,
    showContext: false,
  })
  return result.answer
}

export async function writeDailyLoopJsonl(filePath, records) {
  if (!records.length) return
  for (const record of records) await appendJsonl(filePath, record)
}

export function validationRecordFromDailyMetric({ prediction, stock, metric, windowDays, priorWindowDays = [] }) {
  const direction = prediction.expectedMove === "bearish" ? "bearish" : "bullish"
  const verdict = verdictFromMarketMove({
    direction,
    periodReturnPct: metric?.pct20 ?? null,
    lastVolumeVsAvg: metric?.volumeRatio ?? null,
  })
  return {
    id: makeBrainRecordId("validation", `${prediction.id}:${stock.code}:${windowDays}`),
    type: "validation",
    kind: "market-validation",
    validationMethod: DAILY_LOOP_VALIDATION_METHOD,
    predictionId: prediction.id,
    stockCode: stock.code,
    stockName: stock.name,
    windowDays,
    predictionCreatedAt: prediction.createdAt ?? null,
    result: normalizeBrainResult(verdict.verdict),
    verdict: verdict.verdict,
    reason: verdict.reason,
    target: prediction.branch,
    targetType: "daily-discovery",
    marketValidation: {
      sourceId: "stock_daily_sql",
      status: metric?.status === "ok" ? "ready" : "insufficient",
      verdict: verdict.verdict,
      reason: verdict.reason,
      stockName: stock.name,
      stockCode: stock.code,
      lookbackDays: windowDays,
      rowCount: metric?.rows ?? 0,
      firstDate: metric?.startDate ?? null,
      lastDate: metric?.endDate ?? null,
      periodReturnPct: metric?.pct20 ?? null,
      amountRatio: metric?.amountRatio ?? null,
      volumeRatio: metric?.volumeRatio ?? null,
      avgTurnoverLast5: metric?.avgTurnoverLast5 ?? null,
      refs: metric?.refs ?? [metric?.sqlRef, metric?.externalRef].filter(Boolean),
      quoteValidation: metric?.marketValidation ?? null,
    },
    validationStartDate: metric?.startDate ?? null,
    validationEndDate: metric?.endDate ?? null,
    validationAnchor: prediction.createdAt
      ? {
          source: "prediction.createdAt",
          rule: "first_trading_day_after_prediction",
          predictionCreatedAt: prediction.createdAt,
        }
      : null,
    horizonTrackKey: `${prediction.id}:${stock.code}`,
    priorWindowDays,
    sqlRefs: metric?.refs ?? [metric?.sqlRef, metric?.externalRef].filter(Boolean),
    createdAt: nowLocalTimestamp(),
  }
}

export async function validatePendingDailyPredictions(projectPath, options = {}) {
  const records = (await readBrainRecords(projectPath)).map((item) => item.value).filter((item) => item && typeof item === "object" && !Array.isArray(item))
  const predictions = records.filter((record) => record.type === "prediction" && record.status !== "closed")
  const existingKeys = new Set(
    records
      .filter((record) => record.type === "validation")
      .filter(isCurrentDailyValidationRecord)
      .map((record) => `${record.predictionId ?? ""}:${record.stockCode ?? ""}:${record.windowDays ?? ""}`),
  )
  const maxValidations = options.validatePendingOnly && options.maxExistingValidations == null
    ? predictions.length
    : parsePositiveInteger(options.maxExistingValidations, options.mode === "postclose" ? 4 : 2)
  const maxStocksPerPrediction = parsePositiveInteger(options.maxStocksPerQuestion, 8)
  const pending = predictions.slice(-maxValidations)
  const validationTasks = []
  for (const prediction of pending) {
    const stocks = Array.isArray(prediction.stocks) ? prediction.stocks.filter((stock) => stock?.code) : []
    const windows = parseDailyLoopWindows(options.validationWindows ?? prediction.validationWindows)
    const anchor = validationAnchorFromPrediction(prediction)
    for (const windowDays of windows) {
      const candidateStocks = stocks.slice(0, maxStocksPerPrediction)
      const toValidate = []
      for (const stock of candidateStocks) {
        if (existingKeys.has(`${prediction.id}:${stock.code}:${windowDays}`)) {
          if (options.validationStats) options.validationStats.existing += 1
        } else {
          toValidate.push(stock)
        }
      }
      if (toValidate.length === 0) continue
      if (options.validationStats) options.validationStats.attempted += toValidate.length
      const priorWindowDays = windows.filter((item) => item < windowDays)
      for (const stock of toValidate) validationTasks.push({ prediction, stock, windowDays, priorWindowDays, anchor })
    }
  }

  const validations = []
  const groupedTasks = new Map()
  for (const task of validationTasks) {
    const key = `${task.anchor?.date ?? ""}:${task.anchor?.exclusive ? "1" : "0"}:${task.windowDays}`
    if (!groupedTasks.has(key)) groupedTasks.set(key, [])
    groupedTasks.get(key).push(task)
  }

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
    // Anchored validations originally used the local SQL-only path. When SQL is
    // unavailable (no PG source), that path yields no close price and every verdict
    // collapses to "SQL 日线缺少可计算的收盘价列". Since Xueqiu is now our reliable
    // external source (amount + turnover, tolerant of concurrency), fall back to it
    // for anchored validations whenever SQL is not serving data. SQL-available
    // deployments keep the original SQL-only behavior.
    const sqlUnavailable = metricResult.status !== "ok"
    const externalMarketResult = anchor && !sqlUnavailable
      ? { source: "off", status: "skipped", metrics: new Map(), okCount: 0, total: stocksForQuery.length, warning: "anchored validation uses SQL only" }
      : await fetchDailyLoopExternalMarketMetrics(stocksForQuery, { ...options, stockLookbackDays: windowDays, lookbackDays: windowDays })
    const marketMetrics = mergeDailyLoopMarketMetrics(stocksForQuery, metricResult.metrics, externalMarketResult.metrics)
    for (const task of tasks) {
      const metric = marketMetrics.get(task.stock.code) ?? metricResult.metrics.get(task.stock.code) ?? { status: metricResult.status, warning: metricResult.warning }
      if (metric.status === "not_due") {
        if (options.validationStats) options.validationStats.notDue += 1
        continue
      }
      validations.push(validationRecordFromDailyMetric({ prediction: task.prediction, stock: task.stock, metric, windowDays: task.windowDays, priorWindowDays: task.priorWindowDays }))
    }
  }
  return validations
}

export function renderMetricLine(stock) {
  const metric = stock.metric ?? {}
  if (metric.status !== "ok") return `- ${stockLabel(stock)}：日线不足或 SQL 未返回；${stock.path ?? ""}`
  const validation = metric.marketValidation
  const validationText = validation ? `行情验证 ${validation.status}（${validation.reason}）` : "行情验证 NA"
  const refs = (metric.refs ?? [metric.sqlRef, metric.externalRef]).filter(Boolean).join(", ")
  return `- ${stockLabel(stock)}：近20日 ${metric.pct20 ?? "NA"}%，成交额比 ${metric.amountRatio ?? "NA"}x，换手 ${metric.avgTurnoverLast5 ?? "NA"}，${validationText}，${refs}`
}

function oneLineDailyLoopText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim()
}

export function renderDailyLoopActivePolicyLine(policy) {
  const id = oneLineDailyLoopText(policy.policyId ?? policy.id ?? "unknown-policy")
  const scope = oneLineDailyLoopText(policy.scope)
  const rule = oneLineDailyLoopText(policy.rule ?? policy.proposedPolicy)
  const gap = oneLineDailyLoopText(policy.evidenceGap)
  const proposed = oneLineDailyLoopText(policy.proposedPolicy)
  const parts = [`policy=${id}`]
  if (scope) parts.push(`scope=${scope}`)
  if (rule) parts.push(`rule=${rule}`)
  if (gap) parts.push(`gap=${gap}`)
  if (proposed && proposed !== rule) parts.push(`policy_text=${proposed}`)
  return `- ${parts.join("；")}`
}

export function renderDailyLoopReport({ mode, runId, generatedAt, questions, answers, validations, selfTraining, activePolicies = [] }) {
  const rows = [`# Daily Research ${mode}`, "", `- run_id: ${runId}`, `- generated_at: ${generatedAt}`, `- questions: ${questions.length}`, `- validations: ${validations.length}`, ""]
  if (activePolicies.length > 0) {
    rows.push("## Active Policies", "")
    for (const policy of activePolicies.slice(0, 20)) rows.push(renderDailyLoopActivePolicyLine(policy))
    if (activePolicies.length > 20) rows.push(`- omitted=${activePolicies.length - 20}`)
    rows.push("")
  }
  rows.push("## Questions")
  for (const question of questions) {
    rows.push("", `### ${question.id} ${question.branch} / ${question.type}`, "", question.question, "", "#### Stocks")
    for (const stock of question.stocks) rows.push(renderMetricLine(stock))
    const answer = answers.get(question.id)
    if (answer) rows.push("", "#### Answer", "", String(answer).trim())
  }
  if (validations.length > 0) {
    rows.push("", "## Market Validations")
    for (const item of validations) {
      rows.push(`- ${item.stockName ?? item.stockCode} ${item.windowDays}d：${item.verdict}；${item.reason || ""}；${(item.sqlRefs ?? []).join(", ")}`)
    }
  }
  if (selfTraining) {
    rows.push("", "## Self-Training Dry Run", "", `- actions: ${selfTraining.actions.length}`)
    for (const action of selfTraining.actions.slice(0, 20)) rows.push(`- ${action.rule} ${action.target}: ${action.reason}`)
  }
  return `${rows.join("\n")}\n`
}

export function renderDailyLoopWikiFeedback({ mode, runId, questions, validations, selfTraining }) {
  const rows = [`# Wiki Feedback ${nowLocalTimestamp().slice(0, 10)}`, "", `- run_id: ${runId}`, `- mode: ${mode}`, ""]
  rows.push("## Suggested Updates")
  for (const question of questions) {
    rows.push(`- ${question.branch}: review ${question.stocks.map((stock) => stock.path).filter(Boolean).slice(0, 6).join(", ") || "related stock pages"}`)
  }
  if (validations.length > 0) {
    rows.push("", "## Validation Signals")
    for (const validation of validations.slice(0, 30)) rows.push(`- ${validation.stockName ?? validation.stockCode}: ${validation.verdict} ${validation.reason ?? ""}`)
  }
  if (selfTraining?.actions?.length) {
    rows.push("", "## Self-Training Actions To Review")
    for (const action of selfTraining.actions.slice(0, 20)) rows.push(`- ${action.rule}: ${action.target} -> ${action.action}`)
  }
  rows.push("", "## Guardrail", "- This file is a review queue only. Do not apply wiki writes without a separate ingest/apply step.")
  return `${rows.join("\n")}\n`
}

/**
 * E2 复利回灌：把每次 Daily Loop（--write）的结构化结论沉淀进中文分类 wiki，
 * 让 `wiki/问答/`、`wiki/市场环境/`、`wiki/进化/`、`wiki/策略/` 持续累积可复用内容。
 * - 问答对：每问一个 `wiki/问答/<date>-<qid>.md`（type: query），可被知识树检索复用。
 * - 市场环境：每日一张快照 `wiki/市场环境/<date>-市场快照.md`（type: market）。
 * - 认知演化：仅当自训练产出动作时 `wiki/进化/<date>-认知演化.md`（type: evolution）。
 * - 策略状态：每日一张 `wiki/策略/<date>-策略状态.md`（type: strategy）。
 * 文件名按日期命名，同日重跑覆盖（幂等）；未产生有意义内容时对应文件不生成。
 */
function compoundFrontmatterValue(v) {
  return String(v ?? "").replace(/"/g, "'").replace(/\n/g, " ").trim()
}

export async function writeDailyLoopCompoundFiles({ projectPath, generatedAt, mode, runId, questions, answers, validations, selfTraining, activePolicies = [], themes = [], externalMarketResult }) {
  const date = generatedAt.slice(0, 10)
  const wikiRoot = path.join(projectPath, "wiki")
  const written = []

  // 1. 问答对 -> wiki/问答/
  for (const question of questions ?? []) {
    const answer = answers?.get?.(question.id)
    if (!answer) continue
    const stockNames = (question.stocks ?? []).map((s) => stockLabel(s)).filter(Boolean)
    const rows = [
      "---",
      `type: query`,
      `title: "${compoundFrontmatterValue((question.question ?? "").slice(0, 60))}"`,
      `date: ${date}`,
      `branch: ${compoundFrontmatterValue(question.branch)}`,
      `question_type: ${compoundFrontmatterValue(question.type)}`,
      `stocks: [${stockNames.map((n) => `"${compoundFrontmatterValue(n)}"`).join(", ")}]`,
      `run_id: ${runId}`,
      "---",
      "",
      `# Q: ${question.question ?? ""}`,
      "",
      `**分支**: ${question.branch} / ${question.type}`,
      stockNames.length ? `**关联标的**: ${stockNames.join("、")}` : "**关联标的**: 无",
      "",
      "## 答",
      "",
      String(answer).trim(),
      "",
    ]
    const fpath = path.join(wikiRoot, "问答", `${date}-${question.id}.md`)
    await ensureDirectory(path.dirname(fpath))
    await fs.writeFile(fpath, `${rows.join("\n")}\n`, "utf8")
    written.push(projectRelative(projectPath, fpath))
  }

  // 2. 市场环境快照 -> wiki/市场环境/
  {
    const themeLines = (themes ?? []).slice(0, 12).map((t) => `- ${compoundFrontmatterValue(t.branch)}（score ${t.score ?? "NA"}）`).join("\n") || "- 无主题"
    const ext = externalMarketResult ?? {}
    const rows = [
      "---",
      `type: market`,
      `title: "${date} 市场环境快照"`,
      `date: ${date}`,
      `mode: ${mode}`,
      `run_id: ${runId}`,
      "---",
      "",
      `# ${date} 市场环境快照`,
      "",
      `- 模式: ${mode}`,
      `- 主题线:`,
      themeLines,
      `- 候选主题数: ${(themes ?? []).length}`,
      `- 外部行情验证: ${ext.status ?? "n/a"}（${ext.okCount ?? 0}/${ext.total ?? 0} 成功）`,
      validations?.length ? `- 市场验证信号: ${validations.length} 条` : "- 市场验证信号: 无（盘前模式）",
      "",
    ]
    const fpath = path.join(wikiRoot, "市场环境", `${date}-市场快照.md`)
    await ensureDirectory(path.dirname(fpath))
    await fs.writeFile(fpath, `${rows.join("\n")}\n`, "utf8")
    written.push(projectRelative(projectPath, fpath))
  }

  // 3. 认知演化 -> wiki/进化/（仅当自训练产出动作）
  if (selfTraining?.actions?.length) {
    const rows = [
      "---",
      `type: evolution`,
      `title: "${date} 认知演化"`,
      `date: ${date}`,
      `mode: ${mode}`,
      `run_id: ${runId}`,
      "---",
      "",
      `# ${date} 认知演化记录`,
      "",
      `自训练在本次日循环中提议 ${selfTraining.actions.length} 条规则调整：`,
      "",
      ...selfTraining.actions.slice(0, 30).map((a) => `- ${compoundFrontmatterValue(a.rule)} ${compoundFrontmatterValue(a.target)}：${compoundFrontmatterValue(a.reason)}`),
      "",
    ]
    const fpath = path.join(wikiRoot, "进化", `${date}-认知演化.md`)
    await ensureDirectory(path.dirname(fpath))
    await fs.writeFile(fpath, `${rows.join("\n")}\n`, "utf8")
    written.push(projectRelative(projectPath, fpath))
  }

  // 4. 策略状态 -> wiki/策略/
  {
    const policyLines = (activePolicies ?? []).slice(0, 20).map((p) => renderDailyLoopActivePolicyLine(p)).join("\n") || "- 无激活策略"
    const rows = [
      "---",
      `type: strategy`,
      `title: "${date} 策略状态"`,
      `date: ${date}`,
      `mode: ${mode}`,
      `run_id: ${runId}`,
      "---",
      "",
      `# ${date} 策略状态`,
      "",
      "## 激活策略",
      policyLines,
      "",
      selfTraining?.actions?.length
        ? `## 待落地自训练动作\n${selfTraining.actions.slice(0, 20).map((a) => `- ${compoundFrontmatterValue(a.rule)} ${compoundFrontmatterValue(a.target)}: ${compoundFrontmatterValue(a.action ?? a.reason)}`).join("\n")}`
        : "## 待落地自训练动作\n- 无",
      "",
    ]
    const fpath = path.join(wikiRoot, "策略", `${date}-策略状态.md`)
    await ensureDirectory(path.dirname(fpath))
    await fs.writeFile(fpath, `${rows.join("\n")}\n`, "utf8")
    written.push(projectRelative(projectPath, fpath))
  }

  return written
}

export async function runDailyLoop(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const mode = parseDailyLoopMode(options.mode)
  const lookbackDays = parsePositiveInteger(options.lookbackDays, 30)
  const maxStocksPerQuestion = parsePositiveInteger(options.maxStocksPerQuestion, 8)
  const questionCount = parsePositiveInteger(options.questionCount, DAILY_LOOP_MODE_DEFAULT_COUNTS.get(mode) ?? 14)
  const validationWindows = parseDailyLoopWindows(options.validationWindows)
  const generatedAt = nowLocalTimestamp()
  const runId = `daily_loop_${generatedAt.slice(0, 10)}_${mode}_${shortHash(`${generatedAt}:${mode}`)}`

  if (options.validatePendingOnly) {
    const validationStats = { existing: 0, notDue: 0, attempted: 0 }
    const validations = mode === "postclose" || mode === "full" ? await validatePendingDailyPredictions(projectPath, { ...options, mode, validationWindows, maxStocksPerQuestion, validationStats }) : []
    const dryRun = !options.write
    let selfTraining = null
    let feedbackPath = null
    if (!dryRun) {
      await writeDailyLoopJsonl(path.join(brainDir(projectPath), brainFileForType("validation")), validations)
      selfTraining = mode === "postclose" || mode === "full" ? await runSelfTraining({ projectPath, write: false }) : null
      if (mode === "postclose" || mode === "full") {
        feedbackPath = path.join(projectPath, ".llm-wiki", "wiki-feedback", `${generatedAt.slice(0, 10)}.md`)
        await ensureDirectory(path.dirname(feedbackPath))
        await fs.writeFile(feedbackPath, renderDailyLoopWikiFeedback({ mode, runId, questions: [], validations, selfTraining }), "utf8")
      }
    } else {
      selfTraining = mode === "postclose" || mode === "full" ? await runSelfTraining({ projectPath, write: false }) : null
    }
    return {
      projectPath,
      mode,
      runId,
      generatedAt,
      dryRun,
      counts: {
        stockUniverse: 0,
        recentCorpus: 0,
        themes: 0,
        candidateStocks: 0,
        questions: 0,
        predictions: 0,
        validations: validations.length,
        validationsExisting: validationStats.existing,
        validationsNotDue: validationStats.notDue,
        validationsAttempted: validationStats.attempted,
      },
      themes: [],
      sql: {
        status: validations.length > 0 ? "ok" : "no_due_or_existing",
        warning: validations.length > 0 ? null : `没有写入新的 pending prediction 验证；已存在 ${validationStats.existing}，未到期 ${validationStats.notDue}`,
        nativeQuery: null,
      },
      marketValidation: {
        mode: "off",
        externalSource: "off",
        externalStatus: "skipped",
        externalOkCount: 0,
        externalTotal: 0,
        warning: "anchored pending validation uses stock SQL only",
      },
      questionPlanner: { status: "skipped", mode: "validate-pending-only", warning: null, plannedCount: 0 },
      questions: [],
      answers: {},
      predictions: [],
      validations,
      selfTraining,
      reportPath: null,
      reportRelativePath: null,
      feedbackPath,
      feedbackRelativePath: feedbackPath ? projectRelative(projectPath, feedbackPath) : null,
    }
  }

  const [stockUniverse, recentCorpus, policyRegistry] = await Promise.all([
    loadDailyLoopStockUniverse(projectPath),
    loadDailyLoopRecentCorpus(projectPath, lookbackDays),
    Array.isArray(options.activePolicies) ? Promise.resolve({ policies: options.activePolicies }) : listActiveSelfQuestionPolicies({ projectPath }),
  ])
  const activePolicies = (policyRegistry.policies ?? []).map(compactDailyLoopActivePolicy)
  const themes = scoreDailyLoopThemes(recentCorpus)
  const stocksByTheme = selectDailyLoopThemeStocks(stockUniverse, themes, maxStocksPerQuestion)
  const allCandidateStocks = [...new Map([...stocksByTheme.values()].flat().map((stock) => [stock.code, stock])).values()]
  const metricResult = await fetchDailyLoopStockMetrics(allCandidateStocks, { ...options, lookbackDays: 20, stockLookbackDays: 20 })
  const externalMarketResult = await fetchDailyLoopExternalMarketMetrics(allCandidateStocks, { ...options, lookbackDays: 20, stockLookbackDays: 20 })
  const marketMetrics = mergeDailyLoopMarketMetrics(allCandidateStocks, metricResult.metrics, externalMarketResult.metrics)
  const planned = await planDailyLoopQuestions({
    mode,
    themes,
    stocksByTheme,
    metricsByCode: marketMetrics,
    questionCount,
    maxStocksPerQuestion,
    recentCorpus,
    projectPath,
    options: { ...options, activePolicies },
  })
  const questions = planned.questions.map((question) => ({ ...question, validationWindows }))

  const answers = new Map()
  const shouldAnswer = options.answer !== false && !options.showContext
  if (shouldAnswer) {
    for (const question of questions) {
      const answer = await answerDailyLoopQuestion(question, { ...options, projectPath, activePolicies })
      answers.set(question.id, answer)
    }
  }

  const validations = mode === "postclose" || mode === "full" ? await validatePendingDailyPredictions(projectPath, { ...options, mode, validationWindows }) : []
  const selfTraining = mode === "postclose" || mode === "full" ? await runSelfTraining({ projectPath, write: false }) : null
  const predictions = questions.map((question) =>
    predictionRecordFromDailyQuestion({
      runId,
      mode,
      question,
      answer: answers.get(question.id),
      createdAt: generatedAt,
    }),
  )

  const dryRun = !options.write
  let reportPath = null
  let feedbackPath = null
  let compoundPaths = []
  if (!dryRun) {
    await writeDailyLoopJsonl(path.join(brainDir(projectPath), brainFileForType("prediction")), predictions)
    await writeDailyLoopJsonl(path.join(brainDir(projectPath), brainFileForType("validation")), validations)
    reportPath = path.join(projectPath, ".llm-wiki", "daily-research", `${generatedAt.slice(0, 10)}-${mode}.md`)
    await ensureDirectory(path.dirname(reportPath))
    await fs.writeFile(reportPath, renderDailyLoopReport({ mode, runId, generatedAt, questions, answers, validations, selfTraining, activePolicies }), "utf8")
    if (mode === "postclose" || mode === "full") {
      feedbackPath = path.join(projectPath, ".llm-wiki", "wiki-feedback", `${generatedAt.slice(0, 10)}.md`)
      await ensureDirectory(path.dirname(feedbackPath))
      await fs.writeFile(feedbackPath, renderDailyLoopWikiFeedback({ mode, runId, questions, validations, selfTraining }), "utf8")
    }
    // E2 复利回灌：把结构化结论沉淀进中文分类 wiki（问答/市场环境/进化/策略）
    compoundPaths = await writeDailyLoopCompoundFiles({ projectPath, generatedAt, mode, runId, questions, answers, validations, selfTraining, activePolicies, themes, externalMarketResult })
  }

  return {
    projectPath,
    mode,
    runId,
    generatedAt,
    dryRun,
    counts: {
      stockUniverse: stockUniverse.length,
      recentCorpus: recentCorpus.length,
      themes: themes.length,
      candidateStocks: allCandidateStocks.length,
      questions: questions.length,
      predictions: predictions.length,
      validations: validations.length,
      activePolicies: activePolicies.length,
    },
    themes: themes.map(({ id, branch, score, matchedKeywords }) => ({ id, branch, score, matchedKeywords })),
    sql: {
      status: metricResult.status,
      warning: metricResult.warning,
      nativeQuery: metricResult.nativeQuery
        ? {
            language: metricResult.nativeQuery.language,
            summary: metricResult.nativeQuery.summary,
            table: metricResult.nativeQuery.table,
            limit: metricResult.nativeQuery.limit,
            tickerCount: metricResult.nativeQuery.normalizedCodes?.length ?? 0,
          }
        : null,
    },
    marketValidation: {
      mode: parseDailyLoopMarketValidateMode(options.marketValidate ?? options.marketValidation ?? options.externalMarket),
      externalSource: externalMarketResult.source,
      externalStatus: externalMarketResult.status,
      externalOkCount: externalMarketResult.okCount ?? 0,
      externalTotal: externalMarketResult.total ?? allCandidateStocks.length,
      warning: externalMarketResult.warning,
    },
    questionPlanner: {
      ...planned.planner,
      activePolicyCount: activePolicies.length,
      activePolicies,
    },
    questions,
    answers: Object.fromEntries([...answers.entries()].map(([id, answer]) => [id, summarizeAskAnswer(answer)])),
    predictions,
    validations,
    selfTraining,
    reportPath,
    reportRelativePath: reportPath ? projectRelative(projectPath, reportPath) : null,
    feedbackPath,
    feedbackRelativePath: feedbackPath ? projectRelative(projectPath, feedbackPath) : null,
    compoundPaths,
  }
}

export function isSelfQuestionEvidenceResultRecord(record) {
  return (
    record?.schema === "self-question-evidence-result-v1" ||
    record?.kind === "self-question-evidence-result" ||
    record?.type === "evidence_result"
  )
}

export function evidenceResultMatchesAttribution(evidenceResult, attribution) {
  if (!evidenceResult || !attribution) return false
  const pairs = [
    [evidenceResult.attributionId, attribution.id],
    [evidenceResult.validationId, attribution.validationId],
    [evidenceResult.questionRecordId, attribution.questionRecordId],
    [evidenceResult.questionId, attribution.questionId],
  ]
  return pairs.some(([left, right]) => left && right && String(left) === String(right))
}

export function confirmedEvidenceResultsForAttribution(attribution, evidenceGaps = [], evidenceResults = []) {
  const gapSet = new Set(evidenceGaps.filter(Boolean))
  return evidenceResults
    .filter(isSelfQuestionEvidenceResultRecord)
    .filter((item) => item.result === "confirmed")
    .filter((item) => evidenceResultMatchesAttribution(item, attribution))
    .filter((item) => !gapSet.size || gapSet.has(item.evidenceGap))
}

function sanitizeTrainingSampleText(value, fallback = null) {
  if (value == null) return fallback
  return safeErrorMessage(value)
}

function sanitizeTrainingSampleValue(value) {
  if (value == null) return null
  if (typeof value === "number" || typeof value === "boolean") return value
  if (Array.isArray(value)) return value.map(sanitizeTrainingSampleValue).filter((item) => item != null && item !== "")
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .map(([key, item]) => [key, sanitizeTrainingSampleValue(item)])
      .filter(([, item]) => item != null && item !== ""))
  }
  return sanitizeTrainingSampleText(value, "")
}

function compactTrainingSampleText(value, maxChars = 4000) {
  const text = sanitizeTrainingSampleText(value, "")
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars)}\n[truncated]`
}

export async function readAgentRunRecords(projectPath) {
  const root = path.join(projectPath, AGENT_RUNS_ROOT)
  let entries = []
  try {
    entries = await fs.readdir(root, { withFileTypes: true })
  } catch (err) {
    if (err?.code === "ENOENT") return []
    throw err
  }
  const projectRoot = path.resolve(projectPath)
  const records = []
  for (const entry of entries.filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const manifestPath = path.join(root, entry.name, "manifest.json")
    const rawManifest = await readIfExists(manifestPath)
    if (!rawManifest) continue
    let manifest = null
    try {
      manifest = JSON.parse(rawManifest)
    } catch {
      continue
    }
    if (manifest?.schema !== "agent-run-manifest-v1" || manifest?.mode !== "ask") continue
    const finalRelativePath = typeof manifest.finalPath === "string" ? manifest.finalPath : null
    let finalText = null
    if (finalRelativePath && !path.isAbsolute(finalRelativePath)) {
      const finalPath = path.resolve(projectPath, finalRelativePath)
      if (finalPath.startsWith(`${projectRoot}${path.sep}`)) {
        finalText = await readIfExists(finalPath)
      }
    }
    records.push({
      manifest,
      finalText,
      manifestRelativePath: projectRelative(projectPath, manifestPath),
    })
  }
  return records
}

export function sampleFromAgentRunRecord(record, kind) {
  if (kind !== "eval") return null
  const manifest = record?.manifest
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return null
  if (manifest.schema !== "agent-run-manifest-v1" || manifest.mode !== "ask") return null
  const runId = sanitizeTrainingSampleText(manifest.runId, shortHash(JSON.stringify(manifest)))
  const roles = Array.isArray(manifest.roles) ? manifest.roles : []
  const roleSummaries = roles.map((role) => ({
    role: sanitizeTrainingSampleText(role.role),
    label: sanitizeTrainingSampleText(role.label),
    status: sanitizeTrainingSampleText(role.status),
    summary: sanitizeTrainingSampleText(role.summary),
    error: sanitizeTrainingSampleText(role.error),
    outputPath: sanitizeTrainingSampleText(role.outputPath),
  }))
  const failedRoles = roleSummaries
    .filter((role) => role.status && role.status !== "ok")
    .map((role) => role.role)
    .filter(Boolean)
  return {
    kind,
    id: `eval_agent_run_${runId}`,
    source: "agent-run",
    question: `这次 agentic ask 是否形成了可训练的证据化回答：${sanitizeTrainingSampleText(manifest.query, "")}`,
    expected: [
      "必须复核最终答案是否保留六章节结构、证据引用、反证、证据缺口、置信度影响和交易含义。",
      failedRoles.length ? `失败角色：${failedRoles.join(", ")}` : "失败角色：无",
      "不能把 agentic ask 原始答案直接当作高置信正样本；需先人工或规则复核。",
    ].join("\n"),
    evidence: {
      runId,
      status: sanitizeTrainingSampleText(manifest.status),
      query: sanitizeTrainingSampleText(manifest.query),
      provider: sanitizeTrainingSampleText(manifest.provider),
      model: sanitizeTrainingSampleText(manifest.model),
      concurrency: manifest.concurrency ?? null,
      failedRoles,
      roles: roleSummaries,
      sourceRefs: sanitizeTrainingSampleValue(manifest.sourceRefs ?? {}),
      manifestPath: sanitizeTrainingSampleText(record.manifestRelativePath),
      finalPath: sanitizeTrainingSampleText(manifest.finalPath),
      finalExcerpt: compactTrainingSampleText(record.finalText, 4000),
    },
    qualityGate: {
      status: "review_required",
      highConfidenceEligible: false,
      requiredAction: "review_agentic_answer",
      reasons: ["agentic_ask_requires_review"],
    },
    sourceRecordId: runId,
  }
}

export async function readSelfTrainingPlanRecords(projectPath) {
  const root = path.join(projectPath, ".llm-wiki", "self-training-plans")
  const files = await listFilesRecursive(root, {
    extensions: new Set([".json"]),
    excludeDirNames: new Set([".git", "node_modules"]),
    maxBytes: 1024 * 1024 * 5,
  }).catch(() => [])
  const records = []
  for (const filePath of files.sort((a, b) => a.localeCompare(b))) {
    const raw = await readIfExists(filePath)
    if (!raw) continue
    try {
      const plan = JSON.parse(raw)
      if (plan?.schema !== "self-training-action-plan-run-v1" || plan?.mode !== "self-train-plan") continue
      records.push({
        plan,
        relativePath: projectRelative(projectPath, filePath),
      })
    } catch {
      // Ignore malformed plan artifacts here; self-train plan verify is the integrity gate.
    }
  }
  return records
}

export function sampleFromSelfTrainingPlanRecord(record, kind) {
  if (kind !== "eval") return null
  const plan = record?.plan
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) return null
  const runId = sanitizeTrainingSampleText(plan.runId, shortHash(JSON.stringify(plan)))
  const actions = Array.isArray(plan.actions) ? plan.actions.slice(0, 20).map((action) => sanitizeTrainingSampleValue({
    id: action.id,
    status: action.status,
    sourceActionId: action.sourceActionId,
    sourceActionFingerprint: action.sourceActionFingerprint,
    sourceRule: action.sourceRule,
    sourceTarget: action.sourceTarget,
    sourceAction: action.sourceAction,
    reviewStatus: action.reviewStatus,
    priority: action.priority,
    evidenceGaps: action.evidenceGaps,
    affectedIds: action.affectedIds,
    gateStatus: action.gateStatus,
    nextStages: action.nextStages,
    steps: Array.isArray(action.steps) ? action.steps.slice(0, 20).map((step) => ({
      id: step.id,
      type: step.type,
      status: step.status,
      autoExecute: step.autoExecute,
      provider: step.provider,
      signal: step.signal,
      evidenceType: step.evidenceType,
      command: step.command,
    })) : [],
  })) : []
  return {
    kind,
    id: `eval_self_training_plan_${runId}`,
    source: "self-training-plan",
    question: `这份递归自训练计划是否安全、可审计并只能作为人工交接：${runId}`,
    expected: [
      "计划步骤必须保持 status=planned 且 autoExecute=false。",
      "writePolicy 必须保持不写 wiki/raw/brain 且不自动执行。",
      "counts.actions 和 counts.steps 必须与 actions/steps 实际数量一致。",
      "执行前必须通过 self-train plan verify，并由人工决定 review/resolve。",
    ].join("\n"),
    evidence: {
      runId,
      generatedAt: sanitizeTrainingSampleText(plan.generatedAt),
      dryRun: Boolean(plan.dryRun),
      planPath: sanitizeTrainingSampleText(record.relativePath),
      sourceLedger: sanitizeTrainingSampleValue(plan.sourceLedger ?? null),
      counts: sanitizeTrainingSampleValue(plan.counts ?? {}),
      writePolicy: sanitizeTrainingSampleValue(plan.writePolicy ?? {}),
      actions,
    },
    qualityGate: {
      status: "review_required",
      highConfidenceEligible: false,
      requiredAction: "verify_and_review_self_training_plan",
      reasons: ["self_training_plan_requires_review"],
    },
    sourceRecordId: runId,
  }
}

export async function readSelfQuestionLoopRecords(projectPath) {
  const root = path.join(projectPath, ".llm-wiki", "self-question-runs")
  const files = await listFilesRecursive(root, {
    extensions: new Set([".json"]),
    excludeDirNames: new Set([".git", "node_modules"]),
    maxBytes: 1024 * 1024 * 5,
  }).catch(() => [])
  const records = []
  for (const filePath of files.filter((item) => path.basename(item) === "manifest.json").sort((a, b) => a.localeCompare(b))) {
    const raw = await readIfExists(filePath)
    if (!raw) continue
    try {
      const manifest = JSON.parse(raw)
      if (manifest?.schema !== "self-question-loop-run-v1") continue
      records.push({
        manifest,
        relativePath: projectRelative(projectPath, filePath),
      })
    } catch {
      // Ignore malformed loop manifests here; loop failure manifests stay inspectable on disk.
    }
  }
  return records
}

function recursiveAiPhaseRunPathSequence(relativePath) {
  const match = String(relativePath ?? "").match(/\/\d{14}(?:-(\d+))?-phase-run\/manifest\.json$/)
  if (!match) return 0
  return Number(match[1] ?? 1)
}

export async function readRecursiveAiPhaseRunRecords(projectPath) {
  const root = path.join(projectPath, ".llm-wiki", "self-question-runs")
  const files = await listFilesRecursive(root, {
    extensions: new Set([".json"]),
    excludeDirNames: new Set([".git", "node_modules"]),
    maxBytes: 1024 * 1024 * 5,
  }).catch(() => [])
  const records = []
  for (const filePath of files.filter((item) => path.basename(item) === "manifest.json").sort((a, b) => a.localeCompare(b))) {
    const raw = await readIfExists(filePath)
    if (!raw) continue
    try {
      const manifest = JSON.parse(raw)
      if (manifest?.schema !== "recursive-ai-phase-run-v1") continue
      const stat = await fs.stat(filePath).catch(() => null)
      records.push({
        manifest,
        relativePath: projectRelative(projectPath, filePath),
        mtimeMs: stat?.mtimeMs ?? 0,
      })
    } catch {
      // Ignore malformed phase-run manifests here; the raw file remains inspectable on disk.
    }
  }
  return records.sort((a, b) => String(a.manifest?.generatedAt ?? "").localeCompare(String(b.manifest?.generatedAt ?? ""))
    || recursiveAiPhaseRunPathSequence(a.relativePath) - recursiveAiPhaseRunPathSequence(b.relativePath)
    || Number(a.mtimeMs ?? 0) - Number(b.mtimeMs ?? 0)
    || String(a.relativePath ?? "").localeCompare(String(b.relativePath ?? "")))
}

export function sampleFromSelfQuestionLoopRecord(record, kind) {
  if (kind !== "eval") return null
  const manifest = record?.manifest
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return null
  const verification = manifest.outputs?.selfTrainingPlanVerification
  const hasVerificationStage = Array.isArray(manifest.stages) && manifest.stages.some((stage) => stage?.stage === "self-train-plan-verify")
  if (!verification && !hasVerificationStage) return null
  const runId = sanitizeTrainingSampleText(manifest.runId, shortHash(JSON.stringify(manifest)))
  const verificationStatus = sanitizeTrainingSampleText(verification?.status ?? manifest.gateSummary?.status ?? manifest.status ?? "unknown")
  const checked = Number(verification?.checked ?? manifest.counts?.selfTrainingPlanVerificationChecked ?? 0)
  const failed = Number(verification?.failed ?? manifest.counts?.selfTrainingPlanVerificationFailures ?? 0)
  const issueCount = Number(verification?.issueCount ?? manifest.counts?.selfTrainingPlanVerificationIssues ?? 0)
  const needsRepair = failed > 0 || issueCount > 0 || verificationStatus === "failed" || verificationStatus === "needs_remediation"
  return {
    kind,
    id: `eval_self_training_plan_verification_${runId}`,
    source: "self-training-plan-verification",
    question: `这次 self-question loop 的自训练计划验证是否允许进入后续执行/样本闭环：${runId}`,
    expected: [
      `验证状态：${verificationStatus}`,
      `checked=${Number.isFinite(checked) ? checked : 0}; failed=${Number.isFinite(failed) ? failed : 0}; issueCount=${Number.isFinite(issueCount) ? issueCount : 0}`,
      needsRepair ? "必须先修复计划安全或一致性问题，再进入执行/训练。" : "仍需人工复核后才能把计划执行结果作为高置信训练材料。",
      manifest.gateSummary?.recommendedNextStages?.length ? `推荐下一阶段：${manifest.gateSummary.recommendedNextStages.join(", ")}` : "",
    ].filter(Boolean).join("\n"),
    evidence: {
      runId,
      manifestPath: sanitizeTrainingSampleText(record.relativePath),
      loopStatus: sanitizeTrainingSampleText(manifest.status),
      status: verificationStatus,
      checked: Number.isFinite(checked) ? checked : 0,
      failed: Number.isFinite(failed) ? failed : 0,
      issueCount: Number.isFinite(issueCount) ? issueCount : 0,
      selfTrainingPlan: sanitizeTrainingSampleText(manifest.outputs?.selfTrainingPlan),
      plans: sanitizeTrainingSampleValue(verification?.plans ?? []),
      gateSummary: sanitizeTrainingSampleValue(manifest.gateSummary ?? null),
    },
    qualityGate: {
      status: "review_required",
      highConfidenceEligible: false,
      requiredAction: needsRepair ? "repair_self_training_plan" : "review_verified_self_training_plan",
      reasons: ["self_training_plan_verification_requires_review"],
    },
    sourceRecordId: runId,
  }
}

function countBrainRecordValues(values, predicate) {
  return values.reduce((count, value) => count + (predicate(value) ? 1 : 0), 0)
}

function recursiveAiPhase({ phase, label, status, evidence = {}, nextGate = null }) {
  return { phase, label, status, evidence, nextGate }
}

function recursiveAiCommandProjectArg(projectPath) {
  return ` --project ${shellArg(projectPath)}`
}

function isSelfQuestionMarketValidationRecord(record) {
  return (
    record?.kind === "self-question-market-validation" ||
    record?.validationMethod === "self_question_market_feedback_v1" ||
    (record?.type === "validation" && record?.targetType === "self-question")
  )
}

function isActionableSelfQuestionMarketValidationRecord(record) {
  if (!isSelfQuestionMarketValidationRecord(record)) return false
  const marketStatus = String(record?.marketValidation?.status ?? record?.status ?? "").trim().toLowerCase()
  const rawResult = String(record?.result ?? record?.validationResult ?? record?.verdict ?? record?.marketValidation?.verdict ?? "").trim().toLowerCase()
  const nonActionable = new Set(["insufficient", "not_due", "no_rows", "missing", "unavailable", "skipped", "error"])
  if (nonActionable.has(marketStatus) || nonActionable.has(rawResult) || /证据不足/.test(rawResult)) return false
  if (["validated", "ready", "ok", "confirmed"].includes(marketStatus)) return true
  return ["success", "failure", "uncertain"].includes(normalizeBrainResult(rawResult))
}

function isSelfQuestionAttributionRecord(record) {
  return (
    record?.schema === "self-question-attribution-v1" ||
    record?.kind === "self-question-attribution" ||
    record?.attributionMethod === "self_question_attribution_v1"
  )
}

function isActionableSelfQuestionAttributionRecord(record) {
  if (!isSelfQuestionAttributionRecord(record)) return false
  const label = String(record?.attributionLabel ?? record?.label ?? "").trim().toLowerCase()
  if (["confirmed", "price_only", "divergent", "disconfirmed"].includes(label)) return true
  if (label === "insufficient") return false
  const nextAction = String(record?.nextAction ?? "").trim().toLowerCase()
  return Boolean(nextAction && nextAction !== "wait_for_evidence" && nextAction !== "none")
}

function buildRecursiveAiNextActions(projectPath, counts = {}) {
  const projectArg = recursiveAiCommandProjectArg(projectPath)
  const actions = []
  const hasSelfQuestions = (counts.selfQuestions ?? 0) > 0
  const hasActionableMarketFeedback = (counts.actionableMarketValidations ?? 0) > 0
  const hasActionableAttribution = (counts.actionableAttributions ?? 0) > 0
  const hasSelfTrainingActions = (counts.selfTrainingActions ?? 0) > 0
  const hasSelfTrainingPlans = (counts.selfTrainingPlans ?? 0) > 0
  const push = (gate, reason, command) => {
    actions.push({
      priority: actions.length + 1,
      gate,
      reason,
      command,
      writePolicy: "requires explicit --write or remains read-only/dry-run",
    })
  }
  if (!hasSelfQuestions) {
    push(
      "generate_self_questions",
      "live 项目还没有 self-question 记录，先让系统提出可验证问题。",
      `npm run codex:ingest -- self-question loop --stages generate --question-count 3 --write${projectArg}`,
    )
  }
  if (hasSelfQuestions && !hasActionableMarketFeedback) {
    push(
      "validate_market_feedback",
      (counts.marketValidations ?? 0) > 0
        ? "已有 self-question market-feedback validation，但还没有可行动市场信号；可等 SQL 更新后重验，或显式允许外部K线兜底。"
        : "还没有 self-question market-feedback validation，下一步需要把问题接到市场反馈。",
      (counts.marketValidations ?? 0) > 0
        ? `npm run codex:ingest -- self-question loop --stages validate --max-questions 1 --validation-windows 1 --allow-anchored-external-market --market-validate auto --external-market-timeout-ms 3000 --external-market-concurrency 6 --write${projectArg}`
        : `npm run codex:ingest -- self-question loop --stages validate --write${projectArg}`,
    )
  }
  if (hasActionableMarketFeedback && !hasActionableAttribution) {
    push(
      "attribute_market_feedback",
      (counts.attributions ?? 0) > 0
        ? "已有 attribution，但还没有 confirmed/price_only/divergent/disconfirmed 等可行动归因。"
        : "还没有把市场反馈归因为 confirmed/price_only/divergent/disconfirmed/insufficient。",
      `npm run codex:ingest -- self-question loop --stages attribute --write${projectArg}`,
    )
  }
  if (hasActionableAttribution && !hasSelfTrainingActions) {
    push(
      "create_self_training_actions",
      "还没有持久化 self-training action，无法形成后续人工审核和样本标签。",
      `npm run codex:ingest -- self-question loop --stages self-train --self-train-write --write${projectArg}`,
    )
  }
  if (hasSelfTrainingActions && !hasSelfTrainingPlans) {
    push(
      "plan_self_training_handoffs",
      "还没有 self-training plan artifact，行动仍未转成可审计交接包。",
      `npm run codex:ingest -- self-train plan --limit 5 --write${projectArg}`,
    )
  }
  if (hasSelfTrainingPlans && (counts.selfTrainingPlanIssues ?? 0) > 0) {
    push(
      "verify_self_training_plans",
      "self-training plan verifier 发现安全或一致性问题，需要先查看验证结果再继续。",
      `npm run codex:ingest -- self-train plan verify --limit 20${projectArg}`,
    )
  }
  if (hasSelfTrainingPlans && (counts.trainingExportEntries ?? 0) === 0) {
    push(
      "export_review_required_eval_samples",
      "还没有训练样本导出批次，先导出 review_required eval 作为人工复核池。",
      `npm run codex:ingest -- export-samples --kind eval --quality-gate review_required${projectArg}`,
    )
  } else if ((counts.trainingExportEntries ?? 0) > 0 && (counts.highConfidenceSamples ?? 0) > 0) {
    push(
      "verify_training_exports",
      "已有训练样本导出批次，训练前应验证 ledger/jsonl/manifest 一致。",
      `npm run codex:ingest -- export-samples verify --kind eval --limit 20${projectArg}`,
    )
  }
  if (hasSelfTrainingActions && (counts.highConfidenceSamples ?? 0) === 0) {
    push(
      "review_actions_for_high_confidence_labels",
      "还没有 high-confidence 样本，需要人工 review/resolve 动作后再进入高置信训练池。",
      `npm run codex:ingest -- self-train actions --status open --limit 20${projectArg}`,
    )
  }
  return actions
}

function recursiveAiReadinessGate({ gate, label, passed, reason, evidence = {}, command = null }) {
  return {
    gate,
    label,
    status: passed ? "passed" : "blocked",
    passed: Boolean(passed),
    reason,
    evidence,
    command,
  }
}

function buildRecursiveAiPhase5Readiness(projectPath, counts = {}) {
  const projectArg = recursiveAiCommandProjectArg(projectPath)
  const failedPhaseRuns = Number(counts.recursiveAiPhaseRunsByStatus?.failed ?? 0)
  const latestPhaseRunStatus = String(counts.latestRecursiveAiPhaseRun?.status ?? "")
  const latestPhaseRunBlocked = ["failed", "repeated_gate"].includes(latestPhaseRunStatus)
  const gates = [
    recursiveAiReadinessGate({
      gate: "agentic_eval_artifacts",
      label: "agentic ask 审计样本",
      passed: (counts.agentRuns ?? 0) > 0,
      reason: "Phase 5 需要至少有 agentic ask 运行记录作为后续 eval/复核样本来源。",
      evidence: { agentRuns: counts.agentRuns ?? 0, byStatus: counts.agentRunsByStatus ?? {} },
      command: `npm run codex:ingest -- ask --agentic --query <question>${projectArg}`,
    }),
    recursiveAiReadinessGate({
      gate: "self_question_feedback",
      label: "自提问市场反馈闭环",
      passed: (counts.selfQuestions ?? 0) > 0 && (counts.actionableMarketValidations ?? 0) > 0 && (counts.actionableAttributions ?? 0) > 0,
      reason: "系统必须先形成 question -> actionable market validation -> actionable attribution 的闭环，再考虑无人值守递归。",
      evidence: {
        selfQuestions: counts.selfQuestions ?? 0,
        marketValidations: counts.marketValidations ?? 0,
        actionableMarketValidations: counts.actionableMarketValidations ?? 0,
        attributions: counts.attributions ?? 0,
        actionableAttributions: counts.actionableAttributions ?? 0,
      },
      command: `npm run codex:ingest -- self-question phase-run --max-gates 3 --execute --write${projectArg}`,
    }),
    recursiveAiReadinessGate({
      gate: "reviewed_self_training_actions",
      label: "已复核自训练动作",
      passed: (counts.selfTrainingReviewedActions ?? 0) > 0,
      reason: "高置信训练材料必须来自人工复核过的 self-training action。",
      evidence: {
        reviewedActions: counts.selfTrainingReviewedActions ?? 0,
        openActions: counts.selfTrainingOpenActions ?? 0,
      },
      command: `npm run codex:ingest -- self-train actions --status open --limit 20${projectArg}`,
    }),
    recursiveAiReadinessGate({
      gate: "self_training_plan_verified",
      label: "自训练计划验证",
      passed: (counts.selfTrainingPlans ?? 0) > 0 && (counts.selfTrainingPlanIssues ?? 0) === 0,
      reason: "必须先把 action 转成可审计 self-training plan，并确认没有计划一致性问题。",
      evidence: {
        plans: counts.selfTrainingPlans ?? 0,
        planIssues: counts.selfTrainingPlanIssues ?? 0,
      },
      command: `npm run codex:ingest -- self-train plan verify --limit 20${projectArg}`,
    }),
    recursiveAiReadinessGate({
      gate: "training_exports",
      label: "训练样本导出",
      passed: (counts.trainingExportEntries ?? 0) > 0,
      reason: "需要至少一个训练样本导出批次，才能进入训练前验证。",
      evidence: {
        exportEntries: counts.trainingExportEntries ?? 0,
        samples: counts.trainingExportSamples ?? 0,
      },
      command: `npm run codex:ingest -- export-samples --kind eval --quality-gate review_required${projectArg}`,
    }),
    recursiveAiReadinessGate({
      gate: "high_confidence_samples",
      label: "高置信样本",
      passed: (counts.highConfidenceSamples ?? 0) > 0,
      reason: "Phase 5 前必须至少有 high-confidence 样本，避免把待复核材料直接喂给自训练。",
      evidence: { highConfidenceSamples: counts.highConfidenceSamples ?? 0 },
      command: `npm run codex:ingest -- self-train actions --status open --limit 20${projectArg}`,
    }),
    recursiveAiReadinessGate({
      gate: "phase_run_audit",
      label: "phase-run 审计运行",
      passed: (counts.recursiveAiPhaseRuns ?? 0) > 0,
      reason: "无人值守前需要至少一次受控 phase-run 审计记录，证明 gate 推进可追踪。",
      evidence: {
        phaseRuns: counts.recursiveAiPhaseRuns ?? 0,
        byStatus: counts.recursiveAiPhaseRunsByStatus ?? {},
        latest: counts.latestRecursiveAiPhaseRun ?? null,
      },
      command: `npm run codex:ingest -- self-question phase-run --max-gates 1 --execute --write${projectArg}`,
    }),
    recursiveAiReadinessGate({
      gate: "latest_phase_run_progress",
      label: "最近 phase-run 没有卡住",
      passed: !latestPhaseRunBlocked,
      reason: "最近一次受控 phase-run 如果停在 failed/repeated_gate，必须先重新跑出可推进审计记录。",
      evidence: {
        latest: counts.latestRecursiveAiPhaseRun ?? null,
        byStatus: counts.recursiveAiPhaseRunsByStatus ?? {},
      },
      command: latestPhaseRunBlocked ? `npm run codex:ingest -- self-question phase-run --max-gates 1 --execute --write${projectArg}` : null,
    }),
    recursiveAiReadinessGate({
      gate: "no_failed_phase_runs",
      label: "无失败 phase-run",
      passed: failedPhaseRuns === 0,
      reason: "存在失败 phase-run 时必须先修复或复核，不能进入无人值守递归。",
      evidence: { failedPhaseRuns, byStatus: counts.recursiveAiPhaseRunsByStatus ?? {} },
    }),
    recursiveAiReadinessGate({
      gate: "auto_execute_disabled",
      label: "自动执行仍关闭",
      passed: true,
      reason: "Phase 5 readiness 只允许进入人工批准环节，不允许自动交易或自动改正式 wiki/raw。",
      evidence: { autoExecute: false, wroteWiki: false, wroteRaw: false },
    }),
  ]
  const blockingGates = gates.filter((gate) => !gate.passed)
  return {
    schema: "recursive-ai-phase5-readiness-v1",
    status: blockingGates.length ? "blocked" : "ready_for_human_approval",
    autoExecuteAllowed: false,
    humanApprovalRequired: true,
    blockingGates: blockingGates.map((gate) => ({
      gate: gate.gate,
      label: gate.label,
      reason: gate.reason,
      command: gate.command,
      evidence: gate.evidence,
    })),
    approvalGate: {
      gate: "human_phase5_approval",
      status: "required",
      reason: "即使所有技术 gate 通过，也需要人工批准后才能设计任何无人值守执行策略。",
    },
    gates,
  }
}

export async function getRecursiveAiPhaseStatus(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const generatedAt = String(options.generatedAt ?? nowLocalTimestamp())
  const [
    brainRecords,
    agentRuns,
    selfTrainingActions,
    selfTrainingPlans,
    selfTrainingPlanVerification,
    selfQuestionLoops,
    recursiveAiPhaseRuns,
    trainingExports,
    activePolicies,
    autoresearchReadiness,
  ] = await Promise.all([
    readBrainRecords(projectPath),
    readAgentRunRecords(projectPath),
    listSelfTrainingActions({ projectPath, status: "all", limit: options.actionLimit ?? 200 }),
    listSelfTrainingPlans({ projectPath, limit: options.planLimit ?? 50 }),
    verifySelfTrainingPlans({ projectPath, limit: options.planVerifyLimit ?? options.planLimit ?? 50 }),
    readSelfQuestionLoopRecords(projectPath),
    readRecursiveAiPhaseRunRecords(projectPath),
    listTrainingSampleExports({ projectPath, limit: options.exportLimit ?? 50 }),
    listActiveSelfQuestionPolicies({ projectPath }),
    getAutoresearchReadiness({ projectPath }),
  ])
  const brainValues = brainRecords
    .map((record) => record.value)
    .filter((value) => value && typeof value === "object" && !Array.isArray(value))
  const loopStatuses = selfQuestionLoops.reduce((map, record) => {
    const status = String(record.manifest?.status ?? "unknown")
    map[status] = (map[status] ?? 0) + 1
    return map
  }, {})
  const phaseRunStatuses = recursiveAiPhaseRuns.reduce((map, record) => {
    const status = String(record.manifest?.status ?? "unknown")
    map[status] = (map[status] ?? 0) + 1
    return map
  }, {})
  const latestPhaseRun = recursiveAiPhaseRuns.at(-1)
  const agentStatuses = agentRuns.reduce((map, record) => {
    const status = String(record.manifest?.status ?? "unknown")
    map[status] = (map[status] ?? 0) + 1
    return map
  }, {})
  const counts = {
    brainRecords: brainValues.length,
    selfQuestions: countBrainRecordValues(brainValues, (record) => record.schema === "self-question-v1" || record.kind === "self-question" || record.type === "question"),
    marketValidations: countBrainRecordValues(brainValues, isSelfQuestionMarketValidationRecord),
    actionableMarketValidations: countBrainRecordValues(brainValues, isActionableSelfQuestionMarketValidationRecord),
    attributions: countBrainRecordValues(brainValues, isSelfQuestionAttributionRecord),
    actionableAttributions: countBrainRecordValues(brainValues, isActionableSelfQuestionAttributionRecord),
    evidenceResults: countBrainRecordValues(brainValues, (record) => record.schema === "self-question-evidence-result-v1" || record.kind === "self-question-evidence-result" || record.type === "evidence_result"),
    activePolicies: activePolicies.counts?.active ?? activePolicies.policies?.length ?? 0,
    agentRuns: agentRuns.length,
    agentRunsByStatus: agentStatuses,
    selfTrainingActions: selfTrainingActions.counts?.actions ?? 0,
    selfTrainingOpenActions: selfTrainingActions.counts?.open ?? 0,
    selfTrainingReviewedActions: selfTrainingActions.counts?.reviewed ?? 0,
    selfTrainingPlans: selfTrainingPlans.totalPlans ?? 0,
    selfTrainingPlanVerificationChecked: selfTrainingPlanVerification.checked ?? 0,
    selfTrainingPlanVerificationFailed: selfTrainingPlanVerification.failed ?? 0,
    selfTrainingPlanIssues: selfTrainingPlanVerification.issueCount ?? selfTrainingPlans.issues?.length ?? 0,
    selfQuestionLoops: selfQuestionLoops.length,
    selfQuestionLoopsByStatus: loopStatuses,
    recursiveAiPhaseRuns: recursiveAiPhaseRuns.length,
    recursiveAiPhaseRunsByStatus: phaseRunStatuses,
    latestRecursiveAiPhaseRun: latestPhaseRun
      ? {
          status: latestPhaseRun.manifest?.status ?? "unknown",
          generatedAt: latestPhaseRun.manifest?.generatedAt ?? null,
          relativePath: latestPhaseRun.relativePath,
          maxGates: latestPhaseRun.manifest?.maxGates ?? null,
          executedCount: latestPhaseRun.manifest?.executedCount ?? null,
          stopReason: latestPhaseRun.manifest?.stopReason ?? null,
        }
      : null,
    trainingExportEntries: trainingExports.totalEntries ?? 0,
    trainingExportSamples: trainingExports.summary?.sampleCount ?? 0,
    highConfidenceSamples: trainingExports.summary?.highConfidenceEligible ?? 0,
    autoresearchPrograms: autoresearchReadiness.counts?.researchPrograms ?? 0,
    autoresearchExperiments: autoresearchReadiness.counts?.experiments ?? 0,
    autoresearchExperimentDecisions: autoresearchReadiness.counts?.decisions ?? {},
  }
  const phase5Readiness = buildRecursiveAiPhase5Readiness(projectPath, counts)
  const phases = [
    recursiveAiPhase({
      phase: 1,
      label: "agentic ask 多智能体并发问答",
      status: "implemented",
      evidence: {
        command: "ask --agentic",
        artifacts: ".llm-wiki/agent-runs",
        agentRuns: counts.agentRuns,
        byStatus: counts.agentRunsByStatus,
      },
      nextGate: counts.agentRuns > 0 ? "continue_reviewing_agentic_answers" : "run_agentic_ask_artifacts_for_more_eval_samples",
    }),
    recursiveAiPhase({
      phase: 2,
      label: "主题识别、细分候选池和市场验证",
      status: "implemented",
      evidence: {
        commands: ["ask --sources stock-price", "data-source status", "company-research"],
        segmentRegistry: "光互联/光纤链、PCB 产业链；未配置主题回退普通候选池",
      },
      nextGate: "expand_maintained_segment_config_when_new_themes_repeat",
    }),
    recursiveAiPhase({
      phase: 3,
      label: "自提问、市场反馈和归因",
      status: counts.selfQuestions + counts.marketValidations + counts.attributions > 0 ? "active" : "implemented_no_project_records",
      evidence: {
        selfQuestions: counts.selfQuestions,
        marketValidations: counts.marketValidations,
        actionableMarketValidations: counts.actionableMarketValidations,
        attributions: counts.attributions,
        actionableAttributions: counts.actionableAttributions,
        evidenceResults: counts.evidenceResults,
        activePolicies: counts.activePolicies,
      },
      nextGate: counts.evidenceResults > 0 ? "promote_confirmed_evidence_to_policy_and_samples" : "resolve_fundamental_evidence_tasks",
    }),
    recursiveAiPhase({
      phase: 4,
      label: "自训练动作、计划、验证、导出和回归门控",
      status: counts.selfTrainingActions + counts.selfTrainingPlans + counts.selfQuestionLoops + counts.recursiveAiPhaseRuns + counts.trainingExportEntries > 0 ? "active" : "implemented_no_project_records",
      evidence: {
        actions: counts.selfTrainingActions,
        openActions: counts.selfTrainingOpenActions,
        reviewedActions: counts.selfTrainingReviewedActions,
        plans: counts.selfTrainingPlans,
        loops: counts.selfQuestionLoops,
        loopStatuses: counts.selfQuestionLoopsByStatus,
        phaseRuns: counts.recursiveAiPhaseRuns,
        phaseRunStatuses: counts.recursiveAiPhaseRunsByStatus,
        latestPhaseRun: counts.latestRecursiveAiPhaseRun,
        trainingExportEntries: counts.trainingExportEntries,
        highConfidenceSamples: counts.highConfidenceSamples,
        autoresearchPrograms: counts.autoresearchPrograms,
        autoresearchExperiments: counts.autoresearchExperiments,
        autoresearchStatus: autoresearchReadiness.status,
      },
      nextGate: counts.highConfidenceSamples > 0 ? "run_export_verify_and_regression_before_training" : "review_actions_and_accumulate_high_confidence_samples",
    }),
    recursiveAiPhase({
      phase: 5,
      label: "无人值守递归自训练和自动策略更新",
      status: "planned_manual_gate",
      evidence: {
        autoExecute: false,
        readiness: phase5Readiness.status,
        blockingGates: phase5Readiness.blockingGates.map((gate) => gate.gate),
        writeBoundaries: "wiki/raw 仍由显式 apply/write 门控；self-training plan 默认不执行",
      },
      nextGate: "only_after_reviewed_samples_regression_and_human_approval",
    }),
  ]
  return {
    schema: "recursive-ai-phase-status-v1",
    mode: "self-question-phase-status",
    generatedAt,
    projectPath,
    currentPhase: 4,
    phaseLabel: "Phase 4 - recursive self-training loop foundation is active",
    finalPhase: 5,
    status: "in_progress",
    counts,
    phases,
    autoresearchReadiness,
    phase5Readiness,
    nextActions: buildRecursiveAiNextActions(projectPath, counts),
    nextMilestones: [
      "把更多 self-training action 经过人工 review/resolve，形成 high_confidence eval 标签。",
      "持续运行 export-verify 和 policy-regression-verify，防止 prompt/policy/sample 闭环退化。",
      "Phase 5 前保持 autoExecute=false，不让系统自动改 wiki/raw 或自动交易。",
    ],
    writePolicy: {
      readOnly: true,
      wroteWiki: false,
      wroteRaw: false,
      wroteBrain: false,
      wroteArtifacts: false,
    },
  }
}

export async function checkRecursiveAiPhase5Readiness(options = {}) {
  const phaseStatus = await getRecursiveAiPhaseStatus({
    projectPath: options.projectPath,
    actionLimit: options.actionLimit ?? options["action-limit"],
    planLimit: options.planLimit ?? options["plan-limit"],
    exportLimit: options.exportLimit ?? options["export-limit"],
  })
  const phase5Readiness = phaseStatus.phase5Readiness
  const ready = phase5Readiness?.status === "ready_for_human_approval"
  return {
    schema: "recursive-ai-phase5-check-v1",
    mode: "self-question-phase-check",
    generatedAt: phaseStatus.generatedAt,
    projectPath: phaseStatus.projectPath,
    status: phase5Readiness?.status ?? "blocked",
    ready,
    exitCode: ready ? 0 : 1,
    currentPhase: phaseStatus.currentPhase,
    finalPhase: phaseStatus.finalPhase,
    phase5Readiness,
    blockingGates: phase5Readiness?.blockingGates ?? [],
    approvalGate: phase5Readiness?.approvalGate ?? null,
    writePolicy: {
      readOnly: true,
      wroteWiki: false,
      wroteRaw: false,
      wroteBrain: false,
      wroteArtifacts: false,
    },
  }
}

export function sampleFromBrainRecord(record, kind, context = {}) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return null
  const evidenceResults = Array.isArray(context.evidenceResults) ? context.evidenceResults : []
  const isSelfQuestionMarketValidation =
    record.kind === "self-question-market-validation" ||
    record.validationMethod === "self_question_market_feedback_v1" ||
    (record.type === "validation" && record.targetType === "self-question")
  const isSelfQuestionAttribution =
    record.schema === "self-question-attribution-v1" ||
    record.kind === "self-question-attribution" ||
    record.attributionMethod === "self_question_attribution_v1"
  const attributionQualityGate = (evidenceTasks) => {
    const label = String(record.attributionLabel ?? "").trim().toLowerCase()
    const evidenceGaps = Array.isArray(record.evidenceGaps) ? record.evidenceGaps.filter(Boolean) : []
    const confirmedEvidenceResults = confirmedEvidenceResultsForAttribution(record, evidenceGaps, evidenceResults)
    const confirmedGapSet = new Set(confirmedEvidenceResults.map((item) => item.evidenceGap).filter(Boolean))
    const unresolvedGaps = evidenceGaps.filter((gap) => !confirmedGapSet.has(gap))
    if (label === "confirmed" && evidenceGaps.length === 0) {
      return { status: "eligible", highConfidenceEligible: true, requiredAction: null, reasons: [] }
    }
    if (label === "price_only" && evidenceGaps.length > 0 && unresolvedGaps.length === 0 && confirmedEvidenceResults.length > 0) {
      return {
        status: "eligible",
        highConfidenceEligible: true,
        requiredAction: null,
        reasons: ["fundamental_evidence_confirmed"],
        evidenceResultIds: confirmedEvidenceResults.map((item) => item.id).filter(Boolean),
        resolvedEvidenceGaps: [...confirmedGapSet],
      }
    }
    if (label === "price_only" && (evidenceGaps.length > 0 || evidenceTasks.length > 0)) {
      return {
        status: "needs_evidence",
        highConfidenceEligible: false,
        requiredAction: "run_evidence_stage",
        reasons: ["price_only_without_fundamental_confirmation", ...unresolvedGaps],
        evidenceResultIds: confirmedEvidenceResults.map((item) => item.id).filter(Boolean),
        resolvedEvidenceGaps: [...confirmedGapSet],
      }
    }
    if (label === "disconfirmed") {
      return {
        status: "negative_sample",
        highConfidenceEligible: false,
        requiredAction: "review_for_eval",
        reasons: ["disconfirmed_attribution"],
      }
    }
    return {
      status: "review_required",
      highConfidenceEligible: false,
      requiredAction: "human_review",
      reasons: [`attribution_label:${label || "unknown"}`],
    }
  }
  if (kind === "sft") {
    if (record.type === "correction") {
      return {
        kind,
        id: `sft_${record.id ?? shortHash(JSON.stringify(record))}`,
        input: record.badAnswer ? `修正这个回答：${record.badAnswer}` : record.text ?? record.title ?? "",
        output: record.goodAnswer ?? record.correction ?? record.lesson ?? record.text ?? "",
        sourceRecordId: record.id,
      }
    }
    if (record.type === "attribution" && isSelfQuestionAttribution) {
      const evidenceTasks = evidenceTasksFromFundamentalGaps(record.evidenceGaps, record)
      const qualityGate = attributionQualityGate(evidenceTasks)
      return {
        kind,
        id: `sft_${record.id ?? shortHash(JSON.stringify(record))}`,
        input: [
          "对自提问市场反馈做归因。",
          `问题：${record.question ?? ""}`,
          `假设：${record.hypothesis ?? ""}`,
          `验证结论：${record.verdict ?? record.result ?? ""}`,
          `标的：${record.stockName ?? record.stockCode ?? ""} ${record.stockCode ?? ""}`.trim(),
          `证据缺口：${(record.evidenceGaps ?? []).join(", ")}`,
        ].filter((line) => !line.endsWith("：")).join("\n"),
        output: [
          `归因：${record.attributionLabel ?? "insufficient"}`,
          `置信度影响：${record.confidenceImpact ?? "unknown"}`,
          `下一步：${record.nextAction ?? "collect_more_evidence"}`,
          evidenceTasks.length ? `补证任务：${evidenceTasks.map((task) => `${task.signal}/${task.provider}/${task.command}`).join("；")}` : "",
          record.attributionReason ?? "",
        ].filter(Boolean).join("\n"),
        qualityGate,
        sourceRecordId: record.id,
      }
    }
    if (record.type === "validation" && isSelfQuestionMarketValidation) {
      return {
        kind,
        id: `sft_${record.id ?? shortHash(JSON.stringify(record))}`,
        input: [
          "验证自提问市场反馈。",
          `问题：${record.question ?? ""}`,
          `假设：${record.hypothesis ?? ""}`,
          `标的：${record.stockName ?? record.stockCode ?? ""} ${record.stockCode ?? ""}`.trim(),
          `窗口：${record.windowDays ?? record.marketValidation?.lookbackDays ?? "NA"}d`,
        ].filter((line) => !line.endsWith("：")).join("\n"),
        output: [
          `${record.verdict ?? record.result ?? "待继续观察"}：${record.reason ?? ""}`.trim(),
          record.evidenceGaps?.length ? `证据缺口：${record.evidenceGaps.join(", ")}` : "",
          record.marketValidation ? `市场反馈：${JSON.stringify(record.marketValidation)}` : "",
        ].filter(Boolean).join("\n"),
        sourceRecordId: record.id,
      }
    }
    if (record.type === "validation") {
      return {
        kind,
        id: `sft_${record.id ?? shortHash(JSON.stringify(record))}`,
        input: `验证交易假设：${record.prediction ?? record.text ?? record.title ?? ""}`,
        output: `${record.verdict ?? record.result ?? "待继续观察"}：${record.reason ?? ""}`.trim(),
        sourceRecordId: record.id,
      }
    }
  }
  if (kind === "preference") {
    const accepted = record.goodAnswer ?? record.accepted
    const rejected = record.badAnswer ?? record.rejected
    if (!accepted || !rejected) return null
    return {
      kind,
      id: `pref_${record.id ?? shortHash(JSON.stringify(record))}`,
      prompt: record.prompt ?? record.question ?? record.text ?? "交易知识库回答偏好",
      accepted,
      rejected,
      sourceRecordId: record.id,
    }
  }
  if (kind === "eval") {
    if (record.type === "event" && record.eventType === "self-training-action-review") {
      const evidenceRefs = Array.isArray(record.evidenceRefs) ? sanitizeTrainingSampleValue(record.evidenceRefs) : []
      const reviewQuality = sanitizeTrainingSampleText(record.reviewQuality, "reviewed").trim().toLowerCase().replace(/-/g, "_")
      const reviewResult = sanitizeTrainingSampleText(record.result ?? record.reviewAction, "reviewed").trim().toLowerCase()
      const highConfidenceEligible =
        reviewQuality === "high_confidence" &&
        evidenceRefs.length > 0 &&
        ["approved", "resolved"].includes(reviewResult)
      return {
        kind,
        id: `eval_${record.id ?? shortHash(JSON.stringify(record))}`,
        source: "self-training-action-review",
        question: `这条递归自训练动作的人工审核结论是什么：${sanitizeTrainingSampleText(record.sourceTarget ?? record.sourceRule ?? record.actionId ?? "", "")}`,
        expected: [
          `审核结论：${sanitizeTrainingSampleText(record.result ?? record.reviewAction ?? "reviewed")}`,
          `审核动作：${sanitizeTrainingSampleText(record.reviewAction ?? "review")}`,
          record.note ? `备注：${sanitizeTrainingSampleText(record.note)}` : "",
        ].filter(Boolean).join("\n"),
        evidence: {
          actionId: sanitizeTrainingSampleText(record.actionId),
          actionFingerprint: sanitizeTrainingSampleText(record.actionFingerprint),
          sourceRule: sanitizeTrainingSampleText(record.sourceRule),
          sourceTarget: sanitizeTrainingSampleText(record.sourceTarget),
          sourceAction: sanitizeTrainingSampleText(record.sourceAction),
          reviewer: sanitizeTrainingSampleText(record.reviewer),
          result: sanitizeTrainingSampleText(record.result),
          reviewAction: sanitizeTrainingSampleText(record.reviewAction),
          reviewQuality,
          evidenceRefs,
        },
        qualityGate: {
          status: "eligible",
          highConfidenceEligible,
          requiredAction: highConfidenceEligible ? "train_on_reviewed_action" : "promote_with_evidence_refs",
          reasons: highConfidenceEligible
            ? ["self_training_action_reviewed", "evidence_refs_confirmed"]
            : ["self_training_action_reviewed", "high_confidence_requires_evidence_refs"],
        },
        sourceRecordId: record.id,
      }
    }
    if (record.type === "event" && record.eventType === "self-training-action") {
      const safeSampleArray = (items) => Array.isArray(items) ? sanitizeTrainingSampleValue(items) : []
      const affectedIds = safeSampleArray(record.affectedIds)
      const evidenceGaps = safeSampleArray(record.evidenceGaps)
      const evidenceTasks = safeSampleArray(record.evidenceTasks)
      const nextStages = safeSampleArray(record.nextStages)
      const suggestedCommands = safeSampleArray(record.suggestedCommands)
      return {
        kind,
        id: `eval_${record.id ?? shortHash(JSON.stringify(record))}`,
        source: "self-training-action",
        question: `这条递归自训练动作是否应该执行、复核或继续补证：${sanitizeTrainingSampleText(record.target ?? record.rule ?? record.action ?? "", "")}`,
        expected: [
          `动作：${sanitizeTrainingSampleText(record.action ?? "review_action")}`,
          `规则：${sanitizeTrainingSampleText(record.rule ?? "unknown_rule")}`,
          `原因：${sanitizeTrainingSampleText(record.reason ?? "需要人工复核后再进入训练闭环")}`,
          nextStages.length ? `下一阶段：${nextStages.join(", ")}` : "",
          suggestedCommands.length ? `建议命令：${suggestedCommands.join("；")}` : "",
        ].filter(Boolean).join("\n"),
        evidence: {
          rule: sanitizeTrainingSampleText(record.rule),
          target: sanitizeTrainingSampleText(record.target),
          action: sanitizeTrainingSampleText(record.action),
          reason: sanitizeTrainingSampleText(record.reason),
          gateStatus: sanitizeTrainingSampleText(record.gateStatus),
          affectedIds,
          evidenceGaps,
          evidenceTasks,
          nextStages,
          suggestedCommands,
          actionFingerprint: sanitizeTrainingSampleText(record.actionFingerprint),
          sourceRefs: safeSampleArray(record.sourceRefs),
        },
        qualityGate: {
          status: "review_required",
          highConfidenceEligible: false,
          requiredAction: "execute_or_review_action",
          reasons: ["self_training_action_requires_review"],
        },
        sourceRecordId: record.id,
      }
    }
    if (record.type === "attribution" && isSelfQuestionAttribution) {
      const evidenceTasks = evidenceTasksFromFundamentalGaps(record.evidenceGaps, record)
      const qualityGate = attributionQualityGate(evidenceTasks)
      return {
        kind,
        id: `eval_${record.id ?? shortHash(JSON.stringify(record))}`,
        question: `这条自提问市场反馈的归因是否合理：${record.question ?? record.hypothesis ?? record.target ?? ""}`,
        expected: `${record.attributionLabel ?? "insufficient"}；${record.confidenceImpact ?? "unknown"}；${record.nextAction ?? "collect_more_evidence"}`,
        evidence: {
          validationId: record.validationId ?? null,
          questionRecordId: record.questionRecordId ?? null,
          questionId: record.questionId ?? null,
          verdict: record.verdict ?? null,
          attributionReason: record.attributionReason ?? null,
          evidenceGaps: record.evidenceGaps ?? [],
          evidenceTasks,
          nextAction: record.nextAction ?? null,
        },
        qualityGate,
        sourceRecordId: record.id,
      }
    }
    if (record.type === "validation" && isSelfQuestionMarketValidation) {
      return {
        kind,
        id: `eval_${record.id ?? shortHash(JSON.stringify(record))}`,
        question: `自提问市场反馈是否支持原假设：${record.question ?? record.hypothesis ?? record.target ?? ""}`,
        expected: `${record.verdict ?? record.result ?? "待继续观察"}：${record.reason ?? ""}`.trim(),
        evidence: {
          questionRecordId: record.questionRecordId ?? null,
          questionId: record.questionId ?? null,
          hypothesis: record.hypothesis ?? null,
          stockName: record.stockName ?? null,
          stockCode: record.stockCode ?? null,
          windowDays: record.windowDays ?? record.marketValidation?.lookbackDays ?? null,
          marketValidation: record.marketValidation ?? null,
          evidenceGaps: record.evidenceGaps ?? [],
          sourceRefs: record.sourceRefs ?? [],
        },
        sourceRecordId: record.id,
      }
    }
    if (record.schema === "self-question-v1" || record.kind === "self-question" || record.type === "question") {
      return {
        kind,
        id: `eval_${record.id ?? shortHash(JSON.stringify(record))}`,
        question: record.question,
        expected: [
          "必须输出验证计划",
          "必须区分订单兑现、叙事扩散和证据不足",
          "必须披露量价、公告、招投标、财报闭环中的缺口",
          "必须给出反证条件和交易含义",
        ].join("；"),
        evidence: {
          hypothesis: record.hypothesis ?? null,
          validationWindows: record.validationWindows ?? [],
          marketSignals: record.marketSignals ?? [],
          fundamentalSignals: record.fundamentalSignals ?? [],
          disconfirmIf: record.disconfirmIf ?? [],
          sourceRefs: record.sourceRefs ?? [],
        },
        sourceRecordId: record.id,
      }
    }
    if (record.type !== "validation") return null
    return {
      kind,
      id: `eval_${record.id ?? shortHash(JSON.stringify(record))}`,
      question: `这条预测是否被市场验证：${record.prediction ?? record.text ?? record.title ?? ""}`,
      expected: record.verdict ?? record.result ?? "待继续观察",
      evidence: record.sqlRefs ?? record.marketValidation?.refs ?? [],
      sourceRecordId: record.id,
    }
  }
  return null
}

export function parseTrainingSampleQualityGate(value) {
  const raw = String(value ?? "all").trim().toLowerCase().replace(/-/g, "_")
  const aliases = new Map([
    ["any", "all"],
    ["none", "all"],
    ["high_confidence_only", "high_confidence"],
    ["highconfidence", "high_confidence"],
  ])
  const qualityGate = aliases.get(raw) ?? raw
  const allowed = new Set(["all", "eligible", "needs_evidence", "review_required", "negative_sample", "high_confidence", ...STOCK_FEEDBACK_QUALITY_GATES])
  if (!allowed.has(qualityGate)) throw new Error(`--quality-gate must be all, eligible, needs_evidence, review_required, negative_sample, high_confidence, or one of ${STOCK_FEEDBACK_QUALITY_GATES.join(", ")}`)
  return qualityGate
}

export function sampleMatchesQualityGate(sample, qualityGate) {
  if (qualityGate === "all") return true
  if (qualityGate === "high_confidence") return sample?.qualityGate?.highConfidenceEligible === true
  return sample?.qualityGate?.status === qualityGate
}

export function trainingSampleSource(sample = {}) {
  const source = sanitizeTrainingSampleText(sample.source, "").trim()
  return source || "brain-memory"
}

export function trainingSampleQualityGateStatus(sample = {}) {
  return sanitizeTrainingSampleText(sample.qualityGate?.status, "unclassified").trim() || "unclassified"
}

export function buildTrainingSampleExportManifest({ kind, qualityGate, outputRelativePath, manifestRelativePath, samples, generatedAt }) {
  const qualityGateCounts = {}
  const sourceCounts = {}
  const requiredActionCounts = {}
  let highConfidenceEligible = 0
  for (const sample of samples) {
    const gateStatus = trainingSampleQualityGateStatus(sample)
    const source = trainingSampleSource(sample)
    qualityGateCounts[gateStatus] = (qualityGateCounts[gateStatus] ?? 0) + 1
    sourceCounts[source] = (sourceCounts[source] ?? 0) + 1
    if (sample.qualityGate?.highConfidenceEligible === true) highConfidenceEligible += 1
    const requiredAction = sanitizeTrainingSampleText(sample.qualityGate?.requiredAction, "").trim()
    if (requiredAction) requiredActionCounts[requiredAction] = (requiredActionCounts[requiredAction] ?? 0) + 1
  }
  return {
    schema: "training-sample-export-manifest-v1",
    generatedAt,
    kind,
    qualityGate,
    count: samples.length,
    outputs: {
      jsonl: outputRelativePath,
      manifest: manifestRelativePath,
    },
    qualityGateCounts,
    sourceCounts,
    requiredActionCounts,
    highConfidenceEligible,
    highConfidenceBlocked: samples.length - highConfidenceEligible,
    sampleRefs: samples.map((sample) => ({
      id: sanitizeTrainingSampleText(sample.id),
      source: trainingSampleSource(sample),
      sourceRecordId: sanitizeTrainingSampleText(sample.sourceRecordId),
      qualityGateStatus: trainingSampleQualityGateStatus(sample),
      highConfidenceEligible: sample.qualityGate?.highConfidenceEligible === true,
      requiredAction: sanitizeTrainingSampleText(sample.qualityGate?.requiredAction),
    })),
  }
}

export function buildTrainingSampleExportLedgerEntry({ manifest, ledgerRelativePath }) {
  return {
    schema: "training-sample-export-ledger-entry-v1",
    generatedAt: manifest.generatedAt,
    kind: manifest.kind,
    qualityGate: manifest.qualityGate,
    count: manifest.count,
    outputs: {
      jsonl: manifest.outputs?.jsonl ?? null,
      manifest: manifest.outputs?.manifest ?? null,
      ledger: ledgerRelativePath,
    },
    qualityGateCounts: manifest.qualityGateCounts ?? {},
    sourceCounts: manifest.sourceCounts ?? {},
    requiredActionCounts: manifest.requiredActionCounts ?? {},
    highConfidenceEligible: manifest.highConfidenceEligible ?? 0,
    highConfidenceBlocked: manifest.highConfidenceBlocked ?? 0,
    sampleRefCount: Array.isArray(manifest.sampleRefs) ? manifest.sampleRefs.length : 0,
  }
}

export function trainingSampleExportLedgerPath(projectPath) {
  return path.join(projectPath, ".llm-wiki", "exports", "training", "export-ledger.jsonl")
}

export const TRAINING_EXPORT_VERIFY_DEFAULT_CONCURRENCY = 8

export function normalizeTrainingSampleExportKind(value) {
  const kind = String(value ?? "").trim().toLowerCase()
  if (!kind) return null
  if (!["sft", "preference", "eval"].includes(kind)) throw new Error("--kind must be sft, preference, or eval")
  return kind
}

export function summarizeTrainingSampleExportLedger(entries = []) {
  const byKind = {}
  const byQualityGate = {}
  const bySource = {}
  let sampleCount = 0
  let highConfidenceEligible = 0
  let highConfidenceBlocked = 0
  for (const entry of entries) {
    const kind = String(entry.kind ?? "unknown")
    const qualityGate = String(entry.qualityGate ?? "all")
    byKind[kind] = (byKind[kind] ?? 0) + 1
    byQualityGate[qualityGate] = (byQualityGate[qualityGate] ?? 0) + 1
    sampleCount += Number(entry.count ?? 0) || 0
    highConfidenceEligible += Number(entry.highConfidenceEligible ?? 0) || 0
    highConfidenceBlocked += Number(entry.highConfidenceBlocked ?? 0) || 0
    for (const [source, count] of Object.entries(entry.sourceCounts ?? {})) {
      bySource[source] = (bySource[source] ?? 0) + (Number(count) || 0)
    }
  }
  return { byKind, byQualityGate, bySource, sampleCount, highConfidenceEligible, highConfidenceBlocked }
}

export async function listTrainingSampleExports(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const ledgerPath = trainingSampleExportLedgerPath(projectPath)
  const ledgerRelativePath = projectRelative(projectPath, ledgerPath)
  const kind = normalizeTrainingSampleExportKind(options.kind)
  const requestedQualityGate = options.qualityGate ?? options["quality-gate"]
  const qualityGate = requestedQualityGate ? parseTrainingSampleQualityGate(requestedQualityGate) : null
  const limit = parsePositiveInteger(options.limit ?? options["max-exports"], 50)
  const parsed = await readJsonlFile(ledgerPath)
  const allEntries = parsed
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.value && typeof item.value === "object" && !Array.isArray(item.value))
    .map(({ item, index }) => ({
      ...item.value,
      ledgerLine: item.line,
      ledgerIndex: index,
    }))
    .filter((entry) => entry.schema === "training-sample-export-ledger-entry-v1")
  const filtered = allEntries.filter((entry) => {
    if (kind && entry.kind !== kind) return false
    if (qualityGate && entry.qualityGate !== qualityGate) return false
    return true
  })
  const entries = [...filtered]
    .sort((a, b) => (b.ledgerIndex ?? 0) - (a.ledgerIndex ?? 0))
    .slice(0, limit)
  return {
    projectPath,
    ledgerPath,
    ledgerRelativePath,
    totalEntries: allEntries.length,
    filteredEntries: filtered.length,
    returned: entries.length,
    limit,
    filters: { kind, qualityGate },
    summary: summarizeTrainingSampleExportLedger(filtered),
    entries,
  }
}

export function resolveProjectRelativeFile(projectPath, relativePath) {
  const rel = String(relativePath ?? "").trim()
  if (!rel || path.isAbsolute(rel)) return null
  const root = path.resolve(projectPath)
  const resolved = path.resolve(root, rel)
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) return null
  return resolved
}

export async function readTrainingExportManifest(filePath) {
  const raw = await readIfExists(filePath)
  if (!raw.trim()) return { manifest: null, error: "empty_manifest" }
  try {
    return { manifest: JSON.parse(raw), error: null }
  } catch {
    return { manifest: null, error: "invalid_manifest_json" }
  }
}

export async function countTrainingSampleJsonl(filePath) {
  const parsed = await readJsonlFile(filePath)
  const invalidLines = parsed.filter((item) => item.parseError).map((item) => item.line)
  return {
    count: parsed.filter((item) => !item.parseError).length,
    invalidLines,
  }
}

export async function verifyTrainingSampleExportEntry(projectPath, entry = {}) {
  const issues = []
  const outputs = entry.outputs ?? {}
  const jsonlPath = resolveProjectRelativeFile(projectPath, outputs.jsonl)
  const manifestPath = resolveProjectRelativeFile(projectPath, outputs.manifest)
  if (!jsonlPath) issues.push({ code: "invalid_jsonl_path", path: outputs.jsonl ?? null })
  if (!manifestPath) issues.push({ code: "invalid_manifest_path", path: outputs.manifest ?? null })

  let jsonlCount = null
  let invalidJsonlLines = []
  if (jsonlPath) {
    if (!(await exists(jsonlPath))) {
      issues.push({ code: "missing_jsonl", path: outputs.jsonl })
    } else {
      const counted = await countTrainingSampleJsonl(jsonlPath)
      jsonlCount = counted.count
      invalidJsonlLines = counted.invalidLines
      if (invalidJsonlLines.length > 0) issues.push({ code: "invalid_jsonl_lines", path: outputs.jsonl, lines: invalidJsonlLines })
    }
  }

  let manifest = null
  let manifestCount = null
  if (manifestPath) {
    if (!(await exists(manifestPath))) {
      issues.push({ code: "missing_manifest", path: outputs.manifest })
    } else {
      const read = await readTrainingExportManifest(manifestPath)
      manifest = read.manifest
      if (read.error) {
        issues.push({ code: read.error, path: outputs.manifest })
      } else {
        if (manifest.schema !== "training-sample-export-manifest-v1") issues.push({ code: "unexpected_manifest_schema", path: outputs.manifest, schema: manifest.schema ?? null })
        manifestCount = Number(manifest.count)
        if (manifest.outputs?.jsonl !== outputs.jsonl) issues.push({ code: "manifest_jsonl_mismatch", path: outputs.manifest, expected: outputs.jsonl, actual: manifest.outputs?.jsonl ?? null })
        if (manifest.outputs?.manifest !== outputs.manifest) issues.push({ code: "manifest_path_mismatch", path: outputs.manifest, expected: outputs.manifest, actual: manifest.outputs?.manifest ?? null })
      }
    }
  }

  const ledgerCount = Number(entry.count)
  if (Number.isFinite(ledgerCount) && jsonlCount != null && ledgerCount !== jsonlCount) issues.push({ code: "ledger_jsonl_count_mismatch", expected: ledgerCount, actual: jsonlCount })
  if (Number.isFinite(ledgerCount) && Number.isFinite(manifestCount) && ledgerCount !== manifestCount) issues.push({ code: "ledger_manifest_count_mismatch", expected: ledgerCount, actual: manifestCount })
  if (Number.isFinite(manifestCount) && jsonlCount != null && manifestCount !== jsonlCount) issues.push({ code: "manifest_jsonl_count_mismatch", expected: manifestCount, actual: jsonlCount })

  return {
    status: issues.length ? "failed" : "ok",
    kind: entry.kind ?? null,
    qualityGate: entry.qualityGate ?? null,
    outputs,
    ledgerLine: entry.ledgerLine ?? null,
    ledgerIndex: entry.ledgerIndex ?? null,
    ledgerCount: Number.isFinite(ledgerCount) ? ledgerCount : null,
    manifestCount: Number.isFinite(manifestCount) ? manifestCount : null,
    jsonlCount,
    invalidJsonlLines,
    issues,
  }
}

export async function verifyTrainingSampleExports(options = {}) {
  const listed = await listTrainingSampleExports(options)
  const requestedConcurrency = options.concurrency ?? options.verifyConcurrency ?? options["verify-concurrency"] ?? options.exportVerifyConcurrency ?? options["export-verify-concurrency"]
  const parsedConcurrency = parsePositiveInteger(requestedConcurrency, TRAINING_EXPORT_VERIFY_DEFAULT_CONCURRENCY)
  const concurrency = listed.entries.length > 0 ? Math.min(parsedConcurrency, listed.entries.length) : 0
  const entries = listed.entries.length > 0
    ? await mapWithConcurrency(listed.entries, concurrency, async (entry) => verifyTrainingSampleExportEntry(listed.projectPath, entry))
    : []
  const failed = entries.filter((entry) => entry.status !== "ok").length
  const issueCount = entries.reduce((sum, entry) => sum + entry.issues.length, 0)
  return {
    projectPath: listed.projectPath,
    ledgerPath: listed.ledgerPath,
    ledgerRelativePath: listed.ledgerRelativePath,
    status: failed ? "failed" : "ok",
    checked: entries.length,
    failed,
    passed: entries.length - failed,
    issueCount,
    filters: listed.filters,
    totalEntries: listed.totalEntries,
    filteredEntries: listed.filteredEntries,
    limit: listed.limit,
    concurrency,
    entries,
  }
}

export async function resolveTrainingSampleExportPaths(projectPath, fileKind, generatedAt) {
  const exportDir = path.join(projectPath, ".llm-wiki", "exports", "training")
  const dateStamp = String(generatedAt ?? nowLocalTimestamp()).slice(0, 10)
  const compactStamp = String(generatedAt ?? nowLocalTimestamp()).replace(/\D/g, "").slice(0, 14) || dateStamp.replace(/\D/g, "")
  let attempt = 0
  while (true) {
    const suffix = attempt === 0 ? dateStamp : attempt === 1 ? compactStamp : `${compactStamp}-${attempt}`
    const baseName = `${fileKind}-${suffix}`
    const outputPath = path.join(exportDir, `${baseName}.jsonl`)
    const manifestPath = path.join(exportDir, `${baseName}.manifest.json`)
    if (!(await exists(outputPath)) && !(await exists(manifestPath))) {
      return { outputPath, manifestPath }
    }
    attempt += 1
  }
}

export async function exportTrainingSamples(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const kind = String(options.kind ?? "sft").trim().toLowerCase()
  if (!["sft", "preference", "eval"].includes(kind)) throw new Error("--kind must be sft, preference, or eval")
  const qualityGate = parseTrainingSampleQualityGate(options.qualityGate ?? options["quality-gate"])
  const records = (await readBrainRecords(projectPath)).map((item) => item.value).filter((item) => item && typeof item === "object" && !Array.isArray(item))
  const evidenceResults = records.filter(isSelfQuestionEvidenceResultRecord)
  const brainSamples = records
    .map((record) => sampleFromBrainRecord(record, kind, { evidenceResults }))
    .filter(Boolean)
  const agentRunSamples = kind === "eval"
    ? (await readAgentRunRecords(projectPath)).map((record) => sampleFromAgentRunRecord(record, kind)).filter(Boolean)
    : []
  const selfTrainingPlanSamples = kind === "eval"
    ? (await readSelfTrainingPlanRecords(projectPath)).map((record) => sampleFromSelfTrainingPlanRecord(record, kind)).filter(Boolean)
    : []
  const selfTrainingPlanVerificationSamples = kind === "eval"
    ? (await readSelfQuestionLoopRecords(projectPath)).map((record) => sampleFromSelfQuestionLoopRecord(record, kind)).filter(Boolean)
    : []
  const stockFeedbackSamples = await readStockFeedbackTrainingSamples(projectPath, kind)
  const samples = [...brainSamples, ...agentRunSamples, ...selfTrainingPlanSamples, ...selfTrainingPlanVerificationSamples, ...stockFeedbackSamples]
    .filter((sample) => sampleMatchesQualityGate(sample, qualityGate))
  const generatedAt = nowLocalTimestamp()
  const fileKind = qualityGate === "all" ? kind : `${kind}-${qualityGate}`
  const { outputPath, manifestPath } = await resolveTrainingSampleExportPaths(projectPath, fileKind, generatedAt)
  const outputRelativePath = projectRelative(projectPath, outputPath)
  const manifestRelativePath = projectRelative(projectPath, manifestPath)
  const ledgerPath = trainingSampleExportLedgerPath(projectPath)
  const ledgerRelativePath = projectRelative(projectPath, ledgerPath)
  const manifest = buildTrainingSampleExportManifest({
    kind,
    qualityGate,
    outputRelativePath,
    manifestRelativePath,
    samples,
    generatedAt,
  })
  await ensureDirectory(path.dirname(outputPath))
  await fs.writeFile(outputPath, samples.map((sample) => JSON.stringify(sample)).join("\n") + (samples.length ? "\n" : ""), "utf8")
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8")
  const ledgerEntry = buildTrainingSampleExportLedgerEntry({ manifest, ledgerRelativePath })
  await appendJsonl(ledgerPath, ledgerEntry)
  return {
    projectPath,
    kind,
    qualityGate,
    outputPath,
    relativePath: outputRelativePath,
    manifestPath,
    manifestRelativePath,
    manifest,
    ledgerPath,
    ledgerRelativePath,
    ledgerEntry,
    count: samples.length,
    samples,
  }
}
