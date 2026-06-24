import type { ReactNode } from 'react';

interface LoadingProps {
  label?: string;
}

export function Loading({ label = 'Loading' }: LoadingProps) {
  return (
    <div className="flex items-center gap-2 p-3 text-xs text-term-muted">
      <span className="animate-pulse text-term-amber">▮</span>
      <span>{label}…</span>
    </div>
  );
}

export function ErrorMsg({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="p-3 text-xs text-term-down">
      <div>⚠ {message}</div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="no-drag mt-1 rounded-sm border border-term-border px-2 py-0.5 text-2xs text-term-amber hover:border-term-amber"
        >
          retry
        </button>
      )}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="p-3 text-xs text-term-muted">{children}</div>;
}
