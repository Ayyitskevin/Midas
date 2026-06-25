import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { OrderBook } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useStream, useStreamStatus } from '@/lib/stream';
import { fmtCompact } from '@/lib/format';
import { bookImbalance, meanImbalance } from '@/lib/imbalance';
import { EmptyState } from '@/components/Feedback';
import type { ModuleProps } from './types';

const BUFFER_CAP = 120;
const TARGET_BAR_W = 5;
const LEVEL_OPTS = [5, 10, 25];

export function ImbalanceModule({ panel }: ModuleProps) {
  const symbol = panel.symbol;
  const [levels, setLevels] = useState(10);
  const status = useStreamStatus();

  const { data: seed } = useFetch(
    (signal) => api.orderbook(symbol!, 50, signal),
    [symbol],
    { enabled: !!symbol },
  );

  const [books, setBooks] = useState<OrderBook[]>([]);
  useEffect(() => setBooks([]), [symbol]);
  useEffect(() => {
    if (seed) setBooks((prev) => (prev.length === 0 ? [seed] : prev));
  }, [seed]);
  useStream(
    'orderbook',
    symbol,
    useCallback((d: unknown) => {
      const b = d as OrderBook;
      setBooks((prev) => {
        if (prev.length && prev[prev.length - 1].timestamp === b.timestamp) return prev;
        const next = [...prev, b];
        return next.length > BUFFER_CAP ? next.slice(next.length - BUFFER_CAP) : next;
      });
    }, []),
  );

  const snaps = useMemo(
    () => books.map((b) => bookImbalance(b, levels)).filter((s): s is NonNullable<typeof s> => s != null),
    [books, levels],
  );
  const current = snaps.length ? snaps[snaps.length - 1] : null;
  const avg = useMemo(() => meanImbalance(snaps), [snaps]);

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

  const bars = useMemo(() => {
    if (snaps.length === 0 || size.w <= 0 || size.h <= 0) return null;
    const visible = snaps.length > Math.floor(size.w / TARGET_BAR_W) ? snaps.slice(snaps.length - Math.floor(size.w / TARGET_BAR_W)) : snaps;
    const barW = size.w / visible.length;
    const mid = size.h / 2;
    return visible.map((s, i) => {
      const h = Math.abs(s.imbalance) * (mid - 1);
      const up = s.imbalance >= 0;
      return (
        <rect
          key={i}
          x={i * barW + barW * 0.12}
          y={up ? mid - h : mid}
          width={Math.max(0.6, barW * 0.76)}
          height={Math.max(0, h)}
          fill={up ? 'rgba(38,194,129,0.75)' : 'rgba(239,77,86,0.75)'}
        />
      );
    });
  }, [snaps, size]);

  if (!symbol) return <EmptyState>No symbol selected.</EmptyState>;

  const imb = current?.imbalance ?? 0;
  const label = Math.abs(imb) < 0.1 ? 'balanced' : imb > 0 ? 'buy pressure' : 'sell pressure';
  const imbColor = Math.abs(imb) < 0.1 ? 'text-term-text' : imb > 0 ? 'text-term-up' : 'text-term-down';
  const statusColor =
    status === 'open' ? 'text-term-up' : status === 'connecting' ? 'text-term-amber' : 'text-term-down';

  return (
    <div className="flex h-full flex-col text-2xs">
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1">
        <span className="text-term-dim">book imbalance · top {levels}</span>
        <div className="ml-auto flex items-center gap-1">
          {LEVEL_OPTS.map((l) => (
            <button
              key={l}
              onClick={() => setLevels(l)}
              className={`no-drag rounded-sm px-1.5 py-0.5 ${
                levels === l ? 'bg-term-amber/20 text-term-amber' : 'text-term-muted hover:text-term-text'
              }`}
            >
              {l}
            </button>
          ))}
          <span className={statusColor} title={`stream ${status}`}>
            ●
          </span>
        </div>
      </div>

      {/* Current reading + gauge */}
      <div className="px-2 py-1.5">
        <div className="mb-1 flex items-baseline gap-2 tabular-nums">
          <span className={`text-lg font-semibold ${imbColor}`}>{(imb * 100).toFixed(0)}%</span>
          <span className={imbColor}>{label}</span>
          {current && (
            <span className="ml-auto text-term-dim">
              bid <span className="text-term-up">{fmtCompact(current.bidDepth)}</span> · ask{' '}
              <span className="text-term-down">{fmtCompact(current.askDepth)}</span> · avg {(avg * 100).toFixed(0)}%
            </span>
          )}
        </div>
        <div className="relative h-3 overflow-hidden rounded-sm bg-term-bg">
          {imb >= 0 ? (
            <div className="absolute bottom-0 top-0 bg-term-up/70" style={{ left: '50%', width: `${imb * 50}%` }} />
          ) : (
            <div className="absolute bottom-0 top-0 bg-term-down/70" style={{ left: `${50 + imb * 50}%`, width: `${-imb * 50}%` }} />
          )}
          <div className="absolute bottom-0 left-1/2 top-0 w-px -translate-x-1/2 bg-term-border-bright" />
        </div>
      </div>

      {/* Imbalance over time */}
      <div className="relative min-h-0 flex-1 px-2 pb-1">
        <div ref={wrapRef} className="absolute inset-0 px-2 pb-1">
          {bars ? (
            <svg width={size.w} height={size.h} className="block">
              <line x1={0} x2={size.w} y1={size.h / 2} y2={size.h / 2} stroke="rgba(122,127,135,0.4)" strokeWidth={1} />
              {bars}
            </svg>
          ) : (
            <div className="flex h-full items-center justify-center text-term-muted">Waiting for book…</div>
          )}
        </div>
      </div>

      <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
        (bid − ask) ÷ (bid + ask) over the top {levels} levels · green = buy-side depth, red = sell-side
      </div>
    </div>
  );
}
