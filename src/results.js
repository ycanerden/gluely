// What a play actually produced, and what that is honestly worth. Results are appended,
// never edited, and judged by one rule: under 50 touches nothing is known, from 50 a play
// with no positive reply can die, and at 100 (or when its own kill rule comes due) it is
// decided. Zero replies on email is a deliverability question before it is a copy question.
import fs from 'node:fs';
import path from 'node:path';
import { fail } from './output.js';
import { readPlay } from './playbooks.js';
import { contextVersion } from './workspace.js';

export const KILL_FROM = 50;
export const DECIDE_AT = 100;
const PLACEMENTS = ['inbox', 'spam', 'unchecked'];
const COUNTS = ['touches', 'replies', 'positive', 'meetings', 'unsubscribes'];
const MONEY = ['spent', 'pipeline'];

const file = (ws) => path.join(ws, 'learning', 'plays.jsonl');

// The day a batch happened. Older batches have no `on`, so they count on the day they were added.
export const dayOf = (entry) => entry.on || String(entry.at).slice(0, 10);

// --on is the day the touches went out, so weekly imports and backfills land on the right days.
function readDay(value, today) {
  if (value === undefined) return today;
  const day = String(value);
  const parsed = Date.parse(`${day}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(parsed) || new Date(parsed).toISOString().slice(0, 10) !== day) {
    fail('bad_date', '--on must be a day like 2026-11-02: the day the touches went out.');
  }
  if (day > today) fail('bad_date', `--on ${day} is in the future. Results are added after they happen.`);
  return day;
}

export function readResults(ws) {
  if (!fs.existsSync(file(ws))) return [];
  return fs.readFileSync(file(ws), 'utf8').split('\n').filter(Boolean).map((row, i) => {
    try { return JSON.parse(row); } catch { return fail('bad_results', `learning/plays.jsonl line ${i + 1} is not valid JSON.`); }
  });
}

const count = (flag, value) => {
  if (value === undefined || value === true) return 0;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) fail('bad_number', `--${flag} must be a number of zero or more.`);
  return n;
};

export function addResult(ws, id, flags) {
  const spec = readPlay(ws, id);
  const at = new Date().toISOString();
  const entry = { at, on: readDay(flags.on, at.slice(0, 10)), play: id };
  for (const key of [...COUNTS, ...MONEY]) entry[key] = count(key, flags[key]);
  const variants = spec.excuse?.variants;
  if (flags.variant !== undefined && flags.variant !== true) {
    const variant = String(flags.variant);
    if (Array.isArray(variants) && !variants.map(String).includes(variant)) {
      fail('unknown_variant', `${id} has no variant "${variant}". Its variants are ${variants.join(', ')}.`, `Add it under excuse.variants in plays/${id}.yaml first.`);
    }
    entry.variant = variant;
  }
  if (!entry.touches && !entry.replies && !entry.spent) fail('usage', 'Pass at least --touches, and what came back: --replies, --positive, --meetings, --spent.');
  for (const [part, whole] of [['replies', 'touches'], ['positive', 'replies'], ['meetings', 'positive'], ['unsubscribes', 'touches']]) {
    if (entry[part] > entry[whole] && entry[whole]) fail('bad_number', `--${part} can't be more than --${whole}.`);
  }
  const placement = flags.placement ?? 'unchecked';
  if (!PLACEMENTS.includes(placement)) fail('usage', `--placement must be one of ${PLACEMENTS.join(', ')}: where test emails landed.`);
  Object.assign(entry, { placement, by: flags.by || 'human', context_version: contextVersion(ws).version });
  // Results are append-only, so a day added twice counts twice. Say so instead of guessing.
  const warnings = readResults(ws).some((e) => e.play === id && dayOf(e) === entry.on && (e.variant ?? null) === (entry.variant ?? null))
    ? [`${id}${entry.variant ? ` variant ${entry.variant}` : ''} already has a batch on ${entry.on}. If this one repeats it, the day now counts twice.`]
    : [];
  fs.mkdirSync(path.dirname(file(ws)), { recursive: true });
  fs.appendFileSync(file(ws), `${JSON.stringify(entry)}\n`);
  return { added: entry, warnings, ...judgePlay(ws, id) };
}

// A 95% Wilson interval: what a rate could really be, given how few touches stand behind it.
export function interval(hits, total) {
  if (!total) return null;
  const z = 1.96;
  const p = hits / total;
  const centre = (p + (z * z) / (2 * total)) / (1 + (z * z) / total);
  const spread = (z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total))) / (1 + (z * z) / total);
  return [Math.max(0, centre - spread), Math.min(1, centre + spread)];
}

// Kill rules are plain sentences like "meeting_rate < 0.5% and positive_rate < 1%".
// Anything this can't read returns null, so an unreadable rule never kills a play.
export function evaluateRule(rule, metrics) {
  if (!rule) return null;
  const any = String(rule).split(/\s+or\s+/i).map((group) => group.split(/\s+and\s+/i).map((cond) => {
    const m = cond.trim().match(/^([a-z_]+)\s*(<=|>=|==|!=|<|>)\s*(-?[\d.]+)\s*(%?)$/i);
    if (!m || !(m[1] in metrics)) return null;
    const [, key, op, raw, pct] = m;
    const value = Number(raw) / (pct ? 100 : 1);
    const actual = metrics[key];
    return { '<': actual < value, '<=': actual <= value, '>': actual > value, '>=': actual >= value, '==': actual === value, '!=': actual !== value }[op];
  }));
  if (any.flat().some((v) => v === null)) return null;
  return any.some((group) => group.every(Boolean));
}

const share = (part, whole) => (whole ? part / whole : 0);
const pct = (v) => `${(v * 100).toFixed(v < 0.1 ? 1 : 0)}%`;

export function judgePlay(ws, id, now = Date.now()) {
  const spec = readPlay(ws, id);
  const entries = readResults(ws).filter((e) => e.play === id);
  const totals = Object.fromEntries([...COUNTS, ...MONEY].map((k) => [k, entries.reduce((sum, e) => sum + (e[k] || 0), 0)]));
  const first = entries.map(dayOf).sort()[0];
  const days = first ? Math.floor((now - Date.parse(`${first}T00:00:00Z`)) / 86400000) : 0;
  const placement = [...entries].reverse().find((e) => e.placement !== 'unchecked')?.placement || 'unchecked';
  const metrics = {
    ...totals, days,
    reply_rate: share(totals.replies, totals.touches),
    positive_rate: share(totals.positive, totals.touches),
    meeting_rate: share(totals.meetings, totals.touches),
    unsubscribe_rate: share(totals.unsubscribes, totals.touches),
  };
  const roi = {
    per_positive: totals.positive ? totals.spent / totals.positive : null,
    per_meeting: totals.meetings ? totals.spent / totals.meetings : null,
    pipeline_per_spent: totals.spent && totals.pipeline ? totals.pipeline / totals.spent : null,
  };

  const email = (spec.action?.channels || []).includes('email');
  const kill = spec.kill || {};
  const due = Boolean((kill.after_touches && totals.touches >= kill.after_touches) || (kill.after_days && first && days >= kill.after_days));
  const ruleSays = evaluateRule(kill.if, metrics);
  const say = (verdict, why) => ({ verdict, why });

  let judged;
  if (!entries.length) judged = say('no_results', `No results yet. Add them with gluely results add ${id} --touches <n> --positive <n>.`);
  else if (email && placement === 'spam') judged = say('fix_deliverability', 'Test emails land in spam, so the copy has not been tested yet. Fix the sending setup before judging the play.');
  else if (email && totals.replies === 0 && placement === 'unchecked' && totals.touches >= KILL_FROM) {
    judged = say('check_deliverability', `No reply at all in ${totals.touches} emails. Check where they land before blaming the copy, then add the result with --placement inbox or spam.`);
  } else if (due && ruleSays === null) judged = say('decide', `The kill rule is due, but "${kill.if}" can't be read. A person decides.`);
  else if (due) judged = ruleSays ? say('kill', `The kill rule is due and "${kill.if}" is true.`) : say('keep', `The kill rule is due and "${kill.if}" is false.`);
  else if (totals.touches < KILL_FROM) judged = say('too_early', `${totals.touches} touches. Under ${KILL_FROM}, any rate is noise, so keep going.`);
  else if (totals.positive === 0) judged = say('kill', `No positive reply in ${totals.touches} touches.`);
  else if (totals.touches < DECIDE_AT) judged = say('keep_going', `${totals.positive} positive so far. Decide at ${DECIDE_AT} touches.`);
  else if (ruleSays === null) judged = say('decide', `${totals.touches} touches is enough to decide, but "${kill.if}" can't be read. A person decides.`);
  else judged = ruleSays ? say('kill', `${totals.touches} touches, and "${kill.if}" is true.`) : say('keep', `${totals.touches} touches, and "${kill.if}" is false.`);

  return {
    play: id,
    status: spec.status,
    batches: entries.length,
    since: first || null,
    days,
    totals,
    rates: {
      reply: metrics.reply_rate,
      positive: metrics.positive_rate,
      meeting: metrics.meeting_rate,
      unsubscribe: metrics.unsubscribe_rate,
      positive_could_be: interval(totals.positive, totals.touches),
    },
    variants: variantRows(entries),
    roi,
    placement,
    ...judged,
    decided_by: 'a person',
  };
}

const sumOf = (entries) => Object.fromEntries([...COUNTS, ...MONEY].map((k) => [k, entries.reduce((sum, e) => sum + (e[k] || 0), 0)]));

// Batches recorded with --variant, one row per variant. Batches without one stay out.
function variantRows(entries) {
  const names = [...new Set(entries.filter((e) => e.variant !== undefined).map((e) => e.variant))].sort();
  return names.map((variant) => {
    const totals = sumOf(entries.filter((e) => e.variant === variant));
    return { variant, totals, positive_rate: share(totals.positive, totals.touches), positive_could_be: interval(totals.positive, totals.touches) };
  });
}

// "Better" only when the two ranges don't overlap. Under KILL_FROM touches on either side,
// nothing is known yet, so nothing is called. The baseline is always the company's own.
export function versus(hits, total, baseHits, baseTotal, { lowerIsBetter = false } = {}) {
  const mine = interval(hits, total);
  const base = interval(baseHits, baseTotal);
  const row = { rate: share(hits, total), could_be: mine, touches: total, baseline_rate: share(baseHits, baseTotal), baseline_could_be: base, baseline_touches: baseTotal };
  if (total < KILL_FROM || baseTotal < KILL_FROM) return { ...row, call: 'too_early' };
  const above = mine[0] > base[1];
  const below = mine[1] < base[0];
  const call = above ? (lowerIsBetter ? 'worse' : 'better') : below ? (lowerIsBetter ? 'better' : 'worse') : 'unclear';
  return { ...row, call };
}

// Every play against everything else the company ran, and every variant against its siblings.
export function compareAll(ws) {
  const results = readResults(ws);
  const ids = [...new Set(results.map((e) => e.play))];
  const all = sumOf(results);
  return ids.map((play) => {
    const mine = results.filter((e) => e.play === play);
    const own = sumOf(mine);
    const rest = Object.fromEntries(Object.keys(all).map((k) => [k, all[k] - own[k]]));
    const variants = variantRows(mine).map((row, _, rows) => {
      const siblings = rows.filter((r) => r.variant !== row.variant);
      const touches = siblings.reduce((n, r) => n + r.totals.touches, 0);
      const positive = siblings.reduce((n, r) => n + r.totals.positive, 0);
      return { variant: row.variant, positive: siblings.length ? versus(row.totals.positive, row.totals.touches, positive, touches) : null };
    });
    return {
      play,
      totals: own,
      positive: versus(own.positive, own.touches, rest.positive, rest.touches),
      unsubscribes: versus(own.unsubscribes, own.touches, rest.unsubscribes, rest.touches, { lowerIsBetter: true }),
      variants,
    };
  });
}

export function renderJudgement(data, { color, line }) {
  console.log(color.bold(`Results: ${data.play}`) + color.dim(`   ${data.status}, ${data.batches} batches${data.since ? `, since ${data.since.slice(0, 10)}` : ''}`));
  if (data.batches) {
    const t = data.totals;
    console.log(`  ${t.touches} touches, ${t.replies} replies, ${t.positive} positive, ${t.meetings} meetings${t.unsubscribes ? `, ${t.unsubscribes} unsubscribed` : ''}`);
    const range = data.rates.positive_could_be;
    if (range) console.log(`  positive rate ${pct(data.rates.positive)} ${color.dim(`(could really be ${pct(range[0])} to ${pct(range[1])})`)}`);
    if (data.roi.per_meeting !== null) console.log(`  ${data.roi.per_meeting.toFixed(2)} spent per meeting`);
    else if (data.roi.per_positive !== null) console.log(`  ${data.roi.per_positive.toFixed(2)} spent per positive reply`);
    if (data.roi.pipeline_per_spent !== null) console.log(`  ${data.roi.pipeline_per_spent.toFixed(1)}x pipeline for what it cost`);
    for (const v of data.variants || []) {
      const r = v.positive_could_be;
      console.log(color.dim(`  variant ${v.variant}: ${v.totals.touches} touches, ${v.totals.positive} positive${r ? `, could really be ${pct(r[0])} to ${pct(r[1])}` : ''}`));
    }
  }
  const good = ['keep', 'keep_going', 'too_early', 'no_results'].includes(data.verdict);
  line(good, `${data.verdict.replace(/_/g, ' ')}: ${data.why}`);
  if (data.verdict === 'kill') console.log(color.dim('  This is a suggestion. A person sets status: killed in the play file.'));
}
