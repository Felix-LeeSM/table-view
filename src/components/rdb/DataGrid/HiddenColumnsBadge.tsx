import { Button } from "@components/ui/button";

interface HiddenColumnsBadgeProps {
  hiddenCount: number;
  onShowAll: () => void;
}

export function HiddenColumnsBadge({
  hiddenCount,
  onShowAll,
}: HiddenColumnsBadgeProps) {
  if (hiddenCount <= 0) return null;

  return (
    <div
      className="flex items-center justify-between border-b border-border bg-muted/40 px-3 py-1.5 text-xs"
      aria-label="Hidden columns badge"
    >
      <span className="text-muted-foreground">
        {hiddenCount === 1
          ? "1 column hidden"
          : `${hiddenCount} columns hidden`}
      </span>
      <Button
        variant="ghost"
        size="xs"
        className="text-primary hover:text-primary/80"
        onClick={onShowAll}
        aria-label="Show all hidden columns"
      >
        Show all
      </Button>
    </div>
  );
}
