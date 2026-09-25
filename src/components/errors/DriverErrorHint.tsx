/**
 * DriverErrorHint — renders the hint `classifyDriverError` produced in the
 * KeyringFallbackToast tone (summary + action guidance) (issue #1056).
 *
 * Each surface keeps the raw detail itself; this component carries only the
 * summary and the action. A null (unclassified) `hint` renders nothing, so
 * it drops safely into any error surface (fail-open).
 *
 * Query (QueryResultGrid) and search (the searchUiError surfaces) reuse it.
 * It goes inside the existing alert instead of adding a new error UI
 * container.
 *
 * NOTE: the feature import boundary rule stops ConnectionItem from
 * importing `@components/**`, so it duplicates the title+hint markup
 * inline — when the markup changes, match the error detail block in
 * `src/features/connection/components/ConnectionItem.tsx` too.
 */

import type { DriverErrorHint as DriverErrorHintData } from "@lib/errors/driverErrorHints";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

export interface DriverErrorHintProps {
  hint: DriverErrorHintData | null;
  /**
   * Whether to render the summary title. A surface that already has its own
   * label/summary (search uses the scope label) passes `false` to show only
   * the hint sentence. Defaults to `true`.
   */
  showTitle?: boolean;
  className?: string;
}

export function DriverErrorHint({
  hint,
  showTitle = true,
  className,
}: DriverErrorHintProps) {
  const { t } = useTranslation();
  if (!hint) return null;
  return (
    <div className={className} data-slot="driver-error-hint">
      {showTitle && <div className="font-medium">{t(hint.titleKey)}</div>}
      <p className={cn("text-xs opacity-90", showTitle && "mt-1")}>
        {t(hint.hintKey)}
      </p>
    </div>
  );
}
