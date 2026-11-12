// `gluely worker`: keeps a workspace's runs moving when nobody is at a terminal.
// Every tick it pulls the plays from git (optional), starts the plays whose schedule is due,
// carries on every run that can move, and tells a person once when a run waits for them.
// It never approves anything and never answers an agent step: those still need a person
// or an agent. Stopping it is safe at any moment, because a run picks up at its next row.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { loadPlays } from './plays.js';
import { advance, listRuns, loadEnv, startRun, summary } from './run.js';
import { git } from './workspace.js';

const stateFile = (ws) => path.join(ws, 'runs', '.worker.json');

function readState(ws) {
  try { return JSON.parse(fs.readFileSync(stateFile(ws), 'utf8')); } catch { return { schedules: {}, notified: {} }; }
}
function writeState(ws, state) {
  fs.mkdirSync(path.dirname(stateFile(ws)), { recursive: true });
  const tmp = `${stateFile(ws)}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`);
  fs.renameSync(tmp, stateFile(ws));
}

// ---------- cron: minute hour day-of-month month day-of-week, in the worker's TZ ----------

function field(spec, min, max) {
  const out = new Set();
  for (const part of String(spec).split(',')) {
    const [range, stepText] = part.split('/');
    const step = stepText === undefined ? 1 : Number(stepText);
    let [lo, hi] = range === '*' ? [min, max] : range.split('-').map(Number);
    if (hi === undefined) hi = stepText === undefined ? lo : max;
    if (![lo, hi, step].every(Number.isInteger) || step < 1 || lo < min || hi > max || lo > hi) return null;
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

export function parseCron(expr) {
  const parts = String(expr || '').trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [m, h, dom, mon, dow] = parts;
  const sets = [field(m, 0, 59), field(h, 0, 23), field(dom, 1, 31), field(mon, 1, 12), field(dow.replace(/\b7\b/g, '0'), 0, 6)];
  if (sets.some((x) => x === null)) return null;
  return { minute: sets[0], hour: sets[1], dom: sets[2], month: sets[3], dow: sets[4], anyDom: dom === '*', anyDow: dow === '*' };
}

export function cronMatches(cron, d) {
  if (!cron.minute.has(d.getMinutes()) || !cron.hour.has(d.getHours()) || !cron.month.has(d.getMonth() + 1)) return false;
  const domOk = cron.dom.has(d.getDate());
  const dowOk = cron.dow.has(d.getDay());
  // Classic cron: when both day fields are set, either one matching is enough.
  if (cron.anyDom && cron.anyDow) return true;
  if (cron.anyDom) return dowOk;
  if (cron.anyDow) return domOk;
  return domOk || dowOk;
}

// Did the schedule come due after `since`, up to `now`? A worker that was down for a while
// fires once to catch up, never once per missed slot.
export function dueBetween(cron, since, now) {
  const start = new Date(Math.max(since.getTime(), now.getTime() - 8 * 86400000));
  start.setSeconds(0, 0);
  for (let t = start.getTime() + 60000; t <= now.getTime(); t += 60000) if (cronMatches(cron, new Date(t))) return true;
  return false;
}

export function schedules(ws) {
  return loadPlays(ws)
    .filter((p) => p.spec?.schedule)
    .map(({ spec }) => {
      const s = spec.schedule;
      const cron = parseCron(s.cron);
      const problem = !cron ? `can't read the cron "${s.cron}"`
        : !s.input ? 'a schedule needs an input: the list it runs over'
          : ['paused', 'killed'].includes(spec.status) ? `the play is ${spec.status}` : null;
      return { play: spec.id, cron: s.cron, input: s.input, limit: s.limit, parsed: cron, problem };
    });
}

// ---------- git: the plays come from your repo, the runs stay on this disk ----------

// The worker only appends to learning/*.jsonl. Those lines are set aside, the pull happens,
// and they go back on top, so the box never needs to commit or push anything.
export function pull(ws, log) {
  if (git(ws, ['rev-parse', '--is-inside-work-tree']) !== 'true' || !git(ws, ['remote'])) return { pulled: false, why: 'no git remote' };
  const changed = (git(ws, ['status', '--porcelain', '--untracked-files=no']) || '').split('\n').filter(Boolean).map((l) => l.replace(/^\s*\S+\s+/, ''));
  const other = changed.filter((f) => !/^learning\/[^/]+\.jsonl$/.test(f));
  if (other.length) { log(`! not pulling: ${other.join(', ')} changed on this box`); return { pulled: false, why: 'local changes' }; }
  const kept = {};
  for (const f of changed) {
    const head = git(ws, ['show', `HEAD:${f}`]) ?? '';
    const now = fs.readFileSync(path.join(ws, f), 'utf8');
    kept[f] = now.startsWith(head) ? now.slice(head.length) : now.split('\n').filter((l) => l && !head.includes(l)).map((l) => `${l}\n`).join('');
    execFileSync('git', ['checkout', '--', f], { cwd: ws, stdio: 'ignore' });
  }
  let ok = true;
  try { execFileSync('git', ['pull', '--ff-only', '--quiet'], { cwd: ws, stdio: 'ignore', timeout: 60000 }); } catch { ok = false; log('! git pull failed, running on what is here'); }
  for (const [f, extra] of Object.entries(kept)) {
    if (!extra) continue;
    const file = path.join(ws, f);
    const base = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    const lines = extra.split('\n').filter((l) => l && !base.includes(l));
    if (lines.length) fs.appendFileSync(file, `${base && !base.endsWith('\n') ? '\n' : ''}${lines.join('\n')}\n`);
  }
  return { pulled: ok };
}

// First start on an empty disk: clone the brain. The URL can carry a token, so it's never printed.
export function ensureWorkspace(ws, log) {
  if (fs.existsSync(path.join(ws, 'workspace.yaml'))) return;
  const repo = process.env.GLUELY_BRAIN_REPO;
  if (!repo) throw new Error(`No workspace at ${ws}, and GLUELY_BRAIN_REPO isn't set.`);
  log(`Cloning your brain into ${ws}`);
  fs.mkdirSync(path.dirname(ws), { recursive: true });
  execFileSync('git', ['clone', '--quiet', repo, ws], { stdio: 'ignore', timeout: 120000 });
}

// ---------- telling a person ----------

// GLUELY_NOTIFY_URL takes a JSON post with a text field, which is what a Slack or Teams
// incoming webhook expects. Anything else that takes JSON works too.
async function notify(ws, text, log) {
  const url = loadEnv(ws).GLUELY_NOTIFY_URL;
  log(`→ ${text}`);
  if (!url) return false;
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(15000) });
    return res.ok;
  } catch { return false; }
}

const WAITING_TEXT = {
  waiting_spend_approval: (r) => `Gluely: ${r.play} wants to spend up to ${r.currency}${(r.ceiling ?? 0).toFixed(2)}. Approve in a terminal: gluely runs approve ${r.id}`,
  waiting_approval: (r) => `Gluely: ${r.live} rows of ${r.play} wait at ${r.at_step} for you to read and approve: gluely runs approve ${r.id}`,
  waiting_agent: (r) => `Gluely: ${r.play} waits for your agent at ${r.at_step}: gluely runs next ${r.id}`,
  over_ceiling: (r) => `Gluely: ${r.play} reached its approved ceiling and stopped (${r.id}).`,
};

// ---------- one tick ----------

export async function tick(ws, { now = new Date(), doPull = false, log = () => {} } = {}) {
  const state = readState(ws);
  state.schedules ||= {};
  state.notified ||= {};
  const did = { pulled: false, started: [], moved: [], notified: [], errors: [] };
  if (doPull) did.pulled = pull(ws, log).pulled;

  for (const s of schedules(ws)) {
    if (s.problem) { if (state.schedules[s.play]?.problem !== s.problem) log(`! ${s.play}: ${s.problem}`); state.schedules[s.play] = { ...state.schedules[s.play], problem: s.problem }; continue; }
    const last = state.schedules[s.play]?.last;
    // A schedule seen for the first time starts counting now, so adding one never fires a backlog.
    if (!last) { state.schedules[s.play] = { last: now.toISOString() }; continue; }
    if (!dueBetween(s.parsed, new Date(last), now)) continue;
    state.schedules[s.play] = { last: now.toISOString() };
    try {
      const run = startRun(ws, s.play, { input: path.resolve(ws, s.input), limit: s.limit, by: 'schedule' });
      did.started.push(run.id);
      log(`Started ${run.id} of ${s.play} on schedule`);
    } catch (error) {
      did.errors.push({ play: s.play, error: error.message });
      await notify(ws, `Gluely: the scheduled run of ${s.play} didn't start: ${error.message}`, log);
    }
  }
  writeState(ws, state);

  for (const run of listRuns(ws).filter((r) => r.status === 'running')) {
    try {
      const after = await advance(ws, run.id);
      if (after.status !== 'running' || after.live !== run.rows.filter((r) => !r.stopped).length) did.moved.push(run.id);
    } catch (error) {
      if (error.code !== 'run_busy') { did.errors.push({ run: run.id, error: error.message }); log(`! ${run.id}: ${error.message}`); }
    }
  }

  for (const run of listRuns(ws)) {
    const make = WAITING_TEXT[run.status];
    if (!make || state.notified[run.id] === run.status) continue;
    const sum = summary(ws, run);
    await notify(ws, make({ ...sum, currency: run.currency }), log);
    state.notified[run.id] = run.status;
    did.notified.push(run.id);
  }
  writeState(ws, { ...state, heartbeat: new Date().toISOString(), pid: process.pid });
  return did;
}

export async function work(ws, { every = 30, doPull = false, once = false, log = console.log } = {}) {
  ensureWorkspace(ws, log);
  let stopping = false;
  let wake = () => {};
  const stop = () => { if (!stopping) log('Stopping after this step. Runs pick up where they are.'); stopping = true; wake(); };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  log(`Gluely worker on ${ws}, every ${every}s${doPull ? ', pulling plays from git' : ''}`);
  for (;;) {
    try { await tick(ws, { doPull, log }); } catch (error) { log(`! ${error.message}`); }
    if (once || stopping) break;
    await new Promise((resolve) => { wake = resolve; setTimeout(resolve, every * 1000); });
    if (stopping) break;
  }
}
