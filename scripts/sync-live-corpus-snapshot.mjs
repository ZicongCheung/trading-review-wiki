#!/usr/bin/env node
import { execFile as execFileCallback } from "node:child_process"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

const execFile = promisify(execFileCallback)

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(MODULE_DIR, "..")
const IN_REPO_WORKSPACE = path.join(REPO_ROOT, "zTradingData", "小张的交易复盘")

function resolveDefaultSource() {
  const fromEnv = (process.env.TRADING_WIKI_PROJECT || "").trim()
  if (fromEnv) return path.resolve(fromEnv)
  return IN_REPO_WORKSPACE
}

function resolveDefaultDestRoot(source) {
  const fromEnv = (process.env.TRADING_WIKI_SNAPSHOT_ROOT || "").trim()
  if (fromEnv) return path.resolve(fromEnv)
  return `${String(source).replace(/[\\/]+$/, "")}-snapshots`
}

const DEFAULT_EXCLUDES = [
  ".git/",
  "node_modules/",
  ".venv/",
  "dist/",
  ".DS_Store",
  "*.tmp",
  "*.swp",
]

function usage() {
  return `Usage:
  node scripts/sync-live-corpus-snapshot.mjs [options]

Options:
  --source <path>             Live wiki source. Defaults to TRADING_WIKI_PROJECT or in-repo zTradingData/小张的交易复盘.
  --dest-root <path>          Snapshot root. Defaults to TRADING_WIKI_SNAPSHOT_ROOT or <source>-snapshots.
  --name <name>               Snapshot directory name. Defaults to Beijing timestamp.
  --exclude <pattern>         Extra rsync exclude. Can be repeated.
  --no-delete                 Do not delete stale files in an existing snapshot dir.
  --no-latest                 Do not update latest symlink.
  --dry-run                   Print rsync changes without writing.
  --rsync-bin <path>          rsync binary. Defaults to rsync.
  --json                      Print machine-readable JSON summary.
  --help                      Show this help.

Examples:
  npm run machine:snapshot -- --source /path/to/live-wiki
  npm run machine:snapshot -- --dry-run --name test
`
}

function parseArgs(argv) {
  const args = { exclude: [] }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected argument: ${arg}`)
    }
    const withoutPrefix = arg.slice(2)
    const eqIndex = withoutPrefix.indexOf("=")
    const key = eqIndex === -1 ? withoutPrefix : withoutPrefix.slice(0, eqIndex)
    const inlineValue = eqIndex === -1 ? null : withoutPrefix.slice(eqIndex + 1)
    let value = inlineValue
    if (value == null) {
      const next = argv[i + 1]
      if (!next || next.startsWith("--")) {
        value = true
      } else {
        value = next
        i += 1
      }
    }
    if (key === "exclude") {
      args.exclude.push(String(value))
    } else {
      args[key] = value
    }
  }
  return args
}

function parseBoolean(value, defaultValue = false) {
  if (value == null) return defaultValue
  if (value === true) return true
  if (value === false) return false
  const normalized = String(value).trim().toLowerCase()
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false
  throw new Error(`Invalid boolean value: ${value}`)
}

function shanghaiStamp(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
  const parts = Object.fromEntries(formatter.formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day}-${parts.hour}${parts.minute}${parts.second}`
}

function ensureTrailingSlash(value) {
  return value.endsWith(path.sep) ? value : `${value}${path.sep}`
}

function isSameOrInside(childPath, parentPath) {
  const child = path.resolve(childPath)
  const parent = path.resolve(parentPath)
  return child === parent || child.startsWith(`${parent}${path.sep}`)
}

async function assertSourceLooksLikeWiki(source) {
  const required = ["raw", "wiki", "data"]
  const missing = []
  for (const dir of required) {
    try {
      await fs.access(path.join(source, dir))
    } catch {
      missing.push(dir)
    }
  }
  if (missing.length > 0) {
    throw new Error(`Source does not look like a Trading Review Wiki project. Missing: ${missing.join(", ")}`)
  }
}

async function run(command, args, options = {}) {
  return execFile(command, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  })
}

async function updateLatestSymlink(destRoot, dest, dryRun) {
  const latest = path.join(destRoot, "latest")
  const target = path.basename(dest)
  if (dryRun) return { latest, target, updated: false }

  try {
    const stat = await fs.lstat(latest)
    if (stat.isDirectory() && !stat.isSymbolicLink()) {
      return { latest, target, updated: false, warning: "latest exists as a real directory; left untouched" }
    }
    await fs.rm(latest, { force: true })
  } catch (err) {
    if (err.code !== "ENOENT") throw err
  }
  await fs.symlink(target, latest)
  return { latest, target, updated: true }
}

async function writeMarker(dest, meta) {
  const jsonPath = path.join(dest, ".snapshot-meta.json")
  const readmePath = path.join(dest, "SNAPSHOT_README.md")
  await fs.writeFile(jsonPath, `${JSON.stringify(meta, null, 2)}\n`)
  await fs.writeFile(readmePath, `# Trading Review Wiki Snapshot

This directory is a research snapshot copied from the production live corpus.

- Source: ${meta.source}
- Snapshot: ${meta.dest}
- Generated at: ${meta.generatedAt}
- Host: ${meta.host}

Use this snapshot for retrieval, training, indexing, and experiments. Do not treat writes here as production wiki updates.
`)
}

function printSummary(summary) {
  console.log(`Snapshot source: ${summary.source}`)
  console.log(`Snapshot dest: ${summary.dest}`)
  console.log(`Dry run: ${summary.dryRun ? "yes" : "no"}`)
  console.log(`Delete stale files: ${summary.deleteStale ? "yes" : "no"}`)
  console.log(`rsync exit: ${summary.rsyncExitCode}`)
  if (summary.latest?.latest) {
    const action = summary.latest.updated ? "updated" : "not updated"
    console.log(`Latest symlink: ${summary.latest.latest} -> ${summary.latest.target} (${action})`)
    if (summary.latest.warning) console.log(`Latest warning: ${summary.latest.warning}`)
  }
  if (summary.rsyncStdout) {
    console.log("")
    console.log(summary.rsyncStdout.trimEnd())
  }
  if (summary.rsyncStderr) {
    console.error(summary.rsyncStderr.trimEnd())
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(usage())
    return
  }

  const source = path.resolve(String(args.source || resolveDefaultSource()))
  const destRoot = path.resolve(String(args["dest-root"] || resolveDefaultDestRoot(source)))
  const name = String(args.name || shanghaiStamp())
  if (name.includes(path.sep) || name === "." || name === "..") {
    throw new Error(`Invalid snapshot name: ${name}`)
  }
  const dest = path.join(destRoot, name)
  if (isSameOrInside(dest, source)) {
    throw new Error(`Refusing to write snapshot inside the source project: ${dest}`)
  }

  const dryRun = parseBoolean(args["dry-run"], false)
  const json = parseBoolean(args.json, false)
  const updateLatest = !parseBoolean(args["no-latest"], false)
  const deleteStale = !parseBoolean(args["no-delete"], false)
  const rsyncBin = String(args["rsync-bin"] || "rsync")
  const excludes = [...DEFAULT_EXCLUDES, ...args.exclude]

  await assertSourceLooksLikeWiki(source)
  if (!dryRun) await fs.mkdir(dest, { recursive: true })

  const rsyncArgs = ["-a", "--human-readable", "--itemize-changes"]
  if (deleteStale) rsyncArgs.push("--delete")
  if (dryRun) rsyncArgs.push("--dry-run")
  for (const pattern of excludes) rsyncArgs.push("--exclude", pattern)
  rsyncArgs.push(ensureTrailingSlash(source), ensureTrailingSlash(dest))

  const rsync = await run(rsyncBin, rsyncArgs)
  const generatedAt = new Date().toISOString()
  const meta = {
    source,
    dest,
    generatedAt,
    host: os.hostname(),
    excludes,
    deleteStale,
    dryRun,
  }
  let latest = null
  if (!dryRun) {
    await writeMarker(dest, meta)
    if (updateLatest) latest = await updateLatestSymlink(destRoot, dest, dryRun)
  } else if (updateLatest) {
    latest = { latest: path.join(destRoot, "latest"), target: path.basename(dest), updated: false }
  }

  const summary = {
    ...meta,
    rsyncExitCode: 0,
    rsyncStdout: rsync.stdout,
    rsyncStderr: rsync.stderr,
    latest,
  }

  if (json) {
    console.log(JSON.stringify(summary, null, 2))
  } else {
    printSummary(summary)
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exitCode = 1
})
