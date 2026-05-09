# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added
- **Plan auto-materialization**: `/kimi:code` no longer requires a plan path. When called without one, Claude composes a plan from the current conversation, shows it for confirmation, then materializes it via `runner plan write` before delegating. Plans land under `~/.kimi-plugin-cc/state/<repo-hash>/plans/<slug>-<ts>.md` so the caller's repo stays clean.
- **`/kimi:plan` command**: explicit "write a plan from this conversation" entrypoint. Same composition rules as the auto-fallback, but stops after writing — useful when you want to inspect/edit before delegating.
- **`runner plan write` subcommand**: reads plan markdown from stdin, validates it against the schema, writes to the per-repo plans dir, prints the absolute path. `--slug <s>` overrides the filename prefix.
- **Auto-review chain**: `/kimi:code` now runs `/kimi:review` automatically after a successful code phase. Pass `--no-review` to opt out. Exit code propagates the review verdict.
- **Plan-as-handoff for review**: `/kimi:review <plan.md>` (positional) looks up the latest code job for that plan id and reviews its worktree. Job ids are no longer needed as input.
- **Kimi `--agent-file` per command**: review and adversarial-review run with a Kimi agent profile that excludes Shell, WriteFile, StrReplaceFile, web tools, and the Agent tool — read-only is enforced on the Kimi side, not via prompt.
- **Path-containment audit**: after every code job, the stream-json log is scanned for write tool calls targeting absolute paths outside the worktree. Violations mark the job `blocked`.
- **`--watch` execution mode**: foreground with a 30-second heartbeat; recommended when calling from Claude with `Bash(run_in_background: true)`.
- **`--timeout-ms <N>` / `KIMI_TIMEOUT_MS` env**: caps any Kimi invocation; on timeout the child is SIGKILL'd and the job marked `failed`.
- **`--max-steps-per-turn <N>`**: pass-through to kimi-cli for capping reasoning steps.
- **Doctor: minimum Kimi version check** + agent-file existence check.
- **Failure tail in job meta**: when a job fails, the last 12 lines of stderr are stored in `meta.json` so `/kimi:status <id>` shows what went wrong without re-running.

### Changed
- `gitDiffWorktreeAgainstBase` now stages with `git add -A` before computing the diff so untracked files Kimi creates also appear in the review payload.
- `buildReviewArgs` switched from `--quiet` (deprecated alias) to explicit `--final-message-only`.

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
