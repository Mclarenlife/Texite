import { useRef, type ReactNode } from 'react';
import { usePreference } from './preferences';
export function SidebarSplit({
  id,
  top,
  bottom,
}: {
  id: string;
  top: ReactNode;
  bottom: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [ratio, setRatio] = usePreference<number>(id, 48);
  const apply = (value: number) => setRatio(Math.max(20, Math.min(80, value)));
  return (
    <div
      className="sidebar-split"
      ref={root}
      style={{ gridTemplateRows: `minmax(0, ${ratio}fr) 7px minmax(0, ${100 - ratio}fr)` }}
    >
      <div className="sidebar-split-region">{top}</div>
      <div
        className="sidebar-horizontal-resizer"
        role="separator"
        aria-label="调整上下栏比例"
        aria-orientation="horizontal"
        aria-valuemin={20}
        aria-valuemax={80}
        aria-valuenow={ratio}
        tabIndex={0}
        onPointerDown={(e) => {
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId) && root.current) {
            const r = root.current.getBoundingClientRect();
            apply(((e.clientY - r.top) / r.height) * 100);
          }
        }}
        onKeyDown={(e) => {
          if (['ArrowUp', 'ArrowDown'].includes(e.key)) {
            e.preventDefault();
            apply(ratio + (e.key === 'ArrowUp' ? -3 : 3));
          }
        }}
      />
      <div className="sidebar-split-region">{bottom}</div>
    </div>
  );
}
