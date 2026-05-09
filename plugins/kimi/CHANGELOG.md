# kimi plugin — Changelog

## [Unreleased]

Auto-handoff and watch mode. `plan.md` is now the only artifact required across plan → code → review. `/kimi:code` auto-chains review on success; `/kimi:review` accepts `plan.md` positionally and finds the latest code job. Reviewer is enforced read-only via a Kimi `--agent-file` (no Shell, no Write tools). Post-run audit flags any write that escapes the worktree. `--watch` mode adds a heartbeat for `Bash(run_in_background: true)`. `--timeout-ms` and minimum-Kimi-version check round it out.

See repo-level `CHANGELOG.md` for the detailed list.

## [0.1.0] - 2026-05-09

Initial release. See repo-level `CHANGELOG.md` for details.
