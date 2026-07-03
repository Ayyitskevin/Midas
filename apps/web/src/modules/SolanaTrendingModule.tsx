import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { fmtCompact, fmtPrice } from '@/lib/format';
import { solanaBadge, type SolanaTone } from '@/lib/solanaView';
import { Loading, ErrorMsg, EmptyState } from '@/components/Feedback';
import type { ModuleProps } from './types';

const TONE: Record<SolanaTone, string> = {
  live: 'border-term-up/50 text-term-up',
  synthetic: 'border-term-amber/50 text-term-amber',
  unavailable: 'border-term-border text-term-dim',
};

/**
 * STREND — trending Solana tokens by 24h volume, from the Solana DeFi markets
 * layer (Raydium/Orca/Meteora via a DEX aggregator). Read-only discovery; honest
 * live/synthetic/unavailable badge (synthetic until MIDAS_DEX_SOURCE is set).
 */
export function SolanaTrendingModule(_props: ModuleProps) {
  const { data, error, loading, refresh } = useFetch(
    (signal) => api.solanaTrending(signal),
    [],
    { intervalMs: 20_000 },
  );
  const badge = data ? solanaBadge(data) : null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="font-semibold text-term-text">Solana</span>
        <span className="text-term-dim">trending · 24h volume</span>
        {badge && (
          <span className={`ml-auto rounded-sm border px-1.5 py-0.5 ${TONE[badge.tone]}`} title={badge.detail}>
            {badge.label}
          </span>
        )}
      </div>

      <div className="scroll-term min-h-0 flex-1 overflow-auto">
        {loading && !data ? (
          <Loading label="Loading trending" />
        ) : error && !data ? (
          <ErrorMsg message={error} onRetry={refresh} />
        ) : !data || data.tokens.length === 0 ? (
          <EmptyState>{data?.note ?? 'No trending Solana tokens.'}</EmptyState>
        ) : (
          <table className="w-full text-2xs tabular-nums">
            <thead className="sticky top-0 bg-term-panel">
              <tr className="text-term-muted">
                <th className="px-2 py-1 text-left font-normal">#</th>
                <th className="px-2 py-1 text-left font-normal">TOKEN</th>
                <th className="px-2 py-1 text-right font-normal">PRICE</th>
                <th className="px-2 py-1 text-right font-normal">24H%</th>
                <th className="px-2 py-1 text-right font-normal">24H VOL</th>
                <th className="px-2 py-1 text-right font-normal">LIQUIDITY</th>
                <th className="px-2 py-1 text-left font-normal">DEX</th>
              </tr>
            </thead>
            <tbody>
              {data.tokens.map((t, i) => (
                <tr key={`${t.symbol}-${i}`} className="border-b border-term-border/20 hover:bg-term-header/40">
                  <td className="px-2 py-0.5 text-term-dim">{i + 1}</td>
                  <td className="px-2 py-0.5 text-term-text" title={t.pair}>
                    {t.symbol}
                  </td>
                  <td className="px-2 py-0.5 text-right">
                    {t.priceUsd == null ? '—' : fmtPrice(t.priceUsd, t.priceUsd < 0.0001 ? 8 : t.priceUsd < 1 ? 6 : 2)}
                  </td>
                  <td
                    className={`px-2 py-0.5 text-right ${
                      t.change24hPct == null ? 'text-term-dim' : t.change24hPct >= 0 ? 'text-term-up' : 'text-term-down'
                    }`}
                  >
                    {t.change24hPct == null ? '—' : `${t.change24hPct >= 0 ? '+' : ''}${t.change24hPct.toFixed(1)}%`}
                  </td>
                  <td className="px-2 py-0.5 text-right text-term-muted">
                    {t.volume24hUsd == null ? '—' : `$${fmtCompact(t.volume24hUsd)}`}
                  </td>
                  <td className="px-2 py-0.5 text-right text-term-muted">
                    {t.liquidityUsd == null ? '—' : `$${fmtCompact(t.liquidityUsd)}`}
                  </td>
                  <td className="px-2 py-0.5 text-term-dim">{t.dex}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
