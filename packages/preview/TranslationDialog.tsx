import { useEffect, useState } from 'react';
import { Dialog } from '../ui/Dialog';
import { TranslationSettings } from '../ui/TranslationSettings';
import { translationAPI } from '../platform/translation';
import { providers, languages } from '../../apps/desktop/translation.mjs';

export function TranslationDialog({ text, onClose }: { text: string; onClose(): void }) {
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
  return (
    <Dialog open title="选区翻译" onClose={onClose} className="translation-dialog">
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
    </Dialog>
  );
}
