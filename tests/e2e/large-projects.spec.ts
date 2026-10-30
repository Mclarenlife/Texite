import { test, expect } from '@playwright/test';
import JSZip from 'jszip';

test('legacy binary records migrate; failed asset writes roll back; backup deletion collects only unused data', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('textbox', { name: 'LaTeX 源码编辑器' })).toBeVisible();
  const result = await page.evaluate(async () => {
    const storage = await import('/packages/platform/storage.ts');
    const { createProject } = await import('/packages/core/sample.ts');
    const original = createProject();
    const project = {
      ...original,
      id: 'asset-migration-test',
      files: [
        { path: 'main.tex', content: 'old' },
        { path: 'old.bin', binary: true, content: btoa('legacy') },
      ],
    };
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open('texite-workspace');
      r.onsuccess = () => resolve(r.result);
    });
    const read = <T>(r: IDBRequest<T>) =>
      new Promise<T>((resolve, reject) => {
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    await read(db.transaction('projects', 'readwrite').objectStore('projects').put(project));
    const legacy = (await storage.loadProjects()).projects.find(
      (p: { id: string }) => p.id === project.id,
    )!;
    await storage.saveProject(legacy);
    const before = await read(db.transaction('projects').objectStore('projects').get(project.id));
    const next = {
      ...legacy,
      revision: legacy.revision + 1,
      files: [
        { path: 'main.tex', content: 'new' },
        { path: 'new.bin', binary: true, content: btoa('replacement') },
      ],
    };
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'assets')
        throw new DOMException('Simulated storage full', 'QuotaExceededError');
      return put.apply(this, args);
    };
    let failed = false;
    try {
      await storage.saveProject(next);
    } catch {
      failed = true;
    } finally {
      IDBObjectStore.prototype.put = put;
    }
    const after = await read(db.transaction('projects').objectStore('projects').get(project.id));
    const backup = await storage.createProjectBackup(legacy, 'keep legacy binary');
    await storage.saveProject(next);
    const count = () =>
      read(db.transaction('assets').objectStore('assets').index('projectId').count(project.id));
    const withBackup = await count();
    await storage.deleteProjectBackup(project.id, backup.id);
    const withoutBackup = await count();
    const loaded = (await storage.loadProjects()).projects.find(
      (p: { id: string }) => p.id === project.id,
    )!;
    db.close();
    return {
      failed,
      migrated: !!before.files[1].assetKey,
      preserved: JSON.stringify(before) === JSON.stringify(after),
      legacy: legacy.files[1].content,
      withBackup,
      withoutBackup,
      binary: loaded.files[1].content,
    };
  });
  expect(result).toEqual({
    failed: true,
    migrated: true,
    preserved: true,
    legacy: btoa('legacy'),
    withBackup: 2,
    withoutBackup: 1,
    binary: btoa('replacement'),
  });
});

test('large ZIP uses effective file counts, stores assets once, and preserves backups across reload', async ({
  page,
}) => {
  test.setTimeout(180000);
  const zip = new JSZip();
  zip.file(
    'paper/main.tex',
    '\\documentclass{article}\\begin{document}Large project\\end{document}',
  );
  for (let i = 0; i < 600; i++) zip.file(`paper/chapters/p${i}.tex`, 'Chapter ' + i);
  for (let i = 0; i < 5100; i++) zip.file(`__MACOSX/._${i}`, 'ignored');
  zip.file('paper/assets/dataset.bin', Buffer.alloc(65 * 1024 * 1024, 37));
  const data = await zip.generateAsync({
    type: 'base64',
    compression: 'DEFLATE',
    compressionOptions: { level: 1 },
  });
  await page.goto('/');
  await expect(page.getByRole('textbox', { name: 'LaTeX 源码编辑器' })).toBeVisible();
  const result = await page.evaluate(async (encoded) => {
    const storage = await import('/packages/platform/storage.ts');
    const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
    const project = await storage.importZip(new File([bytes], 'Large.zip'));
    const file = project.files.find((f: { binary?: boolean }) => f.binary)!;
    const original = file.content;
    let writes = 0;
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'assets') writes++;
      return put.apply(this, args);
    };
    try {
      await storage.saveProject(project);
      const firstWrites = writes;
      const next = {
        ...project,
        revision: project.revision + 1,
        files: project.files.map((f: { path: string; content: string }) =>
          f.path === 'main.tex' ? { ...f, content: f.content + '\n% updated' } : f,
        ),
      };
      const start = performance.now();
      await storage.saveProject(next);
      const saveMs = performance.now() - start;
      const backup = await storage.createProjectBackup(next, 'binary snapshot');
      const secondWrites = writes;
      const db = await new Promise<IDBDatabase>((resolve) => {
        const r = indexedDB.open('texite-workspace');
        r.onsuccess = () => resolve(r.result);
      });
      const stored = await new Promise<any>((resolve) => {
        const r = db.transaction('projects').objectStore('projects').get(project.id);
        r.onsuccess = () => resolve(r.result);
      });
      db.close();
      await storage.saveProject({
        ...next,
        revision: next.revision + 1,
        files: next.files.filter((f: { binary?: boolean }) => !f.binary),
      });
      const savedBackup = (await storage.readProjectBackups(project.id)).find(
        (b: { id: string }) => b.id === backup.id,
      )!;
      if (
        savedBackup.project.files.find((f: { binary?: boolean }) => f.binary)?.content !== original
      )
        throw new Error('Backup lost binary');
      await storage.saveProject({ ...savedBackup.project, revision: next.revision + 2 });
      const exported = await storage.exportZip(savedBackup.project);
      const imported = await storage.importZip(new File([exported], 'Roundtrip.zip'));
      return {
        id: project.id,
        files: project.files.length,
        firstWrites,
        secondWrites,
        metadataBytes: JSON.stringify(stored).length,
        binaryLength: original.length,
        roundTrip: imported.files.find((f: { binary?: boolean }) => f.binary)?.content === original,
        saveMs,
      };
    } finally {
      IDBObjectStore.prototype.put = put;
    }
  }, data);
  expect(result.files).toBe(602);
  expect(result.firstWrites).toBe(1);
  expect(result.secondWrites).toBe(1);
  expect(result.metadataBytes).toBeLessThan(200000);
  expect(result.roundTrip).toBe(true);
  await page.reload();
  const restored = await page.evaluate(async (id) => {
    const storage = await import('/packages/platform/storage.ts');
    const p = (await storage.loadProjects()).projects.find((p: { id: string }) => p.id === id)!;
    const backups = await storage.readProjectBackups(id);
    return {
      files: p.files.length,
      binaryLength: p.files.find((f: { binary?: boolean }) => f.binary)?.content.length,
      backups: backups.length,
    };
  }, result.id);
  expect(restored).toEqual({ files: 602, binaryLength: result.binaryLength, backups: 1 });
  console.log(
    JSON.stringify({
      largeZip: true,
      files: 602,
      binaryMiB: 65,
      unchangedAssetWrites: 0,
      saveMs: Math.round(result.saveMs),
    }),
  );
});

test('streamed ZIP decoding stops at the actual limit; too many real files are rejected', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { JSZip } = await import('/tests/e2e/zip-fixture.ts');
    const { importZip, readZipEntry } = await import('/packages/platform/storage.ts');
    const zip = new JSZip();
    zip.file('big.txt', 'x'.repeat(200000));
    const loaded = await JSZip.loadAsync(
      await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }),
    );
    let stopped = false,
      countRejected = false;
    try {
      await readZipEntry(loaded.file('big.txt')!, 1024);
    } catch {
      stopped = true;
    }
    const many = new JSZip();
    for (let i = 0; i < 5001; i++) many.file('f' + i + '.tex', 'x');
    try {
      await importZip(new File([await many.generateAsync({ type: 'uint8array' })], 'Many.zip'));
    } catch (e) {
      countRejected = String(e).includes('5,000');
    }
    return { stopped, countRejected };
  });
  expect(result).toEqual({ stopped: true, countRejected: true });
});
