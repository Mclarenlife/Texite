import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../packages/core/sample';
import {
  applyAIChanges,
  mergeAIChanges,
  parseAIChanges,
  undoAITask,
  type AITask,
} from '../packages/core/ai';

test('AI multi-file edits reject stale content atomically; whole task undo retains unrelated edits', () => {
  const original = createProject();
  const before = original.files.find((f) => f.path === 'main.tex')!.content;
  const changes = [
    { path: 'main.tex', before, after: before + '\n% AI' },
    { path: 'parts/new.tex', before: null, after: 'new chapter' },
  ];
  const edited = applyAIChanges(original, changes);
  assert.equal(original.files.find((f) => f.path === 'main.tex')!.content, before);
  assert.equal(edited.revision, original.revision + 1);
  assert.throws(
    () =>
      applyAIChanges(original, [...changes, { path: 'absent.tex', before: 'stale', after: 'new' }]),
    /变化/,
  );
  const task: AITask = {
    id: 't',
    prompt: '',
    reply: '',
    time: 1,
    status: 'completed',
    activities: [],
    changes,
  };
  edited.files.push({ path: 'unrelated.tex', content: 'user work' });
  const undone = undoAITask(edited, task);
  assert.equal(undone.files.find((f) => f.path === 'main.tex')!.content, before);
  assert(!undone.files.some((f) => f.path === 'parts/new.tex'));
  assert(undone.files.some((f) => f.content === 'user work'));
  edited.files.find((f) => f.path === 'main.tex')!.content += '\n% human';
  assert.throws(() => undoAITask(edited, task), /又被编辑/);
  assert.equal(task.changes[0].after, before + '\n% AI');
});

test('AI paths, hidden files, binary writes, duplicate casing and oversized changes are rejected', () => {
  for (const path of ['../escape.tex', '.env', '.git/config.tex', 'image.png'])
    assert.throws(() => parseAIChanges([{ path, before: null, after: 'x' }]));
  assert.throws(() =>
    parseAIChanges([
      { path: 'a.tex', before: null, after: '' },
      { path: 'A.tex', before: null, after: '' },
    ]),
  );
  assert.throws(() =>
    parseAIChanges([{ path: 'a.tex', before: null, after: 'x'.repeat(2_000_001) }]),
  );
  assert.throws(() =>
    applyAIChanges(createProject(), [{ path: 'MAIN.tex', before: null, after: 'overwrite' }]),
  );
});

test('multiple AI writes preserve original versions and refuse interleaved manual edits', () => {
  const first = [{ path: 'a.tex', before: 'original', after: 'AI one' }];
  assert.deepEqual(mergeAIChanges(first, [{ path: 'a.tex', before: 'AI one', after: 'AI two' }]), [
    { path: 'a.tex', before: 'original', after: 'AI two' },
  ]);
  assert.throws(
    () => mergeAIChanges(first, [{ path: 'a.tex', before: 'user work', after: 'AI two' }]),
    /手动编辑/,
  );
});
