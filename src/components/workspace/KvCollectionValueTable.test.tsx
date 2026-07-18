import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KvCollectionValueTable } from "./KvCollectionValueTable";
import type { KvHashValue } from "@/types/kv";

// Purpose: the collection value table routes each value cell through the
// read-only JSON chip — a JSON object value shows a `{…}` chip that opens a
// tree, while a scalar value stays plain text. Wiring guard for KV JSON tree
// Phase 2 (2026-07-18); the full parse/branch matrix lives in
// KvJsonValueCell.test.tsx (lowest layer, P1).

function hash(fields: { field: string; value: string }[]): KvHashValue {
  return {
    type: "hash",
    fields,
    cursor: "0",
    nextCursor: "0",
    done: true,
    total: fields.length,
  };
}

describe("KvCollectionValueTable", () => {
  // Reason: a hash field whose value is a JSON object renders a chip in the
  // value cell and opens the read-only tree on click (2026-07-18).
  it("renders a JSON chip in a value cell and opens the tree on click", async () => {
    const user = userEvent.setup();
    render(
      <KvCollectionValueTable
        keyName="user:1"
        value={hash([{ field: "profile", value: '{"plan":"pro"}' }])}
      />,
    );
    const chip = screen.getByRole("button", { name: /expand profile value/i });
    expect(screen.queryByTestId("document-tree-panel")).not.toBeInTheDocument();

    await user.click(chip);
    expect(
      await screen.findByTestId("document-tree-panel"),
    ).toBeInTheDocument();
    expect(screen.getByText("plan")).toBeInTheDocument();
  });

  // Reason: a scalar value stays plain text — no chip, and the field-name cell
  // (not JSON) also stays plain, so the row is unchanged for non-JSON data.
  it("renders scalar values as plain text without a chip", () => {
    render(
      <KvCollectionValueTable
        keyName="user:1"
        value={hash([{ field: "name", value: "Ada" }])}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /expand .* value/i }),
    ).not.toBeInTheDocument();
    const table = screen.getByRole("table");
    expect(
      within(table).getByRole("cell", { name: "name" }),
    ).toBeInTheDocument();
    expect(
      within(table).getByRole("cell", { name: "Ada" }),
    ).toBeInTheDocument();
  });
});
