# Sprint Contract: sprint-127

## Summary

- **Goal**: `<WorkspaceToolbar>`를 도입해 Workspace 상단에 `[Conn ▼] [DB ▼] [Schema ▼]` 3-드롭다운을 노출. **Conn 드롭다운만 이번 sprint에서 활성**(현재 세션에 Open한 연결만), DB / Schema 드롭다운은 read-only 표시 (실제 전환 동작은 S128/S130에서). active tab의 connection/db/schema 변경 시 toolbar 값이 즉시 일치.
- **Audience**: Claude Code Generator agent.
- **Owner**: harness orchestrator
- **Verification Profile**: `mixed` (vitest + tsc + lint + contrast + e2e 정적)

## Background (이미 잡힌 사실)

- S125에서 Home/Workspace 풀스크린 swap 완료. `WorkspacePage`는 `Sidebar | MainArea` flex split.
- S126에서 `WorkspaceSidebar`가 active tab 의 paradigm을 우선 분기.
- TabBar는 `MainArea` 안 최상단에 마운트 (`MainArea.tsx:195`).
- "현재 세션에 Open한 연결" 정의 = `connectionStore.activeStatuses[id]?.type === "connected"`.
- 탭 자료 모델은 connection-bound (`tab.connectionId` 필수). 한 connection에 여러 탭이 붙을 수 있음.
- S125 결정 잠금: Conn 드롭다운 범위 = "현재 세션에 Open한 연결만" (Home에 등록만 된 연결은 제외).

## In Scope

- 신규 컴포넌트 `src/components/workspace/`:
  - `WorkspaceToolbar.tsx` — `[Conn ▼] [DB ▼] [Schema ▼]` 컨테이너. tabBar 위 라인.
  - `ConnectionSwitcher.tsx` — 활성 connection 드롭다운. 색-도트 + paradigm 아이콘.
  - `DbSwitcher.tsx` — read-only display (사용자 클릭은 disabled, 시각만).
  - `SchemaSwitcher.tsx` — read-only display (사용자 클릭은 disabled, 시각만).
  - 각 컴포넌트의 `*.test.tsx`.
- `WorkspacePage.tsx` 또는 `MainArea.tsx`가 `WorkspaceToolbar`를 마운트. **선택**: `MainArea` 안 TabBar 위에 마운트하는 쪽을 권장 — `MainArea`가 이미 `tabs`/`activeTabId`를 읽고 있어서 prop drilling 최소.
- Conn 드롭다운 동작:
  - 트리거 라벨 = active tab의 connection 이름. active tab이 없으면 "Select connection"의 disabled 표시.
  - 옵션 = `connections.filter(c => activeStatuses[c.id]?.type === "connected")`.
  - 선택 시 → 해당 connection의 마지막으로 active였던 탭으로 전환. **없으면 graceful fallback**: 그 connection의 첫 탭으로 전환, 그래도 없으면 새 query 탭 1개 생성 후 활성화.
- `tabStore` 또는 별도 selector hook 추가:
  - 현재 active tab을 반환하는 selector (`useActiveTab`).
  - 특정 connection의 마지막 active 탭 id를 추적 (선택사항 — 신규 store 또는 ref 기반 in-memory map. zustand persist는 쓰지 마라).
- DB / Schema 드롭다운: 현재 active tab에서 `tab.schema` (rdb tab) 또는 `tab.database` (query tab) / `tab.schema?` 표시. **클릭 비활성** (`disabled` + tooltip "Coming in Sprint 128"). 표시값이 없으면 "—" 또는 "(default)".

## Out of Scope

- DB 메타 fetch (`list_databases`) → S128.
- 실제 DB switch (PG sub-pool / Mongo `use_db`) → S130/S131.
- raw-query DB-change 감지 → S132.
- 단축키 (Cmd+K로 connection switcher 키보드 오픈) → S133.
- 신규 paradigm-shell (KV/Search) 어댑터 구현.
- toolbar 시각 디자인 폴리싱 (아이콘 사이즈, 마이크로 인터랙션 등) — 1차 functional만.

## Invariants

- 기존 vitest 1907개 모두 그린.
- 기존 e2e 시나리오 회귀 0건.
- WorkspacePage 외부 인터페이스 유지: 부모 컴포넌트(`App.tsx`)에 props 변경 없음.
- **사용자 시야 회귀 없음**: PG/Mongo 연결 시 사이드바 동작 동일, 탭 동작 동일, Back 버튼 동일.
- 기존 store(`connectionStore` / `tabStore` / `schemaStore`) **public API 변경 금지**. selector 추가는 OK.
- aria-label 가이드 준수.
- 백엔드 (`src-tauri/`) 변경 금지.

## Acceptance Criteria

- `AC-01` `<WorkspaceToolbar>` 컴포넌트가 `src/components/workspace/WorkspaceToolbar.tsx`에 존재. 내부에 `ConnectionSwitcher` / `DbSwitcher` / `SchemaSwitcher` 자식 3개를 렌더.
- `AC-02` Toolbar는 Workspace 안 TabBar 바로 위에 마운트되어 사용자에게 보인다 (`MainArea` 권장 위치, 단 사이드바와의 정렬은 유지).
- `AC-03` `<ConnectionSwitcher>` 트리거 라벨 = 현재 active tab의 connection 이름. 옵션 목록 = 현재 세션에 connected인 connection만 (=`activeStatuses[id]?.type === "connected"`). disconnected 또는 등록만 된 connection은 노출 X.
- `AC-04` Conn 드롭다운에서 다른 connection 선택 → 그 connection의 마지막 active 탭으로 `setActiveTab` 호출. 없으면 그 connection의 첫 탭으로 fallback. 그래도 없으면 새 query 탭 생성 후 활성화 (graceful, race 없음).
- `AC-05` 옵션 항목 시각: paradigm 아이콘 + 연결 컬러-도트(`connection.colorIndex` 또는 그룹 색) + 연결 이름. **aria-label**: `[aria-label="Connection: <name>"]`.
- `AC-06` `<DbSwitcher>`는 active tab에서 db_name(또는 mongo `tab.database`) 표시, 없으면 "—" 또는 "(default)". 클릭 비활성, **`aria-disabled="true"` + tooltip "Switching DBs is coming in sprint 128"**.
- `AC-07` `<SchemaSwitcher>`도 같은 패턴. `tab.schema` 표시, 없으면 "(default)". 클릭 비활성.
- `AC-08` active tab 변경 (TabBar 클릭, 새 탭 생성, 탭 닫기 등) → toolbar 3개 라벨이 동기적으로 일치 (zustand subscribe / selector 기반, 추가 effect 없이).
- `AC-09` empty workspace 상태(탭 0개): toolbar는 마운트되지만 Conn 드롭다운 라벨 = "No connection" (or 동급), DB / Schema = "—". 드롭다운 자체는 옵션이 있으면 enabled, 옵션이 없으면 disabled.
- `AC-10` 신규 단위 테스트:
  - `WorkspaceToolbar.test.tsx` — 3 children 렌더, active tab 따라 라벨 갱신.
  - `ConnectionSwitcher.test.tsx` — 옵션 필터(connected only), 선택 시 setActiveTab 호출, 빈 옵션 시 disabled.
  - `DbSwitcher.test.tsx` / `SchemaSwitcher.test.tsx` — 라벨 표시, 클릭 비활성.
- `AC-11` `pnpm vitest run` / `pnpm tsc --noEmit` / `pnpm lint` / `pnpm contrast:check` 모두 그린.
- `AC-12` 기존 e2e specs(특히 `app.spec.ts`, `data-grid.spec.ts`, `home-workspace-swap.spec.ts`) 회귀 0건. **신규 e2e 추가는 S133에서**.

## Design Bar / Quality Bar

- Toolbar 고정 높이 — 한 줄. `border-b border-border` + `bg-secondary` 톤 통일.
- 드롭다운 컴포넌트는 기존 Radix `<Select>` 또는 `<Popover>` 재사용 (theme picker / sidebar select 패턴 따라).
- DB / Schema는 read-only지만 그냥 `<span>`이 아니라 시각적으로 "드롭다운처럼" 보이는 disabled trigger 권장 — S128 활성 시 layout shift 없이.
- aria-label:
  - `[aria-label="Active connection switcher"]`
  - `[aria-label="Active database (read-only)"]`
  - `[aria-label="Active schema (read-only)"]`
- a11y: 키보드 포커스 가능, 단 disabled trigger는 `tabindex={-1}` + `aria-disabled="true"`.
- `WorkspaceToolbar`는 paradigm 자체에 무관 — 어떤 paradigm 탭이든 동일한 toolbar.
- contrast:check 통과 — 새로 도입한 색상 토큰이 있다면 WCAG AA 보장.

## Verification Plan

### Required Checks

1. `pnpm vitest run` — 1907+ 그린.
2. `pnpm tsc --noEmit` — 0.
3. `pnpm lint` — 0.
4. `pnpm contrast:check` — 0 새 위반.
5. e2e 정적 컴파일 (`pnpm tsc --noEmit -p e2e/tsconfig.json` 또는 wdio import 검증).

### Required Evidence

- Generator must provide:
  - 변경된 파일 + 의도 한 줄
  - 5개 검증 명령 outcome
  - AC-01..AC-12 매핑(file:line / test:line)
  - active tab 변경 시 toolbar 라벨이 어떻게 갱신되는지 코드 인용
  - Conn 드롭다운 옵션 필터(connected only)의 코드 인용
  - 마지막 active 탭 추적 메커니즘 설명 (in-memory map / zustand selector / etc.)
- Evaluator must cite:
  - 각 AC pass/fail의 구체 evidence
  - DB/Schema 드롭다운이 실제로 disabled되어 있다는 RTL 증거
  - 빈 workspace 상태에서 toolbar가 깨지지 않음 RTL 증거

## Test Requirements

### Unit Tests (필수)
- `WorkspaceToolbar.test.tsx`:
  - 3 children 렌더
  - active tab 변경 시 라벨 동기적 갱신
  - 빈 workspace 시 graceful display
- `ConnectionSwitcher.test.tsx`:
  - 옵션 = connected only (disconnected는 노출 X)
  - 선택 시 그 connection의 마지막 active 탭으로 `setActiveTab`
  - 마지막 active 탭이 없으면 첫 탭으로 fallback
  - 둘 다 없으면 새 query tab 생성
  - 옵션 0개일 때 disabled
- `DbSwitcher.test.tsx`:
  - active tab의 schema/database 라벨 표시
  - aria-disabled + tooltip 노출
- `SchemaSwitcher.test.tsx`:
  - active tab의 schema 라벨 표시
  - aria-disabled + tooltip 노출

### Coverage Target
- 신규 코드 (Toolbar 4개 컴포넌트): 라인 80% 이상.
- 시리즈 전체 후 CI 기준: 라인 40%, 함수 40%, 브랜치 35% 유지.

### Scenario Tests (필수)
- [ ] Happy: connection 2개 connected, 탭 3개 — 드롭다운에서 다른 connection 선택 → 그 connection의 탭으로 전환
- [ ] 에러: disconnect된 connection의 탭이 active일 때 — toolbar는 라벨만 표시 (drop은 graceful)
- [ ] 경계: 탭 0개 — toolbar 마운트되지만 drop 비활성
- [ ] 경계: connected connection 0개 — Conn drop disabled
- [ ] 회귀: 기존 e2e (Back to Connections, schema tree 등) 모두 그린

## Test Script / Repro Script

1. `pnpm install` (lockfile 변경 없으면 skip)
2. `pnpm vitest run`
3. `pnpm tsc --noEmit`
4. `pnpm lint`
5. `pnpm contrast:check`
6. (e2e는 S133에서 신규 spec 추가 — 이번 sprint는 정적 컴파일 회귀만)

## Ownership

- Generator: harness general-purpose agent
- Write scope:
  - `src/components/workspace/` (신규 4개 + 테스트)
  - `src/components/layout/MainArea.tsx` 또는 `src/pages/WorkspacePage.tsx` (마운트 한 줄 추가)
  - 필요 시 `src/stores/tabStore.ts`에 selector helper 추가 (`useActiveTab` 등) — public API 변경 금지
  - **금지**: 백엔드, schema/DB switch 실제 동작, 신규 단축키, 신규 e2e
- Merge order: 단일 commit `feat(workspace): top toolbar + connection switcher (sprint 127)`

## Exit Criteria

- Open P1/P2 findings: 0
- Required checks passing: yes
- Acceptance criteria evidence linked in `handoff.md`
- 기존 vitest 1907 ≤ 새로운 통과 수
- 기존 e2e 정적 컴파일 무회귀
