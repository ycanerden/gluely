// Draws docs/architecture.svg: who thinks, who remembers and checks, where the data lives,
// and where your tools sit. Same pixel world as site/index.html. Run: node scripts/architecture.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const font = (file) => fs.readFileSync(path.join(ROOT, 'site/fonts', file)).toString('base64');

const C = {
  sky: '#4a58cf', mid: '#35268c', deep: '#1f1554', ink: '#1c1636', term: '#120c2e', milk: '#fff4d6', shade: '#e8d6a6',
  dim: '#cfc7f0', line: '#7d70c9', honey: '#ffb42e', honeyDark: '#d4851a', coral: '#ff5a6e', coralDark: '#c93a5a',
  mint: '#56dfa0', mintDark: '#2fa877', blue: '#8fc7ff', blueDark: '#5a8fd8', plum: '#b77bff', plumDark: '#8350cf',
};
const W = 1400, H = 950, LEFT = 120, RIGHT = 880, TOWER = 1050, TOWER_W = 300;
const BANDS = [
  { y: 0, h: 250, fill: C.sky },
  { y: 250, h: 350, fill: C.mid },
  { y: 600, h: 350, fill: C.deep },
];

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const out = [];
const rect = (x, y, w, h, fill, extra = '') => out.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"${extra}/>`);
const text = (x, y, s, { size = 22, fill = C.milk, face = 'body', anchor = 'start', weight = 400 } = {}) =>
  out.push(`<text x="${x}" y="${y}" font-family="${face === 'display' ? "'Jersey 20', monospace" : "'Atkinson', Helvetica, Arial, sans-serif"}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${esc(s)}</text>`);
// Jersey 20 is narrow: about 0.42 of its size per character.
const chipWidth = (label, size) => Math.round(label.length * size * 0.42 + 24);

function chip(x, y, label, { fill = C.milk, size = 26 } = {}) {
  const w = chipWidth(label, size), h = size + 14;
  rect(x + 4, y + 4, w, h, C.ink);
  rect(x, y, w, h, fill);
  text(x + w / 2, y + h / 2 + size * 0.34, label, { size, fill: C.ink, face: 'display', anchor: 'middle' });
  return w;
}

function panel(x, y, w, h, title) {
  rect(x, y, w, h, C.term);
  rect(x, y, w, 4, C.line);
  text(x + 22, y + 44, title, { size: 30, face: 'display' });
}

function brick(x, y, w, h, label, fill, edge) {
  rect(x - 4, y - 4, w + 8, h + 8, C.ink);
  rect(x, y, w, h, fill);
  rect(x, y, w, 4, C.milk, ' opacity="0.7"');
  rect(x, y + h - 8, w, 8, edge);
  text(x + w / 2, y + h / 2 + 8, label, { size: 30, fill: C.ink, face: 'display', anchor: 'middle' });
}

function folder(x, y, name, note, { next = false } = {}) {
  const w = 240, h = 84;
  if (next) {
    out.push(`<rect x="${x + 2}" y="${y + 2}" width="${w - 4}" height="${h - 4}" fill="none" stroke="${C.line}" stroke-width="4" stroke-dasharray="12 8"/>`);
    text(x + 18, y + 38, name, { size: 30, face: 'display', fill: C.dim });
    text(x + 18, y + 66, note, { size: 19, fill: C.dim });
    return;
  }
  rect(x + 4, y + 4, w, h, C.honey);
  rect(x, y, w, h, C.milk);
  text(x + 18, y + 38, name, { size: 30, face: 'display', fill: C.ink });
  text(x + 18, y + 66, note, { size: 19, fill: C.ink });
}

// A pixel arrow: square shaft, stepped head.
function arrow(points, { color = C.milk, head = 'end', both = false } = {}) {
  const d = points.map(([x, y], i) => `${i ? 'L' : 'M'}${x},${y}`).join(' ');
  out.push(`<path d="${d}" fill="none" stroke="${C.ink}" stroke-width="10" stroke-linejoin="miter"/>`);
  out.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="4" stroke-linejoin="miter"/>`);
  const tip = (to, from) => {
    const [x, y] = to, [fx, fy] = from;
    const dx = Math.sign(x - fx), dy = Math.sign(y - fy);
    const s = 12;
    const pts = dx ? [[x, y], [x - dx * s, y - s], [x - dx * s, y + s]] : [[x, y], [x - s, y - dy * s], [x + s, y - dy * s]];
    out.push(`<polygon points="${pts.map((p) => p.join(',')).join(' ')}" fill="${color}" stroke="${C.ink}" stroke-width="3"/>`);
  };
  if (head === 'end' || both) tip(points.at(-1), points.at(-2));
  if (both) tip(points[0], points[1]);
}

// Strata, each with a stepped pixel edge into the next one
BANDS.forEach((b, i) => {
  rect(0, b.y, W, b.h, b.fill);
  const next = BANDS[i + 1];
  if (!next) return;
  for (let x = 0; x < W; x += 32) {
    rect(x, b.y + b.h, 32, 8, b.fill);
    rect(x + 8, b.y + b.h + 8, 8, 8, b.fill);
  }
});

// The glue line, with a bead at each layer
rect(52, 0, 22, H, C.ink);
rect(56, 0, 14, H, C.milk);
for (const y of [52, 302, 652]) { rect(40, y, 46, 30, C.ink); rect(44, y + 4, 38, 22, C.milk); }

// 1. Your agent thinks
text(LEFT, 84, 'Your agent thinks', { size: 52, face: 'display' });
text(LEFT, 124, 'Reads the skills, asks the brain and writes the drafts.', { size: 23 });
text(LEFT, 154, 'It runs your tools only after a person approves.', { size: 23 });
let x = LEFT;
for (const name of ['Claude Code', 'Cursor', 'Codex', 'Grok', 'yours']) x += chip(x, 180, name) + 14;

// 2. Gluely remembers and checks
text(LEFT, 334, 'Gluely remembers and checks', { size: 52, face: 'display' });
text(LEFT, 372, 'Open source. It never calls a model, and nothing goes out without your yes.', { size: 23 });
panel(LEFT, 398, 290, 170, 'Skills');
['/setup-gluely', '/gtm-mode', '/check-cost', '/waterfall'].forEach((name, i) => text(LEFT + 22 + (i % 2) * 140, 486 + Math.floor(i / 2) * 40, name, { size: 21 }));
const CLI = LEFT + 310;
panel(CLI, 398, RIGHT - CLI, 170, 'CLI');
[[['guard', true], ['cost', true], ['check'], ['plays']], [['results'], ['test'], ['learn'], ['recall']]].forEach((row, r) => {
  x = CLI + 22;
  for (const [name, gate] of row) x += chip(x, 462 + r * 50, name, { size: 22, fill: gate ? C.honey : C.milk }) + 10;
});
text(RIGHT - 22, 440, 'guard and cost are the gates', { size: 19, anchor: 'end', fill: C.honey });

// 3. Your brain stays yours
text(LEFT, 690, 'Your brain stays yours', { size: 52, face: 'display' });
text(LEFT, 728, 'A private git repo on your machine. Gluely has no servers.', { size: 23 });
const folders = [
  ['context/', 'ICP, personas, voice, proof'], ['plays/', 'bets with kill rules'], ['tests/', 'every correction'],
  ['learning/', 'decisions and edits'], ['prices.yaml', 'your own prices'], ['database', 'Person 360. Next', true],
];
folders.forEach(([name, note, next], i) => folder(LEFT + (i % 3) * 260, 752 + Math.floor(i / 3) * 100, name, note, { next }));

// Between the layers
arrow([[RIGHT - 70, 214], [RIGHT - 70, 290]], { both: true });
text(RIGHT - 92, 246, 'asks, then', { size: 20, anchor: 'end' });
text(RIGHT - 92, 270, 'Gluely checks', { size: 20, anchor: 'end' });
arrow([[RIGHT - 70, 582], [RIGHT - 70, 662]], { both: true });
text(RIGHT - 92, 618, 'reads the rules,', { size: 20, anchor: 'end' });
text(RIGHT - 92, 642, 'writes the lessons', { size: 20, anchor: 'end' });

// Your tools do the work
text(TOWER, 74, 'Your tools', { size: 44, face: 'display' });
text(TOWER, 112, 'do the work', { size: 44, face: 'display' });
const tools = [
  ['Signals', C.coral, C.coralDark], ['Enrichment', C.honey, C.honeyDark], ['Outreach', C.mint, C.mintDark],
  ['CRM', C.blue, C.blueDark], ['Data store', C.plum, C.plumDark], ['Transcripts', C.milk, C.shade],
];
const BRICK_H = 58, SEAM = 14, TOP = 150;
tools.forEach(([label, fill, edge], i) => {
  const y = TOP + i * (BRICK_H + SEAM);
  brick(TOWER, y, TOWER_W, BRICK_H, label, fill, edge);
  if (i) { // glue squeezed out between two bricks
    rect(TOWER - 10, y - SEAM + 1, TOWER_W + 20, SEAM - 2, C.ink);
    rect(TOWER - 6, y - SEAM + 4, TOWER_W + 12, SEAM - 8, C.milk);
  }
});
const towerBottom = TOP + tools.length * (BRICK_H + SEAM) - SEAM;
text(TOWER + TOWER_W / 2, towerBottom + 44, 'Any tool, at any step.', { size: 21, anchor: 'middle' });

// Agent runs the tools, after approval
arrow([[RIGHT + 14, 200], [TOWER - 18, 200]]);
text((RIGHT + TOWER) / 2, 176, 'runs them', { size: 19, anchor: 'middle' });
arrow([[RIGHT + 14, 462], [TOWER - 18, 462]], { color: C.honey });
text((RIGHT + TOWER) / 2, 436, 'only cleared', { size: 19, anchor: 'middle', fill: C.honey });
text((RIGHT + TOWER) / 2, 496, 'lists and spend', { size: 19, anchor: 'middle', fill: C.honey });

// The loop: outcomes come back into the brain
const loopX = TOWER + TOWER_W / 2;
arrow([[loopX, towerBottom + 66], [loopX, 794], [RIGHT + 18, 794]]);
text(loopX - 20, 728, 'results and corrections', { size: 20, anchor: 'end' });
text(loopX - 20, 754, 'come back as lessons', { size: 20, anchor: 'end' });

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" shape-rendering="crispEdges" role="img" aria-labelledby="t">
<title id="t">Gluely architecture: your agent thinks, Gluely remembers and checks, your brain stays in your own repo, and your tools do the work.</title>
<style>
@font-face { font-family: 'Jersey 20'; src: url(data:font/woff2;base64,${font('jersey20.woff2')}) format('woff2'); }
@font-face { font-family: 'Atkinson'; src: url(data:font/woff2;base64,${font('atkinson.woff2')}) format('woff2'); font-weight: 200 800; }
text { shape-rendering: auto; }
</style>
${out.join('\n')}
</svg>
`;
fs.writeFileSync(path.join(ROOT, 'docs/architecture.svg'), svg);
console.log(`docs/architecture.svg ${Math.round(svg.length / 1024)} KB`);
