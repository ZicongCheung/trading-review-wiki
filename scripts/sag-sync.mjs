#!/usr/bin/env node
import { runCli } from "./codex-ingest/cli/index.mjs"

runCli(["sag-sync", ...process.argv.slice(2)]).catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exitCode = 1
})
