import type { LlmConfig } from "@/stores/wiki-store"
import { streamChat } from "./llm-client"
import { getProviderConfig } from "./llm-providers"

export interface LlmTestResult {
  ok: boolean
  latencyMs?: number
  status?: number
  error?: string
}

const TEST_TIMEOUT_MS = 15_000

export function previewProviderUrl(config: LlmConfig): string | null {
  try {
    if (config.provider === "custom" && !config.customEndpoint.trim()) return null
    if (config.provider === "ollama" && !config.ollamaUrl.trim()) return null
    return getProviderConfig(config).url
  } catch {
    return null
  }
}

/**
 * Fetch the model list from a DeepSeek-compatible `/v1/models` endpoint.
 * Mirrors how esengine/DeepSeek-Reasonix discovers available models at runtime
 * (it hits the OpenAI-compat listing endpoint rather than hardcoding a list).
 * Returns an empty array on any error so callers can fall back to a static list.
 */
export async function fetchDeepSeekModels(
  endpoint: string,
  apiKey: string,
  timeoutMs = 15_000,
): Promise<string[]> {
  const base = (endpoint || "https://api.deepseek.com/v1").replace(/\/$/, "")
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${base}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    })
    if (!res.ok) return []
    const json = (await res.json()) as { data?: Array<{ id?: string }> }
    const ids = (json.data ?? [])
      .map((m) => m.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0)
    // DeepSeek returns ids like "deepseek-chat" / "deepseek-reasoner"; keep only DeepSeek-family models.
    return Array.from(new Set(ids)).sort()
  } catch {
    return []
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * Fetch the list of available models for *any* supported provider.
 *
 * Covers every provider the app ships with:
 * - OpenAI-compatible `/v1/models` (Bearer auth): openai / deepseek / minimax /
 *   kimi / custom / codex
 * - Ollama's native `/api/tags`
 * - Anthropic `GET /v1/models` (x-api-key header)
 * - Google's discovery API (`?key=`)
 *
 * Returns an empty array on any error so callers can fall back to the static
 * `PROVIDERS[].models` list. `model` is intentionally excluded from the options
 * because some providers (e.g. codex) derive their base URL purely from the
 * endpoint/api key.
 */
export async function fetchProviderModels(
  provider: LlmConfig["provider"],
  opts: { endpoint?: string; apiKey: string; ollamaUrl?: string },
  timeoutMs = 15_000,
): Promise<string[]> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  try {
    if (provider === "ollama") {
      const base = (opts.ollamaUrl || "http://localhost:11434").replace(/\/$/, "")
      const res = await fetch(`${base}/api/tags`, { signal: controller.signal })
      if (!res.ok) return []
      const json = (await res.json()) as { models?: Array<{ name?: string }> }
      return Array.from(
        new Set(
          (json.models ?? [])
            .map((m) => m.name)
            .filter((n): n is string => typeof n === "string" && n.length > 0),
        ),
      ).sort()
    }

    if (provider === "google") {
      if (!opts.apiKey) return []
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(opts.apiKey)}`,
        { signal: controller.signal },
      )
      if (!res.ok) return []
      const json = (await res.json()) as { models?: Array<{ name?: string }> }
      return Array.from(
        new Set(
          (json.models ?? [])
            .map((m) => (m.name ? m.name.replace(/^models\//, "") : ""))
            .filter((n): n is string => typeof n === "string" && n.length > 0),
        ),
      ).sort()
    }

    if (provider === "anthropic") {
      const base = opts.endpoint ? opts.endpoint.replace(/\/$/, "") : "https://api.anthropic.com"
      const res = await fetch(`${base}/v1/models`, {
        headers: {
          "x-api-key": opts.apiKey,
          "anthropic-version": "2023-06-01",
        },
        signal: controller.signal,
      })
      if (!res.ok) return []
      const json = (await res.json()) as {
        data?: Array<{ id?: string }>
        models?: Array<{ id?: string; name?: string }>
      }
      const ids = [
        ...(json.data ?? []).map((m) => m.id),
        ...(json.models ?? []).map((m) => m.id ?? m.name),
      ].filter((id): id is string => typeof id === "string" && id.length > 0)
      return Array.from(new Set(ids)).sort()
    }

    // OpenAI-compatible providers: openai / deepseek / minimax / kimi / custom / codex
    const baseMap: Record<string, string> = {
      openai: "https://api.openai.com/v1",
      deepseek: "https://api.deepseek.com/v1",
      minimax: "https://api.minimax.io/v1",
      kimi: "https://api.kimi.com/coding/v1",
      codex: "https://api.openai.com/v1",
      custom: (opts.endpoint || "https://api.openai.com/v1").replace(/\/$/, ""),
    }
    const base = baseMap[provider] ?? (opts.endpoint || "https://api.openai.com/v1").replace(/\/$/, "")
    const res = await fetch(`${base}/models`, {
      headers: { Authorization: `Bearer ${opts.apiKey}` },
      signal: controller.signal,
    })
    if (!res.ok) return []
    const json = (await res.json()) as { data?: Array<{ id?: string }> }
    const ids = (json.data ?? [])
      .map((m) => m.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0)
    return Array.from(new Set(ids)).sort()
  } catch {
    return []
  } finally {
    clearTimeout(timeoutId)
  }
}

export async function testLlmConnection(
  config: LlmConfig,
  timeoutMs = TEST_TIMEOUT_MS,
): Promise<LlmTestResult> {
  const start = performance.now()
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  return new Promise((resolve) => {
    let firstTokenAt: number | null = null
    let settled = false

    const settle = (result: LlmTestResult) => {
      if (settled) return
      settled = true
      clearTimeout(timeoutId)
      resolve(result)
    }

    streamChat(
      config,
      [{ role: "user", content: "hi" }],
      {
        onToken: () => {
          if (firstTokenAt === null) {
            firstTokenAt = performance.now()
            controller.abort()
          }
        },
        onDone: () => {
          if (firstTokenAt !== null) {
            settle({ ok: true, latencyMs: Math.round(firstTokenAt - start) })
          } else if (controller.signal.aborted && performance.now() - start >= timeoutMs - 100) {
            settle({ ok: false, error: `超时（>${timeoutMs / 1000}s 未响应）` })
          } else {
            settle({ ok: false, error: "服务返回空响应（可能是流式协议不匹配）" })
          }
        },
        onError: (err) => {
          const msg = err.message || String(err)
          const httpMatch = msg.match(/HTTP (\d+)/)
          settle({
            ok: false,
            status: httpMatch ? Number(httpMatch[1]) : undefined,
            error: msg,
          })
        },
      },
      controller.signal,
    )
  })
}
