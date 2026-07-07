# 召回质量判断规则

来源：
- `scripts/codex-ingest/internal/ask-flow.mjs`
- 函数：`evaluateAskRetrievalCase(context, expectations)`
- 约第 1453-1520 行。

说明：
- 当前没有发现单独的“召回质量判断提示词文件”。
- 当前 `ask eval` 流程没有调用 LLM 裁判 prompt，而是用确定性规则计算 recall、relevance、evidence coverage、raw noise、structure field coverage 和 overall。
- 本文件把流程中的质量判断规则单独抽出，方便之后改成 prompt 或评估规范。

## 输入

```text
context:
- wikiResults
- rawResults
- graphExpansions
- factsResults
- brainResults
- stockDailyResults
- selectedSources

expectations:
- expectedPaths / expectPaths / expect
```

## 判断步骤

1. 合并所有召回命中。

```text
hits = wikiResults + rawResults + graphExpansions + factsResults + brainResults + stockDailyResults
```

2. 计算期望路径召回。

```text
matchedExpectedPaths = expectedPaths 中能被 hits.path 匹配到的路径
recall = expectedPaths 非空 ? matchedExpectedPaths.length / expectedPaths.length * 100 : null
```

路径匹配规则：

```text
- 去掉开头斜杠。
- `.md` 后缀大小写归一。
- 完整路径相等则命中。
- 去掉 `.md` 后相等则命中。
- actual 以 expected 结尾则命中。
```

3. 计算 top relevance。

```text
topHits = hits 前 10 个
relevance = topHits 中 score > 0 的比例 * 100
```

4. 计算 evidence coverage。

```text
selected = selectedSources 中 available 为 true 的源
sourceHitCounts:
- wiki_pages = wikiResults.length
- raw_text = rawResults.length
- wiki_graph = graphExpansions.length
- facts_jsonl = factsResults.length
- brain_memory = brainResults.length
- stock_daily_sql = stockDailyResults.length

evidenceCoverage = selected 中有命中的 source 占比 * 100
```

5. 计算 raw noise。

```text
noisy raw path:
- raw/微信聊天/**
- raw/openclaw数据/**

若 noisy raw hit 没有 structuredSourceMatch，则计为噪声。
rawNoise = (1 - noisyRawWithoutStructuredMatch / rawResults.length) * 100
```

6. 计算 structure field coverage。

```text
structuredWikiHits = wikiResults 中满足任一条件的结果：
- frontmatterMatches 非空
- frontmatterMatch 为 true
- frontmatterSources 非空
- frontmatterRelated 非空
- frontmatterTags 非空

structureFieldCoverage = structuredWikiHits.length / wikiResults.length * 100
```

7. 计算 overall。

```text
recallComponent = recall == null ? relevance : recall

overall =
  recallComponent * 0.35 +
  relevance * 0.20 +
  evidenceCoverage * 0.20 +
  structureFieldCoverage * 0.15 +
  rawNoise * 0.10
```

所有分数最后都经过 `clampScore()` 归一到 0-100 的整数区间。

## 输出字段

```json
{
  "expectedPaths": [],
  "matchedExpectedPaths": [],
  "missedExpectedPaths": [],
  "topHits": [
    {"bucket": "wiki", "path": "...", "title": "...", "score": 0}
  ],
  "sourceHitCounts": {
    "wiki_pages": 0,
    "raw_text": 0,
    "wiki_graph": 0,
    "facts_jsonl": 0,
    "brain_memory": 0,
    "stock_daily_sql": 0
  },
  "metrics": {
    "recall": null,
    "relevance": 0,
    "evidenceCoverage": 0,
    "rawNoise": 0,
    "structureFieldCoverage": 0,
    "overall": 0
  }
}
```
