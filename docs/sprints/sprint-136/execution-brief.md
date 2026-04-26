# Sprint Execution Brief: sprint-136

## Objective

Sidebar 클릭 의미를 paradigm 무관하게 통일한다 — single-click = preview tab(임시), double-click = persistent tab. PG와 Mongo 양쪽 모두 동일 모델. Function 카테고리 노드를 expand 했을 때 sidebar 외부 레이아웃을 미는 버그를 max-height + native scroll로 cap.

## Task Why

현재 PG sidebar는 single-click 즉시 persistent tab을 만들고, Mongo만 preview 의미를 갖는다. 사용자 점검(2026-04-27)에서 "VS Code/TablePlus처럼 single=preview, double=persist 가 직관적"이라는 피드백. 동시에 PG의 function 카테고리는 expand 시 sidebar height 자체가 늘어나서 그 위 노드들이 viewport 밖으로 밀린다. UX 일관성 + 레이아웃 안정성 두 갭을 한 sprint에서 처리.

## Scope Boundary

- 변경 가능: `src/components/schema/SchemaTree.tsx`, `DocumentDatabaseTree.tsx`, `src/components/layout/TabBar.tsx`, `src/stores/tabStore.ts`.
- 변경 금지: 백엔드(Rust), DbSwitcher, ConnectionDialog, query editor, import/export.
- 가상화(virtualization) 도입 금지 — max-height + native scroll만으로 충분.

## Invariants

- dirty marker(S134) — preview 시각 단서와 양립.
- DBMS shape(S135) — PG 3-레벨, MySQL 2-레벨, SQLite 1-레벨 유지.
- 즐겨찾기, 우클릭 메뉴, 키보드 네비게이션, Cmd+ 단축키 유지.
- DbSwitcher / DisconnectButton 동작 유지.

## Done Criteria

1. `tabStore`에 `preview: boolean` 필드(또는 동등) + promote action 작동.
2. PG sidebar single-click → preview tab 1개 swap (탭 누적 X).
3. PG sidebar 같은 row double-click → preview false promote.
4. Mongo collection 클릭이 동일 모델.
5. 같은 row single-click 2회 → idempotent.
6. Function 카테고리 expand 시 max-height + overflow-y-auto 로 외부 레이아웃 미지장.
7. Preview tab 시각 단서가 TabBar 에 표시 + dirty marker 와 양립.
8. 7개 verification command 그린.

## Verification Plan

- Profile: mixed
- Required checks:
  1. `pnpm vitest run`
  2. `pnpm tsc --noEmit`
  3. `pnpm lint`
  4. `pnpm contrast:check`
  5. `cargo test --manifest-path src-tauri/Cargo.toml --lib`
  6. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`
  7. `pnpm exec eslint e2e/**/*.ts`
- Required evidence:
  - 7개 명령 출력 (last 20 lines)
  - 각 AC별 vitest test 이름 + 통과 라인

## Evidence To Return

- 변경 파일 목록 (path + 한 줄 purpose)
- 7개 verification command 출력
- AC-S136-01..AC-S136-08 각각의 증거
- 가정/리스크

## References

- Contract: `docs/sprints/sprint-136/contract.md`
- Master spec: `docs/sprints/sprint-134/spec.md` (Phase 10)
- S134, S135 baseline: `docs/sprints/sprint-134/handoff.md`, `docs/sprints/sprint-135/handoff.md`
- Lesson: `memory/lessons/2026-04-27-workspace-toolbar-ux-gaps/memory.md`
- Relevant files (read first):
  - `src/components/schema/SchemaTree.tsx` + `.test.tsx`
  - `src/components/schema/DocumentDatabaseTree.tsx` + `.test.tsx`
  - `src/components/layout/TabBar.tsx` + `.test.tsx`
  - `src/stores/tabStore.ts` + `.test.ts`
  - `src/types/tab.ts` (Tab 타입 정의)
