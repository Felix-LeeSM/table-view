# Sprint 273 — Evaluator Findings (attempt 1)

**Sprint**: 273 (Phase 26 — Trigger CREATE)
**Verdict**: **PASS**
**Overall**: 8.4 / 10
**Date**: 2026-05-13

## Scores

| Dimension          | Score | Notes                                                                                                                                                                                                                       |
| ------------------ | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Correctness        | 9/10  | AC-273-01..08 모두 충족. PG SQL emitter 가 timing/orientation/event whitelist 와 5 식별자 검증을 모두 통과. INSTEAD OF + STATEMENT, INSTEAD OF + multi-event 거부 경로 박제.                                                |
| Test coverage      | 9/10  | 22 backend (17 mutations + 1 serde + 4 command-layer) + 6 vitest. Mismatch panic-closure (Sprint 271c jig 재사용) 와 DbMismatch Retry toast 경로 모두 커버.                                                                  |
| Contract adherence | 8/10  | Sprint 273 contract 7 게이트 전부 green; `AppError::Unsupported` 메시지 문구가 contract "Paradigm::Relational" 어휘 대신 string 메시지지만 peer trait 와 일관성 유지 (무해).                                                |
| Code quality       | 8/10  | `build_create_trigger_sql` 순수 헬퍼 + `_inner` shape + `ensure_expected_db` 가드 모두 재사용 패턴 준수. CreateTriggerDialog 의 `eventsArray` deps churn (P2 #2) 와 중복 `setFunctionName` (P2 #3) 가 잔여.                  |
| Robustness         | 8/10  | 단일 따옴표 escape (`'` → `''`) emit-path 에서 처리; canonical event ordering 으로 SQL drift 차단. Sprint 272 P2 #2 (concurrent expand race) 는 carryover.                                                                   |

P0 / P1 발견 없음.

## 무엇이 만들어졌는지

### Backend
- `CreateTriggerRequest` Rust 모델 + `#[serde(rename_all = "camelCase")]` + serde roundtrip 테스트 (`src-tauri/src/models/schema.rs`).
- `RdbAdapter::create_trigger` trait method — default `Unsupported` (`src-tauri/src/db/traits.rs:454-463`).
- PG `build_create_trigger_sql` 순수 헬퍼 (`src-tauri/src/db/postgres/mutations.rs:126-242`) — 식별자 검증 × 5 (`trigger_name`, `schema`, `table`, `function_schema`, `function_name`), timing/orientation/event whitelist, INSTEAD OF + STATEMENT 거부, INSTEAD OF + multi-event 거부, canonical event ordering walk (`INSERT → UPDATE → DELETE`), `function_arguments` 의 `'` → `''` 더블링, `WHEN (<expr>)` 절 파라미터화 (whitespace-only 시 생략).
- `PostgresAdapter::create_trigger` inherent method (`src-tauri/src/db/postgres/mutations.rs:1087-1130`) — `preview_only` 분기 + `sqlx::Transaction::begin` / `commit`.
- `commands::rdb::ddl::create_trigger` Tauri command + `create_trigger_inner(&AppState, &CreateTriggerRequest)` (Sprint 237 P5 shape) + Sprint 271c `ensure_expected_db` 가드.
- `StubRdbAdapter::create_trigger_fn` 슬롯 + impl (`src-tauri/src/db/testing.rs:115, 386-397`) — DDL default sentinel `Ok(SchemaChangeResult { sql: "create_trigger" })`.
- `invoke_handler` 등록 (`src-tauri/src/lib.rs:161`).

### Frontend
- `CreateTriggerRequest` TS interface (`src/types/schema.ts`) — camelCase 미러 + Sprint 271c `expectedDatabase` 가드.
- `tauri.createTrigger` 래퍼 (`src/lib/tauri/ddl.ts`).
- `schemaStore.refreshTableTriggers` action — bypass-cache 재페치 (`src/stores/schemaStore.ts`).
- `CreateTriggerDialog.tsx` (NEW) — name input + timing radio (BEFORE / AFTER / INSTEAD OF) + events checkboxes (INSERT / UPDATE / DELETE) + ROW / STATEMENT radio + WHEN textarea + 함수 picker (datalist + free-text fallback) + arguments input + 접을 수 있는 Show DDL pane + 250ms 디바운스 미리보기 + Apply 게이팅. INSTEAD OF 선택 시 STATEMENT 라디오 비활성. `useDdlPreviewExecution` 재사용으로 DbMismatch Retry toast 경로 ready.
- `useSchemaTreeActions` 확장 — `createTriggerDialog` 슬롯 + `setCreateTriggerDialog` + `handleCreateTrigger(tableName, schemaName)` opener + `refreshTableTriggersForSlot`.
- `SchemaTreeRowsContext.handleCreateTrigger` 추가 + 3 진입점 (Table 행 컨텍스트 메뉴, Triggers 그룹 헤더 `+` affordance, per-trigger 행 컨텍스트 메뉴) 모두 enable.
- `CreateTriggerDialogSlot` 슬롯 wrapper + `SchemaTree.tsx` 마운트.

### Tests
- Backend (22): SQL emission (6) + rejection paths (11) + serde roundtrip (1) + command-layer wiring (4 — trait routing sentinel, unknown-connection NotFound, Document paradigm Unsupported, DbMismatch panic-closure).
- Frontend (6): `CreateTriggerDialog.test.tsx` — mount/Apply 비활성, INSTEAD OF disables STATEMENT, 250ms 디바운스 미리보기 + `expectedDatabase` 페이로드, Apply commit + onRefresh/onClose, DbMismatch sync + Retry toast, 빈 events Apply 비활성.
- Regression guard 업데이트: `triggerRow.test.tsx:208` "Create Trigger… disabled placeholder" → "Create Trigger… enabled".

## Resolved

- **AC-273-01..08** 모두 만족 (handoff.md AC 커버리지 표 참조).
- **Sprint 272 findings § P2c (`decode_tgargs` unescaped quote)** — `function_arguments` 단일 따옴표 escape 를 SQL emitter (write path) 에서 처리. 주의: `decode_tgargs` 는 read path 이고 create 는 emit path 이므로 두 path 의 escape 책임은 분리되어 있음. Sprint 273 의 fix 는 write path 에 한정; read path 는 Sprint 272 P2c 그대로 carryover.

## Residual P2 (Sprint 274 전 정리 권장)

1. **`body.tsx` ↔ `treeRows.ts` trigger render-path 중복 미해소** (Sprint 272 P2 #1 carryover). Generator handoff (§ Pre-273 cleanup) 에 deferral 사유 명시 — Triggers 그룹 헤더 `+` affordance 는 `renderTriggerGroupRow` single entry 만 거치므로 현재 drift 없음. **Sprint 274 의 Drop affordance 가 per-trigger 행 컨텍스트 메뉴에 들어가기 전 land 권장.**
2. **`CreateTriggerDialog.tsx:251` useEffect deps churn** — `eventsArray = Array.from(events)` 가 매 render 마다 새 reference. `canPreview` gating 으로 실제 dispatch 는 막히지만 cleanup timer churn 이 발생. `events.size` 로 deps 교체 또는 stable join hash (`Array.from(events).sort().join('|')`) 사용 권장.
3. **`CreateTriggerDialog.tsx:488, 499` 중복 `setFunctionName`** — onChange 에서 `setFunctionName(next)` 를 호출한 뒤, match 분기에서 다시 `setFunctionName(match.name)` 호출. 단일 setter 로 collapse (match.name ?? next).
4. **`db/traits.rs:458-462` `AppError::Unsupported(String)` 메시지 문구** — contract 는 "Paradigm::Relational" 어휘를 사용했으나 implementation 은 string 메시지. peer trait (`drop_table`, `create_index` 등) 과 일관성 있으므로 무해. 추후 `traits.rs` refactor 시 통합 고려.

## Carryover from Sprint 272

- **Sprint 272 P2 #2 (concurrent expand race in `loadTriggersForGroup`)** — 그대로 미해소. Sprint 274 의 Drop affordance 가 새로운 state-dependent affordance 를 도입하면 race 위험 증가. 한 번에 정리 권장.
- **Sprint 272 P2 #3 (`decode_tgargs` raw bytes)** — Sprint 273 가 `function_arguments` write-path single-quote escape 로 해소. Read path 는 `pg_get_triggerdef` 가 quoting 을 맡으므로 추가 작업 불필요.

## 게이트 결과

| Gate                                  | Result |
| ------------------------------------- | ------ |
| `cargo test create_trigger`           | PASS (22) |
| `cargo clippy -D warnings`            | PASS (0 warning) |
| `cargo fmt --check`                   | PASS |
| `cargo test --lib`                    | PASS (749) |
| `pnpm tsc --noEmit`                   | PASS |
| `pnpm vitest run`                     | PASS (3271) |
| `pnpm exec eslint . --max-warnings 0` | PASS |

## Verdict

**PASS** — 모든 dimension ≥ 7, P0/P1 없음. Sprint 273 land 진행 + Sprint 274 (Drop Trigger) 로 이행.
