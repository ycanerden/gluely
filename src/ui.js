// The terminal front end. It only draws and asks: every answer goes through the same
// functions agents use with --json, so humans and agents can't drift apart.
import readline from 'node:readline';
import { color, GluelyError, mark } from './output.js';

export const interactive = () => Boolean(process.stdin.isTTY && process.stdout.isTTY);
const rich = () => process.stdout.isTTY && !process.env.NO_COLOR;

export class Cancelled extends Error {}

const SPRITE = [
  '........kkkk........',
  '.......koooOk.......',
  '.......koooOk.......',
  '......kkkkkkkk......',
  '.....kooooooOOk.....',
  '.....kkkkkkkkkk.....',
  '....kmmmmmmmmmmk....',
  '...kmmmmmmmmmmmmk...',
  '..kmmmmmmmmmmmmmmk..',
  '..kmmkkmmmmmmkkmmk..',
  '.kmmmkwmmmmmmkwmmmk.',
  '.kmmmkkmmmmmmkkmmsk.',
  '.kmmmkkmmmmmmkkmmsk.',
  '.kmrrmmmkmmkmmmrrsk.',
  '.kmmmmmmmkkmmmmsssk.',
  '.ksmmmmmmmmmmmssssk.',
  '..kssssssssssssssk..',
  '...kkkkkkkkkkkkkk...',
];
const RGB = { k: [28, 22, 54], o: [255, 180, 46], O: [212, 133, 26], m: [255, 244, 214], s: [232, 214, 166], w: [255, 255, 255], r: [255, 154, 168] };

// Two pixels per character cell, using the half block, so pixels stay square.
export function mascot() {
  if (!rich()) return [];
  const rows = [];
  for (let y = 0; y < SPRITE.length; y += 2) {
    let row = '';
    for (let x = 0; x < SPRITE[0].length; x++) {
      const top = RGB[SPRITE[y][x]];
      const bottom = RGB[SPRITE[y + 1]?.[x]];
      if (!top && !bottom) row += ' ';
      else if (top && bottom) row += `\x1b[38;2;${top}m\x1b[48;2;${bottom}m▀\x1b[0m`.replaceAll(',', ';');
      else if (top) row += `\x1b[38;2;${top}m▀\x1b[0m`.replaceAll(',', ';');
      else row += `\x1b[38;2;${bottom}m▄\x1b[0m`.replaceAll(',', ';');
    }
    rows.push(row);
  }
  return rows;
}

export function beside(left, right, gap = '   ') {
  const blank = ' '.repeat(left.length ? SPRITE[0].length : 0);
  const rows = Math.max(left.length, right.length);
  const output = [];
  for (let i = 0; i < rows; i++) output.push(`${left.length ? `  ${left[i] ?? blank}${gap}` : ''}${right[i] ?? ''}`.trimEnd());
  return output.join('\n');
}

export function progress(number, total) {
  const done = Math.round((number / total) * 20);
  return `${color.yellow('█'.repeat(done))}${color.dim('░'.repeat(20 - done))} ${color.dim(`step ${number} of ${total}`)}`;
}

export const ask = (prompt) => new Promise((resolve, reject) => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.on('SIGINT', () => { rl.close(); reject(new Cancelled()); });
  rl.question(`  ${color.cyan('›')} ${prompt}`, (answer) => { rl.close(); resolve(answer.trim()); });
});

// Arrow keys, or the number on the row. Long lists scroll, and "other" takes free text.
export function select({ options, other, height = 9 }) {
  const rows = other ? [...options, { label: other, other: true }] : options;
  return new Promise((resolve, reject) => {
    let at = 0;
    let top = 0;
    let drawn = 0;
    const out = process.stdout;
    const labelWidth = Math.max(...rows.map((r) => r.label.length));

    const draw = () => {
      if (drawn) out.write(`\x1b[${drawn}A\r`);
      out.write('\x1b[J');
      top = Math.min(Math.max(top, at - height + 1), at);
      const shown = rows.slice(top, top + height);
      const lines = shown.map((row, i) => {
        const index = top + i;
        const here = index === at;
        const pointer = here ? color.yellow('▶') : ' ';
        const name = (here ? color.bold : (s) => s)(row.label.padEnd(labelWidth));
        const tag = row.yours ? color.green(' yours') : '';
        const hint = row.hint && out.columns > 70 ? color.dim(`  ${row.hint}`.slice(0, Math.max(0, out.columns - labelWidth - 16))) : '';
        return `  ${pointer} ${color.dim(String(index + 1).padStart(2))} ${name}${tag}${hint}`;
      });
      if (rows.length > height) lines.push(color.dim(`     ${top + shown.length} of ${rows.length}, ↑↓ for more`));
      out.write(`${lines.join('\n')}\n`);
      drawn = lines.length;
    };

    const finish = (done) => {
      process.stdin.removeListener('keypress', onKey);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      out.write(`\x1b[${drawn}A\r\x1b[J\x1b[?25h`);
      done();
    };
    const pick = (row) => finish(() => {
      if (!row.other) out.write(`  ${mark.ok()} ${row.label}\n`);
      resolve(row);
    });

    function onKey(text, key = {}) {
      if (key.ctrl && key.name === 'c') { finish(() => reject(new Cancelled())); return; }
      if (key.name === 'up' || key.name === 'k') at = (at - 1 + rows.length) % rows.length;
      else if (key.name === 'down' || key.name === 'j') at = (at + 1) % rows.length;
      else if (key.name === 'return') { pick(rows[at]); return; }
      else if (/^[1-9]$/.test(text || '') && rows[Number(text) - 1]) { pick(rows[Number(text) - 1]); return; }
      draw();
    }

    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('keypress', onKey);
    out.write('\x1b[?25l');
    draw();
  });
}

export const say = (text = '') => console.log(text ? `  ${text}` : '');

// Bad answers ask again instead of ending the walkthrough.
export async function retrying(attempt) {
  for (;;) {
    try { return await attempt(); } catch (error) {
      if (!(error instanceof GluelyError)) throw error;
      say(`${mark.bad()} ${error.message}${error.hint ? ` ${error.hint}` : ''}`);
    }
  }
}
