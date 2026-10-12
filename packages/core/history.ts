export type EditRecord = {
  id: string;
  path: string;
  before: string;
  after: string;
  time: number;
  startedAt: number;
};
export type DiffLine = {
  kind: 'same' | 'added' | 'removed';
  text: string;
  oldLine?: number;
  newLine?: number;
};

export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before ? before.split('\n') : [],
    b = after ? after.split('\n') : [];
  let prefix = 0,
    suffix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  )
    suffix++;
  const x = a.slice(prefix, a.length - suffix),
    y = b.slice(prefix, b.length - suffix);
  const result: DiffLine[] = a
    .slice(0, prefix)
    .map((text, i) => ({ kind: 'same', text, oldLine: i + 1, newLine: i + 1 }));
  let i = 0,
    j = 0;
  // Bound quadratic work for large replacements; unchanged prefix/suffix remain exact.
  const table =
    x.length && y.length && x.length * y.length <= 1_000_000
      ? Array.from({ length: x.length + 1 }, () => new Uint32Array(y.length + 1))
      : null;
  if (table)
    for (let r = x.length - 1; r >= 0; r--)
      for (let c = y.length - 1; c >= 0; c--)
        table[r][c] =
          x[r] === y[c] ? table[r + 1][c + 1] + 1 : Math.max(table[r + 1][c], table[r][c + 1]);
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) {
      result.push({ kind: 'same', text: x[i], oldLine: prefix + i + 1, newLine: prefix + j + 1 });
      i++;
      j++;
    } else if (i < x.length && (j >= y.length || !table || table[i + 1][j] >= table[i][j + 1])) {
      result.push({ kind: 'removed', text: x[i], oldLine: prefix + i + 1 });
      i++;
    } else {
      result.push({ kind: 'added', text: y[j], newLine: prefix + j + 1 });
      j++;
    }
  }
  for (let k = 0; k < suffix; k++)
    result.push({
      kind: 'same',
      text: a[a.length - suffix + k],
      oldLine: a.length - suffix + k + 1,
      newLine: b.length - suffix + k + 1,
    });
  return result;
}
export function changeSummary(record: EditRecord) {
  const diff = lineDiff(record.before, record.after);
  const changed = diff.filter((l) => l.kind !== 'same');
  return {
    added: diff.filter((l) => l.kind === 'added').length,
    removed: diff.filter((l) => l.kind === 'removed').length,
    from: changed.length
      ? changed.reduce((min, l) => Math.min(min, l.newLine ?? l.oldLine!), Infinity)
      : 1,
    to: changed.length ? changed.reduce((max, l) => Math.max(max, l.newLine ?? l.oldLine!), 0) : 1,
  };
}
export function limitHistory(records: EditRecord[]) {
  let bytes = 0;
  return records
    .filter((r) => r.before !== r.after)
    .slice(0, 150)
    .filter((r) => {
      const size = (r.before.length + r.after.length) * 2;
      if (bytes + size > 4 * 1024 * 1024) return false;
      bytes += size;
      return true;
    });
}
