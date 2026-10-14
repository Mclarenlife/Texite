import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Dialog } from './Dialog';
import type { CleanupKind } from '../platform/storage';
const choices: { kind: CleanupKind; title: string; description: string }[] = [
  {
    kind: 'backups',
    title: '清空备份',
    description: '所有项目的手动备份、操作前自动备份及本机 WebDAV 同步备份。',
  },
  { kind: 'history', title: '清空修改历史', description: '所有项目的修改历史及对应的文件恢复点。' },
  {
    kind: 'ai',
    title: '清空 AI 对话记录',
    description: '所有项目的 Agent、Codex 对话和 API 对话记录，包括 Agent 修改的撤回记录。',
  },
];
export function StorageCleanup({ onCleanup }: { onCleanup(kind: CleanupKind): Promise<void> }) {
  const [kind, setKind] = useState<CleanupKind | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const selected = choices.find((c) => c.kind === kind);
  return (
    <section className="storage-cleanup">
      <h3>清理存储空间</h3>
      <p>作用于本机所有项目（含最近删除）。项目源码、资源文件和云端项目保持不变。</p>
      {choices.map((c) => (
        <div className="cleanup-row" key={c.kind}>
          <div>
            <strong>{c.title}</strong>
            <small>{c.description}</small>
          </div>
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() => {
              setKind(c.kind);
              setError('');
              setMessage('');
            }}
          >
            <Trash2 size={14} />
            {c.title}
          </button>
        </div>
      ))}
      {message && <p role="status">{message}</p>}
      <Dialog
        open={!!selected}
        onClose={() => !busy && setKind(null)}
        title={selected ? selected.title + '？' : '清理记录'}
        description="此操作无法撤销，请确认清理范围。"
      >
        <p className="cleanup-confirm">
          {selected?.description}
          {kind === 'ai' ? '已应用的 AI 修改会保留，之后的对话将从新上下文开始。' : ''}
        </p>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button className="secondary-button" disabled={busy} onClick={() => setKind(null)}>
            取消
          </button>
          <button
            className="primary-button"
            disabled={busy}
            onClick={async () => {
              if (!kind || busy) return;
              setBusy(true);
              setError('');
              try {
                await onCleanup(kind);
                setMessage('清理完成。');
                setKind(null);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? '正在清理…' : '确认清空'}
          </button>
        </div>
      </Dialog>
    </section>
  );
}
