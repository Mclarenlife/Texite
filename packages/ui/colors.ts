export type HSV = { h: number; s: number; v: number };
export function normalizeHex(value: string) {
  const text = value.trim().replace(/^#/, '');
  return /^[0-9a-f]{6}$/i.test(text)
    ? '#' + text.toUpperCase()
    : /^[0-9a-f]{3}$/i.test(text)
      ? '#' +
        [...text]
          .map((c) => c + c)
          .join('')
          .toUpperCase()
      : null;
}
export function hexToHsv(hex: string): HSV {
  const value = normalizeHex(hex) || '#000000';
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    d = max - min;
  let h = 0;
  if (d) h = (max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60;
  return { h: (h + 360) % 360, s: max ? (d / max) * 100 : 0, v: max * 100 };
}
export function hsvToHex({ h, s, v }: HSV) {
  const c = ((v / 100) * s) / 100,
    x = c * (1 - Math.abs((((h % 360) / 60) % 2) - 1)),
    m = v / 100 - c;
  const rgb =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  return (
    '#' +
    rgb
      .map((n) =>
        Math.round((n + m) * 255)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
      .toUpperCase()
  );
}
export const colorRoles = [
  { id: 'text', label: '正文', sample: '写下你的想法', variable: '--editor-text' },
  { id: 'keyword', label: '命令与关键字', sample: '\\section', variable: '--syntax-keyword' },
  { id: 'string', label: '参数与字符串', sample: '{Introduction}', variable: '--syntax-string' },
  { id: 'comment', label: '注释', sample: '% a little note', variable: '--syntax-comment' },
  { id: 'punctuation', label: '括号与符号', sample: '{ } [ ] &', variable: '--syntax-punctuation' },
] as const;
export type ColorRole = (typeof colorRoles)[number]['id'];
export type EditorColors = Record<ColorRole, string>;

export const palettes = [
  { id: 'mono', name: '石墨', note: '黑与白', light: '#252525', dark: '#E4E4E4', tint: '#E9E9E9' },
  { id: 'violet', name: '鸢尾', note: '柔紫', light: '#7150BD', dark: '#C3A6FA', tint: '#EEE8F8' },
  { id: 'blue', name: '晴空', note: '清蓝', light: '#2861B8', dark: '#9CC5FF', tint: '#E5EEFB' },
  { id: 'green', name: '薄荷', note: '苔绿', light: '#257253', dark: '#9DD9B9', tint: '#E2F1E8' },
  { id: 'rose', name: '玫瑰', note: '雾粉', light: '#B03E6C', dark: '#F1AAC8', tint: '#FAE7EF' },
  { id: 'amber', name: '琥珀', note: '暖金', light: '#93600B', dark: '#EBC67D', tint: '#FAF0D9' },
];
export function resolveEditorColors(
  colors: EditorColors,
  dark: boolean,
  palette: string,
  contrast: string,
): Record<ColorRole, string> {
  const theme = palettes.find((p) => p.id === palette) || palettes[0];
  const base =
    contrast === 'high'
      ? dark
        ? '#FFFFFF'
        : '#000000'
      : contrast === 'soft'
        ? dark
          ? '#C2C2C2'
          : '#505050'
        : dark
          ? '#E4E4E4'
          : '#303030';
  const text = normalizeHex(colors.text) || base;
  return {
    text,
    keyword:
      normalizeHex(colors.keyword) ||
      (contrast === 'high' ? text : dark ? theme.dark : theme.light),
    string: normalizeHex(colors.string) || text,
    comment:
      normalizeHex(colors.comment) ||
      (contrast === 'high'
        ? text
        : contrast === 'soft'
          ? dark
            ? '#AAAAAA'
            : '#707070'
          : dark
            ? '#B4B4B4'
            : '#626262'),
    punctuation: normalizeHex(colors.punctuation) || text,
  };
}
