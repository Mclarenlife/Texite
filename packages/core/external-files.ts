import { base64ToBytes } from './binary';
import { validateProject, type Project, type DiskChanges, type ProjectFile } from './model';

async function digest(file: ProjectFile) {
  const bytes = file.binary ? base64ToBytes(file.content) : new TextEncoder().encode(file.content);
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.buffer)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}
export async function mergeExternalFiles(project: Project, delta: DiskChanges) {
  const files = new Map(project.files.map((f) => [f.path, f]));
  const conflicts = new Set<string>();
  const folders = new Set(project.folders);
  for (const { path, before, file } of delta.changes) {
    const local = files.get(path);
    const identical =
      file && local && !!file.binary === !!local.binary && file.content === local.content;
    if (!identical && (file || local) && (local ? await digest(local) : null) !== before)
      conflicts.add(path);
    if (!file) files.delete(path);
  }
  for (const name of delta.removed) folders.delete(name);
  for (const name of delta.added) folders.add(name);
  // External file/directory replacements can also collide with unsaved children.
  const incomingNames = new Map(
    delta.changes.filter((c) => c.file).map((c) => [c.path.toLowerCase(), c.path]),
  );
  const diskFiles = new Set(delta.changes.filter((c) => c.file).map((c) => c.path.toLowerCase()));
  const diskDirs = new Set(delta.added.map((name) => name.toLowerCase()));
  for (const name of diskFiles) {
    const parts = name.split('/');
    while (parts.length > 1) {
      parts.pop();
      diskDirs.add(parts.join('/'));
    }
  }
  function belowDiskFile(name: string) {
    const parts = name.toLowerCase().split('/');
    while (parts.length > 1) {
      parts.pop();
      if (diskFiles.has(parts.join('/'))) return true;
    }
    return false;
  }
  for (const name of files.keys())
    if (
      diskDirs.has(name.toLowerCase()) ||
      belowDiskFile(name) ||
      (incomingNames.has(name.toLowerCase()) && incomingNames.get(name.toLowerCase()) !== name)
    ) {
      conflicts.add(name);
      files.delete(name);
    }
  for (const name of folders)
    if (diskFiles.has(name.toLowerCase()) || belowDiskFile(name)) folders.delete(name);
  for (const { path, file } of delta.changes) if (file) files.set(path, file);
  return {
    project: validateProject({
      ...project,
      files: [...files.values()],
      folders: [...folders],
      revision: project.revision + 1,
      updatedAt: Date.now(),
    }),
    conflicts: [...conflicts],
  };
}
