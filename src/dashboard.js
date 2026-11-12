// `gluely dashboard`: the loop's numbers on one page. Everything here is read from the
// workspace (results and the decision log) and nothing is guessed, so an empty
// workspace gets an empty dashboard. The page itself is drawn in dashboard-page.js.
// Where the loop stands lives in gluely doctor and gluely flow, so it is not repeated here.
import fs from 'node:fs';
import path from 'node:path';
import { loadPrices } from './cost.js';
import { diagnose } from './doctor.js';
import { loadEntries } from './log.js';
import { fail, GluelyError } from './output.js';
import { readPlay } from './playbooks.js';
import { dayOf, DECIDE_AT, interval, judgePlay, KILL_FROM, readResults } from './results.js';

export const DEFAULT_OUT = 'exports/dashboard.html';
const COUNTS = ['touches', 'replies', 'positive', 'meetings', 'spent', 'pipeline'];
const DAY = 86400000;

const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const share = (part, whole) => (whole ? part / whole : 0);

// Whole weeks, Monday first, ending with the week that holds today.
function calendar(results, events, weeks, now) {
  const today = Date.parse(isoDay(now));
  const weekday = (new Date(today).getUTCDay() + 6) % 7;
  const start = today - (weekday + (weeks - 1) * 7) * DAY;
  const days = [];
  const index = new Map();
  for (let t = start; t <= today; t += DAY) {
    const day = { date: isoDay(t), batches: 0, decisions: 0, ...Object.fromEntries(COUNTS.map((k) => [k, 0])) };
    index.set(day.date, day);
    days.push(day);
  }
  for (const r of results) {
    const day = index.get(dayOf(r));
    if (!day) continue;
    day.batches += 1;
    for (const k of COUNTS) day[k] += r[k] || 0;
  }
  for (const e of events) {
    const day = index.get(String(e.at).slice(0, 10));
    if (day && e.kind !== 'result') day.decisions += 1;
  }
  return { start: isoDay(start), end: isoDay(today), weeks, days };
}

function playRow(ws, play, results) {
  const mine = results.filter((r) => r.play === play.id);
  try {
    const spec = readPlay(ws, play.id) || {};
    const judged = judgePlay(ws, play.id);
    return {
      id: play.id,
      status: play.status,
      signal: play.signal || null,
      hypothesis: spec.hypothesis || null,
      kill_if: spec.kill?.if || null,
      decide_at: spec.kill?.after_touches || DECIDE_AT,
      batches: judged.batches,
      since: judged.since,
      last_at: mine.at(-1)?.at || null,
      totals: judged.totals,
      rates: judged.rates,
      placement: judged.placement,
      verdict: judged.verdict,
      why: judged.why,
    };
  } catch (error) {
    if (!(error instanceof GluelyError)) throw error;
    return { id: play.id, status: play.status, signal: play.signal || null, verdict: 'unreadable', why: error.message, batches: mine.length };
  }
}

export function buildDashboard(ws, { weeks = 26, now = Date.now() } = {}) {
  const span = Number(weeks);
  if (!Number.isInteger(span) || span < 1 || span > 104) fail('bad_number', '--weeks must be a whole number from 1 to 104.');
  const state = diagnose(ws);
  const results = readResults(ws);
  // Entries Gluely writes for itself (a saved price, say) are bookkeeping, not decisions.
  const events = loadEntries(ws).filter((e) => e.source !== 'gluely');
  const totals = Object.fromEntries(COUNTS.map((k) => [k, results.reduce((sum, r) => sum + (r[k] || 0), 0)]));
  const plays = state.plays.filter((p) => p.id).map((p) => playRow(ws, p, results));

  return {
    generated_at: new Date(now).toISOString(),
    company: { name: state.company.name || null, domain: state.company.domain || null },
    context_version: state.context_version,
    currency: loadPrices(ws).currency,
    next: state.next,
    rules: { kill_from: KILL_FROM, decide_at: DECIDE_AT },
    totals,
    rates: {
      reply: share(totals.replies, totals.touches),
      positive: share(totals.positive, totals.touches),
      meeting: share(totals.meetings, totals.touches),
      positive_could_be: interval(totals.positive, totals.touches),
    },
    roi: {
      per_meeting: totals.meetings && totals.spent ? totals.spent / totals.meetings : null,
      pipeline_per_spent: totals.spent && totals.pipeline ? totals.pipeline / totals.spent : null,
    },
    calendar: calendar(results, events, span, now),
    plays,
    log: events.slice(-8).reverse().map(({ id, at, kind, area, text, by, state: where, play }) => ({ id, at, kind, area, text, by, state: where, play: play || null })),
    note: 'Each batch counts on the day it happened (gluely results add --on), or the day it was added when it has no date. Signups, trials and reply streams are not tracked yet.',
  };
}

export function writeDashboard(ws, data, out = DEFAULT_OUT, draw) {
  const file = path.resolve(ws, out);
  const inside = path.relative(ws, file);
  // The page holds company numbers, so it stays in the private workspace.
  if (!inside || inside.startsWith('..') || path.isAbsolute(inside)) fail('bad_path', '--out must be a file inside the workspace, for example exports/dashboard.html.');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, draw(data));
  return inside;
}
