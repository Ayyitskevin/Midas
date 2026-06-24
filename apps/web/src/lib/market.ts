export type Session = 'PRE' | 'OPEN' | 'AFTER' | 'CLOSED';

const PARTS_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** Current US-equity session, computed in Eastern time. */
export function marketSession(now = new Date()): Session {
  const parts = PARTS_FMT.formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const weekday = get('weekday');
  if (weekday === 'Sat' || weekday === 'Sun') return 'CLOSED';

  let hour = parseInt(get('hour'), 10);
  if (hour === 24) hour = 0;
  const minute = parseInt(get('minute'), 10);
  const mins = hour * 60 + minute;

  if (mins >= 9 * 60 + 30 && mins < 16 * 60) return 'OPEN';
  if (mins >= 4 * 60 && mins < 9 * 60 + 30) return 'PRE';
  if (mins >= 16 * 60 && mins < 20 * 60) return 'AFTER';
  return 'CLOSED';
}

export function sessionColor(session: Session): string {
  switch (session) {
    case 'OPEN':
      return 'text-term-up';
    case 'PRE':
    case 'AFTER':
      return 'text-term-amber';
    default:
      return 'text-term-dim';
  }
}
