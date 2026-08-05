import { useRef, useEffect, useCallback, useState } from "react"
import { BookOpen, Plus, Trash2, MessageSquare } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ChatMessage, StreamingMessage, useSourceFiles } from "./chat-message"
import { ChatInput } from "./chat-input"
import { useChatStore, chatMessagesToLLM } from "@/stores/chat-store"
import { useWikiStore } from "@/stores/wiki-store"
import { streamChat, compactConversation, type ChatMessage as LLMMessage } from "@/lib/llm-client"
import { executeIngestWrites } from "@/lib/ingest"
import { listDirectory, readFile, deleteFile, writeBinaryFile, createDirectory } from "@/commands/fs"
import { searchWiki } from "@/lib/search"
import { buildRetrievalGraph, getRelatedNodes } from "@/lib/graph-relevance"
import { normalizePath, getFileName, getRelativePath } from "@/lib/path-utils"
import { buildChatSystemPrompt, buildChatUserContextBlock } from "@/lib/chat-prompts"
import { invoke } from "@tauri-apps/api/core"

// lastQueryPages is now stored in chat-store to avoid module-level mutable state issues

function formatDate(timestamp: number): string {
  const d = new Date(timestamp)
  const now = new Date()
  const isToday = d.toDateString() === now.toDateString()
  if (isToday) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" })
}

function ConversationSidebar() {
  const conversations = useChatStore((s) => s.conversations)
  const activeConversationId = useChatStore((s) => s.activeConversationId)
  const messages = useChatStore((s) => s.messages)
  const createConversation = useChatStore((s) => s.createConversation)
  const deleteConversation = useChatStore((s) => s.deleteConversation)
  const setActiveConversation = useChatStore((s) => s.setActiveConversation)

  const [hoveredId, setHoveredId] = useState<string | null>(null)

  const sorted = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt)

  function getMessageCount(convId: string): number {
    return messages.filter((m) => m.conversationId === convId).length
  }

  return (
    <div className="flex h-full w-[200px] flex-shrink-0 flex-col border-r bg-muted/30">
      <div className="border-b p-2">
        <Button
          variant="outline"
          size="sm"
          className="w-full gap-2"
          onClick={() => createConversation()}
        >
          <Plus className="h-3.5 w-3.5" />
          新对话
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {sorted.length === 0 ? (
          <p className="px-3 py-4 text-xs text-muted-foreground text-center">
            还没有对话
          </p>
        ) : (
          sorted.map((conv) => {
            const isActive = conv.id === activeConversationId
            const msgCount = getMessageCount(conv.id)
            return (
              <div
                key={conv.id}
                className={`group relative mx-1 my-0.5 flex cursor-pointer flex-col rounded-md px-2 py-1.5 text-sm transition-colors ${
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "hover:bg-accent text-foreground"
                }`}
                onClick={() => setActiveConversation(conv.id)}
                onMouseEnter={() => setHoveredId(conv.id)}
                onMouseLeave={() => setHoveredId(null)}
              >
                <div className="flex items-start justify-between gap-1">
                  <span className="line-clamp-2 flex-1 text-xs font-medium leading-snug">
                    {conv.title}
                  </span>
                  {hoveredId === conv.id && (
                    <button
                      className="flex-shrink-0 rounded p-0.5 text-muted-foreground hover:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation()
                        deleteConversation(conv.id)
                        // Delete persisted chat file
                        const proj = useWikiStore.getState().project
                        if (proj) {
                          deleteFile(`${proj.path}/.llm-wiki/chats/${conv.id}.json`).catch((err) => console.warn("Failed to delete chat file:", err))
                        }
                      }}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  <span>{formatDate(conv.updatedAt)}</span>
                  {msgCount > 0 && (
                    <>
                      <span>·</span>
                      <span>{msgCount} 条消息</span>
                    </>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

export function ChatPanel() {
  useSourceFiles() // Keep source file cache warm
  const activeConversationId = useChatStore((s) => s.activeConversationId)
  const isStreaming = useChatStore((s) => s.isStreaming)
  const streamingContent = useChatStore((s) => s.streamingContent)
  const mode = useChatStore((s) => s.mode)
  const addMessage = useChatStore((s) => s.addMessage)
  const setStreaming = useChatStore((s) => s.setStreaming)
  const appendStreamToken = useChatStore((s) => s.appendStreamToken)
  const finalizeStream = useChatStore((s) => s.finalizeStream)
  const createConversation = useChatStore((s) => s.createConversation)
  const removeLastAssistantMessage = useChatStore((s) => s.removeLastAssistantMessage)
  const maxHistoryMessages = useChatStore((s) => s.maxHistoryMessages)

  // Derive active messages via selector to re-render on message changes
  const allMessages = useChatStore((s) => s.messages)
  const activeMessages = activeConversationId
    ? allMessages.filter((m) => m.conversationId === activeConversationId)
    : []

  const project = useWikiStore((s) => s.project)
  const llmConfig = useWikiStore((s) => s.llmConfig)
  const setFileTree = useWikiStore((s) => s.setFileTree)

  const abortRef = useRef<AbortController | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  // When enabled, route the question through the CLI's multi-source `ask`
  // (wiki/raw/graph/facts/brain) instead of the local TS retrieval path.
  const [cliMultiSource, setCliMultiSource] = useState(false)
  // Agentic mode (--agentic) — multi-step sub-agent orchestration
  const [agentic, setAgentic] = useState(false)
  // Candidate precheck result (show-sources + show-context returns candidates JSON, not answer)
  const [precheckResult, setPrecheckResult] = useState<string | null>(null)

  const runCliAsk = useCallback(
    async (text: string, pp: string) => {
      try {
        const cfg = useWikiStore.getState().llmConfig
        const provider = cfg.provider === "codex" ? "codex" : "openai"
        const args = [
          "--query", text,
          "--sources", "wiki,raw,graph,facts,brain",
          "--source-k", "3",
          "--provider", provider,
          "--api-key", cfg.apiKey ?? "",
          "--endpoint", cfg.customEndpoint ?? "",
          "--model", cfg.model ?? "",
        ]
        if (agentic) args.push("--agentic")
        // Rust 网关返回 stdout 字符串；ask 不带 --show-* 时为纯文本答案（含内联 [W#]/[R#] 引用 + 末尾「引用来源」列表）
        const raw = (await invoke<string>("run_research_cockpit_command", {
          projectPath: pp,
          action: "ask",
          args,
        })) as unknown as string

        const refs: { title: string; path: string }[] = []
        let content = raw
        const refSection = raw.match(/##\s*引用来源\s*\n([\s\S]*?)(?:\n##\s|$)/)
        if (refSection) {
          const body = refSection[1]
          const lineRe = /^\s*-\s*\[([WRGFMS])(\d+)\]\s+(.+?)\s*(?:（graph_hop=\d+）)?\s*$/gm
          let m: RegExpExecArray | null
          while ((m = lineRe.exec(body))) {
            const [, prefix, num, rest] = m
            const cleanPath = rest.trim()
            const base = cleanPath.replace(/^wiki\//, "").replace(/\.md$/, "")
            const name = base.split("/").pop() || base
            refs.push({ title: `[${prefix}${num}] ${name}`, path: cleanPath })
          }
          if (refs.length > 0) {
            // 已解析出结构化引用，从展示正文剥离「引用来源」段避免重复
            content = raw.replace(/##\s*引用来源[\s\S]*$/, "").trim()
          }
        }
        finalizeStream(content || "(无回答)", refs)
      } catch (err: any) {
        finalizeStream(`CLI 多源检索失败：${err?.message ?? String(err)}`, [])
      }
    },
    [finalizeStream, agentic],
  )

  // 候选预检：通过 candidate-ask-precheck Rust arm 调用 ask --show-sources --show-context --agentic，返回 JSON 候选上下文而非最终答案
  const runCandidatePrecheck = useCallback(async () => {
    if (!project) return
    // Get the last user message as the query
    const lastUserMsg = [...useChatStore.getState().messages].reverse().find((m) => m.role === "user")
    const query = lastUserMsg?.content?.trim() ?? ""
    if (!query) return
    try {
      const args = [
        "--query", query,
        "--sources", "wiki,raw,graph,facts,brain",
        "--source-k", "3",
      ]
      // candidate-ask-precheck arm auto-adds --agentic --show-context --show-sources --profile local-max --no-agent-artifacts
      const raw = await invoke<string>("run_research_cockpit_command", {
        projectPath: project.path,
        action: "candidate-ask-precheck",
        args,
      })
      // raw is JSON string (compact or full)
      try {
        const parsed = JSON.parse(raw)
        // Summarize: count sources by type
        const counts: Record<string, number> = {}
        const collect = (arr: any[] | undefined) => {
          if (!arr) return
          for (const item of arr) {
            const kind = item.kind || item.type || "unknown"
            counts[kind] = (counts[kind] ?? 0) + 1
          }
        }
        collect(parsed.sources)
        collect(parsed.wikiMatches)
        collect(parsed.rawMatches)
        collect(parsed.factsMatches)
        collect(parsed.graphMatches)
        const summary = {
          schema: parsed.schema,
          query: parsed.query,
          generatedAt: parsed.generatedAt,
          counts,
          sampleTitles: (parsed.sources ?? []).slice(0, 8).map((s: any) => s.title || s.path || JSON.stringify(s).slice(0, 60)),
        }
        setPrecheckResult(JSON.stringify(summary, null, 2))
      } catch {
        setPrecheckResult(raw.slice(0, 4000))
      }
    } catch (err: any) {
      setPrecheckResult(`预检失败：${err?.message ?? String(err)}`)
    }
  }, [project])

  // Auto-scroll to bottom when messages change or streaming content updates
  // Only scroll if user is already near the bottom to avoid interrupting history reading
  useEffect(() => {
    const container = scrollContainerRef.current
    if (container) {
      const threshold = 100 // px
      const isNearBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight < threshold
      if (isNearBottom) {
        container.scrollTop = container.scrollHeight
      }
    }
  }, [allMessages.length, activeConversationId, streamingContent])

  const handleSend = useCallback(
    async (text: string, images: File[] = []) => {
      // Auto-create a conversation if none is active
      let convId = useChatStore.getState().activeConversationId
      if (!convId) {
        convId = createConversation()
      }

      let messageText = text
      const pp = project ? normalizePath(project.path) : ""

      // Save attached images to raw/截图/ and embed markdown references
      if (images.length > 0 && pp) {
        const imageDir = `${pp}/raw/截图`
        await createDirectory(imageDir).catch(() => {})
        const refs: string[] = []
        for (const img of images) {
          const dateStr = new Date().toISOString().slice(0, 10)
          const timeStr = new Date().toTimeString().slice(0, 8).replace(/:/g, "-")
          const safeName = img.name.replace(/[^a-zA-Z0-9._-]/g, "_")
          const destPath = `${imageDir}/${dateStr}-${timeStr}-${safeName}`
          try {
            const buffer = await img.arrayBuffer()
            await writeBinaryFile(destPath, new Uint8Array(buffer))
            const relPath = getRelativePath(destPath, pp)
            refs.push(`![${safeName}](${relPath})`)
          } catch (err) {
            console.error("Failed to save chat image:", err)
          }
        }
        if (refs.length > 0) {
          messageText = messageText ? `${messageText}\n\n${refs.join("\n")}` : refs.join("\n")
        }
      }

      addMessage("user", messageText)
      setStreaming(true)

      // CLI multi-source retrieval path (wiki/raw/graph/facts/brain via Codex CLI).
      // Skips the local TS retrieval + streamChat and uses the knowledge base's
      // own six-source RAG instead.
      if (cliMultiSource && project && llmConfig) {
        await runCliAsk(messageText, normalizePath(project.path))
        return
      }

      // Frozen, byte-identical system prompt — cache-stable prefix (DeepSeek APC).
      // All per-query context (retrieved wiki pages, project purpose/index) is injected
      // into the USER message instead, so the prefix never changes between queries.
      const systemMessages: LLMMessage[] = [
        { role: "system", content: buildChatSystemPrompt() },
      ]
      let queryRefs: { title: string; path: string }[] = []
      let chatContextBlock = ""
      if (project) {
        const pp = normalizePath(project.path)
        const dataVersion = useWikiStore.getState().dataVersion
        const maxCtx = llmConfig.maxContextSize || 204800

        // ── Budget allocation ──────────────────────────────────
        const INDEX_BUDGET = Math.floor(maxCtx * 0.05)
        const PAGE_BUDGET = Math.floor(maxCtx * 0.6)
        const MAX_PAGE_SIZE = Math.min(Math.floor(PAGE_BUDGET * 0.3), 30_000)

        const [rawIndex, purpose] = await Promise.all([
          readFile(`${pp}/wiki/index.md`).catch(() => ""),
          readFile(`${pp}/purpose.md`).catch(() => ""),
        ])

        // ── Phase 1: Tokenized search ─────────────────────────
        const searchResults = await searchWiki(pp, text)
        const topSearchResults = searchResults.slice(0, 10)
        // Use all search results for page loading so raw/ files aren't truncated out
        const allSearchHits = searchResults

        // ── Trim index by relevance if over budget ─────────────
        let index = rawIndex
        if (rawIndex.length > INDEX_BUDGET) {
          const { tokenizeQuery } = await import("@/lib/search")
          const tokens = tokenizeQuery(text)
          const lines = rawIndex.split("\n")
          const keptLines: string[] = []
          let keptSize = 0

          for (const line of lines) {
            const isHeader = line.startsWith("##")
            const lower = line.toLowerCase()
            const isRelevant = tokens.some((t) => lower.includes(t))

            if (isHeader || isRelevant) {
              if (keptSize + line.length + 1 <= INDEX_BUDGET) {
                keptLines.push(line)
                keptSize += line.length + 1
              }
            }
          }
          index = keptLines.join("\n")
          if (index.length < rawIndex.length) {
            index += "\n\n[...index trimmed to relevant entries...]"
          }
        }

        // ── Phase 2: Graph 1-level expansion ───────────────────
        // Note: Vector search (if enabled) is already merged into searchResults
        // by searchWiki() in search.ts — no duplicate code needed here.
        const graph = await buildRetrievalGraph(pp, dataVersion)
        const expandedIds = new Set<string>()
        const searchHitPaths = new Set(topSearchResults.map((r) => r.path))
        const graphExpansions: { title: string; path: string; relevance: number }[] = []

        for (const result of topSearchResults) {
          const fileName = getFileName(result.path)
          const nodeId = fileName.replace(/\.md$/, "")
          const related = getRelatedNodes(nodeId, graph, 3)
          for (const { node, relevance } of related) {
            if (relevance < 2.0) continue
            if (searchHitPaths.has(node.path)) continue
            if (expandedIds.has(node.id)) continue
            expandedIds.add(node.id)
            graphExpansions.push({ title: node.title, path: node.path, relevance })
          }
        }
        graphExpansions.sort((a, b) => b.relevance - a.relevance)

        // ── Phase 3 & 4: Page budget control ───────────────────
        let usedChars = 0
        type PageEntry = { title: string; path: string; content: string; priority: number }
        const relevantPages: PageEntry[] = []

        const addedPaths = new Set<string>()
        const tryAddPage = async (title: string, filePath: string, priority: number): Promise<boolean> => {
          if (usedChars >= PAGE_BUDGET) return false
          const normPath = normalizePath(filePath)
          if (addedPaths.has(normPath)) return false
          try {
            const raw = await readFile(filePath)
            const relativePath = getRelativePath(filePath, pp)
            const truncated = raw.length > MAX_PAGE_SIZE
              ? raw.slice(0, MAX_PAGE_SIZE) + "\n\n[...truncated...]"
              : raw
            if (usedChars + truncated.length > PAGE_BUDGET) return false
            usedChars += truncated.length
            addedPaths.add(normPath)
            relevantPages.push({ title, path: relativePath, content: truncated, priority })
            return true
          } catch { return false }
        }

        // P0: Title matches (from all search results, not just top 10)
        for (const r of allSearchHits.filter((r) => r.titleMatch)) {
          await tryAddPage(r.title, r.path, 0)
        }
        // P1: Content matches (from all search results)
        for (const r of allSearchHits.filter((r) => !r.titleMatch)) {
          await tryAddPage(r.title, r.path, 1)
        }
        // P2: Graph expansions
        for (const exp of graphExpansions) {
          await tryAddPage(exp.title, exp.path, 2)
        }
        // P3: Overview fallback
        if (relevantPages.length === 0) {
          await tryAddPage("Overview", `${pp}/wiki/overview.md`, 3)
        }

        const pagesContext = relevantPages.length > 0
          ? relevantPages.map((p, i) =>
              `### [${i + 1}] ${p.title}\nPath: ${p.path}\n\n${p.content}`
            ).join("\n\n---\n\n")
          : "(No wiki pages found)"

        const pageList = relevantPages.map((p, i) =>
          `[${i + 1}] ${p.title} (${p.path})`
        ).join("\n")

        // Variable, per-query context → user message (keeps the system prefix frozen).
        chatContextBlock = buildChatUserContextBlock({
          purpose: purpose || undefined,
          index: index || undefined,
          pageList: relevantPages.length > 0 ? pageList : undefined,
          pagesContext: relevantPages.length > 0 ? pagesContext : undefined,
        })

        const mappedPages = relevantPages.map((p) => ({ title: p.title, path: p.path }))
        useChatStore.getState().setLastQueryPages(mappedPages)
        queryRefs = [...mappedPages]
      }

      // ── Conversation history with count limit ────────────────
      // Only include messages from the active conversation, last N messages
      const activeConvMessages = useChatStore.getState().getActiveMessages()
        .filter((m) => m.role === "user" || m.role === "assistant")
        .slice(-maxHistoryMessages)

      const llmMessages = [...systemMessages, ...chatMessagesToLLM(activeConvMessages)]
      // Append the per-query wiki context to the LAST user turn only. Keeping it out of the
      // system prompt preserves the cache-stable prefix; the variable tail never invalidates
      // the cached system + earlier-history prefix.
      if (chatContextBlock) {
        const lastIdx = llmMessages.length - 1
        const last = llmMessages[lastIdx]
        if (last && last.role === "user") {
          llmMessages[lastIdx] = { ...last, content: `${last.content}\n\n---\n\n${chatContextBlock}` }
        }
      }

      // R2: prefix-preserving auto-compaction for long chat sessions.
      // Chat history grows across turns; once it exceeds the round threshold, fold the oldest
      // rounds into a single summary user message (frozen system prefix untouched) so the
      // DeepSeek prefix cache stays warm AND the context window stays bounded.
      const compactedMessages = compactConversation(llmMessages, { keepRecentRounds: 6 })

      const controller = new AbortController()
      abortRef.current = controller

      let accumulated = ""

      await streamChat(
        llmConfig,
        compactedMessages,
        {
          onToken: (token) => {
            accumulated += token
            appendStreamToken(token)
          },
          onDone: () => {
            finalizeStream(accumulated, queryRefs)
            abortRef.current = null
            // save-worthy detection removed — user has direct "Save to Wiki" button on each message
          },
          onError: (err) => {
            finalizeStream(`Error: ${err.message}`, undefined)
            abortRef.current = null
          },
        },
        controller.signal,
      )
    },
    [llmConfig, addMessage, setStreaming, appendStreamToken, finalizeStream, createConversation, maxHistoryMessages, project, cliMultiSource, runCliAsk],
  )

  const handleStop = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
  }, [])

  const handleRegenerate = useCallback(async () => {
    if (isStreaming) return
    // Find the last user message in active conversation
    const active = useChatStore.getState().getActiveMessages()
    const lastUserMsg = [...active].reverse().find((m) => m.role === "user")
    if (!lastUserMsg) return
    // Remove the last assistant reply, then re-send
    removeLastAssistantMessage()
    // Trigger send with the same text (handleSend will add a new user message,
    // so also remove the original to avoid duplication)
    // Actually: just call handleSend — but it adds a user message. To avoid dupe,
    // we remove the last user message too and let handleSend re-add it.
    const store = useChatStore.getState()
    const updatedActive = store.getActiveMessages()
    const lastUser = [...updatedActive].reverse().find((m) => m.role === "user")
    if (lastUser) {
      useChatStore.setState((s) => ({
        messages: s.messages.filter((m) => m.id !== lastUser.id),
      }))
    }
    handleSend(lastUserMsg.content)
  }, [isStreaming, removeLastAssistantMessage, handleSend])

  const handleWriteToWiki = useCallback(async () => {
    if (!project) return
    const pp = normalizePath(project.path)
    try {
      await executeIngestWrites(pp, llmConfig, undefined, undefined)
      try {
        const tree = await listDirectory(pp)
        setFileTree(tree)
      } catch {
        // ignore
      }
    } catch (err) {
      console.error("Failed to write to wiki:", err)
    }
  }, [project, llmConfig, setFileTree])

  const hasAssistantMessages = activeMessages.some((m) => m.role === "assistant")
  const showWriteButton = mode === "ingest" && !isStreaming && hasAssistantMessages

  return (
    <div className="flex h-full flex-row overflow-hidden">
      <ConversationSidebar />

      <div className="flex flex-1 flex-col overflow-hidden">
        {!activeConversationId ? (
          <div className="flex flex-1 items-center justify-center text-muted-foreground">
            <div className="text-center">
              <MessageSquare className="mx-auto mb-3 h-8 w-8 opacity-30" />
              <p className="text-sm">开始新对话</p>
              <p className="mt-1 text-xs opacity-60">点击“新对话”开始</p>
            </div>
          </div>
        ) : (
          <>
            <div
              ref={scrollContainerRef}
              className="flex-1 overflow-y-auto px-3 py-2"
            >
              <div className="flex flex-col gap-3">
                {activeMessages.map((msg, idx) => {
                  // Check if this is the last assistant message
                  const isLastAssistant = msg.role === "assistant" &&
                    !activeMessages.slice(idx + 1).some((m) => m.role === "assistant")
                  return (
                    <ChatMessage
                      key={msg.id}
                      message={msg}
                      isLastAssistant={isLastAssistant && !isStreaming}
                      onRegenerate={isLastAssistant ? handleRegenerate : undefined}
                    />
                  )
                })}
                {isStreaming && <StreamingMessage content={streamingContent} />}
                <div ref={bottomRef} />
              </div>
            </div>

            {showWriteButton && (
              <div className="border-t px-3 py-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleWriteToWiki}
                  className="w-full gap-2"
                >
                  <BookOpen className="h-4 w-4" />
                  Write to Wiki
                </Button>
              </div>
            )}
          </>
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t px-3 py-1.5 text-xs text-muted-foreground">
          <label className="flex cursor-pointer items-center gap-1.5 select-none">
            <input
              type="checkbox"
              id="cli-multisource"
              checked={cliMultiSource}
              onChange={(e) => setCliMultiSource(e.target.checked)}
              className="h-3.5 w-3.5 accent-primary"
            />
            <span>CLI 多源检索（ask · wiki/raw/graph/facts/brain）</span>
          </label>
          {cliMultiSource && (
            <>
              <label className="flex cursor-pointer items-center gap-1.5 select-none">
                <input
                  type="checkbox"
                  id="agentic-mode"
                  checked={agentic}
                  onChange={(e) => setAgentic(e.target.checked)}
                  className="h-3.5 w-3.5 accent-primary"
                />
                <span>智能体模式 (--agentic，多步子代理)</span>
              </label>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[11px]"
                onClick={runCandidatePrecheck}
                disabled={!project}
                title="通过 candidate-ask-precheck 调用 ask --agentic --show-sources --show-context，返回候选上下文而非最终答案"
              >
                候选预检
              </Button>
            </>
          )}
        </div>

        {precheckResult && (
          <div className="border-t bg-muted/30 px-3 py-2 text-xs">
            <div className="mb-1 flex items-center justify-between">
              <span className="font-medium text-foreground">候选预检结果</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-5 px-1 text-[10px]"
                onClick={() => setPrecheckResult(null)}
              >
                关闭
              </Button>
            </div>
            <pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded bg-background p-2 text-[11px] leading-relaxed">
              {precheckResult}
            </pre>
          </div>
        )}

        <ChatInput
          onSend={handleSend}
          onStop={handleStop}
          isStreaming={isStreaming}
          placeholder={
            mode === "ingest"
              ? "Discuss the source or ask follow-up questions..."
              : "Type a message..."
          }
        />
      </div>
    </div>
  )
}

// __DEAD_CODE_MARKER_DO_NOT_REMOVE__

