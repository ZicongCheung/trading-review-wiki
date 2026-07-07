import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  buildSectionOutline,
  parseSectionPatchOpsFromModelText,
  resolvePagePatchContent,
  resolvePageWriteMode,
} from "./ingest-page-patch.mjs"
import { apiRunIngest, buildPagePatchPrompt } from "./ingest.mjs"
import { parseFrontmatterFields } from "./page-sections.mjs"

const NOW_TS = "2026-07-07 12:00:00"

function validFrontmatter(title, type = "概念") {
  return [
    "---",
    "schema_version: 1",
    `title: ${title}`,
    `type: ${type}`,
    `summary: ${title}的测试摘要,长度需要满足五十个字符以上的校验门槛,用于章节补丁摄入模式的合成测试夹具页面。`,
    "tags: []",
    "related: []",
    "sources: []",
    "created: 2026-07-01 09:00:00",
    "updated: 2026-07-01 09:00:00",
    "last_reviewed: 2026-07-01 09:00:00",
    "confidence: 中",
    "status: 活跃",
    "---",
    "",
  ].join("\n")
}

const EXISTING_PAGE = [
  validFrontmatter("算电协同"),
  "# 算电协同",
  "",
  "## 概念定义",
  "",
  "算力与电力的协同框架。",
  "",
  "## 关键事实与催化",
  "",
  "- 旧事实一条",
  "",
  "## 风险与证伪条件",
  "",
  "- 旧风险一条",
  "",
].join("\n")

describe("page write mode", () => {
  it("defaults to full and accepts patch", () => {
    expect(resolvePageWriteMode(undefined)).toBe("full")
    expect(resolvePageWriteMode("")).toBe("full")
    expect(resolvePageWriteMode("patch")).toBe("patch")
    expect(resolvePageWriteMode("FULL")).toBe("full")
    expect(() => resolvePageWriteMode("diff")).toThrow(/page-write-mode/)
  })
})

describe("section patch parsing", () => {
  it("parses a fenced JSON array of ops", () => {
    const ops = parseSectionPatchOpsFromModelText(
      ['补丁如下:', "```json", JSON.stringify([{ op: "append_to_section", anchor: "## 关键事实与催化", content: "- 新事实" }]), "```"].join("\n"),
    )
    expect(ops).toHaveLength(1)
    expect(ops[0].op).toBe("append_to_section")
  })

  it("repairs raw control characters inside JSON strings", () => {
    const broken = ['```json', '[{"op":"append_to_section","anchor":"## 关键事实与催化","content":"第一行', '第二行\t带tab"}]', '```'].join("\n")
    const ops = parseSectionPatchOpsFromModelText(broken)
    expect(ops[0].content).toBe("第一行\n第二行\t带tab")
  })

  it("accepts content as an array of lines", () => {
    const resolved = resolvePagePatchContent({
      existingContent: EXISTING_PAGE,
      patchOps: [
        { op: "replace_section", anchor: "## 风险与证伪条件", content: ["- 新风险一", "", "- 新风险二"] },
      ],
      nowTs: NOW_TS,
    })
    expect(resolved.fatalIssues).toEqual([])
    expect(resolved.content).toContain("## 风险与证伪条件\n- 新风险一\n\n- 新风险二\n")
  })

  it("rejects non-JSON, empty arrays, and unknown ops", () => {
    expect(() => parseSectionPatchOpsFromModelText("没有 JSON")).toThrow(/not valid JSON/)
    expect(() => parseSectionPatchOpsFromModelText("```json\n[]\n```")).toThrow(/non-empty/)
    expect(() => parseSectionPatchOpsFromModelText('```json\n[{"op":"delete_section","anchor":"x"}]\n```')).toThrow(/Unknown section patch op/)
  })
})

describe("patch resolution", () => {
  it("applies ops and stamps the updated timestamp", () => {
    const resolved = resolvePagePatchContent({
      existingContent: EXISTING_PAGE,
      patchOps: [
        { op: "append_to_section", anchor: "关键事实与催化", content: "- 2026-07-07 新增订单验证" },
      ],
      nowTs: NOW_TS,
    })
    expect(resolved.fatalIssues).toEqual([])
    expect(resolved.content).toContain("- 旧事实一条")
    expect(resolved.content).toContain("- 2026-07-07 新增订单验证")
    expect(resolved.content).toContain("- 旧风险一条")
    expect(parseFrontmatterFields(resolved.content).updated).toBe(NOW_TS)
  })

  it("returns fatal issues without content on unknown anchors", () => {
    const resolved = resolvePagePatchContent({
      existingContent: EXISTING_PAGE,
      patchOps: [{ op: "replace_section", anchor: "不存在的章节", content: "x" }],
      nowTs: NOW_TS,
    })
    expect(resolved.content).toBeNull()
    expect(resolved.fatalIssues).toHaveLength(1)
  })
})

describe("patch prompt", () => {
  it("contains the JSON contract, section outline, and existing page", () => {
    const prompt = buildPagePatchPrompt({
      prepared: { sourceContent: "source body", schema: "schema body", methodologyContext: null },
      item: { path: "wiki/概念/算电协同.md", why: "追加新证据" },
      existingContent: EXISTING_PAGE,
      analysis: "analysis body",
      nowTs: NOW_TS,
    })
    expect(prompt).toContain("章节补丁更新 wiki/概念/算电协同.md")
    expect(prompt).toContain("replace_section")
    expect(prompt).toContain("- ## 关键事实与催化")
    expect(prompt).toContain("## Existing Full Page")
    expect(prompt).toContain(NOW_TS)
    expect(buildSectionOutline(EXISTING_PAGE)).toContain("## 风险与证伪条件")
  })
})

describe("pre-existing frontmatter debt", () => {
  it("downgrades unchanged legacy fatal issues to warnings on update, keeps new ones fatal", async () => {
    const { applyManifest } = await import("./ingest.mjs")
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "legacy-fm-"))
    try {
      await fs.mkdir(path.join(tmp, "wiki/股票"), { recursive: true })
      const legacyPage = `${validFrontmatter("博敏电子", "股票").replace("confidence: 中", "confidence: 中低").replace("---\n\n", "code: SZ603936\n---\n\n")}# 博敏电子\n\n## 基本信息\n旧内容。\n`
      await fs.writeFile(path.join(tmp, "wiki/股票/博敏电子.md"), legacyPage, "utf8")

      const manifestPath = path.join(tmp, "changes.json")
      await fs.writeFile(manifestPath, JSON.stringify({
        $schema: "codex-ingest-manifest-v1",
        projectPath: tmp,
        writes: [
          { action: "update", path: "wiki/股票/博敏电子.md", content: `${legacyPage}\n## 消息面\n新增证据。\n` },
          { action: "create", path: "wiki/股票/新页.md", content: `${validFrontmatter("新页", "股票").replace("confidence: 中", "confidence: 超高").replace("---\n\n", "code: SZ000001\n---\n\n")}# 新页\n` },
        ],
      }), "utf8")

      const report = await applyManifest({ manifestPath, projectPath: tmp, write: false })
      expect([...new Set(report.fatalIssues.map((issue) => issue.path))]).toEqual(["wiki/股票/新页.md"])
      const legacyIssues = report.validation.find((item) => item.path === "wiki/股票/博敏电子.md").issues
      expect(legacyIssues.some((issue) => issue.field === "confidence" && issue.fatal === false && issue.preExisting === true)).toBe(true)
      await expect(applyManifest({ manifestPath, projectPath: tmp, write: true })).rejects.toThrow(/新页/)
    } finally {
      await fs.rm(tmp, { recursive: true, force: true })
    }
  })
})

describe("api-run patch mode integration", () => {
  let tmpRoot
  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ingest-page-patch-"))
    await fs.mkdir(path.join(tmpRoot, "raw/研报新闻"), { recursive: true })
    await fs.mkdir(path.join(tmpRoot, "wiki/概念"), { recursive: true })
    await fs.writeFile(path.join(tmpRoot, "raw/研报新闻/2026-07-07-算电.md"), "# 算电新证据\n\nAIDC 用电订单验证。", "utf8")
    await fs.writeFile(path.join(tmpRoot, "wiki/概念/算电协同.md"), EXISTING_PAGE, "utf8")
  })
  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true })
  })

  const analysisText = "# 核心结论\n- 更新 [[概念/算电协同]]"
  const planText = [
    "```json",
    JSON.stringify({ create: [], update: [{ path: "wiki/概念/算电协同.md", why: "追加订单验证" }] }),
    "```",
  ].join("\n")
  const sourceArchiveBlock = (sourceBase) =>
    `---FILE: wiki/sources/${sourceBase}.md---\n${validFrontmatter(sourceBase, "源文档")}# ${sourceBase}\n\n清洗后的证据归档。\n---END FILE---`

  it("uses section patches for update pages, preserves untouched sections, and records stats", async () => {
    const stages = []
    const result = await apiRunIngest({
      projectPath: tmpRoot,
      sourcePath: path.join(tmpRoot, "raw/研报新闻/2026-07-07-算电.md"),
      reportId: "patch-ok",
      pageWriteMode: "patch",
      requestText: async ({ stage, prompt }) => {
        stages.push(stage)
        if (stage === "analysis") return analysisText
        if (stage === "plan") return planText
        if (stage === "file-patch") {
          expect(prompt).toContain("## 章节大纲")
          return ["```json", JSON.stringify([
            { op: "append_to_section", anchor: "## 关键事实与催化", content: "- 2026-07-07 AIDC 用电订单验证(研报,B级)" },
          ]), "```"].join("\n")
        }
        if (stage === "file") return sourceArchiveBlock("2026-07-07-算电")
        throw new Error(`unexpected stage ${stage}`)
      },
    })

    expect(stages.filter((stage) => stage === "file-patch")).toHaveLength(1)
    const manifest = JSON.parse(await fs.readFile(result.manifestPath, "utf8"))
    expect(manifest.pageWriteMode).toBe("patch")
    expect(manifest.pagePatch).toMatchObject({ patchedPages: 1, fullPages: 1, fallbacks: [] })
    const updated = manifest.writes.find((item) => item.path === "wiki/概念/算电协同.md")
    expect(updated.content).toContain("- 旧事实一条")
    expect(updated.content).toContain("- 2026-07-07 AIDC 用电订单验证(研报,B级)")
    expect(updated.content).toContain("- 旧风险一条")
    expect(parseFrontmatterFields(updated.content).updated).toBe(result.createdAt)
    const files = await fs.readdir(result.filesDir)
    expect(files.some((name) => name.startsWith("patch-"))).toBe(true)
    expect(result.dryRunReport.dryRun).toBe(true)
    expect(await fs.readFile(path.join(tmpRoot, "wiki/概念/算电协同.md"), "utf8")).toBe(EXISTING_PAGE)
  })

  it("falls back to full-page generation when the patch fails to apply", async () => {
    const stages = []
    const fullPage = `${validFrontmatter("算电协同")}# 算电协同\n\n## 概念定义\n完整重写后的页面。`
    const result = await apiRunIngest({
      projectPath: tmpRoot,
      sourcePath: path.join(tmpRoot, "raw/研报新闻/2026-07-07-算电.md"),
      reportId: "patch-fallback",
      pageWriteMode: "patch",
      requestText: async ({ stage, prompt }) => {
        stages.push(stage)
        if (stage === "analysis") return analysisText
        if (stage === "plan") return planText
        if (stage === "file-patch") {
          return ["```json", JSON.stringify([{ op: "replace_section", anchor: "## 不存在的章节", content: "x" }]), "```"].join("\n")
        }
        if (stage === "file" && prompt.includes("wiki/概念/算电协同.md")) {
          return `---FILE: wiki/概念/算电协同.md---\n${fullPage}\n---END FILE---`
        }
        if (stage === "file") return sourceArchiveBlock("2026-07-07-算电")
        throw new Error(`unexpected stage ${stage}`)
      },
    })

    const manifest = JSON.parse(await fs.readFile(result.manifestPath, "utf8"))
    expect(manifest.pagePatch.patchedPages).toBe(0)
    expect(manifest.pagePatch.fullPages).toBe(2)
    expect(manifest.pagePatch.fallbacks).toHaveLength(1)
    expect(manifest.pagePatch.fallbacks[0]).toMatchObject({ path: "wiki/概念/算电协同.md" })
    const updated = manifest.writes.find((item) => item.path === "wiki/概念/算电协同.md")
    expect(updated.content).toContain("完整重写后的页面。")
  })

  it("keeps full mode byte-identical to previous behavior with no patch stages", async () => {
    const stages = []
    const fullPage = `${validFrontmatter("算电协同")}# 算电协同\n\n## 概念定义\n全量模式页面。`
    const result = await apiRunIngest({
      projectPath: tmpRoot,
      sourcePath: path.join(tmpRoot, "raw/研报新闻/2026-07-07-算电.md"),
      reportId: "full-mode",
      requestText: async ({ stage, prompt }) => {
        stages.push(stage)
        if (stage === "analysis") return analysisText
        if (stage === "plan") return planText
        if (stage === "file" && prompt.includes("wiki/概念/算电协同.md")) {
          return `---FILE: wiki/概念/算电协同.md---\n${fullPage}\n---END FILE---`
        }
        if (stage === "file") return sourceArchiveBlock("2026-07-07-算电")
        throw new Error(`unexpected stage ${stage}`)
      },
    })

    expect(stages).not.toContain("file-patch")
    const manifest = JSON.parse(await fs.readFile(result.manifestPath, "utf8"))
    expect(manifest.pageWriteMode).toBe("full")
    expect(manifest.pagePatch).toMatchObject({ patchedPages: 0, fullPages: 2 })
    const files = await fs.readdir(result.filesDir)
    expect(files.some((name) => name.startsWith("patch-"))).toBe(false)
  })
})
