# Sprint Execution Brief: sprint-127

## Objective

Workspace 상단에 `<WorkspaceToolbar>`를 도입한다 — 자식 3개:
- `<ConnectionSwitcher>` (활성, 현재 세션 connected만 노출, 선택 시 그 connection의 마지막 active 탭으로 전환).
- `<DbSwitcher>` (read-only 표시, click disabled, S128 예정 tooltip).
- `<SchemaSwitcher>` (read-only 표시, click disabled).

마운트는 `MainArea`의 TabBar 바로 위 권장. active tab 변경 → toolbar 라벨 동기적 갱신.

## Task Why

S125-S126에서 Home/Workspace 분리 + paradigm 사이드바 슬롯이 완성됐지만, 사용자가 Workspace 안에서 connection 사이를 옮기려면 사이드바에 가서 다시 클릭하거나 탭바를 일일이 뒤져야 한다. Toolbar의 Conn 드롭다운은 "Open한 연결 목록"을 일등 시민으로 노출해 다중-paradigm 탭 공존(1a 결정) UX를 본격 실현하는 첫 진입점. DB/Schema 드롭다운은 S128/S130/S131의 자리만 잡는다 (layout shift 방지).

## Scope Boundary

- 백엔드 (`src-tauri/`) 변경 금지.
- DB 메타 fetch / 실제 DB switch / raw-query 감지는 후속 sprint.
- 기존 store public API 변경 금지 (selector helper 추가는 OK).
- 단축키, 신규 e2e spec 추가 금지 (S133).
- toolbar의 시각 디자인 폴리싱 깊이 가지 마라 — 1차 functional.

## Invariants

- 사용자 시야 회귀 0: PG/Mongo workspace 동작 동일, Back 버튼 동일, TabBar 동작 동일.
- 기존 vitest 1907 + e2e 모두 그린.
- 기존 aria-label 보존, 신규 aria-label은 contract 가이드 준수.
- empty/connecting/error 상태 메시지/아이콘 동일.
- WorkspacePage 외부 인터페이스 변화 0.

## Done Criteria

1. `<WorkspaceToolbar>`가 `src/components/workspace/WorkspaceToolbar.tsx`에 존재, 자식 3개 렌더.
2. Toolbar가 Workspace 안 TabBar 위에 마운트.
3. `<ConnectionSwitcher>`: connected only 옵션 필터, 선택 시 그 connection의 마지막 active 탭으로 전환 (없으면 첫 탭, 그래도 없으면 새 query tab).
4. `<DbSwitcher>` / `<SchemaSwitcher>`: read-only 표시, click disabled + aria-disabled + tooltip.
5. active tab 변경 → toolbar 라벨 즉시 일치 (zustand selector 기반, effect 추가 없이).
6. 빈 workspace에서도 graceful (drop disabled).
7. 신규 단위 테스트 4종 그린.
8. 검증 명령 5종 그린 (vitest / tsc / lint / contrast / e2e 정적).

## Verification Plan

- Profile: `mixed`
- Required checks:
  1. `pnpm vitest run` — 1907+ 그린
  2. `pnpm tsc --noEmit` — 0
  3. `pnpm lint` — 0
  4. `pnpm contrast:check` — 0 새 위반
  5. e2e 정적 컴파일 무회귀
- Required evidence:
  - 각 AC에 file:line / test:line 매핑
  - Conn 드롭다운의 connected-only 필터 코드 인용
  - 마지막 active 탭 추적 메커니즘 설명
  - DB/Schema 드롭다운이 실제 disabled임을 RTL test로 입증
  - 빈 workspace 시 toolbar가 깨지지 않는다는 RTL test

## Evidence To Return

- Changed files + purpose 한 줄
- 검증 명령 outcome 요약
- AC-01..AC-12 매핑
- 가정 (e.g. "마지막 active 탭은 in-memory Map으로 추적, persist 안 함")
- 잔여 위험

## References

- Contract: `docs/sprints/sprint-127/contract.md`
- Master spec: `docs/sprints/sprint-125/spec.md`
- 직전 sprint findings: `docs/sprints/sprint-126/findings.md`
- Relevant files:
  - `src/components/layout/MainArea.tsx` (TabBar 마운트 지점)
  - `src/pages/WorkspacePage.tsx` (대안 마운트 지점)
  - `src/stores/tabStore.ts` (`tabs`, `activeTabId`, `setActiveTab`, `addQueryTab`)
  - `src/stores/connectionStore.ts` (`connections`, `activeStatuses`)
  - `src/components/workspace/WorkspaceSidebar.tsx` (active tab paradigm 우선 패턴 참고)
  - `src/components/ui/select.tsx` (드롭다운 primitive)
  - `src/components/ui/popover.tsx` (드롭다운 primitive 대안)
