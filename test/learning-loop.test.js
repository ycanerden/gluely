// The closing half of the loop: verdicts, history, honest comparisons and the weekly retro.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { commit, fillContext, gluely, makeWorkspace, write } from './helpers.js';

const play = (id, { status = 'active', variants = 'a', signal = 'post_engagement', extra = '' } = {}) => `id: ${id}
status: ${status}
# the founder's note survives every status change
hypothesis: People with this signal will take a meeting.
signal: { type: signal.${signal} }
audience: { personas: [head-of-sales] }
excuse: { variants: [${variants}] }
action: { channels: [email], tool: any }
success: { primary: meeting_booked }
kill: { after_touches: 200, if: "meeting_rate < 0.5%" }
${extra}`;

function brain() {
  const ws = makeWorkspace();
  fillContext(ws);
  write(ws, 'context/messaging/excuses.md', '---\nid: excuses\nstatus: draft\nexcuses:\n  - { signal: signal.post_engagement, angle: their comment }\n  - { signal: signal.job_switch, angle: the new role }\n  - { signal: signal.hiring, angle: the hire }\n---\n# Excuses\n');
  return ws;
}

const run = (ws, ...args) => gluely([...args, '--json'], ws);
const add = (ws, id, ...flags) => {
  const result = run(ws, 'results', 'add', id, ...flags);
  assert.equal(result.code, 0, result.out);
  return result.json;
};
const snapshot = (ws) => Object.fromEntries(['learning/log.jsonl', 'learning/plays.jsonl', 'tests/results.jsonl', 'plays/winner.yaml']
  .filter((f) => fs.existsSync(path.join(ws, f))).map((f) => [f, fs.readFileSync(path.join(ws, f), 'utf8')]));

test('a variant must exist in the play, and each one is counted on its own', () => {
  const ws = brain();
  write(ws, 'plays/winner.yaml', play('winner', { variants: 'a, b' }));
  assert.equal(run(ws, 'results', 'add', 'winner', '--touches', '10', '--variant', 'c').json.error.code, 'unknown_variant');
  add(ws, 'winner', '--touches', '60', '--positive', '1', '--replies', '1', '--variant', 'a');
  const judged = add(ws, 'winner', '--touches', '60', '--positive', '9', '--replies', '9', '--variant', 'b', '--unsubscribes', '2');
  assert.deepEqual(judged.variants.map((v) => [v.variant, v.totals.touches, v.totals.positive]), [['a', 60, 1], ['b', 60, 9]]);
  assert.equal(judged.totals.unsubscribes, 2);
  assert.equal(run(ws, 'results', 'add', 'winner', '--touches', '5', '--unsubscribes', '6').json.error.code, 'bad_number');
});

test('better means the ranges do not overlap, and under 50 touches nothing is called', async () => {
  const { versus } = await import('../src/results.js');
  assert.equal(versus(3, 30, 20, 500).call, 'too_early');
  assert.equal(versus(12, 100, 20, 500).call, 'better');
  assert.equal(versus(10, 100, 20, 500).call, 'unclear', '5.5% to 17.4% still touches 2.6% to 6.1%');
  assert.equal(versus(6, 100, 20, 500).call, 'unclear');
  assert.equal(versus(0, 200, 40, 500).call, 'worse');
  assert.equal(versus(20, 200, 1, 500, { lowerIsBetter: true }).call, 'worse');
});

test('a verdict needs a reason, keeps its numbers, sets the status and leaves the comments', () => {
  const ws = brain();
  write(ws, 'plays/winner.yaml', play('winner'));
  write(ws, 'plays/idea.yaml', play('idea', { status: 'draft' }));
  add(ws, 'winner', '--touches', '80', '--replies', '2', '--positive', '0');
  const code = (...a) => run(ws, 'plays', 'close', ...a).json.error?.code;
  assert.equal(code('winner', '--verdict', 'killed'), 'needs_why');
  assert.equal(code('winner', '--verdict', 'dead', '--why', 'x'), 'bad_verdict');
  assert.equal(code('idea', '--verdict', 'killed', '--why', 'x'), 'not_run');
  assert.equal(code('winner', '--verdict', 'killed', '--why', 'Mail me at a@b.example'), 'personal_data');

  const closed = run(ws, 'plays', 'close', 'winner', '--verdict', 'killed', '--why', 'Commenters are fans, not buyers', '--by', 'can').json;
  assert.deepEqual([closed.status, closed.was, closed.suggested], ['killed', 'active', 'kill']);
  assert.equal(closed.snapshot.totals.touches, 80);
  const file = fs.readFileSync(path.join(ws, 'plays/winner.yaml'), 'utf8');
  assert.match(file, /^status: killed$/m);
  assert.match(file, /the founder's note survives/);
  assert.equal(code('winner', '--verdict', 'kept', '--why', 'again'), 'already_killed');

  // A verdict is a decision with a home, never an open lesson.
  assert.equal(run(ws, 'learn').json.open, 0);
  const history = run(ws, 'plays', 'history').json;
  const row = history.plays.find((p) => p.id === 'winner');
  assert.equal(history.counts.killed, 1);
  assert.deepEqual([row.status, row.last_verdict.verdict, row.last_verdict.why, row.last_verdict.by], ['killed', 'killed', 'Commenters are fans, not buyers', 'can']);
  assert.equal(history.plays.at(-1).id, 'winner', 'killed plays come last');
});

test('a regression is caught against any committed version, and a change is unproven until re-answered', () => {
  const ws = makeWorkspace();
  const answer = (id, value) => assert.equal(run(ws, 'test', 'submit', id, value, '--by', 'fake/v1').code, 0);
  const change = (text) => { write(ws, 'context/company.md', `---\nid: company\nstatus: draft\n---\n# ${text}\n`); commit(ws, text); };

  answer('reply-clear-yes', 'positive');
  change('Second');
  const unproven = run(ws, 'test');
  assert.equal(unproven.code, 1);
  assert.deepEqual(unproven.json.reasoned.unproven, ['reply-clear-yes']);

  answer('reply-clear-yes', 'not_now');
  change('Third');
  answer('reply-clear-yes', 'not_now');
  // The previous version was already wrong, so only "any committed version" can catch this.
  const caught = run(ws, 'test').json.reasoned;
  assert.deepEqual(caught.regressions, ['reply-clear-yes']);
  assert.equal(caught.regression_details[0].answered, 'not_now');
  assert.notEqual(caught.regression_details[0].was_right_under, caught.previous_version);
});

test('the retro makes one decision per play, folds in variants, and writes nothing', () => {
  const ws = brain();
  write(ws, 'plays/winner.yaml', play('winner', { signal: 'job_switch', variants: 'a, b' }));
  write(ws, 'plays/loser.yaml', play('loser'));
  write(ws, 'plays/young.yaml', play('young', { signal: 'hiring' }));
  commit(ws, 'Plays');
  add(ws, 'winner', '--touches', '120', '--replies', '4', '--positive', '2', '--meetings', '1', '--variant', 'a');
  add(ws, 'winner', '--touches', '120', '--replies', '16', '--positive', '14', '--meetings', '5', '--variant', 'b');
  add(ws, 'loser', '--touches', '250', '--replies', '20', '--positive', '1', '--unsubscribes', '15', '--placement', 'inbox');
  add(ws, 'young', '--touches', '20', '--replies', '1', '--positive', '1');
  const before = snapshot(ws);

  const retro = run(ws, 'retro');
  assert.equal(retro.code, 0, retro.out);
  const data = retro.json;
  const about = (id) => data.for_you.filter((p) => p.play === id);
  assert.equal(about('winner').length, 1, 'one decision per play');
  assert.equal(about('loser').length, 1);
  const [winner] = about('winner');
  assert.equal(winner.kind, 'record_verdict');
  assert.deepEqual(winner.actions.map((a) => a.needs), ['a person', 'approve_spend', 'approve_copy']);
  assert.match(winner.actions[2].do, /variant b instead of a/);
  assert.match(about('loser')[0].title, /kill/);
  assert.match(about('loser')[0].why, /unsubscribe/);
  assert.deepEqual(data.collecting.map((c) => [c.play, c.needs]), [['young', 30]]);
  assert.deepEqual(data.for_you.map((p) => p.number), data.for_you.map((_, i) => i + 1));
  assert.deepEqual(data.week.touches, 510);
  assert.deepEqual(snapshot(ws), before, 'the retro only reads');

  // Once a person decides, the same numbers are not raised again.
  run(ws, 'plays', 'close', 'winner', '--verdict', 'kept', '--why', 'Variant b names the first 90 days');
  run(ws, 'plays', 'close', 'loser', '--verdict', 'killed', '--why', 'Fans, not buyers');
  const after = run(ws, 'retro').json;
  assert.equal(after.for_you.filter((p) => p.play).length, 0);
  assert.deepEqual(after.brain.verdicts_this_week.map((v) => v.play), ['winner', 'loser']);
  // New numbers bring the play back.
  add(ws, 'winner', '--touches', '50', '--positive', '5', '--replies', '5', '--variant', 'b');
  assert.equal(run(ws, 'retro').json.for_you.filter((p) => p.play === 'winner').length, 1);
});

test('the retro caps context changes at three a week and never repeats the same edits', () => {
  const ws = brain();
  const edit = (before, after, area = 'voice') => run(ws, 'log', 'add', '--kind', 'correction', '--area', area, '--before', before, '--after', after, '--why', 'too salesy');
  edit('Quick note on hiring', 'A note on hiring');
  edit('Quick question on pricing', 'One question on pricing');
  edit('Super excited to share', 'Sharing');
  edit('Super keen to hear', 'Keen to hear');
  for (const text of ['Agencies resell', 'Under 10 people is too small', 'Founders buy here']) run(ws, 'log', 'add', '--kind', 'input', '--area', 'icp', '--text', text);
  for (const text of ['Price comes up first', 'Security asks for SOC 2']) run(ws, 'log', 'add', '--kind', 'input', '--area', 'objection', '--text', text);
  const data = run(ws, 'retro').json;
  const changes = data.for_you.filter((p) => p.changes_context);
  assert.equal(changes.length, 3);
  assert.deepEqual(changes.slice(0, 2).map((p) => p.kind), ['ban_word', 'ban_word']);
  assert.ok(!changes.some((p) => p.kind === 'write_lessons' && p.target === 'context/messaging/voice.md'), 'edits behind a banned word are not proposed twice');
  assert.equal(data.held_back.length, 1);
  assert.equal(run(ws, 'retro', '--days', '0').json.error.code, 'bad_number');
});

test('agents reach the retro, the history and verdicts over MCP, and still cannot approve spend', async () => {
  const { toolList } = await import('../src/mcp.js');
  const names = toolList().map((t) => t.name);
  for (const name of ['gluely_retro', 'gluely_plays_history', 'gluely_play_close']) assert.ok(names.includes(name), name);
  assert.equal(toolList().find((t) => t.name === 'gluely_retro').annotations.readOnlyHint, true);
  assert.ok(!names.some((n) => n.includes('approve')));
});

test('doctor points at the retro once a play has results', () => {
  const ws = brain();
  write(ws, 'plays/winner.yaml', play('winner'));
  for (const c of run(ws, 'test', 'pending').json.cases) run(ws, 'test', 'submit', c.id, c.allowed_answers[0], '--by', 'fake/v1');
  add(ws, 'winner', '--touches', '10', '--positive', '1', '--replies', '1');
  assert.equal(run(ws, 'doctor').json.next.command, 'gluely retro');
});
