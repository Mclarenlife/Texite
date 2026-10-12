import type { ReactNode } from 'react';
import katex from 'katex';
import type { ProjectFile } from '../core/model';
import {
  displayMath,
  readGroup,
  splitTopLevel,
  stripComments,
  visualBlocks,
  type VisualBlock,
} from './visual';
export type PreviewContext = {
  files: ProjectFile[];
  path: string;
  document: string;
  onOpenFile: (path: string) => void;
  depth?: number;
};

export function MathPreview({ source, display = false }: { source: string; display?: boolean }) {
  return (
    <span
      className="visual-formula"
      dangerouslySetInnerHTML={{
        __html: katex.renderToString(source, {
          displayMode: display,
          throwOnError: false,
          trust: false,
          strict: false,
          maxExpand: 500,
          maxSize: 20,
        }),
      }}
    />
  );
}
function resolveFile(context: PreviewContext, name: string, extensions: string[]) {
  const folder = context.path.split('/').slice(0, -1).join('/');
  for (const base of [folder ? folder + '/' + name : name, name]) {
    const parts: string[] = [];
    for (const part of base.split('/')) {
      if (part === '..') parts.pop();
      else if (part !== '.') parts.push(part);
    }
    const path = parts.join('/');
    for (const suffix of ['', ...extensions]) {
      const file = context.files.find((f) => f.path === path + suffix);
      if (file) return file;
    }
  }
}
export function Inline({ text, context }: { text: string; context: PreviewContext }) {
  text = stripComments(text);
  const nodes: ReactNode[] = [];
  let cursor = 0;
  const add = (node: ReactNode) => nodes.push(<span key={nodes.length}>{node}</span>);
  while (cursor < text.length) {
    const rest = text.slice(cursor);
    const math = rest.match(/^\$([^$\n]+)\$/) || rest.match(/^\\\(([\s\S]*?)\\\)/);
    if (math) {
      add(<MathPreview source={math[1]} />);
      cursor += math[0].length;
      continue;
    }
    const command = rest.match(/^\\([A-Za-z]+)\*?[ \t]*(?:\[[^\]]*\])?[ \t]*/);
    if (command) {
      const name = command[1],
        group = readGroup(text, cursor + command[0].length);
      const content = group?.text || '';
      const child = () => (
        <Inline text={content} context={{ ...context, depth: (context.depth || 0) + 1 }} />
      );
      if ((context.depth || 0) > 12) {
        add(<code>{rest}</code>);
        break;
      }
      if (
        group &&
        [
          'textbf',
          'textit',
          'emph',
          'texttt',
          'textrm',
          'textsf',
          'underline',
          'textsuperscript',
          'textsubscript',
          'mbox',
        ].includes(name)
      ) {
        add(
          name === 'textbf' ? (
            <strong>{child()}</strong>
          ) : /^(textit|emph)$/.test(name) ? (
            <em>{child()}</em>
          ) : name === 'texttt' ? (
            <code>{child()}</code>
          ) : name === 'underline' ? (
            <u>{child()}</u>
          ) : name === 'textsuperscript' ? (
            <sup>{child()}</sup>
          ) : name === 'textsubscript' ? (
            <sub>{child()}</sub>
          ) : (
            child()
          ),
        );
      } else if (group && name === 'label') {
        /* No visible text in the typeset document. */
      } else if (group && /^(cite\w*|ref|eqref|pageref|autoref)$/.test(name)) {
        add(
          <span className="visual-reference" title="编号以编译后的 PDF 为准">
            {name.startsWith('cite') ? '[' : '↗ '}
            {content}
            {name.startsWith('cite') ? ']' : ''}
          </span>,
        );
      } else if (group && name === 'footnote') {
        add(<span className="visual-footnote">〔{child()}〕</span>);
      } else if (group && /^(caption|title|author|date)$/.test(name)) {
        add(<span className={'visual-' + name}>{child()}</span>);
      } else if (group && /^(url|href)$/.test(name)) {
        const label = name === 'href' ? readGroup(text, group.end) : null;
        add(
          <span className="visual-reference">
            {label ? <Inline text={label.text} context={context} /> : content}
          </span>,
        );
        cursor = label?.end || group.end;
        continue;
      } else if (group && name === 'includegraphics') {
        const file = resolveFile(context, content, ['.png', '.jpg', '.jpeg', '.webp', '.gif']);
        const ext = file?.path.split('.').pop()?.toLowerCase();
        add(
          file?.binary && /^(png|jpe?g|webp|gif)$/.test(ext || '') ? (
            <img
              className="visual-image"
              src={'data:image/' + (ext === 'jpg' ? 'jpeg' : ext) + ';base64,' + file.content}
              alt={content}
            />
          ) : (
            <code className="visual-unsupported">
              图片：{content}（请在 PDF 中查看或检查文件路径）
            </code>
          ),
        );
      } else if (group && /^(input|include)$/.test(name)) {
        const file = resolveFile(context, content, ['.tex']);
        add(
          file && !file.binary && (context.depth || 0) < 6 ? (
            <span className="visual-include">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  context.onOpenFile(file.path);
                }}
              >
                打开 {file.path}
              </button>
              <RichText
                text={file.content}
                context={{ ...context, path: file.path, depth: (context.depth || 0) + 1 }}
              />
            </span>
          ) : (
            <code className="visual-unsupported">{'\\' + name + '{' + content + '}'}</code>
          ),
        );
      } else if (name === 'maketitle') {
        add(
          <span className="visual-title-block">
            {['title', 'author', 'date'].map((key) => {
              const found = context.document.match(new RegExp('\\\\' + key + '\\s*\\{'));
              const value =
                found && readGroup(context.document, found.index! + found[0].length - 1);
              return value ? (
                <span className={'visual-' + key} key={key}>
                  <Inline
                    text={value.text}
                    context={{ ...context, depth: (context.depth || 0) + 1 }}
                  />
                </span>
              ) : null;
            })}
          </span>,
        );
      } else if (
        /^(centering|raggedright|raggedleft|small|large|Large|noindent|normalsize|protect)$/.test(
          name,
        )
      ) {
      } else if (/^(par|newline|linebreak|newpage|clearpage)$/.test(name)) {
        add(<br />);
      } else if (/^(LaTeX|TeX|today|quad|qquad|ldots|dots)$/.test(name)) {
        add(
          (
            {
              LaTeX: 'LaTeX',
              TeX: 'TeX',
              today: new Date().toLocaleDateString(),
              quad: '\u2003',
              qquad: '\u2003\u2003',
              ldots: '…',
              dots: '…',
            } as Record<string, string>
          )[name],
        );
      } else {
        add(
          <code className="visual-unsupported" title="此命令保留源码，最终效果请查看 PDF">
            {text.slice(cursor, group?.end || cursor + command[0].length)}
          </code>,
        );
      }
      cursor = group?.end || cursor + command[0].length;
      continue;
    }
    const escaped = rest.match(/^\\([%&#_${}~\\ ])/);
    if (escaped) {
      add(escaped[1] === '\\' ? <br /> : escaped[1]);
      cursor += escaped[0].length;
      continue;
    }
    const plain = rest.match(/^[^\\$~]+/);
    if (plain) {
      add(
        plain[0].replace(/---/g, '—').replace(/--/g, '–').replace(/``/g, '“').replace(/''/g, '”'),
      );
      cursor += plain[0].length;
    } else {
      add(rest[0] === '~' ? '\u00a0' : rest[0]);
      cursor++;
    }
  }
  return <>{nodes}</>;
}
export function RichText({ text, context }: { text: string; context: PreviewContext }) {
  if ((context.depth || 0) > 12) return <code className="visual-unsupported">{text}</code>;
  return (
    <>
      {visualBlocks(text).map((block, i) => (
        <span className={'visual-render-block visual-' + block.kind} key={i}>
          <BlockPreview block={block} context={{ ...context, depth: (context.depth || 0) + 1 }} />
        </span>
      ))}
    </>
  );
}
export function BlockPreview({ block, context }: { block: VisualBlock; context: PreviewContext }) {
  if (block.kind === 'math') return <MathPreview source={displayMath(block)} display />;
  if (block.kind === 'source') return <code className="visual-unsupported">{block.text}</code>;
  if (block.kind !== 'environment') return <Inline text={block.text} context={context} />;
  const env = block.environment || '',
    text = stripComments(block.text)
      .trim()
      .replace(/^\[[^\]]*\]\s*/, '');
  if (/^(itemize|enumerate|description)$/.test(env)) {
    const items = splitTopLevel(text, /\\item\b/),
      Tag = env === 'enumerate' ? 'ol' : 'ul';
    return (
      <>
        <RichText text={items[0]} context={context} />
        <Tag className={'visual-list ' + env}>
          {items.slice(1).map((item, i) => {
            const label = readGroup(item.trim(), 0, '[', ']');
            return (
              <li key={i}>
                {label && <strong>{label.text} </strong>}
                <RichText text={label ? item.trim().slice(label.end) : item} context={context} />
              </li>
            );
          })}
        </Tag>
      </>
    );
  }
  if (
    /^(table|table\*|figure|figure\*|center|flushleft|flushright|minipage|abstract|quote|quotation)$/.test(
      env,
    )
  ) {
    const minipage = env === 'minipage' ? readGroup(text, 0) : null;
    return (
      <span className={'visual-environment env-' + env.replace('*', '')}>
        <RichText text={minipage ? text.slice(minipage.end) : text} context={context} />
      </span>
    );
  }
  if (/^(tabular|tabular\*|tabularx)$/.test(env)) {
    let body = text;
    for (let i = 0; i < (env === 'tabular' ? 1 : 2); i++) {
      const group = readGroup(body.trim(), 0);
      if (group) body = body.trim().slice(group.end);
    }
    body = body.replace(
      /\\(?:hline|toprule|midrule|bottomrule)\b(?:\[[^\]]*\])?|\\(?:cline|cmidrule)(?:\([^)]*\))?\{[^}]*\}/g,
      '',
    );
    const rows = splitTopLevel(body, /\\\\(?:\[[^\]]*\])?/).filter((row) => row.trim());
    return (
      <span className="visual-table-wrap">
        <table className="visual-table">
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {splitTopLevel(row, /&/).map((cell, j) => (
                  <td key={j}>
                    <Inline text={cell.trim()} context={context} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </span>
    );
  }
  if (/^(verbatim|lstlisting|minted)$/.test(env)) return <pre className="visual-code">{text}</pre>;
  return <code className="visual-unsupported">{block.prefix + block.text + block.suffix}</code>;
}
