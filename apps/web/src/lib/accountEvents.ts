import type { AccountOrderEvent } from '@midas/shared';
import type { ToastTone } from '@/store/useToasts';

/**
 * Presentation for account order events (the watcher feed → toasts).
 * Pure helpers so the wording and tones are unit-testable without timers.
 */

const KIND_LABEL: Record<AccountOrderEvent['kind'], string> = {
  new: 'New order',
  fill: 'Fill',
  filled: 'Order filled',
  canceled: 'Order canceled',
  closed: 'Order closed',
};

const fmtAmt = (n: number): string => String(Number(n.toFixed(8)));

/** Toast title, e.g. "Fill: BUY 0.25 BTC/USDT". */
export function eventHeadline(e: AccountOrderEvent): string {
  const size = e.kind === 'fill' ? (e.filledDelta ?? e.filled) : e.amount;
  return `${KIND_LABEL[e.kind]}: ${e.side.toUpperCase()} ${fmtAmt(size)} ${e.symbol}`;
}

/** Toast body: fill progress, price and order id. */
export function eventBody(e: AccountOrderEvent): string {
  const parts: string[] = [];
  if (e.kind === 'fill') parts.push(`${fmtAmt(e.filled)}/${fmtAmt(e.amount)} filled`);
  if (e.price != null) parts.push(`@ ${e.price}`);
  if (e.kind === 'closed') parts.push('final status unknown');
  parts.push(`order ${e.orderId}`);
  return parts.join(' · ');
}

/**
 * Executions color by side (buys up-green, sells down-red — matching the
 * terminal's side coloring everywhere else); lifecycle events stay neutral.
 */
export function eventTone(e: AccountOrderEvent): ToastTone {
  if (e.kind === 'fill' || e.kind === 'filled') return e.side === 'buy' ? 'up' : 'down';
  return 'info';
}
