// Explicit live integration smoke: uses the locally signed-in Codex account.
// Run manually with `node scripts/smoke-ai.cjs`; never part of the offline test suite.
const { CodexClient } = require('../apps/desktop/codex-client.cjs');
const { Compiler } = require('../apps/desktop/workspace.cjs');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
async function main() {
  await fs.mkdir('.qa', { recursive: true });
  const directory = await fs.mkdtemp(path.resolve('.qa/ai-live-'));
  const compiler = new Compiler(path.resolve('.qa/ai-live-runtime'), path.resolve('runtime'));
  let source = String.raw`\documentclass{ctexart}
\usepackage{amsmath}
\begin{document}
中文离线编译测试。AITESTBEFORE
\[E=mc^2\]
\end{document}`;
  let compiled = false,
    edited = false;
  const calls = [];
  let complete;
  const done = new Promise((resolve) => {
    complete = resolve;
  });
  const client = new CodexClient(path.join(directory, 'client'), (event) => {
    if (event.type === 'text') process.stdout.write(event.delta);
    if (event.type === 'done') complete(event);
    if (event.type !== 'tool') return;
    void (async () => {
      calls.push(event.tool);
      console.log('TOOL', event.tool);
      let value;
      if (event.tool === 'texite_list_files')
        value = { files: [{ path: 'main.tex' }], engine: 'pdflatex' };
      else if (event.tool === 'texite_read_file') value = { path: 'main.tex', content: source };
      else if (event.tool === 'texite_apply_changes') {
        const changes = event.arguments.changes;
        assert.equal(changes.length, 1);
        assert.equal(changes[0].path, 'main.tex');
        assert.equal(changes[0].before, source);
        assert.equal(changes[0].after, source.replace('AITESTBEFORE', 'AITESTAFTER'));
        source = changes[0].after;
        edited = true;
        value = { applied: ['main.tex'] };
      } else if (event.tool === 'texite_compile') {
        const result = await compiler.compile({
          id: 'smoke',
          name: 'AI test',
          revision: 1,
          engine: 'pdflatex',
          mainFile: 'main.tex',
          files: [{ path: 'main.tex', content: source }],
        });
        assert(result.success, result.log);
        compiled = true;
        await fs.writeFile(path.join(directory, 'result.pdf'), Buffer.from(result.pdf));
        value = {
          success: result.success,
          engine: result.engine,
          compiler: result.compilerLabel,
          log: result.log.slice(-4000),
        };
      } else throw new Error('Unexpected tool: ' + event.tool);
      client.reply(event.requestId, { success: true, value });
    })().catch((e) => {
      console.error(e.message);
      client.reply(event.requestId, { success: false, value: { error: e.message } });
    });
  });
  const timer = setTimeout(() => {
    complete({ status: 'timeout' });
    void client.cancel();
  }, 240000);
  try {
    const connection = await client.connect();
    console.log('Connected:', connection.version, 'authenticated:', connection.authenticated);
    assert(connection.authenticated);
    const model = connection.models.find((m) => m.isDefault) || connection.models[0];
    await client.start({
      projectId: 'smoke',
      runId: 'smoke-run',
      model: model.id,
      readOnly: false,
      context: 'Isolated test fixture: main.tex. Engine: pdflatex.',
      prompt:
        'Use texite_read_file to read main.tex, then texite_apply_changes to replace only AITESTBEFORE with AITESTAFTER. Then call texite_compile and report the actual result briefly. Do not use any other tools or edit anything else.',
    });
    const result = await done;
    assert.equal(result.status, 'completed', JSON.stringify(result));
    assert(edited);
    assert(compiled);
    console.log(
      'PASS: actual Codex read → edit → bundled Chinese pdfLaTeX compilation.',
      JSON.stringify(calls),
    );
  } finally {
    clearTimeout(timer);
    await client.disconnect();
    await compiler.cancel();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
