import { useEffect, useMemo, useRef, useState } from 'react';
import type { Interval, Range } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { volumeProfile } from '@/lib/volumeProfile';
import { fmtPrice, fmtCompact } from '@/lib/format';
import { Loading, ErrorMsg, EmptyState } from '@/components/Feedback';
import type { ModuleProps } from './types';

const TIMEFRAMES: { label: string; interval: Interval; range: Range }[] = [
  { label: '90D', interval: '1d', range: '3mo' },
  { label: '1Y', interval: '1d', range: '1y' },
  { label: '2Y', interval: '1d', range: '2y' },
];
const base = (sym: string) => sym.replace(/\/.*$/, '');

export function VolumeProfileModule({ panel }: ModuleProps) {
  const symbol = panel.symbol;
  const [tfIdx, setTfIdx] = useState(0); // default 90D
  const tf = TIMEFRAMES[tfIdx];

  const { data, error, loading, refresh } = useFetch(
    async (signal) => {
      const h = await api.history(symbol!, tf.interval, tf.range, signal);
      return { candles: h.candles };
    },
    [symbol, tf.interval, tf.range],
    { enabled: !!symbol },
  );

  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setSize({ w: Math.floor(r.width), h: Math.floor(r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Bin count adapts to panel height so each row stays legible.
  const binCount = useMemo(() => Math.max(12, Math.min(36, Math.round(size.h / 14))), [size.h]);
  const profile = useMemo(
    () => (data ? volumeProfile(data.candles, binCount) : null),
    [data, binCount],
  );
  const lastPrice = data && data.candles.length ? data.candles[data.candles.length - 1].close : null;

  const view = useMemo(() => {
    if (!profile || size.w <= 0 || size.h <= 0) return null;
    const padL = 46;
    const padR = 8;
    const padT = 4;
    const padB = 4;
    const pw = size.w - padL - padR;
    const ph = size.h - padT - padB;
    if (pw <= 10 || ph <= 10) return null;
    const n = profile.bins.length;
    const rowH = ph / n;
    let maxVol = 0;
    for (const b of profile.bins) maxVol = Math.max(maxVol, b.volume);
    if (maxVol <= 0) return null;
    const span = profile.priceHigh - profile.priceLow;
    // Price increases upward: bin 0 (lowest) sits at the bottom.
    const yAt = (price: number) => padT + (1 - (price - profile.priceLow) / span) * ph;
    const rows = profile.bins.map((b, i) => ({
      i,
      y: padT + (n - 1 - i) * rowH,
      h: Math.max(1, rowH * 0.8),
      w: (b.volume / maxVol) * pw,
      inVA: b.mid >= profile.val && b.mid <= profile.vah,
      isPoc: i === profile.pocIndex,
    }));
    return { padL, padR, padT, padB, pw, ph, rowH, yAt, rows };
  }, [profile, size]);

  if (!symbol) return <EmptyState>No symbol selected.</EmptyState>;
  if (loading && !data) return <Loading label={`Loading ${symbol}`} />;
  if (error && !data) return <ErrorMsg message={error} onRetry={refresh} />;
  if (!profile) return <EmptyState>Not enough history to build a volume profile.</EmptyState>;

  const vaPct = profile.totalVolume > 0 ? (profile.valueAreaVolume / profile.totalVolume) * 100 : 0;

  return (
    <div className="flex h-full flex-col text-2xs">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1">
        <span className="text-term-dim">{base(symbol)} volume profile · daily</span>
        <div className="ml-auto flex gap-1">
          {TIMEFRAMES.map((t, i) => (
            <button
              key={t.label}
              onClick={() => setTfIdx(i)}
              className={`no-drag rounded-sm px-1.5 py-0.5 ${
                i === tfIdx ? 'bg-term-amber/20 text-term-amber' : 'text-term-muted hover:text-term-text'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-baseline gap-3 px-2 py-1 tabular-nums">
        <span className="text-term-muted">POC <span className="font-semibold text-term-amber">{fmtPrice(profile.poc)}</span></span>
        <span className="text-term-muted">VAH <span className="text-term-text">{fmtPrice(profile.vah)}</span></span>
        <span className="text-term-muted">VAL <span className="text-term-text">{fmtPrice(profile.val)}</span></span>
        <span className="ml-auto text-term-dim">VA {vaPct.toFixed(0)}% · vol {fmtCompact(profile.totalVolume)}</span>
      </div>

      <div className="relative min-h-0 flex-1">
        <div ref={wrapRef} className="absolute inset-0">
          {view && (
            <svg width={size.w} height={size.h} className="block">
              {/* volume bars */}
              {view.rows.map((r) => (
                <rect
                  key={r.i}
                  x={view.padL}
                  y={r.y + (view.rowH - r.h) / 2}
                  width={r.w}
                  height={r.h}
                  fill={
                    r.isPoc
                      ? 'rgba(255,176,0,0.9)'
                      : r.inVA
                        ? 'rgba(76,194,255,0.5)'
                        : 'rgba(122,127,135,0.35)'
                  }
                />
              ))}
              {/* POC line + price labels */}
              <text x={2} y={view.padT + 8} className="text-term-dim" fill="currentColor" style={{ fontSize: 8 }}>
                {fmtPrice(profile.priceHigh)}
              </text>
              <text x={2} y={view.padT + view.ph} className="text-term-dim" fill="currentColor" style={{ fontSize: 8 }}>
                {fmtPrice(profile.priceLow)}
              </text>
              <text
                x={2}
                y={Math.max(view.padT + 16, Math.min(view.padT + view.ph, view.yAt(profile.poc) + 3))}
                className="text-term-amber"
                fill="currentColor"
                style={{ fontSize: 8 }}
              >
                {fmtPrice(profile.poc)}
              </text>
              {/* last-price marker */}
              {lastPrice != null && lastPrice >= profile.priceLow && lastPrice <= profile.priceHigh && (
                <>
                  <line
                    x1={view.padL}
                    x2={view.padL + view.pw}
                    y1={view.yAt(lastPrice)}
                    y2={view.yAt(lastPrice)}
                    stroke="rgba(255,255,255,0.55)"
                    strokeWidth={1}
                    strokeDasharray="3 2"
                  />
                  <text
                    x={view.padL + view.pw}
                    y={view.yAt(lastPrice) - 2}
                    textAnchor="end"
                    className="text-term-text"
                    fill="currentColor"
                    style={{ fontSize: 8 }}
                  >
                    {fmtPrice(lastPrice)}
                  </text>
                </>
              )}
            </svg>
          )}
        </div>
      </div>

      <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
        Volume binned by price · <span className="text-term-amber">POC</span> = most-traded level ·{' '}
        <span className="text-term-accent">value area</span> holds {vaPct.toFixed(0)}% of volume
      </div>
    </div>
  );
}
