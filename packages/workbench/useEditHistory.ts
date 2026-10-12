import { useEffect, useRef, useState } from 'react';
import { type EditRecord, type RecoveryPoint, limitHistory } from '../core/history';
import { readHistory, readRecoveries, writeHistory } from '../platform/storage';

export function useEditHistory(projectId: string | undefined) {
  const [records, setRecords] = useState<EditRecord[]>([]);
  const [error, setError] = useState('');
  const [recoveries, setRecoveries] = useState<RecoveryPoint[]>([]);
  const recoveryCache = useRef(new Map<string, RecoveryPoint[]>());
  const cache = useRef(new Map<string, EditRecord[]>());
  const pending = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const current = useRef(projectId);
  current.current = projectId;
  const flush = (id: string) => {
    clearTimeout(pending.current.get(id));
    pending.current.delete(id);
    void writeHistory(id, cache.current.get(id) || []).catch(() =>
      setError('历史记录保存失败，请检查本地存储空间。'),
    );
  };
  useEffect(() => {
    const savePending = () => {
      for (const id of pending.current.keys()) flush(id);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') savePending();
    };
    window.addEventListener('pagehide', savePending);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', savePending);
      document.removeEventListener('visibilitychange', onVisibility);
      savePending();
    };
  }, []);
  useEffect(() => {
    setRecords(projectId ? cache.current.get(projectId) || [] : []);
    setRecoveries(projectId ? recoveryCache.current.get(projectId) || [] : []);
    setError('');
    if (!projectId) return;
    let active = true;
    void readRecoveries(projectId)
      .then((saved) => {
        const local = recoveryCache.current.get(projectId) || [];
        const merged = [...local, ...saved.filter((r) => !local.some((l) => l.id === r.id))].sort(
          (a, b) => b.time - a.time,
        );
        recoveryCache.current.set(projectId, merged);
        if (active) setRecoveries(merged);
      })
      .catch(() => active && setError('无法读取恢复备份。'));
    void readHistory(projectId)
      .then((saved) => {
        const local = cache.current.get(projectId) || [];
        const merged = limitHistory(
          [...local, ...saved.filter((r) => !local.some((l) => l.id === r.id))].sort(
            (a, b) => b.time - a.time,
          ),
        );
        cache.current.set(projectId, merged);
        if (active) setRecords(merged);
      })
      .catch(() => active && setError('无法读取此项目的历史记录。'));
    return () => {
      active = false;
      if (pending.current.has(projectId)) flush(projectId);
    };
  }, [projectId]);
  function record(path: string, before: string, after: string) {
    const id = current.current;
    if (!id || before === after) return;
    const list = cache.current.get(id) || [],
      latest = list[0],
      now = Date.now();
    const merge = latest?.path === path && latest.after === before && now - latest.time < 1500;
    const entry: EditRecord = merge
      ? { ...latest, after, time: now }
      : { id: crypto.randomUUID(), path, before, after, time: now, startedAt: now };
    const next = limitHistory([entry, ...(merge ? list.slice(1) : list)]);
    cache.current.set(id, next);
    setRecords(next);
    if (!next.some((r) => r.id === entry.id) && entry.before !== entry.after)
      setError('本次修改超过历史容量限制；源码仍正常保存。');
    clearTimeout(pending.current.get(id));
    pending.current.set(
      id,
      setTimeout(() => flush(id), 400),
    );
  }
  function rememberRecovery(point: RecoveryPoint) {
    const next = [point, ...(recoveryCache.current.get(point.projectId) || [])];
    recoveryCache.current.set(point.projectId, next);
    if (current.current === point.projectId) setRecoveries(next);
  }
  return { records, recoveries, rememberRecovery, record, error };
}
