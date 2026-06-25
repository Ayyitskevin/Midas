import { describe, it, expect } from 'vitest';
import { resolveHotkey, cyclePanelId, type KeyEventLike } from '@/lib/hotkeys';

const ev = (p: Partial<KeyEventLike>): KeyEventLike => ({
  code: '',
  key: '',
  altKey: false,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  ...p,
});

describe('resolveHotkey', () => {
  it('maps Alt+digit to a 0-based focus index', () => {
    expect(resolveHotkey(ev({ altKey: true, code: 'Digit1' }))).toEqual({ type: 'focusIndex', index: 0 });
    expect(resolveHotkey(ev({ altKey: true, code: 'Digit9' }))).toEqual({ type: 'focusIndex', index: 8 });
  });

  it('maps Alt+brackets to cycle and Alt+W to close', () => {
    expect(resolveHotkey(ev({ altKey: true, code: 'BracketRight' }))).toEqual({ type: 'cycle', dir: 1 });
    expect(resolveHotkey(ev({ altKey: true, code: 'BracketLeft' }))).toEqual({ type: 'cycle', dir: -1 });
    expect(resolveHotkey(ev({ altKey: true, code: 'KeyW' }))).toEqual({ type: 'close' });
  });

  it('maps ? to the help toggle', () => {
    expect(resolveHotkey(ev({ key: '?', shiftKey: true }))).toEqual({ type: 'toggleHelp' });
  });

  it('ignores Alt chords when Cmd/Ctrl are also held', () => {
    expect(resolveHotkey(ev({ altKey: true, metaKey: true, code: 'Digit1' }))).toBeNull();
    expect(resolveHotkey(ev({ altKey: true, ctrlKey: true, code: 'KeyW' }))).toBeNull();
  });

  it('ignores unrelated keys and Digit0', () => {
    expect(resolveHotkey(ev({ altKey: true, code: 'Digit0' }))).toBeNull();
    expect(resolveHotkey(ev({ code: 'KeyA', key: 'a' }))).toBeNull();
    expect(resolveHotkey(ev({ metaKey: true, code: 'KeyK', key: 'k' }))).toBeNull();
  });
});

describe('cyclePanelId', () => {
  const ids = ['a', 'b', 'c'];

  it('moves forward and wraps at the end', () => {
    expect(cyclePanelId(ids, 'a', 1)).toBe('b');
    expect(cyclePanelId(ids, 'c', 1)).toBe('a');
  });

  it('moves backward and wraps at the start', () => {
    expect(cyclePanelId(ids, 'b', -1)).toBe('a');
    expect(cyclePanelId(ids, 'a', -1)).toBe('c');
  });

  it('falls back to an end when there is no/unknown active panel', () => {
    expect(cyclePanelId(ids, null, 1)).toBe('a');
    expect(cyclePanelId(ids, null, -1)).toBe('c');
    expect(cyclePanelId(ids, 'zzz', 1)).toBe('a');
  });

  it('returns null for an empty list', () => {
    expect(cyclePanelId([], 'a', 1)).toBeNull();
  });
});
