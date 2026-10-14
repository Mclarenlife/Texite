const fs = require('node:fs/promises');
const path = require('node:path');
const { gunzipSync } = require('node:zlib');

// SyncTeX v1 records use scaled TeX points; PDF coordinates use big points.
function parseSyncTeX(text, root, projectFiles) {
  const files = new Map(),
    nodes = [],
    stack = [];
  let page = 0,
    unit = 1,
    mag = 1000,
    offsetX = 0,
    offsetY = 0,
    lastY = 0;
  const allowed = new Set(projectFiles.map((f) => f.path));
  for (const line of text.split(/\r?\n/)) {
    let m;
    if ((m = /^Input:(\d+):(.+)$/.exec(line))) {
      const relative = path.relative(root, path.resolve(root, m[2])).replaceAll('\\', '/');
      if (allowed.has(relative)) files.set(+m[1], relative);
    } else if ((m = /^Unit:(\d+)/.exec(line))) unit = +m[1];
    else if ((m = /^Magnification:(\d+)/.exec(line))) mag = +m[1];
    else if ((m = /^X Offset:(-?\d+)/.exec(line))) offsetX = +m[1];
    else if ((m = /^Y Offset:(-?\d+)/.exec(line))) offsetY = +m[1];
    else if ((m = /^\{(\d+)/.exec(line))) {
      page = +m[1];
      stack.length = 0;
    } else if (line[0] === '}') {
      page = 0;
      stack.length = 0;
    } else if (page && (line[0] === ')' || line[0] === ']')) stack.pop();
    else if (
      page &&
      (m =
        /^([\[(hvkxg$])(\d+),(\d+)(?:,(-?\d+))?:(-?\d+),(-?\d+|=)(?::(-?\d+),(-?\d+),(-?\d+))?/.exec(
          line,
        ))
    ) {
      const scale = (((unit * mag) / 1000 / 65536) * 72) / 72.27;
      const y = m[6] === '=' ? lastY : +m[6];
      lastY = y;
      const parent = stack.at(-1);
      const height = m[8] ? Math.abs(+m[8] * scale) : parent?.height || 10;
      const depth = m[9] ? Math.abs(+m[9] * scale) : 2;
      const node = {
        file: files.get(+m[2]),
        line: +m[3],
        page,
        x: ((((+m[5] * unit + offsetX) * mag) / 1000 / 65536) * 72) / 72.27,
        y: ((((y * unit + offsetY) * mag) / 1000 / 65536) * 72) / 72.27 - height,
        width: m[7] ? Math.abs(+m[7] * scale) : 2,
        height: height + depth,
      };
      if (m[1] === '(' || m[1] === '[') stack.push(node);
      if (node.file && m[1] !== '[' && nodes.length < 250000) nodes.push(node);
    }
  }
  return nodes;
}
async function readSyncTeX(pdfPath, root, files) {
  for (const suffix of ['.synctex.gz', '.synctex']) {
    try {
      const data = await fs.readFile(pdfPath.replace(/\.pdf$/i, suffix));
      const text = suffix.endsWith('.gz')
        ? gunzipSync(data, { maxOutputLength: 32 * 1024 * 1024 }).toString('utf8')
        : data.toString('utf8');
      return parseSyncTeX(text, root, files);
    } catch (error) {
      if (error.code !== 'ENOENT') return [];
    }
  }
  return [];
}
module.exports = { parseSyncTeX, readSyncTeX };
