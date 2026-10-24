import { Capacitor, registerPlugin } from '@capacitor/core';
import type { Project } from '../../packages/core/model';
import { validateProject } from '../../packages/core/model';
import { saveProject, loadProjects, exportZip, download } from '../../packages/platform/storage';

const native = registerPlugin<{
  importZip(): Promise<{ cancelled?: boolean; name?: string; base64?: string }>;
  readProjects(): Promise<{ projects: Project[] }>;
  background(): Promise<void>;
  saveProject(options: { project: Project }): Promise<void>;
  exportFile(options: {
    name: string;
    base64: string;
    mime: string;
  }): Promise<{ cancelled?: boolean }>;
  addListener(name: 'back', callback: () => void): Promise<{ remove(): Promise<void> }>;
}>('TexiteFiles');
export const isAndroid = Capacitor.getPlatform() === 'android';
export const isIOS = Capacitor.getPlatform() === 'ios';
export const isNativeMobile = isAndroid || isIOS;
export const mobilePlatformName = isIOS ? 'iOS' : isAndroid ? 'Android' : 'Mobile';
export async function chooseIOSProject(): Promise<File | undefined> {
  const selected = await native.importZip();
  if (selected.cancelled) return;
  if (!selected.name || !selected.base64) throw new Error('未读取到 ZIP 文件');
  return new File([Uint8Array.from(atob(selected.base64), c => c.charCodeAt(0))], selected.name, { type: 'application/zip' });
}
export function backgroundAndroid() {
  if (isAndroid) return native.background();
}

export async function readMobileProjects(): Promise<Project[]> {
  if (isNativeMobile) return (await native.readProjects()).projects.map(validateProject);
  return (await loadProjects()).projects;
}
// Serialize native and IndexedDB writes: a slow older save must never overwrite newer text.
let writes = Promise.resolve();
export function saveMobileProject(project: Project): Promise<void> {
  const snapshot = structuredClone(project);
  const pending = writes
    .catch(() => {})
    .then(async () => {
      if (isNativeMobile) await native.saveProject({ project: snapshot });
      else await saveProject(snapshot);
    });
  writes = pending;
  return pending;
}
export async function exportMobileFile(blob: Blob, name: string) {
  if (!isNativeMobile) {
    download(blob, name);
    return;
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return native.exportFile({
    name,
    base64: btoa(binary),
    mime: blob.type || 'application/octet-stream',
  });
}
export async function exportMobileProject(project: Project) {
  return exportMobileFile(await exportZip(project), project.name + '.zip');
}
export function onAndroidBack(callback: () => void) {
  return isAndroid
    ? native.addListener('back', callback)
    : Promise.resolve({ remove: async () => {} });
}
