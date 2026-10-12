import { openDB } from 'idb';
import JSZip from 'jszip';
import {
  isTextFile,
  safePath,
  validateProject,
  type Project,
  type ProjectFile,
} from '../core/model';

let connection: ReturnType<typeof openDB> | undefined;
const database = () =>
  (connection ??= openDB('texite-workspace', 1, {
    upgrade(db) {
      db.createObjectStore('projects', { keyPath: 'id' });
      db.createObjectStore('settings');
    },
  }));
export async function saveProject(project: Project) {
  const db = await database();
  const tx = db.transaction(['projects', 'settings'], 'readwrite');
  await tx.objectStore('projects').put(project);
  await tx.objectStore('settings').put(project.id, 'lastProject');
  await tx.done;
}
export async function loadProjects(): Promise<{ projects: Project[]; lastId: string | undefined }> {
  const db = await database();
  const data = await db.getAll('projects');
  const projects = data.map(validateProject).sort((a, b) => b.updatedAt - a.updatedAt);
  return { projects, lastId: await db.get('settings', 'lastProject') };
}
export async function exportZip(project: Project) {
  const zip = new JSZip();
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
  const entries = Object.values(zip.files).filter((f) => !f.dir);
  if (entries.length > 500) throw new Error('初版支持最多 500 个文件。');
  const files: ProjectFile[] = [];
  let size = 0;
  let settings: { name?: string; mainFile?: string; engine?: string } = {};
  for (const entry of entries) {
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
  return validateProject({
    id: crypto.randomUUID(),
    name: settings.name ?? file.name.replace(/\.zip$/i, ''),
    files,
    mainFile: settings.mainFile ?? 'main.tex',
    activeFile: settings.mainFile ?? 'main.tex',
    engine: settings.engine ?? 'xelatex',
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
