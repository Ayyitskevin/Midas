/**
 * Sparkline geometry — pure and DOM-free. Maps a series of values to an SVG
 * path string that fits a `width × height` box (with 1px vertical padding so the
 * stroke isn't clipped). A flat series draws along the vertical middle.
 */

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Build the SVG path `d` for a sparkline of `values`. Returns '' for < 2 points. */
export function sparklinePath(values: readonly number[], width: number, height: number): string {
  if (values.length < 2) return '';

  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min;
  const pad = 1;
  const usableH = height - pad * 2;
  const n = values.length;

  const points = values.map((v, i) => {
    const x = (i / (n - 1)) * width;
    // Invert y (SVG origin is top-left); a flat series sits on the mid-line.
    const y = range === 0 ? height / 2 : pad + (1 - (v - min) / range) * usableH;
    return `${round(x)} ${round(y)}`;
  });

  return `M${points.join(' L')}`;
}
