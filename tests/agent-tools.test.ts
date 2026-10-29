import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../packages/core/sample';
import { readAgentLines, searchAgentProject, agentPatch } from '../packages/core/agent-tools';
import { applyAIChanges, undoAITask, validateInlineChanges } from '../packages/core/ai';

test('line reads preserve CRLF/Unicode offsets and search is literal, scoped and bounded', () => {
  const p = createProject();
  p.files = [
    { path: 'main.tex', content: '标题\r\n苹果🍎\r\n[a+b]\r\n' },
    { path: 'refs.bib', content: 'APPLE\n'.repeat(50) },
  ];
  const result = readAgentLines(p, { path: 'main.tex', startLine: 2, endLine: 2 });
  assert.equal(result.startOffset, 4);
  assert.equal(result.lines[0].text, '苹果🍎\r');
  assert.equal(
    searchAgentProject(p, { query: '[a+b]', paths: [], caseSensitive: true }).matches.length,
    1,
  );
  assert.equal(
    searchAgentProject(p, { query: 'apple', paths: ['main.tex'], caseSensitive: false }).matches
      .length,
    0,
  );
  assert.equal(
    searchAgentProject(p, { query: 'apple', paths: [], caseSensitive: false }).truncated,
    true,
  );
  assert.throws(() => readAgentLines(p, { path: '../secret', startLine: 1, endLine: 3 }));
  assert.throws(() => readAgentLines(p, { path: 'main.tex', startLine: 1, endLine: 201 }));
});
test('local patches reject stale revisions and ambiguous matches; edits retain selection protections and undo', () => {
  const p = createProject();
  p.files = [{ path: 'main.tex', content: '苹果 和 苹果' }];
  const args = { path: 'main.tex', revision: p.revision, oldText: '苹果', newText: 'apple' };
  assert.throws(() => agentPatch(p, args), /重复/);
  assert.throws(() => agentPatch(p, { ...args, start: 0, revision: p.revision + 1 }), /变化/);
  assert.throws(() => agentPatch(p, { ...args, start: 1 }), /原文/);
  const changes = agentPatch(p, { ...args, start: 0 });
  const scope = { projectId: p.id, path: 'main.tex', from: 0, to: 2, before: p.files[0].content };
  validateInlineChanges(scope, p, changes);
  assert.throws(
    () => validateInlineChanges(scope, p, agentPatch(p, { ...args, start: 5 })),
    /选区/,
  );
  const edited = applyAIChanges(p, changes);
  assert.equal(edited.files[0].content, 'apple 和 苹果');
  assert.equal(
    undoAITask(edited, {
      id: 'test',
      prompt: '',
      reply: '',
      time: 1,
      status: 'completed',
      changes,
      activities: [],
    }).files[0].content,
    p.files[0].content,
  );
  assert.equal(
    agentPatch(p, { ...args, oldText: '', newText: '新', start: 0 })[0].after,
    '新苹果 和 苹果',
  );
});
