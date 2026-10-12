import test from 'node:test';
import assert from 'node:assert/strict';
import { visualBlocks, readGroup, displayMath, splitTopLevel } from '../packages/editor/visual';
import { validateProject } from '../packages/core/model';
import { createProject } from '../packages/core/sample';
test('visual edits use source offsets and preserve unknown commands and whitespace', () => {
  const source =
    '\\documentclass{article}\n\\newcommand{\\custom}{x}\n\\begin{document}\n\\section{Title}\nParagraph without blank separator.\n\n\\begin{equation}E=mc^2\\end{equation}\n\\custom\n\\end{document}\n';
  const blocks = visualBlocks(source);
  const heading = blocks.find((b) => b.kind === 'section')!;
  assert.equal(heading.text, 'Title');
  assert(blocks.some((b) => b.kind === 'paragraph'));
  assert.equal(blocks.find((b) => b.kind === 'math')!.text, 'E=mc^2');
  const updated =
    source.slice(0, heading.from) +
    heading.prefix +
    'Changed' +
    heading.suffix +
    source.slice(heading.to);
  assert.equal(updated, source.replace('{Title}', '{Changed}'));
});
test('folder validation catches path collisions and preserves empty folders', () => {
  const project = createProject();
  assert.deepEqual(validateProject({ ...project, folders: ['assets/empty'] }).folders, [
    'assets',
    'assets/empty',
  ]);
  assert.throws(() => validateProject({ ...project, folders: ['main.tex/child'] }));
  assert.throws(() => validateProject({ ...project, folders: ['../outside'] }));
});

test('balanced headings, nested environments and comments preserve every editable slice', () => {
  const source = String.raw`% \begin{document}
\documentclass{article}
\begin{document}
\section{A \textbf{nested \emph{heading}}}
\begin{itemize}
\item first
\begin{itemize}\item child\end{itemize}
% \end{itemize}
\item second
\end{itemize}
\begin{align}x &= 1\\ y &= 2\label{eq:test}\end{align}
\[x^2\]
\end{document}`;
  const blocks = visualBlocks(source);
  assert.equal(
    blocks.find((b) => b.kind === 'section')?.text,
    String.raw`A \textbf{nested \emph{heading}}`,
  );
  assert.equal(blocks.filter((b) => b.kind === 'environment').length, 1);
  for (const b of blocks) assert.equal(b.prefix + b.text + b.suffix, source.slice(b.from, b.to));
  assert.equal(
    displayMath(blocks.find((b) => b.environment === 'align')!),
    String.raw`\begin{aligned}x &= 1\\ y &= 2\end{aligned}`,
  );
  assert.equal(blocks.filter((b) => b.kind === 'math').length, 2);
  assert.equal(readGroup(String.raw`{a\}b{c}}`, 0)?.text, String.raw`a\}b{c}`);
});
test('table and list separators ignore nested groups, math and nested environments', () => {
  assert.deepEqual(splitTopLevel(String.raw`a & \textbf{b & c} & $x \& y$`, /&/), [
    'a ',
    String.raw` \textbf{b & c} `,
    String.raw` $x \& y$`,
  ]);
  assert.equal(
    splitTopLevel(String.raw`\item a\begin{itemize}\item b\end{itemize}\item c`, /\\item\b/).length,
    3,
  );
});
