import { invoke } from "@tauri-apps/api/core"
import type { PgConfig } from "@/stores/wiki-store"

export interface SyncResult {
  count: number
  synced_at: string
  skipped: boolean
}

export interface FetchResult {
  count: number
  inserted: number
  updated: number
  fetched_at: string
}

interface RustPgConfig {
  host: string | null
  port: number | null
  user: string | null
  password: string | null
  database: string | null
  table_name?: string
  col_ticker?: string
  col_stock_name?: string
  has_date_column?: boolean
  mairui_api_licence?: string
}

function toRustPgConfig(cfg: PgConfig): RustPgConfig {
  return {
    host: cfg.host || null,
    port: cfg.port,
    user: cfg.user || null,
    password: cfg.password || null,
    database: cfg.database || null,
    table_name: cfg.table_name || undefined,
    col_ticker: cfg.col_ticker || undefined,
    col_stock_name: cfg.col_stock_name || undefined,
    has_date_column: cfg.has_date_column ?? true,
    mairui_api_licence: cfg.mairui_api_licence || undefined,
  }
}

export async function syncStockCodes(
  projectPath: string,
  pgConfig: PgConfig,
  force: boolean = false,
): Promise<SyncResult> {
  return invoke<SyncResult>("sync_stock_codes", {
    projectPath,
    pgConfig: toRustPgConfig(pgConfig),
    force,
  })
}

export async function lookupStockCode(
  projectPath: string,
  name: string,
): Promise<string | null> {
  return invoke<string | null>("lookup_stock_code", { projectPath, name })
}

export async function getStockCodesStatus(
  projectPath: string,
): Promise<SyncResult | null> {
  return invoke<SyncResult | null>("get_stock_codes_status", { projectPath })
}

export async function updateStockCodes(
  projectPath: string,
  pgConfig: PgConfig,
): Promise<FetchResult> {
  return invoke<FetchResult>("update_stock_codes", {
    projectPath,
    pgConfig: toRustPgConfig(pgConfig),
  })
}

export async function getStockSyncStatus(
  projectPath: string,
): Promise<FetchResult | null> {
  return invoke<FetchResult | null>("get_stock_sync_status", { projectPath })
}
