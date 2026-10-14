import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import workspace from '../apps/desktop/workspace.cjs';
const { safeRelative, readDirectory, saveDirectory, buildArguments, validateSnapshot } = workspace;
const project = {
  id: 'test',
  name: 'Test',
  engine: 'pdflatex',
  mainFile: 'main.tex',
  revision: 0,
  files: [{ path: 'main.tex', content: 'Hello' }],
};

test('confirmed nested deletion checks external changes before writes and removes only verified files and empty directories', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'texite-test-'));
  const binary = {
    path: 'notes/child/asset.bin',
    content: Buffer.from([0, 255, 128]).toString('base64'),
    binary: true,
  };
  const original = {
    ...project,
    folders: ['notes', 'notes/child', 'notes/empty'],
    files: [...project.files, binary],
  };
  const removedFolders = original.folders;
  const removals = [{ ...binary, expected: binary.content }];
  try {
    const hashes = await saveDirectory(root, original);
    await fs.writeFile(path.join(root, 'notes', 'external.txt'), 'External');
    await assert.rejects(
      saveDirectory(root, project, hashes, removals, true, removedFolders),
      /外部新增/,
    );
    assert.equal(
      (await fs.readFile(path.join(root, binary.path))).toString('base64'),
      binary.content,
    );
    await fs.unlink(path.join(root, 'notes', 'external.txt'));
    await fs.writeFile(path.join(root, binary.path), 'Changed');
    await assert.rejects(
      saveDirectory(root, project, hashes, removals, true, removedFolders),
      /外部修改/,
    );
    await fs.writeFile(path.join(root, binary.path), Buffer.from(binary.content, 'base64'));
    await saveDirectory(root, project, hashes, removals, true, removedFolders);
    await assert.rejects(fs.stat(path.join(root, 'notes')), { code: 'ENOENT' });
    assert.equal(await fs.readFile(path.join(root, 'main.tex'), 'utf8'), 'Hello');
    await saveDirectory(
      root,
      { ...project, files: [], mainFile: '' },
      hashes,
      [{ path: 'main.tex', expected: 'Hello' }],
      true,
    );
    assert.equal((await readDirectory(root)).files.length, 0);
    await assert.rejects(saveDirectory(root, project, hashes, [], true, ['../outside']), /Invalid/);
  } finally {
    assert(path.basename(root).startsWith('texite-test-'));
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('native IPC validation prevents unsafe file names and engine injection', () => {
  for (const name of [
    '../secret',
    'C:/secret',
    '.git/config',
    'nul.tex',
    'x/../y',
    'foo:bar',
    'x.',
  ])
    assert.throws(() => safeRelative(name));
  assert.throws(() => validateSnapshot({ ...project, engine: 'pdflatex & whoami' }));
  const args = buildArguments({ ...project, mainFile: 'chapters/my paper.tex' });
  assert(args.includes('-norc'));
  assert(args.includes('-no-shell-escape'));
  assert.equal(args.at(-1), './chapters/my paper.tex');
});
test('atomic save preserves binary data and refuses conflicting external edits', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'texite-test-'));
  try {
    const files = [
      ...project.files,
      {
        path: 'figures/image.png',
        binary: true,
        content: Buffer.from([0, 1, 255, 3]).toString('base64'),
      },
    ];
    await saveDirectory(root, { ...project, files });
    const opened = await readDirectory(root);
    assert.equal(
      opened.files.find((f) => f.path === 'figures/image.png').content,
      files[1].content,
    );
    await fs.writeFile(path.join(root, 'main.tex'), 'External change');
    await assert.rejects(saveDirectory(root, { ...project, files }, opened.hashes), /外部修改/);
    assert.equal(await fs.readFile(path.join(root, 'main.tex'), 'utf8'), 'External change');
  } finally {
    assert(path.basename(root).startsWith('texite-test-'));
    await fs.rm(root, { recursive: true, force: true });
  }
});
