import { describe, it, expect } from 'vitest';
import { createLoginThrottle } from './throttle';

describe('createLoginThrottle', () => {
  it('locks a key out after the failure threshold and reports the wait', () => {
    const t = createLoginThrottle(3, 60_000);
    expect(t.check('alice|1.2.3.4', 0)).toBeNull();
    t.fail('alice|1.2.3.4', 0);
    t.fail('alice|1.2.3.4', 1000);
    expect(t.check('alice|1.2.3.4', 2000)).toBeNull(); // 2 fails — still allowed
    t.fail('alice|1.2.3.4', 2000);
    expect(t.check('alice|1.2.3.4', 3000)).toBe(59_000); // locked; 60s from last fail
  });

  it('serves the lockout then grants a fresh slate, and success clears the streak', () => {
    const t = createLoginThrottle(2, 10_000);
    t.fail('k', 0);
    t.fail('k', 0);
    expect(t.check('k', 5000)).toBe(5000);
    expect(t.check('k', 10_000)).toBeNull(); // lockout served
    expect(t.size()).toBe(0); // slate wiped

    t.fail('k', 20_000);
    t.succeed('k'); // correct password → streak cleared
    t.fail('k', 21_000);
    expect(t.check('k', 21_001)).toBeNull(); // only 1 consecutive fail
  });

  it('restarts a stale streak instead of accumulating forever', () => {
    const t = createLoginThrottle(2, 10_000);
    t.fail('k', 0);
    t.fail('k', 50_000); // 50s of quiet > lockout → counts as fail #1, not #2
    expect(t.check('k', 50_001)).toBeNull();
  });

  it('keys are independent and memory is bounded under a spray', () => {
    const t = createLoginThrottle(1, 60_000, 3);
    t.fail('a|1', 0);
    expect(t.check('a|1', 1)).not.toBeNull();
    expect(t.check('a|2', 1)).toBeNull(); // same user, other ip — not locked

    t.fail('b|1', 1);
    t.fail('c|1', 2);
    t.fail('d|1', 3); // 4th entry → oldest evicted to stay within the bound
    expect(t.size()).toBeLessThanOrEqual(3);
  });
});
