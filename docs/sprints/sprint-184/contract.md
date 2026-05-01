# Sprint Contract: sprint-184

## Summary

- **Goal**: Phase 22 / TablePlus 패리티 #3 — **Phase 22 종료 sprint**.
  Sprint 182 (PendingChangesTray + PK 가드) 와 Sprint 183 (RDB 트랜잭션
  wrap) 으로 update / insert / delete 세 mutation 경로가 모두 단일
  Preview/Commit/Discard 게이트를 통과하도록 정렬됐다. 본 sprint 는
  **신규 기능 0** 으로, 다음 두 보강만 한다:
  1. **Mixed-batch 회귀 가드** — 한 commit 안에 UPDATE + INSERT + DELETE
     가 동시에 들어 있을 때 RDB 분기는 단일 `executeQueryBatch` 한 번,
     Mongo 분기는 `dispatchMqlCommand` 가 (insertOne / updateOne /
     deleteOne) 모두 호출되는지 핀.
  2. **N=100+ pending changes 성능 smoke** — `handleCommit` 의 SQL/MQL
     preview 빌드가 1초 이내에 완료되고, `sqlPreview` (또는
     `mqlPreview.commands`) 길이가 정확히 입력 N 과 같음을 단언.
  추가로 **Phase 22 종료 마킹** — `docs/phases/phase-22.md` 의 상태를
  "계획" → "완료" 로 갱신하면서 Exit Criteria 별 sprint 매핑을 기록.
- **Audience**: Generator (single agent) — implements; Evaluator — verifies AC.
- **Owner**: harness orchestrator
- **Verification Profile**: `command` (browser smoke 불필요 — 본 sprint
  는 회귀 가드 + 성능 smoke + 메타 갱신만).

## In Scope

- `AC-184-01`: **`useDataGridEdit` RDB mixed-batch 회귀**.
  새 테스트 파일 `src/components/datagrid/useDataGridEdit.mixed-batch.test.ts`
  (또는 기존 `commit-error.test.ts` 에 추가) — `paradigm: "rdb"` 에서
  같은 hook 인스턴스에 (a) `pendingEdits` 1건, (b) `pendingNewRows` 1건,
  (c) `pendingDeletedRowKeys` 1건 을 모두 만든 뒤 `handleCommit()` →
  `handleExecuteCommit()` 를 실행한다. 단언:
  - `mockExecuteQueryBatch` 가 정확히 1회 호출됐다.
  - 호출 인자 `statements` 의 길이는 3.
  - `statements` 안에 `/^UPDATE /`, `/^INSERT INTO /`, `/^DELETE FROM /`
    가 각각 1건씩 출현 (statement 종류 별 회귀 가드).
  - `mockExecuteQuery` 는 호출되지 않는다 (Sprint 183 gate).

- `AC-184-02`: **`useDataGridEdit` Mongo mixed-batch 회귀**.
  같은 파일 또는 `useDataGridEdit.document.test.ts` 에 추가 — `paradigm:
  "document"` 에서 (a) edit, (b) new row, (c) delete 를 동시에 만든 뒤
  `handleCommit()` → `handleExecuteCommit()`. 단언:
  - `mockInsertDocument` 1회, `mockUpdateDocument` 1회, `mockDeleteDocument`
    1회 호출.
  - `mockExecuteQueryBatch` / `mockExecuteQuery` 는 0회 (회귀 가드 —
    Mongo 가 RDB 경로로 새지 않음).
  - 호출 순서는 `mqlPreview.commands` 와 일치 (insertOne → updateOne →
    deleteOne, 또는 generator 가 emit 한 순서).

- `AC-184-03`: **RDB 100-edit perf smoke**.
  새 테스트 — 100 행 fixture 에서 모든 행의 한 컬럼을 편집 (100 건
  pendingEdits) → `handleCommit()` 호출이 1초 (1000ms) 이내 완료 +
  `sqlPreview` 길이 === 100 + 모두 `^UPDATE ` 시작. budget 은 CI 에서
  flake 회피용으로 1000ms (조잡한 상한) — 실측 < 50ms 면 충분.

- `AC-184-04`: **RDB 100-delete perf smoke**.
  같은 fixture — `handleSelectRow` + `handleDeleteRow` 로 100 행 모두
  삭제 큐잉 → `handleCommit()` < 1000ms + `sqlPreview` 길이 === 100 +
  모두 `^DELETE FROM ` 시작.

- `AC-184-05`: **RDB 100-insert perf smoke (duplicate-based)**.
  setup 비용을 줄이기 위해 1행 fixture 에서 모든 행을 select 한 뒤
  `handleDuplicateRow` 를 100회 호출 → `pendingNewRows.length === 100`
  (각 INSERT 의 값은 원본 행 복제). 그 후 `handleCommit()` 측정.
  단언: `< 1000ms` (setup 제외 — `performance.now()` 를 `handleCommit`
  호출 직전·직후만 sandwich), `sqlPreview` 길이 === 100, 모두 `^INSERT
  INTO ` 시작. *주*: 100건 모두 같은 PK 값을 가지므로 실제 PG 에서는
  PK 충돌이 나지만, 본 테스트는 SQL 문자열 *생성* 만 검증 (실행 안 함)
  하므로 회귀 가드가 정당하다.

- `AC-184-06`: **Phase 22 종료 마킹** — `docs/phases/phase-22.md` 갱신.
  - 상단 status: `> **상태: 계획**` → `> **상태: 완료** (2026-05-01,
    Sprint 181~184)`.
  - "작업 단위 (sprint 추정)" 섹션 끝에 sprint 별 commit 인용 추가
    (Sprint 181 export 단판승 / Sprint 182 PendingChangesTray + PK guard /
    Sprint 183 single-tx wrap / Sprint 184 mixed-batch 회귀 + perf smoke).
  - "Exit Criteria" 4 항목 각각에 충족 evidence 1줄 추가 (예: "세
    mutation 경로 동일 게이트 통과 — Sprint 184 AC-184-01/02 회귀").
  - 본문의 *결정* 부분은 무수정 (ADR 0019/0020 처럼 동결).

- `AC-184-07`: **회귀 가드 + Sprint 175~183 무영향**.
  `git diff` 로 다음을 확인:
  - `src/components/datagrid/useDataGridEdit.ts` 변경 0 (본 sprint 는
    구현 코드 미수정 — 테스트만 추가, phase 문서만 갱신).
  - `src-tauri/` 전체 변경 0.
  - `src/components/query/PendingChangesTray.tsx` 변경 0.
  - `src/components/query/EditableQueryResultGrid.tsx` 변경 0.

## Out of Scope

- **PendingChangesTray 가 INSERT 항목 표시** — 본 sprint 는 트레이가
  `pendingNewRows` 를 시각화하지 않는 것을 의도된 design 으로 받아들임.
  raw query editor (`EditableQueryResultGrid`) 는 INSERT 행 추가 UI 를
  제공하지 않으므로 (Sprint 182 의 design 결정), 트레이가 INSERT 를
  렌더링할 필요가 없다. DataGrid 측 INSERT UX 의 시각화 (toolbar 의
  "N new" 배지) 는 Sprint 182 이전부터 있었고 그대로 유지.
- **Mongo multi-document transaction** — Sprint 183 Out of Scope 와
  동일. Sprint 184 도 Mongo 에서는 트랜잭션을 강제하지 않는다 — AC-184-02
  는 *순차 dispatch* 만 핀하지 *원자성* 은 핀하지 않는다.
- **실측 perf 회귀 임계값 강화** — 본 sprint 의 < 1000ms (or 3000ms)
  budget 은 *flake 방지용 상한* 이지 *최적화 목표* 가 아니다. 실제
  worst-case 가 100ms 대에 머물면 차후 sprint 에서 budget 을 좁힐 수
  있지만 본 sprint 는 그렇게 하지 않는다.
- **Bulk-edit (한 컬럼 전체 일괄 변경) UI** — Phase 22 Out of Scope
  와 동일. 별도 sprint.
- **Insert-row PK 가드** — Sprint 182 의 PK 부재 가드는 *기존 행 inline
  edit* 에 한정. INSERT 행은 PK 컬럼을 사용자가 직접 입력해야 하므로
  PK 부재 가드의 적용 대상이 아니다 (이미 코드가 그렇게 동작). 별도
  sprint 에서 PK 부재 시 INSERT 가능 여부를 재평가.
- **Sprint 175~183 산출물 코드 수정** — touched 0.

### Files allowed to modify

- **NEW** `src/components/datagrid/useDataGridEdit.mixed-batch.test.ts` —
  AC-184-01, AC-184-02, AC-184-03, AC-184-04, AC-184-05 모두 단일 파일에
  묶음 (시나리오들이 동일 hook + 동일 fixture 패턴을 공유하므로 분리
  비용이 더 높음).
- `docs/phases/phase-22.md` — AC-184-06 (status + sprint 매핑).
- `docs/sprints/sprint-184/contract.md` (this file).
- `docs/sprints/sprint-184/findings.md` (new).
- `docs/sprints/sprint-184/handoff.md` (new).

## Invariants

- **Sprint 175~183 산출물 코드 무수정.** `useDataGridEdit.ts`,
  `EditableQueryResultGrid.tsx`, `PendingChangesTray.tsx`, `sqlGenerator.ts`,
  `mqlGenerator.ts`, `src-tauri/` 전체, `src/lib/tauri.ts`, store 들
  모두 git diff 0.
- **Phase 22 본문 정의 (Out of Scope, Exit Criteria 텍스트) 무수정.**
  status 줄과 sprint 매핑 표만 추가.
- **신규 런타임 의존성 0**. `package.json` / `Cargo.toml` 미변경.
- **`it.skip` / `it.todo` / `xit` 0건** (skip-zero gate). Rust 측
  `#[ignore]` 0건.
- **strict TS / ESLint**: `any` 금지, `pnpm tsc --noEmit` zero,
  `pnpm lint` zero.
- **flake 가드**: perf budget 은 `Math.max(measured * 1.5, default)`
  같은 동적 상한 *금지* — 단순 상수 비교. 측정값이 budget 초과 시 fail
  은 정당한 회귀 (or CI runner 의 일시적 slowness — 이 경우 budget 을
  완화하는 별도 sprint).

## Acceptance Criteria

- `AC-184-01` — `useDataGridEdit` RDB mixed-batch: `executeQueryBatch`
  1회 호출 + statements 길이 3 + 세 종류 SQL 1건씩 + `executeQuery`
  미호출.
- `AC-184-02` — `useDataGridEdit` Mongo mixed-batch:
  `insertDocument`/`updateDocument`/`deleteDocument` 각 1회 호출,
  `executeQueryBatch`/`executeQuery` 0회.
- `AC-184-03` — RDB 100-edit perf smoke: `handleCommit` < 1000ms +
  `sqlPreview` 길이 === 100 + 모두 UPDATE.
- `AC-184-04` — RDB 100-delete perf smoke: < 1000ms + 길이 === 100 +
  모두 DELETE.
- `AC-184-05` — RDB 100-insert perf smoke: < 3000ms (setup-aware budget) +
  길이 === 100 + 모두 INSERT.
- `AC-184-06` — Phase 22 status 갱신, sprint 매핑 표 추가, Exit Criteria
  evidence 4건.
- `AC-184-07` — 회귀: 위 invariant 절의 git diff 0 항목 충족.

## Design Bar / Quality Bar

- **테스트 명명**: `[AC-184-0X]` prefix. 각 신규 테스트에
  `// AC-184-0X — <reason>; date 2026-05-01.` 코멘트 (auto-memory
  `feedback_test_documentation.md`).
- **fixture 재사용**: 100-행 fixture 는 `useDataGridEdit.commit-error.test.ts`
  의 `RDB_DATA` 와 같은 모양 (`columns` + `rows` + `total_count`) 을
  복제하지 말고 helper 로 빼지도 말고, 본 새 파일에 inline 으로 만든다
  (Sprint 별 cohesion 우선).
- **perf 측정**: `performance.now()` 단일 측정. `vi.useFakeTimers()`
  사용 금지 (실시간 측정).
- **Mongo branch helper 의존성**: insertDocument 가 reject 하지 않는
  fake 가 필요 — 기존 `useDataGridEdit.document.test.ts` 의 mock 패턴을
  *복제* 한다 (helper 분리 시 두 파일이 깨짐).
- **커버리지**: 본 sprint 는 신규 라인 0 (테스트만 추가) 이므로 coverage
  delta 0. 기존 라인 coverage 는 유지.

## Verification Plan

### Required Checks

1. `pnpm vitest run src/components/datagrid/useDataGridEdit.mixed-batch.test.ts`
   — 신규 5 케이스 green.
2. `pnpm vitest run` — 전체 suite green (회귀 0).
3. `pnpm tsc --noEmit` — zero errors.
4. `pnpm lint` — zero errors.
5. `cd src-tauri && cargo test --lib` — 전체 green (코드 변경 0 이지만
   회귀 가드).
6. `cd src-tauri && cargo clippy --all-targets --all-features -- -D
   warnings` — clean.
7. `cd src-tauri && cargo fmt --check` — clean.
8. **Static (Generator-recorded, Evaluator re-runs)**:
   - `git diff src/components/datagrid/useDataGridEdit.ts` — empty.
   - `git diff src-tauri/` — empty.
   - `git diff src/components/query/PendingChangesTray.tsx
     src/components/query/EditableQueryResultGrid.tsx
     src/components/datagrid/sqlGenerator.ts
     src/components/datagrid/mqlGenerator.ts
     src/lib/tauri.ts` — empty.
   - `grep -RnE 'it\.(skip|todo)|xit\(' src/components/datagrid/
     useDataGridEdit.mixed-batch.test.ts` → 0 matches.

### Required Evidence

- Generator:
  - 변경 파일 목록 (purpose 한 줄씩) — 신규 테스트 1개 + phase doc + 3
    sprint docs.
  - Vitest stdout — `[AC-184-0X]` 케이스 5건 가시.
  - `findings.md` 섹션: 본 sprint 가 *기능 변경 없음* 이라는 명시 / 5
    AC 의 회귀 가드 의도 / Phase 22 종료 매핑 / Mongo 트랜잭션이 여전히
    Out of Scope 인 이유 / perf budget 산정 근거 / evidence index.
  - `handoff.md`: AC 별 evidence 행 (한 행 = 한 AC).
- Evaluator: AC 별 통과 evidence 인용 + 위 #1~#8 재실행 + invariant
  `git diff` 확인.

## Test Requirements

### Unit Tests (필수)

- **`useDataGridEdit.mixed-batch.test.ts`** (NEW):
  - `[AC-184-01] RDB commit dispatches UPDATE+INSERT+DELETE in single
    executeQueryBatch call`
  - `[AC-184-02] Mongo commit dispatches insertOne+updateOne+deleteOne via
    dispatchMqlCommand without touching executeQueryBatch`
  - `[AC-184-03] RDB 100-edit handleCommit completes under 1000ms with
    100 UPDATE statements`
  - `[AC-184-04] RDB 100-delete handleCommit completes under 1000ms with
    100 DELETE statements`
  - `[AC-184-05] RDB 100-insert handleCommit completes under 3000ms with
    100 INSERT statements`

### Coverage Target

- 신규 코드 0 (테스트만 추가) — coverage delta 0.

### Scenario Tests (필수)

- [x] Happy path — mixed-batch 가 세 statement 종류 모두 emit.
- [x] 빈/누락 입력 — 본 sprint 는 빈 입력 케이스 추가하지 않음. Sprint
  183 의 빈 입력 회귀가 이미 cover.
- [x] 에러 복구 — Sprint 183 AC-183-08b 가 cover. 본 sprint 는 mixed
  case 의 *부분* 에러 회귀를 추가하지 않음 (Sprint 183 의 single-batch
  rollback 시멘틱이 이미 statement 종류와 무관하게 적용되므로).
- [x] 동시성 — N/A (본 sprint 는 race 새 도입하지 않음).
- [x] 상태 전이 — Sprint 182 / 183 가 cover. 본 sprint 는 *순서* 만 핀
  (insertOne → updateOne → deleteOne).
- [x] 회귀 — invariant 절의 git diff 0 항목 자체가 회귀 가드.

## Test Script / Repro Script

1. `pnpm install`.
2. `pnpm vitest run src/components/datagrid/useDataGridEdit.mixed-batch.test.ts`.
3. `pnpm vitest run` (full suite).
4. `pnpm tsc --noEmit`.
5. `pnpm lint`.
6. `cd src-tauri && cargo test --lib` + clippy + fmt.
7. Static greps + invariant `git diff` (Verification Plan §8).

## Ownership

- Generator: single agent.
- Write scope (정확): 위 §"Files allowed to modify" — 새 테스트 1 개 +
  phase doc + 3 sprint docs.
- Untouched: `CLAUDE.md`, `memory/`, `src/types/connection.ts`, sprints
  175~183 코드 산출물 (PendingChangesTray 포함), `package.json`,
  `Cargo.toml`, `src-tauri/` 전체 코드, Mongo adapter 코드.
- Merge order: Sprint 183 머지 후 (이미 머지됨, commit `51d6406`). Phase
  22 종료 후 Sprint 185 (Phase 23 Safe Mode) 가 본 sprint 위에서 시작.

## Exit Criteria

- 열린 `P1` / `P2` findings: `0`
- Required checks 통과: `yes` (1–8 in Verification Plan)
- `docs/sprints/sprint-184/findings.md` 존재 + 사양대로 섹션 채움.
- `docs/sprints/sprint-184/handoff.md` 에 AC 별 evidence 행 (한 행 =
  한 AC).
- `docs/phases/phase-22.md` 의 status 가 "완료" 로 마킹됨.
