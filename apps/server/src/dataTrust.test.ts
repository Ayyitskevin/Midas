import { describe, expect, it } from 'vitest';
import {
  computeReceiptFreshness,
  createDataReceipt,
  deriveDataReceipt,
  isPartialEvidenceLimitation,
  partialEvidenceLimitation,
  sanitizeReceiptText,
  stableStringify,
  validateDataReceipt,
  withDataReceipt,
  withReceiptTransport,
} from '@midas/shared';

const NOW = Date.parse('2026-08-01T12:00:00.000Z');

const observed = (overrides: Partial<Parameters<typeof createDataReceipt>[0]> = {}) =>
  createDataReceipt({
    providerId: 'test',
    providerVersion: '1.0.0',
    source: 'fixture',
    datasetFamily: 'quote',
    instrument: 'BTC/USDT',
    provenance: 'live',
    sourceAsOf: NOW - 1_000,
    observedAt: NOW,
    maxAgeMs: 5_000,
    units: { price: 'USDT' },
    ...overrides,
  }, NOW);

describe('DataReceipt contract', () => {
  it('attaches evidence additively without mutating a legacy payload', () => {
    const legacyPayload = {
      symbol: 'BTC/USDT',
      price: 65_000,
      nested: { currency: 'USDT' },
      nullableLegacyField: null,
    };
    const snapshot = JSON.parse(JSON.stringify(legacyPayload));
    const receipt = observed();
    const attached = withDataReceipt(legacyPayload, receipt);

    expect(legacyPayload).toEqual(snapshot);
    expect(Object.prototype.hasOwnProperty.call(legacyPayload, 'receipt')).toBe(false);
    expect(Object.fromEntries(Object.entries(attached).filter(([key]) => key !== 'receipt')))
      .toEqual(snapshot);
    expect(attached.receipt).toBe(receipt);
    expect(attached).not.toBe(legacyPayload);
  });

  it('canonicalizes object keys and keeps identity stable across cache/trace transport only', () => {
    expect(stableStringify({ z: 1, a: { y: 2, x: 3 } })).toBe('{"a":{"x":3,"y":2},"z":1}');
    const first = observed({ observedAt: NOW });
    const later = observed({ observedAt: NOW + 10_000 });
    expect(later.receiptId).not.toBe(first.receiptId);

    const transported = withReceiptTransport(first, {
      traceId: 'request-2',
      cache: { status: 'hit', ageMs: 2_000 },
    }, NOW + 2_000);
    expect(transported.receiptId).toBe(first.receiptId);
    expect(transported.cache).toEqual({ status: 'hit', ageMs: 2_000 });
    expect(validateDataReceipt(transported).ok).toBe(true);
  });

  it('uses observation time to disambiguate otherwise-identical unknown-time evidence', () => {
    const first = observed({ sourceAsOf: null, observedAt: NOW });
    const next = observed({ sourceAsOf: null, observedAt: NOW + 1 });
    expect(next.receiptId).not.toBe(first.receiptId);
    expect(withReceiptTransport(first, { cache: { status: 'hit', ageMs: 10 } }, NOW + 10).receiptId)
      .toBe(first.receiptId);
  });

  it('rejects a receipt whose claimed id no longer matches its source identity', () => {
    const receipt = observed();
    const tampered = { ...receipt, instrument: 'ETH/USDT' };
    const checked = validateDataReceipt(tampered);
    expect(checked.ok).toBe(false);
    if (!checked.ok) expect(checked.errors).toContain('receiptId does not match receipt source identity');
  });

  it('marks future source clocks explicitly and preserves the negative offset', () => {
    const receipt = observed({ sourceAsOf: NOW + 4_000 });
    expect(receipt.freshness).toEqual({ state: 'clock-skew', ageMs: -4_000 });
  });

  it('treats the exact max-age boundary as fresh and the next millisecond as stale', () => {
    const sourceAsOf = '2026-08-01T11:59:55.000Z';
    expect(computeReceiptFreshness(sourceAsOf, 5_000, NOW)).toEqual({ state: 'fresh', ageMs: 5_000 });
    expect(computeReceiptFreshness(sourceAsOf, 5_000, NOW + 1)).toEqual({ state: 'stale', ageMs: 5_001 });
  });

  it('adds an explicit limitation when source time is unknown', () => {
    const receipt = observed({ sourceAsOf: null, limitations: [] });
    expect(receipt.freshness).toEqual({ state: 'unknown', ageMs: null });
    expect(receipt.limitations).toContain('Upstream source timestamp is unavailable.');
  });

  it('propagates worst-input freshness and explicit lineage for derivations', () => {
    const fresh = observed({ sourceAsOf: NOW - 1_000 });
    const stale = observed({ datasetFamily: 'history', sourceAsOf: NOW - 20_000 });
    const unknown = observed({ datasetFamily: 'open-interest-history', sourceAsOf: null });
    const skewed = observed({ datasetFamily: 'open-interest', sourceAsOf: NOW + 3_000 });
    const derived = deriveDataReceipt({
      providerId: 'test',
      providerVersion: '1.0.0',
      source: 'fixture',
      datasetFamily: 'open-interest-delta',
      instrument: 'BTC/USDT',
      provenance: 'live',
      inputReceipts: [fresh, stale, unknown, skewed],
      methodology: { id: 'delta', version: '1.0.0', formula: '(now/then)-1' },
    }, NOW);
    expect(derived.freshness).toEqual({ state: 'clock-skew', ageMs: -3_000 });
    expect(derived.inputReceiptIds).toEqual([
      fresh.receiptId,
      stale.receiptId,
      unknown.receiptId,
      skewed.receiptId,
    ]);
    expect(validateDataReceipt(derived).ok).toBe(true);
  });

  it('never lets derived evidence masquerade as more trustworthy provenance', () => {
    const synthetic = observed({ provenance: 'synthetic', note: 'Synthetic fixture evidence.' });
    const derived = deriveDataReceipt({
      providerId: 'test', providerVersion: '1.0.0', source: 'fixture',
      datasetFamily: 'venue-arbitrage', provenance: 'live', inputReceipts: [synthetic],
      methodology: { id: 'arb', version: '1.0.0', formula: 'bid-ask-fees' },
    }, NOW);
    expect(derived.provenance).toBe('synthetic');
    expect(derived.note).toMatch(/synthetic input evidence/i);
    expect(validateDataReceipt(derived).ok).toBe(true);
  });

  it('keeps unavailable derivations untimestamped and unknown even when another input is stale', () => {
    const stale = observed({ sourceAsOf: NOW - 20_000 });
    const unavailable = observed({
      provenance: 'unavailable',
      sourceAsOf: null,
      note: 'Fixture observation unavailable.',
    });
    const derived = deriveDataReceipt({
      providerId: 'test', providerVersion: '1.0.0', source: 'fixture',
      datasetFamily: 'venue-arbitrage', provenance: 'live', inputReceipts: [stale, unavailable],
      methodology: { id: 'arb', version: '1.0.0', formula: 'bid-ask-fees' },
    }, NOW);
    expect(derived.provenance).toBe('unavailable');
    expect(derived.sourceAsOf).toBeNull();
    expect(derived.freshness).toEqual({ state: 'unknown', ageMs: null });
    expect(validateDataReceipt(derived).ok).toBe(true);
  });

  it('does not let cache/transport refresh erase an unknown derived input', () => {
    const fresh = observed({ sourceAsOf: NOW - 1_000 });
    const unknown = observed({ datasetFamily: 'history', sourceAsOf: null });
    const derived = deriveDataReceipt({
      providerId: 'test', providerVersion: '1.0.0', source: 'fixture',
      datasetFamily: 'open-interest-delta', provenance: 'live',
      inputReceipts: [fresh, unknown],
      methodology: { id: 'delta', version: '1.0.0', formula: 'a-b' },
    }, NOW);
    expect(derived.freshness.state).toBe('unknown');
    const cached = withReceiptTransport(derived, { cache: { status: 'hit', ageMs: 5_000 } }, NOW + 2_000);
    expect(cached.freshness.state).toBe('unknown');
    expect(cached.receiptId).toBe(derived.receiptId);
  });

  it('keeps clock-skew evidence non-fresh through later transport evaluation', () => {
    const fresh = observed({ sourceAsOf: NOW - 1_000 });
    const skewed = observed({ datasetFamily: 'history', sourceAsOf: NOW + 4_000 });
    const derived = deriveDataReceipt({
      providerId: 'test', providerVersion: '1.0.0', source: 'fixture',
      datasetFamily: 'open-interest-delta', provenance: 'live',
      inputReceipts: [fresh, skewed],
      methodology: { id: 'delta', version: '1.0.0', formula: 'a-b' },
    }, NOW);
    expect(derived.freshness.state).toBe('clock-skew');
    expect(withReceiptTransport(derived, {}, NOW + 30_000).freshness.state).not.toBe('fresh');
  });

  it('honors an explicit null derived source time instead of falling back to a known input time', () => {
    const fresh = observed({ sourceAsOf: NOW - 1_000 });
    const derived = deriveDataReceipt({
      providerId: 'test', providerVersion: '1.0.0', source: 'fixture',
      datasetFamily: 'open-interest-delta', provenance: 'live', sourceAsOf: null,
      inputReceipts: [fresh],
      methodology: { id: 'delta', version: '1.0.0', formula: 'a-b' },
    }, NOW);
    expect(derived.sourceAsOf).toBeNull();
    expect(derived.freshness.state).toBe('unknown');
  });

  it('never lets a derived policy relax the oldest source time or shortest input max age', () => {
    const input = observed({ sourceAsOf: NOW, maxAgeMs: 30_000 });
    const derived = deriveDataReceipt({
      providerId: 'test', providerVersion: '1.0.0', source: 'fixture',
      datasetFamily: 'venue-arbitrage', provenance: 'live',
      sourceAsOf: NOW + 5_000, maxAgeMs: 40_000,
      inputReceipts: [input],
      methodology: { id: 'arb', version: '1.0.0', formula: 'bid-ask-fees' },
    }, NOW);
    expect(derived.sourceAsOf).toBe('2026-08-01T12:00:00.000Z');
    expect(derived.maxAgeMs).toBe(30_000);
    const aged = withReceiptTransport(derived, { cache: { status: 'hit', ageMs: 31_000 } }, NOW + 31_000);
    expect(aged.freshness).toEqual({ state: 'stale', ageMs: 31_000 });
  });

  it('rejects an invalid derived max-age policy instead of erasing an inherited bound', () => {
    const input = observed({ maxAgeMs: 30_000 });
    expect(() => deriveDataReceipt({
      providerId: 'test', providerVersion: '1.0.0', source: 'fixture',
      datasetFamily: 'venue-arbitrage', provenance: 'live', maxAgeMs: -1,
      inputReceipts: [input],
      methodology: { id: 'arb', version: '1.0.0', formula: 'bid-ask-fees' },
    }, NOW)).toThrow('Derived maxAgeMs must be non-negative or null');
  });

  it('fails loudly on invalid cadence and cache-age inputs', () => {
    expect(() => observed({ expectedCadenceMs: -1 })).toThrow('expectedCadenceMs must be non-negative or null');
    expect(() => observed({ cache: { status: 'hit', ageMs: -1 } })).toThrow('cache.ageMs must be non-negative or null');
    expect(() => withReceiptTransport(observed(), { cache: { status: 'hit', ageMs: -1 } }, NOW))
      .toThrow('cache.ageMs must be non-negative or null');
  });

  it('rejects invalid input receipts before admitting their lineage', () => {
    const input = observed();
    const tampered = { ...input, source: 'different-source' };
    expect(() => deriveDataReceipt({
      providerId: 'test', providerVersion: '1.0.0', source: 'fixture',
      datasetFamily: 'venue-arbitrage', provenance: 'live',
      inputReceipts: [tampered],
      methodology: { id: 'arb', version: '1.0.0', formula: 'bid-ask-fees' },
    }, NOW)).toThrow(/Invalid input data receipt at index 0/);
  });

  it('requires methodology and nonempty lineage for derived receipts', () => {
    expect(() => observed({ derivation: 'derived', methodology: null, inputReceiptIds: [] })).toThrow(
      /derived receipts require methodology.*inputReceiptId|derived receipts require at least one inputReceiptId.*methodology/,
    );
  });

  it('rejects unavailable receipts with source time/freshness and observed receipts with lineage', () => {
    expect(() => observed({
      provenance: 'unavailable',
      sourceAsOf: NOW,
      note: 'Fixture observation unavailable.',
    })).toThrow(/unavailable provenance requires null sourceAsOf.*unknown freshness|unknown freshness.*null sourceAsOf/);

    const unavailable = observed({
      provenance: 'unavailable', sourceAsOf: null, note: 'Fixture observation unavailable.',
    });
    const unavailableWithAge = validateDataReceipt({
      ...unavailable,
      freshness: { state: 'unknown', ageMs: 1 },
    });
    expect(unavailableWithAge.ok).toBe(false);
    if (!unavailableWithAge.ok) {
      expect(unavailableWithAge.errors).toContain(
        'unavailable provenance requires unknown freshness with null ageMs',
      );
    }

    const receipt = observed();
    const observedWithLineage = validateDataReceipt({ ...receipt, inputReceiptIds: [receipt.receiptId] });
    expect(observedWithLineage.ok).toBe(false);
    if (!observedWithLineage.ok) {
      expect(observedWithLineage.errors).toContain('observed receipts cannot carry inputReceiptIds');
    }
  });

  it('requires every schema key and exact nested freshness/cache shapes', () => {
    const receipt = observed();
    const { note: _note, ...missingNote } = receipt;
    const missingTopLevel = validateDataReceipt(missingNote);
    expect(missingTopLevel.ok).toBe(false);
    if (!missingTopLevel.ok) expect(missingTopLevel.errors).toContain('missing field: note');

    const { ageMs: _freshnessAge, ...freshnessWithoutAge } = receipt.freshness;
    const missingNested = validateDataReceipt({ ...receipt, freshness: freshnessWithoutAge });
    expect(missingNested.ok).toBe(false);
    if (!missingNested.ok) expect(missingNested.errors).toContain('invalid freshness fields');
  });

  it('rejects contradictory freshness, cache facts, and duplicate derived lineage', () => {
    const receipt = observed();
    const staleInsideFreshWindow = validateDataReceipt({
      ...receipt,
      freshness: { state: 'stale', ageMs: 1_000 },
    });
    expect(staleInsideFreshWindow.ok).toBe(false);
    if (!staleInsideFreshWindow.ok) {
      expect(staleInsideFreshWindow.errors).toContain('stale freshness ageMs must exceed maxAgeMs');
    }

    const hitWithoutAge = validateDataReceipt({ ...receipt, cache: { status: 'hit', ageMs: null } });
    expect(hitWithoutAge.ok).toBe(false);
    if (!hitWithoutAge.ok) expect(hitWithoutAge.errors).toContain('cache hit requires a non-negative ageMs');

    const derived = deriveDataReceipt({
      providerId: 'test', providerVersion: '1.0.0', source: 'fixture',
      datasetFamily: 'venue-arbitrage', provenance: 'live', inputReceipts: [receipt],
      methodology: { id: 'arb', version: '1.0.0', formula: 'bid-ask-fees' },
    }, NOW);
    const duplicateLineage = validateDataReceipt({
      ...derived,
      inputReceiptIds: [receipt.receiptId, receipt.receiptId],
    });
    expect(duplicateLineage.ok).toBe(false);
    if (!duplicateLineage.ok) {
      expect(duplicateLineage.errors).toContain('derived inputReceiptIds must be unique');
    }

    const malformedLineageId = validateDataReceipt({
      ...derived,
      inputReceiptIds: ['not-a-receipt-id'],
    });
    expect(malformedLineageId.ok).toBe(false);
    if (!malformedLineageId.ok) {
      expect(malformedLineageId.errors).toContain('inputReceiptIds must contain canonical receipt IDs');
    }
  });

  it('rejects unknown nested keys and secret/path-shaped content', () => {
    const receipt = observed();
    const nested = {
      ...receipt,
      freshness: { ...receipt.freshness, reassuring: true },
      cache: { ...receipt.cache, backend: 'redis' },
    };
    const nestedCheck = validateDataReceipt(nested);
    expect(nestedCheck.ok).toBe(false);
    if (!nestedCheck.ok) {
      expect(nestedCheck.errors).toContain('invalid freshness fields');
      expect(nestedCheck.errors).toContain('invalid cache fields');
    }

    const leaked = { ...receipt, limitations: ['{"apiKey":"super-secret-value"}'] };
    const leakCheck = validateDataReceipt(leaked);
    expect(leakCheck.ok).toBe(false);
    if (!leakCheck.ok) expect(leakCheck.errors).toContain('receipt contains secret-like or machine-local data');

    const missingUnknownTimeLimitation = { ...observed({ sourceAsOf: null }), limitations: [] };
    const missingLimitationCheck = validateDataReceipt(missingUnknownTimeLimitation);
    expect(missingLimitationCheck.ok).toBe(false);
    if (!missingLimitationCheck.ok) {
      expect(missingLimitationCheck.errors).toContain('unknown sourceAsOf requires an explicit limitation');
    }
  });

  it('rejects materialized authorization and cookie headers at the validation boundary', () => {
    const receipt = observed();
    for (const leakedHeader of [
      'Authorization: Basic dXNlcjpwYXNz',
      'Cookie: session=supersecret',
      'Set-Cookie: session=supersecret; HttpOnly',
      '{"Authorization":"Digest credential-value"}',
      'Basic dXNlcjpwYXNz',
    ]) {
      const checked = validateDataReceipt({ ...receipt, limitations: [leakedHeader] });
      expect(checked.ok, leakedHeader).toBe(false);
      if (!checked.ok) {
        expect(checked.errors).toContain('receipt contains secret-like or machine-local data');
      }
    }
  });

  it('fails closed when receipt creation is given an unsanitized credential header', () => {
    expect(() => observed({ limitations: ['Authorization: Basic dXNlcjpwYXNz'] }))
      .toThrow(/secret-like or machine-local data/);
    expect(() => observed({ limitations: ['Cookie: session=supersecret'] }))
      .toThrow(/secret-like or machine-local data/);
    expect(() => observed({ limitations: ['https://user:pass@example.com/private'] }))
      .toThrow(/secret-like or machine-local data/);
  });

  it('rejects and redacts common absolute POSIX machine paths', () => {
    for (const path of [
      '/opt/midas/.env',
      '/etc/passwd',
      '/var/run/midas.sock',
      '/srv/midas/config.json',
      '/tmp/private.json',
      '/root/.config/midas',
      '/run/secrets/midas',
      '/mnt/private/data.csv',
      '/usr/local/etc/midas.conf',
      '/app/server/.env',
      '/workspace/repo/.env',
      '/usr/bin/node',
      '/proc/self/environ',
      '/sys/kernel/debug',
      '/dev/shm/key',
      '/media/user/disk',
      '/private/etc/hosts',
      '/Applications/Midas/config.json',
      '/Library/Application Support/Midas/config.json',
      '/Volumes/private/data.csv',
    ]) {
      expect(() => observed({ limitations: [`Read failed at ${path}`] }), path)
        .toThrow(/secret-like or machine-local data/);
      const sanitized = sanitizeReceiptText(`Read failed at ${path}`);
      expect(sanitized, path).toBe('Read failed at [LOCAL_PATH]');
      expect(sanitized, path).not.toContain(path);
    }
    expect(sanitizeReceiptText('Formula: gross=(bid-ask)/ask')).toBe(
      'Formula: gross=(bid-ask)/ask',
    );
    expect(sanitizeReceiptText('Public URL https://example.com/opt/guide')).toBe(
      'Public URL https://example.com/opt/guide',
    );
  });

  it('rejects and redacts common bare credential signatures', () => {
    for (const credential of [
      `ghp_${'a'.repeat(36)}`,
      `AKIA${'A'.repeat(16)}`,
      `sk-proj-${'a'.repeat(24)}`,
      `${'a'.repeat(12)}.${'b'.repeat(12)}.${'c'.repeat(12)}`,
      '-----BEGIN PRIVATE KEY-----',
    ]) {
      expect(() => observed({ limitations: [credential] }), credential)
        .toThrow(/secret-like or machine-local data/);
      expect(sanitizeReceiptText(credential), credential).toBe('[REDACTED]');
    }
  });

  it('redacts secret-like values and machine-local paths without copying Error messages', () => {
    expect(sanitizeReceiptText('token=abcdefghi /home/kevin/private.txt')).toContain('token=[REDACTED]');
    expect(sanitizeReceiptText('token=abcdefghi /home/kevin/private.txt')).toContain('[LOCAL_PATH]');
    expect(sanitizeReceiptText('Authorization: Basic dXNlcjpwYXNz')).toBe('Authorization: [REDACTED]');
    expect(sanitizeReceiptText('Basic dXNlcjpwYXNz')).toBe('Basic [REDACTED]');
    expect(sanitizeReceiptText('Cookie: session=supersecret; theme=dark')).toBe('Cookie: [REDACTED]');
    expect(sanitizeReceiptText('Set-Cookie: session=supersecret; HttpOnly')).toBe('Set-Cookie: [REDACTED]');
    expect(sanitizeReceiptText('{"Authorization":"Bearer private-token"}'))
      .toBe('{"Authorization":"[REDACTED]"}');
    expect(sanitizeReceiptText('read https://user:pass@example.com/private'))
      .toBe('read https://[REDACTED]@example.com/private');
    expect(sanitizeReceiptText(new Error('signature=should-not-leak'))).toBe('Error');
  });

  it('marks result-specific incompleteness structurally without prose keyword inference', () => {
    const partial = partialEvidenceLimitation('1 of 3 venue reads failed.');
    expect(partial).toBe('Partial evidence: 1 of 3 venue reads failed.');
    expect(isPartialEvidenceLimitation(partial)).toBe(true);
    expect(isPartialEvidenceLimitation('Static caveat: partial rows are possible.')).toBe(false);
  });
});
