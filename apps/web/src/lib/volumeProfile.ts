import type { Candle } from '@midas/shared';

/**
 * Volume profile — traded volume binned by price level over a window, the
 * horizontal histogram that shows *where* an instrument actually changed hands
 * rather than when. Because OHLCV candles don't carry intra-bar volume-by-price,
 * each candle's volume is spread evenly across the price range it covered
 * (low→high), proportional to how much of that range falls in each bin. A
 * zero-range candle drops its whole volume into the single bin holding its price.
 *
 * From the binned histogram we derive the classic levels:
 *  - POC (Point of Control): the price bin with the most traded volume.
 *  - Value Area: the contiguous band around the POC holding `vaPercent` (default
 *    70%) of total volume, grown one bin at a time toward the heavier neighbor.
 *    VAH/VAL are the high/low price edges of that band.
 */

export interface VolumeBin {
  /** Lower price edge of the bin. */
  low: number;
  /** Upper price edge of the bin. */
  high: number;
  /** Mid price of the bin. */
  mid: number;
  /** Total volume attributed to this price bin. */
  volume: number;
}

export interface VolumeProfile {
  /** Bins in ascending price order. */
  bins: VolumeBin[];
  /** Sum of all binned volume. */
  totalVolume: number;
  /** Price (bin mid) of the Point of Control. */
  poc: number;
  /** Index of the POC bin in `bins`. */
  pocIndex: number;
  /** Value Area High — upper price edge of the value-area band. */
  vah: number;
  /** Value Area Low — lower price edge of the value-area band. */
  val: number;
  /** Volume contained within the value area. */
  valueAreaVolume: number;
  /** Lowest price in the window. */
  priceLow: number;
  /** Highest price in the window. */
  priceHigh: number;
}

/**
 * Build a volume profile from OHLCV candles. Returns null when there isn't
 * enough to bin — fewer than two candles, a degenerate price range, or no
 * traded volume. `binCount` is clamped to at least 1; `vaPercent` to (0, 1].
 */
export function volumeProfile(
  candles: Candle[],
  binCount = 24,
  vaPercent = 0.7,
): VolumeProfile | null {
  if (!candles || candles.length < 2) return null;

  let priceLow = Infinity;
  let priceHigh = -Infinity;
  for (const c of candles) {
    if (c.low < priceLow) priceLow = c.low;
    if (c.high > priceHigh) priceHigh = c.high;
  }
  const span = priceHigh - priceLow;
  if (!(span > 0) || !Number.isFinite(span)) return null;

  const n = Math.max(1, Math.floor(binCount));
  const binSize = span / n;
  const bins: VolumeBin[] = Array.from({ length: n }, (_, i) => ({
    low: priceLow + i * binSize,
    high: priceLow + (i + 1) * binSize,
    mid: priceLow + (i + 0.5) * binSize,
    volume: 0,
  }));

  const binIndex = (price: number): number =>
    Math.max(0, Math.min(n - 1, Math.floor((price - priceLow) / binSize)));

  for (const c of candles) {
    const v = c.volume;
    if (!(v > 0)) continue;
    const range = c.high - c.low;
    if (!(range > 0)) {
      bins[binIndex(c.close)].volume += v;
      continue;
    }
    const first = binIndex(c.low);
    const last = binIndex(c.high);
    for (let bi = first; bi <= last; bi++) {
      const overlap = Math.min(c.high, bins[bi].high) - Math.max(c.low, bins[bi].low);
      if (overlap > 0) bins[bi].volume += (v * overlap) / range;
    }
  }

  let totalVolume = 0;
  let pocIndex = 0;
  for (let i = 0; i < n; i++) {
    totalVolume += bins[i].volume;
    if (bins[i].volume > bins[pocIndex].volume) pocIndex = i;
  }
  if (!(totalVolume > 0)) return null;

  // Grow the value area outward from the POC toward the heavier neighbor.
  const target = totalVolume * Math.max(0, Math.min(1, vaPercent));
  let lo = pocIndex - 1;
  let hi = pocIndex + 1;
  let acc = bins[pocIndex].volume;
  while (acc < target && (lo >= 0 || hi < n)) {
    const volLo = lo >= 0 ? bins[lo].volume : -1;
    const volHi = hi < n ? bins[hi].volume : -1;
    if (volHi >= volLo) {
      acc += bins[hi].volume;
      hi += 1;
    } else {
      acc += bins[lo].volume;
      lo -= 1;
    }
  }
  const valIndex = lo + 1;
  const vahIndex = hi - 1;

  return {
    bins,
    totalVolume,
    poc: bins[pocIndex].mid,
    pocIndex,
    vah: bins[vahIndex].high,
    val: bins[valIndex].low,
    valueAreaVolume: acc,
    priceLow,
    priceHigh,
  };
}
