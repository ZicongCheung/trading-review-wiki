# PRD: ResearchOS Codex 多 Agent 编排

日期：2026-06-21

## 1. 背景与目标

当前项目已经不是单点工具，而是一套可审计的训练飞轮闭环。多 Agent 之前，项目已经形成了从研究输入、证据执行、假设反馈、模拟交易、收益归因、Benchmark 到 LoRA-ready curriculum 的链路。

本 PRD 的目标不是重做训练飞轮，也不是引入新的重型 agent runtime，而是把已有闭环整理成 Codex 可调度的多 Agent 操作系统：

```text
用户简单输入
-> Codex Supervisor
-> 多个只读/写入受控子 Agent
-> 复用现有 CLI / artifact / verify
-> 产出高质量、可审计训练集
```

核心目标：

- 降低用户输入复杂度。
- 保持训练样本质量门严格。
- 复用现有 `stock-feedback` / `hypothesis` / `self-question` / `research-os agent` 命令族。
- 支持串行和并行的子 Agent 编排。
- 所有写入仍通过 HumanGate。
- 不写正式 `wiki/**`，不改旧 `raw/**`，不触发真实交易。

## 2. 多 Agent 前的既有闭环

### 2.1 总闭环

当前闭环是：

```text
self-question / hypothesis / manual collection
-> EvidenceTask
-> EvidenceResult
-> Hypothesis evidence-feedback
-> Paper Trade Agent candidate
-> paper trade ledger
-> paper trade settlement
-> stock-feedback trajectory
-> human review
-> Benchmark
-> LoRA-ready curriculum
-> export / eval / preference / adapter candidate
```

这条链已经有 CLI、UI、Tauri allowlist、verify 和测试覆盖。新增多 Agent 编排必须复用这条链，不能绕过它直接造训练样本。

### 2.2 Self-question 层

用途：

- 让系统提出可验证问题。
- 对问题进行市场验证。
- 对验证结果做归因。
- 为训练飞轮提供 `self-question attribution` 和市场反馈。

可复用命令：

```bash
npm --silent run codex:ingest -- self-question phase-status --project <project>
npm --silent run codex:ingest -- self-question loop --stages generate,validate,attribute --write --project <project>
npm --silent run codex:ingest -- self-question validate --write --project <project>
npm --silent run codex:ingest -- self-question attribute --write --project <project>
```

写入边界：

- `data/brain/questions.jsonl`
- `data/brain/validations.jsonl`
- `data/brain/attributions.jsonl`
- `.llm-wiki/self-question-runs/**`

质量要求：

- 必须保留当时问题、看好理由、验证窗口和归因。
- 不能用后验收益反推当时理由。

### 2.3 Evidence Runner 层

用途：

- 把缺证变成可执行任务。
- 拉取或记录行情、公告、财务、机构流、涨停分析等证据。
- 对证据结果做质量评分和 HumanGate review。

可复用命令：

```bash
npm --silent run codex:ingest -- stock-feedback evidence-task create ... --write
npm --silent run codex:ingest -- stock-feedback evidence-task list --project <project>
npm --silent run codex:ingest -- stock-feedback run-task-queue --write --project <project>
npm --silent run codex:ingest -- stock-feedback evidence-result list --project <project>
npm --silent run codex:ingest -- stock-feedback evidence-result review --result-id <id> --action approve --write --project <project>
npm --silent run codex:ingest -- stock-feedback source-status --project <project>
npm --silent run codex:ingest -- stock-feedback dlq list --project <project>
```

写入边界：

- `.llm-wiki/stock-feedback/evidence-tasks/**`
- `.llm-wiki/stock-feedback/evidence-results/**`
- `.llm-wiki/stock-feedback/evidence-runs/**`
- `.llm-wiki/stock-feedback/evidence-dlq/**`

质量要求：

- EvidenceResult 必须带 `sourceRefs` / `evidenceRefs`。
- 缺认证配置、接口失败、字段不足时进入 failure / DLQ，不能伪造证据。

### 2.4 Hypothesis Engine 层

用途：

- 管理 hypothesis 生命周期。
- 把 EvidenceResult 回流成 evidence feedback。
- 生成 Watchtower candidate、HumanGate 状态迁移建议和 post-mortem 草稿。

可复用命令：

```bash
npm --silent run codex:ingest -- hypothesis list --project <project>
npm --silent run codex:ingest -- hypothesis quality-check --project <project>
npm --silent run codex:ingest -- hypothesis evidence-feedback --status watching --write --project <project>
npm --silent run codex:ingest -- hypothesis post-mortem --write --project <project>
npm --silent run codex:ingest -- hypothesis supplement-draft --body "..." --source-refs "..." --project <project>
npm --silent run codex:ingest -- hypothesis validate --id <id> --project <project>
npm --silent run codex:ingest -- hypothesis verify --project <project>
```

写入边界：

- `.llm-wiki/hypotheses/**`
- `.llm-wiki/hypothesis-events/**`
- `.llm-wiki/hypothesis-alerts/**`
- `.llm-wiki/hypothesis-evidence-feedback/**`
- `.llm-wiki/hypothesis-post-mortems/**`
- `.llm-wiki/hypothesis-supplements/**`

质量要求：

- Watchtower candidate 只给推荐，不自动改正式状态。
- HumanGate 确认后才写状态事件。

### 2.5 Stock-feedback 轨迹层

用途：

- 把 self-question、collection-result、paper-trade、hypothesis feedback 转成 `stock-feedback-trajectory-v1`。
- 形成 review、Benchmark、LoRA-ready 的共同输入。

可复用命令：

```bash
npm --silent run codex:ingest -- stock-feedback status --project <project>
npm --silent run codex:ingest -- stock-feedback build-trajectories --write --project <project>
npm --silent run codex:ingest -- stock-feedback list --project <project>
npm --silent run codex:ingest -- stock-feedback review-queue --include-reviewed --project <project>
npm --silent run codex:ingest -- stock-feedback review --trajectory-id <id> --action <action> --write --project <project>
```

写入边界：

- `.llm-wiki/stock-feedback/trajectories/**`
- `.llm-wiki/stock-feedback/reviews/**`

质量要求：

- `validationTarget` 必须明确。
- `qualityGate` 必须可解释。
- `high_confidence` 不能作为原始来源，只能是人审或规则确认后的上层标记。

### 2.6 Collection Task / Collection Result 层

用途：

- 针对样本缺口生成补样本任务。
- 人工或 Agent 补齐证据后写入 collection-result。
- collection-result 回流为 trajectory。

可复用命令：

```bash
npm --silent run codex:ingest -- stock-feedback collection-task --write --project <project>
npm --silent run codex:ingest -- stock-feedback collection-result --result confirmed --evidence-refs "..." --summary "..." --write --project <project>
```

写入边界：

- `.llm-wiki/stock-feedback/collection-tasks/**`
- `.llm-wiki/stock-feedback/collection-results/**`

质量要求：

- 人工摘要不能替代 evidence refs。
- `confirmed` 必须至少有 `sourceRefs`、`price SQL`、`trade ledger` 或其他可审计引用。

### 2.7 Paper Trade Agent / Ledger / Settlement 层

用途：

- 从 hypothesis feedback 或 expectation_trade trajectory 生成模拟交易候选。
- 生成 rule_baseline 与 llm_discretionary 双轨。
- 记录 paper trade ledger。
- 结算收益、回撤、持有期。
- 进入收益归因和 Benchmark。

可复用命令：

```bash
npm --silent run codex:ingest -- stock-feedback paper-trade-agent candidates --project <project>
npm --silent run codex:ingest -- stock-feedback paper-trade-agent candidates --write --project <project>
npm --silent run codex:ingest -- stock-feedback paper-trade status --project <project>
npm --silent run codex:ingest -- stock-feedback paper-trade record ... --write --project <project>
npm --silent run codex:ingest -- stock-feedback paper-trade settle --paper-trade-id <id> ... --write --project <project>
npm --silent run codex:ingest -- stock-feedback paper-trade discretionary-review --project <project>
```

写入边界：

- `.llm-wiki/stock-feedback/paper-trade-agent/**`
- `.llm-wiki/stock-feedback/paper-trades/**`

质量要求：

- `ledgerKind=paper_trade`。
- 必须保留 `asOfDate` 和 `evidenceCutoff.noFutureData=true`。
- paper PnL 不能当真实盈利。
- profitable paper trade 只能低权重、人审后进入 adapter candidate。

### 2.8 Benchmark / LoRA-ready 层

用途：

- 生成 eval / preference / negative / adapter cases。
- 把训练材料拆成能力 curriculum。
- LoRA 只沉淀行为、技能、工具习惯、决策策略。

可复用命令：

```bash
npm --silent run codex:ingest -- stock-feedback bench --write --project <project>
npm --silent run codex:ingest -- stock-feedback export-lora-ready --write --project <project>
npm --silent run codex:ingest -- stock-feedback verify --project <project>
npm --silent run codex:ingest -- export-samples --kind eval --quality-gate review_required --project <project>
npm --silent run codex:ingest -- export-samples verify --project <project>
```

写入边界：

- `.llm-wiki/stock-feedback/benchmark/**`
- `.llm-wiki/stock-feedback/exports/**`
- `.llm-wiki/exports/training/**`

质量要求：

- LoRA-ready 不存 raw facts、价格行、交易明细。
- Benchmark case 不能把未结算、未人审、缺 as-of 的 paper trade 当正样本。

### 2.9 v0.16 ResearchOS Agent 外层

用途：

- Codex 聊天窗口作为 SupervisorAgent。
- 读取全局状态。
- 生成 agent plan。
- 列出 HumanGate。
- 执行单个固定 step。
- 统一 verify。

可复用命令：

```bash
npm --silent run codex:ingest -- research-os agent status --project <project>
npm --silent run codex:ingest -- research-os agent plan --write --project <project>
npm --silent run codex:ingest -- research-os agent review --project <project>
npm --silent run codex:ingest -- research-os agent step --step-id <id> --project <project>
npm --silent run codex:ingest -- research-os agent step --step-id <id> --write --confirm-human-gate true --project <project>
npm --silent run codex:ingest -- research-os agent verify --project <project>
```

写入边界：

- `.llm-wiki/research-os/agent-runs/**`

质量要求：

- `step` 只能走固定 action map。
- `step --write` 必须有 HumanGate。
- 不接受任意 shell。

## 3. 当前问题

当前系统功能已经足够，但用户使用成本高：

- 用户不知道先给 hypothesis、self-question、collection-result 还是 paper trade。
- 空态下直接跑下游会空转。
- 补证、模拟交易、review、Benchmark、LoRA-ready 的顺序容易混。
- 多 Agent 前置输入没有统一入口。
- 用户希望“给得越简单越好”，但系统必须保证训练样本质量。

因此需要一个 Codex 内的前置多 Agent 编排层，把自然语言输入转成现有闭环能消费的结构化动作。

## 4. 新方案：Codex 内多 Agent 编排

### 4.1 总体架构

```text
用户输入
-> Codex SupervisorAgent
-> IntakeAgent
-> EvidencePlanningAgent
-> EvidenceFetchAgent / MarketValidationAgent / HypothesisAgent
-> QualityGateAgent
-> ResearchOSAgent
-> HumanGate
-> stock-feedback / Benchmark / LoRA-ready
```

第一阶段仍在 Codex 聊天窗口运行，不在 app 内部新增 LLM runtime。

项目代码继续负责：

- CLI
- schema
- artifact
- verify
- Tauri allowlist
- 写入边界

Codex 负责：

- 理解用户输入。
- 选择子 Agent。
- 并行读取状态和证据。
- 生成结构化草案。
- 调用固定 CLI。
- 汇总风险和下一步。

### 4.2 用户输入目标

用户应该能用很少的信息启动流程。

最小输入：

```text
把 300xxx 这个逻辑做成训练飞轮输入。asOf=2026-06-20，目标是预期交易，只读预检。
```

推荐输入：

```text
股票：300xxx
asOfDate：2026-06-20
为什么看好：低位放量 + 资金预期扩散
预期：3-5 日相对强度继续
目标：expectation_trade
证据：复盘链接 / 微信摘要 / price SQL / Tushare
是否模拟交易：是
```

完整输入：

```text
stockCode
stockName
asOfDate
validationTarget
hypothesis
expectedMove
sourceRefs
evidenceRefs
entryPlan
exitPlan
positionSizing
invalidationCondition
entryDate
entryPrice
exitDate
exitPrice
realizedPnlPct
maxDrawdownPct
holdingDays
```

### 4.3 子 Agent 定义

#### SupervisorAgent

职责：

- 读取 `research-os agent status`。
- 判断当前阶段。
- 决定串行和并行 Agent。
- 生成 HumanGate 汇总。

输出：

- 当前阶段。
- 下一组 Agent。
- 是否可并行。
- 是否允许写入。
- 下一步命令。

#### IntakeAgent

职责：

- 解析用户自然语言、截图文字、链接、股票名、交易想法。
- 生成 `research-os-intake-draft-v1` 草案。
- 不写正式训练样本。

输出字段：

```text
stockCode
stockName
asOfDate
validationTarget
hypothesis
expectedMove
sourceRefs
evidenceRefs
missingFields
recommendedPath
```

#### EvidencePlanningAgent

职责：

- 判断缺哪些证据。
- 选择 evidence-task 类型。
- 生成补证任务草案。

可调用命令：

```bash
stock-feedback evidence-task create ...
stock-feedback source-status
```

#### EvidenceFetchAgent

职责：

- 运行证据队列。
- 查看 DLQ。
- 汇总 EvidenceResult。

可调用命令：

```bash
stock-feedback run-task-queue --write
stock-feedback evidence-result list
stock-feedback dlq list
```

写入限制：

- 只有用户允许补证写入时才运行 `--write`。

#### MarketValidationAgent

职责：

- 处理价格、换手、相对强度、承接、回撤。
- 优先用现有 price SQL / Tushare / data-source probe。

可调用命令：

```bash
stock-feedback paper-trade record --auto-market-evidence ...
stock-feedback paper-trade settle --auto-market-evidence ...
data-source-tushare-probe
```

#### HypothesisAgent

职责：

- 将输入或 EvidenceResult 转成 hypothesis evidence-feedback。
- 生成 Watchtower candidate 和 HumanGate 建议。

可调用命令：

```bash
hypothesis evidence-feedback --status watching --write
hypothesis supplement-draft ...
hypothesis quality-check
```

#### PaperTradeAgent

职责：

- 从合格 hypothesis feedback 或 trajectory 生成模拟交易候选。
- 生成 rule_baseline / llm_discretionary 双轨。

可调用命令：

```bash
stock-feedback paper-trade-agent candidates
stock-feedback paper-trade-agent candidates --write
stock-feedback paper-trade record ... --write
```

#### SettlementAgent

职责：

- 结算 open paper trade。
- 写入 realizedPnlPct、maxDrawdownPct、holdingDays。

可调用命令：

```bash
stock-feedback paper-trade status
stock-feedback paper-trade settle ... --write
```

#### AttributionAgent

职责：

- 把 collection-result / paper trade / self-question attribution 变成 trajectory。
- 判断收益归因。

可调用命令：

```bash
stock-feedback build-trajectories --write
stock-feedback list
stock-feedback review-queue --include-reviewed
```

#### ReviewAgent

职责：

- 给出 review 建议。
- 不自动审批。

可调用命令：

```bash
stock-feedback review --trajectory-id <id> --action needs_evidence --write
stock-feedback review --trajectory-id <id> --action approve_paper_adapter_candidate --write
stock-feedback review --trajectory-id <id> --action mark_priced_in --write
```

#### BenchmarkAgent

职责：

- 生成 Benchmark。
- 检查 eval / preference / negative / adapter case 覆盖。

可调用命令：

```bash
stock-feedback bench --write
stock-feedback verify
```

#### CurriculumAgent

职责：

- 导出 LoRA-ready curriculum。
- 检查 PEFT 边界。

可调用命令：

```bash
stock-feedback export-lora-ready --write
export-samples verify
```

## 5. 串行与并行编排规则

### 5.1 必须串行的步骤

这些步骤有写入、状态依赖或 HumanGate，必须串行：

```text
plan --write
-> review
-> step dry-run
-> user approval
-> step --write
-> verify
```

训练飞轮内部也必须串行：

```text
EvidenceTask create
-> run-task-queue
-> evidence-result review
-> hypothesis evidence-feedback
-> paper-trade-agent candidates
-> paper-trade record
-> paper-trade settle
-> build-trajectories
-> review
-> bench
-> export-lora-ready
-> verify
```

### 5.2 可以并行的步骤

只读状态可以并行：

```text
stock-feedback status
hypothesis list
hypothesis verify
stock-feedback verify
self-question phase-status
paper-trade status
evidence-task list
evidence-result list
dlq list
source-status
```

只读分析可以并行：

```text
IntakeAgent parse
EvidencePlanningAgent gap check
MarketValidationAgent source availability check
HypothesisAgent quality-check
PaperTradeAgent candidate preview
```

并行限制：

- 并行 Agent 不能写同一 artifact family。
- 并行 Agent 不能审批 HumanGate。
- 并行 Agent 不能调用任意 shell。
- 写入统一回到 SupervisorAgent 单点执行。

### 5.3 Codex 调用模式

第一阶段用 skill + CLI，不新增后端 runtime：

```text
research-os-intake-loop skill
-> 调用现有 CLI
-> 输出 draft / plan / review summary
-> 再调用 research-os-agent-loop skill
```

第二阶段可以把稳定后的 skill 沉淀为 CLI：

```bash
npm --silent run codex:ingest -- research-os intake status
npm --silent run codex:ingest -- research-os intake draft --input <text>
npm --silent run codex:ingest -- research-os intake plan --draft <id>
npm --silent run codex:ingest -- research-os intake step --step-id <id>
npm --silent run codex:ingest -- research-os intake verify
```

## 6. 推荐新增 Skill

新增本地 skill：

```text
research-os-intake-loop
```

定位：

- 训练飞轮前置入口。
- 用户给少量自然语言。
- Codex 解析并复用已有命令。
- 不直接写最终训练样本。

使用示例：

```text
使用 research-os-intake-loop：
把 300xxx 低位放量+资金预期这个逻辑转成训练飞轮输入。
asOf=2026-06-20，目标 expectation_trade，只读预检。
```

返回：

```text
intakeDraft
缺失字段
证据任务建议
是否可生成 hypothesis evidence-feedback
是否可生成 paper-trade-agent candidate
推荐的 research-os agent step
HumanGate 项
```

## 7. 质量门

### 7.1 必须字段

进入训练飞轮前至少要有：

```text
validationTarget
asOfDate
hypothesis / expectedMove
sourceRefs 或 evidenceRefs
stockCode 或 stockName
```

进入 paper trade 前至少要有：

```text
entryDate
entryPlan
exitPlan
positionSizing
invalidationCondition
evidenceCutoff.noFutureData=true
```

进入 settled paper 样本前至少要有：

```text
exitDate
exitPrice
realizedPnlPct
maxDrawdownPct
holdingDays
evidenceRefs
```

进入 LoRA-ready 前至少要有：

```text
human review
Benchmark coverage
PEFT boundary
storesRawFacts=false
factsRemainIn sourceRefs/tool state
adapterStores = behavior / skill / tool_habit / decision_strategy
```

### 7.2 禁止项

- 缺证据就标 high_confidence。
- paper trade 冒充真实收益。
- 后验改写当时看好理由。
- LoRA-ready 存 raw facts、价格行、公告原文、交易明细。
- 未经 HumanGate 自动写入。
- 任意 shell command。
- 自动改正式 `wiki/**` 或旧 `raw/**`。

## 8. 用户旅程

### 8.1 空态第一条样本

用户输入：

```text
今天我看好 300xxx，逻辑是低位放量和资金预期，帮我做成训练飞轮输入，只读。
```

系统流程：

```text
IntakeAgent 结构化
-> EvidencePlanningAgent 判断缺 sourceRefs / price evidence
-> QualityGateAgent 输出 needs_evidence
-> Supervisor 推荐 hypothesis evidence-feedback 或 evidence-task create
```

输出：

```text
不能直接进训练集
需要补 sourceRefs 和 price evidence
推荐命令
HumanGate 状态
```

### 8.2 有证据的预期交易样本

用户输入：

```text
300xxx，asOf=2026-06-20，低位放量，Tushare 有换手和后续承接，目标 expectation_trade，生成候选。
```

系统流程：

```text
IntakeAgent
-> MarketValidationAgent
-> HypothesisAgent evidence-feedback
-> PaperTradeAgent candidates
-> ResearchOSAgent review
```

输出：

```text
rule_baseline candidate
llm_discretionary candidate
entryPlan / exitPlan
缺 entryPrice 则提示补价
```

### 8.3 已有模拟交易结算

用户输入：

```text
这笔 paper trade 已卖出，收益 8%，最大回撤 3%，持有 4 天，帮我归因。
```

系统流程：

```text
SettlementAgent
-> AttributionAgent build-trajectories
-> ReviewAgent
-> BenchmarkAgent
-> CurriculumAgent
```

输出：

```text
profitFeedback
pattern_execution_supported / beta_supported / entry_wrong 等归因
Benchmark case
低权重 adapter candidate 或 eval/preference
```

## 9. Artifact 设计

Skill 阶段先写草案到：

```text
.llm-wiki/research-os/intake-runs/**
```

建议 schema：

```text
research-os-intake-draft-v1
research-os-intake-plan-v1
research-os-intake-step-result-v1
research-os-intake-quality-gate-v1
```

其中 `research-os-intake-draft-v1` 字段：

```json
{
  "schema": "research-os-intake-draft-v1",
  "inputText": "...",
  "stock": { "code": "", "name": "" },
  "asOfDate": "",
  "validationTarget": "",
  "hypothesis": "",
  "expectedMove": "",
  "sourceRefs": [],
  "evidenceRefs": [],
  "missingFields": [],
  "recommendedPath": "",
  "qualityGate": "needs_evidence",
  "writeBoundary": {
    "wroteWiki": false,
    "wroteRaw": false,
    "wroteRealTrade": false
  }
}
```

## 10. 权限与安全

Always:

- dry-run first。
- verify after write。
- 保留 exact counts 和 warnings。
- HumanGate 只批准单个 step。
- `.llm-wiki/**` 是默认写入边界。

Ask first:

- 写 `data/brain/**`。
- 执行 `self-question loop --write`。
- 写 paper trade ledger。
- 导出 LoRA-ready。
- 任何可能影响长期训练权重的 review action。

Never:

- 自动写正式 `wiki/**`。
- 修改旧 `raw/**`。
- 触发真实交易。
- 记录或输出认证密钥。
- 把 paper PnL 当真实收益。
- 把 raw facts 写进 LoRA-ready。

## 11. 实施计划

### Phase 1: Skill-only Intake

目标：

- 新增 `research-os-intake-loop` skill。
- 不改 repo 业务代码。
- 复用现有 CLI。

验收：

- 用户自然语言输入可转成 intake draft。
- 输出缺证清单和推荐命令。
- 可调用 `research-os-agent-loop` 进入 status/plan/review。
- 不发生任何未批准写入。

### Phase 2: CLI Artifact 化

目标：

- 新增 `research-os intake` 命令族。
- 写入 `.llm-wiki/research-os/intake-runs/**`。

命令：

```bash
research-os intake draft
research-os intake plan
research-os intake review
research-os intake step
research-os intake verify
```

验收：

- schema verify 通过。
- 缺 `sourceRefs/evidenceRefs` 不能进入 write_ready。
- `intake step --write` 必须 HumanGate。

### Phase 3: UI 接入

目标：

- 在训练飞轮空态新增“一句话生成第一条样本”入口。
- UI 读取 intake artifact。
- 不在 UI 里开放任意命令。

验收：

- 空态可引导生成 hypothesis feedback 或 evidence task。
- loading / error / dry-run / write / verify 状态可见。
- 所有写入仍走固定 allowlist。

## 12. 验收标准

功能验收：

- 用户只给一句股票逻辑，系统能输出结构化 intake draft。
- 系统能明确告诉用户缺什么证据。
- 系统能推荐下一条现有 CLI 命令。
- 系统能把合格输入交给 `research-os agent`。
- 系统不会绕过 HumanGate。

质量验收：

- `stock-feedback verify` 为 ok。
- `hypothesis verify` 为 ok。
- `research-os agent verify` 为 ok。
- 新增 intake verify 为 ok。
- LoRA-ready 不含 raw facts。
- paper trade 不等同真实收益。

工程验收：

- 不引入 LangGraph / Temporal / Mem0。
- 不新增自由 shell executor。
- 不写 `wiki/**` / `raw/**`。
- 新增测试覆盖 schema、CLI、HumanGate、质量门。
- `npm run build` 通过。
- `git diff --check` 通过。

## 13. 非目标

- 不做真实交易。
- 不做完整回测撮合。
- 不做滑点和订单簿。
- 不自动批准训练样本。
- 不自动训练 LoRA。
- 不把 UI 作为第一阶段。
- 不重做现有 Evidence Runner / Hypothesis Engine / Paper Trade Agent。

## 14. 推荐下一步

先做 `research-os-intake-loop` skill，作为 Codex 使用层。

推荐用户入口：

```text
使用 research-os-intake-loop：
把这个股票逻辑转成训练飞轮输入，只读预检。
股票：...
asOfDate：...
为什么看好：...
预期：...
```

如果 skill 用顺，再把稳定流程沉淀为 `research-os intake` CLI。
