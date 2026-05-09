---
description: Check whether kimi-cli, git, and Node are ready for delegation.
argument-hint: "[--enable-review-gate | --disable-review-gate]"
---

Run the doctor in one Bash call:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/runner.mjs" doctor $ARGUMENTS
```

Report the runner's stdout exactly as printed. Do not retry, interpret exit codes, or run additional commands. If a check fails, the runner's output already explains what to fix.
