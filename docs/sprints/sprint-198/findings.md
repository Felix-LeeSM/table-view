# Sprint 198 — Findings

Sprint: `sprint-198` (feature — Mongo bulk-write 3 신규 command + analyzer
+ UI 진입점).
Date: 2026-05-02.
Status: closed.

## 0. UX 분기 — 3 명령은 한 곳에 모이지 않는다

### 발견

3 신규 명령 (`dropCollection` / `deleteMany` / `updateMany`) 의 의도가
서로 달라 단일 진입점에 모으면 어색하다:

- `dropCollection` 은 RDB `DROP TABLE` 평행 — 단일 collection 자체를
  통째로 제거. "row 한 줄을 어떻게 정의" 의 영역이 아니라 "schema 트리
  레벨" 에서 일어난다. RDB 의 `handleDropTable` 도 SchemaTree context
  menu 에서 호출되므로 같은 위치 (Mongo branch = `DocumentDatabaseTree`
  의 collection 노드 right-click) 가 자연스럽다.
- `deleteMany(filter)` / `updateMany(filter, patch)` 는 "현재 활성 filter
  와 일치하는 doc" 을 대상으로 한다. 이 시점에 `activeFilter` 가 이미
  존재하는 곳은 `DocumentDataGrid` 뿐 — 다른 곳에서 호출하면 사용자가
  filter 를 다시 입력해야 해 경험이 끊긴다.

### 결정

| 명령 | 진입점 |
|------|--------|
| `dropCollection` | `DocumentDatabaseTree` (sidebar) collection 노드 context menu — `Drop Collection` |
| `deleteMany(filter)` | `DocumentDataGrid` toolbar 의 신규 `bulkOpsSlot` 의 trash 아이콘 |
| `updateMany(filter, patch)` | `DocumentDataGrid` toolbar 의 신규 `bulkOpsSlot` 의 file-edit 아이콘 + patch 입력 dialog |

3 사이트 모두 commit 직전:

1. `analyzeMongoOperation(...)` 로 위반 분류 (`StatementAnalysis` shape).
2. `useSafeModeGate.decide(analysis)` 로 paradigm-agnostic decision.
3. `block` → toast.error 후 즉시 return; `allow` / `confirm` → 확인
   dialog 노출 → 실제 invoke.

성공/실패 모두 `addHistoryEntry({ source: "mongo-op", ... })` 로
queryHistoryStore (Sprint 196) 에 등재. `queryMode` 는 `"find"` —
`QueryMode` union 에 `"mql"` 가 없어 기존 Mongo entry 와 동일한 enum
값을 재사용. `QueryHistorySourceBadge` (Sprint 196) 가 이미 `mongo-op`
를 색상으로 구분해 주므로 query log 패널에서 시각적으로 분리된다.

### 트레이드오프

- **3 사이트 분산** — 단일 진입점이 없으므로 사용자가 "어디에서 dropCollection
  하지?" 를 한 번 학습해야 한다. 하지만 RDB 측 `handleDropTable` 도 동일
  학습 비용을 갖고 (SchemaTree right-click), 평행이 명확해 IA 일관성이
  더 높다. Compass / TablePlus 도 sidebar 에서 drop, grid 에서 bulk
  filter ops 를 노출하는 동일 패턴.
- **`bulkOpsSlot` 추가** — `DataGridToolbar` 에 prop 1 개 추가. RDB
  caller 는 prop 을 전달하지 않으므로 기존 RDB 테스트에 영향 0. document
  caller 만 두 버튼을 호스팅한다. 향후 paradigm-specific 확장 (search /
  KV) 에서도 같은 슬롯을 재활용 가능.

## 1. analyzer kind 확장 — 5 신규 variants

### 발견

`StatementKind` union 은 Sprint 188 에서 `mongo-out` / `mongo-merge` /
`mongo-other` 3 variants 만 가졌다. 신규 `analyzeMongoOperation` 가
드는 5 variants:

- `mongo-drop` — dropCollection 항상.
- `mongo-delete-all` / `mongo-delete-many` — empty filter / non-empty.
- `mongo-update-all` / `mongo-update-many` — empty filter / non-empty.

`useSafeModeGate.decide` 는 `severity` 만 보므로 새 kind 가 늘어도
decision matrix 변경 0. `kind` 는 향후 telemetry / log 분류용 —
QueryHistorySourceBadge 도 `kind` 가 아닌 `source` 를 본다.

### 결정

`StatementKind` union 에 5 variants 추가. `analyzeMongoPipeline` 와
`analyzeMongoOperation` 가 같은 union 을 share — Sprint 188 의 동치
정책 유지. RDB analyzer (`analyzeStatement`) 는 mongo-* 를 발생시키지
않고, mongo analyzer 는 SQL kind 를 발생시키지 않는다는 invariant 는
type union 만 share 할 뿐 분리 함수.

### 트레이드오프

- **union 비대화** — 13 variants 로 늘었다. mongo-* 가 8 개로 RDB 와
  비등해졌지만 paradigm-agnostic gate 의 가치 (한 hook + 한 decision
  matrix 가 모든 paradigm 의 위험을 dispatch) 가 더 크다.
- **분기 구분** — `mongo-other` 와 `mongo-other-X` 의 의미 차이 (pipeline
  의 read-shape vs operation 의 mismatch) 는 reasons 로 표현. 필요시
  reasons 의 첫 토큰을 보면 분리 가능.

## 2. backend `_id` 거절은 update_many 에도 적용

### 발견

`update_document_impl` 가 patch 에 `_id` 를 거절하는 contract (Sprint 80) 는
identity 보호 — 단일 doc 이든 bulk 든 같은 위험. bulk 는 오히려 더 위험
(여러 doc 의 `_id` 를 동일 값으로 덮으면 unique-index 위반 → 모두 실패
또는 partial 실패 후 dangling).

### 결정

`update_many_impl` 에 동일 가드 (`AppError::Validation`). frontend
`handleConfirmUpdateMany` 가 `JSON.parse` 후 `"_id" in patch` 도 미리
거절하지만 backend 가 idempotent 하게 한 번 더 검사 — 직접 IPC 호출
시나리오에 대한 trust boundary.

### 트레이드오프

- **이중 검사** — frontend 와 backend 가 같은 룰을 둘다 enforce. 정책
  변경 시 두 곳을 동기화해야 하지만 boundary 가 명확해진다.
- **에러 메시지 통일** — backend 의 `AppError::Validation` 메시지가 toast
  로 그대로 노출되도록 frontend dialog 의 catch 가 `e.message` 를
  표시한다.

## 3. mock dispatcher 분포 — 5 곳 동시 패치

### 발견

`DocumentAdapter` trait 에 method 를 추가하면 trait 를 mock 한 모든
test struct 가 broken — Rust 의 trait coverage 강제. 본 sprint 가
패치한 mock dispatcher 5 곳:

1. `commands/meta.rs::tests::StubDocumentAdapter` (line 264) —
   `switch_dispatch` 의 Document arm 검증.
2. `commands/meta.rs::tests::ErroringDocumentAdapter` (line 567 → 597) —
   error 전파 테스트.
3. `commands/meta.rs::tests::StubDocVerify` (line 929 → 989) —
   `verify_dispatch` Document arm.
4. `db/mod.rs::tests::DummyDocument` (line 655 → 672) — `as_rdb` /
   `as_search` / `as_kv` Unsupported 분기.
5. `db/mod.rs::tests::FakeCancellableDocument` (line 1056 → 1102) —
   cancel-token cooperation 테스트.

### 결정

각 mock 에 3 method (`delete_many` / `update_many` / `drop_collection`)
의 no-op stub 추가. `delete_many` / `update_many` → `Ok(0)`,
`drop_collection` → `Ok(())`. 모두 mock 본연의 검증 대상이 아니라 trait
완성 목적이라 실제 logic 0.

### 트레이드오프

- **5 mock 동시 패치 비용** — 매 trait 확장마다 5 곳 동기화. 현재
  비용이 견딜 만하지만 trait 가 더 커지면 helper macro 검토.
- **forgetting risk** — cargo check 가 즉시 실패하므로 누락은 build error
  로 차단됨 — silent drift 0.

## 4. 검증 결과

### Backend

| 검사 | 결과 |
|------|------|
| `cargo fmt -- --check` | 0 차이 |
| `cargo clippy --all-targets --all-features -- -D warnings` | 0 warnings |
| `cargo test --lib` | **345 passed / 2 ignored** (pre-sprint 338 → +7) |

7 신규 케이스 (mutations.rs):

- `delete_many_without_connection_returns_connection_error`
- `delete_many_rejects_empty_namespace`
- `update_many_without_connection_returns_connection_error`
- `update_many_rejects_empty_namespace`
- `update_many_rejects_id_in_patch`
- `drop_collection_without_connection_returns_connection_error`
- `drop_collection_rejects_empty_namespace`

### Frontend

| 검사 | 결과 |
|------|------|
| `pnpm vitest run` | **187 files / 2724 tests passed** (pre-sprint 2719 → +5) |
| `pnpm tsc --noEmit` | 0 errors |
| `pnpm lint` | 0 errors / 0 warnings |

5 신규 케이스 (mongoSafety.test.ts):

- `[AC-198-03a] dropCollection → danger`
- `[AC-198-03b] deleteMany empty filter → danger`
- `[AC-198-03c] updateMany empty filter → danger`
- `[AC-198-03d] deleteMany non-empty filter → safe`
- `[AC-198-03e] updateMany non-empty filter → safe`

## 5. AC 별 evidence

| AC | 결과 |
|----|------|
| AC-198-01 | `DocumentAdapter` trait 에 3 method (`delete_many` / `update_many` / `drop_collection`) 추가 — `db/mod.rs:449-475`. `MongoAdapter` 의 inherent `_impl` 3 + thin dispatch 3 — `mongodb/mutations.rs:110-181` + `mongodb.rs:200-227`. |
| AC-198-02 | `commands/document/mutate.rs` 에 3 `#[tauri::command]` 추가 (line 121-205). `lib.rs::generate_handler!` 에 3 줄 등재 (line 155-157). 5 mock dispatcher (`commands/meta.rs` × 3, `db/mod.rs` × 2) 동기 패치. |
| AC-198-03 | `analyzeMongoOperation` 신규 export — `src/lib/mongo/mongoSafety.ts:62-91`. `MongoOperation` discriminated union 도입. 5 case 테스트 통과. |
| AC-198-04 | `src/lib/tauri.ts` 에 `deleteMany` / `updateMany` / `dropCollection` 3 export 추가 (line 525-589). |
| AC-198-05 | `DocumentDatabaseTree` 의 collection 노드 ContextMenu + Drop Collection item + confirm dialog. `DataGridToolbar` 에 `bulkOpsSlot` prop 추가 — `DocumentDataGrid` 가 trash + file-edit 두 버튼 + 두 dialog 호스팅. 3 사이트 모두 Safe Mode gate + history 등재. |
| AC-198-06 | 위 검증 표 — frontend +5 / backend +7 신규 case, 회귀 0. |

## 6. Sprint 198 종료 = sequencing 완료

`docs/refactoring-plan.md` 의 Sprint 189–198 sequencing 종료. 본 sprint
이후:

- `docs/refactoring-plan.md` retire (시한부 plan, frozen 2026-05-02).
- `docs/refactoring-smells.md` retire (시한부 catalogue).

retire 처리는 본 sprint 의 마지막 step 으로 docs 에 reference 만 남기고
다음 sprint 가 영속 conventions (`memory/conventions/refactoring/`) 만
참조하도록 정리.
