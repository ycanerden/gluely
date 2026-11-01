import fs from 'node:fs';
import path from 'node:path';
import { GLUELY_ROOT, readFrontmatter } from './workspace.js';

export const HOSTS = { claude: '.claude/skills', cursor: '.cursor/skills' };

const sourceDir = () => path.join(GLUELY_ROOT, 'skills');

export function listSkills() {
  return fs.readdirSync(sourceDir(), { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(sourceDir(), e.name, 'SKILL.md')))
    .map((e) => {
      const { data } = readFrontmatter(path.join(sourceDir(), e.name, 'SKILL.md'));
      return { name: data?.name || e.name, description: data?.description || '', principle: e.name.startsWith('principle-') };
    })
    .sort((a, b) => Number(a.principle) - Number(b.principle) || a.name.localeCompare(b.name));
}

export function installSkills(ws, hosts = Object.keys(HOSTS)) {
  const skills = listSkills();
  for (const host of hosts) {
    for (const skill of skills) {
      const target = path.join(ws, HOSTS[host], skill.name);
      fs.rmSync(target, { recursive: true, force: true });
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.cpSync(path.join(sourceDir(), skill.name), target, { recursive: true });
    }
  }
  return { hosts, count: skills.length };
}

export function installedSkills(ws) {
  return Object.fromEntries(Object.entries(HOSTS).map(([host, dir]) => {
    const full = path.join(ws, dir);
    return [host, fs.existsSync(full) ? fs.readdirSync(full).length : 0];
  }));
}
