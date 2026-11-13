import test from 'node:test';
import assert from 'node:assert/strict';
import type { TextContent, TextItem } from 'pdfjs-dist/types/src/display/api';
import { indexedPage, selectableContent } from '../packages/preview/pdf-text';

function run(str: string, x: number, y: number, width: number): TextItem {
  return {
    str,
    transform: [10.5, 0, 0, 10.5, x, y],
    width,
    height: 10.5,
    fontName: 'CJK',
    dir: 'ltr',
    hasEOL: false,
  };
}
function page(...items: TextItem[]): TextContent {
  return { items, styles: {}, lang: 'zh' };
}

test('a bold Chinese sentence stays selectable when adjacent paints share a PDF.js text run', () => {
  // The bundled pdfLaTeX font paints each glyph three times. PDF.js grouped
  // the third paint of the first 轻 with the first paint of the second 轻.
  const original = page(
    run('轻', 154.8, 80, 10.5),
    run('轻', 154.95, 80, 10.5),
    run('轻轻', 155.1, 80, 21),
    run('轻', 165.75, 80, 10.5),
    run('轻', 165.9, 80, 10.5),
    run('。', 176.4, 80, 10.5),
    run('。', 176.55, 80, 10.5),
    { ...run('。', 176.7, 80, 10.5), hasEOL: true },
  );
  const selectable = selectableContent(original).items as TextItem[];
  assert.equal(selectable.map((i) => i.str).join(''), '轻轻。');
  assert.equal(selectable[1].transform[4], 165.6);
  assert.equal(selectable[1].width, 10.5);
  assert.ok(selectable.at(-1)?.hasEOL);
  assert.equal(original.items.length, 8);
  assert.equal((original.items[2] as TextItem).str, '轻轻');
});

test('the source coordinate distinguishes an identical running header and body sentence', () => {
  const content = page(run('研究结果', 40, 740, 42), run('研究结果', 40, 410, 42));
  const indexed = indexedPage(selectableContent(content), (x, y) => [x, 800 - y], {
    x: 43,
    y: 385,
  });
  assert.equal(indexed.text, '研究结果研究结果');
  assert.equal(indexed.expected, '研究结果'.length);
});
