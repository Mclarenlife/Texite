const { _electron: electron, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const JSZip = require('jszip');
(async () => {
  await fs.mkdir('.qa', { recursive: true });
  const profile = await fs.mkdtemp(path.resolve('.qa/mechanisms-packaged-'));
  const executablePath = process.argv.includes('--source')
    ? require('electron')
    : process.env.TEXITE_TEST_EXECUTABLE || path.resolve('release/win-unpacked/Texite.exe');
  const desktop = await electron.launch({
    executablePath,
    args: process.argv.includes('--source') ? ['.'] : [],
    env: { ...process.env, TEXITE_TEST_USER_DATA: profile },
  });
  try {
    const page = await desktop.firstWindow();
    await page.waitForFunction(() => !!window.texite?.compile);
    await page.evaluate(() => window.texite.setPackageDownloadSettings({ autoDownload: false }));
    const result = await page.evaluate(
      async (project) => {
        const first = await window.texite.compile(project);
        if (!first.success) return first;
        const result = await window.texite.compile(project);
        const binaryTransfer = result.pdf instanceof Uint8Array;
        return {
          ...result,
          firstLog: first.log,
          pdf: result.pdf && Array.from(result.pdf),
          binaryTransfer,
        };
      },
      {
        id: 'offline-mechanisms',
        name: 'Offline mechanisms',
        engine: 'pdflatex',
        revision: 1,
        mainFile: 'main.tex',
        activeFile: 'main.tex',
        files: [
          {
            path: 'main.tex',
            content: String.raw`\documentclass{article}\usepackage{graphicx}\usepackage{biblatex}\usepackage{makeidx}\usepackage{xr}\externaldocument[S-]{supplement}\makeindex\addbibresource{references.bib}\begin{document}See \ref{S-test}.\includegraphics{images/fig.eps}\cite{test}\index{Apple}\printbibliography\printindex\end{document}`,
          },
          {
            path: 'supplement.tex',
            content: String.raw`\documentclass{article}\begin{document}\section{Supplement}\label{test}Supplement text\end{document}`,
          },
          {
            path: 'images/fig.eps',
            content:
              '%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: (atend)\n10 20 200 100 rectfill\nshowpage\n%%Trailer\n%%BoundingBox: 10 20 210 120\n%%EOF',
          },
          {
            path: 'bibliography/references.bib',
            content:
              '@book{test,title={Offline Reference},author={Writer, Alice},year={2026},publisher={Texite}}',
          },
        ],
      },
    );
    await fs.writeFile(path.join(profile, 'packaged.log'), result.log);
    expect(result.success, result.log.slice(-8000)).toBe(true);
    expect(result.pdf.length).toBeGreaterThan(1000);
    if (process.argv.includes('--source')) expect(result.binaryTransfer).toBe(true);
    expect(result.firstLog).toContain('Biber · 生成参考文献');
    expect(result.firstLog).toContain('MakeIndex · 生成索引');
    expect(result.firstLog).toContain('EPS → PDF');
    expect(result.log).toContain('复用项目编译缓存 · 更新 0 个文件');
    expect(result.log).not.toMatch(/Biber · 生成参考文献|MakeIndex · 生成索引/);
    expect(result.log).not.toMatch(/using draft setting|EPS 图片转换失败|正在从 TeX Live 镜像下载/);
    await fs.writeFile(path.join(profile, 'packaged.pdf'), Buffer.from(result.pdf));
    const exported = path.join(profile, 'submission.zip');
    await desktop.evaluate(({ dialog }, target) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: target });
    }, exported);
    expect(
      await page.evaluate((id) => window.texite.exportCompileOutput(id), result.outputs.buildId),
    ).toBe(true);
    const archive = await JSZip.loadAsync(await fs.readFile(exported));
    expect(archive.file('main.bbl')).not.toBeNull();
    expect(archive.file('supplement.aux')).not.toBeNull();
    expect(archive.file('main.tex')).not.toBeNull();
    console.log(
      JSON.stringify({
        sourceRun: process.argv.includes('--source'),
        offlineEPS: true,
        binaryTransfer: result.binaryTransfer,
        biber: true,
        makeindex: true,
        crossReferences: true,
        cacheReuse: true,
        submissionExport: exported,
        pdfBytes: result.pdf.length,
      }),
    );
  } finally {
    await desktop.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
