import fs from "node:fs/promises"
import https from "node:https"
import os from "node:os"
import path from "node:path"
import vm from "node:vm"
import { createHash } from "node:crypto"
import { execFile, execFileSync, spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { parse as parseYaml, stringify as stringifyYaml } from "yaml"
import { promisify } from "node:util"
import { readFileSync } from "node:fs"

export const execFileAsync = promisify(execFile)

export const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url))

export const DEFAULT_PROJECT_PATH = "/Users/jiegege/Desktop/杰杰杰"

export const REPORT_ROOT = ".llm-wiki/codex-ingest"

export const AGENT_RUNS_ROOT = ".llm-wiki/agent-runs"

export const COMPANY_RESEARCH_ROOT = ".llm-wiki/company-research"

export const CONCEPT_GOVERNANCE_ROOT = ".llm-wiki/concept-governance"

export const MANIFEST_SCHEMA = "codex-ingest-manifest-v1"

export const CONCEPT_CANONICAL_RULINGS_SCHEMA = "concept-canonical-rulings-v1"

export const DEFAULT_CONCEPT_RULINGS_PATH = normalizePath(path.join(MODULE_DIR, "..", "..", "..", "data/concepts/canonical_rulings.json"))

export const PAGE_BODY_LINE_SOFT_LIMIT = 2000

export const DEFAULT_CODEX_BIN = "/Applications/Codex.app/Contents/Resources/codex"

export const DEFAULT_CODEX_TIMEOUT_MS = 30 * 60 * 1000

export const SOURCE_PROMPT_CHAR_SOFT_LIMIT = 90000

export const DEFAULT_SOURCE_SHARD_MAX_CHARS = 45000

export const DEFAULT_SOURCE_SHARD_CONCURRENCY = 3

export const METHODOLOGY_CONTEXT_TOTAL_CHAR_SOFT_LIMIT = 11000

export const METHODOLOGY_PAGE_CHAR_SOFT_LIMIT = 1600

export const METHODOLOGY_STAGE3_RULE_CHAR_SOFT_LIMIT = 2200

export const METHODOLOGY_CONTEXT_PATHS = [
  "wiki/策略/四层嵌套决策体系.md",
  "wiki/策略/L4执行控制层.md",
  "wiki/策略/Tier-1退出机制.md",
  "wiki/策略/催化剂L4必问清单.md",
  "wiki/策略/催化剂复盘流程.md",
  "wiki/策略/催化剂评分交易规则.md",
  "wiki/概念/催化剂层级框架.md",
  "wiki/错误/事件催化替代买点纪律.md",
  "wiki/策略/WKID四步法.md",
]

export const WIKI_TYPES = [
  "股票",
  "概念",
  "策略",
  "模式",
  "错误",
  "人物",
  "总结",
  "查询",
  "源文档",
  "事件",
]

export const WIKI_STATUS = ["活跃", "观察", "归档", "废弃", "迭代中"]

export const CONFIDENCE = ["高", "中", "低"]

export const SUMMARY_MIN = 50

export const SUMMARY_MAX = 160

export const STOCK_CODE_REGEX = /^(?:(?:SZ|SH|BJ)\d{6}|HK\d{5}|[A-Z]{1,5}(?:\.[A-Z])?)$/

export const TIMESTAMP_REGEX = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/

export const WIKILINK_REGEX = /^\[\[[^\]]+\]\]$/

export const RESERVED_WIKI_PATHS = new Set(["wiki/index.md", "wiki/overview.md", "wiki/log.md"])

export const DAILY_LOG_REGEX = /^wiki\/logs\/log-\d{4}-\d{2}-\d{2}\.md$/

export const SOURCE_MAINLINE_INDEX_START = "<!-- codex-source-mainline-index:start -->"

export const SOURCE_MAINLINE_INDEX_END = "<!-- codex-source-mainline-index:end -->"

export const TEXT_EXTENSIONS = new Set([".md", ".markdown", ".txt", ".text", ".log"])

export const CONVERTIBLE_SOURCE_EXTENSIONS = new Set([
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".html",
  ".htm",
  ".csv",
  ".json",
  ".xml",
  ".zip",
  ".epub",
  ".msg",
])

export const ASK_NAVIGATION_PATHS = ["wiki/index.md", "wiki/overview.md"]

export const ASK_DEFAULT_TOP_WIKI = 12

export const ASK_DEFAULT_TOP_RAW = 12

export const ASK_DEFAULT_GRAPH_NEIGHBORS = 8

export const ASK_DEFAULT_GRAPH_DEPTH = 1

export const ASK_MAX_GRAPH_DEPTH = 2

export const ASK_DEFAULT_SOURCE_K = 3

export const ASK_DEFAULT_TOP_FACTS = 8

export const ASK_DEFAULT_TOP_BRAIN = 8

export const ASK_DEFAULT_SQL_LIMIT = 200

export const DEFAULT_AGENT_CONCURRENCY = 3

export const TEMPORAL_FACTS_RELATIVE_PATH = "data/facts/temporal_edges.jsonl"

export const TEMPORAL_FACT_INDEX_RELATIVE_PATH = "data/facts/temporal_edges.index.json"

export const TEMPORAL_FACT_PREDICATES = [
  "HAS_CATALYST",
  "HAS_ORDER",
  "HAS_ORDER_RUMOR",
  "HAS_ORDER_INTENT",
  "HAS_CONFIRMED_ORDER",
  "HAS_DELIVERY_VALIDATION",
  "HAS_CUSTOMER",
  "HAS_CAPACITY",
  "HAS_PRICE_SIGNAL",
  "HAS_POLICY_SUPPORT",
  "HAS_PRODUCT",
  "HAS_TECH_PROGRESS",
  "HAS_SUPPLY_CONSTRAINT",
  "HAS_VALIDATION_SIGNAL",
  "PRICE_VALIDATED",
  "VOLUME_VALIDATED",
  "CUSTOMER_VALIDATED",
  "TECH_VALIDATED",
  "FUNDAMENTAL_VALIDATED",
  "HAS_RISK",
  "HAS_CLARIFICATION_RISK",
  "HAS_COMPETITION_RISK",
  "HAS_DEMAND_RISK",
  "HAS_SUPPLY_CHAIN_RISK",
  "HAS_VALUATION_RISK",
  "VALIDATES",
  "CONTRADICTS",
]

export const TEMPORAL_FACT_STATUSES = ["active", "superseded", "invalidated", "expired"]

export const TEMPORAL_FACT_EVIDENCE_LEVELS = ["A", "B", "C", "D"]

export const TEMPORAL_FACT_SOURCE_KINDS = [
  "official_announcement",
  "financial_report",
  "exchange_interaction",
  "government_policy",
  "company_ir",
  "broker_research",
  "industry_database",
  "expert_meeting",
  "media_report",
  "social_chat",
  "market_price",
  "manual_review",
]

export const ASK_STOCK_DAILY_KEYCHAIN_SERVICE = "trading-wiki-cn-stock-db"

export const ASK_STOCK_DAILY_KEYCHAIN_ACCOUNT = "shihao"

export const ASK_STOCK_DAILY_DEFAULT_DATABASE = "cn_stock_db"

export const ASK_STOCK_DAILY_DEFAULT_SCHEMA = "public"

export const ASK_STOCK_DAILY_DEFAULT_TABLE = "cn_stock_price_daily_wind"

export const COMPANY_TUSHARE_KEYCHAIN_SERVICE = "trading-wiki-tushare-token"

export const COMPANY_TUSHARE_KEYCHAIN_ACCOUNT = "tushare"

export const COMPANY_TAVILY_KEYCHAIN_SERVICE = "trading-wiki-tavily-api-key"

export const COMPANY_TAVILY_KEYCHAIN_ACCOUNT = "tavily"

export const QCC_OPENAPI_KEYCHAIN_SERVICE = "trading-wiki-qichacha-openapi"

export const QCC_OPENAPI_KEYCHAIN_KEY_ACCOUNT = "key"

export const QCC_OPENAPI_KEYCHAIN_SECRET_ACCOUNT = "secret"

export const CNINFO_DATASERVICE_KEYCHAIN_SERVICE = "trading-wiki-cninfo-dataservice"

export const CNINFO_DATASERVICE_KEYCHAIN_KEY_ACCOUNT = "access-key"

export const CNINFO_DATASERVICE_KEYCHAIN_SECRET_ACCOUNT = "access-secret"

export const QCC_TENDER_LIST_ENDPOINT = "https://api.qichacha.com/TenderCheck/GetList"

export const COMPANY_RESEARCH_TEMPLATE_VERSION = "company-research-model-v1"

export const COMPANY_DEEP_TEMPLATE_VERSION = "company-research-deep-v1"

export const COMPANY_FINANCIAL_MODEL_V2_VERSION = "company-financial-model-v2"

export const ASK_WIKI_EXCERPT_CHARS = 3600

export const ASK_RAW_EXCERPT_CHARS = 2800

export const ASK_GRAPH_EXCERPT_CHARS = 2200

export const ASK_NAV_EXCERPT_CHARS = 2600

export const ASK_FACTS_EXCERPT_CHARS = 1800

export const ASK_BRAIN_EXCERPT_CHARS = 1800

export const ASK_SQL_EXCERPT_CHARS = 1800

export const ASK_CONTEXT_TOKEN_CHAR_RATIO = 3.2

export const ASK_LEDGER_EXCERPT_CHARS = 520

export const ASK_ROLE_EVIDENCE_EXCERPT_CHARS = 1100

export const ASK_ROLE_MARKET_EXCERPT_CHARS = 900

export const ASK_TIME_TOKENS = new Set(["最近", "近一", "一周", "近7天", "本周", "这周", "最近一周", "近一个月", "最近一个月", "本月", "这个月", "今天", "当日", "昨天", "昨日"])

export const ASK_SOURCE_IDS = ["wiki_pages", "raw_text", "wiki_graph", "facts_jsonl", "brain_memory", "stock_daily_sql"]

export const RETRIEVAL_MODES = Object.freeze({
  ASK: "ask",
  INGEST: "ingest",
})

export const ASK_SOURCE_ALIASES = new Map(
  Object.entries({
    auto: "auto",
    wiki: "wiki_pages",
    wikis: "wiki_pages",
    "wiki-pages": "wiki_pages",
    wiki_pages: "wiki_pages",
    raw: "raw_text",
    raws: "raw_text",
    "raw-text": "raw_text",
    raw_text: "raw_text",
    graph: "wiki_graph",
    "wiki-graph": "wiki_graph",
    wiki_graph: "wiki_graph",
    facts: "facts_jsonl",
    "facts-jsonl": "facts_jsonl",
    facts_jsonl: "facts_jsonl",
    brain: "brain_memory",
    memory: "brain_memory",
    "brain-memory": "brain_memory",
    brain_memory: "brain_memory",
    "stock-price": "stock_daily_sql",
    "stock-daily": "stock_daily_sql",
    stock: "stock_daily_sql",
    sql: "stock_daily_sql",
    stock_daily_sql: "stock_daily_sql",
  }),
)

export const STOCK_DAILY_KEYWORD_REGEX = /(?:股价|价格|收盘|开盘|最高|最低|涨跌|涨幅|跌幅|成交量|成交额|换手|日线|k线|K线|量价|均线|振幅|交易日|最近\d+|近\d+|涨了|跌了)/

export const TRADE_REVIEW_KEYWORD_REGEX = /(?:错误|模式|复盘|高开|接盘|打板|割肉|回撤|交割单|交易|买入|卖出|持仓|亏损|盈利|执行|纪律|仓位)/

export const FACTS_KEYWORD_REGEX = /(?:案例|观察|事实|验证|预测|计划|证伪|样本|记录)/

export const BRAIN_KEYWORD_REGEX = /(?:记忆|纠错|偏好|卫语句|guardrail|自训练|训练|置信度|待验证|验证|预测|复盘|错误|偏好|样本)/

export const RAW_NEWS_KEYWORD_REGEX = /(?:最近|近期|本周|新闻|舆情|研报|会议|调研|微信|gangtise|投研|催化|涨价|订单|纪要)/

export const TOPIC_MARKET_VALIDATION_KEYWORD_REGEX = /(?:订单|兑现|叙事|扩散|发酵|承接|强弱|主线|补涨|题材|板块|产业链|方向|验证|量价|高开低走|走强|走弱)/

export const ASK_DEFAULT_TOPIC_STOCK_LIMIT = 5

export const ASK_DEFAULT_TOPIC_SEGMENT_STOCK_LIMIT = 2

export const ASK_DEFAULT_TOPIC_SEGMENT_TOTAL_STOCK_LIMIT = 10

export const ASK_DEFAULT_TOPIC_SEGMENT_MAX_SEGMENTS_PER_STOCK = 2

export const TOPIC_MARKET_SEGMENT_REGISTRY_RELATIVE_PATHS = Object.freeze([
  ".llm-wiki/theme-segments.json",
  "data/market/theme-segments.json",
])

export const TOPIC_SEGMENT_REQUEST_REGEX = /(?:细分|环节|产业链|链条|上游|中游|下游|分别|分桶|候选池|拆分|子方向|支线)/

export const DEFAULT_TOPIC_MARKET_SEGMENT_REGISTRY = Object.freeze([
  {
    id: "optical-interconnect",
    label: "光互联/光纤链",
    keywords: ["光互联", "光纤", "光缆", "光纤光缆", "MPO", "MTP", "FAU", "光纤阵列", "特种光纤", "CPO", "LPO", "NPO", "800G", "1.6T", "数据中心布线"],
    segments: [
      {
        id: "fiber-cable",
        label: "光纤光缆",
        keywords: ["光纤光缆", "光缆", "普通光纤", "光棒", "预制棒", "光纤预制棒"],
      },
      {
        id: "mpo-mtp",
        label: "MPO/MTP连接器",
        keywords: ["MPO", "MTP", "MT插芯", "光连接器", "多芯连接器", "连接器"],
      },
      {
        id: "patch-cord",
        label: "高密跳线",
        keywords: ["跳线", "高密跳线", "光纤跳线", "线缆组件", "高密布线"],
      },
      {
        id: "fau",
        label: "FAU/光纤阵列",
        keywords: ["FAU", "光纤阵列", "Fiber Array", "硅光耦合", "耦合组件"],
      },
      {
        id: "specialty-fiber",
        label: "特种光纤",
        keywords: ["特种光纤", "保偏光纤", "空芯光纤", "空心光纤", "多芯光纤", "少模光纤", "HCF", "PMF"],
      },
    ],
  },
  {
    id: "pcb-chain",
    label: "PCB产业链",
    maxSegmentsPerStock: 4,
    keywords: ["PCB", "印制电路板", "高速板", "HDI", "背板", "覆铜板", "CCL", "ABF", "BT载板", "树脂", "玻纤布", "电子纱", "铜箔", "HVLP", "钻孔", "压合", "曝光", "AOI", "PCB化学品"],
    segments: [
      {
        id: "high-speed-pcb",
        label: "高速多层PCB",
        keywords: ["高速多层PCB", "高速PCB", "多层PCB", "高速板", "AI服务器PCB", "交换机PCB", "高频高速板"],
      },
      {
        id: "hdi",
        label: "HDI",
        keywords: ["HDI", "高阶HDI", "任意层", "积层板", "高密度互连"],
      },
      {
        id: "server-backplane",
        label: "服务器背板",
        keywords: ["服务器背板", "交换机背板", "高速背板", "背板", "背钻", "插损"],
      },
      {
        id: "abf-bt-substrate",
        label: "ABF/BT载板",
        keywords: ["ABF", "ABF载板", "BT载板", "IC载板", "封装载板"],
      },
      {
        id: "high-speed-ccl",
        label: "高速覆铜板CCL",
        keywords: ["高速覆铜板", "覆铜板", "CCL", "高速CCL", "低损耗覆铜板"],
      },
      {
        id: "low-dk-df-resin",
        label: "低Dk-Df树脂",
        keywords: ["低Dk", "低Df", "低Dk-Df", "树脂", "PPO", "PTFE", "碳氢树脂", "低损耗树脂"],
      },
      {
        id: "glass-cloth-yarn",
        label: "玻纤布/电子纱",
        keywords: ["玻纤布", "电子纱", "Low Dk玻纤布", "Low Df玻纤布", "扁平纱"],
      },
      {
        id: "hvlp-copper-foil",
        label: "HVLP铜箔",
        keywords: ["HVLP", "HVLP铜箔", "铜箔", "RTF铜箔", "极低轮廓铜箔"],
      },
      {
        id: "pcb-equipment",
        label: "钻孔/压合/曝光设备",
        keywords: ["钻孔设备", "压合设备", "曝光设备", "LDI", "激光钻孔", "钻针", "成型设备"],
      },
      {
        id: "aoi-testing",
        label: "AOI/测试设备",
        keywords: ["AOI", "测试设备", "飞针测试", "电测", "缺陷检测", "自动光学检测"],
      },
      {
        id: "pcb-chemicals",
        label: "PCB化学品",
        keywords: ["PCB化学品", "沉铜", "电镀液", "棕化", "蚀刻液", "干膜", "阻焊油墨"],
      },
    ],
  },
])

export const TOPIC_MARKET_CANDIDATE_NAME_DENYLIST = new Set([
  "申万宏源",
  "中信证券",
  "中金公司",
  "华泰证券",
  "国泰海通",
  "国泰君安",
  "海通证券",
  "广发证券",
  "招商证券",
  "国金证券",
  "兴业证券",
  "光大证券",
  "长江证券",
  "浙商证券",
  "天风证券",
  "东吴证券",
  "东北证券",
  "西部证券",
  "财通证券",
  "国信证券",
  "东方证券",
  "中银证券",
  "信达证券",
  "首创证券",
  "国联证券",
  "方正证券",
  "太平洋",
  "山西证券",
  "南京证券",
  "华西证券",
  "机器人",
])

export const METHODOLOGY_IMPORTANT_LINE_REGEX = /(?:L1|L2|L3|L4|四层|嵌套|决策|执行|控制|退出|卖出|买点|催化|事实|证据|验证|观察|纪律|仓位|风控|预期|兑现|WKID|四步法|明日|清单|盘前|盘中|盘后|硬催化|软催化|评分|层级|替代|证伪|主线|非主线|吸收|分歧|确认)/

export const INGEST_SEGMENT_DEFAULT_MAX = 12

export const INGEST_SEGMENT_WIKI_LIMIT = 8

export const INGEST_SEGMENT_RAW_LIMIT = 4

export const INGEST_SOURCE_FIELD_TOKENS = new Set([
  "title",
  "theme",
  "theme_id",
  "theme_date",
  "type",
  "type_code",
  "name",
  "code",
  "date",
  "category",
  "category_name",
  "source",
  "source_db",
  "source_field",
  "content_sha256",
  "content",
  "entry_time",
  "field",
  "full",
  "hot",
  "update_time",
  "hot_score",
  "hot_status",
  "hot_reasons",
  "metadata",
  "frontmatter",
  "yaml",
  "markdown",
  "raw",
  "full_content",
  "public",
  "alternative",
  "cn_alternative_db",
  "gangtise_themes",
  "sha256",
  "status",
  "strong",
  "themes",
])

export const INGEST_IMPORTANT_PHRASE_REGEX = /(?:具身智能|人形机器人|谐波减速器|灵巧手|执行器|算电协同|电力运营商|数据中心|光模块|液冷|固态电池|低空经济|覆铜板|订单节点|量产节点)/

export const INGEST_GENERIC_SOURCE_TOKENS = new Set([
  "今日",
  "核心",
  "叙事",
  "逻辑",
  "验证",
  "原文",
  "元数据",
  "复盘",
  "晨报",
  "产业趋势",
  "热门",
  "非热门",
  "行业",
  "当前",
  "主线",
  "白名单",
  "公司",
  "公司动态",
  "动态",
  "关注",
  "今日关注",
  "今日及近期关注事件",
  "近期",
  "近一周展望",
  "重点资讯与公告",
  "完整调研原文",
  "同步与窗口",
  "舆情更新",
  "舆情摘要",
  "市场情绪",
  "重点板块",
  "风险与待验证",
  "待验证",
  "政策",
  "事件",
  "重点",
  "公告",
  "资讯",
  "机构",
  "推荐",
  "观点",
  "更新",
  "进入",
  "成为",
  "显示",
  "指出",
])

export const INGEST_UPPERCASE_KEEP_TOKENS = new Set([
  "AI",
  "PCB",
  "CPO",
  "NPO",
  "TGV",
  "HBM",
  "MLCC",
  "HVDC",
  "PSPI",
  "SOP",
  "PPA",
  "IPO",
  "CEO",
  "NV",
  "GB200",
  "GB300",
  "ASIC",
])

export const STOCK_CODE_LIKE_REGEX = /\b(?:(?:SZ|SH|BJ)\d{6}|\d{6}\.(?:SZ|SH|BJ)|\d{6})\b/gi

export const STOCK_DAILY_COLUMN_CANDIDATES = {
  ticker: ["ticker", "wind_code", "s_info_windcode", "stock_code", "code", "symbol", "ts_code"],
  date: ["date", "trade_date", "tradedate", "trade_dt", "trading_date", "s_info_windcode_date", "datetime"],
  open: ["open", "open_price", "s_dq_open", "s_dq_adjopen"],
  high: ["high", "high_price", "s_dq_high", "s_dq_adjhigh"],
  low: ["low", "low_price", "s_dq_low", "s_dq_adjlow"],
  close: ["close", "close_price", "s_dq_close", "s_dq_adjclose"],
  preClose: ["pre_close", "preclose", "s_dq_preclose", "s_dq_adjpreclose"],
  change: ["change", "chg", "s_dq_change"],
  pctChange: ["pct_cng", "pct_chg", "pct_change", "s_dq_pctchange", "s_dq_pchange"],
  volume: ["volume", "vol", "s_dq_volume"],
  amount: ["amount", "amt", "s_dq_amount"],
  turnover: ["turnover", "turnover_rate", "s_dq_turnover", "s_dq_turnoverrate"],
}

export const BRAIN_TYPE_TO_FILE = new Map(
  Object.entries({
    thread: "active_threads.jsonl",
    active_thread: "active_threads.jsonl",
    correction: "corrections.jsonl",
    preference: "preferences.jsonl",
    guardrail: "guardrails.jsonl",
    question: "questions.jsonl",
    self_question: "questions.jsonl",
    prediction: "predictions.jsonl",
    validation: "validations.jsonl",
    attribution: "attributions.jsonl",
    self_attribution: "attributions.jsonl",
    evidence_result: "evidence_results.jsonl",
    policy: "policies.jsonl",
    event: "self_training_events.jsonl",
  }),
)

export const DAILY_LOOP_DEFAULT_VALIDATION_WINDOWS = [1, 3, 5, 10, 20]

export const DAILY_LOOP_VALIDATION_METHOD = "first_trading_day_after_prediction_v1"

export const DAILY_LOOP_MODE_DEFAULT_COUNTS = new Map([
  ["premarket", 6],
  ["postclose", 8],
  ["full", 14],
])

export const DAILY_LOOP_QUESTION_TYPES_BY_MODE = new Map([
  ["premarket", ["expected_difference", "expected_difference", "bottleneck_supplier", "bottleneck_supplier", "weak_to_strong_low_buy", "risk_counter"]],
  ["postclose", ["postclose_validation", "postclose_validation", "postclose_validation", "postclose_validation", "expected_difference", "bottleneck_supplier", "correction", "wiki_feedback"]],
  [
    "full",
    [
      "expected_difference",
      "expected_difference",
      "bottleneck_supplier",
      "bottleneck_supplier",
      "weak_to_strong_low_buy",
      "risk_counter",
      "postclose_validation",
      "postclose_validation",
      "postclose_validation",
      "postclose_validation",
      "expected_difference",
      "bottleneck_supplier",
      "correction",
      "wiki_feedback",
    ],
  ],
])

export const DAILY_LOOP_QUESTION_TYPE_LABELS = {
  expected_difference: "预期差/补涨",
  bottleneck_supplier: "卡脖子不可替代供货商",
  weak_to_strong_low_buy: "强转弱低吸",
  risk_counter: "风险反证",
  postclose_validation: "盘后验证旧假设",
  correction: "错误/模式纠偏",
  wiki_feedback: "wiki反哺总结",
}

export const DAILY_LOOP_EXTERNAL_MARKET_DEFAULT = "auto"

export const EASTMONEY_KLINE_COLUMNS = {
  ticker: "ticker",
  date: "date",
  open: "open",
  high: "high",
  low: "low",
  close: "close",
  pctChange: "pctChange",
  change: "change",
  volume: "volume",
  amount: "amount",
  turnover: "turnover",
  ready: true,
}

export const DAILY_LOOP_THEME_PROFILES = [
  {
    id: "ai-pcb-materials",
    branch: "PCB材料/工艺链",
    keywords: ["PCB", "CCL", "覆铜板", "电子布", "铜箔", "HVLP", "mSAP", "MSAP", "钻针", "光刻胶", "PTFE", "正交背板", "ABF", "载板"],
  },
  {
    id: "passive-components",
    branch: "MLCC/被动元件链",
    keywords: ["MLCC", "钽电容", "电容", "被动元件", "陶瓷粉体", "镍粉", "离型膜", "顺络", "风华", "三环", "国瓷"],
  },
  {
    id: "optical-upstream",
    branch: "光模块上游非成品链",
    keywords: ["光模块", "CPO", "NPO", "OCS", "InP", "CW光源", "FAU", "DFU", "保偏光纤", "测试设备", "硅光", "光芯片", "光通信"],
  },
  {
    id: "power-hvdc",
    branch: "电源管理/供电侧",
    keywords: ["AI电源", "电源管理", "HVDC", "SST", "800V", "DrMOS", "GaN", "软磁粉", "变压器", "AIDC", "Power Shelf", "VPD"],
  },
  {
    id: "storage-ai-data",
    branch: "存储/AI数据基础设施",
    keywords: ["存储", "SSD", "HDD", "HBM", "NAND", "长协", "数据湖", "KV cache", "内存池"],
  },
  {
    id: "robot-physical-ai",
    branch: "机器人/物理AI",
    keywords: ["机器人", "物理AI", "宇树", "Optimus", "传感器", "灵巧手", "减速器", "执行器"],
  },
]

export const SELF_TRAIN_RULES = [
  "R1-concept-upgrade",
  "R2-concept-downgrade",
  "R3-pattern-solidify",
  "R4-cognitive-conflict",
  "R5-stale-validation-decay",
  "R6-error-guardrail-escalation",
  "R7-hypothesis-review",
  "R8-attribution-fundamental-gap",
  "R9-open-regression-gate",
]

export const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".tiff",
  ".avif",
  ".heic",
  ".mp4",
  ".webm",
  ".mov",
  ".avi",
  ".mkv",
  ".mp3",
  ".wav",
  ".ogg",
  ".flac",
  ".m4a",
  ".exe",
  ".zip",
  ".rar",
  ".7z",
  ".tar",
  ".gz",
  ".db",
  ".tmp",
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".csv",
])

export function normalizeRetrievalMode(mode) {
  const value = String(mode ?? "").trim().toLowerCase()
  if (value === RETRIEVAL_MODES.ASK || value === RETRIEVAL_MODES.INGEST) return value
  throw new Error(`Retrieval mode must be explicit: ${RETRIEVAL_MODES.ASK} or ${RETRIEVAL_MODES.INGEST}`)
}

export const STOP_WORDS = new Set([
  "的",
  "是",
  "了",
  "什么",
  "在",
  "有",
  "和",
  "与",
  "对",
  "从",
  "这个",
  "一个",
  "以及",
  "进行",
  "the",
  "is",
  "a",
  "an",
  "what",
  "how",
  "are",
  "was",
  "were",
  "do",
  "does",
  "did",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "it",
  "its",
  "in",
  "on",
  "at",
  "to",
  "for",
  "of",
  "with",
  "by",
  "this",
  "that",
  "these",
  "those",
])

export const GENERIC_QUERY_TOKENS = new Set([
  "投资",
  "方向",
  "交易",
  "证据",
  "验证",
  "知识",
  "知识库",
  "已有",
  "反复",
  "哪些",
  "应该",
  "优先",
  "区分",
  "仍偏",
  "叙事",
  "环节",
  "标的",
  "节点",
  "最近",
  "一个月",
  "最近一个月",
  "产业",
  "链环",
  "要看",
  "来看",
])

export const EVIDENCE_QUERY_TOKENS = new Set([
  "订单",
  "客户",
  "出货",
  "量价",
  "量产",
  "产能",
  "合同",
  "中标",
  "交付",
  "毛利",
  "价格",
  "涨价",
  "市占",
  "份额",
  "导入",
  "认证",
  "供应",
  "供应商",
  "客户节点",
  "验证节点",
  "出货量",
])

export const TYPE_ALIASES = new Map(
  Object.entries({
    股票: "股票",
    个股档案: "股票",
    stock: "股票",
    stocks: "股票",
    entity: "股票",
    entities: "股票",
    概念: "概念",
    concept: "概念",
    concepts: "概念",
    策略: "策略",
    strategy: "策略",
    strategies: "策略",
    模式: "模式",
    市场模式: "模式",
    市场环境: "模式",
    进化: "模式",
    预测: "模式",
    pattern: "模式",
    patterns: "模式",
    错误: "错误",
    error: "错误",
    mistake: "错误",
    mistakes: "错误",
    人物: "人物",
    people: "人物",
    person: "人物",
    总结: "总结",
    分析: "总结",
    比较: "总结",
    synthesis: "总结",
    analysis: "总结",
    comparison: "总结",
    comparisons: "总结",
    查询: "查询",
    query: "查询",
    queries: "查询",
    源文档: "源文档",
    source: "源文档",
    sources: "源文档",
    事件: "事件",
    event: "事件",
    events: "事件",
  }),
)

export const STATUS_ALIASES = new Map(
  Object.entries({
    活跃: "活跃",
    观察: "观察",
    归档: "归档",
    废弃: "废弃",
    迭代中: "迭代中",
    active: "活跃",
    watching: "观察",
    archived: "归档",
    deprecated: "废弃",
    iterating: "迭代中",
  }),
)

export function toPosixPath(input) {
  return input.replace(/\\/g, "/")
}

export function normalizePath(input) {
  return toPosixPath(path.resolve(input))
}

export function projectRelative(projectPath, targetPath) {
  return toPosixPath(path.relative(path.resolve(projectPath), path.resolve(targetPath)))
}

export function nowLocalTimestamp() {
  const d = new Date()
  const pad = (n) => n.toString().padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export function isTextSourcePath(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  if (BINARY_EXTENSIONS.has(ext)) return false
  return TEXT_EXTENSIONS.has(ext)
}

export function isConvertibleSourcePath(filePath) {
  return CONVERTIBLE_SOURCE_EXTENSIONS.has(path.extname(filePath).toLowerCase())
}

export function defaultConvertedSourcePath(sourcePath) {
  const ext = path.extname(sourcePath)
  const stem = path.basename(sourcePath, ext)
  return normalizePath(path.join(path.dirname(sourcePath), `${stem}.markitdown.md`))
}

export function isPdfSourcePath(filePath) {
  return path.extname(filePath).toLowerCase() === ".pdf"
}

export async function readTextFile(filePath) {
  return fs.readFile(filePath, "utf8")
}

export function yamlString(value) {
  return JSON.stringify(String(value ?? ""))
}

export async function readIfExists(filePath) {
  try {
    return await readTextFile(filePath)
  } catch {
    return ""
  }
}

export async function exists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

export async function ensureDirectory(dirPath) {
  await fs.mkdir(dirPath, { recursive: true })
}

export function sha256Hex(text) {
  return createHash("sha256").update(text).digest("hex")
}

export function shortHash(text) {
  return sha256Hex(text).slice(0, 16)
}

export function makeReportId(sourcePath) {
  const safeName = path.basename(sourcePath).replace(/[^\p{L}\p{N}._-]+/gu, "-")
  return `${new Date().toISOString().replace(/[:.]/g, "-")}-${safeName}`
}

export async function writeJson(filePath, data) {
  await ensureDirectory(path.dirname(filePath))
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8")
}

export async function appendJsonl(filePath, record) {
  await ensureDirectory(path.dirname(filePath))
  await fs.appendFile(filePath, `${JSON.stringify(record)}\n`, "utf8")
}

export async function readJsonlFile(filePath) {
  const raw = await readIfExists(filePath)
  if (!raw.trim()) return []
  const records = []
  const lines = raw.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    try {
      records.push({ value: JSON.parse(line), line: i + 1 })
    } catch {
      records.push({ value: line, line: i + 1, parseError: true })
    }
  }
  return records
}

export function isObjectRecord(value) {
  return value != null && typeof value === "object" && !Array.isArray(value)
}

export function stableJsonString(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableJsonString(item)).join(",")}]`
  if (isObjectRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableJsonString(value[key])}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}

export function parsePositiveInteger(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : fallback
}

export function dailyLogPathFromTimestamp(timestamp) {
  const day = String(timestamp ?? nowLocalTimestamp()).slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return `wiki/logs/log-${nowLocalTimestamp().slice(0, 10)}.md`
  return `wiki/logs/log-${day}.md`
}

export function isLogPath(relativePath) {
  return relativePath === "wiki/log.md" || DAILY_LOG_REGEX.test(relativePath)
}

export function isReservedWikiPath(relativePath) {
  return RESERVED_WIKI_PATHS.has(relativePath) || DAILY_LOG_REGEX.test(relativePath)
}

export function housekeepingPaths(nowTs) {
  return ["wiki/index.md", "wiki/overview.md", dailyLogPathFromTimestamp(nowTs)]
}

export async function mapWithConcurrency(items, concurrency, worker) {
  const limit = Math.max(1, Math.min(parsePositiveInteger(concurrency, 1), items.length || 1))
  const results = new Array(items.length)
  let nextIndex = 0

  async function runNext() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex
      nextIndex += 1
      results[currentIndex] = await worker(items[currentIndex], currentIndex)
    }
  }

  await Promise.all(Array.from({ length: limit }, runNext))
  return results
}

export async function listFilesRecursive(root, options = {}) {
  const {
    extensions = null,
    excludeDirNames = new Set([".git", "node_modules"]),
    maxBytes = null,
    maxFiles = null,
    preferRecent = false,
  } = options

  const out = []

  async function walk(dir) {
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (excludeDirNames.has(entry.name)) continue
        await walk(fullPath)
        continue
      }
      if (!entry.isFile()) continue
      const ext = path.extname(entry.name).toLowerCase()
      if (extensions && !extensions.has(ext)) continue
      if (maxBytes != null) {
        const stat = await fs.stat(fullPath)
        if (stat.size > maxBytes) continue
      }
      out.push(fullPath)
    }
  }

  await walk(root)
  if (preferRecent) out.sort(comparePathRecencyDesc)
  return maxFiles == null ? out : out.slice(0, maxFiles)
}

export function pathDateToken(filePath) {
  return toPosixPath(filePath).match(/(\d{4}-\d{2}-\d{2})/)?.[1] ?? ""
}

export function comparePathRecencyDesc(a, b) {
  const dateA = pathDateToken(a)
  const dateB = pathDateToken(b)
  if (dateA && dateB && dateA !== dateB) return dateB.localeCompare(dateA)
  if (dateB && !dateA) return 1
  if (dateA && !dateB) return -1
  return toPosixPath(b).localeCompare(toPosixPath(a))
}

export function queryDateHints(text) {
  return [...new Set(String(text ?? "").match(/\d{4}-\d{2}-\d{2}/g) ?? [])]
}

export function filterRawFilesByQueryPolicy(rawFiles, query, options = {}) {
  const mode = normalizeRetrievalMode(options.mode ?? RETRIEVAL_MODES.ASK)
  const sorted = rawFiles.sort(comparePathRecencyDesc)
  if (mode === RETRIEVAL_MODES.INGEST) {
    return sorted.slice(0, options.maxRawFiles ?? 240)
  }
  const hints = queryDateHints(query)
  if (hints.length > 0) {
    const dated = sorted.filter((filePath) => hints.some((hint) => toPosixPath(filePath).includes(hint)))
    if (dated.length > 0) return dated.sort(comparePathRecencyDesc).slice(0, options.maxDatedRawFiles ?? 240)
  }
  return sorted.slice(0, options.maxRawFiles ?? 160)
}

export async function pathSizeBytes(targetPath) {
  let total = 0
  async function walk(currentPath) {
    let stat
    try {
      stat = await fs.lstat(currentPath)
    } catch {
      return
    }
    if (stat.isSymbolicLink()) return
    if (stat.isFile()) {
      total += stat.size
      return
    }
    if (!stat.isDirectory()) return
    let entries
    try {
      entries = await fs.readdir(currentPath, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) await walk(path.join(currentPath, entry.name))
  }
  await walk(targetPath)
  return total
}

export async function pathMetric(projectPath, relativePath) {
  const fullPath = path.join(projectPath, relativePath)
  if (!(await exists(fullPath))) {
    return { relativePath, exists: false, bytes: 0 }
  }
  return { relativePath, exists: true, bytes: await pathSizeBytes(fullPath) }
}

export function parseJsonObjectFromModelText(text) {
  const fencedJson = String(text ?? "").match(/```json\s*\n([\s\S]*?)```/i)
  const rawJson = fencedJson?.[1] ?? String(text ?? "").slice(String(text ?? "").indexOf("{"), String(text ?? "").lastIndexOf("}") + 1)
  if (!rawJson.trim()) throw new Error("Model output did not contain a JSON object")
  return JSON.parse(rawJson)
}

export function safeErrorMessage(err) {
  return String(err instanceof Error ? err.message : err ?? "unknown error").replace(
    /\b(password|passwd|pwd|token|api[_-]?key|access[_-]?secret|secret(?:[_-]?key|key)?)\s*=\s*[^\s,;]+/gi,
    (_, key) => `${key}=[redacted]`,
  )
}

export function normalizeStockCode(raw) {
  const value = String(raw ?? "").trim().toUpperCase()
  if (/^(?:SZ|SH|BJ)\d{6}$/.test(value)) return value
  const dot = value.match(/^(\d{6})\.(SZ|SH|BJ)$/)
  if (dot) return `${dot[2]}${dot[1]}`
  if (/^\d{6}$/.test(value)) {
    if (value.startsWith("6")) return `SH${value}`
    if (value.startsWith("8") || value.startsWith("4")) return `BJ${value}`
    return `SZ${value}`
  }
  return null
}

export function stockCodeAlternatives(code) {
  const normalized = normalizeStockCode(code)
  if (!normalized) return []
  const exchange = normalized.slice(0, 2)
  const digits = normalized.slice(2)
  return [...new Set([normalized, `${digits}.${exchange}`, digits])]
}

export function formatSqlCell(value) {
  if (value instanceof Date) {
    const pad = (n) => String(n).padStart(2, "0")
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
  }
  if (value == null) return ""
  if (typeof value === "number") return Number.isFinite(value) ? String(Math.round(value * 10000) / 10000) : String(value)
  return String(value)
}

export function numberFromSqlCell(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (value == null) return null
  const parsed = Number(String(value).replace(/,/g, "").trim())
  return Number.isFinite(parsed) ? parsed : null
}

export function averageNumbers(values) {
  const nums = values.map(numberFromSqlCell).filter((value) => value != null)
  if (nums.length === 0) return null
  return nums.reduce((sum, value) => sum + value, 0) / nums.length
}

export function roundMetric(value, digits = 2) {
  if (value == null || !Number.isFinite(value)) return null
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

export function jsonLineSearchText(value) {
  if (value == null) return ""
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value)
  if (Array.isArray(value)) return value.map((item) => jsonLineSearchText(item)).join(" ")
  if (typeof value === "object") {
    return Object.entries(value)
      .map(([key, item]) => `${key}: ${jsonLineSearchText(item)}`)
      .join(" ")
  }
  return ""
}

export function sanitizeArtifactName(value) {
  return String(value ?? "artifact")
    .trim()
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96) || "artifact"
}

export function pathToTitle(relativePath) {
  return path.posix.basename(relativePath, ".md").replace(/-/g, " ")
}

export function assertSafeWikiPath(relativePath) {
  const normalized = toPosixPath(relativePath).replace(/^\/+/, "")
  if (!normalized.startsWith("wiki/")) throw new Error(`Refusing to write outside wiki/: ${relativePath}`)
  if (normalized.includes("..")) throw new Error(`Refusing path traversal: ${relativePath}`)
  if (!normalized.endsWith(".md")) throw new Error(`Only markdown wiki files are supported: ${relativePath}`)
  return normalized
}

export function buildResponsesBody({ model, prompt, instructions, reasoningEffort = "medium" }) {
  return {
    model,
    instructions:
      instructions ??
      [
        "You are Codex implementing an application-grade text ingest for a trading review wiki.",
        "Follow the stage-specific output format exactly.",
      ].join("\n"),
    input: [
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: prompt }],
      },
    ],
    reasoning: { effort: reasoningEffort, summary: "auto" },
    store: false,
  }
}

export function extractTextFromResponsesJson(parsed) {
  if (typeof parsed?.output_text === "string" && parsed.output_text) return parsed.output_text
  const texts = []
  for (const item of parsed?.output ?? []) {
    if (item?.type !== "message") continue
    for (const content of item.content ?? []) {
      if (content?.type === "output_text" && typeof content.text === "string") texts.push(content.text)
    }
  }
  if (texts.length > 0) return texts.join("")
  const chatContent = parsed?.choices?.[0]?.message?.content
  if (typeof chatContent === "string" && chatContent) return chatContent
  throw new Error("No assistant text found in Responses API output")
}

export function buildCodexExecInvocation({
  codexBin = DEFAULT_CODEX_BIN,
  projectPath,
  outputPath,
  model,
  profile,
  profileV2,
  sandbox = "read-only",
  approval = "never",
}) {
  const args = []
  if (model) args.push("-m", model)
  if (profile) args.push("-p", profile)
  if (profileV2) args.push("--profile-v2", profileV2)
  args.push(
    "-s",
    sandbox,
    "-a",
    approval,
    "exec",
    "--skip-git-repo-check",
    "-C",
    projectPath,
    "--output-last-message",
    outputPath,
    "-",
  )
  return { command: codexBin, args }
}

export async function runProcessWithStdin(command, args, stdin, options = {}) {
  const timeoutMs = parsePositiveInteger(options.timeoutMs, DEFAULT_CODEX_TIMEOUT_MS)
  const maxBuffer = options.maxBuffer ?? 1024 * 1024 * 16
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill("SIGTERM")
      reject(new Error(`Command timed out after ${timeoutMs}ms: ${command} ${args.join(" ")}`))
    }, timeoutMs)

    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (chunk) => {
      stdout += chunk
      if (stdout.length > maxBuffer) {
        if (settled) return
        settled = true
        clearTimeout(timer)
        child.kill("SIGTERM")
        reject(new Error(`Command stdout exceeded ${maxBuffer} bytes: ${command}`))
      }
    })
    child.stderr.on("data", (chunk) => {
      stderr += chunk
      if (stderr.length > maxBuffer) {
        if (settled) return
        settled = true
        clearTimeout(timer)
        child.kill("SIGTERM")
        reject(new Error(`Command stderr exceeded ${maxBuffer} bytes: ${command}`))
      }
    })
    child.on("error", (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(err)
    })
    child.on("close", (code, signal) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (code === 0) {
        resolve({ stdout, stderr })
      } else {
        reject(new Error(`Command failed (${signal ?? code}): ${command} ${args.join(" ")}\n${stderr || stdout}`))
      }
    })
    child.stdin.end(stdin)
  })
}

export async function requestCodexExecText({
  stage,
  prompt,
  instructions,
  model,
  prepared,
  outputPath,
  codexBin,
  codexProfile,
  codexProfileV2,
  codexTimeoutMs,
}) {
  await ensureDirectory(path.dirname(outputPath))
  const fullPrompt = [
    instructions,
    "",
    "Important execution constraint: do not edit or write files. Return only the requested final answer content.",
    "",
    prompt,
  ]
    .filter(Boolean)
    .join("\n")
  const { command, args } = buildCodexExecInvocation({
    codexBin: codexBin ?? process.env.CODEX_BIN ?? DEFAULT_CODEX_BIN,
    projectPath: prepared.projectPath,
    outputPath,
    model,
    profile: codexProfile,
    profileV2: codexProfileV2,
  })
  await runProcessWithStdin(command, args, fullPrompt, {
    cwd: prepared.projectPath,
    timeoutMs: codexTimeoutMs,
  })
  const text = await readIfExists(outputPath)
  if (!text.trim()) throw new Error(`Codex provider returned empty output for stage ${stage}`)
  return text
}

export async function requestResponsesText({ apiKey, endpoint, model, prompt, instructions, reasoningEffort, timeoutMs }) {
  const body = buildResponsesBody({
    model,
    prompt,
    instructions,
    reasoningEffort,
  })

  const responseEndpoint = `${(endpoint ?? "https://api.openai.com").replace(/\/$/, "")}/v1/responses`
  const resolvedTimeoutMs = parsePositiveInteger(timeoutMs, 0)
  const controller = resolvedTimeoutMs > 0 ? new AbortController() : null
  const timer = controller ? setTimeout(() => controller.abort(), resolvedTimeoutMs) : null
  try {
    const response = await fetch(responseEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller?.signal,
    })
    if (!response.ok) {
      throw new Error(`Responses API failed: HTTP ${response.status} ${await response.text()}`)
    }
    const parsed = await response.json()
    return extractTextFromResponsesJson(parsed)
  } catch (err) {
    if (controller?.signal.aborted) throw new Error(`Responses API timed out after ${resolvedTimeoutMs}ms`)
    throw err
  } finally {
    if (timer) clearTimeout(timer)
  }
}
