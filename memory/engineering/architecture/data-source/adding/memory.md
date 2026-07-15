---
title: Adding A Data Source
type: checklist
updated: 2026-06-12
surface: src-tauri/src/db/**, src/types/dataSource*, src/types/queryLanguage*, tests/fixtures/**
task: data-source, support-claim, adapter, fixture
trigger:
  signal: DBMS 추가 / source promotion / fixture-backed slice 승격
  layer: index
---

# Adding A Data Source

새 DBMS/data source 구현은 sprint/phase contract 가 아래 답을 모두 잠근 뒤 시작한다.
Prototype 이면 `fixture-only`, `fixture-backed`, `read-only`, `unsupported` 를
명시하고 full support 처럼 쓰지 않는다.

## Required Contract

| Contract        | Required answer                                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Profile         | `DatabaseType`, `DataParadigm`, support level, active/fixture-only/backlog 여부                                           |
| Connection      | `ConnectionKind`, required fields, credentials, TLS/auth, file permission scope, unsupported modes. driver connect/ping error 는 `AppError::connection_redacted` 경유 (#1453) |
| Adapter         | existing adapter family 또는 먼저 정의할 new adapter contract                                                             |
| Language        | `QueryLanguageId`, parser owner, completion owner, safety analyzer, fallback policy                                       |
| Catalog         | schema/table, collection/index, key/type/TTL, index/mapping, graph labels, vector collections 등 explicit model           |
| Result envelope | `tabular`, `document`, `keyValue`, `searchHits`, `graph`, `vectorNeighbors`, `streamRecords`, `metrics` 중 declared kinds |
| Safety policy   | destructive action, expensive read, partition/access guard, preview/confirmation, unsupported dangerous operation         |
| Fixtures        | local fixture, embedded sample, testcontainer, emulator, or bounded mock strategy                                         |
| Conformance     | connection/catalog/query/result/edit/safety coverage 와 unsupported/deferred surfaces                                     |
| Docs/memory     | product/roadmap/architecture/contributor/memory update 또는 no-op rationale                                               |

## Capability Rules

Feature enablement 은 profile/capability contract 에서 온다. `DatabaseType` 의 허용
용도는 identity, fixture selection, dialect family mapping, compatibility boundary
뿐이다.

`queryMode` 는 old tab/history compatibility 이다. 새 query routing 은
`queryLanguage`, result rendering 은 typed result envelope 를 쓴다.

## ADR Gate

다음이면 구현 전 ADR 이 필요하다.

- new paradigm or adapter family
- accepted ADR 의 reversal/supersession
- new result envelope or catalog model kind
- destructive/expensive/privacy-sensitive safety model 변경
- parser/completion ownership 을 Rust/WASM 또는 compatibility boundary 밖으로 이동
- prototype/fixture-only path 를 active product behavior 로 승격하면서 guarantee 변경

기존 paradigm, adapter family, envelope, safety policy, roadmap order 안에 들어가는
profile 은 새 ADR 없이 sprint contract 에 no-op rationale 을 남긴다.

## Implementation Order

1. profile/capability/language/catalog/result/safety/fixture/conformance/docs 답을 lock.
2. profile 과 adapter contract 를 UI 의존보다 먼저 추가.
3. UI command/panel 은 capability lookup 으로 gate.
4. Editor behavior 는 `queryLanguage` 로 route.
5. Declared envelope 만 반환하고 renderer 를 추가.
6. support claim 별 fixture/conformance evidence 를 추가.
7. active SOT 를 업데이트하고 source-specific delta 만 남긴다.

## Handoff Checklist

- profile/support level
- supported/unsupported/deferred capabilities
- language/catalog/result/safety decisions
- fixture/conformance evidence and commands
- ADR path, existing ADR link, or no-op rationale
- updated SOT paths and follow-ups

## Related

- [data-source architecture](../memory.md)
- [query language](../../query-language/memory.md)
- [fixture strategy](../../../conventions/testing-scenarios/fixtures/memory.md)
