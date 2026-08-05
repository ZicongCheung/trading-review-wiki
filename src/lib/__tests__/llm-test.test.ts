import { describe, it, expect, vi, afterEach } from "vitest"
import { fetchDeepSeekModels } from "../llm-test"

function mockFetch(body: unknown, status = 200) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("fetchDeepSeekModels", () => {
  it("parses the OpenAI-compatible /models listing", async () => {
    const fetchMock = mockFetch({
      object: "list",
      data: [
        { id: "deepseek-chat", object: "model" },
        { id: "deepseek-reasoner", object: "model" },
        { id: "deepseek-v4-flash", object: "model" },
      ],
    })
    vi.stubGlobal("fetch", fetchMock)

    const models = await fetchDeepSeekModels("https://api.deepseek.com/v1", "sk-test")

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.deepseek.com/v1/models",
      expect.objectContaining({ headers: { Authorization: "Bearer sk-test" } }),
    )
    expect(models).toEqual(["deepseek-chat", "deepseek-reasoner", "deepseek-v4-flash"])
  })

  it("returns [] on non-ok status (falls back to static list)", async () => {
    vi.stubGlobal("fetch", mockFetch({ error: "unauthorized" }, 401))
    const models = await fetchDeepSeekModels("", "bad-key")
    expect(models).toEqual([])
  })

  it("returns [] and does not throw on network error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down")
      }) as unknown as typeof fetch,
    )
    const models = await fetchDeepSeekModels("https://api.deepseek.com/v1", "sk-test")
    expect(models).toEqual([])
  })

  it("strips a trailing slash from the endpoint", async () => {
    const fetchMock = mockFetch({ data: [{ id: "deepseek-v4-pro" }] })
    vi.stubGlobal("fetch", fetchMock)
    await fetchDeepSeekModels("https://api.deepseek.com/v1/", "sk-test")
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.deepseek.com/v1/models",
      expect.anything(),
    )
  })
})
