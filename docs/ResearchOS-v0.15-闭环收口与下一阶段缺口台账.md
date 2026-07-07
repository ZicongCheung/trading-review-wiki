# Research OS v0.15 闭环收口与下一阶段缺口台账

日期：2026-06-21

## 收口结论

v0.13 到 v0.15 已经形成可审计轻量闭环：

`EvidenceTask -> EvidenceResult -> Hypothesis evidence-feedback -> Paper Trade Agent candidate -> paper trade ledger/settlement -> Benchmark -> LoRA-ready curriculum`

当前不继续扩新架构；后续只按缺口台账做 bug 修复、文档整理、测试补齐和小步闭环增强。

## 当前已验证边界

- 不合并 main，不推 main。
- 不写正式 `wiki/**`。
- 不改 `raw/**`。
- 不触发真实交易。
- 默认 dry-run。
- `--write` 只写 `.llm-wiki/**` 范围内对应 artifact。
- 不把 API token 写入代码、日志、manifest 或文档。
- 不引入 Temporal / LangGraph / Mem0。
- 不做完整撮合、滑点、订单簿。
- 不把 paper trade 当真实收益。
- 不把原始事实写入 LoRA-ready。

## 已完成闭环证据

- v0.13 Evidence Runner：
  - schema、CLI、Tushare/fallback、quality gate、cross validation、HumanGate、DLQ、verify、Evidence Queue UI 已落地。
  - 更新报告：`docs/更新报告-2026-06-21-ResearchOS-v0.13.0-evidence-runner.md`

- v0.14 Hypothesis Engine：
  - EvidenceResult 回流 Hypothesis、质量门、证据方向、Evidence Score、Watchtower candidate、HumanGate 推荐、Post-Mortem 草稿、Cockpit UI 已落地。
  - 更新报告：`docs/更新报告-2026-06-21-ResearchOS-v0.14.0-hypothesis-engine.md`

- v0.15 Paper Trade Agent：
  - Agent candidate、as-of 截断、双轨、entry/exit plan、positionSizing、invalidation condition、Benchmark cases、LoRA curriculum、训练飞轮 UI 已落地。
  - 更新报告：`docs/更新报告-2026-06-21-ResearchOS-v0.15.0-paper-trade-agent.md`

## 缺口台账

### P0：只做验证与稳定性修复

- 保持 `stock-feedback verify` 与 `hypothesis verify` 绿色。
- 对新增 artifact 做 schema 回归，不引入新根目录。
- 发现 token 泄漏、写入越界、paper trade 冒充真实收益时，优先修复。
- 已补：`stock-feedback verify` 校验 `paperTradeDiscretionaryReviewCurriculum`，防止 LLM discretionary 复盘被标成 high-confidence、直接进 adapter、漏掉 negative 路由或缺 PEFT 边界。
- 已补：`stock-feedback verify` 校验 `paper_trade_discretionary_review` Benchmark case，防止缺同源 rule_baseline、缺 as-of cutoff、open trade 或直接 adapter 路由进入评测集。
- 已补：`stock-feedback verify` 校验 `paper_trade_agent_candidate` Benchmark case，防止 Agent 规划候选被标成 profitable、high-confidence 或直接 adapter/sft 路由。
- 已补：`stock-feedback verify` 校验 LoRA-ready paper candidateRefs，防止 paper trade 绕过人审、被放进普通 upweight bucket 或超过 `0.35x` 低权重。
- 已补：LoRA-ready paper candidateRefs 增加结算审计字段，并由 `stock-feedback verify` 拦截 open、非盈利、缺 `realizedPnlPct / maxDrawdownPct / holdingDays` 的 paper 样本进入低权重 adapter 候选。
- 已补：`adapterBatchRecipe.buckets[].candidateRefs` 中的 bucket-only paper ref 复用同一套人审、结算、盈利和低权重守门，避免绕过顶层 candidateRefs 审计。
- 已补：LoRA-ready adapter candidate JSONL 记录级校验，防止坏 paper candidate 即使没有进入 manifest 也绕过人审、结算、盈利和 `0.35x` 低权重边界。
- 已补：LoRA-ready adapter candidate JSONL 同批次禁止重复 candidate id，防止 manifest/批次映射时静默覆盖记录。
- 已补：LoRA-ready manifest `candidateRefs` 与 adapter candidate JSONL 做一致性校验，防止 manifest 引用不存在的 candidate 记录导致训练批次断链。
- 已补：LoRA-ready manifest `candidateRefs` 不能覆盖 adapter candidate JSONL 的 `paperTradeId/sourceKind/validationTarget/adapterCapability/weight` 等锁定字段，防止顶层清单替换已审计记录身份。
- 已补：LoRA-ready manifest `candidateRefs` 禁止重复 candidate id，防止同一已审计样本被重复计权。
- 已补：LoRA-ready manifest `count`、`adapterBatchRecipe.totalCandidates` 和 bucket `count` 与实际 candidateRefs 做计数一致性校验，防止 UI 和训练批次读取漂移数量。
- 已补：LoRA-ready `adapterBatchRecipe.weightedCandidateCount` 与正权重 `candidateRefs` 做一致性校验，防止训练批次低报或高报可采样候选数。
- 已补：LoRA-ready `adapterBatchRecipe.totalEffectiveWeight` 和 bucket `totalEffectiveWeight` 与 candidateRefs 正式权重做一致性校验，防止 adapter curriculum 采样权重被高报或低报。
- 已补：LoRA-ready manifest 与 `adapterBatchRecipe` 显式拦截 `modelTrainingStarted=true` 或 `storesRawFacts=true`，防止 PEFT-ready 清单被误标为已训练或事实仓库。
- 已补：LoRA-ready manifest 与 `adapterBatchRecipe` 的 `peftBoundary.adapterStores` 拦截 raw facts 与单票事实记忆，防止边界声明本身混入事实存储。
- 已补：LoRA-ready adapter candidate JSONL 记录级校验 `decisionPolicy`，要求事实留在 retrieval/tool state 并禁止 adapter 声明存储 raw facts。
- 已补：LoRA-ready adapter candidate JSONL 记录级拦截 `single_stock_fact_memory / stock_fact / fact_memory` 进入 `adapterStores`，防止单票事实记忆混入 adapter。
- 已补：LoRA-ready `adapterBatchRecipe.buckets[].candidateIds/candidateRefs` 必须存在于 manifest 顶层 `candidateRefs`，防止 batch recipe 路由未入清单的孤儿候选。
- 已补：LoRA-ready `adapterBatchRecipe` 必须覆盖 manifest 全部 `candidateRefs`，防止候选进入清单但没有训练 bucket 路由。
- 已补：LoRA-ready bucket 级 `candidateRefs` 不能覆盖顶层 manifest ref 的 `paperTradeId/sourceKind/validationTarget/adapterCapability/weight` 等锁定字段，防止同一 candidate id 被路由到另一条未审计样本身份。
- 已补：LoRA-ready `adapterBatchRecipe` 禁止同一 candidate 横跨多个 bucket，防止一个样本同时进入 upweight/downweight 等冲突训练路线。
- 已补：`paper_trade_agent_candidate` 必须保留 `sourceRefs`、`evidenceRefs` 和 `marketEvidenceRequest`，防止模拟交易候选脱离证据引用与 as-of 市场数据请求进入 Benchmark/LoRA-ready。
- 已补：`paper_trade_agent_candidate` 校验 readiness、as-of 行情请求和建议入账命令一致性，防止缺 `entryPrice` 或缺 `--auto-market-evidence` 的候选被误标为 ready。
- 已补：`paper_trade_agent` manifest 显式声明并校验 `wrotePaperTradeLedger=false`，防止“候选生成”被误标成“已写模拟交易账本”。
- 已补：最新 `paper_trade_agent` manifest 的 `count / summary.total` 必须与 latest candidate JSONL 数量一致，防止 UI、Benchmark 和 LoRA-ready 读取漂移候选数。
- 已补：最新 `paper_trade_agent` manifest 的 summary 分布计数必须与 latest candidate JSONL 一致，防止双轨、来源、补价/阻塞状态在 UI 和 curriculum 中漂移。
- 已补：LoRA-ready `paperTradeAgentCurriculum` 和 `adapterCurriculum.paperTradeAgent` 必须与 latest candidate JSONL 分布一致，防止导出训练分流沿用过期候选统计。

### P1：补样本密度，不扩架构

- 已补：`stock-feedback status` 新增只读 `sampleDensityAudit`，统一审计轨迹、预期交易、Agent 预览/已写候选、paper trade、结算、人审、Benchmark、LoRA-ready、priced-in/反例和基本面兑现样本缺口。
- 已补：训练飞轮新增“样本密度审计”面板，展示阻塞点、下一步命令和 PEFT 边界；面板只推荐动作，不自动写 artifact。
- 已补：样本密度面板按前置条件启用动作；没有轨迹或已写 Agent 候选时不展示 Benchmark 为可执行，没有可导出轨迹或人审 paper 样本时不展示 LoRA-ready 为可执行。
- 已补：样本密度审计区分“缺上游输入”和“有输入待重建轨迹”；没有自提问归因、采集结果、paper trade 或 hypothesis evidence-feedback 时，不再把空跑 `build-trajectories --write` 作为第一动作。
- 已补：训练飞轮在缺上游输入时直接展示“补输入路线”；self-question 只给预览/命令提示，hypothesis evidence-feedback 与 collection-task 复用已有固定 allowlist action，不开放任意命令。
- 已补：样本密度审计按输入类型分流；只有 self-question attribution、collection result、paper trade ledger 这类 trajectory source 才推荐 `build-trajectories --write`，仅有 hypothesis evidence-feedback 时直接推荐 Paper Trade Agent 预览。
- 已补：训练飞轮在已有 trajectory source input 但尚无轨迹时展示“重建路线”，先固定写入轨迹，再只读预览 Agent 候选，避免用户在空态里猜下一步。
- 已补：训练飞轮样本密度面板新增“第一条样本向导”；完全空态优先写入 `trading-hypothesis-evidence-feedback-v1`，已有 trajectory source input 时直接写入第一条 `stock-feedback-trajectory-v1`，仅有 hypothesis evidence-feedback 时直接预览 Paper Trade Agent 候选。
- 写入有效 `stock-feedback-trajectory-v1` 或 `trading-hypothesis-evidence-feedback-v1`，让真实项目里的 Paper Trade Agent 队列从当前空态变成有候选。
- 补 priced-in、entry_wrong、disconfirmed、fundamental_closure 样本。
- profitable paper trade 必须 settle + human review 后才进入低权重 adapter candidate。

### P2：补自动结算小闭环

- 已补：open paper trade 的只读 `settlementQueue` 与顶部“待结算”指标，训练飞轮优先展示待结算样本，并复用现有 settle 面板做结算复盘。
- 已补：settlement result / manifest 返回 `artifactRefreshPlan`，UI follow-up 展示轨迹重建、Benchmark、人审、LoRA-ready、verify 的刷新顺序与阻塞点。
- 已补：status / 训练飞轮新增 `settlementRefreshAudit` 与“待刷新”指标，页面重载后仍可看到已结算 paper trade 是否缺轨迹、Benchmark、人审或 LoRA-ready 覆盖。
- 已补：LoRA-ready `candidateRefs` 显式保留 `paperTradeId`，`approve_paper_adapter_candidate -> Benchmark -> LoRA-ready` 完成后 `settlementRefreshAudit.pending` 可归零。
- 只按已有 entry/exit/as-of/market evidence 字段结算，不引入撮合系统。
- 结算后写入 realizedPnlPct、maxDrawdownPct、holdingDays，并回流 Benchmark / LoRA-ready。

### P3：LLM discretionary 复盘 runner

- 已补：`stock-feedback status` 新增只读 `discretionaryReviewAudit`，检查 LLM 自主 paper trade 是否具备同源 rule_baseline、是否已结算、是否有 as-of sourceRefs/evidenceRefs，输出 runner 前置状态。
- 已补：训练飞轮模拟交易闭环面板展示 `LLM复盘` readiness；ready 只代表可进入 eval/preference 对比，不自动提权、不启动真实 LLM runner。
- 已补：训练飞轮展示最多 3 条 LLM 复盘预检项，逐条显示 open/closed、同源 rule_baseline、sourceRefs/evidenceRefs 和下一步阻塞原因。
- 已补：Benchmark 对 ready 的 LLM discretionary vs rule_baseline 成对结算样本生成 `paper_trade_discretionary_review` case，route 只进入 eval/preference，不进入 high-confidence。
- 已补：LoRA-ready manifest 新增 `paperTradeDiscretionaryReviewCurriculum`，把 LLM 跑赢、跑输、持平的成对复盘样本分流到 eval/preference/negative，不把 paper profit 当真实收益提权。
- 已补：`stock-feedback paper-trade discretionary-review` 只读 runner，可从已结算成对样本生成复盘草案、LLM vs rule baseline 对比、推荐训练分流和 PEFT 边界，不调用真实 LLM、不写 paper ledger。
- 已补：训练飞轮 UI 新增“预览 LLM 复盘”入口，并通过固定 Tauri allowlist action 调用只读 runner；未满足 ready pair 时按钮保持禁用并展示阻塞原因。
- 只在 as-of 截断上下文里做 daily hold/sell review。
- 每次决策必须有 sourceRefs / evidenceRefs。
- 跑输 rule_baseline 的决策进入 eval / preference / negative。
- 跑赢 baseline 也只能先进入低权重、人审后的 adapter 候选。

## 下一阶段建议

1. 先补真实项目样本：运行 evidence-feedback / build-trajectories / paper-trade-agent candidates，确认 UI 中 Agent 队列有候选。
2. 再补 settle queue：只服务 open paper trades 的结算复盘。
3. 最后补 LLM discretionary review runner：保持 as-of 截断、可回放、可审计。

## 不做项

- 不做真实交易下单。
- 不做全量回测撮合。
- 不做滑点/订单簿。
- 不把 paper PnL 当真实收益。
- 不把事实和价格行灌进 LoRA-ready。
- 不在当前轻量闭环稳定前引入重型 agent 编排框架。
