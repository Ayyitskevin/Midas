// @vitest-environment jsdom
// Render tests for the demo/synthetic disclosure strip. The only external seam
// is api.health (polled via useFetch); it is mocked — no network.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import type { HealthResponse } from '@midas/shared';
import { DemoBanner } from './DemoBanner';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const healthMock = vi.hoisted(() => vi.fn<(signal?: AbortSignal) => Promise<HealthResponse>>());
vi.mock('@/lib/api', () => ({ api: { health: healthMock } }));

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

beforeEach(() => {
  localStorage.clear();
  healthMock.mockReset();
});
afterEach(cleanup);

describe('DemoBanner', () => {
  it('shows the public-demo disclosure when the server is in demo posture', async () => {
    healthMock.mockResolvedValue(health({ demo: true }));
    render(createElement(DemoBanner));
    expect(await screen.findByText('PUBLIC DEMO')).toBeTruthy();
    expect(screen.getByText(/nothing here is real, and nothing can be traded/)).toBeTruthy();
  });

  it('shows the synthetic-data disclosure for a non-live provider', async () => {
    healthMock.mockResolvedValue(health({ provider: 'mock', live: false }));
    render(createElement(DemoBanner));
    expect(await screen.findByText(/synthetic “mock” data, not real markets/)).toBeTruthy();
    expect(screen.getByText(/MIDAS_DATA_PROVIDER=ccxt/)).toBeTruthy();
  });

  it('renders nothing for a live provider', async () => {
    healthMock.mockResolvedValue(health({ provider: 'ccxt:binance', live: true, streamLive: true }));
    render(createElement(DemoBanner));
    await waitFor(() => expect(healthMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('PUBLIC DEMO')).toBeNull();
    expect(screen.queryByText(/Demo mode/)).toBeNull();
  });

  it('stays dismissed after the user closes it', async () => {
    healthMock.mockResolvedValue(health({ demo: true }));
    render(createElement(DemoBanner));
    fireEvent.click(await screen.findByTitle('Dismiss'));
    expect(screen.queryByText('PUBLIC DEMO')).toBeNull();
    expect(localStorage.getItem('midas-demo-banner-dismissed')).toBe('1');
  });
});
