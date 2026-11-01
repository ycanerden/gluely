import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { parseArgs } from '../src/cli.js';
import { normalizeDomain, parseCsv } from '../src/workspace.js';
import { commit, fillContext, gluely, makeWorkspace, ROOT, tempDir, write } from './helpers.js';

const PLAY = (over = '') => `id: first-play
status: draft
hypothesis: People who comment on our posts will take a meeting.
signal: { type: signal.post_engagement }
audience: { personas: [head-of-sales] }
excuse: { variants: [a] }
action: { channels: [email], tool: any }
success: { primary: meeting_booked }
kill: { after_touches: 100, if: "meeting_rate < 0.5%" }
${over}`;

test('parseArgs keeps a positional after a boolean flag', () => {
  const args = parseArgs(['--json', 'doctor', '--company', 'A B']);
  assert.deepEqual(args._, ['doctor']);
  assert.equal(args.flags.json, true);
  assert.equal(args.flags.company, 'A B');
});

test('csv parsing handles quoted commas, and domains normalise', () => {
  assert.equal(parseCsv('domain,name\nclient.example,"Client, Inc"\n').rows[0].name, 'Client, Inc');
  assert.equal(normalizeDomain('https://www.Acme.com/pricing'), 'acme.com');
});

test('init refuses to put company data inside the public repo', () => {
  const result = gluely(['init', path.join(ROOT, 'workspace'), '--company', 'Acme', '--json'], ROOT);
  assert.equal(result.code, 1);
  assert.equal(result.json.error.code, 'inside_core');
  assert.equal(fs.existsSync(path.join(ROOT, 'workspace')), false);
});

test('init refuses a folder that already has files', () => {
  const dir = tempDir();
  write(dir, 'keep.txt', 'x');
  assert.equal(gluely(['init', dir, '--company', 'Acme', '--json'], dir).json.error.code, 'not_empty');
});

test('a new workspace is committed, has skills for both hosts, and points to setup', () => {
  const ws = makeWorkspace();
  const { json } = gluely(['doctor', '--json'], ws);
  assert.match(json.context_version, /^[0-9a-f]{7,}$/);
  assert.equal(json.ready, false);
  assert.match(json.next.how, /setup-gluely/);
  assert.ok(fs.existsSync(path.join(ws, '.claude/skills/gtm-mode/playbooks/new-play.md')));
  assert.ok(fs.existsSync(path.join(ws, '.cursor/skills/setup-gluely/SKILL.md')));
});

test('errors are structured under --json and exit non-zero', () => {
  const result = gluely(['doctor', '--json'], tempDir());
  assert.equal(result.code, 1);
  assert.deepEqual([result.json.ok, result.json.error.code], [false, 'no_workspace']);
});

test('context check catches a broken ICP and a missing required file', () => {
  const ws = makeWorkspace();
  fillContext(ws);
  write(ws, 'context/icp.md', '---\nid: icp\nstatus: draft\n---\n# ICP\n');
  fs.rmSync(path.join(ws, 'context/positioning.md'));
  const result = gluely(['context', 'check', '--json'], ws);
  assert.equal(result.code, 1);
  const text = JSON.stringify(result.json.issues);
  assert.match(text, /Must have/);
  assert.match(text, /positioning\.md/);
});

test('a play without a kill rule is rejected', () => {
  const ws = makeWorkspace();
  fillContext(ws);
  write(ws, 'plays/first-play.yaml', PLAY().replace(/^kill:.*$/m, ''));
  const result = gluely(['plays', 'validate', '--json'], ws);
  assert.equal(result.code, 1);
  assert.match(JSON.stringify(result.json.issues), /missing \\"kill\\"/);
});

test('a draft play may be incomplete, an active one may not', () => {
  const ws = makeWorkspace();
  fillContext(ws);
  write(ws, 'plays/first-play.yaml', PLAY().replace('[head-of-sales]', '[nobody]'));
  assert.equal(gluely(['plays', 'validate', '--json'], ws).code, 0);
  write(ws, 'plays/first-play.yaml', PLAY().replace('[head-of-sales]', '[nobody]').replace('status: draft', 'status: active'));
  assert.equal(gluely(['plays', 'validate', '--json'], ws).code, 1);
});

test('the base can be extended with a new signal without touching core', () => {
  const ws = makeWorkspace();
  fillContext(ws);
  const custom = PLAY().replace('signal.post_engagement', 'signal.podcast_mention');
  write(ws, 'plays/first-play.yaml', custom);
  assert.equal(gluely(['plays', 'validate', '--json'], ws).code, 1);
  const cfg = path.join(ws, 'workspace.yaml');
  fs.writeFileSync(cfg, fs.readFileSync(cfg, 'utf8').replace('signals: []', 'signals: [signal.podcast_mention]'));
  assert.equal(gluely(['plays', 'validate', '--json'], ws).code, 0);
});

test('plays new creates a play from the template, once', () => {
  const ws = makeWorkspace();
  fillContext(ws);
  assert.equal(gluely(['plays', 'new', 'job-switch', '--json'], ws).code, 0);
  assert.match(fs.readFileSync(path.join(ws, 'plays/job-switch.yaml'), 'utf8'), /^id: job-switch$/m);
  assert.equal(gluely(['plays', 'new', 'job-switch', '--json'], ws).json.error.code, 'exists');
});

test('draft check enforces voice limits, banned phrases and never-say rules', () => {
  const ws = makeWorkspace();
  const check = (text, channel = 'email') => gluely(['check', 'draft', '--channel', channel, '--text', text, '--json'], ws);
  assert.equal(check('Congrats on the role. Worth 15 minutes?').code, 0);
  assert.match(check('I hope this finds you well').json.violations[0], /banned/);
  assert.match(check('I saw you changed jobs').json.violations[0], /never say/);
  assert.match(check('word '.repeat(91)).json.violations[0], /91 words/);
  assert.match(check('x'.repeat(301), 'linkedin_note').json.violations[0], /301 characters/);
});

test('company check blocks excluded domains however they are written', () => {
  const ws = makeWorkspace();
  fillContext(ws);
  const blocked = gluely(['check', 'company', 'https://www.CLIENT.example/about', '--json'], ws);
  assert.deepEqual([blocked.code, blocked.json.blocked, blocked.json.reason], [1, true, 'client']);
  assert.equal(gluely(['check', 'company', 'other.example', '--json'], ws).code, 0);
});

test('pending cases never reveal the expected answer or attack tags', () => {
  const ws = makeWorkspace();
  const { json } = gluely(['test', 'pending', '--json'], ws);
  const attack = json.cases.find((c) => c.id === 'reply-attack-hidden-instruction');
  assert.equal(attack.input_is_untrusted, true);
  assert.equal('expect' in attack, false);
  assert.equal('tags' in attack, false);
});

test('submit requires a reasoner, a known case and an allowed answer', () => {
  const ws = makeWorkspace();
  const code = (args) => gluely(['test', 'submit', ...args, '--json'], ws).json.error?.code;
  assert.equal(code(['reply-clear-yes', 'positive']), 'missing_by');
  assert.equal(code(['nope', 'positive', '--by', 'a/b']), 'unknown_case');
  assert.equal(code(['reply-clear-yes', 'maybe', '--by', 'a/b']), 'bad_answer');
  assert.equal(code(['voice-rejects-banned-opener', 'fail', '--by', 'a/b']), 'not_reasoned');
});

test('a dirty context is never mistaken for the committed one', () => {
  const ws = makeWorkspace();
  const clean = gluely(['context', 'version', '--json'], ws).json;
  assert.equal(clean.dirty, false);
  write(ws, 'context/company.md', 'changed');
  assert.equal(gluely(['context', 'version', '--json'], ws).json.version, `${clean.version}-dirty`);
});

test('a failing rule test fails the run', () => {
  const ws = makeWorkspace();
  write(ws, 'tests/voice.yaml', '- { id: bad, kind: voice, channel: email, input: "synergy", expect: pass }\n');
  const result = gluely(['test', '--json'], ws);
  assert.equal(result.code, 1);
  assert.equal(result.json.deterministic.failed[0].actual, 'fail');
});

test('a broken test case is reported, not skipped', () => {
  const ws = makeWorkspace();
  write(ws, 'tests/reply.yaml', '- { id: odd, kind: reply, input: "hi", expect: maybe }\n');
  const result = gluely(['test', '--json'], ws);
  assert.equal(result.code, 1);
  assert.match(result.json.invalid[0].problem, /expect must be/);
});

test('any tool name is valid, and it shows up in the flow', () => {
  const ws = makeWorkspace();
  assert.equal(gluely(['stack', 'set', 'store', 'a', 'spreadsheet', '--json'], ws).json.tool, 'a spreadsheet');
  gluely(['stack', 'set', 'outreach', 'Some Tool Nobody Has Heard Of', '--json'], ws);
  const { stages } = gluely(['flow', '--json'], ws).json;
  assert.match(stages.find((s) => s.id === 'database').detail, /a spreadsheet/);
  assert.match(stages.find((s) => s.id === 'outbound').detail, /Some Tool Nobody Has Heard Of/);
  assert.equal(gluely(['doctor', '--json'], ws).json.stack.store, 'a spreadsheet');
  assert.equal(gluely(['stack', 'set', 'nonsense', 'x', '--json'], ws).json.error.code, 'bad_layer');
});

test('setting the stack keeps the comments in workspace.yaml', () => {
  const ws = makeWorkspace();
  gluely(['stack', 'set', 'crm', 'Attio', '--json'], ws);
  const text = fs.readFileSync(path.join(ws, 'workspace.yaml'), 'utf8');
  assert.match(text, /crm: Attio/);
  assert.match(text, /Your private GTM brain/);
});

test('core gives no vendor special treatment', () => {
  const core = ['brain-tests', 'context', 'doctor', 'flow', 'init', 'plays', 'skills', 'workspace']
    .map((f) => fs.readFileSync(path.join(ROOT, 'src', `${f}.js`), 'utf8')).join('');
  assert.doesNotMatch(core, /hubspot|salesforce|snowflake|supabase|instantly|apify/i);
});

test('flow never claims an unbuilt stage works, and marks outside tools', () => {
  const ws = makeWorkspace();
  const { stages } = gluely(['flow', '--json'], ws).json;
  const status = Object.fromEntries(stages.map((s) => [s.id, s.status]));
  assert.equal(status.database, 'later');
  assert.equal(status.bdr, 'later');
  assert.equal(status.outbound, 'tool');
  assert.equal(status.context, 'started');
  fillContext(ws);
  const after = gluely(['flow', '--json'], ws).json.stages.find((s) => s.id === 'context');
  assert.equal(after.status, 'working');
});

test('skills are complete and every playbook named by gtm-mode exists', () => {
  const skills = gluely(['skills', 'list', '--json'], ROOT).json.skills.map((s) => s.name);
  assert.ok(skills.includes('setup-gluely') && skills.includes('gtm-mode'));
  const mode = fs.readFileSync(path.join(ROOT, 'skills/gtm-mode/SKILL.md'), 'utf8');
  for (const [, file] of mode.matchAll(/`([a-z-]+\.md)`/g)) {
    assert.ok(fs.existsSync(path.join(ROOT, 'skills/gtm-mode/playbooks', file)), file);
  }
  for (const [, name] of mode.matchAll(/^- `([a-z-]+)`: /gm)) {
    assert.ok(skills.includes(`principle-${name}`), name);
  }
});
