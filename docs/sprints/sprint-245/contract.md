# Sprint Contract: sprint-245

## Summary

- Goal: ADR 0022 Phase 1 — Sprint 244 의 production+strict = read-only 정책을 lib + 모든 호출 경로 + Sprint 243 의 `useSafeModeReadOnly` UI 게이트까지 원복하고, `decideSafeModeAction` 을 새 destructive-only 정책 (+ non-prod strict-mode destructive dialog) 으로 재작성한다. mode 3-tier 의미만 재정의 (store/UI/persistence 변경 없음).
- Audience: Generator + Evaluator agents (harness 흐름)
- Owner: Phase 1 (Sprint 245)
- Verification Profile: `command`

## In Scope

- `src/lib/safeMode.ts` — `decideSafeModeAction` 본문 재작성. `SQL_WRITE_KINDS` 상수 제거. block 액션은 destructive (DROP/TRUNCATE/ALTER DROP/WHERE-less DELETE·UPDATE) 에만 발생. safe write 는 `allow` 리턴. non-prod 도 mode === "strict" 면 destructive 에 confirm.
- `src/hooks/useSafeModeGate.ts` — `useSafeModeReadOnly` export + 본문 + JSDoc 제거. `useSafeModeGate.decide` 만 남김. JSDoc 정책 매트릭스 갱신.
- `src/components/rdb/DataGrid.tsx` — `useSafeModeReadOnly` import + `safeModeReadOnly` flag + 4 guarded handler (`guardedHandleStartEdit` / `guardedHandleAddRow` / `guardedHandleDeleteRow` / `guardedHandleDuplicateRow`) 제거. raw 핸들러 (`handleStartEdit` 등) 를 `DataGridTable` / `DataGridToolbar` 에 직결. 관련 destructure (`rawHandleStartEdit` 등) 도 정리.
- `src/components/datagrid/DataGridToolbar.tsx` — `readOnly?: boolean` prop + `readOnlyTitle` const + 모든 `disabled={readOnly || ...}` / `title={readOnlyTitle ?? ...}` 분기 제거. AC-185 / AC-186 toolbar 흐름은 보존.
- `src/components/workspace/SafeModeToggle.tsx` — `MODE_META.strict.tooltip` / `warn.tooltip` / `off.tooltip` 텍스트를 새 정책 (M.1 의미 재정의: strict=all-env destructive dialog, warn=prod-only, off=prod-auto) 으로 다시 작성. icon / aria-pressed / 토글 순환 그대로 유지.
- 테스트 정렬:
  - `src/lib/safeMode.test.ts` — `[AC-244-01..08]` 8 케이스 invert/제거 (read-only 정책 가정). 새 정책 매트릭스 8 representative 케이스 (`L1..L8`) 추가.
  - `src/hooks/useSafeModeGate.test.ts` — `useSafeModeReadOnly` describe block 5 케이스 전체 제거. wiring describe 만 남김.
  - `src/components/rdb/DataGrid.editing.test.tsx` — `[AC-185-06]` 의 `useSafeModeStore.setState({ mode: "warn" })` 명시 추가 (Sprint 243 회피용) 제거 — 이제 prod+strict 에서도 cell-edit 통과하므로 mode 무관.
  - `src/components/datagrid/useDataGridEdit.safe-mode.test.ts` — `[AC-244-10]` (prod+strict + DELETE WHERE pk → block) invert 원복: prod+strict + safe DML 은 다시 pass-through (`executeQueryBatch` 호출). 헤더 코멘트도 새 정책으로 갱신.
  - `src/components/query/EditableQueryResultGrid.safe-mode.test.tsx` — `[AC-244-09]` (prod+strict + UPDATE WHERE pk → block) invert 원복: pass-through. 헤더 코멘트 갱신.
  - `src/components/query/QueryTab.safe-mode.test.tsx` — `[AC-244-11..14]` 4 케이스 제거 (read-only 정책 가정). Matrix coverage 코멘트 갱신. **NEW**: `[AC-245-01]` non-prod + strict + DROP TABLE → confirm dialog (M.1 신규 흐름) 추가.
  - `src/components/workspace/SafeModeToggle.test.tsx` — tooltip 텍스트 검증 (있으면) 새 정책으로.

## Out of Scope

- Dialog UI redesign — `ConfirmDangerousDialog` 의 헤더 텍스트 변경 / `PRODUCTION DATABASE` 라벨 / dry-run preview 영역 / reason-타이핑 → 단순 Yes/No 전환은 모두 **Phase 2 (Sprint 246)**.
- dry-run 백엔드 IPC + transaction wrapper — **Phase 3 (Sprint 247)**.
- 별도 Dry Run 버튼 / Cmd+Shift+Enter — **Phase 4 (Sprint 248)**.
- Cmd+Z pending undo — **Phase 5 (Sprint 249)**.
- Mongo 처리 변경 — Mongo 정책은 변경 없음 (현재 `analyzeMongoPipeline` 분류기 + `decideSafeModeAction` 결과 그대로 통함).

## Invariants

- prod + warn + destructive → confirm dialog (현재 `ConfirmDangerousDialog` 텍스트 그대로). Phase 2 에서 변경 예정이지만 Phase 1 에서는 보존.
- prod + off → prod-auto 로 strict equivalent block (= confirm 으로 강등은 Phase 2 에서 dialog UI 통일과 함께). Phase 1 에서는 prod + off + destructive 가 여전히 block 응답 — 단 정책 함수가 `confirm` 을 리턴하도록 바뀌면 호출자 (`useQueryExecution` / `useDataGridEdit`) 에서 dialog 트리거. 실제 dialog 텍스트 변경은 Phase 2.
- non-prod + warn / off → 항상 통과 (변경 없음).
- 모든 SELECT / Mongo read pipeline → 항상 통과 (변경 없음).
- IPC 시그니처 변경 0 — `executeQuery` / `executeQueryBatch` / `aggregateDocuments` / `findDocuments` 모두 그대로.
- store / persistence 변경 0 — `safeModeStore` 의 `mode` enum 그대로 (`strict | warn | off`), localStorage key 그대로.
- `safe-mode-sync` cross-window IPC channel 그대로.

## Acceptance Criteria

### lib decision matrix (`safeMode.test.ts`)

- `AC-245-L1` mode=strict + env=non-prod + destructive (DROP TABLE) → `{ action: "confirm", reason: <verbatim> }`. **NEW** — M.1 신규 흐름.
- `AC-245-L2` mode=strict + env=non-prod + safe write (UPDATE WHERE / INSERT / CREATE) → `{ action: "allow" }`.
- `AC-245-L3` mode=strict + env=non-prod + read (SELECT) → `{ action: "allow" }`.
- `AC-245-L4` mode=warn + env=non-prod + * → `{ action: "allow" }` (3 statement classes 모두).
- `AC-245-L5` mode=off + env=non-prod + * → `{ action: "allow" }`.
- `AC-245-L6` mode=strict|warn|off + env=production + destructive → `{ action: "confirm" }`. (off 는 prod-auto copy, strict/warn 은 toolbar override copy.)
- `AC-245-L7` mode=strict|warn|off + env=production + safe write → `{ action: "allow" }`.
- `AC-245-L8` mode=strict|warn|off + env=production + read → `{ action: "allow" }`.

### hook (`useSafeModeGate.test.ts`)

- `AC-245-H1` `useSafeModeReadOnly` symbol 부재 (import 시 TypeScript 에러).
- `AC-245-H2` `useSafeModeGate.decide` 는 store mode/env 변경에 정상 propagation.

### DataGrid component

- `AC-245-G1` env=production + mode=strict 인 connection 의 DataGrid 렌더 시 cell 더블클릭 → 입력 input 등장 (Sprint 243 read-only 토스트 차단 회귀 방지).
- `AC-245-G2` 동일 조건에서 toolbar Add / Delete / Duplicate 버튼 `disabled` 미적용 (`readOnly` prop 사라짐).
- `AC-245-G3` `DataGridToolbar` 의 `readOnly` prop 부재 (TypeScript 에러).

### commit-preview hooks

- `AC-245-C1` `useDataGridEdit.handleExecuteCommit` — env=production + mode=strict + safe DML (DELETE WHERE pk) → `executeQueryBatch` 호출 1회 (Sprint 244 block 원복).
- `AC-245-C2` 동일 hook + WHERE-less DELETE → confirm dialog (or 기존 block) — `executeQueryBatch` 미호출 (기존 destructive 게이트 보존).
- `AC-245-C3` `EditableQueryResultGrid` — env=production + mode=strict + UPDATE WHERE pk → `executeQueryBatch` 호출 1회.
- `AC-245-C4` `useQueryExecution.handleExecute` — env=production + mode=strict + INSERT INTO → `executeQuery` 호출 1회.
- `AC-245-C5` 동일 hook + DROP TABLE → `executeQuery` 미호출 + queryState=error 또는 confirm dialog (기존 destructive 게이트 보존).

### NEW dev strict-mode flow

- `AC-245-N1` `useQueryExecution.handleExecute` — env=development + mode=strict + DROP TABLE → confirm dialog (`pendingRdbConfirm` 셋) — M.1 신규 흐름.
- `AC-245-N2` 동일 + env=development + mode=warn + DROP TABLE → `executeQuery` 호출 1회 (warn 은 non-prod 에서 dialog 안 띄움).

### tooltip

- `AC-245-T1` `SafeModeToggle` tooltip — strict mode 일 때 텍스트가 "all environments" 또는 "production + non-production strict" 의미를 포함 (정책 매트릭스 일치).
- `AC-245-T2` 동일 — warn mode tooltip 이 "production only" 의미.
- `AC-245-T3` 동일 — off mode tooltip 이 "production-auto" 의미 (변경 없음).

## Design Bar / Quality Bar

- 새 정책의 single source of truth 는 `decideSafeModeAction`. 다른 hook / component test 는 매트릭스를 재검증하지 말고 `decideSafeModeAction` 결과만 mock 으로 확인 (단일 케이스).
- Sprint 244 invert 된 AC 번호 (`AC-244-09..14`) 는 테스트 코드에서 **삭제 또는 rename**. 같은 번호 재사용 금지.
- ESLint 0 errors / 0 warnings.
- TypeScript 0 errors.
- vitest 모든 테스트 통과 (현재 2938 → Sprint 245 후 ~2934 ± 신규 케이스).
- Rust 변경 없음 → cargo test / clippy 변동 없음 (회귀 가드 차원에서만 실행).

## Verification Plan

### Required Checks

1. `pnpm tsc --noEmit` — 0 errors. `useSafeModeReadOnly` import 잔존 시 fail.
2. `pnpm lint` — 0 errors / 0 warnings.
3. `pnpm vitest run` — 모든 테스트 통과. 신규 AC 케이스 (`AC-245-L1..L8`, `AC-245-G1..3`, `AC-245-C1..5`, `AC-245-N1..2`, `AC-245-T1..3`) 명시적 코드 매칭.
4. `cargo test --lib --manifest-path src-tauri/Cargo.toml` — 회귀 가드 (Rust 미변경이지만 안전망).
5. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` — 회귀 가드.

### Required Evidence

- Generator must provide:
  - 변경 파일 목록 + 각 파일의 변경 의도 (1 줄)
  - 위 5 checks 의 stdout/stderr 발췌 (passing 확인)
  - 신규 AC `AC-245-*` 가 어떤 테스트 파일의 어떤 `it(...)` 로 매핑되는지 명시
  - Sprint 244 invert 된 AC (`AC-244-09..14`) 가 어떻게 처리됐는지 (삭제 / rename / 본문 변경) 명시
  - 가정 / 잔여 위험 (예: prod + off 의 dialog vs block 결정이 Phase 2 로 이월되는데 그 사이의 임시 동작)
- Evaluator must cite:
  - 각 AC 항목별로 테스트 파일:라인 또는 코드 위치
  - 변경 파일별 spot-check (해당 변경이 진짜 contract 의 변경 의도를 반영하는지)
  - 회귀 발견 시 구체적 지점 (파일:라인)

## Test Requirements

### Unit Tests (필수)

- `safeMode.test.ts` 매트릭스 8 케이스 (`AC-245-L1..L8`) 추가/재작성.
- `useDataGridEdit.safe-mode.test.ts` `[AC-244-10]` 원복 → safe DML pass-through 검증.
- `EditableQueryResultGrid.safe-mode.test.tsx` `[AC-244-09]` 원복 → safe DML pass-through 검증.
- `QueryTab.safe-mode.test.tsx` `[AC-244-11..14]` 제거 + `AC-245-N1..N2` 추가.
- `useSafeModeGate.test.ts` — `useSafeModeReadOnly` describe block 제거.

### Coverage Target

- 변경 파일 (`safeMode.ts`, `useSafeModeGate.ts`, `DataGrid.tsx`, `DataGridToolbar.tsx`, `SafeModeToggle.tsx`): 라인 70% 이상.
- 전체 CI: 라인 40% / 함수 40% / 브랜치 35% (현재 통과 기준 유지).

### Scenario Tests (필수)

- [x] Happy path — prod + warn + safe write → allow
- [x] 에러/예외 — Sprint 244 invert 의 backward compat (테스트가 fail 시 원인 명확)
- [x] 경계 조건 — non-prod + strict + destructive (M.1 신규 흐름), prod + off + destructive (prod-auto)
- [x] 회귀 없음 — 기존 prod+warn+danger confirm dialog, prod+off+danger block, non-prod allow 모두 보존

## Test Script / Repro Script

```bash
# 변경 파일 목록
git diff --stat HEAD

# 1. 타입체크
pnpm tsc --noEmit

# 2. 린트
pnpm lint

# 3. 변경 영역 타겟 테스트 (빠른 피드백)
pnpm vitest run \
  src/lib/safeMode.test.ts \
  src/hooks/useSafeModeGate.test.ts \
  src/components/rdb/DataGrid.editing.test.tsx \
  src/components/datagrid/useDataGridEdit.safe-mode.test.ts \
  src/components/query/EditableQueryResultGrid.safe-mode.test.tsx \
  src/components/query/QueryTab.safe-mode.test.tsx \
  src/components/workspace/SafeModeToggle.test.tsx

# 4. 전체 회귀
pnpm vitest run

# 5. Rust 회귀 가드
cargo test --lib --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
```

## Ownership

- Generator: harness Generator agent (general-purpose)
- Write scope: 위 In Scope 의 파일들만. Out of Scope 영역 (dialog UI / dry-run / Cmd+Z) 은 변경 금지.
- Merge order: 단일 commit 권장 — 정책 원복 + 테스트 정렬은 atomic. lefthook pre-commit 통과 필수.

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes`
- Acceptance criteria evidence linked in `handoff.md`
- Sprint 244 invert AC (`AC-244-09..14`) 모두 처리 완료 (재사용 흔적 없음)
- ADR 0022 본문과 일관성 유지 (Phase 1 의 In Scope / Out of Scope 가 ADR 의 트레이드오프와 일치)
