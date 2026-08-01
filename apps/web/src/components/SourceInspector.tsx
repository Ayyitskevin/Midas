import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { DataReceipt } from '@midas/shared';
import {
  receiptBadgeView,
  receiptDetailRows,
  receiptInputIds,
  receiptLimitations,
  type ReceiptTone,
} from '@/lib/receiptView';

const TONE: Record<ReceiptTone, { badge: string; dot: string }> = {
  fresh: { badge: 'border-term-up/50 text-term-up', dot: 'bg-term-up' },
  partial: { badge: 'border-term-amber/50 text-term-amber', dot: 'bg-term-amber' },
  stale: { badge: 'border-term-amber/50 text-term-amber', dot: 'bg-term-amber' },
  synthetic: { badge: 'border-term-amber/50 text-term-amber', dot: 'bg-term-amber' },
  unavailable: { badge: 'border-term-down/50 text-term-down', dot: 'bg-term-down' },
  unknown: { badge: 'border-term-border text-term-dim', dot: 'bg-term-dim' },
};

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

interface SourceInspectorProps {
  receipt: DataReceipt;
  open: boolean;
  onClose: () => void;
  dialogId: string;
  titleId: string;
  returnFocusRef: RefObject<HTMLElement>;
}

/** Portal-mounted modal drawer so transformed/clipped grid panels cannot contain it. */
export function SourceInspector({
  receipt,
  open,
  onClose,
  dialogId,
  titleId,
  returnFocusRef,
}: SourceInspectorProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const badge = receiptBadgeView(receipt);
  const rows = receiptDetailRows(receipt);
  const inputs = receiptInputIds(receipt);
  const limitations = receiptLimitations(receipt);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      const target = returnFocusRef.current;
      if (target?.isConnected) target.focus();
    };
  }, [open, returnFocusRef]);

  if (!open || typeof document === 'undefined') return null;

  const onDialogKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    // Prevent terminal-global shortcuts and the "start typing anywhere" command
    // bar from handling keystrokes intended for this modal surface.
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;

    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (focusable.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !dialog.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[120] bg-black/60"
      data-testid="source-inspector-backdrop"
      onMouseDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        id={dialogId}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onDialogKeyDown}
        onMouseDown={(event) => event.stopPropagation()}
        className="scroll-term fixed inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-lg border border-term-border bg-term-panel shadow-2xl shadow-black/70 sm:inset-y-0 sm:left-auto sm:right-0 sm:max-h-none sm:w-[26rem] sm:rounded-none sm:rounded-l-lg"
      >
        <header className="sticky top-0 z-10 flex items-start gap-3 border-b border-term-border bg-term-panel px-3 py-2">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-xs font-semibold uppercase tracking-wide text-term-amber">
              Source Inspector
            </h2>
            <p className="mt-0.5 break-words text-2xs text-term-muted">
              {badge.source} · {badge.label} · age {badge.ageText}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="no-drag rounded-sm border border-term-border px-2 py-1 text-xs text-term-muted hover:border-term-amber hover:text-term-amber focus:outline-none focus:ring-1 focus:ring-term-amber"
            aria-label="Close Source Inspector"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className="space-y-3 p-3 text-2xs">
          <dl className="divide-y divide-term-border/40 border-y border-term-border/50">
            {rows.map((row) => (
              <div key={row.label} className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-3 py-1.5">
                <dt className="text-term-dim">{row.label}</dt>
                <dd className={`min-w-0 break-words text-term-text ${row.mono ? 'font-mono' : ''}`}>
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>

          <section aria-labelledby={`${titleId}-inputs`}>
            <h3 id={`${titleId}-inputs`} className="mb-1 uppercase tracking-wide text-term-muted">
              Upstream inputs
            </h3>
            {inputs.length > 0 ? (
              <ul className="space-y-1">
                {inputs.map((id) => (
                  <li key={id} className="break-all rounded-sm bg-term-header px-2 py-1 font-mono text-term-text">
                    {id}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-term-dim">
                {String(receipt.derivation).toLowerCase() === 'derived' ? 'unknown' : 'not applicable (observed)'}
              </p>
            )}
          </section>

          <section aria-labelledby={`${titleId}-limitations`}>
            <h3 id={`${titleId}-limitations`} className="mb-1 uppercase tracking-wide text-term-muted">
              Limitations
            </h3>
            {limitations.length > 0 ? (
              <ul className="list-disc space-y-1 pl-4 text-term-amber">
                {limitations.map((limitation, index) => (
                  <li key={`${index}-${limitation}`} className="break-words whitespace-pre-wrap leading-snug">
                    {limitation}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-term-dim">none declared</p>
            )}
          </section>
        </div>
      </section>
    </div>,
    document.body,
  );
}

export interface SourceBadgeProps {
  receipt: DataReceipt;
  /** Dense row/table contexts can omit source and age while keeping the full inspector. */
  compact?: boolean;
  className?: string;
}

/** Actionable provenance badge: pointer and keyboard both open Source Inspector. */
export function SourceBadge({ receipt, compact = false, className = '' }: SourceBadgeProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = triggerRef as RefObject<HTMLElement>;
  const rawId = useId();
  const id = rawId.replace(/:/g, '');
  const dialogId = `source-inspector-${id}`;
  const titleId = `${dialogId}-title`;
  const view = receiptBadgeView(receipt);
  const tone = TONE[view.tone];

  const openInspector = () => setOpen(true);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`no-drag inline-flex max-w-full items-center gap-1 rounded-sm border px-1.5 py-0.5 text-2xs ${tone.badge} hover:bg-term-header focus:outline-none focus:ring-1 focus:ring-term-amber ${className}`}
        title={`Inspect source: ${view.title}`}
        aria-label={`Inspect source: ${view.title}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={dialogId}
        onClick={openInspector}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openInspector();
          }
        }}
      >
        <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${tone.dot}`} aria-hidden="true" />
        {!compact && <span className="max-w-24 truncate text-term-muted">{view.source}</span>}
        {!compact && <span aria-hidden="true">·</span>}
        <span className="whitespace-nowrap font-semibold">{view.label}</span>
        {!compact && (
          <>
            <span aria-hidden="true">·</span>
            <span className="whitespace-nowrap text-term-dim">{view.ageText}</span>
          </>
        )}
      </button>
      <SourceInspector
        receipt={receipt}
        open={open}
        onClose={() => setOpen(false)}
        dialogId={dialogId}
        titleId={titleId}
        returnFocusRef={returnFocusRef}
      />
    </>
  );
}
