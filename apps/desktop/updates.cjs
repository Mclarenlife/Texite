const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const REPO = 'https://github.com/Mclarenlife/Texite';
const API = 'https://api.github.com/repos/Mclarenlife/Texite/releases/latest';
function version(value) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([\w.-]+))?$/.exec(value);
  if (!m) throw new Error('无法识别发布版本号。');
  return [...m.slice(1, 4).map(Number), m[4] || ''];
}
function newer(remote, local) {
  const a = version(remote),
    b = version(local);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return !a[3] && !!b[3];
}
function selectAsset(release, platform, arch) {
  const assets = release.assets || [];
  return assets.find(
    (a) =>
      a.state === 'uploaded' &&
      (platform === 'win32'
        ? /\.exe$/i.test(a.name) &&
          arch === 'x64' &&
          /(?:windows|setup)/i.test(a.name) &&
          !/arm64|ia32/i.test(a.name)
        : platform === 'darwin' &&
          /\.dmg$/i.test(a.name) &&
          (arch === 'arm64' ? /arm64|universal/i.test(a.name) : /x64|universal/i.test(a.name))),
  );
}
class Updates {
  constructor(directory, options) {
    this.directory = directory;
    this.options = options;
    this.fetch = options.fetch || fetch;
    this.progress = options.progress || (() => {});
  }
  async check() {
    if (this.busy) throw new Error('更新包正在下载。');
    this.release = null;
    this.asset = null;
    this.ready = null;
    this.info = null;
    this.error = '';
    const response = await this.fetch(API, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Texite',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok)
      throw new Error(
        response.status === 404
          ? 'GitHub 上暂时没有正式发布版本。'
          : response.status === 403 || response.status === 429
            ? 'GitHub 请求暂时受限，请稍后重试。'
            : '无法检查更新，请检查网络后重试。',
      );
    const release = await response.json();
    if (
      release.draft ||
      release.prerelease ||
      !release.html_url?.startsWith(REPO + '/releases/tag/')
    )
      throw new Error('发布信息无效。');
    const available = newer(release.tag_name, this.options.version);
    const asset = selectAsset(release, this.options.platform, this.options.arch);
    this.release = release;
    if (available && asset) {
      const url = new URL(asset.browser_download_url);
      if (
        url.origin !== 'https://github.com' ||
        !url.pathname.startsWith('/Mclarenlife/Texite/releases/download/') ||
        path.basename(asset.name) !== asset.name ||
        /[\\/:\x00-\x1f]/.test(asset.name)
      )
        throw new Error('更新包地址无效。');
      if (
        !/^sha256:[a-f0-9]{64}$/i.test(asset.digest || '') ||
        !Number.isSafeInteger(asset.size) ||
        asset.size <= 0 ||
        asset.size > 2 * 1024 ** 3
      )
        throw new Error('更新包缺少有效的大小或 SHA-256 校验信息，请从项目发布页下载安装。');
      this.asset = asset;
    }
    this.info = {
      version: release.tag_name,
      current: this.options.version,
      available,
      supported: !!asset,
      notes: String(release.body || '').slice(0, 20000),
      size: asset?.size || 0,
    };
    return this.info;
  }
  status() {
    return {
      info: this.info || null,
      busy: !!this.busy,
      ready: !!this.ready,
      progress: this.percent || 0,
      error: this.error || '',
    };
  }
  async download() {
    if (this.busy) throw new Error('更新包正在下载。');
    const asset = this.asset;
    if (!asset) throw new Error('请先检查更新。');
    this.busy = true;
    this.ready = null;
    this.error = '';
    this.percent = 0;
    const partial = path.join(this.directory, 'download.partial');
    try {
      await fs.mkdir(this.directory, { recursive: true });
      const response = await this.fetch(asset.browser_download_url, {
        signal: AbortSignal.timeout(20 * 60 * 1000),
      });
      if (!response.ok || !response.body) throw new Error('更新包下载失败，请重试。');
      const file = await fs.open(partial, 'w');
      const hash = createHash('sha256');
      let received = 0,
        last = -1;
      try {
        for await (const chunk of response.body) {
          received += chunk.length;
          if (received > asset.size) throw new Error('下载大小不匹配，已停止更新。');
          hash.update(chunk);
          await file.writeFile(chunk);
          const percent = Math.floor((received / asset.size) * 100);
          if (percent !== last) {
            this.percent = percent;
            this.progress(percent);
            last = percent;
          }
        }
      } finally {
        await file.close();
      }
      if (received !== asset.size || 'sha256:' + hash.digest('hex') !== asset.digest.toLowerCase())
        throw new Error('更新包校验失败，请重新下载。');
      const target = path.join(this.directory, asset.name);
      await fs.rename(partial, target);
      this.ready = { path: target, digest: asset.digest.toLowerCase() };
      return true;
    } catch (error) {
      this.error = error.message;
      throw error;
    } finally {
      this.busy = false;
      await fs.rm(partial, { force: true });
      this.progress(this.percent);
    }
  }
  async install() {
    if (!this.ready || this.busy) throw new Error('请先下载更新包。');
    // Verify again immediately before handing the executable to the operating system.
    const file = await fs.open(this.ready.path);
    const hash = createHash('sha256');
    try {
      for await (const chunk of file.createReadStream()) hash.update(chunk);
    } finally {
      await file.close();
    }
    if ('sha256:' + hash.digest('hex') !== this.ready.digest) {
      this.ready = null;
      throw new Error('本地更新包已改变，请重新下载。');
    }
    const error = await this.options.open(this.ready.path);
    if (error) throw new Error('无法打开安装包：' + error);
  }
}
module.exports = { Updates, newer, selectAsset };
