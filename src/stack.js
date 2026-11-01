// Gluely is glue, so a stack is whatever the company already uses. Tool names are free
// text on purpose: the library offers examples and never decides what's allowed.
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { loadLibrary } from './library.js';
import { fail } from './output.js';
import { loadConfig } from './workspace.js';

export const LAYERS = {
  agent: { label: 'Agent', question: 'Which agent does the thinking?', jobs: ['agent'] },
  store: { label: 'Data store', question: 'Where should the ledger live?', jobs: ['store'] },
  crm: { label: 'CRM', question: 'Where do deals live?', jobs: ['crm'] },
  outreach: { label: 'Outreach', question: 'What sends your messages?', jobs: ['outreach'] },
  scraping: { label: 'Signals', question: 'What collects signals?', jobs: ['signal-data', 'person-data', 'hiring-data'] },
  enrichment: { label: 'Enrichment', question: 'What finds contact and company data?', jobs: ['contact-data'] },
  transcripts: { label: 'Transcripts', question: 'What records calls, with consent?', jobs: ['transcripts'] },
  analytics: { label: 'Product data', question: 'Where do product signals live?', jobs: ['product-data'] },
};

export const layerForJob = (job) => Object.keys(LAYERS).find((id) => LAYERS[id].jobs.includes(job)) || null;

export function loadStack(ws) {
  const stack = loadConfig(ws).stack || {};
  const library = loadLibrary(ws);
  const layers = Object.entries(LAYERS).map(([id, layer]) => ({
    id,
    label: layer.label,
    question: layer.question,
    tool: stack[id] || null,
    options: library.tools.filter((t) => t.jobs.some((j) => layer.jobs.includes(j))).map((t) => t.name),
  }));
  return { layers, named: layers.filter((l) => l.tool).length, note: 'Options are examples. Any tool works.' };
}

export function setStack(ws, layer, tool) {
  if (!LAYERS[layer]) fail('bad_layer', `Unknown layer "${layer}". Use ${Object.keys(LAYERS).join(', ')}.`);
  if (!tool) fail('usage', 'Usage: gluely stack set <layer> <any tool name>');
  const file = path.join(ws, 'workspace.yaml');
  const doc = YAML.parseDocument(fs.readFileSync(file, 'utf8'));
  doc.setIn(['stack', layer], tool);
  fs.writeFileSync(file, doc.toString());
  return { layer, tool };
}
