/**
 * Copy text to the clipboard. Resolves true on success, false when the
 * Clipboard API is unavailable (non-HTTPS, older browser) or the write is
 * blocked — callers surface that as a toast rather than throwing.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
