import { Suspense, useState } from 'react';
import { LINK_COLORS, usePanels } from '@/store/usePanels';
import type { LinkColor, PanelState } from '@/store/usePanels';
import { MODULE_COMPONENTS } from '@/modules/registry';
import { ErrorBoundary } from './ErrorBoundary';
import { Loading } from './Feedback';

export const LINK_HEX: Record<LinkColor, string> = {
  red: '#ef4d56',
  blue: '#4c8dff',
  green: '#26c281',
  yellow: '#ffd23f',
  cyan: '#3ad6d6',
  orange: '#ff9f40',
  magenta: '#e056fd',
};

function LinkControl({ panel }: { panel: PanelState }) {
  const setPanelLink = usePanels((s) => s.setPanelLink);
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        className="no-drag flex h-3 w-3 items-center justify-center rounded-full border"
        style={{
          borderColor: panel.link ? LINK_HEX[panel.link] : '#565b63',
          background: panel.link ? LINK_HEX[panel.link] : 'transparent',
        }}
        title={panel.link ? `Linked: ${panel.link} group` : 'Link panel to a group'}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      />
      {open && (
        <>
          <div className="no-drag fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="no-drag absolute right-0 top-4 z-50 flex items-center gap-1 rounded-sm border border-term-border bg-term-panel p-1.5 shadow-lg shadow-black/40">
            {LINK_COLORS.map((c) => (
              <button
                key={c}
                className="h-3.5 w-3.5 rounded-full border border-black/40"
                style={{
                  background: LINK_HEX[c],
                  outline: panel.link === c ? '1px solid #fff' : 'none',
                  outlineOffset: '1px',
                }}
                title={`${c} group`}
                onClick={() => {
                  setPanelLink(panel.id, panel.link === c ? null : c);
                  setOpen(false);
                }}
              />
            ))}
            <button
              className="ml-1 px-1 text-2xs text-term-muted hover:text-term-down"
              title="Unlink"
              onClick={() => {
                setPanelLink(panel.id, null);
                setOpen(false);
              }}
            >
              ✕
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function Panel({ panel, index }: { panel: PanelState; index?: number }) {
  const closePanel = usePanels((s) => s.closePanel);
  const focusPanel = usePanels((s) => s.focusPanel);
  const isActive = usePanels((s) => s.activeId === panel.id);
  const Module = MODULE_COMPONENTS[panel.module];

  return (
    <div
      data-panel-id={panel.id}
      className={`flex h-full flex-col overflow-hidden rounded-sm border bg-term-panel ${
        isActive ? 'border-term-border-bright' : 'border-term-border'
      }`}
      style={panel.link ? { borderLeftColor: LINK_HEX[panel.link], borderLeftWidth: 2 } : undefined}
      onMouseDown={() => focusPanel(panel.id)}
    >
      <div className="panel-drag flex cursor-move select-none items-center justify-between gap-2 border-b border-term-border bg-term-header px-2 py-1">
        <div className="flex min-w-0 items-center gap-2">
          {typeof index === 'number' && index < 9 && (
            <span
              className="shrink-0 rounded-sm border border-term-border px-1 text-2xs leading-none text-term-dim"
              title={`Alt+${index + 1} to focus`}
            >
              {index + 1}
            </span>
          )}
          <span className="text-2xs font-bold text-term-amber">{panel.module}</span>
          {panel.symbol && (
            <span className="text-xs font-semibold text-term-text">{panel.symbol}</span>
          )}
          <span className="truncate text-2xs text-term-muted">{panel.title}</span>
        </div>
        <div className="flex items-center gap-2">
          <LinkControl panel={panel} />
          <button
            className="no-drag leading-none text-term-dim transition-colors hover:text-term-down"
            title="Close panel"
            aria-label={`Close ${panel.module} panel`}
            onClick={() => closePanel(panel.id)}
          >
            ×
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {Module ? (
          <ErrorBoundary resetKey={panel.module} label={`${panel.module} panel hit an error`}>
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center">
                  <Loading label="Loading…" />
                </div>
              }
            >
              <Module panel={panel} />
            </Suspense>
          </ErrorBoundary>
        ) : (
          <div className="p-3 text-xs text-term-down">Unknown module: {panel.module}</div>
        )}
      </div>
    </div>
  );
}
