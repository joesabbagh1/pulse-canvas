import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface SelectOption {
  value: string;
  label: string;
  /** An action row (e.g. "Import…") rather than a choice; picking it runs this instead of onChange. */
  action?: () => void;
}

export interface SelectGroup {
  label?: string;
  options: SelectOption[];
}

interface Props {
  value: string;
  groups: SelectGroup[];
  /** Used for the trigger's aria-label and tooltip. */
  ariaLabel: string;
  onChange: (value: string) => void;
}

const flat = (groups: SelectGroup[]) => groups.flatMap((g) => g.options);

// A dropdown that looks like the rest of the controls: a trigger button plus a
// floating list. The list is positioned fixed from the trigger's rect so it
// escapes any panel, flipping up when the viewport hasn't room below.
export function Select({ value, groups, ariaLabel, onChange }: Props) {
  const options = flat(groups);
  const selected = options.find((o) => o.value === value);
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const [active, setActive] = useState(() => Math.max(0, options.findIndex((o) => o.value === value)));
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setUp(window.innerHeight - rect.bottom < Math.min(listRef.current?.offsetHeight ?? 0, 280) + 24);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (!(e.target instanceof Node) || triggerRef.current?.contains(e.target) || listRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const reposition = () => setOpen(false);
    document.addEventListener('pointerdown', close);
    window.addEventListener('resize', reposition);
    // Closing on scroll keeps the floating list under its trigger instead of drifting.
    window.addEventListener('scroll', reposition, true);
    return () => {
      document.removeEventListener('pointerdown', close);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open]);

  useEffect(() => {
    if (open) listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [open, active]);

  const pick = (option: SelectOption) => {
    setOpen(false);
    if (option.action) option.action();
    else onChange(option.value);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (open) setOpen(false);
      return;
    }
    if (!open && (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      setActive(Math.max(0, options.findIndex((o) => o.value === value)));
      setOpen(true);
      return;
    }
    if (!open) return;
    e.preventDefault();
    if (e.key === 'ArrowDown') setActive((i) => (i + 1) % options.length);
    else if (e.key === 'ArrowUp') setActive((i) => (i - 1 + options.length) % options.length);
    else if (e.key === 'Home') setActive(0);
    else if (e.key === 'End') setActive(options.length - 1);
    else if (e.key === 'Enter' || e.key === ' ') pick(options[active]);
  };

  return (
    <div className="select">
      <button
        ref={triggerRef}
        type="button"
        className="select-trigger"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        title={ariaLabel}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKeyDown}
      >
        <span className="select-value">{selected?.label ?? '—'}</span>
        <svg className={`select-chevron${open ? ' is-open' : ''}`} viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div ref={listRef} role="listbox" aria-label={ariaLabel} className={`select-list${up ? ' is-up' : ''}`}>
          {groups.map((group, gi) => (
            <div key={gi} className="select-group">
              {group.label && <div className="select-group-label">{group.label}</div>}
              {group.options.map((option) => {
                const i = options.indexOf(option);
                const isSelected = option.value === value && !option.action;
                return (
                  <div
                    key={option.value}
                    role="option"
                    aria-selected={isSelected}
                    data-active={i === active}
                    className={`select-option${isSelected ? ' is-selected' : ''}${option.action ? ' is-action' : ''}`}
                    onPointerEnter={() => setActive(i)}
                    onClick={() => pick(option)}
                  >
                    <span className="select-option-check">{isSelected ? '✓' : ''}</span>
                    <span className="select-option-label">{option.label}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
