// The gate in front of every outside tool. A list goes to an enrichment tool, a scraper or
// a sender only after this sorts it: customers never leave, known people go to the person
// who owns the relationship, and only what is positively checked is cleared.
// One rule decides every doubt: when the gate can't be sure, it holds.
// It reads files and writes files. It calls nothing.
import fs from 'node:fs';
import path from 'node:path';
import { addEntry } from './log.js';
import { fail } from './output.js';
import { loadConfig, normalizeDomain, parseCsv } from './workspace.js';

// Anyone who has trialed, paid or churned is a customer, and their data stays home.
export const CUSTOMER_REASONS = ['customer', 'client', 'trial', 'paid', 'churned', 'former customer'];

// Mail domains that say nothing about where someone works.
const PERSONAL_MAIL = new Set(['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'yahoo.com', 'icloud.com', 'me.com', 'proton.me', 'protonmail.com', 'aol.com', 'gmx.com', 'gmx.de', 'web.de', 'yandex.com', 'mail.com']);
const TWO_PART_SUFFIX = /\.(?:co|com|org|net|ac|gov|edu)\.[a-z]{2}$/;
// Hosts where the company is the subdomain, so acme.github.io and globex.github.io are two companies.
// Core carries no public suffix list, so this is a short list of the common ones.
const SHARED_HOSTS = new Set(['github.io', 'substack.com', 'myshopify.com', 'wordpress.com', 'blogspot.com', 'notion.site', 'webflow.io', 'wixsite.com', 'herokuapp.com', 'vercel.app', 'netlify.app', 'carrd.co', 'squarespace.com']);
// A page on one of these in a website column is a profile, not the company's own domain.
const PROFILE_HOSTS = new Set(['linkedin.com', 'twitter.com', 'x.com', 'facebook.com', 'instagram.com', 'youtube.com', 'tiktok.com', 'github.com', 'linktr.ee', 'calendly.com', 'crunchbase.com']);
const LEGAL = new Set(['inc', 'llc', 'ltd', 'limited', 'gmbh', 'ag', 'bv', 'nv', 'sa', 'sas', 'sarl', 'srl', 'spa', 'plc', 'corp', 'corporation', 'co', 'company', 'oy', 'ab', 'as', 'aps', 'pty', 'kk', 'the', 'group', 'holding', 'holdings', 'hq']);
const HONORIFICS = new Set(['mr', 'mrs', 'ms', 'miss', 'dr', 'prof']);

const ACCENTS = /[\u0300-\u036f]/g;
const EMAIL = /[a-z0-9._%+'-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi;
const PROFILE = /linkedin\.com\/(?:in|pub)\/[^\s"'<>(),;?#]+/i;
const DOMAIN = /^(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?\.)+\p{L}[\p{L}\p{N}-]*[\p{L}\p{N}]$/u;

export const isDomain = (value) => DOMAIN.test(value);

// "Acme, Inc." and "ACME GmbH" are the same name. So are acme.com and acme.co.uk.
export const normalizeName = (value) => String(value || '')
  .normalize('NFKD').replace(ACCENTS, '').toLowerCase()
  .replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ')
  .split(/\s+/).filter((w) => w && !LEGAL.has(w)).join(' ');

// The part of a host a company owns: app.acme.com and mail.acme.com are both acme.com.
export function registrable(domain) {
  const clean = normalizeDomain(domain);
  const labels = clean.split('.');
  if (labels.length <= 2) return clean;
  const keep = TWO_PART_SUFFIX.test(clean) || SHARED_HOSTS.has(labels.slice(-2).join('.')) ? 3 : 2;
  return labels.slice(-keep).join('.');
}

// What exports write when they know no company. It names nobody, so it can't clear a row.
const NO_NAME = new Set(['n a', 'na', 'none', 'null', 'nil', 'unknown', 'tbd', 'test', 'self employed', 'freelance', 'freelancer']);
export const companyName = (value) => {
  const name = normalizeName(value);
  return NO_NAME.has(name) ? '' : name;
};

export const domainName = (domain) => {
  const clean = normalizeDomain(domain);
  return clean.includes('.') ? registrable(clean).split('.')[0] : '';
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

// The same inbox, however it is written: Pat+news@Googlemail.com is pat@gmail.com.
export function normalizeEmail(value) {
  const [local, host = ''] = String(value || '').trim().toLowerCase().split('@');
  const domain = host === 'googlemail.com' ? 'gmail.com' : host;
  const name = local.replace(/\+.*$/, '');
  return `${domain === 'gmail.com' ? name.replace(/\./g, '') : name}@${domain}`;
}

// The same profile, whichever country site, tracking tail or slash it came with.
export function normalizeProfile(value) {
  const text = String(value || '').trim().toLowerCase();
  const found = text.match(PROFILE);
  if (found) return found[0].replace(/\/+$/, '');
  return text.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[?#].*$/, '').replace(/\/+$/, '');
}

// "Dr. Pat O'Neil" and "O'Neil, Pat" are one person. One word alone names nobody.
export function normalizePerson(value) {
  const words = String(value || '').normalize('NFKD').replace(ACCENTS, '').toLowerCase()
    .replace(/[^a-z ]+/g, ' ').split(/\s+/).filter((w) => w.length > 1 && !HONORIFICS.has(w));
  return words.length > 1 ? words.sort().join(' ') : '';
}

// Which column says what. Exports name their columns a hundred ways ("Work Email",
// "Company Domain", "Associated Company"), so headers are read by meaning, not by an exact
// list. A column about your own team ("Contact owner") names no prospect and is left alone.
const OURS = new Set(['owner', 'rep', 'assigned', 'assignee', 'sender', 'sdr', 'bdr', 'csm']);
const COMPANY = /^(?:company|companyname|organi[sz]ation|org|account|accountname|employer|business|firm|workplace)$/;
const NAME_FILLER = new Set(['name', 'legal', 'current', 'primary', 'associated', 'main']);
const PERSON = new Set(['name', 'full_name', 'fullname', 'person', 'person_name', 'contact', 'contact_name', 'lead', 'lead_name']);
const FIRST = new Set(['first_name', 'firstname', 'first', 'given_name', 'forename']);
const LAST = new Set(['last_name', 'lastname', 'last', 'surname', 'family_name']);
const SITE = new Set(['url', 'site', 'web', 'company_url', 'company_site']);

export function columnRole(header, { companyFile = false } = {}) {
  const key = String(header).normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/_\d+$/, '');
  const words = key.split('_');
  if (words.some((w) => OURS.has(w))) return 'ours';
  if (key.includes('linkedin') || key === 'profile_url' || key === 'profile') return 'linkedin';
  if (/domain|website|homepage/.test(key) || SITE.has(key)) return 'domain';
  if (/e_?mail/.test(key)) return 'email';
  if (FIRST.has(key)) return 'first';
  if (LAST.has(key)) return 'last';
  // In companies.csv the name column names the company. In a list it names the person.
  if (companyFile && key === 'name') return 'company';
  if (PERSON.has(key)) return 'person';
  const rest = words.filter((w) => !NAME_FILLER.has(w));
  return rest.length === 1 && COMPANY.test(rest[0]) ? 'company' : null;
}

const rolesFor = (header, options) => Object.fromEntries(header.map((h) => [h, columnRole(h, options)]));

// Everything in one row that names a person or a company. Emails and LinkedIn profiles are
// read wherever they sit, because an identifier in a column nobody mapped is still an identifier.
// In B2C an email names a person, so only a domain column names a company.
export function readRow(row, roles, market = 'b2b') {
  const emails = [];
  const profiles = [];
  const domains = [];
  const companies = [];
  const used = new Set();
  let person = '';
  const names = { first: '', last: '' };
  for (const [column, raw] of Object.entries(row)) {
    const value = String(raw ?? '').trim();
    const role = roles[column];
    if (!value || role === 'ours') continue;
    for (const email of value.match(EMAIL) || []) { emails.push(normalizeEmail(email)); used.add(column); }
    if (PROFILE.test(value) || (role === 'linkedin' && value.toLowerCase().includes('linkedin.com/'))) { profiles.push(normalizeProfile(value)); used.add(column); }
    if (role === 'domain') {
      const host = normalizeDomain(value);
      const page = /[^/:]\/[^/]/.test(value.replace(/^[a-z]+:\/\//i, ''));
      // A junk cell ("n/a", "-") names nothing, so the row's other columns must carry the check.
      if (isDomain(host) && !(page && PROFILE_HOSTS.has(registrable(host)))) domains.push({ value: host, on: 'domain' });
    }
    if (role === 'company') companies.push(value);
    if (role === 'person') person ||= normalizePerson(value);
    if (role === 'first' || role === 'last') names[role] ||= value;
  }
  if (market !== 'b2c') {
    for (const email of emails) {
      const host = email.split('@').pop();
      if (isDomain(host) && !PERSONAL_MAIL.has(host)) domains.push({ value: host, on: 'email_domain' });
    }
  }
  return { emails, profiles, domains, companies, person: person || normalizePerson(`${names.first} ${names.last}`), used };
}

const isCustomer = (rule) => CUSTOMER_REASONS.includes(String(rule.reason || '').trim().toLowerCase());
// Held beats owner: a customer first, then anything with nobody to ask, then a named owner.
const severity = (rule) => (isCustomer(rule) ? 3 : rule.owner ? 1 : 2);
const strictest = (hits) => hits.sort((a, b) => severity(b.rule) - severity(a.rule) || a.rank - b.rank)[0] || null;

export const MARKETS = ['b2b', 'b2c', 'both'];

const locate = (ws, file) => [path.resolve(file), path.resolve(ws, file)].find((f) => fs.existsSync(f) && fs.statSync(f).isFile());

// A file with a broken quote has lost rows nobody can see, so nothing is sorted from it.
function readCsv(full, label) {
  const parsed = parseCsv(fs.readFileSync(full, 'utf8'));
  if (parsed.problems.length) {
    fail('broken_csv', `${label} can't be read safely: ${parsed.problems[0].message}.`, 'Close the quote, or take the line breaks out of its cells, then run it again. Nothing was sorted.');
  }
  return parsed;
}

const peopleFile = (ws) => path.join(ws, 'context', 'exclusions', 'people.csv');
const companiesFile = (ws) => path.join(ws, 'context', 'exclusions', 'companies.csv');

export function loadPeopleCsv(ws) {
  return fs.existsSync(peopleFile(ws)) ? parseCsv(fs.readFileSync(peopleFile(ws), 'utf8')) : { header: [], rows: [], lines: [], overflow: [], problems: [] };
}

export const loadPeople = (ws) => loadPeopleCsv(ws).rows;

// Turns one rule file into company rules and people rules. Rows it can't read protect
// nobody, so they are counted and said out loud instead of dropped.
function readRules(parsed, source, { market, companyFile = false, peopleNames = false, reason }) {
  const roles = rolesFor(parsed.header, { companyFile });
  const companies = [];
  const people = [];
  const unreadable = [];
  const used = new Set();
  parsed.rows.forEach((row, i) => {
    const line = parsed.lines[i];
    const read = readRow(row, roles, market);
    for (const column of read.used) used.add(column);
    const why = reason || row.reason || '';
    const at = `${source}:${line}`;
    const names = companyFile || market !== 'b2c' ? read.companies : [];
    const hosts = [...new Set(read.domains.map((d) => registrable(d.value)))];
    let found = false;
    if (!companyFile && (read.emails.length || read.profiles.length || (peopleNames && read.person))) {
      people.push({ emails: read.emails, profiles: read.profiles, name: peopleNames ? read.person : '', reason: why, owner: row.owner || '', source: at });
      found = true;
    }
    // In people.csv a work email names a person, not a whole company.
    if (!peopleNames && (hosts.length || names.some((n) => companyName(n)))) {
      companies.push({
        domains: hosts,
        names: [...new Set([...names.map(companyName), ...hosts.map(domainName)].filter(Boolean))],
        label: names.find((n) => companyName(n)) || hosts[0], reason: why, owner: row.owner || '', source: at,
      });
      found = true;
    }
    if (!found) unreadable.push(line);
  });
  const unread = parsed.header.filter((h) => !used.has(h) && (!roles[h] || roles[h] === 'ours') && !['reason', 'owner'].includes(h));
  return { companies, people, unreadable, unread_columns: unread, rows: parsed.rows.length };
}

function buildIndex(companies, people) {
  const index = { domain: new Map(), name: new Map(), near: new Map(), email: new Map(), profile: new Map(), person: new Map() };
  const put = (map, key, rule) => { if (key) map.set(key, [...(map.get(key) || []), rule]); };
  for (const rule of companies) {
    for (const host of rule.domains) put(index.domain, host, rule);
    for (const name of rule.names) {
      put(index.name, name, rule);
      if (isCustomer(rule)) put(index.near, name.length, { name, rule });
    }
  }
  for (const rule of people) {
    for (const email of rule.emails) put(index.email, email, rule);
    for (const profile of rule.profiles) put(index.profile, profile, rule);
    put(index.person, rule.name, rule);
  }
  return index;
}

export function guardRules(ws, { customersFile } = {}) {
  const market = MARKETS.includes(loadConfig(ws).company.market) ? loadConfig(ws).company.market : 'b2b';
  const warnings = [];
  const empty = { companies: [], people: [], unreadable: [], unread_columns: [], rows: 0 };
  const listed = fs.existsSync(companiesFile(ws))
    ? readRules(readCsv(companiesFile(ws), 'context/exclusions/companies.csv'), 'context/exclusions/companies.csv', { market, companyFile: true })
    : empty;
  const known = fs.existsSync(peopleFile(ws))
    ? readRules(readCsv(peopleFile(ws), 'context/exclusions/people.csv'), 'context/exclusions/people.csv', { market, peopleNames: true })
    : empty;
  for (const [file, rules] of [['companies.csv', listed], ['people.csv', known]]) {
    if (rules.unreadable.length) warnings.push(`${rules.unreadable.length} ${rules.unreadable.length === 1 ? 'row' : 'rows'} in context/exclusions/${file} name nobody the guard can match (line ${rules.unreadable.slice(0, 5).join(', ')}), so they protect nobody.`);
  }

  // A customer export, such as your billing or product users, read for this run only.
  let extra = empty;
  let customersExport = null;
  if (customersFile) {
    const full = locate(ws, customersFile);
    if (!full) fail('missing_file', `No customer list at ${customersFile}.`);
    const parsed = readCsv(full, customersFile);
    extra = readRules(parsed, 'customer export', { market, reason: 'customer' });
    // An export that loads nobody would leave every customer unprotected without a word.
    if (parsed.rows.length && !extra.companies.length && !extra.people.length) {
      fail('unreadable_customers', `${customersFile} has ${parsed.rows.length} rows, but none of its columns names an email, a domain, a company or a LinkedIn profile, so it would protect nobody.`, `Its columns are: ${parsed.header.join(', ')}. Rename the ones that identify a customer to email, domain, company or linkedin.`);
    }
    if (extra.unreadable.length) warnings.push(`${extra.unreadable.length} of ${parsed.rows.length} rows in ${customersFile} name nobody the guard can match (line ${extra.unreadable.slice(0, 5).join(', ')}), so those customers are not protected.`);
    customersExport = { file: customersFile, rows: parsed.rows.length, people: extra.people.length, companies: extra.companies.length, unread_columns: extra.unread_columns };
  }

  const companies = [...listed.companies, ...extra.companies];
  const people = [...known.people, ...extra.people];
  return {
    market,
    companies,
    people,
    index: buildIndex(companies, people),
    customers: companies.filter(isCustomer).length,
    customer_people: people.filter(isCustomer).length,
    customers_export: customersExport,
    warnings,
  };
}

// The one matcher. `gluely guard`, `gluely check company` and the exclusion tests all ask
// here, so they can't disagree. Every identifier is checked, and the strictest rule wins.
export function matchCompany(index, { domains = [], names = [] }) {
  const hits = [];
  for (const d of domains) for (const rule of index.domain.get(registrable(d.value)) || []) hits.push({ rule, on: d.on, rank: 0 });
  for (const name of names) for (const rule of index.name.get(name) || []) hits.push({ rule, on: 'company_name', rank: 1 });
  // A customer one typo away is held too, because a misspelled export still names your customer.
  if (!hits.some((h) => isCustomer(h.rule))) {
    for (const name of names) {
      for (const length of [name.length - 1, name.length, name.length + 1]) {
        for (const near of index.near.get(length) || []) if (nearName(near.name, name)) hits.push({ rule: near.rule, on: 'near_name', rank: 2 });
      }
    }
  }
  return strictest(hits);
}

// A person is known by any of their emails or profiles. A name alone can't prove it is
// the same person, and can't prove it isn't, so a shared name goes to a human too.
export function matchPerson(index, { emails = [], profiles = [], person = '' }) {
  const hits = [];
  for (const email of emails) for (const rule of index.email.get(email) || []) hits.push({ rule, on: 'email', rank: 0 });
  for (const profile of profiles) for (const rule of index.profile.get(profile) || []) hits.push({ rule, on: 'linkedin', rank: 0 });
  if (person) for (const rule of index.person.get(person) || []) hits.push({ rule, on: 'person_name', rank: 1 });
  return strictest(hits);
}

const companyIds = (read) => ({
  domains: read.domains,
  names: [...new Set([...read.companies.map(companyName), ...read.domains.map((d) => domainName(d.value))].filter(Boolean))],
});

// One row in, one decision out. Held beats owner, and owner beats clear. A row is cleared
// only when something in it was positively checked against the rules.
export function sortRow(read, { index, market = 'b2b', customer_people: customerPeople = 0 }, { overflow = false } = {}) {
  const ids = companyIds(read);
  const company = matchCompany(index, ids);
  const person = matchPerson(index, read);
  const because = (hit) => ({ matched_on: hit.on, matched_rule: hit.rule.source });

  if (company && isCustomer(company.rule)) {
    const { label, reason } = company.rule;
    const why = company.on === 'near_name'
      ? `looks like ${label}, a ${reason}, one letter apart. Held like a customer until a person checks`
      : company.on === 'company_name'
        ? `shares a name with ${label}, a ${reason}. Held like a customer until a person checks`
        : `${label} is a ${reason}. Customer data never goes to an outside tool`;
    return { bucket: 'held', reason: why, ...because(company) };
  }
  if (person && isCustomer(person.rule)) {
    const why = person.on === 'person_name' ? 'shares a name with a customer. Held like a customer until a person checks' : 'a customer. Customer data never goes to an outside tool';
    return { bucket: 'held', reason: why, ...because(person) };
  }
  if (overflow) return { bucket: 'held', reason: 'has more cells than the header has columns, so its columns cannot be trusted. Put quotes around the cell that holds a comma' };

  if (person) {
    const who = person.rule.reason || 'a known person';
    const what = person.on === 'person_name' ? `shares a name with someone in people.csv (${who})` : who;
    return person.rule.owner
      ? { bucket: 'owner', owner: person.rule.owner, reason: `${what}. ${person.rule.owner} decides first`, ...because(person) }
      : { bucket: 'held', reason: `${what}, with no owner named in people.csv`, ...because(person) };
  }
  if (company) {
    const { label, reason, owner } = company.rule;
    return owner
      ? { bucket: 'owner', owner, reason: `${label} is a ${reason || 'known company'}. ${owner} decides first`, ...because(company) }
      : { bucket: 'held', reason: `${label} is excluded: ${reason || 'excluded'}`, ...because(company) };
  }

  if (!ids.domains.length && !ids.names.length) {
    const reachable = read.emails.length || read.profiles.length;
    // In B2C a person is the customer, so a person can be checked without a company.
    if (market === 'b2b' || !reachable) return { bucket: 'held', reason: 'no company or work domain, so it cannot be checked against your customers' };
    if (!customerPeople) return { bucket: 'held', reason: 'no customer list to check people against. Pass --customers <export.csv>' };
  }
  return { bucket: 'clear', reason: 'not a customer or a known relationship' };
}

// The same answer the guard would give for one company, by domain or by name.
export function checkCompany(ws, value) {
  const { index } = guardRules(ws);
  const domain = normalizeDomain(value);
  const ids = isDomain(domain)
    ? { domains: [{ value: domain, on: 'domain' }], names: [domainName(domain)].filter(Boolean) }
    : { domains: [], names: [companyName(value)].filter(Boolean) };
  const hit = matchCompany(index, ids);
  return {
    domain,
    blocked: Boolean(hit),
    reason: hit ? hit.rule.reason || 'excluded' : null,
    matched_on: hit?.on || null,
    matched_rule: hit?.rule.source || null,
  };
}

const BUCKETS = ['clear', 'owner', 'held'];
const READABLE = ['domain', 'email', 'company', 'linkedin', 'person', 'first', 'last'];

function toCsv(header, rows) {
  const cell = (v) => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''));
  return [header, ...rows.map((r) => header.map((h) => r[h]))].map((r) => r.map(cell).join(',')).join('\n') + '\n';
}

export function guardFile(ws, file, { to, by, customers, write = true } = {}) {
  if (!file) fail('usage', 'Usage: gluely guard <list.csv> [--to <tool>]');
  const full = locate(ws, file);
  if (!full) fail('missing_file', `No file at ${file}.`);
  const { header, rows, lines, overflow } = readCsv(full, file);
  if (!header.length) fail('empty_list', `${file} has no header row.`);

  const rules = guardRules(ws, { customersFile: customers });
  const roles = rolesFor(header);
  const reads = rows.map((row) => readRow(row, roles, rules.market));
  const used = new Set(reads.flatMap((read) => [...read.used]));
  if (!header.some((h) => READABLE.includes(roles[h])) && !used.size) {
    fail('unknown_columns', `${file} has none of the columns the guard reads.`, 'Add one of: domain, email, company, linkedin.');
  }

  const shifted = new Set(overflow);
  const sorted = rows.map((row, i) => ({ line: lines[i], ...sortRow(reads[i], rules, { overflow: shifted.has(lines[i]) }), row }));
  const counts = Object.fromEntries(BUCKETS.map((b) => [b, sorted.filter((s) => s.bucket === b).length]));
  const warnings = [...rules.warnings];
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
    parsed_rows: rows.length,
    counts,
    files,
    owners: [...new Set(sorted.filter((s) => s.owner).map((s) => s.owner))].sort(),
    warnings,
    // Columns nothing was read from. If one of them names a person or a company, rename it.
    unread_columns: header.filter((h) => !used.has(h) && !READABLE.includes(roles[h])),
    ...(rules.customers_export ? { customers_export: rules.customers_export } : {}),
    rows: sorted.filter((s) => s.bucket !== 'clear').map(({ line, bucket, reason, owner, matched_on: on, matched_rule: rule }) => ({
      line, bucket, reason, ...(owner ? { owner } : {}), ...(on ? { matched_on: on, matched_rule: rule } : {}),
    })),
  };
}
