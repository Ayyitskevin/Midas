/**
 * Minimal outbound operator webhook — POSTs one text line as JSON shaped for
 * Discord (`content`) and Slack (`text`) alike, matching the alert engine's
 * payload. Fire-and-forget by design: delivery is best-effort and must never
 * affect the caller (a webhook outage cannot be allowed to break an order
 * path or a watcher tick).
 */
export function postWebhookText(url: string, text: string, fetchImpl: typeof fetch = fetch): void {
  if (!url) return;
  fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: text, text }),
  }).catch(() => {
    /* best-effort */
  });
}
