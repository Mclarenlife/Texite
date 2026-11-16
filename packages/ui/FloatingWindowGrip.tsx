import { useRef, type Dispatch, type SetStateAction } from 'react';
import type { WindowRect } from './resizeAI';
export function fit(rect: WindowRect) {
  const width = Math.min(rect.width, innerWidth - 16),
    height = Math.min(rect.height, innerHeight - 16);
  return {
    width,
    height,
    left: Math.max(8, Math.min(rect.left, innerWidth - width - 8)),
    top: Math.max(8, Math.min(rect.top, innerHeight - height - 8)),
  };
}
export function FloatingWindowGrip({
  title,
  rect,
  setRect,
}: {
  title: string;
  rect: WindowRect;
  setRect: Dispatch<SetStateAction<WindowRect>>;
}) {
  const drag = useRef<{ id: number; x: number; y: number; rect: WindowRect } | null>(null);
  return (
    <div
      className="literature-grip"
      tabIndex={0}
      aria-label={'移动' + title + '窗口'}
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
      <h2>{title}</h2>
    </div>
  );
}
