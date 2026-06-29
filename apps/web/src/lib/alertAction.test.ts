import { describe, it, expect } from 'vitest';
import { ALERT_ACTIONS, alertActionLabel, isAlertActionCode } from './alertAction';

describe('alertAction', () => {
  it('offers a "no action" default plus symbol-scoped panel actions', () => {
    expect(ALERT_ACTIONS[0]).toEqual({ code: '', label: 'no action' });
    expect(ALERT_ACTIONS.map((a) => a.code)).toContain('GP');
    expect(ALERT_ACTIONS.map((a) => a.code)).toContain('BOOK');
  });

  it('labels known codes and falls back for unknown', () => {
    expect(alertActionLabel('GP')).toBe('open chart');
    expect(alertActionLabel('')).toBe('no action');
    expect(alertActionLabel('NOPE')).toBe('no action');
  });

  it('isAlertActionCode is true only for real (non-empty) actions', () => {
    expect(isAlertActionCode('GP')).toBe(true);
    expect(isAlertActionCode('')).toBe(false);
    expect(isAlertActionCode('NOPE')).toBe(false);
  });
});
