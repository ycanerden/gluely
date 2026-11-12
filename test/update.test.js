// gluely update, run for real between two local clones, so no network is needed.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { installInfo, REMIND_AFTER_DAYS } from '../src/update.js';
import { ROOT, tempDir } from './helpers.js';

const ENV = { ...process.env, NO_COLOR: '1', GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com' };
const sh = (cwd, ...args) => execFileSync('git', args, { cwd, env: ENV, stdio: 'pipe' }).toString().trim();
const run = (clone, args, cwd = tempDir()) => {
  const r = spawnSync('node', [path.join(clone, 'bin', 'gluely.js'), ...args, '--json'], { cwd, env: ENV, encoding: 'utf8' });
  return { code: r.status, json: JSON.parse(r.stdout) };
};

test('gluely update pulls the latest, lists what changed, and refuses to mix with local edits', () => {
  const base = tempDir();
  const upstream = path.join(base, 'upstream');
  const mine = path.join(base, 'mine');
  // Copy the working tree as it is, so the test also covers changes not yet committed.
  fs.cpSync(ROOT, upstream, { recursive: true, filter: (src) => !/[\\/](node_modules|\.git)$/.test(src) });
  sh(upstream, 'init', '-q', '-b', 'main');
  sh(upstream, 'add', '-A');
  sh(upstream, 'commit', '-qm', 'Gluely as it is');
  sh(base, 'clone', '-q', upstream, mine);
  for (const dir of [upstream, mine]) fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'));

  const same = run(mine, ['update']);
  assert.equal(same.code, 0, JSON.stringify(same.json));
  assert.equal(same.json.updated, false);

  fs.appendFileSync(path.join(upstream, 'README.md'), '\nA new line.\n');
  sh(upstream, 'commit', '-qam', 'A newer Gluely');
  const pulled = run(mine, ['update']).json;
  assert.equal(pulled.updated, true);
  assert.deepEqual(pulled.changes, ['A newer Gluely']);
  assert.equal(pulled.needs_install, false);
  assert.equal(sh(mine, 'rev-parse', 'HEAD'), sh(upstream, 'rev-parse', 'HEAD'));

  fs.appendFileSync(path.join(mine, 'README.md'), 'my own edit\n');
  assert.equal(run(mine, ['update']).json.error.code, 'local_changes');
});

test('an old copy of Gluely gets a reminder, worked out offline from its own date', () => {
  const info = installInfo(ROOT);
  if (!info.git) return;
  const later = Date.parse(info.committed_at) + (REMIND_AFTER_DAYS + 1) * 86400000;
  assert.equal(installInfo(ROOT, later).remind, true);
  assert.equal(installInfo(ROOT, Date.parse(info.committed_at)).remind, false);
});
