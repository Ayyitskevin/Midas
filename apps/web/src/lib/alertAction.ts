/**
 * The set of "on fire, open…" actions an alert can carry. Each opens a
 * symbol-scoped panel for the alert's symbol when it triggers. Pure data +
 * helpers; the actual opening happens in the AlertsEngine via openModule.
 */
export interface AlertActionOption {
  /** Module/command code to open ('' = no action). */
  code: string;
  label: string;
}

export const ALERT_ACTIONS: AlertActionOption[] = [
  { code: '', label: 'no action' },
  { code: 'GP', label: 'open chart' },
  { code: 'DES', label: 'open description' },
  { code: 'BOOK', label: 'open order book' },
  { code: 'FUND', label: 'open derivatives' },
];

export function alertActionLabel(code: string): string {
  return ALERT_ACTIONS.find((a) => a.code === code)?.label ?? 'no action';
}

/** True if the code names a real action (not the empty "no action"). */
export function isAlertActionCode(code: string): boolean {
  return code !== '' && ALERT_ACTIONS.some((a) => a.code === code);
}
