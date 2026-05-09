#!/usr/bin/env node
// Bump the plugin version in both repo-level package.json and the
// plugin manifest, keeping them in sync. Usage: node scripts/bump-version.mjs <new-version>

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

async function bumpFile(path, newVersion) {
  const txt = await readFile(path, 'utf8');
  const obj = JSON.parse(txt);
  const old = obj.version;
  obj.version = newVersion;
  await writeFile(path, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  console.log(`  ${path}: ${old} → ${newVersion}`);
}

async function main() {
  const v = process.argv[2];
  if (!v || !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(v)) {
    console.error('usage: node scripts/bump-version.mjs <semver>');
    process.exit(1);
  }
  await bumpFile(join(root, 'package.json'), v);
  await bumpFile(join(root, 'plugins', 'kimi', '.claude-plugin', 'plugin.json'), v);
  console.log(`bumped to ${v}. remember to update CHANGELOG.md.`);
}

main();
