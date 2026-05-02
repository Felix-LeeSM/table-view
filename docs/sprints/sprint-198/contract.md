# Sprint 198 — Contract

Sprint: `sprint-198` (feature — Mongo bulk-write 3 신규 command +
analyzer + UI 진입점).
Date: 2026-05-02.
Type: feature (Sprint 197 mutations.rs 토대 위에서 surface 확장).

`docs/refactoring-plan.md` Sprint 198 row + `docs/PLAN.md` 의 Mongo
write-path 확장. Sprint 80 이 single-document mutation 3 종을 깐 후
1.5 년 만에 bulk-write surface 합류 — TablePlus / Compass 사용자가
"row 한 줄씩만 수정" 이상의 워크플로우를 끊김 없이 진행할 수 있게
한다.

본 sprint 종료 = `docs/refactoring-plan.md` 의 Sprint 189–198 sequencing
완료. `docs/refactoring-smells.md` 와 `docs/refactoring-plan.md` 모두
Sprint 198 종료 후 retire (시한부 docs).

## Sprint 안에서 끝낼 단위

### Backend (Rust)

- `DocumentAdapter` trait 에 3 method 추가:
    - `delete_many(db, collection, filter)` → `u64` (deleted_count)
    - `update_many(db, collection, filter, patch)` → `u64` (modified_count)
    - `drop_collection(db, collection)` → `()`
- `mongodb/mutations.rs` 에 inherent `_impl` × 3 추가 (Sprint 197 패턴
  유지).
- `commands/document/mutate.rs` 에 Tauri command 3 종 추가.
- 각 사이트 unit test (no-connection / empty ns / patch `_id` reject /
  mismatch count → driver 결과 그대로 surface).

### Frontend analyzer

- `src/lib/mongo/mongoSafety.ts` 에 `analyzeMongoOperation(op)` 신규
  추가. operation shape:
    ```ts
    type MongoOperation =
      | { kind: "deleteMany"; filter: Record<string, unknown> }
      | { kind: "updateMany"; filter: Record<string, unknown>; patch: Record<string, unknown> }
      | { kind: "dropCollection" };
    ```
- 위반 분류:
    - `dropCollection` → 항상 `danger`.
    - `deleteMany` with empty filter (`{}`) → `danger` (whole collection
      delete).
    - `updateMany` with empty filter → `danger` (whole collection mass
      update).
    - 그 외 (filter 가 non-empty) → `safe`.
- 기존 `analyzeMongoPipeline` 와 같은 `StatementAnalysis` shape 반환 —
  `useSafeModeGate.decide(analysis)` 가 paradigm 무관하게 호출 가능.

### Frontend tauri shims (`src/lib/tauri.ts`)

- `deleteMany(connectionId, database, collection, filter)` →
  `Promise<number>`
- `updateMany(connectionId, database, collection, filter, patch)` →
  `Promise<number>`
- `dropCollection(connectionId, database, collection)` →
  `Promise<void>`

### UI 진입점 결정 — sidebar context menu + DocumentDataGrid toolbar

audit 결과 3 명령은 의도가 다름:

| 명령 | 자연스러운 UX | 진입점 |
|------|---------------|--------|
| `dropCollection` | RDB `dropTable` 와 1:1 평행. 단일 collection 자체를 통째로 제거. | SchemaTree (또는 Mongo 측 collection 노드) 의 right-click context menu. |
| `deleteMany(filter)` | "현재 활성 filter 와 일치하는 모든 doc 삭제". DocumentDataGrid 의 `activeFilter` 를 그대로 인자로. | DocumentDataGrid toolbar 의 "Delete matching" 버튼. |
| `updateMany(filter, patch)` | "현재 filter 와 일치하는 doc 들에 동일 patch 적용". | DocumentDataGrid toolbar 의 "Update matching" 버튼 + patch 입력 dialog. |

3 사이트 모두 commit 직전 `analyzeMongoOperation` → `useSafeModeGate.
decide(analysis)` → block / warn-confirm / allow 분기. 성공/실패는
queryHistoryStore (Sprint 196) 에 `source: "mongo-op"` entry 1 개로
기록.

### 회귀 0 + 신규 case 가산

- pre-sprint baseline: 187 files / 2719 tests (frontend) + 338 lib tests
  (backend).
- 신규 추가 후 baseline: frontend 191+ files (각 새 analyzer / shim /
  toolbar / dialog 별) / 2740+ tests; backend 350+ tests (각 _impl 3
  smoke + helper).

## Acceptance Criteria

### AC-198-01 — Trait + adapter 메서드 3 추가

- `DocumentAdapter` trait 에 `delete_many` / `update_many` /
  `drop_collection` 3 method 추가.
- `MongoAdapter` 의 inherent `mutations.rs` 에 `_impl` × 3 + `mongodb.rs`
  trait dispatch.
- 각 method:
    - `validate_ns(db, coll)` 로 empty ns 차단.
    - `update_many` 가 `_id` in patch 거부 (single-doc 동일 contract).
- 단위 test: no-connection / empty-ns / `_id`-in-patch (update_many) 5
  case 이상.

### AC-198-02 — Tauri command 3 종 추가

- `commands/document/mutate.rs` 에 `#[tauri::command]` 3 종 — 기존
  `insert_document` shape 그대로 (state lookup → `as_document()?` →
  trait method dispatch).
- `commands/mod.rs` `tauri::generate_handler!` 에 등록 — 1 줄씩 추가.
- ipc-bridge / mock dispatcher (`commands/meta.rs::tests`) 에 trait
  method 시그니처 미러 추가 (no-op stub OK — empty body 로 trait
  완성).

### AC-198-03 — `analyzeMongoOperation` analyzer 신설

- `src/lib/mongo/mongoSafety.ts` 에 신규 export.
- 4 시나리오 case 테스트:
    1. `dropCollection` → `severity: "danger"`, `kind: "mongo-drop"`.
    2. `deleteMany({})` (empty filter) → `severity: "danger"`,
       `kind: "mongo-delete-all"`.
    3. `updateMany({}, ...)` → `severity: "danger"`,
       `kind: "mongo-update-all"`.
    4. `deleteMany({ _id: ... })` (non-empty filter) →
       `severity: "safe"`.

### AC-198-04 — Frontend tauri shims 3 종

- `src/lib/tauri.ts` 에 3 신규 export. invoke 키 = command 이름과 동일
  (`delete_many` / `update_many` / `drop_collection`).
- `deleteMany` / `updateMany` 가 결과 count 반환 (UI toast 노출용),
  `dropCollection` 은 `void`.

### AC-198-05 — UI 진입점 wiring

- **SchemaTree** (Mongo branch) — collection 노드 right-click → "Drop
  Collection" context menu item. RDB 의 `handleDropTable` 패턴
  답습 — `confirmDialog` → `useSafeModeGate.decide(analyzeMongoOperation
  ({ kind: "dropCollection" }))` → `dropCollection(...)` →
  `addHistoryEntry({ source: "mongo-op", ... })`.
- **DocumentDataGrid toolbar** — 2 신규 버튼 ("Delete matching" /
  "Update matching"). 둘 다 현재 `activeFilter` 가 인자. updateMany 는
  patch 입력 dialog 추가. 양쪽 모두 Safe Mode gate.
- 각 사이트 success/error 시 history 등재 (Sprint 196 패턴).

### AC-198-06 — 회귀 0 + 신규 case 가산

- `pnpm vitest run` — 기존 case 무수정 통과, 신규 case 만 가산.
- `pnpm tsc --noEmit` 0 / `pnpm lint` 0.
- `cargo fmt` 0 / `cargo clippy` 0 / `cargo test --lib` baseline + 신규
  case.

## Out of scope

- `dropDatabase` (database-level) — 현 sprint 는 collection-level 만.
  scope 차이가 크고 confirm UX 도 달라 별 sprint.
- bulkWrite (mixed insert/update/delete in one round-trip) — 단일 op
  3 종으로 P0 cover. mixed 는 후속.
- partial-success 처리 — Mongo 의 `update_many` 가 일부 doc 만 match
  실패해도 전체 op 은 success 로 반환 (modified_count 만 반영). UI 가
  count 를 toast 로 보여주는 선에서 충분, 실패 row 추적 X.
- aggregate-stage `$merge` / `$out` — 이미 Sprint 188 (analyzeMongo
  Pipeline) cover.
- index drop / rename collection — 별 sprint 후보 (`docs/RISKS.md` 가
  스코프 결정).

## 검증 명령

```sh
cd src-tauri
cargo fmt -- --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --lib

cd ..
pnpm vitest run src/lib/mongo/mongoSafety.test.ts \
  src/components/document/DocumentDataGrid.test.tsx \
  src/components/schema/SchemaTree.preview.entrypoints.test.tsx
pnpm vitest run
pnpm tsc --noEmit
pnpm lint
```

기대값: 모두 zero error. baseline 가산 (frontend +20+ case, backend +5
case 이상).
