---
name: kimi-prompting
description: How to shape prompts that go to Kimi for code/review tasks in this plugin. Use when editing prompts in plugins/kimi/prompts/ or when constructing ad-hoc prompts before forwarding to the runner.
---

# Kimi prompting conventions

This plugin's prompts share a few invariants. Keep them when you edit prompt templates.

## 1. XML-tag block structure

Every prompt is divided into named blocks:

- `<role>` — one paragraph identity
- `<context>` / `<workspace>` / `<plan>` / `<diff>` — input data
- `<hard_constraints>` or `<rules>` — what the model must not do
- `<workflow>` or `<focus_axes>` — how to think
- `<output_contract>` — exact format for the last line(s)

Blocks make prompts diffable and let us A/B test sections without rewriting the whole prompt.

## 2. Output contracts are first-line or last-line

For the Stop hook gate: the **first line** must match `^(ALLOW|BLOCK): `. Easy to grep, hard for the model to bury under preamble.

For review: the **last line** must start with `KIMI_REVIEW_JSON: ` followed by a single-line JSON object that validates against `schemas/review-output.schema.json`. Streaming reasoning before that line is fine.

For coding: the **last line** must be `DONE: <summary>` or `BLOCKED: <reason>`.

The runner parses these contracts; if they break, the user sees the failure cleanly instead of garbage.

## 3. The plan is sacrosanct

`/kimi:code` always feeds the full plan markdown into the prompt. The implementer is told the plan is a binding contract. If anything in the plan is ambiguous, the implementer is told to emit `BLOCKED:` rather than guess. We prefer "stop and ask" over "do the wrong thing fast".

## 4. Reviewer is fresh-eyed

Reviewer prompts never resume the implementer's session. The reviewer must not inherit the implementer's rationalizations. This is enforced at the runner level (review subcommands never pass `--continue`).

## 5. Prompts live in files, not in code

All long-form prompt text is in `plugins/kimi/prompts/*.md`. Code only does template fills via `{{PLACEHOLDER}}` substitution. This keeps prompt iteration out of git history noise from logic changes.
