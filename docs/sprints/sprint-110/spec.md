# Sprint 110: ConnectionItem 에러 폰트 승급 (#CONN-ITEM-1)

**Source**: `docs/ui-evaluation-results.md` #CONN-ITEM-1
**Depends on**: —
**Verification Profile**: browser

## Goal

ConnectionItem 의 에러 문구가 너무 작은 폰트로 표시되어 가독성이 떨어지는 문제를 폰트 승급으로 해결한다.

## Acceptance Criteria

1. ConnectionItem 에러 문구가 `text-xs` 이상으로 가독성 확보.
2. 에러 색상은 `text-destructive` 토큰을 사용해 테마 일관성을 유지한다.
3. 긴 에러 문구는 truncate + tooltip 으로 노출된다.
4. 기존 ConnectionItem 테스트 회귀 0.

## Components to Create/Modify

- `src/components/connection/ConnectionItem.tsx`: 에러 폰트 승급 + tooltip.
- 관련 테스트.
