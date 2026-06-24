/**
 * Pure helpers for the market heatmap: a treemap layout (tile area ∝ value) and
 * a change→colour ramp. No React/DOM, so both are unit-testable.
 */

export interface TreemapItem {
  key: string;
  value: number;
}

export interface TreemapTile {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Lay items out as a treemap in a `width × height` box. Uses a balanced
 * binary split — recursively halve the items by value and split the longer
 * side proportionally — which keeps aspect ratios reasonable while making each
 * tile's area exactly proportional to its value. Largest items first.
 */
export function treemap(items: TreemapItem[], width: number, height: number): TreemapTile[] {
  const valid = items.filter((it) => Number.isFinite(it.value) && it.value > 0);
  const out: TreemapTile[] = [];
  if (valid.length === 0 || width <= 0 || height <= 0) return out;
  const sorted = [...valid].sort((a, b) => b.value - a.value);
  split(sorted, 0, 0, width, height, out);
  return out;
}

function split(
  items: TreemapItem[],
  x: number,
  y: number,
  w: number,
  h: number,
  out: TreemapTile[],
): void {
  if (items.length === 1) {
    out.push({ key: items[0].key, x, y, w, h });
    return;
  }

  const total = items.reduce((s, it) => s + it.value, 0);
  // Take items into the first group until it holds ~half the total value,
  // always leaving at least one for the second group.
  let acc = 0;
  let i = 0;
  while (i < items.length - 1 && acc + items[i].value <= total / 2) {
    acc += items[i].value;
    i += 1;
  }
  if (i === 0) {
    acc = items[0].value;
    i = 1;
  }

  const first = items.slice(0, i);
  const second = items.slice(i);
  const frac = acc / total; // acc === sum(first)

  if (w >= h) {
    const wa = w * frac;
    split(first, x, y, wa, h, out);
    split(second, x + wa, y, w - wa, h, out);
  } else {
    const ha = h * frac;
    split(first, x, y, w, ha, out);
    split(second, x, y + ha, w, h - ha, out);
  }
}

/** Up (#26c281) / down (#ef4d56) tile colour, opacity scaled by |change|. */
export function heatColor(changePct: number, cap = 8): string {
  const pct = Number.isFinite(changePct) ? changePct : 0;
  const t = Math.max(-1, Math.min(1, pct / cap)); // −1 … 1
  const alpha = (0.12 + 0.6 * Math.abs(t)).toFixed(3);
  return t >= 0 ? `rgba(38,194,129,${alpha})` : `rgba(239,77,86,${alpha})`;
}
