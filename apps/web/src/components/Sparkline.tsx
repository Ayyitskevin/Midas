import { sparklinePath } from '@/lib/sparkline';
import { changeClass } from '@/lib/format';

/**
 * A tiny inline trend line. Colour follows the net direction (first → last)
 * via `currentColor`, so it matches the terminal's up/down palette.
 */
export function Sparkline({
  values,
  width = 60,
  height = 18,
}: {
  values: number[];
  width?: number;
  height?: number;
}) {
  if (values.length < 2) return <span className="text-2xs text-term-dim">—</span>;

  const dir = values[values.length - 1] - values[0];
  const d = sparklinePath(values, width, height);

  return (
    <span className={`inline-flex items-center ${changeClass(dir)}`}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
        <path
          d={d}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.25}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}
