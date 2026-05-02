# Sprint 198 — Handoff

Sprint: `sprint-198` (feature — Mongo bulk-write 3 신규 command + analyzer
+ UI 진입점).
Date: 2026-05-02.
Status: closed.
Type: feature (Sprint 197 mutations.rs 토대 위에서 surface 확장).

## 어디까지 했나

Sprint 80 이 single-document mutation 3 종을 깐 후 1.5 년 만에 bulk-write
surface 합류. `DocumentAdapter` trait 에 `delete_many` / `update_many` /
`drop_collection` 3 method 추가, `MongoAdapter` 의 `_impl` 3 + thin
dispatch 3, Tauri command 3 종, 프론트 analyzer / shim / UI 진입점 3 곳
모두 wiring 완료. Safe Mode gate 가 paradigm 무관하게 3 명령을 dispatch.

본 sprint 종료 = `docs/refactoring-plan.md` 의 Sprint 189–198 sequencing
완료. Sprint 198 종료 후 `docs/refactoring-plan.md` 와
`docs/refactoring-smells.md` 모두 retire 대상 (시한부 docs).

## Files changed

### Backend (Rust)

| 파일 | Purpose |
|------|---------|
| **MOD** `src-tauri/src/db/mod.rs` | `DocumentAdapter` trait 에 3 method 추가 + 2 mock dispatcher (`DummyDocument`, `FakeCancellableDocument`) 에 stub 추가 |
| **MOD** `src-tauri/src/db/mongodb.rs` | `impl DocumentAdapter for MongoAdapter` 에 3 thin dispatch 추가 (Box::pin async move) |
| **MOD** `src-tauri/src/db/mongodb/mutations.rs` | `_impl` × 3 (`delete_many_impl` / `update_many_impl` / `drop_collection_impl`) + 7 신규 test case |
| **MOD** `src-tauri/src/commands/document/mutate.rs` | `#[tauri::command]` × 3 — `delete_many` / `update_many` / `drop_collection` |
| **MOD** `src-tauri/src/commands/meta.rs` | 3 mock dispatcher (`StubDocumentAdapter`, `ErroringDocumentAdapter`, `StubDocVerify`) 에 stub 추가 |
| **MOD** `src-tauri/src/lib.rs` | `tauri::generate_handler!` 에 3 command 등록 |

### Frontend (TS / React)

| 파일 | Purpose |
|------|---------|
| **MOD** `src/lib/sql/sqlSafety.ts` | `StatementKind` union 에 5 mongo bulk-write variants (`mongo-drop` / `mongo-delete-all` / `mongo-delete-many` / `mongo-update-all` / `mongo-update-many`) |
| **MOD** `src/lib/mongo/mongoSafety.ts` | `analyzeMongoOperation` + `MongoOperation` discriminated union export |
| **MOD** `src/lib/mongo/mongoSafety.test.ts` | 5 신규 case (AC-198-03a/b/c/d/e) |
| **MOD** `src/lib/tauri.ts` | `deleteMany` / `updateMany` / `dropCollection` shims |
| **MOD** `src/components/datagrid/DataGridToolbar.tsx` | `bulkOpsSlot` prop 추가 (export slot 직전 렌더) |
| **MOD** `src/components/document/DocumentDataGrid.tsx` | `useSafeModeGate` + `bulkOpsSlot` (Trash2 + FileEdit 버튼) + 2 dialog (delete confirm + update patch) + 2 handler callback |
| **MOD** `src/components/schema/DocumentDatabaseTree.tsx` | collection 노드 ContextMenu wrap + Drop Collection menu item + confirm dialog + `handleDropCollectionRequest` / `handleConfirmDropCollection` |
| **NEW** `docs/sprints/sprint-198/findings.md` | UX 분기 결정 / analyzer kind 확장 / `_id` 거절 contract / mock 분포 / 검증 |
| **NEW** `docs/sprints/sprint-198/handoff.md` | 본 파일 |

총 코드: 11 modified + 0 created (코드). docs 2 신설 (contract.md 는 이미 존재).

## AC 별 evidence

| AC | 검증 | 증거 |
|----|------|------|
| AC-198-01 | `cargo test --lib` | 7 신규 mutations test 통과 — no-connection × 3 / empty-ns × 3 / `_id`-in-patch × 1. trait 에 3 method 추가, MongoAdapter `_impl` × 3 + dispatch × 3. |
| AC-198-02 | `cargo build` | 3 `#[tauri::command]` + `generate_handler!` 등록. mock dispatcher 5 곳 (commands/meta.rs × 3, db/mod.rs × 2) 동기 패치 — `cargo check` 0 error. |
| AC-198-03 | `pnpm vitest run src/lib/mongo/mongoSafety.test.ts` | 15 passed (10 pipeline + 5 신규 operation). 5 case = drop / deleteMany empty / updateMany empty / deleteMany non-empty / updateMany non-empty. |
| AC-198-04 | type check | `pnpm tsc --noEmit` 0 error. shim 3 export 가 invoke 키 (`delete_many` / `update_many` / `drop_collection`) 와 일치 — Tauri command name 과 동일. |
| AC-198-05 | full vitest | 187 files / 2724 tests passed. SchemaTree 측 RDB drop pattern + DocumentDatabaseTree 측 Mongo drop pattern 평행. DocumentDataGrid 측 toolbar 두 button + dialog. 3 사이트 모두 `useSafeModeGate.decide(analyzeMongoOperation(...))` → invoke → `addHistoryEntry({source: "mongo-op"})`. |
| AC-198-06 | 4-set 검증 | cargo fmt 0 / clippy 0 / cargo test --lib 345 passed (2 ignored) / vitest 2724 passed / tsc 0 / eslint 0. backend +7 / frontend +5. |

## Required checks (재현)

```sh
cd src-tauri
cargo fmt -- --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --lib

cd ..
pnpm vitest run src/lib/mongo/mongoSafety.test.ts
pnpm vitest run
pnpm tsc --noEmit
pnpm lint
```

기대값: 모두 zero error. baseline 가산 (frontend +5, backend +7).

## 다음 sprint 가 알아야 할 것

### 진입점 / API

- **Backend trait** — `DocumentAdapter` 에 3 method 추가됨. 신규 document
  adapter (e.g. CouchDB / Firestore) 가 추가되면 9 method (기존 6 + 신규
  3) 모두 구현 또는 default 제공 필요. 현재 default 없음 — 의도적 (write
  surface 는 paradigm-specific contract 가 분명해야).
- **Frontend safe-mode** — `analyzeMongoOperation(op)` 가 `useSafeModeGate.
  decide(...)` 입력. 새 Mongo write op 가 추가되면 본 함수에 case 추가
  + `StatementKind` union 에 variant 추가가 동선.
- **History entry** — `source: "mongo-op"` 가 모든 Mongo direct operation
  의 라벨. `queryMode: "find"` 는 기존 enum 의 재사용 — `QueryMode` 가
  `"sql" | "find" | "aggregate"` 만 가지므로 mongo-op 도 그 중 하나.
  `QueryHistorySourceBadge` 가 `source` 로 분류.

### 회귀 가드

- **trait 확장 시 mock 5 곳 동기** — `cargo check` 가 즉시 실패하므로
  silent drift 없음. 새 method 의 stub 은 실패 case 가 아닌 한 no-op 으로.
- **`bulkOpsSlot`** — DataGridToolbar 의 새 prop. RDB caller 는 전달
  안 하므로 기존 RDB 테스트 영향 0. 다른 paradigm grid 가 등장하면 같은
  슬롯 재활용 가능.
- **frontend `_id` 거절 이중** — `update_many` patch 의 `_id` 거절은
  frontend dialog + backend `update_many_impl` 양쪽 모두. 정책 변경 시
  두 곳 동기.

### 후속

- **`dropDatabase` (database-level)** — 본 sprint OOS. confirm UX 가
  더 강력해야 (whole DB 영향). 별 sprint 후보.
- **`bulkWrite` (mixed insert/update/delete)** — driver 의 단일 round-trip
  bulk API. 단일 op 3 종으로 P0 cover, mixed 는 후속.
- **partial-success 처리** — Mongo `update_many` 가 일부 doc 만 match
  실패해도 전체 op success 로 반환 (modified_count 만 반영). UI 가 count
  toast 로 충분, 실패 row 추적 X. 향후 별 sprint.
- **index drop / rename collection** — 본 sprint OOS. `docs/RISKS.md` 가
  스코프 결정.

### 외부 도구 의존성

없음. 추가 crate 0. 기존 `mongodb` / `bson` 만 사용. frontend 는
`@/lib/toast` (기존) + `lucide-react` (Trash2 / FileEdit 아이콘 신규
import).

### 폐기된 surface

- 없음. 기존 Mongo single-doc 3 command (`insert_document` / `update_document`
  / `delete_document`) 모두 유지. `_id` 거절 contract 도 동일.

## 시퀀싱 메모

- Sprint 197 (mongodb.rs 4-way split) → **Sprint 198** (Mongo bulk-write
  3 신규 command + UI 진입점).
- 본 sprint 가 **Sprint 189–198 sequencing 종료**. 이후 docs retire:
  - `docs/refactoring-plan.md` — 시한부 (Sprint 198 종료 후 retire).
  - `docs/refactoring-smells.md` — 시한부 (frozen 2026-05-02 snapshot).
- 영속 표준은 `memory/conventions/refactoring/` 4 카테고리 (B / D / C / A).

## Refs

- `docs/sprints/sprint-198/contract.md` — sprint contract.
- `docs/sprints/sprint-198/findings.md` — 결정 / 결과 / 트레이드오프.
- `docs/refactoring-plan.md` Sprint 198 row.
- `docs/PLAN.md` Mongo write-path 확장.
