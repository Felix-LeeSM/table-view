# Sprint 273 → Sprint 274 Handoff

**Sprint 273 (Phase 26 — Trigger CREATE): IMPLEMENTED + EVALUATED.**
Evaluator attempt 1 결과 **PASS** (Overall 8.4/10, 모든 dimension ≥ 7, P0/P1 없음 — `docs/sprints/sprint-273/findings.md`).
모든 7 게이트 통과: `cargo test create_trigger` (22), `cargo clippy -D warnings`, `cargo fmt --check`, `cargo test --lib` (749), `pnpm tsc --noEmit`, `pnpm vitest run` (3271), `pnpm exec eslint . --max-warnings 0`.

## 무엇이 land 됐는가

### Backend
- `CreateTriggerRequest` Rust 모델 + `#[serde(rename_all = "camelCase")]` + serde roundtrip 테스트 (`src-tauri/src/models/schema.rs`).
- `RdbAdapter::create_trigger` trait method — default `AppError::Unsupported` (`src-tauri/src/db/traits.rs:454-463`).
- PG `build_create_trigger_sql` 순수 헬퍼 (`src-tauri/src/db/postgres/mutations.rs:126-242`) — 식별자 검증 × 5 (`trigger_name` / `schema` / `table` / `function_schema` / `function_name`), timing/orientation/event whitelist, INSTEAD OF + STATEMENT 거부, INSTEAD OF + multi-event 거부, canonical event ordering walk (`INSERT → UPDATE → DELETE`), `function_arguments` 의 `'` → `''` 더블링, `WHEN (<expr>)` 절 파라미터화 (whitespace-only 시 생략).
- `PostgresAdapter::create_trigger` inherent method (`src-tauri/src/db/postgres/mutations.rs:1077-1130`) — `preview_only` 분기 + `sqlx::Transaction::begin` / `commit`.
- `commands::rdb::ddl::create_trigger` Tauri command + `create_trigger_inner(&AppState, &CreateTriggerRequest)` (Sprint 237 P5 `_inner` shape) + Sprint 271c `ensure_expected_db` 가드.
- `StubRdbAdapter::create_trigger_fn` 슬롯 + impl (`src-tauri/src/db/testing.rs:115, 386-397`) — DDL default sentinel `Ok(SchemaChangeResult { sql: "create_trigger" })`.
- `invoke_handler` 등록 (`src-tauri/src/lib.rs:161`).

### Frontend
- `CreateTriggerRequest` TS interface (`src/types/schema.ts`) — camelCase 미러 + Sprint 271c `expectedDatabase` 가드.
- `tauri.createTrigger` 래퍼 (`src/lib/tauri/ddl.ts`).
- `schemaStore.refreshTableTriggers` action — bypass-cache 재페치, 다이얼로그 commit-success path 가 사용 (`src/stores/schemaStore.ts`).
- `CreateTriggerDialog.tsx` (NEW) — name + timing radio (BEFORE / AFTER / INSTEAD OF) + events checkboxes (INSERT / UPDATE / DELETE) + ROW / STATEMENT radio + WHEN textarea + 함수 picker (datalist + free-text fallback) + arguments input + 접을 수 있는 Show DDL pane + 250ms 디바운스 자동 미리보기 + Apply 게이팅. INSTEAD OF 선택 시 STATEMENT 라디오 비활성. `useDdlPreviewExecution` 재사용으로 DbMismatch retry toast 가 ready.
- `CreateTriggerDialog.test.tsx` (NEW) — 6 vitest 케이스.
- `useSchemaTreeActions` 확장 — `createTriggerDialog` 슬롯 + `setCreateTriggerDialog` + `handleCreateTrigger(tableName, schemaName)` opener + `refreshTableTriggersForSlot` 액션.
- `SchemaTreeRowsContext.handleCreateTrigger` ctx 필드 + 3 진입점 (Table 행 컨텍스트 메뉴, Triggers 그룹 헤더 `+` affordance, per-trigger 행 컨텍스트 메뉴) 모두 enable.
- `CreateTriggerDialogSlot` 슬롯 wrapper (`src/components/schema/SchemaTree/dialogs.tsx`) + `SchemaTree.tsx` 마운트.

### Tests
- **Backend (22)**: SQL emission (6) + rejection paths (11) + serde roundtrip (1) + command-layer wiring (4 — trait routing sentinel, unknown-connection NotFound, Document paradigm Unsupported, DbMismatch panic-closure).
- **Frontend (6)**: mount/Apply 비활성, INSTEAD OF disables STATEMENT, 250ms 디바운스 미리보기 + `expectedDatabase` 페이로드, Apply commit + onRefresh/onClose, DbMismatch sync + Retry toast, 빈 events Apply 비활성.
- **Sprint 272 회귀 가드 업데이트**: `triggerRow.test.tsx:208` "Create Trigger… disabled placeholder" → "Create Trigger… enabled" (mechanical update). "Drop Trigger… disabled placeholder" 케이스는 보존 — Sprint 274 의 가드.

## Sprint 274 가 churn 없이 재사용할 shapes

### Backend
- **`commands::rdb::ddl::create_trigger_inner`** (`src-tauri/src/commands/rdb/ddl.rs:279-290`) — `drop_trigger_inner` 의 byte-equivalent template. lock → get → `as_rdb` → `ensure_expected_db` → dispatch chain 그대로 mirror.
- **`StubRdbAdapter::create_trigger_fn`** (`src-tauri/src/db/testing.rs:115, 386-397`) — test-double slot 패턴. Sprint 274 는 `drop_trigger_fn` 추가.
- **`mismatched_rdb()` panic-closure helper** (`src-tauri/src/commands/rdb/ddl.rs:801-803`) — Sprint 271c 의 DbMismatch 가드 jig. 재사용.
- **`build_create_trigger_sql` 순수 헬퍼 패턴** (`src-tauri/src/db/postgres/mutations.rs:126-241`) — pool-free + unit-testable. Sprint 274 `build_drop_trigger_sql` 동일 shape.
- **`sqlx::Transaction::begin` / `commit` 패턴** (`src-tauri/src/db/postgres/mutations.rs:1099-1113`) — 리터럴 `BEGIN` / `COMMIT` 문자열 직접 issue 대신 트랜잭션 API 경유.
- **`validate_identifier` 헬퍼** (`src-tauri/src/db/postgres/mutations.rs:127-131`) — trigger_name + schema + table 3 식별자 검증.

### Frontend
- **`CreateTriggerDialog` 구조** (`src/components/schema/CreateTriggerDialog.tsx`) — Show DDL pane + 250ms 디바운스 + Apply 게이트 + DbMismatch handler. Sprint 274 의 Drop 모달은 `DropTableDialog` (Sprint 235) 의 typing-confirm + Safe-Mode 패턴과 본 다이얼로그의 preview/commit 라이프사이클 결합.
- **`useDdlPreviewExecution`** (`src/components/structure/useDdlPreviewExecution.ts`) — preview / commit 라이프사이클 hook. **시그니처 변경 금지** (다른 DDL 다이얼로그 6+ 곳에서 공유).
- **`CreateTriggerDialogSlot` 패턴** (`src/components/schema/SchemaTree/dialogs.tsx`) — Slot wrapper 패턴. Sprint 274 `DropTriggerDialogSlot` 추가.
- **Disabled-placeholder swap pattern** — `src/components/schema/SchemaTree/rows.tsx:401-408` (Table 행 컨텍스트 메뉴 Drop) 와 `rows.tsx:648-655` (per-trigger 행 컨텍스트 메뉴 Drop) 두 곳 모두 `disabled` + `title="Drop Trigger is coming soon"` 상태. Sprint 274 가 `onClick={ctx.handleDropTrigger(...)}` 로 swap.
- **`triggerRow.test.tsx:208` regression line** — Sprint 273 가 한 mechanical update (Create disabled → enabled) 와 동일하게 Sprint 274 가 Drop swap.

## Drop 은 read 한정 reuse

- **함수 picker 불필요** — Drop 은 existing trigger 대상이므로 함수 선택 UI 가 없다. `schemaStore.triggers[connId][db][schema][table]` slice 를 그대로 사용 (이미 Sprint 272 에서 wire-up 완료).
- **SQL emit 단순** — `DROP TRIGGER "name" ON "schema"."table"` (+ `cascade == true` 시 trailing ` CASCADE`) 만 emit. WHEN / events / timing / orientation 분기 전부 없음.

## Sprint 274 first move (권장 순서)

1. **(Optional) Sprint 272/273 P2 #1 cleanup** — `body.tsx::TriggerGroupSubtree` ↔ `treeRows.ts::buildTriggerRowsForTable` render-path 단일 source 로 통합. 작은 commit 으로 land. Drop affordance 가 per-trigger 행 컨텍스트 메뉴에 들어가기 전에 정리 권장.
2. **`DropTriggerRequest` 모델** (Rust + TS) + serde roundtrip 테스트.
3. **`build_drop_trigger_sql` 순수 헬퍼** + 5 SQL emission 테스트 (cascade on/off, identifier rejection × 3).
4. **`commands::rdb::ddl::drop_trigger` `_inner`** + 1 mismatch panic-closure + 1 happy-path 테스트.
5. **`DropTriggerDialog` 모달** — `DropTableDialog` (Sprint 235) 와 parity: typing-confirm input + CASCADE checkbox + Show DDL pane + Apply destructive + Safe-Mode confirm.
6. **`useSchemaTreeActions.handleDropTrigger`** + `dropTriggerDialog` slot.
7. **`rows.tsx` 2 곳 disabled → enabled flip** (`rows.tsx:401-408`, `rows.tsx:648-655`).
8. **Vitest 5 케이스** — typing-confirm 게이트, CASCADE toggle invalidates preview, mismatch toast, Safe-Mode confirm path, post-commit refresh.

## Sprint 273 patch set — 커밋 대상 파일

### Backend (new + modified)
- `src-tauri/src/models/schema.rs` — `CreateTriggerRequest` + serde roundtrip
- `src-tauri/src/models/mod.rs` — re-export
- `src-tauri/src/db/traits.rs` — `RdbAdapter::create_trigger` default Unsupported
- `src-tauri/src/db/postgres/mutations.rs` — whitelists + `build_create_trigger_sql` + `create_trigger` + 17 tests
- `src-tauri/src/db/postgres.rs` — trait delegation + import
- `src-tauri/src/db/testing.rs` — `StubRdbAdapter::create_trigger_fn` 슬롯 + impl + import
- `src-tauri/src/commands/rdb/ddl.rs` — `create_trigger_inner` + `create_trigger` 핸들러 + 4 command-layer tests + import + builder
- `src-tauri/src/lib.rs` — `invoke_handler` 등록

### Frontend (new + modified)
- `src/types/schema.ts` — `CreateTriggerRequest` interface
- `src/lib/tauri/ddl.ts` — `createTrigger` 래퍼 + 타입 import
- `src/stores/schemaStore.ts` — `refreshTableTriggers` action + 인터페이스
- `src/components/schema/CreateTriggerDialog.tsx` — **NEW** 모달
- `src/components/schema/CreateTriggerDialog.test.tsx` — **NEW** 6 cases
- `src/components/schema/SchemaTree/useSchemaTreeActions.ts` — `handleCreateTrigger` + `createTriggerDialog` 슬롯 + `refreshTableTriggersForSlot`
- `src/components/schema/SchemaTree/rows.tsx` — Create disabled → enabled flip × 3 진입점; Triggers 그룹 헤더 `+` affordance
- `src/components/schema/SchemaTree/dialogs.tsx` — `CreateTriggerDialogSlot`
- `src/components/schema/SchemaTree.tsx` — slot mount + ctx wiring
- `src/components/schema/SchemaTree/triggerRow.test.tsx` — mechanical update (Create disabled → enabled; Drop 케이스 보존)

## Evaluator findings 요약 (참조용)

전체 보고서: `docs/sprints/sprint-273/findings.md`.

- **PASS** — Correctness 9, Test coverage 9, Contract adherence 8, Code quality 8, Robustness 8. Overall 8.4.
- **P0 / P1 없음.**
- **Residual P2 (Sprint 274 전 cleanup 권장)**:
  1. `body.tsx` ↔ `treeRows.ts` trigger render-path 중복 (Sprint 272 P2 #1 carryover).
  2. `CreateTriggerDialog.tsx:251` `eventsArray` useEffect deps churn — `events.size` 또는 stable join hash 로 교체.
  3. `CreateTriggerDialog.tsx:488, 499` 중복 `setFunctionName` — 단일 setter 로 collapse.
  4. `db/traits.rs:458-462` `AppError::Unsupported(String)` 메시지 문구 — peer trait 와 일관성 있어 무해; `traits.rs` refactor 시 통합.
- **Carryover from Sprint 272**:
  - P2 #2 (concurrent expand race in `loadTriggersForGroup`) — Sprint 274 Drop affordance 도입 전 정리 권장.
  - P2 #3 (`decode_tgargs` raw bytes) — Sprint 273 write-path single-quote escape 로 해소. Read path 는 `pg_get_triggerdef` 가 quoting 을 맡으므로 추가 작업 불필요.

## 가정과 잔여 위험

### 가정
1. **함수 picker datalist** — `schemaStore.functions[connId][db]` 이 모달 오픈 시점에 비어있을 가능성 (lazy fetch). 자유 입력 fallback 으로 커버. Spec § AC-273-05 의 "free-text fallback over `schemaStore.functions`" 요구 충족.
2. **`schemaName` ↔ `functionSchema` 분리** — 모달 오픈 시 기본값을 `schemaName` (parent 테이블 스키마) 으로 시드. 다른 스키마의 함수를 선택할 수 있도록 datalist 가 `schema.name` 페어를 보여주고 매치 시 두 필드 자동 채움.
3. **Apply 시 mismatch catch** — `useDdlPreviewExecution.runCommit` 의 `parseDbMismatch` 가 wire format `Database mismatch: …` 매칭, user-initiated 다이얼로그 path 에서 Retry toast emit. vitest 케이스 5 가 박제.

### 잔여 위험
1. **Drop Trigger 미구현 (Sprint 274 의도)** — per-trigger / per-table 컨텍스트 메뉴의 "Drop Trigger…" 는 여전히 `disabled` placeholder.
2. **MySQL / SQLite RDB 어댑터** — `create_trigger` 가 트레이트 default `Unsupported` 그대로 사용. PG 만 지원. 사용자는 비-PG 연결에서 "Create Trigger…" 클릭 시 인라인 에러를 본다 (`AppError::Unsupported` 표면화).
3. **함수 인자 escape** — 단일 따옴표만 더블링. `\` 백슬래시 / 백틱 등은 자유 입력 그대로 PG 에 전달; PG 가 파싱 에러를 verbatim 표면화. 더 강한 sanitisation 은 사용자 표현력을 제한할 위험이 있어 의도적으로 보수적.
