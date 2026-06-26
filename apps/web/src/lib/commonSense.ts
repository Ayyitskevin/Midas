/**
 * Common-sense ratio (CSR) — a composite that multiplies two complementary
 * "is the shape of the return distribution working for me?" measures:
 *
 *     CSR = tail ratio × gain-to-pain ratio
 *
 * The tail ratio (|p95| / |p5|) looks only at the *wings*: are the big up-days
 * bigger than the big down-days? The gain-to-pain ratio (Σreturns / Σ|losses|)
 * looks at the *whole record*: did the net gains outrun the cumulative pain?
 * Multiplying them rewards a name only when BOTH hold — a fat right tail and an
 * efficient win/loss balance — and punishes a name that wins on one axis while
 * quietly bleeding on the other. A CSR comfortably above 1 is the "common sense"
 * green light; below 1 (or negative, when the record is a net loss) is a warning.
 *
 * Pure composition over the existing tail-ratio and gain-to-pain libs, so the
 * components line up exactly with the TAIL and GPR boards. Pure for unit testing.
 */

import { computeTail } from './tailRatio';
import { computeGpr } from './gainToPain';

export interface CsrRow {
  symbol: string;
  /** tail ratio × gain-to-pain; null when either component is undefined. */
  csr: number | null;
  /** Tail-ratio component (|p95| / |p5|); null on a flat left tail. */
  tailRatio: number | null;
  /** Gain-to-pain component; null when there were no losing periods. */
  gpr: number | null;
  /** Mean period return, for context. */
  meanRet: number;
  /** Returns used. */
  n: number;
}

export type CsrSort = 'csr' | 'tailRatio' | 'gpr' | 'symbol';

export interface CsrInput {
  symbol: string;
  closes: number[];
}

/**
 * Common-sense-ratio stats for one close series. Returns null with fewer than
 * three closes (the tail ratio needs at least three returns). The CSR itself is
 * null when either component is undefined: a flat left tail (tail ratio
 * undefined) or — far more rarely over a real multi-month window — a name with no
 * losing periods at all (gain-to-pain undefined). The tail-ratio and gain-to-pain
 * components are always surfaced for context even when their product is null.
 */
export function computeCsr(closes: number[]): Omit<CsrRow, 'symbol'> | null {
  const tail = computeTail(closes);
  if (!tail) return null; // < 3 closes
  const gp = computeGpr(closes);
  // computeGpr only returns null entirely when closes.length < 2 — unreachable
  // here since tail is non-null (≥ 3 closes). Note gp.gpr can still be null on a
  // no-loss series; that case is handled by the ternary below, not this guard.
  if (!gp) return null;
  const csr =
    tail.tailRatio != null && gp.gpr != null ? tail.tailRatio * gp.gpr : null;
  return { csr, tailRatio: tail.tailRatio, gpr: gp.gpr, meanRet: tail.meanRet, n: tail.n };
}

/** Common-sense-ratio board across a basket, sorted (default CSR descending). */
export function csrBoard(series: CsrInput[], sort: CsrSort = 'csr'): CsrRow[] {
  const rows: CsrRow[] = [];
  for (const s of series) {
    const r = computeCsr(s.closes);
    if (r) rows.push({ symbol: s.symbol, ...r });
  }
  return sortCsr(rows, sort);
}

export function sortCsr(rows: CsrRow[], sort: CsrSort): CsrRow[] {
  // A null CSR or tail ratio is degenerate/uninformative → sinks to the bottom.
  // A null GPR means "no losing periods" — the best case — so under the GPR
  // column it floats to the top, matching the standalone gain-to-pain board.
  const lo = (v: number | null) => (v == null ? -Infinity : v);
  const hi = (v: number | null) => (v == null ? Infinity : v);
  const out = [...rows];
  out.sort((a, b) => {
    switch (sort) {
      case 'symbol':
        return a.symbol.localeCompare(b.symbol);
      case 'tailRatio':
        return lo(b.tailRatio) - lo(a.tailRatio);
      case 'gpr':
        return hi(b.gpr) - hi(a.gpr);
      case 'csr':
      default:
        return lo(b.csr) - lo(a.csr);
    }
  });
  return out;
}
