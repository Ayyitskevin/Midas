import { describe, it, expect } from 'vitest';
import { fmtPrice, fmtCompact, fmtSignedPercent, changeClass } from '@/lib/format';

describe('fmtPrice', () => {
  it('renders an em-dash for nullish / NaN', () => {
    expect(fmtPrice(null)).toBe('—');
    expect(fmtPrice(undefined)).toBe('—');
    expect(fmtPrice(NaN)).toBe('—');
  });

  it('uses two decimals with grouping for normal prices', () => {
    expect(fmtPrice(1234.5)).toBe('1,234.50');
  });

  it('uses four decimals for sub-dollar instruments', () => {
    expect(fmtPrice(0.25)).toBe('0.2500');
  });
});

describe('fmtCompact', () => {
  it('scales by magnitude with a sign', () => {
    expect(fmtCompact(1500)).toBe('1.50K');
    expect(fmtCompact(2_300_000)).toBe('2.30M');
    expect(fmtCompact(4_000_000_000)).toBe('4.00B');
    expect(fmtCompact(-5000)).toBe('-5.00K');
    expect(fmtCompact(999)).toBe('999');
  });
});

describe('fmtSignedPercent', () => {
  it('prefixes a plus for gains only', () => {
    expect(fmtSignedPercent(1.23)).toBe('+1.23%');
    expect(fmtSignedPercent(-1.23)).toBe('-1.23%');
    expect(fmtSignedPercent(0)).toBe('0.00%');
  });
});

describe('changeClass', () => {
  it('maps sign to a theme color class', () => {
    expect(changeClass(5)).toBe('text-term-up');
    expect(changeClass(-5)).toBe('text-term-down');
    expect(changeClass(0)).toBe('text-term-muted');
    expect(changeClass(null)).toBe('text-term-muted');
  });
});
