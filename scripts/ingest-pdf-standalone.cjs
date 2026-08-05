/**
 * 独立研报 ingest 脚本（脱离 GUI / Tauri runtime）
 *
 * 流程：
 *   1. 遍历 raw/sources/研报/*.pdf
 *   2. 文本来源：优先 raw/sources/研报/.cache/<name>.pdf.txt；否则用系统 pdftotext 实时提取（并写回 .cache 对齐 GUI）
 *   3. 调用用户的 DeepSeek（OpenAI 兼容）生成结构化中文提炼
 *   4. 由代码（非 LLM）强制生成 schema 合规的 frontmatter
 *   5. 写出 wiki/sources/<name>.md
 *
 * 用法：
 *   node scripts/ingest-pdf-standalone.cjs            # 跑全部
 *   node scripts/ingest-pdf-standalone.cjs --limit 3  # 只跑前 3 份（测试）
 *   node scripts/ingest-pdf-standalone.cjs --dry-run  # 只列文件，不调 LLM
 *   node scripts/ingest-pdf-standalone.cjs --force    # 已存在也覆盖重跑
 *   node scripts/ingest-pdf-standalone.cjs --project <path>  # 指定数据工作区
 *
 * 项目路径优先级：--project > TRADING_WIKI_PROJECT > 仓库内 zTradingData/小张的交易复盘
 * LLM 配置优先级：TRADING_WIKI_LLM_CONFIG/TRADING_WIKI_APP_STATE >
 *   平台 app-state.json > OPENAI_API_KEY(+OPENAI_BASE_URL/OPENAI_MODEL)
 */

const fs = require("fs")
const os = require("os")
const path = require("path")
const { execFileSync } = require("child_process")

// ── 路径（无机器相关硬编码）──────────────────────────
// 优先级：--project / TRADING_WIKI_PROJECT / 仓库内 zTradingData/小张的交易复盘
const REPO_ROOT = path.resolve(__dirname, "..")
const IN_REPO_WORKSPACE = path.join(REPO_ROOT, "zTradingData", "小张的交易复盘")

function parseCliArgs(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!arg.startsWith("--")) {
      out._.push(arg)
      continue
    }
    const key = arg.slice(2)
    const next = argv[i + 1]
    if (!next || next.startsWith("--")) {
      out[key] = true
      continue
    }
    out[key] = next
    i += 1
  }
  return out
}

const CLI = parseCliArgs(process.argv.slice(2))

function resolveProjectBase() {
  const fromFlag = typeof CLI.project === "string" ? CLI.project.trim() : ""
  const fromEnv = (process.env.TRADING_WIKI_PROJECT || "").trim()
  if (fromFlag) return path.resolve(fromFlag)
  if (fromEnv) return path.resolve(fromEnv)
  if (fs.existsSync(IN_REPO_WORKSPACE)) return IN_REPO_WORKSPACE
  throw new Error(
    "未找到项目路径。请传 --project <path>，或设置 TRADING_WIKI_PROJECT，或准备仓库内 zTradingData/小张的交易复盘",
  )
}

const BASE = resolveProjectBase()
const REPORT_DIR = path.join(BASE, "raw/sources/研报")
const CACHE_DIR = path.join(REPORT_DIR, ".cache")
const OUT_DIR = path.join(BASE, "wiki/sources")

// ── 读取用户真实 LLM 配置（不硬编码 key） ──────────
// 优先级：TRADING_WIKI_LLM_CONFIG / TRADING_WIKI_APP_STATE →
//   OPENAI_API_KEY(+endpoint/model) → 平台默认 app-state.json
function candidateAppStatePaths() {
  const home = os.homedir()
  const envPaths = [
    process.env.TRADING_WIKI_LLM_CONFIG,
    process.env.TRADING_WIKI_APP_STATE,
  ].filter(Boolean)
  const platformPaths = []
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming")
    platformPaths.push(path.join(appData, "com.tradingreviewwiki.app", "app-state.json"))
  } else if (process.platform === "darwin") {
    platformPaths.push(
      path.join(home, "Library", "Application Support", "com.tradingreviewwiki.app", "app-state.json"),
    )
  } else {
    const xdg = process.env.XDG_CONFIG_HOME || path.join(home, ".config")
    platformPaths.push(path.join(xdg, "com.tradingreviewwiki.app", "app-state.json"))
  }
  return [...envPaths, ...platformPaths]
}

function loadLlmConfig() {
  for (const cfgPath of candidateAppStatePaths()) {
    try {
      if (!fs.existsSync(cfgPath)) continue
      const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"))
      const llm = cfg.llmConfig || cfg || {}
      const apiKey = llm.apiKey || process.env.OPENAI_API_KEY || ""
      if (!apiKey && !llm.endpoint) continue
      return {
        apiKey,
        endpoint: llm.endpoint || process.env.OPENAI_BASE_URL || "https://api.deepseek.com",
        model: llm.model || process.env.OPENAI_MODEL || "deepseek-v4-flash",
        source: cfgPath,
      }
    } catch (e) {
      console.error(`读取 LLM 配置失败 (${cfgPath}):`, e.message)
    }
  }
  const envKey = process.env.OPENAI_API_KEY || ""
  if (envKey) {
    return {
      apiKey: envKey,
      endpoint: process.env.OPENAI_BASE_URL || "https://api.deepseek.com",
      model: process.env.OPENAI_MODEL || "deepseek-v4-flash",
      source: "env",
    }
  }
  console.error("未找到 app-state.json / OPENAI_API_KEY，将以空 key 继续（仅 dry-run 可用）")
  return { apiKey: "", endpoint: "https://api.deepseek.com", model: "deepseek-v4-flash", source: "none" }
}
const LLM = loadLlmConfig()

// ── 工具函数 ─────────────────────────────────────────
function pad(n) { return String(n).padStart(2, "0") }
function nowTs() {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }
function cplen(s) { return [...s].length }

// 标题用文件名派生（更可靠，不依赖 LLM）
function cleanTitle(base) {
  let t = base.replace(/\.pdf$/i, "")
  t = t.replace(/^\d{6,8}[-_ ]?/, "") // 去日期前缀 20260612-
  return t.trim() || base.replace(/\.pdf$/i, "")
}

// 从 LLM 正文提取 50-120 字摘要
function makeSummary(body) {
  const lines = body.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"))
  let s = lines.join(" ")
  const arr = [...s]
  if (arr.length > 115) s = arr.slice(0, 115).join("") + "…"
  if (cplen(s) < 50) s = (s + "（详见正文要点）").slice(0, 120)
  return s
}

// ── DeepSeek 调用 ────────────────────────────────────
async function callDeepSeek(fileName, text) {
  const url = (LLM.endpoint.replace(/\/$/, "") + "/v1/chat/completions")
  // IMPORTANT: keep this BYTE-IDENTICAL to buildIngestCommonPrefix() in src/lib/ingest.ts
  // (the literal array, not the function) so GUI and this script share DeepSeek's prefix-cache
  // and cut the miss rate. A cache-guard unit test enforces byte-identity.
  const COMMON_PREFIX = [
    "You are an expert wiki knowledge-base agent for a trading-review system.",
    "You read source documents (research reports, filings, notes) and produce or update",
    "structured wiki pages with YAML frontmatter.",
    "",
    "## Language Rule",
    "- ALWAYS match the language of the source document. If the source is in Chinese, write in Chinese. If in English, write in English. Wiki page titles, content, and descriptions should all be in the same language as the source material.",
    "",
    "## Global output conventions",
    "- Output FILE blocks exactly as: `---FILE: <path>---` ... content ... `---END FILE---`.",
    "- Never wrap frontmatter in a ```yaml fenced block — emit the bare `---` delimiters only.",
    "- Never delete or shorten existing content when updating; you MAY add or refine.",
    "- Use [[wikilink]] syntax (e.g. `[[type/name]]`) for cross-references.",
    "- Be concrete and exhaustive; never silently drop pages the source implies.",
    "- Preserve all delimiter markers exactly; do not add commentary outside FILE/REVIEW blocks.",
    "",
    "## Frontmatter schema (Schema v1) — reference",
    "Every page MUST begin with YAML frontmatter delimited by `---` (bare, never fenced).",
    "",
    "Required fields:",
    "- `schema_version: 1`",
    "- `title` — human-readable page title (matches the file name without `.md`).",
    "- `type` — one of: 股票 / 概念 / 策略 / 模式 / 错误 / 人物 / 总结 / 查询 / 源文档.",
    "- `summary` — 50–120 字高度概括，便于检索召回，严禁照搬正文段落。",
    "- `created`, `updated`, `last_reviewed` — format `YYYY-MM-DD HH:mm:ss`.",
    "- `confidence` — one of: 高 / 中 / 低.",
    "- `status` — one of: 活跃 / 观察 / 归档 / 废弃.",
    "- `sources` — array of source file names (without `.md`) this page derives from.",
    "",
    "## Directory mapping (stable)",
    "- 股票 → wiki/股票/ , 概念 → wiki/概念/ , 策略 → wiki/策略/ , 模式 → wiki/模式/.",
    "- 错误 → wiki/错误/ , 人物 → wiki/人物/ , 总结 → wiki/总结/ , 市场环境 → wiki/市场环境/ , 进化 → wiki/进化/.",
    "- Use Chinese directory names; never use English equivalents (e.g. wiki/股票/, not wiki/stocks/).",
    "- Filenames: kebab-case for ASCII; preserve original Chinese names for CJK titles.",
  ].join("\n")
  const sys = [
    COMMON_PREFIX,
    "",
    "你是一名资深证券研究员，正在为交易复盘知识库提炼一份研报摘要页（type=源文档）。",
    "请阅读用户提供的研报原文（可能含英文），用简体中文输出。",
    "只输出一个 FILE 块，路径固定为 `---FILE: wiki/源文档/<研报文件名>.md---`，块内包含 YAML frontmatter 与正文：",
    "- frontmatter 需含 schema_version:1、title、type: 源文档、summary（50–120字概括）、created/updated/last_reviewed（格式 YYYY-MM-DD HH:mm:ss）、confidence、status、sources。",
    "- 正文用 markdown 结构化要点，建议结构：## 核心观点 / ## 关键数据与事实 / ## 受益方向或标的 / ## 催化剂与时间线 / ## 风险与分歧 / ## 原文要点摘录。",
    "保持客观，对不确定的地方明确标注。不要输出 frontmatter 以外的额外说明文字。",
  ].join("\n")

  const user = `研报文件名：${fileName}\n\n以下是研报原文（已提取文本，可能不完整）：\n\n${text}`

  let lastErr = null
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${LLM.apiKey}` },
        body: JSON.stringify({
          model: LLM.model,
          messages: [
            { role: "system", content: sys },
            { role: "user", content: user },
          ],
          temperature: 0.3,
          max_tokens: 1800,
        }),
      })
      if (!resp.ok) {
        const txt = await resp.text()
        throw new Error(`HTTP ${resp.status}: ${txt.slice(0, 200)}`)
      }
      const data = await resp.json()
      const choice = data.choices && data.choices[0]
      const content = (choice && (choice.message.content || choice.message.reasoning_content)) || ""
      if (!content.trim()) throw new Error("LLM 返回空内容")
      return content
    } catch (e) {
      lastErr = e
      console.warn(`  [retry ${attempt}/3] ${e.message}`)
      await sleep(3000 * attempt)
    }
  }
  throw lastErr || new Error("unknown LLM error")
}

// ── 取研报文本（cache 优先，否则 pdftotext） ──────
async function getSourceText(name, pdfPath) {
  const cachePath = path.join(CACHE_DIR, name + ".txt") // name 含 .pdf
  if (fs.existsSync(cachePath)) {
    const t = fs.readFileSync(cachePath, "utf8")
    if (t.trim()) return { text: t, from: "cache" }
  }
  // 用系统 pdftotext 实时提取
  try {
    const out = execFileSync("pdftotext", [pdfPath, "-"], {
      encoding: "utf8",
      maxBuffer: 30 * 1024 * 1024,
    })
    if (out && out.trim()) {
      try {
        fs.mkdirSync(CACHE_DIR, { recursive: true })
        fs.writeFileSync(cachePath, out, "utf8") // 写回 .cache 对齐 GUI
      } catch (e) { /* 写 cache 失败不致命 */ }
      return { text: out, from: "pdftotext" }
    }
  } catch (e) {
    console.warn(`  [pdftotext 失败] ${name}: ${e.message.split("\n")[0]}`)
  }
  return { text: null, from: "none" }
}

// ── 单份 ingest ──────────────────────────────────────
async function ingestOne(pdfPath, force) {
  const base = path.basename(pdfPath)            // e.g. 0710 The Flow Show.pdf
  const nameNoExt = base.replace(/\.pdf$/i, "")   // 0710 The Flow Show
  const outPath = path.join(OUT_DIR, nameNoExt + ".md")

  if (fs.existsSync(outPath) && !force) {
    console.log(`  [skip] 已存在: ${nameNoExt}.md`)
    return "skip"
  }

  const { text, from } = await getSourceText(base, pdfPath)
  if (!text) {
    console.log(`  [skip] 无文本（pdftotext 不可用或提取失败）: ${base}`)
    return "no-text"
  }

  const truncated = text.length > 14000 ? text.slice(0, 14000) + "\n\n[...文本已截断...]" : text

  console.log(`  [LLM] 生成中 (来源=${from}) ...`)
  const raw = await callDeepSeek(base, truncated)

  // 移除 LLM 可能输出的占位标题行，title 用文件名派生
  const m = raw.match(/^#\s+.+?\s*$/m)
  const body = (m ? raw.replace(/^#\s+.+?$/m, "").trim() : raw).trim()
  const title = cleanTitle(base)
  const summary = makeSummary(body)
  const ts = nowTs()

  const front =
`---
schema_version: 1
title: ${title}
type: 源文档
summary: ${summary}
confidence: 低
status: 观察
created: ${ts}
updated: ${ts}
last_reviewed: ${ts}
sources: ["研报/${base}"]
related: []
---

> 本页由独立 ingest 脚本基于研报原文自动生成，未经人工复核。confidence=低、status=观察，请在 GUI 中进一步核实。

${body}
`

  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(outPath, front, "utf8")
  console.log(`  [ok] 写出: wiki/sources/${nameNoExt}.md`)
  return "ok"
}

// ── 并发池 ──────────────────────────────────────
async function runPool(items, worker, concurrency) {
  let idx = 0
  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (idx < items.length) {
        const i = idx++
        await worker(items[i], i)
      }
    },
  )
  await Promise.all(runners)
}

// ── 主流程 ──────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2)
  const limit = (() => { const i = args.indexOf("--limit"); return i >= 0 ? parseInt(args[i + 1], 10) : Infinity })()
  const dryRun = args.includes("--dry-run")
  const force = args.includes("--force")

  if (!fs.existsSync(REPORT_DIR)) { console.error("研报目录不存在:", REPORT_DIR); process.exit(1) }
  if (!LLM.apiKey) { console.error("未找到 LLM apiKey，请先在 GUI 配置或在 app-state.json 检查"); process.exit(1) }

  const pdfs = fs.readdirSync(REPORT_DIR)
    .filter((f) => f.toLowerCase().endsWith(".pdf"))
    .map((f) => path.join(REPORT_DIR, f))
    .slice(0, limit)

  console.log(`== 独立研报 ingest ==`)
  console.log(`模型: ${LLM.model} @ ${LLM.endpoint}`)
  console.log(`研报目录: ${REPORT_DIR}`)
  console.log(`待处理: ${pdfs.length} 份${limit !== Infinity ? ` (limit=${limit})` : ""}${dryRun ? " [dry-run]" : ""}${force ? " [force]" : ""}`)
  console.log(`文本提取: .cache 优先，否则 pdftotext`)
  console.log("")

  if (dryRun) {
    pdfs.forEach((p, i) => console.log(`  ${i + 1}. ${path.basename(p)}`))
    return
  }

  const concurrency = (() => {
    const i = args.indexOf("--concurrency")
    return i >= 0 ? Math.max(1, parseInt(args[i + 1], 10)) : 1
  })()
  let ok = 0, skip = 0, fail = 0
  await runPool(pdfs, async (p, i) => {
    process.stdout.write(`[${i + 1}/${pdfs.length}] ${path.basename(p)}\n`)
    try {
      const r = await ingestOne(p, force)
      if (r === "ok") ok++
      else if (r === "skip") skip++
      else fail++
    } catch (e) {
      fail++
      console.error(`  [ERROR] ${path.basename(p)}: ${e.message}`)
    }
    await sleep(800)
  }, concurrency)

  console.log("")
  console.log(`== 完成 == ok=${ok} skip=${skip} fail=${fail}`)
  const existing = fs.existsSync(OUT_DIR) ? fs.readdirSync(OUT_DIR).filter((f) => f.endsWith(".md")).length : 0
  console.log(`wiki/sources 现有文件: ${existing}`)
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1) })
