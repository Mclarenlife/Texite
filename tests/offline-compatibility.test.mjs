import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import workspace from '../apps/desktop/workspace.cjs';
import { createRequire } from 'node:module';
const { RuntimeManager } = createRequire(import.meta.url)('../apps/desktop/runtime-manager.cjs');

const runtime = path.resolve(process.env.TEXITE_TEST_RUNTIME || 'runtime');
const fixtures = new URL('./fixtures/offline/', import.meta.url);

test(
  'offline compatibility: real pdfTeX and imported XeTeX across common document fixtures',
  { timeout: 600000 },
  async (t) => {
    try {
      await fs.access(path.join(runtime, 'default.texite-runtime.zip'));
    } catch {
      t.skip('Run runtime:prepare to test the distributable compiler.');
      return;
    }
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    await fs.mkdir('.qa', { recursive: true });
    const base = await fs.mkdtemp(path.resolve('.qa/compatibility-'));
    const manager = new RuntimeManager(runtime, path.join(base, 'modules'));
    await manager.init();
    const suffix = process.platform + '-' + process.arch;
    await manager.install(
      path.resolve(`release/engine-packs/Texite-0.5.0-xelatex-${suffix}.texite-runtime.zip`),
    );
    for (const name of (await fs.readdir(fixtures)).filter((name) => name.endsWith('.tex'))) {
      let failedCompilation = false;
      await t.test(name, async () => {
        const cache = path.join(base, name.replace('.tex', ''));
        const compiler = new workspace.Compiler(cache, runtime, manager);
        // No format/font cache from another case or an existing installation.
        const result = await compiler.compile({
          engine: ['chinese.tex', 'fonts.tex'].includes(name) ? 'xelatex' : 'pdflatex',
          mainFile: 'main.tex',
          revision: 1,
          files: [
            { path: 'main.tex', content: await fs.readFile(new URL(name, fixtures), 'utf8') },
            {
              path: 'refs.bib',
              content:
                '@book{english, title={Offline Reference}, author={Writer, Alice}, year={2026}, publisher={Texite}}\n@book{chinese, title={中文文献}, author={张三}, year={2026}, publisher={测试出版社}}',
            },
            {
              path: 'pixel.png',
              binary: true,
              content:
                'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAFElEQVR4nGOU6znBgA0wYRUdtBIAJJkBguUtVNMAAAAASUVORK5CYII=',
            },
          ],
        });
        await fs.mkdir(cache, { recursive: true });
        await fs.writeFile(path.join(cache, 'compile.log'), result.log);
        if (!result.success) {
          failedCompilation = true;
          t.diagnostic(`${name}: ${result.log.slice(-12000)}`);
        }
        assert.equal(result.success, true, result.log.slice(-12000));
        assert.match(result.log, /实际编译器/);
        if (name === 'base35.tex') {
          // Verify actual outlines are embedded, not substituted by the PDF reader.
          for (const font of [
            'utmb8a',
            'utmbi8a',
            'utmr8a',
            'utmri8a',
            'uhvr8a',
            'ucrr8a',
            'uplr8a',
            'uncr8a',
            'ubkl8a',
            'uagk8a',
            'uzcmi8a',
            'usyr',
            'uzdr',
          ])
            assert(result.log.includes(font + '.pfb'), `Missing embedded outline: ${font}`);
          assert.match(result.log, /8r\.enc/);
          assert.doesNotMatch(result.log, /Font .* not found|mktexpk|Missing character:/);
        }
        assert.match(
          result.log,
          ['chinese.tex', 'fonts.tex'].includes(name) ? /This is XeTeX/ : /This is pdfTeX/,
        );
        // Upstream Beamer Madrid's title shadow emits a nullfont "5" warning
        // with the full 2022 bundle too. Reject all other missing characters.
        const missing = (result.log.match(/.*(?:download|Missing character:).*$/gim) || []).filter(
          (line) =>
            !(
              name === 'slides.tex' &&
              /Missing character: There is no 5 \("35\) in font nullfont!/.test(line)
            ),
        );
        assert.deepEqual(missing, []);
        const bytes = Uint8Array.from(result.pdf);
        await fs.writeFile(path.join(cache, 'output.pdf'), bytes);
        const loading = getDocument({
          data: bytes,
          useSystemFonts: false,
          cMapUrl: path.resolve('node_modules/pdfjs-dist/cmaps').replaceAll('\\', '/') + '/',
          cMapPacked: true,
          standardFontDataUrl:
            path.resolve('node_modules/pdfjs-dist/standard_fonts').replaceAll('\\', '/') + '/',
        });
        const pdf = await loading.promise;
        try {
          assert(pdf.numPages >= 1);
          let text = '';
          for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
            const page = await pdf.getPage(pageNumber);
            text += (await page.getTextContent()).items.map((item) => item.str || '').join('');
          }
          assert(text.length > 10, text);
          if (name === 'chinese.tex') {
            assert.equal(pdf.numPages, 2);
            for (const expected of [
              '宋体中文',
              '粗体中文',
              '黑体中文',
              '楷体中文',
              '仿宋中文',
              '第二页中文',
            ])
              assert(text.includes(expected), text);
            assert.match(result.log, /ctex-fontset-fandol/);
          }
          if (name === 'slides.tex') {
            assert.equal(pdf.numPages, 2);
            assert(text.includes('中文演示文稿') && text.includes('中文内容'), text);
          }
          if (name === 'bibliography.tex' || name === 'biblatex.tex') {
            assert.match(result.log, /BibTeX/);
            assert.match(text, /Offline reference/i);
            if (name === 'bibliography.tex') assert(text.includes('中文文献'), text);
          }
        } finally {
          await loading.destroy();
        }
      });
      if (failedCompilation) break;
    }
  },
);
