import limits from '../../apps/desktop/project-limits.json';
export { limits as PROJECT_LIMITS };
const sizes = new WeakMap<object, { content: string; binary?: boolean; bytes: number }>();
export function fileBytes(file: { content: string; binary?: boolean }): number {
  const cached = sizes.get(file);
  if (cached?.content === file.content && cached.binary === file.binary) return cached.bytes;
  const bytes = file.binary
    ? Math.floor((file.content.length * 3) / 4) -
      (file.content.endsWith('==') ? 2 : file.content.endsWith('=') ? 1 : 0)
    : new TextEncoder().encode(file.content).byteLength;
  sizes.set(file, { content: file.content, binary: file.binary, bytes });
  return bytes;
}
export function projectBytes(files: { content: string; binary?: boolean }[]): number {
  return files.reduce((total, file) => total + fileBytes(file), 0);
}
export function ignoredImportPath(path: string): boolean {
  return (
    path
      .split('/')
      .some((part) =>
        ['__MACOSX', '.git', '.texite-build', 'node_modules', 'build', 'dist'].includes(part),
      ) ||
    /(?:^|\/)\._[^/]*$|(?:^|\/)\.DS_Store$|\.(?:log|out|toc|fls|fdb_latexmk|synctex\.gz)$/i.test(
      path,
    )
  );
}
