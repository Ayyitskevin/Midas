import { useEffect } from 'react';
import { TopBar } from './components/TopBar';
import { Ticker } from './components/Ticker';
import { Workspace } from './components/Workspace';
import { StatusBar } from './components/StatusBar';
import { usePanels } from './store/usePanels';
import { runCommand } from './commands/execute';

export default function App() {
  // On the very first visit (nothing ever opened), seed a starter workspace.
  useEffect(() => {
    const { panels, counter } = usePanels.getState();
    if (panels.length === 0 && counter === 0) {
      runCommand('W');
      runCommand('BTC/USDT DES');
      runCommand('BTC/USDT GP');
      runCommand('BTC/USDT BOOK');
      runCommand('BTC/USDT TAS');
      // Link the starter panels so the watchlist drives the desc/chart/book/tape.
      const { panels: seeded, setPanelLink } = usePanels.getState();
      for (const m of ['W', 'DES', 'GP', 'BOOK', 'TAS'] as const) {
        const p = seeded.find((pp) => pp.module === m);
        if (p) setPanelLink(p.id, 'red');
      }
    }
  }, []);

  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <Ticker />
      <main className="min-h-0 flex-1">
        <Workspace />
      </main>
      <StatusBar />
    </div>
  );
}
