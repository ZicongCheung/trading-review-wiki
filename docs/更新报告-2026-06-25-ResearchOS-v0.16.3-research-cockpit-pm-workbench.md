# ResearchOS v0.16.3 更新报告：Research Cockpit PM Workbench

日期：2026-06-25

## 版本定位

v0.16.3 是 Research Cockpit 的日常可用性补强版。目标不是继续堆验证模块，而是让基金经理打开首页时能更快回答：

```text
今天有什么新信号？
影响哪条正在跟踪的假设？
现在应该确认、Ask 深挖，还是忽略？
```

## 主要变化

### 1. 待处理卡从工程日志变成 PM 决策流

- 待处理区按“今天优先 / 叙事扩散 / 候选新假设”等桶聚合。
- 同一 `hypothesis + source + evidenceDelta` 的重复信号会合并。
- 弱标题、纯日期、编号、泛词候选被压低或过滤，避免出现只有 `2026-06-19`、`3.` 这类卡片。
- 卡片文案改成中文投研口径：先说信号类型、影响假设、建议状态、为什么重要、下一步动作。

### 2. Wiki 表头和金融关键词进入 Watchtower

- `hypothesis discover`、`hypothesis update-from-article`、`hypothesis watch` 新增 `--finance-entity-audit-roots`。
- 也可用 `TRADING_WIKI_FINANCE_ENTITY_AUDIT_ROOTS` 指向 live wiki 或 `.llm-wiki/sag-entity-audit`。
- Watchtower 会读取 entity audit 表中的公司、股票、产品线、技术路线、催化、风险因子、交易模式等关键词，用于：
  - 增量消息和 wiki 框架回连；
  - 候选假设聚类；
  - 待处理卡的“为什么重要”解释；
  - Ask 深挖优先级提示。

### 3. Ask 深挖反馈变清楚

- `hypothesis ask` 默认跳过额外 LLM source-router，直接走已有 agentic ask 检索链路，减少一次不必要的模型路由和等待。
- UI 增加 Ask 的运行中、缓存复用、结果定位、结构化摘要、证据强度、下一步动作和完整六段回答入口。
- 如果 Ask 结果还没返回，页面会显示“正在跑哪一步”；如果复用缓存，会明确提示“这条信号已 Ask 过”以及结果展示位置。

### 4. Tauri 固定动作仍保持边界

- Research Cockpit 固定 action 在存在 live wiki entity audit 目录时自动附加默认 roots。
- 前端仍不能拼任意 shell。
- 自动跟踪只导入/去重/扫描，不自动改假设状态。
- 只有人工点击确认后，才写 `.llm-wiki/hypothesis-events/**` 和 `.llm-wiki/hypothesis-alerts/**`。

### 5. SAG 同步补稳

- `sag-sync` pending 队列按路径去重。
- 全树同步会跳过已 pending 文件，避免重复塞队列。
- 同一 wikiPath 重新同步时，会同时归档同路径旧文档和 state 里记录的旧 documentId。

## 使用方式

### 发现假设

```sh
npm run codex:ingest -- hypothesis discover \
  --theme "AI数据中心互联" \
  --question-count 5 \
  --concurrency 3 \
  --sources wiki,raw \
  --finance-entity-audit-roots /Users/jiegege/Desktop/杰杰杰
```

### 扫描新增舆情

```sh
npm run codex:ingest -- hypothesis watch \
  --sources wechat_incremental,hypothesis_supplement,raw \
  --since 1d \
  --compact \
  --llm-review auto \
  --finance-entity-audit-roots /Users/jiegege/Desktop/杰杰杰
```

### 单条假设 Ask 深挖

```sh
npm run codex:ingest -- hypothesis ask \
  --id <hypothesis-id> \
  --agent-concurrency 3 \
  --agent-timeout-ms 300000
```

## 写入边界

允许的自动/确认写入仍只在：

```text
.llm-wiki/wechat-inbox/**
.llm-wiki/hypotheses/**
.llm-wiki/hypothesis-events/**
.llm-wiki/hypothesis-alerts/**
.llm-wiki/hypothesis-dashboard/**
.llm-wiki/hypothesis-reports/**
.llm-wiki/hypothesis-supplements/**
```

明确不写：

```text
wiki/**
raw/**
真实交易动作
券商委托
核心 prompt 自动应用
```

## 验证

- `npm test -- --run scripts/codex-ingest-lib.test.mjs --testTimeout 60000` 通过：`286 passed`。
- `npm test -- --run src/components/dashboard/__tests__/research-cockpit-helpers.test.ts --testTimeout 60000` 通过：`201 passed`。
- `npm run build` 通过；仅保留既有 Vite dynamic import / chunk size 警告。
- `cargo test --manifest-path src-tauri/Cargo.toml research_cockpit -- --nocapture` 通过：`4 passed`，仅保留既有 Rust warning。
- `git diff --check` 通过。
