import test from 'node:test';
import assert from 'node:assert/strict';
import { lineDiff, limitHistory, changeSummary, type EditRecord } from '../packages/core/history';
const record = (before: string, after: string): EditRecord => ({
  id: 'edit',
  path: 'main.tex',
  before,
  after,
  time: 1,
  startedAt: 1,
});
test('line differences retain original and new coordinates across separated edits', () => {
  const before = 'title\nold\nkeep\ndelete\nend',
    after = 'title\nnew\nextra\nkeep\nend';
  const diff = lineDiff(before, after);
  assert.deepEqual(
    diff.filter((l) => l.kind === 'removed').map((l) => [l.text, l.oldLine]),
    [
      ['old', 2],
      ['delete', 4],
    ],
  );
  assert.deepEqual(
    diff.filter((l) => l.kind === 'added').map((l) => [l.text, l.newLine]),
    [
      ['new', 2],
      ['extra', 3],
    ],
  );
  assert.deepEqual(
    diff.find((l) => l.text === 'keep'),
    { kind: 'same', text: 'keep', oldLine: 3, newLine: 4 },
  );
  assert.equal(
    diff
      .filter((l) => l.kind !== 'added')
      .map((l) => l.text)
      .join('\n'),
    before,
  );
  assert.equal(
    diff
      .filter((l) => l.kind !== 'removed')
      .map((l) => l.text)
      .join('\n'),
    after,
  );
  assert.deepEqual(changeSummary(record(before, after)), { added: 2, removed: 2, from: 2, to: 4 });
});
test('history bounds skip oversized snapshots without removing smaller prior records', () => {
  assert.equal(limitHistory([record('a', 'a')]).length, 0);
  const small = record('a', 'b');
  assert.deepEqual(limitHistory([record('a'.repeat(3_000_000), 'b'), small]), [small]);
  assert.equal(limitHistory(Array.from({ length: 200 }, () => small)).length, 150);
  const huge = lineDiff(
    Array.from({ length: 1500 }, (_, i) => 'a' + i).join('\n'),
    Array.from({ length: 1500 }, (_, i) => 'b' + i).join('\n'),
  );
  assert.equal(huge.filter((l) => l.kind === 'removed').length, 1500);
  assert.equal(huge.filter((l) => l.kind === 'added').length, 1500);
});

test('empty files have no phantom removed or added line', () => {
  assert.deepEqual(changeSummary(record('', 'new')), { added: 1, removed: 0, from: 1, to: 1 });
  assert.deepEqual(lineDiff('', ''), []);
});
