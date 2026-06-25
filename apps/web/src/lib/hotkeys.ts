/**
 * Keyboard-shortcut resolution — pure and DOM-free so it can be unit-tested.
 * Panel controls key off the physical `code` (Digit1, BracketRight, KeyW…) so
 * they work regardless of keyboard layout and the alt-chars Option produces on
 * macOS; the help toggle keys off the produced `?` character.
 */

export type HotkeyAction =
  | { type: 'focusIndex'; index: number } // 0-based panel index
  | { type: 'cycle'; dir: 1 | -1 }
  | { type: 'close' }
  | { type: 'toggleHelp' };

export interface KeyEventLike {
  code: string;
  key: string;
  altKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
}

/** Map a keyboard event to a hotkey action, or null if it isn't a hotkey. */
export function resolveHotkey(e: KeyEventLike): HotkeyAction | null {
  // Alt-based panel controls. Ignore when Cmd/Ctrl are also held so we never
  // shadow OS/browser chords.
  if (e.altKey && !e.metaKey && !e.ctrlKey) {
    const digit = /^Digit([1-9])$/.exec(e.code);
    if (digit) return { type: 'focusIndex', index: Number(digit[1]) - 1 };
    if (e.code === 'BracketRight') return { type: 'cycle', dir: 1 };
    if (e.code === 'BracketLeft') return { type: 'cycle', dir: -1 };
    if (e.code === 'KeyW') return { type: 'close' };
    return null;
  }

  // `?` (Shift+/) toggles the shortcuts overlay — no other modifier.
  if (!e.altKey && !e.metaKey && !e.ctrlKey && e.key === '?') {
    return { type: 'toggleHelp' };
  }

  return null;
}

/** Id to focus when cycling from `activeId` by `dir`, wrapping around the ends. */
export function cyclePanelId(
  ids: readonly string[],
  activeId: string | null,
  dir: 1 | -1,
): string | null {
  if (ids.length === 0) return null;
  const i = activeId ? ids.indexOf(activeId) : -1;
  if (i < 0) return dir === 1 ? ids[0] : ids[ids.length - 1];
  const n = ids.length;
  return ids[(i + dir + n) % n];
}
