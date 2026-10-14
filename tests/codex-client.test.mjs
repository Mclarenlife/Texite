import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { CodexClient, resolveBinary, binaryEnvironment } from '../apps/desktop/codex-client.cjs';

test('clearing a mode discards only matching Codex contexts; active tasks are protected', () => {
  const client = new CodexClient('.qa/clear-context', () => {});
  client.threads = { 'p:m:false': 'agent', 'p:m:true': 'chat', 'q:m:false': 'other' };
  client.clearHistory('p', 'chat');
  assert.deepEqual(client.threads, { 'p:m:false': 'agent', 'q:m:false': 'other' });
  client.active = {};
  assert.throws(() => client.clearHistory(null), /结束/);
  client.active = null;
  client.clearHistory('p', 'agent');
  assert.deepEqual(client.threads, { 'q:m:false': 'other' });
  client.clearHistory(null);
  assert.deepEqual(client.threads, {});
});

test('app bundles and non-Codex executables are rejected before changing a working selection', async () => {
  await fs.mkdir('.qa', { recursive: true });
  const base = await fs.mkdtemp(path.resolve('.qa/codex-selection-'));
  const bundle = path.join(base, 'ChatGPT.app');
  await fs.mkdir(bundle);
  const saved = JSON.stringify({ binary: 'previous-working-codex' });
  await fs.writeFile(path.join(base, 'settings.json'), saved);
  const client = new CodexClient(base, () => {}, { probe: async () => 'some-other-app 1.0' });
  client.connection = { connected: true };
  await assert.rejects(client.chooseBinary(bundle), /command -v codex/);
  assert(client.connection.connected);
  await assert.rejects(client.chooseBinary(process.execPath), /不是 Codex CLI/);
  assert.equal(await fs.readFile(path.join(base, 'settings.json'), 'utf8'), saved);
  assert(client.connection.connected);
  client.probe = async () => 'codex-cli 0.162.0';
  await client.chooseBinary(process.execPath);
  assert.equal(
    JSON.parse(await fs.readFile(path.join(base, 'settings.json'), 'utf8')).binary,
    process.execPath,
  );
  assert.equal(client.connection, null);
});

test('missing paths and non-executable files produce actionable errors', async (t) => {
  await assert.rejects(resolveBinary('codex'), /完整文件路径/);
  await assert.rejects(resolveBinary(path.resolve('.qa/missing-codex-fixture')), /不存在/);
  if (process.platform === 'win32') return;
  const base = await fs.mkdtemp(path.resolve('.qa/codex-permission-'));
  const file = path.join(base, 'codex');
  await fs.writeFile(file, 'test', { mode: 0o600 });
  await assert.rejects(resolveBinary(file), /执行权限/);
});

test('macOS GUI launches include the selected CLI bin directory for npm/nvm Node resolution', () => {
  const env = { PATH: '/usr/bin:/bin', TEST: 'preserved' };
  const result = binaryEnvironment('/Users/test/.nvm/versions/node/v24/bin/codex', 'darwin', env);
  assert.equal(result.PATH.split(':')[0], '/Users/test/.nvm/versions/node/v24/bin');
  assert(result.PATH.includes('/opt/homebrew/bin'));
  assert.equal(result.TEST, 'preserved');
  assert.equal(env.PATH, '/usr/bin:/bin');
  assert.equal(binaryEnvironment('codex.exe', 'win32', env), env);
});

function fixture(readOnly = false) {
  const sent = [],
    events = [];
  const client = new CodexClient('.qa/codex-unit', (e) => events.push(e));
  client.child = { stdin: { writable: true, write: (v) => sent.push(JSON.parse(v)) } };
  client.connection = { authenticated: true, models: [{ id: 'test' }] };
  client.active = { runId: 'r', projectId: 'p', threadId: 'th', turnId: 'tu', calls: 0, readOnly };
  return { client, sent, events };
}
test('Codex protocol correlates replies, refuses native tools, and scopes project calls', async () => {
  const { client, sent, events } = fixture();
  const pending = client.request('example', {});
  client.message({ id: sent[0].id, result: { ok: true } });
  assert.deepEqual(await pending, { ok: true });
  for (const method of [
    'item/commandExecution/requestApproval',
    'item/fileChange/requestApproval',
  ]) {
    client.message({ id: method, method, params: {} });
    assert.equal(sent.at(-1).result.decision, 'decline');
  }
  client.message({ id: 'permission', method: 'item/permissions/requestApproval', params: {} });
  assert.deepEqual(sent.at(-1).result, { permissions: {}, scope: 'turn' });
  const call = {
    id: 'tool',
    method: 'item/tool/call',
    params: {
      threadId: 'th',
      turnId: 'tu',
      tool: 'texite_read_file',
      arguments: { path: 'main.tex' },
    },
  };
  client.message({ ...call, params: { ...call.params, threadId: 'other' } });
  assert.equal(sent.at(-1).result.success, false);
  assert.equal(events.length, 0);
  client.message(call);
  assert.equal(events[0].projectId, 'p');
  client.reply(events[0].requestId, { success: true, value: { content: 'hello' } });
  assert.equal(sent.at(-1).id, 'tool');
  assert.equal(sent.at(-1).result.contentItems[0].type, 'inputText');
  client.message({
    method: 'item/agentMessage/delta',
    params: { threadId: 'th', turnId: 'different', delta: 'ignore' },
  });
  assert.equal(events.length, 1);
  client.message({
    method: 'turn/completed',
    params: { threadId: 'th', turn: { id: 'tu', status: 'completed' } },
  });
  assert.equal(events.at(-1).status, 'completed');
});
test('read-only tools and interrupted task responses cannot edit', async () => {
  const { client, sent, events } = fixture(true);
  client.message({
    id: 1,
    method: 'item/tool/call',
    params: { threadId: 'th', turnId: 'tu', tool: 'texite_apply_changes', arguments: {} },
  });
  assert.equal(sent.at(-1).result.success, false);
  client.message({
    id: 2,
    method: 'item/tool/call',
    params: { threadId: 'th', turnId: 'tu', tool: 'texite_compile', arguments: {} },
  });
  assert.equal(sent.at(-1).result.success, false);
  client.active.turnId = undefined;
  await client.cancel();
  assert.equal(events.at(-1).status, 'interrupted');
  assert.equal(client.active, null);
});
test('cancel before turn/start response interrupts the late turn and invalidates thread reuse', async () => {
  const { client } = fixture();
  client.active = null;
  client.threads['p:test:false'] = 'th';
  let resolveTurn;
  const methods = [];
  client.request = async (method, params) => {
    methods.push({ method, params });
    if (method === 'turn/start')
      return new Promise((resolve) => {
        resolveTurn = resolve;
      });
    return {};
  };
  const started = client.start({
    runId: 'r',
    projectId: 'p',
    model: 'test',
    prompt: 'test',
    context: '',
    readOnly: false,
  });
  await client.cancel();
  resolveTurn({ turn: { id: 'late' } });
  await started;
  assert.equal(methods.at(-1).method, 'turn/interrupt');
  assert.equal(methods.at(-1).params.turnId, 'late');
  assert.equal(client.threads['p:test:false'], undefined);
});
