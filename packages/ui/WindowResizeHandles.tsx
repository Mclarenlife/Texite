import { useRef, type RefObject } from 'react';
import { resizeAI, type WindowRect } from './resizeAI';
export function WindowResizeHandles({
  name,
  panel,
  onResize,
}: {
  name: string;
  panel: RefObject<HTMLElement | null>;
  onResize(next: WindowRect): void;
}) {
  const resizing = useRef<(WindowRect & { x: number; y: number }) | null>(null);
  return Object.entries({
    n: '上边',
    s: '下边',
    w: '左边',
    e: '右边',
    nw: '左上角',
    ne: '右上角',
    sw: '左下角',
    se: '右下角',
  }).map(([edge, label]) => (
    <div
      key={edge}
      className={'ai-resize-edge ai-resize-' + edge}
      role="separator"
      aria-label={'调整 ' + name + ' 窗口大小 · ' + label}
      tabIndex={0}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        const r = panel.current!.getBoundingClientRect();
        resizing.current = {
          x: e.clientX,
          y: e.clientY,
          left: r.left,
          top: r.top,
          width: r.width,
          height: r.height,
        };
      }}
      onPointerMove={(e) => {
        const start = resizing.current;
        if (!start) return;
        const next = resizeAI(
          start,
          edge,
          e.clientX - start.x,
          e.clientY - start.y,
          window.innerWidth,
          window.innerHeight,
        );
        onResize(next);
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
        const next = resizeAI(
          panel.current!.getBoundingClientRect(),
          edge,
          e.key === 'ArrowLeft' ? -20 : e.key === 'ArrowRight' ? 20 : 0,
          e.key === 'ArrowUp' ? -20 : e.key === 'ArrowDown' ? 20 : 0,
          window.innerWidth,
          window.innerHeight,
        );
        onResize(next);
      }}
    />
  ));
}
