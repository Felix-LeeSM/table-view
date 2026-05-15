# Sprint 338 Handoff — U3 live wire (Collection stats)

날짜: 2026-05-15

## 결과

- 신규 backend: 2 trait method (`RdbAdapter::collection_stats` default
  `Unsupported`, `DocumentAdapter::collection_stats` required) + PG
  override + Mongo impl + 2 paradigm-aware Tauri commands
  (`collection_stats_rdb` / `collection_stats_mongo`).
- 신규 model `CollectionStatsRow` (camelCase wire, `extras: HashMap`
  for paradigm-specific fields).
- 신규 frontend: `collectionStatsRdb` / `collectionStatsMongo` wrappers
  (`@/lib/api/collectionStats`) + `CollectionStatsPanel` live wire
  (grid + Refresh + extras section).
- 회귀: 0. ExplainViewer / ServerActivityPanel 통과.
- `cargo clippy ... -D warnings` exit 0.
- `pnpm vitest run --no-coverage` — 3795 통과 / 10 skipped (sprint-337
  3792 → +3; sprint 327 placeholder 1 case 가 4 신규로 교체).
- tsc / lint exit 0.

## 변경 파일

### Backend
- `src-tauri/src/models/query.rs` + `src-tauri/src/models/mod.rs` —
  `CollectionStatsRow` 신규.
- `src-tauri/src/db/traits.rs` — 2 trait method.
- `src-tauri/src/db/postgres.rs` — trait dispatch wire.
- `src-tauri/src/db/postgres/schema.rs` — `collection_stats` inherent
  (`pg_stat_user_tables` + `pg_total_relation_size` + `pg_indexes`)
  + 4 unit case.
- `src-tauri/src/db/mongodb.rs` — trait dispatch wire.
- `src-tauri/src/db/mongodb/schema.rs` — `collection_stats_impl`
  (`runCommand({collStats})` → row + Mongo-only extras) + 3 unit case.
- `src-tauri/src/db/testing.rs` — RDB + Document stub slots
  (`collection_stats_fn`).
- `src-tauri/src/db/tests.rs` — DummyDocument + FakeCancellableDocument
  `collection_stats` 추가 + 1 default Unsupported 단언 (RdbAdapter).
- `src-tauri/src/commands/meta.rs` — `collection_stats_rdb` /
  `collection_stats_mongo` commands + `_inner` helpers + 6 unit case
  (3 paradigm × 2 commands).
- `src-tauri/src/lib.rs` — invoke_handler 2 등록.

### Frontend
- `src/lib/api/collectionStats.ts` (NEW) — wrappers +
  `CollectionStatsRow` TS type.
- `src/components/document/CollectionStatsPanel.tsx` — placeholder
  제거, live grid (rows / sizeBytes / indexes / lastVacuum /
  lastAnalyze / seqScans / idxScans / nDead / extras) + Refresh.
- `src/components/document/CollectionStatsPanel.test.tsx` — 4 case
  (RDB happy + Mongo dispatch + error alert + refresh re-fetch).

## 의사결정

- **D-95**: PG 통계는 `pg_stat_user_tables` (n_live_tup, n_dead_tup,
  seq_scan, idx_scan, last_vacuum, last_analyze) + `pg_total_relation_size`
  + `pg_indexes` COUNT 3 query 로 합성. `pg_stat_user_tables` 만으로는
  size / index 카운트가 불완전.
- **D-96**: Mongo `collStats` 응답에서 PG slot 으로 직접 매핑되는 필드
  (`count`, `storageSize`, `nindexes`) 만 hard-map. Mongo-only 필드
  (`capped`, `avgObjSize`, `totalIndexSize`, …) 는 `extras` HashMap
  으로 surface — paradigm leakage 명시.
- **D-97**: `collection_stats_rdb` / `collection_stats_mongo` 는 hard-
  paradigm command (paradigm-neutral wrapper 없음). 두 input shape 이
  다르고 caller (frontend) 가 이미 paradigm 을 알고 있어 dispatch 비용이
  없다.
- **D-98**: row count 는 `n_live_tup` (approximate). 정확한 COUNT(*) 은
  full scan 비용이라 의도적으로 회피 — 통계 패널은 advisory.

## 다음

- **Sprint 339** — Mongo `buildInfo` + `serverStatus` + RDB pg_settings (U4).
- **Sprint 340** — Mongo `system.profile` + RDB pg_stat_statements (U5).
