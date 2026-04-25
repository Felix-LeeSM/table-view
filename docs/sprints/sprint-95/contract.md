# Sprint Contract: sprint-95

## Summary

- Goal: Dialog 2-Layer Primitive Layer 1 — `DialogContent.tone` variant, `DialogHeader.layout` prop, `DialogFeedback` (4-state) 도입. 기존 다이얼로그 마이그레이션.
- Audience: Generator + Evaluator
- Owner: Generator
- Verification Profile: `command`

## In Scope

- `src/components/ui/dialog.tsx`:
  - `DialogContent` 에 `tone?: "default" | "destructive" | "warning"` 추가 → CVA 또는 conditional className 으로 outline + bg accent.
  - `DialogHeader` 에 `layout?: "row" | "column"` prop 추가 — `row` 기본 (sprint-91 동작 유지), `column` 옵트인.
  - `DialogFeedback` (신규): props `{ state: "idle" | "loading" | "success" | "error"; message?: string; loadingText?: string }` — sprint-92 의 ConnectionDialog test 슬롯 패턴 일반화.
- `src/components/ui/dialog.test.tsx`: tone variant 단언, layout prop 단언, DialogFeedback 4-state 단언.
- 기존 다이얼로그 마이그레이션 (필요 시):
  - `ConnectionDialog`: 직접 만든 test 슬롯을 `DialogFeedback` 으로 교체 — sprint-92 동작 보존.
  - 헤더 layout 직접 override 가 없는지 확인 (대부분 sprint-91 에서 row 기본).
  - destructive/warning 톤이 어울리는 confirm 다이얼로그 (`ConfirmDialog`) 는 tone="destructive" 적용.

## Out of Scope

- Layer 2 컴포지트 (sprint-96 이후).
- 다이얼로그 콘텐츠/레이아웃 재설계.
- sprint-88~94 산출물의 *추가* 변경 (sprint-92 ConnectionDialog 슬롯은 마이그레이션 대상이지만 동작은 보존).
- `CLAUDE.md`, `memory/`.

## Invariants

- 기존 다이얼로그별 happy-path 회귀 0 — 특히 sprint-92 `expectNodeStable` 단언 통과.
- `DialogHeader` row 기본 (sprint-91) 보존.
- close 버튼 카운트 매트릭스 (sprint-91) 통과.
- toast hookup (sprint-94) 회귀 0.

## Acceptance Criteria

- `AC-01` `DialogContent.tone` 가 `default | destructive | warning` 토큰 받음. tone 별 className 단언 (예: destructive 시 `border-destructive` 또는 동등 토큰).
- `AC-02` `DialogHeader.layout` 가 `row | column`. 기본 `row`. `column` 시 `flex-col` 적용.
- `AC-03` `DialogFeedback` 가 4-state 받아 idle 빈 슬롯, loading 시 spinner+text, success/error 시 메시지 + 적절한 색상/아이콘 렌더. `data-slot="dialog-feedback"` 부여.
- `AC-04` `ConnectionDialog` 의 test 슬롯이 `DialogFeedback` 으로 교체되어 sprint-92 의 `expectNodeStable` 단언 통과.
- `AC-05` `ConfirmDialog` (destructive 동작 시) `tone="destructive"` 사용 — tone 단언.
- `AC-06` 기존 sprint-91 9-dialog matrix close 카운트 단언 통과.
- `AC-07` 회귀 0.

## Design Bar / Quality Bar

- CVA 또는 conditional className 으로 tone 구현 — 기존 shadcn 스타일과 일관.
- `DialogFeedback` 의 stable identity (sprint-92 항시 마운트 + min-h) 보존.
- 마이그레이션 시 ConnectionDialog 의 `data-slot="test-feedback"` 는 그대로 유지 (sprint-92 단언 호환).

## Verification Plan

### Required Checks

1. `pnpm vitest run` — 0 failures.
2. `pnpm tsc --noEmit` — exit 0.
3. `pnpm lint` — exit 0.
4. `grep -n 'tone:\|layout:\|DialogFeedback\|data-slot="dialog-feedback"' src/components/ui/dialog.tsx` — 1+ 라인.
5. `grep -rn "DialogFeedback\|tone=\"destructive\"" src/components` — 사용 사이트 검출.

### Required Evidence

- Generator: 변경 파일 + 명령 출력 + AC 별 라인 인용 + 마이그레이션 사이트 표.
- Evaluator: AC 별 라인 인용 + 회귀 0 검증.

## Test Requirements

### Unit Tests (필수)
- DialogContent tone variant 단언 (3 variants).
- DialogHeader layout prop 단언 (row/column).
- DialogFeedback 4-state 단언 (idle/loading/success/error).
- ConnectionDialog 마이그레이션 후 sprint-92 단언 통과.
- ConfirmDialog tone="destructive" 단언.

### Coverage Target
- 신규 코드 라인 70%+.

## Test Script / Repro Script

1. `pnpm vitest run`
2. `pnpm tsc --noEmit`
3. `pnpm lint`

## Ownership

- Generator: 단일 agent.
- Write scope: contract In Scope 만.
- Merge order: 단일 PR.

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes`
- Acceptance criteria evidence linked in `findings.md`
