# 递归自训练交易 AI 工程蓝图：用 agent-skills 固化假设库闭环

生成日期：2026-06-16
定位：AI-native 主动管理假设生命周期系统
工程治理框架：`addyosmani/agent-skills`

## 1. 一句话结论

我们不是在做一个更快读研报的问答 CLI，而是在做一套可以持续生产、跟踪、验证、复盘和改进投资假设的系统。

`agent-skills` 的价值不在于直接提供交易能力，而在于把这套系统的开发过程变成可审计、可拆分、可测试、可复盘的工程流程：

```text
想法澄清 -> 规格定义 -> 任务拆分 -> 小步实现 -> 测试验证 -> 代码审查 -> 文档和发布
```

对应到我们的投研系统，就是：

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

## 2. 当前项目状态

### 2.1 发布准备状态

工具仓库在：

```text
/path/to/trading-review-wiki
```

本文对应的发布准备分支是：

```text
codex/agentic-recursive-ai
```

目标合并基线是：

```text
main@6d71625
```

因此后续讨论能力时要分清两层：

| 层级 | 状态 | 说明 |
|---|---|---|
| `main@6d71625` 基线能力 | 已稳定 | `ask`、摄入、market-validate、daily-loop、self-train、company-research、temporal-facts、concept governance 等 |
| `codex/agentic-recursive-ai` 分支能力 | v0.11.0 合并候选 | CLI 拆分、多智能体 `ask --agentic`、autoresearch program/score/ledger/proposal、policy proposal、plugin-led 公司深研 V2 等 |
| 下一步目标 | 规划落地 | Hypothesis Library V1，把假设生命周期变成自训练样本入口 |

### 2.2 当前主线已有能力

| 能力 | 意义 | 当前边界 |
|---|---|---|
| `prepare/api-run/finalize/apply` | 把原始材料转成 staged ingest，再人工可控地应用 | `apply` 默认 dry-run，`raw/` 不由 ingest/apply 自动写 |
| `ask` | 只读检索 wiki/raw/facts/brain/stock-price 后回答问题 | 默认只读，可打印 context/source |
| `ask eval` | 评估检索召回、相关性、结构和噪声 | 写入只限 `.llm-wiki/eval/**` |
| `market-validate` | 对预测和股票做行情窗口验证 | `--write` 才写 data/brain |
| `daily-loop` | 盘前/盘后生成问题、验证 pending、沉淀反馈 | `--write` 才写 data/brain 和 `.llm-wiki/**` |
| `self-train` | 从反馈中产生自训练动作 | 先是 action，不是自动改系统 |
| `export-samples` | 导出训练/偏好/评测样本 | 面向后续训练集治理 |
| `company-research --deep` | 公司深度研究、公告/财务/模型工作簿 | 输出 `.llm-wiki/company-research/**`，不写正式 wiki |
| temporal/concept governance | 治理时效事实和概念层级 | 审计优先，写入受控 |

### 2.3 agentic 分支已经指向的能力

`codex/agentic-recursive-ai` 分支把项目向 Phase 5 推进了一步：

| 能力 | 意义 | 产物 |
|---|---|---|
| `ask --agentic` | 证据研究、反证审计、市场验证、交易策略并发推演，最后 adjudicator 汇总 | `.llm-wiki/agent-runs/**` |
| segment/topic candidate market validation | 主题问题不只抽泛股票，而是按细分环节构建候选池 | agent run / market validation context |
| `autoresearch program` | 自然语言研究计划，类似主动管理里的 research program | `.llm-wiki/research-programs/**` |
| `autoresearch score` | 锁定评估器，不允许 AI 每轮自改评分标准 | score JSON |
| `autoresearch ledger append/list` | 记录每次实验改了什么、分数变化、keep/discard/review_required | `.llm-wiki/experiments/experiment-ledger.jsonl` |
| `autoresearch proposal` | 从实验账本生成待审核策略改进建议 | `.llm-wiki/policy-proposals/**` |

这些能力的共同原则是：可以提出建议，可以沉淀证据，不自动污染正式 wiki，不自动交易。

## 3. 核心产品定义：假设生命周期管理

主动管理最后下注的不是一篇研报，而是一条在特定时间、赔率、组合暴露和风险约束下的投资假设。

所以系统核心资产应该从“研报库”升级为“假设库”：

```text
Hypothesis Library
= 主观投资里的因子库
= 自训练系统的记忆体
= 多智能体研究的任务池
= 市场反馈和归因的承载对象
```

### 3.1 假设生命周期

建议 V1 使用以下状态：

| 状态 | 含义 | 系统动作 |
|---|---|---|
| `seed` | 初始观察或弱信号 | 建立假设卡片，列出验证变量 |
| `watching` | 观察中 | 绑定主题、细分环节、候选公司和后续验证日期 |
| `strengthening` | 证据增强 | 提高跟踪优先级，触发 agentic ask |
| `actionable` | 接近可下注 | 生成报告和人工决策建议 |
| `priced_in` | 可能已被市场定价 | 降低赔率分，跟踪拥挤和回撤 |
| `divergent` | 市场或基本面反馈背离 | 触发反证审计和归因 |
| `disconfirmed` | 核心证据被证伪 | 进入复盘样本和策略降权建议 |
| `archived` | 归档 | 保留历史，不再主动追踪 |

### 3.2 假设卡片最小字段

```json
{
  "id": "hypo_mpo_cpo_slowdown_benefit_202606",
  "title": "CPO增速放缓可能推动MPO连接器量价齐升",
  "theme": "AI数据中心互联",
  "segments": ["MPO", "CPO", "高速连接器"],
  "status": "watching",
  "conviction": 0.46,
  "timeHorizon": "6-18个月",
  "keyVariables": [
    "MPO单柜用量",
    "800G/1.6T交换机出货",
    "客户订单",
    "ASP变化",
    "毛利率变化",
    "财报收入确认"
  ],
  "evidenceRefs": [],
  "marketRefs": [],
  "risks": [
    "CPO渗透速度超预期",
    "MPO竞争导致价格下行",
    "卖方叙事先行但订单不足"
  ],
  "nextValidationDate": "2026-07-15"
}
```

### 3.3 一条信息如何进入闭环

例子：卖方研究称“CPO 未来增速放缓，利好 MPO 量价齐升”。

系统不应该只把它存成研报摘要，而应该做：

```text
1. 识别主题：AI数据中心互联
2. 识别细分：CPO、MPO、高速连接器、光模块
3. 命中假设：MPO 可能受益于 CPO 节奏变化
4. 更新状态：watching -> strengthening 或 review_required
5. 触发验证：候选公司、订单、ASP、毛利率、财报、市场量价
6. 生成报告：是订单兑现、叙事扩散，还是赔率已被市场压缩
7. 写入实验账本：证据、分数、缺口、下一次验证日期
8. 生成人工审核 proposal：该不该提高 segment 权重或证据优先级
9. 后续归因：confirmed / disconfirmed / divergent / insufficient / priced_in
10. 形成自训练样本：下次类似信号如何处理
```

## 4. 可行性分析

### 4.1 已经具备的基础

| 基础 | 为什么可复用 |
|---|---|
| 多源摄入和 staged apply | 已经有 dry-run、manifest、候选页面和写入边界 |
| `ask` 检索上下文 | 能把 wiki/raw/facts/brain/stock-price 汇入一个问题 |
| market validation | 已有价格和成交验证，能初步区分叙事和市场反馈 |
| daily-loop | 已有自动提问、验证 pending、沉淀反馈的循环雏形 |
| self-train/export-samples | 已有把反馈变成训练样本和 action 的通道 |
| agentic 分支 | 已经验证多智能体、autoresearch ledger、proposal 的工程方向 |
| `.llm-wiki/**` 审计区 | 适合作为所有实验、建议、样本的低风险落盘边界 |

### 4.2 主要缺口

| 缺口 | 影响 | 建议补法 |
|---|---|---|
| 财报结构化数据 | 无法验证收入、毛利率、存货、合同负债、现金流是否兑现 | Tushare 财务、CNINFO 年报/季报解析、Wind/Choice/同花顺 iFinD 可选 |
| 公告和订单 | 无法判断主题是否进入正式订单/客户/交付 | CNINFO、交易所公告、企查查招投标 |
| 产业链深度变量 | 单柜用量、单集群用量、ASP、份额等难自动化 | 卖方深度报告、产业专家纪要、公司调研、手工维护 segment assumptions |
| 候选池精度 | 主题容易被光模块龙头或泛材料股带偏 | 维护 segment 配置：MPO、CPO、CCL、PCB、FAU、特种光纤等 |
| 组合和模拟交易反馈 | 无法把研究结论转成仓位语境 | Phase 8 建模拟组合、风险暴露、回撤和机会成本评估 |
| 人工决策记录 | 无法知道系统建议是否被采纳，以及原因 | 设计 decision journal，把人工 approve/reject 和理由写入审计区 |

### 4.3 风险判断

| 风险 | 控制方式 |
|---|---|
| AI 被卖方叙事带偏 | 强制反证 agent、订单/财报证据权重、hype_without_order_penalty |
| 市场反馈噪声大 | 多窗口验证，不把短期涨跌直接等同于基本面正确 |
| 数据源质量参差 | 所有来源带 sourceKind、evidenceLevel、timestamp |
| 自训练变成自嗨 | 锁定评估器、人工审核门、失败样本同样入库 |
| 自动化误写正式库 | 默认只写 `.llm-wiki/**`，正式 `wiki/` 和 `raw/` 继续受控 |
| 真实交易风险 | Phase 9 也只做受控真实交易建议，不做自动下单 |

## 5. 用 agent-skills 固化工程流程

`addyosmani/agent-skills` 应作为项目的“开发操作系统”。

| 项目阶段 | 使用技能 | 在本项目中的规则 |
|---|---|---|
| 想法澄清 | `idea-refine` | 把“想做 AI”收敛成可验证假设、变量、反馈路径 |
| 规格定义 | `spec-driven-development` | 每个 Phase 先写目标、边界、命令、产物、验收标准 |
| 任务拆分 | `planning-and-task-breakdown` | Phase 5B-9 拆成小任务，每个任务能单独测试和回滚 |
| 增量实现 | `incremental-implementation` | 一次只做一个薄切片，例如先 `hypothesis create/list` |
| 测试驱动 | `test-driven-development` | dry-run、不写 wiki/raw、ledger/schema、失败降级都要测试 |
| 接口设计 | `api-and-interface-design` | CLI 参数、JSON schema、artifact 目录先稳定再扩展 |
| 上下文工程 | `context-engineering` | 每次 agent run 带 sourceRefs、manifest、query、角色、时间 |
| 反证开发 | `doubt-driven-development` | 自动应用、评分器、交易建议、数据源接入必须被反证审查 |
| 代码审查 | `code-review-and-quality` | 合并前审 correctness/readability/architecture/security/performance |
| 安全加固 | `security-and-hardening` | Key 脱敏、日志脱敏、券商接口最小权限 |
| 可观测性 | `observability-and-instrumentation` | agent run、experiment、proposal、validation 都要有审计产物 |
| 文档决策 | `documentation-and-adrs` | 评分公式、写入边界、自动化阈值形成 ADR |
| 发布 | `shipping-and-launch` | 每个 Phase 有回滚路径、smoke test、下一步观测点 |

### 5.1 项目硬规则

后续开发默认遵守：

```text
1. 每个新 Phase 必须先有 spec。
2. 每个实验能力必须先支持 dry-run。
3. 每个写入必须明确目录边界。
4. 每个策略改进只能先生成 proposal。
5. 每个自动化升级必须经过 review gate。
6. 每个自训练样本必须保留 sourceRefs 和 outcome。
7. 任何真实交易动作都不允许自动执行。
```

### 5.2 标准实现流程

```text
Spec
-> Task Breakdown
-> Thin Slice
-> Unit/Integration Test
-> Dry-run Artifact Check
-> Doubt Review
-> Code Review
-> Docs/ADR
-> Commit
```

## 6. Phase 5A 到 Phase 9 路线

| Phase | 目标 | 自动化权限 | 验收标准 |
|---|---|---|---|
| Phase 5A | AI 提出改进建议，不自动应用 | 只写 proposal | `autoresearch program/score/ledger/proposal` 可跑，proposal 明确 `autoApply=false` |
| Phase 5B | Hypothesis Library V1 | 只写 `.llm-wiki/hypotheses/**` | 可 create/list/report/update-from-article/validate |
| Phase 5C | 假设事件路由 | 只更新假设事件和报告 | 新摄入材料能命中已有假设、更新证据链、生成变更报告 |
| Phase 6 | 人工批准后应用低风险配置改动 | approve 后可改低风险配置 | 支持 segment_config、market_validator_params、evidence_task_priority 的人工批准应用 |
| Phase 7 | 达到多次验证阈值后，部分低风险策略自动应用 | 仅低风险、可回滚 | 需要多次 confirmed、无安全风险、自动生成回滚记录 |
| Phase 8 | 模拟交易闭环验证 | 只做 paper trading | 研究结论进入模拟组合，验证收益、回撤、拥挤、机会成本 |
| Phase 9 | 受控真实交易建议 | 不自动下单 | 只输出建议、风险、仓位边界和人工确认清单 |

## 7. Hypothesis Library V1 实施建议

### 7.1 CLI 形态

第一版建议只新增低风险命令：

```sh
npm run codex:ingest -- hypothesis create --title "..." --theme "..." --segments MPO,CPO --write
npm run codex:ingest -- hypothesis list
npm run codex:ingest -- hypothesis report --id <hypothesis-id>
npm run codex:ingest -- hypothesis update-from-article --source <raw-or-md-file> --write
npm run codex:ingest -- hypothesis validate --id <hypothesis-id> --window 20d
```

### 7.2 写入边界

第一版只允许写：

```text
.llm-wiki/hypotheses/**
.llm-wiki/hypothesis-events/**
.llm-wiki/hypothesis-reports/**
```

不允许写：

```text
wiki/**
raw/**
真实交易动作
券商委托
核心 prompt 自动应用
```

### 7.3 自训练样本连接

假设生命周期的每次结果都可以变成样本：

```json
{
  "hypothesis": "CPO增速放缓可能利好MPO连接器量价齐升",
  "initialEvidence": ["卖方研究", "产业链事件"],
  "segments": ["MPO", "CPO", "高速连接器"],
  "agentConclusion": "重点验证MPO订单、ASP、客户份额和毛利率",
  "marketFeedback": "相关公司放量上涨但订单证据不足",
  "fundamentalFeedback": "暂无公告或财报确认",
  "outcome": "insufficient",
  "errorType": "hype_without_order",
  "lesson": "类似信号不能直接提高置信度，必须等待订单/客户/ASP证据",
  "policySuggestion": {
    "target": "evidence_task_priority",
    "change": "提高订单和ASP证据权重，降低卖方叙事权重"
  }
}
```

## 8. 数据源优先级

### 8.1 第一优先级：闭环必需

| 数据源 | 用途 |
|---|---|
| Tushare 行情/财务 | 行情、估值、利润表、资产负债表、现金流 |
| CNINFO 公告/财报 | 正式公告、定期报告、订单、客户、募投、问询 |
| 企查查招投标 | 订单、客户、项目、产业链兑现线索 |
| 本地 stock daily SQL | 价格、成交、换手、窗口验证 |

### 8.2 第二优先级：产业深度

| 数据源 | 用途 |
|---|---|
| 卖方深度报告 | 单柜用量、ASP、产业链拆解、供需模型 |
| 专家纪要/调研纪要 | 订单节奏、客户份额、价格变化、交付瓶颈 |
| 公司 IR/互动易/业绩会 | 管理层真实信心、业务口径变化 |
| 产业新闻/供应链事件 | 早期信号和催化 |

### 8.3 第三优先级：交易闭环

| 数据源 | 用途 |
|---|---|
| 模拟组合记录 | 验证研究是否能进入仓位语境 |
| 人工决策日志 | 记录采纳/拒绝原因 |
| 持仓和风险暴露 | Phase 9 前置，不进入自动交易 |

## 9. 最终呈现方式

本项目应有三层呈现：

| 呈现 | 受众 | 内容 |
|---|---|---|
| Markdown 工程蓝图 | 自己和后续 agent | 架构、路线、边界、测试、数据源、工程流程 |
| PPT/PDF | 对外讲解或团队沟通 | 为什么是假设库、现状、闭环图、Phase 路线、风险控制 |
| CLI 使用手册 | 日常操作 | 每个命令怎么用、输入输出是什么、何时该用 |

PPT 建议 12 页以内，重点不是炫技，而是讲清：

```text
1. 我们要解决什么问题
2. 为什么研报库不够
3. 为什么是假设库
4. 当前系统已经有哪些积木
5. agent-skills 如何保证工程质量
6. 后续怎么走到自训练闭环
7. 哪些风险永远不自动化
```

## 10. 下一步执行清单

### 10.1 立即可做

```text
1. 合并/确认 codex/agentic-recursive-ai 分支中已完成能力。
2. 对 agentic/autoresearch 跑完整测试和 smoke。
3. 新建 Hypothesis Library V1 spec。
4. 按 agent-skills 流程拆成 3-5 个小任务。
5. 先实现 hypothesis create/list/report。
```

### 10.2 Phase 5B 验收

```text
1. 每条假设有 ID、状态、segments、keyVariables、evidenceRefs。
2. 新信息可以 update-from-article，生成 hypothesis event。
3. report 能展示假设状态、证据增强/削弱、缺口和下一次验证。
4. validate 能读取行情/公告/财报线索并给出 confirmed/divergent/disconfirmed/insufficient。
5. export-samples 能把完整假设生命周期变成训练样本。
6. 所有写入只发生在 .llm-wiki/**。
```

## 11. 结论

这套系统的长期目标不是“让 AI 自动赚钱”，而是先把主动管理中最稀缺的判断资产系统化：

```text
假设从哪里来？
证据如何变化？
市场如何反馈？
基本面是否兑现？
如果错了，错在哪里？
系统下一次应该如何更敏锐？
```

`agent-skills` 给我们的是工程纪律。假设库给我们的是投研资产。自训练闭环给我们的是长期进化机制。

下一步最值得做的是 **Hypothesis Library V1**：只读、可审计、可验证、人工审核前置，把每次投研判断变成未来可训练、可复盘、可改进的样本。
