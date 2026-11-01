// Draws the loop from one list of boxes into docs/flow.excalidraw and docs/flow.svg,
// keeping Can's original layout language: blue database, yellow CRM, green work.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILL = { working: '#b2f2bb', started: '#ffec99', next: '#a5d8ff', later: '#f1f3f5', tool: '#ffffff' };

const W = 150, H = 76, X = (i) => 40 + i * 190;
const row1 = 170, row2 = 340, row3 = 500;
const box = (id, label, x, y, status, extra = {}) => ({ id, label, x, y, w: W, h: H, status, ...extra });

const nodes = [
  box('content', 'Content', X(1) + 30, 40, 'next', { w: 120, h: 60 }),
  box('inbound', 'Inbound', X(2) + 40, 40, 'later', { w: 120, h: 60 }),
  box('context', 'Context\nICP, personas,\nobjections, voice', X(0), row1, 'working'),
  box('plays', 'Plays & ideas', X(1), row1, 'working'),
  box('signals', 'Signals', X(2), row1, 'next'),
  box('excuse', 'Excuse', X(3), row1, 'started'),
  box('gate', 'Exclusion gate', X(4), row1, 'started'),
  box('enrichment', 'Enrichment\nyour tool', X(5), row1, 'tool'),
  box('outbound', 'Outbound tool\nyour tool', X(6), row1, 'tool'),
  box('replies', 'Replies', X(6), row2, 'later'),
  box('bdr', 'BDR agent', X(5), row2, 'later'),
  box('sales', 'Sales reps\nyour team', X(4), row2, 'tool'),
  box('demo', 'Demo, closing\nwon or lost', X(3), row2, 'tool'),
  box('transcripts', 'Whole transcripts\nwith consent', X(2), row2, 'later'),
  box('learning', 'Learning\nnew context\nproposed', X(1), row2, 'started'),
  box('tests', 'Brain tests\nhuman approves', X(0), row2, 'working'),
  box('database', 'DATABASE: everything is logged here. Every decision, experiment, person\nNext to build', X(0), row3, 'next', { w: 910, h: 90 }),
  box('crm', 'CRM, your tool\nsales ready, clean data', X(5), row3, 'tool', { w: 340, h: 90 }),
];

const links = [
  ['context', 'plays'], ['plays', 'signals'], ['content', 'signals'], ['inbound', 'signals'], ['signals', 'excuse'], ['excuse', 'gate'],
  ['gate', 'enrichment'], ['enrichment', 'outbound'], ['outbound', 'replies'], ['replies', 'bdr'], ['bdr', 'sales'], ['sales', 'demo'],
  ['demo', 'transcripts'], ['transcripts', 'learning'], ['learning', 'tests'], ['tests', 'context'],
  ['sales', 'database', { dashed: true, toX: 875 }], ['demo', 'database', { dashed: true, toX: 685 }], ['transcripts', 'database', { dashed: true, toX: 495 }], ['database', 'crm', { both: true, label: 'field by field' }],
];

const legend = [['working', 'Working now'], ['started', 'Started'], ['next', 'Next: phase 1'], ['later', 'Later phase'], ['tool', 'Your tool or team']];
const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));

function ends([from, to, opt = {}]) {
  const a = byId[from], b = byId[to];
  const ax = a.x + a.w / 2, ay = a.y + a.h / 2, bx = opt.toX ?? b.x + b.w / 2, by = b.y + b.h / 2;
  if (a.y + a.h <= b.y) return { x1: opt.toX ? bx : ax, y1: a.y + a.h, x2: bx, y2: b.y, opt };
  if (b.y + b.h <= a.y) return { x1: ax, y1: a.y, x2: bx, y2: b.y + b.h, opt };
  return ax < bx ? { x1: a.x + a.w, y1: ay, x2: b.x, y2: by, opt } : { x1: a.x, y1: ay, x2: b.x + b.w, y2: by, opt };
}

// Excalidraw
let seed = 1000;
const base = (type, x, y, width, height) => ({
  id: `el-${seed}`, type, x, y, width, height, angle: 0, strokeColor: '#1e1e1e', backgroundColor: 'transparent', fillStyle: 'solid',
  strokeWidth: 2, strokeStyle: 'solid', roughness: 1, opacity: 100, groupIds: [], frameId: null, roundness: { type: 3 },
  seed: seed++, version: 1, versionNonce: seed, isDeleted: false, boundElements: [], updated: 1, link: null, locked: false,
});
const text = (value, x, y, width, height, containerId = null) => ({
  ...base('text', x, y, width, height), roundness: null, text: value, originalText: value, fontSize: 16, fontFamily: 1,
  textAlign: 'center', verticalAlign: 'middle', containerId, lineHeight: 1.25, autoResize: true,
});

const elements = [];
for (const n of nodes) {
  const rect = { ...base('rectangle', n.x, n.y, n.w, n.h), backgroundColor: FILL[n.status] };
  const lines = n.label.split('\n').length;
  const label = text(n.label, n.x + 6, n.y + n.h / 2 - (lines * 20) / 2, n.w - 12, lines * 20, rect.id);
  rect.boundElements = [{ type: 'text', id: label.id }];
  elements.push(rect, label);
}
for (const link of links) {
  const { x1, y1, x2, y2, opt } = ends(link);
  elements.push({
    ...base('arrow', x1, y1, Math.abs(x2 - x1), Math.abs(y2 - y1)), roundness: null,
    strokeStyle: opt.dashed ? 'dashed' : 'solid', points: [[0, 0], [x2 - x1, y2 - y1]], lastCommittedPoint: null,
    startBinding: null, endBinding: null, startArrowhead: opt.both ? 'arrow' : null, endArrowhead: 'arrow',
  });
}
legend.forEach(([status, label], i) => {
  const x = 40 + i * 190;
  elements.push({ ...base('rectangle', x, 620, 22, 22), backgroundColor: FILL[status] });
  elements.push({ ...text(label, x + 30, 621, 150, 20), textAlign: 'left' });
});
fs.writeFileSync(path.join(ROOT, 'docs/flow.excalidraw'), `${JSON.stringify({
  type: 'excalidraw', version: 2, source: 'gluely', elements, appState: { viewBackgroundColor: '#ffffff', gridSize: null }, files: {},
}, null, 2)}\n`);

// SVG, for the README and for checking the layout by eye
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const svg = [`<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="660" viewBox="0 0 1400 660" font-family="Helvetica, Arial, sans-serif" font-size="14">`,
  '<rect width="1400" height="660" fill="#ffffff"/>',
  '<defs><marker id="a" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto-start-reverse"><path d="M0,0 L9,4.5 L0,9 z" fill="#1e1e1e"/></marker></defs>'];
for (const link of links) {
  const { x1, y1, x2, y2, opt } = ends(link);
  svg.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#1e1e1e" stroke-width="2" marker-end="url(#a)"${opt.both ? ' marker-start="url(#a)"' : ''}${opt.dashed ? ' stroke-dasharray="7 6"' : ''}/>`);
}
for (const n of nodes) {
  svg.push(`<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="12" fill="${FILL[n.status]}" stroke="#1e1e1e" stroke-width="2"/>`);
  const lines = n.label.split('\n');
  lines.forEach((l, i) => svg.push(`<text x="${n.x + n.w / 2}" y="${n.y + n.h / 2 + 5 + (i - (lines.length - 1) / 2) * 19}" text-anchor="middle">${esc(l)}</text>`));
}
legend.forEach(([status, label], i) => {
  const x = 40 + i * 190;
  svg.push(`<rect x="${x}" y="620" width="22" height="22" rx="4" fill="${FILL[status]}" stroke="#1e1e1e" stroke-width="2"/><text x="${x + 30}" y="636">${esc(label)}</text>`);
});
svg.push('</svg>');
fs.writeFileSync(path.join(ROOT, 'docs/flow.svg'), `${svg.join('\n')}\n`);
