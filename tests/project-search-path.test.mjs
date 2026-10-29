import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Compiler } from '../apps/desktop/workspace.cjs';
test(
  'bundled pdfLaTeX resolves class, styles, inputs and bibliography in sibling project directories',
  { timeout: 180000 },
  async (t) => {
    const runtime = path.resolve(process.env.TEXITE_TEST_RUNTIME || 'runtime');
    try {
      await fs.access(path.join(runtime, 'default.texite-runtime.zip'));
    } catch {
      t.skip('Prepare runtime first');
      return;
    }
    await fs.mkdir('.qa', { recursive: true });
    const cache = await fs.mkdtemp(path.resolve('.qa/project-search-'));
    const compiler = new Compiler(cache, runtime);
    const result = await compiler.compile({
      mainFile: 'manuscript/paper.tex',
      engine: 'pdflatex',
      revision: 1,
      files: [
        {
          path: 'manuscript/paper.tex',
          content: String.raw`\documentclass{nested-case}\usepackage{local-macros}\begin{document}\input{body} \localword\cite{demo}\bibliographystyle{plain}\bibliography{refs}\end{document}`,
        },
        {
          path: 'template/classes/nested-case.cls',
          content: String.raw`\ProvidesClass{nested-case}\LoadClass{article}`,
        },
        {
          path: 'template/styles/local-macros.sty',
          content: String.raw`\ProvidesPackage{local-macros}\newcommand{\localword}{Sibling style loaded.}`,
        },
        { path: 'chapters/body.tex', content: 'Sibling chapter loaded.' },
        {
          path: 'bibliography/refs.bib',
          content:
            '@book{demo,title={Nested bibliography},author={Writer, Test},year={2026},publisher={Test}}',
        },
      ],
    });
    await fs.writeFile(path.join(cache, 'test.log'), result.log);
    assert.equal(result.success, true, result.log.slice(-10000));
    assert.match(result.log, /nested-case.cls/);
    assert.match(result.log, /local-macros.sty/);
    assert.match(result.log, /body.tex/);
    assert.match(result.log, /BibTeX/);
    assert(result.pdf.length > 1000);
  },
);
