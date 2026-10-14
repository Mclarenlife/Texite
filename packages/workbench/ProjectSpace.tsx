import { readProjectCovers } from '../platform/storage';
import { useEffect, useState } from 'react';
import {
  FileText,
  Cloud,
  CloudUpload,
  RefreshCw,
  FolderOpen,
  Info,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { Project } from '../core/model';
import { Dialog } from '../ui/Dialog';

export function ProjectSpace({
  projects,
  archived,
  onOpen,
  onFolder,
  onImport,
  onNew,
  onRename,
  onArchive,
  syncedIds = [],
  syncBusy = false,
  onSync,
  onUpload,
}: {
  projects: Project[];
  archived: string[];
  onOpen(project: Project): void;
  onFolder(): void;
  onImport(): void;
  onNew(): void;
  onRename(project: Project, name: string): Promise<void>;
  onArchive(ids: string[], remove: boolean): Promise<void>;
  syncedIds?: string[];
  syncBusy?: boolean;
  onSync(): Promise<void>;
  onUpload(ids: string[]): Promise<void>;
}) {
  const [covers, setCovers] = useState<Record<string, string>>({});
  useEffect(() => {
    let live = true;
    const refresh = () => {
      void readProjectCovers(projects.map((p) => p.id))
        .then((value) => {
          if (live) setCovers(value);
        })
        .catch(() => {});
    };
    refresh();
    window.addEventListener('texite-cover-updated', refresh);
    return () => {
      live = false;
      window.removeEventListener('texite-cover-updated', refresh);
    };
  }, [projects]);
  const [query, setQuery] = useState(''),
    [trash, setTrash] = useState(false),
    [selected, setSelected] = useState<string[]>([]);
  const [info, setInfo] = useState<Project | null>(null),
    [rename, setRename] = useState<Project | null>(null),
    [name, setName] = useState('');
  const [deleting, setDeleting] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const visible = projects.filter(
    (p) => archived.includes(p.id) === trash && p.name.toLowerCase().includes(query.toLowerCase()),
  );
  const chosen = projects.filter((p) => selected.includes(p.id));
  const toggle = (id: string) =>
    setSelected((ids) => (ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id]));
  const act = async (action: () => Promise<void>, done: () => void) => {
    setBusy(true);
    setError('');
    try {
      await action();
      done();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <header className="space-header">
        <div>
          <span className="space-mark">Texite</span>
          <h1>项目空间</h1>
        </div>
        <div className="space-actions">
          <button
            className="secondary-button"
            disabled={syncBusy || busy}
            title="拉取云端项目到本地"
            onClick={() => void onSync()}
          >
            <RefreshCw size={16} className={syncBusy ? 'spin' : undefined} />
            {syncBusy ? '同步中…' : '同步'}
          </button>
          <button className="secondary-button" onClick={onFolder}>
            <FolderOpen size={16} />
            打开文件夹
          </button>
          <button className="secondary-button" onClick={onImport}>
            <Upload size={16} />
            导入 ZIP
          </button>
          <button className="primary-button" onClick={onNew}>
            <Plus size={16} />
            新建项目
          </button>
        </div>
      </header>
      <div className="space-filter">
        <div className="space-tabs">
          <button
            aria-pressed={!trash}
            onClick={() => {
              setTrash(false);
              setSelected([]);
              setError('');
            }}
          >
            项目
          </button>
          <button
            aria-pressed={trash}
            onClick={() => {
              setTrash(true);
              setSelected([]);
              setError('');
            }}
          >
            最近删除{archived.length ? ` · ${archived.length}` : ''}
          </button>
        </div>
        <label>
          <Search size={16} />
          <input
            aria-label="搜索项目"
            placeholder="搜索项目"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected([]);
            }}
          />
        </label>
        <span>{visible.length} 个项目</span>
      </div>
      <div className="space-selection">
        <label>
          <input
            type="checkbox"
            aria-label="全选项目"
            checked={visible.length > 0 && visible.every((p) => selected.includes(p.id))}
            disabled={busy || !visible.length}
            onChange={(e) => setSelected(e.target.checked ? visible.map((p) => p.id) : [])}
          />
          全选
        </label>
        {!!selected.length && (
          <>
            <span>已选 {selected.length} 项</span>
            {trash ? (
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() =>
                  void act(
                    () => onArchive(selected, false),
                    () => setSelected([]),
                  )
                }
              >
                <RotateCcw size={14} />
                恢复项目
              </button>
            ) : (
              <>
                <button
                  className="secondary-button"
                  disabled={busy || syncBusy}
                  onClick={() => void onUpload(selected)}
                >
                  <CloudUpload size={14} />
                  上传项目
                </button>
                <button
                  className="secondary-button"
                  disabled={busy || chosen.length !== 1}
                  onClick={() => {
                    setRename(chosen[0]);
                    setName(chosen[0].name);
                    setError('');
                  }}
                >
                  <Pencil size={14} />
                  重命名
                </button>
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => {
                    setDeleting(selected);
                    setError('');
                  }}
                >
                  <Trash2 size={14} />
                  删除项目
                </button>
              </>
            )}
            <button
              className="icon-button"
              aria-label="取消项目选择"
              onClick={() => setSelected([])}
            >
              <X size={15} />
            </button>
          </>
        )}
      </div>
      {error && !rename && !deleting.length && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="project-cards">
        {visible.map((p, index) => (
          <article
            className={'project-card' + (selected.includes(p.id) ? ' is-selected' : '')}
            key={p.id}
          >
            <button
              className="project-properties icon-button"
              aria-label={`查看 ${p.name} 属性`}
              title="查看属性"
              onClick={() => setInfo(p)}
            >
              {syncedIds.includes(p.id) ? (
                <Cloud size={16} aria-label="WebDAV 项目" />
              ) : (
                <Info size={16} />
              )}
            </button>
            <input
              className="project-checkbox"
              type="checkbox"
              aria-label={`选择项目 ${p.name}`}
              checked={selected.includes(p.id)}
              disabled={busy}
              onChange={() => toggle(p.id)}
            />
            <button
              className="project-open"
              aria-label={`打开项目 ${p.name}`}
              onClick={(e) => {
                if (trash || e.ctrlKey || e.metaKey || selected.length) toggle(p.id);
                else onOpen(p);
              }}
            >
              <div className={'project-cover cover-' + (index % 3)}>
                {covers[p.id] ? (
                  <img
                    className="project-pdf-cover"
                    src={covers[p.id]}
                    alt={`${p.name} · PDF 首页`}
                  />
                ) : (
                  <>
                    <span className="cover-number">{String(index + 1).padStart(2, '0')}</span>
                    <FileText size={40} />
                    <span>LaTeX</span>
                  </>
                )}
              </div>
              <strong>{p.name}</strong>
              <span>
                {p.files.length} 个文件 ·{' '}
                {p.location?.kind === 'linked'
                  ? '关联文件夹'
                  : window.texite
                    ? '应用项目'
                    : '浏览器项目'}
              </span>
              {p.location && (
                <small className="project-location" title={p.location.directory}>
                  {p.location.directory}
                </small>
              )}
            </button>
          </article>
        ))}
      </div>
      {!visible.length && (
        <div className="space-empty">
          {query
            ? '没有匹配的项目'
            : trash
              ? '最近删除为空'
              : '还没有项目，可新建项目或导入文件夹。'}
        </div>
      )}
      <Dialog open={!!info} onClose={() => setInfo(null)} title="项目属性">
        {info && (
          <dl className="project-attributes">
            <dt>项目名称</dt>
            <dd>{info.name}</dd>
            <dt>存储方式</dt>
            <dd>
              {info.location?.kind === 'linked'
                ? '关联系统文件夹'
                : info.location
                  ? '应用项目目录'
                  : '浏览器本地存储'}
            </dd>
            <dt>文件夹位置</dt>
            <dd>{info.location?.directory || '当前浏览器 · IndexedDB'}</dd>
            <dt>文件</dt>
            <dd>
              {info.files.length} 个文件 · {info.folders?.length || 0} 个文件夹
            </dd>
            <dt>内容大小</dt>
            <dd>
              {(
                info.files.reduce(
                  (n, f) =>
                    n +
                    (f.binary
                      ? Math.floor(f.content.length * 0.75) -
                        (f.content.match(/=+$/)?.[0].length || 0)
                      : new TextEncoder().encode(f.content).length),
                  0,
                ) / 1024
              ).toLocaleString(undefined, { maximumFractionDigits: 1 })}{' '}
              KB
            </dd>
            <dt>主文件</dt>
            <dd>{info.mainFile}</dd>
            <dt>编译引擎</dt>
            <dd>{info.engine}</dd>
            <dt>最近修改</dt>
            <dd>{new Date(info.updatedAt).toLocaleString()}</dd>
          </dl>
        )}
      </Dialog>
      <Dialog
        open={!!rename}
        onClose={() => !busy && setRename(null)}
        title="重命名项目"
        description="只修改项目显示名称，不更改系统文件夹名称。"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (rename && name.trim())
              void act(
                () => onRename(rename, name.trim()),
                () => {
                  setRename(null);
                  setSelected([]);
                },
              );
          }}
        >
          <label className="form-field">
            项目名称
            <input
              aria-label="新项目名称"
              autoFocus
              value={name}
              maxLength={100}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={() => setRename(null)}
            >
              取消
            </button>
            <button className="primary-button" disabled={busy || !name.trim()}>
              保存名称
            </button>
          </div>
        </form>
      </Dialog>
      <Dialog
        open={!!deleting.length}
        onClose={() => !busy && setDeleting([])}
        title={`删除 ${deleting.length} 个项目`}
        description="项目将移到最近删除，源码、历史记录和磁盘文件夹会保留，可随时恢复。"
      >
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button className="secondary-button" disabled={busy} onClick={() => setDeleting([])}>
            取消
          </button>
          <button
            className="primary-button"
            disabled={busy}
            onClick={() =>
              void act(
                () => onArchive(deleting, true),
                () => {
                  setDeleting([]);
                  setSelected([]);
                },
              )
            }
          >
            移到最近删除
          </button>
        </div>
      </Dialog>
    </>
  );
}
