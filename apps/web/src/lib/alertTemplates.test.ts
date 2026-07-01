import { describe, it, expect } from 'vitest';
import { ACCOUNT_SYMBOL } from '@/lib/alerts';
import { ALERT_TEMPLATES } from './alertTemplates';

const byKey = (key: string) => {
  const t = ALERT_TEMPLATES.find((t) => t.key === key);
  if (!t) throw new Error(`template ${key} missing`);
  return t;
};

describe('alert templates', () => {
  it('funding flip arms a repeating cross at 0 on the panel symbol', () => {
    const built = byKey('funding-flip').build({ symbol: 'BTC/USDT', equityUsd: null });
    expect(built).toEqual({
      inputs: [
        { symbol: 'BTC/USDT', metric: 'funding', op: 'cross', value: 0, note: 'Funding flip', repeat: true },
      ],
    });
  });

  it('±move arms one alert per direction, both repeating', () => {
    const built = byKey('pct-move').build({ symbol: 'ETH/USDT', equityUsd: null });
    if (!('inputs' in built)) throw new Error('expected inputs');
    expect(built.inputs).toHaveLength(2);
    expect(built.inputs[0]).toMatchObject({ metric: 'change', op: 'above', value: 5, repeat: true });
    expect(built.inputs[1]).toMatchObject({ metric: 'change', op: 'below', value: -5, repeat: true });
  });

  it('symbol templates are honest without a symbol', () => {
    for (const key of ['funding-flip', 'pct-move']) {
      const built = byKey(key).build({ symbol: null, equityUsd: null });
      expect(built).toHaveProperty('unavailable');
    }
  });

  it('equity drawdown arms a one-shot 5% below the live equity, to the cent', () => {
    const t = byKey('equity-drawdown');
    expect(t.needsEquity).toBe(true);
    const built = t.build({ symbol: null, equityUsd: 10_000.333 });
    if (!('inputs' in built)) throw new Error('expected inputs');
    expect(built.inputs[0]).toMatchObject({
      symbol: ACCOUNT_SYMBOL,
      metric: 'equity',
      op: 'below',
      value: 9500.32, // 10000.333 * 0.95 = 9500.31635 → cents
      repeat: false,
    });
  });

  it('equity drawdown is honest without a live equity read', () => {
    const t = byKey('equity-drawdown');
    expect(t.build({ symbol: 'BTC/USDT', equityUsd: null })).toHaveProperty('unavailable');
    expect(t.build({ symbol: null, equityUsd: 0 })).toHaveProperty('unavailable');
  });

  it('every template produces inputs the server-side parser accepts', async () => {
    const { parseAlertInput } = await import('@midas/shared');
    const ctx = { symbol: 'BTC/USDT', equityUsd: 5000 };
    for (const t of ALERT_TEMPLATES) {
      const built = t.build(ctx);
      if (!('inputs' in built)) throw new Error(`${t.key} unexpectedly unavailable`);
      for (const input of built.inputs) {
        expect(parseAlertInput(input), `${t.key} input rejected`).not.toBeNull();
      }
    }
  });
});
