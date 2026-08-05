import { describe, it, expect, vi, beforeEach } from "vitest"
import type { FileNode } from "@/types/wiki"

// Mock the Tauri fs command so we can drive the scanner with a synthetic tree.
const treeFor: Record<string, FileNode[]> = {}
vi.mock("@/commands/fs", () => ({
  listDirectory: vi.fn(async (p: string) => treeFor[p] ?? []),
}))

import { getIngestBacklog } from "@/lib/ingest-backlog"

function dir(name: string, children: FileNode[]): FileNode {
  return { name, path: `x/${name}`, is_dir: true, children }
}
function file(name: string): FileNode {
  return { name, path: `x/${name}`, is_dir: false }
}

beforeEach(() => {
  for (const k of Object.keys(treeFor)) delete treeFor[k]
})

describe("getIngestBacklog", () => {
  it("counts raw sources and excludes already-ingested basenames", async () => {
    treeFor["x/raw/sources"] = [
      dir("研报", [
        file("A.pdf"),
        file("B.pdf"),
        file("C.pdf"),
        dir(".cache", [file("A.pdf.txt")]), // must be skipped
      ]),
      file("D.txt"), // flat source at root
    ]
    treeFor["x/wiki/sources"] = [file("A.md"), file("B.md")] // A,B processed
    treeFor["x/wiki/源文档"] = [] // older layout dir, empty

    const backlog = await getIngestBacklog("x")

    expect(backlog.total).toBe(4) // A.pdf, B.pdf, C.pdf, D.txt
    expect(backlog.items.map((i) => i.sourcePath).sort()).toEqual(
      ["raw/sources/研报/C.pdf", "raw/sources/D.txt"].sort(),
    )
  })

  it("treats wiki/源文档/<base>.md as processed too", async () => {
    treeFor["x/raw/sources"] = [file("E.pdf")]
    treeFor["x/wiki/sources"] = []
    treeFor["x/wiki/源文档"] = [file("E.md")]

    const backlog = await getIngestBacklog("x")
    expect(backlog.total).toBe(1)
    expect(backlog.items).toHaveLength(0)
  })

  it("reports everything as backlog when wiki has no pages", async () => {
    treeFor["x/raw/sources"] = [file("F.pdf"), file("G.pdf")]
    treeFor["x/wiki/sources"] = []
    treeFor["x/wiki/源文档"] = []

    const backlog = await getIngestBacklog("x")
    expect(backlog.total).toBe(2)
    expect(backlog.items).toHaveLength(2)
    expect(backlog.duplicateBases).toEqual([])
  })

  it("reports duplicate basenames across subdirectories", async () => {
    treeFor["x/raw/sources"] = [
      dir("研报", [file("A.pdf"), file("B.pdf")]),
      dir("行业", [file("A.pdf"), file("C.pdf")]),
    ]
    treeFor["x/wiki/sources"] = [file("A.md")]
    treeFor["x/wiki/源文档"] = []

    const backlog = await getIngestBacklog("x")
    expect(backlog.total).toBe(4)
    // A appears in both folders; one A.md masks both copies.
    expect(backlog.items.map((i) => i.sourcePath).sort()).toEqual(
      ["raw/sources/研报/B.pdf", "raw/sources/行业/C.pdf"].sort(),
    )
    expect(backlog.duplicateBases).toEqual(["A"])
  })

  it("counts case-only mismatches as processed (case-insensitive)", async () => {
    // Raw uses "CPU"; the ingested wiki page used "cpu". The source was
    // actually processed — only the generated filename casing differs.
    treeFor["x/raw/sources"] = [file("20260624-报告：国产CPU.pdf")]
    treeFor["x/wiki/sources"] = [file("20260624-报告：国产cpu.md")]
    treeFor["x/wiki/源文档"] = []

    const backlog = await getIngestBacklog("x")
    expect(backlog.total).toBe(1)
    expect(backlog.items).toHaveLength(0) // not counted as backlog
    expect(backlog.caseMismatchBases).toEqual(["20260624-报告：国产CPU"])
  })
})
