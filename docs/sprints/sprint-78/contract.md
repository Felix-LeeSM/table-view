# Sprint Contract: Sprint 78 — Connection Groups Workflow

## Summary

- **Goal**: 사용자가 발견 가능한 방법으로 그룹을 생성/이름변경/색상지정/삭제하고, connection 을 drag 또는 context menu 로 그룹에 배정/해제한다. 그룹 메타데이터 (이름/색/접힘/배정) 는 reload 후에도 보존된다. 데이터 모델 · IPC · 드래그 assign 은 이미 구현되어 있으므로 **UI discoverability + 미싱 UX (색 picker, 컨텍스트 메뉴, 확인 다이얼로그) + 테스트** 가 실제 범위다.
- **Audience**: Generator / Evaluator.
- **Owner**: Harness 오케스트레이터.
- **Verification Profile**: `mixed` (command + browser)

## In Scope

- `src/components/layout/Sidebar.tsx`:
  - connections 모드에 **"New Group"** 버튼 (현재 "New Connection" 옆 또는 위) 추가. 클릭 시 inline prompt 또는 dialog 로 이름 + optional 색 선택.
- `src/components/connection/ConnectionGroup.tsx`:
  - 헤더에 group color 를 leading accent (예: 4px 좌측 바 또는 color dot) 로 렌더.
  - 삭제 버튼 클릭 시 **확인 다이얼로그** ("이 그룹만 삭제되며, 내부 connection 은 ungrouped 로 이동합니다") — `ConnectionItem.tsx:257-295` 의 기존 삭제 확인 패턴 재사용.
- `src/components/connection/ConnectionItem.tsx`:
  - 컨텍스트 메뉴에 **"Move to group"** 하위 메뉴 추가. 기존 그룹 리스트 + "No group" 옵션. 선택 시 `moveConnectionToGroup(connectionId, groupId | null)` 호출.
- `src/components/connection/ConnectionList.tsx`:
  - ungrouped 드롭 영역의 drop-active 스타일을 강화 (현재 `bg-primary/5` 만 — 드롭 대상임을 명확히 알리는 텍스트 힌트 또는 보더 추가).
- `src/lib/connectionColor.ts` 재사용 — 신규 palette 금지. `PALETTE` 만 사용.
- `src/stores/connectionStore.test.ts`:
  - `addGroup`, `updateGroup` (이름+색 변경), `removeGroup`, `moveConnectionToGroup` 를 각각 최소 1개 테스트.
- `src/components/connection/ConnectionGroup.test.tsx`:
  - 색 accent 렌더, 삭제 확인 다이얼로그.
- `src/components/connection/ConnectionList.test.tsx` 또는 `ConnectionItem.test.tsx`:
  - "Move to group" 컨텍스트 메뉴 경로, "No group" drop region.
- `src/components/layout/Sidebar.test.tsx` (필요 시):
  - "New Group" 버튼 → 그룹 생성 플로우.

## Out of Scope

- 멀티 connection 을 동시에 그룹에 옮기는 일괄 작업.
- 그룹 간 순서 재정렬 (drag to reorder).
- 그룹의 하위 그룹 / nested group.
- 백엔드 schema 변경 (color/collapsed 는 이미 persisted).
- 새 색상 팔레트 추가.
- Tauri command 신규 추가 — 기존 `save_group` / `delete_group` / `move_connection_to_group` / `list_groups` 재사용.
- Sprint 74-77 흐름 변경.

## Invariants

1. **IPC 계약 안정**: `save_group` / `delete_group` / `move_connection_to_group` / `list_groups` 의 시그니처 / 응답 shape 변경 금지.
2. **Legacy persistence 호환**: `connections.json` 에 `color: null`, `collapsed: false` 가 없던 레거시 그룹이라도 에러 없이 로드 + 신규 필드 default 동작.
3. **Sprint 74/75/76/77 회귀 없음**: DataGrid 편집, sort 탭 귀속, ephemeral promotion, tab bar 높이 유지.
4. **기존 1407+ 테스트 전부 통과**.
5. **ADR 0008 토큰만 사용** — 색상 accent 는 `bg-*` / `border-*` tailwind 토큰 (또는 기존 palette 매핑) 만. Raw hex 금지.
6. **Dark mode 가시성** 유지.
7. **접근성**: "New Group" 버튼 `aria-label`, 확인 다이얼로그 `role="alertdialog"` + focus trap, "Move to group" submenu keyboard navigable.

## Acceptance Criteria

- **AC-01** — 사이드바 connections 모드에 **"New Group"** 버튼이 표시되고, 클릭 시 이름(필수) + 색(optional, palette 선택) 을 입력받아 새 그룹을 생성한다. 생성된 그룹이 즉시 사이드바에 나타난다.
- **AC-02** — 각 그룹 헤더에 color accent 가 표시된다. 색이 `null` 인 그룹은 default muted accent (또는 accent 없음) 로 graceful 렌더.
- **AC-03** — `ConnectionItem` 컨텍스트 메뉴에 **"Move to group"** 항목이 있다:
  - 하위 메뉴에 현존 그룹 이름이 (같은 커넥션의 현재 그룹은 disabled/check marked) + **"No group"** 옵션이 나열된다.
  - 항목 선택 시 `moveConnectionToGroup(connectionId, groupId | null)` 이 호출되어 사이드바가 갱신된다.
- **AC-04** — Drag path 는 이미 동작 — ungrouped 영역의 drop-active 시 **명시적 텍스트 힌트 또는 보더** 가 표시되어 드롭 대상임을 알린다. 기존 `bg-primary/5` 만으로는 부족하다고 가정.
- **AC-05** — 그룹 삭제 시 **확인 다이얼로그** 가 뜬다: 제목 + 설명에 "그룹만 삭제되고 내부 connection 은 ungrouped 로 이동"이 명시. "Cancel" / "Delete" 버튼. "Delete" 클릭 시 `removeGroup(id)` 호출.
- **AC-06** — 그룹 상태 (name, color, collapsed, connection 배정) 가 앱 reload 후에도 복원된다 — 기존 `connections.json` persist 로직으로 보장. 필요 시 Tauri test 나 통합 테스트가 round-trip 을 확인.
- **AC-07** — 다음 테스트가 존재한다:
  - store-level: `addGroup` / `updateGroup` (name + color) / `removeGroup` / `moveConnectionToGroup` (to group, to null).
  - ConnectionGroup 컴포넌트: color accent 렌더, 삭제 확인 다이얼로그 open/close + confirm/cancel.
  - ConnectionItem: "Move to group" 컨텍스트 메뉴 submenu 렌더 + 선택 시 store 액션 호출.
  - ConnectionList: "No group" drop region 의 시각적 힌트.
  - Sidebar: "New Group" 버튼 → 다이얼로그/prompt 오픈 → 생성 flow.

## Design Bar / Quality Bar

- 확인 다이얼로그는 기존 Dialog / AlertDialog 컴포넌트 (shadcn/ui 가 이미 쓰인다면 그 패턴) 재사용. 신규 dialog 컴포넌트 금지.
- Color picker 는 팔레트 스왓치 10개 + "None" 옵션의 단순 rendering. 색상 선택 누를 때 바로 선택 표시. 새 color library / picker 라이브러리 도입 금지.
- "Move to group" submenu 는 기존 컨텍스트 메뉴 컴포넌트의 nested menu 기능 활용 (shadcn `DropdownMenuSub`). 신규 구조 도입 금지.
- 테스트는 RTL 관점: `getByRole('menuitem', { name: /move to group/i })`, `getByRole('dialog', { name: /delete group/i })` 등.

## Verification Plan

### Required Checks

1. `pnpm tsc --noEmit` → 에러 0.
2. `pnpm lint` → 에러/경고 0.
3. `pnpm vitest run` → 기존 + 신규 전부 통과.
4. `pnpm vitest run src/components/connection src/components/layout/Sidebar src/stores/connectionStore` — 신규 테스트 출력 확인.
5. (선택) `cd src-tauri && cargo test` — group persistence 회귀 없음 확인.
6. (선택) 브라우저: 그룹 생성 → 색 지정 → connection drag → context-menu move → 삭제 확인 → reload → 상태 복원.

### Required Evidence

- Generator 는 `docs/sprints/sprint-78/handoff.md` 에:
  - 변경/추가 파일 + 목적
  - 각 AC → test file:line 매핑
  - 세 게이트 결과 last lines
  - "New Group" UI 선택 (inline form vs dialog) 근거
  - "Move to group" submenu 의 그룹 목록 source (store reactive vs snapshot) 근거
  - 남은 위험 / 갭
- Evaluator 는 각 AC 에 file:line 인용.

## Test Requirements

### Unit Tests (필수)
- 각 AC 에 대응하는 최소 1개 테스트.
- 그룹이 없을 때 "Move to group" submenu 는 "No group" 옵션만 (or disabled 전체) 렌더 — edge case.
- Legacy 그룹 (color=null, collapsed=default) 가 에러 없이 렌더 — migration 회귀.

### Coverage Target
- 신규/수정 코드: 라인 70% 이상.

### Scenario Tests (필수)
- [ ] Happy path: New Group → Move connection in → Delete group (confirmed) → connection 남아있음.
- [ ] 에러: removeGroup 실패 시 다이얼로그 에러 표시 (Generator 재량).
- [ ] 경계: 그룹 0개 상태 / 그룹 10+개 상태.
- [ ] 회귀: Sprint 74-77 흐름 전부 pass.

## Test Script / Repro Script

1. `pnpm vitest run src/components/connection` — AC-02/03/04/05 확인.
2. `pnpm vitest run src/components/layout/Sidebar.test.tsx` — AC-01 확인.
3. `pnpm vitest run src/stores/connectionStore.test.ts` — AC-07 store 테스트.
4. `pnpm tsc --noEmit && pnpm lint && pnpm vitest run` — 전체 게이트.
5. (선택) `cd src-tauri && cargo test` — backend 회귀.

## Ownership

- **Generator**: general-purpose agent.
- **Write scope**:
  - `src/components/layout/Sidebar.tsx` + test
  - `src/components/connection/ConnectionGroup.tsx` + test
  - `src/components/connection/ConnectionItem.tsx` + test
  - `src/components/connection/ConnectionList.tsx` + test
  - `src/stores/connectionStore.ts` (new action 불필요, 테스트만) + `connectionStore.test.ts`
  - `docs/sprints/sprint-78/handoff.md`
- **Merge order**: Sprint 77 (dfca43f) 이후.

## Exit Criteria

- 오픈된 P1/P2 finding: `0`.
- 필수 검증 통과: `yes`.
- 모든 AC 증거가 `handoff.md` 에 파일:라인 인용.
- Evaluator 각 차원 점수 ≥ 7.0/10.
