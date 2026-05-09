import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpScratch, makeRepo, cleanup, RUNNER, FAKE_KIMI_BIN, SAMPLE_PLAN } from './helpers.mjs';

function runRunnerStdin(args, { cwd, stateDir, stdin }) {
  return new Promise((resolve) => {
    const child = spawn('node', [RUNNER, ...args], {
      cwd,
      env: {
        ...process.env,
        KIMI_PLUGIN_STATE_DIR: stateDir,
        PATH: `${FAKE_KIMI_BIN}:${process.env.PATH}`,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (b) => (stdout += b.toString('utf8')));
    child.stderr.on('data', (b) => (stderr += b.toString('utf8')));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.write(stdin);
    child.stdin.end();
  });
}

test('plan write: valid plan via stdin → file written, path printed', async () => {
  const scratch = await tmpScratch();
  try {
    const repo = await makeRepo(scratch, { 'README': 'x\n' });
    const stateDir = join(scratch, 'state');
    const r = await runRunnerStdin(['plan', 'write'], {
      cwd: repo, stateDir, stdin: SAMPLE_PLAN,
    });
    assert.equal(r.code, 0, `stderr: ${r.stderr}`);
    const path = r.stdout.trim();
    assert.match(path, /\/plans\/sample-job-\d{8}-\d{6}\.md$/);
    const written = await readFile(path, 'utf8');
    assert.equal(written.trim(), SAMPLE_PLAN.trim());
  } finally { await cleanup(scratch); }
});

test('plan write: rejects malformed plan with non-zero exit', async () => {
  const scratch = await tmpScratch();
  try {
    const repo = await makeRepo(scratch, { 'README': 'x\n' });
    const r = await runRunnerStdin(['plan', 'write'], {
      cwd: repo,
      stateDir: join(scratch, 'state'),
      stdin: '# not a plan, no frontmatter\n',
    });
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /plan error/);
  } finally { await cleanup(scratch); }
});

test('plan write: --slug overrides id-based filename', async () => {
  const scratch = await tmpScratch();
  try {
    const repo = await makeRepo(scratch, { 'README': 'x\n' });
    const r = await runRunnerStdin(['plan', 'write', '--slug', 'custom-name'], {
      cwd: repo,
      stateDir: join(scratch, 'state'),
      stdin: SAMPLE_PLAN,
    });
    assert.equal(r.code, 0);
    assert.match(r.stdout.trim(), /\/plans\/custom-name-\d{8}-\d{6}\.md$/);
  } finally { await cleanup(scratch); }
});

test('plan write: empty stdin is rejected', async () => {
  const scratch = await tmpScratch();
  try {
    const repo = await makeRepo(scratch, { 'README': 'x\n' });
    const r = await runRunnerStdin(['plan', 'write'], {
      cwd: repo, stateDir: join(scratch, 'state'), stdin: '',
    });
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /must be supplied via stdin/);
  } finally { await cleanup(scratch); }
});

test('plan write: written file lives under the plans dir, not the user repo', async () => {
  const scratch = await tmpScratch();
  try {
    const repo = await makeRepo(scratch, { 'README': 'x\n' });
    const stateDir = join(scratch, 'state');
    const r = await runRunnerStdin(['plan', 'write'], {
      cwd: repo, stateDir, stdin: SAMPLE_PLAN,
    });
    assert.equal(r.code, 0);
    const path = r.stdout.trim();
    assert.ok(path.startsWith(stateDir), `expected path under ${stateDir}, got ${path}`);
    // And not anywhere inside the caller's repo
    assert.ok(!path.startsWith(repo), `plan must not be written inside the caller's repo: ${path}`);
    await stat(path); // file actually exists
  } finally { await cleanup(scratch); }
});
