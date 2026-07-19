import { useState, type FormEvent } from 'react';
import { useAlerts } from '@/store/useAlerts';
import { useToasts } from '@/store/useToasts';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useAlertActions } from '@/store/useAlertActions';
import { ALERT_ACTIONS } from '@/lib/alertAction';
import {
  ACCOUNT_SYMBOL,
  canNotify,
  describeThreshold,
  formatActual,
  requestNotificationPermission,
  triggerHeadline,
  type Alert,
  type AlertInput,
  type AlertMetric,
  type AlertOp,
} from '@/lib/alerts';
import { ALERT_TEMPLATES, type AlertTemplate, type TemplateContext } from '@/lib/alertTemplates';
import { fmtTimeAgo } from '@/lib/format';
import { EmptyState } from '@/components/Feedback';
import type { ModuleProps } from './types';

const METRICS: { code: AlertMetric; label: string }[] = [
  { code: 'price', label: 'Price' },
  { code: 'funding', label: 'Funding %' },
  { code: 'change', label: '24h %' },
  { code: 'upnl', label: 'Position uP&L $' },
  { code: 'equity', label: 'Account equity $' },
];

const OPS: { code: AlertOp; label: string }[] = [
  { code: 'above', label: 'rises ≥' },
  { code: 'below', label: 'falls ≤' },
  { code: 'cross', label: 'crosses' },
];

const inputCls =
  'no-drag rounded-sm border border-term-border bg-term-bg px-2 py-1 text-xs text-term-text outline-none focus:border-term-amber';

export function AlertsModule({ panel }: ModuleProps) {
  const mode = useAlerts((s) => s.mode);
  const setMode = useAlerts((s) => s.setMode);
  const localAlerts = useAlerts((s) => s.alerts);
  const localLog = useAlerts((s) => s.log);
  const soundEnabled = useAlerts((s) => s.soundEnabled);
  const setSound = useAlerts((s) => s.setSound);
  const addAlert = useAlerts((s) => s.addAlert);
  const removeAlert = useAlerts((s) => s.removeAlert);
  const toggleAlert = useAlerts((s) => s.toggleAlert);
  const rearmAlert = useAlerts((s) => s.rearmAlert);
  const clearLog = useAlerts((s) => s.clearLog);
  const alertActions = useAlertActions((s) => s.actions);
  const setAction = useAlertActions((s) => s.setAction);
  const pushToast = useToasts((s) => s.push);

  // In server mode the rules + log come from the API (the server evaluates).
  const serverAlertsQ = useFetch((signal) => api.listAlerts(signal), [], {
    intervalMs: 4000,
    enabled: mode === 'server',
  });
  const serverLogQ = useFetch((signal) => api.alertLog(signal), [], {
    intervalMs: 5000,
    enabled: mode === 'server',
  });
  const refreshServer = () => {
    serverAlertsQ.refresh();
    serverLogQ.refresh();
  };

  const alerts = mode === 'server' ? serverAlertsQ.data ?? [] : localAlerts;
  const log = mode === 'server' ? serverLogQ.data ?? [] : localLog;

  const [symbol, setSymbol] = useState(panel.symbol ?? '');
  const [metric, setMetric] = useState<AlertMetric>('price');
  const [op, setOp] = useState<AlertOp>('above');
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  const [repeat, setRepeat] = useState(false);
  const [perm, setPerm] = useState<NotificationPermission | 'unsupported'>(
    canNotify() ? Notification.permission : 'unsupported',
  );

  async function onAdd(input: AlertInput): Promise<boolean> {
    if (mode === 'server') {
      try {
        await api.createAlert(input);
        refreshServer();
        return true;
      } catch (e) {
        pushToast({ title: 'Alert not saved', body: (e as Error).message, tone: 'down' });
        return false;
      }
    }
    addAlert(input);
    return true;
  }

  // Server-mode mutations must surface failures. Swallowing the rejection (the
  // old `.then(refreshServer, () => {})`) left the row showing its old state —
  // so a "disable" that never reached the server looked done while the alert
  // kept firing. Toast on failure, mirroring onAdd.
  async function onToggle(a: Alert) {
    if (mode === 'server') {
      try {
        await api.updateAlert(a.id, { enabled: !a.enabled });
        refreshServer();
      } catch (e) {
        pushToast({ title: 'Alert not updated', body: (e as Error).message, tone: 'down' });
      }
    } else {
      toggleAlert(a.id);
    }
  }

  async function onRearm(a: Alert) {
    if (mode === 'server') {
      try {
        await api.updateAlert(a.id, { rearm: true });
        refreshServer();
      } catch (e) {
        pushToast({ title: 'Alert not re-armed', body: (e as Error).message, tone: 'down' });
      }
    } else {
      rearmAlert(a.id);
    }
  }

  async function onRemove(a: Alert) {
    if (mode === 'server') {
      try {
        await api.deleteAlert(a.id);
        refreshServer();
      } catch (e) {
        pushToast({ title: 'Alert not deleted', body: (e as Error).message, tone: 'down' });
      }
    } else {
      removeAlert(a.id);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    // Guard the empty field explicitly: Number('') === 0 is finite, so without
    // this an empty threshold would create a value=0 alert (e.g. "price above 0")
    // that fires on the very next reading.
    const v = Number(value);
    // Account equity has no pair — it keys on the ACCOUNT pseudo-symbol.
    const sym = metric === 'equity' ? ACCOUNT_SYMBOL : symbol.trim().toUpperCase();
    if (!sym || value.trim() === '' || !Number.isFinite(v)) return;
    void onAdd({ symbol: sym, metric, op, value: v, note, repeat });
    setValue('');
    setNote('');
  }

  const [busyTemplate, setBusyTemplate] = useState<string | null>(null);

  // One-click template: build inputs from what the terminal knows (fetching a
  // live equity read only when the template needs one), create them through
  // the normal path, and be honest when the template can't apply.
  async function onTemplate(t: AlertTemplate) {
    setBusyTemplate(t.key);
    try {
      const ctx: TemplateContext = {
        symbol: symbol.trim() ? symbol.trim().toUpperCase() : null,
        equityUsd: null,
      };
      if (t.needsEquity) {
        const b = await api.balances().catch(() => null);
        ctx.equityUsd = b && b.provenance === 'live' ? b.totalValueUsd : null;
      }
      const built = t.build(ctx);
      if ('unavailable' in built) {
        pushToast({ title: `Template “${t.label}”`, body: built.unavailable, tone: 'down' });
        return;
      }
      let created = 0;
      for (const input of built.inputs) if (await onAdd(input)) created += 1;
      if (created > 0) {
        pushToast({
          title: 'Alert armed',
          body: `${t.label}: ${created === 1 ? '1 alert' : `${created} alerts`} created${mode === 'server' ? ' on the server' : ''}.`,
          tone: 'up',
        });
      }
    } finally {
      setBusyTemplate(null);
    }
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
            value={metric === 'equity' ? ACCOUNT_SYMBOL : symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            placeholder="BTC/USDT"
            disabled={metric === 'equity'}
            title={metric === 'equity' ? 'Account equity is account-wide — no symbol needed.' : undefined}
            className={`${inputCls} w-28 uppercase disabled:opacity-60`}
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
            placeholder={metric === 'price' ? 'price' : metric === 'upnl' || metric === 'equity' ? 'USD' : '%'}
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
        {/* One-click classic setups */}
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          <span className="text-2xs text-term-dim" title="One-click classic setups">
            ⚡
          </span>
          {ALERT_TEMPLATES.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => void onTemplate(t)}
              disabled={busyTemplate != null}
              title={t.hint}
              className="no-drag rounded-sm border border-term-border px-1.5 py-0.5 text-2xs text-term-muted hover:border-term-amber hover:text-term-amber disabled:opacity-50"
            >
              {busyTemplate === t.key ? '…' : t.label}
            </button>
          ))}
        </div>
      </form>

      {/* Mode + notification + sound controls */}
      <div className="flex items-center gap-2 border-b border-term-border px-2 py-1 text-2xs">
        <div className="flex overflow-hidden rounded-sm border border-term-border" title="Where alerts live">
          {(['local', 'server'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`no-drag px-1.5 py-0.5 uppercase ${
                mode === m ? 'bg-term-amber/20 text-term-amber' : 'text-term-muted hover:text-term-text'
              }`}
            >
              {m}
            </button>
          ))}
        </div>
        {perm === 'granted' ? (
          <span className="text-term-up">● on</span>
        ) : perm === 'unsupported' ? (
          <span className="text-term-dim">no notif.</span>
        ) : (
          <button onClick={enableNotifications} className="no-drag text-term-amber hover:underline">
            {perm === 'denied' ? 'notif. blocked' : 'enable notif.'}
          </button>
        )}
        <label className="no-drag ml-auto flex items-center gap-1 text-term-muted">
          <input type="checkbox" checked={soundEnabled} onChange={(e) => setSound(e.target.checked)} />
          sound
        </label>
      </div>

      {/* Alert list */}
      <div className="scroll-term min-h-0 flex-1 overflow-auto">
        {mode === 'server' && serverAlertsQ.error && !serverAlertsQ.data ? (
          <EmptyState>Can’t reach the server — {serverAlertsQ.error}</EmptyState>
        ) : alerts.length === 0 ? (
          <EmptyState>
            {mode === 'server'
              ? 'No server alerts yet — these are evaluated in the background, even with the tab closed.'
              : 'No alerts yet. Add one above — local alerts fire while the terminal is open.'}
          </EmptyState>
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
                      <div className="flex items-center justify-end gap-1.5">
                        <select
                          value={alertActions[a.id] ?? ''}
                          onChange={(e) => setAction(a.id, e.target.value)}
                          title="On fire, open a panel for this symbol"
                          className="no-drag rounded-sm border border-term-border bg-term-panel px-0.5 py-0 text-2xs text-term-muted outline-none focus:border-term-amber"
                        >
                          {ALERT_ACTIONS.map((o) => (
                            <option key={o.code} value={o.code}>
                              {o.code === '' ? '↳ —' : `↳ ${o.code}`}
                            </option>
                          ))}
                        </select>
                        {a.status === 'triggered' && (
                          <button
                            onClick={() => onRearm(a)}
                            className="no-drag text-term-amber hover:underline"
                            title="Re-arm"
                          >
                            re-arm
                          </button>
                        )}
                        <button
                          onClick={() => onToggle(a)}
                          className="no-drag text-term-muted hover:text-term-text"
                          title={a.enabled ? 'Disable' : 'Enable'}
                        >
                          {a.enabled ? 'on' : 'off'}
                        </button>
                        <button
                          onClick={() => onRemove(a)}
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
            {mode === 'local' && (
              <button onClick={clearLog} className="no-drag text-2xs text-term-dim hover:text-term-text">
                clear
              </button>
            )}
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
