# PPT 讲稿大纲：AI-native 主动管理假设生命周期系统

生成日期：2026-06-16
建议页数：12 页
目标：向自己/团队讲清楚系统目的、现状、成长路径和工程治理方式。

## Slide 1：标题

标题：AI-native 主动管理假设生命周期系统
副标题：从研报库、问答 CLI 到可验证、自训练的交易研究闭环

讲者备注：

我们不是单纯做一个更快的资料整理工具，而是把主动管理里最关键的判断过程系统化。量化基金有因子库，AI-native 主动管理应该有假设库。

## Slide 2：核心问题

标题：研报库不等于买方能力

要点：

- 读得快不等于判断准。
- 摘要多不等于可下注。
- 买方真正需要的是持续跟踪、验证和淘汰假设。
- 信息优势会衰减，系统化的假设管理才可能成为壁垒。

讲者备注：

AI 普及后，大家都能读研报、总结公告、扫描新闻。竞争会后移到谁能把信息压缩成可跟踪、可验证、可复盘、可进入仓位语境的判断资产。

## Slide 3：我们的产品定义

标题：核心资产是 Hypothesis Library

画面建议：

```text
研报/公告/纪要/行情/财报
          ↓
      假设生成
          ↓
  证据链 + 状态 + 验证变量
          ↓
    报告 / 决策 / 自训练
```

要点：

- 假设是主观投资里的“因子”。
- 每条假设都有状态、证据、风险、下一次验证日期。
- 系统追踪的是假设生命周期，不是孤立文档。

## Slide 4：当前系统已经有的积木

标题：我们已经不是从零开始

要点：

- `ask`：多源只读问答。
- `market-validate`：量价窗口验证。
- `daily-loop`：自提问、待验证、反馈沉淀。
- `self-train/export-samples`：训练样本和动作建议。
- `company-research --deep`：公司深度研究和模型工作簿。
- agentic 分支：`ask --agentic`、autoresearch ledger、policy proposal。

讲者备注：

当前 `main` 具备基础闭环组件；`codex/agentic-recursive-ai` 分支已经把多智能体和 autoresearch 方向打出来。下一步是把这些积木围绕“假设”统一起来。

## Slide 5：一条信息如何改变假设

标题：从 CPO/MPO 例子看动态跟踪

场景：

卖方研究称：CPO 未来增速放缓，利好 MPO 连接器量价齐升。

系统动作：

```text
识别主题 -> 命中假设 -> 更新证据 -> 多智能体推演
-> 市场/公告/订单/财报验证 -> 生成报告 -> 写入实验账本
-> 提出策略改进建议 -> 人工审核 -> 后续归因
```

讲者备注：

这条信息不只是摘要。它要回答：利好哪个细分？谁受益？证据够不够？市场是否已定价？后续财报什么时候能验证？

## Slide 6：假设生命周期

标题：每条假设都有状态

状态流：

```text
seed
-> watching
-> strengthening
-> actionable
-> priced_in / divergent / disconfirmed
-> archived
```

要点：

- 证据增强，优先级上升。
- 市场提前定价，赔率下降。
- 关键证据消失，降级或归档。
- 错误不是废料，而是自训练样本。

## Slide 7：多智能体负责验证，不负责拍脑袋

标题：agentic ask 是验证引擎

角色：

- 证据研究：找支持证据。
- 反证审计：找反例和漏洞。
- 市场验证：看量价和候选池。
- 交易策略：转成赔率、节奏、风险。
- adjudicator：综合输出结论、缺口和置信度。

讲者备注：

多智能体不是为了让答案更热闹，而是为了强制把“证据、反证、市场、交易”拆开，再统一裁决。

## Slide 8：自训练闭环

标题：假设库是自训练的原料仓库

闭环：

```text
假设 -> 推演 -> 验证 -> 归因 -> 样本 -> 策略建议 -> 人工审核 -> 系统改进
```

训练的不是一开始就改模型参数，而是先改系统策略：

- 哪类信号值得提高优先级。
- 哪些卖方叙事经常是假信号。
- 哪些证据缺口必须强制补齐。
- 哪些 segment 配置经常缺失。
- 哪些 agent 角色经常失效。

## Slide 9：用 agent-skills 管住工程复杂度

标题：工程治理不是附属品

映射：

- `spec-driven-development`：每个 Phase 先有规格。
- `planning-and-task-breakdown`：拆成小任务。
- `incremental-implementation`：薄切片实现。
- `test-driven-development`：dry-run、写入边界、失败降级有测试。
- `doubt-driven-development`：自动化策略必须反证审核。
- `security-and-hardening`：密钥、券商、交易信息最小权限。
- `observability-and-instrumentation`：所有运行有 manifest 和 ledger。

讲者备注：

这套技能包不是交易策略，而是保证我们不会把系统越做越玄、越做越散。

## Slide 10：Phase 5A 到 Phase 9

标题：先建议，再审核，最后才谈自动化

路线：

| Phase | 目标 |
|---|---|
| 5A | AI 提出改进建议，不自动应用 |
| 5B | Hypothesis Library V1 |
| 5C | 新信息自动命中和更新假设 |
| 6 | 人工批准后应用低风险配置改动 |
| 7 | 多次验证后，部分低风险策略自动应用 |
| 8 | 模拟交易闭环验证 |
| 9 | 受控真实交易建议，不自动下单 |

讲者备注：

自动化不是一步到位。先把证据链、反馈、复盘和人工审核做扎实。

## Slide 11：还缺哪些数据

标题：闭环质量取决于数据源

数据源：

- Tushare：行情、估值、财务。
- CNINFO：公告、财报、订单和定期报告。
- 企查查招投标：项目和客户兑现。
- 卖方深度报告：单柜用量、ASP、产业链模型。
- 专家/调研纪要：订单节奏和客户份额。
- 模拟组合/人工决策日志：把研究放进仓位语境。

讲者备注：

没有这些数据，系统也能做叙事跟踪；有了这些数据，才能真正做订单、财报和市场反馈闭环。

## Slide 12：下一步

标题：下一步做 Hypothesis Library V1

最小可用版本：

```sh
npm run codex:ingest -- hypothesis create
npm run codex:ingest -- hypothesis list
npm run codex:ingest -- hypothesis report
npm run codex:ingest -- hypothesis update-from-article
npm run codex:ingest -- hypothesis validate
```

写入边界：

```text
.llm-wiki/hypotheses/**
.llm-wiki/hypothesis-events/**
.llm-wiki/hypothesis-reports/**
```

最终落点：

让系统能自己提出“我应该怎么改进研究方式”，但在 Phase 5-6 仍然必须由人审核。
