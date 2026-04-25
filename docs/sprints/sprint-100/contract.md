# Sprint Contract: sprint-100

## Summary
- Goal: 다중 statement 실행 결과를 statement 별 탭으로 분리. 각 탭에 verb/rows/ms/Pass-Fail. 부분 실패 강조. 단일 statement 회귀 0.
- Profile: `command` (DOM assertion via Vitest + RTL — Radix Tabs 키보드 nav 도 포함)

## In Scope
- `src/types/query.ts`:
  - 새 인터페이스 `QueryStatementResult { sql: string; status: "success" | "error"; result?: QueryResult; error?: string; durationMs: number }`.
  - `QueryState` `completed` 분기 확장: `{ status: "completed"; result: QueryResult; statements?: QueryStatementResult[] }`. 단일 statement 호환 유지 — `statements` 미존재 시 기존 단일 결과 동작.
  - 또는 `{ status: "completed"; results: QueryStatementResult[] }` 새 분기 추가 (대안). Generator 가 호환성 최소 침습 옵션 선택.
- `src/components/query/QueryTab.tsx`:
  - 다중 statement 루프가 모든 statement 결과 (성공/실패) 를 수집해 `statements` 배열로 setState.
  - 부분 실패 시 status = "completed" 로 보존 (모두 실패는 "error" 그대로) — 또는 항상 statements 보존 후 화면에서 분기. Generator 결정.
  - 마지막 성공 결과는 `result` 로 유지 (단일 결과 fallback).
- `src/components/query/QueryResultGrid.tsx`:
  - `statements` 가 ≥ 2 이면 sprint-95/96 dialog 가 아닌 일반 Tabs primitive (Radix Tabs from `@/components/ui/tabs` 또는 신규 wrapper) 로 statement 별 섹션 렌더.
  - 각 탭 라벨: "Statement {n} {verb}" + 작은 뱃지 (rows/ms 또는 ✕ 아이콘).
  - 활성 탭의 콘텐츠: 성공 시 기존 `SelectResultArea` / `DmlMessage` / `DdlMessage` 재사용. 실패 시 빨간 destructive 배너 + 에러 메시지.
  - 단일 statement (`statements` 미존재 또는 length 1) 는 기존 단일 결과 그리드 그대로.
  - 키보드 좌/우 화살표로 탭 전환 — Radix Tabs 기본 동작 활용.
- 테스트:
  - `src/components/query/QueryTab.test.tsx` 다중 statement 케이스: statements 배열이 setState 되었는지 + 부분 실패 단언.
  - `src/components/query/QueryResultGrid.test.tsx` 또는 신규 `QueryResultGrid.multi-statement.test.tsx`: 탭 렌더, 부분 실패 강조, 키보드 좌/우 nav, 단일 statement 회귀.

## Out of Scope
- DocumentDataGrid 다중 결과.
- Backend (Tauri) 변경 — 이미 statement 단위로 호출 중.
- sprint-88~99 산출물 추가 변경 (mechanical mock 제외).
- `CLAUDE.md`, `memory/`.

## Invariants
- 회귀 0 (1735 + 신규 통과).
- 단일 statement happy path 기존 단언 그대로 통과.
- sprint-91~99 dialog/toast/empty-state 동작 보존.
- `addHistoryEntry` 단일/다중 모두 발화 보존.

## Acceptance Criteria
- AC-01: 다중 statement (≥ 2) 실행 후 결과 영역이 Tabs 로 분리. 각 탭 트리거에 verb (SELECT/DML/DDL/ERROR) + rows / ms 또는 ✕ 표시. `role="tab"` 으로 N 개 탭 단언.
- AC-02: 부분 실패 시 실패 statement 의 탭이 destructive 표시 (`data-status="error"` 또는 시각적 빨강) + 콘텐츠에 "Statement {n} failed" + 에러 메시지.
- AC-03: 단일 statement 실행 시 Tabs 미렌더 — 기존 단일 결과 그리드만 표시 (`role="tab"` 부재).
- AC-04: 좌/우 화살표로 탭 전환 가능 — Radix Tabs 의 기본 keyboard nav (`ArrowRight`/`ArrowLeft` 으로 활성 탭 이동).

## Verification Plan
1. `pnpm vitest run`
2. `pnpm tsc --noEmit`
3. `pnpm lint`

## Test Requirements
- AC-01: 2+ statement 다중 실행 후 `getAllByRole("tab").length === N` 단언 + 각 탭 라벨에 verb / rows-or-ms 단언.
- AC-02: 부분 실패 시 실패 탭의 marker (`data-status="error"` 또는 destructive 클래스) + 활성화 시 에러 메시지 가시성.
- AC-03: 단일 statement 실행 후 `queryByRole("tab") === null` + 기존 단일 결과 단언.
- AC-04: ArrowRight 키 입력 → 다음 탭 활성화 (Radix Tabs 의 `activationMode="automatic"` 기본 또는 manual + Enter).

## Exit Criteria
- P1/P2 findings: 0
- All checks pass
