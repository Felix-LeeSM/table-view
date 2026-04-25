# Sprint Contract: sprint-86 (Phase 6 plan F-2 — Frontend mqlGenerator + paradigm dispatch + Tauri wrappers)

## Summary

- Goal: Sprint 80 이 추가한 backend mutate (`insert_document` / `update_document` / `delete_document` 3 Tauri commands) 를 소비할 프론트엔드 계층을 구축한다. `useDataGridEdit` 훅의 document paradigm 분기를 "no-op guard" 에서 실제 편집 경로로 승격하고, `{$set: patch}` BSON + MQL preview 문자열을 생성하는 generator 를 추가하고, Tauri wrapper 3 개를 `src/lib/tauri.ts` 에 등록한다.
- Audience: Sprint 87 (Phase 6 F-3) 이 이 훅 + generator 를 소비해 `DocumentDataGrid` 인라인 편집 UI, 일반화된 `QueryPreviewModal`, `AddDocumentModal`, Row Delete 확인 모달을 완성한다.
- Owner: Sprint 86 harness generator.
- Verification Profile: `command` (vitest + tsc + lint + `git diff --stat` baseline 비교).

Phase 6 master plan (`/Users/felix/.claude/plans/idempotent-snuggling-brook.md` — Sprint F 섹션) 의 **중간 레이어** 만 이 스프린트 범위. UI 통합은 Sprint 87 이 전담하므로 `DataGrid.tsx` / `DocumentDataGrid.tsx` / 모달 컴포넌트는 **건드리지 않는다**. 따라서 Sprint 86 종료 시점에 `useDataGridEdit` 의 document 분기는 훅 API 로만 노출되고 실제 런타임 경로에는 연결되지 않는다 (Sprint 87 이 wire).

## In Scope

### TypeScript 타입 미러 (`src/types/documentMutate.ts` 신규)

- `DocumentId` tagged union — Rust `src-tauri/src/db/mod.rs:62-67` enum 미러:
  ```ts
  export type DocumentId =
    | { type: "ObjectId"; value: string }  // hex 24
    | { type: "String"; value: string }
    | { type: "Number"; value: number }
    | { type: "Raw"; value: unknown };     // canonical extended JSON pass-through
  ```
- Serde 는 tagged variant 를 `{ "type": "...", "value": ... }` 형태로 직렬화 (기본 externally tagged). 프론트엔드 송신 / 수신 모두 이 형태를 사용.
- Helper 함수:
  - `parseObjectIdLiteral(value: unknown): DocumentId | null` — `{"$oid": "<hex>"}` canonical extended JSON → `{type:"ObjectId", value: hex}`, 그 외 → `null`.
  - `documentIdFromRow(row: Record<string, unknown>): DocumentId | null` — row 의 `_id` 컬럼에서 추출 (`"$oid"` / plain string / plain number 케이스 처리).
  - `formatDocumentIdForMql(id: DocumentId): string` — MQL preview 용 문자열 (ObjectId → `ObjectId("<hex>")`, String → `"<escaped>"`, Number → `<n>`, Raw → `JSON.stringify(v)`).

### MQL Generator (`src/lib/mongo/mqlGenerator.ts` 신규)

- 파일 head 에 module doc-comment: Sprint 86 scope, `{$set}` 정책, Sprint 87 UI 소비 설명.
- `GridDiffRow` 타입 재사용 / 정의:
  - Input: `pendingEdits: Map<string, unknown>` (key = `"rowIdx-colIdx"`), `pendingDeletedRowKeys: Set<string>`, `pendingNewRows: Array<Record<string, unknown>>`, `rows: Array<Record<string, unknown>>`, `columns: Array<{ name: string; data_type: string; is_primary_key: boolean }>`.
  - 기존 `sqlGenerator.ts` 의 입력 shape 과 대응.
- **Output**:
  - `generateMqlPreview(input): MqlPreview` — UI 가 모달에 표시할 문자열 배열 + commit 에 쓸 payload 배열.
  ```ts
  export type MqlCommand =
    | { kind: "insertOne";  database: string; collection: string; document: Record<string, unknown> }
    | { kind: "updateOne";  database: string; collection: string; documentId: DocumentId; patch: Record<string, unknown> }
    | { kind: "deleteOne";  database: string; collection: string; documentId: DocumentId };

  export interface MqlPreview {
    previewLines: string[];   // e.g. `db.coll.updateOne({_id: ObjectId("...")}, {$set: {name: "new"}})`
    commands: MqlCommand[];   // 1:1 with previewLines, ready to dispatch to tauri wrappers
    errors: MqlGenerationError[];
  }
  ```
- Update generation:
  - Row 의 `_id` 에서 `DocumentId` 추출 실패 → `errors` 에 `{ kind: "missing-id", rowIdx }` 추가.
  - `patch` 는 top-level `_id` 키 포함 금지 (Sprint 80 backend 가 reject) — generator 단에서도 사전 필터링, 포함 시 `errors` 에 `{ kind: "id-in-patch", rowIdx }`.
  - `patch` value 는 JS 원시 타입 그대로 (String → string, Number → number, Boolean → boolean, Date 지원은 Sprint 87 이후).
  - Sentinel cell (`"{...}"` / `"[N items]"`) 편집 금지 → `errors` 에 `{ kind: "sentinel-edit", rowIdx, column }`.
  - Empty patch → skip (generator 가 해당 row 의 updateOne 을 빼버림).
- Delete generation:
  - Row 의 `_id` 에서 `DocumentId` 추출. 실패 → error.
- Insert generation:
  - `pendingNewRows` 각 row 를 `insertOne` 커맨드로 변환. `_id` 는 선택 — 없으면 MongoDB 가 생성.
  - Sentinel cell 이 포함된 row → error 로 skip.
- **Preview 문자열 format**:
  - `db.<collection>.insertOne({ name: "foo", age: 30 })`
  - `db.<collection>.updateOne({ _id: ObjectId("abc...") }, { $set: { name: "new" } })`
  - `db.<collection>.deleteOne({ _id: ObjectId("abc...") })`
  - JSON-like, 공백 포함, key 는 unquoted.
- **Errors shape**:
  ```ts
  export type MqlGenerationError =
    | { kind: "missing-id"; rowIdx: number }
    | { kind: "id-in-patch"; rowIdx: number; column: string }
    | { kind: "sentinel-edit"; rowIdx: number; column: string }
    | { kind: "invalid-new-row"; rowIdx: number; reason: string };
  ```

### Tauri wrappers (`src/lib/tauri.ts` 수정)

- `findDocuments` / `aggregateDocuments` 뒤에 3 개 함수 추가:
  ```ts
  export async function insertDocument(
    connectionId: string,
    database: string,
    collection: string,
    document: Record<string, unknown>,
  ): Promise<DocumentId> {
    return invoke<DocumentId>("insert_document", { connectionId, database, collection, document });
  }

  export async function updateDocument(
    connectionId: string,
    database: string,
    collection: string,
    documentId: DocumentId,
    patch: Record<string, unknown>,
  ): Promise<void> {
    return invoke<void>("update_document", { connectionId, database, collection, documentId, patch });
  }

  export async function deleteDocument(
    connectionId: string,
    database: string,
    collection: string,
    documentId: DocumentId,
  ): Promise<void> {
    return invoke<void>("delete_document", { connectionId, database, collection, documentId });
  }
  ```
- Import 부에 `import type { DocumentId } from "../types/documentMutate";` 추가.
- 기존 wrapper 구현 / 순서 / 이름 불변.

### useDataGridEdit 분기 (`src/components/datagrid/useDataGridEdit.ts` 수정)

현재 상태 (Sprint 66):
- `paradigm: "rdb" | "document" | "search" | "kv"` 이미 parameter. 기본값 `"rdb"`.
- `handleStartEdit` 진입 L409 에서 `if (paradigm === "document") return;` 로 no-op.
- `handleCommit` / `handleExecuteCommit` / `generateSql` 은 모두 RDB 전용.

Sprint 86 변경:
1. `handleStartEdit` 의 document no-op 가드를 **제거**. `editingCell` / `editValue` 세팅은 paradigm 공통.
2. `saveCurrentEdit` 는 불변 — `pendingEdits` 적재 자체는 paradigm 공통.
3. `handleCommit` 에 paradigm 분기 추가:
   - `paradigm === "rdb"` → 기존 `generateSql` 경로 (불변).
   - `paradigm === "document"` → 신규 `generateMqlPreview` 호출:
     - `mqlPreview: MqlPreview` 을 state 에 저장 (기존 `sqlPreview: string[] | null` 과 병렬로 `mqlPreview: MqlPreview | null` 필드 추가).
     - `previewLines` 를 기존 `sqlPreview` 와 동일하게 모달에 표시 (Sprint 87 이 paradigm 별 분기).
4. `handleExecuteCommit` 에 paradigm 분기 추가:
   - `paradigm === "rdb"` → 기존 `executeQuery` 루프 (불변).
   - `paradigm === "document"` → `mqlPreview.commands` 루프, 각 커맨드 kind 에 맞춰 `insertDocument` / `updateDocument` / `deleteDocument` 호출. 실패 시 루프 중단 + error state 세팅 (기존 RDB 경로와 동일 패턴).
5. 훅 반환 타입 (`DataGridEditState`) 에 `mqlPreview: MqlPreview | null` 추가. `hasPendingChanges` 계산에 mqlPreview 도 포함.
6. `paradigm` 을 `useDataGridEdit` 필수 의존 인자로 올리지 않음 — 여전히 optional, default `"rdb"`. (Sprint 87 이 DocumentDataGrid 연결 시 `"document"` 를 넘김.)

### Test coverage (필수)

- `src/types/documentMutate.test.ts` 신규:
  - `parseObjectIdLiteral` — `{$oid: <hex>}` → ObjectId variant, 그 외 → null.
  - `documentIdFromRow` — row 의 `_id` canonical EJSON 에서 ObjectId 추출.
  - `formatDocumentIdForMql` — 4 variants 각각 fixture.
- `src/lib/mongo/mqlGenerator.test.ts` 신규:
  - `generateMqlPreview — pendingEdits → updateOne preview string + commands` happy path.
  - `generateMqlPreview — pendingDeletedRowKeys → deleteOne preview + commands`.
  - `generateMqlPreview — pendingNewRows → insertOne preview + commands`.
  - `generateMqlPreview — patch with _id key → missing-id/id-in-patch error`.
  - `generateMqlPreview — sentinel cell edit → sentinel-edit error`.
  - `generateMqlPreview — row missing _id → missing-id error`.
  - `generateMqlPreview — empty diff → empty preview + empty commands + empty errors`.
  - 최소 7 케이스.
- `src/components/datagrid/useDataGridEdit.document.test.ts` 신규:
  - `handleStartEdit — document paradigm allows editing (no-op guard removed)`.
  - `saveCurrentEdit — document paradigm accumulates pendingEdits`.
  - `handleCommit — document paradigm populates mqlPreview state`.
  - `handleExecuteCommit — document paradigm dispatches updateDocument/deleteDocument/insertDocument in order`.
  - `handleExecuteCommit — document paradigm clears mqlPreview + pending state on success`.
  - 기존 `useDataGridEdit.paradigm.test.ts` 의 Sprint 66 "document no-op guard" 테스트 제거 (AC 로 명시) 또는 signature 만 바꿔서 재목적화: "document no longer blocks edit, but guard-free". 최소 5 케이스.
- `src/lib/tauri.ts` 단위 테스트 별도 파일 불필요 — 기존에 wrapper 만 mock 하는 패턴이면 통합 테스트는 `useDataGridEdit.document.test.ts` 에서 `vi.mock("../lib/tauri")` 로 커버.

## Out of Scope

- `src/components/DocumentDataGrid.tsx` 수정 — Sprint 87. 현재도 read-only 유지, edit handler wiring 없음.
- `src/components/DataGrid.tsx` 의 preview 모달 분기 (현재는 `sqlPreview` 만 표시) — Sprint 87 이 paradigm 별 모달 컨텐츠 분기.
- `src/components/shared/QueryPreviewModal.tsx` 신설 / 기존 `SqlPreviewDialog` 일반화 — Sprint 87.
- `src/components/document/AddDocumentModal.tsx` JSON editor 기반 insert UI — Sprint 87.
- Row Delete 확인 모달 (`ConfirmDeleteModal` 등) — Sprint 87.
- 중첩 필드 dot-path 편집 (`{$set: {"profile.name": ...}}`) — Phase 6 plan 명시, Sprint 87 이후 검토.
- Bulk operations (`insertMany` / `updateMany` / `deleteMany`) — Phase 6 out of scope.
- Transactions — Phase 6 out of scope.
- Backend 변경 (Sprint 80 산출물 건드리지 않음).
- RDB edit 경로 동작 변경 — Sprint 86 에서는 paradigm 분기만 도입, RDB 분기의 기존 로직은 불변.

## Invariants

- Rust 백엔드 (`src-tauri/**`) 완전 **diff 0** — Sprint 86 는 프론트엔드 전용. `git diff --stat HEAD -- src-tauri/` empty.
- `src/components/datagrid/sqlGenerator.ts` 동작 / 시그니처 **완전 불변**.
- `src/lib/tauri.ts` 의 기존 wrapper 이름 / 시그니처 / 구현 **불변** — 추가만 허용.
- `useDataGridEdit` RDB 분기 (paradigm === "rdb" path) 의 모든 기존 테스트 PASS 유지.
- 기존 `useDataGridEdit.paradigm.test.ts` 의 "Sprint 66 no-op guard" 테스트는 의도적으로 동작 변경되므로 제거 / 재목적화 (Sprint 86 에서 가드 의도적으로 해제).
- `src/components/DocumentDataGrid.tsx` 파일 **diff 0**. Sprint 86 은 grid 에 `useDataGridEdit` 을 연결하지 않는다.
- `src/components/DataGrid.tsx` 파일 **diff 0**. RDB preview 모달 동작 불변.
- `src/types/document.ts` (Sprint 66 canonical EJSON 타입) 불변.
- `docs/**` 중 `docs/sprints/sprint-86/**` 외 전부 diff 0.
- **Pre-existing workspace state baseline**: `src/components/connection/ConnectionDialog.tsx` 는 Sprint 86 시작 시점에 이미 uncommitted 수정 (Sprint 79 이후 state) 이 있으며, Sprint 86 scope 밖. 평가 시 해당 파일이 Sprint 86 에 의해 추가로 변경되지 않았음을 확인할 것.
- TypeScript 컨벤션 준수 — `pnpm tsc --noEmit` + `pnpm lint` 0 errors.
- Vitest baseline 1558 tests PASS (Sprint 80 handoff 기준) + 신규 테스트 순증.

## Acceptance Criteria

- `AC-01` `src/types/documentMutate.ts` 가 존재하고 `DocumentId` tagged union + 3 helper (`parseObjectIdLiteral`, `documentIdFromRow`, `formatDocumentIdForMql`) 를 exports 한다.
- `AC-02` `src/types/documentMutate.test.ts` 가 3 helper 의 edge case (valid hex, non-hex ObjectId, row without `_id`, canonical EJSON wrapper, 4 DocumentId variants) 를 최소 6 케이스로 검증한다.
- `AC-03` `src/lib/mongo/mqlGenerator.ts` 가 존재하고 `generateMqlPreview(input) → MqlPreview { previewLines, commands, errors }` 를 exports 한다. `MqlCommand` 3 variants (`insertOne` / `updateOne` / `deleteOne`) 와 `MqlGenerationError` 4 variants 모두 정의된다.
- `AC-04` `mqlGenerator` 가 `pendingEdits` → `{$set: patch}` updateOne 커맨드 + `db.coll.updateOne({_id: ObjectId("...")}, {$set: {...}})` 포맷 preview 문자열을 생성한다. top-level `_id` 가 patch 에 포함되면 `id-in-patch` error 를 반환하고 해당 row 를 `commands` 에서 제외한다.
- `AC-05` `mqlGenerator` 가 sentinel cell (`"{...}"` / `"[N items]"`) 편집을 `sentinel-edit` error 로 차단한다.
- `AC-06` `mqlGenerator` 가 `pendingDeletedRowKeys` → deleteOne 커맨드 + `db.coll.deleteOne({_id: ObjectId("...")})` preview 문자열을, `pendingNewRows` → insertOne 커맨드 + `db.coll.insertOne({...})` preview 문자열을 생성한다.
- `AC-07` `src/lib/mongo/mqlGenerator.test.ts` 가 최소 7 케이스 (happy path 3 + error 3 + empty 1) 를 검증한다.
- `AC-08` `src/lib/tauri.ts` 에 `insertDocument` / `updateDocument` / `deleteDocument` 3 개 wrapper 가 추가되고, `DocumentId` 타입을 import 하며, 기존 wrapper 들의 순서 / 시그니처는 불변이다.
- `AC-09` `useDataGridEdit.ts` 의 document paradigm no-op guard 가 제거되고, `handleStartEdit` 이 document paradigm 에서도 `editingCell` + `editValue` 를 세팅한다.
- `AC-10` `useDataGridEdit.ts` 의 `handleCommit` 이 paradigm 에 따라 분기하며, document paradigm 에서 `generateMqlPreview` 를 호출해 `mqlPreview` state 를 채운다. RDB 분기 동작은 완전 불변.
- `AC-11` `useDataGridEdit.ts` 의 `handleExecuteCommit` 이 paradigm document 에서 `mqlPreview.commands` 를 순회하며 `insertDocument` / `updateDocument` / `deleteDocument` 를 호출한다. 실패 시 기존 RDB 분기와 동일한 error state 패턴을 유지한다.
- `AC-12` `useDataGridEdit` 의 반환 타입 `DataGridEditState` 에 `mqlPreview: MqlPreview | null` 필드가 추가되고, `hasPendingChanges` 가 document paradigm 의 pending state 도 반영한다.
- `AC-13` `src/components/datagrid/useDataGridEdit.document.test.ts` 가 최소 5 케이스 (start-edit / save-edit / commit / execute happy / execute failure) 를 검증한다. 기존 `useDataGridEdit.paradigm.test.ts` 의 "Sprint 66 no-op guard" 테스트는 제거 또는 "Sprint 86 edit allowed" 로 재목적화된다.
- `AC-14` `git diff --stat HEAD -- src-tauri/` empty. Backend 는 Sprint 86 에서 건드리지 않는다.
- `AC-15` `git diff --stat HEAD -- src/components/DataGrid.tsx src/components/DocumentDataGrid.tsx src/components/shared/` empty. UI 컴포넌트 수정은 Sprint 87 의 범위.
- `AC-16` `pnpm tsc --noEmit` + `pnpm lint` 0 errors.
- `AC-17` `pnpm vitest run` 전체 PASS (baseline 1558 대비 순증; 최소 +18 신규 테스트). 기존 RDB 경로 테스트 회귀 0.

## Design Bar / Quality Bar

- **Type safety**: `DocumentId` tagged union 은 discriminated union (`type` field) 패턴. 소비측 `switch (id.type)` 로 exhaustive check. `never` assertion 으로 누락 감지.
- **No `any`**: mqlGenerator / tauri wrapper 모두 `any` 금지. `Record<string, unknown>` 과 `unknown` 으로 외부 경계 표현, 내부 로직은 구체 타입.
- **Sentinel detection**: `isDocumentSentinel` (기존 `src/types/document.ts` helper 가 있으면 재사용, 없으면 `value === "{...}" || /^\[\d+ items\]$/.test(value)` 로 정의).
- **Preview 문자열 escape**: String value 의 `"` 는 backslash escape. 중첩 객체 값은 `JSON.stringify` (compact mode).
- **Deterministic order**: `previewLines` 는 insertOne → updateOne → deleteOne 순 (commit 시 의존성 방지). `commands` 배열도 동일 순서.
- **RDB 경로 불변**: `useDataGridEdit.ts` 의 RDB paradigm 분기는 1 byte 도 변경 금지 (line 추가 외). 분기 로직은 `if (paradigm === "document") { ... } else { /* 기존 RDB 로직 */ }` 형태로 감싸기.
- **Vitest 패턴**: `renderHook` + `act` from `@testing-library/react`. Store mock 은 `vi.mock("../stores/...")` 로. Tauri wrapper mock 은 `vi.mock("../../lib/tauri")`.
- **Preview format 일관성**: RDB `sqlPreview: string[]` 와 document `mqlPreview.previewLines: string[]` 모두 `string[]` — Sprint 87 이 모달에서 한 array 를 그대로 표시할 수 있게.
- **No UI coupling**: Sprint 86 은 훅 + generator + wrapper 만. `DocumentDataGrid.tsx` 는 훅 인자로 `paradigm` 을 넘기지 않음 (Sprint 87 이 wire). 따라서 Sprint 86 변경만으로 런타임 동작에 사용자 가시적 변화 없음.

## Verification Plan

### Required Checks

1. `pnpm tsc --noEmit` — 0 type errors.
2. `pnpm lint` — 0 lint errors.
3. `pnpm vitest run` — 전체 PASS. 신규 테스트 최소 +18 (types 6, mqlGenerator 7, useDataGridEdit 5), 기존 RDB 테스트 회귀 0.
4. `git diff --stat HEAD -- src-tauri/` — empty (backend 불변).
5. `git diff --stat HEAD -- src/components/DataGrid.tsx src/components/DocumentDataGrid.tsx` — empty.
6. `git diff --stat HEAD -- src/components/shared/` — empty.
7. `git diff --stat HEAD -- docs/` — `docs/sprints/sprint-86/**` 외 empty.

**Orchestrator-scope 추가 체크**:
- `cd src-tauri && cargo test --lib` — Sprint 80 baseline 226 PASS 유지 (회귀 0 증명).
- `cd src-tauri && cargo test --test mongo_integration` — Sprint 80 baseline 11 PASS 유지.

### Required Evidence

- Generator must provide:
  - 변경/추가 파일 목록 + 역할.
  - 7 개 required check 의 실행 커맨드 + 결과 요약.
  - 각 AC (AC-01 ~ AC-17) → 구체 증거 (file:line 또는 테스트 이름).
  - `useDataGridEdit.ts` 의 document / rdb 분기 위치 file:line range.
  - `mqlGenerator.generateMqlPreview` 구현 body file:line.
  - 3 개 Tauri wrapper file:line.
  - 기존 `useDataGridEdit.paradigm.test.ts` 의 Sprint 66 테스트 제거 / 재목적화 증명 (diff 또는 before/after 스니펫).
  - Pre-existing ConnectionDialog.tsx diff 가 추가로 변경되지 않았음을 증명 (`git diff --stat HEAD src/components/connection/` 출력 비교).

- Evaluator must cite:
  - `DocumentId` 타입 정의 실 코드 확인.
  - `mqlGenerator` 3 variants (`insertOne` / `updateOne` / `deleteOne`) 생성 실 코드 확인.
  - `useDataGridEdit.ts` paradigm 분기 실 코드 확인.
  - 3 Tauri wrapper 실 코드 확인.
  - Test 실행 로그 (vitest stats, 0 failed).
  - `git diff --stat` 결과 (backend empty, UI empty).

## Test Requirements

### Unit Tests (필수)

- `src/types/documentMutate.test.ts`: 최소 6 케이스 (AC-02).
- `src/lib/mongo/mqlGenerator.test.ts`: 최소 7 케이스 (AC-07).
- `src/components/datagrid/useDataGridEdit.document.test.ts`: 최소 5 케이스 (AC-13).

총 신규 +18 테스트 이상.

### Scenario Tests

- [x] Happy path — update / delete / insert 각 MQL 생성 + 실행.
- [x] 에러/예외 — missing `_id`, `_id` in patch, sentinel edit, empty diff.
- [x] 경계 조건 — 단일 row / multiple rows / 빈 patch.
- [x] 기존 기능 회귀 없음 — RDB path 테스트 전부 PASS, 백엔드 테스트 회귀 0.

## Test Script / Repro Script

1. `pnpm tsc --noEmit`
2. `pnpm lint`
3. `pnpm vitest run src/types/documentMutate.test.ts src/lib/mongo/mqlGenerator.test.ts src/components/datagrid/useDataGridEdit.document.test.ts`
4. `pnpm vitest run` (전체)
5. `git diff --stat HEAD -- src-tauri/` (empty)
6. `git diff --stat HEAD -- src/components/DataGrid.tsx src/components/DocumentDataGrid.tsx src/components/shared/` (empty)
7. `cd src-tauri && cargo test --lib` (baseline 유지)

## Ownership

- Generator: Sprint 86 harness generator.
- Write scope (수정 허용):
  - `src/components/datagrid/useDataGridEdit.ts`
  - `src/components/datagrid/useDataGridEdit.paradigm.test.ts` (Sprint 66 테스트 제거/재목적화 목적으로만)
  - `src/lib/tauri.ts`
- Write scope (신규 생성):
  - `src/types/documentMutate.ts`
  - `src/types/documentMutate.test.ts`
  - `src/lib/mongo/mqlGenerator.ts`
  - `src/lib/mongo/mqlGenerator.test.ts`
  - `src/components/datagrid/useDataGridEdit.document.test.ts`
  - `docs/sprints/sprint-86/findings.md` + `handoff.md` (평가 후 생성)
- 그 외 파일 **전부 read-only**. 특히:
  - `src-tauri/**` 전체 (backend 불변)
  - `src/components/DataGrid.tsx` / `src/components/DocumentDataGrid.tsx` (Sprint 87)
  - `src/components/shared/**` (Sprint 87)
  - `src/components/datagrid/sqlGenerator.ts` (RDB 생성기 불변)
  - `src/types/document.ts`, `src/types/connection.ts` (canonical EJSON / Paradigm 타입 이미 올바름)
  - `src/stores/**`
  - `docs/**` 중 `docs/sprints/sprint-86/` 외
  - `src/components/connection/ConnectionDialog.tsx` (pre-existing workspace state — 건드리지 말 것)
- Merge order: Sprint 86 PASS → Sprint 87 (F-3 UI completion) 착수.

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes` (7 개 generator-scope + 2 orchestrator)
- Acceptance criteria evidence linked in `handoff.md`
- Rust backend + UI 컴포넌트 + 모달 diff 0 증명
