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

describe('per-IP aggregate ceiling', () => {
  it('locks an IP at the ceiling regardless of how many pairs were sprayed', () => {
    const t = createLoginThrottle(5, 60_000, 10_000, 3);
    t.failIp('9.9.9.9', 0);
    t.failIp('9.9.9.9', 1000);
    expect(t.checkIp('9.9.9.9', 2000)).toBeNull(); // 2 fails — still allowed
    t.failIp('9.9.9.9', 2000);
    expect(t.checkIp('9.9.9.9', 3000)).toBe(59_000); // locked; 60s from last fail
    expect(t.checkIp('8.8.8.8', 3000)).toBeNull(); // other IPs unaffected
  });

  it('serves the lockout then grants a fresh slate', () => {
    const t = createLoginThrottle(5, 10_000, 10_000, 2);
    t.failIp('1.1.1.1', 0);
    t.failIp('1.1.1.1', 0);
    expect(t.checkIp('1.1.1.1', 5000)).toBe(5000);
    expect(t.checkIp('1.1.1.1', 10_000)).toBeNull(); // lockout served
    expect(t.ipSize()).toBe(0); // slate wiped
  });

  it('restarts a stale IP streak instead of accumulating forever', () => {
    const t = createLoginThrottle(5, 10_000, 10_000, 2);
    t.failIp('1.1.1.1', 0);
    t.failIp('1.1.1.1', 50_000); // 50s of quiet > lockout → fail #1, not #2
    expect(t.checkIp('1.1.1.1', 50_001)).toBeNull();
  });

  it('is NOT reset by a successful login (else one known account resets the budget)', () => {
    const t = createLoginThrottle(5, 10_000, 10_000, 2);
    t.failIp('1.1.1.1', 0);
    t.succeed('alice|1.1.1.1'); // valid login clears the pair only
    t.failIp('1.1.1.1', 1000);
    expect(t.checkIp('1.1.1.1', 2000)).toBe(9000); // ceiling tripped on fail #2
  });

  it('bounds the per-IP map under an address spray', () => {
    const t = createLoginThrottle(5, 60_000, 3, 100);
    for (let i = 0; i < 10; i++) t.failIp(`10.0.0.${i}`, i);
    expect(t.ipSize()).toBeLessThanOrEqual(3);
  });
});
