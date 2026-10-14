const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { readDirectory, saveDirectory, validateSnapshot } = require('./workspace.cjs');

// Native paths never come from renderer input. Bindings survive project switches and restarts.
class ProjectLibrary {
  constructor(directory) {
    this.directory = directory;
    this.entries = new Map();
  }
  async init() {
    await fs.mkdir(this.directory, { recursive: true });
    this.projectsRoot = path.join(this.directory, 'projects');
    try {
      this.projectsRoot =
        JSON.parse(await fs.readFile(path.join(this.directory, 'storage.json'), 'utf8'))
          .projectsRoot || this.projectsRoot;
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    try {
      const entries = JSON.parse(
        await fs.readFile(path.join(this.directory, 'projects.json'), 'utf8'),
      );
      this.entries = new Map(entries.map((entry) => [entry.id, entry]));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  async persist() {
    const target = path.join(this.directory, 'projects.json');
    const temp = target + '.tmp';
    await fs.writeFile(temp, JSON.stringify([...this.entries.values()]));
    await fs.rename(temp, target);
  }
  async setRoot(root) {
    root = await fs.realpath(root);
    if (!(await fs.stat(root)).isDirectory()) throw new Error('请选择文件夹。');
    // Only new managed projects use this path; existing bindings remain valid.
    const target = path.join(this.directory, 'storage.json');
    await fs.writeFile(target + '.tmp', JSON.stringify({ projectsRoot: root }));
    await fs.rename(target + '.tmp', target);
    this.projectsRoot = root;
    return root;
  }
  async createProjectDirectory(name) {
    // Keep project IDs separate from paths; use portable, collision-safe display names.
    let base =
      String(name || '未命名项目')
        .normalize('NFC')
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
        .replace(/^[. ]+|[. ]+$/g, '')
        .slice(0, 80)
        .replace(/[. ]+$/g, '') || '未命名项目';
    if (/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(base)) base = '_' + base;
    await fs.mkdir(this.projectsRoot, { recursive: true });
    for (let n = 1; n <= 10000; n++) {
      const candidate = n === 1 ? base : `${base} (${n})`;
      // Avoid case-only collisions even when created on a case-sensitive platform.
      const existing = await fs.readdir(this.projectsRoot);
      if (
        existing.some((entry) => entry.normalize('NFC').toLowerCase() === candidate.toLowerCase())
      )
        continue;
      const root = path.join(this.projectsRoot, candidate);
      try {
        await fs.mkdir(root);
        return root;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
    }
    throw new Error('同名项目过多，请更改项目名称。');
  }
  async relocate(project) {
    validateSnapshot(project);
    const original = this.entries.get(project.id);
    if (!original) throw new Error('请先保存项目。');
    const root = await this.createProjectDirectory(project.name);
    const hashes = await saveDirectory(root, project);
    const entry = { ...original, root, kind: 'managed', hashes: [...hashes] };
    this.entries.set(project.id, entry);
    try {
      await this.persist();
    } catch (e) {
      this.entries.set(project.id, original);
      throw e;
    }
    return { ...project, location: { kind: 'managed', directory: root } };
  }
  async link(root) {
    root = await fs.realpath(root);
    const existing = [...this.entries.values()].find((e) =>
      process.platform === 'win32' ? e.root.toLowerCase() === root.toLowerCase() : e.root === root,
    );
    const data = await readDirectory(root);
    const entry = {
      id: existing?.id || randomUUID(),
      root,
      kind: 'linked',
      name: existing?.name,
      hashes: [...data.hashes],
    };
    const project = this.snapshot(entry, data);
    validateSnapshot(project);
    this.entries.set(entry.id, entry);
    await this.persist();
    return project;
  }
  snapshot(entry, data) {
    const mainFile =
      data.files.find((f) => f.path === data.settings.mainFile)?.path ||
      data.files.find((f) => /\.tex$/i.test(f.path))?.path ||
      '';
    return {
      id: entry.id,
      name: entry.name || data.settings.name || path.basename(entry.root),
      files: data.files,
      folders: data.folders,
      mainFile,
      activeFile: mainFile || data.files[0]?.path || '',
      engine: data.settings.engine || 'pdflatex',
      revision: 0,
      updatedAt: Date.now(),
      location: { kind: entry.kind, directory: entry.root },
    };
  }
  async reopen(id) {
    const entry = this.entries.get(id);
    if (!entry) return null;
    const data = await readDirectory(entry.root);
    const project = this.snapshot(entry, data);
    validateSnapshot(project);
    entry.hashes = [...data.hashes];
    await this.persist();
    return project;
  }
  async rename(id, name) {
    if (typeof id !== 'string' || typeof name !== 'string' || !name.trim() || name.length > 100)
      throw new Error('项目名称应为 1–100 个字符。');
    const entry = this.entries.get(id);
    if (!entry) throw new Error('项目尚未保存到磁盘。');
    const previous = entry.name;
    entry.name = name.trim();
    try {
      await this.persist();
    } catch (e) {
      entry.name = previous;
      throw e;
    }
  }
  async list() {
    const projects = [];
    for (const entry of this.entries.values()) {
      // Listing does not advance conflict baselines or discard recovery snapshots.
      try {
        projects.push(validateSnapshot(this.snapshot(entry, await readDirectory(entry.root))));
      } catch {}
    }
    return projects;
  }
  async remove(id, deleteFiles = false, protectedPaths = []) {
    if (typeof id !== 'string' || typeof deleteFiles !== 'boolean')
      throw new Error('无效的删除请求。');
    const entry = this.entries.get(id);
    if (!entry) return;
    if (deleteFiles) {
      const root = path.resolve(entry.root);
      const same = (a, b) =>
        process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
      const contains = (a, b) =>
        same(a, b) ||
        (process.platform === 'win32'
          ? b.toLowerCase().startsWith(a.toLowerCase() + path.sep)
          : b.startsWith(a + path.sep));
      if (
        same(root, path.parse(root).root) ||
        [this.directory, this.projectsRoot, ...protectedPaths].some((p) =>
          contains(root, path.resolve(p)),
        ) ||
        [...this.entries.values()].some(
          (p) =>
            p.id !== id &&
            (contains(root, path.resolve(p.root)) || contains(path.resolve(p.root), root)),
        )
      )
        throw new Error(
          '该目录包含其他项目或系统目录，不能删除本地文件；可取消勾选后移除项目记录。',
        );
      try {
        const actual = await fs.realpath(root);
        if (!same(actual, root) || (await fs.lstat(root)).isSymbolicLink())
          throw new Error('项目目录路径发生变化，未删除本地文件。');
        // The checked registered project directory is the only recursive deletion target.
        await fs.rm(root, { recursive: true, force: false });
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
    }
    this.entries.delete(id);
    try {
      await this.persist();
    } catch (e) {
      this.entries.set(id, entry);
      throw e;
    }
  }
  async clearSyncBackups() {
    const root = path.join(this.directory, 'sync-backups');
    try {
      if ((await fs.lstat(root)).isSymbolicLink())
        throw new Error('备份目录路径发生变化，未清理。');
      const actual = await fs.realpath(root),
        parent = await fs.realpath(this.directory);
      if (path.dirname(actual) !== parent) throw new Error('备份目录不在应用存储目录中，未清理。');
      for (const entry of await fs.readdir(root, { withFileTypes: true }))
        if (entry.isFile() && /^[a-f0-9-]{36}\.json$/.test(entry.name))
          await fs.unlink(path.join(actual, entry.name));
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  }
  async import(project) {
    validateSnapshot(project);
    const id = randomUUID();
    const root = await this.createProjectDirectory(project.name);
    const hashes = await saveDirectory(root, project);
    const entry = { id, root, kind: 'managed', hashes: [...hashes] };
    this.entries.set(id, entry);
    await this.persist();
    return { ...project, id, location: { kind: entry.kind, directory: root } };
  }
  async save(project, removals = [], sync = false, removedFolders = []) {
    validateSnapshot(project);
    let entry = this.entries.get(project.id);
    if (!entry) {
      // IDs are renderer data; never use them as a filesystem path.
      const root = await this.createProjectDirectory(project.name);
      entry = { id: project.id, root, kind: 'managed', hashes: [] };
    }
    const hashes = await saveDirectory(
      entry.root,
      project,
      new Map(entry.hashes),
      removals,
      sync,
      removedFolders,
    );
    entry.hashes = [...hashes];
    entry.name = project.name;
    this.entries.set(project.id, entry);
    await this.persist();
    return { directory: entry.root, kind: entry.kind };
  }
}
module.exports = { ProjectLibrary };
