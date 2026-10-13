import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { ProjectLibrary } from '../apps/desktop/projects.cjs';
import { WebDAV } from '../apps/desktop/webdav.cjs';

const sample = {
  name: '中文项目',
  mainFile: 'main.tex',
  activeFile: 'main.tex',
  engine: 'pdflatex',
  revision: 0,
  files: [
    { path: 'main.tex', content: 'original' },
    { path: 'img.png', content: 'AAECAw==', binary: true },
  ],
  folders: ['empty'],
};
const secure = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from('encrypted:' + s),
  decryptString: (b) => b.toString().slice(10),
};
async function setup(t) {
  await fs.mkdir('.qa', { recursive: true });
  const base = await fs.mkdtemp(path.resolve('.qa/webdav-'));
  const files = new Map();
  let race = false,
    weak = false;
  const server = http.createServer(async (req, res) => {
    if (req.headers.authorization !== 'Basic ' + Buffer.from('user:password').toString('base64')) {
      res.writeHead(401).end();
      return;
    }
    if (req.method === 'MKCOL') {
      res.writeHead(405).end();
      return;
    }
    if (req.method === 'PROPFIND') {
      res
        .writeHead(207, { 'Content-Type': 'application/xml' })
        .end(
          '<d:multistatus xmlns:d="DAV:">' +
            [...files.keys()]
              .map((key) => `<d:response><d:href>${key}</d:href></d:response>`)
              .join('') +
            '</d:multistatus>',
        );
      return;
    }
    const data = files.get(req.url);
    const etag = data && '"' + createHash('sha256').update(data).digest('hex') + '"';
    if (req.method === 'GET') {
      res.writeHead(data ? 200 : 404, data ? { ETag: weak ? 'W/' + etag : etag } : {}).end(data);
      return;
    }
    if (req.method === 'PUT') {
      if (
        race ||
        (req.headers['if-none-match'] === '*' && data) ||
        (req.headers['if-match'] && req.headers['if-match'] !== etag)
      ) {
        res.writeHead(412).end();
        return;
      }
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      files.set(req.url, Buffer.concat(chunks).toString());
      res.writeHead(201).end();
      return;
    }
    res.writeHead(405).end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  );
  const config = {
    url: `http://127.0.0.1:${server.address().port}/dav/`,
    username: 'user',
    password: 'password',
  };
  async function device(name) {
    const directory = path.join(base, name),
      library = new ProjectLibrary(directory);
    await library.init();
    const dav = new WebDAV(directory, secure, library);
    await dav.configure(config);
    return { dav, library, directory };
  }
  return { base, files, device, config, setRace: (v) => (race = v), setWeak: (v) => (weak = v) };
}

test('WebDAV round trip preserves Chinese names, binary assets and folders; passwords and local paths stay off server', async (t) => {
  const env = await setup(t),
    a = await env.device('a'),
    b = await env.device('b');
  const project = await a.library.import(sample);
  assert.equal((await a.dav.sync(project)).status, 'uploaded');
  const list = await b.dav.list();
  assert.equal(list[0].name, '中文项目');
  const copy = await b.dav.download(list[0].key);
  assert.deepEqual(
    copy.files.find((f) => f.binary),
    sample.files[1],
  );
  assert.deepEqual(copy.folders, ['empty']);
  assert.equal((await b.dav.sync(copy)).status, 'unchanged');
  const raw = [...env.files.values()][0];
  assert(!raw.includes('password'));
  assert(!raw.includes('location'));
  assert(!raw.includes(env.base));
  const restart = new WebDAV(a.directory, secure, a.library);
  assert.equal((await restart.get()).projects.length, 1);
  assert.equal((await restart.get()).hasPassword, true);
});

test('remote-only changes download with durable backup and binary deletions; simultaneous changes preserve both sides', async (t) => {
  const env = await setup(t),
    a = await env.device('a'),
    b = await env.device('b');
  let pa = await a.library.import(sample);
  await a.dav.sync(pa);
  const pb = await b.dav.download((await b.dav.list())[0].key);
  const changed = { ...pb, files: [{ path: 'main.tex', content: 'remote update' }] };
  await b.dav.sync(changed);
  const result = await a.dav.sync(pa);
  assert.equal(result.status, 'downloaded');
  pa = result.project;
  assert.equal(
    await fs.readFile(path.join(pa.location.directory, 'main.tex'), 'utf8'),
    'remote update',
  );
  await assert.rejects(fs.access(path.join(pa.location.directory, 'img.png')));
  const backups = await fs.readdir(path.join(a.directory, 'sync-backups'));
  assert.equal(backups.length, 1);
  assert.equal(
    JSON.parse(await fs.readFile(path.join(a.directory, 'sync-backups', backups[0]), 'utf8')).files
      .length,
    2,
  );
  await b.dav.sync({ ...changed, files: [{ path: 'main.tex', content: 'second remote update' }] });
  const local = { ...pa, files: [{ path: 'main.tex', content: 'local edit' }] };
  await a.library.save(local);
  const conflict = await a.dav.sync(local);
  assert.equal(conflict.status, 'conflict');
  assert.equal(conflict.project.files[0].content, 'second remote update');
  assert.equal(
    await fs.readFile(path.join(pa.location.directory, 'main.tex'), 'utf8'),
    'local edit',
  );
  assert.equal(
    JSON.parse([...env.files.values()][0]).project.files[0].content,
    'second remote update',
  );
});

test('conditional writes reject concurrent remote changes, weak ETags, wrong credentials and malicious keys', async (t) => {
  const env = await setup(t),
    a = await env.device('a');
  const project = await a.library.import(sample);
  await a.dav.sync(project);
  const original = [...env.files.values()][0],
    changed = { ...project, name: 'new name' };
  env.setRace(true);
  await assert.rejects(a.dav.sync(changed), /云端内容发生变化/);
  assert.equal([...env.files.values()][0], original);
  env.setRace(false);
  env.setWeak(true);
  await assert.rejects(a.dav.sync(changed), /ETag/);
  await assert.rejects(a.dav.download('../secrets'), /标识无效/);
  await a.dav.configure({ ...env.config, password: 'wrong' });
  await assert.rejects(a.dav.list(), /401/);
  await assert.rejects(a.dav.configure({ ...env.config, url: 'file:///tmp/' }), /HTTP/);
});

test('changing account drops bindings and does not send the old password; detach preserves files', async (t) => {
  const env = await setup(t),
    a = await env.device('a');
  const project = await a.library.import(sample);
  await a.dav.sync(project);
  await a.dav.detach(project.id);
  assert.equal((await a.dav.get()).projects.length, 0);
  assert.equal(env.files.size, 1);
  await a.dav.configure({ ...env.config, username: 'another', password: '' });
  assert.equal((await a.dav.get()).hasPassword, false);
});

test('changing save directory and relocating preserves IDs and original files across restarts', async (t) => {
  const env = await setup(t),
    a = await env.device('a');
  const project = await a.library.import(sample);
  const destination = path.join(env.base, 'chosen');
  await fs.mkdir(destination);
  await a.library.setRoot(destination);
  const imported = await a.library.import(sample);
  assert(imported.location.directory.startsWith(destination));
  assert.equal((await a.library.reopen(project.id)).location.directory, project.location.directory);
  const moved = await a.library.relocate(project);
  assert.equal(moved.id, project.id);
  assert(moved.location.directory.startsWith(destination));
  await a.library.save({ ...moved, files: [{ path: 'main.tex', content: 'new location' }] });
  assert.equal(
    await fs.readFile(path.join(project.location.directory, 'main.tex'), 'utf8'),
    'original',
  );
  const restart = new ProjectLibrary(a.directory);
  await restart.init();
  assert.equal(restart.projectsRoot, destination);
  assert.equal((await restart.reopen(project.id)).location.directory, moved.location.directory);
});
