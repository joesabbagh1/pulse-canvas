import { useEffect, useState } from 'react';

export type ToastKind = 'info' | 'success' | 'error';

export interface ToastMessage {
  id: number;
  kind: ToastKind;
  title: string;
  detail?: string;
}

// Toasts live in a module-level store so any code can raise one without
// threading context or render props through the call tree.
let toasts: ToastMessage[] = [];
const listeners = new Set<() => void>();
let nextId = 1;

function emit() {
  for (const l of listeners) l();
}

export function dismissToast(id: number) {
  if (!toasts.some((t) => t.id === id)) return;
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function toast(kind: ToastKind, title: string, detail?: string, ms = 6000) {
  const t = { id: nextId++, kind, title, detail };
  toasts = [...toasts, t];
  emit();
  if (ms > 0) setTimeout(() => dismissToast(t.id), ms);
  return t.id;
}

export function ToastHost() {
  const [shown, setShown] = useState(toasts);
  useEffect(() => {
    const sync = () => setShown([...toasts]);
    listeners.add(sync);
    return () => {
      listeners.delete(sync);
    };
  }, []);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {shown.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`} onClick={() => dismissToast(t.id)}>
          <span className="toast-icon" aria-hidden="true">
            {t.kind === 'error' ? '✕' : t.kind === 'success' ? '✓' : 'ℹ'}
          </span>
          <div className="toast-body">
            <div className="toast-title">{t.title}</div>
            {t.detail && <div className="toast-detail">{t.detail}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}
