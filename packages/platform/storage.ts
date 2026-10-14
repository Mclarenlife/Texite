import { openDB } from 'idb';
import JSZip from 'jszip';
import {
  type EditRecord,
  type RecoveryPoint,
  type RestoreRequest,
  prepareRestore,
  limitHistory,
} from '../core/history';
import {
  isTextFile,
  safePath,
  validateProject,
  type Project,
  type ProjectFile,
} from '../core/model';

let connection: ReturnType<typeof openDB> | undefined;
export type ProjectBackup = {
  id: string;
  projectId: string;
  time: number;
  note: string;
  project: Project;
};
export async function readProjectBackups(id: string): Promise<ProjectBackup[]> {
  const prefix = 'backup:' + id + ':';
  return (
    await (await database()).getAll('settings', IDBKeyRange.bound(prefix, prefix + '\uffff'))
  ).sort((a, b) => b.time - a.time);
}
export async function createProjectBackup(project: Project, note: string) {
  const backup: ProjectBackup = {
    id: crypto.randomUUID(),
    projectId: project.id,
    time: Date.now(),
    note: note.trim().slice(0, 200),
    project: structuredClone(validateProject(project)),
  };
  await (await database()).put('settings', backup, 'backup:' + project.id + ':' + backup.id);
  return backup;
}
export async function deleteProjectBackup(projectId: string, id: string) {
  await (await database()).delete('settings', 'backup:' + projectId + ':' + id);
}
export async function clearProjectHistory(
  projectId: string,
  records: EditRecord[],
  from: number,
  to: number,
) {
  const db = await database(),
    tx = db.transaction(['settings', 'recoveries'], 'readwrite');
  await tx.objectStore('settings').put(records, 'history:' + projectId);
  for (const point of await tx.objectStore('recoveries').index('projectId').getAll(projectId))
    if (point.time >= from && point.time <= to) await tx.objectStore('recoveries').delete(point.id);
  await tx.done;
}
export async function loadAITasks(projectId: string): Promise<import('../core/ai').AITask[]> {
  const value = await (await database()).get('settings', 'ai:' + projectId);
  return Array.isArray(value)
    ? value.map((task) =>
        task.status === 'running'
          ? { ...task, status: 'interrupted', error: '上次任务已中断，已保存的修改可查看或撤回。' }
          : task,
      )
    : [];
}
export async function saveAITasks(projectId: string, tasks: import('../core/ai').AITask[]) {
  if (JSON.stringify(tasks).length > 12_000_000)
    throw new Error('AI 记录超过 12 MB，请导出项目并在新项目中继续。现有恢复记录仍保留。');
  await (await database()).put('settings', tasks, 'ai:' + projectId);
}
export async function commitAIProject(
  current: Project,
  next: Project,
  tasks: import('../core/ai').AITask[],
) {
  if (JSON.stringify(tasks).length > 12_000_000)
    throw new Error('AI 恢复记录超过 12 MB，本次修改未执行。');
  const db = await database();
  const tx = db.transaction(['projects', 'settings'], 'readwrite');
  try {
    const saved: Project | undefined = await tx.objectStore('projects').get(current.id);
    if (
      saved &&
      (saved.revision > current.revision ||
        (saved.revision === current.revision &&
          JSON.stringify(saved.files) !== JSON.stringify(current.files)))
    )
      throw new Error('项目已被其他窗口修改，请重新打开后继续。');
    await tx.objectStore('settings').put(tasks, 'ai:' + current.id);
    await tx.objectStore('projects').put(next);
    await tx.done;
  } catch (error) {
    try {
      tx.abort();
    } catch {}
    await tx.done.catch(() => {});
    throw error;
  }
}
const database = () =>
  (connection ??= new Promise((resolve, reject) => {
    let blocked = false;
    const opening = openDB('texite-workspace', 2, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('projects'))
          db.createObjectStore('projects', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings');
        if (!db.objectStoreNames.contains('recoveries'))
          db.createObjectStore('recoveries', { keyPath: 'id' }).createIndex(
            'projectId',
            'projectId',
          );
      },
      blocked() {
        blocked = true;
        reject(new Error('请关闭其他 Texite 标签页后重试，以完成本地存储升级。'));
      },
      blocking() {
        void opening.then((db) => db.close());
      },
    });
    void opening.then((db) => {
      if (blocked) db.close();
      else resolve(db);
    }, reject);
  }));
export async function readRecoveries(projectId: string): Promise<RecoveryPoint[]> {
  return (await (await database()).getAllFromIndex('recoveries', 'projectId', projectId)).sort(
    (a, b) => b.time - a.time,
  );
}
// The safety copy and restored local project commit together. Quota/write failures change neither.
export async function commitRecovery(current: Project, request: RestoreRequest) {
  const result = prepareRestore(current, request);
  const db = await database();
  const tx = db.transaction(['projects', 'settings', 'recoveries'], 'readwrite');
  try {
    const saved: Project | undefined = await tx.objectStore('projects').get(current.id);
    if (
      saved &&
      (saved.revision > current.revision ||
        (saved.revision === current.revision &&
          saved.files.find((f) => f.path === request.record.path)?.content !== request.expected))
    )
      throw new Error('本地项目已被其他窗口更新，请重新打开项目再恢复。');
    await tx.objectStore('recoveries').add(result.backup);
    await tx.objectStore('projects').put(result.restored);
    await tx.objectStore('settings').put(current.id, 'lastProject');
    await tx.done;
    return result;
  } catch (error) {
    try {
      tx.abort();
    } catch {
      /* Transaction may already be aborted. */
    }
    await tx.done.catch(() => {});
    throw error;
  }
}
export async function saveProject(project: Project) {
  const db = await database();
  const tx = db.transaction(['projects', 'settings'], 'readwrite');
  await tx.objectStore('projects').put(project);
  await tx.objectStore('settings').put(project.id, 'lastProject');
  await tx.done;
}
export async function readHistory(id: string): Promise<EditRecord[]> {
  const value = await (await database()).get('settings', 'history:' + id);
  return Array.isArray(value)
    ? limitHistory(
        value.filter(
          (r) =>
            r &&
            typeof r.id === 'string' &&
            typeof r.path === 'string' &&
            typeof r.before === 'string' &&
            typeof r.after === 'string' &&
            Number.isFinite(r.time),
        ),
      )
    : [];
}
export async function writeHistory(id: string, records: EditRecord[]) {
  await (await database()).put('settings', limitHistory(records), 'history:' + id);
}
export async function loadProjects(): Promise<{ projects: Project[]; lastId: string | undefined }> {
  const db = await database();
  const data = await db.getAll('projects');
  const projects = data.map(validateProject).sort((a, b) => b.updatedAt - a.updatedAt);
  return { projects, lastId: await db.get('settings', 'lastProject') };
}
export async function readArchivedProjects(): Promise<string[]> {
  const value = await (await database()).get('settings', 'archivedProjects');
  return Array.isArray(value) ? value.filter((id) => typeof id === 'string') : [];
}
export async function archiveProjects(ids: string[], archive: boolean) {
  const db = await database();
  const tx = db.transaction('settings', 'readwrite');
  const current: string[] = (await tx.store.get('archivedProjects')) || [];
  const next = archive
    ? [...new Set([...current, ...ids])]
    : current.filter((id) => !ids.includes(id));
  await tx.store.put(next, 'archivedProjects');
  await tx.done;
  return next;
}
export async function renameStoredProject(id: string, name: string) {
  if (!name.trim() || name.length > 100) throw new Error('项目名称应为 1–100 个字符。');
  const db = await database();
  const tx = db.transaction('projects', 'readwrite');
  const project: Project | undefined = await tx.store.get(id);
  if (!project) throw new Error('项目不存在，请重新打开项目空间。');
  const next = {
    ...project,
    name: name.trim(),
    updatedAt: Date.now(),
    revision: project.revision + 1,
  };
  await tx.store.put(next);
  await tx.done;
  return next;
}
export async function exportZip(project: Project) {
  const zip = new JSZip();
  project.folders?.forEach((folder) => zip.folder(folder));
  project.files.forEach((f) => zip.file(f.path, f.content, { base64: !!f.binary }));
  zip.file(
    '.texite.json',
    JSON.stringify(
      { version: 1, name: project.name, mainFile: project.mainFile, engine: project.engine },
      null,
      2,
    ),
  );
  return zip.generateAsync({ type: 'blob' });
}
export async function importZip(file: File): Promise<Project> {
  if (file.size > 50 * 1024 * 1024) throw new Error('初版支持最多 50 MB 的 ZIP。');
  const zip = await JSZip.loadAsync(file);
  const entries = Object.values(zip.files);
  if (entries.length > 500) throw new Error('初版支持最多 500 个文件。');
  const files: ProjectFile[] = [];
  const folders: string[] = [];
  let size = 0;
  let settings: { name?: string; mainFile?: string; engine?: string } = {};
  for (const entry of entries) {
    if (entry.name.startsWith('__MACOSX/')) continue;
    if (entry.dir) {
      folders.push(safePath(entry.name.replace(/\/$/, '')));
      continue;
    }
    safePath(
      (entry as typeof entry & { unsafeOriginalName?: string }).unsafeOriginalName ?? entry.name,
    );
    const path = safePath(entry.name);
    if (path.startsWith('__MACOSX/') || path.includes('/.git/') || path.startsWith('.git/'))
      continue;
    const declared = (entry as unknown as { _data?: { uncompressedSize: number } })._data
      ?.uncompressedSize;
    if (declared && size + declared > 50 * 1024 * 1024) throw new Error('解压后的项目超过 50 MB。');
    const bytes = await entry.async('uint8array');
    size += bytes.length;
    if (size > 50 * 1024 * 1024) throw new Error('解压后的项目超过 50 MB。');
    if (path === '.texite.json') {
      try {
        settings = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        /* Optional metadata. */
      }
      continue;
    }
    if (isTextFile(path)) files.push({ path, content: new TextDecoder().decode(bytes) });
    else files.push({ path, content: await entry.async('base64'), binary: true });
  }
  // Archives downloaded from GitHub often have a single wrapper directory.
  // Remove that wrapper so relative inputs and assets keep their intended project root.
  const prefix = files[0]?.path.includes('/') ? files[0].path.split('/')[0] + '/' : '';
  if (prefix && files.every((f) => f.path.startsWith(prefix))) {
    files.forEach((f) => {
      f.path = f.path.slice(prefix.length);
    });
    for (let i = folders.length - 1; i >= 0; i--) {
      if (folders[i] === prefix.slice(0, -1)) folders.splice(i, 1);
      else if (folders[i].startsWith(prefix)) folders[i] = folders[i].slice(prefix.length);
    }
    if (settings.mainFile?.startsWith(prefix))
      settings.mainFile = settings.mainFile.slice(prefix.length);
    const metadata = files.findIndex((f) => f.path === '.texite.json');
    if (metadata >= 0) {
      try {
        settings = JSON.parse(files[metadata].content);
      } catch {}
      files.splice(metadata, 1);
    }
  }
  return validateProject({
    id: crypto.randomUUID(),
    name: settings.name ?? file.name.replace(/\.zip$/i, ''),
    files,
    folders,
    mainFile: settings.mainFile ?? 'main.tex',
    activeFile: settings.mainFile ?? 'main.tex',
    engine: settings.engine ?? 'pdflatex',
    revision: 0,
    updatedAt: Date.now(),
  });
}
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

type Directory = FileSystemDirectoryHandle & {
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
  queryPermission(options: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission(options: { mode: 'readwrite' }): Promise<PermissionState>;
};
type Binding = { handle: Directory; hashes: Record<string, string> };
const hashBytes = async (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
async function scanDirectory(
  handle: Directory,
  id: string = crypto.randomUUID(),
): Promise<Project> {
  const files: ProjectFile[] = [],
    folders: string[] = [];
  const hashes: Record<string, string> = {};
  let total = 0;
  async function visit(directory: Directory, prefix = '') {
    for await (const [name, child] of directory.entries()) {
      if (name.startsWith('.') || ['node_modules', 'build', 'dist'].includes(name)) continue;
      const path = safePath(prefix + name);
      if (child.kind === 'directory') {
        if (folders.length >= 500) throw new Error('最多支持 500 个文件夹。');
        folders.push(path);
        await visit(child as Directory, path + '/');
      } else {
        if (/\.(aux|log|out|toc|fls|fdb_latexmk|synctex\.gz)$/i.test(name)) continue;
        const file = await (child as FileSystemFileHandle).getFile();
        total += file.size;
        if (total > 50 * 1024 * 1024 || files.length >= 500)
          throw new Error('项目超过 500 个文件或 50 MB。');
        const bytes = await file.arrayBuffer();
        hashes[path] = await hashBytes(bytes);
        const text = isTextFile(path);
        let content = '';
        if (text) content = new TextDecoder().decode(bytes);
        else {
          const data = new Uint8Array(bytes);
          for (let i = 0; i < data.length; i += 8192)
            content += String.fromCharCode(...data.subarray(i, i + 8192));
          content = btoa(content);
        }
        files.push({ path, content, binary: !text });
      }
    }
  }
  await visit(handle);
  let settings: Partial<Project> = {};
  try {
    settings = JSON.parse(
      await (await (await handle.getFileHandle('.texite.json')).getFile()).text(),
    );
  } catch {}
  const project = validateProject({
    ...settings,
    id,
    name: settings.name || handle.name,
    files,
    folders,
    revision: 0,
    updatedAt: Date.now(),
    location: { kind: 'linked', directory: handle.name },
  });
  await (await database()).put('settings', { handle, hashes }, 'folder:' + id);
  return project;
}
export async function openBrowserDirectory() {
  const picker = (
    window as unknown as { showDirectoryPicker?: (options: { mode: string }) => Promise<Directory> }
  ).showDirectoryPicker;
  if (!picker)
    throw new Error('此浏览器不支持文件夹关联。请使用 Chrome、Edge 或桌面版；也可导入 ZIP。');
  const handle = await picker({ mode: 'readwrite' });
  return scanDirectory(handle);
}
export async function reopenBrowserProject(project: Project) {
  const binding: Binding | undefined = await (
    await database()
  ).get('settings', 'folder:' + project.id);
  if (!binding) return project;
  if ((await binding.handle.requestPermission({ mode: 'readwrite' })) !== 'granted')
    throw new Error('需要文件夹读写权限。');
  return scanDirectory(binding.handle, project.id);
}
export async function saveBrowserDirectory(
  project: Project,
  removals: { path: string; expected: string; binary?: boolean }[] = [],
) {
  const db = await database();
  const binding: Binding | undefined = await db.get('settings', 'folder:' + project.id);
  if (!binding) return;
  if ((await binding.handle.queryPermission({ mode: 'readwrite' })) !== 'granted')
    throw new Error('文件夹权限已失效，请在项目空间重新打开文件夹。恢复副本仍保存在浏览器中。');
  async function directory(path: string) {
    let handle = binding!.handle;
    for (const name of path.split('/').filter(Boolean))
      handle = (await handle.getDirectoryHandle(name, { create: true })) as Directory;
    return handle;
  }
  const deletes = [];
  for (const item of removals) {
    const parts = safePath(item.path).split('/'),
      name = parts.pop()!;
    let parent = binding.handle;
    try {
      for (const part of parts) parent = (await parent.getDirectoryHandle(part)) as Directory;
      const bytes = await (await (await parent.getFileHandle(name)).getFile()).arrayBuffer();
      const expected = item.binary
        ? Uint8Array.from(atob(item.expected), (c) => c.charCodeAt(0))
        : new TextEncoder().encode(item.expected);
      const digest = await hashBytes(bytes);
      if (digest !== (await hashBytes(expected.buffer)) || digest !== binding.hashes[item.path])
        throw new Error(item.path + ' 已被外部修改，无法还原。');
      deletes.push({ parent, name, path: item.path, digest });
    } catch (e) {
      if ((e as DOMException).name !== 'NotFoundError') throw e;
    }
  }
  const pending = [];
  for (const file of project.files) {
    safePath(file.path);
    const parts = file.path.split('/'),
      name = parts.pop()!;
    const parent = await directory(parts.join('/'));
    const content = file.binary
      ? Uint8Array.from(atob(file.content), (c) => c.charCodeAt(0))
      : new TextEncoder().encode(file.content);
    const digest = await hashBytes(content.buffer);
    try {
      const existing = await (await parent.getFileHandle(name)).getFile();
      const current = await hashBytes(await existing.arrayBuffer());
      if (current !== binding.hashes[file.path] && current !== digest)
        throw new Error(file.path + ' 已被外部修改，请导出恢复副本后重新打开文件夹。');
    } catch (error) {
      if ((error as DOMException).name !== 'NotFoundError') throw error;
    }
    pending.push({ parent, name, file, content, digest });
  }
  for (const folder of project.folders || []) await directory(safePath(folder));
  for (const item of pending) {
    const stream = await (
      await item.parent.getFileHandle(item.name, { create: true })
    ).createWritable();
    await stream.write(item.content);
    await stream.close();
    binding.hashes[item.file.path] = item.digest;
  }
  for (const item of deletes) {
    const current = await (
      await (await item.parent.getFileHandle(item.name)).getFile()
    ).arrayBuffer();
    if ((await hashBytes(current)) !== item.digest)
      throw new Error(item.path + ' 在还原过程中被外部修改。');
    await item.parent.removeEntry(item.name);
    delete binding.hashes[item.path];
  }
  const metadata = await (
    await binding.handle.getFileHandle('.texite.json', { create: true })
  ).createWritable();
  await metadata.write(
    JSON.stringify({ name: project.name, mainFile: project.mainFile, engine: project.engine }),
  );
  await metadata.close();
  await db.put('settings', binding, 'folder:' + project.id);
}
