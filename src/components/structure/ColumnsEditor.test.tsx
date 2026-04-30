// Reason: Sprint 179 (AC-179-02 / AC-179-03 / AC-179-04) — verifies
// ColumnsEditor's paradigm-aware copy in isolation. The structure-level
// tests already exercise the RDB default through StructurePanel.test.tsx;
// this sibling file keeps the dictionary-driven assertions close to the
// component they cover so the audit (labels-audit.md) can point here for
// the "Add Column"/"Add Field" + empty-state evidence. Date: 2026-04-30.
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import ColumnsEditor from "./ColumnsEditor";

function renderEditor(
  props: {
    paradigm?: "rdb" | "document" | "search" | "kv" | undefined;
    columns?: never[];
  } = {},
) {
  // Empty columns + no pending changes triggers the empty-state branch
  // (`No columns found` / `No fields found`).
  return render(
    <ColumnsEditor
      connectionId="conn-1"
      table="users"
      schema="public"
      columns={props.columns ?? []}
      onRefresh={vi.fn().mockResolvedValue(undefined)}
      paradigm={props.paradigm}
    />,
  );
}

describe("ColumnsEditor — paradigm-aware copy (Sprint 179)", () => {
  // Reason: AC-179-02b — paradigm="document" renders the Mongo button +
  // empty-state copy. The aria-label uses sentence case ("Add field") to
  // match the legacy ariaAddUnit pattern; visible text uses title case
  // ("Add Field") sourced from the dictionary. Date: 2026-04-30.
  it("[AC-179-02b] paradigm=\"document\" renders 'Add Field' button and 'No fields found' empty state", () => {
    renderEditor({ paradigm: "document" });

    // Visible button text — matches AC-179-02 user-visible mention.
    expect(screen.getByText("Add Field")).toBeInTheDocument();
    // Accessible name (aria-label sentence-case form).
    expect(
      screen.getByRole("button", { name: "Add field" }),
    ).toBeInTheDocument();
    // Empty-state copy.
    expect(screen.getByText("No fields found")).toBeInTheDocument();
  });

  // Reason: AC-179-02 negative assertion — under paradigm="document" the
  // RDB strings ("Add Column", "No columns found", and the lowercase
  // aria-label "Add column") are absent so users don't see the wrong
  // vocabulary. Date: 2026-04-30.
  it('[AC-179-02c] paradigm="document" hides RDB vocabulary', () => {
    renderEditor({ paradigm: "document" });

    expect(screen.queryByText("Add Column")).not.toBeInTheDocument();
    expect(screen.queryByText("No columns found")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Add column" }),
    ).not.toBeInTheDocument();
  });

  // Reason: AC-179-03 — explicit paradigm="rdb" continues to render the
  // legacy RDB vocabulary (button "Add Column" + empty-state "No columns
  // found"). Date: 2026-04-30.
  it("[AC-179-03c] paradigm=\"rdb\" renders 'Add Column' + 'No columns found'", () => {
    renderEditor({ paradigm: "rdb" });

    expect(screen.getByText("Add Column")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Add column" }),
    ).toBeInTheDocument();
    expect(screen.getByText("No columns found")).toBeInTheDocument();
  });

  // Reason: AC-179-04b — paradigm prop missing/undefined falls back to
  // the RDB dictionary entry without throwing. Component-level fence on
  // top of the dictionary-level fence (paradigm-vocabulary.test.ts).
  // Date: 2026-04-30.
  it("[AC-179-04b] paradigm undefined falls back to RDB vocabulary", () => {
    renderEditor({ paradigm: undefined });

    expect(screen.getByText("Add Column")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Add column" }),
    ).toBeInTheDocument();
    expect(screen.getByText("No columns found")).toBeInTheDocument();
  });
});
