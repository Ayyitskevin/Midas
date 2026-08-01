// @vitest-environment jsdom
// Render tests for the UI half of the TradingSafetyHold invariant: while the
// server reports trading disabled, the ticket is preview-only and the
// place-order control is disabled. api (orderbook/tradingStatus/balances) is
// mocked — no network, no real exchange.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import type { Balances, OrderBook, TradingStatus } from '@midas/shared';
import type { PanelState } from '@/store/usePanels';
import { OrderTicketModule } from './OrderTicketModule';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const orderbookMock = vi.hoisted(() => vi.fn<() => Promise<OrderBook>>());
const tradingMock = vi.hoisted(() => vi.fn<() => Promise<TradingStatus>>());
const balancesMock = vi.hoisted(() => vi.fn<() => Promise<Balances>>());
vi.mock('@/lib/api', () => ({
  api: { orderbook: orderbookMock, tradingStatus: tradingMock, balances: balancesMock },
}));

const BOOK: OrderBook = {
  symbol: 'BTC/USDT',
  bids: [
    { price: 50_000, amount: 1 },
    { price: 49_900, amount: 2 },
  ],
  asks: [
    { price: 50_100, amount: 1 },
    { price: 50_200, amount: 2 },
  ],
  timestamp: Date.now(),
};

const HOLD: TradingStatus = {
  enabled: false,
  reason: 'Trading is disabled while the execution safety hold is active.',
  maxOrderUsd: null,
  dailyCapUsd: null,
  dailyUsedUsd: 0,
  source: 'mock',
};

const BALANCES: Balances = {
  source: 'mock',
  provenance: 'synthetic',
  note: null,
  totalValueUsd: null,
  asOf: Date.now(),
  balances: [
    { asset: 'BTC', free: 1, used: 0, total: 1, valueUsd: null },
    { asset: 'USDT', free: 10_000, used: 0, total: 10_000, valueUsd: null },
  ],
};

const PANEL: PanelState = {
  id: 't1',
  module: 'TICKET',
  symbol: 'BTC/USDT',
  title: 'Order Ticket',
  x: 0,
  y: 0,
  w: 4,
  h: 13,
  minW: 3,
  minH: 9,
};

beforeEach(() => {
  orderbookMock.mockReset().mockResolvedValue(BOOK);
  tradingMock.mockReset().mockResolvedValue(HOLD);
  balancesMock.mockReset().mockResolvedValue(BALANCES);
});
afterEach(cleanup);

describe('OrderTicketModule under the execution safety hold', () => {
  it('renders the PREVIEW ONLY banner with the hold reason', async () => {
    render(createElement(OrderTicketModule, { panel: PANEL }));
    expect(await screen.findByText('PREVIEW ONLY')).toBeTruthy();
    expect(await screen.findByText(/execution safety hold/)).toBeTruthy();
  });

  it('keeps the place-order control disabled and never offers live placement', async () => {
    render(createElement(OrderTicketModule, { panel: PANEL }));
    const button = (await screen.findByText(/Place order — disabled/)).closest('button');
    expect(button).toBeTruthy();
    expect(button!.disabled).toBe(true);
    expect(screen.queryByText(/Review & place/)).toBeNull();
    expect(screen.queryByText(/Confirm LIVE/)).toBeNull();
  });

  it('still previews against the book (prompts for an amount)', async () => {
    render(createElement(OrderTicketModule, { panel: PANEL }));
    expect(await screen.findByText(/Enter an order amount greater than zero/)).toBeTruthy();
  });
});
