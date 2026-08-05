import { listDirectory } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import type { FileNode } from "@/types/wiki"

/**
 * Backlog scanner for raw sources that have not yet been ingested into the wiki.
 *
 * Mapping rule (verified against the live project on 2026-07-26):
 *   raw/sources/<any-subdir>/<base>.<ext>  ->  wiki/sources/<base>.md
 *   (also accepts wiki/源文档/<base>.md for older layouts)
 *
 * A raw source file is considered "processed" once a same-basename `.md` page
 * exists under wiki/sources (or wiki/源文档). Everything else is backlog.
 */

const SOURCE_EXTS = new Set([
  "pdf", "txt", "md", "docx", "doc", "html", "htm", "epub", "csv", "rtf",
])

export interface BacklogItem {
  /** Relative to project root, e.g. `raw/sources/研报/xxx.pdf`. */
  sourcePath: string
  /** Sub-directory of raw/sources, e.g. `研报`, or "" for the root. */
  folderContext: string
}

export interface IngestBacklog {
  /** Total raw source files found under raw/sources (recursively). */
  total: number
  /** Raw files that still need processing. */
  items: BacklogItem[]
  /**
   * Basenames that appear more than once under raw/sources.
   * Because the processed check is basename-only, duplicates can cause one file
   * to hide another: if only one copy has a matching wiki/sources/<base>.md,
   * the other copy looks processed even though it never ran.
   */
  duplicateBases: string[]
  /**
   * Basenames whose raw source was ingested, but the generated wiki/<base>.md
   * differs only in letter casing (e.g. raw `国产CPU` vs wiki `国产cpu`).
   * These are counted as processed; surfaces can suggest renaming the wiki file
   * to match the source casing.
   */
  caseMismatchBases: string[]
}

interface RawFile {
  sourcePath: string
  folderContext: string
  base: string
}

function flattenRaw(nodes: FileNode[], relDir: string, out: RawFile[]): void {
  for (const n of nodes) {
    if (n.is_dir) {
      if (n.name === ".cache") continue
      const childRel = relDir ? `${relDir}/${n.name}` : n.name
      if (n.children) flattenRaw(n.children, childRel, out)
      continue
    }
    const dot = n.name.lastIndexOf(".")
    const ext = dot >= 0 ? n.name.slice(dot + 1).toLowerCase() : ""
    if (!SOURCE_EXTS.has(ext)) continue
    const base = dot >= 0 ? n.name.slice(0, dot) : n.name
    const sourcePath = `raw/sources/${relDir ? `${relDir}/` : ""}${n.name}`
    out.push({ sourcePath, folderContext: relDir, base })
  }
}

async function collectMdBases(pp: string, dir: string): Promise<Set<string>> {
  const set = new Set<string>()
  try {
    const tree = await listDirectory(`${pp}/${dir}`)
    const files: FileNode[] = []
    const walk = (nodes: FileNode[]) => {
      for (const n of nodes) {
        if (n.is_dir) {
          if (n.children) walk(n.children)
        } else {
          files.push(n)
        }
      }
    }
    walk(tree)
    for (const f of files) {
      if (f.name.endsWith(".md")) {
        set.add(f.name.replace(/\.md$/i, ""))
      }
    }
  } catch {
    // directory may not exist yet — treat as empty
  }
  return set
}

/**
 * Scan the project for raw sources that have not been turned into wiki pages.
 * Returns the total raw count plus the list of unprocessed items.
 */
export async function getIngestBacklog(projectPath: string): Promise<IngestBacklog> {
  const pp = normalizePath(projectPath)
  let rawTree: FileNode[]
  try {
    rawTree = await listDirectory(`${pp}/raw/sources`)
  } catch {
    return { total: 0, items: [], duplicateBases: [], caseMismatchBases: [] }
  }

  const rawFiles: RawFile[] = []
  flattenRaw(rawTree, "", rawFiles)

  const wikiBases = new Set<string>()
  const wikiBasesLower = new Map<string, string>() // lower -> canonical base
  for (const dir of ["wiki/sources", "wiki/源文档"]) {
    for (const b of await collectMdBases(pp, dir)) {
      wikiBases.add(b)
      wikiBasesLower.set(b.toLowerCase(), b)
    }
  }

  // Detect duplicate basenames across raw/sources. These are risky because the
  // "processed" check is basename-only: a single wiki/sources/<base>.md masks
  // all copies with the same base.
  const baseCounts = new Map<string, number>()
  for (const f of rawFiles) {
    baseCounts.set(f.base, (baseCounts.get(f.base) ?? 0) + 1)
  }
  const duplicateBases = Array.from(baseCounts.entries())
    .filter(([, count]) => count > 1)
    .map(([base]) => base)

  const items: BacklogItem[] = []
  const caseMismatchBases: string[] = []
  for (const f of rawFiles) {
    if (wikiBases.has(f.base)) continue // exact match → processed
    const lowerHit = wikiBasesLower.get(f.base.toLowerCase())
    if (lowerHit) {
      // Ingested, but the generated wiki filename differs only in casing.
      // Count as processed (Windows/macOS are case-insensitive); surface it so
      // the user can normalize the wiki filename to match the source.
      if (!caseMismatchBases.includes(f.base)) caseMismatchBases.push(f.base)
      continue
    }
    items.push({ sourcePath: f.sourcePath, folderContext: f.folderContext })
  }

  return { total: rawFiles.length, items, duplicateBases, caseMismatchBases }
}
