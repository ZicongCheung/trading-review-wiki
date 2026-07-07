const BOOLEAN_FLAGS = new Set([
  "write",
  "no-report",
  "allow-source-change",
  "help",
  "show-context",
  "show-sources",
  "include-invalidated",
  "validate-pending-only",
  "deep",
  "plugin-led",
  "plugin-review",
  "plugin-optimize",
  "force-investment-banking-review",
  "overwrite",
  "no-ocr",
  "agentic",
  "no-agent-artifacts",
  "disable-sse-fallback",
  "no-llm-question-planner",
  "no-loop-artifacts",
  "no-phase-run-artifacts",
  "allow-anchored-external-market",
  "self-train-write",
  "execute",
  "execute-policy-regressions",
  "apply-policy-regression-patches",
  "json",
  "dry-run",
  "force",
  "no-extract",
  "verbose",
  "compact",
  "include-reviewed",
  "ingest",
  "apply-ingest",
  "auto-market-evidence",
  "auto-microstructure-evidence",
  "judgments",
  "embedding-routing",
])

export function parseArgs(argv) {
  const args = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (!token.startsWith("--")) {
      args._.push(token)
      continue
    }
    const key = token.slice(2)
    if (BOOLEAN_FLAGS.has(key)) {
      args[key] = true
      continue
    }
    const value = argv[i + 1]
    if (value == null || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}`)
    }
    args[key] = value
    i += 1
  }
  return args
}

export function requireArg(args, name) {
  if (!args[name]) throw new Error(`Missing required --${name}`)
  return args[name]
}
