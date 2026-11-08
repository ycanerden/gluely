import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { domainToUnicode, fileURLToPath } from 'node:url';
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

// "Work Email", "work-email" and "WORK_EMAIL" are one column.
export const headerKey = (value) => String(value || '').replace(/^\uFEFF/, '').trim().toLowerCase()
  .normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

// A file read in the wrong encoding misspells every name in it, so it matches nothing.
export function decodeCsv(buffer) {
  if ((buffer[0] === 0xff && buffer[1] === 0xfe) || (buffer[0] === 0xfe && buffer[1] === 0xff) || buffer.includes(0)) {
    return { error: 'is UTF-16, not UTF-8' };
  }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(buffer) };
  } catch {
    return { error: 'is not UTF-8 (often Latin-1 or Windows-1252), so accented names would be misread' };
  }
}

export function readCsvFile(file, label = file) {
  const { text, error } = decodeCsv(fs.readFileSync(file));
  if (error) fail('bad_encoding', `${label} ${error}.`, 'Save it as UTF-8 (in Excel: "CSV UTF-8"). Nothing was sorted.');
  return parseCsv(text);
}

// RFC 4180, read strictly. A quote only opens a cell at its start; one in the middle of a cell
// is kept as text and the row is flagged. A file whose quotes don't add up is reported, because
// one stray quote can swallow the rows after it into a single cell.
export function parseCsv(text) {
  text = String(text || '').replace(/^\uFEFF/, '');
  const records = [];
  const problems = [];
  let cells = [];
  let cell = '';
  let state = 'start'; // start | plain | quoted | after
  let line = 1;
  let rowLine = 1;
  let cellLine = 1;
  let flags = [];
  let multiline = [];
  const endCell = () => {
    if (cell.includes('\n')) multiline.push({ line: cellLine, text: cell });
    cells.push(cell);
    cell = '';
    state = 'start';
    cellLine = line;
  };
  const endRow = () => {
    endCell();
    records.push({ line: rowLine, cells, flags, multiline });
    cells = []; flags = []; multiline = [];
    rowLine = line; cellLine = line;
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (state === 'quoted') {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') state = 'after';
      else if (ch !== '\r') { if (ch === '\n') line++; cell += ch; }
      continue;
    }
    if (ch === ',') { endCell(); continue; }
    if (ch === '\n') { line++; endRow(); continue; }
    if (ch === '\r') continue;
    if (state === 'after') {
      if (ch !== ' ' && ch !== '\t') { flags.push('text after a closing quote'); state = 'plain'; cell += ch; }
      continue;
    }
    if (ch === '"') {
      if (state === 'start' && !cell.trim()) { state = 'quoted'; cell = ''; cellLine = line; continue; }
      flags.push('a stray " inside a cell');
    }
    cell += ch;
    state = 'plain';
  }
  if (state === 'quoted') problems.push({ line: cellLine, problem: 'a quote opens here and never closes, so every row after it would be read as one cell' });
  if (cell || cells.length || state === 'quoted') endRow();

  const filled = records.filter((r) => r.cells.some((c) => c.trim()));
  const [head = { cells: [] }, ...body] = filled;
  const raw = head.cells.map((h) => h.replace(/^\uFEFF/, '').trim());
  const header = raw.map(headerKey);
  const width = header.length;
  for (const record of body) {
    const used = record.cells.length - [...record.cells].reverse().findIndex((c) => c.trim());
    if (record.cells.length > width && used > width) record.flags.push(`${used} cells, but the header has ${width}`);
    else if (record.cells.length < width) record.flags.push(`${record.cells.length} cells, but the header has ${width}`);
    record.cells = record.cells.slice(0, Math.max(width, used)).map((c) => c.trim());
    while (record.cells.length < width) record.cells.push('');
    for (const { line: at, text: inner } of record.multiline) {
      const rest = inner.split('\n').slice(1);
      if (rest.some((l) => (l.match(/,/g) || []).length >= Math.max(2, width - 1) || (/@/.test(l) && /,/.test(l)))) {
        problems.push({ line: at, problem: `a quoted cell runs over ${rest.length + 1} lines and holds what look like whole rows` });
      }
    }
  }
  // Duplicate columns keep every value; the row object takes the first one that is filled in.
  const rows = body.map((r) => {
    const row = {};
    header.forEach((key, i) => { if (!row[key]) row[key] = r.cells[i] ?? ''; });
    return row;
  });
  const lines = text.split('\n').filter((l) => l.trim()).length;
  return { header, raw, rows, records: body, problems, lines };
}

// "https://www.Acme.com:443/about?utm=x" and "@acme.com." are acme.com. Anything that isn't a
// domain comes back empty, so junk like "n/a" or "-" can never stand in for a real one.
export function normalizeDomain(value) {
  let d = String(value || '').trim().toLowerCase()
    .replace(/^mailto:/, '').replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/^\/\//, '')
    .replace(/^[^/?#]*@/, '').replace(/[/?#\\].*$/, '').replace(/:\d*$/, '')
    .replace(/^[^\p{L}\p{N}]+/u, '').replace(/[^\p{L}\p{N}]+$/u, '').replace(/^www\d?\./, '');
  if (d.includes('xn--')) d = domainToUnicode(d) || d;
  return /^[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+$/u.test(d) && /[\p{L}]/u.test(d.split('.').pop()) ? d : '';
}

// The columns each kind of file is read from. Every other column is still scanned for email addresses.
export const COLUMNS = {
  domain: ['domain', 'domains', 'company_domain', 'domain_name', 'website', 'company_website', 'customer_website', 'web', 'url', 'company_url', 'homepage', 'site', 'website_url'],
  email: ['email', 'emails', 'e_mail', 'mail', 'work_email', 'business_email', 'email_address', 'primary_email', 'contact_email', 'billing_email', 'customer_email', 'user_email', 'personal_email'],
  company: ['company', 'company_name', 'organization', 'organisation', 'organization_name', 'organisation_name', 'account', 'account_name', 'customer', 'customer_name', 'employer', 'current_company', 'business_name'],
  linkedin: ['linkedin', 'linkedin_url', 'profile_url', 'linkedin_profile', 'linkedin_profile_url', 'person_linkedin_url', 'company_linkedin_url', 'linkedin_company_url'],
  name: ['name', 'full_name', 'person', 'contact', 'contact_name', 'person_name'],
  reason: ['reason', 'status', 'type', 'relationship', 'lifecycle_stage', 'stage', 'category'],
  owner: ['owner', 'relationship_owner', 'account_owner', 'company_owner', 'contact_owner'],
};

export const columnIndexes = (header, kind) => header.flatMap((key, i) => (COLUMNS[kind].includes(key) ? [i] : []));

// companies.csv, read with the same column names as any list. In a companies file "name" is the company.
export function loadExclusions(ws) {
  const file = path.join(ws, 'context', 'exclusions', 'companies.csv');
  if (!fs.existsSync(file)) return { header: [], rows: [], problems: [] };
  const { text, error } = decodeCsv(fs.readFileSync(file));
  if (error) return { header: [], rows: [], problems: [{ line: 1, problem: `the file ${error}` }] };
  const parsed = parseCsv(text);
  const first = (record, kinds) => {
    for (const kind of kinds) for (const i of columnIndexes(parsed.header, kind)) if (record.cells[i]) return record.cells[i];
    return '';
  };
  const rows = parsed.records.map((record, i) => ({
    ...parsed.rows[i],
    domain: first(record, ['domain']),
    name: first(record, ['name', 'company']),
    reason: first(record, ['reason']),
    owner: first(record, ['owner']),
    line: record.line,
  }));
  return { ...parsed, rows };
}
