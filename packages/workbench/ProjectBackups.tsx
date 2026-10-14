import { useEffect, useState } from 'react';
import { Plus, RotateCcw, Trash2 } from 'lucide-react';
import type { Project } from '../core/model';
import { Dialog } from '../ui/Dialog';
import {
  createProjectBackup,
  deleteProjectBackup,
  readProjectBackups,
  type ProjectBackup,
} from '../platform/storage';
export function ProjectBackups({
  project,
  onPrepare,
  onRestore,
}: {
  project: Project;
  onPrepare(): Promise<Project>;
  onRestore(backup: ProjectBackup): Promise<void>;
}) {
  const [items, setItems] = useState<ProjectBackup[]>([]),
    [adding, setAdding] = useState(false),
    [note, setNote] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const reload = () => readProjectBackups(project.id).then(setItems);
  useEffect(() => {
    let active = true;
    setItems([]);
    setError('');
    setMenu(null);
    setAdding(false);
    void readProjectBackups(project.id)
      .then((v) => active && setItems(v))
      .catch((e) => active && setError(e.message));
    return () => {
      active = false;
    };
  }, [project.id]);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', close);
    };
  }, [menu]);
  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="sidebar-section-title">
        <strong>备份历史</strong>
        <button
          className="icon-button"
          title="备份当前项目"
          aria-label="备份当前项目"
          disabled={busy}
          onClick={() => {
            setNote('');
            setAdding(true);
          }}
        >
          <Plus size={15} />
        </button>
      </div>
      <div className="project-backups" aria-busy={busy}>
        {!items.length && <p className="sidebar-empty">备份整个项目，随时还原。</p>}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {items.map((b) => (
          <div
            className="backup-row"
            key={b.id}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({
                id: b.id,
                x: Math.min(e.clientX, window.innerWidth - 160),
                y: Math.min(e.clientY, window.innerHeight - 60),
              });
            }}
          >
            <div>
              <time>{new Date(b.time).toLocaleString('zh-CN', { hour12: false })}</time>
              <strong>{b.note || '项目备份'}</strong>
              <small>{b.project.files.length} 个文件</small>
            </div>
            <button
              className="icon-button"
              aria-label={'还原备份 ' + (b.note || new Date(b.time).toLocaleString())}
              title="还原 · 自动备份当前版本"
              disabled={busy}
              onClick={() => void act(() => onRestore(b))}
            >
              <RotateCcw size={15} />
            </button>
          </div>
        ))}
      </div>
      {menu && (
        <div
          className="backup-context-menu"
          role="menu"
          style={{ left: menu.x, top: menu.y }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            role="menuitem"
            disabled={busy}
            onClick={() => {
              const id = menu.id;
              setMenu(null);
              void act(() => deleteProjectBackup(project.id, id));
            }}
          >
            <Trash2 size={14} />
            删除备份
          </button>
        </div>
      )}
      <Dialog
        open={adding}
        onClose={() => !busy && setAdding(false)}
        title="备份当前项目"
        description="包含源码、图片和项目文件夹。"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void act(async () => {
              await createProjectBackup(await onPrepare(), note);
              setAdding(false);
            });
          }}
        >
          <label className="form-field">
            备份备注
            <input
              aria-label="备份备注"
              autoFocus
              maxLength={200}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="例如：提交前的版本"
            />
          </label>
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button className="primary-button" disabled={busy}>
              保存备份
            </button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
