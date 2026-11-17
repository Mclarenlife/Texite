import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mergeExternalFiles } from '../packages/core/external-files';
import { createProject } from '../packages/core/sample';
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
test('disk changes preserve unrelated edits, replace assets and select a surviving document', async () => {
  const p = {
    ...createProject(),
    mainFile: 'main.tex',
    activeFile: 'main.tex',
    folders: ['old'],
    files: [
      { path: 'main.tex', content: 'previous' },
      { path: 'notes.tex', content: 'draft' },
      { path: 'fig.png', binary: true, content: 'AA==' },
    ],
  };
  const { project, conflicts } = await mergeExternalFiles(p, {
    token: '1',
    added: ['figures'],
    removed: ['old'],
    changes: [
      { path: 'main.tex', before: sha('previous'), file: null },
      { path: 'chapter.tex', before: null, file: { path: 'chapter.tex', content: 'previous' } },
      {
        path: 'fig.png',
        before: sha('\0'),
        file: { path: 'fig.png', binary: true, content: '/w==' },
      },
    ],
  });
  assert.deepEqual(conflicts, []);
  assert.equal(project.mainFile, 'notes.tex');
  assert.equal(project.activeFile, 'notes.tex');
  assert.deepEqual(project.folders, ['figures']);
  assert.equal(project.files.find((f) => f.path === 'notes.tex')?.content, 'draft');
  assert.equal(project.files.find((f) => f.path === 'fig.png')?.content, '/w==');
});
test('overlapping edits and externally deleted dirty files require backup, identical edits do not', async () => {
  const p = {
    ...createProject(),
    files: [
      { path: 'main.tex', content: 'application draft' },
      { path: 'note.bib', content: 'edited bib' },
      { path: 'same.tex', content: 'both' },
    ],
  };
  const result = await mergeExternalFiles(p, {
    token: 'x',
    added: [],
    removed: [],
    changes: [
      { path: 'main.tex', before: sha('old'), file: { path: 'main.tex', content: 'external' } },
      { path: 'note.bib', before: sha('other'), file: null },
      { path: 'same.tex', before: sha('old'), file: { path: 'same.tex', content: 'both' } },
    ],
  });
  assert.deepEqual(result.conflicts, ['main.tex', 'note.bib']);
  assert.equal(result.project.files[0].content, 'external');
  assert.equal(p.files[0].content, 'application draft');
});
