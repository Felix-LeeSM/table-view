# Sprint 111: Favorites 패널 가변 크기 + tooltip (#LOG-3)

**Source**: `docs/ui-evaluation-results.md` #LOG-3
**Depends on**: —
**Verification Profile**: browser

## Goal

Favorites 패널이 고정 `w-80 max-h-96` 으로 묶여 있어 긴 SQL 이 잘리는 문제를 가변 크기 + tooltip 으로 해결한다.

## Acceptance Criteria

1. Favorites 패널이 고정 `w-80 max-h-96` 에서 가변 크기로 변경되고, 사용자 리사이즈 가능 (또는 컨테이너 비율 기반).
2. 긴 SQL hover 시 tooltip 으로 전체 내용이 노출된다.
3. 빈 favorites 상태와 다수 favorites 상태 모두 자연스럽게 렌더된다.
4. 기존 FavoritesPanel 테스트 회귀 0.

## Components to Create/Modify

- `src/components/query/FavoritesPanel.tsx`: 가변 크기 + tooltip.
- 관련 테스트.
