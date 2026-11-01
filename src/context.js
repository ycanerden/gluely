import fs from 'node:fs';
import path from 'node:path';
import { CONTEXT_STATUSES } from './vocab.js';
import { loadExclusions, readFrontmatter } from './workspace.js';

const REQUIRED = ['company.md', 'icp.md', 'positioning.md', 'messaging/voice.md', 'messaging/excuses.md', 'exclusions/rules.md'];
const CLAIM_DIRS = ['personas', 'objections', 'proof'];
const ICP_HEADINGS = ['## Must have', '## Disqualifiers', '## Scoring'];
const PLACEHOLDER = /<[a-z][a-z0-9 -]*>/g;

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const isTemplateFile = (rel) => path.basename(rel).startsWith('_');

function checkFile(root, rel) {
  const issues = [];
  const add = (level, message) => issues.push({ level, file: `context/${rel}`, message });
  const { data, body, error } = readFrontmatter(path.join(root, rel));

  if (error) { add('error', `frontmatter is not valid YAML: ${error}`); return { rel, status: 'invalid', issues }; }
  if (!data) { add('error', 'needs frontmatter with at least id and status'); return { rel, status: 'invalid', issues }; }
  if (!data.id) add('error', 'frontmatter needs an id');
  if (!CONTEXT_STATUSES.includes(data.status)) add('error', `status must be one of ${CONTEXT_STATUSES.join(', ')}`);

  if (data.status !== 'template') {
    const left = [...new Set(body.match(PLACEHOLDER) || [])];
    if (left.length) add('warn', `unfilled placeholders: ${left.join(', ')}`);
    if (rel === 'icp.md') {
      for (const heading of ICP_HEADINGS) if (!body.includes(heading)) add('error', `missing the "${heading}" section`);
    }
    if (rel === 'messaging/voice.md' && !data.limits) add('error', 'voice needs limits in its frontmatter');
    if (rel === 'messaging/excuses.md' && !Array.isArray(data.excuses)) add('error', 'excuses needs a list in its frontmatter');
  }
  return { rel, id: data.id, status: data.status, issues };
}

export function scanContext(ws) {
  const root = path.join(ws, 'context');
  const files = walk(root)
    .filter((f) => f.endsWith('.md'))
    .map((f) => path.relative(root, f))
    .filter((rel) => !isTemplateFile(rel))
    .sort()
    .map((rel) => checkFile(root, rel));

  const issues = files.flatMap((f) => f.issues);
  for (const rel of REQUIRED) {
    if (!files.some((f) => f.rel === rel)) issues.push({ level: 'error', file: `context/${rel}`, message: 'required file is missing' });
  }

  const personas = files.filter((f) => f.rel.startsWith('personas/') && f.status !== 'template');
  if (!personas.length) issues.push({ level: 'warn', file: 'context/personas/', message: 'add at least one persona' });

  const exclusions = loadExclusions(ws);
  if (exclusions.header.length && !exclusions.header.includes('domain')) {
    issues.push({ level: 'error', file: 'context/exclusions/companies.csv', message: 'needs a domain column' });
  }
  if (!exclusions.rows.length) {
    issues.push({ level: 'warn', file: 'context/exclusions/companies.csv', message: 'no excluded companies yet: add clients, investors and partners before any outreach' });
  }

  const count = (status) => files.filter((f) => f.status === status).length;
  return {
    files: files.map(({ rel, id, status }) => ({ file: `context/${rel}`, id, status })),
    summary: {
      total: files.length,
      confirmed: count('confirmed'),
      draft: count('draft'),
      template: count('template'),
      personas: personas.length,
      objections: files.filter((f) => f.rel.startsWith('objections/')).length,
      proof: files.filter((f) => f.rel.startsWith('proof/')).length,
      excluded_companies: exclusions.rows.length,
    },
    issues,
    claim_dirs: CLAIM_DIRS,
  };
}

export function personaIds(ws) {
  return scanContext(ws).files.filter((f) => f.file.startsWith('context/personas/')).map((f) => f.id);
}

export function loadVoice(ws) {
  const file = path.join(ws, 'context', 'messaging', 'voice.md');
  const data = fs.existsSync(file) ? readFrontmatter(file).data || {} : {};
  return { limits: data.limits || {}, banned: data.banned || [] };
}

export function loadExcuses(ws) {
  const file = path.join(ws, 'context', 'messaging', 'excuses.md');
  const data = fs.existsSync(file) ? readFrontmatter(file).data || {} : {};
  return Array.isArray(data.excuses) ? data.excuses : [];
}
