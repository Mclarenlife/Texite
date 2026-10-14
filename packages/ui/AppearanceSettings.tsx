import { useEffect, useState, type ReactNode, type CSSProperties } from 'react';
import {
  Info,
  Check,
  Cloud,
  Sun,
  Moon,
  Monitor,
  Palette,
  Type,
  Terminal,
  ChevronRight,
  RotateCcw,
} from 'lucide-react';
import './settings.css';
import { AboutSettings } from './AboutSettings';
import { editorFonts } from './preferences';
import { ColorPicker } from './ColorPicker';
import {
  colorRoles,
  palettes,
  resolveEditorColors,
  type ColorRole,
  type EditorColors,
} from './colors';

type Props = {
  theme: string;
  onTheme: (v: string) => void;
  palette: string;
  onPalette: (v: string) => void;
  contrast: string;
  onContrast: (v: string) => void;
  colors: EditorColors;
  onColor: (key: ColorRole, value: string) => void;
  font: string;
  onFont: (v: string) => void;
  fontSize: number;
  uiSize: string;
  onUiSize: (v: string) => void;
  onFontSize: (v: number) => void;
  reduceMotion: boolean;
  onReduceMotion: (v: boolean) => void;
  children: ReactNode;
  initialTab?: string;
  sync?: ReactNode;
};
function Choices({
  label,
  className = '',
  value,
  onChange,
  options,
}: {
  label: string;
  className?: string;
  value: string;
  onChange: (v: string) => void;
  options: { id: string; label: string; content: ReactNode }[];
}) {
  return (
    <div className={'choice-grid ' + className} role="radiogroup" aria-label={label}>
      {options.map((option, index) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-label={option.label}
          aria-checked={value === option.id}
          tabIndex={value === option.id ? 0 : -1}
          onClick={() => onChange(option.id)}
          onKeyDown={(e) => {
            const offset =
              e.key === 'ArrowRight' || e.key === 'ArrowDown'
                ? 1
                : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
                  ? -1
                  : 0;
            if (!offset && e.key !== 'Home' && e.key !== 'End') return;
            e.preventDefault();
            const next =
              e.key === 'Home'
                ? 0
                : e.key === 'End'
                  ? options.length - 1
                  : (index + offset + options.length) % options.length;
            onChange(options[next].id);
            e.currentTarget
              .parentElement!.querySelectorAll<HTMLButtonElement>('[role="radio"]')
              [next].focus();
          }}
        >
          {option.content}
          <span className="choice-check" aria-hidden="true">
            {value === option.id && <Check size={12} />}
          </span>
        </button>
      ))}
    </div>
  );
}
function MiniWindow({ appearance }: { appearance: string }) {
  return (
    <span className={'mini-window mini-' + appearance} aria-hidden="true">
      <span className="mini-window-top">
        <i />
        <i />
        <i />
      </span>
      <span className="mini-window-body">
        <span className="mini-sidebar">
          <i />
          <i />
          <i />
        </span>
        <span className="mini-code">
          <i />
          <i />
          <i />
          <i />
        </span>
        <span className="mini-paper">
          <i />
          <i />
          <i />
        </span>
      </span>
    </span>
  );
}
export function AppearanceSettings(props: Props) {
  const [tab, setTab] = useState(props.initialTab || 'appearance');
  const [editingColor, setEditingColor] = useState<ColorRole | null>(null);
  const [systemDark, setSystemDark] = useState(
    () => matchMedia('(prefers-color-scheme: dark)').matches,
  );
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const change = () => setSystemDark(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  const dark = props.theme === 'dark' || (props.theme === 'system' && systemDark);
  const resolved = resolveEditorColors(props.colors, dark, props.palette, props.contrast);
  const currentPalette = palettes.find((p) => p.id === props.palette) || palettes[0];
  const fontOptions = [
    { id: 'mono', name: '系统等宽', note: '跟随设备' },
    { id: 'jetbrains', name: 'JetBrains Mono', note: '内置 · 离线可用' },
    { id: 'consolas', name: 'Consolas', note: '清晰工整' },
    { id: 'cascadia', name: 'Cascadia Code', note: '圆润等宽' },
    { id: 'sans', name: '无衬线', note: '轻盈易读' },
    { id: 'serif', name: '衬线 / 宋体', note: '书页质感' },
  ];
  const tabs = [
    { id: 'appearance', name: '外观与主题', icon: Palette },
    { id: 'text', name: '编辑器文字', icon: Type },
    { id: 'compiler', name: '编译设置', icon: Terminal },
    { id: 'sync', name: '同步与存储', icon: Cloud },
    { id: 'about', name: '关于', icon: Info },
  ];
  return (
    <div className="settings-studio">
      <div className="settings-nav" role="tablist" aria-label="设置分类">
        {tabs.map((item, index) => (
          <button
            key={item.id}
            role="tab"
            id={'settings-tab-' + item.id}
            aria-controls={'settings-panel-' + item.id}
            aria-selected={tab === item.id}
            tabIndex={tab === item.id ? 0 : -1}
            onClick={() => {
              setTab(item.id);
              setEditingColor(null);
            }}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
              e.preventDefault();
              const next = (index + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
              setTab(tabs[next].id);
              setEditingColor(null);
              (e.currentTarget.parentElement!.children[next] as HTMLButtonElement).focus();
            }}
          >
            <item.icon size={16} />
            {item.name}
          </button>
        ))}
      </div>
      <div
        className={
          'settings-layout' +
          (['compiler', 'sync', 'about'].includes(tab) ? ' compiler-layout' : '')
        }
      >
        <div
          className="settings-options"
          role="tabpanel"
          id={'settings-panel-' + tab}
          aria-labelledby={'settings-tab-' + tab}
        >
          {tab === 'appearance' && (
            <>
              <div className="settings-section-heading">
                <h3>外观</h3>
                <span>选择背景亮度</span>
              </div>
              <Choices
                label="外观"
                className="appearance-choices"
                value={props.theme}
                onChange={props.onTheme}
                options={[
                  {
                    id: 'light',
                    label: '浅色',
                    content: (
                      <>
                        <MiniWindow appearance="light" />
                        <span className="choice-label">
                          <Sun size={14} />
                          浅色
                        </span>
                      </>
                    ),
                  },
                  {
                    id: 'dark',
                    label: '深色',
                    content: (
                      <>
                        <MiniWindow appearance="dark" />
                        <span className="choice-label">
                          <Moon size={14} />
                          深色
                        </span>
                      </>
                    ),
                  },
                  {
                    id: 'system',
                    label: '跟随系统',
                    content: (
                      <>
                        <MiniWindow appearance="system" />
                        <span className="choice-label">
                          <Monitor size={14} />
                          跟随系统
                        </span>
                      </>
                    ),
                  },
                ]}
              />
              <div className="settings-section-heading">
                <h3>主题配色</h3>
                <span>黑白底色，独立选择强调色</span>
              </div>
              <Choices
                label="主题配色"
                className="palette-choices"
                value={props.palette}
                onChange={props.onPalette}
                options={palettes.map((p) => ({
                  id: p.id,
                  label: p.name,
                  content: (
                    <>
                      <span
                        className="palette-art"
                        style={
                          { '--swatch-accent': p.light, '--swatch-tint': p.tint } as CSSProperties
                        }
                      >
                        <span className="palette-art-sidebar" />
                        <span className="palette-art-content">
                          <i />
                          <i />
                          <i />
                        </span>
                        <span className="palette-chips">
                          <i style={{ background: p.light }} />
                          <i style={{ background: p.dark }} />
                          <i style={{ background: p.tint }} />
                        </span>
                      </span>
                      <span className="palette-name">
                        {p.name}
                        <small>{p.note}</small>
                      </span>
                    </>
                  ),
                }))}
              />
              <div className="settings-section-heading">
                <h3>界面字号</h3>
                <span>调整菜单与面板文字，编辑器字号单独设置</span>
              </div>
              <Choices
                label="界面字号"
                className="ui-size-choices"
                value={props.uiSize}
                onChange={props.onUiSize}
                options={[
                  {
                    id: 'small',
                    label: '小',
                    content: (
                      <span className="ui-size-preview small">
                        小<span>轻巧紧凑</span>
                      </span>
                    ),
                  },
                  {
                    id: 'medium',
                    label: '中',
                    content: (
                      <span className="ui-size-preview medium">
                        中<span>标准舒适</span>
                      </span>
                    ),
                  },
                  {
                    id: 'large',
                    label: '大',
                    content: (
                      <span className="ui-size-preview large">
                        大<span>清晰易读</span>
                      </span>
                    ),
                  },
                ]}
              />
              <div className="motion-setting">
                <div>
                  <strong>减少动态效果</strong>
                  <small>保留操作反馈，减少界面位移</small>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-label="减少动态效果"
                  aria-checked={props.reduceMotion}
                  onClick={() => props.onReduceMotion(!props.reduceMotion)}
                >
                  <span />
                </button>
              </div>
            </>
          )}
          {tab === 'text' && (
            <>
              <div className="settings-section-heading">
                <h3>文字颜色</h3>
                <button
                  className="quiet-action"
                  onClick={() => colorRoles.forEach((role) => props.onColor(role.id, 'auto'))}
                >
                  <RotateCcw size={12} />
                  全部跟随主题
                </button>
              </div>
              <div className="editor-color-cards">
                {colorRoles.map((role) => (
                  <button
                    key={role.id}
                    aria-label={'调整' + role.label + '颜色'}
                    aria-expanded={editingColor === role.id}
                    className={editingColor === role.id ? 'selected' : ''}
                    onClick={() => setEditingColor(editingColor === role.id ? null : role.id)}
                  >
                    <span className="color-token-sample" style={{ color: resolved[role.id] }}>
                      {role.sample}
                    </span>
                    <span className="color-token-label">
                      <span>
                        {role.label}
                        <small>
                          {props.colors[role.id] === 'auto' ? '跟随主题' : resolved[role.id]}
                        </small>
                      </span>
                      <i style={{ background: resolved[role.id] }} />
                      <ChevronRight size={13} />
                    </span>
                  </button>
                ))}
              </div>
              {editingColor && (
                <ColorPicker
                  key={editingColor}
                  label={colorRoles.find((r) => r.id === editingColor)!.label}
                  value={props.colors[editingColor]}
                  resolved={resolved[editingColor]}
                  onChange={(value) => props.onColor(editingColor, value)}
                  onClose={() => setEditingColor(null)}
                />
              )}
              <div className="settings-section-heading">
                <h3>文字对比度</h3>
                <span>自选颜色保持不变</span>
              </div>
              <Choices
                label="文字对比度"
                className="contrast-choices"
                value={props.contrast}
                onChange={props.onContrast}
                options={[
                  { id: 'soft', name: '柔和', shade: dark ? '#c2c2c2' : '#505050' },
                  { id: 'standard', name: '标准', shade: dark ? '#e4e4e4' : '#303030' },
                  { id: 'high', name: '高对比', shade: dark ? '#fff' : '#000' },
                ].map((item) => ({
                  id: item.id,
                  label: item.name,
                  content: (
                    <>
                      <span className="contrast-glyph" style={{ color: item.shade }}>
                        Aa
                      </span>
                      <span>{item.name}</span>
                    </>
                  ),
                }))}
              />
              <div className="settings-section-heading">
                <h3>编辑字体</h3>
                <span>内置字体直接可用，其他字体未安装时自动回退</span>
              </div>
              <Choices
                label="编辑字体"
                className="font-choices"
                value={props.font}
                onChange={props.onFont}
                options={fontOptions.map((font) => ({
                  id: font.id,
                  label: font.name,
                  content: (
                    <>
                      <span className="font-glyph" style={{ fontFamily: editorFonts[font.id] }}>
                        Aa 文
                      </span>
                      <span>
                        <strong>{font.name}</strong>
                        <small>{font.note}</small>
                      </span>
                    </>
                  ),
                }))}
              />
              <label className="font-size-control">
                <span>
                  字号{' '}
                  <strong>
                    {props.fontSize}
                    <small> px</small>
                  </strong>
                </span>
                <input
                  aria-label="编辑器字号"
                  type="range"
                  min={12}
                  max={22}
                  value={props.fontSize}
                  onChange={(e) => props.onFontSize(Number(e.target.value))}
                />
              </label>
            </>
          )}
          {tab === 'about' && <AboutSettings />}
          {tab === 'sync' && props.sync}
          {tab === 'compiler' && (
            <div className="compiler-settings">
              <div className="settings-section-heading">
                <h3>本地编译</h3>
                <span>文稿始终留在当前设备</span>
              </div>
              {props.children}
            </div>
          )}
        </div>
        {!['compiler', 'sync', 'about'].includes(tab) && (
          <aside className="settings-live-preview" aria-label="编辑器实时预览">
            <div className="live-preview-label">
              <span className="live-dot" />
              实时预览
              <span>
                {dark ? '深色' : '浅色'} · {currentPalette.name}
              </span>
            </div>
            <div className="live-editor-window">
              <div className="live-editor-heading">
                <span className="live-file-dot" />
                main.tex<span>LaTeX</span>
              </div>
              <div
                className="live-editor-code"
                style={{
                  fontFamily: editorFonts[props.font],
                  fontSize: props.fontSize,
                  color: resolved.text,
                }}
              >
                <div>
                  <b>1</b>
                  <span data-token="comment" style={{ color: resolved.comment }}>
                    % 一份新的文稿
                  </span>
                </div>
                <div>
                  <b>2</b>
                  <span data-token="keyword" style={{ color: resolved.keyword }}>
                    {'\\documentclass'}
                  </span>
                  <span style={{ color: resolved.punctuation }}>{'{'}</span>
                  <span style={{ color: resolved.string }}>article</span>
                  <span style={{ color: resolved.punctuation }}>{'}'}</span>
                </div>
                <div>
                  <b>3</b>
                  <span data-token="text">这里是正文示例。</span>
                </div>
                <div>
                  <b>4</b>
                  <span style={{ color: resolved.keyword }}>{'\\textbf'}</span>
                  <span style={{ color: resolved.punctuation }}>{'{'}</span>
                  <span style={{ color: resolved.text }}>Hello, Texite</span>
                  <span style={{ color: resolved.punctuation }}>{'}'}</span>
                </div>
                <div>
                  <b>5</b>
                  <span style={{ color: resolved.punctuation }}>$</span>E = mc²
                  <span style={{ color: resolved.punctuation }}>$</span>
                  <span className="live-caret" />
                </div>
              </div>
              <div className="live-editor-footer">
                <span>
                  <Check size={11} />
                  已保存
                </span>
                <span>UTF-8</span>
              </div>
            </div>
            <div
              className="preview-type-specimen"
              style={{ fontFamily: editorFonts[props.font], color: resolved.text }}
            >
              Aa<span>中文预览</span>
              <small>0123456789 · (a + b)²</small>
            </div>
            <p className="settings-preview-note">
              设置即时生效并自动保存。
              <br />
              只改变编辑界面，不影响 PDF 排版。
            </p>
          </aside>
        )}
      </div>
    </div>
  );
}
