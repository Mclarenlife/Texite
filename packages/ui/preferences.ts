import { useEffect, useState } from 'react';
export function usePreference<T extends string | number | boolean>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('texite-' + key) || 'null');
      return typeof saved === typeof fallback &&
        (typeof saved !== 'number' || Number.isFinite(saved))
        ? saved
        : fallback;
    } catch {
      return fallback;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('texite-' + key, JSON.stringify(value));
    } catch {
      /* Session preferences still work when storage is unavailable. */
    }
  }, [key, value]);
  return [value, setValue] as const;
}
export const editorFonts: Record<string, string> = {
  mono: 'ui-monospace, "Cascadia Code", "SFMono-Regular", Consolas, "PingFang SC", "Microsoft YaHei UI", "Microsoft YaHei", monospace',
  consolas:
    'Consolas, "SFMono-Regular", "PingFang SC", "Microsoft YaHei UI", "Microsoft YaHei", monospace',
  cascadia:
    '"Cascadia Code", Consolas, "PingFang SC", "Microsoft YaHei UI", "Microsoft YaHei", monospace',
  sans: '-apple-system, BlinkMacSystemFont, "Segoe UI Variable Text", "Segoe UI", "PingFang SC", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif',
  serif: 'Georgia, "Songti SC", SimSun, serif',
};
