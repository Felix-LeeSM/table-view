# Sprint Contract: sprint-182

## Summary

- **Goal**: Phase 22 / TablePlus 패리티 #2 — RDB 인라인 편집 게이트의 1차
  완성. 본 sprint 는 **`EditableQueryResultGrid` (raw query 결과 편집기)**
  하나에 집중한다. Phase 22 의 게이트 패턴 (Preview SQL → Commit /
  Discard) 의 골격은 Sprint 87 이후 이미 자리 잡혀 있다 (`buildRawEditSql`,
  SQL preview Dialog, Commit/Discard 액션, Cmd+S 단축키, `commit-flash`,
  `commitError` 추적). 본 sprint 는 이 위에 **(1) pending changes 트레이
  (col / old / new / generated SQL 목록)** 와 **(2) PK 부재 시 defense-in
  -depth 가드 — `EditableQueryResultGrid` 가 직접 호출되더라도 `WHERE ;`
  syntax error 를 절대 만들지 않음** 두 조각만 더한다. Mongo 재배치, row
  추가/삭제 통합, 트랜잭션 실행은 Sprint 183/184 로 미룬다.
- **Audience**: Generator (single agent) — implements; Evaluator — verifies AC.
- **Owner**: harness orchestrator
- **Verification Profile**: `mixed` (browser + command).

## In Scope

- `AC-182-01`: **Pending Changes 트레이 컴포넌트** (`src/components/query/
  PendingChangesTray.tsx`, 신규). `EditableQueryResultGrid` 의
  `pendingEdits: Map<string,string>` + `pendingDeletedRowKeys: Set<string>`
  를 props 로 받아 collapsible 패널로 렌더한다. 패널은 그리드 본문과 SQL
  Preview 모달 사이 (Commit/Discard 헤더 아래) 에 위치하며, 변경이 0건일
  때는 자기 자리를 차지하지 않는다 (return `null`). 항목 한 행은
  `column · 이전값 · 새값 · 생성된 SQL · 개별 revert` 다섯 칸. SQL 칼럼은
  `buildRawEditSql` 와 동일 quoting 으로 생성한 한 줄 SQL 을 monospace 로
  보여준다 (잘릴 만큼 길면 `<code>` 의 `title` 로 풀 SQL 노출 — 카피 가능).
  Vitest 가 빈 상태 / 1 edit / 1 delete / mixed (edit + delete) / 개별
  revert 다섯 케이스를 단언.

- `AC-182-02`: **개별 revert 액션**. 트레이 행의 X 버튼 클릭 시 해당
  pending 항목 한 개만 부모 상태에서 제거된다. revert 후에도 다른 pending
  항목 / SQL preview / commit-flash 상태에 영향이 없다. `EditableQueryResultGrid`
  은 트레이로부터 `onRevertEdit(key)` / `onRevertDelete(rowKey)` 콜백을
  받아 자체 setter 로 처리한다 (스토어 도입 금지).

- `AC-182-03`: **PK 부재 defense-in-depth 가드**. 현재 PK 부재는
  `analyzeResultEditability` 가 `editable: false` 를 반환해 read-only
  `<ResultTable>` 로 갈라지므로 `EditableQueryResultGrid` 가 마운트되지
  않는다. 본 sprint 는 그 가드가 우회됐을 경우의 안전망을 추가한다 —
  `EditableQueryResultGrid` 가 props 로 `plan.pkColumns.length === 0` 을
  받으면 (a) 더블클릭이 `editor` 를 열지 않고, (b) 컨텍스트 메뉴의
  `Delete` 항목이 `aria-disabled` 로 표시되며, (c) 그리드 상단에
  `Read-only — primary key required to edit` banner 가 1줄 띄워진다.
  Vitest 가 `pkColumns: []` props 로 직접 마운트해 세 단언 모두 cover.

- `AC-182-04`: **Empty-string vs NULL 입력 모호성 명시**. 현재
  `rawQuerySqlBuilder.literal()` 은 빈 문자열 `""` 를 SQL `NULL` 로
  매핑한다 (line 82, `newValue === "" ? "NULL" : quoteString(newValue)`).
  본 sprint 는 이 결정을 **명시적**으로 만든다 — 트레이의 "새값" 칼럼이
  빈 문자열일 때 `NULL` 이라는 italic 표시 + tooltip `Empty input is
  treated as SQL NULL`. 빌더 자체 코드는 변경 금지 (회귀 위험). Vitest
  가 italic+tooltip 표시를 단언, `rawQuerySqlBuilder.test.ts` 에 빈
  문자열 → `NULL` 의 기존 동작이 변하지 않았음을 cover 하는 회귀 테스트
  1건만 추가.

- `AC-182-05`: **Pending count 동기화**. 트레이 헤더에 `n changes pending`
  카운터를 노출. `EditableQueryResultGrid` 의 기존 toolbar 카운트와 동일
  소스 (`pendingEdits.size + pendingDeletedRowKeys.size`) 를 사용해
  드리프트 없음. Vitest 가 1 edit 추가 → 카운트 1, revert → 카운트 0,
  delete + edit → 카운트 2 를 단언.

- `AC-182-06`: **회귀 가드 (text-string 무수정)**. 기존 `EditableQueryResultGrid.test.tsx` 의 모든 assertion 은 무수정 통과.
  추가만 허용. SQL preview Dialog / Commit / Discard / Cmd+S /
  commit-flash / context-menu Delete / CellDetail 더블 더블클릭 등 Sprint
  86~98 의 동작 일체가 동일.

## Out of Scope

- **DataGrid (구조화 테이블 뷰) 의 인라인 편집 변경** — `useDataGridEdit`
  훅의 시그니처/내부 로직은 무수정. 본 sprint 는 EditableQueryResultGrid
  하나에 한정한다.
- **Mongo 재배치** — `DocumentDataGrid` 의 즉시-적용 패턴 → Modal 게이트
  이전은 Sprint 183.
- **Row 추가 (INSERT)** — `rawQuerySqlBuilder` 는 명시적으로 INSERT 미지원
  (line 45~47). Sprint 184 에서 통합.
- **Row 삭제 통합** — Delete 액션 자체는 이미 동작 (context-menu); 본
  sprint 는 트레이 표시만 추가하고 동작 변경 없음.
- **트랜잭션 실행** — 현재 `executeQuery` 루프 (개별 statement 실행) 그대로.
  단일 트랜잭션 wrap 은 Sprint 183.
- **Multi-row bulk edit** — 별도 sprint.
- **편집 충돌 검출** — 마지막-쓰기-승리 유지.
- **Safe Mode (Production gate)** — Phase 23.
- **Sprint 175~181 산출물** — touched 0.
- **Sprint 87 의 Mongo `MqlPreviewModal` / `useDataGridEdit.dispatchMqlCommand`**
   — 무수정.
- **`Paradigm` 타입** (`src/types/connection.ts:15`) — 무수정.
- **e2e 테스트** — Vitest 충분.

### Files allowed to modify

- `src/components/query/PendingChangesTray.tsx` (new) — 트레이 컴포넌트.
  Props: `{ pendingEdits, pendingDeletedRowKeys, columns, rows, plan,
  onRevertEdit, onRevertDelete }`. Stateless, props-only.
- `src/components/query/PendingChangesTray.test.tsx` (new) — AC-182-01,
  02, 04, 05.
- `src/components/query/EditableQueryResultGrid.tsx` — (a) PK 부재 가드
  (마운트 자체는 막지 않고 더블클릭/Delete/banner 의 3 가드), (b) 트레이
  컴포넌트 마운트, (c) `onRevertEdit` / `onRevertDelete` 콜백 추가.
  기존 SQL preview / Commit / Discard / commit-flash / Cmd+S 코드는
  변경 금지.
- `src/components/query/EditableQueryResultGrid.test.tsx` — AC-182-03
  (PK 가드) + AC-182-06 (회귀: 트레이 마운트 후 기존 시나리오 동등).
  기존 assertion 무수정.
- `src/lib/rawQuerySqlBuilder.test.ts` — AC-182-04 의 회귀 1건 추가
  (empty string → `NULL`). 빌더 본체 코드는 무수정.
- `docs/sprints/sprint-182/contract.md` (this file).
- `docs/sprints/sprint-182/findings.md` (new).
- `docs/sprints/sprint-182/handoff.md` (new).

## Invariants

- **`buildRawEditSql` 시그니처 / 내부 quoting 무변동.** 트레이가 SQL
  preview 를 만들 때도 같은 함수를 호출해 단일 진실원 유지.
- **`useDataGridEdit` 훅 무변동** — DataGrid (구조화 테이블 뷰) 와 Mongo
  paradigm 은 본 sprint 의 영향 범위 밖.
- **Sprint 87 의 SQL preview Dialog** (`EditableQueryResultGrid` 라인
  418~497) — 본 sprint 가 변경하지 않음. 트레이는 Dialog 와 별개 영역.
- **Sprint 98 의 commit-flash** (`EditableQueryResultGrid` 의 flash 상태)
  — 트레이 마운트로 인해 회귀 없음.
- **Sprint 181 ExportButton** — `QueryResultGrid` 의 toolbar 에 마운트되어
  있음 (AC-181-10 회귀 가드 존재). Sprint 182 가 그 toolbar 를 건드리지
  않으므로 회귀 0.
- **strict TS / ESLint**: `any` 금지, `pnpm tsc --noEmit` zero,
  `pnpm lint` zero.
- **신규 런타임 의존성 0**. `package.json` 미변경.
- **`it.skip` / `it.todo` / `xit` 0건** (skip-zero gate).
- **기존 surface 테스트의 텍스트 어서션 무수정**.

## Acceptance Criteria

- `AC-182-01` — `PendingChangesTray` 가 5 시나리오 (empty / 1 edit / 1
  delete / mixed / individual revert) 에서 사양대로 렌더된다.
- `AC-182-02` — 행 X 버튼 클릭 → 부모 콜백 호출 → 해당 항목만 사라짐.
  나머지 pending 상태 무영향.
- `AC-182-03` — `pkColumns: []` 일 때 더블클릭이 editor 를 열지 않고,
  context-menu Delete 가 `aria-disabled`, 상단 banner 1줄 출현.
- `AC-182-04` — 트레이의 새값 칼럼이 빈 문자열일 때 italic `NULL` +
  tooltip 노출. `rawQuerySqlBuilder.literal()` 동작 무변경 (회귀 1건).
- `AC-182-05` — 트레이 헤더 카운터 = `pendingEdits.size +
  pendingDeletedRowKeys.size` 단일 소스.
- `AC-182-06` — `EditableQueryResultGrid.test.tsx` 기존 assertion 무수정
  통과 (`grep -c 'expect(' EditableQueryResultGrid.test.tsx` 변동 없음 +
  `git diff` 가 추가만 보임).

## Design Bar / Quality Bar

- **트레이는 stateless.** 모든 상태는 `EditableQueryResultGrid` 가 보유.
  트레이는 props 만 받고 콜백으로 상위로 신호. 향후 (Sprint 183) Mongo
  쪽에 재사용할 때도 동일 시그니처를 그대로 받아쓸 수 있게.
- **트레이 자리 배치**: 그리드 본문의 *바로 아래*, Commit/Discard 헤더
  *위*. Tailwind 의 `border-t border-border` 로 시각 구분, 헤더 1줄 +
  스크롤 영역 (max-h-48 overflow-y-auto). 5+ 항목 누적 시 스크롤로 처리.
- **각 행의 SQL 표기**: `<code>` + `whitespace-nowrap overflow-hidden
  text-ellipsis` + `title=<full SQL>`. 사용자가 hover 로 풀 SQL 을 볼 수
  있고, 카피가 필요할 때 select-and-copy 동작이 살아있음. 별도 카피 버튼
  은 본 sprint 에서 추가하지 않음 (over-engineering).
- **개별 revert 버튼 접근성**: `aria-label="Revert <column>"` (edit) /
  `aria-label="Revert delete row <pk>"` (delete). 키보드 Tab 으로
  reachable.
- **PK 부재 banner 텍스트**: 정확히
  `Read-only — primary key required to edit`. 변경 시 회귀 가드와 함께
  업데이트 필요.
- **테스트 명명**: `[AC-182-0X]` prefix. 각 신규 테스트에 `// AC-182-0X
  — <reason>; date 2026-05-01.` 코멘트 (auto-memory `feedback_test_documentation.md`).
- **커버리지**: 신규 라인 70% 이상. 트레이 컴포넌트 90% 이상 (간단한
  렌더 컴포넌트라 cover 쉬움).

## Verification Plan

### Required Checks

1. `pnpm vitest run src/components/query/PendingChangesTray.test.tsx
   src/components/query/EditableQueryResultGrid.test.tsx
   src/lib/rawQuerySqlBuilder.test.ts` — 신규 + 회귀 모두 green.
2. `pnpm vitest run` — 전체 suite green (회귀 0).
3. `pnpm tsc --noEmit` — zero errors.
4. `pnpm lint` — zero errors.
5. **Static (Generator-recorded, Evaluator re-runs)**:
   - `git diff src/lib/rawQuerySqlBuilder.ts` — 빌더 본체 변경 0 (테스트
     파일만 변경).
   - `git diff src/components/datagrid/useDataGridEdit.ts` — 변경 0
     (out-of-scope invariant).
   - `git diff src/types/connection.ts` — 변경 0.
   - `grep -nE "Read-only — primary key required to edit"
     src/components/query/EditableQueryResultGrid.tsx
     src/components/query/EditableQueryResultGrid.test.tsx` — 두 곳 모두
     출현 (production string + 테스트 단언).
   - `grep -nE "PendingChangesTray" src/components/query/
     EditableQueryResultGrid.tsx` — 1줄 (import + 마운트).
   - `grep -RnE 'it\.(skip|todo)|xit\(' src/components/query/PendingChangesTray.test.tsx
     src/components/query/EditableQueryResultGrid.test.tsx
     src/lib/rawQuerySqlBuilder.test.ts` — 0건 (skip-zero gate).
6. **Operator browser smoke** (선택 — sandbox 에서 실행 불가하면
   findings.md 의 "Operator runbook" 으로 기록):
   1. `pnpm tauri dev`.
   2. PG 연결 → SELECT 단일-테이블 (PK 있는 테이블) 쿼리 실행 →
      Editable 상태에서 셀 더블클릭 → 값 입력 → 트레이에 한 행 출현.
   3. 다른 셀도 편집, context-menu 로 한 행 삭제 → 트레이가 두 항목 →
      카운터 `2 changes pending`.
   4. 한 항목의 X 클릭 → 트레이에서 제거, 카운터 `1` → SQL preview
      열어 SQL 한 줄만 보임 → Commit → 결과 반영.
   5. `SELECT * FROM <pk 없는 테이블>` 시도 → 기존처럼 read-only banner
      (analyzeResultEditability 가 갈라줌). 본 sprint 의 defense-in-depth
      가드는 코드 경로상 도달 불가하므로 단위 테스트로만 cover.
   6. 빈 문자열 입력으로 셀 편집 → 트레이의 새값 칼럼이 italic `NULL` +
      hover tooltip "Empty input is treated as SQL NULL".

### Required Evidence

- Generator:
  - 변경 파일 목록 (purpose 한 줄씩).
  - Vitest stdout — `[AC-182-0X]` 케이스 가시.
  - `findings.md` 섹션: 트레이 위치 결정 / stateless props 시그니처 /
    PK 가드의 3 layer (analyze → defense-in-depth → banner) / empty
    string ↔ NULL 모호성 처리 결정 / AC→테스트 매핑 / evidence index.
  - `handoff.md`: AC 별 evidence 행 (한 행 = 한 AC).
- Evaluator: AC 별 통과 evidence 인용 + 위 #1~#5 재실행 + invariant
  `git diff` 확인.

## Test Requirements

### Unit Tests (필수)

- **`src/components/query/PendingChangesTray.test.tsx`** (AC-182-01, 02,
  04, 05):
  - `[AC-182-01a] empty pendingEdits + empty deletedRowKeys → renders nothing`
  - `[AC-182-01b] one edit → one row with column / old / new / SQL`
  - `[AC-182-01c] one delete → one row marked DELETE`
  - `[AC-182-01d] mixed (edit + delete) → two rows in stable order`
  - `[AC-182-02a] revert button click invokes onRevertEdit with key`
  - `[AC-182-02b] revert delete button click invokes onRevertDelete with rowKey`
  - `[AC-182-04a] empty new value → italic NULL + tooltip`
  - `[AC-182-05a] header counter = edits + deletes`
- **`src/components/query/EditableQueryResultGrid.test.tsx`** (AC-182-03,
  06):
  - `[AC-182-03a] pkColumns: [] → double-click does not open editor`
  - `[AC-182-03b] pkColumns: [] → context-menu Delete is aria-disabled`
  - `[AC-182-03c] pkColumns: [] → "Read-only — primary key required to edit" banner`
  - `[AC-182-06a] (regression) tray mounts but legacy SQL preview / Commit / Discard / commit-flash / Cmd+S still pass through unchanged`
- **`src/lib/rawQuerySqlBuilder.test.ts`** (AC-182-04 회귀):
  - `[AC-182-04b] (regression) literal of empty string → SQL NULL` —
    기존 동작이 변경되지 않았음을 명시적으로 핀.

### Coverage Target

- 신규 라인: 70% 이상.
- `PendingChangesTray.tsx`: 90% 이상.

### Scenario Tests (필수)

- [x] Happy path — 1 edit 추가 → 트레이에 1행 → revert → 빈 트레이.
- [x] 빈/누락 입력 — 0 pending → 트레이 자체 미렌더 (`return null`).
- [x] 에러 복구 — Commit 실패 (`commitError`) 후에도 트레이는 그대로
  남고 (사용자가 재시도 가능), 카운터 동기화 유지.
- [x] 동시성 — N/A (트레이는 동기 렌더; mutation 은 부모가 처리).
- [x] 상태 전이 — 0 pending → 1 → 2 → revert → 1 → Commit → 0.
- [x] 회귀 — `EditableQueryResultGrid.test.tsx` 의 모든 기존 assertion
  텍스트 무수정 통과.

## Test Script / Repro Script

1. `pnpm install`.
2. `pnpm vitest run src/components/query/PendingChangesTray.test.tsx
   src/components/query/EditableQueryResultGrid.test.tsx
   src/lib/rawQuerySqlBuilder.test.ts`.
3. `pnpm vitest run` (full suite).
4. `pnpm tsc --noEmit`.
5. `pnpm lint`.
6. Static greps + invariant `git diff` (Verification Plan §5).
7. (Optional) `pnpm tauri dev` → 6-step operator smoke.

## Ownership

- Generator: single agent.
- Write scope (정확): 위 §"Files allowed to modify".
- Untouched: `CLAUDE.md`, `memory/` (decisions index 미변경 — 본 sprint
  는 ADR 추가하지 않음. 트레이는 UI 패턴이지 정책 결정 아님), `src/types/
  connection.ts`, sprints 175~181 산출물, `package.json`, `src-tauri/*`
  전체 (백엔드 변경 0).
- Merge order: Sprint 181 머지 후. Sprint 183 (Preview/Commit/Discard
  Mongo 재배치) 보다 먼저.

## Exit Criteria

- 열린 `P1` / `P2` findings: `0`
- Required checks 통과: `yes` (1–5 in Verification Plan)
- `docs/sprints/sprint-182/findings.md` 존재 + 사양대로 섹션 채움.
- `docs/sprints/sprint-182/handoff.md` 에 AC 별 evidence 행 (한 행 =
  한 AC).
