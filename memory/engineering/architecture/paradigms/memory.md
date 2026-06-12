---
title: Paradigm UI Heuristics
type: historical-note
updated: 2026-06-12
---

# Paradigm UI Heuristics

이 방은 RDB / Document / Search / KV UI heuristic 만 보존한다. Search, Redis,
Valkey support state 나 runtime evidence 의 SOT 가 아니다.

Current SOT:

- Product support: [docs/product/README.md](../../../../docs/product/README.md)
- Evidence matrix: [docs/contributor-guide/testing-and-quality.md](../../../../docs/contributor-guide/testing-and-quality.md)
- Architecture boundary: [data-source](../data-source/memory.md)
- Future promotion order: [docs/ROADMAP.md](../../../../docs/ROADMAP.md)

Historical source: 구 `docs/paradigm-ui-map.md` (2026-04-24) 압축본. Old Phase
7/8 sprint labels, "P0/P2" labels, and frozen wording are historical context only.

## Durable Heuristics

- Start with user question -> UI slot. Do not invent a generic feature before the
  paradigm-specific inspection question is clear.
- Paradigm first-class concepts must show in the UI: RDB column type, Document
  document shape, Search index/mapping/score/highlight, KV key/type/TTL.
- Reuse existing slots only when the paradigm semantics stay visible. Add a new
  slot when reuse hides the main navigation/query axis.
- Dangerous actions use source-specific preview/confirmation/safety contracts.
  Exact wording and support level live with product docs and source-specific code.
- Search UI thinking: index/data stream/alias -> mapping/field paths -> bounded
  search hits/aggregations/sort/source/highlight. Active/deferred support is not
  decided here.
- KV UI thinking: database/key namespace -> key type/TTL -> type-aware value
  preview/edit -> bounded command result. Redis and Valkey claims stay separate.

## Not SOT For

- Whether Elasticsearch/OpenSearch live HTTP, admin APIs, or delete-by-query
  execution are supported.
- Whether Redis/Valkey command families, mutation controls, or compatibility rows
  are supported.
- Future sprint IDs, old phase labels, or promotion sequencing.

## Related

- [architecture](../memory.md)
- [conventions](../../conventions/memory.md)
