import test from 'node:test';
import assert from 'node:assert/strict';
import {
  forwardNode,
  inverseNode,
  sourceRange,
  normalizedText,
  findSourceSelection,
  sourceText,
} from '../packages/preview/sync';
test('source lookup selects the right file and page; inverse lookup prefers local text over a containing box', () => {
  const nodes = [
    { file: 'main.tex', line: 8, page: 1, x: 50, y: 40, width: 400, height: 600 },
    { file: 'chapter.tex', line: 8, page: 2, x: 70, y: 100, width: 140, height: 12 },
    { file: 'chapter.tex', line: 9, page: 2, x: 70, y: 120, width: 140, height: 12 },
  ];
  assert.equal(forwardNode(nodes, 'chapter.tex', 8)?.page, 2);
  assert.equal(inverseNode(nodes, 2, 90, 126)?.line, 9);
  assert.equal(inverseNode(nodes, 3, 90, 126), undefined);
  const content = 'Same words\n\\section{Heading}\nSame \\textbf{words}';
  const range = sourceRange(content, 3, 'Same words');
  assert.equal(content.slice(range.from, range.to), 'Same \\textbf{words');
  assert.equal(normalizedText('ﬁ ne\u00ad text'), 'finetext');
  const joined = 'Selected second page words. Included chapter text.';
  assert.deepEqual(sourceRange('Selected second page words.\n\\input{chapter}', 2, joined), {
    from: 0,
    to: 27,
  });
  assert.deepEqual(sourceRange(content, 2, 'rendered math'), { from: 11, to: 28 });
});
test('Chinese source lookup preserves UTF-16 ranges and only falls back to unique visible text', () => {
  const content = '摘要\n占比 30\\%，\\textbf{𠮷野家}。% 不可见';
  const files = [{ path: '章节/摘要.tex', content }];
  const point = { page: 2, x: 120, y: 80, text: '30% ,\u200b𠮷 野 家。' };
  const match = findSourceSelection([], files, point);
  assert.equal(match?.file.path, files[0].path);
  assert.equal(content.slice(match!.range.from, match!.range.to), '30\\%，\\textbf{𠮷野家}。');
  const one = sourceRange(content, 2, '𠮷');
  assert.equal(content.slice(one.from, one.to), '𠮷');
  assert.equal(sourceText('100\\%通过% 注释'), '100%通过');
  assert.equal(
    findSourceSelection([], [...files, { ...files[0], path: '副本.tex' }], point),
    undefined,
  );
});
test('inverse text matching resolves an included file even when its paragraph box belongs to the main file', () => {
  const nodes = [
    { file: 'main.tex', line: 3, page: 1, x: 40, y: 100, width: 400, height: 12 },
    { file: 'chapter.tex', line: 1, page: 1, x: 250, y: 100, width: 2, height: 12 },
  ];
  const found = findSourceSelection(
    nodes,
    [
      { path: 'main.tex', content: 'Header\nFirst words\n\\input{chapter}' },
      { path: 'chapter.tex', content: 'Included chapter text.' },
    ],
    { page: 1, x: 180, y: 104, text: 'Included chapter text.' },
  );
  assert.equal(found?.file.path, 'chapter.tex');
  assert.deepEqual(found?.range, { from: 0, to: 22 });
});
