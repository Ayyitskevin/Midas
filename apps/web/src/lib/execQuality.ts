import type { AccountFill } from '@midas/shared';
import { fillSlippageBps, type FillBaseline } from './postTradeSlippage';

/**
 * Execution quality (XQL): what your fills actually cost you — maker/taker
 * mix, fees, and realized slippage vs the TICKET estimates recorded in this
 * browser. Pure aggregation over the FILLS data; anything unknowable stays
 * null (no M/T reported → no maker %, no baseline → no slippage claim).
 */

export interface SymbolQuality {
  symbol: string;
  fills: number;
  /** Σ fill cost (quote notional). */
  notional: number;
  /** Notional-weighted realized slippage vs baseline; null when uncovered. */
  avgSlipBps: number | null;
}

export interface ExecQuality {
  fills: number;
  notional: number;
  /** % of M/T-labeled fills that were maker; null when no venue labels. */
  makerPct: number | null;
  /** Fee totals grouped by currency, largest first ('?' = currency unknown). */
  feeTotals: Array<{ currency: string; total: number }>;
  /** Notional-weighted avg slippage across baseline-covered fills. */
  avgSlipBps: number | null;
  /** % of total notional that has a placement baseline (honest coverage). */
  slipCoveragePct: number;
  /** Largest notional first. */
  bySymbol: SymbolQuality[];
}

export function computeExecQuality(
  fills: AccountFill[],
  baselines: Record<string, FillBaseline>,
): ExecQuality {
  let notional = 0;
  let makerKnown = 0;
  let makerCount = 0;
  const fees = new Map<string, number>();
  let slipWeight = 0;
  let slipSum = 0; // Σ (bps × notional)
  const symbols = new Map<string, { fills: number; notional: number; slipWeight: number; slipSum: number }>();

  for (const f of fills) {
    notional += f.cost;
    if (f.takerOrMaker === 'maker' || f.takerOrMaker === 'taker') {
      makerKnown += 1;
      if (f.takerOrMaker === 'maker') makerCount += 1;
    }
    if (f.fee != null) {
      const cur = f.feeCurrency ?? '?';
      fees.set(cur, (fees.get(cur) ?? 0) + f.fee);
    }
    const sym = symbols.get(f.symbol) ?? { fills: 0, notional: 0, slipWeight: 0, slipSum: 0 };
    sym.fills += 1;
    sym.notional += f.cost;
    const slip = fillSlippageBps(f, baselines);
    if (slip != null && f.cost > 0) {
      slipWeight += f.cost;
      slipSum += slip * f.cost;
      sym.slipWeight += f.cost;
      sym.slipSum += slip * f.cost;
    }
    symbols.set(f.symbol, sym);
  }

  return {
    fills: fills.length,
    notional,
    makerPct: makerKnown > 0 ? (makerCount / makerKnown) * 100 : null,
    feeTotals: [...fees.entries()]
      .map(([currency, total]) => ({ currency, total }))
      .sort((a, z) => z.total - a.total),
    avgSlipBps: slipWeight > 0 ? slipSum / slipWeight : null,
    slipCoveragePct: notional > 0 ? (slipWeight / notional) * 100 : 0,
    bySymbol: [...symbols.entries()]
      .map(([symbol, s]) => ({
        symbol,
        fills: s.fills,
        notional: s.notional,
        avgSlipBps: s.slipWeight > 0 ? s.slipSum / s.slipWeight : null,
      }))
      .sort((a, z) => z.notional - a.notional),
  };
}
