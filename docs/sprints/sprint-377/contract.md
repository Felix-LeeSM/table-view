# Sprint Contract: sprint-377

## Summary

- Goal: 사용자 요청 (2026-05-17 캡처) — Settings panel 의 "Reset settings"
  + "Reset sidebar width" 두 버튼 제거. sprint-376 의 9 affordance 중 #1
  (settings panel "Reset settings") 와 #3-b (settings panel "Reset
  sidebar width") 의 settings panel entry point 만 제거. #3 의 sidebar
  handle entry (#3-a) 와 다른 7 affordance (Recent / Group / DataGrid /
  Sidebar header / launcher / favorites) 는 유지.
- Audience: 사용자 직접 요청 — "reset 버튼들 제거해줘".
- Owner: Generator (sprint-377)
- Verification Profile: `frontend` (pnpm vitest + pnpm tsc + pnpm lint)
  + audit script.

## In Scope

- `src/pages/HomePage.tsx` — `ResetSettingsButton` import + mount block
  ("home-settings" wrapper) 제거.
- `src/components/settings/ResetSettingsButton.tsx` — 파일 삭제.
- `src/components/settings/ResetSettingsButton.reset-affordance.test.tsx`
  — 파일 삭제.
- `src/pages/HomePage.reset-affordance.test.tsx` — 세 번째 케이스를
  "두 버튼이 더 이상 렌더되지 않음" 회귀 가드로 전환.
- `docs/sprints/sprint-376/audit-checklist.md` — 항목 #1 의 상태
  업데이트 (사용자 의도적으로 제거 명시) + 항목 #3 의 settings panel
  entry 표기 정리. 항목 #3 은 sidebar handle 단일 entry 로 유지되므로
  여전히 `[x]`.
- `scripts/check-reset-affordance-audit.sh` — 9 ✅ invariant 유지. 항목
  #1 은 의도적 제거이므로 sprint-376 의 9 affordance contract 자체가
  변경된 것은 아님 → checklist 는 "removed-by-sprint-377" 메타와 함께
  `[x]` 유지. (script 는 단순 grep, 표현만 손봄.)

## Out of Scope

- 다른 sprint-376 affordance 컴포넌트 (DataGrid / Sidebar handle / Group
  header / Sidebar header / Home Recent footer / Favorites) — 한 글자도
  건드리지 않음.
- 새 confirm dialog / 키보드 단축키 / Q21 contract 재해석.
- Backend IPC (`reset_setting`) — 호출자만 사라지지 IPC 자체는 유지
  (sidebar handle 및 home recent 가 여전히 호출).

## Invariants

- 사용자가 settings panel (HomePage 의 `home-settings` 영역) 에서 "Reset
  settings" / "Reset sidebar width" 버튼을 발견할 수 없다.
- sidebar handle 우클릭 → "Reset sidebar width" 는 여전히 작동
  (`Sidebar.reset-affordance.test.tsx` 유지).
- Home Recent footer 의 작은 reset 버튼 (`home-recent-reset`) 은 여전히
  작동 (`HomePage.reset-affordance.test.tsx` AC-376-02 유지).
- Home action bar "Clear recent" 는 여전히 작동 (AC-376-08 유지).
- 다른 6 affordance 의 test 파일 build / pass 상태 unchanged.
- `bash scripts/check-reset-affordance-audit.sh` 가 여전히 PASS — 9 ✅
  유지 (항목 #1 은 의도적 제거 메타 부착, `[x]` 표기 유지).

## Acceptance Criteria

- `AC-377-01` HomePage 마운트 후 `screen.queryByRole("button", { name:
  /^reset settings$/i })` 는 `null`. (Regression guard.)
- `AC-377-02` HomePage 마운트 후 `screen.queryByRole("button", { name:
  /^reset sidebar width$/i })` 는 `null` — *HomePage* 안에서 ResetSettingsButton mount 가
  사라졌으므로. (Sidebar handle 우클릭 entry 는 별 컴포넌트
  `Sidebar.tsx` 에 있고 HomePage 렌더 트리에 포함되지 않음.)
- `AC-377-03` `ResetSettingsButton.tsx` 파일 존재 안 함 (`fs.existsSync`
  거짓) — 사실 git 상태로 충분, 단언은 test 가 import 실패 + grep 없음
  으로 간접 lock.
- `AC-377-04` `Sidebar.reset-affordance.test.tsx` PASS (sidebar handle
  reset 유지 regression guard).
- `AC-377-05` `HomePage.reset-affordance.test.tsx` 의 AC-376-02 +
  AC-376-08 케이스 PASS (Recent reset / clear_mru 유지).
- `AC-377-06` `bash scripts/check-reset-affordance-audit.sh` exit 0
  (9 affordance checklist invariant 유지).
- `AC-377-07` `pnpm tsc --noEmit` clean — `ResetSettingsButton` 으로의
  dangling import 없음.
- `AC-377-08` `pnpm lint` clean.
- `AC-377-09` 전체 `pnpm vitest run` PASS — baseline (4128+) 대비 두
  test (`ResetSettingsButton.reset-affordance.test.tsx` 의 2 케이스) 가
  제거되고 HomePage 의 세 번째 케이스가 negative assertion 으로 변경.

## Design Bar / Quality Bar

- TDD: 3 RED → 3 GREEN 순서. 가로 슬라이스 금지.
- 단순 삭제 작업 — 새 컴포넌트 / 새 IPC 0.
- 코멘트 톤 caveman (짧고 정확). 모든 신규/수정 test 헤더에 사유 +
  날짜 (2026-05-17).

## Verification Plan

### Required Checks

1. `pnpm test src/pages/HomePage.reset-affordance.test.tsx` — 3 PASS.
2. `pnpm test src/components/settings src/components/layout/Sidebar src/components/connection/ConnectionGroup src/components/datagrid src/components/query/FavoritesPanel.reset-affordance.test.tsx` — 다른 affordance 회귀 없음.
3. `pnpm tsc --noEmit`.
4. `pnpm lint`.
5. `bash scripts/check-reset-affordance-audit.sh`.
6. 전체 `pnpm test`.

### Required Evidence

- 3 변경된 RTL 케이스 결과.
- 다른 8 affordance test 파일의 PASS 결과.
- audit script PASS 출력.
- tsc / lint clean.

## Test Requirements

- Vitest: 3 회귀 가드 케이스 (HomePage 안에서 두 버튼 부재 + sidebar
  handle entry 유지).
- 새 컴포넌트 0, 새 IPC 0.

## Test Script / Repro Script

1. `pnpm test src/pages/HomePage.reset-affordance.test.tsx`
2. `pnpm test src/components/layout/Sidebar.reset-affordance.test.tsx`
3. `bash scripts/check-reset-affordance-audit.sh`
4. `pnpm tsc --noEmit && pnpm lint && pnpm test`

## Ownership

- Generator: general-purpose Agent (본 sprint).
- Write scope: In Scope.
- Merge order: sprint-376 머지 후. Settings panel 의 reset 버튼 제거는
  Q21 9 affordance 의 *축소* 가 아니라 *entry point 재배치* — Q21
  contract 자체는 #1 / #3 의 사용자 발견 경로를 최소 1개 보장하고
  sidebar handle entry (#3-a) + home-recent footer (#2) + 다른 7
  affordance 가 그 contract 를 유지.

## Exit Criteria

- Open P1/P2: 0
- AC 9/9 PASS
- audit script PASS
- Settings panel 에 reset 버튼 없음 (사용자 캡처 매치).
