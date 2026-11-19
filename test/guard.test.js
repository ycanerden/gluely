// The gate fails closed. Each test here is one way a customer or a known person once
// reached the `clear` file, or one way the gate now refuses to guess.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { columnRole, normalizeEmail, normalizePerson, normalizeProfile, registrable } from '../src/guard.js';
import { normalizeDomain, parseCsv } from '../src/workspace.js';
import { fillContext, gluely, makeWorkspace, tempDir, write } from './helpers.js';

const CUSTOMERS = 'domain,name,reason,owner\ncustomer.example,Globex Corp,customer,\nfund.example,Seed Fund,investor,dana\n';

function workspace(companies = CUSTOMERS) {
  const ws = makeWorkspace();
  fillContext(ws);
  write(ws, 'context/exclusions/companies.csv', companies);
  return ws;
}

const guard = (ws, lines, ...flags) => {
  write(ws, 'exports/list.csv', `${lines.join('\n')}\n`);
  return gluely(['guard', 'exports/list.csv', ...flags, '--json'], ws);
};
const rowAt = (result, line) => result.json.rows.find((r) => r.line === line);

test('a junk domain column cannot hide a customer\'s email', () => {
  const ws = workspace();
  const result = guard(ws, [
    'name,email,domain',
    'A,a@customer.example,n/a',
    'B,b@customer.example,https://www.linkedin.com/in/someone-b',
    'C,c@mail.customer.example,prospect.example',
    'D,d@gmail.com,-',
    'E,e@prospect.example,prospect.example',
  ]);
  assert.equal(result.code, 0, result.out);
  assert.deepEqual(result.json.counts, { clear: 1, owner: 0, held: 4 });
  for (const line of [2, 3, 4]) {
    assert.equal(rowAt(result, line).matched_on, 'email_domain');
    assert.equal(rowAt(result, line).matched_rule, 'context/exclusions/companies.csv:2');
  }
  assert.match(rowAt(result, 5).reason, /cannot be checked/);
  const clear = fs.readFileSync(path.join(ws, result.json.files.clear), 'utf8');
  assert.match(clear, /e@prospect\.example/);
  assert.doesNotMatch(clear, /customer\.example/);
});

test('columns are read by what they mean, and an email is read wherever it sits', () => {
  const ws = workspace();
  const result = guard(ws, [
    'Full Name,Work Email,Company Name,Contact Owner,Notes,Title',
    'A,a@customer.example,,rep@acme.example,,VP Sales',
    'B,,Globex Corp.,rep@acme.example,,CRO',
    'C,c@gmail.com,Unknown,rep@acme.example,intro from someone@customer.example,CEO',
    'D,d@gmail.com,N/A,rep@fund.example,,CFO',
    'E,e@prospect.example,Prospect,rep@fund.example,,COO',
  ]);
  assert.equal(result.code, 0, result.out);
  assert.deepEqual(result.json.counts, { clear: 1, owner: 0, held: 4 });
  assert.equal(rowAt(result, 2).matched_on, 'email_domain');
  assert.equal(rowAt(result, 3).matched_on, 'company_name');
  assert.equal(rowAt(result, 4).matched_on, 'email_domain');
  // "N/A" names no company, and a teammate's address in an owner column names no prospect.
  assert.match(rowAt(result, 5).reason, /cannot be checked/);
  assert.deepEqual(result.json.unread_columns, ['contact owner', 'title']);
  assert.equal(result.json.parsed_rows, 5);

  assert.equal(columnRole('Company Domain Name'), 'domain');
  assert.equal(columnRole('Associated Company'), 'company');
  assert.equal(columnRole('Company size'), null);
  assert.equal(columnRole('E-mail'), 'email');
  assert.equal(columnRole('Account Owner Email'), 'ours');
  assert.equal(columnRole('name'), 'person');
  assert.equal(columnRole('name', { companyFile: true }), 'company');
});

test('a customer export is read whatever its columns are called, and never loads nobody in silence', () => {
  const ws = workspace('domain,name,reason,owner\n');
  write(ws, 'exports/customers.csv', 'Email Address,Associated Company,Company Domain Name,Plan\nbuyer@bigco.example,BigCo Ltd,bigco.example,pro\nsolo@gmail.com,,,free\n,,,free\n');
  const result = guard(ws, [
    'email,company',
    'new@bigco.example,BigCo',
    'other@elsewhere.example,Big Co Holdings',
    'solo+news@googlemail.com,Fresh Startup',
    'fresh@prospect.example,Prospect',
  ], '--customers', 'exports/customers.csv');
  assert.equal(result.code, 0, result.out);
  assert.deepEqual(result.json.counts, { clear: 2, owner: 0, held: 2 });
  assert.equal(rowAt(result, 2).matched_rule, 'customer export:2');
  assert.match(rowAt(result, 4).reason, /a customer/);
  assert.deepEqual(result.json.customers_export, { file: 'exports/customers.csv', rows: 3, people: 2, companies: 1, unread_columns: ['plan'] });
  assert.match(result.json.warnings.join(' '), /1 of 3 rows in exports\/customers\.csv/);

  write(ws, 'exports/odd-customers.csv', 'Record ID,Plan\n1,pro\n2,free\n');
  const refused = gluely(['guard', 'exports/list.csv', '--customers', 'exports/odd-customers.csv', '--json'], ws);
  assert.equal(refused.code, 1);
  assert.equal(refused.json.error.code, 'unreadable_customers');
  assert.match(refused.json.error.hint, /record id, plan/);
});

test('a broken quote stops the guard instead of swallowing rows', () => {
  const ws = workspace();
  fs.rmSync(path.join(ws, 'exports'), { recursive: true, force: true });
  const broken = guard(ws, [
    'name,email,company',
    'A,a@prospect.example,"Prospect',
    'B,b@customer.example,Globex Corp',
    'C,c@other.example,Other',
  ]);
  assert.equal(broken.code, 1);
  assert.equal(broken.json.error.code, 'broken_csv');
  assert.match(broken.json.error.message, /line 2/);
  assert.equal(fs.existsSync(path.join(ws, 'exports/guard')), false);

  // A quote inside a cell is only a character, and a comma nobody quoted shifts the row, so it is held.
  const result = guard(ws, [
    'name,email,company',
    'A,a@pipes.example,5" Pipes Ltd',
    'B,b@customer.example,Globex Corp',
    'C,c@other.example,Other, Inc',
  ]);
  assert.equal(result.code, 0, result.out);
  assert.equal(result.json.total, 3);
  assert.deepEqual(result.json.counts, { clear: 1, owner: 0, held: 2 });
  assert.match(rowAt(result, 3).reason, /customer/);
  assert.match(rowAt(result, 4).reason, /more cells than the header/);
});

test('a broken exclusion file is an error everywhere, never a shorter list of customers', () => {
  const ws = workspace('domain,name,reason,owner\nfirst.example,"First,customer,\ncustomer.example,Globex Corp,customer,\n');
  const result = guard(ws, ['email', 'b@customer.example']);
  assert.equal(result.json.error.code, 'broken_csv');
  assert.match(result.json.error.message, /companies\.csv/);
  assert.equal(gluely(['check', 'company', 'customer.example', '--json'], ws).json.error.code, 'broken_csv');
  const check = gluely(['context', 'check', '--json'], ws);
  assert.equal(check.code, 1);
  assert.ok(check.json.issues.some((i) => i.level === 'error' && i.file === 'context/exclusions/companies.csv' && /never closes|line break/.test(i.message)));
  // The home screen still opens, and the exclusion tests fail instead of crashing.
  assert.equal(gluely(['doctor', '--json'], ws).code, 0);
});

test('a known person is found by any email, profile or name, not only by one exact address', () => {
  const ws = workspace();
  write(ws, 'context/exclusions/people.csv', [
    'email,linkedin,name,reason,owner',
    'pat.jones@gmail.com,https://www.linkedin.com/in/pat-jones/,Pat Jones,close friend,sam',
    'kim@old-employer.example,,Kim Advisor,advisor,',
  ].join('\n') + '\n');
  const result = guard(ws, [
    'name,email,company,linkedin,notes',
    'P,PatJones+work@googlemail.com,Newco,,',
    'P,p@newco.example,Newco,https://uk.linkedin.com/in/Pat-Jones?trk=people,',
    '"Jones, Pat",pat@newco.example,Newco,,',
    'Q,q@newco.example,Newco,,ask pat.jones@gmail.com for an intro',
    'Dr. Kim Advisor,kim@newco.example,Newco,,',
    'Sam Other,s@newco.example,Newco,,',
  ]);
  assert.equal(result.code, 0, result.out);
  assert.deepEqual(result.json.counts, { clear: 1, owner: 4, held: 1 });
  assert.deepEqual([2, 3, 4, 5].map((line) => rowAt(result, line).matched_on), ['email', 'linkedin', 'person_name', 'email']);
  assert.match(rowAt(result, 4).reason, /shares a name with someone in people\.csv \(close friend\)\. sam decides first/);
  assert.match(rowAt(result, 6).reason, /no owner/);
  assert.doesNotMatch(JSON.stringify(result.json), /pat\.jones@|patjones/i);

  assert.equal(normalizeEmail('Pat.Jones+x@GoogleMail.com'), 'patjones@gmail.com');
  assert.equal(normalizeEmail('Pat.Jones+x@Work.example'), 'pat.jones@work.example');
  assert.equal(normalizeProfile('https://de.linkedin.com/in/Pat-Jones/?originalSubdomain=de'), 'linkedin.com/in/pat-jones');
  assert.equal(normalizePerson('Dr. Pat O\'Neil'), normalizePerson('O\'Neil, Pat'));
  assert.equal(normalizePerson('Pat'), '');
});

test('check company, the exclusion tests and the guard give one answer', () => {
  const ws = workspace('domain,name,reason,owner\ncustomer.example,Globex Corp,customer,\nrival.example,Rival,competitor,\n');
  const check = (value) => gluely(['check', 'company', value, '--json'], ws).json;
  const cases = [
    ['customer.example', 'domain'],
    ['https://app.customer.example/login', 'domain'],
    ['someone@customer.example', 'domain'],
    ['globex.io', 'company_name'],
    ['Globex Corp.', 'company_name'],
    ['globexx.example', 'near_name'],
    ['rival.co.uk', 'company_name'],
  ];
  for (const [value, on] of cases) {
    const answer = check(value);
    assert.deepEqual([answer.blocked, answer.matched_on], [true, on], value);
  }
  assert.equal(check('other.example').blocked, false);
  assert.equal(check('rivalx.example').blocked, false);

  // The guard holds every company the check blocks, and clears the ones it allows.
  const result = guard(ws, ['domain', 'app.customer.example', 'globex.io', 'globexx.example', 'rival.co.uk', 'other.example', 'rivalx.example']);
  assert.deepEqual(result.json.counts, { clear: 2, owner: 0, held: 4 });

  write(ws, 'tests/exclusion.yaml', '- id: exclusion-subdomain\n  kind: exclusion\n  input: app.customer.example\n  expect: blocked\n- id: exclusion-same-name\n  kind: exclusion\n  input: globex.io\n  expect: blocked\n- id: exclusion-free\n  kind: exclusion\n  input: other.example\n  expect: allowed\n');
  const tests = gluely(['test', '--json'], ws).json;
  assert.deepEqual(tests.deterministic.failed.filter((f) => f.kind === 'exclusion'), []);
});

test('the strictest rule wins when a row matches more than one', () => {
  // The domain belongs to an investor with an owner, and the name to a customer: the customer rule holds it.
  const ws = workspace('domain,name,reason,owner\nfund.example,Seed Fund,investor,dana\nglobex.example,Globex,customer,\n');
  const result = guard(ws, ['email,company', 'a@fund.example,Globex', 'b@fund.example,Seed Fund']);
  assert.equal(rowAt(result, 2).bucket, 'held');
  assert.match(rowAt(result, 2).reason, /shares a name with Globex/);
  assert.equal(rowAt(result, 3).bucket, 'owner');
});

test('the guard finds a list by its workspace path, wherever it is run from', () => {
  const ws = workspace();
  write(ws, 'exports/list.csv', 'email\nb@customer.example\n');
  const result = gluely(['guard', 'exports/list.csv', '--json'], tempDir(), { GLUELY_WORKSPACE: ws });
  assert.equal(result.code, 0, result.out);
  assert.equal(result.json.file, 'exports/list.csv');
  assert.equal(result.json.counts.held, 1);
});

test('the CSV reader keeps line numbers, and reports what it could not read cleanly', () => {
  const parsed = parseCsv('﻿Email,Email,Company\n\na@x.example,b@x.example,"Acme, Inc"\nc@x.example,,Other, Inc\n');
  assert.deepEqual(parsed.header, ['email', 'email_2', 'company']);
  assert.deepEqual(parsed.lines, [3, 4]);
  assert.deepEqual(parsed.overflow, [4]);
  assert.deepEqual(parsed.problems, []);
  assert.equal(parsed.rows[0].email_2, 'b@x.example');
  assert.equal(parseCsv('a,b\n1,"two\nlines"\n3,4\n').problems[0].line, 2);
  assert.match(parseCsv('a,b\n1,"open\n3,4\n').problems[0].message, /never closes/);

  assert.equal(normalizeDomain('HTTPS://www.Acme.com:8443/pricing?x=1#top'), 'acme.com');
  assert.equal(normalizeDomain('mailto:Sam@Acme.com'), 'acme.com');
  assert.equal(registrable('mail.eu.acme.co.uk'), 'acme.co.uk');
  assert.equal(registrable('acme.github.io'), 'acme.github.io');
});
