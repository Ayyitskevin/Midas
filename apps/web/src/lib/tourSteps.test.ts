import { describe, it, expect } from 'vitest';
import { TOUR_STEPS } from './tourSteps';
import { COMMANDS } from '@/commands/registry';

describe('TOUR_STEPS', () => {
  it('is a short tour of well-formed, unique steps', () => {
    expect(TOUR_STEPS.length).toBeGreaterThanOrEqual(4);
    expect(TOUR_STEPS.length).toBeLessThanOrEqual(8);
    const commands = TOUR_STEPS.map((s) => s.command);
    expect(new Set(commands).size).toBe(commands.length);
    for (const s of TOUR_STEPS) {
      expect(s.title.length).toBeGreaterThan(0);
      expect(s.blurb.length).toBeGreaterThan(0);
    }
  });

  it('every step ends in a real registered command token', () => {
    const known = new Set<string>();
    for (const c of COMMANDS) {
      known.add(c.code);
      for (const a of c.aliases) known.add(a);
    }
    for (const s of TOUR_STEPS) {
      const token = s.command.split(/\s+/).pop()!.toUpperCase();
      expect(known.has(token), `${s.command} → ${token}`).toBe(true);
    }
  });
});
