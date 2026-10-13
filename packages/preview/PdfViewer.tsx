import { useEffect, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  ArrowDownToLine,
  ChevronLeft,
  ChevronRight,
  Moon,
  Sun,
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
    const task = getDocument({
      data: bytes.slice(),
      useSystemFonts: true,
      cMapUrl: new URL('pdfjs/cmaps/', document.baseURI).href,
      cMapPacked: true,
      standardFontDataUrl: new URL('pdfjs/standard_fonts/', document.baseURI).href,
    });
    let disposed = false;
    task.promise
      .then((document) => {
        if (!disposed) {
          setPdf(document);
          setPage(1);
          if (container.current) container.current.scrollTop = 0;
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
  const navigate = (value: number) => {
    const target = Math.max(1, Math.min(pdf?.numPages || 1, value));
    const element = container.current?.querySelector<HTMLElement>(`[data-page="${target}"]`);
    if (element && container.current)
      container.current.scrollTop =
        container.current.scrollTop +
        element.getBoundingClientRect().top -
        container.current.getBoundingClientRect().top -
        20;
    setPage(target);
    setPageInput(String(target));
  };
  useEffect(() => {
    const root = container.current;
    if (!root || !pdf) return;
    let frame = 0;
    const track = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const top = root.getBoundingClientRect().top + Math.min(root.clientHeight * 0.3, 180);
        const pages = [...root.querySelectorAll<HTMLElement>('[data-page]')];
        const containing = pages.find((node) => {
          const rect = node.getBoundingClientRect();
          return rect.top <= top && rect.bottom > top;
        });
        const closest =
          containing ||
          pages.reduce<HTMLElement | null>(
            (best, node) =>
              !best ||
              Math.abs(node.getBoundingClientRect().top - top) <
                Math.abs(best.getBoundingClientRect().top - top)
                ? node
                : best,
            null,
          );
        if (closest) setPage(Number(closest.dataset.page));
      });
    };
    root.addEventListener('scroll', track, { passive: true });
    return () => {
      root.removeEventListener('scroll', track);
      cancelAnimationFrame(frame);
    };
  }, [pdf]);
  const goToPage = () => {
    const value = Number(pageInput);
    const target = Math.max(
      1,
      Math.min(pdf?.numPages || 1, Number.isFinite(value) ? Math.round(value) : page),
    );
    navigate(target);
  };
  return (
    <section className="pdf-pane" aria-label="PDF 预览" data-pdf-dark={dark}>
      <div className="pane-heading pdf-header">
        <span className="pdf-heading-label" title={label}>
          PDF
          {label && (
            <small className="pdf-engine-label" aria-label="PDF 实际编译器">
              {label}
            </small>
          )}
        </span>
        <div className="pdf-controls">
          <button
            className="icon-button"
            aria-label="上一页"
            disabled={!pdf || page <= 1}
            onClick={() => navigate(page - 1)}
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
            onClick={() => navigate(page + 1)}
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
          pdf &&
          Array.from({ length: pdf.numPages }, (_, index) => (
            <PdfPage
              key={index}
              pdf={pdf}
              number={index + 1}
              width={width}
              zoom={zoom}
              root={container}
            />
          ))
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

function PdfPage({
  pdf,
  number,
  width,
  zoom,
  root,
}: {
  pdf: PDFDocumentProxy;
  number: number;
  width: number;
  zoom: number;
  root: React.RefObject<HTMLDivElement | null>;
}) {
  const holder = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null);
  const [near, setNear] = useState(false),
    [ratio, setRatio] = useState(1.414),
    [error, setError] = useState('');
  const pageWidth = Math.max(160, width - 64) * zoom;
  useEffect(() => {
    const observer = new IntersectionObserver((entries) => setNear(entries[0].isIntersecting), {
      root: root.current,
      rootMargin: '800px',
    });
    if (holder.current) observer.observe(holder.current);
    return () => observer.disconnect();
  }, [root, pdf]);
  useEffect(() => {
    let disposed = false;
    void pdf
      .getPage(number)
      .then((page) => {
        if (!disposed) {
          const v = page.getViewport({ scale: 1 });
          setRatio(v.height / v.width);
        }
      })
      .catch((e) => {
        if (!disposed) setError(e.message);
      });
    return () => {
      disposed = true;
    };
  }, [pdf, number]);
  useEffect(() => {
    if (!near) {
      if (canvas.current) {
        canvas.current.width = 0;
        canvas.current.height = 0;
      }
      return;
    }
    let disposed = false,
      task: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | undefined;
    setError('');
    void pdf
      .getPage(number)
      .then(async (page) => {
        if (disposed || !canvas.current) return;
        const viewport = page.getViewport({
          scale: pageWidth / page.getViewport({ scale: 1 }).width,
        });
        const density = Math.min(
          window.devicePixelRatio || 1,
          2,
          Math.sqrt(16_000_000 / (viewport.width * viewport.height)),
        );
        const target = canvas.current;
        target.width = Math.ceil(viewport.width * density);
        target.height = Math.ceil(viewport.height * density);
        task = page.render({ canvas: target, viewport, transform: [density, 0, 0, density, 0, 0] });
        await task.promise;
      })
      .catch((e) => {
        if (!disposed && e.name !== 'RenderingCancelledException') setError(e.message);
      });
    return () => {
      disposed = true;
      task?.cancel();
    };
  }, [pdf, number, pageWidth, near]);
  return (
    <div
      className="pdf-page"
      ref={holder}
      data-page={number}
      style={{ width: pageWidth, height: pageWidth * ratio }}
    >
      <canvas
        ref={canvas}
        aria-label={`PDF 第 ${number} 页`}
        style={{ width: '100%', height: '100%' }}
      />
      {error && (
        <div className="page-error" role="alert">
          第 {number} 页：{error}
        </div>
      )}
      <span className="pdf-page-label">{number}</span>
    </div>
  );
}
