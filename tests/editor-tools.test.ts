import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { CompletionContext } from '@codemirror/autocomplete';
import { latexCompletions } from '../packages/editor/completions';
import { validateInlineChanges, applyAIChanges } from '../packages/core/ai';
import { createProject } from '../packages/core/sample';
function complete(doc: string) {
  return latexCompletions(
    new CompletionContext(EditorState.create({ doc }), doc.length, true),
    ['smith2026'],
    ['main.tex', 'parts/method.tex', 'figures/plot.pdf'],
    ['eq:loss'],
  );
}
test('LaTeX completion uses command, environment, reference and asset contexts', () => {
  assert(complete('\\fr')!.options.some((c) => c.label === '\\frac'));
  assert(complete('\\al')!.options.some((c) => c.label === '\\alpha'));
  assert(complete('\\begin{al')!.options.some((c) => c.label === 'align'));
  assert.deepEqual(
    complete('\\cite{sm')!.options.map((c) => c.label),
    ['smith2026'],
  );
  assert.deepEqual(
    complete('\\eqref{eq')!.options.map((c) => c.label),
    ['eq:loss'],
  );
  assert.deepEqual(
    complete('\\includegraphics{')!.options.map((c) => c.label),
    ['figures/plot.pdf'],
  );
  assert(complete('\\input{')!.options.some((c) => c.label === 'parts/method'));
  assert.equal(complete('% comment \\fr'), null);
  assert.equal(complete('ordinary prose'), null);
});
test('inline edits preserve prefix and suffix and cannot touch other files', () => {
  const project = createProject();
  project.files[0].content = 'Before SAME middle SAME after';
  const before = project.files[0].content;
  const scope = { projectId: project.id, path: 'main.tex', from: 19, to: 23, before };
  const change = { path: 'main.tex', before, after: 'Before SAME middle BETTER after' };
  validateInlineChanges(scope, project, [change]);
  assert.equal(applyAIChanges(project, [change]).files[0].content, change.after);
  assert.throws(
    () =>
      validateInlineChanges(scope, project, [
        { ...change, after: 'Before BETTER middle SAME after' },
      ]),
    /超出选区/,
  );
  assert.throws(
    () => validateInlineChanges(scope, project, [{ ...change, path: 'elsewhere.tex' }]),
    /指定文件/,
  );
  assert.throws(() => validateInlineChanges(scope, project, [change, change]), /指定文件/);
  const cursor = { ...scope, from: 12, to: 12 };
  validateInlineChanges(cursor, project, [
    { ...change, after: before.slice(0, 12) + 'INSERT ' + before.slice(12) },
  ]);
});
