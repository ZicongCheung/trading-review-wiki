import { describe, expect, it } from "vitest"
import {
  applySectionPatches,
  autoBlockEnd,
  autoBlockStart,
  filterPageByVisibility,
  findSectionIndex,
  injectAutoBlock,
  pageVisibility,
  parseFrontmatterFields,
  parsePageSections,
  sectionVisibility,
  serializePageSections,
} from "./page-sections.mjs"
import { validateFrontmatter } from "./knowledge.mjs"

const SAMPLE_PAGE = [
  "---",
  "schema_version: 1",
  "title: 示例概念",
  "type: 概念",
  "summary: 用于章节模型测试的示例页面",
  "visibility: team",
  "entity_key: entity:示例概念",
  "created: 2026-07-01 09:00:00",
  "updated: 2026-07-01 09:00:00",
  "last_reviewed: 2026-07-01 09:00:00",
  "confidence: 中",
  "status: 活跃",
  "---",
  "# 示例概念",
  "",
  "开头导语。",
  "",
  "## 概念定义",
  "",
  "定义正文第一行。",
  "",
  "### 子标题",
  "",
  "子标题内容属于父章节。",
  "",
  "## 验证记录",
  "",
  "- 旧验证一条",
  "",
  "## 个人思考",
  "<!-- visibility: personal -->",
  "",
  "只给自己看的内容。",
  "",
  "## 相关页面",
  "",
  "- [[概念/另一个页面]]",
  "",
].join("\n")

describe("page sections parse/serialize", () => {
  it("round-trips content losslessly", () => {
    const page = parsePageSections(SAMPLE_PAGE)
    expect(serializePageSections(page)).toBe(SAMPLE_PAGE)
  })

  it("round-trips pages without frontmatter or sections", () => {
    for (const content of ["", "just a line\n", "# only h1\n\ntext\n", "---\ntitle: x\n---\nno sections\n"]) {
      expect(serializePageSections(parsePageSections(content))).toBe(content)
    }
  })

  it("keeps ### subsections inside the parent ## section and preamble before first section", () => {
    const page = parsePageSections(SAMPLE_PAGE)
    expect(page.preambleLines.join("\n")).toContain("# 示例概念")
    expect(page.sections.map((section) => section.title)).toEqual(["概念定义", "验证记录", "个人思考", "相关页面"])
    expect(page.sections[0].lines.join("\n")).toContain("### 子标题")
  })

  it("finds sections by anchor with or without heading markers", () => {
    const page = parsePageSections(SAMPLE_PAGE)
    expect(findSectionIndex(page, "## 概念定义")).toBe(0)
    expect(findSectionIndex(page, "验证记录")).toBe(1)
    expect(findSectionIndex(page, "不存在的章节")).toBe(-1)
  })

  it("parses frontmatter fields", () => {
    const fields = parseFrontmatterFields(SAMPLE_PAGE)
    expect(fields.title).toBe("示例概念")
    expect(fields.entity_key).toBe("entity:示例概念")
  })
})

describe("section patches", () => {
  it("replaces a section body and keeps everything else byte-identical", () => {
    const result = applySectionPatches(SAMPLE_PAGE, [
      { op: "replace_section", anchor: "概念定义", content: "新的定义正文。" },
    ])
    expect(result.issues).toEqual([])
    expect(result.content).toContain("## 概念定义\n新的定义正文。\n\n## 验证记录")
    expect(result.content).toContain("- 旧验证一条")
    expect(result.content).toContain("只给自己看的内容。")
  })

  it("appends to a section without duplicating separators", () => {
    const result = applySectionPatches(SAMPLE_PAGE, [
      { op: "append_to_section", anchor: "验证记录", content: "- 新验证一条" },
    ])
    expect(result.issues).toEqual([])
    expect(result.content).toContain("- 旧验证一条\n\n- 新验证一条\n\n## 个人思考")
  })

  it("inserts a new section after an anchor and rejects duplicates", () => {
    const inserted = applySectionPatches(SAMPLE_PAGE, [
      { op: "insert_section_after", anchor: "概念定义", heading: "时间线", content: "- 2026-07-01 首次记录" },
    ])
    expect(inserted.issues).toEqual([])
    const page = parsePageSections(inserted.content)
    expect(page.sections.map((section) => section.title)).toEqual(["概念定义", "时间线", "验证记录", "个人思考", "相关页面"])

    const duplicate = applySectionPatches(inserted.content, [
      { op: "insert_section_after", anchor: "概念定义", heading: "时间线", content: "x" },
    ])
    expect(duplicate.issues).toHaveLength(1)
    expect(duplicate.content).toBe(inserted.content)
  })

  it("updates frontmatter fields while preserving the body", () => {
    const result = applySectionPatches(SAMPLE_PAGE, [
      { op: "update_frontmatter", fields: { updated: "2026-07-07 10:00:00", momentum: "热" } },
    ])
    expect(result.issues).toEqual([])
    const fields = parseFrontmatterFields(result.content)
    expect(fields.updated).toBe("2026-07-07 10:00:00")
    expect(fields.momentum).toBe("热")
    expect(fields.title).toBe("示例概念")
    const { body } = { body: result.content.slice(result.content.indexOf("# 示例概念")) }
    expect(body).toContain("## 概念定义")
  })

  it("reports unknown anchors and unknown ops without changing content", () => {
    const result = applySectionPatches(SAMPLE_PAGE, [
      { op: "replace_section", anchor: "不存在", content: "x" },
      { op: "delete_section", anchor: "概念定义" },
    ])
    expect(result.content).toBe(SAMPLE_PAGE)
    expect(result.issues).toHaveLength(2)
    expect(result.issues.every((issue) => issue.fatal)).toBe(true)
    expect(result.applied).toEqual([])
  })
})

describe("auto blocks", () => {
  it("appends a named block into a target section and replaces it idempotently", () => {
    const first = injectAutoBlock(SAMPLE_PAGE, { name: "timeline", body: "- 2026-07-01 A", section: "验证记录" })
    expect(first).toContain(`${autoBlockStart("timeline")}\n- 2026-07-01 A\n${autoBlockEnd("timeline")}`)
    const second = injectAutoBlock(first, { name: "timeline", body: "- 2026-07-01 A", section: "验证记录" })
    expect(second).toBe(first)
    const updated = injectAutoBlock(first, { name: "timeline", body: "- 2026-07-02 B", section: "验证记录" })
    expect(updated).toContain("- 2026-07-02 B")
    expect(updated).not.toContain("- 2026-07-01 A")
    expect(updated.match(new RegExp(autoBlockStart("timeline").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))).toHaveLength(1)
  })

  it("creates a missing target section before 相关页面", () => {
    const result = injectAutoBlock(SAMPLE_PAGE, { name: "timeline", body: "- 条目", section: "## 时间线" })
    const page = parsePageSections(result)
    const titles = page.sections.map((section) => section.title)
    expect(titles.indexOf("时间线")).toBeGreaterThan(-1)
    expect(titles.indexOf("时间线")).toBeLessThan(titles.indexOf("相关页面"))
  })
})

describe("visibility", () => {
  it("reads page and section visibility", () => {
    expect(pageVisibility(SAMPLE_PAGE)).toBe("team")
    const page = parsePageSections(SAMPLE_PAGE)
    expect(sectionVisibility(page.sections[2], "team")).toBe("personal")
    expect(sectionVisibility(page.sections[0], "team")).toBe("team")
  })

  it("strips personal sections for team audience and keeps everything for personal audience", () => {
    const team = filterPageByVisibility(SAMPLE_PAGE, { audience: "team" })
    expect(team.excluded).toBe(false)
    expect(team.removedSections).toEqual(["个人思考"])
    expect(team.content).not.toContain("只给自己看的内容。")
    expect(team.content).toContain("## 验证记录")

    const personal = filterPageByVisibility(SAMPLE_PAGE, { audience: "personal" })
    expect(personal.content).toBe(SAMPLE_PAGE)
  })

  it("excludes personal pages entirely for team audience", () => {
    const personalPage = SAMPLE_PAGE.replace("visibility: team", "visibility: personal")
    const result = filterPageByVisibility(personalPage, { audience: "team" })
    expect(result.excluded).toBe(true)
    expect(result.content).toBeNull()
  })
})

describe("frontmatter v6 fields", () => {
  const baseFm = {
    schema_version: 1,
    title: "示例概念",
    type: "概念",
    summary: "用于章节模型测试的示例页面,覆盖章节解析、补丁应用、自动区块注入和可见性过滤等核心行为的最小合成夹具。",
    created: "2026-07-01 09:00:00",
    updated: "2026-07-01 09:00:00",
    last_reviewed: "2026-07-01 09:00:00",
    confidence: "中",
    status: "活跃",
  }

  it("accepts valid entity_key and visibility without violations", () => {
    const violations = validateFrontmatter({ ...baseFm, entity_key: "entity:示例", visibility: "team" }, "wiki/概念/示例概念.md")
    expect(violations).toEqual([])
  })

  it("warns (non-fatal) on invalid values and stays silent when fields are absent", () => {
    expect(validateFrontmatter(baseFm, "wiki/概念/示例概念.md")).toEqual([])
    const violations = validateFrontmatter({ ...baseFm, visibility: "public", entity_key: "  " }, "wiki/概念/示例概念.md")
    const fields = violations.map((item) => item.field).sort()
    expect(fields).toEqual(["entity_key", "visibility"])
    expect(violations.every((item) => item.fatal === false)).toBe(true)
  })
})
