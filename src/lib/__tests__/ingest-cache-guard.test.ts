import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { buildIngestCommonPrefix, buildAnalyzeSystemPrompt, buildWriteSystemPrompt } from "@/lib/ingest"
import { PrefixGuard, asyncSha256Hex } from "@/lib/llm-client"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, "../../../")

/**
 * Extract the `COMMON_PREFIX` array literal from the standalone ingest script and evaluate it.
 * The standalone script is plain CommonJS and cannot import the TS module, so the canonical
 * prefix is intentionally duplicated there. This guard ensures the two copies never diverge —
 * divergence would break cross-path prefix-cache sharing and silently spike the miss rate.
 */
function extractStandaloneCommonPrefix(): string {
  const p = resolve(repoRoot, "scripts/ingest-pdf-standalone.cjs")
  const src = readFileSync(p, "utf8")
  const marker = "const COMMON_PREFIX ="
  const start = src.indexOf(marker)
  if (start < 0) throw new Error("COMMON_PREFIX not found in standalone script")
  const open = src.indexOf("[", start)
  let depth = 0
  let end = -1
  for (let i = open; i < src.length; i++) {
    if (src[i] === "[") depth++
    else if (src[i] === "]") {
      depth--
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  const arrSrc = src.slice(open, end + 1)
  const arr: string[] = Function("return " + arrSrc)()
  return arr.join("\n")
}

describe("ingest prefix-cache guard", () => {
  it("GUI common prefix is byte-identical to standalone COMMON_PREFIX", () => {
    const gui = buildIngestCommonPrefix()
    const standalone = extractStandaloneCommonPrefix()
    expect(gui).toBe(standalone)
  })

  it("common prefix is large enough to cross DeepSeek's prefix-cache threshold (~384 tokens)", () => {
    const prefix = buildIngestCommonPrefix()
    // Mixed Chinese/English text tokenizes to ~0.5–1.3 tokens per code point. The extended prefix
    // is ~1700 code points (~450+ tokens), comfortably above DeepSeek's ~384-token prefix-cache
    // threshold. 1000 is a safe floor that catches a revert to the old ~850-char version.
    expect([...prefix].length).toBeGreaterThanOrEqual(1000)
  })

  it("common prefix embeds the stable enum reference that makes cross-file cache worthwhile", () => {
    const prefix = buildIngestCommonPrefix()
    expect(prefix).toContain("股票 / 概念 / 策略 / 模式 / 错误 / 人物 / 总结 / 查询 / 源文档")
    expect(prefix).toContain("高 / 中 / 低")
    expect(prefix).toContain("活跃 / 观察 / 归档 / 废弃")
    // No per-call variable must ever leak into the stable prefix (would shatter the cache).
    // A rendered timestamp like `2026-07-26 16:41:32` is forbidden; the static format
    // placeholder `YYYY-MM-DD HH:mm:ss` is allowed (it is a schema rule, not a value).
    expect(prefix).not.toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/)
  })
})

describe("ingest stage system prompts share the frozen prefix (P0 unification)", () => {
  it("analyze stage prepends the frozen common prefix", () => {
    const prefix = buildIngestCommonPrefix()
    const sys = buildAnalyzeSystemPrompt({ purpose: "P", schema: "S", index: "I" })
    expect(sys.startsWith(prefix)).toBe(true)
    // Stage-specific content still appears after the prefix.
    expect(sys).toContain("## Wiki Purpose\nP")
    expect(sys).toContain("## Current Wiki Index\nI")
  })

  it("write stage prepends the frozen common prefix", () => {
    const prefix = buildIngestCommonPrefix()
    const sys = buildWriteSystemPrompt({ schema: "S" })
    expect(sys.startsWith(prefix)).toBe(true)
  })

  it("analyze and write share the SAME byte-identical prefix portion (cross-stage cache reuse)", () => {
    const prefix = buildIngestCommonPrefix()
    const analyze = buildAnalyzeSystemPrompt({})
    const write = buildWriteSystemPrompt({})
    expect(analyze.slice(0, prefix.length)).toBe(prefix)
    expect(write.slice(0, prefix.length)).toBe(prefix)
    // The shared prefix is the bulk of each prompt, so DeepSeek reuses the cached prefix.
    expect(prefix.length).toBeGreaterThan(analyze.length / 2)
    expect(prefix.length).toBeGreaterThan(write.length / 2)
  })

  it("frozen prefix template contains no rendered timestamp (only user/project data may)", () => {
    const prefix = buildIngestCommonPrefix()
    expect(prefix).not.toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/)
    // Stage templates (no user data) must also be timestamp-free.
    expect(buildAnalyzeSystemPrompt({})).not.toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/)
    expect(buildWriteSystemPrompt({})).not.toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/)
  })
})

describe("P2 prefix runtime guard (SHA-256 drift detection)", () => {
  it("frozen common prefix hashes identically across repeated builds", async () => {
    const guard = new PrefixGuard()
    const a = buildIngestCommonPrefix()
    const b = buildIngestCommonPrefix()
    expect(a).toBe(b) // byte-identical (covered above)
    expect(await guard.assertStable(a)).toBe(true)
    expect(await guard.assertStable(b)).toBe(true)
    // Explicit SHA-256 determinism check
    expect(await asyncSha256Hex(a)).toBe(await asyncSha256Hex(b))
  })

  it("detected drift would fail the guard (defends against silent refactors)", async () => {
    const guard = new PrefixGuard()
    await guard.assertStable(buildIngestCommonPrefix())
    // Simulate a refactoring accident that appends a per-call marker
    const drifted = buildIngestCommonPrefix() + `\n<!-- call-id: ${Math.random()} -->`
    expect(drifted).not.toBe(buildIngestCommonPrefix())
    // (Guard is hash-based; beyond this structural check, the hash inequality is exercised in llm-client-cache.test.ts)
  })
})
