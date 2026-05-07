// Sprint 234 — `IndexesTabBody` presentation tests.
//
// Date: 2026-05-07.
//
// Why this file exists:
//   - `IndexesTabBody.tsx` was extracted from `CreateTableDialog.tsx`
//     in Sprint 228 (parent body LOC ceiling). Sprint 234 adds two
//     new behaviours to this sub-component:
//       1. ↑ / ↓ reorder buttons left of the `−` remove button
//          (AC-234-03). Boundary-disabled at first row (↑) and last
//          row (↓). Click invokes `onMove(trackingId, -1 | 1)`.
//       2. Locked empty-state message
//          "Add named columns in the Columns tab to use this picker."
//          (AC-234-02) — replaces the Sprint 228 verbose form.
//
// Per AC-234 contract Test Requirements: ≥ 2 new cases live here.
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen, within } from "@testing-library/react";

import IndexesTabBody, { type IndexDraft } from "./IndexesTabBody";

function indexDraft(over: Partial<IndexDraft> = {}): IndexDraft {
  return {
    trackingId: "ix-default",
    name: "",
    columns: [],
    index_type: "btree",
    unique: false,
    ...over,
  };
}

function defaultProps() {
  return {
    indexes: [] as IndexDraft[],
    availableColumns: ["id", "email"],
    isPkDuplicate: () => false,
    onAdd: vi.fn(),
    onRemove: vi.fn(),
    onUpdate: vi.fn(),
    onToggleColumn: vi.fn(),
    onMove: vi.fn(),
  };
}

describe("IndexesTabBody (Sprint 234)", () => {
  // Sprint 234 AC-234-03 — ↑ disabled at top row, ↓ disabled at bottom
  // row. Defense-in-depth: the parent's onMove also no-ops on
  // boundary clicks but the disabled attribute blocks the click in the
  // first place.
  it("renders Move up/down buttons disabled at first and last index row (AC-234-03)", () => {
    const indexes = [
      indexDraft({ trackingId: "ix-1", name: "idx_a", columns: ["id"] }),
      indexDraft({ trackingId: "ix-2", name: "idx_b", columns: ["email"] }),
      indexDraft({ trackingId: "ix-3", name: "idx_c", columns: ["id"] }),
    ];
    const onMove = vi.fn();
    render(
      <IndexesTabBody {...defaultProps()} indexes={indexes} onMove={onMove} />,
    );

    const upButtons = screen.getAllByRole("button", { name: /Move index up/i });
    const downButtons = screen.getAllByRole("button", {
      name: /Move index down/i,
    });
    expect(upButtons).toHaveLength(3);
    expect(downButtons).toHaveLength(3);

    // First row → ↑ disabled, ↓ enabled.
    expect(upButtons[0]).toBeDisabled();
    expect(downButtons[0]).not.toBeDisabled();
    // Middle row → both enabled.
    expect(upButtons[1]).not.toBeDisabled();
    expect(downButtons[1]).not.toBeDisabled();
    // Last row → ↑ enabled, ↓ disabled.
    expect(upButtons[2]).not.toBeDisabled();
    expect(downButtons[2]).toBeDisabled();

    // Clicking ↓ on row 1 forwards `(trackingId, +1)` to the parent.
    fireEvent.click(downButtons[1]!);
    expect(onMove).toHaveBeenCalledWith("ix-2", 1);
  });

  // Sprint 234 AC-234-02 — locked empty-state message replaces the
  // Sprint 228 verbose form. Text must match the contract verbatim
  // (period-terminated).
  it("renders the locked empty-state message when availableColumns is empty (AC-234-02)", () => {
    const indexes = [indexDraft({ trackingId: "ix-1", name: "idx_anon" })];
    render(
      <IndexesTabBody
        {...defaultProps()}
        indexes={indexes}
        availableColumns={[]}
      />,
    );
    // The empty-state span lives inside the row's "Index columns"
    // group. Its label is on the wrapper aria-label.
    const columnsGroup = screen.getByLabelText("Index columns");
    expect(
      within(columnsGroup).getByText(
        "Add named columns in the Columns tab to use this picker.",
      ),
    ).toBeInTheDocument();
  });

  // Sprint 234 — ↑ click forwards `(trackingId, -1)` for non-boundary
  // rows (regression-proofs the parent contract).
  it("clicking Move up on a non-first row forwards (trackingId, -1) (AC-234-03)", () => {
    const indexes = [
      indexDraft({ trackingId: "ix-1", name: "idx_a", columns: ["id"] }),
      indexDraft({ trackingId: "ix-2", name: "idx_b", columns: ["email"] }),
    ];
    const onMove = vi.fn();
    render(
      <IndexesTabBody {...defaultProps()} indexes={indexes} onMove={onMove} />,
    );
    const upButtons = screen.getAllByRole("button", { name: /Move index up/i });
    fireEvent.click(upButtons[1]!);
    expect(onMove).toHaveBeenCalledWith("ix-2", -1);
  });
});
