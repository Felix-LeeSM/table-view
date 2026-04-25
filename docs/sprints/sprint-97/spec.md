# Sprint 97: 탭 dirty indicator (P1 #2)

**Source**: `docs/ui-evaluation-results.md` P1 #2
**Depends on**: sprint-96
**Verification Profile**: browser

## Goal

탭 제목 옆에 dirty indicator(점) 를 추가해 편집 중인 탭 식별 가능하게 하고, dirty 탭 close 시 확인 다이얼로그를 띄운다.

## Acceptance Criteria

1. `pendingEdits.size > 0 || pendingNewRows.length > 0 || pendingDeletedRowKeys.size > 0` 인 탭은 제목 옆에 dot 마크가 표시된다.
2. dirty 탭 close 시도 시 확인 다이얼로그(sprint 96 `ConfirmDialog` preset 사용) 가 뜬다.
3. dirty 가 0 으로 떨어지면 마크가 즉시 사라진다.
4. 기존 TabBar 테스트 happy path 회귀 0.

## Components to Create/Modify

- `src/components/layout/TabBar.tsx`: dirty 마크 + close 가드.
- `src/stores/tabStore.ts`: dirty 계산 셀렉터 또는 필드 추가.
