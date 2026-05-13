# Sprint 272 → Sprint 273 Handoff

**Sprint 272 (Phase 26 — Trigger Read): PASS (8.6/10, attempt 2).**
Sprint 273 (Trigger Create) 가 재사용/연장할 수 있는 표면을 정리한다.

## Sprint 272 가 전달한 것

### Backend
- `list_triggers` + `get_trigger_source` Tauri commands.
- `RdbAdapter` trait extension (2 new methods + safe defaults).
- PostgreSQL adapter 구현 + `TriggerInfo` 모델 + `tgtype` bitmask decoder.

### Frontend
- `schemaStore` 의 `triggers` 캐시 slice — key: `(connId, db, schema, table)`.
- `StructurePanel` Triggers sub-tab (4번째 탭, Constraints 다음).
- `SchemaTree` Table row 하위 child "Triggers" group row — lazy fetch + placeholder/loading states.
- Table row context-menu shortcut "View Triggers" — StructurePanel 을 Triggers tab 으로 열기.

### Tests
- Backend: 11 trigger tests (schema 10 + bitmask, tgargs 1).
- Frontend: +6 vitest cases (schemaTree triggerRow 5 + schemaStore clearSchema 1).

## Sprint 273 이 그대로 재사용할 shapes (churn 금지)

- **`NodeId` `trigger` variant** at `treeRows.ts:108-113` — Create dialog opener 의 keying. `triggerName` / `tableName` / `schemaName` 은 NodeId 에서 re-derive. TriggerInfo payload 를 직접 읽지 말 것.
- **`handleViewTriggerSource` opener** at `useSchemaTreeActions.ts:386-391` — `triggerName` 파라미터를 이미 thread 함. Sprint 273 inline-edit affordance 가 동일 hook 점에 연결 가능.
- **Disabled-placeholder swap pattern** at `rows.tsx:608-622` — Create/Drop ContextMenuItem 이 `disabled` + "is coming soon" tooltip 으로 이미 존재. Sprint 273 은 `disabled` 를 풀고 `onClick={() => ctx.handleCreateTrigger(...)}` 만 wire-up.
- **`CreateTriggerRequest` + `DropTriggerRequest` 모델 필드** — spec § AC-273-01 / AC-274-01 에서 이미 명시. 둘 다 Sprint 271c 의 `expected_database` field guard pattern 을 재사용.
- **DDL preview lifecycle** — `useDdlPreviewExecution` (Sprint 214) 가 reuse target. spec § AC-273-05 / AC-274-04.
- **DB mismatch 경로** — `parseDbMismatch` + `syncMismatchedActiveDb` + Retry toast (Sprint 269 + 271a/c 패턴) 이 user-initiated commit 의 mismatch handler.

## Pre-273 cleanup (권장, 1 small commit, not load-bearing)

- `body.tsx::TriggerGroupSubtree` 와 `treeRows.ts::buildTriggerRowsForTable` 의 render-path duplication 을 single source-of-truth 로 collapse. Sprint 273 이 Triggers group header 에 `+` affordance 를 추가할 때 drift 위험 제거.

## Sprint 273 first move

- modal 작성 **전에** `CreateTriggerRequest` 모델 + `_inner` backend + SQL emission tests 부터 land. Sprint 271c (backend → TS wrapper → dialog) 와 대칭으로 시퀀싱.

## Sprint 272 patch set — commit 대상 파일

### Backend (new + modified)
- `src-tauri/src/models/schema.rs` — TriggerInfo struct + serde
- `src-tauri/src/models/mod.rs` — re-export
- `src-tauri/src/db/traits.rs` — 2 new methods + defaults
- `src-tauri/src/db/postgres/schema.rs` — `decode_tgtype`, `decode_tgargs`, `list_triggers`, `get_trigger_source` + 10 tests
- `src-tauri/src/db/postgres.rs` — trait delegations
- `src-tauri/src/db/testing.rs` — `StubRdbAdapter` extension hooks
- `src-tauri/src/commands/rdb/schema.rs` — `list_triggers` / `get_trigger_source` handlers + 8 command-layer tests
- `src-tauri/src/lib.rs` — `invoke_handler` registration

### Frontend (new + modified)
- `src/types/schema.ts` — `TriggerInfo` interface
- `src/lib/tauri/schema.ts` — `listTriggers` + `getTriggerSource` wrappers
- `src/stores/schemaStore.ts` — `triggers` slice + `getTableTriggers` + 4 eviction sites
- `src/stores/schemaStore.test.ts` — 5 new tests
- `src/stores/workspaceStore/types.ts` — `StructureSubTab` + `initialStructureSubTab?`
- `src/components/layout/MainArea.tsx` — thread `initialSubTab`
- `src/components/schema/StructurePanel.tsx` — Triggers sub-tab + `hasFetchedTriggers` gate + `TriggersList`
- `src/components/schema/StructurePanel.triggers.test.tsx` — 7 cases, **NEW**
- `src/components/schema/__tests__/structurePanelTestHelpers.tsx` — `MOCK_TRIGGERS` + helpers
- `src/components/schema/SchemaTree/treeRows.ts` — `trigger` + `triggerGroup` NodeId variants + 5 VisibleRow variants + builder
- `src/components/schema/SchemaTree/rows.tsx` — 5 renderer functions + per-trigger context menu
- `src/components/schema/SchemaTree/useSchemaTreeActions.ts` — lazy-fetch state machine + 4 new handlers
- `src/components/schema/SchemaTree/body.tsx` — `TriggerGroupSubtree` eager-nested branch
- `src/components/schema/SchemaTree.tsx` — `triggersBySchemaTable` selector + ctx wire-up
- `src/components/schema/SchemaTree/triggerRow.test.tsx` — 5 cases, **NEW**
