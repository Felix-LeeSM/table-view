# Sprint Execution Brief: sprint-95

## Objective

Dialog 2-Layer Primitive Layer 1 — `DialogContent.tone`, `DialogHeader.layout`, `DialogFeedback` (4-state) 도입. ConnectionDialog test 슬롯을 `DialogFeedback` 으로 마이그레이션. ConfirmDialog 에 destructive tone 적용.

## Task Why

ui-evaluation §6.6 part 1. 다이얼로그별로 header/feedback 슬롯을 직접 작성하면 sprint-92 같은 패턴(slot stable + 4-state) 이 매번 재발명된다. Layer 1 primitive 로 정형화한다.

## Scope Boundary

**쓰기 허용**:
- `src/components/ui/dialog.tsx`
- `src/components/ui/dialog.test.tsx`
- 마이그레이션 대상 다이얼로그:
  - `src/components/connection/ConnectionDialog.tsx`
  - `src/components/connection/ConnectionDialog.test.tsx`
  - `src/components/shared/ConfirmDialog.tsx` (+ 있으면 test)
- 그 외 다이얼로그는 사용 검토 후 변경 권장 시 한해서 (out of scope 권장)

**쓰기 금지**:
- 다이얼로그 콘텐츠 / 레이아웃 변경
- sprint-88~94 산출물의 *추가* 변경 (sprint-92 슬롯 마이그레이션 제외)
- `CLAUDE.md`, `memory/`

## Invariants

- sprint-91 close 카운트 매트릭스 통과
- sprint-92 expectNodeStable identity 단언 통과
- sprint-94 toast hookup 회귀 0
- 기존 happy-path 회귀 0

## Done Criteria

1. DialogContent.tone, DialogHeader.layout, DialogFeedback 추가 + 단위 단언.
2. ConnectionDialog 가 `<DialogFeedback>` 사용 — sprint-92 단언 통과.
3. ConfirmDialog destructive 동작 시 tone="destructive".
4. 기존 dialog 테스트 회귀 0.

## Verification Plan

- Profile: `command`
- Required checks:
  1. `pnpm vitest run`
  2. `pnpm tsc --noEmit`
  3. `pnpm lint`
  4. `grep` 으로 tone/layout/DialogFeedback API 확인
  5. 마이그레이션 사이트 grep

## Evidence To Return

- 변경 파일 + 목적
- 명령 출력 + AC 별 라인 인용
- 마이그레이션 사이트 표
- 가정/위험

## References

- Contract: `docs/sprints/sprint-95/contract.md`
- Spec: `docs/sprints/sprint-95/spec.md`
- sprint-91 dialog 디폴트 row, sprint-92 expectNodeStable, sprint-94 toast hookup
