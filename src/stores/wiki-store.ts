import { create } from "zustand"
import type { WikiProject, FileNode } from "@/types/wiki"
import type { AppTheme } from "@/types/theme"

interface LlmConfig {
  provider: "openai" | "anthropic" | "google" | "ollama" | "custom" | "minimax" | "kimi" | "deepseek" | "codex"
  apiKey: string
  model: string
  ollamaUrl: string
  customEndpoint: string
  maxContextSize: number // max context window in characters
  reasoningEffort?: "minimal" | "low" | "medium" | "high" // codex 专用
  // 每提供商独立保存的密钥 / 模型（源数据），provider/apiKey/model 为当前激活镜像
  keys?: Partial<Record<LlmConfig["provider"], string>>
  models?: Partial<Record<LlmConfig["provider"], string>>
  // 每提供商历史上填过的密钥（去重），用于输入框聚焦时的下拉选择
  keyHistory?: Partial<Record<LlmConfig["provider"], string[]>>
  // 已保存的「自定义提供商」：用户在 custom 模式下填好 endpoint/key/model 后，作为新的可删除按钮
  // 追加到提供商选择区；点击即应用该配置（底层 provider 仍为 "custom"，用 id 区分）
  customProviders?: CustomProviderConfig[]
  // 当前选中的自定义提供商 id（底层 provider 为 "custom" 时用它区分具体选中项）；
  // 持久化后刷新可正确恢复高亮，而非回落到「自定义」基础按钮
  activeCustomId?: string | null
}

interface CustomProviderConfig {
  id: string
  name: string // 显示在提供商选择区按钮上的名称
  endpoint: string // 自定义 base URL
  apiKey: string // 留空时回填 keysMap["custom"]
  model: string
  reasoningEffort?: "minimal" | "low" | "medium" | "high" // codex 类自定义用
}

interface SearchApiConfig {
  provider: "tavily" | "none"
  apiKey: string
}

interface EmbeddingConfig {
  enabled: boolean
  endpoint: string // e.g. "http://127.0.0.1:1234/v1/embeddings"
  apiKey: string
  model: string // e.g. "text-embedding-qwen3-embedding-0.6b"
}

interface PgConfig {
  host: string
  port: number | null
  user: string
  password: string
  database: string
  table_name?: string
  col_ticker?: string
  col_stock_name?: string
  has_date_column?: boolean
  mairui_api_licence?: string
}

interface ImaSyncConfig {
  enabled: boolean
  harPath: string
  outDir: string
  folder: string
  kbId: string
}

/** 侧栏/设置页共享的 IMA 一致性状态 */
type ImaConsistency =
  | "unknown" // 尚未检查
  | "need_config" // 未配置（无凭证/无目录/无目标文件夹）
  | "checking" // 检查中
  | "up_to_date" // 本地与知识库一致
  | "pending" // 有更新待同步
  | "auth_error" // 凭证失效
  | "error" // 其他错误

interface ImaSyncStatus {
  running: boolean
  phase: string
  current: number
  total: number
  lastMessage: string
  lastResult: {
    ok: boolean
    downloaded: number
    skipped: number
    failed: number
    folder: string
    at: string
  } | null
  error: string | null
  /** 本地与 IMA 知识库一致性（启动/保存配置时自动检查） */
  consistency: ImaConsistency
  /** 一致性检查详情（hover 用） */
  consistencyDetail: string | null
  localCount: number
  remoteCount: number
  missingCount: number
}

interface WikiState {
  project: WikiProject | null
  fileTree: FileNode[]
  selectedFile: string | null
  fileContent: string
  chatExpanded: boolean
  activeView: "wiki" | "sources" | "search" | "graph" | "lint" | "review" | "dashboard" | "research-cockpit" | "training-flywheel" | "plan" | "settings" | "daily-loop" | "company-research" | "self-question" | "research-console" | "data-engineering" | "hypothesis-evolution"
  llmConfig: LlmConfig
  searchApiConfig: SearchApiConfig
  embeddingConfig: EmbeddingConfig
  pgConfig: PgConfig
  imaSyncConfig: ImaSyncConfig
  imaSyncStatus: ImaSyncStatus
  /** 打开设置页后滚动到的锚点 section id（用后清空） */
  settingsFocusSection: string | null
  dataVersion: number
  appTheme: AppTheme

  setProject: (project: WikiProject | null) => void
  setFileTree: (tree: FileNode[]) => void
  setSelectedFile: (path: string | null) => void
  setFileContent: (content: string) => void
  setChatExpanded: (expanded: boolean) => void
  setActiveView: (view: WikiState["activeView"]) => void
  setLlmConfig: (config: LlmConfig) => void
  setSearchApiConfig: (config: SearchApiConfig) => void
  setEmbeddingConfig: (config: EmbeddingConfig) => void
  setPgConfig: (config: PgConfig) => void
  setImaSyncConfig: (config: ImaSyncConfig) => void
  setImaSyncStatus: (status: ImaSyncStatus | ((prev: ImaSyncStatus) => ImaSyncStatus)) => void
  setSettingsFocusSection: (section: string | null) => void
  /** 打开设置并定位到指定区块（如 settings-ima-sync） */
  openSettingsSection: (sectionId: string) => void
  bumpDataVersion: () => void
  setAppTheme: (theme: AppTheme) => void
}

export const useWikiStore = create<WikiState>((set) => ({
  project: null,
  fileTree: [],
  selectedFile: null,
  fileContent: "",
  chatExpanded: false,
  activeView: "wiki",
  llmConfig: {
    provider: "openai",
    apiKey: "",
    maxContextSize: 204800,
    model: "",
    ollamaUrl: "http://localhost:11434",
    customEndpoint: "",
    keys: {},
    models: {},
    keyHistory: {},
    customProviders: [],
  },

  dataVersion: 0,
  appTheme: "default",

  setProject: (project) => set({ project }),
  setFileTree: (fileTree) => set({ fileTree }),
  setSelectedFile: (selectedFile) => set({ selectedFile }),
  setFileContent: (fileContent) => set({ fileContent }),
  setChatExpanded: (chatExpanded) => set({ chatExpanded }),
  setActiveView: (activeView) => set({ activeView }),
  searchApiConfig: {
    provider: "none",
    apiKey: "",
  },

  embeddingConfig: {
    enabled: false,
    endpoint: "",
    apiKey: "",
    model: "",
  },

  pgConfig: {
    host: "",
    port: null,
    user: "",
    password: "",
    database: "",
    table_name: "cn_stock_name_wind",
    col_ticker: "ticker",
    col_stock_name: "stock_name",
    has_date_column: true,
    mairui_api_licence: "02CE8105-94EB-43FD-A56D-5C5069D5DD07",
  },

  imaSyncConfig: {
    enabled: false,
    harPath: "",
    outDir: "",
    folder: "",
    kbId: "",
  },

  imaSyncStatus: {
    running: false,
    phase: "",
    current: 0,
    total: 0,
    lastMessage: "",
    lastResult: null,
    error: null,
    consistency: "unknown",
    consistencyDetail: null,
    localCount: 0,
    remoteCount: 0,
    missingCount: 0,
  },
  settingsFocusSection: null,

  setLlmConfig: (llmConfig) => set({ llmConfig }),
  setSearchApiConfig: (searchApiConfig) => set({ searchApiConfig }),
  setEmbeddingConfig: (embeddingConfig) => set({ embeddingConfig }),
  setPgConfig: (pgConfig) => set({ pgConfig }),
  setImaSyncConfig: (imaSyncConfig) => set({ imaSyncConfig }),
  setSettingsFocusSection: (settingsFocusSection) => set({ settingsFocusSection }),
  openSettingsSection: (sectionId) =>
    set({ activeView: "settings", settingsFocusSection: sectionId }),
  setImaSyncStatus: (imaSyncStatus) =>
    set((state) => ({
      imaSyncStatus:
        typeof imaSyncStatus === "function" ? imaSyncStatus(state.imaSyncStatus) : imaSyncStatus,
    })),
  bumpDataVersion: () => set((state) => ({ dataVersion: state.dataVersion + 1 })),
  setAppTheme: (appTheme) => {
    if (appTheme === "light") {
      document.documentElement.classList.remove("dark")
    } else {
      document.documentElement.classList.add("dark")
    }
    set({ appTheme })
  },
}))

export type {
  WikiState,
  LlmConfig,
  CustomProviderConfig,
  SearchApiConfig,
  EmbeddingConfig,
  PgConfig,
  ImaSyncConfig,
  ImaSyncStatus,
  ImaConsistency,
}
