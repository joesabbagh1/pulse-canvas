import { useEffect, useRef, useState, type ReactNode } from 'react';

export type MenuItem = { label: string; onSelect: () => void; shortcut?: string; danger?: boolean } | 'separator';

interface Props {
  /** The trigger's content. */
  label: ReactNode;
  /** Used for the trigger's aria-label and tooltip. */
  title: string;
  items: MenuItem[];
}

// A dropdown of commands, like a desktop app's File menu: arrow keys move,
// Enter picks, Escape or a click elsewhere closes. The list hangs below the
// trigger, aligned to its right edge so it stays on screen at the far right.
export function Menu({ label, title, items }: Props) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const actions = items.filter((i) => i !== 'separator');

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e.target instanceof Node && rootRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  const pick = (item: Exclude<MenuItem, 'separator'>) => {
    setOpen(false);
    triggerRef.current?.focus();
    item.onSelect();
  };

  // Space is left alone: across the app it plays and stops.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key !== 'ArrowDown' && e.key !== 'Enter') return;
      setActive(0);
      setOpen(true);
      e.preventDefault();
      return;
    }
    switch (e.key) {
      case 'Tab':
        setOpen(false);
        return;
      case 'Escape':
        setOpen(false);
        break;
      case 'ArrowDown':
        setActive((i) => (i + 1) % actions.length);
        break;
      case 'ArrowUp':
        setActive((i) => (i - 1 + actions.length) % actions.length);
        break;
      case 'Enter':
        pick(actions[active]);
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  return (
    <div className="menu" ref={rootRef} onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        className={`menu-trigger${open ? ' is-open' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={title}
        title={title}
        onClick={() => {
          setActive(0);
          setOpen((o) => !o);
        }}
      >
        {label}
      </button>
      {open && (
        <div className="menu-list" role="menu" aria-label={title}>
          {items.map((item, i) =>
            item === 'separator' ? (
              <div key={`sep-${i}`} className="menu-separator" role="separator" />
            ) : (
              <div
                key={item.label}
                role="menuitem"
                tabIndex={-1}
                data-active={actions.indexOf(item) === active}
                className={`menu-item${item.danger ? ' is-danger' : ''}`}
                onPointerEnter={() => setActive(actions.indexOf(item))}
                onClick={() => pick(item)}
              >
                <span>{item.label}</span>
                {item.shortcut && <kbd>{item.shortcut}</kbd>}
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}
