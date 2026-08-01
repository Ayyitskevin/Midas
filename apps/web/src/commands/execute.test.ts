import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runCommand } from '@/commands/execute';
import { commandUsesSymbol, lookupCommand } from '@/commands/registry';

/**
 * Executor symbol handling against a fake panel store — the regression guard
 * for symbol-optional commands (N/FILLS/XQL) silently dropping a typed symbol.
 */
const panels = vi.hoisted(() => ({
  openPanel: vi.fn(),
  activeSymbol: null as string | null,
}));

const chartParams = vi.hoisted(() => ({
  chartParamsFor: vi.fn((): { interval: string; range: string } | null => null),
}));

const alerts = vi.hoisted(() => ({
  addAlert: vi.fn(),
  mode: 'local' as 'local' | 'server',
}));

const toasts = vi.hoisted(() => ({
  push: vi.fn(),
}));

vi.mock('@/store/usePanels', () => ({
  usePanels: { getState: () => panels },
}));

vi.mock('@/store/useSettings', () => ({
  useSettings: { getState: () => ({ settings: {} }) },
}));

vi.mock('@/lib/settings', () => chartParams);

vi.mock('@/store/useAlerts', () => ({
  useAlerts: { getState: () => alerts },
}));

vi.mock('@/store/useToasts', () => ({
  useToasts: { getState: () => toasts },
}));

describe('runCommand symbol handling', () => {
  beforeEach(() => {
    panels.openPanel.mockClear();
    panels.activeSymbol = null;
  });
  it('keeps an explicitly typed symbol for symbol-optional commands (N/FILLS/XQL)', () => {
    for (const code of ['N', 'FILLS', 'XQL']) {
      panels.openPanel.mockClear();
      const r = runCommand(`BTC/USDT ${code}`);
      expect(r.ok, code).toBe(true);
      expect(panels.openPanel, code).toHaveBeenCalledWith(
        expect.objectContaining({ module: code, symbol: 'BTC/USDT' }),
      );
    }
  });

  it('drops the symbol for strictly symbol-less commands', () => {
    const r = runCommand('BTC/USDT W');
    expect(r.ok).toBe(true);
    expect(panels.openPanel).toHaveBeenCalledWith(expect.objectContaining({ symbol: null }));
  });

  it('bare N falls back to the active symbol', () => {
    panels.activeSymbol = 'ETH/USDT';
    const r = runCommand('N');
    expect(r.ok).toBe(true);
    expect(panels.openPanel).toHaveBeenCalledWith(
      expect.objectContaining({ module: 'N', symbol: 'ETH/USDT' }),
    );
  });

  it('bare N with no active symbol opens top market news', () => {
    const r = runCommand('N');
    expect(r.ok).toBe(true);
    expect(panels.openPanel).toHaveBeenCalledWith(
      expect.objectContaining({ module: 'N', symbol: null }),
    );
  });

  it('fails a symbol-required command with no symbol and no active symbol', () => {
    const r = runCommand('GP');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('GP needs a symbol');
    expect(panels.openPanel).not.toHaveBeenCalled();
  });
});

describe('commandUsesSymbol', () => {
  it('is true for symbol-required and symbol-optional commands', () => {
    for (const code of ['GP', 'N', 'FILLS', 'XQL']) {
      const cmd = lookupCommand(code);
      expect(cmd, code).toBeDefined();
      expect(commandUsesSymbol(cmd!), code).toBe(true);
    }
  });

  it('is false for strictly symbol-less commands', () => {
    for (const code of ['W', 'TOP', 'HELP']) {
      const cmd = lookupCommand(code);
      expect(cmd, code).toBeDefined();
      expect(commandUsesSymbol(cmd!), code).toBe(false);
    }
  });
});

describe('runCommand interval args', () => {
  beforeEach(() => {
    panels.openPanel.mockClear();
    panels.activeSymbol = null;
    chartParams.chartParamsFor.mockReturnValue(null);
  });

  it('opens the chart on the explicitly typed interval (BTC/USDT GP 1h)', () => {
    const r = runCommand('BTC/USDT GP 1h');
    expect(r.ok).toBe(true);
    expect(panels.openPanel).toHaveBeenCalledWith(
      expect.objectContaining({
        module: 'GP',
        symbol: 'BTC/USDT',
        params: expect.objectContaining({ interval: '60m', range: '5d' }),
      }),
    );
  });

  it('opens GIP on the typed interval (SOL/USDT GIP 15m)', () => {
    const r = runCommand('SOL/USDT GIP 15m');
    expect(r.ok).toBe(true);
    expect(panels.openPanel).toHaveBeenCalledWith(
      expect.objectContaining({
        module: 'GP',
        symbol: 'SOL/USDT',
        params: expect.objectContaining({ interval: '15m', range: '5d' }),
      }),
    );
  });

  it('an explicit interval arg overrides the user default timeframe', () => {
    chartParams.chartParamsFor.mockReturnValue({ interval: '1d', range: '1y' });
    const r = runCommand('BTC/USDT GP 1h');
    expect(r.ok).toBe(true);
    expect(panels.openPanel).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({ interval: '60m', range: '5d' }),
      }),
    );
  });

  it('honours the user default timeframe when no interval is typed', () => {
    chartParams.chartParamsFor.mockReturnValue({ interval: '1d', range: '1y' });
    const r = runCommand('BTC/USDT GP');
    expect(r.ok).toBe(true);
    expect(panels.openPanel).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({ interval: '1d', range: '1y' }),
      }),
    );
  });

  it('rejects an unknown interval without opening a panel', () => {
    const r = runCommand('BTC/USDT GP 2h');
    expect(r.ok).toBe(false);
    expect(r.error).toContain("unknown interval '2H'");
    expect(panels.openPanel).not.toHaveBeenCalled();
  });
});

describe('runCommand ALERT price args', () => {
  beforeEach(() => {
    panels.openPanel.mockClear();
    panels.activeSymbol = null;
    alerts.addAlert.mockClear();
    alerts.mode = 'local';
    toasts.push.mockClear();
  });

  it('arms a local price alert (BTC/USDT ALERT 70000) and opens the panel', () => {
    const r = runCommand('BTC/USDT ALERT 70000');
    expect(r.ok).toBe(true);
    expect(alerts.addAlert).toHaveBeenCalledWith({
      symbol: 'BTC/USDT',
      metric: 'price',
      op: 'cross',
      value: 70000,
      repeat: false,
    });
    expect(panels.openPanel).toHaveBeenCalledWith(
      expect.objectContaining({ module: 'ALERT', symbol: 'BTC/USDT' }),
    );
  });

  it('parses direction (ALERT > 70000 → above, ALERT < 70000 → below)', () => {
    runCommand('BTC/USDT ALERT > 70000');
    expect(alerts.addAlert).toHaveBeenCalledWith(expect.objectContaining({ op: 'above' }));
    runCommand('BTC/USDT ALERT < 70000');
    expect(alerts.addAlert).toHaveBeenCalledWith(expect.objectContaining({ op: 'below' }));
  });

  it('labels the confirmation as local and firing only while the tab is open', () => {
    runCommand('BTC/USDT ALERT 70000');
    expect(toasts.push).toHaveBeenCalledTimes(1);
    const toast = toasts.push.mock.calls[0][0];
    expect(toast.title).toContain('Local alert');
    expect(toast.body).toContain('while this terminal tab is open');
  });

  it('uses the active symbol for a bare ALERT with a price', () => {
    panels.activeSymbol = 'ETH/USDT';
    const r = runCommand('ALERT 3000');
    expect(r.ok).toBe(true);
    expect(alerts.addAlert).toHaveBeenCalledWith(
      expect.objectContaining({ symbol: 'ETH/USDT', value: 3000 }),
    );
  });

  it('refuses to arm without a symbol and opens nothing', () => {
    const r = runCommand('ALERT 70000');
    expect(r.ok).toBe(false);
    expect(alerts.addAlert).not.toHaveBeenCalled();
    expect(panels.openPanel).not.toHaveBeenCalled();
  });
});
