import { describe, it, expect, afterEach, vi } from 'vitest';
import { validateDataReceipt } from '@midas/shared';
import {
  DEMO_SYMBOLS,
  balancesFor,
  boardEnvelope,
  derivativesFor,
  dvolFor,
  fillsFor,
  fundingDispersionRows,
  fundingRows,
  historyFor,
  liquidationsFeed,
  newsFor,
  oiDeltaFor,
  optionsChainFor,
  orderBookFor,
  quoteFor,
  screenerRows,
  solanaDexPoolsFor,
  solanaMarketFor,
  solanaNetworkFor,
  solanaQuoteFor,
  solanaStakingFor,
  solanaTokenFor,
  solanaTrendingFor,
  solanaValidatorsFor,
  solanaWalletFor,
  termStructureFor,
  venueArbRows,
  venueDerivatives,
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

  it('labels its liquidations feed synthetic — it surfaces events but is never "live"', () => {
    const feed = liquidationsFeed('USDT', 30, NOW);
    expect(feed.events.length).toBeGreaterThan(0); // the demo does show events...
    expect(feed.meta.synthetic).toBe(true); // ...but they are honestly flagged synthetic
    expect(feed.meta.source).toBe('demo');
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

  it('screener sorts by price when the PRICE column is chosen (not volume order)', () => {
    // The Screener panel offers a PRICE sort; the engine must mirror the server's
    // sortScreener price branch rather than silently falling back to volume order.
    const rows = screenerRows('USDT', 'price', 30, NOW);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].price).toBeLessThanOrEqual(rows[i - 1].price);
    }
  });

  it('derivatives carry a deterministic funding interval, mirroring the server mock', () => {
    // SOL funds hourly, DOGE on a 4h cadence, everything else 8h — the same
    // cadences as apps/server/src/providers/mock/derivatives.ts. Without the
    // interval the funding-dispersion compute excludes the venue entirely.
    expect(derivativesFor('SOL/USDT', NOW)!.fundingIntervalHours).toBe(1);
    expect(derivativesFor('DOGE/USDT', NOW)!.fundingIntervalHours).toBe(4);
    expect(derivativesFor('BTC/USDT', NOW)!.fundingIntervalHours).toBe(8);
    // The next settlement respects the cadence (an hourly perp settles within the hour).
    const sol = derivativesFor('SOL/USDT', NOW)!;
    expect(sol.nextFundingTime! - NOW).toBeLessThanOrEqual(3_600_000);
    // …and every venue row carries the interval too.
    expect(venueDerivatives('SOL/USDT', NOW).every((v) => v.fundingIntervalHours === 1)).toBe(true);
  });

  it('the funding-dispersion board is non-empty (venues are not dropped for an unknown interval)', () => {
    const rows = fundingDispersionRows('USDT', 15, NOW);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.spreadBps).not.toBeNull();
      expect(r.venues.length).toBeGreaterThanOrEqual(2);
    }
    // Funding rows on the plain funding board carry the interval label too.
    expect(fundingRows('USDT', 30, NOW).find((r) => r.symbol === 'SOL/USDT')!.fundingIntervalHours).toBe(1);
  });

  it('boardEnvelope mirrors the server shape: synthetic, real asOf, cachedAt null, partial false', () => {
    const env = boardEnvelope(venueArbRows('USDT', 5, NOW), NOW);
    expect(env.rows.length).toBeGreaterThan(0);
    expect(env.meta.provenance).toBe('synthetic');
    expect(env.meta.source).toBe('demo');
    expect(env.meta.asOf).toBe(NOW);
    expect(env.meta.cachedAt).toBeNull();
    expect(env.meta.partial).toBe(false);
    expect(env.meta.note).toMatch(/Static demo/);
  });

  it('history resolves unknown interval/range to the server defaults (1d / 6mo)', () => {
    const h = historyFor('BTC/USDT', 'bogus', 'nonsense', NOW)!;
    expect(h.interval).toBe('1d');
    expect(h.range).toBe('6mo');
    // A valid pair is echoed back unchanged (isInterval/isRange parity).
    const ok = historyFor('BTC/USDT', '1h', '5d', NOW)!;
    expect(ok.interval).toBe('1h');
    expect(ok.range).toBe('5d');
  });

  it('order book honours the server depth cap (100) and floor (5)', () => {
    expect(orderBookFor('BTC/USDT', 200, NOW)!.bids).toHaveLength(100);
    expect(orderBookFor('BTC/USDT', 1, NOW)!.bids).toHaveLength(5);
  });

  it('fills are symbol-scoped like the server, and unscoped returns everything', () => {
    expect(fillsFor(NOW).fills.length).toBe(3);
    const sol = fillsFor(NOW, 'SOL/USDT').fills;
    expect(sol.length).toBe(2);
    expect(sol.every((f) => f.symbol === 'SOL/USDT')).toBe(true);
    expect(fillsFor(NOW, 'BTC/USDT').fills.length).toBe(0); // no BTC fill in the synthetic set
  });

  it('news is scoped to the requested symbol; an absent symbol defaults to BTC', () => {
    expect(newsFor('ETH/USDT', NOW)[0].title).toContain('ETH');
    expect(newsFor(undefined, NOW)[0].title).toContain('BTC');
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

  it('Solana validators are synthetic, ranked by stake, shares ~100%', () => {
    const v = solanaValidatorsFor(NOW);
    expect(v.provenance).toBe('synthetic');
    expect(v.validators.length).toBeGreaterThan(5);
    for (let i = 1; i < v.validators.length; i++) {
      expect(v.validators[i].activatedStakeSol!).toBeLessThanOrEqual(v.validators[i - 1].activatedStakeSol!);
    }
    const shareSum = v.validators.reduce((s, x) => s + (x.stakeSharePct ?? 0), 0);
    expect(shareSum).toBeGreaterThan(95);
    expect(shareSum).toBeLessThan(105);
  });

  it('Solana staking is synthetic with sane APY bounds', () => {
    const s = solanaStakingFor(NOW);
    expect(s.provenance).toBe('synthetic');
    expect(s.nominalApyPct!).toBeGreaterThan(4);
    expect(s.realApyPct!).toBeGreaterThanOrEqual(s.nominalApyPct!);
  });

  it('SPL token is synthetic; a known mint is labeled and stable-priced', () => {
    const t = solanaTokenFor('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', NOW);
    expect(t.provenance).toBe('synthetic');
    expect(t.symbol).toBe('USDC');
    expect(t.decimals).toBe(6);
    expect(t.supply!).toBeGreaterThan(0);
    expect(t.priceUsd).toBe(1);
    // Seeded on the mint → the authorities are stable across time.
    expect(solanaTokenFor('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', NOW + 60_000).mintAuthorityActive).toBe(
      t.mintAuthorityActive,
    );
  });

  it('Solana swap quote is synthetic; identical tokens are honestly null', () => {
    const q = solanaQuoteFor('SOL', 'USDC', 1, NOW);
    expect(q.provenance).toBe('synthetic');
    expect(q.inAmount).toBe(1);
    expect(q.outAmount!).toBeGreaterThan(0);
    expect(q.priceImpactPct!).toBeGreaterThanOrEqual(0);
    expect(q.route.length).toBeGreaterThan(0);
    expect(solanaQuoteFor('SOL', 'SOL', 1, NOW).outAmount).toBeNull();
  });

  it('Solana market overview is synthetic, sorted by volume, with a SOL price', () => {
    const m = solanaMarketFor(NOW);
    expect(m.provenance).toBe('synthetic');
    expect(m.solPriceUsd!).toBeGreaterThan(0);
    expect(m.tokens.length).toBeGreaterThan(0);
    for (let i = 1; i < m.tokens.length; i++) {
      expect(m.tokens[i].volume24hUsd!).toBeLessThanOrEqual(m.tokens[i - 1].volume24hUsd!);
    }
  });

  it('DVOL is deterministic, synthetic and carries a 30-day history', () => {
    const a = dvolFor('BTC', NOW);
    expect({ ...a, asOf: 0 }).toEqual({ ...dvolFor('BTC', NOW), asOf: 0 });
    expect(a.provenance).toBe('synthetic');
    expect(a.source).toBe('demo');
    expect(typeof a.note).toBe('string');
    expect(a.value!).toBeGreaterThan(10);
    expect(a.value!).toBeLessThan(150);
    expect(a.history).toHaveLength(30);
    // ETH vols sit above BTC's in the fixture, like the server mock.
    expect(dvolFor('ETH', NOW).value!).toBeGreaterThan(a.value! - 25);
  });

  it('term structure is a synthetic contango curve, nearest-first, priced off the walk', () => {
    const ts = termStructureFor('BTC/USDT', NOW);
    expect(ts.provenance).toBe('synthetic');
    expect(ts.underlying).toBe('BTC');
    expect(ts.points.length).toBeGreaterThanOrEqual(4);
    for (let i = 1; i < ts.points.length; i++) {
      expect(ts.points[i].expiry).toBeGreaterThan(ts.points[i - 1].expiry);
    }
    for (const p of ts.points) {
      expect(p.annualizedBasisPct).toBeGreaterThan(0); // contango
      expect(p.price).toBeGreaterThan(ts.referencePrice!);
    }
    expect(ts.perpPrice!).toBeGreaterThan(0);
    // An unknown asset is honestly unavailable, never a zero curve.
    const none = termStructureFor('NOPE/USDT', NOW);
    expect(none.provenance).toBe('unavailable');
    expect(none.points).toEqual([]);
  });

  it('OI delta is deterministic, synthetic, price-coherent and honestly unavailable for unknown assets', () => {
    const a = oiDeltaFor('BTC/USDT', '24h', NOW);
    expect({ ...a, asOf: 0, points: [] }).toEqual({ ...oiDeltaFor('BTC/USDT', '24h', NOW), asOf: 0, points: [] });
    expect(a.points.map((p) => [p.openInterestValue, p.price])).toEqual(
      oiDeltaFor('BTC/USDT', '24h', NOW).points.map((p) => [p.openInterestValue, p.price]),
    );
    expect(a.provenance).toBe('synthetic');
    expect(a.source).toBe('demo');
    expect(typeof a.note).toBe('string');
    expect(a.points.length).toBeGreaterThan(1);
    // Coherent with the demo walk: the last price point is the current quote.
    expect(a.points[a.points.length - 1].price!).toBeCloseTo(quoteFor('BTC/USDT', NOW)!.price, 2);
    expect(a.oiNow).toBe(a.points[a.points.length - 1].openInterestValue);
    // The classification is a true quadrant of the returned series.
    expect(a.classification).not.toBeNull();
    expect(Math.sign(a.oiChangePct!)).not.toBe(0);
    expect(Math.sign(a.priceChangePct!)).not.toBe(0);
    // An unknown asset is honestly unavailable, never a fabricated delta.
    const none = oiDeltaFor('NOPE/USDT', '24h', NOW);
    expect(none.provenance).toBe('unavailable');
    expect(none.points).toEqual([]);
    expect(none.classification).toBeNull();
  });

  it('options chain is synthetic with OI both sides, derived max pain/PCR, honest unavailable for unknown assets', () => {
    const chain = optionsChainFor('ETH/USDT', 'nearest', NOW);
    expect(chain.provenance).toBe('synthetic');
    expect(chain.expiry).toBeGreaterThan(NOW);
    expect(chain.entries.length).toBeGreaterThanOrEqual(15);
    expect(chain.entries.some((e) => (e.callOi ?? 0) > 0)).toBe(true);
    expect(chain.entries.some((e) => (e.putOi ?? 0) > 0)).toBe(true);
    expect(chain.entries.some((e) => e.strike === chain.maxPainStrike)).toBe(true);
    expect(chain.putCallOiRatio!).toBeGreaterThan(0);
    // An explicit expiry flows through to every entry.
    const later = optionsChainFor('ETH/USDT', NOW + 14 * 86_400_000, NOW);
    expect(later.expiry).toBe(NOW + 14 * 86_400_000);
    expect(later.entries.every((e) => e.expiry === later.expiry)).toBe(true);
    const none = optionsChainFor('NOPE/USDT', 'nearest', NOW);
    expect(none.provenance).toBe('unavailable');
    expect(none.entries).toEqual([]);
    expect(none.maxPainStrike).toBeNull();
  });
});

describe('demo shim', () => {
  const realFetch = window.fetch;
  const realGlobalFetch = globalThis.fetch;
  afterEach(() => {
    vi.restoreAllMocks();
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
    expect(health.streamLive).toBe(false); // static demo never opens a live socket

    const quote = await (await fetch('/api/quote/BTC%2FUSDT')).json();
    expect(quote.symbol).toBe('BTC/USDT');
    expect(quote.receipt.provenance).toBe('synthetic');
    expect(validateDataReceipt(quote.receipt).ok).toBe(true);

    await fetch('https://example.com/other');
    expect(passthrough).toHaveBeenCalledTimes(1); // only the non-API request
  });

  it('serves deterministic synthetic receipts and status parity at a fixed clock', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    window.fetch = vi.fn(async () => new Response('x')) as typeof fetch;
    installDemoShim();

    const first = await (await fetch('/api/quote/BTC%2FUSDT')).json();
    const second = await (await fetch('/api/quote/BTC%2FUSDT')).json();
    expect(first.receipt.receiptId).toBe(second.receipt.receiptId);
    expect(first.receipt).toMatchObject({
      datasetFamily: 'quote',
      provenance: 'synthetic',
      derivation: 'observed',
      source: 'demo',
    });

    const status = await (await fetch('/api/data/status')).json();
    expect(status.schemaVersion).toBe('1.0');
    expect(status.providers[0].providerId).toBe('demo');
    expect(status.providers[0].capabilities.quote.mode).toBe('synthetic');
    expect(status.datasets.quote).toMatchObject({ state: 'healthy', source: 'demo' });
    expect(status.datasets.history).toMatchObject({
      state: 'unknown',
      provenance: null,
      lastReceiptId: null,
      lastSuccessAt: null,
    });
    expect(JSON.stringify(status)).not.toMatch(/api[_-]?key|password|authorization/i);
  });

  it('fails closed instead of returning unreceipted empty arrays', async () => {
    window.fetch = vi.fn(async () => new Response('x')) as typeof fetch;
    installDemoShim();

    expect((await fetch('/api/quotes')).status).toBe(400);
    expect((await fetch('/api/quotes?symbols=NOPE/USDT')).status).toBe(404);
    expect((await fetch('/api/funding-history/NOPE%2FUSDT')).status).toBe(404);
    expect((await fetch('/api/exchange-quotes/NOPE%2FUSDT')).status).toBe(404);
    expect((await fetch('/api/venue-derivatives/NOPE%2FUSDT')).status).toBe(404);
  });

  it('refuses placement with the safety hold and unsupported surfaces with honest 501s', async () => {
    window.fetch = vi.fn(async () => new Response('x')) as typeof fetch;
    installDemoShim();
    const order = await fetch('/api/orders', { method: 'POST', body: '{}' });
    expect(order.status).toBe(503);
    expect((await order.json()).error).toBe('TradingSafetyHold');
    // The demo has no account to cancel against — an honest 501 like the
    // demo's other unavailable mutations, not a fake cancel.
    const cancel = await fetch('/api/orders/demo-1?symbol=BTC/USDT', { method: 'DELETE' });
    expect(cancel.status).toBe(501);
    const keys = await fetch('/api/account/keys');
    expect(keys.status).toBe(501);
    const trading = await (await fetch('/api/trading/status')).json();
    expect(trading.enabled).toBe(false);
    expect(trading.cancelEnabled).toBe(false);
    expect(trading.mode).toBe('off');
    expect(trading.reason).toMatch(/static demo/i);
  });

  it('serves the options surface in-browser with the same edge rules as the server', async () => {
    window.fetch = vi.fn(async () => new Response('x')) as typeof fetch;
    installDemoShim();

    const dvol = await fetch('/api/options/dvol?symbol=BTC');
    expect(dvol.status).toBe(200);
    const dvolBody = await dvol.json();
    expect(dvolBody.provenance).toBe('synthetic');
    expect(dvolBody.value).toBeGreaterThan(0);
    expect((await fetch('/api/options/dvol?symbol=DOGE')).status).toBe(400);

    const chain = await fetch('/api/options/chain?symbol=BTC');
    expect(chain.status).toBe(200);
    const chainBody = await chain.json();
    expect(chainBody.provenance).toBe('synthetic');
    expect(chainBody.entries.length).toBeGreaterThan(0);
    expect(chainBody.maxPainStrike).not.toBeNull();
    expect(chainBody.receipt).toMatchObject({ derivation: 'derived', provenance: 'synthetic' });
    expect(chainBody.receipt.inputReceiptIds.length).toBeGreaterThan(0);
    expect((await fetch('/api/options/chain')).status).toBe(400);
    expect((await fetch('/api/options/chain?symbol=BTC&expiry=tomorrow')).status).toBe(400);
    expect((await fetch('/api/options/chain?symbol=BTC&expiry=4102444800001')).status).toBe(400);

    const unknownChain = await (await fetch('/api/options/chain?symbol=NOPE/USDT')).json();
    expect(unknownChain.receipt).toMatchObject({ provenance: 'unavailable', sourceAsOf: null });

    const term = await fetch('/api/futures/term-structure?symbol=BTC/USDT');
    expect(term.status).toBe(200);
    const termBody = await term.json();
    expect(termBody.provenance).toBe('synthetic');
    expect(termBody.points.length).toBeGreaterThan(0);
    expect(termBody.receipt.inputReceiptIds.length).toBeGreaterThan(0);
    expect((await fetch('/api/futures/term-structure')).status).toBe(400);

    const unknownTerm = await (await fetch('/api/futures/term-structure?symbol=NOPE/USDT')).json();
    expect(unknownTerm.receipt).toMatchObject({ provenance: 'unavailable', sourceAsOf: null });

    const oid = await fetch('/api/oi-delta?symbol=BTC/USDT&window=24h');
    expect(oid.status).toBe(200);
    const oidBody = await oid.json();
    expect(oidBody.provenance).toBe('synthetic');
    expect(oidBody.window).toBe('24h');
    expect(oidBody.points.length).toBeGreaterThan(1);
    expect(oidBody.classification).not.toBeNull();
    expect((await fetch('/api/oi-delta')).status).toBe(400);
    expect((await fetch('/api/oi-delta?symbol=BTC/USDT&window=2h')).status).toBe(400);

    const unknownOid = await (await fetch('/api/oi-delta?symbol=NOPE/USDT&window=24h')).json();
    expect(unknownOid.receipt).toMatchObject({ provenance: 'unavailable', sourceAsOf: null });

    const liquidations = await (await fetch('/api/liquidations')).json();
    expect(liquidations.receipt).toMatchObject({ derivation: 'derived', provenance: 'synthetic' });
    expect(liquidations.receipt.inputReceiptIds.length).toBeGreaterThan(0);
    expect(liquidations.receipt.limitations.join(' ')).toMatch(/not observed/i);
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
    const token = await (await fetch('/api/solana/token/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')).json();
    expect(token.provenance).toBe('synthetic');
    expect(token.symbol).toBe('USDC'); // case preserved via seg(4)
    const quote = await (await fetch('/api/solana/quote/SOL/USDC/1')).json();
    expect(quote.provenance).toBe('synthetic');
    expect(quote.outAmount).toBeGreaterThan(0);
    const market = await (await fetch('/api/solana/market')).json();
    expect(market.provenance).toBe('synthetic');
    expect(market.tokens.length).toBeGreaterThan(0);
  });

  it('the AI copilot answers 503 NotConfigured on POST (not the generic demo 501)', async () => {
    window.fetch = vi.fn(async () => new Response('x')) as typeof fetch;
    installDemoShim();
    const res = await fetch('/api/ai/chat', { method: 'POST', body: '{}' });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe('NotConfigured');
  });

  it('the fan-out boards answer in the server BoardEnvelope shape', async () => {
    window.fetch = vi.fn(async () => new Response('x')) as typeof fetch;
    installDemoShim();
    for (const path of ['/api/funding', '/api/funding-dispersion', '/api/venue-arb', '/api/oi-concentration']) {
      const body = await (await fetch(`${path}?quote=USDT&limit=5`)).json();
      expect(Array.isArray(body.rows), path).toBe(true);
      expect(body.rows.length, path).toBeGreaterThan(0);
      expect(body.meta, path).toMatchObject({
        provenance: 'synthetic',
        source: 'demo',
        cachedAt: null,
        partial: false,
      });
      expect(typeof body.meta.asOf, path).toBe('number');
      expect(body.meta.receipt.provenance, path).toBe('synthetic');
      expect(body.meta.receipt.derivation, path).toBe('derived');
      expect(body.rows.every((row: { receipt?: { receiptId?: string } }) => Boolean(row.receipt?.receiptId)), path).toBe(true);
    }
    // The funding-dispersion board specifically must not come up empty — every
    // demo venue reports its funding interval, so none are excluded.
    const dispersion = await (await fetch('/api/funding-dispersion?quote=USDT&limit=15')).json();
    expect(dispersion.rows.every((r: { spreadBps: number | null }) => r.spreadBps !== null)).toBe(true);
    const arb = await (await fetch('/api/venue-arb?quote=USDT&limit=5')).json();
    expect(arb.rows.every((r: { netLimitations: string[] }) => r.netLimitations.length === 0)).toBe(true);
    expect(arb.rows.every((r: { netSpreadBps: number | null }) => r.netSpreadBps !== null)).toBe(true);
  });

  it('rejects an invalid screener sort like the server (400, not silent volume order)', async () => {
    window.fetch = vi.fn(async () => new Response('x')) as typeof fetch;
    installDemoShim();
    const bad = await fetch('/api/screener?sort=bogus');
    expect(bad.status).toBe(400);
    const ok = await fetch('/api/screener?sort=change&limit=3');
    expect(ok.status).toBe(200);
  });

  it('non-numeric query params fall back to defaults instead of an empty response', async () => {
    window.fetch = vi.fn(async () => new Response('x')) as typeof fetch;
    installDemoShim();
    // Number('xyz') is NaN → slice(0, NaN) / a NaN depth would have returned nothing;
    // numParam guards both back to the default.
    const rows = await (await fetch('/api/screener?sort=price&limit=xyz')).json();
    expect(rows.length).toBeGreaterThan(0);
    const book = await (await fetch('/api/orderbook/BTC%2FUSDT?depth=xyz')).json();
    expect(book.bids.length).toBeGreaterThan(0);
  });

  it('fills and news honour the ?symbol= query the client actually sends', async () => {
    window.fetch = vi.fn(async () => new Response('x')) as typeof fetch;
    installDemoShim();
    const fills = await (await fetch('/api/fills?symbol=SOL%2FUSDT')).json();
    expect(fills.fills.length).toBe(2);
    expect(fills.fills.every((f: { symbol: string }) => f.symbol === 'SOL/USDT')).toBe(true);
    const news = await (await fetch('/api/news?symbol=ETH%2FUSDT')).json();
    expect(news[0].title).toContain('ETH');
  });

  it('history without interval/range uses the server defaults (1d / 6mo)', async () => {
    window.fetch = vi.fn(async () => new Response('x')) as typeof fetch;
    installDemoShim();
    const h = await (await fetch('/api/history/BTC%2FUSDT')).json();
    expect(h.interval).toBe('1d');
    expect(h.range).toBe('6mo');
  });
});
