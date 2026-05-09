<task>
Decide whether the most recent Claude turn should be allowed to stop.

Only inspect the diff that turn produced (passed in below). If the turn made no code changes — for example it was a status check, a `/kimi:setup` run, a help reply, or a chat-only response — return ALLOW immediately and do no further work.
</task>

<turn_diff>
{{TURN_DIFF}}
</turn_diff>

<turn_summary>
{{CLAUDE_RESPONSE_TAIL}}
</turn_summary>

<rules>
- Ground every BLOCK on something visible in `<turn_diff>`. Do not BLOCK on speculative concerns or on edits from earlier turns.
- BLOCK only for findings that are reasonably critical or high severity (security, correctness, broken tests, irreversible data risk). Style nits are not blockers.
- ALLOW is the default outcome. Earn a BLOCK.
</rules>

<output_contract>
Your first line MUST be exactly one of:

  ALLOW: <one short sentence>
  BLOCK: <one short sentence>

Nothing may precede that line — no preamble, no thinking trace. Anything after that line is ignored by the hook.
</output_contract>
