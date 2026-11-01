import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import YAML from 'yaml';
import { parseArgs } from '../src/cli.js';
import { SIGNALS } from '../src/vocab.js';
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
  const core = ['brain-tests', 'context', 'cost', 'doctor', 'flow', 'init', 'library', 'log', 'playbooks', 'plays', 'skills', 'ui', 'walk', 'workspace']
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

test('the landing page runs with nothing from outside the repo', () => {
  const html = fs.readFileSync(path.join(ROOT, 'site/index.html'), 'utf8');
  assert.doesNotMatch(html, /<script[^>]+src="(?!data\.js")|<link[^>]+stylesheet|fonts\.googleapis/);
  for (const [, font] of html.matchAll(/url\("(fonts\/[^"]+)"\)/g)) assert.ok(fs.existsSync(path.join(ROOT, 'site', font)), font);
  assert.match(html, /made-up numbers/);
});

const answers = {
  watchlist: 'Past champions', 'list-size': '412', data: 'Unlisted Data Co', map: 'LinkedIn URL',
  persona: 'head-of-sales', contact: 'Clay', excuse: 'We worked together at their last company',
  send: 'Unlisted Mailer', budget: '150', kill: '0',
};

function walk(ws) {
  let state = gluely(['plays', 'start', 'job-switch', '--json'], ws).json;
  while (!state.done) {
    const result = gluely(['plays', 'answer', 'job-switch', state.step.id, answers[state.step.id], '--by', 'test/model', '--json'], ws);
    assert.equal(result.code, 0, result.out);
    state = result.json.next;
  }
}

function priced(ws) {
  gluely(['cost', 'price', 'Unlisted Data Co', '--job', 'person-data', '--each', '0.01', '--json'], ws);
  gluely(['cost', 'price', 'Clay', '--job', 'contact-data', '--credits', '3', '--credit-price', '0.02', '--json'], ws);
  gluely(['cost', 'price', 'Unlisted Mailer', '--job', 'outreach', '--each', '0', '--json'], ws);
}

test('the library lists every tool by job, ranks nobody, and puts your own first', () => {
  const ws = makeWorkspace();
  const before = gluely(['tools', 'person-data', '--json'], ws).json.jobs[0].tools.map((t) => t.name);
  assert.ok(['Apollo', 'Apify', 'Clay'].every((name) => before.includes(name)));
  assert.deepEqual(before, [...before].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })));
  gluely(['tools', 'add', 'Our Warehouse', '--job', 'person-data', '--access', 'own-data'], ws);
  assert.equal(gluely(['tools', 'person-data', '--json'], ws).json.jobs[0].tools[0].name, 'Our Warehouse');
  assert.equal(gluely(['tools', 'add', 'x', '--job', 'nope'], ws).code, 1);
});

test('every playbook is complete: steps have questions, tools have jobs, costs point at real steps', () => {
  const { jobs } = gluely(['tools', '--json'], ROOT).json;
  const known = jobs.map((j) => j.job);
  const books = fs.readdirSync(path.join(ROOT, 'library/playbooks')).map((f) => YAML.parse(fs.readFileSync(path.join(ROOT, 'library/playbooks', f), 'utf8')));
  assert.ok(books.length >= 5);
  for (const book of books) {
    assert.ok(SIGNALS.includes(book.signal.type), book.id);
    const ids = book.steps.map((s) => s.id);
    for (const step of book.steps) {
      assert.ok(step.ask && step.why, `${book.id}/${step.id}`);
      if (step.type === 'tool') assert.ok(known.includes(step.job), `${book.id}/${step.id}`);
    }
    assert.ok(ids.includes('budget') && ids.includes('kill') && ids.includes(book.cost.volume), book.id);
    for (const line of book.cost.lines) assert.ok(ids.includes(line.step), `${book.id}/${line.step}`);
  }
});

test('a play walks one step at a time, accepts any tool, and comes out valid', () => {
  const ws = makeWorkspace();
  fillContext(ws);
  const first = gluely(['plays', 'start', 'job-switch', '--json'], ws).json;
  assert.equal(first.step.id, 'watchlist');
  assert.equal(gluely(['plays', 'answer', 'job-switch', 'list-size', 'lots', '--json'], ws).code, 1);
  const size = gluely(['plays', 'answer', 'job-switch', 'list-size', '412', '--json'], ws).json;
  assert.equal(size.estimate.low, 3.4);
  assert.match(size.estimate.warning, /Too few/);
  assert.equal(gluely(['plays', 'answer', 'job-switch', 'persona', 'nobody', '--json'], ws).code, 1);
  walk(ws);
  assert.equal(gluely(['stack', '--json'], ws).json.layers.find((l) => l.id === 'outreach').tool, 'Unlisted Mailer');
  const validated = gluely(['plays', 'validate', '--json'], ws);
  assert.equal(validated.code, 0, validated.out);
  const play = fs.readFileSync(path.join(ws, 'plays/job-switch.yaml'), 'utf8');
  assert.match(play, /tool: Unlisted Data Co/);
  assert.doesNotMatch(play, /\*a1/);
});

test('starting a playbook never overwrites a play that came from somewhere else', () => {
  const ws = makeWorkspace();
  gluely(['plays', 'new', 'job-switch'], ws);
  const result = gluely(['plays', 'start', 'job-switch', '--json'], ws);
  assert.equal(result.code, 1);
  assert.equal(result.json.error.code, 'play_exists');
});

test('an unknown price stays unknown, and is never counted as free', () => {
  const ws = makeWorkspace();
  fillContext(ws);
  walk(ws);
  gluely(['cost', 'price', 'Clay', '--job', 'contact-data', '--each', '0.5', '--json'], ws);
  const estimate = gluely(['cost', 'job-switch', '--json'], ws);
  assert.equal(estimate.code, 1);
  assert.equal(estimate.json.status, 'needs_prices');
  assert.equal(estimate.json.complete, false);
  assert.equal(estimate.json.can_spend, false);
  assert.equal(estimate.json.missing_prices.length, 2);
});

test('the cost check does the arithmetic and only a person can approve', () => {
  const ws = makeWorkspace();
  fillContext(ws);
  walk(ws);
  priced(ws);
  const estimate = gluely(['cost', 'job-switch', '--json'], ws).json;
  assert.equal(estimate.status, 'needs_approval');
  assert.equal(estimate.can_spend, false);
  assert.ok(Math.abs(estimate.lines[0].cost[0] - 4.12) < 1e-9);
  assert.ok(Math.abs(estimate.credits[0].monthly[1] - (412 * 0.2 / 12) * 0.3 * 3) < 1e-9);
  const denied = gluely(['cost', 'approve', 'job-switch'], ws);
  assert.equal(denied.code, 1);
  assert.match(denied.err, /Only a person/);
});

test('approval lapses when the estimate changes, and over budget stops the play', async () => {
  const ws = makeWorkspace();
  fillContext(ws);
  walk(ws);
  priced(ws);
  const { approveCost } = await import('../src/cost.js');
  assert.equal(approveCost(ws, 'job-switch', 'human').status, 'approved');
  assert.equal(gluely(['cost', 'job-switch', '--json'], ws).json.can_spend, true);

  gluely(['cost', 'job-switch', '--fit', '50%', '--json'], ws);
  assert.equal(gluely(['cost', 'job-switch', '--json'], ws).json.status, 'needs_approval');

  gluely(['cost', 'price', 'Unlisted Data Co', '--job', 'person-data', '--each', '1', '--by', 'test/model', '--json'], ws);
  const over = gluely(['cost', 'job-switch', '--json'], ws).json;
  assert.equal(over.status, 'over_budget');
  const changed = gluely(['log', '--area', 'cost', '--json'], ws).json.entries[0];
  assert.match(changed.text, /Unlisted Data Co/);
  assert.equal(changed.by, 'test/model');
  assert.throws(() => approveCost(ws, 'job-switch', 'human'), /over budget/);
});

test('the log keeps human input, carries the context version and refuses personal data', () => {
  const ws = makeWorkspace();
  const kept = gluely(['log', 'add', '--kind', 'input', '--area', 'voice', '--scope', 'can', '--text', 'No exclamation marks', '--json'], ws).json;
  assert.ok(kept.context_version);
  assert.equal(kept.source, 'human');
  gluely(['log', 'add', '--kind', 'input', '--area', 'voice', '--scope', 'sam', '--text', 'Sam likes long intros', '--json'], ws);
  gluely(['log', 'add', '--kind', 'input', '--area', 'voice', '--text', 'Sign off with the first name', '--json'], ws);
  const lessons = gluely(['recall', '--area', 'voice', '--scope', 'can', '--json'], ws).json.lessons.map((l) => l.text);
  assert.ok(lessons.includes('No exclamation marks') && lessons.includes('Sign off with the first name'));
  assert.ok(!lessons.includes('Sam likes long intros'));

  for (const text of ['Ask jane@acme.example', 'See linkedin.com/in/jane']) {
    const refused = gluely(['log', 'add', '--kind', 'input', '--area', 'voice', '--text', text, '--json'], ws);
    assert.equal(refused.json.error.code, 'personal_data');
  }
  assert.equal(gluely(['log', 'add', '--kind', 'input', '--area', 'nope', '--text', 'x', '--json'], ws).code, 1);
});

test('a play answer and a test correction both land in the log on their own', () => {
  const ws = makeWorkspace();
  fillContext(ws);
  walk(ws);
  const log = gluely(['log', '--limit', '100', '--json'], ws).json.entries;
  assert.equal(log.filter((e) => e.play === 'job-switch').length, 10);
  assert.equal(gluely(['recall', '--area', 'tool', '--json'], ws).json.lessons.length, 0);
  assert.equal(gluely(['recall', '--area', 'excuse', '--json'], ws).json.lessons[0].text, answers.excuse);

  gluely(['test', 'add', '--kind', 'reply', '--input', 'who else uses this', '--expect', 'question', '--why', 'ask jane@acme.example'], ws);
  const correction = gluely(['log', '--kind', 'correction', '--json'], ws).json.entries[0];
  assert.equal(correction.state, 'promoted');
  assert.equal(correction.to, 'tests/reply.yaml');
  assert.doesNotMatch(correction.why, /jane/);
});

test('promoting and dropping are new events, so the log only ever grows', () => {
  const ws = makeWorkspace();
  const add = (text) => gluely(['log', 'add', '--kind', 'input', '--area', 'voice', '--text', text, '--json'], ws).json.id;
  const one = add('First lesson');
  const two = add('Second lesson');
  const file = path.join(ws, 'learning/log.jsonl');
  const start = fs.readFileSync(file, 'utf8');

  assert.equal(gluely(['log', 'drop', two, '--json'], ws).code, 1);
  gluely(['log', 'drop', two, '--why', 'Only true for one client', '--json'], ws);
  gluely(['log', 'promote', one, '--to', 'context/messaging/voice.md', '--json'], ws);
  assert.equal(gluely(['log', 'promote', one, '--to', 'x', '--json'], ws).json.error.code, 'already_closed');

  assert.ok(fs.readFileSync(file, 'utf8').startsWith(start));
  const summary = gluely(['learn', '--json'], ws).json;
  assert.deepEqual([summary.open, summary.promoted, summary.dropped], [0, 1, 1]);
  assert.deepEqual(gluely(['recall', '--area', 'voice', '--json'], ws).json.lessons.map((l) => l.text), ['First lesson']);
});

test('gluely with no arguments is a home screen, and welcomes you outside a workspace', () => {
  const ws = makeWorkspace();
  const inside = gluely([], ws);
  assert.match(inside.out, /Gluely {2}Acme/);
  assert.match(inside.out, /Fill your context/);
  assert.match(gluely([], tempDir()).out, /gluely init/);
  assert.match(gluely(['--help'], ws).out, /gluely plays start/);
});

test('human screens refuse to run without a terminal instead of hanging', () => {
  const ws = makeWorkspace();
  const result = gluely(['plays', 'start'], ws);
  assert.equal(result.code, 1);
  assert.match(result.err, /Usage/);
});

test('the landing page shows exactly what is in the library', async () => {
  const { siteData } = await import('../scripts/site-data.mjs');
  assert.equal(fs.readFileSync(path.join(ROOT, 'site/data.js'), 'utf8'), siteData(), 'run node scripts/site-data.mjs');
});
