import { useState, useEffect } from "react"
import { open } from "@tauri-apps/plugin-dialog"
import i18n from "@/i18n"
import { useWikiStore } from "@/stores/wiki-store"
import { useReviewStore } from "@/stores/review-store"
import { useChatStore } from "@/stores/chat-store"
import { useResearchStore } from "@/stores/research-store"
import { listDirectory, openProject, getClipServerToken } from "@/commands/fs"
import { getLastProject, getRecentProjects, saveLastProject, loadLlmConfig, loadLanguage, loadSearchApiConfig, loadEmbeddingConfig, loadAppTheme, loadPgConfig, loadImaSyncConfig } from "@/lib/project-store"
import { runImaConsistencyCheck } from "@/lib/ima-consistency"
import { syncStockCodes } from "@/commands/stock-codes"
import { loadReviewItems, loadChatHistory } from "@/lib/persist"
import { setupAutoSave, teardownAutoSave } from "@/lib/auto-save"
import { startClipWatcher, stopClipWatcher } from "@/lib/clip-watcher"
import { AppLayout } from "@/components/layout/app-layout"
import { WelcomeScreen } from "@/components/project/welcome-screen"
import { CreateProjectDialog } from "@/components/project/create-project-dialog"
import type { WikiProject } from "@/types/wiki"

function App() {
  const project = useWikiStore((s) => s.project)
  const setProject = useWikiStore((s) => s.setProject)
  const setFileTree = useWikiStore((s) => s.setFileTree)
  const setSelectedFile = useWikiStore((s) => s.setSelectedFile)
  const setFileContent = useWikiStore((s) => s.setFileContent)
  const setActiveView = useWikiStore((s) => s.setActiveView)
  const setChatExpanded = useWikiStore((s) => s.setChatExpanded)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [loading, setLoading] = useState(true)

  // Set up auto-save and clip watcher once on mount
  useEffect(() => {
    setupAutoSave()
    startClipWatcher()
    return () => {
      teardownAutoSave()
      stopClipWatcher()
    }
  }, [])

  // Apply initial theme (dark class handled by setAppTheme in store)
  useEffect(() => {
    const appTheme = useWikiStore.getState().appTheme
    if (appTheme !== "light") {
      document.documentElement.classList.add("dark")
    }
  }, [])

  // Auto-open last project on startup
  useEffect(() => {
    let cancelled = false
    async function init() {
      try {
        const savedConfig = await loadLlmConfig()
        if (!cancelled && savedConfig) {
          useWikiStore.getState().setLlmConfig(savedConfig)
        }
        const savedSearchConfig = await loadSearchApiConfig()
        if (!cancelled && savedSearchConfig) {
          useWikiStore.getState().setSearchApiConfig(savedSearchConfig)
        }
        const savedEmbeddingConfig = await loadEmbeddingConfig()
        if (!cancelled && savedEmbeddingConfig) {
          useWikiStore.getState().setEmbeddingConfig(savedEmbeddingConfig)
        }
        const savedPgConfig = await loadPgConfig()
        if (!cancelled && savedPgConfig) {
          useWikiStore.getState().setPgConfig(savedPgConfig)
        }
        const savedLang = await loadLanguage()
        if (!cancelled && savedLang) {
          await i18n.changeLanguage(savedLang)
        }
        const savedTheme = await loadAppTheme()
        if (!cancelled && savedTheme) {
          useWikiStore.getState().setAppTheme(savedTheme)
        }
        const lastProject = await getLastProject()
        if (!cancelled && lastProject) {
          try {
            const proj = await openProject(lastProject.path)
            if (!cancelled) {
              await handleProjectOpened(proj)
            }
          } catch (err) {
            console.warn("[App] Failed to open last project:", err)
          }
        }
      } catch (err) {
        console.warn("[App] Init error:", err)
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }
    init()
    return () => {
      cancelled = true
    }
  }, [])

  async function handleProjectOpened(proj: WikiProject) {
    // Clear project-scoped stores so we don't leak data from the previous project
    useReviewStore.getState().setItems([])
    useChatStore.getState().resetProjectState()
    useResearchStore.getState().clearTasks()
    useResearchStore.getState().setPanelOpen(false)

    setProject(proj)
    setFileTree([])
    setSelectedFile(null)
    setFileContent("")
    setActiveView("wiki")
    setChatExpanded(false)
    await saveLastProject(proj)

    // Restore ingest queue (resume interrupted tasks)
    import("@/lib/ingest-queue").then(({ restoreQueue }) => {
      restoreQueue(proj.path).catch((err) =>
        console.error("Failed to restore ingest queue:", err)
      )
    })
    // Background-sync stock codes from PG (24h cache; no-op if config empty)
    const pgConfig = useWikiStore.getState().pgConfig
    if (pgConfig.host && pgConfig.user && pgConfig.password && pgConfig.database && pgConfig.port) {
      syncStockCodes(proj.path, pgConfig, false).catch((err) =>
        console.warn("[App] Stock code sync failed:", err)
      )
    }
    // 研报同步：启动时自动拉最新文件夹并比对（侧栏 无需更新/待更新/点击进行配置）
    loadImaSyncConfig()
      .then((cfg) => {
        // 迁移旧「全部/最新」伪值；空 outDir 用默认下载路径，便于启动自动解析最新夹
        let normalized = cfg
          ? { ...cfg }
          : {
              enabled: true,
              harPath: "",
              outDir: "/raw/sources/研报",
              folder: "",
              kbId: "",
            }
        const f = (normalized.folder || "").trim()
        if (f === "全部" || f === "最新" || f === "all" || f === "latest") {
          normalized = { ...normalized, folder: "" }
        }
        if (!(normalized.outDir || "").trim()) {
          normalized = { ...normalized, outDir: "/raw/sources/研报" }
        }
        useWikiStore.getState().setImaSyncConfig(normalized)
        return runImaConsistencyCheck({
          projectPath: proj.path,
          config: normalized,
          force: true,
          // 始终解析知识库「最新」文件夹并写回配置，再做单夹一致性检查
          resolveLatest: true,
        })
      })
      .catch((err) => console.warn("[App] IMA consistency check failed:", err))
    // Notify local clip server of the current project + all recent projects
    getClipServerToken().then((token) => {
      fetch("http://127.0.0.1:19827/project", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Clip-Token": token,
        },
        body: JSON.stringify({ path: proj.path }),
      }).catch((err) => console.warn("[App] Failed to notify clip server project:", err))

      // Send all recent projects to clip server for extension project picker
      getRecentProjects().then((recents) => {
        const projects = recents.map((p) => ({ name: p.name, path: p.path }))
        fetch("http://127.0.0.1:19827/projects", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Clip-Token": token,
          },
          body: JSON.stringify({ projects }),
        }).catch((err) => console.warn("[App] Failed to send recent projects to clip server:", err))
      }).catch((err) => console.warn("[App] Failed to get recent projects:", err))
    }).catch((err) => console.warn("[App] Failed to get clip server token:", err))
    try {
      const tree = await listDirectory(proj.path)
      setFileTree(tree)
    } catch (err) {
      console.error("Failed to load file tree:", err)
    }
    // Load persisted review items
    try {
      const savedReview = await loadReviewItems(proj.path)
      useReviewStore.getState().setItems(savedReview)
    } catch (err) {
      console.warn("[App] Failed to load review items:", err)
    }
    // Load persisted chat history
    try {
      const savedChat = await loadChatHistory(proj.path)
      useChatStore.getState().setConversations(savedChat.conversations)
      useChatStore.getState().setMessages(savedChat.messages)
      // Set most recent conversation as active
      const sorted = [...savedChat.conversations].sort((a, b) => b.updatedAt - a.updatedAt)
      if (sorted[0]) {
        useChatStore.getState().setActiveConversation(sorted[0].id)
      }
    } catch (err) {
      console.warn("[App] Failed to load chat history:", err)
    }
  }

  async function handleSelectRecent(proj: WikiProject) {
    try {
      const validated = await openProject(proj.path)
      await handleProjectOpened(validated)
    } catch (err) {
      window.alert(`Failed to open project: ${err}`)
    }
  }

  async function handleOpenProject() {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Open Wiki Project",
    })
    if (!selected) return
    try {
      const proj = await openProject(selected)
      await handleProjectOpened(proj)
    } catch (err) {
      window.alert(`Failed to open project: ${err}`)
    }
  }

  function handleSwitchProject() {
    setProject(null)
    setFileTree([])
    setSelectedFile(null)
    setFileContent("")
    setActiveView("wiki")
    setChatExpanded(false)
    useReviewStore.getState().setItems([])
    useChatStore.getState().resetProjectState()
    useResearchStore.getState().clearTasks()
    useResearchStore.getState().setPanelOpen(false)
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-muted-foreground">
        Loading...
      </div>
    )
  }

  if (!project) {
    return (
      <>
        <WelcomeScreen
          onCreateProject={() => setShowCreateDialog(true)}
          onOpenProject={handleOpenProject}
          onSelectProject={handleSelectRecent}
        />
        <CreateProjectDialog
          open={showCreateDialog}
          onOpenChange={setShowCreateDialog}
          onCreated={handleProjectOpened}
        />
      </>
    )
  }

  return (
    <>
      <AppLayout onSwitchProject={handleSwitchProject} />
      <CreateProjectDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        onCreated={handleProjectOpened}
      />
    </>
  )
}

export default App
