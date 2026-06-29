import { KeyRound, SearchCode } from "lucide-react";
import { useTranslation } from "react-i18next";

export interface UnsupportedShellNoticeProps {
  /**
   * The paradigm whose adapter has not been implemented yet. `kv` and
   * `search` placeholders surface in the sidebar at the same level of
   * polish as the empty / connecting states.
   */
  paradigm: "kv" | "search";
}

const PARADIGM_ICON: Record<
  UnsupportedShellNoticeProps["paradigm"],
  typeof KeyRound
> = {
  kv: KeyRound,
  search: SearchCode,
};

/**
 * Placeholder sidebar for paradigms without a dedicated shell yet. Visual
 * structure mirrors the existing `SchemaPanel` empty states (centered icon
 * + heading + body copy on a `select-none` flex column) so the swap
 * between supported and unsupported paradigms is not jarring.
 *
 * Accessibility:
 * - `role="status"` so screen readers announce the message politely when
 *   the user opens an unsupported connection.
 * - `aria-label` is spelled out per-paradigm so e2e selectors and assistive
 *   tech can address the notice unambiguously.
 */
export default function UnsupportedShellNotice({
  paradigm,
}: UnsupportedShellNoticeProps) {
  const { t } = useTranslation("workspace");
  const Icon = PARADIGM_ICON[paradigm];
  const label = t(`unsupportedShell.${paradigm}.label`);
  return (
    <div
      role="status"
      aria-label={t(`unsupportedShell.${paradigm}.ariaLabel`)}
      className="flex flex-1 flex-col items-center justify-center px-4 py-8 text-center select-none"
    >
      <Icon size={36} className="mb-3 text-muted-foreground" />
      <p className="text-sm font-medium text-secondary-foreground">
        {t("unsupportedShell.heading")}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {t("unsupportedShell.body", { label })}
      </p>
    </div>
  );
}
