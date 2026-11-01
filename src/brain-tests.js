// Brain tests. Deterministic kinds run here. Reasoned kinds follow one rule:
// the brain asks, the user's agent reasons, the brain validates and remembers.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { loadExcuses, loadVoice } from './context.js';
import { fail } from './output.js';
import { TEST_KINDS } from './vocab.js';
import { contextVersion, loadExclusions, normalizeDomain } from './workspace.js';

const testsDir = (ws) => path.join(ws, 'tests');
const resultsFile = (ws) => path.join(testsDir(ws), 'results.jsonl');

export function loadCases(ws) {
  const dir = testsDir(ws);
  if (!fs.existsSync(dir)) return [];
  const cases = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.yaml')).sort()) {
    let parsed;
    try {
      parsed = YAML.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    } catch (error) {
      fail('bad_test_file', `tests/${file} is not valid YAML: ${error.message}`);
    }
    for (const item of parsed || []) cases.push({ ...item, file: `tests/${file}` });
  }
  return cases;
}

export function validateCase(item) {
  const kind = TEST_KINDS[item.kind];
  if (!item.id) return 'needs an id';
  if (!kind) return `unknown kind "${item.kind}"`;
  if (!kind.expect.includes(item.expect)) return `expect must be one of ${kind.expect.join(', ')}`;
  if (item.input === undefined || item.input === '') return 'needs an input';
  if (item.kind === 'voice' && !item.channel) return 'voice tests need a channel';
  return null;
}

export function checkDraft(ws, text, channel) {
  const { limits, banned } = loadVoice(ws);
  const words = String(text).trim().split(/\s+/).filter(Boolean).length;
  const chars = String(text).length;
  const violations = [];
  const maxWords = limits[`${channel}_words`];
  const maxChars = limits[`${channel}_chars`];
  if (maxWords && words > maxWords) violations.push(`${words} words, limit is ${maxWords}`);
  if (maxChars && chars > maxChars) violations.push(`${chars} characters, limit is ${maxChars}`);
  const lower = String(text).toLowerCase();
  for (const phrase of banned) if (lower.includes(String(phrase).toLowerCase())) violations.push(`banned phrase: "${phrase}"`);
  for (const excuse of loadExcuses(ws)) {
    for (const phrase of excuse.never || []) {
      if (lower.includes(String(phrase).toLowerCase())) violations.push(`never say for ${excuse.signal}: "${phrase}"`);
    }
  }
  return { pass: violations.length === 0, violations, words, chars };
}

export function checkCompany(ws, value) {
  const domain = normalizeDomain(value);
  const hit = loadExclusions(ws).rows.find((row) => normalizeDomain(row.domain) === domain);
  return { domain, blocked: Boolean(hit), reason: hit?.reason || (hit ? 'excluded' : null) };
}

function runDeterministic(ws, item) {
  if (item.kind === 'voice') {
    const result = checkDraft(ws, item.input, item.channel);
    const actual = result.pass ? 'pass' : 'fail';
    return { ok: actual === item.expect, actual, detail: result.violations.join('; ') };
  }
  const result = checkCompany(ws, item.input);
  const actual = result.blocked ? 'blocked' : 'allowed';
  return { ok: actual === item.expect, actual, detail: result.reason || '' };
}

export function loadResults(ws) {
  const file = resultsFile(ws);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

// Latest answer per case within one context version.
function answersFor(results, version) {
  const map = new Map();
  for (const row of results) if (row.context_version === version) map.set(row.case_id, row);
  return map;
}

function score(cases, answers) {
  const answered = cases.filter((c) => answers.has(c.id));
  const correct = answered.filter((c) => answers.get(c.id).answer === c.expect);
  return { answered: answered.length, correct: correct.length, total: cases.length };
}

export function runTests(ws) {
  const cases = loadCases(ws);
  const invalid = cases.flatMap((item) => {
    const problem = validateCase(item);
    return problem ? [{ id: item.id, file: item.file, problem }] : [];
  });
  const valid = cases.filter((item) => !validateCase(item));
  const deterministic = valid
    .filter((c) => TEST_KINDS[c.kind].mode === 'deterministic')
    .map((c) => ({ id: c.id, kind: c.kind, expect: c.expect, ...runDeterministic(ws, c) }));

  const reasoned = valid.filter((c) => TEST_KINDS[c.kind].mode === 'reasoned');
  const { version } = contextVersion(ws);
  const results = loadResults(ws);
  const current = answersFor(results, version);
  const earlier = [...new Set(results.map((r) => r.context_version))].filter((v) => v !== version);
  const previousVersion = earlier.at(-1) ?? null;
  const previous = previousVersion ? answersFor(results, previousVersion) : new Map();

  const right = (item, answers) => answers.get(item.id)?.answer === item.expect;
  const wrong = reasoned.filter((c) => current.has(c.id) && !right(c, current)).map((c) => ({
    id: c.id,
    kind: c.kind,
    answered: current.get(c.id).answer,
    expected: c.expect,
    by: current.get(c.id).by,
  }));
  const regressions = reasoned.filter((c) => current.has(c.id) && right(c, previous) && !right(c, current)).map((c) => c.id);
  const improved = reasoned.filter((c) => current.has(c.id) && previous.has(c.id) && !right(c, previous) && right(c, current)).map((c) => c.id);
  const pending = reasoned.filter((c) => !current.has(c.id)).map((c) => c.id);

  const failed = deterministic.filter((r) => !r.ok);
  return {
    context_version: version,
    passed: !invalid.length && !failed.length && !regressions.length,
    invalid,
    deterministic: { total: deterministic.length, passed: deterministic.length - failed.length, failed },
    reasoned: {
      ...score(reasoned, current),
      pending,
      wrong,
      regressions,
      improved,
      previous_version: previousVersion,
      previous: previousVersion ? score(reasoned, previous) : null,
    },
  };
}

// What the agent gets. The expected answer and tags stay out, or the test proves nothing.
export function pendingCases(ws) {
  const { version } = contextVersion(ws);
  const answered = answersFor(loadResults(ws), version);
  const cases = loadCases(ws)
    .filter((c) => !validateCase(c) && TEST_KINDS[c.kind].mode === 'reasoned' && !answered.has(c.id))
    .map((c) => ({
      id: c.id,
      kind: c.kind,
      input: c.input,
      input_is_untrusted: c.kind === 'reply',
      allowed_answers: TEST_KINDS[c.kind].expect,
      instructions: TEST_KINDS[c.kind].instructions,
    }));
  return { context_version: version, cases };
}

export function submitAnswer(ws, { id, answer, by }) {
  if (!id || !answer) fail('usage', 'Usage: gluely test submit <case-id> <answer> --by <agent/model>');
  if (!by) fail('missing_by', '--by is required, for example --by claude-code/opus-5.5.', 'Without it, a model swap looks like a context improvement.');
  const item = loadCases(ws).find((c) => c.id === id);
  if (!item) fail('unknown_case', `No test case "${id}".`);
  const kind = TEST_KINDS[item.kind];
  if (kind?.mode !== 'reasoned') fail('not_reasoned', `"${id}" runs without a model, so it takes no answer.`);
  if (!kind.expect.includes(answer)) fail('bad_answer', `"${answer}" is not allowed here. Use one of: ${kind.expect.join(', ')}.`);
  const { version } = contextVersion(ws);
  const row = { case_id: id, answer, by, context_version: version, at: new Date().toISOString() };
  fs.mkdirSync(testsDir(ws), { recursive: true });
  fs.appendFileSync(resultsFile(ws), `${JSON.stringify(row)}\n`);
  return row;
}

// Every correction becomes a test. This is how the loop learns before rates mean anything.
export function addCase(ws, { kind, input, expect, channel, why }) {
  const meta = TEST_KINDS[kind];
  if (!meta) fail('bad_kind', `--kind must be one of ${Object.keys(TEST_KINDS).join(', ')}.`);
  if (!input) fail('usage', '--input is required.');
  if (!meta.expect.includes(expect)) fail('bad_expect', `--expect must be one of ${meta.expect.join(', ')}.`);
  if (kind === 'voice' && !channel) fail('usage', 'voice tests need --channel.');
  const hash = crypto.createHash('sha256').update(`${kind}|${channel || ''}|${input}`).digest('hex').slice(0, 6);
  const id = `${kind}-${hash}`;
  if (loadCases(ws).some((c) => c.id === id)) fail('duplicate', `This correction already exists as ${id}.`);
  const item = { id, kind, ...(channel ? { channel } : {}), input, expect, ...(why ? { why } : {}), added: new Date().toISOString().slice(0, 10) };
  fs.mkdirSync(testsDir(ws), { recursive: true });
  fs.appendFileSync(path.join(testsDir(ws), `${kind}.yaml`), YAML.stringify([item]));
  return item;
}
