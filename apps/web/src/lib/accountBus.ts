import { useEffect, useRef } from 'react';

/**
 * A tiny pub/sub for account mutations. When the order ticket places (or later
 * cancels) a live order, every open account panel — balances, open orders,
 * positions — should reflect it immediately instead of waiting out its 30s
 * poll. The ticket emits; panels subscribe their `refresh` from useFetch.
 */
type Listener = () => void;

const listeners = new Set<Listener>();

/** Notify every subscribed account panel that balances/orders/positions changed. */
export function emitAccountChange(): void {
  for (const listener of [...listeners]) listener();
}

/** Re-run `refresh` whenever an account mutation is announced. */
export function useAccountRefresh(refresh: () => void): void {
  const ref = useRef(refresh);
  ref.current = refresh;
  useEffect(() => {
    const listener = () => ref.current();
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
}

/**
 * Price-pick channel for cross-panel flow: clicking a level in a linked order
 * book sends that price to the order ticket in the same link group (classic
 * terminal ergonomics — point at liquidity, ticket takes the price).
 */
export interface PricePick {
  /** The link-group color both panels share. */
  group: string;
  price: number;
}

const priceListeners = new Set<(pick: PricePick) => void>();

export function emitPricePick(pick: PricePick): void {
  for (const listener of [...priceListeners]) listener(pick);
}

export function usePricePick(handler: (pick: PricePick) => void): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const listener = (pick: PricePick) => ref.current(pick);
    priceListeners.add(listener);
    return () => {
      priceListeners.delete(listener);
    };
  }, []);
}
