import type { IDBPDatabase, IDBPTransaction } from 'idb';
import type { Project, ProjectFile } from '../core/model';
import { base64ToBytes, bytesToBase64 } from '../core/binary';

type StoredFile = ProjectFile & { assetKey?: string };
type StoredProject = Omit<Project, 'files'> & { files: StoredFile[]; storageVersion?: number };
type Tx = IDBPTransaction<any, string[], 'readwrite'>;
type Asset = { key: string; projectId: string; content: string };
export type PreparedProject = { project: StoredProject; assets: Asset[] };
const identities = new WeakMap<ProjectFile, { content: string; digest: string }>();

export async function prepareProject(project: Project): Promise<PreparedProject> {
  const assets = new Map<string, Asset>();
  const files: StoredFile[] = [];
  for (const file of project.files) {
    if (!file.binary) {
      files.push({ path: file.path, content: file.content });
      continue;
    }
    let cached = identities.get(file);
    if (!cached || cached.content !== file.content) {
      const digest = await crypto.subtle.digest('SHA-256', base64ToBytes(file.content));
      cached = {
        content: file.content,
        digest: Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, '0')).join(''),
      };
      identities.set(file, cached);
    }
    const key = project.id + ':' + cached.digest;
    assets.set(key, { key, projectId: project.id, content: file.content });
    files.push({ path: file.path, binary: true, content: '', assetKey: key });
  }
  return { project: { ...project, storageVersion: 3, files }, assets: [...assets.values()] };
}

export async function putPrepared(tx: Tx, prepared: PreparedProject, writeProject = true) {
  const store = tx.objectStore('assets');
  const existing = new Set(await store.index('projectId').getAllKeys(prepared.project.id));
  for (const asset of prepared.assets) {
    if (existing.has(asset.key)) continue;
    // Store raw immutable binary data once. Ordinary text edits only write the small project record.
    await store.put({
      key: asset.key,
      projectId: asset.projectId,
      blob: new Blob([base64ToBytes(asset.content)]),
    });
  }
  if (writeProject) await tx.objectStore('projects').put(prepared.project);
}

export async function hydrateProject(
  project: StoredProject,
  db: IDBPDatabase,
  cache = new Map<string, Promise<string>>(),
): Promise<Project> {
  const files: ProjectFile[] = [];
  for (const file of project.files) {
    if (!file.assetKey) {
      files.push(file);
      continue;
    }
    const key = file.assetKey;
    if (!file.binary || !key.startsWith(project.id + ':'))
      throw new Error('项目资源引用无效，未载入。');
    if (!cache.has(key))
      cache.set(
        key,
        (async () => {
          const saved = await db.get('assets', key);
          if (!saved || saved.projectId !== project.id || !(saved.blob instanceof Blob))
            throw new Error(`项目资源缺失：${file.path}。请从原文件夹或备份重新导入。`);
          return bytesToBase64(new Uint8Array(await saved.blob.arrayBuffer()));
        })(),
      );
    const content = await cache.get(key)!;
    const hydrated = { path: file.path, binary: true, content };
    identities.set(hydrated, { content, digest: key.slice(project.id.length + 1) });
    files.push(hydrated);
  }
  const { storageVersion: _, ...data } = project;
  return { ...data, files };
}

export function sameStoredFiles(
  saved: StoredFile[],
  current: ProjectFile[],
  prepared: StoredFile[],
): boolean {
  return (
    saved.length === current.length &&
    saved.every(
      (file, i) =>
        file.path === current[i].path &&
        !!file.binary === !!current[i].binary &&
        (file.assetKey
          ? file.assetKey === prepared[i].assetKey
          : file.content === current[i].content),
    )
  );
}

export async function collectUnusedAssets(db: IDBPDatabase, projectId: string) {
  const tx = db.transaction(['projects', 'settings', 'assets'], 'readwrite');
  const used = new Set<string>();
  const add = (project?: StoredProject) =>
    project?.files.forEach((f) => {
      if (f.assetKey) used.add(f.assetKey);
    });
  add(await tx.objectStore('projects').get(projectId));
  const prefix = 'backup:' + projectId + ':';
  for (const backup of await tx
    .objectStore('settings')
    .getAll(IDBKeyRange.bound(prefix, prefix + '\uffff')))
    add(backup.project);
  const assets = tx.objectStore('assets');
  for (const key of await assets.index('projectId').getAllKeys(projectId))
    if (!used.has(String(key))) await assets.delete(key);
  await tx.done;
}
