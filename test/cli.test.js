import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import YAML from 'yaml';
import { parseArgs } from '../src/cli.js';
import { SIGNALS } from '../src/vocab.js';
import { normalizeDomain, parseCsv, readFrontmatter } from '../src/workspace.js';
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

function walk(ws, overrides = {}) {
  let state = gluely(['plays', 'start', 'job-switch', '--json'], ws).json;
  while (!state.done) {
    const result = gluely(['plays', 'answer', 'job-switch', state.step.id, { ...answers, ...overrides }[state.step.id], '--by', 'test/model', '--json'], ws);
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
  assert.match(inside.out, /\/setup-gluely/);
  assert.doesNotMatch(inside.out, /\/gtm-mode/);
  assert.match(gluely([], tempDir()).out, /gluely init/);
  assert.match(gluely(['--help'], ws).out, /gluely plays start/);
});

test('the next step puts a command on its own line, so nobody types the word run', () => {
  const ws = makeWorkspace();
  fillContext(ws);
  write(ws, 'tests/reply.yaml', '');
  const state = gluely(['--json'], ws).json;
  assert.equal(state.next.command, 'gluely plays start');
  const { out } = gluely([], ws);
  assert.match(out, /^ +\$ gluely plays start$/m);
  assert.doesNotMatch(out, /Run gluely/);
  assert.match(out, /With your agent/);
});

test('a waterfall is saved as a recipe, and each try is priced on what the last one missed', () => {
  const ws = makeWorkspace();
  fillContext(ws);
  walk(ws, { contact: 'Clay, Treg, Hunter' });
  const play = YAML.parse(fs.readFileSync(path.join(ws, 'plays/job-switch.yaml'), 'utf8'));
  assert.deepEqual(play.enrich.waterfall, { providers: ['Clay', 'Treg', 'Hunter'], stop_on: 'verified' });
  assert.equal(play.enrich.tool, 'Clay');
  assert.equal(gluely(['stack', '--json'], ws).json.layers.find((l) => l.id === 'enrichment').tool, 'Clay');
  assert.equal(gluely(['plays', 'validate', '--json'], ws).code, 0);

  const estimate = gluely(['cost', 'job-switch', '--json'], ws).json;
  const tries = estimate.lines.filter((l) => l.step === 'contact');
  assert.deepEqual(tries.map((t) => t.tool), ['Clay', 'Treg', 'Hunter']);
  assert.ok(Math.abs(tries[1].units[1] - tries[0].units[1] / 2) < 1e-9);
  assert.ok(Math.abs(tries[2].units[1] - tries[0].units[1] / 4) < 1e-9);
  assert.equal(estimate.waterfall, true);
  assert.ok(estimate.guessed.includes('hit_rate'));
  assert.equal(estimate.missing_prices.length, 5);

  gluely(['cost', 'job-switch', '--hit-rate', '80%', '--json'], ws);
  const sharper = gluely(['cost', 'job-switch', '--json'], ws).json.lines.find((l) => l.tool === 'Treg');
  assert.ok(Math.abs(sharper.units[1] - tries[0].units[1] * 0.2) < 1e-9);
  assert.equal(gluely(['plays', 'answer', 'job-switch', 'contact', 'Clay, Clay', '--json'], ws).code, 1);
});

test('one tool at a waterfall step stays a normal tool', () => {
  const ws = makeWorkspace();
  fillContext(ws);
  walk(ws);
  const play = YAML.parse(fs.readFileSync(path.join(ws, 'plays/job-switch.yaml'), 'utf8'));
  assert.equal(play.enrich.waterfall, undefined);
  assert.equal(gluely(['cost', 'job-switch', '--json'], ws).json.waterfall, false);
});

test('the cost check warns when money goes before the filter, or a kill rule is too slow', () => {
  const ws = makeWorkspace();
  fillContext(ws);
  walk(ws, { kill: '1' });
  priced(ws);
  const { warnings } = gluely(['cost', 'job-switch', '--json'], ws).json;
  const early = warnings.find((w) => w.code === 'spend_before_filter');
  assert.ok(early.share > 0.9);
  assert.ok(Math.abs(early.sample_cost - 0.5) < 1e-9);
  assert.ok(warnings.find((w) => w.code === 'kill_too_slow').months > 6);
  assert.match(gluely(['cost', 'job-switch'], ws).out, /before your ICP filter/);

  gluely(['plays', 'answer', 'job-switch', 'kill', '0', '--json'], ws);
  const play = YAML.parse(fs.readFileSync(path.join(ws, 'plays/job-switch.yaml'), 'utf8'));
  assert.deepEqual(play.kill, { after_days: 90, if: 'meetings == 0' });
  assert.equal(gluely(['plays', 'validate', '--json'], ws).code, 0);
  assert.equal(gluely(['cost', 'job-switch', '--json'], ws).json.warnings.some((w) => w.code === 'kill_too_slow'), false);
});

test('a kill rule still has to exist, whichever kind it is', () => {
  const ws = makeWorkspace();
  fillContext(ws);
  write(ws, 'plays/first-play.yaml', PLAY().replace(/kill:.*/, 'kill: { if: "meetings == 0" }'));
  const result = gluely(['plays', 'validate', '--json'], ws);
  assert.equal(result.code, 1);
  assert.match(result.out, /after_touches or after_days/);
});

test('Exa, Firecrawl and Treg are in the library, and nothing holds a price', () => {
  const text = fs.readFileSync(path.join(ROOT, 'library/tools.yaml'), 'utf8');
  assert.doesNotMatch(text, /[$€£]\d|price:/);
  const web = gluely(['tools', 'web-research', '--json'], ROOT).json.jobs[0].tools.map((t) => t.name);
  assert.deepEqual(web, ['Exa', 'Firecrawl', 'Treg']);
});

test('a blank or unclear price is refused, because an estimate must never look cheaper than it is', async () => {
  const ws = makeWorkspace();
  const { parsePrice } = await import('../src/cost.js');
  assert.equal(gluely(['cost', 'price', 'Clay', '--credit-price=', '--json'], ws).json.error.code, 'bad_price');
  assert.equal(gluely(['cost', 'price', 'Clay', '--job', 'contact-data', '--each=', '--json'], ws).json.error.code, 'bad_price');
  assert.equal(gluely(['cost', 'price', 'Clay', '--job', 'monthly', '--each', '1', '--json'], ws).json.error.code, 'bad_job');
  assert.deepEqual(parsePrice('0,02'), { each: 0.02 });
  assert.deepEqual(parsePrice('$0.02'), { each: 0.02 });
  assert.deepEqual(parsePrice('3 credits'), { credits: 3 });
  assert.deepEqual(parsePrice('free'), { each: 0 });
  for (const unclear of ['', '2 per 100', '10 credits per lookup', '-1', '1,000', 'soon']) assert.equal(parsePrice(unclear), null, unclear);
});

test('a stopped play can never spend, even with a matching approval', async () => {
  const ws = makeWorkspace();
  fillContext(ws);
  walk(ws);
  priced(ws);
  const { approveCost } = await import('../src/cost.js');
  approveCost(ws, 'job-switch', 'human');
  const file = path.join(ws, 'plays/job-switch.yaml');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('status: draft', 'status: killed'));
  const estimate = gluely(['cost', 'job-switch', '--json'], ws).json;
  assert.equal(estimate.status, 'play_stopped');
  assert.equal(estimate.can_spend, false);
  assert.throws(() => approveCost(ws, 'job-switch', 'human'), /stopped/);
});

test('a play with no budget shows the estimate instead of crashing', () => {
  const ws = makeWorkspace();
  fillContext(ws);
  walk(ws);
  const file = path.join(ws, 'plays/job-switch.yaml');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/ {2}monthly_limit: 150\n/, ''));
  priced(ws);
  const result = gluely(['cost', 'job-switch'], ws);
  assert.equal(result.err, '');
  assert.match(result.out, /no monthly budget/);
});

test('reading a cost leaves the play file exactly as it was', () => {
  const ws = makeWorkspace();
  fillContext(ws);
  walk(ws);
  const file = path.join(ws, 'plays/job-switch.yaml');
  const text = `# my note\n${fs.readFileSync(file, 'utf8')}`;
  fs.writeFileSync(file, text);
  gluely(['cost', 'job-switch', '--json'], ws);
  assert.equal(fs.readFileSync(file, 'utf8'), text);
});

test('personal data in an answer is refused before anything is saved, and redaction takes all of it', async () => {
  const ws = makeWorkspace();
  fillContext(ws);
  gluely(['plays', 'start', 'own-network', '--json'], ws);
  const refused = gluely(['plays', 'answer', 'own-network', 'excuse', 'Ask jane@acme.example for the intro', '--json'], ws);
  assert.equal(refused.json.error.code, 'personal_data');
  assert.doesNotMatch(fs.readFileSync(path.join(ws, 'plays/own-network.yaml'), 'utf8'), /jane/);
  const { redact } = await import('../src/log.js');
  assert.doesNotMatch(redact('see https://www.linkedin.com/in/jane-doe-1234 please'), /jane|linkedin/);
  assert.doesNotMatch(redact('ask jane@acme.co.uk today'), /jane|acme|uk/);
  const id = gluely(['log', 'add', '--kind', 'input', '--area', 'voice', '--text', 'A lesson', '--json'], ws).json.id;
  assert.equal(gluely(['log', 'drop', id, '--why', 'jane@acme.example said so', '--json'], ws).json.error.code, 'personal_data');
});

test('an edit promoted to a test stays in recall, and a dropped edit stops counting', () => {
  const ws = makeWorkspace();
  const edit = (before, after) => gluely(['log', 'add', '--kind', 'correction', '--area', 'voice', '--before', before, '--after', after, '--json'], ws).json.id;
  const first = edit('Quick note here', 'A note here');
  const second = edit('Quick idea here', 'An idea here');
  gluely(['log', 'promote', first, '--to', 'tests/voice.yaml', '--json'], ws);
  assert.equal(gluely(['recall', '--area', 'voice', '--json'], ws).json.lessons.length, 2);
  assert.equal(gluely(['learn', '--json'], ws).json.edits.keeps_removing[0].times, 2);
  gluely(['log', 'drop', second, '--why', 'One-off', '--json'], ws);
  assert.equal(gluely(['learn', '--json'], ws).json.edits.keeps_removing.length, 0);
  assert.equal(gluely(['log', '--limit', '0', '--json'], ws).json.entries.length, 0);
});

test('doctor points at the command that shows the real error', () => {
  const ws = makeWorkspace();
  fillContext(ws);
  write(ws, 'plays/broken.yaml', 'id: broken\nstatus: draft\n');
  const state = gluely(['doctor', '--json'], ws).json;
  assert.equal(state.next.command, 'gluely plays validate');
});

test('GLUELY_WORKSPACE works for the tools command and the home screen', () => {
  const ws = makeWorkspace();
  const env = { GLUELY_WORKSPACE: ws };
  const outside = tempDir();
  assert.equal(gluely(['tools', 'add', 'Foo', '--job', 'crm', '--json'], outside, env).code, 0);
  assert.equal(gluely(['--json'], outside, env).json.workspace, ws);
});

test('a corrupt play gives a clear error, not a stack trace', () => {
  const ws = makeWorkspace();
  fillContext(ws);
  gluely(['plays', 'start', 'job-switch', '--json'], ws);
  fs.writeFileSync(path.join(ws, 'plays/job-switch.yaml'), 'id: [unclosed\n');
  assert.equal(gluely(['plays', 'next', 'job-switch', '--json'], ws).json.error.code, 'bad_play');
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

const PROOF = (front) => `---\nid: faster-onboarding\nstatus: draft\nupdated: ${new Date().toISOString().slice(0, 10)}\n${front}\n---\n# Onboarding in a day\n\n**Claim:** Two customers went live in one day.\n`;

test('a claim is a hunch until its sources say otherwise', () => {
  const ws = makeWorkspace();
  fillContext(ws);
  write(ws, 'context/proof/faster-onboarding.md', PROOF(''));
  let result = gluely(['context', 'check', '--json'], ws);
  assert.equal(result.code, 0);
  assert.equal(result.json.summary.hunches, 1);
  assert.equal(result.json.files.find((f) => f.id === 'faster-onboarding').evidence, 'hunch');

  write(ws, 'context/proof/faster-onboarding.md', PROOF('evidence: repeated\nsources: [deal-2026-03]'));
  result = gluely(['context', 'check', '--json'], ws);
  assert.equal(result.code, 1);
  assert.match(JSON.stringify(result.json.issues), /two independent sources/);

  write(ws, 'context/proof/faster-onboarding.md', PROOF('evidence: measured\nsources: [onboarding report]'));
  assert.match(JSON.stringify(gluely(['context', 'check', '--json'], ws).json.issues), /metric/);

  write(ws, 'context/proof/faster-onboarding.md', PROOF('evidence: certain'));
  assert.match(JSON.stringify(gluely(['context', 'check', '--json'], ws).json.issues), /evidence must be one of/);

  write(ws, 'context/proof/faster-onboarding.md', PROOF('evidence: repeated\nsources: [deal-2026-03, call-2026-04]'));
  result = gluely(['context', 'check', '--json'], ws);
  assert.equal(result.code, 0);
  assert.equal(result.json.summary.hunches, 0);
});

test('an active play can only lean on proof that is repeated or measured', () => {
  const ws = makeWorkspace();
  fillContext(ws);
  write(ws, 'context/proof/faster-onboarding.md', PROOF(''));
  const play = (status) => PLAY().replace('excuse: { variants: [a] }', 'excuse: { variants: [a], proof: [faster-onboarding] }').replace('status: draft', `status: ${status}`);

  write(ws, 'plays/first-play.yaml', play('draft'));
  let result = gluely(['plays', 'validate', '--json'], ws);
  assert.equal(result.code, 0);
  assert.match(JSON.stringify(result.json.issues), /still a hunch/);

  write(ws, 'plays/first-play.yaml', play('active'));
  assert.equal(gluely(['plays', 'validate', '--json'], ws).code, 1);

  write(ws, 'context/proof/faster-onboarding.md', PROOF('evidence: repeated\nsources: [deal-2026-03, call-2026-04]'));
  assert.equal(gluely(['plays', 'validate', '--json'], ws).code, 0);

  write(ws, 'plays/first-play.yaml', play('active').replace('[faster-onboarding]', '[made-up]'));
  result = gluely(['plays', 'validate', '--json'], ws);
  assert.equal(result.code, 1);
  assert.match(JSON.stringify(result.json.issues), /made-up.*has no file/);
});

test('context warns about claims nobody has reviewed and dates that drift', () => {
  const ws = makeWorkspace();
  fillContext(ws);
  write(ws, 'context/proof/old-win.md', '---\nid: old-win\nstatus: confirmed\nupdated: 2020-01-01\n---\n# Old win\n\nWe doubled pipeline last quarter.\n');
  write(ws, 'context/messaging/note.md', '---\nid: note\nstatus: draft\n---\nSaw your post this week.\n');
  const result = gluely(['context', 'check', '--json'], ws);
  assert.equal(result.code, 0);
  const text = JSON.stringify(result.json.issues);
  assert.match(text, /old-win\.md.*not reviewed for \d+ days/);
  assert.match(text, /write the date instead of .*last quarter/);
  assert.doesNotMatch(text, /this week/);

  const cfg = path.join(ws, 'workspace.yaml');
  fs.writeFileSync(cfg, fs.readFileSync(cfg, 'utf8').replace('context: 180', 'context: 100000'));
  assert.doesNotMatch(JSON.stringify(gluely(['context', 'check', '--json'], ws).json.issues), /not reviewed/);
});

test('no opener breaks its own never list, and a new play dies on time, not on a touch count', () => {
  const ws = makeWorkspace();
  const { data } = readFrontmatter(path.join(ws, 'context/messaging/excuses.md'));
  for (const excuse of data.excuses) {
    for (const phrase of excuse.never) assert.ok(!excuse.pattern.toLowerCase().includes(phrase.toLowerCase()), `${excuse.signal} opener says "${phrase}"`);
  }
  assert.ok(data.excuses.find((e) => e.signal === 'signal.post_engagement').never.includes('your comment'));

  assert.deepEqual(YAML.parse(fs.readFileSync(path.join(ws, 'plays/_template.yaml'), 'utf8')).kill, { after_days: 90, if: 'meetings == 0' });
  fillContext(ws);
  gluely(['plays', 'start', 'post-engagers', '--json'], ws);
  assert.deepEqual(YAML.parse(fs.readFileSync(path.join(ws, 'plays/post-engagers.yaml'), 'utf8')).kill, { after_days: 90, if: 'meetings == 0' });
});

test('the guard keeps customers home, sends known people to their owner and clears only prospects', () => {
  const ws = makeWorkspace();
  fillContext(ws);
  write(ws, 'context/exclusions/companies.csv', 'domain,name,reason,owner\nacme-customer.example,"Northwind, Inc.",customer,\nformer.example,Former Co,churned,\nfund.example,Seed Fund,investor,dana\nrival.example,Rival,competitor,\n');
  write(ws, 'context/exclusions/people.csv', 'email,linkedin,name,reason,owner\nfriend@prospect.example,,Pat,close friend,sam\n,https://www.linkedin.com/in/known-person/,Kim,advisor,\n');
  write(ws, 'exports/list.csv', [
    'name,email,company,linkedin',
    'A,a@acme-customer.example,Northwind,',
    'B,b@northwind.co.uk,Northwind GmbH,',
    'C,c@former.example,Former Co,',
    'D,d@fund.example,Seed Fund,',
    'E,friend@prospect.example,Prospect,',
    'F,f@gmail.com,,linkedin.com/in/known-person',
    'G,g@rival.example,Rival,',
    'H,h@gmail.com,,',
    'I,i@prospect.example,Prospect,',
    'J,j@gmail.com,Fresh Startup,',
  ].join('\n') + '\n');

  const result = gluely(['guard', 'exports/list.csv', '--to', 'Any Enricher', '--json'], ws);
  assert.equal(result.code, 0, result.out);
  assert.deepEqual(result.json.counts, { clear: 2, owner: 2, held: 6 });
  assert.deepEqual(result.json.owners, ['dana', 'sam']);
  const reason = (line) => result.json.rows.find((r) => r.line === line).reason;
  assert.match(reason(2), /customer/);
  assert.match(reason(3), /shares a name/);
  assert.match(reason(4), /churned/);
  assert.match(reason(7), /no owner/);
  assert.match(reason(9), /cannot be checked/);
  assert.doesNotMatch(JSON.stringify(result.json), /a@acme-customer|friend@prospect/);

  const clear = fs.readFileSync(path.join(ws, result.json.files.clear), 'utf8');
  assert.match(clear, /i@prospect\.example/);
  assert.match(clear, /Fresh Startup/);
  assert.doesNotMatch(clear, /acme-customer|northwind|former|fund|friend@|rival/i);
  assert.match(fs.readFileSync(path.join(ws, result.json.files.owner), 'utf8'), /dana/);
  assert.match(gluely(['log', '--json'], ws).out, /Guard before Any Enricher: 2 clear, 2 to owners, 6 held/);
  assert.equal(gluely(['flow', '--json'], ws).json.stages.find((s) => s.id === 'gate').status, 'working');
});

test('the guard warns when it knows no customers, and refuses a list it cannot read', () => {
  const ws = makeWorkspace();
  write(ws, 'exports/list.csv', 'email\nsomeone@prospect.example\n');
  const result = gluely(['guard', 'exports/list.csv', '--json'], ws);
  assert.equal(result.json.counts.clear, 1);
  assert.match(result.json.warnings[0], /No customers/);
  write(ws, 'exports/odd.csv', 'favourite_colour\nblue\n');
  assert.equal(gluely(['guard', 'exports/odd.csv', '--json'], ws).json.error.code, 'unknown_columns');
});

test('results judge a play by the 50 and 100 rule, and ask about the inbox before the copy', () => {
  const ws = makeWorkspace();
  fillContext(ws);
  write(ws, 'plays/first-play.yaml', PLAY());
  const add = (...flags) => gluely(['results', 'add', 'first-play', ...flags, '--json'], ws);

  assert.equal(gluely(['results', 'first-play', '--json'], ws).json.verdict, 'no_results');
  assert.equal(add('--touches', '30', '--replies', '1').json.verdict, 'too_early');
  assert.equal(add('--positive', '3', '--replies', '1').json.error.code, 'bad_number');

  assert.equal(add('--touches', '30').json.verdict, 'kill');
  write(ws, 'learning/plays.jsonl', '');
  let judged = add('--touches', '60', '--replies', '2', '--positive', '1', '--spent', '30');
  assert.equal(judged.json.verdict, 'keep_going');
  assert.equal(judged.json.roi.per_positive, 30);
  const [low, high] = judged.json.rates.positive_could_be;
  assert.ok(low < 0.01 && high > 0.08);

  judged = add('--touches', '60', '--meetings', '0');
  assert.equal(judged.json.totals.touches, 120);
  assert.equal(judged.json.verdict, 'kill');
  assert.match(judged.json.why, /meeting_rate < 0.5%/);

  write(ws, 'learning/plays.jsonl', '');
  assert.equal(add('--touches', '274').json.verdict, 'check_deliverability');
  assert.equal(add('--touches', '0', '--spent', '1', '--placement', 'spam').json.verdict, 'fix_deliverability');
  assert.equal(add('--touches', '0', '--spent', '1', '--placement', 'inbox').json.verdict, 'kill');
  assert.equal(add('--touches', '1', '--placement', 'somewhere').json.error.code, 'usage');
});

test('a kill rule nobody can read never kills a play', async () => {
  const { evaluateRule } = await import('../src/results.js');
  assert.equal(evaluateRule('meeting_rate < 0.5% and positive_rate < 1%', { meeting_rate: 0.004, positive_rate: 0.005 }), true);
  assert.equal(evaluateRule('meetings == 0 or positive > 3', { meetings: 1, positive: 2 }), false);
  assert.equal(evaluateRule('vibes are off', { meetings: 0 }), null);
  assert.equal(evaluateRule('happiness < 2', { meetings: 0 }), null);
});

test('in B2C the guard checks people, not companies, and a work email never marks a whole company', () => {
  const dir = path.join(tempDir(), 'shop');
  assert.equal(gluely(['init', dir, '--company', 'Shop', '--market', 'b2c', '--motion', 'product_led', '--json'], tempDir()).code, 0);
  assert.equal(gluely(['init', path.join(tempDir(), 'x'), '--company', 'X', '--market', 'b2z', '--json'], tempDir()).json.error.code, 'bad_market');
  write(dir, 'exports/list.csv', 'email\nfan@gmail.com\nbuyer@gmail.com\nnew@bigcorp.example\n');

  let result = gluely(['guard', 'exports/list.csv', '--json'], dir);
  assert.equal(result.json.market, 'b2c');
  assert.equal(result.json.counts.held, 3);
  assert.match(result.json.warnings.join(' '), /--customers/);

  write(dir, 'exports/customers.csv', 'email\nbuyer@gmail.com\nsomeone@bigcorp.example\n');
  result = gluely(['guard', 'exports/list.csv', '--customers', 'exports/customers.csv', '--json'], dir);
  assert.deepEqual(result.json.counts, { clear: 2, owner: 0, held: 1 });
  assert.match(result.json.rows[0].reason, /a customer/);
  assert.deepEqual(result.json.warnings, []);
  assert.equal(gluely(['plays', 'start', 'product-lifecycle', '--json'], dir).json.step.job, 'product-data');
});

test('a waterfall is ordered by your own price per real find, never by the library', () => {
  const ws = makeWorkspace();
  gluely(['stack', 'set', 'enrichment', 'Zeta Data, Alpha Data, Mid Data'], ws);
  let plan = gluely(['waterfall', 'contact-data', '--json'], ws).json;
  assert.deepEqual(plan.order, ['Zeta Data', 'Alpha Data', 'Mid Data']);
  assert.equal(plan.per_person, null);
  assert.ok(plan.next.some((n) => /Price Zeta Data/.test(n)) && plan.next.some((n) => /Test Zeta Data/.test(n)));

  gluely(['cost', 'price', 'Zeta Data', '--job', 'contact-data', '--each', '0.05'], ws);
  gluely(['cost', 'price', 'Alpha Data', '--job', 'contact-data', '--credits', '2', '--credit-price', '0.02'], ws);
  gluely(['cost', 'price', 'Mid Data', '--job', 'contact-data', '--each', '0.04'], ws);
  const test = (tool, right, extra = []) => gluely(['waterfall', 'test', tool, '--job', 'contact-data', '--tried', '20', '--right', String(right), ...extra, '--json'], ws);
  test('Zeta Data', 18);
  test('Alpha Data', 8, ['--wrong', '6', '--unprovable', '4']);
  plan = test('Mid Data', 12).json;
  assert.deepEqual(plan.order, ['Zeta Data', 'Mid Data', 'Alpha Data']);
  assert.ok(Math.abs(plan.tools[0].cost_per_find - 0.05 / 0.9) < 1e-9);
  assert.ok(Math.abs(plan.per_person - (0.05 + 0.1 * 0.04 + 0.1 * 0.4 * 0.04)) < 1e-9);
  assert.deepEqual(plan.next, []);
  assert.match(plan.save, /Zeta Data, Mid Data, Alpha Data/);
  assert.ok(plan.rules.some((r) => /accept-all/.test(r)));

  assert.equal(test('Zeta Data', 30).json.error.code, 'bad_number');
  assert.equal(gluely(['waterfall', 'test', 'Zeta Data', '--job', 'vibes', '--tried', '20', '--right', '1', '--json'], ws).json.error.code, 'bad_job');
  assert.deepEqual(gluely(['waterfall', 'contact-data', '--tools', 'Other, Zeta Data', '--json'], ws).json.order, ['Zeta Data', 'Other']);
  assert.match(gluely(['log', '--json'], ws).out, /Zeta Data for contact-data: 18 right/);
});
