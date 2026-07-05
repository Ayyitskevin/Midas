import { describe, it, expect } from 'vitest';
import {
  alertOpForLevel,
  conditionMet,
  evaluateAlerts,
  newTriggersSince,
  opSymbol,
  formatThreshold,
  formatActual,
  priceDecimals,
  describeThreshold,
  type Alert,
  type AlertTrigger,
  type Readings,
} from '@/lib/alerts';

function mk(over: Partial<Alert> = {}): Alert {
  return {
    id: 'a1',
    symbol: 'BTC/USDT',
    metric: 'price',
    op: 'above',
    value: 70000,
    enabled: true,
    repeat: false,
    status: 'armed',
    lastValue: null,
    createdAt: 0,
    triggeredAt: null,
    ...over,
  };
}

function tick(a: Alert, r: Readings): { a: Alert; fired: number } {
  const { next, fired } = evaluateAlerts([a], r, 1000);
  return { a: next[0], fired: fired.length };
}

describe('conditionMet', () => {
  it('treats above/below as inclusive', () => {
    expect(conditionMet(70000, 'above', 70000)).toBe(true);
    expect(conditionMet(69999, 'above', 70000)).toBe(false);
    expect(conditionMet(70000, 'below', 70000)).toBe(true);
    expect(conditionMet(70001, 'below', 70000)).toBe(false);
  });
});

describe('evaluateAlerts — one-shot price above', () => {
  it('fires once on the up-crossing and then latches', () => {
    let s = tick(mk(), { 'BTC/USDT': { price: 69000 } });
    expect(s.fired).toBe(0);
    expect(s.a.status).toBe('armed');
    expect(s.a.lastValue).toBe(69000);

    s = tick(s.a, { 'BTC/USDT': { price: 70500 } });
    expect(s.fired).toBe(1);
    expect(s.a.status).toBe('triggered');

    s = tick(s.a, { 'BTC/USDT': { price: 71000 } });
    expect(s.fired).toBe(0); // still above → no re-fire

    s = tick(s.a, { 'BTC/USDT': { price: 60000 } });
    expect(s.fired).toBe(0);
    expect(s.a.status).toBe('triggered'); // one-shot never re-arms
  });
});

describe('evaluateAlerts — repeatable funding below', () => {
  it('re-arms once the condition clears and fires again', () => {
    let s = tick(mk({ metric: 'funding', op: 'below', value: 0, repeat: true }), {
      'BTC/USDT': { funding: 0.01 },
    });
    expect(s.fired).toBe(0);

    s = tick(s.a, { 'BTC/USDT': { funding: -0.02 } });
    expect(s.fired).toBe(1);
    expect(s.a.status).toBe('triggered');

    s = tick(s.a, { 'BTC/USDT': { funding: -0.03 } });
    expect(s.fired).toBe(0); // still met

    s = tick(s.a, { 'BTC/USDT': { funding: 0.01 } });
    expect(s.fired).toBe(0);
    expect(s.a.status).toBe('armed'); // re-armed

    s = tick(s.a, { 'BTC/USDT': { funding: -0.05 } });
    expect(s.fired).toBe(1); // second fire
  });
});

describe('evaluateAlerts — safety', () => {
  it('never fires a disabled alert', () => {
    const s = tick(mk({ enabled: false }), { 'BTC/USDT': { price: 999999 } });
    expect(s.fired).toBe(0);
    expect(s.a.status).toBe('armed');
  });

  it('ignores a missing reading without crashing', () => {
    const s = tick(mk(), {});
    expect(s.fired).toBe(0);
    expect(s.a.lastValue).toBeNull();
  });

  it('ignores a reading for the other metric', () => {
    const s = tick(mk({ metric: 'price', op: 'below', value: 100 }), { 'BTC/USDT': { funding: 5 } });
    expect(s.fired).toBe(0);
    expect(s.a.status).toBe('armed');
  });

  it('emits a distinct trigger id per fire', () => {
    const { fired } = evaluateAlerts(
      [mk({ id: 'x' }), mk({ id: 'y', symbol: 'ETH/USDT' })],
      { 'BTC/USDT': { price: 80000 }, 'ETH/USDT': { price: 80000 } },
      1000,
    );
    expect(fired).toHaveLength(2);
    expect(fired[0].id).not.toBe(fired[1].id);
  });
});

describe('formatting', () => {
  it('opSymbol maps direction', () => {
    expect(opSymbol('above')).toBe('≥');
    expect(opSymbol('below')).toBe('≤');
  });

  it('formatThreshold distinguishes price and percent', () => {
    expect(formatThreshold('funding', 0.05)).toBe('0.05%');
    expect(formatThreshold('price', 70000)).toContain('70,000');
  });

  it('formatActual handles null and funding precision', () => {
    expect(formatActual('price', null)).toBe('—');
    expect(formatActual('funding', 0.0123)).toBe('0.0123%');
  });

  it('describeThreshold reads naturally', () => {
    expect(describeThreshold(mk({ metric: 'price', op: 'above', value: 70000 }))).toContain('price ≥');
  });

  it('opSymbol and formatActual cover the new op / metric', () => {
    expect(opSymbol('cross')).toBe('⇄');
    expect(formatActual('change', -5.234)).toBe('-5.23%');
  });

  it('alertOpForLevel arms above/below relative to the current price', () => {
    expect(alertOpForLevel(72000, 70000)).toBe('above');
    expect(alertOpForLevel(68000, 70000)).toBe('below');
    expect(alertOpForLevel(70000, 70000)).toBe('above'); // at the price → above
  });
});

describe('evaluateAlerts — 24h %-change metric', () => {
  it('reads the change reading and fires below a negative threshold', () => {
    let s = tick(mk({ metric: 'change', op: 'below', value: -5 }), { 'BTC/USDT': { change: -3 } });
    expect(s.fired).toBe(0);
    s = tick(s.a, { 'BTC/USDT': { change: -6 } });
    expect(s.fired).toBe(1);
  });
});

describe('evaluateAlerts — cross trigger', () => {
  it('does not fire on the first tick (no previous reading)', () => {
    const s = tick(mk({ op: 'cross', value: 70000 }), { 'BTC/USDT': { price: 80000 } });
    expect(s.fired).toBe(0);
    expect(s.a.lastValue).toBe(80000);
  });

  it('fires when crossing up through the level', () => {
    let s = tick(mk({ op: 'cross', value: 70000 }), { 'BTC/USDT': { price: 69000 } });
    expect(s.fired).toBe(0);
    s = tick(s.a, { 'BTC/USDT': { price: 71000 } });
    expect(s.fired).toBe(1);
  });

  it('fires when crossing down through the level', () => {
    let s = tick(mk({ op: 'cross', value: 70000 }), { 'BTC/USDT': { price: 71000 } });
    expect(s.fired).toBe(0);
    s = tick(s.a, { 'BTC/USDT': { price: 69000 } });
    expect(s.fired).toBe(1);
  });

  it('one-shot cross latches after firing', () => {
    let s = tick(mk({ op: 'cross', value: 70000, repeat: false }), { 'BTC/USDT': { price: 69000 } });
    s = tick(s.a, { 'BTC/USDT': { price: 71000 } }); // cross up → fire
    expect(s.fired).toBe(1);
    expect(s.a.status).toBe('triggered');
    s = tick(s.a, { 'BTC/USDT': { price: 69000 } }); // cross back → latched, no fire
    expect(s.fired).toBe(0);
  });

  it('repeatable cross fires on every crossing', () => {
    let s = tick(mk({ op: 'cross', value: 70000, repeat: true }), { 'BTC/USDT': { price: 69000 } });
    s = tick(s.a, { 'BTC/USDT': { price: 71000 } });
    expect(s.fired).toBe(1);
    expect(s.a.status).toBe('armed');
    s = tick(s.a, { 'BTC/USDT': { price: 69000 } });
    expect(s.fired).toBe(1);
    s = tick(s.a, { 'BTC/USDT': { price: 71000 } });
    expect(s.fired).toBe(1);
  });
});

describe('newTriggersSince', () => {
  const mkT = (id: string): AlertTrigger => ({
    id,
    alertId: 'a',
    symbol: 'BTC/USDT',
    metric: 'price',
    op: 'above',
    value: 1,
    actual: 2,
    at: 0,
  });

  it('returns nothing on the first look (null seen id)', () => {
    expect(newTriggersSince([mkT('t1')], null)).toEqual([]);
  });

  it('returns the triggers newer than the seen id', () => {
    const log = [mkT('t3'), mkT('t2'), mkT('t1')]; // newest first
    expect(newTriggersSince(log, 't1').map((t) => t.id)).toEqual(['t3', 't2']);
  });

  it('returns nothing when the seen id has fallen off the log', () => {
    expect(newTriggersSince([mkT('t2'), mkT('t1')], 'gone')).toEqual([]);
  });
});

describe('sub-cent price formatting (alerts)', () => {
  it('scales decimals so a sub-cent token price is not rendered as 0.0000', () => {
    expect(priceDecimals(0.0000234)).toBe(8);
    expect(priceDecimals(0.023)).toBe(6);
    expect(priceDecimals(70_000)).toBe(2);
    // The bug: default 2/4 decimals rendered these as "0.0000".
    expect(formatThreshold('price', 0.0000234)).not.toBe('0.0000');
    expect(formatThreshold('price', 0.0000234)).toContain('0.0000234');
    expect(formatActual('price', 0.0000234)).toContain('0.0000234');
  });

  it('leaves normal-magnitude prices at two decimals', () => {
    expect(formatThreshold('price', 70_000)).toBe('70,000.00');
    expect(formatActual('price', 3_000)).toBe('3,000.00');
  });
});
