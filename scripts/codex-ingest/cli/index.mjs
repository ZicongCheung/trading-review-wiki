import path from "node:path"
import { askWiki, runAskEval } from "../ask/index.mjs"
import {
  applySelfQuestionPolicyRegressionPatchCandidate,
  appendAutoresearchExperiment,
  attributeSelfQuestionValidations,
  checkRecursiveAiPhase5Readiness,
  collectSelfQuestionEvidenceTasks,
  collectSelfQuestionPolicyRegressionFeedback,
  createAutoresearchProgram,
  executeSelfQuestionPolicyRegressions,
  evaluateSelfQuestionPolicyRegressions,
  exportSelfQuestionPolicyRegressionPatchCandidates,
  exportSelfQuestionPolicyRegressions,
  exportTrainingSamples,
  getAutoresearchReadiness,
  getRecursiveAiPhaseStatus,
  getBrainStatus,
  listHypothesisAlerts,
  listHypothesisEvidenceTaskDrafts,
  listHypotheses,
  listObservationDrafts,
  appendWechatIncrementMessages,
  importWechatRawChatMessages,
  listWechatRawChatSources,
  getWechatIncrementInboxStatus,
  listAutoresearchExperiments,
  listSelfTrainingActions,
  listSelfTrainingPlans,
  listActiveSelfQuestionPolicies,
  listTrainingSampleExports,
  marketValidatePrediction,
  planStockFeedbackCollectionTask,
  qualityCheckHypotheses,
  recordStockFeedbackCollectionResult,
  planSelfTrainingActions,
  processWechatIncrementInbox,
  proposeAutoresearchPolicyChanges,
  proposeSelfQuestionPolicyRegressionRemediations,
  proposeSelfQuestionPolicies,
  recordSelfQuestionEvidenceResult,
  rememberBrainMemory,
  resolveBrainMemory,
  reviewSelfQuestionPolicyRegressionRemediation,
  reviewSelfQuestionPolicyProposal,
  reviewHypothesisEvidenceTaskDraft,
  reviewSelfTrainingAction,
  runDailyLoop,
  runRecursiveAiPhaseAdvance,
  runRecursiveAiPhaseRun,
  runSelfQuestion,
  runSelfQuestionLoop,
  runSelfTraining,
  runHypothesisWatch,
  startWechatIncrementServer,
  scoreAutoresearchExperiment,
  buildHypothesisReport,
  buildHypothesisDashboardData,
  buildHypothesisEvidenceFeedback,
  buildResearchOsAgentPlan,
  buildResearchOsAgentStatus,
  buildStockFeedbackBenchmark,
  buildStockFeedbackPaperTradeAgentCandidates,
  buildStockFeedbackTrajectories,
  createStockFeedbackEvidenceTask,
  createObservationDraft,
  createHypothesis,
  discoverHypotheses,
  draftHypothesisEvidenceLinks,
  draftHypothesisEvidenceTasks,
  draftHypothesisPostMortems,
  draftHypothesisSupplement,
  exportStockFeedbackLoraReady,
  getStockFeedbackEvidenceSourceStatus,
  getStockFeedbackPaperTradeStatus,
  getStockFeedbackStatus,
  importStockFeedbackExecutionResults,
  listStockFeedbackEvidenceDlq,
  listStockFeedbackEvidenceResults,
  listStockFeedbackEvidenceTasks,
  listStockFeedbackExecutionResults,
  listResearchOsAgentReviewItems,
  listStockFeedbackReviewQueue,
  recordStockFeedbackPaperTrade,
  runResearchOsAgentStep,
  reviewHypothesisEvidenceLinkDraft,
  reviewStockFeedbackExecutionResult,
  reviewStockFeedbackEvidenceResult,
  settleStockFeedbackPaperTrade,
  runStockFeedbackPaperTradeDiscretionaryReview,
  runStockFeedbackEvidenceTaskQueue,
  submitHypothesisSupplement,
  showStockFeedbackEvidenceTask,
  listStockFeedbackTrajectories,
  reviewStockFeedbackTrajectory,
  updateStockFeedbackEvidenceDlqEntry,
  updateHypothesisFromArticle,
  updateHypothesisStatus,
  validateHypothesis,
  validateStockFeedbackExecutionResults,
  verifyHypothesisEngineArtifacts,
  verifyResearchOsAgentArtifacts,
  verifyStockFeedbackExecutionResults,
  validateSelfQuestions,
  verifyStockFeedbackArtifacts,
  verifySelfTrainingPlans,
  verifyTrainingSampleExports,
} from "../brain/index.mjs"
import { runCompanyResearch } from "../company-research/index.mjs"
import { convertSourceWithMarkitdown } from "../convert-source/index.mjs"
import { DEFAULT_PROJECT_PATH } from "../core/index.mjs"
import { runDataSource } from "../data-source/index.mjs"
import { runDeepResearch } from "../deep-research/index.mjs"
import {
  runConceptGovernanceAudit,
  runHygiene,
  runTemporalFactsAudit,
} from "../governance/index.mjs"
import { handleImaSync } from "../internal/ima/cli-handler.mjs"
import {
  EMBEDDING_INDEX_RELATIVE_PATH,
  apiRunIngest,
  applyManifest,
  buildWikiEmbeddingIndex,
  finalizeStagedIngest,
  loadWikiEmbeddingIndex,
  prepareIngest,
  resolveEmbeddingConfig,
  runBatchIngest,
  retryPendingSagSync,
  sagSyncStatus,
  syncApplyReportToSag,
  syncReportsToSag,
  syncWikiFileToSag,
  syncWikiTreeToSag,
} from "../ingest/index.mjs"
import { parseArgs, requireArg } from "./args.mjs"
import { printHelp } from "./help.mjs"
import { resolveCliPerformanceProfile } from "./performance.mjs"

async function handleConvertSource(args) {
  const result = await convertSourceWithMarkitdown({
    sourcePath: requireArg(args, "source"),
    projectPath: args.project,
    outputPath: args.output,
    overwrite: Boolean(args.overwrite),
    markitdownBin: args["markitdown-bin"],
    ocrFallback: !Boolean(args["no-ocr"]),
    ocrPythonBin: args["ocr-python-bin"],
  })
  console.log("Converted source to Markdown sidecar:")
  console.log(`Source: ${result.sourcePath}`)
  console.log(`Source hash: ${result.sourceHash}`)
  console.log(`Markdown: ${result.outputPath}`)
  console.log(`Bytes: ${result.bytes}`)
  if (result.conversionNote) console.log(`Note: ${result.conversionNote}`)
  if (result.ocrPages != null) console.log(`OCR pages: ${result.ocrPages}`)
  if (result.outputRelativePath) {
    console.log("")
    console.log("Next:")
    console.log(`npm run codex:ingest -- prepare --source "${result.outputPath}" --project "${args.project ?? DEFAULT_PROJECT_PATH}"`)
  }
}

async function handlePrepare(args) {
  const result = await prepareIngest({
    sourcePath: requireArg(args, "source"),
    projectPath: args.project,
    schemaPath: args.schema,
    noReport: Boolean(args["no-report"]),
    embeddingRouting: Boolean(args["embedding-routing"]),
    embeddingApiKey: args["embedding-api-key"],
    embeddingModel: args["embedding-model"],
    embeddingEndpoint: args["embedding-endpoint"],
    onProgress: (message) => console.log(message),
  })
  console.log(`Prepared ingest context for ${result.sourceRelativePath}`)
  console.log(`Source hash: ${result.sourceHash}`)
  console.log(`Report: ${result.reportDir}`)
  console.log(`Top wiki candidates: ${result.candidates.wikiCandidates.slice(0, 5).map((c) => c.path).join(", ") || "(none)"}`)
}

async function handleEmbeddings(args) {
  const subcommand = args._[1] ?? "status"
  const projectPath = args.project ?? DEFAULT_PROJECT_PATH
  if (subcommand === "build") {
    const config = resolveEmbeddingConfig({
      embeddingApiKey: args["embedding-api-key"] ?? args["api-key"],
      embeddingEndpoint: args["embedding-endpoint"],
      embeddingModel: args["embedding-model"],
      embeddingBatchSize: args["embedding-batch-size"],
      embeddingTimeoutMs: args["embedding-timeout-ms"],
    })
    const result = await buildWikiEmbeddingIndex({
      projectPath,
      config,
      onProgress: (message) => console.log(message),
    })
    console.log(JSON.stringify({ mode: "embeddings-build", ...result }, null, 2))
    return
  }
  if (subcommand === "status") {
    const index = await loadWikiEmbeddingIndex(projectPath)
    console.log(JSON.stringify({
      mode: "embeddings-status",
      path: EMBEDDING_INDEX_RELATIVE_PATH,
      exists: Boolean(index),
      model: index?.model ?? null,
      generatedAt: index?.generatedAt ?? null,
      counts: index?.counts ?? null,
    }, null, 2))
    return
  }
  throw new Error("Unknown embeddings command. Use embeddings build or embeddings status.")
}

async function handleApiRun(args) {
  const provider = args.provider ?? "openai"
  const result = await apiRunIngest({
    sourcePath: requireArg(args, "source"),
    projectPath: args.project,
    schemaPath: args.schema,
    provider,
    model: provider === "openai" ? requireArg(args, "model") : args.model,
    apiKey: args["api-key"],
    endpoint: args.endpoint,
    reasoningEffort: args["reasoning-effort"],
    codexBin: args["codex-bin"],
    codexProfile: args["codex-profile"],
    codexProfileV2: args["codex-profile-v2"],
    codexTimeoutMs: args["codex-timeout-ms"],
    pageConcurrency: args["page-concurrency"],
    pageWriteMode: args["page-write-mode"],
    judgments: Boolean(args.judgments),
    embeddingRouting: Boolean(args["embedding-routing"]),
    embeddingApiKey: args["embedding-api-key"],
    embeddingModel: args["embedding-model"],
    embeddingEndpoint: args["embedding-endpoint"],
    maxPlanItems: args["max-plan-items"],
    maxCreatePages: args["max-create-pages"],
    maxUpdatePages: args["max-update-pages"],
    sourceSharding: args["source-sharding"],
    shardConcurrency: args["shard-concurrency"],
    maxShardChars: args["max-shard-chars"],
    sourceRetention: args["source-retention"],
    onProgress: (message) => console.log(message),
  })
  console.log(`Generated staged ingest artifacts:`)
  console.log(`Analysis: ${result.analysisPath}`)
  console.log(`Plan: ${result.planJsonPath}`)
  console.log(`Files: ${result.filesDir}`)
  console.log(`Manifest: ${result.manifestPath}`)
  if (result.sourceSharding?.enabled) {
    console.log(`Shards: ${result.sourceSharding.shards.length}`)
    console.log(`Mainline index: ${result.sourceMainlineIndex?.counts?.mainlines ?? 0} mainlines / ${result.sourceMainlineIndex?.counts?.windows ?? 0} windows`)
  }
  if (result.coverageReview) {
    console.log(`Source coverage: ${result.coverageReview.coveredMainlines}/${result.coverageReview.totalMainlines} (${result.coverageReview.coveragePct}%), uncovered=${result.coverageReview.uncoveredMainlines}`)
  }
  if (result.pageWriteMode === "patch") {
    console.log(`Page write mode: patch (patched=${result.pagePatchStats.patchedPages}, full=${result.pagePatchStats.fullPages}, fallbacks=${result.pagePatchStats.fallbacks.length})`)
  }
  console.log(`Dry-run report: ${result.dryRunReport.reportPath}`)
}

async function handleFinalize(args) {
  const provider = args.provider ?? "codex"
  const result = await finalizeStagedIngest({
    reportDir: requireArg(args, "report"),
    projectPath: args.project,
    provider,
    model: provider === "openai" ? requireArg(args, "model") : args.model,
    apiKey: args["api-key"],
    endpoint: args.endpoint,
    reasoningEffort: args["reasoning-effort"],
    codexBin: args["codex-bin"],
    codexProfile: args["codex-profile"],
    codexProfileV2: args["codex-profile-v2"],
    codexTimeoutMs: args["codex-timeout-ms"],
  })
  console.log(`Finalized staged ingest artifacts:`)
  console.log(`Files: ${result.filesDir}`)
  console.log(`Manifest: ${result.manifestPath}`)
  console.log(`Dry-run report: ${result.dryRunReport.reportPath}`)
}

async function handleApply(args) {
  const result = await applyManifest({
    manifestPath: path.resolve(requireArg(args, "manifest")),
    projectPath: args.project,
    write: Boolean(args.write),
    allowSourceChange: Boolean(args["allow-source-change"]),
  })
  console.log(result.dryRun ? "Dry-run complete." : "Write complete.")
  console.log(`Report: ${result.reportPath}`)
  console.log(`Files ${result.dryRun ? "planned" : "written"}: ${result.diffs.map((d) => d.path).join(", ") || "(none)"}`)
  if (result.fatalIssues.length > 0) {
    console.log(`Fatal schema issues: ${result.fatalIssues.length}`)
    for (const issue of result.fatalIssues.slice(0, 10)) {
      console.log(`- ${issue.path} [${issue.field}] ${issue.message}`)
    }
  }
}

async function handleBatchRun(args) {
  const provider = args.provider ?? "codex"
  const result = await runBatchIngest({
    sources: requireArg(args, "sources"),
    projectPath: args.project,
    schemaPath: args.schema,
    provider,
    model: provider === "openai" ? requireArg(args, "model") : args.model,
    apiKey: args["api-key"],
    endpoint: args.endpoint,
    reasoningEffort: args["reasoning-effort"],
    codexBin: args["codex-bin"],
    codexProfile: args["codex-profile"],
    codexProfileV2: args["codex-profile-v2"],
    codexTimeoutMs: args["codex-timeout-ms"],
    apiConcurrency: args["api-concurrency"],
    pageConcurrency: args["page-concurrency"] ?? 2,
    pageWriteMode: args["page-write-mode"],
    judgments: Boolean(args.judgments),
    embeddingRouting: Boolean(args["embedding-routing"]),
    embeddingApiKey: args["embedding-api-key"],
    embeddingModel: args["embedding-model"],
    embeddingEndpoint: args["embedding-endpoint"],
    maxPlanItems: args["max-plan-items"],
    maxCreatePages: args["max-create-pages"],
    maxUpdatePages: args["max-update-pages"],
    sourceSharding: args["source-sharding"],
    shardConcurrency: args["shard-concurrency"] ?? 2,
    maxShardChars: args["max-shard-chars"],
    sourceRetention: args["source-retention"],
    conflictPolicy: args["conflict-policy"],
    writeConcurrency: args["write-concurrency"] ?? 1,
    write: Boolean(args.write),
    onProgress: (message) => console.log(message),
  })
  console.log(`Batch ingest ${result.status}.`)
  console.log(`Batch: ${result.batchDir}`)
  console.log(`Manifest: ${path.join(result.batchDir, "batch-manifest.json")}`)
  console.log(`Summary: ${path.join(result.batchDir, "batch-summary.md")}`)
  console.log(`Counts: ${Object.entries(result.counts).map(([status, count]) => `${status}=${count}`).join(", ") || "(none)"}`)
  for (const task of result.tasks) {
    console.log(`- ${task.status}: ${task.sourcePath}${task.reportDir ? ` -> ${task.reportDir}` : ""}`)
    if (task.error) console.log(`  error: ${task.error}`)
    if (task.conflicts?.length) console.log(`  conflicts: ${task.conflicts.map((item) => `${item.path}:${item.reason}`).join(", ")}`)
  }
}

function summarizeSagResults(results = []) {
  const counts = {}
  const samples = []
  for (const item of results) {
    const key = item.reason ? `${item.status}:${item.reason}` : item.status
    counts[key] = (counts[key] ?? 0) + 1
    if ((item.status === "pending" || item.reason === "content_too_large") && samples.length < 10) {
      samples.push({
        status: item.status,
        reason: item.reason,
        path: item.path,
        error: item.error,
        byteLength: item.byteLength,
        maxContentBytes: item.maxContentBytes,
      })
    }
  }
  return { resultCount: results.length, counts, samples }
}

function summarizeSagSyncOutput(result) {
  if (!result || typeof result !== "object" || !Array.isArray(result.results)) return result
  if (Array.isArray(result.reports)) {
    const summaries = result.results.map(summarizeSagSyncOutput)
    const totals = {}
    for (const summary of summaries) {
      for (const [key, value] of Object.entries(summary.counts ?? {})) {
        totals[key] = (totals[key] ?? 0) + value
      }
    }
    return {
      reportCount: result.reports.length,
      reports: result.reports,
      counts: totals,
      results: summaries,
    }
  }
  return {
    ...Object.fromEntries(Object.entries(result).filter(([key]) => key !== "results")),
    ...summarizeSagResults(result.results),
  }
}

async function handleSagSync(args) {
  const subcommand = args._[1] ?? "status"
  const options = {
    projectPath: args.project,
    sagApiBase: args["sag-api-base"],
    sagProjectName: args["sag-project-name"],
    syncRoot: args["sync-root"],
    limit: args.limit,
    offset: args.offset,
    since: args.since,
    force: Boolean(args.force),
    extract: !Boolean(args["no-extract"]),
    maxContentBytes: args["max-content-bytes"],
  }
  let result
  if (subcommand === "report") {
    result = await syncApplyReportToSag(requireArg(args, "report"), options)
  } else if (subcommand === "scan-reports") {
    await retryPendingSagSync(options)
    result = await syncReportsToSag(options)
  } else if (subcommand === "file") {
    result = await syncWikiFileToSag(requireArg(args, "path"), options)
  } else if (subcommand === "scan-wiki") {
    await retryPendingSagSync(options)
    result = await syncWikiTreeToSag(options)
  } else if (subcommand === "pending") {
    result = await retryPendingSagSync(options)
  } else if (subcommand === "status") {
    result = await sagSyncStatus(options)
  } else {
    throw new Error("Unknown sag-sync command. Use status, file, report, scan-reports, scan-wiki, or pending.")
  }
  console.log(JSON.stringify(args.verbose ? result : summarizeSagSyncOutput(result), null, 2))
}

async function handleDeepResearch(args) {
  const topic = args.topic ?? args.query
  if (!topic) throw new Error("Missing required --topic")
  const result = await runDeepResearch({
    projectPath: args.project,
    topic,
    queries: args.queries ?? args["search-queries"],
    maxResults: args["max-results"],
    tavilyApiKey: args["tavily-api-key"],
    tavilyTimeoutMs: args["tavily-timeout-ms"],
    tavilyKeychainService: args["tavily-keychain-service"],
    tavilyKeychainAccount: args["tavily-keychain-account"],
    provider: args.provider,
    model: args.model,
    apiKey: args["api-key"],
    endpoint: args.endpoint,
    reasoningEffort: args["reasoning-effort"],
    codexBin: args["codex-bin"],
    codexProfile: args["codex-profile"],
    codexProfileV2: args["codex-profile-v2"],
    codexTimeoutMs: args["codex-timeout-ms"],
    agentTimeoutMs: args["agent-timeout-ms"],
    sourceK: args["source-k"],
    sources: args.sources,
    graphDepth: args["graph-depth"],
    graphNeighbors: args["graph-neighbors"],
    topBrain: args["top-brain"],
    sqlLimit: args["sql-limit"],
    includeInvalidated: Boolean(args["include-invalidated"]),
    maxWikiIndexChars: args["max-wiki-index-chars"],
    showContext: Boolean(args["show-context"]),
    write: Boolean(args.write),
    ingest: Boolean(args.ingest),
    applyIngest: Boolean(args["apply-ingest"]),
    ingestProvider: args["ingest-provider"],
    ingestModel: args["ingest-model"],
    ingestApiKey: args["ingest-api-key"],
    ingestEndpoint: args["ingest-endpoint"],
    ingestReasoningEffort: args["ingest-reasoning-effort"],
    ingestTimeoutMs: args["ingest-timeout-ms"],
    pageConcurrency: args["page-concurrency"],
    maxPlanItems: args["max-plan-items"],
    maxCreatePages: args["max-create-pages"],
    maxUpdatePages: args["max-update-pages"],
    sourceSharding: args["source-sharding"],
    shardConcurrency: args["shard-concurrency"],
    maxShardChars: args["max-shard-chars"],
    allowSourceChange: Boolean(args["allow-source-change"]),
    onProgress: (message) => console.log(message),
  })

  if (args.json || args["show-context"]) {
    const { draftContent, ...jsonResult } = result
    console.log(JSON.stringify(jsonResult, null, 2))
    return
  }

  console.log("Deep research complete.")
  console.log(`Topic: ${result.topic}`)
  console.log(`Artifacts: ${result.outputDir}`)
  console.log(`Draft: ${result.outputs.draft}`)
  console.log(`Web results: ${result.web.resultCount} (${result.web.status})`)
  console.log(`Local context: wiki=${result.localContext.counts.wikiMatches}, raw=${result.localContext.counts.rawMatches}, graph=${result.localContext.counts.graphMatches}, facts=${result.localContext.counts.factsMatches}`)
  if (result.outputs.savedPath) console.log(`Saved wiki page: ${result.outputs.savedPath}`)
  if (result.outputs.ingest) {
    console.log(`Ingest report: ${result.outputs.ingest.reportDir}`)
    console.log(`Ingest manifest: ${result.outputs.ingest.manifestPath}`)
    console.log(`Ingest dry-run: ${result.outputs.ingest.dryRunReport}`)
    if (result.outputs.ingest.applied) {
      console.log(`Apply report: ${result.outputs.ingest.applied.reportPath}`)
      console.log(`Apply mode: ${result.outputs.ingest.applied.dryRun ? "dry-run" : "write"}`)
    }
  } else if (!args.write) {
    console.log("")
    console.log("Next:")
    console.log(`npm run codex:ingest -- deep-research --topic "${result.topic.replace(/"/g, '\\"')}" --write`)
    console.log(`npm run codex:ingest -- deep-research --topic "${result.topic.replace(/"/g, '\\"')}" --write --ingest`)
  }
}

async function handleHygiene(args) {
  const result = await runHygiene({
    action: args._[1] ?? "audit",
    projectPath: args.project,
    keepDays: args["keep-days"],
    write: Boolean(args.write),
  })
  console.log(JSON.stringify(result, null, 2))
}

async function handleTemporalFacts(args) {
  const subcommand = args._[1] ?? "audit"
  if (subcommand !== "audit") throw new Error("Unknown temporal-facts command. Use audit.")
  const result = await runTemporalFactsAudit({
    projectPath: args.project,
    topN: args["top-n"],
    write: Boolean(args.write),
  })
  if (args.write) {
    console.log(`Temporal facts audit written.`)
    console.log(`Markdown: ${result.outputs.markdown}`)
    console.log(`JSON: ${result.outputs.json}`)
    console.log(`Predicate candidates: ${result.counts.predicateCandidates}`)
    console.log(`Alias candidates: ${result.counts.aliasCandidates}`)
    console.log(`Alias conflicts: ${result.counts.aliasConflicts}`)
    console.log(`Curated alias rulings: ${result.counts.curatedAliasRulings}`)
    console.log(`Tag candidates: ${result.counts.tagCandidates}`)
    console.log(`Abbreviation candidates: ${result.counts.abbreviationCandidates}`)
    console.log(`Concept hierarchy rules: ${result.counts.conceptHierarchyRules}`)
    return
  }
  console.log(JSON.stringify({
    schema: result.schema,
    generatedAt: result.generatedAt,
    projectPath: result.projectPath,
    counts: result.counts,
    predicateCandidates: result.predicateCandidates.slice(0, 20),
    aliasCandidates: result.aliasCandidates.slice(0, 20),
    aliasConflicts: result.aliasConflicts.slice(0, 20),
    curatedAliasRulings: result.curatedAliasRulings.slice(0, 20),
    tagCandidates: result.tagCandidates.slice(0, 20),
    abbreviationCandidates: result.abbreviationCandidates.slice(0, 20),
    conceptHierarchyRules: result.conceptHierarchyRules,
  }, null, 2))
}

async function handleConcepts(args) {
  const subcommand = args._[1] ?? "audit"
  if (subcommand !== "audit") throw new Error("Unknown concepts command. Use audit.")
  const result = await runConceptGovernanceAudit({
    projectPath: args.project,
    topN: args["top-n"],
    write: Boolean(args.write),
    conceptRulingsPath: args["concept-rulings"],
  })
  if (args.write) {
    console.log(`Concept governance audit written.`)
    console.log(`Markdown: ${result.outputs.markdown}`)
    console.log(`JSON: ${result.outputs.json}`)
    console.log(`Concept pages: ${result.counts.conceptPages}`)
    console.log(`Duplicate title groups: ${result.counts.duplicateTitleGroups}`)
    console.log(`Alias-title conflicts: ${result.counts.aliasTitleConflicts}`)
    console.log(`Containment pairs: ${result.counts.containmentPairs}`)
    console.log(`Configured rules: ${result.counts.configuredRules}`)
    console.log(`Auto routes: ${result.counts.autoRoutes}`)
    return
  }
  console.log(JSON.stringify({
    schema: result.schema,
    generatedAt: result.generatedAt,
    projectPath: result.projectPath,
    rulingsPath: result.rulingsPath,
    counts: result.counts,
    duplicateTitleGroups: result.duplicateTitleGroups.slice(0, 20),
    aliasTitleConflicts: result.aliasTitleConflicts.slice(0, 20),
    containmentPairs: result.containmentPairs.slice(0, 20),
    ruleCoverage: result.ruleCoverage,
  }, null, 2))
}

async function handleBrain(args) {
  const subcommand = args._[1]
  if (subcommand === "remember") {
    const result = await rememberBrainMemory({
      projectPath: args.project,
      type: requireArg(args, "type"),
      text: requireArg(args, "text"),
      title: args.title,
      status: args.status,
      source: args.source,
      tags: args.tags,
      related: args.related,
    })
    console.log(`Remembered brain memory: ${result.record.id}`)
    console.log(`File: ${result.relativePath}`)
    return
  }
  if (subcommand === "status") {
    const result = await getBrainStatus({ projectPath: args.project })
    console.log(JSON.stringify(result, null, 2))
    return
  }
  if (subcommand === "resolve") {
    const result = await resolveBrainMemory({
      projectPath: args.project,
      id: requireArg(args, "id"),
      result: requireArg(args, "result"),
      note: args.note,
    })
    console.log(`Resolved brain memory: ${result.record.targetId} -> ${result.record.result}`)
    console.log(`Event: ${result.record.id}`)
    console.log(`File: ${result.relativePath}`)
    return
  }
  throw new Error("Unknown brain command. Use remember, status, or resolve.")
}

async function handleMarketValidate(args) {
  const result = await marketValidatePrediction({
    projectPath: args.project,
    prediction: requireArg(args, "prediction"),
    stock: requireArg(args, "stock"),
    window: args.window,
    write: Boolean(args.write),
    sqlLimit: args["sql-limit"],
  })
  console.log(JSON.stringify({
    dryRun: result.dryRun,
    query: result.query,
    verdict: result.record.verdict,
    reason: result.record.reason,
    stockCode: result.record.stockCode,
    marketValidation: result.marketValidation,
    writeResult: result.writeResult ? { relativePath: result.writeResult.relativePath } : null,
  }, null, 2))
}

async function handleCompanyResearch(args) {
  const result = await runCompanyResearch({
    projectPath: args.project,
    stock: requireArg(args, "stock"),
    from: args.from,
    to: args.to,
    reportId: args["report-id"],
    deep: Boolean(args.deep),
    pluginLed: Boolean(args["plugin-led"]),
    pluginLedTimeoutMs: args["plugin-led-timeout-ms"],
    pluginLedModel: args["plugin-led-model"],
    pluginReview: Boolean(args["plugin-review"]),
    pluginOptimize: Boolean(args["plugin-optimize"]),
    pluginReviewTimeoutMs: args["plugin-review-timeout-ms"],
    pluginReviewModel: args["plugin-review-model"],
    pluginOptimizeTimeoutMs: args["plugin-optimize-timeout-ms"],
    pluginOptimizeModel: args["plugin-optimize-model"],
    forceInvestmentBankingReview: Boolean(args["force-investment-banking-review"]),
    cninfoDownloadLimit: args["cninfo-download-limit"],
    cninfoDownloadTimeoutMs: args["cninfo-download-timeout-ms"],
    cninfoEventFrom: args["cninfo-event-from"],
    cninfoPeriodicFrom: args["cninfo-periodic-from"],
    companyProviderTimeoutMs: args["company-provider-timeout-ms"],
    sseTimeoutMs: args["sse-timeout-ms"],
    ssePageSize: args["sse-page-size"],
    disableSseFallback: Boolean(args["disable-sse-fallback"]),
    topWiki: args["top-wiki"],
    topRaw: args["top-raw"],
    graphNeighbors: args["graph-neighbors"],
    graphDepth: args["graph-depth"],
    sqlLimit: args["sql-limit"],
    apiKey: args["api-key"],
    endpoint: args.endpoint,
    model: args.model,
    codexBin: args["codex-bin"],
    codexProfile: args["codex-profile"],
    codexProfileV2: args["codex-profile-v2"],
    codexTimeoutMs: args["codex-timeout-ms"],
    onProgress: (message) => console.error(message),
  })
  console.log(JSON.stringify({
    mode: result.mode,
    generatedAt: result.generatedAt,
    company: result.company,
    outputDir: result.outputDir,
    providers: result.providers,
    providerEvents: result.providerEvents,
    deep: result.deep,
    pluginLed: result.pluginLed,
    pluginReview: result.pluginReview,
    pluginOptimization: result.pluginOptimization,
    outputs: {
      report: result.outputs.report,
      modelXlsx: result.outputs.modelXlsx,
      evidenceLedger: result.outputs.evidenceLedger,
      wikiCandidates: result.outputs.wikiCandidates,
      deepReport: result.outputs.deepReport,
      deepModelXlsx: result.outputs.deepModelXlsx,
      documentExtract: result.outputs.documentExtract,
      businessBreakdown: result.outputs.businessBreakdown,
      financialModelV2Xlsx: result.outputs.financialModelV2Xlsx,
      financialModelV2Json: result.outputs.financialModelV2Json,
      financialModelV2Template: result.outputs.financialModelV2Template,
      deepChecklist: result.outputs.deepChecklist,
      deepQualityAudit: result.outputs.deepQualityAudit,
      pluginLed: result.outputs.pluginLed,
      pluginLedInput: result.outputs.pluginLedInput,
      dataAnalyticsModelAnalysis: result.outputs.dataAnalyticsModelAnalysis,
      pluginLedReport: result.outputs.pluginLedReport,
      pluginLedDraftReport: result.outputs.pluginLedDraftReport,
      reportCompleteness: result.outputs.reportCompleteness,
      pluginReview: result.outputs.pluginReview,
      pluginReviewInput: result.outputs.pluginReviewInput,
      dataAnalyticsReview: result.outputs.dataAnalyticsReview,
      publicEquityReview: result.outputs.publicEquityReview,
      investmentBankingReview: result.outputs.investmentBankingReview,
      pluginOptimizationInput: result.outputs.pluginOptimizationInput,
      pluginOptimizationPrompt: result.outputs.pluginOptimizationPrompt,
      optimizedReport: result.outputs.optimizedReport,
      publishReadiness: result.outputs.publishReadiness,
      pluginOptimizationError: result.outputs.pluginOptimizationError,
      runSummary: result.outputs.runSummary,
    },
    writePolicy: result.writePolicy,
  }, null, 2))
}

async function handleDataSource(args) {
  const action = args._[1] ?? "status"
  const result = await runDataSource({
    action,
    keyword: args.keyword ?? args.query,
    areaCode: args["area-code"],
    msgType: args["msg-type"],
    pubDateStart: args["pub-date-start"],
    pubDateEnd: args["pub-date-end"],
    pageIndex: args["page-index"],
    pageSize: args["page-size"],
    qccTimeoutMs: args["qcc-timeout-ms"],
    stockCode: args["stock-code"],
    tradeDate: args["trade-date"],
    tushareTimeoutMs: args["tushare-timeout-ms"],
  })
  console.log(JSON.stringify(result, null, 2))
}

async function handleDailyLoop(args) {
  const result = await runDailyLoop({
    projectPath: args.project,
    provider: args.provider ?? "codex",
    apiKey: args["api-key"],
    endpoint: args.endpoint,
    model: args.model,
    useLlmQuestionPlanner: args["no-llm-question-planner"] ? false : undefined,
    reasoningEffort: args["reasoning-effort"],
    codexBin: args["codex-bin"],
    codexProfile: args["codex-profile"],
    codexProfileV2: args["codex-profile-v2"],
    codexTimeoutMs: args["codex-timeout-ms"],
    mode: args.mode,
    questionCount: args["question-count"],
    lookbackDays: args["lookback-days"],
    maxStocksPerQuestion: args["max-stocks-per-question"],
    maxExistingValidations: args["max-existing-validations"],
    validationWindows: args["validation-windows"],
    marketValidate: args["market-validate"],
    sourceK: args["source-k"],
    topWiki: args["top-wiki"],
    topRaw: args["top-raw"],
    topBrain: args["top-brain"],
    graphNeighbors: args["graph-neighbors"],
    graphDepth: args["graph-depth"],
    sqlLimit: args["sql-limit"],
    validatePendingOnly: Boolean(args["validate-pending-only"]),
    write: Boolean(args.write),
    showContext: Boolean(args["show-context"]),
  })
  if (args["show-context"]) {
    console.log(JSON.stringify(result, null, 2))
    return
  }
  console.log(JSON.stringify({
    dryRun: result.dryRun,
    mode: result.mode,
    runId: result.runId,
    counts: result.counts,
    sql: result.sql,
    marketValidation: result.marketValidation,
    questionPlanner: result.questionPlanner,
    report: result.reportRelativePath,
    feedback: result.feedbackRelativePath,
    compoundPaths: result.compoundPaths ?? [],
    selfTrainingActions: result.selfTraining?.actions?.length ?? null,
  }, null, 2))
}

async function handleSelfTrain(args) {
  const [, subcommand, planCommand] = args._ ?? []
  if (subcommand === "plan") {
    if (planCommand === "verify") {
      const result = await verifySelfTrainingPlans({
        projectPath: args.project,
        planPath: args.plan ?? args["plan-path"],
        limit: args.limit ?? args["max-plans"],
      })
      console.log(JSON.stringify(result, null, 2))
      return
    }
    if (planCommand === "list" || planCommand === "ledger") {
      const result = await listSelfTrainingPlans({
        projectPath: args.project,
        limit: args.limit ?? args["max-plans"],
      })
      console.log(JSON.stringify(result, null, 2))
      return
    }
    if (planCommand) throw new Error("Unknown self-train plan command. Use self-train plan, self-train plan list, or self-train plan verify.")
    const result = await planSelfTrainingActions({
      projectPath: args.project,
      status: args.status ?? "open",
      limit: args.limit ?? 5,
      rule: args.rule,
      target: args.target,
      action: args.action,
      write: Boolean(args.write),
    })
    console.log(JSON.stringify(result, null, 2))
    return
  }
  if (subcommand === "next") {
    const result = await listSelfTrainingActions({
      projectPath: args.project,
      status: args.status ?? "open",
      limit: args.limit ?? 5,
      rule: args.rule,
      target: args.target,
      action: args.action,
      orderBy: "priority",
    })
    console.log(JSON.stringify({
      ...result,
      schema: "self-training-action-next-v1",
      mode: "self-train-next",
    }, null, 2))
    return
  }
  if (subcommand === "actions" || subcommand === "list" || subcommand === "status") {
    const result = await listSelfTrainingActions({
      projectPath: args.project,
      status: args.status,
      limit: args.limit,
      rule: args.rule,
      target: args.target,
      action: args.action,
      orderBy: args["order-by"] ?? args.orderBy,
    })
    console.log(JSON.stringify(result, null, 2))
    return
  }
  if (subcommand === "review" || subcommand === "approve" || subcommand === "reject" || subcommand === "resolve") {
    const result = await reviewSelfTrainingAction({
      projectPath: args.project,
      id: args.id ?? args["action-id"],
      actionFingerprint: args["action-fingerprint"] ?? args.fingerprint,
      action: subcommand === "review" ? args.action ?? args.result ?? args.review : subcommand,
      reviewer: args.reviewer,
      note: args.note,
      quality: args.quality ?? args["review-quality"],
      evidenceRef: args["evidence-ref"],
      evidenceRefs: args["evidence-refs"] ?? args["source-refs"],
      write: Boolean(args.write),
    })
    console.log(JSON.stringify({
      dryRun: result.dryRun,
      mode: result.mode,
      action: result.action,
      actionRecord: {
        id: result.actionRecord.id,
        actionFingerprint: result.actionRecord.actionFingerprint,
        rule: result.actionRecord.rule,
        target: result.actionRecord.target,
        action: result.actionRecord.action,
      },
      reviewEvent: result.reviewEvent,
      writeResult: result.writeResult?.event ? { relativePath: result.writeResult.event.relativePath, records: result.writeResult.event.records } : null,
    }, null, 2))
    return
  }
  if (subcommand) throw new Error("Unknown self-train command. Use self-train, self-train actions, self-train next, self-train plan, or self-train review.")
  const result = await runSelfTraining({
    projectPath: args.project,
    includeReviewed: Boolean(args["include-reviewed"]),
    write: Boolean(args.write),
  })
  console.log(JSON.stringify(result, null, 2))
}

async function handleSelfQuestion(args) {
  const subcommand = args._[1]
  if (subcommand === "phase-check" || subcommand === "readiness" || subcommand === "check") {
    const result = await checkRecursiveAiPhase5Readiness({
      projectPath: args.project,
      actionLimit: args["action-limit"],
      planLimit: args["plan-limit"],
      exportLimit: args["export-limit"],
    })
    console.log(JSON.stringify(result, null, 2))
    if (!result.ready) {
      const gates = result.blockingGates.map((item) => item.gate).filter(Boolean).join(", ") || "unknown"
      throw new Error(`Phase 5 readiness blocked: ${gates}`)
    }
    return
  }
  if (subcommand === "phase-run" || subcommand === "run" || subcommand === "autopilot") {
    const result = await runRecursiveAiPhaseRun({
      ...args,
      projectPath: args.project,
      execute: Boolean(args.execute),
      write: Boolean(args.write),
    })
    console.log(JSON.stringify(result, null, 2))
    return
  }
  if (subcommand === "phase-advance" || subcommand === "advance" || subcommand === "next") {
    const result = await runRecursiveAiPhaseAdvance({
      ...args,
      projectPath: args.project,
      gate: args.gate ?? args["next-gate"],
      execute: Boolean(args.execute),
      write: Boolean(args.write),
    })
    console.log(JSON.stringify(result, null, 2))
    return
  }
  if (subcommand === "phase-status" || subcommand === "phase" || subcommand === "status") {
    const result = await getRecursiveAiPhaseStatus({
      projectPath: args.project,
      actionLimit: args["action-limit"],
      planLimit: args["plan-limit"],
      exportLimit: args["export-limit"],
    })
    console.log(JSON.stringify(result, null, 2))
    return
  }
  if (subcommand === "policy") {
    const policyCommand = args._[2]
    if (policyCommand === "list") {
      const result = await listActiveSelfQuestionPolicies({ projectPath: args.project })
      console.log(JSON.stringify({
        mode: "self-question-policy-list",
        counts: result.counts,
        policies: result.policies.map((policy) => ({
          policyId: policy.policyId,
          status: policy.status,
          scope: policy.scope,
          rule: policy.rule,
          evidenceGap: policy.evidenceGap,
          sourceProposalId: policy.sourceProposalId,
          approvedAt: policy.approvedAt,
          regressionQuestions: policy.regressionQuestions,
        })),
        reviewEvents: result.reviewEvents.map((event) => ({
          id: event.id,
          result: event.result,
          proposalPolicyId: event.proposalPolicyId,
          activePolicyId: event.activePolicyId,
          evidenceGap: event.evidenceGap,
          createdAt: event.createdAt,
        })),
      }, null, 2))
      return
    }
    if (policyCommand === "regression" || policyCommand === "regressions" || policyCommand === "eval") {
      const regressionCommand = args._[3]
      if (regressionCommand === "feedback" || regressionCommand === "failures" || regressionCommand === "review") {
        const result = await collectSelfQuestionPolicyRegressionFeedback({
          projectPath: args.project,
          executionPath: args.execution ?? args["execution-path"],
          write: Boolean(args.write),
        })
        console.log(JSON.stringify({
          dryRun: result.dryRun,
          mode: result.mode,
          runId: result.runId,
          sourceExecutionRunId: result.sourceExecutionRunId,
          sourceExecutionPath: result.sourceExecutionPath,
          counts: result.counts,
          feedbackItems: result.feedbackItems.map((item) => ({
            id: item.id,
            feedbackType: item.feedbackType,
            severity: item.severity,
            policyId: item.policyId,
            caseId: item.caseId,
            caseType: item.caseType,
            assertion: item.assertion,
            suggestedAction: item.suggestedAction,
          })),
          writeResult: result.writeResult ? { relativePath: result.writeResult.relativePath, records: result.writeResult.records } : null,
        }, null, 2))
        return
      }
      if (regressionCommand === "remediation" || regressionCommand === "remediate" || regressionCommand === "fixes" || regressionCommand === "proposals") {
        const remediationReviewCommand = args._[4]
        if (remediationReviewCommand === "patches" || remediationReviewCommand === "patch-candidates" || remediationReviewCommand === "export-patches") {
          const patchCommand = args._[5]
          if (patchCommand === "apply") {
            const result = await applySelfQuestionPolicyRegressionPatchCandidate({
              projectPath: args.project,
              patchPath: args.patch ?? args["patch-path"] ?? args.candidates ?? args["patch-candidates"],
              patchId: args["patch-id"] ?? args.id,
              remediationId: args["remediation-id"],
              reviewer: args.reviewer,
              note: args.note,
              force: Boolean(args.force),
              write: Boolean(args.write),
            })
            console.log(JSON.stringify({
              dryRun: result.dryRun,
              mode: result.mode,
              alreadyApplied: result.alreadyApplied,
              patchPath: result.patchPath,
              patchCandidate: {
                id: result.patchCandidate.id,
                patchTarget: result.patchCandidate.patchTarget,
                remediationId: result.patchCandidate.remediationId,
                policyId: result.patchCandidate.policyId,
                caseType: result.patchCandidate.caseType,
                assertion: result.patchCandidate.assertion,
              },
              activePolicyRevision: result.activePolicyRevision ? {
                id: result.activePolicyRevision.id,
                policyId: result.activePolicyRevision.policyId,
                revision: result.activePolicyRevision.revision,
                regressionAssertions: result.activePolicyRevision.regressionAssertions,
                promptGuardrails: result.activePolicyRevision.promptGuardrails,
              } : null,
              applyEvent: result.applyEvent ? {
                result: result.applyEvent.result,
                patchCandidateId: result.applyEvent.patchCandidateId,
                policyId: result.applyEvent.policyId,
                revision: result.applyEvent.revision,
                autoApplied: result.applyEvent.autoApplied,
              } : null,
              writeResult: {
                policy: result.writeResult.policy ? { relativePath: result.writeResult.policy.relativePath, records: result.writeResult.policy.records } : null,
                event: result.writeResult.event ? { relativePath: result.writeResult.event.relativePath, records: result.writeResult.event.records } : null,
              },
            }, null, 2))
            return
          }
          if (patchCommand) throw new Error("Unknown self-question policy regression remediation patches command. Use remediation patches or remediation patches apply.")
          const result = await exportSelfQuestionPolicyRegressionPatchCandidates({
            projectPath: args.project,
            remediationId: args["remediation-id"] ?? args.id,
            write: Boolean(args.write),
          })
          console.log(JSON.stringify({
            dryRun: result.dryRun,
            mode: result.mode,
            runId: result.runId,
            sourceBrainPath: result.sourceBrainPath,
            remediationId: result.remediationId,
            counts: result.counts,
            patchCandidates: result.patchCandidates.map((candidate) => ({
              id: candidate.id,
              status: candidate.status,
              patchTarget: candidate.patchTarget,
              remediationId: candidate.remediationId,
              remediationType: candidate.remediationType,
              feedbackType: candidate.feedbackType,
              policyId: candidate.policyId,
              caseId: candidate.caseId,
              caseType: candidate.caseType,
              assertion: candidate.assertion,
              applyMode: candidate.applyMode,
              autoApplied: candidate.autoApplied,
              nextCommand: candidate.nextCommand,
            })),
            writeResult: result.writeResult ? { relativePath: result.writeResult.relativePath, records: result.writeResult.records } : null,
          }, null, 2))
          return
        }
        if (remediationReviewCommand === "approve" || remediationReviewCommand === "reject") {
          const result = await reviewSelfQuestionPolicyRegressionRemediation({
            projectPath: args.project,
            action: remediationReviewCommand,
            remediationPath: args.remediation ?? args["remediation-path"],
            remediationId: args["remediation-id"] ?? args.id,
            reviewer: args.reviewer,
            note: args.note,
            write: Boolean(args.write),
          })
          console.log(JSON.stringify({
            dryRun: result.dryRun,
            mode: result.mode,
            action: result.action,
            remediationPath: result.remediationPath,
            remediationId: result.reviewEvent.remediationId,
            reviewEvent: {
              result: result.reviewEvent.result,
              remediationId: result.reviewEvent.remediationId,
              remediationType: result.reviewEvent.remediationType,
              feedbackType: result.reviewEvent.feedbackType,
              policyId: result.reviewEvent.policyId,
              caseId: result.reviewEvent.caseId,
              caseType: result.reviewEvent.caseType,
              proposedAction: result.reviewEvent.proposedAction,
              autoApplied: result.reviewEvent.autoApplied,
              note: result.reviewEvent.note,
            },
            writeResult: {
              event: result.writeResult.event ? { relativePath: result.writeResult.event.relativePath, records: result.writeResult.event.records } : null,
            },
          }, null, 2))
          return
        }
        if (remediationReviewCommand) throw new Error("Unknown self-question policy regression remediation command. Use remediation, remediation approve, remediation reject, or remediation patches.")
        const result = await proposeSelfQuestionPolicyRegressionRemediations({
          projectPath: args.project,
          feedbackPath: args.feedback ?? args["feedback-path"],
          write: Boolean(args.write),
        })
        console.log(JSON.stringify({
          dryRun: result.dryRun,
          mode: result.mode,
          runId: result.runId,
          sourceFeedbackRunId: result.sourceFeedbackRunId,
          sourceFeedbackPath: result.sourceFeedbackPath,
          counts: result.counts,
          proposals: result.proposals.map((proposal) => ({
            id: proposal.id,
            remediationType: proposal.remediationType,
            feedbackType: proposal.feedbackType,
            severity: proposal.severity,
            policyId: proposal.policyId,
            caseId: proposal.caseId,
            caseType: proposal.caseType,
            assertion: proposal.assertion,
            proposedAction: proposal.proposedAction,
            proposedQuestion: proposal.proposedQuestion,
            proposedPolicyPatch: proposal.proposedPolicyPatch,
          })),
          writeResult: result.writeResult ? { relativePath: result.writeResult.relativePath, records: result.writeResult.records } : null,
        }, null, 2))
        return
      }
      if (regressionCommand === "execute" || regressionCommand === "exec" || regressionCommand === "run-cases") {
        const result = await executeSelfQuestionPolicyRegressions({
          projectPath: args.project,
          regressionPath: args.regression ?? args["regression-path"],
          maxCases: args["max-cases"],
          timeoutMs: args["timeout-ms"] ?? args["case-timeout-ms"],
          maxOutputBytes: args["max-output-bytes"],
          concurrency: args.concurrency ?? args["policy-regression-concurrency"],
          execute: Boolean(args.execute),
          write: Boolean(args.write),
        })
        console.log(JSON.stringify({
          dryRun: result.dryRun,
          execute: result.execute,
          mode: result.mode,
          runId: result.runId,
          sourceRegressionRunId: result.sourceRegressionRunId,
          sourceRegressionPath: result.sourceRegressionPath,
          concurrency: result.concurrency,
          counts: result.counts,
          verdict: result.verdict,
          evaluation: result.evaluation ? {
            counts: result.evaluation.counts,
            failed: result.evaluation.results.filter((item) => item.status === "failed").map((item) => ({
              caseId: item.caseId,
              policyId: item.policyId,
              caseType: item.caseType,
              failedAssertions: item.assertions.filter((assertion) => assertion.status === "failed").map((assertion) => assertion.assertion),
            })),
            skipped: result.evaluation.results.filter((item) => item.status === "skipped").map((item) => ({
              caseId: item.caseId,
              policyId: item.policyId,
              caseType: item.caseType,
            })),
          } : null,
          commandFailures: result.results.filter((item) => item.status === "failed" || item.status === "timed_out").map((item) => ({
            caseId: item.caseId,
            policyId: item.policyId,
            caseType: item.caseType,
            status: item.status,
            exitCode: item.exitCode,
            timedOut: item.timedOut,
          })),
          writeResult: result.writeResult ? { relativePath: result.writeResult.relativePath, records: result.writeResult.records } : null,
        }, null, 2))
        return
      }
      if (regressionCommand === "evaluate" || regressionCommand === "run" || regressionCommand === "check") {
        const result = await evaluateSelfQuestionPolicyRegressions({
          projectPath: args.project,
          regressionPath: args.regression ?? args["regression-path"],
          outputsPath: args.outputs ?? args["outputs-path"],
          write: Boolean(args.write),
        })
        console.log(JSON.stringify({
          dryRun: result.dryRun,
          mode: result.mode,
          runId: result.runId,
          sourceRegressionRunId: result.sourceRegressionRunId,
          sourceRegressionPath: result.sourceRegressionPath,
          counts: result.counts,
          failed: result.results.filter((item) => item.status === "failed").map((item) => ({
            caseId: item.caseId,
            policyId: item.policyId,
            caseType: item.caseType,
            failedAssertions: item.assertions.filter((assertion) => assertion.status === "failed").map((assertion) => assertion.assertion),
          })),
          skipped: result.results.filter((item) => item.status === "skipped").map((item) => ({
            caseId: item.caseId,
            policyId: item.policyId,
            caseType: item.caseType,
          })),
          writeResult: result.writeResult ? { relativePath: result.writeResult.relativePath, records: result.writeResult.records } : null,
        }, null, 2))
        return
      }
      if (regressionCommand) throw new Error("Unknown self-question policy regression command. Use self-question policy regression, self-question policy regression evaluate, self-question policy regression execute, self-question policy regression feedback, or self-question policy regression remediation.")
      const result = await exportSelfQuestionPolicyRegressions({
        projectPath: args.project,
        maxPolicies: args["max-policies"],
        maxQuestionsPerPolicy: args["max-questions-per-policy"],
        write: Boolean(args.write),
      })
      console.log(JSON.stringify({
        dryRun: result.dryRun,
        mode: result.mode,
        runId: result.runId,
        counts: result.counts,
        policies: result.policies.map((policy) => ({
          policyId: policy.policyId,
          scope: policy.scope,
          rule: policy.rule,
          evidenceGap: policy.evidenceGap,
          regressionQuestions: policy.regressionQuestions,
        })),
        caseTypes: Object.keys(result.counts.byCaseType ?? {}),
        writeResult: result.writeResult ? { relativePath: result.writeResult.relativePath, records: result.writeResult.records } : null,
      }, null, 2))
      return
    }
    if (policyCommand === "approve" || policyCommand === "reject") {
      const result = await reviewSelfQuestionPolicyProposal({
        projectPath: args.project,
        action: policyCommand,
        policyId: args["policy-id"] ?? args.id,
        activePolicyId: args["active-policy-id"],
        proposalPath: args.proposal ?? args["proposal-path"],
        reviewer: args.reviewer,
        note: args.note,
        write: Boolean(args.write),
      })
      console.log(JSON.stringify({
        dryRun: result.dryRun,
        mode: result.mode,
        action: result.action,
        proposalPath: result.proposalPath,
        proposalPolicyId: result.proposal.policyId,
        activePolicy: result.activePolicy ? {
          policyId: result.activePolicy.policyId,
          status: result.activePolicy.status,
          scope: result.activePolicy.scope,
          rule: result.activePolicy.rule,
          evidenceGap: result.activePolicy.evidenceGap,
          sourceProposalId: result.activePolicy.sourceProposalId,
          regressionQuestions: result.activePolicy.regressionQuestions,
        } : null,
        reviewEvent: {
          result: result.reviewEvent.result,
          proposalPolicyId: result.reviewEvent.proposalPolicyId,
          activePolicyId: result.reviewEvent.activePolicyId,
          evidenceGap: result.reviewEvent.evidenceGap,
          note: result.reviewEvent.note,
        },
        writeResult: {
          policy: result.writeResult.policy ? { relativePath: result.writeResult.policy.relativePath, records: result.writeResult.policy.records } : null,
          event: result.writeResult.event ? { relativePath: result.writeResult.event.relativePath, records: result.writeResult.event.records } : null,
        },
      }, null, 2))
      return
    }
    if (policyCommand) throw new Error("Unknown self-question policy command. Use self-question policy, self-question policy list, self-question policy regression, self-question policy approve, or self-question policy reject.")
    const result = await proposeSelfQuestionPolicies({
      projectPath: args.project,
      minOccurrences: args["min-occurrences"],
      write: Boolean(args.write),
    })
    console.log(JSON.stringify({
      dryRun: result.dryRun,
      mode: result.mode,
      runId: result.runId,
      counts: result.counts,
      proposals: result.proposals.map((proposal) => ({
        policyId: proposal.policyId,
        status: proposal.status,
        scope: proposal.scope,
        rule: proposal.rule,
        trigger: proposal.trigger,
        evidenceGap: proposal.evidenceGap,
        occurrenceCount: proposal.occurrenceCount,
        sourceAttributionIds: proposal.sourceAttributionIds,
        regressionQuestions: proposal.regressionQuestions,
      })),
      writeResult: result.writeResult ? { relativePath: result.writeResult.relativePath, records: result.writeResult.records } : null,
    }, null, 2))
    return
  }
  if (subcommand === "evidence") {
    const evidenceCommand = args._[2]
    if (evidenceCommand === "resolve" || evidenceCommand === "result") {
      const result = await recordSelfQuestionEvidenceResult({
        projectPath: args.project,
        taskId: args["task-id"] ?? args.id,
        attributionId: args["attribution-id"],
        validationId: args["validation-id"],
        questionRecordId: args["question-record-id"],
        questionId: args["question-id"],
        provider: args.provider,
        signal: args.signal,
        evidenceGap: args["evidence-gap"],
        stockCode: args["stock-code"],
        stockName: args["stock-name"],
        target: args.target,
        command: args.command,
        result: args.result,
        summary: args.summary ?? args.note,
        sourceRefs: args["source-refs"] ?? args.source,
        write: Boolean(args.write),
      })
      console.log(JSON.stringify({
        dryRun: result.dryRun,
        mode: result.mode,
        record: result.record,
        writeResult: result.writeResult ? { relativePath: result.writeResult.relativePath, records: result.writeResult.records } : null,
      }, null, 2))
      return
    }
    if (evidenceCommand) throw new Error("Unknown self-question evidence command. Use self-question evidence or self-question evidence resolve.")
    const result = await collectSelfQuestionEvidenceTasks({
      projectPath: args.project,
      id: args.id ?? args["attribution-id"] ?? args["question-id"],
      maxTasks: args["max-tasks"],
      write: Boolean(args.write),
    })
    console.log(JSON.stringify({
      dryRun: result.dryRun,
      mode: result.mode,
      runId: result.runId,
      counts: result.counts,
      tasks: result.tasks.map((task) => ({
        id: task.id,
        attributionId: task.attributionId,
        provider: task.provider,
        signal: task.signal,
        stockCode: task.stockCode,
        stockName: task.stockName,
        target: task.target,
        command: task.command,
        status: task.status,
      })),
      writeResult: result.writeResult ? { relativePath: result.writeResult.relativePath, records: result.writeResult.records } : null,
    }, null, 2))
    return
  }
  if (subcommand === "attribute") {
    const result = await attributeSelfQuestionValidations({
      projectPath: args.project,
      id: args.id ?? args["validation-id"] ?? args["question-id"],
      maxValidations: args["max-validations"],
      write: Boolean(args.write),
    })
    console.log(JSON.stringify({
      dryRun: result.dryRun,
      mode: result.mode,
      runId: result.runId,
      counts: result.counts,
      attributions: result.attributions.map((item) => ({
        id: item.id,
        validationId: item.validationId,
        questionRecordId: item.questionRecordId,
        questionId: item.questionId,
        stockCode: item.stockCode,
        stockName: item.stockName,
        attributionLabel: item.attributionLabel,
        confidenceImpact: item.confidenceImpact,
        nextAction: item.nextAction,
        attributionReason: item.attributionReason,
        evidenceGaps: item.evidenceGaps,
      })),
      writeResult: result.writeResult ? { relativePath: result.writeResult.relativePath, records: result.writeResult.records } : null,
    }, null, 2))
    return
  }
  if (subcommand === "loop") {
    const performanceProfile = resolveCliPerformanceProfile(args)
    const result = await runSelfQuestionLoop({
      projectPath: args.project,
      stages: args.stages,
      questionCount: args["question-count"],
      lookbackDays: args["lookback-days"],
      maxStocksPerQuestion: args["max-stocks-per-question"],
      maxQuestions: args["max-questions"],
      maxValidations: args["max-validations"],
      validationWindows: args["validation-windows"],
      marketValidate: args["market-validate"],
      allowAnchoredExternalMarket: Boolean(args["allow-anchored-external-market"]),
      externalMarketTimeoutMs: args["external-market-timeout-ms"],
      externalMarketConcurrency: args["external-market-concurrency"],
      exportKinds: args["export-kinds"],
      exportQualityGate: args["export-quality-gate"] ?? args["quality-gate"],
      policyMinOccurrences: args["policy-min-occurrences"],
      executePolicyRegressions: Boolean(args["execute-policy-regressions"]),
      policyRegressionMaxCases: args["policy-regression-max-cases"] ?? args["max-cases"],
      policyRegressionTimeoutMs: args["policy-regression-timeout-ms"] ?? args["timeout-ms"],
      policyRegressionMaxOutputBytes: args["policy-regression-max-output-bytes"] ?? args["max-output-bytes"],
      policyRegressionConcurrency: args["policy-regression-concurrency"] ?? args.concurrency ?? performanceProfile.defaults.policyRegressionConcurrency,
      exportVerifyConcurrency: args["export-verify-concurrency"] ?? args["verify-concurrency"] ?? performanceProfile.defaults.exportVerifyConcurrency,
      regressionPath: args.regression ?? args["regression-path"],
      patchPath: args.patch ?? args["patch-path"] ?? args.candidates ?? args["patch-candidates"],
      patchId: args["patch-id"] ?? args["candidate-id"],
      remediationId: args["remediation-id"],
      applyPolicyRegressionPatches: Boolean(args["apply-policy-regression-patches"]),
      reviewer: args.reviewer,
      note: args.note,
      force: Boolean(args.force),
      provider: args.provider ?? "codex",
      model: args.model,
      apiKey: args["api-key"],
      endpoint: args.endpoint,
      reasoningEffort: args["reasoning-effort"],
      codexBin: args["codex-bin"],
      codexProfile: args["codex-profile"],
      codexProfileV2: args["codex-profile-v2"],
      codexTimeoutMs: args["codex-timeout-ms"],
      useLlmQuestionPlanner: !Boolean(args["no-llm-question-planner"]),
      loopArtifacts: !Boolean(args["no-loop-artifacts"]),
      selfTrainWrite: Boolean(args["self-train-write"]),
      write: Boolean(args.write),
    })
    console.log(JSON.stringify({
      status: result.status,
      dryRun: result.dryRun,
      mode: "self-question-loop",
      runId: result.runId,
      stages: result.stages,
      gateSummary: result.gateSummary,
      counts: result.counts,
      outputs: result.outputs,
      manifest: result.manifestRelativePath,
      selfTrainingActions: result.selfTraining?.actions?.length ?? null,
      selfTrainingActionPreview: (result.selfTraining?.actions ?? []).slice(0, 10).map((action) => ({
        rule: action.rule,
        target: action.target,
        action: action.action,
        reason: action.reason,
        affectedIds: action.affectedIds,
        gateStatus: action.gateStatus,
        nextStages: action.nextStages,
        suggestedCommands: action.suggestedCommands,
      })),
      policyProposals: result.policyRun?.proposals?.length ?? null,
      exports: result.exports.map((item) => ({
        kind: item.kind,
        count: item.count,
        relativePath: item.relativePath,
        manifest: item.manifestRelativePath,
        ledger: item.ledgerRelativePath,
      })),
    }, null, 2))
    return
  }
  if (subcommand === "validate") {
    const result = await validateSelfQuestions({
      projectPath: args.project,
      id: args.id ?? args["question-id"],
      maxQuestions: args["max-questions"],
      maxStocksPerQuestion: args["max-stocks-per-question"],
      validationWindows: args["validation-windows"],
      marketValidate: args["market-validate"],
      allowAnchoredExternalMarket: Boolean(args["allow-anchored-external-market"]),
      externalMarketTimeoutMs: args["external-market-timeout-ms"],
      externalMarketConcurrency: args["external-market-concurrency"],
      sqlLimit: args["sql-limit"],
      write: Boolean(args.write),
    })
    console.log(JSON.stringify({
      dryRun: result.dryRun,
      mode: result.mode,
      runId: result.runId,
      counts: result.counts,
      sql: result.sql,
      marketValidation: result.marketValidation,
      questions: result.questions,
      validations: result.validations.map((validation) => ({
        id: validation.id,
        questionRecordId: validation.questionRecordId,
        questionId: validation.questionId,
        stockCode: validation.stockCode,
        stockName: validation.stockName,
        windowDays: validation.windowDays,
        verdict: validation.verdict,
        reason: validation.reason,
        evidenceGaps: validation.evidenceGaps,
      })),
      writeResult: result.writeResult ? { relativePath: result.writeResult.relativePath, records: result.writeResult.records } : null,
    }, null, 2))
    return
  }
  if (subcommand) throw new Error("Unknown self-question command. Use self-question, self-question loop, self-question validate, self-question attribute, self-question evidence, or self-question policy.")
  const result = await runSelfQuestion({
    projectPath: args.project,
    mode: args.mode,
    questionCount: args["question-count"],
    lookbackDays: args["lookback-days"],
    maxStocksPerQuestion: args["max-stocks-per-question"],
    validationWindows: args["validation-windows"],
    marketValidate: args["market-validate"],
    provider: args.provider ?? "codex",
    model: args.model,
    apiKey: args["api-key"],
    endpoint: args.endpoint,
    reasoningEffort: args["reasoning-effort"],
    codexBin: args["codex-bin"],
    codexProfile: args["codex-profile"],
    codexProfileV2: args["codex-profile-v2"],
    codexTimeoutMs: args["codex-timeout-ms"],
    useLlmQuestionPlanner: !Boolean(args["no-llm-question-planner"]),
    write: Boolean(args.write),
  })
  console.log(JSON.stringify(result, null, 2))
}

async function handleExportSamples(args) {
  const [, subcommand] = args._ ?? []
  if (subcommand === "list" || subcommand === "ledger") {
    const result = await listTrainingSampleExports({
      projectPath: args.project,
      kind: args.kind,
      qualityGate: args["quality-gate"],
      limit: args.limit ?? args["max-exports"],
    })
    console.log(JSON.stringify({
      mode: "export-samples-list",
      ledger: result.ledgerRelativePath,
      totalEntries: result.totalEntries,
      filteredEntries: result.filteredEntries,
      returned: result.returned,
      limit: result.limit,
      filters: result.filters,
      summary: result.summary,
      entries: result.entries,
    }, null, 2))
    return
  }
  if (subcommand === "verify") {
    const performanceProfile = resolveCliPerformanceProfile(args)
    const result = await verifyTrainingSampleExports({
      projectPath: args.project,
      kind: args.kind,
      qualityGate: args["quality-gate"],
      limit: args.limit ?? args["max-exports"],
      concurrency: args.concurrency ?? args["verify-concurrency"] ?? args["export-verify-concurrency"] ?? performanceProfile.defaults.verifyConcurrency,
    })
    console.log(JSON.stringify({
      mode: "export-samples-verify",
      ledger: result.ledgerRelativePath,
      status: result.status,
      checked: result.checked,
      passed: result.passed,
      failed: result.failed,
      issueCount: result.issueCount,
      totalEntries: result.totalEntries,
      filteredEntries: result.filteredEntries,
      limit: result.limit,
      concurrency: result.concurrency,
      filters: result.filters,
      entries: result.entries,
    }, null, 2))
    return
  }
  if (subcommand) throw new Error("Unknown export-samples command. Use export-samples, export-samples list, or export-samples verify.")
  const result = await exportTrainingSamples({
    projectPath: args.project,
    kind: requireArg(args, "kind"),
    qualityGate: args["quality-gate"],
  })
  console.log(`Exported ${result.count} ${result.kind} samples`)
  if (result.qualityGate !== "all") console.log(`Quality gate: ${result.qualityGate}`)
  console.log(`File: ${result.relativePath}`)
  console.log(`Manifest: ${result.manifestRelativePath}`)
  console.log(`Ledger: ${result.ledgerRelativePath}`)
}

async function handleStockFeedback(args) {
  const [, subcommand] = args._ ?? []
  if (!subcommand || subcommand === "status") {
    const result = await getStockFeedbackStatus({
      projectPath: args.project,
    })
    console.log(JSON.stringify(result, null, 2))
    return
  }
  if (subcommand === "build-trajectories" || subcommand === "build") {
    const result = await buildStockFeedbackTrajectories({
      projectPath: args.project,
      write: Boolean(args.write),
    })
    console.log(JSON.stringify(result, null, 2))
    return
  }
  if (subcommand === "bench" || subcommand === "benchmark") {
    const result = await buildStockFeedbackBenchmark({
      projectPath: args.project,
      limit: args.limit ?? args["max-cases"],
      write: Boolean(args.write),
    })
    console.log(JSON.stringify(result, null, 2))
    return
  }
  if (subcommand === "list") {
    const result = await listStockFeedbackTrajectories({
      projectPath: args.project,
      validationTarget: args["validation-target"] ?? args.target,
      qualityGate: args["quality-gate"],
      marketPattern: args["market-pattern"] ?? args.pattern,
      stock: args.stock,
      hypothesis: args.hypothesis,
      date: args.date,
      limit: args.limit,
      persistedOnly: Boolean(args["persisted-only"]),
    })
    console.log(JSON.stringify(result, null, 2))
    return
  }
  if (subcommand === "review-queue" || subcommand === "queue") {
    const result = await listStockFeedbackReviewQueue({
      projectPath: args.project,
      validationTarget: args["validation-target"] ?? args.target,
      qualityGate: args["quality-gate"],
      marketPattern: args["market-pattern"] ?? args.pattern,
      stock: args.stock,
      hypothesis: args.hypothesis,
      date: args.date,
      limit: args.limit,
      includeReviewed: Boolean(args["include-reviewed"]),
    })
    console.log(JSON.stringify(result, null, 2))
    return
  }
  if (subcommand === "review" || subcommand === "route") {
    const result = await reviewStockFeedbackTrajectory({
      projectPath: args.project,
      trajectoryId: args["trajectory-id"] ?? args.id,
      action: args.action ?? args.review,
      reviewer: args.reviewer,
      note: args.note,
      write: Boolean(args.write),
    })
    console.log(JSON.stringify(result, null, 2))
    return
  }
  if (subcommand === "collection-task" || subcommand === "collect-task") {
    const result = await planStockFeedbackCollectionTask({
      projectPath: args.project,
      marketPattern: args["market-pattern"] ?? args.pattern,
      profitCredit: args["profit-credit"] ?? args.credit,
      generatedAt: args["generated-at"],
      write: Boolean(args.write),
    })
    console.log(JSON.stringify(result, null, 2))
    return
  }
  if (subcommand === "collection-result" || subcommand === "collect-result") {
    const result = await recordStockFeedbackCollectionResult({
      projectPath: args.project,
      draftId: args["draft-id"],
      taskId: args["task-id"],
      marketPattern: args["market-pattern"] ?? args.pattern,
      profitCredit: args["profit-credit"] ?? args.credit,
      result: args.result,
      evidenceRefs: args["evidence-refs"] ?? args["evidence-ref"],
      summary: args.summary ?? args.note,
      reviewer: args.reviewer,
      stockName: args["stock-name"],
      stockCode: args["stock-code"],
      hypothesis: args.hypothesis,
      generatedAt: args["generated-at"],
      write: Boolean(args.write),
    })
    console.log(JSON.stringify(result, null, 2))
    return
  }
  if (subcommand === "evidence-task" || subcommand === "evidence-tasks") {
    const [, , action] = args._ ?? []
    if (!action || action === "list") {
      const result = await listStockFeedbackEvidenceTasks({
        projectPath: args.project,
        status: args.status,
        source: args.source,
        taskType: args["task-type"] ?? args.type,
        stock: args.stock ?? args["stock-code"],
        limit: args.limit,
      })
      console.log(JSON.stringify(result, null, 2))
      return
    }
    if (action === "create" || action === "append") {
      const result = await createStockFeedbackEvidenceTask({
        projectPath: args.project,
        taskId: args["task-id"],
        source: args.source,
        sourceId: args["source-id"],
        stockCode: args["stock-code"],
        stockName: args["stock-name"],
        taskType: args["task-type"] ?? args.type,
        targetFields: args["target-fields"] ?? args.fields ?? args.field,
        preferredSources: args["preferred-sources"] ?? args.sources,
        priority: args.priority,
        notes: args.notes ?? args.note,
        sourceRefs: args["source-refs"] ?? args["source-ref"],
        toolStateRefs: args["tool-state-refs"] ?? args["tool-state-ref"],
        structuredDataJson: args["structured-data-json"],
        generatedAt: args["generated-at"],
        write: Boolean(args.write),
      })
      console.log(JSON.stringify(result, null, 2))
      return
    }
    if (action === "show" || action === "get") {
      const result = await showStockFeedbackEvidenceTask({
        projectPath: args.project,
        taskId: args["task-id"] ?? args.id,
      })
      console.log(JSON.stringify(result, null, 2))
      return
    }
    throw new Error("Unknown stock-feedback evidence-task command. Use stock-feedback evidence-task create, list, or show.")
  }
  if (subcommand === "run-task-queue" || subcommand === "run-evidence-queue") {
    const result = await runStockFeedbackEvidenceTaskQueue({
      projectPath: args.project,
      taskId: args["task-id"] ?? args.id,
      limit: args.limit,
      generatedAt: args["generated-at"],
      tavilyApiKey: args["tavily-api-key"],
      tavilyTimeoutMs: args["tavily-timeout-ms"],
      tavilyMaxResults: args["tavily-max-results"],
      tavilyKeychainService: args["tavily-keychain-service"],
      tavilyKeychainAccount: args["tavily-keychain-account"],
      write: Boolean(args.write),
    })
    console.log(JSON.stringify(result, null, 2))
    return
  }
  if (subcommand === "evidence-result" || subcommand === "evidence-results") {
    const [, , action] = args._ ?? []
    if (!action || action === "list") {
      const result = await listStockFeedbackEvidenceResults({
        projectPath: args.project,
        status: args.status,
        taskId: args["task-id"],
        limit: args.limit,
      })
      console.log(JSON.stringify(result, null, 2))
      return
    }
    if (action === "review") {
      const result = await reviewStockFeedbackEvidenceResult({
        projectPath: args.project,
        resultId: args["result-id"] ?? args.id,
        action: args.action,
        reviewer: args.reviewer,
        note: args.note,
        generatedAt: args["generated-at"],
        write: Boolean(args.write),
      })
      console.log(JSON.stringify(result, null, 2))
      return
    }
    throw new Error("Unknown stock-feedback evidence-result command. Use stock-feedback evidence-result list or review.")
  }
  if (subcommand === "source-status" || subcommand === "evidence-source-status") {
    const result = await getStockFeedbackEvidenceSourceStatus({
      projectPath: args.project,
    })
    console.log(JSON.stringify(result, null, 2))
    return
  }
  if (subcommand === "dlq" || subcommand === "evidence-dlq") {
    const [, , action] = args._ ?? []
    if (!action || action === "list") {
      const result = await listStockFeedbackEvidenceDlq({
        projectPath: args.project,
        status: args.status,
        limit: args.limit,
      })
      console.log(JSON.stringify(result, null, 2))
      return
    }
    if (action === "retry" || action === "discard") {
      const result = await updateStockFeedbackEvidenceDlqEntry({
        projectPath: args.project,
        action,
        dlqId: args["dlq-id"] ?? args.id,
        taskId: args["task-id"],
        reviewer: args.reviewer,
        note: args.note,
        generatedAt: args["generated-at"],
        write: Boolean(args.write),
      })
      console.log(JSON.stringify(result, null, 2))
      return
    }
    throw new Error("Unknown stock-feedback dlq command. Use stock-feedback dlq list, retry, or discard.")
  }
  if (subcommand === "execution-result" || subcommand === "execution-results") {
    const [, , action] = args._ ?? []
    if (!action || action === "list") {
      const result = await listStockFeedbackExecutionResults({
        projectPath: args.project,
        status: args.status,
        stock: args.stock ?? args["stock-code"],
        pnlScope: args["pnl-scope"],
        limit: args.limit,
      })
      console.log(JSON.stringify(result, null, 2))
      return
    }
    if (action === "import") {
      const result = await importStockFeedbackExecutionResults({
        projectPath: args.project,
        fromDeliveryNotes: Boolean(args["from-delivery-notes"]),
        fromPositionTracking: Boolean(args["from-position-tracking"]),
        dates: args.dates ?? args.date,
        autoMarketEvidence: Boolean(args["auto-market-evidence"]),
        marketEvidenceLookaheadDays: args["market-evidence-lookahead-days"],
        marketEvidenceEndDate: args["market-evidence-end-date"],
        marketEvidenceBenchmarkCode: args["market-evidence-benchmark-code"],
        tushareTimeoutMs: args["tushare-timeout-ms"],
        generatedAt: args["generated-at"],
        write: Boolean(args.write),
      })
      console.log(JSON.stringify(result, null, 2))
      return
    }
    if (action === "validate") {
      const result = await validateStockFeedbackExecutionResults({
        projectPath: args.project,
        fromDeliveryNotes: args["from-delivery-notes"] !== undefined ? Boolean(args["from-delivery-notes"]) : undefined,
        fromPositionTracking: args["from-position-tracking"] !== undefined ? Boolean(args["from-position-tracking"]) : undefined,
        dates: args.dates ?? args.date,
        autoMarketEvidence: Boolean(args["auto-market-evidence"]),
        marketEvidenceLookaheadDays: args["market-evidence-lookahead-days"],
        marketEvidenceEndDate: args["market-evidence-end-date"],
        marketEvidenceBenchmarkCode: args["market-evidence-benchmark-code"],
        tushareTimeoutMs: args["tushare-timeout-ms"],
        generatedAt: args["generated-at"],
        write: Boolean(args.write),
      })
      console.log(JSON.stringify(result, null, 2))
      return
    }
    if (action === "review") {
      const result = await reviewStockFeedbackExecutionResult({
        projectPath: args.project,
        artifactId: args["artifact-id"] ?? args.id,
        action: args.action,
        reviewer: args.reviewer,
        note: args.note,
        generatedAt: args["generated-at"],
        write: Boolean(args.write),
      })
      console.log(JSON.stringify(result, null, 2))
      return
    }
    if (action === "verify") {
      const result = await verifyStockFeedbackExecutionResults({
        projectPath: args.project,
      })
      console.log(JSON.stringify(result, null, 2))
      return
    }
    throw new Error("Unknown stock-feedback execution-result command. Use stock-feedback execution-result import, validate, list, review, or verify.")
  }
  if (subcommand === "paper-trade-agent" || subcommand === "paper-agent") {
    const [, , action] = args._ ?? []
    if (!action || action === "candidates" || action === "status" || action === "plan") {
      const result = await buildStockFeedbackPaperTradeAgentCandidates({
        projectPath: args.project,
        limit: args.limit,
        generatedAt: args["generated-at"],
        write: Boolean(args.write),
      })
      console.log(JSON.stringify(result, null, 2))
      return
    }
    throw new Error("Unknown stock-feedback paper-trade-agent command. Use stock-feedback paper-trade-agent candidates [--write].")
  }
  if (subcommand === "paper-trade" || subcommand === "paper-trades") {
    const [, , action] = args._ ?? []
    if (!action || action === "status" || action === "list") {
      const result = await getStockFeedbackPaperTradeStatus({
        projectPath: args.project,
        limit: args.limit,
      })
      console.log(JSON.stringify(result, null, 2))
      return
    }
    if (action === "discretionary-review" || action === "review-runner") {
      const result = await runStockFeedbackPaperTradeDiscretionaryReview({
        projectPath: args.project,
        limit: args.limit,
        generatedAt: args["generated-at"],
      })
      console.log(JSON.stringify(result, null, 2))
      return
    }
    if (action === "record" || action === "append") {
      const result = await recordStockFeedbackPaperTrade({
        projectPath: args.project,
        ledgerKind: args["ledger-kind"],
        track: args.track,
        status: args.status,
        sourceQuestionId: args["source-question-id"],
        sourceTrajectoryId: args["source-trajectory-id"],
        validationTarget: args["validation-target"] ?? args.target,
        asOfDate: args["as-of-date"] ?? args.asOfDate,
        stockName: args["stock-name"],
        stockCode: args["stock-code"],
        hypothesis: args.hypothesis,
        expectedMove: args["expected-move"],
        entryDate: args["entry-date"],
        entryPrice: args["entry-price"],
        entryTiming: args["entry-timing"],
        exitDate: args["exit-date"],
        exitPrice: args["exit-price"],
        exitTiming: args["exit-timing"],
        exitReason: args["exit-reason"],
        positionSizing: args["position-sizing"],
        realizedPnlPct: args["realized-pnl-pct"] ?? args["pnl-pct"],
        maxDrawdownPct: args["max-drawdown-pct"] ?? args["drawdown-pct"],
        holdingDays: args["holding-days"] ?? args["hold-days"],
        sourceRefs: args["source-refs"] ?? args["source-ref"],
        evidenceRefs: args["evidence-refs"] ?? args["evidence-ref"],
        autoMarketEvidence: Boolean(args["auto-market-evidence"]),
        autoMicrostructureEvidence: Boolean(args["auto-microstructure-evidence"]),
        microstructureDate: args["microstructure-date"],
        marketEvidenceProvider: args["market-evidence-provider"],
        marketEvidenceLookaheadDays: args["market-evidence-lookahead-days"],
        marketEvidenceSqlLimit: args["market-evidence-sql-limit"],
        marketEvidenceEndDate: args["market-evidence-end-date"],
        marketEvidenceBenchmarkCode: args["market-evidence-benchmark-code"],
        priceSqlRef: args["price-sql-ref"],
        marketDataRef: args["market-data-ref"],
        marketEvidenceSource: args["market-evidence-source"],
        marketEvidenceRows: args["market-evidence-rows"],
        periodReturnPct: args["period-return-pct"],
        relativeStrength: args["relative-strength"],
        relativeStrengthBasis: args["relative-strength-basis"],
        turnoverChange: args["turnover-change"],
        followThrough1d: args["follow-through-1d"],
        followThrough3d: args["follow-through-3d"],
        followThrough5d: args["follow-through-5d"],
        maxDrawdownInHolding: args["max-drawdown-in-holding"],
        tushareTimeoutMs: args["tushare-timeout-ms"],
        pgConnectTimeoutMs: args["pg-connect-timeout-ms"],
        pgStatementTimeoutMs: args["pg-statement-timeout-ms"],
        generatedAt: args["generated-at"],
        write: Boolean(args.write),
      })
      console.log(JSON.stringify(result, null, 2))
      return
    }
    if (action === "settle" || action === "close") {
      const result = await settleStockFeedbackPaperTrade({
        projectPath: args.project,
        paperTradeId: args["paper-trade-id"] ?? args.id ?? args["trade-id"],
        exitDate: args["exit-date"],
        exitPrice: args["exit-price"],
        exitTiming: args["exit-timing"],
        exitReason: args["exit-reason"],
        positionSizing: args["position-sizing"],
        entryTiming: args["entry-timing"],
        realizedPnlPct: args["realized-pnl-pct"] ?? args["pnl-pct"],
        maxDrawdownPct: args["max-drawdown-pct"] ?? args["drawdown-pct"],
        holdingDays: args["holding-days"] ?? args["hold-days"],
        sourceRefs: args["source-refs"] ?? args["source-ref"],
        evidenceRefs: args["evidence-refs"] ?? args["evidence-ref"],
        autoMarketEvidence: Boolean(args["auto-market-evidence"]),
        autoMicrostructureEvidence: Boolean(args["auto-microstructure-evidence"]),
        microstructureDate: args["microstructure-date"],
        marketEvidenceProvider: args["market-evidence-provider"],
        marketEvidenceLookaheadDays: args["market-evidence-lookahead-days"],
        marketEvidenceSqlLimit: args["market-evidence-sql-limit"],
        marketEvidenceEndDate: args["market-evidence-end-date"],
        marketEvidenceBenchmarkCode: args["market-evidence-benchmark-code"],
        priceSqlRef: args["price-sql-ref"],
        marketDataRef: args["market-data-ref"],
        marketEvidenceSource: args["market-evidence-source"],
        marketEvidenceRows: args["market-evidence-rows"],
        periodReturnPct: args["period-return-pct"],
        relativeStrength: args["relative-strength"],
        relativeStrengthBasis: args["relative-strength-basis"],
        turnoverChange: args["turnover-change"],
        followThrough1d: args["follow-through-1d"],
        followThrough3d: args["follow-through-3d"],
        followThrough5d: args["follow-through-5d"],
        maxDrawdownInHolding: args["max-drawdown-in-holding"],
        reviewer: args.reviewer,
        force: Boolean(args.force),
        tushareTimeoutMs: args["tushare-timeout-ms"],
        pgConnectTimeoutMs: args["pg-connect-timeout-ms"],
        pgStatementTimeoutMs: args["pg-statement-timeout-ms"],
        generatedAt: args["generated-at"],
        write: Boolean(args.write),
      })
      console.log(JSON.stringify(result, null, 2))
      return
    }
    throw new Error("Unknown stock-feedback paper-trade command. Use stock-feedback paper-trade status, record, settle, or discretionary-review.")
  }
  if (subcommand === "export-lora-ready" || subcommand === "lora-ready") {
    const result = await exportStockFeedbackLoraReady({
      projectPath: args.project,
      validationTarget: args["validation-target"] ?? args.target,
      qualityGate: args["quality-gate"],
      limit: args.limit,
      write: Boolean(args.write),
    })
    console.log(JSON.stringify(result, null, 2))
    return
  }
  if (subcommand === "verify") {
    const result = await verifyStockFeedbackArtifacts({
      projectPath: args.project,
    })
    console.log(JSON.stringify(result, null, 2))
    return
  }
  throw new Error("Unknown stock-feedback command. Use stock-feedback status, build-trajectories, bench, list, review-queue, review, collection-task, collection-result, evidence-task, run-task-queue, evidence-result, source-status, dlq, execution-result, paper-trade-agent, paper-trade, export-lora-ready, or verify.")
}

async function handleAutoresearch(args) {
  const [, subcommand, nested] = args._ ?? []
  if (subcommand === "program" || subcommand === "create-program") {
    const result = await createAutoresearchProgram({
      projectPath: args.project,
      title: args.title ?? args.query ?? args.program,
      hypothesis: args.hypothesis ?? args.objective,
      lanes: args.lanes ?? args.lane,
      editableArtifacts: args["editable-artifacts"] ?? args.editableArtifacts,
      slug: args.slug,
      write: Boolean(args.write),
    })
    console.log(JSON.stringify(result, null, 2))
    return
  }
  if (subcommand === "score") {
    console.log(JSON.stringify(scoreAutoresearchExperiment({
      marketFeedbackScore: args["market-feedback-score"],
      evidenceClosureScore: args["evidence-closure-score"],
      attributionQualityScore: args["attribution-quality-score"],
      noveltyScore: args["novelty-score"],
      leakagePenalty: args["leakage-penalty"],
      complexityPenalty: args["complexity-penalty"],
      hypeWithoutOrderPenalty: args["hype-without-order-penalty"],
    }), null, 2))
    return
  }
  if (subcommand === "ledger" && (nested === "append" || nested === "record")) {
    const result = await appendAutoresearchExperiment({
      projectPath: args.project,
      programId: args["program-id"] ?? args.programId,
      hypothesis: args.hypothesis,
      changedArtifact: args["changed-artifact"] ?? args.changedArtifact,
      baselineScore: args["baseline-score"],
      newScore: args["new-score"],
      decision: args.decision,
      evidenceGaps: args["evidence-gaps"],
      futureValidationDate: args["future-validation-date"],
      manifestPath: args.manifest,
      write: Boolean(args.write),
    })
    console.log(JSON.stringify(result, null, 2))
    return
  }
  if ((subcommand === "ledger" && (!nested || nested === "list")) || subcommand === "experiments") {
    const result = await listAutoresearchExperiments({ projectPath: args.project })
    console.log(JSON.stringify(result, null, 2))
    return
  }
  if (subcommand === "status" || subcommand === "readiness") {
    const result = await getAutoresearchReadiness({ projectPath: args.project })
    console.log(JSON.stringify(result, null, 2))
    return
  }
  if (subcommand === "proposal" || subcommand === "propose" || (subcommand === "policy" && nested === "propose") || subcommand === "propose-policy") {
    const result = await proposeAutoresearchPolicyChanges({
      projectPath: args.project,
      minScoreDelta: args["min-score-delta"],
      changedArtifacts: args["changed-artifacts"],
      write: Boolean(args.write),
    })
    console.log(JSON.stringify(result, null, 2))
    return
  }
  throw new Error("Unknown autoresearch command. Use autoresearch program, autoresearch score, autoresearch ledger append, autoresearch ledger, or autoresearch policy propose.")
}

async function handleResearchOs(args) {
  const [, scope, action] = args._ ?? []
  if (scope !== "agent") {
    throw new Error("Unknown research-os command. Use research-os agent status, plan, step, review, or verify.")
  }
  if (!action || action === "status" || action === "context") {
    const result = await buildResearchOsAgentStatus({
      projectPath: args.project,
      generatedAt: args["generated-at"],
      write: Boolean(args.write),
    })
    console.log(JSON.stringify(result, null, 2))
    return
  }
  if (action === "plan") {
    const result = await buildResearchOsAgentPlan({
      projectPath: args.project,
      generatedAt: args["generated-at"],
      write: Boolean(args.write),
    })
    console.log(JSON.stringify(result, null, 2))
    return
  }
  if (action === "step" || action === "run-step") {
    const result = await runResearchOsAgentStep({
      projectPath: args.project,
      stepId: args["step-id"] ?? args.id,
      generatedAt: args["generated-at"],
      limit: args.limit,
      status: args.status,
      write: Boolean(args.write),
      humanGateConfirmed: parseExplicitBoolean(args["confirm-human-gate"] ?? args["human-gate-confirmed"] ?? args.approved),
    })
    console.log(JSON.stringify(result, null, 2))
    return
  }
  if (action === "review") {
    const result = await listResearchOsAgentReviewItems({
      projectPath: args.project,
      generatedAt: args["generated-at"],
      queueId: args.queue ?? args["queue-id"],
      source: args.source,
      operatorNextStep: args["operator-next-step"] ?? args.operatorNextStep,
      dryRunReady: args["dry-run-ready"] ?? args.dryRunReady,
      writeCommandReady: args["write-ready"] ?? args.writeReady,
      actionLimit: args["action-limit"] ?? args.limit,
    })
    console.log(JSON.stringify(result, null, 2))
    return
  }
  if (action === "verify") {
    const result = await verifyResearchOsAgentArtifacts({
      projectPath: args.project,
    })
    console.log(JSON.stringify(result, null, 2))
    return
  }
  throw new Error("Unknown research-os agent command. Use research-os agent status, plan, step, review, or verify.")
}

function parseExplicitBoolean(value) {
  if (value === true || value === false) return value
  if (value === undefined || value === null || value === "") return false
  const raw = String(value).trim().toLowerCase()
  return ["1", "true", "yes", "y", "on", "approved"].includes(raw)
}

async function handleHypothesis(args) {
  const [, subcommand, inboxCommand] = args._ ?? []
  if (subcommand === "wechat-inbox") {
    if (inboxCommand === "append") {
      const result = await appendWechatIncrementMessages({
        projectPath: args.project,
        messageJson: args["message-json"] ?? args.messageJson,
        sourcePath: args.source,
      })
      console.log(JSON.stringify(result, null, 2))
      return
    }
    if (inboxCommand === "import-raw") {
      const result = await importWechatRawChatMessages({
        projectPath: args.project,
        sourcePath: args.source,
        since: args.since,
        limit: args.limit,
        write: Boolean(args.write),
      })
      console.log(JSON.stringify(result, null, 2))
      return
    }
    if (inboxCommand === "sources") {
      const result = await listWechatRawChatSources({
        projectPath: args.project,
        sourcePath: args.source,
        limit: args.limit,
      })
      console.log(JSON.stringify(result, null, 2))
      return
    }
    if (inboxCommand === "process") {
      const result = await processWechatIncrementInbox({
        projectPath: args.project,
        dryRun: Boolean(args["dry-run"]),
      })
      console.log(JSON.stringify(result, null, 2))
      return
    }
    if (inboxCommand === "status") {
      const result = await getWechatIncrementInboxStatus({
        projectPath: args.project,
      })
      console.log(JSON.stringify(result, null, 2))
      return
    }
    if (inboxCommand === "serve") {
      const server = await startWechatIncrementServer({
        projectPath: args.project,
        host: args.host,
        port: args.port,
        token: args.token ?? process.env.WECHAT_INCREMENT_TOKEN,
        maxBodyBytes: args["max-body-bytes"] ?? args.maxBodyBytes,
      })
      console.log(JSON.stringify({
        schema: server.schema,
        url: server.url,
        token: server.token,
        projectPath: args.project ?? DEFAULT_PROJECT_PATH,
      }, null, 2))
      await new Promise(() => {})
      return
    }
    throw new Error("Unknown hypothesis wechat-inbox command. Use append, import-raw, sources, process, status, or serve.")
  }
  if (subcommand === "create") {
    const result = await createHypothesis({
      projectPath: args.project,
      id: args.id,
      title: requireArg(args, "title"),
      theme: args.theme,
      segments: args.segments ?? args.segment,
      status: args.status,
      conviction: args.conviction,
      timeHorizon: args["time-horizon"] ?? args.timeHorizon,
      keyVariables: args["key-variables"] ?? args.keyVariables,
      triggerConditions: args["trigger-conditions"] ?? args.triggerConditions ?? args.triggers,
      invalidationSignals: args["invalidation-signals"] ?? args.invalidationSignals ?? args.falsifiableConditions,
      expectedEvidencePath: args["expected-evidence-path"] ?? args.expectedEvidencePath ?? args.evidencePath,
      evidenceRefs: args["evidence-refs"] ?? args.evidenceRefs,
      marketRefs: args["market-refs"] ?? args.marketRefs,
      risks: args.risks,
      relatedWikiPages: args["related-wiki-pages"] ?? args.relatedWikiPages ?? args.wikiRefs,
      nextValidationDate: args["next-validation-date"] ?? args.nextValidationDate,
      write: Boolean(args.write),
    })
    console.log(JSON.stringify(result, null, 2))
    return
  }
  if (subcommand === "observation-drafts" || (subcommand === "observation-draft" && inboxCommand === "list")) {
    const result = await listObservationDrafts({
      projectPath: args.project,
      date: args.date,
      limit: args.limit,
    })
    console.log(JSON.stringify(result, null, 2))
    return
  }
  if (subcommand === "observation-draft") {
    const result = await createObservationDraft({
      projectPath: args.project,
      title: requireArg(args, "title"),
      hypothesisId: args["hypothesis-id"] ?? args.hypothesisId,
      stocks: args.stocks ?? args.stock,
      ranking: args.ranking,
      gap: args.gap,
      nextAction: args["next-action"] ?? args.nextAction,
      wikiFrameLabel: args["wiki-frame-label"] ?? args.wikiFrameLabel,
      wikiFrameSourceRef: args["wiki-frame-source-ref"] ?? args.wikiFrameSourceRef,
      wikiFrameMetaLine: args["wiki-frame-meta-line"] ?? args.wikiFrameMetaLine,
      sourceRefs: args["source-refs"] ?? args.sourceRefs,
      askQuery: args["ask-query"] ?? args.askQuery,
      copyText: args["copy-text"] ?? args.copyText,
      write: Boolean(args.write),
    })
    console.log(JSON.stringify(result, null, 2))
    return
  }
  if (subcommand === "list") {
    const result = await listHypotheses({
      projectPath: args.project,
      status: args.status,
      theme: args.theme,
      segment: args.segment,
    })
    console.log(JSON.stringify(result, null, 2))
    return
  }
  if (subcommand === "quality-check" || subcommand === "quality") {
    const result = await qualityCheckHypotheses({
      projectPath: args.project,
      id: args.id,
      status: args.status,
      theme: args.theme,
      segment: args.segment,
      limit: args.limit,
    })
    console.log(JSON.stringify(result, null, 2))
    return
  }
  if (subcommand === "evidence-feedback" || subcommand === "evidence-loop") {
    const result = await buildHypothesisEvidenceFeedback({
      projectPath: args.project,
      id: args.id ?? args["hypothesis-id"],
      status: args.status,
      theme: args.theme,
      segment: args.segment,
      limit: args.limit,
      generatedAt: args["generated-at"],
      write: Boolean(args.write),
    })
    console.log(JSON.stringify(result, null, 2))
    return
  }
  if (subcommand === "evidence-link-drafts" || subcommand === "evidence-link-plan") {
    const result = await draftHypothesisEvidenceLinks({
      projectPath: args.project,
      status: args.status,
      theme: args.theme,
      segment: args.segment,
      limit: args.limit,
      includeLinked: Boolean(args["include-linked"] ?? args.includeLinked),
      generatedAt: args["generated-at"],
      write: Boolean(args.write),
    })
    console.log(JSON.stringify(result, null, 2))
    return
  }
  if (subcommand === "evidence-link-review" || subcommand === "evidence-link-approve") {
    const result = await reviewHypothesisEvidenceLinkDraft({
      projectPath: args.project,
      id: args.id ?? args["draft-id"],
      hypothesisId: args["hypothesis-id"],
      candidateIndex: args["candidate-index"] ?? args.candidateIndex,
      reviewer: args.reviewer,
      note: args.note,
      confirmHumanGate: args["confirm-human-gate"] ?? args.confirmHumanGate,
      generatedAt: args["generated-at"],
      write: Boolean(args.write),
    })
    console.log(JSON.stringify(result, null, 2))
    return
  }
  if (subcommand === "evidence-task-drafts" || subcommand === "evidence-task-plan") {
    const result = await draftHypothesisEvidenceTasks({
      projectPath: args.project,
      id: args.id ?? args["hypothesis-id"],
      status: args.status,
      theme: args.theme,
      segment: args.segment,
      limit: args.limit,
      generatedAt: args["generated-at"],
      write: Boolean(args.write),
    })
    console.log(JSON.stringify(result, null, 2))
    return
  }
  if (subcommand === "evidence-task-draft-list" || subcommand === "evidence-task-drafts-list") {
    const result = await listHypothesisEvidenceTaskDrafts({
      projectPath: args.project,
      id: args.id ?? args["draft-id"],
      hypothesisId: args["hypothesis-id"],
      status: args.status,
      taskType: args["task-type"] ?? args.type,
      readiness: args.readiness,
      stockIdentityGate: args.gate ?? args["stock-identity-gate"] ?? args.stockIdentityGate,
      candidateLimit: args["candidate-limit"] ?? args.candidateLimit,
      includeStockCandidates: args["include-stock-candidates"] !== "false",
      latestOnly: !Boolean(args["all-batches"] ?? args.allBatches),
      limit: args.limit,
    })
    console.log(JSON.stringify(result, null, 2))
    return
  }
  if (subcommand === "evidence-task-draft-review" || subcommand === "evidence-task-draft-promote") {
    const result = await reviewHypothesisEvidenceTaskDraft({
      projectPath: args.project,
      id: args.id ?? args["draft-id"],
      hypothesisId: args["hypothesis-id"],
      action: args.action,
      stockCode: args["stock-code"],
      stockName: args["stock-name"],
      candidateIndex: args["candidate-index"] ?? args["use-candidate"] ?? args.candidateIndex ?? args.useCandidate,
      taskType: args["task-type"] ?? args.type,
      targetFields: args["target-fields"] ?? args.fields,
      preferredSources: args["preferred-sources"] ?? args.sources,
      priority: args.priority,
      notes: args.notes ?? args.note,
      sourceRefs: args["source-refs"] ?? args["source-ref"],
      generatedAt: args["generated-at"],
      confirmHumanGate: args["confirm-human-gate"] ?? args.confirmHumanGate,
      confirmLowConfidenceCandidate: args["confirm-low-confidence-candidate"] ?? args.confirmLowConfidenceCandidate,
      latestOnly: !Boolean(args["all-batches"] ?? args.allBatches),
      write: Boolean(args.write),
    })
    console.log(JSON.stringify(result, null, 2))
    return
  }
  if (subcommand === "post-mortem" || subcommand === "postmortem") {
    const result = await draftHypothesisPostMortems({
      projectPath: args.project,
      id: args.id ?? args["hypothesis-id"],
      status: args.status,
      theme: args.theme,
      segment: args.segment,
      limit: args.limit,
      generatedAt: args["generated-at"],
      write: Boolean(args.write),
    })
    console.log(JSON.stringify(result, null, 2))
    return
  }
  if (subcommand === "verify") {
    const result = await verifyHypothesisEngineArtifacts({
      projectPath: args.project,
    })
    console.log(JSON.stringify(result, null, 2))
    return
  }
  if (subcommand === "discover") {
    const result = await discoverHypotheses({
      projectPath: args.project,
      theme: args.theme,
      questionCount: args["question-count"] ?? args.questionCount,
      concurrency: args.concurrency,
      sources: args.sources,
      since: args.since,
      sourceLimit: args["source-limit"] ?? args.sourceLimit,
      candidateLimit: args["candidate-limit"] ?? args.candidateLimit,
      perLaneHypotheses: args["per-lane-hypotheses"] ?? args.perLaneHypotheses,
      financeEntityAuditRoots: args["finance-entity-audit-roots"] ?? args.financeEntityAuditRoots,
      provider: args.provider ?? "openai",
      model: args.model,
      apiKey: args["api-key"] ?? args.apiKey,
      endpoint: args.endpoint,
      requestAgentText: args.requestAgentText,
      timeoutMs: args["timeout-ms"] ?? args.timeoutMs,
    })
    console.log(JSON.stringify(result, null, 2))
    return
  }
  if (subcommand === "status-update") {
    const result = await updateHypothesisStatus({
      projectPath: args.project,
      id: requireArg(args, "id"),
      status: requireArg(args, "status"),
      reason: args.reason,
      eventRef: args["event-ref"] ?? args.eventRef,
      askRunRef: args["ask-run-ref"] ?? args.askRunRef,
      write: Boolean(args.write),
    })
    console.log(JSON.stringify(result, null, 2))
    return
  }
  if (subcommand === "ask") {
    const id = requireArg(args, "id")
    const listed = await listHypotheses({ projectPath: args.project })
    const hypothesis = listed.hypotheses.find((item) => item.id === id)
    if (!hypothesis) throw new Error(`Unknown hypothesis id: ${id}`)
    const query = args.query || [
      `围绕假设「${hypothesis.title}」做多源检索深挖。`,
      "请输出关联股票、受益链条/利好排序、原有六段回答、证据来源、市场反馈和证据缺口。",
      `主题：${hypothesis.theme || "n/a"}`,
      `细分：${(hypothesis.segments ?? []).join(", ") || "n/a"}`,
    ].join("\n")
    const performanceProfile = resolveCliPerformanceProfile(args)
    const askResult = await askWiki({
      query,
      projectPath: args.project,
      provider: args.provider ?? "openai",
      model: args.model,
      apiKey: args["api-key"],
      endpoint: args.endpoint,
      reasoningEffort: args["reasoning-effort"],
      codexBin: args["codex-bin"],
      codexProfile: args["codex-profile"],
      codexProfileV2: args["codex-profile-v2"],
      codexTimeoutMs: args["codex-timeout-ms"],
      topWiki: args["top-wiki"],
      topRaw: args["top-raw"],
      graphNeighbors: args["graph-neighbors"],
      graphDepth: args["graph-depth"],
      topFacts: args["top-facts"],
      topBrain: args["top-brain"],
      includeInvalidated: Boolean(args["include-invalidated"]),
      sourceK: args["source-k"],
      sources: args.sources,
      useLlmSourceRouting: false,
      sqlLimit: args["sql-limit"],
      agentic: true,
      agentConcurrency: args["agent-concurrency"] ?? performanceProfile.defaults.agentConcurrency,
      agentTimeoutMs: args["agent-timeout-ms"] ?? performanceProfile.defaults.agentTimeoutMs,
      agentArtifacts: !Boolean(args["no-agent-artifacts"]),
      requestAgentText: args.requestAgentText,
    })
    const compact = buildCompactAskContext(askResult)
    console.log(JSON.stringify({
      schema: "trading-hypothesis-ask-run-v1",
      mode: "hypothesis-ask",
      projectPath: args.project ?? DEFAULT_PROJECT_PATH,
      hypothesis,
      query,
      answer: askResult.answer,
      sources: {
        navigation: askResult.navigation.map(({ ref, path, title, score, snippet }) => ({ ref, path, title, score, snippet })),
        wiki: askResult.wikiResults.map(({
          ref,
          path,
          title,
          score,
          type,
          frontmatterMatches,
          frontmatterSources,
          frontmatterRelated,
          frontmatterTags,
          frontmatterUpdated,
          frontmatterUpdatedField,
          staleDays,
          freshnessScore,
          snippet,
        }) => ({
          ref,
          path,
          title,
          score,
          type,
          frontmatterMatches,
          frontmatterSources,
          frontmatterRelated,
          frontmatterTags,
          frontmatterUpdated,
          frontmatterUpdatedField,
          staleDays,
          freshnessScore,
          snippet,
        })),
        raw: askResult.rawResults.map(({ ref, path, title, score, snippet }) => ({ ref, path, title, score, snippet })),
        facts: askResult.factsResults.map(({ ref, path, title, score, excerpt }) => ({ ref, path, title, score, excerpt })),
        brain: askResult.brainResults.map(({ ref, path, title, score, excerpt }) => ({ ref, path, title, score, excerpt })),
        stockDaily: askResult.stockDailyResults.map(({ ref, path, title, score, excerpt }) => ({ ref, path, title, score, excerpt })),
      },
      marketValidation: askResult.marketValidation,
      stockDaily: askResult.stockDaily,
      context: compact,
      writePolicy: {
        readOnly: true,
        wroteWiki: false,
        wroteRaw: false,
        wroteRealTrade: false,
      },
    }, null, 2))
    return
  }
  if (subcommand === "report") {
    const result = await buildHypothesisReport({
      projectPath: args.project,
      id: requireArg(args, "id"),
      write: Boolean(args.write),
    })
    if (args.write || args.json) {
      console.log(JSON.stringify(result, null, 2))
      return
    }
    console.log(result.markdown.trim())
    return
  }
  if (subcommand === "supplement") {
    const result = await submitHypothesisSupplement({
      projectPath: args.project,
      title: requireArg(args, "title"),
      body: requireArg(args, "body"),
      kind: args.kind,
      sourceRefs: args["source-refs"] ?? args.sourceRefs,
      hypothesisId: args["hypothesis-id"] ?? args.hypothesisId,
      write: Boolean(args.write),
    })
    console.log(JSON.stringify(result, null, 2))
    return
  }
  if (subcommand === "supplement-draft") {
    const result = await draftHypothesisSupplement({
      projectPath: args.project,
      body: requireArg(args, "body"),
      sourceRefs: args["source-refs"] ?? args.sourceRefs,
      hypothesisId: args["hypothesis-id"] ?? args.hypothesisId,
      selectedSources: args["selected-sources"] ?? args.selectedSources,
      provider: args.provider ?? "codex",
      model: args.model,
      apiKey: args["api-key"] ?? args.apiKey,
      endpoint: args.endpoint,
      timeoutMs: args["timeout-ms"] ?? args.timeoutMs,
      imaTimeoutMs: args["ima-timeout-ms"] ?? args.imaTimeoutMs,
      imaMaxKnowledgeBases: args["ima-max-knowledge-bases"] ?? args.imaMaxKnowledgeBases,
      imaMaxHits: args["ima-max-hits"] ?? args.imaMaxHits,
      imaMaxQueries: args["ima-max-queries"] ?? args.imaMaxQueries,
    })
    console.log(JSON.stringify(result, null, 2))
    return
  }
  if (subcommand === "update-from-article") {
    const result = await updateHypothesisFromArticle({
      projectPath: args.project,
      sourcePath: requireArg(args, "source"),
      summary: args.summary,
      financeEntityAuditRoots: args["finance-entity-audit-roots"] ?? args.financeEntityAuditRoots,
      write: Boolean(args.write),
    })
    console.log(JSON.stringify(result, null, 2))
    return
  }
  if (subcommand === "validate") {
    const result = await validateHypothesis({
      projectPath: args.project,
      id: requireArg(args, "id"),
      window: args.window,
    })
    console.log(JSON.stringify(result, null, 2))
    return
  }
  if (subcommand === "watch") {
    const result = await runHypothesisWatch({
      projectPath: args.project,
      hypothesisId: args["hypothesis-id"] ?? args.hypothesisId,
      since: args.since,
      sources: args.sources,
      source: args.source,
      limit: args.limit,
      llmReview: args["llm-review"] ?? args.llmReview,
      llmReviewMaxItems: args["llm-review-max-items"] ?? args.llmReviewMaxItems,
      llmReviewTimeoutMs: args["llm-review-timeout-ms"] ?? args.llmReviewTimeoutMs,
      financeEntityAuditRoots: args["finance-entity-audit-roots"] ?? args.financeEntityAuditRoots,
      provider: args.provider ?? "codex",
      model: args.model,
      apiKey: args["api-key"] ?? args.apiKey,
      endpoint: args.endpoint,
      compact: Boolean(args.compact),
      write: Boolean(args.write),
    })
    console.log(JSON.stringify(result, null, 2))
    return
  }
  if (subcommand === "alerts") {
    const result = await listHypothesisAlerts({
      projectPath: args.project,
      status: args.status,
      minAlertLevel: args["min-alert-level"] ?? args.minAlertLevel,
      limit: args.limit,
    })
    console.log(JSON.stringify(result, null, 2))
    return
  }
  if (subcommand === "dashboard-data") {
    const result = await buildHypothesisDashboardData({
      projectPath: args.project,
      write: Boolean(args.write),
    })
    if (args.write || args.json) {
      console.log(JSON.stringify(result, null, 2))
      return
    }
    console.log(result.markdown.trim())
    return
  }
  throw new Error("Unknown hypothesis command. Use hypothesis create, list, quality-check, evidence-feedback, post-mortem, verify, discover, status-update, ask, report, supplement, supplement-draft, update-from-article, validate, watch, alerts, dashboard-data, or wechat-inbox.")
}

function buildCompactAskContext(result) {
  return {
    query: result.query,
    projectPath: result.projectPath,
    generatedAt: result.generatedAt,
    retrievalMode: result.retrievalMode,
    tokens: result.tokens,
    counts: result.counts,
    contextMetrics: result.contextMetrics,
    sourceRouting: {
      mode: result.sourceRouting.route.mode,
      sourceK: result.sourceRouting.route.sourceK,
      selectedSources: result.sourceRouting.selectedSources.map(({ id, label, kind, nativeLanguage, available, ruleScore, routeReason, unavailableReason, config, columns }) => ({
        id,
        label,
        kind,
        nativeLanguage,
        available,
        ruleScore,
        routeReason,
        unavailableReason,
        config,
        columns: columns
          ? {
              ticker: columns.ticker,
              date: columns.date,
              open: columns.open,
              high: columns.high,
              low: columns.low,
              close: columns.close,
              volume: columns.volume,
              amount: columns.amount,
              pctChange: columns.pctChange,
            }
          : undefined,
      })),
      rules: result.sourceRouting.route.rules,
      llmRanking: result.sourceRouting.route.llmRanking,
      warnings: result.sourceRouting.route.warnings,
    },
    nativeQueries: result.nativeQueries,
    retrievalWarnings: result.retrievalWarnings,
  }
}

function attachFullAskContext(compact, result) {
  Object.assign(compact, {
    answer: result.answer ?? null,
    navigation: result.navigation.map(({ ref, path, title, score, snippet }) => ({ ref, path, title, score, snippet })),
    wikiResults: result.wikiResults.map(({ ref, path, title, score, type, frontmatterMatches, frontmatterUpdated, frontmatterUpdatedField, staleDays, freshnessScore, snippet }) => ({
      ref,
      path,
      title,
      score,
      type,
      frontmatterMatches,
      frontmatterUpdated,
      frontmatterUpdatedField,
      staleDays,
      freshnessScore,
      snippet,
    })),
    rawResults: result.rawResults.map(({ ref, path, title, score, structuredSourceMatch, frontmatterUpdated, frontmatterUpdatedField, staleDays, freshnessScore, snippet }) => ({
      ref,
      path,
      title,
      score,
      structuredSourceMatch,
      frontmatterUpdated,
      frontmatterUpdatedField,
      staleDays,
      freshnessScore,
      snippet,
    })),
    graphExpansions: result.graphExpansions.map(({ ref, path, title, score, graphScore, type, hop, pathTrace, relationType, reasons, from, snippet }) => ({
      ref,
      path,
      title,
      score,
      graphScore,
      type,
      hop,
      pathTrace,
      relationType,
      reasons,
      from,
      snippet,
    })),
    factsResults: result.factsResults.map(({ ref, path, title, score, type, excerpt, nativeQuery }) => ({ ref, path, title, score, type, excerpt, nativeQuery })),
    invalidatedFactsResults: result.invalidatedFactsResults.map(({ ref, path, title, score, type, temporalStatus, statusReason, excerpt, nativeQuery }) => ({
      ref,
      path,
      title,
      score,
      type,
      temporalStatus,
      statusReason,
      excerpt,
      nativeQuery,
    })),
    brainResults: result.brainResults.map(({ ref, path, title, score, type, excerpt, nativeQuery }) => ({ ref, path, title, score, type, excerpt, nativeQuery })),
    stockDaily: {
      status: result.stockDaily.status,
      intent: result.stockDaily.intent,
      warning: result.stockDaily.warning,
      nativeQuery: result.stockDaily.nativeQuery
        ? {
            language: result.stockDaily.nativeQuery.language,
            summary: result.stockDaily.nativeQuery.summary,
            table: result.stockDaily.nativeQuery.table,
            limit: result.stockDaily.nativeQuery.limit,
            tickerCandidates: result.stockDaily.nativeQuery.tickerCandidates,
          }
        : null,
    },
    marketValidation: result.marketValidation,
    stockDailyResults: result.stockDailyResults.map(({ ref, path, title, score, type, excerpt, nativeQuery }) => ({ ref, path, title, score, type, excerpt, nativeQuery })),
  })
  return compact
}

async function handleAsk(args) {
  if (args._[1] === "eval") {
    const result = await runAskEval({
      query: args.query,
      projectPath: args.project,
      sources: args.sources,
      topWiki: args["top-wiki"],
      topRaw: args["top-raw"],
      graphNeighbors: args["graph-neighbors"],
      graphDepth: args["graph-depth"],
      topFacts: args["top-facts"],
      topBrain: args["top-brain"],
      includeInvalidated: Boolean(args["include-invalidated"]),
      sourceK: args["source-k"],
      sqlLimit: args["sql-limit"],
      expectedPaths: args["expect-paths"] ?? args.expect,
      write: Boolean(args.write),
    })
    console.log(JSON.stringify(result, null, 2))
    return
  }
  const performanceProfile = resolveCliPerformanceProfile(args)
  const result = await askWiki({
    query: requireArg(args, "query"),
    projectPath: args.project,
    provider: args.provider ?? "codex",
    model: args.model,
    apiKey: args["api-key"],
    endpoint: args.endpoint,
    reasoningEffort: args["reasoning-effort"],
    codexBin: args["codex-bin"],
    codexProfile: args["codex-profile"],
    codexProfileV2: args["codex-profile-v2"],
    codexTimeoutMs: args["codex-timeout-ms"],
    topWiki: args["top-wiki"],
    topRaw: args["top-raw"],
    graphNeighbors: args["graph-neighbors"],
    graphDepth: args["graph-depth"],
    topFacts: args["top-facts"],
    topBrain: args["top-brain"],
    includeInvalidated: Boolean(args["include-invalidated"]),
    sourceK: args["source-k"],
    sources: args.sources,
    sqlLimit: args["sql-limit"],
    showContext: Boolean(args["show-context"] || args["show-sources"]),
    agentic: Boolean(args.agentic),
    agentConcurrency: args["agent-concurrency"] ?? performanceProfile.defaults.agentConcurrency,
    agentTimeoutMs: args["agent-timeout-ms"] ?? performanceProfile.defaults.agentTimeoutMs,
    agentArtifacts: !Boolean(args["no-agent-artifacts"]),
  })
  if (args["show-context"] || args["show-sources"]) {
    const compact = buildCompactAskContext(result)
    if (args["show-sources"] && !args["show-context"]) {
      console.log(JSON.stringify(compact, null, 2))
      return
    }
    console.log(JSON.stringify(attachFullAskContext(compact, result), null, 2))
    return
  }
  console.log(result.answer.trim())
}

export const COMMAND_HANDLERS = Object.freeze({
  "api-run": handleApiRun,
  "apply": handleApply,
  "ask": handleAsk,
  "autoresearch": handleAutoresearch,
  "batch-run": handleBatchRun,
  "brain": handleBrain,
  "company-research": handleCompanyResearch,
  "concepts": handleConcepts,
  "convert-source": handleConvertSource,
  "daily-loop": handleDailyLoop,
  "data-source": handleDataSource,
  "deep-research": handleDeepResearch,
  "embeddings": handleEmbeddings,
  "export-samples": handleExportSamples,
  "finalize": handleFinalize,
  "hygiene": handleHygiene,
  "hypothesis": handleHypothesis,
  "ima-sync": handleImaSync,
  "market-validate": handleMarketValidate,
  "prepare": handlePrepare,
  "research-os": handleResearchOs,
  "sag-sync": handleSagSync,
  "self-question": handleSelfQuestion,
  "self-train": handleSelfTrain,
  "stock-feedback": handleStockFeedback,
  "temporal-facts": handleTemporalFacts,
})

export async function runCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv)
  const command = args._[0]
  if (!command || args.help || command === "help") {
    printHelp()
    return
  }

  const handler = COMMAND_HANDLERS[command]
  if (!handler) throw new Error(`Unknown command: ${command}`)
  await handler(args)
}
