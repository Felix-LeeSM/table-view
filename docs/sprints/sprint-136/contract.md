# Sprint Contract: sprint-136

## Summary

- Goal: Sidebar 클릭 의미를 paradigm 무관하게 통일 — single-click = preview tab(임시), double-click = persistent tab. Function 카테고리 노드를 expand 했을 때 모든 함수가 펼쳐져 sidebar 외부 레이아웃을 미는 버그를 max-height + overflow-y-auto 컨테이너로 cap.
- Audience: Phase 10 사용자 점검 #8 (preview semantics) + #11 (function overflow).
- Owner: Generator (general-purpose)
- Verification Profile: `mixed`

## In Scope

- MODIFY `src/stores/tabStore.ts` (+ test) — `preview: boolean` 필드와 `promoteTab(tabId)` action (이미 비슷한 게 있다면 통합).
- MODIFY `src/components/schema/SchemaTree.tsx` (+ test) — single-click 핸들러가 preview tab을 swap, double-click이 promote.
- MODIFY `src/components/schema/DocumentDatabaseTree.tsx` (+ test) — collection 클릭이 동일 모델.
- MODIFY `src/components/layout/TabBar.tsx` (+ test) — preview tab의 시각 단서 (italic / dotted underline 등 기존 컨벤션 따름).
- MODIFY `src/components/schema/SchemaTree.tsx` — function category 컨테이너 max-height + overflow-y-auto.
- 신규 vitest tests for preview semantics (PG, Mongo) + overflow scroll.

## Out of Scope

- ConnectionSwitcher / SchemaSwitcher (S134, S135 완료).
- Mongo switch-DB stale (S137).
- DBMS-aware connection form (S138).
- Paradigm-aware query editor (S139).
- 암호화 export/import (S140).
- 가상화(virtualization) — 이 sprint는 max-height + native scroll로 cap만.

## Invariants

- 즐겨찾기 / 우클릭 메뉴 / 키보드 네비게이션 미파손.
- `dirty` tab(S134) 회귀 가드 — preview 시각 단서가 dirty marker를 가리지 않음.
- Cmd+1..9 / Cmd+W / Cmd+T / Cmd+S 동작 유지.
- 기존 `addQueryTab`, `addTableTab` 등 시그니처 유지 (옵션으로 `preview?: boolean` 추가는 OK).
- DbSwitcher / DisconnectButton (S134) / SchemaTree DBMS shape (S135) 동작 유지.

## Acceptance Criteria

- `AC-S136-01` PG sidebar table row single-click → preview tab 1개 생성 (`tab.preview === true`). 다른 row로 이동하면 동일한 preview tab이 swap (탭 누적 X).
- `AC-S136-02` 같은 row 더블클릭 → preview flag promote → `preview === false`, persistent.
- `AC-S136-03` Mongo collection 클릭이 동일 모델 (single=preview, double=persist).
- `AC-S136-04` 같은 row 단일 클릭 두 번 → idempotent (preview tab이 자기 자신 위에 머무르고 새 탭 X, promote도 X).
- `AC-S136-05` Function 카테고리 expand 시 sidebar 컨테이너가 max-height + overflow-y-auto 로 cap. 함수 50+개 fixture에서 외부 레이아웃 미지장.
- `AC-S136-06` Preview tab의 시각 단서 (italic / dotted underline 등)가 TabBar에 표시되며 dirty marker와 양립 — vitest test가 동시 표기 케이스 어서션.
- `AC-S136-07` 회귀 가드: 즐겨찾기, 우클릭 메뉴, 키보드 네비게이션, dirty marker(S134), DBMS shape(S135) 미파손.
- `AC-S136-08` 6 게이트 + e2e static lint 그린.

## Design Bar / Quality Bar

- Preview/persist 시각 단서는 컨벤션을 따른다 (다크 모드, a11y aria-label).
- `assertNever` 등 type narrow — `any` 금지.
- 신규 test는 사용자 관점 query.

## Verification Plan

### Required Checks

1. `pnpm vitest run`
2. `pnpm tsc --noEmit`
3. `pnpm lint`
4. `pnpm contrast:check`
5. `cargo test --manifest-path src-tauri/Cargo.toml --lib`
6. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`
7. `pnpm exec eslint e2e/**/*.ts`

### Required Evidence

- 변경 파일 목록 (path + 한 줄 purpose)
- 7개 verification command 출력
- 각 AC별 vitest test 이름

## Test Requirements

### Unit Tests (필수)
- AC-01..04: SchemaTree click semantics test + tabStore preview/promote test
- AC-03: DocumentDatabaseTree click semantics test
- AC-05: SchemaTree function category overflow test
- AC-06: TabBar preview visual cue test (idle + dirty 양립)

### Coverage Target
- 신규/수정 파일 라인 70% 이상.

### Scenario Tests (필수)
- [ ] Happy path: PG single-click → preview, double-click → promote
- [ ] 에러/예외: 동일 row 단일 클릭 두 번 → idempotent
- [ ] 경계 조건: function 100+개 → 외부 layout 변동 없음
- [ ] 기존 기능 회귀 없음: dirty marker, DBMS shape, 즐겨찾기

## Test Script / Repro Script

1-7. 7개 verification command

## Ownership

- Generator: general-purpose agent
- Write scope: `src/components/schema/`, `src/components/layout/`, `src/stores/tabStore.ts`
- Merge order: S134 → S135 → **S136** → S137 → … → S140

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes`
