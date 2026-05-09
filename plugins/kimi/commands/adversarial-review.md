---
description: Run a security-focused, adversarial Kimi review.
argument-hint: "[<plan.md>] [--base <ref>] [--job <job-id>] [--background] [--wait] [--timeout-ms <N>] [free-form focus text]"
---

Same target-selection rules as `/kimi:review` (positional plan.md, `--job`, `--base`, or default to uncommitted changes).

Any free-form text after the flags / plan is forwarded as a focus hint (e.g. `challenge whether the cache invalidation is correct under concurrent writes`). The reviewer is told to challenge assumptions, hunt for injection / data-loss / race-condition / authz issues, and pressure-test the chosen design.

Same Kimi-level read-only enforcement as `/kimi:review`. Same fresh-session rule.

Forward to the runner:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/runner.mjs" adversarial-review $ARGUMENTS
```

Return the runner's stdout as-is.
