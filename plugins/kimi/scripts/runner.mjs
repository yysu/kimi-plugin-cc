#!/usr/bin/env node
// Main dispatcher for kimi-plugin-cc commands.
// Exposed via Claude Code commands as `node runner.mjs <subcommand> [args]`.

import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import * as fsp from 'node:fs/promises';

import { parseArgs } from './lib/args.mjs';
import { loadPlan, parsePlan, PlanError } from './lib/plan.mjs';
import { workspaceFor, jobDir, worktreePath } from './lib/workspace.mjs';
import { createWorktree, destroyWorktree } from './lib/worktree.mjs';
import {
  newJobId, createJob, updateJob, readJob, listJobs,
  refreshLiveStatus, findLatestJobForPlan, tryKill,
} from './lib/jobs.mjs';
import {
  spawnKimi, waitForExit, runKimiWithRetry,
  buildCodeArgs, buildReviewArgs, probeKimi,
  AGENT_FILES, parseKimiVersion, meetsMinKimi, MIN_KIMI,
} from './lib/kimi.mjs';
import {
  renderCodePrompt, renderReviewPrompt,
} from './lib/prompts.mjs';
import { gitDiff, gitDiffWorktreeAgainstBase } from './lib/git.mjs';
import { auditStreamJson } from './lib/audit.mjs';
import {
  ensureDir, writeJson, readJson, writeText, readText, pathExists,
} from './lib/fs.mjs';
import {
  c, statusBadge, verdictBadge, severityBadge, tableRows, elapsedSince,
} from './lib/render.mjs';

const SUBCOMMANDS = {
  doctor: cmdDoctor,
  code: cmdCode,
  review: (a) => cmdReview(a, { adversarial: false }),
  'adversarial-review': (a) => cmdReview(a, { adversarial: true }),
  status: cmdStatus,
  result: cmdResult,
  cancel: cmdCancel,
  plan: cmdPlan,
};

async function main() {
  const [, , sub, ...rest] = process.argv;
  if (!sub || sub === 'help' || sub === '--help' || sub === '-h') {
    printHelp();
    process.exit(sub ? 0 : 1);
  }
  const handler = SUBCOMMANDS[sub];
  if (!handler) {
    console.error(`unknown subcommand: ${sub}`);
    printHelp();
    process.exit(1);
  }
  try {
    const exitCode = (await handler(rest)) ?? 0;
    process.exit(exitCode);
  } catch (err) {
    if (err instanceof PlanError) {
      console.error(c.red('plan error: ') + err.message);
      process.exit(2);
    }
    console.error(c.red('error: ') + (err.stack || err.message));
    process.exit(1);
  }
}

function printHelp() {
  console.log(`kimi-plugin-cc runner

Usage: node runner.mjs <subcommand> [args]

Subcommands:
  doctor [--enable-review-gate | --disable-review-gate]
  plan write [--slug <slug>]   (reads plan markdown from stdin; writes to plans dir; prints path)
  code <plan.md> [--background] [--wait] [--resume <job-id>] [--fresh]
                 [--model <name>] [--effort low|medium|high]
  review            [--base <ref>] [--plan <path>] [--job <id>] [--background] [--wait]
  adversarial-review [...same as review...] [free-form focus text]
  status [<job-id>]
  result [<job-id>] [--json] [--diff]
  cancel [<job-id>] [--keep-worktree]
`);
}

// ─── doctor ───────────────────────────────────────────────────────────────

async function cmdDoctor(argv) {
  const args = parseArgs(argv, {
    flags: ['enable-review-gate', 'disable-review-gate'],
  });

  const checks = [];
  const node = process.versions.node;
  const major = parseInt(node.split('.')[0], 10);
  checks.push(['Node >= 24', major >= 24, `Node ${node}`]);

  const git = await runOnceCapture('git', ['--version']);
  checks.push(['git in PATH', git.code === 0, git.stdout.trim() || git.stderr.trim()]);

  const kimi = await probeKimi();
  checks.push(['kimi-cli in PATH', kimi.code === 0, kimi.stdout || kimi.stderr || '(not found)']);

  if (kimi.code === 0) {
    const v = parseKimiVersion(kimi.stdout);
    const ok = !!v && meetsMinKimi(v, MIN_KIMI);
    const detail = v
      ? `${v.raw} (need >= ${MIN_KIMI.major}.${MIN_KIMI.minor}.${MIN_KIMI.patch})`
      : 'could not parse version string';
    checks.push([`kimi >= ${MIN_KIMI.major}.${MIN_KIMI.minor}`, ok, detail]);
  }

  for (const [name, p] of Object.entries(AGENT_FILES)) {
    const ok = await pathExists(p);
    checks.push([`agent file: ${name}`, ok, ok ? p : '(missing — plugin install corrupted?)']);
  }

  let inRepo = false;
  let ws = null;
  try {
    ws = await workspaceFor(process.cwd());
    inRepo = true;
  } catch {
    /* not in a repo — fine for some commands but worth surfacing */
  }
  checks.push(['inside a git repo', inRepo, inRepo ? ws.repoToplevel : 'cwd is not a git repo']);

  // Toggle review gate config if requested. Requires a repo.
  if ((args.flags['enable-review-gate'] || args.flags['disable-review-gate']) && !ws) {
    console.error(c.red('cannot toggle review gate: not inside a git repo'));
    return 1;
  }
  if (ws) {
    const cfg = await readConfig(ws);
    if (args.flags['enable-review-gate']) cfg.review_gate_enabled = true;
    if (args.flags['disable-review-gate']) cfg.review_gate_enabled = false;
    await writeConfig(ws, cfg);
    checks.push([
      'review gate',
      true,
      cfg.review_gate_enabled ? c.yellow('enabled') : c.dim('disabled'),
    ]);
  }

  const rows = checks.map(([name, ok, detail]) => [
    ok ? c.green('✓') : c.red('✗'),
    name,
    c.dim(detail),
  ]);
  console.log(tableRows(rows));

  const allOk = checks.every(([, ok]) => ok);
  if (!allOk) {
    console.log();
    if (kimi.code !== 0) {
      console.log(c.dim('kimi-cli install: https://github.com/MoonshotAI/kimi-cli'));
      console.log(c.dim('then run: kimi login'));
    }
    return 1;
  }
  return 0;
}

async function readConfig(ws) {
  if (!(await pathExists(ws.configFile))) return {};
  try {
    return await readJson(ws.configFile);
  } catch {
    return {};
  }
}

async function writeConfig(ws, cfg) {
  await writeJson(ws.configFile, cfg);
}

// ─── code ────────────────────────────────────────────────────────────────

async function cmdCode(argv) {
  // Pre-process: support `--resume` with no value (auto-pick latest job for this plan).
  // If `--resume` is the last arg or followed by another flag, treat it as a flag.
  const argv2 = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--resume') {
      const next = argv[i + 1];
      if (next == null || next.startsWith('-')) {
        argv2.push('--resume-latest');
        continue;
      }
    }
    argv2.push(argv[i]);
  }

  const args = parseArgs(argv2, {
    flags: ['background', 'wait', 'fresh', 'no-review', 'resume-latest'],
    opts: ['resume', 'model', 'effort', 'timeout-ms', 'max-steps-per-turn'],
  });
  const planPath = args._[0];
  if (!planPath) {
    console.error(c.red('error: ') + '`code` requires a plan path. Example: node runner.mjs code plan.md');
    return 2;
  }
  if ((args.opts.resume || args.flags['resume-latest']) && args.flags.fresh) {
    console.error(c.red('error: ') + '--resume and --fresh are mutually exclusive');
    return 2;
  }

  const timeoutMs = readTimeout(args.opts['timeout-ms']);
  const maxSteps = readPositiveInt(args.opts['max-steps-per-turn']);
  const watch = !!args.flags.wait; // explicit name for "foreground with heartbeat"
  const autoReview = !args.flags['no-review'];

  const { plan, raw } = await loadPlan(planPath);
  const ws = await workspaceFor(process.cwd());

  let resumeOf = null;
  if (args.flags['resume-latest']) {
    const latest = await findLatestJobForPlan(ws, plan.id);
    if (!latest || latest.kind !== 'code') {
      console.error(c.red('error: ') +
        `no previous code job for plan "${plan.id}". Drop --resume to start fresh.`);
      return 2;
    }
    resumeOf = latest;
  } else if (args.opts.resume) {
    const j = await readJob(ws, args.opts.resume);
    if (!j) {
      console.error(c.red('error: ') + `no job with id ${args.opts.resume}`);
      return 2;
    }
    if (j.plan_id !== plan.id) {
      console.error(c.red('error: ') +
        `job ${args.opts.resume} belongs to plan "${j.plan_id}", not "${plan.id}"`);
      return 2;
    }
    resumeOf = j;
  }

  let jobId, wt;
  if (resumeOf) {
    jobId = resumeOf.job_id;
    wt = { path: resumeOf.worktree_path, branch: resumeOf.branch };
    if (!(await pathExists(wt.path))) {
      console.error(c.red('error: ') +
        `worktree for ${jobId} no longer exists at ${wt.path}; start fresh instead`);
      return 2;
    }
  } else {
    jobId = newJobId(plan.id, 'code');
    try {
      wt = await createWorktree(ws, jobId, plan.base_branch);
    } catch (e) {
      console.error(c.red('worktree error: ') + e.message);
      return 1;
    }
    await createJob(ws, jobId, {
      plan_id: plan.id,
      plan_path: resolve(planPath),
      kind: 'code',
      base_branch: plan.base_branch,
      worktree_path: wt.path,
      branch: wt.branch,
      status: 'queued',
    });
  }

  const prompt = await renderCodePrompt({
    planRaw: raw,
    jobId,
    baseBranch: plan.base_branch,
  });

  const dir = jobDir(ws, jobId);
  await ensureDir(dir);
  await writeText(join(dir, 'prompt.txt'), prompt);

  const stdoutPath = join(dir, 'stdout.jsonl');
  const stderrPath = join(dir, 'stderr.log');

  const buildArgs = () => buildCodeArgs({
    prompt,
    workDir: wt.path,
    resume: !!resumeOf,
    model: args.opts.model,
    effort: args.opts.effort,
    maxStepsPerTurn: maxSteps,
  });

  // Background path: spawn detached and return immediately.
  if (args.flags.background) {
    const child = spawnKimi(buildArgs(), {
      cwd: wt.path,
      stdoutPath,
      stderrPath,
      detached: true,
    });
    await updateJob(ws, jobId, {
      status: 'running',
      pid: child.pid,
      started_at: new Date().toISOString(),
      mode: 'background',
    });
    console.log(c.cyan('started background job:'), jobId);
    console.log(c.dim('  worktree: ') + wt.path);
    console.log(c.dim('  pid:      ') + child.pid);
    console.log(c.dim('  log:      ') + stderrPath);
    console.log();
    console.log(`Check progress: ${c.bold(`/kimi:status ${jobId}`)}`);
    console.log(`Read result:    ${c.bold(`/kimi:result ${jobId}`)}`);
    if (autoReview) {
      console.log(c.dim('(auto-review will not run for background jobs; use /kimi:review ' + planPath + ' when done)'));
    }
    return 0;
  }

  // Foreground (default; --wait adds a heartbeat for run_in_background bash).
  console.log(c.cyan(`running kimi for job ${jobId}`));
  console.log(c.dim(`  plan:     ${plan.id} — ${plan.goal.split('\n')[0]}`));
  console.log(c.dim(`  worktree: ${wt.path}`));
  console.log(c.dim(`  base:     ${plan.base_branch}`));
  if (timeoutMs) console.log(c.dim(`  timeout:  ${(timeoutMs / 1000) | 0}s`));
  await updateJob(ws, jobId, {
    status: 'running',
    started_at: new Date().toISOString(),
    mode: watch ? 'watch' : 'foreground',
  });

  const ctx = {
    cwd: wt.path,
    stdoutPath,
    stderrPath,
  };
  let stopHeartbeat = () => {};
  if (watch) stopHeartbeat = startHeartbeat(jobId, stdoutPath);

  const result = await runKimiWithRetry(buildArgs, ctx, { timeoutMs });
  stopHeartbeat();

  // Outcome.
  const tail = await tailFinalLine(stdoutPath);
  let status = 'failed';
  let exitReason = null;
  if (result.timed_out) {
    status = 'failed';
    exitReason = `timed out after ${timeoutMs}ms`;
  } else if (result.code === 0) {
    status = tail?.startsWith('BLOCKED:') ? 'blocked' : 'done';
  } else if (result.code === 75) {
    status = 'failed_retryable';
    exitReason = 'kimi exited 75 twice (retryable error)';
  } else {
    exitReason = `kimi exited ${result.code}`;
  }

  // Post-run audit: did Kimi try to write outside the worktree?
  let auditResult = { violations: [], events_seen: 0 };
  try {
    auditResult = await auditStreamJson(stdoutPath, wt.path);
  } catch { /* tolerate audit failure */ }
  if (status === 'done' && auditResult.violations.length > 0) {
    status = 'blocked';
    exitReason = `path-containment audit failed: ${auditResult.violations.length} write(s) outside worktree`;
  }

  // Capture diff for inspection.
  let diff = '';
  try {
    diff = await gitDiffWorktreeAgainstBase(wt.path, plan.base_branch);
  } catch { /* */ }
  if (diff) await writeText(join(dir, 'diff.patch'), diff);

  await updateJob(ws, jobId, {
    status,
    exit_code: result.code,
    exit_reason: exitReason,
    contract_line: tail || null,
    finished_at: new Date().toISOString(),
    attempts: result.attempts,
    timed_out: result.timed_out || false,
    audit: auditResult,
    failure_tail: status.startsWith('failed') ? await tailLines(stderrPath, 12) : null,
  });

  console.log();
  console.log(`${statusBadge(status)}  ${jobId}`);
  if (tail) console.log(c.dim('contract: ') + tail);
  if (auditResult.violations.length > 0) {
    console.log(c.red('audit:    ') + `${auditResult.violations.length} write(s) outside worktree (worktree marked blocked)`);
    auditResult.violations.slice(0, 5).forEach((v) => {
      console.log(c.red('  • ') + `${v.tool} → ${v.path}`);
    });
  }
  if (diff) {
    const fileCount = diff.split('\n').filter((l) => l.startsWith('diff --git ')).length;
    console.log(c.dim('diff:     ') + `${fileCount} file(s) changed → ${join(dir, 'diff.patch')}`);
  }

  // Auto-chain review if successful.
  if (status === 'done' && autoReview) {
    console.log();
    console.log(c.cyan('→ auto-review starting'));
    const reviewArgs = ['--job', jobId, '--plan', resolve(planPath)];
    if (timeoutMs) reviewArgs.push('--timeout-ms', String(timeoutMs));
    if (watch) reviewArgs.push('--wait');
    const reviewCode = await cmdReview(reviewArgs, { adversarial: false });
    // Surface review verdict in the final exit code: pass-through review's code.
    return reviewCode;
  }

  console.log();
  console.log(`Inspect: ${c.bold(`/kimi:result ${jobId}`)}`);
  if (status === 'done' && !autoReview) {
    console.log(`Review:  ${c.bold(`/kimi:review ${planPath}`)}`);
  }
  return status === 'done' ? 0 : 1;
}

function readTimeout(raw) {
  if (raw == null) {
    const env = process.env.KIMI_TIMEOUT_MS;
    if (!env) return null;
    return readPositiveInt(env);
  }
  return readPositiveInt(raw);
}

function readPositiveInt(raw) {
  if (raw == null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

function startHeartbeat(jobId, stdoutPath) {
  const startedAt = Date.now();
  const interval = setInterval(async () => {
    const elapsedSec = Math.floor((Date.now() - startedAt) / 1000);
    let lastEvent = '';
    try {
      const tail = await tailLines(stdoutPath, 1);
      const evt = JSON.parse(tail || '{}');
      if (evt?.role === 'tool') lastEvent = `tool:${evt.tool_call_id || ''}`;
      else if (evt?.role === 'assistant') lastEvent = 'assistant';
    } catch { /* */ }
    process.stdout.write(c.dim(`  · still running, ${elapsedSec}s${lastEvent ? ` (last: ${lastEvent})` : ''}\n`));
  }, 30_000);
  interval.unref?.();
  return () => clearInterval(interval);
}

async function tailFinalLine(filePath) {
  // Look for the last non-empty line that starts with DONE: or BLOCKED:
  if (!(await pathExists(filePath))) return null;
  const text = await readText(filePath);
  const lines = text.split('\n').reverse();
  for (const ln of lines) {
    const t = ln.trim();
    if (t.startsWith('DONE:') || t.startsWith('BLOCKED:')) return t;
  }
  return null;
}

// ─── review / adversarial-review ─────────────────────────────────────────

async function cmdReview(argv, { adversarial }) {
  const args = parseArgs(argv, {
    flags: ['background', 'wait'],
    opts: ['base', 'plan', 'job', 'model', 'effort', 'timeout-ms', 'max-steps-per-turn'],
  });
  const ws = await workspaceFor(process.cwd());

  // Resolve target source. Priority order:
  //   1. --job <id>            → that worktree vs its base branch
  //   2. positional plan.md    → latest code job for that plan id
  //   3. --plan <path> alone   → latest code job for that plan id
  //   4. --base <ref>          → current repo vs ref
  //   5. nothing               → current repo (uncommitted)
  let workDir, baseRef, sourceLabel, jobIdRef = null;
  let planRaw = null;
  let planPath = args.opts.plan ? resolve(args.opts.plan) : null;

  // For non-adversarial review: if first positional ends with .md and file exists, treat as plan.
  // For adversarial: same rule, remaining positionals become focus text.
  let focusWords = [...args._];
  if (focusWords.length && /\.md$/i.test(focusWords[0]) && (await pathExists(resolve(focusWords[0])))) {
    planPath = resolve(focusWords.shift());
  }
  const focus = adversarial ? focusWords.join(' ').trim() : '';
  if (!adversarial && focusWords.length > 0) {
    console.error(c.red('error: ') + `unexpected arguments: ${focusWords.join(' ')}`);
    return 2;
  }

  if (args.opts.job) {
    const j = await readJob(ws, args.opts.job);
    if (!j) { console.error(c.red('unknown job: ') + args.opts.job); return 2; }
    workDir = j.worktree_path;
    baseRef = j.base_branch;
    jobIdRef = j.job_id;
    sourceLabel = `job ${j.job_id} (${j.branch} vs ${baseRef})`;
    if (j.plan_path && !planPath && (await pathExists(j.plan_path))) {
      planPath = j.plan_path;
    }
  } else if (planPath) {
    // Look up latest code job for this plan id.
    let parsed;
    try { parsed = await loadPlan(planPath); }
    catch (e) { console.error(c.red('plan error: ') + e.message); return 2; }
    const planObj = parsed.plan;
    const latest = await findLatestJobForPlan(ws, planObj.id);
    if (!latest || latest.kind !== 'code') {
      console.error(c.red('error: ') +
        `no recent code job found for plan "${planObj.id}". Run /kimi:code ${planPath} first, or use /kimi:review --base <ref> for ad-hoc review.`);
      return 2;
    }
    if (!(await pathExists(latest.worktree_path))) {
      console.error(c.red('error: ') +
        `latest job ${latest.job_id} has no worktree at ${latest.worktree_path}. It may have been cancelled.`);
      return 2;
    }
    workDir = latest.worktree_path;
    baseRef = latest.base_branch;
    jobIdRef = latest.job_id;
    sourceLabel = `latest job for "${planObj.id}" — ${latest.job_id}`;
  } else {
    workDir = ws.repoToplevel;
    baseRef = args.opts.base || null;
    sourceLabel = baseRef ? `current repo vs ${baseRef}` : 'current repo (uncommitted)';
  }

  if (planPath && !planRaw) {
    planRaw = await readFile(planPath, 'utf8');
  }

  let diff = '';
  try {
    diff = baseRef
      ? await gitDiffWorktreeAgainstBase(workDir, baseRef)
      : await gitDiff(workDir, null);
  } catch (e) {
    console.error(c.red('diff error: ') + e.message);
    return 1;
  }
  if (!diff.trim()) {
    console.log(c.yellow('no diff to review (' + sourceLabel + ')'));
    return 0;
  }

  const timeoutMs = readTimeout(args.opts['timeout-ms']);
  const maxSteps = readPositiveInt(args.opts['max-steps-per-turn']);
  const watch = !!args.flags.wait;

  const kind = adversarial ? 'adversarial-review' : 'review';
  const reviewJobId = newJobId(jobIdRef || 'adhoc', kind);
  const dir = jobDir(ws, reviewJobId);
  await ensureDir(dir);

  const prompt = await renderReviewPrompt({
    diff,
    baseBranch: baseRef || 'HEAD',
    planRaw,
    adversarial,
    focus,
  });
  await writeText(join(dir, 'prompt.txt'), prompt);
  await writeText(join(dir, 'diff.patch'), diff);

  await createJob(ws, reviewJobId, {
    kind,
    plan_id: null,
    base_branch: baseRef,
    target_dir: workDir,
    related_job: jobIdRef,
    plan_path: planPath || null,
    status: 'running',
    started_at: new Date().toISOString(),
  });

  const stdoutPath = join(dir, 'stdout.txt');
  const stderrPath = join(dir, 'stderr.log');

  const buildArgs = () => buildReviewArgs({
    prompt,
    workDir,
    model: args.opts.model,
    effort: args.opts.effort,
    maxStepsPerTurn: maxSteps,
  });

  if (args.flags.background) {
    const child = spawnKimi(buildArgs(), { cwd: workDir, stdoutPath, stderrPath, detached: true });
    await updateJob(ws, reviewJobId, { pid: child.pid, mode: 'background' });
    console.log(c.cyan('started background review:'), reviewJobId);
    console.log(`Read result: ${c.bold(`/kimi:result ${reviewJobId}`)}`);
    return 0;
  }

  console.log(c.cyan(`running ${kind} on ${sourceLabel}`));
  if (timeoutMs) console.log(c.dim(`  timeout: ${(timeoutMs / 1000) | 0}s`));

  let stopHeartbeat = () => {};
  if (watch) stopHeartbeat = startHeartbeat(reviewJobId, stdoutPath);

  const result = await runKimiWithRetry(
    buildArgs,
    { cwd: workDir, stdoutPath, stderrPath },
    { timeoutMs },
  );
  stopHeartbeat();

  const out = (await readText(stdoutPath)).trim();
  const review = parseReviewOutput(out);

  await updateJob(ws, reviewJobId, {
    status: result.timed_out
      ? 'failed'
      : result.code === 0
        ? 'done'
        : 'failed',
    exit_code: result.code,
    timed_out: result.timed_out || false,
    finished_at: new Date().toISOString(),
    verdict: review.json?.verdict || null,
    failure_tail: result.code !== 0 ? await tailLines(stderrPath, 12) : null,
  });
  if (review.json) await writeJson(join(dir, 'review.json'), review.json);
  await writeText(join(dir, 'review.md'), formatReviewMarkdown(review));

  printReviewSummary(review, sourceLabel, reviewJobId);

  // Exit code reflects verdict so CI / hooks can branch on it.
  if (review.json?.verdict === 'block') return 2;
  if (review.json?.verdict === 'needs-attention') return 1;
  return 0;
}

function parseReviewOutput(stdout) {
  const lines = stdout.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const ln = lines[i];
    if (ln.startsWith('KIMI_REVIEW_JSON: ')) {
      try {
        const json = JSON.parse(ln.slice('KIMI_REVIEW_JSON: '.length));
        return { json, raw: stdout, parseError: null };
      } catch (e) {
        return { json: null, raw: stdout, parseError: e.message };
      }
    }
    if (ln.startsWith('KIMI_REVIEW_JSON_ERROR:')) {
      return { json: null, raw: stdout, parseError: ln };
    }
  }
  return { json: null, raw: stdout, parseError: 'no KIMI_REVIEW_JSON line found' };
}

function formatReviewMarkdown(review) {
  if (!review.json) {
    return `# Review (parse failed)\n\n${review.parseError}\n\n## Raw output\n\n${review.raw}\n`;
  }
  const j = review.json;
  const lines = [];
  lines.push(`# Review — ${j.verdict.toUpperCase()}`);
  lines.push('');
  lines.push(j.summary);
  lines.push('');
  if (Array.isArray(j.findings) && j.findings.length) {
    lines.push('## Findings');
    for (const f of j.findings) {
      const loc = f.file ? ` — \`${f.file}${f.line_start ? `:${f.line_start}` : ''}\`` : '';
      lines.push(`- **[${f.severity}] ${f.title}**${loc}`);
      lines.push(`  ${f.body}`);
      if (f.recommendation) lines.push(`  _Fix:_ ${f.recommendation}`);
    }
    lines.push('');
  }
  if (j.scope_check) {
    const sc = j.scope_check;
    if (sc.files_outside_whitelist?.length) {
      lines.push('## Scope violations (files outside whitelist)');
      sc.files_outside_whitelist.forEach((f) => lines.push(`- ${f}`));
      lines.push('');
    }
    if (sc.out_of_scope_violations?.length) {
      lines.push('## Out-of-scope violations');
      sc.out_of_scope_violations.forEach((f) => lines.push(`- ${f}`));
      lines.push('');
    }
    if (sc.missing_criteria?.length) {
      lines.push('## Missing success criteria');
      sc.missing_criteria.forEach((f) => lines.push(`- ${f}`));
      lines.push('');
    }
  }
  if (j.next_steps?.length) {
    lines.push('## Next steps');
    j.next_steps.forEach((s) => lines.push(`- ${s}`));
  }
  return lines.join('\n') + '\n';
}

function printReviewSummary(review, sourceLabel, jobId) {
  const j = review.json;
  console.log();
  if (!j) {
    console.log(c.red('review parse failed: ') + (review.parseError || 'unknown'));
    console.log(c.dim(`raw output saved to job ${jobId}`));
    return;
  }
  console.log(`${verdictBadge(j.verdict)}  ${c.dim(sourceLabel)}`);
  console.log();
  console.log(j.summary);
  if (j.findings?.length) {
    console.log();
    console.log(c.bold('Findings:'));
    for (const f of j.findings) {
      const loc = f.file ? c.dim(` ${f.file}${f.line_start ? `:${f.line_start}` : ''}`) : '';
      console.log(`  ${severityBadge(f.severity)} ${f.title}${loc}`);
    }
  }
  if (j.scope_check?.files_outside_whitelist?.length) {
    console.log();
    console.log(c.yellow(`scope: ${j.scope_check.files_outside_whitelist.length} file(s) outside whitelist`));
  }
  console.log();
  console.log(c.dim(`full report: /kimi:result ${jobId}`));
}

// ─── status ──────────────────────────────────────────────────────────────

async function cmdStatus(argv) {
  const args = parseArgs(argv, {});
  const ws = await workspaceFor(process.cwd());
  const jobId = args._[0];

  if (jobId) {
    const j = await refreshLiveStatus(ws, jobId);
    if (!j) { console.error('no such job: ' + jobId); return 2; }
    printJobDetail(j);
    return 0;
  }

  const all = await listJobs(ws);
  if (all.length === 0) {
    console.log(c.dim('(no jobs yet for this repo)'));
    return 0;
  }
  // Refresh running ones in case they died silently.
  for (const j of all) {
    if (j.status === 'running') await refreshLiveStatus(ws, j.job_id);
  }
  const refreshed = await listJobs(ws);

  const rows = refreshed.slice(0, 20).map((j) => [
    statusBadge(j.status),
    j.job_id,
    c.dim(j.kind || ''),
    c.dim(elapsedSince(j.created_at) + ' ago'),
  ]);
  console.log(tableRows(rows));
  if (refreshed.length > 20) {
    console.log(c.dim(`(${refreshed.length - 20} older jobs hidden)`));
  }
  return 0;
}

function printJobDetail(j) {
  console.log(`${statusBadge(j.status)}  ${c.bold(j.job_id)}`);
  console.log(c.dim('  kind:        ') + (j.kind || '?'));
  if (j.plan_id) console.log(c.dim('  plan:        ') + j.plan_id);
  if (j.base_branch) console.log(c.dim('  base:        ') + j.base_branch);
  if (j.worktree_path) console.log(c.dim('  worktree:    ') + j.worktree_path);
  if (j.related_job) console.log(c.dim('  related job: ') + j.related_job);
  if (j.pid) console.log(c.dim('  pid:         ') + j.pid);
  console.log(c.dim('  created:     ') + (j.created_at || '?'));
  if (j.started_at) console.log(c.dim('  started:     ') + j.started_at);
  if (j.finished_at) console.log(c.dim('  finished:    ') + j.finished_at);
  if (j.exit_code != null) console.log(c.dim('  exit code:   ') + j.exit_code);
  if (j.exit_reason) console.log(c.dim('  reason:      ') + j.exit_reason);
  if (j.contract_line) console.log(c.dim('  contract:    ') + j.contract_line);
  if (j.verdict) console.log(c.dim('  verdict:     ') + verdictBadge(j.verdict));
}

// ─── result ──────────────────────────────────────────────────────────────

async function cmdResult(argv) {
  const args = parseArgs(argv, { flags: ['json', 'diff'] });
  const ws = await workspaceFor(process.cwd());
  const jobId = args._[0] || (await listJobs(ws))[0]?.job_id;
  if (!jobId) { console.log(c.dim('(no jobs)')); return 0; }
  const j = await refreshLiveStatus(ws, jobId);
  if (!j) { console.error('no such job: ' + jobId); return 2; }
  const dir = jobDir(ws, jobId);

  if (args.flags.diff) {
    const diffPath = join(dir, 'diff.patch');
    if (await pathExists(diffPath)) {
      process.stdout.write(await readText(diffPath));
    } else {
      console.log(c.dim('(no diff captured for this job)'));
    }
    return 0;
  }

  if (args.flags.json) {
    const reviewJson = join(dir, 'review.json');
    if (await pathExists(reviewJson)) {
      process.stdout.write(await readText(reviewJson));
      return 0;
    }
    process.stdout.write(JSON.stringify(j, null, 2) + '\n');
    return 0;
  }

  // Pretty print.
  printJobDetail(j);
  console.log();
  if (j.kind === 'code') {
    const stdoutPath = join(dir, 'stdout.jsonl');
    if (await pathExists(stdoutPath)) {
      const tail = await tailLines(stdoutPath, 30);
      console.log(c.bold('Recent stream-json events (last 30 lines):'));
      console.log(c.dim(tail));
    }
    const diffPath = join(dir, 'diff.patch');
    if (await pathExists(diffPath)) {
      const diff = await readText(diffPath);
      const fileCount = diff.split('\n').filter((l) => l.startsWith('diff --git ')).length;
      console.log();
      console.log(c.bold(`Diff: ${fileCount} file(s) changed`));
      console.log(c.dim(`(use --diff to print the patch, or open ${diffPath})`));
    }
  } else if (j.kind === 'review' || j.kind === 'adversarial-review') {
    const reviewMd = join(dir, 'review.md');
    if (await pathExists(reviewMd)) {
      console.log(await readText(reviewMd));
    } else {
      console.log(c.dim('(no parsed review yet — try --diff to see the input)'));
    }
  }
  return 0;
}

async function tailLines(path, n, { maxBytes = 16384 } = {}) {
  // Efficient tail: stat the file, open, read only the trailing window. Avoids
  // O(file size) work per call — important for the watch-mode heartbeat that
  // hits this every 30 seconds while stdout.jsonl is being appended.
  let fh, stat;
  try {
    fh = await fsp.open(path, 'r');
    stat = await fh.stat();
  } catch {
    if (fh) await fh.close().catch(() => {});
    return '';
  }
  try {
    const size = stat.size;
    if (size === 0) return '';
    const start = Math.max(0, size - maxBytes);
    const length = size - start;
    const buf = Buffer.allocUnsafe(length);
    await fh.read(buf, 0, length, start);
    let text = buf.toString('utf8');
    // If we may have started mid-line, drop the leading partial line.
    if (start > 0) {
      const nl = text.indexOf('\n');
      if (nl >= 0) text = text.slice(nl + 1);
    }
    const lines = text.split('\n');
    return lines.slice(-n).join('\n');
  } finally {
    await fh.close().catch(() => {});
  }
}

// ─── cancel ──────────────────────────────────────────────────────────────

async function cmdCancel(argv) {
  const args = parseArgs(argv, { flags: ['keep-worktree'] });
  const ws = await workspaceFor(process.cwd());
  const jobId = args._[0] || (await findRunningJob(ws))?.job_id;
  if (!jobId) { console.log(c.dim('(no running job to cancel)')); return 0; }
  const j = await readJob(ws, jobId);
  if (!j) { console.error('no such job: ' + jobId); return 2; }

  if (j.pid && j.status === 'running') {
    await tryKill(j.pid, 'SIGTERM');
    // Give it a moment, then SIGKILL.
    await new Promise((r) => setTimeout(r, 500));
    await tryKill(j.pid, 'SIGKILL');
  }

  let removedWorktree = false;
  if (!args.flags['keep-worktree'] && j.worktree_path) {
    removedWorktree = await destroyWorktree(ws, jobId);
  }
  await updateJob(ws, jobId, {
    status: 'cancelled',
    finished_at: new Date().toISOString(),
    worktree_removed: removedWorktree,
  });
  console.log(c.yellow('cancelled ') + jobId + (removedWorktree ? c.dim(' (worktree removed)') : ''));
  return 0;
}

async function findRunningJob(ws) {
  const all = await listJobs(ws);
  for (const j of all) {
    const fresh = await refreshLiveStatus(ws, j.job_id);
    if (fresh?.status === 'running') return fresh;
  }
  return null;
}

// ─── plan ────────────────────────────────────────────────────────────────

async function cmdPlan(argv) {
  const action = argv[0];
  if (action !== 'write') {
    console.error(c.red('error: ') + 'usage: plan write [--slug <slug>] [--allow-overwrite]');
    return 2;
  }
  const args = parseArgs(argv.slice(1), {
    flags: ['allow-overwrite'],
    opts: ['slug'],
  });

  const ws = await workspaceFor(process.cwd());
  const planMarkdown = await readAllStdin();
  if (!planMarkdown.trim()) {
    console.error(c.red('error: ') + 'plan body must be supplied via stdin');
    return 2;
  }

  // Validate by parsing — refuse to write malformed plans.
  let parsed;
  try {
    parsed = parsePlan(planMarkdown);
  } catch (e) {
    console.error(c.red('plan error: ') + e.message);
    return 2;
  }
  const slug = args.opts.slug || parsed.plan.id;
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug)) {
    console.error(c.red('error: ') +
      'invalid slug — must match ^[a-z0-9][a-z0-9-]{0,63}$ (lowercase letters, digits, hyphens; max 64 chars)');
    return 2;
  }
  const ts = timestampSlug();
  const filename = `${slug}-${ts}.md`;
  const target = join(ws.plansDir, filename);

  if (!args.flags['allow-overwrite'] && await pathExists(target)) {
    console.error(c.red('error: ') + `plan already exists at ${target}`);
    return 2;
  }
  await writeText(target, planMarkdown.endsWith('\n') ? planMarkdown : planMarkdown + '\n');
  console.log(target);
  return 0;
}

async function readAllStdin() {
  if (process.stdin.isTTY) return '';
  process.stdin.setEncoding('utf8');
  let buf = '';
  // Async iteration surfaces stream errors as exceptions, so partial reads
  // become observable failures instead of silently returning a truncated body.
  for await (const chunk of process.stdin) {
    buf += chunk;
  }
  return buf;
}

function timestampSlug(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
  ].join('') + '-' + [
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join('');
}

// ─── helpers ─────────────────────────────────────────────────────────────

function runOnceCapture(cmd, args) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (b) => (stdout += b.toString('utf8')));
    child.stderr.on('data', (b) => (stderr += b.toString('utf8')));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.on('error', (err) => resolve({ code: -1, stdout: '', stderr: err.message }));
  });
}

main();
