import { spawn } from 'node:child_process';

export function runGit(args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn('git', args, {
      cwd: opts.cwd,
      env: process.env,
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

export async function gitToplevel(cwd) {
  const r = await runGit(['rev-parse', '--show-toplevel'], { cwd });
  if (r.code !== 0) return null;
  return r.stdout.trim();
}

export async function gitDiff(cwd, ref) {
  const args = ref ? ['diff', `${ref}...HEAD`] : ['diff'];
  const r = await runGit(args, { cwd });
  if (r.code !== 0) throw new Error(`git diff failed: ${r.stderr.trim()}`);
  return r.stdout;
}

export async function gitDiffWorktreeAgainstBase(worktreeCwd, baseRef) {
  // Stage everything first — Kimi typically writes new files without committing,
  // and `git diff` skips untracked files by default. Staging puts them in the
  // index so the resulting diff captures the full set of changes.
  await runGit(['add', '-A'], { cwd: worktreeCwd });
  const r = await runGit(['diff', '--cached', baseRef], { cwd: worktreeCwd });
  if (r.code !== 0) throw new Error(`git diff failed: ${r.stderr.trim()}`);
  return r.stdout;
}

export async function gitWorktreeAdd(repoToplevel, path, branch, baseRef) {
  const r = await runGit(['worktree', 'add', '-b', branch, path, baseRef], {
    cwd: repoToplevel,
  });
  if (r.code !== 0) {
    throw new Error(`git worktree add failed: ${r.stderr.trim() || r.stdout.trim()}`);
  }
}

export async function gitWorktreeRemove(repoToplevel, path) {
  const r = await runGit(['worktree', 'remove', '--force', path], {
    cwd: repoToplevel,
  });
  // Don't hard-error: if the dir was already removed, prune handles it.
  await runGit(['worktree', 'prune'], { cwd: repoToplevel });
  return r.code === 0;
}

export async function gitWorktreeList(repoToplevel) {
  const r = await runGit(['worktree', 'list', '--porcelain'], { cwd: repoToplevel });
  if (r.code !== 0) return [];
  const entries = [];
  let cur = {};
  for (const line of r.stdout.split('\n')) {
    if (line === '') {
      if (cur.path) entries.push(cur);
      cur = {};
      continue;
    }
    const [k, ...rest] = line.split(' ');
    cur[k] = rest.join(' ');
  }
  if (cur.path) entries.push(cur);
  return entries;
}
