# Trading Review Wiki 功能全景与演进路线

生成日期：2026-06-22
扫描范围：当前仓库 `/Users/jiegege/Downloads/trading-review-wiki-0.10.311`，版本 `0.16.2`，分支 `codex/research-os-agent-v016`

## 0. 一句话定位

Trading Review Wiki 当前已经从一个桌面 Markdown/Wiki 工具，演进成一套面向交易研究的本地 AI 操作系统：

```text
raw 原始资料
-> wiki 正式知识页
-> graph / facts / brain / SQL 多源检索
-> ask / agentic ask / deep-research / daily-loop / company-research
-> hypothesis / Watchtower / Research Cockpit / Training Flywheel
-> self-question / stock-feedback / paper-trade / benchmark / export-samples
-> research-os agent / HumanGate / source-integrity hard-source review
-> 人工审核后的策略、样本、假设和研究体系迭代
```

它的核心价值不是“让模型直接给股票答案”，而是把信息、假设、证据、反证、市场反馈、人工审核和训练样本放进一条可追溯、可回滚、可审计的链路。

## 0.1 当前进度快照：v0.16.2

从 v0.12.1 到 v0.16.2，系统已经从“训练飞轮 V2 雏形”推进到 “Research OS 多 Agent 后端闭环”：

```text
self-question / raw review / hypothesis / real execution / paper trade
-> EvidenceTask / EvidenceResult
-> Hypothesis evidenceFeedback / evidence-link HumanGate
-> Paper Trade Agent candidates
-> execution-result / paper-trade settlement
-> stock-feedback trajectory
-> review 升权或降权
-> Benchmark
-> LoRA-ready curriculum
```

当前 live 项目关键数字：

| 指标 | 当前值 | 含义 |
|---|---:|---|
| trajectories | 73 | 已形成可追踪股票反馈轨迹 |
| reviewedTrajectories | 73 | 当前轨迹已完成 review 分流 |
| trainable | 29 | 可进入训练分流的样本 |
| Benchmark cases | 806 | Benchmark 已成批次，不再是空壳 |
| LoRA-ready candidates | 376 | 已生成 PEFT-ready 候选 |
| realTradeConfirmedProfitable | 2 | 已确认真实盈利执行样本 |
| paperTradeAgentWrittenCandidates | 12 | Paper Trade Agent 候选已写入 |
| hypothesisEvidenceFeedback | 99 | EvidenceResult 已真实回流 Hypothesis |
| hypothesisEvidenceLinkDrafts | 11 | 当前最高优先级 HumanGate 队列 |
| evidenceTasks / evidenceResults | 11 / 11 | Evidence Runner 已有真实任务和结果 |

当前还没有放开的能力：

- 不自动交易。
- 不把 paper trade 当真实收益。
- 不把原始公告、价格行、交割单行写入 LoRA-ready。
- 不让低置信 Hypothesis / 股票身份映射自动写入。
- 不让 Tavily/Web 线索替代 CNINFO/交易所公告等硬源。

## 1. 扫描依据

本报告来自对以下入口的静态扫描和交叉核对：

| 依据 | 代表路径 | 用途 |
|---|---|---|
| 包配置 | `package.json` | 版本、脚本、依赖、Tauri/React/CLI 技术栈 |
| CLI help | `scripts/codex-ingest/cli/help.mjs` | 对外命令面、参数、写入边界 |
| CLI router | `scripts/codex-ingest/cli/index.mjs` | 顶层 handler、真实命令调度 |
| 核心实现 | `scripts/codex-ingest/internal/*.mjs` | ask、ingest、brain、hypothesis、company-research、data-source、stock-feedback、deep-research 等实现 |
| Deep Research CLI | `scripts/codex-ingest/deep-research/**`、`src/lib/deep-research.ts`、`src/components/layout/research-panel.tsx` | 复刻应用端 Deep Research 面板的 CLI：web 检索 + 本地 ask 证据 + 审核后写入 |
| Evidence Runner | `scripts/codex-ingest/internal/stock-feedback.mjs` | EvidenceTask / EvidenceResult / EvidenceRun / DLQ 与补证质量门 |
| Hypothesis Engine | `scripts/codex-ingest/internal/hypothesis.mjs` | Hypothesis quality gate、evidenceFeedback、evidence-link review、post-mortem |
| 训练飞轮 | `scripts/codex-ingest/internal/stock-feedback.mjs`、`src/components/training/training-flywheel-view.tsx` | 股票反馈轨迹、Benchmark、人审、paper trade、execution-result 和 LoRA-ready 数据面 |
| Research OS Agent | `scripts/codex-ingest/internal/research-os-agent.mjs`、`scripts/codex-ingest/internal/source-integrity.mjs` | Codex-supervised 多 Agent status/plan/review/step/verify 和硬源审计 |
| 桌面桥接 | `src/commands/research-cockpit.ts`、`src-tauri/src/commands/research_cockpit.rs` | Research Cockpit 前端到本地 CLI 的安全白名单执行 |
| 前端 UI | `src/components/**` | Wiki、Sources、Search、Graph、Dashboard、Research Cockpit 等视图 |
| 测试 | `scripts/codex-ingest-lib.test.mjs`、`src/lib/__tests__/**` | 写入边界、闭环能力、错误降级和回归覆盖 |
| 文档 | `README.md`、`README_CN.md`、`docs/*.md` | 已沉淀的操作手册、RAG 说明、递归路线、插件说明 |

## 2. 系统边界和目录职责

### 2.1 核心目录

| 路径 | 角色 | 当前原则 |
|---|---|---|
| 本仓库 | CLI、Tauri 桌面端、脚本和文档源码 | 开发、测试、发布工具本身 |
| live wiki 工作区 | 用户真实交易研究语料 | `raw/`、`wiki/`、`data/brain/`、`data/facts/` 的真实数据所在地 |
| `raw/**` | 原始资料层 | 原则上只追加，不由 ingest/apply 自动改写 |
| `wiki/**` | 正式知识层 | 只能通过 `apply --write` 或明确人工操作进入正式层 |
| `data/facts/**` | 时序事实账本 | 记录会变化、会失效、会被替代或证伪的事实 |
| `data/brain/**` | 长期记忆和递归学习账本 | 记录纠错、预测、验证、policy、self-training event |
| `.llm-wiki/**` | 审计、staging、候选、临时产物 | 大多数自动化先落在这里，默认不污染正式 wiki/raw |

### 2.2 写入纪律

系统的工程核心是“所有自动化先留痕，正式写入有门”：

- `ask` 默认只读。
- `apply --write` 是正式 `wiki/**` 写入入口。
- `raw/**` 不被 ingest/apply 改写。
- `company-research` 只写 `.llm-wiki/company-research/**`，不直接写正式 wiki。
- `hypothesis`、`Watchtower`、`Research Cockpit` 当前默认写 `.llm-wiki/**`，不自动写正式 wiki/raw 或真实交易动作。
- `deep-research` 默认写 `.llm-wiki/deep-research/**`；只有 `--write` 才保存审核后的 `wiki/queries/**` 页面，`--ingest/--apply-ingest` 才进入 staged ingest 或正式 apply。
- `stock-feedback` 默认 dry-run；`--write` 只写 `.llm-wiki/stock-feedback/**`。`paper-trade` 强制 `ledgerKind=paper_trade`，不能冒充真实交易账本。
- `self-question`、`self-train`、`policy regression` 等递归能力默认 dry-run 或只写审计/brain 账本。
- 自动交易明确不在当前边界内。

## 3. 技术架构总览

### 3.1 程序层

| 层 | 主要技术 | 说明 |
|---|---|---|
| CLI 层 | Node.js ESM | `npm run codex:ingest -- ...` 是稳定入口 |
| CLI 模块层 | `scripts/codex-ingest/**` | `core / ask / brain / ingest / company-research / data-source / stock-feedback / deep-research / governance / convert-source / cli` |
| 桌面层 | Tauri v2 + Rust | 本地文件、命令、HTTP、vectorstore、Research Cockpit 白名单 runner |
| 前端层 | React 19 + TypeScript + Vite | Wiki 编辑、Sources、Search、Graph、Dashboard、Research Cockpit |
| 图谱和搜索 | graphology、sigma、LanceDB 可选 | 关键词、frontmatter、图谱、可选向量增强 |
| 可视化 | Recharts、sigma.js | 交易统计、图谱、驾驶舱指标 |
| 文档和表格 | xlsx、Markdown、MarkItDown/OCR | 多格式资料转换、公司模型 workbook |

### 3.2 CLI handler map

当前 `COMMAND_HANDLERS` 顶层命令包括：

```text
api-run, apply, ask/query, autoresearch, brain, company-research,
concepts, convert-source, daily-loop, data-source, deep-research, export-samples,
finalize, hygiene, hypothesis, market-validate, prepare, research-os,
self-question, self-train, stock-feedback, temporal-facts
```

仓库 `package.json` 额外提供：

| npm script | 作用 |
|---|---|
| `npm run codex:ingest` | 统一 CLI 入口 |
| `npm run gangtise:meeting-clues` | Gangtise 投研线索 Markdown 导出 |
| `npm run machine:preflight` | 双机角色/环境预检查 |
| `npm run machine:snapshot` | live corpus 快照同步 |
| `npm run dev/build/test/verify` | 前端和 CLI 工程验证 |
| `npm run tauri` | 桌面端开发/构建入口 |

## 4. 功能全景

### 4.1 多格式资料转换：`convert-source`

**解决的问题**：PDF、DOCX、XLSX、PPTX 等资料不能直接进入 Markdown ingest，需要先转换成可审阅文本。

**核心能力**：

- 调用 MarkItDown 生成 Markdown sidecar。
- PDF 无文本层时可回退 macOS Vision OCR。
- 保留源文件 hash、转换说明、OCR 页数等 trace metadata。
- 默认把 sidecar 写在源文件旁，例如 `report.pdf -> report.markitdown.md`。

**适用点**：

- 年报、纪要、路演 PDF 转 ingest。
- PPT 或 Excel 摘要转知识库资料。
- 公司深研前的原始材料准备。

**成熟度**：已可用。测试覆盖空 PDF、OCR fallback、禁止覆盖、缺二进制提示等边界。

**缺口**：

- OCR 质量仍需人工抽查。
- 对复杂表格的结构化理解仍更适合进入公司深研/financial model extractor，而不是普通 Markdown sidecar。

### 4.2 App-grade 知识摄入：`prepare -> api-run -> finalize -> apply`

**解决的问题**：把 raw 资料转成正式 wiki 页面，但不能让模型直接越权写入。

**核心链路**：

```text
prepare
-> api-run
-> finalize
-> apply dry-run
-> apply --write
```

**核心能力**：

- `prepare` 建立 source context、候选页面、schema、方法论预读。
- `api-run` 调 Codex/OpenAI 生成 staged artifacts：`analysis.md`、`plan.json`、`files/**`、`changes.json`。
- 支持大 WeChat 舆情资料 sharding 和 source mainline index。
- `finalize` 可在 FILE block 已存在时恢复并重建 manifest/dry-run。
- `apply` 默认 dry-run，只有 `apply --write` 才写正式 `wiki/**` 和 `data/facts/temporal_edges.jsonl`。
- 对 collision、legacy log、异常 shrink、非法 factWrites 等做防护。

**适用点**：

- 每日复盘、微信舆情、Gangtise 会议纪要、研报新闻入库。
- 从临时资料形成正式知识页。
- 需要可审阅 manifest 和 rollback 线索的生产写入。

**成熟度**：核心闭环已成型，是当前最成熟的正式写入链路。

**缺口**：

- 长资料拆分仍依赖 prompt/segment 质量。
- 高价值事实的结构化抽取需要更多 domain-specific extractor。
- 对批量 raw 目录的队列化 ingest 主要依赖外部 skill/脚本，主 CLI 的 batch orchestration 还可加强。

### 4.3 多源 RAG 问答：`ask`

**解决的问题**：交易研究问题需要同时看正式知识、原始资料、图谱、时序事实、长期记忆和行情数据。

**核心数据源**：

| source | 说明 |
|---|---|
| `wiki` | 正式知识页，优先使用 frontmatter、标题、tags、sources、updated |
| `raw` | 原始资料，带日期、新鲜度和噪声控制 |
| `graph` | wikilink、related、source overlap 等图谱扩展 |
| `facts` | `data/facts/temporal_edges.jsonl` 当前有效时序事实 |
| `brain` | 纠错、偏好、预测、验证和 active policy guardrail |
| `stock-price` | 本地股票日线 SQL 和市场验证 |

**输出要求**：

```text
结论
证据链
分歧/反证
后续验证
交易含义
引用来源
```

**关键能力**：

- `--show-sources` 输出 source routing/native query JSON。
- `--show-context` 输出完整检索上下文。
- `--include-invalidated` 可审计失效/被证伪事实。
- `--sources` 可强制源组合。
- `--profile local-max` 可提升本地强机的有界并发默认值。

**适用点**：

- 日常“这个主题最近怎么变了”。
- 追问“哪些证据后来被证伪”。
- 叙事和量价同屏验证。
- 外部系统用 JSON context 做证据展示。

**成熟度**：只读问答闭环成熟，诊断能力强。

**缺口**：

- 向量检索当前是增强层，不是主真相源，LanceDB stale 时不会影响主检索但语义召回会弱。
- 股票名/代码映射失败时仍需要用户显式给代码。
- source routing 若走 LLM，会增加延迟和不确定性。

### 4.4 多智能体问答：`ask --agentic`

**解决的问题**：复杂投资问题不能只靠单次回答，需要支持证据、反证、市场验证和策略视角并行。

**角色分工**：

- evidence researcher：找支持证据。
- counterevidence auditor：找反证和过度外推。
- market validator：看 SQL、量价、候选池。
- trading strategist：转成交易框架和风险边界。
- adjudicator：综合成功 agent 输出，回到 ask 六章节结构。

**产物**：

- 默认写 `.llm-wiki/agent-runs/<timestamp>-ask/**`。
- manifest 记录 roles、sourceRefs、timing、model、失败/成功状态。
- `--no-agent-artifacts` 可关闭审计产物。

**适用点**：

- “订单兑现还是叙事扩散”。
- “某产业链哪个细分被市场确认”。
- “当前证据够不够进入观察/试错”。
- 作为 autoresearch experiment 的输入。

**成熟度**：研究增强闭环已可用，但还不是自动策略闭环。

**缺口**：

- agentic run 需要人工读结果并决定是否进入 ledger。
- 失败 agent 的降级策略已有，但最终答案质量仍依赖上下文和 provider 稳定性。
- 尚未完全自动串入 hypothesis lifecycle 和 policy proposal 的端到端产品工作流。

### 4.5 检索质量评估：`ask eval`

**解决的问题**：每次改检索策略或大批量入库后，需要知道关键页面还能不能被召回。

**核心能力**：

- 评估 recall、relevance、source coverage、raw noise、structure。
- 默认只读，`--write` 时写 `.llm-wiki/eval/*.json`。
- 支持 `--expect-paths` 对关键路径做回归。

**适用点**：

- 检索策略调整前后对比。
- 大规模 ingest 后验收召回质量。
- 外部系统 CI/自动化门禁。

**成熟度**：可用，但还需要项目级 eval case 库沉淀。

### 4.6 Temporal Facts v1：`temporal-facts` + `factWrites`

**解决的问题**：交易知识里很多事实会过期、被替代、被反证，不能只写静态 wiki 页面。

**核心能力**：

- 事实账本：`data/facts/temporal_edges.jsonl`。
- `apply --write` 可从 manifest 追加 factWrites。
- 新事实可 supersede 老事实。
- ask 默认只读 active/current facts。
- `--include-invalidated` 用于历史审计。
- `temporal-facts audit` 可扫描 predicate、alias、tag、缩写候选。

**适用点**：

- 涨价、订单、客户、产能、交付、收入确认、验证信号。
- 追溯“当时相信什么，后来为什么失效”。
- 防止旧事实在问答中继续误导。

**成熟度**：核心账本和审计已成型。

**缺口**：

- predicate 词表和事实抽取需要持续扩充。
- 事实图谱/可视化和人工复核 UI 还可以产品化。

### 4.7 概念治理：`concepts audit`

**解决的问题**：长期 wiki 会出现概念重复、别名冲突、父子关系混乱、交易切片和产业概念混在一起。

**核心能力**：

- 扫描 `wiki/概念/**/*.md`。
- 发现 duplicate titles、alias-title conflicts、containment pairs。
- 读 `data/concepts/canonical_rulings.json` 作为人工裁决。
- 默认只读，`--write` 时写 `.llm-wiki/concept-governance/**`。

**适用点**：

- 大批量摄入后治理概念页。
- 防止同义概念分裂影响检索。
- 给 ingest 路由提供 canonical hint。

**成熟度**：审计可用，自动治理谨慎。

**缺口**：

- 高置信 sameAs 的自动路由已有基础，但合并/重命名仍应保持人工审核。
- 缺少图形化 review queue。

### 4.8 Brain Memory：`brain`

**解决的问题**：用户纠错、偏好、guardrail、失败案例要能长期影响后续问答，而不是每次重新提醒。

**命令**：

| 命令 | 用途 |
|---|---|
| `brain remember` | 写入 correction/thread/preference/guardrail |
| `brain status` | 查看 brain 文件、预测、验证等状态 |
| `brain resolve` | 记录某条记忆的 success/failure/uncertain 结果 |

**适用点**：

- “以后不要再把情绪催化当订单兑现”。
- “这个用户偏好先看反证再看机会”。
- “某次预测失败，需要在后续回答降置信”。

**成熟度**：基础记忆闭环已可用。

**缺口**：

- 记忆过期、冲突和权重衰减还需要更强治理。
- UI 侧的 brain review/resolve 还可以更直观。

### 4.9 市场验证：`market-validate` 与 stock SQL

**解决的问题**：研究结论需要被市场反馈验证，至少要看价格、成交额、相对强弱、窗口表现。

**核心能力**：

- 从本地私有 SQL 配置读取股票日线。
- 支持 stock name/code 映射。
- 对预测做窗口验证。
- 可选外部 kline cross-check。
- `--write` 时写 `data/brain/validations.jsonl`。

**适用点**：

- 验证“某催化后 20 日是否被市场确认”。
- 辅助 daily-loop pending prediction。
- 给 agentic ask 的 market validator 提供证据。

**成熟度**：核心可用。

**缺口**：

- ticker grounding 对新股、简称、港股/美股等仍需增强。
- SQL schema 差异和本地凭证注入需要部署规范。

### 4.10 Daily Loop：`daily-loop`

**解决的问题**：每天盘前生成问题/预测，盘后验证 pending prediction，把市场反馈写回 brain。

**核心能力**：

- `--mode premarket|postclose|full`。
- 支持 `--validate-pending-only`，盘后只验证已有 pending。
- LLM planner 先生成问题，规则模板只做 fallback。
- 写入范围限制在 `data/brain/**`、`.llm-wiki/daily-research/**`、`.llm-wiki/wiki-feedback/**`。
- active policy 会进入问题规划和答案审计。

**适用点**：

- 每日盘前研究问题池。
- 盘后自动验证过去预测。
- 从失败/price_only 反馈进入 self-train。

**成熟度**：可用，但强依赖数据新鲜度和问题新颖性。

**缺口**：

- 问题去重已经有测试覆盖，但真实日常运行仍需要持续观察。
- 与持仓、交易计划、人工复盘产物的闭环仍主要靠外部流程。

### 4.11 Self-Question 递归问题链：`self-question`

**解决的问题**：让系统自己提出可验证问题，再经过市场验证、归因、补证、policy、回归和样本导出。

**核心阶段**：

```text
generate
-> validate
-> attribute
-> evidence
-> policy
-> policy-regression
-> policy-regression-execute
-> policy-regression-feedback
-> policy-regression-remediation
-> policy-regression-patches
-> policy-regression-apply
-> policy-regression-verify
-> gate-event
-> self-train
-> self-train-plan
-> export
-> export-verify
```

**关键命令**：

| 命令 | 作用 |
|---|---|
| `self-question` | 生成 `self-question-v1` |
| `self-question validate` | 生成市场反馈验证 |
| `self-question attribute` | 归因 confirmed/price_only/divergent/disconfirmed/insufficient |
| `self-question evidence` | 从 price_only 归因生成补证任务 |
| `self-question evidence resolve` | 记录补证结果 |
| `self-question policy` | 从重复 gap 生成 policy proposal |
| `self-question policy regression` | active policy 转回归用例 |
| `self-question loop` | 编排上述阶段并写 run manifest |
| `self-question phase-status/check/advance/run` | Phase 5 readiness 和 gate 编排 |

**适用点**：

- 让系统把“回答错在哪里”变成可验证任务。
- 把重复失败转成 guardrail/policy。
- 为训练样本导出提供结构化来源。

**成熟度**：工程骨架很完整，审计链强，但业务上还处于 Phase 5：AI 提建议，不自动应用核心改动。

**缺口**：

- Evidence Runner 主干已可用，但 self-question evidence 到正式 EvidenceTask / EvidenceResult 的 handoff 仍需更顺。
- policy patch apply 仍是受控手动动作，不应自动化越权。
- 需要真实长期运行数据来校验收益，而不仅是测试用例通过。

### 4.12 Self-Train 与训练样本：`self-train`、`export-samples`

**解决的问题**：把验证、归因、agent run、review event 转成可审计训练样本，而不是直接把模型回答当训练数据。

**核心能力**：

- `self-train` 从 validations、attributions、gate events 生成动作建议。
- `self-train actions/next` 只读列出待处理动作。
- `self-train plan --write` 写非执行计划包 `.llm-wiki/self-training-plans/**`。
- `self-train review` 记录 approve/reject/resolve。
- `export-samples --kind sft|preference|eval` 导出训练样本。
- `export-samples list/verify` 管理和校验 export ledger。
- quality gate 支持 `all / eligible / needs_evidence / review_required / negative_sample / high_confidence` 等。

**适用点**：

- 沉淀失败样本、反证样本、验证样本。
- 训练前审计数据来源和质量门槛。
- 把 agentic ask、self-question、policy regression 结果转 eval 样本。

**成熟度**：导出和审计链已可用。

**缺口**：

- high-confidence 样本必须依赖人工复核和证据补齐，不能规模化偷跑。
- 训练执行本身不在当前 CLI 内，需要独立训练/评测管线。

### 4.13 Trading Autoresearch Lite：`autoresearch`

**解决的问题**：把一次研究问题、agentic answer、市场反馈和改进建议纳入实验账本。

**核心能力**：

- `autoresearch program` 创建 research program。
- `autoresearch score` 使用 locked evaluator 评分。
- `autoresearch ledger append` 追加 experiment ledger。
- `autoresearch ledger/status` 查看实验和 readiness。
- `autoresearch proposal` 生成 review-gated policy proposal。
- 写入范围是 `.llm-wiki/research-programs/**`、`.llm-wiki/experiments/**`、`.llm-wiki/policy-proposals/**`。

**适用点**：

- 每次深度问题后记录：基线、改动、分数变化、证据缺口。
- 发现哪些 prompt、segment、validator 参数需要调整。
- 进入 Phase 5/6 的 policy proposal 池。

**成熟度**：Phase 5A 可用。

**缺口**：

- proposal 到 patch candidate、回归、应用、回滚还需要更完整产品化。
- 真实 program lane 需要持续运行样本，不是单次演示。

### 4.14 Hypothesis Library 与 Watchtower：`hypothesis`

**解决的问题**：系统需要以“投资假设”为核心管理信息流，而不是只做资料库或问答。

**对象和目录**：

| 对象 | 目录 |
|---|---|
| Hypotheses | `.llm-wiki/hypotheses/**` |
| Events | `.llm-wiki/hypothesis-events/**` |
| Alerts | `.llm-wiki/hypothesis-alerts/**` |
| Reports | `.llm-wiki/hypothesis-reports/**` |
| Dashboard | `.llm-wiki/hypothesis-dashboard/**` |
| Supplements | `.llm-wiki/hypothesis-supplements/**` |
| WeChat Inbox | `.llm-wiki/wechat-inbox/**` |

**核心命令**：

| 命令 | 作用 |
|---|---|
| `hypothesis create/list/report` | 创建、筛选、报告假设 |
| `hypothesis update-from-article` | 从文章更新匹配假设，未匹配时给 candidate |
| `hypothesis validate` | 根据固定标签验证假设 |
| `hypothesis watch` | 扫描来源，生成 events/alerts |
| `hypothesis alerts` | 查看告警 |
| `hypothesis dashboard-data` | 生成驾驶舱数据 |
| `hypothesis supplement` | 提交补证资料 |
| `hypothesis supplement-draft` | 用 LLM 把资料整理成补证草稿 |
| `hypothesis wechat-inbox append/import-raw/process/status/serve` | 微信增量消息入口 |
| `hypothesis quality-check` | 检查 falsifiableConditions、coreDrivers、marketMispricing、sourceRefs |
| `hypothesis evidence-feedback` | 把 EvidenceResult 回流到 Hypothesis evidence list |
| `hypothesis evidence-task-drafts` | 从 Hypothesis 生成补证任务草案 |
| `hypothesis evidence-task-draft-review` | 人审股票身份后写正式 EvidenceTask |
| `hypothesis evidence-link-drafts` | 为 EvidenceResult 推荐 Hypothesis linkage |
| `hypothesis evidence-link-review` | HumanGate 后写 evidence link，不自动改 Hypothesis 状态 |

**适用点**：

- 跟踪“CPO 放缓是否推动 MPO 连接器量价齐升”这类 thesis。
- 微信增量、raw 微信聊天、补证资料触发 Watchtower。
- 把事件路由到已有假设，避免每条资料都散落为孤立笔记。
- 生成 candidate hypotheses，但不自动创建正式假设。
- 把 EvidenceResult 真正接回 hypothesis evidenceFeedback，进入后续 paper trade、trajectory、Benchmark 和 LoRA-ready。

**成熟度**：v0.14 Hypothesis Engine 已完成主干，v0.16.2 已把 evidenceFeedback 跑到真实项目 `99` 条，并把 evidence-link review 纳入 ResearchOS Agent 的 HumanGate 队列。

**缺口**：

- 11 条 evidence-link draft 仍需要人工确认低置信 Hypothesis 映射。
- 20 条 evidence-task draft 仍需要人工确认股票身份或 sourceRefs 后才能写正式 EvidenceTask。
- Watchtower 深度判断仍应保持推荐制，不自动改正式 Hypothesis 状态。

### 4.15 Research Cockpit 桌面驾驶舱

**解决的问题**：CLI 能力很强，但日常使用需要一个“工作台”，让用户看到假设、alert、补证、agentic 问题、proposal、自训练动作。

**当前设计**：

- 前端入口：`src/components/dashboard/research-cockpit-view.tsx`。
- Tauri 命令桥：`run_research_cockpit_command`。
- Rust 侧白名单 action，不暴露任意 shell。
- 对路径做 project-bounded 校验。
- 对输出做大小上限限制。
- 固定 action 包括：
  - `dashboard-data`
  - `watch-dry-run / watch-write`
  - `wechat-import-raw-dry-run / write`
  - `wechat-process / status`
  - `hypothesis-create-*`
  - `hypothesis-supplement-draft / dry-run / write`
  - `agentic-ask`
  - `policy-proposal-*`
  - `self-question-loop-dry-run`
  - `self-train-next / plan-*`
  - `export-samples-list`
  - `data-source-tushare-probe`
  - `stock-feedback-*`
  - `stock-feedback-paper-trade-*`

**适用点**：

- 操作假设生命周期。
- 从 raw 微信聊天或补证资料触发 Watchtower。
- 一站式看到 alerts、candidate hypotheses、proposal、self-training action。
- 在可视化端处理训练飞轮 review、paper trade record/settle、Tushare 证据健康检查。

**成熟度**：产品工作台骨架已出现，但仍属于工程验证期。

**缺口**：

- 浏览器 Vite 只能看壳，必须用 Tauri dev build 才能执行本地命令。
- 还缺更完整的确认写入、状态编辑、审计回放、权限提示和错误恢复 UX。
- 与正式 wiki 写入仍保持隔离，后续需要“确认发布”层。
- 训练飞轮虽已能操作 paper trade，但 LLM 自动模拟交易子 Agent 还没有完全自动化。

### 4.16 公司深度研究 V2：`company-research --deep --plugin-led`

**解决的问题**：单只上市公司深研需要公告、财务、行情、网页、wiki、PDF 表格、模型和买方报告共同产出。

**核心能力**：

- 收集 CNINFO/SSE 公告、Tushare 财务、Tavily/Web、wiki/raw、stock SQL。
- 下载和抽取 CNINFO PDF。
- 生成：
  - `evidence-ledger.json`
  - `evidence-pack.json`
  - `financials.json`
  - `company-report.md`
  - `wiki-change-candidates.md`
  - `document-extract.json`
  - `business-breakdown.json`
  - `deep-company-report.md`
  - `deep-company-model.xlsx`
  - `financial-model-v2.xlsx/json/template`
  - `deep-quality-audit.json`
- `--plugin-led` 下：
  - Data Analytics 负责模型/口径/tie-out。
  - Public Equity Investing 负责主报告。
  - Investment Banking 只在交易/资本市场事项触发或强制参数下参与。
  - `publish-readiness.json` 控制是否可发布。

**适用点**：

- A 股公司深研。
- 财报后模型更新。
- 订单/产能/客户/分部业务验证。
- 形成正式 wiki 写入候选。

**成熟度**：深研 artifact 闭环较强，但正式发布仍需人工。

**缺口**：

- 外部 provider 真实网络稳定性和凭证配置仍是风险。
- PDF 表格抽取不是万能，manual_needed 需要人工补。
- `publish-readiness` blocked 时不能硬发布，需要后续补证。

### 4.17 外部数据源：`data-source`

**解决的问题**：研究闭环需要订单、公告、财务、招投标和行情源。

**当前能力**：

- `data-source status` 查看 QCC/CNINFO/Tushare/Tavily 等凭证状态。
- `data-source tushare-probe` 只读验证 Tushare Keychain/MCP/HTTP 凭证和核心行情端点。
- `data-source qcc-tenders` 查询企查查招投标。
- 公司深研内部已经接入 CNINFO、SSE fallback、Tushare、Tavily。
- stock daily SQL 作为只读行情源进入 ask/market validation。
- 训练飞轮 V2 已把 Tushare 行情证据接到 `stock-feedback paper-trade record --auto-market-evidence --auto-microstructure-evidence`，用于相对强度、成交额、换手、承接和回撤判断。

**适用点**：

- 订单和招投标验证。
- 公告和财务补证。
- evidence task 未来执行器的数据源底座。
- paper trade 的入场价建议、行情窗口校验、微结构证据和 no-future-data 审计。

**成熟度**：数据源接入层已经从 status 进入可用 probe 阶段；Tushare 可支撑训练飞轮行情证据，但批量 evidence executor 尚未完整闭环。

**缺口**：

- `cninfo filings/search/download/extract`、`tushare financials/daily/adj-factor`、`qcc-tenders batch` 等更细命令还应补齐。
- 凭证加载和脱敏必须统一标准化。
- 外部 API 失败、限流、数据空洞需要统一 cache/audit/retry 视图。

### 4.18 桌面端传统能力

**保留能力**：

- 三栏 Wiki UI。
- 文件树、知识树、编辑器、预览。
- Sources 资料导入。
- Search 多阶段检索。
- Graph 图谱可视化。
- Dashboard 交易统计和持仓。
- 快速复盘模板。
- 交割单导入、FIFO 盈亏计算。
- Wiki Doctor、目录归一、body residue、垃圾页清理等维护工具。
- Chrome extension 网页剪藏。
- 多 provider LLM 设置和持久化。

**适用点**：

- 人工浏览、编辑、复盘、查图谱。
- 管理 raw/wiki 文件。
- 给 CLI 产物做人工审阅。

**成熟度**：历史桌面产品能力多，当前 main 更偏 CLI 自动化；Research Cockpit 是新产品面。

**缺口**：

- 新 CLI 能力并非全部都有同等成熟 UI。
- Tauri dev/prod 构建需要区分，验证时必须确认不是误连历史安装版。

### 4.19 Gangtise、OpenClaw、协作和自动化

**核心能力**：

- `gangtise:meeting-clues`：导出每日投研线索 Markdown。
- `collab/**`：OpenClaw 协作包、每日复盘模板、交易规则。
- `machine:preflight`、`machine:snapshot`：双机分工和同步辅助。
- docs 中已有外部接入指南，支持 Shell/Python/Node 调度。

**适用点**：

- 盘后自动复盘素材。
- 机器分工：新机器做开发/检索/训练，旧机器做自动化/采集。
- 外部系统把资料交给 CLI staging。

**成熟度**：有可运行脚本和文档，但不少工作流由外部 skill/automation 负责。

**缺口**：

- 主程序内的统一调度中心还未完全产品化。
- 自动化状态、失败重跑、权限恢复仍需要更强操作台。

### 4.20 Deep Research 复刻应用端 CLI：`deep-research`

**解决的问题**：应用端 Deep Research 面板适合人工发起深挖，但同样的能力需要能被命令行、自动化、远程任务和批处理复用。

**核心能力**：

- 复刻桌面端 Deep Research 面板的基本链路：Tavily/Web 检索 + 本地 `ask` 证据检索 + LLM synthesis。
- 默认生成 `.llm-wiki/deep-research/**` 草稿、manifest、source trace，不污染正式 wiki。
- `--write` 保存审核后的 `wiki/queries/**` 页面，并在 frontmatter 中保留 `origin: deep-research`。
- `--ingest` 对保存后的 query page 运行 staged ingest；`--apply-ingest` 才进一步执行正式 apply。
- Tavily 凭证来自 `--tavily-api-key`、`TAVILY_API_KEY` 或 macOS Keychain，输出不泄露密钥。

**适用点**：

- 把应用端“点按钮做深研”变成可复现的 CLI 任务。
- 对同一主题定期重跑，形成 query page 和后续 ingest 候选。
- 在 Research Cockpit/Graph/Review 之外给自动化留一个稳定入口。

**成熟度**：CLI 入口和 help 已出现，属于应用端能力 CLI 复刻的早期可用阶段。

**缺口**：

- untracked/开发中实现仍需和主测试、build、发布文档一起固化。
- 结果质量还依赖 Tavily/LLM provider 和本地 wiki 检索质量。
- 需要补更细的 diff preview、重复 query 去重和失败重跑体验。

### 4.21 Evidence Runner：`stock-feedback evidence-task` / `run-task-queue`

**解决的问题**：训练飞轮和 Hypothesis 不能只靠人工摘要，需要把“缺什么证据、用什么源补、补到了什么、是否足够可靠”变成可审计 artifact。

**核心能力**：

- `stock-feedback evidence-task create/list/show` 管理补证任务。
- `stock-feedback run-task-queue` 运行 Evidence Runner，生成 evidence run 和 evidence result。
- `stock-feedback evidence-result list/review` 进入 HumanGate 复核。
- `stock-feedback source-status` 查看 Tushare/Web/CNINFO 等 source health。
- `stock-feedback dlq list/retry/discard` 管理失败任务。
- EvidenceResult 记录 fieldCompleteness、valueValidity、timeliness、formatConsistency、sourceReliability、crossValidation 和 overallConfidence。

**适用点**：

- 把 `needs_evidence` 轨迹转成可执行补证任务。
- 给 fundamental closure 找公告、年报、订单、客户、收入、出货等硬证据。
- 给 expectation trade 找价格/成交额/相对强度/承接/回撤证据。
- 把补证结果回流 Hypothesis evidenceFeedback，而不是停在 stock-feedback 里。

**成熟度**：v0.13 主干已完成，当前 live 项目有 `11` 个 EvidenceTask、`11` 个 EvidenceResult、`7` 个 EvidenceRun，且 verify 通过。

**缺口**：

- 仍有 `1` 个 pending task 和 `4` 个 awaiting_review task。
- CNINFO/交易所原生硬源 adapter 还应继续强化为独立 data-source 命令。
- EvidenceResult 自动写入训练权重前仍必须保留 HumanGate。

### 4.22 训练飞轮 V2：`stock-feedback` / execution-result / paper trade / Benchmark / LoRA-ready

**解决的问题**：把“自提问里看好的股票、当时的假设、市场反馈、收益归因、人审动作”变成可验证轨迹，而不是事后挑样本。

**核心能力**：

- `stock-feedback status/build-trajectories/list/review-queue/review/bench/export-lora-ready/verify` 形成训练飞轮命令族。
- `stock-feedback execution-result import/validate/list/review/verify` 把真实交割单、日复盘、position-tracking 和 Tushare 市场路径交叉验证后回流训练飞轮。
- `stock-feedback paper-trade-agent candidates` 从 trajectory / hypothesis evidence-feedback 生成 `rule_baseline` 与 `llm_discretionary` 双轨候选。
- 轨迹层区分 `expectation_trade`、`fundamental_closure`、`priced_in_risk`、`disconfirmation` 等训练目标。
- 质量门区分 `expectation_validated`、`fundamental_validated`、`priced_in_validated`、`disconfirmed_validated`、`needs_evidence`、`review_required`、`high_confidence`。
- `collection-task/collection-result` 让缺口样本进入补证、人审和重建轨迹流程。
- `paper-trade status/record/settle` 支持模拟买入、卖出、收益、回撤、持有期、入场/退出理由、sourceRefs/evidenceRefs。
- paper trade 强制写 `.llm-wiki/stock-feedback/paper-trades/**`，标记 `ledgerKind=paper_trade`，不写真实交易账本。
- Tushare 自动行情和微结构证据可进入 paper trade：相对强度、成交额/换手、后续承接、回撤、涨跌停和市场证据窗口。
- `autoEvidenceGate`、`marketEvidenceWindow` 和 `evidenceCutoff.noFutureData=true` 防止无证据写入和偷看未来。
- `approve_paper_adapter_candidate` 是 paper trade 的人工低权重 adapter 候选动作，不能等同真实盈利确认。

**适用点**：

- 把 self-question 的“当时为什么看好”落到可复盘的行为样本。
- 区分“市场先炒预期”与“基本面兑现”，避免用公告/财报规则压低预期交易样本。
- 训练“方向对但买点晚”、“伪催化一日游”、“低位吸收转强”、“执行纪律有效”等可复用能力。
- 给 PEFT/LoRA 准备行为、技能、工具习惯和决策策略候选，而不是把原始事实塞进 adapter。

**成熟度**：V2 主干已经成型，真实 execution-result、paper trade、review、Benchmark、LoRA-ready 均已进入闭环。当前 live 项目有 `73` 条 trajectories、`806` 个 Benchmark cases、`376` 个 LoRA-ready candidates、`2` 个 confirmed real profitable execution 样本和 `12` 个 paper-trade-agent written candidates。

**缺口**：

- 真实 execution-result 已接入，但剩余 `17` 个 reconciliation 样本仍保持低权重或非行动项，等待完整生命周期或人工边界确认。
- `llm_discretionary` 模拟交易子 Agent 候选已写入，但还缺完整 record/settle/attribution 对照样本。
- priced-in/fundamental 样本已有覆盖但密度仍低，需要继续补高质量正负样本。
- paper trade 默认只能证明“模拟执行样本”，不能提升为真实交易收益样本。

### 4.23 Research OS Agent：`research-os agent`

**解决的问题**：现有 CLI 能力很多，如果每次都人工判断下一步，很容易漏掉 evidenceFeedback、review、Benchmark 或 LoRA-ready 刷新。Research OS Agent 把这些能力编排成固定、可审计、HumanGate-first 的多 Agent 后端流程。

**核心命令**：

| 命令 | 作用 |
|---|---|
| `research-os agent status` | 聚合 stock-feedback / hypothesis / evidence / paper-trade / verify 状态 |
| `research-os agent plan` | 生成下一步 agent plan，默认只读，`--write` 只写 `.llm-wiki/research-os/agent-runs/**` |
| `research-os agent review` | 列出需要人工确认的 HumanGate 节点 |
| `research-os agent step` | 执行固定映射 step 的 dry-run；写入必须明确 `--confirm-human-gate true` |
| `research-os agent verify` | 校验 agent context/plan/manifest 与下游 verify 状态 |

**Agent 分工**：

- `SupervisorAgent`：由 Codex 聊天窗口扮演，决定执行顺序和风险说明。
- `EvidenceAgent`：复用 Evidence Runner。
- `HypothesisAgent` / `HypothesisLinkAgent`：复用 evidence-feedback、evidence-link review、quality gate。
- `MarketValidationAgent`：规划行情、换手、相对强度、承接、回撤验证。
- `PaperTradeAgent` / `SettlementAgent`：生成和结算 paper trade，不触发真实交易。
- `AttributionAgent`：重建 trajectory 和收益归因。
- `BenchmarkAgent` / `CurriculumAgent`：生成 Benchmark 与 LoRA-ready manifest。

**v0.16.2 新增重点**：

- `HypothesisLinkAgent` 现在是当前最高优先级队列。
- `source-integrity` 会在 plan/review/dry-run 中区分原生公告、官方 PDF、Web/Tavily 线索、结构化数据和缺 source refs。
- 原生 CNINFO/SSE/SZSE 公告 refs 优先于 Web 搜索来的 PDF。
- 官方工具态 `results=0` 不再被误判为硬源。

**成熟度**：CLI/artifact 后端闭环已可用，当前已有 `11` 个 agent plan / run manifest 通过 verify。UI 多 Agent 操作台属于 v0.17 范围。

**缺口**：

- 本阶段不在应用内自由调用 LLM API，Codex 聊天窗口仍是 Supervisor。
- `step --write` 只能执行固定 action，且必须单 step HumanGate，不支持整轮批量批准。
- UI 仍需读取这些 artifact，做成可视化多 Agent 操作台。

## 5. 功能成熟度矩阵

| 模块 | 当前状态 | 闭环程度 | 说明 |
|---|---|---|---|
| `ask` 多源问答 | 已成熟 | 高 | 只读、可诊断、源路由清楚 |
| `prepare/api-run/apply` 摄入 | 已成熟 | 高 | dry-run -> review -> write 链路清楚 |
| Temporal Facts | 已可用 | 中高 | 账本和 audit 已有，复核 UI 待补 |
| Concept Governance | 已可用 | 中 | 审计强，自动合并谨慎 |
| Brain Memory | 已可用 | 中 | 记忆/resolve 可用，治理和过期仍可加强 |
| Market Validation | 已可用 | 中 | SQL 验证可用，ticker grounding 仍需增强 |
| Daily Loop | 可用 | 中 | 预测/验证链路有，日常质量需长期运行校验 |
| Agentic Ask | 可用 | 中 | agent run 有审计，但仍需人工转实验 |
| Company Research V2 | 可用 | 中高 | artifact 完整，发布门禁仍需人工 |
| Self-Question Loop | 工程骨架强 | 中 | 阶段丰富，Evidence Runner 已接主干，长期收益校验待继续跑 |
| Self-Train/Export | 可用 | 中 | 样本可导出校验，高置信依赖人工复核 |
| Deep Research CLI | 早期可用 | 中 | 复刻应用端 Deep Research 面板，`.llm-wiki` 草稿到 `wiki/queries` 有写入门 |
| Evidence Runner | 可用 | 中高 | task/result/run/DLQ 已闭环，硬源 adapter 仍需加强 |
| Hypothesis Engine | 可用 | 中高 | evidenceFeedback 已跑到真实项目，link review 仍需 HumanGate |
| Training Flywheel V2 | 可用 | 高 | trajectory/review/Benchmark/LoRA-ready 已形成批次，样本密度继续补 |
| Real Execution Result | 可用 | 中高 | 真实交割单闭环已接，reconciliation 保守降权 |
| Paper Trade Agent | 可用 | 中 | candidates 已写入，llm_discretionary record/settle 对照待补 |
| Research OS Agent | 可用 | 中高 | status/plan/review/step/verify 已成后端编排层，UI 操作台待补 |
| Autoresearch Lite | Phase 5A | 中 | proposal 有，自动应用不开放 |
| Hypothesis Library | V2 入口 | 中高 | 创建/报告/watch/dashboard/evidence-feedback 有，状态决策仍人工 |
| Watchtower | V1 | 中 | deterministic scan 和 alert 可用，深度判断待接 |
| Research Cockpit | 新工作台 | 中低到中 | 白名单 runner 已有，UX 和确认链待产品化 |
| Data Source Executor | 部分可用 | 中 | status/QCC/Tushare probe/公司深研内置源有，批量补证执行器待补 |
| Paper Trading | V2 paper 闭环完成首片 | 中高 | record/settle/trajectory/review/LoRA-ready 可用，不能冒充真实收益 |
| Controlled Trading Advice | 未实现 | 低 | 后续 Phase，不能自动交易 |

## 6. 当前最适合的使用方式

### 6.1 日常问答

```sh
npm run codex:ingest -- ask \
  --query "最近机器人产业链哪些变化是订单兑现，哪些只是情绪扩散？" \
  --sources wiki,raw,graph,facts,brain,stock-price \
  --show-sources \
  --provider codex
```

适合快速定位证据和反证。复杂问题再加 `--agentic`。

### 6.2 正式入库

```sh
npm run codex:ingest -- api-run \
  --provider codex \
  --source <raw-file> \
  --project <wiki-root>

npm run codex:ingest -- apply \
  --manifest <changes.json> \
  --project <wiki-root> \
  --write
```

适合每日复盘、研报、会议纪要、微信舆情、Gangtise 文件。

### 6.3 假设跟踪

```sh
npm run codex:ingest -- hypothesis create --title "..." --theme "..." --write
npm run codex:ingest -- hypothesis watch --sources wechat_incremental,hypothesis_supplement --since 30m
npm run codex:ingest -- hypothesis dashboard-data --json
```

适合把资料流从“散点信息”转成“假设生命周期”。

### 6.4 深度公司研究

```sh
npm run codex:ingest -- company-research \
  --stock <code|name> \
  --deep \
  --plugin-led \
  --project <wiki-root>
```

适合形成证据包、财务模型、主报告、发布门禁和 wiki 写入候选。

### 6.5 递归自训练

```sh
npm run codex:ingest -- self-question phase-status
npm run codex:ingest -- self-question loop --stages generate,validate,attribute,self-train --write
npm run codex:ingest -- export-samples --kind eval --quality-gate review_required
npm run codex:ingest -- export-samples verify --kind eval
```

适合把错误、验证和补证转成审计样本。

### 6.6 Deep Research CLI

```sh
npm run codex:ingest -- deep-research \
  --topic "AI 服务器电源产业链和订单兑现" \
  --provider codex

npm run codex:ingest -- deep-research \
  --topic "AI 服务器电源产业链和订单兑现" \
  --provider codex \
  --write

npm run codex:ingest -- deep-research \
  --topic "AI 服务器电源产业链和订单兑现" \
  --provider codex \
  --write \
  --ingest
```

适合把应用端 Deep Research 面板复刻为 CLI 流程。默认只落 `.llm-wiki/deep-research/**`；`--write` 才保存 query page；`--apply-ingest` 才进入正式 apply。

### 6.7 训练飞轮 V2 和 paper trade

```sh
npm run codex:ingest -- stock-feedback status
npm run codex:ingest -- stock-feedback build-trajectories --write
npm run codex:ingest -- stock-feedback bench --write
npm run codex:ingest -- stock-feedback review-queue --include-reviewed
```

记录一笔模拟交易：

```sh
npm run codex:ingest -- stock-feedback paper-trade record \
  --track rule_baseline \
  --status open \
  --validation-target expectation_trade \
  --as-of-date 2024-06-03 \
  --stock-code 000001.SZ \
  --entry-date 2024-06-03 \
  --entry-price 10.00 \
  --source-refs "self-question:<id>" \
  --evidence-refs "retrieval:<id>" \
  --auto-market-evidence \
  --auto-microstructure-evidence \
  --market-evidence-provider tushare
```

结算、review 和导出：

```sh
npm run codex:ingest -- stock-feedback paper-trade settle \
  --paper-trade-id <id> \
  --exit-date 2024-06-07 \
  --exit-price 10.80 \
  --exit-reason "follow-through weakened"

npm run codex:ingest -- stock-feedback review \
  --trajectory-id <trajectory-id> \
  --action approve_paper_adapter_candidate \
  --write

npm run codex:ingest -- stock-feedback export-lora-ready --write
npm run codex:ingest -- stock-feedback verify
```

适合把 self-question 的看好逻辑、买卖理由、收益、回撤、持有期和证据引用沉淀为可审计训练轨迹。paper trade 是模拟收益，只能作为低权重样本或 eval/preference 候选。

### 6.8 Tushare 数据源健康检查

```sh
npm run codex:ingest -- data-source status
npm run codex:ingest -- data-source tushare-probe \
  --stock-code 000001.SZ \
  --trade-date 2024-06-03
```

适合确认 Keychain/Tushare/MCP/HTTP 凭证和核心行情端点是否可用。输出应只包含状态、摘要和引用，不输出密钥或原始大段行情。

### 6.9 ResearchOS 多 Agent 调度

```sh
npm --silent run codex:ingest -- research-os agent status \
  --project /Users/jiegege/Desktop/杰杰杰

npm --silent run codex:ingest -- research-os agent plan \
  --project /Users/jiegege/Desktop/杰杰杰 \
  --write

npm --silent run codex:ingest -- research-os agent review \
  --project /Users/jiegege/Desktop/杰杰杰
```

对单个 step 先 dry-run：

```sh
npm --silent run codex:ingest -- research-os agent step \
  --project /Users/jiegege/Desktop/杰杰杰 \
  --step-id <step-id>
```

只有用户明确确认该 step 后才写：

```sh
npm --silent run codex:ingest -- research-os agent step \
  --project /Users/jiegege/Desktop/杰杰杰 \
  --step-id <step-id> \
  --write \
  --confirm-human-gate true
```

当前最常见下一步是处理 `HypothesisLinkAgent` 队列：先看 `sourceIntegrity.sourceProfile`，优先确认 `native_official_disclosure`，谨慎处理 `web_lead_only` 和 `needs_source_refs`。

## 7. 未完整闭环的关键点

### 7.1 Evidence Task 执行器

Evidence Runner 已经从“待建”进入可用状态：`stock-feedback evidence-task create/list/show`、`run-task-queue`、`evidence-result list/review`、`source-status`、DLQ 和 verify 均已落地。当前缺口不再是“有没有执行器”，而是“硬源 runner 深度和人审吞吐”。

建议补齐：

- source-specific runner：CNINFO、SSE/SZSE、QCC、Tushare、IMA、本地 raw。
- 官方公告 native id、PDF、摘要抽取和 tool-state 的统一映射。
- pending / awaiting_review task 的批量 review 操作台。
- 低置信股票身份、低置信 hypothesis mapping 的人工确认效率。
- 与 `self-question evidence resolve` 打通。

### 7.2 Data Source 批量命令

当前 `data-source status`、`data-source qcc-tenders` 和 `data-source tushare-probe` 已有，company-research 内部也有 CNINFO/Tushare/Tavily。Tushare 已能服务训练飞轮 paper trade 的行情证据，但通用批量补证命令面还可拆出来。

建议补齐：

- `data-source cninfo search/download/extract`。
- `data-source tushare financials/daily/adj-factor`。
- `data-source qcc-tenders batch`。
- `data-source cache/audit`。
- 统一 credential redaction。
- API 限流、空数据、provider timeout 的 retry/backoff 和审计可视化。

### 7.3 Hypothesis 状态机

已有状态：`seed/watching/strengthening/actionable/priced_in/divergent/disconfirmed/archived`。v0.14-v0.16 已把 evidenceFeedback 跑通，但正式状态迁移仍应保守，不能让低置信 EvidenceResult 直接改 Hypothesis 状态。

建议补齐：

- 状态迁移 proposal 进入 ResearchOS Agent review，而不是直接改状态。
- 每次迁移必须带 event、alert、market validation、counterevidence。
- `confirm-transition --write` 人工确认。
- Cockpit 里可视化假设时间线。
- evidence-link approved 后自动刷新 evidenceFeedback / trajectory / paper-trade-agent candidate 的推荐链。

### 7.4 Watchtower 深度判断

当前 Watchtower 更偏 source matching 和 alert routing。

建议补齐：

- 低成本 deterministic scan 保持默认。
- 对重要 alert 触发 agentic evaluator。
- 输出 `evidenceDelta / evidenceGaps / nextAction / confidence`。
- 与 company-research/evidence-task 自动串联。

### 7.5 Research Cockpit 产品化

当前有白名单 runner 和工作台 UI，但仍需变成真正日常台面。

建议补齐：

- 每个按钮显示实际 CLI、dry-run/write 范围。
- 所有 write 操作二次确认。
- 失败 run 可一键复制诊断包。
- 假设、alert、supplement、self-train action 可打开原始 JSON/Markdown。
- 支持 Tauri dev/prod 标识，避免误连历史 app。

### 7.6 Autoresearch proposal 到 patch

已有 proposal，但从 proposal 到 patch candidate、审批、应用、回归、回滚仍需要更连贯。

建议补齐：

- proposal schema 标准化。
- patch candidate 生成器。
- reviewer event。
- apply event + rollback key。
- regression verify。
- failed -> remediation。

### 7.7 训练样本质量门

当前样本导出链路已形成批次：`73` 条 trajectory、`806` 个 Benchmark cases、`376` 个 LoRA-ready candidates、`29` 个 trainable 样本。后续重点是样本质量和覆盖密度，而不是“能不能导出”。

建议补齐：

- 样本 lineage 可视化。
- negative sample 和 failure sample 专门管理。
- 每批训练前必须 `export-samples verify`。
- 与固定 eval benchmark 比较。
- `real_pattern_execution_supported` 与 `paper_pattern_execution_supported` 分层权重。
- expectation/fundamental/priced-in/disconfirmation 四类目标继续补高质量正负样本，尤其是 priced-in 和 fundamental 的密度。
- evidence-link 低置信映射不得自动升权。

### 7.8 Paper Trading 和交易归因

当前系统不自动交易。paper trade 模拟账本、record/settle、trajectory、review 和低权重 adapter 候选路径已可用，Paper Trade Agent candidates 已写入；但 `llm_discretionary` 从候选到 record/settle/attribution 的对照样本还需要继续跑。

建议补齐：

- 从已写入 candidate 生成 `llm_discretionary` paper trade record。
- `rule_baseline` 与 `llm_discretionary` 双轨结算对照。
- paper order/fill 和 position ledger。
- PnL attribution、entry/exit attribution、risk event。
- liquidity/slippage/涨跌停约束。
- 真实 trade ledger 已通过 execution-result 接入首片，但必须继续和 paper_trade ledger 严格分层。

## 8. 演进路线

### 1.0：审计级 CLI 和知识库生产线

状态：已基本完成，并在 `0.16.2` 继续作为主链底座维护。

应完成：

- CLI help、使用手册和实际 handler 完全一致。
- `ask`、`api-run/apply`、`temporal-facts`、`company-research`、`daily-loop` 常用 smoke 固化。
- `deep-research` 作为应用端 Deep Research 面板的 CLI 复刻入口，完成 help、write gate、staged ingest 和回归验证。
- `stock-feedback verify`、paper trade gate 和 Tushare probe 纳入常规 smoke。
- `git diff --check`、测试、build 形成发布门禁。
- 对所有写入命令统一输出 writePolicy。
- 对 live wiki 工作区有定期备份和恢复 SOP。

验收：

- 日常资料能稳定 dry-run -> review -> apply。
- ask 能稳定回答并给源。
- company-research blocked/ready 能准确反映 publish readiness。
- Deep Research CLI 能稳定生成 `.llm-wiki` 草稿，并在显式 `--write` 后保存 query page。
- 训练飞轮 paper trade 失败 gate 不会进入 LoRA-ready。

### 2.0：证据执行器和假设生命周期闭环

状态：v0.13-v0.16.2 已完成主干，下一步从“能跑”转向“更高吞吐的人审和硬源质量”。

应完成：

- Evidence Task Runner：
  - 已完成 task/result/run/DLQ 主干。
  - 继续补 CNINFO/SSE/SZSE/QCC/Tushare/IMA/raw 的 source-specific runner。
  - result 继续保持 `.llm-wiki/**` 审计优先，不默认写正式 brain/wiki。
- Hypothesis transition proposal：
  - strengthening/actionable/divergent/disconfirmed 都必须有证据包。
  - 人工确认后才改状态。
  - evidence-link approved 后刷新 evidenceFeedback、trajectory、paper-trade-agent candidate。
- Watchtower v2：
  - selected hypothesis scope。
  - source filters。
  - important alert 可触发 agentic evaluator。
- Research Cockpit v2：
  - 假设时间线。
  - alert -> 补证 -> confirm write。
  - 每一步能打开原始 artifact。
- Training Flywheel v2：
  - review backlog 已清理到当前轨迹全 review，后续重点是新样本持续 review。
  - Benchmark batch 已稳定生成，继续补覆盖密度。
  - expectation/fundamental/priced-in/disconfirmation 四类目标都有正负样本。
  - paper trade 只作为低权重候选，真实收益样本单独分层。

验收：

- 一条微信增量或补证资料能从 inbox 进入 alert，再进入 evidence task，再进入假设状态 proposal。
- 一条 self-question 看好股票能进入 stock-feedback trajectory、review、Benchmark 和 LoRA-ready 候选。
- 不写正式 wiki/raw。
- 所有自动判断都有 sourceRefs 和人工确认门。

### 3.0：人工批准的低风险策略改进闭环

目标：把 Autoresearch、Self-Question 和 Training Flywheel 的 proposal 变成可批准、可回归、可回滚的配置改进。

应完成：

- Proposal -> patch candidate。
- Adapter candidate -> eval/preference/SFT routing。
- 支持低风险配置：
  - segment alias。
  - evidence priority。
  - market validator threshold。
  - retrieval policy。
  - answer guardrail。
- Human approve/reject。
- Apply 后自动 regression verify。
- 失败进入 remediation。
- 成功形成 active policy/config revision。
- paper trade 与真实 trade ledger 权重分层，不把模拟收益当真实收益。

验收：

- 至少 10 个低风险配置完成 approve -> apply -> regression -> active。
- 回滚路径可用。
- 没有自动改 prompt 主体、核心代码、正式 wiki/raw 或交易动作。

### 4.0：受控自动低风险应用

目标：在严格门控下，对极小范围低风险改动允许自动应用。

自动应用范围：

- 同类 segment alias。
- evidence priority 微调。
- validator 非破坏性阈值微调。
- 已多次通过回归的 answer guardrail。

门槛：

- 同类 proposal 至少出现 3 次。
- 最近 N 次 regression 全部通过。
- 无 high severity remediation。
- 有 rollback record。
- 应用后立即 post-apply regression verify。

仍禁止：

- 自动改正式 wiki/raw。
- 自动改核心代码。
- 自动改 agent role 主体。
- 自动生成或执行真实交易。

验收：

- 自动应用只发生在白名单。
- 每次都有审计、回滚和复验。
- 固定 eval 指标优于 baseline。

### 5.0：模拟交易闭环

状态：v0.15 已完成首片。目标是在现有 paper trade ledger 和 Paper Trade Agent candidates 上扩展为更高密度的自动化模拟交易闭环，但仍只做 paper trading。

应完成：

- self-question / trajectory / hypothesis feedback -> paper trade candidate 已完成，后续继续扩大输入质量。
- `rule_baseline` 与 `llm_discretionary` 双轨候选已完成，后续补 record/settle 对照。
- Signal ledger。
- Paper order/fill。
- Position ledger。
- PnL attribution。
- Risk event。
- 流动性、滑点、涨跌停、仓位上限。
- 研究证据强度和交易结果关联分析。
- LLM 跑输 rule baseline 时进入执行风险负样本；跑赢且证据完整时只进入低权重 adapter 候选。

验收：

- 至少 100 条模拟 signal 有完整 evidence pack。
- 覆盖强趋势、震荡、下跌三个市场阶段。
- 无未来函数审计通过。
- 失败样本进入训练和 policy regression。

### 6.0：受控真实交易建议

目标：系统可以生成真实交易建议，但不自动下单。

每条建议必须包含：

```json
{
  "schema": "controlled-trading-advice-v1",
  "symbol": "stock",
  "thesis": "why",
  "evidencePack": ["agentRun", "cninfo", "qcc", "financials", "marketValidation"],
  "counterEvidence": ["risk1", "risk2"],
  "trigger": "action trigger",
  "invalidation": "exit condition",
  "positionLimit": "max position",
  "liquidityCheck": "amount/slippage/limit-up-down",
  "reviewRequired": true,
  "autoTradeAllowed": false
}
```

验收：

- 所有真实建议都需要人工确认。
- 每条都有 evidence/counterevidence/risk/liquidity。
- 没有自动下单入口。

## 9. 建议优先级

### P0：先做稳定闭环

- Deep Research CLI 的主测试、build 和发布说明固化。
- stock-feedback verify、Benchmark batch、review queue、LoRA-ready 的常规回归继续保留为发布门禁。
- paper trade 自动证据 gate 和 Tushare probe 的失败诊断。
- Hypothesis evidence-link queue 的 `native_official_disclosure` 样本优先人审。
- EvidenceTask draft 的低置信股票身份确认。
- Research Cockpit confirm-write UX。
- Hypothesis transition proposal。
- data-source CNINFO/SSE/SZSE/QCC/Tushare batch commands 和 cache/audit。
- export-samples fixed eval benchmark。

### P1：提高研究深度

- Watchtower agentic evaluator。
- Company research 和 hypothesis 的互相引用。
- Deep Research query 去重、diff preview、失败重跑。
- 训练飞轮四类目标样本补齐：expectation/fundamental/priced-in/disconfirmation。
- Segment registry 管理 UI。
- Temporal Facts review UI。
- Brain memory conflict/expiry audit。

### P2：进入递归优化

- proposal -> patch candidate。
- low-risk config apply。
- regression verify dashboard。
- remediation review queue。
- high-confidence sample governance。

### P3：交易闭环

- Paper Trade Agent candidate -> llm_discretionary record/settle 对照。
- paper order/fill/position ledger。
- 真实 trade ledger 继续通过 execution-result 接入，和 paper_trade 严格分层。
- PnL attribution、entry/exit attribution。
- risk event。
- controlled advice schema。

## 10. 总结

当前系统最强的地方，是已经形成了“写入边界很清楚的研究自动化底座”：

- `ask` 能读多源。
- `ingest/apply` 能审计写入。
- `facts/brain` 能记录变化和记忆。
- `company-research` 能生成证据包、模型和发布门禁。
- `deep-research` 正在把应用端深研面板复刻成可自动化调用的 CLI。
- `self-question/self-train/export` 已经能把错误和反馈转成样本。
- `hypothesis/watchtower/research-cockpit` 已经把产品方向转向假设生命周期，evidenceFeedback 已经跑到真实项目。
- `stock-feedback/training-flywheel` 已经把看好股票、真实交易、paper trade、市场反馈和人审动作接成训练数据面。
- `research-os agent` 已经把 Evidence/Hypothesis/PaperTrade/Execution/Benchmark/Curriculum 编排成 Codex-supervised 后端闭环。

当前最需要补的，不是再加更多散乱命令，而是把 HumanGate 队列和硬源补证效率继续提高：

```text
hypothesis evidence-link draft
-> source-integrity hard-source review
-> HumanGate approve / reject / needs evidence
-> hypothesis evidenceFeedback refresh
-> paper-trade-agent candidate / stock-feedback trajectory
-> review / Benchmark / LoRA-ready
-> policy/sample/knowledge update
```

如果这条链路跑稳，Trading Review Wiki 就会从“知识库 + CLI 工具”真正进入“AI-native 主动管理交易研究假设生命周期和训练反馈飞轮的 Research OS”。
