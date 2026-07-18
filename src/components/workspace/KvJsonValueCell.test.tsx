import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KvJsonValueCell } from "./KvJsonValueCell";

// Purpose: the collection/stream value cell renders a read-only `{…}` / `[ n ]`
// chip only when its raw value parses to a JSON object/array, and opens a
// read-only DocumentTreePanel on click — KV JSON tree Phase 2 (2026-07-18).
// Scalars / non-JSON / empty / hex fall through to the raw string and never
// crash. Read-only: the tree gets no onCommitEdit, so no leaf editor opens.

const tree = () => screen.queryByTestId("document-tree-panel");
const chip = () => screen.queryByRole("button", { name: /expand .* value/i });

describe("KvJsonValueCell", () => {
  // Reason: a JSON object value → `{…}` chip, no tree until clicked (2026-07-18).
  it("renders a chip for a JSON object value and opens the tree on click", async () => {
    const user = userEvent.setup();
    render(<KvJsonValueCell value={'{"name":"Ada"}'} label="profile" />);
    expect(chip()).toHaveTextContent("…");
    expect(tree()).not.toBeInTheDocument();

    await user.click(chip()!);
    expect(
      await screen.findByTestId("document-tree-panel"),
    ).toBeInTheDocument();
    expect(screen.getByText("name")).toBeInTheDocument();
  });

  // Reason: a JSON array value → `[ n ]` chip whose count is the array length.
  it("renders a chip with the item count for a JSON array value", async () => {
    const user = userEvent.setup();
    render(<KvJsonValueCell value="[1,2,3]" label="tags" />);
    expect(chip()).toHaveTextContent("3");

    await user.click(chip()!);
    expect(
      await screen.findByTestId("document-tree-panel"),
    ).toBeInTheDocument();
  });

  // Reason: read-only invariant — no onCommitEdit passed, so a leaf value has no
  // editor entry-point (`tree-edit-*`) even after opening the tree (2026-07-18).
  it("keeps the opened tree read-only (no leaf editor)", async () => {
    const user = userEvent.setup();
    render(<KvJsonValueCell value={'{"name":"Ada"}'} label="profile" />);
    await user.click(chip()!);
    const leaf = await screen.findByTestId("tree-leaf-name");
    await user.click(leaf);
    expect(screen.queryByTestId("tree-edit-name")).not.toBeInTheDocument();
  });

  // Reason: a bare numeric string is a scalar (not nested-capable) → raw text,
  // no chip (isNestedCapable parity with the single-value renderer).
  it("renders raw text for a numeric string value", () => {
    render(<KvJsonValueCell value="42" label="score" />);
    expect(chip()).not.toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  // Reason: non-JSON free text → raw fallback, parse failure never throws.
  it("renders raw text for a non-JSON string value", () => {
    render(<KvJsonValueCell value="hello world" label="msg" />);
    expect(chip()).not.toBeInTheDocument();
    expect(screen.getByText("hello world")).toBeInTheDocument();
  });

  // Reason: empty string is not tree-capable → raw path, no chip, no crash.
  it("renders nothing tree-like for an empty string value", () => {
    render(<KvJsonValueCell value="" label="member" />);
    expect(chip()).not.toBeInTheDocument();
    expect(tree()).not.toBeInTheDocument();
  });

  // Reason: a hex/binary-looking value ("deadbeef") is not JSON object/array →
  // raw text, never a chip.
  it("renders raw text for a hex-looking binary value", () => {
    render(<KvJsonValueCell value="deadbeef" label="blob" />);
    expect(chip()).not.toBeInTheDocument();
    expect(screen.getByText("deadbeef")).toBeInTheDocument();
  });
});
