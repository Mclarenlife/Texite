import test from 'node:test';
import assert from 'node:assert/strict';
import { visualBlocks } from '../packages/editor/visual';
import { validateProject } from '../packages/core/model';
import { createProject } from '../packages/core/sample';
test('visual edits use source offsets and preserve unknown commands and whitespace', () => {
  const source =
    '\\documentclass{article}\n\\newcommand{\\custom}{x}\n\\begin{document}\n\\section{Title}\nParagraph without blank separator.\n\n\\begin{equation}E=mc^2\\end{equation}\n\\custom\n\\end{document}\n';
  const blocks = visualBlocks(source);
  const heading = blocks.find((b) => b.kind === 'section')!;
  assert.equal(heading.text, 'Title');
  assert(blocks.some((b) => b.kind === 'paragraph'));
  assert.equal(blocks.find((b) => b.kind === 'math')!.text, 'E=mc^2');
  const updated =
    source.slice(0, heading.from) +
    heading.prefix +
    'Changed' +
    heading.suffix +
    source.slice(heading.to);
  assert.equal(updated, source.replace('{Title}', '{Changed}'));
});
test('folder validation catches path collisions and preserves empty folders', () => {
  const project = createProject();
  assert.deepEqual(validateProject({ ...project, folders: ['assets/empty'] }).folders, [
    'assets',
    'assets/empty',
  ]);
  assert.throws(() => validateProject({ ...project, folders: ['main.tex/child'] }));
  assert.throws(() => validateProject({ ...project, folders: ['../outside'] }));
});
