# Sprint 93: 편집 커밋 에러 표면화 (#EDIT-6)

**Source**: `docs/ui-evaluation-results.md` #EDIT-6
**Depends on**: sprint-88
**Verification Profile**: command

## Goal

`useDataGridEdit.handleExecuteCommit` 의 빈 catch 블록을 제거하고, 실패 시 SQL Preview 모달 유지 + 실패 statement 인덱스/메시지/원문을 사용자에게 표시하며, 부분 실패 시 "executed N/M, failed at K" 를 명시한다. 실패한 cell 키로 역추적해 `pendingEditErrors` 에 메시지를 기록한다.

## Acceptance Criteria

1. `executeQuery` 가 reject 시 catch 블록이 (a) `commitError` state 에 statement 인덱스 + DB 메시지 + 원문 SQL 을 기록, (b) `sqlPreview` 를 닫지 않고 유지, (c) 실패 cell 키를 `pendingEditErrors` 에 추가.
2. 부분 실패 케이스: 3개 SQL 중 2번째만 reject → `commitError.statementIndex === 1`, 메시지에 "executed: 1, failed at: 2" 형식 정보 포함.
3. SQL Preview 모달이 실패 시 destructive bg 슬롯에 DB 에러 원문 + 실패 statement 강조를 노출한다.
4. Happy path 회귀: 모든 SQL 성공 시 `sqlPreview === null`, `pendingEdits.size === 0`, `fetchData` 1회 호출.
5. 정적 회귀 가드: catch 블록이 다시 비워지지 않도록 lint 또는 snapshot 단언.

## Components to Create/Modify

- `src/components/datagrid/useDataGridEdit.ts`: `handleExecuteCommit` catch 블록 채우기, `commitError` state 추가, 역추적 로직 추가.
- `src/components/structure/SqlPreviewDialog.tsx`: 실패 영역 슬롯 추가 — `role="alert"` + 실패 statement 강조.
- `src/components/datagrid/useDataGridEdit.commit-error.test.ts` (신규): 단순 실패, 부분 실패, happy path 회귀, catch 비어있지 않음 단언 4종.

## Edge Cases

- 부분 실패 commit — 이미 커밋된 statement 와 실패 statement 동시 표시.
- 빈 catch 블록 잔존 — 정적 감사 + 회귀 가드.
