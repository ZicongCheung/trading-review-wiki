/**
 * Cache-stable chat prompts for the trading-review assistant.
 *
 * Design principle (mirrors DeepSeek-Reasonix's prefix-cache discipline):
 * the SYSTEM prompt must be BYTE-IDENTICAL across every query in a session so
 * DeepSeek's automatic prefix cache stays warm. Any content that varies per
 * query — the detected response language, retrieved wiki pages, project
 * purpose/index — is kept OUT of the system prompt and injected into the USER
 * message instead (the variable tail never invalidates the cached prefix).
 */

export interface ChatContextInput {
  purpose?: string
  index?: string
  pageList?: string
  pagesContext?: string
}

/** Frozen, query-independent system prompt. Do NOT inject any per-query value here. */
export function buildChatSystemPrompt(): string {
  return [
    "你是一位专业的交易复盘助手。基于下面提供的交易知识库内容回答问题。你的职责是帮助用户从交易记录中提炼模式、发现矛盾、评估策略有效性，并推动交易理解的复利增长。",
    "",
    "## CRITICAL: Response Language",
    "始终使用与用户输入相同的语言回复。无论知识库内容是什么语言，都跟随用户当前消息的语言。这是强制要求。",
    "",
    "## 规则",
    "- 仅基于下面提供的编号 Wiki 页面进行回答。",
    "- 如果提供的页面信息不足，请诚实地说明。",
    "- 使用 [[wikilink]] 语法引用 Wiki 页面。",
    "- 引用信息时，使用方括号中的页码，例如 [1]、[2]。",
    "- 在回复的最末尾，添加一个隐藏注释，列出你使用的页码：",
    "  <!-- cited: 1, 3, 5 -->",
    "",
    "## 保存到 Wiki",
    "- 你虽然不能直接写磁盘，但用户界面上每条你的回复旁边都有一个【Save to Wiki】按钮。",
    "- 当用户要求你'写入'、'保存'、'生成反思'时，你应该直接输出完整的 markdown 内容，并告诉用户：'点击消息右下角的 Save to Wiki 按钮即可保存到知识库。'",
    "- 如果你认为当前回复值得长期沉淀，可以在隐藏注释后追加：<!-- save-worthy: yes | 理由 -->",
    "",
    "使用 markdown 格式提高可读性。",
  ].join("\n")
}

/** Per-query, variable context. Appended to the USER message, never the system prompt. */
export function buildChatUserContextBlock(ctx: ChatContextInput): string {
  const parts: string[] = []
  if (ctx.purpose) parts.push(`## Wiki Purpose\n${ctx.purpose}`)
  if (ctx.index) parts.push(`## Wiki Index\n${ctx.index}`)
  if (ctx.pageList) parts.push(`## Page List\n${ctx.pageList}`)
  if (ctx.pagesContext) parts.push(`## Wiki Pages\n\n${ctx.pagesContext}`)
  return parts.join("\n\n")
}
