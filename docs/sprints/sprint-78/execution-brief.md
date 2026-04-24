# Sprint Execution Brief: Sprint 78 — Connection Groups Workflow

## Objective
사용자가 명시적 UI 로 그룹을 생성하고, 색을 지정하고, 컨텍스트 메뉴로 connection 을 그룹에 배정/해제하고, 그룹을 삭제할 때 확인을 받을 수 있게 만든다. 그룹 메타데이터는 이미 영속화된다 — 이번 스프린트는 discoverability + 확인/색 UI + 테스트.

## Task Why
스카우트 결과: `ConnectionGroup` 타입 (color/collapsed), Tauri 영속화, `moveConnectionToGroup` IPC, drag-assign 은 이미 구현되어 있다. 그러나 (1) "New Group" 버튼이 없어 사용자가 drag discovery 에 의존해야 하고, (2) 색 accent 미노출, (3) "Move to group" 컨텍스트 메뉴 없음, (4) 삭제 시 실수 방지용 확인 없음, (5) 스토어-level 테스트 gap. 이 갭들이 메워지지 않으면 "그룹 기능이 있는데 찾을 수 없다" UX 상태가 계속된다.

## Scope Boundary
- **범위 안**: Sidebar "New Group" 버튼, 색 picker (팔레트 재사용), ConnectionGroup 헤더 색 accent, ConnectionItem "Move to group" 컨텍스트 메뉴, 그룹 삭제 확인 다이얼로그, ungrouped drop 힌트 강화, 스토어/컴포넌트 테스트.
- **범위 밖**: 멀티-connection 일괄 이동, 그룹 순서 drag reorder, nested group, 신규 팔레트, 신규 Tauri command, Sprint 74-77 흐름 변경.

## Invariants
1. IPC shape (`save_group`/`delete_group`/`move_connection_to_group`/`list_groups`) 불변.
2. Legacy 그룹 (color=null, collapsed=false) 무에러 로드.
3. Sprint 74-77 회귀 없음.
4. 기존 1407+ 테스트 통과.
5. ADR 0008 토큰만 — raw hex 금지.
6. Dark mode 가시성 유지.
7. 접근성 — aria-label / role="alertdialog" / keyboard-navigable submenu.

## Done Criteria
1. Sidebar "New Group" 버튼 + 생성 flow (이름 + optional 색).
2. ConnectionGroup 헤더 색 accent (null 색 graceful).
3. ConnectionItem "Move to group" 컨텍스트 메뉴 (그룹 목록 + "No group", 기존 그룹은 disabled).
4. Ungrouped drop 영역에 명시적 힌트/보더 보강.
5. 그룹 삭제 시 확인 다이얼로그 (내부 connection 은 ungrouped 로 이동).
6. Reload 시 그룹 상태 복원 (기존 로직 검증).
7. store + component 테스트 추가.

## Verification Plan
- **Profile**: mixed (command + browser)
- **Required checks**:
  1. `pnpm tsc --noEmit` — 0 errors
  2. `pnpm lint` — 0 warnings
  3. `pnpm vitest run` — 전체 pass
  4. `pnpm vitest run src/components/connection src/components/layout/Sidebar src/stores/connectionStore` — 신규 케이스 확인
  5. (선택) `cd src-tauri && cargo test`
  6. (선택) 브라우저 smoke: 그룹 생성/이동/삭제/reload
- **Required evidence**:
  - 변경/추가 파일 목록 + 목적
  - 각 AC → test file:line
  - 세 게이트 last lines
  - "New Group" UI 선택 근거 (inline form vs dialog)
  - "Move to group" submenu source 근거

## Evidence To Return
- 변경/추가 파일 목록
- 실행 검증 명령 + 결과
- 각 AC 별 test file:line
- "New Group" / 색 picker / submenu UI 의 컴포넌트 재사용 선택
- Legacy 그룹 migration 경로 검증
- 남은 위험 / 갭

## References
- **Contract**: `docs/sprints/sprint-78/contract.md`
- **Master spec**: `docs/sprints/sprint-74/spec.md` — Sprint 78 섹션
- **Relevant files**:
  - `src/types/connection.ts:73-78` — ConnectionGroup 모델
  - `src-tauri/src/models/connection.rs:179-185` — Rust struct
  - `src-tauri/src/commands/connection.rs:369-405` — Tauri commands
  - `src/stores/connectionStore.ts:25-44, 167-199` — 스토어 액션
  - `src/components/connection/ConnectionGroup.tsx:62-66, 131` — 헤더 + 삭제
  - `src/components/connection/ConnectionItem.tsx:195-215` — 컨텍스트 메뉴
  - `src/components/connection/ConnectionList.tsx:40-60, 88-90` — 드롭 영역 + 힌트 문구
  - `src/components/layout/Sidebar.tsx:150-195` — 현재 버튼 세트
  - `src/lib/connectionColor.ts:7-18` — 팔레트
  - `src/components/connection/ConnectionGroup.test.tsx` — 기존 938 line 테스트 파일
- **Prior sprints**: 74 (551ca0f), 75 (7698276), 76 (c6ed688), 77 (dfca43f)
