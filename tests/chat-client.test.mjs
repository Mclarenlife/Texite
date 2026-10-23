import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { streamChat, chatEndpoint } from '../apps/desktop/chat-transport.mjs';
import client from '../apps/desktop/chat-client.cjs';
await fs.mkdir('.qa', { recursive: true });
test('compatible chat accepts streamed Unicode, JSON and refuses error/truncated streams', async () => {
  assert.equal(
    chatEndpoint('https://example.test/v1/'),
    'https://example.test/v1/chat/completions',
  );
  for (const url of [
    'http://example.test/v1',
    'file:///tmp',
    'https://user:secret@example.test',
    'https://example.test/?api_key=secret',
  ])
    assert.throws(() => chatEndpoint(url));
  const content =
    'data: ' +
    JSON.stringify({ choices: [{ delta: { content: '你好，公式' } }] }) +
    '\r\n\r\ndata: [DONE]\r\n\r\n';
  const data = new TextEncoder().encode(content);
  let text = '';
  let request;
  await streamChat(
    { baseURL: 'https://example.test/v1', model: 'test', apiKey: 'secret' },
    [{ role: 'user', content: 'Hello' }],
    (delta) => (text += delta),
    new AbortController().signal,
    async (url, init) => {
      request = init;
      return new Response(
        new ReadableStream({
          start(c) {
            for (const b of data) c.enqueue(new Uint8Array([b]));
            c.close();
          },
        }),
        { headers: { 'Content-Type': 'text/event-stream' } },
      );
    },
  );
  assert.equal(text, '你好，公式');
  assert.equal(JSON.parse(request.body).tools, undefined);
  await assert.rejects(
    streamChat(
      { baseURL: 'https://example.test', model: 'test' },
      [],
      () => {},
      new AbortController().signal,
      async () => new Response('private secret', { status: 401 }),
    ),
    /HTTP 401/,
  );
  await assert.rejects(
    streamChat(
      { baseURL: 'https://example.test', model: 'test' },
      [],
      () => {},
      new AbortController().signal,
      async () => new Response('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'),
    ),
    /中断/,
  );
});
test('desktop API config encrypts keys, never exposes secrets, and resets keys on endpoint changes', async () => {
  const directory = await fs.mkdtemp(path.resolve('.qa/chat-client-'));
  const secure = {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from('encrypted:' + s),
    decryptString: (b) => b.toString().replace('encrypted:', ''),
  };
  const chat = new client.ChatClient(directory, secure, () => {});
  const result = await chat.save({
    baseURL: 'https://example.test/v1',
    model: 'test',
    apiKey: 'test-secret',
  });
  assert.equal(result.hasKey, true);
  assert.equal(result.apiKey, undefined);
  assert(!(await fs.readFile(path.join(directory, 'chat.json'), 'utf8')).includes('test-secret'));
  const reopened = new client.ChatClient(directory, secure, () => {});
  assert.equal((await reopened.get()).hasKey, true);
  await reopened.save({ baseURL: 'https://other.test/v1', model: 'test', apiKey: '' });
  assert.equal((await reopened.get()).hasKey, false);
});
test('desktop API sends only chat messages, streams results and can be cancelled', async () => {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push(JSON.parse(body));
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n');
    if (requests.length === 1) res.end('data: [DONE]\n\n');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const directory = await fs.mkdtemp(path.resolve('.qa/chat-http-'));
  const events = [];
  const chat = new client.ChatClient(directory, { isEncryptionAvailable: () => false }, (e) =>
    events.push(e),
  );
  try {
    await chat.save({
      baseURL: `http://127.0.0.1:${server.address().port}/v1`,
      model: 'test',
      apiKey: '',
    });
    await chat.start({
      runId: 'one',
      projectId: 'project',
      messages: [{ role: 'user', content: 'Hi' }],
    });
    assert.equal(events.at(-1).status, 'completed');
    assert.equal(requests[0].tools, undefined);
    const pending = chat.start({
      runId: 'two',
      projectId: 'project',
      messages: [{ role: 'user', content: 'Wait' }],
    });
    while (!events.some((e) => e.runId === 'two')) await new Promise((r) => setTimeout(r, 10));
    chat.cancel();
    await pending;
    assert.equal(events.at(-1).status, 'interrupted');
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
});

test('multiple API profiles keep secrets isolated through switching, endpoint changes and reopen', async () => {
  const directory = await fs.mkdtemp(path.resolve('.qa/chat-profiles-'));
  const secure = {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from(s.split('').reverse().join('')),
    decryptString: (b) => b.toString().split('').reverse().join(''),
  };
  const chat = new client.ChatClient(directory, secure, () => {});
  const a = await chat.save({
    id: '',
    name: 'A',
    baseURL: 'https://a.test/v1',
    model: 'a',
    apiKey: 'secret-a',
  });
  const b = await chat.save({
    id: '',
    name: 'B',
    baseURL: 'https://b.test/v1',
    model: 'b',
    apiKey: 'secret-b',
  });
  assert.notEqual(a.id, b.id);
  assert.equal((await chat.list()).length, 2);
  await chat.select(a.id);
  assert.equal((await chat.load()).apiKey, 'secret-a');
  const reopened = new client.ChatClient(directory, secure, () => {});
  assert.equal((await reopened.get()).id, a.id);
  await reopened.select(b.id);
  assert.equal((await reopened.load()).apiKey, 'secret-b');
  await reopened.save({ ...b, apiKey: '', baseURL: 'https://changed.test/v1' });
  assert.equal((await reopened.get()).hasKey, false);
  await reopened.select(a.id);
  assert.equal((await reopened.load()).apiKey, 'secret-a');
  assert(!JSON.stringify(await reopened.list()).includes('secret-a'));
  assert(!(await fs.readFile(path.join(directory, 'chat.json'), 'utf8')).includes('secret-'));
});
