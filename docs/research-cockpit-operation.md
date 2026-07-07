# Research Cockpit 操作说明

## 主线

Research Cockpit 的目标不是再做一个研报库，而是维护假设生命周期：

```text
先有假设
-> 微信增量 / raw 微信聊天 / 补充资料进入 inbox 或 supplements
-> Watchtower 扫描并路由到假设
-> 生成 dry-run events / alerts / candidate hypotheses
-> 人工确认写入
-> dashboard 显示反馈状态
-> 后续进入策略建议、自训练计划和样本沉淀
```

## 打开方式

桌面版使用 Tauri 宿主运行：

```sh
npm run tauri dev
```

打开项目后，左侧进入 `研究驾驶舱`。

普通浏览器直连 Vite 只能看页面壳，不能执行本地文件和 Tauri 命令。

## 标准流程

1. 创建假设

```sh
npm run codex:ingest -- hypothesis create \
  --title "CPO增速放缓可能推动MPO连接器量价齐升" \
  --theme "AI数据中心互联" \
  --segments MPO,CPO,高速连接器 \
  --write
```

2. 同步最新消息

在面板点 `刷新`，系统会：

- 处理 `.llm-wiki/wechat-inbox/incoming/**`
- 扫描 `wechat_incremental,hypothesis_supplement`
- 手动扫描会对规则层筛出的小批量候选做 LLM 复核；自动跟踪仍默认规则层，避免高频调用模型
- 显示待确认 alerts 和候选新假设

微信未登录时，用 `微信增量观察` 区域的 `raw 预览` / `导入并扫描`，默认读取：

```text
raw/微信聊天
```

3. 提交补充资料

在 `补充资料 / 缺口补证` 里粘贴路演文件、表格摘要、公告片段或调研纪要。

- `假设 ID` 可选；填写后会强制路由到对应假设。
- `预览补资料` 不落盘。
- `提交并扫描` 只写 `.llm-wiki/hypothesis-supplements/**`，然后触发 Watchtower dry-run。

4. 人工确认

如果 dry-run alerts 合理，点 `确认写入`。

确认后只写：

```text
.llm-wiki/hypothesis-events/**
.llm-wiki/hypothesis-alerts/**
```

不会写：

```text
wiki/**
raw/**
真实交易动作
```

## 状态含义

- `seed`：初始观察
- `watching`：观察中
- `strengthening`：证据增强
- `actionable`：接近可下注，仍需人工决策
- `priced_in`：市场可能已充分定价
- `divergent`：走势和假设背离
- `disconfirmed`：被证伪
- `archived`：归档

Dashboard 里的 `feedbackStatus` 是派生反馈状态，不会自动改假设 JSON 里的正式 `status`。

## 首页和高级实验室怎么分工

### v0.16.4 Alpha Feed 使用口径

这一版首页默认只回答一个问题：

```text
今天有什么新信号，会不会改变我正在跟踪的假设？
```

打开 Research Cockpit 后，先看顶部摘要和 `今日优先` 卡，不要先进入高级后台：

- `今日优先`：系统认为最值得先看的 3-5 条投研待办。
- `需要 Ask`：新信号已经命中假设，但需要用 `ask --agentic` 深挖股票、链条、受益排序和证据来源。
- `建议确认`：信号可能推动状态变化，但只有你点确认才会写假设状态。
- `已折叠噪声`：太宽、太细、重复、纯日期编号或低质量候选被压到后台。

每张 Alpha Feed 卡片只看四件事：

```text
信号是什么
影响哪条假设
建议动作是什么
交易含义是什么
```

信号分层采用保守状态口径：

- `L0 新催化`：值得看，但通常不升级状态。
- `L1 二次确认`：多个来源重复出现，才考虑 `watching -> strengthening`。
- `L2 市场反馈`：相关股票开始反应，优先 Ask 深挖或提示 `priced_in` 风险。
- `L3 硬证据`：公告、订单、财报、招投标等验证，才可能建议 `actionable`。

日常操作顺序建议固定为：

```text
1. AI 并发找中观假设，确认后加入跟踪
2. 选择 raw/微信聊天、raw/研报新闻 或 raw/openclaw数据/产业链复盘/gangtise_themes
3. 扫描新增信号，查看今日优先卡
4. 对有价值的卡点 Ask 深挖
5. 看摘要和六段回答后，确认状态或忽略
6. 状态轨迹沉淀到 .llm-wiki/**，后续自训练和复盘读取这些记忆
```

后台仍然保留 Watchtower、agentic ask、market validation、events、self-train、proposal 和 ledger，但默认折叠。只有当一条信号值得继续做补证、复盘或训练样本沉淀时，再打开高级后台。

### v0.16.3 日常使用口径

这一版把首页进一步收敛成基金经理每日工作台。优先顺序是：

```text
AI 并发找假设
-> 形成/刷新假设表
-> 扫描微信或新增资料
-> 看待处理卡
-> 对值得研究的信号点 Ask 深挖
-> 人工确认状态，沉淀到假设记忆
```

如果首页出现很多信号，不要逐条看工程细节，先看 `待处理` 的分层：

- `今天优先`：可能需要确认或 Ask 深挖。
- `叙事扩散`：有讨论热度，但暂时不足以升级假设。
- `候选新假设`：不是已有假设的状态更新，先 Ask 预检或加入跟踪。

`Ask 深挖` 的回答会先显示结构化摘要，包括关联股票、直接受益、利好排序、当前阶段、最大缺口和一句话结论；完整六段回答在摘要下方展开。若结果来自缓存，页面会提示“这条信号已 Ask 过”，可以直接看结果，也可以重新触发搜索。

### 首页：基金经理每日工作台

首页只处理当天最常用的四件事：

1. `AI 并发找假设`：从 wiki/知识库里并发设计问题，生成候选假设。
2. `扫描微信新增`：读取当前微信聊天文档新增内容，生成待处理卡片。
3. `自动跟踪`：每 30 秒导入和扫描一次新增舆情，但不自动改假设状态。
4. `刷新`：重新读取假设表、alerts、微信 inbox 和最近运行结果。

首页的判断逻辑是：

```text
今天有什么新信号
-> 命中了哪条假设
-> 建议状态要不要变
-> 现在应该确认、Ask 深挖，还是忽略
```

### 今天先手怎么看

待处理区顶部会先给一张 `今天先手` 焦点卡。它不是工程日志，而是基金经理的第一眼判断：

- `今天先确认`：新增信号已经建议改变假设状态，先复核来源，再点焦点卡右侧的 `确认状态`。
- `今天先研究`：当前更像新催化或链条扩散，先点 `Ask 深挖`，让系统输出关联股票、直接受益、利好排序和来源。
- `今天先筛选`：这是候选新假设，先做 `Ask 预检` 或决定是否 `加入跟踪`。
- `等待新信号 / 今天先观察`：当前没有值得立刻处理的信号，继续扫描或等二次确认。

焦点卡会同时显示安全边界：确认才写 `.llm-wiki` 假设记忆，Ask 只生成研究材料，不自动改假设状态，不写 `wiki/**` 或 `raw/**`。

### Wiki 表头怎么用

如果信号命中了已有 wiki 页面，焦点卡和待处理卡会显示 `Wiki表头`，例如：

```text
活跃框架，中置信，热动量，催化 CPO节奏放缓/MPO跳线需求
```

这行来自 wiki 页面的结构化 frontmatter / 表头字段：

- `status`：这个框架是活跃、观察、归档还是已证伪。
- `confidence`：当前框架的研究置信度。
- `momentum`：主题热度或动量。
- `catalysts`：正在跟踪的催化变量。

实际使用时不要只看微信文本本身，而是看它是否回连到一个“活跃、较高置信、仍有催化”的 wiki 框架。命中归档或冷动量框架时，除非出现硬证据或强反转信号，不要直接升级假设。

### 信息流路径怎么读

每张待处理卡片会展示一条 `信息流`：

```text
来源 -> 框架 -> 对象 -> 动作
```

- `来源`：微信 processed、补充资料、wiki 增量或其他来源。
- `框架`：命中的 wiki 页面和表头上下文。
- `对象`：影响的已有假设，或候选新假设。
- `动作`：确认状态、Ask 深挖、Ask 预检、加入跟踪或本轮忽略。

如果你点了 `本轮忽略`，页面会显示忽略成功提示；如果点了 `确认状态`，页面会显示“已确认：假设标题 · 状态变化”和对应 `.llm-wiki` 审计路径；如果点了 `Ask 深挖`，页面会提示结果展示位置，并在 `Ask 深挖结果` 区显示结构化摘要和完整六段回答。

### 高级实验室：递归研究和补证工作区

高级实验室默认折叠，只有当某条假设值得继续推进时再打开。它包含：

- `闭环状态`：读取自提问、实验账本、策略建议、自训练待审动作，确认递归链路当前卡在哪一步。
- `dry-run 闭环`：预演 `自提问 -> 验证 -> 归因 -> 证据缺口 -> 策略建议 -> 自训练计划 -> 导出`，不直接污染正式库。
- `策略建议 dry-run`：根据实验账本生成待审核 policy proposal。
- `写入 proposal`：只写 `.llm-wiki/policy-proposals/**`，不自动应用策略。
- `自训练计划 dry-run`：把待审动作整理成训练计划预览。
- `写入训练计划`：只写 `.llm-wiki/self-training-plans/**`，不训练模型、不自动改 prompt。
- `补证对话 / 数据源搜集`：粘贴路演、表格、公告、调研纪要，或写“去 IMA/CNINFO/企查查/Tushare 补 MPO 订单和 ASP”，让 LLM 先整理成补证草稿。
- `微信增量观察`：查看 raw 微信 fallback 文件导入、去重、processed、dry-run events/alerts 和候选假设。
- `阶段进度 / 阶段输出`：排查每一步是否真的运行，以及失败原因。
- `假设状态列表 / alerts / 候选新假设 / 策略建议 / 自训练待审动作 / 实验账本 / 证据缺口`：用于复盘和工程审计。

简单说：日常先用首页；只有当一个信号真的值得继续追，才进高级实验室做补证、实验、proposal 和自训练样本沉淀。

## 命令行等价链路

```sh
npm run codex:ingest -- hypothesis wechat-inbox import-raw \
  --source raw/微信聊天 \
  --since 30m \
  --write

npm run codex:ingest -- hypothesis wechat-inbox process

npm run codex:ingest -- hypothesis supplement \
  --title "MPO路演补证" \
  --kind roadshow \
  --hypothesis-id <hypothesis-id> \
  --source-refs "roadshow.pdf,model.xlsx" \
  --body "客户订单、中标公告、交付节奏和财报收入继续验证，ASP价格保持上行。" \
  --write

npm run codex:ingest -- hypothesis watch \
  --sources wechat_incremental,hypothesis_supplement \
  --since 30m

npm run codex:ingest -- hypothesis watch \
  --sources wechat_incremental,hypothesis_supplement \
  --since 30m \
  --write

npm run codex:ingest -- hypothesis dashboard-data --json
```

## 高级实验室命令等价链路

```sh
# LLM 先把补充资料整理成结构化补证草稿
npm run codex:ingest -- hypothesis supplement-draft \
  --body "请补 MPO 订单、ASP、客户份额和财报收入验证" \
  --selected-sources ima,cninfo,qichacha,tushare \
  --hypothesis-id <hypothesis-id>

# 确认补证草稿后写入 supplements，并触发 Watchtower 扫描
npm run codex:ingest -- hypothesis supplement \
  --title "MPO订单与ASP补证" \
  --kind manual \
  --hypothesis-id <hypothesis-id> \
  --source-refs "IMA知识库,CNINFO,企查查,Tushare" \
  --body "整理后的补证摘要" \
  --write

# 读取递归研究状态
npm run codex:ingest -- self-question phase-status
npm run codex:ingest -- autoresearch status
npm run codex:ingest -- self-train next --limit 8

# 预演完整闭环，不自动应用
npm run codex:ingest -- self-question loop \
  --stages generate,validate,attribute,evidence,policy,self-train,self-train-plan,export

# 生成待审核策略建议
npm run codex:ingest -- autoresearch policy propose
npm run codex:ingest -- autoresearch policy propose --write

# 生成自训练计划
npm run codex:ingest -- self-train plan --limit 5
npm run codex:ingest -- self-train plan --limit 5 --write
```

## 当前边界

- 不做 token 级流式，只做阶段级进度。
- 不自动创建新假设，只输出 candidate hypotheses。
- 不自动应用策略建议。
- 不自动改 prompt、segment 配置或真实交易。
- 后续 Phase 5D/5E 再把 agentic events、proposal review 和 self-training export 接得更深。
