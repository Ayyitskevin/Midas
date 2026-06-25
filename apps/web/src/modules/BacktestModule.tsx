import { useEffect, useMemo, useRef, useState } from 'react';
import type { Interval, Range } from '@midas/shared';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { backtestSmaCross, backtestRsiReversion, backtestBollinger, backtestMacd } from '@/lib/backtest';
import { fmtDate, fmtSignedPercent } from '@/lib/format';
import { Loading, ErrorMsg, EmptyState } from '@/components/Feedback';
import type { ModuleProps } from './types';

const base = (sym: string) => sym.replace(/\/.*$/, '');
const toMs = (t: number) => (t < 1e12 ? t * 1000 : t);
const num = (s: string): number => (s.trim() === '' ? NaN : Number(s));

const TIMEFRAMES: { label: string; interval: Interval; range: Range }[] = [
  { label: '1Y', interval: '1d', range: '1y' },
  { label: '2Y', interval: '1d', range: '2y' },
];

function Param({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-1">
      <span className="text-term-dim">{label}</span>
      <input
        type="number"
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="no-drag w-12 rounded-sm border border-term-border bg-term-bg/40 px-1 py-0.5 text-right font-mono text-2xs text-term-text outline-none focus:border-term-amber/60"
      />
    </label>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-2xs uppercase tracking-wide text-term-dim">{label}</span>
      <span className={`font-mono text-xs ${accent ?? 'text-term-text'}`}>{value}</span>
    </div>
  );
}

export function BacktestModule({ panel }: ModuleProps) {
  const symbol = panel.symbol;
  const [tfIdx, setTfIdx] = useState(0); // default 1Y
  const [strategy, setStrategy] = useState<'sma' | 'rsi' | 'boll' | 'macd'>('sma');
  const [fast, setFast] = useState('20');
  const [slow, setSlow] = useState('50');
  const [period, setPeriod] = useState('14');
  const [oversold, setOversold] = useState('30');
  const [exitLevel, setExitLevel] = useState('50');
  const [bperiod, setBperiod] = useState('20');
  const [bmult, setBmult] = useState('2');
  const [mfast, setMfast] = useState('12');
  const [mslow, setMslow] = useState('26');
  const [msignal, setMsignal] = useState('9');
  const tf = TIMEFRAMES[tfIdx];

  const { data, error, loading, refresh } = useFetch(
    async (signal) => {
      const h = await api.history(symbol!, tf.interval, tf.range, signal);
      return { closes: h.candles.map((c) => c.close), times: h.candles.map((c) => c.time) };
    },
    [symbol, tf.interval, tf.range],
    { enabled: !!symbol },
  );

  const result = useMemo(() => {
    if (!data) return null;
    if (strategy === 'sma') return backtestSmaCross(data.closes, { fast: num(fast), slow: num(slow) });
    if (strategy === 'rsi')
      return backtestRsiReversion(data.closes, {
        period: num(period),
        oversold: num(oversold),
        exit: num(exitLevel),
      });
    if (strategy === 'boll') return backtestBollinger(data.closes, { period: num(bperiod), mult: num(bmult) });
    return backtestMacd(data.closes, { fast: num(mfast), slow: num(mslow), signal: num(msignal) });
  }, [data, strategy, fast, slow, period, oversold, exitLevel, bperiod, bmult, mfast, mslow, msignal]);

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

  const view = useMemo(() => {
    if (!result || !data || size.w <= 0 || size.h <= 0) return null;
    const n = result.n;
    const padL = 30;
    const padR = 6;
    const padT = 6;
    const padB = 14;
    const pw = size.w - padL - padR;
    const ph = size.h - padT - padB;
    if (pw <= 10 || ph <= 10 || n < 2) return null;
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < n; i++) {
      lo = Math.min(lo, result.equity[i], result.benchmark[i]);
      hi = Math.max(hi, result.equity[i], result.benchmark[i]);
    }
    const span = hi - lo || 1;
    const x = (i: number) => padL + (i / (n - 1)) * pw;
    const yAt = (v: number) => padT + (1 - (v - lo) / span) * ph;
    const path = (arr: number[]) => arr.map((v, i) => `${x(i).toFixed(1)},${yAt(v).toFixed(1)}`).join(' ');
    return {
      padL,
      padT,
      pw,
      ph,
      lo,
      hi,
      yAt,
      strat: path(result.equity),
      bench: path(result.benchmark),
      t0: data.times[0],
      t1: data.times[data.times.length - 1],
    };
  }, [result, data, size]);

  if (!symbol) return <EmptyState>No symbol selected.</EmptyState>;
  if (loading && !data) return <Loading label={`Loading ${symbol}`} />;
  if (error && !data) return <ErrorMsg message={error} onRetry={refresh} />;

  const beat = result ? result.stratReturn - result.benchReturn : 0;

  return (
    <div className="flex h-full flex-col text-2xs">
      <div className="flex flex-wrap items-center gap-2 border-b border-term-border px-2 py-1">
        <span className="text-term-dim">{base(symbol)} · daily</span>
        <div className="flex gap-1">
          {(['sma', 'rsi', 'boll', 'macd'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStrategy(s)}
              className={`no-drag rounded-sm px-1.5 py-0.5 uppercase ${
                strategy === s ? 'bg-term-amber/20 text-term-amber' : 'text-term-muted hover:text-term-text'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {strategy === 'sma' ? (
            <>
              <Param label="fast" value={fast} onChange={setFast} />
              <Param label="slow" value={slow} onChange={setSlow} />
            </>
          ) : strategy === 'rsi' ? (
            <>
              <Param label="len" value={period} onChange={setPeriod} />
              <Param label="buy<" value={oversold} onChange={setOversold} />
              <Param label="exit>" value={exitLevel} onChange={setExitLevel} />
            </>
          ) : strategy === 'boll' ? (
            <>
              <Param label="len" value={bperiod} onChange={setBperiod} />
              <Param label="σ×" value={bmult} onChange={setBmult} />
            </>
          ) : (
            <>
              <Param label="fast" value={mfast} onChange={setMfast} />
              <Param label="slow" value={mslow} onChange={setMslow} />
              <Param label="sig" value={msignal} onChange={setMsignal} />
            </>
          )}
          <div className="flex gap-1">
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
      </div>

      {!result ? (
        <EmptyState>
          {strategy === 'sma'
            ? 'Set a fast period below the slow period and ensure enough history.'
            : strategy === 'rsi'
              ? 'Set the exit RSI above the oversold level and ensure enough history.'
              : strategy === 'boll'
                ? 'Set a band length ≥ 2 and a positive width, and ensure enough history.'
                : 'Set the slow EMA above the fast, and ensure enough history.'}
        </EmptyState>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 border-b border-term-border px-2 py-1.5 sm:grid-cols-6">
            <Stat
              label="Strategy"
              value={fmtSignedPercent(result.stratReturn * 100)}
              accent={result.stratReturn >= 0 ? 'text-term-up' : 'text-term-down'}
            />
            <Stat
              label="Buy & hold"
              value={fmtSignedPercent(result.benchReturn * 100)}
              accent={result.benchReturn >= 0 ? 'text-term-up' : 'text-term-down'}
            />
            <Stat label="vs B&H" value={fmtSignedPercent(beat * 100)} accent={beat >= 0 ? 'text-term-up' : 'text-term-down'} />
            <Stat label="Max DD" value={`−${(result.maxDD * 100).toFixed(1)}%`} accent="text-term-down" />
            <Stat label="Trades" value={`${result.trades.length} · ${(result.winRate * 100).toFixed(0)}% W`} />
            <Stat label="Exposure" value={`${(result.exposure * 100).toFixed(0)}%`} />
          </div>

          <div className="relative min-h-0 flex-1">
            <div ref={wrapRef} className="absolute inset-0">
              {view && (
                <svg width={size.w} height={size.h} className="block">
                  {/* breakeven (equity = 1) */}
                  {view.lo < 1 && view.hi > 1 && (
                    <line
                      x1={view.padL}
                      x2={view.padL + view.pw}
                      y1={view.yAt(1)}
                      y2={view.yAt(1)}
                      stroke="rgba(122,127,135,0.35)"
                      strokeWidth={1}
                      strokeDasharray="3 2"
                    />
                  )}
                  <text x={2} y={view.padT + 7} className="text-term-dim" fill="currentColor" style={{ fontSize: 8 }}>
                    {view.hi.toFixed(2)}×
                  </text>
                  <text x={2} y={view.padT + view.ph} className="text-term-dim" fill="currentColor" style={{ fontSize: 8 }}>
                    {view.lo.toFixed(2)}×
                  </text>
                  {/* buy & hold then strategy on top */}
                  <polyline points={view.bench} fill="none" stroke="rgba(122,127,135,0.7)" strokeWidth={1} />
                  <polyline points={view.strat} fill="none" stroke="rgba(255,176,0,0.95)" strokeWidth={1.5} />
                  <text x={view.padL} y={view.padT + view.ph + 11} className="text-term-dim" fill="currentColor" style={{ fontSize: 8 }}>
                    {fmtDate(toMs(view.t0))}
                  </text>
                  <text
                    x={view.padL + view.pw}
                    y={view.padT + view.ph + 11}
                    textAnchor="end"
                    className="text-term-dim"
                    fill="currentColor"
                    style={{ fontSize: 8 }}
                  >
                    {fmtDate(toMs(view.t1))}
                  </text>
                </svg>
              )}
            </div>
          </div>

          <div className="border-t border-term-border px-2 py-1 text-2xs text-term-dim">
            <span className="text-term-amber">strategy</span>{' '}
            {strategy === 'sma' ? (
              <>
                long when SMA({fast}) &gt; SMA({slow}), else flat
              </>
            ) : strategy === 'rsi' ? (
              <>
                buy when RSI({period}) &lt; {oversold}, exit when &gt; {exitLevel}
              </>
            ) : strategy === 'boll' ? (
              <>
                buy below the lower Bollinger({bperiod}, {bmult}σ) band, exit above the middle
              </>
            ) : (
              <>
                long when MACD({mfast},{mslow}) &gt; signal({msignal}), else flat
              </>
            )}{' '}
            · <span className="text-term-muted">grey</span> = buy &amp; hold · 1-bar lag, no fees
          </div>
        </>
      )}
    </div>
  );
}
