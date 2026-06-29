/**
 * i18n foundation (react-i18next).
 *
 * 라이브러리 init + boot 시 SQLite 영속 locale 적용. 리소스는 `locales/*.ts`
 * 의 surface별 네임스페이스 파일들을 `import.meta.glob` 로 자동 등록한다.
 *
 * ponytail: 네임스페이스를 surface별 파일로 분리하고 glob 로 자동 등록한다 —
 * surface 를 추가/이주할 때 이 파일을 건드릴 필요가 없어 마이그레이션 swarm 의
 * 공유 파일 충돌(merge conflict)을 원천 차단한다. 파일명(확장자 제외)이 곧
 * 네임스페이스 이름이고, 각 파일은 `en`/`ko` 를 named export 한다.
 */

import i18n from "i18next";
import { initReactI18next } from "react-i18next";

export const SUPPORTED_LOCALES = ["en", "ko"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

/** 초기/fallback 언어. boot 의 `applyPersistedLocale` 가 영속값으로 덮어쓴다. */
export const DEFAULT_LOCALE: Locale = "en";

/** SQLite settings 의 locale 키. */
export const LOCALE_SETTING_KEY = "locale";

type LocaleBundle = Partial<Record<Locale, Record<string, unknown>>>;

// 각 `locales/<ns>.ts` 가 `{ en, ko }` 를 named export. eager 로 빌드 타임에
// 모두 로드해 동기 init — 인라인 리소스라 비동기 로드/Suspense 가 없다.
const modules = import.meta.glob<LocaleBundle>("./locales/*.ts", {
  eager: true,
});

const resources: Record<Locale, Record<string, Record<string, unknown>>> = {
  en: {},
  ko: {},
};
const namespaces: string[] = [];
for (const path in modules) {
  // "./locales/connection.ts" -> "connection"
  const ns = path.slice(path.lastIndexOf("/") + 1).replace(/\.ts$/, "");
  const mod = modules[path];
  if (!mod) continue;
  namespaces.push(ns);
  for (const locale of SUPPORTED_LOCALES) {
    resources[locale][ns] = mod[locale] ?? {};
  }
}

void i18n.use(initReactI18next).init({
  resources,
  lng: DEFAULT_LOCALE,
  fallbackLng: DEFAULT_LOCALE,
  defaultNS: "common",
  ns: namespaces.length > 0 ? namespaces : ["common"],
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
