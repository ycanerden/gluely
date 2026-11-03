// The gate in front of every outside tool. A list goes to an enrichment tool, a scraper or
// a sender only after this sorts it: customers never leave, known people go to the person
// who owns the relationship, and only what is clearly a prospect is cleared.
// It reads files and writes files. It calls nothing.
import fs from 'node:fs';
import path from 'node:path';
import { addEntry } from './log.js';
import { fail } from './output.js';
import { loadExclusions, normalizeDomain, parseCsv } from './workspace.js';

// Anyone who has trialed, paid or churned is a customer, and their data stays home.
export const CUSTOMER_REASONS = ['customer', 'client', 'trial', 'paid', 'churned', 'former customer'];

// Mail domains that say nothing about where someone works.
const PERSONAL_MAIL = new Set(['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'yahoo.com', 'icloud.com', 'me.com', 'proton.me', 'protonmail.com', 'aol.com', 'gmx.com', 'gmx.de', 'web.de', 'yandex.com', 'mail.com']);
const TWO_PART_SUFFIX = /\.(?:co|com|org|net|ac|gov)\.[a-z]{2}$/;
const LEGAL = new Set(['inc', 'llc', 'ltd', 'limited', 'gmbh', 'ag', 'bv', 'nv', 'sa', 'sas', 'sarl', 'srl', 'spa', 'plc', 'corp', 'corporation', 'co', 'company', 'oy', 'ab', 'as', 'aps', 'pty', 'kk', 'the', 'group', 'holding', 'holdings', 'hq']);

const COLUMNS = {
  domain: ['domain', 'company_domain', 'website', 'company_website', 'url'],
  email: ['email', 'work_email', 'email_address'],
  company: ['company', 'company_name', 'organization', 'account', 'account_name'],
  linkedin: ['linkedin', 'linkedin_url', 'profile_url', 'linkedin_profile'],
  name: ['name', 'full_name', 'person'],
};

const pick = (row, kind) => {
  for (const key of COLUMNS[kind]) if (row[key]) return row[key];
  return '';
};

// "Acme, Inc." and "ACME GmbH" are the same name. So are acme.com and acme.co.uk.
export const normalizeName = (value) => String(value || '')
  .normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ')
  .split(/\s+/).filter((w) => w && !LEGAL.has(w)).join(' ');

export const domainName = (domain) => {
  const clean = normalizeDomain(domain);
  if (!clean.includes('.')) return '';
  const base = clean.replace(TWO_PART_SUFFIX, '').replace(/\.[a-z0-9-]+$/, '');
  return base.split('.').pop();
};

const normalizeProfile = (value) => String(value || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');

function companyDomain(row) {
  const direct = pick(row, 'domain');
  if (direct) return normalizeDomain(direct);
  const email = pick(row, 'email');
  const fromMail = email.includes('@') ? normalizeDomain(email.split('@').pop()) : '';
  return PERSONAL_MAIL.has(fromMail) ? '' : fromMail;
}

export function loadPeople(ws) {
  const file = path.join(ws, 'context', 'exclusions', 'people.csv');
  if (!fs.existsSync(file)) return [];
  return parseCsv(fs.readFileSync(file, 'utf8')).rows;
}

const isCustomer = (row) => CUSTOMER_REASONS.includes(String(row.reason || '').trim().toLowerCase());

export function guardRules(ws) {
  const companies = loadExclusions(ws).rows.filter((r) => r.domain || r.name);
  const people = loadPeople(ws);
  return { companies, people, customers: companies.filter(isCustomer).length };
}

// One row in, one decision out. Held beats owner, and owner beats clear.
export function sortRow(row, { companies, people }) {
  const domain = companyDomain(row);
  const company = pick(row, 'company');
  const email = pick(row, 'email').trim().toLowerCase();
  const profile = normalizeProfile(pick(row, 'linkedin'));
  const names = new Set([normalizeName(company), domainName(domain)].filter(Boolean));

  const byDomain = domain && companies.find((c) => c.domain && normalizeDomain(c.domain) === domain);
  const byName = !byDomain && companies.find((c) => [normalizeName(c.name), domainName(c.domain)].some((n) => n && names.has(n)));
  const match = byDomain || byName;

  if (match && isCustomer(match)) {
    const label = match.name || match.domain;
    return byDomain
      ? { bucket: 'held', reason: `${label} is a ${match.reason}. Customer data never goes to an outside tool` }
      : { bucket: 'held', reason: `shares a name with ${label}, a ${match.reason}. Held like a customer until a person checks` };
  }

  const person = people.find((p) => (email && p.email && p.email.trim().toLowerCase() === email)
    || (profile && p.linkedin && normalizeProfile(p.linkedin) === profile));
  if (person) {
    return person.owner
      ? { bucket: 'owner', owner: person.owner, reason: `${person.reason || 'a known person'}. ${person.owner} decides first` }
      : { bucket: 'held', reason: `${person.reason || 'a known person'}, with no owner named in people.csv` };
  }

  if (match) {
    return match.owner
      ? { bucket: 'owner', owner: match.owner, reason: `${match.name || match.domain} is a ${match.reason || 'known company'}. ${match.owner} decides first` }
      : { bucket: 'held', reason: `${match.name || match.domain} is excluded: ${match.reason || 'excluded'}` };
  }

  if (!domain && !normalizeName(company)) return { bucket: 'held', reason: 'no company or work domain, so it cannot be checked against your customers' };
  return { bucket: 'clear', reason: 'not a customer or a known relationship' };
}

const BUCKETS = ['clear', 'owner', 'held'];

function toCsv(header, rows) {
  const cell = (v) => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''));
  return [header, ...rows.map((r) => header.map((h) => r[h]))].map((r) => r.map(cell).join(',')).join('\n') + '\n';
}

export function guardFile(ws, file, { to, by, write = true } = {}) {
  if (!file) fail('usage', 'Usage: gluely guard <list.csv> [--to <tool>]');
  const full = path.resolve(file);
  if (!fs.existsSync(full)) fail('missing_file', `No file at ${file}.`);
  const { header, rows } = parseCsv(fs.readFileSync(full, 'utf8'));
  if (!header.length) fail('empty_list', `${file} has no header row.`);
  const known = Object.values(COLUMNS).flat();
  if (!header.some((h) => known.includes(h))) {
    fail('unknown_columns', `${file} has none of the columns the guard reads.`, `Add one of: ${[...COLUMNS.domain, ...COLUMNS.email, ...COLUMNS.company].join(', ')}.`);
  }

  const rules = guardRules(ws);
  const sorted = rows.map((row, index) => ({ line: index + 2, ...sortRow(row, rules), row }));
  const counts = Object.fromEntries(BUCKETS.map((b) => [b, sorted.filter((s) => s.bucket === b).length]));
  const warnings = [];
  if (!rules.customers) warnings.push('No customers in context/exclusions/companies.csv, so the guard cannot protect them. Add everyone who trialed, paid or churned, with reason customer, trial or churned.');

  const files = {};
  if (write) {
    const outDir = path.join(ws, 'exports', 'guard');
    fs.mkdirSync(outDir, { recursive: true });
    const base = path.basename(full).replace(/\.csv$/i, '');
    for (const bucket of BUCKETS) {
      const target = path.join(outDir, `${base}.${bucket}.csv`);
      const extra = bucket === 'clear' ? [] : ['guard_reason', ...(bucket === 'owner' ? ['owner'] : [])];
      const list = sorted.filter((s) => s.bucket === bucket).map((s) => ({ ...s.row, guard_reason: s.reason, owner: s.owner }));
      fs.writeFileSync(target, toCsv([...header, ...extra], list));
      files[bucket] = path.relative(ws, target);
    }
    addEntry(ws, {
      kind: 'result', area: 'exclusion', source: 'gluely', by: by || 'gluely',
      text: `Guard${to ? ` before ${to}` : ''}: ${counts.clear} clear, ${counts.owner} to owners, ${counts.held} held, of ${rows.length}`,
    });
  }

  return {
    file: path.relative(ws, full).startsWith('..') ? full : path.relative(ws, full),
    to: to || null,
    total: rows.length,
    counts,
    files,
    owners: [...new Set(sorted.filter((s) => s.owner).map((s) => s.owner))].sort(),
    warnings,
    rows: sorted.filter((s) => s.bucket !== 'clear').map(({ line, bucket, reason, owner }) => ({ line, bucket, reason, ...(owner ? { owner } : {}) })),
  };
}
