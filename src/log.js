// The decision log: what was decided, what humans changed and why, under which context.
// It is append-only, so promoting or dropping a lesson adds an event and never edits one.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fail } from './output.js';
import { contextVersion } from './workspace.js';

export const LOG_KINDS = ['decision', 'correction', 'input', 'result'];
export const LOG_AREAS = ['voice', 'messaging', 'excuse', 'icp', 'persona', 'objection', 'play', 'tool', 'cost', 'reply', 'exclusion', 'other'];

const HOMES = {
  voice: 'context/messaging/voice.md',
  messaging: 'context/messaging/voice.md',
  excuse: 'context/messaging/excuses.md',
  icp: 'context/icp.md',
  persona: 'context/personas/',
  objection: 'context/objections/',
  exclusion: 'context/exclusions/',
};
const PERSONAL = [
  [/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/i, 'an email address'],
  [/(?:https?:\/\/)?(?:[\w-]+\.)?linkedin\.com\/in\/[^\s"')]*/i, 'a LinkedIn profile'],
];
const FILLER = new Set(['about', 'after', 'again', 'also', 'been', 'from', 'have', 'here', 'just', 'like', 'more', 'that', 'them', 'then', 'they', 'this', 'very', 'want', 'were', 'what', 'when', 'will', 'with', 'would', 'your']);

const logFile = (ws) => path.join(ws, 'learning', 'log.jsonl');

function append(ws, entry) {
  fs.mkdirSync(path.dirname(logFile(ws)), { recursive: true });
  fs.appendFileSync(logFile(ws), `${JSON.stringify(entry)}\n`);
  return entry;
}

function readEvents(ws) {
  if (!fs.existsSync(logFile(ws))) return [];
  return fs.readFileSync(logFile(ws), 'utf8').split('\n').filter(Boolean).map((row, index) => {
    try { return JSON.parse(row); } catch { fail('bad_log', `learning/log.jsonl line ${index + 1} is not valid JSON.`); }
  });
}

export function refuseNames(fields) {
  for (const value of fields) {
    for (const [pattern, label] of PERSONAL) {
      if (value && pattern.test(value)) fail('personal_data', `This contains ${label}, and the log keeps lessons, not people.`, 'Replace it with a placeholder like {first_name}, then log it again.');
    }
  }
}

export const redact = (text) => PERSONAL.reduce((value, [pattern]) => value?.replace(new RegExp(pattern, 'gi'), '{redacted}'), text);

export function addEntry(ws, { kind, area, text, why, before, after, scope, play, by, source = 'human' }) {
  if (!LOG_KINDS.includes(kind)) fail('bad_kind', `--kind must be one of ${LOG_KINDS.join(', ')}.`);
  if (!LOG_AREAS.includes(area)) fail('bad_area', `--area must be one of ${LOG_AREAS.join(', ')}.`);
  if (!text && !(before && after)) fail('usage', 'Pass --text, or both --before and --after.');
  refuseNames([text, why, before, after]);
  const at = new Date().toISOString();
  const id = `log-${crypto.createHash('sha256').update(`${at}|${text}|${before}|${crypto.randomUUID()}`).digest('hex').slice(0, 6)}`;
  return append(ws, {
    id, at, kind, area, text: text || `Changed "${before}" to "${after}"`,
    ...(why ? { why } : {}), ...(before ? { before } : {}), ...(after ? { after } : {}),
    ...(scope ? { scope } : {}), ...(play ? { play } : {}),
    by: by || (source === 'human' ? 'human' : 'agent'), source,
    context_version: contextVersion(ws).version,
  });
}

// Replays the events so every lesson carries where it ended up.
export function loadEntries(ws) {
  const events = readEvents(ws);
  const entries = events.filter((e) => !e.event);
  for (const event of events.filter((e) => e.event)) {
    const entry = entries.find((e) => e.id === event.ref);
    if (entry) Object.assign(entry, { state: event.event, ...(event.to ? { to: event.to } : {}), ...(event.why ? { closed_why: event.why } : {}) });
  }
  return entries.map((e) => ({ state: 'open', ...e }));
}

function closeEntry(ws, id, event, details) {
  const entry = loadEntries(ws).find((e) => e.id === id);
  if (!entry) fail('unknown_entry', `No log entry "${id}".`, 'Run gluely log to see them.');
  if (entry.state !== 'open') fail('already_closed', `${id} is already ${entry.state}.`);
  append(ws, { event, ref: id, at: new Date().toISOString(), ...details });
  return { ...entry, state: event, ...details };
}

export function promoteEntry(ws, id, to) {
  if (!to) fail('usage', 'Usage: gluely log promote <id> --to <context file or test id>');
  return closeEntry(ws, id, 'promoted', { to });
}

export function dropEntry(ws, id, why) {
  if (!why) fail('usage', 'Usage: gluely log drop <id> --why <reason>. A dropped lesson stays dropped, so say why.');
  refuseNames([why]);
  return closeEntry(ws, id, 'dropped', { why });
}

export function logCorrection(ws, item, by) {
  const AREAS = { voice: 'voice', exclusion: 'exclusion', icp: 'icp', reply: 'reply' };
  // With no reason attached this only records that a test exists, so writers shouldn't see it.
  const entry = addEntry(ws, { kind: 'correction', area: AREAS[item.kind], text: `${item.expect} is the right answer for test ${item.id}`, why: redact(item.why), by, source: item.why ? 'human' : 'gluely' });
  return promoteEntry(ws, entry.id, `tests/${item.kind}.yaml`);
}

export function listEntries(ws, { kind, area, play, scope, limit = 20 } = {}) {
  const chosen = loadEntries(ws).filter((e) => (!kind || e.kind === kind) && (!area || e.area === area) && (!play || e.play === play) && (!scope || e.scope === scope));
  return { total: chosen.length, entries: chosen.slice(Math.max(0, chosen.length - limit)).reverse() };
}

// What an agent reads before it writes. Dropped lessons stay out, and promoted ones stay
// in until the rule they became is visible in the context.
export function recall(ws, { area, scope, play, limit = 20 } = {}) {
  const lessons = loadEntries(ws).filter((e) => e.kind !== 'result' && e.state !== 'dropped' && e.source !== 'gluely')
    .filter((e) => (!area || e.area === area) && (!play || !e.play || e.play === play) && (!scope || !e.scope || e.scope === scope))
    .slice(0).reverse().slice(0, limit);
  return {
    area: area || 'all',
    scope: scope || null,
    lessons: lessons.map(({ id, kind, area: where, text, why, before, after, scope: whose, state }) => ({ id, kind, area: where, text, why, before, after, scope: whose, state })),
    read_first: area && HOMES[area] ? HOMES[area] : null,
  };
}

const words = (text) => new Set(String(text).toLowerCase().match(/[a-z][a-z'-]{3,}/g)?.filter((w) => !FILLER.has(w)) || []);

// Facts only. Gluely counts what humans changed and the agent decides what it means.
export function learn(ws) {
  const entries = loadEntries(ws);
  const open = entries.filter((e) => e.state === 'open' && e.kind !== 'result' && e.source !== 'gluely');
  const edits = entries.filter((e) => e.before && e.after && e.state !== 'dropped');
  const removed = new Map();
  const added = new Map();
  const tally = (map, word, id) => map.set(word, [...(map.get(word) || []), id]);
  for (const edit of edits) {
    const before = words(edit.before);
    const after = words(edit.after);
    for (const word of before) if (!after.has(word)) tally(removed, word, edit.id);
    for (const word of after) if (!before.has(word)) tally(added, word, edit.id);
  }
  const repeated = (map) => [...map].filter(([, ids]) => ids.length > 1).sort((a, b) => b[1].length - a[1].length).map(([word, ids]) => ({ word, times: ids.length, entries: ids }));
  const lengths = edits.map((e) => e.after.split(/\s+/).length - e.before.split(/\s+/).length);
  const areas = [...new Set(open.map((e) => e.area))].map((area) => {
    const inArea = open.filter((e) => e.area === area);
    return { area, open: inArea.length, home: HOMES[area] || null, entries: inArea.map(({ id, kind, text, why, scope }) => ({ id, kind, text, why, scope })) };
  }).sort((a, b) => b.open - a.open);
  return {
    open: open.length,
    promoted: entries.filter((e) => e.state === 'promoted').length,
    dropped: entries.filter((e) => e.state === 'dropped').length,
    decisions: entries.filter((e) => e.kind === 'decision').length,
    areas,
    edits: {
      count: edits.length,
      average_word_change: lengths.length ? Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length) : 0,
      keeps_removing: repeated(removed),
      keeps_adding: repeated(added),
    },
  };
}
