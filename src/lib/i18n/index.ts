/**
 * i18n foundation (react-i18next).
 *
 * 단계 ① 인프라: 라이브러리 init + ko/en `common` 네임스페이스 골격 + boot 시
 * SQLite 영속 locale 적용. surface별 문자열 추출/치환과 네임스페이스 분할은
 * 단계 ②(마이그레이션)에서 채운다.
 *
 * ponytail: 리소스를 인라인 TS 로 둔다 — tsconfig `resolveJsonModule` 의존을
 * 피하고 타입 안전을 얻는다. 양이 커지면 단계 ②에서 surface별 JSON/TS 로 분리.
 */

import i18n from "i18next";
import { initReactI18next } from "react-i18next";

export const SUPPORTED_LOCALES = ["en", "ko"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

/** 초기/fallback 언어. boot 의 `applyPersistedLocale` 가 영속값으로 덮어쓴다. */
export const DEFAULT_LOCALE: Locale = "en";

/** SQLite settings 의 locale 키. */
export const LOCALE_SETTING_KEY = "locale";

const resources = {
  en: {
    common: {
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
    },
  },
  ko: {
    common: {
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
    },
  },
} as const;

void i18n.use(initReactI18next).init({
  resources,
  lng: DEFAULT_LOCALE,
  fallbackLng: DEFAULT_LOCALE,
  defaultNS: "common",
  ns: ["common"],
  // React 가 이미 출력값을 escape 하므로 i18next 의 이중 escape 를 끈다.
  interpolation: { escapeValue: false },
  // 인라인 리소스라 비동기 로드가 없다 — Suspense 경계를 요구하지 않도록 off.
  react: { useSuspense: false },
});

export function isSupportedLocale(value: unknown): value is Locale {
  return (
    typeof value === "string" &&
    (SUPPORTED_LOCALES as readonly string[]).includes(value)
  );
}

/**
 * boot: SQLite 에 영속된 locale 을 읽어 적용. 미설정이면 DEFAULT_LOCALE 유지.
 * theme reconcile 과 같은 위치에서 첫 render 전에 호출되어 언어 flash 를 막는다.
 * 영속값 손상/IPC 실패는 삼키고 DEFAULT_LOCALE 로 진행한다.
 */
export async function applyPersistedLocale(): Promise<void> {
  try {
    // Lazy import: 이 모듈을 단순 import 하는 것만으로 tauri IPC 바인딩
    // (`@tauri-apps/api/core` invoke) 을 끌어오지 않게 한다. test-setup 이
    // i18n 을 eager import 하므로, 여기서 정적 import 하면 `@lib/tauri/settings`
    // 가 setup 단계에 실제 core 로 바인딩돼 이후 테스트의
    // `vi.mock("@tauri-apps/api/core")` 를 무력화한다(reset-affordance 회귀).
    const { getSetting } = await import("@lib/tauri/settings");
    const raw = await getSetting(LOCALE_SETTING_KEY);
    if (raw == null) return;
    const parsed: unknown = JSON.parse(raw);
    if (isSupportedLocale(parsed) && parsed !== i18n.language) {
      await i18n.changeLanguage(parsed);
    }
  } catch {
    // 손상된 영속값/IPC 실패 — DEFAULT_LOCALE fallback, boot 계속.
  }
}

export default i18n;
