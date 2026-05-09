import { gitWorktreeAdd, gitWorktreeRemove } from './git.mjs';
import { worktreePath } from './workspace.mjs';
import { pathExists, removeTree } from './fs.mjs';

export async function createWorktree(ws, jobId, baseBranch) {
  const path = worktreePath(ws, jobId);
  if (await pathExists(path)) {
    throw new Error(`worktree already exists at ${path}`);
  }
  const branch = `kimi/${jobId}`;
  await gitWorktreeAdd(ws.repoToplevel, path, branch, baseBranch);
  return { path, branch };
}

export async function destroyWorktree(ws, jobId) {
  const path = worktreePath(ws, jobId);
  if (!(await pathExists(path))) return false;
  const removed = await gitWorktreeRemove(ws.repoToplevel, path);
  if (!removed) {
    // Fall back to plain rm; prune will reconcile git's metadata.
    await removeTree(path);
  }
  return true;
}
