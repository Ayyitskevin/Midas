# AI-assisted development policy

Midas is developed with substantial AI assistance. This policy distinguishes
the provenance of code changes from the optional product AI copilot.

## Accountability

The repository owner is the maintainer and decision-maker. An AI agent may
propose, implement, test, review, or document a change; it cannot accept legal
risk, own a credential, approve an exchange or billing boundary, or replace the
human merge decision required by
[`AGENTS.md`](https://github.com/Ayyitskevin/Midas/blob/main/AGENTS.md).

Material AI participation should be visible in the pull request description,
commit trailers, or both. Disclosure must never include a private conversation,
credential, customer data, or account identifier.

## Evidence standard

An AI-authored change meets the same or stronger bar as any other change:

1. identify the exact problem and keep the scope narrow;
2. inspect repository instructions and the affected trust boundary first;
3. add or update a regression test for the invariant;
4. run the focused check and the repository gates appropriate to the risk;
5. state what was not tested and why;
6. document rollback and remaining limitations;
7. leave human-gated changes unmerged for the maintainer.

Generated prose is not evidence. A confident explanation cannot replace a
reproducible test, a source-backed data contract, a security assertion, or a
manual artifact from the environment that actually matters.

## Data and tool boundaries

Agents must not receive or expose:

- exchange API keys, `ANTHROPIC_API_KEY`, session tokens, signing keys, or `.env`
  contents;
- real balances, positions, orders, fills, workspace snapshots, or webhook
  payloads;
- private operational logs containing identifiers;
- live provider responses in fixtures or screenshots.

Tests and demos use synthetic/disposable state. External writes—GitHub changes,
deployments, exchange actions, webhooks, billing, or hosted state—must stay
inside the user's explicit request and the repository's safety contract.

## Product AI is a separate boundary

The `AI` copilot is optional and dormant without `ANTHROPIC_API_KEY`. When
enabled, it is an outbound, paid request with bounded message count, bounded
prompt size, per-caller rate limiting, and a data context assembled from the
current terminal view. It is an analyst aid, not an execution authority or
investment adviser. CI and the static demo never call the live model.

Product AI must not:

- place, cancel, or authorize an order;
- receive exchange secrets or private keys;
- silently turn synthetic/unavailable data into a live claim;
- persist a generated answer as trusted market evidence without a human decision.

## Review discipline

AI reviews should prioritize falsifiable correctness over volume. Findings name
the affected behavior, concrete evidence, severity, and smallest safe next step.
Agents should not manufacture issues to appear useful or declare launch readiness
from unit tests alone. A draft pull request is the coordination and approval
boundary for agent-authored changes.
