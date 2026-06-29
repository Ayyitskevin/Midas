/**
 * Data-source honesty: map the /api/health provider + live flag to a user-facing
 * badge. A core Midas principle is to always label whether you're looking at
 * real market data or a synthetic/offline feed — so the terminal never passes
 * mock data off as live.
 */
export type SourceTone = 'live' | 'synthetic';

export interface SourceView {
  /** Provider id, e.g. "ccxt:binance" or "mock". */
  label: string;
  tone: SourceTone;
  /** Tailwind text-color class for the status dot. */
  dotClass: string;
  /** Honest tooltip. */
  title: string;
}

export function sourceView(provider: string, live: boolean): SourceView {
  if (live) {
    return {
      label: provider,
      tone: 'live',
      dotClass: 'text-term-up',
      title: `Live market data from ${provider}`,
    };
  }
  return {
    label: provider,
    tone: 'synthetic',
    dotClass: 'text-term-amber',
    title: `Synthetic / offline data (${provider}) — not real market data`,
  };
}
