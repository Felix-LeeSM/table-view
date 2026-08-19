interface GroupColorDotProps {
  /** Group accent color; `null` renders the bordered placeholder. */
  color: string | null;
  /** Call sites differ so a rendered list header and dialog preview stay queryable apart. */
  testId: string;
}

/**
 * The group accent dot. Shared by the list header (`ConnectionGroup`) and the
 * `GroupDialog` preview so the two cannot drift — the preview is only useful
 * if it renders the color exactly the way the list does. Legacy groups with
 * `color=null` fall back to a bordered transparent dot so header metrics stay
 * consistent across the list.
 */
export default function GroupColorDot({ color, testId }: GroupColorDotProps) {
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
