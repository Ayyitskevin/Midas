import { useState, type FormEvent } from 'react';
import { useAlerts } from '@/store/useAlerts';
import {
  canNotify,
  describeThreshold,
  formatActual,
  requestNotificationPermission,
  triggerHeadline,
  type AlertMetric,
  type AlertOp,
} from '@/lib/alerts';
import { fmtTimeAgo } from '@/lib/format';
import { EmptyState } from '@/components/Feedback';
import type { ModuleProps } from './types';

const METRICS: { code: AlertMetric; label: string }[] = [
  { code: 'price', label: 'Price' },
  { code: 'funding', label: 'Funding %' },
  { code: 'change', label: '24h %' },
];

const OPS: { code: AlertOp; label: string }[] = [
  { code: 'above', label: 'rises ≥' },
  { code: 'below', label: 'falls ≤' },
  { code: 'cross', label: 'crosses' },
];

const inputCls =
  'no-drag rounded-sm border border-term-border bg-term-bg px-2 py-1 text-xs text-term-text outline-none focus:border-term-amber';

export function AlertsModule({ panel }: ModuleProps) {
  const { alerts, log, soundEnabled, addAlert, removeAlert, toggleAlert, rearmAlert, clearLog, setSound } =
    useAlerts();

  const [symbol, setSymbol] = useState(panel.symbol ?? '');
  const [metric, setMetric] = useState<AlertMetric>('price');
  const [op, setOp] = useState<AlertOp>('above');
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  const [repeat, setRepeat] = useState(false);
  const [perm, setPerm] = useState<NotificationPermission | 'unsupported'>(
    canNotify() ? Notification.permission : 'unsupported',
  );

  function submit(e: FormEvent) {
    e.preventDefault();
    const v = Number(value);
    if (!symbol.trim() || !Number.isFinite(v)) return;
    addAlert({ symbol, metric, op, value: v, note, repeat });
    setValue('');
    setNote('');
  }

  async function enableNotifications() {
    setPerm(await requestNotificationPermission());
  }

  return (
    <div className="flex h-full flex-col">
      {/* New-alert form */}
      <form onSubmit={submit} className="space-y-1.5 border-b border-term-border p-2">
        <div className="flex gap-1.5">
          <input
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            placeholder="BTC/USDT"
            className={`${inputCls} w-28 uppercase`}
          />
          <select value={metric} onChange={(e) => setMetric(e.target.value as AlertMetric)} className={`${inputCls} flex-1`}>
            {METRICS.map((m) => (
              <option key={m.code} value={m.code}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex gap-1.5">
          <select value={op} onChange={(e) => setOp(e.target.value as AlertOp)} className={`${inputCls} w-24`}>
            {OPS.map((o) => (
              <option key={o.code} value={o.code}>
                {o.label}
              </option>
            ))}
          </select>
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            type="number"
            step="any"
            placeholder={metric === 'price' ? 'price' : '%'}
            className={`${inputCls} flex-1`}
          />
        </div>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="note (optional)"
          className={`${inputCls} w-full`}
        />
        <div className="flex items-center justify-between">
          <label className="no-drag flex items-center gap-1.5 text-2xs text-term-muted">
            <input type="checkbox" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} />
            repeat (re-arm when it clears)
          </label>
          <button
            type="submit"
            className="no-drag rounded-sm border border-term-amber px-3 py-1 text-2xs font-semibold text-term-amber hover:bg-term-amber hover:text-term-bg"
          >
            Add alert
          </button>
        </div>
      </form>

      {/* Notification + sound controls */}
      <div className="flex items-center gap-3 border-b border-term-border px-2 py-1 text-2xs">
        {perm === 'granted' ? (
          <span className="text-term-up">● notifications on</span>
        ) : perm === 'unsupported' ? (
          <span className="text-term-dim">notifications unsupported</span>
        ) : (
          <button onClick={enableNotifications} className="no-drag text-term-amber hover:underline">
            {perm === 'denied' ? 'notifications blocked' : 'enable browser notifications'}
          </button>
        )}
        <label className="no-drag ml-auto flex items-center gap-1 text-term-muted">
          <input type="checkbox" checked={soundEnabled} onChange={(e) => setSound(e.target.checked)} />
          sound
        </label>
      </div>

      {/* Alert list */}
      <div className="scroll-term min-h-0 flex-1 overflow-auto">
        {alerts.length === 0 ? (
          <EmptyState>No alerts yet. Add one above — they fire while the terminal is open.</EmptyState>
        ) : (
          <table className="w-full text-2xs">
            <tbody>
              {alerts.map((a) => {
                const tone =
                  a.op === 'cross' ? 'text-term-amber' : a.op === 'above' ? 'text-term-up' : 'text-term-down';
                const dot = !a.enabled
                  ? 'text-term-dim'
                  : a.status === 'triggered'
                    ? tone
                    : 'text-term-amber';
                return (
                  <tr key={a.id} className="border-b border-term-border/30 align-middle">
                    <td className="py-1 pl-2 pr-1">
                      <span className={dot} title={a.status}>
                        ●
                      </span>
                    </td>
                    <td className="py-1 pr-2">
                      <div className="font-semibold text-term-text">{a.symbol}</div>
                      <div className="text-term-muted">{describeThreshold(a)}</div>
                      {a.note && <div className="text-term-dim">{a.note}</div>}
                    </td>
                    <td className="py-1 pr-2 text-right tabular-nums">
                      <div className={a.status === 'triggered' ? tone : 'text-term-text'}>
                        {formatActual(a.metric, a.lastValue)}
                      </div>
                      {a.repeat && <div className="text-term-dim">repeat</div>}
                    </td>
                    <td className="py-1 pr-2 text-right">
                      <div className="flex justify-end gap-1.5">
                        {a.status === 'triggered' && (
                          <button
                            onClick={() => rearmAlert(a.id)}
                            className="no-drag text-term-amber hover:underline"
                            title="Re-arm"
                          >
                            re-arm
                          </button>
                        )}
                        <button
                          onClick={() => toggleAlert(a.id)}
                          className="no-drag text-term-muted hover:text-term-text"
                          title={a.enabled ? 'Disable' : 'Enable'}
                        >
                          {a.enabled ? 'on' : 'off'}
                        </button>
                        <button
                          onClick={() => removeAlert(a.id)}
                          className="no-drag text-term-dim hover:text-term-down"
                          title="Delete"
                        >
                          ×
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Recent triggers */}
      {log.length > 0 && (
        <div className="border-t border-term-border">
          <div className="flex items-center justify-between px-2 py-1">
            <span className="term-label">Recent triggers</span>
            <button onClick={clearLog} className="no-drag text-2xs text-term-dim hover:text-term-text">
              clear
            </button>
          </div>
          <div className="scroll-term max-h-24 overflow-auto px-2 pb-2">
            {log.slice(0, 12).map((t) => (
              <div key={t.id} className="flex items-baseline justify-between gap-2 text-2xs">
                <span className="truncate text-term-muted">{triggerHeadline(t)}</span>
                <span className="shrink-0 text-term-dim">{fmtTimeAgo(t.at)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
