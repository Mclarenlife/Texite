import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { AIHistoryStore, empty, validateHistory } from '../apps/desktop/ai-history.cjs';

test('AI history survives process replacement, migrates without deleting source and rejects colliding records', async () => {
  await fs.mkdir('.qa', { recursive: true });
  const root = await fs.mkdtemp(path.resolve('.qa/ai-history-'));
  const profile = path.join(root, 'profile');
  const store = new AIHistoryStore(profile);
  await store.init();
  const value = empty();
  value.tasks.push({
    id: 't',
    prompt: '问题',
    reply: '# 回答',
    time: 1,
    status: 'completed',
    changes: [],
    activities: [],
  });
  await store.write('project', value);
  const original = store.root;
  const restarted = new AIHistoryStore(profile);
  await restarted.init();
  assert.deepEqual(await restarted.read('project'), value);
  const chosen = path.join(root, 'chosen');
  await fs.mkdir(chosen);
  const moved = await restarted.relocate(chosen);
  assert.notEqual(moved, original);
  assert.deepEqual(await store.read('project'), value);
  const replaced = new AIHistoryStore(profile);
  await replaced.init();
  assert.equal(replaced.root, moved);
  assert.deepEqual(await replaced.read('project'), value);
  await replaced.clear();
  assert.deepEqual(await replaced.read('project'), empty());
  const originalStore = new AIHistoryStore(path.join(root, 'other'));
  await originalStore.init();
  await originalStore.write('project', value);
  const before = originalStore.root;
  await assert.rejects(originalStore.relocate(chosen), /不同的 AI 记录/);
  assert.equal(originalStore.root, before);
  assert.deepEqual(await replaced.read('project'), empty());
  assert.deepEqual(await originalStore.read('project'), value);
});

test('history schema strips credentials and rejects malformed records rather than silently overwriting', () => {
  assert.deepEqual(
    validateHistory({ ...empty(), apiKey: 'secret', accessToken: 'token' }),
    empty(),
  );
  assert.throws(() => validateHistory({ ...empty(), version: 2 }), /无效/);
  assert.throws(() => validateHistory({ ...empty(), tasks: [{ id: 'x' }] }), /无效/);
});
