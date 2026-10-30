const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { createReadStream, createWriteStream } = require('node:fs');
const JSZip = require('jszip');
const { contentDigest, diskDigest, writeContent } = require('./file-content.cjs');
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const outputPattern =
  /\.(pdf|pdf_tex|aux|bbl|blg|log|toc|lof|lot|ind|ilg|gls|acr|nls|ist|synctex(?:\.gz)?|bcf|run\.xml)$/i;
async function walk(root, prefix = '') {
  const result = [];
  for (const entry of await fs.readdir(path.join(root, prefix), { withFileTypes: true })) {
    const name = prefix ? prefix + '/' + entry.name : entry.name;
    if (entry.isDirectory()) result.push(...(await walk(root, name)));
    else if (entry.isFile()) result.push(name);
  }
  return result;
}
class BuildCache {
  constructor(root) {
    this.root = path.resolve(root, 'projects');
    this.results = new Map();
  }
  async remove(directory) {
    const target = path.resolve(directory);
    if (path.dirname(target) !== this.root || !/^[a-f0-9]{32}$/.test(path.basename(target)))
      throw new Error('无效的编译缓存路径。');
    await fs.rm(target, { recursive: true, force: true });
  }
  async prepare(project, environment, clean = false) {
    const key = hash(JSON.stringify([project.id, project.mainFile, project.engine])).slice(0, 32);
    const directory = path.join(this.root, key),
      root = path.join(directory, 'work');
    const inputs = Object.fromEntries(project.files.map((f) => [f.path, contentDigest(f)]));
    let state;
    try {
      state = JSON.parse(await fs.readFile(path.join(directory, 'state.json'), 'utf8'));
    } catch {}
    const compatible =
      !clean &&
      state?.version === 1 &&
      state.environment === environment &&
      Object.keys(state.inputs).every((name) => name in inputs);
    if (!compatible) {
      await this.remove(directory);
      state = undefined;
    }
    await fs.mkdir(path.join(root, '.texite-build'), { recursive: true });
    // A crash or failed compilation leaves no valid state and is rebuilt on next use.
    await fs.rm(path.join(directory, 'state.json'), { force: true });
    for (const folder of project.folders || [])
      await fs.mkdir(path.join(root, folder), { recursive: true });
    let writes = 0;
    for (const file of project.files) {
      const target = path.join(root, file.path);
      if ((await diskDigest(target)) !== inputs[file.path]) {
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.rm(target, { force: true });
        await writeContent(target, file);
        writes++;
      }
      if (/\.tex$/i.test(file.path))
        await fs.mkdir(path.join(root, '.texite-build', path.dirname(file.path)), {
          recursive: true,
        });
    }
    const dependencyHash = hash(
      JSON.stringify(
        project.files.filter((f) => !/\.tex$/i.test(f.path)).map((f) => [f.path, inputs[f.path]]),
      ),
    );
    return {
      directory,
      root,
      inputs,
      environment,
      dependencyHash,
      writes,
      reused: !!state,
      tools: state?.dependencyHash === dependencyHash ? state.tools || {} : {},
    };
  }
  async finish(context, project, label) {
    const files = [];
    for (const name of await walk(context.root)) {
      if (name in context.inputs || !outputPattern.test(name)) continue;
      const stat = await fs.stat(path.join(context.root, name));
      if (stat.size <= 128 * 1024 * 1024) files.push({ path: name, bytes: stat.size });
    }
    const buildId = crypto.randomUUID();
    const state = {
      version: 1,
      environment: context.environment,
      inputs: context.inputs,
      dependencyHash: context.dependencyHash,
      tools: context.tools,
      time: Date.now(),
      buildId,
      project: {
        id: project.id,
        name: project.name,
        mainFile: project.mainFile,
        engine: project.engine,
        revision: project.revision,
      },
      files,
      label,
    };
    await fs.writeFile(path.join(context.directory, 'state.json'), JSON.stringify(state));
    for (const [id, old] of this.results)
      if (old.directory === context.directory) this.results.delete(id);
    this.results.set(buildId, { ...context, state });
    await this.prune(context.directory).catch(() => {});
    return { buildId, files };
  }
  async prune(active) {
    const entries = [];
    for (const name of await fs.readdir(this.root)) {
      if (!/^[a-f0-9]{32}$/.test(name)) continue;
      const directory = path.join(this.root, name);
      const stat = await fs.stat(directory);
      let bytes = 0;
      for (const file of await walk(directory))
        bytes += (await fs.stat(path.join(directory, file))).size;
      entries.push({ directory, time: stat.mtimeMs, bytes });
    }
    let bytes = 0;
    for (const [index, entry] of entries
      .sort(
        (a, b) =>
          Number(b.directory === active) - Number(a.directory === active) || b.time - a.time,
      )
      .entries()) {
      bytes += entry.bytes;
      if (entry.directory !== active && (index >= 8 || bytes > 1024 ** 3)) {
        await this.remove(entry.directory);
        for (const [id, value] of this.results)
          if (value.directory === entry.directory) this.results.delete(id);
      }
    }
  }
  async get(buildId) {
    const saved = this.results.get(buildId);
    if (!saved) throw new Error('编译产物已失效，请重新编译后导出。');
    const current = JSON.parse(
      await fs.readFile(path.join(saved.directory, 'state.json'), 'utf8').catch(() => '{}'),
    );
    if (current.buildId !== buildId) throw new Error('编译产物已更新，请重新编译后导出。');
    return saved;
  }
  async exportTo(buildId, filename, target) {
    const saved = await this.get(buildId);
    const temp = target + '.texite-' + crypto.randomUUID() + '.tmp';
    try {
      if (filename) {
        if (!saved.state.files.some((f) => f.path === filename))
          throw new Error('未知的编译产物。');
        const source = path.join(saved.root, filename);
        if (!(await fs.lstat(source)).isFile()) throw new Error('编译产物无效。');
        await fs.copyFile(source, temp, require('node:fs').constants.COPYFILE_EXCL);
      } else {
        const zip = new JSZip();
        for (const [name, expected] of Object.entries(saved.inputs)) {
          const source = path.join(saved.root, name);
          if (!(await fs.lstat(source)).isFile() || (await diskDigest(source)) !== expected)
            throw new Error('编译副本中的源文件已变化，请重新编译后导出。');
          zip.file(name, createReadStream(source));
        }
        for (const file of saved.state.files) {
          // Include required bibliography, external references and converted figures, not logs/caches.
          if (!/\.(bbl|aux|pdf|pdf_tex|ind|gls|acr|nls)$/i.test(file.path)) continue;
          const name = file.path.replace(/^\.texite-build\//, '');
          if (name in saved.inputs || zip.file(name)) continue;
          const source = path.join(saved.root, file.path);
          if (!(await fs.lstat(source)).isFile()) throw new Error('编译产物无效。');
          zip.file(name, createReadStream(source));
        }
        await pipeline(
          zip.generateNodeStream({ streamFiles: true, compression: 'DEFLATE' }),
          createWriteStream(temp, { flags: 'wx' }),
        );
      }
      await fs.rename(temp, target);
    } finally {
      await fs.rm(temp, { force: true }).catch(() => {});
    }
  }
}
module.exports = { BuildCache, walk };
