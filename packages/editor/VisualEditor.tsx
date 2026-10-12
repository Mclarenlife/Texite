import { useState, useRef } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { Bold, Italic, Heading1, Sigma, Plus, Code2 } from 'lucide-react';
import { visualBlocks, type VisualBlock } from './visual';
import type { ProjectFile } from '../core/model';

function MathPreview({ source, display = false }: { source: string; display?: boolean }) {
  return (
    <span
      dangerouslySetInnerHTML={{
        __html: katex.renderToString(source, {
          displayMode: display,
          throwOnError: false,
          trust: false,
          strict: false,
        }),
      }}
    />
  );
}
function Inline({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\\(?:textbf|textit|emph)\{[^{}]*\}|\$[^$\n]+\$)/g).map((part, i) => {
        if (part.startsWith('$')) return <MathPreview key={i} source={part.slice(1, -1)} />;
        const match = part.match(/^\\(textbf|textit|emph)\{([^{}]*)\}$/);
        if (match)
          return match[1] === 'textbf' ? (
            <strong key={i}>{match[2]}</strong>
          ) : (
            <em key={i}>{match[2]}</em>
          );
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}
export function VisualEditor({
  file,
  onChange,
}: {
  file: ProjectFile;
  onChange: (content: string, path: string) => void;
}) {
  const [active, setActive] = useState<number | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const blocks = visualBlocks(file.content);
  const change = (block: VisualBlock, value: string) =>
    onChange(
      file.content.slice(0, block.from) +
        block.prefix +
        value +
        block.suffix +
        file.content.slice(block.to),
      file.path,
    );
  function insert(before: string, after = '') {
    const block = active === null ? undefined : blocks[active];
    if (block && input.current) {
      const { selectionStart: from, selectionEnd: to } = input.current;
      change(
        block,
        block.text.slice(0, from) +
          before +
          block.text.slice(from, to) +
          after +
          block.text.slice(to),
      );
      requestAnimationFrame(() => {
        input.current?.focus();
        input.current?.setSelectionRange(from + before.length, to + before.length);
      });
    } else {
      const end = file.content.lastIndexOf('\\end{document}');
      const pos = end >= 0 ? end : file.content.length;
      onChange(
        file.content.slice(0, pos) + '\n\n' + before + after + '\n\n' + file.content.slice(pos),
        file.path,
      );
    }
  }
  return (
    <div className="visual-editor">
      <div className="visual-toolbar" aria-label="可视化格式工具">
        <button
          title="粗体"
          aria-label="粗体"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => insert('\\textbf{', '}')}
        >
          <Bold size={16} />
        </button>
        <button
          title="斜体"
          aria-label="斜体"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => insert('\\emph{', '}')}
        >
          <Italic size={16} />
        </button>
        <button
          title="插入章节"
          aria-label="插入章节"
          onClick={() => {
            setActive(null);
            const end = file.content.lastIndexOf('\\end{document}');
            const pos = end < 0 ? file.content.length : end;
            onChange(
              file.content.slice(0, pos) + '\n\\section{新章节}\n\n' + file.content.slice(pos),
              file.path,
            );
          }}
        >
          <Heading1 size={18} />
        </button>
        <button
          title="插入公式"
          aria-label="插入公式"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => insert('$', '$')}
        >
          <Sigma size={16} />
        </button>
        <span>点击内容编辑 · 复杂语法保留源码</span>
      </div>
      <div className="visual-page" aria-label="LaTeX 可视化编辑器">
        {blocks.map((block, i) => (
          <div key={i} className={'visual-block visual-' + block.kind}>
            {active === i ? (
              <textarea
                ref={input}
                autoFocus
                aria-label={
                  block.kind === 'section' || block.kind === 'subsection' ? '编辑标题' : '编辑内容'
                }
                value={block.text}
                rows={Math.max(1, block.text.split('\n').length)}
                onChange={(e) => change(block, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setActive(null);
                }}
                onBlur={(e) => {
                  if (!e.relatedTarget?.closest('.visual-toolbar')) setActive(null);
                }}
              />
            ) : block.kind === 'source' ? (
              <details>
                <summary>
                  <Code2 size={13} />{' '}
                  {block.from === 0 && block.text.includes('\\documentclass')
                    ? '导言区'
                    : block.text.slice(0, 60)}
                </summary>
                <button className="source-block" onClick={() => setActive(i)}>
                  <code>{block.text}</code>
                </button>
              </details>
            ) : (
              <button className="visual-content" onClick={() => setActive(i)}>
                {block.kind === 'math' ? (
                  <MathPreview source={block.text} display />
                ) : (
                  <Inline text={block.text} />
                )}
              </button>
            )}
          </div>
        ))}
        <button
          className="visual-add"
          onClick={() => {
            const end = file.content.lastIndexOf('\\end{document}');
            const pos = end < 0 ? file.content.length : end;
            onChange(
              file.content.slice(0, pos) + '\n\n新段落\n\n' + file.content.slice(pos),
              file.path,
            );
          }}
        >
          <Plus size={15} />
          添加段落
        </button>
      </div>
    </div>
  );
}
