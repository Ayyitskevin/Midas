import { useState } from 'react';
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

// The swappable set — tickers whose mints + decimals Midas knows, so a quote
// can render a human price. All uppercase, so nothing is case-mangled.
const TOKENS = ['SOL', 'USDC', 'USDT', 'BONK', 'JUP', 'JTO'];

/**
 * SJUP — read-only Jupiter swap quotes. Pick input/output tokens and an amount
 * to see the best-route output, price impact and the AMM hops. QUOTE ONLY:
 * Midas fetches a price estimate and never builds, signs or sends a swap — the
 * non-custodial invariant holds. Live via MIDAS_SOLANA_JUPITER; synthetic in demo.
 */
export function SolanaSwapModule(_props: ModuleProps) {
  const [input, setInput] = useState('SOL');
  const [output, setOutput] = useState('USDC');
  const [draft, setDraft] = useState('1');
  const [amount, setAmount] = useState(1);
  const same = input === output;

  const { data, error, loading, refresh } = useFetch(
    (signal) => api.solanaQuote(input, output, amount, signal),
    [input, output, amount],
    { intervalMs: 30_000, enabled: !same && amount > 0 },
  );
  const badge = data ? solanaBadge(data) : null;

  const commitAmount = () => {
    const n = Number(draft);
    if (Number.isFinite(n) && n > 0) setAmount(n);
  };
  const flip = () => {
    setInput(output);
    setOutput(input);
  };

  const select = (value: string, onChange: (v: string) => void, label: string) => (
    <select
      value={value}
      aria-label={label}
      onChange={(e) => onChange(e.target.value)}
      className="no-drag rounded-sm border border-term-border bg-term-panel px-1 py-0.5 text-term-text outline-none focus:border-term-amber"
    >
      {TOKENS.map((t) => (
        <option key={t} value={t}>
          {t}
        </option>
      ))}
    </select>
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <span className="font-semibold text-term-text">Swap quote</span>
        <span className="text-term-dim">Jupiter · read-only</span>
        {badge && (
          <span className={`ml-auto rounded-sm border px-1.5 py-0.5 ${TONE[badge.tone]}`} title={badge.detail}>
            {badge.label}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 border-b border-term-border px-2 py-1.5 text-2xs">
        <input
          value={draft}
          inputMode="decimal"
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitAmount}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitAmount();
          }}
          aria-label="Input amount"
          className="no-drag w-20 rounded-sm border border-term-border bg-term-panel px-1 py-0.5 text-right text-term-text tabular-nums outline-none focus:border-term-amber"
        />
        {select(input, setInput, 'Input token')}
        <button
          onClick={flip}
          className="no-drag rounded-sm border border-term-border px-1.5 py-0.5 text-term-muted hover:text-term-amber"
          title="Flip direction"
        >
          ⇄
        </button>
        {select(output, setOutput, 'Output token')}
      </div>

      <div className="scroll-term min-h-0 flex-1 overflow-auto p-2">
        {same ? (
          <EmptyState>Pick two different tokens to quote a swap.</EmptyState>
        ) : loading && !data ? (
          <Loading label="Quoting" />
        ) : error && !data ? (
          <ErrorMsg message={error} onRetry={refresh} />
        ) : !data || data.provenance === 'unavailable' ? (
          <EmptyState>{data?.note ?? 'Swap quote unavailable.'}</EmptyState>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline gap-2">
              <span className="text-sm text-term-muted tabular-nums">
                {data.inAmount == null ? '—' : fmtCompact(data.inAmount)} {data.inputSymbol}
              </span>
              <span className="text-term-dim">→</span>
              <span className="text-base font-semibold text-term-up tabular-nums">
                {data.outAmount == null ? '—' : fmtCompact(data.outAmount)} {data.outputSymbol}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-0.5 border border-term-border/40 bg-term-panel/40 px-2 py-1.5">
                <span className="text-2xs uppercase tracking-wide text-term-muted">Price</span>
                <span className="text-sm text-term-text tabular-nums">
                  {data.price == null ? '—' : `${fmtPrice(data.price, data.price < 1 ? 6 : 4)} ${data.outputSymbol}`}
                </span>
              </div>
              <div className="flex flex-col gap-0.5 border border-term-border/40 bg-term-panel/40 px-2 py-1.5">
                <span className="text-2xs uppercase tracking-wide text-term-muted">Price impact</span>
                <span
                  className={`text-sm tabular-nums ${
                    (data.priceImpactPct ?? 0) > 1 ? 'text-term-down' : 'text-term-text'
                  }`}
                >
                  {data.priceImpactPct == null ? '—' : `${data.priceImpactPct.toFixed(3)}%`}
                </span>
              </div>
            </div>
            {data.route.length > 0 && (
              <div className="flex flex-wrap items-center gap-1 text-2xs text-term-muted">
                <span className="text-term-dim">Route</span>
                {data.route.map((h, i) => (
                  <span key={`${h.dex}-${i}`} className="rounded-sm border border-term-border px-1.5 py-0.5">
                    {h.dex}
                    {h.percent != null ? ` ${h.percent}%` : ''}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {data && data.provenance !== 'unavailable' && (
        <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
          {data.slippageBps != null ? `${data.slippageBps} bps slippage · ` : ''}quote only — Midas never signs or sends a swap
        </div>
      )}
    </div>
  );
}
