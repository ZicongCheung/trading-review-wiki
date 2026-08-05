import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// Hand off deferred autoIngest resolvers via globalThis. A plain `const` array
// referenced inside the vi.mock factory would be captured as a DIFFERENT binding
// than the one the test body reads (vitest hoisting quirk), so we use a single
// shared object instead.
declare global {
  // eslint-disable-next-line no-var
  var __ingestResolvers: Array<(v: string[]) => void>
}
globalThis.__ingestResolvers = []

vi.mock("@/lib/ingest", () => ({
  autoIngest: vi.fn(
    () =>
      new Promise<string[]>((resolve) => {
        globalThis.__ingestResolvers.push(resolve)
      }),
  ),
}))

// Provide a minimal wiki/chat store so processNext can read llmConfig.
vi.mock("@/stores/wiki-store", () => ({
  useWikiStore: {
    getState: () => ({
      llmConfig: { provider: "custom", apiKey: "k", endpoint: "http://x" },
    }),
  },
}))
vi.mock("@/stores/chat-store", () => ({
  useChatStore: { getState: () => ({ activeConversationId: null }) },
}))
vi.mock("@/commands/fs", () => ({ readFile: vi.fn(), writeFile: vi.fn() }))
vi.mock("@/lib/ingest-stream-hooks", () => ({ makeChatStreamHooks: () => undefined }))

import {
  enqueueBatch,
  pauseQueue,
  resumeQueue,
  isPaused,
  getQueueSummary,
} from "@/lib/ingest-queue"

const tick = (ms = 20) => new Promise((res) => setTimeout(res, ms))

// Resolve the next started task and let its continuation settle.
async function finishOne(): Promise<void> {
  // poll until the resolver is actually pushed (avoids fixed-tick races)
  for (let i = 0; i < 250 && globalThis.__ingestResolvers.length === 0; i++) {
    await new Promise((r) => setTimeout(r, 2))
  }
  expect(globalThis.__ingestResolvers.length).toBeGreaterThan(0)
  const r = globalThis.__ingestResolvers.shift()!
  r([])
  await tick()
}

// Force the module-level queue back to empty between tests so the singleton
// `queue`/`paused`/`processing` state never leaks across cases.
async function resetQueue(): Promise<void> {
  resumeQueue("proj") // clear any pause so draining can proceed
  for (let i = 0; i < 50; i++) {
    if (getQueueSummary().total === 0 && globalThis.__ingestResolvers.length === 0) break
    if (globalThis.__ingestResolvers.length > 0) {
      const r = globalThis.__ingestResolvers.shift()!
      r([])
    }
    await tick()
  }
  globalThis.__ingestResolvers.length = 0
}

beforeEach(() => {
  globalThis.__ingestResolvers.length = 0
})

afterEach(async () => {
  await resetQueue()
})

describe("ingest queue pause/resume", () => {
  it("finishes the current task then stops when paused; resumes on demand", async () => {
    await enqueueBatch("proj", [
      { sourcePath: "raw/sources/a.pdf", folderContext: "" },
      { sourcePath: "raw/sources/b.pdf", folderContext: "" },
    ])

    expect(getQueueSummary().processing).toBe(1)
    expect(getQueueSummary().total).toBe(2)

    pauseQueue()
    expect(isPaused()).toBe(true)

    await finishOne() // a finishes

    // a done; b must NOT have started (paused) — no second autoIngest call
    expect(getQueueSummary().total).toBe(1)
    expect(getQueueSummary().processing).toBe(0)
    expect(globalThis.__ingestResolvers.length).toBe(0)

    resumeQueue("proj")
    await tick()
    expect(getQueueSummary().processing).toBe(1)

    await finishOne() // b finishes
    expect(getQueueSummary().total).toBe(0)
  })

  it("does not start anything when paused before processing begins", async () => {
    pauseQueue()
    await enqueueBatch("proj", [{ sourcePath: "raw/sources/c.pdf", folderContext: "" }])
    await tick()
    expect(getQueueSummary().total).toBe(1)
    expect(getQueueSummary().processing).toBe(0)
    expect(globalThis.__ingestResolvers.length).toBe(0)

    resumeQueue("proj")
    await tick()
    expect(getQueueSummary().processing).toBe(1)
    await finishOne()
    expect(getQueueSummary().total).toBe(0)
  })
})
