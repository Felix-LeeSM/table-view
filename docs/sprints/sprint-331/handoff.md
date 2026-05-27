# Sprint 331 Handoff — DB-Scope ADR closure (ADR 0030)

날짜: 2026-05-15

## 결과

- ADR 0030 채택 — Mongo DB-scope tab-local 패턴 영구 동결.
- Sprint 328~330 의 frontend 변경이 ADR 로 권위화.
- 회귀: 0 (frontend 변경 없음).

## 변경 파일

- `docs/archives/decisions/0030-mongo-db-scope-tab-local/memory.md` (NEW)
- `docs/archives/decisions/memory.md` — 인덱스 +1 row, `updated: 2026-05-15`.

## 라인업 update (Sprint 327 D-72 +3 shift)

| 후속 Sprint | 작업 |
| --- | --- |
| 332 | Mongo `list_indexes` + `$indexStats` (Slice J live wire) |
| 333 | Mongo `collMod {validator}` (Slice K live wire) |
| 334 | Mongo `createCollection` / `renameCollection` (Slice L live wire) |
| 335 | RDB/Mongo CREATE/DROP DATABASE (Slice M live wire) |
| 336 | Mongo `currentOp` / `killOp` + RDB pg_stat_activity (U1 live wire) |
| 337 | Mongo `cursor.explain()` + RDB EXPLAIN ANALYZE (U2 live wire) |
| 338 | Mongo `collStats` + RDB pg_stat_user_tables (U3 live wire) |
| 339 | Mongo `buildInfo` + `serverStatus` + RDB pg_settings (U4 live wire) |
| 340 | Mongo `system.profile` + RDB pg_stat_statements (U5 live wire) |

## 다음

Sprint 332 — Mongo `list_indexes` Tauri wrapper + IndexesPanel (Sprint 327
placeholder) live wire.
