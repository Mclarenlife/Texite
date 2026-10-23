function closePrompt(state) {
  if (state.error)
    return {
      message: '暂时无法确认项目保存和同步状态。',
      detail: '继续退出可能丢失尚未保存或上传的更改。',
    };
  const parts = [];
  if (state.unsaved) parts.push('部分更改尚未写入磁盘。');
  if (state.unsynced > 0) parts.push(`${state.unsynced} 个云端关联项目有本地更改尚未上传。`);
  if (state.syncing) parts.push('WebDAV 同步正在进行。');
  return parts.length
    ? {
        message: parts.join('\n'),
        detail: '可以返回软件完成保存和同步，或确认退出。退出不会自动上传项目。',
      }
    : null;
}
function installCloseGuard(window, { getState, confirm, cleanup, approved, cancelled, failed }) {
  let pending = false,
    allowed = false;
  window.on('close', (event) => {
    if (allowed) return;
    event.preventDefault();
    if (pending) return;
    pending = true;
    void (async () => {
      const state = await getState().catch(() => ({ error: true }));
      const prompt = closePrompt(state);
      if (prompt && !(await confirm(prompt))) {
        cancelled?.();
        return;
      }
      await cleanup();
      allowed = true;
      approved();
    })()
      .catch((e) => {
        cancelled?.();
        failed?.(e);
      })
      .finally(() => {
        pending = false;
      });
  });
  return { isAllowed: () => allowed };
}
module.exports = { closePrompt, installCloseGuard };
