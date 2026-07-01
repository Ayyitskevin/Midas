import { describe, it, expect } from 'vitest';
import { createRateLimiter } from './rateLimit';
import { applyDemoMode, config } from './config';

describe('createRateLimiter', () => {
  it('allows up to the ceiling per window, then reports the wait', () => {
    const rl = createRateLimiter(60_000, 3);
    expect(rl.check('ip1', 0)).toBeNull();
    expect(rl.check('ip1', 1)).toBeNull();
    expect(rl.check('ip1', 2)).toBeNull();
    expect(rl.check('ip1', 3)).toBe(59_997); // 4th in the window → wait to window end
    expect(rl.check('ip2', 3)).toBeNull(); // other keys unaffected
  });

  it('resets when the window rolls and bounds its memory', () => {
    const rl = createRateLimiter(1000, 1, 2);
    expect(rl.check('a', 0)).toBeNull();
    expect(rl.check('a', 1)).not.toBeNull();
    expect(rl.check('a', 1000)).toBeNull(); // fresh window
    rl.check('b', 1000);
    rl.check('c', 1000); // 3rd key → oldest evicted
    expect(rl.size()).toBeLessThanOrEqual(2);
  });
});

describe('demo mode rate-limit default', () => {
  it('gives an unlimited demo box a ceiling, and respects an explicit one', () => {
    const demo = applyDemoMode({ ...config, demoMode: true, rateLimitRpm: 0 });
    expect(demo.rateLimitRpm).toBe(120);
    const custom = applyDemoMode({ ...config, demoMode: true, rateLimitRpm: 30 });
    expect(custom.rateLimitRpm).toBe(30);
  });
});
