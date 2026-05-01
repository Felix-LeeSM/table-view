# Sprint 182 — Generator Handoff

Single-attempt delivery of Phase 22 / TablePlus parity #2 (RDB 인라인
편집 게이트 1차 완성) — `PendingChangesTray` 컴포넌트 + PK-부재
defense-in-depth 가드. Mongo 재배치 / row INSERT / 트랜잭션은 Sprint
183/184 로 미룸.

## Changed Files

- `src/components/query/PendingChangesTray.tsx` (new) — Stateless tray
  컴포넌트. props 만 받아 렌더 + revert X 버튼 클릭 시 부모 콜백 호출.
  각 항목의 SQL 은 `buildRawEditSql` 단일 항목 호출로 생성.
- `src/components/query/PendingChangesTray.test.tsx` (new) — 8 cases
  (`[AC-182-01a..d]`, `[AC-182-02a..b]`, `[AC-182-04a]`, `[AC-182-05a]`).
- `src/components/query/EditableQueryResultGrid.tsx` — (a) `noPk` 플래그
  도입 → `startEdit` early-return / context-menu Edit Cell + Delete Row
  `disabled` / 상단 banner. (b) `<PendingChangesTray>` 마운트 (toolbar
  와 그리드 본문 사이). (c) `handleRevertEdit` / `handleRevertDelete`
  콜백 추가. 기존 SQL preview / Commit / Discard / Cmd+S 코드는 무수정.
- `src/components/query/EditableQueryResultGrid.test.tsx` — `[AC-182-03a/
  b/c]` (PK 가드 3 단언) + `[AC-182-06a]` (트레이 마운트 후 Cmd+S → SQL
  Preview 경로 동등) 추가. 기존 9 케이스 무수정.
- `src/lib/rawQuerySqlBuilder.test.ts` — `[AC-182-04b]` (회귀 1건) 추가.
  빌더 본체 `rawQuerySqlBuilder.ts` 는 무수정 (invariant).
- `docs/sprints/sprint-182/contract.md` — sprint contract (이전 커밋에서
  추가됨).
- `docs/sprints/sprint-182/findings.md` (new) — Generator findings.
- `docs/sprints/sprint-182/handoff.md` (this file) — sprint deliverable.

## Checks Run

| Command                                                                                                                                                                | Result |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `pnpm vitest run src/components/query/PendingChangesTray.test.tsx src/components/query/EditableQueryResultGrid.test.tsx src/lib/rawQuerySqlBuilder.test.ts`            | pass — 31 cases, all `[AC-182-0X]` visible |
| `pnpm vitest run` (full)                                                                                                                                               | **2540 / 2540 pass** |
| `pnpm tsc --noEmit`                                                                                                                                                    | pass (zero errors) |
| `pnpm lint`                                                                                                                                                            | pass (zero errors) |
| `git diff src/lib/rawQuerySqlBuilder.ts`                                                                                                                               | pass — empty (invariant) |
| `git diff src/components/datagrid/useDataGridEdit.ts`                                                                                                                  | pass — empty (invariant) |
| `git diff src/types/connection.ts`                                                                                                                                     | pass — empty (Paradigm invariant) |
| `grep -nE "Read-only — primary key required to edit" src/components/query/EditableQueryResultGrid.tsx src/components/query/EditableQueryResultGrid.test.tsx`           | pass — 2 hits (prod + test) |
| `grep -nE "PendingChangesTray" src/components/query/EditableQueryResultGrid.tsx`                                                                                       | pass — 2 hits (import + 마운트) |
| `grep -RnE 'it\.(skip|todo)\|xit\(' src/components/query/PendingChangesTray.test.tsx src/components/query/EditableQueryResultGrid.test.tsx src/lib/rawQuerySqlBuilder.test.ts` | pass — 0 hits |

## Done Criteria Coverage

| AC          | Status | Evidence |
| ----------- | ------ | -------- |
| AC-182-01   | pass   | `[AC-182-01a/b/c/d]` empty / 1 edit / 1 delete / mixed — `PendingChangesTray.test.tsx`. 트레이 `total === 0` 일 때 `return null`, 항목 1행 = column / old / new / SQL / X 의 5칸. |
| AC-182-02   | pass   | `[AC-182-02a/b]` X 버튼 클릭 → `onRevertEdit("0-1")` / `onRevertDelete("row-1-0")` — `PendingChangesTray.test.tsx`. `EditableQueryResultGrid.tsx` 의 `handleRevertEdit` / `handleRevertDelete` setter 가 해당 항목만 제거. |
| AC-182-03   | pass   | `[AC-182-03a]` 더블클릭 시 editor 미오픈 (startEdit early-return). `[AC-182-03b]` Delete Row `aria-disabled="true"`. `[AC-182-03c]` 정확 텍스트 banner — `EditableQueryResultGrid.test.tsx`. |
| AC-182-04   | pass   | `[AC-182-04a]` 빈 문자열 → italic NULL + tooltip — `PendingChangesTray.test.tsx`. `[AC-182-04b]` 빌더의 `"" → SQL NULL` 회귀 — `rawQuerySqlBuilder.test.ts`. |
| AC-182-05   | pass   | `[AC-182-05a]` 헤더 카운터 = 2 edits + 1 delete = `3 changes pending` — `PendingChangesTray.test.tsx`. 단일 소스 `pendingEdits.size + pendingDeletedRowKeys.size`. |
| AC-182-06   | pass   | `[AC-182-06a]` 트레이 마운트 후 Cmd+S → SQL Preview Dialog 가 동일 UPDATE 노출 — `EditableQueryResultGrid.test.tsx`. 기존 9 케이스 (Sprint 86~98) 텍스트 무수정 통과. |

## Assumptions

- **트레이 위치는 toolbar 직후, 그리드 본문 직전.** Contract 의 "그리드
  본문 바로 아래" 표현은 "전체 그리드 컨테이너의 toolbar 다음" 으로
  해석. 스크롤 영역이 트레이를 가리지 않도록 `<div className="flex-1
  overflow-auto">` 의 형제로 배치. AC vitest 단언은 위치 무관.
- **단일 항목 SQL 호출.** 트레이의 SQL 컬럼은 `buildRawEditSql(rows, new
  Map([[key, value]]), new Set(), plan)` 호출로 1줄을 만든다 — multi-
  statement 빌드 결과의 일부를 잘라내지 않고 함수를 단일 항목 모드로
  재사용. quoting / NULL 매핑은 SQL Preview Dialog 와 동일.
- **PK 가드 layer 3 (buildPkWhere 빈 WHERE) 은 단위 테스트 미포함.**
  Layer 1 (analyzeResultEditability) + Layer 2 (`noPk` props 가드) 가
  차단해 도달 불가. DB 엔진의 syntax error 동작은 operator runbook 의
  smoke 에서만 검증.

## Residual Risk

- **Operator browser smoke (Verification Plan §6) NOT performed in this
  sandbox** — `pnpm tauri dev` requires a windowed environment. The
  frontend behaviour is fully exercised by Vitest. `findings.md` § "Operator
  runbook" lists the 7 manual steps for replay against live PG with
  PK / 비-PK 테이블, 빈 문자열 입력, individual revert, Commit 통합.
- **트레이 SQL 클립핑/툴팁** 은 CSS 의 `text-ellipsis` 에 의존하므로
  Vitest 가 검증하지 않음. operator smoke 의 step 5 가 cover.
- **5+ 항목 long-list UX** — `max-h-48 overflow-y-auto` 로 스크롤
  처리되지만 100+ 변경 누적 시 인지 부하. Phase 22 의 multi-row bulk
  edit / undo stack 에서 다룸.
- **Mongo 재배치** — Sprint 183 으로 미뤄짐. 트레이의 props 시그니처는
  Mongo paradigm 에서도 그대로 쓸 수 있도록 `RawEditPlan` 만 한정.
- **트랜잭션 wrap** — Sprint 183. 본 sprint 는 `executeQuery` 루프 그대로.
