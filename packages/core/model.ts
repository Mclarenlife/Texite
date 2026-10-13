export type Engine = 'tectonic' | 'xelatex' | 'pdflatex' | 'lualatex';
export type Mode = 'split' | 'editor' | 'pdf';
export type ProjectFile = { path: string; content: string; binary?: boolean };
export type Project = {
  id: string;
  name: string;
  files: ProjectFile[];
  folders?: string[];
  location?: { kind: 'linked' | 'managed'; directory: string };
  mainFile: string;
  activeFile: string;
  engine: Engine;
  revision: number;
  updatedAt: number;
};
export type Diagnostic = {
  severity: 'error' | 'warning';
  message: string;
  file?: string;
  line?: number;
};
export type CompileResult = {
  success: boolean;
  engine?: Engine;
  compilerLabel?: string;
  pdf?: number[];
  log: string;
  revision: number;
  cancelled?: boolean;
};
export type DesktopAPI = {
  ai?: import('./ai').AIAPI;
  saveAIProject?(
    project: Project,
    removals: { path: string; expected: string }[],
  ): Promise<unknown>;
  listRuntime(): Promise<RuntimeModule[]>;
  chooseRuntimePack(): Promise<{
    label: string;
    platform: string;
    modules: RuntimeModule[];
  } | null>;
  installRuntimePack(ids: string[]): Promise<RuntimeModule[]>;
  removeRuntimeModule(id: string): Promise<RuntimeModule[]>;
  restoreDefaultRuntime(): Promise<RuntimeModule[]>;
  importProject(project: Project): Promise<Project>;
  listProjects(): Promise<Project[]>;
  reopenProject(id: string): Promise<Project | null>;
  openProject(): Promise<{
    id: string;
    name: string;
    files: ProjectFile[];
    folders?: string[];
    location?: Project['location'];
    mainFile?: string;
    engine?: Engine;
  } | null>;
  saveProject(project: Project): Promise<{ cancelled?: boolean; directory?: string }>;
  detectEngines(): Promise<{
    bundled: boolean;
    latexmk: boolean;
    engines: Record<Engine, boolean>;
    details?: Partial<Record<Engine, string>>;
  }>;
  compile(project: Project): Promise<CompileResult>;
  cancelCompile(): Promise<void>;
  onCompileLog(callback: (chunk: string) => void): () => void;
};
export type RuntimeModule = {
  id: string;
  label: string;
  version: string;
  kind: 'engine' | 'package';
  engine?: Engine;
  dependencies: string[];
  bytes: number;
  core?: boolean;
  requiredBy?: string[];
};
declare global {
  interface Window {
    texite?: DesktopAPI;
  }
}

export const isTextFile = (path: string) =>
  /\.(tex|bib|sty|cls|txt|md|csv|json|bst|tikz)$/i.test(path);
export function safePath(path: string): string {
  const normalized = path.replaceAll('\\', '/');
  if (
    normalized
      .split('/')
      .some((part) =>
        ['.git', '.hg', '.svn', 'node_modules', '.texite-build'].includes(part.toLowerCase()),
      )
  )
    throw new Error('不能使用保留的项目目录。');
  if (
    !normalized ||
    normalized.startsWith('/') ||
    normalized
      .split('/')
      .some(
        (p) =>
          !p ||
          p === '..' ||
          p === '.' ||
          /[:\x00-\x1f<>"|?*]/.test(p) ||
          /[. ]$/.test(p) ||
          /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(p),
      )
  ) {
    throw new Error('文件名必须是项目内的相对路径，且不能包含特殊字符。');
  }
  return normalized;
}
export function validateProject(value: unknown): Project {
  const p = value as Project;
  if (
    !p ||
    !Array.isArray(p.files) ||
    !p.files.length ||
    p.files.length > 500 ||
    typeof p.name !== 'string'
  )
    throw new Error('无效的项目数据。');
  const paths = new Set<string>();
  let total = 0;
  for (const file of p.files) {
    safePath(file.path);
    if (
      typeof file.content !== 'string' ||
      (file.binary !== undefined && typeof file.binary !== 'boolean')
    )
      throw new Error('无效的文件内容。');
    const key = file.path.toLowerCase();
    if (paths.has(key)) throw new Error('项目中存在重复文件名。');
    paths.add(key);
    total += file.content.length;
  }
  if (total > 70 * 1024 * 1024) throw new Error('初版支持最多 50 MB 的项目。');
  const folders = validateFolders(
    p.folders ?? [],
    p.files.map((f) => f.path),
  );
  const mainFile =
    p.files.find((f) => f.path === p.mainFile && /\.tex$/i.test(f.path) && !f.binary)?.path ??
    p.files.find((f) => /\.tex$/i.test(f.path) && !f.binary)?.path;
  if (!mainFile) throw new Error('项目中没有 .tex 主文件。');
  return {
    ...p,
    folders,
    id: typeof p.id === 'string' ? p.id : crypto.randomUUID(),
    name: p.name.slice(0, 100),
    mainFile,
    activeFile: p.files.some((f) => f.path === p.activeFile) ? p.activeFile : mainFile,
    engine: ['tectonic', 'xelatex', 'pdflatex', 'lualatex'].includes(p.engine)
      ? p.engine
      : 'pdflatex',
    revision: Number.isSafeInteger(p.revision) ? p.revision : 0,
    updatedAt: Number.isFinite(p.updatedAt) ? p.updatedAt : Date.now(),
  };
}
export function validateFolders(folders: string[], files: string[]) {
  if (!Array.isArray(folders) || folders.length > 500) throw new Error('最多支持 500 个文件夹。');
  const all = new Set(folders.map(safePath));
  for (const path of [...files, ...all]) {
    const parts = path.split('/');
    while (parts.length > 1) {
      parts.pop();
      all.add(parts.join('/'));
    }
  }
  const fileNames = new Set(files.map((f) => f.toLowerCase()));
  const names = new Set<string>();
  for (const folder of all) {
    const key = folder.toLowerCase();
    if (fileNames.has(key) || names.has(key)) throw new Error('文件与文件夹路径冲突。');
    names.add(key);
  }
  return [...all].sort();
}
export function getOutline(source: string) {
  return [
    ...source.matchAll(/^\s*\\(subsection|section|chapter)\*?(?:\[[^\]]*\])?\{([^}]+)\}/gm),
  ].map((m) => ({ title: m[2], level: m[1] === 'subsection' ? 2 : 1, position: m.index! }));
}
export function getReferences(files: ProjectFile[]) {
  return files
    .filter((f) => /\.bib$/i.test(f.path))
    .flatMap((f) =>
      [...f.content.matchAll(/@\w+\s*\{\s*([^,\s]+),([\s\S]*?)(?=\n@|$)/g)].map((m) => ({
        key: m[1],
        title: m[2].match(/title\s*=\s*[{"]([^}\"]+)/i)?.[1] ?? m[1],
        author: m[2].match(/author\s*=\s*[{"]([^}\"]+)/i)?.[1] ?? '',
        year: m[2].match(/year\s*=\s*[{"]?(\d{4})/i)?.[1] ?? '',
        file: f.path,
      })),
    );
}
export function parseDiagnostics(log: string): Diagnostic[] {
  const entries: Diagnostic[] = [];
  const lines = log.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const located = lines[i].match(/^(.+?\.tex):(\d+):\s*(.+)$/);
    if (located)
      entries.push({
        severity: 'error',
        file: located[1].replaceAll('\\', '/').replace(/^\.\//, ''),
        line: Number(located[2]),
        message: located[3],
      });
    else if (lines[i].startsWith('!')) {
      const n = lines
        .slice(i + 1, i + 5)
        .join(' ')
        .match(/l\.(\d+)/);
      entries.push({
        severity: 'error',
        message: lines[i].slice(1).trim(),
        line: n ? Number(n[1]) : undefined,
      });
    } else if (/(?:LaTeX|Package .+) Warning:|Overfull \\[hv]box/.test(lines[i]))
      entries.push({ severity: 'warning', message: lines[i].trim() });
  }
  return entries.slice(0, 100);
}
