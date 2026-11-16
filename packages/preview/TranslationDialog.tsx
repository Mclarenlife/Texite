import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { fit, FloatingWindowGrip } from '../ui/FloatingWindowGrip';
import { WindowResizeHandles } from '../ui/WindowResizeHandles';
import '../ui/literature.css';
import { TranslationSettings } from '../ui/TranslationSettings';
import { translationAPI } from '../platform/translation';
import { providers, languages } from '../../apps/desktop/translation.mjs';

export function TranslationDialog({ text, onClose }: { text: string; onClose(): void }) {
  const panel = useRef<HTMLElement>(null);
  const [rect, setRect] = useState(() =>
    fit({ width: 460, height: 420, left: innerWidth - 484, top: 72 }),
  );
  useEffect(() => {
    panel.current?.focus({ preventScroll: true });
    const resize = () => setRect((r) => fit(r));
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  const [editing, setEditing] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState('');
  const [error, setError] = useState('');
  const [label, setLabel] = useState('');
  useEffect(() => {
    if (editing) return;
    const api = translationAPI(),
      id = crypto.randomUUID();
    let live = true,
      started = false;
    setResult('');
    setError('');
    setLabel('');
    void (async () => {
      const config = await api.get();
      if (!live) return;
      if (!config.url) {
        setEditing(true);
        return;
      }
      setLabel(providers[config.provider] + ' · ' + languages[config.target]);
      started = true;
      const value = await api.translate(id, text);
      if (live) setResult(value);
    })().catch((e) => {
      if (live) setError(e.message);
    });
    return () => {
      live = false;
      if (started) void Promise.resolve(api.cancel(id)).catch(() => {});
    };
  }, [text, editing, attempt]);
  return createPortal(
    <section
      role="dialog"
      aria-label="选区翻译"
      tabIndex={-1}
      ref={panel}
      style={rect}
      className="literature-window translation-dialog"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !e.defaultPrevented) {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <header className="literature-heading">
        <FloatingWindowGrip title="选区翻译" rect={rect} setRect={setRect} />
        <button className="icon-button" aria-label="关闭弹窗" onClick={onClose}>
          <X size={18} />
        </button>
      </header>
      <div className="translation-body">
        <blockquote>{text}</blockquote>
        {editing ? (
          <TranslationSettings onSaved={() => setEditing(false)} />
        ) : (
          <>
            {label && <small>{label}</small>}
            {error ? (
              <p role="alert">{error}</p>
            ) : (
              <div className="translation-output" role="status">
                {result || '正在翻译…'}
              </div>
            )}
            <div className="translation-actions">
              <button className="secondary-button" onClick={() => setEditing(true)}>
                翻译设置
              </button>
              {error && (
                <button className="secondary-button" onClick={() => setAttempt((n) => n + 1)}>
                  重试
                </button>
              )}
            </div>
          </>
        )}
      </div>
      <WindowResizeHandles name="选区翻译" panel={panel} onResize={setRect} />
    </section>,
    document.body,
  );
}
