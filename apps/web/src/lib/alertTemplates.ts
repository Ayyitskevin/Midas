import { ACCOUNT_SYMBOL, type AlertInput } from '@/lib/alerts';

/**
 * One-click alert templates — the classic setups, pre-filled from what the
 * terminal already knows. Each template builds real AlertInputs (through the
 * same create path as the form) or honestly explains why it can't.
 */

export interface TemplateContext {
  /** The panel's symbol, if it has one. */
  symbol: string | null;
  /** Live account equity in USD, when readable; null keeps equity templates honest. */
  equityUsd: number | null;
}

export type TemplateBuild = { inputs: AlertInput[] } | { unavailable: string };

export interface AlertTemplate {
  key: string;
  /** Button label. */
  label: string;
  /** Tooltip: what clicking arms. */
  hint: string;
  /** Whether the build needs a live equity read first (fetched on click). */
  needsEquity?: boolean;
  build(ctx: TemplateContext): TemplateBuild;
}

const DRAWDOWN_PCT = 5;
const MOVE_PCT = 5;

/** Round to cents so a template threshold doesn't carry float noise. */
const cents = (n: number): number => Math.round(n * 100) / 100;

export const ALERT_TEMPLATES: readonly AlertTemplate[] = [
  {
    key: 'funding-flip',
    label: 'funding flip',
    hint: 'Fires whenever the funding rate crosses 0% — longs start paying shorts or vice versa. Repeats.',
    build(ctx) {
      if (!ctx.symbol) return { unavailable: 'Needs a symbol — set one on this panel first.' };
      return {
        inputs: [
          { symbol: ctx.symbol, metric: 'funding', op: 'cross', value: 0, note: 'Funding flip', repeat: true },
        ],
      };
    },
  },
  {
    key: 'pct-move',
    label: `±${MOVE_PCT}% move`,
    hint: `Two repeating alerts: 24h change rises past +${MOVE_PCT}% or falls past −${MOVE_PCT}%.`,
    build(ctx) {
      if (!ctx.symbol) return { unavailable: 'Needs a symbol — set one on this panel first.' };
      return {
        inputs: [
          { symbol: ctx.symbol, metric: 'change', op: 'above', value: MOVE_PCT, note: `+${MOVE_PCT}% day`, repeat: true },
          { symbol: ctx.symbol, metric: 'change', op: 'below', value: -MOVE_PCT, note: `−${MOVE_PCT}% day`, repeat: true },
        ],
      };
    },
  },
  {
    key: 'equity-drawdown',
    label: `equity −${DRAWDOWN_PCT}%`,
    hint: `One-shot alert when total account equity drops ${DRAWDOWN_PCT}% below its value right now. Needs live account keys.`,
    needsEquity: true,
    build(ctx) {
      if (ctx.equityUsd == null || !(ctx.equityUsd > 0)) {
        return { unavailable: 'Needs a live equity read — configure exchange API keys first.' };
      }
      const threshold = cents(ctx.equityUsd * (1 - DRAWDOWN_PCT / 100));
      return {
        inputs: [
          {
            symbol: ACCOUNT_SYMBOL,
            metric: 'equity',
            op: 'below',
            value: threshold,
            note: `−${DRAWDOWN_PCT}% from $${ctx.equityUsd.toLocaleString('en-US', { maximumFractionDigits: 2 })}`,
            repeat: false,
          },
        ],
      };
    },
  },
];
