---
description: Run a Kimi code review on the current changes or a job's worktree.
argument-hint: "[--base <ref>] [--plan <plan.md>] [--job <job-id>] [--background] [--wait]"
---

Selecting what to review (the runner handles this; just forward the args):

- `--job <id>` → review the diff inside that job's worktree against its base branch.
- `--base <ref>` → review the current repo's diff against `<ref>` (e.g. `main`).
- Neither → review uncommitted changes in the current working tree.

If the user provides `--plan <path>`, the reviewer uses the plan's `success_criteria`, `out_of_scope`, and `files_may_touch` as the rubric.

Review runs in a **fresh Kimi session** (never resumed). Reviewer should be cold-eyed.

Forward to the runner:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/runner.mjs" review $ARGUMENTS
```

Return the runner's stdout as-is.
