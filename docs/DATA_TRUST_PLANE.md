# Data Trust Plane v1

Midas treats data evidence as part of the product contract. A number without a
source, time, or honest limitation can be worse than no number at all. The data
trust plane adds a small, versioned `DataReceipt` beside selected market and
read-only account responses so operators and users can inspect the evidence
without changing the value payload that existing clients consume.

The v1 wire contract is additive: receipts are attached without removing or
renaming existing value fields, and legacy clients may ignore the optional
`receipt` field. A compatibility regression test fixes that JSON behavior and
also verifies that attachment does not mutate the original payload.

Provider authors do have two deliberate compile-time migrations. Every
`DataProvider` must expose a complete `capabilities` manifest, and upstream
timestamps that can genuinely be absent are nullable (for example
`Quote.asOf`). Those changes prevent silent evidence fabrication; v1 does not
claim source-level compatibility for an old provider implementation that has
not adopted them. Existing `live | synthetic | unavailable` provenance keeps
its original meaning.

## Vocabulary

- **Provenance** describes the source mode only: `live`, `synthetic`, or
  `unavailable`. It does not say whether a live observation is current.
- **Derivation** is independent: `observed` came from a provider observation;
  `derived` was calculated from one or more input receipts.
- **Source as-of** is the upstream observation time. It is never replaced by
  the time a cache entry was served.
- **Observed at** is when Midas received or constructed the evidence.
- **Freshness** compares source age with the declared maximum age. Its state is
  explicit at the exact boundary, and can also report missing time or clock
  skew. A live source can therefore be fresh, stale, or unknown.
- **Cache state** says whether the current response bypassed, missed, or hit a
  cache and, on a hit, how old the cached result is.
- **Methodology** is a stable calculation identifier and version. A formula is
  descriptive evidence, not executable code.
- **Lineage** is the ordered, de-duplicated set of input receipt IDs retained by
  a derived result.
- **Partial evidence** is result-specific incompleteness, encoded with the
  machine-readable `Partial evidence:` limitation prefix. It is distinct from
  a provider's static caveats and makes the result non-actionable even when its
  available live inputs are fresh.

The Source Inspector composes these dimensions into precise labels such as
`LIVE / FRESH`, `LIVE / FRESH / PARTIAL`, `LIVE / STALE`, `SYNTHETIC`,
`UNAVAILABLE`, and optionally `DERIVED`. Partial evidence is amber and
non-actionable. The inspector never invents a fourth provenance value.

## Receipt contract

`@midas/shared` owns the dependency-free schema, validator, UTC normalization,
canonical serialization, deterministic ID helper, redaction helper, and
freshness policy. A receipt contains:

- schema and receipt IDs;
- provider ID/version, source, venue, dataset family, instrument, and coverage;
- provenance and derivation;
- source-as-of and observed-at UTC timestamps;
- expected cadence, maximum age, computed freshness state/age;
- cache state/age;
- units;
- methodology ID/version/formula for derived values;
- upstream input receipt IDs;
- limitations, trace ID, and a concise note.

Unknown evidence stays `null` or is omitted according to the schema and gains a
limitation. In particular, the implementation must not turn missing volume,
open interest, funding, fees, mark/index price, position, or balance evidence
into zero.

Receipt IDs are derived from evidence identity. Identity includes `observedAt`
so two independently accepted observations remain distinct even when an
upstream reuses a source timestamp for an in-progress bar. It excludes trace
ID, computed freshness, and cache-serving metadata. Serving the same cached
observation preserves `sourceAsOf`, `observedAt`, and receipt ID while updating
only transport facts.

### Freshness and derived policy

For an observation with a valid source-as-of time, age is the freshness
evaluation time minus `sourceAsOf`. Creation initially evaluates at receipt
time; cache transport and `/api/data/status` advance the age at serve/read
time without changing the source identity. Values younger than or exactly at
`maxAgeMs` are fresh; values beyond it are stale. A future source time is
reported as clock skew, never clamped to reassuring zero. A missing source time
is an unknown freshness state with an explicit limitation; a malformed timestamp
is rejected by the constructor/validator rather than admitted as evidence.

A derived result inherits the least trustworthy freshness of every required
input. One stale input makes the result stale. Clock skew or unknown required
input time prevents a fresh claim. Derived results retain all required input
receipt IDs and name their methodology version.

Cadence is evidence, not a market convention. Funding observations do not
assume an eight-hour schedule: `expectedCadenceMs` stays unknown unless the
provider can establish the venue/source cadence for that observation.

## Provider capability manifests

Every `DataProvider` exposes one runtime-inspectable
`ProviderCapabilityManifest`. Each family declaration states:

- supported, unsupported, or conditional support;
- public or keyed authentication;
- live, synthetic, or unavailable source mode;
- venue/coverage, expected cadence, and cache TTL;
- methodology ID/version where applicable;
- known caveats.

`cacheTtlMs` describes a cache owned inside the provider implementation; it is
`null` when no such cache exists. HTTP/board route caches have their own TTLs
and report each response's actual hit/miss age in the receipt transport fields.
They are not copied into the provider capability declaration.

The registry is generated from these code declarations; there is no second
hand-maintained provider matrix. Some methods remain optional, but a missing
method maps deterministically to an honest unavailable capability. The
manifest itself is required. An unknown or unset `MIDAS_DATA_PROVIDER` fails
closed; only an explicit `mock` selection or the static demo may produce
synthetic market/account data.

The hermetic conformance runner requires every non-unsupported family to have
either a direct family receipt probe or explicit, privacy-safe evidence naming
the HTTP route test where that family-specific receipt is derived. Probing a
shared provider method is not enough to leave a declared family unchecked.

## Runtime status and privacy

Authenticated installations protect `GET /api/data/status` with the existing
API authentication boundary. The response exposes the active provider's
manifest plus sanitized per-family health: availability/source mode, last
success and source-as-of times, freshness, cache state, limitations, and a
coarse error category.

Receipts and status responses use an allowlist. They must never contain API
keys, secrets, authorization headers, request signatures, raw upstream auth
errors, internal file paths, account identifiers, balances/positions, or full
private payloads. Logs may correlate a trace and receipt ID with a dataset
family, but must not log the private data represented by the receipt.

External/provider errors cross trust boundaries only through fixed taxonomies.
CCXT labels are an exact allowlist of known class names; mutable or hostile
`Error.name` text collapses to `error`, and logs likewise retain only a bounded
error type rather than raw messages or codes.

## v1 coverage

The bounded v1 slice covers:

| Family | Evidence boundary |
| --- | --- |
| Quote and history | Provider observations with source time and units |
| Funding and open interest | Snapshots and cross-venue derived boards |
| OI history / OI delta | Observations plus versioned positioning derivation |
| Liquidations | Observed events where supported; estimates remain explicitly derived |
| Venue arbitrage | Versioned net-of-fees derivation with input lineage |
| Cross-venue screener | Per-venue ticker sweeps unioned with a named aggregation basis |
| Options analytics | DVOL, term structure, and chain where provider capability allows |
| Read-only accounts | Balances, open orders, positions, and fills; no secret or value data in status |

The structural route registry records every numeric market/read-only-account
observation GET in the trust boundary as covered, not-applicable, or a temporary
exemption. Funding-history remains a legacy bare array for compatibility, but
each point carries an additive receipt. V1 leaves order-book, on-chain, the single-venue screener,
coin-universe, persisted account-event/equity projections, and single-order
lookup as explicit follow-up work. Those exemptions carry a reason and concrete
removal condition. They are not permission to claim live evidence without a
receipt. Account-key configuration metadata is outside the numeric evidence
boundary and remains protected by its existing authentication/privacy contract.

`FILLS` and `XQL` may show a browser-local slippage comparison when a locally
stored preview is available. That estimate is explicitly labeled
local/unreceipted/illustrative, rendered with muted styling, and excluded from
the derived fill aggregate receipt's methodology and coverage. Moving preview
evidence into a server-owned receipt is a bounded follow-up, not a hidden live
claim.

Net-of-fees arbitrage is unavailable unless fees, executable size, and aligned
timestamps are all known. A theoretical crossed book is not advertised as an
executable net opportunity. Liquidation estimates are never relabeled as
observed public liquidation events.

The liquidations feed additionally reports its own source coverage. Meta names
every venue the provider is configured to read, which of them the sweep actually
sampled, and the resulting `reporting / configured` ratio, so a single-venue read
is never presented as the market. Per-source availability and throttle state are
derived from declared venue capability, never from observed event volume: a quiet
market and a throttled feed are different claims. Per-source staleness is
three-state. A source that was read but produced no events, one whose newest
event is ahead of the evaluation clock, and one that was never sampled all report
unknown freshness rather than fresh. The staleness boundary is the `liquidations`
family's declared `maxAgeMs`, not an independent constant. Aggregate event totals
remain a lower bound across sampled venues; no correction factor is applied to
estimate unobserved liquidations.

The cross-venue screener sums reported volume across venues but never sums
price: venues are repeated observations of one quantity, so the aggregate is a
quote-volume-weighted estimate and the disagreement between venues is reported
separately as dispersion. Where no venue reports usable volume there are no
weights, and the unweighted median used instead is named on the row rather than
presented as the weighted figure. Rows record how many venues quote the symbol,
so a single-venue listing is never presented as a market-wide aggregate, and
dispersion stays unknown below two venues rather than reporting zero
disagreement. Exchange-reported turnover is published as a scale signal, not a
verified total.

Cross-venue liquidations are unioned, never averaged and never deduplicated.
Each venue's liquidations are disjoint observed events rather than repeated
observations of one quantity, so summation is the faithful reduction; averaging
would understate by the venue count and cross-venue deduplication would discard
real evidence. Every event in an aggregate carries the venue it was observed on.
The feed also reports how much more the union observed than the configured
primary venue alone. That ratio is evidence about one venue, not about the
market: the contributing feeds are independently throttled, so it is published
as a lower bound and never as a recovered total. When the primary venue observed
nothing the ratio is undefined and reported as unknown rather than as an
unbounded or invented value.

## Personal digest evidence

Personal P&L webhooks reuse the operator recap's `equityChange`, FIFO
`fillRecap`, and `topMovers` calculations; there is no second P&L authority.
The outbound envelope adds an explicit `available | empty | partial |
unavailable` state per section. A live account response with result-specific
partial-evidence limitations (omitted rows, unreadable secondary venue, or
missing quotes) is never summarized as “none,” and an equity series whose first
point falls inside the cadence window is partial rather than a claimed
full-window change. Synthetic/non-live account evidence remains unavailable in
the digest. Cadence claims preserve timing truth too: a restart can leave an
attempt `pending`, but never relabel it delivered or replay the window.

## Static demo

The browser-only demo uses deterministic synthetic receipts. The same fixture
identity and fixed source/observation instant produce repeatable receipt IDs.
Every response is visibly synthetic, and `/api/data/status` mirrors the
server's safe public shape. The demo does not contact an exchange or private
account.

## Operator guide

When a panel is stale or unavailable:

1. Open its provenance badge and inspect source-as-of, age, cache state,
   limitations, and any upstream receipt IDs.
2. Query `GET /api/data/status` using the same authenticated session. Compare
   the family capability with its current health; do not infer support from the
   provider-wide `live` flag.
3. For `stale`, compare age with maximum age and check whether a cache hit is
   preserving an older source observation. A service restart does not make old
   source data fresh.
4. For `unavailable`, read the capability and sanitized category. Unsupported
   is a normal declared state; transport, malformed upstream data, and auth
   failures are operational errors and are not silently rewritten as ordinary
   unsupported data.
5. For `derived`, inspect every input receipt. Repair the stale/unknown required
   input before trusting the output.

Do not paste secrets or raw private-provider responses into issues. Report the
provider/family, receipt ID, trace ID, timestamps, state, and sanitized category.

## Contributor checklist

When adding a provider or dataset family:

1. Add or reuse the shared value type and an optional `DataReceipt` attachment.
2. Declare the capability once in the provider manifest: support, auth mode,
   source mode, venue/coverage, cadence, TTL, methodology, and caveats.
3. Build observed receipts at the provider boundary. Keep missing evidence
   unknown and distinguish unsupported capability from upstream failure.
4. At API composition/cache boundaries, preserve source time and ID, record
   cache facts, add trace correlation, and create versioned lineage for derived
   results.
5. Register every new high-risk GET in the structural coverage registry with a
   receipt family or a narrow, actionable temporary exemption.
6. Add a Source Inspector badge at the compact UI evidence boundary. Render
   missing values as unknown and never use green for unknown freshness.
7. Add deterministic, network-free fixtures and run the provider conformance
   kit. Cover schema validation, TTL boundaries, clock skew, unavailable and
   malformed upstream states, lineage, cache semantics, and secret redaction.
8. Run the full repository gates documented in `CONTRIBUTING.md`. Confirm that
   `POST /api/orders` is still held and cancel-only ownership behavior is
   unchanged.
