import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { agentCompletion, runAPIAgent, validateRounds } from '../apps/desktop/api-agent.mjs';
import { ChatClient } from '../apps/desktop/chat-client.cjs';
const config = { baseURL: 'https://example.test/v1', model: 'test' };
const signal = () => new AbortController().signal;
const reply = (tool, args = {}) =>
  new Response(
    JSON.stringify({
      choices: [
        {
          finish_reason: tool ? 'tool_calls' : 'stop',
          message: tool
            ? {
                tool_calls: [
                  {
                    id: 'call-1',
                    type: 'function',
                    function: { name: tool, arguments: JSON.stringify(args) },
                  },
                ],
              }
            : { content: '完成' },
        },
      ],
      usage: { prompt_tokens: 100, completion_tokens: 20 },
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );

test('API stream collects fragmented Unicode tool args and usage after finish_reason', async () => {
  const values = [
    {
      choices: [
        {
          delta: {
            tool_calls: [
              { index: 0, id: 'c', function: { name: 'texite_search', arguments: '{"query":"苹' } },
            ],
          },
        },
      ],
    },
    {
      choices: [
        {
          delta: { tool_calls: [{ index: 0, function: { arguments: '果"}' } }] },
          finish_reason: 'tool_calls',
        },
      ],
    },
    { choices: [], usage: { prompt_tokens: 123, completion_tokens: 45 } },
  ];
  const bytes = new TextEncoder().encode(
    values.map((v) => 'data: ' + JSON.stringify(v) + '\r\n\r\n').join('') + 'data: [DONE]\r\n\r\n',
  );
  const result = await agentCompletion(
    config,
    [],
    () => {},
    signal(),
    async () =>
      new Response(
        new ReadableStream({
          start(c) {
            for (const byte of bytes) c.enqueue(new Uint8Array([byte]));
            c.close();
          },
        }),
      ),
  );
  assert.deepEqual(JSON.parse(result.toolCalls[0].function.arguments), { query: '苹果' });
  assert.deepEqual(result.usage, { inputTokens: 123, outputTokens: 45 });
});
test('API loop executes tools sequentially, reports total usage and enforces request budget', async () => {
  let requests = 0,
    writes = 0;
  const events = [];
  await runAPIAgent(
    config,
    { maxRounds: 3, messages: [{ role: 'user', content: 'edit' }] },
    (e) => events.push(e),
    async (tool) => {
      assert.equal(tool, 'texite_patch');
      writes++;
      return { success: true, value: {} };
    },
    signal(),
    async (_url, options) => {
      const request = JSON.parse(options.body);
      assert(request.tools.some((t) => t.function.name === 'texite_read_lines'));
      assert(!request.tools.some((t) => t.function.name === 'texite_apply_changes'));
      requests++;
      if (requests === 1) return reply('texite_patch');
      assert.equal(request.messages.at(-1).role, 'tool');
      return reply();
    },
  );
  assert.equal(requests, 2);
  assert.equal(writes, 1);
  assert.deepEqual(events.filter((e) => e.type === 'usage').at(-1).usage, {
    rounds: 2,
    maxRounds: 3,
    reportedRounds: 2,
    inputTokens: 200,
    outputTokens: 40,
  });
  requests = 0;
  await assert.rejects(
    runAPIAgent(
      config,
      { maxRounds: 2, messages: [] },
      () => {},
      async () => ({ success: true }),
      signal(),
      async () => {
        requests++;
        return reply('texite_list_files');
      },
    ),
    /2 轮/,
  );
  assert.equal(requests, 2);
  for (const n of [0, 31, 1.5, NaN]) assert.throws(() => validateRounds(n));
});
test('unknown tools and invalid JSON never execute; truncated streams and cancellation do not write', async () => {
  let executions = 0,
    requests = 0;
  await runAPIAgent(
    config,
    { maxRounds: 2, messages: [] },
    () => {},
    async () => {
      executions++;
    },
    signal(),
    async () => (++requests === 1 ? reply('shell') : reply()),
  );
  assert.equal(executions, 0);
  await assert.rejects(
    runAPIAgent(
      config,
      { maxRounds: 2, messages: [] },
      () => {},
      async () => {
        executions++;
      },
      signal(),
      async () =>
        new Response(
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c","function":{"name":"texite_patch","arguments":"{}"}}]}}]}\n\n',
        ),
    ),
    /中断/,
  );
  const controller = new AbortController();
  await assert.rejects(
    runAPIAgent(
      config,
      { maxRounds: 2, messages: [] },
      () => {},
      async () => {
        executions++;
      },
      controller.signal,
      async () => {
        controller.abort();
        return reply('texite_patch');
      },
    ),
    /abort/i,
  );
  assert.equal(executions, 0);
});
test('desktop API Agent routes tool replies and cancels pending requests without leaking credentials', async () => {
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const request = JSON.parse(body);
    const response = reply(
      request.messages.some((m) => m.role === 'tool') ? null : 'texite_list_files',
    );
    res.setHeader('Content-Type', 'application/json');
    res.end(await response.text());
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  await fs.mkdir('.qa', { recursive: true });
  const directory = await fs.mkdtemp(path.resolve('.qa/api-agent-'));
  const events = [];
  let autoReply = true;
  const client = new ChatClient(directory, { isEncryptionAvailable: () => false }, (e) => {
    events.push(e);
    if (e.type === 'tool') {
      if (autoReply) client.reply(e.requestId, { success: true, value: { files: [] } });
      else client.cancel();
    }
  });
  try {
    await client.save({
      baseURL: `http://127.0.0.1:${server.address().port}/v1`,
      model: 'test',
      apiKey: 'private-test-secret',
    });
    const input = {
      runId: 'r',
      projectId: 'p',
      messages: [{ role: 'user', content: 'read' }],
      agent: true,
      maxRounds: 3,
    };
    await client.start(input);
    assert.equal(events.at(-1).status, 'completed');
    assert(!JSON.stringify(events).includes('private-test-secret'));
    assert.equal(client.toolRequests.size, 0);
    autoReply = false;
    await client.start({ ...input, runId: 'r2' });
    assert.equal(events.at(-1).status, 'interrupted');
    assert.equal(client.toolRequests.size, 0);
    assert.equal(client.active, null);
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
});
