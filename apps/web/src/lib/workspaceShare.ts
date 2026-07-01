import type { WorkspaceExport } from '@/store/usePanels';

/**
 * Workspace share links — a workspace export folded into a URL fragment, so
 * "here's my funding desk" is one link with no file attached. The payload
 * rides the same versioned export/import path as .midas.json files (the
 * importer re-sanitizes every panel), and it lives in the *fragment*, which
 * never leaves the browser: nothing is uploaded anywhere.
 *
 * Token shape: `ws!<base64url(JSON)>` beside the existing #scan?/#board? links.
 */

export const WS_TOKEN_PREFIX = 'ws!';

/** Keep share URLs within what chat apps and browsers reliably accept. */
const MAX_TOKEN_CHARS = 8000;

const b64encode = (s: string): string => {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const b64decode = (s: string): string | null => {
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
};

/**
 * Encode a workspace export as a share token, or null when it wouldn't fit in
 * a URL (huge workspaces still have file export). Panels are reduced to the
 * fields the importer actually reads — ids and min-sizes are recomputed there.
 */
export function encodeWorkspaceShare(ws: WorkspaceExport): string | null {
  const compact = {
    midas: 'workspace',
    version: ws.version,
    name: ws.name,
    panels: ws.panels.map((p) => ({
      module: p.module,
      symbol: p.symbol,
      title: p.title,
      ...(p.params ? { params: p.params } : {}),
      ...(p.link ? { link: p.link } : {}),
      x: p.x,
      y: p.y,
      w: p.w,
      h: p.h,
    })),
  };
  const token = WS_TOKEN_PREFIX + b64encode(JSON.stringify(compact));
  return token.length <= MAX_TOKEN_CHARS ? token : null;
}

/**
 * Decode a `ws!` token back into import-ready data, or null for anything that
 * isn't one of ours. Only the envelope is checked here — panel-level
 * sanitization stays in `importWorkspace`, same as file imports.
 */
export function decodeWorkspaceShare(raw: string): { name: string; data: unknown } | null {
  const token = raw.startsWith('#') ? raw.slice(1) : raw;
  if (!token.startsWith(WS_TOKEN_PREFIX)) return null;
  const json = b64decode(token.slice(WS_TOKEN_PREFIX.length));
  if (json == null) return null;
  try {
    const data: unknown = JSON.parse(json);
    if (!data || typeof data !== 'object') return null;
    const d = data as Record<string, unknown>;
    if (d.midas !== 'workspace' || !Array.isArray(d.panels)) return null;
    const name = typeof d.name === 'string' && d.name.trim() ? d.name.trim() : 'Shared workspace';
    return { name, data };
  } catch {
    return null;
  }
}
