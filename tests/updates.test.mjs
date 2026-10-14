import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Updates, newer, selectAsset } from '../apps/desktop/updates.cjs';

const bytes = Buffer.from('a verified installer fixture, never executed');
const asset = {
  name: 'Texite-1.0.0-windows-x64.exe',
  state: 'uploaded',
  size: bytes.length,
  digest: 'sha256:' + createHash('sha256').update(bytes).digest('hex'),
  browser_download_url:
    'https://github.com/Mclarenlife/Texite/releases/download/v1.0.0/Texite-1.0.0-windows-x64.exe',
};
const release = {
  tag_name: 'v1.0.0',
  html_url: 'https://github.com/Mclarenlife/Texite/releases/tag/v1.0.0',
  assets: [asset],
};
async function fixture(meta = release, content = bytes) {
  await fs.mkdir('.qa', { recursive: true });
  const root = await fs.mkdtemp(path.resolve('.qa/updates-test-'));
  const opened = [],
    progress = [];
  const updates = new Updates(root, {
    version: '0.9.0-preview.6',
    platform: 'win32',
    arch: 'x64',
    open: async (p) => {
      opened.push(p);
      return '';
    },
    progress: (p) => progress.push(p),
    fetch: async (url) =>
      url.includes('api.github.com')
        ? Response.json(meta)
        : new Response(
            new ReadableStream({
              start(c) {
                c.enqueue(content.subarray(0, 7));
                c.enqueue(content.subarray(7));
                c.close();
              },
            }),
          ),
  });
  return { root, updates, opened, progress };
}
test('updates select matching installers and never downgrade a preview to an older stable release', () => {
  assert.equal(newer('v0.8.0', '0.9.0-preview.6'), false);
  assert.equal(newer('v0.9.0', '0.9.0-preview.6'), true);
  assert.equal(newer('v0.9.0', '0.9.0'), false);
  assert.equal(selectAsset(release, 'win32', 'arm64'), undefined);
  const mac = { assets: [{ name: 'Texite-1.0.0-arm64.dmg', state: 'uploaded' }] };
  assert.equal(selectAsset(mac, 'darwin', 'x64'), undefined);
  assert.equal(selectAsset(mac, 'darwin', 'arm64').name, mac.assets[0].name);
});
test('streamed updates verify bytes, resume UI status and reverify before opening', async () => {
  const { updates, root, opened, progress } = await fixture();
  assert.equal((await updates.check()).available, true);
  await updates.download();
  assert.deepEqual(await fs.readFile(path.join(root, asset.name)), bytes);
  assert.equal(updates.status().ready, true);
  assert.equal(updates.status().busy, false);
  assert.equal(progress.at(-1), 100);
  await updates.install();
  assert.equal(opened.length, 1);
  await updates.download(); // Repeated download can replace its own cached installer.
  await fs.writeFile(path.join(root, asset.name), 'changed');
  await assert.rejects(updates.install(), /已改变/);
  assert.equal(opened.length, 1);
});
test('invalid metadata and incomplete or altered downloads cannot become installable', async () => {
  for (const bad of [
    { digest: '' },
    { browser_download_url: 'https://example.com/a.exe' },
    { name: '../setup.exe' },
  ]) {
    const { updates } = await fixture({ ...release, assets: [{ ...asset, ...bad }] });
    await assert.rejects(updates.check());
    await assert.rejects(updates.download(), /检查更新/);
  }
  for (const data of [
    bytes.subarray(1),
    Buffer.alloc(bytes.length),
    Buffer.concat([bytes, bytes]),
  ]) {
    const { updates, root, opened } = await fixture(release, data);
    await updates.check();
    await assert.rejects(updates.download(), /校验失败|大小不匹配/);
    assert.equal(updates.status().ready, false);
    assert.equal(updates.status().busy, false);
    assert(updates.status().error);
    await assert.rejects(fs.access(path.join(root, 'download.partial')));
    await assert.rejects(updates.install());
    assert.equal(opened.length, 0);
  }
});
