import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MessageSquare, Pencil, Trash2 } from 'lucide-react';
import type { AIConversation } from '../core/ai';
import type { AIController } from '../workbench/useAI';
import { Dialog } from './Dialog';

export function AIConversationList({
  ai,
  mode,
  onSelect,
}: {
  ai: AIController;
  mode: 'agent' | 'chat';
  onSelect(): void;
}) {
  const [menu, setMenu] = useState<{ item: AIConversation; x: number; y: number } | null>(null);
  const [action, setAction] = useState<{ item: AIConversation; kind: 'rename' | 'delete' } | null>(
    null,
  );
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const menuElement = useRef<HTMLDivElement>(null);
  const origin = useRef<HTMLButtonElement | null>(null);
  const disabled = ai.busy || ai.loading || saving;
  useEffect(() => {
    if (!menu) return;
    menuElement.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const close = () => setMenu(null);
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Tab') {
        setMenu(null);
        if (e.key === 'Escape') origin.current?.focus();
      }
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', key);
    };
  }, [menu]);
  const openMenu = (item: AIConversation, target: HTMLButtonElement, x: number, y: number) => {
    if (disabled) return;
    origin.current = target;
    setMenu({
      item,
      x: Math.max(8, Math.min(x, innerWidth - 188)),
      y: Math.max(8, Math.min(y, innerHeight - 100)),
    });
  };
  const items = ai.conversations.items
    .filter((c) => c.mode === mode)
    .slice()
    .reverse();
  return (
    <>
      <div className="ai-conversation-list" aria-label="对话列表">
        {!items.length && <p>还没有对话，点击 + 新建。</p>}
        {items.map((c) => (
          <button
            key={c.id}
            aria-label={'打开对话 ' + c.title}
            title={c.title}
            aria-current={ai.conversations.selected[mode] === c.id}
            disabled={disabled}
            onClick={() =>
              void ai
                .selectConversation(c.id)
                .then(onSelect)
                .catch((e) => setError(e.message))
            }
            onContextMenu={(e) => {
              e.preventDefault();
              openMenu(c, e.currentTarget, e.clientX, e.clientY);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
                e.preventDefault();
                const r = e.currentTarget.getBoundingClientRect();
                openMenu(c, e.currentTarget, r.left + 20, r.bottom);
              }
            }}
          >
            <MessageSquare size={14} />
            <span>{c.title}</span>
            <time>{new Date(c.time).toLocaleDateString()}</time>
          </button>
        ))}
        {!action && error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
      </div>
      {menu &&
        createPortal(
          <div
            ref={menuElement}
            className="ai-conversation-menu"
            role="menu"
            aria-label="对话操作"
            style={{ left: menu.x, top: menu.y }}
            onPointerDown={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
              e.preventDefault();
              const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button')];
              buttons[
                (buttons.indexOf(document.activeElement as HTMLButtonElement) +
                  (e.key === 'ArrowDown' ? 1 : buttons.length - 1)) %
                  buttons.length
              ]?.focus();
            }}
          >
            {(['rename', 'delete'] as const).map((kind) => (
              <button
                key={kind}
                role="menuitem"
                disabled={disabled}
                className={kind === 'delete' ? 'destructive' : ''}
                onClick={() => {
                  setName(menu.item.title);
                  setError('');
                  setAction({ item: menu.item, kind });
                  setMenu(null);
                }}
              >
                {kind === 'rename' ? <Pencil size={15} /> : <Trash2 size={15} />}
                {kind === 'rename' ? '重命名' : '删除对话'}
              </button>
            ))}
          </div>,
          document.body,
        )}
      <Dialog
        open={!!action}
        onClose={() => !saving && setAction(null)}
        title={action?.kind === 'delete' ? '删除这条对话？' : '重命名对话'}
        description={
          action?.kind === 'delete'
            ? `将删除「${action.item.title}」的消息及对应撤回记录，无法撤销。已修改的文稿会保留。`
            : '为这条对话设置一个便于查找的名称。'
        }
      >
        <form
          className="ai-conversation-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!action || disabled) return;
            setSaving(true);
            setError('');
            try {
              await ai.editConversation(
                action.item.id,
                action.kind === 'rename' ? name : undefined,
              );
              setAction(null);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setSaving(false);
            }
          }}
        >
          {action?.kind === 'rename' && (
            <label className="form-field">
              对话名称
              <input
                aria-label="对话名称"
                value={name}
                maxLength={100}
                required
                disabled={saving}
                onChange={(e) => setName(e.target.value)}
                onFocus={(e) => e.currentTarget.select()}
              />
            </label>
          )}
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={saving}
              onClick={() => setAction(null)}
            >
              取消
            </button>
            <button
              className="primary-button"
              disabled={disabled || (action?.kind === 'rename' && !name.trim())}
            >
              {saving ? '正在保存…' : action?.kind === 'delete' ? '确认删除' : '保存名称'}
            </button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
