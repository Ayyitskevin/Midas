import { createDataReceipt, partialEvidenceLimitation } from '@midas/shared';
import type {
  DataProvenance,
  DataReceipt,
  ProviderCapability,
  ProviderCapabilityManifest,
} from '@midas/shared';
import { describe, expect, it } from 'vitest';
import { createDataStatusTracker } from '../dataStatus';
import { ProviderError } from '../providers';
import { MockProvider } from '../providers/mock';
import { attachProviderReceipt, attachProviderReceiptRows, deriveRouteReceipt } from './dataTrust';

const NOW = 1_700_000_000_000;

function quoteReceipt(input: {
  providerId?: string;
  providerVersion?: string;
  provenance?: DataProvenance;
  limitations?: string[];
  note?: string;
  instrument?: string;
  venue?: string | null;
} = {}): DataReceipt {
  const provenance = input.provenance ?? 'synthetic';
  return createDataReceipt(
    {
      providerId: input.providerId ?? 'mock',
      providerVersion: input.providerVersion ?? '1.0.0',
      source: 'mock',
      venue: input.venue ?? null,
      datasetFamily: 'quote',
      instrument: input.instrument ?? 'BTC/USDT',
      coverage: 'one symbol',
      provenance,
      sourceAsOf: provenance === 'unavailable' ? null : NOW - 1_000,
      observedAt: NOW,
      expectedCadenceMs: 60_000,
      maxAgeMs: 120_000,
      units: { price: 'USDT' },
      limitations:
        input.limitations ?? (provenance === 'unavailable' ? ['No observation is available.'] : []),
      note:
        input.note ??
        (provenance === 'unavailable'
          ? 'No quote observation is available.'
          : provenance === 'synthetic'
            ? 'Synthetic quote fixture.'
            : null),
    },
    NOW,
  );
}

function quotePayload<T extends object>(receipt: DataReceipt, payload: T): T & {
  asOf: number | null;
  receipt: DataReceipt;
} {
  return {
    ...payload,
    asOf: receipt.sourceAsOf === null ? null : Date.parse(receipt.sourceAsOf),
    receipt,
  };
}

function providerWithQuoteCapability(
  patch: Partial<ProviderCapability>,
): MockProvider {
  const provider = new MockProvider(() => NOW);
  const capability = provider.capabilities.capabilities.quote;
  const capabilities: ProviderCapabilityManifest = {
    ...provider.capabilities,
    capabilities: {
      ...provider.capabilities.capabilities,
      quote: { ...capability, ...patch },
    },
  };
  Object.defineProperty(provider, 'capabilities', { value: capabilities });
  return provider;
}

describe('provider receipt boundary', () => {
  it.each([
    ['provider id', quoteReceipt({ providerId: 'impostor' })],
    ['provider version', quoteReceipt({ providerVersion: '9.9.9' })],
    ['manifest source mode', quoteReceipt({ provenance: 'live' })],
  ])('rejects a receipt with mismatched %s', (_label, receipt) => {
    const provider = new MockProvider(() => NOW);
    const tracker = createDataStatusTracker(() => NOW);

    expect(() =>
      attachProviderReceipt(
        provider,
        'quote',
        quotePayload(receipt, { value: 1 }),
        'trace-1',
        tracker,
        undefined,
        NOW,
      ),
    ).toThrowError(ProviderError);
    expect(tracker.snapshot(provider).quote).toMatchObject({
      state: 'unavailable',
      errorCategory: 'malformed-upstream',
      provenance: null,
      sourceMode: 'synthetic',
    });
  });

  it.each([
    [
      'unsupported',
      { support: 'unsupported', auth: 'none', mode: 'unavailable' } satisfies Partial<ProviderCapability>,
      'unsupported',
    ],
    [
      'credentials-required but not configured',
      {
        support: 'conditional',
        auth: 'credentials-required',
        mode: 'unavailable',
        caveats: ['Read-only credentials are not configured.'],
      } satisfies Partial<ProviderCapability>,
      'not-configured',
    ],
    [
      'credentials-required runtime unavailable despite a declared live mode',
      {
        support: 'conditional',
        auth: 'credentials-required',
        mode: 'live',
      } satisfies Partial<ProviderCapability>,
      'not-configured',
    ],
    [
      'runtime upstream outage',
      { support: 'supported', auth: 'none', mode: 'synthetic' } satisfies Partial<ProviderCapability>,
      'upstream-unavailable',
    ],
  ] as const)(
    'classifies an unavailable receipt as %s',
    (_label, capability, expectedCategory) => {
      const provider = providerWithQuoteCapability(capability);
      const tracker = createDataStatusTracker(() => NOW);
      const payload = attachProviderReceipt(
        provider,
        'quote',
        quotePayload(quoteReceipt({ provenance: 'unavailable' }), { value: null }),
        'trace-2',
        tracker,
        undefined,
        NOW,
      );

      expect(payload.receipt.provenance).toBe('unavailable');
      expect(tracker.snapshot(provider).quote).toMatchObject({
        state: 'unavailable',
        errorCategory: expectedCategory,
        provenance: 'unavailable',
        sourceMode: capability.mode,
      });
    },
  );

  it.each([
    [
      'a configured provider whose account type has no positions method',
      {
        support: 'conditional',
        auth: 'credentials-required',
        mode: 'unavailable',
        caveats: [],
      } satisfies Partial<ProviderCapability>,
      'ccxt:binance does not expose a fetchPositions endpoint.',
    ],
    [
      'a configured provider whose fills endpoint requires a symbol',
      {
        support: 'conditional',
        auth: 'credentials-required',
        mode: 'live',
        caveats: [],
      } satisfies Partial<ProviderCapability>,
      'ccxt:binance requires a symbol for fills.',
    ],
  ] as const)('classifies %s as unsupported, not not-configured', (_label, capability, note) => {
    const provider = providerWithQuoteCapability(capability);
    const tracker = createDataStatusTracker(() => NOW);
    attachProviderReceipt(
      provider,
      'quote',
      quotePayload(quoteReceipt({ provenance: 'unavailable', note }), { value: null }),
      'trace-runtime-unavailable',
      tracker,
      undefined,
      NOW,
    );

    expect(tracker.snapshot(provider).quote).toMatchObject({
      state: 'unavailable',
      errorCategory: 'unsupported',
      provenance: 'unavailable',
      sourceMode: capability.mode,
    });
  });

  it('degrades a fresh receipt that explicitly reports partial upstream evidence', () => {
    const provider = new MockProvider(() => NOW);
    const tracker = createDataStatusTracker(() => NOW);
    attachProviderReceipt(
      provider,
      'quote',
      quotePayload(
        quoteReceipt({
          limitations: [partialEvidenceLimitation('The upstream read failed; this snapshot is partial.')],
        }),
        { value: 1 },
      ),
      'trace-3',
      tracker,
      undefined,
      NOW,
    );

    expect(tracker.snapshot(provider).quote).toMatchObject({
      state: 'degraded',
      errorCategory: 'partial',
      freshness: { state: 'fresh' },
    });
  });

  it('propagates inherited partial evidence into a derived family status immediately', () => {
    const provider = new MockProvider(() => NOW);
    const tracker = createDataStatusTracker(() => NOW);
    const receipt = deriveRouteReceipt(
      provider,
      {
        family: 'liquidations',
        coverage: 'one screened symbol',
        inputReceipts: [quoteReceipt({
          limitations: [partialEvidenceLimitation('The liquidation upstream read failed.')],
        })],
        methodology: {
          id: 'test-liquidation-assembly',
          version: '1',
          formula: 'merge input events',
        },
        traceId: 'trace-derived-partial',
      },
      tracker,
      null,
      NOW,
    );

    expect(receipt.limitations).toContain(
      'Partial evidence: The liquidation upstream read failed.',
    );
    expect(tracker.snapshot(provider).liquidations).toMatchObject({
      state: 'degraded',
      errorCategory: 'partial',
    });
  });

  it('keeps an unknown source timestamp unknown instead of relabelling it partial', () => {
    const provider = new MockProvider(() => NOW);
    const tracker = createDataStatusTracker(() => NOW);
    const receipt = createDataReceipt(
      {
        providerId: 'mock',
        providerVersion: '1.0.0',
        source: 'mock',
        datasetFamily: 'quote',
        instrument: 'BTC/USDT',
        provenance: 'synthetic',
        sourceAsOf: null,
        observedAt: NOW,
        maxAgeMs: 120_000,
        note: 'Synthetic quote with no upstream source time.',
      },
      NOW,
    );
    attachProviderReceipt(
      provider,
      'quote',
      quotePayload(receipt, { value: 1 }),
      'trace-unknown-time',
      tracker,
      undefined,
      NOW,
    );

    expect(tracker.snapshot(provider).quote).toMatchObject({
      state: 'unknown',
      errorCategory: 'unknown',
      freshness: { state: 'unknown', ageMs: null },
    });
  });

  it.each(['missing', 'malformed', 'partial'])('does not infer completeness from static %s prose', (word) => {
    const provider = new MockProvider(() => NOW);
    const tracker = createDataStatusTracker(() => NOW);
    attachProviderReceipt(
      provider,
      'quote',
      quotePayload(quoteReceipt({ limitations: [`One optional field is ${word}.`] }), { value: 1 }),
      `trace-${word}`,
      tracker,
      undefined,
      NOW,
    );
    expect(tracker.snapshot(provider).quote).toMatchObject({
      state: 'healthy',
      errorCategory: null,
    });
  });

  it.each([
    ['partial evidence first', 'partial', 'healthy'],
    ['partial evidence last', 'healthy', 'partial'],
    ['unavailable evidence first', 'unavailable', 'healthy'],
    ['unavailable evidence last', 'healthy', 'unavailable'],
  ] as const)('aggregates %s without depending on direct-array row order', (_label, first, second) => {
    const provider = new MockProvider(() => NOW);
    const tracker = createDataStatusTracker(() => NOW);
    const row = (kind: 'healthy' | 'partial' | 'unavailable', symbol: string) => {
      const evidence =
        kind === 'unavailable'
          ? { provenance: 'unavailable' as const, note: 'One requested quote is unavailable.' }
          : kind === 'partial'
            ? { limitations: [partialEvidenceLimitation('This quote carries partial upstream evidence.')] }
            : {};
      const receipt = quoteReceipt({ ...evidence, instrument: symbol });
      return quotePayload(receipt, { symbol });
    };

    const attached = attachProviderReceiptRows(
      provider,
      'quote',
      [row(first, 'BTC/USDT'), row(second, 'ETH/USDT')],
      'trace-array',
      tracker,
      undefined,
      NOW,
    );

    expect(attached).toHaveLength(2);
    expect(tracker.snapshot(provider).quote).toMatchObject({
      state: 'degraded',
      errorCategory: 'partial',
      provenance: 'synthetic',
      freshness: { state: 'fresh' },
    });
  });

  it('rejects a payload whose instrument contradicts its receipt', () => {
    const provider = new MockProvider(() => NOW);
    const tracker = createDataStatusTracker(() => NOW);
    expect(() =>
      attachProviderReceipt(
        provider,
        'quote',
        quotePayload(quoteReceipt({ instrument: 'BTC/USDT' }), { symbol: 'ETH/USDT' }),
        'trace-payload-mismatch',
        tracker,
        undefined,
        NOW,
      ),
    ).toThrowError(ProviderError);
    expect(tracker.snapshot(provider).quote?.errorCategory).toBe('malformed-upstream');
  });

  it('rejects self-consistent provider output for the wrong requested instrument', () => {
    const provider = new MockProvider(() => NOW);
    const tracker = createDataStatusTracker(() => NOW);
    expect(() =>
      attachProviderReceipt(
        provider,
        'quote',
        quotePayload(quoteReceipt({ instrument: 'ETH/USDT' }), { symbol: 'ETH/USDT' }),
        'trace-request-mismatch',
        tracker,
        undefined,
        NOW,
        { instrument: 'BTC/USDT' },
      ),
    ).toThrowError(ProviderError);
  });

  it('rejects venue and duplicated provenance contradictions', () => {
    const provider = new MockProvider(() => NOW);
    const venueTracker = createDataStatusTracker(() => NOW);
    expect(() =>
      attachProviderReceipt(
        provider,
        'quote',
        quotePayload(quoteReceipt({ venue: 'binance' }), {
          exchange: 'Kraken',
          provenance: 'synthetic',
        }),
        'trace-venue-mismatch',
        venueTracker,
        undefined,
        NOW,
      ),
    ).toThrowError(ProviderError);

    const provenanceTracker = createDataStatusTracker(() => NOW);
    expect(() =>
      attachProviderReceipt(
        provider,
        'quote',
        quotePayload(quoteReceipt(), { provenance: 'live' }),
        'trace-provenance-mismatch',
        provenanceTracker,
        undefined,
        NOW,
      ),
    ).toThrowError(ProviderError);
  });

  it('rejects duplicate canonical venues in cross-venue evidence', () => {
    const provider = new MockProvider(() => NOW);
    const tracker = createDataStatusTracker(() => NOW);
    const row = (exchange: string) => ({
      exchange,
      timestamp: NOW - 1_000,
      receipt: createDataReceipt(
        {
          providerId: 'mock',
          providerVersion: '1.0.0',
          source: 'mock',
          venue: exchange,
          datasetFamily: 'venue-quotes',
          instrument: 'BTC/USDT',
          provenance: 'synthetic',
          sourceAsOf: NOW - 1_000,
          observedAt: NOW,
          maxAgeMs: 30_000,
          note: 'Synthetic venue quote fixture.',
        },
        NOW,
      ),
    });

    expect(() =>
      attachProviderReceiptRows(
        provider,
        'venue-quotes',
        [row('Binance'), row('binance')],
        'trace-duplicate-venue',
        tracker,
        undefined,
        NOW,
        { instrument: 'BTC/USDT' },
      ),
    ).toThrowError(ProviderError);
    expect(tracker.snapshot(provider)['venue-quotes']).toMatchObject({
      state: 'unavailable',
      errorCategory: 'malformed-upstream',
    });
  });

  it('rejects a payload timestamp that contradicts fresh receipt evidence', () => {
    const provider = new MockProvider(() => NOW);
    const tracker = createDataStatusTracker(() => NOW);
    expect(() =>
      attachProviderReceipt(
        provider,
        'quote',
        { asOf: NOW - 86_400_000, receipt: quoteReceipt() },
        'trace-time-mismatch',
        tracker,
        undefined,
        NOW,
      ),
    ).toThrowError(ProviderError);
    expect(tracker.snapshot(provider).quote?.errorCategory).toBe('malformed-upstream');
  });
});
