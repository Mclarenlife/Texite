import type { Project } from './model';

// A chapter fragment, class, bibliography or image is not a standalone document.
export function isCompileDocument(file?: Project['files'][number]) {
  if (!file || file.binary || !/\.tex$/i.test(file.path)) return false;
  const content = file.content.replace(/(?<!\\)(?:\\\\)*%[^\r\n]*/g, '');
  return /\\(?:documentclass|documentstyle)\b|\\begin\s*\{document\}/.test(content);
}
export function compileTargets(project: Project) {
  const available = project.files.filter((f) => !f.binary && /\.tex$/i.test(f.path));
  const active = available.find((f) => f.path === project.activeFile);
  const previous = available.find((f) => f.path === project.mainFile);
  const first = isCompileDocument(active) || active === previous ? active : undefined;
  const fallback = previous || available.find(isCompileDocument);
  return [...new Set([first?.path, fallback?.path].filter((p): p is string => !!p))];
}
export async function compileWithFallback<
  T extends { success: boolean; cancelled?: boolean; log: string },
>(
  project: Project,
  run: (snapshot: Project) => Promise<T>,
  cancelled: () => boolean = () => false,
): Promise<T & { mainFile: string; fallbackFrom?: string }> {
  const targets = compileTargets(project);
  if (!targets.length)
    throw new Error('项目中没有可编译的 .tex 文稿。请打开包含文档导言区的文件。');
  let log = '';
  for (const mainFile of targets) {
    if (cancelled()) throw new Error('编译已取消。');
    const result = await run({ ...project, mainFile });
    log += `\n编译入口：${mainFile}\n${result.log}\n`;
    const fallbackFrom = mainFile !== project.activeFile ? project.activeFile : undefined;
    if (result.success || result.cancelled || cancelled() || mainFile === targets.at(-1))
      return { ...result, mainFile, fallbackFrom, log };
    log += `\n当前文稿未编译成功，回退到：${targets[targets.indexOf(mainFile) + 1]}\n`;
  }
  throw new Error('没有可用的编译入口。');
}
