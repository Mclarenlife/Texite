const { execFile } = require('node:child_process');
// Only terminate the process tree started by this Texite adapter, never other CLI sessions.
async function terminateCLI(child) {
  if (!child) return;
  if (!child.pid) {
    child.kill?.();
    return;
  }
  const pid = child.pid;
  if (process.platform === 'win32') {
    await new Promise((resolve, reject) => {
      execFile(
        'taskkill.exe',
        ['/PID', String(pid), '/T', '/F'],
        { windowsHide: true, timeout: 10000 },
        (error) => {
          if (!error || child.exitCode !== null || child.signalCode) resolve();
          else reject(new Error('未能关闭 CLI 进程树，请重试断开连接。'));
        },
      );
    });
    return;
  }
  const signal = (name) => {
    try {
      process.kill(-pid, name);
    } catch (e) {
      if (e.code !== 'ESRCH') throw e;
    }
  };
  signal('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 200));
  // Children may outlive their parent; terminate the whole dedicated process group.
  signal('SIGKILL');
}
module.exports = { terminateCLI };
