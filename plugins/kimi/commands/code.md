---
description: Delegate a coding task to Kimi. Requires plan.md (YAML frontmatter). Auto-reviews when done.
argument-hint: "<plan.md> [--background] [--wait] [--no-review] [--resume <job-id>] [--fresh] [--model <name>] [--effort low|medium|high] [--timeout-ms <N>]"
---

This command **requires** a plan file. The plan is the contract between Claude (planner) and Kimi (implementer).

After Kimi finishes successfully, **the runner automatically chains a Kimi review** in a fresh session. Pass `--no-review` to opt out.

**Flag semantics:**
- `--background`: detach Kimi, return immediately. No auto-review (run `/kimi:review <plan.md>` later when done).
- `--wait`: foreground with a 30s heartbeat; recommended when Claude calls this with `Bash(run_in_background: true)`.
- (default): foreground, silent until done, then auto-review.

If the user passed `--resume` and `--fresh` together: refuse, those are mutually exclusive.

If the user passed neither `--resume` nor `--fresh`, and a previous job exists for the same plan id in this repo:
- Ask once: "Continue job `<id>` (last run <when>) or start fresh?" → map to `--resume <id>` or `--fresh`.

If the user did not pass a plan path:
- Stop. Tell them: "`/kimi:code` requires a plan file. Write one (YAML frontmatter + markdown body) and pass its path."
- Show the schema at `${CLAUDE_PLUGIN_ROOT}/schemas/plan.schema.json` if they want a template.

Forward to the runner in exactly one Bash call:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/runner.mjs" code $ARGUMENTS
```

Return the runner's stdout as-is. Do not poll, do not summarize. The runner prints the job id, the contract line, the diff summary, and (when auto-review runs) the verdict.
