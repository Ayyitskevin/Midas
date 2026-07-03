import type { SolanaProvenance } from '@midas/shared';

/**
 * Honesty badge for the Solana panels, mirroring dexView's pattern: a small
 * {label, tone, detail} derived from a snapshot's provenance + note. Keeps the
 * SOLNET / SWAL panels honest about whether they're showing a real RPC read,
 * synthetic demo data, or nothing at all.
 */
export type SolanaTone = 'live' | 'synthetic' | 'unavailable';

export interface SolanaBadge {
  label: string;
  tone: SolanaTone;
  detail: string;
}

export function solanaBadge(p: { provenance: SolanaProvenance; note: string | null }): SolanaBadge {
  switch (p.provenance) {
    case 'live':
      return { label: 'live RPC', tone: 'live', detail: p.note ?? 'Live Solana RPC read.' };
    case 'synthetic':
      return { label: 'synthetic', tone: 'synthetic', detail: p.note ?? 'Synthetic — not a real RPC read.' };
    default:
      return { label: 'unavailable', tone: 'unavailable', detail: p.note ?? 'Solana data unavailable.' };
  }
}
