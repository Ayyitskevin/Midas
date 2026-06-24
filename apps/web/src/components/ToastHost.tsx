import { useEffect } from 'react';
import { useToasts, type Toast } from '@/store/useToasts';

const DISMISS_MS = 6500;

const TONE_BORDER: Record<Toast['tone'], string> = {
  up: 'border-l-term-up',
  down: 'border-l-term-down',
  info: 'border-l-term-amber',
};

function ToastCard({ toast }: { toast: Toast }) {
  const dismiss = useToasts((s) => s.dismiss);
  useEffect(() => {
    const t = setTimeout(() => dismiss(toast.id), DISMISS_MS);
    return () => clearTimeout(t);
  }, [toast.id, dismiss]);

  return (
    <div
      className={`pointer-events-auto w-72 border border-l-2 border-term-border ${TONE_BORDER[toast.tone]} bg-term-header/95 px-3 py-2 shadow-lg`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold text-term-text">{toast.title}</div>
          {toast.body && <div className="mt-0.5 truncate text-2xs text-term-muted">{toast.body}</div>}
        </div>
        <button
          onClick={() => dismiss(toast.id)}
          className="no-drag -mr-1 -mt-0.5 px-1 text-term-dim hover:text-term-text"
          aria-label="Dismiss"
        >
          ×
        </button>
      </div>
    </div>
  );
}

/** Fixed stack of alert toasts, rendered once at the app root. */
export function ToastHost() {
  const toasts = useToasts((s) => s.toasts);
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-10 right-3 z-50 flex flex-col gap-2">
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} />
      ))}
    </div>
  );
}
