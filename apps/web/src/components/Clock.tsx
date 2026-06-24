import { useEffect, useState } from 'react';
import { fmtMarketClock } from '@/lib/format';
import { marketSession, sessionColor } from '@/lib/market';

export function Clock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const session = marketSession(now);

  return (
    <div className="flex items-center gap-2">
      <span className={`text-2xs font-medium uppercase ${sessionColor(session)}`}>{session}</span>
      <span className="tabular-nums text-term-text">
        {fmtMarketClock(now)} <span className="text-2xs text-term-dim">ET</span>
      </span>
    </div>
  );
}
