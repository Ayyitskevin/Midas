import { describe, it, expect } from 'vitest';
import type { TermStructurePoint } from '@midas/shared';
import {
  classifyTermStructure,
  fmtBasis,
  fmtDays,
  fmtExpiry,
  fmtIv,
  optionsBadge,
  pcrLabel,
} from './optionsView';

const point = (basis: number): TermStructurePoint => ({
  expiry: 1_800_000_000_000,
  futureSymbol: 'BTC-X',
  price: 100,
  annualizedBasisPct: basis,
  daysToExpiry: 30,
});

describe('optionsBadge', () => {
  it('never maps synthetic to a live label', () => {
    expect(optionsBadge('live', null).tone).toBe('live');
    const syn = optionsBadge('synthetic', 'demo data');
    expect(syn.tone).toBe('synthetic');
    expect(syn.label).not.toMatch(/live/i);
    expect(syn.detail).toBe('demo data');
    expect(optionsBadge('unavailable', 'no venue').tone).toBe('unavailable');
  });
});

describe('classifyTermStructure', () => {
  it('reads contango, backwardation and mixed curves', () => {
    expect(classifyTermStructure({ points: [point(3), point(6), point(8)] })).toBe('contango');
    expect(classifyTermStructure({ points: [point(-2), point(-4)] })).toBe('backwardation');
    expect(classifyTermStructure({ points: [point(-2), point(4)] })).toBe('mixed');
    expect(classifyTermStructure({ points: [point(0.1), point(0.2)] })).toBe('mixed'); // ~flat
  });

  it('is null with fewer than two points — one future is not a term structure', () => {
    expect(classifyTermStructure({ points: [] })).toBeNull();
    expect(classifyTermStructure({ points: [point(9)] })).toBeNull();
  });
});

describe('formatters', () => {
  it('fmtBasis signs the percent and is honest for null', () => {
    expect(fmtBasis(6.25)).toBe('+6.25%');
    expect(fmtBasis(-1.5)).toBe('-1.50%');
    expect(fmtBasis(null)).toBe('—');
  });

  it('fmtIv and fmtExpiry and fmtDays degrade to an em-dash', () => {
    expect(fmtIv(55.04)).toBe('55.0');
    expect(fmtIv(null)).toBe('—');
    expect(fmtExpiry(0)).toBe('—');
    expect(fmtExpiry(Number.NaN)).toBe('—');
    expect(fmtDays(30)).toBe('30d');
    expect(fmtDays(3.25)).toBe('3.3d');
    expect(fmtDays(0)).toBe('—');
  });

  it('pcrLabel reads positioning', () => {
    expect(pcrLabel(1.5)).toBe('put-heavy');
    expect(pcrLabel(0.5)).toBe('call-heavy');
    expect(pcrLabel(1.0)).toBe('balanced');
    expect(pcrLabel(null)).toBe('—');
  });
});
