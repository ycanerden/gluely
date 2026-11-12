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
import { envNeeded, listRuns, loadEnv, loadRun, planRun, readEvents, summary } from './run.js';
import { pricePer } from './waterfall.js';
import { GLUELY_ROOT, loadConfig } from './workspace.js';

const PAGE = path.join(GLUELY_ROOT, 'src', 'studio.html');
const FONTS = path.join(GLUELY_ROOT, 'site', 'fonts');
const MAX_EVENTS = 500;

const safe = (fn, fallback = null) => { try { return fn(); } catch { return fallback; } };

function playView(ws, { spec, parseError, file }) {
  const id = spec.id || file.replace(/\.ya?ml$/, '');
  const steps = spec.workflow?.steps || [];
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

export function runDetail(ws, id) {
  const run = loadRun(ws, id);
  return {
    ...summary(ws, run),
    created: run.created,
    input: run.input,
    records: run.rows.map((r) => ({ n: r.n, data: r.data, stopped: r.stopped })),
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
