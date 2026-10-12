import { useEffect, useRef, useState } from 'react';
import { Check, RotateCcw, X } from 'lucide-react';
import { hexToHsv, hsvToHex, normalizeHex, type HSV } from './colors';

export function ColorPicker({
  label,
  value,
  resolved,
  onChange,
  onClose,
}: {
  label: string;
  value: string;
  resolved: string;
  onChange: (value: string) => void;
  onClose: () => void;
}) {
  const initial = normalizeHex(value) || normalizeHex(resolved) || '#7150BD';
  const [hsv, setHsv] = useState(() => hexToHsv(initial));
  const [hex, setHex] = useState(initial);
  const [error, setError] = useState('');
  const square = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panel.current?.scrollIntoView({ block: 'nearest' });
  }, []);
  useEffect(() => {
    const next = normalizeHex(value) || normalizeHex(resolved) || '#7150BD';
    setHex(next);
    setHsv((old) => (hsvToHex(old) === next ? old : hexToHsv(next)));
    setError('');
  }, [value, resolved]);
  const choose = (next: HSV) => {
    setHsv(next);
    const color = hsvToHex(next);
    setHex(color);
    setError('');
    onChange(color);
  };
  const point = (x: number, y: number) => {
    const rect = square.current!.getBoundingClientRect();
    choose({
      ...hsv,
      s: Math.max(0, Math.min(100, ((x - rect.left) / rect.width) * 100)),
      v: Math.max(0, Math.min(100, 100 - ((y - rect.top) / rect.height) * 100)),
    });
  };
  const commitHex = () => {
    const normalized = normalizeHex(hex);
    if (normalized) {
      setHex(normalized);
      onChange(normalized);
      setError('');
    } else setError('请输入 3 位或 6 位十六进制颜色。');
  };
  const swatches = [
    '#303030',
    '#E4E4E4',
    '#7150BD',
    '#AD8DEB',
    '#2861B8',
    '#8DBBF4',
    '#257253',
    '#93D7B0',
    '#B03E6C',
    '#F3A7C4',
    '#93600B',
    '#EBC67D',
  ];
  return (
    <div
      ref={panel}
      className="color-studio"
      role="group"
      aria-label={label + '颜色编辑'}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="color-studio-heading">
        <div>
          <span className="color-dot" style={{ background: hsvToHex(hsv) }} />
          <strong>{label}颜色</strong>
        </div>
        <button aria-label="关闭颜色编辑" className="icon-button" onClick={onClose}>
          <X size={15} />
        </button>
      </div>
      <div className="color-studio-body">
        <div className="color-controls">
          <div
            ref={square}
            className="color-square"
            role="slider"
            tabIndex={0}
            aria-label="饱和度与明度"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(hsv.v)}
            aria-valuetext={`饱和度 ${Math.round(hsv.s)}%，明度 ${Math.round(hsv.v)}%`}
            style={{ backgroundColor: `hsl(${hsv.h} 100% 50%)` }}
            onPointerDown={(e) => {
              e.preventDefault();
              e.currentTarget.focus();
              e.currentTarget.setPointerCapture(e.pointerId);
              point(e.clientX, e.clientY);
            }}
            onPointerMove={(e) => {
              if (e.currentTarget.hasPointerCapture(e.pointerId)) point(e.clientX, e.clientY);
            }}
            onPointerUp={(e) => {
              if (e.currentTarget.hasPointerCapture(e.pointerId))
                e.currentTarget.releasePointerCapture(e.pointerId);
            }}
            onKeyDown={(e) => {
              if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
              e.preventDefault();
              const step = e.shiftKey ? 10 : 1;
              choose({
                ...hsv,
                s: Math.max(
                  0,
                  Math.min(
                    100,
                    hsv.s + (e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0),
                  ),
                ),
                v: Math.max(
                  0,
                  Math.min(
                    100,
                    hsv.v + (e.key === 'ArrowUp' ? step : e.key === 'ArrowDown' ? -step : 0),
                  ),
                ),
              });
            }}
          >
            <span
              className="color-cursor"
              style={{ left: hsv.s + '%', top: 100 - hsv.v + '%', background: hsvToHex(hsv) }}
            />
          </div>
          <input
            className="hue-slider"
            type="range"
            min="0"
            max="359"
            value={Math.round(hsv.h)}
            aria-label="色相"
            onChange={(e) => choose({ ...hsv, h: Number(e.target.value) })}
          />
        </div>
        <div className="color-values">
          <label className="hex-field">
            <span>HEX</span>
            <input
              aria-label={label + '颜色 HEX'}
              value={hex}
              maxLength={7}
              spellCheck={false}
              onChange={(e) => {
                setHex(e.target.value);
                setError('');
                const valid = normalizeHex(e.target.value);
                if (valid && e.target.value.replace('#', '').length === 6) onChange(valid);
              }}
              onBlur={commitHex}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitHex();
                }
              }}
            />
          </label>
          <div className="color-swatches" aria-label="推荐颜色">
            {swatches.map((color) => (
              <button
                key={color}
                aria-label={'使用颜色 ' + color}
                aria-pressed={normalizeHex(value) === color}
                style={{ background: color }}
                onClick={() => onChange(color)}
              >
                {normalizeHex(value) === color && (
                  <Check size={12} color={hexToHsv(color).v > 70 ? '#111' : '#fff'} />
                )}
              </button>
            ))}
          </div>
          <button className="color-reset" onClick={() => onChange('auto')}>
            <RotateCcw size={13} />
            {value === 'auto' ? '正在跟随主题' : '跟随主题'}
          </button>
          <small>方向键微调 · Shift 加速</small>
        </div>
      </div>
      {error && (
        <p className="color-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
