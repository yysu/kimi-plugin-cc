import { spawn } from 'node:child_process';
import { openSync, closeSync } from 'node:fs';

const RETRYABLE_EXIT = 75;

// Spawn kimi-cli, capture exit. Returns { code, signal } once the child exits.
// Output is streamed to the provided file descriptors (caller decides whether
// to keep them in-process or detach for background mode).
export function spawnKimi(args, { cwd, stdoutPath, stderrPath, detached = false }) {
  const stdoutFd = openSync(stdoutPath, 'a');
  const stderrFd = openSync(stderrPath, 'a');
  const child = spawn('kimi', args, {
    cwd,
    env: process.env,
    stdio: ['ignore', stdoutFd, stderrFd],
    detached,
  });
  if (detached) {
    child.unref();
  }
  closeSync(stdoutFd);
  closeSync(stderrFd);
  return child;
}

export function waitForExit(child) {
  return new Promise((resolve) => {
    child.on('close', (code, signal) => resolve({ code, signal }));
    child.on('error', (err) => resolve({ code: -1, signal: null, error: err.message }));
  });
}

// Run kimi to completion, with a single retry on exit code 75 (retryable).
// Caller passes a function `buildArgs()` because retries should rebuild args
// in case prompt files were rotated (rare, but cheap to support).
export async function runKimiWithRetry(buildArgs, ctx) {
  const first = spawnKimi(buildArgs(), ctx);
  const r1 = await waitForExit(first);
  if (r1.code !== RETRYABLE_EXIT) return { ...r1, attempts: 1 };

  await sleep(5000);
  const second = spawnKimi(buildArgs(), ctx);
  const r2 = await waitForExit(second);
  return { ...r2, attempts: 2 };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function buildCodeArgs({ prompt, workDir, resume }) {
  const args = ['--print', '--afk', '--output-format=stream-json', '--work-dir', workDir];
  if (resume) args.push('--continue');
  args.push('-p', prompt);
  return args;
}

export function buildReviewArgs({ prompt, workDir }) {
  // Reviewer always fresh — no --continue.
  return [
    '--print',
    '--afk',
    '--output-format=text',
    '--final-message-only',
    '--work-dir',
    workDir,
    '-p',
    prompt,
  ];
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
