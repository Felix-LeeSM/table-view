import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@components/ui/button";

export interface HistoryCollapseToggleProps {
  expanded: boolean;
  hiddenCount: number;
  onToggle: () => void;
  className?: string;
  "data-testid"?: string;
}

/**
 * Shared "show more / collapse" control for history-like surfaces (#1309).
 * One component = one convention (same label, chevron and a11y contract) across
 * every history surface. It is a native `<button>` (via `Button`) and exposes
 * `aria-expanded` so keyboard and AT users get the collapse state; the label
 * carries the hidden count so the affordance is self-describing.
 */
export default function HistoryCollapseToggle({
  expanded,
  hiddenCount,
  onToggle,
  className,
  "data-testid": testId,
}: HistoryCollapseToggleProps) {
  const { t } = useTranslation("shared");
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      aria-expanded={expanded}
      aria-label={
        expanded
          ? t("historyCollapse.collapseAria")
          : t("historyCollapse.expandAria", { count: hiddenCount })
      }
      onClick={onToggle}
      className={className}
      data-testid={testId}
    >
      {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      {expanded
        ? t("historyCollapse.showLess")
        : t("historyCollapse.showMore", { count: hiddenCount })}
    </Button>
  );
}
