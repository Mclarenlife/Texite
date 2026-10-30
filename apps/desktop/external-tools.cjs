const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const digest = (text) => crypto.createHash('sha256').update(text).digest('hex');
function localPath(root, name) {
  if (
    typeof name !== 'string' ||
    /[\x00-\x1f|<>"`]/.test(name) ||
    path.isAbsolute(name) ||
    /^[a-z]:/i.test(name)
  )
    throw new Error('外部工具路径必须位于当前项目内。');
  const target = path.resolve(root, name);
  if (!target.startsWith(path.resolve(root) + path.sep))
    throw new Error('外部工具不能访问项目以外的路径。');
  return target;
}
function mintedRequest(command) {
  const m = command
    .trim()
    .match(
      /^latexminted\s+(config|batch|styledef|highlight|clean|cleanconfig|cleantemp)\s+--timestamp\s+(\d{8,20}Z?)(?:\s+--debug)?\s+([A-Fa-f0-9]{32})$/,
    );
  if (!m) throw new Error('不支持此代码高亮命令；仅支持 minted 3 的标准 latexminted 请求。');
  return {
    action: m[1],
    args: [m[1], '--timestamp', m[2], m[3]],
    data: '_' + m[3] + '.data.minted',
  };
}
function tikzRequest(command, project) {
  const m = command
    .trim()
    .match(
      /^(pdflatex|xelatex|lualatex)\s+(?:-shell-escape\s+)?-halt-on-error\s+-interaction=batchmode\s+-jobname\s+"([^"\r\n]+)"\s+"\\def\\tikzexternalrealjob\{([^{}]+)\}\\input\{([^{}]+)\}"$/,
    );
  if (!m || m[1] !== project.engine || /[{}%#\\]/.test(m[2] + m[3] + m[4]))
    throw new Error('仅支持 TikZ 标准外部化命令，不执行自定义 system call。');
  const main = project.mainFile.replace(/\.tex$/i, '');
  if (m[3] !== path.posix.basename(main) || ![main, path.posix.basename(main)].includes(m[4]))
    throw new Error('TikZ 外部化入口与当前文稿不一致。');
  return { name: m[2], main: m[3] };
}
// TeX only writes structured requests. The engine itself keeps -no-shell-escape.
const hooks = String.raw`\makeatletter
\newwrite\texiteRequests
\newwrite\texiteData
\newread\texiteReader
\newcount\texiteRequestNumber
\immediate\openout\texiteRequests=\jobname.texite-requests
\long\def\texiteQueue#1{%
  \global\advance\texiteRequestNumber by 1
  \immediate\write\texiteRequests{\the\texiteRequestNumber|#1}%
  \ifdefined\MintedDataFilename
    \begingroup\endlinechar=-1
    \openin\texiteReader=\MintedDataFilename
    \immediate\openout\texiteData=\jobname.texite-request-\the\texiteRequestNumber.data
    \loop\unless\ifeof\texiteReader
      \readline\texiteReader to\texiteLine
      \immediate\write\texiteData{\texiteLine}%
    \repeat
    \closein\texiteReader\immediate\closeout\texiteData\endgroup
  \fi}
\AddToHook{package/minted/after}{%
  \ifcsname ifminted@canexec\endcsname
    \ifboolexpr{bool {minted@frozencache} or bool {minted@placeholder} or bool {minted@verbatim}}{}{\booltrue{minted@canexec}}%
    \def\minted@ShellEscapeMaybeMessages#1{%
      \let\minted@exec@warning\relax\let\minted@exec@error\relax
      \ifbool{minted@canexec}{\texiteQueue{#1}}{}}%
    \def\minted@ShellEscapeNoMessages#1{\ifbool{minted@canexec}{\texiteQueue{#1}}{}}%
  \fi}
\AddToHook{package/tikz/after}{\let\pgfutil@shellescape\texiteQueue}
\AddToHook{package/pgf/after}{\let\pgfutil@shellescape\texiteQueue}
\AddToHook{package/svg/after}{\svgsetup{inkscape=false}}
\makeatother
`;
async function prepareHooks(root, project) {
  if (/[{}%#\\]/.test(project.mainFile)) throw new Error('编译入口文件名不能包含 TeX 控制字符。');
  await fs.writeFile(path.join(root, '.texite-hooks.tex'), hooks);
  for (const file of project.files.filter((f) => /\.tex$/i.test(f.path))) {
    for (const m of file.content.matchAll(/\\tikzexternalize\s*\[[^\]]*?prefix\s*=\s*([^,\]]+)/g)) {
      const name = m[1].trim().replace(/\/$/, '');
      if (name)
        for (const base of [root, path.join(root, '.texite-build')])
          await fs.mkdir(localPath(base, name), { recursive: true });
    }
  }
  return `\\input{.texite-hooks.tex}\\input{\\detokenize{${project.mainFile}}}`;
}
async function processRequests({
  root,
  project,
  selected,
  settings,
  run,
  append,
  seen,
  engineArgs,
}) {
  const stem = path.posix.basename(project.mainFile).replace(/\.tex$/i, '');
  const output = path.join(root, '.texite-build');
  const content = await fs
    .readFile(path.join(output, stem + '.texite-requests'), 'utf8')
    .catch(() => '');
  if (content.length > 1000000) throw new Error('外部工具请求过多。');
  let changed = false;
  for (const line of content.split(/\r?\n/).filter(Boolean)) {
    const separator = line.indexOf('|'),
      number = line.slice(0, separator),
      command = line.slice(separator + 1).trim();
    if (!/^\d{1,4}$/.test(number)) throw new Error('外部工具请求无效。');
    if (command.startsWith('latexminted ')) {
      const request = mintedRequest(command);
      if (request.action.startsWith('clean')) continue;
      if (!settings.latexminted)
        throw new Error('此文稿使用 minted 3，请在编译设置 → 外部工具中选择 latexminted 程序。');
      const snapshot = path.join(output, `${stem}.texite-request-${number}.data`);
      if ((await fs.stat(snapshot)).size > 16 * 1024 * 1024)
        throw new Error('单次代码高亮内容超过 16 MB。');
      const data = await fs.readFile(snapshot);
      const key = digest(command + '\0' + data);
      if (seen.has(key)) continue;
      await fs.writeFile(path.join(output, request.data), data);
      append(`\n代码高亮 · latexminted ${request.action}\n`);
      const configPath = path.join(output, request.data.replace('.data.minted', '.config.minted'));
      const config =
        request.action === 'config' ? null : await fs.readFile(configPath).catch(() => null);
      const code = await run(settings.latexminted, request.args, root);
      if (code !== 0) throw new Error('latexminted 执行失败，请检查工具版本和日志。');
      // A minted batch also cleans temporary config; the next TeX retry still needs it.
      if (config) await fs.writeFile(configPath, config);
      seen.add(key);
      changed = true;
    } else if (/^(?:pdf|xe|lua)latex\b/.test(command)) {
      const request = tikzRequest(command, project);
      const target = localPath(root, request.name + '.pdf');
      if (seen.has(command)) continue;
      await fs.mkdir(path.dirname(target), { recursive: true });
      append(`\nTikZ 外部化 · ${request.name}\n`);
      const args = engineArgs.filter(
        (a) => !a.startsWith('-output-directory=') && !a.startsWith('-jobname='),
      );
      args.push(
        '-output-directory=.',
        '-jobname=' + request.name,
        `\\def\\tikzexternalrealjob{${request.main}}\\input{\\detokenize{${project.mainFile}}}`,
      );
      const code = await run(selected.binary, args, root);
      if (
        code !== 0 ||
        !(await fs.stat(target).then(
          (s) => s.isFile(),
          () => false,
        ))
      )
        throw new Error('TikZ 图形编译失败，请查看日志。');
      seen.add(command);
      changed = true;
    } else throw new Error('未执行不受支持的外部命令：' + command.slice(0, 160));
    if (seen.size > 100) throw new Error('一次编译最多处理 100 个外部工具请求。');
  }
  return changed;
}
async function prepareSvg(root, project, settings, run, append) {
  if (
    !settings.inkscape ||
    !project.files.some((f) => /\.tex$/i.test(f.path) && /\\includesvg\b/.test(f.content))
  )
    return;
  const inputs = project.files.filter((f) => /\.svg$/i.test(f.path));
  const names = new Set();
  const toolStat = await fs.stat(settings.inkscape);
  const dependencies = project.files
    .filter((f) => !/\.tex$/i.test(f.path))
    .map((f) => [f.path, digest(f.content)]);
  for (const file of inputs) {
    const stem = path.posix.basename(file.path).replace(/\.svg$/i, '');
    if (names.has(stem.toLowerCase()))
      throw new Error('SVG 图形存在同名文件，请改用不同文件名：' + file.path);
    names.add(stem.toLowerCase());
  }
  for (const file of inputs) {
    const source = localPath(root, file.path);
    const text = await fs.readFile(source, 'utf8');
    if (
      /<!DOCTYPE|<!ENTITY|<script\b|@import|(?:https?|file|ftp):/i.test(
        text.replace(/xmlns(?::\w+)?\s*=\s*["'][^"']*["']/g, ''),
      )
    )
      throw new Error('SVG 含外部引用或脚本，请先嵌入资源：' + file.path);
    for (const m of text.matchAll(/(?:href\s*=\s*["']|url\(\s*["']?)([^"')\s]+)/g)) {
      if (m[1].startsWith('#') || m[1].startsWith('data:')) continue;
      const resource = localPath(root, path.posix.join(path.posix.dirname(file.path), m[1]));
      if (!(await fs.lstat(resource)).isFile()) throw new Error('SVG 引用的资源不在项目内。');
    }
    const stem = path.posix.basename(file.path).replace(/\.svg$/i, '');
    const directory = path.join(root, 'svg-inkscape');
    await fs.mkdir(directory, { recursive: true });
    for (const latex of [true, false]) {
      const name = `${stem}_svg-${latex ? 'tex' : 'raw'}.pdf`,
        target = path.join(directory, name);
      const key = digest(
        JSON.stringify([
          2,
          file.content,
          settings.inkscape,
          toolStat.mtimeMs,
          toolStat.size,
          latex,
          dependencies,
        ]),
      );
      const targets = latex ? [target, target + '_tex'] : [target];
      const original = targets.filter((p) =>
        project.files.some((f) => path.resolve(root, f.path) === p),
      );
      if (original.length === targets.length) continue;
      if (original.length)
        throw new Error('SVG 转换目标已有项目文件，请补齐预生成文件或重命名：' + file.path);
      const fingerprints = () =>
        Promise.all(targets.map((p) => fs.readFile(p).then(digest, () => '')));
      let cached;
      try {
        cached = JSON.parse(await fs.readFile(target + '.sha256', 'utf8'));
      } catch {
        cached = {};
      }
      const before = await fingerprints();
      if (
        cached.key === key &&
        before.every(Boolean) &&
        JSON.stringify(before) === JSON.stringify(cached.files)
      )
        continue;
      append(`\nSVG → PDF · ${file.path}${latex ? '（保留 LaTeX 文字）' : ''}\n`);
      const args = [
        source,
        '--export-type=pdf',
        '--export-pdf-version=1.4',
        '--export-area-drawing',
        '--export-filename=' + target,
      ];
      if (latex) args.push('--export-latex');
      if ((await run(settings.inkscape, args, root)) !== 0)
        throw new Error('Inkscape 转换失败：' + file.path);
      const files = await fingerprints();
      if (!files.every(Boolean))
        throw new Error('Inkscape 没有生成完整的 PDF 与文字文件：' + file.path);
      await fs.writeFile(target + '.sha256', JSON.stringify({ key, files }));
    }
  }
}
module.exports = {
  localPath,
  mintedRequest,
  tikzRequest,
  prepareHooks,
  processRequests,
  prepareSvg,
};
