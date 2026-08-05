# Trading Review Wiki 更新日志

> 版本发布历史，按时间倒序排列。

---

## Unreleased

- **新增 DeepSeek 专用 LLM 提供商选项**:Settings → LLM Provider 新增 `DeepSeek`，默认端点 `https://api.deepseek.com/v1`（自动拼接 `/chat/completions`），默认模型 `deepseek-v4-flash`。复用 OpenAI 兼容解析、`parseUsage`（捕获前缀缓存命中 `prompt_tokens_details.cached_tokens`）与 `max_tokens: 8192` 输出上限，与原 `custom` + DeepSeek 端点行为一致，可直接替换。sources/lint/plan/ingest-queue 的 LLM 可用性判断同步识别 `deepseek`。
- **DeepSeek 模型列表改为运行时从 API 获取（参考 esengine/DeepSeek-Reasonix）**:模型下拉不再写死，改为调用 DeepSeek `/v1/models` 接口动态拉取可用模型（与 Reasonix 一致），并提供「刷新模型」按钮手动刷新；接口不可用时回退到静态默认列表 `[deepseek-v4-flash, deepseek-v4-pro]`（`deepseek-chat`/`deepseek-reasoner` 已于 2026-07-24 被 DeepSeek 官方弃用，不再作为默认项）。`

### 更新文件(Files)

- `src/stores/wiki-store.ts`（`LlmConfig.provider` 联合类型加 `"deepseek"`）
- `src/lib/llm-providers.ts`（新增 `case "deepseek"`）
- `src/components/settings/settings-view.tsx`（PROVIDERS 列表 + Endpoint 字段 + 模型动态拉取/刷新）
- `src/lib/llm-test.ts`（新增 `fetchDeepSeekModels`）
- `src/components/plan/plan-audit-view.tsx`、`src/components/lint/lint-view.tsx`、`src/components/sources/sources-view.tsx`、`src/lib/ingest-queue.ts`（gating 判断加 `deepseek`）
- `src/lib/__tests__/llm-providers.test.ts`（新增 Dedicated DeepSeek provider 测试套件）
- `src/lib/__tests__/llm-test.test.ts`（新增 `fetchDeepSeekModels` 测试）
- **P0-缓存前缀冻结**:新增 `src/lib/chat-prompts.ts`（`buildChatSystemPrompt()` 冻结稳定系统提示词 + `buildChatContextBlock()` 把检索结果/语种指令移到 user message），`chat-panel.tsx` 改用上述函数（system 提示词跨查询字节级稳定），`ingest.ts` analyze/write 阶段统一以 `buildIngestCommonPrefix()` 为基础前缀追加阶段指令；新增 `chat-prompts.test.ts`（9 例）+ 扩展 `ingest-cache-guard.test.ts`（stage 前缀一致性断言）。54/54 测试通过。
- **P1+P2-DeepSeek 缓存命中率增强（参考 Reasonix）**:
  - **P1-自动压缩（prefix-preserving compaction）**:`llm-client.ts` 新增 `compactConversation()` 纯函数——冻结 system 前缀原样保留，超阈值（>8 轮）的最旧轮次折叠为单条摘要 user 消息追加在冻结前缀之后，保住命中又限制上下文。
  - **P1-TTL 冷恢复（DeepSeek 专属）**:`llm-client.ts` 新增 `DEEPSEEK_PREFIX_CACHE_TTL_MS=5min`、`isPastDeepSeekCacheTtl()`、`recordDeepSeekRequest()`/`getLastDeepSeekRequestAt()` 模块级 TTL 计时；`streamChat` 每次 DeepSeek 真实请求自动记录时间戳；`ingest.ts` 的 `prepareIngestHistory()` 在 `executeIngestWrites` 发送累积历史前判定：DeepSeek 下若距上次请求超 TTL 或轮次超阈值，则压缩历史再发（冷恢复时不产生额外 miss）。
  - **P2-辅助调用钉死 flash（DeepSeek 专属）**:`streamChat` 新增 `options.modelOverride` 参数；`runRetryRequest`（schema 重试等辅助调用）在 `provider==="deepseek"` 时传 `modelOverride: DEEPSEEK_AUX_MODEL`（`deepseek-v4-flash`），避免用 v4-pro 跑辅助操作放大成本。
  - **P2-前缀 SHA256 运行时守卫**:`llm-client.ts` 新增 `asyncSha256Hex()` 与 `PrefixGuard` 类（首次记录冻结前缀哈希，后续断言未漂移，防重构误改导致缓存静默失效）；`ingest-cache-guard.test.ts` 扩展为运行时哈希一致性断言。
  - 注：原 P1 计划的「deep-research.ts 日期注入 system」项经代码核查不成立——`deep-research.ts:222` 的 `new Date()` 仅用于生成文件名，不进入 system 提示词；当前代码库无时间戳注入 system 的实例。
  - 测试：新增 `llm-client-cache.test.ts`（13 例：compactConversation/isPastDeepSeekCacheTtl/TTL 状态/PrefixGuard/sha256/aux 常量）+ 扩展 `ingest-cache-guard.test.ts`（P2 守卫）+ 现有 LLM 测试；合计 73/73 通过。
- **R1-R5 剩余优化 + 预存错误修复（参考 Reasonix，续上）**:
  - **R1-deep-research 前缀冻结**:`deep-research.ts` 的 `synthesizeResearch` 把稳定规则（角色/语言/交叉引用/写作规则）抽为冻结 system 前缀，`wikiIndex`（随 wiki 变动的动态内容）从 system 移到 user message，使 system 提示词字节级稳定、跨调用命中 DeepSeek APC。
  - **R2-chat 多轮自动压缩**:`chat-panel.tsx` 在发送前对 `llmMessages` 调用 `compactConversation({keepRecentRounds:6})`，冻结 system 前缀不动、超阈值历史折叠为摘要，与 ingest 行为一致；长会话既保前缀缓存又限制上下文。
  - **R3-应用层保活（降级为策略）**:经评估，加定时器心跳侵入 UI 生命周期且消耗额外 token；Tauri 进程常驻已天然保温，且每次聊天/ingest 请求都会刷新前缀缓存 TTL。故**不引入代码定时器**，仅在 `llm-client.ts` 导出 `DEEPSEEK_PREFIX_CACHE_TTL_MS` 常量供参考，并在本文档记录"常驻即保温"原则。
  - **R4-CLI 路径（核查无需改动）**:`scripts/ingest-pdf-standalone.cjs` 已有 `COMMON_PREFIX` 前缀纪律（正是 P0 缓存守卫测试比对对象）；`scripts/codex-ingest.mjs` 是独立 codex/OpenAI Responses API 体系，与 DeepSeek 优化无关且用户未使用，故不改动。
  - **R5-预存类型错误修复**:① `buildUpdatePrompt` 的 `type` 经 `normalizeTypeAlias(inferTypeFromPath(...)) ?? "总结"` 归一为 `WikiType`，消除 `buildSchemaSection([type])` 字面量类型错误；② 删除死代码 `writeFileBlocks`（定义未调用）；③ `buildPlanPrompt`/`buildCreatePrompt`/`runPlanStage`/`runCreateStage` 清理未使用的 `sourceBaseName`/`fileName`/`wikiDirs` 参数（保留实际使用的 `wikiDirs` 仅作 `_wikiDirs` 占位）；④ `chat-panel.tsx` 删除死代码 `checkSaveWorthy`/`encodeContent`/`flattenFileNames`/`flattenMdFiles`/`flattenAllFiles` 及未用导入 `writeFile`/`useReviewStore`/`FileNode`；⑤ `deep-research.ts` 删除未用静态导入 `autoIngest`（动态导入仍保留）、未用变量 `processing`，`saveResearchDraft` 的 `llmConfig` 参数改 `_llmConfig`；⑥ `llm-client.ts` 的 `shouldUseNativeHttpForLlm` 参数改 `_config`。
  - 验证：tsc 对我改的 4 文件（chat-panel/ingest/deep-research/llm-client）0 新增错误；vitest 73/73 通过。
- **PostgreSQL 股票代码源 · 新增「更新库中股票数据」按钮（麦蕊 API → PG upsert）**:
  - **需求对齐**:Settings → PostgreSQL 股票代码源面板新增「更新库中股票数据」按钮，置于「保存配置」「立即刷新股票代码库」同一行右侧；仅当股票代码库可用（即 PG 连接/表/字段映射完整且已有一次成功 sync 的 `status` 记录）时显示；点击从麦蕊 API（`https://api.mairuiapi.com/hslt/list/{licence}`）抓取全市场股票列表，upsert 回当前配置的 PG 表（与 ZhangInvest-Backend 同一张表）；当天已更新则按钮置灰并显示「今日已更新」。
  - **新增 licence 配置项**:`PgConfig`（`settings.rs`/`wiki-store.ts`/`stock-codes.ts`）新增 `mairui_api_licence: Option<String>`；Settings 面板新增 licence 输入框（col-span-2，含说明文字），表名/列名 placeholder 改为 `public.stocks`/`stock_code`/`stock_name`（移除任何默认表暗示，用户必须显式配置）。
  - **新增 `update_stocks_from_mairui` 命令（Rust）**:检查 licence 非空 → 校验 PG 配置完整 → reqwest GET 麦蕊 → 连 PG → `SELECT` 现有 `{col_ticker, col_stock_name}` → 事务内逐条 upsert（`mairui.dm`→`col_ticker`、`mairui.mc`→`col_stock_name`，存在则 UPDATE 否则 INSERT）→ 写 `.llm-wiki/mairui-fetch.json`（`{fetched_at, count, inserted, updated}`）→ 返回 `FetchResult`。
  - **新增 `get_mairui_fetch_status` 命令（Rust）**:读取 `.llm-wiki/mairui-fetch.json` 返回上次抓取状态（独立维护，不污染股票代码 sync 状态）。
  - **前端状态与置灰逻辑**:`PgConfigSection` 新增 `mairuiApiLicence`/`fetching`/`fetchStatus` state；`isFetchReady(cfg)` 需完整 PG + 表名 + 代码字段 + 名称字段 + licence；`isFetchedToday(fetchStatus)` 比对 `fetched_at` 前 10 位与今天；按钮 `disabled={fetching || !isFetchReady(currentConfig()) || isFetchedToday(fetchStatus)}`；新增 fetchStatus 显示行（上次抓取/共/新增/更新）。
  - **修复「DB 中查不到股票」匹配问题（如「长川科技」）**:增强 `try_match`——新增 `strip_parentheses()`（去括号及内部内容）、`remove_ab_suffix()`（去末尾 A/B/H 股后缀）；匹配时遍历 4 种名称变体（原始 / 去括号 / 去 AB 后缀 / 去括号+去 AB）；子串兜底由「仅唯一候选时采用」改为「优先选最短包含候选，否则选最长被包含候选」，显著提升带括号/后缀的股票名命中率。
  - 验证：前端 `tsc --noEmit`（tsconfig.app.json）对 settings-view.tsx/stock-codes.ts/wiki-store.ts **0 新增错误**；Rust 侧因沙箱 `target` 目录锁（os error 5）无法在本环境 `cargo check`，需在用户本机执行 `cargo check`/`cargo build` 验证。

### 更新文件(Files)

- `src-tauri/src/commands/stock_codes.rs`（新增 `MairuiStockItem`/`MairuiFetchFile`/`FetchResult`/`update_stocks_from_mairui`/`get_mairui_fetch_status`/`mairui_fetch_path`/`load_mairui_fetch_from_disk`/`fetch_mairui_stocks`/`build_mairui_select_sql` + `try_match` 增强 + `strip_parentheses`/`remove_ab_suffix`）
- `src-tauri/src/lib.rs`（注册 2 个新命令）
- `src-tauri/src/settings.rs`（`PgConfig` 新增 `mairui_api_licence`）
- `src/commands/stock-codes.ts`（TS 封装 `updateStocksFromMairui`/`getMairuiFetchStatus` + `FetchResult` 类型）
- `src/stores/wiki-store.ts`（`PgConfig` 新增 `mairui_api_licence`）
- `src/components/settings/settings-view.tsx`（licence 输入框 + 按钮行第三按钮 + fetchStatus 显示 + `isFetchReady`/`isFetchedToday`/`handleUpdateStocksFromMairui`）

---

## v0.17.0-section-patch-ledger-ingest — 2026-07-07

> 摄入系统 v2 第一批:章节补丁更新、判断账本、Embedding 语义路由。三个能力全部 opt-in,不加 flag 时与 v0.16.4 行为完全一致。实测单篇摄入从约 1 小时降到 27 分钟,更新页输出量降为整页重写的 1/4~1/5。设计与九项决策见 `docs/提案-2026-07-07-时间线账本与供数架构-v6.md`,摄入机切换步骤见 `docs/摄入机升级指南-v0.17-章节补丁与账本摄入.md`。

- **章节化页面模型**:新增 `internal/page-sections.mjs`,frontmatter + `##` 章节树无损解析/序列化、章节锚定补丁(replace/append/insert/update_frontmatter,禁止删章节)、`<!-- AUTO:name -->` 自动区块幂等注入、页级+章节级 visibility 过滤。
- **`api-run --page-write-mode patch`**:update 页由模型输出章节补丁(逐行字符串数组格式,带控制字符 JSON 修复),程序本地应用,未触及章节字节级保留;每页失败独立回退整页生成;补丁原文存 `files/patch-*.md`;manifest 记录 `pageWriteMode`/`pagePatch` 统计;`finalize`/`batch-run` 兼容。
- **判断账本 Judgments v1**:新增 `data/facts/judgments.jsonl` + manifest `judgmentWrites` 独立写入区域,记录 thesis/expectation/lesson/stance 四类"当时的理解",held/revised/invalidated/expired 生命周期,确定性 `jg_` id 去重、supersedes 修正链、apply dry-run 展示与 fatal 校验、`judgments.index.json` 按实体聚合;`api-run --judgments` 在 Stage 2 启用判断规划;stance 默认 `visibility: personal`。
- **Embedding 语义路由**:新增 `embeddings build|status` 命令维护 `.llm-wiki/embeddings/wiki-pages.json` 增量索引(按页面文本 hash 复用);`prepare/api-run/batch-run --embedding-routing` 把整源+逐 segment 语义命中合并进候选页;`apply --write` 触及被索引页后自动增量刷新索引;索引/凭证缺失或 API 失败一律降级为词法候选,不阻断摄入;凭证优先级 `--embedding-api-key` > `OPENAI_API_KEY` > Keychain `trading-wiki-openai-api`。
- **存量 frontmatter 债降级**:apply 校验时 update 页改动前后同样存在的 fatal frontmatter 问题降级为 warning 并标 `preExisting: true`,只拦新引入的非法值。
- **frontmatter v6 字段**:可选 `entity_key`、`visibility`(team/personal),值非法仅软警告,存量页零影响。
- **测试**:新增 page-sections / ingest-page-patch / judgments / embeddings 四个套件共 49 个用例,覆盖无损往返、补丁回退、账本去重与修正链、索引增量、路由降级、存量债降级;`npm test` 1004/1006(2 个失败为既有环境依赖用例)。

### 更新文件(Files)

- `scripts/codex-ingest/internal/page-sections.mjs` / `page-sections.test.mjs`(新增)
- `scripts/codex-ingest/internal/ingest-page-patch.mjs` / `ingest-page-patch.test.mjs`(新增)
- `scripts/codex-ingest/internal/judgments.mjs` / `judgments.test.mjs`(新增)
- `scripts/codex-ingest/internal/embeddings.mjs` / `embeddings.test.mjs`(新增)
- `scripts/codex-ingest/internal/ingest.mjs`、`internal/knowledge.mjs`、`ingest/index.mjs`
- `scripts/codex-ingest/cli/index.mjs`、`cli/args.mjs`、`cli/help.mjs`
- `scripts/codex-ingest-lib.test.mjs`
- `docs/提案-2026-07-07-时间线账本与供数架构-v6.md`(新增)
- `docs/摄入机升级指南-v0.17-章节补丁与账本摄入.md`(新增)

---

## v0.16.4-research-cockpit-alpha-feed — 2026-06-28

> Research Cockpit Alpha Feed：把首页从功能面板进一步收敛成个人投研待办箱，强调 10 秒内看到今日优先信号、影响假设、建议动作和交易含义。

- **版本元数据升级**：`package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`、`src-tauri/tauri.conf.json` 升级到 `0.16.4`，用于承接 Alpha Feed 极简首页和保守状态判断改进。
- **Alpha Feed 首页骨架**：Research Cockpit 默认首屏改为 3-5 条今日优先待办，并在顶部摘要展示 `今日优先 / 需要 Ask / 建议确认 / 已折叠噪声`，弱化工程日志和后台细节。
- **卡片决策信息固定化**：待处理卡片固定回答“这是什么信号、影响哪条假设、建议动作、交易含义、为什么重要”，操作收敛到 `Ask / 确认 / 忽略`，让基金经理日常处理路径更直接。
- **假设质量门**：AI 并发发现假设和候选新假设增加中观机制筛选，太宽的主题和太细的单条消息默认折叠，合格假设必须具备产业方向、细分环节、变化机制和可跟踪证据。
- **增量信源路由更清楚**：微信聊天、研报新闻、Gangtise/OpenClaw 产业链复盘被分成不同信源类型，UI 不再把所有新增资料都显示成“微信文档”，扫描结果保留 sourceType 和来源解释。
- **L0-L3 信号分层**：卡片新增 `L0 新催化 / L1 二次确认 / L2 市场反馈 / L3 硬证据` 口径；提醒可以积极，但状态建议保持保守，普通新催化不会把假设直接推到 actionable。
- **假设轨迹 Timeline 口径**：事件输出补足 `sourceType / signalStrength / statusBefore / suggestedStatus / tradingImplication` 等字段，同源同类信号聚合展示，细碎消息优先成为 hypothesis event，而不是新假设。
- **Ask 深挖可见性补强**：点击 Ask 后卡片、顶部状态和结果区都会反馈运行中、缓存命中、失败原因和结果位置；结果区先展示结构化摘要，再保留完整六段回答和来源。
- **安全边界保持**：本版仍不自动写正式 `wiki/**`、不改旧 `raw/**`、不触发真实交易；自动扫描只写 `.llm-wiki/wechat-inbox/**`，状态更新必须人工确认。

### 更新文件（Files）

- `src/components/dashboard/__tests__/research-cockpit-helpers.test.ts`
- `src/components/dashboard/research-cockpit-helpers.ts`
- `src/components/dashboard/research-cockpit-view.tsx`
- `package.json`
- `package-lock.json`
- `src-tauri/Cargo.toml`
- `src-tauri/Cargo.lock`
- `src-tauri/tauri.conf.json`
- `CHANGELOG.md`
- `docs/research-cockpit-operation.md`
- `docs/更新报告-2026-06-28-ResearchCockpit-v0.16.4-alpha-feed.md`

### 验证（Validation）

- `npm test -- --run src/components/dashboard/__tests__/research-cockpit-helpers.test.ts --testTimeout 60000` 通过：`251 passed`。
- `npm test -- --run scripts/codex-ingest-lib.test.mjs --testTimeout 60000` 通过：`295 passed`。
- `npm run build` 通过；仅保留既有 Vite dynamic import / chunk size 警告。
- `cargo test --manifest-path src-tauri/Cargo.toml research_cockpit -- --nocapture` 通过：`6 passed`，仅保留既有 Rust warning。
- `git diff --check` 通过。

---

## v0.16.3-research-cockpit-pm-workbench — 2026-06-25

> Research Cockpit 日常投研工作台：把新增资料、Wiki 表头、金融实体词、假设状态机、待处理卡片和 Ask 深挖串成基金经理每天可用的信息流。

- **版本元数据升级**：`package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`、`src-tauri/tauri.conf.json` 升级到 `0.16.3`，用于承接 Research Cockpit 基金经理日常工作台改进。
- **舆情待处理卡降噪**：Research Cockpit 首页继续收敛到 `AI 并发找假设 -> 假设表跟踪 -> 微信/新增资料扫描 -> 待处理卡片 -> Ask 深挖 -> 人工确认状态`，待处理区按“今天优先 / 叙事扩散 / 候选新假设”等决策分层聚合，减少同源重复卡和无意义日期/编号候选。
- **状态机合法转移**：新增 Hypothesis 状态迁移守卫，扫描只给建议，确认状态时校验 `seed / watching / strengthening / actionable / priced_in / divergent / disconfirmed / archived` 的合法路径，防止噪声舆情把假设直接推过头。
- **source filter 真正生效**：`hypothesis watch --source ...` 贯通 CLI 和 Tauri action，扫描单个微信文档、研报新闻目录或 Gangtise 主题目录时只处理被选中的来源，不再被全量 inbox 干扰。
- **Gangtise 专用 parser**：新增 Gangtise/OpenClaw 产业链复盘解析路径，把主题、细分、公司、催化和来源摘要拆成可路由信号，避免把产业链复盘当作普通微信文本。
- **Wiki 表头和金融实体复用**：Watchtower / hypothesis discover / update-from-article 可通过 `--finance-entity-audit-roots` 或 `TRADING_WIKI_FINANCE_ENTITY_AUDIT_ROOTS` 复用 live wiki 的 SAG entity audit 表，将公司、股票、产品线、技术路线、催化、风险因子等金融关键词接入待处理卡和候选假设排序。
- **Ask 深挖反馈更明确**：单条假设 Ask 默认跳过额外 LLM source-router，直接复用已有 `ask --agentic` 检索链路；UI 增加 Ask 运行中、缓存复用、结果定位、结构化摘要、证据强度和下一步动作提示，避免“点了 Ask 不知道回答在哪”。
- **多源新增资料入口**：Research Cockpit 来源预设扩展到 `raw/微信聊天`、`raw/研报新闻`、`raw/openclaw数据/产业链复盘/gangtise_themes`，UI 明确每类来源的用途，新增资料扫描只生成建议，不自动确认状态。
- **Tauri 固定动作保持安全**：Research Cockpit 的固定 allowlist 动作会在可用时自动附加默认 finance entity audit roots，但仍不开放前端任意 shell；自动扫描只写 `.llm-wiki/wechat-inbox/**`，状态更新仍需人工确认。
- **SAG 同步稳态修复**：`sag-sync` 对 pending 队列按路径去重，同步全树时跳过已 pending 文件，并在文档重写时同时归档同路径旧文档与本地 state 记录的旧 documentId，降低重复同步和旧索引残留。
- **测试覆盖扩展**：补充 Research Cockpit helper 与 hypothesis CLI 测试，覆盖金融实体关键词、待处理卡聚合、Ask 结果定位、缓存提示、状态确认反馈和 noisy signal 过滤。
- **安全边界保持**：本版仍不自动写正式 `wiki/**`、不改旧 `raw/**`、不触发真实交易；假设状态、events、alerts 只有人工确认后才写入 `.llm-wiki/**`。

### 更新文件（Files）

- `scripts/codex-ingest-lib.test.mjs`
- `scripts/codex-ingest/cli/help.mjs`
- `scripts/codex-ingest/cli/index.mjs`
- `scripts/codex-ingest/internal/hypothesis.mjs`
- `src-tauri/src/commands/research_cockpit.rs`
- `src/components/dashboard/__tests__/research-cockpit-helpers.test.ts`
- `src/components/dashboard/research-cockpit-helpers.ts`
- `src/components/dashboard/research-cockpit-view.tsx`
- `README.md`
- `CHANGELOG.md`
- `docs/更新报告-2026-06-25-ResearchCockpit-v0.16.3-pm-workbench.md`

### 验证（Validation）

- `npm test -- --run src/components/dashboard/__tests__/research-cockpit-helpers.test.ts --testTimeout 60000` 通过：`246 passed`。
- `npm test -- --run scripts/codex-ingest-lib.test.mjs --testTimeout 60000` 通过：`295 passed`。
- `npm run build` 通过；仅保留既有 Vite dynamic import / chunk size 警告。
- `cargo test --manifest-path src-tauri/Cargo.toml research_cockpit -- --nocapture` 通过：`6 passed`，仅保留既有 Rust warning。
- `git diff --check` 通过。

### v0.16.2-research-os-hard-source-review 主链增强

- **版本元数据升级**：`package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`、`src-tauri/tauri.conf.json` 升级到 `0.16.2`，用于承接 v0.16 ResearchOS 多 Agent 主链增强。
- **Hypothesis Evidence Link 队列**：`research-os agent status/plan/review` 现在会优先暴露 `hypothesis_evidence_link_review`，把 EvidenceResult -> Hypothesis 的低置信映射列入 HumanGate 队列，避免证据已补但假设反馈链断开。
- **硬源审计统一化**：新增共享 `source-integrity` 审计口径，区分 `native_official_disclosure`、`web_official_pdf`、`web_official_pdf_via_web_search`、`web_official_pdf_after_zero_result_tool_state`、`structured_data_only`、`web_lead_only`、`needs_source_refs`。
- **CNINFO/交易所硬源优先级**：原生 `cninfo/sse/szse:announcement#...` refs 在 review queue 中排在 Web PDF/Tavily 线索之前；`tool-state:cninfo#announcement:results=0` 不再被误判为硬源。
- **Review dry-run 可审计**：`hypothesis evidence-link-review` dry-run 和待写入 link 都会输出 `sourceIntegrity`，人工确认时可直接看到硬源状态、source profile、官方公告 refs、Tavily 是否参与、零结果官方工具态等信息。
- **真实状态更新**：当前 live 项目已形成 `73` 条 trajectories、`806` 个 Benchmark cases、`376` 个 LoRA-ready candidates、`29` 个 trainable 样本、`2` 个 confirmed real profitable execution 样本、`12` 个 paper-trade-agent written candidates、`99` 条 hypothesis evidenceFeedback。
- **文档刷新**：更新 `docs/Trading-Review-Wiki-功能全景与演进路线.md`，补齐 v0.13 Evidence Runner、v0.14 Hypothesis Engine、v0.15 Paper Trade Agent、v0.16 Codex-orchestrated Agent 与 v0.16.2 hard-source review 的当前口径。
- **安全边界保持**：仍默认 dry-run，写入只进 `.llm-wiki/**`，不写正式 `wiki/**`、不改旧 `raw/**`、不触发真实交易，LoRA-ready 不保存原始事实、价格行或交割单行。

### v0.16.1-research-os-mainline-closed-loop 主链准备

- **版本元数据升级**：`package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`、`src-tauri/tauri.conf.json` 同步到 `0.16.1`，用于承接 v0.13-v0.16 训练飞轮闭环进入主链。
- **Research OS Agent 编排**：`research-os agent status/plan/review/step/verify` 形成 Codex-supervised CLI/artifact 多 Agent 调度层，保持 dry-run first、HumanGate explicit 和 `.llm-wiki/**` 写入边界。
- **真实交易 execution-result 闭环**：新增 `research-os-execution-result-v1` schema、文档和测试，支持从交割单、日复盘、position-tracking 与 Tushare 市场路径交叉验证真实交易执行结果，并回流 stock-feedback trajectory / Benchmark / LoRA-ready。
- **真实收益与 paper trade 分权重**：真实 confirmed profitable execution result 与 paper trade profitable 样本在 curriculum 中分来源、分权重；paper trade 不冒充真实收益，LoRA-ready 不保存交割单行、价格行或原始事实。
- **Evidence Runner Web 补证升级**：Tavily/Web adapter 增加官方源、媒体源、门户源、未知线索分级；`official_primary` 可提高 sourceQuality，门户/乱码页进入 review 或降权。
- **字段级证据命中门**：Web 补证不再把 top snippet 盲目填满所有 targetFields；`order/customer/shipment/revenue/annual_report/announcement` 必须各自命中关键词，防止年报摘要被误判为完整基本面兑现证据。
- **主链交接文档**：新增 `docs/更新报告-2026-06-21-ResearchOS-v0.16.1-mainline-closed-loop.md` 与 `docs/发布说明-v0.16.1-main合并准备.md`，集中记录已闭合链路、未闭合缺口、验证包和合并建议。
- **当前缺口明确化**：保留 `pendingReviews=42`、`executionResultsNeedsReconciliation=17`、`paperTradeAgentWrittenCandidates=0`、`hypothesis evidenceFeedback=0`、CNINFO adapter unavailable/open、v0.17 UI 操作台未完成等未闭合项，作为合并后继续推进清单。

---

## v0.15.0-research-os-loop — 2026-06-21

> Research OS 主链收口：把 v0.13 Evidence Runner、v0.14 Hypothesis Engine 和 v0.15 Paper Trade Agent 合并成“证据 -> 假设 -> 模拟交易 -> 收益归因 -> Benchmark -> LoRA-ready”的可审计训练飞轮。

### v0.15.0-paper-trade-agent 收口

- **Paper Trade Agent 候选层**：新增 `stock-feedback paper-trade-agent candidates`，从 stock-feedback trajectory 与 hypothesis evidence-feedback 生成 `rule_baseline / llm_discretionary` 双轨 paper trade 候选。
- **as-of 截断与证据请求**：候选强制携带 `asOfDate`、`evidenceCutoff.noFutureData=true`、entry/exit plan、position sizing、invalidation condition、expected catalyst 和 Tushare/price SQL marketEvidenceRequest。
- **训练飞轮 UI**：模拟交易闭环面板新增 Agent 候选、预览/写入、使用 Agent、补入口价入口；补入口价复用现有 Tushare 探测和 paper trade record 证据门。
- **Paper Trade 结算队列**：`paper-trade status` 与训练飞轮 status/ledger 摘要新增只读 `settlementQueue` 和“待结算”指标，优先提示 open paper trades 进入现有 settle 复盘面板，不自动结算、不写真实交易。
- **Paper Trade 结算刷新计划**：settlement result / manifest 新增 `artifactRefreshPlan`，训练飞轮 follow-up 展示轨迹重建、Benchmark、人审、LoRA-ready 与 verify 的顺序和人审阻塞点。
- **Paper Trade 重载审计**：训练飞轮 status / UI 新增 `settlementRefreshAudit` 和“待刷新”指标，重载后仍能定位已结算 paper trade 缺失轨迹、Benchmark、人审或 LoRA-ready 覆盖的下一步。
- **Paper Trade LoRA-ready 闭环归零**：LoRA-ready `candidateRefs` 显式携带 `paperTradeId`，人审低权重 paper adapter 完成 Benchmark / LoRA-ready 后，`settlementRefreshAudit.pending` 可归零。
- **Benchmark / LoRA-ready**：Benchmark 增加 `paper_trade_agent_candidate` cases；LoRA-ready manifest 增加 `paperTradeAgentCurriculum`，paper trade 仍默认低权重且不得冒充真实收益。
- **Verify 扩展**：`stock-feedback verify` 校验 Paper Trade Agent candidate/manifest 的 schema、paper ledger 边界、as-of 截断、计划字段和 PEFT 边界。
- **更新报告**：新增 `docs/更新报告-2026-06-21-ResearchOS-v0.15.0-paper-trade-agent.md`。

### v0.14.0-hypothesis-engine 收口

- **EvidenceResult 回流 Hypothesis**：新增 `hypothesis evidence-feedback`，读取 v0.13 evidence task/result，并生成 hypothesis evidence list、direction、Evidence Score 与 training flywheel routes。
- **Hypothesis Quality Gate 正式化**：固化 `falsifiableConditions / coreDrivers / marketMispricing / sourceRefs`，并提供 numeric/date/text contains 可证伪触发检测。
- **Watchtower / HumanGate**：只生成状态迁移推荐，不自动修改正式 hypothesis；用户确认后才写 hypothesis event。
- **Post-Mortem 草稿**：对 `archived / disconfirmed / priced_in` 终态假设生成复盘草稿，供训练飞轮沉淀失败归因和决策策略。
- **Research Cockpit UI**：假设详情加入 Hypothesis Engine 面板，展示质量门、证据时间线、分数、Watchtower candidate、人审推荐和 post-mortem 入口。
- **更新报告**：新增 `docs/更新报告-2026-06-21-ResearchOS-v0.14.0-hypothesis-engine.md`。

### v0.13.0-evidence-runner 薄切片

- **Evidence Task 数据层**：新增 `stock-feedback-evidence-task-v1`、`stock-feedback-evidence-result-v1`、`stock-feedback-evidence-run-v1`、`stock-feedback-evidence-dlq-v1`，写入边界固定在 `.llm-wiki/stock-feedback/**`。
- **Evidence Runner CLI**：新增 `stock-feedback evidence-task create/list/show`、`run-task-queue`、`evidence-result list/review`、`source-status`、`dlq list/retry/discard`。
- **轻量质量门**：每个 EvidenceResult 输出 fieldCompleteness、valueValidity、timeliness、formatConsistency、sourceReliability、crossValidation 和 overallConfidence。
- **HumanGate 首片**：高置信无冲突结果可 `auto_ready`，冲突数据进入 `awaiting_review`，无可用证据进入 DLQ；approve 必须有可采信 source/tool evidence refs。
- **Tushare adapter 首片**：Evidence Runner 在无 mock/manual refs 时优先尝试 Tushare market/financial source；缺 token 或接口失败时进入可审计 failure/DLQ 路径，不输出密钥。
- **Training Flywheel Evidence Queue**：训练飞轮新增轻量 Evidence Queue 面板，可看 pending/running/awaiting_review/completed/DLQ/source health，查看 task/result 详情并执行 result review、DLQ retry/discard。
- **Tauri 固定 allowlist**：新增 evidence-task、run-task-queue、evidence-result、source-status、dlq 相关固定 action；仍不开放任意命令。
- **Hypothesis quality-check 薄切片**：新增 `hypothesis quality-check`，检查 falsifiableConditions、coreDrivers、marketMispricing、sourceRefs，只输出推荐和 EvidenceTask 草案，不自动改正式 Hypothesis 状态。
- **Verify 接入**：`stock-feedback verify` 会校验证据任务、结果、运行记录和 DLQ 的 schema、写入边界、证据引用和原始事实泄漏。
- **范围边界**：本片仍不做完整 Hypothesis V2 六门控、不自动改正式 Hypothesis 状态、不接 Temporal/LangGraph/Mem0，不触发真实交易。
- **更新报告**：新增 `docs/更新报告-2026-06-21-ResearchOS-v0.13.0-evidence-runner.md`。
- **主链发布说明**：新增 `docs/发布说明-v0.15.0-research-os-loop.md`，并将 package、Tauri 和 Cargo 版本统一升级到 `0.15.0`。

---

## v0.12.1-research-os-training-flywheel-v2 — 2026-06-20

> Research OS checkpoint：把 Research Cockpit、训练飞轮、Paper Trade、Tushare 外部证据和 Deep Research CLI 合并成主链版本。本版重点不是自动交易，而是让“自提问 -> 股票验证 -> 模拟/真实收益证据 -> 人工 review -> Benchmark -> PEFT-ready 候选”形成可审计闭环。

### 新功能（Feature）

- **训练飞轮独立入口**：左侧新增“训练飞轮”，首屏展示今日轨迹、待补证、可进入训练、priced-in 风险、失败样本和模拟交易状态。
- **`stock-feedback` 命令族**：新增/打通 `status`、`build-trajectories`、`list`、`review-queue`、`review`、`collection-task`、`collection-result`、`bench`、`export-lora-ready`、`verify`、`paper-trade status/record/settle`。
- **股票反馈轨迹与 Benchmark**：新增 `stock-feedback-trajectory-v1`、`stock-validation-benchmark-v1`、review event、collection result、LoRA-ready manifest 和 benchmark batch。
- **Paper trade 模拟账本**：支持 `rule_baseline` 与 `llm_discretionary` 双轨记录，结构化保存 `asOfDate`、入场/出场、收益率、最大回撤、持有天数、仓位纪律、卖出理由和证据引用。
- **Paper trade review 分流**：新增 `approve_paper_adapter_candidate`，盈利模拟交易只有人审后才能作为低权重 adapter 候选，不等同真实盈利样本。
- **Tushare 外部证据接入**：新增 `data-source tushare-probe` 与训练飞轮数据源健康状态，支持行情、日线基础、指数、涨停/连板、龙虎榜、机构、游资、热榜等证据探针。
- **自动市场证据窗口**：paper trade record 可从 Tushare 生成 entry price、相对强弱、换手/成交额变化、承接、回撤和微观结构 evidence refs。
- **Deep Research CLI**：新增 `deep-research` 命令，复刻应用端 Deep Research 面板：Tavily/Web 检索 + 本地 ask 检索 + LLM synthesis，默认只写 `.llm-wiki/deep-research/**`。
- **训练飞轮教学材料**：新增新手操作说明、截图资产、Word 文档、PPT，以及系统功能全景与演进路线文档/PPT/PDF。

### 改进（Improvement）

- **质量门按训练目标拆分**：预期交易、基本面兑现、priced-in 风险、失败归因和证据不足分开处理，避免用基本面证据一刀切压低“市场先炒预期”样本。
- **收益反馈可视化**：UI 展示 `realizedPnlPct`、`maxDrawdownPct`、`holdingDays`、profit outcome、profit credit、entryTiming、positionSizing、exitTiming，并提示正向收益、执行风险负样本和失败预期负样本的分流去向。
- **Adapter curriculum 和 Pattern radar**：新增来源集中度、人工权重、缺口雷达、补样本任务、LoRA-ready 刷新提示，以及 paper trade 低权重候选队列。
- **Tauri allowlist 固定化**：训练飞轮只调用固定 action，不开放任意命令。
- **Research Cockpit 信息流补强**：待处理区新增“今天先手”焦点卡，把 `确认状态 / Ask 深挖 / Ask 预检 / 加入跟踪` 的主操作上移到第一眼位置；摘要条保留为只读指标区，减少重复按钮。
- **Wiki 表头进入日常决策**：焦点卡和待处理卡显式展示命中的 wiki 框架表头，包括 `status`、`confidence`、`momentum`、`catalysts`，让微信舆情能接回“活跃框架 / 置信度 / 动量 / 催化变量”后再判断。
- **待处理反馈更明确**：新增信息流路径 `来源 -> 框架 -> 对象 -> 动作`、忽略成功提示、状态确认成功提示和 Ask 结果跳转提示，降低“点了不知道发生什么”的交互成本。
- **Deep Research 写入门控**：`--write` 才保存 `wiki/queries/**`，`--ingest` 必须搭配 `--write`，`--apply-ingest` 必须搭配 `--ingest`。

### 安全边界（Safety）

- collection-result 确认样本必须有 evidence refs；人工摘要不能替代 sourceRefs、price SQL 或 tool state。
- LoRA-ready 不保存原始事实、公告正文、价格行或交易明细，只保存行为、技能、工具习惯和决策策略。
- 自动写入仍限制在 `.llm-wiki/**` 和既有训练导出路径，不自动写正式 `wiki/**`、不改 `raw/**`、不触发真实交易。
- Paper trade 写入仅限 `.llm-wiki/stock-feedback/paper-trades/**`，强制 `ledgerKind=paper_trade`，不能冒充真实交易 ledger。
- Paper trade 必须声明 `asOfDate` 与 `evidenceCutoff.noFutureData=true`，用于约束模拟交易只能使用当时可见证据。
- Deep Research 默认只写 `.llm-wiki/deep-research/**`；正式 query page 和 staged ingest 都需要显式命令门。
- Tushare / Tavily 等外部 token 通过 Keychain、环境变量或命令行参数读取，manifest 和输出不保存密钥。

### 文档（Docs）

- 新增 [训练飞轮新手操作说明](docs/training-flywheel-new-user-guide.md)。
- 新增 [Research OS v0.12.1 主链整合更新报告](docs/更新报告-2026-06-20-ResearchOS-v0.12.1.md)。
- 更新 [Trading Review Wiki 功能全景与演进路线](docs/Trading-Review-Wiki-功能全景与演进路线.md)。
- 新增 `outputs/training-flywheel-new-user-guide.docx` 和 `outputs/training-flywheel-new-user-guide.pptx`。
- 更新 `outputs/trading-review-wiki-function-roadmap.pptx` 和 `outputs/trading-review-wiki-function-roadmap.pdf`。
- 更新 [Research Cockpit 操作说明](docs/research-cockpit-operation.md)，补充“今天先手”、Wiki 表头、信息流路径和 Ask 深挖反馈的读法。
- 主链不保留 2026-06-20 的逐步迭代复盘散文档，已合并为一份整合更新报告。

### 验证（Validation）

- `npm --silent exec vitest -- run scripts/codex-ingest-lib.test.mjs -t "codex ingest deep-research"` 通过：`2 passed`。
- `npm --silent exec vitest -- run scripts/codex-ingest-lib.test.mjs -t "codex ingest CLI structure" --testTimeout 60000` 通过：`7 passed`。
- `npm --silent exec vitest -- run scripts/codex-ingest-stock-feedback-paper-trade.test.mjs scripts/codex-ingest-data-source.test.mjs scripts/codex-ingest-cli-args.test.mjs src/components/training/__tests__/training-flywheel-view.test.ts` 通过：`154 passed`。
- `npm --silent exec vitest -- run src/components/dashboard/__tests__/research-cockpit-helpers.test.ts` 通过：`105 passed`。
- `cargo test research_cockpit --lib` 通过：`4 passed`，仅保留既有 Rust warning。
- `npm --silent run codex:ingest -- stock-feedback verify --project /path/to/your-trading-wiki` 返回 `status=ok`，当前检查到 `49` trajectories、`145` benchmark cases、`114` LoRA-ready candidates、`6` manifests、`1` paper trade。
- `npm run build` 通过；仅保留既有 Vite dynamic import / chunk 警告。
- `git diff --check` 通过；真实 Tushare token 与旧假密钥字符串未进入仓库。
- 已知后续重点：补真实交易账本、扩大 profitable / priced-in / fundamental closure 样本密度、把 paper trade 子 Agent 自动化。

---

## v0.12.0-research-cockpit-lite — 2026-06-19

> Research Cockpit Lite checkpoint：把前一版的多智能体、假设库、微信增量和 Autoresearch 工程底座，收敛成基金经理每天可用的“舆情驱动假设待办系统”。本版重点是更简单的默认交互：先有假设，再扫描微信新增，生成待处理卡片，人工确认或 Ask 深挖，最后把状态和来源沉淀为假设记忆。

### 新功能（Feature）

- **Research Cockpit Lite 每日工作台**：新增独立 `ResearchCockpitView` 和 Tauri allowlist action，首屏聚焦 `AI 并发找假设`、`扫描微信新增`、`自动跟踪`、`刷新`，默认隐藏自训练、proposal、autoresearch、补证和实验账本等高级功能。
- **微信增量观察**：新增 `wechat-inbox` 文件收件箱、raw 微信文档导入、去重、processed inbox、状态统计和候选来源列表。支持选择 `raw/微信聊天/YYYY-MM-DD.md` 或最近修改文件作为增量信号源。
- **假设 Watchtower 信号路由**：`hypothesis watch` 支持 `wechat_incremental` 来源，输出信号类型、命中假设、建议状态、证据摘要、来源引用和候选新假设；扫描默认不改真实假设状态。
- **LLM 小批量复核**：新增 `--llm-review auto|off|force` 路径，只对规则筛出的少量候选做 LLM 复核，避免把高频微信全文直接送模型。
- **假设状态确认**：新增 `hypothesis status-update --write`，只有人工确认后才更新 `.llm-wiki/hypotheses/**` 并写入 `.llm-wiki/hypothesis-events/**`。
- **假设 Ask 深挖**：新增 `hypothesis ask`，复用现有 agentic ask 输出关联股票、直接受益、利好排序、当前阶段、最大缺口、一句话结论和完整六段回答；修复此前只返回 context、不生成 answer 的问题。
- **高级实验室递归入口**：默认折叠但保留 `闭环状态`、`dry-run 闭环`、`策略建议 dry-run/write`、`自训练计划 dry-run/write`、阶段进度、阶段输出、alerts、候选假设、实验账本、证据缺口和自训练待审动作。
- **补证 LLM 工作流**：新增/打通 `hypothesis supplement-draft` 和 `hypothesis supplement`，支持把路演、表格、公告、调研纪要或 IMA/CNINFO/企查查/Tushare 搜集指令先整理成补证草稿，再写入 `.llm-wiki/hypothesis-supplements/**` 并触发 Watchtower 扫描。
- **SAG/双机同步辅助**：新增 `sag-sync`、`machine-role-preflight`、`sync-live-corpus-snapshot` 脚本和 npm 命令，为新旧机器分工、检索同步和开发预检保留工程入口。

### 改进（Improvement）

- **默认交互降噪**：待处理卡片不再展示长证据缺口列表，而是优先展示“为什么重要、影响哪条假设、建议状态、现在动作”；日期、编号、弱标题和泛词候选被过滤。
- **微信扫描流程可见化**：前端显示阶段摘要、运行锁、自动跟踪状态、待处理数量、命中数量和错误状态，避免按钮空转。
- **Ask 深挖展示增强**：界面新增 `Ask 深挖进行中`、缺 answer 提示、结构化摘要卡和默认展开的完整六段回答区域。
- **日常区/高级区分层**：首页只服务“今天有什么新信号会改变假设”，高级实验室承接递归自训练、proposal、补证和审计复盘，避免把日常决策和工程控制混在一起。
- **文档和教学材料补齐**：新增 Research Cockpit 操作说明、系统功能全景、双机同步边界、问题扩展 prompt、检索质量判断规则，以及新手操作 PPT/PDF。

### 安全边界（Safety）

- 微信自动扫描只写 `.llm-wiki/wechat-inbox/**`。
- 假设状态、events、alerts 必须人工确认后才写入。
- 不写正式 `wiki/**`、不改 `raw/**`、不触发真实交易、不自动应用 prompt 或策略。
- Tauri 前端只调用固定 allowlist 动作，不允许拼接任意 shell。
- 外部文本进入 UI 和 LLM 前按不可信输入处理；输出和 manifest 继续脱敏。

### 更新文件（Files）

- `src/components/dashboard/research-cockpit-view.tsx`
- `src/components/dashboard/research-cockpit-helpers.ts`
- `src/components/dashboard/__tests__/research-cockpit-helpers.test.ts`
- `src/commands/research-cockpit.ts`
- `src-tauri/src/commands/research_cockpit.rs`
- `scripts/codex-ingest/internal/hypothesis.mjs`
- `scripts/codex-ingest/cli/index.mjs`
- `scripts/codex-ingest-lib.test.mjs`
- `scripts/sag-sync.mjs`
- `scripts/machine-role-preflight.mjs`
- `scripts/sync-live-corpus-snapshot.mjs`
- `docs/research-cockpit-operation.md`
- `outputs/research-cockpit-new-user-tutorial.pptx`
- `outputs/research-cockpit-new-user-tutorial.pdf`

### 验证（Validation）

- `npm test -- --run scripts/codex-ingest-lib.test.mjs --testTimeout 60000` 通过。
- `npm run build` 通过；仅保留 Vite 对 chunk/dynamic import 的既有警告。
- `git diff --check` / `git diff --cached --check` 通过。
- Research Cockpit 新手 PDF 已用 Poppler 渲染 16 页检查。

---

## v0.11.0-codex-cli — 2026-06-16

> Codex CLI 递归研究系统 checkpoint：把 Trading Review Wiki 从“多源问答 + 时序事实治理”推进到“多智能体并发研究、插件优先公司深研、只读可审计 Autoresearch Lite、可导出自训练样本”的第一版工程底座。本版仍保持默认只读/审计优先，不自动写正式 `wiki/**`、不改 `raw/**`、不自动应用策略、不触发真实交易。

### 新功能（Feature）

- **CLI 模块化拆分**：新增 `scripts/codex-ingest/**` 内部模块目录，把 core、ask、brain、data-source、ingest、company-research、governance、cli router 等能力从原巨型 `scripts/codex-ingest-lib.mjs` 中拆出；`scripts/codex-ingest.mjs` 仍是唯一 CLI 入口，`scripts/codex-ingest-lib.mjs` 保留兼容 facade，保护既有测试、脚本和 skills。
- **`ask --agentic` 多智能体并发框架**：新增证据研究、反证审计、市场验证、交易策略四类 agent 并发执行，默认并发度 3，最后由 adjudicator 汇总为原 ask 六章节。单个 agent 失败会降级继续，全部 agent 失败则整体失败；审计产物写入 `.llm-wiki/agent-runs/**`，支持 `--agent-concurrency`、`--agent-timeout-ms`、`--no-agent-artifacts`。
- **主题 segment 候选池市场验证**：agentic/主题型问题可以先识别主题，再按 `.llm-wiki/theme-segments.json` 或内置 registry 构建细分候选池。内置覆盖光纤/光互联链、PCB 产业链等，避免光模块龙头或泛材料股挤占细分验证；未配置主题会提示 `未配置细分环节` 并回退普通候选池。
- **Trading Autoresearch Lite**：新增 `autoresearch program`、`autoresearch score`、`autoresearch ledger append/list/status`、`autoresearch proposal/policy propose`。研究计划、固定评分、实验账本和待审核策略建议默认只写 `.llm-wiki/research-programs/**`、`.llm-wiki/experiments/**`、`.llm-wiki/policy-proposals/**`。
- **公司深研 V2 `--plugin-led`**：`company-research --deep --plugin-led` 采用插件优先链路。主程序先生成 CNINFO/Tushare/Tavily/wiki/行情证据包、财务底表、业务拆解和 `financial-model-v2`；Data Analytics 先做模型/口径/证据质控，Public Equity Investing 直接生成主报告，Investment Banking 只在并购、定增、可转债、重组、融资等交易事项触发或 `--force-investment-banking-review` 时参与。
- **插件主报告完整性门控**：`--plugin-led` 会生成 `plugin-led/report-completeness.json`、`plugin-led/publish-readiness.json`、`plugin-led/plugin-led.json`；主报告不完整时自动追加一次 Public Equity 修复稿，最终路径以 `plugin-led.json` 的 `outputs.pluginLedReport` 为准。`deep-company-report.md` 作为兼容副本保留。
- **自训练与策略动作闭环增强**：self-question、self-train、export-samples、policy action/review、agent-runs、self-training plan verify 进入可审计样本链；未审阅 action、未复核计划和 agentic answer 不会进入 high-confidence SFT 正样本。
- **专业数据源接口管理**：新增 QCC、CNINFO、Tushare 等 data-source 状态/测试和脱敏输出能力，凭证读取与日志继续避免打印真实密钥。

### 改进（Improvement）

- **性能 profile**：新增 `--profile local-max`，在用户显式选择时提高 agentic ask、self-question loop regression/export verification、export-samples verify 的有界并发；显式并发参数仍优先。
- **只读 policy guardrail**：普通 ask 和 agentic ask 会只读加载 `data/brain/policies.jsonl` 的 active policy，回答必须披露策略要求但当前证据缺口，并相应降低置信度。
- **公司深研 skill 兼容**：旧 `--plugin-review/--plugin-optimize` 保留为回退和对照；`deep-company-report.md`、`run-summary.json`、`wiki-change-candidates.md` 等兼容产物继续生成，避免旧 reviewer 和 skill 断裂。
- **Gangtise meeting clues 导出修复**：修复表结构/列名兼容和输出状态记录，降低每日投研线索导出在空记录、表差异和路径状态下的误判。
- **文档资产补齐**：新增 `docs/codex-ingest-cli使用手册.md`、`docs/递归自训练交易AI框架报告.md`、`docs/专业插件能力层集成说明.md`、`docs/更新报告-2026-06-16-plugin-led公司深研V2.md`，并生成系统成长路径与 CLI 操作教学 PPT/PDF。

### 安全边界（Safety）

- `ask`、`ask --agentic`、`autoresearch score/status/list` 默认只读。
- `autoresearch proposal` 只生成待审核建议，不自动改 prompt、segment 配置、wiki/raw、交易动作或真实仓位。
- `company-research --deep --plugin-led` 只写 `.llm-wiki/company-research/**`，正式 `wiki/**` 只生成候选稿，不自动发布。
- `data-source` 和 stock SQL 相关输出继续做凭证脱敏；真实 API key、secret、PG 连接串不进入报告。
- self-training high-confidence 样本必须来自已复核 action、已验证样本或明确 evidence refs；价格-only 且缺基本面闭环的样本标记为 `needs_evidence`。

### 文档（Docs）

- 新增 [Codex Ingest CLI 使用手册](docs/codex-ingest-cli使用手册.md)。
- 新增 [递归自训练交易 AI 框架报告](docs/递归自训练交易AI框架报告.md)。
- 新增 [专业插件能力层集成说明](docs/专业插件能力层集成说明.md)。
- 新增 [Plugin-led 公司深研 V2 更新报告](docs/更新报告-2026-06-16-plugin-led公司深研V2.md)。
- 新增 [v0.11.0 main 合并准备说明](docs/发布说明-v0.11.0-main合并准备.md)。
- 新增 agent-skills 工程蓝图、PPT 大纲和可编辑 PPT/PDF 教学材料。

### 验证（Validation）

- `npm test -- scripts/codex-ingest-lib.test.mjs` 通过。
- `npm test -- --run` 通过。
- `npm run build` 通过；仅保留 Vite 对动态 import/chunk 的既有警告。
- 版本准备提交前需再次执行 `npm test -- scripts/codex-ingest-lib.test.mjs`、`npm test -- --run`、`npm run build`、`git diff --check`。

---

## v0.10.5-codex-cli — 2026-06-13

> Codex CLI 分支专项 checkpoint：加入轻量 Graphiti-style Temporal Facts v1 层，把摄入、检索和审计从“静态页面更新”推进到“可追踪当前有效事实、历史反证和概念归一候选”的可回滚 CLI 能力。本版只做本地 checkpoint，不包含 release tag 或发布脚本。

### 新功能（Feature）

- **Temporal Facts v1 账本**：新增 `data/facts/temporal_edges.jsonl` 写入目标和 `factWrites` manifest 区域，摄入时把时序事实与正式 wiki 页面写入分离，避免事实边混入 `writes`。
- **时序事实 apply 支持**：`applyManifest` 支持 dry-run 和 write-mode 的 `plannedFactWrites`、`duplicateFacts`、`supersededFacts`、`invalidatedFacts`、`factsWritten` 与 fact index 重建；确定性 fact id 可防止重复追加。
- **当前事实检索视图**：`ask` 默认只把 active/current facts 作为普通 `[F]` 证据；`superseded`、`invalidated`、`expired` 默认只作为历史/反证，不污染主证据。
- **`--include-invalidated` 审计开关**：`ask` 和 `ask eval` 新增 `--include-invalidated`，用于审计式问题显式查看失效、替代和反证事实。
- **`temporal-facts audit` 命令**：新增 `npm run codex:ingest -- temporal-facts audit`，从现有 `wiki/**/*.md` 提取 Predicate / Alias / Tag / Abbreviation 候选，并把人工裁决、tag 晋升、缩写白黑名单和概念层级规则写入 `.llm-wiki/temporal-facts/` 报告。
- **`concepts audit` 命令**：新增 `npm run codex:ingest -- concepts audit`，从 `wiki/概念/**/*.md` 提取重复标题、alias-title 冲突、父子包含候选和已配置规则覆盖情况，`--write` 只写 `.llm-wiki/concept-governance/` 报告。

### 改进（Improvement）

- **公开介绍页降敏**：README 中的本地路径、SQL 凭据示例和钥匙串条目细节改为通用说明，同时补充历史桌面版 Releases 入口，方便用户在 CLI 工具层和旧桌面应用之间选择。
- **交易复盘 Schema 参考模板**：新增 `docs/交易复盘Schema参考模板.md`，把真实交易复盘 wiki 的三层架构、页面类型、frontmatter、ingest/query/lint 流程和时序事实边界抽象成可公开参考的建库模板。
- **Predicate 词表细分**：在原有 `HAS_ORDER`、`HAS_VALIDATION_SIGNAL`、`HAS_RISK` 基础上增加订单事实强度、价格/量/客户/技术/基本面验证，以及澄清、竞争、需求、供应链、估值风险等细分 predicate。
- **概念别名审计降噪**：Alias 只保留 frontmatter aliases、标题拆分和括号同义；tags 与正文缩写拆成独立候选，避免 `国产替代`、`AI`、`Call` 等泛词制造假冲突。
- **概念规范化路由第一版**：新增 `data/concepts/canonical_rulings.json`，只让高置信 `sameAs/auto` 在摄入计划中改写到标准承载页；`mergeInto`、`childOf`、`tradeSliceOf` 默认只进入 `conceptRouting` 提示，不自动合并细分概念或交易切片。
- **Plan budget 软告警**：`--max-plan-items`、`--max-create-pages`、`--max-update-pages` 改为写入 `plan-budget.json` 的软告警，不阻断正常多页面摄入。
- **股票页交易执行边界**：摄入提示、schema 模板和首页说明均明确 `wiki/股票/**` 不再承载个人买入/卖出、成交价、仓位、持仓流水、盈亏和交割单逐笔记录；交易执行复盘留在 raw、总结、策略、错误、模式或 brain 中，股票页只保留公司研究和验证框架。
- **Temporal Fact Context 进入 prepare/api-run**：ingest context 现在会提供 entity candidates、related facts 和 segment-level fact seeds，帮助后续来源引用旧 fact、补充 supersedes/invalidates/contradicts。
- **文档化 v1 边界**：新增 `docs/temporal-facts-v1.md`，记录字段、predicate/status/evidence/sourceKind、反证替代、人工复核、回填优先级、别名维护和暂不做项。

### 安全边界（Safety）

- `ingest/apply` 仍然不写 `raw/**`。
- `wiki/股票/**` 不新增个人交易执行流水；日复盘/交割单里的买卖执行细节只作为原始证据、复盘结论或长期纠错使用。
- `writes` 仍限制在正式 wiki markdown 和每日分片日志；旧 `wiki/log.md` 禁止写入。
- `factWrites` 只能写 `data/facts/temporal_edges.jsonl`，不能写任意 facts 路径。
- `concepts audit` 只写 `.llm-wiki/concept-governance/**`；概念规范化不删除旧页、不搬迁正文、不写 `raw/**`。
- C/D 证据可以作为待验证 active，但会保留弱证据 warning，不能被写成确认事实。

### 验证（Validation）

- `npm test -- --run scripts/codex-ingest-lib.test.mjs` 通过。
- `npm test -- --run` 通过。
- `git diff --check` 通过。

---

## v0.10.4-codex-cli — 2026-06-08

> Codex CLI 分支专项更新：把 Trading Review Wiki 从“桌面知识库 + 摄入工具”推进到“交易研究自动化 CLI”。本版重点是多源 RAG、schema-aware 检索、raw 去噪、ingest 候选分段召回、股票 SQL 量价验证、daily-loop 锚定验证、vector 维护和 wiki housekeeping。

### 新功能（Feature）

- **多源 RAG 问答完整化**：[`scripts/codex-ingest-lib.mjs::buildAskRetrievalContext/askWiki`] `ask` 现在统一支持 `wiki_pages`、`raw_text`、`wiki_graph`、`facts_jsonl`、`brain_memory`、`stock_daily_sql` 六类 source。source routing 先走规则识别，再可选调用 LLM source router，最后按 required sources + LLM 推荐 + 规则分数融合。答案 prompt 统一编号为 `W/R/G/F/M/S`，要求输出固定六段：结论、证据链、分歧/反证、后续验证、交易含义、引用来源。
- **多源检索 RAG 完整流程文档**：新增 [`docs/多源检索RAG完整流程.md`](docs/多源检索RAG完整流程.md)，系统性说明 `tw-ask.sh -> codex-ingest ask -> askWiki -> buildAskRetrievalContext -> buildAskPrompt` 的完整链路，覆盖 source 注册、source routing、wiki/raw/graph/facts/brain/SQL、prompt 组装、vector 位置、ask 与 ingest 差异和调试命令。
- **Stock Daily SQL native source**：[`scripts/codex-ingest-lib.mjs::searchAskStockDaily/buildStockDailySqlQuery/buildStockDailyMarketValidation`] 新增只读 PostgreSQL 日线源，默认表为 `cn_stock_db.public.cn_stock_price_daily_wind`。能从 query 解析股票名/代码和近 N 日意图，生成只读 SQL，返回 `S1/S2/...` 证据，并计算 Market Validation：区间收益、首尾收盘价、均量、末日量能、成交额和验证结论。
- **Facts / Brain JSONL native source**：[`searchAskFacts/searchAskBrain`] `data/facts/*.jsonl` 和 `data/brain/*.jsonl` 进入 ask 原生检索。facts 用于案例、观察、事实、验证；brain 用于长期纠错、偏好、卫语句、预测与验证记忆。Brain Memory 明确只能作为先验和约束，不能单独证明市场事实。
- **Ask eval 检索质量评估**：[`runAskEval`] 新增/增强 `ask eval`，可用 `--expect-paths` 检查 recall、evidence coverage、raw noise、structure field coverage 等指标，用于回归验证检索质量。
- **Daily-loop 锚定验证**：[`daily-loop` 相关逻辑] 盘后 pending validation 从 `prediction.createdAt/answeredAt/date` 后的第一个交易日开始验证，保留 `validationStartDate`、`validationEndDate`、`horizonTrackKey`、`priorWindowDays`、`validationMethod="first_trading_day_after_prediction_v1"` 等字段，避免 1/3/5/10/20 日窗口互相覆盖。
- **Vector store 维护命令**：[`src-tauri/src/commands/vectorstore.rs`、`src/lib/embedding.ts`] 增加 LanceDB 向量库维护能力，支持统计、清理、删除和重建辅助。向量检索仍定位为 semantic boost，不是 CLI ask 的唯一真相源。
- **Wiki housekeeping 日志**：[`src/lib/wiki-housekeeping.ts`] 新增每日 housekeeping log 机制，降低 `wiki/log.md` 和根目录日志膨胀风险，让知识库操作记录更适合长期维护。

### 改进（Improvement）

- **正式 wiki frontmatter 作为一等召回层**：[`scoreFrontmatterStructure/frontmatterSearchText`] `title`、`aliases`、`tags`、`related`、`sources`、`summary`、`type` 都进入结构化加权；`概念/股票/错误/模式/策略` 等更贴近交易研究的页面类型有额外权重。正式 wiki 不再被 raw 噪声压住。
- **Frontmatter 新鲜度参与 ask 排序**：[`frontmatterFreshnessScore`] ask 模式读取 `updated / last_reviewed / created` 的最新有效时间。查询含“最新/最近/订单/进展/业绩/公告/量价”等时间敏感词时，近期页面获得更强加分；`概念/股票/总结/源文档/查询` 超过 180/365 天会温和降权；`策略/模式/错误` 等稳定经验页不重罚。`--show-context` 暴露 `frontmatterUpdated`、`frontmatterUpdatedField`、`staleDays`、`freshnessScore` 方便诊断。
- **有界多跳图谱扩展**：[`expandAskGraph/resolveAskGraphDepth`] `wiki_graph` 从固定一跳升级为有界扩展。默认仍是一跳；查询含“产业链/上下游/受益方向/扩散/映射/供应商/客户”等词时自动二跳，也支持 `--graph-depth 1|2|auto`。二跳结果做分数衰减、query relevance 过滤和 hub 节点截断，并在 prompt / `--show-context` 中输出 `graph_hop`、`path_trace`、`hop/pathTrace`，明确二跳只能作为关系线索。
- **Wiki 牵引 raw 原始证据**：[`boostRawResultsByWikiStructure`] top wiki 页面的 frontmatter `sources` 会反向 boost 对应 raw 文件，并记录 `structuredSourceMatch`。这让正式页和原始资料形成证据链，而不是两套孤立召回。
- **Raw 检索安全策略**：[`filterRawFilesByQueryPolicy`] ask 模式下 raw 默认按日期新鲜度限量扫描；query 带 `YYYY-MM-DD` 时优先扫对应日期；微信聊天等噪声路径在 ask 模式下降权。ingest 模式则保留更宽召回，避免漏候选。
- **Ingest 候选分段召回**：[`extractSourceTokens/searchIngestCandidates`] 长源、多主题 OpenClaw/Gangtise/微信 sentiment 资料现在按主题 token 和 heading 分段召回，避免一个长文件只召回最强主题而漏掉后半段重要链条。
- **Ingest token 排名收紧**：[`extractSourceTokens`] 新增对中文长短语、路径噪声、日期、通用字段名、无意义英文 token 的过滤和权重排序，减少 `content/source/theme/date` 等泛词污染候选集。
- **Schema-aware ask 与 ingest 检索硬化**：[`scripts/codex-ingest-lib.mjs`、`src/lib/search.ts`、`src/lib/templates.ts`] 检索层更尊重 Schema v1 页面结构，区分 ask 与 ingest 的召回目标：ask 偏去噪和够用，ingest 偏广召回和不漏候选。
- **Programmatic housekeeping merge**：[`scripts/codex-ingest-lib.mjs`、`src/lib/ingest.ts`] ingest 后的 index/overview/log 等 housekeeping 合并更程序化，减少 LLM 大段重写导致目录页损坏或缩水。
- **本地凭据加载 SQL 配置**：[`scripts/tw-ask.sh`、`scripts/codex-ingest-lib.mjs`] 股票 SQL 只从本机环境变量、私有配置文件或系统钥匙串读取连接信息。公开文档不记录具体主机、端口、用户名、钥匙串条目名称或密码值，输出也不打印密码。
- **Daily-loop 多源市场验证**：[`marketValidation`] 本地 SQL 与外部 Tencent K-line 交叉验证成为 daily-loop 可观测字段，状态包括 `confirmed`、`sql_stale`、`divergent`、`sql_only`、`external_only`、`unavailable`，避免单一源滞后造成错误结论。

### 修复（Bug Fix）

- **修复 stock-price 问题源路由不稳定**：股票名/代码 + 量价关键词会强制纳入 `stock_daily_sql`；SQL 不可用或未解析出 ticker 时返回 evidence insufficiency，不再编造价格事实。
- **修复 ask 被 raw 噪声淹没**：raw 在 ask 模式下加扫描上限、日期 hint、路径质量权重和微信聊天降权；正式 wiki 的结构字段召回优先级提高。
- **修复 ingest 对长源多主题漏召回**：分段 token seed 和主题短语提取后，机器人、AI 应用、算力、电力等混合资料不再只召回单一主题。
- **修复 validation window 语义被压扁**：多窗口验证保留 horizon track，短窗口是快速反馈，长窗口是持续性和归因修正，不再简单以后者覆盖前者。
- **修复 source routing 失败时不可诊断**：`--show-sources` 和 `--show-context` 输出 source routing、native queries、retrieval warnings、SQL status 和各源命中，便于定位是源不可用、召回不足还是证据本身缺口。

### 验证（Validation）

- `npm test -- --run` 通过：11 个测试文件，214 个测试。
- 新增/增强测试覆盖：source routing、facts JSONL、brain memory、stock SQL、graph expansion、ask eval、schema-aware retrieval、segmented ingest candidate retrieval、anchored daily-loop validation。

---

## v0.10.3 — 2026-05-12

> 用户反馈 Save to Wiki 偶发 `LLM returned no FILE block` 失败，使用 MiniMax 时频率显著高于 GPT 5.5。根因是 FILE block 解析器对 marker 格式要求过严（精确 3 短横线、精确 `---FILE:` 头、必须紧跟换行），弱指令模型会输出 `----FILE: path----`、`**path**`、外包 markdown code fence、甚至完全忘了 FILE marker 直接吐 frontmatter+body，全部解析失败。本版放宽解析 + 兜底救回。

### 修复（Bug Fix）

- **修复 Save to Wiki 弱模型偶发 `LLM returned no FILE block`**：[`ingest.ts::parseFileBlocks/tryExtractImplicitBlock/repairAndWriteBlocks`] 三层加固：① `parseFileBlocks` 短横线数从精确 3 个放宽到 `-{2,}`，兼容 `----FILE: ...----`/`--FILE: ...--`；`END FILE` marker 改用大小写不敏感正则匹配，兼容任意短横线数；路径自动剥 `**bold**`/`` `backtick` ``/`<angle>`/引号外包装。② 新增 `tryExtractImplicitBlock` 兜底：当 `parseFileBlocks` 返回 `[]` 且有 `expectedPath` 时，剥外层 markdown code fence + 跳过前置寒暄行（如「好的，以下是更新后的内容：」）+ 校验首尾都有 `---` frontmatter 分隔符，把整段响应当作 expectedPath 的隐式 block。③ 兜底救回的内容仍走原有 schema validator + repair 链路，垃圾响应（如拒绝语「我不能帮你做这个」）会被 v0.10.2 三道闸（schema/page-name-validator/garbage-detector）拦截，安全可控。
- **修复 `parseFileBlocks` 多 block 无 END FILE 时下个 marker 被吞进上个 block 的旧 bug**：[`ingest.ts::parseFileBlocks`] 原代码 `sliceEnd = starts[i+1].contentStart - 1` 只减 1（换行符），下个 block 的 `---FILE: ...---` marker 行整段被吞进上个 block 的 content。改为存 `markerStart` 字段，slice 到下个 marker 起始位置。

### 改进（Improvement）

- **新增 `src/lib/__tests__/ingest-parser.test.ts`（12 个用例）**：覆盖 4+ 短横线、加粗路径、反引号路径、缺 END FILE 多 block、markdown code fence 包裹、前置寒暄行、垃圾响应拒绝等典型 MiniMax/Kimi 失败模式。vitest 162/162 全过（新增 12）。
- **debug log 增强**：兜底救回时记录 `salvaging raw response as <path>` warn 日志，含原响应长度 + 前 200 字符预览，便于定位新失败模式。

---

## v0.10.2 — 2026-05-11

> 用户反馈 v0.10.1 落地后两个目录（`wiki/源文档/`、`wiki/查询/`）下仍堆积 200+ 个自动生成的"垃圾页"——文件名形如 `-2026-05-10.md`、`think-2026-04-19.md`、`好的，现在写入。-2026-05-07.md`，title 是 LLM 回复模板。根因是 Save to Wiki 把 chat 内容预写到 `wiki/查询/${slug}.md` 作为 autoIngest 输入文件，但 slug 算法 `replace(/[^a-z0-9\s-]/g, "")` 把中文全 strip 掉退化成空字符串。本版三件套止血 + 拔根 + 清存量。

### 新功能（Feature）

- **T28 — autoIngest API 重构 + Stage 0 人审 + 4-stage 流式回显**：[`ingest.ts`、`ingest-stream-hooks.ts`、`chat-message.tsx`、`ingest-queue.ts`] `autoIngest()` 新增 `AutoIngestOptions = { preAnalysis?, stream? }`：① `preAnalysis` 给定时 Stage 1 跳过 LLM 调用，直接用作分析输出进 Stage 2，避免与 Stage 0 chat 分析重复；② `IngestStreamHooks { onStageStart, onStageToken, onStageEnd }` 把 4 个 stage 的 LLM 流式 token 推到 chat，每个 stage 表现为独立 assistant 消息。Chat 面板的 `SaveToWikiButton` ingest 模式分支重写：拿 chat 对话（Stage 0 分析 + 用户补充）合成 `preAnalysis` 字符串 → 直传 `autoIngest()`，**不再写 `wiki/查询/${slug}.md`**；按钮文字 ingest 模式下显示「执行写入」（普通模式仍是「Save to Wiki」）。`ingest-queue.ts` 批量场景注入 stream hooks，每个文件前缀加 `[filename]` 区分多文件并行回显。新增 `src/lib/ingest-stream-hooks.ts` 共享 chat 流转工具。
- **T27 — 写入前 sanity 校验**：[`page-name-validator.ts`、`chat-message.tsx`、`deep-research.ts`] 新增 `src/lib/page-name-validator.ts`：① `validatePageTitle()` hard-block 垃圾 title（「好的，以下」「好的，这是」「<think>」「```」「Save to Wiki」「filename」、空字符串、过长 >200）；② `makeSlug()` **保留中文字符**（旧算法 `replace(/[^a-z0-9\s-]/g, "")` 把中文全 strip → 空 slug → `-2026-05-10.md` 退化命名，这是垃圾文件的根因），只去 Windows 禁用字符 `\\/:*?"<>|` + 控制字符 + 折叠空白；③ `validateSlug()` 拒空/过短 slug。Chat 普通模式 Save to Wiki + Deep Research 写 queries 前都走这套校验，垃圾 title 直接 Toast 错并中止写入。
- **T26 — wiki/源文档/ + wiki/查询/ 历史垃圾清理工具**：[`garbage-detector.ts`、`cleanup-garbage.ts`、`cleanup_garbage.rs`、`cleanup-garbage-dialog.tsx`] Settings 步骤 4 新增按钮「清理历史垃圾页」。识别规则覆盖 13 种 title 模式、14 种文件名模式、2 种 body 内容模式，例如：① title 以「好的，X」（以下/这是/我/现在/让我/这边/我来/这就/没问题/收到 等）开头、`<think>`/```、`Source: xxx` 兜底命名、`queries/`/`entities/`/`concepts/` 路径残留、「以下是」「这份」「你可以」LLM 模板；② 文件名空 slug（支持 `-N` 后缀如 `-2026-05-06-1.md`）、单字符+日期（如 `2-2026-05-06.md`）、`think-日期`/`wiki-日期`/`markdown-日期`/`save-to-wiki-` 起手、双 `--` 空字段拼接（如 `research--2026-04-22.md`）、8 位数字日期起手（如 `20260503ai53md-...`）、「好的」/「这份」中文开头、日期+中文长串描述；③ body 含 `<think>` 推理过程残留、`[Binary file: ...]` 兜底占位。命中文件归档到 `wiki/.conflicts/garbage-{源文档|查询}/`（**不删除**，可恢复）。前置检查 schema_version=1。Rust 端 zip 备份全 wiki/ 到 `.llm-wiki/backups/cleanup-garbage-*.zip`；TS 端主循环按 frontmatter parse + detector 判定 + `renameFile` 归档。

### 改进（Improvement）

- **Settings 推荐执行顺序**：步骤 1 Schema v1 迁移 → 步骤 2 清理 body 残骸 → 步骤 3 归一化目录 → **步骤 4 清理历史垃圾页**。每个 dialog 标注前置依赖与原因。
- **start.ps1 启动前清理残留端口**：[`start.ps1::Stop-StalePort`] 上次崩溃/强关后 Vite (1420) 或 Clip server (19827) socket 未释放，导致 `npm run tauri dev` 报 `Port 1420 is already in use`。启动前用 `Get-NetTCPConnection` 查端口监听者 PID，`Stop-Process -Force` 终止后 sleep 500ms 释放 socket。每个杀的进程打印 PID + 进程名便于审计。
- **autoIngest stage helpers 全部支持 onToken 回调**：[`runAnalysisStage`/`runPlanStage`/`runUpdateStage`/`runCreateStage`] 四个 stage 内的 `streamChat` onToken 都包装外传，stage 2/3/4 的内部 LLM 输出也能在 chat 流式回显，全程透明可观察。

### 修复（Bug Fix）

- **修复 v0.10.1 Save to Wiki 的 chat 中间垃圾文件污染**：[`chat-message.tsx:165 SaveToWikiButton`] 旧流程把 chat 回复**先**写到 `wiki/查询/${slug}-${date}.md` 作为 autoIngest 输入，再让 autoIngest 4-stage 处理。slug 算法对中文 unfriendly → 大量 `-2026-05-10.md` 空 slug + `好的，X` 中文起手垃圾文件。T28 改为 chat 内容直接 inline 传入 autoIngest（`preAnalysis` 参数），**不再产生中间文件**。`wiki/查询/` 从此专属于 Deep Research 输出（真用户查询）。
- **修复 normalize_dirs root file moves 计划入 report 但实际未执行**：[`normalize_dirs.rs:162-181`] 原代码 `planned_moves` 调 `execute_move` 但 `root_moves`（如 `position-tracking.md → 查询/`、`trading-rules.md → 策略/`）只 push 到 report 没真正调 `fs::rename`。改为 `planned_moves.iter().chain(root_moves.iter())` 一起执行。
- **修复 v0.10.1 garbage-detector 规则覆盖不全**：v1 只识别「好的，以下」/「好的，这是」漏了「好的，我/现在/让我/...」分支；只识别 `Source: save-to-wiki` 漏了 `Source: think/research/...`；空 slug 正则 `^-\d{4}-\d{2}-\d{2}\.md$` 漏了 `-N` 后缀（如 `-2026-05-06-1.md`）；没有 `think-日期`/`wiki-日期`/`markdown-日期` 等 chat slug 残留模式；没有 body 内容检测。v2 扩展到 13+14+2 三类规则共 29 种命中模式，单测 150 个用例全过（新增 36 个 v2 用例）。

---

## v0.10.1 — 2026-05-11

> v0.10.0 落地后用户验证发现 plan §2 表内"type 枚举不统一"和"sources 文件名是噪音"两条只在 frontmatter 字段层解决，物理目录结构与 body 老 frontmatter 残骸未处理。本版补齐两个一次性清理工具。

### 新功能（Feature）

- **物理目录归一化工具（T24）**：[`normalize_dirs.rs`、`normalize-dirs.ts`、`normalize-dirs-dialog.tsx`] Settings 新增按钮 `归一化 Wiki 目录结构`：把散乱目录（`个股档案/`→`股票/`、`concept/`→`概念/`、`市场模式/`/`市场环境/`/`进化/`/`预测/`→`模式/`、`people/`→`人物/`、`analysis/`/`synthesis/`/`comparisons/`→`总结/`、`queries/`→`查询/`、`sources/`→`源文档/`）合并到 9 个 canonical 中文目录。Rust 端做 zip 备份 + `fs::rename` + 全局 wikilink 替换（`[[进化/X]]` → `[[模式/X]]`，**避开代码块**）+ 空目录清理 + 垃圾目录归档（如 LLM 残留的 `好的，以下是完整的 [[策略/`）。TS 端做 frontmatter `type` 字段强制覆写（物理路径=真相）。**跨目录重名冲突**按 frontmatter `updated` 比较，保留较新版，旧版移到 `wiki/.conflicts/<原相对路径>`。报告含合并目录数、移动文件数、冲突归档清单、wikilink 替换数、未识别项、删除空目录数，支持下载 JSON。前置检查：必须全库 `schema_version=1`，否则拒跑并提示先跑 Schema v1 迁移。
- **Body 老 frontmatter 残骸清理工具（T25）**：[`body-residue.ts`、`cleanup-body-residue.ts`、`body_residue.rs`、`body-residue-dialog.tsx`] Settings 新增按钮 `清理 body 残骸`：扫所有页 body 头部 ±20 行，识别老格式 frontmatter 残骸（如 `***`+字段、` ``` `+`---`+字段）。从严匹配（≥3 行字段结构 + 明确终止符 + 无 markdown 标题穿插），剖完后 cleanedBody < 50 字符或剖掉内容含标题则标 uncertain 不动。**抢救** sources/tags/aliases 三类 list 字段，merge 进现有 frontmatter（去重）。13 个单测覆盖正/负/边界样本（传艺科技 `***` 起头、预测开盘 ``` 起头 + sources 抢救、中文字段 `预测日期`/`验证日期` 兼容、heading 误判保护、过短保护等）。前置检查同 T24。

### 改进（Improvement）

- **Settings 三步推荐执行顺序**：步骤 1 `Schema v1 迁移` → 步骤 2 `清理 body 残骸` → 步骤 3 `归一化目录结构`。每个 section 描述里标注步骤号与依赖关系，避免顺序错乱。
- **共享前置检查工具**：[`precondition.ts::verifyAllSchemaV1`] T24/T25 复用，遍历 wiki/ 校验所有非 housekeeping 页 schema_version=1，报告前 20 个不合规页面路径。
- **`.conflicts/` 隔离区设计**：跨目录重名不强行覆盖、不删旧版，全部进 `wiki/.conflicts/<原路径>`，让用户手动审 diff 后再决定保留哪个。所有备份/扫描操作排除 `.conflicts/`。

### 修复（Bug Fix）

- **修复 v0.10.0 plan §2 表内"type 枚举不统一"未真正解决**：v0.10.0 只归一化了 frontmatter `type:` 字段，物理目录仍然散落（`wiki/进化/`、`wiki/市场模式/` 等共 12+ 个）。T24 一次性合并到 9 个 canonical 目录。
- **修复 v0.10.0 plan §2 表内"body 残留旧 frontmatter"未处理**：实测 `wiki/股票/传艺科技.md` 等文件 body 起点残留整段老 frontmatter（顶部新 frontmatter 正常，body 第一行起又有 `*** + title:` 段），原因是 `stripYamlWrapper` 只剥一层，老格式双重包裹/`***` 分隔变体漏到 body。T25 一次性清理。

---

## v0.10.0 — 2026-05-11

> Wiki Schema v1 规范化：frontmatter 升级为可校验、可检索、可信任的结构化层；新增 PostgreSQL 股票代码集成、LLM 输出 schema 校验+重试、一次性迁移工具、健康检查 lint。

### 新功能（Feature）

- **Wiki Schema v1 规范化**：[`schema.ts`、`schema.test.ts`] 新增 `src/lib/schema.ts` 内核，定义 9 种 type 锁死枚举（股票/概念/策略/模式/错误/人物/总结/查询/源文档）、4 种 status（活跃/观察/归档/废弃）、3 级 confidence（高/中/低）、4 级 momentum（热/活跃/降温/已死）。导出 `validate()` / `parseFrontmatter()` / `serializeFrontmatter()` / `cleanSources()` / `normalizeTypeAlias()` / `inferTypeFromPath()` / `canonicalSampleFor()` / `nowLocalTimestamp()` 等工具。36 个单元测试覆盖必填字段、字数边界、CJK 字数、wikilink 格式、type 别名归一化等。
- **PostgreSQL 股票代码集成**：[`settings.rs`、`stock_codes.rs`、`stock-codes.ts`、`settings-view.tsx`、`App.tsx`] Save to Wiki 写股票页时由 NAS 上的 `cn_stock_db.cn_stock_name_wind` 表覆写 `code` 字段（LLM 实测会瞎编：爱迪特→sz301387，DB 真值 SZ301580）。新增 Settings 页 `PostgreSQL 股票代码源` 面板（host/port/user/password/database），点 `立即刷新` 会拉全表 ~6258 条到 `{project}/.llm-wiki/stock-codes.json` 缓存。应用启动+项目打开时后台自动同步（24h 缓存，失败不阻塞 UI）。Rust 端用 `tokio-postgres` 直连。
- **Frontmatter validate + LLM 重试机制**：[`ingest.ts::repairBlock`、`repairAndWriteBlocks`、`buildRetryPrompt`] Stage 3/4 每个 FILE block 解析后立即跑 `validate()`：违规则用 retry prompt（含原始 block + 违规清单 + canonical sample）让 LLM 重写 frontmatter，强制"正文一字不改"。最多重试 3 次，活动面板子项右侧实时显示 `重试中 N/3` 黄色 badge。股票页强制 DB 覆写 code；DB 查不到则该 plan item 标 error 并附"DB 中查不到股票 X 的代码"，不阻塞其他页面。
- **Stage 3/4 Prompt 集成 schema**：[`ingest.ts::buildSchemaSection`、`buildUpdatePrompt`、`buildCreatePrompt`] 新增 `buildSchemaSection(types, nowTs)`，prompt 头部嵌入完整 Schema v1 说明（必填字段、type 专属字段、格式约束、type-specific canonical sample）。强调："Never wrap the frontmatter in ```yaml"、"code 由系统覆写"、"summary 50-120 字不复读正文"、"related 必须 [[type/name]] 形式"、"时间戳 YYYY-MM-DD HH:mm:ss"。移除老的"frontmatter 自由发挥"提示。
- **Schema v1 一次性迁移工具**：[`migrate.rs`、`migrate-schema-v1.ts`、`migrate-schema-dialog.tsx`] Settings 新增按钮 `迁移 Wiki 到 Schema v1`：确认对话框 → Rust 端 zip 备份 `wiki/` 到 `.llm-wiki/backups/migrate-schema-v1-<ts>.zip` → TS 端串行处理每个 .md：去 ```yaml 包裹、type 归一化（市场模式/进化/预测→模式 等）、补 schema_version/aliases/summary/last_reviewed/confidence/status 默认值、清洗 sources（去 LLM 回复前缀、去 .md 后缀、去 -1/-2 重复）、股票页查 DB 覆写 code、时间戳补秒（2026-04-23 → 2026-04-23 00:00:00）。进度条显示当前文件，完成报告区分迁移/失败/查不到 code 的股票，并支持下载 JSON 报告。
- **Wiki 健康检查 (Schema Lint)**：[`lint.ts::runSchemaLint`、`lint-view.tsx`] Lint 页面新增 `schema` 类型问题（图标 FileCog）：检查缺必填、type/status/confidence 枚举越界、summary 字数、related wikilink 合法、related 目标存在、时间戳格式、股票页 code、标题与文件名一致、残留 ```yaml 包裹。结果按 severity 分组显示，点击跳转对应页面。

### 改进（Improvement）

- **Save to Wiki 生成的 frontmatter 100% 合规**：Stage 4 写入前所有 wiki 内容页强制经过 validate + repair，任何 fatal 违规都通过 LLM 重试自动修复，最坏情况标 error 而非污染知识库。
- **type / status / confidence 枚举锁死**：禁止 LLM 自创 `市场模式`/`进化`/`预测` 等同义目录，统一归并到 `模式`；`分析`/`比较`/`synthesis` 统一归并到 `总结`。
- **新增 schema 关键字段**：`schema_version: 1` 区分版本；`summary` 50-120 字概括便于 embedding 召回；`aliases` 提升一词多名召回（DeepSeek V4 / DSv4 / 深度求索）；`last_reviewed` 与 `updated` 解耦，支持"30 天未复核"提醒。
- **重试 prompt 强制保留正文**：[`ingest.ts::buildRetryPrompt`] 否则 LLM 借机重写正文，每次都不一样，用户失去信任。
- **PlanItem 显示重试 badge**：[`activity-store.ts::PlanItem.note`、`activity-panel.tsx`] PlanItem 新增 `note?: string` 字段，校验重试时实时显示 `重试中 N/3`，完成后自动清除。

### 修复（Bug Fix）

- **修复 365 个老页面 ```yaml wrapper bug**：[迁移工具] 此前 365/495 文件的 frontmatter 被错误的 ```yaml 代码块包裹（不是合法 frontmatter）。`parseFrontmatter()` 自动识别并剥离 wrapper，迁移工具会一次性清掉所有存量。
- **修复股票 code 字段 LLM 瞎编**：[`stock_codes.rs::lookup_stock_code`、`ingest.ts::repairBlock`] LLM 写的 code 实测错误（爱迪特 sz301387 ≠ DB 中 SZ301580），现强制由 DB 覆写。Save to Wiki 与迁移工具均执行此覆写。
- **修复 sources 字段污染**：[`schema.ts::cleanSources`] `好的，以下是-2026-05-08.md`、`]]-页面内容...md` 这类 LLM 回复前缀截出来的垃圾文件名被自动剔除；`.md` 后缀去除；`-1`/`-2` 重复后缀去除；超长名截断。

---

## v0.9.1 — 2026-05-11

### 修复（Bug Fix）

- **修复新用户克隆后编译失败**：[`start.ps1`、`.gitignore`、`README.md`、`README_CN.md`] `lancedb` → `lance-encoding` 在 Windows 上编译需要 `protoc`，新用户跑 `start.cmd` 会卡在 `Could not find 'protoc'`。`start.ps1` 现增加 `Ensure-Protoc` 段：优先用 PATH 里已有的 `protoc`，否则检查 `.cache/protoc/bin/protoc.exe`，再否则自动从 GitHub Releases 下载 `protoc-28.3-win64.zip` 解压到本地缓存，最后导出 `$env:PROTOC`。整个过程对用户透明，仅首次启动多 ~3 MB 下载。`.gitignore` 同步排除 `.cache/`，README 中英双版安装小节注明此行为。

---

## v0.9.0 — 2026-05-11

> Save to Wiki 完整重构：从一次性"生成—覆盖"流程升级为 4 阶段 agent loop，新增网络重试、断点续连、宽松解析、可视化进度，杜绝旧页面被无脑覆盖与瞬时网络抖动导致的全流程失败。

### 新功能（Feature）

- **Save to Wiki 改为 4 阶段 agent loop**：[`ingest.ts`、`activity-store.ts`、`activity-panel.tsx`] 旧流程一次性让 LLM 输出所有 FILE 块然后整批写入，凡是同名已有页面都被无差别覆盖，历史内容丢失。现拆为：
  - **Step 1 分析源文档** → 结构化分析文本
  - **Step 2 规划变更** → JSON 计划，明确每个页面是新建还是更新
  - **Step 3 更新已有页面** → 每页独立一次 LLM 调用，prompt 注入现有正文并要求"必须保留全部已有内容"
  - **Step 4 新建页面 + 索引/概览/日志** → 单次批量生成新建页面 + 重写 index/overview + 追加 log

  Activity 面板按阶段分组显示：4 个 Step 头始终可见，已完成打 ✓；Step 3/4 下方挂每个文件子项，独立 ✓/⟳/✗，点击可跳到对应页面。"新建"与"更新"在子项上用 ➕（emerald）/✏️（blue）/📄（amber 追加）区分。

- **网络错误自动重试 + 断点续连**：[`retry.ts`、`ingest-checkpoint.ts`、`ingest.ts`] 此前任一 Stage 网络抖一下整个 Save to Wiki 就失败，重新点击要从头跑 5-10 分钟。现在：
  - 每个 stage 内的 streamChat 调用自动重试（瞬时错误 3 次，3s/8s 指数退避；HTTP 5xx/429/timeout/Load failed/Connection lost 才重；4xx 与用户取消不重）。
  - 每个 stage 完成后按 source-content sha256 落盘到 `.llm-wiki/ingest-state/<hash>.json`。Stage 3 单页成功立即写，不丢已完成进度。
  - 重新点击 Save to Wiki 同源 hash → 自动跳过 Stage 1/2、跳过 Stage 3 已写页面、从断点继续。全流程成功后 checkpoint 自动清理。
  - 重试期间 UI 显示 `"网络错误，3s 后重试（第 2/3 次）"`。

- **新增调试日志基础设施**：[`debug-log.ts`、`fs.rs::append_file`] 前端调用 `debugLog(level, tag, message, data)` 会写到 `<project>/.llm-wiki/debug.log`（500KB 自动滚动保留尾 200KB）。ingest 过程的所有重试事件、未解析的 LLM 响应、缺失的 housekeeping 页面都会被记录，方便后续排查"为什么这个页面没更新"。

- **Codex Responses API native HTTP fallback**：[`llm-providers.ts`、`llm-client.ts`] Tauri WebView 跨域 fetch 在多数中转站上直接 "Failed to fetch"。现 Codex provider 增加 `parseNonStreamingResponse` 参数，fetch streaming 失败时自动改走 Rust `reqwest` 非流式请求（与 OpenAI 兼容 provider 同款 fallback 路径），但响应仍按 Responses API 三段式宽松解析（top-level `output_text` / `output[].content[].text` / chat-completions 归一化 shape）。

### 改进（Improvement）

- **宽松 FILE 块解析**：[`ingest.ts::parseFileBlocks`] 旧解析器要求 LLM 每个 FILE 块都正确闭合 `---END FILE---`，但 Codex GPT-5.5 在长输出（8000+ 字符）时偶发漏写关闭标记，整段内容被丢。现按 `---FILE:` 开始切段，缺关闭标记时截到下一个 `---FILE:` 或文本末尾，挽救了实测 18 页里偶发 2 页失败的真因。

- **Stage 2 Plan Prompt 收紧**：[`ingest.ts::buildPlanPrompt`、`buildAnalysisPrompt`] 此前源文档明确列出"可考虑新建页面"时，LLM 经常按"可选"过滤掉。现 Plan prompt 加 CRITICAL 段：所有 `建议更新` / `建议新建` / `可考虑新建` / `可新建` / `应新建` / `should create` / `recommend creating` 标签下的路径必须进 plan，`[模式/xxx](wikilink:模式/xxx)` 这种格式自动转 `wiki/模式/xxx.md`。Analysis prompt 的 Recommendations 段也拆成两个明确子节，强制 LLM 列出完整路径 + 类型 + 一句话理由。

- **Stage 4 housekeeping 子项可见**：[`activity-store.ts::PlanItem`、`ingest.ts`、`activity-panel.tsx`] 此前 `index.md` / `overview.md` / `log.md` 这三个永远在 Stage 4 处理的文件不在 plan 里，UI 不可见。现合成 3 个固定 stage-4 子项独立显示。Stage 4 写完后核对 LLM 是否真的产出这 3 个文件，缺失会标红 + 写 debug.log，杜绝"Step 4 跑得太快是不是没做"的猜疑。

- **normalizePlan 兜底**：[`ingest.ts::normalizePlan`] LLM 把新页面错放进 update 但文件不存在时，之前会被静默丢弃。现自动移到 create 并按路径推断 type/title，"建议新建"的页面再也不会消失。

- **源文件去重**：[`chat-message.tsx`] 此前 Save to Wiki 失败重试时，每次会因为命名冲突生成 `xxx-1.md`、`xxx-2.md` 脏数据，原文件还在。现保存前对比内容：同名且内容相同则复用文件名，仅当内容真正不同才递增后缀。

### 修复（Bug Fix）

- **修复 FILE_BLOCK_REGEX 漏匹配 kebab-case 路径**：[`ingest.ts`] 旧正则 `[^\n-]+?` 把路径里的 `-` 也排除掉了，导致 `wiki/模式/foo-bar.md` 这类 kebab-case 文件名根本无法解析为 FILE 块路径。改为 `.+?` 后任何合法路径都能匹配。

- **修复 writeFileBlocks 在路径偏差时丢内容**：[`ingest.ts`] 单 FILE 块场景下若 LLM 输出的路径与 expectedPath 不一致（例如多了/少了前缀），现接受内容并按 expectedPath 写入，并记录 warn 日志，避免因为路径标点小差异让整页内容白生成。

---

## v0.7.8 — 2026-05-10

### 新功能（Feature）

- **新增 Codex (Responses API) provider**：[`llm-providers.ts`、`settings-view.tsx`、`wiki-store.ts`] 支持 OpenAI Responses API `/v1/responses` 端点，覆盖 GPT-5 / Codex 系列推理模型（`gpt-5.4`、`gpt-5.3-codex` 等）。Settings 选 Codex 后填中转站 base URL（如 `https://api.suyacode.com`）+ API key + Reasoning effort（minimal / low / medium / high）即可使用，URL 自动拼接 `/v1/responses`，鉴权 `Authorization: Bearer` + `openai-beta: responses=experimental`。请求体走 Responses API 专用形态：`instructions` 字段承载 system 文本、`input` 数组用 `input_text` / `output_text` 区分用户与历史回复、`reasoning.effort` 控制思考深度、SSE 流解析 `response.output_text.delta` 事件。

### 修复（Bug Fix）

- **修复中转站只配 Codex 额度时返回 503 `no_available_providers`**：[`llm-providers.ts`] 此前所有 OpenAI 兼容请求都走 `/v1/chat/completions`，但 claude-code-hub 体系（含 suyacode）将 GPT-5 / Codex 系列归类为 `providerType="codex"`，**只能从 `/v1/responses` 端点路由**。两个池子（openai-compatible / codex）匹配不上时直接 503。现新增独立 Codex provider 走正确端点，问题根除。

---

## v0.7.7 — 2026-05-10

### 新功能（Feature）

- **新增 Kimi Code 一等公民 provider**：[`llm-providers.ts`、`settings-view.tsx`、`wiki-store.ts`] 选择 "Kimi Code" 后自动预填 base URL `https://api.kimi.com/coding/v1` 与默认模型 `kimi-for-coding`（256K 上下文）。鉴权走标准 `Authorization: Bearer sk-xxx`，请求体为 OpenAI 兼容流式 `/chat/completions`。如需通用 Kimi（moonshot-v1-* 系列），在 endpoint 输入框填 `https://api.moonshot.cn/v1` 并改 model 即可，customEndpoint 字段会覆盖默认值。
- **设置页新增连接测试与 URL 预览**：[`settings-view.tsx`、`llm-test.ts`] 借鉴 Claude Code Hub 的 provider 配置体验，在 LLM Provider 卡片底部新增三处可见性优化：
  - **API Key 眼睛图标**：默认遮罩，点击切换显示。中转站 key 经常被截断，这下能直接核对尾几位是否粘对。
  - **最终请求 URL 实时预览**：根据当前 provider + endpoint + model 实时拼出真实请求路径并展示，附一键复制。彻底消除"我填的 base URL 粒度对不对"的困惑。
  - **测试连接按钮**：一键发送最短消息，命中首 token 即判定连通，显示首 token 延迟或 HTTP 状态码与错误正文。15s 超时，不会保存表单修改。能在不离开设置页的情况下定位 401/403/超时/路径错误。

### 改进（Improvement）

- **OpenAI 兼容 provider 自动 native HTTP fallback**：[`llm-client.ts`、`llm-providers.ts`] Tauri WebView 在 Windows/macOS 下对 fetch 跨域请求受 CORS preflight 限制，国内多数 provider（Kimi、MiniMax、部分中转站）未开放浏览器跨域访问，直接报 "Failed to fetch"。现在 fetch 失败且错误形如 `Failed to fetch` / `Load failed` / `NetworkError` 时，OpenAI 兼容 provider（OpenAI / Ollama / MiniMax / Kimi / Custom）自动调用 Tauri native HTTP（reqwest）非流式重试，绕过 WebView CORS。CORS 友好的 provider（如 OpenAI 官方、CORS-enabled 中转站）保持 fetch 流式输出体验不变；Anthropic / Google 因响应格式差异不参与 fallback。
- **OpenAI 与 Anthropic 支持自定义 endpoint**：[`llm-providers.ts`、`settings-view.tsx`] 此前两者的请求 URL 在代码中写死，无法走中转/代理。现复用既有 `customEndpoint` 字段，与 MiniMax 同款做法 —— 设置面板针对 `openai`、`anthropic` 也显示 endpoint 输入框，留空使用官方地址，填写时按 base URL 粒度（如 `https://api.openai.com/v1`、`https://api.anthropic.com`），代码内部分别拼接 `/chat/completions` 与 `/v1/messages`。
- **Anthropic 自定义 endpoint 鉴权头适配中转站**：[`llm-providers.ts`] 此前同时发送 `x-api-key` 和 `anthropic-dangerous-direct-browser-access`，多数中转站（oneapi、new-api、aiproxy、claude-code-hub 等）会因「冲突的双份凭据」或不识别的浏览器直连标记直接 403。现在区分官方 vs 中转：官方继续用 `x-api-key` + 浏览器直连标记；自定义 endpoint 时只发 `Authorization: Bearer <key>` + `anthropic-version`，与 Claude Code Hub `headers.ts` 的 `resolveAnthropicAuthHeaders` 同款策略。

---

## v0.7.6 — 2026-04-25

### 修复（Bug Fix）

- **修复交割单导入预览确认后未解析记录**：`parseTradeRecordsWithMapping` 返回空数组的深层原因修复。
  - `normalizeDate` 和 `looksLikeDate` 新增对 Excel 序列日期以字符串形式返回的解析（Rust 后端 `calamine` 将数字转为字符串后原函数无法识别）。
  - `parseDirection` 和 `looksLikeDirection` 补充更多券商方向别名（买入开仓、卖出平仓、平仓等）。
  - `parseTradeRecordsWithMapping` 的 `maxCol` 检查改为仅检查必需列，避免可选列（如 `time`）导致有效数据行被跳过。
  - 新增 `skipReasons` 返回，导入失败时弹窗直接展示前 10 条跳过原因，无需打开控制台即可定位问题。
- **恢复 custom provider 流式输出**：PR #4 为修复 custom endpoint 连接问题强制切换为 native HTTP 非流式请求，导致回复一次性返回。现恢复为 `fetch` 流式请求，所有 provider 默认均使用标准 `ReadableStream` 实现逐字输出。

---

## v0.7.5 — 2026-04-23

### 修复（Bug Fix）

- **修复自定义 LLM 端点连接失败**：`llm-providers.ts` 避免重复拼接 `/chat/completions`，`llm-client.ts` 对自定义 OpenAI 兼容服务改用 Tauri 原生 HTTP 请求，绕过 WebView 流式请求兼容问题，并保留超时与取消处理。

---

## v0.7.4 — 2026-04-23

### 修复（Bug Fix）

- **修复交割单导入 Excel 公式格式解析**：券商导出的 `.xls` 文件中所有字段被 `="..."` 包裹（如 `="卖出"`、`="002124"`、`="天邦食品"`），导致方向全部识别为买入、代码和名称显示异常。新增 `stripExcelFormula()` 统一去除 `="..."` 包装，修复日期、代码、名称、方向、时间字段的解析。
- **修复交割单导入 YYYYMMDD 日期格式**：日期列为 `20260423`（无分隔符），原 `normalizeDate()` 无法识别。新增 8 位数字紧凑日期格式解析。

---

## v0.7.3 — 2026-04-22

### 新功能（Feature）

- **OpenClaw 协作包**：新增 `collab/` 目录，支持与 OpenClaw 多 Agent 自动化协作。
  - 每日 18:00 自动生成市场复盘报告（大盘环境、主线板块、情绪周期、明日计划）
  - 持仓追踪自动更新（`wiki/position-tracking.md`）
  - 交易规则自动检查（仓位、风控、情绪信号）
  - 周度/月度 Lint 定时任务
  - 数据保留策略（日报 90 天、交割单 365 天、持仓快照 30 天）

### 修复（Bug Fix）

- **修复交割单导入预览对话框无法滚动**：`trade-import-preview.tsx` 中 `DialogContent` 布局导致 `ScrollArea` 失效，确认按钮被推出视口。已重构 flex 布局，确保内容可滚动且按钮始终可见。

---

## v0.7.2 — 2026-04-22

### 新功能（Feature）

- **Wiki 整理医生**：新增 Wiki Doctor 工具，自动扫描并整理 Wiki 目录结构。
  - 自动检测并修复混合格式链接（如 `[[英维克]]` → `[[股票/英维克]]`）
  - 根目录松散文件自动归类到对应子目录
  - 拼音文件名智能识别并建议中文重命名
  - 文件冲突检测与手动确认机制
  - 自动备份，执行前生成完整备份

### 修复（Bug Fix）

- **修复 Wiki 链接解析不支持中文目录**：`chat-message.tsx` WikiLink 组件、 `wiki-graph.ts` 和 `graph-relevance.ts` 的链接解析仅搜索英文目录（entities/、concepts/ 等），未覆盖中文目录（股票/、概念/ 等）。已统一支持中英文目录及带前缀链接（如 `[[股票/英维克]]`）。
- **修复交割单导入伪 Excel 格式识别失败**：券商导出的 `.xls` 文件实为 GBK 编码 TSV 文本（带 `="..."` 单元格包裹），原逻辑无法识别。新增伪 Excel 检测与 GBK TSV 解析路径。
- **修复交割单导入缺少日期列失败**：`20260422当日成交查询.xls` 等文件仅含 `委托时间`（HH:MM:SS）无日期列。新增从文件名提取日期（如 `20260422` → `2026-04-22`）作为 fallback 日期。

---

## v0.7.1 — 2026-04-21

### 修复（Bug Fix）

- **修复 Ingest 源摘要文件内容被截断**：`ingest.ts` 中当 LLM 未生成 `wiki/sources/` 文件时，fallback 源摘要页面将 analysis 硬截断到 3000 字符，导致内容不完整。已移除截断，完整写入。
- **修复 Ingest 源文件读取截断阈值过低**：`ingest.ts` 中源文件内容超过 50000 字符即被截断，导致 LLM 分析不完整。已提升到 100000 字符。

---

## v0.7.0 — 2026-04-21

### 新功能（Feature）

- **交割单导入预览对话框**：当自动表头识别失败时，弹出可视化预览对话框，通过数据内容探测推断列类型（日期、代码、方向、数量、价格等），用户可手动修正列映射后导入。解决不同券商表头格式差异导致的导入失败问题。
  - 三层识别策略：表头名匹配 → 数据内容探测 → 用户手动映射兜底
  - 实时显示置信度、样本数据、冲突检测
  - 支持无表头文件的内容推断

### 修复（Bug Fix）

- **修复 Write to Wiki 系统指令污染对话**：`ingest.ts` 中 `executeIngestWrites()` 将内部 writePrompt 作为用户消息插入对话。已改为静默调用 LLM，不在对话中显示系统指令。
- **修复 Deep Research 保存竞态**：`deep-research.ts` 添加 `savingTasks` Set 互斥锁，防止快速双击重复保存。
- **修复图谱位置缓存切换项目不清理**：`graph-view.tsx` 切换项目时自动清空 `positionCache`。
- **修复 LLM 请求 timeout 定时器泄漏**：`llm-client.ts` 在 `finally` 中清理 `timeoutId`。
- **修复 chat-store 接口缺失**：补全 `resetProjectState` 接口声明。

### 改进（Improvement）

- **交割单导入增强**：支持 `.txt` 格式、CSV GBK 编码自动检测、HTML 伪装 `.xls` 识别、扩展 50+ 列名别名。

---

## v0.6.9 — 2026-04-21

### 修复（Bug Fix）

- **修复 Write to Wiki 系统指令污染对话**：`ingest.ts` 中 `executeIngestWrites()` 将内部 writePrompt（包含 schema、index、格式指令等）作为用户消息插入对话，导致点击 "Write to Wiki" 后对话框出现大量系统指令。已改为静默调用 LLM，不在对话中显示 writePrompt 和 LLM 原始回复流，仅保留写入结果提示。
- **修复 Deep Research 保存竞态**：`deep-research.ts` 中 `saveResearchDraft()` 未做重复点击保护，快速双击可能导致同一文件保存两次。已添加 `savingTasks` Set 互斥锁。
- **修复图谱位置缓存切换项目不清理**：`graph-view.tsx` 的 `positionCache` 在切换项目时未清空，导致新项目节点使用旧项目的位置坐标，布局混乱。已添加项目路径变化检测并自动清空缓存。
- **修复 LLM 请求 timeout 定时器泄漏**：`llm-client.ts` 中 15 分钟超时定时器在请求完成后未清理。已添加 `timeoutId` 并在 `finally` 中清除。
- **修复 chat-store 接口缺失**：`ChatState` 接口未声明 `resetProjectState` 方法，但实现中存在。已补全接口声明。

### 改进（Improvement）

- **交割单导入增强**：`trade-import.ts` 支持 `.txt` 格式、CSV GBK 编码自动检测、HTML 伪装 `.xls` 识别、扩展 50+ 列名别名，覆盖更多券商导出格式。

---

## v0.6.8 — 2026-04-20

### 修复（Bug Fix）

- **修复 Deep Research 保存后重复 ingest**：`deep-research.ts` 中 `saveResearchDraft()` 对同一文件连续调用两次 `autoIngest`，导致重复生成 wiki 页面和 review items。已删除第二次调用。
- **修复聊天消息 ID 刷新后冲突**：`chat-store.ts` 使用模块级递增计数器生成消息 ID，页面刷新后计数器重置，可能和已有消息 ID 冲突。已改用 `Date.now() + 随机数` 生成唯一 ID。
- **修复 ingest 队列取消可能误删文件**：`ingest-queue.ts` 使用模块级 `lastWrittenFiles` 变量追踪当前任务写入的文件，取消时清理。但模块级变量在多任务快速切换时可能误删其他任务文件。已将任务状态封装为 `TaskContext` 对象，避免跨任务污染。
- **修复 LLM 请求 abort 监听器泄漏**：`llm-client.ts` 中 `streamChat` 每次调用都向外部 `signal` 添加 `abort` 事件监听器，但请求完成后从不移除。多次调用后监听器累积，可能导致内存泄漏。已在 `finally` 块中移除监听器。

### 改进（Improvement）

- **更新 CLAUDE.md**：新增测试规范、错误处理约定、性能红线、CLAUDE.md 自身维护规则四个章节。

---

## v0.6.7 — 2026-04-20

### 新增（浅色主题）

- **新增浅色主题（Light）**：设置面板 → 外观 → 浅色，白底黑字经典明亮主题。
- **全应用主题联动**：切换浅色/暗色时，以下组件自动适配：
  - **关系图（Graph View）**：节点标签、边线、高亮颜色根据模式自动切换深浅
  - **Markdown 编辑器（Milkdown）**：light 模式下显示黑字，dark 模式下显示白字
  - **文件预览**：`dark:prose-invert` 条件触发，light 下正常渲染
  - **Deep Research 面板**：合成结果预览同样条件适配
  - **Milkdown nord 主题覆盖**：新增 `:not(.dark) .milkdown-theme-nord` 规则，覆盖暗色默认样式
- **`.dark` 类自动管理**：`setAppTheme` 在 store 层直接操作 `document.documentElement.classList`，light 时移除 `.dark`，其他主题时添加。`App.tsx` 初始化时同步一次。

### 修复（Review 面板 + 代码质量）

- **修复 `createPageFromReview` 未定义**：`review-view.tsx` 中 `__create_page__:` 分支调用了不存在的函数，现在内联处理。
- **ReviewCard button key 唯一化**：`key={opt.action}` 在 option action 重复时会冲突，改为 `key={\`${opt.action}-${idx}\`}`。

## v0.6.6 — 2026-04-19

### 修复（Save to Wiki / Deep Research 卡死 + Activity 面板）

- **修复 Save to Wiki 卡死**：`chat-message.tsx` 中文件名递增逻辑使用 `while(true) + readFile try-catch` 检查文件是否存在。但 Rust 后端 `read_file` 在文件不存在时**不抛出错误**（返回 `"[Binary file: ...]"` 字符串），导致 while 循环无限递增、永不 break，`handleSave` 永远挂起，`autoIngest` 无法调用。已改用 `listDirectory` 获取目录列表后用 `Set.has()` 判断，彻底避免该问题。
- **修复 Deep Research Save to Wiki 卡死**：`deep-research.ts` 中存在相同的 `readFile try-catch` 文件名递增逻辑，同样会导致无限循环。已统一改用 `listDirectory` 检查。
- **修复 Review Save to Wiki 卡死**：`review-view.tsx` 中存在相同的无限循环问题，已统一修复。
- **修复 Activity 面板强制展开闪烁**：`useEffect` 依赖了 `expanded` 和 `hasQueue`，导致用户手动收起后面板立即重新展开，形成闪烁循环。已移除 `expanded`/`hasQueue` 依赖，仅在新任务启动（`runningCount` 从 `0` 变为 `>0`）时自动展开一次。
- **回滚 writeFileBlocks 目录白名单**：v0.6.4/v0.6.5 引入的目录白名单+跳过逻辑在实际使用中被证明过于严格，导致 LLM 生成的有效内容被丢弃。恢复为 v0.6.4 之前的原始行为 —— 直接写入 LLM 输出的路径，由 prompt 中的 schema 约束引导 LLM 行为。

## v0.6.5 — 2026-04-19

### 改进（Activity 面板 + 调试清理）

- **修复 Activity 面板强制展开闪烁**：移除 `expanded`/`hasQueue` 依赖，仅在新任务启动时自动展开一次。
- **移除调试日志**：清理 `chat-message.tsx`、`review-view.tsx`、`deep-research.ts`、`activity-store.ts`、`activity-panel.tsx` 中残留的 `console.log` 调试输出。
- **回滚 writeFileBlocks 目录白名单**：恢复为原始写入行为，由 schema prompt 引导 LLM。

## v0.6.4 — 2026-04-19

### 修复（auto-ingest 目录写入控制）

- **修复 auto-ingest 创建错误目录**：LLM 分析后不遵守 prompt 规则，创建了 `wiki/stocks/`、`wiki/concepts/` 等英文新目录，而不是使用已有的中文目录（`wiki/股票/`、`wiki/概念/`）。已在前端 `writeFileBlocks` 增加硬约束：
  - 只允许写入 wiki 下**已存在的子目录**
  - 自动将英文目录名映射为中文（如 `stocks` → `股票`）
  - 目标目录不在允许列表中时，**跳过写入**（不创建新目录）
- **保留 Save to Wiki 触发 auto-ingest**：这是核心功能，保存查询结果后自动提取概念、股票、策略并写入对应 wiki 目录。

---

## v0.6.3 — 2026-04-19

### 修复（Save to Wiki 自动分析提示消失）

- **修复 Save to Wiki 不触发 auto-ingest**：`SaveToWikiButton` 中 `autoIngest` 被 `llmConfig.apiKey` 条件静默跳过，导致左侧活动面板不出现"正在分析"的转圈圈提示。已移除该条件限制 —— 无论 LLM 是否配置，`autoIngest` 都会执行；若未配置，活动项会显示错误反馈而非静默跳过。
- **修复 Review 面板 Save to Wiki 缺少 auto-ingest**：`review-view.tsx` 中保存内容到 wiki 后未调用 `autoIngest`，已补齐。
- **修复 Deep Research 保存后缺少 auto-ingest**：`deep-research.ts` 中研究任务保存后未调用 `autoIngest`，已补齐。

---

## v0.6.2 — 2026-04-19

### 修复（Markdown 暗色主题 + Save to Wiki 覆盖 + 交互清理）

- **修复 Milkdown 编辑器白底白字**：Milkdown nord 主题使用 `@media (prefers-color-scheme: dark)` 媒体查询，在手动主题切换下不生效，导致表格/代码块使用浅色背景。已添加 `.dark` / `[data-theme]` 覆盖规则强制暗色样式。
- **修复文件预览暗色主题**：`file-preview.tsx` 和 `wiki-editor.tsx` 容器显式添加 `bg-background text-foreground`，确保继承正确颜色。
- **修复 Save to Wiki 文件覆盖**：同一天多次保存相同标题的内容时，文件名完全相同导致覆盖。已添加自动递增序号（`-1`、`-2`…），并修复 `index.md` 中的 wikilink。
- **修复 setTimeout 泄漏**：CopyButton、SaveToWikiButton、PreviewPanel 手动保存、GraphView MutationObserver 中的 setTimeout 均未在组件卸载时清理。
- **修复聊天输入内存泄漏**：图片预览使用 `URL.createObjectURL` 但从未 `revokeObjectURL`，每次添加图片都会泄漏 blob 内存。
- **修复聊天自动滚动干扰**：消息变化时强制滚动到底部，打断用户查看历史消息。改为仅在用户已在底部（< 100px）时才自动滚动。

---

## v0.6.1 — 2026-04-19

### 紧急修复

- **修复 v0.6.0 运行时崩溃**：`chat-message.tsx` 中 `useChatStore.getState().queryPages` 引用了不存在的状态字段（正确应为 `lastQueryPages`），导致 `extractCitedPages` 读取 `undefined.length`，页面报 "Something went wrong"。

---

## v0.6.0 — 2026-04-19

### 修复（主题切换白屏 + 全项目 Bug 清理）

- **修复 v0.5.9 主题切换白屏**：`app-layout.tsx` 中使用了未声明的 `appTheme` 变量，导致 `ReferenceError`，React 崩溃白屏。
- **修复 ingest 异常状态泄漏**：`startIngest` / `executeIngestWrites` 中 `streamChat` 若直接抛异常，`isStreaming` 将永久为 `true`。已添加 `try-finally` 确保重置。
- **修复 ingest 文件写入卡死**：`autoIngest` 中 `writeFileBlocks` 未处理异常，activity 状态将永久停留在 "Writing files..."。已添加 `try-catch`。
- **修复聊天闭包陷阱**：`chat-panel.tsx` `handleSend` 的 `useCallback` 缺少 `project` 依赖，切换项目后消息仍发送到旧路径。
- **修复聊天滚动过度触发**：`useEffect` 依赖 `activeMessages`（每次渲染新数组引用），导致每次渲染都强制滚动。改为依赖稳定的消息数量。
- **修复 lastQueryPages 竞态**：将模块级可变变量 `lastQueryPages` 迁移到 `chat-store`，避免多请求并行时互相覆盖。
- **修复 clip-watcher 重复处理**：`setInterval` async 回调缺少防重叠机制，已添加 `isPolling` 锁。
- **修复 settings 页面 timer 泄漏**：保存成功的 `setTimeout` 未在组件卸载时清理。
- **修复 App 启动竞态**：`init()` 异步操作缺少取消机制，快速切换项目可能导致中间状态混乱。
- **修复 auto-save 订阅泄漏**：`setupAutoSave` 未保存 `subscribe` 返回值，HMR/重载时产生重复订阅。新增 `teardownAutoSave()`。
- **修复暗色主题未生效**：全局从未设置 `.dark` 类，导致所有 `dark:` Tailwind 变体失效。已在 App mount 时自动添加。
- **修复 trade-stats 除零风险**：FIFO 引擎中 `remaining / r.quantity` 在 quantity 为 0 时产生 `NaN`。
- **修复构建语法错误**：`ingest.ts` 中存在跨行双引号字符串未闭合，导致 Vite/Rolldown 构建失败。

---

## v0.5.10 — 2026-04-19

### 修复

- **Wiki 页面目录路由**：`buildGenerationPrompt` 强化目录分类规则：
  - frontmatter `type` 示例从英文改为中文值（`股票 | 策略 | 模式 | 错误 | 市场环境 | 进化 | 总结`），避免 LLM 跟随英文示例生成错误类型。
  - 新增明确的 type→directory 映射规则：`股票→wiki/股票/`, `策略→wiki/策略/` 等。
  - 新增规则要求 frontmatter `type` 必须与文件所在目录严格一致。
  - 文件名示例明确为中文，如 `wiki/股票/沃格光电.md`。

## v0.5.9 — 2026-04-18

### 新增

- **主题切换功能**：设置面板新增「外观」选项，支持 5 种预设主题：
  - **默认** — 经典暗色主题
  - **午夜蓝** — 深蓝调，经典交易终端风格
  - **墨绿** — 护眼墨绿，长时间盯盘更舒适
  - **深紫** — 优雅紫调，沉稳大气
  - **琥珀** — 暖琥珀色，温馨夜间氛围
  - 主题选择即时生效，自动持久化到本地存储。

## v0.5.8 — 2026-04-18

### 修复

- **文本格式 `.xls` 交割单无法导入**：部分券商导出的 `.xls` 实际是纯文本 TSV（GBK 编码、制表符分隔），`parseTradeExcel` 新增 fallback 直接按文本解析，不再依赖 SheetJS。
- **HEADER_MAP 扩展**：`transferFee` 增加 `其他杂费`、`杂费`、`其他费用` 别名。

## v0.5.7 — 2026-04-18

### 修复

- **卖出记录被过滤**：`parseDirection` 扩展支持 `-`、`-1`、`负`、`融券卖出`、`担保品卖出` 等卖出方向；增加 quantity 负数推断方向 fallback；quantity 统一取绝对值。
- **Wiki 英文目录问题**：`buildGenerationPrompt` 增加强制规则，禁止 LLM 在中文目录存在时创建英文等价目录；已迁移现有英文目录文件到中文目录。
- **Graph View 节点颜色**：增加 `entity`/`concept`/`comparison`/`query`/`synthesis` 英文类型的颜色映射，解决知识树全部显示为 "other" 的问题。
- **frontmatter type 强制中文值**：LLM 生成页面时，若 Schema 定义了中文类型（策略/股票/模式等），必须使用中文值而非英文 `entity`/`concept`。
- 交互修复：移除 `setOpeningPositions([])` 残留引用；交割单导入增加空记录/失败/不支持格式的明确提示；多文件导入汇总结果。

### 已知问题

- **macOS 安装提示"已损坏"**：当前版本缺少 Apple Developer 代码签名，macOS Gatekeeper 会阻止安装。
  - **绕过方法**：安装前在终端执行 `xattr -c /Applications/Trading\ Review\ Wiki.app`，或右键点击 app 选择"打开"。
  - 正式签名需要 Apple Developer 账号和 Notarization 配置，后续版本将解决。

---

## v0.5.6 — 2026-04-18

### 新增：交割单导入与统计看板

- **交割单 CSV/Excel 自动导入**：在 Sources 面板点击「导入交割单」，选择券商导出的 `.csv` / `.xlsx` / `.xls` 文件，自动解析并生成每日 markdown 交割单。
  - 支持 20+ 种表头别名自动识别（成交日期/证券代码/方向/数量/成交价/成交金额/手续费/印花税/过户费等）。
  - 双层扫描策略：前 50 行精确匹配 → 前 100 行评分 fallback。
  - 自动过滤撤单/废单、红利/送转/配股/中签等非交易流水。
  - 五维合法性校验（日期/代码/方向/数量/金额），异常时明确报错。
- **FIFO 盈亏计算**：基于先进先出原则逐笔匹配买入/卖出成本，自动计算每日和每只股票已实现盈亏。
  - **超卖保护**：当卖出数量超过已知买入持仓时，只计算匹配部分盈亏，并标记 `hasUnknownCost`。
  - **数据一致性原则**：不引入手工录入的"期初持仓"，完全依赖交割单导入的完整性保证准确率。
- **交易统计看板（Dashboard）**：
  - KPI 卡片：总盈亏、成交笔数、日均盈亏、胜率。
  - 月度盈亏柱状图、股票盈亏排行 Top 10、最近交易日明细表。
  - 当前持仓标签页：支持手动输入市价，实时计算浮动盈亏和市值。
  - 缺少成本基准时顶部显示 ⚠️ 提示，引导用户导入更早的交割单补全历史。
- **导入交互优化**：
  - 批量导入时逐文件汇总结果（成功/无记录/失败/不支持的格式）。
  - 解析 0 条记录时给出明确提示，告知用户检查文件格式和表头。
  - 跨文件 FIFO 连续性：同一批次导入的多个文件按顺序累积计算成本。

### 修复

- **卖出记录被过滤**：`parseDirection` 扩展支持 `-`、`-1`、`负`、`融券卖出`、`担保品卖出` 等卖出方向；增加 quantity 负数推断方向 fallback；quantity 统一取绝对值。
- **Wiki 英文目录问题**：`buildGenerationPrompt` 增加强制规则，禁止 LLM 在中文目录存在时创建英文等价目录；已迁移现有英文目录文件到中文目录。
- **Graph View 节点颜色**：增加 `entity`/`concept`/`comparison`/`query`/`synthesis` 英文类型的颜色映射，解决知识树全部显示为 "other" 的问题。
- **交互修复**：移除 `setOpeningPositions([])` 残留引用；交割单导入增加空记录/失败/不支持格式的明确提示；多文件导入汇总结果。
- `normalizeDate` 非日期输入返回 `""`（原返回脏字符串）。
- `normalizeDate` short-date 增加月份/日期范围校验，防止 `04/15/25` 被误解析为 `2004-15-25`。
- Dashboard `useEffect` 增加 `cancelled` flag + `dataVersion` 依赖，防止快速切换项目时的 race condition。
- 空状态不再阻断「当前持仓」标签页的访问。

---

## v0.5.5 — 2026-04-18

### 新增：Deep Research 人工审核

- **问题**：Deep Research 合成完成后直接自动保存到 Wiki，用户没有机会检查和修改。
- **实现**：
  1. 新增 `pending_review` 状态，位于 `synthesizing` 和 `saving` 之间。
  2. 合成完成后自动剥离 `<think>` / `<thinking>` 块，展示干净草稿预览。
  3. 用户可选择：**保存到 Wiki**、**重新生成**（复用原 topic + queries 重新排队）、**丢弃**。
  4. 保存时才执行文件写入和 auto-ingest，防止误操作污染 Wiki。

### 修复：彻底清理切换工作区后的状态残留

- **问题**：切换项目后，右侧面板仍显示旧项目的研究任务/文件预览/聊天流式状态，`activeView` 也未重置。
- **根因**：`handleSwitchProject` 和 `handleProjectOpened` 仅清空了 review/chat 的 conversations/messages，遗漏了 `fileContent`、`activeView`、`chatExpanded`、`researchStore.tasks`、`isStreaming` 等状态。
- **修复**：
  1. `chat-store` 新增 `resetProjectState()` 一键重置所有聊天相关状态。
  2. `research-store` 新增 `clearTasks()` 清空所有研究任务。
  3. `handleSwitchProject` 和 `handleProjectOpened` 统一调用上述方法，并额外重置 `setFileContent("")`、`setActiveView("wiki")`、`setChatExpanded(false)`、`setPanelOpen(false)`。

---

## v0.5.4 — 2026-04-17

### 修复：切换工作区后旧数据残留

- **问题**：更换工作区（或打开新项目）后，"待审阅"面板和聊天历史仍显示旧工作区的内容。
- **根因**：`App.tsx` 在加载新项目的 review/chat 数据时，若新工作区为空数组，由于 `if (savedReview.length > 0)` 的保护逻辑，`setItems` 未被调用，导致旧数据继续驻留在内存中。
- **修复**：
  1. `handleProjectOpened` 开头先清空 `reviewStore` 和 `chatStore`。
  2. 去掉空数组保护，直接 `setItems(savedReview)` / `setConversations(savedChat.conversations)`。
  3. `handleSwitchProject` 切回欢迎页时也同步清空相关 stores。

---

## v0.5.3 — 2026-04-16

### 修复：截图文件夹 PNG 图片无法显示 + 聊天图片引用路径错误

- **问题 1**：在 `截图` 文件夹中点击 PNG 图片，预览面板黑屏/空白，无法显示。
  - **根因**：`file-preview.tsx` 使用 Tauri 的 `convertFileSrc` 生成 asset URL，在 Windows 环境下该方式对本地图片的解析不稳定，常导致加载失败。
  - **修复**：弃用 `convertFileSrc`，改为通过 Rust `readFileBinary` 读取图片二进制，再用浏览器原生 `URL.createObjectURL` 生成 Blob URL 进行展示。此方案同时应用于 `ImagePreview`、`VideoPreview`、`AudioPreview`。
- **问题 2**：聊天窗口中用户发送的图片（保存为 `raw/截图/xxx.png`）在消息气泡里不显示。
  - **根因**：`chat-message.tsx` 的 `img` 渲染组件把 markdown 中的相对路径 `raw/截图/xxx.png` 直接传给了 `convertFileSrc`，但 `convertFileSrc` 要求绝对路径，导致 URL 非法。
  - **修复**：新增 `LocalImage` 组件，先根据 `project.path` 将相对路径解析为绝对路径，再通过 `readFileBinary` + `URL.createObjectURL` 加载并渲染。

---

## v0.5.2 — 2026-04-16

### 新增：聊天图片上传 + 截图文件夹图片预览修复

- **聊天窗口支持图片**：
  1. `chat-input.tsx` 支持拖拽、粘贴、点击上传图片（最多 5 张，仅接受 `image/*`）。
  2. 发送时自动将图片保存到 `raw/截图/YYYY-MM-DD-HH-MM-SS-filename.png`。
  3. 在用户消息中插入 markdown 图片引用 `![name](raw/截图/xxx.png)`，聊天历史可持久化显示。
  4. `chat-message.tsx` 的 `MarkdownContent` 新增 `img` 组件渲染，本地图片路径通过 `convertFileSrc` 安全转换，支持 Windows 反斜杠路径。
- **修复截图文件夹图片无法显示**：
  1. `file-preview.tsx` 中 `convertFileSrc` 接收的路径若含 Windows 反斜杠，会生成非法 asset URL。
  2. 已在 `ImagePreview`、`VideoPreview`、`AudioPreview` 中统一将反斜杠替换为正斜杠后再调用 `convertFileSrc`。
- **Rust 后端新增二进制写入命令**：`write_binary_file` command，支持前端直接把 `Uint8Array` 落盘到任意路径。

---

## v0.5.1 — 2026-04-16

### 修复：Save to Wiki 后个股文件错误创建在 entities/ 目录

- **问题**：用户点击聊天消息中的 **Save to Wiki** 后，`autoIngest` 的生成提示硬编码要求 LLM 把实体页放在 `wiki/entities/`，导致交易复盘项目中的个股档案被错误地写到了 `entities/`，而不是 `wiki/股票/`。
- **修复**：
  1. `ingest.ts` 的 `autoIngest` 在生成阶段前，先扫描 `wiki/` 下的实际子目录列表。
  2. 将子目录列表传入 `buildGenerationPrompt`，替换原有的硬编码 `wiki/entities/` 和 `wiki/concepts/` 指令。
  3. 新提示要求 LLM **根据 Wiki Schema 把页面放到正确的子目录**（如股票 → `wiki/股票/`、策略 → `wiki/策略/`、模式 → `wiki/模式/`、通用实体 → `wiki/entities/` 等）。

---

## v0.5.0 — 2026-04-16

### 改进：System Prompt 明确告知 LLM 保存能力

- **问题**：用户在聊天中要求 LLM "写入反思"时，LLM 回复"我没有手，不能直接创建文件"，导致体验断裂。
- **修复**：在 `chat-panel.tsx` 的 system prompt 中新增 **"保存到 Wiki"** 规则：
  1. 明确告知 LLM 每条回复旁边都有 **"Save to Wiki"** 按钮。
  2. 当用户要求写入/保存/生成反思时，LLM 应直接输出完整 markdown，并引导用户点击该按钮保存。
  3. 保留 `<!-- save-worthy: yes | 理由 -->` 的主动提示机制。

---

## v0.4.9 — 2026-04-16

### 安全与稳定性修复（静态代码审查整改）

- **【致命】Clip Server CSRF 防护**：本地剪藏服务 (`127.0.0.1:19827`) 原允许任意来源跨域访问，恶意网页可静默向用户知识库注入数据。现已实施 Token 鉴权：
  1. App 启动时生成 32 字节随机 Token 保存在内存中。
  2. 新增 Tauri command `get_clip_server_token()` 供前端获取。
  3. Clip Server 所有端点（`/clip`、`/project`、`/projects`、`/clips/pending` 等）均要求请求头携带 `X-Clip-Token`，未携带或错误时返回 `401 Unauthorized`。
  4. 前端 `App.tsx`、`clip-watcher.ts` 等所有调用 Clip Server 的位置均已同步携带 Token。
- **【严重】修复 Rust unwrap() Panic 风险**：`clip_server.rs` 中 `Header::from_bytes(...).unwrap()` 和多处 `Mutex.lock().unwrap()` 在极端情况下可能导致后台线程 Panic。现已替换为安全的模式匹配和错误回退逻辑。
- **【严重】修复大量空 Catch 块导致的静默失败**：`App.tsx`、`embedding.ts`、`sources-view.tsx` 中大量 `catch {}` 被改为至少输出 `console.warn`，确保异常可被排查。关键业务路径（如项目打开）保留原有用户提示。
- **【一般】修复 Excel 金额解析浮点精度丢失**：`fs.rs` 中处理 `Data::Float` 时原使用 `*f == (*f as i64) as f64` 自行判断整数，在金融场景下存在 IEEE 754 截断风险。现已统一使用 `format!("{:.4}", f)` 保留精度并去除末尾无效零。
- **【一般】修复 TypeScript catch (backendErr: any)**：`sources-view.tsx` 中交割单导入 fallback 的异常捕获类型从不安全的 `any` 改为 `unknown`，并使用类型保护提取错误信息。
- **【提示】FIFO 边界场景文档化**：在 `trade-import.ts` 的 `calculateFifoPnL` 和 `isWithdrawn` 附近添加注释，明确说明当前 FIFO 算法不支持 A 股除权除息、送转股、配股、新股中签等特殊行为，提醒用户在导入前自行确认。

---

## v0.4.8 — 2026-04-16

### 新增：快速复盘内置模板 + 编辑器手动保存

- **快速复盘升级**：
  1. 侧边栏 🖊️ 快速复盘现在内置完整的交易复盘模板（与 `raw/日复盘/日复盘模板.md` 保持一致），包含今日操作、市场环境、心态与纪律、关键反思、明日计划五个模块。
  2. 去掉了原来的研究笔记、阅读笔记、日常随笔三个模板，简化为一键 **"创建今日复盘"**。
  3. 创建的文件自动保存到 `raw/日复盘/YYYY-MM-DD-复盘.md`，若当日文件已存在则直接打开。
- **编辑器手动保存按钮**：在 wiki 编辑器顶部标题栏新增显式 **"保存"** 按钮（位于关闭按钮左侧），点击立即落盘，保存成功后短暂显示 **"已保存"**。自动保存机制仍然保留。

---

## v0.4.7 — 2026-04-16

### 修复：LLM 对话正常访问 raw/ 下的交割单/日复盘（含深度审查修复 + 模板骨架补全）

- **根因**：v0.4.3 修复了 `searchWiki()` 的检索范围，但 `chat-panel.tsx` 构建 system prompt 时只取搜索前 10 名去竞争 budget，导致排第 11 名及以后的 raw 文件无法进入上下文。v0.4.4 用"强制注入"补丁临时解决，但破坏了三层架构设计。
- **检索链路修复**：
  1. 移除 P-1 强制注入逻辑，恢复 `raw/` 通过正常检索链路被访问。
  2. 页面加载阶段改用全部 20 个搜索结果竞争 budget，不再只截断前 10 名。
  3. 在 `search.ts` 中为 `raw/` 目录下的命中文件增加 `RAW_BONUS = +4` 分，确保交割单/日复盘在相关性排序中不会被 wiki 页面埋没。
  4. **新增 Recency Boost**：文件名含 `YYYY-MM-DD` 的资料按日期近远加分（≤7天 +6，≤30天 +3，≤90天 +1）；若用户查询含"最近一个月"等时间词，范围内文件额外 +15 分，解决"最近交割单读到 2 月、3 月、4 月混排"的问题。
- **代码审查中发现并修复的 bug**：
  1. `chat-message.tsx` 补回缺失的 `Paperclip` import，修复 SourceRef 按钮导致的运行时崩溃。
  2. `chat-panel.tsx` 增加 `addedPaths` 去重机制，防止同一文件被搜索命中和 Graph expansion 重复加载，避免浪费 budget。
  3. `chat-message.tsx` 简化 wikilink fallback 解析逻辑，移除始终指向 `entities/` 的错误循环。
  4. `search.ts` 修复 Vector Search fallback：不再硬编码 `entities/`、`concepts/` 等旧目录，改为在整个 `wiki/` 树中按文件名匹配（适配中文目录结构如 `股票/`、`策略/`）。
  5. `search.ts` 扩展 raw 目录文件过滤规则，排除 `.exe`、`.zip`、`.db`、`.tmp` 等二进制/临时文件。
  6. **搜索闪退**：`search-view.tsx` 的 `HighlightedText` 组件中 RegExp 带 `g` 标志重复 `test()` 导致 `lastIndex` 错乱，改用字符串比较修复。
  7. **raw/ 检索性能闪退**：当 `raw/` 目录下积累 100+ 个历史文件时，`search.ts` 会逐个 `readFile()` 读取全部文件，Tauri IPC 阻塞主线程导致 Windows 判定程序无响应并强制关闭。现已限制每个 raw 子目录仅读取按文件名排序后的最新 20 个文件，避免 IPC 洪水。
  8. **交割单收益计算严重错误**：部分券商 CSV 中买入金额为负数，导致 FIFO 成本算成负数、盈利虚高。`trade-import.ts` 与 `trade-stats.ts` 中统一对 `amount` 取 `Math.abs()`。
  8. **markdown 表格解析丢记录**：`trade-stats.ts` 的 `parseTradeMarkdown` 误用 `.filter((s) => s.length > 0)` 去掉空单元格，导致空费用列的行被丢弃。改为仅去掉首尾 `|` 产生的空字符串。
  9. **FIFO 买入成本不一致**：`trade-import.ts` 的 `calculateFifoPnL` 买入时错误地包含了印花税，现已与 `trade-stats.ts` 统一为 `|amount| + fee + transferFee`。
- **项目创建模板修复（关键）**：
  - **问题**：App 使用"交易复盘"模板创建项目时，只创建了空目录，没有复制任何初始文件。导致 `raw/日复盘/日复盘模板.md`、`wiki/index.md`、`wiki/策略/交易策略总览.md`、`wiki/进化/交易进化史.md`、`wiki/模式/市场模式库.md`、`wiki/错误/错误类型手册.md` 全部缺失，用户每次都要手动去模板仓库复制。
  - **修复**：
    1. 在 `WikiTemplate` 中新增 `files` 字段，支持定义模板专属的初始文件。
    2. 在 `tradingTemplate` 中嵌入全部 6 个初始文件的内容。
    3. 修改 `create-project-dialog.tsx`，创建项目时自动遍历并写入 `template.files` 中定义的所有文件。
    4. 同步 `templates.ts` 中 `tradingTemplate.schema` 为最新版 `AGENTS.md`（含 Recency Boost 和 FIFO 规则说明）。

## v0.4.6 — 2026-04-16（已弃用）

> **弃用原因**：v0.4.6 安装包存在已知问题——`tradingTemplate.schema` 未被正确更新为最新版 `AGENTS.md`，导致新建项目的 `schema.md` 仍使用旧内容（缺少 Recency Boost 和 FIFO 规则说明）。该问题已在 **v0.4.7** 修复，请勿使用 v0.4.6 安装包。

## v0.4.5 — 2026-04-16

### 修复：LLM 对话正常访问 raw/ 下的交割单/日复盘

- **根因**：v0.4.3 修复了 `searchWiki()` 的检索范围，但 `chat-panel.tsx` 构建 system prompt 时只取搜索前 10 名去竞争 budget，导致排第 11 名及以后的 raw 文件无法进入上下文。v0.4.4 用"强制注入"补丁临时解决，但破坏了三层架构设计。
- **修复**：
  1. 移除 P-1 强制注入逻辑，恢复 `raw/` 通过正常检索链路被访问。
  2. 页面加载阶段改用全部 20 个搜索结果竞争 budget，不再只截断前 10 名。
  3. 在 `search.ts` 中为 `raw/` 目录下的命中文件增加 `RAW_BONUS = +4` 分，确保交割单/日复盘在相关性排序中不会被 wiki 页面埋没。

## v0.4.4 — 2026-04-15

### 修复：LLM 对话仍然无法访问交割单/日复盘（强制注入上下文）

- **根因**：v0.4.3 仅修复了 `searchWiki()` 的检索范围，但 `chat-panel.tsx` 构建 system prompt 时只取搜索前 10 名，交割单文件仍可能因排名或 budget 限制被挤出上下文。因此 LLM 依然"看不到"这些文件。
- **修复**：在 `chat-panel.tsx` 的上下文组装逻辑中增加 **P-1 强制注入阶段**：每次对话前，无条件将 `raw/交割单/` 和 `raw/日复盘/` 下最近 7 个 `.md` 文件直接加载进 system prompt（最高优先级，不受搜索排名影响），确保 LLM 始终能基于最新交易记录回答。

---

## v0.4.3 — 2026-04-15

### 修复：LLM 对话无法访问 raw/交割单 和 raw/日复盘

- **根因**：`searchWiki()` 函数在构建 Chat 上下文时，只检索了 `wiki/` 和 `raw/sources/`，完全遗漏了 `raw/交割单/`、`raw/日复盘/`、`raw/研报新闻/` 等原始资料目录。因此 LLM 的 system prompt 中不会包含交割单和日复盘内容，导致用户提问时 LLM "看不到" 这些文件。
- **修复**：将原始资料的检索范围从 `raw/sources` 扩大到整个 `raw/` 树，并过滤掉 `.png`、`.jpg`、`.mp4` 等二进制文件，确保所有文本类原始资料（交割单 markdown、日复盘、研报等）都能被纳入 Chat 上下文中。

---

## v0.4.2 — 2026-04-15

### 修复：原始资料页面无法滚动

- **根因**：`SourcesView` 中使用的 `ScrollArea` 组件在 flex 容器内缺少 `min-h-0`，导致 flex item 随内容自动撑高，视口永远不会小于内容高度，因此不显示滚动条。
- **修复**：给 `ScrollArea` 添加 `min-h-0`，使其在 flex 布局中正确约束高度并启用滚动。

---

## v0.4.1 — 2026-04-15

### 修复：交割单统计逻辑全面重构（FIFO 统一引擎）

**问题根因：**
- 之前 `parseTradeMarkdown` 用「卖出金额 - 买入金额 - 费用」估算单日盈亏，这实际上是**资金流动**（cash flow），不是真正的**已实现盈亏**。导致买入多的日子显示大亏，卖出多的日子显示大赚，严重误导。
- 股票级别的盈亏也是按单条记录简单加减，没有考虑持仓成本。
- 持仓成本与盈亏统计分别维护，逻辑存在不一致风险。

**修复方案：**
- 在 `src/lib/trade-stats.ts` 中引入统一的 `runFifoEngine` 引擎，基于**先进先出（FIFO）**计算：
  1. **每日已实现盈亏** — 仅在卖出日产生盈亏，按历史买入成本精确计算
  2. **每只股票累计已实现盈亏** — 同一只股票跨日多次买卖也能准确归集
  3. **当前持仓成本与浮动盈亏** — 复用同一套 FIFO 批次数据
- `computeDashboardStats` 现在会**全局回溯**所有交割单，用 FIFO 结果回填每一天、每一只股票、每一个月的真实盈亏。
- Dashboard 中的「净盈亏」列标题统一改为「**已实现盈亏**」，语义更准确。
- `plan-audit.ts` 也统一调用 `computeDashboardStats`，确保 LLM 看到的每日盈亏数据准确。

**验证：**
- 全部 21 个单元测试通过（含更新后的 FIFO 盈亏断言）
- TypeScript 0 错误
- Vite + Tauri build 成功

---

## v0.4.0 — 2026-04-15

### 新增功能：交易计划审计

在左侧导航栏新增了「**计划审计**」独立入口（位于「统计看板」与「深度复盘」之间）。

**功能说明：**
- AI 自动读取 `raw/日复盘/` 中的「**明日计划**」，与次日（或最近交易日）的实际交割单进行对比。
- 输出 5 种执行状态标签：
  - 🟢 **完全执行** — 计划与实际一致
  - 🟡 **部分执行** — 有计划但执行不完整，或有额外操作
  - 🔴 **严重偏离** — 违反计划（如计划观望却追高、计划卖出却买入等）
  - 🔵 **无交易** — 有计划但次日未交易
  - ⚪ **即兴交易** — 无计划但有交易
- 支持选择审计范围：最近 7 天 / 30 天 / 90 天 / 一年。
- 顶部展示 4 个核心指标：审计天数、完全执行天数、严重偏离天数、即兴交易次数。
- 每条审计结果均可展开，查看 AI 分析详情、原始计划文本与实际交易摘要。

**使用前提：**
- 需要在「设置」中配置 LLM（OpenAI / Anthropic / Ollama / 自定义端点）。
- 需要在 `raw/日复盘/` 中写有包含「## 五、明日计划」的复盘文件，并导入对应的交割单。

---

## v0.3.1 — 2026-04-15

### 修复：Dashboard 当前持仓页白屏（React Error #310）

- **根因**：`useMemo` 被放置在条件提前返回（`if (loading)` / `if (!project)`）之后，当状态变化导致提前返回时，React Hook 调用顺序不一致，触发 Error #310（Rendered more hooks than during the previous render）。
- **修复**：将 `useMemo` 与价格记录构造逻辑全部移至组件顶部，确保在所有条件分支之前执行。

---

## v0.3.0 — 2026-04-15

### 新增功能：当前持仓（Holdings Dashboard）

在「统计看板」中新增「**当前持仓**」标签页。

**功能说明：**
- 基于 FIFO 先进先出算法，自动从全部历史交割单计算出当前持有的股票、数量与成本均价。
- 买入成本包含手续费与过户费，卖出时按最早买入批次扣减持仓。
- 表格中支持手动输入每只股票的市场价格，实时计算：
  - **持仓市值** = 市价 × 持股数
  - **浮动盈亏** = (市价 - 成本均价) × 持股数
- 顶部展示持仓 KPI：持仓股票数、持仓总市值、持仓总成本、总浮动盈亏。

---

## 安装包说明

每次构建会生成两个安装文件：

| 文件名 | 说明 |
|--------|------|
| `Trading Review Wiki_x.x.x_x64-setup.exe` | **推荐** — NSIS 安装程序，支持自定义安装路径与卸载 |
| `Trading Review Wiki_x.x.x_x64_en-US.msi` | Windows Installer 包，适合企业批量部署 |

> 所有安装包均不含数字签名，首次安装时 Windows 可能会弹出「未知发布者」提示，点击「更多信息」→「仍要运行」即可。
