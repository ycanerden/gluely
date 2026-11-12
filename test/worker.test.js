import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { commit, fillContext, gluely, makeWorkspace, tempDir, write } from './helpers.js';
import { cronMatches, dueBetween, parseCron, tick } from '../src/worker.js';

let server;
let base;
let flaky = 0;
const hooks = [];
before(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      if (req.url.startsWith('/hook')) { hooks.push(JSON.parse(body)); return res.end('ok'); }
      if (req.url.startsWith('/flaky') && flaky > 0) { flaky--; res.statusCode = 503; return res.end('down'); }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ email: 'x@found.example' }));
    });
  }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const PLAY = (extra = '') => `id: daily
status: draft
hypothesis: test
${extra}
workflow:
  steps:
    - { id: guard, type: guard }
    - id: email
      type: tool
      job: contact-data
      writes: email
      try: [{ tool: Free, request: { url: "${base}/flaky?d={{row.domain}}" }, pick: { email: email } }]
    - { id: line, type: agent, ask: Write one line, writes: opener }
`;

function workspace(extra) {
  const ws = makeWorkspace();
  fillContext(ws);
  write(ws, 'plays/daily.yaml', PLAY(extra));
  write(ws, 'exports/list.csv', 'company,domain\nAlpha,alpha.example\nBeta,beta.example\n');
  write(ws, '.env', `GLUELY_NOTIFY_URL=${base}/hook\n`);
  gluely(['cost', 'price', 'Free', '--job', 'contact-data', '--each', '0', '--json'], ws);
  return ws;
}

test('cron reads the usual forms', () => {
  const weekdays8 = parseCron('0 8 * * 1-5');
  assert.equal(cronMatches(weekdays8, new Date(2026, 10, 12, 8, 0)), true, 'a Thursday at 8:00');
  assert.equal(cronMatches(weekdays8, new Date(2026, 10, 14, 8, 0)), false, 'a Saturday');
  assert.equal(cronMatches(parseCron('*/15 * * * *'), new Date(2026, 0, 1, 3, 45)), true);
  assert.equal(parseCron('61 * * * *'), null);
  assert.equal(parseCron('every morning'), null);
  // Down from 7:00 to 10:00 on a weekday: it is due, once.
  assert.equal(dueBetween(weekdays8, new Date(2026, 10, 12, 7, 0), new Date(2026, 10, 12, 10, 0)), true);
  assert.equal(dueBetween(weekdays8, new Date(2026, 10, 12, 8, 0), new Date(2026, 10, 12, 10, 0)), false);
});

test('a schedule fires once when due, catches up once after downtime, and never fires a backlog', async () => {
  const ws = workspace('schedule: { cron: "0 8 * * *", input: exports/list.csv }');
  const day = (h, m = 0, d = 12) => new Date(2026, 10, d, h, m);
  let did = await tick(ws, { now: day(7) });
  assert.deepEqual(did.started, [], 'the first sight of a schedule only starts the clock');
  did = await tick(ws, { now: day(7, 30) });
  assert.deepEqual(did.started, []);
  did = await tick(ws, { now: day(9, 15) });
  assert.equal(did.started.length, 1, 'down over 8:00, so it catches up once');
  did = await tick(ws, { now: day(9, 16) });
  assert.deepEqual(did.started, []);
  did = await tick(ws, { now: day(8, 1, 15) });
  assert.equal(did.started.length, 1, 'three days down still means one run, not three');
});

test('an outage makes a run wait and try again instead of failing rows, and a person hears once', async () => {
  const ws = workspace();
  const { startRun, loadRun } = await import('../src/run.js');
  const run = startRun(ws, 'daily', { input: path.join(ws, 'exports/list.csv') });
  flaky = 2;
  hooks.length = 0;
  await tick(ws);
  let state = loadRun(ws, run.id);
  assert.equal(state.status, 'running');
  assert.ok(state.retry_at, 'it waits before trying again');
  assert.equal(state.spent, 0);
  assert.equal(state.rows.filter((r) => r.stopped).length, 0, 'no row was written off');

  await tick(ws);
  assert.equal(loadRun(ws, run.id).rows[0].data.email, undefined, 'it respects the wait');

  state.retry_at = new Date(Date.now() - 1000).toISOString();
  fs.writeFileSync(path.join(ws, 'runs', run.id, 'run.json'), JSON.stringify(state));
  await tick(ws);
  state = loadRun(ws, run.id);
  assert.equal(state.status, 'waiting_agent');
  assert.equal(state.rows[0].data.email, 'x@found.example');
  assert.equal(hooks.filter((h) => h.text.includes(run.id)).length, 1);
  assert.match(hooks.at(-1).text, /waits for your agent at line/);
  await tick(ws);
  assert.equal(hooks.filter((h) => h.text.includes(run.id)).length, 1, 'told once, not every tick');
});

test('the worker pulls new plays from git and keeps what it logged, without committing', async () => {
  const remote = path.join(tempDir(), 'brain.git');
  const ws = workspace();
  commit(ws, 'start');
  execFileSync('git', ['init', '--bare', '-q', remote]);
  execFileSync('git', ['-C', ws, 'remote', 'add', 'origin', remote]);
  execFileSync('git', ['-C', ws, 'push', '-q', 'origin', 'HEAD:main']);
  execFileSync('git', ['-C', ws, 'branch', '-q', '--set-upstream-to=origin/main']);
  const box = path.join(tempDir(), 'box');
  execFileSync('git', ['clone', '-q', '-b', 'main', remote, box]);

  fs.appendFileSync(path.join(box, 'learning', 'log.jsonl'), '{"id":"log-box","kind":"result","area":"play","text":"from the box"}\n');
  const laptop = path.join(tempDir(), 'laptop');
  execFileSync('git', ['clone', '-q', '-b', 'main', remote, laptop]);
  write(laptop, 'plays/second.yaml', 'id: second\nstatus: draft\nhypothesis: new\n');
  commit(laptop, 'a new play');
  execFileSync('git', ['-C', laptop, 'push', '-q', 'origin', 'HEAD:main']);

  const headBefore = execFileSync('git', ['-C', box, 'rev-list', '--count', 'HEAD']).toString().trim();
  const did = await tick(box, { doPull: true });
  assert.equal(did.pulled, true);
  assert.ok(fs.existsSync(path.join(box, 'plays', 'second.yaml')));
  assert.match(fs.readFileSync(path.join(box, 'learning', 'log.jsonl'), 'utf8'), /from the box/);
  assert.equal(Number(execFileSync('git', ['-C', box, 'rev-list', '--count', 'HEAD']).toString().trim()), Number(headBefore) + 1, 'only the pulled commit: the box made none');
});
