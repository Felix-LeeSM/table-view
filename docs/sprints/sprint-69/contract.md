# Sprint 69 Contract — Theme Picker Popover UI

> `tmp/design-system/THEMING.md` Phase 3. Sprint 67(토큰)/68(스토어)이 끝나 runtime 전환 기반이 다 갖춰졌다. 이번 스프린트는 **Sidebar 푸터에서 72 테마 × 라이트/다크/시스템을 한 번에 고를 수 있는 팝오버 UI**를 붙인다. ⌘K 팔레트, Settings → Appearance 전용 화면, per-connection 오버라이드는 out of scope.

## Scope

1. **`src/components/ui/popover.tsx` 신설** — shadcn-스타일 `radix-ui` `Popover` wrapper.
   - `Popover`(Root) / `PopoverTrigger`(asChild 기본 true) / `PopoverPortal` / `PopoverContent`(align/sideOffset prop, portal 경유).
   - 토큰 기반 스타일: `bg-popover`, `text-popover-foreground`, `border-border`, `shadow-md`, `rounded-md`, `data-[state=open]:animate-in`, `data-[state=closed]:animate-out`.
   - 다른 dialog/alert-dialog와 **동일한 코드 스타일**(`data-slot`, `cn` 조합, `React.ComponentProps<typeof Primitive>` 형식) 유지.
2. **`src/components/theme/ThemePicker.tsx` 신설** — 팝오버 안에 들어가는 실 컨텐츠 컴포넌트.
   - 상단: `Appearance` 라벨 + Light/Dark/System `ToggleGroup` (기존 `toggle-group` 재사용).
   - 중단: 테마 이름 `Input` 기반 검색(substring, case-insensitive, `id`/`name`/`vibe` 매칭).
   - 하단: 스크롤 가능한 2열 그리드 — 각 카드:
     - 원형 swatch (`style={{ backgroundColor: entry.swatch }}` — `THEME_CATALOG`의 hex).
     - 상단 라인: 테마 `name` (bold, truncate).
     - 하단 라인: `vibe` (muted 작게, truncate).
     - 활성 카드: `data-active="true"` + `ring-2 ring-primary`.
     - 클릭 시 `useThemeStore.setTheme(id)` 호출, 팝오버는 **닫지 않음**(사용자가 여러 테마를 빠르게 훑어볼 수 있어야 함).
   - 최대 높이 고정(`max-h-[360px]`) + overflow scroll.
   - 비어있는 검색 결과: "No themes match" placeholder.
3. **Sidebar 푸터 교체** — `src/components/layout/Sidebar.tsx`:
   - 기존 `cycleTheme` / `<Button onClick={cycleTheme}>` 삭제.
   - 대신 `<Popover>` + `<PopoverTrigger asChild>` + 현재 선택 상태를 보여주는 `<Button>` + `<PopoverContent>` 안의 `<ThemePicker />`.
   - Trigger 버튼 문구: swatch dot + `THEME_CATALOG.find(id).name` + mode 아이콘(Sun/Moon/Monitor). 예: `● Slate · System`.
   - 기존 `aria-label="Theme: ... Click to change."` 같은 접근성 텍스트 유지/개선(`aria-label="Theme picker: currently <name> (<mode>)"`).
   - `useTheme` 훅 제거하고 `useThemeStore` 직접 subscribe(`themeId`, `mode`).
4. **테스트**:
   - `src/components/theme/ThemePicker.test.tsx` — 신규, ≥ 6 tests:
     - 72개 카드 렌더 (또는 가시 영역 + scroll 가정 — `getAllByRole("button", ...)` count 72).
     - 현재 `themeId` 카드에 활성 표시(`data-active="true"`).
     - 카드 클릭 시 `useThemeStore.getState().themeId` 변화.
     - Light/Dark/System 버튼 클릭 시 `mode` 변화.
     - 검색어 입력 시 매칭되지 않는 카드가 제거(`queryAllByRole` count 감소).
     - 빈 검색 결과 placeholder 표출.
   - `src/components/ui/popover.test.tsx` — 신규, ≥ 2 tests: trigger 클릭 시 content 등장, escape 시 닫힘.
   - `src/components/layout/Sidebar.test.tsx` — 회귀 수정: cycleTheme 기대 삭제, picker trigger 버튼 aria-label 기대로 교체.
5. **Invariants**:
   - `useTheme` 훅 자체는 **유지**(공개 API 불변, Sidebar가 쓰지 않게 될 뿐). 다른 곳에서 import하고 있을 수 있으므로 파일 삭제 금지.
   - `useThemeStore` 공개 API 불변.
   - `data-theme`/`data-mode` 속성 결정 경로 불변(store 액션에서 `applyTheme` 호출).
   - `THEME_CATALOG` 순서/엔트리 불변.
   - `src-tauri/**` 수정 0.

## Done Criteria

1. `src/components/ui/popover.tsx` 존재, `Popover`/`PopoverTrigger`/`PopoverContent` export.
2. `src/components/theme/ThemePicker.tsx` 존재, 72 카드 렌더, 검색 / 모드 토글 / 카드 클릭 wiring 완료.
3. Sidebar 푸터 trigger 버튼에 현재 테마 `name` + mode 아이콘 표시, 클릭 시 팝오버 등장.
4. `pnpm tsc --noEmit` / `pnpm lint` / `pnpm vitest run` 모두 pass.
5. 테스트 순증: ThemePicker ≥ 6, popover ≥ 2, 기타 회귀 수정.
6. 수동 smoke: `pnpm dev`에서 picker 열고 테마 변경 시 즉시 전체 UI 재색상 적용. mode 토글 시 light/dark 반영. 검색 필터링 정상.

## Out of Scope (future)

- ⌘K 팔레트 "Theme: X" 빠른 전환.
- Settings → Appearance 전용 그리드 화면.
- Per-connection 테마 오버라이드.
- 사용자 커스텀 테마 JSON.
- 팝오버 안 미리보기 썸네일(지금은 swatch 원 1개만).

## Verification Plan

- Profile: `frontend-only`.
- Required checks:
  1. `pnpm tsc --noEmit`
  2. `pnpm lint`
  3. `pnpm vitest run`
- Evidence:
  - 변경 파일 목록.
  - `grep -c 'THEME_CATALOG' src/components/theme/ThemePicker.tsx` ≥ 1.
  - Sidebar에서 `cycleTheme` 문자열 0: `grep -c 'cycleTheme' src/components/layout/Sidebar.tsx` → 0.
  - `pnpm vitest run`의 총 pass 수 Sprint 68 대비 증가.
- 수동 smoke 기록.

## Scenario coverage

- Happy path: 유저가 푸터 버튼 클릭 → 팝오버 열림 → "GitHub" 카드 클릭 → 전체 UI가 GitHub 팔레트로 재색상.
- Mode 독립: 테마가 `github`인 상태에서 dark → light 토글 시 `themeId`는 그대로.
- 검색: "mong" 입력 시 MongoDB 카드만 매칭(또는 `vibe`에 "mong"이 들어간 항목 있으면 포함).
- 빈 검색: "zzz" 입력 시 "No themes match" placeholder.
- 키보드: 팝오버가 ESC로 닫히고 trigger로 포커스 복귀(Radix 기본 동작 검증만).
- 접근성: trigger `aria-label`이 현재 테마+모드를 노출.
