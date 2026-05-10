# kimi-plugin-cc

**English** · [繁體中文](./README.zh-TW.md)

A Claude Code plugin that turns Kimi into your **delegate**: Claude plans, Kimi codes inside an isolated git worktree, then Kimi reviews its own (or anyone else's) diff against the plan.

> **Why this plugin exists**
>
> Claude is great at planning and conversation; Kimi is great at heads-down coding — and meaningfully cheaper per token, which adds up fast when implementation and review burn through context. So you get the best of both: keep Claude in its sweet spot, hand the token-heavy work over to Kimi.
>
> This plugin makes the handoff explicit: a structured `plan.md` is the contract, a worktree is the workspace, and a JSON-schema'd review is the verdict. Your main repo is never touched while Kimi works.

---

## What you get

| Command | Purpose |
|---|---|
| `/kimi:doctor` | Check `kimi-cli`, `git`, Node, kimi minimum version, and toggle the optional review gate. |
| `/kimi:plan` | Distill the current conversation into a structured `plan.md`, validate it, write it to the per-repo plans dir, and print its path. Doesn't run Kimi. |
| `/kimi:code [<plan.md>]` | Run Kimi inside a fresh worktree to implement a plan, then **auto-chain a review**. If no plan path is given, Claude composes one from the current conversation, shows it for confirmation, then proceeds. `--no-review` opts out of the review chain. |
| `/kimi:review [<plan.md>]` | Kimi reviews a diff. Pass `plan.md` to review the latest code job for that plan; otherwise reviews uncommitted changes. |
| `/kimi:adversarial-review` | Same target selection, security/correctness-pressure-test posture. |
| `/kimi:status` / `/kimi:result` / `/kimi:cancel` | Manage running and completed jobs. |

A `kimi-coder` subagent is also exposed — Claude will pick it up automatically when delegating substantial coding tasks.

---

## Requirements

- **Node ≥ 24** (uses `node:fs/promises`, `node:test`, modern stdlib only).
- **Git** in `PATH`.
- **kimi-cli** in `PATH`, logged in. Install: <https://github.com/MoonshotAI/kimi-cli>, then `kimi login`.

The plugin has **zero runtime dependencies**. Everything is the Node standard library.

---

## Install

```text
/plugin marketplace add yysu/kimi-plugin-cc
/plugin install kimi@kimi-plugin-cc
/reload-plugins
```

Then verify:

```text
/kimi:doctor
```

---

## The plan format

A plan is a markdown file with YAML frontmatter. It is a binding contract: `/kimi:code` refuses to run without one, and `/kimi:review` uses its fields as the rubric.

```yaml
---
id: add-google-login                  # required, slug. used as job/branch name.
goal: |                                # required.
  Add Google OAuth login flow with session cookie.
base_branch: main                      # required.
files_may_touch:                       # required, ≥ 1 glob. reviewer flags anything outside.
  - src/auth/**
  - src/routes/login.ts
  - tests/auth/**
out_of_scope:                          # required. empty array allowed.
  - Refactor existing session middleware
  - UI redesign
success_criteria:                      # required, ≥ 1. reviewer's rubric.
  - All tests in tests/auth/ pass
  - User can complete login flow end-to-end
  - No new ESLint warnings
constraints:                           # optional.
  - No new runtime dependencies
notes_for_kimi: |                      # optional, freeform context.
  The OAuth client_id env var is GOOGLE_OAUTH_CLIENT_ID.
---

# Background

Free-form markdown below the frontmatter is also passed to Kimi.
```

Schema: `plugins/kimi/schemas/plan.schema.json`.

---

## A typical run

The plain conversational path — no plan file needed up front:

```text
# 1. Talk through what you want with Claude in chat. No file required.

# 2. Hand off.
/kimi:code

#    → Claude distills the conversation into a structured plan
#    → Claude prints the plan inline and asks you to confirm
#    → on confirm: plan is materialized to ~/.kimi-plugin-cc/state/<hash>/plans/
#    → opens a worktree at ~/.kimi-plugin-cc/state/<hash>/worktrees/<job>
#    → Kimi (write-capable agent profile) implements the plan inside it
#    → post-run audit checks no writes escaped the worktree
#    → automatically runs Kimi (read-only agent profile) to review the diff
#    → prints the verdict (pass / needs-attention / block) and exit code 0/1/2

# 3. Iterate on review feedback in the same worktree.
/kimi:code <plan-path-from-step-2> --resume <job-id>

# 4. Happy with it? Merge the worktree branch back yourself.
$ git merge kimi/<job-id>
```

Or if you want to see the plan settle on disk before any code runs:

```text
/kimi:plan        # writes plan, prints path, stops
/kimi:code <printed-path>
```

`plan.md` is the only handoff artifact you ever need to remember. Job ids are surfaced in output but never required as input.

### Execution modes

| Mode | When to use |
|---|---|
| (default) foreground | Running interactively. Blocks until done; auto-reviews. |
| `--wait` | Calling from Claude with `Bash(run_in_background: true)`. Same as foreground but emits a 30-second heartbeat so the background bash never looks idle. |
| `--background` | Long jobs you'll check on later via `/kimi:status`. Auto-review is skipped — use `/kimi:review plan.md` when it finishes. |
| `--no-review` | Skip the auto-review chain (default chains review on success). |

`--timeout-ms <N>` (or `KIMI_TIMEOUT_MS` env) caps any single Kimi invocation. Default is unlimited.

---

## Where state lives

Everything Kimi-related is **outside your repo**:

```
~/.kimi-plugin-cc/state/<repo-hash>/
  jobs/<job-id>/
    meta.json         # job state (status, pid, exit code, verdict, …)
    prompt.txt        # exact prompt sent to kimi
    stdout.jsonl      # kimi --output-format=stream-json output
    stderr.log
    diff.patch        # git diff vs base branch (code jobs)
    review.json       # parsed review payload (review jobs)
    review.md         # human-readable review
  worktrees/<job-id>/ # the actual git worktree
  plans/<slug>-<ts>.md # plans materialized by /kimi:plan or auto-fallback
  config.json         # per-repo plugin config (e.g. review_gate_enabled)
```

`<repo-hash>` is `sha1(git toplevel absolute path)` truncated to 12 chars. Different repos can never collide. Override the root with `KIMI_PLUGIN_STATE_DIR`.

---

## The optional review gate

Off by default. Turn on per-repo:

```text
/kimi:doctor --enable-review-gate
```

When on, Claude Code's `Stop` event triggers a Kimi review of the current uncommitted diff. If the review's first line is `BLOCK: <reason>`, Claude is prevented from stopping and is told to address the issue.

> ⚠️ This can put Claude and Kimi in a long mutual loop and burn through Kimi quota fast. Only enable it when you're actively monitoring the session. Disable with `--disable-review-gate`.

Implementation: `plugins/kimi/scripts/stop-gate-hook.mjs`. The hook fails open — any internal error allows the stop, never blocks it.

---

## How review output is structured

Reviewers must end with a single line:

```
KIMI_REVIEW_JSON: {"verdict":"pass|needs-attention|block","summary":"…","findings":[…],"scope_check":{…},"next_steps":[…]}
```

Schema: `plugins/kimi/schemas/review-output.schema.json`. The runner exits with code `0` (pass), `1` (needs-attention), or `2` (block) so CI can branch on it.

Each finding carries `severity` (`critical`/`high`/`medium`/`low`/`nit`), `confidence` (0-1), and an optional `category` (correctness, security, scope-violation, missing-criterion, …).

---

## Architecture, in two paragraphs

The plugin is a thin Node 24 dispatcher (`runner.mjs`) that shells out to `kimi --print --afk`. There is no daemon, no broker, no IPC. Session continuity comes from kimi-cli's own `--continue` mechanism (per-cwd persistent sessions). Each `code` job gets a unique git worktree under `~/.kimi-plugin-cc/`, so Kimi cannot touch the user's working tree even by accident.

Failure modes have explicit handling: kimi exit code 75 (rate limit / 5xx / timeout) triggers one retry; exit 0 with a `BLOCKED:` final line marks the job blocked rather than done; the Stop hook fails open on any internal error. The `Plan → Code → Review` boundary is enforced two ways: separate Kimi sessions (reviewer never resumed) **and** separate Kimi `--agent-file` profiles. The reviewer's profile excludes Shell, WriteFile, StrReplaceFile, the `Agent` tool, and web tools — read-only-ness is a Kimi-side constraint, not a prompt promise.

## Worktree containment & post-run audit

`/kimi:code` runs Kimi inside a worktree at `~/.kimi-plugin-cc/state/<repo-hash>/worktrees/<job-id>/` and passes `--work-dir` so Kimi's relative paths resolve there. After the run, the runner audits `stdout.jsonl` for any `WriteFile` / `StrReplaceFile` tool call whose `path` is absolute and not under that worktree. If found, the job is marked `blocked`, the violations are surfaced in `/kimi:status`, and the worktree is left for inspection but not auto-merged.

This is _not_ a sandbox — `Shell` commands like `cat /etc/passwd` are still possible — but the worktree is throwaway, your real working tree is untouched, and the audit catches the most common write-escape attempts. For tighter isolation, run Claude Code itself inside a container.

---

## Why _not_ a broker?

`kimi-cli` already persists sessions to disk and supports `kimi --continue` and `kimi --resume <id>`. A long-lived broker process would only save ~1–3s of cold-start per call — not worth the failure modes (stale sockets, zombie processes, broker crash → all jobs lost, single-broker bottleneck). One-shot CLI calls are simpler, more parallel-friendly, and survive crashes gracefully.

The plugin's `runKimiWithRetry()` is the seam where a broker could be reintroduced if that calculus ever changes.

---

## Development

```sh
# Run tests (no real kimi needed — uses tests/fake-kimi-bin/kimi)
npm test

# Bump version (syncs package.json + plugin.json)
npm run bump 0.2.0
```

The test suite is built on `node --test` and a fake `kimi` binary on `PATH`. CI runs on Node 24 (see `.github/workflows/ci.yml`).

---

## Acknowledgments

This plugin was designed after studying the public APIs and structure of `MoonshotAI/kimi-cli`, and inspired by the Claude Code plugin pattern as it appears in `openai/codex-plugin-cc`. Code is original to this repository; no source from those projects was copied.

## License

MIT — see `LICENSE`.
