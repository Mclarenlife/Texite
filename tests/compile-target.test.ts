import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../packages/core/sample';
import {
  compileTargets,
  compileWithFallback,
  isCompileDocument,
} from '../packages/core/compile-target';
test('active documents take precedence, while fragments and assets reuse the remembered entry', () => {
  const project = createProject();
  project.files.push({
    path: 'paper/second.tex',
    content: '\\documentclass{article}\n\\begin{document}Second\\end{document}',
  });
  project.activeFile = 'paper/second.tex';
  assert.deepEqual(compileTargets(project), ['paper/second.tex', 'main.tex']);
  project.files.push({ path: 'parts/chapter.tex', content: '% \\documentclass{article}\nChapter' });
  project.activeFile = 'parts/chapter.tex';
  assert.deepEqual(compileTargets(project), ['main.tex']);
  project.activeFile = 'references.bib';
  assert.deepEqual(compileTargets(project), ['main.tex']);
  assert.equal(
    isCompileDocument({ path: 'a.tex', content: '\\% literal\n\\documentclass{article}' }),
    true,
  );
});
test('failed active documents fall back once, retain both logs, and never change engine', async () => {
  const project = createProject();
  project.files.push({ path: 'second.tex', content: '\\documentclass{article}' });
  project.activeFile = 'second.tex';
  const calls: string[] = [];
  const result = await compileWithFallback(project, async (p) => {
    calls.push(p.mainFile);
    assert.equal(p.engine, project.engine);
    return {
      success: p.mainFile === 'main.tex',
      log: p.mainFile === 'second.tex' ? 'Undefined control sequence' : 'PDF ready',
    };
  });
  assert.deepEqual(calls, ['second.tex', 'main.tex']);
  assert.equal(result.mainFile, 'main.tex');
  assert.equal(result.fallbackFrom, 'second.tex');
  assert.match(result.log, /Undefined control sequence/);
  assert.match(result.log, /PDF ready/);
  const cancelled = await compileWithFallback(project, async () => ({
    success: false,
    cancelled: true,
    log: 'cancelled',
  }));
  assert.equal(cancelled.mainFile, 'second.tex');
  assert.equal(cancelled.cancelled, true);
});
