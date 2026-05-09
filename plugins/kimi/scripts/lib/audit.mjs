// Post-run audit of a code job's stream-json log.
//
// Threat model: Kimi runs with `--afk` (auto-approve), so we cannot prevent
// it from attempting writes outside the worktree at runtime. Our boundary is:
//
//   1. `--work-dir <worktree>` makes the worktree the implicit root.
//   2. Audit AFTER the run: parse stream-json events, look at every WriteFile
//      and StrReplaceFile tool call, flag any whose `path` argument is
//      absolute and not under the worktree.
//   3. If a violation is found, the runner marks the job `blocked` and
//      destroys the worktree. The user reads the audit findings in /kimi:result.
//
// What this audit does NOT catch:
//   - `Shell` commands that write outside (e.g., `> /tmp/x`). Adding shell
//     parsing is brittle and out of scope for v0.1; we document this gap.
//   - Reads outside the worktree (those are tolerated; they reveal nothing
//     destructive).

import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { realpathSync, existsSync } from 'node:fs';

const WRITE_TOOLS = new Set([
  'WriteFile',
  'StrReplaceFile',
]);

export async function auditStreamJson(stdoutPath, worktreePath) {
  if (!existsSync(stdoutPath)) return { violations: [], events_seen: 0 };
  const txt = await readFile(stdoutPath, 'utf8');
  const lines = txt.split('\n').filter((l) => l.trim());

  const realWorktree = safeRealpath(worktreePath);
  const violations = [];
  let toolCallCount = 0;

  for (const line of lines) {
    let evt;
    try { evt = JSON.parse(line); } catch { continue; }
    const tcs = evt?.tool_calls;
    if (!Array.isArray(tcs)) continue;
    for (const tc of tcs) {
      toolCallCount++;
      const name = tc?.function?.name;
      if (!WRITE_TOOLS.has(name)) continue;
      let argsObj;
      try { argsObj = JSON.parse(tc.function?.arguments ?? '{}'); }
      catch { continue; }
      const path = argsObj?.path;
      if (typeof path !== 'string' || path === '') continue;
      // Relative paths resolve under work_dir → trivially inside the worktree. Safe.
      if (!isAbsolute(path)) continue;

      const resolved = safeRealpath(path) || resolve(path);
      if (!isUnder(resolved, realWorktree)) {
        violations.push({
          tool: name,
          path,
          resolved,
          tool_call_id: tc.id,
        });
      }
    }
  }

  return { violations, events_seen: lines.length, write_calls_seen: toolCallCount };
}

function isUnder(child, parent) {
  if (!child || !parent) return false;
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function safeRealpath(p) {
  try { return realpathSync(p); } catch { return null; }
}
