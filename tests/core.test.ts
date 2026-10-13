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
import { diagnosticTarget } from '../packages/preview/CompileDiagnostics';

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

test('diagnostics retain fatal fonts after many warnings and locate nested sources', () => {
  const warnings = Array.from(
    { length: 120 },
    (_, i) => `LaTeX Warning: Reference ${i} undefined on input line ${i + 1}.`,
  ).join('\n');
  const result = parseDiagnostics(
    warnings + '\n!pdfTeX error: pdftex.exe (file ptmb8r): Font ptmb8r at 58 not found',
  );
  assert.equal(result[0].severity, 'error');
  assert.match(result[0].message, /ptmb8r/);
  assert.equal(result[1].line, 1);
  const nested = parseDiagnostics(
    '(./main.tex\n(./chapters/intro.tex\nLaTeX Warning: Citation missing on input line 4.\n)\n! Undefined control sequence.\nl.9 \\oops\n)',
  );
  assert.equal(nested[0].file, 'main.tex');
  assert.equal(nested[0].line, 9);
  assert.equal(nested[1].file, 'chapters/intro.tex');
  assert.equal(nested[1].line, 4);
  const project = createProject();
  assert.equal(
    diagnosticTarget(
      { severity: 'error', message: 'font', file: '/texlive/font.sty', line: 9 },
      project,
    ),
    undefined,
  );
  assert.equal(diagnosticTarget({ severity: 'error', message: 'font' }, project), undefined);
  assert.deepEqual(
    diagnosticTarget(
      { severity: 'error', message: 'error', file: 'C:/cache/main.tex', line: 4 },
      project,
    ),
    { file: 'main.tex', line: 4 },
  );
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
