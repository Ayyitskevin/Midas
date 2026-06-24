import { useMemo, useState, type ReactNode } from 'react';
import { useJournal } from '@/store/useJournal';
import { deriveTrade, computeStats, type JournalTrade, type TradeSide, type TradeOutcome } from '@/lib/journal';
import { fmtPrice } from '@/lib/format';
import type { ModuleProps } from './types';

const num = (s: string): number | null => {
  if (s.trim() === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

const OUTCOME_ACCENT: Record<TradeOutcome, string> = {
  win: 'text-term-up',
  loss: 'text-term-down',
  breakeven: 'text-term-muted',
  open: 'text-term-accent',
};

function Stat({ label, value, accent }: { label: string; value: ReactNode; accent?: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-sm border border-term-border bg-term-panel/60 px-2 py-1">
      <span className="text-2xs uppercase tracking-wide text-term-dim">{label}</span>
      <span className={`font-mono text-xs ${accent ?? 'text-term-text'}`}>{value}</span>
    </div>
  );
}

function Inp({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      type="number"
      inputMode="decimal"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="min-w-0 flex-1 rounded-sm border border-term-border bg-term-bg/40 px-1.5 py-1 font-mono text-xs text-term-text outline-none placeholder:text-term-dim focus:border-term-amber/60"
    />
  );
}

function r1(v: number | null): string {
  return v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}R`;
}

/** Inline "close this open trade" control with its own exit-price field. */
function CloseControl({ id }: { id: string }) {
  const closeTrade = useJournal((s) => s.closeTrade);
  const [exit, setExit] = useState('');
  const v = num(exit);
  return (
    <div className="flex items-center gap-1">
      <input
        type="number"
        inputMode="decimal"
        value={exit}
        onChange={(e) => setExit(e.target.value)}
        placeholder="exit"
        className="w-16 rounded-sm border border-term-border bg-term-bg/40 px-1 py-0.5 font-mono text-2xs text-term-text outline-none placeholder:text-term-dim focus:border-term-amber/60"
      />
      <button
        type="button"
        disabled={v == null || v <= 0}
        onClick={() => {
          if (v != null && v > 0) closeTrade(id, v);
        }}
        className="rounded-sm border border-term-border px-1.5 py-0.5 text-2xs text-term-muted hover:text-term-text disabled:opacity-30"
      >
        Close
      </button>
    </div>
  );
}

function TradeRow({ t }: { t: JournalTrade }) {
  const removeTrade = useJournal((s) => s.removeTrade);
  const d = deriveTrade(t);
  return (
    <div className="flex items-center gap-2 border-b border-term-border/40 px-2 py-1 text-xs">
      <div className="flex w-24 shrink-0 flex-col">
        <span className="truncate text-term-text">{t.symbol || '—'}</span>
        <span className={t.side === 'short' ? 'text-2xs text-term-down' : 'text-2xs text-term-up'}>{t.side}</span>
      </div>
      <div className="flex-1 truncate font-mono text-2xs text-term-muted">
        {fmtPrice(t.entry)} <span className="text-term-dim">→</span>{' '}
        {t.exit != null ? fmtPrice(t.exit) : <span className="text-term-dim">open · stop {fmtPrice(t.stop)}</span>}
        {d.pnl != null && (
          <span className={d.pnl >= 0 ? 'text-term-up' : 'text-term-down'}>
            {' '}· {d.pnl >= 0 ? '+' : '−'}${fmtPrice(Math.abs(d.pnl))}
          </span>
        )}
      </div>
      <span className={`w-12 shrink-0 text-right font-mono ${OUTCOME_ACCENT[d.outcome]}`}>
        {d.outcome === 'open' ? 'OPEN' : r1(d.rMultiple)}
      </span>
      {t.exit == null && <CloseControl id={t.id} />}
      <button
        type="button"
        onClick={() => removeTrade(t.id)}
        className="shrink-0 text-term-dim hover:text-term-down"
        aria-label="Delete trade"
      >
        ✕
      </button>
    </div>
  );
}

export function JournalModule({ panel }: ModuleProps) {
  const trades = useJournal((s) => s.trades);
  const addTrade = useJournal((s) => s.addTrade);

  const [symbol, setSymbol] = useState(() => panel.symbol?.toUpperCase() ?? '');
  const [side, setSide] = useState<TradeSide>('long');
  const [entry, setEntry] = useState('');
  const [stop, setStop] = useState('');
  const [exit, setExit] = useState('');
  const [size, setSize] = useState('');
  const [note, setNote] = useState('');

  const stats = useMemo(() => computeStats(trades), [trades]);

  const entryN = num(entry);
  const stopN = num(stop);
  const canLog = entryN != null && entryN > 0 && stopN != null && stopN > 0;

  const log = () => {
    if (!canLog) return;
    addTrade({
      symbol,
      side,
      entry: entryN,
      stop: stopN,
      exit: num(exit),
      size: num(size),
      note: note.trim(),
    });
    setEntry('');
    setStop('');
    setExit('');
    setSize('');
    setNote('');
  };

  return (
    <div className="no-drag scroll-term flex h-full flex-col gap-2 overflow-y-auto p-2">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-1.5">
        <Stat label="Trades" value={`${stats.closed}c · ${stats.open}o`} />
        <Stat
          label="Win rate"
          value={stats.winRate == null ? '—' : `${(stats.winRate * 100).toFixed(0)}%`}
        />
        <Stat
          label="Expectancy"
          value={stats.avgR == null ? '—' : r1WithSign(stats.avgR)}
          accent={stats.avgR == null ? undefined : stats.avgR >= 0 ? 'text-term-up' : 'text-term-down'}
        />
        <Stat label="Profit factor" value={stats.profitFactor == null ? '—' : stats.profitFactor.toFixed(2)} />
        <Stat
          label="Total R"
          value={r1WithSign(stats.totalR)}
          accent={stats.totalR >= 0 ? 'text-term-up' : 'text-term-down'}
        />
        <Stat
          label="Total P&L"
          value={stats.totalPnl == null ? '—' : `${stats.totalPnl >= 0 ? '+' : '−'}$${fmtPrice(Math.abs(stats.totalPnl))}`}
          accent={stats.totalPnl == null ? undefined : stats.totalPnl >= 0 ? 'text-term-up' : 'text-term-down'}
        />
      </div>

      {/* Log form */}
      <div className="flex flex-col gap-1.5 rounded-sm border border-term-border p-2">
        <div className="flex items-center gap-1.5">
          <input
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            placeholder="SYMBOL"
            className="min-w-0 flex-1 rounded-sm border border-term-border bg-term-bg/40 px-1.5 py-1 font-mono text-xs text-term-text outline-none placeholder:text-term-dim focus:border-term-amber/60"
          />
          <div className="flex shrink-0 overflow-hidden rounded-sm border border-term-border">
            {(['long', 'short'] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSide(s)}
                className={`px-2 py-1 text-2xs uppercase ${
                  side === s
                    ? s === 'long'
                      ? 'bg-term-up/20 text-term-up'
                      : 'bg-term-down/20 text-term-down'
                    : 'text-term-muted hover:text-term-text'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Inp value={entry} onChange={setEntry} placeholder="entry" />
          <Inp value={stop} onChange={setStop} placeholder="stop" />
        </div>
        <div className="flex items-center gap-1.5">
          <Inp value={exit} onChange={setExit} placeholder="exit (optional)" />
          <Inp value={size} onChange={setSize} placeholder="size (optional)" />
        </div>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="note (optional)"
          className="rounded-sm border border-term-border bg-term-bg/40 px-1.5 py-1 text-xs text-term-text outline-none placeholder:text-term-dim focus:border-term-amber/60"
        />
        <button
          type="button"
          onClick={log}
          disabled={!canLog}
          className="rounded-sm border border-term-amber/40 bg-term-amber/10 px-2 py-1 text-2xs font-semibold uppercase tracking-wide text-term-amber hover:bg-term-amber/20 disabled:opacity-30"
        >
          Log trade
        </button>
      </div>

      {/* Trades */}
      <div className="flex flex-col">
        {trades.length === 0 ? (
          <div className="px-2 py-4 text-center text-xs text-term-muted">
            No trades logged yet. Entry &amp; stop define 1R; add an exit to score the result.
          </div>
        ) : (
          trades.map((t) => <TradeRow key={t.id} t={t} />)
        )}
      </div>
    </div>
  );
}

function r1WithSign(v: number): string {
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}R`;
}
