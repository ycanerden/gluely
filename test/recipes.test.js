import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fillContext, gluely, makeWorkspace, ROOT, write } from './helpers.js';

// A stand-in research API: it answers every question, but only cites a page for some.
const SERVER = `
const http = require('node:http');
http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    const q = JSON.parse(body || '{}').query || '';
    if (req.url === '/answer') return res.end(JSON.stringify(q.includes('Nocite') ? { answer: 'yes' } : { answer: 'yes', citations: [{ url: 'https://trust.example/soc2' }] }));
    if (req.url === '/backup') return res.end(JSON.stringify({ answer: 'no', results: [{ url: 'https://backup.example/page' }] }));
    res.statusCode = 404; res.end('{}');
  });
}).listen(0, '127.0.0.1', function () { console.log(this.address().port); });`;

let server;
let base;
before(async () => {
  server = spawn('node', ['-e', SERVER], { stdio: ['ignore', 'pipe', 'inherit'] });
  const port = await new Promise((resolve) => server.stdout.once('data', (d) => resolve(String(d).trim())));
  base = `http://127.0.0.1:${port}`;
});
after(() => server.kill());

const run = (args, cwd) => new Promise((resolve) => {
  const child = spawn('node', [path.join(ROOT, 'bin', 'gluely.js'), ...args], { cwd, env: { ...process.env, NO_COLOR: '1' } });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.on('close', (code) => { let json = null; try { json = JSON.parse(out); } catch { /* text */ } resolve({ code, out, json }); });
});

test('the library recipes are complete, alphabetical, and hold no prices', () => {
  const ws = makeWorkspace();
  const list = gluely(['recipes', '--json'], ws).json;
  assert.ok(list.recipes.length >= 4);
  for (const r of list.recipes) assert.deepEqual(r.issues, [], `${r.id}: ${r.issues.join('; ')}`);
  const ids = list.recipes.map((r) => r.id);
  assert.deepEqual(ids, [...ids].sort());
  const shown = gluely(['recipes', 'show', 'hunter-find-email', '--json'], ws).json;
  assert.deepEqual(shown.reads.sort(), ['domain', 'first_name', 'last_name']);
  assert.deepEqual(shown.keys, ['HUNTER_KEY']);
  assert.equal(JSON.stringify(list).match(/price|cost|\$/i), null, 'recipes never carry a price');
  assert.equal(gluely(['recipes', '--job', 'email-verify', '--json'], ws).json.recipes.every((r) => r.job === 'email-verify'), true);
});

function setup() {
  const ws = makeWorkspace();
  fillContext(ws);
  write(ws, 'recipes/test-answer.yaml', `tool: Exa
job: web-research
what: test
docs: https://docs.example/answer
request: { method: POST, url: "${base}/answer", headers: { x-api-key: "{{env.EXA_KEY}}" }, body: { query: "{{row.question}}" } }
pick: { answer: answer, answer_source: citations.0.url }
writes: answer
source: answer_source
`);
  write(ws, 'recipes/test-backup.yaml', `tool: Tavily
job: web-research
what: test
docs: https://docs.example/backup
request: { method: POST, url: "${base}/backup", body: { query: "{{row.question}}" } }
pick: { answer: answer, answer_source: results.0.url }
writes: answer
source: answer_source
`);
  write(ws, '.env', 'EXA_KEY=k-123\n');
  write(ws, 'plays/research.yaml', `id: research
status: draft
hypothesis: Teams with SOC 2 buy faster.
budget: { monthly_limit: 5 }
workflow:
  steps:
    - { id: guard, type: guard }
    - { id: q, type: set, values: { question: "Does {{row.company}} have SOC 2?" } }
    - { id: soc2, type: tool, try: [{ recipe: test-answer }, { recipe: test-backup }] }
    - { id: fit, type: agent, ask: "Is this a fit? Answer yes or no.", writes: fit }
`);
  write(ws, 'list.csv', 'company,domain\nAlpha,alpha.example\nNocite,nocite.example\nGamma,gamma.example\n');
  gluely(['cost', 'price', 'Exa', '--job', 'web-research', '--each', '0.01', '--json'], ws);
  gluely(['cost', 'price', 'Tavily', '--job', 'web-research', '--each', '0.01', '--json'], ws);
  return ws;
}

test('a recipe fills a workflow try, and an answer with no source never counts as found', async () => {
  const ws = setup();
  const plan = gluely(['run', 'research', '--input', 'list.csv', '--plan', '--json'], ws);
  assert.equal(plan.json.status, 'needs_approval', plan.out);
  assert.deepEqual(plan.json.lines.map((l) => l.tool), ['Exa', 'Tavily'], 'the job and tools come from the recipes');
  const started = await run(['run', 'research', '--input', 'list.csv', '--json'], ws);
  const { approveRun, loadRun, readEvents } = await import('../src/run.js');
  approveRun(ws, started.json.id, { by: 'human' });
  const after = await run(['runs', 'continue', started.json.id, '--json'], ws);
  assert.equal(after.json.status, 'waiting_agent');

  const rows = Object.fromEntries(loadRun(ws, started.json.id).rows.map((r) => [r.data.company, r.data]));
  assert.equal(rows.Alpha.answer, 'yes');
  assert.equal(rows.Alpha.answer_source, 'https://trust.example/soc2');
  assert.equal(rows.Nocite.answer, 'no', 'the unsourced yes was dropped, so the next tool got a go');
  assert.equal(rows.Nocite.answer_source, 'https://backup.example/page');
  const events = readEvents(ws, started.json.id);
  assert.ok(events.some((e) => e.status === 'no_source' && e.tool === 'Exa'));
  assert.equal(events.filter((e) => e.tool === 'Tavily').length, 1, 'only the unsourced row went to the second tool');
});

test('an agent answers a whole batch at once, and one bad row never loses the good ones', async () => {
  const ws = setup();
  const started = await run(['run', 'research', '--input', 'list.csv', '--json'], ws);
  const id = started.json.id;
  const { approveRun } = await import('../src/run.js');
  approveRun(ws, id, { by: 'human' });
  await run(['runs', 'continue', id, '--json'], ws);

  const next = gluely(['runs', 'next', id, '--limit', '25', '--json'], ws).json;
  assert.equal(next.tasks.length, 3);
  const answers = JSON.stringify([{ row: 1, text: 'yes' }, { row: 2, skip: true, why: 'no proof' }, { row: 99, text: 'yes' }, { row: 3, text: '' }]);
  const first = gluely(['runs', 'answer', id, '--answers', answers, '--json'], ws).json;
  assert.deepEqual(first.answered.map((a) => a.row), [1, 2]);
  assert.deepEqual(first.failed.map((f) => f.code), ['unknown_row', 'usage']);
  assert.equal(first.left, 1);
  const again = gluely(['runs', 'answer', id, '--answers', JSON.stringify([{ row: 1, text: 'no' }, { row: 3, text: 'no' }]), '--json'], ws).json;
  assert.deepEqual(again.failed.map((f) => f.code), ['answered'], 'an answer is never overwritten');
  assert.equal(again.left, 0);
  assert.equal(gluely(['runs', 'answer', id, '--answers', 'not json', '--json'], ws).json.error.code, 'bad_answers');

  const { callTool } = await import('../src/mcp.js');
  assert.ok(callTool, 'the MCP server exposes the same command');
});

test('a workflow naming a recipe that does not exist is refused before it runs', () => {
  const ws = setup();
  write(ws, 'plays/research.yaml', `id: research
status: draft
workflow:
  steps:
    - { id: guard, type: guard }
    - { id: email, type: tool, job: contact-data, writes: email, try: [{ recipe: nobody-has-this }] }
`);
  const plan = gluely(['run', 'research', '--input', 'list.csv', '--plan', '--json'], ws).json;
  assert.equal(plan.status, 'invalid');
  assert.match(plan.issues[0].message, /no recipe "nobody-has-this"/);
});
