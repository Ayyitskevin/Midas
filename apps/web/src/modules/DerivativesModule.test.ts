// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import {
  createDataReceipt,
  partialEvidenceLimitation,
  type DerivativesInfo,
} from '@midas/shared';
import type { PanelState } from '@/store/usePanels';
import { DerivativesModule } from './DerivativesModule';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const derivativesMock = vi.hoisted(() => vi.fn<() => Promise<DerivativesInfo>>());
vi.mock('@/lib/api', () => ({ api: { derivatives: derivativesMock } }));

const PANEL: PanelState = {
  id: 'd1',
  module: 'FUND',
  symbol: 'BTC/USDT',
  title: 'Derivatives',
  x: 0,
  y: 0,
  w: 5,
  h: 8,
  minW: 4,
  minH: 6,
};

afterEach(() => {
  cleanup();
  derivativesMock.mockReset();
});

describe('DerivativesModule liquidation truth', () => {
  it('does not convert an empty partial read into a no-events claim', async () => {
    const now = Date.now();
    const receipt = createDataReceipt({
      providerId: 'test',
      providerVersion: '1',
      source: 'test-derivatives',
      datasetFamily: 'derivatives',
      instrument: 'BTC/USDT',
      provenance: 'live',
      sourceAsOf: now,
      observedAt: now,
      maxAgeMs: 60_000,
      limitations: [partialEvidenceLimitation('The liquidation event read failed.')],
    }, now);
    derivativesMock.mockResolvedValue({
      symbol: 'BTC/USDT',
      fundingRate: 0.0001,
      fundingIntervalHours: 8,
      nextFundingTime: null,
      markPrice: 65_000,
      indexPrice: 64_990,
      openInterest: 10,
      openInterestValue: 650_000,
      recentLiquidations: [],
      timestamp: now,
      receipt,
    });

    render(createElement(DerivativesModule, { panel: PANEL }));
    expect(await screen.findByText(/partial; absence of events is not confirmed/i)).toBeTruthy();
    expect(screen.queryByText('No recent liquidations.')).toBeNull();
    expect(screen.getAllByRole('button', { name: /PARTIAL/i }).length).toBeGreaterThanOrEqual(2);
  });
});
