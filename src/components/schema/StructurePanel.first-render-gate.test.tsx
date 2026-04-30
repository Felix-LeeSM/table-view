/**
 * Reason: Sprint-176 / RISK-035 — first-render flash gate for the
 * StructurePanel. Before sprint-176, mounting the panel with a
 * slow-resolving (or never-resolving) `getTableColumns` fetch would
 * briefly render `ColumnsEditor` with `columns={[]}`, surfacing the
 * "No columns found" empty state to the user before the actual data
 * arrived. This file pins the sprint-176 contract: empty-state copy
 * does not appear before the first fetch on each tab settles, and
 * does appear after the fetch resolves with `[]`.
 *
 * Date: 2026-04-30 (sprint-176, generator phase)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import StructurePanel from "./StructurePanel";
import { useSchemaStore } from "@stores/schemaStore";
import type { ColumnInfo, IndexInfo, ConstraintInfo } from "@/types/schema";

// Hoisted promise resolvers so tests can resolve the never-resolving fetch
// later in the same test (e.g. to prove the gate releases when the data
// arrives).
let pendingColumns: {
  resolve: (v: ColumnInfo[]) => void;
  reject: (e: Error) => void;
} | null;
let pendingIndexes: {
  resolve: (v: IndexInfo[]) => void;
  reject: (e: Error) => void;
} | null;
let pendingConstraints: {
  resolve: (v: ConstraintInfo[]) => void;
  reject: (e: Error) => void;
} | null;

const mockGetTableColumns = vi.fn<
  (connectionId: string, table: string, schema: string) => Promise<ColumnInfo[]>
>(
  () =>
    new Promise<ColumnInfo[]>((resolve, reject) => {
      pendingColumns = { resolve, reject };
    }),
);
const mockGetTableIndexes = vi.fn<
  (connectionId: string, table: string, schema: string) => Promise<IndexInfo[]>
>(
  () =>
    new Promise<IndexInfo[]>((resolve, reject) => {
      pendingIndexes = { resolve, reject };
    }),
);
const mockGetTableConstraints = vi.fn<
  (
    connectionId: string,
    table: string,
    schema: string,
  ) => Promise<ConstraintInfo[]>
>(
  () =>
    new Promise<ConstraintInfo[]>((resolve, reject) => {
      pendingConstraints = { resolve, reject };
    }),
);

beforeEach(() => {
  vi.clearAllMocks();
  pendingColumns = null;
  pendingIndexes = null;
  pendingConstraints = null;
  // Each test starts with all three fetches pending; tests that need to
  // exercise the post-fetch path resolve the relevant pending promise.
  mockGetTableColumns.mockImplementation(
    () =>
      new Promise<ColumnInfo[]>((resolve, reject) => {
        pendingColumns = { resolve, reject };
      }),
  );
  mockGetTableIndexes.mockImplementation(
    () =>
      new Promise<IndexInfo[]>((resolve, reject) => {
        pendingIndexes = { resolve, reject };
      }),
  );
  mockGetTableConstraints.mockImplementation(
    () =>
      new Promise<ConstraintInfo[]>((resolve, reject) => {
        pendingConstraints = { resolve, reject };
      }),
  );
  useSchemaStore.setState({
    getTableColumns: mockGetTableColumns,
    getTableIndexes: mockGetTableIndexes,
    getTableConstraints: mockGetTableConstraints,
  } as Partial<Parameters<typeof useSchemaStore.setState>[0]>);
});

function renderPanel() {
  return render(
    <StructurePanel connectionId="conn-1" table="users" schema="public" />,
  );
}

describe("StructurePanel first-render flash gate (sprint-176)", () => {
  // Reason: AC-176-03 — the load-bearing assertion. Mount with a
  // never-resolving columns fetch and confirm none of the three empty
  // state strings ("No columns found", "No indexes found",
  // "No constraints found") are in the DOM during the pre-fetch window.
  // Pre-sprint-176, "No columns found" would appear because
  // `ColumnsEditor` mounted with `columns={[]}`.
  // Date: 2026-04-30
  it("[AC-176-03] does not render empty-state copy before first fetch settles", () => {
    renderPanel();

    // Spinner is visible while the fetch is in flight.
    expect(document.querySelector(".animate-spin")).toBeInTheDocument();

    // None of the empty-state strings appear during the pre-fetch window.
    expect(screen.queryByText("No columns found")).not.toBeInTheDocument();
    expect(screen.queryByText("No indexes found")).not.toBeInTheDocument();
    expect(screen.queryByText("No constraints found")).not.toBeInTheDocument();
  });

  // Reason: AC-176-03 — gate-release proof. After the fetch resolves with
  // an empty array, the empty-state copy DOES appear. Without this, the
  // gate could be stuck "always closed" and we'd never see the empty
  // state at all (which is its own bug).
  // Date: 2026-04-30
  it("[AC-176-03] empty-state copy appears after first fetch resolves with []", async () => {
    renderPanel();

    expect(screen.queryByText("No columns found")).not.toBeInTheDocument();

    await act(async () => {
      pendingColumns!.resolve([]);
    });

    expect(screen.getByText("No columns found")).toBeInTheDocument();
  });

  // Reason: AC-176-03 — per-tab gate. After switching from columns to
  // indexes, the indexes fetch is in flight. "No indexes found" must not
  // appear before that fetch settles, even though "No columns found"
  // would never appear on this tab anyway. This locks the per-tab shape
  // of the gate (separate hasFetched flag per sub-tab).
  // Date: 2026-04-30
  it("[AC-176-03] tab switch: 'No indexes found' is hidden until indexes fetch settles", async () => {
    renderPanel();

    // Resolve columns so the columns tab is in a settled state.
    await act(async () => {
      pendingColumns!.resolve([
        {
          name: "id",
          data_type: "integer",
          nullable: false,
          default_value: null,
          is_primary_key: true,
          is_foreign_key: false,
          fk_reference: null,
          comment: null,
        },
      ]);
    });

    // Switch to indexes tab. The indexes fetch is now pending (per the
    // mock implementation in beforeEach).
    await act(async () => {
      fireEvent.mouseDown(screen.getByRole("tab", { name: "Indexes" }));
    });

    // Pre-sprint-176, IndexesEditor would mount briefly with indexes=[]
    // and surface "No indexes found". Sprint-176 gates that until the
    // fetch resolves.
    expect(screen.queryByText("No indexes found")).not.toBeInTheDocument();

    // Resolve the indexes fetch with an empty array — empty state must
    // now appear.
    await act(async () => {
      pendingIndexes!.resolve([]);
    });

    expect(screen.getByText("No indexes found")).toBeInTheDocument();
  });

  // Reason: AC-176-03 — error-recovery scenario. When the columns fetch
  // rejects, the alert appears (existing behaviour) and the empty-state
  // copy must still NOT appear. Without the explicit hasFetched gate
  // flip in the catch branch of fetchData, the gate could stick closed
  // forever and an empty result on retry would never surface
  // "No columns found".
  // Date: 2026-04-30
  it("[AC-176-03] rejected fetch shows error but no empty-state flash", async () => {
    renderPanel();

    expect(screen.queryByText("No columns found")).not.toBeInTheDocument();

    await act(async () => {
      pendingColumns!.reject(new Error("Connection lost"));
    });

    // Error banner is the visible response, not the empty state.
    expect(screen.getByRole("alert")).toHaveTextContent("Connection lost");
    expect(screen.queryByText("No columns found")).not.toBeInTheDocument();
  });

  // Reason: AC-176-03 — constraints tab parity. Same shape as the
  // indexes test but for the constraints tab. Locks the per-tab gate
  // for the third sub-tab.
  // Date: 2026-04-30
  it("[AC-176-03] tab switch: 'No constraints found' is hidden until constraints fetch settles", async () => {
    renderPanel();

    await act(async () => {
      pendingColumns!.resolve([]);
    });

    await act(async () => {
      fireEvent.mouseDown(screen.getByRole("tab", { name: "Constraints" }));
    });

    expect(screen.queryByText("No constraints found")).not.toBeInTheDocument();

    await act(async () => {
      pendingConstraints!.resolve([]);
    });

    expect(screen.getByText("No constraints found")).toBeInTheDocument();
  });
});
