import { usePanels } from '@/store/usePanels';
import type { PanelState } from '@/store/usePanels';
import { MODULE_COMPONENTS } from '@/modules/registry';

export function Panel({ panel }: { panel: PanelState }) {
  const closePanel = usePanels((s) => s.closePanel);
  const focusPanel = usePanels((s) => s.focusPanel);
  const isActive = usePanels((s) => s.activeId === panel.id);
  const Module = MODULE_COMPONENTS[panel.module];

  return (
    <div
      className={`flex h-full flex-col overflow-hidden rounded-sm border bg-term-panel ${
        isActive ? 'border-term-border-bright' : 'border-term-border'
      }`}
      onMouseDown={() => focusPanel(panel.id)}
    >
      <div className="panel-drag flex cursor-move select-none items-center justify-between gap-2 border-b border-term-border bg-term-header px-2 py-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-2xs font-bold text-term-amber">{panel.module}</span>
          {panel.symbol && (
            <span className="text-xs font-semibold text-term-text">{panel.symbol}</span>
          )}
          <span className="truncate text-2xs text-term-muted">{panel.title}</span>
        </div>
        <button
          className="no-drag leading-none text-term-dim transition-colors hover:text-term-down"
          title="Close panel"
          onClick={() => closePanel(panel.id)}
        >
          ×
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {Module ? <Module panel={panel} /> : <div className="p-3 text-xs text-term-down">Unknown module: {panel.module}</div>}
      </div>
    </div>
  );
}
