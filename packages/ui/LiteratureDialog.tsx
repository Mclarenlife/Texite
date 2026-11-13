import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, X } from 'lucide-react';
import {
  bibDestinations,
  discoverPapers,
  doiLink,
  manuscript,
  bibliographyIndex,
  indexedPaper,
  validateSearchFilters,
  type LiteratureCursor,
  type Paper,
} from '../core/literature';
import type { Project } from '../core/model';
import type { AIController } from '../workbench/useAI';
import type { LiteratureMode } from './LiteratureSettings';
import { WindowResizeHandles } from './WindowResizeHandles';
import type { WindowRect } from './resizeAI';
import { Select } from './Select';
import './literature.css';

function fit(rect: WindowRect) {
  const width = Math.min(rect.width, innerWidth - 16),
    height = Math.min(rect.height, innerHeight - 16);
  return {
    width,
    height,
    left: Math.max(8, Math.min(rect.left, innerWidth - width - 8)),
    top: Math.max(8, Math.min(rect.top, innerHeight - height - 8)),
  };
}
export function newLiteratureSession() {
  return {
    stage: 'filters' as 'filters' | 'results',
    topic: '',
    count: '8',
    from: '',
    to: '',
    source: '',
    cursor: undefined as LiteratureCursor | undefined,
    results: [] as Paper[],
    removed: [] as Paper[],
    selected: [] as string[],
    path: '',
    message: '',
  };
}
export type LiteratureSession = ReturnType<typeof newLiteratureSession>;

export function LiteratureDialog({
  project,
  ai,
  mode,
  onClose,
  onSettings,
  onSave,
  visible,
  session,
  onChange,
}: {
  project: Project;
  ai: AIController;
  mode: LiteratureMode;
  onClose(): void;
  onSettings(): void;
  onSave(path: string, papers: Paper[]): Promise<void>;
  visible: boolean;
  session: LiteratureSession;
  onChange(change: (s: LiteratureSession) => LiteratureSession): void;
}) {
  const paths = bibDestinations(project);
  const { path, results, selected, topic, stage, cursor } = session;
  const patch = (values: Partial<LiteratureSession>) => onChange((s) => ({ ...s, ...values }));
  const destination = paths.includes(path) ? path : paths[0];
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const request = useRef<AbortController | null>(null);
  const [rect, setRect] = useState(() =>
    fit({ width: 600, height: Math.min(680, innerHeight * 0.82), left: innerWidth - 624, top: 64 }),
  );
  const panel = useRef<HTMLElement>(null);
  const drag = useRef<{ id: number; x: number; y: number; rect: WindowRect } | null>(null);
  useEffect(() => {
    if (visible) panel.current?.focus({ preventScroll: true });
    const resize = () => setRect((r) => fit(r));
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [visible]);
  const latestFiles = useRef(project.files);
  latestFiles.current = project.files;
  const configured = mode === 'cli' ? !!window.texite?.literature : !!ai.chatConfig.model;
  useEffect(
    () => () => {
      request.current?.abort();
      request.current = null;
    },
    [],
  );
  async function run(continuing: boolean) {
    if (!configured || request.current || saving) return;
    const filters = { count: Number(session.count), from: session.from, to: session.to };
    setError('');
    try {
      validateSearchFilters(filters);
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    const timer = setTimeout(() => controller.abort('timeout'), 240000);
    const source = continuing ? session.source : topic.trim() || manuscript(project);
    setStatus('正在检索…');
    try {
      const batch = await discoverPapers(
        source,
        (prompt, data, signal) => ai.askLiterature(mode, prompt, data, signal),
        controller.signal,
        setStatus,
        fetch,
        {
          filters,
          files: project.files,
          excluded: continuing ? [...results, ...session.removed] : [],
          cursor: continuing ? cursor : undefined,
        },
      );
      controller.signal.throwIfAborted();
      const index = bibliographyIndex(latestFiles.current);
      const papers = batch.papers.filter((p) => !indexedPaper(p, index));
      onChange((s) => ({
        ...s,
        source,
        stage: 'results',
        cursor: batch.cursor,
        results: [...(continuing ? s.results : []), ...papers],
        message: papers.length ? '' : '本批没有找到符合条件的新文献。',
      }));
    } catch (e) {
      if (request.current === controller)
        setError(controller.signal.aborted ? '检索超时，请稍后重试。' : (e as Error).message);
    } finally {
      clearTimeout(timer);
      if (request.current === controller) {
        request.current = null;
        setStatus('');
      }
    }
  }
  if (!visible) return null;
  const busy = !!status || saving;
  const exhausted = cursor?.exhausted && !cursor.pending.length;
  return (
    <section
      role="dialog"
      aria-label="智能检索"
      tabIndex={-1}
      className="literature-window"
      ref={panel}
      style={rect}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !e.defaultPrevented && !saving) {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <header className="literature-heading">
        <div
          className="literature-grip"
          tabIndex={0}
          aria-label="移动智能检索窗口"
          onPointerDown={(e) => {
            if (e.button !== 0 || !e.isPrimary) return;
            drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, rect };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (d?.id === e.pointerId)
              setRect(
                fit({
                  ...d.rect,
                  left: d.rect.left + e.clientX - d.x,
                  top: d.rect.top + e.clientY - d.y,
                }),
              );
          }}
          onLostPointerCapture={() => {
            drag.current = null;
          }}
          onKeyDown={(e) => {
            if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
            e.preventDefault();
            setRect((r) =>
              fit({
                ...r,
                left: r.left + (e.key === 'ArrowLeft' ? -20 : e.key === 'ArrowRight' ? 20 : 0),
                top: r.top + (e.key === 'ArrowUp' ? -20 : e.key === 'ArrowDown' ? 20 : 0),
              }),
            );
          }}
        >
          <h2>智能检索</h2>
        </div>
        <button
          className="text-button"
          disabled={busy}
          onClick={
            stage === 'filters'
              ? onSettings
              : () => {
                  setError('');
                  patch({
                    stage: 'filters',
                    cursor: undefined,
                    results: [],
                    selected: [],
                    removed: [],
                    message: '',
                  });
                }
          }
        >
          {stage === 'filters' ? '检索设置' : '重新检索'}
        </button>
        <button
          className="icon-button"
          aria-label="关闭智能检索"
          disabled={saving}
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </header>
      <div className="literature-tools">
        <small>{mode === 'cli' ? '本机 CLI' : ai.chatConfig.model || 'API'} · Crossref</small>
      </div>
      {stage === 'filters' && (
        <form
          className="literature-filters"
          onSubmit={(e) => {
            e.preventDefault();
            void run(false);
          }}
        >
          <fieldset disabled={busy}>
            <label>
              研究主题
              <input
                placeholder="留空时从文稿提取"
                maxLength={500}
                value={topic}
                onChange={(e) => patch({ topic: e.target.value })}
              />
            </label>
            <label>
              检索篇数
              <input
                type="number"
                min="1"
                max="30"
                step="1"
                required
                value={session.count}
                onChange={(e) => patch({ count: e.target.value })}
              />
            </label>
            <div>
              <span>发表时间范围</span>
              <div className="literature-years">
                <input
                  type="number"
                  aria-label="起始年份"
                  placeholder="不限起始年份"
                  min="1000"
                  max="9999"
                  value={session.from}
                  onChange={(e) => patch({ from: e.target.value })}
                />
                <span>至</span>
                <input
                  type="number"
                  aria-label="结束年份"
                  placeholder="不限结束年份"
                  min={session.from || '1000'}
                  max="9999"
                  value={session.to}
                  onChange={(e) => patch({ to: e.target.value })}
                />
              </div>
            </div>
            <button className="primary-button" disabled={!configured}>
              开始检索
            </button>
          </fieldset>
        </form>
      )}
      {stage === 'results' && session.message && <p role="status">{session.message}</p>}
      {!configured ? (
        <p>请先在检索设置中配置 AI，再检索当前文章。</p>
      ) : (
        status && (
          <p className="literature-status" role="status">
            {status.endsWith('…') && <LoaderCircle size={16} className="spin" />}
            {status}
          </p>
        )
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!!results.length && (
        <div className="paper-list">
          {results.map((p) => (
            <label key={p.doi} className="paper-card" data-selected={selected.includes(p.doi)}>
              <input
                type="checkbox"
                aria-label={p.title}
                checked={selected.includes(p.doi)}
                disabled={busy}
                onChange={(e) =>
                  patch({
                    selected: e.target.checked
                      ? [...selected, p.doi]
                      : selected.filter((d) => d !== p.doi),
                  })
                }
              />
              <div>
                <strong>{p.title}</strong>
                <small>
                  {p.authors.join(' · ') || '作者未登记'}
                  {p.year && ' · ' + p.year}
                </small>
                <p>{p.summary}</p>
                <small className="paper-doi">{doiLink(p.doi)}</small>
              </div>
            </label>
          ))}
        </div>
      )}
      {stage === 'results' && (
        <div className="literature-footer">
          <label>
            保存到
            <Select
              aria-label="保存到 Bib 文件"
              value={destination}
              disabled={saving}
              onValueChange={(path) => patch({ path })}
            >
              {paths.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </Select>
          </label>
          <div className="literature-actions">
            {selected.length > 0 && (
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => {
                  onChange((s) => ({
                    ...s,
                    removed: [...s.removed, ...s.results.filter((p) => s.selected.includes(p.doi))],
                    results: s.results.filter((p) => !s.selected.includes(p.doi)),
                    selected: [],
                    message: '',
                  }));
                }}
              >
                删除所选
              </button>
            )}
            <button
              className="secondary-button"
              title={exhausted ? '已检索完当前条件下的候选文献' : undefined}
              disabled={busy || !configured || exhausted}
              onClick={() => void run(true)}
            >
              继续检索
            </button>
            <button
              className="primary-button"
              disabled={busy || !selected.length}
              onClick={async () => {
                setSaving(true);
                setError('');
                try {
                  await onSave(
                    destination,
                    results.filter((p) => selected.includes(p.doi)),
                  );
                  patch({ selected: [] });
                  onClose();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setSaving(false);
                }
              }}
            >
              {saving ? '保存中…' : '保存所选（' + selected.length + '）'}
            </button>
          </div>
        </div>
      )}
      <WindowResizeHandles name="智能检索" panel={panel} onResize={setRect} />
    </section>
  );
}
