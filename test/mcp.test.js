import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { makeWorkspace, ROOT, tempDir } from './helpers.js';

const BIN = path.join(ROOT, 'bin', 'gluely.js');

// Send JSON-RPC messages to `gluely mcp`, close stdin, and read every reply.
function mcp(messages, { cwd, args = [] } = {}) {
  const init = { jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test-agent', version: '1' } } };
  const input = [init, { jsonrpc: '2.0', method: 'notifications/initialized' }, ...messages].map((m) => JSON.stringify(m)).join('\n') + '\n';
  const result = spawnSync('node', [BIN, 'mcp', ...args], { cwd, input, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
  const replies = result.stdout.trim().split('\n').map((line) => JSON.parse(line));
  return { replies, byId: Object.fromEntries(replies.map((r) => [r.id, r])), err: result.stderr, code: result.status };
}

let next = 1;
const call = (name, args = {}) => ({ jsonrpc: '2.0', id: next++, method: 'tools/call', params: { name, arguments: args } });

test('mcp answers initialize with tools and instructions, and only JSON on stdout', () => {
  const ws = makeWorkspace();
  const { byId, code } = mcp([{ jsonrpc: '2.0', id: 'list', method: 'tools/list' }], { cwd: ws });
  assert.equal(code, 0);
  assert.equal(byId[0].result.protocolVersion, '2025-06-18');
  assert.match(byId[0].result.instructions, /gluely_status/);
  const tools = byId.list.result.tools;
  const names = tools.map((t) => t.name);
  assert.ok(names.includes('gluely_status') && names.includes('gluely_log_add'));
  assert.ok(!names.some((n) => n.includes('approve')), 'spending approval stays with people');
  for (const t of tools) {
    assert.ok(t.name.length <= 64 && t.title && t.inputSchema.type === 'object');
    assert.equal(typeof t.annotations.readOnlyHint, 'boolean');
  }
});

test('an unknown protocol version falls back to the newest one', () => {
  const init = { jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '1999-01-01' } };
  const result = spawnSync('node', [BIN, 'mcp'], { cwd: tempDir(), input: JSON.stringify(init) + '\n', encoding: 'utf8' });
  assert.equal(JSON.parse(result.stdout).result.protocolVersion, '2025-11-25');
});

test('tools run the same commands as the CLI, and a correction comes back in recall', () => {
  const ws = makeWorkspace();
  const status = call('gluely_status');
  const add = call('gluely_log_add', { kind: 'correction', area: 'voice', before: 'Hope you are well', after: 'Saw your post' });
  const lessons = call('gluely_recall', { area: 'voice' });
  const { byId } = mcp([status, add, lessons], { cwd: ws });
  assert.equal(byId[status.id].result.structuredContent.company.name, 'Acme');
  assert.match(byId[add.id].result.structuredContent.id, /^log-/);
  assert.equal(byId[add.id].result.structuredContent.by, 'test-agent', 'by defaults to the connected client');
  assert.equal(byId[lessons.id].result.structuredContent.lessons[0].after, 'Saw your post');
});

test('mistakes come back as tool errors, not crashes', () => {
  const ws = makeWorkspace();
  const missing = call('gluely_results');
  const extra = call('gluely_status', { nope: 1 });
  const unknown = call('gluely_send_everything');
  const { byId, code } = mcp([missing, extra, unknown, { jsonrpc: '2.0', id: 'm', method: 'resources/list' }], { cwd: ws });
  assert.equal(code, 0);
  assert.equal(byId[missing.id].result.isError, true);
  assert.equal(byId[missing.id].result.structuredContent.error.code, 'usage');
  assert.equal(byId[extra.id].result.isError, true);
  assert.equal(byId[unknown.id].result.structuredContent.error.code, 'unknown_tool');
  assert.equal(byId.m.error.code, -32601);
});

test('--workspace points the server at a brain from anywhere', () => {
  const ws = makeWorkspace();
  const elsewhere = tempDir();
  const status = call('gluely_status');
  assert.equal(mcp([status], { cwd: elsewhere }).byId[status.id].result.structuredContent.error.code, 'no_workspace');
  const again = call('gluely_status');
  assert.equal(mcp([again], { cwd: elsewhere, args: ['--workspace', ws] }).byId[again.id].result.structuredContent.company.name, 'Acme');
});

test('a new workspace is wired for Claude Code and Cursor', () => {
  const ws = makeWorkspace();
  const claude = JSON.parse(fs.readFileSync(path.join(ws, '.mcp.json'), 'utf8'));
  assert.deepEqual(claude.mcpServers.gluely.args, ['mcp']);
  assert.ok(fs.existsSync(path.join(ws, '.cursor', 'mcp.json')));
  assert.ok(!fs.existsSync(path.join(ws, 'mcp.json')) && !fs.existsSync(path.join(ws, 'cursor')));
});

test('an agent can ask where a deal is at, but cannot erase anyone', () => {
  const ws = makeWorkspace();
  const stage = call('gluely_account_stage', { domain: 'globex.example', stage: 'in_conversation', name: 'Globex', owner: 'sam' });
  const note = call('gluely_account_note', { domain: 'globex.example', text: 'Asked about the security review' });
  const used = call('gluely_skill_used', { skill: 'gtm-mode/bdr-reply', outcome: 'worked' });
  const deal = call('gluely_account', { domain: 'globex.example' });
  const list = { jsonrpc: '2.0', id: 'list', method: 'tools/list' };
  const { byId } = mcp([stage, note, used, deal, list], { cwd: ws });
  const answer = byId[deal.id].result.structuredContent;
  assert.deepEqual([answer.stage, answer.owner, answer.notes[0].untrusted], ['in_conversation', 'sam', true]);
  assert.equal(byId[used.id].result.structuredContent.by, 'test-agent');
  assert.ok(!byId.list.result.tools.some((t) => t.name.includes('erase')), 'erasure requests stay with people');
});
