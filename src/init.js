import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { MARKETS } from './guard.js';
import { fail } from './output.js';
import { installSkills } from './skills.js';
import { GLUELY_ROOT, git } from './workspace.js';

const MOTIONS = ['sales_led', 'product_led', 'founder_led', 'community_led', 'mixed'];

const isInside = (child, parent) => {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

function copyTemplate(source, target, vars) {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (entry.name === '.DS_Store') continue;
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name === 'gitignore' ? '.gitignore' : entry.name);
    if (entry.isDirectory()) copyTemplate(from, to, vars);
    else fs.writeFileSync(to, fs.readFileSync(from, 'utf8').replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? ''));
  }
}

export function initWorkspace({ dir, company, domain, motion = 'mixed', market = 'b2b', noGit = false, noSkills = false }) {
  if (!dir) fail('usage', 'Usage: gluely init <dir> --company <name> [--domain example.com] [--market b2b|b2c|both] [--motion sales_led]');
  if (!company) fail('usage', '--company is required.');
  if (!MOTIONS.includes(motion)) fail('bad_motion', `--motion must be one of ${MOTIONS.join(', ')}.`);
  if (!MARKETS.includes(market)) fail('bad_market', `--market must be one of ${MARKETS.join(', ')}: who you sell to.`);

  const target = path.resolve(dir);
  // The public repo must never hold company data, so a workspace can't live inside it.
  if (isInside(target, GLUELY_ROOT)) {
    fail('inside_core', 'A workspace cannot live inside the public Gluely repo.', 'Pick a sibling folder, for example ../my-company-brain.');
  }
  if (fs.existsSync(target) && fs.readdirSync(target).length) fail('not_empty', `${target} already has files in it.`);

  copyTemplate(path.join(GLUELY_ROOT, 'templates', 'workspace'), target, {
    company,
    domain: domain || '',
    motion,
    market,
    date: new Date().toISOString().slice(0, 10),
  });
  if (!noSkills) installSkills(target);

  if (!noGit) {
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: target });
    git(target, ['add', '-A']);
    const committed = git(target, ['commit', '-q', '-m', 'Start the brain']);
    if (committed === null) return { dir: target, git: 'initialised, nothing committed: set git user.name and user.email' };
    return { dir: target, git: 'committed' };
  }
  return { dir: target, git: 'skipped' };
}
