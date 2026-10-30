const fs = require('node:fs/promises');
const path = require('node:path');
const { runAuxiliary } = require('./compile-auxiliary.cjs');
const { prepareEps } = require('./eps-converter.cjs');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { prepareHooks, processRequests, prepareSvg } = require('./external-tools.cjs');
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
  env.INDEXSTYLE = projectInputs;
  env.TEXITE_PROJECT_ROOT = root.replaceAll('\\', '/');
  env.TEXMF_OUTPUT_DIRECTORY = path.join(root, '.texite-build');
  // Keep timestamps stable across tool-assisted retries in this build.
  job.sourceDateEpoch ??= String(Math.floor(Date.now() / 1000));
  env.SOURCE_DATE_EPOCH = job.sourceDateEpoch;
  env.FORCE_SOURCE_DATE = '1';
  // Lua's font and Unicode libraries open resolved absolute resource paths.
  // luaotfload needs writable local font caches and is incompatible with --safer.
  if (project.engine === 'lualatex') env.openin_any = 'a';
  env.PATH = selected.bin
    ? selected.bin + path.delimiter + (process.env.PATH || '')
    : process.env.PATH;
  const toolsBin = path.join(owner.manager.modulePath('tools-bibliography-index'), 'bin');
  env.PATH = toolsBin + path.delimiter + env.PATH;
  env.SELFAUTOLOC = toolsBin;
  if (process.platform === 'darwin') env.PATH += ':/opt/homebrew/bin:/usr/local/bin';
  env.TECTONIC_CACHE_DIR = selected.cache;
  // Keep Biber's unpacked Perl runtime in app-owned cache, never the project.
  env.PAR_GLOBAL_TEMP = path.join(selected.cache, 'biber-par');
  await fs.mkdir(env.PAR_GLOBAL_TEMP, { recursive: true });
  let recentOutput = '';
  function output(data) {
    const text = data.toString();
    recentOutput = (recentOutput + text).slice(-200000);
    append(text);
  }
  function explainExternalTool() {
    if (
      !owner.toolSettings?.latexminted &&
      /Package minted.*Error|Package minted2.*Error/i.test(recentOutput) &&
      /shell.escape|latexminted|pygmentize/i.test(recentOutput)
    )
      append(
        '\n! Texite Error: 此文稿需要代码高亮工具。请在编译设置 → 外部工具中配置 latexminted（支持 minted 3），或使用预生成的 frozencache；minted 2 可迁移到 minted 3。\n',
      );
    else if (/inkscape|svg.*shell.escape/i.test(recentOutput))
      append(
        '\n! Texite Error: SVG 转换未完成。请在编译设置 → 外部工具中配置 Inkscape，或导入预先转换的 PDF 与 pdf_tex 文件。\n',
      );
    else if (/tikzexternal|system call.*did NOT result/i.test(recentOutput))
      append(
        '\n! Texite Error: TikZ 外部化未完成。当前支持与所选引擎一致的标准外部化；自定义 system call 请改用预生成的图形。\n',
      );
  }
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
      child.stdout.on('data', output);
      child.stderr.on('data', output);
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
    // Keep reusable AUX/tool caches, but never mistake an old final PDF for new output.
    const stem = path.basename(project.mainFile).replace(/\.tex$/i, '');
    for (const extension of ['.pdf', '.log', '.synctex.gz']) {
      await fs.rm(path.join(root, '.texite-build', stem + extension), { force: true });
    }
    if (project.engine === 'pdflatex' || project.engine === 'lualatex')
      await prepareEps(project, root, job, append, path.join(owner.cache, 'eps-cache'));
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
    await prepareSvg(root, project, owner.toolSettings || {}, run, append);
    const entry = await prepareHooks(root, project);
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
    args.push('-jobname=' + stem);
    const engineArgs = [...args];
    args.push(entry);
    let previous = '';
    const identities = new Map(Object.entries(job.build?.tools || {}));
    const seenRequests = new Set();
    let toolRetries = 0;
    for (let pass = 1; pass <= 6; pass++) {
      append(`\n${selected.module.label} · 第 ${pass} 遍\n`);
      const code = await run(selected.binary, args);
      if (
        !job.cancelled &&
        (await processRequests({
          root,
          project,
          selected,
          settings: owner.toolSettings || {},
          run,
          append,
          seen: seenRequests,
          engineArgs,
        }))
      ) {
        if (++toolRetries > 12)
          throw new Error('外部工具处理超过 12 轮，请检查文稿或改用预生成的资源。');
        append('\nTexite: 外部工具资源已生成，重新编译。\n');
        pass--;
        continue;
      }
      if (code !== 0 || job.cancelled) {
        if (!job.cancelled) explainExternalTool();
        return { code: code || -1, label };
      }
      const auxiliary = await runAuxiliary({ root, project, selected, run, append, identities });
      if (job.build) job.build.tools = Object.fromEntries(identities);
      if (auxiliary.code !== 0 || job.cancelled) return { code: auxiliary.code || -1, label };
      const { snapshot: current, rerun } = auxiliary;
      if (pass >= 2 && current === previous && !rerun) return { code: 0, label };
      previous = current;
    }
    append('\nLaTeX Warning: 已完成 6 遍编译，交叉引用尚未稳定，请检查文稿。\n');
    return { code: 0, label };
  } catch (error) {
    append(`\n! Texite Error: ${error.message}\n`);
    return { code: -1, label };
  } finally {
    clearTimeout(timer);
  }
}
module.exports = { compileManaged };
