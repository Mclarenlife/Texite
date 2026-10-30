import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import { Compiler, readDirectory } from '../apps/desktop/workspace.cjs';
import { dependencies } from '../apps/desktop/cross-references.cjs';
import { localPath, mintedRequest, tikzRequest } from '../apps/desktop/external-tools.cjs';

const runtime = path.resolve(process.env.TEXITE_TEST_RUNTIME || 'runtime');
const hasRuntime = await fs.access(path.join(runtime, 'default.texite-runtime.zip')).then(
  () => true,
  () => false,
);

test('external requests accept known operations and reject custom executables, paths and command injection', () => {
  assert.equal(
    mintedRequest('latexminted config --timestamp 20261030120000 ' + 'a'.repeat(32)).action,
    'config',
  );
  for (const cmd of [
    'latexminted config; calc',
    'python evil.py',
    'latexminted highlight --custom-lexer evil.py ' + 'a'.repeat(32),
  ])
    assert.throws(() => mintedRequest(cmd));
  assert.throws(() => localPath(path.resolve('.qa'), '../outside'));
  assert.throws(() =>
    tikzRequest('pdflatex -shell-escape main.tex & calc', {
      engine: 'pdflatex',
      mainFile: 'main.tex',
    }),
  );
  const project = {
    mainFile: 'main.tex',
    files: [
      { path: 'main.tex', content: '\\externaldocument{other}' },
      { path: 'other.tex', content: '\\externaldocument{main}' },
    ],
  };
  assert.equal(dependencies(project).cyclic, true);
  assert.deepEqual(
    dependencies({
      ...project,
      files: [...project.files, { path: 'other.aux', content: '' }],
    }).ordered.map((x) => x.file),
    ['main.tex'],
  );
});

test(
  'cross-document references, cache reuse, submission export, clean rebuild and stale-result protection',
  {
    timeout: 180000,
    skip: !hasRuntime && 'Run runtime:prepare to test the distributable compiler.',
  },
  async () => {
    const base = await fs.mkdtemp(path.resolve('.qa/workflow-test-'));
    const compiler = new Compiler(path.join(base, 'cache'), runtime);
    const project = {
      id: 'workflow',
      name: 'Submission',
      mainFile: 'main.tex',
      engine: 'pdflatex',
      revision: 1,
      files: [
        {
          path: 'main.tex',
          content: String.raw`\documentclass{article}\usepackage{xr}\externaldocument[S-]{supplement}\begin{document}See section \ref{S-test}.\cite{ref}\bibliographystyle{plain}\bibliography{refs}\end{document}`,
        },
        {
          path: 'supplement.tex',
          content: String.raw`\documentclass{article}\begin{document}\section{Supplement}\label{test}Text\end{document}`,
        },
        {
          path: 'refs.bib',
          content:
            '@book{ref,title={Test book},author={Writer, Alice},year={2026},publisher={Example}}',
        },
      ],
    };
    const first = await compiler.compile(project);
    await fs.writeFile(path.join(base, 'first.log'), first.log);
    assert(first.success, first.log.slice(-6000));
    // Early passes may report undefined labels, final passes must resolve them.
    assert.doesNotMatch(first.log.slice(first.log.lastIndexOf('pdfLaTeX · 第')), /undefined/);
    assert(first.outputs.files.some((f) => f.path.endsWith('main.bbl')));
    const saved = await compiler.builds.get(first.outputs.buildId);
    const main = path.join(saved.root, 'main.tex');
    const stamp = (await fs.stat(main)).mtimeMs;
    const second = await compiler.compile(project);
    assert(second.success, second.log.slice(-3000));
    assert.match(second.log, /复用项目编译缓存 · 更新 0 个文件/);
    assert.equal((await fs.stat(main)).mtimeMs, stamp);
    assert.doesNotMatch(second.log, /BibTeX · 生成参考文献/);
    await assert.rejects(compiler.builds.get(first.outputs.buildId), /失效|更新/);
    const zipPath = path.join(base, 'submission.zip');
    await compiler.exportBuild(second.outputs.buildId, undefined, zipPath);
    const zip = await JSZip.loadAsync(await fs.readFile(zipPath));
    assert.equal(await zip.file('main.tex').async('string'), project.files[0].content);
    assert(zip.file('main.bbl'));
    assert(zip.file('supplement.aux'));
    assert(!Object.keys(zip.files).some((f) => f.includes('texite-hooks')));
    await assert.rejects(
      compiler.exportBuild(second.outputs.buildId, '../secret', path.join(base, 'bad')),
      /未知/,
    );
    const clean = await compiler.compile(project, () => {}, { clean: true });
    assert(clean.success);
    assert.match(clean.log, /建立项目编译缓存/);
    const broken = await compiler.compile({
      ...project,
      files: project.files.map((f) =>
        f.path === 'main.tex'
          ? { ...f, content: f.content.replace('See section', '\\NoSuchCommand See section') }
          : f,
      ),
    });
    assert(!broken.success);
    await assert.rejects(compiler.builds.get(clean.outputs.buildId), /失效|更新/);
    const restored = await compiler.compile(project);
    assert(restored.success);
    assert.match(restored.log, /建立项目编译缓存/);
    const empty = await compiler.compile({
      ...project,
      files: project.files.map((f) =>
        f.path === 'main.tex'
          ? { ...f, content: String.raw`\documentclass{article}\begin{document}\end{document}` }
          : f,
      ),
    });
    assert(!empty.success, 'a build producing no pages must never return a cached PDF');
    assert.equal(empty.pdf, undefined);
    const directory = path.join(base, 'import');
    await fs.mkdir(directory);
    await fs.writeFile(path.join(directory, 'external.aux'), '\\newlabel{x}{{1}{1}}');
    assert((await readDirectory(directory)).files.some((f) => f.path === 'external.aux'));
    const cyclic = {
      ...project,
      id: 'cycle',
      files: [
        {
          path: 'main.tex',
          content: String.raw`\documentclass{article}\usepackage{xr}\externaldocument[S-]{notes/supplement}\begin{document}\section{Main}\label{main}See \ref{S-test}.\end{document}`,
        },
        {
          path: 'notes/supplement.tex',
          content: String.raw`\documentclass{article}\usepackage{xr}\externaldocument[M-]{../main}\begin{document}\section{Supplement}\label{test}See \ref{M-main}.\end{document}`,
        },
      ],
    };
    const cycle = await compiler.compile(cyclic);
    assert(cycle.success, cycle.log.slice(-4000));
    assert.doesNotMatch(
      cycle.log.slice(cycle.log.lastIndexOf('pdfLaTeX · 第')),
      /undefined|仍未稳定/,
    );
    const cache = await compiler.builds.get(cycle.outputs.buildId);
    assert(cycle.outputs.files.some((f) => f.path === 'notes/supplement.pdf'));
    const supplied = await fs.readFile(path.join(cache.root, 'notes/supplement.aux'), 'utf8');
    const imported = await compiler.compile({
      ...cyclic,
      id: 'imported-aux',
      files: [cyclic.files[0], { path: 'notes/supplement.aux', content: supplied }],
    });
    assert(imported.success);
    assert.doesNotMatch(imported.log, /跨文档引用 ·/);
  },
);

test(
  'TikZ standard externalization works without enabling shell escape',
  {
    timeout: 120000,
    skip: !hasRuntime && 'Run runtime:prepare to test the distributable compiler.',
  },
  async () => {
    const base = await fs.mkdtemp(path.resolve('.qa/tikz-workflow-'));
    const compiler = new Compiler(path.join(base, 'cache'), runtime);
    const project = {
      id: 'tikz-workflow',
      name: 'TikZ',
      mainFile: 'main.tex',
      engine: 'pdflatex',
      revision: 1,
      files: [
        {
          path: 'main.tex',
          content: String.raw`\documentclass{article}\usepackage{tikz}\usetikzlibrary{external}\tikzexternalize[prefix=figures/]\begin{document}\begin{tikzpicture}\draw[red,thick] (0,0) -- (2,1);\end{tikzpicture}\end{document}`,
        },
      ],
    };
    const result = await compiler.compile(project);
    await fs.writeFile(path.join(base, 'result.log'), result.log);
    assert(result.success, result.log.slice(-7000));
    assert.match(result.log, /TikZ 外部化/);
    assert(result.outputs.files.some((f) => /main-figure0\.pdf$/.test(f.path)));
  },
);
