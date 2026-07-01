/**
 * In-app release announcements. The data ships with the web bundle (it IS the
 * changelog, curated to what a trader notices), and the nudge compares the
 * SERVER's version — so a self-hoster who pulls a new image gets exactly one
 * "Midas updated" toast, and the WN panel explains what changed.
 */

export interface Release {
  version: string;
  /** ISO date (or YYYY-MM when the day is not meaningful). */
  date: string;
  title: string;
  highlights: string[];
}

/** Newest first. Keep entries short — headlines, not commit logs. */
export const RELEASES: Release[] = [
  {
    version: '0.3.0',
    date: '2026-07-01',
    title: 'Launch polish: digest, announcements, hardening',
    highlights: [
      'Weekly operator digest — alerts fired + order flow observed, straight to your webhook (MIDAS_DIGEST_HOURS)',
      "What's New panel (WN) + a one-time toast when your server updates",
      'Login throttling and security response headers out of the box',
      'One-command production deploy script (scripts/deploy.sh)',
    ],
  },
  {
    version: '0.2.0',
    date: '2026-07-01',
    title: 'The execution release',
    highlights: [
      'Full non-custodial account suite: BAL / ORD / POSN / FILLS with honest live/demo labeling',
      'Gated LIVE trading: two-step confirms, per-order + daily notional caps, idempotency, audit + webhook',
      'Fill notifications: account watcher → terminal toasts + webhook, even for orders placed outside Midas',
      'TICKET tracks each placement live: open → partially filled → filled/canceled',
      'Trade Desk workspace template with click-to-price from the order book',
    ],
  },
  {
    version: '0.1.0',
    date: '2026-06',
    title: 'The terminal',
    highlights: [
      'Command-driven tiling workspace: SYMBOL FUNCTION grammar, ⌘K palette, linked panels',
      '~115 indicator/analytics boards, charts with overlays & drawings, L2 book, depth, CVD',
      'Crypto-native data: multi-exchange via ccxt, funding/OI, honest liquidations, on-chain/DEX',
      'Alerts (price/funding/%-change) with webhook delivery; portfolio with live P&L',
      'Self-hosted: docker compose up, optional multi-user auth, per-user sync',
    ],
  },
];

/** Semver-lite compare: returns >0 when a > b. Non-numeric parts compare as 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((p) => parseInt(p, 10) || 0);
  const pb = b.split('.').map((p) => parseInt(p, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** True when the server's version is newer than the one the user last saw. */
export function isNewerVersion(current: string, seen: string | null): boolean {
  if (!current) return false;
  if (!seen) return false; // first contact — baseline silently, never toast history
  return compareVersions(current, seen) > 0;
}
