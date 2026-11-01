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

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (ch !== '\r') cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [header = [], ...body] = rows.filter((r) => r.some((c) => c.trim()));
  const keys = header.map((h) => h.trim().replace(/^﻿/, '').toLowerCase());
  return { header: keys, rows: body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()]))) };
}

export const normalizeDomain = (value) =>
  String(value || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');

export function loadExclusions(ws) {
  const file = path.join(ws, 'context', 'exclusions', 'companies.csv');
  if (!fs.existsSync(file)) return { header: [], rows: [] };
  return parseCsv(fs.readFileSync(file, 'utf8'));
}
