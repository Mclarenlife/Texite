import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1'], {
  stdio: 'inherit',
  windowsHide: true,
});
let desktop;
const stop = () => {
  desktop?.kill();
  vite.kill();
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (let attempt = 0; attempt < 80; attempt++) {
  if (vite.exitCode !== null) throw new Error('Vite failed to start');
  try {
    const response = await fetch('http://127.0.0.1:5173');
    if (response.ok) {
      desktop = spawn(require('electron'), ['.'], {
        stdio: 'inherit',
        env: { ...process.env, TEXITE_DEV_URL: 'http://127.0.0.1:5173/' },
        windowsHide: false,
      });
      desktop.on('exit', () => {
        vite.kill();
      });
      break;
    }
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 250));
}
if (!desktop) {
  vite.kill();
  throw new Error('Development server did not start');
}
