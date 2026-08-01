// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import type { DataReceipt } from '@midas/shared';
import { SourceBadge } from './SourceInspector';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse('2026-08-01T12:00:02.000Z'));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function receipt(overrides: Partial<DataReceipt> = {}): DataReceipt {
  return {
    schemaVersion: '1.0',
    receiptId: 'rcpt-derived-arb',
    providerId: 'ccxt',
    providerVersion: '4.5.0',
    source: 'ccxt',
    venue: 'multi-venue',
    datasetFamily: 'venue-arbitrage',
    instrument: 'BTC/USDT',
    coverage: 'binance, kraken',
    provenance: 'live',
    derivation: 'derived',
    sourceAsOf: '2026-08-01T12:00:00.000Z',
    observedAt: '2026-08-01T12:00:02.000Z',
    expectedCadenceMs: 5_000,
    maxAgeMs: 15_000,
    freshness: { state: 'fresh', ageMs: 2_000 },
    cache: { status: 'hit', ageMs: 1_000 },
    units: { netSpreadBps: 'bps', price: 'USD' },
    methodology: {
      id: 'venue-arbitrage-net',
      version: '1.0.0',
      formula: 'gross spread - explicit round-trip fees',
    },
    inputReceiptIds: ['rcpt-binance-btc', 'rcpt-kraken-btc'],
    limitations: ['Transfer costs are unknown; this is not an executable quote.'],
    traceId: 'trace-123',
    note: 'Uses synchronized public quotes.',
    ...overrides,
  } as DataReceipt;
}

describe('SourceBadge and SourceInspector', () => {
  it.each([
    ['fresh live', { provenance: 'live', derivation: 'observed', freshness: { state: 'fresh', ageMs: 1_000 } }, /LIVE \/ FRESH/i],
    ['stale live', { provenance: 'live', derivation: 'observed', freshness: { state: 'stale', ageMs: 20_000 } }, /LIVE \/ STALE/i],
    ['synthetic', { provenance: 'synthetic', derivation: 'observed' }, /SYNTHETIC/i],
    ['derived', { provenance: 'live', derivation: 'derived' }, /LIVE \/ FRESH \/ DERIVED/i],
    ['unavailable', { provenance: 'unavailable', derivation: 'observed' }, /UNAVAILABLE/i],
  ] as const)('renders the %s trust state on the actionable badge', (_name, overrides, label) => {
    render(createElement(SourceBadge, { receipt: receipt(overrides as Partial<DataReceipt>) }));
    expect(screen.getByRole('button', { name: label })).toBeTruthy();
  });

  it('opens by pointer into a body portal and exposes the allowlisted receipt details', () => {
    const withSecret = {
      ...receipt(),
      apiKey: 'super-secret-must-not-render',
      rawAuthError: 'Bearer hidden-token',
    } as DataReceipt;
    const { container } = render(createElement(SourceBadge, { receipt: withSecret }));
    const trigger = screen.getByRole('button', { name: /Inspect source:/i });

    fireEvent.click(trigger);

    const dialog = screen.getByRole('dialog', { name: 'Source Inspector' });
    expect(dialog).toBeTruthy();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(screen.getByText('venue-arbitrage')).toBeTruthy();
    expect(screen.getByText('venue-arbitrage-net @ 1.0.0')).toBeTruthy();
    expect(screen.getByText('rcpt-binance-btc')).toBeTruthy();
    expect(screen.getByText(/Transfer costs are unknown/)).toBeTruthy();
    expect(screen.queryByText(/super-secret|hidden-token/)).toBeNull();
    expect(dialog.className).toContain('sm:inset-y-0');
    expect(dialog.className).toContain('bottom-0');

    fireEvent.click(screen.getByRole('button', { name: 'Close Source Inspector' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('supports Enter, Escape, Space and backdrop close while restoring trigger focus', () => {
    render(createElement(SourceBadge, { receipt: receipt() }));
    const trigger = screen.getByRole('button', { name: /Inspect source:/i });

    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'Enter' });
    let dialog = screen.getByRole('dialog', { name: 'Source Inspector' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close Source Inspector' }));

    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);

    fireEvent.keyDown(trigger, { key: ' ' });
    dialog = screen.getByRole('dialog', { name: 'Source Inspector' });
    expect(dialog).toBeTruthy();
    fireEvent.mouseDown(screen.getByTestId('source-inspector-backdrop'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('traps Tab inside the drawer', () => {
    render(createElement(SourceBadge, { receipt: receipt() }));
    fireEvent.click(screen.getByRole('button', { name: /Inspect source:/i }));
    const dialog = screen.getByRole('dialog', { name: 'Source Inspector' });
    const close = screen.getByRole('button', { name: 'Close Source Inspector' });
    expect(document.activeElement).toBe(close);

    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(close);
  });

  it('renders missing evidence as unknown and preserves long limitations', () => {
    const longLimitation = 'Very long limitation '.repeat(30).trim();
    render(
      createElement(SourceBadge, {
        receipt: receipt({
          venue: null,
          coverage: null,
          sourceAsOf: null,
          methodology: null,
          traceId: null,
          freshness: { state: 'unknown', ageMs: null },
          limitations: [longLimitation],
        }),
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: /LIVE \/ UNKNOWN \/ DERIVED/i }));

    expect(screen.getAllByText('unknown').length).toBeGreaterThanOrEqual(5);
    const limitation = screen.getByText(longLimitation);
    expect(limitation.className).toContain('break-words');
    expect(screen.getByRole('dialog').className).toContain('overflow-y-auto');
  });
});
