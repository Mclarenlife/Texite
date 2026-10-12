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
      data.files.find((f) => /\.tex$/i.test(f.path))?.path;
    return {
      id: entry.id,
      name: data.settings.name || path.basename(entry.root),
      files: data.files,
      folders: data.folders,
      mainFile,
      activeFile: mainFile,
      engine: data.settings.engine || 'tectonic',
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
  async import(project) {
    validateSnapshot(project);
    const id = randomUUID();
    const root = path.join(this.directory, 'projects', id);
    await fs.mkdir(root, { recursive: true });
    const hashes = await saveDirectory(root, project);
    const entry = { id, root, kind: 'managed', hashes: [...hashes] };
    this.entries.set(id, entry);
    await this.persist();
    return { ...project, id, location: { kind: entry.kind, directory: root } };
  }
  async save(project) {
    validateSnapshot(project);
    let entry = this.entries.get(project.id);
    if (!entry) {
      // IDs are renderer data; never use them as a filesystem path.
      const root = path.join(this.directory, 'projects', randomUUID());
      await fs.mkdir(root, { recursive: true });
      entry = { id: project.id, root, kind: 'managed', hashes: [] };
    }
    const hashes = await saveDirectory(entry.root, project, new Map(entry.hashes));
    entry.hashes = [...hashes];
    this.entries.set(project.id, entry);
    await this.persist();
    return { directory: entry.root, kind: entry.kind };
  }
}
module.exports = { ProjectLibrary };
