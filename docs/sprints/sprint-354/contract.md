# Sprint Contract: sprint-354

## Summary

- Goal: Phase 0 (a) counter seed (M-2 fix) — `tabCounter`/`queryCounter` 가 boot 직후 `Math.max(persisted ids) + 1` 로 시드되어 id 충돌 0. (b) L2 fix — `schemaStore` 의 비-schema 5 메서드 호출 사이트를 `lib/tauri/*` 직접 호출로 변경.
- Audience: state-management-strategy-2026-05-15 Phase 0 — M-2 counter seed + L2 schemaStore 책임 누수 정리.
- Owner: Generator (sprint-354)
- Verification Profile: `frontend` (pnpm vitest + pnpm tsc + pnpm lint)

## In Scope

- `src/stores/workspaceStore.ts` — `tabCounter` / `queryCounter` boot 시 seed 로직 (hydrate 직후 reduce).
- `src/stores/schemaStore.ts` — 비-schema 5 메서드 제거 (정확 메서드 식별은 Generator 가 `grep` 으로 inventory).
- 메서드 caller 사이트 (예: `src/components/layout/Sidebar.tsx`, query/connection 관련 컴포넌트) — `lib/tauri/*` 직접 호출로 변경.
- 단위 테스트 `src/stores/workspaceStore.counterSeed.test.ts` + `src/stores/schemaStore.scope.test.ts` (2026-05-16).

## Out of Scope

- Dehydration (sprint-353).
- SQLite 이주 (sprint-355+).
- 비-schema 메서드 의 실제 backend impl 변경.

## Invariants

- 기존 `schemaStore` 의 schema-fetching 메서드 (sidebar 트리 데이터) 는 변경 0.
- Counter seed 후 신규 tab 추가 시 기존 persisted id 와 충돌 0.
- caller 사이트의 동작 (UI / 호출 시점) 회귀 0.
- 모든 grep CI 통과.

## Acceptance Criteria

- `AC-354-01` Counter seed: 5 persisted tab (id `tab-1`, `tab-3`, `tab-7`, `tab-10`, `tab-12`) 시드 후 boot → `tabCounter = 13`. 그 후 `addTab` 시 새 id `tab-13`. Test: counter seed unit test.
- `AC-354-02` queryCounter 동일 시드 패턴 검증. Test: persisted query tabs 시드 → counter = max+1.
- `AC-354-03` 빈 persisted 시: `tabCounter = 1`, `queryCounter = 1`. Test: 빈 array 시드 → counter default.
- `AC-354-04` `schemaStore` 의 비-schema 메서드 인벤토리 (정확 5개 — Generator 가 `findings.md` 에 명시) → 모두 store 에서 제거. caller 사이트는 `lib/tauri/connection.ts` / `lib/tauri/query.ts` 등 직접 import.
- `AC-354-05` grep CI: `src/components/**/*.tsx` 에서 `useSchemaStore` 의 비-schema 메서드 read 사이트 0 (식별된 메서드명들).
- `AC-354-06` `schemaStore` 회귀 0: 기존 sidebar 트리 fetch 테스트가 모두 green 유지.

## Design Bar / Quality Bar

- TDD: red test first (e.g. counter assertion / grep test) → 구현 → refactor.
- 비-schema 메서드 식별은 `findings.md` 에 표 형식 (메서드명 | 현재 호출 사이트 | 신규 호출 사이트).
- caller 사이트 1개씩 단위 회귀 테스트 (호출 직후 동일 결과 화면 마운트).
- 테스트 작성 날짜 + 사유 코멘트.

## Verification Plan

### Required Checks

1. `pnpm tsc --noEmit`
2. `pnpm lint`
3. `pnpm vitest run src/stores/workspaceStore src/stores/schemaStore`
4. `pnpm vitest run` (full)

### Required Evidence

- 비-schema 메서드 5개 인벤토리 (handoff).
- Counter seed 시드 케이스 5개 raw 결과.
- grep CI raw 결과 (`pnpm lint` 또는 별도 grep test) — 0건 확인.

## Test Requirements

- Unit: 6 AC × 1+ 테스트.
- Coverage: `workspaceStore` counter seed 라인 + `schemaStore` 변경 라인 70% 이상.
- Scenario: (a) 빈 persisted, (b) 단일 tab persist, (c) gap 있는 sequential, (d) caller mount 회귀.

## Test Script / Repro Script

1. `pnpm vitest run src/stores/workspaceStore.counterSeed.test.ts`
2. `pnpm vitest run src/stores/schemaStore.scope.test.ts`
3. `pnpm vitest run` (full)
4. `pnpm tsc --noEmit && pnpm lint`

## Ownership

- Generator: general-purpose Agent.
- Write scope: In Scope 파일만.
- Merge order: 353 / 354 병렬 가능, Phase 1 전 둘 다 머지.

## Exit Criteria

- Open P1/P2: 0
- AC 6/6 PASS
- 비-schema 메서드 read 사이트 0
