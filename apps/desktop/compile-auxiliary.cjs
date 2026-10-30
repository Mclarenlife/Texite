const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const digest = (data) => crypto.createHash('sha256').update(data).digest('hex');
const decodeXml = (s) =>
  s.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity) => {
    if (entity.startsWith('#'))
      return String.fromCodePoint(
        parseInt(entity.slice(entity[1] === 'x' ? 2 : 1), entity[1] === 'x' ? 16 : 10),
      );
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[entity];
  });
const encodeXml = (s) =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

// Biber accepts remote data sources and absolute paths. Restrict automatic jobs to this snapshot.
async function localBcf(data, root, mainFile) {
  let text = data.toString('utf8');
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('Biber 控制文件不能包含外部 XML 实体。');
  const files = await fs.readdir(root, { recursive: true });
  const base = path.resolve(root);
  for (const match of [...text.matchAll(/<bcf:datasource\b([^>]*)>([^<]*)<\/bcf:datasource>/g)]) {
    const name = decodeXml(match[2]);
    if (
      /\btype\s*=\s*["'](?:remote|url)["']|\bglob\s*=\s*["']true["']/.test(match[1]) ||
      /[\x00-\x1f]|^[a-z]+:\/\//i.test(name)
    )
      throw new Error('Biber 仅自动读取项目内的参考文献文件，请先将远程文献库导入项目。');
    const candidates = [
      path.resolve(root, path.dirname(mainFile), name),
      path.resolve(root, name),
      path.resolve(root, '.texite-build', name),
    ];
    let resolved;
    for (const candidate of candidates) {
      if (!candidate.startsWith(base + path.sep)) continue;
      if (
        await fs.stat(candidate).then(
          (s) => s.isFile(),
          () => false,
        )
      ) {
        resolved = candidate;
        break;
      }
    }
    if (!resolved && !/[\\/:]/.test(name)) {
      const matches = files.filter((file) => path.basename(file) === name);
      if (matches.length === 1) resolved = path.join(root, matches[0]);
      if (matches.length > 1) throw new Error(`参考文献文件重名：${name}，请使用明确的相对路径。`);
    }
    if (!resolved) throw new Error(`Biber 找不到项目内的参考文献文件：${name}`);
    text = text.replace(
      match[0],
      `<bcf:datasource${match[1]}>${encodeXml(resolved.replaceAll('\\', '/'))}</bcf:datasource>`,
    );
  }
  return text;
}

async function runAuxiliary({ root, project, selected, run, append, identities }) {
  const output = path.join(root, '.texite-build');
  const files = (await fs.readdir(output, { recursive: true })).sort();
  const stem = path.basename(project.mainFile).replace(/\.tex$/i, '');
  const auxiliaryFiles = new Set([stem + '.aux']);
  async function includeAux(file) {
    const content = await fs.readFile(path.join(output, file), 'utf8').catch(() => '');
    for (const match of content.matchAll(/\\@input\{([^{}]+\.aux)\}/g)) {
      const name = path.posix.normalize(match[1].replaceAll('\\', '/'));
      if (name.startsWith('../') || path.isAbsolute(name) || name.includes(':')) continue;
      if (!auxiliaryFiles.has(name)) {
        auxiliaryFiles.add(name);
        await includeAux(name);
      }
    }
  }
  await includeAux(stem + '.aux');
  let rerun = false;
  const snapshots = [];
  for (const file of files.filter((f) =>
    /\.(aux|bcf|idx|glo|acn|nlo|toc|out|lof|lot|nav|snm)$/.test(f),
  )) {
    if (
      !(file.endsWith('.aux')
        ? auxiliaryFiles.has(file.replaceAll('\\', '/'))
        : file.startsWith(stem + '.'))
    )
      continue;
    const full = path.join(output, file);
    if (!(await fs.stat(full)).isFile()) continue;
    const data = await fs.readFile(full);
    snapshots.push(file + '\0' + data);
    let tool, args, prepared;
    if (file.endsWith('.bcf')) {
      tool = 'biber';
      prepared = await localBcf(data, root, project.mainFile);
      args = ['--noconf', '--output-directory', output, full];
    } else if (
      file.endsWith('.aux') &&
      /\\bibdata\{/.test(data.toString()) &&
      !files.includes(file.replace(/\.aux$/, '.bcf'))
    ) {
      tool = 'bibtex';
      args = ['./' + file.replaceAll('\\', '/')];
    } else if (/\.(idx|glo|acn|nlo)$/.test(file) && data.length) {
      tool = 'makeindex';
      const ext = path.extname(file),
        stem = file.slice(0, -ext.length);
      const outExt = { '.idx': '.ind', '.glo': '.gls', '.acn': '.acr', '.nlo': '.nls' }[ext];
      args = ['-o', stem + outExt, '-t', stem + outExt + '.log'];
      if (ext === '.nlo') args.push('-s', 'nomencl.ist');
      if (ext === '.glo' || ext === '.acn') {
        const style = path.basename(project.mainFile).replace(/\.tex$/i, '') + '.ist';
        if (!files.includes(style))
          throw new Error('此术语表需要自定义索引工具；当前自动支持 MakeIndex 格式的术语表。');
        args.push('-s', style);
      }
      args.push('./' + file.replaceAll('\\', '/'));
    }
    if (!tool || identities.get(file) === digest(data)) continue;
    if (!selected[tool])
      throw new Error(
        `${tool === 'biber' ? 'Biber' : 'MakeIndex'} 工具未安装，请恢复内置辅助工具。`,
      );
    append(
      `\n${{ biber: 'Biber · 生成参考文献', bibtex: 'BibTeX · 生成参考文献', makeindex: 'MakeIndex · 生成索引/术语表' }[tool]}\n`,
    );
    try {
      if (prepared) await fs.writeFile(full, prepared);
      const code = await run(selected[tool], args, output);
      if (code !== 0) return { code, rerun: false, snapshot: '' };
    } finally {
      // Compare the control file LaTeX produced, not our resolved local paths.
      if (prepared) await fs.writeFile(full, data);
    }
    identities.set(file, digest(data));
    rerun = true;
  }
  return { code: 0, rerun, snapshot: digest(snapshots.join('\0')) };
}
module.exports = { runAuxiliary, localBcf };
