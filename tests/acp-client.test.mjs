import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { ACPClient } = require('../apps/desktop/acp-client.cjs');
const { AgentClient } = require('../apps/desktop/agent-client.cjs');

test('ACP applies advertised reasoning configuration, resets defaults and rejects unsupported levels', async () => {
  const sent = [];
  let done;
  const client = new ACPClient('.qa/reasoning', {}, (e) => {
    if (e.type === 'done') done(e);
  });
  client.connection = { authenticated: true };
  const options = [
    {
      id: 'effort',
      category: 'thought_level',
      type: 'select',
      currentValue: 'medium',
      options: [
        {
          group: 'levels',
          options: ['low', 'medium', 'high'].map((value) => ({ value, name: value })),
        },
      ],
    },
  ];
  client.request = async (method, params) => {
    sent.push({ method, params });
    if (method === 'session/new')
      return { sessionId: 's', configOptions: structuredClone(options) };
    if (method === 'session/set_config_option') {
      assert.equal(params.configId, 'effort');
      return { configOptions: [{ ...options[0], currentValue: params.value }] };
    }
    if (method === 'session/prompt') return { stopReason: 'end_turn' };
    throw new Error('Unexpected request ' + method);
  };
  client.tool = async () => ({ files: [] });
  const run = async (reasoningEffort) => {
    const finished = new Promise((resolve) => {
      done = resolve;
    });
    await client.start({
      projectId: 'p',
      runId: 'r',
      prompt: 'hello',
      context: '',
      model: 'default',
      readOnly: true,
      reasoningEffort,
    });
    return finished;
  };
  assert.equal((await run('high')).status, 'completed');
  assert.equal((await run('')).status, 'completed');
  assert.deepEqual(
    sent.filter((s) => s.method === 'session/set_config_option').map((s) => s.params.value),
    ['high', 'medium'],
  );
  assert.equal(sent.filter((s) => s.method === 'session/new').length, 1);
  assert.match((await run('unsupported')).error, /不支持/);
  assert.equal(sent.filter((s) => s.method === 'session/prompt').length, 2);
});

test('deleting one conversation keeps other ACP sessions and modes', () => {
  const client = new ACPClient('.qa/clear-context', () => {});
  const keys = [
    ['p', 'c1', 'm', false],
    ['p', 'c2', 'm', false],
    ['p', 'c1', 'm', true],
    ['q', 'c1', 'm', false],
  ].map(JSON.stringify);
  keys.forEach((key) => client.sessions.set(key, {}));
  client.clearHistory('p', 'agent', 'c1');
  assert.deepEqual([...client.sessions.keys()], keys.slice(1));
});
test('ACP edits editor buffers, isolates conversations, refuses read-only/outside writes and cancels', async () => {
  await fs.mkdir(path.resolve('.qa'), { recursive: true });
  const dir = await fs.mkdtemp(path.resolve('.qa/acp-test-'));
  const events = [];
  let source = '这是苹果。',
    writes = 0;
  const config = {
    preset: 'custom',
    protocol: 'acp',
    command: process.execPath,
    args: [path.resolve('tests/fixtures/acp-agent.cjs')],
  };
  const client = new ACPClient(dir, config, (event) => {
    events.push(event);
    if (event.type !== 'tool') return;
    if (event.tool === 'texite_list_files')
      client.reply(event.requestId, { success: true, value: { files: [{ path: 'main.tex' }] } });
    if (event.tool === 'texite_read_file')
      client.reply(event.requestId, { success: true, value: { content: source } });
    if (event.tool === 'texite_apply_changes') {
      assert.equal(event.arguments.changes[0].before, source);
      source = event.arguments.changes[0].after;
      writes++;
      client.reply(event.requestId, { success: true, value: {} });
    }
  });
  const run = async (id, prompt = 'translate', readOnly = false, conversationId = 'one') => {
    await client.start({
      projectId: 'p',
      runId: id,
      prompt,
      readOnly,
      conversationId,
      model: 'test-model',
      context: '{}',
    });
    for (let i = 0; i < 300 && !events.some((e) => e.runId === id && e.type === 'done'); i++)
      await new Promise((r) => setTimeout(r, 10));
    return events.find((e) => e.runId === id && e.type === 'done');
  };
  try {
    assert.equal((await client.connect()).authenticated, true);
    assert.equal((await run('r1')).status, 'completed');
    assert.equal(source, '这是apple。');
    assert.equal(await fs.stat(path.join(dir, 'acp-workspace/main.tex')).catch(() => null), null);
    await run('r2', 'translate', false, 'two');
    assert.notEqual(
      events.find((e) => e.runId === 'r1' && e.type === 'text').delta,
      events.find((e) => e.runId === 'r2' && e.type === 'text').delta,
    );
    assert.equal((await run('r3', 'translate', true)).status, 'failed');
    assert.equal(writes, 2);
    assert.equal((await run('r4', 'outside')).status, 'failed');
    await client.start({
      projectId: 'p',
      runId: 'r5',
      prompt: 'wait',
      readOnly: false,
      model: 'test-model',
      context: '{}',
    });
    await client.cancel();
    assert.equal(events.find((e) => e.runId === 'r5' && e.type === 'done').status, 'interrupted');
    assert.equal(client.child, null);
  } finally {
    await client.disconnect();
  }
});
test('Agent CLI profiles persist independently and reject invalid launch arguments', async () => {
  await fs.mkdir(path.resolve('.qa'), { recursive: true });
  const dir = await fs.mkdtemp(path.resolve('.qa/agent-settings-')),
    client = new AgentClient(dir, () => {});
  await client.configure({ preset: 'qwen', protocol: 'acp', command: 'qwen', args: ['--acp'] });
  await client.configure({
    preset: 'deepseek',
    protocol: 'acp',
    command: 'opencode',
    args: ['acp'],
    model: 'deepseek/model',
  });
  const reopened = new AgentClient(dir, () => {});
  assert.equal((await reopened.getConfig()).preset, 'deepseek');
  assert((await reopened.getProfiles()).some((p) => p.preset === 'qwen' && p.command === 'qwen'));
  await assert.rejects(() =>
    reopened.configure({ preset: 'custom', protocol: 'acp', command: 'x', args: 'unsafe string' }),
  );
});
