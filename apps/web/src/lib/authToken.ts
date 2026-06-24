/**
 * A tiny module-level holder for the current bearer token, shared between the
 * API client (which attaches it) and the auth store (which sets it). Keeping it
 * here avoids an api ⇄ store import cycle.
 */

let current: string | null = null;
let onUnauthorized: (() => void) | null = null;

export const authToken = {
  get: (): string | null => current,
  set: (token: string | null): void => {
    current = token;
  },
  /** Register the handler called when an authenticated request is rejected (401). */
  setOnUnauthorized: (fn: () => void): void => {
    onUnauthorized = fn;
  },
  fireUnauthorized: (): void => onUnauthorized?.(),
};
