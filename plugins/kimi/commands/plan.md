---
description: Materialize a structured plan.md from the current conversation. Doesn't run Kimi — just writes the plan and prints its path.
argument-hint: "[<slug>] [<one-line goal>]"
---

This command turns the current conversation into a plan.md file under the plugin's per-repo state dir, ready to hand to `/kimi:code`.

## What you (Claude) must do

1. Pick a slug. If `$ARGUMENTS` starts with a slug-like token, use it. Otherwise derive one (`kebab-case`, ≤ 64 chars, lowercase letters/digits/hyphens) from the goal text or the conversation topic.

2. Compose a complete plan with **YAML frontmatter** (the schema lives at `${CLAUDE_PLUGIN_ROOT}/schemas/plan.schema.json`). Required fields, all populated from conversation context:

   - `id` — the slug from step 1
   - `goal` — one or two sentences describing what "done" means
   - `base_branch` — usually `main`; check the repo if unsure (`git branch --show-current` or look at the default branch)
   - `files_may_touch` — concrete glob whitelist. Be specific. Reviewer flags anything outside.
   - `out_of_scope` — what NOT to do. Empty array allowed but field required.
   - `success_criteria` — verifiable conditions, ≥ 1 entry. These become the reviewer's rubric.
   - `constraints`, `notes_for_kimi` — optional but useful

   Below the frontmatter, add a free-form markdown body with background, suggested approach, and any other context Kimi will benefit from.

3. **Print the entire plan inline in chat** for the user to read.

4. Pipe the plan into the runner. Use a heredoc so the body survives quoting:

   ```bash
   cat <<'PLAN' | node "${CLAUDE_PLUGIN_ROOT}/scripts/runner.mjs" plan write
   ---
   id: <slug>
   …rest of frontmatter…
   ---

   …body…
   PLAN
   ```

   The runner validates the plan, writes it to `~/.kimi-plugin-cc/state/<repo-hash>/plans/<slug>-<ts>.md`, and prints the absolute path on stdout.

5. Surface the printed path to the user, plus the next-step hint:

   > Plan written. To delegate: `/kimi:code <printed path>`

Do not run `/kimi:code` automatically from this command — `/kimi:plan` is the **explicit** materialization step. The auto-fallback path is in `/kimi:code` itself.
