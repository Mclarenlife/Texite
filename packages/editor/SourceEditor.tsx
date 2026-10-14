import {
  forwardRef,
  useEffect,
  useLayoutEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { StreamLanguage, syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { stex } from '@codemirror/legacy-modes/mode/stex';
import { autocompletion, type CompletionContext } from '@codemirror/autocomplete';
import {
  indentWithTab,
  isolateHistory,
  undo,
  redo,
  undoDepth,
  redoDepth,
} from '@codemirror/commands';
import { openSearchPanel } from '@codemirror/search';
import { tags } from '@lezer/highlight';
import type { ProjectFile } from '../core/model';
import type { InlineScope } from '../core/ai';
import { latexCompletions } from './completions';
import { EditorTools, type EditorAnchor } from './EditorTools';
import './editor-tools.css';
import { localizedSearch } from './searchPanel';

export type EditorHandle = {
  jump: (position: number, end?: number) => void;
  undo: () => void;
  redo: () => void;
  search: () => void;
  insert: (text: string) => void;
  focus: () => void;
  selection: () => string;
};
type Props = {
  readOnly?: boolean;
  projectId: string;
  file: ProjectFile;
  fontSize: number;
  references: string[];
  files?: string[];
  labels?: string[];
  aiBusy?: boolean;
  onAI?(prompt: string, scope: InlineScope): void;
  onLocate?(scope: InlineScope): void;
  onImportImage?(file: File): Promise<string>;
  onChange: (content: string, path: string) => void;
  onCursor: (line: number, column: number, reference?: string) => void;
  onCompile: () => void;
  onSave: () => void;
  onHistoryState?(undo: boolean, redo: boolean): void;
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
  const [anchor, setAnchor] = useState<EditorAnchor | null>(null);
  const [toolError, setToolError] = useState('');
  const view = useRef<EditorView | null>(null);
  const current = useRef(props);
  current.current = props;
  const states = useRef(new Map<string, EditorState>());
  const active = useRef('');
  const externalChange = useRef(false);
  const font = useRef(new Compartment());
  const editable = useRef(new Compartment());
  const factory = useRef<((content: string) => EditorState) | null>(null);
  useImperativeHandle(
    ref,
    () => ({
      jump(position, end) {
        const v = view.current;
        if (!v) return;
        const pos = Math.max(0, Math.min(position, v.state.doc.length));
        v.dispatch({
          selection: {
            anchor: pos,
            head: end === undefined ? pos : Math.max(pos, Math.min(end, v.state.doc.length)),
          },
          effects: EditorView.scrollIntoView(pos, { y: 'center' }),
        });
        v.focus();
      },
      undo() {
        if (view.current && !current.current.readOnly) {
          undo(view.current);
          view.current.focus();
        }
      },
      redo() {
        if (view.current && !current.current.readOnly) {
          redo(view.current);
          view.current.focus();
        }
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
      selection() {
        const v = view.current;
        return v ? v.state.sliceDoc(v.state.selection.main.from, v.state.selection.main.to) : '';
      },
    }),
    [],
  );
  useEffect(() => {
    active.current = '';
    const completion = (ctx: CompletionContext) =>
      latexCompletions(
        ctx,
        current.current.references,
        current.current.files || [],
        current.current.labels || [],
      );
    const openTools = (v: EditorView, menu: boolean, x?: number, y?: number) => {
      if (current.current.readOnly) return;
      const { from, to, head } = v.state.selection.main;
      const coords = v.coordsAtPos(head);
      if (!coords) return;
      setAnchor({
        x: x ?? coords.left,
        y: y ?? coords.bottom,
        menu,
        scope: {
          projectId: current.current.projectId,
          path: current.current.file.path,
          from,
          to,
          before: v.state.doc.toString(),
        },
      });
    };
    const extensions = [
      basicSetup,
      localizedSearch,
      EditorView.domEventHandlers({
        mouseup(event, v) {
          if (event.button === 0)
            requestAnimationFrame(() => {
              if (view.current === v && v.hasFocus) openTools(v, false);
            });
        },
        contextmenu(event, v) {
          event.preventDefault();
          const pos = v.posAtCoords({ x: event.clientX, y: event.clientY });
          const sel = v.state.selection.main;
          if (pos !== null && (pos < sel.from || pos > sel.to || sel.empty))
            v.dispatch({ selection: { anchor: pos } });
          openTools(v, true, event.clientX, event.clientY);
          return true;
        },
        scroll() {
          setAnchor(null);
        },
      }),
      editable.current.of(EditorState.readOnly.of(!!current.current.readOnly)),
      StreamLanguage.define(stex),
      syntaxHighlighting(highlighting),
      EditorView.lineWrapping,
      autocompletion({
        override: [completion],
        icons: false,
        optionClass: () => 'texite-completion',
        maxRenderedOptions: 30,
        closeOnBlur: true,
      }),
      keymap.of([
        indentWithTab,
        {
          key: 'Alt-Enter',
          run: (v) => {
            openTools(v, false);
            return true;
          },
        },
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
        current.current.onHistoryState?.(undoDepth(update.state) > 0, redoDepth(update.state) > 0);
        if (update.docChanged) setAnchor(null);
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
    active.current = JSON.stringify([current.current.projectId, current.current.file.path]);
    // Keep one view and retain per-file selection and undo history.
    return () => {
      view.current?.destroy();
      view.current = null;
    };
  }, []);
  useEffect(() => {
    view.current?.dispatch({
      effects: editable.current.reconfigure(EditorState.readOnly.of(!!props.readOnly)),
    });
  }, [props.readOnly]);
  useLayoutEffect(() => {
    const v = view.current;
    if (!v) return;
    const key = JSON.stringify([props.projectId, props.file.path]);
    if (active.current !== key) {
      setAnchor(null);
      states.current.set(active.current, v.state);
      const cached = states.current.get(key);
      v.setState(cached ?? factory.current!(props.file.content));
      active.current = key;
      if (states.current.size > 50) states.current.delete(states.current.keys().next().value!);
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
      effects: [
        editable.current.reconfigure(EditorState.readOnly.of(!!current.current.readOnly)),
        font.current.reconfigure(EditorView.theme({ '&': { fontSize: props.fontSize + 'px' } })),
      ],
    });
  }, [props.file.path, props.file.content, props.fontSize, props.projectId]);
  function insert(text: string, packages: string[] = []) {
    const v = view.current;
    if (!v || !anchor) return;
    if (
      current.current.readOnly ||
      anchor.scope.path !== current.current.file.path ||
      v.state.doc.toString() !== anchor.scope.before
    ) {
      setToolError('文稿已变化，请重新选择插入位置。');
      setAnchor(null);
      return;
    }
    const changes = [{ from: anchor.scope.from, to: anchor.scope.to, insert: text }];
    const missing = packages.filter(
      (name) =>
        !new RegExp('\\\\usepackage(?:\\[[^\\]]*\\])?\\{[^}]*\\b' + name + '\\b').test(
          anchor.scope.before,
        ),
    );
    if (missing.length) {
      const preamble = anchor.scope.before.indexOf('\\begin{document}');
      if (preamble >= 0 && !(anchor.scope.from <= preamble && anchor.scope.to > preamble))
        changes.push({
          from: preamble,
          to: preamble,
          insert: `\\usepackage{${missing.join(',')}}\n`,
        });
      else setToolError(`代码已插入，请在主文件导言区加载 ${missing.join('、')} 宏包。`);
    }
    v.dispatch({ changes, annotations: isolateHistory.of('full') });
    v.focus();
    setAnchor(null);
  }
  return (
    <>
      <div className="source-editor" ref={host} />
      {toolError && (
        <button className="editor-tool-error" role="alert" onClick={() => setToolError('')}>
          {toolError} ×
        </button>
      )}
      {anchor && (
        <EditorTools
          key={
            anchor.scope.path + ':' + anchor.scope.from + ':' + anchor.scope.to + ':' + anchor.menu
          }
          anchor={anchor}
          onLocate={props.onLocate}
          onClose={() => setAnchor(null)}
          onInsert={insert}
          onAI={(prompt, scope) => current.current.onAI?.(prompt, scope)}
          busy={!!props.aiBusy}
          images={(props.files || []).filter((f) => /\.(png|jpe?g|pdf)$/i.test(f))}
          references={props.references}
          labels={props.labels || []}
          onImportImage={props.onImportImage}
        />
      )}
    </>
  );
});
