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
  syncMap?: SyncNode[];
  success: boolean;
  engine?: Engine;
  compilerLabel?: string;
  pdf?: number[];
  log: string;
  revision: number;
  cancelled?: boolean;
};
export type SyncNode = {
  file: string;
  line: number;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
};
export type DesktopAPI = {
  deleteProject?(id: string, deleteFiles: boolean): Promise<void>;
  updates?: {
    status(): Promise<{
      info: UpdateInfo | null;
      busy: boolean;
      ready: boolean;
      progress: number;
      error: string;
    }>;
    check(): Promise<UpdateInfo>;
    download(): Promise<boolean>;
    install(): Promise<void>;
    onProgress(callback: (percent: number) => void): () => void;
  };
  platform?: string;
  windowControl?(action: 'minimize' | 'maximize' | 'close'): Promise<void>;
  onCloseRequest?(
    callback: () => Promise<{ unsaved: boolean; unsynced: number; syncing: boolean }>,
  ): () => void;
  storage?: {
    clearSyncBackups?(): Promise<void>;
    get(): Promise<string>;
    choose(): Promise<string | null>;
    relocate(project: Project): Promise<Project>;
  };
  webdav?: {
    get(): Promise<WebDAVConfig>;
    configure(input: { url: string; username: string; password: string }): Promise<WebDAVConfig>;
    list(): Promise<{ key: string; name: string; files: number }[]>;
    sync(
      project: Project,
    ): Promise<{ status: 'uploaded' | 'downloaded' | 'conflict' | 'unchanged'; project?: Project }>;
    download(key: string): Promise<Project>;
    batch(options: {
      mode: 'pull' | 'upload' | 'sync';
      ids?: string[];
      excludedIds?: string[];
    }): Promise<{
      projects: Project[];
      config: WebDAVConfig;
      results: {
        id?: string;
        name: string;
        status: 'uploaded' | 'downloaded' | 'conflict' | 'unchanged' | 'local-only' | 'failed';
        error?: string;
      }[];
    }>;
    detach(id: string): Promise<WebDAVConfig>;
  };
  ai?: import('./ai').AIAPI;
  chat?: import('./ai').ChatAPI;
  saveAIProject?(
    project: Project,
    removals: { path: string; expected: string }[],
  ): Promise<unknown>;
  restoreProject?(
    project: Project,
    removals: { path: string; expected: string; binary?: boolean }[],
    removedFolders?: string[],
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
  renameProject?(id: string, name: string): Promise<void>;
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
  saveProject(
    project: Project,
  ): Promise<{ cancelled?: boolean; directory?: string; kind?: 'linked' | 'managed' }>;
  detectEngines(): Promise<{
    bundled: boolean;
    latexmk: boolean;
    engines: Record<Engine, boolean>;
    details?: Partial<Record<Engine, string>>;
  }>;
  compile(project: Project): Promise<CompileResult>;
  cancelCompile(): Promise<void>;
  writeClipboard?(text: string): Promise<void>;
  onCompileLog(callback: (chunk: string) => void): () => void;
};
export type WebDAVConfig = {
  url: string;
  username: string;
  hasPassword: boolean;
  persistent: boolean;
  projects: { id: string; time: number; hash?: string }[];
};
export type UpdateInfo = {
  version: string;
  current: string;
  available: boolean;
  supported: boolean;
  notes: string;
  size: number;
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
  if (!p || !Array.isArray(p.files) || p.files.length > 500 || typeof p.name !== 'string')
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
    p.files.find((f) => /\.tex$/i.test(f.path) && !f.binary)?.path ??
    '';
  return {
    ...p,
    folders,
    id: typeof p.id === 'string' ? p.id : crypto.randomUUID(),
    name: p.name.slice(0, 100),
    mainFile,
    activeFile: p.files.some((f) => f.path === p.activeFile)
      ? p.activeFile
      : mainFile || p.files[0]?.path || '',
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
    ...source.matchAll(
      /^[\t ]*\\(subsubsection|subsection|section|chapter|part)\*?(?:\[[^\]]*\])?\{([^}]+)\}/gm,
    ),
  ].map((m, _, matches) => {
    const ranks = ['part', 'chapter', 'section', 'subsection', 'subsubsection'];
    const base = Math.min(...matches.map((item) => ranks.indexOf(item[1])));
    return { title: m[2], level: ranks.indexOf(m[1]) - base + 1, position: m.index! };
  });
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
  const bibliographyEntries = new Set<Diagnostic>();
  const lines = log.split(/\r?\n/);
  const files: (string | undefined)[] = [];
  const clean = (file: string) => file.replaceAll('\\', '/').replace(/^\.\//, '');
  function trackFiles(text: string) {
    for (const match of text.matchAll(
      /\((?:"([^"\n]+\.(?:tex|sty|cls))"|([^\s()]+\.(?:tex|sty|cls)))(?=[\s)]|$)|[()]/g,
    )) {
      if (match[0] === ')') files.pop();
      else files.push(match[1] || match[2] ? clean(match[1] || match[2]) : undefined);
    }
  }
  for (let i = 0; i < lines.length; i++) {
    // References are normally unresolved until BibTeX and subsequent TeX passes.
    // Replace transient TeX warnings at each managed pass, not just duplicates.
    // Bibliography warnings can remain relevant without another BibTeX run.
    if (/^(?:pdfLaTeX|XeLaTeX|LuaLaTeX) · 第 \d+ 遍\s*$/.test(lines[i])) {
      const persistent = entries.filter(
        (e) => e.severity === 'error' || bibliographyEntries.has(e),
      );
      entries.splice(0, entries.length, ...persistent);
      files.length = 0;
      continue;
    }
    if (
      /^Warning--/.test(lines[i]) ||
      /^I couldn't open (?:database|style|auxiliary) file/.test(lines[i])
    ) {
      const entry: Diagnostic = {
        severity: lines[i].startsWith('Warning--') ? 'warning' : 'error',
        message: 'BibTeX: ' + lines[i].trim(),
      };
      entries.push(entry);
      bibliographyEntries.add(entry);
      continue;
    }
    const located = lines[i].match(/^(.+?\.(?:tex|sty|cls|bib|bst)):(\d+):\s*(.+)$/);
    const currentFile = [...files].reverse().find(Boolean);
    if (located)
      entries.push({
        severity: 'error',
        file: clean(located[1]),
        line: Number(located[2]),
        message: located[3],
      });
    else if (lines[i].startsWith('!') || /(?:pdfTeX|LuaTeX|XeTeX) error:/.test(lines[i])) {
      const n = lines
        .slice(i + 1, i + 5)
        .join(' ')
        .match(/l\.(\d+)/);
      entries.push({
        severity: 'error',
        file: currentFile,
        message: lines[i].replace(/^!\s*/, '').trim(),
        line: n ? Number(n[1]) : undefined,
      });
    } else if (
      /(?:LaTeX(?: Font)?|Package .+) Warning:|(?:Over|Under)full \\[hv]box/.test(lines[i])
    ) {
      let message = lines[i].trim();
      const box = /^(?:Over|Under)full \\[hv]box/.test(message);
      // TeX wraps warning details onto indented or package-prefixed lines.
      // Box diagnostics may share a line with shipout/file progress. Those are
      // not warning text; neither are the font/paragraph dumps on the next line.
      const continuation = box
        ? /^\s+(?:(?:in paragraph )?at lines?|detected at line|has occurred while \\output is active)\b/
        : /^(?:\s+\S|\((?:Font|[\w-]+)\)\s{2,})/;
      while (i + 1 < lines.length && continuation.test(lines[i + 1]))
        message += ' ' + lines[++i].trim();
      if (box) {
        const progress = message.search(/\s+\[\d+(?=[\s\]<{])/);
        if (progress >= 0) {
          trackFiles(message.slice(progress));
          message = message.slice(0, progress);
        }
      }
      const line = message.match(/(?:on input line|at lines?|detected at line)\s+(\d+)/);
      entries.push({
        severity: 'warning',
        message,
        file: currentFile,
        line: line ? Number(line[1]) : undefined,
      });
    } else {
      // File nesting in TeX logs distinguishes errors inside included sources.
      trackFiles(lines[i]);
    }
  }
  // Repeated compiler passes should not bury the fatal error below warnings.
  const seen = new Set<string>();
  return entries
    .filter((entry) => {
      const key = JSON.stringify(entry);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => Number(a.severity !== 'error') - Number(b.severity !== 'error'))
    .slice(0, 100);
}
