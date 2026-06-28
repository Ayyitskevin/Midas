import { useMemo, useState } from 'react';
import type { Interval, Range } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useWatchlist } from '@/store/useWatchlist';
import { vrsiBoard, type VrsiSort, type VrsiZone, type VrsiDir } from '@/lib/vrsi';
import { navigate } from '@/commands/execute';
import { EmptyState, Loading, ErrorMsg } from '@/components/Feedback';
import type { ModuleProps } from './types';

const MAX = 24;
const base = (sym: string) => sym.replace(/\/.*$/, '');

const INTERVAL: Interval = '1d';
const RANGE: Range = '1y';

// Vervoort's default is 4 bars for both the RSI and the zero-lag EMA; 8 is a smoother read.
const PRESETS: { label: string; rsi: number; zl: number }[] = [
  { label: '4', rsi: 4, zl: 4 },
  { label: '8', rsi: 8, zl: 8 },
];

const ZONE_LABEL: Record<VrsiZone, string> = { overbought: 'OB', oversold: 'OS', neutral: '–' };
const zoneClass = (z: VrsiZone) =>
  z === 'oversold' ? 'text-term-up' : z === 'overbought' ? 'text-term-down' : 'text-term-muted';

const DIR_GLYPH: Record<VrsiDir, string> = { up: '▲', down: '▼', flat: '–' };
const dirClass = (d: VrsiDir) =>
  d === 'up' ? 'text-term-up' : d === 'down' ? 'text-term-down' : 'text-term-muted';

function SortHead({
  col,
  label,
  align,
  sort,
  onSort,
}: {
  col: VrsiSort;
  label: string;
  align: 'left' | 'right';
  sort: VrsiSort;
  onSort: (c: VrsiSort) => void;
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

export function VrsiModule({ panel }: ModuleProps) {
  const watchlist = useWatchlist((s) => s.symbols);
  const [presetIdx, setPresetIdx] = useState(0); // default 4/4 (Vervoort)
  const [sort, setSort] = useState<VrsiSort>('vrsi');
  const preset = PRESETS[presetIdx];

  const fetchSyms = useMemo(() => watchlist.slice(0, MAX), [watchlist]);

  const { data, error, loading, refresh } = useFetch(
    (signal) =>
      Promise.all(
        fetchSyms.map((s) =>
          api
            .history(s, INTERVAL, RANGE, signal)
            .then((h) => ({ symbol: s, closes: h.candles.map((c) => c.close) }))
            .catch(() => ({ symbol: s, closes: [] as number[] })),
        ),
      ),
    [fetchSyms.join(',')],
    { enabled: watchlist.length > 0 },
  );

  const rows = useMemo(
    () => (data ? vrsiBoard(data, sort, preset.rsi, preset.zl) : []),
    [data, sort, preset.rsi, preset.zl],
  );

  if (watchlist.length === 0) {
    return <EmptyState>Add watchlist symbols (W) to screen the Vervoort RSI.</EmptyState>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="text-term-dim">Vervoort RSI · iFisher · {preset.label}/{preset.label}</span>
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
          <EmptyState>Not enough history for the Vervoort RSI.</EmptyState>
        ) : (
          <table className="w-full text-2xs tabular-nums">
            <thead className="sticky top-0 bg-term-panel">
              <tr>
                <SortHead col="symbol" label="SYMBOL" align="left" sort={sort} onSort={setSort} />
                <SortHead col="vrsi" label="VRSI" align="right" sort={sort} onSort={setSort} />
                <th className="px-2 py-1 text-center font-normal text-term-muted">DIR</th>
                <th className="px-2 py-1 text-center font-normal text-term-muted">ZONE</th>
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
                  <td className={`px-2 py-0.5 text-right font-semibold ${zoneClass(r.zone)}`}>
                    {r.vrsi.toFixed(3)}
                  </td>
                  <td className={`px-2 py-0.5 text-center ${dirClass(r.dir)}`}>{DIR_GLYPH[r.dir]}</td>
                  <td className={`px-2 py-0.5 text-center ${zoneClass(r.zone)}`}>{ZONE_LABEL[r.zone]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
        VRSI = inverse-Fisher of a smoothed RSI · (−1…+1) ·{' '}
        <span className="text-term-down">≥ +0.5 overbought</span> /{' '}
        <span className="text-term-up">≤ −0.5 oversold</span> · ▲▼ = rising / falling
      </div>
    </div>
  );
}
