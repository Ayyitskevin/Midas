import { useEffect, useState, type FormEvent } from 'react';
import type {
  AccountWebhookDeliveryStatus,
  AccountWebhookFailureCategory,
  AccountWebhookResponse,
} from '@midas/shared';
import { EmptyState, Loading } from '@/components/Feedback';
import { api } from '@/lib/api';
import { fmtTimeAgo } from '@/lib/format';
import { useFetch } from '@/lib/hooks';

const inputCls =
  'no-drag w-full rounded-sm border border-term-border bg-transparent px-2 py-1 text-xs text-term-text outline-none focus:border-term-amber';

type BusyAction = 'save' | 'toggle' | 'clear' | null;
type Message = { kind: 'ok' | 'error'; text: string } | null;

const FAILURE_LABELS: Record<AccountWebhookFailureCategory, string> = {
  'blocked-target': 'target blocked by the network safety policy',
  capacity: 'delivery capacity unavailable',
  configuration: 'saved configuration unavailable',
  dns: 'public address lookup failed',
  'http-4xx': 'endpoint rejected the request',
  'http-5xx': 'endpoint service failed',
  'malformed-response': 'endpoint returned an invalid response',
  network: 'network delivery failed',
  'queue-full': 'delivery queue was full',
  redirect: 'endpoint attempted a redirect',
  timeout: 'delivery timed out',
};

function safeError(error: unknown, fallback: string): string {
  if (!(error instanceof Error) || !error.message.trim()) return fallback;
  return error.message
    .replace(/https?:\/\/[^\s<>"']+/gi, 'the webhook URL')
    .replace(/\b(token|secret|password|authorization|cookie)\s*[:=]\s*\S+/gi, '$1=[redacted]')
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, 180);
}

function isFeatureOff(error: string): boolean {
  return /personal webhooks? (?:are|is) off|MIDAS_USER_WEBHOOKS|static demo|isn't part of the static demo/i.test(
    error,
  );
}

function deliveryDescription(status: AccountWebhookDeliveryStatus): string {
  const kind = status.kind === 'fills' ? 'Fill notification' : 'P&L recap';
  const when = Number.isFinite(status.at) ? ` · ${fmtTimeAgo(status.at)}` : '';
  if (status.outcome === 'pending') return `${kind} pending${when}`;
  if (status.outcome === 'delivered') return `${kind} delivered${when}`;
  const reason =
    status.failureCategory && Object.hasOwn(FAILURE_LABELS, status.failureCategory)
      ? FAILURE_LABELS[status.failureCategory]
      : 'delivery failed';
  return `${kind} failed: ${reason}${when}`;
}

function cadenceDescription(response: AccountWebhookResponse): string {
  const fills = response.fillNotificationsAvailable
    ? 'Fill notifications are available.'
    : 'Fill notifications are unavailable on this server.';
  if (response.digestHours == null) return `${fills} P&L recaps are off.`;
  const digest =
    response.digestHours === 24
      ? 'Daily P&L recaps are available.'
      : `P&L recaps are available every ${response.digestHours} hours.`;
  return `${fills} ${digest}`;
}

/** Authenticated ACCT surface for the caller's optional, write-only webhook. */
export function WebhookSettings() {
  const { data, error, loading, refresh } = useFetch(
    (signal) => api.accountWebhook(signal),
    [],
    { intervalMs: 30_000 },
  );
  const [latest, setLatest] = useState<AccountWebhookResponse | null>(null);
  const [url, setUrl] = useState('');
  const [replacing, setReplacing] = useState(false);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [message, setMessage] = useState<Message>(null);

  const response = latest ?? data;
  const webhook = response?.webhook ?? null;
  const showForm = webhook == null || replacing;

  // Mutation responses render immediately; the next successful poll/refresh
  // becomes authoritative so delivery outcomes can update without remounting.
  useEffect(() => {
    setLatest(null);
  }, [data, error]);

  async function save(event: FormEvent): Promise<void> {
    event.preventDefault();
    const candidate = url.trim();
    if (!candidate) {
      setMessage({ kind: 'error', text: 'Enter an HTTPS webhook URL.' });
      return;
    }
    setBusy('save');
    setMessage(null);
    try {
      const next = await api.saveAccountWebhook({ url: candidate });
      // The address is write-only. End its client-side lifetime immediately,
      // and rely exclusively on the metadata-only response from here on.
      setUrl('');
      setReplacing(false);
      setLatest(next);
      setMessage({
        kind: 'ok',
        text: 'Webhook saved and validated. Delivery remains disabled until you enable it.',
      });
      refresh();
    } catch (saveError) {
      setMessage({
        kind: 'error',
        text: safeError(saveError, 'The webhook URL could not be saved.'),
      });
    } finally {
      setBusy(null);
    }
  }

  async function toggle(): Promise<void> {
    if (!webhook) return;
    const enabled = !webhook.enabled;
    setBusy('toggle');
    setMessage(null);
    try {
      const next = await api.setAccountWebhookEnabled({ enabled });
      setLatest(next);
      setMessage({
        kind: 'ok',
        text: enabled ? 'Personal webhook delivery enabled.' : 'Personal webhook delivery disabled.',
      });
      refresh();
    } catch (toggleError) {
      setMessage({
        kind: 'error',
        text: safeError(toggleError, 'Webhook delivery could not be changed.'),
      });
    } finally {
      setBusy(null);
    }
  }

  async function clear(): Promise<void> {
    if (!response) return;
    setBusy('clear');
    setMessage(null);
    try {
      await api.deleteAccountWebhook();
      setUrl('');
      setReplacing(false);
      setLatest({ ...response, webhook: null });
      setMessage({ kind: 'ok', text: 'Saved webhook cleared. Delivery is off.' });
      refresh();
    } catch (clearError) {
      setMessage({
        kind: 'error',
        text: safeError(clearError, 'The saved webhook could not be cleared.'),
      });
    } finally {
      setBusy(null);
    }
  }

  if (loading && !response) {
    return (
      <section aria-labelledby="personal-webhook-heading" className="mb-4">
        <h3 id="personal-webhook-heading" className="mb-1 text-2xs font-semibold uppercase tracking-wide text-term-dim">
          Personal webhook
        </h3>
        <Loading label="Loading webhook status" />
      </section>
    );
  }

  if (error && !response) {
    if (isFeatureOff(error)) {
      return (
        <section aria-labelledby="personal-webhook-heading" className="mb-4">
          <h3 id="personal-webhook-heading" className="mb-1 text-2xs font-semibold uppercase tracking-wide text-term-dim">
            Personal webhook
          </h3>
          <div role="status">
            <EmptyState>
              Personal webhooks are optional and off on this server. The operator can enable them with{' '}
              <span className="font-mono">MIDAS_USER_WEBHOOKS=true</span> on an authenticated hosted instance.
            </EmptyState>
          </div>
        </section>
      );
    }
    return (
      <section aria-labelledby="personal-webhook-heading" className="mb-4">
        <h3 id="personal-webhook-heading" className="mb-1 text-2xs font-semibold uppercase tracking-wide text-term-dim">
          Personal webhook
        </h3>
        <div role="alert" className="text-2xs text-term-down">
          Webhook status is unavailable.
          <button
            type="button"
            onClick={refresh}
            className="no-drag ml-2 rounded-sm border border-term-border px-2 py-0.5 text-term-amber"
          >
            retry
          </button>
        </div>
      </section>
    );
  }

  if (!response) return null;

  return (
    <section
      aria-labelledby="personal-webhook-heading"
      aria-busy={busy !== null}
      className="mb-4 border-t border-term-border/30 pt-3"
    >
      <h3 id="personal-webhook-heading" className="mb-1 text-2xs font-semibold uppercase tracking-wide text-term-dim">
        Personal webhook
      </h3>
      <p className="mb-2 text-2xs text-term-muted">
        Optional and configured only by you. Eligible fill notifications and P&amp;L recaps contain bounded account
        summaries, never exchange credentials. The saved address is hidden after validation.
      </p>

      <div className="mb-2 flex items-center justify-between gap-3 rounded-sm border border-term-border p-2">
        <div>
          <div id="personal-webhook-delivery-label" className="text-xs text-term-text">
            Webhook delivery
          </div>
          <div className="text-2xs text-term-dim">
            {webhook ? (webhook.enabled ? 'Enabled for this account' : 'Disabled for this account') : 'Save a URL first'}
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-labelledby="personal-webhook-delivery-label"
          aria-checked={webhook?.enabled ?? false}
          disabled={busy !== null || !webhook}
          onClick={() => void toggle()}
          className={`no-drag relative h-5 w-9 rounded-full border transition-colors disabled:opacity-40 ${
            webhook?.enabled
              ? 'border-term-amber/60 bg-term-amber/30'
              : 'border-term-border bg-term-bg'
          }`}
        >
          <span
            aria-hidden="true"
            className={`absolute top-0.5 h-3.5 w-3.5 rounded-full transition-all ${
              webhook?.enabled ? 'left-[18px] bg-term-amber' : 'left-0.5 bg-term-muted'
            }`}
          />
        </button>
      </div>

      <div className="mb-2 text-2xs text-term-dim">{cadenceDescription(response)}</div>

      {webhook && (
        <div className="mb-2 rounded-sm border border-term-border/60 p-2 text-2xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-term-text">Saved address hidden</span>
            <span className="text-term-dim">updated {fmtTimeAgo(webhook.updatedAt)}</span>
          </div>
          {webhook.lastDelivery && (
            <div role="status" className="mt-1 text-term-muted">
              {deliveryDescription(webhook.lastDelivery)}
            </div>
          )}
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => {
                setUrl('');
                setReplacing((value) => !value);
                setMessage(null);
              }}
              disabled={busy !== null}
              className="no-drag rounded-sm border border-term-border px-2 py-0.5 text-term-muted hover:border-term-amber hover:text-term-amber disabled:opacity-40"
            >
              {replacing ? 'keep current' : 'replace…'}
            </button>
            <button
              type="button"
              onClick={() => void clear()}
              disabled={busy !== null}
              className="no-drag rounded-sm border border-term-border px-2 py-0.5 text-term-muted hover:border-term-down hover:text-term-down disabled:opacity-40"
            >
              {busy === 'clear' ? 'clearing…' : 'clear webhook'}
            </button>
          </div>
        </div>
      )}

      {showForm && (
        <form onSubmit={(event) => void save(event)} className="space-y-1.5">
          <label htmlFor="personal-webhook-url" className="block text-2xs text-term-muted">
            {webhook ? 'Replacement webhook URL' : 'Webhook URL'}
          </label>
          <input
            id="personal-webhook-url"
            type="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://hooks.example.net/midas"
            autoComplete="off"
            spellCheck={false}
            required
            maxLength={2048}
            disabled={busy !== null}
            className={inputCls}
          />
          <div className="text-2xs text-term-dim">
            HTTPS public endpoints only. Local, private, metadata, credential-bearing, redirecting, and non-standard
            port targets are rejected. Saving or replacing leaves delivery disabled.
          </div>
          <button
            type="submit"
            disabled={busy !== null || url.trim().length === 0}
            className="no-drag rounded-sm border border-term-amber px-3 py-1 text-2xs font-semibold text-term-amber hover:bg-term-amber hover:text-term-bg disabled:opacity-40"
          >
            {busy === 'save' ? 'Saving…' : webhook ? 'Save replacement' : 'Save webhook'}
          </button>
        </form>
      )}

      {message && (
        <div
          role={message.kind === 'error' ? 'alert' : 'status'}
          className={`mt-2 text-2xs ${message.kind === 'error' ? 'text-term-down' : 'text-term-up'}`}
        >
          {message.text}
        </div>
      )}
    </section>
  );
}
