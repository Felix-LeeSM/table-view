/**
 * `common` 네임스페이스 — 앱 전역 공용 문자열 (언어/외관 토글 등).
 *
 * 각 surface 는 `locales/<surface>.ts` 로 자기 네임스페이스를 둔다. `index.ts`
 * 가 `import.meta.glob("./locales/*.ts")` 로 자동 등록하므로 새 surface 추가
 * 시 index 를 건드릴 필요가 없다 (마이그레이션 swarm 의 공유 파일 충돌 회피).
 *
 * en 값은 마이그레이션 이전 하드코딩 영어 리터럴을 바이트 그대로 미러한다 —
 * 기본 locale 이 en 이므로 렌더/테스트/E2E 선택자가 불변이다.
 */

export const en = {
  language: "Language",
  appearance: "Appearance",
  mode: {
    light: "Light",
    dark: "Dark",
    system: "System",
    ariaGroup: "Appearance mode",
    lightAria: "Light mode",
    darkAria: "Dark mode",
    systemAria: "System mode",
  },
  theme: {
    aria: "Theme {{name}}",
    favorites: "Favorites",
    favoritesEmpty: "No favorites yet. Star a theme in the gallery.",
    openGallery: "Browse all themes",
    gallery: {
      title: "Theme gallery",
      description: "Pick a theme, or star the ones you want in the picker.",
      applied: "Applied: {{name}}",
      searchLabel: "Filter themes",
      searchPlaceholder: "Filter by name, id, or vibe",
      filterAll: "All",
      filterFavorites: "Favorites",
      noMatch: "No theme matches this filter.",
      apply: "Apply {{name}}",
      addFavorite: "Add {{name}} to favorites",
      removeFavorite: "Remove {{name}} from favorites",
      reset: "Reset favorites",
      resetTitle: "Reset favorites to defaults",
    },
  },
} as const;

export const ko = {
  language: "언어",
  appearance: "외관",
  mode: {
    light: "라이트",
    dark: "다크",
    system: "시스템",
    ariaGroup: "외관 모드",
    lightAria: "라이트 모드",
    darkAria: "다크 모드",
    systemAria: "시스템 모드",
  },
  theme: {
    aria: "테마 {{name}}",
    favorites: "즐겨찾기",
    favoritesEmpty: "즐겨찾기가 없다. 갤러리에서 ★ 를 눌러 담는다.",
    openGallery: "전체 테마 보기",
    gallery: {
      title: "테마 갤러리",
      description: "테마를 고르거나, 피커에 둘 테마에 ★ 를 누른다.",
      applied: "적용 중: {{name}}",
      searchLabel: "테마 거르기",
      searchPlaceholder: "이름 · id · 분위기로 거르기",
      filterAll: "전체",
      filterFavorites: "즐겨찾기",
      noMatch: "이 조건에 맞는 테마가 없다.",
      apply: "{{name}} 적용",
      addFavorite: "{{name}} 즐겨찾기에 추가",
      removeFavorite: "{{name}} 즐겨찾기에서 제거",
      reset: "즐겨찾기 초기화",
      resetTitle: "즐겨찾기를 기본값으로 초기화",
    },
  },
} as const;
