# Sprint 117: DocumentDataGrid 페이지네이션 정렬 (#DOC-1)

**Source**: `docs/ui-evaluation-results.md` #DOC-1
**Depends on**: —
**Verification Profile**: browser

## Goal

DocumentDataGrid 페이지네이션이 RDB DataGrid 와 동일한 First/Prev/Jump/Next/Last + size select 컨트롤을 노출하도록 정렬한다.

## Acceptance Criteria

1. DocumentDataGrid 페이지네이션이 RDB DataGrid 와 동일한 First/Prev/Jump/Next/Last + size select 를 노출한다.
2. 페이지 jump 입력은 RDB 와 동일한 검증 정책(숫자, 범위) 을 따른다.
3. size select 가 sprint 112 의 정규화된 `Select` 컴포넌트를 사용한다.
4. 기존 DocumentDataGrid 페이지네이션 테스트 회귀 0.

## Components to Create/Modify

- `src/components/document/`: DocumentDataGrid 페이지네이션 컨트롤 정렬.
- 관련 테스트.
