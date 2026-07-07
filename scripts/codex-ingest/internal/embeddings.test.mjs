import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  EMBEDDING_INDEX_RELATIVE_PATH,
  applyEmbeddingRoutingToCandidates,
  buildWikiEmbeddingIndex,
  cosineSimilarity,
  embeddingPageText,
  loadWikiEmbeddingIndex,
  mergeEmbeddingHitsIntoCandidates,
  resolveEmbeddingConfig,
  searchEmbeddingIndex,
} from "./embeddings.mjs"
import { prepareIngest } from "./ingest.mjs"

function fakeVector(text) {
  return [text.includes("算电") ? 1 : 0, text.includes("机器人") ? 1 : 0, text.includes("光模块") ? 1 : 0.01]
}

function makeFakeEmbedder(calls = []) {
  return async ({ inputs }) => {
    calls.push(inputs.length)
    return inputs.map((text) => fakeVector(String(text)))
  }
}

function page(title, tags, summaryTopic) {
  return [
    "---",
    "schema_version: 1",
    `title: ${title}`,
    "type: 概念",
    `summary: ${summaryTopic}主题页面,用于 embedding 路由测试的合成夹具,摘要长度满足五十字符校验门槛要求。`,
    `tags: [${tags}]`,
    "related: []",
    "sources: []",
    "created: 2026-07-01 09:00:00",
    "updated: 2026-07-01 09:00:00",
    "last_reviewed: 2026-07-01 09:00:00",
    "confidence: 中",
    "status: 活跃",
    "---",
    `# ${title}`,
    "",
    "## 概念定义",
    "内容。",
    "",
  ].join("\n")
}

describe("embedding primitives", () => {
  it("computes cosine similarity and page text", () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1)
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0)
    expect(cosineSimilarity([], [])).toBe(0)
    const text = embeddingPageText({
      relativePath: "wiki/概念/算电协同.md",
      fm: { title: "算电协同", aliases: ["AIDC电力"], tags: ["电力"], summary: "摘要" },
      body: "## 产业链结构\n\n内容\n\n## 风险\n",
    })
    expect(text).toContain("算电协同")
    expect(text).toContain("AIDC电力")
    expect(text).toContain("产业链结构 / 风险")
  })

  it("merges hits by boosting existing candidates and capping additions", () => {
    const candidates = { wikiCandidates: [{ path: "wiki/概念/A.md", title: "A", score: 10, snippet: "s" }] }
    const hits = [
      { path: "wiki/概念/A.md", title: "A", type: "概念", score: 0.9 },
      { path: "wiki/概念/B.md", title: "B", type: "概念", score: 0.8 },
      { path: "wiki/概念/C.md", title: "C", type: "概念", score: 0.7 },
    ]
    const result = mergeEmbeddingHitsIntoCandidates(candidates, hits, { maxAdded: 1 })
    expect(result).toEqual({ added: 1, boosted: 1 })
    expect(candidates.wikiCandidates[0].path).toBe("wiki/概念/A.md")
    expect(candidates.wikiCandidates[0].score).toBe(46)
    expect(candidates.wikiCandidates.map((item) => item.path)).not.toContain("wiki/概念/C.md")
  })
})

describe("embedding index build and routing", () => {
  let tmpRoot
  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "embeddings-"))
    await fs.mkdir(path.join(tmpRoot, "wiki/概念"), { recursive: true })
    await fs.mkdir(path.join(tmpRoot, "raw/研报新闻"), { recursive: true })
    await fs.writeFile(path.join(tmpRoot, "wiki/概念/算电协同.md"), page("算电协同", "电力", "算电"), "utf8")
    await fs.writeFile(path.join(tmpRoot, "wiki/概念/机器人产业链.md"), page("机器人产业链", "机器人", "机器人"), "utf8")
  })
  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true })
  })

  it("builds incrementally, reusing unchanged pages by text hash", async () => {
    const calls = []
    const config = resolveEmbeddingConfig({ embeddingApiKey: "test-key" })
    const first = await buildWikiEmbeddingIndex({ projectPath: tmpRoot, config, requestEmbeddingsImpl: makeFakeEmbedder(calls) })
    expect(first.counts).toMatchObject({ pages: 2, embedded: 2, reused: 0 })

    await fs.writeFile(path.join(tmpRoot, "wiki/概念/机器人产业链.md"), page("机器人产业链", "机器人, 谐波", "机器人"), "utf8")
    const second = await buildWikiEmbeddingIndex({ projectPath: tmpRoot, config, requestEmbeddingsImpl: makeFakeEmbedder(calls) })
    expect(second.counts).toMatchObject({ pages: 2, embedded: 1, reused: 1 })
    expect(calls).toEqual([2, 1])

    const index = await loadWikiEmbeddingIndex(tmpRoot)
    const hits = searchEmbeddingIndex(index, fakeVector("算电"), { topK: 2, minScore: 0.5 })
    expect(hits[0].path).toBe("wiki/概念/算电协同.md")
  })

  it("skips gracefully without an index and merges hits when present", async () => {
    const candidates = { wikiCandidates: [], rawCandidates: [], segments: [{ id: "seg-001", title: "算电主线", textPreview: "算电协同讨论", wikiCandidates: [] }] }
    const skipped = await applyEmbeddingRoutingToCandidates({
      projectPath: tmpRoot,
      sourcePath: "raw/研报新闻/a.md",
      sourceContent: "算电",
      candidates,
      options: { requestEmbeddingsImpl: makeFakeEmbedder() },
    })
    expect(skipped.status).toBe("skipped")
    expect(candidates.wikiCandidates).toEqual([])

    const config = resolveEmbeddingConfig({ embeddingApiKey: "test-key" })
    await buildWikiEmbeddingIndex({ projectPath: tmpRoot, config, requestEmbeddingsImpl: makeFakeEmbedder() })
    const applied = await applyEmbeddingRoutingToCandidates({
      projectPath: tmpRoot,
      sourcePath: "raw/研报新闻/a.md",
      sourceContent: "算电协同新证据",
      candidates,
      options: { requestEmbeddingsImpl: makeFakeEmbedder() },
    })
    expect(applied.status).toBe("applied")
    expect(candidates.wikiCandidates.some((item) => item.path === "wiki/概念/算电协同.md" && item.matchedBy === "embedding")).toBe(true)
    expect(candidates.segments[0].wikiCandidates.some((item) => item.path === "wiki/概念/算电协同.md")).toBe(true)
  })

  it("reports failure and keeps candidates unchanged when the embedder errors", async () => {
    const config = resolveEmbeddingConfig({ embeddingApiKey: "test-key" })
    await buildWikiEmbeddingIndex({ projectPath: tmpRoot, config, requestEmbeddingsImpl: makeFakeEmbedder() })
    const candidates = { wikiCandidates: [], rawCandidates: [], segments: [] }
    const result = await applyEmbeddingRoutingToCandidates({
      projectPath: tmpRoot,
      sourcePath: "raw/研报新闻/a.md",
      sourceContent: "算电",
      candidates,
      options: { requestEmbeddingsImpl: async () => { throw new Error("quota") } },
    })
    expect(result.status).toBe("failed")
    expect(result.warnings[0]).toContain("quota")
    expect(candidates.wikiCandidates).toEqual([])
  })

  it("auto-refreshes the index after apply --write touches indexed pages", async () => {
    const config = resolveEmbeddingConfig({ embeddingApiKey: "test-key" })
    await buildWikiEmbeddingIndex({ projectPath: tmpRoot, config, requestEmbeddingsImpl: makeFakeEmbedder() })

    const { applyManifest } = await import("./ingest.mjs")
    const manifestPath = path.join(tmpRoot, "changes.json")
    await fs.writeFile(manifestPath, JSON.stringify({
      $schema: "codex-ingest-manifest-v1",
      projectPath: tmpRoot,
      writes: [{ action: "create", path: "wiki/概念/光模块升级.md", content: page("光模块升级", "光模块", "光模块") }],
    }), "utf8")

    const calls = []
    const written = await applyManifest({ manifestPath, projectPath: tmpRoot, write: true, requestEmbeddingsImpl: makeFakeEmbedder(calls) })
    expect(written.embeddingIndexRefresh.status).toBe("refreshed")
    expect(written.embeddingIndexRefresh.counts).toMatchObject({ pages: 3, embedded: 1, reused: 2 })
    expect(calls).toEqual([1])
    const index = await loadWikiEmbeddingIndex(tmpRoot)
    expect(index.pages.some((item) => item.path === "wiki/概念/光模块升级.md")).toBe(true)

    const dryManifestPath = path.join(tmpRoot, "changes-dry.json")
    await fs.writeFile(dryManifestPath, JSON.stringify({
      $schema: "codex-ingest-manifest-v1",
      projectPath: tmpRoot,
      writes: [{ action: "update", path: "wiki/概念/光模块升级.md", content: page("光模块升级", "光模块, 800G", "光模块") }],
    }), "utf8")
    const dryRun = await applyManifest({ manifestPath: dryManifestPath, projectPath: tmpRoot, write: false, requestEmbeddingsImpl: makeFakeEmbedder() })
    expect(dryRun.embeddingIndexRefresh).toBeNull()
  })

  it("skips index refresh on apply when no index exists or key is missing", async () => {
    const { applyManifest } = await import("./ingest.mjs")
    const manifestPath = path.join(tmpRoot, "changes-noindex.json")
    await fs.writeFile(manifestPath, JSON.stringify({
      $schema: "codex-ingest-manifest-v1",
      projectPath: tmpRoot,
      writes: [{ action: "create", path: "wiki/概念/新页.md", content: page("新页", "x", "算电") }],
    }), "utf8")
    const noIndex = await applyManifest({ manifestPath, projectPath: tmpRoot, write: true })
    expect(noIndex.embeddingIndexRefresh).toMatchObject({ status: "skipped", reason: "index_missing" })

    const config = resolveEmbeddingConfig({ embeddingApiKey: "test-key" })
    await buildWikiEmbeddingIndex({ projectPath: tmpRoot, config, requestEmbeddingsImpl: makeFakeEmbedder() })
    const manifestPath2 = path.join(tmpRoot, "changes-nokey.json")
    await fs.writeFile(manifestPath2, JSON.stringify({
      $schema: "codex-ingest-manifest-v1",
      projectPath: tmpRoot,
      writes: [{ action: "create", path: "wiki/概念/新页2.md", content: page("新页2", "x", "算电") }],
    }), "utf8")
    const previousKey = process.env.OPENAI_API_KEY
    delete process.env.OPENAI_API_KEY
    try {
      const noKey = await applyManifest({ manifestPath: manifestPath2, projectPath: tmpRoot, write: true })
      expect(noKey.embeddingIndexRefresh).toMatchObject({ status: "skipped", reason: "missing_api_key" })
    } finally {
      if (previousKey != null) process.env.OPENAI_API_KEY = previousKey
    }
  })

  it("flows through prepareIngest with --embedding-routing", async () => {
    const config = resolveEmbeddingConfig({ embeddingApiKey: "test-key" })
    await buildWikiEmbeddingIndex({ projectPath: tmpRoot, config, requestEmbeddingsImpl: makeFakeEmbedder() })
    const sourcePath = path.join(tmpRoot, "raw/研报新闻/2026-07-07-算电.md")
    await fs.writeFile(sourcePath, "# 算电\n\n算电协同订单验证。", "utf8")
    const prepared = await prepareIngest({
      projectPath: tmpRoot,
      sourcePath,
      reportId: "emb-route",
      embeddingRouting: true,
      requestEmbeddingsImpl: makeFakeEmbedder(),
    })
    expect(prepared.embeddingRouting.status).toBe("applied")
    expect(prepared.embeddingRouting.added + prepared.embeddingRouting.boosted).toBeGreaterThan(0)
    expect(prepared.candidates.wikiCandidates.some((item) => item.embeddingScore != null)).toBe(true)
    const candidatePages = JSON.parse(await fs.readFile(path.join(prepared.reportDir, "candidate-pages.json"), "utf8"))
    expect(candidatePages.embeddingRouting.status).toBe("applied")
  })
})
