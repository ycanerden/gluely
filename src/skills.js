import fs from 'node:fs';
import path from 'node:path';
import { refuseNames } from './log.js';
import { fail } from './output.js';
import { contextVersion, GLUELY_ROOT, readFrontmatter } from './workspace.js';

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

// Which skill ran, and how it went. Facts only: a skill a person keeps correcting needs
// work, and one nobody runs may not be needed. Gluely counts, and the person decides.
export const SKILL_OUTCOMES = ['worked', 'corrected', 'abandoned'];
const usageFile = (ws) => path.join(ws, 'learning', 'skills.jsonl');

// A skill by name, or one gtm-mode playbook as gtm-mode/<playbook>.
export function knownSkills() {
  const playbooks = path.join(sourceDir(), 'gtm-mode', 'playbooks');
  const books = fs.existsSync(playbooks) ? fs.readdirSync(playbooks).filter((f) => f.endsWith('.md')).map((f) => `gtm-mode/${f.replace(/\.md$/, '')}`) : [];
  return [...listSkills().map((s) => s.name), ...books];
}

function readUsage(ws) {
  if (!fs.existsSync(usageFile(ws))) return [];
  return fs.readFileSync(usageFile(ws), 'utf8').split('\n').filter(Boolean).map((row, i) => {
    try { return JSON.parse(row); } catch { return fail('bad_usage', `learning/skills.jsonl line ${i + 1} is not valid JSON.`); }
  });
}

export function recordUse(ws, name, { outcome, play, why, by } = {}) {
  const known = knownSkills();
  if (!known.includes(name)) fail('unknown_skill', `No skill "${name}".`, 'Use a skill name from gluely skills list, or gtm-mode/<playbook>.');
  if (!SKILL_OUTCOMES.includes(outcome)) fail('bad_outcome', `--outcome must be one of ${SKILL_OUTCOMES.join(', ')}.`);
  refuseNames([why]);
  const entry = { at: new Date().toISOString(), skill: name, outcome, ...(play ? { play } : {}), ...(why ? { why } : {}), by: by || 'agent', context_version: contextVersion(ws).version };
  fs.mkdirSync(path.dirname(usageFile(ws)), { recursive: true });
  fs.appendFileSync(usageFile(ws), `${JSON.stringify(entry)}\n`);
  return entry;
}

export function skillUsage(ws) {
  const runs = readUsage(ws);
  const skills = [...new Set(runs.map((r) => r.skill))].map((skill) => {
    const mine = runs.filter((r) => r.skill === skill);
    const outcomes = Object.fromEntries(SKILL_OUTCOMES.map((o) => [o, mine.filter((r) => r.outcome === o).length]));
    return {
      skill, runs: mine.length, ...outcomes, last: mine.at(-1).at,
      reasons: mine.filter((r) => r.why && r.outcome !== 'worked').slice(-3).reverse().map((r) => ({ outcome: r.outcome, why: r.why })),
    };
  }).sort((a, b) => b.runs - a.runs || a.skill.localeCompare(b.skill));
  return {
    runs: runs.length,
    skills,
    never_used: knownSkills().filter((name) => !name.startsWith('principle-') && !skills.some((s) => s.skill === name)),
  };
}
