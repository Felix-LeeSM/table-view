/** Default character limit for cell display truncation. */
export const CELL_DISPLAY_LIMIT = 200;

/**
 * Truncate a string value for display in a table cell.
 *
 * If the value exceeds `limit` characters, it is sliced and an ellipsis ("...")
 * is appended. Otherwise the original value is returned unchanged.
 */
export function truncateCell(
  value: string,
  limit: number = CELL_DISPLAY_LIMIT,
): string {
  if (value.length <= limit) return value;
  return value.slice(0, limit) + "...";
}
