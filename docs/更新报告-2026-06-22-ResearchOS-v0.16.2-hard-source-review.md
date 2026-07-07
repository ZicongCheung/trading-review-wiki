# Research OS v0.16.2 硬源审计与主链增强更新报告

生成日期：2026-06-22
工作分支：`codex/research-os-agent-v016`
目标版本：`0.16.2`
目标主链：`main`

## 1. 版本定位

v0.16.2 是 v0.16 Research OS 多 Agent 主链的质量增强版。它不引入新的 orchestration runtime，也不把 LLM 嵌进应用内部自由执行；核心变化是把已有 `EvidenceResult -> Hypothesis -> Training Flywheel` 链路里最容易出错的“证据链接人工确认”做硬源分层和 dry-run 可审计化。

本版继续坚持：

- Codex 聊天窗口扮演 SupervisorAgent。
- 项目 CLI 负责 schema、固定 action、写入边界和 verify。
- 默认 dry-run，HumanGate 显式确认后才写。
- 自动写入仍限制在 `.llm-wiki/**`。
- 不写正式 `wiki/**`，不改旧 `raw/**`，不触发真实交易。
- LoRA-ready 只沉淀行为、技能、工具习惯和决策策略，不保存原始事实、价格行、交割单行或 API token。

## 2. 本版新增与优化

### 2.1 Hypothesis Evidence Link 队列进入 ResearchOS Agent 主流程

`research-os agent status/plan/review` 现在会把 `hypothesis_evidence_link_review` 作为当前最高优先级队列暴露出来。它解决的是：

```text
EvidenceTask / EvidenceResult 已经补到公告或行情证据
-> 但 EvidenceResult 还没有被人工链接到正确 Hypothesis
-> Hypothesis evidenceFeedback / Paper Trade Agent / Benchmark 不能继续吃到这条证据
```

当前 live 项目状态显示：

- `hypotheses=21`
- `hypothesisEvidenceFeedback=99`
- `hypothesisEvidenceTaskDrafts=20`
- `hypothesisEvidenceLinkDrafts=11`
- 当前 next agent：`HypothesisLinkAgent`
- 当前 blocker：`human_review_required`

### 2.2 硬源审计统一口径

新增共享 helper：`scripts/codex-ingest/internal/source-integrity.mjs`。

它把 sourceRefs/evidenceRefs 分成可操作的 review profile：

| Profile | 含义 | 默认动作 |
|---|---|---|
| `native_official_disclosure` | 原生 `cninfo/sse/szse:announcement#...` 公告 ref | 优先人工确认，可作为硬源 |
| `web_official_pdf` | 官方网站 PDF / 公告页面 | 可确认，但需人工看 PDF 指向 |
| `web_official_pdf_via_web_search` | Web/Tavily 发现的官方 PDF | 可作为线索，建议补原生公告 ref |
| `web_official_pdf_after_zero_result_tool_state` | 官方工具态零结果，但 Web 找到官方 PDF | 谨慎确认，记录检索缺口 |
| `positive_official_tool_state_only` | 官方工具态有正结果，但缺具体公告 ref | 需要补 sourceRefs |
| `structured_data_only` | 只有 Tushare/结构化数据 | 可做行情/财务验证，不能替代公告硬源 |
| `web_lead_only` | 普通 Web/Tavily 线索 | 不得直接升权 |
| `needs_source_refs` | 缺 sourceRefs/evidenceRefs | 不能进入 write-ready |

### 2.3 Review dry-run 直接输出 sourceIntegrity

`hypothesis evidence-link-review` 现在在 dry-run 和 link preview 中都输出：

- `status`
- `sourceProfile`
- `recommendedEvidenceAction`
- `officialSourceRefs`
- `nativeOfficialSourceRefs`
- `officialToolStateRefs`
- `zeroResultOfficialToolStateRefs`
- `tavilyUsed`
- `tushareRefCount`

真实 dry-run 样例显示，佰维存储样本可被识别为：

- `status=hard_source_present`
- `sourceProfile=native_official_disclosure`
- `sourceRefCount=14`
- `evidenceRefCount=14`
- `nativeOfficialSourceRefs` 包含 5 条 CNINFO 原生公告 ref
- `zeroResultOfficialToolStateRefs=[]`
- `wroteArtifacts=false`
- `humanGate.status=pending_human_gate`

这让人工处理 42 条 review queue 或后续 Hypothesis link queue 时，不用在长 sourceRefs 列表里手动辨别“这是公告硬源还是 Tavily 线索”。

### 2.4 训练飞轮主链当前状态

截至本版验证，live 项目训练飞轮已经不是空跑：

| 指标 | 当前值 | 解读 |
|---|---:|---|
| trajectories | 73 | 已有股票反馈轨迹 |
| reviewedTrajectories | 73 | 当前轨迹已全部 review |
| trainable | 29 | 可进入训练分流的样本 |
| Benchmark cases | 806 | Benchmark 已形成批次 |
| LoRA-ready candidates | 376 | 已有 PEFT-ready 候选 |
| confirmedCollectionResults | 2 | collection-result 已有确认样本 |
| executionResults | 22 | 真实执行结果 artifact |
| realTradeConfirmedProfitable | 2 | 真实盈利执行样本已确认 |
| paperTradeAgentWrittenCandidates | 12 | Paper Trade Agent 候选已写入 |
| evidenceTasks | 11 | Evidence Runner 已有任务 |
| evidenceResults | 11 | EvidenceResult 已有结果 |
| hypothesisEvidenceFeedback | 99 | Hypothesis feedback 已实际生成 |

样本结构也更健康：

- `expectation_trade=23`
- `fundamental_closure=25`
- `priced_in_risk=1`
- `disconfirmation=24`
- `pattern_execution_supported=4`
- `failed_expectation_negative=24`
- `execution_risk_negative=5`

## 3. 已闭合链路

### 3.1 Evidence Runner -> Hypothesis

已完成：

- EvidenceTask / EvidenceResult / EvidenceRun / DLQ schema。
- Tushare/Web/CNINFO 线索进入 EvidenceResult。
- Hypothesis evidenceFeedback 已生成 99 条。
- Hypothesis evidence-link review 队列已进入 ResearchOS Agent 调度。

仍需人审：

- 11 条 evidence-link draft 均为 low confidence mapping，需要 HumanGate。
- 20 条 evidence-task draft 中有 19 条低置信股票身份候选、1 条缺股票身份。

### 3.2 Hypothesis -> Paper Trade Agent

已完成：

- Paper Trade Agent 支持从 trajectory / hypothesis feedback 生成候选。
- `rule_baseline` 与 `llm_discretionary` 双轨。
- as-of 截断和 `evidenceCutoff.noFutureData=true`。
- 候选写入 `.llm-wiki/stock-feedback/paper-trade-agent/**`。

当前：

- `paperTradeAgentWrittenCandidates=12`
- `paperTradeClosed=1`
- `paperTradeProfitable=1`
- `llm_discretionary` 真实 record 仍未进入完整结算对照。

### 3.3 真实交易 execution-result -> Training Flywheel

已完成：

- 交割单、日复盘、position-tracking、Tushare 市场路径交叉验证。
- `executionResults=22`
- `realTradeConfirmedProfitable=2`
- 紫光国微等真实收益样本已可进入更高权重。
- 半仓/分批/持仓快照样本已降级，不误当 realized PnL。

当前剩余：

- `executionResultsNeedsReconciliation=17` 已复核为非行动项或低权重，但仍保留 reconciliation 状态作为审计边界。

### 3.4 Review -> Benchmark -> LoRA-ready

已完成：

- 轨迹 review 已覆盖 73 条。
- Benchmark batches 已到 11。
- LoRA-ready batches 已到 16。
- PEFT 边界已在 verify 中持续检查。

## 4. 未闭合与下一步

### 4.1 Hypothesis evidence-link 人审尚未写入

当前最高优先级仍是 `HypothesisLinkAgent`：

```sh
npm --silent run codex:ingest -- research-os agent review --project /Users/jiegege/Desktop/杰杰杰
```

下一步建议先处理 `native_official_disclosure` profile 的样本，再处理 Web PDF/Tavily 线索。

### 4.2 EvidenceTask draft 股票身份需要确认

低置信股票身份候选不能自动写入正式 EvidenceTask。正确做法：

- 优先人工提供 `--stock-code` / `--stock-name`。
- 只有二次确认才允许 `--confirm-low-confidence-candidate true`。

### 4.3 CNINFO/交易所硬源仍需继续加深

本版已经把硬源质量审计打通，但下一步还应补：

- `data-source cninfo search/download/extract`
- SSE/SZSE announcement search/download
- official PDF -> native announcement id 反查
- 官方工具态 zero-result 的 query repair
- source cache / retry / rate-limit audit

### 4.4 LLM discretionary paper trade 还缺真实对照闭环

Paper Trade Agent 候选已经写入，但 LLM 自主模拟交易还没有形成完整：

```text
候选 -> record llm_discretionary -> settle -> 与 rule_baseline 对照 -> attribution -> Benchmark / LoRA-ready
```

本阶段不把 paper trade 当真实收益。

## 5. 验证结果

本版提交前运行：

- `npx vitest run scripts/codex-ingest-research-os-agent.test.mjs scripts/codex-ingest-hypothesis-engine.test.mjs scripts/codex-ingest-stock-feedback-paper-trade.test.mjs --testTimeout 60000`：`69 passed`
- `npx vitest run scripts/codex-ingest-lib.test.mjs --testTimeout 60000`：`262 passed`
- `npm --silent run codex:ingest -- stock-feedback verify --project /Users/jiegege/Desktop/杰杰杰`：`status=ok`
- `npm --silent run codex:ingest -- hypothesis verify --project /Users/jiegege/Desktop/杰杰杰`：`status=ok`
- `npm --silent run codex:ingest -- research-os agent verify --project /Users/jiegege/Desktop/杰杰杰`：`status=ok`
- `npm run build`：通过，仅保留既有 Vite dynamic import / chunk size warning
- `git diff --check`：通过

合并主链前需在版本/文档提交后再跑一次验证包。

## 6. 合并建议

可以并入 `main`，理由：

- 核心写入边界未扩大。
- 没有引入真实交易动作。
- 没有引入新的自由 shell executor。
- 没有把 token、原始公告正文、价格明细或交割单行写入 LoRA-ready。
- v0.16.2 的核心变更是 review 质量增强，不会自动改变 Hypothesis 状态或训练权重。

合并后下一阶段建议：

1. 先处理 `native_official_disclosure` evidence-link HumanGate。
2. 补 `data-source cninfo` 原生公告检索/下载/抽取 CLI。
3. 用已写入的 Paper Trade Agent candidates 跑 `llm_discretionary` record/settle 对照。
4. 把 ResearchOS Agent review 队列接到 v0.17 可视化操作台。
