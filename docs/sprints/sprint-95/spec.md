# Sprint 95: Dialog 2-Layer Primitive — Layer 1 Base (§6.6 part 1)

**Source**: `docs/ui-evaluation-results.md` §6.6 part 1
**Depends on**: sprint-91, sprint-92
**Verification Profile**: command

## Goal

평가 결과 §6.6 의 2-layer 설계 중 Layer 1(base primitive) 을 만든다. `DialogContent` 에 `tone` variant(default/destructive/warning), `DialogHeader` 에 `layout=row|column` prop, 신규 `DialogFooter` 정렬 옵션, 신규 `DialogFeedback` (state: idle/loading/success/error) 을 도입한다. 모든 기존 다이얼로그가 이 primitive 를 100% 사용하도록 마이그레이션한다.

## Acceptance Criteria

1. `DialogContent` 가 `tone` prop 을 받으며 destructive/warning 시 외곽선/색상 토큰이 변한다.
2. `DialogHeader` 가 `layout` prop(`row` 기본, `column` 옵트인) 을 받으며 sprint 91 의 row 기본 동작이 유지된다.
3. `DialogFeedback` 컴포넌트가 4-state(idle/loading/success/error) 를 받아 일관된 슬롯/스피너/아이콘을 렌더한다. sprint 92 의 ConnectionDialog 가 이 컴포넌트를 사용해 동일 동작을 유지한다.
4. 기존 10개 dialog 파일 모두 새 primitive 만 사용한다 (직접 `<div>` 로 헤더/피드백 슬롯을 만든 코드 0건).
5. 회귀 0: 모든 기존 dialog 테스트 통과, 신규 primitive 단위 테스트 추가.

## Components to Create/Modify

- `src/components/ui/dialog.tsx`: tone variant, layout prop, `DialogFeedback` 추가.
- `src/components/ui/dialog.test.tsx`: variant 단위 테스트.
- 모든 dialog 사용처: 직접 작성한 헤더/피드백을 base primitive 로 교체.
