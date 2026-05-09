import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { splitFrontmatter } from './yaml.mjs';

const REQUIRED_STRING = ['id', 'goal', 'base_branch'];
const REQUIRED_ARRAY = ['files_may_touch', 'out_of_scope', 'success_criteria'];
const OPTIONAL_ARRAY = ['constraints'];
const OPTIONAL_STRING = ['notes_for_kimi'];
const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export class PlanError extends Error {
  constructor(msg, path) {
    super(path ? `${path}: ${msg}` : msg);
    this.name = 'PlanError';
  }
}

export async function loadPlan(planPath) {
  const absPath = resolve(planPath);
  let raw;
  try {
    raw = await readFile(absPath, 'utf8');
  } catch (e) {
    throw new PlanError(`cannot read plan file (${e.code || e.message})`, absPath);
  }
  return parsePlan(raw, absPath);
}

export function parsePlan(markdown, sourcePath) {
  let split;
  try {
    split = splitFrontmatter(markdown);
  } catch (e) {
    throw new PlanError(e.message, sourcePath);
  }
  const data = split.data;
  if (!data) {
    throw new PlanError(
      'plan must start with `---` YAML frontmatter (id, goal, base_branch, files_may_touch, out_of_scope, success_criteria)',
      sourcePath,
    );
  }

  const errors = [];
  for (const k of REQUIRED_STRING) {
    if (typeof data[k] !== 'string' || data[k].trim() === '') {
      errors.push(`missing or empty string field "${k}"`);
    }
  }
  for (const k of REQUIRED_ARRAY) {
    if (!Array.isArray(data[k])) {
      errors.push(`missing array field "${k}"`);
    } else if (data[k].some((x) => typeof x !== 'string' || x.trim() === '')) {
      errors.push(`field "${k}" must be an array of non-empty strings`);
    }
  }
  if (Array.isArray(data.files_may_touch) && data.files_may_touch.length === 0) {
    errors.push('"files_may_touch" must contain at least one glob');
  }
  if (Array.isArray(data.success_criteria) && data.success_criteria.length === 0) {
    errors.push('"success_criteria" must contain at least one entry');
  }
  if (typeof data.id === 'string' && !ID_RE.test(data.id)) {
    errors.push(
      `"id" must match ${ID_RE} (lowercase letters, digits, hyphens; max 64 chars)`,
    );
  }
  for (const k of OPTIONAL_ARRAY) {
    if (k in data && !Array.isArray(data[k])) {
      errors.push(`"${k}" must be an array if present`);
    }
  }
  for (const k of OPTIONAL_STRING) {
    if (k in data && typeof data[k] !== 'string') {
      errors.push(`"${k}" must be a string if present`);
    }
  }

  const known = new Set([
    ...REQUIRED_STRING,
    ...REQUIRED_ARRAY,
    ...OPTIONAL_ARRAY,
    ...OPTIONAL_STRING,
  ]);
  for (const k of Object.keys(data)) {
    if (!known.has(k)) errors.push(`unknown field "${k}"`);
  }

  if (errors.length) {
    throw new PlanError(`invalid plan:\n  - ${errors.join('\n  - ')}`, sourcePath);
  }

  return {
    plan: {
      id: data.id,
      goal: data.goal,
      base_branch: data.base_branch,
      files_may_touch: data.files_may_touch,
      out_of_scope: data.out_of_scope,
      success_criteria: data.success_criteria,
      constraints: data.constraints || [],
      notes_for_kimi: data.notes_for_kimi || '',
    },
    body: split.body,
    sourcePath,
    raw: markdown,
  };
}
