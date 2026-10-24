import test from 'node:test';
import assert from 'node:assert/strict';
import { resizeAI } from '../packages/ui/resizeAI';
test('AI window resize anchors the opposite edge and clamps all eight handles inside the viewport', () => {
  const r = { left: 100, top: 100, width: 480, height: 500 };
  assert.deepEqual(resizeAI(r, 'nw', -20, -30, 1200, 900), {
    left: 80,
    top: 70,
    width: 500,
    height: 530,
  });
  assert.deepEqual(resizeAI(r, 'e', 60, 90, 1200, 900), { ...r, width: 540 });
  for (const edge of ['n', 's', 'w', 'e', 'nw', 'ne', 'sw', 'se']) {
    for (const delta of [-10000, 10000]) {
      const v = resizeAI(r, edge, delta, delta, 1200, 900);
      assert(v.left >= 8 && v.top >= 8 && v.left + v.width <= 1192 && v.top + v.height <= 892);
      assert(v.width >= 360 && v.height >= 420);
    }
  }
});
