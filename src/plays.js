import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { loadExcuses, personaIds } from './context.js';
import { loadConfig } from './workspace.js';
import { PLAY_STATUSES, SIGNALS } from './vocab.js';

export function loadPlays(ws) {
  const dir = path.join(ws, 'plays');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f) && !f.startsWith('_'))
    .sort()
    .map((file) => {
      try {
        return { file, spec: YAML.parse(fs.readFileSync(path.join(dir, file), 'utf8')) || {} };
      } catch (error) {
        return { file, spec: {}, parseError: error.message };
      }
    });
}

export function validatePlay(play, { signals, personas, excuses }) {
  const { file, spec, parseError } = play;
  const issues = [];
  const add = (level, message) => issues.push({ level, file: `plays/${file}`, message });
  if (parseError) { add('error', `not valid YAML: ${parseError}`); return issues; }

  for (const key of ['id', 'hypothesis', 'signal', 'audience', 'excuse', 'action', 'success', 'kill']) {
    if (spec[key] === undefined || spec[key] === null || spec[key] === '') add('error', `missing "${key}"`);
  }
  if (spec.id && path.basename(file).replace(/\.ya?ml$/, '') !== spec.id) add('error', `id "${spec.id}" must match the file name`);
  if (!PLAY_STATUSES.includes(spec.status)) add('error', `status must be one of ${PLAY_STATUSES.join(', ')}`);

  const active = spec.status === 'active';
  if (spec.signal && !signals.includes(spec.signal.type)) {
    add('error', `unknown signal "${spec.signal.type}". Add it under extensions.signals in workspace.yaml to extend the base`);
  }

  const wanted = spec.audience?.personas || [];
  if (!wanted.length) add(active ? 'error' : 'warn', 'names no persona');
  for (const persona of wanted) {
    if (!personas.includes(persona)) add(active ? 'error' : 'warn', `persona "${persona}" has no file in context/personas/`);
  }

  if (spec.signal?.type && !excuses.some((e) => e.signal === spec.signal.type)) {
    add(active ? 'error' : 'warn', `no excuse for ${spec.signal.type} in context/messaging/excuses.md`);
  }

  const variants = spec.excuse?.variants || [];
  if (variants.length > 2) add('warn', `${variants.length} variants: two is the most you can compare at startup volume`);
  if (spec.kill && !spec.kill.after && !spec.kill.after_touches) add('error', 'kill needs after_touches: a play that can never die eats budget forever');
  if (spec.kill && !spec.kill.if) add('error', 'kill needs an if condition');
  return issues;
}

export function validatePlays(ws) {
  const cfg = loadConfig(ws);
  const ctx = {
    signals: [...SIGNALS, ...cfg.extensions.signals],
    personas: personaIds(ws),
    excuses: loadExcuses(ws),
  };
  const plays = loadPlays(ws).map((play) => ({
    file: `plays/${play.file}`,
    id: play.spec.id,
    status: play.spec.status,
    hypothesis: play.spec.hypothesis,
    signal: play.spec.signal?.type,
    issues: validatePlay(play, ctx),
  }));
  return { plays, issues: plays.flatMap((p) => p.issues) };
}
