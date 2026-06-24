import { useState } from 'react';
import { usePanels } from '@/store/usePanels';

export function WorkspaceTabs() {
  const workspaces = usePanels((s) => s.workspaces);
  const activeWorkspaceId = usePanels((s) => s.activeWorkspaceId);
  const switchWorkspace = usePanels((s) => s.switchWorkspace);
  const addWorkspace = usePanels((s) => s.addWorkspace);
  const renameWorkspace = usePanels((s) => s.renameWorkspace);
  const closeWorkspace = usePanels((s) => s.closeWorkspace);

  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const commitRename = (id: string) => {
    renameWorkspace(id, draft);
    setEditing(null);
  };

  return (
    <div className="flex items-center gap-0.5 overflow-x-auto border-b border-term-border bg-term-header px-2 text-2xs scroll-term">
      {workspaces.map((w) => {
        const active = w.id === activeWorkspaceId;
        if (editing === w.id) {
          return (
            <input
              key={w.id}
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => commitRename(w.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename(w.id);
                else if (e.key === 'Escape') setEditing(null);
              }}
              className="my-1 w-24 rounded-sm bg-term-bg px-1 py-0.5 text-term-text outline-none"
            />
          );
        }
        return (
          <div
            key={w.id}
            onClick={() => switchWorkspace(w.id)}
            onDoubleClick={() => {
              setEditing(w.id);
              setDraft(w.name);
            }}
            title="Click to switch · double-click to rename"
            className={`group flex shrink-0 cursor-pointer items-center gap-1 border-b-2 px-2 py-1 ${
              active
                ? 'border-term-amber text-term-amber'
                : 'border-transparent text-term-muted hover:text-term-text'
            }`}
          >
            <span>{w.name}</span>
            {workspaces.length > 1 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  closeWorkspace(w.id);
                }}
                title="Close workspace"
                className="leading-none text-term-dim opacity-0 transition-opacity hover:text-term-down group-hover:opacity-100"
              >
                ×
              </button>
            )}
          </div>
        );
      })}
      <button
        onClick={() => addWorkspace()}
        title="New workspace"
        className="shrink-0 px-2 py-1 text-sm leading-none text-term-muted hover:text-term-amber"
      >
        +
      </button>
    </div>
  );
}
