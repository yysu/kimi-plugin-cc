import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { parseYaml, splitFrontmatter } from '../plugins/kimi/scripts/lib/yaml.mjs';

test('parses simple key/value pairs', () => {
  const out = parseYaml(`name: kimi\nversion: 1\nactive: true\n`);
  assert.deepEqual(out, { name: 'kimi', version: 1, active: true });
});

test('parses double-quoted strings with escapes', () => {
  const out = parseYaml(`title: "hello \\"world\\""\nbreaks: "a\\nb"\n`);
  assert.equal(out.title, 'hello "world"');
  assert.equal(out.breaks, 'a\nb');
});

test('parses block-literal scalar', () => {
  const yaml = `goal: |\n  multi\n  line\n  goal\nnext: x\n`;
  const out = parseYaml(yaml);
  assert.equal(out.goal, 'multi\nline\ngoal');
  assert.equal(out.next, 'x');
});

test('parses string array', () => {
  const yaml = `items:\n  - one\n  - "two"\n  - three\n`;
  const out = parseYaml(yaml);
  assert.deepEqual(out.items, ['one', 'two', 'three']);
});

test('ignores blank and comment lines', () => {
  const yaml = `# top comment\n\nkey: value\n# inline block\nother: 2\n`;
  const out = parseYaml(yaml);
  assert.deepEqual(out, { key: 'value', other: 2 });
});

test('splitFrontmatter returns null data when no `---` opener', () => {
  const r = splitFrontmatter('# just markdown\n');
  assert.equal(r.data, null);
  assert.match(r.body, /just markdown/);
});

test('splitFrontmatter throws when frontmatter is unclosed', () => {
  assert.throws(() => splitFrontmatter('---\nkey: v\n# never closes'));
});

test('splitFrontmatter returns parsed data + body', () => {
  const md = `---\nid: x\ngoal: y\n---\nbody here\n`;
  const r = splitFrontmatter(md);
  assert.deepEqual(r.data, { id: 'x', goal: 'y' });
  assert.match(r.body, /body here/);
});
