import { spawn } from 'node:child_process';
import { openSync, closeSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RETRYABLE_EXIT = 75;
const HERE = dirname(fileURLToPath(import.meta.url));
const AGENT_DIR = join(HERE, '..', '..', 'kimi-agents');

export const AGENT_FILES = {
  code: join(AGENT_DIR, 'code.yaml'),
  review: join(AGENT_DIR, 'review.yaml'),
};

// Spawn kimi-cli with stdio redirected to log files. Returns the child handle
// so callers can attach watchers (timeout, heartbeat, …) before awaiting exit.
export function spawnKimi(args, { cwd, stdoutPath, stderrPath, detached = false }) {
  const stdoutFd = openSync(stdoutPath, 'a');
  const stderrFd = openSync(stderrPath, 'a');
  const child = spawn('kimi', args, {
    cwd,
    env: process.env,
    stdio: ['ignore', stdoutFd, stderrFd],
    detached,
  });
  if (detached) child.unref();
  closeSync(stdoutFd);
  closeSync(stderrFd);
  return child;
}

// Race the child against a timeout. Returns the same shape as waitForExit but
// adds `timed_out: true` if the timer fires first (and SIGKILLs the child).
export function waitForExit(child, { timeoutMs } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;

    const settle = (val) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(val);
    };

    if (typeof timeoutMs === 'number' && timeoutMs > 0) {
      timer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch { /* */ }
        settle({ code: -1, signal: 'SIGKILL', timed_out: true });
      }, timeoutMs);
    }

    child.on('close', (code, signal) => settle({ code, signal, timed_out: false }));
    child.on('error', (err) => settle({ code: -1, signal: null, error: err.message }));
  });
}

// One retry on exit 75 (kimi's documented retryable error). Caller passes a
// thunk that builds args, so retried runs use a freshly resolved args list.
export async function runKimiWithRetry(buildArgs, ctx, { timeoutMs } = {}) {
  const first = spawnKimi(buildArgs(), ctx);
  if (ctx.onChild) ctx.onChild(first);
  const r1 = await waitForExit(first, { timeoutMs });
  if (r1.timed_out || r1.code !== RETRYABLE_EXIT) return { ...r1, attempts: 1 };

  await sleep(5000);
  const second = spawnKimi(buildArgs(), ctx);
  if (ctx.onChild) ctx.onChild(second);
  const r2 = await waitForExit(second, { timeoutMs });
  return { ...r2, attempts: 2 };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function buildCodeArgs({
  prompt, workDir, resume, model, effort, maxStepsPerTurn,
}) {
  const args = [
    '--print', '--afk',
    '--output-format=stream-json',
    '--agent-file', AGENT_FILES.code,
    '--work-dir', workDir,
  ];
  if (resume) args.push('--continue');
  if (model) args.push('--model', model);
  if (effort) args.push('--effort', effort);
  if (typeof maxStepsPerTurn === 'number' && maxStepsPerTurn > 0) {
    args.push('--max-steps-per-turn', String(maxStepsPerTurn));
  }
  args.push('-p', prompt);
  return args;
}

export function buildReviewArgs({
  prompt, workDir, model, effort, maxStepsPerTurn,
}) {
  // Reviewer always fresh — no --continue.
  const args = [
    '--print', '--afk',
    '--output-format=text',
    '--final-message-only',
    '--agent-file', AGENT_FILES.review,
    '--work-dir', workDir,
  ];
  if (model) args.push('--model', model);
  if (effort) args.push('--effort', effort);
  if (typeof maxStepsPerTurn === 'number' && maxStepsPerTurn > 0) {
    args.push('--max-steps-per-turn', String(maxStepsPerTurn));
  }
  args.push('-p', prompt);
  return args;
}

export async function probeKimi() {
  return new Promise((resolve) => {
    const child = spawn('kimi', ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (b) => (stdout += b.toString('utf8')));
    child.stderr.on('data', (b) => (stderr += b.toString('utf8')));
    child.on('close', (code) => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
    child.on('error', (err) => resolve({ code: -1, stdout: '', stderr: err.message }));
  });
}

// Pull a semver-ish triple out of `kimi --version` output (e.g., "kimi 1.34.2").
// Returns null if the output didn't match.
export function parseKimiVersion(stdout) {
  const m = String(stdout).match(/(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3], raw: m[0] };
}

export function meetsMinKimi(v, min) {
  if (!v) return false;
  if (v.major !== min.major) return v.major > min.major;
  if (v.minor !== min.minor) return v.minor > min.minor;
  return v.patch >= min.patch;
}

// The minimum Kimi version we vouch for. `--agent-file`, `--continue`,
// `--max-steps-per-turn`, and exit-code 75 semantics are all assumed present.
export const MIN_KIMI = { major: 1, minor: 34, patch: 0 };
