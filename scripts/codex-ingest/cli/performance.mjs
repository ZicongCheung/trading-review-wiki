const PERFORMANCE_PROFILE_ALIASES = new Map([
  ["localmax", "local-max"],
  ["local_max", "local-max"],
  ["m5-max", "local-max"],
  ["m5max", "local-max"],
])

const PERFORMANCE_PROFILE_DEFAULTS = new Map([
  ["local-max", {
    agentConcurrency: 8,
    agentTimeoutMs: 180000,
    policyRegressionConcurrency: 8,
    exportVerifyConcurrency: 16,
    verifyConcurrency: 16,
  }],
])

export function resolveCliPerformanceProfile(args = {}) {
  const raw = String(args["performance-profile"] ?? args.profile ?? "").trim().toLowerCase()
  if (!raw || raw === "default" || raw === "balanced" || raw === "off") return { name: raw || null, defaults: {} }
  const name = PERFORMANCE_PROFILE_ALIASES.get(raw) ?? raw
  const defaults = PERFORMANCE_PROFILE_DEFAULTS.get(name)
  if (!defaults) throw new Error("Unknown performance profile. Use --profile local-max or omit --profile.")
  return { name, defaults: { ...defaults } }
}
