export function isOfficialDisclosureRef(ref) {
  const text = String(ref ?? "").toLowerCase()
  if (/^(cninfo|sse|szse):announcement#/.test(text)) return true
  return text.includes("cninfo.com.cn") || text.includes("sse.com.cn") || text.includes("szse.cn")
}

export function isNativeOfficialDisclosureRef(ref) {
  return /^(cninfo|sse|szse):announcement#/i.test(String(ref ?? ""))
}

export function isPositiveOfficialToolStateRef(ref) {
  const text = String(ref ?? "").toLowerCase()
  if (!text.startsWith("tool-state:cninfo#") && !text.startsWith("tool-state:sse#") && !text.startsWith("tool-state:szse#")) return false
  if (text.includes("results=0") || text.includes("status=error")) return false
  return true
}

export function sourceIntegrityProfileForAudit(audit = {}) {
  const status = audit.status ?? "unknown"
  if (status === "hard_source_present") {
    if ((audit.nativeOfficialSourceRefs ?? []).length > 0) return "native_official_disclosure"
    if ((audit.officialSourceRefs ?? []).length > 0 && (audit.zeroResultOfficialToolStateRefs ?? []).length > 0) return "web_official_pdf_after_zero_result_tool_state"
    if ((audit.officialSourceRefs ?? []).length > 0 && audit.tavilyUsed) return "web_official_pdf_via_web_search"
    if ((audit.officialSourceRefs ?? []).length > 0) return "web_official_pdf"
    if ((audit.officialToolStateRefs ?? []).length > 0) return "positive_official_tool_state_only"
    return "hard_source_other"
  }
  if (status === "structured_data_only") return "structured_data_only"
  if (status === "web_lead_only") return "web_lead_only"
  if (status === "needs_source_refs") return "needs_source_refs"
  return status
}

export function buildSourceIntegrityAudit({ sourceRefs = [], evidenceRefs = [] } = {}) {
  const sourceRefList = Array.isArray(sourceRefs) ? sourceRefs.filter(Boolean) : []
  const evidenceRefList = Array.isArray(evidenceRefs) ? evidenceRefs.filter(Boolean) : []
  const allRefs = [...sourceRefList, ...evidenceRefList]
  const officialSourceRefs = sourceRefList.filter(isOfficialDisclosureRef)
  const nativeOfficialSourceRefs = sourceRefList.filter(isNativeOfficialDisclosureRef)
  const webSourceRefs = sourceRefList.filter((ref) => String(ref).toLowerCase().startsWith("web:"))
  const tavilyRefs = allRefs.filter((ref) => String(ref).toLowerCase().startsWith("tool-state:tavily#"))
  const officialToolStateRefs = allRefs.filter(isPositiveOfficialToolStateRef)
  const zeroResultOfficialToolStateRefs = allRefs.filter((ref) => {
    const text = String(ref ?? "").toLowerCase()
    return (text.startsWith("tool-state:cninfo#") || text.startsWith("tool-state:sse#") || text.startsWith("tool-state:szse#")) &&
      (text.includes("results=0") || text.includes("status=error"))
  })
  const cninfoRefs = allRefs.filter((ref) => isOfficialDisclosureRef(ref) || isPositiveOfficialToolStateRef(ref))
  const exchangeRefs = allRefs.filter((ref) => {
    const text = String(ref).toLowerCase()
    return text.startsWith("sse:") || text.startsWith("szse:") || text.includes("sse.com.cn") || text.includes("szse.cn")
  })
  const tushareRefs = allRefs.filter((ref) => String(ref).toLowerCase().startsWith("tushare:") || String(ref).toLowerCase().startsWith("tool-state:tushare#"))
  let status = "needs_source_refs"
  let recommendedEvidenceAction = "add_source_refs_before_link_review"
  if (officialSourceRefs.length > 0 || exchangeRefs.length > 0) {
    status = "hard_source_present"
    recommendedEvidenceAction = "review_official_disclosure_before_link"
  } else if (tushareRefs.length > 0 && webSourceRefs.length === 0 && tavilyRefs.length === 0) {
    status = "structured_data_only"
    recommendedEvidenceAction = "add_disclosure_or_review_metric_scope_before_link"
  } else if (tavilyRefs.length > 0 || webSourceRefs.length > 0) {
    status = "web_lead_only"
    recommendedEvidenceAction = "run_cninfo_or_exchange_hard_source_before_link"
  }
  const audit = {
    schema: "research-os-source-integrity-audit-v1",
    status,
    recommendedEvidenceAction,
    sourceRefCount: sourceRefList.length,
    evidenceRefCount: evidenceRefList.length,
    officialSourceRefs: officialSourceRefs.slice(0, 5),
    nativeOfficialSourceRefs: nativeOfficialSourceRefs.slice(0, 5),
    webSourceRefCount: webSourceRefs.length,
    tavilyUsed: tavilyRefs.length > 0,
    cninfoOrExchangeRefs: [...new Set([...cninfoRefs, ...exchangeRefs])].slice(0, 5),
    officialToolStateRefs: officialToolStateRefs.slice(0, 5),
    zeroResultOfficialToolStateRefs: zeroResultOfficialToolStateRefs.slice(0, 5),
    tushareRefCount: tushareRefs.length,
  }
  return {
    ...audit,
    sourceProfile: sourceIntegrityProfileForAudit(audit),
  }
}

export function summarizeSourceIntegrityAudits(audits = []) {
  return audits.reduce((counts, audit) => {
    const status = audit?.status ?? "unknown"
    counts[status] = (counts[status] ?? 0) + 1
    return counts
  }, {})
}

export function summarizeSourceIntegrityProfiles(audits = []) {
  return audits.reduce((counts, audit) => {
    const profile = audit?.sourceProfile ?? sourceIntegrityProfileForAudit(audit ?? {})
    counts[profile] = (counts[profile] ?? 0) + 1
    return counts
  }, {})
}

export function sourceIntegrityPriority(auditOrStatus = "") {
  const audit = auditOrStatus && typeof auditOrStatus === "object" ? auditOrStatus : null
  const status = audit ? audit.status : auditOrStatus
  if (status === "hard_source_present" && audit) {
    const nativeRefs = audit.nativeOfficialSourceRefs ?? (audit.officialSourceRefs ?? []).filter(isNativeOfficialDisclosureRef)
    if (nativeRefs.length > 0) return 0
    if ((audit.officialSourceRefs ?? []).length > 0 && !audit.tavilyUsed) return 1
    if ((audit.officialSourceRefs ?? []).length > 0) return 2
    return 3
  }
  const ranks = {
    hard_source_present: 3,
    structured_data_only: 4,
    web_lead_only: 5,
    needs_source_refs: 6,
  }
  return ranks[String(status)] ?? 4
}
