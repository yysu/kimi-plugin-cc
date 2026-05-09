// Tiny, dependency-free terminal output helpers. We don't need full ANSI;
// just enough to make status / result readable.

const ENABLE_COLOR =
  process.stdout.isTTY && !process.env.NO_COLOR && process.env.TERM !== 'dumb';

function wrap(code, text) {
  return ENABLE_COLOR ? `\x1b[${code}m${text}\x1b[0m` : text;
}

export const c = {
  bold: (s) => wrap(1, s),
  dim: (s) => wrap(2, s),
  red: (s) => wrap(31, s),
  green: (s) => wrap(32, s),
  yellow: (s) => wrap(33, s),
  blue: (s) => wrap(34, s),
  cyan: (s) => wrap(36, s),
  gray: (s) => wrap(90, s),
};

export function statusBadge(status) {
  switch (status) {
    case 'done': return c.green('● done');
    case 'running': return c.cyan('● running');
    case 'queued': return c.dim('● queued');
    case 'failed': return c.red('● failed');
    case 'failed_retryable': return c.red('● failed (retryable)');
    case 'cancelled': return c.yellow('● cancelled');
    case 'blocked': return c.yellow('● blocked');
    default: return c.gray(`● ${status}`);
  }
}

export function verdictBadge(v) {
  switch (v) {
    case 'pass': return c.green('PASS');
    case 'needs-attention': return c.yellow('NEEDS-ATTENTION');
    case 'block': return c.red('BLOCK');
    default: return c.gray(v || '?');
  }
}

export function severityBadge(s) {
  switch (s) {
    case 'critical': return c.red(c.bold('CRIT'));
    case 'high': return c.red('HIGH');
    case 'medium': return c.yellow('MED');
    case 'low': return c.cyan('LOW');
    case 'nit': return c.gray('NIT');
    default: return c.gray(s);
  }
}

export function tableRows(rows) {
  if (rows.length === 0) return '';
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => stripAnsi(r[i]).length)));
  return rows
    .map((r) =>
      r
        .map((cell, i) => {
          const pad = widths[i] - stripAnsi(cell).length;
          return cell + ' '.repeat(Math.max(0, pad));
        })
        .join('  '),
    )
    .join('\n');
}

function stripAnsi(s) {
  return String(s).replace(/\x1b\[[0-9;]*m/g, '');
}

export function elapsedSince(iso) {
  if (!iso) return '?';
  const ms = Date.now() - Date.parse(iso);
  if (Number.isNaN(ms)) return '?';
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}
