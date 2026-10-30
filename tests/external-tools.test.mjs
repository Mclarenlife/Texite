import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { prepareSvg } from '../apps/desktop/external-tools.cjs';
import { ToolSettings } from '../apps/desktop/tool-settings.cjs';

test('SVG conversion cache verifies all outputs, invalidates dependencies and preserves imported files', async () => {
  const root = await fs.mkdtemp(path.resolve('.qa/svg-cache-'));
  const settings = { inkscape: path.join(root, 'inkscape.exe') };
  await fs.writeFile(settings.inkscape, 'test executable');
  await fs.mkdir(path.join(root, 'images'));
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><image href="texture.png"/></svg>';
  await fs.writeFile(path.join(root, 'images/a.svg'), svg);
  await fs.writeFile(path.join(root, 'images/texture.png'), 'texture');
  const project = {
    files: [
      { path: 'main.tex', content: '\\includesvg{images/a}' },
      { path: 'images/a.svg', content: svg },
      { path: 'images/texture.png', content: 'texture' },
    ],
  };
  let calls = 0;
  const run = async (binary, args, cwd) => {
    assert.equal(binary, settings.inkscape);
    assert.equal(cwd, root);
    assert(args.includes('--export-pdf-version=1.4'));
    const target = args
      .find((a) => a.startsWith('--export-filename='))
      .split('=')
      .slice(1)
      .join('=');
    await fs.writeFile(target, '%PDF test output');
    if (args.includes('--export-latex')) await fs.writeFile(target + '_tex', 'overlay');
    calls++;
    return 0;
  };
  const convert = () => prepareSvg(root, project, settings, run, () => {});
  await convert();
  assert.equal(calls, 2);
  await convert();
  assert.equal(calls, 2);
  await fs.writeFile(path.join(root, 'svg-inkscape/a_svg-tex.pdf'), 'corrupt');
  await convert();
  assert.equal(calls, 3);
  await fs.rm(path.join(root, 'svg-inkscape/a_svg-tex.pdf_tex'));
  await convert();
  assert.equal(calls, 4);
  project.files[2].content = 'changed texture';
  await convert();
  assert.equal(calls, 6);
  project.files.push({ path: 'svg-inkscape/a_svg-tex.pdf', content: 'user PDF' });
  await assert.rejects(convert(), /已有项目文件/);
  project.files.pop();
  await fs.writeFile(
    path.join(root, 'images/a.svg'),
    '<svg><image href="https://example.invalid/image.png"/></svg>',
  );
  await assert.rejects(convert(), /外部引用/);
});

test('external tool settings persist locally and reject application folders and unrelated programs', async () => {
  const root = await fs.mkdtemp(path.resolve('.qa/tool-settings-'));
  const settings = new ToolSettings(root);
  const binary = path.join(root, 'inkscape.exe');
  await fs.writeFile(binary, 'test');
  await settings.set('inkscape', binary);
  assert.equal((await new ToolSettings(root).get()).inkscape, binary);
  await assert.rejects(settings.set('latexminted', binary), /请选择/);
  await assert.rejects(settings.set('unknown', ''), /未知/);
  await assert.rejects(settings.set('inkscape', root), /请选择/);
  assert.equal((await settings.set('inkscape', '')).inkscape, '');
});
