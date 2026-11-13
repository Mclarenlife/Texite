import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendPapers,
  bibDestinations,
  discoverPapers,
  manuscript,
} from '../packages/core/literature';
import { createProject } from '../packages/core/sample';

test('only indexed candidates can be saved; protect BibTeX, resolve nested bibliography and deduplicate across files', async () => {
  const project = createProject();
  project.mainFile = 'paper/main.tex';
  project.files = [{ path: project.mainFile, content: '\\addbibresource{sources.bib}' }];
  assert.deepEqual(bibDestinations(project), ['paper/sources.bib']);
  let turns = 0;
  const { papers } = await discoverPapers(
    'manuscript',
    async () =>
      ++turns === 1
        ? '{"query":"test"}'
        : '{"papers":[{"id":42,"summary":"fabricated"},{"id":0,"summary":"虚构的结论","evidence":"made up data"},{"id":0,"summary":"研究比较了两种算法。","evidence":"We compare two algorithms."}]}',
    new AbortController().signal,
    () => {},
    async () =>
      Response.json({
        message: {
          items: [
            {
              DOI: '10.1000/template',
              title: ['Supplemental Information 1: PeerJ LaTeX template file.'],
              abstract: 'An attached manuscript template.',
            },
            {
              DOI: '10.1000/template2',
              title: ['A Latex Template for SocArXiv'],
              abstract: 'Preparation instructions for authors.',
            },
            {
              DOI: '10.1000/template3',
              title: ['Manuscript template review article'],
              abstract: 'This is a journal template.',
            },
            { DOI: '10.1000/no-abstract', title: ['A legitimate study with no abstract'] },
            {
              DOI: '10.1000/abc',
              title: ['A & B'],
              abstract: '<jats:p>We compare two algorithms.</jats:p>',
              type: 'journal-article',
              author: [{ family: 'Jones', given: 'A' }],
              issued: { 'date-parts': [[2023]] },
              page: '10-20',
            },
          ],
        },
      }),
  );
  assert.equal(papers.length, 1);
  assert.equal(papers[0].summary, '研究比较了两种算法。');
  const previous = { path: 'another.bib', content: '@article{Jones2023,\n  title={Other}\n}' };
  const next = appendPapers([previous], 'paper/sources.bib', papers);
  assert.match(next.content, /@article\{Jones2023-2,/);
  assert.match(next.content, /A \\& B/);
  assert.match(next.content, /pages = \{10--20\}/);
  assert.match(next.content, /\}\n% https:\/\/doi.org\/10\.1000\/abc\n$/);
  assert.equal(
    appendPapers([{ path: 'another.bib', content: next.content }], 'paper/sources.bib', papers)
      .count,
    0,
  );
});

test('Springer command-form abstract and included research methods survive a long template front matter', () => {
  const project = createProject();
  project.files = [
    {
      path: 'main.tex',
      content:
        '\\documentclass{sn-jnl}\n\\begin{document}\n\\author{' +
        'Author Affiliation '.repeat(500) +
        '}\n\\title[Short]{Inverse \\textit{heat} problems}\n\\abstract{We reconstruct conductivity using \\emph{spectral collocation} on noisy data.}\n\\section{Introduction}\nReplace this paragraph with an introduction to your work.\n\\input{chapters/method}\n\\end{document}',
    },
    {
      path: 'chapters/method.tex',
      content: '\\section{Method}\nWe solve the inverse problem using adaptive Chebyshev nodes.',
    },
  ];
  const excerpt = manuscript(project);
  assert.match(excerpt, /spectral collocation/);
  assert.match(excerpt, /adaptive Chebyshev/);
  assert.doesNotMatch(excerpt, /Affiliation|Replace this paragraph/);
});
test('template-only query stops before contacting the index', async () => {
  await assert.rejects(
    discoverPapers(
      'Journal template',
      async () => '{"query":"LaTeX manuscript templates"}',
      new AbortController().signal,
      () => {},
      async () => {
        throw new Error('unexpected search');
      },
    ),
    /研究主题/,
  );
});

test('search skips existing BibTeX before ranking and resumes with fresh exclusions and inclusive years', async () => {
  const filters = { count: 1, from: '2022', to: '2025' };
  const files = [
    {
      path: 'refs.bib',
      content: '@article{old,\n title={{Known} Paper},\n DOI={10.1234/EXISTING}\n}',
    },
  ];
  const all = [
    'Known Paper',
    'Existing DOI',
    'Outside range',
    ...Array.from({ length: 19 }, (_, i) => 'Study ' + i),
  ].map((title, i) => ({
    title: [title],
    DOI: i === 1 ? '10.1234/existing' : '10.1234/id' + i,
    issued: { 'date-parts': [[i === 2 ? 2018 : 2025]] },
    abstract: 'This study compares numerical methods.',
  }));
  const offsets: number[] = [];
  const fetcher: typeof fetch = async (input) => {
    const params = new URL(String(input)).searchParams;
    assert.equal(
      params.get('filter'),
      'has-abstract:true,from-pub-date:2022-01-01,until-pub-date:2025-12-31',
    );
    const offset = Number(params.get('offset'));
    offsets.push(offset);
    return Response.json({
      message: { items: all.slice(offset, offset + 16), 'total-results': all.length },
    });
  };
  const ranked: string[] = [];
  const ask = async (_prompt: string, data: string) => {
    if (data === 'heat') return '{"query":"heat diffusion"}';
    const { candidates } = JSON.parse(data);
    ranked.push(...candidates.map((c: { title: string }) => c.title));
    return JSON.stringify({
      papers: candidates.map((c: { id: number; abstract: string }) => ({
        id: c.id,
        summary: '数值比较',
        evidence: c.abstract,
      })),
    });
  };
  const signal = new AbortController().signal;
  const run = (options: NonNullable<Parameters<typeof discoverPapers>[5]>) =>
    discoverPapers('heat', ask, signal, () => {}, fetcher, options);
  const first = await run({ filters, files, excluded: [] });
  assert.deepEqual(
    first.papers.map((p) => p.title),
    ['Study 0'],
  );
  assert.ok(
    !ranked.includes('Known Paper') &&
      !ranked.includes('Existing DOI') &&
      !ranked.includes('Outside range'),
  );
  files.push({ path: 'more.bib', content: '@article{duringSearch,title="Study 1"}' });
  const next = await run({
    filters: { ...filters, count: 14 },
    cursor: first.cursor,
    files,
    excluded: first.papers,
  });
  assert.deepEqual(offsets, [0, 16]);
  assert.equal(next.papers.length, 14);
  assert.equal(next.papers[0].title, 'Study 2');
  const restarted = await run({ filters, files, excluded: [] });
  assert.equal(restarted.papers[0].title, 'Study 0');
});
