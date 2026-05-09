import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { realpathSync } from 'node:fs';
import { repoHash, workspaceFor } from '../plugins/kimi/scripts/lib/workspace.mjs';
import { tmpScratch, makeRepo, cleanup } from './helpers.mjs';

test('repoHash is stable and 12 chars', () => {
  const h1 = repoHash('/foo/bar');
  const h2 = repoHash('/foo/bar');
  assert.equal(h1, h2);
  assert.equal(h1.length, 12);
  assert.notEqual(h1, repoHash('/foo/baz'));
});

test('workspaceFor builds expected dirs and refuses outside a repo', async () => {
  const scratch = await tmpScratch();
  try {
    const repo = await makeRepo(scratch, { 'README.md': 'hi\n' });
    process.env.KIMI_PLUGIN_STATE_DIR = scratch + '/state';
    try {
      const ws = await workspaceFor(repo);
      // git rev-parse --show-toplevel resolves symlinks (e.g. /tmp → /private/tmp on macOS).
      assert.equal(ws.repoToplevel, realpathSync(repo));
      assert.match(ws.repoStateDir, new RegExp(scratch + '/state'));
      assert.match(ws.jobsDir, /jobs$/);
      assert.match(ws.worktreesDir, /worktrees$/);
    } finally {
      delete process.env.KIMI_PLUGIN_STATE_DIR;
    }

    await assert.rejects(
      () => workspaceFor(scratch),
      /Not inside a git repository/,
    );
  } finally {
    await cleanup(scratch);
  }
});
