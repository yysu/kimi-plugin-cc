---
description: Delegate a coding task to Kimi. Requires a plan.md with YAML frontmatter.
argument-hint: "<plan.md> [--background] [--wait] [--resume <job-id>] [--fresh] [--model <name>] [--effort low|medium|high]"
---

This command **requires** a plan file. The plan is the contract between Claude (planner) and Kimi (implementer).

If the user did not pass a plan path:
- Stop. Tell them: "`/kimi:code` requires a plan file. Write one (YAML frontmatter + markdown body) and pass its path."
- Show the example schema at `${CLAUDE_PLUGIN_ROOT}/schemas/plan.schema.json` if they want a template.

If the user passed `--resume` and `--fresh` together: refuse, those are mutually exclusive.

If the user passed neither `--resume` nor `--fresh`, and a previous job exists for the same plan id in this repo:
- Ask once: "Continue job `<id>` (last run <when>) or start fresh?" → map to `--resume <id>` or `--fresh`.
- Do not re-prompt on subsequent invocations — make a single decision and forward.

Forward to the runner in exactly one Bash call:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/runner.mjs" code $ARGUMENTS
```

Return the runner's stdout as-is. Do not poll, do not summarize, do not call follow-up commands. The runner prints the job id and how to inspect progress.
