# 更新报告：Plugin-led 公司深研 V2

日期：2026-06-16
目标版本：`v0.11.0-codex-cli`
分支：`codex/agentic-recursive-ai`
提交前基线：`8a167c964fd6f9f664b44c2829a6cc4de27f0e1d`

## 一句话结论

本次更新把公司深研从“主程序先写深稿，插件再评审”升级为“插件优先”：主程序负责数据采集、证据包、底表、模型和写入边界，Data Analytics 先做模型/口径/证据质控，Public Equity Investing 直接产出主报告，Investment Banking 只在交易事项触发或显式强制时参与。

本报告是 v0.11.0 的公司深研专项说明；完整 main 合并说明见 `docs/发布说明-v0.11.0-main合并准备.md`，正式版本记录见 `CHANGELOG.md`。

## 主要变化

1. 新增 `company-research --deep --plugin-led` 推荐链路。
2. `--plugin-led` 默认只写 `.llm-wiki/company-research/**`，不写 `wiki/**`、`raw/**`，不触发真实交易。
3. Data Analytics 输出 `plugin-led/data-analytics-model-analysis.md`。
4. Public Equity Investing 分段生成主报告，先写 `plugin-led/plugin-led-company-report.md`。
5. 若完整性校验不通过，会自动追加一次修复，生成 `plugin-led/plugin-led-company-report-complete.md`。
6. 最终主报告路径以 `plugin-led/plugin-led.json` 的 `outputs.pluginLedReport` 为准。
7. `deep-company-report.md` 保留为兼容副本，避免旧 reviewer、skill 和脚本断裂。
8. `plugin-led/publish-readiness.json` 继续作为发布门禁；blocked 时只生成候选，不自动发布。
9. 旧 `--plugin-review/--plugin-optimize` 保留为回退和对照链路。
10. Autoresearch policy proposal 继续保持 review-gated，只写 `.llm-wiki/policy-proposals/**`，不自动应用。

## 涉及路径

代码：

- `scripts/codex-ingest/internal/company-research.mjs`
- `scripts/codex-ingest/cli/index.mjs`
- `scripts/codex-ingest/cli/args.mjs`
- `scripts/codex-ingest/cli/help.mjs`
- `scripts/codex-ingest/internal/autoresearch.mjs`
- `scripts/codex-ingest/internal/knowledge.mjs`
- `scripts/gangtise-meeting-clues-report.mjs`
- `scripts/codex-ingest-lib.test.mjs`

文档和教学材料：

- `README.md`
- `docs/CLI外部接入与使用指南.md`
- `docs/codex-ingest-cli使用手册.md`
- `docs/专业插件能力层集成说明.md`
- `docs/递归自训练交易AI框架报告.md`
- `docs/发布说明-v0.11.0-main合并准备.md`
- `docs/recursive-trading-ai-agent-skills-blueprint.md`
- `docs/recursive-trading-ai-presentation-outline.md`
- `docs/recursive-trading-ai-agent-skills-deck.pptx`
- `docs/recursive-trading-ai-agent-skills-deck.pdf`
- `outputs/recursive-trading-ai-system-roadmap.pptx`
- `outputs/recursive-trading-ai-system-roadmap.pdf`
- `outputs/recursive-trading-ai-system-roadmap-contact-sheet.png`
- `outputs/trading-cli-operation-tutorial.pptx`
- `outputs/trading-cli-operation-tutorial.pdf`
- `outputs/trading-cli-operation-tutorial-contact-sheet.png`

## 回退方式

提交后若需要精准回退本次更新，优先使用：

```sh
git revert <本次提交hash>
```

如果只想回退某一组文件，可以从提交前基线恢复：

```sh
git restore --source 8a167c964fd6f9f664b44c2829a6cc4de27f0e1d -- \
  scripts/codex-ingest/internal/company-research.mjs \
  scripts/codex-ingest/cli/index.mjs \
  scripts/codex-ingest/cli/args.mjs \
  scripts/codex-ingest/cli/help.mjs \
  scripts/codex-ingest/internal/autoresearch.mjs \
  scripts/codex-ingest/internal/knowledge.mjs \
  scripts/gangtise-meeting-clues-report.mjs \
  scripts/codex-ingest-lib.test.mjs \
  README.md \
  docs/CLI外部接入与使用指南.md \
  docs/递归自训练交易AI框架报告.md
```

新增文件回退：

```sh
git rm docs/codex-ingest-cli使用手册.md \
  docs/专业插件能力层集成说明.md \
  docs/更新报告-2026-06-16-plugin-led公司深研V2.md
```

如果本次提交包含 `outputs/**` 教学材料，也可以单独移除：

```sh
git rm outputs/recursive-trading-ai-system-roadmap.pptx \
  outputs/recursive-trading-ai-system-roadmap.pdf \
  outputs/recursive-trading-ai-system-roadmap-contact-sheet.png \
  outputs/trading-cli-operation-tutorial.pptx \
  outputs/trading-cli-operation-tutorial.pdf \
  outputs/trading-cli-operation-tutorial-contact-sheet.png
```

## 验收命令

提交前应执行：

```sh
npm test -- scripts/codex-ingest-lib.test.mjs
npm test -- --run
npm run build
git diff --check
```

## 注意

- 本次 repo 提交只覆盖仓库内文件。
- 本地 skill wrapper 若已改为默认 `--plugin-led`，它位于 `~/.codex/skills/company-deep-research/**`，不属于当前仓库提交范围；需要单独备份或在 skill 管理仓库里提交。
