import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { newAlert, type Alert, type AlertInput, type AlertTrigger } from '@midas/shared';

const TRIGGER_CAP = 500;
/** Owner for single-user / auth-off deploys (and pre-auth alerts). */
const LOCAL = '@local';

const ownerKey = (userId?: string): string => userId || LOCAL;
const ownerOf = (x: { userId?: string }): string => x.userId ?? LOCAL;

interface Persisted {
  alerts: Alert[];
  triggers: AlertTrigger[];
}

/**
 * Stores alert rules + recent triggers, scoped per user. Backed by a JSON file
 * when a path is given (survives restarts); in-memory otherwise (tests).
 * With auth off, everything lives under the `@local` owner — unchanged
 * single-user behaviour, and pre-auth alerts (no userId) map there too.
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
      /* best-effort */
    }
  }

  private newId(prefix: string, now: number): string {
    this.seq += 1;
    return `${prefix}_${now.toString(36)}_${this.seq.toString(36)}`;
  }

  /** Every alert across all users — used by the evaluation engine. */
  all(): Alert[] {
    return this.alerts;
  }

  /** A single user's alerts (auth off → the `@local` bucket). */
  listFor(userId?: string): Alert[] {
    const owner = ownerKey(userId);
    return this.alerts.filter((a) => ownerOf(a) === owner);
  }

  logFor(userId?: string): AlertTrigger[] {
    const owner = ownerKey(userId);
    return this.triggers.filter((t) => ownerOf(t) === owner);
  }

  create(input: AlertInput, now: number, userId?: string): Alert {
    const alert: Alert = { ...newAlert(input, this.newId('alt', now), now), userId: ownerKey(userId) };
    this.alerts = [alert, ...this.alerts];
    this.persist();
    return alert;
  }

  updateFor(
    id: string,
    patch: { enabled?: boolean; rearm?: boolean },
    userId?: string,
  ): Alert | undefined {
    const owner = ownerKey(userId);
    let updated: Alert | undefined;
    this.alerts = this.alerts.map((a) => {
      if (a.id !== id || ownerOf(a) !== owner) return a;
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

  removeFor(id: string, userId?: string): boolean {
    const owner = ownerKey(userId);
    const before = this.alerts.length;
    this.alerts = this.alerts.filter((a) => !(a.id === id && ownerOf(a) === owner));
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
