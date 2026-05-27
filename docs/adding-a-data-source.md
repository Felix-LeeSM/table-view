# Adding A Data Source

This guide is the contributor checklist for adding or promoting a DBMS/data
source. Do not start implementation until the sprint or phase contract answers
every required contract below.

Architecture source of truth:

- `docs/data-source-architecture.md`
- ADR 0046: `docs/archives/decisions/0046-data-source-profile-capability-architecture/memory.md`
- Active sequencing: `docs/PLAN.md`
- Long-term ordering: `docs/ROADMAP.md`

## Before Coding

The contract must state the target support level and the evidence that will
prove it. If the source is only a prototype, label it as fixture-only,
read-only, or unsupported instead of implying full support.

Required answers:

| Contract | Required answer |
|---|---|
| Profile | Concrete `DatabaseType` identity, `DataParadigm`, support level, and whether the profile is active, fixture-only, or backlog. |
| Connection | `ConnectionKind`, required fields, credential handling, TLS/auth modes, local-file permission scope, and any unsupported modes. |
| Adapter | Existing adapter family to use, or the new adapter contract that must be defined before runtime work. |
| Language | `QueryLanguageId`, parser owner, completion owner, safety analyzer, fallback policy, and `docs/query-language-support.md` updates. |
| Catalog | Catalog namespace model: schema/table, collection/index, key/type/TTL, index/mapping, graph labels, vector collections, or another explicit model. |
| Result envelope | Declared result kinds such as `tabular`, `document`, `keyValue`, `searchHits`, `graph`, `vectorNeighbors`, `streamRecords`, or `metrics`. |
| Safety policy | Destructive actions, expensive reads, partition/access-pattern guards, preview/confirmation path, and unsupported dangerous operations. |
| Fixtures | Local fixture, embedded sample, testcontainer, emulator, or mock strategy. Paid cloud services cannot be the only verification path. |
| Conformance | Declared conformance level for connection, catalog, query, result, edit, and safety behavior. Unsupported/deferred surfaces must be explicit. |
| Docs | Updates or no-op rationale for `docs/PLAN.md`, `docs/ROADMAP.md`, `docs/product/README.md`, `docs/product/known-limitations.md`, `docs/data-source-architecture.md`, `docs/query-language-support.md`, contributor follow-up docs, and sprint docs. |

## Capability Rules

Feature enablement must come from the profile/capability contract, not scattered
`dbType` checks. A missing capability means the UI hides or disables the feature
with a clear fallback; it must not become an optimistic runtime failure.

Acceptable uses of `DatabaseType` are identity, fixture selection, dialect
family mapping, and compatibility boundaries. Avoid adding a new source by only
extending `DatabaseType`, switch statements, and renderer special cases.

`queryMode` is legacy compatibility for old tabs/history. New query routing
uses `queryLanguage`, and result rendering uses typed result envelopes.

## ADR Gate

Create a new ADR before implementation when the work changes a durable decision
or needs a new architecture contract. Common triggers:

- new paradigm or adapter family
- reversal or supersession of an accepted ADR
- new result envelope or catalog model kind
- new safety model for destructive, expensive, or privacy-sensitive operations
- moving parser/completion ownership away from the existing Rust/WASM or
  compatibility boundary
- promoting a prototype/fixture-only path into active product behavior with
  different guarantees

No new ADR is needed for a profile that fits an accepted paradigm, existing
adapter family, existing result envelope, existing safety policy, and current
roadmap order. Record that no-op rationale in the sprint contract or handoff.

## Implementation Order

1. Lock the profile, capability, language, catalog, result, safety, fixture,
   conformance, and docs answers in the sprint contract.
2. Add or update the profile and adapter contract before UI surfaces depend on
   it.
3. Gate UI commands and panels by capability lookup, not `dbType`.
4. Route editor behavior through `queryLanguage`; keep legacy `queryMode` only
   at compatibility boundaries.
5. Return declared result envelopes and add renderers only for those envelopes.
6. Add fixture/conformance evidence for each support claim.
7. Update active docs by linking to this guide and recording only source-specific
   deltas.

## Handoff Checklist

The sprint handoff should include:

- profile and support level selected
- capabilities supported, unsupported, and deferred
- language, catalog, result envelope, and safety policy decisions
- fixture/conformance evidence and commands run
- ADR decision: new ADR path, existing ADR link, or no-op rationale
- docs updated and any active risk created or referenced
