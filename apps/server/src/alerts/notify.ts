import { opSymbol, priceDecimals, type AlertTrigger } from '@midas/shared';

/** Trim a value to a sensible precision for its metric. */
function fmtNum(value: number, metric: AlertTrigger['metric']): string {
  if (Number.isInteger(value)) return String(value);
  // Prices are magnitude-scaled (shared with the browser formatter) so a
  // sub-cent token reads as 0.00002500, not a meaningless 0.00; USD amounts
  // stay at 2, rates (funding/change) at 4.
  if (metric === 'price') return value.toFixed(priceDecimals(value));
  return value.toFixed(metric === 'upnl' || metric === 'equity' ? 2 : 4);
}

/** Unit suffix per metric: prices/USD amounts are bare or $, rates are %. */
function unitFor(metric: AlertTrigger['metric']): string {
  if (metric === 'price') return '';
  if (metric === 'upnl' || metric === 'equity') return ' USD';
  return '%';
}

/** A short human title + line for one trigger. */
export function formatTrigger(t: AlertTrigger): { title: string; text: string } {
  const unit = unitFor(t.metric);
  const title = `${t.symbol} ${t.metric} ${opSymbol(t.op)} ${fmtNum(t.value, t.metric)}${unit}`;
  const text = `🔔 ${title} — now ${fmtNum(t.actual, t.metric)}${unit}`;
  return { title, text };
}

export interface WebhookPayload {
  /** Discord reads `content`; Slack reads `text`; both get the same summary. */
  content: string;
  text: string;
  /** Raw triggers for custom consumers. */
  triggers: AlertTrigger[];
}

export function buildWebhookPayload(fired: AlertTrigger[]): WebhookPayload {
  const body = fired.map((t) => formatTrigger(t).text).join('\n');
  return { content: body, text: body, triggers: fired };
}

/** Delivers fired triggers somewhere out-of-band (no browser required). */
export interface Notifier {
  deliver(fired: AlertTrigger[]): Promise<void>;
}

/**
 * POSTs fires as JSON to a single webhook URL. The payload is shaped to work
 * with Discord (`content`), Slack (`text`) and custom endpoints (`triggers`)
 * out of the box. Failures are swallowed (best-effort) via `onError`.
 */
export class WebhookNotifier implements Notifier {
  constructor(
    private readonly url: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly onError?: (err: unknown) => void,
  ) {}

  async deliver(fired: AlertTrigger[]): Promise<void> {
    if (fired.length === 0) return;
    try {
      await this.fetchImpl(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(buildWebhookPayload(fired)),
      });
    } catch (err) {
      this.onError?.(err);
    }
  }
}

class NoopNotifier implements Notifier {
  async deliver(): Promise<void> {
    /* nothing configured */
  }
}

export function createNotifier(opts: {
  webhookUrl?: string;
  onError?: (err: unknown) => void;
}): Notifier {
  return opts.webhookUrl ? new WebhookNotifier(opts.webhookUrl, fetch, opts.onError) : new NoopNotifier();
}
