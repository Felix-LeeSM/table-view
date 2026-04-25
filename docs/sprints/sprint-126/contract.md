# Sprint Contract: sprint-126

## Summary

- **Goal**: 현재 `SchemaPanel`이 갖고 있는 paradigm 분기(`isDocument ? DocumentDatabaseTree : SchemaTree`)를 추출해 paradigm-별 사이드바 컴포넌트(`RdbSidebar`, `DocumentSidebar`)와 분기 슬롯(`WorkspaceSidebar`)으로 가른다. WorkspacePage에서 SchemaPanel 자리에 WorkspaceSidebar를 끼운다. **active tab의 paradigm**을 따라 사이드바가 swap되도록 동작 모드를 한 단계 진전시킨다(현재는 "선택된 연결의 paradigm"). 이는 sprint 127+에서 다중-paradigm 탭 공존이 작동하기 위한 전제.
- **Audience**: Claude Code Generator agent.
- **Verification Profile**: `mixed`

## Background (이미 잡힌 사실)

- `SchemaPanel` (115 LOC) 라인 104-112에 paradigm 분기 1개 — 깔끔히 추출 가능.
- `DocumentDatabaseTree` (253 LOC), `SchemaTree` (1645 LOC) — 그대로 보존하고 wrapper만 갈아끼움.
- WorkspacePage 안에서 사용된 Sidebar는 `selectedId`(connection id)를 SchemaPanel에 전달.
- 현재는 "active tab의 paradigm"이 아니라 "selectedId connection의 paradigm"으로 결정됨. sprint 126부터는 active tab이 있으면 그 탭의 paradigm을 우선, 없으면 fallback으로 selectedId의 paradigm 사용.

## In Scope

- 신규 컴포넌트 디렉토리 `src/components/workspace/`:
  - `WorkspaceSidebar.tsx` — paradigm slot 분기 컴포넌트 (active tab 우선, selectedId fallback).
  - `WorkspaceSidebar.test.tsx`
  - `RdbSidebar.tsx` — `<SchemaTree>` thin wrapper.
  - `DocumentSidebar.tsx` — `<DocumentDatabaseTree>` thin wrapper.
- 신규 placeholder paradigm panel — `KvSidebarPlaceholder.tsx`, `SearchSidebarPlaceholder.tsx` (둘 다 `<UnsupportedShellNotice paradigm="kv|search" />` 한 줄짜리 안내 표시).
- 단일 `<UnsupportedShellNotice>` 공통 placeholder.
- `SchemaPanel`은 그대로 두되 "최후의 fallback으로 paradigm을 선택할 수 없을 때" 보여줄 empty/connecting/error 상태만 책임. 즉 SchemaPanel에서 paradigm 분기 라인(104-112)만 제거하고 그 자리는 `WorkspaceSidebar`가 대신 마운트.
- 또는 SchemaPanel을 통째로 WorkspaceSidebar로 교체하고 empty/connecting/error 상태도 WorkspaceSidebar 안에서 처리. **단순화 위해 후자를 권장**: SchemaPanel은 deprecate, WorkspaceSidebar가 모든 책임 흡수. 단 SchemaPanel 파일은 보존(다른 곳에서 reference 가능, sprint 127+에서 정리).
- `WorkspacePage` 또는 `Sidebar`가 SchemaPanel 대신 WorkspaceSidebar 사용.
- `useTabStore`에서 active tab 정보를 읽기 위한 selector 또는 hook 추가 (필요 시).

## Out of Scope

- 신규 toolbar / connection switcher / DB switcher / DB 메타 → S127-S131.
- DocumentDatabaseTree 내부 정합 (RDB 가정 잔존 제거) → S129.
- KvSidebar, SearchSidebar의 실제 구현 → Phase 9 (S136, S137).
- 단축키 추가 → S133.
- `SchemaTree` 또는 `DocumentDatabaseTree` 내부 변경.

## Invariants

- 기존 vitest 1887개 모두 그린.
- 기존 e2e 시나리오 모두 그린.
- WorkspacePage 외부 인터페이스 유지: 부모 입장에서 어떤 props도 변경 없음.
- 사용자 시야엔 변화 없음: PG 연결을 열면 SchemaTree, Mongo 연결을 열면 DocumentDatabaseTree — sprint 125 동작 그대로.
- 현재 SchemaPanel의 empty / connecting / error 상태 메시지/아이콘 그대로 유지.
- aria-label 변화 없음.
- 백엔드 (`src-tauri/`) 변경 금지.
- 기존 store(connectionStore / tabStore / schemaStore) public API 변경 금지.

## Acceptance Criteria

- `AC-01` `<WorkspaceSidebar selectedId>` 컴포넌트가 `src/components/workspace/WorkspaceSidebar.tsx`에 존재. active tab의 connection_id가 있으면 그 connection의 paradigm 우선, 없으면 selectedId의 paradigm 사용해 분기.
- `AC-02` `paradigm === 'rdb'` (postgresql/mysql/sqlite) → `<RdbSidebar connectionId>` 렌더 → 내부적으로 `<SchemaTree connectionId>`.
- `AC-03` `paradigm === 'document'` (mongodb) → `<DocumentSidebar connectionId>` 렌더 → 내부적으로 `<DocumentDatabaseTree connectionId>`.
- `AC-04` `paradigm === 'kv'` 또는 `'search'` → `<UnsupportedShellNotice paradigm>` placeholder 렌더 — 한 줄 안내 + 아이콘. 클릭/입력 비활성.
- `AC-05` empty/connecting/error 상태(연결 없음 / 미연결 / 연결 실패)는 WorkspaceSidebar 안에서 처리 — 기존 SchemaPanel 메시지/아이콘 동일.
- `AC-06` Workspace에서 사용되는 Sidebar(또는 WorkspacePage)가 SchemaPanel 대신 WorkspaceSidebar를 마운트.
- `AC-07` 사용자 시야 회귀 없음: PG 연결 시 schema 트리 노출, Mongo 시 collections 트리 노출(현재 동작 그대로).
- `AC-08` 신규 단위 테스트:
  - `WorkspaceSidebar.test.tsx`: paradigm 4개(rdb/document/kv/search) + empty/connecting/error 분기.
  - 분기는 active tab paradigm 우선 동작 검증.
  - placeholder가 unsupported 메시지 노출.
- `AC-09` `pnpm vitest run` / `pnpm tsc --noEmit` / `pnpm lint` / `pnpm contrast:check` 모두 그린.
- `AC-10` 기존 e2e specs (특히 `home-workspace-swap`, `data-grid`, `schema-tree`) 회귀 0건.

## Design Bar / Quality Bar

- `<UnsupportedShellNotice paradigm>`은 sprint 123에서 도입한 paradigm 시각 큐(아이콘 색)와 일관. 한 줄 카피: "{Paradigm} support is coming in Phase 9".
- `WorkspaceSidebar`의 분기는 단일 `switch` 또는 lookup table 기반 — 중첩 if 금지.
- 분기 결정 함수 `pickSidebar(paradigm)`를 export하여 테스트 가능하게.
- aria-label 가이드: KV placeholder는 `[aria-label="Key-value workspace placeholder"]`, Search placeholder는 `[aria-label="Search workspace placeholder"]`.
- a11y: placeholder는 `role="status"`.

## Verification Plan

### Required Checks

1. `pnpm vitest run` — 1887+ 그린.
2. `pnpm tsc --noEmit` — 0.
3. `pnpm lint` — 0.
4. `pnpm contrast:check` — 0 새 위반.
5. e2e 정적 컴파일 (Generator 자체 검증).

### Required Evidence

- Generator must provide:
  - 변경된 파일 + 의도 한 줄
  - 5개 검증 명령 outcome
  - AC-01..AC-10 매핑(file:line / test:line)
  - active tab paradigm 우선이 어떻게 결정되는지 코드 인용
  - SchemaPanel의 paradigm 분기가 사라졌다는 증거
- Evaluator must cite:
  - 각 AC pass/fail의 구체 evidence
  - placeholder UI가 실제로 unsupported 안내를 표시한다는 증거 (RTL test)
  - SchemaPanel 미사용 증거 (Workspace 경로에서)

## Test Requirements

### Unit Tests (필수)
- `WorkspaceSidebar.test.tsx`:
  - paradigm = 'rdb' → SchemaTree 렌더 (mock)
  - paradigm = 'document' → DocumentDatabaseTree 렌더 (mock)
  - paradigm = 'kv' → KV placeholder, role="status"
  - paradigm = 'search' → Search placeholder, role="status"
  - active tab의 connection이 selectedId와 다르면 active tab paradigm 우선
  - empty (connections 비어있음) → "No connections yet"
  - connecting → "Connecting…"
  - error → 에러 메시지 노출
- `pickSidebar.test.ts` 또는 WorkspaceSidebar 테스트 안에 분기 함수 테스트.

### Coverage Target
- 신규 코드: 라인 80% 이상.

### Scenario Tests
- [ ] Happy: 4 paradigm 전부 분기 정상
- [ ] 에러: connection error 상태에서 분기 깨지지 않음
- [ ] 경계: active tab 없는 상태에서 selectedId fallback
- [ ] 회귀: 기존 SchemaTree/DocumentDatabaseTree 테스트 그린

## Test Script / Repro Script

1. `pnpm vitest run`
2. `pnpm tsc --noEmit`
3. `pnpm lint`
4. `pnpm contrast:check`

## Ownership

- Generator: harness general-purpose agent
- Write scope: `src/components/workspace/`, `src/pages/WorkspacePage.tsx`(or `Sidebar.tsx`) 마운트 변경, `src/components/schema/SchemaPanel.tsx` 분기 라인 정리, e2e 변경 없음 예상.
- 금지: 백엔드, 기존 store API, SchemaTree/DocumentDatabaseTree 내부, 신규 단축키.
- Merge order: 단일 commit `feat(workspace): paradigm-aware sidebar slot (sprint 126)`

## Exit Criteria

- Open P1/P2 findings: 0
- Required checks passing: yes
- AC evidence linked in `handoff.md`
- 기존 e2e 회귀 0건
