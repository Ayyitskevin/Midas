import { create } from 'zustand';

export type ToastTone = 'up' | 'down' | 'info';

export interface Toast {
  id: string;
  title: string;
  body?: string;
  tone: ToastTone;
}

interface ToastsState {
  toasts: Toast[];
  push: (toast: Omit<Toast, 'id'>) => string;
  dismiss: (id: string) => void;
}

const MAX_VISIBLE = 5;

let seq = 0;
function newId(): string {
  seq += 1;
  return `tst_${Date.now().toString(36)}_${seq.toString(36)}`;
}

/** Transient, non-persisted notification surface (fed by the alerts engine). */
export const useToasts = create<ToastsState>((set, get) => ({
  toasts: [],
  push: (toast) => {
    const id = newId();
    set({ toasts: [...get().toasts, { ...toast, id }].slice(-MAX_VISIBLE) });
    return id;
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));
