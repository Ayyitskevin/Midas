import type {
  AccountBalance,
  AccountFill,
  AccountFills,
  AccountPosition,
  AccountPositions,
  Balances,
  OpenOrder,
  OpenOrders,
} from '@midas/shared';
import { gaussian, round, seeded, uniform } from '../util';
import { STABLES, sumValueUsd } from '../balances';
import { sumUnrealizedPnl } from '../accountReads';
import { MOCK_SOURCE, resolveEntry } from './fixtures';
import { buildQuote } from './quote';

export async function mockBalances(): Promise<Balances> {
  // A small deterministic demo book so the BAL panel is useful offline. Clearly
  // labeled synthetic — never a real account. The `used` column is exercised by
  // a couple of holdings so the free/used split isn't all zeros in the demo.
  const book: Array<{ asset: string; free: number; used: number }> = [
    { asset: 'BTC', free: 0.6231, used: 0 },
    { asset: 'ETH', free: 6.42, used: 1.0 },
    { asset: 'SOL', free: 145.8, used: 0 },
    { asset: 'USDT', free: 8650, used: 350 },
  ];
  const balances: AccountBalance[] = book.map(({ asset, free, used }) => {
    const total = round(free + used, 6);
    const priceUsd = STABLES.has(asset) ? 1 : buildQuote(resolveEntry(`${asset}/USDT`)).price;
    return { asset, free, used, total, valueUsd: round(priceUsd * total) };
  });
  balances.sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0));
  return {
    source: MOCK_SOURCE,
    provenance: 'synthetic',
    note:
      'Synthetic demo balances for offline/demo use — not a real account. ' +
      'Configure read-only exchange API keys (ccxt provider) for live balances.',
    totalValueUsd: sumValueUsd(balances),
    balances,
    asOf: Date.now(),
  };
}

export async function mockOpenOrders(): Promise<OpenOrders> {
  // A couple of resting limit orders around the live mock price so the ORD
  // panel is useful offline. Clearly labeled synthetic — never a real account.
  const specs: Array<{ symbol: string; side: 'buy' | 'sell'; offsetPct: number; amount: number; filledPct: number }> = [
    { symbol: 'BTC/USDT', side: 'buy', offsetPct: -0.03, amount: 0.25, filledPct: 0.2 },
    { symbol: 'ETH/USDT', side: 'sell', offsetPct: 0.04, amount: 4, filledPct: 0 },
    { symbol: 'SOL/USDT', side: 'buy', offsetPct: -0.06, amount: 60, filledPct: 0 },
  ];
  const now = Date.now();
  const orders: OpenOrder[] = specs.map((s, i) => {
    const mid = buildQuote(resolveEntry(s.symbol)).price;
    const price = round(mid * (1 + s.offsetPct), 6);
    const filled = round(s.amount * s.filledPct, 6);
    return {
      id: `demo-${i + 1}`,
      symbol: s.symbol,
      side: s.side,
      type: 'limit',
      price,
      amount: s.amount,
      filled,
      remaining: round(s.amount - filled, 6),
      value: round(price * s.amount),
      timestamp: now - (i + 1) * 3_600_000,
      status: filled > 0 ? 'partial' : 'open',
    };
  });
  return {
    source: MOCK_SOURCE,
    provenance: 'synthetic',
    note:
      'Synthetic demo orders for offline/demo use — not a real account. ' +
      'Configure read-only exchange API keys (ccxt provider) for live orders.',
    orders,
    asOf: now,
  };
}

export async function mockPositions(): Promise<AccountPositions> {
  // Two demo perp positions so the POSN panel is useful offline. Synthetic.
  const specs: Array<{ symbol: string; side: 'long' | 'short'; contracts: number; entryOffsetPct: number; leverage: number }> = [
    { symbol: 'BTC/USDT', side: 'long', contracts: 0.4, entryOffsetPct: -0.05, leverage: 10 },
    { symbol: 'ETH/USDT', side: 'short', contracts: 5, entryOffsetPct: 0.03, leverage: 5 },
  ];
  const now = Date.now();
  const positions: AccountPosition[] = specs.map((s) => {
    const mark = buildQuote(resolveEntry(s.symbol)).price;
    const entry = round(mark * (1 + s.entryOffsetPct), 6);
    const notionalUsd = round(mark * s.contracts);
    const dir = s.side === 'long' ? 1 : -1;
    const unrealizedPnlUsd = round(dir * (mark - entry) * s.contracts);
    const margin = notionalUsd / s.leverage;
    const pnlPct = margin > 0 ? round((unrealizedPnlUsd / margin) * 100, 2) : null;
    // Rough synthetic liquidation: entry moved against by ~1/leverage.
    const liquidationPrice = round(entry * (1 - dir / s.leverage), 6);
    return {
      symbol: `${s.symbol}:${s.symbol.split('/')[1]}`,
      side: s.side,
      contracts: s.contracts,
      notionalUsd,
      entryPrice: entry,
      markPrice: round(mark, 6),
      unrealizedPnlUsd,
      pnlPct,
      liquidationPrice,
      leverage: s.leverage,
    };
  });
  return {
    source: MOCK_SOURCE,
    provenance: 'synthetic',
    note:
      'Synthetic demo positions for offline/demo use — not a real account. ' +
      'Configure read-only exchange API keys (ccxt provider) for live positions.',
    totalUnrealizedPnlUsd: sumUnrealizedPnl(positions),
    positions,
    asOf: now,
  };
}

export async function mockFills(symbol?: string): Promise<AccountFills> {
  // A dozen deterministic demo fills across the demo book's symbols so the
  // FILLS panel is useful offline. Clearly labeled synthetic.
  const symbols = symbol ? [symbol.toUpperCase()] : ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'];
  const now = Date.now();
  const hourBucket = Math.floor(now / 3_600_000);
  const fills: AccountFill[] = [];
  for (let i = 0; i < 12; i++) {
    const sym = symbols[i % symbols.length];
    const mid = buildQuote(resolveEntry(sym)).price;
    const rng = seeded(sym, hourBucket, i, 'fills');
    const side = rng() > 0.5 ? ('buy' as const) : ('sell' as const);
    const price = round(mid * (1 + gaussian(rng) * 0.004), 6);
    const amount = round(uniform(rng, 0.05, 2) * (mid > 1000 ? 0.4 : 40), 4);
    const cost = round(price * amount);
    fills.push({
      id: `demo-fill-${hourBucket}-${i}`,
      orderId: `demo-${(i % 3) + 1}`,
      symbol: sym,
      side,
      price,
      amount,
      cost,
      fee: round(cost * 0.001, 4),
      feeCurrency: sym.split('/')[1] ?? 'USDT',
      takerOrMaker: rng() > 0.4 ? 'taker' : 'maker',
      timestamp: now - i * uniform(rng, 0.5, 4) * 3_600_000,
    });
  }
  fills.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
  return {
    source: MOCK_SOURCE,
    provenance: 'synthetic',
    note:
      'Synthetic demo fills for offline/demo use — not a real account. ' +
      'Configure read-only exchange API keys (ccxt provider) for live fills.',
    fills,
    asOf: now,
  };
}
