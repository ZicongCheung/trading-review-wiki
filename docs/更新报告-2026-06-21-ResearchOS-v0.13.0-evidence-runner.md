# Research OS v0.13.0 Evidence Runner 更新报告

日期：2026-06-21

## 本阶段目标

把训练飞轮从“发现证据缺口”推进到“自动执行补证任务并回写 EvidenceResult”。本阶段是 v0.14 Hypothesis Engine 与 v0.15 Paper Trade Agent 的底座，不重做训练飞轮 V1/V2 的轨迹、review、Benchmark、LoRA-ready 和 paper trade ledger，只补证据执行闭环。

## 新增能力

- 新增 Evidence Runner artifact schema。
  - `stock-feedback-evidence-task-v1`
  - `stock-feedback-evidence-result-v1`
  - `stock-feedback-evidence-run-v1`
  - `stock-feedback-evidence-dlq-v1`

- 新增写入路径。
  - `.llm-wiki/stock-feedback/evidence-tasks/**`
  - `.llm-wiki/stock-feedback/evidence-results/**`
  - `.llm-wiki/stock-feedback/evidence-runs/**`
  - `.llm-wiki/stock-feedback/evidence-dlq/**`

- 新增轻量数据源适配层。
  - Tushare 优先。
  - 无 token、接口失败或数据不足时进入可审计 failure / DLQ。
  - CNINFO / QCC / Web 保留 fallback / mock 边界，不阻塞闭环。

- 新增 EvidenceResult 质量门。
  - `fieldCompleteness`
  - `valueValidity`
  - `timeliness`
  - `formatConsistency`
  - `sourceReliability`
  - `crossValidation`
  - `overallConfidence`

- 新增 HumanGate。
  - 高置信无冲突结果可进入 `auto_ready`。
  - 冲突、低置信或证据不足进入 `awaiting_review` / `failed` / `dlq`。
  - `approve / reject / needs_more_evidence` 通过显式 review action 写入。

- 新增 DLQ。
  - 失败任务进入 `.llm-wiki/stock-feedback/evidence-dlq/**`。
  - 支持 retry / discard，不丢审计记录。

- 新增 Hypothesis quality-check 薄切片。
  - 检查 `falsifiableConditions / coreDrivers / marketMispricing / sourceRefs`。
  - 只输出推荐和 EvidenceTask 草案。
  - 不自动改正式 hypothesis 状态。

## CLI

新增命令：

```bash
npm run codex:ingest -- stock-feedback evidence-task create --stock-code <code> --task-type market_data|financial_metrics|announcement|tenders|institutional_flow|limit_up_analysis|general --target-fields "field1,field2" [--write]
npm run codex:ingest -- stock-feedback evidence-task list [--status pending|awaiting_review|completed|failed|dlq]
npm run codex:ingest -- stock-feedback evidence-task show --task-id <id>
npm run codex:ingest -- stock-feedback run-task-queue [--task-id <id>] [--limit 10] [--write]
npm run codex:ingest -- stock-feedback evidence-result list [--status completed|awaiting_review|rejected|failed]
npm run codex:ingest -- stock-feedback evidence-result review --result-id <id> --action approve|reject|needs_more_evidence [--write]
npm run codex:ingest -- stock-feedback source-status
npm run codex:ingest -- stock-feedback dlq list [--status open|all]
npm run codex:ingest -- stock-feedback dlq retry --dlq-id <id>|--task-id <id> [--write]
npm run codex:ingest -- stock-feedback dlq discard --dlq-id <id>|--task-id <id> [--write]
npm run codex:ingest -- hypothesis quality-check [--id <hypothesis-id>]
```

默认 dry-run；只有 `--write` 写 `.llm-wiki/stock-feedback/**`。

## UI

训练飞轮页面新增 Evidence Queue 面板：

- pending / running / awaiting_review / completed / failed / DLQ 统计。
- source health。
- task / result / DLQ 列表。
- result review 操作。
- DLQ retry / discard 操作。
- 空态、loading、error、review 操作均在现有训练飞轮交互路径内呈现。

Tauri 只新增固定 allowlist action：

- `stock-feedback-evidence-task-create-dry-run`
- `stock-feedback-evidence-task-create-write`
- `stock-feedback-evidence-task-list`
- `stock-feedback-evidence-task-show`
- `stock-feedback-run-task-queue-dry-run`
- `stock-feedback-run-task-queue-write`
- `stock-feedback-evidence-result-list`
- `stock-feedback-evidence-result-review-write`
- `stock-feedback-source-status`
- `stock-feedback-dlq-list`
- `stock-feedback-dlq-retry-write`
- `stock-feedback-dlq-discard-write`

不开放任意命令。

## 写入边界

- 不写 `wiki/**`
- 不写 `raw/**`
- 不写 `data/brain/**`
- 不触发真实交易
- 不写真实 trade ledger
- 不把 API token 写入代码、日志、manifest 或文档
- `--write` 仅写 `.llm-wiki/stock-feedback/**`

## PEFT 边界

Evidence Runner 只产生可审计证据结果和引用，不训练模型，不把原始事实写入 LoRA-ready。事实留在 retrieval / tool state / sourceRefs / 外部数据源。

## 验收结果

本阶段当前分支已通过后续组合回归覆盖：

```bash
npx vitest run scripts/codex-ingest-hypothesis-engine.test.mjs scripts/codex-ingest-stock-feedback-paper-trade.test.mjs scripts/codex-ingest-stock-feedback-evidence-runner.test.mjs scripts/codex-ingest-lib.test.mjs src/components/dashboard/__tests__/research-cockpit-helpers.test.ts src/components/training/__tests__/training-flywheel-view.test.ts --testTimeout 60000
# 6 passed, 528 tests passed

cd src-tauri && cargo test research_cockpit_builds_lite_allowlisted_actions
# 1 passed

npm --silent run codex:ingest -- stock-feedback verify --project /path/to/trading-review-wiki
# status: ok; warning: no_stock_feedback_trajectories

npm run build
# passed
```

## UI / 交互 / Bug / 架构复盘

- UI：Evidence Queue 放在训练飞轮内，不拆出第二个证据系统，用户仍从训练样本缺口进入补证。
- 交互：create / run / review / retry / discard 都是固定动作，且写入必须显式 `--write`。
- Bug 风险：外部源失败不会伪造结果，会进入 failure / DLQ；Tushare token 缺失不会出现在输出里。
- 架构：v0.13 是执行层，v0.14 才做 hypothesis 生命周期推荐，v0.15 才做 paper trade agent，职责没有混在一起。

## 剩余缺口

- v0.13 只提供轻量 runner，CNINFO / QCC / Web 仍以 fallback / mock 形式保持闭环。
- 复杂基本面字段需要后续更细的 source adapter 和字段级校验。
- EvidenceResult 到 Hypothesis 生命周期的正式回流已在 v0.14 承接。
