use std::io::{BufReader, BufRead};
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};
use tauri::Emitter;

const MAX_OUTPUT_BYTES: usize = 2_000_000;
// No machine-local absolute paths. Optional extra roots come from env:
// TRADING_WIKI_DEFAULT_FINANCE_ENTITY_AUDIT_ROOTS (`;`/`,`/newline-separated path list).
// TRADING_WIKI_ALLOWED_EXTERNAL_SIGNAL_SOURCE_ROOTS (same format) for external signal sources.
const DEFAULT_FINANCE_ENTITY_AUDIT_ROOTS: [&str; 0] = [];
const ALLOWED_EXTERNAL_SIGNAL_SOURCE_ROOTS: [&str; 0] = [];

fn arg_value(args: &[String], name: &str) -> Option<String> {
    args.windows(2)
        .find(|pair| pair[0] == name)
        .map(|pair| pair[1].clone())
}

fn require_arg(args: &[String], name: &str) -> Result<String, String> {
    arg_value(args, name).ok_or_else(|| format!("Missing required {}", name))
}

fn bounded_numeric_arg(value: Option<String>, fallback: &str, max: u32) -> String {
    value
        .and_then(|raw| raw.parse::<u32>().ok())
        .map(|n| n.clamp(1, max).to_string())
        .unwrap_or_else(|| fallback.to_string())
}

fn bounded_text_arg(value: Option<String>, fallback: &str, max_chars: usize) -> String {
    let raw = value.unwrap_or_else(|| fallback.to_string());
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return fallback.to_string();
    }
    trimmed.chars().take(max_chars).collect()
}

fn normalize_path_lexically(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Prefix(prefix) => normalized.push(prefix.as_os_str()),
            Component::RootDir => normalized.push(component.as_os_str()),
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            Component::Normal(part) => normalized.push(part),
        }
    }
    normalized
}

fn resolved_path(path: &Path) -> PathBuf {
    std::fs::canonicalize(path).unwrap_or_else(|_| normalize_path_lexically(path))
}

fn path_is_within(candidate: &Path, root: &Path) -> bool {
    let root_resolved = resolved_path(root);
    let candidate_resolved = resolved_path(candidate);
    candidate_resolved == root_resolved || candidate_resolved.starts_with(&root_resolved)
}

fn split_path_list(raw: &str) -> Vec<String> {
    // Delimiters only — never split on OS path separators (Windows `\` would break paths).
    raw.split(|c: char| c == ';' || c == ',' || c == '\n' || c == '\r')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .collect()
}

fn env_path_list(name: &str) -> Vec<String> {
    std::env::var(name)
        .ok()
        .map(|v| split_path_list(&v))
        .unwrap_or_default()
}

fn allowed_external_signal_source_roots() -> Vec<String> {
    let mut roots = Vec::new();
    for root in ALLOWED_EXTERNAL_SIGNAL_SOURCE_ROOTS {
        roots.push((*root).to_string());
    }
    roots.extend(env_path_list("TRADING_WIKI_ALLOWED_EXTERNAL_SIGNAL_SOURCE_ROOTS"));
    roots
}

fn default_finance_entity_audit_roots() -> Vec<String> {
    let mut roots = Vec::new();
    for root in DEFAULT_FINANCE_ENTITY_AUDIT_ROOTS {
        roots.push((*root).to_string());
    }
    roots.extend(env_path_list("TRADING_WIKI_DEFAULT_FINANCE_ENTITY_AUDIT_ROOTS"));
    roots
}

fn project_bounded_path(project_path: &str, source: &str) -> bool {
    let project = Path::new(project_path);
    let source_path = Path::new(source);
    let candidate = if source_path.is_absolute() {
        source_path.to_path_buf()
    } else {
        project.join(source_path)
    };
    path_is_within(&candidate, project)
        || allowed_external_signal_source_roots()
            .iter()
            .any(|root| path_is_within(&candidate, Path::new(root)))
        || path_is_within(&candidate, &Path::new(project_path).join("raw"))
}

fn bounded_project_source_arg(
    value: Option<String>,
    fallback: &str,
    max_chars: usize,
    project_path: &str,
) -> Result<String, String> {
    let source = bounded_text_arg(value, fallback, max_chars);
    if !project_bounded_path(project_path, &source) {
        return Err("Research Cockpit source path must stay inside the selected project or approved live raw signal roots.".to_string());
    }
    Ok(source)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_project_path() -> String {
        std::env::temp_dir()
            .join("trading-review-wiki-research-cockpit-test")
            .to_string_lossy()
            .into_owned()
    }

    #[test]
    fn research_cockpit_source_path_allows_project_local_sources() {
        let project = temp_project_path();

        let relative = bounded_project_source_arg(
            Some("raw/微信聊天".to_string()),
            "raw/微信聊天",
            240,
            &project,
        )
        .expect("relative project source should be accepted");
        assert_eq!(relative, "raw/微信聊天");

        let absolute_inside = format!("{}/raw/微信聊天", project);
        let absolute = bounded_project_source_arg(
            Some(absolute_inside.clone()),
            "raw/微信聊天",
            240,
            &project,
        )
        .expect("absolute project source should be accepted");
        assert_eq!(absolute, absolute_inside);
    }

    #[test]
    fn research_cockpit_source_path_allows_env_approved_external_raw_roots() {
        let project = temp_project_path();
        let external_root = std::env::temp_dir().join("trading-review-wiki-external-raw-root");
        let _ = std::fs::create_dir_all(&external_root);
        let live_raw = external_root
            .join("openclaw数据")
            .join("产业链复盘")
            .join("gangtise_themes");
        let live_raw_str = live_raw.to_string_lossy().into_owned();

        // SAFETY: test-only env mutation; single-threaded unit tests.
        std::env::set_var(
            "TRADING_WIKI_ALLOWED_EXTERNAL_SIGNAL_SOURCE_ROOTS",
            external_root.to_string_lossy().as_ref(),
        );
        let source = bounded_project_source_arg(
            Some(live_raw_str.clone()),
            "raw/微信聊天",
            240,
            &project,
        );
        std::env::remove_var("TRADING_WIKI_ALLOWED_EXTERNAL_SIGNAL_SOURCE_ROOTS");

        let source = source.expect("env-approved external raw signal source should be accepted");
        assert_eq!(source, live_raw_str);
    }

    #[test]
    fn research_cockpit_source_path_rejects_relative_escape() {
        let project = temp_project_path();
        let err = bounded_project_source_arg(
            Some("../outside.md".to_string()),
            "raw/微信聊天",
            240,
            &project,
        )
        .expect_err("relative parent traversal must be rejected");
        assert!(err.contains("approved live raw signal roots"));
    }

    #[test]
    fn research_cockpit_source_path_rejects_absolute_sibling_prefix() {
        let project = temp_project_path();
        let sibling = format!("{}-sibling/raw/微信聊天", project);
        let err = bounded_project_source_arg(Some(sibling), "raw/微信聊天", 240, &project)
            .expect_err("absolute sibling path must be rejected");
        assert!(err.contains("approved live raw signal roots"));
    }

    #[test]
    fn research_cockpit_source_path_rejects_unapproved_external_raw_sibling_prefix() {
        let project = temp_project_path();
        let external_root = std::env::temp_dir().join("trading-review-wiki-external-raw-root");
        let sibling = external_root
            .join("raw-sibling")
            .join("openclaw数据")
            .join("产业链复盘")
            .join("gangtise_themes");
        let sibling_str = sibling.to_string_lossy().into_owned();

        std::env::set_var(
            "TRADING_WIKI_ALLOWED_EXTERNAL_SIGNAL_SOURCE_ROOTS",
            external_root.join("raw").to_string_lossy().as_ref(),
        );
        let err = bounded_project_source_arg(
            Some(sibling_str),
            "raw/微信聊天",
            240,
            &project,
        );
        std::env::remove_var("TRADING_WIKI_ALLOWED_EXTERNAL_SIGNAL_SOURCE_ROOTS");

        let err = err.expect_err("external raw sibling prefix must be rejected");
        assert!(err.contains("approved live raw signal roots"));
    }

    #[test]
    fn research_cockpit_company_research_whitelist() {
        let project = temp_project_path();
        // GUI panel depends on this exact safe-subset contract. The heavy
        // LLM stages (plugin-review / plugin-led / plugin-optimize) spawn the
        // macOS codex binary and are intentionally excluded; base + --deep
        // reports are template-assembled from CNINFO/Tushare/wiki data.
        let cr = build_allowed_args(
            "company-research",
            &[
                "--stock".into(),
                "600000".into(),
                "--from".into(),
                "2025-01-01".into(),
                "--to".into(),
                "2025-12-31".into(),
                "--cninfo-event-from".into(),
                "2025-01-01".into(),
                "--deep".into(),
            ],
            &project,
        )
        .expect("company-research should be allowed");
        assert_eq!(cr[0..3], ["company-research", "--stock", "600000"]);
        assert!(cr.contains(&"--provider".to_string()));
        assert!(cr.contains(&"--deep".to_string()));
        assert!(cr.contains(&"--from".to_string()));
        assert!(cr.contains(&"--cninfo-event-from".to_string()));
        // Missing --stock must be rejected by the whitelist.
        assert!(build_allowed_args("company-research", &[], &project).is_err());

        // Deep-scope knobs are only forwarded together with --deep.
        let cr_deep = build_allowed_args(
            "company-research",
            &[
                "--stock".into(),
                "600000".into(),
                "--deep".into(),
                "--cninfo-periodic-from".into(),
                "2024-01-01".into(),
                "--top-wiki".into(),
                "15".into(),
                "--top-raw".into(),
                "10".into(),
                "--graph-neighbors".into(),
                "30".into(),
                "--graph-depth".into(),
                "3".into(),
                "--cninfo-download-limit".into(),
                "80".into(),
            ],
            &project,
        )
        .expect("company-research deep should be allowed");
        assert!(cr_deep.contains(&"--cninfo-periodic-from".to_string()));
        assert!(cr_deep.contains(&"--top-wiki".to_string()));
        assert!(cr_deep.contains(&"--top-raw".to_string()));
        assert!(cr_deep.contains(&"--graph-neighbors".to_string()));
        assert!(cr_deep.contains(&"--graph-depth".to_string()));
        assert!(cr_deep.contains(&"--cninfo-download-limit".to_string()));

        // Without --deep the scope knobs must NOT leak through.
        let cr_shallow = build_allowed_args(
            "company-research",
            &[
                "--stock".into(),
                "600000".into(),
                "--top-wiki".into(),
                "15".into(),
            ],
            &project,
        )
        .expect("company-research shallow should be allowed");
        assert!(!cr_shallow.contains(&"--top-wiki".to_string()));
    }

    #[test]
    fn research_cockpit_brain_arm() {
        let project = temp_project_path();
        // Default (no positional) resolves to `status`.
        let status = build_allowed_args("brain", &[], &project).expect("brain status should be allowed");
        assert_eq!(status, vec!["brain".to_string(), "status".to_string()]);

        // Explicit `status` positional is passed through.
        let status_explicit = build_allowed_args("brain", &["status".to_string()], &project)
            .expect("brain status should be allowed");
        assert_eq!(status_explicit, vec!["brain".to_string(), "status".to_string()]);

        // remember requires --type and --text; optional fields forwarded only if present.
        let remember = build_allowed_args(
            "brain",
            &[
                "remember".to_string(),
                "--type".to_string(),
                "strategy".to_string(),
                "--text".to_string(),
                "波段纪律：跌破5日线减半".to_string(),
                "--title".to_string(),
                "交易纪律".to_string(),
                "--tags".to_string(),
                "纪律,止损".to_string(),
            ],
            &project,
        )
        .expect("brain remember should be allowed");
        assert_eq!(remember[0..4], ["brain", "remember", "--type", "strategy"]);
        assert!(remember.contains(&"--text".to_string()));
        assert!(remember.contains(&"--title".to_string()));
        assert!(remember.contains(&"--tags".to_string()));
        // No --status/--source/--related provided => must not appear.
        assert!(!remember.contains(&"--status".to_string()));
        assert!(!remember.contains(&"--source".to_string()));
        assert!(!remember.contains(&"--related".to_string()));

        // remember without required --type must be rejected.
        assert!(build_allowed_args("brain", &["remember".to_string(), "--text".to_string(), "x".to_string()], &project).is_err());

        // resolve requires --id and --result; --note optional.
        let resolve = build_allowed_args(
            "brain",
            &[
                "resolve".to_string(),
                "--id".to_string(),
                "mem_001".to_string(),
                "--result".to_string(),
                "confirmed".to_string(),
                "--note".to_string(),
                "已验证".to_string(),
            ],
            &project,
        )
        .expect("brain resolve should be allowed");
        assert_eq!(resolve[0..2], ["brain", "resolve"]);
        assert!(resolve.contains(&"--id".to_string()));
        assert!(resolve.contains(&"--result".to_string()));
        assert!(resolve.contains(&"--note".to_string()));

        // Unknown subcommand is NOT allow-listed; defaults to status.
        let unknown = build_allowed_args("brain", &["delete-everything".to_string()], &project)
            .expect("brain should default unknown subcommand to status");
        assert_eq!(unknown, vec!["brain".to_string(), "status".to_string()]);
    }

    #[test]
    fn research_cockpit_deep_research_arm() {
        let project = temp_project_path();

        // Missing --topic must error.
        assert!(build_allowed_args("deep-research", &[], &project).is_err());

        // Basic invocation with topic.
        let dr = build_allowed_args(
            "deep-research",
            &["--topic".to_string(), "AI芯片市场趋势".to_string()],
            &project,
        )
        .expect("deep-research with topic should be allowed");
        assert_eq!(dr[0..3], ["deep-research", "--topic", "AI芯片市场趋势"]);
        assert!(dr.contains(&"--provider".to_string()));

        // With write + ingest switches.
        let dw = build_allowed_args(
            "deep-research",
            &[
                "--topic".to_string(), "测试".to_string(),
                "--write".to_string(),
                "--ingest".to_string(),
                "--apply-ingest".to_string(),
                "--include-invalidated".to_string(),
            ],
            &project,
        )
        .expect("deep-research with write switches should be allowed");
        assert!(dw.contains(&"--write".to_string()));
        assert!(dw.contains(&"--ingest".to_string()));
        assert!(dw.contains(&"--apply-ingest".to_string()));
        assert!(dw.contains(&"--include-invalidated".to_string()));

        // With numeric params.
        let dn = build_allowed_args(
            "deep-research",
            &[
                "--topic".to_string(), "test".to_string(),
                "--source-k".to_string(), "5".to_string(),
                "--graph-depth".to_string(), "3".to_string(),
                "--graph-neighbors".to_string(), "10".to_string(),
                "--top-brain".to_string(), "20".to_string(),
            ],
            &project,
        )
        .expect("deep-research with numeric params should be allowed");
        assert!(dn.contains(&"--source-k".to_string()));
        assert!(dn.contains(&"--graph-depth".to_string()));
        assert!(dn.contains(&"--graph-neighbors".to_string()));
        assert!(dn.contains(&"--top-brain".to_string()));
    }

    #[test]
    fn research_cockpit_concepts_arm() {
        let project = temp_project_path();
        // Default audit
        let c = build_allowed_args("concepts", &[], &project).expect("concepts should be allowed");
        assert_eq!(c, vec!["concepts".to_string(), "audit".to_string()]);

        // With --write
        let cw = build_allowed_args(
            "concepts",
            &["audit".to_string(), "--write".to_string()],
            &project,
        )
        .expect("concepts --write should be allowed");
        assert!(cw.contains(&"--write".to_string()));

        // With --top-n
        let cn = build_allowed_args(
            "concepts",
            &["audit".to_string(), "--top-n".to_string(), "50".to_string()],
            &project,
        )
        .expect("concepts --top-n should be allowed");
        assert!(cn.contains(&"--top-n".to_string()));
        assert!(cn.contains(&"50".to_string()));
    }

    #[test]
    fn research_cockpit_temporal_facts_arm() {
        let project = temp_project_path();
        // Default audit
        let t = build_allowed_args("temporal-facts", &[], &project)
            .expect("temporal-facts should be allowed");
        assert_eq!(t, vec!["temporal-facts".to_string(), "audit".to_string()]);

        // With --write
        let tw = build_allowed_args(
            "temporal-facts",
            &["audit".to_string(), "--write".to_string()],
            &project,
        )
        .expect("temporal-facts --write should be allowed");
        assert!(tw.contains(&"--write".to_string()));
    }

    #[test]
    fn research_cockpit_data_engineering_arm() {
        let project = temp_project_path();

        // Missing --task must error.
        assert!(build_allowed_args("data-engineering", &[], &project).is_err());

        // Unknown --task must error.
        assert!(build_allowed_args(
            "data-engineering",
            &["--task".to_string(), "destroy-world".to_string()],
            &project,
        )
        .is_err());

        // prepare
        let prep = build_allowed_args(
            "data-engineering",
            &[
                "--task".to_string(), "prepare".to_string(),
                "--source".to_string(), "/path/to/source".to_string(),
                "--schema".to_string(), "/schema/foo".to_string(),
                "--no-report".to_string(),
            ],
            &project,
        )
        .expect("prepare should be allowed");
        assert_eq!(prep[0..4], ["prepare", "--source", "/path/to/source", "--schema"]);
        assert!(prep.contains(&"--no-report".to_string()));

        // convert-source
        let conv = build_allowed_args(
            "data-engineering",
            &[
                "--task".to_string(), "convert-source".to_string(),
                "--source".to_string(), "/src/report.pdf".to_string(),
                "--overwrite".to_string(),
            ],
            &project,
        )
        .expect("convert-source should be allowed");
        assert_eq!(conv[0..2], ["convert-source", "--source"]);
        assert!(conv.contains(&"/src/report.pdf".to_string()));

        // embeddings status (default)
        let emb = build_allowed_args(
            "data-engineering",
            &["--task".to_string(), "embeddings".to_string()],
            &project,
        )
        .expect("embeddings should be allowed");
        assert_eq!(emb[0..2], ["embeddings", "status"]);

        // api-run with required --source
        let apr = build_allowed_args(
            "data-engineering",
            &[
                "--task".to_string(), "api-run".to_string(),
                "--source".to_string(), "/src/doc.md".to_string(),
                "--judgments".to_string(),
            ],
            &project,
        )
        .expect("api-run should be allowed");
        assert_eq!(apr[0..2], ["api-run", "--source"]);
        assert!(apr.contains(&"--provider".to_string()));

        // finalize with required --report
        let fin = build_allowed_args(
            "data-engineering",
            &[
                "--task".to_string(), "finalize".to_string(),
                "--report".to_string(), "/tmp/rpt".to_string(),
            ],
            &project,
        )
        .expect("finalize should be allowed");
        assert_eq!(fin[0..2], ["finalize", "--report"]);

        // apply
        let app = build_allowed_args(
            "data-engineering",
            &[
                "--task".to_string(), "apply".to_string(),
                "--manifest".to_string(), "/tmp/mf".to_string(),
                "--write".to_string(),
            ],
            &project,
        )
        .expect("apply should be allowed");
        assert_eq!(app[0..2], ["apply", "--manifest"]);
        assert!(app.contains(&"--write".to_string()));

        // batch-run
        let brn = build_allowed_args(
            "data-engineering",
            &[
                "--task".to_string(), "batch-run".to_string(),
                "--sources".to_string(), "/sources/".to_string(),
                "--write".to_string(),
            ],
            &project,
        )
        .expect("batch-run should be allowed");
        assert_eq!(brn[0..2], ["batch-run", "--sources"]);

        // sag-sync
        let sag = build_allowed_args(
            "data-engineering",
            &[
                "--task".to_string(), "sag-sync".to_string(),
            ],
            &project,
        )
        .expect("sag-sync should be allowed");
        assert_eq!(sag[0..2], ["sag-sync", "status"]);

        // hygiene (default audit)
        let hyg = build_allowed_args(
            "data-engineering",
            &["--task".to_string(), "hygiene".to_string()],
            &project,
        )
        .expect("hygiene should be allowed");
        assert_eq!(hyg[0..2], ["hygiene", "audit"]);
    }

    #[test]
    fn research_cockpit_research_os_whitelist() {
        let project = temp_project_path();
        // research-os agent <status|plan|step|review|verify> with positional
        // subcommand tokens and a few flags.
        let ros = build_allowed_args(
            "research-os",
            &[
                "agent".into(),
                "status".into(),
                "--write".into(),
                "--step-id".into(),
                "abc-123".into(),
                "--limit".into(),
                "50".into(),
            ],
            &project,
        )
        .expect("research-os should be allowed");
        assert_eq!(ros[0..3], ["research-os", "agent", "status"]);
        assert!(ros.contains(&"--write".to_string()));
        assert!(ros.contains(&"--step-id".to_string()));
        assert!(ros.contains(&"abc-123".to_string()));
        assert!(ros.contains(&"--limit".to_string()));
        assert!(ros.contains(&"50".to_string()));

        // Unknown positional tokens must be dropped; "agent" is always re-added.
        let ros_bad = build_allowed_args(
            "research-os",
            &["evil".into(), "status".into()],
            &project,
        )
        .expect("research-os should be allowed");
        assert!(!ros_bad.contains(&"evil".to_string()));
        assert!(ros_bad.contains(&"agent".to_string()));
        assert!(ros_bad.contains(&"status".to_string()));
    }

    #[test]
    fn research_cockpit_self_question_whitelist() {
        let project = temp_project_path();
        // GUI panel: recursive self-question loop (ask->validate->attribute trio)
        // with deterministic, DeepSeek-safe options.
        let sq = build_allowed_args(
            "self-question",
            &[
                "--stages".into(),
                "generate,validate,attribute".into(),
                "--question-count".into(),
                "3".into(),
                "--market-validate".into(),
                "xueqiu".into(),
                "--self-train-write".into(),
                "--write".into(),
            ],
            &project,
        )
        .expect("self-question should be allowed");
        assert_eq!(sq[0..3], ["self-question", "loop", "--stages"]);
        assert!(sq.contains(&"--market-validate".to_string()));
        assert!(sq.contains(&"--allow-anchored-external-market".to_string()));
        // Hardcoded DeepSeek-safe planner disable.
        assert!(sq.contains(&"--no-llm-question-planner".to_string()));
        assert!(sq.contains(&"--provider".to_string()));
        assert!(sq.contains(&"--self-train-write".to_string()));
        assert!(sq.contains(&"--write".to_string()));

        // Unknown market-validate value falls back to xueqiu.
        let sq_bad = build_allowed_args(
            "self-question",
            &["--market-validate".into(), "bogus".into()],
            &project,
        )
        .expect("self-question should still be allowed");
        let mv_idx = sq_bad.iter().position(|a| a == "--market-validate").unwrap();
        assert_eq!(sq_bad[mv_idx + 1], "xueqiu");

        // --write / --self-train-write are conditional and absent by default.
        let sq_dry = build_allowed_args(
            "self-question",
            &["--stages".into(), "generate,validate".into()],
            &project,
        )
        .expect("self-question dry should be allowed");
        assert!(!sq_dry.contains(&"--write".to_string()));
        assert!(!sq_dry.contains(&"--self-train-write".to_string()));
    }

    #[test]
    fn research_cockpit_builds_lite_allowlisted_actions() {
        let project = temp_project_path();
        let discover = build_allowed_args(
            "hypothesis-discover-dry-run",
            &[
                "--theme".into(),
                "AI数据中心互联".into(),
                "--question-count".into(),
                "3".into(),
                "--concurrency".into(),
                "2".into(),
            ],
            &project,
        )
        .expect("discover action should be allowed");
        assert_eq!(discover[0..4], ["hypothesis", "discover", "--theme", "AI数据中心互联"]);
        assert!(discover.contains(&"--provider".to_string()));
        assert!(discover.contains(&"codex".to_string()));

        let status = build_allowed_args(
            "hypothesis-status-update-write",
            &[
                "--id".into(),
                "hypo_demo".into(),
                "--status".into(),
                "strengthening".into(),
                "--reason".into(),
                "人工确认".into(),
                "--ask-run-ref".into(),
                ".llm-wiki/agent-runs/20260617-122000-ask/manifest.json".into(),
            ],
            &project,
        )
        .expect("status update action should be allowed");
        assert_eq!(status[0..5], ["hypothesis", "status-update", "--id", "hypo_demo", "--status"]);
        assert!(status.contains(&"--write".to_string()));
        assert!(status.contains(&"--ask-run-ref".to_string()));
        assert!(status.contains(&".llm-wiki/agent-runs/20260617-122000-ask/manifest.json".to_string()));

        let feedback = build_allowed_args(
            "hypothesis-evidence-feedback-dry-run",
            &["--id".into(), "hypo_demo".into(), "--limit".into(), "20".into()],
            &project,
        )
        .expect("hypothesis evidence feedback should be allowed");
        assert_eq!(feedback[0..2], ["hypothesis", "evidence-feedback"]);
        assert!(feedback.contains(&"hypo_demo".to_string()));
        assert!(!feedback.contains(&"--write".to_string()));

        let feedback_write = build_allowed_args(
            "hypothesis-evidence-feedback-write",
            &["--hypothesis-id".into(), "hypo_demo".into()],
            &project,
        )
        .expect("hypothesis evidence feedback write should be allowed");
        assert_eq!(feedback_write[0..2], ["hypothesis", "evidence-feedback"]);
        assert!(feedback_write.contains(&"--write".to_string()));

        let post_mortem = build_allowed_args(
            "hypothesis-post-mortem-write",
            &["--id".into(), "hypo_demo".into()],
            &project,
        )
        .expect("hypothesis post-mortem should be allowed");
        assert_eq!(post_mortem[0..2], ["hypothesis", "post-mortem"]);
        assert!(post_mortem.contains(&"--write".to_string()));

        let hypothesis_verify = build_allowed_args("hypothesis-verify", &[], &project)
            .expect("hypothesis verify should be allowed");
        assert_eq!(hypothesis_verify[0..2], ["hypothesis", "verify"]);

        let ask = build_allowed_args(
            "hypothesis-ask",
            &["--id".into(), "hypo_demo".into()],
            &project,
        )
        .expect("hypothesis ask action should be allowed");
        assert_eq!(ask[0..4], ["hypothesis", "ask", "--id", "hypo_demo"]);
        assert!(ask.contains(&"--agentic".to_string()));
        assert!(ask.contains(&"local-max".to_string()));

        let precheck = build_allowed_args(
            "candidate-ask-precheck",
            &[
                "--query".into(),
                "候选假设预检".into(),
                "--agent-concurrency".into(),
                "2".into(),
                "--sources".into(),
                "wiki,raw,graph".into(),
                "--source-k".into(),
                "5".into(),
            ],
            &project,
        )
        .expect("candidate ask precheck should be allowed");
        assert_eq!(precheck[0..3], ["ask", "--query", "候选假设预检"]);
        assert!(precheck.contains(&"--agentic".to_string()));
        assert!(precheck.contains(&"--show-context".to_string()));
        assert!(precheck.contains(&"--show-sources".to_string()));
        assert!(precheck.contains(&"--sources".to_string()));
        assert!(precheck.contains(&"wiki,raw,graph".to_string()));
        assert!(precheck.contains(&"--source-k".to_string()));
        assert!(precheck.contains(&"5".to_string()));
        assert!(precheck.contains(&"--no-agent-artifacts".to_string()));

        let sources = build_allowed_args(
            "wechat-source-list",
            &[
                "--source".into(),
                "raw/微信聊天".into(),
                "--limit".into(),
                "20".into(),
            ],
            &project,
        )
        .expect("wechat source list action should be allowed");
        assert_eq!(sources[0..4], ["hypothesis", "wechat-inbox", "sources", "--source"]);
        assert!(sources.contains(&"--limit".to_string()));

        // daily-loop: the GUI panel depends on this exact contract.
        let daily_loop = build_allowed_args(
            "daily-loop",
            &[
                "--mode".into(),
                "premarket".into(),
                "--question-count".into(),
                "2".into(),
                "--write".into(),
            ],
            &project,
        )
        .expect("daily-loop should be allowed");
        assert_eq!(daily_loop[0..3], ["daily-loop", "--mode", "premarket"]);
        assert!(daily_loop.contains(&"--write".to_string()));
        // DeepSeek/OpenAI-compatible endpoints lack /v1/responses.
        assert!(daily_loop.contains(&"--no-llm-question-planner".to_string()));
        // Xueqiu is the default: it is the only source that stays complete
        // (amount + turnover) under the panel's concurrency without rate-limiting.
        let mv_idx = daily_loop
            .iter()
            .position(|a| a == "--market-validate")
            .expect("--market-validate must be forwarded");
        assert_eq!(daily_loop[mv_idx + 1], "xueqiu");
        // Explicit alternates must survive the whitelist.
        for source in ["eastmoney", "tencent", "auto", "off"] {
            let forwarded = build_allowed_args(
                "daily-loop",
                &["--market-validate".into(), source.into()],
                &project,
            )
            .expect("daily-loop should be allowed");
            let idx = forwarded
                .iter()
                .position(|a| a == "--market-validate")
                .expect("--market-validate must be forwarded");
            assert_eq!(forwarded[idx + 1], source);
        }
        // Unknown values must fall back to xueqiu rather than leaking through.
        let daily_loop_bad = build_allowed_args(
            "daily-loop",
            &["--market-validate".into(), "bogus-source".into()],
            &project,
        )
        .expect("daily-loop should be allowed");
        let bad_idx = daily_loop_bad
            .iter()
            .position(|a| a == "--market-validate")
            .expect("--market-validate must be forwarded");
        assert_eq!(daily_loop_bad[bad_idx + 1], "xueqiu");

        // (company-research whitelist contract is now covered by the dedicated
        //  research_cockpit_company_research_whitelist test below, since this
        //  large test panics earlier on Windows at the `codex` containment
        //  assertions and never reaches this point.)

        let observation = build_allowed_args(
            "observation-draft-write",
            &[
                "--title".into(),
                "CPO放缓推动MPO观察".into(),
                "--stocks".into(),
                "太辰光,天孚通信".into(),
                "--wiki-frame-source-ref".into(),
                "wiki/概念/AI数据中心互联.md".into(),
            ],
            &project,
        )
        .expect("observation draft write should be allowed");
        assert_eq!(observation[0..2], ["hypothesis", "observation-draft"]);
        assert!(observation.contains(&"--write".to_string()));

        let observation_list = build_allowed_args(
            "observation-draft-list",
            &["--date".into(), "2026-06-20".into(), "--limit".into(), "5".into()],
            &project,
        )
        .expect("observation draft list should be allowed");
        assert_eq!(observation_list[0..2], ["hypothesis", "observation-drafts"]);
        assert!(observation_list.contains(&"--date".to_string()));
        assert!(!observation_list.contains(&"--write".to_string()));

        let watch = build_allowed_args(
            "watch-dry-run",
            &[
                "--since".into(),
                "30m".into(),
                "--sources".into(),
                "wechat_incremental".into(),
                "--llm-review".into(),
                "auto".into(),
                "--llm-review-max-items".into(),
                "8".into(),
                "--compact".into(),
            ],
            &project,
        )
        .expect("watch action should allow bounded llm review");
        assert_eq!(watch[0..6], ["hypothesis", "watch", "--since", "30m", "--sources", "wechat_incremental"]);
        assert!(watch.contains(&"--llm-review".to_string()));
        assert!(watch.contains(&"auto".to_string()));
        assert!(watch.contains(&"--compact".to_string()));
        assert!(watch.contains(&"--provider".to_string()));
        assert!(watch.contains(&"codex".to_string()));

        let force_review = build_allowed_args(
            "watch-dry-run",
            &[
                "--since".into(),
                "30m".into(),
                "--sources".into(),
                "wechat_incremental".into(),
                "--llm-review".into(),
                "force".into(),
                "--llm-review-max-items".into(),
                "12".into(),
                "--compact".into(),
            ],
            &project,
        )
        .expect("watch action should allow explicit LLM review");
        assert!(force_review.contains(&"--llm-review".to_string()));
        assert!(force_review.contains(&"force".to_string()));

        let stock_status = build_allowed_args("stock-feedback-status", &[], &project)
            .expect("stock feedback status should be allowed");
        assert_eq!(stock_status[0..2], ["stock-feedback", "status"]);

        let evidence_task_create = build_allowed_args(
            "stock-feedback-evidence-task-create-write",
            &[
                "--stock-code".into(),
                "300750.SZ".into(),
                "--stock-name".into(),
                "宁德时代".into(),
                "--task-type".into(),
                "market_data".into(),
                "--target-fields".into(),
                "close,turnover_rate".into(),
                "--source".into(),
                "hypothesis".into(),
                "--preferred-sources".into(),
                "tushare,web".into(),
                "--source-refs".into(),
                "hypothesis:h1".into(),
            ],
            &project,
        )
        .expect("stock feedback evidence task create should be allowlisted");
        assert_eq!(evidence_task_create[0..3], ["stock-feedback", "evidence-task", "create"]);
        assert!(evidence_task_create.contains(&"--stock-code".to_string()));
        assert!(evidence_task_create.contains(&"300750.SZ".to_string()));
        assert!(evidence_task_create.contains(&"--target-fields".to_string()));
        assert!(evidence_task_create.contains(&"close,turnover_rate".to_string()));
        assert!(evidence_task_create.contains(&"--write".to_string()));

        let evidence_task_list = build_allowed_args(
            "stock-feedback-evidence-task-list",
            &[
                "--status".into(),
                "awaiting-review".into(),
                "--task-type".into(),
                "../../market_data".into(),
                "--limit".into(),
                "40".into(),
            ],
            &project,
        )
        .expect("stock feedback evidence task list should be allowlisted");
        assert_eq!(evidence_task_list[0..3], ["stock-feedback", "evidence-task", "list"]);
        assert!(evidence_task_list.contains(&"--status".to_string()));
        assert!(evidence_task_list.contains(&"awaiting_review".to_string()));
        assert!(evidence_task_list.contains(&"--task-type".to_string()));
        assert!(evidence_task_list.contains(&"general".to_string()));

        let evidence_task_show = build_allowed_args(
            "stock-feedback-evidence-task-show",
            &["--task-id".into(), "ET-20260621-demo".into()],
            &project,
        )
        .expect("stock feedback evidence task show should be allowlisted");
        assert_eq!(evidence_task_show[0..3], ["stock-feedback", "evidence-task", "show"]);
        assert!(evidence_task_show.contains(&"ET-20260621-demo".to_string()));

        let evidence_queue_run = build_allowed_args(
            "stock-feedback-run-task-queue-write",
            &[
                "--task-id".into(),
                "ET-20260621-demo".into(),
                "--limit".into(),
                "3".into(),
            ],
            &project,
        )
        .expect("stock feedback run task queue should be allowlisted");
        assert_eq!(evidence_queue_run[0..2], ["stock-feedback", "run-task-queue"]);
        assert!(evidence_queue_run.contains(&"--write".to_string()));

        let evidence_result_list = build_allowed_args(
            "stock-feedback-evidence-result-list",
            &[
                "--status".into(),
                "awaiting_review".into(),
                "--task-id".into(),
                "ET-20260621-demo".into(),
            ],
            &project,
        )
        .expect("stock feedback evidence result list should be allowlisted");
        assert_eq!(evidence_result_list[0..3], ["stock-feedback", "evidence-result", "list"]);
        assert!(evidence_result_list.contains(&"awaiting_review".to_string()));

        let evidence_result_review = build_allowed_args(
            "stock-feedback-evidence-result-review-write",
            &[
                "--result-id".into(),
                "ER-demo".into(),
                "--action".into(),
                "../../approve".into(),
                "--note".into(),
                "证据不足，继续补证".into(),
            ],
            &project,
        )
        .expect("stock feedback evidence result review should be allowlisted");
        assert_eq!(evidence_result_review[0..3], ["stock-feedback", "evidence-result", "review"]);
        assert!(evidence_result_review.contains(&"needs_more_evidence".to_string()));
        assert!(evidence_result_review.contains(&"--write".to_string()));

        let source_status = build_allowed_args("stock-feedback-source-status", &[], &project)
            .expect("stock feedback source status should be allowed");
        assert_eq!(source_status[0..2], ["stock-feedback", "source-status"]);

        let dlq_list = build_allowed_args(
            "stock-feedback-dlq-list",
            &["--status".into(), "all".into(), "--limit".into(), "30".into()],
            &project,
        )
        .expect("stock feedback dlq list should be allowlisted");
        assert_eq!(dlq_list[0..3], ["stock-feedback", "dlq", "list"]);
        assert!(dlq_list.contains(&"all".to_string()));

        let dlq_retry = build_allowed_args(
            "stock-feedback-dlq-retry-write",
            &[
                "--dlq-id".into(),
                "stockfb_evidence_dlq_demo".into(),
                "--note".into(),
                "source recovered".into(),
            ],
            &project,
        )
        .expect("stock feedback dlq retry should be allowlisted");
        assert_eq!(dlq_retry[0..3], ["stock-feedback", "dlq", "retry"]);
        assert!(dlq_retry.contains(&"--write".to_string()));

        let dlq_discard = build_allowed_args(
            "stock-feedback-dlq-discard-write",
            &[
                "--task-id".into(),
                "ET-20260621-demo".into(),
                "--note".into(),
                "duplicate".into(),
            ],
            &project,
        )
        .expect("stock feedback dlq discard should be allowlisted");
        assert_eq!(dlq_discard[0..3], ["stock-feedback", "dlq", "discard"]);
        assert!(dlq_discard.contains(&"--write".to_string()));

        let tushare_probe = build_allowed_args(
            "data-source-tushare-probe",
            &[
                "--stock-code".into(),
                "SZ300901".into(),
                "--trade-date".into(),
                "2026-06-04".into(),
                "--tushare-timeout-ms".into(),
                "15000".into(),
            ],
            &project,
        )
        .expect("Tushare data source probe should be allowed");
        assert_eq!(tushare_probe[0..2], ["data-source", "tushare-probe"]);
        assert!(tushare_probe.contains(&"--stock-code".to_string()));
        assert!(tushare_probe.contains(&"SZ300901".to_string()));
        assert!(tushare_probe.contains(&"--trade-date".to_string()));
        assert!(tushare_probe.contains(&"2026-06-04".to_string()));
        assert!(tushare_probe.contains(&"--tushare-timeout-ms".to_string()));
        assert!(tushare_probe.contains(&"15000".to_string()));

        let stock_paper_trade_agent = build_allowed_args(
            "stock-feedback-paper-trade-agent-dry-run",
            &["--limit".into(), "12".into()],
            &project,
        )
        .expect("stock feedback paper trade agent should be allowed");
        assert_eq!(stock_paper_trade_agent[0..3], ["stock-feedback", "paper-trade-agent", "candidates"]);
        assert!(!stock_paper_trade_agent.contains(&"--write".to_string()));

        let stock_paper_trade_agent_write = build_allowed_args(
            "stock-feedback-paper-trade-agent-write",
            &["--limit".into(), "12".into()],
            &project,
        )
        .expect("stock feedback paper trade agent write should be allowed");
        assert_eq!(stock_paper_trade_agent_write[0..3], ["stock-feedback", "paper-trade-agent", "candidates"]);
        assert!(stock_paper_trade_agent_write.contains(&"--write".to_string()));

        let stock_paper_trade_status = build_allowed_args(
            "stock-feedback-paper-trade-status",
            &["--limit".into(), "15".into()],
            &project,
        )
        .expect("stock feedback paper trade status should be allowed");
        assert_eq!(stock_paper_trade_status[0..3], ["stock-feedback", "paper-trade", "status"]);
        assert!(stock_paper_trade_status.contains(&"--limit".to_string()));
        assert!(stock_paper_trade_status.contains(&"15".to_string()));

        let stock_paper_trade_discretionary_review = build_allowed_args(
            "stock-feedback-paper-trade-discretionary-review",
            &["--limit".into(), "6".into()],
            &project,
        )
        .expect("stock feedback paper trade discretionary review should be allowlisted");
        assert_eq!(stock_paper_trade_discretionary_review[0..3], ["stock-feedback", "paper-trade", "discretionary-review"]);
        assert!(stock_paper_trade_discretionary_review.contains(&"--limit".to_string()));
        assert!(stock_paper_trade_discretionary_review.contains(&"6".to_string()));
        assert!(!stock_paper_trade_discretionary_review.contains(&"--write".to_string()));

        let stock_paper_trade_record = build_allowed_args(
            "stock-feedback-paper-trade-record-write",
            &[
                "--track".into(),
                "llm_discretionary".into(),
                "--stock-code".into(),
                "SZ300901".into(),
                "--as-of-date".into(),
                "2026-06-03".into(),
                "--entry-date".into(),
                "2026-06-03".into(),
                "--entry-price".into(),
                "10.00".into(),
                "--exit-date".into(),
                "2026-06-06".into(),
                "--exit-price".into(),
                "10.80".into(),
                "--source-refs".into(),
                "self-question:question_asof_001".into(),
                "--evidence-refs".into(),
                "price-sql:SZ300901:asof-2026-06-03".into(),
                "--auto-market-evidence".into(),
                "--market-evidence-provider".into(),
                "tushare".into(),
                "--market-evidence-benchmark-code".into(),
                "000001.SH".into(),
                "--auto-microstructure-evidence".into(),
                "--follow-through-3d".into(),
                "6.2".into(),
            ],
            &project,
        )
        .expect("stock feedback paper trade record should be allowlisted");
        assert_eq!(stock_paper_trade_record[0..3], ["stock-feedback", "paper-trade", "record"]);
        assert!(stock_paper_trade_record.contains(&"--as-of-date".to_string()));
        assert!(stock_paper_trade_record.contains(&"2026-06-03".to_string()));
        assert!(stock_paper_trade_record.contains(&"--auto-market-evidence".to_string()));
        assert!(stock_paper_trade_record.contains(&"--market-evidence-provider".to_string()));
        assert!(stock_paper_trade_record.contains(&"tushare".to_string()));
        assert!(stock_paper_trade_record.contains(&"--market-evidence-benchmark-code".to_string()));
        assert!(stock_paper_trade_record.contains(&"000001.SH".to_string()));
        assert!(stock_paper_trade_record.contains(&"--auto-microstructure-evidence".to_string()));
        assert!(stock_paper_trade_record.contains(&"--follow-through-3d".to_string()));
        assert!(stock_paper_trade_record.contains(&"6.2".to_string()));
        assert!(stock_paper_trade_record.contains(&"--write".to_string()));

        let stock_paper_trade_settle = build_allowed_args(
            "stock-feedback-paper-trade-settle-write",
            &[
                "--paper-trade-id".into(),
                "stockfb_paper_trade_001".into(),
                "--exit-date".into(),
                "2026-06-06".into(),
                "--exit-price".into(),
                "10.80".into(),
                "--exit-reason".into(),
                "规则目标达到后止盈".into(),
                "--evidence-refs".into(),
                "price-sql:SZ300901:exit-2026-06-06".into(),
                "--auto-market-evidence".into(),
                "--market-evidence-provider".into(),
                "tushare".into(),
            ],
            &project,
        )
        .expect("stock feedback paper trade settlement should be allowlisted");
        assert_eq!(stock_paper_trade_settle[0..3], ["stock-feedback", "paper-trade", "settle"]);
        assert!(stock_paper_trade_settle.contains(&"--paper-trade-id".to_string()));
        assert!(stock_paper_trade_settle.contains(&"stockfb_paper_trade_001".to_string()));
        assert!(stock_paper_trade_settle.contains(&"--exit-date".to_string()));
        assert!(stock_paper_trade_settle.contains(&"2026-06-06".to_string()));
        assert!(stock_paper_trade_settle.contains(&"--exit-price".to_string()));
        assert!(stock_paper_trade_settle.contains(&"10.80".to_string()));
        assert!(stock_paper_trade_settle.contains(&"--auto-market-evidence".to_string()));
        assert!(stock_paper_trade_settle.contains(&"--write".to_string()));

        let stock_build = build_allowed_args("stock-feedback-build-write", &[], &project)
            .expect("stock feedback build should be allowed");
        assert_eq!(stock_build[0..2], ["stock-feedback", "build-trajectories"]);
        assert!(stock_build.contains(&"--write".to_string()));

        let stock_list = build_allowed_args(
            "stock-feedback-list",
            &[
                "--validation-target".into(),
                "expectation_trade".into(),
                "--quality-gate".into(),
                "expectation_validated".into(),
                "--stock".into(),
                "SZ300502".into(),
                "--market-pattern".into(),
                "low_absorption_breakout".into(),
                "--limit".into(),
                "20".into(),
            ],
            &project,
        )
        .expect("stock feedback list should be allowed");
        assert_eq!(stock_list[0..2], ["stock-feedback", "list"]);
        assert!(stock_list.contains(&"--validation-target".to_string()));
        assert!(stock_list.contains(&"expectation_trade".to_string()));
        assert!(stock_list.contains(&"--market-pattern".to_string()));
        assert!(stock_list.contains(&"low_absorption_breakout".to_string()));

        let stock_export = build_allowed_args(
            "stock-feedback-export-lora-ready",
            &["--quality-gate".into(), "high_confidence".into()],
            &project,
        )
        .expect("stock feedback export should be allowed");
        assert_eq!(stock_export[0..2], ["stock-feedback", "export-lora-ready"]);
        assert!(stock_export.contains(&"--write".to_string()));

        let stock_review_queue = build_allowed_args("stock-feedback-review-queue", &[], &project)
            .expect("stock feedback review queue should be allowed");
        assert_eq!(stock_review_queue[0..2], ["stock-feedback", "review-queue"]);
        let include_reviewed_idx = stock_review_queue
            .iter()
            .position(|arg| arg == "--include-reviewed")
            .expect("review queue should include reviewed rows for UI continuity");
        assert_eq!(stock_review_queue.get(include_reviewed_idx + 1), Some(&"true".to_string()));

        let stock_review = build_allowed_args(
            "stock-feedback-review-write",
            &[
                "--trajectory-id".into(),
                "stockfb_demo".into(),
                "--action".into(),
                "approve_for_adapter".into(),
                "--reviewer".into(),
                "human".into(),
                "--note".into(),
                "确认进入训练".into(),
            ],
            &project,
        )
        .expect("stock feedback review write should be allowed");
        assert_eq!(stock_review[0..2], ["stock-feedback", "review"]);
        assert!(stock_review.contains(&"--write".to_string()));
        assert!(stock_review.contains(&"approve_for_adapter".to_string()));

        let stock_paper_review = build_allowed_args(
            "stock-feedback-review-write",
            &[
                "--trajectory-id".into(),
                "stockfb_paper_demo".into(),
                "--action".into(),
                "approve_paper_adapter_candidate".into(),
                "--reviewer".into(),
                "human".into(),
            ],
            &project,
        )
        .expect("stock feedback paper adapter review write should be allowed");
        assert_eq!(stock_paper_review[0..2], ["stock-feedback", "review"]);
        assert!(stock_paper_review.contains(&"--write".to_string()));
        assert!(stock_paper_review.contains(&"approve_paper_adapter_candidate".to_string()));

        let unsafe_stock_review = build_allowed_args(
            "stock-feedback-review-write",
            &[
                "--trajectory-id".into(),
                "stockfb_demo".into(),
                "--action".into(),
                "../../shell".into(),
            ],
            &project,
        )
        .expect("unsafe stock feedback review action should be sanitized");
        assert!(unsafe_stock_review.contains(&"route_to_eval".to_string()));

        let stock_collection_task = build_allowed_args(
            "stock-feedback-collection-task-write",
            &[
                "--market-pattern".into(),
                "fundamental_closure_confirmation".into(),
            ],
            &project,
        )
        .expect("stock feedback collection task write should be allowed");
        assert_eq!(stock_collection_task[0..2], ["stock-feedback", "collection-task"]);
        assert!(stock_collection_task.contains(&"--market-pattern".to_string()));
        assert!(stock_collection_task.contains(&"fundamental_closure_confirmation".to_string()));
        assert!(stock_collection_task.contains(&"--write".to_string()));

        let stock_profit_credit_task = build_allowed_args(
            "stock-feedback-collection-task-write",
            &[
                "--profit-credit".into(),
                "execution_risk_negative".into(),
            ],
            &project,
        )
        .expect("stock feedback profit credit collection task write should be allowed");
        assert_eq!(stock_profit_credit_task[0..2], ["stock-feedback", "collection-task"]);
        assert!(stock_profit_credit_task.contains(&"--profit-credit".to_string()));
        assert!(stock_profit_credit_task.contains(&"execution_risk_negative".to_string()));
        assert!(stock_profit_credit_task.contains(&"--write".to_string()));

        let unsafe_profit_credit_task = build_allowed_args(
            "stock-feedback-collection-task-write",
            &[
                "--profit-credit".into(),
                "../../pattern_execution_supported".into(),
            ],
            &project,
        )
        .expect("unsafe stock feedback profit credit should be sanitized away");
        assert!(!unsafe_profit_credit_task.contains(&"--profit-credit".to_string()));

        let stock_collection_result = build_allowed_args(
            "stock-feedback-collection-result-write",
            &[
                "--market-pattern".into(),
                "fundamental_closure_confirmation".into(),
                "--result".into(),
                "confirmed".into(),
                "--evidence-refs".into(),
                "retrieval:cninfo/demo,price-sql:SZ300001".into(),
                "--summary".into(),
                "人工确认".into(),
            ],
            &project,
        )
        .expect("stock feedback collection result write should be allowed");
        assert_eq!(stock_collection_result[0..2], ["stock-feedback", "collection-result"]);
        assert!(stock_collection_result.contains(&"--result".to_string()));
        assert!(stock_collection_result.contains(&"confirmed".to_string()));
        assert!(stock_collection_result.contains(&"--write".to_string()));

        let stock_profit_credit_result = build_allowed_args(
            "stock-feedback-collection-result-write",
            &[
                "--profit-credit".into(),
                "failed_expectation_negative".into(),
                "--result".into(),
                "insufficient".into(),
            ],
            &project,
        )
        .expect("stock feedback profit credit collection result should be allowed");
        assert_eq!(stock_profit_credit_result[0..2], ["stock-feedback", "collection-result"]);
        assert!(stock_profit_credit_result.contains(&"--profit-credit".to_string()));
        assert!(stock_profit_credit_result.contains(&"failed_expectation_negative".to_string()));
        assert!(stock_profit_credit_result.contains(&"--write".to_string()));
    }
}

fn sanitize_stage_list(value: Option<String>, fallback: &str) -> String {
    let allowed = [
        "generate",
        "validate",
        "attribute",
        "evidence",
        "policy",
        "self-train",
        "self-train-plan",
        "export",
    ];
    let raw = value.unwrap_or_else(|| fallback.to_string());
    let stages: Vec<&str> = raw
        .split(',')
        .map(|item| item.trim())
        .filter(|item| allowed.contains(item))
        .collect();
    if stages.is_empty() {
        fallback.to_string()
    } else {
        stages.join(",")
    }
}

fn sanitize_stock_feedback_review_action(value: Option<String>) -> String {
    match value
        .unwrap_or_else(|| "route_to_eval".to_string())
        .trim()
    {
        "approve_for_adapter" | "approve" => "approve_for_adapter".to_string(),
        "approve_paper_adapter_candidate" | "paper_adapter" | "paper_approve" | "approve_paper" => {
            "approve_paper_adapter_candidate".to_string()
        }
        "route_to_eval" | "eval" => "route_to_eval".to_string(),
        "route_to_preference" | "preference" => "route_to_preference".to_string(),
        "route_to_sft" | "sft" => "route_to_sft".to_string(),
        "needs_evidence" | "needs-evidence" => "needs_evidence".to_string(),
        "reject_for_adapter" | "reject" => "reject_for_adapter".to_string(),
        "mark_entry_wrong" | "entry_wrong" => "mark_entry_wrong".to_string(),
        "mark_priced_in" | "priced_in" => "mark_priced_in".to_string(),
        _ => "route_to_eval".to_string(),
    }
}

fn sanitize_stock_feedback_collection_result(value: Option<String>) -> String {
    match value
        .unwrap_or_else(|| "insufficient".to_string())
        .trim()
    {
        "confirmed" | "confirm" | "ok" => "confirmed".to_string(),
        "refuted" | "refute" | "reject" => "refuted".to_string(),
        "insufficient" | "pending" | "needs_more_evidence" => "insufficient".to_string(),
        _ => "insufficient".to_string(),
    }
}

fn sanitize_stock_feedback_validation_target(value: Option<String>) -> String {
    match value
        .unwrap_or_else(|| "expectation_trade".to_string())
        .trim()
    {
        "expectation_trade" | "expectation" | "trade" => "expectation_trade".to_string(),
        "fundamental_closure" | "fundamental" => "fundamental_closure".to_string(),
        "priced_in_risk" | "priced_in" => "priced_in_risk".to_string(),
        "disconfirmation" | "disconfirmed" => "disconfirmation".to_string(),
        _ => "expectation_trade".to_string(),
    }
}

fn sanitize_stock_feedback_paper_trade_track(value: Option<String>) -> String {
    match value
        .unwrap_or_else(|| "rule_baseline".to_string())
        .trim()
    {
        "rule_baseline" | "rule" | "baseline" => "rule_baseline".to_string(),
        "llm_discretionary" | "llm" | "agent" => "llm_discretionary".to_string(),
        _ => "rule_baseline".to_string(),
    }
}

fn sanitize_stock_feedback_paper_trade_status(value: Option<String>) -> String {
    match value.unwrap_or_default().trim() {
        "open" | "holding" => "open".to_string(),
        "closed" | "close" => "closed".to_string(),
        "cancelled" | "canceled" | "cancel" => "cancelled".to_string(),
        _ => "".to_string(),
    }
}

fn sanitize_stock_feedback_profit_credit(value: Option<String>) -> String {
    match value.unwrap_or_default().trim() {
        "pattern_execution_supported" | "profitable" | "positive" => {
            "pattern_execution_supported".to_string()
        }
        "execution_risk_negative" | "entry_risk" | "loss" => {
            "execution_risk_negative".to_string()
        }
        "failed_expectation_negative" | "failed_expectation" | "disconfirmed" => {
            "failed_expectation_negative".to_string()
        }
        _ => "".to_string(),
    }
}

fn sanitize_stock_feedback_evidence_task_status(value: Option<String>) -> String {
    match value.unwrap_or_default().trim() {
        "pending" => "pending".to_string(),
        "running" => "running".to_string(),
        "awaiting_review" | "awaiting-review" => "awaiting_review".to_string(),
        "completed" | "complete" => "completed".to_string(),
        "failed" | "fail" => "failed".to_string(),
        "dlq" => "dlq".to_string(),
        _ => "".to_string(),
    }
}

fn sanitize_stock_feedback_evidence_result_status(value: Option<String>) -> String {
    match value.unwrap_or_default().trim() {
        "completed" | "complete" => "completed".to_string(),
        "awaiting_review" | "awaiting-review" => "awaiting_review".to_string(),
        "rejected" | "reject" => "rejected".to_string(),
        "failed" | "fail" => "failed".to_string(),
        _ => "".to_string(),
    }
}

fn sanitize_stock_feedback_evidence_task_source(value: Option<String>) -> String {
    match value
        .unwrap_or_else(|| "manual".to_string())
        .trim()
    {
        "hypothesis" => "hypothesis".to_string(),
        "self_question" | "self-question" => "self_question".to_string(),
        "stock_feedback" | "stock-feedback" => "stock_feedback".to_string(),
        "manual" => "manual".to_string(),
        _ => "manual".to_string(),
    }
}

fn sanitize_stock_feedback_evidence_task_type(value: Option<String>) -> String {
    match value
        .unwrap_or_else(|| "general".to_string())
        .trim()
    {
        "financial_metrics" | "financial-metrics" => "financial_metrics".to_string(),
        "announcement" => "announcement".to_string(),
        "market_data" | "market-data" => "market_data".to_string(),
        "tenders" => "tenders".to_string(),
        "institutional_flow" | "institutional-flow" => "institutional_flow".to_string(),
        "limit_up_analysis" | "limit-up-analysis" => "limit_up_analysis".to_string(),
        "general" => "general".to_string(),
        _ => "general".to_string(),
    }
}

fn sanitize_stock_feedback_evidence_priority(value: Option<String>) -> String {
    match value
        .unwrap_or_else(|| "normal".to_string())
        .trim()
    {
        "high" => "high".to_string(),
        "low" => "low".to_string(),
        "normal" => "normal".to_string(),
        _ => "normal".to_string(),
    }
}

fn sanitize_stock_feedback_evidence_review_action(value: Option<String>) -> String {
    match value
        .unwrap_or_else(|| "needs_more_evidence".to_string())
        .trim()
    {
        "approve" | "approved" => "approve".to_string(),
        "reject" | "rejected" => "reject".to_string(),
        "needs_more_evidence" | "needs-more-evidence" | "needs_evidence" => {
            "needs_more_evidence".to_string()
        }
        _ => "needs_more_evidence".to_string(),
    }
}

fn sanitize_stock_feedback_dlq_status(value: Option<String>) -> String {
    match value
        .unwrap_or_else(|| "open".to_string())
        .trim()
    {
        "open" => "open".to_string(),
        "retried" => "retried".to_string(),
        "discarded" => "discarded".to_string(),
        "all" => "all".to_string(),
        _ => "open".to_string(),
    }
}

fn append_default_finance_entity_audit_roots(cli_args: &mut Vec<String>) {
    let existing = cli_args
        .windows(2)
        .any(|pair| pair[0] == "--finance-entity-audit-roots");
    if existing {
        return;
    }
    let roots = default_finance_entity_audit_roots()
        .into_iter()
        .filter(|root| Path::new(root).is_dir())
        .collect::<Vec<_>>();
    if roots.is_empty() {
        return;
    }
    cli_args.push("--finance-entity-audit-roots".into());
    cli_args.push(roots.join(";"));
}

fn build_allowed_args(action: &str, args: &[String], project_path: &str) -> Result<Vec<String>, String> {
    let mut cli_args: Vec<String> = match action {
        "agentic-ask" => {
            let query = require_arg(args, "--query")?;
            let timeout = bounded_numeric_arg(arg_value(args, "--agent-timeout-ms"), "300000", 900000);
            let concurrency = bounded_numeric_arg(arg_value(args, "--agent-concurrency"), "3", 12);
            vec![
                "ask".into(),
                "--query".into(),
                bounded_text_arg(Some(query), "", 800),
                "--agentic".into(),
                "--show-sources".into(),
                "--profile".into(),
                "local-max".into(),
                "--agent-timeout-ms".into(),
                timeout,
                "--agent-concurrency".into(),
                concurrency,
            ]
        }
        "ask" => {
            let query = require_arg(args, "--query")?;
            let sources = bounded_text_arg(arg_value(args, "--sources"), "wiki,raw,graph,facts,brain", 180);
            let source_k = bounded_numeric_arg(arg_value(args, "--source-k"), "3", 8);
            let top_wiki = bounded_numeric_arg(arg_value(args, "--top-wiki"), "12", 40);
            let top_raw = bounded_numeric_arg(arg_value(args, "--top-raw"), "12", 40);
            let graph_depth = bounded_numeric_arg(arg_value(args, "--graph-depth"), "2", 4);
            let provider = bounded_text_arg(arg_value(args, "--provider"), "openai", 32);
            let api_key = bounded_text_arg(arg_value(args, "--api-key"), "", 400);
            let endpoint = bounded_text_arg(arg_value(args, "--endpoint"), "", 400);
            let model = bounded_text_arg(arg_value(args, "--model"), "", 200);
            let mut built = vec![
                "ask".into(),
                "--query".into(),
                bounded_text_arg(Some(query), "", 800),
                "--sources".into(),
                sources,
                "--source-k".into(),
                source_k,
                "--top-wiki".into(),
                top_wiki,
                "--top-raw".into(),
                top_raw,
                "--graph-depth".into(),
                graph_depth,
                "--provider".into(),
                if provider == "codex" { "codex".into() } else { "openai".into() },
            ];
            if !api_key.is_empty() {
                built.push("--api-key".into());
                built.push(api_key);
            }
            if !endpoint.is_empty() {
                built.push("--endpoint".into());
                built.push(endpoint);
            }
            if !model.is_empty() {
                built.push("--model".into());
                built.push(model);
            }
            built
        }
        "daily-loop" => {
            let mode_raw = bounded_text_arg(arg_value(args, "--mode"), "full", 16);
            let mode = if ["premarket", "postclose", "full"].contains(&mode_raw.as_str()) {
                mode_raw
            } else {
                "full".to_string()
            };
            let question_count = bounded_numeric_arg(arg_value(args, "--question-count"), "8", 20);
            // NOTE on source choice (measured on 83 stocks):
            //   xueqiu   -> 83/83 ok, amount + turnover always present, ~0.4s @conc16
            //   eastmoney-> full fields but rate-limits hard (32/83 socket hang up)
            //   tencent  -> stable, but never returns amount/turnover (metrics null)
            // Xueqiu is therefore the default for the GUI panel, where volume
            // evidence is what makes the report's conclusions falsifiable.
            let market_validate_raw =
                bounded_text_arg(arg_value(args, "--market-validate"), "xueqiu", 16);
            let market_validate = if ["off", "auto", "on", "eastmoney", "tencent", "xueqiu"]
                .contains(&market_validate_raw.as_str())
            {
                market_validate_raw
            } else {
                "xueqiu".to_string()
            };
            let api_key = bounded_text_arg(arg_value(args, "--api-key"), "", 400);
            let endpoint = bounded_text_arg(arg_value(args, "--endpoint"), "", 400);
            let model = bounded_text_arg(arg_value(args, "--model"), "", 200);
            let mut built = vec![
                "daily-loop".into(),
                "--mode".into(),
                mode,
                "--question-count".into(),
                question_count,
                "--provider".into(),
                "openai".into(),
                "--market-validate".into(),
                market_validate,
                // DeepSeek/OpenAI-compatible endpoints do not support the /v1/responses
                // planner used by runDailyLoop; disable it so questions fall back to
                // rule-based generation (answers still go through askWiki chat completions).
                "--no-llm-question-planner".into(),
            ];
            if args.iter().any(|a| a == "--validate-pending-only") {
                built.push("--validate-pending-only".into());
            }
            if args.iter().any(|a| a == "--write") {
                built.push("--write".into());
            }
            if !api_key.is_empty() {
                built.push("--api-key".into());
                built.push(api_key);
            }
            if !endpoint.is_empty() {
                built.push("--endpoint".into());
                built.push(endpoint);
            }
            if !model.is_empty() {
                built.push("--model".into());
                built.push(model);
            }
            built
        }
        "company-research" => {
            // Safe subset for the GUI panel. The heavy LLM stages
            // (plugin-review / plugin-led / plugin-optimize) spawn the macOS
            // codex binary and are intentionally excluded here; the base and
            // --deep reports are template-assembled from Tushare/CNINFO data
            // and need no external LLM.
            let stock = require_arg(args, "--stock")?;
            let from = bounded_text_arg(arg_value(args, "--from"), "", 16);
            let to = bounded_text_arg(arg_value(args, "--to"), "", 16);
            let cninfo_event_from = bounded_text_arg(arg_value(args, "--cninfo-event-from"), "", 16);
            // Deep-research scope/quality knobs (only meaningful with --deep).
            let cninfo_periodic_from = bounded_text_arg(arg_value(args, "--cninfo-periodic-from"), "", 16);
            let top_wiki = bounded_numeric_arg(arg_value(args, "--top-wiki"), "", 100);
            let top_raw = bounded_numeric_arg(arg_value(args, "--top-raw"), "", 100);
            let graph_neighbors = bounded_numeric_arg(arg_value(args, "--graph-neighbors"), "", 500);
            let graph_depth = bounded_numeric_arg(arg_value(args, "--graph-depth"), "", 6);
            let cninfo_download_limit = bounded_numeric_arg(arg_value(args, "--cninfo-download-limit"), "", 500);
            let api_key = bounded_text_arg(arg_value(args, "--api-key"), "", 400);
            let endpoint = bounded_text_arg(arg_value(args, "--endpoint"), "", 400);
            let model = bounded_text_arg(arg_value(args, "--model"), "", 200);
            let mut built = vec![
                "company-research".into(),
                "--stock".into(),
                bounded_text_arg(Some(stock), "", 40),
                "--provider".into(),
                "openai".into(),
            ];
            if !from.is_empty() {
                built.push("--from".into());
                built.push(from);
            }
            if !to.is_empty() {
                built.push("--to".into());
                built.push(to);
            }
            if !cninfo_event_from.is_empty() {
                built.push("--cninfo-event-from".into());
                built.push(cninfo_event_from);
            }
            if args.iter().any(|a| a == "--deep") {
                built.push("--deep".into());
                if !cninfo_periodic_from.is_empty() {
                    built.push("--cninfo-periodic-from".into());
                    built.push(cninfo_periodic_from);
                }
                if !top_wiki.is_empty() {
                    built.push("--top-wiki".into());
                    built.push(top_wiki);
                }
                if !top_raw.is_empty() {
                    built.push("--top-raw".into());
                    built.push(top_raw);
                }
                if !graph_neighbors.is_empty() {
                    built.push("--graph-neighbors".into());
                    built.push(graph_neighbors);
                }
                if !graph_depth.is_empty() {
                    built.push("--graph-depth".into());
                    built.push(graph_depth);
                }
                if !cninfo_download_limit.is_empty() {
                    built.push("--cninfo-download-limit".into());
                    built.push(cninfo_download_limit);
                }
            }
            if !api_key.is_empty() {
                built.push("--api-key".into());
                built.push(api_key);
            }
            if !endpoint.is_empty() {
                built.push("--endpoint".into());
                built.push(endpoint);
            }
            if !model.is_empty() {
                built.push("--model".into());
                built.push(model);
            }
            built
        }
        "research-os" => {
            // research-os agent <status|plan|step|review|verify|context>
            // The scope ("agent") and sub-action arrive as positional tokens
            // (args._ in the CLI parser). Pass them through if allow-listed.
            let allowed_positional = [
                "agent", "status", "plan", "step", "run-step", "review", "verify", "context",
            ];
            let mut positionals: Vec<String> = args
                .iter()
                .filter(|a| !a.starts_with("--") && allowed_positional.contains(&a.as_str()))
                .cloned()
                .collect();
            if !positionals.iter().any(|p| p == "agent") {
                positionals.insert(0, "agent".to_string());
            }
            let write = args.iter().any(|a| a == "--write");
            let confirm_human_gate = args.iter().any(|a| {
                a == "--confirm-human-gate" || a == "--human-gate-confirmed" || a == "--approved"
            });
            let step_id = bounded_text_arg(
                arg_value(args, "--step-id").or_else(|| arg_value(args, "--id")),
                "",
                200,
            );
            let queue = bounded_text_arg(
                arg_value(args, "--queue").or_else(|| arg_value(args, "--queue-id")),
                "",
                200,
            );
            let source = bounded_text_arg(arg_value(args, "--source"), "", 200);
            let generated_at = bounded_text_arg(arg_value(args, "--generated-at"), "", 64);
            let operator_next_step = bounded_text_arg(
                arg_value(args, "--operator-next-step")
                    .or_else(|| arg_value(args, "--operatorNextStep")),
                "",
                400,
            );
            let status_filter = bounded_text_arg(arg_value(args, "--status"), "", 64);
            let limit = bounded_numeric_arg(
                arg_value(args, "--limit").or_else(|| arg_value(args, "--action-limit")),
                "20",
                500,
            );
            let dry_run_ready = args.iter().any(|a| a == "--dry-run-ready" || a == "--dryRunReady");
            let write_ready = args.iter().any(|a| a == "--write-ready" || a == "--writeReady");

            let mut built: Vec<String> = vec!["research-os".into()];
            for p in &positionals {
                built.push(p.clone());
            }
            if !step_id.is_empty() {
                built.push("--step-id".into());
                built.push(step_id);
            }
            if !queue.is_empty() {
                built.push("--queue".into());
                built.push(queue);
            }
            if !source.is_empty() {
                built.push("--source".into());
                built.push(source);
            }
            if !status_filter.is_empty() {
                built.push("--status".into());
                built.push(status_filter);
            }
            if limit != "20" {
                built.push("--limit".into());
                built.push(limit);
            }
            if !generated_at.is_empty() {
                built.push("--generated-at".into());
                built.push(generated_at);
            }
            if !operator_next_step.is_empty() {
                built.push("--operator-next-step".into());
                built.push(operator_next_step);
            }
            if dry_run_ready {
                built.push("--dry-run-ready".into());
            }
            if write_ready {
                built.push("--write-ready".into());
            }
            if confirm_human_gate {
                built.push("--confirm-human-gate".into());
            }
            if write {
                built.push("--write".into());
            }
            built
        }
        "self-question" => {
            // Recursive self-question evolution loop (the core ask->validate->attribute
            // trio plus optional evidence/policy/self-train/export stages). The GUI panel
            // exposes only the safe, deterministic subset:
            //   - rule-based question planner (hardcoded --no-llm-question-planner) because
            //     DeepSeek/OpenAI-compatible endpoints do not support /v1/responses; answers
            //     and later stages use external kline (xueqiu) + brain records, no LLM needed.
            //   - anchored validations fall back to xueqiu via --allow-anchored-external-market
            //     (self-question records carry createdAt, so they are always "anchored").
            // The macOS codex-only policy-regression/export stages are reachable only through
            // the richer CLI, not this panel.
            let stages = sanitize_stage_list(
                arg_value(args, "--stages"),
                "generate,validate,attribute",
            );
            let question_count = bounded_numeric_arg(arg_value(args, "--question-count"), "3", 50);
            let market_validate_raw =
                bounded_text_arg(arg_value(args, "--market-validate"), "xueqiu", 16);
            let market_validate = if ["off", "auto", "on", "eastmoney", "tencent", "xueqiu"]
                .contains(&market_validate_raw.as_str())
            {
                market_validate_raw
            } else {
                "xueqiu".to_string()
            };
            let em_timeout = bounded_numeric_arg(
                arg_value(args, "--external-market-timeout-ms"),
                "3000",
                60000,
            );
            let em_concurrency = bounded_numeric_arg(
                arg_value(args, "--external-market-concurrency"),
                "6",
                50,
            );
            let api_key = bounded_text_arg(arg_value(args, "--api-key"), "", 400);
            let endpoint = bounded_text_arg(arg_value(args, "--endpoint"), "", 400);
            let model = bounded_text_arg(arg_value(args, "--model"), "", 200);
            let mut built = vec![
                "self-question".into(),
                "loop".into(),
                "--stages".into(),
                stages,
                "--question-count".into(),
                question_count,
                "--market-validate".into(),
                market_validate,
                "--allow-anchored-external-market".into(),
                "--external-market-timeout-ms".into(),
                em_timeout,
                "--external-market-concurrency".into(),
                em_concurrency,
                // DeepSeek/OpenAI-compatible endpoints do not support the /v1/responses
                // planner; disable it so questions fall back to rule-based generation.
                "--no-llm-question-planner".into(),
                "--profile".into(),
                "local-max".into(),
                "--provider".into(),
                "openai".into(),
            ];
            if args.iter().any(|a| a == "--self-train-write") {
                built.push("--self-train-write".into());
            }
            if args.iter().any(|a| a == "--write") {
                built.push("--write".into());
            }
            if !api_key.is_empty() {
                built.push("--api-key".into());
                built.push(api_key);
            }
            if !endpoint.is_empty() {
                built.push("--endpoint".into());
                built.push(endpoint);
            }
            if !model.is_empty() {
                built.push("--model".into());
                built.push(model);
            }
            built
        }
        "autoresearch-ledger" => vec![
            "autoresearch".into(),
            "ledger".into(),
        ],
        "autoresearch-status" => vec![
            "autoresearch".into(),
            "status".into(),
        ],
        "brain" => {
            // brain <status|remember|resolve>
            // The subcommand arrives as a positional token (args._[1] in the
            // CLI parser). Pass it through only if allow-listed; default to status.
            // brain does not call any LLM, so no provider/api-key forwarding.
            let allowed_sub = ["status", "remember", "resolve"];
            let sub = args
                .iter()
                .find(|a| !a.starts_with("--") && allowed_sub.contains(&a.as_str()))
                .cloned()
                .unwrap_or_else(|| "status".to_string());
            let mut built: Vec<String> = vec!["brain".into(), sub.clone()];
            match sub.as_str() {
                "remember" => {
                    let btype = bounded_text_arg(Some(require_arg(args, "--type")?), "", 60);
                    let text = bounded_text_arg(Some(require_arg(args, "--text")?), "", 4000);
                    built.push("--type".into());
                    built.push(btype);
                    built.push("--text".into());
                    built.push(text);
                    for (flag, value) in [
                        ("--title", bounded_text_arg(arg_value(args, "--title"), "", 300)),
                        ("--status", bounded_text_arg(arg_value(args, "--status"), "", 40)),
                        ("--source", bounded_text_arg(arg_value(args, "--source"), "", 200)),
                        ("--tags", bounded_text_arg(arg_value(args, "--tags"), "", 400)),
                        ("--related", bounded_text_arg(arg_value(args, "--related"), "", 400)),
                    ] {
                        if !value.trim().is_empty() {
                            built.push(flag.into());
                            built.push(value);
                        }
                    }
                }
                "resolve" => {
                    let id = bounded_text_arg(Some(require_arg(args, "--id")?), "", 180);
                    let result = bounded_text_arg(Some(require_arg(args, "--result")?), "", 40);
                    let note = bounded_text_arg(arg_value(args, "--note"), "", 600);
                    built.push("--id".into());
                    built.push(id);
                    built.push("--result".into());
                    built.push(result);
                    if !note.trim().is_empty() {
                        built.push("--note".into());
                        built.push(note);
                    }
                }
                _ => {}
            }
            built
        }
        "deep-research" => {
            // deep-research — general topic deep research via web + wiki + graph + facts.
            // Requires --topic. Uses LLM; forward --provider openai + api-key/endpoint/model.
            let topic = bounded_text_arg(Some(require_arg(args, "--topic")?), "", 300);
            let queries = bounded_text_arg(arg_value(args, "--queries"), "", 800);
            let max_results = bounded_numeric_arg(arg_value(args, "--max-results"), "", 100);
            let source_k = bounded_numeric_arg(arg_value(args, "--source-k"), "", 100);
            let graph_depth = bounded_numeric_arg(arg_value(args, "--graph-depth"), "", 6);
            let graph_neighbors = bounded_numeric_arg(arg_value(args, "--graph-neighbors"), "", 500);
            let top_brain = bounded_numeric_arg(arg_value(args, "--top-brain"), "", 200);
            let api_key = bounded_text_arg(arg_value(args, "--api-key"), "", 400);
            let endpoint = bounded_text_arg(arg_value(args, "--endpoint"), "", 400);
            let model = bounded_text_arg(arg_value(args, "--model"), "", 200);

            let mut built: Vec<String> = vec!["deep-research".into()];
            built.push("--topic".into());
            built.push(topic);
            built.push("--provider".into());
            built.push("openai".into());

            for (flag, val) in [
                ("--queries", &queries),
                ("--max-results", &max_results),
                ("--source-k", &source_k),
                ("--graph-depth", &graph_depth),
                ("--graph-neighbors", &graph_neighbors),
                ("--top-brain", &top_brain),
            ] {
                if !val.is_empty() {
                    built.push(flag.into());
                    built.push(val.clone());
                }
            }

            if arg_value(args, "--write").is_some() { built.push("--write".into()); }
            if arg_value(args, "--ingest").is_some() { built.push("--ingest".into()); }
            if arg_value(args, "--apply-ingest").is_some() { built.push("--apply-ingest".into()); }
            if arg_value(args, "--include-invalidated").is_some() { built.push("--include-invalidated".into()); }

            if !api_key.is_empty() {
                built.push("--api-key".into());
                built.push(api_key);
            }
            if !endpoint.is_empty() {
                built.push("--endpoint".into());
                built.push(endpoint);
            }
            if !model.is_empty() {
                built.push("--model".into());
                built.push(model);
            }
            built
        }
        "concepts" => {
            // concepts [audit] — concept governance audit (no LLM)
            let sub = args
                .iter()
                .find(|a| !a.starts_with("--") && *a == "audit")
                .cloned()
                .unwrap_or_else(|| "audit".to_string());
            let top_n = bounded_numeric_arg(arg_value(args, "--top-n"), "", 10_000);
            let write = arg_value(args, "--write").is_some();
            let rulings = bounded_text_arg(arg_value(args, "--concept-rulings"), "", 800);
            let mut built: Vec<String> = vec!["concepts".into(), sub];
            if !top_n.is_empty() {
                built.push("--top-n".into());
                built.push(top_n);
            }
            if write {
                built.push("--write".into());
            }
            if !rulings.is_empty() {
                built.push("--concept-rulings".into());
                built.push(rulings);
            }
            built
        }
        "temporal-facts" => {
            // temporal-facts [audit] — temporal facts audit (no LLM)
            let sub = args
                .iter()
                .find(|a| !a.starts_with("--") && *a == "audit")
                .cloned()
                .unwrap_or_else(|| "audit".to_string());
            let top_n = bounded_numeric_arg(arg_value(args, "--top-n"), "", 10_000);
            let write = arg_value(args, "--write").is_some();
            let mut built: Vec<String> = vec!["temporal-facts".into(), sub];
            if !top_n.is_empty() {
                built.push("--top-n".into());
                built.push(top_n);
            }
            if write {
                built.push("--write".into());
            }
            built
        }
        "data-engineering" => {
            // Aggregated arm: the front-end sends --task <name> + task-specific flags.
            // Each task maps to its native CLI command; LLM-only tasks get
            // --provider openai + api-key/endpoint/model forwarding.
            let task = require_arg(args, "--task")?;
            let allowed_tasks = [
                "prepare",
                "convert-source",
                "embeddings",
                "api-run",
                "finalize",
                "apply",
                "batch-run",
                "sag-sync",
                "hygiene",
            ];
            if !allowed_tasks.contains(&task.as_str()) {
                return Err(format!(
                    "data-engineering: unknown --task '{}'.  Allowed: {}",
                    task,
                    allowed_tasks.join(", ")
                ));
            }

            let api_key = bounded_text_arg(arg_value(args, "--api-key"), "", 400);
            let endpoint = bounded_text_arg(arg_value(args, "--endpoint"), "", 400);
            let model = bounded_text_arg(arg_value(args, "--model"), "", 200);
            let emb_key = bounded_text_arg(arg_value(args, "--embedding-api-key"), "", 400);
            let emb_endpoint = bounded_text_arg(arg_value(args, "--embedding-endpoint"), "", 400);
            let emb_model = bounded_text_arg(arg_value(args, "--embedding-model"), "", 200);

            let mut built: Vec<String> = vec![];

            match task.as_str() {
                "prepare" => {
                    let source = bounded_text_arg(Some(require_arg(args, "--source")?), "", 800);
                    let schema = bounded_text_arg(arg_value(args, "--schema"), "", 800);
                    built.push("prepare".into());
                    built.push("--source".into());
                    built.push(source);
                    if !schema.is_empty() {
                        built.push("--schema".into());
                        built.push(schema);
                    }
                    if arg_value(args, "--no-report").is_some() {
                        built.push("--no-report".into());
                    }
                    for (flag, val) in [
                        ("--embedding-routing", arg_value(args, "--embedding-routing")),
                    ] {
                        if val.is_some() {
                            built.push(flag.into());
                        }
                    }
                    for (flag, val) in [
                        ("--embedding-api-key", &emb_key),
                        ("--embedding-endpoint", &emb_endpoint),
                        ("--embedding-model", &emb_model),
                    ] {
                        if !val.is_empty() {
                            built.push(flag.into());
                            built.push(val.clone());
                        }
                    }
                }
                "convert-source" => {
                    let source = bounded_text_arg(Some(require_arg(args, "--source")?), "", 800);
                    let output = bounded_text_arg(arg_value(args, "--output"), "", 800);
                    built.push("convert-source".into());
                    built.push("--source".into());
                    built.push(source);
                    if !output.is_empty() {
                        built.push("--output".into());
                        built.push(output);
                    }
                    if arg_value(args, "--overwrite").is_some() {
                        built.push("--overwrite".into());
                    }
                    if arg_value(args, "--no-ocr").is_some() {
                        built.push("--no-ocr".into());
                    }
                    let markitdown_bin = bounded_text_arg(arg_value(args, "--markitdown-bin"), "", 800);
                    let ocr_python = bounded_text_arg(arg_value(args, "--ocr-python-bin"), "", 800);
                    for (flag, val) in [("--markitdown-bin", markitdown_bin), ("--ocr-python-bin", ocr_python)] {
                        if !val.is_empty() {
                            built.push(flag.into());
                            built.push(val);
                        }
                    }
                }
                "embeddings" => {
                    let allowed_sub = ["build", "status"];
                    let sub = args
                        .iter()
                        .find(|a| !a.starts_with("--") && allowed_sub.contains(&a.as_str()))
                        .cloned()
                        .unwrap_or_else(|| "status".to_string());
                    built.push("embeddings".into());
                    built.push(sub.clone());
                    if sub == "build" {
                        let batch = bounded_numeric_arg(arg_value(args, "--embedding-batch-size"), "", 10_000);
                        let timeout = bounded_numeric_arg(arg_value(args, "--embedding-timeout-ms"), "", 300_000);
                        if !batch.is_empty() {
                            built.push("--embedding-batch-size".into());
                            built.push(batch);
                        }
                        if !timeout.is_empty() {
                            built.push("--embedding-timeout-ms".into());
                            built.push(timeout);
                        }
                    }
                    for (flag, val) in [
                        ("--embedding-api-key", &emb_key),
                        ("--embedding-endpoint", &emb_endpoint),
                        ("--embedding-model", &emb_model),
                    ] {
                        if !val.is_empty() {
                            built.push(flag.into());
                            built.push(val.clone());
                        }
                    }
                }
                "api-run" => {
                    let source = bounded_text_arg(Some(require_arg(args, "--source")?), "", 800);
                    let schema = bounded_text_arg(arg_value(args, "--schema"), "", 800);
                    built.push("api-run".into());
                    built.push("--source".into());
                    built.push(source);
                    if !schema.is_empty() {
                        built.push("--schema".into());
                        built.push(schema);
                    }
                    let items = [
                        "--page-concurrency", "--page-write-mode", "--source-sharding",
                        "--source-retention", "--reasoning-effort",
                    ];
                    for flag in items {
                        let v = bounded_text_arg(arg_value(args, flag), "", 40);
                        if !v.is_empty() {
                            built.push(flag.into());
                            built.push(v);
                        }
                    }
                    let nums = [
                        "--codex-timeout-ms", "--max-plan-items", "--max-create-pages",
                        "--max-update-pages", "--shard-concurrency", "--max-shard-chars",
                    ];
                    for flag in nums {
                        let v = bounded_numeric_arg(arg_value(args, flag), "", 100_000_000);
                        if !v.is_empty() {
                            built.push(flag.into());
                            built.push(v);
                        }
                    }
                    if arg_value(args, "--judgments").is_some() {
                        built.push("--judgments".into());
                    }
                    // embedding sub-flags
                    for (flag, val) in [
                        ("--embedding-routing", arg_value(args, "--embedding-routing")),
                    ] {
                        if val.is_some() { built.push(flag.into()); }
                    }
                    for (flag, val) in [
                        ("--embedding-api-key", &emb_key),
                        ("--embedding-endpoint", &emb_endpoint),
                        ("--embedding-model", &emb_model),
                    ] {
                        if !val.is_empty() {
                            built.push(flag.into());
                            built.push(val.clone());
                        }
                    }
                }
                "finalize" => {
                    let report = bounded_text_arg(Some(require_arg(args, "--report")?), "", 800);
                    built.push("finalize".into());
                    built.push("--report".into());
                    built.push(report);
                    let reasoning = bounded_text_arg(arg_value(args, "--reasoning-effort"), "", 40);
                    if !reasoning.is_empty() {
                        built.push("--reasoning-effort".into());
                        built.push(reasoning);
                    }
                    let timeout = bounded_numeric_arg(arg_value(args, "--codex-timeout-ms"), "", 1_200_000);
                    if !timeout.is_empty() {
                        built.push("--codex-timeout-ms".into());
                        built.push(timeout);
                    }
                }
                "apply" => {
                    let manifest = bounded_text_arg(Some(require_arg(args, "--manifest")?), "", 800);
                    built.push("apply".into());
                    built.push("--manifest".into());
                    built.push(manifest);
                    if arg_value(args, "--write").is_some() {
                        built.push("--write".into());
                    }
                    if arg_value(args, "--allow-source-change").is_some() {
                        built.push("--allow-source-change".into());
                    }
                }
                "batch-run" => {
                    let sources = bounded_text_arg(Some(require_arg(args, "--sources")?), "", 800);
                    let schema = bounded_text_arg(arg_value(args, "--schema"), "", 800);
                    built.push("batch-run".into());
                    built.push("--sources".into());
                    built.push(sources);
                    if !schema.is_empty() {
                        built.push("--schema".into());
                        built.push(schema);
                    }
                    let text_flags = [
                        "--page-concurrency", "--page-write-mode", "--source-sharding",
                        "--source-retention", "--conflict-policy", "--reasoning-effort",
                    ];
                    for flag in text_flags {
                        let v = bounded_text_arg(arg_value(args, flag), "", 40);
                        if !v.is_empty() {
                            built.push(flag.into());
                            built.push(v);
                        }
                    }
                    let num_flags = [
                        "--api-concurrency", "--codex-timeout-ms", "--max-plan-items",
                        "--max-create-pages", "--max-update-pages", "--shard-concurrency",
                        "--max-shard-chars", "--write-concurrency",
                    ];
                    for flag in num_flags {
                        let v = bounded_numeric_arg(arg_value(args, flag), "", 100_000_000);
                        if !v.is_empty() {
                            built.push(flag.into());
                            built.push(v);
                        }
                    }
                    if arg_value(args, "--judgments").is_some() {
                        built.push("--judgments".into());
                    }
                    if arg_value(args, "--write").is_some() {
                        built.push("--write".into());
                    }
                    // embedding sub-flags
                    for (flag, val) in [
                        ("--embedding-routing", arg_value(args, "--embedding-routing")),
                    ] {
                        if val.is_some() { built.push(flag.into()); }
                    }
                    for (flag, val) in [
                        ("--embedding-api-key", &emb_key),
                        ("--embedding-endpoint", &emb_endpoint),
                        ("--embedding-model", &emb_model),
                    ] {
                        if !val.is_empty() {
                            built.push(flag.into());
                            built.push(val.clone());
                        }
                    }
                }
                "sag-sync" => {
                    let allowed_sub = ["status", "report", "scan-reports", "file", "scan-wiki", "pending"];
                    let sub = args
                        .iter()
                        .find(|a| !a.starts_with("--") && allowed_sub.contains(&a.as_str()))
                        .cloned()
                        .unwrap_or_else(|| "status".to_string());
                    built.push("sag-sync".into());
                    built.push(sub.clone());
                    let text_flags = [
                        "--sag-api-base", "--sag-project-name", "--sync-root", "--since",
                    ];
                    for flag in text_flags {
                        let v = bounded_text_arg(arg_value(args, flag), "", 400);
                        if !v.is_empty() {
                            built.push(flag.into());
                            built.push(v);
                        }
                    }
                    let num_flags = ["--limit", "--offset", "--max-content-bytes"];
                    for flag in num_flags {
                        let v = bounded_numeric_arg(arg_value(args, flag), "", 100_000_000);
                        if !v.is_empty() {
                            built.push(flag.into());
                            built.push(v);
                        }
                    }
                    if arg_value(args, "--force").is_some() {
                        built.push("--force".into());
                    }
                    if arg_value(args, "--no-extract").is_some() {
                        built.push("--no-extract".into());
                    }
                    if sub == "report" {
                        let report_path = bounded_text_arg(arg_value(args, "--report"), "", 800);
                        if !report_path.is_empty() {
                            built.push("--report".into());
                            built.push(report_path);
                        }
                    }
                    if sub == "file" {
                        let file_path = bounded_text_arg(arg_value(args, "--path"), "", 800);
                        if !file_path.is_empty() {
                            built.push("--path".into());
                            built.push(file_path);
                        }
                    }
                }
                "hygiene" => {
                    let allowed_sub = ["audit", "clean"];
                    let sub = args
                        .iter()
                        .find(|a| !a.starts_with("--") && allowed_sub.contains(&a.as_str()))
                        .cloned()
                        .unwrap_or_else(|| "audit".to_string());
                    built.push("hygiene".into());
                    built.push(sub.clone());
                    let keep_days = bounded_numeric_arg(arg_value(args, "--keep-days"), "", 3650);
                    if !keep_days.is_empty() {
                        built.push("--keep-days".into());
                        built.push(keep_days);
                    }
                    if arg_value(args, "--write").is_some() {
                        built.push("--write".into());
                    }
                }
                _ => unreachable!(),
            }

            // Append provider/api-key/endpoint/model for tasks that call LLM
            let llm_tasks = ["api-run", "finalize", "batch-run"];
            if llm_tasks.contains(&task.as_str()) {
                built.push("--provider".into());
                built.push("openai".into());
                if !api_key.is_empty() {
                    built.push("--api-key".into());
                    built.push(api_key);
                }
                if !endpoint.is_empty() {
                    built.push("--endpoint".into());
                    built.push(endpoint);
                }
                if !model.is_empty() {
                    built.push("--model".into());
                    built.push(model);
                }
            }

            built
        }
        "dashboard-data" => vec![
            "hypothesis".into(),
            "dashboard-data".into(),
            "--json".into(),
        ],
        "hypothesis-discover-dry-run" => {
            let theme = bounded_text_arg(arg_value(args, "--theme"), "", 160);
            let question_count = bounded_numeric_arg(arg_value(args, "--question-count"), "5", 12);
            let concurrency = bounded_numeric_arg(arg_value(args, "--concurrency"), "3", 8);
            let sources = bounded_text_arg(
                arg_value(args, "--sources"),
                "wiki,raw,wechat_incremental,hypothesis_supplement,agentic",
                180,
            );
            let since = bounded_text_arg(arg_value(args, "--since"), "3650d", 24);
            let timeout = bounded_numeric_arg(arg_value(args, "--timeout-ms"), "300000", 900000);
            let provider = bounded_text_arg(arg_value(args, "--provider"), "openai", 32);
            let api_key = bounded_text_arg(arg_value(args, "--api-key"), "", 400);
            let endpoint = bounded_text_arg(arg_value(args, "--endpoint"), "", 400);
            let model = bounded_text_arg(arg_value(args, "--model"), "", 200);
            let mut built = vec![
                "hypothesis".into(),
                "discover".into(),
                "--theme".into(),
                theme,
                "--question-count".into(),
                question_count,
                "--concurrency".into(),
                concurrency,
                "--sources".into(),
                sources,
                "--since".into(),
                since,
                "--provider".into(),
                provider,
                "--timeout-ms".into(),
                timeout,
            ];
            if !api_key.is_empty() {
                built.push("--api-key".into());
                built.push(api_key);
            }
            if !endpoint.is_empty() {
                built.push("--endpoint".into());
                built.push(endpoint);
            }
            if !model.is_empty() {
                built.push("--model".into());
                built.push(model);
            }
            append_default_finance_entity_audit_roots(&mut built);
            built
        }
        "hypothesis-ask" => {
            let id = require_arg(args, "--id")?;
            let query = bounded_text_arg(arg_value(args, "--query"), "", 1000);
            let timeout = bounded_numeric_arg(arg_value(args, "--agent-timeout-ms"), "300000", 900000);
            let concurrency = bounded_numeric_arg(arg_value(args, "--agent-concurrency"), "3", 12);
            let mut built = vec![
                "hypothesis".into(),
                "ask".into(),
                "--id".into(),
                bounded_text_arg(Some(id), "", 180),
                "--agentic".into(),
                "--profile".into(),
                "local-max".into(),
                "--agent-timeout-ms".into(),
                timeout,
                "--agent-concurrency".into(),
                concurrency,
            ];
            if !query.trim().is_empty() {
                built.push("--query".into());
                built.push(query);
            }
            built
        }
        "candidate-ask-precheck" => {
            let query = require_arg(args, "--query")?;
            let timeout = bounded_numeric_arg(arg_value(args, "--agent-timeout-ms"), "180000", 600000);
            let concurrency = bounded_numeric_arg(arg_value(args, "--agent-concurrency"), "2", 6);
            let sources = bounded_text_arg(arg_value(args, "--sources"), "wiki,raw,graph,facts,brain", 180);
            let source_k = bounded_numeric_arg(arg_value(args, "--source-k"), "3", 8);
            vec![
                "ask".into(),
                "--query".into(),
                bounded_text_arg(Some(query), "", 1000),
                "--agentic".into(),
                "--show-context".into(),
                "--show-sources".into(),
                "--sources".into(),
                sources,
                "--source-k".into(),
                source_k,
                "--profile".into(),
                "local-max".into(),
                "--agent-timeout-ms".into(),
                timeout,
                "--agent-concurrency".into(),
                concurrency,
                "--no-agent-artifacts".into(),
            ]
        }
        "hypothesis-status-update-write" => {
            let id = require_arg(args, "--id")?;
            let status = require_arg(args, "--status")?;
            let reason = bounded_text_arg(arg_value(args, "--reason"), "manual review", 500);
            let event_ref = bounded_text_arg(arg_value(args, "--event-ref"), "manual:research-cockpit-status-update", 500);
            let ask_run_ref = bounded_text_arg(arg_value(args, "--ask-run-ref"), "", 500);
            let mut built = vec![
                "hypothesis".into(),
                "status-update".into(),
                "--id".into(),
                bounded_text_arg(Some(id), "", 180),
                "--status".into(),
                bounded_text_arg(Some(status), "watching", 32),
                "--reason".into(),
                reason,
                "--event-ref".into(),
                event_ref,
                "--write".into(),
            ];
            if !ask_run_ref.trim().is_empty() {
                built.push("--ask-run-ref".into());
                built.push(ask_run_ref);
            }
            built
        }
        "hypothesis-evidence-feedback-dry-run" | "hypothesis-evidence-feedback-write" => {
            let mut built = vec!["hypothesis".into(), "evidence-feedback".into()];
            if let Some(id) = arg_value(args, "--id").or_else(|| arg_value(args, "--hypothesis-id")) {
                built.push("--id".into());
                built.push(bounded_text_arg(Some(id), "", 180));
            }
            if let Some(status) = arg_value(args, "--status") {
                built.push("--status".into());
                built.push(bounded_text_arg(Some(status), "", 32));
            }
            if let Some(theme) = arg_value(args, "--theme") {
                built.push("--theme".into());
                built.push(bounded_text_arg(Some(theme), "", 120));
            }
            if let Some(segment) = arg_value(args, "--segment") {
                built.push("--segment".into());
                built.push(bounded_text_arg(Some(segment), "", 80));
            }
            let limit = bounded_numeric_arg(arg_value(args, "--limit"), "80", 300);
            built.push("--limit".into());
            built.push(limit);
            if let Some(generated_at) = arg_value(args, "--generated-at") {
                built.push("--generated-at".into());
                built.push(bounded_text_arg(Some(generated_at), "", 40));
            }
            if action == "hypothesis-evidence-feedback-write" {
                built.push("--write".into());
            }
            built
        }
        "hypothesis-post-mortem-dry-run" | "hypothesis-post-mortem-write" => {
            let mut built = vec!["hypothesis".into(), "post-mortem".into()];
            if let Some(id) = arg_value(args, "--id").or_else(|| arg_value(args, "--hypothesis-id")) {
                built.push("--id".into());
                built.push(bounded_text_arg(Some(id), "", 180));
            }
            if let Some(status) = arg_value(args, "--status") {
                built.push("--status".into());
                built.push(bounded_text_arg(Some(status), "", 32));
            }
            let limit = bounded_numeric_arg(arg_value(args, "--limit"), "80", 300);
            built.push("--limit".into());
            built.push(limit);
            if action == "hypothesis-post-mortem-write" {
                built.push("--write".into());
            }
            built
        }
        "hypothesis-verify" => vec!["hypothesis".into(), "verify".into()],
        "hypothesis-create-dry-run" | "hypothesis-create-write" => {
            let title = require_arg(args, "--title")?;
            let theme = bounded_text_arg(arg_value(args, "--theme"), "", 120);
            let segments = bounded_text_arg(arg_value(args, "--segments"), "", 240);
            let time_horizon = bounded_text_arg(arg_value(args, "--time-horizon"), "", 80);
            let status = bounded_text_arg(arg_value(args, "--status"), "watching", 32);
            let mut built = vec![
                "hypothesis".into(),
                "create".into(),
                "--title".into(),
                bounded_text_arg(Some(title), "", 180),
                "--status".into(),
                status,
            ];
            if !theme.trim().is_empty() {
                built.push("--theme".into());
                built.push(theme);
            }
            if !segments.trim().is_empty() {
                built.push("--segments".into());
                built.push(segments);
            }
            if !time_horizon.trim().is_empty() {
                built.push("--time-horizon".into());
                built.push(time_horizon);
            }
            if action == "hypothesis-create-write" {
                built.push("--write".into());
            }
            built
        }
        "export-samples-list" => {
            let limit = bounded_numeric_arg(arg_value(args, "--limit"), "8", 100);
            let kind = bounded_text_arg(arg_value(args, "--kind"), "sft", 24);
            let quality_gate = bounded_text_arg(arg_value(args, "--quality-gate"), "all", 40);
            vec![
                "export-samples".into(),
                "list".into(),
                "--kind".into(),
                kind,
                "--quality-gate".into(),
                quality_gate,
                "--limit".into(),
                limit,
            ]
        }
        "data-source-tushare-probe" => {
            let stock_code = bounded_text_arg(arg_value(args, "--stock-code"), "", 32);
            let trade_date = bounded_text_arg(arg_value(args, "--trade-date"), "", 32);
            let timeout_ms = bounded_numeric_arg(arg_value(args, "--tushare-timeout-ms"), "15000", 30_000);
            let mut built = vec![
                "data-source".into(),
                "tushare-probe".into(),
                "--tushare-timeout-ms".into(),
                timeout_ms,
            ];
            if !stock_code.trim().is_empty() {
                built.push("--stock-code".into());
                built.push(stock_code);
            }
            if !trade_date.trim().is_empty() {
                built.push("--trade-date".into());
                built.push(trade_date);
            }
            built
        }
        "stock-feedback-status" => vec![
            "stock-feedback".into(),
            "status".into(),
        ],
        "stock-feedback-evidence-task-create-dry-run" | "stock-feedback-evidence-task-create-write" => {
            let stock_code = bounded_text_arg(Some(require_arg(args, "--stock-code")?), "", 32);
            let target_fields = bounded_text_arg(Some(require_arg(args, "--target-fields")?), "", 500);
            let stock_name = bounded_text_arg(arg_value(args, "--stock-name"), "", 80);
            let task_type = sanitize_stock_feedback_evidence_task_type(arg_value(args, "--task-type"));
            let source = sanitize_stock_feedback_evidence_task_source(arg_value(args, "--source"));
            let source_id = bounded_text_arg(arg_value(args, "--source-id"), "", 180);
            let preferred_sources = bounded_text_arg(arg_value(args, "--preferred-sources"), "", 160);
            let priority = sanitize_stock_feedback_evidence_priority(arg_value(args, "--priority"));
            let notes = bounded_text_arg(arg_value(args, "--notes"), "", 700);
            let source_refs = bounded_text_arg(arg_value(args, "--source-refs"), "", 1000);
            let tool_state_refs = bounded_text_arg(arg_value(args, "--tool-state-refs"), "", 1000);
            let structured_data_json = bounded_text_arg(arg_value(args, "--structured-data-json"), "", 2000);
            let mut built = vec![
                "stock-feedback".into(),
                "evidence-task".into(),
                "create".into(),
                "--stock-code".into(),
                stock_code,
                "--task-type".into(),
                task_type,
                "--target-fields".into(),
                target_fields,
                "--source".into(),
                source,
                "--priority".into(),
                priority,
            ];
            for (flag, value) in [
                ("--stock-name", stock_name),
                ("--source-id", source_id),
                ("--preferred-sources", preferred_sources),
                ("--notes", notes),
                ("--source-refs", source_refs),
                ("--tool-state-refs", tool_state_refs),
                ("--structured-data-json", structured_data_json),
            ] {
                if !value.trim().is_empty() {
                    built.push(flag.into());
                    built.push(value);
                }
            }
            if action == "stock-feedback-evidence-task-create-write" {
                built.push("--write".into());
            }
            built
        },
        "stock-feedback-evidence-task-list" => {
            let status = sanitize_stock_feedback_evidence_task_status(arg_value(args, "--status"));
            let task_type = sanitize_stock_feedback_evidence_task_type(arg_value(args, "--task-type"));
            let stock = bounded_text_arg(arg_value(args, "--stock"), "", 80);
            let limit = bounded_numeric_arg(arg_value(args, "--limit"), "80", 300);
            let mut built = vec![
                "stock-feedback".into(),
                "evidence-task".into(),
                "list".into(),
                "--limit".into(),
                limit,
            ];
            if !status.trim().is_empty() {
                built.push("--status".into());
                built.push(status);
            }
            if !task_type.trim().is_empty() {
                built.push("--task-type".into());
                built.push(task_type);
            }
            if !stock.trim().is_empty() {
                built.push("--stock".into());
                built.push(stock);
            }
            built
        },
        "stock-feedback-evidence-task-show" => {
            let task_id = bounded_text_arg(Some(require_arg(args, "--task-id")?), "", 180);
            vec![
                "stock-feedback".into(),
                "evidence-task".into(),
                "show".into(),
                "--task-id".into(),
                task_id,
            ]
        },
        "stock-feedback-run-task-queue-dry-run" | "stock-feedback-run-task-queue-write" => {
            let task_id = bounded_text_arg(arg_value(args, "--task-id"), "", 180);
            let limit = bounded_numeric_arg(arg_value(args, "--limit"), "10", 100);
            let mut built = vec![
                "stock-feedback".into(),
                "run-task-queue".into(),
                "--limit".into(),
                limit,
            ];
            if !task_id.trim().is_empty() {
                built.push("--task-id".into());
                built.push(task_id);
            }
            if action == "stock-feedback-run-task-queue-write" {
                built.push("--write".into());
            }
            built
        },
        "stock-feedback-evidence-result-list" => {
            let status = sanitize_stock_feedback_evidence_result_status(arg_value(args, "--status"));
            let task_id = bounded_text_arg(arg_value(args, "--task-id"), "", 180);
            let limit = bounded_numeric_arg(arg_value(args, "--limit"), "80", 300);
            let mut built = vec![
                "stock-feedback".into(),
                "evidence-result".into(),
                "list".into(),
                "--limit".into(),
                limit,
            ];
            if !status.trim().is_empty() {
                built.push("--status".into());
                built.push(status);
            }
            if !task_id.trim().is_empty() {
                built.push("--task-id".into());
                built.push(task_id);
            }
            built
        },
        "stock-feedback-evidence-result-review-write" => {
            let result_id = bounded_text_arg(Some(require_arg(args, "--result-id")?), "", 180);
            let review_action = sanitize_stock_feedback_evidence_review_action(arg_value(args, "--action"));
            let reviewer = bounded_text_arg(arg_value(args, "--reviewer"), "ui", 80);
            let note = bounded_text_arg(arg_value(args, "--note"), "", 500);
            let mut built = vec![
                "stock-feedback".into(),
                "evidence-result".into(),
                "review".into(),
                "--result-id".into(),
                result_id,
                "--action".into(),
                review_action,
                "--reviewer".into(),
                reviewer,
            ];
            if !note.trim().is_empty() {
                built.push("--note".into());
                built.push(note);
            }
            built.push("--write".into());
            built
        },
        "stock-feedback-source-status" => vec![
            "stock-feedback".into(),
            "source-status".into(),
        ],
        "stock-feedback-dlq-list" => {
            let status = sanitize_stock_feedback_dlq_status(arg_value(args, "--status"));
            let limit = bounded_numeric_arg(arg_value(args, "--limit"), "80", 300);
            vec![
                "stock-feedback".into(),
                "dlq".into(),
                "list".into(),
                "--status".into(),
                status,
                "--limit".into(),
                limit,
            ]
        },
        "stock-feedback-dlq-retry-write" | "stock-feedback-dlq-discard-write" => {
            let dlq_id = bounded_text_arg(arg_value(args, "--dlq-id"), "", 180);
            let task_id = bounded_text_arg(arg_value(args, "--task-id"), "", 180);
            if dlq_id.trim().is_empty() && task_id.trim().is_empty() {
                return Err("Missing --dlq-id or --task-id".to_string());
            }
            let reviewer = bounded_text_arg(arg_value(args, "--reviewer"), "ui", 80);
            let note = bounded_text_arg(arg_value(args, "--note"), "", 500);
            let mut built = vec![
                "stock-feedback".into(),
                "dlq".into(),
                if action == "stock-feedback-dlq-retry-write" { "retry".into() } else { "discard".into() },
                "--reviewer".into(),
                reviewer,
            ];
            if !dlq_id.trim().is_empty() {
                built.push("--dlq-id".into());
                built.push(dlq_id);
            }
            if !task_id.trim().is_empty() {
                built.push("--task-id".into());
                built.push(task_id);
            }
            if !note.trim().is_empty() {
                built.push("--note".into());
                built.push(note);
            }
            built.push("--write".into());
            built
        },
        "stock-feedback-paper-trade-agent-dry-run" | "stock-feedback-paper-trade-agent-write" => {
            let limit = bounded_numeric_arg(arg_value(args, "--limit"), "12", 100);
            let mut built = vec![
                "stock-feedback".into(),
                "paper-trade-agent".into(),
                "candidates".into(),
                "--limit".into(),
                limit,
            ];
            if action == "stock-feedback-paper-trade-agent-write" {
                built.push("--write".into());
            }
            built
        },
        "stock-feedback-paper-trade-status" => {
            let limit = bounded_numeric_arg(arg_value(args, "--limit"), "8", 100);
            vec![
                "stock-feedback".into(),
                "paper-trade".into(),
                "status".into(),
                "--limit".into(),
                limit,
            ]
        },
        "stock-feedback-paper-trade-discretionary-review" => {
            let limit = bounded_numeric_arg(arg_value(args, "--limit"), "8", 100);
            vec![
                "stock-feedback".into(),
                "paper-trade".into(),
                "discretionary-review".into(),
                "--limit".into(),
                limit,
            ]
        },
        "stock-feedback-paper-trade-record-dry-run" | "stock-feedback-paper-trade-record-write" => {
            let track = sanitize_stock_feedback_paper_trade_track(arg_value(args, "--track"));
            let status = sanitize_stock_feedback_paper_trade_status(arg_value(args, "--status"));
            let stock_code = bounded_text_arg(arg_value(args, "--stock-code"), "", 32);
            let stock_name = bounded_text_arg(arg_value(args, "--stock-name"), "", 80);
            if stock_code.trim().is_empty() && stock_name.trim().is_empty() {
                return Err("Missing --stock-code or --stock-name".to_string());
            }
            let as_of_date = bounded_text_arg(Some(require_arg(args, "--as-of-date")?), "", 32);
            let entry_date = bounded_text_arg(Some(require_arg(args, "--entry-date")?), "", 32);
            let entry_price = bounded_text_arg(Some(require_arg(args, "--entry-price")?), "", 32);
            let source_refs = bounded_text_arg(Some(require_arg(args, "--source-refs")?), "", 1000);
            let evidence_refs = bounded_text_arg(Some(require_arg(args, "--evidence-refs")?), "", 1000);
            let validation_target = sanitize_stock_feedback_validation_target(arg_value(args, "--validation-target"));
            let auto_market_evidence = args.iter().any(|arg| arg == "--auto-market-evidence");
            let auto_microstructure_evidence = args.iter().any(|arg| arg == "--auto-microstructure-evidence");
            let optional = [
                ("--source-question-id", bounded_text_arg(arg_value(args, "--source-question-id"), "", 180)),
                ("--source-trajectory-id", bounded_text_arg(arg_value(args, "--source-trajectory-id"), "", 180)),
                ("--hypothesis", bounded_text_arg(arg_value(args, "--hypothesis"), "", 500)),
                ("--expected-move", bounded_text_arg(arg_value(args, "--expected-move"), "", 300)),
                ("--entry-timing", bounded_text_arg(arg_value(args, "--entry-timing"), "", 160)),
                ("--exit-date", bounded_text_arg(arg_value(args, "--exit-date"), "", 32)),
                ("--exit-price", bounded_text_arg(arg_value(args, "--exit-price"), "", 32)),
                ("--exit-timing", bounded_text_arg(arg_value(args, "--exit-timing"), "", 160)),
                ("--exit-reason", bounded_text_arg(arg_value(args, "--exit-reason"), "", 260)),
                ("--position-sizing", bounded_text_arg(arg_value(args, "--position-sizing"), "", 160)),
                ("--realized-pnl-pct", bounded_text_arg(arg_value(args, "--realized-pnl-pct"), "", 32)),
                ("--max-drawdown-pct", bounded_text_arg(arg_value(args, "--max-drawdown-pct"), "", 32)),
                ("--holding-days", bounded_text_arg(arg_value(args, "--holding-days"), "", 32)),
                ("--market-evidence-provider", bounded_text_arg(arg_value(args, "--market-evidence-provider"), "", 32)),
                ("--market-evidence-benchmark-code", bounded_text_arg(arg_value(args, "--market-evidence-benchmark-code"), "", 32)),
                ("--market-evidence-lookahead-days", bounded_numeric_arg(arg_value(args, "--market-evidence-lookahead-days"), "", 60)),
                ("--market-evidence-sql-limit", bounded_numeric_arg(arg_value(args, "--market-evidence-sql-limit"), "", 80)),
                ("--market-evidence-start-date", bounded_text_arg(arg_value(args, "--market-evidence-start-date"), "", 32)),
                ("--market-evidence-end-date", bounded_text_arg(arg_value(args, "--market-evidence-end-date"), "", 32)),
                ("--price-sql-ref", bounded_text_arg(arg_value(args, "--price-sql-ref"), "", 260)),
                ("--market-data-ref", bounded_text_arg(arg_value(args, "--market-data-ref"), "", 260)),
                ("--market-evidence-source", bounded_text_arg(arg_value(args, "--market-evidence-source"), "", 80)),
                ("--market-evidence-rows", bounded_numeric_arg(arg_value(args, "--market-evidence-rows"), "", 120)),
                ("--period-return-pct", bounded_text_arg(arg_value(args, "--period-return-pct"), "", 32)),
                ("--relative-strength", bounded_text_arg(arg_value(args, "--relative-strength"), "", 32)),
                ("--relative-strength-basis", bounded_text_arg(arg_value(args, "--relative-strength-basis"), "", 120)),
                ("--turnover-change", bounded_text_arg(arg_value(args, "--turnover-change"), "", 32)),
                ("--follow-through-1d", bounded_text_arg(arg_value(args, "--follow-through-1d"), "", 32)),
                ("--follow-through-3d", bounded_text_arg(arg_value(args, "--follow-through-3d"), "", 32)),
                ("--follow-through-5d", bounded_text_arg(arg_value(args, "--follow-through-5d"), "", 32)),
                ("--max-drawdown-in-holding", bounded_text_arg(arg_value(args, "--max-drawdown-in-holding"), "", 32)),
                ("--tushare-timeout-ms", bounded_numeric_arg(arg_value(args, "--tushare-timeout-ms"), "", 30_000)),
                ("--pg-connect-timeout-ms", bounded_numeric_arg(arg_value(args, "--pg-connect-timeout-ms"), "", 30_000)),
                ("--pg-statement-timeout-ms", bounded_numeric_arg(arg_value(args, "--pg-statement-timeout-ms"), "", 60_000)),
                ("--generated-at", bounded_text_arg(arg_value(args, "--generated-at"), "", 40)),
            ];
            let mut built = vec![
                "stock-feedback".into(),
                "paper-trade".into(),
                "record".into(),
                "--track".into(),
                track,
                "--validation-target".into(),
                validation_target,
                "--as-of-date".into(),
                as_of_date,
                "--entry-date".into(),
                entry_date,
                "--entry-price".into(),
                entry_price,
                "--source-refs".into(),
                source_refs,
                "--evidence-refs".into(),
                evidence_refs,
            ];
            if !status.trim().is_empty() {
                built.push("--status".into());
                built.push(status);
            }
            if !stock_code.trim().is_empty() {
                built.push("--stock-code".into());
                built.push(stock_code);
            }
            if !stock_name.trim().is_empty() {
                built.push("--stock-name".into());
                built.push(stock_name);
            }
            if auto_market_evidence {
                built.push("--auto-market-evidence".into());
            }
            if auto_microstructure_evidence {
                built.push("--auto-microstructure-evidence".into());
            }
            for (flag, value) in optional {
                if !value.trim().is_empty() {
                    built.push(flag.into());
                    built.push(value);
                }
            }
            if action == "stock-feedback-paper-trade-record-write" {
                built.push("--write".into());
            }
            built
        },
        "stock-feedback-paper-trade-settle-dry-run" | "stock-feedback-paper-trade-settle-write" => {
            let paper_trade_id = bounded_text_arg(Some(require_arg(args, "--paper-trade-id")?), "", 180);
            let exit_date = bounded_text_arg(Some(require_arg(args, "--exit-date")?), "", 32);
            let exit_price = bounded_text_arg(Some(require_arg(args, "--exit-price")?), "", 32);
            let auto_market_evidence = args.iter().any(|arg| arg == "--auto-market-evidence");
            let auto_microstructure_evidence = args.iter().any(|arg| arg == "--auto-microstructure-evidence");
            let optional = [
                ("--exit-timing", bounded_text_arg(arg_value(args, "--exit-timing"), "", 160)),
                ("--exit-reason", bounded_text_arg(arg_value(args, "--exit-reason"), "", 260)),
                ("--position-sizing", bounded_text_arg(arg_value(args, "--position-sizing"), "", 160)),
                ("--entry-timing", bounded_text_arg(arg_value(args, "--entry-timing"), "", 160)),
                ("--realized-pnl-pct", bounded_text_arg(arg_value(args, "--realized-pnl-pct"), "", 32)),
                ("--max-drawdown-pct", bounded_text_arg(arg_value(args, "--max-drawdown-pct"), "", 32)),
                ("--holding-days", bounded_text_arg(arg_value(args, "--holding-days"), "", 32)),
                ("--source-refs", bounded_text_arg(arg_value(args, "--source-refs"), "", 1000)),
                ("--evidence-refs", bounded_text_arg(arg_value(args, "--evidence-refs"), "", 1000)),
                ("--market-evidence-provider", bounded_text_arg(arg_value(args, "--market-evidence-provider"), "", 32)),
                ("--market-evidence-benchmark-code", bounded_text_arg(arg_value(args, "--market-evidence-benchmark-code"), "", 32)),
                ("--market-evidence-lookahead-days", bounded_numeric_arg(arg_value(args, "--market-evidence-lookahead-days"), "", 60)),
                ("--market-evidence-sql-limit", bounded_numeric_arg(arg_value(args, "--market-evidence-sql-limit"), "", 80)),
                ("--market-evidence-end-date", bounded_text_arg(arg_value(args, "--market-evidence-end-date"), "", 32)),
                ("--price-sql-ref", bounded_text_arg(arg_value(args, "--price-sql-ref"), "", 260)),
                ("--market-data-ref", bounded_text_arg(arg_value(args, "--market-data-ref"), "", 260)),
                ("--market-evidence-source", bounded_text_arg(arg_value(args, "--market-evidence-source"), "", 80)),
                ("--market-evidence-rows", bounded_numeric_arg(arg_value(args, "--market-evidence-rows"), "", 120)),
                ("--period-return-pct", bounded_text_arg(arg_value(args, "--period-return-pct"), "", 32)),
                ("--relative-strength", bounded_text_arg(arg_value(args, "--relative-strength"), "", 32)),
                ("--relative-strength-basis", bounded_text_arg(arg_value(args, "--relative-strength-basis"), "", 120)),
                ("--turnover-change", bounded_text_arg(arg_value(args, "--turnover-change"), "", 32)),
                ("--follow-through-1d", bounded_text_arg(arg_value(args, "--follow-through-1d"), "", 32)),
                ("--follow-through-3d", bounded_text_arg(arg_value(args, "--follow-through-3d"), "", 32)),
                ("--follow-through-5d", bounded_text_arg(arg_value(args, "--follow-through-5d"), "", 32)),
                ("--max-drawdown-in-holding", bounded_text_arg(arg_value(args, "--max-drawdown-in-holding"), "", 32)),
                ("--tushare-timeout-ms", bounded_numeric_arg(arg_value(args, "--tushare-timeout-ms"), "", 30_000)),
                ("--pg-connect-timeout-ms", bounded_numeric_arg(arg_value(args, "--pg-connect-timeout-ms"), "", 30_000)),
                ("--pg-statement-timeout-ms", bounded_numeric_arg(arg_value(args, "--pg-statement-timeout-ms"), "", 60_000)),
                ("--reviewer", bounded_text_arg(arg_value(args, "--reviewer"), "ui", 80)),
                ("--generated-at", bounded_text_arg(arg_value(args, "--generated-at"), "", 40)),
            ];
            let mut built = vec![
                "stock-feedback".into(),
                "paper-trade".into(),
                "settle".into(),
                "--paper-trade-id".into(),
                paper_trade_id,
                "--exit-date".into(),
                exit_date,
                "--exit-price".into(),
                exit_price,
            ];
            if auto_market_evidence {
                built.push("--auto-market-evidence".into());
            }
            if auto_microstructure_evidence {
                built.push("--auto-microstructure-evidence".into());
            }
            for (flag, value) in optional {
                if !value.trim().is_empty() {
                    built.push(flag.into());
                    built.push(value);
                }
            }
            if action == "stock-feedback-paper-trade-settle-write" {
                built.push("--write".into());
            }
            built
        },
        "stock-feedback-build-dry-run" | "stock-feedback-build-write" => {
            let mut built = vec![
                "stock-feedback".into(),
                "build-trajectories".into(),
            ];
            if action == "stock-feedback-build-write" {
                built.push("--write".into());
            }
            built
        }
        "stock-feedback-list" => {
            let validation_target = bounded_text_arg(arg_value(args, "--validation-target"), "", 64);
            let quality_gate = bounded_text_arg(arg_value(args, "--quality-gate"), "", 64);
            let market_pattern = bounded_text_arg(arg_value(args, "--market-pattern"), "", 80);
            let stock = bounded_text_arg(arg_value(args, "--stock"), "", 80);
            let hypothesis = bounded_text_arg(arg_value(args, "--hypothesis"), "", 180);
            let date = bounded_text_arg(arg_value(args, "--date"), "", 24);
            let limit = bounded_numeric_arg(arg_value(args, "--limit"), "50", 300);
            let mut built = vec![
                "stock-feedback".into(),
                "list".into(),
                "--limit".into(),
                limit,
            ];
            if !validation_target.trim().is_empty() {
                built.push("--validation-target".into());
                built.push(validation_target);
            }
            if !quality_gate.trim().is_empty() {
                built.push("--quality-gate".into());
                built.push(quality_gate);
            }
            if !market_pattern.trim().is_empty() {
                built.push("--market-pattern".into());
                built.push(market_pattern);
            }
            if !stock.trim().is_empty() {
                built.push("--stock".into());
                built.push(stock);
            }
            if !hypothesis.trim().is_empty() {
                built.push("--hypothesis".into());
                built.push(hypothesis);
            }
            if !date.trim().is_empty() {
                built.push("--date".into());
                built.push(date);
            }
            built
        }
        "stock-feedback-review-queue" => {
            let limit = bounded_numeric_arg(arg_value(args, "--limit"), "80", 300);
            let market_pattern = bounded_text_arg(arg_value(args, "--market-pattern"), "", 80);
            let mut built = vec![
                "stock-feedback".into(),
                "review-queue".into(),
                "--include-reviewed".into(),
                "true".into(),
                "--limit".into(),
                limit,
            ];
            if !market_pattern.trim().is_empty() {
                built.push("--market-pattern".into());
                built.push(market_pattern);
            }
            built
        }
        "stock-feedback-review-dry-run" | "stock-feedback-review-write" => {
            let trajectory_id = require_arg(args, "--trajectory-id")?;
            let review_action = sanitize_stock_feedback_review_action(arg_value(args, "--action"));
            let reviewer = bounded_text_arg(arg_value(args, "--reviewer"), "ui", 80);
            let note = bounded_text_arg(arg_value(args, "--note"), "", 500);
            let mut built = vec![
                "stock-feedback".into(),
                "review".into(),
                "--trajectory-id".into(),
                bounded_text_arg(Some(trajectory_id), "", 180),
                "--action".into(),
                review_action,
                "--reviewer".into(),
                reviewer,
            ];
            if !note.trim().is_empty() {
                built.push("--note".into());
                built.push(note);
            }
            if action == "stock-feedback-review-write" {
                built.push("--write".into());
            }
            built
        }
        "stock-feedback-collection-task-dry-run" | "stock-feedback-collection-task-write" => {
            let market_pattern = bounded_text_arg(arg_value(args, "--market-pattern"), "", 80);
            let profit_credit = sanitize_stock_feedback_profit_credit(arg_value(args, "--profit-credit"));
            let mut built = vec![
                "stock-feedback".into(),
                "collection-task".into(),
            ];
            if !market_pattern.trim().is_empty() {
                built.push("--market-pattern".into());
                built.push(market_pattern);
            }
            if !profit_credit.trim().is_empty() {
                built.push("--profit-credit".into());
                built.push(profit_credit);
            }
            if action == "stock-feedback-collection-task-write" {
                built.push("--write".into());
            }
            built
        }
        "stock-feedback-collection-result-dry-run" | "stock-feedback-collection-result-write" => {
            let market_pattern = bounded_text_arg(arg_value(args, "--market-pattern"), "", 80);
            let profit_credit = sanitize_stock_feedback_profit_credit(arg_value(args, "--profit-credit"));
            let draft_id = bounded_text_arg(arg_value(args, "--draft-id"), "", 180);
            let task_id = bounded_text_arg(arg_value(args, "--task-id"), "", 180);
            let result = sanitize_stock_feedback_collection_result(arg_value(args, "--result"));
            let evidence_refs = bounded_text_arg(arg_value(args, "--evidence-refs"), "", 1000);
            let summary = bounded_text_arg(arg_value(args, "--summary"), "", 700);
            let reviewer = bounded_text_arg(arg_value(args, "--reviewer"), "ui", 80);
            let mut built = vec![
                "stock-feedback".into(),
                "collection-result".into(),
                "--result".into(),
                result,
                "--reviewer".into(),
                reviewer,
            ];
            if !market_pattern.trim().is_empty() {
                built.push("--market-pattern".into());
                built.push(market_pattern);
            }
            if !profit_credit.trim().is_empty() {
                built.push("--profit-credit".into());
                built.push(profit_credit);
            }
            if !draft_id.trim().is_empty() {
                built.push("--draft-id".into());
                built.push(draft_id);
            }
            if !task_id.trim().is_empty() {
                built.push("--task-id".into());
                built.push(task_id);
            }
            if !evidence_refs.trim().is_empty() {
                built.push("--evidence-refs".into());
                built.push(evidence_refs);
            }
            if !summary.trim().is_empty() {
                built.push("--summary".into());
                built.push(summary);
            }
            if action == "stock-feedback-collection-result-write" {
                built.push("--write".into());
            }
            built
        }
        "stock-feedback-bench" => {
            let limit = bounded_numeric_arg(arg_value(args, "--limit"), "200", 1000);
            vec![
                "stock-feedback".into(),
                "bench".into(),
                "--limit".into(),
                limit,
            ]
        }
        "stock-feedback-export-lora-ready" => {
            let validation_target = bounded_text_arg(arg_value(args, "--validation-target"), "", 64);
            let quality_gate = bounded_text_arg(arg_value(args, "--quality-gate"), "high_confidence", 64);
            let limit = bounded_numeric_arg(arg_value(args, "--limit"), "500", 2000);
            let mut built = vec![
                "stock-feedback".into(),
                "export-lora-ready".into(),
                "--quality-gate".into(),
                quality_gate,
                "--limit".into(),
                limit,
                "--write".into(),
            ];
            if !validation_target.trim().is_empty() {
                built.push("--validation-target".into());
                built.push(validation_target);
            }
            built
        }
        "stock-feedback-verify" => vec![
            "stock-feedback".into(),
            "verify".into(),
        ],
        "policy-proposal-dry-run" | "policy-proposal-write" => {
            let min_score_delta = bounded_text_arg(arg_value(args, "--min-score-delta"), "1", 16);
            let changed_artifacts = bounded_text_arg(
                arg_value(args, "--changed-artifacts"),
                "segment_config,market_validator_params,evidence_task_priority",
                160,
            );
            let mut built = vec![
                "autoresearch".into(),
                "proposal".into(),
                "--min-score-delta".into(),
                min_score_delta,
                "--changed-artifacts".into(),
                changed_artifacts,
            ];
            if action == "policy-proposal-write" {
                built.push("--write".into());
            }
            built
        }
        "self-question-loop-dry-run" => {
            let stages = sanitize_stage_list(
                arg_value(args, "--stages"),
                "generate,validate,attribute,evidence,policy,self-train,self-train-plan,export",
            );
            vec![
                "self-question".into(),
                "loop".into(),
                "--stages".into(),
                stages,
                "--profile".into(),
                "local-max".into(),
                "--no-loop-artifacts".into(),
            ]
        }
        "self-question-status" => vec![
            "self-question".into(),
            "phase-status".into(),
            "--action-limit".into(),
            "20".into(),
            "--plan-limit".into(),
            "10".into(),
            "--export-limit".into(),
            "10".into(),
        ],
        "self-train-next" => {
            let limit = bounded_numeric_arg(arg_value(args, "--limit"), "8", 100);
            vec![
                "self-train".into(),
                "next".into(),
                "--limit".into(),
                limit,
            ]
        }
        "self-train-plan-dry-run" | "self-train-plan-write" => {
            let limit = bounded_numeric_arg(arg_value(args, "--limit"), "5", 50);
            let mut built = vec![
                "self-train".into(),
                "plan".into(),
                "--limit".into(),
                limit,
            ];
            if action == "self-train-plan-write" {
                built.push("--write".into());
            }
            built
        }
        "wechat-process" => vec![
            "hypothesis".into(),
            "wechat-inbox".into(),
            "process".into(),
        ],
        "wechat-source-list" => {
            let source = bounded_project_source_arg(
                arg_value(args, "--source"),
                "raw/微信聊天",
                240,
                project_path,
            )?;
            let limit = bounded_numeric_arg(arg_value(args, "--limit"), "20", 100);
            vec![
                "hypothesis".into(),
                "wechat-inbox".into(),
                "sources".into(),
                "--source".into(),
                source,
                "--limit".into(),
                limit,
            ]
        }
        "wechat-import-raw-dry-run" | "wechat-import-raw-write" => {
            let source = bounded_project_source_arg(
                arg_value(args, "--source"),
                "raw/微信聊天",
                240,
                project_path,
            )?;
            let limit = bounded_numeric_arg(arg_value(args, "--limit"), "200", 5000);
            let since = arg_value(args, "--since").map(|value| bounded_text_arg(Some(value), "", 24));
            let mut built = vec![
                "hypothesis".into(),
                "wechat-inbox".into(),
                "import-raw".into(),
                "--source".into(),
                source,
                "--limit".into(),
                limit,
            ];
            if let Some(value) = since.filter(|item| !item.trim().is_empty()) {
                built.push("--since".into());
                built.push(value);
            }
            if action == "wechat-import-raw-write" {
                built.push("--write".into());
            }
            built
        }
        "wechat-status" => vec![
            "hypothesis".into(),
            "wechat-inbox".into(),
            "status".into(),
        ],
        "observation-draft-list" => {
            let limit = bounded_numeric_arg(arg_value(args, "--limit"), "8", 50);
            let date = bounded_text_arg(arg_value(args, "--date"), "", 24);
            let mut built = vec![
                "hypothesis".into(),
                "observation-drafts".into(),
                "--limit".into(),
                limit,
            ];
            if !date.trim().is_empty() {
                built.push("--date".into());
                built.push(date);
            }
            built
        }
        "observation-draft-write" => {
            let title = require_arg(args, "--title")?;
            let stocks = bounded_text_arg(arg_value(args, "--stocks"), "", 1000);
            let ranking = bounded_text_arg(arg_value(args, "--ranking"), "", 1000);
            let gap = bounded_text_arg(arg_value(args, "--gap"), "", 1000);
            let next_action = bounded_text_arg(arg_value(args, "--next-action"), "", 1000);
            let hypothesis_id = bounded_text_arg(arg_value(args, "--hypothesis-id"), "", 180);
            let wiki_frame_label = bounded_text_arg(arg_value(args, "--wiki-frame-label"), "", 180);
            let wiki_frame_source_ref = bounded_text_arg(arg_value(args, "--wiki-frame-source-ref"), "", 400);
            let wiki_frame_meta_line = bounded_text_arg(arg_value(args, "--wiki-frame-meta-line"), "", 1000);
            let source_refs = bounded_text_arg(arg_value(args, "--source-refs"), "", 1200);
            let ask_query = bounded_text_arg(arg_value(args, "--ask-query"), "", 4000);
            let copy_text = bounded_text_arg(arg_value(args, "--copy-text"), "", 8000);
            let mut built = vec![
                "hypothesis".into(),
                "observation-draft".into(),
                "--title".into(),
                bounded_text_arg(Some(title), "", 180),
                "--write".into(),
            ];
            let optional = [
                ("--hypothesis-id", hypothesis_id),
                ("--stocks", stocks),
                ("--ranking", ranking),
                ("--gap", gap),
                ("--next-action", next_action),
                ("--wiki-frame-label", wiki_frame_label),
                ("--wiki-frame-source-ref", wiki_frame_source_ref),
                ("--wiki-frame-meta-line", wiki_frame_meta_line),
                ("--source-refs", source_refs),
                ("--ask-query", ask_query),
                ("--copy-text", copy_text),
            ];
            for (flag, value) in optional {
                if !value.trim().is_empty() {
                    built.push(flag.into());
                    built.push(value);
                }
            }
            built
        }
        "hypothesis-supplement-dry-run" | "hypothesis-supplement-write" => {
            let title = require_arg(args, "--title")?;
            let body = require_arg(args, "--body")?;
            let kind = bounded_text_arg(arg_value(args, "--kind"), "manual", 48);
            let source_refs = bounded_text_arg(arg_value(args, "--source-refs"), "", 1000);
            let hypothesis_id = bounded_text_arg(arg_value(args, "--hypothesis-id"), "", 180);
            let mut built = vec![
                "hypothesis".into(),
                "supplement".into(),
                "--title".into(),
                bounded_text_arg(Some(title), "补充资料", 120),
                "--body".into(),
                bounded_text_arg(Some(body), "", 12000),
                "--kind".into(),
                kind,
            ];
            if !source_refs.trim().is_empty() {
                built.push("--source-refs".into());
                built.push(source_refs);
            }
            if !hypothesis_id.trim().is_empty() {
                built.push("--hypothesis-id".into());
                built.push(hypothesis_id);
            }
            if action == "hypothesis-supplement-write" {
                built.push("--write".into());
            }
            built
        }
        "hypothesis-supplement-draft" => {
            let body = require_arg(args, "--body")?;
            let source_refs = bounded_text_arg(arg_value(args, "--source-refs"), "", 1000);
            let hypothesis_id = bounded_text_arg(arg_value(args, "--hypothesis-id"), "", 180);
            let selected_sources = bounded_text_arg(arg_value(args, "--selected-sources"), "", 400);
            let provider = bounded_text_arg(arg_value(args, "--provider"), "codex", 24);
            let api_key = bounded_text_arg(arg_value(args, "--api-key"), "", 400);
            let endpoint = bounded_text_arg(arg_value(args, "--endpoint"), "", 400);
            let model = bounded_text_arg(arg_value(args, "--model"), "", 200);
            let timeout = bounded_numeric_arg(arg_value(args, "--timeout-ms"), "300000", 900000);
            let ima_timeout = bounded_numeric_arg(arg_value(args, "--ima-timeout-ms"), "8000", 60000);
            let ima_max_knowledge_bases =
                bounded_numeric_arg(arg_value(args, "--ima-max-knowledge-bases"), "2", 10);
            let ima_max_hits = bounded_numeric_arg(arg_value(args, "--ima-max-hits"), "3", 20);
            let ima_max_queries = bounded_numeric_arg(arg_value(args, "--ima-max-queries"), "1", 8);
            let mut built = vec![
                "hypothesis".into(),
                "supplement-draft".into(),
                "--body".into(),
                bounded_text_arg(Some(body), "", 12000),
                "--provider".into(),
                if provider == "codex" { "codex".into() } else { "openai".into() },
                "--timeout-ms".into(),
                timeout,
                "--ima-timeout-ms".into(),
                ima_timeout,
                "--ima-max-knowledge-bases".into(),
                ima_max_knowledge_bases,
                "--ima-max-hits".into(),
                ima_max_hits,
                "--ima-max-queries".into(),
                ima_max_queries,
            ];
            if !api_key.trim().is_empty() {
                built.push("--api-key".into());
                built.push(api_key);
            }
            if !endpoint.trim().is_empty() {
                built.push("--endpoint".into());
                built.push(endpoint);
            }
            if !model.trim().is_empty() {
                built.push("--model".into());
                built.push(model);
            }
            if !source_refs.trim().is_empty() {
                built.push("--source-refs".into());
                built.push(source_refs);
            }
            if !hypothesis_id.trim().is_empty() {
                built.push("--hypothesis-id".into());
                built.push(hypothesis_id);
            }
            if !selected_sources.trim().is_empty() {
                built.push("--selected-sources".into());
                built.push(selected_sources);
            }
            built
        }
        "watch-dry-run" | "watch-write" => {
            let since = arg_value(args, "--since").unwrap_or_else(|| "30m".to_string());
            let sources = arg_value(args, "--sources").unwrap_or_else(|| "wechat_incremental".to_string());
            let hypothesis_id = bounded_text_arg(arg_value(args, "--hypothesis-id"), "", 180);
            let limit = bounded_numeric_arg(arg_value(args, "--limit"), "100", 500);
            let llm_review = bounded_text_arg(arg_value(args, "--llm-review"), "off", 16);
            let llm_review = match llm_review.as_str() {
                "auto" | "force" => llm_review,
                _ => "off".to_string(),
            };
            let llm_review_max_items =
                bounded_numeric_arg(arg_value(args, "--llm-review-max-items"), "8", 20);
            let llm_review_timeout =
                bounded_numeric_arg(arg_value(args, "--llm-review-timeout-ms"), "120000", 300000);
            let provider = arg_value(args, "--provider").unwrap_or_else(|| "codex".to_string());
            let api_key = arg_value(args, "--api-key").unwrap_or_default();
            let endpoint = arg_value(args, "--endpoint").unwrap_or_default();
            let model = arg_value(args, "--model").unwrap_or_default();
            let mut built = vec![
                "hypothesis".into(),
                "watch".into(),
                "--since".into(),
                since,
                "--sources".into(),
                sources,
                "--limit".into(),
                limit,
                "--llm-review".into(),
                llm_review,
                "--llm-review-max-items".into(),
                llm_review_max_items,
                "--llm-review-timeout-ms".into(),
                llm_review_timeout,
                "--provider".into(),
                provider,
            ];
            if !api_key.trim().is_empty() {
                built.push("--api-key".into());
                built.push(api_key);
            }
            if !endpoint.trim().is_empty() {
                built.push("--endpoint".into());
                built.push(endpoint);
            }
            if !model.trim().is_empty() {
                built.push("--model".into());
                built.push(model);
            }
            if !hypothesis_id.trim().is_empty() {
                built.push("--hypothesis-id".into());
                built.push(hypothesis_id);
            }
            if action == "watch-write" {
                built.push("--write".into());
            }
            if args.contains(&"--compact".to_string()) {
                built.push("--compact".into());
            }
            append_default_finance_entity_audit_roots(&mut built);
            built
        }
        "validate" => {
            let id = require_arg(args, "--id")?;
            let window = arg_value(args, "--window").unwrap_or_else(|| "20d".to_string());
            vec![
                "hypothesis".into(),
                "validate".into(),
                "--id".into(),
                id,
                "--window".into(),
                window,
            ]
        }
        "report" => {
            let id = require_arg(args, "--id")?;
            vec![
                "hypothesis".into(),
                "report".into(),
                "--id".into(),
                id,
                "--json".into(),
            ]
        }
        "ima-sync" => {
            // IMA 研报同步（Node 内置实现，无 LLM 依赖）。
            // 子模式：extract / status / folders / check（只比对不下载）/ sync。
            let mode = bounded_text_arg(arg_value(args, "--mode"), "sync", 16);
            let har = bounded_text_arg(arg_value(args, "--har"), "", 2000);
            let out = bounded_text_arg(arg_value(args, "--out"), "", 1000);
            let folder = bounded_text_arg(arg_value(args, "--folder"), "", 200);
            let kb = bounded_text_arg(arg_value(args, "--kb"), "", 64);
            let mut built = vec!["ima-sync".into(), "--mode".into(), mode];
            if !har.is_empty() {
                built.push("--har".into());
                built.push(har);
            }
            if !out.is_empty() {
                built.push("--out".into());
                built.push(out);
            }
            if !folder.is_empty() {
                built.push("--folder".into());
                built.push(folder);
            }
            if !kb.is_empty() {
                built.push("--kb".into());
                built.push(kb);
            }
            built
        }
        _ => return Err(format!("Unsupported research cockpit action: {}", action)),
    };
    cli_args.push("--project".into());
    cli_args.push(project_path.to_string());
    Ok(cli_args)
}

fn safe_output(bytes: &[u8]) -> Result<String, String> {
    if bytes.len() > MAX_OUTPUT_BYTES {
        return Err("Command output exceeded Research Cockpit limit.".to_string());
    }
    Ok(String::from_utf8_lossy(bytes).to_string())
}

fn resolve_node_binary() -> String {
    if let Ok(value) = std::env::var("NODE_BINARY") {
        if !value.trim().is_empty() {
            return value;
        }
    }
    #[cfg(target_os = "windows")]
    {
        for candidate in [
            "C:\\Program Files\\nodejs\\node.exe",
            "C:\\Program Files (x86)\\nodejs\\node.exe",
        ] {
            if Path::new(candidate).exists() {
                return candidate.to_string();
            }
        }
    }
    for candidate in ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"] {
        if Path::new(candidate).exists() {
            return candidate.to_string();
        }
    }
    "node".to_string()
}

#[tauri::command]
pub async fn run_research_cockpit_command(
    app_handle: tauri::AppHandle,
    project_path: String,
    action: String,
    args: Vec<String>,
) -> Result<String, String> {
    if project_path.trim().is_empty() {
        return Err("projectPath is required.".to_string());
    }
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let repo_root = manifest_dir
        .parent()
        .ok_or_else(|| "Unable to resolve repository root.".to_string())?;
    let script_path = repo_root.join("scripts").join("codex-ingest.mjs");
    let cli_args = build_allowed_args(&action, &args, &project_path)?;
    let node = resolve_node_binary();

    let result = tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        let mut cmd = Command::new(&node);
        cmd.arg(&script_path)
            .args(&cli_args)
            .current_dir(&repo_root)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        // Feed api-key via env where possible to avoid plaintext in the argv process list.
        if let Some(pos) = cli_args.iter().position(|a| a == "--api-key") {
            if let Some(key) = cli_args.get(pos + 1) {
                if !key.is_empty() {
                    cmd.env("OPENAI_API_KEY", key);
                }
            }
        }
        let mut child = cmd
            .spawn()
            .map_err(|err| format!("Failed to run Research Cockpit command: {}", err))?;

        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "Failed to capture stderr.".to_string())?;
        let stderr_acc = std::sync::Arc::new(std::sync::Mutex::new(String::new()));
        let app_stderr = app_handle.clone();
        let action_stderr = action.clone();
        let stderr_acc_clone = stderr_acc.clone();
        let stderr_thread = std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().flatten() {
                if let Ok(mut g) = stderr_acc_clone.lock() {
                    g.push_str(&line);
                    g.push('\n');
                }
                let _ = app_stderr.emit(
                    "research-cockpit-progress",
                    serde_json::json!({ "action": action_stderr, "stream": "stderr", "line": line }),
                );
            }
        });

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Failed to capture stdout.".to_string())?;
        let reader = BufReader::new(stdout);
        let mut stdout_out = String::new();
        for line in reader.lines().flatten() {
            stdout_out.push_str(&line);
            stdout_out.push('\n');
            let _ = app_handle.emit(
                "research-cockpit-progress",
                serde_json::json!({ "action": action.clone(), "stream": "stdout", "line": line }),
            );
        }

        let status = child
            .wait()
            .map_err(|e| format!("Failed to wait for command: {}", e))?;
        let _ = stderr_thread.join();
        if !status.success() {
            let err = stderr_acc.lock().map(|g| g.clone()).unwrap_or_default();
            return Err(format!(
                "Research Cockpit command failed with status {}. stderr: {}",
                status,
                err.trim()
            ));
        }
        Ok(stdout_out)
    })
    .await
    .map_err(|e| format!("Research Cockpit runtime error: {}", e))??;

    safe_output(result.as_bytes())
}
