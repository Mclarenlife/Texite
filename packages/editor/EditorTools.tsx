import { Select } from '../ui/Select';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUp, ImagePlus, Sigma, Table2, X, Sparkles } from 'lucide-react';
import type { InlineScope } from '../core/ai';
export type EditorAnchor = { x: number; y: number; menu: boolean; scope: InlineScope };
export function EditorTools({
  anchor,
  onClose,
  onInsert,
  onAI,
  busy,
  images,
  onImportImage,
}: {
  anchor: EditorAnchor;
  onClose(): void;
  onInsert(text: string, graphicx?: boolean): void;
  onAI(prompt: string, scope: InlineScope): void;
  busy: boolean;
  images: string[];
  onImportImage?(file: File): Promise<string>;
}) {
  const [prompt, setPrompt] = useState('');
  const [tool, setTool] = useState('');
  const [rows, setRows] = useState(3);
  const [cols, setCols] = useState(3);
  const [image, setImage] = useState(images[0] || '');
  const [formula, setFormula] = useState(
    anchor.scope.before.slice(anchor.scope.from, anchor.scope.to),
  );
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const click = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const close = () => onClose();
    document.addEventListener('pointerdown', click);
    document.addEventListener('keydown', key);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', click);
      document.removeEventListener('keydown', key);
      window.removeEventListener('resize', close);
    };
  }, [onClose]);
  const send = () => {
    if (prompt.trim() && !busy) {
      onAI(prompt, anchor.scope);
      onClose();
    }
  };
  const x = Math.max(12, Math.min(anchor.x, window.innerWidth - 350)),
    y = Math.max(12, Math.min(anchor.y + 8, window.innerHeight - (anchor.menu ? 380 : 130)));
  return createPortal(
    <div
      className="editor-context-popover"
      ref={root}
      role="dialog"
      aria-label={anchor.menu ? '插入工具' : '行内 AI 指令'}
      style={{ left: x, top: y }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="editor-tools-heading">
        <span>
          <Sparkles size={13} />
          {anchor.scope.from === anchor.scope.to ? '在光标处编辑' : '编辑选中文字'}
        </span>
        <button className="icon-button" aria-label="关闭编辑工具" onClick={onClose}>
          <X size={14} />
        </button>
      </div>
      <form
        className="inline-ai-form"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input
          aria-label="行内 AI 指令"
          placeholder="让 Agent 修改这里…"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          maxLength={20000}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && e.nativeEvent.isComposing) e.preventDefault();
          }}
        />
        <button aria-label="执行行内 AI 指令" disabled={busy || !prompt.trim()}>
          <ArrowUp size={16} />
        </button>
      </form>
      {anchor.menu && (
        <>
          <div className="insert-tools" role="toolbar" aria-label="插入工具栏">
            {[
              ['table', '插入表格', Table2],
              ['image', '插入图片', ImagePlus],
              ['formula', '插入公式', Sigma],
            ].map(([id, label, Icon]) => (
              <button
                type="button"
                key={String(id)}
                aria-pressed={tool === id}
                onClick={() => setTool(String(id))}
              >
                {typeof Icon !== 'string' && <Icon size={17} />}
                <span>{String(label)}</span>
              </button>
            ))}
          </div>
          {tool === 'table' && (
            <form
              className="insert-form"
              onSubmit={(e) => {
                e.preventDefault();
                onInsert(
                  '\\begin{tabular}{' +
                    'l'.repeat(cols) +
                    '}\n\\hline\n' +
                    Array.from(
                      { length: rows },
                      (_, r) =>
                        Array.from({ length: cols }, (_, c) =>
                          r === 0 ? '标题 ' + (c + 1) : '内容',
                        ).join(' & ') + ' \\\\',
                    ).join('\n') +
                    '\n\\hline\n\\end{tabular}\n',
                );
              }}
            >
              <div>
                <label>
                  行
                  <input
                    aria-label="表格行数"
                    type="number"
                    min={1}
                    max={10}
                    value={rows}
                    onChange={(e) =>
                      setRows(Math.max(1, Math.min(10, Number(e.target.value) || 1)))
                    }
                  />
                </label>
                <label>
                  列
                  <input
                    aria-label="表格列数"
                    type="number"
                    min={1}
                    max={10}
                    value={cols}
                    onChange={(e) =>
                      setCols(Math.max(1, Math.min(10, Number(e.target.value) || 1)))
                    }
                  />
                </label>
              </div>
              <button className="primary-button">插入表格代码</button>
            </form>
          )}
          {tool === 'formula' && (
            <form
              className="insert-form"
              onSubmit={(e) => {
                e.preventDefault();
                onInsert('\\[\n' + (formula || 'E = mc^2') + '\n\\]\n');
              }}
            >
              <textarea
                aria-label="公式内容"
                value={formula}
                placeholder="E = mc^2"
                onChange={(e) => setFormula(e.target.value)}
              />
              <button className="primary-button">插入公式代码</button>
            </form>
          )}
          {tool === 'image' && (
            <form
              className="insert-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (image)
                  onInsert('\\includegraphics[width=0.8\\linewidth]{' + image + '}\n', true);
              }}
            >
              <label>
                项目图片
                <Select
                  aria-label="项目图片"
                  value={image}
                  onValueChange={setImage}
                >
                  <option value="">选择图片</option>
                  {[...new Set([...images, ...(image ? [image] : [])])].map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </Select>
              </label>
              <label className="asset-upload">
                {uploading ? '正在导入…' : '从电脑导入图片'}
                <input
                  aria-label="导入图片文件"
                  type="file"
                  accept=".png,.jpg,.jpeg,.pdf"
                  disabled={!onImportImage || uploading}
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f || !onImportImage) return;
                    setUploading(true);
                    try {
                      setImage(await onImportImage(f));
                    } catch (err) {
                      setError((err as Error).message);
                    } finally {
                      setUploading(false);
                    }
                  }}
                />
              </label>
              <button className="primary-button" disabled={!image || uploading}>
                插入图片代码
              </button>
            </form>
          )}
          {error && <p role="alert">{error}</p>}
        </>
      )}
    </div>,
    document.body,
  );
}
