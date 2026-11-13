import { spawnSync } from 'node:child_process';
import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const env = { ...process.env };
delete env.TEXITE_DEV_URL; // Exercise this build even when a dev server is running.
const executable = env.TEXITE_TEST_EXECUTABLE;
if (executable) {
  env.TEXITE_TEST_EXECUTABLE = path.resolve(executable);
  if (!statSync(env.TEXITE_TEST_EXECUTABLE).isFile())
    throw new Error('Expected a desktop executable');
}
// Only deterministic scenarios: the manual live-account smoke is intentionally excluded.
const scenarios = [
  'compile-mechanisms',
  'navigation-desktop',
  'sync-desktop',
  'project-actions-desktop',
  'cleanup-desktop',
  'agent-workspace',
  'ai-history-desktop',
  'api-agent-desktop',
];
const parent = path.join(root, '.qa', 'desktop-reports');
mkdirSync(parent, { recursive: true });
const report = mkdtempSync(path.join(parent, 'run-'));
const results = [];
console.log('Desktop regression logs:', report);
for (const name of scenarios) {
  const args = ['scripts/smoke-' + name + '.cjs'];
  if (name === 'compile-mechanisms' && !executable) args.push('--source');
  const log = path.join(report, name + '.log');
  const fd = openSync(log, 'w');
  const start = Date.now();
  console.log('Running:', name);
  let run;
  try {
    run = spawnSync(process.execPath, args, { cwd: root, env, stdio: ['ignore', fd, fd] });
  } finally {
    closeSync(fd);
  }
  const passed = !run.error && run.status === 0;
  results.push({
    name,
    passed,
    seconds: Math.round((Date.now() - start) / 1000),
    log: path.basename(log),
  });
  console.log(passed ? 'PASS' : 'FAIL', name);
  if (!passed) console.error(run.error ?? run.signal ?? '', readFileSync(log, 'utf8').slice(-5000));
  writeFileSync(
    path.join(report, 'results.json'),
    JSON.stringify({ mode: executable ? 'packaged' : 'source', results }, null, 2),
  );
}
process.exitCode = results.every((r) => r.passed) ? 0 : 1;
