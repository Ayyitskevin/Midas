import type { AccountKeysInput } from '@midas/shared';

/**
 * Pure logic for the KEYS panel — error classification and form validation,
 * kept out of the component so the states the panel can honestly show are
 * unit-testable without a DOM.
 */

/** Why the key store answered with an error, mapped to a panel state. */
export type KeysErrorKind = 'feature-off' | 'needs-auth' | 'error';

/**
 * Classify an API error message from /api/account/keys. The server answers
 * 501 with a MIDAS_KEYS_KMS_SECRET explanation when the feature is off, and
 * the auth guard (401) or key routes (400) mention login when the caller
 * isn't signed in.
 */
export function classifyKeysError(message: string): KeysErrorKind {
  if (/MIDAS_KEYS_KMS_SECRET/i.test(message)) return 'feature-off';
  if (/log ?in|sign ?in|unauthorized|auth/i.test(message)) return 'needs-auth';
  return 'error';
}

/** Validate the save form; returns human-readable problems (empty = ok). Pure. */
export function validateKeysInput(input: AccountKeysInput): string[] {
  const errors: string[] = [];
  if (!input.exchange.trim()) errors.push('Exchange id is required (e.g. binance, kraken).');
  else if (!/^[a-z0-9]+$/.test(input.exchange.trim().toLowerCase())) {
    errors.push('Exchange must be a ccxt id — lowercase letters/digits only.');
  }
  if (!input.apiKey.trim()) errors.push('API key is required.');
  if (!input.secret.trim()) errors.push('API secret is required.');
  return errors;
}

/** Display mask for a stored key: only the last 4 are ever known client-side. */
export function maskKey(last4: string): string {
  return `••••••••${last4}`;
}
