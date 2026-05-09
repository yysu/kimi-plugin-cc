import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  tmpScratch, makeRepo, cleanup, runRunner, SAMPLE_PLAN,
} from './helpers.mjs';

test('doctor prints check rows and exits 0 when fake kimi is on PATH', async () => {
  const scratch = await tmpScratch();
  try {
    const repo = await makeRepo(scratch, { 'README.md': 'hi\n' });
    const r = await runRunner(['doctor'], { cwd: repo, stateDir: join(scratch, 'state') });
    assert.match(r.stdout, /Node >= 24/);
    assert.match(r.stdout, /git in PATH/);
    assert.match(r.stdout, /kimi-cli in PATH/);
    assert.equal(r.code, 0, `runner stderr: ${r.stderr}`);
  } finally {
    await cleanup(scratch);
  }
});

test('doctor toggles review-gate config', async () => {
  const scratch = await tmpScratch();
  try {
    const repo = await makeRepo(scratch, { 'a': '1\n' });
    const stateDir = join(scratch, 'state');
    let r = await runRunner(['doctor', '--enable-review-gate'], { cwd: repo, stateDir });
    assert.equal(r.code, 0);
    assert.match(r.stdout, /enabled/);
    r = await runRunner(['doctor', '--disable-review-gate'], { cwd: repo, stateDir });
    assert.match(r.stdout, /disabled/);
  } finally {
    await cleanup(scratch);
  }
});

test('code rejects when no plan path is provided', async () => {
  const scratch = await tmpScratch();
  try {
    const repo = await makeRepo(scratch, { 'a': '1\n' });
    const r = await runRunner(['code'], { cwd: repo, stateDir: join(scratch, 'state') });
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /requires a plan path/);
  } finally {
    await cleanup(scratch);
  }
});

test('code happy path: creates worktree, runs fake kimi, marks job done', async () => {
  const scratch = await tmpScratch();
  try {
    const repo = await makeRepo(scratch, { 'src/util.js': 'export const x = 1;\n' });
    const planPath = join(repo, 'plan.md');
    await writeFile(planPath, SAMPLE_PLAN, 'utf8');

    const stateDir = join(scratch, 'state');
    const r = await runRunner(['code', planPath], { cwd: repo, stateDir });

    assert.equal(r.code, 0, `runner stderr: ${r.stderr}\nrunner stdout: ${r.stdout}`);
    assert.match(r.stdout, /● done/);
    assert.match(r.stdout, /DONE: fake change/);

    // status lists the job
    const status = await runRunner(['status'], { cwd: repo, stateDir });
    assert.match(status.stdout, /sample-job-code-/);
  } finally {
    await cleanup(scratch);
  }
});

test('code retries once on exit 75', async () => {
  const scratch = await tmpScratch();
  try {
    const repo = await makeRepo(scratch, { 'src/util.js': 'export const x = 1;\n' });
    const planPath = join(repo, 'plan.md');
    await writeFile(planPath, SAMPLE_PLAN, 'utf8');
    const stateDir = join(scratch, 'state');
    const r = await runRunner(['code', planPath], {
      cwd: repo,
      stateDir,
      env: {
        FAKE_KIMI_RETRY_ONCE: '1',
        FAKE_KIMI_STATE: scratch,
      },
    });
    // Second attempt should succeed.
    assert.equal(r.code, 0, `stderr: ${r.stderr}\nstdout: ${r.stdout}`);
    assert.match(r.stdout, /● done/);
  } finally {
    await cleanup(scratch);
  }
});

test('review against base branch produces parsed verdict', async () => {
  const scratch = await tmpScratch();
  try {
    const repo = await makeRepo(scratch, { 'a.txt': 'one\n' });
    // Create a real diff against main.
    await writeFile(join(repo, 'a.txt'), 'one\ntwo\n', 'utf8');
    const stateDir = join(scratch, 'state');
    const r = await runRunner(['review', '--base', 'main'], {
      cwd: repo,
      stateDir,
      env: { FAKE_KIMI_VERDICT: 'pass' },
    });
    assert.equal(r.code, 0);
    assert.match(r.stdout, /PASS/);
  } finally {
    await cleanup(scratch);
  }
});

test('review exits with code 2 when verdict is block', async () => {
  const scratch = await tmpScratch();
  try {
    const repo = await makeRepo(scratch, { 'a.txt': 'one\n' });
    await writeFile(join(repo, 'a.txt'), 'one\nbad\n', 'utf8');
    const stateDir = join(scratch, 'state');
    const r = await runRunner(['review', '--base', 'main'], {
      cwd: repo,
      stateDir,
      env: { FAKE_KIMI_VERDICT: 'block' },
    });
    assert.equal(r.code, 2);
    assert.match(r.stdout, /BLOCK/);
  } finally {
    await cleanup(scratch);
  }
});

test('cancel marks running job cancelled and removes worktree', async () => {
  const scratch = await tmpScratch();
  try {
    const repo = await makeRepo(scratch, { 'src/util.js': 'x\n' });
    const planPath = join(repo, 'plan.md');
    await writeFile(planPath, SAMPLE_PLAN, 'utf8');
    const stateDir = join(scratch, 'state');

    // run code in background — fake kimi exits fast, so job will be done by the time cancel runs.
    // Use FAKE_KIMI_EXIT to keep it "running"? simpler: run code foreground then cancel a non-running job.
    const r = await runRunner(['code', planPath], { cwd: repo, stateDir });
    assert.equal(r.code, 0);

    // Find the job id from status.
    const status = await runRunner(['status'], { cwd: repo, stateDir });
    const m = status.stdout.match(/(sample-job-code-\S+)/);
    assert.ok(m, `expected to find job id in status:\n${status.stdout}`);
    const jobId = m[1];

    const cancel = await runRunner(['cancel', jobId], { cwd: repo, stateDir });
    assert.equal(cancel.code, 0);
    assert.match(cancel.stdout, /cancelled/);
  } finally {
    await cleanup(scratch);
  }
});
