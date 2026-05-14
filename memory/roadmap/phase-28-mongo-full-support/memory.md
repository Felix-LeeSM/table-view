---
title: Phase 28 — MongoDB Full Support grill 결정
type: decision-log
updated: 2026-05-14
---

# Phase 28 — MongoDB Full Support grill 결정

2026-05-14 `/grill-me` 세션에서 lock 된 Q1–Q36 결정 dict. Phase 28 의
sprint planning input. 정의서:
[`docs/phases/phase-28.md`](../../../docs/phases/phase-28.md).

## 결정 표 (lock)

| Q | 결정 |
|---|------|
| A. Connection | RDBMS 동일 (form-only) |
| B. Sidebar | Collections + Views + Indexes 3 노드 |
| Validator | StructurePanel Constraints 슬롯, paradigm 분기 |
| Q4. Bulk + Txn | bulkWrite + transaction toggle, default ON, per-conn persist |
| Q5. Update operator | DataGrid `$set` / QuickLook advanced (`$inc/$push/$pull/$unset`), pendingEdits `{value, operator}` |
| Q6. `_id` | 수정 차단 (UI disabled + tooltip) |
| Q7. Filter ops | 13 ops 빈도순 |
| Q8. Sort | Multi-column + column header context menu (RDB+Mongo) |
| Q9+Q10. Hide column | Hybrid trigger + 상단 배지 + per-collection persist |
| Q11. Count | 항상 정확 (`countDocuments`) |
| Q12. Schema | Client-side accumulator, `—` placeholder, `_id` first → 발견순 → 알파벳, Drop key cell action |
| Q13. Type | QuickLook 에서만 per-field BSON type label |
| Q14+15+Find | Unified mongosh editor — toggle 제거, `db.coll.method(args)`, mini parser (mongosh LSP sidecar/WASM), `+ Insert ▾` 4 section |
| Q16. Indexes | `$indexStats` 컬럼 (Ops/Since) |
| Q17. Views | List + create + drop. RDB Views 와 + 버튼 통합 |
| Q18. DDL | Standard CRUD + Capped/Time-series form + DB drop confirm + DB create wrapper |
| Q19. Nested 편집 | Hybrid + 컬럼 헤더 `⋯` 버튼 1-depth expand, dot-notation `$set` |
| Q20. BSON editor | ObjectId 생성기 / ISODate picker (RDB TIMESTAMP 공유) / Decimal128 / BinData. 나머지 raw |
| Q21. Field projection | Hide 와 별개 — filter bar 옆 `Fields ▾` 다이얼로그 |

## Skip 항목

| Q | 사유 |
|---|------|
| Q22. Sample preview | DataGrid + StructurePanel + `findOne` 으로 커버 |
| Q23. Change streams | `db.coll.watch()` 는 Query Editor raw 호출. RDB LISTEN/NOTIFY 도 미구현 (paradigm 일관) |
| Q25. Multi-doc txn | `session.startTransaction()` 은 Query Editor raw 호출 |
| Q33. Backup / Restore | `mongodump`/`pg_dump` CLI 영역, no follow-up |
| Q34. GridFS | 사용자 base 좁음 (S3 등 cloud storage 가 표준) |

## 후속 (별도 phase)

| Q | 후속 위치 |
|---|---------|
| Q24. currentOp/killOp | [unified-followups U1](../unified-followups/memory.md) |
| Q26. explain() | [unified-followups U2](../unified-followups/memory.md) |
| Q27. Collection stats | [unified-followups U3](../unified-followups/memory.md) |
| Q28. Server info | [unified-followups U4](../unified-followups/memory.md) |
| Q29. Profiler / slow query | [unified-followups U5](../unified-followups/memory.md) |
| Q30. User/Role | Phase 30 후보 — threat-model 핸드오프 후 grill 재개 |
| Q31. Auth mechanism | Phase 30 후보 — threat-model 핸드오프 후 grill 재개 |
| Q32. Replica set/sharding 상태 | U4 (Server info) 안에 흡수 |
| Q35–Q36. Paradigm 비대칭 | 위 결정으로 자연 흡수 |

## Slice 분해 (13)

A (unified editor) → E (schema) → F (nested ⋯) → B (filter ops) → C
(sort) → G (BSON editors, RDB TIMESTAMP 컴포넌트 추출 선행) → D (hide)
→ H (projection) → I (bulk+txn+`$set`+`_id` 차단) → J (indexes +
`$indexStats`) → K (validator + views + RDB 통합) → L (collection DDL) →
M (DB CRUD).

상세: [phase-28.md](../../../docs/phases/phase-28.md).

## 관련 방

- [roadmap](../memory.md)
- [unified-followups](../unified-followups/memory.md)
