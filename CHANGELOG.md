# Changelog

All notable changes to this project will be documented in this file.

## [0.1.0] - 2026-05-09

### Added
- Initial plugin scaffold with `Plan → Code → Review` pipeline.
- `/kimi:doctor` — environment health check.
- `/kimi:code <plan.md>` — delegate coding work to Kimi inside an isolated git worktree.
- `/kimi:review` and `/kimi:adversarial-review` — Kimi-driven code review with structured JSON output.
- `/kimi:status`, `/kimi:result`, `/kimi:cancel` — background job management.
- `/kimi:setup --enable-review-gate` — optional Stop-hook review gate.
- Worktree and job artifacts isolated under `~/.kimi-plugin-cc/state/<repo-hash>/`; caller's repo stays clean.
- Subagent `kimi-coder` for transparent delegation.
- `tests/fake-kimi-bin/kimi` fixture so tests do not require a live Kimi install.
