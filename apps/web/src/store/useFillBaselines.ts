import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { recordBaseline, type FillBaseline } from '@/lib/postTradeSlippage';

interface FillBaselinesState {
  /** orderId → the estimate TICKET showed when the order was placed. */
  baselines: Record<string, FillBaseline>;
  record: (b: FillBaseline) => void;
}

/**
 * Persisted map of placement-time price estimates, written by TICKET and read
 * by FILLS/XQL to show realized-vs-predicted slippage. Bounded (oldest out).
 */
export const useFillBaselines = create<FillBaselinesState>()(
  persist(
    (set, get) => ({
      baselines: {},
      record: (b) => set({ baselines: recordBaseline(get().baselines, b) }),
    }),
    { name: 'midas-fill-baselines' },
  ),
);
