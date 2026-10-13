import { Select } from '../ui/Select';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowUp,
  ImagePlus,
  Sigma,
  Table2,
  X,
  Sparkles,
  Link,
  Quote,
  Hash,
  Omega,
} from 'lucide-react';
import type { InlineScope } from '../core/ai';
import {
  escapeText,
  tableCode,
  withFloat,
  formulaCode,
  symbolGroups,
  type FloatOptions,
  type FormulaStyle,
} from './insertions';
export type EditorAnchor = { x: number; y: number; menu: boolean; scope: InlineScope };
export function EditorTools({
  anchor,
  onClose,
  onInsert,
  onAI,
  busy,
  images,
  references,
  labels,
  onImportImage,
}: {
  anchor: EditorAnchor;
  onClose(): void;
  onInsert(text: string, packages?: string[]): void;
  onAI(prompt: string, scope: InlineScope): void;
  busy: boolean;
  images: string[];
  references: string[];
  labels: string[];
  onImportImage?(file: File): Promise<string>;
}) {
  const [prompt, setPrompt] = useState(''),
    [tool, setTool] = useState('');
  const [rows, setRows] = useState(3),
    [cols, setCols] = useState(3);
  const [image, setImage] = useState(images[0] || '');
  const [formula, setFormula] = useState(
    anchor.scope.before.slice(anchor.scope.from, anchor.scope.to),
  );
  const [style, setStyle] = useState<FormulaStyle>('display'),
    [numbered, setNumbered] = useState(false);
  const [options, setOptions] = useState<FloatOptions>({
    wide: false,
    floating: false,
    centered: false,
    caption: '',
    label: '',
  });
  const [booktabs, setBooktabs] = useState(false),
    [width, setWidth] = useState(80);
  const [url, setUrl] = useState(''),
    [text, setText] = useState(anchor.scope.before.slice(anchor.scope.from, anchor.scope.to));
  const [key, setKey] = useState(''),
    [symbolQuery, setSymbolQuery] = useState(''),
    [mathMode, setMathMode] = useState(true);
  const [error, setError] = useState(''),
    [uploading, setUploading] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = root.current!;
    const place = () => {
      el.style.left =
        Math.max(12, Math.min(anchor.x, window.innerWidth - el.offsetWidth - 12)) + 'px';
      el.style.top =
        Math.max(12, Math.min(anchor.y + 8, window.innerHeight - el.offsetHeight - 12)) + 'px';
    };
    const observer = new ResizeObserver(place);
    observer.observe(el);
    place();
    return () => observer.disconnect();
  }, [anchor.x, anchor.y]);
  useEffect(() => {
    const click = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('pointerdown', click);
    document.addEventListener('keydown', key);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('pointerdown', click);
      document.removeEventListener('keydown', key);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);
  function insert(code: string, packages: string[] = []) {
    if (
      (((tool === 'table' || tool === 'image') && options.caption.trim()) ||
        (tool === 'formula' && numbered && style !== 'inline')) &&
      options.label &&
      !/^[\w:./-]+$/.test(options.label)
    ) {
      setError('标签请使用字母、数字、冒号、横线或下划线。');
      return;
    }
    onInsert(code, packages);
  }
  const check = (
    label: string,
    value: boolean,
    change: (value: boolean) => void,
    disabled = false,
  ) => (
    <label className="insert-check">
      <input
        type="checkbox"
        checked={value}
        disabled={disabled}
        onChange={(e) => change(e.target.checked)}
      />
      {label}
    </label>
  );
  const floats = (
    <>
      <div className="insert-checks">
        {check('跨双栏', options.wide, (wide) =>
          setOptions({ ...options, wide, floating: wide || options.floating }),
        )}
        {check(
          '浮动环境',
          options.floating || options.wide,
          (floating) => setOptions({ ...options, floating }),
          options.wide,
        )}
        {check('居中', options.centered, (centered) => setOptions({ ...options, centered }))}
      </div>
      {options.wide && (
        <small className="insert-note">跨双栏用于双栏文稿，通常排在页顶，位置由 LaTeX 决定。</small>
      )}
      {(options.floating || options.wide) && (
        <>
          <label>
            标题
            <input
              aria-label="浮动体标题"
              value={options.caption}
              onChange={(e) => setOptions({ ...options, caption: e.target.value })}
              placeholder="可选"
            />
          </label>
          <label>
            标签
            <input
              aria-label="浮动体标签"
              value={options.label}
              disabled={!options.caption.trim()}
              onChange={(e) => setOptions({ ...options, label: e.target.value })}
              placeholder="如 fig:result（先填写标题）"
            />
          </label>
        </>
      )}
    </>
  );
  const floatOptions = { ...options, label: options.caption.trim() ? options.label : '' };
  return createPortal(
    <div
      className={'editor-context-popover' + (anchor.menu ? ' editor-insert-popover' : '')}
      ref={root}
      role="dialog"
      aria-label={anchor.menu ? '插入工具' : '行内 AI 指令'}
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
          if (prompt.trim() && !busy) {
            onAI(prompt, anchor.scope);
            onClose();
          }
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
            {(
              [
                ['table', '插入表格', Table2],
                ['image', '插入图片', ImagePlus],
                ['formula', '插入公式', Sigma],
                ['symbol', '插入符号', Omega],
                ['href', '插入链接', Link],
                ['cite', '文献引用', Quote],
                ['ref', '交叉引用', Hash],
              ] as const
            ).map(([id, label, Icon]) => (
              <button
                type="button"
                key={id}
                aria-pressed={tool === id}
                onClick={() => {
                  setTool(id);
                  setError('');
                  setKey('');
                }}
              >
                <Icon size={16} />
                <span>{label}</span>
              </button>
            ))}
          </div>
          {tool === 'table' && (
            <form
              className="insert-form"
              onSubmit={(e) => {
                e.preventDefault();
                insert(tableCode(rows, cols, booktabs, floatOptions), booktabs ? ['booktabs'] : []);
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
              {check('三线表', booktabs, setBooktabs)}
              {floats}
              <button className="primary-button">插入表格代码</button>
            </form>
          )}
          {tool === 'formula' && (
            <form
              className="insert-form"
              onSubmit={(e) => {
                e.preventDefault();
                insert(formulaCode(formula, style, numbered, options.label), ['amsmath']);
              }}
            >
              <label>
                公式样式
                <Select
                  aria-label="公式样式"
                  value={style}
                  onValueChange={(v) => setStyle(v as FormulaStyle)}
                >
                  <option value="display">独立公式</option>
                  <option value="inline">行内公式</option>
                  <option value="align">多行对齐</option>
                  <option value="cases">分段函数</option>
                  <option value="matrix">圆括号矩阵</option>
                </Select>
              </label>
              <textarea
                aria-label="公式内容"
                value={formula}
                placeholder={
                  style === 'align'
                    ? 'a &= b + c \\\\ …'
                    : style === 'matrix'
                      ? 'a & b \\\\ c & d'
                      : style === 'cases'
                        ? 'x, & x \\ge 0 \\\\ …'
                        : 'E = mc^2'
                }
                onChange={(e) => setFormula(e.target.value)}
              />
              {check('公式编号', numbered && style !== 'inline', setNumbered, style === 'inline')}
              {numbered && style !== 'inline' && (
                <label>
                  标签
                  <input
                    aria-label="公式标签"
                    value={options.label}
                    onChange={(e) => setOptions({ ...options, label: e.target.value })}
                    placeholder="可选，如 eq:energy"
                  />
                </label>
              )}
              <button className="primary-button">插入公式代码</button>
            </form>
          )}
          {tool === 'image' && (
            <form
              className="insert-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (image)
                  insert(
                    withFloat(
                      '\\includegraphics[width=' + width / 100 + '\\linewidth]{' + image + '}',
                      'figure',
                      floatOptions,
                    ),
                    ['graphicx'],
                  );
              }}
            >
              <label>
                项目图片
                <Select aria-label="项目图片" searchable value={image} onValueChange={setImage}>
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
                      setError('');
                    } catch (err) {
                      setError((err as Error).message);
                    } finally {
                      setUploading(false);
                    }
                  }}
                />
              </label>
              <label>
                宽度
                <input
                  aria-label="图片宽度百分比"
                  type="number"
                  min={5}
                  max={100}
                  value={width}
                  onChange={(e) =>
                    setWidth(Math.max(5, Math.min(100, Number(e.target.value) || 80)))
                  }
                />
                % 栏宽
              </label>
              {floats}
              <button className="primary-button" disabled={!image || uploading}>
                插入图片代码
              </button>
            </form>
          )}
          {tool === 'symbol' && (
            <section className="symbol-picker" aria-label="符号选择窗口">
              <input
                className="symbol-search"
                aria-label="搜索符号"
                placeholder="搜索符号或命令，如 alpha、箭头"
                value={symbolQuery}
                onChange={(e) => setSymbolQuery(e.target.value)}
              />
              {check('插入为行内公式', mathMode, setMathMode)}
              <div className="symbol-scroll">
                {symbolGroups.map((group) => {
                  const items = group.items.filter(([glyph, command]) =>
                    (group.name + glyph + command)
                      .toLowerCase()
                      .includes(symbolQuery.toLowerCase()),
                  );
                  return (
                    !!items.length && (
                      <div key={group.name}>
                        <h4>{group.name}</h4>
                        <div className="symbol-grid">
                          {items.map(([glyph, command]) => (
                            <button
                              key={command}
                              title={'\\' + command}
                              aria-label={'插入 \\' + command}
                              onClick={() =>
                                insert(mathMode ? '\\(\\' + command + '\\)' : '\\' + command + ' ')
                              }
                            >
                              <span>{glyph}</span>
                              <small>{command}</small>
                            </button>
                          ))}
                        </div>
                      </div>
                    )
                  );
                })}
                {!symbolGroups.some((g) =>
                  g.items.some(([a, b]) =>
                    (g.name + a + b).toLowerCase().includes(symbolQuery.toLowerCase()),
                  ),
                ) && <p>没有匹配的符号</p>}
              </div>
            </section>
          )}
          {tool === 'href' && (
            <form
              className="insert-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (!/^(https?:\/\/|mailto:)/i.test(url) || /[{}\\\r\n]/.test(url)) {
                  setError('请输入有效的 http、https 或 mailto 链接，不含大括号或换行。');
                  return;
                }
                insert(
                  '\\href{' +
                    url.replace(/[%#&]/g, (c) => '\\' + c) +
                    '}{' +
                    escapeText(text || url) +
                    '}',
                  ['hyperref'],
                );
              }}
            >
              <label>
                网址
                <input
                  aria-label="链接网址"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://…"
                  required
                />
              </label>
              <label>
                文字
                <input
                  aria-label="链接文字"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="链接显示文字"
                />
              </label>
              <button className="primary-button">插入链接代码</button>
            </form>
          )}
          {(tool === 'cite' || tool === 'ref') && (
            <form
              className="insert-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (!/^[^{}\\\s%]+$/.test(key)) {
                  setError('请输入有效的引用键或标签。');
                  return;
                }
                insert('\\' + tool + '{' + key + '}');
              }}
            >
              <label>
                {tool === 'cite' ? '文献' : '标签'}
                <Select aria-label="已有引用" searchable value={key} onValueChange={setKey}>
                  <option value="">选择已有条目</option>
                  {[...new Set(tool === 'cite' ? references : labels)].map((k) => (
                    <option key={k}>{k}</option>
                  ))}
                </Select>
              </label>
              <input
                aria-label="引用键"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder={tool === 'cite' ? '文献键，多个以英文逗号分隔' : '如 fig:result'}
                required
              />
              <button className="primary-button">
                {tool === 'cite' ? '插入 cite' : '插入 ref'}
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
