/**
 * Minimal outbound operator webhook — POSTs one text line as JSON shaped for
 * Discord (`content`) and Slack (`text`) alike, matching the alert engine's
 * payload. Fire-and-forget by design: delivery is best-effort and must never
 * affect the caller (a webhook outage cannot be allowed to break an order
 * path or a watcher tick).
 */

/** A hung endpoint must not pin a socket forever. */
const WEBHOOK_TIMEOUT_MS = 10_000;

export function postWebhookText(url: string, text: string, fetchImpl: typeof fetch = fetch): void {
  if (!url) return;
  fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: text, text }),
    signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
  })
    .then((res) => {
      // Log message-only: never the URL (it embeds the webhook token) or the
      // payload (alert detail). A 404/401 must not be swallowed silently.
      if (!res.ok) console.warn(`webhook delivery failed: HTTP ${res.status}`);
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : 'unknown error';
      console.warn(`webhook delivery failed: ${message}`);
    });
}
