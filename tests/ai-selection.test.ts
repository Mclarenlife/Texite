import test from 'node:test';
import assert from 'node:assert/strict';
import { selectionLabel } from '../packages/core/ai';
test('selection labels count Unicode characters and display inclusive positions across lines', () => {
  const scope = { projectId: 'p', path: 'main.tex', before: '前😀苹果后\n第二行', from: 3, to: 5 };
  assert.equal(selectionLabel(scope), '第 1 行，第 3–4 字');
  assert.equal(selectionLabel({ ...scope, from: 1, to: 3 }), '第 1 行，第 2–2 字');
  assert.equal(selectionLabel({ ...scope, from: 3, to: 9 }), '第 1 行第 3 字 → 第 2 行第 2 字');
  assert.equal(selectionLabel({ ...scope, from: 3, to: 3 }), '');
});
