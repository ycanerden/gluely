// The gate in front of every outside tool. A list goes to an enrichment tool, a scraper or
// a sender only after this sorts it: customers never leave, known people go to the person
// who owns the relationship, and only what is clearly a prospect is cleared.
// The rule: clear only what was positively checked. Anything it can't read or recognise is held.
// It reads files and writes files. It calls nothing.
import fs from 'node:fs';
import path from 'node:path';
import { addEntry } from './log.js';
import { fail } from './output.js';
import { COLUMNS, columnIndexes, decodeCsv, loadConfig, loadExclusions, normalizeDomain, parseCsv, readCsvFile } from './workspace.js';

// Anyone who has trialed, paid or churned is a customer, and their data stays home.
export const CUSTOMER_REASONS = ['customer', 'client', 'trial', 'paid', 'churned', 'former customer'];
// CRM text says the same thing in more words: "Active Customer", "ex-customer", "Customer (enterprise)".
const CUSTOMER_WORDS = /\b(?:customers?|clients?|trial(?:ed|ing|ist)?s?|paid|paying|churn(?:ed)?|subscribers?|users?)\b/;
const isCustomer = (row) => CUSTOMER_WORDS.test(String(row?.reason || '').toLowerCase());

// Mail domains that say nothing about where someone works. Any country version of the big ones counts.
const PERSONAL_MAIL = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'yahoo.com', 'ymail.com', 'rocketmail.com',
  'icloud.com', 'me.com', 'mac.com', 'proton.me', 'protonmail.com', 'protonmail.ch', 'proton.ch', 'pm.me', 'aol.com',
  'gmx.com', 'gmx.de', 'gmx.net', 'gmx.at', 'gmx.ch', 'web.de', 't-online.de', 'freenet.de', 'yandex.com', 'yandex.ru',
  'mail.com', 'mail.ru', 'tutanota.com', 'tuta.io', 'fastmail.com', 'zoho.com', 'hey.com', 'qq.com', '163.com', '126.com',
  'naver.com', 'orange.fr', 'free.fr', 'laposte.net', 'wanadoo.fr', 'sfr.fr', 'libero.it', 'virgilio.it', 'seznam.cz',
  'wp.pl', 'o2.pl', 'onet.pl', 'btinternet.com', 'sky.com', 'virginmedia.com', 'comcast.net', 'verizon.net', 'att.net',
  'telenet.be', 'skynet.be', 'ziggo.nl', 'kpnmail.nl', 'bluewin.ch', 'hushmail.com',
]);
const PERSONAL_STEMS = new Set(['gmail', 'googlemail', 'yahoo', 'ymail', 'hotmail', 'outlook', 'icloud', 'protonmail', 'proton', 'aol', 'gmx', 'yandex']);
const TWO_PART_SUFFIX = /\.(?:co|com|org|net|ac|gov|ne|or)\.[a-z]{2}$/;
const LEGAL = new Set(['inc', 'incorporated', 'llc', 'llp', 'lp', 'pllc', 'ltd', 'limited', 'gmbh', 'mbh', 'ag', 'kg', 'ohg', 'ug', 'se', 'bv', 'nv',
  'sa', 'sas', 'sarl', 'srl', 'spa', 'sl', 'sro', 'plc', 'pte', 'bhd', 'sdn', 'ltda', 'kft', 'corp', 'corporation', 'co', 'company',
  'oy', 'oyj', 'ab', 'as', 'asa', 'aps', 'pty', 'kk', 'the', 'group', 'holding', 'holdings', 'hq']);
// Sites people paste into a website column that name a profile, not an employer.
const PLATFORMS = new Set(['linkedin.com', 'lnkd.in', 'facebook.com', 'fb.com', 'instagram.com', 'twitter.com', 'x.com', 'youtube.com',
  'medium.com', 'substack.com', 'crunchbase.com', 'angel.co', 'wellfound.com', 'linktr.ee', 'about.me']);

// Letters that look Latin but aren't: Cyrillic "о" in "Cоntoso" is still Contoso.
const CONFUSABLE = { а: 'a', е: 'e', ё: 'e', о: 'o', р: 'p', с: 'c', у: 'y', х: 'x', і: 'i', ї: 'i', ј: 'j', ѕ: 's', һ: 'h', ԁ: 'd', ԛ: 'q', ԝ: 'w',
  ο: 'o', α: 'a', ε: 'e', ι: 'i', κ: 'k', ν: 'v', ρ: 'p', τ: 't', υ: 'u', χ: 'x', ı: 'i', ł: 'l', ø: 'o', đ: 'd', ß: 'ss', æ: 'ae', œ: 'oe' };
const fold = (value) => String(value || '').normalize('NFKC').toLowerCase()
  .replace(/[^\x00-\x7f]/g, (ch) => CONFUSABLE[ch] ?? ch).normalize('NFKD').replace(/[̀-ͯ]/g, '');

// "Acme, Inc.", "ACME GmbH & Co. KG", "Acme S.A." and "Cоntoso" (Cyrillic о) all normalise to one name.
export const normalizeName = (value) => fold(value)
  .replace(/\b(?:[a-z]\.){2,}/g, (m) => m.replace(/\./g, ''))
  .replace(/[^a-z0-9 ]+/g, ' ')
  .split(/\s+/).filter((w) => w && w !== 'and' && !LEGAL.has(w)).join(' ');

export const domainName = (domain) => {
  const clean = normalizeDomain(domain);
  if (!clean.includes('.')) return '';
  const base = clean.replace(TWO_PART_SUFFIX, '').replace(/\.[^.]+$/, '');
  return base.split('.').pop();
};

const isPersonal = (domain) => PERSONAL_MAIL.has(domain) || PERSONAL_STEMS.has(domainName(domain));

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

// "Contoso Labs", "Contoso (UK)", "ContosoLtd" and "contoso-eu" all start with Contoso. So does
// "Tailspin" for "Tailspin Toys". A look-alike is held, or goes to its owner, until a person checks.
// Whole words count for any exclusion. A glued prefix ("ContosoLtd", "contosogroup") is looser,
// so like a typo it only counts for customers.
export function lookAlike(row, rule, { glued = false } = {}) {
  if (!row || !rule || row === rule) return false;
  const a = row.split(' ');
  const b = rule.split(' ');
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.join('').length >= 4 && short.every((w, i) => long[i] === w)) return true;
  const stem = b.join('');
  return glued && stem.length >= NEAR_MIN && a.join('').startsWith(stem);
}

const EMAIL = /[\p{L}\p{N}._%+'-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu;
const emailsIn = (value) => (String(value || '').toLowerCase().match(EMAIL) || []).map((e) => e.replace(/^[.'-]+|\.+$/g, ''));

// jane+news@gmail.com, j.a.n.e@gmail.com and jane@googlemail.com are one inbox.
export function canonicalEmail(email) {
  const at = email.lastIndexOf('@');
  let local = email.slice(0, at).toLowerCase().replace(/\+.*$/, '');
  let domain = normalizeDomain(email.slice(at + 1));
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (domain === 'gmail.com') local = local.replace(/\./g, '');
  return `${local}@${domain}`;
}

const DOMAIN_LIKE = /(?:^|[\s(])((?:[\p{L}\p{N}-]+\.)+[a-z]{2,})(?=$|[\s),;/])/giu;
const domainsInCell = (value) => String(value || '').split(/[\s,;|]+/).map(normalizeDomain).filter(Boolean);
const companySlug = (value) => {
  const slug = String(value || '').match(/linkedin\.com\/(?:company|school|showcase)\/([^/?#\s]+)/i)?.[1];
  return slug ? normalizeName(decodeURIComponent(slug).replace(/[-_]+/g, ' ')) : '';
};
const normalizeProfile = (value) => {
  const clean = String(value || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^[a-z]{2,3}\.linkedin\.com/, 'linkedin.com')
    .replace(/^www\./, '').replace(/[?#].*$/, '').replace(/\/+$/, '');
  return clean.includes('/') ? clean : '';
};
const personTokens = (value) => fold(value).split(/[^a-z]+/).filter((t) => t.length >= 2);
const localTokens = (email) => personTokens(email.slice(0, email.lastIndexOf('@')).replace(/\+.*$/, ''));

// Every identifier in a row: the domain and website columns, every email address in any column,
// company names (and a domain typed as a name), LinkedIn profiles and the person's name.
// In B2C an email names a person, so only a domain column names a company.
function readRow(cells, header, market) {
  const get = (kind) => columnIndexes(header, kind).map((i) => cells[i] || '').filter((v) => v.trim());
  const domains = new Set();
  const names = new Set();
  const companyCells = get('company');
  for (const value of [...get('domain'), ...companyCells, ...get('linkedin')]) {
    const slug = companySlug(value);
    if (slug) names.add(slug);
  }
  for (const value of get('domain')) for (const d of domainsInCell(value)) if (!PLATFORMS.has(d)) domains.add(d);
  for (const value of companyCells) {
    names.add(normalizeName(value));
    for (const [, d] of String(value).matchAll(DOMAIN_LIKE)) {
      const clean = normalizeDomain(d);
      if (clean && !PLATFORMS.has(clean) && !isPersonal(clean)) domains.add(clean);
    }
  }
  const emails = [...new Set(cells.flatMap(emailsIn))];
  if (market !== 'b2c') {
    for (const email of emails) {
      const d = normalizeDomain(email.split('@').pop());
      if (d && !isPersonal(d)) domains.add(d);
    }
  }
  for (const d of domains) names.add(normalizeName(domainName(d)));
  names.delete('');
  const profiles = new Set(get('linkedin').map(normalizeProfile).filter((p) => p.includes('/in/')));
  for (const cell of cells) for (const m of String(cell).matchAll(/linkedin\.com\/in\/[^/?#\s,]+/gi)) profiles.add(normalizeProfile(m[0]));
  const tokenSets = [...get('name').map(personTokens), ...emails.map(localTokens)].filter((t) => t.length).map((t) => new Set(t));
  return {
    domains: [...domains],
    names: [...names],
    emails: emails.map(canonicalEmail),
    profiles: [...profiles],
    tokenSets,
  };
}

const companyRule = (row, source) => {
  const domain = normalizeDomain(row.domain);
  const names = [...new Set([normalizeName(row.name), normalizeName(domainName(domain))].filter(Boolean))];
  return { domain, names, name: row.name, reason: row.reason, owner: row.owner, source };
};

function readFile(file, label) {
  const { text, error } = decodeCsv(fs.readFileSync(file));
  if (error) fail('bad_encoding', `${label} ${error}.`, 'Save it as UTF-8 (in Excel: "CSV UTF-8"). Nothing was sorted.');
  return parseCsv(text);
}

function refuseBroken(label, problems) {
  if (!problems.length) return;
  const where = problems.slice(0, 5).map((p) => `line ${p.line}: ${p.problem}`).join('; ');
  fail('bad_csv', `${label} can't be read safely: ${where}.`, 'Fix those lines or export the file again. Nothing was sorted.');
}

export function loadPeople(ws) {
  const file = path.join(ws, 'context', 'exclusions', 'people.csv');
  if (!fs.existsSync(file)) return [];
  const { text, error } = decodeCsv(fs.readFileSync(file));
  return error ? [] : parseCsv(text).rows;
}

function personRules(ws) {
  const rel = 'context/exclusions/people.csv';
  const file = path.join(ws, rel);
  if (!fs.existsSync(file)) return [];
  const parsed = readFile(file, rel);
  refuseBroken(rel, parsed.problems);
  const { header } = parsed;
  const first = (cells, kind) => columnIndexes(header, kind).map((i) => cells[i]).find(Boolean) || '';
  const people = parsed.records.map((record) => {
    const keys = readRow(record.cells, header, 'b2b');
    const name = first(record.cells, 'name');
    const tokens = personTokens(name).length ? personTokens(name) : keys.emails.flatMap(localTokens).slice(0, 1);
    return { ...keys, name, tokens, reason: first(record.cells, 'reason'), owner: first(record.cells, 'owner'), source: `${rel}:${record.line}` };
  }).filter((p) => p.emails.length || p.profiles.length || (p.tokens.length && (p.domains.length || p.names.length)));
  if (parsed.records.length && !people.length) {
    fail('unknown_columns', `${rel} has rows, but no email, LinkedIn or name with a company in them, so it protects nobody.`, `Use columns such as: email, linkedin, name, company, reason, owner.`);
  }
  return people;
}

export const MARKETS = ['b2b', 'b2c', 'both'];

// A customer export, such as your billing or product users, read for this run only.
// A file the guard can't read protects nobody, so it is refused rather than skipped.
// In B2C a work email names a person, not a company, so it never marks a whole company.
function readCustomers(file, market) {
  if (!file) return { people: [], companies: [], loaded: null };
  const full = path.resolve(file);
  if (!fs.existsSync(full)) fail('missing_file', `No customer list at ${file}.`);
  const parsed = readFile(full, file);
  refuseBroken(file, parsed.problems);
  const known = ['domain', 'email', 'company', 'linkedin'];
  if (!known.some((kind) => columnIndexes(parsed.header, kind).length)) {
    fail('unknown_columns', `${file} has none of the columns the guard reads (${parsed.raw.join(', ')}), so it would protect no customer.`,
      `Rename a column to one of: ${[...COLUMNS.email, ...COLUMNS.domain, ...COLUMNS.company].join(', ')}.`);
  }
  const people = [];
  const companies = [];
  let loaded = 0;
  for (const record of parsed.records) {
    const keys = readRow(record.cells, parsed.header, market);
    const source = `${path.basename(file)}:${record.line}`;
    let found = false;
    if (keys.emails.length || keys.profiles.length) {
      people.push({ ...keys, domains: [], names: [], tokens: [], reason: 'customer', source });
      found = true;
    }
    if (market !== 'b2c') {
      for (const domain of keys.domains) companies.push(companyRule({ domain, reason: 'customer' }, source));
      for (const name of columnIndexes(parsed.header, 'company').map((i) => record.cells[i]).filter(Boolean)) companies.push(companyRule({ name, reason: 'customer' }, source));
      found ||= keys.domains.length > 0 || keys.names.length > 0;
    }
    if (found) loaded++;
  }
  if (!loaded) fail('empty_customers', `${file} names no customer the guard can check.`, 'Pass an export with an email, domain or company column filled in.');
  return { people, companies, loaded };
}

export function guardRules(ws, { customersFile } = {}) {
  const config = loadConfig(ws);
  const market = MARKETS.includes(config.company.market) ? config.company.market : 'b2b';
  const exclusions = loadExclusions(ws);
  refuseBroken('context/exclusions/companies.csv', exclusions.problems);
  const listed = exclusions.rows.filter((r) => r.domain || r.name);
  if (exclusions.rows.length && !listed.length) {
    fail('unknown_columns', `context/exclusions/companies.csv has rows, but no domain or company name in them (${exclusions.raw.join(', ')}), so it protects nobody.`,
      'Use the columns domain, name, reason, owner.');
  }
  const extra = readCustomers(customersFile, market);
  const companies = [...listed.map((r) => companyRule(r, `context/exclusions/companies.csv:${r.line}`)), ...extra.companies];
  const people = [...personRules(ws), ...extra.people];
  return {
    market,
    companies,
    people,
    customers: companies.filter(isCustomer).length,
    customer_people: people.filter(isCustomer).length,
    customers_loaded: extra.loaded,
  };
}

// Held beats owner, and owner beats clear. Among several matches, a customer wins.
const strongest = (matches) => matches.find((m) => isCustomer(m.rule)) || matches.find((m) => !m.rule.owner) || matches[0];

function matchCompany(keys, companies) {
  const matches = [];
  for (const rule of companies) {
    let how = null;
    if (rule.domain && keys.domains.some((d) => d === rule.domain || d.endsWith(`.${rule.domain}`))) how = 'domain';
    else if (rule.names.some((n) => keys.names.includes(n))) how = 'name';
    else if (rule.names.some((n) => keys.names.some((m) => lookAlike(m, n, { glued: isCustomer(rule) })))) how = 'look-alike';
    else if (isCustomer(rule) && rule.names.some((n) => keys.names.some((m) => nearName(m, n)))) how = 'typo';
    if (how) matches.push({ rule, how });
  }
  return matches.length ? strongest(matches) : null;
}

const sameCompany = (keys, person) => person.domains.some((d) => keys.domains.some((k) => k === d || k.endsWith(`.${d}`) || d.endsWith(`.${k}`)))
  || person.names.some((n) => keys.names.includes(n));

function matchPerson(keys, people) {
  const matches = [];
  for (const rule of people) {
    let how = null;
    if (rule.emails.some((e) => keys.emails.includes(e))) how = 'email';
    else if (rule.profiles.some((p) => keys.profiles.includes(p))) how = 'linkedin';
    else if (rule.tokens.length && sameCompany(keys, rule) && keys.tokenSets.some((set) => rule.tokens.every((t) => set.has(t)))) how = 'name at the same company';
    if (how) matches.push({ rule, how });
  }
  return matches.length ? strongest(matches) : null;
}

const listedAs = (rule) => (rule.reason ? `listed as ${rule.reason}` : 'on your exclusion list');

function companyDecision({ rule, how }) {
  const label = rule.name || rule.domain;
  const base = { matched_on: how, rule: rule.source };
  if (isCustomer(rule)) {
    if (how === 'domain') return { ...base, bucket: 'held', reason: `${label} is ${listedAs(rule)}. Customer data never goes to an outside tool` };
    if (how === 'name') return { ...base, bucket: 'held', reason: `shares a name with ${label}, ${listedAs(rule)}. Held like a customer until a person checks` };
    return { ...base, bucket: 'held', reason: `looks like ${label}, ${listedAs(rule)}. Held like a customer until a person checks` };
  }
  const prefix = how === 'domain' || how === 'name' ? `${label} is ${listedAs(rule)}` : `looks like ${label}, ${listedAs(rule)}`;
  return rule.owner
    ? { ...base, bucket: 'owner', owner: rule.owner, reason: `${prefix}. ${rule.owner} decides first` }
    : { ...base, bucket: 'held', reason: `${prefix}, with no owner to decide. Held` };
}

function personDecision({ rule, how }) {
  const base = { matched_on: how, rule: rule.source };
  const who = how === 'name at the same company' ? `looks like ${rule.name || 'a known person'} at the same company, ` : '';
  if (isCustomer(rule)) return { ...base, bucket: 'held', reason: `${who}a customer. Customer data never goes to an outside tool` };
  const reason = `${who}${rule.reason || 'a known person'}`;
  return rule.owner
    ? { ...base, bucket: 'owner', owner: rule.owner, reason: `${reason}. ${rule.owner} decides first` }
    : { ...base, bucket: 'held', reason: `${reason}, with no owner named in people.csv` };
}

// One row in, one decision out.
export function sortRow(keys, { companies, people, market = 'b2b', customer_people: customerPeople = 0 }, flags = []) {
  const company = matchCompany(keys, companies);
  const person = matchPerson(keys, people);
  const decisions = [person && personDecision(person), company && companyDecision(company)].filter(Boolean);
  const held = decisions.find((d) => d.bucket === 'held');
  if (held) return held;
  if (flags.length) return { bucket: 'held', matched_on: 'unreadable row', reason: `this row is malformed (${flags.join('; ')}), so it cannot be checked` };
  if (decisions.length) return decisions[0];

  const hasCompany = keys.domains.length > 0 || keys.names.length > 0;
  const hasPerson = keys.emails.length > 0 || keys.profiles.length > 0;
  const noCompany = { bucket: 'held', matched_on: 'nothing to check', reason: 'no company or work domain, so it cannot be checked against your customers' };
  const noPeople = { bucket: 'held', matched_on: 'nothing to check', reason: 'no customer list to check people against. Pass --customers <export.csv>' };
  if (market === 'b2b' && !hasCompany) return noCompany;
  if (market === 'b2c') {
    if (!hasPerson) return { bucket: 'held', matched_on: 'nothing to check', reason: 'no email or profile, so the person cannot be checked against your customers' };
    if (!customerPeople) return noPeople;
  }
  if (market === 'both' && !hasCompany) {
    if (!hasPerson) return noCompany;
    if (!customerPeople) return noPeople;
  }
  return { bucket: 'clear', reason: 'not a customer or a known relationship' };
}

// Is this one company excluded? The same matcher as the guard, so the answers never disagree.
export function checkCompany(ws, value) {
  const rules = guardRules(ws);
  const domain = normalizeDomain(value);
  const keys = readRow([String(value)], [domain ? 'domain' : 'company'], rules.market === 'b2c' ? 'b2b' : rules.market);
  const match = matchCompany(keys, rules.companies);
  const decision = match ? companyDecision(match) : null;
  return {
    domain: domain || null,
    company: domain ? null : String(value),
    blocked: Boolean(match),
    reason: match ? match.rule.reason || 'excluded' : null,
    ...(decision ? { matched_on: decision.matched_on, why: decision.reason, rule: decision.rule, ...(decision.owner ? { owner: decision.owner } : {}) } : {}),
  };
}

const BUCKETS = ['clear', 'owner', 'held'];
const IDENTIFIER_HINT = /mail|domain|website|url|linkedin|company|organi[sz]ation|account|employer/;

function toCsv(header, rows) {
  const cell = (v) => (/[",\n\r]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''));
  return [header, ...rows].map((r) => r.map(cell).join(',')).join('\n') + '\n';
}

export function guardFile(ws, file, { to, by, customers, write = true } = {}) {
  if (!file) fail('usage', 'Usage: gluely guard <list.csv> [--to <tool>]');
  const full = path.resolve(file);
  if (!fs.existsSync(full)) fail('missing_file', `No file at ${file}.`);
  const parsed = readCsvFile(full, file);
  refuseBroken(file, parsed.problems);
  const { header, raw, records } = parsed;
  if (!header.length) fail('empty_list', `${file} has no header row.`);
  const read = ['domain', 'email', 'company', 'linkedin', 'name'];
  if (!read.some((kind) => columnIndexes(header, kind).length)) {
    fail('unknown_columns', `${file} has none of the columns the guard reads.`, `Add one of: ${[...COLUMNS.domain, ...COLUMNS.email, ...COLUMNS.company].join(', ')}.`);
  }

  const rules = guardRules(ws, { customersFile: customers });
  const sorted = records.map((record) => ({
    line: record.line,
    ...sortRow(readRow(record.cells, header, rules.market), rules, record.flags),
    cells: record.cells,
  }));
  const counts = Object.fromEntries(BUCKETS.map((b) => [b, sorted.filter((s) => s.bucket === b).length]));
  const readIndexes = new Set(read.flatMap((kind) => columnIndexes(header, kind)));
  const unread = raw.filter((_, i) => !readIndexes.has(i));
  const warnings = [];
  if (rules.market !== 'b2c' && !rules.customers) warnings.push('No customers in context/exclusions/companies.csv, so the guard cannot protect them. Add everyone who trialed, paid or churned, with reason customer, trial or churned.');
  if (rules.market !== 'b2b' && !rules.customer_people) warnings.push('No customer people to check against. Pass your user or billing export with --customers <export.csv>, and keep it in exports/.');
  const suspicious = unread.filter((h) => IDENTIFIER_HINT.test(h.toLowerCase()));
  if (suspicious.length) warnings.push(`Not read as identifiers: ${suspicious.join(', ')}. Email addresses in them are still checked; rename a column if it names the company.`);

  const files = {};
  if (write) {
    const outDir = path.join(ws, 'exports', 'guard');
    fs.mkdirSync(outDir, { recursive: true });
    const base = path.basename(full).replace(/\.csv$/i, '');
    for (const bucket of BUCKETS) {
      const target = path.join(outDir, `${base}.${bucket}.csv`);
      const extra = bucket === 'clear' ? [] : ['guard_reason', ...(bucket === 'owner' ? ['owner'] : [])];
      const list = sorted.filter((s) => s.bucket === bucket)
        .map((s) => [...s.cells, ...(bucket === 'clear' ? [] : [s.reason, ...(bucket === 'owner' ? [s.owner] : [])])]);
      fs.writeFileSync(target, toCsv([...raw, ...extra], list));
      files[bucket] = path.relative(ws, target);
    }
    addEntry(ws, {
      kind: 'result', area: 'exclusion', source: 'gluely', by: by || 'gluely',
      text: `Guard${to ? ` before ${to}` : ''}: ${counts.clear} clear, ${counts.owner} to owners, ${counts.held} held, of ${records.length}`,
    });
  }

  return {
    file: path.relative(ws, full).startsWith('..') ? full : path.relative(ws, full),
    market: rules.market,
    to: to || null,
    total: records.length,
    lines: parsed.lines,
    counts,
    files,
    owners: [...new Set(sorted.filter((s) => s.owner).map((s) => s.owner))].sort(),
    columns_read: raw.filter((_, i) => readIndexes.has(i)),
    unread_columns: unread,
    ...(rules.customers_loaded !== null ? { customers_loaded: rules.customers_loaded } : {}),
    warnings,
    rows: sorted.filter((s) => s.bucket !== 'clear')
      .map(({ line, bucket, reason, owner, matched_on: on, rule }) => ({ line, bucket, reason, ...(owner ? { owner } : {}), matched_on: on, ...(rule ? { rule } : {}) })),
  };
}
