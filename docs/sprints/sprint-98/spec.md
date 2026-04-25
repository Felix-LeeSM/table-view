# Sprint 98: Cmd+S 즉시 시각 피드백 (P1 #5)

**Source**: `docs/ui-evaluation-results.md` P1 #5
**Depends on**: sprint-94
**Verification Profile**: browser

## Goal

Cmd+S 가 즉시 시각 피드백(스피너/버튼 상태) 을 내도록 하여, SQL Preview 모달 표시 전 사용자가 키 입력이 인식됐음을 즉시 인지하게 한다.

## Acceptance Criteria

1. Cmd+S 누른 직후 (SQL Preview 모달 표시 전) 200ms 이내 시각 피드백(스피너/버튼 상태/툴바 인디케이터) 이 발생한다.
2. 피드백은 SQL Preview 모달이 열리거나 commit 이 종료되면 자연스럽게 사라진다.
3. dirty 가 없는 상태에서 Cmd+S 입력은 no-op 또는 가벼운 인디케이터(예: 짧은 토스트) 로 안내된다.
4. 기존 useDataGridEdit Cmd+S happy path 회귀 0.

## Components to Create/Modify

- `src/components/datagrid/useDataGridEdit.ts`: Cmd+S 핸들러에 즉시 시각 피드백 발행.
- 관련 toolbar/grid 컴포넌트: pending 상태 표시 슬롯.
