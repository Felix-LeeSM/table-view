# Sprint Execution Brief: sprint-93

## Objective

`useDataGridEdit.handleExecuteCommit` SQL 브랜치의 빈 catch 블록을 채워 executeQuery 실패 시 SQL Preview 모달을 유지하며 실패 statement idx + DB 메시지 + 원문 SQL 을 사용자에게 표면화한다.

## Task Why

P0 사용자 리포트 (#EDIT-6). 현재 `} catch { /* Error handling is done via the fetchData flow */ }` 로 에러가 silently 삼켜짐 — 사용자는 commit 이 실패했는지 모르고, 부분 실패(N 중 K 번째 실패) 케이스에서 어떤 statement 가 적용되고 어떤 게 실패했는지 알 길이 없다.

## Scope Boundary

**쓰기 허용**:
- `src/components/datagrid/sqlGenerator.ts` (statement → cell key 매핑 노출 시)
- `src/components/datagrid/useDataGridEdit.ts`
- `src/components/structure/SqlPreviewDialog.tsx`
- `src/components/datagrid/useDataGridEdit.commit-error.test.ts` (신규)
- `src/components/structure/SqlPreviewDialog.test.tsx` (있으면 갱신)
- 호출 사이트 (DataGrid 등) — `commitError` prop 전달만, 다른 변경 금지.

**쓰기 금지**:
- MQL preview 브랜치 (`paradigm === "document"`)
- 다른 컴포넌트, 다른 다이얼로그
- sprint-88~92 산출물
- `CLAUDE.md`, `memory/`

## Invariants

- 기존 happy-path 회귀 0
- `executeQuery` 시그니처 변경 0
- 성공 시 sqlPreview null, pendingEdits.size 0, fetchData 1 회

## Done Criteria

1. SQL 브랜치 catch 블록이 commitError state 를 기록 + sqlPreview 유지 + 가능한 경우 cell 키를 pendingEditErrors 에 추가.
2. 부분 실패 시 commitError 가 statementIndex + statementCount + message + sql 포함.
3. SqlPreviewDialog 가 commitError prop 으로 destructive 영역에 메시지/SQL/카운트 표시.
4. happy path 회귀 0, 정적 회귀 가드 (catch 비어있지 않음 단언) 추가.

## Verification Plan

- Profile: `command`
- Required checks:
  1. `pnpm vitest run`
  2. `pnpm tsc --noEmit`
  3. `pnpm lint`
  4. `grep` 으로 commitError, executed:/failed at 표현 확인
  5. catch 블록 정적 확인

## Evidence To Return

`docs/sprints/sprint-93/findings.md` 에 기록:
- 변경 파일 + 목적
- 명령 출력 + AC 별 라인 인용
- commitError 모델 정의
- statement → key 매핑 방식 (generateSql 확장 vs 별도 함수)
- 가정/위험

## Untouched Working Tree

- `memory/lessons/memory.md` (modified) — 건드리지 마라
- `memory/lessons/2026-04-25-multi-sprint-protected-scope-diff/` (untracked) — 건드리지 마라

## References

- Contract: `docs/sprints/sprint-93/contract.md`
- Spec: `docs/sprints/sprint-93/spec.md`
- 기존 catch 위치: `src/components/datagrid/useDataGridEdit.ts:614-616` (SQL 브랜치)
- 기존 generateSql 시그니처: `src/components/datagrid/sqlGenerator.ts:320-328`
