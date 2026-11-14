import { useSyncExternalStore } from 'react';

// The look is two inks, so a theme is only which of them is the ground. White
// is the ground until the person picks black, and the pick stays in this
// browser. index.html sets the same attribute before the first paint.

export type Theme = 'light' | 'dark';

const KEY = 'pulse-theme';
const listeners = new Set<() => void>();
const tokens = new Map<string, string>();

function picked(): Theme | null {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

export const currentTheme = (): Theme => picked() ?? 'light';

function apply() {
  document.documentElement.dataset.theme = currentTheme();
  tokens.clear();
  for (const listener of listeners) listener();
}

export function setTheme(theme: Theme) {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // Private windows can refuse storage; the theme still changes for this visit.
  }
  apply();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

if (typeof document !== 'undefined') apply();

export function useTheme(): [Theme, (theme: Theme) => void] {
  return [useSyncExternalStore(subscribe, currentTheme, () => 'light' as Theme), setTheme];
}

/** A stylesheet token as a canvas drawing needs it, so the 2D layers follow the theme. */
export function token(name: string): string {
  let value = tokens.get(name);
  if (value === undefined) {
    value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    tokens.set(name, value);
  }
  return value;
}
