import { scanContext } from './context.js';
import { runTests } from './brain-tests.js';
import { learn } from './log.js';
import { validatePlays } from './plays.js';
import { installedSkills } from './skills.js';
import { loadStack } from './stack.js';
import { contextVersion, git, loadConfig } from './workspace.js';

// One function answers "where do I stand?" for humans, agents and `gluely flow`.
export function diagnose(ws) {
  const cfg = loadConfig(ws);
  const context = scanContext(ws);
  const plays = validatePlays(ws);
  const tests = runTests(ws);
  const skills = installedSkills(ws);
  const stack = loadStack(ws);
  const version = contextVersion(ws);
  const learned = learn(ws);
  const isRepo = git(ws, ['rev-parse', '--is-inside-work-tree']) === 'true';

  const { summary } = context;
  const isError = (i) => i.level === 'error';
  const errors = [...context.issues, ...plays.issues].filter(isError);
  const checks = [
    { name: 'git', ok: isRepo, detail: isRepo ? `context version ${version.version}` : 'not a git repo, so context changes have no versions' },
    { name: 'skills', ok: Object.values(skills).some((n) => n > 0), detail: Object.entries(skills).map(([h, n]) => `${h} ${n}`).join(', ') },
    { name: 'stack', ok: stack.named > 0, detail: `${stack.named}/${stack.layers.length} layers named` },
    { name: 'context', ok: summary.template === 0 && summary.total > 0, detail: `${summary.confirmed} confirmed, ${summary.draft} draft, ${summary.template} still templates` },
    { name: 'personas', ok: summary.personas > 0, detail: `${summary.personas} written` },
    { name: 'exclusions', ok: summary.excluded_companies > 0, detail: `${summary.excluded_companies} companies` },
    { name: 'plays', ok: plays.plays.length > 0 && !plays.issues.some((i) => i.level === 'error'), detail: `${plays.plays.length} found` },
    { name: 'tests', ok: tests.passed, detail: `${tests.deterministic.passed}/${tests.deterministic.total} rule tests, ${tests.reasoned.correct}/${tests.reasoned.total} agent tests` },
  ];

  const inAgent = (text) => `Open your agent in this folder and type ${text}`;
  let next;
  if (summary.template > 0) next = { step: 'Fill your context', how: inAgent('/setup-gluely') };
  else if (errors.length) next = { step: 'Fix the errors', how: 'See what these report, then fix each one', command: context.issues.some(isError) ? 'gluely context check' : 'gluely plays validate' };
  else if (!summary.excluded_companies) next = { step: 'Add your exclusions', how: 'List clients, investors and partners in context/exclusions/companies.csv' };
  else if (tests.reasoned.pending.length) next = { step: 'Test the brain', how: inAgent('/gtm-mode, then ask it to run the brain tests') };
  else if (learned.open >= 3) next = { step: `Review ${learned.open} open lessons`, how: 'See what keeps coming up', command: 'gluely learn' };
  else if (!plays.plays.some((p) => p.status === 'active')) next = { step: 'Choose a first play', how: 'Answer a few questions to set one up', command: 'gluely plays start' };
  else next = { step: 'Run the play and log what you learn', how: inAgent('/gtm-mode') };

  return {
    workspace: ws,
    company: cfg.company,
    context_version: version.version,
    ready: checks.every((c) => c.ok),
    checks,
    next,
    stack: Object.fromEntries(stack.layers.map((l) => [l.id, l.tool])),
    context: summary,
    plays: plays.plays.map(({ id, status, signal }) => ({ id, status, signal })),
    tests,
    learning: { open: learned.open, promoted: learned.promoted, decisions: learned.decisions },
  };
}
