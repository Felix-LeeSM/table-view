# Sprint Execution Brief: sprint-125

## Objective

기존 `Sidebar`(connections-mode + schemas-mode 토글)를 두 화면으로 분리:
- **HomePage**: paradigm-agnostic 연결 CRUD (ConnectionList + Group + Import/Export + 최근).
- **WorkspacePage**: 기존 Sidebar(schemas-only) + MainArea + `[← Connections]` 버튼.

`appShellStore`로 `screen: 'home' | 'workspace'`를 관리하고 `App.tsx`에서 둘 중 하나를 풀스크린 렌더한다.

## Task Why

- Sprints 126-133 시리즈의 토대. paradigm 사이드바 swap / 툴바 / DB switcher / raw-query 감지 등은 모두 "Workspace"가 별개 화면일 때만 깔끔히 들어맞는다.
- 현 `SchemaPanel`이 paradigm 4개 분기를 흡수하는 god-component로 비대해지는 추세. Home/Workspace를 가르면 connection-mgmt 코드가 paradigm-agnostic으로 분리되어 god-component 비대화가 멈춘다.
- 사용자 결정: `Home과 Workspace 풀스크린 swap (2a) + 단일 Workspace 다중-paradigm 탭 공존 (1a)`. 본 sprint는 그중 (2a) 실현.

## Scope Boundary

- 백엔드 (`src-tauri/`) 변경 금지.
- 기존 store(connectionStore / tabStore / schemaStore / queryHistoryStore) public API 변경 금지.
- Workspace 툴바 / connection switcher / DB switcher 추가 금지 (S127-S131).
- DocumentSidebar 추출 금지 (S126).
- 신규 단축키(Cmd+,) 추가 금지 (S133).
- "최근 사용" 영역 실제 데이터 wiring 금지 (placeholder 자리만).

## Invariants

- 기존 vitest 1882개 모두 그린.
- 기존 단축키 (Ctrl+N, Ctrl+P, Ctrl+/) 동작 보존.
- 테마/contrast 회귀 0건.
- Sprint 123 paradigm 시각 큐 보존.
- ConnectionDialog / GroupDialog / ImportExportDialog 모두 Home에서 정상 작동.
- TabBar는 Workspace에서만 보임.

## Done Criteria

1. 부팅 시 Home 노출 (ConnectionList + New/Import-Export 버튼).
2. Connection Open → Workspace swap, schema 트리 + 메인 영역 노출.
3. `[← Connections]` 버튼 (aria-label `Back to connections`) → Home 복귀, 탭 zustand 보존.
4. Workspace에서 SidebarModeToggle 미마운트.
5. 갱신된 기존 e2e + 신규 `e2e/home-workspace-swap.spec.ts` 모두 정적 컴파일 통과.
6. 신규 단위 테스트: `appShellStore.test.ts`, `HomePage.test.tsx`, `WorkspacePage.test.tsx`.
7. `pnpm vitest run` / `pnpm tsc --noEmit` / `pnpm lint` / `pnpm contrast:check` 모두 그린.

## Verification Plan

- Profile: `mixed`
- Required checks:
  1. `pnpm tsc --noEmit`
  2. `pnpm lint`
  3. `pnpm vitest run`
  4. `pnpm contrast:check`
  5. e2e 정적 컴파일 (wdio import 검증)
  6. Browser smoke: `pnpm tauri dev` → Home → Open Test PG → Workspace → Back → 재 Open → 같은 탭 활성
- Required evidence:
  - 각 AC에 대한 file:line 또는 test:line 매핑 한 줄
  - SidebarModeToggle 미마운트 직접 검증 (RTL `queryByRole('tab', {name: /mode/i})` 등)
  - 기존 e2e가 Home→Open 진입으로 갱신 후 통과한다는 진술 + 변경된 spec 라인 인용

## Evidence To Return

- Changed files + purpose 한 줄씩
- 검증 명령 outcome 요약 (passed/failed/error count)
- 각 AC-01..AC-08에 대한 evidence 매핑
- 가정 (e.g. "ConnectionItem의 onActivate가 'Open' 의미로 사용된다고 가정")
- 잔여 위험 (e.g. "최근 사용 영역은 placeholder, S127에서 실제 데이터로 wire")

## References

- Contract: `docs/sprints/sprint-125/contract.md`
- Master spec: `docs/sprints/sprint-125/spec.md`
- Relevant files:
  - `src/App.tsx`
  - `src/components/layout/Sidebar.tsx`
  - `src/components/layout/SidebarModeToggle.tsx`
  - `src/components/connection/ConnectionList.tsx`
  - `src/components/connection/ConnectionItem.tsx`
  - `src/stores/connectionStore.ts`
  - `src/stores/tabStore.ts`
  - 모든 `e2e/*.spec.ts`
