import { useEffect, useMemo, useRef } from 'react';
import { lineDiff, type EditRecord } from '../core/history';
export function HistoryReview({ record, onClose }: { record: EditRecord; onClose: () => void }) {
  const lines = useMemo(() => lineDiff(record.before, record.after), [record]);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    root.current?.querySelector('[data-changed="true"]')?.scrollIntoView({ block: 'center' });
  }, [record.id]);
  return (
    <div className="history-review" aria-label="修改内容对比">
      <div className="history-review-heading">
        <div>
          <strong>{record.path}</strong>
          <small>
            {new Date(record.time).toLocaleString('zh-CN', { hour12: false })} · 当时的修改
          </small>
        </div>
        <button className="secondary-button" onClick={onClose}>
          返回编辑
        </button>
      </div>
      <div className="diff-legend">
        <span>原行号 / 新行号</span>
        <ins>＋ 新增</ins>
        <del>− 删除</del>
      </div>
      <div className="diff-scroll" ref={root}>
        {lines.map((line, i) => (
          <div
            key={i}
            className={'diff-line diff-' + line.kind}
            data-changed={line.kind !== 'same'}
          >
            <span>{line.oldLine ?? ''}</span>
            <span>{line.newLine ?? ''}</span>
            <b>{line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ' '}</b>
            <pre>
              {line.kind === 'removed' ? (
                <del>{line.text || ' '}</del>
              ) : line.kind === 'added' ? (
                <ins>{line.text || ' '}</ins>
              ) : (
                line.text || ' '
              )}
            </pre>
          </div>
        ))}
      </div>
    </div>
  );
}
