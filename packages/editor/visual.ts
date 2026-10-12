export type VisualBlock = {
  from: number;
  to: number;
  kind: 'section' | 'subsection' | 'paragraph' | 'math' | 'source';
  text: string;
  prefix: string;
  suffix: string;
};
// Offsets refer to the original document. Unsupported syntax is never round-tripped through HTML.
export function visualBlocks(source: string): VisualBlock[] {
  const blocks: VisualBlock[] = [];
  const begin = source.indexOf('\\begin{document}');
  const end = source.lastIndexOf('\\end{document}');
  const start = begin < 0 ? 0 : begin + '\\begin{document}'.length;
  const finish = end < start ? source.length : end;
  const add = (
    from: number,
    to: number,
    kind: VisualBlock['kind'],
    text = source.slice(from, to),
    prefix = '',
    suffix = '',
  ) => blocks.push({ from, to, kind, text, prefix, suffix });
  if (start) add(0, start, 'source');
  let cursor = start;
  while (cursor < finish) {
    if (/\s/.test(source[cursor])) {
      cursor++;
      continue;
    }
    const rest = source.slice(cursor, finish);
    const heading = rest.match(/^(\\(section|subsection)\*?\{)([^{}\n]*)(\})/);
    const math =
      rest.match(/^(\\\[)([\s\S]*?)(\\\])/) ||
      rest.match(/^(\$\$)([\s\S]*?)(\$\$)/) ||
      rest.match(
        /^(\\begin\{(?:equation|align|gather)\*?\})([\s\S]*?)(\\end\{(?:equation|align|gather)\*?\})/,
      );
    if (heading) {
      add(
        cursor,
        cursor + heading[0].length,
        heading[2] as 'section',
        heading[3],
        heading[1],
        heading[4],
      );
      cursor += heading[0].length;
    } else if (math) {
      add(cursor, cursor + math[0].length, 'math', math[2], math[1], math[3]);
      cursor += math[0].length;
    } else {
      const raw = /^(%|\\(?!textbf|textit|emph))/.test(rest);
      const text = raw
        ? rest.match(/^[^\n]+/)![0]
        : rest.match(/^[^\n]+(?:\n(?![ \t]*\n|[ \t]*\\)[^\n]+)*/)![0];
      add(cursor, cursor + text.length, raw ? 'source' : 'paragraph');
      cursor += text.length;
    }
  }
  if (finish < source.length) add(finish, source.length, 'source');
  return blocks;
}
