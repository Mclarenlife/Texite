import { useEffect, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  ArrowDownToLine,
  ChevronLeft,
  ChevronRight,
  FileUp,
  Maximize,
  Minus,
  Plus,
  ScanLine,
} from 'lucide-react';
import { download } from '../platform/storage';
GlobalWorkerOptions.workerSrc = workerUrl;

export function PdfViewer({
  bytes,
  label,
  stale,
  onImport,
}: {
  bytes: Uint8Array | null;
  label: string;
  stale: boolean;
  onImport: () => void;
}) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState('');
  const [width, setWidth] = useState(600);
  const canvas = useRef<HTMLCanvasElement>(null);
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver((entries) => setWidth(entries[0].contentRect.width));
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    setError('');
    setPdf(null);
    if (!bytes) return;
    const task = getDocument({ data: bytes.slice(), useSystemFonts: true });
    let disposed = false;
    task.promise
      .then((document) => {
        if (!disposed) {
          setPdf(document);
          setPage((p) => Math.min(p, document.numPages));
        }
      })
      .catch((e) => {
        if (!disposed) setError('无法读取这份 PDF：' + e.message);
      });
    return () => {
      disposed = true;
      void task.destroy();
    };
  }, [bytes]);
  useEffect(() => {
    if (!pdf || !canvas.current) return;
    let cancelled = false;
    let renderTask:
      ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | undefined;
    pdf
      .getPage(page)
      .then((pdfPage) => {
        if (cancelled || !canvas.current) return;
        const natural = pdfPage.getViewport({ scale: 1 });
        const scale = Math.max(0.2, (width - 64) / natural.width) * zoom;
        const viewport = pdfPage.getViewport({ scale });
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        const target = canvas.current;
        target.width = Math.ceil(viewport.width * ratio);
        target.height = Math.ceil(viewport.height * ratio);
        target.style.width = viewport.width + 'px';
        target.style.height = viewport.height + 'px';
        renderTask = pdfPage.render({
          canvas: target,
          viewport,
          transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined,
        });
        return renderTask.promise;
      })
      .catch((e) => {
        if (!cancelled && e.name !== 'RenderingCancelledException')
          setError('页面渲染失败：' + e.message);
      });
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [pdf, page, zoom, width]);
  return (
    <section className="pdf-pane" aria-label="PDF 预览">
      <div className="pane-heading">
        <div>
          <ScanLine size={15} />
          <span>排版预览</span>
          <span className="small-label">{label}</span>
        </div>
        <button className="icon-button" title="导入 PDF" aria-label="导入 PDF" onClick={onImport}>
          <FileUp size={16} />
        </button>
      </div>
      <div className="pdf-toolbar">
        <div className="inline-tools">
          <button aria-label="缩小 PDF" onClick={() => setZoom((z) => Math.max(0.5, z - 0.1))}>
            <Minus size={14} />
          </button>
          <span>{Math.round(zoom * 100)}%</span>
          <button aria-label="放大 PDF" onClick={() => setZoom((z) => Math.min(2, z + 0.1))}>
            <Plus size={14} />
          </button>
          <button aria-label="适合宽度" onClick={() => setZoom(1)}>
            <Maximize size={14} />
          </button>
        </div>
        <button
          className="subtle-button"
          disabled={!bytes}
          onClick={() =>
            bytes &&
            download(new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }), 'document.pdf')
          }
        >
          <ArrowDownToLine size={14} />
          <span>导出</span>
        </button>
      </div>
      {stale && <div className="preview-notice">源码已更新 · 当前保留上次预览</div>}
      <div className="pdf-scroll" ref={container}>
        {error ? (
          <div className="empty-state" role="alert">
            <p>{error}</p>
            <button onClick={onImport}>选择另一份 PDF</button>
          </div>
        ) : bytes ? (
          <canvas ref={canvas} aria-label={`PDF 第 ${page} 页`} />
        ) : (
          <div className="preview-empty">
            <div className="empty-paper">
              <div className="paper-monogram">t.</div>
              <h2>
                让想法
                <br />
                落在纸上。
              </h2>
              <p>
                完成一次编译，
                <br />
                在这里看见你的文稿。
              </p>
              <div className="paper-lines">
                <i />
                <i />
                <i />
              </div>
            </div>
            <button className="subtle-button" onClick={onImport}>
              <FileUp size={15} />
              导入已有 PDF
            </button>
          </div>
        )}
      </div>
      <div className="pdf-pagination">
        <button
          className="icon-button"
          aria-label="上一页"
          disabled={!pdf || page <= 1}
          onClick={() => setPage((p) => p - 1)}
        >
          <ChevronLeft size={15} />
        </button>
        <span>{pdf ? `${page} / ${pdf.numPages}` : '尚未编译'}</span>
        <button
          className="icon-button"
          aria-label="下一页"
          disabled={!pdf || page >= pdf.numPages}
          onClick={() => setPage((p) => p + 1)}
        >
          <ChevronRight size={15} />
        </button>
      </div>
    </section>
  );
}
