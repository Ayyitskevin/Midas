/**
 * Sparkline geometry — pure and DOM-free. Maps a series of values to an SVG
 * path string that fits a `width × height` box (with 1px vertical padding so the
 * stroke isn't clipped). A flat series draws along the vertical middle.
 *
 * Gaps are honest: a `null` value keeps its slot on the x axis and BREAKS the
 * stroke into a new subpath. Dropping the nulls instead would slide later
 * observations left and silently redraw the series over a shorter span — the
 * same misreporting as carrying a value forward.
 */

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Build the SVG path `d` for a sparkline of `values`. Returns '' unless at
 * least one pair of ADJACENT values is present — a lone point (or points
 * separated by gaps) has no segment to stroke.
 */
export function sparklinePath(
  values: readonly (number | null | undefined)[],
  width: number,
  height: number,
): string {
  if (values.length < 2) return '';

  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v == null || !Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (min === Infinity) return ''; // nothing present
  const range = max - min;
  const pad = 1;
  const usableH = height - pad * 2;
  const n = values.length;

  // Walk the series in place, emitting one subpath per run of adjacent present
  // values so x always reflects the original index.
  const subpaths: string[] = [];
  let run: string[] = [];
  const flush = () => {
    // A 1-point run strokes nothing; drop it rather than emit a dead `M`.
    if (run.length >= 2) subpaths.push(`M${run.join(' L')}`);
    run = [];
  };
  values.forEach((v, i) => {
    if (v == null || !Number.isFinite(v)) {
      flush();
      return;
    }
    const x = (i / (n - 1)) * width;
    // Invert y (SVG origin is top-left); a flat series sits on the mid-line.
    const y = range === 0 ? height / 2 : pad + (1 - (v - min) / range) * usableH;
    run.push(`${round(x)} ${round(y)}`);
  });
  flush();

  return subpaths.join(' ');
}
