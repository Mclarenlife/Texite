export type VisualBlock = {
  from: number;
  to: number;
  kind: 'section' | 'subsection' | 'paragraph' | 'math' | 'environment' | 'source';
  text: string;
  prefix: string;
  suffix: string;
  environment?: string;
};

// Balanced groups keep nested formatting and all original source offsets intact.
export function readGroup(text: string, start: number, open = '{', close = '}') {
  if (text[start] !== open) return null;
  let depth = 1;
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === '\\') {
      i++;
      continue;
    }
    if (text[i] === '%' && open === '{') {
      const end = text.indexOf('\n', i);
      if (end < 0) return null;
      i = end;
      continue;
    }
    if (text[i] === open) depth++;
    if (text[i] === close && --depth === 0) return { text: text.slice(start + 1, i), end: i + 1 };
  }
  return null;
}
export function stripComments(text: string) {
  return text.replace(/(\\[\s\S])|%[^\n]*(?:\n|$)/g, (all, escaped) => escaped || '');
}
function maskComments(text: string) {
  return text.replace(/(\\[\s\S])|%[^\n]*/g, (all, escaped) => escaped || ' '.repeat(all.length));
}
export function visualBlocks(source: string): VisualBlock[] {
  const masked = maskComments(source);
  const blocks: VisualBlock[] = [];
  const begin = masked.indexOf('\\begin{document}');
  const end = masked.lastIndexOf('\\end{document}');
  const start = begin < 0 ? 0 : begin + '\\begin{document}'.length;
  const finish = end < start ? source.length : end;
  const add = (
    from: number,
    to: number,
    kind: VisualBlock['kind'],
    text = source.slice(from, to),
    prefix = '',
    suffix = '',
    environment?: string,
  ) => blocks.push({ from, to, kind, text, prefix, suffix, environment });
  if (start) add(0, start, 'source');
  let cursor = start;
  while (cursor < finish) {
    if (/\s/.test(source[cursor])) {
      cursor++;
      continue;
    }
    const rest = source.slice(cursor, finish),
      clean = masked.slice(cursor, finish);
    const heading = clean.match(
      /^\\(chapter|section|subsection|subsubsection|paragraph)\*?(?:\[[^\]]*\])?\{/,
    );
    const group = heading && readGroup(source, cursor + heading[0].length - 1);
    if (heading && group) {
      add(
        cursor,
        group.end,
        /^(chapter|section)$/.test(heading[1]) ? 'section' : 'subsection',
        group.text,
        source.slice(cursor, cursor + heading[0].length),
        '}',
      );
      cursor = group.end;
      continue;
    }
    const math = clean.match(/^(\\\[)([\s\S]*?)(\\\])/) || clean.match(/^(\$\$)([\s\S]*?)(\$\$)/);
    if (math) {
      add(
        cursor,
        cursor + math[0].length,
        'math',
        rest.slice(math[1].length, math[0].length - math[3].length),
        math[1],
        math[3],
      );
      cursor += math[0].length;
      continue;
    }
    const environment = clean.match(/^\\begin\{([^}]+)\}/);
    if (environment) {
      const tokens = /\\(begin|end)\{([^}]+)\}/g;
      tokens.lastIndex = environment[0].length;
      let depth = 1,
        closing: RegExpExecArray | null = null,
        token;
      while ((token = tokens.exec(clean))) {
        if (token[2] !== environment[1]) continue;
        depth += token[1] === 'begin' ? 1 : -1;
        if (!depth) {
          closing = token;
          break;
        }
      }
      if (closing) {
        const length = closing.index + closing[0].length;
        const isMath = /^(equation|align|alignat|gather|multline|displaymath)\*?$/.test(
          environment[1],
        );
        add(
          cursor,
          cursor + length,
          isMath ? 'math' : 'environment',
          rest.slice(environment[0].length, closing.index),
          environment[0],
          closing[0],
          environment[1],
        );
        cursor += length;
        continue;
      }
    }
    // Unknown commands remain visible; no HTML is ever serialized back into LaTeX.
    const raw = /^(%|\\(?:documentclass|usepackage|newcommand|renewcommand|def|end)\b)/.test(rest);
    const text = raw
      ? rest.match(/^[^\n]+/)![0]
      : rest.match(
          /^[^\n]+(?:\n(?![ \t]*\n|[ \t]*(?:\\(?:begin|section|subsection|chapter|subsubsection|paragraph)\b|\\\[|\$\$|%))[^\n]+)*/,
        )![0];
    add(cursor, cursor + text.length, raw ? 'source' : 'paragraph');
    cursor += text.length;
  }
  if (finish < source.length) add(finish, source.length, 'source');
  return blocks;
}
export function displayMath(block: VisualBlock) {
  const text = stripComments(block.text).replace(/\\label\{[^}]*\}|\\(?:nonumber|notag)\b/g, '');
  if (/^alignat/.test(block.environment || ''))
    return '\\begin{alignedat}' + text + '\\end{alignedat}';
  if (/^align/.test(block.environment || '')) return '\\begin{aligned}' + text + '\\end{aligned}';
  if (/^(gather|multline)/.test(block.environment || ''))
    return '\\begin{gathered}' + text + '\\end{gathered}';
  return text;
}
// Split at the current brace/environment level; nested lists and math remain intact.
export function splitTopLevel(text: string, separator: RegExp) {
  const parts: string[] = [];
  let start = 0,
    braces = 0,
    environments = 0,
    math = false;
  const pattern = new RegExp('^(?:' + separator.source + ')');
  for (let i = 0; i < text.length; i++) {
    const rest = text.slice(i),
      env = rest.match(/^\\(begin|end)\{[^}]+\}/);
    if (env) {
      environments += env[1] === 'begin' ? 1 : -1;
      i += env[0].length - 1;
      continue;
    }
    if (!braces && !environments && !math) {
      const match = rest.match(pattern);
      if (match) {
        parts.push(text.slice(start, i));
        i += match[0].length - 1;
        start = i + 1;
        continue;
      }
    }
    if (text[i] === '\\') {
      i++;
      continue;
    }
    if (text[i] === '$') math = !math;
    if (text[i] === '{') braces++;
    if (text[i] === '}') braces--;
  }
  parts.push(text.slice(start));
  return parts;
}
