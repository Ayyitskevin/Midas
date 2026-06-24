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
});
