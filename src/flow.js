// The loop from the founder's drawing, drawn from real state. Status is computed where
// it can be, so this diagram can't claim something works when it doesn't.
import { color } from './output.js';

const ICONS = { working: '●', started: '◐', later: '○', tool: '▢' };
const PAINT = { working: color.green, started: color.yellow, later: color.dim, tool: color.cyan };

export function buildFlow(state) {
  const { context, plays, tests, stack } = state;
  const yours = (layer, fallback) => (stack[layer] ? `${stack[layer]}, your choice` : fallback);
  const filled = context.confirmed + context.draft;
  const stage = (id, label, status, detail) => ({ id, label, status, detail });
  return {
    context_version: state.context_version,
    stages: [
      stage('context', 'Context', filled ? 'working' : 'started', `${filled}/${context.total} files filled, ${context.personas} personas`),
      stage('plays', 'Plays and ideas', plays.length ? 'working' : 'started', `${plays.length} plays, ${plays.filter((p) => p.status === 'active').length} active`),
      stage('signals', 'Signals', 'later', 'content, inbound, job switch. Phase 1'),
      stage('excuse', 'Excuse', 'started', 'rules and draft check work. Link to signals in phase 2'),
      stage('gate', 'Exclusion gate', 'started', `${context.excluded_companies} companies excluded. Full gate in phase 1`),
      stage('enrichment', 'Enrichment', 'tool', yours('enrichment', 'any tool you like')),
      stage('outbound', 'Outbound tool', 'tool', `${yours('outreach', 'any tool you like')}. Gluely never sends`),
      stage('database', 'Database', 'later', `Person 360 in ${stack.store || 'any store'}. Phase 1`),
      stage('crm', 'CRM', 'tool', `${yours('crm', 'any CRM')}. Sales-ready sync in phase 4`),
      stage('replies', 'Replies', 'later', 'opt-outs in phase 2, labels in phase 3'),
      stage('bdr', 'BDR agent', 'later', 'reply to demo. Phase 3'),
      stage('sales', 'Sales reps, demo, close', 'tool', 'won and lost tracked in phase 4'),
      stage('transcripts', 'Transcripts', 'later', `${stack.transcripts ? `${stack.transcripts}, ` : ''}with consent. Phase 4`),
      stage('learning', 'Learning', 'started', `${tests.deterministic.total + tests.reasoned.total} brain tests. Corrections become tests`),
    ],
  };
}

export function renderFlow(flow, company) {
  const lines = [];
  const width = Math.max(...flow.stages.map((s) => s.label.length));
  lines.push(color.bold(`Gluely loop: ${company || 'workspace'}`) + color.dim(`   context ${flow.context_version}`));
  lines.push('');
  lines.push(color.dim('  ┌─────────────▶ ') + renderStage(flow.stages[0], width));
  for (const item of flow.stages.slice(1)) {
    lines.push(color.dim('  │               │'));
    lines.push(color.dim('  │               ▼'));
    lines.push(color.dim('  │             ') + '  ' + renderStage(item, width));
  }
  lines.push(color.dim('  │               │'));
  lines.push(color.dim('  └── human approves, tests pass ◀─┘'));
  lines.push('');
  lines.push(`  ${paint('working')} working   ${paint('started')} started   ${paint('later')} later   ${paint('tool')} your tool`);
  return lines.join('\n');
}

const paint = (status) => PAINT[status](ICONS[status]);

function renderStage(item, width) {
  return `${paint(item.status)} ${item.label.padEnd(width)}  ${color.dim(item.detail)}`;
}
