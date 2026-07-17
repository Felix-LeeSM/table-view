import { useTranslation } from "react-i18next";
import { Skeleton } from "@components/ui/skeleton";

// Varying widths so the placeholder reads as a list of tree rows rather than a
// solid block. Full class strings keep them scannable by Tailwind's JIT.
const ROW_WIDTHS = ["w-4/5", "w-3/5", "w-11/12", "w-2/3", "w-3/4", "w-1/2"];

/**
 * Issue #1058 — loading-state convention for known-structure trees / sidebars
 * on their initial load (no data yet). Previews the row shape with skeletons
 * instead of a labelled spinner, mirroring the shared `DataGridSkeleton`.
 * Spinners stay for control-busy (refresh) and partial/refetch loads
 * (pagination "load more", on-expand collection fetch).
 *
 * `role="status"` + the `feedback:loading` label carry the same assistive-tech
 * announcement the former bare-`Loader2` blocks had; this only renders while
 * the list is empty, so it never coexists with a rendered row.
 */
export default function TreeSkeleton() {
  const { t } = useTranslation("feedback");
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={t("loading")}
      className="flex flex-col gap-2 px-3 py-2"
    >
      {ROW_WIDTHS.map((w, i) => (
        <Skeleton key={i} className={`h-5 ${w}`} />
      ))}
    </div>
  );
}
