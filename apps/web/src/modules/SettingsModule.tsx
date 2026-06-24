import type { ReactNode } from 'react';
import { useSettings } from '@/store/useSettings';
import { useAlerts } from '@/store/useAlerts';
import { CHART_TIMEFRAMES } from '@/lib/settings';
import { canNotify, requestNotificationPermission } from '@/lib/alerts';
import type { ModuleProps } from './types';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col">
      <div className="term-label border-b border-term-border pb-1">{title}</div>
      <div className="divide-y divide-term-border/50">{children}</div>
    </section>
  );
}

function Row({ label, hint, control }: { label: string; hint?: string; control: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <div className="min-w-0">
        <div className="text-xs text-term-text">{label}</div>
        {hint && <div className="text-2xs text-term-dim">{hint}</div>}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

function Toggle({
  on,
  onChange,
  disabled,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative h-5 w-9 rounded-full border transition-colors disabled:opacity-40 ${
        on ? 'border-term-amber/60 bg-term-amber/30' : 'border-term-border bg-term-bg'
      }`}
    >
      <span
        className={`absolute top-0.5 h-3.5 w-3.5 rounded-full transition-all ${
          on ? 'left-[18px] bg-term-amber' : 'left-0.5 bg-term-muted'
        }`}
      />
    </button>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: readonly { v: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex overflow-hidden rounded-sm border border-term-border">
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          onClick={() => onChange(o.v)}
          className={`px-2 py-0.5 text-2xs ${
            value === o.v ? 'bg-term-amber/20 text-term-amber' : 'text-term-muted hover:text-term-text'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function SettingsModule(_props: ModuleProps) {
  const settings = useSettings((s) => s.settings);
  const update = useSettings((s) => s.update);
  const reset = useSettings((s) => s.reset);
  const soundEnabled = useAlerts((s) => s.soundEnabled);
  const setSound = useAlerts((s) => s.setSound);

  // Enabling desktop notifications also requests OS permission; only flip the
  // toggle on if permission is actually granted.
  const setDesktop = async (on: boolean): Promise<void> => {
    if (!on) {
      update({ desktopNotifications: false });
      return;
    }
    const perm = await requestNotificationPermission();
    update({ desktopNotifications: perm === 'granted' });
  };

  return (
    <div className="no-drag scroll-term flex h-full flex-col gap-3 overflow-y-auto p-3">
      <Section title="Display">
        <Row
          label="Density"
          hint="Tightens the global type scale"
          control={
            <Segmented
              value={settings.density}
              onChange={(v) => update({ density: v })}
              options={[
                { v: 'comfortable', label: 'Comfortable' },
                { v: 'compact', label: 'Compact' },
              ]}
            />
          }
        />
        <Row
          label="Ticker tape"
          hint="Scrolling quotes under the top bar"
          control={<Toggle on={settings.showTicker} onChange={(v) => update({ showTicker: v })} />}
        />
        <Row
          label="Reduce motion"
          hint="Pause the ticker, drop fade animations"
          control={<Toggle on={settings.reduceMotion} onChange={(v) => update({ reduceMotion: v })} />}
        />
      </Section>

      <Section title="Charts">
        <Row
          label="Default timeframe"
          hint="New price charts (GP) open here"
          control={
            <Segmented
              value={settings.chartTimeframe}
              onChange={(v) => update({ chartTimeframe: v })}
              options={CHART_TIMEFRAMES.map((t) => ({ v: t.label, label: t.label }))}
            />
          }
        />
      </Section>

      <Section title="Alerts">
        <Row
          label="Sound on trigger"
          hint="Short beep when an alert fires"
          control={<Toggle on={soundEnabled} onChange={setSound} />}
        />
        <Row
          label="Desktop notifications"
          hint={canNotify() ? 'OS notification when an alert fires' : 'Not supported in this browser'}
          control={
            <Toggle
              on={settings.desktopNotifications}
              onChange={(v) => void setDesktop(v)}
              disabled={!canNotify()}
            />
          }
        />
      </Section>

      <div className="mt-auto flex items-center justify-between border-t border-term-border pt-2 text-2xs text-term-dim">
        <span>Saved to this browser</span>
        <button
          type="button"
          onClick={reset}
          className="rounded-sm border border-term-border px-2 py-0.5 text-term-muted hover:text-term-text"
        >
          Reset to defaults
        </button>
      </div>
    </div>
  );
}
