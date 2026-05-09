// Post-run audit of a code job's stream-json log.
//
// Threat model: Kimi runs with `--afk` (auto-approve), so we cannot prevent
// it from attempting writes outside the worktree at runtime. Our boundary is:
//
//   1. `--work-dir <worktree>` makes the worktree the implicit root.
//   2. Audit AFTER the run: parse stream-json events, look at every WriteFile
//      and StrReplaceFile tool call, resolve its `path` argument against the
//      worktree root, and flag any whose final resolved path escapes the
//      worktree (e.g. `../../etc/passwd`, or an absolute path elsewhere).
//   3. If a violation is found, the runner marks the job `blocked` and the
//      worktree is left for inspection. The user reads the audit findings in
//      `/kimi:result`.
//
// What this audit does NOT catch:
//   - `Shell` commands that write outside (e.g., `> /tmp/x`). Adding shell
//     parsing is brittle and out of scope for v0.1; documented as a gap.
//   - Reads outside the worktree (tolerated; reveal nothing destructive).

import { createReadStream, existsSync, realpathSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { isAbsolute, relative, resolve } from 'node:path';

const WRITE_TOOLS = new Set([
  'WriteFile',
  'StrReplaceFile',
]);

export async function auditStreamJson(stdoutPath, worktreePath) {
  // Always resolve to an absolute base, even when realpath fails (e.g. the
  // worktree was already torn down). resolve() is enough to keep containment
  // checks well-defined.
  const realWorktree = safeRealpath(worktreePath) || resolve(worktreePath);
  const violations = [];
  let eventsSeen = 0;
  let writeCallsSeen = 0;

  if (!existsSync(stdoutPath)) {
    return { violations, events_seen: 0, write_calls_seen: 0 };
  }

  const stream = createReadStream(stdoutPath, { encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  try {
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      eventsSeen++;
      let evt;
      try { evt = JSON.parse(trimmed); } catch { continue; }
      const tcs = evt?.tool_calls;
      if (!Array.isArray(tcs)) continue;
      for (const tc of tcs) {
        const name = tc?.function?.name;
        if (!WRITE_TOOLS.has(name)) continue;
        writeCallsSeen++;
        let argsObj;
        try { argsObj = JSON.parse(tc.function?.arguments ?? '{}'); }
        catch { continue; }
        const rawPath = argsObj?.path;
        if (typeof rawPath !== 'string' || rawPath === '') continue;

        // Resolve every path — relative or absolute — against the worktree root,
        // so `../../etc/x` and `/etc/x` both end up at their actual final location.
        const candidate = isAbsolute(rawPath)
          ? rawPath
          : resolve(realWorktree, rawPath);
        const resolved = safeRealpath(candidate) || resolve(candidate);

        if (!isUnder(resolved, realWorktree)) {
          violations.push({
            tool: name,
            path: rawPath,
            resolved,
            tool_call_id: tc.id,
          });
        }
      }
    }
  } catch {
    // Best-effort: any read error → return what we have.
  } finally {
    rl.close();
    stream.destroy();
  }

  return { violations, events_seen: eventsSeen, write_calls_seen: writeCallsSeen };
}

function isUnder(child, parent) {
  if (!child || !parent) return false;
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function safeRealpath(p) {
  try { return realpathSync(p); } catch { return null; }
}
