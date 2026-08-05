/**
 * 复利回灌模块 (Compound Feedback)
 *
 * E10 跨入口闭环：确保每次研究的结构化结论沉淀进中文分类 wiki，
 * 让后续研究可以直接复用已积累的知识而非从零开始。
 *
 * 回灌映射：
 *   company-research / deep-research → wiki/总结/<date>-<slug>.md
 *   self-question (self-training)      → wiki/进化/<date>-认知演化.md
 *   daily-loop 已在 daily-loop.mjs 中独立实现 → wiki/问答/, 市场环境/, 进化/, 策略/
 */

import path from "node:path"
import { writeFile, mkdir } from "node:fs/promises"

/** relative path within project */
function projectRelative(projectPath, filePath) {
  return path.relative(projectPath, filePath).replace(/\\/g, "/")
}

// ---- helpers ----

function dateSlug(generatedAt) {
  return (generatedAt ?? new Date().toISOString()).slice(0, 10)
}

function safeVal(v) {
  return String(v ?? "").replace(/"/g, "'").replace(/\n/g, " ").replace(/\\/g, "/").trim()
}

async function ensureDir(dirPath) {
  await mkdir(dirPath, { recursive: true })
}

function wikiPath(projectPath, category, fileName) {
  return path.join(projectPath, "wiki", category, String(fileName))
}

// ---- 1. company-research → wiki/总结/ ----

/**
 * 公司深度研究完成后，将摘要结论沉淀到 wiki/总结/。
 */
export async function writeCompanyResearchCompound({
  projectPath,
  generatedAt,
  company,
  providerSummary,
  outputDir,
}) {
  const date = dateSlug(generatedAt)
  const rawStockCode = safeVal(company?.stockCode ?? company?.tsCode ?? "")
  const stockCode = rawStockCode.replace(/^(SH|SZ|BJ|sh|sz|bj)/, "")
  const stockName = safeVal(company?.stockName ?? company?.secName ?? "")
  const displayName = [stockCode, stockName].filter(Boolean).join("-") || "未知公司"
  const slug = `${date}-${displayName.replace(/\s+/g, "")}-研究摘要`

  const providers = safeVal(providerSummary)
  const outputRelative = outputDir ? projectRelative(projectPath, outputDir) : ""

  const rows = [
    "---",
    `title: "${displayName} 深度研究摘要"`,
    `date: ${date}`,
    "type: synthesis",
    `source: company-research`,
    `stock: "${stockCode}"`,
    `name: "${stockName}"`,
    "---",
    "",
    `## ${displayName} 研究摘要`,
    "",
    `- 研究日期：${date}`,
    `- 数据源：${providers || "自动采集"}`,
    outputRelative ? `- 完整报告：${outputRelative}` : "",
    "",
    "> 此文件由 company-research 复利回灌自动生成。",
    "> 完整财务模型、证据台账、深度报告请查看完整输出目录。",
  ]

  const filePath = wikiPath(projectPath, "总结", `${slug}.md`)
  await ensureDir(path.dirname(filePath))
  await writeFile(filePath, rows.join("\n") + "\n", "utf8")
  return projectRelative(projectPath, filePath)
}

// ---- 2. deep-research → wiki/总结/ ----

/**
 * 深度话题研究完成后，将结论沉淀到 wiki/总结/。
 */
export async function writeDeepResearchCompound({
  projectPath,
  generatedAt,
  topic,
  answerSnippet,
}) {
  const date = dateSlug(generatedAt)
  const slug = `${date}-${safeVal(topic).replace(/\s+/g, "").slice(0, 40)}`

  const rows = [
    "---",
    `title: "${safeVal(topic)} 深度研究"`,
    `date: ${date}`,
    "type: synthesis",
    `source: deep-research`,
    "---",
    "",
    `## ${safeVal(topic)} 深度研究结论`,
    "",
    `- 研究日期：${date}`,
    "",
    answerSnippet
      ? `### 摘要\n\n${String(answerSnippet).slice(0, 2000)}`
      : "> (无摘要)",
    "",
    "> 此文件由 deep-research 复利回灌自动生成。",
    "> 完整研究上下文与引用请查看 .llm-wiki/deep-research/ 输出目录。",
  ]

  const filePath = wikiPath(projectPath, "总结", `${slug}.md`)
  await ensureDir(path.dirname(filePath))
  await writeFile(filePath, rows.join("\n") + "\n", "utf8")
  return projectRelative(projectPath, filePath)
}

// ---- 3. self-question (self-training) → wiki/进化/ ----

/**
 * 自提问演化的自训练阶段完成后，将演化动作沉淀到 wiki/进化/。
 */
export async function writeSelfQuestionCompound({
  projectPath,
  generatedAt,
  selfTraining,
}) {
  const date = dateSlug(generatedAt)

  const actionCount = selfTraining?.actions?.length ?? 0
  const ruleLines = (selfTraining?.actions ?? [])
    .slice(0, 30)
    .map((a) => `- [${safeVal(a.status ?? "pending")}] ${safeVal(a.rule)} → ${safeVal(a.action)}`)
    .join("\n") || "- 无演化动作"

  const rows = [
    "---",
    `title: "自提问演化 - ${date}"`,
    `date: ${date}`,
    "type: evolution",
    `source: self-question`,
    "---",
    "",
    `## 认知演化记录 (${date})`,
    "",
    `- 演化动作数：${actionCount}`,
    `- 来源：自提问循环 (self-question loop) 自训练阶段`,
    "",
    "### 演化动作列表",
    "",
    ruleLines,
    "",
    "> 此文件由 self-question 复利回灌自动生成。",
    "> 完整自训练记录请查看 data/brain/self_training_events.jsonl。",
  ]

  const filePath = wikiPath(projectPath, "进化", `${date}-认知演化.md`)
  await ensureDir(path.dirname(filePath))
  await writeFile(filePath, rows.join("\n") + "\n", "utf8")
  return projectRelative(projectPath, filePath)
}
