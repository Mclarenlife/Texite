const fs = require('node:fs/promises');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const crypto = require('node:crypto');
const { contentDigest } = require('./file-content.cjs');
const LIMITS = require('./project-limits.json');
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

function normalizeEps(bytes) {
  let data = Buffer.from(bytes);
  // DOS EPS files may carry a binary preview before/after the PostScript section.
  if (data.length >= 30 && data.readUInt32LE(0) === 0xc6d3d0c5) {
    const start = data.readUInt32LE(4),
      length = data.readUInt32LE(8);
    if (start < 30 || length < 1 || start + length > data.length)
      throw new Error('EPS 二进制头无效。');
    data = data.subarray(start, start + length);
  }
  const text = data.toString('latin1');
  const number = '[-+]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)';
  const bounds = new RegExp(
    `^%%BoundingBox:[ \\t]+(${number})[ \\t]+(${number})[ \\t]+(${number})[ \\t]+(${number})[ \\t]*$`,
  );
  let depth = 0,
    box;
  const lines = text.split(/\r\n|\n|\r/);
  // Ignore bounding boxes belonging to embedded EPS documents.
  for (const line of lines) {
    if (/^%%BeginDocument\b/.test(line)) depth++;
    if (/^%%EndDocument\b/.test(line)) depth = Math.max(0, depth - 1);
    if (!depth) {
      const match = line.match(bounds);
      if (match) box = match.slice(1).map(Number);
    }
  }
  if (!box || !box.every(Number.isFinite) || box[2] <= box[0] || box[3] <= box[1])
    throw new Error('EPS 缺少有效 BoundingBox，无法确定图片尺寸。');
  // Ghostscript does not crop (atend) boxes itself. Put the trailer's box in the
  // header and use the ordinary BoundingBox, matching epstopdf's default policy.
  // Replace only DSC metadata, preserving binary payload bytes/line endings.
  depth = 0;
  return Buffer.from(
    text.replace(
      /^%%(?:BeginDocument|EndDocument|(?:HiRes|Exact)?BoundingBox)[^\r\n]*/gm,
      (line) => {
        if (/^%%BeginDocument\b/.test(line)) {
          depth++;
          return line;
        }
        if (/^%%EndDocument\b/.test(line)) {
          depth = Math.max(0, depth - 1);
          return line;
        }
        if (depth) return line;
        return line.replace(/:.*/, ': ' + box.join(' '));
      },
    ),
    'latin1',
  );
}

function convertEps(bytes, job = {}, timeoutMs = 30000, append = () => {}) {
  if (job.cancelled) return Promise.reject(new Error('编译已取消。'));
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'eps-worker.cjs'), {
      workerData: normalizeEps(bytes),
      resourceLimits: { maxOldGenerationSizeMb: 128 },
    });
    job.worker = worker;
    let settled = false;
    const finish = async (error, pdf) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      await worker.terminate();
      if (job.worker === worker) job.worker = null;
      if (error) reject(error);
      else resolve(Buffer.from(pdf));
    };
    const timer = setTimeout(
      () => void finish(new Error('EPS 转换超过 30 秒，已停止。')),
      timeoutMs,
    );
    worker.once('message', (result) => {
      if (result.log && /substitut|can't find|not found|warning/i.test(result.log))
        append(result.log + '\n');
      void finish(result.error ? new Error(result.error) : null, result.pdf);
    });
    worker.once('error', (error) => void finish(error));
    worker.once(
      'exit',
      () => void finish(new Error(job.cancelled ? '编译已取消。' : 'EPS 转换进程意外退出。')),
    );
  });
}

async function prepareEps(project, root, job, append, cacheDirectory) {
  for (const file of project.files.filter((f) => /\.(eps|epsi)$/i.test(f.path))) {
    if (job.cancelled) throw new Error('编译已取消。');
    append(`\nEPS → PDF · ${file.path}\n`);
    try {
      const key = hash('ghostscript-10.08.0-epstopdf-bounds-v2:' + contentDigest(file));
      const cached = cacheDirectory && path.join(cacheDirectory, key + '.pdf');
      let pdf;
      if (cached) {
        try {
          const stat = await fs.stat(cached);
          if (stat.size <= LIMITS.pdfBytes) {
            const bytes = await fs.readFile(cached);
            if (
              bytes.subarray(0, 5).toString() === '%PDF-' &&
              hash(bytes) === (await fs.readFile(cached + '.sha256', 'utf8'))
            ) {
              pdf = bytes;
              append('复用已校验的 EPS 转换缓存。\n');
              await fs.utimes(cached, new Date(), new Date());
            }
          }
        } catch {
          /* Cache miss/corruption: regenerate from the original EPS. */
        }
      }
      if (!pdf) {
        pdf = await convertEps(await fs.readFile(path.join(root, file.path)), job, 30000, append);
        if (cached) {
          const partial = cached + '.' + crypto.randomUUID() + '.tmp';
          try {
            await fs.mkdir(cacheDirectory, { recursive: true });
            await fs.writeFile(partial, pdf);
            await fs.rename(partial, cached);
            await fs.writeFile(cached + '.sha256', hash(pdf));
          } catch {
            /* An unavailable cache must not discard a successful conversion. */
          } finally {
            await fs.rm(partial, { force: true }).catch(() => {});
          }
        }
      }
      const stem = path.join(root, file.path).replace(/\.(eps|epsi)$/i, '');
      // epstopdf's default output name, and graphicx's extensionless PDF lookup.
      await fs.writeFile(stem + '-' + path.extname(file.path).slice(1) + '-converted-to.pdf', pdf);
      const hasPreferredImage = project.files.some(
        (item) =>
          item.path.replace(/\.(pdf|png|jpe?g|mps)$/i, '').toLowerCase() ===
            file.path.replace(/\.(eps|epsi)$/i, '').toLowerCase() &&
          /\.(pdf|png|jpe?g|mps)$/i.test(item.path),
      );
      if (!hasPreferredImage)
        await fs.writeFile(stem + '.pdf', pdf, { flag: 'wx' }).catch((e) => {
          if (e.code !== 'EEXIST') throw e;
        });
    } catch (error) {
      if (job.cancelled) throw error;
      // Unreferenced legacy images must not prevent compiling the selected entry.
      append(
        `LaTeX Warning: EPS 图片转换失败：${file.path}。${error.message.replace(/\s+/g, ' ').slice(0, 1400)}\n`,
      );
    }
  }
  if (cacheDirectory) {
    try {
      const files = await fs.readdir(cacheDirectory).catch(() => []);
      const items = await Promise.all(
        files
          .filter((name) => /^[a-f0-9]{64}\.pdf$/.test(name))
          .map(async (name) => ({
            path: path.join(cacheDirectory, name),
            stat: await fs.stat(path.join(cacheDirectory, name)),
          })),
      );
      let size = 0;
      for (const [index, item] of items.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs).entries()) {
        size += item.stat.size;
        if (index >= 32 || size > 128 * 1024 * 1024) {
          await fs.rm(item.path, { force: true });
          await fs.rm(item.path + '.sha256', { force: true });
        }
      }
    } catch {
      /* Cache eviction is best effort and cannot fail compilation. */
    }
  }
}
module.exports = { convertEps, prepareEps, normalizeEps };
