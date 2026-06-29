import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Per-alert "action": which panel to open (for the alert's symbol) when it
 * fires. A client-only overlay keyed by alert id — it layers on top of the
 * existing alert engine without touching the shared/server alert contract, so
 * a fired alert can *do* something (jump you to the chart / book / derivatives)
 * instead of only raising a toast.
 */
export interface AlertActionsState {
  /** alertId → module code ('' / absent = no action). */
  actions: Record<string, string>;
  actionFor: (alertId: string) => string;
  setAction: (alertId: string, code: string) => void;
}

export const useAlertActions = create<AlertActionsState>()(
  persist(
    (set, get) => ({
      actions: {},
      actionFor: (alertId) => get().actions[alertId] ?? '',
      setAction: (alertId, code) =>
        set((s) => {
          const actions = { ...s.actions };
          if (code) actions[alertId] = code;
          else delete actions[alertId];
          return { actions };
        }),
    }),
    { name: 'midas-alert-actions' },
  ),
);
