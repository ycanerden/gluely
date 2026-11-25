// Recipes: one call to one tool, written once so nobody writes the same request twice.
// A workflow try says `recipe: hunter-find-email` and gets the tool, request and pick from the
// recipe. Recipes live in library/recipes and in the workspace's own recipes/ folder, which wins
// on a clash. They hold no prices and no rankings: the price is still the company's own.
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { loadLibrary } from './library.js';
import { fail } from './output.js';
import { GLUELY_ROOT } from './workspace.js';

const BASE = path.join(GLUELY_ROOT, 'library', 'recipes');
const ownDir = (ws) => path.join(ws, 'recipes');
const NEEDS_ROW = /\{\{\s*row\.([\w.]+)\s*\}\}/g;
const NEEDS_ENV = /\{\{\s*env\.([A-Z0-9_]+)\s*\}\}/gi;

function readDir(dir, own) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).sort().map((file) => {
    const id = file.replace(/\.ya?ml$/, '');
    try {
      return { ...YAML.parse(fs.readFileSync(path.join(dir, file), 'utf8')), id, own };
    } catch (error) {
      return { id, own, parse_error: error.message.split('\n')[0] };
    }
  });
}

// The columns a recipe reads from each row and the keys it needs, worked out from the request
// itself, so the list can never disagree with what is sent.
const used = (request, pattern) => [...new Set([...JSON.stringify(request || {}).matchAll(pattern)].map((m) => m[1]))];

export function loadRecipes(ws) {
  const byId = new Map();
  for (const r of [...readDir(BASE, false), ...(ws ? readDir(ownDir(ws), true) : [])]) byId.set(r.id, r);
  return [...byId.values()]
    .map((r) => ({ ...r, reads: used(r.request, NEEDS_ROW), keys: used(r.request, NEEDS_ENV) }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function recipeIssues(ws, recipe) {
  const issues = [];
  if (recipe.parse_error) return [`can't read the file: ${recipe.parse_error}`];
  const library = loadLibrary(ws);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(recipe.id)) issues.push('the file name must be lowercase words joined by dashes');
  if (!recipe.tool) issues.push('needs tool: the name your price is saved under');
  else if (!library.tools.some((t) => t.name === recipe.tool)) issues.push(`${recipe.tool} is not in the tool library. Add it with gluely tools add first`);
  if (!library.jobs[recipe.job]) issues.push(`job must be one of ${Object.keys(library.jobs).join(', ')}`);
  if (!recipe.what) issues.push('needs what: one line on what it finds');
  if (!recipe.docs || !/^https:\/\//.test(String(recipe.docs))) issues.push('needs docs: the https link to the API reference it follows');
  if (!recipe.request?.url || !/^https:\/\//.test(String(recipe.request.url))) issues.push('request.url must start with https://');
  if (!recipe.pick || typeof recipe.pick !== 'object' || !Object.keys(recipe.pick).length) issues.push('needs pick: which fields of the answer go in which columns');
  if (recipe.writes && !recipe.pick?.[recipe.writes]) issues.push(`writes is ${recipe.writes}, but pick never fills it`);
  if (recipe.source && !recipe.pick?.[recipe.source]) issues.push(`source is ${recipe.source}, but pick never fills it`);
  if (used(recipe.request, NEEDS_ENV).some((k) => !/_KEY$|_TOKEN$/.test(k))) issues.push('keys are named like TOOL_KEY or TOOL_TOKEN');
  if (/\{\{\s*env\./.test(String(recipe.request?.url || '')) && !recipe.key_in_url) issues.push('a key in the url ends up in logs: send it in a header, or set key_in_url: true when the API allows nothing else');
  return issues;
}

export function listRecipes(ws, { job, tool } = {}) {
  const recipes = loadRecipes(ws)
    .filter((r) => (!job || r.job === job) && (!tool || String(r.tool).toLowerCase() === String(tool).toLowerCase()))
    .map((r) => ({
      id: r.id,
      tool: r.tool || null,
      job: r.job || null,
      what: r.what || null,
      reads: r.reads,
      writes: r.writes || null,
      ...(r.source ? { source: r.source } : {}),
      keys: r.keys,
      tested: r.tested || null,
      docs: r.docs || null,
      own: r.own,
      issues: recipeIssues(ws, r),
    }));
  return {
    recipes,
    note: 'Alphabetical, and nobody is ranked. tested is the last day someone ran it against the real API. Use one in a workflow try: - recipe: <id>',
  };
}

export function getRecipe(ws, id) {
  const found = loadRecipes(ws).find((r) => r.id === id);
  if (!found) fail('unknown_recipe', `No recipe "${id}".`, 'gluely recipes lists them.');
  return { ...found, issues: recipeIssues(ws, found) };
}

// A try that names a recipe gets the recipe's tool, request and pick. Anything the try sets
// itself wins, so a workflow can change one field without copying the rest.
export function expandTry(recipes, t) {
  if (!t || typeof t !== 'object' || !t.recipe) return t;
  const r = recipes.find((x) => x.id === t.recipe);
  if (!r || r.parse_error) return { ...t, unknown_recipe: true };
  const { recipe, ...rest } = t;
  return { recipe, tool: r.tool, request: r.request, pick: r.pick, ...rest };
}

// Expands every recipe in a workflow tree, inside branches too. A run stores the expanded
// tree, so changing a recipe later never changes a run halfway.
export function expandSteps(ws, steps, recipes = loadRecipes(ws)) {
  return (steps || []).map((s) => {
    if (!s || typeof s !== 'object') return s;
    const out = { ...s };
    if (s.type === 'tool') {
      if (s.recipe && !s.try) {
        const r = recipes.find((x) => x.id === s.recipe);
        out.try = [{ recipe: s.recipe }];
        delete out.recipe;
        if (r && !out.job) out.job = r.job;
        if (r && !out.writes && r.writes) out.writes = r.writes;
        if (r && !out.source && r.source) out.source = r.source;
      }
      if (out.try) {
        const tries = [out.try].flat().map((t) => expandTry(recipes, t));
        out.try = tries;
        const first = recipes.find((x) => x.id === tries.find((t) => t?.recipe)?.recipe);
        if (first && !out.job) out.job = first.job;
        if (first && !out.writes && first.writes) out.writes = first.writes;
        if (first && !out.source && first.source && out.writes === first.writes) out.source = first.source;
      }
    }
    if (s.type === 'branch' && Array.isArray(s.paths)) out.paths = s.paths.map((p) => (p && typeof p === 'object' ? { ...p, steps: expandSteps(ws, p.steps, recipes) } : p));
    return out;
  });
}
