import { ToggleGroup, ToggleGroupItem } from "@components/ui/toggle-group";
import i18nInstance, {
  isSupportedLocale,
  LOCALE_SETTING_KEY,
  type Locale,
  SUPPORTED_LOCALES,
} from "@lib/i18n";
import { logger } from "@lib/logger";
import { toast } from "@lib/runtime/toast";
import { persistSettingValue } from "@lib/tauri/settings";
import { useTranslation } from "react-i18next";

// Language names stay in their own language — by convention, untranslated.
const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  ko: "한국어",
};

export default function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  const current = isSupportedLocale(i18n.language) ? i18n.language : "en";

  function handleChange(next: string) {
    if (!isSupportedLocale(next) || next === current) return;
    // optimistic: change the language first (immediate re-render) →
    // fire-and-forget persist. Same pattern as ThemePicker — the user already
    // sees it applied.
    // #1092 — SQLite is the SOT for locale and there is no boot reconcile, so
    // swallowing a write failure brings the previous language back on restart.
    // Surface it with a dev log + toast.
    // ponytail: live cross-window sync is follow-up work that wires theme's
    // zustand-ipc-bridge + settingsReceiver pattern separately. For now,
    // persist + re-apply at boot only.
    void i18n.changeLanguage(next);
    void persistSettingValue(LOCALE_SETTING_KEY, next).catch((e) => {
      logger.warn(
        "[LanguageSwitcher] persist locale failed:",
        e instanceof Error ? e.message : e,
      );
      toast.error(i18nInstance.t("feedback:storageWriteFailed"));
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="text-3xs font-semibold uppercase tracking-wider text-muted-foreground">
        {t("language")}
      </span>
      <ToggleGroup
        type="single"
        value={current}
        onValueChange={handleChange}
        aria-label={t("language")}
        className="w-full justify-between"
      >
        {SUPPORTED_LOCALES.map((loc) => (
          <ToggleGroupItem
            key={loc}
            value={loc}
            aria-label={LOCALE_LABELS[loc]}
            className="flex-1"
          >
            {LOCALE_LABELS[loc]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}
