import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import {
  DEFAULT_PROJECT_PATH,
  COMPANY_TAVILY_KEYCHAIN_ACCOUNT,
  COMPANY_TAVILY_KEYCHAIN_SERVICE,
  ensureDirectory,
  exists,
  normalizePath,
  nowLocalTimestamp,
  parsePositiveInteger,
  projectRelative,
  readIfExists,
  requestCodexExecText,
  requestResponsesText,
  safeErrorMessage,
  sanitizeArtifactName,
  toPosixPath,
  writeJson,
} from "./core.mjs"
import {
  buildAskRetrievalContext,
  formatAskEvidenceSection,
  formatAskMarketValidationSection,
  formatAskNativeQueriesSection,
  formatAskSourceRoutingSection,
} from "./ask-flow.mjs"
import { apiRunIngest, applyManifest } from "./ingest.mjs"
import { fetchJsonWithTimeout, readCompanySecretFromKeychain } from "./data-source.mjs"
import { writeDeepResearchCompound } from "./compound-feedback.mjs"

export const DEEP_RESEARCH_ROOT = ".llm-wiki/deep-research"
export const DEEP_RESEARCH_SCHEMA = "deep-research-run-v1"

const FORBIDDEN_FILENAME_CHARS = /[\\/:*?"<>|]/g
const GARBAGE_TITLE_PATTERNS = [
  /^好的[，,]?\s*以下/,
  /^好的[，,]?\s*这是/,
  /^<think(?:ing)?>/i,
  /^```/,
  /^Save to Wiki/i,
  /^Saved Query$/,
]

export function validateDeepResearchTopic(topic) {
  const t = String(topic ?? "").trim()
  if (!t) return { ok: false, reason: "topic is empty" }
  if (t === "filename") return { ok: false, reason: "topic is the reserved word filename" }
  if (t.length < 2) return { ok: false, reason: `topic is too short (${t.length} chars)` }
  if (t.length > 200) return { ok: false, reason: `topic is too long (${t.length} chars, >200)` }
  for (const pattern of GARBAGE_TITLE_PATTERNS) {
    if (pattern.test(t)) return { ok: false, reason: `topic matches garbage title pattern (${pattern.source})` }
  }
  return { ok: true }
}

export function makeDeepResearchSlug(rawTitle) {
  return String(rawTitle ?? "")
    .replace(FORBIDDEN_FILENAME_CHARS, "")
    .replace(/[\u0000-\u001f\u007f\u200b-\u200d\ufeff]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
}

export function validateDeepResearchSlug(slug) {
  const value = String(slug ?? "")
  if (!value) return { ok: false, reason: "generated filename is empty" }
  if (value.length < 2) return { ok: false, reason: `generated filename is too short (${value})` }
  return { ok: true }
}

export function parseDeepResearchQueries(value, fallbackTopic) {
  const explicit = Array.isArray(value)
    ? value
    : String(value ?? "")
      .split(/[\n|,，]+/)
      .map((item) => item.trim())
      .filter(Boolean)
  const queries = explicit.length > 0 ? explicit : [String(fallbackTopic ?? "").trim()]
  return [...new Set(queries.filter(Boolean))]
}

export function resolveDeepResearchTavilyCredential(options = {}, env = process.env) {
  const optionValue = options.tavilyApiKey
  const envValue = env.TAVILY_API_KEY
  const secretValue = optionValue || envValue || options.tavilyClient
    ? null
    : readCompanySecretFromKeychain({
        service: options.tavilyKeychainService ?? env.TRADING_WIKI_TAVILY_KEYCHAIN_SERVICE ?? COMPANY_TAVILY_KEYCHAIN_SERVICE,
        account: options.tavilyKeychainAccount ?? env.TRADING_WIKI_TAVILY_KEYCHAIN_ACCOUNT ?? COMPANY_TAVILY_KEYCHAIN_ACCOUNT,
        env,
        options,
      })
  const apiKey = optionValue ?? envValue ?? secretValue
  return {
    apiKey,
    auth: optionValue || envValue ? "env_or_option" : secretValue ? "keychain" : options.tavilyClient ? "custom_client" : "missing",
  }
}

export function deepResearchDate(generatedAt) {
  const text = String(generatedAt ?? "")
  const match = text.match(/\d{4}-\d{2}-\d{2}/)
  if (match) return match[0]
  return new Date().toISOString().slice(0, 10)
}

export function deepResearchRunId(topic, generatedAt) {
  const stamp = String(generatedAt ?? nowLocalTimestamp()).replace(/[-: T]/g, "").slice(0, 14)
  const slug = sanitizeArtifactName(makeDeepResearchSlug(topic) || topic).slice(0, 72)
  return `${stamp}-${slug || "deep-research"}`
}

export async function tavilyDeepResearchSearch({ query, apiKey, maxResults = 5, timeoutMs }) {
  if (!apiKey) throw new Error("Tavily API key is not configured")
  return fetchJsonWithTimeout("https://api.tavily.com/search", {
    timeoutMs,
    fetchOptions: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: maxResults,
        search_depth: "advanced",
        include_answer: false,
      }),
    },
  })
}

export function normalizeDeepResearchWebResults(query, response) {
  const results = Array.isArray(response?.results) ? response.results : []
  return results.map((item, index) => {
    const url = String(item.url ?? "")
    let source = ""
    try {
      source = url ? new URL(url).hostname.replace(/^www\./, "") : ""
    } catch {
      source = ""
    }
    return {
      query,
      rank: index + 1,
      title: String(item.title ?? "Untitled"),
      url,
      snippet: String(item.content ?? item.snippet ?? ""),
      source,
      score: typeof item.score === "number" ? item.score : null,
      publishedDate: item.published_date ?? item.publishedDate ?? null,
    }
  })
}

export async function collectDeepResearchWebEvidence(options = {}) {
  const topic = String(options.topic ?? "").trim()
  const queries = parseDeepResearchQueries(options.queries ?? options.searchQueries, topic)
  const maxResults = Math.min(parsePositiveInteger(options.maxResults, 5), 20)
  const credentials = resolveDeepResearchTavilyCredential({
    tavilyApiKey: options.tavilyApiKey,
    tavilyKeychainService: options.tavilyKeychainService,
    tavilyKeychainAccount: options.tavilyKeychainAccount,
    tavilyClient: options.tavilyClient,
  }, options.env ?? process.env)
  const apiKey = credentials.apiKey
  const client = options.tavilyClient ?? tavilyDeepResearchSearch
  if (!apiKey && !options.tavilyClient) {
    throw new Error("Tavily API key is not configured. Pass --tavily-api-key, set TAVILY_API_KEY, or configure the trading-wiki Tavily keychain item.")
  }

  const summaries = []
  const results = []
  const seenUrls = new Set()
  for (const query of queries) {
    try {
      const response = await client({
        query,
        apiKey,
        maxResults,
        timeoutMs: options.tavilyTimeoutMs,
      })
      const normalized = normalizeDeepResearchWebResults(query, response)
      let added = 0
      for (const item of normalized) {
        const dedupeKey = item.url || `${item.query}:${item.rank}:${item.title}`
        if (seenUrls.has(dedupeKey)) continue
        seenUrls.add(dedupeKey)
        results.push(item)
        added++
      }
      summaries.push({ query, status: "success", results: normalized.length, added })
    } catch (err) {
      summaries.push({ query, status: "failed", results: 0, added: 0, error: safeErrorMessage(err) })
    }
  }
  return {
    status: results.length > 0 ? "success" : "partial",
    auth: credentials.auth,
    queries: summaries,
    results,
    error: results.length > 0 ? null : "No Tavily results returned",
  }
}

export function cleanDeepResearchSynthesis(text) {
  return String(text ?? "")
    .replace(/<think(?:ing)?>\s*[\s\S]*?<\/think(?:ing)?>\s*/gi, "")
    .replace(/<think(?:ing)?>\s*[\s\S]*$/gi, "")
    .trimStart()
}

export function compactDeepResearchContext(context) {
  const collect = (items = []) => items.map((item) => ({
    ref: item.ref,
    path: item.path,
    title: item.title,
    type: item.type,
    sourceId: item.sourceId,
    score: item.score,
  }))
  return {
    counts: context.counts,
    selectedSources: (context.selectedSources ?? []).map((source) => ({
      id: source.id,
      available: source.available,
      nativeLanguage: source.nativeLanguage,
      routeReason: source.routeReason,
      unavailableReason: source.unavailableReason,
    })),
    nativeQueries: context.nativeQueries,
    retrievalWarnings: context.retrievalWarnings,
    navigation: collect(context.navigation),
    wiki: collect(context.wikiResults),
    raw: collect(context.rawResults),
    graph: collect(context.graphExpansions),
    facts: collect(context.factsResults),
    invalidatedFacts: collect(context.invalidatedFactsResults),
    brain: collect(context.brainResults),
    stockDaily: collect(context.stockDailyResults),
  }
}

export function formatDeepResearchLocalContext(context) {
  const sections = [
    formatAskSourceRoutingSection(context),
    formatAskNativeQueriesSection(context.nativeQueries ?? []),
  ]
  const evidenceSections = [
    ["Navigation", context.navigation],
    ["Local Wiki Pages", context.wikiResults],
    ["Raw Evidence", context.rawResults],
    ["Graph Expansions", context.graphExpansions],
    ["Temporal Facts", context.factsResults],
    ["Invalidated Historical Facts", context.invalidatedFactsResults],
    ["Brain Memory", context.brainResults],
    ["Stock Daily Evidence", context.stockDailyResults],
  ]
  for (const [title, items] of evidenceSections) {
    if ((items ?? []).length > 0) sections.push(formatAskEvidenceSection(title, items))
  }
  if (context.marketValidation) sections.push(formatAskMarketValidationSection(context.marketValidation))
  return sections.join("\n\n")
}

export function formatDeepResearchWebContext(webResults) {
  if (!webResults.length) return "## Web Search Results\n\n- none"
  const rows = ["## Web Search Results"]
  webResults.forEach((item, index) => {
    rows.push(
      "",
      `### [T${index + 1}] ${item.title}`,
      `- url: ${item.url || "n/a"}`,
      `- source: ${item.source || "unknown"}`,
      `- query: ${item.query}`,
      item.publishedDate ? `- published_date: ${item.publishedDate}` : "",
      "",
      item.snippet || "(no snippet)",
    )
  })
  return rows.filter((line) => line !== "").join("\n")
}

export function deepResearchInstructions() {
  return [
    "You are a research assistant for Trading Review Wiki.",
    "Write a comprehensive wiki-style research page from web evidence plus local knowledge-base context.",
    "",
    "Language rule:",
    "- Match the language of the research topic. If the topic is Chinese, write Chinese.",
    "",
    "Evidence and citation rules:",
    "- Use Tavily/web citations as [T1], [T2], etc.",
    "- Use local wiki/raw/graph/facts/brain citations by their shown refs such as [W1], [R1], [G1], [F1], [M1], [S1].",
    "- Separate confirmed facts from inference, contradictions, and missing evidence.",
    "- When an entity or concept already exists in the local wiki context, use [[wikilink]] syntax.",
    "",
    "Writing rules:",
    "- Organize with clear Markdown headings.",
    "- Include a short conclusion first, then evidence, implications, risks, and follow-up sources.",
    "- Do not include hidden chain-of-thought or <think> blocks.",
  ].join("\n")
}

export function buildDeepResearchPrompt({ topic, webResults, askContext, wikiIndex = "" }) {
  return [
    `Research topic: **${topic}**`,
    "",
    formatDeepResearchWebContext(webResults),
    "",
    "## Local Knowledge Base Context",
    "",
    formatDeepResearchLocalContext(askContext),
    wikiIndex.trim()
      ? [
          "",
          "## Existing Wiki Index",
          "",
          "Use these page names for wikilinks when relevant.",
          "",
          wikiIndex.trim(),
        ].join("\n")
      : "",
    "",
    "Synthesize into a publishable wiki page.",
  ].filter(Boolean).join("\n")
}

async function requestDeepResearchSynthesis(options) {
  if (options.requestText) {
    return options.requestText({
      stage: "deep-research",
      role: "synthesizer",
      prompt: options.prompt,
      instructions: options.instructions,
      context: options.context,
      provider: options.provider ?? "codex",
      model: options.model,
    })
  }

  const provider = options.provider ?? "codex"
  if (provider === "codex") {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "trading-wiki-deep-research-"))
    const outputPath = path.join(tmpDir, "draft.md")
    try {
      return await requestCodexExecText({
        stage: "deep-research",
        prompt: options.prompt,
        instructions: options.instructions,
        model: options.model,
        prepared: { projectPath: options.projectPath },
        outputPath,
        codexBin: options.codexBin,
        codexProfile: options.codexProfile,
        codexProfileV2: options.codexProfileV2,
        codexTimeoutMs: options.codexTimeoutMs,
      })
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    }
  }
  if (provider === "openai") {
    const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY
    const model = options.model ?? process.env.OPENAI_MODEL
    if (!apiKey) throw new Error("Missing OpenAI API key. Pass --api-key or set OPENAI_API_KEY, or use --provider codex.")
    if (!model) throw new Error("Missing model. Pass --model or set OPENAI_MODEL.")
    return requestResponsesText({
      apiKey,
      endpoint: options.endpoint,
      model,
      prompt: options.prompt,
      instructions: options.instructions,
      reasoningEffort: options.reasoningEffort ?? "medium",
      timeoutMs: options.agentTimeoutMs ?? options.codexTimeoutMs,
    })
  }
  throw new Error(`Unsupported deep-research provider: ${provider}`)
}

async function allocateDeepResearchWikiPath(projectPath, topic, generatedAt) {
  const topicCheck = validateDeepResearchTopic(topic)
  if (!topicCheck.ok) throw new Error(`Invalid deep-research topic: ${topicCheck.reason}`)
  const slug = makeDeepResearchSlug(topic)
  const slugCheck = validateDeepResearchSlug(slug)
  if (!slugCheck.ok) throw new Error(`Invalid deep-research filename: ${slugCheck.reason}`)

  const date = deepResearchDate(generatedAt)
  const queriesDir = path.join(projectPath, "wiki", "queries")
  await ensureDirectory(queriesDir)
  const baseFileName = `research-${slug}-${date}.md`
  for (let i = 0; i < 100; i++) {
    const fileName = i === 0 ? baseFileName : `${baseFileName.replace(/\.md$/, "")}-${i}.md`
    const absolutePath = path.join(queriesDir, fileName)
    if (!(await exists(absolutePath))) {
      return {
        absolutePath,
        relativePath: toPosixPath(path.join("wiki", "queries", fileName)),
        date,
      }
    }
  }
  throw new Error(`Unable to allocate unique deep-research wiki path for ${topic}`)
}

export function renderDeepResearchWikiPage({ topic, draftContent, webResults, date }) {
  const references = webResults
    .map((item, index) => `${index + 1}. [${item.title}](${item.url}) - ${item.source || "unknown"}`)
    .join("\n")
  return [
    "---",
    "type: query",
    `title: ${JSON.stringify(`Research: ${topic}`)}`,
    `created: ${date}`,
    "origin: deep-research",
    "tags: [research]",
    "---",
    "",
    `# Research: ${topic}`,
    "",
    draftContent,
    "",
    "## References",
    "",
    references,
    "",
  ].join("\n")
}

export async function runDeepResearch(options = {}) {
  const topic = String(options.topic ?? options.query ?? "").trim()
  const topicCheck = validateDeepResearchTopic(topic)
  if (!topicCheck.ok) throw new Error(`Invalid deep-research topic: ${topicCheck.reason}`)
  if (options.showContext && (options.write || options.ingest || options.applyIngest)) {
    throw new Error("deep-research --show-context cannot be combined with --write, --ingest, or --apply-ingest.")
  }
  if (options.applyIngest && !options.ingest) {
    throw new Error("deep-research --apply-ingest requires --ingest.")
  }

  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const generatedAt = options.generatedAt ?? nowLocalTimestamp()
  const runId = options.runId ?? deepResearchRunId(topic, generatedAt)
  const outputDir = path.join(projectPath, DEEP_RESEARCH_ROOT, runId)
  await ensureDirectory(outputDir)

  options.onProgress?.("[deep-research] tavily search started")
  const webEvidence = await collectDeepResearchWebEvidence({ ...options, topic })
  const webResults = webEvidence.results
  options.onProgress?.(`[deep-research] tavily search ${webEvidence.status} (results=${webResults.length})`)

  options.onProgress?.("[deep-research] local wiki retrieval started")
  const askContext = await buildAskRetrievalContext({
    ...options,
    query: topic,
    projectPath,
    provider: options.provider ?? "codex",
    sourceK: options.sourceK,
    sources: options.sources,
    graphDepth: options.graphDepth,
    graphNeighbors: options.graphNeighbors,
    topBrain: options.topBrain,
    sqlLimit: options.sqlLimit,
    includeInvalidated: Boolean(options.includeInvalidated),
  })
  options.onProgress?.(`[deep-research] local wiki retrieval done (wiki=${askContext.counts.wikiMatches}, raw=${askContext.counts.rawMatches}, graph=${askContext.counts.graphMatches})`)

  const wikiIndex = (await readIfExists(path.join(projectPath, "wiki", "index.md"))).slice(0, parsePositiveInteger(options.maxWikiIndexChars, 15000))
  const prompt = buildDeepResearchPrompt({ topic, webResults, askContext, wikiIndex })
  const instructions = deepResearchInstructions()
  const promptPath = path.join(outputDir, "prompt.md")
  await fs.writeFile(promptPath, [instructions, "", prompt].join("\n\n"), "utf8")

  let rawSynthesis
  if (webResults.length === 0) {
    rawSynthesis = "No web results found."
  } else if (options.showContext) {
    rawSynthesis = ""
  } else {
    options.onProgress?.("[deep-research] synthesis started")
    rawSynthesis = await requestDeepResearchSynthesis({
      ...options,
      projectPath,
      prompt,
      instructions,
      context: { projectPath, topic, askContext: compactDeepResearchContext(askContext), web: webEvidence },
    })
    options.onProgress?.("[deep-research] synthesis done")
  }
  const draftContent = cleanDeepResearchSynthesis(rawSynthesis)

  const draftPath = path.join(outputDir, "draft.md")
  const webResultsPath = path.join(outputDir, "web-results.json")
  const localContextPath = path.join(outputDir, "local-context.json")
  if (!options.showContext) await fs.writeFile(draftPath, draftContent, "utf8")
  await writeJson(webResultsPath, webEvidence)
  await writeJson(localContextPath, compactDeepResearchContext(askContext))

  let saved = null
  if (options.write) {
    const allocated = await allocateDeepResearchWikiPath(projectPath, topic, generatedAt)
    const pageContent = renderDeepResearchWikiPage({
      topic,
      draftContent,
      webResults,
      date: allocated.date,
    })
    await fs.writeFile(allocated.absolutePath, pageContent, "utf8")
    saved = {
      path: allocated.relativePath,
      absolutePath: allocated.absolutePath,
    }
  }

  if (options.ingest && !saved) {
    throw new Error("deep-research --ingest requires --write so the saved wiki/queries page can be used as the ingest source.")
  }

  let ingest = null
  if (options.ingest) {
    options.onProgress?.("[deep-research] staged ingest started")
    const ingestResult = await apiRunIngest({
      sourcePath: saved.absolutePath,
      projectPath,
      provider: options.ingestProvider ?? options.provider ?? "codex",
      model: options.ingestModel ?? options.model,
      apiKey: options.ingestApiKey ?? options.apiKey,
      endpoint: options.ingestEndpoint ?? options.endpoint,
      reasoningEffort: options.ingestReasoningEffort ?? options.reasoningEffort,
      codexBin: options.codexBin,
      codexProfile: options.codexProfile,
      codexProfileV2: options.codexProfileV2,
      codexTimeoutMs: options.ingestTimeoutMs ?? options.codexTimeoutMs,
      pageConcurrency: options.pageConcurrency,
      maxPlanItems: options.maxPlanItems,
      maxCreatePages: options.maxCreatePages,
      maxUpdatePages: options.maxUpdatePages,
      sourceSharding: options.sourceSharding,
      shardConcurrency: options.shardConcurrency,
      maxShardChars: options.maxShardChars,
      onProgress: options.onProgress,
    })
    ingest = {
      reportDir: projectRelative(projectPath, ingestResult.reportDir),
      analysisPath: projectRelative(projectPath, ingestResult.analysisPath),
      planJsonPath: projectRelative(projectPath, ingestResult.planJsonPath),
      filesDir: projectRelative(projectPath, ingestResult.filesDir),
      manifestPath: projectRelative(projectPath, ingestResult.manifestPath),
      dryRunReport: ingestResult.dryRunReport?.reportPath ? projectRelative(projectPath, ingestResult.dryRunReport.reportPath) : null,
      applied: null,
    }
    if (options.applyIngest) {
      const applied = await applyManifest({
        manifestPath: ingestResult.manifestPath,
        projectPath,
        write: Boolean(options.write),
        allowSourceChange: Boolean(options.allowSourceChange),
      })
      ingest.applied = {
        reportPath: projectRelative(projectPath, applied.reportPath),
        dryRun: applied.dryRun,
        files: applied.diffs.map((item) => item.path),
        fatalIssues: applied.fatalIssues,
      }
    }
    options.onProgress?.("[deep-research] staged ingest done")
  }

  const manifest = {
    schema: DEEP_RESEARCH_SCHEMA,
    mode: "deep-research",
    generatedAt,
    projectPath,
    topic,
    runId,
    outputDir: projectRelative(projectPath, outputDir),
    web: {
      status: webEvidence.status,
      auth: webEvidence.auth,
      queryCount: webEvidence.queries.length,
      resultCount: webResults.length,
      queries: webEvidence.queries,
      error: webEvidence.error,
    },
    localContext: compactDeepResearchContext(askContext),
    outputs: {
      prompt: projectRelative(projectPath, promptPath),
      draft: options.showContext ? null : projectRelative(projectPath, draftPath),
      webResults: projectRelative(projectPath, webResultsPath),
      localContext: projectRelative(projectPath, localContextPath),
      savedPath: saved?.path ?? null,
      ingest,
    },
    writePolicy: {
      wroteArtifacts: true,
      wroteWikiQuery: Boolean(saved),
      stagedIngest: Boolean(ingest),
      appliedIngest: Boolean(ingest?.applied && !ingest.applied.dryRun),
      wroteRaw: false,
    },
  }
  const manifestPath = path.join(outputDir, "manifest.json")
  await writeJson(manifestPath, manifest)

  // E10 复利回灌：深度话题研究结论 → wiki/总结/
  let compoundPath = null
  try {
    compoundPath = await writeDeepResearchCompound({
      projectPath,
      generatedAt,
      topic,
      answerSnippet: draftContent?.slice(0, 2000) ?? "",
    })
    manifest.writePolicy.wroteFormalWiki = true
    manifest.writePolicy.compoundPath = compoundPath
  } catch (_) {
    // 复利回灌失败不阻断主流程
  }

  return {
    ...manifest,
    outputs: {
      ...manifest.outputs,
      manifest: projectRelative(projectPath, manifestPath),
    },
    draftContent,
  }
}
