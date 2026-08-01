// @vitest-environment jsdom
// Render-level pins for the provenance badge/honesty banner. (.ts not .tsx
// because vitest's include glob is src/**/*.test.ts — JSX is avoided via
// createElement so no vitest.config change is needed.)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import type { BoardMeta, DataReceipt } from '@midas/shared';
import { BoardMetaBadge, BoardMetaNote } from './BoardMeta';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse('2026-08-01T12:00:01.000Z'));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function meta(overrides: Partial<BoardMeta>): BoardMeta {
  return {
    provenance: 'live',
    source: 'binance',
    asOf: Date.now(),
    cachedAt: null,
    partial: false,
    note: null,
    ...overrides,
  };
}

function receipt(): DataReceipt {
  return {
    schemaVersion: '1.0',
    receiptId: 'rcpt-funding',
    providerId: 'ccxt',
    providerVersion: '4.5.0',
    source: 'ccxt',
    venue: 'binance',
    datasetFamily: 'funding',
    instrument: null,
    coverage: 'perpetuals',
    provenance: 'live',
    derivation: 'observed',
    sourceAsOf: '2026-08-01T12:00:00.000Z',
    observedAt: '2026-08-01T12:00:01.000Z',
    expectedCadenceMs: 60_000,
    maxAgeMs: 180_000,
    freshness: { state: 'fresh', ageMs: 1_000 },
    cache: { status: 'miss', ageMs: null },
    units: { fundingRate: 'fraction' },
    methodology: null,
    inputReceiptIds: [],
    limitations: [],
    traceId: null,
    note: null,
  } as DataReceipt;
}

describe('BoardMetaBadge', () => {
  it('makes an adopted receipt actionable while preserving the legacy fallback', () => {
    render(createElement(BoardMetaBadge, { meta: meta({ receipt: receipt() }) }));
    const trigger = screen.getByRole('button', { name: /LIVE \/ FRESH/i });
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: 'Source Inspector' })).toBeTruthy();
  });

  it('keeps a legacy live board neutral because freshness is unknown', () => {
    const { container } = render(createElement(BoardMetaBadge, { meta: meta({}) }));
    expect(screen.getByText('binance')).toBeTruthy();
    expect(screen.getByText('· live · freshness unknown')).toBeTruthy();
    expect(container.querySelector('.bg-term-muted')).toBeTruthy();
    expect(container.querySelector('.bg-term-up')).toBeNull();
  });

  it('labels a cached board as cached, visually distinct from live', () => {
    const { container } = render(
      createElement(BoardMetaBadge, { meta: meta({ cachedAt: Date.now() - 1_000 }) }),
    );
    expect(screen.getByText('· cached')).toBeTruthy();
    expect(screen.queryByText('· live')).toBeNull();
    expect(container.querySelector('.bg-term-amber')).toBeTruthy();
    expect(container.querySelector('.bg-term-up')).toBeNull();
  });

  it('labels synthetic provenance as synthetic, never live', () => {
    const { container } = render(
      createElement(BoardMetaBadge, { meta: meta({ provenance: 'synthetic', source: 'mock' }) }),
    );
    expect(screen.getByText('mock')).toBeTruthy();
    expect(screen.getByText('· synthetic')).toBeTruthy();
    expect(container.querySelector('.bg-term-up')).toBeNull();
  });
});

describe('BoardMetaNote', () => {
  it('renders the honesty banner with the server caveat', () => {
    const { container } = render(
      createElement(BoardMetaNote, {
        meta: meta({ partial: true, note: 'Partial coverage: 2 venues failed.' }),
      }),
    );
    expect(screen.getByText(/Partial coverage: 2 venues failed\./)).toBeTruthy();
    expect(container.querySelector('.text-term-amber')).toBeTruthy();
  });

  it('renders the dropped-rows caveat for a partial board with no note', () => {
    render(createElement(BoardMetaNote, { meta: meta({ partial: true }) }));
    expect(screen.getByText(/rows were dropped/)).toBeTruthy();
  });

  it('renders nothing when the board is fully live with no caveat', () => {
    const { container } = render(createElement(BoardMetaNote, { meta: meta({}) }));
    expect(container.firstChild).toBeNull();
  });
});
