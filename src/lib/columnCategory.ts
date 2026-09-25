export type ColumnCategory =
  | "int"
  | "float"
  | "text"
  | "bool"
  | "datetime"
  | "object"
  | "binary"
  | "enum"
  | "uuid"
  | "unknown";

const DEFAULT_REM: Record<ColumnCategory, number> = {
  bool: 4,
  int: 6,
  binary: 6,
  float: 7.5,
  enum: 7.5,
  datetime: 11,
  unknown: 12.5,
  text: 15,
  object: 15,
  // UUIDs are a fixed 36 characters (8-4-4-4-12 + 4 dashes); wider than text.
  uuid: 18,
};

export function getDefaultRem(category: ColumnCategory): number {
  return DEFAULT_REM[category];
}

export type TextAlign = "left" | "center" | "right";

export function getTextAlign(category: ColumnCategory): TextAlign {
  if (category === "int" || category === "float") return "right";
  if (category === "bool") return "center";
  return "left";
}

/**
 * Convert each column's default rem to px with rootFontSize.
 *
 * The earlier container fit (proportional stretch when sum < containerPx) was
 * dropped. Since the `<table>` → CSS Grid switch, a column sum below the
 * container leaves free space on the right (intended), and a sum above it
 * scrolls horizontally. Stretch redistribution _no longer has a reason_ to
 * exist.
 */
export function computeInitialWidths(
  columns: ReadonlyArray<{ name: string; category: ColumnCategory }>,
  rootFontSizePx: number,
): Record<string, number> {
  const result: Record<string, number> = {};
  columns.forEach((col) => {
    result[col.name] = getDefaultRem(col.category) * rootFontSizePx;
  });
  return result;
}
