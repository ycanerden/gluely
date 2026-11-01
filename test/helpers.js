import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(ROOT, 'bin', 'gluely.js');
const ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com',
  NO_COLOR: '1',
};

export function gluely(args, cwd) {
  const result = spawnSync('node', [BIN, ...args], { cwd, env: ENV, encoding: 'utf8' });
  let json;
  try { json = JSON.parse(result.stdout); } catch { json = null; }
  return { code: result.status, out: result.stdout, err: result.stderr, json };
}

export const tempDir = () => fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'gluely-'));

export function makeWorkspace() {
  const dir = path.join(tempDir(), 'acme');
  const result = gluely(['init', dir, '--company', 'Acme', '--domain', 'acme.example', '--motion', 'sales_led', '--json'], tempDir());
  if (result.code !== 0) throw new Error(result.out + result.err);
  return dir;
}

export function write(ws, rel, text) {
  fs.mkdirSync(path.dirname(path.join(ws, rel)), { recursive: true });
  fs.writeFileSync(path.join(ws, rel), text);
}

export function commit(ws, message) {
  execFileSync('git', ['add', '-A'], { cwd: ws, env: ENV });
  execFileSync('git', ['commit', '-q', '-m', message], { cwd: ws, env: ENV });
}

export function fillContext(ws) {
  for (const rel of ['company.md', 'icp.md', 'positioning.md', 'messaging/voice.md', 'messaging/excuses.md', 'exclusions/rules.md']) {
    const file = path.join(ws, 'context', rel);
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('status: template', 'status: draft').replace(/<[a-z][a-z0-9 -]*>/g, 'filled'));
  }
  write(ws, 'context/personas/head-of-sales.md', '---\nid: head-of-sales\nstatus: draft\n---\n# Head of Sales\n');
  write(ws, 'context/exclusions/companies.csv', 'domain,name,reason\nclient.example,"Client, Inc",client\n');
}
