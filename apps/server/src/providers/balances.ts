import { partialEvidenceLimitation, type AccountBalance } from '@midas/shared';

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

export interface BalanceMappingResult {
  rows: AccountBalance[];
  inputValid: boolean;
  attempted: number;
  omitted: number;
}

/**
 * Map a ccxt `fetchBalance()` result to our AccountBalance[]: one row per asset
 * with a positive total, priced via the supplied lookup. Drops zero/empty
 * balances and sorts by USD value (unpriced assets sink to the bottom). Pure and
 * defensive — malformed required balance evidence is omitted rather than
 * fabricated as zero; optional valuation remains null when unavailable.
 */
export function mapCcxtBalanceWithDiagnostics(
  raw: unknown,
  priceUsd: (asset: string) => number | null,
): BalanceMappingResult {
  const r = raw as
    | { total?: Record<string, unknown>; free?: Record<string, unknown>; used?: Record<string, unknown> }
    | null
    | undefined;
  const totals = r?.total;
  if (!totals || typeof totals !== 'object' || Array.isArray(totals)) {
    return { rows: [], inputValid: false, attempted: 0, omitted: 0 };
  }

  const out: AccountBalance[] = [];
  let attempted = 0;
  let omitted = 0;
  for (const [rawAsset, totalRaw] of Object.entries(totals)) {
    const total = toNum(totalRaw);
    if (total !== null && total <= 0) continue; // valid empty balance
    attempted += 1;
    if (total == null) {
      omitted += 1;
      continue;
    }
    const asset = rawAsset.toUpperCase();
    const free = toNum(r?.free?.[rawAsset]);
    const used = toNum(r?.used?.[rawAsset]);
    if (!asset || free == null || free < 0 || used == null || used < 0) {
      omitted += 1;
      continue;
    }
    const rawPrice = priceUsd(asset);
    const px = rawPrice != null && Number.isFinite(rawPrice) && rawPrice > 0 ? rawPrice : null;
    out.push({ asset, free, used, total, valueUsd: px != null ? px * total : null });
  }
  out.sort((a, b) => (b.valueUsd ?? -Infinity) - (a.valueUsd ?? -Infinity));
  return { rows: out, inputValid: true, attempted, omitted };
}

export function mapCcxtBalance(
  raw: unknown,
  priceUsd: (asset: string) => number | null,
): AccountBalance[] {
  return mapCcxtBalanceWithDiagnostics(raw, priceUsd).rows;
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

/**
 * Honest caveat for balances that could not be priced (no /USDT market): their
 * value is excluded from `sumValueUsd`, so the total is a floor, not the whole
 * account. Null when every held asset is priced. Pure.
 */
export function unpricedCaveat(balances: AccountBalance[]): string | null {
  let n = 0;
  for (const b of balances) {
    if (b.valueUsd == null) n++;
  }
  if (n === 0) return null;
  return partialEvidenceLimitation(
    `${n} asset${n === 1 ? '' : 's'} could not be priced (no USDT market); the USD total is a floor.`,
  );
}
