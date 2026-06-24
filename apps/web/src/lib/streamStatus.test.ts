import { describe, it, expect } from 'vitest';
import { streamStatusView } from '@/lib/streamStatus';

describe('streamStatusView', () => {
  it('open → LIVE regardless of subscriptions', () => {
    const v = streamStatusView('open', 0);
    expect(v.label).toBe('LIVE');
    expect(v.tone).toBe('live');
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
