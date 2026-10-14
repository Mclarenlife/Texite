import { useCallback, useEffect, useRef, useState } from 'react';
import { type EditRecord, type RecoveryPoint, limitHistory } from '../core/history';
import {
  readHistory,
  readRecoveries,
  writeHistory,
  clearProjectHistory,
} from '../platform/storage';

export function useEditHistory(projectId: string | undefined) {
  const [records, setRecords] = useState<EditRecord[]>([]);
  const [error, setError] = useState('');
  const [recoveries, setRecoveries] = useState<RecoveryPoint[]>([]);
  const recoveryCache = useRef(new Map<string, RecoveryPoint[]>());
  const cache = useRef(new Map<string, EditRecord[]>());
  const pending = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const writes = useRef(new Map<string, Promise<void>>());
  const reads = useRef(new Map<string, Promise<unknown>>());
  const current = useRef(projectId);
  current.current = projectId;
  const flush = useCallback((id: string) => {
    if (!pending.current.has(id)) return writes.current.get(id) || Promise.resolve();
    clearTimeout(pending.current.get(id));
    pending.current.delete(id);
    const snapshot = cache.current.get(id) || [];
    const task = (writes.current.get(id) || Promise.resolve())
      .then(() => writeHistory(id, snapshot))
      .catch(() => setError('历史记录保存失败，请检查本地存储空间。'));
    writes.current.set(id, task);
    void task.finally(() => {
      if (writes.current.get(id) === task) writes.current.delete(id);
    });
    return task;
  }, []);
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
    const recoveryRead = readRecoveries(projectId)
      .then((saved) => {
        const local = recoveryCache.current.get(projectId) || [];
        const merged = [...local, ...saved.filter((r) => !local.some((l) => l.id === r.id))].sort(
          (a, b) => b.time - a.time,
        );
        recoveryCache.current.set(projectId, merged);
        if (active) setRecoveries(merged);
      })
      .catch(() => active && setError('无法读取恢复备份。'));
    const historyRead = readHistory(projectId)
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
    reads.current.set(projectId, Promise.all([recoveryRead, historyRead]));
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
  async function clear(from: number, to: number) {
    const id = current.current;
    if (!id) return;
    await reads.current.get(id);
    await flush(id);
    const next = (cache.current.get(id) || []).filter((r) => r.time < from || r.time > to);
    await clearProjectHistory(id, next, from, to);
    cache.current.set(id, next);
    const retained = (recoveryCache.current.get(id) || []).filter(
      (r) => r.time < from || r.time > to,
    );
    recoveryCache.current.set(id, retained);
    if (current.current === id) {
      setRecords(next);
      setRecoveries(retained);
    }
  }
  return { records, recoveries, rememberRecovery, record, error, flush, clear };
}
