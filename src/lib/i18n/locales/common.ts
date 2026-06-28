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
  },
} as const;
