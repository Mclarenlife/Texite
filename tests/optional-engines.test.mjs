import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import workspace from '../apps/desktop/workspace.cjs';
const { RuntimeManager } = createRequire(import.meta.url)('../apps/desktop/runtime-manager.cjs');
const runtime = path.resolve(process.env.TEXITE_TEST_RUNTIME || 'runtime');
test(
  'default pdfTeX only; optional engines import, compile, uninstall and never substitute',
  { timeout: 600000 },
  async (t) => {
    try {
      await fs.access(path.join(runtime, 'default.texite-runtime.zip'));
    } catch {
      t.skip('Prepare runtime first');
      return;
    }
    await fs.mkdir('.qa', { recursive: true });
    const base = await fs.mkdtemp(path.resolve('.qa/optional-engines-'));
    const manager = new RuntimeManager(runtime, path.join(base, 'installed'));
    await manager.init();
    const compiler = new workspace.Compiler(path.join(base, 'compile'), runtime, manager);
    const project = {
      mainFile: 'main.tex',
      revision: 1,
      engine: 'pdflatex',
      files: [
        {
          path: 'main.tex',
          content: String.raw`\documentclass{ctexart}\usepackage{amsmath,booktabs}\begin{document}\section{离线引擎验证}中文内容。Hello. $E=mc^2$\newpage 第二页。\end{document}`,
        },
      ],
    };
    const before = await workspace.detectEngines(runtime, manager);
    assert.deepEqual(before.engines, {
      tectonic: false,
      xelatex: false,
      pdflatex: true,
      lualatex: false,
    });
    const missing = await compiler.compile({ ...project, engine: 'xelatex' });
    assert.equal(missing.success, false);
    assert.match(missing.log, /不会自动切换/);
    assert(!missing.pdf);
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    for (const engine of ['pdflatex', 'xelatex', 'lualatex', 'tectonic']) {
      await t.test(engine, async () => {
        const pack = path.resolve(
          `release/engine-packs/Texite-0.5.0-${engine}-${process.platform}-${process.arch}.texite-runtime.zip`,
        );
        if (engine !== 'pdflatex') await manager.install(pack);
        const result = await compiler.compile({ ...project, engine });
        await fs.writeFile(path.join(base, engine + '.log'), result.log);
        assert.equal(result.success, true, result.log.slice(-5000));
        assert.equal(result.engine, engine);
        const document = getDocument({
          data: Uint8Array.from(result.pdf),
          useSystemFonts: false,
          cMapUrl: path.resolve('node_modules/pdfjs-dist/cmaps').replaceAll('\\', '/') + '/',
          cMapPacked: true,
          standardFontDataUrl:
            path.resolve('node_modules/pdfjs-dist/standard_fonts').replaceAll('\\', '/') + '/',
        });
        const pdf = await document.promise;
        assert.equal(pdf.numPages, 2);
        const metadata = await pdf.getMetadata();
        if (engine === 'pdflatex') assert.match(metadata.info.Producer, /pdfTeX/i);
        const text = (await (await pdf.getPage(1)).getTextContent()).items
          .map((i) => i.str || '')
          .join('');
        assert(text.includes('中文内容'), text);
        await document.destroy();
        if (engine !== 'pdflatex') {
          await manager.remove('engine-' + engine);
          const gone = await compiler.compile({ ...project, engine });
          assert.equal(gone.success, false);
          assert.match(gone.log, /不会自动切换/);
          await manager.install(pack, ['engine-' + engine]);
          assert((await manager.list()).some((m) => m.engine === engine));
        }
      });
    }
    const noop = await compiler.compile({
      ...project,
      engine: 'pdflatex',
      files: [
        {
          path: 'main.tex',
          content: String.raw`\documentclass{article}\usepackage{fontspec}\begin{document}Wrong engine\end{document}`,
        },
      ],
    });
    assert.equal(
      noop.success,
      false,
      'a document requiring XeTeX must not silently compile with XeTeX',
    );
    assert.match(noop.log, /pdfTeX/);
    assert.doesNotMatch(noop.log, /This is XeTeX/);
  },
);
