# Sprint Contract: sprint-186

## Summary

- **Goal**: Phase 23 / TablePlus 패리티 #4 — Safe Mode **warn 모드 + DDL
  typing confirm**. Sprint 185 의 strict / off 2-mode 위에 (a) `"warn"`
  3rd mode 추가, (b) `SafeModeToggle` 3-way 순환 (strict → warn → off
  → strict), (c) **`ConfirmDangerousDialog`** 신규 — type-to-confirm
  input 으로 위험 SQL 의 reason 문자열을 정확히 재입력해야 진행, (d)
  `useDataGridEdit.handleExecuteCommit` / `EditableQueryResultGrid.handleExecute`
  의 strict 분기 옆에 warn 분기 inject (production + warn + danger →
  confirm 다이얼로그 표시 → 사용자 타이핑 → Confirm 시 commit 재개,
  Cancel 시 error state). 백엔드 변경 0. Sprint 185 의 `analyzeStatement`,
  `safeModeStore`, `attachZustandIpcBridge`, block message 표준 문구
  무수정 (warn 메시지는 별도 표준 문구).
- **Audience**: Generator (single agent) — implements; Evaluator — verifies AC.
- **Owner**: harness orchestrator
- **Verification Profile**: `mixed` (browser smoke 권장 — focus trap +
  type-to-confirm UX 가 사람이 보는 동작이므로).

## In Scope

- `AC-186-01`: **`SafeMode` 타입 확장** — `src/stores/safeModeStore.ts`:
  ```ts
  export type SafeMode = "strict" | "warn" | "off";
  ```
  - `mode` 의 default 는 `"strict"` 그대로.
  - `setMode(next: SafeMode)` 시그니처 변동 없음 (이제 3 값 받음).
  - `toggle()` 의 의미 변경 — strict → warn → off → strict 순환:
    ```ts
    toggle: () => set({
      mode:
        get().mode === "strict" ? "warn" :
        get().mode === "warn" ? "off" : "strict",
    });
    ```
  - persist partialize 무변동 (`{ mode }` 만).
  - SYNCED_KEYS 무변동 (`["mode"]`).
  - localStorage 의 기존 `"strict"` / `"off"` 값은 그대로 호환 (3rd 값
    "warn" 추가만). 기존 사용자 데이터 마이그레이션 불필요.

- `AC-186-02`: **`SafeModeToggle` 3-way 시각** — `src/components/workspace/SafeModeToggle.tsx`:
  - strict: `ShieldCheck` icon (기존 그대로) + `"Safe Mode"` 라벨 +
    border `#ef4444` (production accent).
  - **warn (NEW)**: `ShieldAlert` icon + `"Safe Mode: Warn"` 라벨 +
    border `#f59e0b` (amber accent).
  - off: `ShieldOff` icon (기존) + `"Safe Mode: Off"` 라벨 + muted-foreground.
  - aria-pressed: strict → `"true"`, warn → `"mixed"`, off → `"false"`
    (W3C ARIA tristate 패턴).
  - data-mode: 그대로 (`strict` / `warn` / `off`).
  - 클릭 → `toggle()` 호출 (3-way 순환).
  - title (tooltip) 모드별 문구.

- `AC-186-03`: **`ConfirmDangerousDialog` (NEW)** — `src/components/workspace/ConfirmDangerousDialog.tsx`:
  - props:
    ```ts
    interface ConfirmDangerousDialogProps {
      open: boolean;
      reason: string;       // analyzeStatement.reasons[0]
      sqlPreview: string;   // 사용자에게 보여줄 위험 SQL (요약 1줄)
      onConfirm(): void;
      onCancel(): void;
    }
    ```
  - layer 1 primitive: `<AlertDialog>` (Sprint 96 의 `ConfirmDialog`
    패턴 재사용). tone="destructive".
  - 본문:
    1. Title: `"Confirm dangerous statement"`.
    2. Description: `Reason: <reason>` + `<code>` 블록으로 sqlPreview.
    3. **Type-to-confirm input** — 라벨 `"Type "<reason>" to confirm"`,
       값 일치 시에만 Confirm 버튼 활성화. `disabled` 와 `aria-disabled`
       모두 반영.
  - Confirm 버튼: `variant="destructive"`, label `"Run anyway"`.
  - Cancel 버튼: `variant="ghost"`, label `"Cancel"`.
  - 키보드:
    - Escape → onCancel (radix 기본 동작 유지).
    - Enter (input 포커스 상태) → 일치하면 onConfirm.
  - 포커스: dialog open 시 type input 자동 포커스 (radix
    `AlertDialogContent` autoFocus 기본).
  - 회귀 테스트: 5 케이스 — (a) 비활성 상태에서 Confirm disabled,
    (b) reason 정확히 타이핑 시 enabled, (c) Confirm 클릭 → onConfirm
    호출, (d) Cancel 클릭 → onCancel, (e) 일치 후 다시 mismatch 입력
    → Confirm 다시 disabled.

- `AC-186-04`: **`useDataGridEdit` warn 분기 inject**:
  - 기존 strict 분기 (Sprint 185) 그대로 유지.
  - 새 분기: `mode === "warn"` 그리고 `connectionEnvironment === "production"`
    그리고 어떤 statement 가 danger → `setPendingConfirm({ reason,
    sql, statementIndex })` 후 즉시 return. UI 가 다이얼로그 표시.
  - Hook 이 노출하는 신규 state:
    ```ts
    pendingConfirm: { reason: string; sql: string; statementIndex: number } | null;
    confirmDangerous(): Promise<void>;   // 사용자가 Confirm 누르면 실제 commit 진행
    cancelDangerous(): void;             // 사용자가 Cancel 누르면 error state set
    ```
  - `confirmDangerous` 는 기존 commit pipeline (executeQueryBatch +
    state cleanup + fetchData + toast) 을 그대로 실행 — danger gate 만
    bypass.
  - `cancelDangerous` 는 `commitError.message` 를 `"Safe Mode (warn):
    confirmation cancelled — no changes committed"` 로 set (별 표준
    문구). 토스트는 `toast.info` (에러 아님 — 사용자 의도).
  - useCallback 의 dep list 에 새 selector 추가.

- `AC-186-05`: **`EditableQueryResultGrid` warn 분기 inject**:
  - 동일 패턴. `pendingConfirm` 은 컴포넌트 local state.
  - Confirm 시 기존 `executeQueryBatch` 호출. Cancel 시 `setExecuteError`
    가 warn 표준 문구.
  - Dialog mount 위치: 컴포넌트 root (`<>...</>` 안), `<Dialog>` 형제.

- `AC-186-06`: **DataGrid (구조 뷰) 무수정 — 본 sprint 가 cover 안 함**.
  - DataGrid 는 raw query editor 를 래핑하지 않고 `useDataGridEdit`
    훅을 통해 commit 한다. AC-186-04 의 hook 변경이 자동 반영.
  - 즉 DataGrid 자체 코드는 무수정 (확인 다이얼로그는 hook 의 state 를
    소비하는 새 Dialog mount 1 개 추가만).
  - 최소 변경: `DataGrid.tsx` 의 commit dialog 옆에 `<ConfirmDangerousDialog>`
    1 개 mount + `pendingConfirm` / `confirmDangerous` / `cancelDangerous`
    wiring.

- `AC-186-07`: **회귀 + 시나리오 테스트**:
  - `safeModeStore.test.ts` (UPDATE): 기존 5 케이스 + warn 추가 3 케이스
    = 8 케이스. `[AC-186-01a] toggle: strict → warn`, `[AC-186-01b]
    toggle: warn → off`, `[AC-186-01c] toggle: off → strict` (3-way
    순환 핀).
  - `SafeModeToggle.test.tsx` (UPDATE): 기존 3 케이스 + warn 시각 1
    케이스 + 3-way 순환 1 케이스 = 5 케이스.
  - `ConfirmDangerousDialog.test.tsx` (NEW): 5 케이스 (위 AC-186-03).
  - `useDataGridEdit.safe-mode.test.ts` (UPDATE): 기존 4 케이스 + warn
    분기 3 케이스 = 7 케이스. 신규: `[AC-186-04a] production + warn +
    danger → pendingConfirm set, executeQueryBatch not called`,
    `[AC-186-04b] confirmDangerous → executeQueryBatch called`,
    `[AC-186-04c] cancelDangerous → commitError set with warn message`.
  - `EditableQueryResultGrid.safe-mode.test.tsx` (UPDATE): 기존 4 +
    warn 3 = 7 케이스 (동일 시나리오).
  - `DataGrid.test.tsx`: 최소 1 개 mount 회귀 (warn + danger → dialog
    rendered) — 기존 색띠 회귀 옆에 추가.

## Out of Scope

- **Structure surface 색띠** (`ColumnsEditor` / `IndexesEditor` /
  `ConstraintsEditor` 의 `SqlPreviewDialog`) — Sprint 187. 패턴 동일하나
  surface 가 더 많아 별 sprint.
- **Mongo dangerous-op 분류** — Mongo `db.collection.drop()` /
  `deleteMany({})` 같은 위험 op 는 Sprint 188. 본 sprint 의 warn
  다이얼로그는 RDB 분기에서만 트리거. Mongo paradigm 의 commit 동작은
  무수정.
- **`safety_level` 필드** — Sprint 185 와 동일한 결정. 본 sprint 도
  environment 만으로 충분.
- **DDL 의 테이블명 typing override** — DROP TABLE users 시 사용자가
  "users" 를 입력하게 하는 정밀 typing. 본 sprint 는 reason 문자열
  ("DROP TABLE") 만 typing 으로 받는다. 이유: reason 은 모든 danger
  kind 에 일관되게 존재 (DELETE without WHERE / UPDATE without WHERE
  / DROP TABLE / DROP DATABASE / DROP SCHEMA / TRUNCATE). 테이블명
  추출은 SQL parser 가 필요. parser 도입은 Sprint 189+.
- **다중 danger statement 의 batch confirm** — `analyzeStatement`
  loop 가 *첫* danger 에서 멈추고 다이얼로그 표시. 사용자가 Confirm 시
  *모든* statement 가 commit (그 안의 다른 danger statement 도 함께).
  사용자가 step-by-step confirm 을 원하는 경우는 별 sprint.
- **warn 모드 의 cross-window broadcast 동작** — store 의 `mode` 가
  `"warn"` 으로도 broadcast 되는지는 Sprint 185 의 `attachZustandIpcBridge`
  가 자동 cover. 별도 회귀 테스트 추가 안 함 (`syncKeys: ["mode"]`
  invariant 유지).
- **Sprint 185 산출물의 동작 변경 0** — `analyzeStatement` 무수정.
  `safeModeStore` 는 type 만 확장 (`"warn"` 추가) + toggle 의미 변경 —
  signature 무변동.

### Files allowed to modify

- `src/stores/safeModeStore.ts` — `SafeMode` 타입 확장 + `toggle` 3-way.
- `src/stores/safeModeStore.test.ts` — 케이스 추가 (5 → 8).
- `src/components/workspace/SafeModeToggle.tsx` — warn icon/label/border.
- `src/components/workspace/SafeModeToggle.test.tsx` — 케이스 추가 (3 → 5).
- **NEW** `src/components/workspace/ConfirmDangerousDialog.tsx` — type-to-confirm dialog.
- **NEW** `src/components/workspace/ConfirmDangerousDialog.test.tsx` — 5 케이스.
- `src/components/datagrid/useDataGridEdit.ts` — warn 분기 inject + 신규 state/액션 노출.
- `src/components/datagrid/useDataGridEdit.safe-mode.test.ts` — 케이스 추가 (4 → 7).
- `src/components/query/EditableQueryResultGrid.tsx` — warn 분기 inject + Dialog mount.
- `src/components/query/EditableQueryResultGrid.safe-mode.test.tsx` — 케이스 추가 (4 → 7).
- `src/components/rdb/DataGrid.tsx` — `<ConfirmDangerousDialog>` 1 개 mount + hook state wiring.
- `src/components/rdb/DataGrid.test.tsx` — warn 다이얼로그 회귀 1 케이스.
- `docs/sprints/sprint-186/contract.md` (this file).
- `docs/sprints/sprint-186/findings.md` (new).
- `docs/sprints/sprint-186/handoff.md` (new).

## Invariants

- **Sprint 185 산출물**: `src/lib/sqlSafety.ts` (analyzer) 무수정.
  `safeModeStore` 의 storage key 무변동. `block message` 표준 문구
  (`"Safe Mode blocked: ... (toggle Safe Mode off in toolbar to override)"`)
  변동 없음. warn 메시지는 *별도 표준 문구* (`"Safe Mode (warn):
  confirmation cancelled — no changes committed"`).
- **`environment === null` 연결의 동작 무변동** — production 식별 안
  되는 연결은 warn 모드라도 다이얼로그 미표시 (통과).
- **Mongo paradigm 무영향** — RDB 분기에서만 warn 다이얼로그 트리거.
- **신규 런타임 의존성 0** — `package.json` / `Cargo.toml` 미변경.
  `lucide-react` 의 `ShieldAlert` 만 추가 import (이미 설치됨).
- **`it.skip` / `it.todo` / `xit` 0건** (skip-zero gate). Rust 측
  `#[ignore]` 0건 net new (변경 없음).
- **strict TS / ESLint**: `any` 금지, `pnpm tsc --noEmit` zero,
  `pnpm lint` zero.
- **`src-tauri/` git diff = empty**.
- **`src/types/connection.ts` git diff = empty**.

## Acceptance Criteria

- `AC-186-01` — `SafeMode` 타입 + `toggle` 3-way 순환 단위 테스트 통과 (8 케이스).
- `AC-186-02` — `SafeModeToggle` 3-way 시각 회귀 통과 (5 케이스).
- `AC-186-03` — `ConfirmDangerousDialog` type-to-confirm + 키보드 회귀 통과 (5 케이스).
- `AC-186-04` — useDataGridEdit warn 분기 + confirmDangerous/cancelDangerous 시나리오 통과 (7 케이스).
- `AC-186-05` — EditableQueryResultGrid 동일 7 시나리오 통과.
- `AC-186-06` — DataGrid mount 회귀 통과 (1 케이스).
- `AC-186-07` — 위 모든 검증 + skip-zero + Sprint 185 산출물 git diff = 0
  (analyzer / sqlSafety.test.ts 변경 없음, safeModeStore 의 type 확장
  + toggle 분기 외 변경 없음).

## Design Bar / Quality Bar

- **`ConfirmDangerousDialog` 는 layer-1 primitive 만 사용** — Sprint
  96 dialog convention 준수. radix 직접 호출 금지.
- **type-to-confirm 비교는 trim + case-sensitive** — reason 문자열은
  analyzer 가 항상 같은 형식으로 emit (`"DELETE without WHERE clause"`,
  `"DROP TABLE"`) 하므로 사용자 입력도 정확히 일치해야 한다. trim 만
  적용 (양 끝 공백 허용). 대소문자는 일치 강제.
- **3-way toggle 순환 순서 표준화**: `strict → warn → off → strict`.
  사용자가 strict 에서 한 번 클릭 → 즉시 off 로 가지 않고 warn 을
  거친다 (실수로 가드 완전 해제 방지).
- **warn 모드 다이얼로그 메시지 표준**:
  - Cancel 시: `"Safe Mode (warn): confirmation cancelled — no
    changes committed"`.
  - Confirm 시: 별도 메시지 없음 (commit 정상 진행 — `"N changes
    committed"` 토스트 그대로).
- **테스트 명명**: `[AC-186-0X]` prefix. 각 신규/추가 테스트에
  `// AC-186-0X — <reason>; date 2026-05-01.` 코멘트 (auto-memory
  `feedback_test_documentation.md`).
- **커버리지**: 신규 라인 80% 이상. ConfirmDangerousDialog 의 모든
  분기 (disabled/enabled/confirm/cancel) 100%.

## Verification Plan

### Required Checks

1. `pnpm vitest run src/stores/safeModeStore.test.ts
   src/components/workspace/SafeModeToggle.test.tsx
   src/components/workspace/ConfirmDangerousDialog.test.tsx
   src/components/datagrid/useDataGridEdit.safe-mode.test.ts
   src/components/query/EditableQueryResultGrid.safe-mode.test.tsx
   src/components/rdb/DataGrid.test.tsx` — 6 파일 green.
2. `pnpm vitest run` — 전체 suite green (회귀 0).
3. `pnpm tsc --noEmit` — zero errors.
4. `pnpm lint` — zero errors.
5. `cd src-tauri && cargo test --lib` + clippy + fmt — clean.
6. **Static (Generator-recorded, Evaluator re-runs)**:
   - `git diff src-tauri/` — empty.
   - `git diff src/types/connection.ts` — empty.
   - `git diff src/lib/sqlSafety.ts src/lib/sqlSafety.test.ts` — empty.
   - `grep -RnE 'it\.(skip|todo)|xit\(' <new test files>` → 0 matches.

### Required Evidence

- Generator: 변경 파일 목록 (purpose 한 줄씩); Vitest stdout 일부;
  `findings.md` 섹션 (3-way 순환 결정 / type-to-confirm 비교 정책 /
  Out of Scope DDL 정밀 typing 이유 / warn 메시지 표준 / AC→테스트
  매핑); `handoff.md` AC 별 evidence 행.
- Evaluator: AC 별 통과 evidence 인용 + invariant `git diff` 확인.

## Test Requirements

### Unit Tests (필수)

- **`src/stores/safeModeStore.test.ts`** (8 = 기존 5 + 신규 3):
  - `[AC-186-01a] toggle: strict → warn`
  - `[AC-186-01b] toggle: warn → off`
  - `[AC-186-01c] toggle: off → strict`

### Component Tests (필수)

- **`SafeModeToggle.test.tsx`** (5 = 기존 3 + 신규 2):
  - `[AC-186-02a] warn renders shield-alert + "Safe Mode: Warn" label + aria-pressed="mixed"`
  - `[AC-186-02b] click cycles strict → warn → off → strict`
- **`ConfirmDangerousDialog.test.tsx`** (5 NEW):
  - `[AC-186-03a] Confirm disabled when input empty`
  - `[AC-186-03b] Confirm enabled when input matches reason exactly`
  - `[AC-186-03c] Confirm click invokes onConfirm`
  - `[AC-186-03d] Cancel click invokes onCancel`
  - `[AC-186-03e] mismatch after match re-disables Confirm`
- **`useDataGridEdit.safe-mode.test.ts`** (7 = 기존 4 + 신규 3):
  - `[AC-186-04a] production + warn + WHERE-less DELETE → pendingConfirm set, executeQueryBatch not called`
  - `[AC-186-04b] confirmDangerous → executeQueryBatch called once`
  - `[AC-186-04c] cancelDangerous → commitError set with warn message + toast.info`
- **`EditableQueryResultGrid.safe-mode.test.tsx`** (7 = 기존 4 + 신규 3):
  - 동일 3 시나리오.
- **`DataGrid.test.tsx`** (+1):
  - `[AC-186-06] warn + danger → ConfirmDangerousDialog rendered with reason`

### Coverage Target

- 신규 라인 80% 이상. `ConfirmDangerousDialog` 의 모든 분기 100%.

### Scenario Tests (필수)

- [x] Happy path — warn + Confirm → commit 진행.
- [x] 빈/누락 입력 — type-to-confirm 빈 input → Confirm disabled.
- [x] 에러 복구 — Cancel 후 사용자가 토글을 strict 또는 off 로 변경 → 다음 commit 정상 흐름.
- [x] 동시성 — pendingConfirm 이 set 된 동안 두 번째 commit 시도는
      previous pendingConfirm 을 덮어씀 (single dialog instance).
      회귀 테스트 추가하지 않음 (commit 버튼 자체가 disabled 되는
      기존 invariant).
- [x] 상태 전이 — strict → warn → off → strict 순환 확인.
- [x] 회귀 — Mongo 분기 무영향, strict 분기 (Sprint 185) 무영향.

## Test Script / Repro Script

1. `pnpm install`.
2. `pnpm vitest run <6 files in §Required Checks>`.
3. `pnpm vitest run` (full suite).
4. `pnpm tsc --noEmit`.
5. `pnpm lint`.
6. `cd src-tauri && cargo test --lib` + clippy + fmt.
7. Static greps + invariant `git diff` (Verification Plan §6).
8. (Optional) Operator browser smoke — production-tagged 연결 →
   토글 클릭 (strict → warn) → `EditableQueryResultGrid` 에서 raw
   `DELETE FROM users` 입력 → Cmd+S → Commit 클릭 → 다이얼로그 표시,
   `DELETE without WHERE clause` 타이핑 → Confirm 활성화 → 클릭 →
   commit 진행. 별도 시나리오: 다이얼로그에서 Cancel → toast.info +
   executeError 표시.

## Ownership

- Generator: single agent.
- Write scope (정확): 위 §"Files allowed to modify".
- Untouched: `CLAUDE.md`, `memory/`, `src/types/connection.ts`,
  `src/lib/sqlSafety.ts` (analyzer 는 동결), `package.json`, `Cargo.toml`,
  `src-tauri/` 전체, Mongo adapter / dispatch 코드, Sprint 185 의 block
  message 표준 문구.
- Merge order: Sprint 185 머지 후 (commit `6f4006d`). Phase 23 의 후속
  sprint (Sprint 187 structure surface, Sprint 188 Mongo dangerous-op)
  가 본 sprint 위에서 시작.

## Exit Criteria

- 열린 `P1` / `P2` findings: `0`
- Required checks 통과: `yes` (1–6 in Verification Plan)
- `docs/sprints/sprint-186/findings.md` 존재 + 사양대로 섹션 채움.
- `docs/sprints/sprint-186/handoff.md` 에 AC 별 evidence 행 (한 행 =
  한 AC).
