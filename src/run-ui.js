// Draws runs for people. It only draws and asks: every decision lives in run.js.
import { color, mark } from './output.js';
import { approveRun, pendingApproval } from './run.js';
import { ask, say } from './ui.js';

const money = (v, c) => (v === null || v === undefined ? '?' : `${c}${c.length > 1 ? ' ' : ''}${v < 1 && v > 0 ? v.toFixed(3) : v.toFixed(2)}`);
const ICON = { guard: '◆', filter: '▽', tool: '●', agent: '✎', approve: '✔', branch: '◇', set: '=', stop: '■' };
const pad = (depth) => '   '.repeat(depth || 0);

export function renderPlan(data) {
  console.log(color.bold(`Plan: ${data.play}`) + color.dim(`   ${data.rows ?? '?'} rows${data.input ? ` from ${data.input}` : ''}`));
  for (const step of data.steps) {
    const lines = data.lines.filter((l) => l.step === step.id);
    const cost = lines.length ? lines.map((l) => `${l.tool} ${money(l.each, data.currency)} each`).join(', then ') : '';
    console.log(`  ${pad(step.depth)}${ICON[step.type]} ${step.id.padEnd(16 - 3 * (step.depth || 0))} ${color.dim(step.type.padEnd(8))}${step.sends ? color.yellow('sends  ') : ''}${color.dim(cost)}`);
  }
  if (data.ceiling !== null) console.log(`\n  At most ${money(data.ceiling, data.currency)}${data.budget !== null ? color.dim(`, with ${money(data.spent_this_month, data.currency)} of ${money(data.budget, data.currency)} spent this month`) : ''}`);
  for (const issue of data.issues) console.log(`  ${mark.bad()} ${issue.step ? `${issue.step}: ` : ''}${issue.message}`);
  for (const key of data.missing_keys) console.log(`  ${mark.bad()} ${key} is not in .env`);
  for (const p of data.missing_prices) console.log(`  ${mark.bad()} no price for ${p.tool} (${p.job}): gluely cost price "${p.tool}" --job ${p.job} --each <amount>`);
  const ok = ['ready', 'needs_approval'].includes(data.status);
  console.log(`\n${ok ? mark.ok() : mark.bad()} ${data.status.replace(/_/g, ' ')}`);
}

export function renderRun(data) {
  console.log(color.bold(`${data.id}  ${data.play}`) + color.dim(`   ${data.status.replace(/_/g, ' ')}, ${data.live}/${data.rows} rows, ${money(data.spent, data.currency)} spent${data.ceiling ? ` of ${money(data.ceiling, data.currency)}` : ''}`));
  for (const t of data.trace || []) {
    const here = t.step === data.at_step;
    const detail = [t.reached ? `${t.in} in` : 'not reached', t.stopped ? `${t.stopped} stopped` : '', t.calls ? `${t.calls} calls` : '', t.cost ? money(t.cost, data.currency) : '', t.errors ? color.red(`${t.errors} errors`) : ''].filter(Boolean).join(', ');
    console.log(`  ${pad(t.depth)}${here ? color.cyan('▶') : ICON[t.type]} ${t.step.padEnd(Math.max(4, 16 - 3 * (t.depth || 0)))} ${color.dim(detail)}`);
  }
  console.log(`${mark.next()} ${data.next}`);
}

export async function confirmRunApproval(ws, id, reject) {
  const pending = pendingApproval(ws, id);
  if (pending.kind === 'spend') {
    renderPlan(pending.plan);
    say();
    say(`This run may spend up to ${money(pending.ceiling, pending.currency)} on ${pending.rows} rows. It stops at that ceiling.`);
  } else {
    console.log(color.bold(`${pending.step}: ${pending.rows.length} rows to approve`));
    for (const r of pending.rows) {
      const shown = (pending.show.length ? pending.show : Object.keys(r.data).slice(0, 3)).map((k) => `${color.dim(`${k}:`)} ${r.data[k] ?? ''}`).join('  ');
      console.log(`  ${String(r.row).padStart(3)}${reject.includes(String(r.row)) ? color.red(' rejected') : ''}  ${shown}`);
    }
  }
  say();
  const answer = await ask('Type yes to approve: ');
  if (answer.toLowerCase() !== 'yes') { say('Not approved.'); return null; }
  return approveRun(ws, id, { by: 'human', reject });
}
