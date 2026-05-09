import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { realpathSync } from 'node:fs';
import { auditStreamJson } from '../plugins/kimi/scripts/lib/audit.mjs';
import { tmpScratch, cleanup } from './helpers.mjs';

test('audit: empty file → no violations', async () => {
  const scratch = await tmpScratch();
  try {
    const log = join(scratch, 'stdout.jsonl');
    await writeFile(log, '');
    const r = await auditStreamJson(log, scratch);
    assert.equal(r.violations.length, 0);
  } finally { await cleanup(scratch); }
});

test('audit: relative-path WriteFile is allowed', async () => {
  const scratch = await tmpScratch();
  try {
    const wt = join(scratch, 'wt');
    await mkdir(wt, { recursive: true });
    const log = join(scratch, 'stdout.jsonl');
    const evt = {
      role: 'assistant',
      tool_calls: [{
        type: 'function',
        id: 'a',
        function: { name: 'WriteFile', arguments: JSON.stringify({ path: 'src/foo.ts' }) },
      }],
    };
    await writeFile(log, JSON.stringify(evt) + '\n');
    const r = await auditStreamJson(log, wt);
    assert.equal(r.violations.length, 0);
  } finally { await cleanup(scratch); }
});

test('audit: absolute path INSIDE worktree is allowed', async () => {
  const scratch = await tmpScratch();
  try {
    const wt = realpathSync(scratch);
    const log = join(scratch, 'stdout.jsonl');
    const evt = {
      role: 'assistant',
      tool_calls: [{
        type: 'function',
        id: 'a',
        function: { name: 'WriteFile', arguments: JSON.stringify({ path: wt + '/inside.txt' }) },
      }],
    };
    await writeFile(log, JSON.stringify(evt) + '\n');
    const r = await auditStreamJson(log, wt);
    assert.equal(r.violations.length, 0);
  } finally { await cleanup(scratch); }
});

test('audit: absolute path OUTSIDE worktree is flagged', async () => {
  const scratch = await tmpScratch();
  try {
    const wt = join(scratch, 'wt');
    await mkdir(wt, { recursive: true });
    const log = join(scratch, 'stdout.jsonl');
    const evt = {
      role: 'assistant',
      tool_calls: [{
        type: 'function',
        id: 'naughty',
        function: { name: 'WriteFile', arguments: JSON.stringify({ path: '/etc/sneaky' }) },
      }],
    };
    await writeFile(log, JSON.stringify(evt) + '\n');
    const r = await auditStreamJson(log, wt);
    assert.equal(r.violations.length, 1);
    assert.equal(r.violations[0].tool, 'WriteFile');
    assert.equal(r.violations[0].path, '/etc/sneaky');
  } finally { await cleanup(scratch); }
});

test('audit: ignores non-write tool calls', async () => {
  const scratch = await tmpScratch();
  try {
    const wt = join(scratch, 'wt');
    await mkdir(wt, { recursive: true });
    const log = join(scratch, 'stdout.jsonl');
    const evt = {
      role: 'assistant',
      tool_calls: [{
        type: 'function',
        id: 'a',
        function: { name: 'Shell', arguments: JSON.stringify({ command: 'cat /etc/passwd' }) },
      }],
    };
    await writeFile(log, JSON.stringify(evt) + '\n');
    const r = await auditStreamJson(log, wt);
    assert.equal(r.violations.length, 0);
  } finally { await cleanup(scratch); }
});
