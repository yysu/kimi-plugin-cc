import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpScratch, makeRepo, cleanup, runRunner, SAMPLE_PLAN } from './helpers.mjs';

test('code default: auto-chains review and surfaces verdict', async () => {
  const scratch = await tmpScratch();
  try {
    const repo = await makeRepo(scratch, { 'src/util.js': 'x\n' });
    const planPath = join(repo, 'plan.md');
    await writeFile(planPath, SAMPLE_PLAN, 'utf8');
    const r = await runRunner(['code', planPath], {
      cwd: repo,
      stateDir: join(scratch, 'state'),
      env: { FAKE_KIMI_VERDICT: 'pass' },
    });
    assert.equal(r.code, 0, `stderr: ${r.stderr}\nstdout: ${r.stdout}`);
    assert.match(r.stdout, /● done/);
    assert.match(r.stdout, /auto-review starting/);
    assert.match(r.stdout, /PASS/);
  } finally { await cleanup(scratch); }
});

test('code --no-review: skips auto-review', async () => {
  const scratch = await tmpScratch();
  try {
    const repo = await makeRepo(scratch, { 'src/util.js': 'x\n' });
    const planPath = join(repo, 'plan.md');
    await writeFile(planPath, SAMPLE_PLAN, 'utf8');
    const r = await runRunner(['code', planPath, '--no-review'], {
      cwd: repo,
      stateDir: join(scratch, 'state'),
    });
    assert.equal(r.code, 0);
    assert.doesNotMatch(r.stdout, /auto-review starting/);
    assert.match(r.stdout, /Review:/); // it suggests the manual command instead
  } finally { await cleanup(scratch); }
});

test('code default: auto-review BLOCK propagates as exit code 2', async () => {
  const scratch = await tmpScratch();
  try {
    const repo = await makeRepo(scratch, { 'src/util.js': 'x\n' });
    const planPath = join(repo, 'plan.md');
    await writeFile(planPath, SAMPLE_PLAN, 'utf8');
    const r = await runRunner(['code', planPath], {
      cwd: repo,
      stateDir: join(scratch, 'state'),
      env: { FAKE_KIMI_VERDICT: 'block' },
    });
    assert.equal(r.code, 2);
    assert.match(r.stdout, /BLOCK/);
  } finally { await cleanup(scratch); }
});

test('review by positional plan: finds latest code job', async () => {
  const scratch = await tmpScratch();
  try {
    const repo = await makeRepo(scratch, { 'src/util.js': 'x\n' });
    const planPath = join(repo, 'plan.md');
    await writeFile(planPath, SAMPLE_PLAN, 'utf8');
    const stateDir = join(scratch, 'state');

    // First, run code with --no-review so we have a finished code job.
    const code = await runRunner(['code', planPath, '--no-review'], { cwd: repo, stateDir });
    assert.equal(code.code, 0);

    // Now ad-hoc review by passing the plan path.
    const review = await runRunner(['review', planPath], {
      cwd: repo, stateDir,
      env: { FAKE_KIMI_VERDICT: 'pass' },
    });
    assert.equal(review.code, 0, `stderr: ${review.stderr}\nstdout: ${review.stdout}`);
    assert.match(review.stdout, /latest job for "sample-job"/);
    assert.match(review.stdout, /PASS/);
  } finally { await cleanup(scratch); }
});

test('review with positional plan but no prior code job: clear error', async () => {
  const scratch = await tmpScratch();
  try {
    const repo = await makeRepo(scratch, { 'src/util.js': 'x\n' });
    const planPath = join(repo, 'plan.md');
    await writeFile(planPath, SAMPLE_PLAN, 'utf8');
    const r = await runRunner(['review', planPath], { cwd: repo, stateDir: join(scratch, 'state') });
    assert.equal(r.code, 2);
    assert.match(r.stderr, /no recent code job/);
  } finally { await cleanup(scratch); }
});

test('code --resume (no id): auto-resumes the latest job for the plan', async () => {
  const scratch = await tmpScratch();
  try {
    const repo = await makeRepo(scratch, { 'src/util.js': 'x\n' });
    const planPath = join(repo, 'plan.md');
    await writeFile(planPath, SAMPLE_PLAN, 'utf8');
    const stateDir = join(scratch, 'state');

    const first = await runRunner(['code', planPath, '--no-review'], { cwd: repo, stateDir });
    assert.equal(first.code, 0);

    const resumed = await runRunner(['code', planPath, '--resume', '--no-review'], { cwd: repo, stateDir });
    assert.equal(resumed.code, 0, `stderr: ${resumed.stderr}\nstdout: ${resumed.stdout}`);
    assert.match(resumed.stdout, /● done/);
  } finally { await cleanup(scratch); }
});

test('code --resume on plan with no prior job: clear error', async () => {
  const scratch = await tmpScratch();
  try {
    const repo = await makeRepo(scratch, { 'src/util.js': 'x\n' });
    const planPath = join(repo, 'plan.md');
    await writeFile(planPath, SAMPLE_PLAN, 'utf8');
    const r = await runRunner(['code', planPath, '--resume'], { cwd: repo, stateDir: join(scratch, 'state') });
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /no previous code job/);
  } finally { await cleanup(scratch); }
});

test('audit: write outside worktree marks job blocked', async () => {
  const scratch = await tmpScratch();
  try {
    const repo = await makeRepo(scratch, { 'src/util.js': 'x\n' });
    const planPath = join(repo, 'plan.md');
    await writeFile(planPath, SAMPLE_PLAN, 'utf8');
    const r = await runRunner(['code', planPath, '--no-review'], {
      cwd: repo,
      stateDir: join(scratch, 'state'),
      env: { FAKE_KIMI_WRITE_OUTSIDE: '/tmp/escape-target' },
    });
    assert.equal(r.code, 1);
    assert.match(r.stdout, /● blocked/);
    assert.match(r.stdout, /write\(s\) outside worktree/);
  } finally { await cleanup(scratch); }
});

test('code --background: detaches and skips auto-review', async () => {
  const scratch = await tmpScratch();
  try {
    const repo = await makeRepo(scratch, { 'src/util.js': 'x\n' });
    const planPath = join(repo, 'plan.md');
    await writeFile(planPath, SAMPLE_PLAN, 'utf8');
    const r = await runRunner(['code', planPath, '--background'], { cwd: repo, stateDir: join(scratch, 'state') });
    assert.equal(r.code, 0);
    assert.match(r.stdout, /started background job:/);
    assert.match(r.stdout, /auto-review will not run for background/);
  } finally { await cleanup(scratch); }
});

test('doctor: surfaces kimi minimum-version check and agent-file check', async () => {
  const scratch = await tmpScratch();
  try {
    const repo = await makeRepo(scratch, { 'a': '1\n' });
    const r = await runRunner(['doctor'], { cwd: repo, stateDir: join(scratch, 'state') });
    assert.match(r.stdout, /kimi >= /);
    assert.match(r.stdout, /agent file: code/);
    assert.match(r.stdout, /agent file: review/);
  } finally { await cleanup(scratch); }
});
