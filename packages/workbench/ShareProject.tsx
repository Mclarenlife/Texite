import { Forward, FolderOutput, FileArchive } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

export function ShareProject({ onSaveAs, onExport }: { onSaveAs(): void; onExport(): void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  function dismiss() {
    setOpen(false);
    trigger.current?.focus();
  }
  return (
    <div
      className="project-share"
      ref={root}
      onBlur={(e) => {
        if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={trigger}
        className="icon-button"
        title="另存为或导出项目"
        aria-label="导出项目"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Forward size={18} />
      </button>
      {open && (
        <div
          role="menu"
          aria-label="项目分享"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              dismiss();
            }
            if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
              e.preventDefault();
              const items = Array.from(e.currentTarget.querySelectorAll('button'));
              const i = items.indexOf(document.activeElement as HTMLButtonElement);
              items[
                e.key === 'Home'
                  ? 0
                  : e.key === 'End'
                    ? items.length - 1
                    : (i + (e.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length
              ]?.focus();
            }
          }}
        >
          <button
            role="menuitem"
            title="保存为项目文件夹"
            onClick={() => {
              dismiss();
              onSaveAs();
            }}
          >
            <FolderOutput size={15} />
            另存为
          </button>
          <button
            role="menuitem"
            title="导出 ZIP 压缩包"
            onClick={() => {
              dismiss();
              onExport();
            }}
          >
            <FileArchive size={15} />
            导出
          </button>
        </div>
      )}
    </div>
  );
}
