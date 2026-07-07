# 更新报告：Research Cockpit v0.16.4 Alpha Feed

版本：`v0.16.4-research-cockpit-alpha-feed`

日期：2026-06-28

## 版本定位

v0.16.4 把 Research Cockpit 从“功能面板集合”进一步收敛成个人投研待办箱。首页目标不是展示后台跑了多少模块，而是让基金经理打开后 10 秒内回答：

> 今天有什么新信号，会不会改变我正在跟踪的假设？

新版前台原则：

```text
提醒积极，状态保守。
前台极简，后台强大。
Ask 手动触发。
状态人工确认。
```

## 本次重点变化

### 1. Alpha Feed 首页

首页默认只展示少量今日优先待办，并在顶部摘要展示：

- 今日优先
- 需要 Ask
- 建议确认
- 已折叠噪声

后台的 self-train、proposal、experiment ledger、补证详情、debug/audit artifacts 继续保留，但默认不污染首页。

### 2. 待处理卡片改成 PM 决策卡

每张卡片必须回答：

- 这是什么信号？
- 影响哪条假设？
- 建议动作是什么？
- 交易含义是什么？
- 下一步应该 Ask、确认，还是忽略？

卡片不再默认展示长证据缺口列表、英文内部 reason、`.llm-wiki/**` 路径和 agent run 细节。

### 3. 假设质量门

AI 并发发现假设和候选新假设增加中观机制约束。合格假设必须包含：

```text
产业方向 + 细分环节 + 变化机制 + 可跟踪证据
```

太宽的主题会折叠，例如：

- AI 算力继续景气
- PCB 有投资机会
- 国产替代会受益

太细的单条消息也不会直接变成正式假设，例如：

- 某个群一天提到某家公司涨价
- 单一文章提到一条订单线索
- 某一天某只股票放量

### 4. 信源分工更清楚

Research Cockpit 会把新增资料分成不同来源类型：

- 微信聊天：新催化、舆情、新说法、市场正在讨论什么。
- 研报新闻 / IMA / 公众号 / raw 新闻：逻辑链、卖方表达、产业叙事、候选公司。
- Gangtise / 产业链复盘 / 公告 / 招投标 / 财报：细分环节、订单、客户、ASP、交付、收入兑现等更硬验证。

UI 不再把 Gangtise 或研报新闻统称为“微信文档”。

### 5. L0-L3 信号分层

状态建议改为保守口径：

- `L0 新催化`：有新信息，值得看，但通常不升级。
- `L1 二次确认`：多个来源重复出现，才考虑 strengthening。
- `L2 市场反馈`：相关股票开始反应，提示 Ask 深挖或 priced-in 风险。
- `L3 硬证据`：公告、订单、财报、招投标验证，才可能建议 actionable。

原则是：卡片提醒可以积极，状态变化必须保守。

### 6. 假设轨迹 Timeline

新增资料优先路由到已有假设，成为 hypothesis event，而不是默认生成新假设。

事件字段包括：

```json
{
  "hypothesisId": "...",
  "eventTime": "...",
  "sourceRef": "...",
  "sourceType": "wechat|research_news|gangtise_theme|announcement|market",
  "signalType": "新催化|二次确认|市场反馈|硬证据|反证|叙事扩散",
  "signalStrength": "low|medium|high",
  "statusBefore": "watching",
  "suggestedStatus": "strengthening",
  "reason": "...",
  "tradingImplication": "...",
  "askRunRef": null
}
```

同一来源、同一假设、同类信号会聚合展示，避免重复消息堆叠。

### 7. Ask 深挖结果可见性

点击 `Ask 深挖` 后，UI 会显示：

- 卡片运行中
- 顶部状态
- 是否命中缓存
- 失败原因
- 结果区位置

结果区先显示结构化摘要：

- 一句话结论
- 关联股票
- 最直接受益
- 利好排序
- 当前阶段
- 最大缺口
- 下一步验证

下方再保留完整 ask 六段回答和来源。

## 写入边界

本版继续保持低风险边界：

- 自动扫描只写 `.llm-wiki/wechat-inbox/**`
- 状态确认才写 `.llm-wiki/hypotheses/**`
- 事件和 alerts 只写 `.llm-wiki/hypothesis-events/**` / `.llm-wiki/hypothesis-alerts/**`
- 不自动写正式 `wiki/**`
- 不改旧 `raw/**`
- 不触发真实交易
- Tauri 前端只允许固定 action，不拼任意 shell

## 主要更新文件

- `src/components/dashboard/research-cockpit-view.tsx`
- `src/components/dashboard/research-cockpit-helpers.ts`
- `src/components/dashboard/__tests__/research-cockpit-helpers.test.ts`
- `CHANGELOG.md`
- `docs/research-cockpit-operation.md`
- `package.json`
- `package-lock.json`
- `src-tauri/Cargo.toml`
- `src-tauri/Cargo.lock`
- `src-tauri/tauri.conf.json`

## 日常操作流程

```text
1. 打开 Research Cockpit
2. 看 Alpha Feed 顶部摘要：今日优先 / 需要 Ask / 建议确认 / 已折叠噪声
3. 若没有可跟踪假设，先点 AI 并发找假设
4. 选择 raw/微信聊天、raw/研报新闻 或 raw/openclaw数据/产业链复盘/gangtise_themes
5. 扫描新增资料
6. 处理今日优先卡：Ask / 确认 / 忽略
7. Ask 完成后先看结构化摘要，再展开六段回答
8. 只有人工确认后，状态才写入假设轨迹
```

## 验证命令

本版本发布前执行以下验证：

- `npm test -- --run src/components/dashboard/__tests__/research-cockpit-helpers.test.ts --testTimeout 60000` 通过：`251 passed`。
- `npm test -- --run scripts/codex-ingest-lib.test.mjs --testTimeout 60000` 通过：`295 passed`。
- `npm run build` 通过；仅保留既有 Vite dynamic import / chunk size 警告。
- `cargo test --manifest-path src-tauri/Cargo.toml research_cockpit -- --nocapture` 通过：`6 passed`，仅保留既有 Rust warning。
- `git diff --check` 通过。

## 下一阶段版本

下一阶段建议开 `v0.16.5-alpha-feed-beta`，主题是 Alpha Feed 真实日常可用性打磨：

- 用真实一天新增资料回放排序是否合理。
- 强化空状态和无新增解释。
- 让 `Ask / 确认 / 忽略` 的反馈更像任务处理，而不是后台命令。
- 增加每张卡的“为什么排在这里”解释。
- 继续压低噪声候选，避免单条碎片消息变成假设。
