import { useWikiStore, type PgConfig, type CustomProviderConfig, type LlmConfig } from "@/stores/wiki-store"
import { useChatStore } from "@/stores/chat-store"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useState, useEffect, useRef, useMemo, useCallback } from "react"
import {
  syncStockCodes,
  getStockCodesStatus,
  updateStockCodes,
  getStockSyncStatus,
  type SyncResult,
  type FetchResult,
} from "@/commands/stock-codes"
import { savePgConfig } from "@/lib/project-store"
import { useTranslation } from "react-i18next"
import i18n from "@/i18n"
import { saveLanguage, saveAppTheme } from "@/lib/project-store"
import { THEME_PRESETS } from "@/types/theme"
import type { AppTheme } from "@/types/theme"
import { WikiDoctorDialog } from "./wiki-doctor-dialog"
import { MigrateSchemaDialog } from "./migrate-schema-dialog"
import { NormalizeDirsDialog } from "./normalize-dirs-dialog"
import { CleanupGarbageDialog } from "./cleanup-garbage-dialog"
import { BodyResidueDialog } from "./body-residue-dialog"
import { ImaSyncSection } from "./ima-sync-section"
import {
  Stethoscope,
  Eye,
  EyeOff,
  Activity,
  Loader2,
  CheckCircle2,
  XCircle,
  Copy,
  Check,
  ArrowUpCircle,
  FolderTree,
  FileScan,
  Trash2,
  RefreshCw,
  KeyRound,
  X,
  Plus,
} from "lucide-react"
import {
  previewProviderUrl,
  testLlmConnection,
  fetchProviderModels,
  type LlmTestResult,
} from "@/lib/llm-test"

const PROVIDERS = [
  { value: "openai" as const, label: "OpenAI", models: ["gpt-4o", "gpt-4.1", "gpt-4o-mini"] },
  { value: "anthropic" as const, label: "Anthropic", models: ["claude-sonnet-4-5-20250514", "claude-opus-4-5-20250514", "claude-haiku-4-5-20251001"] },
  { value: "google" as const, label: "Google", models: ["gemini-2.5-pro", "gemini-2.5-flash"] },
  { value: "minimax" as const, label: "MiniMax", models: ["MiniMax-M2.7", "MiniMax-M2.7-highspeed"] },
  { value: "kimi" as const, label: "Kimi Code", models: ["kimi-for-coding"] },
  // DeepSeek-V4 models referenced by esengine/DeepSeek-Reasonix (DeepSeek-native agent).
  // deepseek-chat / deepseek-reasoner were deprecated by DeepSeek on 2026-07-24.
  { value: "deepseek" as const, label: "DeepSeek", models: ["deepseek-v4-flash", "deepseek-v4-pro"] },
  { value: "codex" as const, label: "Codex（Responses API）", models: ["gpt-5.4", "gpt-5.3-codex"] },
  { value: "ollama" as const, label: "Ollama（本地）", models: [] },
  { value: "custom" as const, label: "自定义", models: [] },
]

const REASONING_EFFORTS = [
  { value: "minimal" as const, label: "最小" },
  { value: "low" as const, label: "低" },
  { value: "medium" as const, label: "中" },
  { value: "high" as const, label: "高" },
]

const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "zh", label: "中文" },
]

const HISTORY_OPTIONS = [2, 4, 6, 8, 10, 20]

export function SettingsView() {
  const { t } = useTranslation()
  const llmConfig = useWikiStore((s) => s.llmConfig)
  const setLlmConfig = useWikiStore((s) => s.setLlmConfig)
  const searchApiConfig = useWikiStore((s) => s.searchApiConfig)
  const setSearchApiConfig = useWikiStore((s) => s.setSearchApiConfig)
  const embeddingConfig = useWikiStore((s) => s.embeddingConfig)
  const setEmbeddingConfig = useWikiStore((s) => s.setEmbeddingConfig)
  const maxHistoryMessages = useChatStore((s) => s.maxHistoryMessages)
  const setMaxHistoryMessages = useChatStore((s) => s.setMaxHistoryMessages)

  const [provider, setProvider] = useState(llmConfig.provider)
  const [apiKey, setApiKey] = useState(llmConfig.apiKey)
  const [model, setModel] = useState(llmConfig.model)
  const [ollamaUrl, setOllamaUrl] = useState(llmConfig.ollamaUrl)
  const [customEndpoint, setCustomEndpoint] = useState(llmConfig.customEndpoint)
  const [maxContextSize, setMaxContextSize] = useState(llmConfig.maxContextSize ?? 204800)
  const [reasoningEffort, setReasoningEffort] = useState<NonNullable<typeof llmConfig.reasoningEffort>>(
    llmConfig.reasoningEffort ?? "medium",
  )
  const [searchProvider, setSearchProvider] = useState(searchApiConfig.provider)
  const [searchApiKey, setSearchApiKey] = useState(searchApiConfig.apiKey)
  const [embeddingEnabled, setEmbeddingEnabled] = useState(embeddingConfig.enabled)
  const [embeddingEndpoint, setEmbeddingEndpoint] = useState(embeddingConfig.endpoint)
  const [embeddingApiKey, setEmbeddingApiKey] = useState(embeddingConfig.apiKey)
  const [embeddingModel, setEmbeddingModel] = useState(embeddingConfig.model)
  // 每提供商独立保存的密钥/模型映射（本地镜像，随 llmConfig 重载而重置）
  const [keysMap, setKeysMap] = useState<Partial<Record<string, string>>>(llmConfig.keys ?? {})
  const [modelsMap, setModelsMap] = useState<Partial<Record<string, string>>>(llmConfig.models ?? {})
  const [keyHistoryMap, setKeyHistoryMap] = useState<Partial<Record<string, string[]>>>(
    llmConfig.keyHistory ?? {},
  )
  // 已保存的「自定义提供商」按钮（在提供商选择区动态渲染，可删除）
  const [customProviders, setCustomProviders] = useState<CustomProviderConfig[]>(
    Array.isArray(llmConfig.customProviders) ? llmConfig.customProviders : [],
  )
  const [activeCustomId, setActiveCustomId] = useState<string | null>(null)
  const [customProviderDraftName, setCustomProviderDraftName] = useState("")
  const [showCustomProviderInput, setShowCustomProviderInput] = useState(false)
  const [confirmDeleteCustomId, setConfirmDeleteCustomId] = useState<string | null>(null)
  const [apiKeyFocused, setApiKeyFocused] = useState(false)
  const [saved, setSaved] = useState(false)
  const [currentLang, setCurrentLang] = useState(i18n.language)
  const [doctorOpen, setDoctorOpen] = useState(false)
  const [migrateOpen, setMigrateOpen] = useState(false)
  const [normalizeOpen, setNormalizeOpen] = useState(false)
  const [residueOpen, setResidueOpen] = useState(false)
  const [cleanupGarbageOpen, setCleanupGarbageOpen] = useState(false)
  const [showApiKey, setShowApiKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<LlmTestResult | null>(null)
  const [urlCopied, setUrlCopied] = useState(false)
  // 动态模型列表（从各提供商的 models 接口拉取，OpenAI 兼容 /v1/models、Ollama /api/tags 等）
  const [fetchedModels, setFetchedModels] = useState<string[] | null>(null)
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const appTheme = useWikiStore((s) => s.appTheme)
  const setAppTheme = useWikiStore((s) => s.setAppTheme)
  const settingsFocusSection = useWikiStore((s) => s.settingsFocusSection)
  const setSettingsFocusSection = useWikiStore((s) => s.setSettingsFocusSection)
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 侧栏「研报同步」等入口：打开设置后滚到对应区块
  useEffect(() => {
    if (!settingsFocusSection) return
    const id = settingsFocusSection
    let cancelled = false
    const tryScroll = (attempt = 0) => {
      if (cancelled) return
      const el = document.getElementById(id)
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" })
        // 轻量高亮一闪，方便识别定位
        el.classList.add("ring-2", "ring-primary/60")
        window.setTimeout(() => {
          el.classList.remove("ring-2", "ring-primary/60")
        }, 1600)
        setSettingsFocusSection(null)
        return
      }
      if (attempt < 12) {
        window.setTimeout(() => tryScroll(attempt + 1), 50)
      } else {
        setSettingsFocusSection(null)
      }
    }
    // 等设置页布局完成
    const t = window.setTimeout(() => tryScroll(0), 80)
    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
  }, [settingsFocusSection, setSettingsFocusSection])

  useEffect(() => {
    setProvider(llmConfig.provider)
    setApiKey(llmConfig.apiKey)
    setModel(llmConfig.model)
    setOllamaUrl(llmConfig.ollamaUrl)
    setCustomEndpoint(llmConfig.customEndpoint)
    setReasoningEffort(llmConfig.reasoningEffort ?? "medium")
    setKeysMap(llmConfig.keys ?? {})
    setModelsMap(llmConfig.models ?? {})
    setKeyHistoryMap(llmConfig.keyHistory ?? {})
    setCustomProviders(Array.isArray(llmConfig.customProviders) ? llmConfig.customProviders : [])
    // 恢复选中的自定义提供商（若 id 已失效则回落为 null，避免高亮一个不存在的项）
    const restoredId = llmConfig.activeCustomId ?? null
    const list = Array.isArray(llmConfig.customProviders) ? llmConfig.customProviders : []
    const matched = restoredId ? list.find((p) => p.id === restoredId) : null
    setActiveCustomId(matched ? restoredId : null)
  }, [llmConfig])

  useEffect(() => {
    return () => {
      if (savedTimerRef.current) {
        clearTimeout(savedTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    setSearchProvider(searchApiConfig.provider)
    setSearchApiKey(searchApiConfig.apiKey)
  }, [searchApiConfig])

  const currentProvider = PROVIDERS.find((p) => p.value === provider)

  const previewUrl = useMemo(
    () =>
      previewProviderUrl({
        provider,
        apiKey,
        model,
        ollamaUrl,
        customEndpoint,
        maxContextSize,
        reasoningEffort,
      }),
    [provider, apiKey, model, ollamaUrl, customEndpoint, maxContextSize, reasoningEffort],
  )

  // Reset test result whenever the form changes — stale results are misleading
  useEffect(() => {
    setTestResult(null)
  }, [provider, apiKey, model, ollamaUrl, customEndpoint, reasoningEffort])

  async function handleTestConnection() {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await testLlmConnection({
        provider,
        apiKey,
        model,
        ollamaUrl,
        customEndpoint,
        maxContextSize,
        reasoningEffort,
      })
      setTestResult(result)
    } finally {
      setTesting(false)
    }
  }

  // 切换提供商 / 修改密钥(endpoint) 时，自动从该提供商的 models 接口拉取模型列表。
  // Ollama 是本地服务，按用户偏好不参与自动刷新，仅手动「刷新模型」按钮触发。
  // 其他提供商需要有效凭据（custom 需 endpoint + API Key；其余需 API Key），缺一不可即不发起请求，并清空已拉取列表。
  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(() => {
      void (async () => {
        setFetchedModels(null)
        setModelsError(null)
        // Ollama 不参与自动刷新
        if (provider === "ollama") return
        if (provider === "custom") {
          if (!customEndpoint.trim() || !apiKey.trim()) return
        } else if (!apiKey.trim()) {
          return
        }
        setModelsLoading(true)
        const models = await fetchProviderModels(provider, {
          endpoint: customEndpoint,
          apiKey,
          ollamaUrl,
        })
        if (cancelled) return
        setModelsLoading(false)
        if (models.length > 0) {
          setFetchedModels(models)
          setModelsError(null)
        } else {
          setFetchedModels(null)
          setModelsError("未能从接口获取模型列表，已回退到默认列表")
        }
      })()
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [provider, apiKey, customEndpoint, ollamaUrl])

  async function refreshModels() {
    if (provider === "custom" && !customEndpoint.trim()) {
      setModelsError("请先填写自定义 Endpoint")
      return
    }
    if (provider === "custom" && !apiKey.trim()) {
      setModelsError("请先填写 API Key")
      return
    }
    if (provider === "ollama" && !ollamaUrl.trim()) {
      setModelsError("请先填写 Ollama 地址")
      return
    }
    if (provider !== "ollama" && !apiKey.trim()) {
      setModelsError("请先填写 API Key")
      return
    }
    setModelsLoading(true)
    setModelsError(null)
    const models = await fetchProviderModels(provider, {
      endpoint: customEndpoint,
      apiKey,
      ollamaUrl,
    })
    setModelsLoading(false)
    if (models.length > 0) {
      setFetchedModels(models)
      setModelsError(null)
    } else {
      setFetchedModels(null)
      setModelsError("未能从接口获取模型列表，已回退到默认列表")
    }
  }

  async function handleCopyUrl() {
    if (!previewUrl) return
    try {
      await navigator.clipboard.writeText(previewUrl)
      setUrlCopied(true)
      setTimeout(() => setUrlCopied(false), 1500)
    } catch {
      // ignore
    }
  }

  function handleSaveCustomProvider() {
    if (provider !== "custom") return
    const name = customProviderDraftName.trim()
    if (!name) return
    const next: CustomProviderConfig = {
      id: `cp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      endpoint: customEndpoint,
      apiKey,
      model,
      reasoningEffort: reasoningEffort,
    }
    const prevList = Array.isArray(customProviders) ? customProviders : []
    const existing = prevList.find((p) => p.name === name)
    const nextList = existing
      ? prevList.map((p) => (p.name === name ? { ...next, id: p.id } : p)) // 同名覆盖，保留原 id
      : [next, ...prevList]
    setCustomProviders(nextList)
    setCustomProviderDraftName("")
    setShowCustomProviderInput(false)
    // 同步持久化到 store（单一数据源）。否则上方的 llmConfig 同步 effect 在 llmConfig 变化时，
    // 会用 store 里的旧 customProviders 覆盖本地列表，导致刚保存的项立刻消失。
    persistCustomProviders(nextList)
  }

  function handleDeleteCustomProvider(id: string) {
    const nextList = (Array.isArray(customProviders) ? customProviders : []).filter((p) => p.id !== id)
    setCustomProviders(nextList)
    if (activeCustomId === id) setActiveCustomId(null)
    setConfirmDeleteCustomId(null)
    persistCustomProviders(nextList)
  }

  // 把当前 LLM 配置写回 store 并落盘（含 activeCustomId）——供选择提供商 / 选择自定义项时即时持久化
  function persistLlmConfig(next: LlmConfig) {
    setLlmConfig(next)
    void import("@/lib/project-store").then(({ saveLlmConfig }) => void saveLlmConfig(next))
  }

  // 把最新的 customProviders 列表写回 store 并落盘（基于当前本地字段值重建，避免丢失未保存的编辑）
  function persistCustomProviders(list: CustomProviderConfig[]) {
    persistLlmConfig({
      provider,
      apiKey,
      model,
      ollamaUrl,
      customEndpoint,
      maxContextSize,
      reasoningEffort,
      keys: keysMap,
      models: modelsMap,
      keyHistory: keyHistoryMap,
      customProviders: list,
      activeCustomId,
    })
  }

  async function handleSave() {
    const { saveLlmConfig, saveSearchApiConfig, saveEmbeddingConfig } = await import("@/lib/project-store")
    // 把当前激活提供商的密钥/模型写入对应映射，并维护历史 key 列表（去重）
    const nextKeys = { ...keysMap, [provider]: apiKey }
    const nextModels = { ...modelsMap, [provider]: model }
    const trimmedKey = apiKey.trim()
    const prevHistoryRaw = keyHistoryMap[provider]
    const prevHistory: string[] = Array.isArray(prevHistoryRaw)
      ? prevHistoryRaw.filter((k): k is string => typeof k === "string" && k.length > 0)
      : []
    const nextHistory = trimmedKey && !prevHistory.includes(trimmedKey) ? [...prevHistory, trimmedKey] : prevHistory
    const nextKeyHistory = { ...keyHistoryMap, [provider]: nextHistory }
    const newConfig = {
      provider,
      apiKey,
      model,
      ollamaUrl,
      customEndpoint,
      maxContextSize,
      reasoningEffort,
      keys: nextKeys,
      models: nextModels,
      keyHistory: nextKeyHistory,
      customProviders,
      activeCustomId,
    }
    const newSearchConfig = { provider: searchProvider, apiKey: searchApiKey }
    const newEmbeddingConfig = { enabled: embeddingEnabled, endpoint: embeddingEndpoint, apiKey: embeddingApiKey, model: embeddingModel }
    setSearchApiConfig(newSearchConfig)
    await saveSearchApiConfig(newSearchConfig)
    setEmbeddingConfig(newEmbeddingConfig)
    await saveEmbeddingConfig(newEmbeddingConfig)
    setLlmConfig(newConfig)
    await saveLlmConfig(newConfig)
    // 同步本地映射镜像，避免保存后切换 provider 时回退到旧值
    setKeysMap(nextKeys)
    setModelsMap(nextModels)
    setKeyHistoryMap(nextKeyHistory)
    setSaved(true)
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
    savedTimerRef.current = setTimeout(() => setSaved(false), 2000)
  }

  async function handleLanguageChange(lang: string) {
    await i18n.changeLanguage(lang)
    setCurrentLang(lang)
    await saveLanguage(lang)
  }

  async function handleThemeChange(theme: AppTheme) {
    setAppTheme(theme)
    await saveAppTheme(theme)
  }

  return (
    <div className="h-full overflow-auto p-8">
      <div className="mx-auto max-w-xl">
        <h2 className="mb-6 text-2xl font-bold">{t("settings.title")}</h2>

        <div className="space-y-6">
          {/* Language section */}
          <div className="space-y-4 rounded-lg border p-4">
            <h3 className="font-semibold">{t("settings.language")}</h3>
            <div className="flex flex-wrap gap-2">
              {LANGUAGES.map((lang) => (
                <button
                  key={lang.value}
                  onClick={() => handleLanguageChange(lang.value)}
                  className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                    currentLang === lang.value
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border hover:bg-accent"
                  }`}
                >
                  {lang.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">{t("settings.languageHint")}</p>
          </div>

          {/* Appearance / Theme section */}
          <div className="space-y-4 rounded-lg border p-4">
            <h3 className="font-semibold">{t("settings.appearance")}</h3>
            <p className="text-xs text-muted-foreground">{t("settings.appearanceHint")}</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {THEME_PRESETS.map((preset) => (
                <button
                  key={preset.key}
                  onClick={() => handleThemeChange(preset.key)}
                  className={`group relative flex flex-col items-center gap-2 rounded-lg border p-3 transition-all ${
                    appTheme === preset.key
                      ? "border-primary bg-primary/5 ring-1 ring-primary"
                      : "border-border hover:border-primary/50 hover:bg-accent"
                  }`}
                >
                  <div
                    className="h-10 w-full rounded-md shadow-inner"
                    style={{ backgroundColor: preset.previewColor }}
                  />
                  <span className="text-xs font-medium">
                    {i18n.language === "zh" ? preset.label : preset.labelEn}
                  </span>
                  {appTheme === preset.key && (
                    <span className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground">
                      ✓
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* LLM Provider section */}
          <div className="space-y-4 rounded-lg border p-4">
            <h3 className="font-semibold">{t("settings.llmProvider")}</h3>

            <div className="space-y-2">
              <Label>{t("settings.provider")}</Label>
              <div className="flex flex-wrap gap-2">
                {PROVIDERS.map((p) => (
                  <button
                    key={p.value}
                    onClick={() => {
                      const nextApiKey = keysMap[p.value] ?? ""
                      const nextModel = modelsMap[p.value] || p.models[0] || ""
                      setProvider(p.value)
                      setActiveCustomId(null)
                      // 切换到该提供商：输入框回填该提供商已存的密钥（或清空），模型刷新为对应提供商的模型
                      setApiKey(nextApiKey)
                      setModel(nextModel)
                      persistLlmConfig({
                        provider: p.value,
                        apiKey: nextApiKey,
                        model: nextModel,
                        ollamaUrl,
                        customEndpoint,
                        maxContextSize,
                        reasoningEffort,
                        keys: keysMap,
                        models: modelsMap,
                        keyHistory: keyHistoryMap,
                        customProviders: Array.isArray(customProviders) ? customProviders : [],
                        activeCustomId: null,
                      })
                    }}
                    className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                      provider === p.value && activeCustomId === null
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border hover:bg-accent"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
                {customProviders.map((cp) => (
                  <div
                    key={cp.id}
                    className={`group flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-sm transition-colors ${
                      provider === "custom" && activeCustomId === cp.id
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border hover:bg-accent"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        const nextApiKey = cp.apiKey || keysMap["custom"] || ""
                        const nextKeysMap = { ...keysMap, custom: nextApiKey }
                        const nextModelsMap = { ...modelsMap, custom: cp.model }
                        setProvider("custom")
                        setActiveCustomId(cp.id)
                        setCustomEndpoint(cp.endpoint)
                        setApiKey(nextApiKey)
                        setModel(cp.model)
                        if (cp.reasoningEffort) setReasoningEffort(cp.reasoningEffort)
                        setKeysMap(nextKeysMap)
                        setModelsMap(nextModelsMap)
                        persistLlmConfig({
                          provider: "custom",
                          apiKey: nextApiKey,
                          model: cp.model,
                          ollamaUrl,
                          customEndpoint: cp.endpoint,
                          maxContextSize,
                          reasoningEffort: cp.reasoningEffort ?? reasoningEffort,
                          keys: nextKeysMap,
                          models: nextModelsMap,
                          keyHistory: keyHistoryMap,
                          customProviders: Array.isArray(customProviders) ? customProviders : [],
                          activeCustomId: cp.id,
                        })
                      }}
                      className="px-1.5 py-1"
                    >
                      {cp.name}
                    </button>
                    {confirmDeleteCustomId === cp.id ? (
                      <button
                        type="button"
                        onClick={() => handleDeleteCustomProvider(cp.id)}
                        className="rounded px-1 py-0.5 text-[11px] text-destructive hover:bg-destructive/15"
                        title={t("settings.deleteCustomProvider")}
                      >
                        {t("settings.deleteCustomProvider")}?
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteCustomId(cp.id)}
                        className="rounded px-1 py-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                        title={t("settings.deleteCustomProvider")}
                      >
                        <X className="size-3" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {(provider === "custom" ||
              provider === "minimax" ||
              provider === "openai" ||
              provider === "anthropic" ||
              provider === "kimi" ||
              provider === "deepseek" ||
              provider === "codex") && (
              <div className="space-y-2">
                <Label htmlFor="customEndpoint">
                  {provider === "minimax"
                    ? "MiniMax Endpoint"
                    : provider === "openai"
                      ? "OpenAI Endpoint"
                      : provider === "anthropic"
                        ? "Anthropic Endpoint"
                        : provider === "kimi"
                          ? "Kimi Code Endpoint"
                          : provider === "deepseek"
                            ? "DeepSeek Endpoint"
                            : provider === "codex"
                              ? "Codex Endpoint"
                              : t("settings.customEndpoint")}
                </Label>
                <Input
                  id="customEndpoint"
                  value={customEndpoint}
                  onChange={(e) => setCustomEndpoint(e.target.value)}
                  placeholder={
                    provider === "minimax"
                      ? "https://api.minimax.io/v1"
                      : provider === "openai"
                        ? "https://api.openai.com/v1"
                        : provider === "anthropic"
                          ? "https://api.anthropic.com"
                          : provider === "kimi"
                            ? "https://api.kimi.com/coding/v1"
                            : provider === "deepseek"
                              ? "https://api.deepseek.com/v1"
                              : provider === "codex"
                                ? "https://api.suyacode.com"
                                : "https://your-api.example.com/v1"
                  }
                />
                <p className="text-xs text-muted-foreground">
                  {provider === "minimax"
                    ? "国内用户请填写 https://api.minimaxi.com/v1，国际用户可留空使用默认 endpoint"
                    : provider === "openai"
                      ? "留空使用官方 https://api.openai.com/v1，可填写第三方中转 base URL（自动拼接 /chat/completions）"
                      : provider === "anthropic"
                        ? "留空使用官方 https://api.anthropic.com，可填写代理 base URL（自动拼接 /v1/messages）"
                        : provider === "kimi"
                          ? "留空使用 Kimi Code 编码端点（256K 上下文 / kimi-for-coding 模型）；如需通用 Kimi 可填 https://api.moonshot.cn/v1 并改 model 为 moonshot-v1-128k"
                          : provider === "deepseek"
                            ? "留空使用官方 https://api.deepseek.com/v1（自动拼接 /chat/completions）。适配 DeepSeek V4 / V3 / Reasoner，自动启用前缀缓存以降低输入 token 成本。"
                            : provider === "codex"
                              ? "留空使用官方 https://api.openai.com，可填写中转站 base URL（自动拼接 /v1/responses）。适配 GPT-5 / Codex 系列推理模型。"
                              : t("settings.customEndpointHint")}
                </p>
              </div>
            )}

            {provider === "codex" && (
              <div className="space-y-2">
                <Label>思考深度</Label>
                <div className="flex flex-wrap gap-2">
                  {REASONING_EFFORTS.map((e) => (
                    <button
                      key={e.value}
                      onClick={() => setReasoningEffort(e.value)}
                      className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                        reasoningEffort === e.value
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border hover:bg-accent"
                      }`}
                    >
                      {e.label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  控制模型思考深度。档位越低速度越快、思考越浅；档位越高推理越深、速度越慢、token 消耗越大。
                </p>
              </div>
            )}

            {provider === "ollama" && (
              <div className="space-y-2">
                <Label htmlFor="ollamaUrl">{t("settings.ollamaUrl")}</Label>
                <Input
                  id="ollamaUrl"
                  value={ollamaUrl}
                  onChange={(e) => setOllamaUrl(e.target.value)}
                  placeholder="http://localhost:11434"
                />
              </div>
            )}

            {provider !== "ollama" && (
              <div className="space-y-2">
                <Label htmlFor="apiKey">{t("settings.apiKey")}</Label>
                <div className="relative" onBlur={() => setApiKeyFocused(false)}>
                  <Input
                    id="apiKey"
                    type={showApiKey ? "text" : "password"}
                    value={apiKey}
                    onChange={(e) => {
                      const v = e.target.value
                      setApiKey(v)
                      // 实时写入该提供商的密钥映射，切换 provider 时不会丢失本次编辑
                      setKeysMap((m) => ({ ...m, [provider]: v }))
                    }}
                    onFocus={() => setApiKeyFocused(true)}
                    className="pr-9 font-mono"
                    placeholder={
                      provider === "custom"
                        ? t("settings.customApiKey")
                        : t("settings.apiKeyPlaceholder", { provider: currentProvider?.label })
                    }
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    aria-label={showApiKey ? "隐藏 API Key" : "显示 API Key"}
                    tabIndex={-1}
                  >
                    {showApiKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                  {apiKeyFocused &&
                    (() => {
                      const raw = keyHistoryMap[provider]
                      const historyArr: string[] = Array.isArray(raw)
                        ? raw.filter((k): k is string => typeof k === "string" && k.length > 0)
                        : []
                      const suggestions = historyArr.filter((k) => k !== apiKey)
                      if (suggestions.length === 0) return null
                      return (
                        <div className="absolute left-0 right-0 z-20 mt-1 overflow-hidden rounded-md border bg-popover shadow-md">
                          <div className="border-b px-2 py-1 text-xs text-muted-foreground">
                            {t("settings.selectSavedKey")}
                          </div>
                          {suggestions.map((k, i) => (
                            <button
                              key={`${i}-${k.slice(-4)}`}
                              type="button"
                              onMouseDown={(e) => {
                                e.preventDefault()
                                setApiKey(k)
                                setKeysMap((m) => ({ ...m, [provider]: k }))
                                setApiKeyFocused(false)
                              }}
                              className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs font-mono hover:bg-accent"
                            >
                              <KeyRound className="size-3.5 shrink-0 text-muted-foreground" />
                              <span>{"•••• " + k.slice(-4)}</span>
                              <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                                {currentProvider?.label}
                              </span>
                            </button>
                          ))}
                        </div>
                      )
                    })()}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="model">{t("settings.model")}</Label>
                <button
                  type="button"
                  onClick={() => void refreshModels()}
                  disabled={modelsLoading}
                  className="flex items-center gap-1 rounded border px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
                >
                  <RefreshCw className={`size-3 ${modelsLoading ? "animate-spin" : ""}`} />
                  刷新模型
                </button>
              </div>
              {(() => {
                const modelOptions = fetchedModels ?? currentProvider?.models ?? []
                return modelOptions.length > 0 ? (
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-2">
                      {modelOptions.map((m) => (
                        <button
                          key={m}
                          onClick={() => {
                            setModel(m)
                            setModelsMap((mm) => ({ ...mm, [provider]: m }))
                          }}
                          className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                            model === m
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border hover:bg-accent"
                          }`}
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                    <Input
                      value={model}
                      onChange={(e) => {
                        const v = e.target.value
                        setModel(v)
                        setModelsMap((m) => ({ ...m, [provider]: v }))
                      }}
                      placeholder={t("settings.customModel")}
                    />
                  </div>
                ) : (
                  <Input
                    id="model"
                    value={model}
                    onChange={(e) => {
                      const v = e.target.value
                      setModel(v)
                      setModelsMap((m) => ({ ...m, [provider]: v }))
                    }}
                    placeholder={t("settings.modelPlaceholder")}
                  />
                )
              })()}
              {modelsLoading && (
                <p className="text-xs text-muted-foreground">正在从接口获取模型列表…</p>
              )}
              {modelsError && (
                <p className="text-xs text-muted-foreground">{modelsError}</p>
              )}
            </div>

            {provider === "custom" && (
              <div className="space-y-2 border-t pt-4">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">{t("settings.saveAsCustomProvider")}</Label>
                  {!showCustomProviderInput ? (
                    <button
                      type="button"
                      onClick={() => setShowCustomProviderInput(true)}
                      className="flex items-center gap-1 rounded border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      <Plus className="size-3" />
                      {t("settings.saveAsCustomProvider")}
                    </button>
                  ) : (
                    <div className="flex items-center gap-1">
                      <Input
                        autoFocus
                        value={customProviderDraftName}
                        onChange={(e) => setCustomProviderDraftName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void handleSaveCustomProvider()
                          if (e.key === "Escape") {
                            setShowCustomProviderInput(false)
                            setCustomProviderDraftName("")
                          }
                        }}
                        placeholder={t("settings.customProviderName")}
                        className="h-7 w-44 text-xs"
                      />
                      <button
                        type="button"
                        onClick={() => void handleSaveCustomProvider()}
                        disabled={!customProviderDraftName.trim()}
                        className="flex h-7 items-center gap-1 rounded border px-2 text-xs text-primary transition-colors hover:bg-accent disabled:opacity-50"
                      >
                        <Check className="size-3" />
                        {t("settings.saveCustomProvider")}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowCustomProviderInput(false)
                          setCustomProviderDraftName("")
                        }}
                        className="flex h-7 items-center gap-1 rounded border px-2 text-xs text-muted-foreground transition-colors hover:bg-accent"
                      >
                        <X className="size-3" />
                      </button>
                    </div>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">{t("settings.customProviderHint")}</p>
              </div>
            )}

            {/* Endpoint preview + connection test */}
            <div className="space-y-2 border-t pt-4">
              {previewUrl && (
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">最终请求 URL</Label>
                  <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-2 py-1.5">
                    <code className="flex-1 truncate font-mono text-xs">{previewUrl}</code>
                    <button
                      type="button"
                      onClick={handleCopyUrl}
                      className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                      aria-label="复制 URL"
                    >
                      {urlCopied ? (
                        <Check className="size-3.5 text-green-600" />
                      ) : (
                        <Copy className="size-3.5" />
                      )}
                    </button>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleTestConnection}
                  disabled={testing || !previewUrl}
                >
                  {testing ? (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  ) : (
                    <Activity className="mr-2 size-4" />
                  )}
                  {testing ? "测试中…" : "测试连接"}
                </Button>

                {testResult && !testing && (
                  <div className="flex-1 text-xs">
                    {testResult.ok ? (
                      <span className="inline-flex items-center gap-1.5 text-green-600">
                        <CheckCircle2 className="size-4" />
                        连接成功 · {testResult.latencyMs}ms 首 token
                      </span>
                    ) : (
                      <span className="inline-flex items-start gap-1.5 text-red-600">
                        <XCircle className="mt-0.5 size-4 shrink-0" />
                        <span className="break-all">
                          {testResult.status ? `HTTP ${testResult.status} · ` : ""}
                          {testResult.error}
                        </span>
                      </span>
                    )}
                  </div>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                测试发送一条最短消息，命中首 token 即判定连通；不会保存当前修改。
              </p>
            </div>
          </div>

          {/* Context Window Size */}
          <div className="space-y-4 rounded-lg border p-4">
            <h3 className="font-semibold">上下文窗口</h3>
            <p className="text-xs text-muted-foreground">
              发送给大模型的最大上下文长度。上下文越大，单次问答可带入的 Wiki 页面越多，但消耗的 Token 也越多。
            </p>

            <div className="space-y-3">
              <ContextSizeSelector value={maxContextSize} onChange={setMaxContextSize} />
            </div>
          </div>

          {/* Web Search API section */}
          <div className="space-y-4 rounded-lg border p-4">
            <h3 className="font-semibold">网络搜索（深度研究）</h3>
            <p className="text-xs text-muted-foreground">
              启用 AI 驱动的网络检索，自动为知识盲区查找相关资料来源。
            </p>

            <div className="space-y-2">
              <Label>搜索提供方</Label>
              <div className="flex flex-wrap gap-2">
                {[
                  { value: "none" as const, label: "关闭" },
                  { value: "tavily" as const, label: "Tavily" },
                ].map((p) => (
                  <button
                    key={p.value}
                    onClick={() => setSearchProvider(p.value)}
                    className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                      searchProvider === p.value
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border hover:bg-accent"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {searchProvider !== "none" && (
              <div className="space-y-2">
                <Label htmlFor="searchApiKey">API 密钥</Label>
                <Input
                  id="searchApiKey"
                  type="password"
                  value={searchApiKey}
                  onChange={(e) => setSearchApiKey(e.target.value)}
                  placeholder="请输入 Tavily API 密钥（tavily.com）"
                />
              </div>
            )}
          </div>

          {/* Embedding Search section */}
          <div className="space-y-4 rounded-lg border p-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">向量搜索（Embedding）</h3>
              <button
                onClick={() => setEmbeddingEnabled(!embeddingEnabled)}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                  embeddingEnabled ? "bg-primary" : "bg-muted"
                }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                    embeddingEnabled ? "translate-x-4.5" : "translate-x-0.5"
                  }`}
                />
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              启用基于向量嵌入的语义检索，复用当前大模型服务端点。可提升同义词匹配与跨领域发现的搜索质量。
            </p>
            {embeddingEnabled && (
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label>服务端点</Label>
                  <Input
                    value={embeddingEndpoint}
                    onChange={(e) => setEmbeddingEndpoint(e.target.value)}
                    placeholder="例如 http://127.0.0.1:1234/v1/embeddings"
                  />
                </div>
                <div className="space-y-2">
                  <Label>API 密钥（可选）</Label>
                  <Input
                    type="password"
                    value={embeddingApiKey}
                    onChange={(e) => setEmbeddingApiKey(e.target.value)}
                    placeholder="本地模型可留空"
                  />
                </div>
                <div className="space-y-2">
                  <Label>模型</Label>
                  <Input
                    value={embeddingModel}
                    onChange={(e) => setEmbeddingModel(e.target.value)}
                    placeholder="例如 text-embedding-qwen3-embedding-0.6b"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Embedding 服务可与聊天大模型不同，支持任意兼容 OpenAI /v1/embeddings 的端点。
                </p>
              </div>
            )}
          </div>

          {/* Chat History section */}
          <div className="space-y-4 rounded-lg border p-4">
            <h3 className="font-semibold">聊天历史</h3>
            <p className="text-xs text-muted-foreground">
              与 AI 对话时携带的历史消息条数。条数越多上下文越完整，但消耗的 Token 也越多。
            </p>
            <div className="space-y-2">
              <Label>发送给 AI 的最大历史消息数</Label>
              <div className="flex flex-wrap gap-2">
                {HISTORY_OPTIONS.map((n) => (
                  <button
                    key={n}
                    onClick={() => setMaxHistoryMessages(n)}
                    className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                      maxHistoryMessages === n
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border hover:bg-accent"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                当前：{maxHistoryMessages} 条消息（{maxHistoryMessages / 2} 轮对话）
              </p>
            </div>
          </div>

          {/* IMA Report Sync */}
          <ImaSyncSection />

          {/* PostgreSQL Stock Code Source */}
          <PgConfigSection />

          {/* Schema Migration */}
          <div className="space-y-4 rounded-lg border p-4">
            <h3 className="font-semibold">Schema v1 一次性迁移</h3>
            <p className="text-xs text-muted-foreground">
              <strong>步骤 1</strong>：将所有 wiki 页面的 frontmatter 升级为 Schema v1（包 ```yaml、补字段、清 sources、查 DB 覆写股票 code）。跑前自动 zip 备份。
            </p>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => setMigrateOpen(true)}
            >
              <ArrowUpCircle className="mr-2 size-4" />
              迁移 Wiki 到 Schema v1
            </Button>
          </div>

          {/* Body Residue Cleanup (T25) */}
          <div className="space-y-4 rounded-lg border p-4">
            <h3 className="font-semibold">Body 老 frontmatter 残骸清理</h3>
            <p className="text-xs text-muted-foreground">
              <strong>步骤 2</strong>：扫所有页面 body 头部，识别并剖除残留的老 frontmatter（如 <code>***</code> + <code>title:</code>）。从严匹配，抢救 sources/tags/aliases 三类 list 字段。不确定项进报告等手动审核。需先完成步骤 1。
            </p>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => setResidueOpen(true)}
            >
              <FileScan className="mr-2 size-4" />
              清理 body 残骸
            </Button>
          </div>

          {/* Normalize Physical Dirs (T24) */}
          <div className="space-y-4 rounded-lg border p-4">
            <h3 className="font-semibold">物理目录归一化</h3>
            <p className="text-xs text-muted-foreground">
              <strong>步骤 3</strong>：把散乱目录（进化/市场模式/analysis/concept 等）合并到 9 个 canonical 中文目录，同步替换所有 wikilink。冲突文件按 updated 时间保留较新版，旧版进 .conflicts/ 隔离。需先完成步骤 2。
            </p>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => setNormalizeOpen(true)}
            >
              <FolderTree className="mr-2 size-4" />
              归一化 Wiki 目录结构
            </Button>
          </div>

          {/* Cleanup Garbage Pages (T26) */}
          <div className="space-y-4 rounded-lg border p-4">
            <h3 className="font-semibold">清理 wiki/源文档/ + wiki/查询/ 历史垃圾页</h3>
            <p className="text-xs text-muted-foreground">
              <strong>步骤 4</strong>：扫描两个目录里的 .md 文件，识别 LLM 自动生成的「垃圾页」（chat 模板回流、空 slug 文件名、过短 body 等）。命中文件**归档到 wiki/.conflicts/garbage-*/，不删除**。需先完成步骤 1～3。
            </p>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => setCleanupGarbageOpen(true)}
            >
              <Trash2 className="mr-2 size-4" />
              清理历史垃圾页
            </Button>
          </div>

          {/* Wiki Doctor section */}
          <div className="space-y-4 rounded-lg border p-4">
            <h3 className="font-semibold">Wiki 整理工具</h3>
            <p className="text-xs text-muted-foreground">
              检测并修复 Wiki 目录结构问题：重复文件夹、散落文件、索引合并等。
            </p>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => setDoctorOpen(true)}
            >
              <Stethoscope className="mr-2 size-4" />
              打开 Wiki 整理医生
            </Button>
          </div>

          <Button onClick={handleSave} className="w-full">
            {saved ? t("settings.saved") : t("settings.save")}
          </Button>
        </div>
      </div>

      <WikiDoctorDialog open={doctorOpen} onOpenChange={setDoctorOpen} />
      <MigrateSchemaDialog open={migrateOpen} onOpenChange={setMigrateOpen} />
      <BodyResidueDialog open={residueOpen} onOpenChange={setResidueOpen} />
      <NormalizeDirsDialog open={normalizeOpen} onOpenChange={setNormalizeOpen} />
      <CleanupGarbageDialog open={cleanupGarbageOpen} onOpenChange={setCleanupGarbageOpen} />
    </div>
  )
}

// Context size presets matching common model context windows
const CONTEXT_PRESETS = [
  { value: 4096, label: "4K" },
  { value: 8192, label: "8K" },
  { value: 16384, label: "16K" },
  { value: 32768, label: "32K" },
  { value: 65536, label: "64K" },
  { value: 131072, label: "128K" },
  { value: 204800, label: "200K" },
  { value: 262144, label: "256K" },
  { value: 524288, label: "512K" },
  { value: 1000000, label: "1M" },
]

function ContextSizeSelector({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  // Find closest preset index
  const closestIndex = CONTEXT_PRESETS.reduce((best, preset, i) => {
    return Math.abs(preset.value - value) < Math.abs(CONTEXT_PRESETS[best].value - value) ? i : best
  }, 0)

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium">{formatSize(value)}</span>
        <span className="text-xs text-muted-foreground">
          Wiki 内容约 {Math.floor(value * 0.6 / 1000)}K 字符
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={CONTEXT_PRESETS.length - 1}
        step={1}
        value={closestIndex}
        onChange={(e) => onChange(CONTEXT_PRESETS[parseInt(e.target.value)].value)}
        className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-primary"
        style={{ background: `linear-gradient(to right, #4f46e5 ${(closestIndex / (CONTEXT_PRESETS.length - 1)) * 100}%, #e5e7eb ${(closestIndex / (CONTEXT_PRESETS.length - 1)) * 100}%)` }}
      />
      <div className="flex justify-between mt-1">
        {CONTEXT_PRESETS.map((preset, i) => (
          <button
            key={preset.value}
            type="button"
            onClick={() => onChange(preset.value)}
            className={`text-[9px] px-0.5 ${
              i === closestIndex ? "text-primary font-bold" : "text-muted-foreground/50"
            }`}
          >
            {preset.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function formatSize(chars: number): string {
  if (chars >= 1000000) return `${(chars / 1000000).toFixed(1)}M 字符`
  if (chars >= 1000) return `${Math.round(chars / 1000)}K 字符`
  return `${chars} 字符`
}

function PgConfigSection() {
  const project = useWikiStore((s) => s.project)
  const pgConfig = useWikiStore((s) => s.pgConfig)
  const setPgConfig = useWikiStore((s) => s.setPgConfig)

  const [host, setHost] = useState(pgConfig.host)
  const [port, setPort] = useState<string>(pgConfig.port?.toString() ?? "")
  const [user, setUser] = useState(pgConfig.user)
  const [password, setPassword] = useState(pgConfig.password)
  const [database, setDatabase] = useState(pgConfig.database)
  const [tableName, setTableName] = useState(pgConfig.table_name ?? "")
  const [colTicker, setColTicker] = useState(pgConfig.col_ticker ?? "")
  const [colStockName, setColStockName] = useState(pgConfig.col_stock_name ?? "")
  const [hasDateColumn, setHasDateColumn] = useState(pgConfig.has_date_column ?? true)
  const [mairuiLicence, setMairuiLicence] = useState(pgConfig.mairui_api_licence ?? "")
  const [showPassword, setShowPassword] = useState(false)
  const [showLicence, setShowLicence] = useState(false)
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [fetching, setFetching] = useState(false)
  const [status, setStatus] = useState<SyncResult | null>(null)
  const [fetchStatus, setFetchStatus] = useState<FetchResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const loadStatus = useCallback(async () => {
    if (!project) {
      setStatus(null)
      setFetchStatus(null)
      return
    }
    try {
      const [s, f] = await Promise.all([
        getStockCodesStatus(project.path),
        getStockSyncStatus(project.path),
      ])
      setStatus(s)
      setFetchStatus(f)
    } catch (err) {
      console.warn("[PgConfig] load status failed:", err)
    }
  }, [project])

  useEffect(() => {
    setHost(pgConfig.host)
    setPort(pgConfig.port?.toString() ?? "")
    setUser(pgConfig.user)
    setPassword(pgConfig.password)
    setDatabase(pgConfig.database)
    setTableName(pgConfig.table_name ?? "")
    setColTicker(pgConfig.col_ticker ?? "")
    setColStockName(pgConfig.col_stock_name ?? "")
    setHasDateColumn(pgConfig.has_date_column ?? true)
    setMairuiLicence(pgConfig.mairui_api_licence ?? "")
  }, [pgConfig])

  useEffect(() => {
    loadStatus()
  }, [loadStatus])

  function currentConfig(): PgConfig {
    const portNum = port.trim() ? Number(port) : null
    return {
      host: host.trim(),
      port: Number.isFinite(portNum as number) ? (portNum as number) : null,
      user: user.trim(),
      password,
      database: database.trim(),
      table_name: tableName.trim() || undefined,
      col_ticker: colTicker.trim() || undefined,
      col_stock_name: colStockName.trim() || undefined,
      has_date_column: hasDateColumn,
      mairui_api_licence: mairuiLicence.trim() || undefined,
    }
  }

  function isComplete(cfg: PgConfig): boolean {
    return !!(cfg.host && cfg.port && cfg.user && cfg.password && cfg.database)
  }

  function isFetchReady(cfg: PgConfig): boolean {
    return isComplete(cfg) && !!cfg.table_name && !!cfg.col_ticker && !!cfg.col_stock_name
  }

  function isFetchedToday(fetchStatus: FetchResult | null): boolean {
    if (!fetchStatus?.fetched_at) return false
    const fetchedDate = fetchStatus.fetched_at.slice(0, 10)
    const today = new Date().toISOString().slice(0, 10)
    return fetchedDate === today
  }

  async function handleSave() {
    const cfg = currentConfig()
    setSaving(true)
    try {
      setPgConfig(cfg)
      await savePgConfig(cfg)
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    } finally {
      setSaving(false)
    }
  }

  async function handleRefresh() {
    if (!project) {
      setError("请先打开一个项目")
      return
    }
    const cfg = currentConfig()
    if (!isComplete(cfg)) {
      setError("PG 配置不完整，请填写全部 5 项")
      return
    }
    setError(null)
    setSyncing(true)
    try {
      // Persist current config before sync (so it's not lost on failure)
      setPgConfig(cfg)
      await savePgConfig(cfg)
      const result = await syncStockCodes(project.path, cfg, true)
      setStatus(result)
    } catch (err) {
      setError(typeof err === "string" ? err : String(err))
    } finally {
      setSyncing(false)
    }
  }

  async function handleUpdateStockCodes() {
    if (!project) {
      setError("请先打开一个项目")
      return
    }
    const cfg = currentConfig()
    if (!isFetchReady(cfg)) {
      setError("PG 配置不完整：需填写 Host/Port/Database/User/Password/表名/代码字段/名称字段")
      return
    }
    setError(null)
    setFetching(true)
    try {
      // Persist current config before fetch
      setPgConfig(cfg)
      await savePgConfig(cfg)
      const result = await updateStockCodes(project.path, cfg)
      setFetchStatus(result)
      // 更新 PG 后必须刷新本地缓存文件，否则 lookup_stock_code 仍读旧缓存
      // 导致“DB 中查不到股票代码”的误报
      const syncResult = await syncStockCodes(project.path, cfg, true)
      setStatus(syncResult)
    } catch (err) {
      setError(typeof err === "string" ? err : String(err))
    } finally {
      setFetching(false)
    }
  }

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <h3 className="font-semibold">PostgreSQL 股票代码源</h3>
      <p className="text-xs text-muted-foreground">
        Save to Wiki 写股票页时，由此处的 DB 覆写 code 字段（防止 LLM 瞎编）。使用前请配置下方表名与字段，并填写麦蕊 API licence 以从上游更新股票数据。
      </p>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="pgTableName">表名</Label>
          <Input
            id="pgTableName"
            value={tableName}
            onChange={(e) => setTableName(e.target.value)}
            placeholder="public.stocks"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pgColTicker">股票代码字段</Label>
          <Input
            id="pgColTicker"
            value={colTicker}
            onChange={(e) => setColTicker(e.target.value)}
            placeholder="stock_code"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pgColStockName">股票名称字段</Label>
          <Input
            id="pgColStockName"
            value={colStockName}
            onChange={(e) => setColStockName(e.target.value)}
            placeholder="stock_name"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pgHasDateColumn">含 date 列</Label>
          <div className="flex items-center gap-2">
            <input
              id="pgHasDateColumn"
              type="checkbox"
              className="size-4"
              checked={hasDateColumn}
              onChange={(e) => setHasDateColumn(e.target.checked)}
            />
            <span className="text-xs text-muted-foreground">用于 DISTINCT ON ... ORDER BY date DESC</span>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pgHost">主机</Label>
          <Input
            id="pgHost"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder="127.0.0.1"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pgPort">端口</Label>
          <Input
            id="pgPort"
            type="number"
            value={port}
            onChange={(e) => setPort(e.target.value)}
            placeholder="5432"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pgDatabase">数据库</Label>
          <Input
            id="pgDatabase"
            value={database}
            onChange={(e) => setDatabase(e.target.value)}
            placeholder="cn_stock_db"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pgUser">用户名</Label>
          <Input
            id="pgUser"
            value={user}
            onChange={(e) => setUser(e.target.value)}
            placeholder="用户名"
          />
        </div>
        <div className="col-span-2 space-y-1.5">
          <Label htmlFor="pgPassword">密码</Label>
          <div className="relative">
            <Input
              id="pgPassword"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="pr-9 font-mono"
              placeholder="数据库密码"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label={showPassword ? "隐藏密码" : "显示密码"}
              tabIndex={-1}
            >
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </div>
        <div className="col-span-2 space-y-1.5">
          <Label htmlFor="mairuiLicence">麦蕊 API Licence</Label>
          <div className="relative">
            <Input
              id="mairuiLicence"
              type={showLicence ? "text" : "password"}
              value={mairuiLicence}
              onChange={(e) => setMairuiLicence(e.target.value)}
              className="pr-9 font-mono"
              placeholder="麦蕊 licence（用于「更新库中股票数据」）"
            />
            <button
              type="button"
              onClick={() => setShowLicence((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label={showLicence ? "隐藏 Licence" : "显示 Licence"}
              tabIndex={-1}
            >
              {showLicence ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={handleSave} disabled={saving}>
          {saving ? "保存中…" : saved ? "已保存" : "保存配置"}
        </Button>
        <Button
          size="sm"
          onClick={handleRefresh}
          disabled={syncing || !project}
        >
          {syncing ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              同步中…
            </>
          ) : (
            "立即刷新股票代码库"
          )}
        </Button>
        {project && (
          <Button
            variant="secondary"
            size="sm"
            onClick={handleUpdateStockCodes}
            disabled={fetching || !isFetchReady(currentConfig())}
            title={
              isFetchedToday(fetchStatus)
                ? `今日已更新过（${fetchStatus?.fetched_at ?? ""}），点击可强制重新拉取最新股票数据并覆盖 PG 表`
                : "沪深A股直连麦蕊、北交所用北交所官方源，合并后 upsert 到上方配置的 PG 表"
            }
          >
            {fetching ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                更新中…
              </>
            ) : isFetchedToday(fetchStatus) ? (
              "强制更新股票数据"
            ) : (
              "更新库中股票数据"
            )}
          </Button>
        )}
      </div>

      {error && (
        <p className="text-xs text-red-600 break-all">{error}</p>
      )}
      {status && (
        <p className="text-xs text-muted-foreground">
          上次同步：{status.synced_at} · 共 {status.count} 条
        </p>
      )}
      {fetchStatus && (
        <p className="text-xs text-muted-foreground">
          上次抓取：{fetchStatus.fetched_at} · 共 {fetchStatus.count} 条 · 新增 {fetchStatus.inserted} 条 · 更新 {fetchStatus.updated} 条
        </p>
      )}
      {!status && !error && (
        <p className="text-xs text-muted-foreground">
          {project ? "尚未同步过股票代码库" : "请先打开一个项目"}
        </p>
      )}
    </div>
  )
}
