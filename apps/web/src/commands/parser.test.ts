import { describe, it, expect } from 'vitest';
import { parseCommand } from '@/commands/parser';

describe('parseCommand', () => {
  it('treats a bare symbol as a description', () => {
    const r = parseCommand('BTC/USDT', null);
    expect(r.ok).toBe(true);
    expect(r.command?.code).toBe('DES');
    expect(r.symbol).toBe('BTC/USDT');
  });

  it('parses SYMBOL FUNCTION and upper-cases the symbol', () => {
    const r = parseCommand('btc/usdt gp', null);
    expect(r.command?.code).toBe('GP');
    expect(r.symbol).toBe('BTC/USDT');
  });

  it('runs a symbol-less command bare', () => {
    const r = parseCommand('W', null);
    expect(r.command?.code).toBe('W');
    expect(r.symbol).toBeNull();
  });

  it('resolves aliases (CHART → GP)', () => {
    expect(parseCommand('AAPL CHART', null).command?.code).toBe('GP');
  });

  it('errors when a symbol-required command is bare with no active symbol', () => {
    expect(parseCommand('GP', null).ok).toBe(false);
  });

  it('falls back to the active symbol for a bare symbol-required command', () => {
    const r = parseCommand('GP', 'ETH/USDT');
    expect(r.ok).toBe(true);
    expect(r.command?.code).toBe('GP');
    expect(r.symbol).toBe('ETH/USDT');
  });

  it('falls back to security search for unrecognized input', () => {
    const r = parseCommand('some random text', null);
    expect(r.command?.code).toBe('SECF');
    expect(r.searchQuery).toBe('some random text');
  });

  it('tolerates middle "yellow key" tokens', () => {
    const r = parseCommand('AAPL US Equity DES', null);
    expect(r.command?.code).toBe('DES');
    expect(r.symbol).toBe('AAPL');
  });

  it('keeps the symbol for symbol-optional commands (N, FILLS, XQL)', () => {
    for (const code of ['N', 'FILLS', 'XQL']) {
      const r = parseCommand(`BTC/USDT ${code}`, null);
      expect(r.ok, code).toBe(true);
      expect(r.command?.code, code).toBe(code);
      expect(r.symbol, code).toBe('BTC/USDT');
    }
  });

  it('drops the symbol for strictly symbol-less commands', () => {
    const r = parseCommand('BTC/USDT W', null);
    expect(r.command?.code).toBe('W');
    expect(r.symbol).toBeNull();
  });

  it('bare N falls back to the active symbol when one is loaded', () => {
    const r = parseCommand('N', 'BTC/USDT');
    expect(r.ok).toBe(true);
    expect(r.command?.code).toBe('N');
    expect(r.symbol).toBe('BTC/USDT');
  });

  it('bare N with no active symbol keeps top-news behaviour', () => {
    const r = parseCommand('N', null);
    expect(r.ok).toBe(true);
    expect(r.command?.code).toBe('N');
    expect(r.symbol).toBeNull();
  });

  it('resolves aliases case-insensitively', () => {
    const r = parseCommand('btc/usdt chart', null);
    expect(r.command?.code).toBe('GP');
    expect(r.symbol).toBe('BTC/USDT');
    // Bare lowercase alias for a symbol-optional command, too.
    const n = parseCommand('news', 'ETH/USDT');
    expect(n.command?.code).toBe('N');
    expect(n.symbol).toBe('ETH/USDT');
  });
});

describe('parseCommand argument grammar', () => {
  it('parses an interval arg after the command (BTC/USDT GP 1h)', () => {
    const r = parseCommand('BTC/USDT GP 1h', null);
    expect(r.ok).toBe(true);
    expect(r.command?.code).toBe('GP');
    expect(r.symbol).toBe('BTC/USDT');
    expect(r.args).toEqual({ kind: 'interval', interval: '60m', range: '5d' });
  });

  it('parses GIP with an explicit interval (SOL/USDT GIP 15m)', () => {
    const r = parseCommand('SOL/USDT GIP 15m', null);
    expect(r.command?.code).toBe('GIP');
    expect(r.args).toEqual({ kind: 'interval', interval: '15m', range: '5d' });
  });

  it('parses a bare command + interval against the active symbol (GP 1D)', () => {
    const r = parseCommand('GP 1D', 'ETH/USDT');
    expect(r.ok).toBe(true);
    expect(r.symbol).toBe('ETH/USDT');
    expect(r.args).toEqual({ kind: 'interval', interval: '1d', range: '6mo' });
  });

  it('rejects an unknown interval with an honest error listing the choices', () => {
    const r = parseCommand('BTC/USDT GP 2h', null);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("unknown interval '2H'");
    expect(r.error).toContain('5m 15m 30m 1h 1D 1W');
  });

  it('errors when a symbol-required command gets args but has no symbol', () => {
    const r = parseCommand('GP 1h', null);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('GP needs a symbol');
  });

  it('errors visibly on trailing tokens for a command without an args spec', () => {
    const r = parseCommand('BTC/USDT DES foo', null);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('DES takes no arguments');
  });

  it('points at the $ escape when a bare ticker-ish command gets trailing tokens', () => {
    const r = parseCommand('ARB 1h', null);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('$ARB');
    expect(r.error).toContain('ARB/USDT');
  });

  it('parses a price alert (BTC/USDT ALERT 70000) defaulting to cross', () => {
    const r = parseCommand('BTC/USDT ALERT 70000', null);
    expect(r.ok).toBe(true);
    expect(r.command?.code).toBe('ALERT');
    expect(r.symbol).toBe('BTC/USDT');
    expect(r.args).toEqual({ kind: 'price', op: 'cross', value: 70000 });
  });

  it('parses directed price alerts (ALERT > 70000 / ALERT < 70000)', () => {
    const above = parseCommand('BTC/USDT ALERT > 70000', null);
    expect(above.args).toEqual({ kind: 'price', op: 'above', value: 70000 });
    const below = parseCommand('ALERT < 0.05', 'SOL/USDT');
    expect(below.ok).toBe(true);
    expect(below.symbol).toBe('SOL/USDT');
    expect(below.args).toEqual({ kind: 'price', op: 'below', value: 0.05 });
  });

  it('rejects a non-numeric alert threshold', () => {
    const r = parseCommand('BTC/USDT ALERT moon', null);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('expected a price');
  });

  it('errors when ALERT gets a price but no symbol is available', () => {
    const r = parseCommand('ALERT 70000', null);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('ALERT needs a symbol');
  });

  it('folds trailing text into a SECF search (SECF bitcoin)', () => {
    const r = parseCommand('SECF bitcoin', null);
    expect(r.ok).toBe(true);
    expect(r.command?.code).toBe('SECF');
    expect(r.searchQuery).toBe('BITCOIN');
  });
});

describe('parseCommand $ escape hatch', () => {
  it('forces symbol resolution for a ticker that shadows a command ($ARB)', () => {
    const r = parseCommand('$ARB', null);
    expect(r.ok).toBe(true);
    expect(r.command?.code).toBe('DES');
    expect(r.symbol).toBe('ARB');
  });

  it('lets an escaped ticker take a command with args ($COMP GP 1h)', () => {
    const r = parseCommand('$COMP GP 1h', null);
    expect(r.ok).toBe(true);
    expect(r.command?.code).toBe('GP');
    expect(r.symbol).toBe('COMP');
    expect(r.args).toEqual({ kind: 'interval', interval: '60m', range: '5d' });
  });

  it('keeps command-wins for the bare token (no regression)', () => {
    const r = parseCommand('COMP', null);
    expect(r.ok).toBe(true);
    expect(r.command?.code).toBe('COMP');
  });

  it('rejects a lone $', () => {
    expect(parseCommand('$', null).ok).toBe(false);
  });
});
