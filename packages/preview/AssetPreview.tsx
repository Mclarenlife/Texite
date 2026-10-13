import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, FileQuestion, Minus, Plus } from 'lucide-react';
import type { ProjectFile } from '../core/model';
import { download } from '../platform/storage';
import { PdfViewer } from './PdfViewer';

const imageTypes: Record<string, string> = {
  png: 'png',
  apng: 'apng',
  jpg: 'jpeg',
  jpeg: 'jpeg',
  gif: 'gif',
  webp: 'webp',
  avif: 'avif',
  bmp: 'bmp',
  svg: 'svg+xml',
  ico: 'x-icon',
};
export function AssetPreview({ file }: { file: ProjectFile }) {
  const bytes = useMemo(
    () => Uint8Array.from(atob(file.content), (c) => c.charCodeAt(0)),
    [file.content],
  );
  const ext = file.path.split('.').pop()!.toLowerCase();
  const [url, setUrl] = useState(''),
    [zoom, setZoom] = useState(1),
    [error, setError] = useState(false);
  const [size, setSize] = useState({ width: 0, height: 0 }),
    [frame, setFrame] = useState({ width: 600, height: 600 });
  const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const url = URL.createObjectURL(
      new Blob([bytes], {
        type: imageTypes[ext] ? 'image/' + imageTypes[ext] : 'application/octet-stream',
      }),
    );
    setUrl(url);
    setError(false);
    setZoom(1);
    return () => URL.revokeObjectURL(url);
  }, [bytes, ext]);
  useEffect(() => {
    const root = scroll.current;
    if (!root) return;
    const observer = new ResizeObserver(([entry]) =>
      setFrame({ width: entry.contentRect.width, height: entry.contentRect.height }),
    );
    observer.observe(root);
    const wheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        setZoom((z) => Math.max(0.1, Math.min(5, z + (e.deltaY < 0 ? 0.1 : -0.1))));
      }
    };
    root.addEventListener('wheel', wheel, { passive: false });
    return () => {
      observer.disconnect();
      root.removeEventListener('wheel', wheel);
    };
  }, []);
  if (ext === 'pdf')
    return (
      <PdfViewer
        bytes={bytes}
        stale={false}
        regionLabel="项目 PDF 预览"
        downloadName={file.path.split('/').pop()}
      />
    );
  const fit = size.width
    ? Math.min(
        1,
        Math.max(1, frame.width - 48) / size.width,
        Math.max(1, frame.height - 48) / size.height,
      )
    : 1;
  return (
    <section className="image-preview" aria-label="项目图片预览">
      <div className="asset-toolbar">
        <span>
          {size.width > 0 && !error ? `${size.width} × ${size.height}` : ext.toUpperCase()}
        </span>
        <div>
          <button
            className="icon-button"
            aria-label="缩小图片"
            disabled={zoom <= 0.1}
            onClick={() => setZoom((z) => Math.max(0.1, z - 0.1))}
          >
            <Minus size={14} />
          </button>
          <button className="zoom-value" aria-label="图片适合窗口" onClick={() => setZoom(1)}>
            {Math.round(zoom * 100)}%
          </button>
          <button
            className="icon-button"
            aria-label="放大图片"
            disabled={zoom >= 5}
            onClick={() => setZoom((z) => Math.min(5, z + 0.1))}
          >
            <Plus size={14} />
          </button>
          <button
            className="icon-button"
            aria-label="导出资源文件"
            onClick={() => download(new Blob([bytes]), file.path.split('/').pop()!)}
          >
            <ArrowDownToLine size={15} />
          </button>
        </div>
      </div>
      <div className="image-scroll" ref={scroll}>
        {imageTypes[ext] && !error ? (
          <div className="image-stage">
            <img
              src={url || undefined}
              alt={file.path}
              draggable={false}
              style={
                size.width
                  ? { width: size.width * fit * zoom, height: size.height * fit * zoom }
                  : { maxWidth: '100%' }
              }
              onLoad={(e) =>
                setSize({
                  width: e.currentTarget.naturalWidth,
                  height: e.currentTarget.naturalHeight,
                })
              }
              onError={() => setError(true)}
            />
          </div>
        ) : (
          <div className="empty-state">
            <FileQuestion size={32} />
            <p>
              {error
                ? '无法读取这张图片，文件可能损坏或编码不受支持。'
                : '此格式暂不支持内置预览，可导出后查看。'}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
