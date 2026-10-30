const path = require('node:path');
const fs = require('node:fs/promises');
const uncomment = (text) => text.replace(/(^|[^\\])(?:\\\\)*%[^\n]*/gm, '$1');
function dependencies(project) {
  const files = new Map(project.files.map((f) => [f.path, f]));
  const ordered = [],
    visited = new Set(),
    active = new Set();
  let cyclic = false;
  function resolve(name, from, extension, strict = false) {
    if (/[\\{}%#$\x00-\x1f]/.test(name) || path.posix.isAbsolute(name) || /^[a-z]:/i.test(name)) {
      if (strict) throw new Error('跨文档引用需要项目内的明确相对路径：' + name);
      return undefined;
    }
    if (!name.toLowerCase().endsWith(extension)) name += extension;
    for (const candidate of [
      path.posix.join(path.posix.dirname(from), name),
      path.posix.normalize(name),
    ])
      if (!candidate.startsWith('../') && files.has(candidate)) return candidate;
    return undefined;
  }
  function visit(file, outputName) {
    if (active.has(file)) {
      cyclic = true;
      return;
    }
    if (visited.has(file)) return;
    if (visited.size > 30) throw new Error('跨文档依赖超过 30 份，请拆分项目。');
    visited.add(file);
    active.add(file);
    const scanned = new Set();
    function scan(source) {
      if (scanned.has(source)) return;
      scanned.add(source);
      const text = uncomment(files.get(source)?.content || '');
      for (const m of text.matchAll(/\\(?:input|include)\s*\{([^{}]+)\}/g)) {
        const included = resolve(m[1], source, '.tex');
        if (included) scan(included);
      }
      for (const m of text.matchAll(/\\externaldocument\*?\s*(?:\[[^\]]*\]\s*)?\{([^{}]+)\}/g)) {
        if (resolve(m[1], source, '.aux', true)) continue;
        const dependent = resolve(m[1], source, '.tex', true);
        if (!dependent)
          throw new Error('跨文档引用缺少 ' + m[1] + '.tex 或 .aux，请导入对应文件。');
        visit(dependent, dependent.replace(/\.tex$/i, '.aux'));
      }
    }
    scan(file);
    active.delete(file);
    ordered.push({ file, outputName });
  }
  visit(project.mainFile, undefined);
  const stems = new Set();
  for (const item of ordered) {
    const stem = path.posix
      .basename(item.file)
      .replace(/\.tex$/i, '')
      .toLowerCase();
    if (stems.has(stem)) throw new Error('跨文档依赖中有同名入口，请为独立文稿使用不同文件名。');
    stems.add(stem);
  }
  return { ordered, cyclic };
}
async function publishAux(root, item, inputs = []) {
  if (!item.outputName) return;
  const from = path.join(
    root,
    '.texite-build',
    path.posix.basename(item.file).replace(/\.tex$/i, '') + '.aux',
  );
  const to = path.join(root, item.outputName);
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.copyFile(from, to);
  // Preserve relative external PDF links when exporting nested xr/xr-hyper documents.
  const pdf = item.file.replace(/\.tex$/i, '.pdf');
  if (!inputs.some((file) => file.path === pdf)) {
    const source = from.replace(/\.aux$/, '.pdf');
    if (
      await fs.stat(source).then(
        (s) => s.isFile(),
        () => false,
      )
    )
      await fs.copyFile(source, path.join(root, pdf));
    else await fs.rm(path.join(root, pdf), { force: true });
  }
}
module.exports = { dependencies, publishAux, uncomment };
