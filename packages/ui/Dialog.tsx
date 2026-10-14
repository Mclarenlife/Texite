import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X, Grip } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  wide = false,
  className = '',
  onEscapeKeyDown,
  resizable = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  wide?: boolean;
  className?: string;
  onEscapeKeyDown?: (event: KeyboardEvent) => void;
  resizable?: boolean;
}) {
  const descriptionId = useId();
  const content = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const resizing = useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const fit = (b: NonNullable<typeof box>) => ({
    left: Math.max(16, Math.min(b.left, innerWidth - Math.min(b.width, innerWidth - 32) - 16)),
    top: Math.max(16, Math.min(b.top, innerHeight - Math.min(b.height, innerHeight - 32) - 16)),
    width: Math.max(Math.min(400, innerWidth - 32), Math.min(b.width, innerWidth - 32)),
    height: Math.max(Math.min(280, innerHeight - 32), Math.min(b.height, innerHeight - 32)),
  });
  useEffect(() => {
    const resize = () => setBox((b) => (b ? fit(b) : null));
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="dialog-overlay" />
        <DialogPrimitive.Content
          ref={content}
          className={
            'dialog-content' +
            (wide ? ' wide' : '') +
            (resizable ? ' resizable-dialog' : '') +
            ' ' +
            className
          }
          style={resizable && box ? { ...box, transform: 'none' } : undefined}
          onEscapeKeyDown={onEscapeKeyDown}
          aria-describedby={description ? descriptionId : undefined}
        >
          <div className="dialog-heading">
            <DialogPrimitive.Title>{title}</DialogPrimitive.Title>
            <DialogPrimitive.Close className="icon-button" aria-label="关闭弹窗">
              <X size={18} />
            </DialogPrimitive.Close>
          </div>
          {description && (
            <DialogPrimitive.Description id={descriptionId} className="dialog-description">
              {description}
            </DialogPrimitive.Description>
          )}
          {children}
          {resizable && (
            <div
              className="dialog-resize-handle"
              role="separator"
              aria-label="调整差异窗口大小"
              tabIndex={0}
              onPointerDown={(e) => {
                e.preventDefault();
                const r = content.current!.getBoundingClientRect();
                const b = { left: r.left, top: r.top, width: r.width, height: r.height };
                setBox(b);
                resizing.current = { ...b, x: e.clientX, y: e.clientY };
                e.currentTarget.setPointerCapture(e.pointerId);
              }}
              onPointerMove={(e) => {
                const r = resizing.current;
                if (!r) return;
                setBox(
                  fit({
                    ...r,
                    width: Math.min(innerWidth - r.left - 16, r.width + e.clientX - r.x),
                    height: Math.min(innerHeight - r.top - 16, r.height + e.clientY - r.y),
                  }),
                );
              }}
              onPointerUp={(e) => {
                resizing.current = null;
                e.currentTarget.releasePointerCapture(e.pointerId);
              }}
              onPointerCancel={() => {
                resizing.current = null;
              }}
              onKeyDown={(e) => {
                if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
                e.preventDefault();
                const r = content.current!.getBoundingClientRect();
                setBox(
                  fit({
                    left: r.left,
                    top: r.top,
                    width:
                      r.width + (e.key === 'ArrowLeft' ? -20 : e.key === 'ArrowRight' ? 20 : 0),
                    height: r.height + (e.key === 'ArrowUp' ? -20 : e.key === 'ArrowDown' ? 20 : 0),
                  }),
                );
              }}
            >
              <Grip size={13} />
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
