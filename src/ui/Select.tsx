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
  /** A text field at the top of the list, for a long menu such as the instruments. */
  searchable?: boolean;
  onChange: (value: string) => void;
}

const flat = (groups: SelectGroup[]) => groups.flatMap((g) => g.options);

const MARGIN = 8;

/** Puts the list under the trigger, shifting it left or up so it stays on screen. */
function place(trigger: HTMLElement, list: HTMLElement) {
  const rect = trigger.getBoundingClientRect();
  const maxWidth = window.innerWidth - MARGIN * 2;
  list.style.maxWidth = `${maxWidth}px`;
  list.style.minWidth = `${Math.min(Math.max(rect.width, 0), maxWidth)}px`;
  list.style.width = 'max-content';
  const width = Math.min(Math.max(list.offsetWidth, rect.width), maxWidth);
  list.style.width = `${width}px`;
  let left = rect.left;
  if (left + width > window.innerWidth - MARGIN) left = window.innerWidth - MARGIN - width;
  if (left < MARGIN) left = MARGIN;
  list.style.left = `${left}px`;

  const spaceBelow = window.innerHeight - rect.bottom - MARGIN;
  const spaceAbove = rect.top - MARGIN;
  const natural = list.scrollHeight;
  const openUp = spaceBelow < Math.min(natural, 280) + 4 && spaceAbove > spaceBelow;
  const maxHeight = Math.max(80, Math.min(280, (openUp ? spaceAbove : spaceBelow) - 4));
  list.style.maxHeight = `${maxHeight}px`;
  const height = Math.min(list.scrollHeight, maxHeight);
  list.style.top = `${openUp ? Math.max(MARGIN, rect.top - 4 - height) : rect.bottom + 4}px`;
}

/** Scrolls only the list. `scrollIntoView` would also scroll the page and close the menu. */
function reveal(option: HTMLElement, list: HTMLElement) {
  const listBox = list.getBoundingClientRect();
  const optionBox = option.getBoundingClientRect();
  const search = list.querySelector('.select-search');
  const top = listBox.top + (search instanceof HTMLElement ? search.offsetHeight + 4 : 0);
  if (optionBox.top < top) list.scrollTop -= top - optionBox.top;
  else if (optionBox.bottom > listBox.bottom) list.scrollTop += optionBox.bottom - listBox.bottom;
}

// A dropdown that looks like the rest of the controls: a trigger button plus a
// floating list. The list is positioned fixed from the trigger's rect so it
// escapes any panel, flipping up when the viewport hasn't room below.
export function Select({ value, groups, ariaLabel, searchable = false, onChange }: Props) {
  const options = flat(groups);
  const selected = options.find((o) => o.value === value);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(() => Math.max(0, options.findIndex((o) => o.value === value)));
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const stick = useRef(false);

  const needle = query.trim().toLowerCase();
  const shownGroups = needle
    ? groups
        .map((group) => ({ ...group, options: group.options.filter((option) => option.label.toLowerCase().includes(needle)) }))
        .filter((group) => group.options.length > 0)
    : groups;
  const shown = flat(shownGroups);
  const cursor = shown.length ? Math.min(active, shown.length - 1) : 0;

  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const list = listRef.current;
    if (trigger && list) place(trigger, list);
  }, [open, query]);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (!(e.target instanceof Node) || triggerRef.current?.contains(e.target) || listRef.current?.contains(e.target)) return;
      setOpen(false);
      setQuery('');
    };
    const reposition = (e: Event) => {
      // Scrolling the list itself is how you reach the options. Only a scroll of the page behind it should dismiss.
      if (e.target instanceof Node && listRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      document.removeEventListener('pointerdown', close);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open]);

  useEffect(() => {
    if (open && searchable) searchRef.current?.focus();
  }, [open, searchable]);

  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    const option = list?.querySelector('[data-active="true"]');
    if (list && option instanceof HTMLElement) reveal(option, list);
  }, [open]);

  useEffect(() => {
    if (!open || !stick.current) return;
    stick.current = false;
    const list = listRef.current;
    const option = list?.querySelector('[data-active="true"]');
    if (list && option instanceof HTMLElement) reveal(option, list);
  }, [open, active]);

  const pick = (option: SelectOption) => {
    setOpen(false);
    setQuery('');
    if (option.action) option.action();
    else onChange(option.value);
  };

  const move = (next: (index: number) => number) => {
    if (!shown.length) return;
    stick.current = true;
    setActive(next);
  };

  const onListKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      setQuery('');
      triggerRef.current?.focus();
      return;
    }
    if (e.key === 'ArrowDown') move((i) => (Math.min(i, shown.length - 1) + 1) % shown.length);
    else if (e.key === 'ArrowUp') move((i) => (Math.min(i, shown.length - 1) - 1 + shown.length) % shown.length);
    else if (e.key === 'Home') move(() => 0);
    else if (e.key === 'End') move(() => shown.length - 1);
    else if (e.key === 'Enter' || (e.key === ' ' && e.currentTarget === triggerRef.current)) {
      if (shown[cursor]) pick(shown[cursor]);
    } else return;
    e.preventDefault();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (open) {
        setOpen(false);
        setQuery('');
      }
      return;
    }
    if (!open && (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      setQuery('');
      setActive(Math.max(0, options.findIndex((o) => o.value === value)));
      setOpen(true);
      return;
    }
    if (!open || searchable) return;
    onListKey(e);
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
        onClick={() => {
          if (open) {
            setOpen(false);
            setQuery('');
          } else {
            setActive(Math.max(0, options.findIndex((o) => o.value === value)));
            setOpen(true);
          }
        }}
        onKeyDown={onKeyDown}
      >
        <span className="select-value">{selected?.label ?? '—'}</span>
        <svg className={`select-chevron${open ? ' is-open' : ''}`} viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div
          ref={listRef}
          role="listbox"
          aria-label={ariaLabel}
          className="select-list"
          onWheel={(event) => event.stopPropagation()}
        >
          {searchable && (
            <input
              ref={searchRef}
              className="select-search"
              type="text"
              aria-label={`Search ${ariaLabel.toLowerCase()}`}
              placeholder="Search"
              value={query}
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={onListKey}
            />
          )}
          {shown.length === 0 && <div className="select-empty">No matches</div>}
          {shownGroups.map((group, gi) => (
            <div key={group.label ?? gi} className="select-group">
              {group.label && <div className="select-group-label">{group.label}</div>}
              {group.options.map((option) => {
                const i = shown.indexOf(option);
                const isSelected = option.value === value && !option.action;
                return (
                  <div
                    key={option.value}
                    role="option"
                    aria-selected={isSelected}
                    data-active={i === cursor}
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
