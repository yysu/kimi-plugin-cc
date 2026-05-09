---
description: Delegate a coding task to Kimi. Auto-materializes a plan from conversation if none was passed, then auto-reviews on success.
argument-hint: "[<plan.md>] [--background] [--wait] [--no-review] [--resume <job-id>] [--fresh] [--model <name>] [--effort low|medium|high] [--timeout-ms <N>]"
---

This command delegates a coding job to Kimi, then automatically chains a Kimi review on success. The plan markdown is the contract for both phases.

## Decide whether a plan path was given

Inspect `$ARGUMENTS`. If the first non-flag token is a path that ends in `.md` and the file exists, treat it as the plan path. Otherwise: **no plan path** — go to the auto-materialization branch below.

## Branch A — plan path given

Just forward, including all other flags, in exactly one Bash call:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/runner.mjs" code $ARGUMENTS
```

Return the runner's stdout as-is.

## Branch B — no plan path (auto-materialize)

This is the path Claude takes when the user says things like "hand it to Kimi" without writing a plan file first.

1. **Compose a plan** from the current conversation. Same rules as `/kimi:plan` (see that command's instructions): YAML frontmatter with all required fields, derived slug, plus a markdown body with background and suggested approach.

2. **Show the plan inline** in chat so the user can read every field before any code is delegated.

3. **Ask for explicit confirmation.** A brief question — "OK to delegate to Kimi? (y / edits)" — and wait for the user's reply.

4. On affirmative confirmation, materialize the plan via the runner:

   ```bash
   cat <<'PLAN' | node "${CLAUDE_PLUGIN_ROOT}/scripts/runner.mjs" plan write
   ---
   …frontmatter…
   ---

   …body…
   PLAN
   ```

   Capture the printed absolute path. Call it `$PLAN_PATH`.

5. Forward to the runner with that path, preserving any other flags the user passed:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/runner.mjs" code "$PLAN_PATH" <other flags>
   ```

6. If the user pushes back on the plan (asks for edits), revise it and re-show. Do not invoke the runner until the user confirms.

## Other rules

- `--resume` and `--fresh` are mutually exclusive; refuse if both are present.
- If the user passed neither `--resume` nor `--fresh` and a previous job exists for the same plan id in this repo: ask once whether to continue or start fresh, then forward with the chosen flag.
- `--background` skips auto-review (the runner already prints how to review later).
- `--no-review` opts out of auto-review.
- Return the runner's stdout as-is. Do not poll or summarize.
