/**
 * i18n foundation (react-i18next).
 *
 * Initializes the library and applies the SQLite-persisted locale at boot.
 * Resources are the per-surface namespace files under `locales/*.ts`,
 * registered automatically through `import.meta.glob`.
 *
 * ponytail: namespaces are split into per-surface files and registered by
 * glob — adding or migrating a surface does not require touching this file,
 * which rules out shared-file merge conflicts in a migration swarm. The file
 * name (without extension) is the namespace name, and each file named-exports
 * `en` / `ko`.
 */

import i18n from "i18next";
import { initReactI18next } from "react-i18next";

export const SUPPORTED_LOCALES = ["en", "ko"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

/**
 * Initial/fallback language. At boot, `applyPersistedLocale` overrides it with
 * the persisted value.
 */
export const DEFAULT_LOCALE: Locale = "en";

/** Locale key in the SQLite settings. */
export const LOCALE_SETTING_KEY = "locale";

type LocaleBundle = Partial<Record<Locale, Record<string, unknown>>>;

// Each `locales/<ns>.ts` named-exports `{ en, ko }`. `eager` loads them all at
// build time for a synchronous init — inline resources mean no async loading
// and no Suspense. `*.test.ts` is excluded explicitly — under the file name =
// namespace contract, a test file inside locales/ would be imported as a
// namespace and break boot/build (#1227). To enforce the contract, locale
// tests live outside locales/ (`src/lib/i18n/*-locales.test.ts`).
const modules = import.meta.glob<LocaleBundle>(
  ["./locales/*.ts", "!./locales/*.test.ts"],
  { eager: true },
);

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
  // React already escapes output, so i18next's double escaping is turned off.
  interpolation: { escapeValue: false },
  // Off: inline resources have no async load, so no Suspense boundary needed.
  react: { useSuspense: false },
});

export function isSupportedLocale(value: unknown): value is Locale {
  return (
    typeof value === "string" &&
    (SUPPORTED_LOCALES as readonly string[]).includes(value)
  );
}

/**
 * Boot: reads the locale persisted in SQLite and applies it; when unset,
 * DEFAULT_LOCALE stays. Called before the first render, at the same place as
 * the theme reconcile, so the language does not flash. A corrupt persisted
 * value or an IPC failure is swallowed and boot goes on with DEFAULT_LOCALE.
 */
export async function applyPersistedLocale(): Promise<void> {
  try {
    // Lazy import: merely importing this module must not pull in the tauri IPC
    // binding (`@tauri-apps/api/core` invoke). test-setup imports i18n
    // eagerly, so a static import here would bind `@lib/tauri/settings` to the
    // real core during setup and defeat later tests'
    // `vi.mock("@tauri-apps/api/core")` (reset-affordance regression).
    const { getSetting } = await import("@lib/tauri/settings");
    const raw = await getSetting(LOCALE_SETTING_KEY);
    if (raw == null) return;
    const parsed: unknown = JSON.parse(raw);
    if (isSupportedLocale(parsed) && parsed !== i18n.language) {
      await i18n.changeLanguage(parsed);
    }
  } catch {
    // Corrupt persisted value / IPC failure — fall back to DEFAULT_LOCALE and
    // keep booting.
  }
}

export default i18n;
