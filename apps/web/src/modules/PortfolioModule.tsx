import { useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { fmtPrice, fmtSigned, fmtSignedPercent, fmtCompact, fmtTimeAgo, changeClass } from '@/lib/format';
import { positionMetrics } from '@/lib/portfolio';
import { navigate } from '@/commands/execute';
import { usePanels } from '@/store/usePanels';
import { usePortfolio } from '@/store/usePortfolio';
import { useToasts } from '@/store/useToasts';
import { downloadJson } from '@/lib/fileDownload';
import { EmptyState } from '@/components/Feedback';
import type { ModuleProps } from './types';

interface Row {
  id: string;
  symbol: string;
  quantity: number;
  entryPrice: number;
  mark: number | null;
  value: number | null;
  cost: number;
  pnl: number | null;
  pnlPct: number | null;
  weight: number | null;
}

export function PortfolioModule({ panel }: ModuleProps) {
  const positions = usePortfolio((s) => s.positions);
  const realized = usePortfolio((s) => s.realized);
  const transactions = usePortfolio((s) => s.transactions);
  const addTrade = usePortfolio((s) => s.addTrade);
  const removePosition = usePortfolio((s) => s.removePosition);
  const clearJournal = usePortfolio((s) => s.clearJournal);
  const exportBook = usePortfolio((s) => s.exportBook);
  const importBook = usePortfolio((s) => s.importBook);
  const pushToast = useToasts((s) => s.push);
  const fileRef = useRef<HTMLInputElement>(null);

  const [symbol, setSymbol] = useState(
    () => usePanels.getState().activeSymbol ?? 'BTC/USDT',
  );
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [qtyStr, setQtyStr] = useState('');
  const [priceStr, setPriceStr] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [tab, setTab] = useState<'positions' | 'history'>('positions');

  // Poll live marks for every held symbol plus whatever is being typed, so the
  // blotter stays live and "add at market" can prefill the entry.
  const polled = useMemo(() => {
    const set = new Set(positions.map((p) => p.symbol));
    const typed = symbol.trim().toUpperCase();
    if (typed) set.add(typed);
    return [...set];
  }, [positions, symbol]);

  const { data } = useFetch(
    (signal) => api.quotes(polled, signal),
    [polled.join(',')],
    { intervalMs: 4000, enabled: polled.length > 0 },
  );
  const markOf = useMemo(() => {
    const m = new Map<string, number>();
    for (const q of data ?? []) m.set(q.symbol, q.price);
    return m;
  }, [data]);

  const rows: Row[] = useMemo(() => {
    const base = positions.map((p) => {
      const mark = markOf.get(p.symbol) ?? null;
      const { cost, value, pnl, pnlPct } = positionMetrics(p.quantity, p.entryPrice, mark);
      return { id: p.id, symbol: p.symbol, quantity: p.quantity, entryPrice: p.entryPrice, mark, value, cost, pnl, pnlPct, weight: null as number | null };
    });
    const gross = base.reduce((a, r) => a + (r.value != null ? Math.abs(r.value) : 0), 0);
    return base.map((r) => ({
      ...r,
      weight: r.value != null && gross > 0 ? (Math.abs(r.value) / gross) * 100 : null,
    }));
  }, [positions, markOf]);

  const totals = useMemo(() => {
    let value = 0;
    let pnl = 0;
    let grossCost = 0;
    for (const r of rows) {
      if (r.value != null) value += r.value;
      if (r.pnl != null) pnl += r.pnl;
      if (r.pnl != null) grossCost += Math.abs(r.cost);
    }
    return { value, pnl, pnlPct: grossCost > 0 ? (pnl / grossCost) * 100 : null };
  }, [rows]);

  const liveMark = markOf.get(symbol.trim().toUpperCase()) ?? null;

  const submit = () => {
    const sym = symbol.trim().toUpperCase();
    const qty = Math.abs(parseFloat(qtyStr));
    if (!sym) return setFormError('Enter a symbol');
    if (!Number.isFinite(qty) || qty <= 0) return setFormError('Enter a quantity');
    const typedPrice = parseFloat(priceStr);
    const price = Number.isFinite(typedPrice) && typedPrice > 0 ? typedPrice : liveMark;
    if (price == null || !(price > 0)) return setFormError('No price — type one or wait for a mark');
    addTrade(sym, side === 'buy' ? qty : -qty, price);
    setQtyStr('');
    setPriceStr('');
    setFormError(null);
  };

  const handleImport = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-importing the same file
    if (!file) return;
    try {
      let data: unknown;
      try {
        data = JSON.parse(await file.text());
      } catch {
        throw new Error('File is not valid JSON');
      }
      importBook(data);
      const s = usePortfolio.getState();
      pushToast({
        title: 'Portfolio imported',
        body: `${s.positions.length} positions · ${s.transactions.length} fills`,
        tone: 'info',
      });
    } catch (err) {
      pushToast({ title: 'Import failed', body: (err as Error).message, tone: 'down' });
    }
  };

  const hasBook = positions.length > 0 || transactions.length > 0;

  const inputCls =
    'no-drag rounded-sm border border-term-border bg-term-bg px-1.5 py-1 text-xs text-term-text outline-none focus:border-term-amber';

  return (
    <div className="flex h-full flex-col">
      {/* Add-trade toolbar */}
      <div className="border-b border-term-border p-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <input
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            placeholder="SYMBOL"
            className={`${inputCls} w-24 uppercase`}
          />
          <div className="flex overflow-hidden rounded-sm border border-term-border">
            <button
              onClick={() => setSide('buy')}
              className={`no-drag px-2 py-1 text-2xs font-bold ${side === 'buy' ? 'bg-term-up/20 text-term-up' : 'text-term-muted hover:text-term-text'}`}
            >
              BUY
            </button>
            <button
              onClick={() => setSide('sell')}
              className={`no-drag px-2 py-1 text-2xs font-bold ${side === 'sell' ? 'bg-term-down/20 text-term-down' : 'text-term-muted hover:text-term-text'}`}
            >
              SELL
            </button>
          </div>
          <input
            value={qtyStr}
            onChange={(e) => setQtyStr(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder="qty"
            inputMode="decimal"
            className={`${inputCls} w-20 text-right tabular-nums`}
          />
          <input
            value={priceStr}
            onChange={(e) => setPriceStr(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder={liveMark != null ? fmtPrice(liveMark) : 'price'}
            inputMode="decimal"
            className={`${inputCls} w-24 text-right tabular-nums`}
          />
          <button
            onClick={submit}
            className="no-drag rounded-sm border border-term-amber px-2.5 py-1 text-2xs font-bold text-term-amber hover:bg-term-amber/10"
          >
            ADD
          </button>
        </div>
        {formError && <div className="mt-1 text-2xs text-term-down">⚠ {formError}</div>}
      </div>

      {/* Realized / Unrealized / Net summary + tab switch */}
      <div className="flex items-center gap-4 border-b border-term-border px-2 py-1 text-2xs">
        <span className="flex items-center gap-1">
          <span className="text-term-muted">Realized</span>
          <span className={`tabular-nums ${changeClass(realized)}`}>{fmtSigned(realized)}</span>
        </span>
        <span className="flex items-center gap-1">
          <span className="text-term-muted">Unreal.</span>
          <span className={`tabular-nums ${changeClass(totals.pnl)}`}>{fmtSigned(totals.pnl)}</span>
        </span>
        <span className="flex items-center gap-1">
          <span className="text-term-muted">Net</span>
          <span className={`font-semibold tabular-nums ${changeClass(realized + totals.pnl)}`}>
            {fmtSigned(realized + totals.pnl)}
          </span>
        </span>
        <div className="ml-auto flex items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            onChange={handleImport}
            className="hidden"
          />
          <button
            onClick={() => downloadJson('midas-portfolio.json', exportBook())}
            disabled={!hasBook}
            title="Export book to a file"
            className="no-drag leading-none text-term-muted hover:text-term-amber disabled:opacity-30 disabled:hover:text-term-muted"
          >
            ⤓
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            title="Import book from a file"
            className="no-drag leading-none text-term-muted hover:text-term-amber"
          >
            ⤒
          </button>
          <div className="flex overflow-hidden rounded-sm border border-term-border">
            {(['positions', 'history'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`no-drag px-2 py-0.5 font-medium uppercase ${tab === t ? 'bg-term-amber/20 text-term-amber' : 'text-term-muted hover:text-term-text'}`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      </div>

      {tab === 'positions' ? (
        positions.length === 0 ? (
          <EmptyState>No positions yet — add a trade above to track live P&amp;L.</EmptyState>
        ) : (
          <div className="scroll-term min-h-0 flex-1 overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-term-panel">
                <tr className="text-2xs text-term-muted">
                  <th className="px-2 py-1 text-left font-normal">SYMBOL</th>
                  <th className="px-2 py-1 text-right font-normal">QTY</th>
                  <th className="px-2 py-1 text-right font-normal">ENTRY</th>
                  <th className="px-2 py-1 text-right font-normal">MARK</th>
                  <th className="px-2 py-1 text-right font-normal">VALUE</th>
                  <th className="px-2 py-1 text-right font-normal">UPL</th>
                  <th className="px-2 py-1 text-right font-normal">UPL%</th>
                  <th className="px-2 py-1 text-right font-normal">WT%</th>
                  <th className="px-1 py-1" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="group border-b border-term-border/30 hover:bg-term-header/60">
                    <td className="px-2 py-1">
                      <button
                        className="no-drag font-medium text-term-text hover:text-term-amber"
                        onClick={() => navigate(panel, r.symbol)}
                      >
                        {r.symbol}
                      </button>
                    </td>
                    <td className={`px-2 py-1 text-right tabular-nums ${r.quantity < 0 ? 'text-term-down' : 'text-term-text'}`}>
                      {fmtCompact(r.quantity)}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums text-term-muted">{fmtPrice(r.entryPrice)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{r.mark != null ? fmtPrice(r.mark) : '—'}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{r.value != null ? fmtCompact(r.value) : '—'}</td>
                    <td className={`px-2 py-1 text-right tabular-nums ${changeClass(r.pnl)}`}>
                      {r.pnl != null ? fmtSigned(r.pnl) : '—'}
                    </td>
                    <td className={`px-2 py-1 text-right tabular-nums ${changeClass(r.pnlPct)}`}>
                      {r.pnlPct != null ? fmtSignedPercent(r.pnlPct) : '—'}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums text-term-muted">
                      {r.weight != null ? `${r.weight.toFixed(1)}%` : '—'}
                    </td>
                    <td className="px-1 py-1 text-right">
                      <button
                        className="no-drag leading-none text-term-dim opacity-0 transition-opacity hover:text-term-down group-hover:opacity-100"
                        title="Close position"
                        onClick={() => removePosition(r.id)}
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="sticky bottom-0 bg-term-panel">
                <tr className="border-t border-term-border font-semibold">
                  <td className="px-2 py-1 text-term-amber">TOTAL</td>
                  <td />
                  <td />
                  <td />
                  <td className="px-2 py-1 text-right tabular-nums">{fmtCompact(totals.value)}</td>
                  <td className={`px-2 py-1 text-right tabular-nums ${changeClass(totals.pnl)}`}>
                    {fmtSigned(totals.pnl)}
                  </td>
                  <td className={`px-2 py-1 text-right tabular-nums ${changeClass(totals.pnlPct)}`}>
                    {totals.pnlPct != null ? fmtSignedPercent(totals.pnlPct) : '—'}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums text-term-muted">100%</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )
      ) : transactions.length === 0 ? (
        <EmptyState>No fills yet — your executed trades will show here.</EmptyState>
      ) : (
        <div className="scroll-term min-h-0 flex-1 overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-term-panel">
              <tr className="text-2xs text-term-muted">
                <th className="px-2 py-1 text-left font-normal">TIME</th>
                <th className="px-2 py-1 text-left font-normal">SYMBOL</th>
                <th className="px-2 py-1 text-left font-normal">SIDE</th>
                <th className="px-2 py-1 text-right font-normal">QTY</th>
                <th className="px-2 py-1 text-right font-normal">PRICE</th>
                <th className="px-2 py-1 text-right font-normal">REALIZED</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((t) => (
                <tr key={t.id} className="border-b border-term-border/30 hover:bg-term-header/60">
                  <td className="px-2 py-1 text-term-dim">{fmtTimeAgo(t.at)}</td>
                  <td className="px-2 py-1 font-medium text-term-text">{t.symbol}</td>
                  <td className={`px-2 py-1 font-bold ${t.quantity < 0 ? 'text-term-down' : 'text-term-up'}`}>
                    {t.quantity < 0 ? 'SELL' : 'BUY'}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">{fmtCompact(Math.abs(t.quantity))}</td>
                  <td className="px-2 py-1 text-right tabular-nums text-term-muted">{fmtPrice(t.price)}</td>
                  <td className={`px-2 py-1 text-right tabular-nums ${t.realized !== 0 ? changeClass(t.realized) : 'text-term-dim'}`}>
                    {t.realized !== 0 ? fmtSigned(t.realized) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex justify-end p-2">
            <button onClick={clearJournal} className="no-drag text-2xs text-term-dim hover:text-term-down">
              clear journal
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
