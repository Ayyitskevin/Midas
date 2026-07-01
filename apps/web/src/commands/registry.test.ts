import { describe, it, expect } from 'vitest';
import { COMMANDS, lookupCommand } from './registry';
import { MODULE_META } from '../modules/meta';

/**
 * Registry integrity — guards the command namespace. With 200+ commands the
 * failure mode is silent: `BY_CODE.set` means a later duplicate alias quietly
 * steals the token from an earlier command (typing VAR once opened Chande
 * VIDYA instead of Returns/VaR). These tests make that class of bug a CI
 * failure instead of a support ticket.
 */
describe('command registry integrity', () => {
  it('has no duplicate tokens across codes and aliases', () => {
    const owners = new Map<string, string[]>();
    for (const cmd of COMMANDS) {
      for (const token of [cmd.code, ...cmd.aliases]) {
        owners.set(token, [...(owners.get(token) ?? []), cmd.code]);
      }
    }
    const collisions = [...owners.entries()]
      .filter(([, o]) => o.length > 1)
      .map(([token, o]) => `${token} -> ${o.join(', ')}`);
    expect(collisions).toEqual([]);
  });

  it('every command opens a module registered in MODULE_META', () => {
    for (const cmd of COMMANDS) {
      expect(MODULE_META[cmd.module], `command ${cmd.code} → module ${cmd.module}`).toBeDefined();
    }
  });

  it('resolves the historically-colliding tokens to their primary owners', () => {
    // Pinned semantics for tokens that used to be stolen by later registrants.
    const expected: Record<string, string> = {
      VAR: 'VAR', // was hijacked by VIDYA
      DRAWDOWN: 'DD', // was hijacked by EQ
      RVOL: 'UVOL', // was hijacked by RVI (relative *volume*, not volatility)
      SPREAD: 'RATIO', // was hijacked by PREM
      RVI: 'RVI',
      CARRY: 'CARRY',
      TAILS: 'TAIL',
      ADAPTIVEMA: 'KAMA',
    };
    for (const [token, code] of Object.entries(expected)) {
      expect(lookupCommand(token)?.code, `token ${token}`).toBe(code);
    }
  });

  it('every command carries a usable title and description', () => {
    for (const cmd of COMMANDS) {
      expect(cmd.title.trim().length, `${cmd.code} title`).toBeGreaterThan(0);
      expect(cmd.description.trim().length, `${cmd.code} description`).toBeGreaterThan(20);
    }
  });
});
