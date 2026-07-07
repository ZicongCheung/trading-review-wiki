import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  JUDGMENTS_RELATIVE_PATH,
  judgmentId,
  normalizeJudgmentKind,
  normalizeJudgmentRecord,
  normalizeJudgmentStatus,
  normalizeManifestJudgmentWrites,
  planJudgmentWrites,
  validateJudgmentWrite,
} from "./judgments.mjs"
import { applyManifest, buildPlanStagePrompt, parsePlanFromModelText, normalizeIngestPlan } from "./ingest.mjs"

const EMPTY_LOOKUP = { aliases: new Map(), byKey: new Map() }

function baseJudgment(overrides = {}) {
  return {
    subject: "AI服务器电源",
    kind: "thesis",
    claim: "当前是订单兑现期而非叙事扩散期",
    status: "held",
    validAt: "2026-07-07",
    sourcePath: "raw/日复盘/2026-07-07-复盘.md",
    sourceHash: "hash123",
    ...overrides,
  }
}

describe("judgment normalization", () => {
  it("normalizes kind and status synonyms", () => {
    expect(normalizeJudgmentKind("判断")).toBe("thesis")
    expect(normalizeJudgmentKind("预期")).toBe("expectation")
    expect(normalizeJudgmentKind("教训")).toBe("lesson")
    expect(normalizeJudgmentKind("仓位观点")).toBe("stance")
    expect(normalizeJudgmentStatus("持有")).toBe("held")
    expect(normalizeJudgmentStatus("修正")).toBe("revised")
    expect(normalizeJudgmentStatus("证伪")).toBe("invalidated")
    expect(normalizeJudgmentStatus("")).toBe("held")
  })

  it("gives deterministic ids and entity keys", () => {
    const a = normalizeJudgmentRecord(baseJudgment(), EMPTY_LOOKUP)
    const b = normalizeJudgmentRecord(baseJudgment(), EMPTY_LOOKUP)
    expect(a.id).toBe(b.id)
    expect(a.id).toMatch(/^jg_/)
    expect(a.entityKey).toBe("entity:ai服务器电源")
    const changed = normalizeJudgmentRecord(baseJudgment({ claim: "另一个判断" }), EMPTY_LOOKUP)
    expect(changed.id).not.toBe(a.id)
    expect(judgmentId(a)).toBe(a.id)
  })

  it("defaults stance visibility to personal and others to team", () => {
    expect(normalizeJudgmentRecord(baseJudgment({ kind: "stance" }), EMPTY_LOOKUP).visibility).toBe("personal")
    expect(normalizeJudgmentRecord(baseJudgment(), EMPTY_LOOKUP).visibility).toBe("team")
    expect(normalizeJudgmentRecord(baseJudgment({ kind: "stance", visibility: "team" }), EMPTY_LOOKUP).visibility).toBe("team")
  })
})

describe("manifest judgmentWrites", () => {
  it("normalizes records and rejects unsafe paths", () => {
    const writes = normalizeManifestJudgmentWrites({
      sourcePath: "/abs/source.md",
      sourceHash: "mh",
      judgmentWrites: [baseJudgment({ sourcePath: undefined, sourceHash: undefined })],
    })
    expect(writes).toHaveLength(1)
    expect(writes[0].path).toBe(JUDGMENTS_RELATIVE_PATH)
    expect(writes[0].record.sourceHash).toBe("mh")
    expect(() => normalizeManifestJudgmentWrites({ judgmentWrites: [baseJudgment({ path: "raw/evil.jsonl" })] })).toThrow(/Judgments must be written only to/)
    expect(() => normalizeManifestJudgmentWrites({ judgmentWrites: [baseJudgment({ path: "../escape.jsonl" })] })).toThrow(/traversal/)
  })

  it("validates fatal and soft issues", () => {
    const ok = validateJudgmentWrite({ path: JUDGMENTS_RELATIVE_PATH, record: normalizeJudgmentRecord(baseJudgment(), EMPTY_LOOKUP) })
    expect(ok.filter((issue) => issue.fatal)).toEqual([])
    const bad = validateJudgmentWrite({
      path: JUDGMENTS_RELATIVE_PATH,
      record: { kind: "vibe", status: "maybe", claim: "" },
    })
    const fatalFields = bad.filter((issue) => issue.fatal).map((issue) => issue.field).sort()
    expect(fatalFields).toEqual(["claim", "kind", "status", "subject"])
    const stance = validateJudgmentWrite({
      path: JUDGMENTS_RELATIVE_PATH,
      record: normalizeJudgmentRecord(baseJudgment({ kind: "stance", visibility: "team" }), EMPTY_LOOKUP),
    })
    expect(stance.some((issue) => issue.field === "visibility" && !issue.fatal)).toBe(true)
  })
})

describe("judgment apply chain", () => {
  let tmpRoot
  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "judgments-"))
    await fs.mkdir(path.join(tmpRoot, "wiki/logs"), { recursive: true })
    await fs.mkdir(path.join(tmpRoot, "data/facts"), { recursive: true })
  })
  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true })
  })

  async function writeManifest(name, judgmentWrites) {
    const manifestPath = path.join(tmpRoot, name)
    await fs.writeFile(manifestPath, JSON.stringify({
      $schema: "codex-ingest-manifest-v1",
      projectPath: tmpRoot,
      writes: [{ action: "append", path: "wiki/logs/log-2026-07-07.md", content: "- judgments test" }],
      judgmentWrites,
    }), "utf8")
    return manifestPath
  }

  it("plans, writes, dedupes, and indexes judgments through applyManifest", async () => {
    const manifestPath = await writeManifest("changes.json", [baseJudgment(), baseJudgment()])

    const dryRun = await applyManifest({ manifestPath, projectPath: tmpRoot, write: false })
    expect(dryRun.plannedJudgmentWrites).toHaveLength(1)
    expect(dryRun.duplicateJudgments).toHaveLength(1)
    expect(dryRun.duplicateJudgments[0].reason).toBe("duplicate_in_manifest")
    expect(dryRun.judgmentsWritten).toEqual([])
    await expect(fs.access(path.join(tmpRoot, JUDGMENTS_RELATIVE_PATH))).rejects.toThrow()

    const written = await applyManifest({ manifestPath, projectPath: tmpRoot, write: true })
    expect(written.judgmentsWritten).toHaveLength(1)
    expect(written.judgmentIndex.counts.totalJudgments).toBe(1)
    const ledger = (await fs.readFile(path.join(tmpRoot, JUDGMENTS_RELATIVE_PATH), "utf8")).trim().split("\n")
    expect(ledger).toHaveLength(1)
    const record = JSON.parse(ledger[0])
    expect(record.id).toMatch(/^jg_/)
    expect(record.visibility).toBe("team")

    const again = await applyManifest({ manifestPath, projectPath: tmpRoot, write: true })
    expect(again.judgmentsWritten).toEqual([])
    expect(again.duplicateJudgments.some((item) => item.reason === "already_present")).toBe(true)
    expect((await fs.readFile(path.join(tmpRoot, JUDGMENTS_RELATIVE_PATH), "utf8")).trim().split("\n")).toHaveLength(1)
  })

  it("marks superseded judgments as revised in the plan and blocks fatal records on write", async () => {
    const first = await writeManifest("changes-1.json", [baseJudgment()])
    const applied = await applyManifest({ manifestPath: first, projectPath: tmpRoot, write: true })
    const oldId = applied.judgmentsWritten[0]

    const revision = await writeManifest("changes-2.json", [
      baseJudgment({ claim: "主线已从整机切向上游电源,原判断部分修正", supersedes: [oldId] }),
    ])
    const plan = await applyManifest({ manifestPath: revision, projectPath: tmpRoot, write: false })
    expect(plan.revisedJudgments).toEqual([expect.objectContaining({ id: oldId, found: true })])

    const entries = await planJudgmentWrites(tmpRoot, normalizeManifestJudgmentWrites({
      judgmentWrites: [baseJudgment({ claim: "重复检查", supersedes: [oldId] })],
    }))
    expect(entries.revisedJudgments[0].found).toBe(true)

    const fatal = await writeManifest("changes-3.json", [{ kind: "vibe", claim: "" }])
    await expect(applyManifest({ manifestPath: fatal, projectPath: tmpRoot, write: true })).rejects.toThrow(/Fatal schema validation failed/)
  })
})

describe("plan stage judgments wiring", () => {
  const prepared = {
    sourceRelativePath: "raw/日复盘/2026-07-07-复盘.md",
    sourceHash: "hash123",
    candidates: { wikiCandidates: [], rawCandidates: [], segments: [] },
    conceptGovernance: { configPath: null, counts: {}, warnings: [], candidateHints: [] },
    temporalFactContext: null,
    methodologyContext: null,
    index: "",
    schema: "",
  }

  it("includes judgmentWrites guidance only when enabled", () => {
    const withJudgments = buildPlanStagePrompt({ prepared, analysis: "a", sourceBaseName: "s", includeJudgments: true })
    expect(withJudgments).toContain("judgmentWrites")
    expect(withJudgments).toContain("thesis|expectation|lesson|stance")
    const without = buildPlanStagePrompt({ prepared, analysis: "a", sourceBaseName: "s" })
    expect(without).not.toContain("judgmentWrites")
  })

  it("parses judgmentWrites from plan JSON and keeps them through normalizeIngestPlan", async () => {
    const parsed = parsePlanFromModelText([
      "```json",
      JSON.stringify({ create: [], update: [], factWrites: [], judgmentWrites: [baseJudgment()] }),
      "```",
    ].join("\n"))
    expect(parsed.judgmentWrites).toHaveLength(1)

    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "judgments-plan-"))
    try {
      const plan = await normalizeIngestPlan(tmp, parsed, "2026-07-07-复盘")
      expect(plan.judgmentWrites).toHaveLength(1)
      expect(plan.judgmentWrites[0].subject).toBe("AI服务器电源")
    } finally {
      await fs.rm(tmp, { recursive: true, force: true })
    }
  })
})
