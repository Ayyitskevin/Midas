import { describe, it, expect } from 'vitest';
import { mtfConsensus } from './mtf';

describe('mtfConsensus', () => {
  it('is fully bullish when every frame trends up', () => {
    const c = mtfConsensus(['up', 'up', 'up', 'up']);
    expect(c.up).toBe(4);
    expect(c.down).toBe(0);
    expect(c.total).toBe(4);
    expect(c.verdict).toBe('bullish');
    expect(c.alignedPct).toBe(100);
  });

  it('is fully bearish when every frame trends down', () => {
    const c = mtfConsensus(['down', 'down', 'down']);
    expect(c.verdict).toBe('bearish');
    expect(c.alignedPct).toBe(100);
  });

  it('takes the majority and reports alignment', () => {
    const c = mtfConsensus(['up', 'up', 'down']);
    expect(c.verdict).toBe('bullish');
    expect(c.alignedPct).toBeCloseTo((2 / 3) * 100, 10);
  });

  it('calls a tie mixed', () => {
    expect(mtfConsensus(['up', 'down']).verdict).toBe('mixed');
  });

  it('ignores null frames', () => {
    const c = mtfConsensus(['up', null, 'down', 'up']);
    expect(c.total).toBe(3);
    expect(c.verdict).toBe('bullish');
    expect(c.alignedPct).toBeCloseTo((2 / 3) * 100, 10);
  });

  it('is "none" with no usable frames', () => {
    const c = mtfConsensus([null, null]);
    expect(c.total).toBe(0);
    expect(c.verdict).toBe('none');
    expect(c.alignedPct).toBe(0);
    expect(mtfConsensus([]).verdict).toBe('none');
  });
});
