import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { ACPClient } = require('../apps/desktop/acp-client.cjs');
const { AgentClient } = require('../apps/desktop/agent-client.cjs');
test('ACP edits editor buffers, isolates conversations, refuses read-only/outside writes and cancels', async () => {
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
