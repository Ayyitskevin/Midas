/**
 * Shareable deep links. Midas has no URL router; instead a link carries a tiny,
 * human-readable token in the URL *fragment* that reconstructs a view on load:
 *
 *   #scan?t=up&r=oversold&s=1      → open SCAN pre-filtered to that criteria
 *   #board?c=RSI                   → open the RSI board
 *   #board?c=GP&s=BTC%2FUSDT       → open a board/module focused on a symbol
 *   #ws!<payload>                  → import a whole shared workspace
 *
 * Encoding is lossless for set fields only (an "any"/null field is simply
 * omitted), and decoding is defensive: unknown values degrade to 'any' / null
 * (via coerceCriteria) and an unrecognized token returns null. Pure except for
 * `shareUrl`, which reads the current origin.
 */
import type { ScanCriteria } from './signals';
import { coerceCriteria } from './signals';
import { WS_TOKEN_PREFIX, decodeWorkspaceShare } from './workspaceShare';

export type DeepLink =
  | { kind: 'scan'; criteria: ScanCriteria }
  | { kind: 'board'; code: string; symbol: string | null }
  | { kind: 'workspace'; name: string; data: unknown };

const SCAN_PREFIX = 'scan?';
const BOARD_PREFIX = 'board?';

/** Encode a scan's criteria into a compact, URL-safe token (only set fields appear). */
export function encodeScan(c: ScanCriteria): string {
  const p = new URLSearchParams();
  if (c.trend !== 'any') p.set('t', c.trend);
  if (c.rsi !== 'any') p.set('r', c.rsi);
  if (c.range !== 'any') p.set('g', c.range);
  if (c.minScore != null) p.set('s', String(c.minScore));
  return SCAN_PREFIX + p.toString();
}

/** Encode a board command code (+ optional focus symbol) into a token. */
export function encodeBoard(code: string, symbol?: string | null): string {
  const p = new URLSearchParams();
  p.set('c', code.toUpperCase());
  if (symbol) p.set('s', symbol.toUpperCase());
  return BOARD_PREFIX + p.toString();
}

/** Decode a token (with or without a leading '#') into a DeepLink, or null. */
export function decodeLink(token: string): DeepLink | null {
  const raw = token.startsWith('#') ? token.slice(1) : token;
  if (raw.startsWith(SCAN_PREFIX)) {
    const p = new URLSearchParams(raw.slice(SCAN_PREFIX.length));
    const s = p.get('s');
    return {
      kind: 'scan',
      criteria: coerceCriteria({
        trend: p.get('t'),
        rsi: p.get('r'),
        range: p.get('g'),
        minScore: s == null ? null : Number(s),
      }),
    };
  }
  if (raw.startsWith(BOARD_PREFIX)) {
    const p = new URLSearchParams(raw.slice(BOARD_PREFIX.length));
    const code = (p.get('c') ?? '').toUpperCase();
    if (!code) return null;
    const symbol = p.get('s');
    return { kind: 'board', code, symbol: symbol ? symbol.toUpperCase() : null };
  }
  if (raw.startsWith(WS_TOKEN_PREFIX)) {
    const ws = decodeWorkspaceShare(raw);
    return ws ? { kind: 'workspace', name: ws.name, data: ws.data } : null;
  }
  return null;
}

/** A full shareable URL for a token, anchored to the current app origin. */
export function shareUrl(token: string): string {
  const loc = typeof window !== 'undefined' ? window.location : undefined;
  if (!loc) return `#${token}`;
  return `${loc.origin}${loc.pathname}#${token}`;
}
