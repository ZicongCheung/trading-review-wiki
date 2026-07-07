import fs from "node:fs/promises"
import path from "node:path"
import { createHash } from "node:crypto"

import {
  DEFAULT_PROJECT_PATH,
  ensureDirectory,
  normalizePath,
  readTextFile,
  writeJson,
} from "./core.mjs"

export const DEFAULT_SAG_API_BASE = "http://127.0.0.1:4173"
export const DEFAULT_SAG_PROJECT_NAME = "Trading Review Wiki - Wiki Sidecar"
export const SAG_SYNC_ROOT = ".llm-wiki/sag-sync"
export const DEFAULT_SAG_SYNC_MAX_CONTENT_BYTES = 900_000

function nowIso() {
  return new Date().toISOString()
}

function normalizeRelativePath(filePath) {
  return String(filePath ?? "").replace(/\\/g, "/").replace(/^\/+/, "")
}

function normalizeSyncRoot(value) {
  const normalized = normalizeRelativePath(value || SAG_SYNC_ROOT).replace(/\/+$/, "")
  if (!normalized || normalized === "." || normalized.includes("..")) {
    throw new Error("Invalid SAG sync root")
  }
  return normalized
}

function hashContent(content) {
  return createHash("sha256").update(content).digest("hex")
}

function safeErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/(api[_-]?key|token|password|secret)=([^&\s]+)/gi, "$1=[redacted]")
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.floor(parsed)
}

function parseNonNegativeInteger(value, fallback) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return fallback
  return Math.floor(parsed)
}

export function isSagSyncableWikiPath(filePath) {
  const relativePath = normalizeRelativePath(filePath)
  if (!relativePath.startsWith("wiki/")) return false
  if (!relativePath.endsWith(".md")) return false
  if (relativePath === "wiki/log.md") return false
  if (relativePath.startsWith("wiki/logs/")) return false
  if (relativePath.startsWith("wiki/scripts/")) return false
  return true
}

function syncRoot(projectPath, root = SAG_SYNC_ROOT) {
  return path.join(projectPath, normalizeSyncRoot(root))
}

function statePath(projectPath, root = SAG_SYNC_ROOT) {
  return path.join(syncRoot(projectPath, root), "state.json")
}

function pendingPath(projectPath, root = SAG_SYNC_ROOT) {
  return path.join(syncRoot(projectPath, root), "pending.jsonl")
}

async function readJsonIfExists(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"))
  } catch (error) {
    if (error?.code === "ENOENT") return fallback
    throw error
  }
}

async function writeJsonl(filePath, records) {
  await ensureDirectory(path.dirname(filePath))
  const content = records.length ? `${records.map((record) => JSON.stringify(record)).join("\n")}\n` : ""
  await fs.writeFile(filePath, content, "utf8")
}

async function readPending(projectPath, root = SAG_SYNC_ROOT) {
  const filePath = pendingPath(projectPath, root)
  try {
    const raw = await fs.readFile(filePath, "utf8")
    const pendingByPath = new Map()
    for (const record of raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line))) {
      const pendingFilePath = normalizeRelativePath(record.path)
      if (!pendingFilePath) continue
      pendingByPath.set(pendingFilePath, {
        ...record,
        path: pendingFilePath,
      })
    }
    return [...pendingByPath.values()]
  } catch (error) {
    if (error?.code === "ENOENT") return []
    throw error
  }
}

async function appendPending(projectPath, records, root = SAG_SYNC_ROOT) {
  if (!records.length) return
  await ensureDirectory(syncRoot(projectPath, root))
  await fs.appendFile(pendingPath(projectPath, root), `${records.map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8")
}

async function loadState(projectPath, root = SAG_SYNC_ROOT) {
  return readJsonIfExists(statePath(projectPath, root), {
    schema: "trading-review-wiki-sag-sync-state-v1",
    createdAt: nowIso(),
    sagProjectName: DEFAULT_SAG_PROJECT_NAME,
    sagProjectId: null,
    files: {},
    processedReports: {},
  })
}

async function saveState(projectPath, state, root = SAG_SYNC_ROOT) {
  await writeJson(statePath(projectPath, root), {
    ...state,
    updatedAt: nowIso(),
  })
}

function resolveOptions(options = {}) {
  return {
    projectPath: normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH),
    sagApiBase: String(options.sagApiBase ?? process.env.SAG_API_BASE ?? DEFAULT_SAG_API_BASE).replace(/\/+$/, ""),
    sagProjectName: String(options.sagProjectName ?? process.env.SAG_PROJECT_NAME ?? DEFAULT_SAG_PROJECT_NAME),
    syncRoot: normalizeSyncRoot(options.syncRoot ?? process.env.SAG_SYNC_ROOT ?? SAG_SYNC_ROOT),
    fetchImpl: options.fetchImpl ?? globalThis.fetch,
    extract: options.extract ?? true,
    nonblocking: options.nonblocking ?? true,
    maxContentBytes: parsePositiveInteger(
      options.maxContentBytes ?? process.env.SAG_SYNC_MAX_CONTENT_BYTES,
      DEFAULT_SAG_SYNC_MAX_CONTENT_BYTES,
    ),
  }
}

async function requestJson(fetchImpl, url, init = {}) {
  if (typeof fetchImpl !== "function") throw new Error("fetch is not available in this Node runtime")
  const response = await fetchImpl(url, {
    ...init,
    headers: {
      ...(init.body == null ? {} : { "Content-Type": "application/json" }),
      ...(init.headers ?? {}),
    },
  })
  const text = await response.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = null
  }
  if (!response.ok) {
    const message = data?.error?.message ?? text ?? `HTTP ${response.status}`
    throw new Error(message)
  }
  return data
}

export async function ensureSagProject(options = {}) {
  const resolved = resolveOptions(options)
  const state = options.state ?? await loadState(resolved.projectPath, resolved.syncRoot)
  if (state.sagProjectId) {
    return { project: { id: state.sagProjectId, name: state.sagProjectName ?? resolved.sagProjectName }, state }
  }

  const listed = await requestJson(resolved.fetchImpl, `${resolved.sagApiBase}/api/projects?includeArchived=true`)
  let project = listed?.projects?.find((item) => item?.name === resolved.sagProjectName)
  if (!project) {
    const created = await requestJson(resolved.fetchImpl, `${resolved.sagApiBase}/api/projects`, {
      method: "POST",
      body: JSON.stringify({
        name: resolved.sagProjectName,
        description: "Sidecar SAG index for Trading Review Wiki formal wiki/**/*.md pages.",
      }),
    })
    project = created?.project
  }
  if (!project?.id) throw new Error("SAG project response did not include project.id")
  state.sagProjectId = project.id
  state.sagProjectName = project.name ?? resolved.sagProjectName
  await saveState(resolved.projectPath, state, resolved.syncRoot)
  return { project, state }
}

async function listSagDocuments({ fetchImpl, sagApiBase, projectId }) {
  const listed = await requestJson(fetchImpl, `${sagApiBase}/api/projects/${projectId}/documents?includeArchived=true`)
  return Array.isArray(listed?.documents) ? listed.documents : []
}

function metadataWikiPath(document) {
  return normalizeRelativePath(document?.metadata?.wikiPath ?? document?.metadata?.sagSync?.wikiPath ?? "")
}

function metadataContentHash(document) {
  return String(document?.metadata?.wikiContentHash ?? document?.metadata?.sagSync?.wikiContentHash ?? "")
}

async function archiveDocument({ fetchImpl, sagApiBase, documentId }) {
  await requestJson(fetchImpl, `${sagApiBase}/api/documents/${documentId}/archive`, { method: "POST" })
}

export async function syncWikiFileToSag(filePath, options = {}) {
  const resolved = resolveOptions(options)
  const relativePath = normalizeRelativePath(filePath)
  if (!isSagSyncableWikiPath(relativePath)) {
    return { status: "skipped", reason: "not_syncable", path: relativePath }
  }

  const absolutePath = path.join(resolved.projectPath, relativePath)
  const content = await readTextFile(absolutePath)
  const contentHash = hashContent(content)
  const byteLength = Buffer.byteLength(content, "utf8")
  const state = options.state ?? await loadState(resolved.projectPath, resolved.syncRoot)
  if (byteLength > resolved.maxContentBytes) {
    state.files[relativePath] = {
      status: "skipped_too_large",
      contentHash,
      byteLength,
      maxContentBytes: resolved.maxContentBytes,
      checkedAt: nowIso(),
    }
    await saveState(resolved.projectPath, state, resolved.syncRoot)
    return {
      status: "skipped",
      reason: "content_too_large",
      path: relativePath,
      contentHash,
      byteLength,
      maxContentBytes: resolved.maxContentBytes,
    }
  }
  const fileState = state.files[relativePath]
  if (fileState?.contentHash === contentHash && fileState?.status === "indexed" && !options.force) {
    return { status: "skipped", reason: "unchanged_state", path: relativePath, contentHash }
  }

  const { project } = await ensureSagProject({ ...resolved, state })
  const documents = await listSagDocuments({ ...resolved, projectId: project.id })
  const samePathDocuments = documents.filter((document) => metadataWikiPath(document) === relativePath && !document.archivedAt)
  const sameHashDocument = samePathDocuments.find((document) => metadataContentHash(document) === contentHash)
  if (sameHashDocument && !options.force) {
    state.files[relativePath] = {
      status: "indexed",
      contentHash,
      documentId: sameHashDocument.id,
      syncedAt: nowIso(),
    }
    await saveState(resolved.projectPath, state, resolved.syncRoot)
    return { status: "skipped", reason: "unchanged_sag", path: relativePath, contentHash, documentId: sameHashDocument.id }
  }

  const archiveDocumentIds = new Set(samePathDocuments.map((document) => document.id).filter(Boolean))
  if (fileState?.documentId) {
    archiveDocumentIds.add(fileState.documentId)
  }

  for (const documentId of archiveDocumentIds) {
    await archiveDocument({ ...resolved, documentId })
  }

  const ingested = await requestJson(resolved.fetchImpl, `${resolved.sagApiBase}/ingest`, {
    method: "POST",
    body: JSON.stringify({
      sourceId: project.id,
      title: relativePath,
      content,
      extract: Boolean(resolved.extract),
      waitForCompletion: true,
      metadata: {
        wikiPath: relativePath,
        wikiContentHash: contentHash,
        source: "trading-review-wiki",
        syncedAt: nowIso(),
      },
    }),
  })

  state.files[relativePath] = {
    status: "indexed",
    contentHash,
    documentId: ingested?.documentId ?? null,
    syncedAt: nowIso(),
  }
  await saveState(resolved.projectPath, state, resolved.syncRoot)
  return {
    status: "indexed",
    path: relativePath,
    contentHash,
    documentId: ingested?.documentId ?? null,
    archivedPrevious: archiveDocumentIds.size,
  }
}

function isSuccessfulApplyReport(report) {
  if (!report || report.dryRun !== false) return false
  if (Array.isArray(report.fatalIssues) && report.fatalIssues.length > 0) return false
  if (Array.isArray(report.fatalFactIssues) && report.fatalFactIssues.length > 0) return false
  if (report.sourceHashBefore && report.sourceHashAfter && report.sourceHashBefore !== report.sourceHashAfter) return false
  return true
}

export function syncablePathsFromApplyReport(report) {
  if (!isSuccessfulApplyReport(report)) return []
  const written = Array.isArray(report.written) ? report.written : []
  return [...new Set(written.map(normalizeRelativePath).filter(isSagSyncableWikiPath))].sort()
}

async function writeRunLog(projectPath, name, payload, root = SAG_SYNC_ROOT) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const dir = path.join(syncRoot(projectPath, root), "runs", stamp.slice(0, 10))
  await ensureDirectory(dir)
  const filePath = path.join(dir, `${stamp}-${name}.json`)
  await writeJson(filePath, payload)
  return filePath
}

export async function syncApplyReportToSag(reportPath, options = {}) {
  const resolved = resolveOptions(options)
  const absoluteReportPath = path.resolve(reportPath)
  const report = JSON.parse(await readTextFile(absoluteReportPath))
  const projectPath = normalizePath(options.projectPath ?? report.projectPath ?? resolved.projectPath)
  const paths = syncablePathsFromApplyReport(report)
  const results = []
  const pending = []

  for (const relativePath of paths) {
    try {
      results.push(await syncWikiFileToSag(relativePath, { ...resolved, projectPath }))
    } catch (error) {
      const record = {
        schema: "trading-review-wiki-sag-sync-pending-v1",
        createdAt: nowIso(),
        reportPath: absoluteReportPath,
        path: relativePath,
        error: safeErrorMessage(error),
      }
      pending.push(record)
      results.push({ status: "pending", path: relativePath, error: record.error })
      if (!resolved.nonblocking) throw error
    }
  }

  if (pending.length) await appendPending(projectPath, pending, resolved.syncRoot)
  const state = await loadState(projectPath, resolved.syncRoot)
  state.processedReports[absoluteReportPath] = {
    syncedAt: nowIso(),
    candidateCount: paths.length,
    indexedCount: results.filter((item) => item.status === "indexed").length,
    pendingCount: pending.length,
  }
  await saveState(projectPath, state, resolved.syncRoot)
  const runLogPath = await writeRunLog(projectPath, "report", {
    reportPath: absoluteReportPath,
    paths,
    results,
    pendingCount: pending.length,
  }, resolved.syncRoot)
  return { reportPath: absoluteReportPath, paths, results, pendingCount: pending.length, runLogPath }
}

async function listFilesRecursive(root, predicate) {
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => [])
  const files = []
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name)
    if (entry.isDirectory()) {
      files.push(...await listFilesRecursive(fullPath, predicate))
    } else if (!predicate || predicate(fullPath)) {
      files.push(fullPath)
    }
  }
  return files
}

async function wikiFileSyncNeeded(projectPath, relativePath, state, maxContentBytes) {
  const absolutePath = path.join(projectPath, relativePath)
  const content = await readTextFile(absolutePath)
  const contentHash = hashContent(content)
  const fileState = state.files?.[relativePath]
  if (!fileState || fileState.contentHash !== contentHash) return true
  if (fileState.status === "indexed") return false
  if (
    fileState.status === "skipped_too_large"
    && Buffer.byteLength(content, "utf8") > maxContentBytes
    && Number(fileState.maxContentBytes) === Number(maxContentBytes)
  ) {
    return false
  }
  return true
}

export async function syncReportsToSag(options = {}) {
  const resolved = resolveOptions(options)
  const state = await loadState(resolved.projectPath, resolved.syncRoot)
  const root = path.join(resolved.projectPath, ".llm-wiki", "codex-ingest")
  const since = options.since ? new Date(`${options.since}T00:00:00`) : null
  const reports = (await listFilesRecursive(root, (filePath) => path.basename(filePath) === "apply-report.json"))
    .sort()
    .filter((filePath) => !state.processedReports[path.resolve(filePath)])

  const selectedReports = []
  for (const reportPath of reports) {
    if (since) {
      const stat = await fs.stat(reportPath)
      if (stat.mtime < since) continue
    }
    selectedReports.push(reportPath)
    if (options.limit && selectedReports.length >= Number(options.limit)) break
  }

  const results = []
  for (const reportPath of selectedReports) {
    results.push(await syncApplyReportToSag(reportPath, resolved))
  }
  return { reports: selectedReports, results }
}

export async function retryPendingSagSync(options = {}) {
  const resolved = resolveOptions(options)
  const pending = await readPending(resolved.projectPath, resolved.syncRoot)
  const remaining = []
  const results = []
  for (const item of pending) {
    try {
      results.push(await syncWikiFileToSag(item.path, { ...resolved, force: true }))
    } catch (error) {
      remaining.push({ ...item, lastTriedAt: nowIso(), error: safeErrorMessage(error) })
      results.push({ status: "pending", path: item.path, error: safeErrorMessage(error) })
    }
  }
  await writeJsonl(pendingPath(resolved.projectPath, resolved.syncRoot), remaining)
  return { retried: pending.length, remaining: remaining.length, results }
}

export async function syncWikiTreeToSag(options = {}) {
  const resolved = resolveOptions(options)
  const state = await loadState(resolved.projectPath, resolved.syncRoot)
  const pendingPaths = new Set((await readPending(resolved.projectPath, resolved.syncRoot)).map((item) => item.path))
  const wikiRoot = path.join(resolved.projectPath, "wiki")
  const allFiles = (await listFilesRecursive(wikiRoot, (filePath) => filePath.endsWith(".md")))
    .map((filePath) => normalizeRelativePath(path.relative(resolved.projectPath, filePath)))
    .filter(isSagSyncableWikiPath)
    .sort()
  const limit = options.limit ? Number(options.limit) : null
  const offset = parseNonNegativeInteger(options.offset, 0)
  const candidates = []
  for (const relativePath of allFiles) {
    if (pendingPaths.has(relativePath)) continue
    if (options.force || await wikiFileSyncNeeded(resolved.projectPath, relativePath, state, resolved.maxContentBytes)) {
      candidates.push(relativePath)
      if (limit && candidates.length >= offset + limit) break
    }
  }
  const selected = limit ? candidates.slice(offset, offset + limit) : candidates.slice(offset)
  const results = []
  const pending = []
  for (const relativePath of selected) {
    try {
      results.push(await syncWikiFileToSag(relativePath, { ...resolved, force: Boolean(options.force) }))
    } catch (error) {
      const record = {
        schema: "trading-review-wiki-sag-sync-pending-v1",
        createdAt: nowIso(),
        path: relativePath,
        error: safeErrorMessage(error),
      }
      pending.push(record)
      results.push({ status: "pending", path: relativePath, error: record.error })
      if (!resolved.nonblocking) throw error
    }
  }
  if (pending.length) await appendPending(resolved.projectPath, pending, resolved.syncRoot)
  const runLogPath = await writeRunLog(resolved.projectPath, "wiki-tree", {
    totalFiles: allFiles.length,
    candidateFiles: candidates.length,
    offset,
    selectedFiles: selected.length,
    results,
    pendingCount: pending.length,
  }, resolved.syncRoot)
  return { totalFiles: allFiles.length, candidateFiles: candidates.length, offset, selectedFiles: selected.length, results, pendingCount: pending.length, runLogPath }
}

export async function sagSyncStatus(options = {}) {
  const resolved = resolveOptions(options)
  const state = await loadState(resolved.projectPath, resolved.syncRoot)
  const pending = await readPending(resolved.projectPath, resolved.syncRoot)
  const files = Object.values(state.files ?? {})
  return {
    projectPath: resolved.projectPath,
    sagApiBase: resolved.sagApiBase,
    sagProjectName: state.sagProjectId ? (state.sagProjectName ?? resolved.sagProjectName) : resolved.sagProjectName,
    sagProjectId: state.sagProjectId ?? null,
    syncRoot: resolved.syncRoot,
    indexedFiles: files.filter((item) => item?.status === "indexed").length,
    skippedTooLarge: files.filter((item) => item?.status === "skipped_too_large").length,
    trackedFiles: files.length,
    processedReports: Object.keys(state.processedReports ?? {}).length,
    pending: pending.length,
  }
}

export async function maybeSyncApplyReportToSag(reportPath, options = {}) {
  if (process.env.SAG_SYNC_ENABLED !== "1") return null
  try {
    return await syncApplyReportToSag(reportPath, { ...options, nonblocking: true })
  } catch (error) {
    console.warn(`[sag-sync] post-apply sync skipped: ${safeErrorMessage(error)}`)
    return null
  }
}
