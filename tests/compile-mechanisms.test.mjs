import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { convertEps } from '../apps/desktop/eps-converter.cjs';
import { localBcf } from '../apps/desktop/compile-auxiliary.cjs';
import { Compiler } from '../apps/desktop/workspace.cjs';
import { RuntimeManager } from '../apps/desktop/runtime-manager.cjs';

const eps = `%!PS-Adobe-3.0 EPSF-3.0
%%BoundingBox: 10 20 210 120
%%EndComments
0 0 1 setrgbcolor 10 20 200 100 rectfill
/Helvetica findfont 16 scalefont setfont
1 1 1 setrgbcolor 25 60 moveto (EPS Offline Test) show
showpage
%%EOF`;

test('offline EPS converter preserves crop and text, cannot read host files, and cancels a looping program', async () => {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const bytes = await convertEps(Buffer.from(eps));
  const loading = getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: false,
    standardFontDataUrl:
      path.resolve('node_modules/pdfjs-dist/standard_fonts').replaceAll('\\', '/') + '/',
  });
  const doc = await loading.promise;
  const page = await doc.getPage(1);
  assert.deepEqual(page.view, [0, 0, 200, 100]);
  assert.match((await page.getTextContent()).items.map((s) => s.str).join(' '), /EPS Offline Test/);
  await loading.destroy();
  for (const source of [
    eps
      .replace('%%BoundingBox: 10 20 210 120', '%%BoundingBox: (atend)')
      .replace('%%EOF', '%%Trailer\n%%BoundingBox: 10 20 210 120\n%%EOF'),
    eps.replace('%%EndComments', '%%HiResBoundingBox: 10.5 20.5 209.5 119.5\n%%EndComments'),
  ]) {
    const converted = await convertEps(Buffer.from(source));
    const task = getDocument({ data: new Uint8Array(converted) });
    const pdf = await task.promise;
    assert.deepEqual((await pdf.getPage(1)).view, [0, 0, 200, 100]);
    await task.destroy();
  }
  await assert.rejects(
    convertEps(Buffer.from(eps.replace('showpage', '(C:/Windows/win.ini) (r) file pop showpage'))),
    /invalidfileaccess|undefinedfilename/,
  );
  await assert.rejects(
    convertEps(Buffer.from(eps.replace('showpage', '{} loop')), {}, 200),
    /EPS 转换超过/,
  );
  const job = {};
  const pending = convertEps(Buffer.from(eps.replace('showpage', '{} loop')), job);
  const cancelled = assert.rejects(pending, /编译已取消/);
  job.cancelled = true;
  await job.worker.terminate();
  await cancelled;
});

test('Biber resolves nested local data and rejects external resources', async () => {
  await fs.mkdir('.qa', { recursive: true });
  const root = await fs.mkdtemp(path.resolve('.qa/bcf-test-'));
  await fs.mkdir(path.join(root, 'refs'));
  await fs.writeFile(path.join(root, 'refs/library.bib'), '@book{}');
  const bcf = (s) =>
    Buffer.from(`<bcf:datasource type="file" datatype="bibtex">${s}</bcf:datasource>`);
  assert.match(await localBcf(bcf('library.bib'), root, 'main.tex'), /refs\/library.bib/);
  await assert.rejects(
    localBcf(bcf('https://example.com/file.bib'), root, 'main.tex'),
    /仅自动读取项目内/,
  );
  await assert.rejects(localBcf(bcf('../../package.json'), root, 'main.tex'), /找不到项目内/);
});

test(
  'real pdfLaTeX compiles explicit/extensionless nested EPS, default Biber bibliography and MakeIndex offline',
  { timeout: 300000 },
  async (t) => {
    const runtime = path.resolve(process.env.TEXITE_TEST_RUNTIME || 'runtime');
    try {
      await fs.access(path.join(runtime, 'helpers.texite-runtime.zip'));
    } catch {
      t.skip('Prepare runtime first');
      return;
    }
    const base = await fs.mkdtemp(path.resolve('.qa/mechanisms-'));
    const manager = new RuntimeManager(runtime, path.join(base, 'modules'));
    const compiler = new Compiler(base, runtime, manager);
    await manager.init();
    // Upgrade migration runs once; an intentional removal must remain removed.
    assert((await manager.list()).some((module) => module.id === 'tools-bibliography-index'));
    await manager.remove('tools-bibliography-index');
    await manager.init();
    assert(!(await manager.list()).some((module) => module.id === 'tools-bibliography-index'));
    await manager.install(path.join(runtime, 'helpers.texite-runtime.zip'));
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const cases = [
      [
        'eps',
        String.raw`\documentclass{article}\usepackage{graphicx}\graphicspath{{images/}}\begin{document}\includegraphics{fig.eps}\includegraphics{other}\end{document}`,
        [
          { path: 'images/fig.eps', content: eps },
          { path: 'images/other.eps', content: eps },
        ],
        /EPS Offline Test/,
      ],
      [
        'biber',
        String.raw`\documentclass{article}\usepackage[style=numeric]{biblatex}\addbibresource{refs.bib}\begin{document}\cite{test}\printbibliography\end{document}`,
        [
          {
            path: 'bibliography/refs.bib',
            content:
              '@book{test,title={Biber Offline Reference},author={Writer, Alice},year={2025},publisher={Texite}}',
          },
        ],
        /Biber Offline Reference/,
      ],
      [
        'index',
        String.raw`\documentclass{article}\usepackage{makeidx}\makeindex\begin{document}Hello\index{Zebra}\index{Apple}\printindex\end{document}`,
        [],
        /Apple/,
      ],
    ];
    for (const [name, source, extra, expected] of cases)
      await t.test(name, async () => {
        const result = await compiler.compile({
          mainFile: 'main.tex',
          engine: 'pdflatex',
          revision: 1,
          files: [{ path: 'main.tex', content: source }, ...extra],
        });
        await fs.writeFile(path.join(base, name + '.log'), result.log);
        assert.equal(result.success, true, result.log.slice(-10000));
        const loading = getDocument({
          data: Uint8Array.from(result.pdf),
          useSystemFonts: false,
          standardFontDataUrl:
            path.resolve('node_modules/pdfjs-dist/standard_fonts').replaceAll('\\', '/') + '/',
        });
        const doc = await loading.promise;
        let text = '';
        for (let i = 1; i <= doc.numPages; i++)
          text += (await (await doc.getPage(i)).getTextContent()).items.map((s) => s.str).join(' ');
        await loading.destroy();
        assert.match(text, expected);
        if (name === 'eps') assert.doesNotMatch(result.log, /using draft setting/);
        if (name === 'biber') assert.match(result.log, /Biber · 生成参考文献/);
        if (name === 'index') assert.match(result.log, /MakeIndex · 生成索引/);
      });
  },
);
