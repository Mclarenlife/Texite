import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ProjectLibrary } from '../apps/desktop/projects.cjs';

test('managed directories use safe project names, preserve collisions and survive restart', async () => {
  await fs.mkdir('.qa', { recursive: true });
  const base = await fs.mkdtemp(path.resolve('.qa/named-projects-'));
  const library = new ProjectLibrary(base);
  await library.init();
  const sample = {
    id: 'local',
    name: '我的论文',
    revision: 0,
    engine: 'pdflatex',
    mainFile: 'main.tex',
    files: [{ path: 'main.tex', content: 'original' }],
  };
  const first = await library.save(sample);
  assert.equal(path.basename(first.directory), '我的论文');
  const second = await library.import(sample);
  assert.equal(path.basename(second.location.directory), '我的论文 (2)');
  await library.rename(sample.id, '显示名称');
  assert.equal((await library.reopen(sample.id)).location.directory, first.directory);
  for (const name of ['../unsafe/name', 'CON', '.', 'bad:name?']) {
    const imported = await library.import({ ...sample, name });
    assert.equal(path.dirname(imported.location.directory), library.projectsRoot);
    assert(!/[<>:"/\\|?*]/.test(path.basename(imported.location.directory)));
  }
  const moved = await library.relocate({ ...sample, name: '迁移后的论文' });
  assert.equal(path.basename(moved.location.directory), '迁移后的论文');
  assert.equal(await fs.readFile(path.join(first.directory, 'main.tex'), 'utf8'), 'original');
  const restart = new ProjectLibrary(base);
  await restart.init();
  assert.equal((await restart.reopen(sample.id)).location.directory, moved.location.directory);
});

test('renaming a linked project persists its display name without changing the directory or sources', async () => {
  await fs.mkdir('.qa', { recursive: true });
  const base = await fs.mkdtemp(path.resolve('.qa/project-rename-'));
  const root = path.join(base, 'original-folder');
  await fs.mkdir(root);
  await fs.writeFile(path.join(root, 'main.tex'), 'untouched');
  const library = new ProjectLibrary(path.join(base, 'profile'));
  await library.init();
  const project = await library.link(root);
  await library.rename(project.id, '新的项目名称');
  const reopened = new ProjectLibrary(path.join(base, 'profile'));
  await reopened.init();
  assert.equal((await reopened.reopen(project.id)).name, '新的项目名称');
  assert.equal((await reopened.link(root)).name, '新的项目名称');
  assert.equal((await reopened.list())[0].location.directory, await fs.realpath(root));
  assert.equal(await fs.readFile(path.join(root, 'main.tex'), 'utf8'), 'untouched');
  await assert.rejects(reopened.rename(project.id, ' '), /项目名称/);
});

test('AI undo deletes only unchanged created text files and protects external edits', async () => {
  await fs.mkdir('.qa', { recursive: true });
  const base = await fs.mkdtemp(path.resolve('.qa/ai-library-test-'));
  const root = path.join(base, 'linked');
  await fs.mkdir(root);
  await fs.writeFile(path.join(root, 'main.tex'), 'original');
  const library = new ProjectLibrary(path.join(base, 'app'));
  await library.init();
  const project = await library.link(root);
  const edited = {
    ...project,
    files: [
      { path: 'main.tex', content: 'edited' },
      { path: 'created.tex', content: 'AI content' },
    ],
  };
  await library.save(edited);
  await fs.writeFile(path.join(root, 'created.tex'), 'external work');
  await assert.rejects(
    library.save(project, [{ path: 'created.tex', expected: 'AI content' }]),
    /外部修改/,
  );
  assert.equal(await fs.readFile(path.join(root, 'main.tex'), 'utf8'), 'edited');
  await fs.writeFile(path.join(root, 'created.tex'), 'AI content');
  await library.save(project, [{ path: 'created.tex', expected: 'AI content' }]);
  await assert.rejects(fs.access(path.join(root, 'created.tex')));
  assert.equal(await fs.readFile(path.join(root, 'main.tex'), 'utf8'), 'original');
});
test('folder bindings, managed imports, empty directories and conflict baselines survive restart', async () => {
  await fs.mkdir('.qa', { recursive: true });
  const base = await fs.mkdtemp(path.resolve('.qa/library-test-'));
  const linkedRoot = path.join(base, 'linked');
  await fs.mkdir(linkedRoot);
  await fs.writeFile(path.join(linkedRoot, 'main.tex'), 'Disk source');
  const first = new ProjectLibrary(path.join(base, 'app'));
  await first.init();
  const linked = await first.link(linkedRoot);
  assert.equal(linked.location.kind, 'linked');
  const imported = await first.import({ ...linked, folders: ['assets/empty'] });
  assert.equal(imported.location.kind, 'managed');
  assert(imported.location.directory.startsWith(path.join(base, 'app', 'projects')));
  assert((await fs.stat(path.join(imported.location.directory, 'assets/empty'))).isDirectory());
  await first.save({ ...linked, files: [{ path: 'main.tex', content: 'Saved source' }] });
  const next = new ProjectLibrary(path.join(base, 'app'));
  await next.init();
  assert.equal((await next.list()).length, 2);
  assert.equal((await next.reopen(linked.id)).files[0].content, 'Saved source');
  await fs.writeFile(path.join(linkedRoot, 'main.tex'), 'External change');
  await assert.rejects(next.save(linked), /外部修改/);
  assert.equal((await next.reopen(linked.id)).files[0].content, 'External change');
  assert.equal((await next.link(linkedRoot)).id, linked.id);
});
