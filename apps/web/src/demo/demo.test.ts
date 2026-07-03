import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  DEMO_SYMBOLS,
  balancesFor,
  historyFor,
  orderBookFor,
  quoteFor,
  screenerRows,
  solanaDexPoolsFor,
  solanaNetworkFor,
  solanaTrendingFor,
  solanaWalletFor,
} from './engine';
import { installDemoShim } from './shim';

const NOW = 1_780_000_000_000; // fixed wall clock for determinism

describe('demo engine', () => {
  it('is deterministic: the same instant yields the same world', () => {
    expect(quoteFor('BTC/USDT', NOW)).toEqual(quoteFor('BTC/USDT', NOW));
    expect(historyFor('ETH/USDT', '1h', '5d', NOW)).toEqual(historyFor('ETH/USDT', '1h', '5d', NOW));
  });

  it('prices actually move between polls', () => {
    const a = quoteFor('BTC/USDT', NOW)!.price;
    const b = quoteFor('BTC/USDT', NOW + 60_000)!.price;
    expect(a).not.toBe(b);
    expect(Math.abs(b / a - 1)).toBeLessThan(0.05); // moves, but not absurdly
  });

  it('candles are well-formed: ascending time, high ≥ open/close ≥ low', () => {
    const h = historyFor('SOL/USDT', '1h', '1mo', NOW)!;
    expect(h.candles.length).toBeGreaterThan(100);
    for (let i = 0; i < h.candles.length; i++) {
      const c = h.candles[i];
      expect(c.high).toBeGreaterThanOrEqual(Math.max(c.open, c.close));
      expect(c.low).toBeLessThanOrEqual(Math.min(c.open, c.close));
      if (i > 0) expect(c.time).toBeGreaterThan(h.candles[i - 1].time);
    }
  });

  it('order books are sorted and crossed-free', () => {
    const b = orderBookFor('BTC/USDT', 20, NOW)!;
    expect(b.bids[0].price).toBeLessThan(b.asks[0].price);
    for (let i = 1; i < b.bids.length; i++) expect(b.bids[i].price).toBeLessThan(b.bids[i - 1].price);
    for (let i = 1; i < b.asks.length; i++) expect(b.asks[i].price).toBeGreaterThan(b.asks[i - 1].price);
  });

  it('unknown symbols are honestly null; account data is labeled synthetic', () => {
    expect(quoteFor('NOPE/USDT', NOW)).toBeNull();
    const bal = balancesFor(NOW);
    expect(bal.provenance).toBe('synthetic');
    expect(bal.note).toMatch(/Static demo/);
    expect(bal.totalValueUsd).toBeGreaterThan(0);
  });

  it('screener covers the universe and sorts', () => {
    const rows = screenerRows('USDT', 'gainers', 10, NOW);
    expect(rows).toHaveLength(10);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].changePercent).toBeLessThanOrEqual(rows[i - 1].changePercent);
    }
    expect(DEMO_SYMBOLS.length).toBeGreaterThanOrEqual(30);
  });

  it('Solana network is labeled synthetic with sane bounds', () => {
    const n = solanaNetworkFor(NOW);
    expect(n.provenance).toBe('synthetic');
    expect(n.note).toMatch(/Static demo/);
    expect(n.epochProgressPct!).toBeGreaterThanOrEqual(0);
    expect(n.epochProgressPct!).toBeLessThanOrEqual(100);
    expect(n.solPriceUsd!).toBeGreaterThan(0);
  });

  it('Solana wallet is synthetic and seeded on the address (stable holdings)', () => {
    const addr = 'So11111111111111111111111111111111111111112';
    const a = solanaWalletFor(addr, NOW);
    const b = solanaWalletFor(addr, NOW + 60_000);
    expect(a.provenance).toBe('synthetic');
    expect(a.note).toMatch(/Static demo/);
    expect(a.tokens.length).toBeGreaterThan(0);
    // Holdings seeded on the address: amounts stable across time, addresses differ.
    expect(a.tokens.map((t) => t.amount)).toEqual(b.tokens.map((t) => t.amount));
    expect(a.solBalance).toBe(b.solBalance);
    expect(solanaWalletFor('DifferentAddr1111111111111111111111111111111', NOW).solBalance).not.toBe(a.solBalance);
  });

  it('Solana trending is synthetic and sorted by 24h volume', () => {
    const t = solanaTrendingFor(NOW);
    expect(t.provenance).toBe('synthetic');
    expect(t.note).toMatch(/Static demo/);
    expect(t.tokens.length).toBeGreaterThan(5);
    for (let i = 1; i < t.tokens.length; i++) {
      expect(t.tokens[i].volume24hUsd!).toBeLessThanOrEqual(t.tokens[i - 1].volume24hUsd!);
    }
  });

  it('Solana DEX pools are synthetic; unknown asset is honestly unavailable', () => {
    const pools = solanaDexPoolsFor('SOL/USDT', NOW);
    expect(pools.provenance).toBe('synthetic');
    expect(pools.pools.map((p) => p.dex)).toContain('Raydium');
    expect(solanaDexPoolsFor('NOPE/USDT', NOW).provenance).toBe('unavailable');
  });
});

describe('demo shim', () => {
  const realFetch = window.fetch;
  const realGlobalFetch = globalThis.fetch;
  afterEach(() => {
    window.fetch = realFetch;
    globalThis.fetch = realGlobalFetch;
    (window as unknown as { __MIDAS_STATIC_DEMO__?: boolean }).__MIDAS_STATIC_DEMO__ = undefined;
  });

  it('answers /api/* in-browser and passes other requests through', async () => {
    const passthrough = vi.fn(async () => new Response('outside'));
    window.fetch = passthrough as typeof fetch;
    installDemoShim();

    const health = await (await fetch('/api/health')).json();
    expect(health.demo).toBe(true);
    expect(health.provider).toBe('demo');

    const quote = await (await fetch('/api/quote/BTC%2FUSDT')).json();
    expect(quote.symbol).toBe('BTC/USDT');

    await fetch('https://example.com/other');
    expect(passthrough).toHaveBeenCalledTimes(1); // only the non-API request
  });

  it('refuses writes and unsupported surfaces with honest 501s', async () => {
    window.fetch = vi.fn(async () => new Response('x')) as typeof fetch;
    installDemoShim();
    const order = await fetch('/api/orders', { method: 'POST', body: '{}' });
    expect(order.status).toBe(501);
    expect((await order.json()).message).toMatch(/deploy your own/i);
    const keys = await fetch('/api/account/keys');
    expect(keys.status).toBe(501);
    const trading = await (await fetch('/api/trading/status')).json();
    expect(trading.enabled).toBe(false);
    expect(trading.reason).toMatch(/static demo/i);
  });

  it('sets the flag stream.ts uses to stay offline', () => {
    window.fetch = vi.fn() as unknown as typeof fetch;
    installDemoShim();
    expect((window as unknown as { __MIDAS_STATIC_DEMO__?: boolean }).__MIDAS_STATIC_DEMO__).toBe(true);
  });

  it('answers the Solana endpoints in-browser', async () => {
    window.fetch = vi.fn(async () => new Response('x')) as typeof fetch;
    installDemoShim();
    const net = await (await fetch('/api/solana/network')).json();
    expect(net.provenance).toBe('synthetic');
    expect(typeof net.slot).toBe('number');
    const wal = await (await fetch('/api/solana/wallet/So11111111111111111111111111111111111111112')).json();
    expect(wal.provenance).toBe('synthetic');
    expect(wal.address).toBe('So11111111111111111111111111111111111111112'); // case preserved via seg(4)
    const trend = await (await fetch('/api/solana/trending')).json();
    expect(trend.provenance).toBe('synthetic');
    expect(trend.tokens.length).toBeGreaterThan(0);
    const pools = await (await fetch('/api/solana/pools/SOL%2FUSDT')).json();
    expect(pools.provenance).toBe('synthetic');
    expect(pools.symbol).toBe('SOL');
  });
});
