import test from 'node:test';
import assert from 'node:assert/strict';
import {
  safePath,
  validateProject,
  parseDiagnostics,
  getOutline,
  getReferences,
} from '../packages/core/model';
import { createProject } from '../packages/core/sample';

test('rejects traversal, Windows device paths, reserved directories and ambiguous file names', () => {
  for (const name of [
    '../outside.tex',
    '/outside.tex',
    'C:\\file.tex',
    'a/../../x.tex',
    'a//b.tex',
    'NUL.tex',
    'bad.',
    '.git/config',
    'a/./b.tex',
    'file\0.tex',
  ])
    assert.throws(() => safePath(name));
  assert.equal(safePath('chapters\\引言.tex'), 'chapters/引言.tex');
});
test('validates a project and recovers a missing main selection without losing assets', () => {
  const project = createProject();
  project.mainFile = 'missing.tex';
  project.files.push({ path: 'figures/x.png', content: 'aGVsbG8=', binary: true });
  const result = validateProject(project);
  assert.equal(result.mainFile, 'main.tex');
  assert.equal(result.files.length, 3);
  assert.throws(() =>
    validateProject({ ...project, files: [...project.files, { path: 'MAIN.tex', content: '' }] }),
  );
  assert.throws(() =>
    validateProject({ ...project, files: [{ path: 'readme.txt', content: 'hi' }] }),
  );
});
test('indexes sections, citations and located compiler errors', () => {
  const project = createProject();
  assert.equal(getOutline(project.files[0].content).length, 3);
  assert.equal(getReferences(project.files)[0].key, 'vaswani2017');
  const diagnostics = parseDiagnostics(
    'chapters/intro.tex:12: Undefined control sequence.\nLaTeX Warning: Reference missing.',
  );
  assert.equal(diagnostics[0].file, 'chapters/intro.tex');
  assert.equal(diagnostics[0].line, 12);
  assert.equal(diagnostics[1].severity, 'warning');
});
