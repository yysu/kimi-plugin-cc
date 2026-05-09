import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { readJson, writeJson, writeText, readText, pathExists, removeTree } from './fs.mjs';
import { jobDir } from './workspace.mjs';

// status values:
//   queued, running, done, failed, failed_retryable, cancelled, blocked
// phase values:
//   code, review, adversarial-review

export function newJobId(planId, kind = 'code', now = new Date()) {
  const ts = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('') + '-' + [
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ].join('');
  return `${planId}-${kind}-${ts}`;
}

export async function createJob(ws, jobId, meta) {
  const dir = jobDir(ws, jobId);
  const record = {
    job_id: jobId,
    status: 'queued',
    created_at: new Date().toISOString(),
    ...meta,
  };
  await writeJson(join(dir, 'meta.json'), record);
  await writeText(join(dir, 'status'), 'queued\n');
  return record;
}

export async function readJob(ws, jobId) {
  const dir = jobDir(ws, jobId);
  if (!(await pathExists(dir))) return null;
  try {
    return await readJson(join(dir, 'meta.json'));
  } catch {
    return null;
  }
}

export async function updateJob(ws, jobId, patch) {
  const cur = await readJob(ws, jobId);
  if (!cur) throw new Error(`unknown job ${jobId}`);
  const next = { ...cur, ...patch, updated_at: new Date().toISOString() };
  await writeJson(join(jobDir(ws, jobId), 'meta.json'), next);
  if (patch.status) {
    await writeText(join(jobDir(ws, jobId), 'status'), `${patch.status}\n`);
  }
  return next;
}

export async function listJobs(ws) {
  if (!(await pathExists(ws.jobsDir))) return [];
  const ids = await readdir(ws.jobsDir);
  const out = [];
  for (const id of ids) {
    const meta = await readJob(ws, id);
    if (meta) out.push(meta);
  }
  out.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  return out;
}

export async function findLatestJobForPlan(ws, planId) {
  const jobs = await listJobs(ws);
  return jobs.find((j) => j.plan_id === planId) || null;
}

export async function isAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function refreshLiveStatus(ws, jobId) {
  const j = await readJob(ws, jobId);
  if (!j) return null;
  if (j.status === 'running' && j.pid) {
    if (!(await isAlive(j.pid))) {
      // Process died without us noticing. Mark as failed unless an explicit
      // status file says otherwise.
      const statusFile = join(jobDir(ws, jobId), 'status');
      const onDisk = (await pathExists(statusFile)) ? (await readText(statusFile)).trim() : '';
      if (onDisk !== 'done' && onDisk !== 'failed' && onDisk !== 'cancelled') {
        return await updateJob(ws, jobId, { status: 'failed', exit_reason: 'process disappeared' });
      }
      return await updateJob(ws, jobId, { status: onDisk });
    }
  }
  return j;
}

export async function tryKill(pid, signal = 'SIGTERM') {
  if (!pid) return false;
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
}

export async function purgeJob(ws, jobId) {
  await removeTree(jobDir(ws, jobId));
}
