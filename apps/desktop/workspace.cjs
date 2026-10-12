const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const textPattern = /\.(tex|bib|sty|cls|txt|md|csv|json|bst|tikz)$/i;
const engines = ['xelatex', 'pdflatex', 'lualatex'];
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
    !project.files.length ||
    project.files.length > 500
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
    total += file.content.length;
  }
  if (total > 70 * 1024 * 1024) throw new Error('Project exceeds 50 MB');
  safeRelative(project.mainFile);
  if (
    !project.files.some((f) => f.path === project.mainFile && !f.binary && /\.tex$/i.test(f.path))
  )
    throw new Error('Missing main file');
  if (!Number.isSafeInteger(project.revision)) throw new Error('Invalid revision');
  return project;
}
const digest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
async function readDirectory(root) {
  const files = [];
  const hashes = new Map();
  let total = 0;
  async function visit(relative = '') {
    for (const entry of await fs.readdir(path.join(root, relative), { withFileTypes: true })) {
      if (
        entry.isSymbolicLink() ||
        entry.name.startsWith('.') ||
        ['node_modules', 'build', 'dist'].includes(entry.name)
      )
        continue;
      const name = safeRelative(relative ? relative + '/' + entry.name : entry.name);
      if (entry.isDirectory()) {
        await visit(name);
        continue;
      }
      if (!entry.isFile() || /\.(aux|log|out|toc|fls|fdb_latexmk|synctex\.gz)$/i.test(name))
        continue;
      const stat = await fs.stat(path.join(root, name));
      total += stat.size;
      if (total > 50 * 1024 * 1024 || files.length >= 500)
        throw new Error('初版支持最多 500 个文件、50 MB 的项目。');
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
  return { files, hashes, settings };
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
async function saveDirectory(root, project, hashes = new Map()) {
  validateSnapshot(project);
  const writes = [];
  for (const file of project.files) {
    const target = await ensureSafeDestination(root, file.path);
    const content = Buffer.from(file.content, file.binary ? 'base64' : 'utf8');
    let existing;
    try {
      existing = await fs.readFile(target);
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    if (
      existing &&
      digest(existing) !== hashes.get(file.path) &&
      digest(existing) !== digest(content)
    )
      throw new Error(
        `文件 ${file.path} 已被外部修改或目标目录已有同名文件。请重新打开项目，或另存到空目录。`,
      );
    writes.push({ target, content, name: file.path });
  }
  // Each file is atomic; the whole directory is not a multi-file transaction.
  for (const write of writes) {
    await fs.mkdir(path.dirname(write.target), { recursive: true });
    const temp = write.target + '.texite-' + crypto.randomUUID() + '.tmp';
    try {
      await fs.writeFile(temp, write.content);
      await fs.rename(temp, write.target);
    } finally {
      await fs.rm(temp, { force: true });
    }
    hashes.set(write.name, digest(write.content));
  }
  const metadata = await ensureSafeDestination(root, '.texite.json');
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
async function detectEngines() {
  const values = await Promise.all(['latexmk', ...engines].map(probe));
  return {
    latexmk: values[0],
    engines: Object.fromEntries(engines.map((name, i) => [name, values[i + 1]])),
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
  constructor(cache) {
    this.cache = cache;
    this.active = null;
  }
  async cancel() {
    const job = this.active;
    if (!job) return;
    job.cancelled = true;
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
  async compile(project, onLog = () => {}) {
    validateSnapshot(project);
    if (this.active) throw new Error('已有编译正在进行。');
    const job = { child: null, cancelled: false };
    this.active = job;
    let root;
    let timeout;
    let log = '';
    try {
      const available = await detectEngines();
      if (!available.latexmk || !available.engines[project.engine])
        return {
          success: false,
          revision: project.revision,
          log: `未找到 ${!available.latexmk ? 'latexmk 和 ' : ''}${project.engine}。请安装 TeX Live / MacTeX，或 MiKTeX 与 Perl，并重新启动 Texite。`,
        };
      if (job.cancelled)
        return { success: false, cancelled: true, revision: project.revision, log: '编译已取消。' };
      await fs.mkdir(this.cache, { recursive: true });
      root = await fs.mkdtemp(path.join(this.cache, 'compile-'));
      for (const file of project.files) {
        const target = path.join(root, safeRelative(file.path));
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, file.content, file.binary ? 'base64' : 'utf8');
      }
      if (job.cancelled)
        return { success: false, cancelled: true, revision: project.revision, log: '编译已取消。' };
      const code = await new Promise((resolve) => {
        const child = spawn('latexmk', buildArguments(project), {
          cwd: root,
          env: environment(),
          windowsHide: true,
          shell: false,
          detached: process.platform !== 'win32',
        });
        job.child = child;
        const append = (chunk) => {
          if (log.length < 1_000_000) {
            const text = chunk.toString().slice(0, 1_000_000 - log.length);
            log += text;
            onLog(text);
          }
        };
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
      const stat = await fs.stat(pdfPath);
      if (stat.size > 50 * 1024 * 1024) throw new Error('PDF 超过 50 MB。');
      return {
        success: true,
        revision: project.revision,
        log,
        pdf: [...(await fs.readFile(pdfPath))],
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
