export const escapeText = (s: string) =>
  s.replace(
    /[\\{}%&#_$^~]/g,
    (c) =>
      ({ '\\': '\\textbackslash{}', '^': '\\textasciicircum{}', '~': '\\textasciitilde{}' })[c] ??
      '\\' + c,
  );
export type FloatOptions = {
  wide: boolean;
  floating: boolean;
  centered: boolean;
  caption: string;
  label: string;
};
export function withFloat(body: string, kind: 'table' | 'figure', options: FloatOptions) {
  const centered = options.centered ? '\\centering\n' : '';
  if (!(options.floating || options.wide))
    return options.centered ? `{\n${centered}${body}\n\\par}\n` : body + '\n';
  const env = kind + (options.wide ? '*' : '');
  const caption = options.caption ? `\\caption{${escapeText(options.caption)}}\n` : '';
  const label = options.label ? `\\label{${options.label}}\n` : '';
  return `\\begin{${env}}[${options.wide ? 't' : 'htbp'}]\n${centered}${body}\n${caption}${label}\\end{${env}}\n`;
}
export function tableCode(rows: number, cols: number, booktabs: boolean, options: FloatOptions) {
  const lines = Array.from(
    { length: rows },
    (_, r) =>
      Array.from({ length: cols }, (_, c) => (r === 0 ? '标题 ' + (c + 1) : '内容')).join(' & ') +
      ' \\\\',
  );
  if (booktabs && rows > 1) lines.splice(1, 0, '\\midrule');
  return withFloat(
    `\\begin{tabular}{${'l'.repeat(cols)}}\n${booktabs ? '\\toprule' : '\\hline'}\n${lines.join('\n')}\n${booktabs ? '\\bottomrule' : '\\hline'}\n\\end{tabular}`,
    'table',
    options,
  );
}
export type FormulaStyle = 'display' | 'inline' | 'align' | 'cases' | 'matrix';
export function formulaCode(body: string, style: FormulaStyle, numbered: boolean, label: string) {
  if (style === 'inline') return `\\(${body || 'E = mc^2'}\\)`;
  const env = style === 'align' ? (numbered ? 'align' : 'align*') : numbered ? 'equation' : '';
  let content =
    body ||
    (style === 'align'
      ? 'a &= b + c \\\\\nd &= e + f'
      : style === 'cases'
        ? 'x, & x \\ge 0 \\\\\n-x, & x < 0'
        : style === 'matrix'
          ? 'a & b \\\\\nc & d'
          : 'E = mc^2');
  if (style === 'cases') content = `f(x) = \\begin{cases}\n${content}\n\\end{cases}`;
  if (style === 'matrix') content = `\\begin{pmatrix}\n${content}\n\\end{pmatrix}`;
  if (!env) return `\\[\n${content}\n\\]\n`;
  return `\\begin{${env}}\n${content}${numbered && label ? '\n\\label{' + label + '}' : ''}\n\\end{${env}}\n`;
}
export const symbolGroups = [
  {
    name: '希腊字母',
    items: [
      ['α', 'alpha'],
      ['β', 'beta'],
      ['γ', 'gamma'],
      ['δ', 'delta'],
      ['ε', 'epsilon'],
      ['θ', 'theta'],
      ['λ', 'lambda'],
      ['μ', 'mu'],
      ['π', 'pi'],
      ['σ', 'sigma'],
      ['φ', 'phi'],
      ['ω', 'omega'],
      ['Γ', 'Gamma'],
      ['Δ', 'Delta'],
      ['Θ', 'Theta'],
      ['Σ', 'Sigma'],
      ['Φ', 'Phi'],
      ['Ω', 'Omega'],
    ],
  },
  {
    name: '运算与关系',
    items: [
      ['±', 'pm'],
      ['×', 'times'],
      ['÷', 'div'],
      ['·', 'cdot'],
      ['∑', 'sum'],
      ['∏', 'prod'],
      ['∫', 'int'],
      ['∂', 'partial'],
      ['∇', 'nabla'],
      ['∞', 'infty'],
      ['≠', 'neq'],
      ['≈', 'approx'],
      ['≤', 'leq'],
      ['≥', 'geq'],
      ['≡', 'equiv'],
      ['∝', 'propto'],
    ],
  },
  {
    name: '集合与逻辑',
    items: [
      ['∈', 'in'],
      ['∉', 'notin'],
      ['⊂', 'subset'],
      ['⊆', 'subseteq'],
      ['∪', 'cup'],
      ['∩', 'cap'],
      ['∅', 'emptyset'],
      ['∀', 'forall'],
      ['∃', 'exists'],
      ['¬', 'neg'],
      ['∧', 'land'],
      ['∨', 'lor'],
    ],
  },
  {
    name: '箭头',
    items: [
      ['←', 'leftarrow'],
      ['→', 'rightarrow'],
      ['↔', 'leftrightarrow'],
      ['⇒', 'Rightarrow'],
      ['⇔', 'Leftrightarrow'],
      ['↦', 'mapsto'],
      ['↑', 'uparrow'],
      ['↓', 'downarrow'],
    ],
  },
];
