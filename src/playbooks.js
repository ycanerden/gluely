// Walks a play one step at a time. Humans get an interactive picker and agents use the
// same steps through --json, so both go through exactly this logic.
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { loadExcuses, personaIds } from './context.js';
import { getPlaybook, toolsForJob } from './library.js';
import { fail } from './output.js';
import { addEntry, refuseNames } from './log.js';
import { LAYERS, layerForJob, loadStack, setStack } from './stack.js';

// Time comes first because a small list can take years to reach a touch count.
const KILL_OPTIONS = [
  { label: 'After 90 days, with no meetings', rule: { after_days: 90, if: 'meetings == 0' } },
  { label: 'After 100 touches, with under 0.5% meetings', rule: { after_touches: 100, if: 'meeting_rate < 0.5%' } },
  { label: 'After 50 touches, with no positive replies', rule: { after_touches: 50, if: 'positive_rate == 0' } },
  { label: 'After 300 touches, with under 0.5% meetings', rule: { after_touches: 300, if: 'meeting_rate < 0.5%' } },
];

const playFile = (ws, id) => path.join(ws, 'plays', `${id}.yaml`);

export function readPlay(ws, id) {
  const file = playFile(ws, id);
  if (!fs.existsSync(file)) fail('unknown_play', `No play "${id}" yet.`, `Start one with gluely plays start ${id}.`);
  try {
    return YAML.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    return fail('bad_play', `plays/${id}.yaml is not valid YAML: ${error.message.split('\n')[0]}`);
  }
}

export const savePlay = (ws, spec) => fs.writeFileSync(playFile(ws, spec.id), YAML.stringify(spec));

function setPath(target, dotted, value) {
  const keys = dotted.split('.');
  const last = keys.pop();
  const parent = keys.reduce((node, key) => (node[key] ??= {}), target);
  parent[last] = value;
}

export function startPlay(ws, playbookId, id = playbookId) {
  const book = getPlaybook(playbookId);
  if (!/^[a-z0-9-]+$/.test(id)) fail('usage', 'Play ids use lowercase letters, numbers and dashes.');
  if (fs.existsSync(playFile(ws, id))) {
    const existing = readPlay(ws, id);
    if (existing.playbook !== book.id) fail('play_exists', `plays/${id}.yaml already exists and wasn't built from ${book.id}.`, `Use a new name: gluely plays start ${book.id} --as ${id}-2.`);
  } else {
    savePlay(ws, {
      id,
      status: 'draft',
      playbook: book.id,
      priority: 50,
      hypothesis: book.hypothesis.trim(),
      signal: { ...book.signal },
      audience: { personas: [], icp_band: ['hot', 'warm'] },
      excuse: { variants: ['a'] },
      action: {},
      success: { primary: 'meeting_booked' },
      kill: { after_touches: 100, if: 'meeting_rate < 0.5%' },
      setup: {},
    });
  }
  return nextStep(ws, id);
}

function resolveStep(ws, step, spec) {
  const out = { id: step.id, ask: step.ask, why: step.why, type: step.type };
  if (step.type === 'choice') out.options = step.options.map((label) => ({ label, value: label }));
  if (step.type === 'tool') {
    const yours = loadStack(ws).layers.map((l) => l.tool).filter(Boolean);
    out.job = step.job;
    out.any_tool_allowed = true;
    out.waterfall = Boolean(step.waterfall);
    out.options = toolsForJob(ws, step.job, yours).map((t) => ({ label: t.name, value: t.name, hint: t.hint, yours: t.yours }));
  }
  if (step.type === 'persona') out.options = personaIds(ws).map((p) => ({ label: p, value: p }));
  if (step.type === 'excuse') {
    const rule = loadExcuses(ws).find((e) => e.signal === spec.signal.type);
    out.pattern = rule?.pattern || null;
    out.never = rule?.never || [];
  }
  if (step.type === 'kill') out.options = KILL_OPTIONS.map((k, i) => ({ label: k.label, value: String(i) }));
  return out;
}

export function nextStep(ws, id) {
  const spec = readPlay(ws, id);
  const book = getPlaybook(spec.playbook);
  const index = book.steps.findIndex((s) => !(s.id in (spec.setup || {})));
  const base = { play: id, playbook: book.id, name: book.name, total: book.steps.length };
  if (index < 0) return { ...base, done: true, answered: book.steps.length, steps: summary(book, spec) };
  return { ...base, done: false, number: index + 1, step: resolveStep(ws, book.steps[index], spec) };
}

function estimate(step, count) {
  const [low, high] = step.estimate.yearly_rate;
  const perMonth = (rate) => (count * rate) / 12;
  const months = Math.ceil(100 / perMonth(high));
  return {
    low: Math.round(perMonth(low) * 10) / 10,
    high: Math.round(perMonth(high) * 10) / 10,
    months_to_100_at_best: months,
    assumption: `${low * 100}% to ${high * 100}% of people change jobs each year, before any ICP filter`,
    warning: months > 3 ? 'Too few for rates to teach you much soon. Learn from replies and calls instead, or widen the list.' : null,
  };
}

export function answerStep(ws, id, stepId, raw, by = 'agent') {
  const spec = readPlay(ws, id);
  const book = getPlaybook(spec.playbook);
  const step = book.steps.find((s) => s.id === stepId);
  if (!step) fail('unknown_step', `"${stepId}" isn't a step in ${book.id}. Steps: ${book.steps.map((s) => s.id).join(', ')}.`);
  const value = String(raw ?? '').trim();
  if (!value) fail('empty_answer', 'This step needs an answer.');
  refuseNames([value]);

  let saved = value;
  let extra = {};
  if (step.type === 'number') {
    saved = Number(value.replace(/[, ]/g, ''));
    if (!Number.isFinite(saved) || saved <= 0) fail('bad_answer', 'Answer with a number above zero.');
    if (step.estimate) extra = { estimate: estimate(step, saved) };
  }
  if (step.type === 'kill') {
    const chosen = KILL_OPTIONS[Number(value)];
    if (!chosen) fail('bad_answer', `Answer with one of 0 to ${KILL_OPTIONS.length - 1}.`);
    spec.kill = chosen.rule;
    saved = chosen.label;
  }
  if (step.type === 'persona') {
    const known = personaIds(ws);
    const wanted = value.split(',').map((p) => p.trim()).filter(Boolean);
    const unknown = wanted.filter((p) => !known.includes(p));
    if (known.length && unknown.length) fail('unknown_persona', `No persona "${unknown[0]}".`, `Write it in context/personas/ first. You have: ${known.join(', ')}.`);
    if (!known.length) extra = { warning: 'No personas are written yet, so write this one in context/personas/ before the play goes active.' };
    saved = wanted;
  }
  // A waterfall is a recipe in the play. Gluely prices it, and the agent runs it after approval.
  let written = saved;
  if (step.type === 'tool' && step.waterfall) {
    const chain = value.split(',').map((tool) => tool.trim()).filter(Boolean);
    if (new Set(chain).size !== chain.length) fail('bad_answer', 'Each tool can appear once in a waterfall.');
    const { waterfall, ...rest } = spec.enrich || {};
    spec.enrich = chain.length > 1 ? { ...rest, waterfall: { providers: chain, stop_on: 'verified' } } : rest;
    saved = chain.length > 1 ? chain : chain[0];
    written = chain[0];
  }
  if (step.writes) setPath(spec, step.writes, written);
  spec.setup = { ...spec.setup, [step.id]: Array.isArray(saved) ? [...saved] : saved };
  savePlay(ws, spec);
  // The excuse is the one answer an agent should remember when it writes, so it counts as a lesson.
  const excuse = step.type === 'excuse';
  addEntry(ws, {
    kind: excuse ? 'input' : 'decision',
    area: excuse ? 'excuse' : step.type === 'tool' ? 'tool' : 'play',
    play: id, by, source: excuse ? (by === 'human' ? 'human' : 'agent') : 'gluely',
    text: excuse ? saved : `${step.ask} ${Array.isArray(saved) ? saved.join(', ') : saved}`,
  });

  if (step.type === 'tool') {
    const layer = layerForJob(step.job);
    if (layer && !loadStack(ws).layers.find((l) => l.id === layer).tool) {
      setStack(ws, layer, written);
      extra = { ...extra, added_to_stack: { layer, label: LAYERS[layer].label, tool: written } };
    }
  }
  return { saved: { step: step.id, value: saved }, ...extra, next: nextStep(ws, id) };
}

function summary(book, spec) {
  return book.steps.map((s) => {
    const value = spec.setup?.[s.id];
    return { id: s.id, ask: s.ask, type: s.type, answer: Array.isArray(value) ? value.join(', ') : value };
  });
}
