import fs from "node:fs/promises"
import path from "node:path"
import {
  listFilesRecursive,
  normalizePath,
  nowLocalTimestamp,
  projectRelative,
  shortHash,
  writeJson,
} from "./core.mjs"
import { parseFrontmatter } from "./knowledge.mjs"
import { readCompanySecretFromKeychain } from "./data-source.mjs"

// Embedding 路由层:为 wiki 正式页建向量索引,摄入时把逐段语义命中合并进候选页,
// 提升 claim/segment 到页面的路由准度。索引只读 wiki 页面、只写 .llm-wiki/embeddings/**,
// 缺索引或缺 API key 时调用方应降级为纯词法候选,不得阻断摄入。

export const EMBEDDING_INDEX_RELATIVE_PATH = ".llm-wiki/embeddings/wiki-pages.json"
export const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small"
export const DEFAULT_EMBEDDING_ENDPOINT = "https://api.openai.com/v1/embeddings"
export const EMBEDDING_PAGE_DIRS = ["wiki/概念", "wiki/股票", "wiki/模式", "wiki/错误", "wiki/策略", "wiki/人物"]
export const DEFAULT_EMBEDDING_BATCH_SIZE = 96

export const EMBEDDING_KEYCHAIN_SERVICE = "trading-wiki-openai-api"
export const EMBEDDING_KEYCHAIN_ACCOUNT = "api-key"

export function resolveEmbeddingConfig(options = {}) {
  return {
    apiKey: options.embeddingApiKey
      ?? options.apiKey
      ?? process.env.OPENAI_API_KEY
      ?? readCompanySecretFromKeychain({ service: EMBEDDING_KEYCHAIN_SERVICE, account: EMBEDDING_KEYCHAIN_ACCOUNT, options })
      ?? null,
    endpoint: options.embeddingEndpoint ?? DEFAULT_EMBEDDING_ENDPOINT,
    model: options.embeddingModel ?? DEFAULT_EMBEDDING_MODEL,
    batchSize: Number(options.embeddingBatchSize) > 0 ? Number(options.embeddingBatchSize) : DEFAULT_EMBEDDING_BATCH_SIZE,
    timeoutMs: Number(options.embeddingTimeoutMs) > 0 ? Number(options.embeddingTimeoutMs) : 60000,
  }
}

export async function requestEmbeddings({ inputs, apiKey, endpoint, model, timeoutMs = 60000 }) {
  if (!Array.isArray(inputs) || inputs.length === 0) return []
  if (!apiKey) throw new Error("Missing embedding API key. Pass --embedding-api-key or set OPENAI_API_KEY.")
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(endpoint ?? DEFAULT_EMBEDDING_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: model ?? DEFAULT_EMBEDDING_MODEL, input: inputs }),
      signal: controller.signal,
    })
    if (!response.ok) {
      const body = await response.text().catch(() => "")
      throw new Error(`Embedding request failed: ${response.status} ${body.slice(0, 300)}`)
    }
    const parsed = await response.json()
    const rows = Array.isArray(parsed?.data) ? [...parsed.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0)) : []
    if (rows.length !== inputs.length) throw new Error(`Embedding response size mismatch: expected ${inputs.length}, got ${rows.length}`)
    return rows.map((row) => row.embedding)
  } finally {
    clearTimeout(timer)
  }
}

export function roundVector(vector, decimals = 5) {
  const factor = 10 ** decimals
  return vector.map((value) => Math.round(value * factor) / factor)
}

export function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) return 0
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

export function embeddingPageText({ relativePath, fm, body }) {
  const title = typeof fm.title === "string" && fm.title.trim() ? fm.title.trim() : path.basename(relativePath, ".md")
  const aliases = Array.isArray(fm.aliases) ? fm.aliases.join(" ") : ""
  const tags = Array.isArray(fm.tags) ? fm.tags.join(" ") : ""
  const summary = typeof fm.summary === "string" ? fm.summary : ""
  const headings = String(body ?? "")
    .split(/\r?\n/)
    .filter((line) => /^##\s+\S/.test(line))
    .map((line) => line.replace(/^##\s+/, ""))
    .slice(0, 12)
    .join(" / ")
  return [title, aliases, tags, summary, headings].filter(Boolean).join("\n").slice(0, 2000)
}

export async function collectEmbeddingPages(projectPath) {
  const pp = normalizePath(projectPath)
  const pages = []
  for (const dir of EMBEDDING_PAGE_DIRS) {
    const files = await listFilesRecursive(path.join(pp, dir), { extensions: new Set([".md"]) }).catch(() => [])
    for (const filePath of files.sort()) {
      try {
        const content = await fs.readFile(filePath, "utf8")
        const { fm, body } = parseFrontmatter(content)
        const relativePath = projectRelative(pp, filePath)
        const text = embeddingPageText({ relativePath, fm, body })
        pages.push({
          path: relativePath,
          title: typeof fm.title === "string" && fm.title.trim() ? fm.title.trim() : path.basename(relativePath, ".md"),
          type: typeof fm.type === "string" ? fm.type : null,
          entityKey: typeof fm.entity_key === "string" ? fm.entity_key : null,
          textHash: shortHash(text),
          text,
        })
      } catch {}
    }
  }
  return pages
}

export async function loadWikiEmbeddingIndex(projectPath) {
  try {
    const raw = await fs.readFile(path.join(normalizePath(projectPath), EMBEDDING_INDEX_RELATIVE_PATH), "utf8")
    const parsed = JSON.parse(raw)
    return parsed && Array.isArray(parsed.pages) ? parsed : null
  } catch {
    return null
  }
}

export async function buildWikiEmbeddingIndex({ projectPath, config, requestEmbeddingsImpl, onProgress }) {
  const pp = normalizePath(projectPath)
  const embed = requestEmbeddingsImpl ?? requestEmbeddings
  const pages = await collectEmbeddingPages(pp)
  const existing = await loadWikiEmbeddingIndex(pp)
  const existingByPath = new Map((existing?.pages ?? []).map((page) => [page.path, page]))
  const sameModel = existing?.model === config.model

  const results = []
  const pending = []
  for (const page of pages) {
    const previous = existingByPath.get(page.path)
    if (sameModel && previous && previous.textHash === page.textHash && Array.isArray(previous.vector)) {
      results.push({ ...page, text: undefined, vector: previous.vector })
    } else {
      pending.push(page)
    }
  }

  onProgress?.(`Embedding index: ${pages.length} pages total, ${pending.length} to embed, ${results.length} reused`)
  for (let offset = 0; offset < pending.length; offset += config.batchSize) {
    const batch = pending.slice(offset, offset + config.batchSize)
    const vectors = await embed({
      inputs: batch.map((page) => page.text),
      apiKey: config.apiKey,
      endpoint: config.endpoint,
      model: config.model,
      timeoutMs: config.timeoutMs,
    })
    batch.forEach((page, i) => results.push({ ...page, text: undefined, vector: roundVector(vectors[i]) }))
    onProgress?.(`Embedded ${Math.min(offset + config.batchSize, pending.length)}/${pending.length} pages`)
  }

  const index = {
    version: 1,
    generatedAt: nowLocalTimestamp(),
    model: config.model,
    counts: { pages: results.length, embedded: pending.length, reused: results.length - pending.length },
    pages: results
      .map(({ text, ...page }) => page)
      .sort((a, b) => a.path.localeCompare(b.path)),
  }
  await writeJson(path.join(pp, EMBEDDING_INDEX_RELATIVE_PATH), index)
  return { path: EMBEDDING_INDEX_RELATIVE_PATH, counts: index.counts, model: index.model }
}

export function isEmbeddingIndexedPath(relativePath) {
  return EMBEDDING_PAGE_DIRS.some((dir) => String(relativePath ?? "").startsWith(`${dir}/`))
}

export async function maybeRefreshWikiEmbeddingIndex({ projectPath, options = {}, onProgress }) {
  const existing = await loadWikiEmbeddingIndex(projectPath)
  if (!existing) return { status: "skipped", reason: "index_missing" }
  const config = resolveEmbeddingConfig({ ...options, embeddingModel: options.embeddingModel ?? existing.model })
  if (!config.apiKey && !options.requestEmbeddingsImpl) {
    onProgress?.("Embedding index refresh skipped: missing OPENAI_API_KEY / keychain trading-wiki-openai-api.")
    return { status: "skipped", reason: "missing_api_key" }
  }
  try {
    const result = await buildWikiEmbeddingIndex({ projectPath, config, requestEmbeddingsImpl: options.requestEmbeddingsImpl, onProgress })
    return { status: "refreshed", ...result }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    onProgress?.(`Embedding index refresh failed (apply itself is unaffected): ${reason}`)
    return { status: "failed", reason }
  }
}

export function searchEmbeddingIndex(index, queryVector, { topK = 8, minScore = 0.3 } = {}) {
  if (!index || !Array.isArray(index.pages) || !Array.isArray(queryVector)) return []
  return index.pages
    .map((page) => ({ path: page.path, title: page.title, type: page.type, entityKey: page.entityKey, score: cosineSimilarity(page.vector, queryVector) }))
    .filter((hit) => hit.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
}

export function mergeEmbeddingHitsIntoCandidates(candidates, hits, { scoreScale = 40, maxAdded = 8 } = {}) {
  if (!hits.length) return { added: 0, boosted: 0 }
  const byPath = new Map(candidates.wikiCandidates.map((item) => [item.path, item]))
  let added = 0
  let boosted = 0
  for (const hit of hits) {
    const scaled = Math.round(hit.score * scoreScale)
    const existing = byPath.get(hit.path)
    if (existing) {
      existing.score = (existing.score ?? 0) + scaled
      existing.embeddingScore = Number(hit.score.toFixed(4))
      boosted += 1
      continue
    }
    if (added >= maxAdded) continue
    const candidate = {
      path: hit.path,
      title: hit.title,
      type: hit.type ?? null,
      score: scaled,
      embeddingScore: Number(hit.score.toFixed(4)),
      snippet: `embedding route hit (${hit.score.toFixed(3)})`,
      matchedBy: "embedding",
    }
    candidates.wikiCandidates.push(candidate)
    byPath.set(hit.path, candidate)
    added += 1
  }
  candidates.wikiCandidates.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
  return { added, boosted }
}

export function embeddingQueryTextForSource(sourceContent, sourcePath) {
  const base = path.basename(String(sourcePath ?? ""), path.extname(String(sourcePath ?? "")))
  return `${base}\n${String(sourceContent ?? "").slice(0, 1600)}`
}

export function embeddingQueryTextForSegment(segment) {
  return [segment.title, segment.textPreview].filter(Boolean).join("\n").slice(0, 1600)
}

export async function applyEmbeddingRoutingToCandidates({ projectPath, sourcePath, sourceContent, candidates, options = {}, onProgress }) {
  const summary = { enabled: true, status: "applied", model: null, sourceHits: 0, segmentHits: 0, added: 0, boosted: 0, warnings: [] }
  const index = await loadWikiEmbeddingIndex(projectPath)
  if (!index) {
    summary.status = "skipped"
    summary.warnings.push(`Embedding index missing at ${EMBEDDING_INDEX_RELATIVE_PATH}. Run: npm run codex:ingest -- embeddings build`)
    onProgress?.(summary.warnings[0])
    return summary
  }
  const config = resolveEmbeddingConfig({ ...options, embeddingModel: options.embeddingModel ?? index.model })
  if (!config.apiKey && !options.requestEmbeddingsImpl) {
    summary.status = "skipped"
    summary.warnings.push("Embedding routing skipped: missing OPENAI_API_KEY / --embedding-api-key.")
    onProgress?.(summary.warnings[0])
    return summary
  }
  summary.model = config.model
  const segments = candidates.segments ?? []
  const queries = [embeddingQueryTextForSource(sourceContent, sourcePath), ...segments.map((segment) => embeddingQueryTextForSegment(segment))]
  const embed = options.requestEmbeddingsImpl ?? requestEmbeddings
  let vectors
  try {
    vectors = await embed({ inputs: queries, apiKey: config.apiKey, endpoint: config.endpoint, model: config.model, timeoutMs: config.timeoutMs })
  } catch (err) {
    summary.status = "failed"
    summary.warnings.push(`Embedding routing failed, falling back to lexical candidates: ${err instanceof Error ? err.message : String(err)}`)
    onProgress?.(summary.warnings[0])
    return summary
  }

  const sourceHits = searchEmbeddingIndex(index, vectors[0], { topK: options.embeddingTopK ?? 8 })
  summary.sourceHits = sourceHits.length
  const merged = mergeEmbeddingHitsIntoCandidates(candidates, sourceHits)
  summary.added += merged.added
  summary.boosted += merged.boosted

  segments.forEach((segment, i) => {
    const hits = searchEmbeddingIndex(index, vectors[i + 1], { topK: options.embeddingSegmentTopK ?? 5 })
    summary.segmentHits += hits.length
    segment.wikiCandidates = segment.wikiCandidates ?? []
    const segmentMerge = mergeEmbeddingHitsIntoCandidates({ wikiCandidates: segment.wikiCandidates }, hits, { maxAdded: 4 })
    summary.added += segmentMerge.added
    summary.boosted += segmentMerge.boosted
  })
  onProgress?.(`Embedding routing: model=${config.model}, sourceHits=${summary.sourceHits}, segmentHits=${summary.segmentHits}, added=${summary.added}, boosted=${summary.boosted}`)
  return summary
}
