import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ProjectLibrary } from '../apps/desktop/projects.cjs';

test('backup cleanup touches only native sync snapshot files, preserving project sources', async () => {
  const base = await fs.mkdtemp(path.resolve('.qa/cleanup-native-'));
  const library = new ProjectLibrary(base);
  await library.init();
  await fs.mkdir(path.join(base, 'sync-backups'));
  const backup = path.join(base, 'sync-backups', '11111111-1111-4111-8111-111111111111.json');
  await fs.writeFile(backup, '{}');
  await fs.writeFile(path.join(base, 'main.tex'), 'preserved');
  await fs.writeFile(path.join(base, 'sync-backups', 'unrelated.txt'), 'preserved');
  await library.clearSyncBackups();
  await assert.rejects(fs.access(backup));
  assert.equal(await fs.readFile(path.join(base, 'main.tex'), 'utf8'), 'preserved');
  assert.equal(
    await fs.readFile(path.join(base, 'sync-backups', 'unrelated.txt'), 'utf8'),
    'preserved',
  );
});

test('permanent deletion retains files by default, explicitly deletes only a registered independent directory', async () => {
  await fs.mkdir('.qa', { recursive: true });
  const base = await fs.mkdtemp(path.resolve('.qa/permanent-delete-'));
  const library = new ProjectLibrary(path.join(base, 'profile'));
  await library.init();
  const sample = {
    id: 'sample',
    name: 'Delete test',
    revision: 0,
    engine: 'pdflatex',
    mainFile: 'main.tex',
    files: [{ path: 'main.tex', content: 'Keep me' }],
  };
  const retained = await library.import(sample);
  await library.remove(retained.id);
  assert.equal(
    await fs.readFile(path.join(retained.location.directory, 'main.tex'), 'utf8'),
    'Keep me',
  );
  const deleted = await library.import(sample);
  await library.remove(deleted.id, true);
  await assert.rejects(fs.access(deleted.location.directory));
  const restart = new ProjectLibrary(path.join(base, 'profile'));
  await restart.init();
  assert.equal((await restart.list()).length, 0);
  const parent = await library.link(retained.location.directory);
  const childRoot = path.join(retained.location.directory, 'child');
  await fs.mkdir(childRoot);
  await fs.writeFile(path.join(childRoot, 'main.tex'), 'nested');
  const child = await library.link(childRoot);
  await assert.rejects(library.remove(parent.id, true), /其他项目/);
  await assert.rejects(library.remove(child.id, true), /其他项目/);
  await library.remove(child.id, false);
  await assert.rejects(library.remove(parent.id, true, [parent.location.directory]), /系统目录/);
  assert.equal(await fs.readFile(path.join(childRoot, 'main.tex'), 'utf8'), 'nested');
  await assert.rejects(library.remove(parent.id, 'yes'), /无效/);
  await library.remove(parent.id, true);
  await assert.rejects(fs.access(parent.location.directory));
});

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

test('renamed directories retain their ID and conflict baseline across save, reopen and restart', async () => {
  const base = await fs.mkdtemp(path.resolve('.qa/relink-'));
  const profile = path.join(base, 'profile'),
    orig = path.join(base, 'original'),
    moved = path.join(base, 'renamed');
  const lib = new ProjectLibrary(profile);
  await lib.init();
  await fs.mkdir(orig);
  await fs.writeFile(path.join(orig, 'main.tex'), 'before');
  const doc = await lib.link(orig);
  await fs.rename(orig, moved);
  await fs.mkdir(orig);
  await fs.writeFile(path.join(orig, 'main.tex'), 'unrelated');
  doc.files[0].content = 'after';
  assert.equal((await lib.save(doc)).directory, await fs.realpath(moved));
  assert.equal(await fs.readFile(path.join(orig, 'main.tex'), 'utf8'), 'unrelated');
  assert.equal(await fs.readFile(path.join(moved, 'main.tex'), 'utf8'), 'after');
  const newer = path.join(base, 'renamed-again');
  await fs.rename(moved, newer);
  const restart = new ProjectLibrary(profile);
  await restart.init();
  assert.equal((await restart.list())[0].location.directory, await fs.realpath(newer));
  assert.equal((await restart.reopen(doc.id)).files[0].content, 'after');
  assert.equal((await restart.link(newer)).id, doc.id);
});

test('a folder already renamed before upgrading is recovered only from one matching saved project', async () => {
  const base = await fs.mkdtemp(path.resolve('.qa/legacy-relink-')),
    lib = new ProjectLibrary(base);
  await lib.init();
  const doc = {
    id: 'older',
    name: 'Legacy paper',
    engine: 'pdflatex',
    revision: 0,
    mainFile: 'main.tex',
    files: [{ path: 'main.tex', content: 'Legacy manuscript' }],
  };
  const old = (await lib.save(doc)).directory,
    renamed = path.join(path.dirname(old), 'new name'),
    copy = renamed + ' copy';
  const db = path.join(base, 'projects.json'),
    entries = JSON.parse(await fs.readFile(db, 'utf8'));
  delete entries[0].directoryKey;
  await fs.writeFile(db, JSON.stringify(entries));
  await fs.rename(old, renamed);
  await fs.cp(renamed, copy, { recursive: true });
  const reopened = new ProjectLibrary(base);
  await reopened.init();
  await assert.rejects(reopened.save(doc), /找不到原项目/);
  await fs.writeFile(path.join(copy, 'main.tex'), 'Another project');
  assert.equal((await reopened.save(doc)).directory, await fs.realpath(renamed));
});

test('save as copies a conflicted project into a new sibling without overwriting either directory', async () => {
  const base = await fs.mkdtemp(path.resolve('.qa/save-as-'));
  const lib = new ProjectLibrary(path.join(base, 'profile'));
  await lib.init();
  const root = path.join(base, 'paper');
  await fs.mkdir(root);
  await fs.writeFile(path.join(root, 'main.tex'), 'source');
  await fs.writeFile(path.join(root, 'main.bbl'), 'previous bibliography');
  const draft = await lib.link(root);
  draft.files.find((f) => f.path === 'main.tex').content = 'unsaved edit';
  await fs.writeFile(path.join(root, 'main.bbl'), 'external bibliography');
  await assert.rejects(lib.save(draft), /main.bbl/);
  const copy = await lib.import({ ...draft, folders: ['figures/empty'] }, base);
  assert.notEqual(copy.id, draft.id);
  assert.equal(copy.location.kind, 'linked');
  assert.equal(path.basename(copy.location.directory), 'paper (2)');
  assert.equal(
    await fs.readFile(path.join(copy.location.directory, 'main.tex'), 'utf8'),
    'unsaved edit',
  );
  assert.equal(
    await fs.readFile(path.join(copy.location.directory, 'main.bbl'), 'utf8'),
    'previous bibliography',
  );
  assert.ok((await fs.stat(path.join(copy.location.directory, 'figures/empty'))).isDirectory());
  assert.equal(await fs.readFile(path.join(root, 'main.bbl'), 'utf8'), 'external bibliography');
});
