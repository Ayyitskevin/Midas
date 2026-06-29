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

export interface DemoBannerView {
  /** Headline — states plainly that the data is synthetic. */
  text: string;
  /** How to switch to real data. */
  hint: string;
}

/**
 * First-run honesty: when the active provider is synthetic (not live), return a
 * banner telling a new visitor they're on demo data and how to go live. Returns
 * null for any live provider, so the banner never shows over real market data.
 */
export function demoBanner(provider: string, live: boolean): DemoBannerView | null {
  if (live) return null;
  return {
    text: `Demo mode — you're viewing synthetic “${provider}” data, not real markets.`,
    hint: 'Set MIDAS_DATA_PROVIDER=ccxt for live crypto.',
  };
}
