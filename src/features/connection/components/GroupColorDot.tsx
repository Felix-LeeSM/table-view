interface GroupColorDotProps {
  /** Group accent color; `null` renders the bordered placeholder. */
  color: string | null;
  /**
   * Defaults to the list header's id. The dialog preview passes its own, so
   * the two stay queryable apart while both are on screen.
   */
  testId?: string;
}

/**
 * The group accent dot. Shared by the list header (`ConnectionGroup`) and the
 * `GroupDialog` preview so the two cannot drift — the preview is only useful
 * if it renders the color exactly the way the list does. Legacy groups with
 * `color=null` fall back to a bordered transparent dot so header metrics stay
 * consistent across the list.
 */
export default function GroupColorDot({
  color,
  testId = "group-color-accent",
}: GroupColorDotProps) {
  return (
    <span
      data-testid={testId}
      aria-hidden="true"
      className={`inline-block h-2 w-2 shrink-0 rounded-full border ${
        color ? "border-transparent" : "border-border bg-transparent"
      }`}
      style={color ? { backgroundColor: color } : undefined}
    />
  );
}
