// How a play ends, and what every play ever taught. A verdict is a person's call, kept in
// the decision log with the numbers it was made on, so the next brief can read why a play
// was kept or killed instead of trying the same thing blind.
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { addEntry, loadEntries, promoteEntry } from './log.js';
import { fail, GluelyError } from './output.js';
import { readPlay } from './playbooks.js';
import { loadPlays } from './plays.js';
import { judgePlay, readResults } from './results.js';

export const VERDICTS = { kept: 'active', paused: 'paused', killed: 'killed' };

const playFile = (ws, id) => path.join(ws, 'plays', `${id}.yaml`);

// Change only the status line, so the founder's comments in the play survive.
function setStatus(ws, id, status) {
  const file = playFile(ws, id);
  const doc = YAML.parseDocument(fs.readFileSync(file, 'utf8'));
  doc.set('status', status);
  fs.writeFileSync(file, doc.toString());
}

export function verdictsFor(ws, id) {
  return loadEntries(ws).filter((e) => e.verdict && (!id || e.play === id))
    .map(({ id: ref, at, play, verdict, why, by, context_version, snapshot }) => ({ ref, at, play, verdict, why, by, context_version, snapshot }));
}

export function closePlay(ws, id, { verdict, why, by } = {}) {
  if (!id) fail('usage', 'Usage: gluely plays close <id> --verdict kept|paused|killed --why "<the reason>"');
  const spec = readPlay(ws, id);
  if (!VERDICTS[verdict]) fail('bad_verdict', `--verdict must be one of ${Object.keys(VERDICTS).join(', ')}.`);
  if (!why || why === true) fail('needs_why', 'A verdict needs --why. The next play reads it, so say what you learned.');
  if (spec.status === 'draft') fail('not_run', `${id} is still a draft, so there is nothing to judge yet.`);
  if (spec.status === 'killed') fail('already_killed', `${id} is already killed. Start a new play to try it again.`);
  const judged = judgePlay(ws, id);
  const snapshot = { totals: judged.totals, rates: judged.rates, suggested: judged.verdict, days: judged.days };
  const entry = addEntry(ws, {
    kind: 'decision', area: 'play', play: id, verdict, why, by,
    text: `${id} ${verdict}: ${judged.totals.touches} touches, ${judged.totals.positive} positive, ${judged.totals.meetings} meetings`,
    snapshot,
  });
  // A verdict is already where it belongs, so it is never an open lesson waiting for a home.
  promoteEntry(ws, entry.id, `plays/${id}.yaml`);
  const status = VERDICTS[verdict];
  if (spec.status !== status) setStatus(ws, id, status);
  return { play: id, verdict, why, status, was: spec.status, suggested: judged.verdict, snapshot, ref: entry.id, context_version: entry.context_version };
}

// Every play, killed ones included, with what it produced and what people decided.
export function playsHistory(ws) {
  const results = readResults(ws);
  const verdicts = verdictsFor(ws);
  const plays = loadPlays(ws).map(({ file, spec, parseError }) => {
    const id = spec.id || file.replace(/\.ya?ml$/, '');
    const mine = verdicts.filter((v) => v.play === id);
    const base = { id, status: spec.status || null, hypothesis: spec.hypothesis || null, signal: spec.signal?.type || null, personas: spec.audience?.personas || [], verdicts: mine, last_verdict: mine.at(-1) || null };
    if (parseError) return { ...base, suggested: 'unreadable', why: parseError };
    try {
      const judged = judgePlay(ws, id);
      return { ...base, totals: judged.totals, rates: judged.rates, since: judged.since, suggested: judged.verdict, why: judged.why, last_result: results.filter((r) => r.play === id).at(-1)?.at || null };
    } catch (error) {
      if (!(error instanceof GluelyError)) throw error;
      return { ...base, suggested: 'unreadable', why: error.message };
    }
  });
  const order = { active: 0, paused: 1, draft: 2, killed: 3 };
  plays.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || a.id.localeCompare(b.id));
  return {
    plays,
    counts: Object.fromEntries(Object.keys(order).map((s) => [s, plays.filter((p) => p.status === s).length])),
    note: 'Read this before proposing a new play. A killed play with its reason is as useful as a winner.',
  };
}
