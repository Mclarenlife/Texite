import { useState } from 'react';
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
import { getOutline } from '../core/model';

export function Outline({ source, onJump }: { source: string; onJump(position: number): void }) {
  const items = getOutline(source);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const parents = items.filter((item, i) => items[i + 1]?.level > item.level);
  const allCollapsed = parents.length > 0 && parents.every((item) => collapsed.has(item.position));
  let hiddenBelow = Infinity;
  return (
    <>
      <div className="outline-heading">
        <span>文档脉络</span>
        <button
          className="icon-button"
          title={allCollapsed ? '展开全部标题' : '折叠全部标题'}
          aria-label={allCollapsed ? '展开全部标题' : '折叠全部标题'}
          disabled={!parents.length}
          onClick={() =>
            setCollapsed(allCollapsed ? new Set() : new Set(parents.map((item) => item.position)))
          }
        >
          {allCollapsed ? <ChevronsUpDown size={14} /> : <ChevronsDownUp size={14} />}
        </button>
      </div>
      <div className="outline-list outline-tree">
        {items.map((item, i) => {
          if (item.level > hiddenBelow) return null;
          hiddenBelow = collapsed.has(item.position) ? item.level : Infinity;
          const hasChildren = items[i + 1]?.level > item.level;
          return (
            <div
              className="outline-row"
              key={item.position}
              style={{ paddingLeft: (item.level - 1) * 12 }}
            >
              {hasChildren ? (
                <button
                  className="outline-toggle"
                  aria-label={`${collapsed.has(item.position) ? '展开' : '折叠'} ${item.title}`}
                  aria-expanded={!collapsed.has(item.position)}
                  onClick={() =>
                    setCollapsed((old) => {
                      const next = new Set(old);
                      next.has(item.position)
                        ? next.delete(item.position)
                        : next.add(item.position);
                      return next;
                    })
                  }
                >
                  {collapsed.has(item.position) ? (
                    <ChevronRight size={12} />
                  ) : (
                    <ChevronDown size={12} />
                  )}
                </button>
              ) : (
                <span className="outline-leaf" />
              )}
              <button
                className="outline-title"
                title={item.title}
                onClick={() => onJump(item.position)}
              >
                {item.title}
              </button>
            </div>
          );
        })}
        {!items.length && <p className="sidebar-empty">章节标题会出现在这里。</p>}
      </div>
    </>
  );
}
