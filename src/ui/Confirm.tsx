import { useEffect, useRef, useState } from 'react';

export interface ConfirmRequest {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

// Like the toast store: confirmDialog() parks a request here and resolves when
// the host's buttons (or Escape) answer it, so callers can just await a boolean.
let request: (ConfirmRequest & { resolve: (ok: boolean) => void }) | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function confirmDialog(req: ConfirmRequest) {
  // A second call resolves the first as cancelled rather than leaking it.
  request?.resolve(false);
  return new Promise<boolean>((resolve) => {
    request = { ...req, resolve };
    emit();
  });
}

function answer(ok: boolean) {
  request?.resolve(ok);
  request = null;
  emit();
}

export function ConfirmHost() {
  const [shown, setShown] = useState(request);
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const sync = () => setShown(request);
    listeners.add(sync);
    return () => {
      listeners.delete(sync);
    };
  }, []);
  useEffect(() => {
    confirmRef.current?.focus();
    if (!shown) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && answer(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shown]);
  if (!shown) return null;
  return (
    <div className="confirm-scrim" onPointerDown={(e) => e.target === e.currentTarget && answer(false)}>
      <div className="confirm panel" role="alertdialog" aria-modal="true" aria-label={shown.title}>
        <div className="confirm-title">{shown.title}</div>
        {shown.message && <p className="muted">{shown.message}</p>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button onClick={() => answer(false)}>{shown.cancelLabel ?? 'Cancel'}</button>
          <button ref={confirmRef} className={shown.danger ? 'danger' : 'play'} onClick={() => answer(true)}>
            {shown.confirmLabel ?? 'OK'}
          </button>
        </div>
      </div>
    </div>
  );
}
