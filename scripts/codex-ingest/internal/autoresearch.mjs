import fs from "node:fs/promises"
import path from "node:path"

import {
  appendJsonl,
  DEFAULT_PROJECT_PATH,
  ensureDirectory,
  listFilesRecursive,
  normalizePath,
  nowLocalTimestamp,
  projectRelative,
  readJsonlFile,
  readIfExists,
  safeErrorMessage,
  shortHash,
} from "./core.mjs"

export const AUTORESEARCH_LOCKED_EVALUATOR_VERSION = "trading-autoresearch-lite-v1"

const DEFAULT_EDITABLE_ARTIFACTS = [
  "prompt_template",
  "self_question_program",
  "segment_config",
  "market_validator_params",
  "evidence_task_priority",
  "agent_role_weighting",
]

const EDITABLE_ARTIFACT_SET = new Set(DEFAULT_EDITABLE_ARTIFACTS)

const FORBIDDEN_WRITES = ["wiki/", "raw/", "real_trade_execution"]

const SCORE_FORMULA = "market_feedback_score + evidence_closure_score + attribution_quality_score + novelty_score - leakage_penalty - complexity_penalty - hype_without_order_penalty"

const EVIDENCE_MANIFEST_SCHEMAS = new Set([
  "agent-run-manifest-v1",
  "recursive-ai-phase-run-v1",
  "self-question-loop-run-v1",
])

const AUTORESEARCH_POLICY_RULES = new Map([
  ["segment_config", {
    scope: "autoresearch.segment_config",
    rule: "review_segment_pool_expansion_from_successful_experiments",
    rationale: "实验显示细分候选池调整可能改善市场反馈或归因质量，进入人工配置评审而非自动改配置。",
  }],
  ["market_validator_params", {
    scope: "autoresearch.market_validation",
    rule: "review_market_validator_params_from_experiment_feedback",
    rationale: "实验显示验证窗口、候选池或行情交叉验证参数可能影响可行动反馈，需人工复核后再改参数。",
  }],
  ["evidence_task_priority", {
    scope: "autoresearch.evidence_priority",
    rule: "review_evidence_task_priority_from_experiment_feedback",
    rationale: "实验显示补证任务优先级可能影响基本面闭环质量，需人工复核后再调整。",
  }],
  ["agent_role_weighting", {
    scope: "autoresearch.agent_policy",
    rule: "review_agent_role_weighting_from_experiment_feedback",
    rationale: "实验显示某些 agent 角色贡献或失效模式值得调整权重，需人工复核后再进入 agent policy。",
  }],
  ["prompt_template", {
    scope: "autoresearch.prompt_template",
    rule: "review_prompt_template_from_experiment_feedback",
    rationale: "实验显示 prompt 模板可能影响问题质量或证据披露，需人工复核后再修改模板。",
  }],
  ["self_question_program", {
    scope: "autoresearch.self_question_program",
    rule: "review_self_question_program_from_experiment_feedback",
    rationale: "实验显示自然语言研究计划方向可能更有效，需人工复核后再调整自提问 program。",
  }],
])

function parseCsvList(value, fallback = []) {
  const values = Array.isArray(value) ? value : String(value ?? "").split(/[,;\n]+/g)
  const parsed = [...new Set(values.map((item) => safeErrorMessage(String(item ?? "").trim())).filter(Boolean))]
  return parsed.length ? parsed : fallback
}

function parseEditableArtifacts(value) {
  const artifacts = parseCsvList(value, DEFAULT_EDITABLE_ARTIFACTS)
  const unsupported = artifacts.filter((item) => !EDITABLE_ARTIFACT_SET.has(item))
  if (unsupported.length) throw new Error(`--editable-artifacts contains unsupported artifact: ${unsupported.join(", ")}`)
  return artifacts
}

function numberValue(value) {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

function programTimestamp(generatedAt) {
  return String(generatedAt ?? nowLocalTimestamp()).replace(/[-: ]/g, "").slice(0, 14)
}

function slugifyProgram(value, fallbackSeed) {
  const raw = String(value ?? "").trim().toLowerCase()
  const ascii = raw
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return ascii || `program-${shortHash(fallbackSeed).slice(0, 12)}`
}

function lockedEvaluator() {
  return {
    version: AUTORESEARCH_LOCKED_EVALUATOR_VERSION,
    immutable: true,
    formula: SCORE_FORMULA,
    metrics: {
      positive: ["market_feedback_score", "evidence_closure_score", "attribution_quality_score", "novelty_score"],
      penalties: ["leakage_penalty", "complexity_penalty", "hype_without_order_penalty"],
    },
    gates: [
      "no_future_leakage",
      "market_feedback_required",
      "fundamental_evidence_required_for_high_confidence",
      "review_required_before_keep",
      "no_wiki_raw_or_trade_writes",
    ],
  }
}

function programMarkdown(program) {
  return [
    `# ${program.title}`,
    "",
    "## Hypothesis",
    program.hypothesis || "",
    "",
    "## Lanes",
    ...program.lanes.map((lane) => `- ${lane}`),
    "",
    "## Editable Artifacts",
    ...program.allowedEditableArtifacts.map((artifact) => `- ${artifact}`),
    "",
    "## Locked Evaluator",
    `- version: ${program.lockedEvaluator.version}`,
    `- formula: ${program.lockedEvaluator.formula}`,
    "- immutable: true",
    "",
    "## Write Boundary",
    ...program.forbiddenWrites.map((item) => `- forbidden: ${item}`),
    "",
  ].join("\n")
}

export async function createAutoresearchProgram(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const generatedAt = String(options.generatedAt ?? nowLocalTimestamp())
  const title = safeErrorMessage(String(options.title ?? options.program ?? options.query ?? "Trading Autoresearch Program").trim())
  const hypothesis = safeErrorMessage(String(options.hypothesis ?? options.objective ?? "").trim())
  const lanes = parseCsvList(options.lanes ?? options.lane, ["default"])
  const allowedEditableArtifacts = parseEditableArtifacts(options.editableArtifacts ?? options["editable-artifacts"])
  const slug = slugifyProgram(options.slug ?? options.id ?? title, `${title}:${hypothesis}:${generatedAt}`)
  const id = `autoresearch_program_${shortHash(`${slug}:${title}:${hypothesis}`)}`
  const program = {
    schema: "trading-autoresearch-program-v1",
    id,
    title,
    hypothesis,
    lanes,
    allowedEditableArtifacts,
    forbiddenWrites: FORBIDDEN_WRITES,
    lockedEvaluator: lockedEvaluator(),
    createdAt: generatedAt,
    writePolicy: {
      artifacts: ".llm-wiki/research-programs only when --write is present",
      wroteWiki: false,
      wroteRaw: false,
      editableArtifactsOnly: true,
    },
  }

  const dryRun = !options.write
  let writeResult = null
  if (!dryRun) {
    const outputDir = path.join(projectPath, ".llm-wiki", "research-programs")
    await ensureDirectory(outputDir)
    const prefix = `${programTimestamp(generatedAt)}-${slug}`
    const jsonPath = path.join(outputDir, `${prefix}.json`)
    const markdownPath = path.join(outputDir, `${prefix}.md`)
    await fs.writeFile(jsonPath, `${JSON.stringify(program, null, 2)}\n`, "utf8")
    await fs.writeFile(markdownPath, programMarkdown(program), "utf8")
    writeResult = {
      jsonPath,
      markdownPath,
      jsonRelativePath: projectRelative(projectPath, jsonPath),
      markdownRelativePath: projectRelative(projectPath, markdownPath),
      records: 1,
    }
  }

  return {
    schema: "trading-autoresearch-program-run-v1",
    mode: "autoresearch-program",
    projectPath,
    dryRun,
    program,
    writeResult,
  }
}

export function scoreAutoresearchExperiment(options = {}) {
  const components = {
    marketFeedbackScore: numberValue(options.marketFeedbackScore ?? options.market_feedback_score),
    evidenceClosureScore: numberValue(options.evidenceClosureScore ?? options.evidence_closure_score),
    attributionQualityScore: numberValue(options.attributionQualityScore ?? options.attribution_quality_score),
    noveltyScore: numberValue(options.noveltyScore ?? options.novelty_score),
    leakagePenalty: numberValue(options.leakagePenalty ?? options.leakage_penalty),
    complexityPenalty: numberValue(options.complexityPenalty ?? options.complexity_penalty),
    hypeWithoutOrderPenalty: numberValue(options.hypeWithoutOrderPenalty ?? options.hype_without_order_penalty),
  }
  const totalScore =
    components.marketFeedbackScore +
    components.evidenceClosureScore +
    components.attributionQualityScore +
    components.noveltyScore -
    components.leakagePenalty -
    components.complexityPenalty -
    components.hypeWithoutOrderPenalty
  return {
    schema: "trading-autoresearch-score-v1",
    evaluatorVersion: AUTORESEARCH_LOCKED_EVALUATOR_VERSION,
    formula: SCORE_FORMULA,
    components,
    totalScore,
  }
}

function normalizeExperimentDecision({ decision, scoreDelta, evidenceGaps }) {
  const raw = String(decision ?? "").trim().toLowerCase().replace(/-/g, "_")
  if (["keep", "discard", "review_required"].includes(raw)) return raw
  if (scoreDelta <= 0) return "discard"
  if (evidenceGaps.length) return "review_required"
  return "review_required"
}

function resolveProjectManifestPath(projectPath, manifestPath) {
  const rawPath = safeErrorMessage(String(manifestPath ?? "").trim())
  if (!rawPath) return null
  const projectRoot = path.resolve(projectPath)
  const absolutePath = path.isAbsolute(rawPath) ? path.normalize(rawPath) : path.resolve(projectRoot, rawPath)
  if (absolutePath !== projectRoot && !absolutePath.startsWith(`${projectRoot}${path.sep}`)) {
    throw new Error("--manifest must stay inside the project path")
  }
  return {
    absolutePath,
    relativePath: projectRelative(projectRoot, absolutePath),
  }
}

async function readExperimentManifestEvidence(projectPath, manifestPath, { required = false } = {}) {
  const resolved = resolveProjectManifestPath(projectPath, manifestPath)
  if (!resolved) return null
  const raw = await readIfExists(resolved.absolutePath)
  if (!raw) {
    if (required) throw new Error(`--manifest does not exist: ${resolved.relativePath}`)
    return {
      status: "missing",
      path: resolved.relativePath,
    }
  }
  let manifest = null
  try {
    manifest = JSON.parse(raw)
  } catch {
    if (required) throw new Error(`--manifest is not valid JSON: ${resolved.relativePath}`)
    return {
      status: "invalid_json",
      path: resolved.relativePath,
    }
  }
  const schema = String(manifest?.schema ?? "")
  if (!EVIDENCE_MANIFEST_SCHEMAS.has(schema)) {
    if (required) throw new Error(`--manifest has unsupported schema: ${schema || "missing"}`)
    return {
      status: "unsupported_schema",
      path: resolved.relativePath,
      schema: schema || null,
    }
  }
  return {
    status: "ok",
    path: resolved.relativePath,
    schema,
    mode: safeErrorMessage(String(manifest.mode ?? "").trim()) || null,
    runId: safeErrorMessage(String(manifest.runId ?? manifest.id ?? "").trim()) || null,
    runStatus: safeErrorMessage(String(manifest.status ?? "").trim()) || null,
    query: safeErrorMessage(String(manifest.query ?? "").trim()) || null,
  }
}

export async function appendAutoresearchExperiment(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const generatedAt = String(options.generatedAt ?? nowLocalTimestamp())
  const evidenceGaps = parseCsvList(options.evidenceGaps ?? options["evidence-gaps"], [])
  const baselineScore = numberValue(options.baselineScore ?? options["baseline-score"])
  const newScore = numberValue(options.newScore ?? options["new-score"])
  const scoreDelta = newScore - baselineScore
  const decision = normalizeExperimentDecision({ decision: options.decision, scoreDelta, evidenceGaps })
  const manifestPath = safeErrorMessage(String(options.manifestPath ?? options.manifest ?? "").trim())
  const manifestEvidence = await readExperimentManifestEvidence(projectPath, manifestPath, {
    required: Boolean(options.write && manifestPath),
  })
  const entry = {
    schema: "trading-autoresearch-experiment-v1",
    id: `autoresearch_experiment_${shortHash(`${generatedAt}:${options.programId ?? ""}:${options.hypothesis ?? ""}:${options.changedArtifact ?? ""}`)}`,
    programId: safeErrorMessage(String(options.programId ?? options["program-id"] ?? "").trim()),
    hypothesis: safeErrorMessage(String(options.hypothesis ?? "").trim()),
    changedArtifact: safeErrorMessage(String(options.changedArtifact ?? options["changed-artifact"] ?? "").trim()),
    baselineScore,
    newScore,
    scoreDelta,
    decision,
    highConfidenceEligible: false,
    evidenceGaps,
    futureValidationDate: safeErrorMessage(String(options.futureValidationDate ?? options["future-validation-date"] ?? "").trim()) || null,
    manifestPath: manifestPath || null,
    manifestEvidence,
    evaluatorVersion: AUTORESEARCH_LOCKED_EVALUATOR_VERSION,
    createdAt: generatedAt,
    writePolicy: {
      wroteWiki: false,
      wroteRaw: false,
      autoApplied: false,
    },
  }

  const dryRun = !options.write
  let writeResult = null
  if (!dryRun) {
    const outputDir = path.join(projectPath, ".llm-wiki", "experiments")
    await ensureDirectory(outputDir)
    const ledgerPath = path.join(outputDir, "experiment-ledger.jsonl")
    await appendJsonl(ledgerPath, entry)
    writeResult = {
      filePath: ledgerPath,
      relativePath: projectRelative(projectPath, ledgerPath),
      records: 1,
    }
  }
  return {
    schema: "trading-autoresearch-experiment-append-run-v1",
    mode: "autoresearch-ledger-append",
    projectPath,
    dryRun,
    entry,
    writeResult,
  }
}

export async function listAutoresearchExperiments(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const outputDir = path.join(projectPath, ".llm-wiki", "experiments")
  const files = (await listFilesRecursive(outputDir, {
    extensions: new Set([".jsonl"]),
    excludeDirNames: new Set([".git", "node_modules"]),
    maxBytes: 1024 * 1024 * 5,
  }).catch(() => [])).filter((filePath) => path.basename(filePath) === "experiment-ledger.jsonl")
  const entries = []
  for (const filePath of files.sort((a, b) => a.localeCompare(b))) {
    const records = await readJsonlFile(filePath)
    for (const record of records) {
      const value = record?.value && typeof record.value === "object" ? record.value : record
      entries.push({
        ...value,
        path: projectRelative(projectPath, filePath),
        line: record?.line ?? null,
      })
    }
  }
  entries.sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")) || String(b.id ?? "").localeCompare(String(a.id ?? "")))
  return {
    schema: "trading-autoresearch-experiment-ledger-v1",
    mode: "autoresearch-ledger-list",
    projectPath,
    totalEntries: entries.length,
    entries,
    writePolicy: {
      readOnly: true,
      wroteWiki: false,
      wroteRaw: false,
    },
  }
}

export async function listAutoresearchPrograms(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const outputDir = path.join(projectPath, ".llm-wiki", "research-programs")
  const files = (await listFilesRecursive(outputDir, {
    extensions: new Set([".json"]),
    excludeDirNames: new Set([".git", "node_modules"]),
    maxBytes: 1024 * 1024 * 5,
  }).catch(() => []))
  const programs = []
  for (const filePath of files.sort((a, b) => a.localeCompare(b))) {
    const raw = await readIfExists(filePath)
    if (!raw) continue
    try {
      const program = JSON.parse(raw)
      if (program?.schema !== "trading-autoresearch-program-v1") continue
      programs.push({
        ...program,
        path: projectRelative(projectPath, filePath),
      })
    } catch {
      // Ignore malformed program artifacts; they remain inspectable on disk.
    }
  }
  return {
    schema: "trading-autoresearch-program-list-v1",
    mode: "autoresearch-program-list",
    projectPath,
    totalPrograms: programs.length,
    programs,
    writePolicy: {
      readOnly: true,
      wroteWiki: false,
      wroteRaw: false,
    },
  }
}

export async function getAutoresearchReadiness(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const [programs, ledger] = await Promise.all([
    listAutoresearchPrograms({ projectPath }),
    listAutoresearchExperiments({ projectPath }),
  ])
  const decisionCounts = ledger.entries.reduce((map, entry) => {
    const decision = String(entry?.decision ?? "unknown")
    map[decision] = (map[decision] ?? 0) + 1
    return map
  }, {})
  const hasProgram = programs.totalPrograms > 0
  const hasExperiments = ledger.totalEntries > 0
  const status = hasExperiments ? "experiment_ledger_active" : hasProgram ? "program_ready" : "not_started"
  return {
    schema: "trading-autoresearch-readiness-v1",
    mode: "autoresearch-readiness",
    projectPath,
    status,
    phase5Unlocks: false,
    lockedEvaluatorVersion: AUTORESEARCH_LOCKED_EVALUATOR_VERSION,
    counts: {
      researchPrograms: programs.totalPrograms,
      experiments: ledger.totalEntries,
      decisions: decisionCounts,
    },
    gates: [
      {
        gate: "research_program",
        status: hasProgram ? "passed" : "pending",
        reason: "至少需要一个自然语言 research program，才能把自提问方向变成可审计实验。",
      },
      {
        gate: "experiment_ledger",
        status: hasExperiments ? "active" : "pending",
        reason: "实验 ledger 记录 hypothesis、changed artifact、score 和 keep/discard，供后续复核。",
      },
      {
        gate: "phase5_separation",
        status: "passed",
        reason: "Autoresearch Lite 只增加研究循环审计，不自动解锁 Phase 5 或写 wiki/raw/真实交易。",
      },
    ],
    writePolicy: {
      readOnly: true,
      wroteWiki: false,
      wroteRaw: false,
      phase5Unlocks: false,
    },
  }
}

function policyRuleForChangedArtifact(changedArtifact) {
  return AUTORESEARCH_POLICY_RULES.get(changedArtifact) ?? {
    scope: "autoresearch.general",
    rule: "review_autoresearch_artifact_change",
    rationale: "实验结果提示该可调对象可能需要人工复核，但系统不会自动应用变更。",
  }
}

function evidenceSufficiencyForProposal(entries, manifestEvidenceRefs) {
  const evidenceGaps = [...new Set(entries.flatMap((entry) => Array.isArray(entry.evidenceGaps) ? entry.evidenceGaps : []).filter(Boolean))]
  if (manifestEvidenceRefs.length === 0) return { status: "insufficient", evidenceGaps }
  if (evidenceGaps.length > 0) return { status: "partial", evidenceGaps }
  return { status: "sufficient_for_review", evidenceGaps }
}

function risksForAutoresearchProposal({ evidenceSufficiency }) {
  const risks = [
    "proposal_only_not_auto_applied",
    "market_feedback_can_be_noisy",
    "requires_human_review_before_any_config_or_prompt_change",
  ]
  if (evidenceSufficiency.status === "insufficient") risks.push("missing_manifest_or_validation_evidence")
  if (evidenceSufficiency.status === "partial") risks.push("evidence_gaps_still_open")
  return risks
}

function riskLevelForEvidenceSufficiency(evidenceSufficiency) {
  if (evidenceSufficiency.status === "insufficient") return "high"
  if (evidenceSufficiency.status === "partial") return "medium"
  return "low"
}

function autoresearchPolicyProposalMarkdown(run) {
  const lines = [
    "# Trading Autoresearch Policy Proposals",
    "",
    `- generatedAt: ${run.generatedAt}`,
    `- mode: ${run.mode}`,
    `- dryRun: ${run.dryRun}`,
    `- proposals: ${run.counts.proposals}`,
    `- autoApply: false`,
    "",
    "## Write Boundary",
    "- wroteWiki: false",
    "- wroteRaw: false",
    "- wroteBrain: false",
    "- realTradeExecution: false",
    "",
    "## Proposals",
  ]
  if (run.proposals.length === 0) {
    lines.push("", "- none")
  }
  for (const proposal of run.proposals) {
    lines.push(
      "",
      `### ${proposal.changedArtifact}`,
      "",
      `- proposalId: ${proposal.proposalId}`,
      `- status: ${proposal.status}`,
      `- reviewStatus: ${proposal.reviewStatus}`,
      `- scope: ${proposal.scope}`,
      `- rule: ${proposal.rule}`,
      `- targetArtifact: ${proposal.targetArtifact}`,
      `- evidenceSufficiency: ${proposal.evidenceSufficiency.status}`,
      `- riskLevel: ${proposal.riskLevel}`,
      `- autoApplyAllowed: ${proposal.autoApplyAllowed}`,
      `- why: ${proposal.rationale}`,
      `- sourceLedgerExperiments: ${proposal.evidenceRefs.ledger.join(", ") || "none"}`,
      `- sourceAgentRuns: ${proposal.evidenceRefs.agentRuns.map((item) => item.path).join(", ") || "none"}`,
      `- sourceValidations: ${proposal.evidenceRefs.validations.join(", ") || "none"}`,
      `- evidenceGaps: ${proposal.evidenceGaps.join(", ") || "none"}`,
      `- risks: ${proposal.risks.join(", ") || "none"}`,
    )
  }
  lines.push("")
  return lines.join("\n")
}

export async function proposeAutoresearchPolicyChanges(options = {}) {
  const projectPath = normalizePath(options.projectPath ?? DEFAULT_PROJECT_PATH)
  const generatedAt = String(options.generatedAt ?? nowLocalTimestamp())
  const minScoreDelta = numberValue(options.minScoreDelta ?? options["min-score-delta"] ?? 1)
  const allowedArtifacts = new Set(parseEditableArtifacts(options.changedArtifacts ?? options["changed-artifacts"]))
  const ledger = await listAutoresearchExperiments({ projectPath })
  const candidateEntries = ledger.entries
    .filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry))
    .filter((entry) => allowedArtifacts.has(String(entry.changedArtifact ?? "")))
    .filter((entry) => ["review_required", "keep"].includes(String(entry.decision ?? "")))
    .filter((entry) => numberValue(entry.scoreDelta) >= minScoreDelta)

  const byArtifact = new Map()
  for (const entry of candidateEntries) {
    const changedArtifact = String(entry.changedArtifact ?? "")
    if (!byArtifact.has(changedArtifact)) byArtifact.set(changedArtifact, [])
    byArtifact.get(changedArtifact).push(entry)
  }
  const proposals = [...byArtifact.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([changedArtifact, entries]) => {
      const rule = policyRuleForChangedArtifact(changedArtifact)
      const scoreDeltas = entries.map((entry) => numberValue(entry.scoreDelta))
      const averageScoreDelta = scoreDeltas.reduce((sum, value) => sum + value, 0) / Math.max(1, scoreDeltas.length)
      const evidenceExperimentIds = entries.map((entry) => entry.id).filter(Boolean)
      const manifestEvidenceRefs = entries
        .map((entry) => entry.manifestEvidence)
        .filter((evidence) => evidence?.status === "ok")
        .map((evidence) => ({
          path: evidence.path,
          schema: evidence.schema,
          runId: evidence.runId,
          runStatus: evidence.runStatus,
        }))
      const evidenceSufficiency = evidenceSufficiencyForProposal(entries, manifestEvidenceRefs)
      const sourceRefs = {
        ledgerExperiments: evidenceExperimentIds,
        manifests: manifestEvidenceRefs,
        validations: [],
      }
      const evidenceRefs = {
        ledger: evidenceExperimentIds,
        agentRuns: manifestEvidenceRefs.filter((evidence) => evidence.schema === "agent-run-manifest-v1"),
        manifests: manifestEvidenceRefs,
        validations: [],
      }
      const riskLevel = riskLevelForEvidenceSufficiency(evidenceSufficiency)
      return {
        schema: "trading-autoresearch-policy-proposal-v1",
        proposalId: `autoresearch_policy_${shortHash(`${changedArtifact}:${evidenceExperimentIds.join(",")}`)}`,
        status: "proposed_review_required",
        reviewStatus: "review_required",
        scope: rule.scope,
        rule: rule.rule,
        targetArtifact: changedArtifact,
        changedArtifact,
        occurrenceCount: entries.length,
        averageScoreDelta: roundAutoresearchScore(averageScoreDelta),
        rationale: rule.rationale,
        proposedPolicyChange: {
          artifact: changedArtifact,
          action: "review_and_adjust",
          source: "autoresearch_experiment_ledger",
          autoApply: false,
        },
        evidenceExperimentIds,
        manifestEvidenceRefs,
        sourceRefs,
        evidenceRefs,
        evidenceSufficiency,
        evidenceGaps: evidenceSufficiency.evidenceGaps,
        riskLevel,
        risks: risksForAutoresearchProposal({ evidenceSufficiency }),
        reviewRequired: true,
        autoApplyAllowed: false,
        autoApply: false,
      }
    })

  const dryRun = !options.write
  const run = {
    schema: "trading-autoresearch-policy-proposal-run-v1",
    mode: "autoresearch-policy-propose",
    generatedAt,
    projectPath,
    dryRun,
    counts: {
      experiments: ledger.totalEntries,
      candidates: candidateEntries.length,
      proposals: proposals.length,
      minScoreDelta,
    },
    proposals,
    writePolicy: {
      artifacts: ".llm-wiki/policy-proposals",
      wroteWiki: false,
      wroteRaw: false,
      wroteBrain: false,
      autoApplied: false,
      realTradeExecution: false,
    },
    writeResult: null,
  }
  if (!dryRun) {
    const outputDir = path.join(projectPath, ".llm-wiki", "policy-proposals")
    await ensureDirectory(outputDir)
    const outputPath = path.join(outputDir, `${programTimestamp(generatedAt)}-autoresearch-policy-proposals.json`)
    const markdownPath = path.join(outputDir, `${programTimestamp(generatedAt)}-autoresearch-policy-proposals.md`)
    run.writeResult = {
      filePath: outputPath,
      markdownPath,
      relativePath: projectRelative(projectPath, outputPath),
      markdownRelativePath: projectRelative(projectPath, markdownPath),
      records: proposals.length,
    }
    await fs.writeFile(outputPath, `${JSON.stringify(run, null, 2)}\n`, "utf8")
    await fs.writeFile(markdownPath, autoresearchPolicyProposalMarkdown(run), "utf8")
  }
  return run
}

function roundAutoresearchScore(value) {
  return Math.round(numberValue(value) * 100) / 100
}
