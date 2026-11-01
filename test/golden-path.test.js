// The drawing, walked for real. The loop must go around twice and the second round
// must use what the first round learned. Every phase extends this test.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { commit, fillContext, gluely, makeWorkspace, write } from './helpers.js';

const answer = (ws, id, value) => {
  const result = gluely(['test', 'submit', id, value, '--by', 'fake-agent/v1', '--json'], ws);
  assert.equal(result.code, 0, result.out);
};

test('golden path: a correction changes the context, and the next round proves it', () => {
  const ws = makeWorkspace();

  // Round one: a company fills its brain and writes a play.
  fillContext(ws);
  assert.equal(gluely(['context', 'check', '--json'], ws).code, 0);
  assert.equal(gluely(['plays', 'new', 'post-engagers', '--json'], ws).code, 0);
  write(ws, 'plays/post-engagers.yaml', `id: post-engagers
status: active
hypothesis: People who comment on our posts will take a meeting.
signal: { type: signal.post_engagement }
audience: { personas: [head-of-sales] }
excuse: { variants: [a] }
action: { channels: [email], tool: any }
success: { primary: meeting_booked }
kill: { after_touches: 100, if: "meeting_rate < 0.5%" }
`);
  assert.equal(gluely(['plays', 'validate', '--json'], ws).code, 0);

  // The founder rejects an agent's score, and that correction becomes a test.
  const input = 'Head of Sales at a 12-person agency that resells our category';
  const added = gluely(['test', 'add', '--kind', 'icp', '--input', input, '--expect', 'ignore', '--why', 'Agencies resell, they do not buy', '--json'], ws);
  assert.equal(added.code, 0, added.out);
  const id = added.json.id;
  commit(ws, 'First brain');
  const v1 = gluely(['context', 'version', '--json'], ws).json.version;

  // The brain asks. The agent gets it wrong, and the brain remembers.
  const asked = gluely(['test', 'pending', '--json'], ws).json.cases.map((c) => c.id);
  assert.ok(asked.includes(id));
  answer(ws, id, 'hot');
  answer(ws, 'reply-clear-yes', 'positive');
  answer(ws, 'reply-attack-hidden-instruction', 'negative');
  const first = gluely(['test', '--json'], ws).json;
  assert.deepEqual(first.reasoned.wrong.map((w) => [w.id, w.by]), [[id, 'fake-agent/v1']]);
  assert.equal(first.reasoned.correct, 2);

  // Round two: the human approves a context change, so a new version goes live.
  write(ws, 'context/icp.md', `---
id: icp
status: confirmed
---
# ICP
## Must have
- Sells B2B
## Disqualifiers
- Agencies reselling our category
## Scoring
Hot is 70 or more.
`);
  commit(ws, 'Learned: agencies are not buyers');
  const v2 = gluely(['context', 'version', '--json'], ws).json.version;
  assert.notEqual(v2, v1);

  // The same case is asked again under the new context, and the gain is measured.
  assert.ok(gluely(['test', 'pending', '--json'], ws).json.cases.some((c) => c.id === id));
  answer(ws, id, 'ignore');
  answer(ws, 'reply-clear-yes', 'positive');
  answer(ws, 'reply-attack-hidden-instruction', 'negative');
  const second = gluely(['test', '--json'], ws);
  assert.equal(second.code, 0, second.out);
  assert.deepEqual(second.json.reasoned.improved, [id]);
  assert.equal(second.json.reasoned.previous_version, v1);
  assert.deepEqual([second.json.reasoned.previous.correct, second.json.reasoned.correct], [2, 3]);

  // Round three: a change that makes the brain worse is caught.
  write(ws, 'context/company.md', '---\nid: company\nstatus: confirmed\n---\n# A worse company story\n');
  commit(ws, 'A change that hurts');
  answer(ws, 'reply-clear-yes', 'not_now');
  const third = gluely(['test', '--json'], ws);
  assert.equal(third.code, 1);
  assert.deepEqual(third.json.reasoned.regressions, ['reply-clear-yes']);
});
