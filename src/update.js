// Keeping Gluely itself up to date. Gluely makes no outside call on its own, so the
// reminder only reads the date of the local copy. The network is used only when a
// person runs `gluely update`, and then only through their own git.
import fs from 'node:fs';
import path from 'node:path';
import { fail } from './output.js';
import { git, GLUELY_ROOT } from './workspace.js';

export const REMIND_AFTER_DAYS = 30;
const DAY = 86400000;

const version = (root) => JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;

export function installInfo(root = GLUELY_ROOT, now = Date.now()) {
  const isClone = git(root, ['rev-parse', '--show-toplevel']) === fs.realpathSync(root);
  if (!isClone) return { root, version: version(root), git: false, how: 'Reinstall Gluely the way you installed it to get the latest version.' };
  const committed = git(root, ['log', '-1', '--format=%cI']);
  const days = committed ? Math.floor((now - Date.parse(committed)) / DAY) : null;
  return {
    root,
    version: version(root),
    git: true,
    commit: git(root, ['rev-parse', '--short', 'HEAD']),
    branch: git(root, ['rev-parse', '--abbrev-ref', 'HEAD']),
    committed_at: committed,
    days_old: days,
    remind: days !== null && days >= REMIND_AFTER_DAYS,
    how: 'gluely update',
  };
}

export function updateGluely(root = GLUELY_ROOT) {
  const before = installInfo(root);
  if (!before.git) fail('not_a_clone', 'This copy of Gluely is not a git clone, so it cannot update itself.', before.how);
  if (git(root, ['status', '--porcelain', '--untracked-files=no'])) {
    fail('local_changes', `Gluely at ${root} has local changes, so the update would mix with them.`, 'Commit or stash them there, then run gluely update again.');
  }
  if (!git(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])) {
    fail('no_upstream', `The branch ${before.branch} in ${root} follows no remote branch.`, 'Run git checkout main there, then gluely update.');
  }
  if (git(root, ['pull', '--ff-only', '--quiet']) === null) {
    fail('update_failed', 'git pull did not finish. Your copy is unchanged.', `Run git pull --ff-only in ${root} to see why.`);
  }
  const after = installInfo(root);
  const range = `${before.commit}..${after.commit}`;
  const changes = before.commit === after.commit ? [] : (git(root, ['log', '--format=%s', '--no-merges', range]) || '').split('\n').filter(Boolean);
  const files = before.commit === after.commit ? [] : (git(root, ['diff', '--name-only', range]) || '').split('\n');
  return {
    updated: before.commit !== after.commit,
    from: { version: before.version, commit: before.commit },
    to: { version: after.version, commit: after.commit },
    changes,
    needs_install: files.some((f) => f === 'package.json' || f === 'package-lock.json'),
    root,
  };
}
