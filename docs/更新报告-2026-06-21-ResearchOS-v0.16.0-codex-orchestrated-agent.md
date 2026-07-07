# Research OS v0.16.0 Codex-Orchestrated Agent 更新报告

日期：2026-06-21

## 本阶段目标

把多智能体编排先做成 Codex 聊天窗口可调用的后端能力，不先做 UI，不引入 LangGraph / Temporal，不在应用内部新增自由 LLM runtime。

Codex 扮演 `SupervisorAgent`；项目代码负责结构化状态、固定工具映射、artifact、verify 和写入边界。

## 新增能力

- 新增 `research-os agent` 命令族：
  - `status`：聚合 `stock-feedback status`、Hypothesis 列表、`stock-feedback verify`、`hypothesis verify`，输出 `research-os-agent-context-v1`。
  - `plan`：根据当前状态生成下一步多 agent 计划，输出 `research-os-agent-plan-v1`。
  - `step`：执行单个固定映射 step；默认 dry-run，`--write` 必须显式 HumanGate 确认。
  - `review`：列出当前计划中需要人审确认的节点。
  - `verify`：校验 Research OS agent artifact 和下游 verify 状态。

- 新增 artifact schema：
  - `research-os-agent-context-v1`
  - `research-os-agent-plan-v1`
  - `research-os-agent-step-result-v1`
  - `research-os-agent-run-manifest-v1`
  - `research-os-agent-verify-result-v1`

- 新增写入路径：
  - `.llm-wiki/research-os/agent-runs/**`

## Prompt Contract

Codex 聊天窗口按以下职责扮演 agent：

- `SupervisorAgent`：读取 `research-os agent status`，决定下一轮 agent 顺序、风险和 HumanGate 项。
- `HypothesisAgent`：调用 `hypothesis evidence-feedback`，生成证据回流草案和状态迁移建议。
- `PaperTradeAgent`：调用 `stock-feedback paper-trade-agent candidates`，生成 rule / LLM 双轨模拟交易候选。
- `SettlementAgent`：只处理 paper trade 结算计划；真实退出参数必须由用户确认。
- `AttributionAgent`：调用 `stock-feedback build-trajectories`，把已结算反馈转成轨迹/归因输入。
- `BenchmarkAgent`：调用 `stock-feedback bench`，生成 eval / preference / negative / adapter case。
- `CurriculumAgent`：调用 `stock-feedback export-lora-ready`，只输出 PEFT-ready curriculum。

每个 agent 输出必须保留：

- `agentId`
- `intent`
- `fixedAction`
- `inputRefs`
- `sourceRefs` / `evidenceRefs`
- `writeBoundary`
- `verifyCommands`
- `humanGateStatus`

## 写入边界

- 默认 dry-run。
- `plan --write` 只写 `.llm-wiki/research-os/agent-runs/**`。
- `step --write` 只允许固定 action，并且必须传入 HumanGate 确认。
- 禁止直接写正式 `wiki/**`。
- 禁止修改旧 `raw/**`。
- 禁止真实交易动作。
- 禁止把 token 写入 artifact。
- 禁止 LoRA-ready 存原始事实、价格行或交易明细。

## CLI 用法

```bash
npm run codex:ingest -- research-os agent status --project <project>
npm run codex:ingest -- research-os agent plan --project <project>
npm run codex:ingest -- research-os agent plan --project <project> --write
npm run codex:ingest -- research-os agent review --project <project>
npm run codex:ingest -- research-os agent step --project <project> --step-id <step_id>
npm run codex:ingest -- research-os agent step --project <project> --step-id <step_id> --write --confirm-human-gate true
npm run codex:ingest -- research-os agent verify --project <project>
```

## 验收

- 空项目可输出统一 agent context。
- 空项目 plan 推荐 `HypothesisAgent` 第一动作。
- 已有 hypothesis evidence-feedback 时推荐 `PaperTradeAgent`。
- 有 open paper trade 时推荐 `SettlementAgent`。
- 有 settled paper trade 时推荐 `AttributionAgent` / `BenchmarkAgent`。
- 未经 HumanGate 的写入 step 必须失败。
- `step` 不接受任意 shell command，只能走固定 action map。

## 实测结果

- v0.16.4 人工确认闭环已跑通：`status --write` -> `plan --write` -> `review` -> `step` dry-run -> `step --write --confirm-human-gate true` -> `verify`。
- `research-os agent verify`：`status=ok`，已检查 `contexts=1`、`plans=1`、`stepResults=1`、`manifests=1`，下游 `stockFeedback` / `hypothesis` 均为 `ok`。
- `stock-feedback verify`：`status=ok`，仅保留空项目预期 warning `no_stock_feedback_trajectories`。
- `hypothesis verify`：`status=ok`。
- `npx vitest run scripts/codex-ingest-research-os-agent.test.mjs scripts/codex-ingest-stock-feedback-evidence-runner.test.mjs scripts/codex-ingest-hypothesis-engine.test.mjs scripts/codex-ingest-stock-feedback-paper-trade.test.mjs --testTimeout 60000`：4 files / 63 tests passed。
- `npx vitest run scripts/codex-ingest-lib.test.mjs --testTimeout 60000`：1 file / 255 tests passed。
- `npm run build`：通过，仍有既有 Vite chunk / ineffective dynamic import warning。
- `git diff --check`：通过。

## 下一阶段

v0.17 再把这些 artifact 接入训练飞轮 UI，形成多 Agent 操作台；本阶段不做可视化。
