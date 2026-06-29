import { useEffect } from 'react';
import { TopBar } from './components/TopBar';
import { DemoBanner } from './components/DemoBanner';
import { Ticker } from './components/Ticker';
import { WorkspaceTabs } from './components/WorkspaceTabs';
import { Workspace } from './components/Workspace';
import { StatusBar } from './components/StatusBar';
import { AlertsEngine } from './components/AlertsEngine';
import { ScanWatchEngine } from './components/ScanWatchEngine';
import { DeepLinkLoader } from './components/DeepLinkLoader';
import { ToastHost } from './components/ToastHost';
import { LoginGate } from './components/LoginGate';
import { CommandPalette } from './components/CommandPalette';
import { Hotkeys } from './components/Hotkeys';
import { SettingsEffects } from './components/SettingsEffects';
import { WorkspaceSync } from './components/WorkspaceSync';
import { PortfolioSync } from './components/PortfolioSync';
import { WatchlistSync } from './components/WatchlistSync';
import { NotesSync } from './components/NotesSync';
import { usePanels } from './store/usePanels';
import { useSettings } from './store/useSettings';
import { runCommand } from './commands/execute';

export default function App() {
  const showTicker = useSettings((s) => s.settings.showTicker);

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
    <LoginGate>
      <div className="flex h-full flex-col">
        <TopBar />
        <DemoBanner />
        {showTicker && <Ticker />}
        <WorkspaceTabs />
        <main className="min-h-0 flex-1">
          <Workspace />
        </main>
        <StatusBar />
        <AlertsEngine />
        <ScanWatchEngine />
        <DeepLinkLoader />
        <ToastHost />
        <CommandPalette />
        <Hotkeys />
        <SettingsEffects />
        <WorkspaceSync />
        <PortfolioSync />
        <WatchlistSync />
        <NotesSync />
      </div>
    </LoginGate>
  );
}
