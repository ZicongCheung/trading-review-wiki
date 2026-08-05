import { describe, it, expect, beforeEach } from "vitest"
import {
  compactConversation,
  isPastDeepSeekCacheTtl,
  recordDeepSeekRequest,
  getLastDeepSeekRequestAt,
  __resetDeepSeekTtlState,
  asyncSha256Hex,
  PrefixGuard,
  DEEPSEEK_PREFIX_CACHE_TTL_MS,
  DEEPSEEK_AUX_MODEL,
} from "@/lib/llm-client"
import type { LlmConfig } from "@/stores/wiki-store"

const deepseekConfig: LlmConfig = {
  provider: "deepseek",
  model: "deepseek-v4-pro",
  apiKey: "sk-test",
  customEndpoint: "",
  ollamaUrl: "",
  maxContextSize: 128000,
}

const openaiConfig: LlmConfig = {
  provider: "openai",
  model: "gpt-5",
  apiKey: "sk-test",
  customEndpoint: "",
  ollamaUrl: "",
  maxContextSize: 128000,
}

function makeMessages(rounds: number): { role: "system" | "user" | "assistant"; content: string }[] {
  const msgs: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: "FROZEN SYSTEM PREFIX — must never change" },
  ]
  for (let i = 0; i < rounds; i++) {
    msgs.push({ role: "user", content: `user round ${i} content` })
    msgs.push({ role: "assistant", content: `assistant round ${i} response` })
  }
  return msgs
}

describe("compactConversation", () => {
  it("preserves the frozen system prefix verbatim", () => {
    const msgs = makeMessages(6)
    const out = compactConversation(msgs, { keepRecentRounds: 4 })
    expect(out[0].role).toBe("system")
    expect(out[0].content).toBe("FROZEN SYSTEM PREFIX — must never change")
  })

  it("does not compact when under the round threshold", () => {
    const msgs = makeMessages(2)
    const out = compactConversation(msgs)
    expect(out.length).toBe(msgs.length)
  })

  it("compacts stale rounds into a single summary user message", () => {
    const msgs = makeMessages(8) // 8 rounds > default keep 4
    const out = compactConversation(msgs, { keepRecentRounds: 4 })
    // system + 1 summary + 4 recent rounds (8 messages) = 13
    expect(out.length).toBe(1 + 1 + 8)
    expect(out[0].role).toBe("system")
    expect(out[1].role).toBe("user")
    expect(out[1].content).toContain("早期对话的压缩摘要")
    expect(out[1].content).toContain("合并了 4 轮早期对话")
    // recent rounds preserved intact
    expect(out[out.length - 1].content).toBe("assistant round 7 response")
  })

  it("never mutates the frozen prefix content during compaction", () => {
    const msgs = makeMessages(10)
    const frozen = msgs[0].content
    compactConversation(msgs, { keepRecentRounds: 2 })
    expect(msgs[0].content).toBe(frozen) // original untouched
  })
})

describe("isPastDeepSeekCacheTtl", () => {
  it("returns false when no previous request recorded", () => {
    expect(isPastDeepSeekCacheTtl(null)).toBe(false)
  })

  it("returns false within TTL window", () => {
    const now = 1_000_000
    const last = now - (DEEPSEEK_PREFIX_CACHE_TTL_MS - 1000)
    expect(isPastDeepSeekCacheTtl(last, now)).toBe(false)
  })

  it("returns true past TTL window", () => {
    const now = 1_000_000
    const last = now - (DEEPSEEK_PREFIX_CACHE_TTL_MS + 1000)
    expect(isPastDeepSeekCacheTtl(last, now)).toBe(true)
  })
})

describe("DeepSeek TTL timestamp state", () => {
  beforeEach(() => {
    __resetDeepSeekTtlState()
  })

  it("records timestamp only for deepseek provider", () => {
    recordDeepSeekRequest(openaiConfig, 5000)
    expect(getLastDeepSeekRequestAt()).toBeNull()
    recordDeepSeekRequest(deepseekConfig, 9000)
    expect(getLastDeepSeekRequestAt()).toBe(9000)
  })

  it("does not record for non-deepseek providers", () => {
    recordDeepSeekRequest(deepseekConfig, 1000)
    recordDeepSeekRequest(openaiConfig, 2000)
    expect(getLastDeepSeekRequestAt()).toBe(1000)
  })
})

describe("PrefixGuard (SHA-256 runtime guard)", () => {
  it("records baseline on first call and passes on identical prefix", async () => {
    const guard = new PrefixGuard()
    const prefix = "stable prefix block"
    expect(await guard.assertStable(prefix)).toBe(true)
    expect(await guard.assertStable(prefix)).toBe(true)
  })

  it("fails when prefix drifts", async () => {
    const guard = new PrefixGuard()
    expect(await guard.assertStable("prefix A")).toBe(true)
    expect(await guard.assertStable("prefix B changed")).toBe(false)
  })
})

describe("aux model constant", () => {
  it("pins the cheapest model for auxiliary calls", () => {
    expect(DEEPSEEK_AUX_MODEL).toBe("deepseek-v4-flash")
  })
})

describe("asyncSha256Hex", () => {
  it("is deterministic", async () => {
    const a = await asyncSha256Hex("hello")
    const b = await asyncSha256Hex("hello")
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })
})
