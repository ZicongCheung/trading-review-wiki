import path from "node:path"
import {
  isObjectRecord,
  normalizePath,
  normalizeStockCode,
  nowLocalTimestamp,
  readJsonlFile,
  shortHash,
  stableJsonString,
  toPosixPath,
  writeJson,
} from "./core.mjs"
import {
  charLength,
  entityKeyForSubject,
  loadTemporalEntityLookup,
  normalizeEntityAlias,
  normalizeFactRefList,
  resolveTemporalEntity,
} from "./knowledge.mjs"

// 判断账本(judgment-v1):记录"我当时怎么理解",与 temporal facts(记录"世界发生了什么")平行。
// 机制完全镜像 temporal facts:确定性 id、独立 manifest 区域 judgmentWrites、append-only、
// supersedes 修正链、apply dry-run 展示、索引重建。详见 docs/提案-2026-07-07-时间线账本与供数架构-v6.md。

export const JUDGMENTS_RELATIVE_PATH = "data/facts/judgments.jsonl"
export const JUDGMENTS_INDEX_RELATIVE_PATH = "data/facts/judgments.index.json"
export const JUDGMENT_KINDS = ["thesis", "expectation", "lesson", "stance"]
export const JUDGMENT_STATUSES = ["held", "revised", "invalidated", "expired"]
export const JUDGMENT_VISIBILITIES = ["team", "personal"]

export function normalizeJudgmentKind(value) {
  const raw = String(value ?? "").trim()
  if (!raw) return null
  const lower = raw.toLowerCase()
  if (JUDGMENT_KINDS.includes(lower)) return lower
  if (["判断", "论点", "观点", "理解"].includes(raw)) return "thesis"
  if (["预期", "预判", "预测"].includes(raw)) return "expectation"
  if (["教训", "错误教训", "纪律"].includes(raw)) return "lesson"
  if (["仓位观点", "仓位", "持仓观点"].includes(raw)) return "stance"
  return lower
}

export function normalizeJudgmentStatus(value) {
  const raw = String(value ?? "").trim()
  if (!raw) return "held"
  const lower = raw.toLowerCase()
  if (["held", "active", "current", "holding"].includes(lower) || ["持有", "有效", "当前"].includes(raw)) return "held"
  if (["revised", "superseded", "replaced", "updated"].includes(lower) || ["修正", "已修正", "被替代"].includes(raw)) return "revised"
  if (["invalidated", "contradicted", "retracted", "false", "wrong"].includes(lower) || ["证伪", "被证伪", "推翻", "撤回"].includes(raw)) return "invalidated"
  if (["expired", "stale"].includes(lower) || ["过期", "陈旧"].includes(raw)) return "expired"
  return lower
}

export function normalizeJudgmentVisibility(value, kind) {
  const raw = String(value ?? "").trim().toLowerCase()
  if (JUDGMENT_VISIBILITIES.includes(raw)) return raw
  return kind === "stance" ? "personal" : "team"
}

export function assertSafeJudgmentsPath(relativePath) {
  const normalized = toPosixPath(String(relativePath ?? JUDGMENTS_RELATIVE_PATH)).replace(/^\/+/, "")
  if (normalized.includes("..")) throw new Error(`Refusing judgment path traversal: ${relativePath}`)
  if (normalized !== JUDGMENTS_RELATIVE_PATH) {
    throw new Error(`Judgments must be written only to ${JUDGMENTS_RELATIVE_PATH}: ${relativePath}`)
  }
  return normalized
}

export function judgmentIdentity(record) {
  const identity = {
    subject: record.subject ?? record.entity ?? null,
    canonicalSubject: record.canonicalSubject ?? null,
    entityKey: record.entityKey ?? null,
    stockCode: record.stockCode ?? null,
    kind: normalizeJudgmentKind(record.kind),
    claim: record.claim ?? record.text ?? record.summary ?? null,
    validAt: record.validAt ?? record.asOf ?? record.date ?? null,
    status: normalizeJudgmentStatus(record.status),
    supersedes: normalizeFactRefList(record.supersedes),
    basedOnFacts: normalizeFactRefList(record.basedOnFacts),
    sourcePath: record.sourcePath ?? record.source ?? null,
    sourceHash: record.sourceHash ?? null,
    wikiPath: record.wikiPath ?? null,
  }
  if (Object.values(identity).some((value) => value != null && String(value).trim() !== "")) {
    return stableJsonString(identity)
  }
  const fallback = { ...record }
  delete fallback.id
  delete fallback.createdAt
  delete fallback.updatedAt
  return stableJsonString(fallback)
}

export function judgmentId(record) {
  return `jg_${shortHash(judgmentIdentity(record))}`
}

export function normalizeJudgmentRecord(record, lookup) {
  const entity = resolveTemporalEntity(record, lookup)
  const subject = entity?.canonicalSubject ?? normalizeEntityAlias(record.subject ?? record.entity ?? record.canonicalSubject ?? "")
  const kind = normalizeJudgmentKind(record.kind)
  const normalized = {
    ...record,
    type: record.type ?? "judgment",
    kind,
    status: normalizeJudgmentStatus(record.status),
    visibility: normalizeJudgmentVisibility(record.visibility, kind),
    subject: subject || record.subject,
    canonicalSubject: record.canonicalSubject ?? entity?.canonicalSubject ?? subject ?? null,
    entityKey: record.entityKey ?? entity?.entityKey ?? entityKeyForSubject(subject, record.stockCode ?? record.code ?? record.ticker),
    stockCode: normalizeStockCode(record.stockCode ?? record.code ?? record.ticker) ?? entity?.stockCode ?? null,
    aliases: [...new Set([...(Array.isArray(record.aliases) ? record.aliases.map(normalizeEntityAlias).filter(Boolean) : []), ...(entity?.aliases ?? [])])],
    basedOnFacts: normalizeFactRefList(record.basedOnFacts),
    supersedes: normalizeFactRefList(record.supersedes),
    wikiPath: record.wikiPath ?? entity?.wikiPath ?? null,
  }
  if (!normalized.id) normalized.id = judgmentId(normalized)
  return normalized
}

export function normalizeManifestJudgmentWrites(manifest) {
  const judgmentWrites = manifest.judgmentWrites ?? manifest.judgments ?? []
  if (!Array.isArray(judgmentWrites)) throw new Error("Manifest judgmentWrites must be an array when present")
  return judgmentWrites.map((raw, index) => {
    if (!isObjectRecord(raw)) throw new Error(`Invalid judgmentWrites[${index}]: expected an object`)
    const relativePath = assertSafeJudgmentsPath(raw.targetPath ?? raw.relativePath ?? raw.filePath ?? raw.file ?? raw.path ?? JUDGMENTS_RELATIVE_PATH)
    let payload
    if (isObjectRecord(raw.judgment)) {
      payload = { ...raw.judgment }
    } else if (isObjectRecord(raw.record)) {
      payload = { ...raw.record }
    } else {
      payload = { ...raw }
      delete payload.action
      delete payload.targetPath
      delete payload.relativePath
      delete payload.filePath
      delete payload.file
      delete payload.path
      delete payload.content
    }
    const kind = normalizeJudgmentKind(payload.kind)
    const record = {
      ...payload,
      type: payload.type ?? "judgment",
      kind,
      status: normalizeJudgmentStatus(payload.status),
      visibility: normalizeJudgmentVisibility(payload.visibility, kind),
      sourceHash: payload.sourceHash ?? manifest.sourceHash ?? null,
      sourcePath: payload.sourcePath ?? payload.source ?? manifest.sourcePath ?? null,
      createdAt: payload.createdAt ?? nowLocalTimestamp(),
    }
    if (payload.id) record.id = payload.id
    return {
      action: raw.action ?? "append",
      path: relativePath,
      record,
      identity: judgmentIdentity(record),
    }
  })
}

export async function readJudgmentEntries(projectPath, entityLookup = null) {
  const filePath = path.join(normalizePath(projectPath), JUDGMENTS_RELATIVE_PATH)
  entityLookup = entityLookup ?? await loadTemporalEntityLookup(projectPath)
  const entries = (await readJsonlFile(filePath)).map((entry) => ({
    ...entry,
    value: isObjectRecord(entry.value) ? normalizeJudgmentRecord(entry.value, entityLookup) : entry.value,
  }))
  const statusById = new Map()
  for (const entry of entries) {
    const record = entry.value
    if (!isObjectRecord(record)) continue
    const sourceId = record.id ? String(record.id) : null
    for (const ref of normalizeFactRefList(record.supersedes)) statusById.set(ref, { status: "revised", by: sourceId, line: entry.line })
    for (const ref of [...normalizeFactRefList(record.invalidates), ...normalizeFactRefList(record.contradicts)]) {
      statusById.set(ref, { status: "invalidated", by: sourceId, line: entry.line })
    }
  }
  return entries.map((entry) => {
    const record = entry.value
    if (!isObjectRecord(record)) return { ...entry, status: "invalidated", statusReason: null, identity: null }
    const identity = judgmentIdentity(record)
    let status = normalizeJudgmentStatus(record.status)
    let statusReason = null
    const linkStatus = record.id ? statusById.get(String(record.id)) : null
    if (linkStatus) {
      status = linkStatus.status
      statusReason = linkStatus
    }
    return { ...entry, status, statusReason, identity }
  })
}

export async function planJudgmentWrites(projectPath, judgmentWrites) {
  const entityLookup = await loadTemporalEntityLookup(projectPath)
  judgmentWrites = judgmentWrites.map((item) => {
    const record = normalizeJudgmentRecord(item.record, entityLookup)
    return { ...item, record, identity: judgmentIdentity(record) }
  })
  const existingEntries = await readJudgmentEntries(projectPath, entityLookup)
  const existingIds = new Map()
  const existingIdentities = new Map()
  for (const entry of existingEntries) {
    if (!isObjectRecord(entry.value)) continue
    if (entry.value.id) existingIds.set(String(entry.value.id), entry)
    if (entry.identity) existingIdentities.set(entry.identity, entry)
  }

  const plannedJudgmentWrites = []
  const duplicateJudgments = []
  const pendingIds = new Set(existingIds.keys())
  const pendingIdentities = new Set(existingIdentities.keys())

  for (const item of judgmentWrites) {
    const id = String(item.record.id)
    const duplicateEntry = existingIds.get(id) ?? existingIdentities.get(item.identity)
    if (duplicateEntry || pendingIds.has(id) || pendingIdentities.has(item.identity)) {
      duplicateJudgments.push({
        id,
        path: item.path,
        line: duplicateEntry?.line ?? null,
        reason: duplicateEntry ? "already_present" : "duplicate_in_manifest",
      })
      continue
    }
    plannedJudgmentWrites.push(item)
    pendingIds.add(id)
    pendingIdentities.add(item.identity)
  }

  const revisedJudgments = []
  const invalidatedJudgments = []
  for (const item of plannedJudgmentWrites) {
    for (const ref of normalizeFactRefList(item.record.supersedes)) {
      const existing = existingIds.get(ref)
      revisedJudgments.push({ id: ref, by: item.record.id, path: JUDGMENTS_RELATIVE_PATH, line: existing?.line ?? null, found: Boolean(existing) })
    }
    for (const ref of [...normalizeFactRefList(item.record.invalidates), ...normalizeFactRefList(item.record.contradicts)]) {
      const existing = existingIds.get(ref)
      invalidatedJudgments.push({ id: ref, by: item.record.id, path: JUDGMENTS_RELATIVE_PATH, line: existing?.line ?? null, found: Boolean(existing) })
    }
  }

  return { plannedJudgmentWrites, duplicateJudgments, revisedJudgments, invalidatedJudgments }
}

export function makeJudgmentIssue(item, field, message, fatal = false) {
  return { path: item.path, id: item.record?.id ?? null, field, message, fatal }
}

export function validateJudgmentWrite(item) {
  const record = item.record ?? {}
  const issues = []
  const subject = String(record.subject ?? record.canonicalSubject ?? "").trim()
  const kind = normalizeJudgmentKind(record.kind)
  const claim = String(record.claim ?? record.text ?? record.summary ?? "").trim()
  const status = normalizeJudgmentStatus(record.status)
  const visibility = normalizeJudgmentVisibility(record.visibility, kind)

  if (!subject) issues.push(makeJudgmentIssue(item, "subject", "Judgment must include subject/canonicalSubject.", true))
  if (!kind) issues.push(makeJudgmentIssue(item, "kind", `Judgment must include kind: ${JUDGMENT_KINDS.join(" / ")}.`, true))
  else if (!JUDGMENT_KINDS.includes(kind)) {
    issues.push(makeJudgmentIssue(item, "kind", `Unknown judgment kind: ${kind}. Allowed: ${JUDGMENT_KINDS.join(" / ")}.`, true))
  }
  if (!claim) issues.push(makeJudgmentIssue(item, "claim", "Judgment must include a one-sentence claim.", true))
  else if (charLength(claim) > 300) {
    issues.push(makeJudgmentIssue(item, "claim", "Claim is too long for an atomic judgment; split it into smaller judgmentWrites.", false))
  }
  if (!JUDGMENT_STATUSES.includes(status)) {
    issues.push(makeJudgmentIssue(item, "status", `Unknown judgment status: ${status}. Allowed: ${JUDGMENT_STATUSES.join(" / ")}.`, true))
  }
  if (!JUDGMENT_VISIBILITIES.includes(visibility)) {
    issues.push(makeJudgmentIssue(item, "visibility", `Unknown judgment visibility: ${visibility}.`, true))
  }
  if (!record.validAt && !record.eventDate && !record.sourceDate && !record.observedAt) {
    issues.push(makeJudgmentIssue(item, "validAt", "Judgment should include validAt (when this understanding was held).", false))
  }
  if (kind === "stance" && visibility !== "personal") {
    issues.push(makeJudgmentIssue(item, "visibility", "stance judgments carry position views; keep visibility personal unless deliberately shared.", false))
  }
  if ((status === "revised" || status === "invalidated") && !normalizeFactRefList(record.supersedes).length && !normalizeFactRefList(record.invalidates).length && !normalizeFactRefList(record.contradicts).length) {
    issues.push(makeJudgmentIssue(item, "supersedes", "Revised/invalidated judgments should reference the old judgment id through supersedes/invalidates when available.", false))
  }
  if (!record.sourcePath) issues.push(makeJudgmentIssue(item, "sourcePath", "Judgment should carry sourcePath for audit.", false))
  if (!record.sourceHash) issues.push(makeJudgmentIssue(item, "sourceHash", "Judgment should carry sourceHash for replay safety.", false))
  return issues
}

export function validateJudgmentPlan(judgmentPlan) {
  return judgmentPlan.plannedJudgmentWrites.flatMap((item) => validateJudgmentWrite(item))
}

export function compactJudgmentEntry(entry) {
  const record = entry.value
  return {
    id: record.id ?? null,
    line: entry.line,
    entityKey: record.entityKey ?? null,
    canonicalSubject: record.canonicalSubject ?? record.subject ?? null,
    stockCode: record.stockCode ?? null,
    kind: record.kind ?? null,
    status: entry.status,
    visibility: record.visibility ?? "team",
    validAt: record.validAt ?? record.observedAt ?? null,
    verifyBy: record.verifyBy ?? null,
    claim: record.claim ?? null,
  }
}

export async function buildJudgmentsIndex(projectPath) {
  const entries = await readJudgmentEntries(projectPath)
  const judgments = entries.filter((entry) => isObjectRecord(entry.value)).map((entry) => compactJudgmentEntry(entry))
  const entities = new Map()
  for (const judgment of judgments) {
    const key = judgment.entityKey ?? entityKeyForSubject(judgment.canonicalSubject)
    if (!key) continue
    const existing = entities.get(key) ?? {
      entityKey: key,
      canonicalSubject: judgment.canonicalSubject,
      stockCode: judgment.stockCode ?? null,
      heldJudgmentIds: [],
      inactiveJudgmentIds: [],
      lastValidAt: null,
    }
    if (judgment.status === "held") existing.heldJudgmentIds.push(judgment.id)
    else existing.inactiveJudgmentIds.push(judgment.id)
    if (judgment.validAt && (!existing.lastValidAt || String(judgment.validAt) > String(existing.lastValidAt))) existing.lastValidAt = judgment.validAt
    entities.set(key, existing)
  }
  const heldJudgments = judgments.filter((judgment) => judgment.status === "held").length
  return {
    version: 1,
    generatedAt: nowLocalTimestamp(),
    judgmentsPath: JUDGMENTS_RELATIVE_PATH,
    counts: {
      totalJudgments: judgments.length,
      heldJudgments,
      inactiveJudgments: judgments.length - heldJudgments,
      entities: entities.size,
    },
    entities: Object.fromEntries([...entities.entries()].sort(([a], [b]) => a.localeCompare(b))),
    judgments,
  }
}

export async function writeJudgmentsIndex(projectPath) {
  const index = await buildJudgmentsIndex(projectPath)
  await writeJson(path.join(normalizePath(projectPath), JUDGMENTS_INDEX_RELATIVE_PATH), index)
  return { path: JUDGMENTS_INDEX_RELATIVE_PATH, counts: index.counts }
}
