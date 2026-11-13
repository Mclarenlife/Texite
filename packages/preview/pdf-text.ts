import type { TextContent, TextItem } from 'pdfjs-dist/types/src/display/api';
import { normalizedText } from './sync';

// CJK's simulated bold can paint the same glyph several times a fraction of a
// point apart. Keep the canvas intact, but expose one selectable glyph.
export function selectableContent(content: TextContent): TextContent {
  const items: TextContent['items'] = [];
  let previous: { glyph: string; x: number; advance: number; item: TextItem } | undefined;
  for (const item of content.items) {
    if (
      !('str' in item) ||
      item.dir !== 'ltr' ||
      item.transform[1] ||
      item.transform[2] ||
      !/^[\p{Script=Han}\u3000-\u303f\uff01-\uff60]+$/u.test(item.str)
    ) {
      items.push(item);
      previous = undefined;
      continue;
    }
    const chars = Array.from(item.str);
    const advance = item.width / chars.length;
    const x = item.transform[4];
    const overlap =
      previous &&
      previous.glyph === chars[0] &&
      previous.item.fontName === item.fontName &&
      previous.item.transform.slice(0, 4).every((v, i) => v === item.transform[i]) &&
      Math.abs(previous.advance - advance) < 0.02 &&
      Math.hypot(previous.x - x, previous.item.transform[5] - item.transform[5]) <
        Math.min(1, advance * 0.15);
    if (!overlap) items.push(item);
    else if (chars.length > 1) {
      // PDF.js may join the last paint of one glyph to the first paint of
      // the next. Trim just the overlapping glyph, retaining the rest.
      const transform = [...item.transform];
      transform[4] += advance;
      items.push({ ...item, str: chars.slice(1).join(''), transform, width: item.width - advance });
    } else if (item.hasEOL) {
      const last = items.at(-1);
      if (last && 'str' in last) items[items.length - 1] = { ...last, hasEOL: true };
    }
    if (item.hasEOL) previous = undefined;
    else if (!overlap || chars.length > 1)
      previous = { glyph: chars[chars.length - 1], x: x + item.width - advance, advance, item };
  }
  return { ...content, items };
}

export function indexedPage(
  content: TextContent,
  baseline: (x: number, y: number) => number[],
  anchor?: { x: number; y: number },
) {
  let text = '',
    expected = 0,
    nearest = Infinity;
  for (const item of content.items) {
    if (!('str' in item)) continue;
    const normalized = normalizedText(item.str);
    if (!normalized) continue;
    if (anchor) {
      const [x, y] = baseline(item.transform[4], item.transform[5]);
      const distance = Math.hypot(
        Math.max(x - anchor.x, 0, anchor.x - x - item.width),
        Math.max(y - item.height - anchor.y, 0, anchor.y - y),
      );
      if (distance < nearest) {
        nearest = distance;
        expected = text.length;
      }
    }
    text += normalized;
  }
  return { text, expected };
}
