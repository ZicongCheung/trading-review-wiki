# Research OS v0.14.0 Hypothesis Engine 更新报告

日期：2026-06-21

## 本阶段目标

从已完成的 v0.13 Evidence Runner 继续向前，把 `EvidenceResult` 回流到 Hypothesis 生命周期，让假设成为可证伪、可评分、可复盘、可进入训练飞轮的主动引擎。

本阶段不重做 v0.13 的 `EvidenceTask / EvidenceResult / Evidence Queue / verify`，只复用其 artifact。

## 新增能力

- 新增 `trading-hypothesis-evidence-feedback-v1`。
  - 读取 `.llm-wiki/stock-feedback/evidence-tasks/**` 与 `.llm-wiki/stock-feedback/evidence-results/**`。
  - 通过 `source=hypothesis` / `sourceId=hypothesisId` 回流到对应假设。
  - 输出 evidence direction：`strengthening / weakening / neutral`。
  - 输出 Evidence Score：`sourceReliability / sampleSize / timeliness / directRelevance / verifiability / total`。

- 正式化 Hypothesis Quality Gate。
  - `falsifiableConditions`
  - `coreDrivers`
  - `marketMispricing`
  - `sourceRefs`

- 新增可证伪触发检测。
  - numeric：如 `close < 20`
  - date：如 `2026-06-30`
  - text contains：如 `包含:砍单`

- 新增 Watchtower evidence candidate。
  - 只生成推荐。
  - 不自动改正式 hypothesis 状态。
  - 推荐状态包括 `strengthening / disconfirmed / priced_in / keep_watching`。

- 新增 HumanGate 状态迁移推荐。
  - `recommendedAction`
  - `targetStatus`
  - `confidence`
  - `reason`
  - `risks`
  - `writeCommand`

- 新增 Post-Mortem 草稿。
  - 仅对 `archived / disconfirmed / priced_in` 终态假设生成。
  - 包含当初为什么看好、支持证据、哪里错了、市场如何验证、是否存在后验改写风险。

- 新增 Hypothesis Engine verify。
  - 校验 evidence-feedback、post-mortem、manifest、PEFT 边界与写入边界。

## CLI

新增命令：

```bash
npm run codex:ingest -- hypothesis evidence-feedback [--id <hypothesis-id>] [--status watching] [--write]
npm run codex:ingest -- hypothesis post-mortem [--id <hypothesis-id>] [--write]
npm run codex:ingest -- hypothesis verify
```

默认 dry-run；只有 `--write` 写 `.llm-wiki/hypothesis-evidence-feedback/**` 或 `.llm-wiki/hypothesis-post-mortems/**`。

## UI

Research Cockpit 的假设详情新增 Hypothesis Engine 面板：

- Quality Gate 字段
- Evidence Score
- 证据时间线
- 可证伪触发
- Watchtower 推荐
- HumanGate 推荐
- 训练飞轮回流路线
- Post-Mortem 草稿入口
- Hypothesis Engine verify 状态

UI 只展示和触发固定 allowlist action，不开放任意命令。状态迁移仍复用现有 `hypothesis status-update --write` 人审链路。

## 写入边界

- 不写 `wiki/**`
- 不写 `raw/**`
- 不写 `data/brain/**`
- 不触发真实交易
- 不自动改正式 Hypothesis 状态
- 不把原始事实写入 LoRA-ready 或 adapter 候选
- 新增写入仅限：
  - `.llm-wiki/hypothesis-evidence-feedback/**`
  - `.llm-wiki/hypothesis-post-mortems/**`

## PEFT 边界

LoRA / adapter 只沉淀：

- behavior
- skill
- tool_habit
- decision_strategy

事实、公告、交易数据、价格行、EvidenceResult 原文仍留在 retrieval / tool state / sourceRefs / artifact refs。

## 验收结果

```bash
npx vitest run scripts/codex-ingest-hypothesis-engine.test.mjs
# 1 passed, 2 tests passed

npx vitest run scripts/codex-ingest-hypothesis-engine.test.mjs scripts/codex-ingest-lib.test.mjs src/components/dashboard/__tests__/research-cockpit-helpers.test.ts --testTimeout 20000
# 3 passed, 362 tests passed

cd src-tauri && cargo test research_cockpit_builds_lite_allowlisted_actions
# 1 passed

npm --silent run codex:ingest -- stock-feedback verify --project /Users/jiegege/Downloads/trading-review-wiki-0.10.311
# status: ok; warning: no_stock_feedback_trajectories

npm --silent run codex:ingest -- hypothesis verify --project /Users/jiegege/Downloads/trading-review-wiki-0.10.311
# status: ok

npm run build
# passed
```

说明：`scripts/codex-ingest-lib.test.mjs` 中一个既有 hypothesis ask 用例在默认 5s 超时下曾超时；使用 `--testTimeout 20000` 单独与组合复跑均通过，判断为耗时型用例，不是本次回归。

## UI / 交互 / Bug / 架构复盘

- UI：Hypothesis Engine 面板位于假设跟踪表内，用户先选假设，再看证据回流与确认动作，路径集中。
- 交互：自动推荐不直接写状态；用户点击“确认推荐”才进入现有 HumanGate 审计链路。
- Bug 风险：当前 numeric/date/text contains 是轻量规则，适合作为 V1 触发器；复杂财务口径仍需 EvidenceTask 明确 targetFields。
- 架构：复用 v0.13 EvidenceResult，不复制 Evidence Runner；Hypothesis Engine 是推荐层和验证层，不是第二套证据队列。

## 剩余缺口

- Hypothesis result 目前以 route recommendation 形式回流训练飞轮，尚未生成 paper trade agent 候选。
- 基本面兑现样本仍依赖专门 EvidenceTask 和人工确认。
- priced-in 风险需要更多价格/承接/换手证据样本。

## 下一阶段 v0.15

进入 Paper Trade Agent：

- 从 self-question / Hypothesis / EvidenceResult 生成 paper trade candidate。
- 严格 asOfDate 截断，防止偷看未来。
- rule_baseline 与 llm_discretionary 双轨。
- settlement 后生成收益归因。
- profitable paper trade 只能进入低权重 adapter candidate。
- 跑输 baseline 的 LLM 决策进入 negative / eval / preference。
