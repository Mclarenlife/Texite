import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import workspace from '../apps/desktop/workspace.cjs';
const runtime = path.resolve(process.env.TEXITE_TEST_RUNTIME || 'runtime');
test(
  'bundled runtime compiles Chinese, equations, citations offline, reports errors and cancels',
  { timeout: 180000 },
  async (t) => {
    try {
      await fs.access(path.join(runtime, 'texlive.zip'));
    } catch {
      t.skip('Run runtime:prepare to test the distributable compiler.');
      return;
    }
    await fs.mkdir('.qa', { recursive: true });
    const base = await fs.mkdtemp(path.resolve('.qa/offline-test-'));
    const compiler = new workspace.Compiler(base, runtime);
    const project = {
      engine: 'tectonic',
      mainFile: 'main.tex',
      revision: 7,
      files: [
        {
          path: 'main.tex',
          content: String.raw`\documentclass[fontset=fandol]{ctexart}
\usepackage{amsmath,tikz,booktabs,hyperref}
\begin{document}
\section{中文离线编译}
这是无需安装 TeX 的编译测试。\input{chapters/body}
\begin{equation}E=mc^2\end{equation}
\begin{tikzpicture}\draw (0,0) circle (1cm);\end{tikzpicture}
\cite{test}\bibliographystyle{plain}\bibliography{refs}
\newpage 第二页。
\end{document}`,
        },
        { path: 'chapters/body.tex', content: 'A linked chapter.' },
        {
          path: 'refs.bib',
          content: '@book{test, title={Offline}, author={Texite}, year={2026}, publisher={Test}}',
        },
      ],
    };
    // The runtime uses a local ZIP plus --only-cached; no network resource URL is provided.
    const result = await compiler.compile(project);
    assert.equal(result.success, true, result.log);
    assert.equal(result.engine, 'tectonic');
    assert.equal(Buffer.from(result.pdf).subarray(0, 5).toString(), '%PDF-');
    assert(!/download/i.test(result.log), result.log);
    await fs.writeFile(path.join(base, 'chinese.pdf'), Buffer.from(result.pdf));
    const broken = await compiler.compile({
      ...project,
      files: [
        {
          path: 'main.tex',
          content: '\\documentclass{article}\\begin{document}\\badTexiteCommand\\end{document}',
        },
      ],
    });
    assert.equal(broken.success, false);
    assert.match(broken.log, /Undefined control sequence/);
    const pending = compiler.compile({
      ...project,
      files: [
        {
          path: 'main.tex',
          content: '\\documentclass{article}\\begin{document}\\loop\\iftrue\\repeat\\end{document}',
        },
      ],
    });
    const cancel = setInterval(() => {
      if (compiler.active?.child) void compiler.cancel();
    }, 100);
    const cancelled = await pending.finally(() => clearInterval(cancel));
    assert.equal(cancelled.cancelled, true);
    assert(!(await fs.readdir(base)).some((name) => name.startsWith('compile-')));
  },
);
