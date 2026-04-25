# Sprint Execution Brief: sprint-91

## Objective

`DialogHeader` 기본 레이아웃을 row 기반(`flex flex-row items-center justify-between`) 으로 교정해 모든 다이얼로그가 X 닫기 버튼을 0개 또는 1개만 노출하도록 통일.

## Task Why

P1 사용자 리포트 (#DIALOG-1). `DialogHeader` 의 `flex flex-col` 디폴트 때문에 다이얼로그마다 수동 `<div>` 또는 `flex items-center` override 를 넣고 있고, 일부 다이얼로그에는 X 버튼이 2개 (DialogContent 의 absolute + 헤더의 수동) 노출될 위험이 있다. 시스템 차원에서 한 번에 정상화한다.

## Scope Boundary

**쓰기 허용**:
- `src/components/ui/dialog.tsx`
- `src/components/ui/dialog.test.tsx` (신규)
- 9개 다이얼로그 중 close 버튼 정책 audit 가 필요한 곳 (`ConnectionDialog`, `GroupDialog`, `ImportExportDialog`, `BlobViewerDialog`, `CellDetailDialog`, `SqlPreviewDialog`, `MqlPreviewModal`, `AddDocumentModal`, `ConfirmDialog`)
- 위 다이얼로그들의 `*.test.tsx` (close 버튼 카운트 단언 추가)

**쓰기 금지**:
- 다이얼로그 콘텐츠 (form, table, footer 등)
- 다이얼로그 외 컴포넌트
- sprint-88/89/90 산출물
- `CLAUDE.md`, `memory/`

## Invariants

- 기존 happy-path 테스트 회귀 0.
- close 버튼 onClose 동작 변경 없음.
- `showCloseButton={false}` 의미 변경 없음.

## Done Criteria

1. `DialogHeader` 기본 클래스가 `flex flex-row items-center justify-between gap-2` (또는 동등 토큰) 으로 변경됨.
2. `dialog.test.tsx` 가 row 레이아웃 + `showCloseButton={false}` 부재 + close 버튼 중복 방지 단언 보유.
3. 9 개 다이얼로그 close 버튼 (`getAllByRole("button", { name: /close/i })`) 카운트 ≤ 1.
4. 기존 다이얼로그별 happy-path 테스트 통과.

## Verification Plan

- Profile: `mixed` (jsdom + RTL + grep)
- Required checks:
  1. `pnpm vitest run`
  2. `pnpm tsc --noEmit`
  3. `pnpm lint`
  4. `grep -n "flex flex-row\|items-center\|justify-between" src/components/ui/dialog.tsx`
  5. 9 개 다이얼로그 close 버튼 카운트 매트릭스 단언

## Evidence To Return

- 변경 파일 목록 + 목적
- 명령 출력 + AC 별 라인 인용
- 9 개 다이얼로그 close 버튼 카운트 표
- 사전 ConnectionDialog 수동 workaround 통합 결정 (환원/유지) 기록

## Pre-existing Working Tree Note

- `src/components/connection/ConnectionDialog.tsx` 에 사전 수동 workaround 가 있다 (line 142, `<DialogHeader>` 대신 `<div className="flex flex-row items-center justify-between …">`).
- sprint-91 에서 `DialogHeader` 디폴트가 row 로 바뀌면 이 수동 workaround 는 불필요 — 환원(원래대로 `DialogHeader` 사용) 하거나 유지 (Generator 판단). 환원 시 다이얼로그 import 도 정리.

## References

- Contract: `docs/sprints/sprint-91/contract.md`
- Spec: `docs/sprints/sprint-91/spec.md`
