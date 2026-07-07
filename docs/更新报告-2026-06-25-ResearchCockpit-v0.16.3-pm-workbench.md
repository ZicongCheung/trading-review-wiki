# 更新报告：Research Cockpit v0.16.3 日常投研工作台

版本：`v0.16.3-research-cockpit-pm-workbench`

日期：2026-06-25

## 目标

本次更新把 Research Cockpit 继续从“工程控制台”收敛成基金经理每天能直接使用的工作台。首页的核心问题不是“系统跑了多少模块”，而是：

> 今天有什么新信号，会不会改变我正在跟踪的假设？

主流程固定为：

```text
AI 并发找假设
-> 假设表跟踪
-> 微信 / 研报新闻 / Gangtise 产业链复盘等新增资料扫描
-> 待处理卡片
-> Ask 深挖
-> 人工确认状态
-> 假设轨迹沉淀
```

## 本次重点变化

### 1. 待处理卡片降噪

待处理区继续按基金经理的决策顺序组织，而不是按工程日志堆叠：

- 今天优先
- 叙事扩散
- 候选新假设
- 建议 Ask
- 待确认状态变化

同一来源、同一假设、同类软信号会聚合展示，减少重复卡。日期、编号、弱标题、泛词和不成假设的碎片信息不再默认变成候选假设。

### 2. 状态机合法转移

新增假设状态迁移守卫，覆盖：

```text
seed
watching
strengthening
actionable
priced_in
divergent
disconfirmed
archived
```

扫描新增资料只产生建议状态；只有用户点击确认，才通过 `hypothesis status-update --write` 更新 `.llm-wiki/hypotheses/**` 和 `.llm-wiki/hypothesis-events/**`。

### 3. source filter 真正生效

`hypothesis watch --source <path>` 已贯通 CLI 和 Tauri action。用户在 UI 里选择单个微信文档、研报新闻目录或 Gangtise 主题目录时，扫描只处理选中的来源，避免全量 inbox 或旧文件污染本轮结果。

### 4. Gangtise / OpenClaw 产业链复盘 parser

新增 Gangtise 专用解析路径，把产业链复盘里的主题、细分、公司、催化、风险、来源摘要拆成更适合假设路由的信号。

这使 `raw/openclaw数据/产业链复盘/gangtise_themes` 能作为日常新增资料源接入 Research Cockpit，而不是被当作普通微信聊天文本。

### 5. Wiki 表头和金融实体词复用

Watchtower、`hypothesis discover` 和 `update-from-article` 可以复用 live wiki 的金融实体审计表与页面表头，把以下信息接回日常判断：

- 股票 / 公司
- 产品线 / 技术路线
- 催化变量
- 风险因子
- wiki 页面 `status / confidence / momentum / catalysts`

目的不是做更复杂的验证，而是让新增舆情能回到已有 wiki 框架和假设池里。

### 6. Ask 深挖反馈更明确

单条假设的 Ask 深挖默认复用现有 `ask --agentic` 检索链路。UI 现在强调：

- 是否已经开始跑
- 是否命中缓存
- 结果在哪里
- 结构化摘要
- 完整六段回答
- 证据强度
- 下一步动作

避免此前“点了 Ask 但不知道回答显示在哪”的交互问题。

## 写入边界

本版继续保持安全边界：

- 自动扫描只写 `.llm-wiki/wechat-inbox/**`
- 状态确认才写 `.llm-wiki/hypotheses/**`
- 事件和 alerts 只写 `.llm-wiki/hypothesis-events/**` / `.llm-wiki/hypothesis-alerts/**`
- 不自动写正式 `wiki/**`
- 不改旧 `raw/**`
- 不触发真实交易
- Tauri 前端只允许固定 action，不拼任意 shell

## 主要更新文件

- `scripts/codex-ingest/internal/hypothesis.mjs`
- `scripts/codex-ingest/cli/index.mjs`
- `scripts/codex-ingest/cli/help.mjs`
- `src-tauri/src/commands/research_cockpit.rs`
- `src/components/dashboard/research-cockpit-view.tsx`
- `src/components/dashboard/research-cockpit-helpers.ts`
- `src/components/dashboard/__tests__/research-cockpit-helpers.test.ts`
- `scripts/codex-ingest-lib.test.mjs`
- `README.md`
- `CHANGELOG.md`

## 使用方式

### 1. AI 并发找假设

在 Research Cockpit 首页点击 `AI 并发发现假设`，输入主题，例如：

```text
AI 数据中心互联
```

系统会生成候选假设。用户确认后才加入跟踪。

### 2. 选择新增资料源

优先选择以下来源之一：

```text
raw/微信聊天
raw/研报新闻
raw/openclaw数据/产业链复盘/gangtise_themes
```

微信适合看短线舆情和新增催化；研报新闻适合看主题扩散和卖方表达；Gangtise 产业链复盘适合看细分链条和公司线索。

### 3. 扫描新增资料

点击 `只扫这条 + AI 复核` 或对应扫描按钮。系统会：

```text
导入/去重
-> 规则路由
-> 可选 LLM 复核
-> 聚合待处理卡片
```

扫描只产生建议，不直接改假设状态。

### 4. 处理待处理卡片

每张卡优先回答：

- 这是什么信号？
- 影响哪条假设？
- 建议状态变不变？
- 为什么？
- 交易含义是什么？
- 下一步是确认、Ask 深挖，还是忽略？

### 5. Ask 深挖

对需要进一步判断的卡片点击 `Ask 深挖`。系统会输出关联股票、直接受益、利好排序、当前阶段、最大缺口、一句话结论和原 ask 六段回答。

### 6. 人工确认状态

只有当你确认信号足够改变假设状态时，点击确认。系统才会把状态变更写入假设库和事件审计链。

## 验证命令

本版本发布前执行以下验证：

- `npm test -- --run src/components/dashboard/__tests__/research-cockpit-helpers.test.ts --testTimeout 60000` 通过：`246 passed`。
- `npm test -- --run scripts/codex-ingest-lib.test.mjs --testTimeout 60000` 通过：`295 passed`。
- `npm run build` 通过；仅保留既有 Vite dynamic import / chunk size 警告。
- `cargo test --manifest-path src-tauri/Cargo.toml research_cockpit -- --nocapture` 通过：`6 passed`，仅保留既有 Rust warning。
- `git diff --check` 通过。

## 后续建议

下一步不建议继续堆更多按钮，而是继续沿“信息流”优化：

1. 每张卡片进一步压缩成 `信号 -> 假设 -> 交易含义 -> 下一步动作`。
2. Ask 深挖结果增加“股票排序是否可执行”的显式标签。
3. 假设详情页补 Timeline，让一条假设从 seed 到 strengthening / priced_in 的轨迹更清楚。
4. 自动跟踪继续保持建议模式，确认权留给人。
