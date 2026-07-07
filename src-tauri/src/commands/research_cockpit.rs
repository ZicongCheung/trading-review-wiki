use std::path::{Component, Path, PathBuf};
use std::process::Command;

const MAX_OUTPUT_BYTES: usize = 2_000_000;
const DEFAULT_FINANCE_ENTITY_AUDIT_ROOTS: [&str; 1] = [
    "/Users/jiegege/Desktop/杰杰杰/.llm-wiki/sag-entity-audit",
];
const ALLOWED_EXTERNAL_SIGNAL_SOURCE_ROOTS: [&str; 1] = ["/Users/jiegege/Desktop/杰杰杰/raw"];

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

fn project_bounded_path(project_path: &str, source: &str) -> bool {
    let project = Path::new(project_path);
    let source_path = Path::new(source);
    let candidate = if source_path.is_absolute() {
        source_path.to_path_buf()
    } else {
        project.join(source_path)
    };
    path_is_within(&candidate, project)
        || ALLOWED_EXTERNAL_SIGNAL_SOURCE_ROOTS
            .iter()
            .any(|root| path_is_within(&candidate, Path::new(root)))
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
    fn research_cockpit_source_path_allows_live_raw_signal_sources() {
        let project = temp_project_path();
        let live_raw = "/Users/jiegege/Desktop/杰杰杰/raw/openclaw数据/产业链复盘/gangtise_themes";

        let source = bounded_project_source_arg(
            Some(live_raw.to_string()),
            "raw/微信聊天",
            240,
            &project,
        )
        .expect("live raw signal source should be accepted");

        assert_eq!(source, live_raw);
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
    fn research_cockpit_source_path_rejects_live_raw_sibling_prefix() {
        let project = temp_project_path();
        let sibling = "/Users/jiegege/Desktop/杰杰杰/raw-sibling/openclaw数据/产业链复盘/gangtise_themes";

        let err = bounded_project_source_arg(
            Some(sibling.to_string()),
            "raw/微信聊天",
            240,
            &project,
        )
        .expect_err("live raw sibling prefix must be rejected");

        assert!(err.contains("approved live raw signal roots"));
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
            ],
            &project,
        )
        .expect("candidate ask precheck should be allowed");
        assert_eq!(precheck[0..3], ["ask", "--query", "候选假设预检"]);
        assert!(precheck.contains(&"--agentic".to_string()));
        assert!(precheck.contains(&"--show-context".to_string()));
        assert!(precheck.contains(&"--show-sources".to_string()));
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
    let roots = DEFAULT_FINANCE_ENTITY_AUDIT_ROOTS
        .iter()
        .filter(|root| Path::new(root).is_dir())
        .copied()
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
        "autoresearch-ledger" => vec![
            "autoresearch".into(),
            "ledger".into(),
        ],
        "autoresearch-status" => vec![
            "autoresearch".into(),
            "status".into(),
        ],
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
                "codex".into(),
                "--timeout-ms".into(),
                timeout,
            ];
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
            vec![
                "ask".into(),
                "--query".into(),
                bounded_text_arg(Some(query), "", 1000),
                "--agentic".into(),
                "--show-context".into(),
                "--show-sources".into(),
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
                if provider == "openai" { "openai".into() } else { "codex".into() },
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
                "codex".into(),
            ];
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
    for candidate in ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"] {
        if Path::new(candidate).exists() {
            return candidate.to_string();
        }
    }
    "node".to_string()
}

#[tauri::command]
pub fn run_research_cockpit_command(
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
    let output = Command::new(resolve_node_binary())
        .arg(script_path)
        .args(cli_args)
        .current_dir(repo_root)
        .output()
        .map_err(|err| format!("Failed to run Research Cockpit command: {}", err))?;

    if !output.status.success() {
        let stderr = safe_output(&output.stderr).unwrap_or_else(|_| "stderr too large".to_string());
        let stdout = safe_output(&output.stdout).unwrap_or_else(|_| "stdout too large".to_string());
        return Err(format!(
            "Research Cockpit command failed with status {}. stderr: {} stdout: {}",
            output.status,
            stderr.trim(),
            stdout.trim()
        ));
    }
    safe_output(&output.stdout)
}
