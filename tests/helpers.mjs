import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(HERE, '..');
export const FAKE_KIMI_BIN = join(HERE, 'fake-kimi-bin');
export const RUNNER = join(REPO_ROOT, 'plugins', 'kimi', 'scripts', 'runner.mjs');

export async function tmpScratch(label = 'kimi-test-') {
  return mkdtemp(join(tmpdir(), label));
}

export async function makeRepo(scratch, files = {}) {
  const repo = join(scratch, 'repo');
  await mkdir(repo, { recursive: true });
  await runNode('git', ['init', '-b', 'main'], { cwd: repo });
  await runNode('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
  await runNode('git', ['config', 'user.name', 'tester'], { cwd: repo });
  for (const [path, body] of Object.entries(files)) {
    const full = join(repo, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, body, 'utf8');
  }
  await runNode('git', ['add', '-A'], { cwd: repo });
  await runNode('git', ['commit', '-m', 'init'], { cwd: repo });
  return repo;
}

export function runNode(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...(opts.env || {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (b) => (stdout += b.toString('utf8')));
    child.stderr.on('data', (b) => (stderr += b.toString('utf8')));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.on('error', (err) => resolve({ code: -1, stdout, stderr: err.message }));
  });
}

export function runRunner(args, { cwd, stateDir, fakeKimi = true, env = {} } = {}) {
  const overlayPath = `${FAKE_KIMI_BIN}:${process.env.PATH}`;
  return runNode('node', [RUNNER, ...args], {
    cwd,
    env: {
      KIMI_PLUGIN_STATE_DIR: stateDir,
      PATH: fakeKimi ? overlayPath : process.env.PATH,
      ...env,
    },
  });
}

export async function cleanup(path) {
  await rm(path, { recursive: true, force: true });
}

export const SAMPLE_PLAN = `---
id: sample-job
goal: |
  Add a hello() function to src/util.js
base_branch: main
files_may_touch:
  - src/**
out_of_scope:
  - Refactoring existing code
success_criteria:
  - hello() exists in src/util.js
  - all tests pass
constraints:
  - no new dependencies
notes_for_kimi: |
  Keep it boring.
---

# Plan body

Just add hello().
`;
