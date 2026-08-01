/**
 * REFERENCE spot taker fee schedule for the venues Midas compares, used to
 * discount gross cross-venue spreads into a net-of-fees figure.
 *
 * These are STATIC base-tier ("regular user") published taker fees in basis
 * points — a reference tier, verify before relying. They ignore volume/VIP
 * discounts, native-token fee discounts (BNB, KCS, OKB), and — critically —
 * withdrawal/transfer costs, which a real cross-venue arb also has to clear.
 * Fee schedules drift: Kraken, for example, raised its base spot taker tier
 * from 0.40% to 0.80% in July 2026. Treat any net figure derived from this
 * table as an upper bound on the actionable spread, not a quote.
 *
 * Tiers verified 2026-08-01 against published/secondary sources:
 * - Binance 0.10% taker (regular user): https://www.binance.com/en/fee/trading ;
 *   https://castlecrypto.gg/binance-review/
 * - Coinbase Advanced 0.60% taker (lowest volume tier): https://help.coinbase.com/en/coinbase/trading-and-funding/pricing-and-fees/fees ;
 *   https://www.datawallet.com/crypto/best-crypto-exchanges-asia
 * - Kraken Pro 0.80% taker (base tier, raised from 0.40% in July 2026): https://www.kraken.com/features/fee-schedule ;
 *   https://cryptopropguide.com/kraken-fees/ (verified 2026-07-24)
 * - Bybit 0.10% taker (base tier): https://www.bybit.com/en/fee/ ;
 *   https://coinbureau.com/analysis/bybit-vs-kraken
 * - OKX 0.10% taker (regular user): https://www.okx.com/fees ;
 *   https://divly.com/en/crypto-insights/xrp-exchanges
 * - Bitfinex 0.20% taker (base tier): https://www.bitfinex.com/fees/ ;
 *   https://www.bitdegree.org/crypto/tutorials/bitfinex-fees
 * - KuCoin 0.10% taker (VIP 0): https://www.kucoin.com/vip/privilege ;
 *   https://gist.github.com/xszi7413/9056b2254f8a963c42252fdd31248d3a
 *
 * Keys are lowercase venue ids. The compare set reports display names
 * ('Binance', 'OKX', …) from the mock fixtures or ccxt's `exchange.name`,
 * so lookups are normalized — an unrecognized venue yields null, never 0:
 * no fee evidence beats a fabricated free lunch.
 */
const REFERENCE_TAKER_FEE_BPS: Readonly<Record<string, number>> = {
  binance: 10,
  coinbase: 60,
  kraken: 80,
  bybit: 10,
  okx: 10,
  bitfinex: 20,
  kucoin: 10,
};

/**
 * Base-tier reference taker fee for a venue, in basis points; null when the
 * venue is not in the reference schedule (unknown venues are never assumed
 * to be free).
 */
export function takerFeeBps(venue: string | null | undefined): number | null {
  if (venue == null) return null;
  return REFERENCE_TAKER_FEE_BPS[venue.trim().toLowerCase()] ?? null;
}

/**
 * Round-trip reference taker fees for buying on `buyVenue` and selling on
 * `sellVenue`, in basis points; null when either venue's fee is unknown.
 */
export function roundTripFeesBps(
  buyVenue: string | null | undefined,
  sellVenue: string | null | undefined,
): number | null {
  const buy = takerFeeBps(buyVenue);
  const sell = takerFeeBps(sellVenue);
  if (buy === null || sell === null) return null;
  return buy + sell;
}

/**
 * Gross spread minus round-trip reference taker fees, in basis points; null
 * when the spread is unavailable or either leg's venue fee is unknown.
 * Positive ⇒ the crossed book clears (reference) taker fees on both legs.
 */
export function netSpreadBps(
  grossBps: number | null | undefined,
  buyVenue: string | null | undefined,
  sellVenue: string | null | undefined,
): number | null {
  if (grossBps == null) return null;
  const fees = roundTripFeesBps(buyVenue, sellVenue);
  if (fees === null) return null;
  return grossBps - fees;
}
