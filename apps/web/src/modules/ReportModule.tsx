import { useMemo } from 'react';
import type { AlertTrigger } from '@midas/shared';
import { useJournal } from '@/store/useJournal';
import { usePortfolio, type Transaction, type Position } from '@/store/usePortfolio';
import { useAlerts } from '@/store/useAlerts';
import { useWatchlist } from '@/store/useWatchlist';
import { useToasts } from '@/store/useToasts';
import { deriveTrade, type JournalTrade, type DerivedTrade } from '@/lib/journal';
import { opSymbol } from '@/lib/alerts';
import { toCsv, isoFromMs, type CsvColumn } from '@/lib/csv';
import { downloadCsv } from '@/lib/fileDownload';
import type { ModuleProps } from './types';

interface Dataset {
  key: string;
  label: string;
  description: string;
  count: number;
  filename: string;
  build: () => string;
}

const r4 = (n: number): number => Number(n.toFixed(4));

interface WatchRow {
  list: string;
  symbol: string;
  position: number;
}

interface TradeRow {
  t: JournalTrade;
  d: DerivedTrade;
}

export function ReportModule(_props: ModuleProps) {
  const trades = useJournal((s) => s.trades);
  const transactions = usePortfolio((s) => s.transactions);
  const positions = usePortfolio((s) => s.positions);
  const alertLog = useAlerts((s) => s.log);
  const symbols = useWatchlist((s) => s.symbols);
  const lists = useWatchlist((s) => s.lists);
  const saved = useWatchlist((s) => s.saved);
  const activeId = useWatchlist((s) => s.activeId);
  const push = useToasts((s) => s.push);

  const datasets = useMemo<Dataset[]>(() => {
    const tradeRows: TradeRow[] = trades.map((t) => ({ t, d: deriveTrade(t) }));
    const tradeCols: CsvColumn<TradeRow>[] = [
      { header: 'Opened', value: ({ t }) => isoFromMs(t.openedAt) },
      { header: 'Symbol', value: ({ t }) => t.symbol },
      { header: 'Side', value: ({ t }) => t.side },
      { header: 'Entry', value: ({ t }) => t.entry },
      { header: 'Stop', value: ({ t }) => t.stop },
      { header: 'Exit', value: ({ t }) => t.exit },
      { header: 'Size', value: ({ t }) => t.size },
      { header: 'R multiple', value: ({ d }) => (d.rMultiple == null ? '' : r4(d.rMultiple)) },
      { header: 'Outcome', value: ({ d }) => d.outcome },
      { header: 'PnL', value: ({ d }) => d.pnl },
      { header: 'Closed', value: ({ t }) => (t.closedAt == null ? '' : isoFromMs(t.closedAt)) },
      { header: 'Note', value: ({ t }) => t.note },
    ];

    const txCols: CsvColumn<Transaction>[] = [
      { header: 'Time', value: (x) => isoFromMs(x.at) },
      { header: 'Symbol', value: (x) => x.symbol },
      { header: 'Side', value: (x) => (x.quantity >= 0 ? 'buy' : 'sell') },
      { header: 'Quantity', value: (x) => Math.abs(x.quantity) },
      { header: 'Price', value: (x) => x.price },
      { header: 'Realized', value: (x) => x.realized },
      { header: 'Note', value: (x) => x.note ?? '' },
    ];

    const posCols: CsvColumn<Position>[] = [
      { header: 'Symbol', value: (p) => p.symbol },
      { header: 'Quantity', value: (p) => p.quantity },
      { header: 'Entry', value: (p) => p.entryPrice },
      { header: 'Opened', value: (p) => isoFromMs(p.openedAt) },
      { header: 'Note', value: (p) => p.note ?? '' },
    ];

    const trigCols: CsvColumn<AlertTrigger>[] = [
      { header: 'Time', value: (t) => isoFromMs(t.at) },
      { header: 'Symbol', value: (t) => t.symbol },
      { header: 'Metric', value: (t) => t.metric },
      { header: 'Condition', value: (t) => opSymbol(t.op) },
      { header: 'Threshold', value: (t) => t.value },
      { header: 'Actual', value: (t) => t.actual },
    ];

    const watchRows: WatchRow[] = [];
    for (const l of lists) {
      const syms = l.id === activeId ? symbols : saved[l.id] ?? [];
      syms.forEach((s, i) => watchRows.push({ list: l.name, symbol: s, position: i + 1 }));
    }
    const watchCols: CsvColumn<WatchRow>[] = [
      { header: 'List', value: (r) => r.list },
      { header: 'Symbol', value: (r) => r.symbol },
      { header: 'Position', value: (r) => r.position },
    ];

    return [
      {
        key: 'journal',
        label: 'Trade journal',
        description: 'Logged trades with R-multiples & outcomes',
        count: tradeRows.length,
        filename: 'midas-journal.csv',
        build: () => toCsv(tradeRows, tradeCols),
      },
      {
        key: 'transactions',
        label: 'Portfolio transactions',
        description: 'Executed fills with realized P&L',
        count: transactions.length,
        filename: 'midas-transactions.csv',
        build: () => toCsv(transactions, txCols),
      },
      {
        key: 'positions',
        label: 'Open positions',
        description: 'Current paper positions & cost basis',
        count: positions.length,
        filename: 'midas-positions.csv',
        build: () => toCsv(positions, posCols),
      },
      {
        key: 'alerts',
        label: 'Alert triggers',
        description: 'History of alerts that fired',
        count: alertLog.length,
        filename: 'midas-alert-triggers.csv',
        build: () => toCsv(alertLog, trigCols),
      },
      {
        key: 'watchlists',
        label: 'Watchlists',
        description: 'Every list and its symbols',
        count: watchRows.length,
        filename: 'midas-watchlists.csv',
        build: () => toCsv(watchRows, watchCols),
      },
    ];
  }, [trades, transactions, positions, alertLog, symbols, lists, saved, activeId]);

  const exportCsv = (ds: Dataset) => {
    downloadCsv(ds.filename, ds.build());
    push({ title: `Exported ${ds.label}`, body: `${ds.count} ${ds.count === 1 ? 'row' : 'rows'} → ${ds.filename}`, tone: 'info' });
  };

  const copyCsv = (ds: Dataset) => {
    const text = ds.build();
    if (!navigator.clipboard?.writeText) {
      push({ title: 'Copy unavailable', body: 'Clipboard is blocked in this context.', tone: 'down' });
      return;
    }
    navigator.clipboard.writeText(text).then(
      () => push({ title: `Copied ${ds.label}`, body: `${ds.count} ${ds.count === 1 ? 'row' : 'rows'} to clipboard`, tone: 'info' }),
      () => push({ title: 'Copy failed', tone: 'down' }),
    );
  };

  return (
    <div className="no-drag scroll-term flex h-full flex-col gap-2 overflow-y-auto p-2">
      <p className="text-2xs leading-relaxed text-term-dim">
        Export your terminal data as CSV — opens in Excel or Google Sheets. Everything is generated locally in your
        browser.
      </p>

      {datasets.map((ds) => {
        const empty = ds.count === 0;
        return (
          <div key={ds.key} className="rounded-sm border border-term-border bg-term-panel/40 px-2.5 py-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm text-term-text">{ds.label}</span>
              <span className="font-mono text-2xs text-term-dim">
                {ds.count} {ds.count === 1 ? 'row' : 'rows'}
              </span>
            </div>
            <p className="mt-0.5 text-2xs text-term-muted">{ds.description}</p>
            <div className="mt-1.5 flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => exportCsv(ds)}
                disabled={empty}
                className="rounded-sm border border-term-amber/40 bg-term-amber/10 px-2 py-0.5 text-2xs font-semibold uppercase tracking-wide text-term-amber hover:bg-term-amber/20 disabled:opacity-30"
              >
                Export CSV
              </button>
              <button
                type="button"
                onClick={() => copyCsv(ds)}
                disabled={empty}
                className="rounded-sm border border-term-border px-2 py-0.5 text-2xs text-term-muted hover:text-term-text disabled:opacity-30"
              >
                Copy
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
