import { describe, expect, it, vi } from "vitest"
import {
  extractAssistantTextFromResponse,
  shouldUseNativeHttpForLlm,
  streamChat,
  waitForNativeHttpResponse,
} from "@/lib/llm-client"
import type { LlmConfig } from "@/stores/wiki-store"

describe("llm-client native transport selection", () => {
  it("prefers fetch streaming for all providers by default", () => {
    // After PR #4 fix verification, we keep native HTTP available as a
    // fallback but default to fetch ReadableStream for true streaming.
    expect(
      shouldUseNativeHttpForLlm({
        provider: "custom",
        apiKey: "k",
        model: "glm-5",
        ollamaUrl: "http://localhost:11434",
        customEndpoint: "https://example.com/v1",
        maxContextSize: 204800,
      }),
    ).toBe(false)
  })

  it("does not use native HTTP for standard openai provider", () => {
    expect(
      shouldUseNativeHttpForLlm({
        provider: "openai",
        apiKey: "k",
        model: "gpt-4o",
        ollamaUrl: "http://localhost:11434",
        customEndpoint: "",
        maxContextSize: 204800,
      }),
    ).toBe(false)
  })
})

describe("llm-client non-streaming response parsing", () => {
  it("extracts assistant content from an OpenAI-compatible response", () => {
    const text = extractAssistantTextFromResponse(
      JSON.stringify({
        choices: [
          {
            message: {
              role: "assistant",
              content: "交易建议",
            },
          },
        ],
      }),
    )

    expect(text).toBe("交易建议")
  })

  it("throws when assistant content is missing", () => {
    expect(() =>
      extractAssistantTextFromResponse(
        JSON.stringify({
          choices: [{ message: { role: "assistant" } }],
        }),
      ),
    ).toThrow("No assistant content found")
  })
})

describe("llm-client native transport timeout and abort", () => {
  it("rejects native HTTP waits after the configured timeout", async () => {
    vi.useFakeTimers()
    try {
      const request = new Promise<string>(() => {})
      const response = waitForNativeHttpResponse(request, undefined, 100)
      const assertion = expect(response).rejects.toThrow("Request timed out")

      await vi.advanceTimersByTimeAsync(100)

      await assertion
    } finally {
      vi.useRealTimers()
    }
  })

  it("rejects native HTTP waits when the caller aborts", async () => {
    const controller = new AbortController()
    const request = new Promise<string>(() => {})
    const response = waitForNativeHttpResponse(request, controller.signal, 1000)
    const assertion = expect(response).rejects.toMatchObject({
      name: "AbortError",
    })

    controller.abort()

    await assertion
  })
})

describe("streamChat token + prefix-cache usage capture (DeepSeek)", () => {
  const deepseekConfig: LlmConfig = {
    provider: "custom",
    apiKey: "k",
    model: "deepseek-v4-flash",
    ollamaUrl: "http://localhost:11434",
    customEndpoint: "https://api.deepseek.com/v1",
    maxContextSize: 204800,
  }

  it("captures usage (incl. cache hits) from the final SSE chunk and passes it to onDone", async () => {
    const sse =
      `data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n` +
      `data: {"choices":[{"delta":{"content":" world"}}]}\n\n` +
      `data: {"usage":{"prompt_tokens":1200,"completion_tokens":300,"total_tokens":1500,"prompt_tokens_details":{"cached_tokens":1000}}}\n\n` +
      `data: [DONE]\n\n`

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sse))
        controller.close()
      },
    })

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      body: stream,
    })
    vi.stubGlobal("fetch", fetchMock)

    try {
      const tokens: string[] = []
      let doneUsage: unknown = undefined
      await streamChat(
        deepseekConfig,
        [
          { role: "system", content: "stable prefix" },
          { role: "user", content: "hi" },
        ],
        {
          onToken: (t) => tokens.push(t),
          onDone: (usage) => {
            doneUsage = usage
          },
          onError: (e) => {
            throw e
          },
        },
      )

      expect(tokens.join("")).toBe("Hello world")
      expect(doneUsage).toBeDefined()
      expect((doneUsage as any).promptTokens).toBe(1200)
      expect((doneUsage as any).completionTokens).toBe(300)
      expect((doneUsage as any).totalTokens).toBe(1500)
      expect((doneUsage as any).cacheHitTokens).toBe(1000)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
