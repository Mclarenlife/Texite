import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { AgentClient } from '../apps/desktop/agent-client.cjs';
import { terminateCLI } from '../apps/desktop/cli-process.cjs';
import { closePrompt, installCloseGuard } from '../apps/desktop/close-guard.cjs';
import { EventEmitter } from 'node:events';
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
test('disconnect terminates the owned CLI and descendant while unrelated CLI remains alive', async () => {
  const unrelated = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
    stdio: 'ignore',
    windowsHide: true,
  });
  const child = spawn(
    process.execPath,
    [
      '-e',
      `const {spawn}=require('node:child_process'); const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}); console.log(c.pid); setInterval(()=>{},1000);`,
    ],
    { detached: process.platform !== 'win32', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
  );
  try {
    const descendant = await new Promise((resolve, reject) => {
      child.stdout.once('data', (d) => resolve(Number(d.toString().trim())));
      child.once('error', reject);
    });
    await terminateCLI(child);
    await pause(100);
    assert.throws(() => process.kill(child.pid, 0));
    assert.throws(() => process.kill(descendant, 0));
    assert.doesNotThrow(() => process.kill(unrelated.pid, 0));
  } finally {
    unrelated.kill();
    if (child.exitCode === null && !child.signalCode) await terminateCLI(child);
  }
});
test('idle timeout persists, protects active turns, and reconnects with a new process', async () => {
  await fs.mkdir('.qa', { recursive: true });
  const directory = await fs.mkdtemp(path.resolve('.qa/idle-cli-'));
  const events = [];
  const client = new AgentClient(directory, (e) => events.push(e));
  await client.configure({
    preset: 'custom',
    protocol: 'acp',
    command: process.execPath,
    args: [path.resolve('tests/fixtures/acp-agent.cjs')],
  });
  await client.setIdleSettings({ idleMinutes: 1 });
  assert.equal((await new AgentClient(directory, () => {}).getIdleSettings()).idleMinutes, 1);
  await assert.rejects(() => client.setIdleSettings({ idleMinutes: -1 }));
  try {
    await client.connect();
    const first = client.client.child.pid;
    // Accelerate the elapsed interval only, retaining the production timer and active-turn checks.
    client.idleMinutes = 0.0005;
    client.armIdle();
    for (
      let i = 0;
      i < 150 && !events.some((e) => e.type === 'connection' && e.reason === 'idle');
      i++
    )
      await pause(10);
    assert(events.some((e) => e.reason === 'idle'));
    assert.throws(() => process.kill(first, 0));
    await client.connect();
    assert.notEqual(client.client.child.pid, first);
    await client.start({
      projectId: 'p',
      runId: 'wait',
      prompt: 'wait',
      context: '{}',
      model: 'test-model',
      readOnly: false,
    });
    await pause(100);
    assert(client.client?.child);
    await client.disconnect();
    assert.equal(client.client, null);
    assert(events.some((e) => e.type === 'done' && e.status === 'interrupted'));
  } finally {
    await client.disconnect();
  }
});
test('close confirmation combines pending upload and unsaved work; cancellation leaves CLI running', async () => {
  assert.equal(closePrompt({ unsaved: false, unsynced: 0, syncing: false }), null);
  assert.match(closePrompt({ unsaved: true, unsynced: 2, syncing: true }).message, /2 个云端/);
  const win = new EventEmitter();
  let cleaned = 0,
    approved = 0,
    answer = false,
    dialogs = 0;
  const guard = installCloseGuard(win, {
    getState: async () => ({ unsaved: false, unsynced: 2, syncing: false }),
    confirm: async () => {
      dialogs++;
      return answer;
    },
    cleanup: async () => {
      cleaned++;
    },
    approved: () => {
      approved++;
    },
  });
  const close = () => win.emit('close', { preventDefault() {} });
  close();
  close();
  await pause(10);
  assert.equal(dialogs, 1);
  assert.equal(cleaned, 0);
  assert.equal(approved, 0);
  answer = true;
  close();
  await pause(10);
  assert.equal(cleaned, 1);
  assert.equal(approved, 1);
  assert(guard.isAllowed());
});
