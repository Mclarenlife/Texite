const readline = require('node:readline');
const path = require('node:path');
const pending = new Map();
let seq = 100,
  sessions = 0,
  cwd;
const send = (m) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');
const call = (method, params) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    send({ id, method, params });
  });
readline.createInterface({ input: process.stdin }).on('line', async (line) => {
  const m = JSON.parse(line);
  if (!m.method) {
    const p = pending.get(m.id);
    pending.delete(m.id);
    if (p) m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
    return;
  }
  try {
    if (m.method === 'initialize')
      return send({
        id: m.id,
        result: { protocolVersion: 1, agentInfo: { name: 'Fixture agent', version: '1' } },
      });
    if (m.method === 'session/new') {
      cwd = m.params.cwd;
      return send({
        id: m.id,
        result: {
          sessionId: 'session-' + ++sessions,
          models: {
            currentModelId: 'test-model',
            availableModels: [{ modelId: 'test-model', name: 'Test model' }],
          },
        },
      });
    }
    if (m.method === 'session/set_model') return send({ id: m.id, result: {} });
    if (m.method === 'session/cancel') return;
    if (m.method === 'session/prompt') {
      const sessionId = m.params.sessionId,
        text = m.params.prompt[0].text;
      if (text.endsWith('wait')) return;
      if (text.endsWith('outside')) {
        await call('fs/read_text_file', { sessionId, path: path.resolve(cwd, '../secret.txt') });
      } else {
        const file = path.join(cwd, 'main.tex');
        const before = await call('fs/read_text_file', { sessionId, path: file });
        await call('fs/write_text_file', {
          sessionId,
          path: file,
          content: before.content.replace('苹果', 'apple'),
        });
      }
      send({
        method: 'session/update',
        params: {
          sessionId,
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: 'Updated ' + sessionId },
          },
        },
      });
      return send({ id: m.id, result: { stopReason: 'end_turn' } });
    }
    send({ id: m.id, error: { code: -32601, message: 'Unsupported' } });
  } catch (e) {
    send({ id: m.id, error: { code: -32603, message: e.message } });
  }
});
