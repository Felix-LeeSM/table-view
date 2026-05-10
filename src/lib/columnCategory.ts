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
  // UUID 36자 고정 (8-4-4-4-12 + 4 dashes). text 보다 더 넓게.
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
 * Sprint 258 — column 별 default rem 을 rootFontSize 로 px 변환.
 *
 * Sprint 238 의 컨테이너 fit (sum < containerPx 일 때 비례 확대) 폐기.
 * `<table>` → CSS Grid 전환 (sprint-258) 후에는 columns 합 < container
 * 면 우측 잔여 공간 (사용자 의도), 합 > container 면 horizontal scroll.
 * Stretch redistribution 의 _근거 자체_ 가 사라졌다.
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
