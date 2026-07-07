#!/usr/bin/env node
import { runCli } from "./codex-ingest/cli/index.mjs"

runCli().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  const manifestPath = err?.manifestRelativePath ?? err?.manifestPath
  if (manifestPath) console.error(`Audit manifest: ${manifestPath}`)
  process.exitCode = 1
})
