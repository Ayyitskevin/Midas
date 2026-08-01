// @vitest-environment jsdom
// Render tests for the status-bar stream/source badges. Seams mocked:
// '@/lib/api' (health + trading status polls) and '@/lib/stream' (socket
// status + subscription count) so each streamStatusView state is exercised
// without a socket or network.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import type { HealthResponse, TradingStatus } from '@midas/shared';
import type { StreamStatus } from '@/lib/stream';
import { StatusBar } from './StatusBar';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const streamState = vi.hoisted(() => ({ status: 'closed' as StreamStatus, subs: 0 }));
vi.mock('@/lib/stream', () => ({
  stream: {
    subscriberCount: () => streamState.subs,
    getStatus: () => streamState.status,
  },
  useStreamStatus: () => streamState.status,
}));

const healthMock = vi.hoisted(() => vi.fn<(signal?: AbortSignal) => Promise<HealthResponse>>());
const tradingMock = vi.hoisted(() => vi.fn<(signal?: AbortSignal) => Promise<TradingStatus>>());
vi.mock('@/lib/api', () => ({ api: { health: healthMock, tradingStatus: tradingMock } }));

function health(overrides: Partial<HealthResponse>): HealthResponse {
  return {
    status: 'ok',
    provider: 'mock',
    live: false,
    streamLive: false,
    time: 0,
    version: '0.5.0',
    ...overrides,
  };
}

const HOLD: TradingStatus = {
  enabled: false,
  cancelEnabled: true,
  mode: 'cancel-only',
  reason: 'Trading is disabled while the execution safety hold is active.',
  maxOrderUsd: null,
  dailyCapUsd: null,
  dailyUsedUsd: 0,
  source: 'mock',
};

beforeEach(() => {
  streamState.status = 'closed';
  streamState.subs = 0;
  healthMock.mockReset();
  tradingMock.mockReset().mockResolvedValue(HOLD);
});
afterEach(cleanup);

describe('StatusBar badges', () => {
  it('shows LIVE when the socket is open with subscriptions on a live stream', async () => {
    streamState.status = 'open';
    streamState.subs = 3;
    healthMock.mockResolvedValue(health({ provider: 'ccxt:binance', live: true, streamLive: true }));
    render(createElement(StatusBar));
    expect(await screen.findByText('LIVE')).toBeTruthy();
    expect(screen.getByText('ccxt:binance')).toBeTruthy();
    expect(screen.queryByText(/synthetic/)).toBeNull();
  });

  it('shows SIM when the stream is synthetic, even with live REST quotes', async () => {
    streamState.status = 'open';
    streamState.subs = 3;
    healthMock.mockResolvedValue(health({ provider: 'yahoo', live: true, streamLive: false }));
    render(createElement(StatusBar));
    expect(await screen.findByText('SIM')).toBeTruthy();
    expect(screen.queryByText('LIVE')).toBeNull();
  });

  it('shows IDLE when nothing is streaming', async () => {
    healthMock.mockResolvedValue(health({}));
    render(createElement(StatusBar));
    expect(await screen.findByText('IDLE')).toBeTruthy();
    expect(screen.queryByText('LIVE')).toBeNull();
  });

  it('labels a synthetic provider as synthetic next to the source name', async () => {
    healthMock.mockResolvedValue(health({ provider: 'mock', live: false }));
    render(createElement(StatusBar));
    expect(await screen.findByText('mock')).toBeTruthy();
    expect(screen.getByText('· synthetic')).toBeTruthy();
  });

  it('never shows the LIVE TRADING indicator while the safety hold is on', async () => {
    healthMock.mockResolvedValue(health({}));
    render(createElement(StatusBar));
    await screen.findByText('MIDAS');
    expect(screen.queryByText('LIVE TRADING')).toBeNull();
  });
});
