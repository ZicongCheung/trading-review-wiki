# Research OS v0.16.1 主链闭环整合更新报告

生成日期：2026-06-21
工作分支：`codex/research-os-agent-v016`
目标版本：`0.16.1`
目标主链：`main`

## 1. 版本定位

v0.16.1 是 v0.13 到 v0.16 的主链整合交接版本，目标不是新增一个交易机器人，而是把 Trading Review Wiki 的训练飞轮推进为可审计的 Research OS 核心闭环。

当前已形成的主链路：

```text
self-question / hypothesis / raw review / real execution / paper trade
-> EvidenceTask
-> EvidenceResult
-> stock-feedback trajectory
-> review 升权/降权
-> Benchmark
-> LoRA-ready manifest
```

本版本仍保持边界：

- 默认 dry-run。
- 写入限制在 `.llm-wiki/**` 和既有训练导出路径。
- 不自动写正式 `wiki/**`。
- 不修改旧 `raw/**`。
- 不触发真实交易。
- 不把 API token 写入代码、日志、manifest 或文档。
- LoRA-ready 不保存原始事实、公告正文、价格行或交割单行，只保存行为、技能、工具习惯和决策策略。

## 2. 已完成闭环

### 2.1 Evidence Runner 闭环

已完成：

- `stock-feedback evidence-task create/list/show`
- `stock-feedback run-task-queue`
- `stock-feedback evidence-result list/review`
- `stock-feedback source-status`
- `stock-feedback dlq list/retry/discard`
- `stock-feedback verify` 校验 evidence task/result/run/DLQ schema、写入边界、source refs 和 raw fact 泄漏。

新增证据质量门：

- fieldCompleteness
- valueValidity
- timeliness
- formatConsistency
- sourceReliability
- crossValidation
- overallConfidence
- HumanGate

已接入数据源：

- Tushare：行情、财务指标等任务可通过 Keychain / env / CLI token 读取，输出不泄漏密钥。
- Tavily/Web：作为 Web sourceRef 发现器，用于补证线索，不直接替代硬证据。

### 2.2 Tavily/Web 补证质量优化

v0.16.1 新增 Web source quality 分级：

- `official_primary`：`cninfo.com.cn`、`sse.com.cn`、`szse.cn`、`static.sse.com.cn`、`static.szse.cn` 等官方公告/交易所源。
- `secondary_media`：证券时报、中证网、上海证券报等媒体源。
- `secondary_portal`：新浪、东方财富、搜狐、同花顺等门户源。
- `web_lead`：未知来源，仅作为线索。

新增质量标记：

- `official_source`
- `secondary_media`
- `secondary_portal`
- `unverified_web_source`
- `text_quality_warning`

新增字段级命中门：

- 不再把 Tavily top snippet 盲目填充到所有 target fields。
- `order/customer/shipment/revenue/annual_report/announcement` 必须分别命中文本关键词，才计入 field completeness。
- 年报摘要只能证明 `annual_report/announcement`，不能自动证明订单、客户、出货或收入兑现。

真实试跑结果：

- `ET-20260621-67b30079`
- `stockfb_evidence_run_b8e82d791cfe5f9c`
- `stockfb_evidence_result_41b35e209b2df856`
- 结果进入 `awaiting_review`，不是 `auto_ready`。
- `fieldCompleteness=33.33`
- matched fields：`customer`、`revenue`
- missing fields：`order`、`shipment`、`annual_report`、`announcement`

### 2.3 Hypothesis Engine 闭环

已完成：

- `hypothesis evidence-feedback`
- Hypothesis Quality Gate
- `falsifiableConditions`
- `coreDrivers`
- `marketMispricing`
- `sourceRefs`
- Evidence direction：`strengthening / weakening / neutral`
- Evidence Score：sourceReliability、sampleSize、timeliness、directRelevance、verifiability、total
- Watchtower candidate 只推荐，不自动改正式状态。
- HumanGate 状态迁移推荐。
- post-mortem draft。
- Cockpit 假设详情升级。

当前真实项目状态：

- hypothesis records：15
- evidenceFeedback：0
- postMortems：0

能力已落地，但真实项目还需要继续跑 Hypothesis feedback 样本。

### 2.4 Paper Trade Agent 闭环

已完成：

- Paper Trade Agent candidate。
- 从 trajectory / hypothesis evidence-feedback 生成候选。
- `rule_baseline` 与 `llm_discretionary` 双轨。
- `asOfDate` 截断，声明 `evidenceCutoff.noFutureData=true`。
- entryPlan / exitPlan / positionSizing / invalidationCondition / expectedCatalyst。
- Tushare / price evidence request。
- paper trade record / settle。
- Benchmark 增加 paper-trade-agent cases。
- LoRA-ready 增加 paperTradeAgentCurriculum。

当前真实项目状态：

- paperTrades：1
- paperTradeClosed：1
- paperTradeProfitable：1
- paperTradePlanCandidates：6
- paperTradeAgentCandidates：8
- paperTradeAgentWrittenCandidates：0

未闭合点：Agent candidates 还没有正式 `--write` 入库。

### 2.5 真实交易 execution-result 闭环

已完成：

```text
raw/交割单
+ raw/日复盘
+ wiki/position-tracking.md
+ Tushare / market evidence
-> research-os-execution-result-v1
-> stock-feedback trajectory
-> review
-> Benchmark
-> LoRA-ready
```

新增 schema 与文档：

- `research-os-execution-result-v1`
- `docs/ResearchOS-真实交易执行结果Schema-v1.md`
- `docs/schemas/research-os-execution-result-v1.schema.json`

新增能力：

- 交割单 importer。
- execution-result validate / list / review / verify。
- 三源交叉验证：交割单主证据、日复盘动机归因、position-tracking 汇总校验、Tushare 市场路径校验。
- `closed_position / partial_exit / holding_snapshot / account_daily` 分层。
- `confirm_realized_execution / mark_partial_exit / mark_holding_snapshot_only / mark_needs_reconciliation / reject_execution_result` 人审动作。
- `build-trajectories` 读取 reviewed/confirmed execution-result。
- 真实交易样本与 paper trade 样本在 Benchmark / LoRA-ready 中分来源、分权重。

当前真实项目状态：

- executionResults：22
- realTradeExecutionResults：10
- executionResultsConfirmed：5
- realTradeProfitable：3
- realTradeConfirmedProfitable：2
- executionResultsNeedsReconciliation：17

已确认正向真实收益样本包括紫光国微等真实 execution result；中国电信等负向样本进入 eval / preference / negative 路线；供销大集等半仓/分批样本默认保守进入 reconciliation。

### 2.6 Review / Benchmark / LoRA-ready 闭环

已完成：

- review queue 可按 trajectory action 升权/降权。
- 高价值样本已进行一轮半自动 review。
- `stock-feedback bench --write` 生成 Benchmark manifest。
- `stock-feedback export-lora-ready --write` 生成 LoRA-ready manifest。
- LoRA-ready 校验 PEFT 边界：
  - 不存 raw facts。
  - 不存价格行。
  - 不存交割单行。
  - paper trade 不冒充真实收益。
  - paper adapter candidate 默认低权重。
  - real execution profitable 样本和 paper profitable 样本分 bucket。

当前真实项目状态：

- trajectories：73
- trainable：29
- Benchmark cases：435
- LoRA-ready candidates：268
- reviewEvents：33
- reviewedTrajectories：31
- pendingReviews：42
- pricedInRisk：1
- fundamentalValidated：1
- pattern_execution_supported：4
- failed_expectation_negative：24
- execution_risk_negative：5

### 2.7 Research OS Agent 编排闭环

已完成：

- `research-os agent status`
- `research-os agent plan`
- `research-os agent review`
- `research-os agent step`
- `research-os agent verify`

Codex 在聊天窗口扮演 `SupervisorAgent`，项目 CLI 负责：

- context schema
- fixed action map
- HumanGate
- write boundary
- artifact manifest
- verify

artifact 写入路径：

- `.llm-wiki/research-os/agent-runs/**`

命令链路：

```text
status -> plan -> review -> step dry-run -> HumanGate -> step --write -> verify
```

## 3. 当前实测状态

时间：2026-06-21 23:50 左右
项目：`/Users/jiegege/Desktop/杰杰杰`

### 3.1 stock-feedback status 摘要

- trajectories：73
- persistedTrajectories：73
- pendingEvidence：43
- trainable：29
- pricedInRisk：1
- failedSamples：24
- pendingReviews：42
- reviewedTrajectories：31
- reviewEvents：33
- collectionResults：4
- confirmedCollectionResults：2
- executionResults：22
- executionResultsConfirmed：5
- executionResultsNeedsReconciliation：17
- realTradeExecutionResults：10
- realTradeProfitable：3
- realTradeConfirmedProfitable：2
- paperTrades：1
- paperTradeClosed：1
- paperTradeProfitable：1
- paperTradeAgentCandidates：8
- paperTradeAgentWrittenCandidates：0
- evidenceTasks：8
- evidenceResults：8
- evidenceDlq：0
- benchmarkBatches：7
- loraReadyBatches：12

### 3.2 source status 摘要

- Tushare：5 total / 5 ok / 0 failed / successRate 100% / circuit closed
- CNINFO：5 total / 0 ok / 5 failed / successRate 0% / circuit open
- Web/Tavily：8 total / 3 ok / 5 failed / successRate 37.5% / circuit closed

### 3.3 最新 artifact

- trajectory：`.llm-wiki/stock-feedback/trajectories/stock-feedback-trajectories-20260621224748.jsonl`
- Benchmark manifest：`.llm-wiki/stock-feedback/benchmark/stock-validation-benchmark-20260621224759.manifest.json`
- LoRA-ready manifest：`.llm-wiki/stock-feedback/exports/lora-ready-20260621224759.manifest.json`

## 4. 未闭合项

### P0：主链合并前必须知道但不阻塞合并

- `pendingReviews=42`：仍有样本需要继续 review。
- `executionResultsNeedsReconciliation=17`：真实交易中还有半仓、快照、汇总冲突或未闭合生命周期需要复核。
- `paperTradeAgentWrittenCandidates=0`：Paper Trade Agent 候选已可生成，但尚未写入正式候选 artifact。
- `hypothesis evidenceFeedback=0`：Hypothesis Engine 能力已落地，但真实项目还没沉淀正式 evidence-feedback 样本。
- CNINFO adapter 当前为 unavailable/open；Web/Tavily 可做线索，但不能替代 CNINFO/交易所公告硬源。

### P1：后续样本质量建设

- 继续处理 review queue，优先处理真实收益、真实亏损、priced-in、fundamental_closure 和高质量 disconfirmed 样本。
- 对 `needs_reconciliation` execution-results 做人工确认或拆分生命周期。
- 把 `stock-feedback paper-trade-agent candidates --write` 接入下一轮 HumanGate。
- 补 Hypothesis evidence-feedback，把 EvidenceResult 回流 hypothesis lifecycle。
- 对 fundamental_closure 样本优先补官方公告、年报、订单、ASP、毛利率或客户验证。

### P2：外部数据源

- CNINFO / 交易所公告硬源仍需补稳定 adapter。
- QCC / 招投标 / 订单合同类数据源仍建议接入。
- Tavily/Web 保留为 sourceRef discovery，不作为唯一硬证据。

### P3：UI 后续

- v0.16 agent 是 CLI/artifact first；多 Agent 可视化操作台留到 v0.17。
- Paper Trade Agent 队列和 execution-result review 可以继续增强 UI，但不影响当前后端闭环。

## 5. 主链更新范围

建议主链保留：

- `CHANGELOG.md` 中 v0.16.1 整合条目。
- 本报告：`docs/更新报告-2026-06-21-ResearchOS-v0.16.1-mainline-closed-loop.md`
- 合并准备说明：`docs/发布说明-v0.16.1-main合并准备.md`
- `docs/ResearchOS-真实交易执行结果Schema-v1.md`
- `docs/schemas/research-os-execution-result-v1.schema.json`
- 相关 CLI / test / schema / verify 实现。

不建议主链保留运行期 artifact：

- `.llm-wiki/**` 当前试跑产物。
- `dist/**` 构建输出。
- 本地 Keychain、API token、临时日志。

## 6. 验证包

本阶段已执行：

- `npx vitest run scripts/codex-ingest-stock-feedback-evidence-runner.test.mjs`：10 tests passed。
- `npm --silent run codex:ingest -- stock-feedback verify`：status ok，issueCount 0，errorCount 0。
- `npm --silent run codex:ingest -- hypothesis verify`：status ok，issueCount 0，errorCount 0。
- `npm --silent run codex:ingest -- research-os agent verify`：status ok，downstream stockFeedback/hypothesis 均 ok。
- `npm run build`：通过；仅保留既有 Vite dynamic import / chunk warnings。
- `git diff --check`：通过。

合并 main 前建议再跑完整包：

```bash
npx vitest run scripts/codex-ingest-research-os-agent.test.mjs scripts/codex-ingest-stock-feedback-evidence-runner.test.mjs scripts/codex-ingest-stock-feedback-execution-result.test.mjs --testTimeout 60000
npm --silent run codex:ingest -- stock-feedback verify
npm --silent run codex:ingest -- hypothesis verify
npm --silent run codex:ingest -- research-os agent verify
npm run build
git diff --check
```

## 7. 合并建议

推荐通过 PR 或普通 merge 合并当前分支到 main，不直接在当前对话里推 main：

```bash
git switch main
git pull --ff-only origin main
git merge --no-ff codex/research-os-agent-v016
npm run build
npm --silent run codex:ingest -- stock-feedback verify
npm --silent run codex:ingest -- hypothesis verify
npm --silent run codex:ingest -- research-os agent verify
git push origin main
```

合并后继续 v0.17：

- 多 Agent 操作台 UI。
- CNINFO / 交易所公告硬源。
- execution-result reconciliation UI。
- Paper Trade Agent candidates 写入与 review UI。
