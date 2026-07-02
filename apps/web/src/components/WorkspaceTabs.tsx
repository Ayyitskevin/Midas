import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { usePanels } from '@/store/usePanels';
import type { WorkspaceExport } from '@/store/usePanels';
import { useToasts } from '@/store/useToasts';
import { TEMPLATES, applyTemplate } from '@/commands/templates';
import { downloadJson } from '@/lib/fileDownload';
import { encodeWorkspaceShare } from '@/lib/workspaceShare';
import { shareUrl } from '@/lib/deepLink';

/** Trigger a browser download of a workspace snapshot as a .midas.json file. */
function downloadWorkspace(ws: WorkspaceExport) {
  const safe = ws.name.replace(/[^a-z0-9-_]+/gi, '-').toLowerCase() || 'workspace';
  downloadJson(`${safe}.midas.json`, ws);
}

function NewWorkspaceMenu() {
  const addWorkspace = usePanels((s) => s.addWorkspace);
  const importWorkspace = usePanels((s) => s.importWorkspace);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // reset so re-picking the same file fires onChange again
    if (!file) return;
    try {
      let data: unknown;
      try {
        data = JSON.parse(await file.text());
      } catch {
        throw new Error('File is not valid JSON');
      }
      importWorkspace(data);
      setError(null);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not import file');
    }
  };

  return (
    <div className="relative shrink-0">
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        onChange={handleFile}
        className="hidden"
      />
      <button
        onClick={() => {
          setOpen((v) => !v);
          setError(null);
        }}
        title="New workspace"
        aria-label="New workspace"
        className="px-2 py-1 text-sm leading-none text-term-muted hover:text-term-amber"
      >
        +
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-7 z-50 w-60 overflow-hidden rounded-sm border border-term-border bg-term-panel text-2xs shadow-lg shadow-black/40">
            <div className="border-b border-term-border px-2 py-1 text-term-dim">New workspace</div>
            <button
              onClick={() => {
                addWorkspace();
                setOpen(false);
              }}
              className="flex w-full flex-col items-start gap-0.5 px-2 py-1.5 text-left hover:bg-term-header"
            >
              <span className="text-term-text">Blank</span>
              <span className="text-term-dim">An empty workspace.</span>
            </button>
            {TEMPLATES.map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  applyTemplate(t);
                  setOpen(false);
                }}
                className="flex w-full flex-col items-start gap-0.5 border-t border-term-border px-2 py-1.5 text-left hover:bg-term-header"
              >
                <span className="text-term-amber">{t.name}</span>
                <span className="text-term-dim">{t.description}</span>
              </button>
            ))}
            <button
              onClick={() => fileRef.current?.click()}
              className="flex w-full flex-col items-start gap-0.5 border-t border-term-border px-2 py-1.5 text-left hover:bg-term-header"
            >
              <span className="text-term-text">Import from file…</span>
              <span className="text-term-dim">Load a .midas.json workspace.</span>
            </button>
            {error && (
              <div className="border-t border-term-border px-2 py-1.5 text-term-down">⚠ {error}</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function ExportButton() {
  const exportWorkspace = usePanels((s) => s.exportWorkspace);
  const panelCount = usePanels((s) => s.panels.length);
  return (
    <button
      onClick={() => downloadWorkspace(exportWorkspace())}
      disabled={panelCount === 0}
      title="Export current workspace to a file"
      aria-label="Export workspace to a file"
      className="shrink-0 px-2 py-1 text-xs leading-none text-term-muted hover:text-term-amber disabled:opacity-30 disabled:hover:text-term-muted"
    >
      ⤓
    </button>
  );
}

function ShareButton() {
  const exportWorkspace = usePanels((s) => s.exportWorkspace);
  const panelCount = usePanels((s) => s.panels.length);
  const pushToast = useToasts((s) => s.push);
  const [copied, setCopied] = useState(false);

  const share = async () => {
    const token = encodeWorkspaceShare(exportWorkspace());
    if (!token) {
      pushToast({
        title: 'Workspace too large for a link',
        body: 'This one exceeds what a URL can carry — use file export (⤓) instead.',
        tone: 'down',
      });
      return;
    }
    const url = shareUrl(token);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      pushToast({
        title: 'Share link copied',
        body: 'Anyone opening it gets this workspace as a new tab in their Midas. The layout lives in the link itself — nothing was uploaded.',
        tone: 'up',
      });
    } catch {
      // Clipboard can be unavailable (permissions, non-secure context) — the
      // prompt still lets the user copy by hand.
      window.prompt('Copy this workspace share link:', url);
    }
  };

  return (
    <button
      onClick={() => void share()}
      disabled={panelCount === 0}
      title="Copy a share link for this workspace — the layout travels in the URL, nothing is uploaded"
      aria-label="Copy workspace share link"
      className="shrink-0 px-2 py-1 text-xs leading-none text-term-muted hover:text-term-amber disabled:opacity-30 disabled:hover:text-term-muted"
    >
      {copied ? '✓' : '⧉'}
    </button>
  );
}

export function WorkspaceTabs() {
  const workspaces = usePanels((s) => s.workspaces);
  const activeWorkspaceId = usePanels((s) => s.activeWorkspaceId);
  const switchWorkspace = usePanels((s) => s.switchWorkspace);
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
                aria-label={`Close workspace ${w.name}`}
                className="leading-none text-term-dim opacity-0 transition-opacity hover:text-term-down group-hover:opacity-100"
              >
                ×
              </button>
            )}
          </div>
        );
      })}
      <NewWorkspaceMenu />
      <ShareButton />
      <ExportButton />
    </div>
  );
}
