---
name: kimi-cli-runtime
description: Reference for invoking the kimi-cli binary correctly from this plugin. Use when constructing kimi commands, debugging kimi exits, or wiring up new flows.
---

# Kimi CLI runtime

## Invocation modes used by this plugin

| Phase | Mode | Flags |
|---|---|---|
| Coding | non-interactive, structured, write-capable agent | `--print --afk --output-format=stream-json --agent-file <code.yaml> --work-dir <worktree>` |
| Resume coding | same + session continue | add `--continue` (cwd-based) |
| Review (fresh) | non-interactive, plain text, read-only agent | `--print --afk --output-format=text --final-message-only --agent-file <review.yaml> --work-dir <target>` |

## Why these flags

- `--print` — non-interactive; exits when the prompt is done.
- `--afk` — auto-approves tool calls AND auto-dismisses `AskUserQuestion`. Background runs need this; otherwise Kimi may stall waiting for input nobody is watching.
- `--output-format=stream-json` (coding only) — emits JSONL events; lets us tail tool calls and detect when work is happening.
- `--final-message-only` (review only) — prints final assistant message only; cleaner output to parse for the `KIMI_REVIEW_JSON:` line.
- `--agent-file <path>` — selects the Kimi agent profile. We ship two: `code.yaml` (write-capable, default tools) and `review.yaml` (excludes Shell, WriteFile, StrReplaceFile, Agent, web tools). The reviewer being read-only is enforced HERE, not in the prompt.
- `--work-dir <path>` — pins the workspace. We always pass an absolute worktree path so kimi's session-per-cwd resume key is stable.
- `--continue` — resume the most recent session in `<work-dir>`. Because each job has its own worktree, `--continue` is unambiguous.

## Exit codes

| Code | Meaning | Plugin behavior |
|---|---|---|
| 0 | success | mark job `done` |
| 75 | retryable (rate limit / 5xx / timeout) | retry once after a short backoff; if still 75, mark `failed_retryable` |
| other non-zero | fatal | mark `failed` |

See the runner's `runKimi()` for the retry implementation.

## What we deliberately do NOT use

- `--wire`: the broker / IPC mode. We chose one-shot CLI. If we ever need streaming events to multiple subscribers, revisit.
- `--yolo`: weaker than `--afk` (still pings on `AskUserQuestion`). Always prefer `--afk` for unattended runs.
- `--max-ralph-iterations`: the Ralph loop. Could be useful for very large epics; not wired up in v0.1.
