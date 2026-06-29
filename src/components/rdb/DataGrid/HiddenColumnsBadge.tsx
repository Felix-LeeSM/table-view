import { useTranslation } from "react-i18next";
import { Button } from "@components/ui/button";

interface HiddenColumnsBadgeProps {
  hiddenCount: number;
  onShowAll: () => void;
}

export function HiddenColumnsBadge({
  hiddenCount,
  onShowAll,
}: HiddenColumnsBadgeProps) {
  const { t } = useTranslation("rdb");
  if (hiddenCount <= 0) return null;

  return (
    <div
      className="flex items-center justify-between border-b border-border bg-muted/40 px-3 py-1.5 text-xs"
      aria-label={t("hiddenColumnsBadge.badgeAria")}
    >
      <span className="text-muted-foreground">
        {hiddenCount === 1
          ? t("hiddenColumnsBadge.oneColumnHidden")
          : t("hiddenColumnsBadge.manyColumnsHidden", { count: hiddenCount })}
      </span>
      <Button
        variant="ghost"
        size="xs"
        className="text-primary hover:text-primary/80"
        onClick={onShowAll}
        aria-label={t("hiddenColumnsBadge.showAllAria")}
      >
        {t("hiddenColumnsBadge.showAll")}
      </Button>
    </div>
  );
}
