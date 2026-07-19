import { describe, it, expect } from 'vitest';
import { streamStatusView } from '@/lib/streamStatus';

describe('streamStatusView', () => {
  it('open + live stream → LIVE regardless of subscriptions', () => {
    const v = streamStatusView('open', 0, true);
    expect(v.label).toBe('LIVE');
    expect(v.tone).toBe('live');
  });

  it('open but synthetic stream → SIM (never label fake prints LIVE)', () => {
    const v = streamStatusView('open', 3, false);
    expect(v.label).toBe('SIM');
    expect(v.tone).toBe('simulated');
    expect(v.dotClass).toBe('text-term-amber');
    expect(v.title).toMatch(/synthetic/i);
  });

  it('defaults to LIVE when stream liveness is unknown (health not yet loaded)', () => {
    // No 3rd arg → streamLive defaults true, so a not-yet-loaded health poll
    // does not flash SIM over a genuinely live ccxt feed.
    expect(streamStatusView('open', 0).label).toBe('LIVE');
  });

  it('connecting → CONNECTING', () => {
    expect(streamStatusView('connecting', 3).label).toBe('CONNECTING');
  });

  it('closed with active subscriptions → RECONNECTING', () => {
    const v = streamStatusView('closed', 2);
    expect(v.label).toBe('RECONNECTING');
    expect(v.tone).toBe('reconnecting');
  });

  it('closed with no subscriptions → IDLE', () => {
    const v = streamStatusView('closed', 0);
    expect(v.label).toBe('IDLE');
    expect(v.tone).toBe('idle');
  });
});
