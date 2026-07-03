import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { fmtCompact, fmtPrice } from '@/lib/format';
import { solanaBadge, SOLANA_TONE_CLASS } from '@/lib/solanaView';
import { Loading, ErrorMsg, EmptyState } from '@/components/Feedback';
import type { ModuleProps } from './types';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 border border-term-border/40 bg-term-panel/40 px-2 py-1">
      <span className="text-2xs uppercase tracking-wide text-term-muted">{label}</span>
      <span className="text-sm text-term-text tabular-nums">{value}</span>
    </div>
  );
}

/**
 * SOLMKT — a read-only Solana ecosystem market overview: SOL's price up top, an
 * aggregate 24h-volume / liquidity roll-up across the busiest tokens, and a
 * compact top-tokens list. The macro companion to STREND's ranked list.
 * Read-only market data; honest live/synthetic/unavailable badge.
 */
export function SolanaMarketModule(_props: ModuleProps) {
  const { data, error, loading, refresh } = useFetch(
    (signal) => api.solanaMarket(signal),
    [],
    { intervalMs: 30_000 },
  );
  const badge = data ? solanaBadge(data) : null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="font-semibold text-term-text">Solana</span>
        <span className="text-term-dim">ecosystem market</span>
        {data?.solPriceUsd != null && (
          <span className="text-term-muted">
            SOL <span className="text-term-text tabular-nums">{fmtPrice(data.solPriceUsd)}</span>
          </span>
        )}
        {badge && (
          <span className={`ml-auto rounded-sm border px-1.5 py-0.5 ${SOLANA_TONE_CLASS[badge.tone]}`} title={badge.detail}>
            {badge.label}
          </span>
        )}
      </div>

      <div className="scroll-term min-h-0 flex-1 overflow-auto">
        {loading && !data ? (
          <Loading label="Loading market" />
        ) : error && !data ? (
          <ErrorMsg message={error} onRetry={refresh} />
        ) : !data || data.provenance === 'unavailable' ? (
          <EmptyState>{data?.note ?? 'Solana market data unavailable.'}</EmptyState>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2 p-2">
              <Stat label="24h volume" value={data.totalVolume24hUsd == null ? '—' : `$${fmtCompact(data.totalVolume24hUsd)}`} />
              <Stat label="Liquidity" value={data.totalLiquidityUsd == null ? '—' : `$${fmtCompact(data.totalLiquidityUsd)}`} />
              <Stat label="Tokens" value={data.tokenCount == null ? '—' : String(data.tokenCount)} />
            </div>
            <table className="w-full text-2xs tabular-nums">
              <thead className="sticky top-0 bg-term-panel">
                <tr className="text-term-muted">
                  <th className="px-2 py-1 text-left font-normal">TOKEN</th>
                  <th className="px-2 py-1 text-right font-normal">PRICE</th>
                  <th className="px-2 py-1 text-right font-normal">24H</th>
                  <th className="px-2 py-1 text-right font-normal">VOL</th>
                  <th className="px-2 py-1 text-right font-normal">LIQ</th>
                </tr>
              </thead>
              <tbody>
                {data.tokens.map((t) => (
                  <tr key={t.symbol} className="border-b border-term-border/20 hover:bg-term-header/40">
                    <td className="px-2 py-0.5 text-term-text">{t.symbol}</td>
                    <td className="px-2 py-0.5 text-right text-term-muted">
                      {t.priceUsd == null ? '—' : fmtPrice(t.priceUsd, t.priceUsd < 0.0001 ? 8 : t.priceUsd < 1 ? 6 : 2)}
                    </td>
                    <td
                      className={`px-2 py-0.5 text-right ${
                        (t.change24hPct ?? 0) >= 0 ? 'text-term-up' : 'text-term-down'
                      }`}
                    >
                      {t.change24hPct == null ? '—' : `${t.change24hPct >= 0 ? '+' : ''}${t.change24hPct.toFixed(1)}%`}
                    </td>
                    <td className="px-2 py-0.5 text-right text-term-dim">
                      {t.volume24hUsd == null ? '—' : `$${fmtCompact(t.volume24hUsd)}`}
                    </td>
                    <td className="px-2 py-0.5 text-right text-term-dim">
                      {t.liquidityUsd == null ? '—' : `$${fmtCompact(t.liquidityUsd)}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

      {data && data.provenance !== 'unavailable' && (
        <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
          Top {data.tokens.length} by 24h volume · read-only market data
        </div>
      )}
    </div>
  );
}
