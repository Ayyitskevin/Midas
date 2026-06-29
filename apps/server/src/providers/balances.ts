import type { AccountBalance } from '@midas/shared';

/**
 * Read-only balances seam helpers. Midas is non-custodial: balances are read
 * with read-only exchange API keys supplied via the operator's own environment
 * (MIDAS_CCXT_API_KEY / MIDAS_CCXT_SECRET), and the terminal never places orders
 * or moves funds — the keyed path calls only `fetchBalance`, never `createOrder`.
 * The mapping is pure and unit-tested so it can be verified without a live
 * exchange (the operator verifies the keyed read itself).
 */

/** Quote/stable assets valued at $1 without a price lookup. */
export const STABLES = new Set([
  'USDT',
  'USDC',
  'DAI',
  'BUSD',
  'TUSD',
  'USDP',
  'USD',
  'FDUSD',
  'USDD',
  'PYUSD',
]);

/** Are read-only ccxt API keys configured? Both the key and secret must be present. */
export function ccxtKeysConfigured(): boolean {
  return Boolean(process.env.MIDAS_CCXT_API_KEY && process.env.MIDAS_CCXT_SECRET);
}

const toNum = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : null;
};

/**
 * Map a ccxt `fetchBalance()` result to our AccountBalance[]: one row per asset
 * with a positive total, priced via the supplied lookup. Drops zero/empty
 * balances and sorts by USD value (unpriced assets sink to the bottom). Pure and
 * defensive — unknown/missing fields degrade to 0/null rather than throwing.
 */
export function mapCcxtBalance(
  raw: unknown,
  priceUsd: (asset: string) => number | null,
): AccountBalance[] {
  const r = raw as
    | { total?: Record<string, unknown>; free?: Record<string, unknown>; used?: Record<string, unknown> }
    | null
    | undefined;
  const totals = r?.total;
  if (!totals || typeof totals !== 'object') return [];

  const out: AccountBalance[] = [];
  for (const [rawAsset, totalRaw] of Object.entries(totals)) {
    const total = toNum(totalRaw);
    if (total == null || total <= 0) continue; // drop empty balances
    const asset = rawAsset.toUpperCase();
    const free = toNum(r?.free?.[rawAsset]) ?? 0;
    const used = toNum(r?.used?.[rawAsset]) ?? Math.max(0, total - free);
    const px = priceUsd(asset);
    out.push({ asset, free, used, total, valueUsd: px != null ? px * total : null });
  }
  out.sort((a, b) => (b.valueUsd ?? -Infinity) - (a.valueUsd ?? -Infinity));
  return out;
}

/** Sum the USD value across priced balances; null when nothing could be priced. */
export function sumValueUsd(balances: AccountBalance[]): number | null {
  let sum = 0;
  let any = false;
  for (const b of balances) {
    if (b.valueUsd != null) {
      sum += b.valueUsd;
      any = true;
    }
  }
  return any ? sum : null;
}
