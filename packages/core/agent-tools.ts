import { parseAIChanges, type AIChange } from './ai';
import { safePath, type Project } from './model';

function textFile(project: Project, path: unknown) {
  if (typeof path !== 'string') throw new Error('需要文件路径。');
  const file = project.files.find((f) => f.path === safePath(path));
  if (!file || file.binary) throw new Error('文件不存在或不是文本。');
  return file;
}
export function readAgentLines(project: Project, args: Record<string, unknown>) {
  const file = textFile(project, args.path);
  const start = args.startLine as number,
    end = args.endLine as number;
  const lines = file.content.split('\n');
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 1 ||
    end < start ||
    start > lines.length ||
    end - start >= 200
  )
    throw new Error('每次可读取 1–200 行，请提供有效行号。');
  let size = 0;
  const result = [];
  for (let i = start - 1; i < Math.min(end, lines.length); i++) {
    if (size + lines[i].length > 16000) break;
    result.push({ line: i + 1, text: lines[i] });
    size += lines[i].length + 1;
  }
  if (!result.length) throw new Error('该行超过 16,000 字符，请先在编辑器中拆分长行。');
  return {
    path: file.path,
    revision: project.revision,
    totalLines: lines.length,
    startOffset: lines.slice(0, start - 1).reduce((n, line) => n + line.length + 1, 0),
    lines: result,
    truncated: result.length < Math.min(end, lines.length) - start + 1,
  };
}
export function searchAgentProject(project: Project, args: Record<string, unknown>) {
  if (
    typeof args.query !== 'string' ||
    !args.query.length ||
    args.query.length > 300 ||
    args.query.includes('\n')
  )
    throw new Error('搜索词需为 1–300 个字符的单行文本。');
  if (
    !Array.isArray(args.paths) ||
    args.paths.some((p) => typeof p !== 'string') ||
    typeof args.caseSensitive !== 'boolean'
  )
    throw new Error('搜索范围格式无效。');
  const paths = args.paths.map((p) => safePath(p as string));
  const query = args.caseSensitive ? args.query : args.query.toLocaleLowerCase();
  const matches = [];
  let characters = 0;
  for (const file of project.files) {
    if (file.binary || (paths.length && !paths.includes(file.path))) continue;
    const lines = file.content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const index = (args.caseSensitive ? lines[i] : lines[i].toLocaleLowerCase()).indexOf(query);
      if (index < 0) continue;
      if (matches.length >= 40 || characters >= 12000)
        return { revision: project.revision, matches, truncated: true };
      const snippetStart = Math.max(0, index - 100);
      const text = lines[i].slice(snippetStart, snippetStart + 500);
      matches.push({ path: file.path, line: i + 1, text, snippetStart });
      characters += text.length;
    }
  }
  return { revision: project.revision, matches, truncated: false };
}
export function agentPatch(project: Project, args: Record<string, unknown>): AIChange[] {
  const file = textFile(project, args.path);
  if (!Number.isInteger(args.revision) || args.revision !== project.revision)
    throw new Error('项目已发生变化，请重新读取后修改。');
  if (
    typeof args.oldText !== 'string' ||
    typeof args.newText !== 'string' ||
    args.oldText.length + args.newText.length > 64000
  )
    throw new Error('补丁文本无效或超过 64,000 字符。');
  let start = args.start;
  if (start === undefined) {
    if (!args.oldText) throw new Error('插入内容需要 start 位置。');
    start = file.content.indexOf(args.oldText);
    if ((start as number) < 0 || file.content.indexOf(args.oldText, (start as number) + 1) >= 0)
      throw new Error('原文未找到或重复，请读取行内容并提供准确的 start 位置。');
  }
  if (
    !Number.isInteger(start) ||
    (start as number) < 0 ||
    (start as number) > file.content.length ||
    file.content.slice(start as number, (start as number) + args.oldText.length) !== args.oldText
  )
    throw new Error('补丁位置与原文不一致，请重新读取。');
  return parseAIChanges([
    {
      path: file.path,
      before: file.content,
      after:
        file.content.slice(0, start as number) +
        args.newText +
        file.content.slice((start as number) + args.oldText.length),
    },
  ]);
}
