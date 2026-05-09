import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(HERE, '..', '..', 'prompts');

export async function loadTemplate(name) {
  return await readFile(join(PROMPTS_DIR, `${name}.md`), 'utf8');
}

export function fill(template, vars) {
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (m, key) => {
    if (!(key in vars)) {
      throw new Error(`prompt template references unknown placeholder ${key}`);
    }
    return String(vars[key]);
  });
}

export async function renderCodePrompt({ planRaw, jobId, baseBranch }) {
  const tpl = await loadTemplate('code');
  return fill(tpl, {
    PLAN_FULL_MARKDOWN: planRaw,
    JOB_ID: jobId,
    BASE_BRANCH: baseBranch,
  });
}

export async function renderReviewPrompt({ diff, baseBranch, planRaw, adversarial = false, focus = '' }) {
  const tpl = await loadTemplate(adversarial ? 'adversarial-review' : 'review');
  const planNote = planRaw
    ? `Plan provided. Use its success_criteria, out_of_scope, and files_may_touch as the rubric. Plan follows:\n\n${planRaw}`
    : 'No plan was provided. Judge the diff on correctness, security, and maintainability alone.';
  return fill(tpl, {
    DIFF: diff || '(empty diff)',
    BASE_BRANCH: baseBranch,
    PLAN_OR_NOTE: planNote,
    FOCUS: focus || '(none)',
  });
}

export async function renderStopGatePrompt({ turnDiff, claudeResponseTail }) {
  const tpl = await loadTemplate('stop-gate');
  return fill(tpl, {
    TURN_DIFF: turnDiff || '(no diff captured)',
    CLAUDE_RESPONSE_TAIL: claudeResponseTail || '(empty)',
  });
}
