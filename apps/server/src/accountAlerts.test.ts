import { describe, it, expect } from 'vitest';
import { ACCOUNT_SYMBOL } from '@midas/shared';
import { AlertRepo } from './alerts/repo';
import { evaluateOnce } from './alerts/engine';
import { formatTrigger } from './alerts/notify';
import type { DataProvider } from './providers';

/** Provider stub serving only the account reads the new metrics need. */
function stubProvider(opts: { upnl?: number | null; equity?: number | null; live?: boolean }): DataProvider {
  const live = opts.live ?? true;
  return {
    name: 'stub',
    live: true,
    getQuotes: async () => [],
    getDerivatives: async () => ({ fundingRate: null }),
    getPositions: async () => ({
      source: 'stub',
      provenance: live ? 'live' : 'unavailable',
      note: null,
      totalUnrealizedPnlUsd: opts.upnl ?? null,
      positions:
        opts.upnl == null
          ? []
          : [
              {
                symbol: 'BTC/USDT:USDT', // perp form — rules typed as BTC/USDT must still match
                side: 'long',
                contracts: 1,
                notionalUsd: 60000,
                entryPrice: 60000,
                markPrice: 60150,
                unrealizedPnlUsd: opts.upnl,
                pnlPct: 0.25,
                liquidationPrice: null,
                leverage: 3,
              },
            ],
      asOf: 0,
    }),
    getBalances: async () => ({
      source: 'stub',
      provenance: live ? 'live' : 'unavailable',
      note: null,
      totalValueUsd: opts.equity ?? null,
      balances: [],
      asOf: 0,
    }),
  } as unknown as DataProvider;
}

describe('account-event alerts (upnl / equity)', () => {
  it('fires position-P&L and equity-drift rules from live account reads', async () => {
    const repo = new AlertRepo();
    repo.create({ symbol: 'BTC/USDT', metric: 'upnl', op: 'above', value: 100, repeat: false }, 0);
    repo.create({ symbol: ACCOUNT_SYMBOL, metric: 'equity', op: 'below', value: 900, repeat: false }, 0);

    const fired = await evaluateOnce(repo, stubProvider({ upnl: 150, equity: 850 }), 1000);
    expect(fired).toHaveLength(2);
    const upnl = fired.find((t) => t.metric === 'upnl');
    expect(upnl?.symbol).toBe('BTC/USDT'); // perp suffix bridged to the typed rule
    expect(upnl?.actual).toBe(150);
    const equity = fired.find((t) => t.metric === 'equity');
    expect(equity?.symbol).toBe(ACCOUNT_SYMBOL);
    expect(equity?.actual).toBe(850);
    // Webhook text uses USD units for account metrics, not %.
    expect(formatTrigger(equity!).text).toContain('850 USD');
  });

  it('never fires from a non-live account — rules stay armed through outages', async () => {
    const repo = new AlertRepo();
    repo.create({ symbol: 'BTC/USDT', metric: 'upnl', op: 'above', value: 100, repeat: false }, 0);
    repo.create({ symbol: ACCOUNT_SYMBOL, metric: 'equity', op: 'below', value: 900, repeat: false }, 0);

    const fired = await evaluateOnce(repo, stubProvider({ upnl: 150, equity: 850, live: false }), 1000);
    expect(fired).toHaveLength(0);
    expect(repo.all().every((a) => a.status === 'armed')).toBe(true);
  });
});
