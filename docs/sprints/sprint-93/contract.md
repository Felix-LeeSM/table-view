# Sprint Contract: sprint-93

## Summary

- Goal: `useDataGridEdit.handleExecuteCommit` 의 빈 catch 블록을 채워, executeQuery 실패 시 SQL Preview 모달을 유지하며 실패 statement 인덱스/메시지/원문 + 부분 실패 카운트를 사용자에게 표면화한다.
- Audience: Generator + Evaluator
- Owner: Generator
- Verification Profile: `command`

## In Scope

- `src/components/datagrid/sqlGenerator.ts`: 필요 시 `generateSql` 반환 타입 확장 — statement 별 cell key 매핑(예: `string[]` → `{ sql: string; key?: string }[]` 또는 별개 `statementKeys: string[]` 반환). 후방 호환을 위해 wrapper 또는 추가 함수도 가능.
- `src/components/datagrid/useDataGridEdit.ts`: `handleExecuteCommit` SQL 브랜치 catch 블록 채우기 — `commitError` state + 실패 statement idx 역추적 + `pendingEditErrors` 에 실패 cell 키 추가 + `setSqlPreview(null)` **금지** (모달 유지).
- `src/components/structure/SqlPreviewDialog.tsx`: `commitError` prop 추가 → destructive bg 슬롯에 statement idx + 메시지 + 원문 SQL 강조 + "executed: N, failed at: K" 형식.
- `src/components/datagrid/useDataGridEdit.commit-error.test.ts` (신규).
- 호출 사이트(예: `DataGridTable.tsx` 등 `SqlPreviewDialog` 를 렌더하는 곳) 에 새로운 `commitError` prop 전달.

## Out of Scope

- MQL preview 브랜치 (`paradigm === "document"`) — 비슷한 빈 catch 가 있지만 spec 은 SQL 브랜치만 다룬다. 별도 sprint.
- 다른 컴포넌트, 다른 다이얼로그.
- 회귀 무관한 코드 정리.
- sprint-88/89/90/91/92 산출물.

## Invariants

- 기존 happy-path 테스트 모두 통과 — 회귀 0.
- 성공 시 동작 변경 없음: `sqlPreview === null`, `pendingEdits.size === 0`, `fetchData` 1 회 호출.
- `executeQuery` 시그니처 변경 0.
- `CLAUDE.md`, `memory/` 변경 0.

## Acceptance Criteria

- `AC-01` `executeQuery` reject 시 catch 블록이 (a) `commitError` state 에 statement idx + DB 메시지 + 원문 SQL 기록, (b) `setSqlPreview(null)` 호출하지 않음 (모달 유지), (c) 실패 statement 와 매핑된 cell key 가 존재하면 `pendingEditErrors` 에 추가.
- `AC-02` 부분 실패 케이스: 3 개 SQL 중 2 번째만 reject → `commitError.statementIndex === 1` (0-indexed) 또는 동등 표현, 메시지에 "executed: 1" + "failed at: 2" (1-indexed) 형식 포함.
- `AC-03` `SqlPreviewDialog` 가 `commitError` 를 받으면 destructive 영역에 메시지 + 원문 SQL + 부분 실패 카운트 노출. RTL 단언으로 검증.
- `AC-04` Happy path 회귀: 모든 SQL 성공 시 `sqlPreview === null`, `pendingEdits.size === 0`, `fetchData` 1 회 호출.
- `AC-05` 정적 회귀 가드: catch 블록이 비어있지 않음을 단언하는 정적 테스트 (소스 grep 또는 snapshot — 단순 grep 으로 catch 블록 내부 비어있지 않음 확인).

## Design Bar / Quality Bar

- `commitError` 모델 권장: `{ statementIndex: number; statementCount: number; sql: string; message: string }` (또는 동등). null 시 정상 상태.
- statement → cell key 매핑은 가능하면 `generateSql` 반환 타입 확장으로. 깨끗한 변경이 어려우면 별도 `generateSqlWithKeys` 함수 추가 가능.
- catch 블록 구현은 간결하게 — 한 statement 실패 후 즉시 break 가능 (트랜잭션이 아닌 단일 statement 직렬 실행이므로 이미 커밋된 statement 는 rollback 불가).

## Verification Plan

### Required Checks

1. `pnpm vitest run` — 0 failures.
2. `pnpm tsc --noEmit` — exit 0.
3. `pnpm lint` — exit 0.
4. `grep -nE "} catch \(" src/components/datagrid/useDataGridEdit.ts` — SQL 브랜치 catch 블록이 비어있지 않음 (즉, `} catch {\n\s*//[^}]*\n\s*}` 패턴 매치 0).
5. `grep -n "commitError\|statementIndex\|executed:\|failed at" src/components/datagrid/useDataGridEdit.ts src/components/structure/SqlPreviewDialog.tsx` — 1+ 라인.

### Required Evidence

- Generator: 변경 파일 + 명령 출력 + AC 별 라인 인용 + commitError 모델 정의 + 부분 실패 시나리오 단언 라인.
- Evaluator: AC 별 라인 인용 + 회귀 0 검증.

## Test Requirements

### Unit Tests (필수)
- `useDataGridEdit.commit-error.test.ts` (신규):
  1. 단순 실패 (1 statement, reject) → commitError 기록, sqlPreview 유지.
  2. 부분 실패 (3 statement, 2 번째 reject) → statementIndex 1, "executed: 1" + "failed at: 2".
  3. Happy path 회귀 (모두 성공) → sqlPreview null, pendingEdits empty, fetchData 1 회.
  4. catch 블록 비어있지 않음 정적 확인 (소스 텍스트 단언 또는 별도 grep 단언).

### Coverage Target
- 신규 코드 라인 70%+.

### Scenario Tests (필수)
- [x] Happy path: 모두 성공
- [x] 단순 실패: 1 statement reject
- [x] 부분 실패: N 중 K 번째 reject
- [x] 회귀 가드: catch 비어있지 않음

## Test Script / Repro Script

1. `pnpm vitest run -- useDataGridEdit`
2. `pnpm vitest run`
3. `pnpm tsc --noEmit`
4. `pnpm lint`

## Ownership

- Generator: 단일 agent.
- Write scope: contract In Scope 만.
- Merge order: 단일 PR.

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes`
- Acceptance criteria evidence linked in `findings.md`
