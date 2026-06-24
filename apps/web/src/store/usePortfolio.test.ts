import { describe, it, expect, beforeEach } from 'vitest';
import { usePortfolio } from '@/store/usePortfolio';

/** Reset the singleton store to an empty book. */
function reset(): void {
  usePortfolio.setState({ positions: [], realized: 0, transactions: [] });
}

describe('usePortfolio snapshot/restore', () => {
  beforeEach(reset);

  it('round-trips the book through a JSON snapshot', () => {
    usePortfolio.getState().addTrade('BTC/USDT', 2, 100);
    usePortfolio.getState().addTrade('ETH/USDT', 5, 50);

    const snap = usePortfolio.getState().snapshot();
    expect(snap.positions).toHaveLength(2);
    expect(snap.transactions).toHaveLength(2);

    reset();
    expect(usePortfolio.getState().positions).toHaveLength(0);

    usePortfolio.getState().restore(JSON.parse(JSON.stringify(snap)));
    const after = usePortfolio.getState();
    expect(after.positions.map((p) => p.symbol).sort()).toEqual(['BTC/USDT', 'ETH/USDT']);
    expect(after.transactions).toHaveLength(2);
  });

  it('carries realized P&L across a restore', () => {
    usePortfolio.getState().addTrade('BTC/USDT', 1, 100);
    usePortfolio.getState().addTrade('BTC/USDT', -1, 150); // +50 realized
    const snap = usePortfolio.getState().snapshot();
    expect(snap.realized).toBeCloseTo(50);

    reset();
    usePortfolio.getState().restore(snap);
    expect(usePortfolio.getState().realized).toBeCloseTo(50);
  });

  it('ignores a malformed blob and leaves the book untouched', () => {
    usePortfolio.getState().addTrade('BTC/USDT', 1, 100);
    const before = usePortfolio.getState().positions.length;
    for (const bad of [null, 'nope', 42, undefined]) {
      usePortfolio.getState().restore(bad);
    }
    expect(usePortfolio.getState().positions).toHaveLength(before);
  });

  it('restores an empty (cleared) book', () => {
    usePortfolio.getState().addTrade('BTC/USDT', 1, 100);
    usePortfolio.getState().restore({ realized: 0, positions: [], transactions: [] });
    expect(usePortfolio.getState().positions).toHaveLength(0);
    expect(usePortfolio.getState().transactions).toHaveLength(0);
  });
});
