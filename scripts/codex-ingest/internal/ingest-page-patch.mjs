import {
  applySectionPatches,
  parseFrontmatterFields,
  parsePageSections,
} from "./page-sections.mjs"

// 章节补丁摄入(Stage 3 patch 模式)的纯函数层:
// 模型输出章节补丁操作数组 -> 本地应用到旧页 -> 得到完整新页内容。
// manifest / apply 链路不感知补丁,只看到最终完整内容,写入边界与校验完全复用现状。

export const PAGE_WRITE_MODES = ["full", "patch"]
export const SECTION_PATCH_OPS = ["replace_section", "append_to_section", "insert_section_after", "update_frontmatter"]

export function resolvePageWriteMode(value) {
  if (value == null || value === "") return "full"
  const normalized = String(value).trim().toLowerCase()
  if (PAGE_WRITE_MODES.includes(normalized)) return normalized
  throw new Error(`Unsupported --page-write-mode: ${value}. Use ${PAGE_WRITE_MODES.join(" or ")}.`)
}

export function buildSectionOutline(existingContent) {
  const page = parsePageSections(existingContent)
  return page.sections
    .map((section) => `- ${section.heading.trim()} (${section.lines.length} 行)`)
    .join("\n")
}

export function repairJsonControlCharacters(text) {
  let out = ""
  let inString = false
  let escaped = false
  for (const ch of String(text ?? "")) {
    if (inString) {
      if (escaped) {
        out += ch
        escaped = false
        continue
      }
      if (ch === "\\") {
        out += ch
        escaped = true
        continue
      }
      if (ch === '"') {
        inString = false
        out += ch
        continue
      }
      if (ch === "\n") {
        out += "\\n"
        continue
      }
      if (ch === "\r") {
        out += "\\r"
        continue
      }
      if (ch === "\t") {
        out += "\\t"
        continue
      }
      out += ch
      continue
    }
    if (ch === '"') inString = true
    out += ch
  }
  return out
}

export function parseSectionPatchOpsFromModelText(text) {
  const raw = String(text ?? "")
  const fencedJson = raw.match(/```json\s*\n([\s\S]*?)```/i)
  const candidate = fencedJson?.[1] ?? raw.slice(raw.indexOf("["), raw.lastIndexOf("]") + 1)
  let parsed
  try {
    parsed = JSON.parse(candidate)
  } catch (err) {
    try {
      parsed = JSON.parse(repairJsonControlCharacters(candidate))
    } catch {
      throw new Error(`Section patch output is not valid JSON: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  const ops = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.patches) ? parsed.patches : null
  if (!ops || ops.length === 0) {
    throw new Error("Section patch output must be a non-empty JSON array of patch operations")
  }
  for (const op of ops) {
    if (!op || typeof op !== "object" || !SECTION_PATCH_OPS.includes(op.op)) {
      throw new Error(`Unknown section patch op: ${JSON.stringify(op?.op ?? op)}. Allowed: ${SECTION_PATCH_OPS.join(", ")}`)
    }
  }
  return ops
}

export function resolvePagePatchContent({ existingContent, patchOps, nowTs }) {
  const result = applySectionPatches(existingContent, patchOps)
  const fatalIssues = result.issues.filter((issue) => issue.fatal)
  if (fatalIssues.length > 0) {
    return { content: null, applied: result.applied, issues: result.issues, fatalIssues }
  }
  let content = result.content
  let applied = result.applied
  if (nowTs) {
    const fields = parseFrontmatterFields(content)
    if (fields.updated !== nowTs) {
      const stamped = applySectionPatches(content, [
        { op: "update_frontmatter", fields: { updated: nowTs } },
      ])
      content = stamped.content
      applied = [...applied, ...stamped.applied]
    }
  }
  return { content, applied, issues: result.issues, fatalIssues: [] }
}
