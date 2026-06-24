import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Alert, AlertMetric, AlertOp, AlertTrigger, Readings } from '@/lib/alerts';
import { evaluateAlerts } from '@/lib/alerts';

export interface NewAlertInput {
  symbol: string;
  metric: AlertMetric;
  op: AlertOp;
  value: number;
  note?: string;
  repeat: boolean;
}

interface AlertsState {
  alerts: Alert[];
  /** Most recent triggers, newest first (capped). */
  log: AlertTrigger[];
  soundEnabled: boolean;

  addAlert: (input: NewAlertInput) => void;
  removeAlert: (id: string) => void;
  toggleAlert: (id: string) => void;
  /** Reset a triggered alert back to armed so it can fire again. */
  rearmAlert: (id: string) => void;
  clearLog: () => void;
  clearAll: () => void;
  setSound: (on: boolean) => void;

  /** Engine entry point: fold in fresh readings, return the triggers that fired. */
  ingest: (readings: Readings) => AlertTrigger[];
}

const LOG_CAP = 50;

let seq = 0;
function newId(): string {
  seq += 1;
  return `alt_${Date.now().toString(36)}_${seq.toString(36)}`;
}

export const useAlerts = create<AlertsState>()(
  persist(
    (set, get) => ({
      alerts: [],
      log: [],
      soundEnabled: true,

      addAlert: (input) => {
        const symbol = input.symbol.trim().toUpperCase();
        if (!symbol || !Number.isFinite(input.value)) return;
        const alert: Alert = {
          id: newId(),
          symbol,
          metric: input.metric,
          op: input.op,
          value: input.value,
          note: input.note?.trim() || undefined,
          enabled: true,
          repeat: input.repeat,
          status: 'armed',
          lastValue: null,
          createdAt: Date.now(),
          triggeredAt: null,
        };
        set({ alerts: [alert, ...get().alerts] });
      },

      removeAlert: (id) => set({ alerts: get().alerts.filter((a) => a.id !== id) }),

      toggleAlert: (id) =>
        set({
          alerts: get().alerts.map((a) => (a.id === id ? { ...a, enabled: !a.enabled } : a)),
        }),

      rearmAlert: (id) =>
        set({
          alerts: get().alerts.map((a) =>
            a.id === id ? { ...a, status: 'armed', triggeredAt: null } : a,
          ),
        }),

      clearLog: () => set({ log: [] }),
      clearAll: () => set({ alerts: [], log: [] }),
      setSound: (on) => set({ soundEnabled: on }),

      ingest: (readings) => {
        const { alerts, log } = get();
        if (alerts.length === 0) return [];
        const { next, fired } = evaluateAlerts(alerts, readings, Date.now());
        if (fired.length === 0) {
          set({ alerts: next });
          return [];
        }
        set({ alerts: next, log: [...fired, ...log].slice(0, LOG_CAP) });
        return fired;
      },
    }),
    {
      name: 'midas-alerts',
      version: 1,
      partialize: (s) => ({ alerts: s.alerts, log: s.log, soundEnabled: s.soundEnabled }),
    },
  ),
);
