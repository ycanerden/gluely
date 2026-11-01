import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { fail } from './output.js';
import { GLUELY_ROOT } from './workspace.js';

const LIBRARY = path.join(GLUELY_ROOT, 'library');
const ownFile = (ws) => path.join(ws, 'tools.yaml');
const byName = (a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });

export function loadLibrary(ws) {
  const base = YAML.parse(fs.readFileSync(path.join(LIBRARY, 'tools.yaml'), 'utf8'));
  const own = ws && fs.existsSync(ownFile(ws)) ? YAML.parse(fs.readFileSync(ownFile(ws), 'utf8')) || [] : [];
  return { ...base, tools: [...base.tools, ...own.map((t) => ({ ...t, own: true }))].sort(byName) };
}

// Nobody is ranked. Tools you already use come first because they're yours, and the rest stay alphabetical.
export function toolsForJob(ws, job, yours = []) {
  const library = loadLibrary(ws);
  if (!library.jobs[job]) fail('bad_job', `Unknown job "${job}". Use ${Object.keys(library.jobs).join(', ')}.`);
  const mine = (t) => yours.includes(t.name) || t.own;
  const fits = library.tools.filter((t) => t.jobs.includes(job)).map((t) => ({
    name: t.name,
    access: t.access,
    hint: library.access[t.access] || '',
    yours: Boolean(mine(t)),
  }));
  return [...fits.filter((t) => t.yours), ...fits.filter((t) => !t.yours)];
}

export function addTool(ws, { name, job, access = 'software' }) {
  const library = loadLibrary(ws);
  if (!name) fail('usage', 'Usage: gluely tools add <name> --job <job> [--access <kind>]');
  if (!library.jobs[job]) fail('bad_job', `--job must be one of ${Object.keys(library.jobs).join(', ')}.`);
  if (!library.access[access]) fail('bad_access', `--access must be one of ${Object.keys(library.access).join(', ')}.`);
  if (library.tools.some((t) => t.name.toLowerCase() === name.toLowerCase() && t.jobs.includes(job))) {
    fail('exists', `${name} is already in the library for ${job}.`);
  }
  const tool = { name, jobs: [job], access };
  fs.appendFileSync(ownFile(ws), YAML.stringify([tool]));
  return tool;
}

export function loadPlaybooks() {
  const dir = path.join(LIBRARY, 'playbooks');
  return fs.readdirSync(dir).filter((f) => f.endsWith('.yaml')).sort()
    .map((f) => YAML.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
}

export function getPlaybook(id) {
  const found = loadPlaybooks().find((p) => p.id === id);
  if (!found) fail('unknown_playbook', `No playbook "${id}".`, `Run gluely playbooks to see them all.`);
  return found;
}
