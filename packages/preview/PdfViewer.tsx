import { useEffect, useRef, useState, type ReactNode } from 'react';
import { getDocument, GlobalWorkerOptions, TextLayer, type PDFDocumentProxy } from 'pdfjs-dist';
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
  LocateFixed,
} from 'lucide-react';
import { download } from '../platform/storage';
import { normalizedText, type PdfLocate } from './sync';
import { createPortal } from 'react-dom';
GlobalWorkerOptions.workerSrc = workerUrl;

export function PdfViewer({
  bytes,
  stale,
  diagnostics,
  diagnosticsOpen = false,
  onDiagnosticsChange,
  diagnosticCount = 0,
  diagnosticSeverity,
  regionLabel = 'PDF 预览',
  downloadName = 'document.pdf',
  locate,
  onLocateSource,
}: {
  bytes: Uint8Array | null;
  stale: boolean;
  diagnostics?: ReactNode;
  diagnosticsOpen?: boolean;
  onDiagnosticsChange?(open: boolean): void;
  diagnosticCount?: number;
  diagnosticSeverity?: 'error' | 'warning';
  regionLabel?: string;
  downloadName?: string;
  locate?: PdfLocate;
  onLocateSource?(point: { page: number; x: number; y: number; text: string }): void;
}) {
  const [highlights, setHighlights] = useState<Record<number, { from: number; to: number }>>({});
  const [selection, setSelection] = useState<{
    left: number;
    top: number;
    page: number;
    x: number;
    y: number;
    text: string;
  } | null>(null);
  useEffect(() => {
    const clear = () => setSelection(null);
    const changed = () =>
      setSelection((current) =>
        current && window.getSelection()?.toString() === current.text ? current : null,
      );
    document.addEventListener('selectionchange', changed);
    window.addEventListener('scroll', clear, true);
    return () => {
      document.removeEventListener('selectionchange', changed);
      window.removeEventListener('scroll', clear, true);
    };
  }, []);
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
    const observer = new ResizeObserver((entries) => {
      if (entries[0].contentRect.width > 0) setWidth(entries[0].contentRect.width);
    });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const root = container.current;
    if (!root) return;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      setZoom((z) => Math.max(0.5, Math.min(3, z + (event.deltaY < 0 ? 0.1 : -0.1))));
    };
    root.addEventListener('wheel', wheel, { passive: false });
    return () => root.removeEventListener('wheel', wheel);
  }, []);
  useEffect(() => {
    setError('');
    setHighlights({});
    setSelection(null);
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
  useEffect(() => {
    if (!pdf || !locate) return;
    let disposed = false;
    void (async () => {
      const texts: string[] = [];
      for (let n = 1; n <= pdf.numPages; n++) {
        const content = await (await pdf.getPage(n)).getTextContent();
        if (disposed) return;
        texts.push(content.items.map((i) => ('str' in i ? normalizedText(i.str) : '')).join(''));
      }
      const needle = normalizedText(locate.text),
        all = texts.join('');
      const offsets = texts.map((_, i) => texts.slice(0, i).reduce((n, t) => n + t.length, 0));
      const expected = offsets[(locate.node?.page || 1) - 1] || 0;
      let best = -1,
        distance = Infinity;
      if (needle)
        for (let at = all.indexOf(needle); at >= 0; at = all.indexOf(needle, at + 1)) {
          const candidatePage = offsets.reduce(
            (page, offset, index) => (offset <= at ? index + 1 : page),
            1,
          );
          const d =
            Math.abs(candidatePage - (locate.node?.page || 1)) * all.length +
            Math.abs(at - expected);
          if (d < distance) {
            best = at;
            distance = d;
          }
        }
      const ranges: Record<number, { from: number; to: number }> = {};
      if (best >= 0)
        texts.forEach((t, i) => {
          const from = Math.max(0, best - offsets[i]),
            to = Math.min(t.length, best + needle.length - offsets[i]);
          if (to > from) ranges[i + 1] = { from, to };
        });
      if (!disposed) {
        setHighlights(ranges);
        navigate(Number(Object.keys(ranges)[0]) || locate.node?.page || 1);
      }
    })().catch(() => {
      if (!disposed && locate.node) navigate(locate.node.page);
    });
    return () => {
      disposed = true;
    };
  }, [pdf, locate]);
  function captureSelection() {
    if (!onLocateSource) return;
    const selected = window.getSelection();
    if (!selected?.rangeCount || selected.isCollapsed) return;
    const range = selected.getRangeAt(0),
      element = range.startContainer.parentElement?.closest<HTMLElement>('.pdf-page');
    if (!element || !container.current?.contains(element)) return;
    const bounds = element.getBoundingClientRect(),
      rect = range.getClientRects()[0];
    if (!rect) return;
    const scale = Number(element.dataset.scale) || 1;
    setSelection({
      left: Math.max(8, Math.min(window.innerWidth - 138, rect.left)),
      top: Math.max(8, Math.min(window.innerHeight - 40, rect.top - 38)),
      page: Number(element.dataset.page),
      x: (rect.left - bounds.left) / scale,
      y: (rect.top + rect.height / 2 - bounds.top) / scale,
      text: selected.toString(),
    });
  }
  const goToPage = () => {
    const value = Number(pageInput);
    const target = Math.max(
      1,
      Math.min(pdf?.numPages || 1, Number.isFinite(value) ? Math.round(value) : page),
    );
    navigate(target);
  };
  return (
    <section className="pdf-pane" aria-label={regionLabel} data-pdf-dark={dark}>
      <div className="pane-heading pdf-header">
        <div
          className="preview-tabs"
          role={diagnostics ? 'tablist' : undefined}
          aria-label="预览功能"
        >
          <button
            type="button"
            role={diagnostics ? 'tab' : undefined}
            aria-selected={diagnostics ? !diagnosticsOpen : undefined}
            className="preview-tab"
            onClick={() => onDiagnosticsChange?.(false)}
            aria-label="PDF"
          >
            <span className="pdf-heading-label">PDF</span>
          </button>
          {diagnostics && (
            <button
              type="button"
              role="tab"
              className="preview-tab"
              aria-selected={diagnosticsOpen}
              onClick={() => onDiagnosticsChange?.(true)}
            >
              编译诊断
              <span
                className={
                  'diagnostic-count' +
                  (diagnosticCount && diagnosticSeverity ? ' diagnostic-' + diagnosticSeverity : '')
                }
              >
                {diagnosticCount}
              </span>
            </button>
          )}
        </div>
        <div className="pdf-controls" hidden={diagnosticsOpen}>
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
              download(new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }), downloadName)
            }
          >
            <ArrowDownToLine size={15} />
          </button>
        </div>
      </div>
      {stale && !diagnosticsOpen && (
        <div className="preview-notice">源码已更新 · 当前保留上次预览</div>
      )}
      <div
        className="pdf-scroll"
        ref={container}
        hidden={diagnosticsOpen}
        onMouseUp={() => setTimeout(captureSelection, 0)}
      >
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
              highlight={highlights[index + 1]}
              locate={locate}
            />
          ))
        ) : (
          <div className="preview-empty">
            <ScanLine size={32} />
            <p>编译后显示 PDF</p>
          </div>
        )}
      </div>
      {selection &&
        !diagnosticsOpen &&
        createPortal(
          <div
            className="pdf-selection-popover"
            style={{ left: selection.left, top: selection.top }}
            onMouseDown={(e) => e.preventDefault()}
          >
            <button
              className="pdf-selection-locate"
              aria-label="定位到源码"
              title="定位到源码"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onLocateSource?.(selection);
                setSelection(null);
              }}
            >
              <LocateFixed size={17} />
            </button>
            <span className="pdf-selection-count" aria-label="选中文字词数">
              {
                [
                  ...new Intl.Segmenter('zh', { granularity: 'word' }).segment(selection.text),
                ].filter((part) => part.isWordLike).length
              }{' '}
              词
            </span>
          </div>,
          document.body,
        )}
      {diagnosticsOpen && diagnostics}
    </section>
  );
}

function PdfPage({
  pdf,
  number,
  width,
  zoom,
  root,
  highlight,
  locate,
}: {
  pdf: PDFDocumentProxy;
  number: number;
  width: number;
  zoom: number;
  root: React.RefObject<HTMLDivElement | null>;
  highlight?: { from: number; to: number };
  locate?: PdfLocate;
}) {
  const textHolder = useRef<HTMLDivElement>(null);
  const [textReady, setTextReady] = useState(0);
  const [rendered, setRendered] = useState(false);
  const [boxes, setBoxes] = useState<
    { left: number; top: number; width: number; height: number }[]
  >([]);
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
    setRendered(false);
    if (!near) {
      if (canvas.current) {
        canvas.current.width = 0;
        canvas.current.height = 0;
      }
      return;
    }
    let layer: TextLayer | undefined;
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
        if (textHolder.current) {
          textHolder.current.replaceChildren();
          textHolder.current.style.setProperty('--total-scale-factor', String(viewport.scale));
          if (holder.current) holder.current.dataset.scale = String(viewport.scale);
          const content = await page.getTextContent();
          if (disposed) return;
          layer = new TextLayer({
            textContentSource: content,
            container: textHolder.current,
            viewport,
          });
          await layer.render();
          if (disposed) return;
          setTextReady((n) => n + 1);
        }
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
        if (!disposed) setRendered(true);
      })
      .catch((e) => {
        if (!disposed && e.name !== 'RenderingCancelledException') setError(e.message);
      });
    return () => {
      disposed = true;
      task?.cancel();
      layer?.cancel();
    };
  }, [pdf, number, pageWidth, near]);
  useEffect(() => {
    const rects: { left: number; top: number; width: number; height: number }[] = [];
    const holderRect = holder.current?.getBoundingClientRect();
    if (!holderRect) return;
    let offset = 0;
    if (highlight)
      for (const span of textHolder.current?.querySelectorAll('span') || []) {
        if (!span.firstChild || span.firstChild.nodeType !== Node.TEXT_NODE) continue;
        const text = span.textContent || '',
          positions: number[] = [];
        for (let i = 0; i < text.length; i++)
          for (const _ of normalizedText(text[i])) positions.push(i);
        const from = Math.max(0, highlight.from - offset),
          to = Math.min(positions.length, highlight.to - offset);
        offset += positions.length;
        if (to <= from) continue;
        const range = document.createRange();
        range.setStart(span.firstChild, positions[from]);
        range.setEnd(span.firstChild, positions[to - 1] + 1);
        for (const r of range.getClientRects())
          rects.push({
            left: r.left - holderRect.left,
            top: r.top - holderRect.top,
            width: r.width,
            height: r.height,
          });
      }
    if (!rects.length && locate?.node?.page === number && !highlight) {
      const n = locate.node,
        scale = Number(holder.current?.dataset.scale) || 1;
      rects.push({
        left: n.x * scale,
        top: n.y * scale,
        width: Math.max(n.width, 12) * scale,
        height: n.height * scale,
      });
    }
    setBoxes(rects);
  }, [highlight, locate, textReady, pageWidth, number]);
  return (
    <div
      className="pdf-page"
      ref={holder}
      data-page={number}
      style={{ width: pageWidth, height: pageWidth * ratio }}
    >
      <canvas
        ref={canvas}
        aria-label={rendered ? `PDF 第 ${number} 页` : `正在渲染 PDF 第 ${number} 页`}
        style={{ width: '100%', height: '100%' }}
      />
      <div className="texite-text-layer" ref={textHolder} />
      <div className="pdf-locate-overlay" aria-hidden="true">
        {boxes.map((b, i) => (
          <div key={i} className="pdf-locate-highlight" style={b} />
        ))}
      </div>
      {error && (
        <div className="page-error" role="alert">
          第 {number} 页：{error}
        </div>
      )}
      <span className="pdf-page-label">{number}</span>
    </div>
  );
}
