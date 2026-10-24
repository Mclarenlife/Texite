import type { Project } from '../../packages/core/model';

export type MobileCompileResult = {
  pdf: Uint8Array | null;
  log: string;
  revision: number;
  success: boolean;
};
export function compileOffline(
  project: Project,
  signal: AbortSignal,
  onStatus: (value: string) => void,
): Promise<MobileCompileResult> {
  if (project.engine !== 'pdflatex')
    return Promise.reject(
      new Error('移动版目前仅提供 pdfLaTeX，请在项目设置中选择 pdfLaTeX。不会自动切换引擎。'),
    );
  return new Promise((resolve, reject) => {
    const worker = new Worker('/android-tex/worker.js');
    let settled = false;
    const finish = (error?: Error, result?: MobileCompileResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      worker.terminate();
      if (error) reject(error);
      else resolve(result!);
    };
    const cancel = () => finish(new Error('编译已取消'));
    const timer = setTimeout(
      () => finish(new Error('编译超过 120 秒，已停止。请检查文稿或缩小项目。')),
      120_000,
    );
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) {
      cancel();
      return;
    }
    worker.onerror = (e) => finish(new Error(e.message || '离线编译器启动失败'));
    worker.onmessage = ({ data }) => {
      if (data.status) onStatus(data.status);
      if (data.error) finish(new Error(data.error));
      if (data.result)
        finish(undefined, {
          ...data.result,
          pdf: data.result.pdf?.length ? new Uint8Array(data.result.pdf) : null,
          revision: project.revision,
        });
    };
    worker.postMessage({ project: { mainFile: project.mainFile, files: project.files } });
  });
}
