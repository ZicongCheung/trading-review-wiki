use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::PathBuf;
use std::sync::{LazyLock, Mutex, OnceLock};

use chrono::{Local, TimeZone};
use serde::{Deserialize, Serialize};
use tokio_postgres::NoTls;

use regex::Regex;

use crate::settings::PgConfig;

fn sanitize_identifier(raw: &str) -> Result<String, String> {
    static RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[A-Za-z_][A-Za-z0-9_.]*$").unwrap());

    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("标识符不能为空".to_string());
    }
    if !RE.is_match(trimmed) {
        return Err(format!("非法标识符: {}", trimmed));
    }
    Ok(trimmed.to_string())
}

fn quote_ident(ident: &str) -> String {
    let escaped = ident.replace('"', "\"\"");
    format!("\"{}\"", escaped)
}

fn split_schema_table(full: &str) -> (Option<String>, String) {
    if let Some((schema, table)) = full.split_once('.') {
        let schema = schema.trim();
        if schema.is_empty() {
            (None, table.trim().to_string())
        } else {
            (Some(schema.to_string()), table.trim().to_string())
        }
    } else {
        (None, full.trim().to_string())
    }
}

fn quote_maybe_schema(full: &str) -> Result<String, String> {
    let sanitized = sanitize_identifier(full)?;
    let (schema, table) = split_schema_table(&sanitized);
    match schema {
        Some(schema) => Ok(format!(
            "{}.{}",
            quote_ident(&schema),
            quote_ident(&table)
        )),
        None => Ok(quote_ident(&table)),
    }
}

fn build_stock_sql(pg_config: &PgConfig) -> Result<String, String> {
    let table = pg_config
        .table_name
        .as_deref()
        .unwrap_or("cn_stock_name_wind");
    let col_ticker = pg_config.col_ticker.as_deref().unwrap_or("ticker");
    let col_stock_name = pg_config.col_stock_name.as_deref().unwrap_or("stock_name");

    let quoted_table = quote_maybe_schema(table)?;
    let quoted_ticker = quote_ident(&sanitize_identifier(col_ticker)?);
    let quoted_name = quote_ident(&sanitize_identifier(col_stock_name)?);

    let has_date = pg_config.has_date_column.unwrap_or(true);
    // 同名时优先保留 A 股代码（ticker 不含 '.'），避免港股/ADR 代码（如 00700.HK）
    // 覆盖 A 股代码（如 000166）。CASE 让无后缀 ticker 排在前面，DISTINCT ON 保留首条。
    if has_date {
        Ok(format!(
            "SELECT DISTINCT ON ({n}) {t}, {n} FROM {tbl} ORDER BY {n}, CASE WHEN {t} LIKE '%.%' THEN 1 ELSE 0 END, date DESC",
            t = quoted_ticker,
            n = quoted_name,
            tbl = quoted_table,
        ))
    } else {
        Ok(format!(
            "SELECT DISTINCT ON ({n}) {t}, {n} FROM {tbl} ORDER BY {n}, CASE WHEN {t} LIKE '%.%' THEN 1 ELSE 0 END",
            t = quoted_ticker,
            n = quoted_name,
            tbl = quoted_table,
        ))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StockCodeFile {
    pub synced_at: String,
    pub count: usize,
    pub mapping: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SyncResult {
    pub count: usize,
    pub synced_at: String,
    pub skipped: bool,
}

fn cache() -> &'static Mutex<HashMap<String, StockCodeFile>> {
    static CACHE: OnceLock<Mutex<HashMap<String, StockCodeFile>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn stock_codes_path(project_path: &str) -> PathBuf {
    PathBuf::from(project_path)
        .join(".llm-wiki")
        .join("stock-codes.json")
}

fn now_local_timestamp() -> String {
    Local::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

fn parse_synced_at(s: &str) -> Option<chrono::DateTime<chrono::Local>> {
    let naive = chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S").ok()?;
    Local.from_local_datetime(&naive).single()
}

fn load_from_disk(project_path: &str) -> Option<StockCodeFile> {
    let content = fs::read_to_string(stock_codes_path(project_path)).ok()?;
    serde_json::from_str(&content).ok()
}

#[tauri::command]
pub async fn sync_stock_codes(
    project_path: String,
    pg_config: PgConfig,
    force: bool,
) -> Result<SyncResult, String> {
    if !force {
        if let Some(existing) = load_from_disk(&project_path) {
            if let Some(ts) = parse_synced_at(&existing.synced_at) {
                let age_hours = Local::now().signed_duration_since(ts).num_hours();
                if age_hours < 24 {
                    if let Ok(mut guard) = cache().lock() {
                        guard.insert(project_path.clone(), existing.clone());
                    }
                    return Ok(SyncResult {
                        count: existing.count,
                        synced_at: existing.synced_at,
                        skipped: true,
                    });
                }
            }
        }
    }

    let conn_str = pg_config
        .connection_string()
        .ok_or_else(|| "INVALID_PATH PG 配置未填写".to_string())?;

    let (client, connection) = tokio_postgres::connect(&conn_str, NoTls)
        .await
        .map_err(|e| format!("TIMEOUT PG 连接失败: {}", e))?;
    tauri::async_runtime::spawn(async move {
        if let Err(e) = connection.await {
            eprintln!("[stock_codes] PG connection terminated: {}", e);
        }
    });

    let sql = build_stock_sql(&pg_config)?;

    #[cfg(debug_assertions)]
    eprintln!(
        "[stock_codes] pg_config: table_name={:?} col_ticker={:?} col_stock_name={:?} has_date_column={:?}",
        pg_config.table_name,
        pg_config.col_ticker,
        pg_config.col_stock_name,
        pg_config.has_date_column,
    );

    #[cfg(debug_assertions)]
    eprintln!("[stock_codes] executing SQL: {}", sql);

    let rows = client
        .query(&sql, &[])
        .await
        .map_err(|e| format!("UNKNOWN PG 查询失败: {} | SQL={}", e, sql))?;

    let mut mapping: BTreeMap<String, String> = BTreeMap::new();
    for row in rows {
        let ticker: String = row.get(0);
        let name: String = row.get(1);
        if !ticker.is_empty() && !name.is_empty() {
            // 对名称做归一化（全角 A/B/H、多余空格等），使 mapping 键与 LLM 输入形态一致
            let norm_name = normalize_stock_name(&name);
            if norm_name.is_empty() {
                continue;
            }
            // 同名冲突时优先保留 A 股代码（不含 '.'），港股/ADR 代码（如 00700.HK）不覆盖 A 股
            match mapping.get(&norm_name) {
                Some(existing) if existing.contains('.') && !ticker.contains('.') => {
                    mapping.insert(norm_name, ticker);
                }
                None => {
                    mapping.insert(norm_name, ticker);
                }
                _ => {}
            }
        }
    }

    let synced_at = now_local_timestamp();
    let file = StockCodeFile {
        synced_at: synced_at.clone(),
        count: mapping.len(),
        mapping,
    };

    let path = stock_codes_path(&project_path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("WRITE_FAILED 创建目录失败: {}", e))?;
    }
    let json = serde_json::to_string_pretty(&file)
        .map_err(|e| format!("UNKNOWN 序列化失败: {}", e))?;
    fs::write(&path, json)
        .map_err(|e| format!("WRITE_FAILED 写入 stock-codes.json 失败: {}", e))?;

    if let Ok(mut guard) = cache().lock() {
        guard.insert(project_path.clone(), file.clone());
    }

    Ok(SyncResult {
        count: file.count,
        synced_at,
        skipped: false,
    })
}

fn normalize_stock_name(name: &str) -> String {
    name.trim()
        .replace('\u{3000}', " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .replace("（", "(")
        .replace("）", ")")
        .replace("Ａ", "A")
        .replace("Ｂ", "B")
        .replace("Ｈ", "H")
}

fn strip_parentheses(name: &str) -> String {
    // 去掉括号及其内部内容（如 "长川科技(300604)" → "长川科技"）
    let mut result = String::new();
    let mut depth = 0i32;
    for c in name.chars() {
        if c == '(' || c == '（' {
            depth += 1;
        } else if c == ')' || c == '）' {
            depth -= 1;
        } else if depth <= 0 {
            result.push(c);
        }
    }
    result.trim().to_string()
}

fn remove_ab_suffix(name: &str) -> String {
    // 去掉末尾的 A 股 / B 股 / H 股 等后缀（"万科A" → "万科"）
    name.trim_end_matches(['A', 'B', 'H', 'a', 'b', 'h']).trim().to_string()
}

fn try_match(mapping: &BTreeMap<String, String>, name: &str) -> Option<String> {
    let raw = normalize_stock_name(name);
    if raw.is_empty() {
        return None;
    }

    // 准备多种归一化形态用于逐步降级匹配
    let stripped = strip_parentheses(&raw);
    let no_ab = remove_ab_suffix(&raw);
    let stripped_no_ab = remove_ab_suffix(&stripped);
    let variants = [&raw, &stripped, &no_ab, &stripped_no_ab]
        .into_iter()
        .map(|s| s.to_string())
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();

    for name in variants.iter() {
        if name.is_empty() {
            continue;
        }

        // 1. 精确匹配
        if let Some(v) = mapping.get(name) {
            return Some(v.clone());
        }

        // 2. 大小写不敏感（用于英文 ticker / 港股）
        let name_lower = name.to_lowercase();
        for (k, v) in mapping.iter() {
            if k.to_lowercase() == name_lower {
                return Some(v.clone());
            }
        }

        // 3. 科创板未盈利新股常带 -U/-W/-N 后缀（wind 命名约定）
        for suffix in ["-U", "-W", "-N"] {
            let key = format!("{}{}", name, suffix);
            if let Some(v) = mapping.get(&key) {
                return Some(v.clone());
            }
        }

        // 4. 常见公司后缀：DB 里可能是全称，LLM 输出简称；或反之
        let corp_suffixes = [
            "股份有限公司",
            "有限公司",
            "股份公司",
            "集团股份有限公司",
            "集团有限公司",
            "集团",
            "科技",
            "技术",
            "控股",
            "投资",
            "实业",
            "股份",
        ];
        for suffix in corp_suffixes {
            // 4a. 去掉后缀匹配
            if name.ends_with(suffix) {
                let base = name[..name.len() - suffix.len()].trim_end().to_string();
                if !base.is_empty() {
                    if let Some(v) = mapping.get(&base) {
                        return Some(v.clone());
                    }
                }
            }
            // 4b. 加上后缀匹配
            let key = format!("{}{}", name, suffix);
            if let Some(v) = mapping.get(&key) {
                return Some(v.clone());
            }
        }

        // 5. ST / *ST 前缀：LLM 可能输出 *STxx，DB 里常是 xx 股份/集团，尝试去掉前缀匹配
        for prefix in ["*ST", "ST"] {
            if let Some(stripped) = name.strip_prefix(prefix) {
                let base = stripped.trim();
                if !base.is_empty() {
                    if let Some(v) = mapping.get(base) {
                        return Some(v.clone());
                    }
                    // 去掉 ST 后再尝试加常见公司后缀（如 *ST金科 -> 金科股份）
                    for suffix in ["股份", "集团", "有限公司", "科技股份有限公司"] {
                        let key = format!("{}{}", base, suffix);
                        if let Some(v) = mapping.get(&key) {
                            return Some(v.clone());
                        }
                    }
                }
            }
            // 反向：输入无 ST，DB 里有 ST 前缀
            let key = format!("{}{}", prefix, name);
            if let Some(v) = mapping.get(&key) {
                return Some(v.clone());
            }
        }
    }

    // 6. 子串包含兜底：选择长度最接近输入的候选，降低误配概率
    let candidates: Vec<_> = mapping
        .iter()
        .filter(|(k, _)| {
            let kl = k.to_lowercase();
            let nl = raw.to_lowercase();
            kl.contains(&nl) || nl.contains(&kl)
        })
        .collect();
    if !candidates.is_empty() {
        // 优先：输入完全包含于候选名中且候选长度最短（更精确）
        let nl = raw.to_lowercase();
        if let Some(best) = candidates
            .iter()
            .filter(|(k, _)| k.to_lowercase().contains(&nl))
            .min_by_key(|(k, _)| k.chars().count())
        {
            return Some(best.1.clone());
        }
        // 否则候选名包含于输入中，选最长候选
        if let Some(best) = candidates
            .iter()
            .filter(|(k, _)| nl.contains(k.to_lowercase().as_str()))
            .max_by_key(|(k, _)| k.chars().count())
        {
            return Some(best.1.clone());
        }
    }

    None
}

#[tauri::command]
pub fn lookup_stock_code(
    project_path: String,
    name: String,
) -> Result<Option<String>, String> {
    let path = stock_codes_path(&project_path);
    let exists = path.exists();
    eprintln!(
        "[lookup_stock_code] project_path={} name={} file={} exists={}",
        project_path,
        name,
        path.display(),
        exists
    );

    // 绕过静态缓存，每次从磁盘重新加载，避免 sync 后缓存不刷新或路径键不一致导致 miss
    let file = match load_from_disk(&project_path) {
        Some(f) => f,
        None => {
            eprintln!("[lookup_stock_code] load_from_disk returned None");
            return Ok(None);
        }
    };
    eprintln!("[lookup_stock_code] loaded count={}", file.count);

    let result = try_match(&file.mapping, &name);
    eprintln!("[lookup_stock_code] result for '{}': {:?}", name, result);
    Ok(result)
}

#[tauri::command]
pub fn get_stock_codes_status(project_path: String) -> Result<Option<SyncResult>, String> {
    Ok(load_from_disk(&project_path).map(|f| SyncResult {
        count: f.count,
        synced_at: f.synced_at,
        skipped: true,
    }))
}

// ── 股票代码库更新（点"更新库中股票数据"时：沪深用麦蕊 + 北交所用北交所官方源，合并后 upsert 到用户配置的 PG 表） ──

#[derive(Debug, Clone, Deserialize)]
struct StockSourceItem {
    dm: String,
    mc: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StockSyncFile {
    fetched_at: String,
    count: usize,
    inserted: usize,
    updated: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct FetchResult {
    pub count: usize,
    pub inserted: usize,
    pub updated: usize,
    pub fetched_at: String,
}

fn stock_sync_path(project_path: &str) -> PathBuf {
    PathBuf::from(project_path)
        .join(".llm-wiki")
        .join("stock-sync.json")
}

fn load_stock_sync_from_disk(project_path: &str) -> Option<StockSyncFile> {
    let content = fs::read_to_string(stock_sync_path(project_path)).ok()?;
    serde_json::from_str(&content).ok()
}

const MAIRUI_BASE: &str = "https://api.mairuiapi.com";
const MAIRUI_USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
// 麦蕊 licence 默认兜底值（用户也可在 Settings → PostgreSQL 股票代码源 中自行填写覆盖）。
// hslt/list 覆盖沪深A股（含 ST，不含北交所），接口免 token，licence 有效即放行。
const DEFAULT_MAIRUI_LICENCE: &str = "02CE8105-94EB-43FD-A56D-5C5069D5DD07";

// ── 北交所（BSE）官方补全源 ──
// 北交所官方接口（北京证券交易所官网，akshare stock_info_bj_name_code 同款）：
// POST https://www.bse.cn/nqxxController/nqxxCnzq.do
// 响应为 JSONP 数组（null([{...}])），首元素含 totalPages 与 content；
// content 中每行为【键控对象】，证券代码=xxzqdm、证券简称=xxzqjc（均为 92 开头北交所）。
// 麦蕊 hslt/list 不含北交所，故用此补足。
//
// 重要：该站点有 WAF（nginx cookie 挑战）。直接请求 .do 会返回 302 重定向循环并被拦截，
// 必须先 GET 一次行情页拿 Set-Cookie 里的 C3VK，再在后续请求带上该 Cookie 才能正常返回数据。
const BSE_LIST_URL: &str = "https://www.bse.cn/nqxxController/nqxxCnzq.do";
const BSE_QUOTE_PAGE_URL: &str = "https://www.bse.cn/nq/quotation.html";
const BSE_USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36";
// 北交所行内 证券代码 / 证券简称 的列位置（与 akshare 对齐）
const BSE_IDX_CODE: usize = 38;
const BSE_IDX_NAME: usize = 40;


/// 直连麦蕊 hslt/list 接口，获取全市场沪深 A 股代码+名称。
/// 返回 StockSourceItem{dm=代码(带交易所后缀如 000001.SZ), mc=名称}。
/// 作为"更新库中股票数据"的数据源（替代易被封 IP 的东方财富 push2）。
async fn fetch_stocks_from_mairui(licence: &str) -> Result<Vec<StockSourceItem>, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .user_agent(MAIRUI_USER_AGENT)
        .build()
        .map_err(|e| format!("MR_CLIENT_FAILED 构建 HTTP 客户端失败: {}", e))?;

    let url = format!("{}/hslt/list/{}", MAIRUI_BASE, licence);
    let resp = client
        .get(&url)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("MR_REQUEST_FAILED 请求麦蕊失败: {} | URL={}", e, url))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!(
            "MR_HTTP_{} 麦蕊返回非成功状态码 {} | 响应: {}",
            status.as_u16(),
            status,
            body.chars().take(300).collect::<String>()
        ));
    }

    let items: Vec<StockSourceItem> = resp
        .json()
        .await
        .map_err(|e| format!("MR_PARSE_FAILED 解析麦蕊响应失败: {}", e))?;

    if items.is_empty() {
        return Err("MR_EMPTY 麦蕊未返回任何股票数据（可能 licence 无效或已过期）".to_string());
    }
    Ok(items)
}

/// 把 serde_json::Value 规整成字符串（字符串/数字均可）。
fn value_to_string(v: &serde_json::Value) -> String {
    match v {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Number(n) => n.to_string(),
        _ => String::new(),
    }
}

/// 在对象里按候选 key 顺序取第一个非空值。
fn pick_first(obj: &serde_json::Map<String, serde_json::Value>, keys: &[&str]) -> Option<String> {
    for k in keys {
        if let Some(v) = obj.get(*k) {
            let s = value_to_string(v);
            if !s.is_empty() {
                return Some(s);
            }
        }
    }
    None
}

/// 判断是否为 6 位纯数字代码（A股/北交所代码均为 6 位）。
fn is_six_digit(s: &str) -> bool {
    s.len() == 6 && s.chars().all(|c| c.is_ascii_digit())
}

/// 解析北交所官方响应：响应外层是 JSON 数组，首个元素为含 totalPages/content 的对象。
/// 兼容 `)]}[...]` 这类 JSONP 前缀或尾部换行，取第一个 `[` 到最后一个 `]` 之间的内容。
fn parse_bse_root(text: &str) -> Result<serde_json::Value, String> {
    let trimmed = text.trim();
    let start = trimmed
        .find('[')
        .ok_or_else(|| "BSE_PARSE_FAILED 响应中未找到数组".to_string())?;
    let end = trimmed
        .rfind(']')
        .ok_or_else(|| "BSE_PARSE_FAILED 响应中未找到数组结束".to_string())?;
    let arr: serde_json::Value = serde_json::from_str(&trimmed[start..=end])
        .map_err(|e| format!("BSE_PARSE_FAILED 解析北交所响应失败: {}", e))?;
    arr.get(0)
        .cloned()
        .ok_or_else(|| "BSE_PARSE_FAILED 响应数组为空".to_string())
}

/// 从北交所响应的一行中提取 代码+名称。
/// 北交所官方接口（nqxxCnzq.do）实际返回的是【键控对象】（xxzqdm=代码、xxzqjc=名称），
/// 这里同时兼容位置数组形态（Code@38、Name@40）以适配可能的其它接口变体。
fn extract_bse_item(row: &serde_json::Value) -> Option<StockSourceItem> {
    if let Some(arr) = row.as_array() {
        let code = arr
            .get(BSE_IDX_CODE)
            .map(value_to_string)
            .filter(|s| !s.is_empty())?;
        let name = arr
            .get(BSE_IDX_NAME)
            .map(value_to_string)
            .filter(|s| !s.is_empty())?;
        if is_six_digit(&code) {
            return Some(StockSourceItem { dm: code, mc: name });
        }
        None
    } else if let Some(obj) = row.as_object() {
        let code = pick_first(
            obj,
            &["证券代码", "xxzqdm", "dm", "symbol", "code", "stock_code"],
        )?;
        // 北交所官方接口实际返回的字典键为 xxzqdm(代码) / xxzqjc(名称)，
        // xxzqmc 不存在于该接口响应，必须保留 xxzqjc 才能正确解析。
        let name = pick_first(
            obj,
            &["证券简称", "xxzqjc", "xxzqmc", "mc", "name", "stock_name", "jc"],
        )?;
        if is_six_digit(&code) {
            return Some(StockSourceItem { dm: code, mc: name });
        }
        None
    } else {
        None
    }
}

/// 拉取北交所官方接口的单页（分页从 0 开始）。
/// `cookie` 为从 WAF 挑战拿到的 C3VK cookie，缺失时会触发 302 拦截。
async fn fetch_bse_page(
    client: &reqwest::Client,
    page: usize,
    cookie: Option<&str>,
) -> Result<(usize, Vec<StockSourceItem>), String> {
    let form = [
        ("page", page.to_string()),
        ("typejb", "T".to_string()),
        ("xxfcbj[]", "2".to_string()),
        ("xxzqdm", "".to_string()),
        ("sortfield", "xxzqdm".to_string()),
        ("sorttype", "asc".to_string()),
    ];
    let mut req = client
        .post(BSE_LIST_URL)
        .form(&form)
        .header("Referer", BSE_QUOTE_PAGE_URL);
    if let Some(c) = cookie {
        req = req.header("Cookie", c);
    }
    let resp = req
        .send()
        .await
        .map_err(|e| {
            format!(
                "BSE_REQUEST_FAILED 请求北交所官方失败(page={}): {} | URL={}",
                page, e, BSE_LIST_URL
            )
        })?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!(
            "BSE_HTTP_{} 北交所官方返回非成功状态码 {} | 响应: {}",
            status.as_u16(),
            status,
            body.chars().take(300).collect::<String>()
        ));
    }
    let text = resp
        .text()
        .await
        .map_err(|e| format!("BSE_READ_FAILED 读取北交所响应失败: {}", e))?;
    let root = parse_bse_root(&text)?;
    let total_pages: usize = root
        .get("totalPages")
        .and_then(|v| v.as_u64())
        .map(|v| v as usize)
        .unwrap_or(page + 1);
    let mut items = Vec::new();
    if let Some(content) = root.get("content").and_then(|v| v.as_array()) {
        for row in content {
            if let Some(item) = extract_bse_item(row) {
                items.push(item);
            }
        }
    }
    Ok((total_pages, items))
}

/// 获取北交所官网 WAF 挑战 cookie（C3VK）。
/// 官网对 .do 接口做了 cookie 挑战：先 GET 行情页会收到 302 + Set-Cookie: C3VK=xxx，
/// 必须把这个 cookie 带回后续请求，否则 .do 会陷入 302 重定向循环被拦截。
/// 失败（网络不可达等）时返回 None，调用方退化为无 cookie 请求（大概率被 WAF 拦）。
async fn acquire_bse_cookie() -> Option<String> {
    // 该 GET 会收到 302 + Set-Cookie: C3VK=xxx 的 WAF 挑战，
    // 必须禁止自动跟随重定向（ClientBuilder::redirect，无需 cookies feature）
    // 才能读到 Set-Cookie 头。
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .user_agent(BSE_USER_AGENT)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .ok()?;
    let resp = client
        .get(BSE_QUOTE_PAGE_URL)
        .header("Accept-Language", "zh-CN,zh;q=0.9")
        .send()
        .await
        .ok()?;
    let set_cookie = resp.headers().get(reqwest::header::SET_COOKIE)?.to_str().ok()?;
    // 形如 "C3VK=1dea41; Max-Age=300; Path=/"，取 C3VK= 这段
    set_cookie
        .split(';')
        .map(|p| p.trim())
        .find(|p| p.starts_with("C3VK="))
        .map(|p| p.to_string())
}

/// 直连北交所官方接口，分页获取全量北交所股票代码+名称（返回 92 开头纯北交所代码）。
/// 参考 akshare stock_info_bj_name_code：POST nqxxController/nqxxCnzq.do。
/// 接口返回字典（xxzqdm/xxzqjc），仅覆盖 92 开头段。
/// 必须先过 WAF cookie 挑战（acquire_bse_cookie），否则 302 被拦。
async fn fetch_bse_official() -> Result<Vec<StockSourceItem>, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .user_agent(BSE_USER_AGENT)
        .build()
        .map_err(|e| format!("BSE_CLIENT_FAILED 构建 HTTP 客户端失败: {}", e))?;

    // 1) 抓 WAF cookie，拉首页；若首页因 cookie 失效失败，重试一次
    let cookie = acquire_bse_cookie().await;
    let (total_pages, first_items) = match fetch_bse_page(&client, 0, cookie.as_deref()).await {
        Ok(v) => v,
        Err(e) => {
            eprintln!("[update_stock_codes] 北交所官方首页失败，重试 cookie: {}", e);
            let cookie2 = acquire_bse_cookie().await;
            fetch_bse_page(&client, 0, cookie2.as_deref())
                .await
                .map_err(|_| format!("BSE_OFFICIAL_FAILED 北交所官方首页拉取失败: {}", e))?
        }
    };
    let mut all = first_items;
    for page in 1..total_pages {
        match fetch_bse_page(&client, page, cookie.as_deref()).await {
            Ok((_tp, items)) => all.extend(items),
            Err(e) => eprintln!(
                "[update_stock_codes] 北交所官方第 {} 页失败（跳过）: {}",
                page, e
            ),
        }
    }
    if all.is_empty() {
        return Err(
            "BSE_EMPTY 北交所官方未返回任何股票数据（可能被官网 WAF 拦截）".to_string(),
        );
    }
    Ok(all)
}

/// 北交所补全主入口：仅使用北交所官方接口（带 WAF cookie 挑战，沙箱/本机实跑验证
/// 返回 ~331 条 92 开头纯北交所）。官方源失败则本次不补全北交所（交由上层日志告警）。
async fn fetch_stocks_from_bse() -> Result<Vec<StockSourceItem>, String> {
    let items = fetch_bse_official().await?;
    eprintln!("[update_stock_codes] 北交所-官方源拉取 {} 条", items.len());
    Ok(items)
}

fn build_target_select_sql(pg_config: &PgConfig) -> Result<String, String> {
    let table = pg_config
        .table_name
        .as_deref()
        .unwrap_or("cn_stock_name_wind");
    let col_ticker = pg_config.col_ticker.as_deref().unwrap_or("ticker");
    let col_stock_name = pg_config.col_stock_name.as_deref().unwrap_or("stock_name");

    let quoted_table = quote_maybe_schema(table)?;
    let quoted_ticker = quote_ident(&sanitize_identifier(col_ticker)?);
    let quoted_name = quote_ident(&sanitize_identifier(col_stock_name)?);

    Ok(format!(
        "SELECT {t}, {n} FROM {tbl}",
        t = quoted_ticker,
        n = quoted_name,
        tbl = quoted_table,
    ))
}

#[tauri::command]
pub async fn update_stock_codes(
    project_path: String,
    pg_config: PgConfig,
) -> Result<FetchResult, String> {
    if !pg_config.is_complete() {
        return Err("INVALID_CONFIG PG 配置不完整".to_string());
    }

    let conn_str = pg_config
        .connection_string()
        .ok_or_else(|| "INVALID_PATH PG 配置未填写".to_string())?;

    // 1. Connect to PG
    let (mut client, connection) = tokio_postgres::connect(&conn_str, NoTls)
        .await
        .map_err(|e| format!("TIMEOUT PG 连接失败: {}", e))?;
    tauri::async_runtime::spawn(async move {
        if let Err(e) = connection.await {
            eprintln!("[update_stock_codes] PG connection terminated: {}", e);
        }
    });

    // 2. 直连麦蕊拉取全市场沪深 A 股列表（hslt/list，含 ST；不含北交所）
    let licence = pg_config
        .mairui_api_licence
        .clone()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_MAIRUI_LICENCE.to_string());
    let mut stocks_data = fetch_stocks_from_mairui(&licence).await?;

    // 3. 补全北交所：仅北交所官方源（带 WAF cookie），失败则本次不补全
    match fetch_stocks_from_bse().await {
        Ok(bse) => {
            eprintln!("[update_stock_codes] 北交所合并源拉取 {} 条", bse.len());
            stocks_data.extend(bse);
        }
        Err(e) => {
            eprintln!(
                "[update_stock_codes] 北交所源全部失败，本次不补全北交所: {}",
                e
            );
        }
    }

    let table = pg_config
        .table_name
        .as_deref()
        .unwrap_or("cn_stock_name_wind");
    let col_ticker = pg_config.col_ticker.as_deref().unwrap_or("ticker");
    let col_stock_name = pg_config.col_stock_name.as_deref().unwrap_or("stock_name");

    let quoted_table = quote_maybe_schema(table)?;
    let quoted_ticker = quote_ident(&sanitize_identifier(col_ticker)?);
    let quoted_name = quote_ident(&sanitize_identifier(col_stock_name)?);

    // 4. Load existing rows for upsert semantics
    let select_sql = build_target_select_sql(&pg_config)?;
    let rows = client
        .query(&select_sql, &[])
        .await
        .map_err(|e| format!("UNKNOWN PG 查询失败: {} | SQL={}", e, select_sql))?;

    let mut existing = HashMap::<String, String>::new();
    for row in &rows {
        let code: String = row.get(0);
        let name: String = row.get(1);
        if !code.is_empty() {
            existing.insert(code, name);
        }
    }

    // 5. Upsert in a transaction
    let transaction = client
        .transaction()
        .await
        .map_err(|e| format!("UNKNOWN PG 开启事务失败: {}", e))?;

    let insert_sql = format!(
        "INSERT INTO {tbl} ({t}, {n}) VALUES ($1, $2)",
        tbl = quoted_table,
        t = quoted_ticker,
        n = quoted_name,
    );
    let update_sql = format!(
        "UPDATE {tbl} SET {n} = $1 WHERE {t} = $2",
        tbl = quoted_table,
        n = quoted_name,
        t = quoted_ticker,
    );

    let mut inserted = 0usize;
    let mut updated = 0usize;

    for stock in stocks_data {
        let code = stock.dm.chars().take(6).collect::<String>();
        let name = stock.mc;
        if code.len() != 6 || name.is_empty() {
            continue;
        }
        match existing.get(&code) {
            Some(existing_name) if existing_name == &name => {
                // identical, skip
            }
            Some(_) => {
                transaction
                    .execute(&update_sql, &[&name, &code])
                    .await
                    .map_err(|e| {
                        format!("UNKNOWN PG 更新失败: {} | SQL={}", e, update_sql)
                    })?;
                updated += 1;
            }
            None => {
                transaction
                    .execute(&insert_sql, &[&code, &name])
                    .await
                    .map_err(|e| {
                        format!("UNKNOWN PG 插入失败: {} | SQL={}", e, insert_sql)
                    })?;
                inserted += 1;
            }
        }
    }

    transaction
        .commit()
        .await
        .map_err(|e| format!("UNKNOWN PG 提交事务失败: {}", e))?;

    let fetched_at = now_local_timestamp();
    let count = inserted + updated + existing.len();
    let file = StockSyncFile {
        fetched_at: fetched_at.clone(),
        count,
        inserted,
        updated,
    };

    let path = stock_sync_path(&project_path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("WRITE_FAILED 创建目录失败: {}", e))?;
    }
    let json = serde_json::to_string_pretty(&file)
        .map_err(|e| format!("UNKNOWN 序列化失败: {}", e))?;
    fs::write(&path, json)
        .map_err(|e| format!("WRITE_FAILED 写入 stock-sync.json 失败: {}", e))?;

    Ok(FetchResult {
        count,
        inserted,
        updated,
        fetched_at,
    })
}

#[tauri::command]
pub fn get_stock_sync_status(project_path: String) -> Result<Option<FetchResult>, String> {
    Ok(load_stock_sync_from_disk(&project_path).map(|f| FetchResult {
        count: f.count,
        inserted: f.inserted,
        updated: f.updated,
        fetched_at: f.fetched_at,
    }))
}

