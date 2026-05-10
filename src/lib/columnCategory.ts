export type ColumnCategory =
  | "int"
  | "float"
  | "text"
  | "bool"
  | "datetime"
  | "object"
  | "binary"
  | "enum"
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
 * AC-238-03 (c) 산식 — pure 함수.
 *
 * 1. 각 column 의 category default rem → px (rootFontSize).
 * 2. sum(defaultPx) < containerPx → 전체 column 을 비례 확대 (container 채움).
 * 3. sum(defaultPx) ≥ containerPx → default 그대로 (horizontal scroll).
 */
export function computeInitialWidths(
  columns: ReadonlyArray<{ name: string; category: ColumnCategory }>,
  containerPx: number,
  rootFontSizePx: number,
): Record<string, number> {
  const result: Record<string, number> = {};
  if (columns.length === 0) return result;

  const defaultsPx = columns.map(
    (c) => getDefaultRem(c.category) * rootFontSizePx,
  );
  const sum = defaultsPx.reduce((acc, n) => acc + n, 0);

  const scale = sum > 0 && sum < containerPx ? containerPx / sum : 1;
  columns.forEach((col, i) => {
    const px = defaultsPx[i] ?? 0;
    result[col.name] = px * scale;
  });
  return result;
}
