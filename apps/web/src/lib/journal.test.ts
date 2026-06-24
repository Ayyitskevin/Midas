import { describe, it, expect } from 'vitest';
import { deriveTrade, computeStats, type JournalTrade } from '@/lib/journal';

let seq = 0;
function trade(p: Partial<JournalTrade>): JournalTrade {
  seq += 1;
  return {
    id: `t${seq}`,
    symbol: 'BTC/USDT',
    side: 'long',
    entry: 100,
    stop: 90,
    exit: null,
    size: null,
    openedAt: 0,
    closedAt: null,
    note: '',
    ...p,
  };
}

describe('deriveTrade', () => {
  it('computes a long R-multiple and dollar P&L', () => {
    const d = deriveTrade(trade({ entry: 100, stop: 90, exit: 120, size: 2 }));
    expect(d.riskPerUnit).toBe(10);
    expect(d.rMultiple).toBe(2); // (120-100)/10
    expect(d.pnl).toBe(40); // (120-100)*2
    expect(d.outcome).toBe('win');
  });

  it('handles a long loss', () => {
    const d = deriveTrade(trade({ entry: 100, stop: 90, exit: 95 }));
    expect(d.rMultiple).toBe(-0.5);
    expect(d.outcome).toBe('loss');
  });

  it('computes a short R-multiple (profit when price falls)', () => {
    const d = deriveTrade(trade({ side: 'short', entry: 100, stop: 110, exit: 80 }));
    expect(d.rMultiple).toBe(2); // -1*(80-100)/10
    expect(d.outcome).toBe('win');
  });

  it('marks a trade with no exit as open', () => {
    const d = deriveTrade(trade({ exit: null }));
    expect(d.outcome).toBe('open');
    expect(d.rMultiple).toBeNull();
    expect(d.pnl).toBeNull();
  });

  it('treats an exit at entry as break-even', () => {
    expect(deriveTrade(trade({ entry: 100, stop: 90, exit: 100 })).outcome).toBe('breakeven');
  });

  it('falls back to P&L sign when risk is zero (entry == stop)', () => {
    const d = deriveTrade(trade({ entry: 100, stop: 100, exit: 110, size: 1 }));
    expect(d.rMultiple).toBeNull();
    expect(d.pnl).toBe(10);
    expect(d.outcome).toBe('win');
  });
});

describe('computeStats', () => {
  it('rolls up win rate, expectancy, profit factor and total R', () => {
    const trades = [
      trade({ entry: 100, stop: 90, exit: 120 }), // +2R win
      trade({ entry: 100, stop: 90, exit: 90 }), //  -1R loss
      trade({ entry: 100, stop: 90, exit: 80 }), //  -2R loss
      trade({ exit: null }), //                       open
    ];
    const s = computeStats(trades);
    expect(s.total).toBe(4);
    expect(s.closed).toBe(3);
    expect(s.open).toBe(1);
    expect(s.wins).toBe(1);
    expect(s.losses).toBe(2);
    expect(s.winRate).toBeCloseTo(1 / 3);
    expect(s.totalR).toBeCloseTo(-1); // 2 - 1 - 2
    expect(s.avgR).toBeCloseTo(-1 / 3);
    expect(s.avgWinR).toBeCloseTo(2);
    expect(s.avgLossR).toBeCloseTo(-1.5);
    expect(s.profitFactor).toBeCloseTo(2 / 3); // 2 / |−3|
  });

  it('sums dollar P&L only when sizes are present', () => {
    expect(computeStats([trade({ exit: 120 })]).totalPnl).toBeNull();
    expect(computeStats([trade({ exit: 120, size: 2 })]).totalPnl).toBe(40);
  });

  it('returns null ratios for an empty or all-open book', () => {
    const empty = computeStats([]);
    expect(empty.winRate).toBeNull();
    expect(empty.avgR).toBeNull();
    expect(empty.profitFactor).toBeNull();
    expect(empty.totalR).toBe(0);

    const allOpen = computeStats([trade({ exit: null }), trade({ exit: null })]);
    expect(allOpen.open).toBe(2);
    expect(allOpen.winRate).toBeNull();
  });

  it('reports no profit factor when there are no losses', () => {
    const s = computeStats([trade({ exit: 120 }), trade({ exit: 110 })]);
    expect(s.wins).toBe(2);
    expect(s.profitFactor).toBeNull();
  });
});
