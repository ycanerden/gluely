// The cost check. Prices are the company's own numbers: a price in this repo would be
// out of date within months. Unknown prices stay unknown and are never counted as free.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { getPlaybook, loadLibrary } from './library.js';
import { addEntry } from './log.js';
import { fail } from './output.js';
import { readPlay, savePlay } from './playbooks.js';

const pricesFile = (ws) => path.join(ws, 'prices.yaml');
export const DEFAULT_ASSUMPTIONS = { fit: 0.3, touches: 2, checks_per_month: 1 };

export function loadPrices(ws) {
  const file = pricesFile(ws);
  const data = fs.existsSync(file) ? YAML.parse(fs.readFileSync(file, 'utf8')) || {} : {};
  return { currency: data.currency || '$', tools: data.tools || {} };
}

export function setPrice(ws, { tool, job, each, credits, creditPrice, monthly, creditsLeft, currency, by }) {
  if (!tool) fail('usage', 'Usage: gluely cost price <tool> [--job <job>] (--each <amount> | --credits <n>) [--credit-price <amount>] [--monthly <amount>] [--credits-left <n>]');
  const prices = loadPrices(ws);
  const entry = prices.tools[tool] ||= {};
  // A blank answer is not a price of zero. Free has to be said out loud.
  const number = (value, name) => {
    const parsed = Number(value);
    if (String(value).trim() === '' || !Number.isFinite(parsed) || parsed < 0) fail('bad_price', `${name} must be a number, zero or above.`);
    return parsed;
  };
  if (job && !loadLibrary(ws).jobs[job]) fail('bad_job', `Unknown job "${job}". Use ${Object.keys(loadLibrary(ws).jobs).join(', ')}.`);
  if (each !== undefined || credits !== undefined) {
    if (!job) fail('usage', 'Say which job this price is for with --job, because one tool can do several.');
    entry[job] = each !== undefined ? { each: number(each, '--each') } : { credits: number(credits, '--credits') };
  }
  if (creditPrice !== undefined) entry.credit_price = number(creditPrice, '--credit-price');
  if (monthly !== undefined) entry.monthly = number(monthly, '--monthly');
  if (creditsLeft !== undefined) entry.credits_left = number(creditsLeft, '--credits-left');
  if (currency) prices.currency = currency;
  fs.writeFileSync(pricesFile(ws), YAML.stringify(prices));
  addEntry(ws, { kind: 'decision', area: 'cost', text: `Price for ${tool}: ${JSON.stringify(entry)}`, source: 'gluely', by });
  return { tool, ...entry };
}

// Strict on purpose: a misread price ends up in an estimate someone approves, so anything
// unclear is asked again. "1,000" could mean a thousand or one, so it counts as unclear.
export function parsePrice(text) {
  const value = String(text).trim().toLowerCase();
  if (value === 'free') return { each: 0 };
  const match = value.match(/^[$€£]?\s*(\d+(?:[.,]\d+)?)\s*(credits?|cr)?$/);
  if (!match || /,\d{3}$/.test(match[1])) return null;
  const amount = Number(match[1].replace(',', '.'));
  return match[2] ? { credits: amount } : { each: amount };
}

const lineCost = (units, tool, job) => {
  const price = tool?.[job];
  if (!price) return { priced: false, cost: null, credits: null };
  if (price.each !== undefined) return { priced: true, cost: units.map((u) => u * price.each), credits: null };
  const credits = units.map((u) => u * price.credits);
  const unpriced = tool.credit_price === undefined;
  return { priced: !unpriced, cost: unpriced ? null : credits.map((c) => c * tool.credit_price), credits };
};

const ASSUMPTION_FLAGS = [['fit', 'fit'], ['touches', 'touches'], ['checks', 'checks_per_month'], ['meeting-rate', 'meeting_rate']];

export function setAssumptions(ws, id, flags) {
  if (!ASSUMPTION_FLAGS.some(([flag]) => flags[flag] !== undefined)) return;
  const spec = readPlay(ws, id);
  if (!spec.playbook) fail('no_playbook', `${id} wasn't built from a playbook, so Gluely can't estimate it yet.`);
  const next = { ...spec.assumptions };
  for (const [flag, key] of ASSUMPTION_FLAGS) {
    if (flags[flag] === undefined) continue;
    const value = Number(String(flags[flag]).replace('%', '')) / (String(flags[flag]).includes('%') ? 100 : 1);
    if (!Number.isFinite(value) || value <= 0) fail('bad_assumption', `--${flag} must be a number above zero.`);
    if (['fit', 'meeting_rate'].includes(key) && value > 1) fail('bad_assumption', `--${flag} is a share, so use 0.3 or 30%.`);
    next[key] = value;
  }
  savePlay(ws, { ...spec, assumptions: next });
}

export function estimateCost(ws, id) {
  const spec = readPlay(ws, id);
  const book = spec.playbook ? getPlaybook(spec.playbook) : null;
  if (!book) fail('no_playbook', `${id} wasn't built from a playbook, so Gluely can't estimate it yet.`);
  const missing = book.steps.filter((s) => s.id !== 'budget' && s.id !== 'kill' && spec.setup?.[s.id] === undefined);
  if (missing.length) fail('play_unfinished', `${id} still needs "${missing[0].ask}"`, `Run gluely plays start ${id} to finish it.`);

  const a = { ...DEFAULT_ASSUMPTIONS, ...spec.assumptions };
  const volumeStep = book.steps.find((s) => s.id === book.cost.volume);
  const volume = spec.setup[volumeStep.id];
  const rates = volumeStep.estimate?.yearly_rate;
  const signals = rates ? rates.map((r) => (volume * r) / 12) : [volume, volume];
  const eligible = signals.map((s) => s * a.fit);
  const counts = {
    checked: [1, 1].map(() => volume * (rates ? a.checks_per_month : 1)),
    eligible,
    touches: eligible.map((e) => e * a.touches),
  };

  const prices = loadPrices(ws);
  const lines = book.cost.lines.map((line) => {
    const step = book.steps.find((s) => s.id === line.step);
    const name = spec.setup[line.step];
    const units = counts[line.count];
    return { step: line.step, label: line.label, tool: name, job: step.job, unit: line.unit, units, ...lineCost(units, prices.tools[name], step.job) };
  });

  const used = [...new Set(lines.map((l) => l.tool))];
  const fees = used.reduce((sum, name) => sum + (prices.tools[name]?.monthly || 0), 0);
  const priced = lines.filter((l) => l.priced);
  const usage = [0, 1].map((i) => priced.reduce((sum, l) => sum + l.cost[i], 0));
  const monthly = usage.map((u) => u + fees);
  const missingPrices = lines.filter((l) => !l.priced).map(({ tool, job, unit, step }) => ({ tool, job, unit, step }));
  const credits = used.map((name) => {
    const inTool = lines.filter((l) => l.tool === name && l.credits);
    if (!inTool.length) return null;
    const need = [0, 1].map((i) => inTool.reduce((sum, l) => sum + l.credits[i], 0));
    const left = prices.tools[name]?.credits_left;
    return { tool: name, monthly: need, left: left ?? null, months_left_at_most_use: left !== undefined && need[1] > 0 ? left / need[1] : null };
  }).filter(Boolean);

  const limit = spec.budget?.monthly_limit ?? null;
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify({ lines, a, fees, limit, currency: prices.currency })).digest('hex').slice(0, 12);
  const approved = spec.budget?.approved;
  let status = 'needs_approval';
  if (['killed', 'paused'].includes(spec.status)) status = 'play_stopped';
  else if (missingPrices.length) status = 'needs_prices';
  else if (limit === null) status = 'needs_budget';
  else if (monthly[1] > limit) status = 'over_budget';
  else if (approved?.fingerprint === fingerprint) status = 'approved';

  const reached = eligible[1] > 0 ? [monthly[0] / eligible[0], monthly[1] / eligible[1]] : null;
  return {
    play: id,
    currency: prices.currency,
    period: 'month',
    assumptions: a,
    guessed: Object.keys(DEFAULT_ASSUMPTIONS).filter((key) => spec.assumptions?.[key] === undefined),
    lines,
    fees,
    usage,
    monthly,
    complete: !missingPrices.length,
    missing_prices: missingPrices,
    credits,
    people_reached: eligible,
    per_person_reached: missingPrices.length ? null : reached,
    per_meeting: !missingPrices.length && a.meeting_rate ? [1, 0].map((i) => monthly[i] / (eligible[i] * a.meeting_rate)) : null,
    budget: limit,
    status,
    can_spend: status === 'approved',
    fingerprint,
    approved_by: status === 'approved' ? approved.by : null,
  };
}

// Only a person may approve, so the CLI refuses this outside a real terminal.
export function approveCost(ws, id, by) {
  const estimate = estimateCost(ws, id);
  if (estimate.status === 'play_stopped') fail('play_stopped', `${id} is stopped, so it can't be approved.`);
  if (estimate.status === 'needs_prices') fail('needs_prices', `Add a price for ${estimate.missing_prices[0].tool} first.`);
  if (estimate.status === 'needs_budget') fail('needs_budget', 'Set a monthly budget first.', `Run gluely plays answer ${id} budget <amount>.`);
  if (estimate.status === 'over_budget') fail('over_budget', 'This estimate is over budget, so it can\'t be approved.', 'Lower the volume, pick a cheaper tool, or raise the budget.');
  const spec = readPlay(ws, id);
  const at = new Date().toISOString();
  savePlay(ws, { ...spec, budget: { ...spec.budget, approved: { fingerprint: estimate.fingerprint, monthly: estimate.monthly, by, at } } });
  addEntry(ws, { kind: 'decision', area: 'cost', play: id, text: `Approved ${id} at up to ${estimate.currency}${estimate.monthly[1].toFixed(2)} a month`, by, source: 'gluely' });
  return estimateCost(ws, id);
}
