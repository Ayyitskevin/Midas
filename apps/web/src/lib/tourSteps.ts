/**
 * The first-run tour: six commands that show what Midas is in under a minute.
 * Data only — the START panel renders these as one-click rows, so the tour
 * teaches the command grammar by *running* it, not by describing it.
 */
export interface TourStep {
  /** The literal command the row runs (and displays). */
  command: string;
  title: string;
  blurb: string;
}

export const TOUR_STEPS: TourStep[] = [
  {
    command: 'BTC/USDT GP',
    title: 'Chart anything',
    blurb: 'SYMBOL FUNCTION is the whole grammar. Candles with overlays, drawings and live streaming.',
  },
  {
    command: 'BTC/USDT BOOK',
    title: 'Read the book',
    blurb: 'Live L2 depth. Link panels (colored groups) and clicking a level loads that price into a ticket.',
  },
  {
    command: 'SCAN',
    title: 'Screen the market',
    blurb: 'The unified screener — momentum, volume and volatility criteria, ~115 analytics boards behind it.',
  },
  {
    command: 'BTC/USDT ALERT',
    title: 'Set an alert',
    blurb: 'Price, funding, %-change — plus position P&L and account equity once keys are set. Webhook delivery built in.',
  },
  {
    command: 'BAL',
    title: 'See your account',
    blurb: 'Read-only keys light up balances, orders, positions and fills — with fill toasts and a weekly digest.',
  },
  {
    command: 'WN',
    title: "See what's new",
    blurb: 'Release highlights in-terminal. HELP lists every command; ⌘K searches everything.',
  },
];
