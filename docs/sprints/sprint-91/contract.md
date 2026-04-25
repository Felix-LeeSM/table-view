# Sprint Contract: sprint-91

## Summary

- Goal: `DialogHeader` 기본 레이아웃을 row 기반으로 교정해 모든 다이얼로그가 X 버튼을 0개 또는 1개만 노출하도록 통일하고, 긴 title 입력 시 truncate 가 동작하도록 한다.
- Audience: Generator + Evaluator
- Owner: Generator
- Verification Profile: `mixed` (jsdom + RTL DOM/className 단언 + 정적 grep 감사)

## In Scope

- `src/components/ui/dialog.tsx` — `DialogHeader` 기본 클래스를 row 기반(`flex flex-row items-center justify-between gap-2`) 으로 변경. `min-w-0` 등 truncate 친화 클래스 포함.
- `src/components/ui/dialog.test.tsx` (신규) — DialogHeader row 레이아웃 단언, `showCloseButton` 토글 단언, close 버튼 중복 방지 단언.
- 기존 9개 다이얼로그 컴포넌트 close 버튼 정책 audit:
  - `ConnectionDialog`, `GroupDialog`, `ImportExportDialog`, `BlobViewerDialog`, `CellDetailDialog`, `SqlPreviewDialog`, `MqlPreviewModal`, `AddDocumentModal`, `ConfirmDialog`
  - 각 다이얼로그가 close 버튼 1개 또는 0개 (절대 2개 이상 아님) 보장.
  - `ConnectionDialog.tsx` 의 사전 수동 workaround (현재 working tree) 는 `DialogHeader` 수정 후 통합 — 수동 `<div className="flex flex-row items-center justify-between …">` 를 다시 `<DialogHeader>` 로 환원 가능 시 환원, 아니면 유지.
- 다이얼로그별 close 버튼 중복 방지 단언 (각 다이얼로그 test 에 1줄 추가하거나 `dialog.test.tsx` 매트릭스 단언으로 일괄).

## Out of Scope

- 다이얼로그 콘텐츠 (form, table, footer 등) 변경.
- 다이얼로그 너비 / 그 외 시각 스타일 변경.
- 다이얼로그 외 컴포넌트.
- sprint-88/89/90 산출물.

## Invariants

- 기존 다이얼로그별 happy-path 테스트 모두 통과 — 회귀 0.
- close 버튼 동작 (호출 시 onClose 호출) 변하지 않음.
- `showCloseButton={false}` 의미 (absolute X 미렌더) 변하지 않음.
- `CLAUDE.md`, `memory/`, sprint-88/89/90 산출물 변경 0.

## Acceptance Criteria

- `AC-01` `DialogHeader` 의 기본 클래스가 row 기반 — `flex flex-row items-center justify-between` 또는 동등 토큰. 단언 위치: `dialog.test.tsx`.
- `AC-02` `DialogHeader` 가 긴 title 을 truncate 가능 — title 컨테이너에 `min-w-0` 가 적용되거나, title 자체가 truncate 클래스를 받을 수 있는 구조. 자동 truncate 검증은 jsdom 한계로 className 단언으로 대체.
- `AC-03` `<DialogContent>` 의 `showCloseButton={false}` 시 absolute X (`[data-slot="dialog-close"]` 또는 `name=/close/i`) 가 부재. 단언 위치: `dialog.test.tsx`.
- `AC-04` 9개 다이얼로그(`ConnectionDialog`, `GroupDialog`, `ImportExportDialog`, `BlobViewerDialog`, `CellDetailDialog`, `SqlPreviewDialog`, `MqlPreviewModal`, `AddDocumentModal`, `ConfirmDialog`) 의 close 버튼 (`getAllByRole("button", { name: /close/i })`) 이 0 개 또는 1 개. **절대 2 개 이상 아님**. 매트릭스 단언으로 일괄 검증 가능.
- `AC-05` 기존 `*.test.tsx` happy-path 회귀 0.

## Design Bar / Quality Bar

- `DialogHeader` 기본 클래스 변경은 모든 사용처에 영향이 있으므로 보수적으로 — 기존 사용처는 row 기반을 기대. 사용처 grep 으로 확인.
- 매트릭스 테스트는 다이얼로그별 mock 의존성을 최소화. 필요 시 다이얼로그를 단순 props 로 렌더 (예: 빈 connection, 빈 schema).

## Verification Plan

### Required Checks

1. `pnpm vitest run` — 0 failures.
2. `pnpm tsc --noEmit` — exit 0.
3. `pnpm lint` — exit 0.
4. `grep -n "flex flex-row\|items-center\|justify-between" src/components/ui/dialog.tsx` — 1+ 라인 (DialogHeader 기본 클래스 라인).
5. `grep -rn "name: /close/i" src/components` — 9개 다이얼로그 중 다수 또는 매트릭스 1개에서 검출.

### Required Evidence

- Generator: 변경 파일 목록 + 명령 출력 + AC 단언 라인 인용 + 다이얼로그별 close 버튼 카운트 표.
- Evaluator: AC 별 라인 인용 + 다이얼로그별 close 버튼 1개 단언 통과 + 회귀 0 검증.

## Test Requirements

### Unit Tests (필수)
- DialogHeader 기본 row 레이아웃 단언 ≥ 1.
- `showCloseButton={false}` absolute X 부재 단언 ≥ 1.
- 긴 title truncate-friendly 클래스 단언 ≥ 1.

### Matrix Test (필수)
- 9 개 다이얼로그 close 버튼 카운트 ≤ 1 단언 (matrix it.each 가능).

### Coverage Target
- 신규 코드 라인 70%+.

### Scenario Tests (필수)
- [x] Happy path: 정상 다이얼로그 1개 close 버튼
- [x] 경계 조건: 긴 title 입력 시 layout 유지
- [x] 회귀 없음: 기존 다이얼로그별 happy-path 통과

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
