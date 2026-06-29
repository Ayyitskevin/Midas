import { describe, it, expect, beforeEach } from 'vitest';
import { useBoardFavorites } from './useBoardFavorites';

describe('useBoardFavorites', () => {
  beforeEach(() => useBoardFavorites.setState({ favorites: [] }));

  it('toggles a board on and off and reports membership', () => {
    const s = useBoardFavorites.getState();
    expect(s.isFavorite('RSI')).toBe(false);
    s.toggle('RSI');
    expect(useBoardFavorites.getState().favorites).toEqual(['RSI']);
    expect(useBoardFavorites.getState().isFavorite('RSI')).toBe(true);
    useBoardFavorites.getState().toggle('RSI');
    expect(useBoardFavorites.getState().favorites).toEqual([]);
  });

  it('preserves pin order across multiple favorites', () => {
    const s = useBoardFavorites.getState();
    s.toggle('MACD');
    s.toggle('OBV');
    s.toggle('RSI');
    expect(useBoardFavorites.getState().favorites).toEqual(['MACD', 'OBV', 'RSI']);
  });
});
