import { mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';

export async function ensureDir(path) {
  await mkdir(path, { recursive: true });
}

export async function writeJson(path, data) {
  await ensureDir(dirname(path));
  await writeFile(path, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

export async function readJson(path) {
  const txt = await readFile(path, 'utf8');
  return JSON.parse(txt);
}

export async function readText(path) {
  return readFile(path, 'utf8');
}

export async function writeText(path, text) {
  await ensureDir(dirname(path));
  await writeFile(path, text, 'utf8');
}

export async function removeTree(path) {
  await rm(path, { recursive: true, force: true });
}

export async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export { existsSync };
