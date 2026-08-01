import type { BoardMeta } from '@midas/shared';
import { boardMetaView } from '@/lib/boardMeta';
import { SourceBadge } from '@/components/SourceInspector';

/**
 * Provenance/freshness badge for the BoardEnvelope fan-out boards (funding,
 * dispersion, venue arb, OI concentration). Sits on the right of the board's
 * header row; a cached or synthetic board reads differently from a fresh live
 * one — the terminal never passes stale/mock data off as live.
 */
export function BoardMetaBadge({ meta }: { meta: BoardMeta }) {
  if (meta.receipt) return <SourceBadge receipt={meta.receipt} />;

  const v = boardMetaView(meta);
  const legacyLive = v.label === 'live';
  return (
    <span
      className="flex items-center gap-1 text-term-dim"
      title={legacyLive ? `${v.title} · freshness unknown because this legacy payload has no receipt` : v.title}
    >
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${legacyLive ? 'bg-term-muted' : v.dotClass}`} />
      <span className="text-term-muted">{v.source}</span>
      <span>· {legacyLive ? 'live · freshness unknown' : v.label}</span>
      <span>· {v.ageText}</span>
    </span>
  );
}

/** Honesty banner under the header — why the board is synthetic/partial/stale. */
export function BoardMetaNote({ meta }: { meta: BoardMeta }) {
  const v = boardMetaView(meta);
  if (!v.note) return null;
  return (
    <div
      className={`border-b px-2 py-1 text-2xs leading-snug ${
        v.warn ? 'border-term-amber/40 bg-term-amber/10 text-term-amber' : 'border-term-border text-term-dim'
      }`}
    >
      ⚠ {v.note}
    </div>
  );
}
