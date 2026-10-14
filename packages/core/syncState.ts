import type { Project } from './model';
export async function syncFingerprint(project: Project) {
  const payload = {
    name: project.name,
    engine: project.engine,
    mainFile: project.mainFile,
    files: [...project.files]
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
      .map((f) => ({ path: f.path, content: f.content, binary: !!f.binary })),
    folders: [...(project.folders || [])].sort(),
    revision: 0,
  };
  return [
    ...new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(payload))),
    ),
  ]
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('');
}
