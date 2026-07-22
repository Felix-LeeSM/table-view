// Purpose: shared mount variants for the SQL-result grid primitive — issue #1622
//   (P9 duplication cleanup). `QueryResultTable` (read-only) and
//   `EditableQueryResultGrid` (editable) are two parallel implementations of the
//   SAME grid primitive contract (role=grid ARIA indices, `--cols` column resize,
//   @tanstack virtualization, `useGridRoving` roving tabindex). The aria-grid /
//   column-resize / virtualization / roving suites re-verified that identical
//   contract by copy-pasting the same cases per mount; these two variants let each
//   suite assert the shared contract once via `describe.each`. (2026-07-22)
//
// `QueryResultGrid` (the router) delegates its read-only SELECT path to
// `QueryResultTable`, so the primitive is tested here directly — the router's
// read-only branch stays covered by QueryResultGrid.routing.test.tsx.
import type { ReactElement } from "react";
import { render } from "@testing-library/react";
import { QueryResultTable } from "../QueryResultTable";
import EditableQueryResultGrid from "../EditableQueryResultGrid";
import type { QueryResult } from "@/types/query";
import type { RawEditPlan } from "@lib/sql/rawQuerySqlBuilder";

/** Editable variant needs a plan; derive it from the result so callers only
 *  pass the shared fixture. A single `id` PK matches every fixture below. */
function planFor(result: QueryResult): RawEditPlan {
  return {
    schema: "public",
    table: "users",
    pkColumns: ["id"],
    resultColumnNames: result.columns.map((c) => c.name),
  };
}

export interface GridVariant {
  name: string;
  /** Build the mount element (not `render`ed) so callers can drive
   *  `rerender(variant.element(...))` in scroll-preservation cases. */
  element: (result: QueryResult, opts?: { sql?: string }) => ReactElement;
}

export const READONLY_VARIANT: GridVariant = {
  name: "QueryResultTable (read-only)",
  element: (result, opts) => (
    <QueryResultTable result={result} sql={opts?.sql} />
  ),
};

export const EDITABLE_VARIANT: GridVariant = {
  name: "EditableQueryResultGrid (editable)",
  element: (result, opts) => (
    <EditableQueryResultGrid
      result={result}
      connectionId="conn1"
      plan={planFor(result)}
      sql={opts?.sql}
    />
  ),
};

export const QUERY_GRID_VARIANTS: GridVariant[] = [
  READONLY_VARIANT,
  EDITABLE_VARIANT,
];

/** Convenience for the (rare) suite that mounts a single variant inline. */
export function renderVariant(
  variant: GridVariant,
  result: QueryResult,
  opts?: { sql?: string },
) {
  return render(variant.element(result, opts));
}
