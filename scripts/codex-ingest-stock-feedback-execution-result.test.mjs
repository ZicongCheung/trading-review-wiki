import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  buildStockFeedbackBenchmark,
  buildStockFeedbackTrajectories,
  exportStockFeedbackLoraReady,
  getStockFeedbackStatus,
  importStockFeedbackExecutionResults,
  listStockFeedbackExecutionResults,
  reviewStockFeedbackExecutionResult,
  validateStockFeedbackExecutionResults,
  verifyStockFeedbackArtifacts,
  verifyStockFeedbackExecutionResults,
} from "./codex-ingest-lib.mjs"

let tmpRoot

async function write(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, content, "utf8")
}

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "stock-feedback-execution-result-"))
  await write(
    path.join(tmpRoot, "raw/交割单/2026-05-21-交割单.md"),
    `# 2026-05-21 交割单

| 成交时间 | 证券代码 | 证券名称 | 买卖方向 | 成交数量 | 成交价格 | 成交金额 | 手续费 | 印花税 | 过户费 |
|---|---|---|---|---:|---:|---:|---:|---:|---:|
| 09:45:01 | 601728 | 中国电信 | 买入 | 51900 | 6.60 | 342540 | 10 | 0 | 0 |
`,
  )
  await write(
    path.join(tmpRoot, "raw/交割单/2026-05-25-交割单.md"),
    `# 2026-05-25 交割单

| 成交时间 | 证券代码 | 证券名称 | 买卖方向 | 成交数量 | 成交价格 | 成交金额 | 手续费 | 印花税 | 过户费 |
|---|---|---|---|---:|---:|---:|---:|---:|---:|
| 10:01:15 | 601728 | 中国电信 | 卖出 | 51900 | 6.07 | 315033 | 10 | 315.03 | 0 |
| 10:30:00 | 002049 | 紫光国微 | 买入 | 3400 | 82.14 | 279276 | 10 | 0 | 0 |
| 13:20:00 | 000564 | 供销大集 | 买入 | 169800 | 1.80 | 305640 | 10 | 0 | 0 |
`,
  )
  await write(
    path.join(tmpRoot, "raw/交割单/2026-05-26-交割单.md"),
    `# 2026-05-26 交割单

| 成交时间 | 证券代码 | 证券名称 | 买卖方向 | 成交数量 | 成交价格 | 成交金额 | 手续费 | 印花税 | 过户费 |
|---|---|---|---|---:|---:|---:|---:|---:|---:|
| 09:40:00 | 002049 | 紫光国微 | 卖出 | 3400 | 84.46 | 287164 | 10 | 287.16 | 0 |
| 10:15:00 | 000564 | 供销大集 | 卖出 | 84900 | 1.86 | 157914 | 10 | 157.91 | 0 |
`,
  )
  await write(
    path.join(tmpRoot, "raw/交割单/2026-05-27-交割单.md"),
    `# 2026-05-27 交割单

| 成交时间 | 证券代码 | 证券名称 | 买卖方向 | 成交数量 | 成交价格 | 成交金额 | 手续费 | 印花税 | 过户费 |
|---|---|---|---|---:|---:|---:|---:|---:|---:|
| 09:55:00 | 000564 | 供销大集 | 卖出 | 84900 | 1.77 | 150273 | 10 | 150.27 | 0 |
`,
  )
  await write(
    path.join(tmpRoot, "wiki/position-tracking.md"),
    `# 持仓跟踪

## 当前持仓（2026-06-17）

| 股票 | 代码 | 数量 | 成本价 | 当前价 | 浮动盈亏 |
|---|---|---:|---:|---:|---:|
| 高乐股份 | 002348 | 24200 | 13.592 | 12.580 | -24479.94 |
| 中银证券 | 601696 | 37400 | 12.775 | 13.150 | 14020.21 |
`,
  )
})

afterEach(async () => {
  if (tmpRoot) await fs.rm(tmpRoot, { recursive: true, force: true })
})

describe("stock-feedback real execution-result loop", () => {
  it("keeps the documented schema parseable", async () => {
    const schemaPath = path.join(process.cwd(), "docs/schemas/research-os-execution-result-v1.schema.json")
    const schema = JSON.parse(await fs.readFile(schemaPath, "utf8"))

    expect(schema.properties.schema.const).toBe("research-os-execution-result-v1")
    expect(schema.properties.ledgerKind.enum).toContain("real_trade")
    expect(schema.properties.pnlScope.enum).toContain("holding_snapshot")
  })

  it("imports delivery-note fills in dry-run mode without writing artifacts", async () => {
    const result = await importStockFeedbackExecutionResults({
      projectPath: tmpRoot,
      fromDeliveryNotes: true,
      generatedAt: "2026-06-21 10:00:00",
    })

    expect(result.dryRun).toBe(true)
    expect(result.fillCount).toBe(7)
    expect(result.executionResults.map((item) => item.instrument.stockName)).toEqual(expect.arrayContaining([
      "紫光国微",
      "中国电信",
      "供销大集",
    ]))
    const ziguang = result.executionResults.find((item) => item.instrument.stockName === "紫光国微")
    const telecom = result.executionResults.find((item) => item.instrument.stockName === "中国电信")
    const partial = result.executionResults.find((item) => item.instrument.stockName === "供销大集" && item.pnlScope === "partial_exit")

    expect(ziguang).toMatchObject({
      ledgerKind: "real_trade",
      pnlScope: "closed_position",
      positionState: "closed",
      pnl: {
        realizedGrossPnlAbs: 7888,
        realizedPnlPct: expect.any(Number),
      },
      qualityGate: {
        status: "review_ready",
      },
    })
    expect(telecom.pnl.realizedGrossPnlAbs).toBe(-27507)
    expect(partial).toMatchObject({
      pnlScope: "partial_exit",
      positionState: "partial_exit",
      qualityGate: {
        status: "needs_reconciliation",
      },
      reconciliationPolicy: {
        conflictResolution: "split_position_lifecycle",
      },
    })
    await expect(fs.access(path.join(tmpRoot, ".llm-wiki/stock-feedback/execution-results"))).rejects.toThrow()
  })

  it("writes execution-results only under stock-feedback artifacts and verifies them", async () => {
    const result = await validateStockFeedbackExecutionResults({
      projectPath: tmpRoot,
      generatedAt: "2026-06-21 10:05:00",
      write: true,
    })

    expect(result.writeResult.executionResults.relativePath).toMatch(/^\.llm-wiki\/stock-feedback\/execution-results\//)
    expect(result.writePolicy).toMatchObject({
      wroteWiki: false,
      wroteRaw: false,
      wroteBrain: false,
      wroteRealTradeLedger: false,
      wroteArtifacts: true,
    })

    const listed = await listStockFeedbackExecutionResults({ projectPath: tmpRoot, limit: 20 })
    expect(listed.counts.realTrade).toBeGreaterThanOrEqual(4)
    expect(listed.counts.holdingSnapshot).toBe(2)
    expect(listed.executionResults.find((item) => item.instrument.stockName === "高乐股份")).toMatchObject({
      ledgerKind: "broker_snapshot",
      pnlScope: "holding_snapshot",
      qualityGate: {
        status: "needs_reconciliation",
      },
    })

    const verify = await verifyStockFeedbackExecutionResults({ projectPath: tmpRoot })
    expect(verify.status).toBe("ok")
  })

  it("summarizes reviewed reconciliation results as non-actionable in status", async () => {
    await write(
      path.join(tmpRoot, ".llm-wiki/stock-feedback/execution-results/stock-feedback-execution-results-20260621110000.jsonl"),
      [
        {
          schema: "research-os-execution-result-v1",
          artifactId: "execres_real_partial_fixture",
          generatedAt: "2026-06-21 11:00:00",
          asOfDate: "2026-05-26",
          ledgerKind: "real_trade",
          recordStatus: "reviewed",
          pnlScope: "partial_exit",
          positionState: "partial_exit",
          instrument: { stockCode: "000564", tsCode: "000564.SZ", stockName: "供销大集", assetClass: "a_share" },
          tradeWindow: { entryDate: "2026-05-25", exitDate: "2026-05-26", holdingDays: 1 },
          pnl: { currency: "CNY", realizedGrossPnlAbs: 1000, realizedPnlPct: 3.1, pnlQuality: "derived" },
          evidence: {
            sourceRefs: [
              { kind: "raw_delivery_note", ref: "raw/交割单/2026-05-26-交割单.md", role: "exit_fill", reliability: "high", valueQuality: "exact" },
            ],
          },
          qualityGate: {
            status: "needs_reconciliation",
            humanReviewRequired: true,
            blockers: ["partial_exit_lifecycle_not_closed"],
            passedRules: ["broker_delivery_note_present"],
            trainingWeight: "low",
          },
          trainingBoundary: { loraFactPolicy: "no_raw_facts", allowedDestinations: ["eval"], adapterCandidateWeight: "low" },
        },
        {
          schema: "research-os-execution-result-v1",
          artifactId: "execres_snapshot_fixture",
          generatedAt: "2026-06-21 11:00:01",
          asOfDate: "2026-05-26",
          ledgerKind: "broker_snapshot",
          recordStatus: "reviewed",
          pnlScope: "holding_snapshot",
          positionState: "open",
          instrument: { stockCode: "002348", tsCode: "002348.SZ", stockName: "高乐股份", assetClass: "a_share" },
          pnl: { currency: "CNY", floatingPnlAbs: -1200, pnlQuality: "needs_review" },
          evidence: {
            sourceRefs: [
              { kind: "wiki_position_tracking", ref: "wiki/position-tracking.md", role: "position_snapshot", reliability: "medium", valueQuality: "needs_review" },
            ],
          },
          qualityGate: {
            status: "needs_reconciliation",
            humanReviewRequired: true,
            blockers: ["holding_snapshot_not_realized_pnl"],
            passedRules: ["holding_snapshot_classified"],
            trainingWeight: "none",
          },
          trainingBoundary: { loraFactPolicy: "no_raw_facts", allowedDestinations: ["none"], adapterCandidateWeight: "none" },
        },
      ].map((record) => JSON.stringify(record)).join("\n") + "\n",
    )

    const status = await getStockFeedbackStatus({ projectPath: tmpRoot })
    expect(status.counts.executionResultsNeedsReconciliation).toBe(2)
    expect(status.counts.executionResultsActionableReviews).toBe(0)
    expect(status.executionResultLedger.reconciliationAudit).toMatchObject({
      status: "reviewed_non_actionable",
      counts: {
        total: 2,
        actionableReviews: 0,
        reviewedNonActionable: 2,
        reviewedPartialExit: 1,
        reviewedHoldingSnapshot: 1,
        trainingWeightLow: 1,
        trainingWeightNone: 1,
      },
      byBlocker: {
        partial_exit_lifecycle_not_closed: 1,
        holding_snapshot_not_realized_pnl: 1,
      },
    })
    expect(status.executionResultLedger.reconciliationAudit.samples.map((item) => item.nextAction)).toEqual(expect.arrayContaining([
      "keep_low_weight_until_full_lifecycle_closes",
      "exclude_from_realized_pnl_training",
    ]))
  })

  it("routes confirmed real executions into trajectories, benchmark, and LoRA-ready without treating snapshots as realized PnL", async () => {
    const imported = await validateStockFeedbackExecutionResults({
      projectPath: tmpRoot,
      generatedAt: "2026-06-21 10:10:00",
      write: true,
    })
    const ziguang = imported.executionResults.find((item) => item.instrument.stockName === "紫光国微")
    const telecom = imported.executionResults.find((item) => item.instrument.stockName === "中国电信")
    await reviewStockFeedbackExecutionResult({
      projectPath: tmpRoot,
      artifactId: ziguang.artifactId,
      action: "confirm_realized_execution",
      reviewer: "tester",
      generatedAt: "2026-06-21 10:11:00",
      write: true,
    })
    await reviewStockFeedbackExecutionResult({
      projectPath: tmpRoot,
      artifactId: telecom.artifactId,
      action: "confirm_realized_execution",
      reviewer: "tester",
      generatedAt: "2026-06-21 10:12:00",
      write: true,
    })

    const built = await buildStockFeedbackTrajectories({
      projectPath: tmpRoot,
      generatedAt: "2026-06-21 10:13:00",
      write: true,
    })
    const ziguangTrajectory = built.trajectories.find((item) => item.stock.name === "紫光国微")
    const telecomTrajectory = built.trajectories.find((item) => item.stock.name === "中国电信")
    const snapshotTrajectory = built.trajectories.find((item) => item.stock.name === "高乐股份")

    expect(ziguangTrajectory).toMatchObject({
      source: "stock-feedback-execution-result",
      qualityGate: {
        status: "expectation_validated",
        highConfidenceEligible: true,
      },
      profitFeedback: {
        outcome: "profitable",
        ledgerKind: "real_trade",
        executionEvidenceClass: "real_pattern_execution_supported",
      },
      routing: {
        adapterCandidate: true,
      },
    })
    expect(telecomTrajectory).toMatchObject({
      qualityGate: {
        status: "disconfirmed_validated",
      },
      profitFeedback: {
        outcome: "loss",
        executionEvidenceClass: "real_failed_expectation_negative",
      },
      routing: {
        preference: true,
      },
    })
    expect(snapshotTrajectory.qualityGate.status).toBe("needs_evidence")
    expect(snapshotTrajectory.routing.adapterCandidate).toBe(false)

    const benchmark = await buildStockFeedbackBenchmark({
      projectPath: tmpRoot,
      generatedAt: "2026-06-21 10:14:00",
      write: true,
    })
    expect(benchmark.manifest.sourceKindCounts["stock-feedback-execution-result"]).toBeGreaterThanOrEqual(2)
    expect(benchmark.cases.find((item) => item.executionResultId === ziguang.artifactId)).toMatchObject({
      sourceKind: "stock-feedback-execution-result",
      expected: {
        executionResultLedgerKind: "real_trade",
        executionResultPnlScope: "closed_position",
      },
    })

    const lora = await exportStockFeedbackLoraReady({
      projectPath: tmpRoot,
      generatedAt: "2026-06-21 10:15:00",
      write: true,
    })
    expect(lora.manifest.sourceKindCounts["stock-feedback-execution-result"]).toBeGreaterThanOrEqual(1)
    expect(lora.manifest.candidateRefs.find((item) => item.executionResultId === ziguang.artifactId)).toMatchObject({
      ledgerKind: "real_trade",
      executionResultPnlScope: "closed_position",
    })

    const verify = await verifyStockFeedbackArtifacts({ projectPath: tmpRoot })
    expect(verify.status).toBe("ok")
    expect(verify.checked.executionResults).toBeGreaterThanOrEqual(4)
  })
})
