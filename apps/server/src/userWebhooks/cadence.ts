const HOUR_MS = 3_600_000;

export interface DigestWindow {
  start: number;
  end: number;
  intervalMs: number;
  hours: number;
}

/** Fixed UTC/Unix-aligned completed window; process restarts do not move it. */
export function completedDigestWindow(now: number, configuredHours: number): DigestWindow | null {
  if (!Number.isFinite(now) || now < 0 || !Number.isFinite(configuredHours) || configuredHours <= 0) {
    return null;
  }
  const hours = Math.max(1, configuredHours);
  const intervalMs = hours * HOUR_MS;
  if (!Number.isFinite(intervalMs) || intervalMs <= 0 || intervalMs > Number.MAX_SAFE_INTEGER) return null;
  const end = Math.floor(now / intervalMs) * intervalMs;
  if (!Number.isFinite(end)) return null;
  return { start: end - intervalMs, end, intervalMs, hours };
}

/** Watermark used when saving/enabling so pre-configuration windows are skipped. */
export function currentDigestWatermark(now: number, configuredHours: number): number {
  return completedDigestWindow(now, configuredHours)?.end ?? (Number.isFinite(now) && now >= 0 ? now : 0);
}
