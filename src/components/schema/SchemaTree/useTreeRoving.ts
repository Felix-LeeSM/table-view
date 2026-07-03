import type { VisibleRow } from "./treeRows";
import {
  findParent as coreFindParent,
  useTreeRoving as useCoreTreeRoving,
  type TreeRoving,
  type TreeRovingRow,
} from "@components/shared/tree/useTreeRoving";

/**
 * SchemaTree adapter over the shared WAI-ARIA tree roving hook
 * (`@components/shared/tree/useTreeRoving`). The keymap / focus-split model
 * lives in that one shared place; this file only maps the schema tree's
 * `VisibleRow[]` onto the generic row shape and routes expand/collapse back
 * to the schema actions.
 *
 * The schema tree renders an ordered flat list of rows (`getVisibleRows`), a
 * mix of focusable `treeitem`s (schema / category / item) and non-focusable
 * affordance rows (separator / loading / search / empty).
 *
 * Depth is derived from `kind` (schema=0, category=1, item=2) — the parent/
 * child relationship is identical across all `treeShape`s even though the
 * rendered `aria-level` differs (no-schema/flat shift one step up).
 */

const KIND_DEPTH: Partial<Record<VisibleRow["kind"], number>> = {
  schema: 0,
  category: 1,
  item: 2,
};

type FocusableRow = VisibleRow & { kind: "schema" | "category" | "item" };

function isFocusable(row: VisibleRow): row is FocusableRow {
  return (
    row.kind === "schema" || row.kind === "category" || row.kind === "item"
  );
}

/** Row's tree depth, or -1 for non-treeitem rows. */
export function rowDepth(row: VisibleRow): number {
  return KIND_DEPTH[row.kind] ?? -1;
}

/** Whether an arrow can expand/collapse this row (leaf items can't). */
function rowIsExpanded(row: FocusableRow): boolean | null {
  if (row.kind === "item") return null; // leaf
  return row.isExpanded;
}

export interface TreeRovingActions {
  /** Toggle expand/collapse of the named schema row. */
  onToggleSchema: (schemaName: string) => void;
  /** Toggle expand/collapse of the named category row. */
  onToggleCategory: (row: Extract<VisibleRow, { kind: "category" }>) => void;
}

export type { TreeRoving } from "@components/shared/tree/useTreeRoving";

function dispatchToggle(row: FocusableRow, actions: TreeRovingActions): void {
  if (row.kind === "schema") actions.onToggleSchema(row.schemaName);
  else if (row.kind === "category") actions.onToggleCategory(row);
}

export function useTreeRoving(
  rows: VisibleRow[],
  actions: TreeRovingActions,
  containerRef: React.RefObject<HTMLElement | null>,
  scrollToIndex?: (index: number) => void,
): TreeRoving {
  const genericRows: TreeRovingRow[] = rows.map((row) => ({
    key: row.key,
    depth: rowDepth(row),
    expanded: isFocusable(row) ? rowIsExpanded(row) : null,
    focusable: isFocusable(row),
  }));

  const onToggle = (key: string) => {
    const row = rows.find((r) => r.key === key);
    if (row && isFocusable(row)) dispatchToggle(row, actions);
  };

  return useCoreTreeRoving(genericRows, onToggle, containerRef, scrollToIndex);
}

// ── exported for unit test ───────────────────────────────────────────────
/**
 * Kind-keyed parent lookup preserved for the existing SchemaTree unit test
 * (`{ kind, key }` rows). Reuses the shared depth-based finder after mapping
 * each row's `kind` to its tree depth.
 */
function findParent(
  rows: FocusableRow[],
  idx: number,
): FocusableRow | undefined {
  const parent = coreFindParent(
    rows.map((r) => ({
      key: r.key,
      depth: rowDepth(r),
      expanded: null,
      focusable: true,
    })),
    idx,
  );
  return parent ? rows.find((r) => r.key === parent.key) : undefined;
}

export const __test = { findParent, isFocusable };
