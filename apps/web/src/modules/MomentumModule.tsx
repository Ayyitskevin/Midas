import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import type { Candle } from '@midas/shared';
import { api } from '@/lib/api';
import { changeClass, fmtPrice, fmtSignedPercent } from '@/lib/format';
import { navigate } from '@/commands/execute';
import { useWatchlist } from '@/store/useWatchlist';
import { Loading } from '@/components/Feedback';
import { computeMomentum, type MomentumStats } from '@/lib/momentum';
import type { ModuleProps } from './types';

/** Daily candles (last ~3 months) per symbol — enough history for a 30d look-back. */
function useDailyCandles(symbols: string[]): { data: Map<string, Candle[]>; loading: boolean } {
  const [data, setData] = useState<Map<string, Candle[]>>(() => new Map());
  const [loading, setLoading] = useState(symbols.length > 0);
  const key = symbols.join(',');
  useEffect(() => {
    if (symbols.length === 0) {
      setData(new Map());
      setLoading(false);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    const load = () => {
      Promise.all(
        symbols.map((s) =>
          api
            .history(s, '1d', '3mo', controller.signal)
            .then((h) => [s, h.candles] as const)
            .catch(() => [s, [] as Candle[]] as const),
        ),
      ).then((entries) => {
        if (!cancelled) {
          setData(new Map(entries));
          setLoading(false);
        }
      });
    };
    load();
    const id = window.setInterval(load, 120_000);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(id);
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return { data, loading };
}

/** Background tint scaled by |return| (saturating at ±20%), tracking the up/down hue. */
function heatStyle(pct: number | null): CSSProperties | undefined {
  if (pct == null || !Number.isFinite(pct)) return undefined;
  const mag = Math.min(Math.abs(pct), 20) / 20;
  if (mag < 0.05) return undefined;
  const rgb = pct >= 0 ? '38,194,129' : '239,77,86';
  return { backgroundColor: `rgba(${rgb},${(mag * 0.3).toFixed(3)})` };
}

type SortKey = 'symbol' | 'r24h' | 'r7d' | 'r30d' | 'score';

const NUM_ACCESS: Record<Exclude<SortKey, 'symbol'>, (s: MomentumStats) => number | null> = {
  r24h: (s) => s.r24h,
  r7d: (s) => s.r7d,
  r30d: (s) => s.r30d,
  score: (s) => s.score,
};

const ret = (v: number | null): string => (v == null ? '—' : fmtSignedPercent(v));

function Th({ children, onClick, align = 'right' }: { children: ReactNode; onClick: () => void; align?: 'left' | 'right' }) {
  return (
    <th className={`px-2 py-1 font-normal ${align === 'left' ? 'text-left' : 'text-right'}`}>
      <button className="no-drag hover:text-term-text" onClick={onClick}>
        {children}
      </button>
    </th>
  );
}

export function MomentumModule({ panel }: ModuleProps) {
  const symbols = useWatchlist((s) => s.symbols);
  const { data, loading } = useDailyCandles(symbols);
  const [sortKey, setSortKey] = useState<SortKey>('score');
  const [dir, setDir] = useState<1 | -1>(-1);

  const rows = useMemo(() => {
    const list = symbols.map((sym) => ({
      sym,
      stats: computeMomentum((data.get(sym) ?? []).map((c) => c.close)),
    }));
    list.sort((a, b) => {
      if (sortKey === 'symbol') return a.sym.localeCompare(b.sym) * dir;
      const av = NUM_ACCESS[sortKey](a.stats);
      const bv = NUM_ACCESS[sortKey](b.stats);
      return ((av ?? -Infinity) - (bv ?? -Infinity)) * dir;
    });
    return list;
  }, [symbols, data, sortKey, dir]);

  const clickHeader = (k: SortKey) => {
    if (k === sortKey) {
      setDir((d) => (d === 1 ? -1 : 1));
    } else {
      setSortKey(k);
      setDir(k === 'symbol' ? 1 : -1);
    }
  };
  const arrow = (k: SortKey) => (k === sortKey ? (dir === -1 ? ' ▾' : ' ▴') : '');

  if (symbols.length === 0) {
    return (
      <div className="p-3 text-2xs text-term-muted">
        Watchlist empty — add symbols in the W panel to rank their momentum.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-term-border px-2 py-1 text-2xs text-term-dim">
        <span>Relative strength — your watchlist</span>
        <span className="hidden sm:inline">daily returns · RS = mean</span>
      </div>
      <div className="scroll-term flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-term-panel">
            <tr className="text-2xs text-term-muted">
              <Th onClick={() => clickHeader('symbol')} align="left">
                SYMBOL{arrow('symbol')}
              </Th>
              <th className="px-2 py-1 text-right font-normal">LAST</th>
              <Th onClick={() => clickHeader('r24h')}>24H{arrow('r24h')}</Th>
              <Th onClick={() => clickHeader('r7d')}>7D{arrow('r7d')}</Th>
              <Th onClick={() => clickHeader('r30d')}>30D{arrow('r30d')}</Th>
              <Th onClick={() => clickHeader('score')}>RS{arrow('score')}</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ sym, stats }) => (
              <tr key={sym} className="border-b border-term-border/30 hover:bg-term-header/60">
                <td className="px-2 py-1">
                  <button
                    className="no-drag font-medium text-term-text hover:text-term-amber"
                    onClick={() => navigate(panel, sym)}
                  >
                    {sym}
                  </button>
                </td>
                <td className="px-2 py-1 text-right tabular-nums">
                  {stats.lastClose > 0 ? fmtPrice(stats.lastClose) : '—'}
                </td>
                <td className={`px-2 py-1 text-right tabular-nums ${changeClass(stats.r24h)}`} style={heatStyle(stats.r24h)}>
                  {ret(stats.r24h)}
                </td>
                <td className={`px-2 py-1 text-right tabular-nums ${changeClass(stats.r7d)}`} style={heatStyle(stats.r7d)}>
                  {ret(stats.r7d)}
                </td>
                <td className={`px-2 py-1 text-right tabular-nums ${changeClass(stats.r30d)}`} style={heatStyle(stats.r30d)}>
                  {ret(stats.r30d)}
                </td>
                <td className={`px-2 py-1 text-right font-medium tabular-nums ${changeClass(stats.score)}`}>
                  {ret(stats.score)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {loading && data.size === 0 && <Loading label="Loading candles" />}
      </div>
    </div>
  );
}
