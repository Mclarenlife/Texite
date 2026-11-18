import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { AgentClient } from '../apps/desktop/agent-client.cjs';
import { LiteratureClient } from '../apps/desktop/literature-client.cjs';

test('literature forwards its chosen reasoning effort to the CLI independently of chat', async () => {
  let input;
  const ai = {
    connect: async () => ({ authenticated: true, models: [{ id: 'model', isDefault: true }] }),
    start: async (value) => {
      input = value;
      client.event({ type: 'text', runId: value.runId, delta: 'answer' });
      client.event({ type: 'done', runId: value.runId, status: 'completed' });
    },
    clearHistory() {},
  };
  const client = new LiteratureClient(ai);
  assert.equal(
    await client.ask({
      id: 'effort',
      mode: 'cli',
      model: '',
      prompt: 'research',
      context: '',
      reasoningEffort: 'high',
    }),
    'answer',
  );
  assert.equal(input.reasoningEffort, 'high');
  assert.equal(input.readOnly, true);
});

test('literature uses the saved ACP program in read-only turns and routes its events separately', async () => {
  await fs.mkdir('.qa', { recursive: true });
  const dir = await fs.mkdtemp(path.resolve('.qa/literature-cli-'));
  const unhandled = [];
  const ai = new AgentClient(dir, (event) => {
    if (!client.event(event) && event.type !== 'connection') unhandled.push(event);
  });
  const client = new LiteratureClient(ai);
  try {
    await ai.configure({
      preset: 'custom',
      protocol: 'acp',
      command: process.execPath,
      args: [path.resolve('tests/fixtures/acp-agent.cjs')],
    });
    const input = {
      mode: 'cli',
      model: '',
      id: 'first',
      context: 'wave study',
      prompt: 'literature fixture',
    };
    assert.equal(await client.ask(input), '{"query":"wave propagation"}');
    assert.equal(await client.ask({ ...input, id: 'second' }), '{"query":"wave propagation"}');
    assert.deepEqual(unhandled, []);
  } finally {
    await ai.disconnect();
  }
});
test('desktop literature API uses the shared chat profile', async () => {
  const client = new LiteratureClient(
    null,
    {
      load: async () => ({
        baseURL: 'https://example.test/v1',
        model: 'fixture',
        apiKey: 'configured',
      }),
    },
    async (url, init) => {
      assert.equal(url, 'https://example.test/v1/chat/completions');
      assert.equal(init.headers.Authorization, 'Bearer configured');
      assert.equal(JSON.parse(init.body).messages[1].content, 'paper excerpt');
      return Response.json({ choices: [{ message: { content: 'test answer' } }] });
    },
  );
  assert.equal(
    await client.ask({
      id: 'api',
      mode: 'api',
      model: '',
      prompt: 'extract',
      context: 'paper excerpt',
    }),
    'test answer',
  );
});
