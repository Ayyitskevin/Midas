// @vitest-environment jsdom
// Render tests for the ORD cancel-only surface: the cancel action appears only
// when the server reports cancelEnabled, one click never cancels (two-step
// confirm), and the server's honest failure states (already filled/canceled,
// outcome unknown) surface verbatim. api is mocked — no network, no exchange.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import type { CancelResult, OpenOrders, TradingStatus } from '@midas/shared';
import type { PanelState } from '@/store/usePanels';
import { OrdersModule } from './OrdersModule';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const openOrdersMock = vi.hoisted(() => vi.fn<() => Promise<OpenOrders>>());
const cancelOrderMock = vi.hoisted(() => vi.fn<(id: string, symbol: string) => Promise<CancelResult>>());
const tradingMock = vi.hoisted(() => vi.fn<() => Promise<TradingStatus>>());
vi.mock('@/lib/api', () => ({
  api: { openOrders: openOrdersMock, cancelOrder: cancelOrderMock, tradingStatus: tradingMock },
}));

const CANCEL_ONLY: TradingStatus = {
  enabled: false,
  cancelEnabled: true,
  mode: 'cancel-only',
  reason: 'Execution safety hold: placement disabled; cancel-only.',
  maxOrderUsd: null,
  dailyCapUsd: null,
  dailyUsedUsd: 0,
  source: 'ccxt:kraken',
};

const READ_ONLY: TradingStatus = { ...CANCEL_ONLY, cancelEnabled: false, mode: 'off' };

const ORDERS: OpenOrders = {
  source: 'ccxt:kraken',
  provenance: 'live',
  note: null,
  asOf: Date.now(),
  orders: [
    {
      id: 'ord-1',
      symbol: 'BTC/USDT',
      side: 'buy',
      type: 'limit',
      price: 60_000,
      amount: 0.5,
      filled: 0,
      remaining: 0.5,
      value: 30_000,
      timestamp: Date.now() - 60_000,
      status: 'open',
    },
  ],
};

const PANEL: PanelState = {
  id: 'o1',
  module: 'ORD',
  symbol: null,
  title: 'Open Orders',
  x: 0,
  y: 0,
  w: 4,
  h: 10,
  minW: 3,
  minH: 6,
};

beforeEach(() => {
  openOrdersMock.mockReset().mockResolvedValue(ORDERS);
  cancelOrderMock.mockReset().mockResolvedValue({ id: 'ord-1', symbol: 'BTC/USDT', status: 'canceled' });
  tradingMock.mockReset().mockResolvedValue(CANCEL_ONLY);
});
afterEach(cleanup);

describe('OrdersModule cancel-only surface', () => {
  it('offers a two-step cancel when the server reports cancelEnabled', async () => {
    render(createElement(OrdersModule, { panel: PANEL }));
    const arm = await screen.findByTitle('Cancel this order (two-step confirm)');

    // First click only arms — no cancel call may fire on a single misclick.
    fireEvent.click(arm);
    expect(cancelOrderMock).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByText('confirm'));
    await waitFor(() => expect(cancelOrderMock).toHaveBeenCalledWith('ord-1', 'BTC/USDT'));
  });

  it('the "keep" escape hatch backs out without canceling', async () => {
    render(createElement(OrdersModule, { panel: PANEL }));
    fireEvent.click(await screen.findByTitle('Cancel this order (two-step confirm)'));
    fireEvent.click(await screen.findByText('keep'));
    expect(cancelOrderMock).not.toHaveBeenCalled();
    // Back to the armed-off state.
    expect(await screen.findByTitle('Cancel this order (two-step confirm)')).toBeTruthy();
  });

  it('hides the cancel action entirely when the posture is not cancel-only', async () => {
    tradingMock.mockResolvedValue(READ_ONLY);
    render(createElement(OrdersModule, { panel: PANEL }));
    expect(await screen.findByText('BTC/USDT')).toBeTruthy();
    expect(screen.queryByTitle('Cancel this order (two-step confirm)')).toBeNull();
    expect(screen.queryByText('confirm')).toBeNull();
  });

  it('surfaces the server\'s honest "already filled or canceled" (409) message', async () => {
    cancelOrderMock.mockRejectedValue(
      Object.assign(new Error('Order ord-1 on BTC/USDT is no longer open — already filled or canceled.'), {
        name: 'ProviderError',
      }),
    );
    render(createElement(OrdersModule, { panel: PANEL }));
    fireEvent.click(await screen.findByTitle('Cancel this order (two-step confirm)'));
    fireEvent.click(await screen.findByText('confirm'));
    expect(await screen.findByText(/already filled or canceled/)).toBeTruthy();
  });

  it('surfaces the server\'s honest "outcome unknown" (502) message and re-reads the book', async () => {
    cancelOrderMock.mockRejectedValue(
      Object.assign(
        new Error(
          'Cancel outcome UNKNOWN for order ord-1 on BTC/USDT — the exchange did not confirm (RequestTimeout). ' +
            'Check the exchange for the true order state before assuming it is open or canceled.',
        ),
        { name: 'ProviderError' },
      ),
    );
    render(createElement(OrdersModule, { panel: PANEL }));
    fireEvent.click(await screen.findByTitle('Cancel this order (two-step confirm)'));
    fireEvent.click(await screen.findByText('confirm'));
    expect(await screen.findByText(/outcome UNKNOWN/i)).toBeTruthy();
    // Initial load + the honest re-read after an ambiguous outcome.
    await waitFor(() => expect(openOrdersMock.mock.calls.length).toBeGreaterThanOrEqual(2));
  });
});
