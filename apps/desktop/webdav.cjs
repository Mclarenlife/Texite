const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { validateSnapshot } = require('./workspace.cjs');
const hash = (data) => createHash('sha256').update(JSON.stringify(data)).digest('hex');
const validKey = (key) => typeof key === 'string' && /^[a-f0-9-]{36}$/.test(key);
function payload(project) {
  validateSnapshot(project);
  if (typeof project.name !== 'string' || project.name.length > 100)
    throw new Error('项目名称无效。');
  return {
    name: project.name,
    engine: project.engine,
    mainFile: project.mainFile,
    files: [...project.files]
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
      .map((f) => ({ path: f.path, content: f.content, binary: !!f.binary })),
    folders: [...(project.folders || [])].sort(),
    revision: 0,
  };
}

// One conditional resource per project keeps a multi-file project atomic. Local
// bindings/paths and credentials are never part of the transferable snapshot.
class WebDAV {
  constructor(directory, secureStorage, library) {
    this.directory = directory;
    this.storage = secureStorage;
    this.library = library;
    this.config = null;
    this.bindings = {};
  }
  async init() {
    if (this.config) return;
    let saved = {};
    try {
      saved = JSON.parse(await fs.readFile(path.join(this.directory, 'webdav.json'), 'utf8'));
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    let password = '';
    if (saved.secret && this.storage.isEncryptionAvailable()) {
      try {
        password = this.storage.decryptString(Buffer.from(saved.secret, 'base64'));
      } catch {}
    }
    this.config = { url: saved.url || '', username: saved.username || '', password };
    this.bindings = saved.bindings || {};
  }
  async persist() {
    const { password, ...config } = this.config;
    const secret =
      password && this.storage.isEncryptionAvailable()
        ? this.storage.encryptString(password).toString('base64')
        : undefined;
    const target = path.join(this.directory, 'webdav.json');
    await fs.writeFile(
      target + '.tmp',
      JSON.stringify({ ...config, secret, bindings: this.bindings }),
      { mode: 0o600 },
    );
    await fs.rename(target + '.tmp', target);
  }
  async get() {
    await this.init();
    return {
      url: this.config.url,
      username: this.config.username,
      hasPassword: !!this.config.password,
      persistent: this.storage.isEncryptionAvailable(),
      projects: Object.entries(this.bindings).map(([id, b]) => ({ id, time: b.time })),
    };
  }
  async configure(input) {
    await this.init();
    if (
      !input ||
      typeof input.url !== 'string' ||
      typeof input.username !== 'string' ||
      typeof input.password !== 'string' ||
      input.password.length > 10000 ||
      input.username.length > 1000
    )
      throw new Error('WebDAV 设置无效。');
    const url = new URL(input.url.trim());
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error('请填写不含账号、查询参数的 HTTP(S) WebDAV 地址。');
    url.pathname = url.pathname.replace(/\/*$/, '/');
    const same = this.config.url === url.href && this.config.username === input.username;
    this.config = {
      url: url.href,
      username: input.username,
      password: input.password || (same ? this.config.password : ''),
    };
    if (!same) this.bindings = {};
    await this.persist();
    return this.get();
  }
  async request(resource, method = 'GET', options = {}) {
    if (!this.config.url) throw new Error('请先配置 WebDAV 服务。');
    const response = await fetch(new URL(resource, this.config.url), {
      method,
      redirect: 'error',
      signal: AbortSignal.timeout(60000),
      ...options,
      headers: {
        Authorization:
          'Basic ' +
          Buffer.from(this.config.username + ':' + this.config.password).toString('base64'),
        ...options.headers,
      },
    });
    if (![200, 201, 204, 207, 404, 405, 412].includes(response.status))
      throw new Error(`WebDAV 请求失败（HTTP ${response.status}）。请检查地址、账号及读写权限。`);
    return response;
  }
  async body(response, max = 100 * 1024 * 1024) {
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body || []) {
      size += chunk.length;
      if (size > max) throw new Error('云端项目超过大小限制。');
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf8');
  }
  async collection() {
    await this.init();
    const response = await this.request('Texite/', 'MKCOL');
    if (![201, 405].includes(response.status)) throw new Error('无法创建 Texite 同步目录。');
  }
  async list() {
    await this.collection();
    const response = await this.request('Texite/', 'PROPFIND', {
      headers: { Depth: '1', 'Content-Type': 'application/xml' },
      body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>',
    });
    if (response.status !== 207) throw new Error('服务不支持 WebDAV 目录读取。');
    const xml = await this.body(response, 4 * 1024 * 1024);
    const keys = new Set();
    for (const m of xml.matchAll(/<(?:[\w-]+:)?href\b[^>]*>([^<]+)<\/(?:[\w-]+:)?href>/g)) {
      try {
        const url = new URL(m[1].trim().replaceAll('&amp;', '&'), this.config.url);
        const root = new URL('Texite/', this.config.url);
        if (url.origin !== root.origin || !url.pathname.startsWith(root.pathname)) continue;
        const filename = decodeURIComponent(url.pathname.slice(root.pathname.length));
        const key = filename.replace(/\.texite\.json$/, '');
        if (filename === key + '.texite.json' && validKey(key)) keys.add(key);
      } catch {}
    }
    if (keys.size > 500) throw new Error('云端项目超过 500 个，请使用独立同步目录。');
    const projects = [];
    for (const key of keys) {
      const remote = await this.read(key);
      if (remote)
        projects.push({ key, name: remote.project.name, files: remote.project.files.length });
    }
    return projects;
  }
  async read(key) {
    if (!validKey(key)) throw new Error('云端项目标识无效。');
    const response = await this.request(`Texite/${key}.texite.json`);
    if (response.status === 404) return null;
    if (response.status !== 200) throw new Error('无法读取云端项目。');
    const data = JSON.parse(await this.body(response));
    if (data.format !== 'texite-webdav-1') throw new Error('云端项目格式无效。');
    return { project: payload(data.project), etag: response.headers.get('etag') };
  }
  async download(key) {
    await this.init();
    const remote = await this.read(key);
    if (!remote) throw new Error('云端项目不存在。');
    const project = await this.library.import({
      ...remote.project,
      updatedAt: Date.now(),
      activeFile: remote.project.mainFile,
    });
    this.bindings[project.id] = { key, hash: hash(remote.project), time: Date.now() };
    await this.persist();
    return project;
  }
  async detach(id) {
    await this.init();
    delete this.bindings[id];
    await this.persist();
    return this.get();
  }
  async sync(project) {
    await this.collection();
    const local = payload(project),
      localHash = hash(local);
    const binding = this.bindings[project.id];
    const key = binding?.key || randomUUID();
    const remote = await this.read(key);
    const remoteHash = remote && hash(remote.project);
    if (remote && remoteHash !== localHash && remoteHash !== binding?.hash) {
      // Both sides changed: import a separate local copy, leaving both originals intact.
      if (localHash !== binding?.hash) {
        const copy = await this.library.import({
          ...remote.project,
          name: remote.project.name.slice(0, 75) + ' · 云端冲突副本',
          updatedAt: Date.now(),
          activeFile: remote.project.mainFile,
        });
        return { status: 'conflict', project: copy };
      }
      // Keep a durable snapshot before replacing local files, including deletions.
      const backup = path.join(this.directory, 'sync-backups');
      await fs.mkdir(backup, { recursive: true });
      await fs.writeFile(path.join(backup, randomUUID() + '.json'), JSON.stringify(local), {
        mode: 0o600,
      });
      const next = {
        ...project,
        ...remote.project,
        revision: project.revision + 1,
        updatedAt: Date.now(),
        activeFile: remote.project.mainFile,
      };
      const removed = project.files
        .filter((f) => !next.files.some((n) => n.path === f.path))
        .map((f) => ({ path: f.path, expected: f.content, binary: f.binary }));
      await this.library.save(next, removed, true);
      this.bindings[project.id] = { key, hash: remoteHash, time: Date.now() };
      await this.persist();
      return { status: 'downloaded', project: next };
    }
    if (!remote || localHash !== remoteHash) {
      if (remote && (!remote.etag || remote.etag.startsWith('W/')))
        throw new Error(
          '服务未提供强 ETag，无法安全覆盖云端项目。请更换支持条件写入的 WebDAV 服务。',
        );
      const response = await this.request(`Texite/${key}.texite.json`, 'PUT', {
        headers: {
          'Content-Type': 'application/json',
          ...(remote ? { 'If-Match': remote.etag } : { 'If-None-Match': '*' }),
        },
        body: JSON.stringify({ format: 'texite-webdav-1', project: local }),
      });
      if (response.status === 412)
        throw new Error('同步期间云端内容发生变化，未覆盖。请再次同步。');
      if (![200, 201, 204].includes(response.status)) throw new Error('上传失败，原文件保持不变。');
    }
    this.bindings[project.id] = { key, hash: localHash, time: Date.now() };
    await this.persist();
    return { status: remoteHash === localHash ? 'unchanged' : 'uploaded' };
  }
}
module.exports = { WebDAV };
