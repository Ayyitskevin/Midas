import {
  TRUST_DATASET_FAMILIES,
  containsSensitiveReceiptText,
  stableStringify,
  validateDataReceipt,
  withReceiptTransport,
} from '@midas/shared';
import type { DataProvenance, DataReceipt, TrustDatasetFamily } from '@midas/shared';
import type { DataProvider } from './types';

export type ProviderConformanceExpectation = 'receipt' | 'unavailable' | 'error';

export interface ProviderConformanceProbe {
  label: string;
  /** Provider method names exercised by this probe. */
  methods: readonly string[];
  /** Required for receipt/unavailable probes; every returned receipt must match. */
  datasetFamily?: TrustDatasetFamily;
  expectation: ProviderConformanceExpectation;
  run: () => unknown | Promise<unknown>;
}

export interface ProviderConformanceScenario {
  provider: DataProvider;
  /** Injected provider clock expected on every accepted observation. */
  nowMs: number;
  probes: readonly ProviderConformanceProbe[];
  /**
   * Families whose provider method returns a broader input family and whose
   * family-specific receipt is therefore exercised at the HTTP derivation
   * boundary. Every exemption must name the concrete hermetic evidence.
   */
  routeDerivedFamilyEvidence?: Partial<Record<TrustDatasetFamily, string>>;
}

export interface ProviderConformanceReport {
  providerId: string;
  receiptsChecked: number;
  issues: string[];
}

function declaredMethods(provider: DataProvider): Set<string> {
  const methods = new Set<string>();
  for (const family of TRUST_DATASET_FAMILIES) {
    const capability = provider.capabilities.capabilities[family];
    if (capability.support === 'unsupported') continue;
    for (const method of capability.method.split('|').map((value) => value.trim()).filter(Boolean)) {
      methods.add(method);
    }
  }
  return methods;
}

function activeMethods(provider: DataProvider): Set<string> {
  const methods = new Set<string>();
  for (const family of TRUST_DATASET_FAMILIES) {
    const capability = provider.capabilities.capabilities[family];
    if (capability.support === 'unsupported' || capability.mode === 'unavailable') continue;
    for (const method of capability.method.split('|').map((value) => value.trim()).filter(Boolean)) {
      methods.add(method);
    }
  }
  return methods;
}

function collectReceipts(value: unknown): DataReceipt[] {
  if (Array.isArray(value)) return value.flatMap(collectReceipts);
  if (value == null || typeof value !== 'object') return [];
  const receipt = (value as { receipt?: unknown }).receipt;
  return receipt == null ? [] : [receipt as DataReceipt];
}

function privateText(value: unknown): boolean {
  let text: string;
  try {
    text = stableStringify(value);
  } catch {
    text = String(value);
  }
  return containsSensitiveReceiptText(text);
}

function inspectReceipt(
  provider: DataProvider,
  receipt: DataReceipt,
  nowMs: number,
  label: string,
  datasetFamily: TrustDatasetFamily,
  expectedProvenance: DataProvenance,
  issues: string[],
): void {
  const checked = validateDataReceipt(receipt);
  if (!checked.ok) {
    issues.push(`${label}: invalid receipt`);
    return;
  }
  const manifest = provider.capabilities;
  if (receipt.providerId !== manifest.providerId || receipt.providerVersion !== manifest.providerVersion) {
    issues.push(`${label}: receipt provider identity does not match the manifest`);
  }
  if (receipt.datasetFamily !== datasetFamily) {
    issues.push(`${label}: receipt dataset family does not match the probe`);
  }
  if (receipt.provenance !== expectedProvenance) {
    issues.push(`${label}: receipt provenance does not match the expected runtime mode`);
  }
  if (!provider.live && receipt.provenance === 'live') {
    issues.push(`${label}: a non-live provider emitted live provenance`);
  }
  if (provider.live && receipt.provenance === 'synthetic') {
    issues.push(`${label}: a live provider emitted synthetic provenance`);
  }
  if (Date.parse(receipt.observedAt) !== nowMs) {
    issues.push(`${label}: observedAt did not use the deterministic fake clock`);
  }
  if (privateText(receipt)) issues.push(`${label}: receipt contains private or machine-local text`);
  if (receipt.derivation === 'derived' && (receipt.methodology === null || receipt.inputReceiptIds.length === 0)) {
    issues.push(`${label}: derived receipt omitted methodology or lineage`);
  }

  try {
    const transported = withReceiptTransport(
      receipt,
      { traceId: 'conformance-trace', cache: { status: 'hit', ageMs: 123 } },
      nowMs + 123,
    );
    if (transported.receiptId !== receipt.receiptId) issues.push(`${label}: cache transport changed receiptId`);
    if (transported.sourceAsOf !== receipt.sourceAsOf) issues.push(`${label}: cache transport changed sourceAsOf`);
    if (transported.observedAt !== receipt.observedAt) issues.push(`${label}: cache transport changed observedAt`);
    if (transported.cache.status !== 'hit' || transported.cache.ageMs !== 123) {
      issues.push(`${label}: cache transport facts were not retained`);
    }

    if (receipt.derivation === 'observed' && receipt.sourceAsOf !== null && receipt.maxAgeMs !== null) {
      const sourceMs = Date.parse(receipt.sourceAsOf);
      const atBoundary = withReceiptTransport(receipt, {}, sourceMs + receipt.maxAgeMs);
      const afterBoundary = withReceiptTransport(receipt, {}, sourceMs + receipt.maxAgeMs + 1);
      if (atBoundary.freshness.state !== 'fresh' || atBoundary.freshness.ageMs !== receipt.maxAgeMs) {
        issues.push(`${label}: exact max-age boundary was not fresh`);
      }
      if (afterBoundary.freshness.state !== 'stale' || afterBoundary.freshness.ageMs !== receipt.maxAgeMs + 1) {
        issues.push(`${label}: first millisecond beyond max age was not stale`);
      }
    }
  } catch {
    issues.push(`${label}: transport/TTL check failed`);
  }
}

/**
 * Deterministic, network-free provider contract runner. A scenario must probe
 * every runtime-active declared method; the runner verifies callable dispatch,
 * receipt schema/privacy/lineage, unavailable behavior, exact TTL boundaries,
 * and cache/source identity preservation. Error probes exercise malformed or
 * operational upstream paths and must throw sanitized failures.
 */
export async function runProviderConformanceKit(
  scenario: ProviderConformanceScenario,
): Promise<ProviderConformanceReport> {
  const { provider, nowMs, probes, routeDerivedFamilyEvidence = {} } = scenario;
  const issues: string[] = [];
  const manifest = provider.capabilities;
  const families = Object.keys(manifest.capabilities).sort();
  if (stableStringify(families) !== stableStringify([...TRUST_DATASET_FAMILIES].sort())) {
    issues.push('capability manifest is not exhaustive');
  }
  if (privateText(manifest)) issues.push('capability manifest contains private or machine-local text');
  for (const family of TRUST_DATASET_FAMILIES) {
    const capability = manifest.capabilities[family];
    if (capability.datasetFamily !== family) issues.push(`${family}: capability family key mismatch`);
    if (capability.support === 'unsupported' && capability.mode !== 'unavailable') {
      issues.push(`${family}: unsupported capability did not use unavailable mode`);
    }
    if (!provider.live && capability.mode === 'live') {
      issues.push(`${family}: non-live provider declared live capability mode`);
    }
    if (provider.live && capability.mode === 'synthetic') {
      issues.push(`${family}: live provider declared synthetic capability mode`);
    }
  }

  const declared = declaredMethods(provider);
  const member = provider as unknown as Record<string, unknown>;
  for (const method of declared) {
    if (typeof member[method] !== 'function') issues.push(`declared method is not callable: ${method}`);
  }

  const probed = new Set(probes.flatMap((probe) => [...probe.methods]));
  for (const method of activeMethods(provider)) {
    if (!probed.has(method)) issues.push(`runtime-active declared method was not probed: ${method}`);
  }
  const probedFamilies = new Set(
    probes
      .filter((probe) => probe.expectation !== 'error' && probe.datasetFamily !== undefined)
      .map((probe) => probe.datasetFamily!),
  );
  for (const family of TRUST_DATASET_FAMILIES) {
    const capability = manifest.capabilities[family];
    if (capability.support === 'unsupported' || probedFamilies.has(family)) continue;
    const evidence = routeDerivedFamilyEvidence[family]?.trim();
    if (!evidence) {
      issues.push(`active capability family was neither probed nor explicitly route-derived: ${family}`);
    } else if (privateText(evidence)) {
      issues.push(`${family}: route-derived family evidence contains private or machine-local text`);
    }
  }

  let receiptsChecked = 0;
  for (const probe of probes) {
    let result: unknown;
    let thrown: unknown;
    try {
      result = await probe.run();
    } catch (error) {
      thrown = error;
    }
    if (probe.expectation === 'error') {
      if (thrown === undefined) issues.push(`${probe.label}: expected a sanitized error`);
      else if (privateText(thrown instanceof Error ? `${thrown.name}: ${thrown.message}` : thrown)) {
        issues.push(`${probe.label}: error contains private or machine-local text`);
      }
      continue;
    }
    if (thrown !== undefined) {
      issues.push(`${probe.label}: unexpectedly threw`);
      continue;
    }
    if (probe.datasetFamily === undefined) {
      issues.push(`${probe.label}: receipt probe omitted its expected dataset family`);
      continue;
    }
    const receipts = collectReceipts(result);
    if (receipts.length === 0) {
      issues.push(`${probe.label}: returned no receipt`);
      continue;
    }
    const expectedProvenance = probe.expectation === 'unavailable'
      ? 'unavailable'
      : manifest.capabilities[probe.datasetFamily].mode;
    if (probe.expectation === 'receipt' && expectedProvenance === 'unavailable') {
      issues.push(`${probe.label}: success probe targets an unavailable capability mode`);
    }
    for (const receipt of receipts) {
      receiptsChecked += 1;
      inspectReceipt(
        provider,
        receipt,
        nowMs,
        probe.label,
        probe.datasetFamily,
        expectedProvenance,
        issues,
      );
    }
  }

  return { providerId: manifest.providerId, receiptsChecked, issues };
}
