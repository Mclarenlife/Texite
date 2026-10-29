/* Only bundled resources; no remote resolver or shell escape. */
importScripts('busytex_pipeline.js');
const root = new URL('.', self.location.href).href;
const packages = ['texlive-basic.js', 'ubuntu-texlive-latex-recommended.js', 'ubuntu-texlive-latex-extra.js'].map(name => root + name);
let running = false;
self.onmessage = async ({ data: { project } }) => {
  if (running || !project) return;
  running = true;
  try {
    postMessage({ status: '加载本地宏包与字体' });
    const pipeline = new BusytexPipeline(root + 'busytex.js', root + 'busytex.wasm', packages, packages, ['/texite'], () => {}, () => {}, true, BusytexPipeline.ScriptLoaderWorker);
    // preRun receives this same environment object before the module initializes.
    for (const key of ['TEXINPUTS', 'BIBINPUTS', 'BSTINPUTS'])
      pipeline.env[key] = '.:' + pipeline.project_dir + '//:';
    const module = await pipeline.Module;
    // Emscripten's generated main adapter prepends argv[0] in place. The
    // upstream pipeline reuses a command array for the two post-BibTeX passes.
    const callMain = module.callMain;
    module.callMain = args => callMain.call(module, [...args]);
    const { FS } = module;
    const [manifest, buffer] = await Promise.all([fetch(root + 'chinese.json').then(r => r.json()), fetch(root + 'chinese.data').then(r => r.arrayBuffer())]);
    const bytes = new Uint8Array(buffer);
    for (const file of manifest.files) {
      const path = '/texite/texmf-dist/' + file.path;
      FS.mkdirTree(path.slice(0, path.lastIndexOf('/')));
      FS.writeFile(path, bytes.subarray(file.start, file.end));
    }
    const mainMap = '/texlive/texmf-dist/texmf-var/fonts/map/pdftex/updmap/pdftex.map';
    const map = FS.readFile(mainMap, { encoding: 'utf8' });
    FS.unlink(mainMap);
    FS.writeFile(mainMap, map + '\n' + manifest.maps);
    const files = project.files.map(file => ({ path: file.path, contents: file.binary ? Uint8Array.from(atob(file.content), c => c.charCodeAt(0)) : file.content }));
    postMessage({ status: 'pdfLaTeX 正在排版' });
    let output = await pipeline.compile(files, project.mainFile, null, 'silent', 'pdftex_bibtex8', packages);
    for (let pass = 1; pass < 3 && output.exit_code === 0 && /Rerun to get|Label\(s\) may have changed|rerunfilecheck Warning/.test(output.logs.at(-1)?.log || ''); pass++) {
      const auxiliary = [];
      const walk = (directory, relative = '') => {
        for (const name of FS.readdir(directory)) {
          if (name === '.' || name === '..') continue;
          const path = directory + '/' + name, rel = relative + name;
          if (FS.isDir(FS.stat(path).mode)) walk(path, rel + '/');
          else if (/\.(aux|toc|out|bbl|lof|lot)$/.test(name) && !files.some(f => f.path === rel)) auxiliary.push({ path: rel, contents: FS.readFile(path) });
        }
      };
      walk(pipeline.project_dir);
      postMessage({ status: `更新交叉引用 · 第 ${pass + 1} 遍` });
      output = await pipeline.compile([...files, ...auxiliary], project.mainFile, null, 'silent', 'pdftex_bibtex8', packages);
    }
    const reports = output.exit_code === 0 ? output.logs.slice(-1) : output.logs;
    const log = reports.map(item => '$ ' + item.cmd + '\nExit: ' + item.exit_code + '\n' + (item.log || item.stdout || '') + '\n' + item.stderr).join('\n');
    postMessage({ result: { success: output.exit_code === 0 && !!output.pdf?.length, pdf: output.pdf, log } });
  } catch (error) { postMessage({ error: '离线编译失败：' + (error.message || error) }); }
};
