import { useEffect, useRef } from 'react';
import { decodeLink } from '@/lib/deepLink';
import { usePanels } from '@/store/usePanels';
import { useToasts } from '@/store/useToasts';
import { openModule } from '@/commands/execute';
import { lookupCommand } from '@/commands/registry';

/**
 * On first load, if the URL fragment carries a deep link (#scan?… / #board?… /
 * #ws!…), open the corresponding panel — **additively**, on top of whatever
 * workspace restores (a shared workspace imports as a *new* workspace, never
 * overwriting yours) — then strip the fragment so a reload (or sharing the
 * live URL) doesn't replay it. Invalid or unknown links are ignored.
 */
export function DeepLinkLoader() {
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    done.current = true;
    if (typeof window === 'undefined' || !window.location.hash) return;

    const link = decodeLink(window.location.hash);
    if (!link) return; // unrecognized fragment: leave it visible, touch nothing

    if (link.kind === 'scan') {
      usePanels.getState().openPanel({ module: 'SCAN', symbol: null, params: { criteria: link.criteria } });
    } else if (link.kind === 'workspace') {
      // The importer re-sanitizes every panel exactly like a file import.
      try {
        usePanels.getState().importWorkspace(link.data);
        useToasts.getState().push({
          title: 'Workspace imported',
          body: `“${link.name}” opened from the share link, as a new workspace.`,
          tone: 'up',
        });
      } catch (err) {
        useToasts.getState().push({
          title: 'Share link not usable',
          body: err instanceof Error ? err.message : 'Malformed workspace payload.',
          tone: 'down',
        });
      }
    } else {
      const cmd = lookupCommand(link.code);
      // Open a known command only, and never a symbol-required one without a
      // symbol (board codes are symbol-less; the optional symbol is focus).
      if (cmd && (!cmd.requiresSymbol || link.symbol)) openModule(link.code, link.symbol);
    }

    // Strip the consumed fragment so a reload (or sharing the live URL) doesn't replay it.
    try {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    } catch {
      /* history API unavailable — leaving the fragment is harmless */
    }
  }, []);

  return null;
}
