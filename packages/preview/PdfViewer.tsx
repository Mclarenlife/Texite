import { useEffect, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  ArrowDownToLine,
  ChevronLeft,
  ChevronRight,
  Moon,
  Sun,
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
}: {
  bytes: Uint8Array | null;
  label: string;
  stale: boolean;
}) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [dark, setDark] = useState(false);
  const [pageInput, setPageInput] = useState('1');
  useEffect(() => setPageInput(String(page)), [page]);
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
  const goToPage = () => {
    const value = Number(pageInput);
    const target = Math.max(
      1,
      Math.min(pdf?.numPages || 1, Number.isFinite(value) ? Math.round(value) : page),
    );
    setPage(target);
    setPageInput(String(target));
  };
  return (
    <section className="pdf-pane" aria-label="PDF 预览" data-pdf-dark={dark}>
      <div className="pane-heading pdf-header">
        <span className="pdf-heading-label" title={label}>
          PDF
        </span>
        <div className="pdf-controls">
          <button
            className="icon-button"
            aria-label="上一页"
            disabled={!pdf || page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            <ChevronLeft size={15} />
          </button>
          <input
            className="page-input"
            aria-label="PDF 页码"
            inputMode="numeric"
            disabled={!pdf}
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value)}
            onBlur={goToPage}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                goToPage();
                e.currentTarget.blur();
              }
            }}
          />
          <span className="page-count" aria-label="PDF 总页数">
            / {pdf?.numPages || 0}
          </span>
          <button
            className="icon-button"
            aria-label="下一页"
            disabled={!pdf || page >= pdf.numPages}
            onClick={() => setPage((p) => p + 1)}
          >
            <ChevronRight size={15} />
          </button>
          <span className="tool-divider" />
          <button
            className="icon-button"
            aria-label="缩小 PDF"
            disabled={zoom <= 0.5}
            onClick={() => setZoom((z) => Math.max(0.5, z - 0.1))}
          >
            <Minus size={14} />
          </button>
          <button
            className="zoom-value"
            title="适合宽度"
            aria-label="适合宽度"
            onClick={() => setZoom(1)}
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            className="icon-button"
            aria-label="放大 PDF"
            disabled={zoom >= 3}
            onClick={() => setZoom((z) => Math.min(3, z + 0.1))}
          >
            <Plus size={14} />
          </button>
          <span className="tool-divider" />
          <button
            className="icon-button"
            aria-label="PDF 暗色模式"
            title="PDF 暗色模式"
            aria-pressed={dark}
            onClick={() => setDark((v) => !v)}
          >
            {dark ? <Sun size={15} /> : <Moon size={15} />}
          </button>
          <button
            className="icon-button"
            aria-label="导出 PDF"
            title="导出 PDF"
            disabled={!bytes}
            onClick={() =>
              bytes &&
              download(
                new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }),
                'document.pdf',
              )
            }
          >
            <ArrowDownToLine size={15} />
          </button>
        </div>
      </div>
      {stale && <div className="preview-notice">源码已更新 · 当前保留上次预览</div>}
      <div className="pdf-scroll" ref={container}>
        {error ? (
          <div className="empty-state" role="alert">
            <p>{error}</p>
          </div>
        ) : bytes ? (
          <canvas ref={canvas} aria-label={`PDF 第 ${page} 页`} />
        ) : (
          <div className="preview-empty">
            <ScanLine size={32} />
            <p>编译后显示 PDF</p>
          </div>
        )}
      </div>
    </section>
  );
}
