# Sprint 94: 글로벌 토스트 시스템 (#FB-1)

**Source**: `docs/ui-evaluation-results.md` #FB-1
**Depends on**: sprint-93
**Verification Profile**: browser

## Goal

전역 토스트 시스템을 도입해 commit 성공, rename 성공, copy 완료, commit 실패 등 조용히 일어나던 이벤트를 알림으로 노출한다. Sprint 93 의 `commit_failed` 이벤트도 토스트와 연동.

## Acceptance Criteria

1. 앱 셸 어디서든 호출 가능한 toast API 가 존재한다 (success/error/info/warning 최소 4종).
2. Cmd+S 커밋 성공 / 실패 시 적절한 toast 가 표시된다. 실패 토스트는 SQL Preview 모달이 닫혀도 화면에 남는다.
3. 연결 추가/수정/삭제 성공 시 toast 가 표시된다.
4. 토스트는 키보드(Esc) 로 닫을 수 있고 `role="status"` 또는 `role="alert"` 를 적절히 사용한다.

## Components to Create/Modify

- `src/components/ui/toaster.tsx` (신규): toast 컨테이너 + provider.
- `src/lib/toast.ts` (신규): 호출 API.
- `src/App.tsx`: toaster 마운트.
- 호출처: `src/components/datagrid/useDataGridEdit.ts`, `src/components/connection/ConnectionDialog.tsx`, 기타 성공/실패 경로.
- `src/components/ui/toaster.test.tsx` (신규).
