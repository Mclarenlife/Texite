import { useEffect, useMemo, useRef } from 'react';
import { lineDiff, type EditRecord } from '../core/history';
export function HistoryReview({
  record,
  onClose,
  onRestore,
  canRestore,
}: {
  record: EditRecord;
  onClose: () => void;
  onRestore: () => void;
  canRestore: boolean;
}) {
  return (
    <div className="history-review" aria-label="修改内容对比">
      <div className="history-review-heading">
        <div>
          <strong>{record.path}</strong>
          <small>
            {new Date(record.time).toLocaleString('zh-CN', { hour12: false })} ·{' '}
            {record.kind === 'recovery' ? '恢复前备份（单独保留）' : '当时的修改'}
          </small>
        </div>
        <button className="secondary-button" onClick={onClose}>
          返回编辑
        </button>
      </div>
      <div className="history-restore-bar">
        <span>
          {record.kind === 'recovery'
            ? '这个备份保留了恢复操作前的内容。'
            : '可以恢复此文件到这次修改之前。'}
        </span>
        <button className="secondary-button" disabled={!canRestore} onClick={onRestore}>
          {record.kind === 'recovery' ? '恢复到备份版本' : '恢复到修改前'}
        </button>
      </div>
      <DiffLines before={record.before} after={record.after} />
    </div>
  );
}
export function DiffLines({ before, after }: { before: string; after: string }) {
  const lines = useMemo(() => lineDiff(before, after), [before, after]);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const first = root.current?.querySelector<HTMLElement>('[data-changed="true"]');
    if (first && root.current)
      root.current.scrollTop = first.offsetTop - root.current.offsetTop - 60;
  }, [before, after]);
  return (
    <>
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
    </>
  );
}
