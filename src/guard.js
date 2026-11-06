// The gate in front of every outside tool. A list goes to an enrichment tool, a scraper or
// a sender only after this sorts it: customers never leave, known people go to the person
// who owns the relationship, and only what is clearly a prospect is cleared.
// It reads files and writes files. It calls nothing.
import fs from 'node:fs';
import path from 'node:path';
import { addEntry } from './log.js';
import { fail } from './output.js';
import { loadConfig, loadExclusions, normalizeDomain, parseCsv } from './workspace.js';

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

// One typo apart: "Globexx" or "Globx" for Globex. Short names are skipped, since "Acme" and "Acne"
// are different companies more often than they are a typo.
const NEAR_MIN = 5;
export function nearName(a, b) {
  if (!a || !b || a === b || a.length < NEAR_MIN || b.length < NEAR_MIN || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1) || (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2));
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

const normalizeProfile = (value) => String(value || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');

// In B2C an email names a person, so only a domain column names a company.
function companyDomain(row, market = 'b2b') {
  const direct = pick(row, 'domain');
  if (direct) return normalizeDomain(direct);
  if (market === 'b2c') return '';
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

export const MARKETS = ['b2b', 'b2c', 'both'];

// A customer export, such as your billing or product users, read for this run only.
// In B2C a work email names a person, not a company, so it never marks a whole company.
function readCustomers(file, market) {
  if (!file) return { people: [], companies: [] };
  const full = path.resolve(file);
  if (!fs.existsSync(full)) fail('missing_file', `No customer list at ${file}.`);
  const people = [];
  const companies = [];
  for (const row of parseCsv(fs.readFileSync(full, 'utf8')).rows) {
    const email = pick(row, 'email').trim().toLowerCase();
    const linkedin = pick(row, 'linkedin');
    if (email || linkedin) people.push({ email, linkedin, reason: 'customer' });
    const domain = companyDomain(row, market);
    const name = market === 'b2c' ? '' : pick(row, 'company');
    if (domain || name) companies.push({ domain, name, reason: 'customer' });
  }
  return { people, companies };
}

export function guardRules(ws, { customersFile } = {}) {
  const market = MARKETS.includes(loadConfig(ws).company.market) ? loadConfig(ws).company.market : 'b2b';
  const extra = readCustomers(customersFile, market);
  const companies = [...loadExclusions(ws).rows.filter((r) => r.domain || r.name), ...extra.companies];
  const people = [...loadPeople(ws), ...extra.people];
  return {
    market,
    companies,
    people,
    customers: companies.filter(isCustomer).length,
    customer_people: people.filter(isCustomer).length,
  };
}

// One row in, one decision out. Held beats owner, and owner beats clear.
export function sortRow(row, { companies, people, market = 'b2b', customer_people: customerPeople = 0 }) {
  const domain = companyDomain(row, market);
  const company = pick(row, 'company');
  const email = pick(row, 'email').trim().toLowerCase();
  const profile = normalizeProfile(pick(row, 'linkedin'));
  const names = new Set([normalizeName(company), domainName(domain)].filter(Boolean));

  const byDomain = domain && companies.find((c) => c.domain && normalizeDomain(c.domain) === domain);
  const byName = !byDomain && companies.find((c) => [normalizeName(c.name), domainName(c.domain)].some((n) => n && names.has(n)));
  // A customer one typo away is held too, because a misspelled export still names your customer.
  const byNear = !byDomain && !byName && companies.find((c) => isCustomer(c)
    && [normalizeName(c.name), domainName(c.domain)].some((n) => [...names].some((m) => nearName(n, m))));
  const match = byDomain || byName || byNear;

  if (match && isCustomer(match)) {
    const label = match.name || match.domain;
    return byDomain
      ? { bucket: 'held', reason: `${label} is a ${match.reason}. Customer data never goes to an outside tool` }
      : byName
        ? { bucket: 'held', reason: `shares a name with ${label}, a ${match.reason}. Held like a customer until a person checks` }
        : { bucket: 'held', reason: `looks like ${label}, a ${match.reason}, one letter apart. Held like a customer until a person checks` };
  }

  const person = people.find((p) => (email && p.email && p.email.trim().toLowerCase() === email)
    || (profile && p.linkedin && normalizeProfile(p.linkedin) === profile));
  if (person && isCustomer(person)) return { bucket: 'held', reason: 'a customer. Customer data never goes to an outside tool' };
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

  if (!domain && !normalizeName(company)) {
    // In B2C a person is the customer, so a person can be checked without a company.
    if (market === 'b2b' || !(email || profile)) return { bucket: 'held', reason: 'no company or work domain, so it cannot be checked against your customers' };
    if (!customerPeople) return { bucket: 'held', reason: 'no customer list to check people against. Pass --customers <export.csv>' };
  }
  return { bucket: 'clear', reason: 'not a customer or a known relationship' };
}

const BUCKETS = ['clear', 'owner', 'held'];

function toCsv(header, rows) {
  const cell = (v) => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''));
  return [header, ...rows.map((r) => header.map((h) => r[h]))].map((r) => r.map(cell).join(',')).join('\n') + '\n';
}

export function guardFile(ws, file, { to, by, customers, write = true } = {}) {
  if (!file) fail('usage', 'Usage: gluely guard <list.csv> [--to <tool>]');
  const full = path.resolve(file);
  if (!fs.existsSync(full)) fail('missing_file', `No file at ${file}.`);
  const { header, rows } = parseCsv(fs.readFileSync(full, 'utf8'));
  if (!header.length) fail('empty_list', `${file} has no header row.`);
  const known = Object.values(COLUMNS).flat();
  if (!header.some((h) => known.includes(h))) {
    fail('unknown_columns', `${file} has none of the columns the guard reads.`, `Add one of: ${[...COLUMNS.domain, ...COLUMNS.email, ...COLUMNS.company].join(', ')}.`);
  }

  const rules = guardRules(ws, { customersFile: customers });
  const sorted = rows.map((row, index) => ({ line: index + 2, ...sortRow(row, rules), row }));
  const counts = Object.fromEntries(BUCKETS.map((b) => [b, sorted.filter((s) => s.bucket === b).length]));
  const warnings = [];
  if (rules.market !== 'b2c' && !rules.customers) warnings.push('No customers in context/exclusions/companies.csv, so the guard cannot protect them. Add everyone who trialed, paid or churned, with reason customer, trial or churned.');
  if (rules.market !== 'b2b' && !rules.customer_people) warnings.push('No customer people to check against. Pass your user or billing export with --customers <export.csv>, and keep it in exports/.');

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
    market: rules.market,
    to: to || null,
    total: rows.length,
    counts,
    files,
    owners: [...new Set(sorted.filter((s) => s.owner).map((s) => s.owner))].sort(),
    warnings,
    rows: sorted.filter((s) => s.bucket !== 'clear').map(({ line, bucket, reason, owner }) => ({ line, bucket, reason, ...(owner ? { owner } : {}) })),
  };
}
