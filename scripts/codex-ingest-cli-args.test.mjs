import { describe, expect, it } from "vitest"

import { parseArgs } from "./codex-ingest/cli/args.mjs"

describe("codex ingest CLI args", () => {
  it("parses include-reviewed as a boolean flag for review queues", () => {
    expect(parseArgs(["stock-feedback", "review-queue", "--include-reviewed", "--limit", "12"])).toMatchObject({
      _: ["stock-feedback", "review-queue"],
      "include-reviewed": true,
      limit: "12",
    })
  })
})
