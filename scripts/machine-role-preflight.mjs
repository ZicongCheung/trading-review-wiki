#!/usr/bin/env node
import { execFile as execFileCallback } from "node:child_process"
import fs from "node:fs/promises"
import { constants as fsConstants } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

const execFile = promisify(execFileCallback)

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(MODULE_DIR, "..")
const IN_REPO_WORKSPACE = path.join(REPO_ROOT, "zTradingData", "小张的交易复盘")

function resolveDefaultProject() {
  const fromEnv = (process.env.TRADING_WIKI_PROJECT || "").trim()
  if (fromEnv) return path.resolve(fromEnv)
  return IN_REPO_WORKSPACE
}

function usage() {
  return `Usage:
  node scripts/machine-role-preflight.mjs [options]

Options:
  --role prod|research        Machine role. Aliases: old, automation, new, dev.
  --repo <path>               Code repository to check. Defaults to cwd.
  --project <path>            Trading wiki project path. Defaults to TRADING_WIKI_PROJECT or in-repo zTradingData/小张的交易复盘.
  --require-branch <branch>   Fail unless the repo is on this branch.
  --allow-dirty[=true|false]  Allow uncommitted repo changes. Defaults to false.
  --skip-secret-scan          Skip path-only github_pat_ scan.
  --json                      Print machine-readable JSON.
  --help                      Show this help.

Examples:
  npm run machine:preflight -- --role prod --require-branch main
  npm run machine:preflight -- --role research --project /path/to/wiki-snapshots/latest --allow-dirty
`
}

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected argument: ${arg}`)
    }
    const withoutPrefix = arg.slice(2)
    const eqIndex = withoutPrefix.indexOf("=")
    if (eqIndex !== -1) {
      args[withoutPrefix.slice(0, eqIndex)] = withoutPrefix.slice(eqIndex + 1)
      continue
    }
    const next = argv[i + 1]
    if (!next || next.startsWith("--")) {
      args[withoutPrefix] = true
      continue
    }
    args[withoutPrefix] = next
    i += 1
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

function normalizeRole(role) {
  const normalized = String(role || process.env.TRADING_WIKI_MACHINE_ROLE || "prod").trim().toLowerCase()
  if (["prod", "old", "automation", "ingest"].includes(normalized)) return "prod"
  if (["research", "new", "dev", "training"].includes(normalized)) return "research"
  throw new Error(`Unsupported role: ${role}`)
}

function clean(value) {
  return String(value ?? "").trim()
}

async function run(command, args, options = {}) {
  try {
    return await execFile(command, args, {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      ...options,
    })
  } catch (err) {
    err.stdout = clean(err.stdout)
    err.stderr = clean(err.stderr)
    throw err
  }
}

async function git(repo, args) {
  const result = await run("git", ["-C", repo, ...args])
  return clean(result.stdout)
}

async function accessCheck(targetPath, mode) {
  try {
    await fs.access(targetPath, mode)
    return true
  } catch {
    return false
  }
}

function addCheck(checks, status, name, detail = "") {
  checks.push({ status, name, detail })
}

function isSnapshotLike(projectPath) {
  return projectPath.includes(`${path.sep}杰杰杰-snapshots${path.sep}`) || projectPath.endsWith(`${path.sep}杰杰杰-snapshots${path.sep}latest`)
}

async function scanForPatFiles(repoRoot) {
  try {
    const result = await run("rg", ["--files-with-matches", "github_pat_", "-g", "!.git", repoRoot])
    return clean(result.stdout).split(/\r?\n/).filter(Boolean)
  } catch (err) {
    if (err.code === 1) return []
    if (err.code === "ENOENT") return null
    throw err
  }
}

function printReport(report) {
  console.log(`Machine role preflight: ${report.role}`)
  console.log(`Host: ${report.host}`)
  console.log(`Repo: ${report.repoRoot || report.repo}`)
  console.log(`Project: ${report.project}`)
  if (report.branch || report.commit) {
    console.log(`Git: ${[report.branch, report.commit].filter(Boolean).join(" @ ")}`)
  }
  for (const check of report.checks) {
    const tag = check.status.toUpperCase().padEnd(4, " ")
    console.log(`[${tag}] ${check.name}${check.detail ? ` - ${check.detail}` : ""}`)
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(usage())
    return
  }

  const role = normalizeRole(args.role)
  const repo = path.resolve(String(args.repo || process.cwd()))
  const project = path.resolve(String(args.project || resolveDefaultProject()))
  const allowDirty = parseBoolean(args["allow-dirty"], false)
  const skipSecretScan = parseBoolean(args["skip-secret-scan"], false)
  const json = parseBoolean(args.json, false)
  const requireBranch = args["require-branch"] ? String(args["require-branch"]) : ""
  const checks = []
  const report = {
    role,
    host: os.hostname(),
    repo,
    project,
    checks,
  }

  try {
    report.repoRoot = await git(repo, ["rev-parse", "--show-toplevel"])
    report.branch = await git(repo, ["rev-parse", "--abbrev-ref", "HEAD"])
    report.commit = await git(repo, ["rev-parse", "--short=12", "HEAD"])
    addCheck(checks, "pass", "git repository", report.repoRoot)

    if (requireBranch && report.branch !== requireBranch) {
      addCheck(checks, "fail", "required branch", `expected ${requireBranch}, got ${report.branch}`)
    } else if (requireBranch) {
      addCheck(checks, "pass", "required branch", requireBranch)
    }

    const status = await git(repo, ["status", "--porcelain=v1"])
    if (status) {
      const changedCount = status.split(/\r?\n/).filter(Boolean).length
      if (allowDirty) {
        addCheck(checks, "warn", "git working tree", `${changedCount} changed path(s), allowed by --allow-dirty`)
      } else {
        addCheck(checks, "fail", "git working tree", `${changedCount} changed path(s); commit, stash, or rerun with --allow-dirty`)
      }
    } else {
      addCheck(checks, "pass", "git working tree", "clean")
    }
  } catch (err) {
    addCheck(checks, "fail", "git repository", clean(err.stderr || err.message))
  }

  const projectReadable = await accessCheck(project, fsConstants.R_OK)
  if (!projectReadable) {
    addCheck(checks, "fail", "project readable", project)
  } else {
    addCheck(checks, "pass", "project readable", project)
  }

  for (const dir of ["raw", "wiki", "data"]) {
    const target = path.join(project, dir)
    const exists = await accessCheck(target, fsConstants.R_OK)
    if (!exists) {
      addCheck(checks, "fail", `${dir}/ exists`, target)
      continue
    }
    if (role === "prod") {
      const writable = await accessCheck(target, fsConstants.R_OK | fsConstants.W_OK)
      addCheck(checks, writable ? "pass" : "fail", `${dir}/ writable`, target)
    } else {
      addCheck(checks, "pass", `${dir}/ readable`, target)
    }
  }

  if (role === "research" && !isSnapshotLike(project)) {
    addCheck(checks, "warn", "research project path", "prefer a snapshot path such as <wiki>-snapshots/latest")
  }

  if (role === "prod") {
    const llmWiki = path.join(project, ".llm-wiki")
    const writable = await accessCheck(llmWiki, fsConstants.R_OK | fsConstants.W_OK)
    addCheck(checks, writable ? "pass" : "warn", ".llm-wiki writable", writable ? llmWiki : `${llmWiki} not writable or absent`)
  }

  if (!skipSecretScan && report.repoRoot) {
    const matches = await scanForPatFiles(report.repoRoot)
    if (matches == null) {
      addCheck(checks, "warn", "secret path scan", "rg not found; skipped github_pat_ file-path scan")
    } else if (matches.length > 0) {
      addCheck(checks, "fail", "secret path scan", `github_pat_ appears in: ${matches.join(", ")}`)
    } else {
      addCheck(checks, "pass", "secret path scan", "no github_pat_ matches")
    }
  } else if (skipSecretScan) {
    addCheck(checks, "warn", "secret path scan", "skipped by option")
  }

  if (!process.env.CODEX_HOME) {
    addCheck(checks, "warn", "CODEX_HOME", "empty; automation wrappers should use absolute fallback paths")
  } else {
    addCheck(checks, "pass", "CODEX_HOME", process.env.CODEX_HOME)
  }

  const hasFailure = checks.some((check) => check.status === "fail")
  if (json) {
    console.log(JSON.stringify({ ...report, ok: !hasFailure }, null, 2))
  } else {
    printReport(report)
  }
  if (hasFailure) process.exitCode = 1
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exitCode = 1
})
