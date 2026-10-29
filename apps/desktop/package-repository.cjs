const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { gunzipSync } = require('node:zlib');
const { installArchive } = require('./texlive-archive.cjs');
const BASE = 'https://ftp.math.utah.edu/pub/tex/historic/systems/texlive/2025/tlnet-final/archive/';
const DATABASE_SHA = '56df038e9070a3d587eeceb5def3f154b2cacccef36d4295bb49e0618977c34a';
const hash = (data) => crypto.createHash('sha512').update(data).digest('hex');
const idValid = (id) => /^pkg-[a-z][a-z0-9.-]{0,96}$/.test(id);
function missingFiles(log) {
  return [
    ...new Set(
      [
        ...log.matchAll(
          /(?:LaTeX Error:\s*File|I can't find file)\s*[`'"]([^`'"\r\n]+)[`'"](?:\s*not found)?/g,
        ),
      ].map((m) => m[1]),
    ),
  ].filter((name) =>
    /^[a-zA-Z0-9_.+-]+\.(sty|cls|def|clo|fd|tex|bst|bbx|cbx|lbx|cfg|tfm|enc|map)$/i.test(name),
  );
}
function validateCatalog(catalog) {
  if (
    !catalog ||
    catalog.schema !== 1 ||
    catalog.texLive !== '2025' ||
    catalog.databaseSha256 !== DATABASE_SHA ||
    !catalog.packages ||
    !catalog.files
  )
    throw new Error('宏包目录与当前 TeX Live 2025 不兼容。');
  for (const [id, p] of Object.entries(catalog.packages)) {
    if (
      !idValid(id) ||
      typeof p.label !== 'string' ||
      !Array.isArray(p.dependencies) ||
      !p.dependencies.every(idValid) ||
      p.archive !== id.slice(4) + '.tar.xz' ||
      !/^[a-f0-9]{128}$/.test(p.sha512) ||
      !Number.isSafeInteger(p.bytes) ||
      p.bytes < 1 ||
      p.bytes > 200000000 ||
      !p.paths
    )
      throw new Error('宏包目录格式无效。');
  }
  return catalog;
}
function packagePlan(catalog, files, installed) {
  const selected = [],
    visited = new Set(),
    visiting = new Set();
  function add(id) {
    if (installed.has(id) || visited.has(id)) return;
    const p = catalog.packages[id];
    if (!p) throw new Error('宏包依赖未收录：' + id);
    if (visiting.has(id)) throw new Error('宏包存在循环依赖，请手动导入：' + id);
    visiting.add(id);
    p.dependencies.forEach(add);
    visiting.delete(id);
    visited.add(id);
    selected.push(id);
  }
  for (const file of files) {
    const matches = catalog.files[file];
    if (!Array.isArray(matches) || matches.length !== 1 || !catalog.packages[matches[0]]) continue;
    add(matches[0]);
  }
  if (
    selected.length > 100 ||
    selected.reduce((n, id) => n + catalog.packages[id].bytes, 0) > 250000000
  )
    throw new Error('依赖下载超过单次 250 MB / 100 个宏包限制，请手动导入离线扩展包。');
  return { selected };
}
class PackageRepository {
  constructor(manager, directory, fetcher = fetch, base = BASE) {
    this.manager = manager;
    this.directory = path.join(directory, 'package-downloads');
    this.fetcher = fetcher;
    this.base = base;
    this.active = null;
    this.catalog = null;
  }
  async settings() {
    try {
      const saved = JSON.parse(
        await fs.readFile(path.join(this.directory, 'settings.json'), 'utf8'),
      );
      return { autoDownload: saved.autoDownload === true };
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      return { autoDownload: true };
    }
  }
  async configure(input) {
    if (this.active) throw new Error('请等待编译或宏包下载结束。');
    if (typeof input?.autoDownload !== 'boolean') throw new Error('宏包下载设置无效。');
    await fs.mkdir(this.directory, { recursive: true });
    await fs.writeFile(
      path.join(this.directory, 'settings.json'),
      JSON.stringify({ autoDownload: input.autoDownload }),
    );
    return this.settings();
  }
  async download(name, maxBytes, signal) {
    const response = await this.fetcher(this.base + name, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(120000)]),
    });
    if (!response.ok)
      throw new Error(`TeX Live 镜像下载失败（HTTP ${response.status}），可重试或导入离线包。`);
    if (!response.body) throw new Error('宏包下载没有返回内容。');
    const reader = response.body.getReader();
    const parts = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > maxBytes) throw new Error('宏包下载超过大小限制。');
        parts.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    return Buffer.concat(parts);
  }
  async loadCatalog(signal) {
    if (!this.catalog) {
      signal.throwIfAborted();
      const bytes = await fs.readFile(path.join(__dirname, 'texlive-2025-catalog.json.gz'));
      this.catalog = validateCatalog(
        JSON.parse(gunzipSync(bytes, { maxOutputLength: 80000000 }).toString('utf8')),
      );
    }
    return this.catalog;
  }
  async installMissing(files, signal, append) {
    const catalog = await this.loadCatalog(signal);
    const installed = new Set((await this.manager.list()).map((m) => m.id));
    const plan = packagePlan(catalog, files, installed);
    if (!plan.selected.length) return [];
    await fs.mkdir(this.directory, { recursive: true });
    for (const id of plan.selected) {
      signal.throwIfAborted();
      const p = catalog.packages[id],
        destination = path.join(this.directory, p.archive);
      let data;
      try {
        data = await fs.readFile(destination);
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
      if (!data || hash(data) !== p.sha512) {
        append(`\n正在从 TeX Live 镜像下载：${p.label}（${(p.bytes / 1000000).toFixed(2)} MB）\n`);
        data = await this.download(p.archive, p.bytes, signal);
        if (data.length !== p.bytes || hash(data) !== p.sha512)
          throw new Error('宏包校验失败，未安装。');
        await fs.writeFile(destination, data);
      }
      signal.throwIfAborted();
      await installArchive(this.manager, id, p, destination, this.directory, signal);
      append(`已安装宏包：${p.label}\n`);
    }
    return plan.selected;
  }
  cancel() {
    this.active?.abort();
  }
  async compile(project, compiler, append) {
    if (this.active) throw new Error('已有编译或宏包下载正在进行。');
    const controller = new AbortController();
    this.active = controller;
    let result,
      progress = '';
    const log = (text) => {
      progress += text;
      append(text);
    };
    try {
      const settings = await this.settings();
      for (let attempt = 0; attempt < 9; attempt++) {
        controller.signal.throwIfAborted();
        result = await compiler.compile(project, append);
        if (
          result.success ||
          result.cancelled ||
          !settings.autoDownload ||
          project.engine === 'tectonic' ||
          attempt === 8
        )
          break;
        const missing = missingFiles(result.log);
        if (!missing.length) break;
        log('\n检测到缺失资源：' + missing.join('、') + '\n');
        const installed = await this.installMissing(missing, controller.signal, log);
        if (!installed.length) {
          log('未找到唯一可安装的同版本宏包，请检查项目文件或手动导入。\n');
          break;
        }
        log('宏包已补齐，重新编译当前文稿。\n');
      }
      return { ...result, log: progress + (result?.log || '') };
    } catch (e) {
      return {
        success: false,
        cancelled: controller.signal.aborted,
        revision: project.revision,
        log:
          progress +
          (result?.log || '') +
          '\n' +
          (controller.signal.aborted ? '编译与下载已取消。' : '补齐宏包失败：' + e.message),
      };
    } finally {
      this.active = null;
    }
  }
}
module.exports = { PackageRepository, missingFiles, packagePlan, validateCatalog };
