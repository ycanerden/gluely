// Gluely is glue, so a stack is whatever the company already uses. Tool names are free
// text on purpose. Options are examples to help someone choose, never a list of what's allowed.
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { fail } from './output.js';
import { loadConfig } from './workspace.js';

export const LAYERS = {
  agent: { label: 'Agent', question: 'Which agent does the thinking?', options: ['Claude Code', 'Cursor', 'Codex', 'Grok'] },
  store: { label: 'Data store', question: 'Where should the ledger live?', options: ['SQLite', 'Postgres', 'Supabase', 'Snowflake', 'BigQuery'] },
  crm: { label: 'CRM', question: 'Where do deals live?', options: ['HubSpot', 'Attio', 'Salesforce', 'Pipedrive', 'none yet'] },
  outreach: { label: 'Outreach', question: 'What sends your messages?', options: ['Instantly', 'Smartlead', 'Lemlist', 'HeyReach', 'Gmail drafts', 'by hand'] },
  scraping: { label: 'Signals', question: 'What collects signals?', options: ['Apify', 'PhantomBuster', 'Clay', 'Unipile', 'manual exports'] },
  enrichment: { label: 'Enrichment', question: 'What finds contact and company data?', options: ['Clay', 'Icypeas', 'Prospeo', 'People Data Labs', 'none yet'] },
  transcripts: { label: 'Transcripts', question: 'What records calls, with consent?', options: ['Fathom', 'Granola', 'Fireflies', 'Gong', 'none yet'] },
  analytics: { label: 'Product data', question: 'Where do product signals live?', options: ['PostHog', 'Amplitude', 'your warehouse', 'none yet'] },
};

export function loadStack(ws) {
  const stack = loadConfig(ws).stack || {};
  const layers = Object.entries(LAYERS).map(([id, layer]) => ({
    id,
    label: layer.label,
    question: layer.question,
    tool: stack[id] || null,
    options: layer.options,
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
