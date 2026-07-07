# Codex Ingest CLI 使用手册

本文面向日常使用者，说明当前 `codex:ingest` CLI 每组命令的用途、什么时候用、怎么用，以及哪些命令会写文件。

当前默认项目目录：

```sh
/Users/jiegege/Desktop/杰杰杰
```

当前工具仓库目录：

```sh
/Users/jiegege/Downloads/trading-review-wiki-0.10.311
```

所有示例默认在工具仓库目录执行：

```sh
cd /Users/jiegege/Downloads/trading-review-wiki-0.10.311
```

通用调用格式：

```sh
npm run codex:ingest -- <command> [args...]
```

## 1. 总体心智模型

这套 CLI 不是单一问答工具，而是 Trading Review Wiki 的工程化操作台。

它服务四类工作：

| 工作 | 对应命令 | 主要产物 |
|---|---|---|
| 知识摄入 | `prepare/api-run/finalize/apply` | `.llm-wiki/codex-ingest/**`、正式 `wiki/**` |
| 只读研究 | `ask/ask --agentic/ask eval` | 答案、`.llm-wiki/agent-runs/**`、`.llm-wiki/eval/**` |
| 数据和验证 | `market-validate/company-research/data-source` | `data/brain/**`、`.llm-wiki/company-research/**` |
| 递归研究 | `self-question/self-train/export-samples/autoresearch/hypothesis` | `data/brain/**`、`.llm-wiki/**` |
| 专业能力层 | Data Analytics / Public Equity Investing / Investment Banking | 数据质控、买方研究、交易事项分析 |

最重要的边界：

- `ask` 是只读。
- `raw/` 不由 ingest/apply 改写。
- 正式 `wiki/` 写入只走 `apply --write`。
- 没有 `--write` 的命令默认是 dry-run 或只读。
- Phase 5A 只做到 proposed policy，不自动改 prompt、segment、wiki/raw，也不自动交易。
- Phase 5B 开始维护 Hypothesis Library，把投资假设变成可跟踪、可验证、可复盘的资产。
- 插件不是数据源；主程序负责证据和审计，插件负责专业框架和复核。

## 2. 最高频日常命令

### 2.1 查知识库

用于问当前知识库里已有的信息。

```sh
npm run codex:ingest -- ask \
  --query "AI服务器电源现在是订单兑现还是叙事扩散？" \
  --project /Users/jiegege/Desktop/杰杰杰
```

看检索来源：

```sh
npm run codex:ingest -- ask \
  --query "CPO光学耦合主题目前应该补什么证据？" \
  --show-sources
```

看上下文片段：

```sh
npm run codex:ingest -- ask \
  --query "PCB哪些细分更有财报验证价值？" \
  --show-context
```

指定来源：

```sh
npm run codex:ingest -- ask \
  --query "炬光科技688167近20日量价承接如何？" \
  --sources stock-price \
  --show-context
```

意义：

- 适合快速判断一个主题有没有证据。
- 能把 `wiki/raw/graph/facts/brain/stock-price` 组合起来。
- 不写任何正式库文件。

### 2.2 多智能体深度问答

用于复杂主题，需要证据、反证、量价、交易策略一起看。

```sh
npm run codex:ingest -- ask \
  --agentic \
  --query "未来三年数据中心对光纤、连接器、PCB、CPO产业链的真实订单兑现路径，哪些细分环节最可能先出现财报验证？" \
  --agent-concurrency 3 \
  --agent-timeout-ms 180000
```

默认会生成审计产物：

```text
.llm-wiki/agent-runs/<timestamp>-ask/manifest.json
.llm-wiki/agent-runs/<timestamp>-ask/final.md
```

关闭审计产物：

```sh
npm run codex:ingest -- ask \
  --agentic \
  --query "..." \
  --no-agent-artifacts
```

意义：

- `evidence-researcher` 找正证据。
- `counterevidence-auditor` 找反证和过度外推。
- `market-validator` 做量价和候选池验证。
- `strategy-mapper` 转成交易含义和验证清单。
- adjudicator 统一输出六章节。

注意：

- `--show-sources` 偏来源诊断，不一定生成完整 agent run。
- 要做实验闭环，建议不带 `--show-sources` 跑一次完整 `ask --agentic`。

## 3. 知识摄入命令

摄入命令的目标是把原始资料变成可审阅的 wiki 更新。

### 3.1 预处理

```sh
npm run codex:ingest -- prepare \
  --source /path/to/source.md \
  --project /Users/jiegege/Desktop/杰杰杰
```

意义：

- 准备摄入上下文。
- 只写 `.llm-wiki/codex-ingest/**`。

### 3.2 LLM 分析和生成变更

```sh
npm run codex:ingest -- api-run \
  --provider codex \
  --source /path/to/source.md \
  --project /Users/jiegege/Desktop/杰杰杰
```

常用参数：

```sh
--page-concurrency 1
--max-plan-items 20
--source-sharding auto
```

意义：

- 生成 staged 页面、计划、manifest。
- 默认不正式写 wiki。
- 适合摄入研报、会议纪要、每日复盘、公众号整理稿。

### 3.3 断点恢复

```sh
npm run codex:ingest -- finalize \
  --report /Users/jiegege/Desktop/杰杰杰/.llm-wiki/codex-ingest/<run-id>
```

意义：

- 当 `api-run` 后期失败但已经生成文件块时，用它恢复 `changes.json`。
- 比重跑整篇更稳。

### 3.4 正式写入

先 dry-run：

```sh
npm run codex:ingest -- apply \
  --manifest /path/to/changes.json \
  --project /Users/jiegege/Desktop/杰杰杰
```

确认后写入：

```sh
npm run codex:ingest -- apply \
  --manifest /path/to/changes.json \
  --project /Users/jiegege/Desktop/杰杰杰 \
  --write
```

意义：

- `apply --write` 是正式 `wiki/**` 写入闸门。
- 不加 `--write` 不改正式 wiki。

## 4. 文件转换

用于把 PDF、docx、xlsx、pptx 等文件转为 Markdown sidecar。

```sh
npm run codex:ingest -- convert-source \
  --source /path/to/report.pdf \
  --project /Users/jiegege/Desktop/杰杰杰
```

指定输出：

```sh
npm run codex:ingest -- convert-source \
  --source /path/to/report.pdf \
  --output /path/to/report.markitdown.md \
  --overwrite
```

意义：

- 给摄入流程准备 Markdown 输入。
- 可能在源文件旁写 `.markitdown.md`。
- 不写正式 `raw/` 和 `wiki/`。

## 5. Ask Eval

用于检查某个问题能不能召回预期来源。

```sh
npm run codex:ingest -- ask eval \
  --query "CPO光学耦合主题有哪些证据缺口？" \
  --expect-paths wiki/概念/光互联.md,raw/研报新闻/xxx.md
```

写入评估产物：

```sh
npm run codex:ingest -- ask eval \
  --query "..." \
  --expect-paths wiki/概念/xxx.md \
  --write
```

产物：

```text
.llm-wiki/eval/*.json
```

意义：

- 检查检索召回、相关性、source coverage、raw noise 和结构质量。
- 适合改检索逻辑后回归。

## 6. 数据源命令

### 6.1 查看数据源状态

```sh
npm run codex:ingest -- data-source status
```

意义：

- 检查 QCC、CNINFO、Tushare 等数据源配置状态。
- 输出应脱敏。

### 6.2 企查查招投标

```sh
npm run codex:ingest -- data-source qcc-tenders \
  --keyword "数据中心 MPO 光纤" \
  --pub-date-start 2026-01-01 \
  --pub-date-end 2026-06-15
```

意义：

- 查招投标、中标、客户和订单线索。
- 后续可作为 evidence task 或 company research 的输入。

## 7. 市场验证

### 7.1 单条预测验证

```sh
npm run codex:ingest -- market-validate \
  --prediction "CPO光学耦合可能进入订单兑现阶段" \
  --stock 300709 \
  --window 20d
```

写入验证：

```sh
npm run codex:ingest -- market-validate \
  --prediction "..." \
  --stock 300709 \
  --window 20d \
  --write
```

意义：

- 用股票日线、窗口收益、放量等验证预测是否被市场确认。
- 默认 dry-run。
- `--write` 写 `data/brain/validations.jsonl`。

## 8. 公司深度研究

普通研究：

```sh
npm run codex:ingest -- company-research \
  --stock 688167 \
  --from 2026-06-01 \
  --to 2026-06-15
```

深度研究：

```sh
npm run codex:ingest -- company-research \
  --stock 688167 \
  --from 2026-06-01 \
  --to 2026-06-15 \
  --deep \
  --plugin-led \
  --cninfo-event-from 2025-01-01
```

常用 timeout：

```sh
--company-provider-timeout-ms 45000
--cninfo-download-timeout-ms 90000
```

产物：

```text
.llm-wiki/company-research/**
```

`--plugin-led` 产物：

```text
.llm-wiki/company-research/<run-id>/plugin-led/plugin-led-input.json
.llm-wiki/company-research/<run-id>/plugin-led/data-analytics-model-analysis.md
.llm-wiki/company-research/<run-id>/plugin-led/plugin-led-company-report.md
.llm-wiki/company-research/<run-id>/plugin-led/plugin-led-company-report-complete.md  # 仅在完整性修复触发时生成
.llm-wiki/company-research/<run-id>/plugin-led/report-completeness.json
.llm-wiki/company-research/<run-id>/plugin-led/publish-readiness.json
.llm-wiki/company-research/<run-id>/plugin-led/plugin-led.json
.llm-wiki/company-research/<run-id>/deep-company-report.md
```

最终主报告路径以 `plugin-led/plugin-led.json` 的 `outputs.pluginLedReport` 为准；`deep-company-report.md` 始终作为旧 reviewer 和 skill 的兼容副本。

意义：

- 主程序负责 CNINFO/Tushare/Tavily/wiki/行情库采集、证据包、底表、模型和写入边界。
- Data Analytics 先做模型、口径、单位、tie-out、公式重算风险和证据覆盖检查。
- Public Equity Investing 作为主分析师直接生成公司深度报告。
- Investment Banking 只在并购、定增、可转债、重组、融资等触发项出现，或显式 `--force-investment-banking-review` 时参与。
- `deep-company-report.md` 会同步插件主报告，兼容旧 reviewer 和 skill。
- 不直接写正式 `wiki/` 或 `raw/`。

### 8.1 专业插件主导链路

公司深研 V2 推荐直接使用 `--plugin-led`，不再等主程序先写一版深度稿后再评审。主程序只负责证据包、底表、模型和写入边界；插件直接承担分析和表达。

| 插件 | 什么时候用 | 输入 | 输出 |
|---|---|---|---|
| Data Analytics | `--plugin-led` 第一棒；检查模型、表格、SQL、Excel、JSON、证据覆盖、横向对比 | `plugin-led-input.json`、`financial-model-v2.xlsx`、`evidence-pack.json`、SQL/CSV/Excel | `plugin-led/data-analytics-model-analysis.md` |
| Public Equity Investing | `--plugin-led` 主分析师；明确股票投资研究、财报、估值、催化剂、加减仓/退出 | `plugin-led-input.json`、Data Analytics 输出、模型、公告证据 | `plugin-led/plugin-led-company-report.md` 和兼容 `deep-company-report.md` |
| Investment Banking | 并购、重组、定增、债务、交易条款、资产注入 | 重大事项公告、交易方案、财务模型 | `investment-banking-transaction-analysis.md` 或 `investment-banking-skipped.md` |

推荐顺序：

```text
company-research --deep --plugin-led
-> 主程序生成 evidence-pack / financials / document-extract / business-breakdown / financial-model-v2
-> Data Analytics 做模型和证据质控
-> Public Equity Investing 生成主报告
-> 有并购/重组/融资时，Investment Banking 参与
-> 主程序生成 publish-readiness 和 wiki-change-candidates
```

常用口令：

```text
@data-analytics 检查这次 plugin-led 的 financial-model-v2.xlsx、evidence-pack.json 和 business-breakdown.json，找公式、口径、缺口和异常值。
@public-equity-investing 基于 plugin-led-input.json 和 data-analytics-model-analysis.md，直接生成公司主报告、买方 thesis、催化剂、证伪信号和退出条件。
@investment-banking 基于这份重大资产重组公告和 plugin-led-input.json，拆交易条款、估值、稀释、业绩承诺和对股价 thesis 的影响。
```

回退和对照：

- `--plugin-review` / `--plugin-optimize` 保留为旧链路对照。
- company deep research skill 默认启用 `--plugin-led`。
- 设置 `PLUGIN_LED=0` 可回到旧 review/optimize 链路。
- `publish-readiness.json` blocked 时不能伪造 ready，仍需补证或人工审核。

完整边界见 [`docs/专业插件能力层集成说明.md`](专业插件能力层集成说明.md)。

## 9. Brain 记忆

### 9.1 记住纠错和规则

```sh
npm run codex:ingest -- brain remember \
  --type correction \
  --text "量价验证不能只看龙头股，必须检查细分候选池。"
```

类型：

| type | 用途 |
|---|---|
| `correction` | 纠错、反复犯错的地方 |
| `preference` | 你的偏好和研究风格 |
| `guardrail` | 硬规则 |
| `thread` | 长期跟踪的问题 |

### 9.2 查看状态

```sh
npm run codex:ingest -- brain status
```

### 9.3 关闭记忆

```sh
npm run codex:ingest -- brain resolve \
  --id <memory-id> \
  --result success
```

意义：

- 这是系统的长期纠错层。
- 写入 `data/brain/*.jsonl`。

## 10. Daily Loop

盘前：

```sh
npm run codex:ingest -- daily-loop \
  --mode premarket \
  --write
```

盘后：

```sh
npm run codex:ingest -- daily-loop \
  --mode postclose \
  --validate-pending-only \
  --write
```

只看上下文：

```sh
npm run codex:ingest -- daily-loop \
  --mode premarket \
  --show-context
```

意义：

- 盘前生成问题、预测和研究计划。
- 盘后验证 pending prediction。
- 写入范围受控：
  - `data/brain/predictions.jsonl`
  - `data/brain/validations.jsonl`
  - `.llm-wiki/daily-research/**`
  - `.llm-wiki/wiki-feedback/**`

## 11. Self-Question 递归问题链

### 11.1 生成自提问

```sh
npm run codex:ingest -- self-question \
  --question-count 3
```

写入：

```sh
npm run codex:ingest -- self-question \
  --question-count 3 \
  --write
```

意义：

- 让系统生成下一轮可验证问题。
- 写入 `data/brain/questions.jsonl`。

### 11.2 验证问题

```sh
npm run codex:ingest -- self-question validate \
  --max-questions 6 \
  --validation-windows 1,3,5,10,20
```

写入：

```sh
npm run codex:ingest -- self-question validate \
  --max-questions 6 \
  --write
```

意义：

- 把自提问转成市场反馈验证。
- 写入 `data/brain/validations.jsonl`。

### 11.3 归因

```sh
npm run codex:ingest -- self-question attribute \
  --max-validations 20
```

写入：

```sh
npm run codex:ingest -- self-question attribute \
  --max-validations 20 \
  --write
```

归因类型一般包括：

| 结果 | 含义 |
|---|---|
| `confirmed` | 证据和市场反馈支持 |
| `price_only` | 只有量价，基本面证据缺口未闭合 |
| `divergent` | 市场和 thesis 分歧 |
| `disconfirmed` | 被证伪 |
| `insufficient` | 证据不足 |

### 11.4 证据任务

生成补证任务：

```sh
npm run codex:ingest -- self-question evidence \
  --max-tasks 100 \
  --write
```

完成补证任务：

```sh
npm run codex:ingest -- self-question evidence resolve \
  --task-id <task-id> \
  --result confirmed \
  --source-refs "cninfo:公告,qcc:招投标" \
  --summary "已确认订单/公告/招投标证据" \
  --write
```

意义：

- 把 `price_only` 变成可执行补证清单。
- evidence task 写 `.llm-wiki/evidence-tasks/**`。
- evidence result 写 `data/brain/evidence_results.jsonl`。

## 12. Self-Question Policy 和回归

### 12.1 生成 policy proposal

```sh
npm run codex:ingest -- self-question policy \
  --min-occurrences 2
```

写入：

```sh
npm run codex:ingest -- self-question policy \
  --min-occurrences 2 \
  --write
```

产物：

```text
.llm-wiki/policy-proposals/**
```

意义：

- 从重复出现的归因缺口里生成待审核规则。
- 只是 proposed，不自动激活。

### 12.2 审核 policy

批准：

```sh
npm run codex:ingest -- self-question policy approve \
  --policy-id <proposal-policy-id> \
  --proposal <policy-proposals.json> \
  --reviewer jiegege \
  --note "同意作为下一轮补证规则" \
  --write
```

拒绝：

```sh
npm run codex:ingest -- self-question policy reject \
  --policy-id <proposal-policy-id> \
  --proposal <policy-proposals.json> \
  --reviewer jiegege \
  --note "证据不足" \
  --write
```

意义：

- 只有人工 approve 才进入 active policy。
- approve 写 `data/brain/policies.jsonl` 和 review event。

### 12.3 policy regression

生成回归用例：

```sh
npm run codex:ingest -- self-question policy regression \
  --max-policies 10 \
  --max-questions-per-policy 3 \
  --write
```

执行回归：

```sh
npm run codex:ingest -- self-question policy regression execute \
  --regression <policy-regressions.json> \
  --execute \
  --concurrency 3 \
  --timeout-ms 180000 \
  --write
```

生成反馈：

```sh
npm run codex:ingest -- self-question policy regression feedback \
  --execution <policy-regression-execution.json> \
  --write
```

生成修复建议：

```sh
npm run codex:ingest -- self-question policy regression remediation \
  --feedback <policy-regression-feedback.json> \
  --write
```

意义：

- 确认 active policy 真的改变了 ask/daily-loop/export 的行为。
- 失败只生成反馈和修复建议，不自动改系统。

## 13. Self-Train 和训练样本

### 13.1 查看自训练动作

```sh
npm run codex:ingest -- self-train actions \
  --status open \
  --limit 20
```

查看下一批：

```sh
npm run codex:ingest -- self-train next \
  --limit 5
```

意义：

- 看系统认为哪些错误、缺口、回归门控需要处理。
- 只读。

### 13.2 生成自训练计划

```sh
npm run codex:ingest -- self-train plan \
  --limit 5 \
  --write
```

查看计划：

```sh
npm run codex:ingest -- self-train plan list \
  --limit 20
```

校验计划：

```sh
npm run codex:ingest -- self-train plan verify \
  --limit 20
```

意义：

- 把 open action 转成非执行计划包。
- 写 `.llm-wiki/self-training-plans/**`。
- 不自动执行。

### 13.3 人工审核动作

普通审核：

```sh
npm run codex:ingest -- self-train review \
  --id <action-id> \
  --action resolve \
  --reviewer jiegege \
  --quality reviewed \
  --note "已人工确认" \
  --write
```

高置信审核必须带 evidence ref：

```sh
npm run codex:ingest -- self-train review \
  --id <action-id> \
  --action resolve \
  --reviewer jiegege \
  --quality high_confidence \
  --evidence-ref "cninfo:公告,qcc:招投标" \
  --write
```

意义：

- 防止未复核样本直接进入 high-confidence。
- high-confidence 是 Phase 5 前的重要门槛。

### 13.4 导出样本

```sh
npm run codex:ingest -- export-samples \
  --kind eval \
  --quality-gate review_required
```

导出高置信：

```sh
npm run codex:ingest -- export-samples \
  --kind eval \
  --quality-gate high_confidence
```

查看导出：

```sh
npm run codex:ingest -- export-samples list \
  --kind eval \
  --limit 20
```

校验导出：

```sh
npm run codex:ingest -- export-samples verify \
  --kind eval \
  --quality-gate review_required \
  --verify-concurrency 8
```

意义：

- 把 agent run、自提问、验证、归因、自训练事件转成 SFT、Preference、Eval 样本。
- 每批都有 manifest 和 ledger。

## 14. Trading Autoresearch Lite

这是当前 Phase 5A 的核心：让系统能从实验账本生成待审核策略建议，但不会自己改系统。

目标链路：

```text
深度问题
-> ask --agentic
-> agent-run manifest
-> experiment ledger
-> policy proposal
-> 人工审核
```

### 14.1 查看状态

```sh
npm run codex:ingest -- autoresearch status
```

输出重点：

| 字段 | 含义 |
|---|---|
| `status` | `not_started`、`program_ready`、`experiment_ledger_active` |
| `researchPrograms` | research program 数量 |
| `experiments` | ledger 实验数量 |
| `phase5Unlocks` | 固定 false，不解锁自动执行 |

### 14.2 创建 research program

dry-run：

```sh
npm run codex:ingest -- autoresearch program \
  --title "Trading Autoresearch Lite Bootstrap" \
  --hypothesis "用锁定评估器和实验账本，把深度问题升级为可复盘的策略改进闭环。" \
  --lanes "光纤链,PCB链,电源链,机器人链,存储链"
```

写入：

```sh
npm run codex:ingest -- autoresearch program \
  --title "Trading Autoresearch Lite Bootstrap" \
  --hypothesis "用锁定评估器和实验账本，把深度问题升级为可复盘的策略改进闭环。" \
  --lanes "光纤链,PCB链,电源链,机器人链,存储链" \
  --editable-artifacts prompt_template,self_question_program,segment_config,market_validator_params,evidence_task_priority,agent_role_weighting \
  --slug trading-autoresearch-lite-bootstrap \
  --write
```

产物：

```text
.llm-wiki/research-programs/<timestamp>-<slug>.json
.llm-wiki/research-programs/<timestamp>-<slug>.md
```

意义：

- 定义自然语言研究计划。
- 锁定评估器版本。
- 声明允许实验的低风险对象。
- 明确禁止 `wiki/`、`raw/`、真实交易。

### 14.3 打分

```sh
npm run codex:ingest -- autoresearch score \
  --market-feedback-score 3 \
  --evidence-closure-score 2 \
  --attribution-quality-score 1 \
  --novelty-score 1 \
  --leakage-penalty 1 \
  --complexity-penalty 1 \
  --hype-without-order-penalty 2
```

固定公式：

```text
market_feedback_score
+ evidence_closure_score
+ attribution_quality_score
+ novelty_score
- leakage_penalty
- complexity_penalty
- hype_without_order_penalty
```

意义：

- 评估标准固定，不能每次为了好看改分。
- 分数提升也只能进入 review，不会自动 high confidence。

### 14.4 写 experiment ledger

dry-run：

```sh
npm run codex:ingest -- autoresearch ledger append \
  --program-id autoresearch_program_xxx \
  --hypothesis "agentic ask 暴露候选池缺口" \
  --changed-artifact segment_config \
  --baseline-score 1 \
  --new-score 3 \
  --manifest .llm-wiki/agent-runs/<run-id>-ask/manifest.json
```

写入：

```sh
npm run codex:ingest -- autoresearch ledger append \
  --program-id autoresearch_program_xxx \
  --hypothesis "agentic ask 暴露候选池缺口" \
  --changed-artifact segment_config \
  --baseline-score 1 \
  --new-score 3 \
  --evidence-gaps "market_validation:segment_pool_missing:特种光纤|FAU光纤阵列|光纤光缆" \
  --manifest .llm-wiki/agent-runs/<run-id>-ask/manifest.json \
  --future-validation-date 2026-06-30 \
  --write
```

产物：

```text
.llm-wiki/experiments/experiment-ledger.jsonl
```

意义：

- 记录每次实验改了什么、为什么、分数变化、证据缺口和后续验证日期。
- `--manifest` 会校验 agent run / phase run / self-question loop manifest 是否存在。
- 写入后仍是 `review_required`，不自动应用。

### 14.5 生成 policy proposal

dry-run：

```sh
npm run codex:ingest -- autoresearch proposal \
  --min-score-delta 1 \
  --changed-artifacts segment_config,evidence_task_priority,market_validator_params
```

写入：

```sh
npm run codex:ingest -- autoresearch proposal \
  --min-score-delta 1 \
  --changed-artifacts segment_config,evidence_task_priority,market_validator_params \
  --write
```

兼容命令：

```sh
npm run codex:ingest -- autoresearch policy propose \
  --min-score-delta 1 \
  --changed-artifacts segment_config,evidence_task_priority \
  --write
```

产物：

```text
.llm-wiki/policy-proposals/<timestamp>-autoresearch-policy-proposals.json
.llm-wiki/policy-proposals/<timestamp>-autoresearch-policy-proposals.md
```

proposal 必含字段：

| 字段 | 含义 |
|---|---|
| `targetArtifact` | 建议改什么，如 `segment_config` |
| `rationale` | 为什么建议改 |
| `evidenceRefs` | 引用的 ledger、agent run、validation |
| `evidenceGaps` | 仍未闭合的证据缺口 |
| `riskLevel` | `low/medium/high` |
| `reviewStatus` | 固定 `review_required` |
| `autoApplyAllowed` | 固定 `false` |

意义：

- 这是 Phase 5A 的终点。
- 系统可以提出“应该怎么改”，但不能自己改。
- Phase 5B 的下一步不是自动应用配置，而是先维护 hypothesis pool。

## 15. Hypothesis Library V1

这是 Phase 5B 的核心：让系统维护“假设池”，而不是只回答一次性问题。

如果脚本要直接解析命令输出 JSON，建议使用 `npm --silent run codex:ingest -- ...`，避免 npm 的脚本 banner 混入 stdout。

目标链路：

```text
信息摄入
-> 假设生成/更新
-> 多智能体推演
-> 市场/财报/订单/公告验证
-> 实验账本
-> 策略改进建议
-> 人工审核
-> 自训练样本沉淀
```

### 15.1 创建假设

dry-run：

```sh
npm run codex:ingest -- hypothesis create \
  --title "CPO增速放缓可能推动MPO连接器量价齐升" \
  --theme "AI数据中心互联" \
  --segments MPO,CPO,高速连接器
```

写入：

```sh
npm run codex:ingest -- hypothesis create \
  --title "CPO增速放缓可能推动MPO连接器量价齐升" \
  --theme "AI数据中心互联" \
  --segments MPO,CPO,高速连接器 \
  --key-variables "MPO单柜用量,ASP变化,客户订单" \
  --risks "CPO渗透超预期,MPO竞争降价" \
  --next-validation-date 2026-07-15 \
  --write
```

产物：

```text
.llm-wiki/hypotheses/<hypothesis-id>.json
.llm-wiki/hypotheses/<hypothesis-id>.md
```

### 15.2 列出假设

```sh
npm run codex:ingest -- hypothesis list
npm run codex:ingest -- hypothesis list --segment MPO
npm run codex:ingest -- hypothesis list --status watching
npm run codex:ingest -- hypothesis list --theme "AI数据中心互联"
```

意义：

- 只读查看假设池。
- 可以按状态、主题、细分环节过滤。

### 15.3 生成假设报告

```sh
npm run codex:ingest -- hypothesis report --id <hypothesis-id>
```

写入审计报告：

```sh
npm run codex:ingest -- hypothesis report --id <hypothesis-id> --write
```

产物：

```text
.llm-wiki/hypothesis-reports/<timestamp>-<hypothesis-id>.json
.llm-wiki/hypothesis-reports/<timestamp>-<hypothesis-id>.md
```

报告会展示：

- 当前状态、主题、segments、conviction。
- evidence chain 和 market feedback。
- 订单、公告、财报、ASP 等证据缺口。
- lessons、errorType、policySuggestions，供后续 self-train 使用。

### 15.4 从文章更新假设

```sh
npm run codex:ingest -- hypothesis update-from-article \
  --source raw/研报新闻/example.md
```

写入事件：

```sh
npm run codex:ingest -- hypothesis update-from-article \
  --source raw/研报新闻/example.md \
  --write
```

产物：

```text
.llm-wiki/hypothesis-events/<hypothesis-id>.jsonl
```

规则：

- 命中已有假设时生成 event。
- 未命中时只输出 candidateHypotheses，不自动创建。
- event 记录 `sourceRef/sourceHash/evidenceDelta/confidenceImpact/evidenceGaps/sourceExcerpt`。

### 15.5 验证假设

```sh
npm run codex:ingest -- hypothesis validate \
  --id <hypothesis-id> \
  --window 20d
```

输出结果固定为：

```text
confirmed
divergent
disconfirmed
insufficient
priced_in
```

规则：

- 短期涨跌或放量不能单独判定 `confirmed`。
- `confirmed` 需要市场反馈和订单/公告/财报/ASP 等基本面证据同时存在。
- 结果带 `selfTrainingHooks`，后续可进入训练样本和人工审核流程。

### 15.6 Watchtower 事件路由

这是 Phase 5C 的核心：每天新增信息进入以后，系统扫描本地新增 source，命中已有假设，生成 event 和 alert。

dry-run：

```sh
npm run codex:ingest -- hypothesis watch \
  --since 1d \
  --sources gangtise,wechat,raw,agentic
```

小批量 LLM 复核：

```sh
npm run codex:ingest -- hypothesis watch \
  --since 30m \
  --sources wechat_incremental \
  --llm-review auto \
  --llm-review-max-items 8
```

写入：

```sh
npm run codex:ingest -- hypothesis watch \
  --since 1d \
  --sources gangtise,wechat,raw,agentic \
  --limit 100 \
  --write
```

扫描范围：

```text
raw/**
.llm-wiki/agent-runs/**
```

产物：

```text
.llm-wiki/hypothesis-events/<hypothesis-id>.jsonl
.llm-wiki/hypothesis-alerts/<date>.jsonl
```

规则：

- 只匹配已有 hypothesis，未命中时只输出 `candidateHypotheses`，不自动创建。
- 相同 `hypothesisId + sourceHash` 不重复写 event。
- alert 显示 `sourceRef/sourceHash/evidenceDelta/confidenceImpact/evidenceGaps`。
- 不写 `wiki/`、`raw/`、`data/facts/`、prompt、segment config、market validator 参数或真实交易动作。

### 15.7 查看 Alerts

```sh
npm run codex:ingest -- hypothesis alerts --status open
npm run codex:ingest -- hypothesis alerts --status all --min-alert-level important
```

alert level：

```text
info
watch
important
urgent
```

意义：

- `watch`：新增支持证据，或市场反馈先行但基本面闭环不足。
- `important`：订单、公告、财报、ASP、客户证据出现，或出现反证/背离。
- 带 `priced_in_risk` 的 alert 说明“市场先反应，但订单/公告/财报闭环还没闭合”。

### 15.8 Dashboard Data

```sh
npm run codex:ingest -- hypothesis dashboard-data
npm run codex:ingest -- hypothesis dashboard-data --write
```

写入：

```text
.llm-wiki/hypothesis-dashboard/latest.json
.llm-wiki/hypothesis-dashboard/latest.md
```

看板会汇总：

- 假设池总览。
- 今日触发。
- 重要提醒。
- 证据缺口。
- 叙事扩散但未闭环的假设。
- 接近 actionable 的假设。

## 16. Phase 状态命令

查看递归系统阶段：

```sh
npm run codex:ingest -- self-question phase-status
```

机器 gate：

```sh
npm run codex:ingest -- self-question phase-check
```

推进一个 gate，默认 dry-run：

```sh
npm run codex:ingest -- self-question phase-advance \
  --gate generate_self_questions
```

受控推进多个 gate：

```sh
npm run codex:ingest -- self-question phase-run \
  --max-gates 2 \
  --execute \
  --write
```

意义：

- `phase-status` 是总仪表盘。
- Phase 5 readiness 仍需要人工审核动作和 high-confidence 样本。
- Autoresearch readiness 单独展示，不会自动解锁 Phase 5。

## 17. 维护和治理

### 16.1 清理旧 ingest 报告

审计：

```sh
npm run codex:ingest -- hygiene audit \
  --keep-days 14
```

计划：

```sh
npm run codex:ingest -- hygiene plan \
  --keep-days 14
```

执行：

```sh
npm run codex:ingest -- hygiene apply \
  --keep-days 14 \
  --write
```

意义：

- 清理旧的成功 `.llm-wiki/codex-ingest` 报告。
- 只在 `--write` 下删除。

### 16.2 Temporal Facts 审计

```sh
npm run codex:ingest -- temporal-facts audit \
  --top-n 50 \
  --write
```

产物：

```text
.llm-wiki/temporal-facts/**
```

意义：

- 查 wiki 里有哪些可能需要时间状态的事实。
- 不直接改正式 facts。

### 16.3 概念治理

```sh
npm run codex:ingest -- concepts audit \
  --top-n 100 \
  --write
```

产物：

```text
.llm-wiki/concept-governance/**
```

意义：

- 找重复概念、别名冲突、父子概念和交易切片。
- 不自动合并页面。

## 18. 常见工作流

### 17.1 问一个深度投资问题

```sh
npm run codex:ingest -- ask \
  --agentic \
  --query "未来三年数据中心对光纤、连接器、PCB、CPO产业链的真实订单兑现路径，哪些细分环节最可能先出现财报验证？"
```

看结果：

```sh
sed -n '1,160p' /Users/jiegege/Desktop/杰杰杰/.llm-wiki/agent-runs/<run-id>-ask/final.md
```

### 17.2 把一次 agentic ask 变成实验

```sh
npm run codex:ingest -- autoresearch ledger append \
  --program-id autoresearch_program_xxx \
  --hypothesis "agentic ask 暴露细分候选池缺口" \
  --changed-artifact segment_config \
  --baseline-score 1 \
  --new-score 3 \
  --evidence-gaps "market_validation:segment_pool_missing:特种光纤|FAU光纤阵列|光纤光缆" \
  --manifest .llm-wiki/agent-runs/<run-id>-ask/manifest.json \
  --future-validation-date 2026-06-30 \
  --write
```

### 17.3 从实验账本生成待审核策略建议

```sh
npm run codex:ingest -- autoresearch proposal \
  --min-score-delta 1 \
  --changed-artifacts segment_config,evidence_task_priority,market_validator_params \
  --write
```

查看人读版：

```sh
sed -n '1,160p' /Users/jiegege/Desktop/杰杰杰/.llm-wiki/policy-proposals/<timestamp>-autoresearch-policy-proposals.md
```

### 17.4 摄入一篇新资料

```sh
npm run codex:ingest -- api-run \
  --provider codex \
  --source /path/to/new-source.md \
  --project /Users/jiegege/Desktop/杰杰杰
```

看审计：

```sh
open /Users/jiegege/Desktop/杰杰杰/.llm-wiki/codex-ingest/<run-id>/wiki-change-review.md
```

确认后：

```sh
npm run codex:ingest -- apply \
  --manifest /Users/jiegege/Desktop/杰杰杰/.llm-wiki/codex-ingest/<run-id>/changes.json \
  --write
```

### 17.5 做一次盘前/盘后闭环

盘前：

```sh
npm run codex:ingest -- daily-loop \
  --mode premarket \
  --write
```

盘后：

```sh
npm run codex:ingest -- daily-loop \
  --mode postclose \
  --validate-pending-only \
  --write
```

归因：

```sh
npm run codex:ingest -- self-question attribute \
  --max-validations 20 \
  --write
```

补证：

```sh
npm run codex:ingest -- self-question evidence \
  --write
```

## 19. 写入边界速查

| 命令 | 默认 | `--write` 后写哪里 |
|---|---|---|
| `ask` | 只读 | 不适用 |
| `ask --agentic` | 写 agent audit | `.llm-wiki/agent-runs/**`，可用 `--no-agent-artifacts` 关闭 |
| `ask eval` | 只读 | `.llm-wiki/eval/**` |
| `api-run` | staging | `.llm-wiki/codex-ingest/**` |
| `apply` | dry-run | `wiki/**`，只有 `apply --write` |
| `market-validate` | dry-run | `data/brain/validations.jsonl` |
| `company-research` | 写报告 | `.llm-wiki/company-research/**` |
| `daily-loop` | dry-run | `data/brain/**`、`.llm-wiki/daily-research/**`、`.llm-wiki/wiki-feedback/**` |
| `self-question` | dry-run | `data/brain/questions.jsonl` |
| `self-question validate` | dry-run | `data/brain/validations.jsonl` |
| `self-question attribute` | dry-run | `data/brain/attributions.jsonl` |
| `self-question evidence` | dry-run | `.llm-wiki/evidence-tasks/**` |
| `self-question evidence resolve` | dry-run | `data/brain/evidence_results.jsonl` |
| `self-question policy` | dry-run | `.llm-wiki/policy-proposals/**` |
| `self-train plan` | dry-run | `.llm-wiki/self-training-plans/**` |
| `export-samples` | 生成导出 | `.llm-wiki/exports/training/**` |
| `autoresearch program` | dry-run | `.llm-wiki/research-programs/**` |
| `autoresearch ledger append` | dry-run | `.llm-wiki/experiments/experiment-ledger.jsonl` |
| `autoresearch proposal` | dry-run | `.llm-wiki/policy-proposals/**` |
| `hypothesis create` | dry-run | `.llm-wiki/hypotheses/**` |
| `hypothesis update-from-article` | dry-run | `.llm-wiki/hypothesis-events/**` |
| `hypothesis report` | dry-run | `.llm-wiki/hypothesis-reports/**` |
| `hypothesis validate` | 只读 | 不适用 |
| `hypothesis watch` | dry-run | `.llm-wiki/hypothesis-events/**`、`.llm-wiki/hypothesis-alerts/**` |
| `hypothesis alerts` | 只读 | 不适用 |
| `hypothesis dashboard-data` | dry-run | `.llm-wiki/hypothesis-dashboard/**` |
| `hygiene apply` | dry-run | 删除旧 `.llm-wiki/codex-ingest/**` 成功报告 |
| `temporal-facts audit` | 只读 | `.llm-wiki/temporal-facts/**` |
| `concepts audit` | 只读 | `.llm-wiki/concept-governance/**` |

## 20. 你应该怎么用

如果只是问问题：

```sh
npm run codex:ingest -- ask --query "..." --show-sources
```

如果是复杂交易研究问题：

```sh
npm run codex:ingest -- ask --agentic --query "..."
```

如果问完之后发现系统应该改进：

```sh
npm run codex:ingest -- autoresearch ledger append ...
npm run codex:ingest -- autoresearch proposal --write
```

如果要把新资料正式入库：

```sh
npm run codex:ingest -- api-run --provider codex --source ...
npm run codex:ingest -- apply --manifest ... --write
```

如果要推进递归系统：

```sh
npm run codex:ingest -- self-question phase-status
npm run codex:ingest -- self-train actions --status open --limit 20
```

如果要做训练样本：

```sh
npm run codex:ingest -- export-samples --kind eval --quality-gate review_required
npm run codex:ingest -- export-samples verify --kind eval
```

## 21. 当前阶段建议

现在最适合的使用节奏是 Phase 5A：

```text
深度问题
-> ask --agentic
-> 读 final.md 和 manifest.json
-> autoresearch ledger append
-> autoresearch proposal --write
-> 人工审核 proposal
```

不要做：

- 不自动交易。
- 不自动改 prompt。
- 不自动改 segment config。
- 不自动写正式 `wiki/raw`。
- 不把 `review_required` 当成 high confidence。

下一阶段 Phase 5B 才考虑：

- 人工批准后应用低风险配置改动。
- 对低风险变更做 regression。
- 失败则回滚或生成 remediation。
