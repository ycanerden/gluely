// Waterfalls from the company's own numbers. Gluely ranks nobody: the order comes from
// what each tool costs you and what it found for you, in a blind test on the same people.
// A tool with no test stays unproven, and a tool with no price stays unpriced.
import fs from 'node:fs';
import path from 'node:path';
import { loadPrices } from './cost.js';
import { loadLibrary, toolsForJob } from './library.js';
import { addEntry } from './log.js';
import { fail } from './output.js';
import { layerForJob } from './stack.js';
import { contextVersion, loadConfig } from './workspace.js';

export const TEST_SIZE = 20;
const file = (ws) => path.join(ws, 'learning', 'waterfall.jsonl');
const split = (value) => String(value || '').split(',').map((t) => t.trim()).filter(Boolean);
const same = (a, b) => a.toLowerCase() === b.toLowerCase();

function readTests(ws) {
  if (!fs.existsSync(file(ws))) return [];
  return fs.readFileSync(file(ws), 'utf8').split('\n').filter(Boolean).map((row, i) => {
    try { return JSON.parse(row); } catch { return fail('bad_tests', `learning/waterfall.jsonl line ${i + 1} is not valid JSON.`); }
  });
}

const checkJob = (ws, job) => {
  const { jobs } = loadLibrary(ws);
  if (!jobs[job]) fail('bad_job', `Unknown job "${job}". Use ${Object.keys(jobs).join(', ')}.`);
};

// One blind test: the same people through one tool. Right means the current company's
// address or record. Wrong means an old employer. Unprovable means an accept-all domain,
// which no verifier can confirm, so it never counts as a find.
export function recordTest(ws, tool, { job, tried, right, wrong = 0, unprovable = 0, by }) {
  if (!tool) fail('usage', 'Usage: gluely waterfall test <tool> --job <job> --tried <n> --right <n> [--wrong <n>] [--unprovable <n>]');
  checkJob(ws, job);
  const n = (value, name) => {
    const parsed = Number(value);
    if (value === undefined || value === true || !Number.isInteger(parsed) || parsed < 0) fail('bad_number', `--${name} must be a whole number, zero or more.`);
    return parsed;
  };
  const entry = { at: new Date().toISOString(), tool, job, tried: n(tried, 'tried'), right: n(right, 'right'), wrong: n(wrong, 'wrong'), unprovable: n(unprovable, 'unprovable') };
  if (!entry.tried) fail('bad_number', '--tried must be more than zero.');
  if (entry.right + entry.wrong + entry.unprovable > entry.tried) fail('bad_number', 'right, wrong and unprovable add up to more than --tried.');
  Object.assign(entry, { by: by || 'human', context_version: contextVersion(ws).version });
  fs.mkdirSync(path.dirname(file(ws)), { recursive: true });
  fs.appendFileSync(file(ws), `${JSON.stringify(entry)}\n`);
  addEntry(ws, { kind: 'result', area: 'tool', source: 'gluely', by: entry.by, text: `${tool} for ${job}: ${entry.right} right, ${entry.wrong} wrong, ${entry.unprovable} unprovable, of ${entry.tried}` });
  return { recorded: entry, ...planWaterfall(ws, job, {}) };
}

export function pricePer(prices, tool, job) {
  const entry = Object.entries(prices.tools).find(([name]) => same(name, tool))?.[1];
  const price = entry?.[job];
  if (!price) return null;
  if (price.each !== undefined) return price.each;
  return entry.credit_price === undefined ? null : price.credits * entry.credit_price;
}

function candidates(ws, job, named, tests, prices) {
  if (named.length) return named;
  const layer = layerForJob(job);
  const fromStack = split(loadConfig(ws).stack?.[layer]);
  const own = loadLibrary(ws).tools.filter((t) => t.own && t.jobs.includes(job)).map((t) => t.name);
  const tested = tests.filter((t) => t.job === job).map((t) => t.tool);
  const priced = Object.entries(prices.tools).filter(([, p]) => p[job]).map(([name]) => name);
  const all = [...fromStack, ...own, ...tested, ...priced];
  return all.filter((tool, i) => all.findIndex((t) => same(t, tool)) === i);
}

export function planWaterfall(ws, job, { tools } = {}) {
  checkJob(ws, job);
  const tests = readTests(ws);
  const prices = loadPrices(ws);
  const named = split(tools);
  const list = candidates(ws, job, named, tests, prices);
  const refresh = loadConfig(ws).refresh_days || {};

  const rows = list.map((tool) => {
    const mine = tests.filter((t) => same(t.tool, tool) && t.job === job);
    const sum = (key) => mine.reduce((total, t) => total + t[key], 0);
    const tried = sum('tried');
    const hit = tried ? sum('right') / tried : null;
    const price = pricePer(prices, tool, job);
    return {
      tool,
      price,
      tested_on: tried,
      hit_rate: hit,
      wrong_rate: tried ? sum('wrong') / tried : null,
      unprovable_rate: tried ? sum('unprovable') / tried : null,
      cost_per_find: price !== null && hit ? price / hit : null,
      proven: tried >= TEST_SIZE,
    };
  });

  // Measured and priced first, by what one real find costs you. Then what still needs a test, then a price.
  const rank = (r) => (r.cost_per_find !== null ? 0 : r.hit_rate === 0 ? 3 : r.price !== null ? 1 : 2);
  const order = [...rows].sort((a, b) => rank(a) - rank(b)
    || (a.cost_per_find ?? Infinity) - (b.cost_per_find ?? Infinity)
    || (b.hit_rate ?? -1) - (a.hit_rate ?? -1)
    || (a.price ?? Infinity) - (b.price ?? Infinity));

  // Each step only runs on the people the steps before it missed.
  let missed = 1;
  let cost = 0;
  let known = true;
  for (const row of order) {
    if (row.hit_rate === null || row.price === null) { known = false; break; }
    cost += missed * row.price;
    missed *= 1 - row.hit_rate;
  }

  const next = [];
  if (!list.length) next.push(`Name the tools you have for ${job}: gluely waterfall ${job} --tools "First, Second"`);
  for (const row of order) {
    if (row.price === null) next.push(`Price ${row.tool}: gluely cost price "${row.tool}" --job ${job} --each <amount>`);
    if (!row.proven) next.push(`Test ${row.tool} on the same ${TEST_SIZE} people as the others: gluely waterfall test "${row.tool}" --job ${job} --tried ${TEST_SIZE} --right <n> --wrong <n> --unprovable <n>`);
  }

  const verify = job === 'contact-data'
    ? split(loadConfig(ws).stack?.[layerForJob('email-verify')]).concat(toolsForJob(ws, 'email-verify').filter((t) => t.yours).map((t) => t.name))
    : [];

  return {
    job,
    order: order.map((r) => r.tool),
    tools: order,
    ranked_by: 'your own prices and your own blind tests',
    per_person: known && order.length ? cost : null,
    found_share: known && order.length ? 1 - missed : null,
    stop_on: job === 'contact-data' ? 'verified' : 'found',
    rules: [
      `Skip anyone enriched in the last ${refresh.employment ?? 30} days for job data, or ${refresh.default ?? 90} days for anything else. Check your store first, so nothing is paid for twice.`,
      'Run gluely guard on the list before the first tool. Customers never go out.',
      'Each tool only gets the people every tool before it missed.',
      ...(job === 'contact-data' ? ['Verify every email before it counts as found. An accept-all domain is unprovable, not found.', 'Count an address at an old employer as wrong, not found.'] : []),
    ],
    verify_with: [...new Set(verify)],
    next,
    save: order.length > 1 ? `gluely plays answer <play> contact "${order.map((r) => r.tool).join(', ')}"` : null,
  };
}

const pct = (v) => (v === null ? '?' : `${Math.round(v * 100)}%`);
const money = (v, currency) => (v === null ? '?' : `${currency}${v < 1 ? v.toFixed(3) : v.toFixed(2)}`);

export function renderWaterfall(data, { color, line, mark }, currency = '$') {
  console.log(color.bold(`Waterfall for ${data.job}`) + color.dim(`   ranked by ${data.ranked_by}`));
  if (!data.tools.length) console.log(color.dim('  No tools named yet.'));
  data.tools.forEach((t, i) => {
    const tested = t.tested_on ? `${pct(t.hit_rate)} right on ${t.tested_on}${t.wrong_rate ? `, ${pct(t.wrong_rate)} wrong` : ''}${t.unprovable_rate ? `, ${pct(t.unprovable_rate)} unprovable` : ''}` : 'not tested';
    console.log(`  ${i + 1}. ${t.tool.padEnd(18)} ${money(t.price, currency).padStart(8)} each   ${tested}${t.cost_per_find !== null ? color.dim(`   ${money(t.cost_per_find, currency)} per find`) : ''}`);
  });
  if (data.per_person !== null) line(true, `About ${money(data.per_person, currency)} per person, finding about ${pct(data.found_share)}`);
  if (data.verify_with.length) console.log(`  ${mark.next()} Verify with ${data.verify_with.join(' or ')}`);
  for (const rule of data.rules) console.log(color.dim(`  · ${rule}`));
  for (const step of data.next) console.log(`  ${mark.next()} ${step}`);
}
