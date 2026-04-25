# Sprint Execution Brief: sprint-100

## Objective
다중 statement 결과 → statement 별 Tabs 분리. 부분 실패 강조. 키보드 nav. 단일 statement 회귀 0.

## In Scope
- `src/types/query.ts` — `QueryStatementResult` 타입 + `QueryState.completed` 확장.
- `src/components/query/QueryTab.tsx` — 다중 루프에서 statement 결과 수집 + `statements` 배열 setState.
- `src/components/query/QueryResultGrid.tsx` — `statements` 길이 ≥ 2 시 Tabs 렌더, 단일은 기존 그대로.
- 테스트: `QueryTab.test.tsx` 다중 케이스 보강 + `QueryResultGrid` 다중 결과 테스트 (신규 파일 또는 확장).

## Out of Scope
- DocumentDataGrid 다중 결과, backend 변경.
- sprint-88~99 산출물 추가 변경 (mechanical mock 제외).

## Done Criteria
1. ≥ 2 statements 실행 → `role="tab"` N 개 + verb/rows-or-ms 라벨.
2. 부분 실패 탭 destructive marker + 에러 메시지.
3. 단일 statement 회귀 0.
4. ArrowRight/ArrowLeft 로 탭 전환.

## Verification
1. `pnpm vitest run`
2. `pnpm tsc --noEmit`
3. `pnpm lint`

## Hint
- 기존 다중 루프: `QueryTab.tsx:410-481`. 매 stmt 결과를 `statements` 배열에 push (`{sql, status, result?, error?, durationMs}`). 마지막 성공 결과를 `result` 로 유지하면 fallback 호환.
- Tabs primitive: `@/components/ui/tabs` (sprint-95/96 에서 PreviewDialog/TabsDialog 가 사용 — Radix Tabs wrapper 존재 여부 확인. 없으면 직접 import `@radix-ui/react-tabs`).
- `splitSqlStatements` 위치: 이미 사용 중. statement 별 SQL 도 `statements[i].sql` 에 보관.
- 부분 실패 status 처리: 현재 `errors.length > 0` 시 전체 `status: "error"` 로 표기. 사용자 요구는 "부분 실패 시 실패 statement 인덱스 강조" — `status: "completed"` + statements 배열에 per-stmt status 보존이 자연스러움. 모든 statement 실패 시에만 `status: "error"`.
- Radix Tabs 기본 keyboard nav: ArrowLeft/Right 로 탭 이동 (자동), Home/End. activationMode 미지정 시 "automatic".

## Untouched
- `memory/`, `CLAUDE.md`, sprint-88~99 산출물.
