# Research OS v0.12.1 主链整合更新报告

生成日期：2026-06-20
目标分支：`main`
整合来源：Research Cockpit 0.12.1、训练飞轮 V1/V2、Tushare 数据源、Deep Research CLI、功能全景文档与 PPT/PDF

## 1. 版本定位

v0.12.1 把 Trading Review Wiki 从“研究资料库 + 问答工具”推进到更完整的 Research OS：

- Research Cockpit 负责把微信增量、假设、Ask 深挖和人工确认接成日常决策面。
- 训练飞轮负责把自提问、股票验证、补证、review、Benchmark 和 LoRA-ready 候选接成可审计训练闭环。
- Paper trade 是 V2 的关键新增层：先做模拟交易账本、收益归因和低权重 adapter 候选，不冒充真实交易。
- Tushare 作为外部行情和微观结构证据源接入，用于 entry price、相对强弱、承接、龙虎榜、热度等证据。
- Deep Research CLI 把应用端 Deep Research 面板复刻为可自动化命令，默认写 `.llm-wiki/deep-research/**`，显式 `--write` 后才保存 `wiki/queries/**`。

本次主链只保留这一份整合说明，零散迭代复盘文件不进入最终 main 文件树。

## 2. 核心功能增量

### 2.1 Research Cockpit 日常决策链

- 左侧 Cockpit 保留轻量日常入口，聚焦“AI 并发找假设 -> 扫描微信新增 -> 待处理卡片 -> Ask 深挖 -> 人工确认/忽略/跟踪”。
- 待处理区增加“今天先手”焦点卡，把最该看的信号上移。
- Wiki 表头信息进入判断面：`status`、`confidence`、`momentum`、`catalysts` 显示在卡片里，避免只看舆情摘要。
- Ask 深挖结果有明确 loading、失败、跳转和完整回答展示，减少“点了没反馈”的使用断点。

### 2.2 训练飞轮 V1 可用闭环

- 新增独立左侧入口“训练飞轮”。
- 新增 `stock-feedback` 命令族：`status`、`build-trajectories`、`list`、`review-queue`、`review`、`collection-task`、`collection-result`、`bench`、`export-lora-ready`、`verify`。
- 数据层新增 `stock-feedback-trajectory-v1`、`stock-validation-benchmark-v1`、review event、collection result、LoRA-ready manifest。
- 质量门从单一证据规则拆成训练目标：
  - `expectation_validated`
  - `fundamental_validated`
  - `priced_in_validated`
  - `disconfirmed_validated`
  - `review_required`
  - `needs_evidence`
- `high_confidence` 只作为人工/规则确认后的上层标记，必须绑定具体 `validationTarget`。

### 2.3 训练飞轮 V2 Paper Trade 闭环

- 新增 `stock-feedback paper-trade status/record/settle`。
- 支持 `rule_baseline` 与 `llm_discretionary` 双轨模拟。
- 记录结构化字段：`ledgerKind`、`asOfDate`、`stockCode`、`stockName`、`entryDate`、`exitDate`、`entryPrice`、`exitPrice`、`realizedPnlPct`、`maxDrawdownPct`、`holdingDays`、`positionSizing`、`exitReason`、`sourceRefs`、`evidenceRefs`。
- 写入路径固定为 `.llm-wiki/stock-feedback/paper-trades/**`，并强制 `ledgerKind=paper_trade`。
- Paper trade trajectory 默认 `review_required`，盈利模拟不能自动变成真实高置信样本。
- 新增 `approve_paper_adapter_candidate`：盈利 paper trade 只有人审后才能进入低权重 adapter 候选。
- UI 增加模拟交易指标、paper trade 录入、候选预填、证据窗口、结算预览、已应用提示和 review 分流动作。

### 2.4 Tushare 外部证据源

- 新增/扩展 `data-source tushare-probe`，覆盖行情、日线基础、指数、涨停、连板、龙虎榜、机构、游资、热榜等接口探针。
- Tushare token 通过 macOS Keychain 读取，默认不落库、不写文档、不进入 manifest。
- Paper trade 支持从 Tushare 自动补 entry price、相对强弱、换手/成交额变化、承接、回撤和微观结构证据引用。
- UI 训练飞轮可查看 Tushare 数据源健康状态，并能从候选轨迹生成入场价建议。

### 2.5 Deep Research CLI

- 新增 `scripts/codex-ingest/deep-research/**` 与 `scripts/codex-ingest/internal/deep-research.mjs`。
- CLI 使用：

```bash
npm run codex:ingest -- deep-research --topic "AI服务器电源"
npm run codex:ingest -- deep-research --topic "AI服务器电源" --write
npm run codex:ingest -- deep-research --topic "AI服务器电源" --write --ingest
```

- 默认只写 `.llm-wiki/deep-research/**` 草稿、prompt、web results、local context 和 manifest。
- `--write` 才保存审核后的 `wiki/queries/**` 页面。
- `--ingest` 必须和 `--write` 搭配，`--apply-ingest` 必须先显式 `--ingest`。
- Tavily key 支持 CLI 参数、环境变量或 Keychain，输出 manifest 不包含密钥。

## 3. PEFT 与训练边界

- LoRA/adapter 不存原始事实、公告正文、价格行或交易流水，只沉淀可复用的行为、技能、工具习惯和决策策略。
- 事实和证据继续留在 retrieval、tool state、sourceRefs、price SQL、trade ledger。
- `expectation_trade` 允许“市场先交易预期”成为一等训练目标；没有订单、公告、财报并不自动降级。
- `fundamental_closure` 仍必须有订单、公告、财报、ASP、毛利率等基本面证据。
- `priced_in_risk` 和 `entry_wrong` 优先进入 eval / preference / negative 样本，用来训练“方向对但买点错”。
- Paper trade 是模拟收益证据，不能冒充真实 realized PnL；默认低权重并需要人审。

## 4. 写入与安全边界

- Research Cockpit、训练飞轮、paper trade、Deep Research 默认写 `.llm-wiki/**`。
- 正式 `wiki/**` 只有显式 `--write` 或人工确认路径才会写。
- 不自动写 `raw/**`，不触发真实交易动作。
- Tauri 仅调用固定 allowlist action，不开放任意 shell。
- 外部 API token 通过 Keychain/环境变量读取，不写入仓库。

## 5. 主链文件策略

本次主链保留：

- `CHANGELOG.md` 顶部的 v0.12.1 整合版本说明。
- 本文件：`docs/更新报告-2026-06-20-ResearchOS-v0.12.1.md`。
- `docs/Trading-Review-Wiki-功能全景与演进路线.md`。
- 新手说明、截图、PPT、PDF 等面向使用者的交付物。

本次主链不保留：

- `docs/训练飞轮V2-迭代复盘-2026-06-20-*.md`
- `docs/更新报告-2026-06-20-训练飞轮V1.md`
- `docs/训练飞轮V2-外部数据源-2026-06-20-Tushare-Keychain.md`

这些逐步复盘已经并入本整合报告。

## 6. 仍未替代的数据源

v0.12.1 已预留接口，但以下数据源仍建议后续补齐或稳定化：

- 真实交易账本：真实买入、卖出、清仓、持仓、成本、收益率、最大回撤、持有天数。
- 本地价格 SQL：稳定返回相对强弱、换手变化、后续承接、持有期最大回撤。
- 自提问 attribution：当时为什么看好、属于哪个假设、预期是什么、是否后验改写。
- 基本面兑现证据：公告、订单、财报、ASP、毛利率、产能、客户验证。
- 新闻/公告/RAG 原文引用：用于补证和审计，不进入 adapter 原始事实。

## 7. 后续演进

### v1.5：Paper Trade 密度与审计

- 从 self-question 自动生成 paper trade candidate。
- 固定 rule baseline，保证可重复回测。
- LLM discretionary 只在 `asOfDate` 截断上下文内决策，防止偷看未来。
- 形成更多 profitable paper、entry_wrong、priced_in_risk 和 disconfirmed 样本。

### v2.0：模拟交易子 Agent 融入训练飞轮

- 子 Agent 读取自提问、假设、sourceRefs 和当时证据。
- 自动输出买入、持有、卖出、清仓、收益、回撤、持有天数和归因。
- 与 rule baseline 对比，跑赢且证据完整才进入低权重 adapter 候选。
- 跑输或后手风险高则进入 eval / preference / negative。

### v3.0：真实交易反馈与策略蒸馏

- 接真实 trade ledger。
- 区分真实收益、模拟收益、行情 beta 和手法收益。
- 建立 adapter curriculum：预期交易判断、基本面兑现、priced-in 风险、失败归因、补证路线、写作表达。
- Benchmark 从样本批次升级为持续回归集，防止训练后策略退化。

## 8. 本轮验收结果

主链合并前已确认：

- `npm --silent exec vitest -- run scripts/codex-ingest-lib.test.mjs -t "codex ingest deep-research"` 通过：`2 passed`。
- `npm --silent exec vitest -- run scripts/codex-ingest-lib.test.mjs -t "codex ingest CLI structure" --testTimeout 60000` 通过：`7 passed`。
- `npm --silent exec vitest -- run scripts/codex-ingest-stock-feedback-paper-trade.test.mjs scripts/codex-ingest-data-source.test.mjs scripts/codex-ingest-cli-args.test.mjs src/components/training/__tests__/training-flywheel-view.test.ts` 通过：`154 passed`。
- `npm --silent exec vitest -- run src/components/dashboard/__tests__/research-cockpit-helpers.test.ts` 通过：`105 passed`。
- `cargo test research_cockpit --lib` 通过：`4 passed`，仅保留既有 Rust warning。
- `npm --silent run codex:ingest -- stock-feedback verify --project /Users/jiegege/Desktop/杰杰杰` 返回 `status=ok`，当前检查到 `49` trajectories、`145` benchmark cases、`114` LoRA-ready candidates、`6` manifests、`1` paper trade。
- `npm run build` 通过；仅保留既有 Vite dynamic import / chunk 警告。
- `git diff --check` 通过。
- 真实 Tushare token 与旧假密钥字符串未进入仓库。
