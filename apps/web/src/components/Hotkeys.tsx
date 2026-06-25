import { useEffect } from 'react';
import { usePanels } from '@/store/usePanels';
import { useHotkeyHelp } from '@/store/useHotkeyHelp';
import { resolveHotkey, cyclePanelId } from '@/lib/hotkeys';

const SHORTCUTS: Array<{ keys: string; desc: string }> = [
  { keys: '⌘K / Ctrl-K', desc: 'Open command palette' },
  { keys: '⌥1 … ⌥9', desc: 'Focus panel by number' },
  { keys: '⌥] / ⌥[', desc: 'Focus next / previous panel' },
  { keys: '⌥W', desc: 'Close the focused panel' },
  { keys: '?', desc: 'Toggle this shortcuts help' },
  { keys: 'Esc', desc: 'Close palette / overlay' },
];

/** True when the event originated from a text-entry element. */
function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

function scrollToPanel(id: string): void {
  const el = document.querySelector(`[data-panel-id="${CSS.escape(id)}"]`);
  el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

/**
 * Global keyboard shortcuts for panel navigation, plus the help overlay. The
 * resolution is pure (lib/hotkeys); this wires it to the panel store and DOM.
 */
export function Hotkeys() {
  const open = useHotkeyHelp((s) => s.open);
  const setOpen = useHotkeyHelp((s) => s.set);
  const toggle = useHotkeyHelp((s) => s.toggle);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Esc always closes the overlay (even from a field); let it bubble so the
      // command palette's own Esc handler still runs.
      if (e.key === 'Escape') {
        setOpen(false);
        return;
      }
      if (isEditable(e.target)) return;

      const action = resolveHotkey(e);
      if (!action) return;

      const { panels, activeId, focusPanel, closePanel } = usePanels.getState();
      const ids = panels.map((p) => p.id);

      switch (action.type) {
        case 'focusIndex': {
          const id = ids[action.index];
          if (id) {
            e.preventDefault();
            focusPanel(id);
            scrollToPanel(id);
          }
          break;
        }
        case 'cycle': {
          const id = cyclePanelId(ids, activeId, action.dir);
          if (id) {
            e.preventDefault();
            focusPanel(id);
            scrollToPanel(id);
          }
          break;
        }
        case 'close': {
          if (activeId) {
            e.preventDefault();
            closePanel(activeId);
          }
          break;
        }
        case 'toggleHelp': {
          e.preventDefault();
          toggle();
          break;
        }
      }
    }

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setOpen, toggle]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/50 pt-[15vh]"
      onMouseDown={() => setOpen(false)}
    >
      <div
        className="w-full max-w-sm overflow-hidden rounded-md border border-term-border bg-term-panel shadow-2xl shadow-black/60"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="border-b border-term-border px-3 py-2 text-xs font-semibold uppercase tracking-wide text-term-amber">
          Keyboard shortcuts
        </div>
        <ul className="divide-y divide-term-border/40">
          {SHORTCUTS.map((s) => (
            <li key={s.keys} className="flex items-center justify-between gap-4 px-3 py-1.5 text-xs">
              <span className="text-term-muted">{s.desc}</span>
              <span className="shrink-0 font-mono text-2xs text-term-text">{s.keys}</span>
            </li>
          ))}
        </ul>
        <div className="border-t border-term-border px-3 py-1 text-2xs text-term-dim">
          ⌥ = Alt / Option · esc to close
        </div>
      </div>
    </div>
  );
}
