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
    version: '0.5.0',
    date: '2026-07-02',
    title: 'The hosted-ready release',
    highlights: [
      'KEYS panel: store your own exchange keys — encrypted at rest, write-only, one-action delete',
      'Your keys, your account: reads AND (opt-in, gated) trading go to your own exchange account with your own daily budget',
      'Daily P&L recap in the digest — equity change, round-trip realized P&L, fees, top movers (MIDAS_DIGEST_HOURS=24)',
      'One-click alert templates (⚡ in ALERT): funding flip, ±5% move, equity drawdown',
      'Workspace share links (⧉): the whole layout in a URL — nothing uploaded',
    ],
  },
  {
    version: '0.4.0',
    date: '2026-07-01',
    title: 'The whole-roadmap release',
    highlights: [
      'Post-trade slippage in FILLS + execution quality board (XQL) — realized vs estimated, maker/taker, fees',
      'Account equity curve (AEQ): server-side snapshots, charted with truthful gaps',
      'Alerts on your account: position P&L (upnl) and total equity thresholds, webhook-delivered',
      'Near-realtime fills via ccxt.pro stream nudge; optional second keyed venue with per-row tags',
      'First-run tour (START), system status (SYS), and a public-demo mode for try-before-you-buy',
    ],
  },
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
      'Historical execution prototype (retired behind the current execution safety hold)',
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
