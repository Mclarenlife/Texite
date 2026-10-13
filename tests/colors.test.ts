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
  assert.equal(dark.comment, '#9DD9B9');
  assert.equal(
    resolveEditorColors({ ...colors, keyword: 'auto' }, false, 'blue', 'standard').keyword,
    '#2861B8',
  );
});

test('fresh light and dark editors use distinct readable syntax colors', () => {
  const auto = {
    text: 'auto',
    keyword: 'auto',
    string: 'auto',
    comment: 'auto',
    punctuation: 'auto',
  };
  for (const dark of [false, true]) {
    const colors = resolveEditorColors(auto, dark, 'mono', 'standard');
    assert.equal(new Set(Object.values(colors)).size, 5);
    const luminance = (hex: string) => {
      const rgb = [1, 3, 5]
        .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
    };
    const bg = luminance(dark ? '#1E1E1E' : '#FAFAFA');
    for (const color of Object.values(colors)) {
      const fg = luminance(color);
      assert((Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05) >= 4.5, color);
    }
  }
});
