# Sprint Execution Brief: sprint-126

## Objective

`SchemaPanel.tsx:104-112`에 박힌 paradigm 분기(`isDocument ? DocumentDatabaseTree : SchemaTree`)를 추출해 paradigm-별 사이드바와 분기 슬롯으로 가른다:

- `<WorkspaceSidebar>` — paradigm slot. **active tab의 connection paradigm 우선**, 없으면 selectedId의 paradigm fallback.
- `<RdbSidebar>` — `<SchemaTree>` thin wrapper.
- `<DocumentSidebar>` — `<DocumentDatabaseTree>` thin wrapper.
- `<UnsupportedShellNotice>` 공통 placeholder + KV/Search 자리.

WorkspacePage(또는 Sidebar)가 SchemaPanel 대신 WorkspaceSidebar 마운트. SchemaPanel의 empty/connecting/error 처리 책임은 WorkspaceSidebar로 이동.

## Task Why

S125에서 Home/Workspace 풀스크린 swap이 들어갔지만 Workspace 사이드바는 여전히 "선택된 connection의 paradigm"으로만 분기. S127+에서 다중-paradigm 탭이 한 워크스페이스에 공존하려면 active tab paradigm 우선 분기가 전제. 또 KV/Search 같이 아직 어댑터가 없는 paradigm을 placeholder로 받아두면 Phase 9 어댑터 도입 시 drop-in.

## Scope Boundary

- 백엔드 (`src-tauri/`) 변경 금지.
- 기존 store(connectionStore / tabStore / schemaStore) public API 변경 금지.
- `SchemaTree.tsx` / `DocumentDatabaseTree.tsx` 내부 변경 금지.
- 신규 toolbar / DB switcher / 단축키 금지 (S127-S133).
- DocumentDatabaseTree의 RDB 가정 잔존 제거 금지 (S129).

## Invariants

- 사용자 시야 회귀 0: PG 연결 시 SchemaTree, Mongo 연결 시 DocumentDatabaseTree.
- 기존 vitest 1887 + e2e 모두 그린.
- 기존 aria-label / role / 메시지 보존.
- empty/connecting/error 상태 메시지 동일.

## Done Criteria

1. `<WorkspaceSidebar selectedId>` 컴포넌트 존재. active tab 우선 분기 로직 구현.
2. paradigm `rdb`→RdbSidebar→SchemaTree, `document`→DocumentSidebar→DocumentDatabaseTree.
3. `kv`/`search`→UnsupportedShellNotice placeholder, role="status", 한 줄 카피.
4. empty/connecting/error 상태도 WorkspaceSidebar 안에서 처리, 메시지 동일.
5. WorkspacePage 또는 Sidebar가 WorkspaceSidebar 마운트.
6. `pickSidebar(paradigm)` 분기 함수 export + 단위 테스트.
7. 신규 단위 테스트(`WorkspaceSidebar.test.tsx`) — paradigm 4개 + 상태 전이 모두 커버.
8. 검증 명령 5종 그린 (vitest / tsc / lint / contrast / e2e 정적).

## Verification Plan

- Profile: `mixed`
- Required checks:
  1. `pnpm vitest run` — 1887+ 그린
  2. `pnpm tsc --noEmit` — 0
  3. `pnpm lint` — 0
  4. `pnpm contrast:check` — 0 새 위반
  5. 기존 e2e 정적 컴파일 무회귀
- Required evidence:
  - 각 AC에 file:line / test:line 매핑
  - active tab paradigm 우선 결정 로직 코드 인용
  - SchemaPanel의 paradigm 분기 라인이 제거됐다는 증거
  - placeholder가 unsupported 안내를 노출한다는 RTL test

## Evidence To Return

- Changed files + purpose 한 줄
- 검증 명령 outcome 요약
- AC-01..AC-10 매핑
- 가정 (e.g. "active tab의 connection_id를 어떻게 읽는가")
- 잔여 위험

## References

- Contract: `docs/sprints/sprint-126/contract.md`
- Master spec: `docs/sprints/sprint-125/spec.md`
- Relevant files:
  - `src/components/schema/SchemaPanel.tsx` (115 LOC, 분기 추출 대상)
  - `src/components/schema/SchemaTree.tsx`
  - `src/components/schema/DocumentDatabaseTree.tsx`
  - `src/pages/WorkspacePage.tsx`
  - `src/components/layout/Sidebar.tsx`
  - `src/stores/tabStore.ts`
  - `src/stores/connectionStore.ts`
