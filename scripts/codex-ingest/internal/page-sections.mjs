import { parse as parseYaml, stringify as stringifyYaml } from "yaml"

// 章节化页面模型:frontmatter + preamble + `##` 章节树,解析/序列化无损往返。
// 摄入侧的章节锚定补丁、导出侧的章节级可见性过滤、程序化自动区块共用这一个解析器。

export const PAGE_VISIBILITY_VALUES = ["team", "personal"]
export const DEFAULT_PAGE_VISIBILITY = "team"

const FRONTMATTER_BLOCK_REGEX = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/
const SECTION_HEADING_REGEX = /^##\s+\S/
const SECTION_VISIBILITY_MARKER_REGEX = /<!--\s*visibility:\s*(personal|team)\s*-->/i

export function autoBlockStart(name) {
  return `<!-- AUTO:${name}:START -->`
}

export function autoBlockEnd(name) {
  return `<!-- AUTO:${name}:END -->`
}

export function splitFrontmatterRaw(content) {
  const text = String(content ?? "")
  const match = text.match(FRONTMATTER_BLOCK_REGEX)
  if (!match) return { frontmatterRaw: "", body: text }
  return { frontmatterRaw: match[0], body: text.slice(match[0].length) }
}

export function parseFrontmatterFields(content) {
  const { frontmatterRaw } = splitFrontmatterRaw(content)
  if (!frontmatterRaw) return {}
  const inner = frontmatterRaw.replace(/^---\r?\n/, "").replace(/\r?\n---(?:\r?\n|$)$/, "")
  try {
    const parsed = parseYaml(inner)
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch {
    return {}
  }
}

export function normalizeSectionAnchor(anchor) {
  return String(anchor ?? "")
    .replace(SECTION_VISIBILITY_MARKER_REGEX, "")
    .replace(/^#{1,6}\s*/, "")
    .trim()
}

export function parsePageSections(content) {
  const { frontmatterRaw, body } = splitFrontmatterRaw(content)
  const lines = body.split("\n")
  const preambleLines = []
  const sections = []
  let current = null
  for (const line of lines) {
    if (SECTION_HEADING_REGEX.test(line)) {
      current = { heading: line, title: normalizeSectionAnchor(line), lines: [] }
      sections.push(current)
    } else if (current) {
      current.lines.push(line)
    } else {
      preambleLines.push(line)
    }
  }
  return { frontmatterRaw, preambleLines, sections }
}

export function serializePageSections(page) {
  const bodyLines = [...page.preambleLines]
  for (const section of page.sections) {
    bodyLines.push(section.heading, ...section.lines)
  }
  return `${page.frontmatterRaw}${bodyLines.join("\n")}`
}

export function findSectionIndex(page, anchor) {
  const normalized = normalizeSectionAnchor(anchor)
  if (!normalized) return -1
  return page.sections.findIndex((section) => section.title === normalized)
}

export function patchContentText(content) {
  if (Array.isArray(content)) return content.map((line) => String(line ?? "")).join("\n")
  return String(content ?? "")
}

function normalizedSectionBodyLines(content) {
  const lines = patchContentText(content).replace(/^\n+/, "").replace(/\s+$/, "").split("\n")
  return [...lines, ""]
}

function normalizeInsertedHeading(heading) {
  const raw = String(heading ?? "").trim()
  if (!raw) return null
  const line = raw.startsWith("#") ? raw : `## ${raw}`
  return SECTION_HEADING_REGEX.test(line) ? line : null
}

export function applySectionPatches(content, patches) {
  const page = parsePageSections(content)
  const applied = []
  const issues = []
  const addIssue = (patch, message, fatal = true) => issues.push({ op: patch.op, anchor: patch.anchor ?? null, message, fatal })

  for (const patch of patches ?? []) {
    if (!patch || typeof patch !== "object") continue
    if (patch.op === "update_frontmatter") {
      if (!patch.fields || typeof patch.fields !== "object" || Array.isArray(patch.fields)) {
        addIssue(patch, "update_frontmatter requires a fields object")
        continue
      }
      const fields = parseFrontmatterFields(serializePageSections(page))
      const merged = { ...fields, ...patch.fields }
      page.frontmatterRaw = `---\n${stringifyYaml(merged).replace(/\n$/, "")}\n---\n`
      applied.push({ op: patch.op, fields: Object.keys(patch.fields) })
      continue
    }
    if (patch.op === "replace_section" || patch.op === "append_to_section") {
      const index = findSectionIndex(page, patch.anchor)
      if (index < 0) {
        addIssue(patch, `section not found: ${normalizeSectionAnchor(patch.anchor) || "(empty)"}`)
        continue
      }
      const section = page.sections[index]
      if (patch.op === "replace_section") {
        section.lines = normalizedSectionBodyLines(patch.content)
      } else {
        const addition = patchContentText(patch.content).replace(/^\n+/, "").replace(/\s+$/, "")
        if (!addition) {
          addIssue(patch, "append_to_section requires non-empty content")
          continue
        }
        while (section.lines.length > 0 && section.lines[section.lines.length - 1].trim() === "") {
          section.lines.pop()
        }
        const separator = section.lines.length > 0 ? [""] : []
        section.lines = [...section.lines, ...separator, ...addition.split("\n"), ""]
      }
      applied.push({ op: patch.op, anchor: section.title })
      continue
    }
    if (patch.op === "insert_section_after") {
      const heading = normalizeInsertedHeading(patch.heading)
      if (!heading) {
        addIssue(patch, "insert_section_after requires a level-2 heading")
        continue
      }
      const title = normalizeSectionAnchor(heading)
      if (findSectionIndex(page, title) >= 0) {
        addIssue(patch, `section already exists: ${title}`)
        continue
      }
      let index = -1
      if (patch.anchor != null && patch.anchor !== "@preamble") {
        index = findSectionIndex(page, patch.anchor)
        if (index < 0) {
          addIssue(patch, `anchor section not found: ${normalizeSectionAnchor(patch.anchor)}`)
          continue
        }
      }
      const section = { heading, title, lines: normalizedSectionBodyLines(patch.content) }
      page.sections.splice(index + 1, 0, section)
      applied.push({ op: patch.op, anchor: title })
      continue
    }
    addIssue(patch, `unknown patch op: ${String(patch.op)}`)
  }

  return { content: serializePageSections(page), applied, issues }
}

export function renderAutoBlock(name, body) {
  const inner = String(body ?? "").replace(/^\n+/, "").replace(/\s+$/, "")
  return [autoBlockStart(name), inner, autoBlockEnd(name)].filter((part) => part !== "").join("\n")
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export function injectAutoBlock(content, { name, body, section }) {
  const text = String(content ?? "")
  const block = renderAutoBlock(name, body)
  const existing = new RegExp(`${escapeRegExp(autoBlockStart(name))}[\\s\\S]*?${escapeRegExp(autoBlockEnd(name))}`)
  if (existing.test(text)) return text.replace(existing, block)

  const page = parsePageSections(text)
  if (section) {
    const index = findSectionIndex(page, section)
    if (index >= 0) {
      const target = page.sections[index]
      while (target.lines.length > 0 && target.lines[target.lines.length - 1].trim() === "") {
        target.lines.pop()
      }
      const separator = target.lines.length > 0 ? [""] : []
      target.lines = [...target.lines, ...separator, ...block.split("\n"), ""]
      return serializePageSections(page)
    }
    const heading = normalizeInsertedHeading(section)
    if (heading) {
      const related = findSectionIndex(page, "相关页面")
      const newSection = { heading, title: normalizeSectionAnchor(heading), lines: normalizedSectionBodyLines(block) }
      page.sections.splice(related >= 0 ? related : page.sections.length, 0, newSection)
      return serializePageSections(page)
    }
  }
  return `${text.replace(/\s*$/, "")}\n\n${block}\n`
}

export function sectionVisibility(section, pageDefault = DEFAULT_PAGE_VISIBILITY) {
  const probe = [section.heading, ...section.lines.slice(0, 2)].join("\n")
  const match = probe.match(SECTION_VISIBILITY_MARKER_REGEX)
  if (match) return match[1].toLowerCase()
  return pageDefault
}

export function pageVisibility(content) {
  const fields = parseFrontmatterFields(content)
  const value = typeof fields.visibility === "string" ? fields.visibility.toLowerCase() : null
  return PAGE_VISIBILITY_VALUES.includes(value) ? value : DEFAULT_PAGE_VISIBILITY
}

export function filterPageByVisibility(content, options = {}) {
  const audience = options.audience ?? "team"
  if (audience === "personal") {
    return { content: String(content ?? ""), excluded: false, removedSections: [] }
  }
  const effectivePageVisibility = options.pageVisibility ?? pageVisibility(content)
  if (effectivePageVisibility === "personal") {
    return { content: null, excluded: true, removedSections: [] }
  }
  const page = parsePageSections(content)
  const removedSections = []
  page.sections = page.sections.filter((section) => {
    const visibility = sectionVisibility(section, effectivePageVisibility)
    if (visibility === "personal") {
      removedSections.push(section.title)
      return false
    }
    return true
  })
  return { content: serializePageSections(page), excluded: false, removedSections }
}
