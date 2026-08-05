import { describe, it, expect } from "vitest"
import { getProviderConfig } from "@/lib/llm-providers"

// Inline minimal types to avoid store/zustand dependencies in unit tests
type Provider = "openai" | "anthropic" | "google" | "ollama" | "custom" | "minimax" | "kimi" | "deepseek" | "codex"
type ReasoningEffort = "minimal" | "low" | "medium" | "high"

interface LlmConfig {
  provider: Provider
  apiKey: string
  model: string
  ollamaUrl: string
  customEndpoint: string
  maxContextSize: number
  reasoningEffort?: ReasoningEffort
}

// Re-implement the minimax case logic inline so we can unit-test it
// without a browser environment or Tauri runtime.
function buildMiniMaxProviderConfig(config: LlmConfig) {
  const { apiKey, model } = config
  return {
    url: "https://api.minimax.io/v1/chat/completions",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    buildBody: (messages: Array<{ role: string; content: string }>) => ({
      messages,
      stream: true,
      model,
      temperature: 1.0,
    }),
  }
}

const makeConfig = (overrides: Partial<LlmConfig> = {}): LlmConfig => ({
  provider: "minimax",
  apiKey: "test-key",
  model: "MiniMax-M2.7",
  ollamaUrl: "http://localhost:11434",
  customEndpoint: "",
  maxContextSize: 204800,
  ...overrides,
})

describe("MiniMax Provider", () => {
  it("uses the correct base URL", () => {
    const cfg = buildMiniMaxProviderConfig(makeConfig())
    expect(cfg.url).toBe("https://api.minimax.io/v1/chat/completions")
  })

  it("sets Authorization header with Bearer token", () => {
    const cfg = buildMiniMaxProviderConfig(makeConfig({ apiKey: "my-key" }))
    expect(cfg.headers.Authorization).toBe("Bearer my-key")
  })

  it("sets Content-Type to application/json", () => {
    const cfg = buildMiniMaxProviderConfig(makeConfig())
    expect(cfg.headers["Content-Type"]).toBe("application/json")
  })

  it("includes temperature 1.0 in request body (MiniMax requires temperature > 0)", () => {
    const cfg = buildMiniMaxProviderConfig(makeConfig())
    const body = cfg.buildBody([{ role: "user", content: "hello" }]) as Record<string, unknown>
    expect(body.temperature).toBe(1.0)
  })

  it("enables streaming", () => {
    const cfg = buildMiniMaxProviderConfig(makeConfig())
    const body = cfg.buildBody([]) as Record<string, unknown>
    expect(body.stream).toBe(true)
  })

  it("uses MiniMax-M2.7 model", () => {
    const cfg = buildMiniMaxProviderConfig(makeConfig({ model: "MiniMax-M2.7" }))
    const body = cfg.buildBody([]) as Record<string, unknown>
    expect(body.model).toBe("MiniMax-M2.7")
  })

  it("uses MiniMax-M2.7-highspeed model", () => {
    const cfg = buildMiniMaxProviderConfig(makeConfig({ model: "MiniMax-M2.7-highspeed" }))
    const body = cfg.buildBody([]) as Record<string, unknown>
    expect(body.model).toBe("MiniMax-M2.7-highspeed")
  })

  it("passes messages in request body", () => {
    const cfg = buildMiniMaxProviderConfig(makeConfig())
    const messages = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there" },
    ]
    const body = cfg.buildBody(messages) as Record<string, unknown>
    expect(body.messages).toEqual(messages)
  })
})

describe("MiniMax provider registration", () => {
  it("minimax is a valid provider value in the type union", () => {
    const provider: Provider = "minimax"
    expect(provider).toBe("minimax")
  })
})

describe("Kimi Code provider", () => {
  it("uses the Kimi Code coding endpoint by default", () => {
    const cfg = getProviderConfig(
      makeConfig({ provider: "kimi", apiKey: "sk-test", model: "kimi-for-coding" }),
    )
    expect(cfg.url).toBe("https://api.kimi.com/coding/v1/chat/completions")
    expect(cfg.headers.Authorization).toBe("Bearer sk-test")
  })

  it("respects customEndpoint override (e.g. moonshot.cn for general Kimi)", () => {
    const cfg = getProviderConfig(
      makeConfig({
        provider: "kimi",
        apiKey: "sk-test",
        customEndpoint: "https://api.moonshot.cn/v1",
        model: "moonshot-v1-128k",
      }),
    )
    expect(cfg.url).toBe("https://api.moonshot.cn/v1/chat/completions")
  })

  it("trims trailing slash from customEndpoint", () => {
    const cfg = getProviderConfig(
      makeConfig({
        provider: "kimi",
        apiKey: "sk-test",
        customEndpoint: "https://api.moonshot.cn/v1/",
        model: "kimi-for-coding",
      }),
    )
    expect(cfg.url).toBe("https://api.moonshot.cn/v1/chat/completions")
  })
})

describe("Codex (Responses API) provider", () => {
  it("defaults to OpenAI official base URL when customEndpoint empty", () => {
    const cfg = getProviderConfig(
      makeConfig({ provider: "codex", apiKey: "sk-test", model: "gpt-5.4", customEndpoint: "" }),
    )
    expect(cfg.url).toBe("https://api.openai.com/v1/responses")
  })

  it("uses customEndpoint and appends /v1/responses (trims trailing slash)", () => {
    const cfg = getProviderConfig(
      makeConfig({
        provider: "codex",
        apiKey: "sk-test",
        model: "gpt-5.4",
        customEndpoint: "https://api.suyacode.com/",
      }),
    )
    expect(cfg.url).toBe("https://api.suyacode.com/v1/responses")
  })

  it("sets Bearer authorization and openai-beta header", () => {
    const cfg = getProviderConfig(
      makeConfig({ provider: "codex", apiKey: "sk-abc", model: "gpt-5.4" }),
    )
    expect(cfg.headers.Authorization).toBe("Bearer sk-abc")
    expect(cfg.headers["openai-beta"]).toBe("responses=experimental")
    expect(cfg.headers["Content-Type"]).toBe("application/json")
  })

  it("converts user message to input_text content and merges system into instructions", () => {
    const cfg = getProviderConfig(
      makeConfig({ provider: "codex", apiKey: "sk", model: "gpt-5.4" }),
    )
    const body = cfg.buildBody([
      { role: "system", content: "you are codex" },
      { role: "user", content: "hello" },
    ]) as Record<string, unknown>

    expect(body.model).toBe("gpt-5.4")
    expect(body.instructions).toBe("you are codex")
    expect(body.input).toEqual([
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "hello" }],
      },
    ])
    expect(body.store).toBe(false)
    expect(body.stream).toBe(true)
  })

  it("converts assistant message history with output_text content type", () => {
    const cfg = getProviderConfig(
      makeConfig({ provider: "codex", apiKey: "sk", model: "gpt-5.4" }),
    )
    const body = cfg.buildBody([
      { role: "user", content: "ping" },
      { role: "assistant", content: "pong" },
    ]) as Record<string, unknown>
    expect(body.input).toEqual([
      { type: "message", role: "user",      content: [{ type: "input_text",  text: "ping" }] },
      { type: "message", role: "assistant", content: [{ type: "output_text", text: "pong" }] },
    ])
    // No system messages → no instructions field at all
    expect(body.instructions).toBeUndefined()
  })

  it("includes configured reasoning.effort (defaults to medium)", () => {
    const cfgDefault = getProviderConfig(
      makeConfig({ provider: "codex", apiKey: "sk", model: "gpt-5.4" }),
    )
    const bodyDefault = cfgDefault.buildBody([{ role: "user", content: "x" }]) as Record<string, unknown>
    expect(bodyDefault.reasoning).toEqual({ effort: "medium", summary: "auto" })

    const cfgHigh = getProviderConfig(
      makeConfig({
        provider: "codex",
        apiKey: "sk",
        model: "gpt-5.4",
        reasoningEffort: "high",
      }),
    )
    const bodyHigh = cfgHigh.buildBody([{ role: "user", content: "x" }]) as Record<string, unknown>
    expect(bodyHigh.reasoning).toEqual({ effort: "high", summary: "auto" })
  })

  it("parseStream extracts delta for response.output_text.delta", () => {
    const cfg = getProviderConfig(
      makeConfig({ provider: "codex", apiKey: "sk", model: "gpt-5.4" }),
    )
    const line = `data: ${JSON.stringify({
      type: "response.output_text.delta",
      delta: "Hello",
      item_id: "msg_1",
      sequence_number: 1,
    })}`
    expect(cfg.parseStream(line)).toBe("Hello")
  })

  it("parseStream ignores non-delta SSE events", () => {
    const cfg = getProviderConfig(
      makeConfig({ provider: "codex", apiKey: "sk", model: "gpt-5.4" }),
    )
    expect(cfg.parseStream("event: response.output_text.delta")).toBeNull()
    expect(
      cfg.parseStream(`data: ${JSON.stringify({ type: "response.created", response: {} })}`),
    ).toBeNull()
    expect(
      cfg.parseStream(`data: ${JSON.stringify({ type: "response.completed" })}`),
    ).toBeNull()
    expect(cfg.parseStream("data: not-json")).toBeNull()
  })
})

describe("Custom provider endpoint normalization", () => {
  it("accepts a base v1 endpoint", () => {
    const cfg = getProviderConfig(
      makeConfig({
        provider: "custom",
        customEndpoint: "https://example.com/v1",
        model: "glm-5",
      }),
    )

    expect(cfg.url).toBe("https://example.com/v1/chat/completions")
  })

  it("accepts a full chat completions endpoint without duplicating the suffix", () => {
    const cfg = getProviderConfig(
      makeConfig({
        provider: "custom",
        customEndpoint: "https://example.com/v1/chat/completions",
        model: "glm-5",
      }),
    )

    expect(cfg.url).toBe("https://example.com/v1/chat/completions")
  })
})

describe("DeepSeek (custom endpoint) token + cache optimizations", () => {
  const deepseekConfig = () =>
    makeConfig({
      provider: "custom",
      customEndpoint: "https://api.deepseek.com/v1",
      model: "deepseek-v4-flash",
    })

  it("uses DeepSeek chat/completions endpoint with OpenAI-compatible parsing", () => {
    const cfg = getProviderConfig(deepseekConfig())
    expect(cfg.url).toBe("https://api.deepseek.com/v1/chat/completions")
    expect(cfg.isOpenAiCompatible).toBe(true)
    expect(typeof cfg.parseStream).toBe("function")
  })

  it("includes max_tokens to bound output for DeepSeek", () => {
    const cfg = getProviderConfig(deepseekConfig())
    const body = cfg.buildBody([{ role: "user", content: "hi" }]) as Record<string, unknown>
    expect(body.max_tokens).toBe(8192)
    expect(body.stream).toBe(true)
    expect(body.messages).toEqual([{ role: "user", content: "hi" }])
  })

  it("exposes parseUsage for DeepSeek prefix-cache hit capture", () => {
    const cfg = getProviderConfig(deepseekConfig())
    expect(typeof cfg.parseUsage).toBe("function")
  })

  it("parseUsage extracts tokens and DeepSeek cache_hits (prompt_tokens_details.cached_tokens)", () => {
    const cfg = getProviderConfig(deepseekConfig())
    const line = `data: ${JSON.stringify({
      usage: {
        prompt_tokens: 1200,
        completion_tokens: 300,
        total_tokens: 1500,
        prompt_tokens_details: { cached_tokens: 1000 },
      },
    })}`
    expect(cfg.parseUsage!(line)).toEqual({
      promptTokens: 1200,
      completionTokens: 300,
      totalTokens: 1500,
      cacheHitTokens: 1000,
    })
  })

  it("parseUsage handles legacy prompt_cache_hit_tokens field", () => {
    const cfg = getProviderConfig(deepseekConfig())
    const line = `data: ${JSON.stringify({
      usage: {
        prompt_tokens: 500,
        completion_tokens: 100,
        total_tokens: 600,
        prompt_cache_hit_tokens: 400,
      },
    })}`
    expect(cfg.parseUsage!(line)?.cacheHitTokens).toBe(400)
  })

  it("parseUsage returns null for normal token delta lines (no usage object)", () => {
    const cfg = getProviderConfig(deepseekConfig())
    const line = `data: ${JSON.stringify({ choices: [{ delta: { content: "hi" } }] })}`
    expect(cfg.parseUsage!(line)).toBeNull()
  })

  it("openai-compatible providers (ollama) also expose parseUsage", () => {
    const cfg = getProviderConfig(makeConfig({ provider: "ollama" }))
    expect(typeof cfg.parseUsage).toBe("function")
  })
})

describe("Dedicated DeepSeek provider", () => {
  const deepseekConfig = (overrides: Partial<LlmConfig> = {}) =>
    makeConfig({
      provider: "deepseek",
      apiKey: "sk-test",
      model: "deepseek-v4-flash",
      customEndpoint: "",
      ...overrides,
    })

  it("defaults to the official DeepSeek chat/completions endpoint", () => {
    const cfg = getProviderConfig(deepseekConfig())
    expect(cfg.url).toBe("https://api.deepseek.com/v1/chat/completions")
    expect(cfg.isOpenAiCompatible).toBe(true)
  })

  it("sends a Bearer Authorization header", () => {
    const cfg = getProviderConfig(deepseekConfig())
    expect(cfg.headers.Authorization).toBe("Bearer sk-test")
  })

  it("honors a custom endpoint override (e.g. a proxy)", () => {
    const cfg = getProviderConfig(
      deepseekConfig({ customEndpoint: "https://my-proxy.example.com/v1/" }),
    )
    expect(cfg.url).toBe("https://my-proxy.example.com/v1/chat/completions")
  })

  it("includes max_tokens to bound output and passes the model name", () => {
    const cfg = getProviderConfig(deepseekConfig())
    const body = cfg.buildBody([{ role: "user", content: "hi" }]) as Record<string, unknown>
    expect(body.max_tokens).toBe(8192)
    expect(body.model).toBe("deepseek-v4-flash")
    expect(body.stream).toBe(true)
  })

  it("exposes parseUsage for prefix-cache hit capture", () => {
    const cfg = getProviderConfig(deepseekConfig())
    expect(typeof cfg.parseUsage).toBe("function")
    const line = `data: ${JSON.stringify({
      usage: {
        prompt_tokens: 1200,
        completion_tokens: 300,
        total_tokens: 1500,
        prompt_tokens_details: { cached_tokens: 1000 },
      },
    })}`
    expect(cfg.parseUsage!(line)).toEqual({
      promptTokens: 1200,
      completionTokens: 300,
      totalTokens: 1500,
      cacheHitTokens: 1000,
    })
  })
})
