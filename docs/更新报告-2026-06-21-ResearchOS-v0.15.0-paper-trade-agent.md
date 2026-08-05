# Research OS v0.15.0 Paper Trade Agent 更新报告

日期：2026-06-21

## 本阶段目标

在 v0.13 Evidence Runner 与 v0.14 Hypothesis Engine 之上，继续形成训练飞轮核心闭环：

`证据 -> 假设 -> 模拟交易候选 -> 模拟交易账本 -> 收益归因 -> Benchmark -> LoRA-ready`

本阶段不重做 v0.13，不改正式 `wiki/**` / `raw/**`，不触发真实交易，只新增 Paper Trade Agent 候选层和它在 verify、Benchmark、LoRA-ready、UI 中的可审计流转。

## 新增能力

- 新增 `stock-feedback-paper-trade-agent-candidate-v1`。
  - 来源一：已有 `stock-feedback-trajectory-v1` 中的 `expectation_trade` 轨迹。
  - 来源二：v0.14 写入的 `trading-hypothesis-evidence-feedback-v1`。
  - 每条候选生成 `rule_baseline` 与 `llm_discretionary` 双轨。

- 新增 `stock-feedback-paper-trade-agent-manifest-v1`。
  - 只写 `.llm-wiki/stock-feedback/paper-trade-agent/**`。
  - 不写 paper trade ledger。
  - 不写 real trade ledger。

- 新增候选计划字段。
  - `entryPlan`
  - `exitPlan`
  - `positionSizing`
  - `invalidationCondition`
  - `expectedCatalyst`
  - `marketEvidenceRequest`
  - `evidenceCutoff.noFutureData=true`

- 严格保持 as-of 证据截断。
  - 候选必须有 `asOfDate`。
  - 候选必须声明 `evidenceCutoff.noFutureData=true`。
  - 自动行情补全仍通过后续 `stock-feedback paper-trade record --auto-market-evidence` 完成。

- Benchmark 扩展。
  - `stock-feedback bench` 现在可读取 persisted Paper Trade Agent 候选。
  - 新增 `sourceKind=paper_trade_agent_candidate` case。
  - 用于评审候选是否应该进入模拟交易记录，而不是直接进入 high-confidence。
  - Verify 会拦截被误标成 profitable、high-confidence 或直接 adapter/sft 路由的规划候选。

- LoRA-ready manifest 扩展。
  - 新增 `paperTradeAgentCurriculum`。
  - 分组：
    - `paper_trade_rule_baseline`
    - `paper_trade_llm_discretionary`
    - `paper_trade_blocked_evidence`
  - 默认权重仍是低权重模拟链路，不等同真实盈利样本。

- Verify 扩展。
  - 校验 Paper Trade Agent 候选 schema。
  - 校验 `ledgerKind=paper_trade`。
  - 校验 as-of 截断。
  - 校验计划字段。
  - 校验 PEFT 边界。
  - 校验 manifest 写入边界。

## CLI

新增命令：

```bash
npm run codex:ingest -- stock-feedback paper-trade-agent candidates [--limit 12] [--write]
```

默认 dry-run。只有 `--write` 写 `.llm-wiki/stock-feedback/paper-trade-agent/**`。

## UI

训练飞轮页面新增 Paper Trade Agent 区域：

- 顶部指标新增 `Agent 候选`。
- Paper Trade Ledger 面板新增 Agent 摘要。
- 新增按钮：
  - `预览 Agent 候选`
  - `写入 Agent 候选`
- 候选卡展示：
  - 来源：轨迹 / 假设反馈
  - 双轨：rule baseline / LLM discretionary
  - asOfDate
  - entryPlan / exitPlan
  - 待补入口价
  - 使用 Agent 生成 paper trade 草稿

Tauri 只新增固定 allowlist action：

- `stock-feedback-paper-trade-agent-dry-run`
- `stock-feedback-paper-trade-agent-write`

## 稳定化补丁：样本密度审计

- `stock-feedback status` 新增只读 `sampleDensityAudit`。
  - 统一检查轨迹、`expectation_trade`、Paper Trade Agent 预览候选、已写候选、paper trade 账本、settlement、人审、Benchmark、LoRA-ready、priced-in/反例和基本面兑现样本。
  - 输出缺口、下一步命令和 PEFT 边界。
  - 只读，不写 `wiki/**`、`raw/**`、`data/brain/**`，不写 paper trade ledger 或真实交易账本。

- 训练飞轮 UI 新增“样本密度审计”面板。
  - 展示阻塞/偏薄/可推进状态。
  - 区分 Agent 预览候选和已写入候选，避免 Benchmark 批次为空但 UI 误以为队列已闭环。
  - 提供写入轨迹、写入 Agent 候选、生成 Benchmark、刷新 LoRA-ready 的入口，但仍由用户显式点击触发。
  - 按前置条件禁用空转动作：Benchmark 必须等待轨迹或已写 Agent 候选，LoRA-ready 必须等待可导出轨迹或人审 paper 样本。
  - 区分缺上游输入与待重建轨迹：没有自提问归因、采集结果、paper trade 或 hypothesis evidence-feedback 时，先提示补输入，不把空跑 `build-trajectories --write` 当第一动作。
  - 缺上游输入时展示“补输入路线”：self-question 保持预览/命令提示，hypothesis evidence-feedback 与 collection-task 使用现有固定 allowlist 按钮。
  - 有上游输入时按输入类型分流：trajectory source input 走“重建路线”，仅有 hypothesis evidence-feedback 时直接预览 Paper Trade Agent 候选，不再推荐空跑轨迹写入。
  - 新增“第一条样本向导”：完全空态优先写入 `trading-hypothesis-evidence-feedback-v1`，已有 trajectory source input 时直接写入第一条 `stock-feedback-trajectory-v1`，仅有 hypothesis evidence-feedback 时直接预览 Paper Trade Agent 候选。

没有开放任意命令执行。

## 稳定化补丁：LLM discretionary 复盘预检

- `stock-feedback status` 新增只读 `discretionaryReviewAudit`。
  - 检查 LLM 自主 paper trade 是否有同源 `rule_baseline` 基准。
  - 检查 LLM 样本和基准样本是否已结算。
  - 检查 LLM 样本是否带 `sourceRefs / evidenceRefs / evidenceCutoff.noFutureData`。
  - 输出 `ready_for_discretionary_review_runner` 或下一步补齐动作。

- 训练飞轮 UI 在模拟交易闭环面板展示 `LLM复盘` readiness。
  - `ready` 只表示可以进入 LLM vs rule baseline 的 eval/preference 复盘。
  - 逐条展示最多 3 个 LLM 预检项，显示同源基准、as-of 引用和下一步阻塞原因。
  - 不启动真实 LLM runner。
  - 不写 paper trade ledger。
  - 不自动提升 adapter 权重。

- Benchmark 新增 `paper_trade_discretionary_review` case。
  - 只从已结算且同源配对的 LLM discretionary / rule_baseline paper trade 生成。
  - route 固定为 `eval / preference / paper_trade_discretionary_review`。
  - `highConfidenceEligible=false`，不把 paper profit 当真实收益。
  - Verify 会拦截缺同源 rule baseline、open trade、缺 as-of cutoff、缺 sourceRefs 或直接 adapter/sft 路由的坏 case。

- LoRA-ready manifest 新增 `paperTradeDiscretionaryReviewCurriculum`。
  - 复用 Benchmark case，不另造一套口径。
  - 输出 LLM 跑赢、跑输、持平和盈利/基准盈利计数。
  - 跑输基准默认进入 `eval / preference / negative`。
  - 跑赢基准也必须先人审，最多作为低权重 paper adapter 候选。
  - PEFT 边界继续声明不存原始事实、价格行或交易明细。

- CLI 新增只读 LLM discretionary 复盘 runner。
  - 命令：`stock-feedback paper-trade discretionary-review`。
  - 只读取已结算且同源配对的 LLM discretionary / rule_baseline paper trade。
  - 输出复盘草案、LLM vs rule baseline 收益/回撤/持有期对比、推荐训练分流和 PEFT 边界。
  - 不调用真实 LLM，不写 paper trade ledger，不写 LoRA-ready，不把 paper profit 当真实收益。

- 训练飞轮 UI 接入只读复盘 runner。
  - 模拟交易闭环面板新增“预览 LLM 复盘”按钮。
  - 仅当 `discretionaryReviewAudit.counts.readyPairs > 0` 且 audit 为 read-only 时启用。
  - 未满足条件时按钮保持禁用，并通过 tooltip 显示下一步阻塞原因。
  - Tauri 仅新增固定 allowlist action：`stock-feedback-paper-trade-discretionary-review`，不接受任意命令、不附加 `--write`。

- Verify 新增 discretionary review curriculum 守门。
  - 拦截 `highConfidenceEligible=true`。
  - 拦截默认路线缺少 `eval / preference` 或直接进入 `adapter / sft`。
  - 拦截 LLM 跑输基准但未进入 `negative` 的分流。
  - 拦截 paper profit 被当成真实收益提权、或缺少 PEFT 边界。
  - 拦截 LoRA-ready paper candidateRefs 绕过人审、进入普通 upweight bucket 或超过 `0.35x` 低权重。
  - 拦截 LoRA-ready paper candidateRefs 引用 open、非盈利或缺少 `realizedPnlPct / maxDrawdownPct / holdingDays` 的未结算样本。
  - 拦截 `adapterBatchRecipe.buckets[].candidateRefs` 里的 bucket-only paper ref 绕过顶层 candidateRefs 审计。
  - 拦截 LoRA-ready adapter candidate JSONL 中未人审、未结算、非盈利或超过 `0.35x` 的 paper candidate 记录。
  - 拦截 LoRA-ready adapter candidate JSONL 同批次重复 candidate id，避免同一文件内记录静默覆盖。
  - 拦截 LoRA-ready manifest 引用不存在的 adapter candidate JSONL 记录。
  - 拦截 LoRA-ready manifest `candidateRefs` 与 adapter candidate JSONL 记录的身份、路由或权重字段不一致，避免顶层清单改写已审计记录。
  - 拦截 LoRA-ready manifest `candidateRefs` 重复同一 candidate id，避免一个样本被重复计权。
  - 拦截 LoRA-ready manifest 与 adapter batch recipe 的候选数量漂移，避免 UI 和训练批次读取错误计数。
  - 拦截 `adapterBatchRecipe.weightedCandidateCount` 与正权重候选数量漂移，避免训练批次低报或高报可采样样本。
  - 拦截 `adapterBatchRecipe.totalEffectiveWeight` 与 bucket `totalEffectiveWeight` 漂移，避免 adapter curriculum 采样权重被高报或低报。
  - 拦截 LoRA-ready manifest 与 adapter batch recipe 显式声明 `modelTrainingStarted=true` 或 `storesRawFacts=true`，避免 PEFT-ready 清单被误标为已训练或事实仓库。
  - 拦截 LoRA-ready manifest 与 adapter batch recipe 的 `peftBoundary.adapterStores` 包含 raw facts 或单票事实记忆，避免边界声明本身混入事实存储。
  - 拦截 LoRA-ready adapter candidate JSONL 记录级 `decisionPolicy` 破坏 PEFT 边界，避免单条候选声明事实不留 retrieval 或 adapter 存 raw facts。
  - 拦截 LoRA-ready adapter candidate JSONL 记录级 `adapterStores` 包含 `single_stock_fact_memory / stock_fact / fact_memory`，避免单票事实记忆混入 adapter。
  - 拦截 `adapterBatchRecipe.buckets[].candidateIds/candidateRefs` 引用不在 manifest 顶层 `candidateRefs` 的孤儿候选，避免训练批次路由未审计样本。
  - 拦截 manifest 候选缺少任何 adapter batch bucket 路由，避免 LoRA-ready 清单和训练分流断链。
  - 拦截 bucket 级 `candidateRefs` 与顶层 manifest ref 的身份、路由或权重字段不一致，避免同一 candidate id 在训练批次中被替换成另一条 paper trade 或训练去向。
  - 拦截同一 candidate 横跨多个 adapter batch bucket，避免同一训练样本同时进入冲突权重路线。
  - 拦截 `paper_trade_agent_candidate` 缺 `sourceRefs`、`evidenceRefs` 或 `marketEvidenceRequest`，避免模拟交易候选脱离证据引用与 as-of 市场数据请求进入 Benchmark/LoRA-ready。
  - 拦截 `paper_trade_agent_candidate` readiness 与 as-of 行情请求、建议入账命令不一致，避免缺 `entryPrice` 或缺 `--auto-market-evidence` 的候选被误标为 ready。
  - 拦截 `paper_trade_agent` manifest 声明 `wrotePaperTradeLedger=true`，避免“生成候选”被误标成“已写模拟交易账本”。
  - 拦截最新 `paper_trade_agent` manifest 的 `count / summary.total` 与 latest candidate JSONL 数量漂移，避免 UI、Benchmark 和 LoRA-ready 读取错误候选数。
  - 拦截最新 `paper_trade_agent` manifest 的 summary 分布计数漂移，避免 rule/LLM 双轨、候选来源和待补价/阻塞状态误导 UI 与 curriculum。
  - 拦截 LoRA-ready `paperTradeAgentCurriculum` 和 `adapterCurriculum.paperTradeAgent` 与 latest candidate JSONL 分布漂移，避免导出训练分流沿用过期候选统计。

## 写入边界

- 不写 `wiki/**`
- 不写 `raw/**`
- 不写 `data/brain/**`
- 不触发真实交易
- 不写真实 trade ledger
- dry-run 不写任何 artifact
- `--write` 仅写：
  - `.llm-wiki/stock-feedback/paper-trade-agent/*.jsonl`
  - `.llm-wiki/stock-feedback/paper-trade-agent/*.manifest.json`

## PEFT 边界

LoRA / adapter 只沉淀：

- behavior
- skill
- tool_habit
- decision_strategy

事实、公告、财报、价格行、交易明细仍留在 retrieval / tool state / sourceRefs / price SQL / Tushare / paper trade ledger。

## 验收结果

```bash
npx vitest run scripts/codex-ingest-stock-feedback-paper-trade.test.mjs --testTimeout 20000
# 1 passed, 16 tests passed

npx vitest run src/components/training/__tests__/training-flywheel-view.test.ts --testTimeout 20000
# 1 passed, 143 tests passed

npx vitest run scripts/codex-ingest-hypothesis-engine.test.mjs scripts/codex-ingest-stock-feedback-paper-trade.test.mjs scripts/codex-ingest-stock-feedback-evidence-runner.test.mjs scripts/codex-ingest-lib.test.mjs src/components/dashboard/__tests__/research-cockpit-helpers.test.ts src/components/training/__tests__/training-flywheel-view.test.ts --testTimeout 60000
# 6 passed, 528 tests passed

cd src-tauri && cargo test research_cockpit_builds_lite_allowlisted_actions
# 1 passed

npm --silent run codex:ingest -- stock-feedback paper-trade-agent candidates --limit 3 --project /path/to/trading-review-wiki
# dryRun: true; count: 0; wroteWiki=false; wroteRaw=false; wroteBrain=false; wroteRealTradeLedger=false

npm --silent run codex:ingest -- stock-feedback verify --project /path/to/trading-review-wiki
# status: ok; warning: no_stock_feedback_trajectories

npm --silent run codex:ingest -- hypothesis verify --project /path/to/trading-review-wiki
# status: ok

npm run build
# passed
```

说明：当前真实项目目录里尚无 persisted stock-feedback trajectory，因此 Paper Trade Agent dry-run 返回 `count=0` 是预期空态。测试覆盖了有 trajectory 与 hypothesis evidence-feedback 时生成双轨候选、写入 artifact、进入 Benchmark、进入 LoRA-ready curriculum，以及成对 LLM discretionary 复盘进入 eval/preference curriculum 的闭环。

## UI / 交互 / Bug / 架构复盘

- UI：Agent 候选放在 Paper Trade Ledger 面板内，用户从“模拟账本”自然进入“候选生成”，不会误解为真实盈利样本。
- 交互：预览与写入分开；写入只落候选 artifact，不自动记录 paper trade，不自动 settle，不自动进 adapter。
- Bug 风险：候选没有 entryPrice 时只标记 `needs_market_price`，不会绕过后续行情证据门；verify 会拦截缺 as-of 截断、证据引用、市场数据请求或 PEFT 边界的历史 artifact。
- 架构：Paper Trade Agent 是候选层，不是撮合系统；真实收益、paper 收益、adapter 低权重路径继续分层。
- 偏离检查：本阶段没有引入 Temporal / LangGraph / Mem0，没有做订单簿、滑点或真实交易。

## 剩余缺口

- 当前项目还需要先写入有效 trajectory 或 hypothesis evidence-feedback，Agent 队列才会出现真实候选。
- `llm_discretionary` 目前生成候选计划，尚未接真实 LLM 每日 hold/sell 决策执行器。
- rule baseline 与 LLM discretionary 的赛后对比已具备 artifact 入口，但完整自动结算需要更多价格数据源样本。
- profitable paper trade 仍必须 settle + human review 后才能低权重进入 adapter 候选。

## 下一阶段建议

- 用 Tushare / price SQL 自动补 `entryPrice / maxDrawdown / followThrough / relativeStrength / turnoverChange`。
- 增加 Paper Trade Agent settle queue，按 as-of 后的固定窗口自动结算 open paper trades。
- 增加 LLM discretionary review runner，但保持每次决策可审计、可回放、不可偷看未来。
- 将跑输 rule baseline 的 LLM 决策自动送入 eval / preference / negative 样本池。
