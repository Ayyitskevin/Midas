import { useEffect, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { changeClass, fmtPrice } from '@/lib/format';
import { computeBasis } from '@/lib/basis';
import { sparklinePath } from '@/lib/sparkline';
import { formatCountdown } from '@/lib/calendar';
import { Loading, ErrorMsg } from '@/components/Feedback';
import type { ModuleProps } from './types';

const HISTORY_CAP = 120; // ~10 min at a 5s sample
const CHART_W = 240;
const CHART_H = 40;

const pct3 = (v: number | null): string => (v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(3)}%`);
const pct2 = (v: number | null): string => (v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`);

function Stat({ label, value, accent, hint }: { label: string; value: ReactNode; accent?: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-sm border border-term-border bg-term-panel/60 px-2 py-1.5">
      <span className="text-2xs uppercase tracking-wide text-term-dim">{label}</span>
      <span className={`font-mono text-sm ${accent ?? 'text-term-text'}`}>{value}</span>
      {hint && <span className="text-2xs text-term-muted">{hint}</span>}
    </div>
  );
}

export function BasisModule({ panel }: ModuleProps) {
  const symbol = panel.symbol;

  const { data, error, loading, refresh } = useFetch(
    (signal) => api.derivatives(symbol!, signal),
    [symbol],
    { intervalMs: 5000, enabled: !!symbol },
  );

  // Rolling, client-side premium history, reset when the symbol changes.
  const [hist, setHist] = useState<{ sym: string; vals: number[] }>({ sym: symbol ?? '', vals: [] });
  useEffect(() => {
    if (!data || !symbol) return;
    const s = computeBasis(data);
    setHist((prev) => {
      const base = prev.sym === symbol ? prev.vals : [];
      if (s.premiumPct == null) return prev.sym === symbol ? prev : { sym: symbol, vals: [] };
      return { sym: symbol, vals: [...base, s.premiumPct].slice(-HISTORY_CAP) };
    });
  }, [data, symbol]);

  if (!symbol) {
    return (
      <div className="p-3 text-2xs text-term-muted">
        Open with a symbol — e.g. <span className="text-term-amber">BTC/USDT PREM</span>.
      </div>
    );
  }
  if (loading && !data) return <Loading label="Loading basis" />;
  if (error && !data) return <ErrorMsg message={error} onRetry={refresh} />;

  const stats = data ? computeBasis(data) : null;

  if (!stats || !stats.valid) {
    return (
      <div className="p-3 text-xs text-term-muted">
        No perpetual / basis data for <span className="text-term-text">{symbol}</span>.
        {stats?.fundingAprPct != null && <div className="mt-1 text-2xs">Funding APR {pct2(stats.fundingAprPct)}</div>}
      </div>
    );
  }

  const vals = hist.sym === symbol ? hist.vals : [];
  const min = vals.length ? Math.min(...vals) : null;
  const max = vals.length ? Math.max(...vals) : null;
  const dir = vals.length >= 2 ? vals[vals.length - 1] - vals[0] : 0;
  const nextMs = data?.nextFundingTime != null ? data.nextFundingTime - Date.now() : null;

  return (
    <div className="no-drag scroll-term flex h-full flex-col gap-2 overflow-y-auto p-2">
      <div className="rounded-sm border border-term-amber/30 bg-term-amber/5 px-3 py-2">
        <div className="text-2xs uppercase tracking-wide text-term-dim">Premium (perp vs spot)</div>
        <div className={`font-mono text-xl ${changeClass(stats.premiumPct)}`}>{pct3(stats.premiumPct)}</div>
        <div className="text-2xs text-term-muted">
          basis {stats.basis! >= 0 ? '+' : '−'}
          {fmtPrice(Math.abs(stats.basis!))} · mark {fmtPrice(stats.mark!)} · index {fmtPrice(stats.index!)}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Stat
          label="Funding rate"
          value={stats.fundingRate == null ? '—' : `${(stats.fundingRate * 100).toFixed(4)}%`}
          accent={changeClass(stats.fundingRate)}
          hint="per interval"
        />
        <Stat label="Funding APR" value={pct2(stats.fundingAprPct)} accent={changeClass(stats.fundingAprPct)} hint="annualized" />
        <Stat label="Mark" value={fmtPrice(stats.mark!)} />
        <Stat label="Index" value={fmtPrice(stats.index!)} />
      </div>

      {nextMs != null && nextMs > 0 && (
        <div className="text-2xs text-term-dim">
          Next funding in <span className="text-term-text">{formatCountdown(nextMs)}</span>
        </div>
      )}

      <div className="rounded-sm border border-term-border p-2">
        <div className="mb-1 flex items-center justify-between text-2xs text-term-dim">
          <span>Premium % · live ({vals.length})</span>
          {min != null && max != null && (
            <span>
              {pct3(min)} … {pct3(max)}
            </span>
          )}
        </div>
        {vals.length >= 2 ? (
          <svg
            width="100%"
            height={CHART_H}
            viewBox={`0 0 ${CHART_W} ${CHART_H}`}
            preserveAspectRatio="none"
            className={changeClass(dir)}
            aria-hidden="true"
          >
            <path
              d={sparklinePath(vals, CHART_W, CHART_H)}
              fill="none"
              stroke="currentColor"
              strokeWidth={1.25}
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        ) : (
          <div className="py-2 text-center text-2xs text-term-muted">Collecting samples…</div>
        )}
      </div>

      <p className="px-1 text-2xs leading-relaxed text-term-dim">
        Positive premium = perp above spot (longs typically pay funding). History is a live rolling window sampled while
        this panel is open.
      </p>
    </div>
  );
}
