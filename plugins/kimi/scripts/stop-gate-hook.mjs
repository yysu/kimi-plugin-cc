#!/usr/bin/env node
// Stop hook: optionally runs a Kimi review on the previous Claude turn and
// blocks the stop if the review returns BLOCK. Disabled by default.
//
// Configuration: ~/.kimi-plugin-cc/state/<repo-hash>/config.json
//                { "review_gate_enabled": true }
//
// Output protocol:
//   - Exit 0 with no JSON  → allow stop (default behavior).
//   - Print JSON {"decision":"block","reason":"..."} → block stop.
//
// Failure handling: any internal error → ALLOW. The gate must never become
// a brick wall when something goes wrong; that would be worse than no gate.

import { spawn } from 'node:child_process';
import { workspaceFor } from './lib/workspace.mjs';
import { gitDiff } from './lib/git.mjs';
import { renderStopGatePrompt } from './lib/prompts.mjs';
import { pathExists, readJson } from './lib/fs.mjs';

const TIMEOUT_MS = 12 * 60 * 1000; // hook-level safety net (the hook entry has its own timeout)

async function main() {
  // Read stdin (Claude Code passes session JSON, we do not depend on its shape).
  let stdinPayload = '';
  try {
    stdinPayload = await readStdin();
  } catch { /* tolerate */ }
  const claudeResponseTail = extractTail(stdinPayload);

  let ws;
  try {
    ws = await workspaceFor(process.cwd());
  } catch {
    return allow(); // not in a repo → nothing to review
  }

  // Disabled by default.
  if (!(await pathExists(ws.configFile))) return allow();
  let cfg = {};
  try { cfg = await readJson(ws.configFile); } catch { return allow(); }
  if (!cfg.review_gate_enabled) return allow();

  // Compute uncommitted diff in the user's working tree. If empty, no edits this turn.
  let diff = '';
  try {
    diff = await gitDiff(ws.repoToplevel, null);
  } catch {
    return allow();
  }
  if (!diff.trim()) return allow();

  const prompt = await renderStopGatePrompt({
    turnDiff: diff.length > 60_000 ? diff.slice(0, 60_000) + '\n…(truncated)' : diff,
    claudeResponseTail,
  });

  const kimiResult = await runKimiOneShot(prompt, ws.repoToplevel);
  if (!kimiResult) return allow();

  const firstLine = kimiResult.split('\n')[0]?.trim() || '';
  if (firstLine.startsWith('BLOCK:')) {
    return block(firstLine.slice('BLOCK:'.length).trim() || 'kimi review blocked stop');
  }
  return allow();
}

function readStdin() {
  return new Promise((resolve) => {
    let buf = '';
    if (process.stdin.isTTY) return resolve('');
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { buf += chunk; });
    process.stdin.on('end', () => resolve(buf));
    process.stdin.on('error', () => resolve(buf));
    // Safety: don't hang forever waiting for stdin.
    setTimeout(() => resolve(buf), 500);
  });
}

function extractTail(payload) {
  if (!payload) return '';
  // Claude Code sends JSON; we don't depend on its exact schema.
  // Grab anything that looks like a recent textual response, fall back to raw.
  try {
    const obj = JSON.parse(payload);
    if (obj?.transcript_path) return `transcript: ${obj.transcript_path}`;
    if (typeof obj?.response === 'string') return obj.response.slice(-2000);
    return JSON.stringify(obj).slice(-2000);
  } catch {
    return payload.slice(-2000);
  }
}

function runKimiOneShot(prompt, cwd) {
  return new Promise((resolve) => {
    const child = spawn('kimi', [
      '--print', '--afk', '--quiet',
      '--final-message-only',
      '--work-dir', cwd,
      '-p', prompt,
    ], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* */ }
      resolve(null);
    }, TIMEOUT_MS);
    child.stdout.on('data', (b) => (stdout += b.toString('utf8')));
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve(code === 0 ? stdout : null);
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
  });
}

function allow() {
  process.exit(0);
}

function block(reason) {
  // Claude Code blocks the Stop when stdout contains a JSON envelope.
  process.stdout.write(JSON.stringify({
    decision: 'block',
    reason: `kimi review gate: ${reason}`,
  }) + '\n');
  process.exit(0);
}

main().catch(() => allow());
