# Sprint Contract: sprint-187

## Summary

- **Goal**: Phase 23 / TablePlus 패리티 #5 — **Structure surface 색띠 +
  warn 가드**. Sprint 185 의 색띠 + Sprint 186 의 warn 다이얼로그 패턴을
  `ColumnsEditor` / `IndexesEditor` / `ConstraintsEditor` 의 공유
  `SqlPreviewDialog` 위에 확장. (a) `analyzeStatement` 가 분류하는
  danger kind 를 structure surface 의 실제 SQL 까지 cover 하도록 확장
  (`DROP INDEX`, `ALTER TABLE … DROP COLUMN`, `ALTER TABLE … DROP
  CONSTRAINT`), (b) `PreviewDialog` 에 `headerStripe` slot 추가 (전역
  preset), (c) 구조 편집기의 `SqlPreviewDialog` 에 `environment` prop
  + `connectionEnvironment` 주입, (d) 3 편집기에 strict / warn 가드 inject
  + `ConfirmDangerousDialog` mount.
- **Audience**: Generator (single agent) — implements; Evaluator — verifies AC.
- **Owner**: harness orchestrator.
- **Verification Profile**: `mixed` (browser smoke 권장 — DDL drop 시
  색띠 + 다이얼로그 동작이 사람이 보는 contract).

## In Scope

- `AC-187-01`: **`analyzeStatement` 확장** — `src/lib/sqlSafety.ts`:
  - 새 `StatementKind` 값 `"ddl-alter-drop"` 추가.
  - `^DROP\s+(TABLE|DATABASE|SCHEMA|INDEX|VIEW)\b` → `kind: "ddl-drop"`,
    `severity: "danger"`, `reasons: ["DROP <NOUN>"]`. 기존 TABLE /
    DATABASE / SCHEMA 분기 유지하면서 `INDEX` / `VIEW` 추가.
  - `^ALTER\s+TABLE\b ... \bDROP\s+(COLUMN|CONSTRAINT)\b` →
    `kind: "ddl-alter-drop"`, `severity: "danger"`,
    `reasons: ["ALTER TABLE DROP COLUMN"]` 또는
    `["ALTER TABLE DROP CONSTRAINT"]`.
  - `ALTER TABLE ADD COLUMN`, `ALTER TABLE ADD CONSTRAINT`,
    `CREATE INDEX`, `CREATE TABLE` 은 `ddl-other / safe` 유지 (회귀
    invariant).
  - `kind` 값 추가는 비-breaking (`StatementKind` union 확장).

- `AC-187-02`: **`PreviewDialog` 의 `headerStripe` slot** —
  `src/components/ui/dialog/PreviewDialog.tsx`:
  - 새 prop `headerStripe?: ReactNode`. `<DialogHeader>` 위에 렌더.
  - 기본 `null` (모든 기존 caller 무영향).
  - 회귀 테스트: 명시적으로 추가하지 않음 (downstream
    `SqlPreviewDialog.test.tsx` 에서 cover).

- `AC-187-03`: **구조 편집기 `SqlPreviewDialog` 색띠** —
  `src/components/structure/SqlPreviewDialog.tsx`:
  - 새 prop `environment?: EnvironmentTag | null`.
  - `environment` 가 `ENVIRONMENT_META` 키이면 `headerStripe` 로 1px-h
    색띠 div 전달 (DataGrid / EditableQueryResultGrid 와 동일 표현 —
    `data-environment-stripe={environment}` + `aria-hidden="true"`).
  - default `null` → stripe 미표시 (기존 caller 가 해당 prop 을 안 주면
    회귀 0).

- `AC-187-04`: **`ColumnsEditor` warn 가드 inject**:
  - `connectionEnvironment` 와 `safeMode` 를 store 에서 read.
  - `handleExecute` 에서 `previewSql` 을 `;` 로 split 하고 각 statement
    를 `analyzeStatement`. production + 어떤 statement 가 danger 일 때:
    - `safeMode === "strict"` → `previewError` 를 strict 표준 문구
      (`"Safe Mode blocked: <reason> (toggle Safe Mode off in toolbar
      to override)"`) 로 set, return.
    - `safeMode === "warn"` → component-local `pendingConfirm` state
      (`{ reason, sql }`) set, `runAlter` 보류, `<ConfirmDangerousDialog>`
      mount.
    - `safeMode === "off"` 또는 production 이 아님 → 기존 흐름.
  - `confirmDangerous` / `cancelDangerous` 핸들러:
    - confirm: `pendingConfirm` clear → `runAlter` (Sprint 186 의
      `runRdbBatch` 와 동일 패턴 — body 추출).
    - cancel: `previewError` 를 warn 표준 문구 (`"Safe Mode (warn):
      confirmation cancelled — no changes committed"`) 로 set,
      `pendingConfirm` clear. (구조 편집기는 별도 toast 미사용 —
      `previewError` 만으로 표시. 이유: 다이얼로그 footer 가 이미 inline
      에러 표시.)
  - `<SqlPreviewDialog>` 에 `environment={connectionEnvironment}` 전달.
  - `{pendingConfirm && <ConfirmDangerousDialog ... />}` 마운트.

- `AC-187-05`: **`IndexesEditor` warn 가드** — 동일 패턴. `runAlter`
  대응으로 `pendingExecuteRef.current` 호출이 보류되어야 한다.
  `confirmDangerous` 는 `pendingExecuteRef.current()` 를 호출 후 cleanup.
  `cancelDangerous` 는 `previewError` set 후 `pendingExecuteRef` 만 비움
  (다이얼로그는 user 가 닫음).

- `AC-187-06`: **`ConstraintsEditor` warn 가드** — `IndexesEditor` 와
  동일 구조 (둘 다 `pendingExecuteRef` 패턴).

- `AC-187-07`: **회귀 + 시나리오 테스트**:
  - `sqlSafety.test.ts` (UPDATE): 기존 14 케이스 + 신규 5 케이스 =
    19 케이스. `[AC-187-01a]` ~ `[AC-187-01e]`.
  - `SqlPreviewDialog.test.tsx` (UPDATE): 기존 5 케이스 + 신규 1 케이스
    (environment stripe 렌더) = 6 케이스. `[AC-187-03a]`.
  - `ColumnsEditor.test.tsx` (UPDATE): 기존 케이스 + warn 시나리오 3 +
    strict 시나리오 1 + 색띠 1 = 신규 5 케이스 (`[AC-187-04a]` ~
    `[AC-187-04e]`).
  - `IndexesEditor.test.tsx` (NEW 또는 UPDATE if exists): 5 케이스.
  - `ConstraintsEditor.test.tsx` (NEW 또는 UPDATE if exists): 5 케이스.
  - 신규 테스트 파일은 Sprint 186 컨벤션 그대로 — `[AC-187-XXa]` prefix
    + `// AC-187-XXa — <reason>; date 2026-05-01.` 코멘트.

## Out of Scope

- **`useDataGridEdit` / `EditableQueryResultGrid` 변경 0** — Sprint 186
  이 이미 cover. 본 sprint 의 analyzer 확장은 자동 반영 (production +
  warn + DROP INDEX 등 입력 시 `analyzeStatement` 가 danger 분류 → 기존
  warn 가드 트리거). 회귀 테스트 추가는 Out of Scope.
- **Mongo dangerous-op** — Sprint 188.
- **`safety_level` 필드** — Sprint 185 / 186 와 동일.
- **DDL 의 테이블명 typing override** — Sprint 186 의 contract 와 동일
  (parser 도입 후의 별 sprint).
- **`SqlPreviewDialog` (구조 surface) 가 raw `Dialog` 로 마이그레이션** —
  현재 `PreviewDialog` 프리셋 위에 색띠 slot 만 추가. 다이얼로그
  primitive 변경 0.
- **`pendingExecuteRef` 의 ref → state 전환** — IndexesEditor /
  ConstraintsEditor 의 ref 패턴 유지. ref 가 가지는 stale 위험은
  pendingConfirm state 가 단일 in-flight statement 만 보유하는 동시성
  invariant 로 cover (commit 버튼 자체가 in-flight 시 disable).

### Files allowed to modify

- `src/lib/sqlSafety.ts` — analyzer 분기 확장.
- `src/lib/sqlSafety.test.ts` — 5 케이스 추가.
- `src/components/ui/dialog/PreviewDialog.tsx` — `headerStripe` slot 추가.
- `src/components/structure/SqlPreviewDialog.tsx` — `environment` prop 추가.
- `src/components/structure/SqlPreviewDialog.test.tsx` — stripe 회귀 1 케이스.
- `src/components/structure/ColumnsEditor.tsx` — warn 가드 inject + dialog wiring.
- `src/components/structure/ColumnsEditor.test.tsx` — 5 케이스 추가.
- `src/components/structure/IndexesEditor.tsx` — 동일.
- `src/components/structure/IndexesEditor.test.tsx` — NEW 또는 UPDATE.
- `src/components/structure/ConstraintsEditor.tsx` — 동일.
- `src/components/structure/ConstraintsEditor.test.tsx` — NEW 또는 UPDATE.
- `docs/sprints/sprint-187/contract.md` (this file).
- `docs/sprints/sprint-187/findings.md` (new).
- `docs/sprints/sprint-187/handoff.md` (new).

## Invariants

- **Sprint 186 산출물**: `safeModeStore`, `SafeModeToggle`,
  `ConfirmDangerousDialog`, `useDataGridEdit`, `EditableQueryResultGrid`,
  `DataGrid` 의 commit 분기 무수정.
- **Sprint 185 / 186 의 block message 표준 문구** 무변동.
- **`ENVIRONMENT_META`** (`src/types/connection.ts`) 무변동.
- **`PreviewDialog` 의 기존 caller** (CellDetailDialog 등) 무영향 —
  `headerStripe` 는 optional + default null.
- **`it.skip` / `it.todo` / `xit` 0건** (skip-zero gate).
- **strict TS / ESLint**: `any` 금지, `pnpm tsc --noEmit` zero,
  `pnpm lint` zero.
- **`src-tauri/` git diff = empty** — 백엔드 변경 0.
- **`src/types/connection.ts` git diff = empty**.
- **Sprint 186 `ConfirmDangerousDialog` git diff = empty**.

## Acceptance Criteria

- `AC-187-01` — sqlSafety analyzer DDL 분기 확장 회귀 통과 (19 케이스).
- `AC-187-02` — `PreviewDialog` 의 `headerStripe` slot 회귀 통과
  (downstream tests 에서 간접 cover).
- `AC-187-03` — `SqlPreviewDialog` (구조) production stripe 렌더 회귀 통과.
- `AC-187-04` — ColumnsEditor strict / warn / confirm / cancel /
  stripe 회귀 통과 (5 케이스).
- `AC-187-05` — IndexesEditor 동일 5 케이스 통과.
- `AC-187-06` — ConstraintsEditor 동일 5 케이스 통과.
- `AC-187-07` — 위 모든 검증 + skip-zero + Sprint 186 산출물 git diff = 0.

## Design Bar / Quality Bar

- **`headerStripe` slot 추가는 `PreviewDialog` 의 기존 contract 보존** —
  prop 하나 추가, default null, 모든 기존 호출자 무영향.
- **DDL drop 분류는 prefix 기반 정규식**. `ALTER TABLE … DROP …` 의
  multi-statement 는 첫 매칭 reason 만 보고. 향후 multi-clause ALTER
  (`ALTER TABLE t DROP COLUMN a, ADD COLUMN b`) 는 첫 DROP 으로 분류.
- **테스트 명명**: `[AC-187-0X]` prefix. 각 신규/추가 테스트에
  `// AC-187-0X — <reason>; date 2026-05-01.` 코멘트.
- **커버리지**: 신규 라인 80% 이상. 새 분기 100%.

## Verification Plan

### Required Checks

1. `pnpm vitest run src/lib/sqlSafety.test.ts
   src/components/structure/SqlPreviewDialog.test.tsx
   src/components/structure/ColumnsEditor.test.tsx
   src/components/structure/IndexesEditor.test.tsx
   src/components/structure/ConstraintsEditor.test.tsx` — 5 파일 green.
2. `pnpm vitest run` — 전체 suite green (회귀 0).
3. `pnpm tsc --noEmit` — zero errors.
4. `pnpm lint` — zero errors.
5. `cd src-tauri && cargo test --lib` + clippy + fmt — clean.
6. **Static**:
   - `git diff src-tauri/` — empty.
   - `git diff src/types/connection.ts` — empty.
   - `git diff src/components/workspace/ConfirmDangerousDialog.tsx
     src/components/workspace/SafeModeToggle.tsx
     src/stores/safeModeStore.ts` — empty (Sprint 186 산출물 동결).
   - `grep -RnE 'it\.(skip|todo)|xit\(' <new test files>` → 0 matches.

## Test Requirements

### Unit Tests (필수)

- **`sqlSafety.test.ts`** (+5):
  - `[AC-187-01a] DROP INDEX → danger`
  - `[AC-187-01b] DROP VIEW → danger`
  - `[AC-187-01c] ALTER TABLE … DROP COLUMN → ddl-alter-drop / danger`
  - `[AC-187-01d] ALTER TABLE … DROP CONSTRAINT → ddl-alter-drop / danger`
  - `[AC-187-01e] ALTER TABLE … ADD COLUMN → ddl-other / safe (regression)`

### Component Tests (필수)

- **`SqlPreviewDialog.test.tsx`** (+1):
  - `[AC-187-03a] production environment renders color stripe with
    data-environment-stripe="production"`.
- **`ColumnsEditor.test.tsx`** (+5):
  - `[AC-187-04a] production + strict + DROP COLUMN preview → execute
    blocked, strict error message`
  - `[AC-187-04b] production + warn + DROP COLUMN preview → pendingConfirm
    set, alterTable not called`
  - `[AC-187-04c] confirmDangerous → alterTable called`
  - `[AC-187-04d] cancelDangerous → previewError set with warn message`
  - `[AC-187-04e] non-production environment → no gate, alterTable
    called immediately on safe ADD COLUMN`
- **`IndexesEditor.test.tsx`** (+5): 동일 시나리오 with DROP INDEX.
- **`ConstraintsEditor.test.tsx`** (+5): 동일 시나리오 with DROP CONSTRAINT.

### Coverage Target

- 신규 라인 80% 이상. 새 분기 100%.

## Ownership

- Generator: single agent.
- Write scope (정확): 위 §"Files allowed to modify".
- Untouched: `CLAUDE.md`, `memory/`, `src/types/connection.ts`,
  `package.json`, `Cargo.toml`, `src-tauri/`, Sprint 186 산출물.
- Merge order: Sprint 186 머지 후 (commit `8bbc5a7`). Phase 23 종료는
  Sprint 188 (Mongo dangerous-op) 완료 시점.

## Exit Criteria

- 열린 `P1` / `P2` findings: `0`
- Required checks 통과: `yes` (1–6 in Verification Plan)
- `docs/sprints/sprint-187/findings.md` 존재 + 사양대로 섹션 채움.
- `docs/sprints/sprint-187/handoff.md` 에 AC 별 evidence 행 (한 행 =
  한 AC).
