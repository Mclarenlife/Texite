import type { SyncNode, ProjectFile } from '../core/model';
export function normalizedText(text: string) {
  return text
    .normalize('NFKC')
    .replace(/[\s\u00ad\u200b-\u200f\u2060\ufe00-\ufe0f{}]/g, '')
    .toLowerCase();
}
const sourceTokens =
  /\\([%&#_$])|\\(?:begin|end|label|cite|ref)\*?\{[^}]*\}|\\[a-zA-Z]+\*?|%[^\n]*/g;
export function sourceText(text: string) {
  return text.replace(sourceTokens, (_, literal) => literal || '');
}
export function forwardNode(nodes: SyncNode[], file: string, line: number) {
  return nodes
    .filter((n) => n.file === file)
    .sort((a, b) => Math.abs(a.line - line) - Math.abs(b.line - line) || a.height - b.height)[0];
}
export function inverseNode(nodes: SyncNode[], page: number, x: number, y: number) {
  const distance = (n: SyncNode) =>
    Math.hypot(Math.max(n.x - x, 0, x - n.x - n.width), Math.max(n.y - y, 0, y - n.y - n.height));
  return nodes
    .filter((n) => n.page === page)
    .sort((a, b) => distance(a) - distance(b) || a.width * a.height - b.width * b.height)[0];
}
export function sourceRange(content: string, line: number, text: string) {
  const start = content
    .split('\n')
    .slice(0, line - 1)
    .reduce((n, s) => n + s.length + 1, 0);
  const positions: number[] = [],
    chars: string[] = [];
  const hidden = new Uint8Array(content.length);
  for (const m of content.matchAll(sourceTokens))
    hidden.fill(1, m.index!, m.index! + m[0].length - (m[1] ? 1 : 0));
  for (let i = 0; i < content.length;) {
    const char = String.fromCodePoint(content.codePointAt(i)!);
    if (!hidden[i]) {
      const normalized = normalizedText(char);
      chars.push(normalized);
      for (let n = 0; n < normalized.length; n++) positions.push(i);
    }
    i += char.length;
  }
  let needle = normalizedText(text);
  const haystack = chars.join('');
  // One PDF text run can join adjacent input files or generated material.
  // Keep the source-visible prefix rather than highlighting an unrelated TeX command.
  if (needle.length >= 8 && !haystack.includes(needle)) {
    let lo = 8,
      hi = needle.length,
      best = 0;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (haystack.includes(needle.slice(0, mid))) {
        best = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    if (best) needle = needle.slice(0, best);
  }
  let best = -1,
    distance = Infinity;
  if (needle)
    for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, at + 1)) {
      const d = Math.abs(positions[at] - start);
      if (d < distance) {
        best = at;
        distance = d;
      }
    }
  if (best >= 0) {
    const end = positions[best + needle.length - 1];
    return { from: positions[best], to: end + (content.codePointAt(end)! > 0xffff ? 2 : 1) };
  }
  return {
    from: start,
    to: Math.min(content.length, start + (content.split('\n')[line - 1]?.length || 0)),
  };
}
export type PdfLocate = { id: number; node?: SyncNode; text: string };

export function findSourceSelection(
  nodes: SyncNode[],
  files: ProjectFile[],
  point: { page: number; x: number; y: number; text: string },
) {
  const closest = inverseNode(nodes, point.page, point.x, point.y);
  const candidates = [
    ...(closest ? [closest.file] : []),
    ...new Set(nodes.filter((n) => n.page === point.page).map((n) => n.file)),
  ];
  let fallback: { file: ProjectFile; range: { from: number; to: number } } | undefined;
  for (const path of new Set(candidates)) {
    const file = files.find((f) => f.path === path && !f.binary);
    if (!file) continue;
    const node = inverseNode(
      nodes.filter((n) => n.file === path),
      point.page,
      point.x,
      point.y,
    )!;
    const range = sourceRange(file.content, node.line, point.text);
    fallback ??= { file, range };
    if (
      normalizedText(sourceText(file.content.slice(range.from, range.to))) ===
      normalizedText(point.text)
    )
      return { file, range };
  }
  // Macro expansion can leave an included Chinese paragraph with no tagged
  // nodes on this page. Accept unanchored text only if it identifies one place.
  const needle = normalizedText(point.text);
  let unique: typeof fallback;
  if (needle)
    for (const file of files) {
      if (file.binary || candidates.includes(file.path) || !/\.(?:tex|ltx)$/i.test(file.path))
        continue;
      const visible = normalizedText(sourceText(file.content));
      const first = visible.indexOf(needle);
      if (first < 0) continue;
      if (unique || visible.indexOf(needle, first + 1) >= 0) return fallback;
      const range = sourceRange(file.content, 1, point.text);
      if (normalizedText(sourceText(file.content.slice(range.from, range.to))) === needle)
        unique = { file, range };
    }
  return unique ?? fallback;
}
