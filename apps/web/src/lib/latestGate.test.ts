import { describe, it, expect } from 'vitest';
import { createLatestGate } from './latestGate';

describe('createLatestGate', () => {
  it('hands out strictly increasing tokens', () => {
    const gate = createLatestGate();
    expect(gate.start()).toBe(1);
    expect(gate.start()).toBe(2);
    expect(gate.start()).toBe(3);
  });

  it('treats only the most recently started token as latest', () => {
    const gate = createLatestGate();
    const a = gate.start();
    const b = gate.start();
    expect(gate.isLatest(a)).toBe(false);
    expect(gate.isLatest(b)).toBe(true);
  });

  it('models an out-of-order resolution: a slow earlier op must not win over a newer one', () => {
    const gate = createLatestGate();
    // Poll A starts, then poll B starts before A resolves.
    const a = gate.start();
    const b = gate.start();
    // B resolves first (fast) and is applied.
    expect(gate.isLatest(b)).toBe(true);
    // A resolves late; it is no longer latest, so its stale result is discarded.
    expect(gate.isLatest(a)).toBe(false);
  });

  it('gates are independent — one gate never affects another', () => {
    const g1 = createLatestGate();
    const g2 = createLatestGate();
    const t1 = g1.start();
    g2.start();
    g2.start();
    // g2 advancing does not retire g1's token.
    expect(g1.isLatest(t1)).toBe(true);
  });

  it('a fresh token from a superseded gate becomes latest again', () => {
    const gate = createLatestGate();
    const a = gate.start();
    gate.start(); // supersedes a
    expect(gate.isLatest(a)).toBe(false);
    const c = gate.start(); // newest
    expect(gate.isLatest(c)).toBe(true);
  });
});
