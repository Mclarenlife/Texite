import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeHex, hexToHsv, hsvToHex, resolveEditorColors } from '../packages/ui/colors';
test('color controls reject invalid input and preserve RGB colors through HSV conversion', () => {
  assert.equal(normalizeHex(' #abc '), '#AABBCC');
  assert.equal(normalizeHex('F4d59D'), '#F4D59D');
  for (const invalid of ['red', '#12', '#1234567', 'url(x)'])
    assert.equal(normalizeHex(invalid), null);
  for (const color of [
    '#FF0000',
    '#00FF00',
    '#0000FF',
    '#FFFFFF',
    '#000000',
    '#808080',
    '#F4D59D',
    '#7150BD',
  ])
    assert.equal(hsvToHex(hexToHsv(color)), color);
});
test('body and syntax overrides are independent from appearance and automatic contrast', () => {
  const colors = {
    text: '#F4D59D',
    keyword: '#AD8DEB',
    string: 'auto',
    comment: 'auto',
    punctuation: '#93D7B0',
  };
  const dark = resolveEditorColors(colors, true, 'blue', 'high');
  assert.equal(dark.text, '#F4D59D');
  assert.equal(dark.keyword, '#AD8DEB');
  assert.equal(dark.punctuation, '#93D7B0');
  assert.equal(dark.comment, '#F4D59D');
  assert.equal(
    resolveEditorColors({ ...colors, keyword: 'auto' }, false, 'blue', 'standard').keyword,
    '#2861B8',
  );
});
