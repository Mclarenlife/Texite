import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { StreamLanguage, syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { stex } from '@codemirror/legacy-modes/mode/stex';
import {
  autocompletion,
  snippetCompletion,
  type CompletionContext,
} from '@codemirror/autocomplete';
import { indentWithTab } from '@codemirror/commands';
import { openSearchPanel } from '@codemirror/search';
import { tags } from '@lezer/highlight';
import type { ProjectFile } from '../core/model';

export type EditorHandle = {
  jump: (position: number) => void;
  search: () => void;
  insert: (text: string) => void;
  focus: () => void;
};
type Props = {
  projectId: string;
  file: ProjectFile;
  fontSize: number;
  references: string[];
  onChange: (content: string, path: string) => void;
  onCursor: (line: number, column: number, reference?: string) => void;
  onCompile: () => void;
  onSave: () => void;
};
const highlighting = HighlightStyle.define([
  {
    tag: [tags.keyword, tags.tagName, tags.function(tags.variableName)],
    color: 'var(--syntax-keyword)',
  },
  {
    tag: [tags.string, tags.attributeValue, tags.atom, tags.number],
    color: 'var(--syntax-string)',
  },
  { tag: tags.comment, color: 'var(--syntax-comment)', fontStyle: 'italic' },
  { tag: [tags.bracket, tags.punctuation], color: 'var(--syntax-punctuation)' },
]);
export const SourceEditor = forwardRef<EditorHandle, Props>(function SourceEditor(props, ref) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const current = useRef(props);
  current.current = props;
  const states = useRef(new Map<string, EditorState>());
  const active = useRef('');
  const externalChange = useRef(false);
  const font = useRef(new Compartment());
  const factory = useRef<((content: string) => EditorState) | null>(null);
  useImperativeHandle(
    ref,
    () => ({
      jump(position) {
        const v = view.current;
        if (!v) return;
        const pos = Math.max(0, Math.min(position, v.state.doc.length));
        v.dispatch({
          selection: { anchor: pos },
          effects: EditorView.scrollIntoView(pos, { y: 'center' }),
        });
        v.focus();
      },
      search() {
        if (view.current) openSearchPanel(view.current);
      },
      insert(text) {
        const v = view.current;
        if (v) {
          v.dispatch(v.state.replaceSelection(text));
          v.focus();
        }
      },
      focus() {
        view.current?.focus();
      },
    }),
    [],
  );
  useEffect(() => {
    states.current.clear();
    active.current = '';
    const completion = (ctx: CompletionContext) => {
      const citation = ctx.matchBefore(/\\cite\w*\{[^}]*$/);
      if (citation) {
        const from = citation.from + citation.text.lastIndexOf('{') + 1;
        return {
          from,
          options: current.current.references.map((label) => ({ label, type: 'variable' })),
        };
      }
      const word = ctx.matchBefore(/\\[a-zA-Z]*/);
      if (!word || (word.from === word.to && !ctx.explicit)) return null;
      return {
        from: word.from,
        options: [
          snippetCompletion('\\section{${title}}', { label: '\\section', detail: '章节' }),
          snippetCompletion('\\subsection{${title}}', { label: '\\subsection', detail: '小节' }),
          snippetCompletion('\\begin{${equation}}\n  ${}\n\\end{${equation}}', {
            label: '\\begin',
            detail: '环境',
          }),
          snippetCompletion('\\frac{${numerator}}{${denominator}}', {
            label: '\\frac',
            detail: '分式',
          }),
          snippetCompletion('\\textbf{${text}}', { label: '\\textbf', detail: '粗体' }),
          snippetCompletion('\\includegraphics[width=\\linewidth]{${file}}', {
            label: '\\includegraphics',
            detail: '图片',
          }),
          snippetCompletion('\\cite{${key}}', { label: '\\cite', detail: '引用' }),
          snippetCompletion('\\label{${name}}', { label: '\\label', detail: '标签' }),
          snippetCompletion('\\ref{${name}}', { label: '\\ref', detail: '交叉引用' }),
        ],
      };
    };
    const extensions = [
      basicSetup,
      StreamLanguage.define(stex),
      syntaxHighlighting(highlighting),
      EditorView.lineWrapping,
      autocompletion({ override: [completion] }),
      keymap.of([
        indentWithTab,
        {
          key: 'Mod-Enter',
          run: () => {
            current.current.onCompile();
            return true;
          },
        },
        {
          key: 'Mod-s',
          run: () => {
            current.current.onSave();
            return true;
          },
        },
      ]),
      font.current.of(EditorView.theme({ '&': { fontSize: current.current.fontSize + 'px' } })),
      EditorView.contentAttributes.of({ 'aria-label': 'LaTeX 源码编辑器', spellcheck: 'false' }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged && !externalChange.current)
          current.current.onChange(update.state.doc.toString(), current.current.file.path);
        if (update.selectionSet || update.docChanged) {
          const pos = update.state.selection.main.head;
          const line = update.state.doc.lineAt(pos);
          const found = [...line.text.matchAll(/\\cite\w*\{([^}]+)\}/g)].find(
            (m) => pos - line.from >= m.index! && pos - line.from <= m.index! + m[0].length,
          );
          current.current.onCursor(line.number, pos - line.from + 1, found?.[1].split(',')[0]);
        }
      }),
    ];
    const makeState = (content: string) => EditorState.create({ doc: content, extensions });
    factory.current = makeState;
    const initial = makeState(current.current.file.content);
    view.current = new EditorView({ state: initial, parent: host.current! });
    active.current = current.current.file.path;
    // Keep one view and retain per-file selection and undo history.
    return () => {
      view.current?.destroy();
      view.current = null;
    };
  }, [props.projectId]);
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    if (active.current !== props.file.path) {
      states.current.set(active.current, v.state);
      const cached = states.current.get(props.file.path);
      v.setState(cached ?? factory.current!(props.file.content));
      active.current = props.file.path;
      const position = v.state.selection.main.head;
      const line = v.state.doc.lineAt(position);
      current.current.onCursor(line.number, position - line.from + 1);
    }
    if (v.state.doc.toString() !== props.file.content) {
      externalChange.current = true;
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: props.file.content } });
      externalChange.current = false;
    }
    if (v.state.doc.toString() !== props.file.content)
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: props.file.content } });
    v.dispatch({
      effects: font.current.reconfigure(
        EditorView.theme({ '&': { fontSize: props.fontSize + 'px' } }),
      ),
    });
  }, [props.file.path, props.file.content, props.fontSize, props.projectId]);
  return <div className="source-editor" ref={host} />;
});
