import { describe, it, expect, beforeEach } from 'vitest';
import {
  useDrawings,
  MAX_DRAWINGS_PER_SYMBOL,
  MAX_SYMBOLS,
  type Drawing,
} from './useDrawings';

const hline = (price: number) => ({ type: 'hline' as const, price });
const trend = () => ({
  type: 'trend' as const,
  a: { time: 1000, price: 100 },
  b: { time: 2000, price: 200 },
});

beforeEach(() => useDrawings.setState({ drawings: {} }));

describe('useDrawings', () => {
  it('round-trips drawings per symbol', () => {
    const { addDrawing } = useDrawings.getState();
    const d = addDrawing('BTC/USDT', hline(70000));
    addDrawing('BTC/USDT', trend());

    const list = useDrawings.getState().drawings['BTC/USDT'];
    expect(list).toHaveLength(2);
    expect(list[0]).toEqual({ id: d.id, type: 'hline', price: 70000 });
    expect(list[1]).toMatchObject({
      type: 'trend',
      a: { time: 1000, price: 100 },
      b: { time: 2000, price: 200 },
    });
    expect(typeof list[1].id).toBe('string');
  });

  it('keeps symbols isolated and clears only the target symbol', () => {
    const { addDrawing, clearSymbol } = useDrawings.getState();
    addDrawing('BTC/USDT', hline(1));
    addDrawing('ETH/USDT', hline(2));
    addDrawing('BTC/USDT', hline(3));

    clearSymbol('BTC/USDT');
    expect(useDrawings.getState().drawings['BTC/USDT']).toBeUndefined();
    expect(useDrawings.getState().drawings['ETH/USDT']).toHaveLength(1);
  });

  it('normalises symbol keys to uppercase', () => {
    useDrawings.getState().addDrawing('btc/usdt', hline(1));
    expect(useDrawings.getState().drawings['BTC/USDT']).toHaveLength(1);
  });

  it('caps drawings per symbol, evicting the oldest', () => {
    const { addDrawing } = useDrawings.getState();
    for (let i = 0; i < MAX_DRAWINGS_PER_SYMBOL + 10; i++) addDrawing('BTC/USDT', hline(i));

    const list = useDrawings.getState().drawings['BTC/USDT'];
    expect(list).toHaveLength(MAX_DRAWINGS_PER_SYMBOL);
    expect(list[0]).toMatchObject({ price: 10 }); // 0–9 evicted
  });

  it('caps tracked symbols, evicting the least recently touched', () => {
    const { addDrawing } = useDrawings.getState();
    for (let i = 0; i < MAX_SYMBOLS + 5; i++) addDrawing(`S${i}`, hline(1));

    let keys = Object.keys(useDrawings.getState().drawings);
    expect(keys).toHaveLength(MAX_SYMBOLS);
    expect(keys).not.toContain('S0');
    expect(keys).toContain(`S${MAX_SYMBOLS + 4}`);

    // Touching S5 refreshes it, so the next eviction skips it and drops S6.
    addDrawing('S5', hline(2));
    addDrawing('NEW', hline(1));
    keys = Object.keys(useDrawings.getState().drawings);
    expect(keys).toHaveLength(MAX_SYMBOLS);
    expect(keys).toContain('S5');
    expect(keys).toContain('NEW');
    expect(keys).not.toContain('S6');
  });

  it('drops malformed persisted entries on rehydrate', async () => {
    const good: Drawing = { id: 'ok1', type: 'hline', price: 42 };
    const junk = [
      null,
      'junk',
      42,
      { type: 'hline' }, // no price
      { id: 'x', type: 'hline', price: 'soon' },
      { id: 'y', type: 'trend', a: { time: 1, price: 1 } }, // missing b
      { id: 'z', type: 'fib', a: { time: 1, price: 1 }, b: { time: 2 } }, // b.price missing
      { id: 'w', type: 'ellipse', price: 1 }, // unknown type
    ];
    const overCap = Array.from({ length: MAX_DRAWINGS_PER_SYMBOL + 50 }, (_, i) => ({
      id: `s${i}`,
      type: 'hline',
      price: i,
    }));
    window.localStorage.setItem(
      'midas-drawings',
      JSON.stringify({
        state: {
          drawings: {
            'BTC/USDT': [good, ...junk],
            'ETH/USDT': 'nope',
            'SOL/USDT': overCap,
          },
        },
        version: 1,
      }),
    );

    await useDrawings.persist.rehydrate();
    const { drawings } = useDrawings.getState();
    expect(drawings['BTC/USDT']).toEqual([good]);
    expect(drawings['ETH/USDT']).toBeUndefined();
    expect(drawings['SOL/USDT']).toHaveLength(MAX_DRAWINGS_PER_SYMBOL);
    expect(drawings['SOL/USDT'][0]).toMatchObject({ price: 50 });
  });

  it('migrates an empty / v0 persisted state to a clean store', async () => {
    window.localStorage.setItem(
      'midas-drawings',
      JSON.stringify({
        state: { drawings: { 'BTC/USDT': [{ id: 'a', type: 'hline', price: 1 }] } },
        version: 0,
      }),
    );
    await useDrawings.persist.rehydrate();
    expect(useDrawings.getState().drawings).toEqual({});
  });

  it('survives an unreadable persisted blob without clobbering state', async () => {
    useDrawings.getState().addDrawing('BTC/USDT', hline(1));
    window.localStorage.setItem('midas-drawings', 'not json at all');
    await useDrawings.persist.rehydrate();
    expect(useDrawings.getState().drawings['BTC/USDT']).toHaveLength(1);
  });
});
