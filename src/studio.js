// `gluely studio`: the workspace in a browser, on this machine only.
// It reads the same files the CLI writes and changes nothing. Keys never leave .env:
// the page only learns whether each one is set.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { loadPrices } from './cost.js';
import { loadEntries } from './log.js';
import { loadPlays } from './plays.js';
import { judgePlay } from './results.js';
import { envNeeded, flatten, listRuns, loadEnv, loadRun, planRun, readEvents, summary } from './run.js';
import { expandSteps } from './recipes.js';
import { pricePer } from './waterfall.js';
import { GLUELY_ROOT, loadConfig } from './workspace.js';

const PAGE = path.join(GLUELY_ROOT, 'src', 'studio.html');
const FONTS = path.join(GLUELY_ROOT, 'site', 'fonts');
const MAX_EVENTS = 500;

const safe = (fn, fallback = null) => { try { return fn(); } catch { return fallback; } };

function playView(ws, { spec, parseError, file }) {
  const id = spec.id || file.replace(/\.ya?ml$/, '');
  const steps = safe(() => expandSteps(ws, spec.workflow?.steps || []), spec.workflow?.steps || []);
  const prices = loadPrices(ws);
  const env = loadEnv(ws);
  const view = (s) => (!s || typeof s !== 'object' ? s : ({
    ...s,
    // Requests show where they go, never what they carry.
    try: s.type === 'tool' ? (s.try ? [s.try].flat() : [{ tool: s.tool, request: s.request, pick: s.pick }]).map((t) => ({
      tool: t.tool,
      method: (t.request?.method || (t.request?.body ? 'POST' : 'GET')).toUpperCase(),
      host: safe(() => new URL(String(t.request.url).replace(/\{\{[^}]+\}\}/g, 'x')).host, '?'),
      pick: t.pick || null,
      price: t.tool ? pricePer(prices, t.tool, s.job) : null,
    })) : undefined,
    keys: s.type === 'tool' ? envNeeded([s]).map((k) => ({ name: k, set: Boolean(env[k]) })) : undefined,
    paths: s.type === 'branch' && Array.isArray(s.paths) ? s.paths.map((p) => ({ name: p?.name, when: p?.when ?? null, steps: (p?.steps || []).map(view) })) : undefined,
    request: undefined, tool: undefined, pick: undefined, values: s.type === 'set' ? s.values : undefined,
  }));
  return {
    id,
    file: `plays/${file}`,
    parse_error: parseError || null,
    status: spec.status || 'draft',
    name: spec.name || id,
    hypothesis: spec.hypothesis || '',
    signal: spec.signal?.type || null,
    personas: spec.audience?.personas || [],
    channels: spec.action?.channels || [],
    kill: spec.kill || null,
    budget: spec.budget?.monthly_limit ?? null,
    steps: steps.map(view),
    plan: steps.length ? safe(() => planRun(ws, id), null) : null,
    results: safe(() => judgePlay(ws, id), null),
    lessons: safe(() => loadEntries(ws).filter((e) => e.play === id).slice(-30).reverse(), []),
  };
}

export function studioState(ws) {
  const cfg = loadConfig(ws);
  const runs = listRuns(ws).map((r) => safe(() => ({ ...summary(ws, r), created: r.created }), { id: r.id, play: r.play, status: r.status, created: r.created }));
  return {
    company: cfg.company?.name || path.basename(ws),
    workspace: ws,
    currency: loadPrices(ws).currency,
    plays: loadPlays(ws).map((p) => playView(ws, p)),
    runs,
  };
}

// The run as a table: the list's own columns first, then the columns each step fills, grouped
// under that step, in the order they run. Each row says, per step, whether it is filled,
// still to come, waiting on someone, or never reached because the row stopped or took another path.
export function runTable(run) {
  const steps = flatten(run.workflow || []);
  const fills = (s) => {
    if (s.type === 'set') return Object.keys(s.values || {});
    if (s.type === 'agent') return s.writes ? [s.writes] : [];
    if (s.type === 'tool') {
      const tries = s.try ? [s.try].flat() : [{ pick: s.pick }];
      return [...new Set([s.writes, ...tries.flatMap((t) => Object.keys(t?.pick || {})), s.source].filter(Boolean))];
    }
    return [];
  };
  const index = Object.fromEntries(steps.map((s, i) => [s.id, i]));
  const made = new Set(steps.flatMap(fills));
  const input = [...new Set(run.rows.flatMap((r) => Object.keys(r.data)))].filter((c) => !made.has(c));
  const groups = [
    { step: null, type: 'input', columns: input },
    ...steps.map((s, i) => ({ step: s.id, type: s.type, at: i, columns: fills(s), ...(s.source ? { source: s.source } : {}), ...(s.scope.length ? { path: s.scope.at(-1).path } : {}) }))
      .filter((g) => g.columns.length || ['guard', 'filter', 'approve'].includes(g.type)),
  ];
  const onPath = (row, s) => s.scope.every((x) => row.route?.[x.branch] === x.path);
  const rows = run.rows.map((r) => ({
    n: r.n,
    data: r.data,
    stopped: r.stopped,
    state: Object.fromEntries(groups.filter((g) => g.step).map((g) => {
      const s = steps[g.at];
      const stoppedAt = r.stopped ? index[r.stopped.step] : Infinity;
      let state = 'done';
      if (stoppedAt === g.at) state = 'stopped_here';
      else if (stoppedAt < g.at) state = 'never';
      else if (Object.keys(r.route || {}).length && s.scope.length && !onPath(r, s)) state = 'other_path';
      else if (['stopped', 'over_ceiling'].includes(run.status) && g.at >= run.step) state = 'never';
      else if (g.at > run.step || (g.at === run.step && run.status !== 'done')) {
        const answered = s.type === 'agent' && r.answers?.[s.id] !== undefined && r.answers[s.id] !== null;
        state = answered ? 'done' : g.at === run.step && run.status.startsWith('waiting') ? 'waiting' : 'to_come';
      }
      return [g.step, state];
    })),
  }));
  return { groups, rows };
}

export function runDetail(ws, id) {
  const run = loadRun(ws, id);
  return {
    ...summary(ws, run),
    created: run.created,
    input: run.input,
    records: run.rows.map((r) => ({ n: r.n, data: r.data, stopped: r.stopped })),
    table: runTable(run),
    events: readEvents(ws, id).slice(-MAX_EVENTS),
  };
}

export function startStudio(ws, { port = 4600, host = '127.0.0.1' } = {}) {
  const send = (res, code, body, type = 'application/json') => {
    res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:" });
    res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  };
  const server = http.createServer((req, res) => {
    // Another site in the same browser must not read the workspace through this port.
    if (req.headers.host && !/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host)) return send(res, 403, { error: 'local only' });
    if (req.method !== 'GET') return send(res, 405, { error: 'the studio only reads' });
    const url = new URL(req.url, 'http://local');
    try {
      if (url.pathname === '/') return send(res, 200, fs.readFileSync(PAGE), 'text/html; charset=utf-8');
      if (url.pathname === '/api/state') return send(res, 200, studioState(ws));
      const run = url.pathname.match(/^\/api\/runs\/(run-[a-f0-9]+)$/);
      if (run) return send(res, 200, runDetail(ws, run[1]));
      const font = url.pathname.match(/^\/fonts\/([a-z0-9]+\.woff2)$/);
      if (font && fs.existsSync(path.join(FONTS, font[1]))) return send(res, 200, fs.readFileSync(path.join(FONTS, font[1])), 'font/woff2');
      return send(res, 404, { error: 'not found' });
    } catch (error) {
      return send(res, 500, { error: error.message });
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve({ server, url: `http://${host === '127.0.0.1' ? 'localhost' : host}:${server.address().port}` }));
  });
}
