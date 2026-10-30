const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { RuntimeManager } = require('./runtime-manager.cjs');
const { compileManaged } = require('./managed-compiler.cjs');
const { readSyncTeX } = require('./synctex.cjs');
const LIMITS = require('./project-limits.json');
const { contentDigest, diskDigest, writeContent } = require('./file-content.cjs');
const { BuildCache } = require('./build-cache.cjs');
const { dependencies, publishAux } = require('./cross-references.cjs');

const textPattern = /\.(tex|bib|sty|cls|txt|md|csv|json|bst|tikz)$/i;
const engines = ['tectonic', 'xelatex', 'pdflatex', 'lualatex'];
function safeRelative(value) {
  if (typeof value !== 'string') throw new Error('Invalid path');
  const name = value.replaceAll('\\', '/');
  if (
    name
      .split('/')
      .some((part) =>
        ['.git', '.hg', '.svn', 'node_modules', '.texite-build'].includes(part.toLowerCase()),
      )
  )
    throw new Error('Reserved project directory');
  if (
    !name ||
    name.startsWith('/') ||
    name
      .split('/')
      .some(
        (p) =>
          !p ||
          p === '.' ||
          p === '..' ||
          /[:\x00-\x1f<>"|?*]/.test(p) ||
          /[. ]$/.test(p) ||
          /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(p),
      )
  )
    throw new Error('Invalid project path');
  return name;
}
function validateSnapshot(project) {
  if (
    !project ||
    !engines.includes(project.engine) ||
    !Array.isArray(project.files) ||
    project.files.length > LIMITS.files
  )
    throw new Error('Invalid project');
  const names = new Set();
  let total = 0;
  for (const file of project.files) {
    safeRelative(file.path);
    if (
      typeof file.content !== 'string' ||
      (file.binary !== undefined && typeof file.binary !== 'boolean')
    )
      throw new Error('Invalid file');
    const key = file.path.toLowerCase();
    if (names.has(key)) throw new Error('Duplicate file');
    names.add(key);
    const bytes = Buffer.byteLength(file.content, file.binary ? 'base64' : 'utf8');
    if (bytes > LIMITS.fileBytes) throw new Error(`文件 ${file.path} 超过 128 MB。`);
    total += bytes;
  }
  if (total > LIMITS.projectBytes) throw new Error('项目总量超过 250 MB。');
  if (
    project.folders &&
    (!Array.isArray(project.folders) || project.folders.length > LIMITS.folders)
  )
    throw new Error('Invalid folders');
  const folders = new Set();
  for (const name of [...(project.folders || []), ...project.files.map((f) => f.path)]) {
    safeRelative(name);
    const parts = name.split('/');
    if (project.folders?.includes(name)) folders.add(name.toLowerCase());
    while (parts.length > 1) {
      parts.pop();
      folders.add(parts.join('/').toLowerCase());
    }
  }
  if ([...folders].some((name) => names.has(name))) throw new Error('File/folder path conflict');
  if (project.mainFile !== '') safeRelative(project.mainFile);
  if (
    !(project.mainFile === '' && !project.files.some((f) => !f.binary && /\.tex$/i.test(f.path))) &&
    !project.files.some((f) => f.path === project.mainFile && !f.binary && /\.tex$/i.test(f.path))
  )
    throw new Error('Missing main file');
  if (!Number.isSafeInteger(project.revision)) throw new Error('Invalid revision');
  return project;
}
const digest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
async function readDirectory(root) {
  const files = [];
  const folders = [];
  const hashes = new Map();
  let total = 0;
  async function visit(relative = '') {
    for (const entry of await fs.readdir(path.join(root, relative), { withFileTypes: true })) {
      if (
        entry.isSymbolicLink() ||
        entry.name.startsWith('.') ||
        ['node_modules', 'build', 'dist', '__MACOSX'].includes(entry.name)
      )
        continue;
      const name = safeRelative(relative ? relative + '/' + entry.name : entry.name);
      if (entry.isDirectory()) {
        if (folders.length >= LIMITS.folders) throw new Error('最多支持 5,000 个文件夹。');
        folders.push(name);
        await visit(name);
        continue;
      }
      if (!entry.isFile() || /\.(log|out|toc|fls|fdb_latexmk|synctex\.gz)$/i.test(name)) continue;
      const stat = await fs.stat(path.join(root, name));
      total += stat.size;
      if (stat.size > LIMITS.fileBytes) throw new Error(`文件 ${name} 超过 128 MB。`);
      if (total > LIMITS.projectBytes || files.length >= LIMITS.files)
        throw new Error('项目超过 5,000 个文件或 250 MB。');
      const bytes = await fs.readFile(path.join(root, name));
      hashes.set(name, digest(bytes));
      files.push({
        path: name,
        content: bytes.toString(textPattern.test(name) ? 'utf8' : 'base64'),
        binary: !textPattern.test(name),
      });
    }
  }
  await visit();
  let settings = {};
  try {
    settings = JSON.parse(await fs.readFile(path.join(root, '.texite.json'), 'utf8'));
  } catch {}
  return { files, folders, hashes, settings };
}
async function ensureSafeDestination(root, name) {
  const base = await fs.realpath(root);
  const rel = safeRelative(name);
  const target = path.resolve(base, rel);
  if (!target.startsWith(base + path.sep)) throw new Error('Path outside project');
  let parent = base;
  for (const part of rel.split('/')) {
    parent = path.join(parent, part);
    try {
      if ((await fs.lstat(parent)).isSymbolicLink())
        throw new Error('Symbolic links are not supported');
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  }
  return target;
}
async function saveDirectory(
  root,
  project,
  hashes = new Map(),
  removals = [],
  sync = false,
  removedFolders = [],
) {
  validateSnapshot(project);
  if (!Array.isArray(removals) || removals.length > (sync ? LIMITS.files : 30))
    throw new Error('Invalid removals');
  const deletes = [];
  if (
    !Array.isArray(removedFolders) ||
    removedFolders.length > LIMITS.folders ||
    (!sync && removedFolders.length)
  )
    throw new Error('Invalid folder removals');
  const foldersToDelete = [...new Set(removedFolders.map(safeRelative))].sort(
    (a, b) => b.split('/').length - a.split('/').length,
  );
  for (const folder of foldersToDelete) {
    if (
      folder.split('/').some((part) => part.startsWith('.')) ||
      project.folders?.some((p) => p === folder || p.startsWith(folder + '/')) ||
      project.files.some((f) => f.path.startsWith(folder + '/'))
    )
      throw new Error('Invalid folder removal');
    const target = await ensureSafeDestination(root, folder);
    let entries;
    try {
      entries = await fs.readdir(target, { withFileTypes: true });
    } catch (e) {
      if (e.code === 'ENOENT') continue;
      throw e;
    }
    for (const entry of entries) {
      const name = folder + '/' + entry.name;
      if (
        entry.isSymbolicLink() ||
        (entry.isDirectory()
          ? !foldersToDelete.includes(name)
          : !entry.isFile() || !removals.some((item) => item.path === name))
      )
        throw new Error(
          `文件夹 ${folder} 含有未载入或外部新增内容，未删除。请重新打开项目后重试。`,
        );
    }
  }
  const removalNames = new Set();
  for (const item of removals) {
    const name = safeRelative(item.path);
    if (removalNames.has(name.toLowerCase())) throw new Error('Duplicate removal');
    removalNames.add(name.toLowerCase());
    if (
      typeof item.expected !== 'string' ||
      (!sync && !textPattern.test(name)) ||
      name.split('/').some((part) => part.startsWith('.')) ||
      project.files.some((f) => f.path.toLowerCase() === name.toLowerCase())
    )
      throw new Error('Invalid removal');
    const target = await ensureSafeDestination(root, name);
    let bytes;
    try {
      bytes = await fs.readFile(target);
    } catch (e) {
      if (e.code === 'ENOENT') continue;
      throw e;
    }
    if (
      bytes.toString(sync && item.binary ? 'base64' : 'utf8') !== item.expected ||
      digest(bytes) !== hashes.get(name)
    )
      throw new Error(`文件 ${name} 已被外部修改，未删除。`);
    deletes.push({ target, name, expected: digest(bytes) });
  }
  const writes = [];
  const unchanged = [];
  for (const file of project.files) {
    const target = await ensureSafeDestination(root, file.path);
    const incoming = contentDigest(file);
    const existing = await diskDigest(target);
    if (existing && existing !== hashes.get(file.path) && existing !== incoming)
      throw new Error(
        `文件 ${file.path} 已被外部修改或目标目录已有同名文件。请重新打开项目，或另存到空目录。`,
      );
    if (existing === incoming) unchanged.push([file.path, incoming]);
    else writes.push({ target, file, incoming, existing, name: file.path });
  }
  // Each file is atomic; the whole directory is not a multi-file transaction.
  for (const folder of project.folders || [])
    await fs.mkdir(await ensureSafeDestination(root, folder), { recursive: true });
  for (const write of writes) {
    await fs.mkdir(path.dirname(write.target), { recursive: true });
    const temp = write.target + '.texite-' + crypto.randomUUID() + '.tmp';
    try {
      await writeContent(temp, write.file);
      if ((await diskDigest(write.target)) !== write.existing)
        throw new Error(`文件 ${write.name} 在保存期间被外部修改，未覆盖。`);
      await fs.rename(temp, write.target);
    } finally {
      await fs.rm(temp, { force: true });
    }
    hashes.set(write.name, write.incoming);
  }
  for (const [name, hash] of unchanged) hashes.set(name, hash);
  for (const item of deletes) {
    if (digest(await fs.readFile(item.target)) !== item.expected)
      throw new Error(`文件 ${item.name} 已被外部修改，未删除。`);
    await fs.unlink(item.target);
    hashes.delete(item.name);
  }
  const metadata = await ensureSafeDestination(root, '.texite.json');
  // Only remove empty directories after individually verified files; never recurse over unknown disk content.
  for (const folder of foldersToDelete) {
    try {
      await fs.rmdir(await ensureSafeDestination(root, folder));
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  }
  await fs.writeFile(
    metadata,
    JSON.stringify(
      { version: 1, name: project.name, mainFile: project.mainFile, engine: project.engine },
      null,
      2,
    ),
  );
  return hashes;
}
function environment() {
  const extra = process.platform === 'darwin' ? '/Library/TeX/texbin' : null;
  return {
    ...process.env,
    ...(extra ? { PATH: extra + path.delimiter + (process.env.PATH || '') } : {}),
    openin_any: 'p',
    openout_any: 'p',
    shell_escape: 'f',
  };
}
function probe(command) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (value) => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        resolve(value);
      }
    };
    const child = spawn(command, ['--version'], {
      windowsHide: true,
      env: environment(),
      stdio: 'ignore',
      shell: false,
    });
    const timer = setTimeout(() => {
      child.kill();
      finish(false);
    }, 6000);
    child.on('error', () => finish(false));
    child.on('exit', (code) => finish(code === 0));
  });
}
async function detectEngines(runtime, manager) {
  if (runtime) {
    manager ||= new RuntimeManager(runtime, path.join(runtime, '.detection'));
    await manager.init();
    const installed = await manager.list();
    return {
      bundled: true,
      latexmk: false,
      engines: Object.fromEntries(
        engines.map((engine) => [engine, installed.some((m) => m.engine === engine)]),
      ),
      details: Object.fromEntries(
        installed
          .filter((m) => m.engine)
          .map((m) => [m.engine, `${m.label} · ${m.version} · 离线`]),
      ),
    };
  }
  const system = engines.filter((e) => e !== 'tectonic');
  const values = await Promise.all(['latexmk', ...system].map(probe));
  let bundled = false;
  if (runtime) {
    try {
      await fs.access(
        path.join(runtime, process.platform === 'win32' ? 'tectonic.exe' : 'tectonic'),
      );
      await fs.access(path.join(runtime, 'texlive.zip'));
      bundled = true;
    } catch {}
  }
  return {
    bundled,
    latexmk: values[0],
    engines: {
      tectonic: bundled,
      ...Object.fromEntries(system.map((name, i) => [name, values[i + 1]])),
    },
  };
}
function buildArguments(project) {
  const flag = { xelatex: '-xelatex', pdflatex: '-pdf', lualatex: '-lualatex' }[project.engine];
  return [
    '-norc',
    flag,
    '-interaction=nonstopmode',
    '-file-line-error',
    '-halt-on-error',
    '-no-shell-escape',
    '-synctex=1',
    '-outdir=.texite-build',
    './' + safeRelative(project.mainFile),
  ];
}
class Compiler {
  constructor(cache, runtime, manager) {
    this.cache = cache;
    this.runtime = runtime;
    this.manager =
      manager ||
      (runtime ? new RuntimeManager(runtime, path.join(cache, 'runtime-modules')) : null);
    this.active = null;
    this.builds = new BuildCache(cache);
  }
  async cancel() {
    const job = this.active;
    if (!job) return;
    job.cancelled = true;
    if (job.worker) await job.worker.terminate();
    const child = job.child;
    if (!child?.pid) return;
    if (process.platform === 'win32') {
      await new Promise((resolve) => {
        const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
        });
        killer.on('exit', resolve);
        killer.on('error', () => {
          child.kill();
          resolve();
        });
      });
    } else {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    }
  }
  async exportBuild(buildId, filename, target) {
    if (this.active) throw new Error('请等待编译完成后导出。');
    this.active = { exporting: true };
    try {
      await this.builds.exportTo(buildId, filename, target);
    } finally {
      this.active = null;
    }
  }
  async compile(project, onLog = () => {}, options = {}) {
    validateSnapshot(project);
    if (!project.mainFile) throw new Error('请先创建 .tex 文件并设为主文件，再编译。');
    if (this.active) throw new Error('已有编译正在进行。');
    const job = { child: null, cancelled: false };
    this.active = job;
    let root;
    let timeout;
    let log = '';
    try {
      if (!this.manager) {
        const available = await detectEngines();
        if (
          project.engine === 'tectonic' ||
          !available.latexmk ||
          !available.engines[project.engine]
        )
          return {
            success: false,
            revision: project.revision,
            log: `${project.engine} 未安装。不会自动切换编译器。`,
          };
      }
      if (job.cancelled)
        return { success: false, cancelled: true, revision: project.revision, log: '编译已取消。' };
      await fs.mkdir(this.cache, { recursive: true });
      if (this.manager) {
        await this.manager.init();
        const environment = crypto
          .createHash('sha256')
          .update(JSON.stringify([1, await this.manager.state(), this.toolSettings || {}]))
          .digest('hex');
        job.build = await this.builds.prepare(project, environment, options.clean === true);
        root = job.build.root;
      } else root = await fs.mkdtemp(path.join(this.cache, 'compile-'));
      await fs.mkdir(path.join(root, '.texite-build'), { recursive: true });
      for (const folder of project.folders || [])
        await fs.mkdir(path.join(root, safeRelative(folder)), { recursive: true });
      for (const file of project.files) {
        const target = path.join(root, safeRelative(file.path));
        await fs.mkdir(path.dirname(target), { recursive: true });
        if (!job.build) await writeContent(target, file);
        if (/\.tex$/i.test(file.path))
          await fs.mkdir(path.join(root, '.texite-build', path.dirname(safeRelative(file.path))), {
            recursive: true,
          });
      }
      if (job.cancelled)
        return { success: false, cancelled: true, revision: project.revision, log: '编译已取消。' };
      let compilerLabel;
      const append = (text) => {
        if (log.length < 1_000_000) {
          const chunk = text.toString().slice(0, 1_000_000 - log.length);
          log += chunk;
          onLog(chunk);
        }
      };
      let managed = null;
      if (this.manager) {
        append(
          job.build.reused
            ? `复用项目编译缓存 · 更新 ${job.build.writes} 个文件\n`
            : '建立项目编译缓存\n',
        );
        const graph = dependencies(project);
        let previousReferences = '';
        // Cycles can change pagination in other documents, so iterate until AUX content settles.
        for (let sweep = 0; sweep < (graph.cyclic ? 6 : 1); sweep++) {
          for (const item of graph.ordered) {
            if (job.cancelled) break;
            if (item.file !== project.mainFile) append(`\n跨文档引用 · ${item.file}\n`);
            managed = await compileManaged(
              this,
              { ...project, mainFile: item.file },
              root,
              job,
              append,
            );
            if (managed.code !== 0) break;
            await publishAux(
              root,
              graph.cyclic && item.file === project.mainFile
                ? { ...item, outputName: item.file.replace(/\.tex$/i, '.aux') }
                : item,
              project.files,
            );
          }
          if (managed?.code !== 0 || job.cancelled) break;
          if (graph.cyclic) {
            const currentReferences = JSON.stringify(
              await Promise.all(
                graph.ordered.map((item) =>
                  diskDigest(path.join(root, item.file.replace(/\.tex$/i, '.aux'))),
                ),
              ),
            );
            if (currentReferences === previousReferences) break;
            previousReferences = currentReferences;
            if (sweep === 5)
              append('\nLaTeX Warning: 跨文档引用在 6 轮后仍未稳定，请检查循环引用。\n');
          }
        }
      }
      compilerLabel = managed?.label;
      const code = managed
        ? managed.code
        : await new Promise((resolve) => {
            const binary = 'latexmk';
            const args = buildArguments(project);
            append(`实际编译器：${project.engine} · 系统 latexmk\n`);
            const child = spawn(binary, args, {
              cwd: root,
              env: {
                ...environment(),
                TECTONIC_CACHE_DIR: path.join(this.cache, 'formats'),
                ...Object.fromEntries(
                  ['TEXINPUTS', 'BIBINPUTS', 'BSTINPUTS'].map((key) => [
                    key,
                    [
                      path.dirname(path.join(root, project.mainFile)).replaceAll('\\', '/'),
                      root.replaceAll('\\', '/') + '//',
                      '',
                    ].join(path.delimiter),
                  ]),
                ),
              },
              windowsHide: true,
              shell: false,
              detached: process.platform !== 'win32',
            });
            job.child = child;
            child.stdout.on('data', append);
            child.stderr.on('data', append);
            child.on('error', (e) => {
              append(e.message);
              resolve(-1);
            });
            child.on('close', resolve);
            timeout = setTimeout(() => {
              append('\n编译超过 120 秒，已停止。');
              void this.cancel();
            }, 120000);
          });
      if (job.cancelled)
        return { success: false, cancelled: true, revision: project.revision, log };
      if (code !== 0) return { success: false, revision: project.revision, log };
      const pdfPath = path.join(
        root,
        '.texite-build',
        path.basename(project.mainFile).replace(/\.tex$/i, '.pdf'),
      );
      const stat = await fs.stat(pdfPath).catch((error) => {
        if (error.code === 'ENOENT')
          throw new Error('编译没有生成 PDF，请检查文稿是否包含可排版的内容。');
        throw error;
      });
      if (stat.size > LIMITS.pdfBytes) throw new Error('PDF 超过 128 MB。');
      return {
        success: true,
        engine: project.engine,
        compilerLabel: compilerLabel || `${project.engine} · 系统`,
        revision: project.revision,
        log,
        pdf: await fs.readFile(pdfPath),
        syncMap: await readSyncTeX(pdfPath, root, project.files),
        outputs: job.build
          ? await this.builds.finish(job.build, project, compilerLabel)
          : undefined,
      };
    } catch (error) {
      return {
        success: false,
        cancelled: job.cancelled,
        revision: project.revision,
        log: log + '\n' + error.message,
      };
    } finally {
      clearTimeout(timeout);
      this.active = null;
      if (root) {
        const base = path.resolve(this.cache);
        const target = path.resolve(root);
        if (target.startsWith(base + path.sep) && path.basename(target).startsWith('compile-'))
          await fs.rm(target, { recursive: true, force: true });
      }
    }
  }
}
module.exports = {
  safeRelative,
  validateSnapshot,
  readDirectory,
  saveDirectory,
  ensureSafeDestination,
  buildArguments,
  detectEngines,
  Compiler,
};
