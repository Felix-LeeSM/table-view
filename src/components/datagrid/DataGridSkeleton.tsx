import { useTranslation } from "react-i18next";
import { Skeleton } from "@components/ui/skeleton";

/**
 * Issue #1058 — loading-state convention. A known-structure grid on its
 * initial load (no data yet) previews its shape with a skeleton instead of a
 * spinner. Spinners stay for indeterminate operations (query execution) and
 * for the refetch overlay over already-rendered data. Shared by the RDB and
 * document data grids so both paradigms load identically.
 *
 * `role="status"` gives assistive tech the loading announcement the former
 * bare-`Loader2` initial-load block lacked; the refetch overlay
 * (`AsyncProgressOverlay`) uses the same feedback `loading` label, but this
 * only renders while `!data`, so the two never coexist.
 */
export default function DataGridSkeleton() {
  const { t } = useTranslation("feedback");
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={t("loading")}
      className="flex flex-1 flex-col gap-2 p-3"
    >
      <Skeleton className="h-8 w-full" />
      {Array.from({ length: 8 }, (_, i) => (
        <Skeleton key={i} className="h-6 w-full" />
      ))}
    </div>
  );
}
