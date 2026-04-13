# Sprint Contract: Sprint 49

## Summary

- Goal: 남은 shadcn 전환, 일관성 확보, 최종 검증 & 푸시
- Verification Profile: `command`

## In Scope

- FilterBar에 shadcn Input, Button 적용
- QueryLog에 shadcn Button 적용
- TabBar에 shadcn Button 적용
- ConnectionGroup에 shadcn Button 적용
- 전체 icon 버튼 패턴 일관성 확보

## Out of Scope

- 새로운 기능 추가
- CSS 변수 완전 전환 (--color-* 제거는 이후에)
- dialog.tsx/alert-dialog.tsx의 "use client" 제거 (cosmetic)

## Invariants

- 707 테스트 모두 통과
- `pnpm build`, `pnpm tsc --noEmit`, `pnpm lint` 통과
- 기존 기능 회귀 없음

## Done Criteria

1. 주요 컴포넌트에서 shadcn Button/Input 사용
2. 모든 검사 통과
3. 푸시 완료
