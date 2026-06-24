import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { newAlert, type Alert, type AlertInput, type AlertTrigger } from '@midas/shared';

const TRIGGER_CAP = 200;

interface Persisted {
  alerts: Alert[];
  triggers: AlertTrigger[];
}

/**
 * Stores alert rules + recent triggers. Backed by a JSON file when a path is
 * given (survives restarts); purely in-memory otherwise (used by tests).
 */
export class AlertRepo {
  private alerts: Alert[] = [];
  private triggers: AlertTrigger[] = [];
  private seq = 0;

  constructor(private readonly file?: string) {
    if (file) this.load();
  }

  private load(): void {
    if (!this.file || !existsSync(this.file)) return;
    try {
      const data = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Persisted>;
      if (Array.isArray(data.alerts)) this.alerts = data.alerts;
      if (Array.isArray(data.triggers)) this.triggers = data.triggers;
    } catch {
      /* corrupt store → start fresh */
    }
  }

  private persist(): void {
    if (!this.file) return;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(
        this.file,
        JSON.stringify({ alerts: this.alerts, triggers: this.triggers }, null, 2),
      );
    } catch {
      /* best-effort persistence */
    }
  }

  private newId(prefix: string, now: number): string {
    this.seq += 1;
    return `${prefix}_${now.toString(36)}_${this.seq.toString(36)}`;
  }

  list(): Alert[] {
    return this.alerts;
  }

  log(): AlertTrigger[] {
    return this.triggers;
  }

  create(input: AlertInput, now: number): Alert {
    const alert = newAlert(input, this.newId('alt', now), now);
    this.alerts = [alert, ...this.alerts];
    this.persist();
    return alert;
  }

  update(id: string, patch: { enabled?: boolean; rearm?: boolean }): Alert | undefined {
    let updated: Alert | undefined;
    this.alerts = this.alerts.map((a) => {
      if (a.id !== id) return a;
      updated = {
        ...a,
        enabled: patch.enabled ?? a.enabled,
        ...(patch.rearm ? { status: 'armed' as const, triggeredAt: null } : {}),
      };
      return updated;
    });
    if (updated) this.persist();
    return updated;
  }

  remove(id: string): boolean {
    const before = this.alerts.length;
    this.alerts = this.alerts.filter((a) => a.id !== id);
    const removed = this.alerts.length !== before;
    if (removed) this.persist();
    return removed;
  }

  /** Replace the rule set (post-evaluation) and record any fires. */
  commit(next: Alert[], fired: AlertTrigger[]): void {
    this.alerts = next;
    if (fired.length > 0) this.triggers = [...fired, ...this.triggers].slice(0, TRIGGER_CAP);
    this.persist();
  }
}
