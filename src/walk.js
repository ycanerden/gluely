// The human walkthrough for a play: one question at a time, and always resumable, because
// each answer is saved before the next question appears.
import { approveCost, estimateCost, loadPrices, parsePrice, setPrice } from './cost.js';
import { loadPlaybooks } from './library.js';
import { color, fail, mark } from './output.js';
import { answerStep, startPlay } from './playbooks.js';
import { ask, progress, retrying, say, select } from './ui.js';

const nice = (n) => (n >= 100 ? Math.round(n).toLocaleString('en') : String(Math.round(n * 10) / 10));
const range = ([low, high]) => (Math.abs(low - high) < 0.05 ? nice(low) : `${nice(low)} to ${nice(high)}`);
const money = (currency, n) => `${currency}${n >= 100 ? Math.round(n).toLocaleString('en') : n.toFixed(2)}`;
const moneyRange = (currency, [low, high]) => (Math.abs(low - high) < 0.005 ? money(currency, low) : `${money(currency, low)} to ${money(currency, high)}`);
const percent = (n) => `${Math.round(n * 1000) / 10}%`;

export async function pickPlaybook() {
  const books = loadPlaybooks();
  say(color.bold('Which play do you want to set up?'));
  say(color.dim('Each one is a starting point. You choose the tools at every step.'));
  say();
  const row = await select({ options: books.map((b) => ({ label: b.name, hint: b.summary, value: b.id })) });
  say();
  return row.value;
}

async function answerFor(step) {
  say(color.bold(step.ask));
  say(color.dim(step.why));
  if (step.pattern) say(`${color.dim('Your pattern:')} ${step.pattern}`);
  if (step.never?.length) say(`${color.dim('Never:')} ${step.never.join(', ')}`);
  say();
  if (!step.options?.length) return ask(step.type === 'number' ? 'Number: ' : 'Your answer: ');
  const toolOther = step.waterfall ? 'Something else, or a waterfall' : 'Something else';
  const other = step.type === 'tool' ? toolOther : step.type === 'kill' ? null : 'Write my own';
  const row = await select({ options: step.options, other });
  if (!row.other) return row.value;
  return ask(step.waterfall ? `Tools to try, in order, with commas: ${color.dim('(or just one)')} ` : 'Your answer: ');
}

function showResult(result) {
  const { estimate, added_to_stack: added, warning } = result;
  if (estimate) {
    say(`${mark.next()} That is about ${color.bold(`${estimate.low} to ${estimate.high} moves a month`)}, before your ICP filter.`);
    say(color.dim(`Assumes ${estimate.assumption}.`));
    if (estimate.warning) say(`${mark.warn()} ${estimate.warning}`);
  }
  if (added) say(color.dim(`Added ${added.tool} to your stack under ${added.label}.`));
  if (warning) say(`${mark.warn()} ${warning}`);
}

export async function walkPlay(ws, playbookId, id) {
  let state = startPlay(ws, playbookId, id);
  say(`${color.bold(state.name)}${color.dim(`   saved after each step, Ctrl-C to stop and resume later`)}`);
  say();
  while (!state.done) {
    say(progress(state.number, state.total));
    const { step } = state;
    const result = await retrying(async () => answerStep(ws, id, step.id, await answerFor(step), 'human'));
    showResult(result);
    say();
    state = result.next;
  }
  say(`${mark.ok()} ${color.bold(`plays/${id}.yaml`)} is ready as a draft.`);
  say();
  await costFlow(ws, id);
}

export function renderCost(estimate) {
  const { currency: c } = estimate;
  const rows = estimate.lines.map((line) => [line.label, line.tool, `${range(line.units)} ${line.unit}s`, line.cost ? moneyRange(c, line.cost) : 'no price yet']);
  const widths = [0, 1, 2].map((i) => Math.max(...rows.map((r) => r[i].length)));
  say(`${color.bold(`Cost check: ${estimate.play}`)}${color.dim('   per month, an estimate')}`);
  say();
  for (const r of rows) {
    const value = r[3] === 'no price yet' ? color.yellow(r[3]) : r[3];
    say(`${r[0].padEnd(widths[0])}  ${color.dim(r[1].padEnd(widths[1]))}  ${r[2].padEnd(widths[2])}  ${value}`);
  }
  if (estimate.fees) say(`${'Monthly tool fees'.padEnd(widths[0])}  ${color.dim('counted in full, even if other plays share the tool')}  ${money(c, estimate.fees)}`);
  say();
  const prefix = estimate.complete ? '' : 'at least ';
  say(`${color.bold('Total')}          ${color.bold(prefix + moneyRange(c, estimate.monthly))}`);
  say(`${'People reached'.padEnd(14)} ${range(estimate.people_reached)}`);
  if (estimate.per_person_reached) say(`${'Per person'.padEnd(14)} ${moneyRange(c, [Math.min(...estimate.per_person_reached), Math.max(...estimate.per_person_reached)])}`);
  if (estimate.per_meeting) say(`${'Per meeting'.padEnd(14)} ${moneyRange(c, [Math.min(...estimate.per_meeting), Math.max(...estimate.per_meeting)])}`);
  for (const credit of estimate.credits) {
    const left = credit.left === null ? '' : `, ${nice(credit.left)} left, so about ${Math.floor(credit.months_left_at_most_use)} months at the high end`;
    say(`${credit.tool} credits  ${range(credit.monthly)} a month${left}`);
  }
  const a = estimate.assumptions;
  const guessed = estimate.guessed.length ? ' These are starting guesses until you have real numbers.' : '';
  const tries = estimate.waterfall ? ` Each waterfall provider finds ${percent(a.hit_rate)}, and every try is billed.` : '';
  say(color.dim(`Assumes ${percent(a.fit)} fit your ICP, ${a.touches} touches each, ${a.checks_per_month} check a month.${tries}${guessed}`));
  for (const warning of estimate.warnings) say(`${mark.warn()} ${warning.message}`);
  say();
  const verdict = {
    play_stopped: () => `${mark.bad()} This play is stopped, so nothing can be spent on it.`,
    needs_prices: () => `${mark.warn()} Not ready: ${estimate.missing_prices.map((m) => m.tool).join(', ')} still ${estimate.missing_prices.length > 1 ? 'need prices' : 'needs a price'}.`,
    needs_budget: () => `${mark.warn()} Not ready: this play has no monthly budget.`,
    over_budget: () => `${mark.bad()} Over budget: the high end is ${money(c, estimate.monthly[1])} and your limit is ${money(c, estimate.budget)}.`,
    needs_approval: () => `${mark.next()} Within your ${money(c, estimate.budget)} limit. A person needs to approve it before anything spends credits.`,
    approved: () => `${mark.ok()} Approved by ${estimate.approved_by}. Credits can be spent up to this estimate.`,
  };
  say(verdict[estimate.status]());
}

async function askPrice(ws, { tool, job, unit }) {
  await retrying(async () => {
    const answer = await ask(`What does one ${unit} cost in ${tool}? ${color.dim('(0.02, 3 credits, free)')} `);
    const price = parsePrice(answer);
    if (!price) fail('bad_price', 'Answer with an amount, like 0.02, 3 credits or free.');
    return setPrice(ws, { tool, job, ...price });
  });
  const entry = loadPrices(ws).tools[tool];
  if (entry[job].credits !== undefined) {
    if (entry.credit_price === undefined) {
      await retrying(async () => setPrice(ws, { tool, creditPrice: await ask(`What does one ${tool} credit cost in money? `) }));
    }
    if (entry.credits_left === undefined) {
      const left = await ask(`How many ${tool} credits do you have left? ${color.dim('(Enter to skip)')} `);
      if (left) await retrying(async () => setPrice(ws, { tool, creditsLeft: left.replace(/[, ]/g, '') }));
    }
  }
}

export async function costFlow(ws, id) {
  let estimate = estimateCost(ws, id);
  if (estimate.missing_prices.length) {
    say(color.bold('Before you spend anything, what do these tools cost you?'));
    say(color.dim('Your prices stay in your workspace. Gluely ships none, because they go out of date.'));
    say();
    for (const missing of estimate.missing_prices) {
      const again = estimateCost(ws, id).missing_prices.some((m) => m.tool === missing.tool && m.job === missing.job);
      if (again) await askPrice(ws, missing);
    }
    say();
    estimate = estimateCost(ws, id);
  }
  renderCost(estimate);
  if (estimate.status === 'needs_approval') {
    say();
    const row = await select({ options: [{ label: 'Approve this budget', value: 'yes' }, { label: 'Not yet', value: 'no' }] });
    if (row.value === 'yes') {
      estimate = approveCost(ws, id, 'human');
      say(`${mark.ok()} Saved to the decision log. If a price or the volume changes, it needs approving again.`);
    }
  }
  return estimate;
}

export async function confirmApproval(ws, id) {
  renderCost(estimateCost(ws, id));
  say();
  const answer = await ask('Type yes to approve: ');
  if (answer.toLowerCase() !== 'yes') { say('Not approved.'); return estimateCost(ws, id); }
  return approveCost(ws, id, 'human');
}

