import type { LlmConfig } from "@/stores/wiki-store"
import { postJsonViaNativeHttp } from "@/commands/http"
import { getProviderConfig } from "./llm-providers"
import { debugLog } from "./debug-log"

import type { ChatMessage, TokenUsage } from "./llm-providers"
export type { ChatMessage, TokenUsage }

export interface StreamCallbacks {
  onToken: (token: string) => void
  /** Receives final token accounting when available (OpenAI-compatible streams only). */
  onDone: (usage?: TokenUsage) => void
  onError: (error: Error) => void
}

/** Merge a later usage chunk into an accumulator. Usage arrives once at stream end,
 *  but merging keeps the last non-undefined value so partial chunks can't clobber it. */
function mergeUsage(acc: TokenUsage | undefined, next: TokenUsage): TokenUsage {
  return {
    promptTokens: next.promptTokens ?? acc?.promptTokens,
    completionTokens: next.completionTokens ?? acc?.completionTokens,
    totalTokens: next.totalTokens ?? acc?.totalTokens,
    cacheHitTokens: next.cacheHitTokens ?? acc?.cacheHitTokens,
  }
}

/** DeepSeek's prefix-cache TTL is ~5 min. Warn when a single request runs longer,
 *  since the cached system-prefix likely expired mid-ingest and re-billed in full. */
const PREFIX_CACHE_TTL_WARN_MS = 4.5 * 60 * 1000

/** DeepSeek自动前缀缓存的服务端TTL（毫秒）。跨请求间隔超过此值，前缀缓存即失，下一轮按全价重发。 */
export const DEEPSEEK_PREFIX_CACHE_TTL_MS = 5 * 60 * 1000

/** 辅助调用（repair/压缩/重试）固定使用的最便宜模型，对齐 Reasonix 的"辅助操作用最便宜模型"策略。 */
export const DEEPSEEK_AUX_MODEL = "deepseek-v4-flash"

/**
 * 把一段多轮对话历史折叠为摘要，保留冻结 system 前缀不动。
 * 用于前缀缓存的自动压缩（prefix-preserving compaction）与 TTL 冷恢复（cold-resume）。
 * 纯函数，便于单元测试。
 *
 * 行为：
 * - 保留第一条 system 消息原样（冻结前缀，不得改写）。
 * - 超出 keepRecentRounds 的最旧轮次（user/assistant 配对）被替换为单条摘要 user 消息。
 * - 返回的新历史以 system 开头，其后为 [摘要块（若有）+ 最近轮次]。
 *
 * @param messages 完整消息数组（含 system 与多轮 user/assistant）
 * @param opts.keepRecentRounds 保留最近几轮完整对话（默认 4）
 * @param opts.summaryRole 摘要块的角色（默认 "user"）
 * @param opts.summaryHeader 摘要块的固定前缀文本（默认 "以下是早期对话的压缩摘要："）
 */
export function compactConversation(
  messages: ChatMessage[],
  opts: { keepRecentRounds?: number; summaryRole?: "user" | "assistant" | "system"; summaryHeader?: string } = {},
): ChatMessage[] {
  const keepRecentRounds = opts.keepRecentRounds ?? 4
  const summaryRole = opts.summaryRole ?? "user"
  const summaryHeader = opts.summaryHeader ?? "以下是早期对话的压缩摘要："

  if (messages.length === 0) return []

  // 冻结 system 前缀：取第一条 system（若存在）原样保留
  const firstIsSystem = messages[0].role === "system"
  const systemMsg: ChatMessage | null = firstIsSystem ? messages[0] : null
  const rest = firstIsSystem ? messages.slice(1) : messages

  // 配对 user/assistant 轮次
  const rounds: ChatMessage[][] = []
  let buf: ChatMessage[] = []
  for (const m of rest) {
    buf.push(m)
    if (m.role === "assistant") {
      rounds.push(buf)
      buf = []
    }
  }
  if (buf.length > 0) rounds.push(buf) // 末尾不完整轮次也保留

  if (rounds.length <= keepRecentRounds) {
    return systemMsg ? [systemMsg, ...rest] : rest
  }

  const stale = rounds.slice(0, rounds.length - keepRecentRounds)
  const recent = rounds.slice(rounds.length - keepRecentRounds)

  const staleChars = stale.reduce((acc, r) => acc + r.reduce((a, m) => a + m.content.length, 0), 0)
  const summaryContent = [
    summaryHeader,
    `(合并了 ${stale.length} 轮早期对话，约 ${staleChars} 字符)`,
    "",
    stale
      .map((r) => r.map((m) => `【${m.role}】${m.content.slice(0, 600)}${m.content.length > 600 ? "…(截断)" : ""}`).join("\n"))
      .join("\n\n"),
  ].join("\n")

  const compacted: ChatMessage[] = []
  if (systemMsg) compacted.push(systemMsg)
  compacted.push({ role: summaryRole, content: summaryContent })
  compacted.push(...recent.flat())
  return compacted
}

/** 判断距上次请求是否超过了 DeepSeek 前缀缓存 TTL（需要冷恢复）。 */
export function isPastDeepSeekCacheTtl(lastRequestAt: number | null, now: number = Date.now()): boolean {
  if (lastRequestAt === null) return false
  return now - lastRequestAt > DEEPSEEK_PREFIX_CACHE_TTL_MS
}

/**
 * 模块级：记录上一次向 DeepSeek 发送请求的时间戳（用于 TTL 冷恢复判定）。
 * 由 recordDeepSeekRequest() 在每次 DeepSeek 请求发起时写入。
 */
let lastDeepSeekRequestAt: number | null = null

/** 记录一次 DeepSeek 请求的发生时刻（仅 DeepSeek 生效）。测试可注入 now。 */
export function recordDeepSeekRequest(config: LlmConfig, now: number = Date.now()): void {
  if (config.provider === "deepseek") {
    lastDeepSeekRequestAt = now
  }
}

/** 读取上次 DeepSeek 请求时间（测试用）。 */
export function getLastDeepSeekRequestAt(): number | null {
  return lastDeepSeekRequestAt
}

/** 重置 TTL 计时状态（测试用）。 */
export function __resetDeepSeekTtlState(): void {
  lastDeepSeekRequestAt = null
}

/**
 * 前缀 SHA256 运行时守卫（P2）。对冻结前缀做哈希，便于在测试与可选运行时断言其未漂移。
 * 纯函数，不依赖环境。返回 hex 字符串。
 */
export function sha256Hex(input: string): string {
  // 使用 Web Crypto（浏览器/Tauri WebView/现代 Node 均支持）
  // 注意：此函数返回同步占位——真实哈希在调用方用 crypto.subtle 异步计算。
  // 为便于测试与零依赖，这里提供确定性轻量实现（FNV-1a 64-bit 兜底），
  // 正式校验使用下方 asyncSha256。
  return fnv1a64(input)
}

function fnv1a64(str: string): string {
  let h1 = 0xcbf29ce4 >>> 0
  let h2 = 0x84222325 >>> 0
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i)
    h1 ^= c
    h1 = Math.imul(h1, 0x1000193) >>> 0
    h2 ^= c
    h2 = Math.imul(h2, 0x1000193) >>> 0
  }
  return (h2.toString(16).padStart(8, "0") + h1.toString(16).padStart(8, "0"))
}

/** 使用 Web Crypto 计算 SHA-256 hex（异步，运行时守卫推荐）。 */
export async function asyncSha256Hex(input: string): Promise<string> {
  if (typeof globalThis.crypto?.subtle?.digest === "function") {
    const buf = new TextEncoder().encode(input)
    const digest = await globalThis.crypto.subtle.digest("SHA-256", buf)
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  }
  return fnv1a64(input)
}

/**
 * 会话内前缀守卫：记录首次见到的冻结前缀哈希，后续调用断言一致。
 * 用于检测重构误改导致缓存静默失效。返回 true 表示一致（或首次记录）。
 */
export class PrefixGuard {
  private seen: string | null = null
  /** 断言前缀未漂移；首次调用记录基准。返回是否一致。 */
  async assertStable(prefix: string): Promise<boolean> {
    const h = await asyncSha256Hex(prefix)
    if (this.seen === null) {
      this.seen = h
      return true
    }
    return this.seen === h
  }
  reset(): void {
    this.seen = null
  }
}

const DECODER = new TextDecoder()
const NATIVE_HTTP_TIMEOUT_MS = 15 * 60 * 1000

export function shouldUseNativeHttpForLlm(_config: LlmConfig): boolean {
  // Only force native HTTP when explicitly requested via a flag or when
  // fetch streaming is known to fail. By default, custom providers use
  // standard fetch with ReadableStream for true streaming.
  return false
}

export function extractAssistantTextFromResponse(responseText: string): string {
  const trimmed = responseText.trim()
  if (trimmed.startsWith("<")) {
    const preview = trimmed.slice(0, 80).replace(/\s+/g, " ")
    throw new Error(
      `服务器返回了 HTML 而不是 JSON（通常是 endpoint 路径错误，多数中转站需要 /v1 后缀）。响应开头：${preview}`,
    )
  }
  let parsed: { choices?: Array<{ message?: { content?: string | null } }> }
  try {
    parsed = JSON.parse(responseText)
  } catch {
    const preview = trimmed.slice(0, 120)
    throw new Error(`无法解析服务器响应（非 JSON）：${preview}`)
  }
  const content = parsed.choices?.[0]?.message?.content
  if (typeof content !== "string" || content.length === 0) {
    throw new Error("No assistant content found")
  }
  return content
}

function createAbortError(): Error {
  const error = new Error("Request aborted")
  error.name = "AbortError"
  return error
}

export function waitForNativeHttpResponse(
  request: Promise<string>,
  signal?: AbortSignal,
  timeoutMs = NATIVE_HTTP_TIMEOUT_MS,
): Promise<string> {
  if (signal?.aborted) {
    return Promise.reject(createAbortError())
  }

  return new Promise((resolve, reject) => {
    let settled = false
    let timeoutId: ReturnType<typeof setTimeout> | undefined

    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId)
      signal?.removeEventListener("abort", onAbort)
    }

    const settle = (callback: () => void) => {
      if (settled) return
      settled = true
      cleanup()
      callback()
    }

    const onAbort = () => {
      settle(() => reject(createAbortError()))
    }

    timeoutId = setTimeout(() => {
      settle(() =>
        reject(
          new Error(
            "Request timed out or network error. The model may need more time — try again or use a faster model.",
          ),
        ),
      )
    }, timeoutMs)

    signal?.addEventListener("abort", onAbort, { once: true })

    request.then(
      (responseText) => settle(() => resolve(responseText)),
      (err) => settle(() => reject(err)),
    )
  })
}

function parseLines(chunk: Uint8Array, buffer: string): [string[], string] {
  const text = buffer + DECODER.decode(chunk, { stream: true })
  const lines = text.split("\n")
  const remaining = lines.pop() ?? ""
  return [lines, remaining]
}

export async function streamChat(
  config: LlmConfig,
  messages: import("./llm-providers").ChatMessage[],
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
  options?: { modelOverride?: string },
): Promise<void> {
  // 辅助调用（repair/压缩/重试）可钉死到更便宜的模型，降低成本（P2）
  const effectiveConfig: LlmConfig = options?.modelOverride
    ? { ...config, model: options.modelOverride }
    : config
  // DeepSeek 前缀缓存 TTL 计时：每次真实请求发起即记录（TTL 冷恢复依赖此状态）
  recordDeepSeekRequest(effectiveConfig)
  const providerConfig = getProviderConfig(effectiveConfig)
  const requestBody = providerConfig.buildBody(messages)

  const reqId = Math.random().toString(36).slice(2, 8)
  const startTime = Date.now()
  const totalChars = messages.reduce((acc, m) => acc + m.content.length, 0)
  debugLog("info", "llm-client", `Request ${reqId} start`, {
    provider: config.provider,
    model: config.model,
    url: providerConfig.url,
    messageCount: messages.length,
    totalChars,
    isOpenAiCompatible: providerConfig.isOpenAiCompatible,
    hasNonStreamingParser: Boolean(providerConfig.parseNonStreamingResponse),
  })

  let tokenCount = 0
  let usage: TokenUsage | undefined = undefined
  const onToken = (t: string) => {
    tokenCount++
    callbacks.onToken(t)
  }
  const onDone = () => {
    const durationMs = Date.now() - startTime
    const cacheHitRatePct =
      usage?.promptTokens && usage.cacheHitTokens
        ? Math.round((usage.cacheHitTokens / usage.promptTokens) * 100)
        : undefined
    debugLog("info", "llm-client", `Request ${reqId} done`, {
      tokenCount,
      durationMs,
      promptTokens: usage?.promptTokens,
      completionTokens: usage?.completionTokens,
      totalTokens: usage?.totalTokens,
      cacheHitTokens: usage?.cacheHitTokens,
      cacheHitRatePct,
    })
    if (durationMs > PREFIX_CACHE_TTL_WARN_MS) {
      debugLog(
        "warn",
        "llm-client",
        `Request ${reqId} ran ${(durationMs / 60000).toFixed(1)} min — DeepSeek prefix cache (TTL ~5 min) likely expired mid-run, inflating input token cost. Consider smaller ingest batches.`,
      )
    }
    callbacks.onDone(usage)
  }
  const onError = (e: Error) => {
    debugLog("error", "llm-client", `Request ${reqId} error`, {
      tokenCount,
      message: e.message,
      rawResponse: (e as any).rawResponse,
      parsed: (e as any).parsed,
    })
    callbacks.onError(e)
  }

  if (shouldUseNativeHttpForLlm(config)) {
    try {
      const nonStreamingBody =
        requestBody && typeof requestBody === "object"
          ? { ...(requestBody as Record<string, unknown>), stream: false }
          : requestBody
      const responseText = await waitForNativeHttpResponse(
        postJsonViaNativeHttp(
          providerConfig.url,
          providerConfig.headers,
          nonStreamingBody,
        ),
        signal,
      )
      const parser =
        providerConfig.parseNonStreamingResponse ?? extractAssistantTextFromResponse
      const content = parser(responseText)
      onToken(content)
      onDone()
      return
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError" && signal?.aborted) {
        onDone()
        return
      }
      onError(err instanceof Error ? err : new Error(String(err)))
      return
    }
  }

  // Create a combined signal: user abort OR 15-minute timeout
  const timeoutMs = NATIVE_HTTP_TIMEOUT_MS // 15 minutes — some models with large context need a long time
  let combinedSignal = signal
  let timeoutController: AbortController | undefined

  let abortListener: (() => void) | undefined
  let timeoutId: ReturnType<typeof setTimeout> | undefined

  if (typeof AbortSignal.timeout === "function") {
    // Combine user signal with timeout
    timeoutController = new AbortController()
    timeoutId = setTimeout(() => timeoutController?.abort(), timeoutMs)

    if (signal) {
      abortListener = () => {
        if (timeoutId) clearTimeout(timeoutId)
        timeoutController?.abort()
      }
      signal.addEventListener("abort", abortListener)
    }
    combinedSignal = timeoutController.signal
  }

  let response: Response
  try {
    response = await fetch(providerConfig.url, {
      method: "POST",
      headers: providerConfig.headers,
      body: JSON.stringify(requestBody),
      signal: combinedSignal,
      // @ts-ignore — keepalive hint for Tauri webview
      keepalive: false,
    })
  } catch (err) {
    if (err instanceof Error && (err.name === "AbortError" || err.message === "Load failed")) {
      // Check if it was user-initiated abort
      if (signal?.aborted) {
        onDone()
        return
      }
      // Otherwise it's a timeout or network error
      onError(new Error("Request timed out or network error. The model may need more time — try again or use a faster model."))
      return
    }
    // "Failed to fetch" / "Load failed" 在 Tauri WebView 里通常是 CORS 或 DNS 问题。
    // OpenAI 兼容 provider 自动 fallback 到 native HTTP（非流式），绕过 WebView 限制。
    const isNetworkLikeError =
      err instanceof Error &&
      (err.message.includes("Failed to fetch") ||
        err.message.includes("Load failed") ||
        err.message.includes("NetworkError"))
    const canFallback =
      providerConfig.isOpenAiCompatible || Boolean(providerConfig.parseNonStreamingResponse)
    if (isNetworkLikeError && canFallback) {
      debugLog("warn", "llm-client", `Request ${reqId} streaming failed, falling back to native HTTP`, {
        url: providerConfig.url,
        originalError: err instanceof Error ? err.message : String(err),
      })
      try {
        const nonStreamingBody =
          requestBody && typeof requestBody === "object"
            ? { ...(requestBody as Record<string, unknown>), stream: false }
            : requestBody
        const responseText = await waitForNativeHttpResponse(
          postJsonViaNativeHttp(providerConfig.url, providerConfig.headers, nonStreamingBody),
          signal,
        )
        const parser =
          providerConfig.parseNonStreamingResponse ?? extractAssistantTextFromResponse
        const content = parser(responseText)
        onToken(content)
        onDone()
        return
      } catch (fallbackErr) {
        if (fallbackErr instanceof Error && fallbackErr.name === "AbortError" && signal?.aborted) {
          onDone()
          return
        }
        onError(
          fallbackErr instanceof Error ? fallbackErr : new Error(String(fallbackErr)),
        )
        return
      }
    }
    onError(err instanceof Error ? err : new Error(String(err)))
    return
  }

  if (!response.ok) {
    let errorDetail = `HTTP ${response.status}: ${response.statusText}`
    try {
      const body = await response.text()
      if (body) errorDetail += ` — ${body}`
    } catch {
      // ignore body read failure
    }
    onError(new Error(errorDetail))
    return
  }

  if (!response.body) {
    onError(new Error("Response body is null"))
    return
  }

  const reader = response.body.getReader()
  let lineBuffer = ""

  try {
    while (true) {
      const { done, value } = await reader.read()

      if (done) {
        if (lineBuffer.trim()) {
          const token = providerConfig.parseStream(lineBuffer.trim())
          if (token !== null) onToken(token)
          const u = providerConfig.parseUsage?.(lineBuffer.trim())
          if (u) usage = mergeUsage(usage, u)
        }
        break
      }

      const [lines, remaining] = parseLines(value, lineBuffer)
      lineBuffer = remaining

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        const token = providerConfig.parseStream(trimmed)
        if (token !== null) onToken(token)
        const u = providerConfig.parseUsage?.(trimmed)
        if (u) usage = mergeUsage(usage, u)
      }
    }

    onDone()
  } catch (err) {
    if (err instanceof Error && (err.name === "AbortError" || (signal?.aborted))) {
      onDone()
      return
    }
    if (err instanceof Error && err.message === "Load failed") {
      // WebKit network error during streaming — connection dropped
      onError(new Error("Connection lost during streaming. Try again."))
      return
    }
    onError(err instanceof Error ? err : new Error(String(err)))
  } finally {
    reader.releaseLock()
    if (timeoutId) clearTimeout(timeoutId)
    if (signal && abortListener) {
      signal.removeEventListener("abort", abortListener)
    }
  }
}
