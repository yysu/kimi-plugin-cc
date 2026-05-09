---
description: Run a Kimi code review. Pass plan.md to review the latest code job for that plan.
argument-hint: "[<plan.md>] [--base <ref>] [--job <job-id>] [--plan <path>] [--background] [--wait] [--timeout-ms <N>]"
---

Target selection (the runner handles all of this; just forward args):

- **Positional `plan.md`** (recommended): looks up the latest `/kimi:code` job for that plan id and reviews its worktree. This is how Claude should call review after delegating a code job.
- `--job <id>`: review that specific job's worktree.
- `--base <ref>`: review the current repo's diff against `<ref>` (e.g. `main`).
- (none): review uncommitted changes in the current working tree.

If `--plan <path>` is provided (or a plan was passed positionally), the reviewer uses `success_criteria`, `out_of_scope`, and `files_may_touch` as the rubric.

Review always runs in a **fresh Kimi session**. The reviewer is fresh-eyed.

The reviewer is also enforced read-only at the Kimi level via a custom `--agent-file` — Shell, WriteFile, and StrReplaceFile tools are stripped, so the reviewer cannot mutate code even if asked.

Forward to the runner:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/runner.mjs" review $ARGUMENTS
```

Return the runner's stdout as-is. The exit code reflects the verdict: `0` (pass), `1` (needs-attention), `2` (block) — useful for CI and chained commands.
