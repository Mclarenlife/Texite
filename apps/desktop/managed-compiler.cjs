const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
async function compileManaged(owner, project, root, job, append) {
  await owner.manager.init();
  const selected = await owner.manager.environment(project.engine, root);
  const label = `${selected.module.label} · ${selected.module.version} · 离线`;
  append(`实际编译器：${label}\n`);
  // Ignore inherited TeX search paths so compilation uses the selected local runtime.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !/^(TEX|BIB|BST|TFM|VF|T1FONT|AFMFONT|ENCFONT|OPENTYPE|TTFONT|LUA|FONTCONFIG|MKTEX|shell_escape|openin_any|openout_any)/i.test(
          key,
        ),
    ),
  );
  Object.assign(env, selected.env || {});
  const source = path.dirname(path.join(root, project.mainFile)).replaceAll('\\', '/');
  // Keep the entry's directory first, then search the complete project, then runtime defaults.
  const projectInputs = [source, root.replaceAll('\\', '/') + '//', ''].join(path.delimiter);
  env.TEXINPUTS = projectInputs;
  env.BIBINPUTS = projectInputs;
  env.BSTINPUTS = projectInputs;
  env.TEXITE_PROJECT_ROOT = root.replaceAll('\\', '/');
  // Lua's font and Unicode libraries open resolved absolute resource paths.
  // luaotfload needs writable local font caches and is incompatible with --safer.
  if (project.engine === 'lualatex') env.openin_any = 'a';
  env.PATH = selected.bin
    ? selected.bin + path.delimiter + (process.env.PATH || '')
    : process.env.PATH;
  env.TECTONIC_CACHE_DIR = selected.cache;
  async function run(binary, args, cwd = root) {
    if (job.cancelled) return -1;
    return new Promise((resolve) => {
      const child = spawn(binary, args, {
        cwd,
        env,
        windowsHide: true,
        shell: false,
        detached: process.platform !== 'win32',
      });
      job.child = child;
      child.stdout.on('data', (data) => append(data.toString()));
      child.stderr.on('data', (data) => append(data.toString()));
      child.on('error', (error) => {
        append(error.message + '\n');
        resolve(-1);
      });
      child.on('close', (code) => {
        job.child = null;
        resolve(code);
      });
    });
  }
  const timer = setTimeout(() => {
    append('\n编译超过 180 秒，已停止。\n');
    void owner.cancel();
  }, 180000);
  try {
    if (project.engine === 'tectonic') {
      const code = await run(selected.binary, [
        '-X',
        'compile',
        '--bundle',
        pathToFileURL(selected.bundle).href,
        '--only-cached',
        '--untrusted',
        '--synctex',
        '--keep-logs',
        '--print',
        '--outdir',
        '.texite-build',
        './' + project.mainFile,
      ]);
      return { code, label };
    }
    const format = path.join(selected.cache, project.engine + '.fmt');
    try {
      await fs.access(format);
    } catch {
      append(`首次使用，正在本地生成 ${project.engine} 格式文件（无需联网）…\n`);
      const args = [
        '-ini',
        '-etex',
        '-interaction=nonstopmode',
        '-halt-on-error',
        '-no-shell-escape',
        '-jobname=' + project.engine,
        '-progname=' + project.engine,
        '-output-directory=' + selected.cache,
        '*' + project.engine + '.ini',
      ];
      const code = await run(selected.binary, args, selected.cache);
      if (code !== 0) {
        await fs.rm(format, { force: true });
        return { code, label };
      }
    }
    const args = [
      '-fmt=' + project.engine,
      '-progname=' + project.engine,
      '-interaction=nonstopmode',
      '-file-line-error',
      '-halt-on-error',
      '-no-shell-escape',
      '-synctex=1',
      '-output-directory=.texite-build',
    ];
    if (project.engine === 'xelatex') args.push('-output-driver=xdvipdfmx -q -E');
    if (project.engine === 'lualatex') args.push('--nosocket');
    args.push('./' + project.mainFile);
    const output = path.join(root, '.texite-build');
    let previous = '';
    const bibliographies = new Map();
    for (let pass = 1; pass <= 5; pass++) {
      append(`\n${selected.module.label} · 第 ${pass} 遍\n`);
      const code = await run(selected.binary, args);
      if (code !== 0 || job.cancelled) return { code: code || -1, label };
      const files = await fs.readdir(output, { recursive: true });
      let rerun = false;
      const snapshots = [];
      for (const file of files.filter((f) => /\.(aux|toc|out|lof|lot|nav|snm)$/.test(f)).sort()) {
        const data = await fs.readFile(path.join(output, file));
        snapshots.push(file + '\0' + data);
        if (file.endsWith('.aux') && /\\bibdata\{/.test(data.toString())) {
          const identity = crypto.createHash('sha256').update(data).digest('hex');
          if (bibliographies.get(file) !== identity) {
            append('\nBibTeX · 生成参考文献\n');
            const bibCode = await run(selected.bibtex, [file.replaceAll('\\', '/')], output);
            if (bibCode !== 0) return { code: bibCode, label };
            bibliographies.set(file, identity);
            rerun = true;
          }
        }
      }
      const current = crypto.createHash('sha256').update(snapshots.join('\0')).digest('hex');
      if (pass >= 2 && current === previous && !rerun) return { code: 0, label };
      previous = current;
    }
    append('\n已完成 5 遍编译；如仍有交叉引用警告，请检查文稿。\n');
    return { code: 0, label };
  } finally {
    clearTimeout(timer);
  }
}
module.exports = { compileManaged };
