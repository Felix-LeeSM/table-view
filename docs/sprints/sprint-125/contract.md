# Sprint Contract: sprint-125

## Summary

- **Goal**: Home / Workspace 풀스크린 swap 도입. 기존 단일 사이드바를 두 화면으로 분리해 paradigm-shell 시리즈(126-133)의 토대를 만든다.
- **Audience**: Claude Code Generator agent.
- **Owner**: harness orchestrator
- **Verification Profile**: `mixed` (vitest + tsc + lint + e2e + browser smoke)

## In Scope

- 신규 `appShellStore` (`screen: 'home' | 'workspace'`) — zustand persist 안 씀(세션 휘발).
- 신규 `<HomePage>`: 기존 ConnectionList + GroupHeader + Import/Export 버튼 + 최근 사용 표시 (recent는 placeholder OK).
- 신규 `<WorkspacePage>`: 기존 `Sidebar` + `MainArea`를 그대로 묶음. 좌상단 `[← Connections]` 버튼.
- `App.tsx`에서 `appShell.screen`에 따라 둘 중 하나 렌더링.
- `Sidebar`의 connections-mode 분기 제거. `SidebarModeToggle`은 Workspace에서 사용 중지(컴포넌트는 보존, mount만 안 함).
- `connectionStore.activate(id)` 또는 동급 액션 호출 시 `appShell.setScreen('workspace')` 트리거.
- ConnectionList의 "Open" 행위(현재 더블클릭 또는 명시 버튼)가 Home에서 동작.
- 이미 Open된 connection을 다시 누르면 swap만(추가 작업 없음).
- 기존 vitest 1882개 모두 통과.
- 기존 e2e 시나리오를 Home → Open 흐름으로 갱신:
  - `e2e/app.spec.ts`
  - `e2e/connections.spec.ts`
  - `e2e/data-grid.spec.ts`
  - `e2e/raw-query-edit.spec.ts`
  - `e2e/import-export.spec.ts`
  - `e2e/schema-tree.spec.ts`
  - `e2e/paradigm-and-shortcuts.spec.ts`

## Out of Scope

- Workspace 툴바 / connection switcher / DB switcher / paradigm 사이드바 swap → S126-S133.
- DocumentSidebar 추출 → S126.
- 신규 단축키 (Cmd+,) → S133.
- "최근 사용" 영역의 실제 데이터 wiring (자리만 잡고 빈 상태 OK).
- localStorage 마이그레이션 (this sprint는 새 store만 도입).
- Home에서 paradigm 별 분기 (paradigm 정보는 그냥 ConnectionItem에 표시되는 정도).

## Invariants

- 기존 connectionStore / tabStore / schemaStore / queryHistoryStore의 public API 변경 금지.
- 기존 단축키 (Ctrl+N 등) 동작 보존.
- 테마 / contrast 회귀 0건.
- 기존 paradigm 시각 큐(sprint 123 도입) 보존.
- Home 페이지에서도 ConnectionDialog / GroupDialog / ImportExportDialog 모두 정상 작동.
- TabBar는 Workspace에서만 보임 (Home에는 노출 X).

## Acceptance Criteria

- `AC-01` 앱 부팅 시 Home 화면 노출. ConnectionList + Import/Export 버튼 + New Connection 버튼이 보인다.
- `AC-02` Connection을 Open(더블클릭 또는 Open 버튼) → Workspace 화면으로 swap. schema 트리 + 메인 영역 기존 그대로 노출.
- `AC-03` Workspace 좌상단 `[← Connections]` 클릭 → Home 복귀. 열려있던 탭은 zustand에 보존 (재진입 시 동일 탭 활성).
- `AC-04` Workspace에서 SidebarModeToggle은 mount되지 않는다. (`[aria-label="Connections mode"]`/`[aria-label="Schemas mode"]` 둘 다 없음)
- `AC-05` Import/Export 버튼은 Home에서만 보이고 정상 동작 — 기존 e2e (`e2e/import-export.spec.ts`) 그린.
- `AC-06` 모든 기존 e2e spec이 Home→Open 진입 흐름으로 업데이트되어 그린.
- `AC-07` 신규 e2e spec (`e2e/home-workspace-swap.spec.ts`) 추가:
  1. 부팅 시 Home 노출 (ConnectionList).
  2. Open 후 Workspace로 swap, schema 표시.
  3. Back 버튼으로 Home 복귀.
  4. 재진입 시 같은 탭 보존.
- `AC-08` 단위 테스트: `appShellStore.test.ts` (초기값, setScreen, swap reset 안됨).

## Design Bar / Quality Bar

- 풀스크린 swap은 instant (transition 없어도 OK). 추후 fade 추가는 별도 sprint.
- `[← Connections]` 버튼 위치: Workspace 좌상단, Sidebar 헤더 영역 (현 ConnectionHeader가 있는 자리 옆 또는 그 자리 대체).
- 키보드 ESC로 Home 복귀? — **이번 sprint는 안 한다** (S133에서 Cmd+, 함께 도입).
- aria-label 신규: `[aria-label="Back to connections"]` (`[← Connections]` 버튼).
- HomePage / WorkspacePage 둘 다 React.memo 불필요 — 단순 컴포지션.

## Verification Plan

### Required Checks

1. `pnpm tsc --noEmit` → 0 에러.
2. `pnpm lint` → 0 에러.
3. `pnpm vitest run` → 1882+ 테스트 그린 (신규 appShellStore 테스트 포함).
4. `pnpm contrast:check` → 0 새 위반.
5. 갱신/신규 e2e spec 정적 컴파일 (`pnpm tsc --noEmit -p e2e/tsconfig.json` 또는 wdio에서 import 검증):
   - `e2e/home-workspace-swap.spec.ts` (신규)
   - `e2e/app.spec.ts`, `e2e/connections.spec.ts`, `e2e/data-grid.spec.ts`, `e2e/raw-query-edit.spec.ts`, `e2e/import-export.spec.ts`, `e2e/schema-tree.spec.ts`, `e2e/paradigm-and-shortcuts.spec.ts` (Home→Open 진입 추가)
6. Browser smoke (수동): `pnpm tauri dev` 실행 후 Home → Open → Back → 재진입 흐름 한 번 확인.

### Required Evidence

- Generator must provide:
  - 변경된 파일 리스트 + 각 파일의 변경 의도 한 줄
  - 위 6개 검증 명령의 출력 요약 (passed/failed/error count)
  - 각 AC 항목에 대해 어떤 코드 / 테스트가 그것을 입증하는지 한 줄 매핑
  - 기존 vitest count가 줄어들지 않았음 입증 (1882 → 1882+ 신규)
- Evaluator must cite:
  - 각 AC pass/fail에 대한 구체 evidence (file:line 또는 spec 통과 라인)
  - SidebarModeToggle이 Workspace에서 mount되지 않는다는 직접 검증 (DOM 또는 RTL test)
  - 기존 e2e spec이 갱신 없이도 통과하는지(아니면 갱신 후 통과하는지) 명시

## Test Requirements

### Unit Tests (필수)
- `appShellStore.test.ts`:
  - 초기 screen 값
  - setScreen('workspace') 후 다시 setScreen('home') 가능
  - 다른 store(tabStore 등)와 독립
- `HomePage.test.tsx`:
  - ConnectionList rendered
  - "Open" 클릭이 appShellStore.setScreen('workspace') 호출
- `WorkspacePage.test.tsx`:
  - `[← Connections]` 클릭 → setScreen('home')
  - SidebarModeToggle 미렌더

### Coverage Target
- 신규 코드 (appShellStore, HomePage, WorkspacePage): 라인 80% 이상.
- 시리즈 전체 후 CI 기준: 라인 40%, 함수 40%, 브랜치 35% 유지.

### Scenario Tests (필수)
- [ ] Happy path: 부팅→Home→Open→Workspace→Back→Home
- [ ] 에러/예외: 존재하지 않는 connection_id로 setScreen 호출 시 graceful (Home 유지)
- [ ] 경계: Open 클릭 직후 빠르게 Back (race) — workspace 진입 후 즉시 home 복귀 가능
- [ ] 회귀: 기존 e2e/import-export, e2e/data-grid 등 모두 그린

## Test Script / Repro Script

1. `pnpm install` (lockfile 변경 없으면 skip)
2. `pnpm vitest run`
3. `pnpm tsc --noEmit`
4. `pnpm lint`
5. `pnpm contrast:check`
6. (e2e는 CI에서 검증, 로컬에서는 정적 컴파일만 강제)
7. `pnpm tauri dev` → Home 노출 확인 → Test PG Open → Workspace 진입 → ← Connections → Home 복귀 → 재 Open → 같은 탭 활성 확인

## Ownership

- Generator: harness general-purpose agent
- Write scope: `src/`, `e2e/`, `docs/sprints/sprint-125/`
- 금지: 백엔드 (`src-tauri/`) 변경, 기존 store 시그니처 변경, paradigm-specific 분기 추가
- Merge order: 단일 commit (or 2 commits: src + e2e). conventional commit `feat(workspace): home/workspace 풀스크린 swap (sprint 125)`

## Exit Criteria

- Open P1/P2 findings: 0
- Required checks passing: yes
- Acceptance criteria evidence linked in `handoff.md`
- 기존 e2e 시나리오 모두 그린 (이번 sprint 갱신 포함)
- Browser smoke 통과 (Generator 자가 점검 또는 Evaluator 재현)
