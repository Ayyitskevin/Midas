import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Candle } from '@midas/shared';
import { api } from '@/lib/api';
import { changeClass, fmtPrice, fmtSignedPercent } from '@/lib/format';
import { navigate } from '@/commands/execute';
import { useWatchlist } from '@/store/useWatchlist';
import { Loading } from '@/components/Feedback';
import { computeVolStats, type VolStats } from '@/lib/volatility';
import type { ModuleProps } from './types';

const OPTS = { atrPeriod: 14, periodsPerYear: 365 } as const; // crypto trades 24/7

/** Daily candles (last ~30d) per symbol, refreshed slowly since they barely move intraday. */
function useVolCandles(symbols: string[]): { data: Map<string, Candle[]>; loading: boolean } {
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
            .history(s, '1d', '1mo', controller.signal)
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

type SortKey = 'symbol' | 'changePct' | 'atrPct' | 'realizedVolPct' | 'highLowPct';

const NUM_ACCESS: Record<Exclude<SortKey, 'symbol'>, (s: VolStats) => number | null> = {
  changePct: (s) => s.changePct,
  atrPct: (s) => s.atrPct,
  realizedVolPct: (s) => s.realizedVolPct,
  highLowPct: (s) => s.highLowPct,
};

const pct = (v: number | null): string => (v == null ? '—' : `${v.toFixed(1)}%`);

function Th({ children, onClick, align = 'right' }: { children: ReactNode; onClick: () => void; align?: 'left' | 'right' }) {
  return (
    <th className={`px-2 py-1 font-normal ${align === 'left' ? 'text-left' : 'text-right'}`}>
      <button className="no-drag hover:text-term-text" onClick={onClick}>
        {children}
      </button>
    </th>
  );
}

export function VolatilityModule({ panel }: ModuleProps) {
  const symbols = useWatchlist((s) => s.symbols);
  const { data, loading } = useVolCandles(symbols);
  const [sortKey, setSortKey] = useState<SortKey>('realizedVolPct');
  const [dir, setDir] = useState<1 | -1>(-1);

  const rows = useMemo(() => {
    const list = symbols.map((sym) => ({ sym, stats: computeVolStats(data.get(sym) ?? [], OPTS) }));
    list.sort((a, b) => {
      if (sortKey === 'symbol') return a.sym.localeCompare(b.sym) * dir;
      const av = NUM_ACCESS[sortKey](a.stats);
      const bv = NUM_ACCESS[sortKey](b.stats);
      return ((av ?? -Infinity) - (bv ?? -Infinity)) * dir;
    });
    return list;
  }, [symbols, data, sortKey, dir]);

  const clickHeader = (key: SortKey) => {
    if (key === sortKey) {
      setDir((d) => (d === 1 ? -1 : 1));
    } else {
      setSortKey(key);
      setDir(key === 'symbol' ? 1 : -1);
    }
  };
  const arrow = (key: SortKey) => (key === sortKey ? (dir === -1 ? ' ▾' : ' ▴') : '');

  if (symbols.length === 0) {
    return (
      <div className="p-3 text-2xs text-term-muted">
        Watchlist empty — add symbols in the W panel to rank their volatility.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-term-border px-2 py-1 text-2xs text-term-dim">
        <span>Realized vol &amp; ATR — your watchlist</span>
        <span className="hidden sm:inline">30d daily · ATR14 · annualized</span>
      </div>
      <div className="scroll-term flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-term-panel">
            <tr className="text-2xs text-term-muted">
              <Th onClick={() => clickHeader('symbol')} align="left">
                SYMBOL{arrow('symbol')}
              </Th>
              <th className="px-2 py-1 text-right font-normal">LAST</th>
              <Th onClick={() => clickHeader('changePct')}>30D{arrow('changePct')}</Th>
              <Th onClick={() => clickHeader('realizedVolPct')}>RV%{arrow('realizedVolPct')}</Th>
              <Th onClick={() => clickHeader('atrPct')}>ATR%{arrow('atrPct')}</Th>
              <Th onClick={() => clickHeader('highLowPct')}>RANGE%{arrow('highLowPct')}</Th>
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
                <td className={`px-2 py-1 text-right tabular-nums ${changeClass(stats.changePct)}`}>
                  {stats.changePct == null ? '—' : fmtSignedPercent(stats.changePct)}
                </td>
                <td className="px-2 py-1 text-right tabular-nums text-term-amber">{pct(stats.realizedVolPct)}</td>
                <td className="px-2 py-1 text-right tabular-nums">{pct(stats.atrPct)}</td>
                <td className="px-2 py-1 text-right tabular-nums">{pct(stats.highLowPct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {loading && data.size === 0 && <Loading label="Loading candles" />}
      </div>
    </div>
  );
}
