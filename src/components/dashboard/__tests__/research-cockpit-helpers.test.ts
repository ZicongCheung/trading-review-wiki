import { describe, expect, it } from "vitest"
import {
  buildAlphaFeedSummary,
  buildAskDecisionSnapshot,
  buildAskDeepDiveSummary,
  buildAskEvidenceStrength,
  buildAskFollowUpAction,
  buildAskObservationActionCopy,
  buildAskObservationChecklist,
  buildAskWikiFrameHint,
  buildAskPendingSkeletonTiles,
  buildAskResultJumpCopy,
  buildAskResultLocatedNoticeCopy,
  buildAskResultLocatorCopy,
  buildAskResultMiniIndex,
  buildAskResultOriginCopy,
  buildAskResultActionGuide,
  buildAskAnswerPanelCopy,
  buildAskResultPanelCopy,
  buildAskResultReadingGuide,
  buildAskResultReuseCopy,
  buildAskResearchTicket,
  buildAskLiveTaskTicket,
  buildAskRunProgressSteps,
  buildAskCacheStatusCopy,
  buildAskSourceSnapshot,
  buildAskStructureFeedback,
  buildAskSummaryTileValues,
  countAskResultSources,
  buildObservationQueueDraft,
  buildObservationReviewBrief,
  buildObservationQueueTableRows,
  buildCandidateAskPrecheckQuery,
  buildCandidatePrecheckAdoptionCopy,
  buildCandidateSignalClusters,
  buildCandidateThemeSegmentLine,
  buildDailyStatusActionFeedback,
  buildDefaultSignalSourcePresets,
  buildEffectiveLlmReviewMode,
  buildEmptySignalTodoHint,
  buildHypothesisAskActionLabel,
  buildHypothesisAskQuery,
  buildHypothesisDefinitionDraft,
  buildHypothesisGranularityGate,
  buildHypothesisQualityBrief,
  buildHypothesisTimelineBrief,
  buildHypothesisWorkbenchRows,
  buildHypothesisTimelineItems,
  buildHypothesisWorkPriority,
  buildIgnoredSignalNoticeCopy,
  buildWikiFrameDecisionLine,
  buildPendingCountLabel,
  buildPmFocusBrief,
  buildPmOpeningBrief,
  buildPmSignalTriageBuckets,
  buildPmDecisionQueueSummary,
  buildQuietSignalSummaryPlacement,
  buildQuietSignalVisibility,
  buildReviewModeSummary,
  buildQuietSignalsSummary,
  buildSignalCardActions,
  buildSignalCardActionFeedback,
  buildSignalCardAskResultBackfill,
  shouldShowSignalCardActionFeedback,
  buildSignalCardActionButtonState,
  buildSignalCardActionPanelCopy,
  buildSignalCardDecisionCopy,
  buildSignalCardPmActionLine,
  buildSignalCardQuestionChecklist,
  buildSignalCardRankReason,
  buildSignalCardSurfacePolicy,
  buildSignalCardSourceCopy,
  buildSignalCardTradingBrief,
  buildSignalCardTradeLine,
  buildSignalEvidenceToggleCopy,
  buildSignalFocusBuckets,
  buildSignalFinanceEntityStrip,
  buildSignalFinanceHeaderCue,
  buildSignalInfoFlowCopy,
  buildSignalKeywordLine,
  buildSignalLayerBrief,
  buildSignalWorkSectionHeader,
  buildSignalRunDecisionCopy,
  buildSignalRunDigestAction,
  buildSignalRunDigest,
  buildSignalQueueDecisionViewModel,
  buildSignalScanContextCopy,
  buildSignalSourceCapabilityCopy,
  buildSelectedSignalSourceBrief,
  buildSignalTodoClusterKey,
  buildSignalTodoSourceKey,
  signalWorkSectionFor,
  buildWikiFrameClusters,
  buildWikiFrameMatchExplanation,
  buildWikiFrameFirstLookCopy,
  buildStatusUpdateNoticeCopy,
  buildWatchReviewPasses,
  buildWikiMetaBadges,
  buildRelatedWikiEmptyHint,
  buildScanProgressSummary,
  buildScanKey,
  buildScanModeSummary,
  buildScanScopeSummary,
  buildTradingDeskScanBrief,
  buildSignalDecisionSummary,
  buildRelatedWikiSummary,
  extractAskAnswerField,
  hypothesisStatusBody,
  hypothesisStatusLabel,
  hypothesisStatusTransitionLabel,
  isSafeObservationDraftPath,
  isPriorityPendingSignal,
  isWeakSignalTitle,
  mergeSignalSourceListRuns,
  mergeSignalTodoRecord,
  pendingCandidatePriorityScore,
  pendingTodoPriorityScore,
  pmSignalTriageBucketForSignal,
  readerFacingReason,
  signalSourceSummary,
  shouldShowAskPendingPanel,
  shouldShowSignalQueueDetails,
  sourcePreview,
  shouldShowReviewModeAction,
  shouldRunLlmReviewAfterRules,
  isSignalSourcePresetActive,
  resolveSignalSourceCandidateRoot,
  sourceRefLabel,
  upsertObservationQueue,
} from "../research-cockpit-helpers"

describe("research cockpit display helpers", () => {
  it("only treats observation draft artifact paths as openable project files", () => {
    expect(isSafeObservationDraftPath(".llm-wiki/observation-drafts/2026-06-20/obs_demo.md")).toBe(true)
    expect(isSafeObservationDraftPath(".llm-wiki/observation-drafts/2026-06-20/obs_demo.json")).toBe(true)
    expect(isSafeObservationDraftPath(".llm-wiki/hypothesis-events/demo.jsonl")).toBe(false)
    expect(isSafeObservationDraftPath("/tmp/obs_demo.md")).toBe(false)
    expect(isSafeObservationDraftPath(".llm-wiki/observation-drafts/../hypotheses/demo.md")).toBe(false)
  })

  it("turns processed WeChat refs into short reader-facing labels", () => {
    expect(sourceRefLabel(".llm-wiki/wechat-inbox/processed/2026-06-19.jsonl#msg:raw:e00d28c290a19d24:0036c5e2b1fe1ad5"))
      .toBe("微信已处理 2026-06-19 · raw")
    expect(sourceRefLabel("raw/研报新闻/2026-06-25-健滔涨价函.md"))
      .toBe("研报新闻 · 2026-06-25-健滔涨价函.md")
    expect(sourceRefLabel("raw/openclaw数据/产业链复盘/gangtise_themes/2026-06-25/001-MPO连接器.md"))
      .toBe("产业链复盘 · 001-MPO连接器.md")
  })

  it("keeps the daily workbench source presets focused on PM signal inputs", () => {
    const presets = buildDefaultSignalSourcePresets()
    expect(presets.map((item) => item.source)).toEqual([
      "raw/微信聊天",
      "raw/研报新闻",
      "raw/openclaw数据/产业链复盘/gangtise_themes",
    ])
    expect(presets.map((item) => item.badge)).toEqual(["状态更新", "催化发现", "链条验证"])

    const wechat = presets.find((item) => item.id === "wechat")
    const news = presets.find((item) => item.id === "research-news")
    const theme = presets.find((item) => item.id === "gangtise-themes")
    expect(wechat?.detail).toContain("高噪声舆情")
    expect(wechat?.detail).toContain("已有假设状态")
    expect(news?.detail).toContain("逻辑链")
    expect(news?.detail).toContain("候选公司")
    expect(theme?.detail).toContain("订单")
    expect(theme?.detail).toContain("ASP")
    expect(theme?.detail).toContain("收入兑现")
    expect(theme?.detail).not.toContain("微信")
  })

  it("explains the selected signal source without calling every source WeChat", () => {
    const news = buildSelectedSignalSourceBrief({
      currentSource: "raw/研报新闻/2026-06-25-健滔涨价函.md",
      selectedSource: {
        sourceRef: "raw/研报新闻/2026-06-25-健滔涨价函.md",
        sourceKindLabel: "研报新闻",
      },
    })
    expect(news.label).toBe("研报新闻")
    expect(news.detail).toContain("新催化")
    expect(`${news.label} ${news.detail} ${news.badge}`).not.toContain("微信")

    const theme = buildSelectedSignalSourceBrief({
      currentSource: "raw/openclaw数据/产业链复盘/gangtise_themes/2026-06-25/001-MPO.md",
      selectedSource: {
        sourceRef: "raw/openclaw数据/产业链复盘/gangtise_themes/2026-06-25/001-MPO.md",
        sourceKindLabel: "产业链复盘",
      },
    })
    expect(theme.label).toBe("产业链复盘")
    expect(theme.detail).toContain("链条验证")

    const custom = buildSelectedSignalSourceBrief({
      currentSource: "/tmp/custom/material.md",
    })
    expect(custom.label).toBe("自定义资料源")
    expect(custom.detail).toContain("新增资料")
  })

  it("merges signal source candidates across WeChat, research news, and theme reviews", () => {
    const merged = mergeSignalSourceListRuns([
      {
        sourcePath: "raw/微信聊天",
        sourceMissing: false,
        defaultSourceRef: "raw/微信聊天/2026-06-25.md",
        sources: [
          { sourceRef: "raw/微信聊天/2026-06-25.md", sourceKindLabel: "微信聊天", isSelectedCandidate: true },
        ],
        summary: { sourcesScanned: 1, sourcesReturned: 1, todayFound: true },
      },
      {
        sourcePath: "raw/研报新闻",
        sourceMissing: false,
        defaultSourceRef: "raw/研报新闻/2026-06-25-健滔涨价函.md",
        sources: [
          { sourceRef: "raw/研报新闻/2026-06-25-健滔涨价函.md", sourceKindLabel: "研报新闻" },
          { sourceRef: "raw/微信聊天/2026-06-25.md", sourceKindLabel: "微信聊天" },
        ],
        summary: { sourcesScanned: 2, sourcesReturned: 2, todayFound: false },
      },
      {
        sourcePath: "raw/openclaw数据/产业链复盘/gangtise_themes",
        sourceMissing: false,
        defaultSourceRef: "raw/openclaw数据/产业链复盘/gangtise_themes/2026-06-25/001-MPO.md",
        sources: [
          { sourceRef: "raw/openclaw数据/产业链复盘/gangtise_themes/2026-06-25/001-MPO.md", sourceKindLabel: "产业链复盘" },
        ],
        summary: { sourcesScanned: 1, sourcesReturned: 1, todayFound: false },
      },
    ], { preferredSource: "raw/研报新闻/2026-06-25-健滔涨价函.md" })

    expect(merged.sourceMissing).toBe(false)
    expect(merged.summary).toMatchObject({
      sourcesScanned: 4,
      sourcesReturned: 3,
      todayFound: true,
    })
    expect(merged.defaultSourceRef).toBe("raw/研报新闻/2026-06-25-健滔涨价函.md")
    expect(merged.sources.map((item) => item.sourceKindLabel)).toEqual(["微信聊天", "研报新闻", "产业链复盘"])
    expect(merged.sources.filter((item) => item.isSelectedCandidate)).toHaveLength(1)
    expect(merged.sources.find((item) => item.sourceRef === "raw/研报新闻/2026-06-25-健滔涨价函.md")?.isSelectedCandidate).toBe(true)
  })

  it("defaults to the freshest multi-source candidate instead of always preferring WeChat", () => {
    const merged = mergeSignalSourceListRuns([
      {
        sourcePath: "raw/微信聊天",
        sourceMissing: false,
        sources: [
          {
            sourceRef: "raw/微信聊天/2026-06-25.md",
            sourceKindLabel: "微信聊天",
            isSelectedCandidate: true,
            isToday: true,
            mtime: "2026-06-25T08:30:00.000Z",
          },
        ],
        summary: { sourcesScanned: 1, sourcesReturned: 1, todayFound: true },
      },
      {
        sourcePath: "raw/研报新闻",
        sourceMissing: false,
        sources: [
          {
            sourceRef: "raw/研报新闻/2026-06-25-健滔涨价函.md",
            sourceKindLabel: "研报新闻",
            isSelectedCandidate: true,
            isToday: true,
            mtime: "2026-06-25T10:15:00.000Z",
          },
        ],
        summary: { sourcesScanned: 1, sourcesReturned: 1, todayFound: true },
      },
      {
        sourcePath: "raw/openclaw数据/产业链复盘/gangtise_themes",
        sourceMissing: false,
        sources: [
          {
            sourceRef: "raw/openclaw数据/产业链复盘/gangtise_themes/2026-06-24/001-MPO.md",
            sourceKindLabel: "产业链复盘",
            isSelectedCandidate: true,
            isToday: false,
            mtime: "2026-06-24T22:00:00.000Z",
          },
        ],
        summary: { sourcesScanned: 1, sourcesReturned: 1, todayFound: false },
      },
    ])

    expect(merged.defaultSourceRef).toBe("raw/研报新闻/2026-06-25-健滔涨价函.md")
    expect(merged.sources.find((item) => item.sourceRef === "raw/研报新闻/2026-06-25-健滔涨价函.md")?.isSelectedCandidate).toBe(true)
    expect(merged.sources.find((item) => item.sourceRef === "raw/微信聊天/2026-06-25.md")?.isSelectedCandidate).toBe(false)
  })

  it("resolves selected source files back to their candidate roots", () => {
    expect(resolveSignalSourceCandidateRoot("raw/研报新闻/2026-06-25-健滔涨价函.md"))
      .toBe("raw/研报新闻")
    expect(resolveSignalSourceCandidateRoot("raw/微信聊天/2026-06-25.md"))
      .toBe("raw/微信聊天")
    expect(resolveSignalSourceCandidateRoot("raw/openclaw数据/产业链复盘/gangtise_themes/2026-06-25/001-MPO.md"))
      .toBe("raw/openclaw数据/产业链复盘/gangtise_themes")
    expect(resolveSignalSourceCandidateRoot("/tmp/wiki-project/raw/研报新闻/2026-06-25-健滔涨价函.md"))
      .toBe("raw/研报新闻")
    expect(resolveSignalSourceCandidateRoot("custom/source.md"))
      .toBe("custom/source.md")
    expect(resolveSignalSourceCandidateRoot(""))
      .toBe("raw/微信聊天")
  })

  it("keeps source preset highlighting active for absolute selected files", () => {
    const presets = buildDefaultSignalSourcePresets()
    const researchNews = presets.find((item) => item.id === "research-news")
    const wechat = presets.find((item) => item.id === "wechat")
    expect(researchNews).toBeTruthy()
    expect(wechat).toBeTruthy()

    expect(isSignalSourcePresetActive(
      "/tmp/wiki-project/raw/研报新闻/2026-06-25-健滔涨价函.md",
      researchNews!,
      presets,
    )).toBe(true)
    expect(isSignalSourcePresetActive(
      "/tmp/wiki-project/raw/研报新闻/2026-06-25-健滔涨价函.md",
      wechat!,
      presets,
    )).toBe(false)
  })

  it("removes machine WeChat prefixes from visible excerpts", () => {
    const preview = sourcePreview(
      "微信增量 chat=AI产业链情报 sentAt=2026-06-19 09:30:10 上游/配套｜硅光芯片、CW 光源、MPO 设备。",
      ".llm-wiki/wechat-inbox/processed/2026-06-19.jsonl#msg:raw:e00d28c290a19d24:0036c5e2b1fe1ad5",
    )

    expect(preview.meta).toBe("微信 AI产业链情报 · 2026-06-19 09:30:10")
    expect(preview.body).toBe("上游/配套｜硅光芯片、CW 光源、MPO 设备。")
    expect(preview.body).not.toContain("微信增量 chat=")
  })

  it("keeps non-WeChat raw source previews labeled by source type", () => {
    const preview = sourcePreview(
      "研报新闻增量 chat=研报新闻 · 健滔涨价函 sentAt=2026-06-25 09:00:00 CCL 涨价函成为新催化。",
      ".llm-wiki/wechat-inbox/processed/2026-06-25.jsonl#msg:raw:news:1",
    )

    expect(preview.meta).toBe("研报新闻 · 健滔涨价函 · 2026-06-25 09:00:00")
    expect(preview.body).toBe("CCL 涨价函成为新催化。")
    expect(preview.meta).not.toContain("微信")
  })

  it("keeps signal card source copy reader-facing while preserving audit labels", () => {
    const copy = buildSignalCardSourceCopy({
      sourceExcerpt: "微信增量 chat=AI产业链情报 sentAt=2026-06-19 09:30:10 健滔涨价函流传，CCL 关注度提升。",
      sourceRef: ".llm-wiki/wechat-inbox/processed/2026-06-19.jsonl#msg:raw:e00d28c290a19d24:0036c5e2b1fe1ad5",
      reason: "new context is not decisive enough to upgrade the hypothesis",
    })

    expect(copy.badge).toBe("微信 AI产业链情报 · 2026-06-19 09:30:10")
    expect(copy.badge).not.toContain(".llm-wiki")
    expect(copy.excerpt).toContain("健滔涨价函")
    expect(copy.reason).toContain("不足以升级")
    expect(copy.auditLabel).toBe("微信已处理 2026-06-19 · raw")
  })

  it("compresses raw processed refs into PM-friendly source badges", () => {
    const copy = buildSignalCardSourceCopy({
      sourceRef: ".llm-wiki/wechat-inbox/processed/2026-06-19.jsonl#msg:raw:aaa:bbb",
    })

    expect(copy.badge).toBe("微信 2026-06-19")
    expect(copy.auditLabel).toBe("微信已处理 2026-06-19 · raw")
  })

  it("prefers structured source kind labels over processed inbox path labels", () => {
    const copy = buildSignalCardSourceCopy({
      sourceRef: ".llm-wiki/wechat-inbox/processed/2026-06-25.jsonl#msg:raw:news:1",
      sourceKindLabel: "研报新闻",
    })

    expect(copy.badge).toBe("研报新闻")
    expect(copy.auditLabel).toBe("研报新闻 · 已处理 2026-06-25 · raw")

    const themeCopy = buildSignalCardSourceCopy({
      sourceRef: ".llm-wiki/wechat-inbox/processed/2026-06-25.jsonl#msg:raw:theme:1",
      sourceKindLabel: "产业链复盘",
    })

    expect(themeCopy.badge).toBe("产业链复盘")
    expect(themeCopy.auditLabel).toBe("产业链复盘 · 已处理 2026-06-25 · raw")
  })

  it("does not expose generic artifact paths as source badges", () => {
    const copy = buildSignalCardSourceCopy({
      sourceRef: ".llm-wiki/hypothesis-events/20260619-test.jsonl",
    })

    expect(copy.badge).toBe("审计来源")
    expect(copy.auditLabel).toBe("审计来源 · hypothesis-events")
    expect(copy.auditLabel).not.toContain("20260619-test")
    expect(copy.auditTitle).toContain(".llm-wiki/hypothesis-events/20260619-test.jsonl")
  })

  it("summarizes hidden evidence so signal cards stay action-first", () => {
    const copy = buildSignalEvidenceToggleCopy({
      relatedWikiPages: [{ path: "wiki/CPO/当前状态.md" }, { path: "wiki/MPO/产业链.md" }],
      sourceExcerpt: "微信增量 chat=AI产业链情报 sentAt=2026-06-19 09:30:10 CPO 放缓，MPO 跳线扩散。",
      sourceRef: ".llm-wiki/wechat-inbox/processed/2026-06-19.jsonl#msg:raw:aaa:bbb",
      reason: "new catalyst routes to existing hypothesis",
      matchedSegments: ["MPO", "CPO"],
      matchedEntities: ["高速连接器"],
      catalystTags: ["CPO节奏放缓"],
      priorityReasons: ["命中热框架"],
    })

    expect(copy.label).toBe("证据和来源 · wiki框架 2 / 来源原文 / SAG词")
    expect(copy.detail).toContain("已收起")
    expect(copy.detail).toContain("不影响当前主动作")
    expect(copy.title).toContain("优先级理由")
    expect(copy.title).toContain("判断理由")
  })

  it("does not pretend empty evidence exists", () => {
    const copy = buildSignalEvidenceToggleCopy({})

    expect(copy.label).toBe("证据和来源")
    expect(copy.detail).toContain("暂无结构化证据细节")
    expect(copy.title).toBe("暂无结构化证据细节")
  })

  it("shows an explicit trading implication before generic signal guidance", () => {
    expect(buildSignalCardTradeLine({
      tradingImplication: "优先看健滔涨价函对 CCL/PCB 链条的扩散和标的排序。",
      signalType: "新催化",
    })).toBe("优先看健滔涨价函对 CCL/PCB 链条的扩散和标的排序。")
  })

  it("falls back to PM-facing trade guidance by signal type", () => {
    expect(buildSignalCardTradeLine({ signalType: "新催化" })).toContain("扩散强度")
    expect(buildSignalCardTradeLine({ signalType: "市场反馈" })).toContain("已经开始反应")
    expect(buildSignalCardTradeLine({ signalType: "反证" })).toContain("暂停当作利好")
    expect(buildSignalCardTradeLine({ signalType: "叙事扩散" })).toContain("不急着升级")
  })

  it("renders candidate theme and segment metadata without dangling separators", () => {
    expect(buildCandidateThemeSegmentLine({
      theme: "AI数据中心互联",
      segments: ["MPO", "CPO", "高速连接器"],
    })).toBe("主题：AI数据中心互联 · 细分：MPO/CPO/高速连接器")
    expect(buildCandidateThemeSegmentLine({ theme: "玻璃基板" })).toBe("主题：玻璃基板")
    expect(buildCandidateThemeSegmentLine({ segments: "CCL,PCB" })).toBe("细分：CCL/PCB")
    expect(buildCandidateThemeSegmentLine({})).toBe("待补主题/细分")
  })

  it("prioritizes trading implication before raw source text for table summaries", () => {
    const summary = signalSourceSummary({
      tradingImplication: "先看 MPO 连接器订单和扩散强度。",
      sourceExcerpt: "微信增量 chat=AI sentAt=2026-06-19 09:30:10 原始舆情正文",
      sourceRef: ".llm-wiki/wechat-inbox/processed/2026-06-19.jsonl#msg:raw:aaa:bbb",
      reason: "新增信息相关",
    })

    expect(summary).toBe("先看 MPO 连接器订单和扩散强度。")
  })

  it("falls back to clean source text when no trading implication exists", () => {
    const summary = signalSourceSummary({
      sourceExcerpt: "微信增量 chat=AI sentAt=2026-06-19 09:30:10 健滔涨价函带动 CCL 链条关注。",
      sourceRef: ".llm-wiki/wechat-inbox/processed/2026-06-19.jsonl#msg:raw:aaa:bbb",
      reason: "新增信息相关",
    })

    expect(summary).toBe("健滔涨价函带动 CCL 链条关注。")
  })

  it("translates internal rule reasons into PM-facing Chinese copy", () => {
    expect(readerFacingReason("new context is not decisive enough to upgrade the hypothesis"))
      .toBe("新增信息相关，但还不足以升级假设状态")
    expect(readerFacingReason("source contains a fresh tradable catalyst; follow price/volume and second confirmation before upgrading conviction"))
      .toBe("出现新催化，先看量价跟随和二次确认")
    expect(readerFacingReason("hypothesis is being tracked"))
      .toBe("假设已在跟踪中，等待新的催化、二次确认或市场反馈")
    expect(readerFacingReason("counterevidence or divergence"))
      .toContain("反证或走势背离")
    expect(readerFacingReason("counterevidence or divergence appeared after new source"))
      .toContain("反证或走势背离")
    expect(readerFacingReason("new context exists but validation is not decisive"))
      .toBe("已有新增上下文，但还不足以改变假设状态")
    expect(readerFacingReason("new catalyst routes to existing hypothesis but conviction should wait for market follow through"))
      .toBe("新增信息相关，但需要人工复核后再决定是否处理")
    expect(readerFacingReason("LLM review says evidence is too weak for status upgrade"))
      .toBe("新增信息相关，但需要人工复核后再决定是否处理")
    expect(readerFacingReason("已经出现健滔涨价函，先看 CCL 传导"))
      .toBe("已经出现健滔涨价函，先看 CCL 传导")
  })

  it("uses translated reasons when a summary must fall back to rule text", () => {
    const summary = signalSourceSummary({
      reason: "market feedback is visible but fundamental closure is incomplete",
    })

    expect(summary).toBe("已有市场反馈，但基本面闭环还不完整")
  })

  it("translates hypothesis lifecycle states into PM-facing labels", () => {
    expect(hypothesisStatusLabel("watching")).toBe("观察中")
    expect(hypothesisStatusLabel("strengthening")).toBe("证据增强")
    expect(hypothesisStatusBody("priced_in")).toContain("市场先动")
    expect(hypothesisStatusTransitionLabel("watching", "strengthening")).toBe("观察中 -> 证据增强")
    expect(hypothesisStatusTransitionLabel("watching", "watching")).toBe("观察中")
    expect(hypothesisStatusTransitionLabel("custom_state", "next_state")).toBe("custom_state -> next_state")
  })

  it("prioritizes actionable todos over weak narrative expansion", () => {
    const catalyst = pendingTodoPriorityScore({
      evidenceDelta: "catalyst_signal",
      signalType: "新催化",
      relatedWikiCount: 2,
    })
    const narrative = pendingTodoPriorityScore({
      evidenceDelta: "narrative_expansion",
      signalType: "叙事扩散",
    })

    expect(isPriorityPendingSignal(catalyst)).toBe(true)
    expect(isPriorityPendingSignal(narrative)).toBe(false)
    expect(catalyst).toBeGreaterThan(narrative)
  })

  it("uses active wiki headers to lift stronger daily signal priorities", () => {
    const activeFramework = pendingTodoPriorityScore({
      evidenceDelta: "catalyst_signal",
      signalType: "新催化",
      relatedWikiPages: [{
        wikiMeta: {
          status: "活跃",
          confidence: "中",
          momentum: "热",
          catalysts: ["CPO节奏放缓", "MPO跳线需求"],
        },
      }],
    })
    const plainRelated = pendingTodoPriorityScore({
      evidenceDelta: "catalyst_signal",
      signalType: "新催化",
      relatedWikiCount: 1,
    })

    expect(activeFramework).toBeGreaterThan(plainRelated)
  })

  it("uses SAG finance entity types to prioritize industry-specific signals without upgrading pure narrative noise", () => {
    const financeFrame = [{
      financeAuditMatchedTerms: ["MPO", "CPO"],
      financeAuditMatchedEntities: [
        { term: "MPO", type: "product_line", label: "产品线" },
        { term: "CPO", type: "tech_route", label: "技术路线" },
      ],
    }]
    const financeCatalyst = pendingTodoPriorityScore({
      evidenceDelta: "catalyst_signal",
      signalType: "新催化",
      relatedWikiPages: financeFrame,
    })
    const plainCatalyst = pendingTodoPriorityScore({
      evidenceDelta: "catalyst_signal",
      signalType: "新催化",
      relatedWikiCount: 1,
    })
    const narrativeOnly = pendingTodoPriorityScore({
      evidenceDelta: "narrative_expansion",
      signalType: "叙事扩散",
      relatedWikiPages: financeFrame,
    })

    expect(financeCatalyst).toBeGreaterThanOrEqual(plainCatalyst + 10)
    expect(isPriorityPendingSignal(financeCatalyst)).toBe(true)
    expect(isPriorityPendingSignal(narrativeOnly)).toBe(false)
  })

  it("uses direct finance signal entities to rank cards before wiki backfill catches up", () => {
    const directFinanceSignal = [{
      financeSignalEntities: [
        { term: "健滔", type: "company", label: "公司" },
        { term: "CCL", type: "product_line", label: "产品线" },
        { term: "涨价函", type: "catalyst", label: "催化" },
      ],
    }]
    const financeCatalyst = pendingTodoPriorityScore({
      evidenceDelta: "catalyst_signal",
      signalType: "新催化",
      financeEntityRecords: directFinanceSignal,
    })
    const plainCatalyst = pendingTodoPriorityScore({
      evidenceDelta: "catalyst_signal",
      signalType: "新催化",
    })
    const narrativeOnly = pendingTodoPriorityScore({
      evidenceDelta: "narrative_expansion",
      signalType: "叙事扩散",
      financeEntityRecords: directFinanceSignal,
    })

    expect(financeCatalyst).toBeGreaterThanOrEqual(plainCatalyst + 10)
    expect(isPriorityPendingSignal(financeCatalyst)).toBe(true)
    expect(isPriorityPendingSignal(narrativeOnly)).toBe(false)
  })

  it("downgrades stale wiki headers in the daily signal priority", () => {
    const staleFramework = pendingTodoPriorityScore({
      evidenceDelta: "catalyst_signal",
      signalType: "新催化",
      relatedWikiPages: [{ wikiMeta: { status: "归档", confidence: "低", momentum: "冷" } }],
    })
    const plainRelated = pendingTodoPriorityScore({
      evidenceDelta: "catalyst_signal",
      signalType: "新催化",
      relatedWikiCount: 1,
    })

    expect(staleFramework).toBeLessThan(plainRelated)
  })

  it("keeps status-changing todos at the top of the work queue", () => {
    const statusChange = pendingTodoPriorityScore({
      canConfirm: true,
      evidenceDelta: "market_feedback",
      signalType: "市场反馈",
    })
    const askOnly = pendingTodoPriorityScore({
      askDeepDiveRecommended: true,
      evidenceDelta: "catalyst_signal",
      signalType: "新催化",
    })

    expect(statusChange).toBeGreaterThan(askOnly)
    expect(isPriorityPendingSignal(statusChange)).toBe(true)
  })

  it("prioritizes candidate hypotheses with hard catalysts or multiple sources", () => {
    const candidate = pendingCandidatePriorityScore({
      priorityScore: 8,
      evidenceDelta: "catalyst_signal",
      signalType: "新催化",
      clusterSourceCount: 2,
      relatedWikiCount: 1,
    })

    expect(isPriorityPendingSignal(candidate)).toBe(true)
  })

  it("uses wiki headers to lift candidate hypotheses tied to active frameworks", () => {
    const activeCandidate = pendingCandidatePriorityScore({
      priorityScore: 4,
      evidenceDelta: "catalyst_signal",
      signalType: "新催化",
      relatedWikiPages: [{
        wikiMeta: {
          status: "活跃",
          momentum: "热",
          catalysts: ["玻璃基板产业化"],
        },
      }],
    })
    const plainCandidate = pendingCandidatePriorityScore({
      priorityScore: 4,
      evidenceDelta: "catalyst_signal",
      signalType: "新催化",
      relatedWikiCount: 1,
    })

    expect(activeCandidate).toBeGreaterThan(plainCandidate)
  })

  it("uses finance entity routes to lift candidate hypotheses for Ask precheck", () => {
    const financeCandidate = pendingCandidatePriorityScore({
      priorityScore: 4,
      evidenceDelta: "catalyst_signal",
      signalType: "新催化",
      relatedWikiPages: [{
        financeAuditMatchedTerms: ["玻璃基板", "TGV"],
        financeAuditMatchedEntities: [
          { term: "玻璃基板", type: "product_line", label: "产品线" },
          { term: "TGV", type: "tech_route", label: "技术路线" },
        ],
      }],
    })
    const plainCandidate = pendingCandidatePriorityScore({
      priorityScore: 4,
      evidenceDelta: "catalyst_signal",
      signalType: "新催化",
      relatedWikiCount: 1,
    })

    expect(financeCandidate).toBeGreaterThanOrEqual(plainCandidate + 10)
  })

  it("uses direct finance signal entities to lift candidates before related wiki pages exist", () => {
    const financeCandidate = pendingCandidatePriorityScore({
      priorityScore: 4,
      evidenceDelta: "catalyst_signal",
      signalType: "新催化",
      financeEntityRecords: [{
        financeSignalEntities: [
          { term: "玻璃基板", type: "product_line", label: "产品线" },
          { term: "TGV", type: "tech_route", label: "技术路线" },
        ],
      }],
    })
    const plainCandidate = pendingCandidatePriorityScore({
      priorityScore: 4,
      evidenceDelta: "catalyst_signal",
      signalType: "新催化",
    })

    expect(financeCandidate).toBeGreaterThanOrEqual(plainCandidate + 10)
  })

  it("uses the full finance entity catalog for labels without promoting weak source/time terms", () => {
    const weakNarrative = pendingTodoPriorityScore({
      evidenceDelta: "narrative_expansion",
      signalType: "叙事扩散",
      relatedWikiPages: [{
        financeAuditMatchedTerms: ["2026-06-19", "微信"],
        financeAuditMatchedEntities: [
          { term: "2026-06-19", type: "time" },
          { term: "微信", type: "source" },
        ],
      }],
    })

    expect(isPriorityPendingSignal(weakNarrative)).toBe(false)

    const summary = buildPmDecisionQueueSummary({
      totalCount: 2,
      priorityCount: 1,
      confirmableCount: 0,
      askRecommendedCount: 1,
      candidateAskRecommendedCount: 1,
      candidateCount: 1,
      quietCount: 1,
      topTitle: "机构路演提到沪深300权重资金偏好变化",
      topSignalType: "市场反馈",
      topRelatedWikiPages: [{
        financeAuditMatchedTerms: ["沪深300", "中信证券", "张三"],
        financeAuditMatchedEntities: [
          { term: "沪深300", type: "index" },
          { term: "中信证券", type: "institution" },
          { term: "张三", type: "person" },
        ],
      }],
    })

    expect(summary.detail).toContain("指数 沪深300")
    expect(summary.detail).toContain("机构 中信证券")
    expect(summary.frameLine).toContain("人物 张三")
    expect(summary.detail).not.toContain("index")
    expect(summary.detail).not.toContain("institution")
  })

  it("filters date-only and broad-market candidate titles from the PM work queue", () => {
    expect(isWeakSignalTitle("2026-06-19")).toBe(true)
    expect(isWeakSignalTitle("3.")).toBe(true)
    expect(isWeakSignalTitle("预期差, 自主可控, 芯片")).toBe(true)
    expect(isWeakSignalTitle("健滔涨价函可能推动 CCL 链条量价重估")).toBe(false)
  })

  it("turns a large pending queue into a fund-manager next-action summary", () => {
    const summary = buildPmDecisionQueueSummary({
      totalCount: 62,
      priorityCount: 5,
      confirmableCount: 2,
      askRecommendedCount: 3,
      candidateCount: 9,
      quietCount: 48,
      topTitle: "健滔涨价函可能推动 CCL 链条量价重估",
      topSignalType: "新催化",
    })

    expect(summary.tone).toBe("action")
    expect(summary.primaryActionKind).toBe("confirm")
    expect(summary.headline).toContain("先确认 2 条状态变化")
    expect(summary.detail).toContain("健滔涨价函")
    expect(summary.secondary).toContain("48 条低优先级")
  })

  it("classifies pending cards into PM work sections", () => {
    expect(signalWorkSectionFor({
      kind: "tracked",
      canConfirm: true,
      evidenceDelta: "market_feedback",
      signalType: "市场反馈",
    })).toBe("confirm")
    expect(signalWorkSectionFor({
      kind: "tracked",
      evidenceDelta: "counter_signal",
      signalType: "反证",
    })).toBe("counter")
    expect(signalWorkSectionFor({
      kind: "tracked",
      evidenceDelta: "fundamental_delivery",
      signalType: "硬证据",
    })).toBe("hard")
    expect(signalWorkSectionFor({
      kind: "tracked",
      evidenceDelta: "market_feedback",
      signalType: "市场反馈",
    })).toBe("market")
    expect(signalWorkSectionFor({
      kind: "candidate",
      askDeepDiveRecommended: true,
      evidenceDelta: "catalyst_signal",
      signalType: "新催化",
    })).toBe("candidate")
    expect(signalWorkSectionFor({
      kind: "tracked",
      askDeepDiveRecommended: true,
      evidenceDelta: "catalyst_signal",
      signalType: "新催化",
    })).toBe("catalyst")
  })

  it("routes pending signals into clickable PM triage buckets", () => {
    expect(pmSignalTriageBucketForSignal({
      kind: "tracked",
      canConfirm: true,
      evidenceDelta: "market_feedback",
      signalType: "市场反馈",
    })).toBe("now")
    expect(pmSignalTriageBucketForSignal({
      kind: "tracked",
      evidenceDelta: "counter_signal",
      signalType: "反证",
    })).toBe("now")
    expect(pmSignalTriageBucketForSignal({
      kind: "candidate",
      askDeepDiveRecommended: true,
      evidenceDelta: "catalyst_signal",
      signalType: "新催化",
    })).toBe("now")
    expect(pmSignalTriageBucketForSignal({
      kind: "tracked",
      evidenceDelta: "catalyst_signal",
      signalType: "新催化",
    })).toBe("watch")
    expect(pmSignalTriageBucketForSignal({
      kind: "candidate",
      evidenceDelta: "catalyst_signal",
      signalType: "新催化",
    })).toBe("watch")
    expect(pmSignalTriageBucketForSignal({
      kind: "tracked",
      evidenceDelta: "narrative_expansion",
      signalType: "叙事扩散",
    })).toBe("noise")
  })

  it("builds PM guidance for pending card section headers", () => {
    const catalyst = buildSignalWorkSectionHeader({ id: "catalyst", count: 3 })
    expect(catalyst.label).toBe("新催化 / Ask")
    expect(catalyst.countLabel).toBe("3 条")
    expect(catalyst.detail).toContain("先 Ask 排股票")

    const candidate = buildSignalWorkSectionHeader({ id: "candidate", count: 2 })
    expect(candidate.label).toBe("候选新假设")
    expect(candidate.detail).toContain("预检后再入池")

    const quiet = buildSignalWorkSectionHeader({ id: "quiet", count: 6 })
    expect(quiet.tone).toBe("quiet")
    expect(quiet.detail).toContain("等二次确认")
  })

  it("surfaces the top matched wiki frame in the queue summary", () => {
    const summary = buildPmDecisionQueueSummary({
      totalCount: 8,
      priorityCount: 3,
      confirmableCount: 0,
      askRecommendedCount: 2,
      candidateCount: 1,
      quietCount: 4,
      topTitle: "CPO 放缓可能推动 MPO 连接器订单弹性",
      topSignalType: "新催化",
      topRelatedWikiPages: [{
        wikiMeta: {
          status: "活跃",
          confidence: "高",
          momentum: "热",
          catalysts: ["MPO跳线需求"],
        },
      }],
    })

    expect(summary.detail).toContain("CPO 放缓")
    expect(summary.detail).toContain("命中活跃框架")
    expect(summary.detail).toContain("高置信")
    expect(summary.detail).toContain("热动量")
  })

  it("surfaces finance entity types in the queue summary for faster PM triage", () => {
    const summary = buildPmDecisionQueueSummary({
      totalCount: 4,
      priorityCount: 2,
      confirmableCount: 0,
      askRecommendedCount: 2,
      candidateAskRecommendedCount: 2,
      candidateCount: 2,
      quietCount: 2,
      topTitle: "新催化：藤仓 DCI 光缆涨价 30% 和业绩上修",
      topSignalType: "新催化",
      topRelatedWikiPages: [{
        sourceRef: "wiki/概念/PCB半导体化设备耗材链.md",
        title: "PCB半导体化设备耗材链",
        matchedTerms: ["PCB", "板厂", "载板厂", "层压机"],
        financeAuditMatchedTerms: ["PCB", "板厂", "载板厂", "层压机"],
        financeAuditMatchedEntities: [
          { term: "PCB", type: "product_line", label: "产品线" },
          { term: "PCB", type: "metric", label: "指标" },
          { term: "板厂", type: "supply_chain_role", label: "产业链位置" },
          { term: "载板厂", type: "supply_chain_role", label: "产业链位置" },
          { term: "层压机", type: "product_line", label: "产品线" },
        ],
        wikiMeta: {
          status: "活跃",
          confidence: "中",
          momentum: "热",
          tags: ["PCB", "AI服务器"],
        },
      }],
    })

    expect(summary.primaryActionKind).toBe("ask")
    expect(summary.primaryAction).toBe("Ask 预检")
    expect(summary.detail).toContain("藤仓 DCI 光缆涨价")
    expect(summary.frameLine).toContain("金融类型：产品线 PCB/层压机")
    expect(summary.detail).toContain("产业链位置 板厂/载板厂")
    expect(summary.detail).not.toContain("金融类型：")
    expect(summary.detail).not.toContain("指标 PCB")
    expect(summary.frameLine).toContain("金融类型")
  })

  it("groups pending signals by the wiki frame they hit", () => {
    const clusters = buildWikiFrameClusters([
      {
        signal: {
          relatedWikiPages: [{
            title: "CPO/MPO 当前状态",
            sourceRef: "wiki/CPO/当前状态.md",
            wikiMeta: {
              status: "活跃",
              confidence: "高",
              momentum: "热",
              catalysts: ["MPO跳线需求"],
            },
          }],
        },
      },
      {
        signal: {
          relatedWikiPages: [{
            title: "CPO/MPO 当前状态",
            sourceRef: "wiki/CPO/当前状态.md",
            wikiMeta: {
              status: "活跃",
              confidence: "高",
              momentum: "热",
              catalysts: ["MPO跳线需求"],
            },
          }],
        },
      },
      {
        relatedWikiPages: [{
          title: "玻璃基板产业化",
          sourceRef: "wiki/玻璃基板.md",
          wikiMeta: {
            status: "观察",
            confidence: "中",
            catalysts: ["TGV设备验证"],
          },
        }],
      },
    ])

    expect(clusters).toHaveLength(2)
    expect(clusters[0]).toMatchObject({
      label: "CPO/MPO 当前状态",
      sourceRef: "wiki/CPO/当前状态.md",
      count: 2,
      tone: "hot",
    })
    expect(clusters[0].detail).toContain("活跃框架")
    expect(clusters[0].detail).toContain("高置信")
    expect(clusters[0].detail).toContain("热动量")
    expect(clusters[1].label).toBe("玻璃基板产业化")
  })

  it("summarizes an empty scan as no-action monitoring", () => {
    const digest = buildSignalRunDigest({
      totalCount: 0,
      rawSignalCount: 0,
      confirmableCount: 0,
      askRecommendedCount: 0,
      catalystCount: 0,
      hardEvidenceCount: 0,
      counterCount: 0,
      marketFeedbackCount: 0,
      candidateCount: 0,
      quietCount: 0,
    })

    expect(digest.tone).toBe("idle")
    expect(digest.headline).toContain("暂无")
    expect(digest.badges).toHaveLength(0)
  })

  it("hides scan context before any Watchtower result exists", () => {
    const copy = buildSignalScanContextCopy(undefined)

    expect(copy.show).toBe(false)
    expect(copy.badges).toEqual([])
  })

  it("shows a source capability placeholder before scanning", () => {
    const copy = buildSignalSourceCapabilityCopy(undefined)

    expect(copy.show).toBe(true)
    expect(copy.label).toBe("等待扫描")
    expect(copy.detail).toContain("SAG 金融关键词表")
    expect(copy.badges.map((badge) => badge.label)).toContain("未加载上下文")
  })

  it("reuses finance audit context for the source capability notice", () => {
    const copy = buildSignalSourceCapabilityCopy({
      contextLoads: {
        wikiIndustryTerms: true,
        wikiReferenceIndex: true,
        financeEntityAudit: true,
        financeEntityAuditRows: 22037,
        financeEntityAuditTableRef: "/tmp/wiki-project/.llm-wiki/sag-entity-audit/full-wiki-finance-entities-20260623/project-entity-table.csv",
        financeEntityAuditTypeCounts: {
          company: 922,
          sector: 240,
          theme: 612,
          product_line: 3176,
          tech_route: 986,
          stock: 1524,
          catalyst: 2448,
          trade_pattern: 188,
          market_regime: 76,
          risk_factor: 431,
        },
      },
    })

    expect(copy.label).toBe("框架扫描")
    expect(copy.detail).toContain("已用 wiki 框架和全量金融词表路由新增资料")
    expect(copy.detail).toContain("下一步看待处理卡片")
    expect(copy.detail).not.toContain("不是普通关键词匹配")
    expect(copy.expandedDetail).toContain("SAG 金融关键词")
    expect(copy.expandedDetail).toContain("不是普通关键词匹配")
    expect(copy.expandedDetail).toContain("股票、公司、行业、主题、产品线、技术路线、催化、交易模式、市场状态和风险反证")
    expect(copy.expandedDetail).toContain("待处理卡片与 Ask 深挖入口")
    expect(copy.badges.map((badge) => badge.label)).toEqual(expect.arrayContaining([
      "全量金融词表 2.2万",
      "股票",
      "公司",
      "行业",
      "主题",
      "产品线",
      "技术路线",
      "催化词",
      "交易模式",
    ]))
    expect(copy.badges.find((badge) => badge.label === "全量金融词表 2.2万")?.title).toContain("SAG金融词 22037 行")
    expect(copy.badges.find((badge) => badge.label === "全量金融词表 2.2万")?.title).toContain("project-entity-table.csv")
    expect(copy.badges.find((badge) => badge.label === "产品线")?.title).toBe("产品线 3176")
  })

  it("explains no-source watch runs as not loading wiki context", () => {
    const copy = buildSignalScanContextCopy({
      skippedReason: "no_sources",
      contextLoads: {
        wikiIndustryTerms: false,
        wikiReferenceIndex: false,
        financeEntityAudit: false,
      },
      sourceDiscovery: {
        fileRootsSkipped: 4,
        durationMs: 9,
      },
    })

    expect(copy.show).toBe(true)
    expect(copy.label).toBe("无新增资料")
    expect(copy.detail).toContain("没有加载 wiki")
    expect(copy.badges.map((badge) => badge.label)).toContain("未加载上下文")
    expect(copy.badges.map((badge) => badge.label)).toEqual(expect.arrayContaining(["跳过文件根 4", "源发现 9ms"]))
  })

  it("explains light signal scans without wiki framework context", () => {
    const copy = buildSignalScanContextCopy({
      contextLoads: {
        wikiIndustryTerms: false,
        wikiReferenceIndex: false,
        financeEntityAudit: false,
      },
    })

    expect(copy.label).toBe("轻扫描")
    expect(copy.detail).toContain("反馈会更快")
    expect(copy.badges.map((badge) => badge.label)).toContain("快速路径")
  })

  it("explains finance entity audit powered framework scans", () => {
    const copy = buildSignalScanContextCopy({
      contextLoads: {
        wikiIndustryTerms: true,
        wikiReferenceIndex: true,
        financeEntityAudit: true,
        financeEntityAuditRows: 22037,
        financeEntityAuditTableRef: ".llm-wiki/sag-entity-audit/full-wiki-finance-entities-20260623/project-entity-table.csv",
        financeEntityAuditTypeCounts: {
          company: 922,
          sector: 240,
          theme: 612,
          product_line: 3176,
          tech_route: 986,
          stock: 1524,
          catalyst: 2448,
          trade_pattern: 188,
          market_regime: 76,
          risk_factor: 431,
        },
      },
      sourceDiscovery: {
        fileRootsSkipped: 4,
        fileCandidatesAfterCutoff: 5,
        fileSourcesRead: 2,
        fileSourcesSkippedByLimit: 3,
        wechatIncrementalSources: 5,
        wechatIncrementalLinesRead: 5,
        durationMs: 28,
      },
    })

    expect(copy.label).toBe("框架扫描")
    expect(copy.detail).toBe("已用 wiki 框架和全量金融词表路由新增资料；下一步看待处理卡片或点 LLM 复核。")
    expect(copy.expandedDetail).toContain("SAG 金融关键词")
    expect(copy.expandedDetail).toContain("不是普通关键词匹配")
    expect(copy.expandedDetail).toContain("股票、公司、行业、主题、产品线、技术路线、催化、交易模式、市场状态和风险反证")
    expect(copy.expandedDetail).toContain("待处理卡片与 Ask 深挖入口")
    expect(copy.expandedDetail).toContain("覆盖：股票 1524、公司 922、行业 240、主题 612、产品线 3176、技术路线 986、催化词 2448、交易模式 188、市场状态 76、风险反证 431")
    expect(copy.expandedDetail).toContain("已加载词表 project-entity-table.csv")
    expect(copy.expandedDetail).not.toContain("/tmp/wiki-project")
    expect(copy.badges.map((badge) => badge.label)).toContain("全量金融词表 2.2万")
    expect(copy.badges.find((badge) => badge.label === "全量金融词表 2.2万")?.title).toContain("SAG金融词 22037 行")
    expect(copy.badges.find((badge) => badge.label === "全量金融词表 2.2万")?.title).toContain("词表 project-entity-table.csv")
    expect(copy.badges.map((badge) => badge.label)).not.toContain("SAG金融词 22037")
    expect(copy.badges.map((badge) => badge.label)).not.toContain("词表 project-entity-table.csv")
    expect(copy.badges.map((badge) => badge.label)).toEqual(expect.arrayContaining([
      "股票",
      "公司",
      "行业",
      "主题",
      "产品线",
      "技术路线",
      "催化词",
      "交易模式",
      "跳过文件根 4",
      "文件候选 5",
      "读取文件 2",
      "限额跳过 3",
      "资料源 5",
      "资料读行 5",
      "源发现 28ms",
    ]))
  })

  it("labels generalized cleaned finance entity tables as the preferred clean keyword source", () => {
    const copy = buildSignalScanContextCopy({
      contextLoads: {
        wikiIndustryTerms: true,
        wikiReferenceIndex: true,
        financeEntityAudit: true,
        financeEntityAuditRows: 18814,
        financeEntityAuditTableRef: ".llm-wiki/sag-entity-audit/full-wiki-finance-entities-20260623/generalized-cleaned-entity-table.csv",
        financeEntityAuditTypeCounts: {
          product_line: 3176,
          tech_route: 986,
          catalyst: 2448,
        },
      },
    })

    expect(copy.detail).toContain("清洗版金融词表")
    expect(copy.expandedDetail).toContain("SAG 清洗泛化金融关键词表")
    expect(copy.expandedDetail).toContain("已加载清洗泛化表 generalized-cleaned-entity-table.csv")
    expect(copy.badges.map((badge) => badge.label)).toContain("清洗版金融词表 1.9万")
    expect(copy.badges.find((badge) => badge.label === "清洗版金融词表 1.9万")?.title).toContain("清洗泛化表 generalized-cleaned-entity-table.csv")
  })

  it("surfaces LLM review stage inside the scan context copy", () => {
    const reviewed = buildSignalScanContextCopy({
      contextLoads: {
        wikiIndustryTerms: true,
        wikiReferenceIndex: true,
        financeEntityAudit: true,
        financeEntityAuditRows: 22037,
      },
      reviewPipeline: {
        llm: {
          status: "done",
          mode: "auto",
          reviewedCount: 2,
          candidateCount: 2,
        },
      },
    })

    expect(reviewed.label).toBe("框架扫描+LLM复核")
    expect(reviewed.detail).toContain("已用 wiki 框架和全量金融词表路由新增资料")
    expect(reviewed.expandedDetail).toContain("LLM 已复核")
    expect(reviewed.badges.map((badge) => badge.label)).toContain("LLM复核 2/2")

    const skipped = buildSignalScanContextCopy({
      contextLoads: {
        wikiIndustryTerms: true,
        wikiReferenceIndex: true,
        financeEntityAudit: true,
      },
      reviewPipeline: {
        llm: {
          status: "skipped",
          reason: "too_many_candidate_items",
          candidateCount: 24,
          maxItems: 20,
        },
      },
    })

    expect(skipped.label).toBe("框架扫描")
    expect(skipped.detail).toContain("已用 wiki 框架和全量金融词表路由新增资料")
    expect(skipped.expandedDetail).toContain("规则结果待复核")
    expect(skipped.badges.map((badge) => badge.label)).toContain("待LLM复核 24")
  })

  it("puts confirmable hypothesis changes ahead of other scan results", () => {
    const digest = buildSignalRunDigest({
      totalCount: 8,
      rawSignalCount: 21,
      confirmableCount: 2,
      askRecommendedCount: 3,
      catalystCount: 4,
      hardEvidenceCount: 0,
      counterCount: 0,
      marketFeedbackCount: 1,
      candidateCount: 2,
      quietCount: 3,
    })

    expect(digest.tone).toBe("action")
    expect(digest.headline).toContain("先处理 2 条状态变化")
    expect(digest.badges.some((badge) => badge.label === "可确认" && badge.value === 2)).toBe(true)
  })

  it("summarizes Ask-worthy results as deep-dive work", () => {
    const digest = buildSignalRunDigest({
      totalCount: 5,
      rawSignalCount: 9,
      confirmableCount: 0,
      askRecommendedCount: 3,
      catalystCount: 2,
      hardEvidenceCount: 0,
      counterCount: 0,
      marketFeedbackCount: 0,
      candidateCount: 1,
      quietCount: 2,
    })

    expect(digest.tone).toBe("review")
    expect(digest.headline).toContain("值得 Ask 深挖")
    expect(digest.detail).toContain("关联股票")
  })

  it("summarizes quiet narrative-only scans as observation", () => {
    const digest = buildSignalRunDigest({
      totalCount: 6,
      rawSignalCount: 12,
      confirmableCount: 0,
      askRecommendedCount: 0,
      catalystCount: 0,
      hardEvidenceCount: 0,
      counterCount: 0,
      marketFeedbackCount: 0,
      candidateCount: 0,
      quietCount: 6,
    })

    expect(digest.tone).toBe("quiet")
    expect(digest.headline).toBe("主要是叙事扩散，先观察")
    expect(digest.badges[0]).toEqual({ label: "合并信号", value: 12 })
  })

  it("keeps folded low-priority candidates out of the main digest action", () => {
    const digest = buildSignalRunDigest({
      totalCount: 4,
      rawSignalCount: 4,
      confirmableCount: 0,
      askRecommendedCount: 0,
      catalystCount: 0,
      hardEvidenceCount: 0,
      counterCount: 0,
      marketFeedbackCount: 0,
      candidateCount: 0,
      quietCount: 4,
    })

    expect(digest.tone).toBe("quiet")
    expect(digest.headline).toBe("主要是叙事扩散，先观察")
    expect(digest.detail).toContain("4 条低优先级")
  })

  it("orders focus buckets by PM urgency instead of raw count size", () => {
    const buckets = buildSignalFocusBuckets({
      confirmableCount: 1,
      counterCount: 1,
      hardEvidenceCount: 2,
      marketFeedbackCount: 3,
      catalystCount: 9,
      candidateCount: 4,
      quietCount: 30,
    })

    expect(buckets.map((bucket) => bucket.id)).toEqual([
      "confirm",
      "counter",
      "hard",
      "market",
      "catalyst",
      "candidate",
      "quiet",
    ])
    expect(buckets[0].guidance).toContain("确认")
    expect(buckets[1].tone).toBe("danger")
    expect(buckets.at(-1)?.label).toBe("低优先级")
  })

  it("summarizes pending work into three PM triage buckets", () => {
    const buckets = buildPmSignalTriageBuckets({
      confirmableCount: 2,
      counterCount: 1,
      hardEvidenceCount: 1,
      marketFeedbackCount: 2,
      askRecommendedCount: 3,
      catalystCount: 4,
      candidateCount: 2,
      quietCount: 30,
    })

    expect(buckets.map((bucket) => bucket.id)).toEqual(["now", "watch", "noise"])
    expect(buckets[0]).toMatchObject({
      label: "马上看",
      value: 9,
      tone: "action",
    })
    expect(buckets[0].detail).toContain("确认/反证/硬证据/市场反馈/Ask")
    expect(buckets[1]).toMatchObject({
      label: "可观察",
      value: 3,
      tone: "review",
    })
    expect(buckets[1].detail).toContain("新催化/候选")
    expect(buckets[2]).toMatchObject({
      label: "噪声/待二次确认",
      value: 30,
      tone: "quiet",
    })
  })

  it("keeps quiet-only scans in the noise bucket without creating false urgency", () => {
    const buckets = buildPmSignalTriageBuckets({
      confirmableCount: 0,
      counterCount: 0,
      hardEvidenceCount: 0,
      marketFeedbackCount: 0,
      askRecommendedCount: 0,
      catalystCount: 0,
      candidateCount: 0,
      quietCount: 5,
    })

    expect(buckets[0]).toMatchObject({ id: "now", value: 0, active: false })
    expect(buckets[1]).toMatchObject({ id: "watch", value: 0, active: false })
    expect(buckets[2]).toMatchObject({
      id: "noise",
      value: 5,
      active: true,
    })
    expect(buckets[2].nextAction).toContain("继续自动跟踪")
  })

  it("omits empty focus buckets so a quiet scan does not look busy", () => {
    const buckets = buildSignalFocusBuckets({
      confirmableCount: 0,
      counterCount: 0,
      hardEvidenceCount: 0,
      marketFeedbackCount: 0,
      catalystCount: 0,
      candidateCount: 0,
      quietCount: 5,
    })

    expect(buckets).toHaveLength(1)
    expect(buckets[0]).toMatchObject({
      id: "quiet",
      label: "低优先级",
      value: 5,
    })
  })

  it("explains collapsed low-priority signals by source of noise", () => {
    const summary = buildQuietSignalsSummary({
      quietTrackedCount: 7,
      quietCandidateCount: 3,
      quietRawSignalCount: 15,
      hiddenCount: 10,
      hasPriority: true,
      showQuietSignals: false,
    })

    expect(summary.headline).toBe("默认收起 10 条低优先级信号")
    expect(summary.detail).toContain("7 条叙事扩散/弱相关命中")
    expect(summary.detail).toContain("3 条弱候选")
    expect(summary.detail).toContain("5 条重复来源")
    expect(summary.decisionLabel).toBe("先处理优先卡片")
    expect(summary.nextAction).toContain("处理完")
    expect(summary.toggleLabel).toBe("展开低优先级")
    expect(summary.badges.map((badge) => badge.label)).toEqual(["叙事扩散", "弱候选", "重复来源"])
  })

  it("turns quiet-only scans into a clear no-action decision", () => {
    const summary = buildQuietSignalsSummary({
      quietTrackedCount: 9,
      quietCandidateCount: 1,
      quietRawSignalCount: 14,
      hiddenCount: 10,
      hasPriority: false,
      showQuietSignals: false,
    })

    expect(summary.headline).toBe("本轮只有 10 条低优先级信号")
    expect(summary.decisionLabel).toBe("可以先不处理")
    expect(summary.nextAction).toContain("保持自动跟踪")
    expect(summary.nextAction).toContain("优先区")
  })

  it("labels pending counts by actionable work instead of scary raw queue size", () => {
    expect(buildPendingCountLabel({
      totalCount: 62,
      priorityCount: 3,
      quietCount: 59,
      rawSignalCount: 88,
    })).toBe("3 个优先 / 折叠 59 个低优先级 / 合并 88 条")
    expect(buildPendingCountLabel({
      totalCount: 4,
      priorityCount: 0,
      quietCount: 4,
      rawSignalCount: 4,
    })).toBe("4 个低优先级")
  })

  it("keeps quiet-only scans collapsed until the user explicitly expands them", () => {
    expect(buildQuietSignalVisibility({
      hasPriority: false,
      quietCount: 12,
      showQuietSignals: false,
    })).toEqual({
      showQuietSignals: false,
      showSummary: true,
      reason: "quiet-only",
    })

    expect(buildQuietSignalVisibility({
      hasPriority: false,
      quietCount: 12,
      showQuietSignals: true,
    })).toEqual({
      showQuietSignals: true,
      showSummary: true,
      reason: "expanded",
    })
  })

  it("keeps mixed-priority quiet signals summarized while priority cards stay visible", () => {
    expect(buildQuietSignalVisibility({
      hasPriority: true,
      quietCount: 8,
      showQuietSignals: false,
    })).toEqual({
      showQuietSignals: false,
      showSummary: true,
      reason: "mixed-priority",
    })

    expect(buildQuietSignalVisibility({
      hasPriority: true,
      quietCount: 0,
      showQuietSignals: false,
    })).toEqual({
      showQuietSignals: false,
      showSummary: false,
      reason: "none",
    })
  })

  it("places low-priority noise summaries before the card list so the user sees the filter first", () => {
    expect(buildQuietSignalSummaryPlacement({
      hiddenCount: 0,
      visibility: {
        showQuietSignals: false,
        showSummary: true,
        reason: "mixed-priority",
      },
    })).toEqual({ position: "before-list" })

    expect(buildQuietSignalSummaryPlacement({
      hiddenCount: 0,
      visibility: {
        showQuietSignals: false,
        showSummary: true,
        reason: "quiet-only",
      },
    })).toEqual({ position: "before-list" })

    expect(buildQuietSignalSummaryPlacement({
      hiddenCount: 5,
      visibility: {
        showQuietSignals: false,
        showSummary: false,
        reason: "none",
      },
    })).toEqual({ position: "after-list" })
  })

  it("explains when low-priority signals are already expanded", () => {
    const summary = buildQuietSignalsSummary({
      quietTrackedCount: 2,
      quietCandidateCount: 1,
      quietRawSignalCount: 3,
      hiddenCount: 0,
      showQuietSignals: true,
    })

    expect(summary.headline).toBe("正在显示 3 条低优先级信号")
    expect(summary.detail).toContain("这些信号暂不改变状态")
    expect(summary.toggleLabel).toBe("收起低优先级")
  })

  it("falls back to overflow wording when priority cards are simply too many", () => {
    const summary = buildQuietSignalsSummary({
      quietTrackedCount: 0,
      quietCandidateCount: 0,
      quietRawSignalCount: 0,
      hiddenCount: 5,
      showQuietSignals: false,
    })

    expect(summary.headline).toBe("优先卡片较多，先处理当前可见项")
    expect(summary.detail).toContain("仍有 5 条未展开")
    expect(summary.badges).toHaveLength(0)
  })

  it("turns confirm queue summaries into a digest primary action", () => {
    const action = buildSignalRunDigestAction(buildPmDecisionQueueSummary({
      totalCount: 4,
      priorityCount: 3,
      confirmableCount: 1,
      askRecommendedCount: 2,
      candidateCount: 0,
      quietCount: 1,
      topTitle: "健滔涨价函可能推动 CCL 链条量价重估",
      topSignalType: "硬证据",
    }))

    expect(action?.kind).toBe("confirm")
    expect(action?.label).toBe("确认状态")
    expect(action?.variant).toBe("default")
    expect(action?.ariaLabel).toContain("确认状态")
  })

  it("leads the scan digest with the PM next action instead of raw counts", () => {
    const digest = buildSignalRunDigest({
      totalCount: 8,
      rawSignalCount: 21,
      confirmableCount: 2,
      askRecommendedCount: 3,
      catalystCount: 4,
      hardEvidenceCount: 0,
      counterCount: 0,
      marketFeedbackCount: 1,
      candidateCount: 2,
      quietCount: 3,
    })
    const queueSummary = buildPmDecisionQueueSummary({
      totalCount: 8,
      priorityCount: 5,
      confirmableCount: 2,
      askRecommendedCount: 3,
      candidateCount: 2,
      quietCount: 3,
      topTitle: "健滔涨价函可能推动 CCL 链条量价重估",
      topSignalType: "市场反馈",
    })

    const copy = buildSignalRunDecisionCopy({ digest, queueSummary })

    expect(copy.headline).toBe("下一步：先确认 2 条状态变化")
    expect(copy.detail).toContain("健滔涨价函")
    expect(copy.decisionParts.map((part) => part.label)).toEqual(["为什么重要", "影响", "现在动作"])
    expect(copy.decisionParts[0]?.value).toContain("改变假设状态")
    expect(copy.decisionParts[1]?.value).toContain("健滔涨价函")
    expect(copy.decisionParts[2]?.value).toContain("确认状态")
    expect(copy.supporting).toContain("先确认真实状态变化")
  })

  it("keeps quiet scan digest as observation when there is no primary action", () => {
    const digest = buildSignalRunDigest({
      totalCount: 4,
      rawSignalCount: 4,
      confirmableCount: 0,
      askRecommendedCount: 0,
      catalystCount: 0,
      hardEvidenceCount: 0,
      counterCount: 0,
      marketFeedbackCount: 0,
      candidateCount: 0,
      quietCount: 4,
    })
    const queueSummary = buildPmDecisionQueueSummary({
      totalCount: 4,
      priorityCount: 0,
      confirmableCount: 0,
      askRecommendedCount: 0,
      candidateCount: 0,
      quietCount: 4,
    })

    const copy = buildSignalRunDecisionCopy({ digest, queueSummary })

    expect(copy.headline).toBe("下一步：主要是叙事扩散，先观察")
    expect(copy.detail).toContain("不足以改变假设状态")
    expect(copy.decisionParts.map((part) => part.label)).toEqual(["为什么重要", "影响", "现在动作"])
  })

  it("condenses the queue into a PM one-line opening brief", () => {
    const digest = buildSignalRunDigest({
      totalCount: 4,
      rawSignalCount: 8,
      confirmableCount: 1,
      askRecommendedCount: 2,
      catalystCount: 2,
      hardEvidenceCount: 0,
      counterCount: 0,
      marketFeedbackCount: 1,
      candidateCount: 1,
      quietCount: 2,
    })
    const confirmBrief = buildPmOpeningBrief({
      digest,
      queueSummary: buildPmDecisionQueueSummary({
        totalCount: 4,
        priorityCount: 2,
        confirmableCount: 1,
        askRecommendedCount: 2,
        candidateCount: 1,
        quietCount: 2,
        topTitle: "CPO增速放缓可能推动MPO连接器量价齐升",
        topSignalType: "新催化",
        topRelatedWikiPages: [{
          wikiMeta: {
            status: "活跃",
            confidence: "中",
            momentum: "热",
            catalysts: ["CPO节奏放缓", "MPO跳线需求"],
          },
        }],
      }),
    })

    expect(confirmBrief.headline).toContain("今天先确认")
    expect(confirmBrief.headline).toContain("CPO增速放缓")
    expect(confirmBrief.detail).toContain("命中框架")
    expect(confirmBrief.detail).toContain("确认才写入假设记忆")
    expect(confirmBrief.actionLabel).toBe("确认状态")
    expect(confirmBrief.tone).toBe("action")

    const askBrief = buildPmOpeningBrief({
      digest,
      queueSummary: buildPmDecisionQueueSummary({
        totalCount: 3,
        priorityCount: 2,
        confirmableCount: 0,
        askRecommendedCount: 2,
        candidateCount: 0,
        quietCount: 1,
        topTitle: "健滔涨价函可能推动 CCL 链条量价重估",
        topSignalType: "新催化",
      }),
    })
    expect(askBrief.headline).toContain("今天先 Ask")
    expect(askBrief.headline).toContain("健滔涨价函")
    expect(askBrief.detail).toContain("不自动改状态")
    expect(askBrief.actionLabel).toBe("Ask 深挖")
    expect(askBrief.tone).toBe("review")

    const createBrief = buildPmOpeningBrief({
      digest,
      queueSummary: buildPmDecisionQueueSummary({
        totalCount: 2,
        priorityCount: 1,
        confirmableCount: 0,
        askRecommendedCount: 0,
        candidateCount: 1,
        quietCount: 1,
        topTitle: "玻璃基板产业化加速可能先利好设备材料",
        topSignalType: "新催化",
      }),
    })
    expect(createBrief.headline).toContain("今天先筛")
    expect(createBrief.headline).toContain("玻璃基板")
    expect(createBrief.detail).toContain("加入跟踪后才进入假设表")

    const quietBrief = buildPmOpeningBrief({
      digest,
      queueSummary: buildPmDecisionQueueSummary({
        totalCount: 4,
        priorityCount: 0,
        confirmableCount: 0,
        askRecommendedCount: 0,
        candidateCount: 0,
        quietCount: 4,
        topTitle: "CPO增速放缓可能推动MPO连接器量价齐升",
      }),
    })
    expect(quietBrief.headline).toContain("今天先观察")
    expect(quietBrief.detail).toContain("等二次来源")

    const idleBrief = buildPmOpeningBrief({
      digest,
      queueSummary: buildPmDecisionQueueSummary({
        totalCount: 0,
        priorityCount: 0,
        confirmableCount: 0,
        askRecommendedCount: 0,
        candidateCount: 0,
        quietCount: 0,
      }),
    })
    expect(idleBrief.headline).toContain("先扫描新增")
    expect(idleBrief.actionLabel).toBe("扫描新增资料")
    expect(idleBrief.tone).toBe("idle")
  })

  it("builds one shared PM decision view-model for top status and todo list", () => {
    const model = buildSignalQueueDecisionViewModel({
      items: [
        {
          key: "ask-cpo",
          kind: "tracked",
          title: "CPO增速放缓可能推动MPO连接器量价齐升",
          createdAt: "2026-06-19T09:00:00Z",
          score: 80,
          priority: true,
          askDeepDiveRecommended: true,
          evidenceDelta: "catalyst_signal",
          signalType: "新催化",
          sourceCount: 2,
          relatedWikiPages: [{
            wikiMeta: {
              status: "活跃",
              confidence: "中",
              momentum: "热",
              catalysts: ["CPO节奏放缓", "MPO跳线需求"],
            },
          }],
        },
        {
          key: "confirm-ccl",
          kind: "tracked",
          title: "健滔涨价函可能推动 CCL 链条量价重估",
          createdAt: "2026-06-19T10:00:00Z",
          score: 100,
          priority: true,
          canConfirm: true,
          evidenceDelta: "market_feedback",
          signalType: "市场反馈",
          sourceCount: 3,
        },
        {
          key: "quiet-date",
          kind: "tracked",
          title: "2026-06-19",
          score: 1,
          priority: false,
          evidenceDelta: "narrative_expansion",
          signalType: "叙事扩散",
        },
      ],
    })

    expect(model.totalCount).toBe(3)
    expect(model.rawSignalCount).toBe(6)
    expect(model.priorityCount).toBe(2)
    expect(model.quietCount).toBe(1)
    expect(model.confirmableCount).toBe(1)
    expect(model.askRecommendedCount).toBe(1)
    expect(model.marketFeedbackCount).toBe(1)
    expect(model.catalystCount).toBe(1)
    expect(model.queueSummary.primaryActionKind).toBe("confirm")
    expect(model.openingBrief.headline).toContain("今天先确认")
    expect(model.openingBrief.headline).toContain("健滔涨价函")
    expect(model.focusBrief.targetTitle).toContain("健滔涨价函")
    expect(model.digest.badges.some((badge) => badge.label === "新催化" && badge.value === 1)).toBe(true)
  })

  it("turns queue summaries into a one-glance PM focus brief", () => {
    const digest = buildSignalRunDigest({
      totalCount: 4,
      rawSignalCount: 8,
      confirmableCount: 1,
      askRecommendedCount: 2,
      catalystCount: 2,
      hardEvidenceCount: 0,
      counterCount: 0,
      marketFeedbackCount: 1,
      candidateCount: 1,
      quietCount: 2,
    })
    const confirmSummary = buildPmDecisionQueueSummary({
      totalCount: 4,
      priorityCount: 2,
      confirmableCount: 1,
      askRecommendedCount: 2,
      candidateCount: 1,
      quietCount: 2,
      topTitle: "CPO增速放缓可能推动MPO连接器量价齐升",
      topSignalType: "新催化",
      topRelatedWikiPages: [{
        wikiMeta: {
          status: "活跃",
          confidence: "中",
          momentum: "热",
          catalysts: ["CPO节奏放缓", "MPO跳线需求"],
        },
      }],
    })
    const confirmBrief = buildPmFocusBrief({ queueSummary: confirmSummary, digest })

    expect(confirmBrief.label).toBe("今天先确认")
    expect(confirmBrief.headline).toContain("先确认")
    expect(confirmBrief.targetLabel).toBe("主目标")
    expect(confirmBrief.targetTitle).toContain("CPO增速放缓")
    expect(confirmBrief.detail).toContain("CPO增速放缓")
    expect(confirmBrief.framework).toBe("活跃框架，中置信，热动量，催化 CPO节奏放缓/MPO跳线需求")
    expect(confirmBrief.guardrail).toContain(".llm-wiki")
    expect(confirmBrief.guardrail).toContain("不写 wiki/raw")
    expect(confirmBrief.operatorHint).toContain("点「确认状态」")
    expect(confirmBrief.operatorHint).toContain("先看来源")
    expect(confirmBrief.locatorHint).toContain("下方蓝框")
    expect(confirmBrief.locatorHint).toContain("确认状态")
    expect(confirmBrief.primaryOutcome).toContain("写入假设状态")
    expect(confirmBrief.primaryOutcome).toContain("审计事件")
    expect(confirmBrief.tone).toBe("action")

    const askSummary = buildPmDecisionQueueSummary({
      totalCount: 3,
      priorityCount: 2,
      confirmableCount: 0,
      askRecommendedCount: 2,
      candidateCount: 0,
      quietCount: 1,
      topTitle: "健滔涨价函可能推动 CCL 链条量价重估",
      topSignalType: "新催化",
    })
    const askBrief = buildPmFocusBrief({ queueSummary: askSummary, digest })
    expect(askBrief.label).toBe("今天先研究")
    expect(askBrief.targetLabel).toBe("研究目标")
    expect(askBrief.targetTitle).toContain("健滔涨价函")
    expect(askBrief.guardrail).toContain("不自动改假设状态")
    expect(askBrief.operatorHint).toContain("点「Ask")
    expect(askBrief.operatorHint).toContain("关联股票")
    expect(askBrief.locatorHint).toContain("下方蓝框")
    expect(askBrief.locatorHint).toContain("Ask")
    expect(askBrief.locatorHint).toContain("Ask 结果区")
    expect(askBrief.primaryOutcome).toContain("结构化摘要")
    expect(askBrief.primaryOutcome).toContain("六段回答")
    expect(askBrief.tone).toBe("review")

    const createSummary = buildPmDecisionQueueSummary({
      totalCount: 2,
      priorityCount: 1,
      confirmableCount: 0,
      askRecommendedCount: 0,
      candidateCount: 1,
      quietCount: 1,
      topTitle: "玻璃基板产业化加速可能先利好设备材料",
      topSignalType: "新催化",
    })
    const createBrief = buildPmFocusBrief({ queueSummary: createSummary, digest })
    expect(createBrief.label).toBe("今天先筛选")
    expect(createBrief.targetLabel).toBe("候选目标")
    expect(createBrief.targetTitle).toContain("玻璃基板")
    expect(createBrief.locatorHint).toContain("候选卡片")
    expect(createBrief.locatorHint).toContain("加入跟踪")
    expect(createBrief.primaryOutcome).toContain("加入跟踪后才进入假设池")

    const idleSummary = buildPmDecisionQueueSummary({
      totalCount: 0,
      priorityCount: 0,
      confirmableCount: 0,
      askRecommendedCount: 0,
      candidateCount: 0,
      quietCount: 0,
    })
    const idleBrief = buildPmFocusBrief({ queueSummary: idleSummary, digest })
    expect(idleBrief.label).toBe("等待新信号")
    expect(idleBrief.targetLabel).toBe("信号源")
    expect(idleBrief.targetTitle).toContain("新增资料")
    expect(idleBrief.guardrail).toContain("扫描新增资料")
    expect(idleBrief.operatorHint).toContain("扫描新增资料")
    expect(idleBrief.locatorHint).toContain("顶部")
    expect(idleBrief.locatorHint).toContain("扫描新增资料")
    expect(idleBrief.primaryOutcome).toContain("生成待处理卡片")
  })

  it("keeps Ask precheck as a digest action for candidate-only signals", () => {
    const action = buildSignalRunDigestAction(buildPmDecisionQueueSummary({
      totalCount: 3,
      priorityCount: 2,
      confirmableCount: 0,
      askRecommendedCount: 2,
      candidateAskRecommendedCount: 2,
      candidateCount: 2,
      quietCount: 1,
      topTitle: "玻璃基板产业化加速可能先利好设备材料",
      topSignalType: "新催化",
    }))

    expect(action?.kind).toBe("ask")
    expect(action?.label).toBe("Ask 预检")
    expect(action?.variant).toBe("outline")
  })

  it("does not render a digest primary action for quiet queues", () => {
    const action = buildSignalRunDigestAction(buildPmDecisionQueueSummary({
      totalCount: 12,
      priorityCount: 0,
      confirmableCount: 0,
      askRecommendedCount: 0,
      candidateCount: 0,
      quietCount: 12,
    }))

    expect(action).toBeNull()
  })

  it("marks Ask as the primary queue action when no status can be confirmed", () => {
    const summary = buildPmDecisionQueueSummary({
      totalCount: 8,
      priorityCount: 4,
      confirmableCount: 0,
      askRecommendedCount: 3,
      candidateCount: 1,
      quietCount: 4,
      topTitle: "CPO 放缓可能推动 MPO 连接器订单弹性",
      topSignalType: "新催化",
    })

    expect(summary.tone).toBe("review")
    expect(summary.primaryActionKind).toBe("ask")
    expect(summary.primaryAction).toBe("Ask 深挖")
  })

  it("uses Ask precheck as the primary action when ask targets are only candidates", () => {
    const summary = buildPmDecisionQueueSummary({
      totalCount: 3,
      priorityCount: 2,
      confirmableCount: 0,
      askRecommendedCount: 2,
      candidateAskRecommendedCount: 2,
      candidateCount: 2,
      quietCount: 1,
      topTitle: "健滔涨价函可能推动 CCL 链条量价重估",
      topSignalType: "新催化",
    })

    expect(summary.primaryActionKind).toBe("ask")
    expect(summary.primaryAction).toBe("Ask 预检")
    expect(summary.headline).toContain("Ask 预检")
    expect(summary.detail).toContain("预检后再决定是否入池")
  })

  it("uses direct finance signal entities in the PM queue summary", () => {
    const summary = buildPmDecisionQueueSummary({
      totalCount: 4,
      priorityCount: 2,
      confirmableCount: 0,
      askRecommendedCount: 1,
      candidateAskRecommendedCount: 1,
      candidateCount: 1,
      quietCount: 2,
      topTitle: "健滔涨价函可能推动 CCL 链条量价重估",
      topSignalType: "新催化",
      topFinanceEntityRecords: [{
        financeSignalEntities: [
          { term: "健滔", type: "company", label: "公司" },
          { term: "CCL", type: "product_line", label: "产品线" },
          { term: "涨价函", type: "catalyst", label: "催化" },
          { term: "2026-06-19", type: "time", label: "时间" },
        ],
      }],
    })

    expect(summary.frameLine).toContain("公司 健滔")
    expect(summary.frameLine).toContain("产品线 CCL")
    expect(summary.frameLine).toContain("催化 涨价函")
    expect(summary.frameLine).not.toContain("2026-06-19")
    expect(summary.detail).toContain("命中")
  })

  it("turns the PM queue summary into explicit decision lines", () => {
    const summary = buildPmDecisionQueueSummary({
      totalCount: 4,
      priorityCount: 2,
      confirmableCount: 0,
      askRecommendedCount: 1,
      candidateAskRecommendedCount: 1,
      candidateCount: 1,
      quietCount: 2,
      topTitle: "健滔涨价函可能推动 CCL 链条量价重估",
      topSignalType: "新催化",
      topFinanceEntityRecords: [{
        financeSignalEntities: [
          { term: "健滔", type: "company", label: "公司" },
          { term: "CCL", type: "product_line", label: "产品线" },
          { term: "涨价函", type: "catalyst", label: "催化" },
        ],
      }],
    })

    expect(summary.detail).toContain("为什么重要")
    expect(summary.detail).toContain("影响")
    expect(summary.detail).toContain("现在动作")
    expect(summary.detail).toContain("健滔")
    expect(summary.detail).toContain("CCL")
    expect(summary.detail).toContain("涨价函")
    expect(summary.detail).toContain("Ask 深挖")
    expect(summary.detail).toContain("排关联股票")
    expect(summary.detail).not.toContain("为什么重要：为什么重要")
    expect(summary.detail).not.toContain("。。")
    expect(summary.detail).toContain("Ask 预检")
  })

  it("uses Ask deep-dive for important tracked signals that are not status changes", () => {
    const summary = buildPmDecisionQueueSummary({
      totalCount: 2,
      priorityCount: 2,
      confirmableCount: 0,
      askRecommendedCount: 0,
      trackedReviewCount: 2,
      candidateCount: 0,
      quietCount: 0,
      topTitle: "健滔涨价函可能推动 CCL 链条量价重估",
      topSignalType: "硬证据",
    })

    expect(summary.tone).toBe("review")
    expect(summary.primaryActionKind).toBe("ask")
    expect(summary.primaryAction).toBe("Ask 深挖")
    expect(summary.headline).toBe("先 Ask 深挖 2 条信号")
    expect(summary.detail).toContain("健滔涨价函")
  })

  it("labels mixed tracked and candidate Ask targets as precheck plus deep-dive", () => {
    const summary = buildPmDecisionQueueSummary({
      totalCount: 3,
      priorityCount: 3,
      confirmableCount: 0,
      askRecommendedCount: 1,
      trackedReviewCount: 1,
      candidateAskRecommendedCount: 1,
      candidateCount: 1,
      quietCount: 0,
      topTitle: "CPO 放缓可能带动 MPO 连接器",
      topSignalType: "新催化",
    })

    expect(summary.primaryActionKind).toBe("ask")
    expect(summary.primaryAction).toBe("Ask 预检/深挖")
    expect(summary.headline).toBe("先 Ask 预检/深挖 2 条信号")
  })

  it("does not offer candidate creation for tracked-only priority signals", () => {
    const summary = buildPmDecisionQueueSummary({
      totalCount: 2,
      priorityCount: 2,
      confirmableCount: 0,
      askRecommendedCount: 0,
      candidateCount: 0,
      quietCount: 0,
      topTitle: "订单线索回连到已有假设",
      topSignalType: "硬证据",
    })

    expect(summary.primaryActionKind).not.toBe("create")
    expect(summary.primaryAction).not.toBe("创建或忽略")
  })

  it("summarizes quiet narrative queues as observation instead of action", () => {
    const summary = buildPmDecisionQueueSummary({
      totalCount: 12,
      priorityCount: 0,
      confirmableCount: 0,
      askRecommendedCount: 0,
      candidateCount: 0,
      quietCount: 12,
    })

    expect(summary.tone).toBe("quiet")
    expect(summary.primaryActionKind).toBe("none")
    expect(summary.headline).toBe("主要是叙事扩散，先观察")
    expect(summary.primaryAction).toBe("无需立刻确认")
  })

  it("does not create a primary action for quiet-only candidate queues", () => {
    const summary = buildPmDecisionQueueSummary({
      totalCount: 4,
      priorityCount: 0,
      confirmableCount: 0,
      askRecommendedCount: 0,
      candidateCount: 0,
      quietCount: 4,
      topTitle: "弱候选：泛主题扩散",
      topSignalType: "叙事扩散",
    })

    expect(summary.tone).toBe("quiet")
    expect(summary.primaryActionKind).toBe("none")
    expect(summary.headline).toBe("主要是叙事扩散，先观察")
  })

  it("counts only visible priority candidates in create queue summaries", () => {
    const summary = buildPmDecisionQueueSummary({
      totalCount: 5,
      priorityCount: 1,
      confirmableCount: 0,
      askRecommendedCount: 0,
      candidateCount: 1,
      quietCount: 4,
      topTitle: "健滔涨价函可能推动 CCL 链条量价重估",
      topSignalType: "新催化",
    })

    expect(summary.tone).toBe("review")
    expect(summary.primaryActionKind).toBe("create")
    expect(summary.headline).toBe("先筛 1 条候选")
    expect(summary.secondary).toContain("4 条低优先级")
  })

  it("extracts inline Ask deep-dive fields without repeating labels", () => {
    const answer = [
      "关联股票：胜宏科技、生益科技、沪电股份",
      "最直接受益：高频高速 CCL 与 AI 服务器 PCB 供应链。",
      "利好排序：CCL > 高速 PCB > 设备材料。",
      "当前阶段：新催化到二次确认之间。",
      "最大缺口：涨价函原文、订单和财报毛利率验证。",
      "一句话结论：先跟踪价格传导和量价扩散，不直接当作业绩兑现。",
    ].join("\n")

    const summary = buildAskDeepDiveSummary(answer)

    expect(summary.stocks).toBe("胜宏科技、生益科技、沪电股份")
    expect(summary.directBeneficiary).toBe("高频高速 CCL 与 AI 服务器 PCB 供应链。")
    expect(summary.ranking).toBe("CCL > 高速 PCB > 设备材料。")
    expect(summary.stage).toBe("新催化到二次确认之间。")
    expect(summary.gap).toBe("涨价函原文、订单和财报毛利率验证。")
    expect(summary.conclusion).toBe("先跟踪价格传导和量价扩散，不直接当作业绩兑现。")
    expect(summary.nextAction).toContain("先补")
  })

  it("turns an Ask summary with stocks and gaps into a verification decision card", () => {
    const snapshot = buildAskDecisionSnapshot({
      stocks: "胜宏科技、生益科技、沪电股份",
      directBeneficiary: "高频高速 CCL 与 AI 服务器 PCB 供应链",
      ranking: "CCL > 高速 PCB > 设备材料",
      stage: "新催化到二次确认之间",
      gap: "涨价函原文、订单和财报毛利率验证",
      conclusion: "先跟踪价格传导和量价扩散，不直接当作业绩兑现。",
      nextAction: "先补涨价函原文、订单和财报毛利率验证。",
    })

    expect(snapshot.tone).toBe("verify")
    expect(snapshot.headline).toContain("有标的线索")
    expect(snapshot.primaryAction).toContain("按排序")
    expect(snapshot.focus).toBe("CCL > 高速 PCB > 设备材料")
    expect(snapshot.risk).toContain("涨价函原文")
  })

  it("turns a complete Ask summary into an observation-ready decision card", () => {
    const snapshot = buildAskDecisionSnapshot({
      stocks: "胜宏科技、生益科技、沪电股份",
      directBeneficiary: "高频高速 CCL 与 AI 服务器 PCB 供应链",
      ranking: "胜宏科技 > 生益科技 > 沪电股份",
      stage: "二次确认",
      gap: "",
      conclusion: "先纳入观察清单，跟踪量价和公告确认。",
      nextAction: "建立观察清单。",
    })

    expect(snapshot.tone).toBe("actionable")
    expect(snapshot.headline).toBe("先看直接受益和利好排序")
    expect(snapshot.primaryAction).toBe("建立观察清单")
    expect(snapshot.focus).toContain("胜宏科技")
    expect(snapshot.evidenceState).toBe("二次确认")
  })

  it("grades Ask evidence strength from answer structure and source coverage", () => {
    const ready = buildAskEvidenceStrength({
      summary: {
        stocks: "胜宏科技、生益科技、沪电股份",
        directBeneficiary: "高速 PCB 与 CCL",
        ranking: "胜宏科技 > 生益科技 > 沪电股份",
        stage: "新催化到市场验证",
        gap: "缺少订单和 ASP",
        conclusion: "先看量价扩散。",
        nextAction: "按排序验证。",
      },
      hasAnswer: true,
      wikiSourceCount: 8,
      rawSourceCount: 3,
      stockDailySourceCount: 2,
    })

    expect(ready.tone).toBe("ready")
    expect(ready.headline).toContain("可进入观察清单")
    expect(ready.rankingState).toContain("已有股票和利好排序")
    expect(ready.sourceState).toContain("wiki 8")
    expect(ready.badges.map((badge) => badge.label)).toEqual(expect.arrayContaining([
      "wiki 8",
      "raw 3",
      "量价 2",
      "有股票排序",
    ]))

    const noStockDaily = buildAskEvidenceStrength({
      summary: {
        stocks: "胜宏科技、生益科技",
        directBeneficiary: "高速 PCB",
        ranking: "胜宏科技 > 生益科技",
        stage: "新催化",
        gap: "缺少量价验证",
        conclusion: "先观察。",
        nextAction: "补量价。",
      },
      hasAnswer: true,
      wikiSourceCount: 6,
      rawSourceCount: 2,
      stockDailySourceCount: 0,
    })
    expect(noStockDaily.tone).toBe("verify")
    expect(noStockDaily.nextAction).toContain("补量价")

    const sourceOnly = buildAskEvidenceStrength({
      summary: buildAskDeepDiveSummary("当前阶段：舆情催化"),
      hasAnswer: false,
      wikiSourceCount: 4,
      rawSourceCount: 1,
      stockDailySourceCount: 0,
    })
    expect(sourceOnly.tone).toBe("weak")
    expect(sourceOnly.headline).toContain("只有来源")
    expect(sourceOnly.nextAction).toContain("重试")
  })

  it("turns Ask output into a one-screen research ticket", () => {
    const readySummary = {
      stocks: "胜宏科技、生益科技、沪电股份",
      directBeneficiary: "高速 PCB 与 CCL",
      ranking: "胜宏科技 > 生益科技 > 沪电股份",
      stage: "新催化到市场验证",
      gap: "缺少订单和 ASP",
      conclusion: "先看量价扩散，不直接当业绩兑现。",
      nextAction: "按排序验证。",
    }
    const ready = buildAskResearchTicket({
      summary: readySummary,
      evidence: buildAskEvidenceStrength({
        summary: readySummary,
        hasAnswer: true,
        wikiSourceCount: 8,
        rawSourceCount: 3,
        stockDailySourceCount: 2,
      }),
      checklist: buildAskObservationChecklist(readySummary),
      sourceCount: 13,
    })

    expect(ready.tone).toBe("ready")
    expect(ready.headline).toContain("可进入今日观察")
    expect(ready.primaryActionLabel).toBe("加入今日观察")
    expect(ready.focus).toContain("胜宏科技")
    expect(ready.risk).toContain("缺少订单和 ASP")
    expect(ready.guardrail).toContain("不自动确认状态")
    expect(ready.badges.map((badge) => badge.label)).toEqual(expect.arrayContaining(["来源 13", "有观察清单"]))

    const verifySummary = {
      stocks: "胜宏科技、生益科技",
      directBeneficiary: "高速 PCB",
      ranking: "胜宏科技 > 生益科技",
      stage: "新催化",
      gap: "缺少量价验证",
      conclusion: "先观察。",
      nextAction: "补量价。",
    }
    const verify = buildAskResearchTicket({
      summary: verifySummary,
      evidence: buildAskEvidenceStrength({
        summary: verifySummary,
        hasAnswer: true,
        wikiSourceCount: 6,
        rawSourceCount: 2,
        stockDailySourceCount: 0,
      }),
      checklist: buildAskObservationChecklist(verifySummary),
      sourceCount: 8,
    })
    expect(verify.tone).toBe("verify")
    expect(verify.primaryActionLabel).toBe("补量价验证")
    expect(verify.nextAction).toContain("补量价")

    const weakSummary = buildAskDeepDiveSummary("当前阶段：舆情催化")
    const weak = buildAskResearchTicket({
      summary: weakSummary,
      evidence: buildAskEvidenceStrength({
        summary: weakSummary,
        hasAnswer: false,
        wikiSourceCount: 3,
        rawSourceCount: 0,
        stockDailySourceCount: 0,
      }),
      checklist: buildAskObservationChecklist(weakSummary),
      sourceCount: 3,
    })
    expect(weak.tone).toBe("weak")
    expect(weak.primaryActionLabel).toBe("重试/收窄 Ask")
    expect(weak.focus).toContain("未抽出关联股票")
  })

  it("makes Ask result panel status explicit for running, completed, and source-only results", () => {
    const pending = buildAskResultPanelCopy({ pending: true, title: "CPO/MPO" })
    expect(pending).toMatchObject({
      badge: "Ask 运行中",
      tone: "running",
    })
    expect(pending.steps.map((step) => step.label)).toEqual([
      "正在检索资料",
      "等待结构化摘要",
      "等待六段回答",
    ])
    expect(pending.steps.map((step) => step.status)).toEqual(["running", "pending", "pending"])
    expect(pending.steps.at(-1)?.detail).toContain("自动定位")

    const completed = buildAskResultPanelCopy({
      title: "CPO/MPO",
      sourceCount: 14,
      hasAnswer: true,
    })
    expect(completed.badge).toBe("Ask 已完成")
    expect(completed.detail).toContain("14 个来源")
    expect(completed.detail).toContain("结构化摘要")
    expect(completed.steps.map((step) => step.status)).toEqual(["done", "done", "done"])
    expect(completed.steps[0].detail).toContain("14 个来源")

    const sourceOnly = buildAskResultPanelCopy({
      title: "CPO/MPO",
      sourceCount: 6,
      hasAnswer: false,
    })
    expect(sourceOnly.badge).toBe("只返回来源")
    expect(sourceOnly.tone).toBe("warning")
    expect(sourceOnly.detail).toContain("没有生成六段回答")
    expect(sourceOnly.steps.map((step) => step.status)).toEqual(["done", "warning", "warning"])
    expect(sourceOnly.steps[1].label).toBe("摘要未生成")
  })

  it("does not present weak Ask answers as fully usable when structured summary is missing stocks", () => {
    const weakSummary = buildAskDeepDiveSummary("当前阶段：舆情催化。\n最大缺口：没有股票池和二次来源。")
    const panel = buildAskResultPanelCopy({
      title: "CPO/MPO",
      sourceCount: 8,
      hasAnswer: true,
      summary: weakSummary,
    })
    expect(panel.badge).toBe("摘要待补")
    expect(panel.tone).toBe("warning")
    expect(panel.title).toContain("没有抽出关联股票")
    expect(panel.steps.map((step) => step.status)).toEqual(["done", "warning", "done"])

    const jump = buildAskResultJumpCopy({
      title: "CPO/MPO",
      sourceCount: 8,
      hasAnswer: true,
      summary: weakSummary,
    })
    expect(jump.label).toContain("摘要待补")
    expect(jump.buttonLabel).toBe("查看并收窄")
    expect(jump.tone).toBe("warning")

    const locator = buildAskResultLocatorCopy({
      title: "CPO/MPO",
      sourceCount: 8,
      hasAnswer: true,
      summary: weakSummary,
    })
    expect(locator.label).toBe("回答在这里，但摘要待补")
    expect(locator.nextAction).toContain("收窄")
    expect(locator.tone).toBe("warning")
  })

  it("keeps a jump target visible when Ask fails", () => {
    const failed = buildAskResultJumpCopy({
      title: "CPO增速放缓可能推动MPO连接器量价齐升",
      errorMessage: "provider timeout",
    })

    expect(failed.label).toBe("Ask 深挖失败：CPO增速放缓可能推动MPO连接器量价齐升")
    expect(failed.detail).toContain("provider timeout")
    expect(failed.detail).toContain("不会自动确认状态")
    expect(failed.buttonLabel).toBe("查看失败原因")
    expect(failed.tone).toBe("warning")

    const precheck = buildAskResultJumpCopy({
      isPrecheck: true,
      title: "高速PCB上游涨价可能成为AI互联行情的扩散方向",
      errorMessage: "mock failure",
    })
    expect(precheck.label).toContain("Ask 预检失败")
  })

  it("tells PMs what to read first in Ask result states", () => {
    const pending = buildAskResultReadingGuide({
      pending: true,
      sourceCount: 0,
      hasAnswer: false,
    })
    expect(pending.tone).toBe("running")
    expect(pending.primaryTarget).toBeNull()
    expect(pending.primaryLabel).toBe("等待结果")
    expect(pending.steps.every((step) => step.tone === "pending")).toBe(true)
    expect(pending.guardrail).toContain("运行中不会写 wiki/raw")

    const completeSummary = {
      stocks: "胜宏科技、生益科技、沪电股份",
      directBeneficiary: "高速 PCB 与 CCL",
      ranking: "胜宏科技 > 生益科技 > 沪电股份",
      stage: "二次确认",
      gap: "缺少订单和 ASP",
      conclusion: "先看量价扩散，不直接当业绩兑现。",
      nextAction: "按排序验证。",
    }
    const ready = buildAskResultReadingGuide({
      summary: completeSummary,
      sourceCount: 13,
      hasAnswer: true,
    })
    expect(ready.headline).toContain("按摘要先读")
    expect(ready.primaryTarget).toBe("summary")
    expect(ready.primaryLabel).toBe("先看摘要")
    expect(ready.steps.map((step) => step.label)).toEqual(["先看摘要", "再读全文", "最后核来源"])
    expect(ready.guardrail).toContain("不会自动确认")

    const weak = buildAskResultReadingGuide({
      summary: buildAskDeepDiveSummary("当前阶段：舆情催化。\n最大缺口：没有股票池和二次来源。"),
      sourceCount: 8,
      hasAnswer: true,
    })
    expect(weak.headline).toContain("没有抽出关联股票")
    expect(weak.primaryTarget).toBe("answer")
    expect(weak.primaryLabel).toBe("先看完整回答")
    expect(weak.steps[0]).toMatchObject({ target: "answer", tone: "primary" })
    expect(weak.guardrail).toContain("不要按缺字段摘要")

    const sourceOnly = buildAskResultReadingGuide({
      sourceCount: 6,
      hasAnswer: false,
    })
    expect(sourceOnly.headline).toContain("只有来源")
    expect(sourceOnly.primaryTarget).toBe("sources")
    expect(sourceOnly.primaryLabel).toBe("先看来源")
    expect(sourceOnly.detail).toContain("不能按空摘要")
    expect(sourceOnly.steps.map((step) => step.target)).toEqual(["sources", "answer", "summary"])
  })

  it("treats placeholder Ask summary fields as missing instead of actionable", () => {
    const placeholderSummary = buildAskDeepDiveSummary([
      "关联股票：未抽出关联股票；先展开完整回答或缩小到单一细分。",
      "利好排序：先拿到关联股票，再做利好排序。",
      "一句话结论：结论未显式抽出；不要直接确认状态。",
    ].join("\n"))

    const panel = buildAskResultPanelCopy({
      title: "CPO/MPO",
      sourceCount: 9,
      hasAnswer: true,
      summary: placeholderSummary,
    })
    expect(panel.badge).toBe("摘要待补")
    expect(panel.title).toContain("没有抽出关联股票")

    const miniIndex = buildAskResultMiniIndex({
      summary: placeholderSummary,
      sourceCount: 9,
      hasAnswer: true,
    })
    expect(miniIndex.find((item) => item.id === "stocks")).toMatchObject({
      available: false,
      tone: "warning",
    })

    const checklist = buildAskObservationChecklist(placeholderSummary)
    expect(checklist.show).toBe(false)

    const evidence = buildAskEvidenceStrength({
      summary: placeholderSummary,
      hasAnswer: true,
      wikiSourceCount: 3,
      rawSourceCount: 4,
      stockDailySourceCount: 2,
    })
    expect(evidence.tone).toBe("weak")

    const followUp = buildAskFollowUpAction({
      summary: placeholderSummary,
      evidence,
      hasAnswer: true,
      title: "CPO/MPO",
    })
    expect(followUp.headline).toContain("收窄")
  })

  it("builds a source snapshot for source-only Ask results so the result area is not blank", () => {
    const snapshot = buildAskSourceSnapshot({
      wiki: [
        {
          title: "CPO当前状态",
          sourceRef: "wiki/CPO/当前状态.md",
          excerpt: "MPO、CPO、光纤跳线和连接器链条仍在验证中。",
        },
      ],
      raw: [
        {
          title: "健滔涨价函",
          sourceRef: "raw/研报新闻/2026-06-25-健滔涨价函.md",
          excerpt: "涨价函可能推动 CCL / 覆铜板量价重估。",
        },
      ],
      facts: [
        {
          title: "涨价事实",
          sourceRef: "facts:price-letter",
          excerpt: "涨价函仍需公告或客户验证。",
        },
      ],
      brain: [
        {
          title: "旧判断",
          sourceRef: "brain:previous-thesis",
          excerpt: "上一轮判断认为普通舆情不能直接升为硬证据。",
        },
      ],
      navigation: [
        {
          title: "MPO连接器",
          sourceRef: "wiki/概念/MPO连接器.md",
          snippet: "相关页可继续导航到高速连接器和CPO。",
        },
      ],
      stockDaily: [
        {
          title: "胜宏科技",
          sourceRef: "stockDaily:300476",
          excerpt: "20 日窗口出现放量。",
        },
      ],
      query: "CPO增速放缓是否推动MPO连接器量价齐升",
      hasAnswer: false,
    })

    expect(snapshot.show).toBe(true)
    expect(snapshot.headline).toContain("没有生成完整回答")
    expect(snapshot.detail).toContain("6 个来源")
    expect(snapshot.nextAction).toContain("重试 Ask 深挖")
    expect(snapshot.groups.map((group) => group.id)).toEqual(["wiki", "raw", "facts", "brain", "navigation", "stockDaily"])
    expect(snapshot.groups.map((group) => group.count)).toEqual([1, 1, 1, 1, 1, 1])
    expect(snapshot.groups[0].items[0].label).toBe("CPO当前状态")
    expect(snapshot.groups[1].items[0].sourceLine).toContain("研报新闻")
    expect(snapshot.groups[2].items[0].detail).toContain("公告或客户验证")
    expect(snapshot.groups[3].items[0].detail).toContain("普通舆情")
    expect(snapshot.groups[4].items[0].detail).toContain("相关页")
    expect(snapshot.groups[5].items[0].detail).toContain("放量")
    expect(snapshot.queryLine).toContain("CPO增速放缓")
  })

  it("keeps Ask source snapshots useful even when a full answer exists", () => {
    const snapshot = buildAskSourceSnapshot({
      wiki: [{ title: "MPO产业链框架", sourceRef: "wiki/概念/MPO.md", excerpt: "MPO、CPO、高速连接器的链条关系。" }],
      raw: [{ title: "盘前纪要", sourceRef: "raw/研报新闻/2026-06-25-MPO.md", excerpt: "卖方提示 CPO 放缓后 MPO 扩散。" }],
      query: "CPO增速放缓可能推动MPO连接器量价齐升",
      hasAnswer: true,
    })

    expect(snapshot.show).toBe(true)
    expect(snapshot.headline).toBe("本次 Ask 的来源快照")
    expect(snapshot.detail).toContain("2 个来源")
    expect(snapshot.nextAction).toContain("复核关联股票")
    expect(snapshot.groups.find((group) => group.id === "wiki")?.items[0].detail).toContain("链条关系")
    expect(snapshot.groups.find((group) => group.id === "raw")?.items[0].sourceLine).toContain("研报新闻")
  })

  it("counts every Ask source group for cache and progress feedback", () => {
    const run = {
      sources: {
        navigation: [{ title: "导航页" }],
        wiki: [{ title: "wiki页" }],
        raw: [{ title: "raw原文" }],
        facts: [{ title: "事实" }],
        brain: [{ title: "记忆" }],
        stockDaily: [{ title: "量价" }],
      },
    }

    expect(countAskResultSources(run)).toBe(6)

    const fallbackRun = {
      navigation: [{ title: "导航页" }],
      wikiResults: [{ title: "wiki页" }],
      rawResults: [{ title: "raw原文" }],
      factsResults: [{ title: "事实" }],
      brainResults: [{ title: "记忆" }],
      stockDailyResults: [{ title: "量价" }],
    }

    expect(countAskResultSources(fallbackRun)).toBe(6)
  })

  it("keeps audit paths out of Ask source snapshot main labels", () => {
    const snapshot = buildAskSourceSnapshot({
      raw: [
        {
          title: "微信催化卡",
          sourceRef: ".llm-wiki/wechat-inbox/processed/2026-06-19.jsonl#msg:raw:aaa:bbb",
          excerpt: "CPO 放缓，MPO 连接器被反复提到。",
        },
      ],
      facts: [
        {
          title: "状态确认事件",
          sourceRef: ".llm-wiki/hypothesis-events/20260619-test.jsonl",
          excerpt: "人工确认后写入假设事件。",
        },
      ],
      query: "CPO增速放缓可能推动MPO连接器量价齐升",
      hasAnswer: true,
    })

    const rawLine = snapshot.groups.find((group) => group.id === "raw")?.items[0].sourceLine ?? ""
    const factsLine = snapshot.groups.find((group) => group.id === "facts")?.items[0].sourceLine ?? ""
    expect(rawLine).toBe("微信已处理 2026-06-19 · raw")
    expect(factsLine).toBe("审计来源 · hypothesis-events")
    expect(`${rawLine} ${factsLine}`).not.toContain(".llm-wiki")
    expect(`${rawLine} ${factsLine}`).not.toContain("wechat-inbox")
    expect(`${rawLine} ${factsLine}`).not.toContain(".jsonl")
  })

  it("builds fixed pending slots so Ask clicks show immediate structure before results return", () => {
    const slots = buildAskPendingSkeletonTiles()
    expect(slots.map((slot) => slot.label)).toEqual([
      "关联股票",
      "最直接受益",
      "利好排序",
      "六段回答",
    ])
    expect(slots[0].placeholder).toContain("正在抽取股票池")
    expect(slots[1].detail).toContain("弱外溢叙事")
    expect(slots[2].detail).toContain("市场是否已反应")
    expect(slots[3].detail).toContain("交易含义")

    const precheckSlots = buildAskPendingSkeletonTiles({ isPrecheck: true })
    expect(precheckSlots.at(-1)?.label).toBe("预检回答")
    expect(precheckSlots.at(-1)?.placeholder).toBe("等待预检回答")
    expect(precheckSlots.at(-1)?.detail).toContain("加入跟踪")
  })

  it("builds a compact Ask result index with disabled missing sections", () => {
    const completeSummary = buildAskDeepDiveSummary([
      "关联股票：胜宏科技、生益科技、沪电股份",
      "最直接受益：CCL 和高速 PCB。",
      "利好排序：胜宏科技 > 生益科技 > 沪电股份。",
      "当前阶段：新催化。",
      "最大缺口：订单和量价反馈。",
      "一句话结论：先看直接受益排序。",
    ].join("\n"))
    const complete = buildAskResultMiniIndex({
      summary: completeSummary,
      sourceCount: 14,
      hasAnswer: true,
    })

    expect(complete.map((item) => item.label)).toEqual([
      "摘要",
      "关联股票",
      "利好排序",
      "六段全文",
      "来源",
    ])
    expect(complete.every((item) => item.available)).toBe(true)
    expect(complete.find((item) => item.id === "stocks")?.detail).toContain("胜宏科技")
    expect(complete.find((item) => item.id === "sources")?.detail).toBe("14 个来源")

    const sourceOnly = buildAskResultMiniIndex({
      summary: buildAskDeepDiveSummary("当前阶段：舆情催化"),
      sourceCount: 4,
      hasAnswer: false,
    })
    expect(sourceOnly.find((item) => item.id === "summary")?.available).toBe(false)
    expect(sourceOnly.find((item) => item.id === "stocks")?.available).toBe(false)
    expect(sourceOnly.find((item) => item.id === "answer")?.tone).toBe("warning")
    expect(sourceOnly.find((item) => item.id === "sources")?.available).toBe(true)

    const pending = buildAskResultMiniIndex({ pending: true, isPrecheck: true })
    expect(pending.find((item) => item.id === "answer")?.label).toBe("预检全文")
    expect(pending.every((item) => item.tone === "pending")).toBe(true)
  })

  it("labels the Ask answer panel as the place where the full answer is shown", () => {
    const answer = buildAskAnswerPanelCopy({
      hasAnswer: true,
      sourceCount: 12,
      isPrecheck: false,
    })

    expect(answer.badge).toBe("答案在这里")
    expect(answer.title).toBe("完整六段回答已展开")
    expect(answer.summaryLabel).toContain("完整六段回答")
    expect(answer.detail).toContain("下面就是 Ask 深挖返回的全文")
    expect(answer.openByDefault).toBe(true)
    expect(answer.emptyText).toContain("本次没有生成六段回答")
  })

  it("keeps source-only Ask results explicit instead of showing an empty answer panel", () => {
    const sourceOnly = buildAskAnswerPanelCopy({
      hasAnswer: false,
      sourceCount: 4,
      isPrecheck: true,
    })

    expect(sourceOnly.badge).toBe("只有来源")
    expect(sourceOnly.title).toBe("Ask 预检没有生成完整回答")
    expect(sourceOnly.detail).toContain("已返回 4 个来源")
    expect(sourceOnly.emptyText).toContain("已返回 4 个来源")
    expect(sourceOnly.emptyText).toContain("先看右侧来源")
    expect(sourceOnly.openByDefault).toBe(true)
    expect(sourceOnly.tone).toBe("warning")
  })

  it("builds Ask progress steps for the operator before and after the answer lands", () => {
    const running = buildAskRunProgressSteps({ pending: true })
    expect(running[0]).toMatchObject({
      id: "retrieval",
      label: "正在检索资料",
      status: "running",
    })
    expect(running[1].detail).toContain("关联股票")

    const completed = buildAskRunProgressSteps({ sourceCount: 12, hasAnswer: true })
    expect(completed.map((step) => step.status)).toEqual(["done", "done", "done"])
    expect(completed[2].label).toBe("六段回答已落地")

    const sourceOnly = buildAskRunProgressSteps({ sourceCount: 4, hasAnswer: false })
    expect(sourceOnly[0]).toMatchObject({ label: "资料检索完成", status: "done" })
    expect(sourceOnly[1]).toMatchObject({ label: "摘要未生成", status: "warning" })
    expect(sourceOnly[2].detail).toContain("不能直接按空摘要决策")
  })

  it("builds a live Ask task ticket so pending runs expose what is being checked", () => {
    const pending = buildAskLiveTaskTicket({ pending: true })
    expect(pending.headline).toContain("正在查")
    expect(pending.tone).toBe("running")
    expect(pending.steps.map((step) => step.id)).toEqual(["wiki", "raw", "stock", "agent"])
    expect(pending.steps.slice(0, 3).map((step) => step.status)).toEqual(["running", "running", "running"])
    expect(pending.steps[1].label).toBe("新增资料原文")
    expect(pending.steps[1].label).not.toContain("微信")
    expect(pending.steps[3]).toMatchObject({ status: "pending", label: "多智能体综合" })

    const done = buildAskLiveTaskTicket({
      hasAnswer: true,
      wikiSourceCount: 12,
      rawSourceCount: 2,
      stockDailySourceCount: 1,
    })
    expect(done.headline).toContain("检索链路完成")
    expect(done.tone).toBe("done")
    expect(done.steps.map((step) => step.status)).toEqual(["done", "done", "done", "done"])
    expect(done.steps[0].detail).toContain("12")
    expect(done.steps[1].label).toBe("新增资料原文")

    const sourceOnly = buildAskLiveTaskTicket({
      wikiSourceCount: 4,
      rawSourceCount: 0,
      stockDailySourceCount: 0,
      hasAnswer: false,
    })
    expect(sourceOnly.tone).toBe("warning")
    expect(sourceOnly.headline).toContain("来源已返回")
    expect(sourceOnly.steps[0].status).toBe("done")
    expect(sourceOnly.steps[1].status).toBe("warning")
    expect(sourceOnly.steps[1].label).toBe("新增资料原文")
    expect(sourceOnly.steps[3].detail).toContain("没有生成完整回答")
  })

  it("builds a persistent Ask result jump hint", () => {
    const running = buildAskResultJumpCopy({
      pending: true,
      title: "CPO/MPO",
    })
    expect(running.label).toContain("正在跑")
    expect(running.detail).toContain("第 3 区")
    expect(running.buttonLabel).toBe("查看运行状态")
    expect(running.tone).toBe("running")

    const done = buildAskResultJumpCopy({
      title: "CPO/MPO",
      sourceCount: 12,
      hasAnswer: true,
    })
    expect(done.label).toContain("已返回")
    expect(done.detail).toContain("关联股票")
    expect(done.buttonLabel).toBe("查看结果")

    const sourceOnly = buildAskResultJumpCopy({
      isPrecheck: true,
      title: "玻璃基板候选",
      sourceCount: 4,
      hasAnswer: false,
    })
    expect(sourceOnly.label).toContain("只返回来源")
    expect(sourceOnly.detail).toContain("4 个来源")
    expect(sourceOnly.buttonLabel).toBe("查看来源")
    expect(sourceOnly.tone).toBe("warning")
  })

  it("explains inside the Ask result area where the clicked answer appears", () => {
    const running = buildAskResultLocatorCopy({
      pending: true,
      title: "CPO增速放缓可能推动MPO连接器量价齐升",
    })
    expect(running.label).toBe("回答会显示在这里")
    expect(running.detail).toContain("第 3 区")
    expect(running.nextAction).toContain("进度条")
    expect(running.tone).toBe("running")

    const done = buildAskResultLocatorCopy({
      title: "CPO增速放缓可能推动MPO连接器量价齐升",
      sourceCount: 14,
      hasAnswer: true,
    })
    expect(done.label).toBe("你点的 Ask 回答就在这里")
    expect(done.detail).toContain("14 个来源")
    expect(done.nextAction).toContain("关联股票")
    expect(done.tone).toBe("done")

    const cached = buildAskResultLocatorCopy({
      reused: true,
      title: "CPO增速放缓可能推动MPO连接器量价齐升",
      sourceCount: 12,
      hasAnswer: true,
    })
    expect(cached.label).toBe("已打开上次 Ask 结果")
    expect(cached.nextAction).toContain("重新检索")
    expect(cached.tone).toBe("cached")

    const sourceOnly = buildAskResultLocatorCopy({
      isPrecheck: true,
      title: "玻璃基板候选",
      sourceCount: 4,
      hasAnswer: false,
    })
    expect(sourceOnly.label).toContain("不是你没找到")
    expect(sourceOnly.detail).toContain("没有生成完整回答")
    expect(sourceOnly.nextAction).toContain("收窄")
    expect(sourceOnly.tone).toBe("warning")
  })

  it("confirms when a jump lands in the Ask result area", () => {
    const hidden = buildAskResultLocatedNoticeCopy({ located: false })
    expect(hidden.show).toBe(false)

    const running = buildAskResultLocatedNoticeCopy({
      located: true,
      pending: true,
    })
    expect(running.show).toBe(true)
    expect(running.label).toBe("已跳到第 3 区")
    expect(running.detail).toContain("四个等待槽位")
    expect(running.tone).toBe("running")

    const done = buildAskResultLocatedNoticeCopy({
      located: true,
      sourceCount: 14,
      hasAnswer: true,
    })
    expect(done.label).toBe("已跳到 Ask 结果")
    expect(done.detail).toContain("关联股票")
    expect(done.tone).toBe("done")

    const cached = buildAskResultLocatedNoticeCopy({
      located: true,
      reused: true,
      hasAnswer: true,
    })
    expect(cached.label).toBe("已打开缓存结果")
    expect(cached.detail).toContain("重新检索")
    expect(cached.tone).toBe("cached")

    const sourceOnly = buildAskResultLocatedNoticeCopy({
      located: true,
      sourceCount: 4,
      hasAnswer: false,
    })
    expect(sourceOnly.label).toBe("已跳到来源结果")
    expect(sourceOnly.detail).toContain("4 个来源")
    expect(sourceOnly.tone).toBe("warning")
  })

  it("labels which signal card produced the full Ask result", () => {
    const tracked = buildAskResultOriginCopy({
      kind: "tracked",
      action: "ask",
      title: "CPO增速放缓可能推动MPO连接器量价齐升",
      hypothesisId: "hypo_ai_cpo_mpo",
      signalType: "新催化",
      sourceRef: ".llm-wiki/wechat-inbox/processed/2026-06-19.jsonl#msg:raw:aaa:bbb",
      sourceExcerpt: "微信舆情提到 CPO 放缓，MPO 跳线和高速连接器可能扩散。",
    })

    expect(tracked.show).toBe(true)
    expect(tracked.label).toBe("来自待处理卡")
    expect(tracked.title).toContain("CPO增速放缓")
    expect(tracked.signalLine).toContain("Ask 深挖")
    expect(tracked.signalLine).toContain("新催化")
    expect(tracked.sourceLine).toBe("来源卡：微信已处理 2026-06-19 · raw")
    expect(tracked.sourceLine).not.toContain("wechat-inbox")
    expect(tracked.sourceLine).not.toContain(".llm-wiki")
    expect(tracked.detail).toContain("微信舆情")
    expect(tracked.guardrail).toContain("不会自动确认状态")
    expect(tracked.tone).toBe("tracked")

    const candidate = buildAskResultOriginCopy({
      kind: "candidate",
      action: "precheck",
      title: "高速PCB上游涨价可能成为AI互联行情的扩散方向",
      signalType: "候选新假设",
      sourceExcerpt: "高频高速材料、PCB钻针、PPO/铜粉/钧材料被反复提到。",
    })

    expect(candidate.show).toBe(true)
    expect(candidate.label).toBe("来自候选卡")
    expect(candidate.signalLine).toContain("Ask 预检")
    expect(candidate.detail).toContain("候选还没入池")
    expect(candidate.tone).toBe("candidate")

    const manual = buildAskResultOriginCopy({
      kind: "manual",
      action: "ask",
      title: "玻璃基板产业链",
    })

    expect(manual.show).toBe(true)
    expect(manual.label).toBe("来自假设表")
    expect(manual.sourceLine).toBe("来源卡：未绑定新增资料信号")
    expect(manual.guardrail).toContain("只用于研究")
    expect(manual.tone).toBe("manual")
  })

  it("treats an Ask answer without stocks as an evidence-first result", () => {
    const snapshot = buildAskDecisionSnapshot({
      stocks: "",
      directBeneficiary: "",
      ranking: "",
      stage: "舆情催化",
      gap: "缺少订单、客户和公告来源",
      conclusion: "现在不能直接排序。",
      nextAction: "先补订单、客户和公告来源。",
    })

    expect(snapshot.tone).toBe("blocked")
    expect(snapshot.headline).toBe("先补证据，再谈排序")
    expect(snapshot.primaryAction).toBe("补来源")
    expect(snapshot.focus).toBe("舆情催化")
  })

  it("makes missing Ask structure actionable instead of showing vague placeholders", () => {
    const summary = buildAskDeepDiveSummary([
      "当前阶段：舆情催化，还不是订单兑现。",
      "最大缺口：缺少关联股票、受益排序和二次来源。",
      "一句话结论：先把链条缩小后再问。",
    ].join("\n"))

    const feedback = buildAskStructureFeedback({
      summary,
      sourceCount: 12,
      hasAnswer: true,
    })
    const tiles = buildAskSummaryTileValues(summary)

    expect(feedback.show).toBe(true)
    expect(feedback.headline).toContain("结构化摘要不完整")
    expect(feedback.detail).toContain("12 个来源")
    expect(feedback.next).toContain("缩小到单一细分或股票")
    expect(tiles.stocks).toContain("未抽出关联股票")
    expect(tiles.ranking).toContain("先拿到关联股票")
  })

  it("builds a PM observation checklist draft from structured Ask results", () => {
    const summary = buildAskDeepDiveSummary([
      "关联股票：胜宏科技、生益科技、沪电股份",
      "最直接受益：高频高速 PCB 与 CCL 链条。",
      "利好排序：胜宏科技 > 生益科技 > 沪电股份。",
      "当前阶段：新催化到市场验证之间。",
      "最大缺口：缺少订单、ASP 和客户交付验证。",
      "一句话结论：先看量价扩散和公告/订单二次确认。",
    ].join("\n"))

    const checklist = buildAskObservationChecklist(summary)

    expect(checklist.show).toBe(true)
    expect(checklist.headline).toContain("胜宏科技")
    expect(checklist.items.map((item) => item.label)).toEqual([
      "观察标的",
      "排序依据",
      "验证动作",
      "最大缺口",
      "状态口径",
    ])
    expect(checklist.items[2].value).toContain("1-5 个交易日")
    expect(checklist.copyText).toContain("## 观察清单草稿")
    expect(checklist.copyText).toContain("胜宏科技、生益科技、沪电股份")
  })

  it("makes the Ask observation primary action explicit across queue and save states", () => {
    const summary = buildAskDeepDiveSummary([
      "关联股票：胜宏科技、生益科技、沪电股份",
      "利好排序：胜宏科技 > 生益科技 > 沪电股份。",
      "最大缺口：缺少订单、ASP 和客户交付验证。",
    ].join("\n"))
    const checklist = buildAskObservationChecklist(summary)

    const ready = buildAskObservationActionCopy({ checklist })
    expect(ready).toMatchObject({
      show: true,
      tone: "ready",
      primaryAction: "queue",
      primaryLabel: "加入观察队列",
      canPrimary: true,
      canCopy: true,
    })
    expect(ready.detail).toContain("页面内临时排队")

    const queued = buildAskObservationActionCopy({ checklist, queued: true })
    expect(queued).toMatchObject({
      tone: "queued",
      primaryAction: "save",
      primaryLabel: "保存观察草稿",
      canPrimary: true,
    })
    expect(queued.detail).toContain(".llm-wiki/observation-drafts")

    const saving = buildAskObservationActionCopy({ checklist, queued: true, saving: true })
    expect(saving).toMatchObject({
      tone: "queued",
      primaryAction: "save",
      primaryLabel: "保存中",
      canPrimary: false,
    })

    const saved = buildAskObservationActionCopy({
      checklist,
      queued: true,
      savedPath: ".llm-wiki/observation-drafts/2026-06-20/obs_demo.md",
    })
    expect(saved).toMatchObject({
      tone: "saved",
      primaryAction: "none",
      primaryLabel: "已保存草稿",
      canPrimary: false,
    })
    expect(saved.detail).toContain("obs_demo.md")
  })

  it("summarizes the next Ask result action for a PM before the detailed modules", () => {
    const summary = buildAskDeepDiveSummary([
      "关联股票：胜宏科技、生益科技、沪电股份",
      "利好排序：胜宏科技 > 生益科技 > 沪电股份。",
      "最大缺口：缺少订单、ASP 和客户交付验证。",
    ].join("\n"))
    const checklist = buildAskObservationChecklist(summary)
    const readyObservation = buildAskObservationActionCopy({ checklist })
    const queuedObservation = buildAskObservationActionCopy({ checklist, queued: true })
    const savedObservation = buildAskObservationActionCopy({
      checklist,
      queued: true,
      savedPath: ".llm-wiki/observation-drafts/2026-06-20/obs_demo.md",
    })
    const evidence = buildAskEvidenceStrength({
      summary,
      hasAnswer: true,
      wikiSourceCount: 4,
      rawSourceCount: 2,
      stockDailySourceCount: 0,
    })
    const followUp = buildAskFollowUpAction({
      summary,
      evidence,
      title: "AI服务器PCB链",
      hasAnswer: true,
    })

    const readyGuide = buildAskResultActionGuide({
      observation: readyObservation,
      followUp,
      structure: buildAskStructureFeedback({ summary, sourceCount: 6, hasAnswer: true }),
    })
    expect(readyGuide.headline).toBe("下一步：加入观察队列")
    expect(readyGuide.primaryTarget).toBe("observation")
    expect(readyGuide.primaryLabel).toBe("加入观察队列")
    expect(readyGuide.detail).toContain("不自动确认假设状态")

    const queuedGuide = buildAskResultActionGuide({
      observation: queuedObservation,
      followUp,
      structure: buildAskStructureFeedback({ summary, sourceCount: 6, hasAnswer: true }),
    })
    expect(queuedGuide.headline).toBe("下一步：保存观察草稿")
    expect(queuedGuide.primaryTarget).toBe("observation")

    const savedGuide = buildAskResultActionGuide({
      observation: savedObservation,
      followUp,
      structure: buildAskStructureFeedback({ summary, sourceCount: 6, hasAnswer: true }),
    })
    expect(savedGuide.headline).toBe("观察草稿已沉淀")
    expect(savedGuide.primaryLabel).toBe("查看草稿入口")
    expect(savedGuide.tone).toBe("saved")
  })

  it("uses follow-up actions in the Ask result guide when no observation checklist exists", () => {
    const summary = buildAskDeepDiveSummary("当前阶段：舆情催化。\n最大缺口：没有股票池和二次来源。")
    const checklist = buildAskObservationChecklist(summary)
    const observation = buildAskObservationActionCopy({ checklist })
    const evidence = buildAskEvidenceStrength({
      summary,
      hasAnswer: true,
      wikiSourceCount: 3,
      rawSourceCount: 1,
      stockDailySourceCount: 0,
    })
    const followUp = buildAskFollowUpAction({
      summary,
      evidence,
      title: "CPO节奏放缓是否利好MPO连接器",
      hasAnswer: true,
    })

    const guide = buildAskResultActionGuide({
      observation,
      followUp,
      structure: buildAskStructureFeedback({ summary, sourceCount: 4, hasAnswer: true }),
    })

    expect(guide.headline).toContain("先收窄问题")
    expect(guide.primaryTarget).toBe("followup")
    expect(guide.primaryLabel).toBe("复制收窄问题")
    expect(guide.detail).toContain("暂时不能加入观察")
  })

  it("sends source-only Ask result guides to sources instead of an empty answer", () => {
    const summary = buildAskDeepDiveSummary("")
    const checklist = buildAskObservationChecklist(summary)
    const observation = buildAskObservationActionCopy({ checklist })
    const structure = buildAskStructureFeedback({ summary, sourceCount: 5, hasAnswer: false })

    const guide = buildAskResultActionGuide({
      observation,
      structure,
    })

    expect(structure.headline).toContain("只有检索来源")
    expect(guide.headline).toContain("只有检索来源")
    expect(guide.primaryTarget).toBe("sources")
    expect(guide.primaryLabel).toBe("看来源")
    expect(guide.secondary).toContain("重试 Ask")
  })

  it("does not show an observation checklist when Ask has not identified stocks", () => {
    const checklist = buildAskObservationChecklist(buildAskDeepDiveSummary("当前阶段：舆情催化。"))

    expect(checklist.show).toBe(false)
    expect(checklist.nextAction).toContain("缩小到单一细分")

    const action = buildAskObservationActionCopy({ checklist })
    expect(action).toMatchObject({
      show: true,
      tone: "blocked",
      primaryAction: "none",
      canPrimary: false,
      canCopy: false,
    })
    expect(action.detail).toContain("没有抽出关联股票")
  })

  it("turns an Ask checklist into a deduped PM observation queue item", () => {
    const summary = buildAskDeepDiveSummary([
      "关联股票：胜宏科技、生益科技、沪电股份",
      "利好排序：胜宏科技 > 生益科技 > 沪电股份。",
      "当前阶段：新催化到市场验证之间。",
      "最大缺口：缺少订单、ASP 和客户交付验证。",
      "一句话结论：先看量价扩散和公告/订单二次确认。",
    ].join("\n"))
    const checklist = buildAskObservationChecklist(summary)
    const wikiFrameHint = buildAskWikiFrameHint([
      {
        title: "AI数据中心互联",
        path: "wiki/概念/AI数据中心互联.md",
        frontmatterTags: ["CPO", "MPO"],
      },
    ])

    const first = buildObservationQueueDraft({
      checklist,
      hypothesisId: "hypo_pcb_ccl",
      hypothesisTitle: "AI PCB 链条可能扩散",
      wikiFrameHint,
      askQuery: "围绕 AI PCB 链条做 Ask 深挖",
      createdAt: "2026-06-20T09:00:00.000Z",
    })
    const second = buildObservationQueueDraft({
      checklist,
      hypothesisId: "hypo_pcb_ccl",
      hypothesisTitle: "AI PCB 链条可能扩散",
      wikiFrameHint,
      askQuery: "围绕 AI PCB 链条做 Ask 深挖",
      createdAt: "2026-06-20T09:30:00.000Z",
    })

    expect(first).toMatchObject({
      key: "hypo_pcb_ccl",
      hypothesisId: "hypo_pcb_ccl",
      title: "AI PCB 链条可能扩散",
      stocks: "胜宏科技、生益科技、沪电股份",
      status: "待跟踪",
      wikiFrameLabel: "AI数据中心互联",
      wikiFrameSourceRef: "wiki/概念/AI数据中心互联.md",
      sourceRefs: ["wiki/概念/AI数据中心互联.md"],
      askQuery: "围绕 AI PCB 链条做 Ask 深挖",
    })

    const queue = upsertObservationQueue([first], second)

    expect(queue).toHaveLength(1)
    expect(queue[0].createdAt).toBe("2026-06-20T09:30:00.000Z")
    expect(queue[0].nextAction).toContain("先补")
  })

  it("builds a homepage review brief from saved observation drafts", () => {
    const brief = buildObservationReviewBrief([
      {
        id: "obs_cpo_mpo",
        title: "CPO放缓推动MPO观察",
        stocks: ["太辰光", "天孚通信"],
        ranking: "太辰光 > 天孚通信",
        gap: "订单和ASP未验证",
        nextAction: "观察1-5个交易日量价扩散，等待公告二次确认",
        markdownRelativePath: ".llm-wiki/observation-drafts/2026-06-20/obs_cpo_mpo.md",
        jsonRelativePath: ".llm-wiki/observation-drafts/2026-06-20/obs_cpo_mpo.json",
        createdAt: "2026-06-20 09:30:00",
      },
      {
        id: "obs_pcb",
        title: "PCB涨价函观察",
        stocks: "生益科技",
        nextAction: "等待新增舆情",
        jsonRelativePath: ".llm-wiki/observation-drafts/2026-06-20/obs_pcb.json",
      },
    ])

    expect(brief).toMatchObject({
      show: true,
      count: 2,
      totalCount: 2,
      label: "观察 2",
      headline: "有 2 条观察待复核",
      primaryTitle: "CPO放缓推动MPO观察",
      primaryStocks: "太辰光、天孚通信",
      primaryPath: ".llm-wiki/observation-drafts/2026-06-20/obs_cpo_mpo.md",
      reviewWindow: "1-5个交易日",
      tone: "review",
    })
    expect(brief.detail).toContain("太辰光、天孚通信")
    expect(brief.items[1]).toMatchObject({
      title: "PCB涨价函观察",
      openPath: ".llm-wiki/observation-drafts/2026-06-20/obs_pcb.json",
    })
  })

  it("hides the observation review brief when no saved drafts exist", () => {
    const brief = buildObservationReviewBrief([])

    expect(brief.show).toBe(false)
    expect(brief.count).toBe(0)
    expect(brief.items).toEqual([])
  })

  it("turns observation queue drafts into PM-facing tracking rows", () => {
    const summary = buildAskDeepDiveSummary([
      "关联股票：胜宏科技、生益科技、沪电股份",
      "利好排序：胜宏科技 > 生益科技 > 沪电股份。",
      "当前阶段：新催化到市场验证之间。",
      "最大缺口：缺少订单、ASP 和客户交付验证。",
      "一句话结论：先看量价扩散和公告/订单二次确认。",
    ].join("\n"))
    const checklist = buildAskObservationChecklist(summary)
    const wikiFrameHint = buildAskWikiFrameHint([
      {
        title: "AI数据中心互联",
        path: "wiki/概念/AI数据中心互联.md",
        frontmatterTags: ["CPO", "MPO"],
      },
    ])
    const draft = buildObservationQueueDraft({
      checklist,
      hypothesisId: "hypo_pcb_ccl",
      hypothesisTitle: "AI PCB 链条可能扩散",
      wikiFrameHint,
      sourceRefs: [".llm-wiki/wechat-inbox/processed/2026-06-20.jsonl#msg:raw:aaa:bbb"],
      askQuery: "围绕 AI PCB 链条做 Ask 深挖",
      createdAt: "2026-06-20T09:30:00.000Z",
    })

    const rows = buildObservationQueueTableRows({
      items: [draft],
      savingKey: "",
      savedRuns: {
        hypo_pcb_ccl: {
          writeResult: {
            markdownRelativePath: ".llm-wiki/observation-drafts/2026-06-20/obs_hypo_pcb_ccl.md",
          },
        },
      },
    })

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      key: "hypo_pcb_ccl",
      title: "AI PCB 链条可能扩散",
      stockLine: "胜宏科技、生益科技、沪电股份",
      focusStock: "胜宏科技",
      statusLabel: "已保存",
      tone: "saved",
      reviewWindow: "1-5 个交易日",
      savedPath: ".llm-wiki/observation-drafts/2026-06-20/obs_hypo_pcb_ccl.md",
    })
    expect(rows[0].sourceLine).toContain("AI数据中心互联")
    expect(rows[0].validationAction).toContain("量价扩散")
    expect(rows[0].riskLine).toContain("缺少订单")

    const savingRows = buildObservationQueueTableRows({ items: [draft], savingKey: "hypo_pcb_ccl" })
    expect(savingRows[0]).toMatchObject({
      statusLabel: "保存中",
      tone: "saving",
      canSave: false,
    })
  })

  it("turns Ask wiki source headers into a PM-facing frame hint", () => {
    const hint = buildAskWikiFrameHint([
      {
        title: "AI数据中心互联",
        path: "wiki/概念/AI数据中心互联.md",
        type: "概念",
        frontmatterTags: ["CPO", "MPO", "高速连接器"],
        frontmatterRelated: ["Scale-Up", "光纤跳线"],
        frontmatterSources: ["raw/微信聊天/2026-06-19.md"],
        frontmatterUpdated: "2026-06-19 09:00:00",
        staleDays: 1,
      },
    ])

    expect(hint.show).toBe(true)
    expect(hint.headline).toContain("AI数据中心互联")
    expect(hint.detail).toContain("CPO")
    expect(hint.detail).toContain("Scale-Up")
    expect(hint.next).toContain("先打开这张 wiki")
    expect(hint.tone).toBe("structured")
  })

  it("warns when Ask only hits stale wiki source headers", () => {
    const hint = buildAskWikiFrameHint([
      {
        title: "旧CPO框架",
        path: "wiki/概念/旧CPO框架.md",
        type: "概念",
        frontmatterTags: ["CPO"],
        frontmatterUpdated: "2025-01-01 09:00:00",
        staleDays: 530,
      },
    ])

    expect(hint.show).toBe(true)
    expect(hint.headline).toContain("旧CPO框架")
    expect(hint.detail).toContain("530 天")
    expect(hint.next).toContain("先核对是否过期")
    expect(hint.tone).toBe("stale")
  })

  it("extracts content below markdown headings instead of returning the heading", () => {
    const answer = [
      "## 结论",
      "CPO 放缓若被二次来源确认，MPO 高速连接器更像新催化跟踪，不是财报兑现。",
      "## 证据链",
      "关联股票：立讯精密、沃尔核材、鼎通科技。",
      "## 交易含义",
      "当前阶段：舆情催化，需要看量价扩散。",
      "## 后续验证",
      "最大缺口：订单、客户份额、ASP 和交付节奏。",
    ].join("\n")

    expect(extractAskAnswerField(answer, ["结论"]))
      .toBe("CPO 放缓若被二次来源确认，MPO 高速连接器更像新催化跟踪，不是财报兑现。")

    const summary = buildAskDeepDiveSummary(answer)
    expect(summary.conclusion).toBe("CPO 放缓若被二次来源确认，MPO 高速连接器更像新催化跟踪，不是财报兑现。")
    expect(summary.stocks).toBe("立讯精密、沃尔核材、鼎通科技。")
    expect(summary.stage).toBe("舆情催化，需要看量价扩散。")
    expect(summary.gap).toBe("订单、客户份额、ASP 和交付节奏。")
  })

  it("extracts Ask summaries from PM-style aliases and markdown tables", () => {
    const answer = [
      "| 字段 | 内容 |",
      "| --- | --- |",
      "| 股票池 | 胜宏科技、生益科技、沪电股份 |",
      "| 弹性排序 | 胜宏科技 > 生益科技 > 沪电股份 |",
      "| 验证缺口 | 缺订单、ASP、客户份额和量价扩散 |",
      "受益标的：高频高速 CCL 和 AI 服务器 PCB 链条。",
      "所处阶段：新催化到二次确认。",
      "买方结论：先进入观察清单，不直接确认状态。",
    ].join("\n")

    const summary = buildAskDeepDiveSummary(answer)

    expect(summary.stocks).toBe("胜宏科技、生益科技、沪电股份")
    expect(summary.directBeneficiary).toBe("高频高速 CCL 和 AI 服务器 PCB 链条。")
    expect(summary.ranking).toBe("胜宏科技 > 生益科技 > 沪电股份")
    expect(summary.stage).toBe("新催化到二次确认。")
    expect(summary.gap).toBe("缺订单、ASP、客户份额和量价扩散")
    expect(summary.conclusion).toBe("先进入观察清单，不直接确认状态。")
  })

  it("builds Ask summaries from unlabeled six-section prose so the result panel is not empty", () => {
    const answer = [
      "## 结论",
      "CPO 放缓如果被二次来源确认，MPO 高速连接器更适合先按新催化跟踪。",
      "## 证据链",
      "资料反复指向立讯精密、沃尔核材、鼎通科技这类 MPO / 高速连接器相关公司。",
      "## 交易含义",
      "直接受益更偏 MPO 连接器、跳线和高速连接器供应链，光模块龙头只是情绪锚。",
      "受益强度大致是 鼎通科技 > 沃尔核材 > 立讯精密。",
      "当前处于新催化到二次确认阶段。",
      "## 后续验证",
      "主要缺订单、CNINFO公告、客户份额和量价扩散。",
    ].join("\n")

    const summary = buildAskDeepDiveSummary(answer)

    expect(summary.stocks).toBe("立讯精密、沃尔核材、鼎通科技")
    expect(summary.directBeneficiary).toContain("MPO 连接器")
    expect(summary.ranking).toBe("鼎通科技 > 沃尔核材 > 立讯精密。")
    expect(summary.stage).toContain("新催化到二次确认")
    expect(summary.gap).toBe("订单、CNINFO公告、客户份额和量价扩散。")
    expect(summary.conclusion).toContain("先按新催化跟踪")
  })

  it("builds a narrowed follow-up prompt when Ask cannot extract stocks", () => {
    const summary = buildAskDeepDiveSummary("当前阶段：舆情催化。\n最大缺口：没有股票池和二次来源。")
    const evidence = buildAskEvidenceStrength({
      summary,
      hasAnswer: true,
      wikiSourceCount: 3,
      rawSourceCount: 1,
      stockDailySourceCount: 0,
    })
    const action = buildAskFollowUpAction({
      summary,
      evidence,
      title: "CPO增速放缓可能推动MPO连接器量价齐升",
      hasAnswer: true,
      canRetry: true,
    })

    expect(action.show).toBe(true)
    expect(action.tone).toBe("weak")
    expect(action.headline).toContain("收窄")
    expect(action.primaryLabel).toBe("复制收窄问题")
    expect(action.retryLabel).toBe("重试 Ask")
    expect(action.retryEnabled).toBe(true)
    expect(action.prompt).toContain("CPO增速放缓可能推动MPO连接器量价齐升")
    expect(action.prompt).toContain("关联股票/股票池")
    expect(action.prompt).toContain("不要泛泛讲行业")
  })

  it("builds a validation follow-up prompt when Ask has stocks but still needs market evidence", () => {
    const summary = buildAskDeepDiveSummary([
      "关联股票：立讯精密、沃尔核材、鼎通科技。",
      "利好排序：鼎通科技 > 沃尔核材 > 立讯精密。",
      "最大缺口：缺少量价扩散和订单确认。",
    ].join("\n"))
    const evidence = buildAskEvidenceStrength({
      summary,
      hasAnswer: true,
      wikiSourceCount: 4,
      rawSourceCount: 2,
      stockDailySourceCount: 0,
    })
    const action = buildAskFollowUpAction({
      summary,
      evidence,
      title: "CPO节奏放缓是否利好MPO连接器",
      isPrecheck: true,
      hasAnswer: true,
      canRetry: false,
    })

    expect(action.show).toBe(true)
    expect(action.tone).toBe("verify")
    expect(action.headline).toContain("量价")
    expect(action.primaryLabel).toBe("复制量价追问")
    expect(action.retryLabel).toBe("重试预检")
    expect(action.retryEnabled).toBe(false)
    expect(action.prompt).toContain("候选股票：立讯精密、沃尔核材、鼎通科技")
    expect(action.prompt).toContain("最近 20 个交易日量价反馈")
    expect(action.prompt).toContain("是否支持假设状态升级")
  })

  it("summarizes scan progress while a stage is running", () => {
    const progress = buildScanProgressSummary({
      running: true,
      sourceCount: 2,
      newMessageCount: 12,
      stages: [
        { id: "ingest", label: "信息摄入", status: "done", detail: "新增 12 条" },
        { id: "hypothesis", label: "假设生成/更新", status: "running", detail: "扫描 30m 内微信增量" },
        { id: "validation", label: "验证", status: "pending" },
        { id: "review", label: "人工审核", status: "pending" },
      ],
    })

    expect(progress.tone).toBe("running")
    expect(progress.currentStep).toBe(2)
    expect(progress.totalSteps).toBe(4)
    expect(progress.label).toBe("假设生成/更新")
    expect(progress.detail).toContain("新增 12")
    expect(progress.percent).toBeGreaterThan(25)
    expect(progress.percent).toBeLessThan(60)
  })

  it("tells the operator when rule scan cards are actionable before LLM review finishes", () => {
    const progress = buildScanProgressSummary({
      running: true,
      sourceCount: 5,
      matchedCount: 2,
      pendingCount: 3,
      stages: [
        { id: "ingest", label: "信息摄入", status: "done", detail: "新增 18 条" },
        { id: "hypothesis", label: "假设生成/更新", status: "running", detail: "规则结果已先显示，正在 LLM 复核候选卡片" },
        { id: "validation", label: "验证", status: "pending" },
        { id: "review", label: "人工审核", status: "pending" },
      ],
    })

    expect(progress.phaseLabel).toContain("2/4")
    expect(progress.phaseLabel).toContain("规则快扫")
    expect(progress.phaseLabel).toContain("LLM复核")
    expect(progress.phaseHint).toContain("已生成 3 张待处理卡")
    expect(progress.phaseHint).toContain("可以先看")
    expect(progress.canActBeforeDone).toBe(true)
  })

  it("warns not to act on stale cards while source import is still ingesting", () => {
    const progress = buildScanProgressSummary({
      running: true,
      stages: [
        { id: "ingest", label: "信息摄入", status: "running", detail: "导入 raw/微信聊天" },
        { id: "hypothesis", label: "假设生成/更新", status: "pending" },
        { id: "validation", label: "验证", status: "pending" },
        { id: "review", label: "人工审核", status: "pending" },
      ],
    })

    expect(progress.phaseLabel).toBe("1/4 导入资料")
    expect(progress.phaseHint).toContain("读取和去重")
    expect(progress.canActBeforeDone).toBe(false)
  })

  it("shows completion when all scan stages are done", () => {
    const progress = buildScanProgressSummary({
      running: false,
      matchedCount: 3,
      pendingCount: 2,
      stages: [
        { id: "ingest", label: "信息摄入", status: "done" },
        { id: "hypothesis", label: "假设生成/更新", status: "done" },
        { id: "validation", label: "验证", status: "done" },
        { id: "review", label: "人工审核", status: "done", detail: "alerts 待确认" },
      ],
    })

    expect(progress.tone).toBe("done")
    expect(progress.percent).toBe(100)
    expect(progress.detail).toContain("命中 3")
    expect(progress.detail).toContain("待处理 2")
    expect(progress.phaseLabel).toBe("4/4 待处理")
    expect(progress.phaseHint).toContain("先处理今日先手")
    expect(progress.canActBeforeDone).toBe(true)
  })

  it("turns scan counts into a trading-desk brief", () => {
    const confirm = buildTradingDeskScanBrief({
      confirmableCount: 2,
      askRecommendedCount: 1,
      pendingCount: 4,
      matchedCount: 4,
      newMessageCount: 18,
      selectedTitle: "CPO增速放缓可能推动MPO连接器量价齐升",
    })
    expect(confirm.label).toBe("先确认")
    expect(confirm.headline).toContain("2 条状态变化")
    expect(confirm.detail).toContain("CPO增速放缓")
    expect(confirm.jumpLabel).toBe("去确认")
    expect(confirm.tone).toBe("action")

    const ask = buildTradingDeskScanBrief({
      askRecommendedCount: 3,
      pendingCount: 3,
      matchedCount: 3,
      newMessageCount: 11,
    })
    expect(ask.label).toBe("先 Ask")
    expect(ask.headline).toContain("3 条值得深挖")
    expect(ask.detail).toContain("关联股票")
    expect(ask.jumpLabel).toBe("去 Ask")
    expect(ask.tone).toBe("review")

    const running = buildTradingDeskScanBrief({
      running: true,
      runningStageLabel: "假设生成/更新",
      runningStageDetail: "扫描 30m 内微信增量",
      newMessageCount: 9,
    })
    expect(running.label).toBe("扫描中")
    expect(running.headline).toContain("假设生成/更新")
    expect(running.detail).toContain("新增 9")
    expect(running.jumpLabel).toBe("")
    expect(running.tone).toBe("running")

    const quiet = buildTradingDeskScanBrief({
      newMessageCount: 6,
      matchedCount: 0,
      pendingCount: 0,
    })
    expect(quiet.label).toBe("无关键变化")
    expect(quiet.headline).toContain("新增 6")
    expect(quiet.detail).toContain("继续自动跟踪")
    expect(quiet.jumpLabel).toBe("")
    expect(quiet.tone).toBe("quiet")
  })

  it("lets the top trading-desk brief use the PM opening target after scanning finishes", () => {
    const pmOpeningBrief = buildPmOpeningBrief({
      digest: buildSignalRunDigest({
        totalCount: 3,
        rawSignalCount: 8,
        confirmableCount: 0,
        askRecommendedCount: 2,
        catalystCount: 2,
        hardEvidenceCount: 0,
        counterCount: 0,
        marketFeedbackCount: 0,
        candidateCount: 0,
        quietCount: 1,
      }),
      queueSummary: buildPmDecisionQueueSummary({
        totalCount: 3,
        priorityCount: 2,
        confirmableCount: 0,
        askRecommendedCount: 2,
        candidateCount: 0,
        quietCount: 1,
        topTitle: "CPO增速放缓可能推动MPO连接器量价齐升",
        topSignalType: "新催化",
      }),
    })

    const brief = buildTradingDeskScanBrief({
      pmOpeningBrief,
      askRecommendedCount: 2,
      pendingCount: 3,
      matchedCount: 3,
      newMessageCount: 18,
    })
    expect(brief.label).toBe("PM一句话")
    expect(brief.headline).toContain("今天先 Ask")
    expect(brief.headline).toContain("CPO增速放缓")
    expect(brief.detail).toContain("不自动改状态")
    expect(brief.jumpLabel).toBe("去 Ask 深挖")
    expect(brief.tone).toBe("review")

    const running = buildTradingDeskScanBrief({
      running: true,
      runningStageLabel: "假设生成/更新",
      runningStageDetail: "扫描 30m 内微信增量",
      pmOpeningBrief,
      newMessageCount: 9,
    })
    expect(running.label).toBe("扫描中")
    expect(running.headline).toContain("假设生成/更新")
    expect(running.headline).not.toContain("CPO增速放缓")
  })

  it("surfaces errors without claiming completion", () => {
    const progress = buildScanProgressSummary({
      running: false,
      stages: [
        { id: "ingest", label: "信息摄入", status: "done" },
        { id: "hypothesis", label: "假设生成/更新", status: "error", detail: "watch failed" },
        { id: "validation", label: "验证", status: "pending" },
        { id: "review", label: "人工审核", status: "pending" },
      ],
    })

    expect(progress.tone).toBe("error")
    expect(progress.label).toBe("假设生成/更新")
    expect(progress.detail).toContain("watch failed")
    expect(progress.percent).toBeLessThan(100)
  })

  it("explains whether the next scan is scoped to one hypothesis or all hypotheses", () => {
    expect(buildScanScopeSummary({ selectedId: "", selectedTitle: "" })).toEqual({
      label: "扫描全部假设",
      detail: "适合每天开盘前或收盘后扫全部新增资料；噪声会更多。",
      tone: "all",
    })

    const scoped = buildScanScopeSummary({
      selectedId: "hypo_ai_cpo_mpo_4749",
      selectedTitle: "CPO增速放缓可能推动MPO连接器量价齐升，后续观察订单和二次来源",
    })

    expect(scoped.label).toBe("只扫当前假设")
    expect(scoped.detail).toContain("CPO增速放缓可能推动MPO连接器")
    expect(scoped.detail.length).toBeLessThan(80)
    expect(scoped.tone).toBe("scoped")
  })

  it("keeps scan confirmation scoped to source, window, and hypothesis", () => {
    expect(buildScanKey({ rawChatSource: "raw/微信聊天", since: "30m", hypothesisId: "" }))
      .toBe("raw/微信聊天|30m|*")
    expect(buildScanKey({ rawChatSource: "raw/微信聊天/2026-06-19.md", since: "30m", hypothesisId: "hypo_a" }))
      .toBe("raw/微信聊天/2026-06-19.md|30m|hypo_a")
    expect(buildScanKey({ rawChatSource: "raw/微信聊天/2026-06-19.md", since: "1d", hypothesisId: "hypo_a" }))
      .not.toBe(buildScanKey({ rawChatSource: "raw/微信聊天/2026-06-19.md", since: "30m", hypothesisId: "hypo_a" }))
  })

  it("makes the next scan mode explicit for manual and auto runs", () => {
    const manual = buildScanModeSummary({ autoRefresh: false })
    expect(manual.label).toBe("手动扫描+AI复核")
    expect(manual.buttonLabel).toBe("扫描+AI复核")
    expect(manual.detail).toContain("少量候选交给 LLM")

    const scopedManual = buildScanModeSummary({ autoRefresh: false, scoped: true })
    expect(scopedManual.label).toBe("只扫当前+AI复核")
    expect(scopedManual.buttonLabel).toBe("只扫这条+AI复核")
    expect(scopedManual.detail).toContain("反馈更快、噪声更少")

    const automatic = buildScanModeSummary({ autoRefresh: true })
    expect(automatic.label).toBe("自动规则快扫")
    expect(automatic.buttonLabel).toBe("自动跟踪")
    expect(automatic.detail).toContain("不自动调用 LLM")

    const scopedAutomatic = buildScanModeSummary({ autoRefresh: true, scoped: true })
    expect(scopedAutomatic.label).toBe("自动只扫当前")
    expect(scopedAutomatic.shortLabel).toBe("只扫规则")
  })

  it("skips LLM review during manual scans when the selected source has no new messages", () => {
    expect(buildEffectiveLlmReviewMode({
      requestedMode: "auto",
      rawRecordsWritten: 0,
      processedMessagesWritten: 0,
      repeatedScan: true,
    })).toEqual({
      mode: "off",
      skipped: true,
      reason: "no_new_signal_messages",
      detail: "同一范围没有新增资料，跳过 LLM 复核；仍执行规则扫描。",
    })

    expect(buildEffectiveLlmReviewMode({
      requestedMode: "auto",
      rawRecordsWritten: 0,
      processedMessagesWritten: 0,
      repeatedScan: false,
    })).toMatchObject({ mode: "auto", skipped: false })

    expect(buildEffectiveLlmReviewMode({
      requestedMode: "auto",
      rawRecordsWritten: 1,
      processedMessagesWritten: 0,
      repeatedScan: true,
    }).mode).toBe("auto")

    expect(buildEffectiveLlmReviewMode({
      requestedMode: "force",
      rawRecordsWritten: 0,
      processedMessagesWritten: 0,
    })).toMatchObject({ mode: "force", skipped: false })

    expect(buildEffectiveLlmReviewMode({
      requestedMode: "off",
      rawRecordsWritten: 5,
      processedMessagesWritten: 5,
    })).toMatchObject({ mode: "off", skipped: false })
  })

  it("splits manual auto review into rules-first then optional LLM review", () => {
    expect(buildWatchReviewPasses({ reviewMode: "auto" })).toEqual([
      { mode: "off", phase: "rules", label: "规则快扫" },
      { mode: "auto", phase: "llm", label: "LLM复核" },
    ])
    expect(buildWatchReviewPasses({ reviewMode: "off" })).toEqual([
      { mode: "off", phase: "rules", label: "规则快扫" },
    ])
    expect(buildWatchReviewPasses({ writeAlerts: true, reviewMode: "auto" })).toEqual([
      { mode: "off", phase: "rules", label: "确认写入" },
    ])
  })

  it("only runs LLM review after rules when rule scan produced reviewable items", () => {
    expect(shouldRunLlmReviewAfterRules({ reviewMode: "auto", eventCount: 1, candidateCount: 0 })).toBe(true)
    expect(shouldRunLlmReviewAfterRules({ reviewMode: "auto", eventCount: 0, candidateCount: 2 })).toBe(true)
    expect(shouldRunLlmReviewAfterRules({ reviewMode: "auto", eventCount: 0, candidateCount: 0 })).toBe(false)
    expect(shouldRunLlmReviewAfterRules({ reviewMode: "off", eventCount: 2, candidateCount: 2 })).toBe(false)
  })

  it("explains when WeChat scanning used rules only versus LLM review", () => {
    expect(buildReviewModeSummary({ llmReviewStatus: "off", autoRefresh: true })).toEqual({
      label: "规则快扫",
      detail: "自动跟踪只做解析、去重和规则路由；发现候选后再人工触发 LLM 复核。",
      nextAction: "有候选卡片时点「LLM复核这些卡片」；没卡片就继续自动跟踪。",
      tone: "rules",
      canReviewWithLlm: true,
    })

    const reviewed = buildReviewModeSummary({ llmReviewStatus: "done", autoRefresh: false })
    expect(reviewed.label).toBe("已LLM复核")
    expect(reviewed.detail).toContain("状态仍需你手动确认")
    expect(reviewed.nextAction).toContain("确认状态")
    expect(reviewed.tone).toBe("llm")
    expect(reviewed.canReviewWithLlm).toBe(false)

    const pending = buildReviewModeSummary({ llmReviewStatus: "auto", autoRefresh: false })
    expect(pending.label).toBe("等待LLM复核")
    expect(pending.nextAction).toContain("LLM增强判断")
    expect(pending.tone).toBe("pending")
    expect(pending.canReviewWithLlm).toBe(true)
  })

  it("does not confuse ordinary scanning with LLM review progress", () => {
    const scanning = buildReviewModeSummary({ llmReviewStatus: "off", autoRefresh: false, running: false })
    expect(scanning.label).toBe("规则快扫")
    expect(scanning.detail).toContain("本轮未启用 LLM")
    expect(scanning.nextAction).toContain("判断有无必要复核")

    const updating = buildReviewModeSummary({ llmReviewStatus: "off", autoRefresh: false, running: true, runningKind: "scan" })
    expect(updating.label).toBe("扫描更新中")
    expect(updating.detail).toContain("导入、去重")
    expect(updating.nextAction).toContain("等本轮完成")

    const reviewing = buildReviewModeSummary({ llmReviewStatus: "off", autoRefresh: false, running: true, runningKind: "llm" })
    expect(reviewing.label).toBe("LLM复核中")
    expect(reviewing.detail).toContain("不会自动改状态")
    expect(reviewing.nextAction).toContain("等复核完成")

    const reviewingWithRules = buildReviewModeSummary({
      llmReviewStatus: "off",
      autoRefresh: false,
      running: true,
      runningKind: "llm",
      ruleResultCount: 3,
    })
    expect(reviewingWithRules.label).toBe("规则卡已出，LLM增强中")
    expect(reviewingWithRules.detail).toContain("规则快扫已先显示 3 张卡片")
    expect(reviewingWithRules.nextAction).toContain("可以先看")
    expect(reviewingWithRules.nextAction).toContain("LLM")
  })

  it("keeps rule cards actionable while waiting for optional LLM enhancement", () => {
    const pendingWithRules = buildReviewModeSummary({
      llmReviewStatus: "auto",
      autoRefresh: false,
      ruleResultCount: 4,
    })

    expect(pendingWithRules.label).toBe("规则卡已出，待LLM增强")
    expect(pendingWithRules.detail).toContain("已有 4 张规则卡可以先看")
    expect(pendingWithRules.nextAction).toContain("可以先处理")
    expect(pendingWithRules.nextAction).toContain("LLM增强判断")
    expect(pendingWithRules.canReviewWithLlm).toBe(true)
  })

  it("explains skipped LLM review results without hiding rule-scan output", () => {
    const tooMany = buildReviewModeSummary({
      llmReviewStatus: "skipped",
      llmReviewReason: "too_many_candidate_items",
      autoRefresh: false,
    })
    expect(tooMany.label).toBe("规则结果待复核")
    expect(tooMany.detail).toContain("超过自动复核上限")
    expect(tooMany.nextAction).toContain("缩小范围")
    expect(tooMany.tone).toBe("pending")

    const noCandidates = buildReviewModeSummary({
      llmReviewStatus: "skipped",
      llmReviewReason: "no_candidate_items",
      autoRefresh: false,
    })
    expect(noCandidates.label).toBe("规则快扫")
    expect(noCandidates.detail).toContain("没有候选需要 LLM 复核")
    expect(noCandidates.nextAction).toContain("继续自动跟踪")
    expect(noCandidates.tone).toBe("rules")
    expect(noCandidates.canReviewWithLlm).toBe(false)

    const noNewSignals = buildReviewModeSummary({
      llmReviewStatus: "skipped",
      llmReviewReason: "no_new_signal_messages",
      autoRefresh: false,
    })
    expect(noNewSignals.label).toBe("规则快扫")
    expect(noNewSignals.detail).toContain("同一资料源没有新增内容")
    expect(noNewSignals.nextAction).toContain("切换资料源")
    expect(noNewSignals.canReviewWithLlm).toBe(false)
  })

  it("only shows the LLM review action when cards are idle and not already reviewed", () => {
    expect(shouldShowReviewModeAction({ hasSignals: true, running: false, tone: "rules" })).toBe(true)
    expect(shouldShowReviewModeAction({ hasSignals: true, running: false, tone: "pending" })).toBe(true)
    expect(shouldShowReviewModeAction({ hasSignals: true, running: false, tone: "rules", canReviewWithLlm: false })).toBe(false)
    expect(shouldShowReviewModeAction({ hasSignals: true, running: true, tone: "pending" })).toBe(false)
    expect(shouldShowReviewModeAction({ hasSignals: true, running: false, tone: "llm" })).toBe(false)
    expect(shouldShowReviewModeAction({ hasSignals: false, running: false, tone: "rules" })).toBe(false)
  })

  it("gives PM-friendly empty todo hints for no source and no match states", () => {
    expect(buildEmptySignalTodoHint({ running: true, sourceCount: 0, newMessageCount: 0, totalCount: 0 })).toMatchObject({
      title: "正在扫描新增资料",
      tone: "running",
      primaryActionKind: "none",
    })

    const initial = buildEmptySignalTodoHint({ hasScanned: false, sourceCount: 0, newMessageCount: 0, totalCount: 0 })
    expect(initial.title).toBe("还没有扫描新增资料")
    expect(initial.primaryActionKind).toBe("scan")

    const noSource = buildEmptySignalTodoHint({ hasScanned: true, sourceCount: 0, newMessageCount: 0, totalCount: 0 })
    expect(noSource.title).toBe("这个窗口没有新增资料")
    expect(noSource.nextAction).toContain("放大窗口")
    expect(noSource.tone).toBe("no-source")
    expect(noSource.primaryActionKind).toBe("expand-window")
    expect(noSource.primaryActionLabel).toBe("改为 1d 并重扫")

    const noMatch = buildEmptySignalTodoHint({ hasScanned: true, sourceCount: 3, newMessageCount: 3, totalCount: 0 })
    expect(noMatch.title).toBe("已扫描，但没有命中假设")
    expect(noMatch.nextAction).toContain("AI 并发发现假设")
    expect(noMatch.tone).toBe("no-match")
    expect(noMatch.primaryActionKind).toBe("discover")
  })

  it("only shows queue triage details when there are actionable signal cards", () => {
    expect(shouldShowSignalQueueDetails({ totalCount: 0 })).toBe(false)
    expect(shouldShowSignalQueueDetails({ totalCount: "0" })).toBe(false)
    expect(shouldShowSignalQueueDetails({ totalCount: 1 })).toBe(true)
  })

  it("summarizes confirmable signal cards as a PM action instead of raw reason text", () => {
    const summary = buildSignalDecisionSummary({
      kind: "tracked",
      canConfirm: true,
      currentStatus: "watching",
      suggestedStatus: "strengthening",
      evidenceDelta: "market_feedback",
      signalType: "市场反馈",
      relatedWikiCount: 2,
    })

    expect(summary.headline).toBe("先确认状态变化")
    expect(summary.tone).toBe("confirm")
    expect(summary.why).toContain("观察中 -> 证据增强")
    expect(summary.why).toContain("回连 2 个 wiki")
    expect(summary.next).toContain("写入假设记忆")
  })

  it("includes active wiki header context in tracked card decision copy", () => {
    const summary = buildSignalDecisionSummary({
      kind: "tracked",
      canConfirm: true,
      currentStatus: "watching",
      suggestedStatus: "strengthening",
      evidenceDelta: "market_feedback",
      signalType: "市场反馈",
      relatedWikiCount: 2,
      relatedWikiPages: [{
        wikiMeta: {
          status: "活跃",
          confidence: "高",
          momentum: "热",
          catalysts: ["MPO跳线需求"],
        },
      }],
    })

    expect(summary.why).toContain("回连 2 个 wiki")
    expect(summary.why).toContain("活跃框架")
    expect(summary.why).toContain("高置信")
    expect(summary.why).toContain("热动量")
    expect(summary.why).toContain("催化 MPO跳线需求")
  })

  it("summarizes Ask-needed catalyst cards as stock-ranking work", () => {
    const summary = buildSignalDecisionSummary({
      kind: "tracked",
      askDeepDiveRecommended: true,
      evidenceDelta: "catalyst_signal",
      signalType: "新催化",
      clusterSourceCount: 2,
      relatedWikiCount: 1,
    })

    expect(summary.headline).toBe("先 Ask 排股票和链条")
    expect(summary.tone).toBe("ask")
    expect(summary.why).toContain("2 条信号合并")
    expect(summary.next).toContain("关联股票")
  })

  it("builds a one-line PM action summary for Ask-needed tracked cards", () => {
    const line = buildSignalCardPmActionLine({
      kind: "tracked",
      askDeepDiveRecommended: true,
      currentStatus: "watching",
      suggestedStatus: "watching",
      evidenceDelta: "catalyst_signal",
      signalType: "新催化",
      sourceCount: 2,
      title: "CPO增速放缓可能推动MPO连接器量价齐升",
      sourceExcerpt: "CPO 节奏放缓，MPO 跳线和高速连接器讨论升温。",
      relatedWikiPages: [{
        title: "光互联Scale-Up-十年大周期",
        sourceRef: "wiki/概念/光互联Scale-Up-十年大周期.md",
        financeAuditMatchedEntities: [
          { term: "MPO", type: "product_line", label: "产品线" },
          { term: "CPO", type: "tech_route", label: "技术路线" },
        ],
      }],
      financeEntityRecords: [
        { term: "MPO", type: "product_line", label: "产品线" },
        { term: "CPO", type: "tech_route", label: "技术路线" },
      ],
    })

    expect(line.show).toBe(true)
    expect(line.lead).toBe("新催化命中已跟踪假设")
    expect(line.impact).toContain("CPO增速放缓可能推动MPO连接器量价齐升")
    expect(line.impact).toContain("MPO")
    expect(line.action).toBe("先 Ask 深挖")
    expect(line.guardrail).toContain("2 条信号合并")
    expect(line.guardrail).toContain("不会自动确认状态")
    expect(line.tone).toBe("ask")
  })

  it("builds a one-line PM action summary for confirmable status changes", () => {
    const line = buildSignalCardPmActionLine({
      kind: "tracked",
      canConfirm: true,
      currentStatus: "watching",
      suggestedStatus: "strengthening",
      evidenceDelta: "market_feedback",
      signalType: "市场反馈",
      title: "健滔涨价函可能推动CCL链条量价重估",
      sourceExcerpt: "CCL 涨价函扩散后，相关标的出现放量。",
    })

    expect(line.lead).toBe("市场反馈推动状态建议")
    expect(line.impact).toContain("观察中 -> 证据增强")
    expect(line.action).toBe("确认后写入假设记忆")
    expect(line.guardrail).toContain("只有点击确认才写入")
    expect(line.tone).toBe("confirm")
  })

  it("builds a one-line PM action summary for quiet tracked cards", () => {
    const line = buildSignalCardPmActionLine({
      kind: "tracked",
      currentStatus: "watching",
      suggestedStatus: "watching",
      evidenceDelta: "narrative_expansion",
      signalType: "叙事扩散",
      title: "玻璃基板产业化加速可能先利好设备材料验证链",
      sourceExcerpt: "市场继续讨论玻璃基板，但没有新增订单或公告。",
    })

    expect(line.lead).toBe("叙事扩散命中已跟踪假设")
    expect(line.action).toBe("本轮先观察")
    expect(line.guardrail).toContain("不升级状态")
    expect(line.tone).toBe("quiet")
  })

  it("keeps the main signal card compact when the PM action line and checklist already explain the decision", () => {
    const line = buildSignalCardPmActionLine({
      kind: "tracked",
      askDeepDiveRecommended: true,
      currentStatus: "watching",
      suggestedStatus: "watching",
      evidenceDelta: "catalyst_signal",
      signalType: "新催化",
      title: "CPO增速放缓可能推动MPO连接器量价齐升",
    })
    const checklist = buildSignalCardQuestionChecklist({
      kind: "tracked",
      askDeepDiveRecommended: true,
      currentStatus: "watching",
      suggestedStatus: "watching",
      evidenceDelta: "catalyst_signal",
      signalType: "新催化",
      title: "CPO增速放缓可能推动MPO连接器量价齐升",
      reason: "新增舆情命中，但还需要 Ask 排股票和链条。",
    })

    const policy = buildSignalCardSurfacePolicy({ pmActionLine: line, questionChecklist: checklist })

    expect(policy.showPmActionLine).toBe(true)
    expect(policy.showQuestionChecklist).toBe(true)
    expect(policy.showDecisionBlock).toBe(false)
    expect(policy.showTradeLine).toBe(false)
    expect(policy.detail).toContain("主卡片只保留")
  })

  it("falls back to the decision block when a card lacks the compact PM summary", () => {
    const policy = buildSignalCardSurfacePolicy({})

    expect(policy.showPmActionLine).toBe(false)
    expect(policy.showQuestionChecklist).toBe(false)
    expect(policy.showDecisionBlock).toBe(true)
    expect(policy.showTradeLine).toBe(true)
  })

  it("explains why a high-confidence wiki hit deserves Ask deep dive", () => {
    const summary = buildSignalDecisionSummary({
      kind: "tracked",
      askDeepDiveRecommended: true,
      evidenceDelta: "catalyst_signal",
      signalType: "新催化",
      relatedWikiPages: [{
        matchedTerms: ["CPO", "MPO", "CPO节奏放缓"],
        financeAuditMatchedTerms: ["MPO"],
        financeAuditMatchedEntities: [
          { term: "MPO", type: "product_line", label: "产品线" },
          { term: "CPO", type: "tech_route", label: "技术路线" },
        ],
        wikiMeta: {
          status: "活跃",
          confidence: "中",
          momentum: "热",
          tags: ["CPO", "MPO", "高速连接器"],
          catalysts: ["CPO节奏放缓", "MPO跳线需求"],
        },
      }],
    })

    expect(summary.headline).toBe("先 Ask 排股票和链条")
    expect(summary.why).toContain("活跃框架")
    expect(summary.why).toContain("命中表头")
    expect(summary.why).toContain("催化 CPO节奏放缓")
    expect(summary.why).toContain("SAG金融词 MPO")
    expect(summary.why).toContain("优先原因：命中产品线 MPO，技术路线 CPO")
  })

  it("keeps the finance priority reason visible in clipped card copy", () => {
    const summary = buildSignalDecisionSummary({
      kind: "tracked",
      askDeepDiveRecommended: true,
      evidenceDelta: "catalyst_signal",
      signalType: "新催化",
      relatedWikiPages: [{
        matchedTerms: ["CPO", "MPO", "CPO节奏放缓", "MPO跳线需求"],
        financeAuditMatchedTerms: ["MPO", "CPO", "高速连接器"],
        financeAuditMatchedEntities: [
          { term: "MPO", type: "product_line", label: "产品线" },
          { term: "CPO", type: "tech_route", label: "技术路线" },
          { term: "高速连接器", type: "supply_chain_role", label: "产业链位置" },
        ],
        wikiMeta: {
          status: "活跃",
          confidence: "高",
          momentum: "热",
          tags: ["CPO", "MPO", "高速连接器"],
          catalysts: ["CPO节奏放缓", "MPO跳线需求", "交换机互联升级"],
        },
      }],
    })
    const copy = buildSignalCardDecisionCopy({
      summary,
      title: "CPO增速放缓可能推动MPO连接器量价齐升",
      kind: "tracked",
    })

    expect(copy.whyImportant).toContain("优先原因")
    expect(copy.whyImportant).toContain("产品线 MPO")
    expect(copy.whyImportant).toContain("技术路线 CPO")
  })

  it("explains why finance-backed signal cards rank high", () => {
    const reason = buildSignalCardRankReason({
      kind: "tracked",
      askDeepDiveRecommended: true,
      evidenceDelta: "catalyst_signal",
      signalType: "新催化",
      sourceCount: 2,
      relatedWikiPages: [{
        financeAuditMatchedTerms: ["MPO", "CPO"],
        financeAuditMatchedEntities: [
          { term: "MPO", type: "product_line", label: "产品线" },
          { term: "CPO", type: "tech_route", label: "技术路线" },
        ],
        wikiMeta: {
          status: "活跃",
          confidence: "高",
          momentum: "热",
        },
      }],
    })

    expect(reason.show).toBe(true)
    expect(reason.label).toBe("排序原因")
    expect(reason.detail).toContain("建议 Ask 深挖")
    expect(reason.detail).toContain("新催化")
    expect(reason.detail).toContain("多来源 2 条")
    expect(reason.detail).toContain("活跃 wiki 框架")
    expect(reason.detail).toContain("高置信")
    expect(reason.detail).toContain("热动量")
    expect(reason.detail).toContain("产品线 MPO")
    expect(reason.detail).toContain("技术路线 CPO")
    expect(reason.tone).toBe("ask")
  })

  it("explains direct finance signal entities in rank reasons before wiki linkage exists", () => {
    const reason = buildSignalCardRankReason({
      kind: "tracked",
      askDeepDiveRecommended: true,
      evidenceDelta: "catalyst_signal",
      signalType: "新催化",
      financeEntityRecords: [{
        financeSignalEntities: [
          { term: "健滔", type: "company", label: "公司" },
          { term: "CCL", type: "product_line", label: "产品线" },
          { term: "涨价函", type: "catalyst", label: "催化" },
          { term: "2026-06-19", type: "time", label: "时间" },
        ],
      }],
    })

    expect(reason.detail).toContain("公司 健滔")
    expect(reason.detail).toContain("产品线 CCL")
    expect(reason.detail).toContain("催化 涨价函")
    expect(reason.detail).not.toContain("2026-06-19")
  })

  it("explains narrative expansion cards as deliberately lowered priority", () => {
    const reason = buildSignalCardRankReason({
      kind: "tracked",
      evidenceDelta: "narrative_expansion",
      signalType: "叙事扩散",
      relatedWikiPages: [{
        financeAuditMatchedEntities: [
          { term: "2026-06-19", type: "time" },
          { term: "微信", type: "source" },
        ],
      }],
    })

    expect(reason.show).toBe(true)
    expect(reason.detail).toContain("叙事扩散已降权")
    expect(reason.detail).not.toContain("时间 2026-06-19")
    expect(reason.detail).not.toContain("来源 微信")
    expect(reason.tone).toBe("quiet")
  })

  it("builds a one-line trading brief for Ask-worthy catalyst cards", () => {
    const brief = buildSignalCardTradingBrief({
      kind: "tracked",
      askDeepDiveRecommended: true,
      evidenceDelta: "catalyst_signal",
      signalType: "新催化",
      financeEntityRecords: [{
        financeAuditMatchedEntities: [
          { term: "MPO", type: "product_line" },
          { term: "CPO", type: "tech_route" },
        ],
      }],
    })

    expect(brief.label).toBe("新催化")
    expect(brief.headline).toContain("产品线 MPO")
    expect(brief.headline).toContain("技术路线 CPO")
    expect(brief.action).toBe("Ask 深挖")
    expect(brief.detail).toContain("先排关联股票")
    expect(brief.tone).toBe("ask")
  })

  it("prioritizes direct finance signal entities from the message itself", () => {
    const strip = buildSignalFinanceEntityStrip([{
      financeSignalEntities: [
        { term: "2026-06-19", type: "time", label: "时间" },
        { term: "微信", type: "source", label: "来源" },
        { term: "涨价函", type: "catalyst", label: "催化" },
        { term: "MPO", type: "product_line", label: "产品线" },
        { term: "CPO", type: "tech_route", label: "技术路线" },
      ],
    }])

    expect(strip.show).toBe(true)
    expect(strip.detail).toContain("产品线 MPO")
    expect(strip.detail).toContain("技术路线 CPO")
    expect(strip.detail).toContain("催化 涨价函")
    expect(strip.detail).not.toContain("2026-06-19")
    expect(strip.detail).not.toContain("微信")
  })

  it("explains finance entity hits as a PM decision cue", () => {
    const strip = buildSignalFinanceEntityStrip([{
      financeSignalEntities: [
        { term: "健滔", type: "company", label: "公司" },
        { term: "CCL", type: "product_line", label: "产品线" },
        { term: "涨价函", type: "catalyst", label: "催化" },
      ],
    }])

    expect(strip.show).toBe(true)
    expect(strip.decision).toContain("健滔")
    expect(strip.decision).toContain("CCL")
    expect(strip.decision).toContain("涨价函")
    expect(strip.decision).toContain("为什么重要")
    expect(strip.decision).toContain("公司 健滔")
    expect(strip.decision).toContain("产品线 CCL")
    expect(strip.decision).toContain("催化 涨价函")
    expect(strip.decision).toContain("Ask 深挖")
    expect(strip.headline).toBe("健滔 / CCL / 涨价函")
    expect(strip.actionLabel).toBe("Ask 排序")
  })

  it("explains risk finance hits as a counter-review cue", () => {
    const strip = buildSignalFinanceEntityStrip([{
      financeSignalEntities: [
        { term: "CPO 放缓", type: "risk_factor", label: "风险因子" },
        { term: "MPO", type: "product_line", label: "产品线" },
      ],
    }])

    expect(strip.show).toBe(true)
    expect(strip.decision).toContain("风险")
    expect(strip.decision).toContain("CPO 放缓")
    expect(strip.decision).toContain("为什么重要")
    expect(strip.decision).toContain("反证复核")
    expect(strip.decision).not.toContain("Ask 深挖")
    expect(strip.headline).toBe("风险：CPO 放缓")
    expect(strip.actionLabel).toBe("先反证")
  })

  it("explains market feedback finance hits as a priced-in cue", () => {
    const strip = buildSignalFinanceEntityStrip([{
      financeSignalEntities: [
        { term: "放量突破", type: "trade_pattern", label: "交易模式" },
        { term: "MPO", type: "product_line", label: "产品线" },
      ],
    }])

    expect(strip.show).toBe(true)
    expect(strip.decision).toContain("市场反馈")
    expect(strip.decision).toContain("放量突破")
    expect(strip.decision).toContain("为什么重要")
    expect(strip.decision).toContain("已经定价")
    expect(strip.headline).toBe("市场反馈：放量突破")
    expect(strip.actionLabel).toBe("看定价")
  })

  it("builds a one-line trading brief for confirmable status changes", () => {
    const brief = buildSignalCardTradingBrief({
      kind: "tracked",
      canConfirm: true,
      currentStatus: "watching",
      suggestedStatus: "strengthening",
      evidenceDelta: "supporting_signal",
      signalType: "二次确认",
      sourceCount: 2,
      financeEntityRecords: [{
        financeAuditMatchedEntities: [
          { term: "健滔", type: "company" },
          { term: "CCL", type: "product_line" },
        ],
      }],
    })

    expect(brief.action).toBe("确认状态")
    expect(brief.headline).toContain("公司 健滔")
    expect(brief.headline).toContain("产品线 CCL")
    expect(brief.detail).toContain("观察中 -> 证据增强")
    expect(brief.detail).toContain("2 条来源")
    expect(brief.tone).toBe("confirm")
  })

  it("keeps weak narrative cards as observe-first trading briefs", () => {
    const brief = buildSignalCardTradingBrief({
      kind: "tracked",
      evidenceDelta: "narrative_expansion",
      signalType: "叙事扩散",
      financeEntityRecords: [{
        financeAuditMatchedEntities: [
          { term: "2026-06-19", type: "time" },
          { term: "微信", type: "source" },
        ],
      }],
    })

    expect(brief.action).toBe("继续观察")
    expect(brief.headline).not.toContain("2026-06-19")
    expect(brief.headline).not.toContain("微信")
    expect(brief.detail).toContain("等二次确认")
    expect(brief.tone).toBe("quiet")
  })

  it("turns tracked signal cards into six PM-facing questions", () => {
    const checklist = buildSignalCardQuestionChecklist({
      kind: "tracked",
      canConfirm: true,
      askDeepDiveRecommended: true,
      currentStatus: "watching",
      suggestedStatus: "strengthening",
      evidenceDelta: "catalyst_signal",
      signalType: "新催化",
      title: "CPO增速放缓可能推动MPO连接器量价齐升",
      reason: "source contains a fresh tradable catalyst; follow price/volume and second confirmation before upgrading conviction",
      tradingImplication: "先看 MPO 高速连接器订单、量价反馈和受益股票排序。",
      sourceExcerpt: "微信增量 chat=AI产业链 sentAt=2026-06-19 09:30:10 CPO节奏放缓，MPO跳线需求被重新讨论。",
      sourceRef: ".llm-wiki/wechat-inbox/processed/2026-06-19.jsonl#msg:raw:aaa:bbb",
    })

    expect(checklist.show).toBe(true)
    expect(checklist.title).toBe("PM 处理要点")
    expect(checklist.headline).toContain("先确认状态变化")
    expect(checklist.detail).toContain("建议")
    expect(checklist.primaryAction).toContain("确认")
    expect(checklist.guardrail).toContain("不会自动确认状态")
    expect(checklist.items.map((item) => item.label)).toEqual([
      "这是什么信号",
      "影响哪条假设",
      "状态建议",
      "为什么重要",
      "交易含义",
      "下一步",
    ])
    expect(checklist.items.find((item) => item.key === "signal")?.value).toContain("CPO节奏放缓")
    expect(checklist.items.find((item) => item.key === "status")?.value).toContain("观察中 -> 证据增强")
    expect(checklist.items.find((item) => item.key === "reason")?.value).toContain("出现新催化")
    expect(checklist.items.find((item) => item.key === "reason")?.value).not.toContain("fresh tradable catalyst")
    expect(checklist.items.find((item) => item.key === "implication")?.value).toContain("MPO 高速连接器")
    expect(checklist.items.find((item) => item.key === "next")?.value).toContain("确认")
    expect(checklist.items.map((item) => item.value).join(" ")).not.toContain(".llm-wiki")
  })

  it("uses structured source kind labels in PM checklist signal source", () => {
    const input = {
      kind: "tracked" as const,
      currentStatus: "watching",
      suggestedStatus: "watching",
      evidenceDelta: "catalyst_signal",
      signalType: "新催化",
      title: "健滔涨价函可能推动CCL覆铜板链条进入量价重估",
      sourceKindLabel: "研报新闻",
      sourceRef: ".llm-wiki/wechat-inbox/processed/2026-06-25.jsonl#msg:raw:news:1",
      reason: "new context matched an existing hypothesis",
    }
    const checklist = buildSignalCardQuestionChecklist(input)
    const signal = checklist.items.find((item) => item.key === "signal")?.value ?? ""

    expect(signal).toContain("研报新闻")
    expect(signal).not.toContain("微信")
    expect(signal).not.toContain(".llm-wiki")
  })

  it("keeps candidate cards as precheck-before-tracking questions", () => {
    const checklist = buildSignalCardQuestionChecklist({
      kind: "candidate",
      askDeepDiveRecommended: true,
      evidenceDelta: "catalyst_signal",
      signalType: "新催化",
      title: "高速PCB上游涨价可能成为AI互联行情的扩散方向",
      sourceRef: "raw/研报新闻/2026-06-19.md",
      reason: "new catalyst but not enough follow-through",
    })

    expect(checklist.items.find((item) => item.key === "hypothesis")?.value).toContain("候选新假设")
    expect(checklist.items.find((item) => item.key === "status")?.value).toBe("候选假设，尚未加入跟踪")
    expect(checklist.headline).toContain("先 Ask 预检")
    expect(checklist.primaryAction).toContain("Ask 预检")
    expect(checklist.guardrail).toContain("不会自动加入跟踪")
    expect(checklist.items.find((item) => item.key === "next")?.value).toContain("Ask 预检")
    expect(checklist.items.find((item) => item.key === "next")?.value).toContain("加入跟踪")
  })

  it("keeps tag-only wiki hits as observation rather than over-upgrading them", () => {
    const summary = buildSignalDecisionSummary({
      kind: "tracked",
      askDeepDiveRecommended: false,
      evidenceDelta: "catalyst_signal",
      signalType: "新催化",
      relatedWikiPages: [{
        matchedTerms: ["CPO"],
        wikiMeta: {
          status: "活跃",
          tags: ["CPO", "MPO"],
        },
      }],
    })

    expect(summary.headline).toBe("新催化，先看扩散")
    expect(summary.tone).toBe("catalyst")
    expect(summary.why).toContain("只命中标签")
    expect(summary.next).toContain("二次来源")
  })

  it("summarizes candidate hypotheses as create-or-ignore decisions", () => {
    const summary = buildSignalDecisionSummary({
      kind: "candidate",
      evidenceDelta: "catalyst_signal",
      signalType: "新催化",
      clusterSourceCount: 2,
      relatedWikiCount: 3,
      priorityReasons: ["硬催化", "多来源确认"],
      askDeepDiveRecommended: true,
    })

    expect(summary.headline).toBe("候选新假设，先 Ask 预检")
    expect(summary.tone).toBe("candidate")
    expect(summary.why).toContain("硬催化 / 多来源确认")
    expect(summary.why).toContain("2 条来源合并")
    expect(summary.why).toContain("回连 3 个 wiki")
    expect(summary.next).toContain("确认后再加入跟踪")
  })

  it("includes wiki header context in candidate hypothesis decisions", () => {
    const summary = buildSignalDecisionSummary({
      kind: "candidate",
      evidenceDelta: "catalyst_signal",
      signalType: "新催化",
      relatedWikiPages: [{
        wikiMeta: {
          status: "活跃",
          confidence: "中",
          momentum: "热",
          catalysts: ["玻璃基板产业化"],
        },
      }],
      askDeepDiveRecommended: true,
    })

    expect(summary.why).toContain("回连 1 个 wiki")
    expect(summary.why).toContain("活跃框架")
    expect(summary.why).toContain("中置信")
    expect(summary.why).toContain("热动量")
    expect(summary.why).toContain("催化 玻璃基板产业化")
  })

  it("renders SAG project finance entity types as PM-facing Chinese labels", () => {
    const summary = buildSignalDecisionSummary({
      kind: "candidate",
      evidenceDelta: "catalyst_signal",
      signalType: "市场反馈",
      relatedWikiPages: [{
        sourceRef: "wiki/概念/半导体材料景气.md",
        title: "半导体材料景气",
        matchedTerms: ["半导体", "玻璃基板", "缩量轮动", "中信证券", "设备平台"],
        financeAuditMatchedTerms: ["半导体", "玻璃基板", "缩量轮动", "中信证券", "设备平台"],
        financeAuditMatchedEntities: [
          { term: "半导体", type: "sector" },
          { term: "玻璃基板", type: "theme" },
          { term: "缩量轮动", type: "market_regime" },
          { term: "中信证券", type: "organization" },
          { term: "设备平台", type: "product" },
        ],
      }],
    })

    expect(summary.why).toContain("优先原因")
    expect(summary.why).toContain("板块 半导体")
    expect(summary.why).toContain("主题 玻璃基板")
    expect(summary.why).toContain("市场状态 缩量轮动")
    expect(summary.why).toContain("金融类型")
    expect(summary.why).not.toContain("market_regime")
    expect(summary.why).not.toContain("sector")
  })

  it("keeps the real Watchtower catalyst sample readable as a finance-keyword PM card", () => {
    const summary = buildSignalDecisionSummary({
      kind: "candidate",
      evidenceDelta: "catalyst_signal",
      signalType: "新催化",
      clusterSourceCount: 1,
      priorityReasons: ["硬催化", "价格催化", "量化信息"],
      askDeepDiveRecommended: true,
      relatedWikiPages: [{
        sourceRef: "wiki/概念/PCB半导体化设备耗材链.md",
        title: "PCB半导体化设备耗材链",
        matchedTerms: ["PCB", "板厂", "载板厂", "层压机"],
        financeAuditMatchedTerms: ["PCB", "板厂", "载板厂", "层压机"],
        financeAuditMatchedEntities: [
          { term: "PCB", type: "product_line", label: "产品线" },
          { term: "板厂", type: "supply_chain_role", label: "产业链位置" },
          { term: "载板厂", type: "supply_chain_role", label: "产业链位置" },
          { term: "层压机", type: "product_line", label: "产品线" },
        ],
        wikiMeta: {
          type: "概念",
          status: "活跃",
          confidence: "中",
          momentum: "热",
          updated: "2026-06-20 04:35:00",
          tags: ["PCB", "AI服务器", "先进封装", "玻璃基板", "TGV", "mSAP", "设备耗材", "半导体材料"],
          catalysts: ["台积电玻璃基板Pilot线与客户联合验证", "AI服务器PCB层数和线宽线距升级"],
        },
      }],
    })
    const copy = buildSignalCardDecisionCopy({
      summary,
      title: "新催化：藤仓 DCI 光缆涨价 30% 和业绩上修",
      kind: "candidate",
    })

    expect(summary.headline).toBe("候选新假设，先 Ask 预检")
    expect(summary.why).toContain("硬催化 / 价格催化 / 量化信息")
    expect(summary.why).toContain("回连 1 个 wiki")
    expect(summary.why).toContain("活跃框架")
    expect(summary.why).toContain("中置信")
    expect(summary.why).toContain("热动量")
    expect(summary.why).toContain("命中表头")
    expect(summary.why).toContain("SAG金融词 PCB")
    expect(summary.why).toContain("金融类型：产品线 PCB/层压机")
    expect(summary.why).toContain("产业链位置 板厂/载板厂")
    expect(copy.whyImportant).toContain("候选新假设")
    expect(copy.affects).toContain("藤仓 DCI 光缆涨价")
    expect(copy.nextAction).toContain("Ask 预检")
  })

  it("turns tracked signal summaries into three-line PM decision copy", () => {
    const summary = buildSignalDecisionSummary({
      kind: "tracked",
      canConfirm: true,
      currentStatus: "watching",
      suggestedStatus: "strengthening",
      evidenceDelta: "catalyst_signal",
      signalType: "新催化",
      relatedWikiCount: 2,
    })
    const copy = buildSignalCardDecisionCopy({
      summary,
      title: "健滔涨价函可能推动 CCL 链条量价重估",
      currentStatus: "watching",
      suggestedStatus: "strengthening",
      kind: "tracked",
    })

    expect(copy.whyImportant).toContain("先确认状态变化")
    expect(copy.decision).toBe("先确认状态变化")
    expect(copy.reason).toContain("建议 观察中 -> 证据增强")
    expect(copy.affects).toContain("影响假设：健滔涨价函")
    expect(copy.affects).toContain("观察中 -> 证据增强")
    expect(copy.nextAction).toContain("确认")
    expect(copy.tone).toBe("confirm")
  })

  it("turns candidate summaries into create-or-precheck decision copy", () => {
    const summary = buildSignalDecisionSummary({
      kind: "candidate",
      askDeepDiveRecommended: true,
      evidenceDelta: "catalyst_signal",
      signalType: "新催化",
      clusterSourceCount: 2,
    })
    const copy = buildSignalCardDecisionCopy({
      summary,
      title: "玻璃基板产业化加速可能先利好设备材料链",
      kind: "candidate",
    })

    expect(copy.whyImportant).toContain("候选新假设")
    expect(copy.decision).toBe("候选新假设，先 Ask 预检")
    expect(copy.reason).toContain("2 条来源合并")
    expect(copy.affects).toContain("可能新建：玻璃基板")
    expect(copy.nextAction).toContain("Ask 预检")
    expect(copy.tone).toBe("candidate")
  })

  it("builds a PM information-flow path for tracked signals", () => {
    const flow = buildSignalInfoFlowCopy({
      kind: "tracked",
      title: "CPO增速放缓可能推动MPO连接器量价齐升",
      sourceExcerpt: "微信增量 chat=AI产业链情报 sentAt=2026-06-19 09:30:10 CPO节奏放缓，MPO跳线需求被重新讨论。",
      sourceRef: ".llm-wiki/wechat-inbox/processed/2026-06-19.jsonl#msg:raw:aaa:bbb",
      relatedWikiPages: [{
        title: "AI数据中心互联",
        wikiMeta: { status: "活跃", confidence: "中", momentum: "热" },
      }],
      signalType: "新催化",
      evidenceDelta: "catalyst_signal",
      currentStatus: "watching",
      suggestedStatus: "strengthening",
      canConfirm: true,
      financeEntityRecords: [{
        financeAuditMatchedEntities: [
          { term: "MPO", type: "product_line" },
          { term: "CPO", type: "tech_route" },
        ],
      }],
    })

    expect(flow.source).toContain("微信")
    expect(flow.frame).toContain("活跃框架")
    expect(flow.target).toContain("CPO增速放缓")
    expect(flow.action).toContain("确认状态")
    expect(flow.detail).toContain("回连")
    expect(flow.detail).toContain("SAG实体")
    expect(flow.detail).toContain("产品线 MPO")
    expect(flow.detail).toContain("技术路线 CPO")
    expect(flow.tone).toBe("confirm")
  })

  it("uses structured source kind labels in information-flow source", () => {
    const flow = buildSignalInfoFlowCopy({
      kind: "tracked",
      title: "健滔涨价函可能推动CCL覆铜板链条进入量价重估",
      sourceKindLabel: "研报新闻",
      sourceRef: ".llm-wiki/wechat-inbox/processed/2026-06-25.jsonl#msg:raw:news:1",
      signalType: "新催化",
      evidenceDelta: "catalyst_signal",
      currentStatus: "watching",
      suggestedStatus: "watching",
    })

    expect(flow.source).toContain("研报新闻")
    expect(flow.source).not.toContain("微信")
    expect(flow.source).not.toContain(".llm-wiki")
  })

  it("makes no-wiki candidate information flow explicit", () => {
    const flow = buildSignalInfoFlowCopy({
      kind: "candidate",
      title: "玻璃基板产业化加速可能先利好设备材料链",
      signalType: "新催化",
      evidenceDelta: "catalyst_signal",
      askDeepDiveRecommended: true,
    })

    expect(flow.source).toBe("新增信息")
    expect(flow.frame).toBe("无强 wiki 回连")
    expect(flow.target).toContain("候选")
    expect(flow.action).toBe("Ask 预检")
    expect(flow.detail).toContain("不要硬升级")
    expect(flow.tone).toBe("candidate")
  })

  it("explains ignored signal cards as a local non-write action", () => {
    const copy = buildIgnoredSignalNoticeCopy("CPO增速放缓可能推动MPO连接器量价齐升")

    expect(copy.title).toContain("已本轮忽略")
    expect(copy.title).toContain("CPO增速放缓")
    expect(copy.detail).toContain("当前工作台隐藏")
    expect(copy.detail).toContain("不写入假设状态")
    expect(copy.detail).toContain("不写 wiki/raw")
  })

  it("summarizes card action feedback so clicks never look like no-ops", () => {
    const runningAsk = buildSignalCardActionFeedback({
      action: "ask",
      status: "running",
      title: "CPO增速放缓可能推动MPO连接器量价齐升",
    })
    expect(runningAsk.show).toBe(true)
    expect(runningAsk.label).toBe("Ask 深挖中")
    expect(runningAsk.detail).toContain("自动定位")
    expect(runningAsk.detail).toContain("摘要")
    expect(runningAsk.nextAction).toContain("等待 Ask 返回")
    expect(runningAsk.jumpTargetLabel).toBe("查看 Ask 结果")
    expect(runningAsk.tone).toBe("running")

    const doneAsk = buildSignalCardActionFeedback({ action: "ask", status: "done" })
    expect(doneAsk.label).toBe("Ask 已返回")
    expect(doneAsk.detail).toContain("Ask 结果区")
    expect(doneAsk.detail).toContain("完整六段回答")
    expect(doneAsk.nextAction).toContain("点查看 Ask 结果")
    expect(doneAsk.jumpTargetLabel).toBe("查看 Ask 结果")

    const donePrecheck = buildSignalCardActionFeedback({ action: "precheck", status: "done" })
    expect(donePrecheck.label).toBe("预检已返回")
    expect(donePrecheck.detail).toContain("结构化摘要")
    expect(donePrecheck.jumpTargetLabel).toBe("查看 Ask 结果")

    const doneConfirm = buildSignalCardActionFeedback({ action: "confirm", status: "done" })
    expect(doneConfirm.label).toBe("已确认状态")
    expect(doneConfirm.detail).toContain("假设记忆")
    expect(doneConfirm.detail).toContain("没有写 wiki/raw")
    expect(doneConfirm.nextAction).toContain("继续扫描新增资料")
    expect(doneConfirm.jumpTargetLabel).toBeUndefined()

    const changedConfirm = buildSignalCardActionFeedback({
      action: "confirm",
      status: "done",
      previousStatus: "watching",
      newStatus: "strengthening",
    })
    expect(changedConfirm.label).toBe("状态已正式更新")
    expect(changedConfirm.detail).toContain("观察中 -> 证据增强")
    expect(changedConfirm.detail).toContain("没有写 wiki/raw")

    const noChangeConfirm = buildSignalCardActionFeedback({
      action: "confirm",
      status: "done",
      previousStatus: "watching",
      newStatus: "watching",
    })
    expect(noChangeConfirm.label).toBe("状态未变化")
    expect(noChangeConfirm.detail).toContain("当前已经是观察中")
    expect(noChangeConfirm.detail).toContain("人工确认记录")
    expect(noChangeConfirm.nextAction).toContain("不需要重复确认")

    const ignored = buildSignalCardActionFeedback({
      action: "ignore",
      status: "done",
      title: "CPO增速放缓可能推动MPO连接器量价齐升",
    })
    expect(ignored.label).toBe("已本轮忽略")
    expect(ignored.detail).toContain("只隐藏当前卡片")
    expect(ignored.detail).toContain("不写入假设状态")
    expect(ignored.nextAction).toContain("继续处理剩余卡片")

    const tracked = buildSignalCardActionFeedback({
      action: "track",
      status: "done",
      title: "高速PCB上游涨价可能成为AI互联行情的扩散方向",
    })
    expect(tracked.label).toBe("已加入跟踪")
    expect(tracked.detail).toContain(".llm-wiki/hypotheses")
    expect(tracked.detail).toContain("不写 wiki/raw")
    expect(tracked.nextAction).toContain("扫描新增资料")

    const failed = buildSignalCardActionFeedback({
      action: "track",
      status: "error",
      detail: "Missing title",
    })
    expect(failed.label).toBe("加入跟踪失败")
    expect(failed.detail).toContain("Missing title")
    expect(failed.nextAction).toContain("按本卡片动作重试")
    expect(failed.tone).toBe("error")

    const failedAsk = buildSignalCardActionFeedback({
      action: "ask",
      status: "error",
      detail: "provider timeout",
    })
    expect(failedAsk.label).toBe("Ask 深挖失败")
    expect(failedAsk.detail).toContain("provider timeout")
    expect(failedAsk.jumpTargetLabel).toBe("查看失败原因")

    const failedPrecheck = buildSignalCardActionFeedback({
      action: "precheck",
      status: "error",
      detail: "mock failure",
    })
    expect(failedPrecheck.label).toBe("Ask 预检失败")
    expect(failedPrecheck.jumpTargetLabel).toBe("查看失败原因")
  })

  it("backfills Ask results onto the source signal card", () => {
    const running = buildSignalCardAskResultBackfill({
      action: "ask",
      status: "running",
      title: "CPO增速放缓可能推动MPO连接器量价齐升",
    })
    expect(running.show).toBe(true)
    expect(running.label).toBe("Ask 深挖运行中")
    expect(running.detail).toContain("回填到本卡片")
    expect(running.stockLine).toContain("抽取中")
    expect(running.tone).toBe("running")

    const ready = buildSignalCardAskResultBackfill({
      action: "ask",
      status: "done",
      title: "CPO增速放缓可能推动MPO连接器量价齐升",
      sourceCount: 12,
      summary: {
        stocks: "沃尔核材、神宇股份、鼎通科技",
        directBeneficiary: "MPO高速连接器和跳线链",
        ranking: "鼎通科技 > 神宇股份 > 沃尔核材",
        gap: "订单和涨价函仍需二次确认",
        stage: "新催化/验证中",
      },
      decision: {
        headline: "有标的线索，先验证缺口",
        primaryAction: "按排序验证",
        focus: "鼎通科技 > 神宇股份 > 沃尔核材",
        risk: "订单和涨价函仍需二次确认",
        evidenceState: "待验证",
        tone: "verify",
      },
    })
    expect(ready.show).toBe(true)
    expect(ready.label).toBe("已 Ask 回填")
    expect(ready.headline).toBe("有标的线索，先验证缺口")
    expect(ready.stockLine).toContain("沃尔核材")
    expect(ready.actionLine).toContain("按排序验证")
    expect(ready.pmActionLabel).toBe("可转观察清单")
    expect(ready.pmActionDetail).toContain("去完整 Ask")
    expect(ready.observationLine).toContain("1-5 个交易日")
    expect(ready.observationLine).toContain("沃尔核材")
    expect(ready.sourceLine).toBe("来源：12 个")
    expect(ready.jumpTargetLabel).toBe("查看完整 Ask")
    expect(ready.tone).toBe("ready")

    const warning = buildSignalCardAskResultBackfill({
      action: "precheck",
      status: "done",
      sourceCount: 4,
      summary: {
        stage: "舆情催化",
        gap: "没有关联股票",
      },
      decision: {
        headline: "先补证据，再谈排序",
        primaryAction: "补来源",
        focus: "舆情催化",
        risk: "没有关联股票",
        evidenceState: "证据不足",
        tone: "blocked",
      },
    })
    expect(warning.label).toBe("预检已回填")
    expect(warning.stockLine).toContain("未抽出")
    expect(warning.actionLine).toContain("补来源")
    expect(warning.pmActionLabel).toBe("先补来源")
    expect(warning.pmActionDetail).toContain("不要入观察队列")
    expect(warning.observationLine).toContain("没有股票池")
    expect(warning.tone).toBe("warning")

    const failed = buildSignalCardAskResultBackfill({
      action: "ask",
      status: "error",
      detail: "Codex provider timeout",
    })
    expect(failed.label).toBe("Ask 深挖失败")
    expect(failed.detail).toContain("timeout")
    expect(failed.actionLine).toContain("重试")
    expect(failed.pmActionLabel).toBe("重试或收窄")
    expect(failed.tone).toBe("error")
  })

  it("hides the generic Ask done feedback when a richer Ask backfill is available", () => {
    const doneAsk = buildSignalCardActionFeedback({
      action: "ask",
      status: "done",
      title: "CPO增速放缓可能推动MPO连接器量价齐升",
    })
    const readyBackfill = buildSignalCardAskResultBackfill({
      action: "ask",
      status: "done",
      summary: {
        stocks: "沃尔核材、神宇股份",
        ranking: "神宇股份 > 沃尔核材",
      },
    })
    expect(shouldShowSignalCardActionFeedback(doneAsk, readyBackfill)).toBe(false)

    const warningBackfill = buildSignalCardAskResultBackfill({
      action: "precheck",
      status: "done",
      summary: {
        gap: "没有关联股票",
      },
    })
    const donePrecheck = buildSignalCardActionFeedback({ action: "precheck", status: "done" })
    expect(shouldShowSignalCardActionFeedback(donePrecheck, warningBackfill)).toBe(false)

    const runningAsk = buildSignalCardActionFeedback({ action: "ask", status: "running" })
    const runningBackfill = buildSignalCardAskResultBackfill({ action: "ask", status: "running" })
    expect(shouldShowSignalCardActionFeedback(runningAsk, runningBackfill)).toBe(true)

    const failedAsk = buildSignalCardActionFeedback({ action: "ask", status: "error" })
    const failedBackfill = buildSignalCardAskResultBackfill({ action: "ask", status: "error" })
    expect(shouldShowSignalCardActionFeedback(failedAsk, failedBackfill)).toBe(true)

    const confirm = buildSignalCardActionFeedback({ action: "confirm", status: "done" })
    expect(shouldShowSignalCardActionFeedback(confirm, readyBackfill)).toBe(true)
  })

  it("turns latest card action feedback into a compact daily status notice", () => {
    const runningTableAsk = buildDailyStatusActionFeedback({
      action: "ask",
      status: "running",
      title: "CPO增速放缓可能推动MPO连接器量价齐升",
    })
    expect(runningTableAsk.show).toBe(true)
    expect(runningTableAsk.label).toBe("Ask 深挖中")
    expect(runningTableAsk.detail).toContain("CPO增速放缓")
    expect(runningTableAsk.detail).toContain("自动定位")
    expect(runningTableAsk.jumpLabel).toBe("查看 Ask 结果")
    expect(runningTableAsk.tone).toBe("running")

    const ask = buildDailyStatusActionFeedback({
      action: "ask",
      status: "done",
      title: "CPO增速放缓可能推动MPO连接器量价齐升",
    })

    expect(ask.show).toBe(true)
    expect(ask.label).toBe("Ask 已返回")
    expect(ask.detail).toContain("CPO增速放缓")
    expect(ask.jumpLabel).toBe("查看 Ask 结果")
    expect(ask.tone).toBe("done")

    const confirm = buildDailyStatusActionFeedback({
      action: "confirm",
      status: "done",
      title: "健滔涨价函可能推动 CCL 链条量价重估",
    })
    expect(confirm.show).toBe(true)
    expect(confirm.label).toBe("已确认状态")
    expect(confirm.detail).toContain("没有写 wiki/raw")
    expect(confirm.jumpLabel).toBe("")

    const changedConfirm = buildDailyStatusActionFeedback({
      action: "confirm",
      status: "done",
      title: "健滔涨价函可能推动 CCL 链条量价重估",
      previousStatus: "watching",
      newStatus: "strengthening",
    })
    expect(changedConfirm.label).toBe("状态已正式更新")
    expect(changedConfirm.detail).toContain("观察中 -> 证据增强")
    expect(changedConfirm.detail).toContain("没有写 wiki/raw")
  })

  it("turns the clicked card action button into an immediate busy state", () => {
    const actions = buildSignalCardActions({
      kind: "tracked",
      canConfirm: false,
      canAsk: true,
      askDeepDiveRecommended: true,
    })
    const feedback = buildSignalCardActionFeedback({
      action: "ask",
      status: "running",
      title: "CPO增速放缓可能推动MPO连接器量价齐升",
    })

    const askButton = buildSignalCardActionButtonState({
      action: actions.primary,
      feedback,
      running: false,
    })

    expect(askButton.label).toBe("Ask 深挖中")
    expect(askButton.busy).toBe(true)
    expect(askButton.disabled).toBe(true)
    expect(askButton.ariaLabel).toContain("正在执行")
    expect(askButton.title).toContain("正在执行这一步")
  })

  it("disables sibling card actions while one action is running on the same card", () => {
    const actions = buildSignalCardActions({
      kind: "tracked",
      canConfirm: true,
      canAsk: true,
      askDeepDiveRecommended: true,
    })
    const feedback = buildSignalCardActionFeedback({
      action: "confirm",
      status: "running",
      title: "健滔涨价函可能推动 CCL 链条量价重估",
    })

    const askButton = buildSignalCardActionButtonState({
      action: actions.secondary[0],
      feedback,
      running: false,
    })

    expect(askButton.label).toBe("Ask 深挖")
    expect(askButton.busy).toBe(false)
    expect(askButton.disabled).toBe(true)
    expect(askButton.ariaLabel).toContain("执行待处理卡片动作")
  })

  it("shows the Ask pending panel immediately after an Ask click before backend stages advance", () => {
    expect(shouldShowAskPendingPanel({
      optimisticPending: true,
      running: false,
      runningStageId: "",
      pendingTitle: "CPO增速放缓可能推动MPO连接器量价齐升",
      hasResult: false,
    })).toBe(true)
  })

  it("does not show the Ask pending panel for unrelated agentic work without an Ask title", () => {
    expect(shouldShowAskPendingPanel({
      running: true,
      runningStageId: "agentic",
      pendingTitle: "",
      hasResult: false,
    })).toBe(false)
  })

  it("hides the Ask pending panel after a result is available", () => {
    expect(shouldShowAskPendingPanel({
      optimisticPending: true,
      hasRunningAskAction: true,
      running: true,
      runningStageId: "agentic",
      pendingTitle: "CPO增速放缓可能推动MPO连接器量价齐升",
      hasResult: true,
    })).toBe(false)
  })

  it("explains when Ask deep-dive is showing a reused recent result", () => {
    const cached = buildAskResultReuseCopy({
      reused: true,
      title: "CPO增速放缓可能推动MPO连接器量价齐升",
      cachedAt: "12:45:20",
      sourceCount: 14,
    })

    expect(cached.show).toBe(true)
    expect(cached.label).toBe("已显示最近 Ask 结果")
    expect(cached.detail).toContain("先复用")
    expect(cached.detail).toContain("CPO增速放缓")
    expect(cached.detail).toContain("缓存时间：12:45:20")
    expect(cached.detail).toContain("上次来源 14 个")
    expect(cached.actionLabel).toBe("重新检索")

    const fresh = buildAskResultReuseCopy({ reused: false })
    expect(fresh.show).toBe(false)
    expect(fresh.actionLabel).toBe("重新检索")
  })

  it("marks cached Ask actions as instant so the operator knows they will not wait", () => {
    const cached = buildAskCacheStatusCopy({
      cached: true,
      cachedAt: "14:20:15",
      sourceCount: 12,
    })

    expect(cached.show).toBe(true)
    expect(cached.badgeLabel).toBe("已缓存 14:20:15")
    expect(cached.actionLabel).toBe("秒开 Ask")
    expect(cached.helper).toContain("秒开上次结果")
    expect(cached.actionTitle).toContain("上次来源 12 个")
    expect(cached.cardHintLabel).toBe("这条信号已 Ask 过")
    expect(cached.cardHintDetail).toContain("上次 Ask 已引用 12 个来源")
    expect(cached.cardHintDetail).toContain("不会重新跑慢检索")
    expect(cached.cardHintAction).toContain("重新检索")

    const fresh = buildAskCacheStatusCopy({ cached: false })
    expect(fresh.show).toBe(false)
    expect(fresh.actionLabel).toBe("Ask 深挖")
    expect(fresh.helper).toContain("首次会调用 ask --agentic")
    expect(fresh.cardHintLabel).toBe("")
  })

  it("marks tracked signal card Ask actions as instant when the exact Ask result is cached", () => {
    const askCacheStatus = buildAskCacheStatusCopy({
      cached: true,
      cachedAt: "14:20:15",
      sourceCount: 12,
    })
    const actions = buildSignalCardActions({
      kind: "tracked",
      canConfirm: false,
      canAsk: true,
      askDeepDiveRecommended: true,
      askCacheStatus,
    })

    expect(actions.primary.kind).toBe("ask")
    expect(actions.primary.label).toBe("秒开 Ask")
    expect(actions.primary.description).toContain("复用最近 Ask 结果")
    expect(actions.primary.description).toContain("上次来源 12 个")

    const askButton = buildSignalCardActionButtonState({
      action: actions.primary,
      running: false,
    })
    expect(askButton.label).toBe("秒开 Ask")
    expect(askButton.title).toContain("复用最近 Ask 结果")

    const panelCopy = buildSignalCardActionPanelCopy(actions)
    expect(panelCopy.label).toBe("主动作：秒开结果")
    expect(panelCopy.detail).toContain("已缓存同一条信号")
  })

  it("uses a short opening-cache label instead of implying a full Ask rerun", () => {
    const actions = buildSignalCardActions({
      kind: "tracked",
      canConfirm: false,
      canAsk: true,
      askCacheStatus: buildAskCacheStatusCopy({
        cached: true,
        cachedAt: "14:20:15",
        sourceCount: 12,
      }),
    })
    const feedback = buildSignalCardActionFeedback({
      action: "ask",
      status: "running",
      title: "CPO增速放缓可能推动MPO连接器量价齐升",
    })

    const askButton = buildSignalCardActionButtonState({
      action: actions.primary,
      feedback,
      running: false,
    })

    expect(askButton.label).toBe("打开缓存中")
    expect(askButton.busy).toBe(true)
    expect(askButton.disabled).toBe(true)
  })

  it("summarizes confirmed status updates before audit paths", () => {
    const copy = buildStatusUpdateNoticeCopy({
      title: "CPO增速放缓可能推动MPO连接器量价齐升",
      previousStatus: "watching",
      newStatus: "strengthening",
      markdownRelativePath: ".llm-wiki/hypotheses/hypo_ai_cpo_mpo.md",
      eventRelativePath: ".llm-wiki/hypothesis-events/2026-06-20.jsonl",
      askRunRef: ".llm-wiki/agent-runs/20260620-ask/manifest.json",
    })

    expect(copy.headline).toContain("已写入正式状态")
    expect(copy.headline).toContain("观察中 -> 证据增强")
    expect(copy.outcomeLabel).toBe("正式状态已更新")
    expect(copy.outcomeDetail).toContain("持久状态")
    expect(copy.outcomeDetail).toContain("观察中")
    expect(copy.detail).toContain("Hypothesis Library")
    expect(copy.detail).toContain("没有写 wiki/raw")
    expect(copy.transitionLabel).toBe("观察中 -> 证据增强")
    expect(copy.storageLine).toContain(".llm-wiki/hypotheses")
    expect(copy.storageLine).toContain(".llm-wiki/hypothesis-events")
    expect(copy.askEvidenceLine).toContain("已关联 Ask 深挖证据")
    expect(copy.askEvidenceLine).toContain(".llm-wiki/agent-runs")
    expect(copy.nextAction).toContain("证据增强")
    expect(copy.nextAction).toContain("Ask 深挖")
    expect(copy.guardrail).toContain("不写正式 wiki/raw")
    expect(copy.guardrail).toContain("不触发真实交易")
    expect(copy.hypothesisPath).toContain("hypo_ai_cpo_mpo")
    expect(copy.eventPath).toContain("hypothesis-events")
  })

  it("makes no-change status confirmations explicit instead of implying a migration", () => {
    const copy = buildStatusUpdateNoticeCopy({
      title: "CPO增速放缓可能推动MPO连接器量价齐升",
      previousStatus: "watching",
      newStatus: "watching",
      markdownRelativePath: ".llm-wiki/hypotheses/hypo_ai_cpo_mpo.md",
      eventRelativePath: ".llm-wiki/hypothesis-events/2026-06-20.jsonl",
    })

    expect(copy.headline).toContain("状态未变化")
    expect(copy.outcomeLabel).toBe("状态未变化")
    expect(copy.outcomeDetail).toContain("当前已经是“观察中”")
    expect(copy.outcomeDetail).toContain("不代表新的状态迁移")
    expect(copy.detail).toContain("没有写 wiki/raw")
    expect(copy.transitionLabel).toBe("观察中")
    expect(copy.storageLine).toContain(".llm-wiki/hypotheses")
    expect(copy.storageLine).toContain(".llm-wiki/hypothesis-events")
  })

  it("makes confirm the primary action on status-changing tracked cards", () => {
    const actions = buildSignalCardActions({
      kind: "tracked",
      canConfirm: true,
      canAsk: true,
      askDeepDiveRecommended: true,
    })

    expect(actions.primary.kind).toBe("confirm")
    expect(actions.primary.label).toBe("确认状态")
    expect(actions.primary.description).toContain("写入假设记忆")
    expect(actions.primary.description).toContain("不写 wiki/raw")
    expect(actions.primary.ariaLabel).toContain("不写 wiki/raw")
    expect(actions.primary.variant).toBe("default")
    expect(actions.secondary.map((action) => action.kind)).toEqual(["ask", "ignore"])
  })

  it("explains the primary card action before the user clicks", () => {
    const confirmCopy = buildSignalCardActionPanelCopy(buildSignalCardActions({
      kind: "tracked",
      canConfirm: true,
      canAsk: true,
    }))
    expect(confirmCopy).toMatchObject({
      label: "主动作：确认状态",
      tone: "action",
    })
    expect(confirmCopy.actionLine).toBe("现在该做：确认状态；确认后写入假设记忆。")
    expect(confirmCopy.detail).toContain("不写 wiki/raw")

    const askCopy = buildSignalCardActionPanelCopy(buildSignalCardActions({
      kind: "tracked",
      canConfirm: false,
      canAsk: true,
    }))
    expect(askCopy.label).toBe("主动作：先研究")
    expect(askCopy.actionLine).toBe("现在该做：Ask 深挖；先看股票、链条、来源和利好排序。")
    expect(askCopy.detail).toContain("关联股票")
    expect(askCopy.detail).toContain("Ask 结果区")
    expect(askCopy.tone).toBe("research")

    const trackCopy = buildSignalCardActionPanelCopy(buildSignalCardActions({
      kind: "candidate",
      askDeepDiveRecommended: false,
    }))
    expect(trackCopy.label).toBe("主动作：加入跟踪")
    expect(trackCopy.actionLine).toBe("现在该做：加入跟踪；后续用新增资料继续验证。")
    expect(trackCopy.detail).toContain("继续跟踪")
    expect(trackCopy.tone).toBe("track")

    const ignoreCopy = buildSignalCardActionPanelCopy(buildSignalCardActions({
      kind: "tracked",
      canConfirm: false,
      canAsk: false,
    }))
    expect(ignoreCopy.label).toBe("低优先级：可忽略")
    expect(ignoreCopy.actionLine).toBe("现在该做：本轮忽略；不改变假设状态。")
    expect(ignoreCopy.detail).toContain("不改变假设状态")
    expect(ignoreCopy.tone).toBe("quiet")
  })

  it("makes Ask the primary action when a tracked card needs research before status change", () => {
    const actions = buildSignalCardActions({
      kind: "tracked",
      canConfirm: false,
      canAsk: true,
      askDeepDiveRecommended: true,
    })

    expect(actions.primary.kind).toBe("ask")
    expect(actions.primary.label).toBe("Ask 深挖")
    expect(actions.primary.description).toContain("关联股票")
    expect(actions.primary.description).toContain("利好排序")
    expect(actions.secondary.map((action) => action.kind)).toEqual(["ignore"])
  })

  it("makes ignore the primary action for weak tracked cards with no available research action", () => {
    const actions = buildSignalCardActions({
      kind: "tracked",
      canConfirm: false,
      canAsk: false,
      askDeepDiveRecommended: false,
    })

    expect(actions.primary.kind).toBe("ignore")
    expect(actions.primary.label).toBe("本轮忽略")
    expect(actions.secondary).toHaveLength(0)
  })

  it("prioritizes Ask precheck for candidate cards that look worth researching", () => {
    const actions = buildSignalCardActions({
      kind: "candidate",
      askDeepDiveRecommended: true,
    })

    expect(actions.primary.kind).toBe("precheck")
    expect(actions.primary.label).toBe("Ask 预检")
    expect(actions.primary.description).toContain("不加入跟踪")
    expect(actions.primary.description).toContain("再决定")
    expect(actions.secondary.map((action) => action.kind)).toEqual(["track", "ignore"])
  })

  it("keeps low-conviction candidate cards as deliberate tracking decisions", () => {
    const actions = buildSignalCardActions({
      kind: "candidate",
      askDeepDiveRecommended: false,
    })

    expect(actions.primary.kind).toBe("track")
    expect(actions.primary.label).toBe("加入跟踪")
    expect(actions.primary.description).toContain("加入跟踪表")
    expect(actions.primary.description).toContain("新增资料")
    expect(actions.primary.description).not.toContain("微信和新增资料")
    expect(actions.secondary.map((action) => action.kind)).toEqual(["precheck", "ignore"])
  })

  it("turns no-wiki candidate Ask actions into precheck before tracking", () => {
    const noWikiSummary = buildSignalDecisionSummary({
      kind: "candidate",
      askDeepDiveRecommended: true,
      relatedWikiCount: 0,
      evidenceDelta: "catalyst_signal",
      signalType: "新催化",
    })

    expect(noWikiSummary.headline).toBe("候选新假设，先 Ask 预检")
    expect(noWikiSummary.next).toContain("不写入假设库")
  })

  it("builds no-wiki hypothesis Ask queries as framework-building research tasks", () => {
    const action = buildHypothesisAskActionLabel({
      relatedWikiCount: 0,
      signalType: "新催化",
      sourceExcerpt: "光纤/光通信上游涨价+供需紧俏。",
    })
    const query = buildHypothesisAskQuery(
      {
        title: "光纤/光通信上游涨价+供需紧俏",
        theme: "AI数据中心互联",
        segments: ["光纤", "光通信"],
        status: "watching",
      },
      {
        relatedWikiCount: 0,
        signalType: "新催化",
        tradingImplication: "价格类新催化，建议 Ask 深挖受益链条。",
        sourceExcerpt: "光纤/光通信上游涨价+供需紧俏，命中群：3。",
      },
    )

    expect(action.label).toBe("Ask 建框架")
    expect(action.title).toContain("没有强 wiki 回连")
    expect(query).toContain("没有强 wiki 回连")
    expect(query).toContain("主题框架")
    expect(query).toContain("候选股票")
    expect(query).toContain("新增信号摘录")
    expect(query.length).toBeLessThanOrEqual(983)
  })

  it("keeps normal hypothesis Ask actions as deep dives when wiki backlinks exist", () => {
    const action = buildHypothesisAskActionLabel({
      relatedWikiCount: 2,
      signalType: "新催化",
      sourceExcerpt: "已有 MPO 与 CPO 框架页回连。",
    })

    expect(action.label).toBe("Ask 深挖")
    expect(action.title).toContain("关联股票")
  })

  it("carries matched wiki frontmatter into hypothesis Ask queries", () => {
    const query = buildHypothesisAskQuery(
      {
        title: "CPO增速放缓可能推动MPO连接器量价齐升",
        theme: "AI数据中心互联",
        segments: ["MPO", "CPO", "高速连接器"],
        status: "watching",
      },
      {
        relatedWikiCount: 1,
        relatedWikiPages: [{
          title: "AI数据中心互联",
          matchedTerms: ["MPO", "CPO节奏放缓"],
          wikiMeta: {
            status: "活跃",
            confidence: "高",
            momentum: "热",
            tags: ["CPO", "MPO", "高速连接器"],
            catalysts: ["CPO节奏放缓", "MPO跳线需求"],
            summary: "跟踪 CPO 节奏变化、MPO 连接器订单和高速互联量价反馈。",
          },
        }],
        signalType: "新催化",
        evidenceDelta: "catalyst_signal",
      },
    )

    expect(query).toContain("wiki表头框架")
    expect(query).toContain("AI数据中心互联")
    expect(query).toContain("活跃")
    expect(query).toContain("高置信")
    expect(query).toContain("MPO")
    expect(query).toContain("wiki表头动作")
    expect(query).toContain("Ask 深挖")
  })

  it("builds candidate Ask precheck queries without turning candidates into tracked hypotheses", () => {
    const query = buildCandidateAskPrecheckQuery({
      title: "健滔涨价函可能推动 CCL 链条量价重估",
      theme: "AI服务器材料",
      segments: ["CCL", "覆铜板"],
      timeHorizon: "未来1-3个月",
      signalType: "新催化",
      tradingImplication: "先看涨价传导和下游 PCB 扩散。",
      reason: "微信舆情出现健滔涨价函。",
      sourceExcerpt: "健滔集团覆铜板涨价函流传，AI 高频材料需求较强。",
      sourceRef: ".llm-wiki/wechat-inbox/processed/2026-06-19.jsonl#msg:raw:aaa:bbb",
      relatedWikiCount: 0,
    })

    expect(query).toContain("Ask 预检")
    expect(query).toContain("不要把它当作已入池假设")
    expect(query).toContain("是否建议加入跟踪")
    expect(query).toContain("当前没有强 wiki 回连")
    expect(query).toContain("健滔涨价函")
    expect(query.length).toBeLessThanOrEqual(983)
  })

  it("shows candidate precheck adoption as a human-confirmed write action", () => {
    const pending = buildCandidatePrecheckAdoptionCopy({
      isPrecheck: true,
      hasCandidate: true,
    })

    expect(pending.subtitle).toContain("仍未入池")
    expect(pending.canAdopt).toBe(true)
    expect(pending.canScan).toBe(false)
    expect(pending.detail).toContain("不写 wiki/raw")

    const adopted = buildCandidatePrecheckAdoptionCopy({
      isPrecheck: true,
      hasCandidate: false,
      adoptedId: "hypo_ccl_price_1234",
    })

    expect(adopted.subtitle).toContain("已加入跟踪")
    expect(adopted.canAdopt).toBe(false)
    expect(adopted.canScan).toBe(true)
    expect(adopted.adoptedLabel).toBe("已采纳：hypo_ccl_price_1234")
    expect(adopted.detail).toContain("人工确认")
  })

  it("labels catalyst wiki matches as a catalyst backlink instead of generic relevance", () => {
    const summary = buildRelatedWikiSummary({
      evidenceDelta: "catalyst_signal",
      signalType: "新催化",
      pages: [
        { title: "AIDC电源", sourceRef: "wiki/概念/AIDC电源.md", matchedTerms: ["SST"] },
        { title: "AI服务器供电链", sourceRef: "wiki/概念/AI服务器供电链.md", matchedTerms: ["SST", "HVDC"] },
      ],
    })

    expect(summary.label).toBe("催化回连")
    expect(summary.tone).toBe("catalyst")
    expect(summary.countText).toBe("2 个 wiki")
    expect(summary.topTerms).toBe("SST/HVDC")
    expect(summary.summary).toContain("新增催化")
  })

  it("summarizes finance entity keyword matches for PM-facing signal cards", () => {
    const line = buildSignalKeywordLine({
      segments: ["铜箔", "极低轮廓铜箔", "批量订单", "诺德股份"],
      keyVariables: ["价格函"],
      relatedWikiPages: [
        {
          title: "材料瓶颈页面",
          sourceRef: "wiki/概念/材料瓶颈页面.md",
          matchedTerms: ["极低轮廓铜箔", "批量订单"],
          financeAuditMatchedTerms: ["极低轮廓铜箔"],
        },
      ],
    })

    expect(line.show).toBe(true)
    expect(line.label).toBe("命中关键词")
    expect(line.tone).toBe("finance")
    expect(line.terms).toEqual(["极低轮廓铜箔", "批量订单", "诺德股份", "价格函"])
    expect(line.layers).toEqual([
      { label: "原文/假设词", terms: ["诺德股份", "价格函"], tone: "source" },
      { label: "wiki表头/页面", terms: ["批量订单"], tone: "wiki" },
      { label: "SAG金融词", terms: ["极低轮廓铜箔"], tone: "finance" },
    ])
    expect(line.detail).toContain("SAG 金融词表")
  })

  it("summarizes finance entity types as trading-desk tags for signal cards", () => {
    const strip = buildSignalFinanceEntityStrip([
      {
        sourceRef: "wiki/概念/AI数据中心互联.md",
        financeAuditMatchedEntities: [
          { term: "中际旭创", type: "stock" },
          { term: "MPO", type: "product_line" },
          { term: "CPO", type: "tech_route" },
          { term: "涨价函", type: "catalyst" },
          { term: "订单兑现", type: "metric" },
        ],
      },
    ])

    expect(strip.show).toBe(true)
    expect(strip.label).toBe("项目金融词")
    expect(strip.detail).toContain("股票 中际旭创")
    expect(strip.detail).toContain("产品线 MPO")
    expect(strip.detail).toContain("技术路线 CPO")
    expect(strip.groups.map((group) => `${group.label}:${group.terms.join("/")}`)).toEqual([
      "股票:中际旭创",
      "产品线:MPO",
      "技术路线:CPO",
      "催化:涨价函",
      "指标:订单兑现",
    ])
    expect(strip.headline).toBe("中际旭创 / MPO / CPO / 涨价函")
    expect(strip.actionLabel).toBe("Ask 排序")
  })

  it("builds compact finance entity header cues for PM signal cards", () => {
    const cue = buildSignalFinanceHeaderCue([
      {
        financeAuditMatchedEntities: [
          { term: "健滔", type: "company" },
          { term: "CCL", type: "product_line" },
          { term: "低损耗树脂", type: "product_line" },
          { term: "涨价函", type: "catalyst" },
          { term: "订单未兑现", type: "risk_factor" },
          { term: "2026-06-24", type: "time" },
        ],
      },
    ])

    expect(cue.show).toBe(true)
    expect(cue.headline).toBe("风险：订单未兑现")
    expect(cue.actionLabel).toBe("先反证")
    expect(cue.chips.map((chip) => `${chip.label}:${chip.value}`)).toEqual([
      "公司:健滔",
      "产品线:CCL/低损耗树脂",
      "催化:涨价函",
      "风险因子:订单未兑现",
    ])
    expect(cue.ariaLabel).toContain("公司 健滔")
    expect(cue.ariaLabel).not.toContain("2026-06-24")
  })

  it("hides compact finance header cues for weak source/date-only hits", () => {
    const cue = buildSignalFinanceHeaderCue([
      {
        financeAuditMatchedEntities: [
          { term: "2026-06-24", type: "time" },
          { term: "微信", type: "source" },
        ],
      },
    ])

    expect(cue.show).toBe(false)
    expect(cue.chips).toEqual([])
  })

  it("normalizes raw finance keyword type labels from the SAG project audit table", () => {
    const strip = buildSignalFinanceEntityStrip([
      {
        financeAuditMatchedEntities: [
          { term: "MPO", type: "product_line", label: "product_line" },
          { term: "CPO", type: "tech_route", label: "tech_route" },
          { term: "涨价函", type: "catalyst", label: "catalyst" },
          { term: "订单未兑现", type: "risk_factor", label: "risk_factor" },
        ],
      },
    ])

    expect(strip.show).toBe(true)
    expect(strip.label).toBe("项目金融词")
    expect(strip.detail).toContain("产品线 MPO")
    expect(strip.detail).toContain("技术路线 CPO")
    expect(strip.detail).toContain("催化 涨价函")
    expect(strip.detail).toContain("风险因子 订单未兑现")
    expect(strip.detail).not.toContain("product_line")
    expect(strip.detail).not.toContain("tech_route")
  })

  it("hides finance entity tags when a scan only hits weak source or date terms", () => {
    const strip = buildSignalFinanceEntityStrip([
      {
        financeAuditMatchedEntities: [
          { term: "2026-06-19", type: "time" },
          { term: "微信", type: "source" },
        ],
      },
    ])

    expect(strip.show).toBe(false)
    expect(strip.groups).toEqual([])
  })

  it("reads direct Watchtower finance entities even before a wiki page is attached", () => {
    const strip = buildSignalFinanceEntityStrip({
      financeAuditMatchedEntities: [
        { term: "健滔", type: "company" },
        { term: "CCL", type: "product_line" },
        { term: "低损耗树脂", type: "product_line" },
        { term: "CPO", type: "tech_route" },
        { term: "MPO", type: "product_line" },
        { term: "涨价函", type: "catalyst" },
      ],
    })

    expect(strip.show).toBe(true)
    expect(strip.detail).toContain("公司 健滔")
    expect(strip.detail).toContain("产品线 CCL")
    expect(strip.detail).toContain("低损耗树脂")
    expect(strip.detail).toContain("技术路线 CPO")
    expect(strip.detail).toContain("催化 涨价函")
    expect(strip.decision).toContain("健滔")
    expect(strip.decision).toContain("CCL")
  })

  it("clusters repeated Watchtower cards by hypothesis and evidence delta despite label jitter", () => {
    const ruleCard = {
      id: "event-1",
      hypothesisId: "hypo_cpo_mpo",
      hypothesisTitle: "CPO增速放缓可能推动MPO连接器量价齐升",
      evidenceDelta: "catalyst_signal",
      signalType: "新催化",
      suggestedStatus: "watching",
      sourceHash: "same-source",
      sourceRef: ".llm-wiki/wechat-inbox/processed/2026-06-19.jsonl#msg:1",
    }
    const llmCard = {
      id: "alert-1",
      hypothesisId: "hypo_cpo_mpo",
      hypothesisTitle: "CPO增速放缓可能推动MPO连接器量价齐升",
      evidenceDelta: "catalyst_signal",
      signalType: "叙事扩散",
      suggestedStatus: "strengthening",
      sourceHash: "same-source",
      sourceRef: ".llm-wiki/wechat-inbox/processed/2026-06-19.jsonl#msg:1",
    }

    expect(buildSignalTodoSourceKey(ruleCard)).toBe(buildSignalTodoSourceKey(llmCard))
    expect(buildSignalTodoClusterKey(ruleCard)).toBe(buildSignalTodoClusterKey(llmCard))
    expect(buildSignalTodoClusterKey({ ...llmCard, evidenceDelta: "counter_signal" }))
      .not.toBe(buildSignalTodoClusterKey(ruleCard))
  })

  it("clusters no-change soft Watchtower cards into one PM todo while preserving hard actions", () => {
    const narrativeCard = {
      hypothesisId: "hypo_cpo_mpo",
      hypothesisTitle: "CPO增速放缓可能推动MPO连接器量价齐升",
      evidenceDelta: "narrative_expansion",
      signalType: "叙事扩散",
      statusBefore: "watching",
      suggestedStatus: "watching",
      sourceHash: "source-a",
      sourceRef: ".llm-wiki/wechat-inbox/processed/2026-06-19.jsonl#msg:a",
    }
    const catalystCard = {
      hypothesisId: "hypo_cpo_mpo",
      hypothesisTitle: "CPO增速放缓可能推动MPO连接器量价齐升",
      evidenceDelta: "catalyst_signal",
      signalType: "新催化",
      statusBefore: "watching",
      suggestedStatus: "watching",
      sourceHash: "source-b",
      sourceRef: ".llm-wiki/wechat-inbox/processed/2026-06-19.jsonl#msg:b",
    }
    const hardCard = {
      ...catalystCard,
      evidenceDelta: "fundamental_delivery",
      signalType: "硬证据",
      suggestedStatus: "strengthening",
      sourceHash: "source-c",
    }

    expect(buildSignalTodoClusterKey(narrativeCard)).toBe(buildSignalTodoClusterKey(catalystCard))
    expect(buildSignalTodoClusterKey(hardCard)).not.toBe(buildSignalTodoClusterKey(catalystCard))
  })

  it("merges duplicated Watchtower cards while keeping the stronger status and finance context", () => {
    const merged = mergeSignalTodoRecord(
      {
        hypothesisId: "hypo_cpo_mpo",
        evidenceDelta: "catalyst_signal",
        suggestedStatus: "watching",
        signalType: "叙事扩散",
        createdAt: "2026-06-19T09:00:00.000Z",
        reason: "旧的弱提示，不应该覆盖 LLM 复核后的新解释。",
        evidenceGaps: ["market:volume_price_confirmation:not_checked"],
        relatedWikiPages: [{
          sourceRef: "wiki/概念/CPO.md",
          score: 0.6,
          financeAuditMatchedEntities: [{ term: "CPO", type: "tech_route" }],
        }],
      },
      {
        hypothesisId: "hypo_cpo_mpo",
        evidenceDelta: "catalyst_signal",
        suggestedStatus: "strengthening",
        signalType: "新催化",
        createdAt: "2026-06-19T09:05:00.000Z",
        suggestedStatusReason: "fresh tradable catalyst appeared; track price/volume follow-through before demanding fundamental closure",
        reason: "CPO 放缓的新上下文已经命中 MPO 假设，应先看关联股票和量价扩散。",
        askDeepDiveRecommended: true,
        evidenceGaps: ["fundamental:orders:not_checked"],
        relatedWikiPages: [{
          sourceRef: "wiki/概念/CPO.md",
          score: 0.9,
          financeAuditMatchedEntities: [{ term: "MPO", type: "product_line" }],
        }],
      },
    )

    expect(merged.suggestedStatus).toBe("strengthening")
    expect(merged.signalType).toBe("新催化")
    expect(merged.askDeepDiveRecommended).toBe(true)
    expect(merged.createdAt).toBe("2026-06-19T09:05:00.000Z")
    expect(merged.mergedCount).toBe(2)
    expect(merged.suggestedStatusReason).toContain("fresh tradable catalyst")
    expect(merged.reason).toBe("CPO 放缓的新上下文已经命中 MPO 假设，应先看关联股票和量价扩散。")
    expect(merged.evidenceGaps).toEqual(expect.arrayContaining([
      "market:volume_price_confirmation:not_checked",
      "fundamental:orders:not_checked",
    ]))
    expect(merged.relatedWikiPages).toHaveLength(1)
    expect(merged.relatedWikiPages[0]).toMatchObject({
      sourceRef: "wiki/概念/CPO.md",
      score: 0.9,
    })
    expect(merged.relatedWikiPages[0].financeAuditMatchedEntities).toEqual(expect.arrayContaining([
      { term: "CPO", type: "tech_route" },
      { term: "MPO", type: "product_line" },
    ]))
  })

  it("clusters candidate hypotheses into PM work cards by wiki frame and signal type", () => {
    const cpoOrderCandidate = {
      title: "新催化：CPO放缓可能推动MPO连接器订单",
      theme: "AI数据中心互联",
      segments: ["MPO", "CPO"],
      evidenceDelta: "catalyst_signal",
      signalType: "新催化",
      askDeepDiveRecommended: true,
      priorityScore: 18,
      clusterSourceCount: 1,
      sourceRefs: [".llm-wiki/wechat-inbox/processed/2026-06-22.jsonl#msg:a"],
      financeSignalEntities: [
        { term: "MPO", type: "product_line", label: "产品线" },
        { term: "CPO", type: "tech_route", label: "技术路线" },
      ],
      relatedWikiPages: [{
        sourceRef: "wiki/概念/光互联Scale-Up-十年大周期.md",
        title: "光互联Scale-Up-十年大周期",
        score: 12,
        financeAuditMatchedEntities: [
          { term: "MPO", type: "product_line", label: "产品线" },
          { term: "CPO", type: "tech_route", label: "技术路线" },
        ],
        wikiMeta: { status: "活跃", momentum: "热" },
      }],
    }
    const cpoPriceCandidate = {
      title: "新催化：MPO跳线价格弹性继续扩散",
      theme: "AI数据中心互联",
      segments: ["MPO", "高速连接器"],
      evidenceDelta: "catalyst_signal",
      signalType: "新催化",
      priorityScore: 10,
      clusterSourceCount: 1,
      sourceRefs: [".llm-wiki/wechat-inbox/processed/2026-06-22.jsonl#msg:b"],
      financeSignalEntities: [
        { term: "MPO跳线", type: "product_line", label: "产品线" },
        { term: "价格弹性", type: "catalyst", label: "催化" },
      ],
      relatedWikiPages: [{
        sourceRef: "wiki/概念/光互联Scale-Up-十年大周期.md",
        title: "光互联Scale-Up-十年大周期",
        score: 8,
        financeAuditMatchedEntities: [
          { term: "MPO跳线", type: "product_line", label: "产品线" },
        ],
        wikiMeta: { status: "活跃", momentum: "热" },
      }],
    }
    const pcbCandidate = {
      title: "新催化：PCB层压机交期拉长",
      theme: "AI服务器PCB",
      segments: ["PCB", "层压机"],
      evidenceDelta: "catalyst_signal",
      signalType: "新催化",
      priorityScore: 12,
      relatedWikiPages: [{
        sourceRef: "wiki/概念/PCB半导体化设备耗材链.md",
        title: "PCB半导体化设备耗材链",
        score: 10,
        wikiMeta: { status: "活跃", momentum: "热" },
      }],
    }

    const clusters = buildCandidateSignalClusters([cpoPriceCandidate, pcbCandidate, cpoOrderCandidate])

    expect(clusters).toHaveLength(2)
    expect(clusters[0]).toMatchObject({
      title: "新催化：CPO放缓可能推动MPO连接器订单",
      theme: "AI数据中心互联",
      evidenceDelta: "catalyst_signal",
      signalType: "新催化",
      askDeepDiveRecommended: true,
      clusterCandidateCount: 2,
      clusterSourceCount: 2,
      segments: expect.arrayContaining(["MPO", "CPO", "高速连接器"]),
      sourceRefs: expect.arrayContaining([
        ".llm-wiki/wechat-inbox/processed/2026-06-22.jsonl#msg:a",
        ".llm-wiki/wechat-inbox/processed/2026-06-22.jsonl#msg:b",
      ]),
      financeSignalEntities: expect.arrayContaining([
        expect.objectContaining({ term: "MPO", type: "product_line" }),
        expect.objectContaining({ term: "MPO跳线", type: "product_line" }),
      ]),
    })
    expect(clusters[0].relatedWikiPages).toHaveLength(1)
    expect(clusters[1]).toMatchObject({
      title: "新催化：PCB层压机交期拉长",
      clusterCandidateCount: 1,
    })
  })

  it("builds an Alpha Feed summary that caps the default PM inbox and folds noise", () => {
    const summary = buildAlphaFeedSummary({
      visibleLimit: 9,
      items: [
        { key: "confirm", kind: "tracked", title: "健滔涨价函推动CCL量价重估", priority: true, canConfirm: true, score: 20 },
        { key: "ask", kind: "tracked", title: "CPO节奏放缓推动MPO订单弹性", priority: true, askDeepDiveRecommended: true, score: 19 },
        { key: "hard", kind: "tracked", title: "CoWoS扩产推动设备材料订单", priority: true, evidenceDelta: "fundamental_delivery", score: 18 },
        { key: "market", kind: "tracked", title: "玻璃基板扩散到设备材料链", priority: true, evidenceDelta: "market_feedback", score: 17 },
        { key: "candidate", kind: "candidate", title: "高速PCB上游涨价扩散", priority: true, askDeepDiveRecommended: true, score: 16 },
        { key: "overflow", kind: "tracked", title: "低空经济材料链观察", priority: true, score: 15 },
        { key: "quiet-a", kind: "tracked", title: "日期噪声", priority: false, score: 1 },
        { key: "quiet-b", kind: "candidate", title: "弱候选", priority: false, score: 1 },
      ],
    })

    expect(summary.visibleLimit).toBe(5)
    expect(summary.title).toBe("今日优先 5 条")
    expect(summary.todayPriorityCount).toBe(6)
    expect(summary.priorityVisibleCount).toBe(5)
    expect(summary.askCount).toBe(2)
    expect(summary.confirmCount).toBe(1)
    expect(summary.foldedNoiseCount).toBe(2)
    expect(summary.foldedOverflowCount).toBe(1)
    expect(summary.totalFoldedCount).toBe(3)
    expect(summary.badges.map((badge) => `${badge.label}:${badge.value}`)).toEqual([
      "今日优先:6",
      "需要 Ask:2",
      "建议确认:1",
      "已折叠噪声:2",
    ])
  })

  it("explains when Alpha Feed only has quiet low-priority signals", () => {
    const summary = buildAlphaFeedSummary({
      visibleLimit: 4,
      items: [
        { key: "quiet-a", kind: "tracked", title: "普通聊天扩散", priority: false, score: 1 },
        { key: "quiet-b", kind: "candidate", title: "泛主题候选", priority: false, score: 1 },
      ],
    })

    expect(summary.title).toBe("今天主要是低优先级噪声")
    expect(summary.hasPriority).toBe(false)
    expect(summary.priorityVisibleCount).toBe(0)
    expect(summary.foldedNoiseCount).toBe(2)
    expect(summary.subtitle).toContain("低优先级信号先折叠")
  })

  it("labels signal layers while keeping hypothesis status changes conservative", () => {
    const catalyst = buildSignalLayerBrief({ signalType: "新催化", evidenceDelta: "catalyst_signal", suggestedStatus: "watching" })
    expect(catalyst).toMatchObject({
      level: "L0",
      label: "新催化",
      tone: "catalyst",
    })
    expect(catalyst.conservativeStatusHint).toContain("默认保持 watching")

    const confirmation = buildSignalLayerBrief({ signalType: "二次确认", evidenceDelta: "supporting_signal", suggestedStatus: "strengthening" })
    expect(confirmation).toMatchObject({
      level: "L1",
      label: "二次确认",
      tone: "confirm",
    })
    expect(confirmation.conservativeStatusHint).toContain("不直接 actionable")

    const market = buildSignalLayerBrief({ signalType: "市场反馈", evidenceDelta: "market_feedback", suggestedStatus: "priced_in" })
    expect(market).toMatchObject({
      level: "L2",
      label: "市场反馈",
      tone: "market",
    })
    expect(market.detail).toContain("priced-in")
    expect(market.conservativeStatusHint).toContain("不要把上涨直接当兑现")

    const evidence = buildSignalLayerBrief({ signalType: "硬证据", evidenceDelta: "fundamental_delivery", suggestedStatus: "actionable" })
    expect(evidence).toMatchObject({
      level: "L3",
      label: "硬证据",
      tone: "evidence",
    })
    expect(evidence.detail).toContain("订单")
    expect(evidence.conservativeStatusHint).toContain("人工确认")

    const risk = buildSignalLayerBrief({ signalType: "反证", evidenceDelta: "counter_signal", suggestedStatus: "disconfirmed" })
    expect(risk).toMatchObject({
      level: "L2",
      label: "风险信号",
      tone: "risk",
    })
    expect(risk.conservativeStatusHint).toContain("人工确认")
  })

  it("turns wiki frontmatter into PM-facing metadata badges", () => {
    const badges = buildWikiMetaBadges([
      {
        title: "AI数据中心互联",
        wikiMeta: {
          type: "概念",
          status: "活跃",
          confidence: "中",
          momentum: "热",
          updated: "2026-06-20 04:35:00",
          catalysts: ["CPO节奏放缓", "MPO跳线需求"],
          sources: ["raw/微信聊天/2026-06-19.md"],
          summary: "数据中心互联页沉淀 CPO、MPO、高速连接器和 Scale-Up 网络的订单、量价和交付验证线索。",
        },
      },
    ])

    expect(badges.map((item) => item.label)).toEqual([
      "概念",
      "活跃",
      "中置信",
      "热",
      "更新 2026-06-20",
      "催化 2",
    ])
    expect(badges[4].title).toContain("wiki 最近更新")
    expect(badges[5].title).toContain("CPO节奏放缓")
  })

  it("explains which wiki header fields matched the signal", () => {
    const explanation = buildWikiFrameMatchExplanation([
      {
        title: "AI数据中心互联",
        matchedTerms: ["CPO", "MPO", "光纤跳线"],
        financeAuditMatchedTerms: ["MPO"],
        wikiMeta: {
          tags: ["CPO", "MPO", "高速连接器"],
          aliases: ["AI互联链"],
          related: ["Scale-Up", "光纤跳线"],
          catalysts: ["CPO节奏放缓", "MPO跳线需求"],
          sources: ["raw/微信聊天/2026-06-19.md"],
        },
      },
    ])

    expect(explanation.show).toBe(true)
    expect(explanation.headline).toContain("命中表头")
    expect(explanation.fields.map((field) => field.label)).toEqual(expect.arrayContaining(["标签", "催化", "相关页"]))
    expect(explanation.fields.find((field) => field.label === "标签")?.terms).toEqual(expect.arrayContaining(["CPO", "MPO"]))
    expect(explanation.fields.find((field) => field.label === "催化")?.terms.join("/")).toContain("CPO节奏放缓")
    expect(explanation.fields.find((field) => field.label === "相关页")?.terms).toEqual(expect.arrayContaining(["光纤跳线"]))
    expect(explanation.detail).toContain("标签")
  })

  it("turns wiki frontmatter into a PM-facing decision line", () => {
    const line = buildWikiFrameDecisionLine({
      pages: [{
        title: "AI数据中心互联",
        wikiMeta: {
          status: "活跃",
          confidence: "中",
          momentum: "热",
          updated: "2026-06-20",
          catalysts: ["CPO节奏放缓", "MPO跳线需求"],
          summary: "沉淀 CPO、MPO、高速连接器和 Scale-Up 网络的订单、量价和交付验证线索。",
        },
      }],
      evidenceDelta: "catalyst_signal",
      signalType: "新催化",
      askDeepDiveRecommended: true,
    })

    expect(line.show).toBe(true)
    expect(line.headline).toContain("AI数据中心互联")
    expect(line.headline).toContain("活跃框架")
    expect(line.detail).toContain("订单、量价和交付")
    expect(line.next).toContain("Ask 深挖")
    expect(line.tone).toBe("hot")
    expect(line.badges.map((item) => item.label)).toEqual(expect.arrayContaining([
      "活跃",
      "中置信",
      "热",
      "更新 2026-06-20",
      "催化 2",
    ]))
  })

  it("prefers the active wiki header when multiple related frames are matched", () => {
    const pages = [
      {
        title: "旧CPO框架",
        score: 30,
        wikiMeta: {
          status: "归档",
          momentum: "冷",
          summary: "历史框架，不再主动跟踪。",
        },
      },
      {
        title: "AI数据中心互联",
        score: 12,
        wikiMeta: {
          status: "活跃",
          confidence: "中",
          momentum: "热",
          updated: "2026-06-21",
          catalysts: ["MPO跳线需求"],
          summary: "当前框架，跟踪 CPO 节奏变化、MPO 连接器订单和高速互联量价反馈。",
        },
      },
    ]

    const line = buildWikiFrameDecisionLine({
      pages,
      evidenceDelta: "catalyst_signal",
      signalType: "新催化",
    })
    const badges = buildWikiMetaBadges(pages)

    expect(line.headline).toContain("AI数据中心互联")
    expect(line.headline).not.toContain("旧CPO框架")
    expect(line.detail).toContain("MPO 连接器订单")
    expect(line.tone).toBe("hot")
    expect(badges.map((item) => item.label)).toEqual(expect.arrayContaining(["活跃", "中置信", "热"]))
    expect(badges.map((item) => item.label)).not.toContain("归档")
    expect(line.badges.map((item) => item.label)).toEqual(expect.arrayContaining(["更新 2026-06-21", "催化 1"]))
  })

  it("warns when a signal only connects to a stale wiki frame", () => {
    const line = buildWikiFrameDecisionLine({
      pages: [{
        title: "旧CPO框架",
        wikiMeta: {
          status: "归档",
          momentum: "冷",
          summary: "历史框架，不再主动跟踪。",
        },
      }],
      evidenceDelta: "narrative_expansion",
      signalType: "叙事扩散",
    })

    expect(line.show).toBe(true)
    expect(line.headline).toContain("旧CPO框架")
    expect(line.next).toContain("不要直接升级")
    expect(line.tone).toBe("stale")
  })

  it("compresses active wiki headers into a first-look signal card cue", () => {
    const line = buildWikiFrameDecisionLine({
      pages: [{
        title: "AI数据中心互联",
        financeAuditMatchedTerms: ["MPO", "高速连接器"],
        wikiMeta: {
          status: "活跃",
          confidence: "高",
          momentum: "热",
          updated: "2026-06-21",
          tags: ["CPO", "MPO", "高速连接器"],
          catalysts: ["CPO节奏放缓", "MPO跳线需求"],
          summary: "当前框架，跟踪 CPO 节奏变化、MPO 连接器订单和高速互联量价反馈。",
        },
      }],
      evidenceDelta: "catalyst_signal",
      signalType: "新催化",
      askDeepDiveRecommended: true,
    })

    const copy = buildWikiFrameFirstLookCopy(line)

    expect(copy.show).toBe(true)
    expect(copy.label).toBe("热框架")
    expect(copy.detail).toContain("AI数据中心互联")
    expect(copy.detail).toContain("活跃")
    expect(copy.detail).toContain("高置信")
    expect(copy.detail).toContain("MPO")
    expect(copy.next).toContain("Ask 深挖")
    expect(copy.tone).toBe("hot")
  })

  it("keeps stale wiki headers cautious in the first-look cue", () => {
    const line = buildWikiFrameDecisionLine({
      pages: [{
        title: "旧CPO框架",
        wikiMeta: {
          status: "归档",
          momentum: "冷",
          summary: "历史框架，不再主动跟踪。",
        },
      }],
      evidenceDelta: "narrative_expansion",
      signalType: "叙事扩散",
    })

    const copy = buildWikiFrameFirstLookCopy(line)

    expect(copy.show).toBe(true)
    expect(copy.label).toBe("旧框架复核")
    expect(copy.detail).toContain("旧CPO框架")
    expect(copy.next).toContain("不要直接升级")
    expect(copy.tone).toBe("stale")
  })

  it("summarizes hypothesis table priority from state, signal, and wiki headers", () => {
    const confirm = buildHypothesisWorkPriority({
      status: "watching",
      suggestedStatus: "strengthening",
      signalType: "市场反馈",
      evidenceDelta: "market_feedback",
      relatedWikiPages: [{ wikiMeta: { status: "活跃", confidence: "中" } }],
    })
    expect(confirm.tier).toBe("today")
    expect(confirm.label).toBe("今天先看")
    expect(confirm.reason).toContain("确认状态变化")

    const ask = buildHypothesisWorkPriority({
      status: "watching",
      suggestedStatus: "watching",
      signalType: "新催化",
      evidenceDelta: "catalyst_signal",
      askDeepDiveRecommended: true,
      relatedWikiPages: [{ wikiMeta: { status: "活跃", confidence: "中", momentum: "热", catalysts: ["MPO"] } }],
    })
    expect(ask.tier).toBe("ask")
    expect(ask.label).toBe("Ask 深挖")
    expect(ask.reason).toContain("活跃框架")

    const quiet = buildHypothesisWorkPriority({
      status: "archived",
      suggestedStatus: "archived",
    })
    expect(quiet.tier).toBe("quiet")
    expect(quiet.label).toBe("休眠")
  })

  it("orders hypothesis rows by PM work priority before stale table order", () => {
    const rows = [
      { id: "cold", title: "旧假设", status: "archived", updatedAt: "2026-06-20T09:00:00Z" },
      { id: "ask", title: "需要深挖", status: "watching", updatedAt: "2026-06-20T08:00:00Z" },
      { id: "today", title: "今天先确认", status: "watching", updatedAt: "2026-06-19T08:00:00Z" },
    ]

    const ordered = buildHypothesisWorkbenchRows(rows, {
      cold: { suggestedStatus: "archived" },
      ask: {
        suggestedStatus: "watching",
        evidenceDelta: "catalyst_signal",
        signalType: "新催化",
        askDeepDiveRecommended: true,
        relatedWikiPages: [{ wikiMeta: { status: "活跃", momentum: "热" } }],
      },
      today: {
        suggestedStatus: "strengthening",
        evidenceDelta: "market_feedback",
        signalType: "市场反馈",
      },
    })

    expect(ordered.map((item) => item.id)).toEqual(["today", "ask", "cold"])
  })

  it("summarizes hypothesis quality gaps in PM-facing language", () => {
    const complete = buildHypothesisQualityBrief({
      title: "CPO节奏放缓可能提升MPO高速连接器短期订单弹性",
      triggerConditions: ["新增资料出现MPO订单或客户验证"],
      invalidationSignals: ["CPO节奏恢复且MPO订单未跟随"],
      expectedEvidencePath: ["wiki框架 -> Ask深挖 -> Tushare量价验证"],
      relatedWikiPages: [{ sourceRef: "wiki/概念/AI数据中心互联.md", title: "AI数据中心互联" }],
      keyVariables: ["MPO订单", "量价扩散"],
    })
    expect(complete.tone).toBe("ready")
    expect(complete.label).toBe("可跟踪")
    expect(complete.headline).toContain("可以进入日常跟踪")
    expect(complete.missingLabels).toEqual([])

    const weak = buildHypothesisQualityBrief({
      title: "MPO连接器订单预期扩散",
      keyVariables: ["订单扩散"],
    })
    expect(weak.tone).toBe("needs_work")
    expect(weak.label).toBe("待补定义")
    expect(weak.missingLabels).toEqual(["触发条件", "证伪信号", "验证路径", "wiki框架"])
    expect(weak.headline).toContain("缺 4 项")
    expect(weak.detail).toContain("触发条件")
    expect(weak.nextAction).toContain("补齐")

    const withStringWikiRef = buildHypothesisQualityBrief({
      triggerConditions: "新增资料出现客户线索",
      invalidationSignals: "订单未兑现",
      expectedEvidencePath: "wiki框架 -> Ask",
      relatedWikiPages: "wiki/概念/AI数据中心互联.md",
    })
    expect(withStringWikiRef.tone).toBe("ready")

    const tooBroad = buildHypothesisQualityBrief({
      title: "PCB有投资机会",
      granularity: { status: "needs_review", issue: "too_broad" },
      triggerConditions: ["新增资料提到PCB"],
      invalidationSignals: ["缺少验证"],
      expectedEvidencePath: ["wiki框架 -> Ask"],
      relatedWikiPages: "wiki/概念/AI数据中心互联.md",
    })
    expect(tooBroad.tone).toBe("needs_work")
    expect(tooBroad.label).toBe("颗粒度待调")
    expect(tooBroad.headline).toContain("太宽")
    expect(tooBroad.missingLabels).toContain("假设颗粒度")

    const inferredTooBroad = buildHypothesisQualityBrief({
      title: "AI算力继续景气",
      segments: ["AI"],
      triggerConditions: ["新增资料继续提到AI算力"],
      invalidationSignals: ["缺少验证"],
      expectedEvidencePath: ["wiki框架 -> Ask"],
      relatedWikiPages: "wiki/概念/AI数据中心互联.md",
    })
    expect(inferredTooBroad.label).toBe("颗粒度待调")
    expect(inferredTooBroad.headline).toContain("太宽")

    const tooFine = buildHypothesisQualityBrief({
      title: "某微信群6月19日提到某公司涨价可能利好某股",
      granularity: { status: "needs_review", issue: "too_narrow" },
      triggerConditions: ["群消息继续扩散"],
      invalidationSignals: ["消息无法复核"],
      expectedEvidencePath: ["微信消息 -> 单一股票观察"],
      relatedWikiPages: "wiki/概念/AI数据中心互联.md",
    })
    expect(tooFine.tone).toBe("needs_work")
    expect(tooFine.headline).toContain("太细")
    expect(tooFine.detail).toContain("事件")

    const inferredTooFine = buildHypothesisQualityBrief({
      title: "某一天某只股票放量",
      triggerConditions: ["当日放量"],
      invalidationSignals: ["次日未延续"],
      expectedEvidencePath: ["行情 -> 单股观察"],
      relatedWikiPages: "wiki/概念/AI数据中心互联.md",
    })
    expect(inferredTooFine.label).toBe("颗粒度待调")
    expect(inferredTooFine.nextAction).toContain("并入相关假设")
  })

  it("gates candidate hypotheses to mid-level investable mechanisms", () => {
    const broad = buildHypothesisGranularityGate({
      title: "AI算力继续景气",
      theme: "AI",
      segments: ["AI"],
      signalType: "新催化",
    })
    expect(broad.passes).toBe(false)
    expect(broad.reason).toBe("too_broad")
    expect(broad.bucket).toBe("rejected")

    const fine = buildHypothesisGranularityGate({
      title: "某微信群6月19日提到某家公司涨价可能利好某股",
      theme: "AI数据中心互联",
      segments: ["MPO"],
      sourceRef: ".llm-wiki/wechat-inbox/processed/2026-06-19.jsonl#msg:a",
    })
    expect(fine.passes).toBe(false)
    expect(fine.reason).toBe("too_narrow")
    expect(fine.bucket).toBe("event_only")

    const cpoMpo = buildHypothesisGranularityGate({
      title: "CPO节奏放缓可能提升MPO高速连接器短期订单弹性",
      theme: "AI数据中心互联",
      segments: ["CPO", "MPO", "高速连接器"],
      signalType: "新催化",
      evidenceDelta: "catalyst_signal",
      relatedWikiPages: [{ sourceRef: "wiki/概念/AI数据中心互联.md", title: "AI数据中心互联" }],
    })
    expect(cpoMpo.passes).toBe(true)
    expect(cpoMpo.reason).toBe("mid_level_mechanism")
    expect(cpoMpo.bucket).toBe("primary")
    expect(cpoMpo.matchedParts).toEqual(expect.arrayContaining(["产业方向", "细分环节", "变化机制", "可跟踪证据"]))

    const glassSubstrate = buildHypothesisGranularityGate({
      title: "玻璃基板产业化加速可能先利好设备材料验证链",
      theme: "先进封装",
      segments: ["玻璃基板", "设备", "材料"],
      expectedEvidencePath: ["公告订单", "设备交付", "材料验证"],
      relatedWikiPages: "wiki/概念/先进封装材料.md",
    })
    expect(glassSubstrate.passes).toBe(true)
    expect(glassSubstrate.score).toBeGreaterThanOrEqual(4)
  })

  it("builds a definition supplement draft for under-specified hypotheses", () => {
    const draft = buildHypothesisDefinitionDraft({
      id: "hypo_ai_cpo_mpo_4749",
      title: "CPO增速放缓可能推动MPO连接器量价齐升",
      theme: "AI数据中心互联",
      segments: ["MPO", "CPO", "高速连接器"],
      timeHorizon: "未来6-12个月",
      relatedWikiPages: [{ sourceRef: "wiki/概念/AI数据中心互联.md", title: "AI数据中心互联" }],
      sourceRefs: [{ sourceRef: "raw/研报新闻/2026-06-19-MPO.md" }],
      evidenceRefs: [{ sourceRef: ".llm-wiki/wechat-inbox/processed/2026-06-19.jsonl#msg:raw:aaa:bbb" }],
    })

    expect(draft.kind).toBe("hypothesis_definition")
    expect(draft.title).toContain("补定义：CPO增速放缓可能推动MPO连接器量价齐升")
    expect(draft.sourceRefs).toContain("wiki/概念/AI数据中心互联.md")
    expect(draft.sourceRefs).toContain("raw/研报新闻/2026-06-19-MPO.md")
    expect(draft.sourceRefs).toContain(".llm-wiki/wechat-inbox/processed/2026-06-19.jsonl")
    expect(draft.sourceRefs).not.toContain("[object Object]")
    expect(draft.selectedSourceIds).toEqual(["pasted_material", "wiki_incremental", "ima"])
    expect(draft.missingLabels).toEqual(["触发条件", "证伪信号", "验证路径"])
    expect(draft.body).toContain("triggerConditions")
    expect(draft.body).toContain("invalidationSignals")
    expect(draft.body).toContain("expectedEvidencePath")
    expect(draft.body).toContain("不要自动写 wiki/raw")
  })

  it("builds a compact reader-facing timeline for a tracked hypothesis", () => {
    const items = buildHypothesisTimelineItems({
      id: "hypo_mpo",
      title: "CPO增速放缓可能推动MPO连接器量价齐升",
      status: "watching",
      recentEvents: [
        {
          createdAt: "2026-06-19T10:10:00.000Z",
          evidenceDelta: "catalyst_signal",
          signalType: "新催化",
          suggestedStatus: "watching",
          suggestedStatusReason: "new context is not decisive enough to upgrade the hypothesis",
          sourceExcerpt: "微信增量 chat=AI产业链情报 sentAt=2026-06-19 10:00:00 CPO节奏放缓，MPO连接器关注度提升。",
          sourceRef: ".llm-wiki/wechat-inbox/processed/2026-06-19.jsonl#msg:raw:aaa:bbb",
        },
      ],
      openAlerts: [
        {
          createdAt: "2026-06-19T10:10:00.000Z",
          evidenceDelta: "catalyst_signal",
          signalType: "新催化",
          suggestedStatus: "watching",
          alertReason: "new context is not decisive enough to upgrade the hypothesis",
          sourceExcerpt: "微信增量 chat=AI产业链情报 sentAt=2026-06-19 10:00:00 CPO节奏放缓，MPO连接器关注度提升。",
          sourceRef: ".llm-wiki/wechat-inbox/processed/2026-06-19.jsonl#msg:raw:aaa:bbb",
        },
      ],
    }, {
      evidenceDelta: "catalyst_signal",
      signalType: "新催化",
      suggestedStatus: "watching",
      sourceExcerpt: "微信增量 chat=AI产业链情报 sentAt=2026-06-19 10:00:00 CPO节奏放缓，MPO连接器关注度提升。",
      sourceRef: ".llm-wiki/wechat-inbox/processed/2026-06-19.jsonl#msg:raw:aaa:bbb",
    })

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      badge: "新催化",
      transition: "观察中",
      sourceLabel: "微信 AI产业链情报 · 2026-06-19 10:00:00",
      tone: "hot",
    })
    expect(items[0].detail).toContain("不足以升级")
    expect(items[0].excerpt).toContain("MPO连接器关注度提升")
  })

  it("orders hypothesis timeline items newest first and keeps the table compact", () => {
    const items = buildHypothesisTimelineItems({
      status: "watching",
      recentEvents: [
        { createdAt: "2026-06-18T09:00:00.000Z", evidenceDelta: "catalyst_signal", signalType: "新催化", sourceRef: "raw/微信聊天/2026-06-18.md" },
        { createdAt: "2026-06-19T09:00:00.000Z", evidenceDelta: "market_feedback", signalType: "市场反馈", suggestedStatus: "priced_in", sourceRef: "raw/研报新闻/2026-06-19.md" },
        { createdAt: "2026-06-17T09:00:00.000Z", evidenceDelta: "counter_signal", signalType: "反证", suggestedStatus: "divergent", sourceRef: "raw/微信聊天/2026-06-17.md" },
        { createdAt: "2026-06-16T09:00:00.000Z", evidenceDelta: "supporting_signal", signalType: "二次确认", sourceRef: "raw/微信聊天/2026-06-16.md" },
      ],
    }, {}, { limit: 3 })

    expect(items.map((item) => item.badge)).toEqual(["市场反馈", "新催化", "反证"])
    expect(items.map((item) => item.transition)).toEqual(["观察中 -> 可能已定价", "观察中", "观察中 -> 走势背离"])
  })

  it("orders hypothesis timeline items by actual time across mixed timestamp formats", () => {
    const items = buildHypothesisTimelineItems({
      status: "watching",
      recentEvents: [
        {
          eventTime: "2026-06-21T09:00:00.000Z",
          evidenceDelta: "market_feedback",
          signalType: "市场反馈",
          suggestedStatus: "priced_in",
          sourceRef: "raw/研报新闻/2026-06-21-0900.md",
        },
        {
          eventTime: "2026-06-21 10:00:00",
          evidenceDelta: "fundamental_delivery",
          signalType: "硬证据",
          suggestedStatus: "strengthening",
          sourceRef: "raw/研报新闻/2026-06-21-1000.md",
        },
      ],
    }, {}, { limit: 5 })

    expect(items.map((item) => item.badge)).toEqual(["硬证据", "市场反馈"])
    expect(buildHypothesisTimelineBrief({
      status: "watching",
      recentEvents: [
        {
          eventTime: "2026-06-21T09:00:00.000Z",
          evidenceDelta: "market_feedback",
          signalType: "市场反馈",
          suggestedStatus: "priced_in",
          sourceRef: "raw/研报新闻/2026-06-21-0900.md",
        },
        {
          eventTime: "2026-06-21 10:00:00",
          evidenceDelta: "fundamental_delivery",
          signalType: "硬证据",
          suggestedStatus: "strengthening",
          sourceRef: "raw/研报新闻/2026-06-21-1000.md",
        },
      ],
    }).headline).toContain("最新：硬证据")
  })

  it("uses structured source kind labels in hypothesis timeline rows", () => {
    const items = buildHypothesisTimelineItems({
      status: "watching",
      recentEvents: [
        {
          eventTime: "2026-06-25T09:00:00.000Z",
          evidenceDelta: "catalyst_signal",
          signalType: "新催化",
          sourceKindLabel: "研报新闻",
          sourceRef: ".llm-wiki/wechat-inbox/processed/2026-06-25.jsonl#msg:raw:news:1",
        },
      ],
    })

    expect(items[0].sourceLabel).toBe("研报新闻")
  })

  it("shows timeline source type and signal strength for PM trajectory reading", () => {
    const items = buildHypothesisTimelineItems({
      id: "hypo_mpo",
      status: "watching",
      recentEvents: [
        {
          eventTime: "2026-06-22T09:00:00.000Z",
          sourceType: "wechat",
          sourceRef: "raw/微信聊天/2026-06-22.md",
          evidenceDelta: "catalyst_signal",
          signalType: "新催化",
          suggestedStatus: "watching",
        },
        {
          eventTime: "2026-06-22T10:00:00.000Z",
          sourceType: "market",
          sourceRef: "stock-daily://MPO-basket/2026-06-22",
          evidenceDelta: "market_feedback",
          signalType: "市场反馈",
          suggestedStatus: "priced_in",
        },
        {
          eventTime: "2026-06-22T11:00:00.000Z",
          sourceType: "gangtise_theme",
          sourceRef: "raw/openclaw数据/产业链复盘/gangtise_themes/2026-06-22/001-MPO.md",
          evidenceDelta: "fundamental_delivery",
          signalType: "硬证据",
          signalStrength: "high",
          suggestedStatus: "strengthening",
        },
      ],
    }, {}, { limit: 5 })

    expect(items.map((item) => [item.sourceTypeLabel, item.signalStrengthLabel])).toEqual([
      ["产业链复盘", "高强度"],
      ["市场", "中强度"],
      ["微信", "低强度"],
    ])
  })

  it("keeps same-type timeline events separate when source identity is incomplete", () => {
    const items = buildHypothesisTimelineItems({
      id: "hypo_mpo",
      status: "watching",
      recentEvents: [
        {
          eventTime: "2026-06-19T10:00:00.000Z",
          evidenceDelta: "catalyst_signal",
          signalType: "新催化",
          suggestedStatusReason: "第一条舆情提到CPO放缓。",
        },
        {
          eventTime: "2026-06-19T11:00:00.000Z",
          evidenceDelta: "catalyst_signal",
          signalType: "新催化",
          suggestedStatusReason: "第二条舆情提到MPO订单弹性。",
        },
      ],
    }, {}, { limit: 5 })

    expect(items).toHaveLength(2)
    expect(items.map((item) => item.createdAt)).toEqual(["2026-06-19T11:00:00.000Z", "2026-06-19T10:00:00.000Z"])
    expect(items.map((item) => item.detail)).toEqual(["第二条舆情提到MPO订单弹性。", "第一条舆情提到CPO放缓。"])
  })

  it("merges duplicate timeline events from the same source and signal", () => {
    const items = buildHypothesisTimelineItems({
      id: "hypo_mpo",
      status: "watching",
      recentEvents: [
        {
          id: "event_old",
          eventTime: "2026-06-19T10:00:00.000Z",
          sourceRef: ".llm-wiki/wechat-inbox/processed/2026-06-19.jsonl#msg:raw:aaa:bbb",
          evidenceDelta: "catalyst_signal",
          signalType: "新催化",
          statusBefore: "watching",
          suggestedStatus: "watching",
          suggestedStatusReason: "第一条重复舆情。",
        },
        {
          id: "event_new",
          eventTime: "2026-06-19T11:00:00.000Z",
          sourceRef: ".llm-wiki/wechat-inbox/processed/2026-06-19.jsonl#msg:raw:aaa:bbb",
          evidenceDelta: "catalyst_signal",
          signalType: "新催化",
          statusBefore: "watching",
          suggestedStatus: "watching",
          suggestedStatusReason: "第二条重复舆情，保留最新摘要。",
        },
      ],
    }, {}, { limit: 5 })

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      badge: "新催化",
      mergedCount: 2,
      createdAt: "2026-06-19T11:00:00.000Z",
      detail: "第二条重复舆情，保留最新摘要。",
    })
  })

  it("does not create phantom timeline rows from default status-only signals", () => {
    const items = buildHypothesisTimelineItems({
      id: "hypo_empty",
      status: "watching",
      feedbackStatus: "watching",
    }, {
      evidenceDelta: "none",
      signalType: "新催化",
      suggestedStatus: "watching",
      reason: "暂无新增命中",
    })

    expect(items).toEqual([])
  })

  it("builds a selected-hypothesis timeline brief with PM next action", () => {
    const brief = buildHypothesisTimelineBrief({
      id: "hypo_mpo",
      title: "CPO增速放缓可能推动MPO连接器量价齐升",
      status: "watching",
      recentEvents: [
        {
          eventTime: "2026-06-20T09:30:00.000Z",
          evidenceDelta: "market_feedback",
          signalType: "市场反馈",
          statusBefore: "watching",
          suggestedStatus: "priced_in",
          tradingImplication: "相关标的已经放量扩散，先判断是 priced-in 还是刚启动。",
          sourceExcerpt: "研报新闻增量 chat=研报新闻 · 盘前纪要 sentAt=2026-06-20 09:30:00 CPO放缓后MPO连接器扩散，相关标的放量。",
          sourceRef: "raw/研报新闻/2026-06-20-CPO-MPO.md",
        },
        {
          eventTime: "2026-06-18T09:30:00.000Z",
          evidenceDelta: "catalyst_signal",
          signalType: "新催化",
          statusBefore: "seed",
          suggestedStatus: "watching",
          sourceExcerpt: "微信增量 chat=AI产业链情报 sentAt=2026-06-18 09:30:00 CPO节奏放缓，MPO关注度提升。",
          sourceRef: ".llm-wiki/wechat-inbox/processed/2026-06-18.jsonl#msg:raw:aaa:bbb",
        },
      ],
    })

    expect(brief.show).toBe(true)
    expect(brief.itemCount).toBe(2)
    expect(brief.headline).toContain("最新：市场反馈")
    expect(brief.detail).toContain("观察中 -> 可能已定价")
    expect(brief.detail).toContain("priced-in")
    expect(brief.trajectoryLine).toBe("初始观察 -> 观察中 -> 可能已定价")
    expect(brief.nextAction).toContain("Ask 深挖")
    expect(brief.items[0]).toMatchObject({
      badge: "市场反馈",
      transition: "观察中 -> 可能已定价",
      sourceLabel: "研报新闻 · 盘前纪要 · 2026-06-20 09:30:00",
      tone: "market",
    })
  })

  it("renders manual status-update events as real timeline transitions", () => {
    const items = buildHypothesisTimelineItems({
      id: "hypo_mpo",
      title: "CPO增速放缓可能推动MPO连接器量价齐升",
      status: "strengthening",
      recentEvents: [
        {
          eventTime: "2026-06-21 10:10:00",
          sourceType: "manual_review",
          sourceKindLabel: "人工确认",
          sourceRef: ".llm-wiki/hypothesis-alerts/2026-06-21.jsonl#alert_demo",
          evidenceDelta: "manual_status_update",
          signalType: "人工确认",
          previousStatus: "watching",
          newStatus: "strengthening",
          reason: "已人工确认：CPO 放缓信号进入二次确认。",
          askRunRef: ".llm-wiki/agent-runs/20260621-101000-ask/manifest.json",
        },
      ],
    })

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      badge: "人工确认",
      transition: "观察中 -> 证据增强",
      detail: "已人工确认：CPO 放缓信号进入二次确认。",
      sourceLabel: "人工确认",
      askRunRef: ".llm-wiki/agent-runs/20260621-101000-ask/manifest.json",
      tone: "support",
    })
  })

  it("prefers the user's manual confirmation reason in timeline detail", () => {
    const items = buildHypothesisTimelineItems({
      id: "hypo_mpo",
      title: "CPO增速放缓可能推动MPO连接器量价齐升",
      status: "strengthening",
      recentEvents: [
        {
          eventTime: "2026-06-21 10:10:00",
          sourceType: "manual_review",
          sourceKindLabel: "人工确认",
          evidenceDelta: "manual_status_update",
          signalType: "人工确认",
          previousStatus: "watching",
          newStatus: "strengthening",
          reason: "用户确认：新增资料已经出现卖方二次确认和量价扩散。",
          tradingImplication: "人工确认状态变化；后续继续观察。",
        },
      ],
    })

    expect(items[0].detail).toBe("用户确认：新增资料已经出现卖方二次确认和量价扩散。")
  })

  it("gives a clear empty timeline brief for a selected hypothesis without events", () => {
    const brief = buildHypothesisTimelineBrief({
      id: "hypo_empty",
      title: "玻璃基板产业化加速可能先利好设备材料验证链",
      status: "seed",
    })

    expect(brief.show).toBe(true)
    expect(brief.itemCount).toBe(0)
    expect(brief.headline).toContain("还没有新增资料轨迹")
    expect(brief.trajectoryLine).toBe("初始观察")
    expect(brief.detail).toContain("扫描新增资料")
    expect(brief.nextAction).toContain("扫描")
    expect(brief.items).toEqual([])
  })

  it("labels hard evidence and counter evidence wiki matches differently", () => {
    expect(buildRelatedWikiSummary({
      evidenceDelta: "fundamental_delivery",
      signalType: "硬证据",
      pages: [{ title: "MPO", sourceRef: "wiki/概念/MPO.md" }],
    }).label).toBe("支撑回连")

    expect(buildRelatedWikiSummary({
      evidenceDelta: "counter_signal",
      signalType: "反证",
      pages: [{ title: "CPO", sourceRef: "wiki/概念/CPO.md" }],
    }).label).toBe("反证回连")
  })

  it("explains empty related wiki backlinks as a deliberate no-strong-match state", () => {
    const catalyst = buildRelatedWikiEmptyHint({
      evidenceDelta: "catalyst_signal",
      signalType: "新催化",
    })

    expect(catalyst.label).toBe("无强 wiki 回连")
    expect(catalyst.detail).toContain("先 Ask 深挖")

    const quiet = buildRelatedWikiEmptyHint({})
    expect(quiet.label).toBe("未命中强框架")
    expect(quiet.detail).toContain("不硬连泛页面")
  })
})
