# ResearchOS 真实交易执行结果 Schema v1

本文定义 `research-os-execution-result-v1`。它用于把真实交割单、日复盘、持仓汇总和 Tushare/price SQL 交叉验证成可审计的执行结果，再进入训练飞轮的收益归因、Benchmark 和 LoRA-ready 候选。

## 设计结论

第一版不追求一次性把所有历史交易清干净。它先保证三件事：

1. 不把账户日盈亏当成单只股票收益。
2. 不把浮盈亏当成已实现盈亏。
3. 不把半仓清仓误判成全部清仓。

机器可读 schema 位于：

- `docs/schemas/research-os-execution-result-v1.schema.json`

## 三源职责

| 来源 | 职责 | 可靠性 | 典型字段 |
|---|---|---|---|
| `raw/交割单/**` | 成交事实主证据 | 高 | 时间、代码、名称、方向、数量、价格、金额、印花税、过户费、当日汇总 |
| `raw/日复盘/**` | 当时判断与归因 | 中高 | 为什么买、为什么卖、是否执行纠错、是否非主线、是否追消息、是否违反 L4 |
| `wiki/position-tracking.md` | 账户连续性与汇总校验 | 中高 | 每日净盈亏、持仓、清仓汇总、浮盈亏、仓位、跨日问题 |
| Tushare / price SQL | 市场路径校验 | 高 | 日内高低价、收盘价、成交额、回撤、承接、相对强度 |

交割单优先级最高，但它只说明“做了什么”，不说明“为什么做”。日复盘补“动机和归因”。持仓页用于连续性和汇总校验，但发现冲突时不能覆盖交割单。

## position-tracking 使用边界

`wiki/position-tracking.md` 是必要来源，但它不是逐笔成交账本。它里面混有以下口径：

| 标记 | 含义 | importer 处理 |
|---|---|---|
| `约` / `~` | 价格、金额或仓位为近似值 | `valueQuality=approx` |
| `估算` | 未由交割单或截图精确确认 | `valueQuality=estimated`，不得直接确认高权重 |
| `待核实` / `需核实` | 记录者已声明缺证 | `qualityGate.status=needs_evidence` |
| `参考值` / `参考盈亏` | 账户或截图参考口径 | `pnlScope=account_daily` 或 `holding_snapshot` |
| `截图口径` | 来自券商截图或账户快照 | 可做账户/持仓事实，仍需区分 realized 与 floating |
| `补录` | 后续回填，不一定有完整交割单 | `riskFlags` 加 `position_tracking_backfilled` |
| `交割单未找到` | 缺主证据 | 不能确认 `real_trade` realized PnL |
| `日复盘未给完整账户盈亏截图` | 缺账户快照 | 只能用作归因线索 |
| `误写/已修正` | 历史记录被修订 | 加 `position_tracking_corrected_or_superseded`，需要保留修订痕迹 |
| `—` | 缺失值 | 不得自动补零 |

因此 importer 必须把 position tracking 当成 `summary_cross_check_only`，除非同一条记录能被 `raw/交割单`、券商截图或 Tushare/price SQL 补证。schema 里用两个字段承载这个约束：

- `reconciliationPolicy.positionTrackingRole`
- `evidence.sourceRefs[].riskFlags`

默认规则：

1. position tracking 可以提出候选交易、候选盈亏、候选归因。
2. position tracking 不能单独确认 `realizedPnlAbs`。
3. position tracking 不能单独确认 `closed_position`。
4. position tracking 的“全部清仓”必须用交割单数量核对。
5. position tracking 的“当前持仓/浮盈亏”只能落到 `holding_snapshot`。
6. position tracking 的“每日净盈亏/参考盈亏”只能落到 `account_daily`。
7. 任何 summary 与交割单逐笔不一致，默认 `qualityGate.status=needs_reconciliation`。

## Artifact 顶层字段

| 字段 | 必填 | 说明 |
|---|---:|---|
| `schema` | 是 | 固定为 `research-os-execution-result-v1` |
| `artifactId` | 是 | 稳定 ID |
| `generatedAt` | 是 | 生成时间 |
| `asOfDate` | 否 | 证据截止日；market 派生字段不得偷看未来 |
| `ledgerKind` | 是 | `real_trade` / `paper_trade` / `broker_snapshot` / `review_derived` |
| `recordStatus` | 是 | `draft` / `needs_review` / `reviewed` / `confirmed` / `rejected` / `superseded` |
| `pnlScope` | 是 | `execution_fill` / `matched_lot` / `closed_position` / `partial_exit` / `holding_snapshot` / `account_daily` |
| `positionState` | 是 | `opened` / `open` / `partial_exit` / `closed` / `unknown` |
| `instrument` | 是 | 股票代码、Tushare code、股票名 |
| `fills` | 否 | 成交明细，支持分笔买入、分笔卖出 |
| `lotMatching` | 否 | 成本匹配方法和匹配数量 |
| `prices` | 否 | 买入价、卖出价、均价、收盘/当前价 |
| `pnl` | 否 | 已实现、浮动、账户日盈亏，三者分开 |
| `marketValidation` | 否 | Tushare/price SQL 校验 |
| `attribution` | 否 | 训练飞轮使用的交易归因 |
| `evidence` | 是 | sourceRefs 和证据覆盖情况 |
| `reconciliationPolicy` | 否 | 多源冲突解决规则，尤其约束 position tracking 的信任边界 |
| `crossValidation` | 否 | 三源交叉校验结果 |
| `qualityGate` | 是 | 进入 review / training 的质量门 |
| `trainingBoundary` | 是 | LoRA-ready 边界 |

## 必须区分的口径

### `pnlScope`

| 值 | 含义 | 能否直接进收益归因 |
|---|---|---|
| `execution_fill` | 单笔成交 | 不能，除非完成 lot matching |
| `matched_lot` | 买卖成交已匹配的一段交易 | 可以 |
| `closed_position` | 一只股票完整闭环 | 可以 |
| `partial_exit` | 部分卖出或半仓清仓 | 可以，但必须标记剩余仓 |
| `holding_snapshot` | 持仓/收盘浮盈亏 | 不能当 realized PnL |
| `account_daily` | 账户日盈亏 | 只能做账户风控，不当单票收益 |

### `valueQuality`

| 值 | 说明 |
|---|---|
| `exact` | 来自交割单或可精确计算 |
| `approx` | 复盘中带 `约`、分笔均价或四舍五入 |
| `estimated` | 明确为估算 |
| `derived` | 由 fills、Tushare 或日期推导 |
| `needs_review` | 存在冲突，需人工确认 |
| `unknown` | 缺少证据 |

## 质量门

进入 `confirmed` 至少需要：

1. `ledgerKind=real_trade` 时，必须有 `raw_delivery_note` 或等价券商证据。
2. `pnlScope` 不能是 `account_daily`。
3. `holding_snapshot` 只能确认浮盈亏，不能确认 `realizedPnlAbs`。
4. `closed_position` 必须能说明 entry 与 exit 的数量匹配关系。
5. `partial_exit` 必须记录 `matchedQuantity` 和 `unmatchedQuantity`。
6. 关键成交价必须通过 Tushare/price SQL 日内高低价校验，或标记为 `marketValidation.provider=unavailable` 并进入 `needs_review`。
7. `pattern_execution_supported` 必须同时满足：收益为正、回撤/持有期已审、entry/position/exit 中至少一项可复用，且不是单纯 beta。

position tracking 触发以下任一情况时，不得进入 `confirmed`：

1. 只有 position tracking，没有交割单或券商截图。
2. 文本含 `估算`、`待核实`、`需核实`、`交割单未找到`。
3. 盈亏来自 `每日净盈亏 / 参考盈亏` 表，而不是 matched lot。
4. 记录为 `当前持仓`、`浮盈`、`浮亏`，但没有卖出成交。
5. position tracking 的数量、清仓状态或盈亏与交割单逐笔记录不一致。

## 真实样本校准

### 紫光国微：完整正向闭环

交割单显示 2026-05-25 买入 3,400 股 @82.14，2026-05-26 卖出 3,400 股 @84.46。复算毛盈亏：

```text
(84.46 - 82.14) * 3400 = +7,888
```

它适合作为 `closed_position` 的 golden case。Tushare 验证买卖价均落在对应日高低价区间内。日复盘同时指出该笔“盈利了结”但也有“清仓可能过早”的归因分歧，因此 `profitCredit` 不能自动给高权重，需进入人审。

### 中国电信：负向但高质量样本

交割单显示 2026-05-21 两笔买入合计 51,900 股 @6.60，2026-05-25 卖出 51,900 股 @6.07。复算毛亏损约：

```text
(6.07 - 6.60) * 51900 = -27,507
```

position tracking 记录约 `-27,517`，差异约 10 元，属于费用/四舍五入口径。日复盘归因为“有逻辑预期但无盘口确认”，适合进入 `failed_expectation_negative` 或 `entry_wrong`。

### 供销大集：必须支持半仓清仓

position tracking 汇总写作 2026-05-26 `169,800股 @1.86，盈利约5,094元`，但交割单和日复盘显示 2026-05-26 实际卖出 84,900 股 @1.86。复算：

```text
(1.86 - 1.80) * 84900 = +5,094
```

后续股票页和 2026-05-27 日复盘说明余仓 84,900 股约 @1.77 清完。因此完整生命周期应拆成：

```text
2026-05-25 买入 169,800 股 @1.80
2026-05-26 卖出 84,900 股 @1.86，partial_exit，毛盈亏 +5,094
2026-05-27 卖出 84,900 股 @1.77，closed，毛盈亏 -2,547
整笔毛盈亏约 +2,547
```

该样本是 schema 设计的关键约束：不能用单行持仓汇总直接覆盖交割单逐笔事实。

这一类记录应在 artifact 中明确写：

```json
{
  "reconciliationPolicy": {
    "primaryFactSource": "raw_delivery_note",
    "positionTrackingRole": "summary_cross_check_only",
    "conflictResolution": "split_position_lifecycle",
    "suspiciousMarkers": [
      "summary_fill_mismatch",
      "partial_exit_possible"
    ]
  },
  "crossValidation": {
    "status": "passed_with_warnings",
    "discrepancies": [
      {
        "field": "lotMatching.matchedQuantity",
        "severity": "warning",
        "summary": "position tracking says 169800 shares cleared on 2026-05-26, but delivery note shows 84900 shares sold.",
        "preferredSource": "raw/交割单/2026-05-26-交割单.md",
        "resolution": "split_position_lifecycle"
      }
    ]
  }
}
```

### 高乐股份 / 中银证券：持仓快照，不是 realized PnL

position tracking 里 2026-06-17 的高乐股份和中银证券是持仓快照：

- 高乐股份：24,200 股，成本 13.592，收盘/现价 12.580，浮亏 -24,479.94。
- 中银证券：37,400 股，成本 12.775，收盘 13.150，浮盈 +14,020.21。

这类记录应为 `pnlScope=holding_snapshot`，`positionState=open`，只能进入执行风险或浮盈亏观察，不能当作已实现收益样本。

## 示例：紫光国微

```json
{
  "schema": "research-os-execution-result-v1",
  "artifactId": "execres_real_002049_20260525_20260526",
  "generatedAt": "2026-06-21 21:05:00",
  "asOfDate": "2026-05-26",
  "ledgerKind": "real_trade",
  "recordStatus": "reviewed",
  "pnlScope": "closed_position",
  "positionState": "closed",
  "instrument": {
    "stockCode": "002049",
    "tsCode": "002049.SZ",
    "stockName": "紫光国微",
    "assetClass": "a_share"
  },
  "tradeWindow": {
    "entryDate": "2026-05-25",
    "exitDate": "2026-05-26",
    "holdingDays": 1,
    "holdingDaysSource": "derived_from_trade_dates"
  },
  "fills": [
    {
      "fillId": "delivery-20260525-002049-buy-150000",
      "tradeDate": "2026-05-25",
      "tradeTime": "15:00:00",
      "side": "buy",
      "quantity": 3400,
      "price": 82.14,
      "amount": 279276,
      "fees": {
        "commission": 0,
        "stampTax": 0,
        "transferFee": 2.79,
        "total": 2.79
      },
      "sourceRefs": [
        "raw/交割单/2026-05-25-交割单.md:9"
      ],
      "valueQuality": "exact"
    },
    {
      "fillId": "delivery-20260526-002049-sell-150000",
      "tradeDate": "2026-05-26",
      "tradeTime": "15:00:00",
      "side": "sell",
      "quantity": 3400,
      "price": 84.46,
      "amount": 287164,
      "fees": {
        "commission": 0,
        "stampTax": 143.58,
        "transferFee": 2.87,
        "total": 146.45
      },
      "sourceRefs": [
        "raw/交割单/2026-05-26-交割单.md:10"
      ],
      "valueQuality": "exact"
    }
  ],
  "lotMatching": {
    "method": "manual_match",
    "matchedQuantity": 3400,
    "unmatchedQuantity": 0,
    "matchedFillIds": [
      "delivery-20260525-002049-buy-150000",
      "delivery-20260526-002049-sell-150000"
    ]
  },
  "prices": {
    "entryPrice": 82.14,
    "exitPrice": 84.46,
    "priceQuality": "exact"
  },
  "pnl": {
    "currency": "CNY",
    "realizedGrossPnlAbs": 7888,
    "realizedNetPnlAbs": 7741.55,
    "realizedPnlPct": 2.82,
    "recordedPnlAbs": 7888,
    "pnlQuality": "derived",
    "fees": {
      "commission": 0,
      "stampTax": 143.58,
      "transferFee": 5.66,
      "total": 149.24
    }
  },
  "marketValidation": {
    "provider": "tushare",
    "priceRangeChecks": [
      {
        "tradeDate": "2026-05-25",
        "price": 82.14,
        "low": 81.66,
        "high": 85.07,
        "inRange": true,
        "ref": "tushare:daily#002049.SZ/20260525"
      },
      {
        "tradeDate": "2026-05-26",
        "price": 84.46,
        "low": 80.89,
        "high": 84.46,
        "inRange": true,
        "ref": "tushare:daily#002049.SZ/20260526"
      }
    ],
    "maxDrawdownPct": -1.52,
    "sourceRefs": [
      "tushare:daily#002049.SZ/20260525..20260526"
    ]
  },
  "attribution": {
    "validationTarget": "expectation_trade",
    "entryReason": "半导体主线核心，L4评分高",
    "exitReason": "盈利了结，但日复盘提示可能清仓过早",
    "profitCredit": "needs_review",
    "behaviorTags": [
      "collect_profit_feedback",
      "behavior",
      "decision_strategy"
    ]
  },
  "evidence": {
    "primaryEvidenceKind": "broker_delivery_note",
    "sourceCoverage": {
      "hasBrokerDeliveryNote": true,
      "hasDailyReview": true,
      "hasPositionTracking": true,
      "hasMarketData": true
    },
    "sourceRefs": [
      {
        "kind": "raw_delivery_note",
        "ref": "raw/交割单/2026-05-25-交割单.md:9",
        "role": "entry_fill",
        "reliability": "high",
        "valueQuality": "exact"
      },
      {
        "kind": "raw_delivery_note",
        "ref": "raw/交割单/2026-05-26-交割单.md:10",
        "role": "exit_fill",
        "reliability": "high",
        "valueQuality": "exact"
      },
      {
        "kind": "raw_daily_review",
        "ref": "raw/日复盘/2026-05-25-复盘.md:220",
        "role": "entry_reason",
        "reliability": "medium",
        "valueQuality": "approx"
      },
      {
        "kind": "raw_daily_review",
        "ref": "raw/日复盘/2026-05-26-复盘.md:243",
        "role": "exit_reason",
        "reliability": "medium",
        "valueQuality": "approx"
      },
      {
        "kind": "wiki_position_tracking",
        "ref": "wiki/position-tracking.md:456",
        "role": "attribution",
        "reliability": "medium",
        "valueQuality": "exact"
      },
      {
        "kind": "market_data",
        "ref": "tushare:daily#002049.SZ/20260525..20260526",
        "role": "market_validation",
        "reliability": "high",
        "valueQuality": "exact"
      }
    ]
  },
  "crossValidation": {
    "status": "passed_with_warnings",
    "checks": [
      {
        "id": "broker_fill_pnl_recalc",
        "status": "passed",
        "summary": "Gross PnL equals (84.46 - 82.14) * 3400 = 7888."
      },
      {
        "id": "tushare_price_range",
        "status": "passed",
        "summary": "Entry and exit prices fall within Tushare daily high-low ranges."
      },
      {
        "id": "review_attribution_consistency",
        "status": "warning",
        "summary": "Profit is real, but日复盘提示清仓可能过早, so adapter weight requires human review."
      }
    ]
  },
  "qualityGate": {
    "status": "review_ready",
    "humanReviewRequired": true,
    "blockers": [],
    "passedRules": [
      "broker_delivery_note_present",
      "matched_quantity_closed",
      "realized_pnl_recalculated",
      "market_price_range_checked"
    ],
    "trainingWeight": "medium"
  },
  "trainingBoundary": {
    "loraFactPolicy": "no_raw_facts",
    "allowedDestinations": [
      "eval",
      "sft",
      "preference",
      "adapter_candidate"
    ],
    "adapterCandidateWeight": "medium",
    "notes": "Adapter candidate may use reusable behavior and decision strategy only; raw fills and price rows stay in retrieval/tool state."
  }
}
```

## 后续 importer 规则

第一版 importer 应按这个顺序处理：

1. 从 `raw/交割单` 解析逐笔 fills。
2. 用 `代码 + 日期 + 数量 + 方向` 与日复盘交易表匹配。
3. 用 position tracking 做账户日盈亏和清仓汇总校验。
4. 用 Tushare/price SQL 做成交价区间、回撤、后续承接验证。
5. 任何冲突进入 `crossValidation.discrepancies`，默认 `qualityGate.status=needs_reconciliation`。
6. 只有人工确认后才能进入 `confirmed` 和高权重 adapter 候选。

## 第一版不做的事

- 不把真实交易推导成自动交易建议。
- 不把 paper trade 与 real trade 混同。
- 不把原始交割单行写入 LoRA-ready。
- 不自动修改 `wiki/**` 或 `raw/**`。
- 不用 Tushare 替代券商成交事实。
