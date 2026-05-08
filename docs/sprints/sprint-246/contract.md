# Sprint Contract: sprint-246

## Summary

- Goal: ADR 0022 Phase 2 — `ConfirmDangerousDialog` 의 type-to-confirm 게이트를
  단순 Yes/No 로 단순화하고, 헤더를 환경 인지 (`PRODUCTION DATABASE` vs
  `Destructive statement (Safe Mode strict)`) 로 분기하며, Phase 3 에서 채울
  dry-run preview 영역을 placeholder 로 잡는다. 컴포넌트 이름을
  `ConfirmDestructiveDialog` 로 rename 하고 모든 호출자/테스트를 정렬한다.
- Audience: Generator + Evaluator agents (harness 흐름)
- Owner: Phase 2 (Sprint 246)
- Verification Profile: `command`

## In Scope

### 새 컴포넌트 (rename + 재작성)

- `src/components/workspace/ConfirmDestructiveDialog.tsx` — 신규 파일.
  - Props: `{ open, reason, sqlPreview, environment, onConfirm, onCancel }`.
    `environment` 는 `"production" | "non-production"` (string literal union).
  - 헤더 / 제목:
    - `environment === "production"` → 제목 `"PRODUCTION DATABASE"`,
      서브카피 `"Destructive statement"`.
    - `environment === "non-production"` → 제목 `"Destructive statement"`,
      서브카피 `"Safe Mode (strict) — non-production"`.
  - 본문:
    - `Reason: <reason>` 한 줄 (기존과 동일).
    - **Statement preview**: `<pre aria-label="Statement preview">{sqlPreview}</pre>`
      (기존 preview 보존).
    - **Dry-run preview placeholder**: `<section aria-label="Dry-run preview" data-testid="dry-run-placeholder">`
      안에 `"Dry-run preview will appear here (Phase 3)."` 문구. 실제 dry-run
      실행은 Phase 3 (Sprint 247) 에서 채움.
  - 푸터: `Cancel` + `Confirm` 버튼만. `Confirm` 은 항상 enabled (type-to-
    confirm 제거). Enter 키 누르면 `onConfirm` 호출.
  - `data-testid="confirm-dangerous-input"` 입력 필드 + `disabled` 게이팅 모두
    제거. `data-testid="confirm-destructive-confirm"` 와
    `data-testid="confirm-destructive-cancel"` 를 두 버튼에 부여 (테스트
    매핑용).
  - Default export 는 `ConfirmDestructiveDialog`.
- `src/components/workspace/ConfirmDestructiveDialog.test.tsx` — 신규 파일.
  - `[AC-246-D1]` `environment="production"` → 헤더에 `"PRODUCTION DATABASE"` 노출.
  - `[AC-246-D2]` `environment="non-production"` → 헤더 `"Destructive statement"`
    + 서브카피 `"Safe Mode (strict)"` 포함.
  - `[AC-246-D3]` Confirm 버튼 즉시 enabled (type-to-confirm 제거 확인).
  - `[AC-246-D4]` Confirm 클릭 → `onConfirm` 1회 호출.
  - `[AC-246-D5]` Cancel 클릭 → `onCancel` 1회 호출.
  - `[AC-246-D6]` Enter 키 입력 → `onConfirm` 1회 호출 (input 위에서 누르지
    않아도 dialog 자체에서).
  - `[AC-246-D7]` `dry-run-placeholder` 영역이 DOM 에 렌더되고 placeholder
    카피 ("Phase 3") 를 노출.

### 구 컴포넌트 제거

- `src/components/workspace/ConfirmDangerousDialog.tsx` — **삭제**. 동일 이름
  symbol 잔존 금지.
- `src/components/workspace/ConfirmDangerousDialog.test.tsx` — **삭제**.
  `[AC-186-03a..e]` 시리즈는 새 dialog 의 `[AC-246-D1..D7]` 로 대체된다.

### 호출자 (rename + `environment` prop 주입)

다음 파일에서 `ConfirmDangerousDialog` import / JSX → `ConfirmDestructiveDialog`
로 변경하고 `environment` prop 을 호출 시점에 결정해 전달한다. `environment`
는 호출자의 `connectionId` 를 통해 `useConnectionStore` 에서 lookup 하거나,
이미 호출자가 들고 있는 connection 정보에서 파생한다 (각 파일별 helper 추가
허용).

- `src/components/rdb/DataGrid.tsx`
- `src/components/query/QueryTab.tsx` (Mongo + RDB 두 군데)
- `src/components/query/EditableQueryResultGrid.tsx`
- `src/components/query/useRawQueryGridEdit.ts` (dialog 자체는 호출자에 마운트
  되므로 주석/타입만 갱신)
- `src/components/datagrid/useDataGridEdit.ts` (JSDoc 만 갱신)
- `src/components/schema/DropTableDialog.tsx`
- `src/components/schema/DropColumnDialog.tsx`
- `src/components/schema/AddColumnDialog.tsx`
- `src/components/schema/RenameTableDialog.tsx`
- `src/components/schema/CreateTableDialog.tsx`
- `src/components/structure/ColumnsEditor.tsx`
- `src/components/structure/ConstraintsEditor.tsx`
- `src/components/structure/IndexesEditor.tsx`
- `src/components/structure/useDdlPreviewExecution.ts` (dialog 자체는 호출자에
  마운트되므로 주석/타입만 갱신)
- `src/components/workspace/SafeModeToggle.tsx` (docstring 의
  `ConfirmDangerousDialog` → `ConfirmDestructiveDialog` 갱신)

### 테스트 정렬 (호출자 테스트 — 새 dialog API 로 회귀 가드)

- `src/components/rdb/DataGrid.editing.test.tsx` — `[AC-186-06]` 의 dialog
  assertion 을 type-to-confirm → 단순 Confirm 클릭으로 갱신. `screen.findByTestId
  ("confirm-dangerous-input")` 같은 매칭 모두 제거.
- `src/components/schema/DropTableDialog.test.tsx`
- `src/components/schema/DropColumnDialog.test.tsx`
- `src/components/structure/ColumnsEditor.test.tsx`
- `src/components/structure/ConstraintsEditor.test.tsx`
- `src/components/structure/IndexesEditor.test.tsx`
- `src/components/query/EditableQueryResultGrid.safe-mode.test.tsx`
- `src/components/query/QueryTab.safe-mode.test.tsx`
- `src/components/query/QueryTab.document.test.tsx`

테스트 변경 패턴:
- `getByTestId("confirm-dangerous-input")` + `fireEvent.change(...)` + Run anyway
  click → `getByRole("button", { name: "Confirm" })` 또는
  `getByTestId("confirm-destructive-confirm")` 직접 click.
- `getByText("Confirm dangerous statement")` → `getByText("PRODUCTION DATABASE")`
  또는 `getByText("Destructive statement")` (호출자 환경에 맞게).
- AC 번호 재발급 금지 — 기존 `[AC-186-06]` 등은 그대로 두되 본문만 새 dialog
  API 에 맞게 수정. 신규 케이스는 `[AC-246-*]` 시리즈만.

## Out of Scope

- dry-run 백엔드 IPC + transaction wrapper (PG/MySQL/SQLite) — **Phase 3
  (Sprint 247)**. Phase 2 의 placeholder 영역은 정적 텍스트만.
- Mongo dry-run fallback (single-node 미지원) — Phase 3.
- 별도 "Dry Run" 버튼 / Cmd+Shift+Enter 단축키 — Phase 4.
- Cmd+Z pending undo 단축키 — Phase 5.
- `decideSafeModeAction` 매트릭스 변경 — Phase 1 (Sprint 245) 에서 확정. 호출
  결과를 dialog 가 어떻게 표시하느냐만 Phase 2 가 다룬다.
- Mongo 정책 변경 — 변경 없음. Mongo dialog 도 동일 컴포넌트 사용 (rename +
  Yes/No + environment prop 적용).

## Invariants

- `decideSafeModeAction` 결과 (`{ action: "confirm" | "allow", reason }`) 의
  shape / 의미는 Phase 1 그대로. 호출자가 `confirm` 응답을 받았을 때만
  dialog 마운트한다는 흐름 보존.
- `useDataGridEdit.pendingConfirm` / `useQueryExecution.pendingRdbConfirm` /
  `useRawQueryGridEdit.pendingConfirm` / DDL editor 들의 `pendingConfirm` 모두
  shape 보존: `{ reason: string, sql: string | string[], statementIndex?: number }`.
  Phase 2 에서 새 prop (`environment`) 추가는 hook 외부 (호출자 컴포넌트) 에서
  계산해 dialog 에 주입하므로 hook 시그니처 변경 0.
- Mongo 호출자 (`QueryTab.tsx` 의 `pendingMongoConfirm`) 도 동일 dialog 사용 —
  `environment` 만 connection 에서 파생.
- IPC 시그니처 변경 0 (`executeQuery` / `executeQueryBatch` 등 모두 그대로).
- store / persistence 변경 0 — `safeModeStore` mode enum / localStorage key
  그대로.
- 기존 AC `[AC-186-06]` 등의 호출자 테스트의 *behavioral* 의도는 보존 — 단지
  dialog 상호작용 메커니즘만 type-to-confirm → Confirm click 으로 변경.

## Acceptance Criteria

### Dialog 컴포넌트 (`ConfirmDestructiveDialog.test.tsx`)

- `AC-246-D1` `environment="production"` → 헤더에 `"PRODUCTION DATABASE"` 텍스트
  렌더링.
- `AC-246-D2` `environment="non-production"` → 헤더에 `"Destructive statement"` +
  `"Safe Mode (strict)"` 표기 렌더링.
- `AC-246-D3` Confirm 버튼 초기 상태 enabled (type-to-confirm 부재).
- `AC-246-D4` Confirm 클릭 → `onConfirm` 1회.
- `AC-246-D5` Cancel 클릭 → `onCancel` 1회.
- `AC-246-D6` Enter 키 → `onConfirm` 1회.
- `AC-246-D7` `data-testid="dry-run-placeholder"` 노드 존재 + Phase 3 placeholder
  카피 노출.

### Rename 회귀 가드

- `AC-246-R1` `ConfirmDangerousDialog.tsx` 파일 부재 (`ls` 또는 grep 으로 0).
- `AC-246-R2` 코드베이스 전반에서 `ConfirmDangerousDialog` symbol 부재 (rg 결과
  0). 단, `docs/sprints/` / `memory/` 내 역사 기록은 허용.
- `AC-246-R3` `data-testid="confirm-dangerous-input"` 부재 (rg 0).

### 호출자 회귀 가드 (기존 AC 보존)

- `AC-246-W1` `[AC-186-06]` (DataGrid editing.test) — warn + production +
  dangerous → 새 dialog 가 `"PRODUCTION DATABASE"` 헤더로 마운트 + Confirm
  버튼 즉시 enabled. 기존 의도 (mounting on warn-tier) 보존.
- `AC-246-W2` `[AC-186-04b]` (`useDataGridEdit.safe-mode.test.ts`) —
  `confirmDangerous()` 호출이 여전히 `executeQueryBatch` 1회 호출. 흐름 변경
  없음.
- `AC-246-W3` `[AC-186-05b]` (`EditableQueryResultGrid.safe-mode.test.tsx`) —
  warn dialog Confirm click → `executeQueryBatch` 1회. (입력 type 단계 제거 후
  바로 click.)
- `AC-246-W4` `[AC-185-04c]` / `[AC-185-05c]` 등 dev+strict 흐름 — dialog 가
  `"Destructive statement"` + `"Safe Mode (strict)"` 헤더로 마운트.

### 환경 prop 파생

- `AC-246-E1` 호출자가 `useConnectionStore` 의 `environment` 가 `"production"`
  이면 `environment="production"` 을, 그 외 (`null` 포함) 면 `"non-production"`
  을 전달한다. (헬퍼는 `connection.environment === "production" ? "production"
  : "non-production"` 단일 표현식 권장.)

## Design Bar / Quality Bar

- 대용량 호출자 변경이지만 단일 commit 권장 — rename 은 atomic. lefthook
  pre-commit 통과 필수.
- TypeScript 0 errors. ESLint 0 errors / 0 warnings.
- vitest 모든 테스트 통과. 신규 `[AC-246-*]` 매핑 명시.
- 기존 dialog 의 verbatim 카피 (`"Confirm dangerous statement"`) 를 검색하는
  테스트는 모두 새 헤더 카피로 갱신 — orphan grep 잔존 금지.

## Verification Plan

### Required Checks

1. `pnpm tsc --noEmit` — 0 errors. `ConfirmDangerousDialog` import 잔존 시 fail.
2. `pnpm lint` — 0 errors / 0 warnings.
3. `pnpm vitest run` — 모든 테스트 통과. 신규 `AC-246-D1..D7` / `AC-246-R1..R3`
   / `AC-246-W1..W4` / `AC-246-E1` 매핑 코드 증거 명시.
4. `rg "ConfirmDangerousDialog" src/` — `0` (역사 기록은 `docs/`, `memory/`,
   주석에 허용되지만 import / JSX 시점 0).
5. `rg "confirm-dangerous-input" src/` — `0`.
6. `cargo test --lib --manifest-path src-tauri/Cargo.toml` — 회귀 가드.
7. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` — 회귀 가드.

### Required Evidence

- Generator must provide:
  - 변경 / 신규 / 삭제 파일 목록 + 1줄 의도.
  - 위 7 checks 의 stdout/stderr 발췌 (passing 확인).
  - `[AC-246-*]` ↔ 테스트 파일:라인 매핑 표.
  - 기존 `[AC-186-03a..e]` 가 어떻게 처리됐는지 (삭제 + 신규 `[AC-246-D*]` 시리즈로
    대체) 명시.
  - 호출자 테스트의 type-to-confirm 흐름이 어떻게 단순 Confirm click 으로 마이그
    되었는지 sample 1~2 인용.
  - 가정 / 잔여 위험 (예: dialog 가 environment 모를 때의 fallback).
- Evaluator must cite:
  - 각 AC 항목별로 테스트 파일:라인 또는 코드 위치.
  - rename 회귀 가드 (`AC-246-R*`) 가 코드 grep 결과로 검증되는지 직접 명령
    재실행.
  - 헤더 카피 (`"PRODUCTION DATABASE"`, `"Destructive statement"`) 가
    `ConfirmDestructiveDialog.tsx` 본문에 정확히 존재하는지 spot-check.

## Test Requirements

### Unit Tests (필수)

- `ConfirmDestructiveDialog.test.tsx` 신규 7 케이스 (`AC-246-D1..D7`).
- 호출자 dialog 상호작용을 다루는 9개 테스트 파일 — type-to-confirm 흐름 제거
  + 신규 헤더 카피 매칭.

### Coverage Target

- 변경 파일 (`ConfirmDestructiveDialog.tsx`, 호출자 컴포넌트 / 훅): 라인 70%
  이상 권장.
- 전체 CI: 라인 40% / 함수 40% / 브랜치 35% (현재 통과 기준 유지).

### Scenario Tests (필수)

- [x] Happy path — production + warn + DELETE WHERE pk → 새 dialog 마운트 +
  Confirm click → executeQueryBatch.
- [x] 에러/예외 — Cancel click → executeError set, executeQueryBatch 미호출.
- [x] 경계 조건 — non-production + strict + DROP TABLE → 새 dialog 마운트
  ("Destructive statement" 헤더).
- [x] 회귀 없음 — 기존 schema editor (Drop / DropColumn / AddColumn /
  CreateTable / RenameTable / DDL editors) dialog 흐름 모두 통과.

## Test Script / Repro Script

```bash
# 변경 파일 목록
git diff --stat HEAD

# 1. 타입체크
pnpm tsc --noEmit

# 2. 린트
pnpm lint

# 3. dialog + 호출자 타겟 테스트
pnpm vitest run \
  src/components/workspace/ConfirmDestructiveDialog.test.tsx \
  src/components/rdb/DataGrid.editing.test.tsx \
  src/components/datagrid/useDataGridEdit.safe-mode.test.ts \
  src/components/query/EditableQueryResultGrid.safe-mode.test.tsx \
  src/components/query/QueryTab.safe-mode.test.tsx \
  src/components/query/QueryTab.document.test.tsx \
  src/components/schema/DropTableDialog.test.tsx \
  src/components/schema/DropColumnDialog.test.tsx \
  src/components/structure/ColumnsEditor.test.tsx \
  src/components/structure/ConstraintsEditor.test.tsx \
  src/components/structure/IndexesEditor.test.tsx

# 4. 전체 회귀
pnpm vitest run

# 5. Rename grep 검증
rg "ConfirmDangerousDialog" src/   # 0 expected
rg "confirm-dangerous-input" src/  # 0 expected

# 6. Rust 회귀 가드
cargo test --lib --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
```

## Ownership

- Generator: harness Generator agent (general-purpose)
- Write scope: 위 In Scope 의 파일들만. Out of Scope 영역 (dry-run 실행 / Cmd+Z
  / 별도 dry-run 버튼) 은 변경 금지.
- Merge order: 단일 commit 권장 — rename + dialog UI + 호출자 정렬은 atomic.
  lefthook pre-commit 통과 필수.

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes` (전체 7 check)
- Acceptance criteria evidence linked in `handoff.md`
- `ConfirmDangerousDialog` symbol / `confirm-dangerous-input` testid 잔존 0
- ADR 0022 본문 Phase 2 의 In Scope (헤더 + Yes/No + placeholder) 와 일관성
  유지
