import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import { fillContext, makeWorkspace, write } from './helpers.js';

const get = (port, path, host = `localhost:${port}`, method = 'GET') => new Promise((resolve) => {
  const req = http.request({ port, path, method, headers: { host } }, (res) => { let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ code: res.statusCode, body: b })); });
  req.end();
});

test('the studio shows plays and workflows, never key values, only to this machine, and changes nothing', async () => {
  const ws = makeWorkspace();
  fillContext(ws);
  write(ws, 'plays/outbound.yaml', `id: outbound
status: draft
hypothesis: Teams that just hired will reply.
workflow:
  steps:
    - { id: guard, type: guard }
    - id: email
      type: tool
      job: contact-data
      try: [{ tool: First, request: { url: "https://api.first.example/find?d={{row.domain}}", headers: { authorization: "{{env.FIRST_KEY}}" } } }]
`);
  write(ws, '.env', 'FIRST_KEY=never-shown-123\n');
  const { startStudio } = await import('../src/studio.js');
  const { server } = await startStudio(ws, { port: 0 });
  const port = server.address().port;
  try {
    const state = await get(port, '/api/state');
    assert.equal(state.code, 200);
    const data = JSON.parse(state.body);
    const play = data.plays.find((p) => p.id === 'outbound');
    assert.equal(play.steps[1].try[0].host, 'api.first.example');
    assert.deepEqual(play.steps[1].keys, [{ name: 'FIRST_KEY', set: true }]);
    assert.equal(state.body.includes('never-shown-123'), false);
    assert.equal(state.body.includes('{{env.FIRST_KEY}}'), false, 'requests show where they go, not what they carry');
    assert.equal((await get(port, '/api/state', 'evil.example')).code, 403);
    assert.equal((await get(port, '/api/state', undefined, 'POST')).code, 405);
    assert.match((await get(port, '/')).body, /Gluely Studio/);
  } finally {
    server.close();
  }
});

test('the table puts each column under the step that filled it, and says what is still to come', async () => {
  const { runTable } = await import('../src/studio.js');
  const run = {
    step: 3,
    status: 'waiting_agent',
    workflow: [
      { id: 'guard', type: 'guard' },
      { id: 'email', type: 'tool', job: 'contact-data', writes: 'email', try: [{ tool: 'A', pick: { email: 'e', score: 's' } }] },
      { id: 'q', type: 'set', values: { question: 'x' } },
      { id: 'fit', type: 'agent', ask: 'fit?', writes: 'fit' },
      { id: 'review', type: 'approve' },
    ],
    rows: [
      { n: 1, data: { company: 'Alpha', email: 'a@alpha.example', score: 90, question: 'x', fit: 'yes' }, answers: { fit: 'yes' }, route: {}, stopped: null },
      { n: 2, data: { company: 'Beta', question: 'x' }, answers: {}, route: {}, stopped: null },
      { n: 3, data: { company: 'Client' }, answers: {}, route: {}, stopped: { step: 'guard', reason: 'client' } },
    ],
  };
  const t = runTable(run);
  assert.deepEqual(t.groups.map((g) => [g.step, g.columns]), [[null, ['company']], ['guard', []], ['email', ['email', 'score']], ['q', ['question']], ['fit', ['fit']], ['review', []]]);
  const [one, two, three] = t.rows.map((r) => r.state);
  assert.equal(one.fit, 'done', 'an answered row shows its answer');
  assert.equal(two.fit, 'waiting');
  assert.equal(two.review, 'to_come');
  assert.equal(three.guard, 'stopped_here');
  assert.equal(three.email, 'never');
});
