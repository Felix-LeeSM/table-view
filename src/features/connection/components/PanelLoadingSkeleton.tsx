import { useTranslation } from "react-i18next";
import { Skeleton } from "@components/ui/skeleton";

/**
 * Issue #1587 — initial-load skeleton for the connection admin panels
 * (ServerInfo / DatabaseUsers / ServerActivity). These known-structure
 * grids previously showed a blank body while their first fetch was in
 * flight; the skeleton previews the shape and gives assistive tech the
 * loading announcement (`role="status"` + `aria-busy` + the i18n
 * `feedback:loading` label) the same way the shared `DataGridSkeleton` does.
 *
 * ponytail: a feature-local copy rather than reusing
 * `@components/datagrid`'s `DataGridSkeleton` — the `src/features/**` import
 * boundary rule only allows `@components/ui`, so the shared grid skeleton is
 * out of reach from here.
 */
export function PanelLoadingSkeleton() {
  const { t } = useTranslation("feedback");
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={t("loading")}
      className="flex flex-col gap-2"
    >
      <Skeleton className="h-6 w-full" />
      {Array.from({ length: 6 }, (_, i) => (
        <Skeleton key={i} className="h-5 w-full" />
      ))}
    </div>
  );
}
