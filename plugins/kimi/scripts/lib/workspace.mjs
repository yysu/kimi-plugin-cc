import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { gitToplevel } from './git.mjs';
import { ensureDir } from './fs.mjs';

const ROOT_ENV = 'KIMI_PLUGIN_STATE_DIR';

export function stateRoot() {
  return process.env[ROOT_ENV] || join(homedir(), '.kimi-plugin-cc');
}

export function repoHash(repoToplevel) {
  return createHash('sha1').update(repoToplevel).digest('hex').slice(0, 12);
}

export async function workspaceFor(cwd) {
  const top = await gitToplevel(cwd);
  if (!top) {
    throw new Error(
      'Not inside a git repository. /kimi:code requires a git repo so the worktree can be created.',
    );
  }
  const hash = repoHash(top);
  const root = stateRoot();
  const repoState = join(root, 'state', hash);
  const ws = {
    repoToplevel: top,
    repoHash: hash,
    stateRoot: root,
    repoStateDir: repoState,
    jobsDir: join(repoState, 'jobs'),
    worktreesDir: join(repoState, 'worktrees'),
    configFile: join(repoState, 'config.json'),
  };
  await ensureDir(ws.jobsDir);
  await ensureDir(ws.worktreesDir);
  return ws;
}

export function jobDir(ws, jobId) {
  return join(ws.jobsDir, jobId);
}

export function worktreePath(ws, jobId) {
  return join(ws.worktreesDir, jobId);
}
