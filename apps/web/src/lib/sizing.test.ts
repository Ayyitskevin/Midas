import { describe, it, expect } from 'vitest';
import { convertSize, fieldValue, type SizeInputs } from '@/lib/sizing';

const base: Omit<SizeInputs, 'field' | 'value'> = { price: 100, account: 1000, leverage: 5 };

describe('convertSize', () => {
  it('derives the other three from quantity', () => {
    const r = convertSize({ ...base, field: 'qty', value: 2 });
    expect(r.valid).toBe(true);
    expect(r.notional).toBe(200);
    expect(r.pct).toBeCloseTo(20, 6);
    expect(r.margin).toBeCloseTo(40, 6); // 200 / 5×
  });

  it('derives from notional', () => {
    const r = convertSize({ ...base, field: 'notional', value: 500 });
    expect(r.qty).toBeCloseTo(5, 6);
    expect(r.pct).toBeCloseTo(50, 6);
    expect(r.margin).toBeCloseTo(100, 6);
  });

  it('derives from % of account', () => {
    const r = convertSize({ ...base, field: 'pct', value: 25 });
    expect(r.notional).toBeCloseTo(250, 6);
    expect(r.qty).toBeCloseTo(2.5, 6);
  });

  it('derives from margin via leverage', () => {
    const r = convertSize({ price: 50, account: 1000, leverage: 4, field: 'margin', value: 100 });
    expect(r.notional).toBeCloseTo(400, 6); // 100 × 4
    expect(r.qty).toBeCloseTo(8, 6);
  });

  it('treats leverage ≤0 / non-finite as 1× (spot)', () => {
    const r = convertSize({ ...base, leverage: 0, field: 'notional', value: 300 });
    expect(r.leverage).toBe(1);
    expect(r.margin).toBe(300); // margin == notional at 1×
  });

  it('blanks only quantity when the price is missing', () => {
    const r = convertSize({ price: NaN, account: 1000, leverage: 2, field: 'notional', value: 500 });
    expect(r.valid).toBe(true);
    expect(r.notional).toBe(500);
    expect(Number.isNaN(r.qty)).toBe(true);
    expect(r.pct).toBeCloseTo(50, 6);
  });

  it('blanks only the % when the account is missing', () => {
    const r = convertSize({ price: 100, account: NaN, leverage: 1, field: 'qty', value: 1 });
    expect(r.valid).toBe(true);
    expect(r.notional).toBe(100);
    expect(Number.isNaN(r.pct)).toBe(true);
  });

  it('is invalid when the canonical field needs a missing input', () => {
    // qty needs a price; without one there is no notional at all.
    const r = convertSize({ price: NaN, account: 1000, leverage: 2, field: 'qty', value: 2 });
    expect(r.valid).toBe(false);
    expect(Number.isNaN(r.notional)).toBe(true);
  });

  it('is invalid for a blank/NaN value', () => {
    const r = convertSize({ ...base, field: 'qty', value: NaN });
    expect(r.valid).toBe(false);
  });
});

describe('fieldValue', () => {
  it('selects the right member for each field', () => {
    const r = convertSize({ ...base, field: 'qty', value: 2 });
    expect(fieldValue(r, 'qty')).toBe(r.qty);
    expect(fieldValue(r, 'notional')).toBe(r.notional);
    expect(fieldValue(r, 'pct')).toBe(r.pct);
    expect(fieldValue(r, 'margin')).toBe(r.margin);
  });
});
