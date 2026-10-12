import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import workspace from '../apps/desktop/workspace.cjs';

test('real latexmk: produce PDF, diagnose invalid source, and clean compile snapshots', async (t) => {
  const available = await workspace.detectEngines();
  if (!available.latexmk || !available.engines.pdflatex) {
    t.skip('Requires latexmk and pdfLaTeX; CI installs these.');
    return;
  }
  const cache = await fs.mkdtemp(path.join(os.tmpdir(), 'texite-compile-test-'));
  try {
    const compiler = new workspace.Compiler(cache);
    const project = {
      name: 'Smoke',
      id: 'test',
      mainFile: 'main.tex',
      engine: 'pdflatex',
      revision: 7,
      files: [
        {
          path: 'main.tex',
          content: '\\documentclass{article}\n\\begin{document}\nHello, Texite!\n\\end{document}',
        },
      ],
    };
    const result = await compiler.compile(project);
    assert.equal(result.success, true, result.log);
    assert.equal(result.revision, 7);
    assert.equal(Buffer.from(result.pdf).subarray(0, 5).toString(), '%PDF-');
    const bad = await compiler.compile({
      ...project,
      files: [
        {
          path: 'main.tex',
          content:
            '\\documentclass{article}\n\\begin{document}\n\\thisCommandDoesNotExist\n\\end{document}',
        },
      ],
    });
    assert.equal(bad.success, false);
    assert.match(bad.log, /Undefined control sequence/);
    assert.deepEqual(await fs.readdir(cache), []);
  } finally {
    assert(path.basename(cache).startsWith('texite-compile-test-'));
    await fs.rm(cache, { recursive: true, force: true });
  }
});
