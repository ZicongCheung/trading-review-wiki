import { describe, it, expect } from "vitest"
import { buildChatSystemPrompt, buildChatUserContextBlock } from "@/lib/chat-prompts"

describe("chat system prompt (cache-stable prefix)", () => {
  it("is byte-identical across calls — never depends on the query", () => {
    const a = buildChatSystemPrompt()
    const b = buildChatSystemPrompt()
    expect(a).toBe(b)
  })

  it("contains no per-query volatile leak (no rendered date/timestamp)", () => {
    const p = buildChatSystemPrompt()
    // A rendered timestamp like `2026-07-29` or `2026-07-29 17:05:34` would shatter the cache.
    expect(p).not.toMatch(/\d{4}-\d{2}-\d{2}/)
    // The old per-query language injection (`用户正在使用 **中文** 书写`) must be gone.
    expect(p).not.toContain("用户正在使用 **")
  })

  it("states a stable language policy without referencing the query", () => {
    const p = buildChatSystemPrompt()
    expect(p).toContain("始终使用与用户输入相同的语言回复")
  })
})

describe("chat user-context block (variable, kept out of system prompt)", () => {
  it("includes every provided section", () => {
    const block = buildChatUserContextBlock({
      purpose: "P",
      index: "I",
      pageList: "L",
      pagesContext: "C",
    })
    expect(block).toContain("## Wiki Purpose\nP")
    expect(block).toContain("## Wiki Index\nI")
    expect(block).toContain("## Page List\nL")
    expect(block).toContain("## Wiki Pages\n\nC")
  })

  it("omits empty sections so the block stays minimal", () => {
    const block = buildChatUserContextBlock({ pagesContext: "C" })
    expect(block).toContain("## Wiki Pages")
    expect(block).not.toContain("## Wiki Purpose")
    expect(block).not.toContain("## Wiki Index")
    expect(block).not.toContain("## Page List")
  })

  it("returns empty string when nothing is provided", () => {
    expect(buildChatUserContextBlock({})).toBe("")
  })
})
