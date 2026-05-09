---
description: Run a security-focused, adversarial Kimi review.
argument-hint: "[--base <ref>] [--plan <plan.md>] [--job <job-id>] [--background] [--wait] [focus text]"
---

Same target-selection rules as `/kimi:review` (`--job`, `--base`, or default to uncommitted changes).

Any free-form text after the flags is forwarded as a focus hint (e.g. `challenge whether the cache invalidation is correct under concurrent writes`). The reviewer is told to challenge assumptions, look for injection / data-loss / race-condition / authz issues, and pressure-test the chosen design.

Review runs in a fresh Kimi session.

Forward to the runner:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/runner.mjs" adversarial-review $ARGUMENTS
```

Return the runner's stdout as-is.
