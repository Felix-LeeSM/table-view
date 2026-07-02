import { useTranslation } from "react-i18next";
import { ToggleGroup, ToggleGroupItem } from "@components/ui/toggle-group";
import i18nInstance, {
  SUPPORTED_LOCALES,
  isSupportedLocale,
  LOCALE_SETTING_KEY,
  type Locale,
} from "@lib/i18n";
import { persistSettingValue } from "@lib/tauri/settings";
import { logger } from "@lib/logger";
import { toast } from "@lib/runtime/toast";

// 언어명은 각 언어 자체 표기 — 관례상 번역하지 않는다.
const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  ko: "한국어",
};

export default function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  const current = isSupportedLocale(i18n.language) ? i18n.language : "en";

  function handleChange(next: string) {
    if (!isSupportedLocale(next) || next === current) return;
    // optimistic: 먼저 언어 변경(즉시 리렌더) → fire-and-forget 영속.
    // ThemePicker 와 동일 패턴 — 사용자는 이미 적용됨.
    // #1092 — locale 은 SQLite SOT 이고 boot reconcile 이 없어, write 실패를
    // 삼키면 재부팅 시 이전 언어로 되돌아간다. dev log + toast 로 표면화한다.
    // ponytail: cross-window 라이브 동기화는 theme 의 zustand-ipc-bridge +
    // settingsReceiver 패턴을 따로 붙이는 후속 작업. 지금은 영속 + boot 재적용만.
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
