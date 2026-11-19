import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { fail } from './output.js';

export const GLUELY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function findWorkspace(start = process.cwd()) {
  let dir = path.resolve(start);
  while (true) {
    if (fs.existsSync(path.join(dir, 'workspace.yaml'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function requireWorkspace() {
  const ws = process.env.GLUELY_WORKSPACE || findWorkspace();
  if (!ws) {
    fail('no_workspace', 'No workspace.yaml here or in a parent folder.', 'Run `gluely init <dir>`, or cd into your workspace.');
  }
  return path.resolve(ws);
}

export function loadConfig(ws) {
  const cfg = YAML.parse(fs.readFileSync(path.join(ws, 'workspace.yaml'), 'utf8')) || {};
  cfg.company ||= {};
  cfg.extensions ||= {};
  cfg.extensions.signals ||= [];
  return cfg;
}

export function git(ws, args) {
  try {
    return execFileSync('git', args, { cwd: ws, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return null;
  }
}

// The version stamped on everything the brain produces. A dirty context never
// pretends to be the committed one, or the numbers would lie about what was live.
export function contextVersion(ws) {
  const sha = git(ws, ['log', '-1', '--format=%h', '--', 'context/']);
  if (!sha) return { version: 'uncommitted', dirty: true };
  const dirty = Boolean(git(ws, ['status', '--porcelain', '--', 'context/']));
  return { version: dirty ? `${sha}-dirty` : sha, dirty };
}

export function readFrontmatter(file) {
  const text = fs.readFileSync(file, 'utf8');
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { data: null, body: text };
  try {
    return { data: YAML.parse(match[1]) || {}, body: text.slice(match[0].length) };
  } catch (error) {
    return { data: null, body: text, error: error.message };
  }
}

// Reads a CSV and says when it can't be trusted. A quote only opens a cell at its start,
// so `5" pipe` stays one cell. A quoted cell that runs over a line break, or never closes,
// is reported in `problems`: that is how one stray quote swallows the rows after it, and
// the gate must refuse such a file instead of sorting what is left.
export function parseCsv(text) {
  const records = [];
  const problems = [];
  const src = String(text).replace(/^\uFEFF/, '');
  let cells = [];
  let cell = '';
  let quoted = false;
  let closed = false;
  let line = 1;
  let start = 1;
  const endCell = () => { cells.push(cell); cell = ''; closed = false; };
  const endRecord = () => {
    endCell();
    if (line > start) problems.push({ line: start, message: `the row on line ${start} has a quoted cell that runs over a line break, so the rows after it may be swallowed` });
    records.push({ cells, line: start });
    cells = [];
  };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') { quoted = false; closed = true; }
      else { if (ch === '\n') line++; cell += ch; }
    } else if (ch === '"' && cell === '' && !closed) quoted = true;
    else if (ch === ',') endCell();
    else if (ch === '\n') { endRecord(); line++; start = line; }
    else if (ch !== '\r') cell += ch;
  }
  if (quoted) problems.push({ line: start, message: `a quote opened on line ${start} never closes, so everything after it was read as one cell` });
  if (cell || cells.length || closed || quoted) { line = start; endRecord(); }

  const [head, ...body] = records.filter((r) => r.cells.some((c) => c.trim()));
  // Two columns with one name would overwrite each other, so the later ones get a number.
  const seen = new Map();
  const keys = (head?.cells || []).map((h) => {
    const key = h.trim().toLowerCase();
    const count = (seen.get(key) || 0) + 1;
    seen.set(key, count);
    return count > 1 ? `${key}_${count}` : key;
  });
  return {
    header: keys,
    rows: body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r.cells[i] ?? '').trim()]))),
    lines: body.map((r) => r.line),
    // Rows with more cells than the header: an unquoted comma shifted their columns.
    overflow: body.filter((r) => r.cells.slice(keys.length).some((c) => c.trim())).map((r) => r.line),
    problems,
  };
}

// The host of a URL, an email or a bare domain: "https://www.Acme.com:443/pricing?x" is acme.com.
export const normalizeDomain = (value) => String(value || '').trim().toLowerCase()
  .replace(/^mailto:/, '').replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/[/?#].*$/, '')
  .replace(/^.*@/, '').replace(/:\d+$/, '').replace(/^www\d*\./, '').replace(/\.+$/, '');

const EMPTY_CSV = { header: [], rows: [], lines: [], overflow: [], problems: [] };

export function loadExclusions(ws) {
  const file = path.join(ws, 'context', 'exclusions', 'companies.csv');
  if (!fs.existsSync(file)) return EMPTY_CSV;
  return parseCsv(fs.readFileSync(file, 'utf8'));
}
