import {
  Children,
  isValidElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import './select.css';

export function Select({
  value,
  onValueChange,
  children,
  disabled,
  searchable = false,
  'aria-label': label,
}: {
  value: string;
  onValueChange(value: string): void;
  children: ReactNode;
  disabled?: boolean;
  searchable?: boolean;
  'aria-label': string;
}) {
  const [query, setQuery] = useState('');
  const searchInput = useRef<HTMLInputElement>(null);
  const allOptions = Children.toArray(children).flatMap((child) =>
    isValidElement<{ value?: string; children: ReactNode; disabled?: boolean }>(child)
      ? [
          {
            value: String(child.props.value ?? child.props.children),
            label: child.props.children,
            disabled: child.props.disabled,
          },
        ]
      : [],
  );
  const options = allOptions.filter(
    (o) => !searchable || String(o.label).toLowerCase().includes(query.toLowerCase()),
  );
  const [open, setOpen] = useState(false),
    [active, setActive] = useState(0);
  const [rect, setRect] = useState({ left: 0, top: 0, width: 180, height: 280 });
  const trigger = useRef<HTMLButtonElement>(null),
    menu = useRef<HTMLDivElement>(null);
  const id = useId(),
    search = useRef({ text: '', time: 0 });
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  const choose = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    onValueChange(option.value);
    close();
  };
  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const r = trigger.current.getBoundingClientRect();
    const height = Math.min(
      320,
      Math.max(48, options.length * 38) + (searchable ? 52 : 12),
      window.innerHeight - 24,
    );
    const width = Math.min(window.innerWidth - 24, Math.max(180, r.width));
    setRect({
      left: Math.max(12, Math.min(r.left, window.innerWidth - width - 12)),
      top:
        r.bottom + height + 6 < window.innerHeight
          ? r.bottom + 6
          : Math.max(12, r.top - height - 6),
      width,
      height,
    });
    setActive(
      Math.max(
        0,
        options.findIndex((o) => o.value === value),
      ),
    );
    menu.current?.showPopover();
    (searchable ? searchInput.current : menu.current)?.focus({ preventScroll: true });
  }, [open, query]);
  useEffect(() => {
    if (!open) return;
    const root = menu.current;
    const option = root?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    if (!root || !option) return;
    if (option.offsetTop < root.scrollTop) root.scrollTop = option.offsetTop;
    else if (option.offsetTop + option.offsetHeight > root.scrollTop + root.clientHeight)
      root.scrollTop = option.offsetTop + option.offsetHeight - root.clientHeight;
  }, [active, open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (
        !trigger.current?.contains(event.target as Node) &&
        !menu.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    const resize = () => setOpen(false);
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', resize);
    window.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', resize);
      window.removeEventListener('keydown', escape, true);
    };
  }, [open]);
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="select-trigger"
        role="combobox"
        aria-label={label}
        aria-controls={id}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          setQuery('');
          setOpen((v) => !v);
        }}
        onKeyDown={(e) => {
          if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
            e.preventDefault();
            setQuery('');
            setOpen(true);
          }
        }}
      >
        <span>{allOptions.find((o) => o.value === value)?.label ?? '请选择'}</span>
        <ChevronDown size={14} />
      </button>
      {open &&
        createPortal(
          <div
            id={id}
            ref={menu}
            popover="manual"
            role="listbox"
            tabIndex={-1}
            aria-label={label}
            aria-activedescendant={`${id}-${active}`}
            className="select-menu"
            style={{ left: rect.left, top: rect.top, width: rect.width, maxHeight: rect.height }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Escape') {
                e.preventDefault();
                close();
              } else if (e.key === 'Tab') {
                close();
              } else if (e.nativeEvent.isComposing) {
                return;
              } else if (
                searchable &&
                e.target === searchInput.current &&
                ['Home', 'End'].includes(e.key)
              ) {
                return;
              } else if (e.key === 'Enter' || (e.key === ' ' && !searchable)) {
                e.preventDefault();
                choose(active);
              } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
                e.preventDefault();
                if (!options.length) return;
                const direction = e.key === 'ArrowUp' ? -1 : 1;
                let next =
                  e.key === 'Home'
                    ? 0
                    : e.key === 'End'
                      ? options.length - 1
                      : (active + direction + options.length) % options.length;
                for (let i = 0; options[next]?.disabled && i < options.length; i++)
                  next = (next + direction + options.length) % options.length;
                setActive(next);
              } else if (e.key.length === 1 && !searchable) {
                search.current.text =
                  Date.now() - search.current.time > 700 ? e.key : search.current.text + e.key;
                search.current.time = Date.now();
                const i = options.findIndex(
                  (o) =>
                    !o.disabled &&
                    String(o.label).toLowerCase().startsWith(search.current.text.toLowerCase()),
                );
                if (i >= 0) setActive(i);
              }
            }}
          >
            {searchable && (
              <input
                ref={searchInput}
                className="select-search"
                aria-label={`筛选${label}`}
                placeholder="输入名称筛选…"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
              />
            )}
            {!options.length && <p className="select-empty">没有匹配项</p>}
            {options.map((option, i) => (
              <button
                key={option.value}
                type="button"
                id={`${id}-${i}`}
                data-index={i}
                role="option"
                tabIndex={-1}
                aria-selected={value === option.value}
                disabled={option.disabled}
                className={active === i ? 'is-highlighted' : ''}
                onPointerMove={() => setActive(i)}
                onClick={() => choose(i)}
              >
                <span>{option.label}</span>
                {value === option.value && <Check size={14} />}
              </button>
            ))}
          </div>,
          trigger.current?.closest('[role="dialog"]') ?? document.body,
        )}
    </>
  );
}
