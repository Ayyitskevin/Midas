import { useMemo, useState } from 'react';
import type { Interval, Range } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useWatchlist } from '@/store/useWatchlist';
import { stochasticBoard, type StochSort, type StochZone, type StochCross } from '@/lib/stochastic';
import { navigate } from '@/commands/execute';
import { EmptyState, Loading, ErrorMsg } from '@/components/Feedback';
import type { ModuleProps } from './types';

const MAX = 24;
const base = (sym: string) => sym.replace(/\/.*$/, '');

const INTERVAL: Interval = '1d';
const RANGE: Range = '1y';

const PRESETS: { label: string; period: number; smoothK: number; smoothD: number }[] = [
  { label: '14·3·3', period: 14, smoothK: 3, smoothD: 3 }, // slow stochastic
  { label: '14·1·3', period: 14, smoothK: 1, smoothD: 3 }, // fast stochastic
];

const ZONE_LABEL: Record<StochZone, string> = { overbought: 'OB', oversold: 'OS', neutral: '·' };
const zoneColor = (zone: StochZone) =>
  zone === 'overbought' ? 'text-term-down' : zone === 'oversold' ? 'text-term-up' : 'text-term-text';

function SortHead({
  col,
  label,
  align,
  sort,
  onSort,
}: {
  col: StochSort;
  label: string;
  align: 'left' | 'right';
  sort: StochSort;
  onSort: (c: StochSort) => void;
}) {
  return (
    <th className={`px-2 py-1 font-normal ${align === 'right' ? 'text-right' : 'text-left'}`}>
      <button
        onClick={() => onSort(col)}
        className={`no-drag hover:text-term-amber ${sort === col ? 'text-term-amber' : 'text-term-muted'}`}
      >
        {label}
      </button>
    </th>
  );
}

function CrossCell({ cross }: { cross: StochCross }) {
  if (cross === 'bull') return <span className="text-term-up">↑</span>;
  if (cross === 'bear') return <span className="text-term-down">↓</span>;
  return <span className="text-term-dim">·</span>;
}

export function StochasticModule({ panel }: ModuleProps) {
  const watchlist = useWatchlist((s) => s.symbols);
  const [presetIdx, setPresetIdx] = useState(0); // default 14·3·3 (slow)
  const [sort, setSort] = useState<StochSort>('k');
  const preset = PRESETS[presetIdx];

  const fetchSyms = useMemo(() => watchlist.slice(0, MAX), [watchlist]);

  const { data, error, loading, refresh } = useFetch(
    (signal) =>
      Promise.all(
        fetchSyms.map((s) =>
          api
            .history(s, INTERVAL, RANGE, signal)
            .then((h) => ({
              symbol: s,
              bars: h.candles.map((c) => ({ high: c.high, low: c.low, close: c.close })),
            }))
            .catch(() => ({ symbol: s, bars: [] as { high: number; low: number; close: number }[] })),
        ),
      ),
    [fetchSyms.join(',')],
    { enabled: watchlist.length > 0 },
  );

  const rows = useMemo(
    () => (data ? stochasticBoard(data, sort, preset.period, preset.smoothK, preset.smoothD) : []),
    [data, sort, preset.period, preset.smoothK, preset.smoothD],
  );

  if (watchlist.length === 0) {
    return <EmptyState>Add watchlist symbols (W) to screen the Stochastic oscillator.</EmptyState>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="text-term-dim">Stochastic · %K/%D · {preset.label}</span>
        <div className="ml-auto flex gap-1">
          {PRESETS.map((p, i) => (
            <button
              key={p.label}
              onClick={() => setPresetIdx(i)}
              className={`no-drag rounded-sm px-1.5 py-0.5 ${
                i === presetIdx ? 'bg-term-amber/20 text-term-amber' : 'text-term-muted hover:text-term-text'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="scroll-term min-h-0 flex-1 overflow-auto">
        {loading && !data ? (
          <Loading label="Loading history" />
        ) : error && !data ? (
          <ErrorMsg message={error} onRetry={refresh} />
        ) : rows.length === 0 ? (
          <EmptyState>Not enough history to compute the Stochastic oscillator.</EmptyState>
        ) : (
          <table className="w-full text-2xs tabular-nums">
            <thead className="sticky top-0 bg-term-panel">
              <tr>
                <SortHead col="symbol" label="SYMBOL" align="left" sort={sort} onSort={setSort} />
                <SortHead col="k" label="%K" align="right" sort={sort} onSort={setSort} />
                <SortHead col="d" label="%D" align="right" sort={sort} onSort={setSort} />
                <th className="px-2 py-1 text-right font-normal text-term-muted">ZONE</th>
                <th className="px-2 py-1 text-right font-normal text-term-muted">CRS</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.symbol} className="border-b border-term-border/20 hover:bg-term-header/40">
                  <td className="px-2 py-0.5 text-left">
                    <button
                      onClick={() => navigate(panel, r.symbol)}
                      className="no-drag text-term-text hover:text-term-amber"
                    >
                      {base(r.symbol)}
                    </button>
                  </td>
                  <td className={`px-2 py-0.5 text-right font-semibold ${zoneColor(r.zone)}`}>{r.k.toFixed(0)}</td>
                  <td className="px-2 py-0.5 text-right text-term-muted">{r.d.toFixed(0)}</td>
                  <td className={`px-2 py-0.5 text-right ${zoneColor(r.zone)}`}>{ZONE_LABEL[r.zone]}</td>
                  <td className="px-2 py-0.5 text-right">
                    <CrossCell cross={r.cross} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
        %K = close in its {preset.period}-bar range · %D = signal · <span className="text-term-down">≥80 OB</span> ·{' '}
        <span className="text-term-up">≤20 OS</span> · CRS <span className="text-term-up">↑</span>/
        <span className="text-term-down">↓</span> = %K crossed %D
      </div>
    </div>
  );
}
