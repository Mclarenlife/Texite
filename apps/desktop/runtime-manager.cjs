const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const JSZip = require('jszip');
const hash = (data) => crypto.createHash('sha256').update(data).digest('hex');
const identifier = (id) => typeof id === 'string' && /^[a-z][a-z0-9.-]{0,100}$/.test(id);
async function move(source, target) {
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(source, target);
      return;
    } catch (error) {
      if (
        process.platform !== 'win32' ||
        !['EPERM', 'EBUSY', 'EACCES'].includes(error.code) ||
        attempt >= 9
      )
        throw error;
      // Windows scanners can briefly hold a just-executed DLL or new directory.
      await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
    }
  }
}
const removeTree = (target) =>
  fs.rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
function safeFile(name) {
  if (
    typeof name !== 'string' ||
    /[\\:<>|?*\x00-\x1f]/.test(name) ||
    name.startsWith('/') ||
    name
      .split('/')
      .some(
        (v) =>
          !v ||
          v === '.' ||
          v === '..' ||
          /[. ]$/.test(v) ||
          /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(v),
      )
  )
    throw new Error('扩展包含不安全的文件路径。');
  return name;
}
async function indexModule(directory, module) {
  const folders = new Map([['.', new Set()]]);
  for (const name of Object.keys(module.files).filter((n) => n.startsWith('texmf-dist/'))) {
    const relative = name.slice('texmf-dist/'.length);
    const pieces = relative.split('/');
    let folder = '.';
    for (const piece of pieces) {
      if (!folders.has(folder)) folders.set(folder, new Set());
      folders.get(folder).add(piece);
      folder += '/' + piece;
    }
  }
  if (folders.get('.').size) {
    const db =
      '% ls-R -- filename database for kpathsea; do not change this line.\n' +
      [...folders]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([dir, files]) => '\n' + dir + ':\n' + [...files].sort().join('\n'))
        .join('\n') +
      '\n';
    await fs.writeFile(path.join(directory, 'texmf-dist', 'ls-R'), db);
  }
}
class RuntimeManager {
  constructor(runtime, directory) {
    this.runtime = path.resolve(runtime);
    this.directory = path.resolve(directory);
    this.queue = Promise.resolve();
  }
  exclusive(action) {
    const next = this.queue.catch(() => {}).then(action);
    this.queue = next;
    return next;
  }
  async state() {
    try {
      return JSON.parse(await fs.readFile(path.join(this.directory, 'state.json'), 'utf8'));
    } catch (e) {
      if (e.code === 'ENOENT') return { schema: 1, initialized: false, modules: {} };
      throw e;
    }
  }
  async save(state) {
    await fs.mkdir(this.directory, { recursive: true });
    const file = path.join(this.directory, 'state.json');
    const temp = file + '.tmp';
    await fs.writeFile(temp, JSON.stringify(state));
    await move(temp, file);
  }
  modulePath(id) {
    if (!identifier(id)) throw new Error('无效的模块名称。');
    return path.join(this.directory, 'modules', id);
  }
  async readPack(file) {
    const stat = await fs.stat(file);
    if (stat.size > 600_000_000) throw new Error('扩展包超过 600 MB。');
    const zip = await JSZip.loadAsync(await fs.readFile(file));
    const manifestFile = zip.file('pack.json');
    if (!manifestFile || manifestFile._data.uncompressedSize > 10_000_000)
      throw new Error('不是 Texite 离线扩展包。');
    const pack = JSON.parse(await manifestFile.async('string'));
    if (
      pack.schema !== 1 ||
      (pack.platform !== `${process.platform}-${process.arch}` && pack.platform !== 'all') ||
      (pack.texLive !== '2025' && pack.texLive !== 'tectonic-2022')
    )
      throw new Error('扩展包版本或系统架构不兼容，请下载当前平台对应的版本。');
    if (!Array.isArray(pack.modules) || pack.modules.length > 1000)
      throw new Error('扩展模块清单无效。');
    const ids = new Set();
    let total = 0;
    for (const module of pack.modules) {
      if (pack.platform === 'all' && module.kind !== 'package')
        throw new Error('通用资源包不能包含引擎。');
      if (
        !identifier(module.id) ||
        ids.has(module.id) ||
        !['engine', 'package'].includes(module.kind) ||
        typeof module.label !== 'string' ||
        !Array.isArray(module.dependencies) ||
        !module.dependencies.every(identifier) ||
        !module.files
      )
        throw new Error('扩展模块清单无效。');
      if (
        module.kind === 'engine' &&
        (!['pdflatex', 'xelatex', 'lualatex', 'tectonic'].includes(module.engine) ||
          module.id !== 'engine-' + module.engine)
      )
        throw new Error('未知编译器。');
      if (module.kind !== 'engine' && module.id.startsWith('engine-'))
        throw new Error('引擎模块类型无效。');
      let bytes = 0;
      ids.add(module.id);
      for (const [name, meta] of Object.entries(module.files)) {
        safeFile(name);
        if (
          pack.platform === 'all' &&
          (module.kind !== 'package' || !name.startsWith('texmf-dist/'))
        )
          throw new Error('通用资源包不能包含引擎或项目目录外文件。');
        if (
          !Number.isSafeInteger(meta.size) ||
          meta.size < 0 ||
          meta.size > 400_000_000 ||
          !/^[a-f0-9]{64}$/.test(meta.sha256)
        )
          throw new Error('文件校验信息无效。');
        const entry = zip.file(module.id + '/' + name);
        if (!entry || entry._data.uncompressedSize !== meta.size)
          throw new Error('扩展文件不完整：' + name);
        total += meta.size;
        bytes += meta.size;
      }
      module.bytes = bytes;
    }
    if (total > 1_500_000_000) throw new Error('扩展解压后超过 1.5 GB。');
    return { pack, zip };
  }
  async inspect(file) {
    const { pack } = await this.readPack(file);
    return {
      label: pack.label,
      platform: pack.platform,
      modules: pack.modules.map(({ files, ...m }) => m),
    };
  }
  async init() {
    return this.exclusive(async () => {
      if (!(await this.state()).initialized)
        await this.installUnlocked(path.join(this.runtime, 'default.texite-runtime.zip'));
    });
  }
  async install(file, selected) {
    return this.exclusive(() => this.installUnlocked(file, selected));
  }
  async installUnlocked(file, selected) {
    const { pack, zip } = await this.readPack(file);
    const state = await this.state();
    const catalog = new Map(pack.modules.map((m) => [m.id, m]));
    const wanted = new Set();
    function select(id) {
      if (wanted.has(id)) return;
      if (state.modules[id]) return;
      const m = catalog.get(id);
      if (!m) throw new Error('缺少依赖：' + id + '。请先恢复默认环境或导入包含此依赖的扩展包。');
      wanted.add(id);
      m.dependencies.forEach(select);
    }
    (selected || [...catalog.keys()]).forEach(select);
    await fs.mkdir(path.join(this.directory, 'modules'), { recursive: true });
    const stage = await fs.mkdtemp(path.join(this.directory, 'import-'));
    const moved = [];
    try {
      for (const id of wanted) {
        const m = catalog.get(id);
        for (const [name, meta] of Object.entries(m.files)) {
          const data = await zip.file(id + '/' + name).async('nodebuffer');
          if (hash(data) !== meta.sha256) throw new Error('扩展文件校验失败：' + name);
          const target = path.join(stage, id, name);
          await fs.mkdir(path.dirname(target), { recursive: true });
          await fs.writeFile(target, data, { mode: name.startsWith('bin/') ? 0o755 : 0o644 });
        }
        await fs.mkdir(path.join(stage, id), { recursive: true });
        await indexModule(path.join(stage, id), m);
      }
      for (const id of wanted) {
        const target = this.modulePath(id);
        // A directory left by an interrupted import is not active until state.json commits.
        await removeTree(target);
        await move(path.join(stage, id), target);
        moved.push(target);
        state.modules[id] = catalog.get(id);
      }
      state.initialized = true;
      await this.save(state);
    } catch (error) {
      for (const target of moved) await removeTree(target);
      throw error;
    } finally {
      await removeTree(stage);
    }
    return this.list();
  }
  async list() {
    const state = await this.state();
    return Object.values(state.modules)
      .map(({ files, ...m }) => ({
        ...m,
        requiredBy: Object.values(state.modules)
          .filter((other) => other.dependencies.includes(m.id))
          .map((other) => other.label),
      }))
      .sort((a, b) =>
        a.kind === b.kind ? a.label.localeCompare(b.label) : a.kind === 'engine' ? -1 : 1,
      );
  }
  async remove(id) {
    return this.exclusive(async () => {
      const state = await this.state();
      const m = state.modules[id];
      if (!m) throw new Error('模块未安装。');
      const dependents = Object.values(state.modules).filter((other) =>
        other.dependencies.includes(id),
      );
      if (dependents.length)
        throw new Error('仍被以下模块使用：' + dependents.map((m) => m.label).join('、'));
      const source = this.modulePath(id);
      const backup = path.join(this.directory, 'remove-' + crypto.randomUUID());
      await move(source, backup);
      delete state.modules[id];
      try {
        await this.save(state);
      } catch (error) {
        await move(backup, source);
        throw error;
      }
      await removeTree(backup);
      await removeTree(path.join(this.directory, 'cache'));
      // Formats may include removed macros. Never reuse them after a module change.
      return this.list();
    });
  }
  async environment(engine, work) {
    const state = await this.state();
    const module = state.modules['engine-' + engine];
    if (!module)
      throw new Error(`${engine} 未安装。请在设置中导入对应的离线引擎包；不会自动切换到其他引擎。`);
    const identity = hash(
      JSON.stringify(Object.values(state.modules).map((m) => [m.id, m.files])),
    ).slice(0, 20);
    const cache = path.join(this.directory, 'cache', identity, engine);
    await fs.mkdir(cache, { recursive: true });
    if (engine === 'tectonic')
      return {
        module,
        cache,
        binary: path.join(
          this.modulePath(module.id),
          'bin',
          process.platform === 'win32' ? 'tectonic.exe' : 'tectonic',
        ),
        bundle: path.join(this.modulePath(module.id), 'texlive.zip'),
      };
    const sep = (p) => p.replaceAll('\\', '/');
    const resourceIds = Object.keys(state.modules).filter((id) =>
      Object.keys(state.modules[id].files).some((n) => n.startsWith('texmf-dist/')),
    );
    for (const id of resourceIds) {
      try {
        await fs.access(path.join(this.modulePath(id), 'texmf-dist', 'ls-R'));
      } catch {
        await indexModule(this.modulePath(id), state.modules[id]);
      }
    }
    const roots = [
      cache,
      ...resourceIds
        .sort((a, b) =>
          a === 'texite-config' ? -1 : b === 'texite-config' ? 1 : a.localeCompare(b),
        )
        .map((id) => '!!' + path.join(this.modulePath(id), 'texmf-dist')),
    ];
    const config = await fs.readFile(
      path.join(this.modulePath('texite-config'), 'texmf-dist/web2c/texmf.cnf'),
      'utf8',
    );
    await fs.writeFile(
      path.join(cache, 'texmf.cnf'),
      `TEXMF = {${roots.map(sep).join(',')}}\nTEXMFDBS = $TEXMF\nBIBINPUTS = .;$TEXITE_PROJECT_ROOT//;$TEXMF/bibtex/bib//\nBSTINPUTS = .;$TEXITE_PROJECT_ROOT//;$TEXMF/bibtex/bst//\n${config}`,
    );
    const map = [];
    for (const m of Object.values(state.modules)) {
      for (const name of m.maps || []) {
        const file = Object.keys(m.files).find((p) => path.posix.basename(p) === name);
        if (file) map.push(await fs.readFile(path.join(this.modulePath(m.id), file), 'utf8'));
      }
    }
    await fs.mkdir(path.join(cache, 'fonts/map'), { recursive: true });
    const uniqueMaps = new Map();
    for (const line of map.join('\n').split(/\r?\n/)) {
      const key = line.trim().split(/\s+/)[0];
      if (key && !key.startsWith('%') && !uniqueMaps.has(key)) uniqueMaps.set(key, line);
    }
    // updmap includes Base35 mappings separately from package addMap directives.
    // The pinned public-domain URW map embeds the already bundled Type 1 fonts.
    // Only expose entries whose metrics, encodings and outlines remain installed.
    const installedFiles = new Set(
      Object.values(state.modules).flatMap((m) =>
        Object.keys(m.files).map((f) => path.posix.basename(f)),
      ),
    );
    // Base1 encoding is distributed with dvips upstream, even for pdfTeX.
    // Keep this small shared encoding with the app, without installing dvips.
    await fs.mkdir(path.join(cache, 'fonts/enc'), { recursive: true });
    await fs.copyFile(path.join(__dirname, 'fonts/8r.enc'), path.join(cache, 'fonts/enc/8r.enc'));
    installedFiles.add('8r.enc');
    const base35 = await fs.readFile(path.join(__dirname, 'fonts/ps2pk35.map'), 'utf8');
    for (const line of base35.split(/\r?\n/)) {
      const key = line.trim().split(/\s+/)[0];
      if (!key || key.startsWith('%') || uniqueMaps.has(key) || !installedFiles.has(key + '.tfm'))
        continue;
      const resources = [...line.matchAll(/<<?\[?([^\s<>]+)/g)].map((match) => match[1]);
      if (resources.length && resources.every((file) => installedFiles.has(file)))
        uniqueMaps.set(key, line);
    }
    await fs.writeFile(
      path.join(cache, 'fonts/map/pdftex.map'),
      [...uniqueMaps.values()].join('\n') + '\n',
    );
    const fonts = Object.keys(state.modules)
      .filter((id) => id === 'opentype-fonts')
      .map((id) => path.join(this.modulePath(id), 'texmf-dist/fonts'));
    await fs.writeFile(
      path.join(cache, 'fonts.conf'),
      `<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig>${fonts.map((p) => `<dir>${sep(p).replaceAll('&', '&amp;').replaceAll('<', '&lt;')}</dir>`).join('')}<cachedir>${sep(cache).replaceAll('&', '&amp;').replaceAll('<', '&lt;')}/fontconfig</cachedir></fontconfig>`,
    );
    const binaryName =
      { pdflatex: 'pdftex', xelatex: 'xetex', lualatex: 'luahbtex' }[engine] +
      (process.platform === 'win32' ? '.exe' : '');
    const bin = path.join(this.modulePath(module.id), 'bin');
    return {
      module,
      cache,
      binary: path.join(bin, binaryName),
      bibtex: path.join(bin, process.platform === 'win32' ? 'bibtex.exe' : 'bibtex'),
      bin,
      env: {
        TEXMFCNF: sep(cache),
        TEXITE_FORMATS: sep(cache),
        TEXMFVAR: sep(cache),
        TEXMFCACHE: sep(cache),
        TEXMFCONFIG: sep(cache),
        FONTCONFIG_FILE: sep(path.join(cache, 'fonts.conf')),
        FC_CACHEDIR: sep(path.join(cache, 'fontconfig')),
        FONTCONFIG_PATH: sep(cache),
        TEXMFOUTPUT: sep(work),
        TEXMFDOTDIR: '.',
        MKTEXFMT: '0',
        MKTEXPK: '0',
        MKTEXTFM: '0',
        shell_escape: 'f',
        openin_any: 'p',
        openout_any: 'p',
      },
    };
  }
}
module.exports = { RuntimeManager, safeFile };
