import type { Project } from './model';

export const sampleSource = String.raw`% Texite 示例文稿
\documentclass[11pt,a4paper]{article}
\usepackage[margin=28mm]{geometry}
\usepackage{amsmath}
\usepackage{graphicx}
\usepackage{hyperref}

\title{Research Notes}
\author{Your name}
\date{\today}

\begin{document}
\maketitle

\begin{abstract}
This example demonstrates sections, equations,
citations, and a bibliography in a LaTeX document.
\end{abstract}

\section{Introduction}
Replace this paragraph with an introduction to your work.

The attention mechanism is described in \cite{vaswani2017}.

\section{Method}
Scaled dot-product attention is defined as:
\begin{equation}
  \mathrm{Attention}(Q,K,V) =
  \mathrm{softmax}\!\left(
    \frac{QK^{\mathsf T}}{\sqrt{d_k}}
  \right)V.
\end{equation}

\subsection{Results}
Add your results here, then compile to update the PDF.

\bibliographystyle{plain}
\bibliography{references}
\end{document}
`;
export function createProject(name = '示例项目', blank = false): Project {
  return {
    id: crypto.randomUUID(),
    name,
    mainFile: 'main.tex',
    activeFile: 'main.tex',
    engine: 'pdflatex',
    revision: 0,
    updatedAt: Date.now(),
    files: [
      {
        path: 'main.tex',
        content: blank
          ? String.raw`\documentclass{article}
\begin{document}
Hello, Texite!
\end{document}
`
          : sampleSource,
      },
      ...(blank
        ? []
        : [
            {
              path: 'references.bib',
              content: String.raw`@article{vaswani2017,
  title = {Attention Is All You Need},
  author = {Vaswani, Ashish and Shazeer, Noam and others},
  year = {2017},
  journal = {Advances in Neural Information Processing Systems}
}
`,
            },
          ]),
    ],
  };
}
