import {
  snippetCompletion,
  type CompletionContext,
  type Completion,
} from '@codemirror/autocomplete';

const commands = [
  ['documentclass', '文档类型', '\\documentclass[${options}]{${article}}'],
  ['usepackage', '加载宏包', '\\usepackage{${package}}'],
  ['section', '章节', '\\section{${title}}'],
  ['subsection', '小节', '\\subsection{${title}}'],
  ['subsubsection', '子小节', '\\subsubsection{${title}}'],
  ['chapter', '章', '\\chapter{${title}}'],
  ['paragraph', '段落', '\\paragraph{${title}}'],
  ['title', '标题', '\\title{${title}}'],
  ['author', '作者', '\\author{${name}}'],
  ['date', '日期', '\\date{${\\today}}'],
  ['textbf', '粗体', '\\textbf{${text}}'],
  ['textit', '斜体', '\\textit{${text}}'],
  ['emph', '强调', '\\emph{${text}}'],
  ['texttt', '等宽文字', '\\texttt{${text}}'],
  ['underline', '下划线', '\\underline{${text}}'],
  ['footnote', '脚注', '\\footnote{${text}}'],
  ['label', '标签', '\\label{${name}}'],
  ['ref', '引用标签', '\\ref{${label}}'],
  ['eqref', '引用公式 · amsmath', '\\eqref{${label}}'],
  ['cite', '文献引用', '\\cite{${key}}'],
  ['includegraphics', '插入图片 · graphicx', '\\includegraphics[width=${0.8}\\linewidth]{${path}}'],
  ['input', '引入源文件', '\\input{${path}}'],
  ['include', '引入章节', '\\include{${path}}'],
  ['caption', '图表标题', '\\caption{${caption}}'],
  ['href', '链接 · hyperref', '\\href{${url}}{${text}}'],
  ['url', '网址 · url / hyperref', '\\url{${url}}'],
  ['item', '列表项', '\\item ${text}'],
  ['frac', '分数', '\\frac{${numerator}}{${denominator}}'],
  ['sqrt', '根式', '\\sqrt{${expression}}'],
  ['sum', '求和', '\\sum_{${i=1}}^{${n}} ${expression}'],
  ['int', '积分', '\\int_{${a}}^{${b}} ${f(x)}\\,dx'],
  ['lim', '极限', '\\lim_{${x\\to 0}} ${expression}'],
  ['binom', '二项式 · amsmath', '\\binom{${n}}{${k}}'],
  ['text', '公式内文字 · amsmath', '\\text{${text}}'],
  ['mathbb', '空心字 · amssymb', '\\mathbb{${R}}'],
  ['mathbf', '数学粗体', '\\mathbf{${x}}'],
  ['mathcal', '花体', '\\mathcal{${L}}'],
  ['overline', '上划线', '\\overline{${x}}'],
  ['vec', '向量', '\\vec{${v}}'],
  ['left', '自适应括号', '\\left(${expression}\\right)'],
  ['newcommand', '定义命令', '\\newcommand{\\${name}}{${definition}}'],
  ['bibliography', '参考文献文件', '\\bibliography{${references}}'],
  ['bibliographystyle', '参考文献样式', '\\bibliographystyle{${plain}}'],
  ['begin', '环境', '\\begin{${equation}}\n  ${content}\n\\end{${equation}}'],
];
const symbols =
  'alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa lambda mu nu xi pi varpi rho sigma tau upsilon phi varphi chi psi omega Gamma Delta Theta Lambda Xi Pi Sigma Upsilon Phi Psi Omega cdot times pm mp div leq geq neq approx equiv in notin subset supset subseteq supseteq cup cap forall exists partial nabla infty to rightarrow leftarrow Rightarrow Leftrightarrow ldots cdots sin cos tan log ln exp min max det maketitle tableofcontents newpage clearpage hline centering noindent appendix today'.split(
    ' ',
  );
export const environments: Record<string, string> = {
  document: '文档',
  equation: '编号公式',
  'equation*': '无编号公式 · amsmath',
  align: '对齐公式 · amsmath',
  'align*': '无编号对齐 · amsmath',
  gather: '多行公式 · amsmath',
  split: '拆分公式 · amsmath',
  cases: '分段函数 · amsmath',
  matrix: '矩阵 · amsmath',
  pmatrix: '圆括号矩阵 · amsmath',
  bmatrix: '方括号矩阵 · amsmath',
  figure: '图片浮动体',
  table: '表格浮动体',
  tabular: '表格',
  itemize: '无序列表',
  enumerate: '有序列表',
  description: '描述列表',
  abstract: '摘要',
  quote: '引用',
  center: '居中',
  verbatim: '原样代码',
  theorem: '定理 · 需定义',
  proof: '证明 · amsthm',
  tikzpicture: '绘图 · tikz',
  frame: '幻灯片 · beamer',
  minipage: '小页面',
};
export function latexCompletions(
  context: CompletionContext,
  references: string[],
  files: string[],
  labels: string[],
) {
  const before = context.state.sliceDoc(Math.max(0, context.pos - 300), context.pos);
  if (/(^|[^\\])%[^\n]*$/.test(before)) return null;
  const argument = before.match(
    /\\(cite\w*|(?:eq|page|auto|c|C)?ref|input|include|includegraphics|usepackage|begin|end)(?:\[[^\]]*\])?\{([^{}]*)$/,
  );
  if (argument) {
    const command = argument[1],
      fragment = argument[2].split(',').at(-1)!;
    let values: Completion[];
    if (command === 'begin' || command === 'end') {
      values = Object.entries(environments).map(([label, detail]) =>
        command === 'end'
          ? { label, detail, type: 'type' }
          : snippetCompletion(`${label}}\n  \${content}\n\\end{${label}}`, {
              label,
              detail,
              type: 'type',
            }),
      );
      // A typed closing brace is included in the replacement for begin snippets.
      return {
        from: context.pos - fragment.length,
        to:
          command === 'begin' && context.state.sliceDoc(context.pos, context.pos + 1) === '}'
            ? context.pos + 1
            : context.pos,
        options: values,
      };
    }
    if (command.startsWith('cite'))
      values = references.map((label) => ({ label, type: 'variable', detail: '参考文献' }));
    else if (command.endsWith('ref'))
      values = labels.map((label) => ({ label, type: 'variable', detail: '项目标签' }));
    else if (command === 'usepackage')
      values =
        'amsmath amssymb amsthm graphicx booktabs array multirow geometry hyperref xcolor enumitem ctex fontspec tikz pgfplots siunitx cleveref biblatex listings longtable caption subcaption float'
          .split(' ')
          .map((label) => ({ label, type: 'type', detail: '宏包' }));
    else
      values = files
        .filter((f) =>
          command === 'includegraphics' ? /\.(pdf|png|jpe?g|eps)$/i.test(f) : f.endsWith('.tex'),
        )
        .map((label) => ({
          label: command === 'includegraphics' ? label : label.replace(/\.tex$/i, ''),
          type: 'text',
          detail: '项目文件',
        }));
    return { from: context.pos - fragment.length, options: values, validFor: /^[\w\-./:]*$/ };
  }
  const word = context.matchBefore(/\\[A-Za-z]*/);
  if (!word) return null;
  return {
    from: word.from,
    options: [
      ...commands.map(([name, detail, body]) =>
        snippetCompletion(body, { label: '\\' + name, detail, type: 'function' }),
      ),
      ...symbols.map((name) => ({ label: '\\' + name, detail: 'LaTeX', type: 'keyword' })),
    ],
    validFor: /^\\[A-Za-z]*$/,
  };
}
