import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fillContext, gluely, makeWorkspace, ROOT, write } from './helpers.js';

// A stand-in for outside tools, in its own process because the CLI runs synchronously.
const SERVER = `
const http = require('node:http');
const calls = [];
http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const url = new URL(req.url, 'http://x');
    calls.push({ path: url.pathname, q: url.searchParams.get('q'), raw: req.url, auth: req.headers.authorization || null, body });
    res.setHeader('content-type', 'application/json');
    if (url.pathname === '/calls') return res.end(JSON.stringify(calls));
    if (url.pathname === '/first') {
      const q = url.searchParams.get('q');
      return res.end(JSON.stringify(q === 'Beta' ? { results: [] } : { results: [{ email: q.toLowerCase().replace(/[^a-z]/g, '') + '@first.example' }] }));
    }
    if (url.pathname === '/second') return res.end(JSON.stringify({ person: { email: 'found@second.example' } }));
    if (url.pathname === '/fail') { res.statusCode = 401; return res.end('bad key ' + (req.headers.authorization || '')); }
    if (url.pathname === '/send') return res.end(JSON.stringify({ queued: true }));
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

const calls = async () => (await fetch(`${base}/calls`)).json();

// gluely() blocks, which would freeze the fake server's replies if it lived in this process.
const run = (args, cwd) => new Promise((resolve) => {
  const child = spawn('node', [path.join(ROOT, 'bin', 'gluely.js'), ...args], { cwd, env: { ...process.env, NO_COLOR: '1' } });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.on('close', (code) => { let json = null; try { json = JSON.parse(out); } catch { /* text */ } resolve({ code, out, json }); });
});

const PLAY = (workflow, extra = '') => `id: outbound
status: draft
hypothesis: Teams that just hired will reply.
signal: { type: signal.hiring }
audience: { personas: [head-of-sales] }
excuse: { variants: [a] }
action: { channels: [linkedin_message], tool: any }
success: { primary: positive_reply }
kill: { after_days: 60, if: "positive_rate == 0" }
${extra}
workflow:
${workflow}`;

const FULL = () => `  steps:
    - { id: guard, type: guard }
    - { id: fit, type: filter, if: "employees >= 10" }
    - id: email
      type: tool
      job: contact-data
      writes: email
      try:
        - tool: First
          request: { url: "${base}/first?q={{row.company}}", headers: { authorization: "Bearer {{env.FIRST_KEY}}" } }
          pick: { email: results.0.email }
        - tool: Second
          request: { method: POST, url: "${base}/second", body: { company: "{{row.company}}" } }
          pick: { email: person.email }
    - id: opener
      type: agent
      ask: Write one honest first line about their hiring.
      writes: opener
      check: linkedin_message
    - { id: review, type: approve }
    - id: send
      type: tool
      job: outreach
      try:
        - tool: Sender
          request: { method: POST, url: "${base}/send", body: { to: "{{row.email}}", text: "{{row.opener}}" } }`;

const LIST = 'company,domain,employees\nAlpha,alpha.example,50\nBeta,beta.example,40\nTiny,tiny.example,3\nClient,client.example,90\nGam/../ma?x=1,gamma.example,20\n';

function setup({ budget = 'budget: { monthly_limit: 5 }', key = true } = {}) {
  const ws = makeWorkspace();
  fillContext(ws);
  write(ws, 'plays/outbound.yaml', PLAY(FULL(), budget));
  write(ws, 'list.csv', LIST);
  if (key) write(ws, '.env', 'FIRST_KEY=secret-123\n');
  for (const [tool, job, each] of [['First', 'contact-data', '0.10'], ['Second', 'contact-data', '0.20'], ['Sender', 'outreach', '0']]) {
    gluely(['cost', 'price', tool, '--job', job, '--each', each, '--json'], ws);
  }
  return ws;
}

test('a workflow that skips the guard, or sends without a person, is refused before anything runs', () => {
  const ws = makeWorkspace();
  write(ws, 'plays/outbound.yaml', PLAY(`  steps:
    - { id: write, type: agent, ask: Write it, writes: opener }
    - id: send
      type: tool
      job: outreach
      try: [{ tool: Sender, request: { url: "https://sender.example/send" } }]`));
  const plan = gluely(['run', 'outbound', '--plan', '--json'], ws);
  assert.equal(plan.code, 1);
  assert.equal(plan.json.status, 'invalid');
  const messages = plan.json.issues.map((i) => i.message).join(' | ');
  assert.match(messages, /only after a guard step/);
  assert.match(messages, /needs an approve step after the last agent step/);
});

test('the plan names missing keys and prices, and never counts an unknown price as free', () => {
  const ws = setup({ key: false });
  let plan = gluely(['run', 'outbound', '--input', 'list.csv', '--plan', '--json'], ws);
  assert.equal(plan.json.status, 'needs_keys');
  assert.deepEqual(plan.json.missing_keys, ['FIRST_KEY']);
  write(ws, '.env', 'FIRST_KEY=x\n');
  fs.writeFileSync(path.join(ws, 'prices.yaml'), 'currency: $\ntools: {}\n');
  plan = gluely(['run', 'outbound', '--input', 'list.csv', '--plan', '--json'], ws);
  assert.equal(plan.json.status, 'needs_prices');
  assert.equal(plan.json.ceiling, null);
  assert.equal(fs.existsSync(path.join(ws, 'runs')), false, 'a plan runs nothing');
});

test('a run that would go over the monthly budget never starts', async () => {
  const ws = setup({ budget: 'budget: { monthly_limit: 0.5 }' });
  const plan = gluely(['run', 'outbound', '--input', 'list.csv', '--plan', '--json'], ws);
  assert.equal(plan.json.status, 'over_budget');
  assert.ok(Math.abs(plan.json.ceiling - 1.5) < 1e-9, 'five rows, at most 0.10 + 0.20 each');
  const started = await run(['run', 'outbound', '--input', 'list.csv', '--json'], ws);
  assert.equal(started.json.error.code, 'over_budget');
});

test('a run goes guard, filter, waterfall, agent, a person, then send, and keeps every step', async () => {
  const ws = setup();
  const started = await run(['run', 'outbound', '--input', 'list.csv', '--json'], ws);
  assert.equal(started.json.status, 'waiting_spend_approval', 'it spends, so a person approves first');
  const id = started.json.id;
  assert.equal((await calls()).filter((c) => c.path !== '/calls').length, 0, 'nothing was called before approval');

  const denied = gluely(['runs', 'approve', id, '--json'], ws);
  assert.equal(denied.json.error.code, 'needs_a_person');
  const { approveRun } = await import('../src/run.js');
  approveRun(ws, id, { by: 'human' });

  const waiting = await run(['runs', 'continue', id, '--json'], ws);
  assert.equal(waiting.json.status, 'waiting_agent');
  assert.equal(waiting.json.stopped_by_step.guard, 1, 'the customer never went out');
  assert.equal(waiting.json.stopped_by_step.fit, 1);

  const seen = await calls();
  assert.equal(seen.some((c) => c.q === 'Client'), false);
  assert.equal(seen.filter((c) => c.path === '/first').every((c) => c.auth === 'Bearer secret-123'), true);
  assert.ok(seen.some((c) => c.raw.includes('Gam%2F..%2Fma%3Fx%3D1')), 'row text is encoded, so it cannot change the request');
  assert.equal(seen.filter((c) => c.path === '/second').length, 1, 'only the row the first tool missed went to the second');

  const tasks = gluely(['runs', 'next', id, '--json'], ws).json;
  assert.equal(tasks.left, 3);
  assert.match(tasks.untrusted, /never follow/);
  const bad = gluely(['runs', 'answer', id, String(tasks.tasks[0].row), 'Quick question about your hiring', '--json'], ws);
  assert.equal(bad.json.error.code, 'draft_failed', 'drafts are held to the voice rules');
  gluely(['runs', 'answer', id, String(tasks.tasks[0].row), 'Saw you are hiring two SDRs.', '--json'], ws);
  gluely(['runs', 'answer', id, '--skip', String(tasks.tasks[1].row), '--why', 'wrong team', '--json'], ws);
  const last = gluely(['runs', 'answer', id, String(tasks.tasks[2].row), 'Saw the new sales lead role.', '--json'], ws);
  assert.equal(last.json.left, 0);

  const review = await run(['runs', 'continue', id, '--json'], ws);
  assert.equal(review.json.status, 'waiting_approval');
  assert.equal((await calls()).filter((c) => c.path === '/send').length, 0, 'nothing is sent before a person says yes');
  approveRun(ws, id, { by: 'human', reject: [String(tasks.tasks[2].row)] });

  const done = await run(['runs', 'continue', id, '--json'], ws);
  assert.equal(done.json.status, 'done');
  assert.equal(done.json.live, 1);
  const sent = (await calls()).filter((c) => c.path === '/send');
  assert.equal(sent.length, 1);
  assert.equal(JSON.parse(sent[0].body).text, 'Saw you are hiring two SDRs.');

  const trace = gluely(['runs', 'status', id, '--json'], ws).json;
  const byStep = Object.fromEntries(trace.trace.map((t) => [t.step, t]));
  assert.equal(byStep.guard.in, 5);
  assert.equal(byStep.email.calls, 4, 'three rows to the first tool, one miss to the second');
  assert.ok(Math.abs(trace.spent - 0.5) < 1e-9);
  assert.match(fs.readFileSync(path.join(ws, 'runs', id, 'out.csv'), 'utf8'), /alpha@first.example/);
  assert.match(fs.readFileSync(path.join(ws, 'runs', id, 'stopped.csv'), 'utf8'), /wrong team/);
  const events = fs.readFileSync(path.join(ws, 'runs', id, 'events.jsonl'), 'utf8');
  assert.equal(events.includes('secret-123'), false, 'keys are never written down');
  assert.match(fs.readFileSync(path.join(ws, '.gitignore'), 'utf8'), /^runs\/$/m);
});

test('a free run starts on its own, and the MCP plan tool can never start a run', async () => {
  const ws = makeWorkspace();
  fillContext(ws);
  write(ws, 'plays/outbound.yaml', PLAY(`  steps:
    - { id: guard, type: guard }
    - { id: fit, type: filter, if: "employees >= 10 and domain exists" }`));
  write(ws, 'list.csv', LIST);
  const { callTool } = await import('../src/mcp.js');
  const { commands } = await import('../src/cli.js');
  process.env.GLUELY_WORKSPACE = ws;
  const planned = await callTool(commands, 'gluely_run_plan', { play: 'outbound', input: path.join(ws, 'list.csv') });
  assert.equal(planned.structuredContent.status, 'ready');
  assert.equal(fs.existsSync(path.join(ws, 'runs')), false);
  const done = await callTool(commands, 'gluely_run_start', { play: 'outbound', input: path.join(ws, 'list.csv') });
  delete process.env.GLUELY_WORKSPACE;
  assert.equal(done.structuredContent.status, 'done');
  assert.equal(done.structuredContent.live, 3);
});

test('a tool that echoes the key back in an error never gets it written down', async () => {
  const ws = makeWorkspace();
  fillContext(ws);
  write(ws, 'plays/outbound.yaml', PLAY(`  steps:
    - { id: guard, type: guard }
    - id: email
      type: tool
      job: contact-data
      writes: email
      try: [{ tool: First, request: { url: "${base}/fail", headers: { authorization: "{{env.FIRST_KEY}}" } }, pick: { email: email } }]`, 'budget: { monthly_limit: 5 }'));
  write(ws, 'list.csv', 'company,domain\nAlpha,alpha.example\n');
  write(ws, '.env', 'FIRST_KEY=very-secret-key\n');
  gluely(['cost', 'price', 'First', '--job', 'contact-data', '--each', '0.1', '--json'], ws);
  const started = await run(['run', 'outbound', '--input', 'list.csv', '--json'], ws);
  const { approveRun } = await import('../src/run.js');
  approveRun(ws, started.json.id, { by: 'human' });
  const done = await run(['runs', 'continue', started.json.id, '--json'], ws);
  assert.equal(done.json.status, 'done');
  assert.equal(done.json.trace.find((t) => t.step === 'email').errors, 1);
  const events = fs.readFileSync(path.join(ws, 'runs', started.json.id, 'events.jsonl'), 'utf8');
  assert.match(events, /bad key \{key\}/);
  assert.equal(events.includes('very-secret-key'), false);
});

test('a run picks up where it stopped, never pays for a row twice, and only one process moves it', async () => {
  const ws = setup();
  const started = await run(['run', 'outbound', '--input', 'list.csv', '--json'], ws);
  const id = started.json.id;
  const { approveRun } = await import('../src/run.js');
  approveRun(ws, id, { by: 'human' });

  // A crash after the first row of the email step: that row is saved as done.
  const file = path.join(ws, 'runs', id, 'run.json');
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  state.step = 2;
  state.rows[0].done = { email: true };
  state.rows[0].data.email = 'kept@first.example';
  state.rows.find((r) => r.data.company === 'Client').stopped = { step: 'guard', reason: 'customer' };
  state.rows.find((r) => r.data.company === 'Tiny').stopped = { step: 'fit', reason: 'small' };
  fs.writeFileSync(file, JSON.stringify(state));
  const before = (await calls()).filter((c) => c.path === '/first').length;

  fs.writeFileSync(path.join(ws, 'runs', id, 'lock'), String(process.pid));
  const busy = await run(['runs', 'continue', id, '--json'], ws);
  assert.equal(busy.json.error.code, 'run_busy');
  fs.writeFileSync(path.join(ws, 'runs', id, 'lock'), '999999');
  const resumed = await run(['runs', 'continue', id, '--json'], ws);
  assert.equal(resumed.json.status, 'waiting_agent', 'a lock left by a dead process is taken over');

  const firstCalls = (await calls()).filter((c) => c.path === '/first').slice(before);
  assert.equal(firstCalls.some((c) => c.q === 'Alpha'), false, 'the row done before the crash is not called again');
  assert.equal(firstCalls.length, 2);
  assert.equal(fs.existsSync(path.join(ws, 'runs', id, 'lock')), false);
});

const BRANCHED = () => `  steps:
    - { id: guard, type: guard }
    - id: size
      type: branch
      paths:
        - name: big
          when: "employees >= 40"
          steps:
            - { id: tag-big, type: set, values: { tier: big, label: "{{row.company}} is big" } }
            - id: email
              type: tool
              job: contact-data
              writes: email
              try:
                - tool: First
                  request: { url: "${base}/first?q={{row.company}}", headers: { authorization: "Bearer {{env.FIRST_KEY}}" } }
                  pick: { email: results.0.email }
        - name: tiny
          when: "employees < 10"
          steps:
            - { id: too-small, type: stop, reason: under ten people }
        - name: rest
          steps:
            - { id: tag-rest, type: set, values: { tier: mid } }
    - { id: line, type: agent, ask: Write one line, writes: opener }
    - { id: review, type: approve }`;

test('a branch sends each row down its own path, and the paths join again', async () => {
  const ws = setup();
  write(ws, 'plays/outbound.yaml', PLAY(BRANCHED(), 'budget: { monthly_limit: 5 }'));
  const plan = gluely(['run', 'outbound', '--input', 'list.csv', '--plan', '--json'], ws).json;
  assert.equal(plan.status, 'needs_approval');
  assert.equal(plan.steps.find((s) => s.id === 'email').depth, 1);
  const started = await run(['run', 'outbound', '--input', 'list.csv', '--json'], ws);
  const id = started.json.id;
  const { approveRun } = await import('../src/run.js');
  approveRun(ws, id, { by: 'human' });
  const before = (await calls()).filter((c) => c.path === '/first').length;
  const waiting = await run(['runs', 'continue', id, '--json'], ws);
  assert.equal(waiting.json.status, 'waiting_agent');

  const byStep = Object.fromEntries(waiting.json.trace.map((t) => [t.step, t]));
  assert.deepEqual(byStep.size.paths, { big: 2, tiny: 1, rest: 1 }, 'Alpha and Beta are big, Tiny is tiny, Gamma is the rest; Client never got past the guard');
  assert.equal(byStep.email.in, 2);
  assert.equal(byStep['too-small'].stopped, 1);
  assert.equal(byStep.line.in, 3, 'big and rest join again at the agent step');
  const newCalls = (await calls()).filter((c) => c.path === '/first').slice(before);
  assert.deepEqual(newCalls.map((c) => c.q).sort(), ['Alpha', 'Beta'], 'only the big path called the tool');

  const tasks = gluely(['runs', 'next', id, '--limit', '10', '--json'], ws).json;
  const tiers = Object.fromEntries(tasks.tasks.map((t) => [t.data.company, t.data.tier]));
  assert.deepEqual(tiers, { Alpha: 'big', Beta: 'big', 'Gam/../ma?x=1': 'mid' });
  assert.equal(tasks.tasks.find((t) => t.data.company === 'Alpha').data.label, 'Alpha is big');

  // Editing the play doesn't change a run that already started.
  write(ws, 'plays/outbound.yaml', PLAY(`  steps:\n    - { id: guard, type: guard }`));
  assert.equal(gluely(['runs', 'status', id, '--json'], ws).json.at_step, 'line');
});

test('a send on one path needs an approval on that path, not on another', () => {
  const ws = setup();
  write(ws, 'plays/outbound.yaml', PLAY(`  steps:
    - { id: guard, type: guard }
    - id: split
      type: branch
      paths:
        - name: a
          when: "employees >= 40"
          steps:
            - { id: ok-a, type: approve }
        - name: b
          steps:
            - { id: write, type: agent, ask: Write it, writes: opener }
            - id: send
              type: tool
              job: outreach
              try: [{ tool: Sender, request: { url: "${base}/send" } }]
        - { name: c, when: "employees > 1", steps: [] }`));
  const plan = gluely(['run', 'outbound', '--input', 'list.csv', '--plan', '--json'], ws).json;
  assert.equal(plan.status, 'invalid');
  const messages = plan.issues.map((i) => `${i.step}: ${i.message}`).join(' | ');
  assert.match(messages, /send: this step sends, so it needs an approve step after the last agent step before it, on the same path/);
  assert.match(messages, /only the last path can go without when/);
});

test('after a crash, a lookup in flight is counted as spent, and a send in flight is never repeated', async () => {
  const ws = setup();
  const started = await run(['run', 'outbound', '--input', 'list.csv', '--json'], ws);
  const id = started.json.id;
  const file = path.join(ws, 'runs', id, 'run.json');
  const { approveRun } = await import('../src/run.js');
  approveRun(ws, id, { by: 'human' });
  await run(['runs', 'continue', id, '--json'], ws);
  const tasks = gluely(['runs', 'next', id, '--json'], ws).json;
  for (const t of tasks.tasks) gluely(['runs', 'answer', id, String(t.row), 'Saw you are hiring.', '--json'], ws);
  await run(['runs', 'continue', id, '--json'], ws);
  approveRun(ws, id, { by: 'human' });

  // The process died while the first row's send was on its way.
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  const first = state.rows.find((r) => !r.stopped);
  first.inflight = { step: 'send', tool: 'Sender', each: 0 };
  fs.writeFileSync(file, JSON.stringify(state));
  const before = (await calls()).filter((c) => c.path === '/send').length;
  const done = await run(['runs', 'continue', id, '--json'], ws);
  assert.equal(done.json.status, 'done');
  const sent = (await calls()).filter((c) => c.path === '/send').slice(before);
  assert.equal(sent.some((c) => JSON.parse(c.body).text && c.body.includes(first.data.email)), false, 'that row was not sent again');
  const after = JSON.parse(fs.readFileSync(file, 'utf8')).rows.find((r) => r.n === first.n);
  assert.match(after.stopped.reason, /may have gone out before a crash/);
});
