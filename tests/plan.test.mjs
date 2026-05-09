import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { parsePlan, PlanError } from '../plugins/kimi/scripts/lib/plan.mjs';

const VALID = `---
id: my-job
goal: do a thing
base_branch: main
files_may_touch:
  - src/**
out_of_scope:
  - foo
success_criteria:
  - it works
---
body
`;

test('valid plan parses', () => {
  const r = parsePlan(VALID);
  assert.equal(r.plan.id, 'my-job');
  assert.equal(r.plan.base_branch, 'main');
  assert.deepEqual(r.plan.files_may_touch, ['src/**']);
});

test('missing required field throws', () => {
  const md = VALID.replace('id: my-job\n', '');
  assert.throws(() => parsePlan(md), PlanError);
});

test('empty array for required collection throws', () => {
  const md = VALID.replace('  - it works\n', '');
  assert.throws(() => parsePlan(md), /success_criteria/);
});

test('invalid id throws', () => {
  const md = VALID.replace('id: my-job', 'id: BadId');
  assert.throws(() => parsePlan(md), /id/);
});

test('unknown field is rejected', () => {
  const md = VALID.replace('---\nbody\n', 'random: yes\n---\nbody\n');
  assert.throws(() => parsePlan(md), /unknown field/);
});

test('plan without frontmatter throws clear error', () => {
  assert.throws(() => parsePlan('# no frontmatter\n'), /YAML frontmatter/);
});
