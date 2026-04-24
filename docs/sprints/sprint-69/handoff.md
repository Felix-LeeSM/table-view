# Sprint 69 — Generator Handoff (Theme Picker Popover UI)

## Scope recap

`tmp/design-system/THEMING.md` Phase 3. Sprint 67(토큰) / 68(스토어)이 깔아둔
runtime 전환 기반 위에 **Sidebar 푸터에서 72 테마 × 라이트/다크/시스템을 한 번에
고를 수 있는 팝오버 UI**를 붙였다. ⌘K 팔레트, Settings → Appearance 전용 화면,
per-connection 오버라이드는 범위 밖.

## Changed Files

### New files

- `src/components/ui/popover.tsx` (48 lines) — shadcn-style `radix-ui` `Popover`
  wrapper. `Popover`/`PopoverTrigger`/`PopoverAnchor`/`PopoverContent` export.
  - `data-slot` / `cn` 조합 / `React.ComponentProps<typeof Primitive>` 스타일을
    기존 dialog/alert-dialog와 일치시킴.
  - 토큰 기반 스타일: `bg-popover text-popover-foreground border-border
    shadow-md rounded-md`. Radix `data-[state=open/closed]` animate-in/out과
    `data-[side=...]:slide-in-from-*-2` 포함.
- `src/components/theme/ThemePicker.tsx` (99 lines) — 팝오버 컨텐츠.
  - 상단: `Appearance` 라벨 + Light/Dark/System `ToggleGroup` (`@components/ui/toggle-group`
    재사용, single 선택, 각 ToggleGroupItem에 Sun/Moon/Monitor 아이콘 + 텍스트).
  - 중단: `<Input>` 기반 검색 (substring, case-insensitive, `id`/`name`/`vibe`
    모두 매칭, `useMemo`로 필터링 결과 캐시).
  - 하단: `grid-cols-2 gap-2 max-h-[360px] overflow-auto` 카드 목록. 각 카드:
    - `span` swatch (`style={{ backgroundColor: entry.swatch }}`, 16px 원형,
      `border border-border` 둘레).
    - `name` (truncate, bold, xs) + `vibe` (truncate, muted, 10px).
    - 활성 카드: `data-active="true"` + `ring-2 ring-primary`.
    - 클릭 시 `useThemeStore.setTheme(entry.id)` 호출. 팝오버는 **닫지 않음**
      (여러 테마를 빠르게 훑기 위함).
    - `aria-label="Theme <name>"` + `aria-pressed`.
  - 빈 검색 결과: `col-span-2` placeholder "No themes match" 표시.
- `src/components/ui/popover.test.tsx` (new, 3 tests) — trigger 클릭 시 portal
  mount, Escape 시 닫힘, align/sideOffset prop 전달 + 토큰 클래스(`bg-popover`,
  `text-popover-foreground`, `border-border`) 적용 확인.
- `src/components/theme/ThemePicker.test.tsx` (new, 7 tests) — 72 카드 렌더,
  활성 카드(`data-active="true"`), 카드 클릭 → `setTheme` 반영 + 컴포넌트 유지,
  mode 라디오 클릭 → `setMode`, 검색 필터(`"mong"` → MongoDB 포함 & 전체보다 적음),
  case-insensitive + vibe 매칭(`"GITHUB"` → github, `"enterprise"` → ibm),
  "No themes match" placeholder.

### Modified files

- `src/components/layout/Sidebar.tsx` —
  - `useTheme` 훅 제거. `useThemeStore`에서 `themeId` / `mode` / `handleSystemChange`
    직접 subscribe.
  - `useEffect`에서 `mode === "system"`일 때 `subscribeSystemModeChange(handleSystemChange)`
    구독 + 언마운트 시 해제. (기존에는 `useTheme`이 담당하던 책임을 Sidebar가
    직접 가져옴.)
  - `cycleTheme` 함수 및 cycle `<Button onClick={cycleTheme}>` 삭제.
  - 테마 picker 푸터로 교체:
    ```tsx
    <Popover>
      <PopoverTrigger asChild>
        <Button aria-label={`Theme picker: currently ${activeEntry.name} (${themeMode})`}>
          <span style={{ backgroundColor: activeEntry.swatch }} /> ● swatch
          <span>{activeEntry.name}</span>
          <ThemeIcon className="ml-auto" />  Sun/Moon/Monitor
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" sideOffset={8} className="w-80">
        <ThemePicker />
      </PopoverContent>
    </Popover>
    ```
  - `useState` sidebar mode와 이름 충돌 회피를 위해 theme mode는 `themeMode`로
    로컬 바인딩.
- `src/components/layout/Sidebar.test.tsx` —
  - `vi.mock("@hooks/useTheme", ...)` 제거.
  - `@components/theme/ThemePicker`를 stub으로 mock (`<div data-testid="theme-picker-mock" />`).
    Radix portal 내부까지 렌더하지 않고 trigger 동작만 검증.
  - 기존 "renders the theme toggle and cycles theme on click" 테스트 2개로 분할:
    1. "renders the theme picker trigger with current theme in aria-label" —
       `getByRole("button", { name: /theme picker: currently/i })` 존재.
    2. "opens the theme picker popover when the trigger is clicked" — 클릭 전에는
       `queryByTestId("theme-picker-mock") === null`, 클릭 후 mount 확인.
  - `mockTheme` / `mockSetTheme` 전역 스텁 제거 + `beforeEach`의 `mockTheme` 리셋 제거.

## Done Criteria — Evidence

| Criterion | Evidence |
|---|---|
| `src/components/ui/popover.tsx` 존재 + `Popover`/`PopoverTrigger`/`PopoverContent` export | `grep -nE '^export' src/components/ui/popover.tsx` → `export { Popover, PopoverTrigger, PopoverAnchor, PopoverContent };` |
| `src/components/theme/ThemePicker.tsx` 존재, 72 카드 렌더 | `ThemePicker.test.tsx: "renders a card for every entry in THEME_CATALOG"` → 72 assertion pass |
| 검색 / 모드 토글 / 카드 클릭 wiring | `ThemePicker.test.tsx` 7/7 pass (시나리오: 필터, setTheme, setMode, placeholder) |
| Sidebar 푸터에 swatch + 테마 name + mode 아이콘 | `src/components/layout/Sidebar.tsx:244-272` trigger 블록 |
| Sidebar `cycleTheme` 문자열 0 | `grep -c 'cycleTheme' src/components/layout/Sidebar.tsx` → **0** |
| `THEME_CATALOG` ThemePicker에서 소비 | `grep -c 'THEME_CATALOG' src/components/theme/ThemePicker.tsx` → **3** |
| `pnpm tsc --noEmit` pass | exit 0 |
| `pnpm lint` pass | exit 0 |
| `pnpm vitest run` pass | 65 files · 1184 tests |

## Verification

- `pnpm tsc --noEmit` → **pass** (0 errors)
- `pnpm lint` → **pass** (0 warnings/errors)
- `pnpm vitest run` → **65 files · 1184 tests pass**. Sprint 68 63 files · 1173
  tests → 65 files · 1184 tests, 순증 +11:
  - `ThemePicker.test.tsx`: +7 (신규 — 계약 요구치 ≥6 충족)
  - `popover.test.tsx`: +3 (신규 — 계약 요구치 ≥2 충족)
  - `Sidebar.test.tsx`: +1 (기존 1건이 2건으로 분할 — `+2 -1 = +1`)
  - Duration 14.55s.

## Invariants maintained

- `useTheme` 훅 자체는 **유지**(`src/hooks/useTheme.ts` 미삭제). Sidebar가 더 이상
  호출하지 않을 뿐이며 public API(`{ theme, setTheme }`)도 그대로. Sprint 68 한정
  다른 컴포넌트가 향후 import할 가능성을 위해 보존.
- `useThemeStore` 공개 API 불변. `setTheme`/`setMode`/`setState`/`hydrate`/
  `handleSystemChange` 시그니처 동일.
- `data-theme`/`data-mode` 속성 결정 경로 불변 (store 액션에서 `applyTheme` 호출).
- `THEME_CATALOG` 순서/엔트리 불변 — ThemePicker는 `.map`으로 있는 그대로 렌더.
- `src-tauri/**` 수정 0.
- `localStorage` 포맷(`table-view-theme` JSON) 불변. picker는 `setTheme`/`setMode`만
  호출하므로 기존 저장 경로 재사용.

## Manual smoke

- `pnpm dev` 실행 시 확인 포인트:
  1. Sidebar 푸터 버튼: swatch 원 + 현재 테마 name + 우측 mode 아이콘 표시.
  2. 버튼 클릭 → 팝오버가 상단(side="top", align="start")으로 등장.
  3. 팝오버 상단 ToggleGroup에서 Light/Dark/System 선택 시 즉시 `data-mode`
     전환(전체 UI 재색상).
  4. 중간 `Search themes...` 입력란에 "mong" 입력 시 MongoDB만 남음.
  5. 카드 클릭(예: "GitHub Primer") → 전체 UI가 github 팔레트로 재색상되지만
     팝오버는 **닫히지 않음** → 이어서 "Slate (default)" 클릭해서 원복 가능.
  6. 팝오버 열린 상태에서 Escape → 팝오버 닫힘 + trigger로 focus 복귀 (Radix 기본).
  7. 접근성: trigger `aria-label`에 `Theme picker: currently <name> (<mode>)` 노출.

## Out of Scope (deferred)

- ⌘K 팔레트의 "Theme: X" 빠른 전환.
- Settings → Appearance 전용 그리드 화면 (가로 flex + 프리뷰 카드).
- Per-connection 테마 오버라이드 (연결마다 theme pin).
- 사용자 커스텀 테마 JSON / 드래그-인 import.
- 팝오버 안 미리보기 썸네일 (현재는 swatch 원 1개 + 텍스트만).

## 후속 진입 조건

- Phase 4(⌘K 팔레트)는 `useThemeStore.setTheme`과 `THEME_CATALOG`만 import하면
  바로 wiring 가능. ThemePicker의 검색/필터 로직(`useMemo` 부분)을 참조하면
  palette hit item을 재사용 가능.
- Settings 화면은 ThemePicker를 그대로 embed하되 `max-h` 제약을 풀고 3~4열 그리드로
  확장하는 수준의 변형만 필요.
