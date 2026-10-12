import type { Project } from './model';

export const sampleSource = String.raw`% 给想法，留一点空间。
\documentclass[11pt,a4paper]{article}
\usepackage[margin=28mm]{geometry}
\usepackage{amsmath}
\usepackage{graphicx}
\usepackage{hyperref}

\title{A Little Space for Big Ideas}
\author{Your name}
\date{\today}

\begin{document}
\maketitle

\begin{abstract}
Good writing starts with a little room to think.
This is your first document in Texite: a quiet
workspace for research, discovery, and the next idea.
\end{abstract}

\section{A fresh perspective}
Every great paper begins with a question.
Write yours here, then let the details follow.

Attention helps us find meaningful connections
between ideas \cite{vaswani2017}.

\section{Connecting the dots}
One familiar expression brings it all together:
\begin{equation}
  \mathrm{Attention}(Q,K,V) =
  \mathrm{softmax}\!\left(
    \frac{QK^{\mathsf T}}{\sqrt{d_k}}
  \right)V.
\end{equation}

\subsection{What comes next?}
Make a small change. Compile. See your ideas
take shape, one paragraph at a time.

\bibliographystyle{plain}
\bibliography{references}
\end{document}
`;
export function createProject(name = '关于下一个好想法', blank = false): Project {
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
