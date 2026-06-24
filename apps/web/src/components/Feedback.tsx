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

export function ErrorMsg({ message }: { message: string }) {
  return <div className="p-3 text-xs text-term-down">⚠ {message}</div>;
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="p-3 text-xs text-term-muted">{children}</div>;
}
