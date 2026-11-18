import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createTranslationService, defaults, defaultPrompt } from '../apps/desktop/translation.mjs';
import translationStore from '../apps/desktop/translation-store.cjs';

test('legacy translation settings get the default prompt; customized instructions persist and reach AI', async () => {
  let saved = {
    provider: 'ai',
    target: 'en',
    url: 'https://example.test/v1',
    model: 'test',
    apiKey: 'secret',
  };
  const storage = {
    read: () => saved,
    write: (value) => {
      saved = value;
    },
    persistent: () => true,
  };
  const requests = [];
  const fetcher = async (_, init) => {
    requests.push(JSON.parse(init.body));
    return Response.json({ choices: [{ message: { content: 'translation and terminology' } }] });
  };
  const api = createTranslationService(storage, fetcher);
  assert.equal((await api.get()).prompt, defaultPrompt);
  await api.translate('default', '原文');
  assert.match(requests[0].messages[0].content, /只输出翻译内容/);
  const prompt = '先给出译文，再解释专业词汇和难点词汇。';
  await api.save({ ...saved, apiKey: '', prompt });
  const reopened = createTranslationService(storage, fetcher);
  assert.equal((await reopened.get()).prompt, prompt);
  await reopened.translate('custom', '热传导');
  const instruction = requests[1].messages[0].content;
  assert.match(instruction, /英语/);
  assert.ok(instruction.includes(prompt));
  assert.ok(!instruction.includes(defaultPrompt));
  assert.deepEqual(requests[1].messages[1], { role: 'user', content: '热传导' });
  assert.equal(saved.apiKey, 'secret');
  await reopened.save({ ...saved, prompt: ' ' });
  assert.equal((await reopened.get()).prompt, defaultPrompt);
  await assert.rejects(reopened.save({ ...saved, prompt: 42 }), /配置无效/);
});

test('translation sends only the selection, uses provider-specific credentials and drops a key when changing servers', async () => {
  const requests = [];
  const api = createTranslationService(
    { read: () => null, write: () => {}, persistent: () => false },
    async (url, options) => {
      requests.push({ url, headers: options.headers, body: JSON.parse(options.body) });
      return Response.json({
        translations: [{ text: '深度' }],
        translatedText: '自由',
        choices: [{ message: { content: '模型译文' } }],
      });
    },
  );
  await api.save({
    ...defaults,
    provider: 'deepl',
    url: 'https://api-free.deepl.com',
    apiKey: 'deepl-key',
  });
  assert.equal(await api.translate('1', 'paper'), '深度');
  assert.deepEqual(requests[0].body, { text: ['paper'], target_lang: 'ZH-HANS' });
  assert.equal(requests[0].headers.Authorization, 'DeepL-Auth-Key deepl-key');
  const libre = { ...defaults, url: 'http://localhost:5000', apiKey: 'libre-key' };
  await api.save(libre);
  assert.equal(await api.translate('2', 'paper'), '自由');
  assert.deepEqual(requests[1].body, {
    q: 'paper',
    source: 'auto',
    target: 'zh',
    format: 'text',
    api_key: 'libre-key',
  });
  await api.save({ ...libre, url: 'https://other.example', apiKey: '' });
  assert.equal((await api.get()).hasKey, false);
  await api.save({
    ...defaults,
    provider: 'ai',
    url: 'http://localhost:8000/v1',
    model: 'local-model',
    apiKey: 'a',
  });
  assert.equal(await api.translate('3', 'paper'), '模型译文');
  assert.equal(requests[2].url, 'http://localhost:8000/v1/chat/completions');
  assert.equal(requests[2].body.messages.length, 2);
  assert.deepEqual(requests[2].body.messages[1], { role: 'user', content: 'paper' });
  assert.equal(requests[2].body.model, 'local-model');
  await assert.rejects(api.translate('4', 'x'.repeat(16001)), /16000/);
  assert.equal(requests.length, 3);
});
test('closing a translation aborts its request and encrypted desktop settings survive restart', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'texite-translation-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = translationStore(dir, {
    isEncryptionAvailable: () => true,
    encryptString: () => Buffer.from('sealed'),
    decryptString: () => 'private-key',
  });
  let ready;
  const started = new Promise((resolve) => (ready = resolve));
  const api = createTranslationService(
    store,
    (_, options) =>
      new Promise((_, reject) => {
        ready();
        options.signal.addEventListener('abort', () => reject(new Error('aborted')));
      }),
  );
  await api.save({ ...defaults, url: 'https://example.com', apiKey: 'private-key' });
  const restored = await createTranslationService(store).get();
  assert.equal(restored.hasKey, true);
  assert.ok(!('apiKey' in restored));
  assert.ok(!(await readFile(path.join(dir, 'translation.json'), 'utf8')).includes('private-key'));
  const pending = api.translate('reader', 'article');
  await started;
  api.cancel('reader');
  await assert.rejects(pending, /取消/);
});
