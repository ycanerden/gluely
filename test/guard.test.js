// The gate fails closed. Every row here reached `clear` in the Northwind tryout (fake data,
// .example domains only). Each must now be held, or go to the owner, or be refused outright.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fillContext, gluely, makeWorkspace, tempDir, write } from './helpers.js';

const COMPANIES = 'domain,name,reason,owner\ncontoso.example,Contoso,customer,\nfabrikam.io,Fabrikam,churned,\ntailspin.example,Tailspin Toys,investor,dana\n';
const PEOPLE = 'email,linkedin,name,reason,owner\nana@litware.example,,Ana Ruiz,close relationship,sam\n';

function northwind() {
  const ws = makeWorkspace();
  fillContext(ws);
  write(ws, 'context/exclusions/companies.csv', COMPANIES);
  write(ws, 'context/exclusions/people.csv', PEOPLE);
  return ws;
}

const guard = (ws, file, ...flags) => gluely(['guard', file, '--json', ...flags], ws);
const bucketsByName = (ws, result) => {
  const out = {};
  for (const bucket of ['clear', 'owner', 'held']) {
    const text = fs.readFileSync(path.join(ws, result.json.files[bucket]), 'utf8').trim().split('\n').slice(1);
    for (const line of text) out[line.split(',')[0].replace(/^"/, '')] = bucket;
  }
  return out;
};

test('a junk or stale domain column never overrides a customer email, and every domain form is read', () => {
  const ws = northwind();
  const rows = [
    'A1-07,lee@contoso.example,,contoso.example:443',
    'A1-08,lee@contoso.example,,contoso.example.',
    'A1-09,lee@contoso.example,,contoso.example?utm_source=x',
    'A1-10,lee@contoso.example,,n/a',
    'A1-11,lee@contoso.example,,-',
    'A1-12,lee@contoso.example,,linkedin.com/company/contoso',
    'A1-12b,,,https://www.linkedin.com/company/contoso/',
    'A1-13,Lee Park <lee@contoso.example>,,',
    'A1-15,lee@contoso.example;,,',
    'A1-17,lee@contoso.example,Adatum,adatum.example',
    'A1-18,lee@contoso-eu.example,,',
    'A1-19,lee@contosogroup.example,,',
    'A1-22,,,@contoso.example',
    'A1-23,lee@contoso.example,,contoso.example#home',
    'A1-24,lee@xn--contso-exa.example,,xn--contso-exa.example',
    'OK-01,sam@adatum.example,Adatum,adatum.example',
  ];
  write(ws, 'exports/a1.csv', ['name,email,company,domain', ...rows].join('\n') + '\n');
  const result = guard(ws, 'exports/a1.csv');
  assert.equal(result.code, 0, result.out);
  const got = bucketsByName(ws, result);
  for (const row of rows.slice(0, -1)) assert.equal(got[row.split(',')[0]], 'held', row);
  assert.equal(got['OK-01'], 'clear');
  assert.equal(result.json.rows.find((r) => r.line === 11).matched_on, 'domain');
  assert.match(result.json.rows.find((r) => r.line === 11).rule, /companies\.csv:2$/);
});

test('company names match through punctuation, legal words, look-alike letters and suffixes', () => {
  const ws = northwind();
  const held = ['Contoso & Co', 'Contoso Labs', 'Contoso Europe', 'Contoso (UK)', 'ContosoLtd', 'Contoso S.A.', 'Contoso, L.L.C.',
    'Contoso GmbH & Co. KG', 'Cоntoso', 'Contoso.example', 'contoso.example Inc', 'Fabrikam Europe', 'Contoso Ltd (formerly)', 'Contoso Inc. dba Northwind'];
  const cell = (v) => (/[",]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = held.map((name, i) => `A2-${i},p${i}@neutral${i}.example,${cell(name)},`);
  lines.push('A2-owner,q@neutral.example,Tailspin & Co,', 'A2-ok,r@woodgrove.example,Woodgrove,', 'A2-ok2,s@globe.example,Globe Partners,');
  write(ws, 'exports/a2.csv', ['name,email,company,domain', ...lines].join('\n') + '\n');
  const result = guard(ws, 'exports/a2.csv');
  assert.equal(result.code, 0, result.out);
  const got = bucketsByName(ws, result);
  held.forEach((name, i) => assert.equal(got[`A2-${i}`], 'held', name));
  assert.equal(got['A2-owner'], 'owner');
  assert.equal(got['A2-ok'], 'clear');
  assert.equal(got['A2-ok2'], 'clear');
  assert.match(result.json.rows.find((r) => r.bucket === 'owner').reason, /^Tailspin Toys is listed as investor\. dana decides first$/);
});

test('known people are found by inbox, alias and name at the same company, not just exact email', () => {
  const ws = northwind();
  write(ws, 'exports/a3.csv', [
    'name,email,company,domain',
    'A3-04,lee@proton.ch,Contoso Europe,',
    'A3-06,lee@gmail.co.uk,,',
    'A3-07,ana.ruiz@gmail.com,Litware,litware.example',
    'A3-08,ana.ruiz@litware.example,Litware,litware.example',
    'A3-10,ana+news@litware.example,Litware,litware.example',
    'A3-ok,bo.lind@litware.example,Litware,litware.example',
  ].join('\n') + '\n');
  const result = guard(ws, 'exports/a3.csv');
  const got = bucketsByName(ws, result);
  assert.equal(got['A3-04'], 'held');
  assert.equal(got['A3-06'], 'held');
  for (const id of ['A3-07', 'A3-08', 'A3-10']) assert.equal(got[id], 'owner', id);
  assert.equal(got['A3-ok'], 'clear');
  assert.deepEqual(result.json.owners, ['sam']);
});

test('real export headers are read, duplicate columns keep their data, and the header is written back as it was', () => {
  const ws = northwind();
  write(ws, 'exports/spaces.csv', 'Full Name,Work Email,Company Name,Website\nA4a-02,kim@contoso.example,Contoso,https://kim-personal-blog.example\nA4a-03,sam@adatum.example,Adatum,\n');
  let result = guard(ws, 'exports/spaces.csv');
  let got = bucketsByName(ws, result);
  assert.deepEqual([got['A4a-02'], got['A4a-03']], ['held', 'clear']);
  assert.match(fs.readFileSync(path.join(ws, result.json.files.clear), 'utf8'), /^Full Name,Work Email,Company Name,Website\n/);

  write(ws, 'exports/website.csv', 'name,email,website\nA4l-01,lee@contoso.example,https://lee-portfolio.example\n');
  assert.equal(guard(ws, 'exports/website.csv').json.counts.held, 1);

  write(ws, 'exports/dupes.csv', 'name,email,company,Email\nA4d-01,lee@contoso.example,,sam2@adatum.example\nA4d-02,ok@adatum.example,Adatum,ok2@adatum.example\n');
  result = guard(ws, 'exports/dupes.csv');
  got = bucketsByName(ws, result);
  assert.deepEqual([got['A4d-01'], got['A4d-02']], ['held', 'clear']);
  assert.equal(fs.readFileSync(path.join(ws, result.json.files.clear), 'utf8'), 'name,email,company,Email\nA4d-02,ok@adatum.example,Adatum,ok2@adatum.example\n');

  write(ws, 'exports/notes.csv', 'name,company,notes\nN-01,Adatum,"intro via lee@contoso.example"\n');
  assert.equal(guard(ws, 'exports/notes.csv').json.counts.held, 1);
});

test('a stray quote never swallows rows, and a file that cannot be read safely is refused', () => {
  const ws = northwind();
  write(ws, 'exports/stray.csv', [
    'name,email,company,domain',
    'A4g-01 Lee "LP Park,sam@adatum.example,Adatum,adatum.example',
    'Kim,kim@contoso.example,Contoso,contoso.example',
    'Max,max@fabrikam.io,Fabrikam,fabrikam.io',
    'Ok,ok@adatum.example,Adatum,adatum.example',
  ].join('\n') + '\n');
  const result = guard(ws, 'exports/stray.csv');
  assert.equal(result.json.total, 4);
  assert.equal(result.json.lines, 5);
  assert.deepEqual(result.json.counts, { clear: 1, owner: 0, held: 3 });
  assert.match(result.json.rows.find((r) => r.line === 2).reason, /stray "/);
  assert.doesNotMatch(fs.readFileSync(path.join(ws, result.json.files.clear), 'utf8'), /contoso|fabrikam/);

  write(ws, 'exports/unclosed.csv', 'name,email,company\n"Lee Park,sam@adatum.example,Adatum\nKim,kim@contoso.example,Contoso\n');
  assert.equal(guard(ws, 'exports/unclosed.csv').json.error.code, 'bad_csv');
  write(ws, 'exports/swallow.csv', 'name,email,company\n"Lee Park,sam@adatum.example,Adatum\nKim,kim@contoso.example,Contoso\nMax",max@x.example,X\n');
  assert.equal(guard(ws, 'exports/swallow.csv').json.error.code, 'bad_csv');
  write(ws, 'exports/wide.csv', 'name,email\nA,a@adatum.example,contoso.example\n');
  assert.equal(guard(ws, 'exports/wide.csv').json.counts.held, 1);
  write(ws, 'exports/multiline.csv', 'name,email,company\n"Lee\nPark",lee@adatum.example,Adatum\n');
  assert.equal(guard(ws, 'exports/multiline.csv').json.counts.clear, 1);

  fs.writeFileSync(path.join(ws, 'exports/latin1.csv'), Buffer.from('name,email,company\nA,a@x.example,Cont\xf3so\n', 'latin1'));
  assert.equal(guard(ws, 'exports/latin1.csv').json.error.code, 'bad_encoding');
  fs.writeFileSync(path.join(ws, 'exports/utf16.csv'), Buffer.from('﻿name,email\nA,a@x.example\n', 'utf16le'));
  assert.equal(guard(ws, 'exports/utf16.csv').json.error.code, 'bad_encoding');
});

test('a customer export the guard cannot read is refused, and CRM column names are understood', () => {
  const ws = northwind();
  write(ws, 'exports/targets.csv', 'name,email,company\nH1,hank@globex.example,\nH2,hank@gmail.com,"Globex, Inc."\nH3,billing@globex.example,\nOK,ok@adatum.example,Adatum\n');
  write(ws, 'exports/billing.csv', 'Customer Name,Billing Email,Customer Website\nGlobex,billing@globex.example,globex.example\n');
  const result = guard(ws, 'exports/targets.csv', '--customers', 'exports/billing.csv');
  assert.equal(result.code, 0, result.out);
  assert.deepEqual(result.json.counts, { clear: 1, owner: 0, held: 3 });
  assert.equal(result.json.customers_loaded, 1);

  write(ws, 'exports/hubspot.csv', 'Record ID,Lifecycle Stage,Lead Status\n1,Customer,Working\n');
  assert.equal(guard(ws, 'exports/targets.csv', '--customers', 'exports/hubspot.csv').json.error.code, 'unknown_columns');
  write(ws, 'exports/blank.csv', 'email,company\n,\n');
  assert.equal(guard(ws, 'exports/targets.csv', '--customers', 'exports/blank.csv').json.error.code, 'empty_customers');

  write(ws, 'context/exclusions/companies.csv', 'Website,Company,Status,Owner\ncontoso.example,Contoso Ltd,Active Customer,sam\n,Vandelay Industries,customer,\ninitech.example,Initech,ex-customer,sam\n');
  write(ws, 'exports/y.csv', 'name,email,company\nY-01,lee@contoso.example,\nX-06,a@vandelay.example,\nI-01,b@initech.example,\n');
  const crm = guard(ws, 'exports/y.csv');
  assert.deepEqual(crm.json.counts, { clear: 0, owner: 0, held: 3 });
  assert.match(crm.json.rows[0].reason, /^Contoso Ltd is listed as Active Customer\./);
  assert.equal(gluely(['context', 'check', '--json'], ws).json.issues.filter((i) => i.level === 'error' && /companies/.test(i.file)).length, 0);

  write(ws, 'context/exclusions/companies.csv', 'Record ID,Lifecycle Stage\n1,Customer\n');
  assert.equal(guard(ws, 'exports/y.csv').json.error.code, 'unknown_columns');
});

test('in B2C one inbox is one person, and a row with no person on it is held', () => {
  const dir = path.join(tempDir(), 'home');
  gluely(['init', dir, '--company', 'Northwind Home', '--market', 'b2c', '--motion', 'product_led', '--json'], tempDir());
  write(dir, 'exports/users.csv', 'email\njane@gmail.com\nbob.smith@outlook.com\ncarla@contoso.example\n');
  write(dir, 'exports/list.csv', 'name,email,company\nB2C-03,jane+promo@gmail.com,\nB2C-04,j.a.n.e@gmail.com,\nB2C-05,jane@googlemail.com,\nB2C-06,dave@contoso.example,\nB2C-11,,Acme Home\n');
  const result = guard(dir, 'exports/list.csv', '--customers', 'exports/users.csv');
  const got = bucketsByName(dir, result);
  assert.deepEqual([got['B2C-03'], got['B2C-04'], got['B2C-05'], got['B2C-06'], got['B2C-11']], ['held', 'held', 'held', 'clear', 'held']);
  assert.equal(bucketsByName(dir, guard(dir, 'exports/list.csv'))['B2C-11'], 'held');
});

test('check company and exclusion tests give the same answer as the guard', () => {
  const ws = northwind();
  for (const value of ['eu.contoso.example', 'Contoso Ltd', 'contoso.example:443', 'https://www.contoso.example/', 'fabrikam.io', 'Fabrikam Europe']) {
    const result = gluely(['check', 'company', value, '--json'], ws);
    assert.equal(result.json.blocked, true, value);
    assert.equal(result.code, 1);
  }
  const owner = gluely(['check', 'company', 'Tailspin & Co', '--json'], ws).json;
  assert.deepEqual([owner.blocked, owner.owner], [true, 'dana']);
  assert.equal(gluely(['check', 'company', 'woodgrove.example', '--json'], ws).json.blocked, false);

  assert.equal(gluely(['test', 'add', '--kind', 'exclusion', '--input', 'eu.contoso.example', '--expect', 'blocked', '--json'], ws).code, 0);
  assert.equal(gluely(['test', 'add', '--kind', 'exclusion', '--input', 'Contoso Ltd', '--expect', 'blocked', '--json'], ws).code, 0);
  const run = gluely(['test', '--json'], ws);
  assert.equal(run.code, 0, run.out);
  assert.doesNotMatch(JSON.stringify(run.json), /"ok":false/);
});
