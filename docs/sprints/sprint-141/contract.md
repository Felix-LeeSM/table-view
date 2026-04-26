# Sprint 141 Contract — Disabled Tooltip 카피 정리 (topic AC-146-*)

## Summary

- Goal: 사용자에게 노출되는 disabled 안내문에서 sprint/phase 내부 표현을 제거하고, "stuck tooltip" 버그(native HTML `title=` + Radix Tooltip 중복) 수정.
- Audience: 사용자 / 향후 sprint 들에 카피 일관성 가이드 제공.
- Verification Profile: `command` (vitest static + component test).

## In Scope

- `src/components/workspace/DbSwitcher.tsx` 의 `READ_ONLY_TOOLTIP` 카피 교체 + native HTML `title` 속성 제거.
- `src/__tests__/no-stale-sprint-tooltip.test.ts` 를 확장: `coming|lands?|arrives?|available in (sprint|phase) NN` 패턴까지 잡도록.
- 기타 disabled 안내문 중 동 가드에 걸리는 것들 동시 정리 (`QueryEditor.tsx`, `UnsupportedShellNotice.tsx` 의 "coming in Phase 9").

## Out of Scope

- Tooltip 위치/스타일 디자인 변경.
- Disabled 상태가 아닌 normal hover 의 tooltip.
- DbSwitcher 의 functional 동작 변경 (popover, fetch list 등).

## Invariants

- DbSwitcher 의 enabled path (RDB/document 연결됨) 동작 불변.
- Radix Tooltip 의 delay/dismiss 기본 동작은 그대로 사용.
- 기존 `Coming in Sprint 1[2-3][0-9]` 가드는 유지(완전 제거가 아니라 확장).

## Acceptance Criteria

- `AC-141-1` `src/` 어디에도 `"Switching DBs lands in sprint 130"` 문자열이 존재하지 않는다.
- `AC-141-2` 가드 테스트 `no-stale-sprint-tooltip` 가 신규 패턴 4개 (`coming in (sprint|phase) N`, `lands? in (sprint|phase) N`, `arrives? in (sprint|phase) N`, `available in (sprint|phase) N`) 를 case-insensitive 로 검출한다.
- `AC-141-3` `DbSwitcher` 의 read-only 트리거에 native HTML `title=` 속성이 없다 (Radix Tooltip 만 사용).
- `AC-141-4` `DbSwitcher` 의 read-only tooltip 텍스트는 sprint/phase 내부 표현을 포함하지 않으며, paradigm/연결 상태에 따른 사용자 친화적 문장이다 (예: kv/search → "Database switching isn't supported for this connection type", disconnected → "Connect to switch databases").
- `AC-141-5` `QueryEditor.tsx` / `UnsupportedShellNotice.tsx` 의 "coming in Phase 9" 카피가 version-agnostic 사용자 카피로 교체된다 (예: "Redis support is planned but not yet available").

## Verification Plan

### Required Checks

1. `pnpm vitest run src/__tests__/no-stale-sprint-tooltip.test.ts` — 확장된 가드가 통과 (현 코드에 위반 없음).
2. `pnpm vitest run src/components/workspace/DbSwitcher.test.tsx` — 신규 케이스 (`title` 속성 없음, paradigm-aware 카피) 가 통과.
3. `pnpm tsc --noEmit` 통과.
4. `pnpm lint` 통과.

### Required Evidence

- Generator/Author 가 제공:
  - 변경 파일 + 변경 의도 한 줄.
  - 위 4개 명령 실행 결과.
- Evaluator 가 인용:
  - AC-141-1~5 각각의 실제 코드 라인 (또는 라인 부재 증명).

## Test Requirements

### Unit Tests (필수)
- 가드 정규식 4종 추가 + 위반 시 fail 메시지에 패턴 명시.
- DbSwitcher read-only 모드: `title` 속성 부재 단언.
- DbSwitcher read-only 모드: 다양한 paradigm × 연결 상태에서 tooltip 카피가 sprint/phase 키워드 미포함.

### Coverage Target
- 변경된 두 컴포넌트 라인 70% 이상.

### Scenario Tests (필수)
- [x] Happy path — disabled 트리거에 hover 시 tooltip 표시.
- [x] 회귀 — enabled DbSwitcher 의 popover open/close 영향 없음.
- [x] 경계 — 가드 정규식이 comment 라인 (`// Sprint 130 — ...`) 은 무시.
- [x] 회귀 — 기존 `Coming in Sprint 1[2-3][0-9]` 가드 패스.

## Test Script

1. `pnpm vitest run src/__tests__/no-stale-sprint-tooltip.test.ts`
2. `pnpm vitest run src/components/workspace/DbSwitcher.test.tsx`
3. `pnpm tsc --noEmit`
4. `pnpm lint`

## Exit Criteria

- 4개 명령 모두 통과.
- AC-141-1~5 각각에 대한 실제 코드 / 테스트 증거가 존재.
- 변경 디프가 in-scope 이외 파일을 건드리지 않는다.
