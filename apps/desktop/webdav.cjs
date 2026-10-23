const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { validateSnapshot } = require('./workspace.cjs');
const hash = (data) => createHash('sha256').update(JSON.stringify(data)).digest('hex');
const validKey = (key) =>
  typeof key === 'string' &&
  key.length > 0 &&
  Buffer.byteLength(key) <= 220 &&
  !/[<>:"/\\|?*%#\x00-\x1f]/.test(key) &&
  !/^[. ]|[. ]$/.test(key) &&
  !/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(key);
const validId = (id) => typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id);
function projectKey(name) {
  let key =
    Array.from(
      String(name)
        .normalize('NFC')
        .replace(/[<>:"/\\|?*%#\x00-\x1f]/g, '_')
        .replace(/^[. ]+|[. ]+$/g, ''),
    )
      .slice(0, 60)
      .join('')
      .replace(/[. ]+$/g, '') || '未命名项目';
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(key)) key = '_' + key;
  return key;
}
const resource = (key) => `Texite/${encodeURIComponent(key)}.texite.json`;
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
    this.detached = {};
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
    this.detached = saved.detached || {};
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
      JSON.stringify({
        ...config,
        secret,
        bindings: this.bindings,
        detached: Object.fromEntries(
          Object.entries(this.detached).filter(([id]) => !this.bindings[id]),
        ),
      }),
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
      projects: Object.entries(this.bindings).map(([id, b]) => ({
        id,
        time: b.time,
        hash: b.hash,
      })),
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
    if (!same) {
      this.bindings = {};
      this.detached = {};
    }
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
        projects.push({
          key,
          id: remote.id,
          name: remote.project.name,
          files: remote.project.files.length,
        });
    }
    return projects;
  }
  async read(key) {
    if (!validKey(key)) throw new Error('云端项目标识无效。');
    const response = await this.request(resource(key));
    if (response.status === 404) return null;
    if (response.status !== 200) throw new Error('无法读取云端项目。');
    const data = JSON.parse(await this.body(response));
    if (data.format !== 'texite-webdav-1') throw new Error('云端项目格式无效。');
    if (data.id !== undefined && !validId(data.id)) throw new Error('云端项目身份无效。');
    return {
      project: payload(data.project),
      id: data.id || key,
      storedId: !!data.id,
      etag: response.headers.get('etag'),
    };
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
    this.bindings[project.id] = {
      key,
      id: remote.id,
      name: remote.project.name,
      hash: hash(remote.project),
      time: Date.now(),
    };
    await this.persist();
    return project;
  }
  async detach(id) {
    await this.init();
    if (this.bindings[id]) this.detached[id] = this.bindings[id];
    delete this.bindings[id];
    await this.persist();
    return this.get();
  }
  async batch({ mode, ids = [], excludedIds = [] } = {}) {
    if (
      !['pull', 'upload', 'sync'].includes(mode) ||
      !Array.isArray(ids) ||
      !Array.isArray(excludedIds) ||
      ids.length > 500 ||
      excludedIds.length > 10000 ||
      [...ids, ...excludedIds].some((id) => typeof id !== 'string')
    )
      throw new Error('同步请求无效。');
    await this.init();
    const results = [],
      projects = [];
    const excluded = new Set(excludedIds);
    const selected =
      mode === 'upload'
        ? [...new Set(ids)]
        : Object.keys(this.bindings).filter((id) => !excluded.has(id));
    // List before writes: a connection/listing failure must not look like success.
    const remote = mode === 'upload' ? [] : await this.list();
    for (const id of selected) {
      try {
        const local = await this.library.reopen(id);
        if (!local) throw new Error('本地项目不存在。');
        const result = await this.sync(local, mode !== 'pull');
        results.push({ id, name: local.name, status: result.status });
        projects.push(result.project || local);
      } catch (error) {
        results.push({
          id,
          name: this.library.entries.get(id)?.name || '本地项目',
          status: 'failed',
          error: error.message,
        });
      }
    }
    const linked = new Set(Object.values(this.bindings).map((b) => b.id || b.key));
    const ignored = new Set(
      Object.entries(this.detached)
        .filter(([id]) => !this.bindings[id])
        .map(([, b]) => b.id || b.key),
    );
    for (const item of remote) {
      if (linked.has(item.id) || ignored.has(item.id)) continue;
      try {
        const project = await this.download(item.key);
        projects.push(project);
        results.push({ id: project.id, name: project.name, status: 'downloaded' });
        linked.add(item.id);
      } catch (error) {
        results.push({ name: item.name, status: 'failed', error: error.message });
      }
    }
    return { results, projects, config: await this.get() };
  }
  async sync(project, upload = true) {
    await this.collection();
    const local = payload(project),
      localHash = hash(local);
    const binding = this.bindings[project.id] || (upload ? this.detached[project.id] : undefined);
    let key = binding?.key;
    let remote = key ? await this.read(key) : null;
    const expectedId = binding?.id || binding?.key;
    // Another device may have renamed the cloud file. Follow its stable identity.
    if (binding && (!remote || remote.id !== expectedId)) {
      const matches = (await this.list()).filter((item) => item.id === expectedId);
      if (matches.length > 1) throw new Error('云端存在多个同身份副本，请先确认保留的版本。');
      if (matches.length) {
        key = matches[0].key;
        remote = await this.read(key);
      } else if (remote) throw new Error('云端文件已被另一个项目替换，未覆盖。');
    }
    const id = validId(remote?.id || expectedId) ? remote?.id || expectedId : randomUUID();
    if (!key) key = await this.availableKey(project.name);
    const remoteHash = remote && hash(remote.project);
    if (remote && remoteHash !== localHash && remoteHash !== binding?.hash) {
      // Both sides changed: import a separate local copy, leaving both originals intact.
      if (localHash !== binding?.hash) {
        if (binding?.conflictHash === remoteHash && binding.conflictId) {
          const existing = await this.library.reopen(binding.conflictId);
          if (existing) return { status: 'conflict', project: existing };
        }
        const copy = await this.library.import({
          ...remote.project,
          name: remote.project.name.slice(0, 75) + ' · 云端冲突副本',
          updatedAt: Date.now(),
          activeFile: remote.project.mainFile,
        });
        this.bindings[project.id] = {
          ...binding,
          key,
          id,
          conflictHash: remoteHash,
          conflictId: copy.id,
        };
        await this.persist();
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
      this.bindings[project.id] = {
        key,
        id,
        name: remote.project.name,
        hash: remoteHash,
        time: Date.now(),
      };
      await this.persist();
      return { status: 'downloaded', project: next };
    }
    let changed = false;
    if (!remote || localHash !== remoteHash || (upload && !remote.storedId)) {
      if (!upload) return { status: 'local-only' };
      if (remote && (!remote.etag || remote.etag.startsWith('W/')))
        throw new Error(
          '服务未提供强 ETag，无法安全覆盖云端项目。请更换支持条件写入的 WebDAV 服务。',
        );
      const response = await this.request(resource(key), 'PUT', {
        headers: {
          'Content-Type': 'application/json',
          ...(remote ? { 'If-Match': remote.etag } : { 'If-None-Match': '*' }),
        },
        body: JSON.stringify({ format: 'texite-webdav-1', id, project: local }),
      });
      if (response.status === 412)
        throw new Error('同步期间云端内容发生变化，未覆盖。请再次同步。');
      if (![200, 201, 204].includes(response.status)) throw new Error('上传失败，原文件保持不变。');
      changed = true;
    }
    const base = projectKey(project.name);
    const named =
      key === base || (key.startsWith(base + ' (') && /^\d+\)$/.test(key.slice(base.length + 2)));
    if (upload && (!named || (binding?.name && binding.name !== project.name))) {
      const target = await this.availableKey(project.name, key);
      if (target !== key) {
        const latest = await this.read(key);
        if (
          !latest ||
          hash(latest.project) !== localHash ||
          !latest.etag ||
          latest.etag.startsWith('W/')
        )
          throw new Error('云端内容已变化或缺少强 ETag，未重命名。请再次同步。');
        const moved = await this.request(resource(key), 'MOVE', {
          headers: {
            Destination: new URL(resource(target), this.config.url).href,
            Overwrite: 'F',
            'If-Match': latest.etag,
          },
        });
        if (moved.status === 412)
          throw new Error('同步期间云端内容发生变化或名称被占用，未覆盖。请再次同步。');
        if (![201, 204].includes(moved.status))
          throw new Error(
            '服务不支持安全重命名，内容已保存在原云端文件，请检查 WebDAV MOVE 权限。',
          );
        key = target;
        changed = true;
      }
    }
    this.bindings[project.id] = { key, id, name: project.name, hash: localHash, time: Date.now() };
    await this.persist();
    return { status: changed ? 'uploaded' : 'unchanged' };
  }
  async availableKey(name, current) {
    const base = projectKey(name);
    const used = new Set(
      (await this.list())
        .filter((p) => p.key !== current)
        .map((p) => p.key.normalize('NFC').toLowerCase()),
    );
    for (let n = 1; n <= 10000; n++) {
      const candidate = n === 1 ? base : `${base} (${n})`;
      if (!used.has(candidate.toLowerCase())) return candidate;
    }
    throw new Error('同名云端项目过多，请修改项目名称。');
  }
}
module.exports = { WebDAV, projectKey };
