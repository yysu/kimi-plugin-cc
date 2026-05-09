import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { newJobId } from '../plugins/kimi/scripts/lib/jobs.mjs';

test('newJobId encodes plan id, kind, and timestamp', () => {
  const fixed = new Date('2026-05-09T12:34:56Z');
  const id = newJobId('my-plan', 'code', fixed);
  assert.match(id, /^my-plan-code-202605\d\d-\d{6}$/);
});

test('newJobId differs for different kinds', () => {
  const t = new Date('2026-05-09T00:00:00Z');
  assert.notEqual(newJobId('p', 'code', t), newJobId('p', 'review', t));
});
