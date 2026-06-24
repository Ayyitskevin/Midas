import { useMemo } from 'react';
import GridLayout, { WidthProvider, type Layout } from 'react-grid-layout';
import { usePanels } from '@/store/usePanels';
import { runCommand } from '@/commands/execute';
import { Panel } from './Panel';

const Grid = WidthProvider(GridLayout);

const STARTERS: Array<[string, string]> = [
  ['BTC/USDT', 'description'],
  ['BTC/USDT GP', 'price chart'],
  ['BTC/USDT BOOK', 'order book'],
  ['W', 'watchlist'],
  ['HELP', 'all commands'],
];

function EmptyWorkspace() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 px-4 text-center animate-fade-in">
      <div>
        <div className="text-3xl font-bold tracking-[0.35em] text-term-amber">MIDAS</div>
        <div className="mt-1 text-2xs uppercase tracking-[0.3em] text-term-dim">market terminal</div>
      </div>
      <div className="text-xs text-term-muted">
        Your workspace is empty. Run a command to open a panel.
      </div>
      <div className="flex max-w-lg flex-wrap justify-center gap-2">
        {STARTERS.map(([cmd, label]) => (
          <button
            key={cmd}
            onClick={() => runCommand(cmd)}
            className="rounded-sm border border-term-border px-3 py-1.5 text-xs transition-colors hover:border-term-amber hover:text-term-amber"
          >
            <span className="font-bold text-term-amber">{cmd}</span>
            <span className="ml-2 text-2xs text-term-dim">{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function Workspace() {
  const panels = usePanels((s) => s.panels);
  const setLayout = usePanels((s) => s.setLayout);

  const layout = useMemo<Layout[]>(
    () =>
      panels.map((p) => ({
        i: p.id,
        x: p.x,
        y: p.y,
        w: p.w,
        h: p.h,
        minW: p.minW,
        minH: p.minH,
      })),
    [panels],
  );

  if (panels.length === 0) return <EmptyWorkspace />;

  return (
    <div className="scroll-term h-full overflow-auto">
      <Grid
        className="layout"
        layout={layout}
        cols={12}
        rowHeight={28}
        margin={[8, 8]}
        containerPadding={[10, 10]}
        draggableHandle=".panel-drag"
        draggableCancel=".no-drag"
        compactType="vertical"
        resizeHandles={['se']}
        onLayoutChange={(l) => setLayout(l)}
      >
        {panels.map((p) => (
          <div key={p.id}>
            <Panel panel={p} />
          </div>
        ))}
      </Grid>
    </div>
  );
}
