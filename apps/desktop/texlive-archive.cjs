const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const JSZip = require('jszip');
const tar =
  process.platform === 'win32'
    ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
    : '/usr/bin/tar';
function run(args, signal) {
  return new Promise((resolve, reject) =>
    execFile(
      tar,
      args,
      {
        windowsHide: true,
        signal,
        timeout: 120000,
        maxBuffer: 32000000,
        env: { ...process.env, LC_ALL: 'C', LANG: 'C' },
      },
      (error, stdout) =>
        error
          ? reject(
              new Error(
                error.code === 'ENOENT'
                  ? '找不到系统 tar 解压程序，请使用离线扩展包。'
                  : 'TeX Live 宏包解压失败：' + error.message,
              ),
            )
          : resolve(stdout),
    ),
  );
}
function validateEntries(names, details) {
  const paths = names.trim().split(/\r?\n/).filter(Boolean);
  if (paths.length > 100000) throw new Error('宏包文件数量超出限制。');
  for (const name of paths) {
    if (
      /[\\:<>|?*\x00-\x1f]/.test(name) ||
      name.startsWith('/') ||
      name
        .replace(/\/$/, '')
        .split('/')
        .some(
          (p) =>
            !p ||
            p === '.' ||
            p === '..' ||
            /[. ]$/.test(p) ||
            /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p),
        )
    )
      throw new Error('宏包包含不安全的归档路径。');
  }
  let size = 0;
  const rows = details.trim().split(/\r?\n/).filter(Boolean);
  if (rows.length !== paths.length) throw new Error('无法验证宏包归档结构。');
  for (const row of rows) {
    // BSD tar on Windows/macOS. Reject links, devices and unknown listings.
    const match =
      /^[-d][rwxStTs-]{9}[.+@]?\s+\d+\s+\S+\s+\S+\s+(\d+)\s/.exec(row) ||
      /^[-d][rwxStTs-]{9}[.+@]?\s+\S+\/\S+\s+(\d+)\s/.exec(row);
    if (!match) throw new Error('宏包含链接或不支持的归档类型。');
    size += Number(match[1]);
  }
  if (!Number.isSafeInteger(size) || size > 1500000000) throw new Error('宏包解压后超出大小限制。');
  return new Set(paths);
}
async function installArchive(manager, id, metadata, archive, directory, signal) {
  const names = await run(['-tf', archive], signal);
  const details = await run(['-tvf', archive], signal);
  const entries = validateEntries(names, details);
  signal.throwIfAborted();
  const stage = await fs.mkdtemp(path.join(directory, 'extract-'));
  try {
    await run(['-xf', archive, '-C', stage, '--no-same-owner', '--no-same-permissions'], signal);
    const zip = new JSZip(),
      files = {};
    for (const [source, destination] of Object.entries(metadata.paths)) {
      signal.throwIfAborted();
      if (!entries.has(source)) throw new Error('宏包缺少索引中的文件：' + source);
      const data = await fs.readFile(path.join(stage, source));
      files[destination] = {
        size: data.length,
        sha256: crypto.createHash('sha256').update(data).digest('hex'),
      };
      zip.file(id + '/' + destination, data);
    }
    zip.file(
      'pack.json',
      JSON.stringify({
        schema: 1,
        platform: 'all',
        texLive: '2025',
        label: metadata.label,
        modules: [
          {
            id,
            label: metadata.label,
            kind: 'package',
            version: 'TeX Live 2025 final',
            dependencies: metadata.dependencies,
            maps: metadata.maps,
            files,
          },
        ],
      }),
    );
    const pack = path.join(stage, 'verified.texite-runtime.zip');
    await fs.writeFile(
      pack,
      await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }),
    );
    signal.throwIfAborted();
    await manager.install(pack, [id]);
  } finally {
    await fs.rm(stage, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}
module.exports = { installArchive, validateEntries };
