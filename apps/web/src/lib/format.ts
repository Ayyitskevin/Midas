/** Number / date formatting helpers tuned for a dense market terminal. */

export function fmtPrice(value: number | null | undefined, decimals = 2): string {
  if (value == null || Number.isNaN(value)) return '—';
  const abs = Math.abs(value);
  // Use more precision for sub-dollar instruments.
  const d = abs > 0 && abs < 1 ? 4 : decimals;
  return value.toLocaleString('en-US', {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
}

export function fmtSigned(value: number | null | undefined, decimals = 2): string {
  if (value == null || Number.isNaN(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${fmtPrice(value, decimals)}`;
}

export function fmtSignedPercent(value: number | null | undefined, decimals = 2): string {
  if (value == null || Number.isNaN(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(decimals)}%`;
}

export function fmtInt(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  return Math.round(value).toLocaleString('en-US');
}

/** Compact magnitude: 1.23T / 45.6B / 789M / 12.3K. */
export function fmtCompact(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1e12) return `${sign}${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(2)}K`;
  return `${sign}${abs.toFixed(0)}`;
}

/** Tailwind text-color class for a directional value. */
export function changeClass(value: number | null | undefined): string {
  if (value == null || value === 0 || Number.isNaN(value)) return 'text-term-muted';
  return value > 0 ? 'text-term-up' : 'text-term-down';
}

export function fmtTimeAgo(epochMs: number): string {
  const diff = Date.now() - epochMs;
  if (diff < 0) return 'now';
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const TIME_FMT = new Intl.DateTimeFormat('en-US', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
  timeZone: 'America/New_York',
});

/** HH:MM:SS in US market (Eastern) time. */
export function fmtMarketClock(date: Date): string {
  return TIME_FMT.format(date);
}

export function fmtDate(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}
