import test from 'node:test';
import assert from 'node:assert/strict';
import {
  safePath,
  validateProject,
  parseDiagnostics,
  getOutline,
  getReferences,
} from '../packages/core/model';
import { createProject } from '../packages/core/sample';
import { diagnosticTarget } from '../packages/preview/CompileDiagnostics';

test('rejects traversal, Windows device paths, reserved directories and ambiguous file names', () => {
  for (const name of [
    '../outside.tex',
    '/outside.tex',
    'C:\\file.tex',
    'a/../../x.tex',
    'a//b.tex',
    'NUL.tex',
    'bad.',
    '.git/config',
    'a/./b.tex',
    'file\0.tex',
  ])
    assert.throws(() => safePath(name));
  assert.equal(safePath('chapters\\引言.tex'), 'chapters/引言.tex');
});

test('diagnostics retain fatal fonts after many warnings and locate nested sources', () => {
  const warnings = Array.from(
    { length: 120 },
    (_, i) => `LaTeX Warning: Reference ${i} undefined on input line ${i + 1}.`,
  ).join('\n');
  const result = parseDiagnostics(
    warnings + '\n!pdfTeX error: pdftex.exe (file ptmb8r): Font ptmb8r at 58 not found',
  );
  assert.equal(result[0].severity, 'error');
  assert.match(result[0].message, /ptmb8r/);
  assert.equal(result[1].line, 1);
  const nested = parseDiagnostics(
    '(./main.tex\n(./chapters/intro.tex\nLaTeX Warning: Citation missing on input line 4.\n)\n! Undefined control sequence.\nl.9 \\oops\n)',
  );
  assert.equal(nested[0].file, 'main.tex');
  assert.equal(nested[0].line, 9);
  assert.equal(nested[1].file, 'chapters/intro.tex');
  assert.equal(nested[1].line, 4);
  const project = createProject();
  assert.equal(
    diagnosticTarget(
      { severity: 'error', message: 'font', file: '/texlive/font.sty', line: 9 },
      project,
    ),
    undefined,
  );
  assert.equal(diagnosticTarget({ severity: 'error', message: 'font' }, project), undefined);
  assert.deepEqual(
    diagnosticTarget(
      { severity: 'error', message: 'error', file: 'C:/cache/main.tex', line: 4 },
      project,
    ),
    { file: 'main.tex', line: 4 },
  );
});
test('managed passes replace resolved citation warnings while preserving final problems and BibTeX diagnostics', () => {
  for (const engine of ['pdfLaTeX', 'XeLaTeX', 'LuaLaTeX']) {
    const first = `${engine} · 第 1 遍\n(./main.tex\nLaTeX Warning: Citation \`resolved' on page 2 undefined on input line 70.\n)\nBibTeX · 生成参考文献\nWarning--empty year in retained\n`;
    const final = `${engine} · 第 3 遍\n(./main.tex\n(./chapters/results.tex\nLaTeX Warning: Citation \`missing' on page 4 undefined on input line 9.\n)\nOverfull \\hbox (2.0pt too wide) at lines 10--11\n)\n`;
    const result = parseDiagnostics(first + final);
    assert.equal(result.length, 3);
    assert(!result.some((d) => d.message.includes('resolved')));
    assert(result.some((d) => d.message.includes('BibTeX: Warning--empty year')));
    assert.deepEqual(
      result.find((d) => d.message.includes('missing')),
      {
        severity: 'warning',
        file: 'chapters/results.tex',
        line: 9,
        message: "LaTeX Warning: Citation `missing' on page 4 undefined on input line 9.",
      },
    );
    assert.equal(
      parseDiagnostics(first + `${engine} · 第 2 遍\n! Fatal font error\nl.12 text`)[0].severity,
      'error',
    );
  }
  assert.deepEqual(
    parseDiagnostics(
      "pdfLaTeX · 第 1 遍\nLaTeX Warning: Citation `resolved' undefined.\npdfLaTeX · 第 2 遍\nOutput written on main.pdf",
    ),
    [],
  );
  const bibFailure = parseDiagnostics(
    "pdfLaTeX · 第 1 遍\nBibTeX · 生成参考文献\nI couldn't open database file absent.bib",
  );
  assert.equal(bibFailure[0].severity, 'error');
  assert.match(bibFailure[0].message, /absent.bib/);
});

test('box diagnostics exclude shipout progress, keep wrapped locations and preserve subsequent file nesting', () => {
  const diagnostics = parseDiagnostics(
    [
      '(./main.tex',
      'Underfull \\vbox (badness 10000) has occurred while \\output is active',
      'Underfull \\vbox (badness 10000) has occurred while \\output is active [7 <./fig.pdf>] [8] (./chapters/next.tex',
      'LaTeX Warning: Citation missing on input line 5.',
      ')',
      'Underfull \\hbox (badness 4403) in paragraph',
      '  at lines 48--49',
      '  []\\OT1/ptm/m/n/10 A paragraph dump',
      'Overfull \\hbox (2.0pt too wide) detected at line 60',
      'Package example Warning: A wrapped warning',
      '(example)    on input line 70.',
    ].join('\n'),
  );
  assert.equal(diagnostics.length, 5);
  assert.equal(
    diagnostics[0].message,
    'Underfull \\vbox (badness 10000) has occurred while \\output is active',
  );
  assert.equal(diagnostics[1].file, 'chapters/next.tex');
  assert.equal(diagnostics[2].line, 48);
  assert.equal(diagnostics[2].file, 'main.tex');
  assert(!diagnostics[2].message.includes('paragraph dump'));
  assert.equal(diagnostics[3].line, 60);
  assert.equal(diagnostics[4].line, 70);
});

test('validates a project and recovers a missing main selection without losing assets', () => {
  const project = createProject();
  project.mainFile = 'missing.tex';
  project.files.push({ path: 'figures/x.png', content: 'aGVsbG8=', binary: true });
  const result = validateProject(project);
  assert.equal(result.mainFile, 'main.tex');
  assert.equal(result.files.length, 3);
  assert.throws(() =>
    validateProject({ ...project, files: [...project.files, { path: 'MAIN.tex', content: '' }] }),
  );
  assert.equal(
    validateProject({ ...project, files: [{ path: 'readme.txt', content: 'hi' }] }).mainFile,
    '',
  );
  const empty = validateProject({ ...project, files: [] });
  assert.equal(empty.mainFile, '');
  assert.equal(empty.activeFile, '');
});
test('indexes sections, citations and located compiler errors', () => {
  const project = createProject();
  assert.equal(getOutline(project.files[0].content).length, 3);
  assert.equal(getReferences(project.files)[0].key, 'vaswani2017');
  const diagnostics = parseDiagnostics(
    'chapters/intro.tex:12: Undefined control sequence.\nLaTeX Warning: Reference missing.',
  );
  assert.equal(diagnostics[0].file, 'chapters/intro.tex');
  assert.equal(diagnostics[0].line, 12);
  assert.equal(diagnostics[1].severity, 'warning');
});
