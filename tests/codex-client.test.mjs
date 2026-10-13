import test from 'node:test';
import assert from 'node:assert/strict';
import { CodexClient } from '../apps/desktop/codex-client.cjs';

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
