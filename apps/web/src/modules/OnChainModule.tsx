import { useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { fmtCompact, fmtPrice } from '@/lib/format';
import { dexBadge, summarizeDexPools, cexDexBasis, estimatePriceImpactPct, type DexTone } from '@/lib/dexView';
import { Loading, ErrorMsg, EmptyState } from '@/components/Feedback';
import type { ModuleProps } from './types';

const base = (s: string) => s.replace(/\/.*$/, '');

const TONE: Record<DexTone, string> = {
  live: 'border-term-up/50 text-term-up',
  synthetic: 'border-term-amber/50 text-term-amber',
  unavailable: 'border-term-border text-term-dim',
};

export function OnChainModule({ panel }: ModuleProps) {
  const symbol = panel.symbol ?? 'ETH/USDT';
  const [size, setSize] = useState(10_000); // swap size (USD) for the price-impact estimate

  const { data, error, loading, refresh } = useFetch(
    (signal) => api.dexPools(symbol, signal),
    [symbol],
    { intervalMs: 30_000 },
  );

  // Centralized-exchange mid for the same asset, to price the CEX↔DEX basis.
  const cex = useFetch((signal) => api.quote(symbol, signal), [symbol], { intervalMs: 30_000 });

  const summary = useMemo(() => (data ? summarizeDexPools(data.pools) : null), [data]);
  const compare = useMemo(
    () => cexDexBasis(cex.data?.price ?? null, summary?.vwapUsd ?? null),
    [cex.data, summary],
  );
  const badge = data ? dexBadge(data) : null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="font-semibold text-term-text">{base(symbol)}</span>
        <span className="text-term-dim">DEX pools</span>
        <label className="flex items-center gap-1 text-term-dim" title="Swap size (USD) for the price-impact estimate">
          impact $
          <input
            type="number"
            min={0}
            value={size}
            onChange={(e) => setSize(Math.max(0, Number(e.target.value) || 0))}
            className="no-drag w-20 rounded-sm border border-term-border bg-term-panel px-1 py-0.5 text-term-text outline-none focus:border-term-amber"
          />
        </label>
        {badge && (
          <span
            className={`ml-auto rounded-sm border px-1.5 py-0.5 ${TONE[badge.tone]}`}
            title={badge.detail}
          >
            {badge.label}
          </span>
        )}
      </div>

      {/* CEX ↔ DEX basis — what arb the centralized mid and the on-chain VWAP imply. */}
      {compare.basisPct != null && (
        <div className="flex items-center gap-3 border-b border-term-border px-2 py-0.5 text-2xs text-term-dim">
          <span>
            CEX <span className="text-term-text">{compare.cexMid == null ? '—' : fmtPrice(compare.cexMid)}</span>
          </span>
          <span>
            DEX <span className="text-term-text">{compare.dexVwap == null ? '—' : fmtPrice(compare.dexVwap)}</span>
          </span>
          <span>
            basis{' '}
            <span className={compare.basisPct >= 0 ? 'text-term-up' : 'text-term-down'}>
              {compare.basisPct >= 0 ? '+' : ''}
              {compare.basisPct.toFixed(2)}%
            </span>
          </span>
          <span className="ml-auto text-term-dim">DEX vs CEX</span>
        </div>
      )}

      <div className="scroll-term min-h-0 flex-1 overflow-auto">
        {loading && !data ? (
          <Loading label="Loading pools" />
        ) : error && !data ? (
          <ErrorMsg message={error} onRetry={refresh} />
        ) : !data || data.pools.length === 0 ? (
          <EmptyState>{data?.note ?? 'No DEX pools for this asset.'}</EmptyState>
        ) : (
          <table className="w-full text-2xs tabular-nums">
            <thead className="sticky top-0 bg-term-panel">
              <tr className="text-term-muted">
                <th className="px-2 py-1 text-left font-normal">DEX</th>
                <th className="px-2 py-1 text-left font-normal">PAIR</th>
                <th className="px-2 py-1 text-right font-normal">PRICE</th>
                <th className="px-2 py-1 text-right font-normal">LIQUIDITY</th>
                <th className="px-2 py-1 text-right font-normal">24H VOL</th>
                <th className="px-2 py-1 text-right font-normal">FEE</th>
                <th className="px-2 py-1 text-right font-normal" title="Estimated constant-product price impact of the swap size">
                  IMPACT
                </th>
              </tr>
            </thead>
            <tbody>
              {data.pools.map((p, i) => (
                <tr key={`${p.dex}-${p.feeBps}-${i}`} className="border-b border-term-border/20 hover:bg-term-header/40">
                  <td className="px-2 py-0.5 text-term-text">{p.dex}</td>
                  <td className="px-2 py-0.5 text-term-muted">{p.pair}</td>
                  <td className="px-2 py-0.5 text-right">{p.priceUsd == null ? '—' : fmtPrice(p.priceUsd)}</td>
                  <td className="px-2 py-0.5 text-right text-term-muted">
                    {p.liquidityUsd == null ? '—' : `$${fmtCompact(p.liquidityUsd)}`}
                  </td>
                  <td className="px-2 py-0.5 text-right text-term-muted">
                    {p.volume24hUsd == null ? '—' : `$${fmtCompact(p.volume24hUsd)}`}
                  </td>
                  <td className="px-2 py-0.5 text-right text-term-dim">{p.feeBps == null ? '—' : `${p.feeBps}bp`}</td>
                  {(() => {
                    const imp = estimatePriceImpactPct(p.liquidityUsd, size);
                    const cls = imp == null ? 'text-term-dim' : imp < 0.5 ? 'text-term-up' : imp < 2 ? 'text-term-muted' : 'text-term-down';
                    return (
                      <td className={`px-2 py-0.5 text-right ${cls}`}>
                        {imp == null ? '—' : `${imp.toFixed(imp < 1 ? 3 : 2)}%`}
                      </td>
                    );
                  })()}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {summary && summary.poolCount > 0 && (
        <div className="flex flex-wrap items-center gap-3 border-t border-term-border px-2 py-1 text-2xs text-term-dim">
          <span>
            VWAP <span className="text-term-text">{summary.vwapUsd == null ? '—' : fmtPrice(summary.vwapUsd)}</span>
          </span>
          <span>
            TVL <span className="text-term-text">${fmtCompact(summary.totalLiquidityUsd)}</span>
          </span>
          <span>
            24h <span className="text-term-text">${fmtCompact(summary.totalVolume24hUsd)}</span>
          </span>
          {summary.priceSpreadPct != null && (
            <span>
              spread <span className="text-term-text">{summary.priceSpreadPct.toFixed(2)}%</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
