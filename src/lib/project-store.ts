import { load, type StoreOptions } from "@tauri-apps/plugin-store"
import type { WikiProject } from "@/types/wiki"
import type { LlmConfig, SearchApiConfig, EmbeddingConfig, PgConfig, ImaSyncConfig } from "@/stores/wiki-store"
import type { AppTheme } from "@/types/theme"

const STORE_NAME = "app-state.json"
const RECENT_PROJECTS_KEY = "recentProjects"
const LAST_PROJECT_KEY = "lastProject"

async function getStore() {
  return load(STORE_NAME, { autoSave: true } as StoreOptions)
}

export async function getRecentProjects(): Promise<WikiProject[]> {
  const store = await getStore()
  const projects = await store.get<WikiProject[]>(RECENT_PROJECTS_KEY)
  return projects ?? []
}

export async function getLastProject(): Promise<WikiProject | null> {
  const store = await getStore()
  const project = await store.get<WikiProject>(LAST_PROJECT_KEY)
  return project ?? null
}

export async function saveLastProject(project: WikiProject): Promise<void> {
  const store = await getStore()
  await store.set(LAST_PROJECT_KEY, project)
  await addToRecentProjects(project)
}

export async function addToRecentProjects(
  project: WikiProject
): Promise<void> {
  const store = await getStore()
  const existing = (await store.get<WikiProject[]>(RECENT_PROJECTS_KEY)) ?? []
  const filtered = existing.filter((p) => p.path !== project.path)
  const updated = [project, ...filtered].slice(0, 10)
  await store.set(RECENT_PROJECTS_KEY, updated)
}

const LLM_CONFIG_KEY = "llmConfig"

export async function saveLlmConfig(config: LlmConfig): Promise<void> {
  const store = await getStore()
  await store.set(LLM_CONFIG_KEY, config)
}

/**
 * 把任意来源的 keyHistory 规范化为 `Partial<Record<provider, string[]>>` 形状。
 * - 已是数组 → 过滤空串保留
 * - 是非空字符串 → 包成单元素数组
 * - 其他（undefined / null / 空对象 / 对象值非字符串）→ 返回 {}
 */
function normalizeKeyHistory(
  raw: unknown,
  fallbackKeys?: Partial<Record<LlmConfig["provider"], string>>,
): Partial<Record<LlmConfig["provider"], string[]>> {
  const out: Partial<Record<LlmConfig["provider"], string[]>> = {}
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (Array.isArray(v)) {
        const arr = v.filter((x): x is string => typeof x === "string" && x.length > 0)
        if (arr.length > 0) out[k as LlmConfig["provider"]] = arr
      } else if (typeof v === "string" && v.length > 0) {
        out[k as LlmConfig["provider"]] = [v]
      }
    }
  }
  // 兜底：当没有任何 keyHistory 时，从 keys 至少回填一条历史
  if (Object.keys(out).length === 0 && fallbackKeys) {
    for (const [k, v] of Object.entries(fallbackKeys)) {
      if (v) out[k as LlmConfig["provider"]] = [v]
    }
  }
  return out
}

export async function loadLlmConfig(): Promise<LlmConfig | null> {
  const store = await getStore()
  const cfg = (await store.get<LlmConfig>(LLM_CONFIG_KEY)) ?? null
  if (!cfg) return null

  // 规范化 keys / models：值必须是 string，缺失/空字符串剔除
  const keys: Partial<Record<LlmConfig["provider"], string>> = {}
  if (cfg.keys && typeof cfg.keys === "object") {
    for (const [k, v] of Object.entries(cfg.keys)) {
      if (typeof v === "string" && v.length > 0) keys[k as LlmConfig["provider"]] = v
    }
  } else if (cfg.provider && cfg.apiKey) {
    // 旧结构首次迁移
    keys[cfg.provider] = cfg.apiKey
  }
  const models: Partial<Record<LlmConfig["provider"], string>> = {}
  if (cfg.models && typeof cfg.models === "object") {
    for (const [k, v] of Object.entries(cfg.models)) {
      if (typeof v === "string" && v.length > 0) models[k as LlmConfig["provider"]] = v
    }
  } else if (cfg.provider && cfg.model) {
    models[cfg.provider] = cfg.model
  }

  const keyHistory = normalizeKeyHistory(cfg.keyHistory, keys)

  const migrated: LlmConfig = { ...cfg, keys, models, keyHistory }
  // 任何形状与迁移结果不一致时，落盘修正一次（避免每次启动都迁移）
  const needsRewrite =
    cfg.keyHistory !== keyHistory ||
    cfg.keys !== keys ||
    cfg.models !== models
  if (needsRewrite) {
    try {
      await store.set(LLM_CONFIG_KEY, migrated)
    } catch {
      // 静默失败：纠错只影响下次启动
    }
  }
  return migrated
}

const SEARCH_API_KEY = "searchApiConfig"

export async function saveSearchApiConfig(config: SearchApiConfig): Promise<void> {
  const store = await getStore()
  await store.set(SEARCH_API_KEY, config)
}

export async function loadSearchApiConfig(): Promise<SearchApiConfig | null> {
  const store = await getStore()
  return (await store.get<SearchApiConfig>(SEARCH_API_KEY)) ?? null
}

const EMBEDDING_KEY = "embeddingConfig"

export async function saveEmbeddingConfig(config: EmbeddingConfig): Promise<void> {
  const store = await getStore()
  await store.set(EMBEDDING_KEY, config)
}

export async function loadEmbeddingConfig(): Promise<EmbeddingConfig | null> {
  const store = await getStore()
  return (await store.get<EmbeddingConfig>(EMBEDDING_KEY)) ?? null
}

const PG_CONFIG_KEY = "pgConfig"

export async function savePgConfig(config: PgConfig): Promise<void> {
  const store = await getStore()
  await store.set(PG_CONFIG_KEY, config)
}

export async function loadPgConfig(): Promise<PgConfig | null> {
  const store = await getStore()
  return (await store.get<PgConfig>(PG_CONFIG_KEY)) ?? null
}

export async function removeFromRecentProjects(
  path: string
): Promise<void> {
  const store = await getStore()
  const existing = (await store.get<WikiProject[]>(RECENT_PROJECTS_KEY)) ?? []
  const updated = existing.filter((p) => p.path !== path)
  await store.set(RECENT_PROJECTS_KEY, updated)
}

const IMA_SYNC_KEY = "imaSyncConfig"

export async function saveImaSyncConfig(config: ImaSyncConfig): Promise<void> {
  const store = await getStore()
  await store.set(IMA_SYNC_KEY, config)
}

export async function loadImaSyncConfig(): Promise<ImaSyncConfig | null> {
  const store = await getStore()
  return (await store.get<ImaSyncConfig>(IMA_SYNC_KEY)) ?? null
}

const LANGUAGE_KEY = "language"

export async function saveLanguage(lang: string): Promise<void> {
  const store = await getStore()
  await store.set(LANGUAGE_KEY, lang)
}

export async function loadLanguage(): Promise<string | null> {
  const store = await getStore()
  return (await store.get<string>(LANGUAGE_KEY)) ?? null
}

const APP_THEME_KEY = "appTheme"

export async function saveAppTheme(theme: AppTheme): Promise<void> {
  const store = await getStore()
  await store.set(APP_THEME_KEY, theme)
}

export async function loadAppTheme(): Promise<AppTheme | null> {
  const store = await getStore()
  return (await store.get<AppTheme>(APP_THEME_KEY)) ?? null
}
